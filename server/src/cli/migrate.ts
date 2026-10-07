import { createPool, loadEnv, requireDatabaseUrl } from '../db/connection.js';
import { migrateToLatest, migrationStatus } from '../db/migrator.js';

async function main(): Promise<void> {
  loadEnv();
  const command = process.argv[2] ?? 'up';
  const pool = createPool(requireDatabaseUrl(), { max: 1 });
  try {
    if (command === 'up') {
      const applied = await migrateToLatest(pool);
      if (applied.length === 0) {
        console.log('Base de datos al día: no hay migraciones pendientes.');
      } else {
        for (const m of applied) console.log(`aplicada  ${m.name}`);
        console.log(`${applied.length} migración(es) aplicada(s).`);
      }
    } else if (command === 'status') {
      const status = await migrationStatus(pool);
      for (const s of status) {
        const mark = s.applied ? (s.checksumMatches ? 'OK ' : '!! ') : '   ';
        const when = s.appliedAt ? s.appliedAt.toISOString() : 'pendiente';
        console.log(`${mark}${s.name}  ${when}`);
      }
      const broken = status.filter((s) => s.applied && s.checksumMatches === false);
      if (broken.length > 0) throw new Error('Hay migraciones aplicadas cuyo contenido cambió.');
    } else {
      console.error(`Comando desconocido: ${command}. Usa "up" o "status".`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
