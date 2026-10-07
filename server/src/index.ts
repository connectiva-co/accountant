import { buildServer } from './api/server.js';
import { createDb, createPool, loadEnv, requireDatabaseUrl } from './db/connection.js';
import { migrateToLatest } from './db/migrator.js';

async function main(): Promise<void> {
  loadEnv();
  const url = requireDatabaseUrl();
  const port = Number(process.env.PORT ?? 3001);
  const logLevel = process.env.LOG_LEVEL ?? 'info';

  if (process.env.AUTO_MIGRATE !== 'false') {
    const pool = createPool(url, { max: 1 });
    try {
      const applied = await migrateToLatest(pool);
      if (applied.length > 0) {
        console.error(`[migrate] aplicadas: ${applied.map((m) => m.name).join(', ')}`);
      }
    } finally {
      await pool.end();
    }
  }

  const db = createDb(url);
  const app = await buildServer(db, { logger: logLevel !== 'silent' });

  const shutdown = async (signal: string): Promise<void> => {
    console.error(`[server] ${signal}: cerrando...`);
    try {
      await app.close();
      await db.destroy();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port, host: '0.0.0.0' });
  console.error(`[server] Accountant API escuchando en http://localhost:${port}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
