import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export interface MigrationFile {
  name: string;
  checksum: string;
  body: string;
}

export interface MigrationStatus {
  name: string;
  applied: boolean;
  appliedAt: Date | null;
  checksumMatches: boolean | null;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: MigrationFile[] = [];
  for (const name of files) {
    const body = await readFile(path.join(dir, name), 'utf8');
    migrations.push({ name, checksum: sha256(body), body });
  }
  return migrations;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Aplica todas las migraciones pendientes en orden alfabético.
 * Cada migración corre en su propia transacción: si falla, se revierte entera.
 * Un checksum distinto al registrado significa que una migración ya aplicada
 * fue modificada: se rechaza (las migraciones aplicadas son inmutables).
 */
export async function migrateToLatest(pool: pg.Pool, dir?: string): Promise<MigrationFile[]> {
  const client = await pool.connect();
  const appliedNow: MigrationFile[] = [];
  try {
    await ensureMigrationsTable(client);
    const migrations = await loadMigrations(dir);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const appliedByName = new Map(rows.map((row) => [row.name, row.checksum]));

    for (const migration of migrations) {
      const checksum = appliedByName.get(migration.name);
      if (checksum !== undefined) {
        if (checksum !== migration.checksum) {
          throw new Error(
            `La migración ya aplicada cambió de contenido: ${migration.name}. ` +
              'Crea una nueva migración en lugar de editar una aplicada.',
          );
        }
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(migration.body);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Fallo aplicando ${migration.name}: ${detail}`);
      }
      appliedNow.push(migration);
    }
    return appliedNow;
  } finally {
    client.release();
  }
}

export async function migrationStatus(pool: pg.Pool, dir?: string): Promise<MigrationStatus[]> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const migrations = await loadMigrations(dir);
    const { rows } = await client.query<{ name: string; checksum: string; applied_at: Date }>(
      'SELECT name, checksum, applied_at FROM schema_migrations',
    );
    const appliedByName = new Map(rows.map((row) => [row.name, row]));
    return migrations.map((m) => {
      const row = appliedByName.get(m.name);
      return {
        name: m.name,
        applied: Boolean(row),
        appliedAt: row?.applied_at ?? null,
        checksumMatches: row ? row.checksum === m.checksum : null,
      };
    });
  } finally {
    client.release();
  }
}
