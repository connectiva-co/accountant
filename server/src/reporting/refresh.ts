import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db/schema.js';

export interface Period {
  year: number;
  month: number;
}

export function periodLabel(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/**
 * Refresca la reportería de los periodos indicados desde cero.
 * Devuelve los periodos efectivamente recalculados, en orden cronológico.
 */
export async function refreshPeriods(
  db: Kysely<Database>,
  companyId: string,
  periods: Period[],
): Promise<string[]> {
  const unique = new Map<string, Period>();
  for (const p of periods) {
    if (!Number.isInteger(p.year) || !Number.isInteger(p.month) || p.month < 1 || p.month > 12) continue;
    unique.set(periodLabel(p), p);
  }
  const ordered = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, p]) => p);

  for (const p of ordered) {
    await sql`SELECT refresh_reporting_month(${companyId}::uuid, ${p.year}::int, ${p.month}::int)`.execute(db);
  }
  return ordered.map(periodLabel);
}

/** Periodos (año, mes) de los documentos tocados por una importación. */
export async function periodsOfImportDocuments(
  db: Kysely<Database>,
  importId: string,
): Promise<Period[]> {
  const rows = await db
    .selectFrom('import_rows')
    .innerJoin('documents', 'documents.id', 'import_rows.document_id')
    .select(['documents.issued_at as issued_at'])
    .where('import_rows.import_id', '=', importId)
    .execute();

  const periods = new Map<string, Period>();
  for (const row of rows) {
    if (!row.issued_at) continue;
    const [y, m] = row.issued_at.split('-');
    const period = { year: Number(y), month: Number(m) };
    if (!Number.isInteger(period.year) || !Number.isInteger(period.month)) continue;
    periods.set(periodLabel(period), period);
  }
  return [...periods.values()];
}
