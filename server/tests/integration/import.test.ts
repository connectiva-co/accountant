import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Kysely } from 'kysely';
import { computeKPIs, enrichRecords } from '../../../src/utils/radianEngine.js';
import { createDb, loadEnv } from '../../src/db/connection.js';
import type { Database } from '../../src/db/schema.js';
import { migrateToLatest } from '../../src/db/migrator.js';
import { runImport, type ImportResult } from '../../src/import/runImport.js';
import { buildDataset } from '../../src/services/dataset.js';
import { buildRadianXlsx, sampleRows } from '../helpers/radianXlsx.js';

/**
 * Suite de integración contra la base `accountant_test`:
 * se recrea el esquema al inicio. NUNCA usa la base de desarrollo.
 */

let pool: pg.Pool;
let db: Kysely<Database>;
let first: ImportResult;

const SAMPLE = sampleRows();
const EXPECTED_ROWS = 356;

beforeAll(async () => {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Falta TEST_DATABASE_URL (copia server/.env.example a server/.env).');
  if (!url.includes('test')) {
    throw new Error(`TEST_DATABASE_URL debe apuntar a una base de pruebas: ${url}`);
  }

  pool = new pg.Pool({ connectionString: url, max: 1 });
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await migrateToLatest(pool);
  db = createDb(url);
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await pool?.end();
});

