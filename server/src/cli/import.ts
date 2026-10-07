import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, createDb, loadEnv, requireDatabaseUrl } from '../db/connection.js';
import { ImportError, runImport } from '../import/runImport.js';

async function main(): Promise<void> {
  loadEnv();
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: npm run import -- <archivo.xlsx|.xls|.csv>');
    process.exitCode = 1;
    return;
  }

  const resolved = path.resolve(file);
  const buffer = await readFile(resolved);
  const db = createDb(requireDatabaseUrl());

  try {
    const result = await runImport(db, {
      buffer,
      filename: path.basename(resolved),
      createdBy: 'cli',
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.replayed) console.log('=> Archivo ya importado: se omitió el reprocesado (idempotencia).');
    else
      console.log(
        `=> ${result.inserted} nuevas, ${result.updated} actualizadas, ` +
          `${result.unchanged} sin cambios, ${result.rejected} rechazadas, ` +
          `${result.warnings} incidencias. Periodos: ${result.periods.join(', ') || 'ninguno'}.`,
      );
  } catch (error) {
    if (error instanceof ImportError) {
      console.error(`[${error.code}] ${error.message}`);
    } else if (error instanceof Error && 'name' in error && error.name === 'SpreadsheetError') {
      console.error(error.message);
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  } finally {
    await db.destroy();
    await closeDb();
  }
}

main();
