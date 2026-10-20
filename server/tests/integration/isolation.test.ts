import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Kysely } from 'kysely';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { createDb, loadEnv } from '../../src/db/connection.js';
import type { Database } from '../../src/db/schema.js';
import { migrateToLatest } from '../../src/db/migrator.js';
import { createUser, grantMembership, login } from '../helpers/auth.js';
import type { AuthedSession } from '../helpers/auth.js';

/**
 * Aislamiento multi-empresa y ausencia de secretos en respuestas/auditoría.
 * Contra la base `accountant_test`; NUNCA usa la base de desarrollo.
 */

let pool: pg.Pool;
let db: Kysely<Database>;
let app: FastifyInstance;

const A = { nit: '900000001', legal_name: 'EMPRESA A SAS' };
const B = { nit: '900000002', legal_name: 'EMPRESA B SAS' };
let companyA: string;
let companyB: string;

const SECRET = 'super-secreto-credencial-123';
const OWNER_EMAIL = 'owner-isolation@test.local';
const OWNER_PASSWORD = 'Owner-Local-2026!';

let session: AuthedSession;
/** app.inject autenticado (sesión + CSRF). */
const authed = (opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject({ ...opts, headers: { ...session.headers, ...(opts.headers ?? {}) } });

beforeAll(async () => {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Falta TEST_DATABASE_URL (copia server/.env.example a server/.env).');
  if (!url.includes('test')) throw new Error(`TEST_DATABASE_URL debe apuntar a una base de pruebas: ${url}`);

  pool = new pg.Pool({ connectionString: url, max: 1 });
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await migrateToLatest(pool);
  db = createDb(url);

  const inserted = await db
    .insertInto('companies')
    .values([
      { nit: A.nit, legal_name: A.legal_name },
      { nit: B.nit, legal_name: B.legal_name },
    ])
    .returning('id')
    .execute();
  companyA = inserted[0].id;
  companyB = inserted[1].id;

  app = await buildServer(db, { logger: false });
  await app.ready();

  // Usuario con sesión: OWNER en ambas empresas (el aislamiento que se prueba
  // aquí es por empresa; el aislamiento entre usuarios vive en auth.test.ts).
  const userId = await createUser(db, { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  await grantMembership(db, { companyId: companyA, userId, roleCode: 'OWNER' });
  await grantMembership(db, { companyId: companyB, userId, roleCode: 'OWNER' });
  session = await login(app, OWNER_EMAIL, OWNER_PASSWORD);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await db?.destroy();
  await pool?.end();
});

describe('settings por empresa', () => {
  it('el override de una empresa no se filtra a otra', async () => {
    const put = await authed({
      method: 'PUT',
      url: '/api/settings',
      payload: { company_id: companyA, scope: 'general', key: 'maintenance_mode', value: true },
    });
    expect(put.statusCode).toBe(200);

    const readA = await authed({ method: 'GET', url: `/api/settings?company_id=${companyA}` });
    const readB = await authed({ method: 'GET', url: `/api/settings?company_id=${companyB}` });
    expect(readA.json().effective['general.maintenance_mode']).toBe(true);
    expect(readB.json().effective['general.maintenance_mode']).toBe(false);
  });

  it('todas las filas expuestas pertenecen a la empresa pedida o al alcance global', async () => {
    const read = await authed({ method: 'GET', url: `/api/settings?company_id=${companyB}` });
    for (const row of read.json().rows as Array<{ company_id: string | null }>) {
      expect(row.company_id === null || row.company_id === companyB).toBe(true);
    }
  });

  it('rechaza scope/clave desconocidos con 400 SETTING_DESCONOCIDO', async () => {
    const scope = await authed({
      method: 'PUT',
      url: '/api/settings',
      payload: { company_id: companyA, scope: 'integraciones', key: 'x', value: 1 },
    });
    expect(scope.statusCode).toBe(400);
    expect(scope.json().error.code).toBe('SETTING_DESCONOCIDO');

    const key = await authed({
      method: 'PUT',
      url: '/api/settings',
      payload: { company_id: companyA, scope: 'tax', key: 'no_existe', value: 1 },
    });
    expect(key.statusCode).toBe(400);
    expect(key.json().error.code).toBe('SETTING_DESCONOCIDO');
  });

  it('rechaza valores fuera de esquema con 422 VALIDACION', async () => {
    const res = await authed({
      method: 'PUT',
      url: '/api/settings',
      payload: { company_id: companyA, scope: 'tax', key: 'default_vat_rate', value: 500 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDACION');
  });
});

describe('integraciones por empresa', () => {
  it('crea una integración con credenciales cifradas y jamás las devuelve', async () => {
    const put = await authed({
      method: 'PUT',
      url: `/api/companies/${companyA}/integrations/SIIGO`,
      payload: {
        name: 'Siigo de A',
        enabled: true,
        settings: { partner_id: 'partnera' },
        credentials: { username: 'usuario@empresa-a.co', access_key: SECRET },
      },
    });
    expect(put.statusCode).toBe(200);

    const body = put.json();
    const raw = JSON.stringify(body);
    // Ni el valor secreto ni el usuario viajan de vuelta (el catálogo sí
    // declara el NOMBRE del campo "access_key" como definición, no su valor).
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('usuario@empresa-a.co');
    expect(body.integration.credentials).toBeUndefined();
    expect(body.integration.has_credentials).toBe(true);

    const stored = await pool.query(
      'select encrypted_payload, nonce, auth_tag from integration_secrets where company_integration_id = $1',
      [body.integration.id],
    );
    expect(stored.rows).toHaveLength(1);
    expect(Buffer.from(stored.rows[0].encrypted_payload, 'base64').toString('utf8')).not.toContain(SECRET);

    const audits = await pool.query(
      `select after::text as payload from audit_log where company_id = $1 and entity_type = 'company_integration'`,
      [companyA],
    );
    expect(audits.rows.length).toBeGreaterThan(0);
    for (const row of audits.rows) expect(row.payload).not.toContain(SECRET);
  });

  it('la empresa B no ve la integración de la empresa A', async () => {
    const own = await authed({ method: 'GET', url: `/api/companies/${companyB}/integrations` });
    expect((own.json().integrations as unknown[]).length).toBe(0);

    const cross = await authed({ method: 'GET', url: `/api/companies/${companyB}/integrations/SIIGO` });
    expect(cross.statusCode).toBe(404);
    expect(cross.json().error.code).toBe('SIN_INTEGRACION');
  });

  it('probar la conexión sin credenciales falla localmente (sin red) con CREDENCIALES ausentes', async () => {
    const res = await authed({
      method: 'PUT',
      url: `/api/companies/${companyB}/integrations/SIIGO`,
      payload: { name: 'Siigo de B', enabled: true, settings: {} },
    });
    expect(res.statusCode).toBe(200);

    const test = await authed({
      method: 'POST',
      url: `/api/companies/${companyB}/integrations/SIIGO/test`,
      payload: {},
    });
    expect(test.statusCode).toBeGreaterThanOrEqual(400);
    expect(['SIN_CREDENCIALES', 'CREDENCIALES_INVALIDAS', 'CONFIGURACION_INVALIDA']).toContain(
      test.json().error.code,
    );
  });

  it('el catálogo declara solo operaciones implementadas hoy', async () => {
    const res = await authed({ method: 'GET', url: `/api/companies/${companyA}/integrations` });
    const catalog = res.json().catalog as Array<{ provider: string; capabilities: string[] }>;
    const siigo = catalog.find((c) => c.provider === 'SIIGO');
    expect(siigo?.capabilities).toContain('THIRD_PARTIES_WRITE');
    expect(siigo?.capabilities).not.toContain('SALES_INVOICES_WRITE');
  });
});

describe('documentos y matches por empresa', () => {
  let docId: string;
  let docType: string;

  it('crea un documento en la empresa A', async () => {
    const type = await db.selectFrom('document_types').select('id').executeTakeFirstOrThrow();
    docType = type.id;
    const inserted = await db
      .insertInto('documents')
      .values({
        company_id: companyA,
        external_uid: 'CUFE-DE-LA-EMPRESA-A',
        document_type_id: docType,
        folio: '0001',
        prefix: 'FEA',
        issued_at: '2026-09-01',
        total: 119000,
        direction: 'ISSUED',
        source_hash: 'hash-a-1',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    docId = inserted.id;
  });

  it('la empresa B no puede leer el documento de la empresa A', async () => {
    const cross = await authed({
      method: 'GET',
      url: `/api/documents/${docId}?company_id=${companyB}`,
    });
    expect(cross.statusCode).toBe(404);

    const own = await authed({
      method: 'GET',
      url: `/api/documents/${docId}?company_id=${companyA}`,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().document.id).toBe(docId);
  });

  it('las rutas que exigen empresa rechazan company_id ausente', async () => {
    for (const url of [`/api/documents/${docId}`, '/api/imports', '/api/documents', '/api/issues']) {
      const res = await authed({ method: 'GET', url });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code, url).toBe('SIN_EMPRESA');
    }
  });

  it('el listado de matches solo devuelve los de la empresa pedida', async () => {
    const res = await authed({ method: 'GET', url: `/api/companies/${companyB}/matches` });
    expect(res.statusCode).toBe(200);
    expect(res.json().matches).toEqual([]);
  });

  it('rechazar la incidencia de otra empresa responde 404', async () => {
    const inserted = await db
      .insertInto('validation_issues')
      .values({
        company_id: companyA,
        import_id: null,
        document_id: null,
        rule_code: 'TU004',
        severity: 'WARNING',
        message: 'NIT de receptor inválido',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const cross = await authed({
      method: 'POST',
      url: `/api/issues/${inserted.id}/resolve`,
      payload: { company_id: companyB },
    });
    expect(cross.statusCode).toBe(404);

    const own = await authed({
      method: 'POST',
      url: `/api/issues/${inserted.id}/resolve`,
      payload: { company_id: companyA },
    });
    expect(own.statusCode).toBe(200);
  });
});