describe('importación RADIAN end-to-end', () => {
  it('importa las 356 filas: empresa derivada, incidencias y reportería', async () => {
    first = await runImport(db, {
      buffer: buildRadianXlsx(SAMPLE),
      filename: 'radian_sample.xlsx',
    });

    expect(first.replayed).toBe(false);
    expect(first.total).toBe(EXPECTED_ROWS);
    expect(first.inserted).toBe(EXPECTED_ROWS);
    expect(first.updated).toBe(0);
    expect(first.rejected).toBe(0);
    expect(first.warnings).toBeGreaterThan(0);
    expect(first.companyNit).toBe('900555053');
    expect(first.companyName).toBe('JGV GRUPO DE INVERSION S A S');
    expect(first.periods).toContain('2026-08');

    const docs = await db
      .selectFrom('documents')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    expect(Number(docs?.count)).toBe(EXPECTED_ROWS);

    const issues = await db
      .selectFrom('validation_issues')
      .select(['rule_code', 'severity', (eb) => eb.fn.countAll<number>().as('count')])
      .groupBy(['rule_code', 'severity'])
      .execute();

    // Paridad con el frontend: las 113 incidencias son NIT de receptor inválido (TU004).
    const tu004 = issues.find((i) => i.rule_code === 'TU004');
    expect(Number(tu004?.count ?? 0)).toBe(first.warnings);
    expect(issues.every((i) => i.rule_code === 'TU004')).toBe(true);
  }, 180_000);

  it('el dataset en forma RADIAN reproduce los KPIs del frontend', async () => {
    const dataset = await buildDataset(db);
    expect(dataset).not.toBeNull();
    expect(dataset!.records).toHaveLength(EXPECTED_ROWS);
    expect(dataset!.company.nit).toBe('900555053');
    expect(dataset!.counts.withFallbackUid).toBe(0);

    const desdeApp = computeKPIs(enrichRecords(SAMPLE));
    const desdeDb = computeKPIs(enrichRecords(dataset!.records));

    for (const key of Object.keys(desdeApp) as Array<keyof typeof desdeApp>) {
      const a = Number(desdeApp[key]);
      const b = Number(desdeDb[key]);
      expect(Math.abs(a - b), `KPI ${key}: app=${a} db=${b}`).toBeLessThan(0.01);
    }
    expect(desdeDb.totalTransacciones).toBe(EXPECTED_ROWS);
  }, 60_000);

  it('la reportería mensual coincide con los KPIs calculados por el frontend', async () => {
    const dataset = await buildDataset(db);
    const kpis = computeKPIs(enrichRecords(dataset!.records));

    const periods = await db
      .selectFrom('reporting_monthly')
      .selectAll()
      .where('year', '=', 2026)
      .where('month', '=', 8)
      .executeTakeFirst();

    expect(periods).toBeDefined();
    expect(Number(periods!.documents_count)).toBe(EXPECTED_ROWS);
    expect(Math.abs(Number(periods!.sales_count) - kpis.totalVentasCount)).toBeLessThan(0.01);
    expect(Math.abs(Number(periods!.sales_total) - kpis.totalVentasBrutas)).toBeLessThan(0.01);
    expect(Math.abs(Number(periods!.purchase_count) - kpis.totalComprasCount)).toBeLessThan(0.01);
    expect(Math.abs(Number(periods!.purchase_total) - kpis.totalComprasBrutas)).toBeLessThan(0.01);

    // Divergencia documentada e intencional: la BD agrupa los POS en la
    // categoría SUPPORT, mientras que el KPI del frontend solo cuenta los
    // rótulos con "soporte"/"no obligados".
    const pos = SAMPLE.filter((r) =>
      String(r['Tipo de documento'] ?? '').toLowerCase().includes('pos'),
    );
    const posTotal = pos.reduce((sum, r) => sum + Number(r['Total'] || 0), 0);
    expect(Number(periods!.support_documents_count)).toBe(kpis.totalDocSoporteCount + pos.length);
    expect(Math.abs(Number(periods!.support_documents_total) - (kpis.totalDocSoporte + posTotal))).toBeLessThan(0.01);
  }, 60_000);

  it('reimportar el mismo archivo es un no-op idempotente (mismo SHA-256)', async () => {
    const replay = await runImport(db, {
      buffer: buildRadianXlsx(SAMPLE),
      filename: 'radian_sample.xlsx',
    });

    expect(replay.replayed).toBe(true);
    expect(replay.importId).toBe(first.importId);

    const imports = await db
      .selectFrom('imports')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    expect(Number(imports?.count)).toBe(1);

    const versions = await db
      .selectFrom('document_versions')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    expect(Number(versions?.count)).toBe(EXPECTED_ROWS);
  }, 60_000);

  it('una fila modificada actualiza solo ese documento y crea una versión', async () => {
    const before = await db
      .selectFrom('reporting_monthly')
      .selectAll()
      .where('year', '=', 2026)
      .where('month', '=', 8)
      .executeTakeFirstOrThrow();

    const changed = SAMPLE.slice(0, 5).map((row, index) =>
      index === 0
        ? { ...row, Total: Number(row['Total']) + 1000, Estado: 'Rechazado' }
        : { ...row },
    );

    const second = await runImport(db, {
      buffer: buildRadianXlsx(changed),
      filename: 'muestra_modificada.xlsx',
    });

    expect(second.replayed).toBe(false);
    expect(second.total).toBe(5);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);
    expect(second.unchanged).toBe(4);
    expect(second.rejected).toBe(0);

    const totalVersions = await db
      .selectFrom('document_versions')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    expect(Number(totalVersions?.count)).toBe(EXPECTED_ROWS + 1);

    const groups = await db
      .selectFrom('document_versions')
      .select(['document_id', (eb) => eb.fn.countAll<number>().as('count')])
      .groupBy('document_id')
      .execute();
    expect(groups.filter((g) => Number(g.count) > 1)).toHaveLength(1);

    // El historial de estados solo registra cambios reales de estado:
    // el documento modificado cambió de estado => se agrega un evento nuevo.
    const history = await db
      .selectFrom('document_status_history')
      .select(['document_id', (eb) => eb.fn.countAll<number>().as('count')])
      .groupBy('document_id')
      .execute();
    expect(history.reduce((sum, h) => sum + Number(h.count), 0)).toBe(EXPECTED_ROWS + 1);

    const docWithTwoStatuses = history.filter((h) => Number(h.count) > 1);
    expect(docWithTwoStatuses).toHaveLength(1);
    expect(groups.filter((g) => Number(g.count) > 1)[0].document_id).toBe(
      docWithTwoStatuses[0].document_id,
    );

    // La reportería se refrescó: la fila 1 del archivo es un documento de
    // soporte por +1000, el resto de los 351 documentos no cambió.
    const after = await db
      .selectFrom('reporting_monthly')
      .selectAll()
      .where('year', '=', 2026)
      .where('month', '=', 8)
      .executeTakeFirstOrThrow();

    expect(Number(after.documents_count)).toBe(EXPECTED_ROWS);
    expect(Number(after.support_documents_total) - Number(before.support_documents_total)).toBeCloseTo(1000, 2);
  }, 180_000);
});
