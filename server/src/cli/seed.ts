import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, loadEnv, requireDatabaseUrl } from '../db/connection.js';

const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Reaplica los seeds de catálogo. Son idempotentes (ON CONFLICT DO NOTHING),
 * por lo que es seguro ejecutarlos en cualquier momento.
 */
async function main(): Promise<void> {
  loadEnv();
  const files = (await readFileDir()).filter((f) => f.startsWith('0002'));
  if (files.length === 0) throw new Error('No se encontró la migración de seeds 0002_*.sql');
  const pool = createPool(requireDatabaseUrl(), { max: 1 });
  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = await readFile(path.join(SEED_DIR, file), 'utf8');
      await client.query(sql);
      console.log(`seed aplicado (idempotente): ${file}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

async function readFileDir(): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  return (await readdir(SEED_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
