import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

// NUMERIC -> number: el importador y la reportería trabajan con números de JS.
// Los importes de RADIAN caben con holgura en double precision (< 2^53).
pg.types.setTypeParser(1700, (value: string | null) => (value === null ? null : Number(value)));
// int8 -> number (contadores; import_rows.id es el único bigserial transaccional).
pg.types.setTypeParser(20, (value: string | null) => (value === null ? null : Number(value)));
// DATE -> 'YYYY-MM-DD' crudo: evita el Date local de node-postgres y sus
// corrimientos de zona horaria en fechas contables.
pg.types.setTypeParser(1082, (value: string | null) => value);

export function loadEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // .env opcional: en CI/CD las variables vienen del entorno.
  }
}

export function requireDatabaseUrl(env = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL no definida. Copia server/.env.example a server/.env.');
  }
  return url;
}

export function createPool(url: string, options: { max?: number } = {}): pg.Pool {
  return new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    // Las consultas cortas del importador y la API se benefician de conexiones vivas.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function createDb(url: string, options: { max?: number } = {}): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: createPool(url, options) }),
  });
}

let singleton: Kysely<Database> | null = null;

export function getDb(): Kysely<Database> {
  if (!singleton) {
    loadEnv();
    singleton = createDb(requireDatabaseUrl());
  }
  return singleton;
}

export async function closeDb(): Promise<void> {
  if (singleton) {
    await singleton.destroy();
    singleton = null;
  }
}
