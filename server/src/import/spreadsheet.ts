import * as XLSX from 'xlsx';
import { norm } from '../domain/text.js';

/** Encabezados canónicos de la exportación RADIAN (paridad con el frontend). */
export const CANONICAL_KEYS = [
  'Tipo de documento', 'CUFE/CUDE', 'Folio', 'Prefijo', 'Divisa', 'Forma de Pago',
  'Medio de Pago', 'Fecha Emisión', 'Fecha Recepción', 'NIT Emisor', 'Nombre Emisor',
  'NIT Receptor', 'Nombre Receptor', 'IVA', 'ICA', 'IC', 'INC', 'Timbre', 'INC Bolsas',
  'IN Carbono', 'IN Combustibles', 'IC Datos', 'ICL', 'INPP', 'IBUA', 'ICUI',
  'Rete IVA', 'Rete Renta', 'Rete ICA', 'Total', 'Estado', 'Grupo',
];

const REQUIRED = ['tipo de documento', 'fecha emision'];
const CANON_BY_NORM = new Map(CANONICAL_KEYS.map((k) => [norm(k), k]));
const HEADER_HINTS = new Set(CANONICAL_KEYS.map(norm));

export interface ParsedSheet {
  records: Record<string, unknown>[];
  headers: string[];
  sheetName: string;
  sheetNames: string[];
}

export class SpreadsheetError extends Error {}

function headerKey(cell: unknown): string {
  const raw = String(cell ?? '').replace(/\s+/g, ' ').trim();
  return CANON_BY_NORM.get(norm(raw)) || raw;
}

function sheetToRecords(ws: XLSX.WorkSheet): { records: Record<string, unknown>[]; headers: string[] } | null {
  const ref = ws['!ref'];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);

  // Detección de fila de encabezado: se escanean las primeras 40 filas.
  let best = { score: 0, row: -1 };
  const lastScan = Math.min(range.e.r, range.s.r + 40);
  for (let r = range.s.r; r <= lastScan; r++) {
    let score = 0;
    let hasTipo = false;
    let hasFecha = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || typeof cell.v !== 'string') continue;
      const n = norm(cell.v);
      if (!HEADER_HINTS.has(n)) continue;
      score++;
      if (n === 'tipo de documento') hasTipo = true;
      if (n === 'fecha emision') hasFecha = true;
    }
    if (score >= 2 && (hasTipo || hasFecha) && score > best.score) best = { score, row: r };
  }
  if (best.row < 0) return null;

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    range: XLSX.utils.encode_range({
      s: { c: range.s.c, r: best.row },
      e: { c: range.e.c, r: range.e.r },
    }),
    defval: '',
    blankrows: false,
    raw: true,
  });
  if (aoa.length < 2) return null;

  const headers = (aoa[0] as unknown[]).map(headerKey);
  const records: Record<string, unknown>[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[];
    const obj: Record<string, unknown> = {};
    let filled = false;
    headers.forEach((h, idx) => {
      if (!h) return;
      const v = row[idx];
      if (v !== undefined && v !== null && v !== '') filled = true;
      obj[h] = v;
    });
    if (filled) records.push(obj);
  }
  return { records, headers };
}

/**
 * Lee un archivo (.xlsx/.xls/.csv) y devuelve las filas con la fila de
 * encabezados detectada. Lanza SpreadsheetError con un mensaje accionable.
 */
export function parseSpreadsheet(buffer: Buffer, filename: string): ParsedSheet {
  const isCsv = /\.csv$/i.test(filename);
  const workbook = isCsv
    ? XLSX.read(buffer.toString('utf8'), { type: 'string' })
    : XLSX.read(buffer, { type: 'buffer' });

  let parsed: { records: Record<string, unknown>[]; headers: string[]; sheetName: string } | null = null;
  for (const sheetName of workbook.SheetNames) {
    const candidate = sheetToRecords(workbook.Sheets[sheetName]);
    if (candidate && candidate.records.length > 0) {
      parsed = { ...candidate, sheetName };
      break;
    }
  }

  if (!parsed) {
    throw new SpreadsheetError(
      `No se reconocieron los encabezados en "${filename}". Se espera una hoja con columnas como ` +
        '"Tipo de documento", "Fecha Emisión", "NIT Emisor", "Total". ' +
        `Hojas encontradas: ${workbook.SheetNames.join(', ') || 'ninguna'}.`,
    );
  }

  const missing = REQUIRED.filter((k) => !parsed!.headers.some((h) => norm(h) === k));
  if (missing.length > 0) {
    const labels: Record<string, string> = {
      'tipo de documento': '"Tipo de documento"',
      'fecha emision': '"Fecha Emisión"',
    };
    throw new SpreadsheetError(
      `Faltan columnas obligatorias: ${missing.map((m) => labels[m] || m).join(', ')}. ` +
        `Columnas detectadas: ${parsed.headers.filter(Boolean).slice(0, 12).join(', ') || 'ninguna'}.`,
    );
  }

  return { records: parsed.records, headers: parsed.headers, sheetName: parsed.sheetName, sheetNames: workbook.SheetNames };
}
