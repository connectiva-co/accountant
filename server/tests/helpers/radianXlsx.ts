import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { CANONICAL_KEYS } from '../../src/import/spreadsheet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = path.resolve(here, '../../../src/data/sampleRadian.json');

/** Filas RADIAN de referencia (mismas que usa el demo del frontend). */
export function sampleRows(): Record<string, unknown>[] {
  return JSON.parse(readFileSync(SAMPLE_PATH, 'utf8')) as Record<string, unknown>[];
}

/**
 * Construye en memoria un .xlsx con las filas dadas y los encabezados
 * canónicos de RADIAN: el importador recibe bytes, como con un archivo real.
 */
export function buildRadianXlsx(rows: Array<Record<string, unknown>>): Buffer {
  const present = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) present.add(key);

  const header = [
    ...CANONICAL_KEYS.filter((k) => present.has(k)),
    ...[...present].filter((k) => !CANONICAL_KEYS.includes(k)),
  ];

  const sheet = XLSX.utils.json_to_sheet(rows, { header });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'RADIAN');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
