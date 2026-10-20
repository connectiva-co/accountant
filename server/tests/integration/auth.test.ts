import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Kysely } from 'kysely';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { createDb, loadEnv } from '../../src/db/connection.js';
import type { Database } from '../../src/db/schema.js';
import { migrateToLatest } from '../../src/db/migrator.js';
import {
  createUser,
  grantMembership,
  login,
  setMembershipStatus,
  setUserStatus,
  type AuthedSession,
} from '../helpers/auth.js';

/**
 * Auth, membresías y RBAC (Fases 0-2):
 * 401 sin sesión, 403 por membresía/permiso, CSRF, sesiones y auditoría.
 * Contra la base `accountant_test`; NUNCA usa la base de desarrollo.
 */

let pool: pg.Pool;
let db: Kysely<Database>;
let app: FastifyInstance;

const MP = { nit: '900452038', legal_name: 'MP NET SOLUTIONS SAS' };
const JGV = { nit: '901234567', legal_name: 'JGV GRUPO DE INVERSIONES SAS' };
let companyMp: string;
let companyJgv: string;

const PASSWORD = 'Clave-Segura-2026!';

let maria: AuthedSession; // OWNER solo en MP NET
let carlos: AuthedSession; // ACCOUNTANT solo en JGV
let debil: AuthedSession; // REPORT_IMPORTER solo en MP NET
let admin: AuthedSession; // platform_admin + REPORT_IMPORTER en MP NET

const authed = (session: AuthedSession, opts: InjectOptions): Promise<LightMyRequestResponse> =>
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
      { nit: MP.nit, legal_name: MP.legal_name },
      { nit: JGV.nit, legal_name: JGV.legal_name },
    ])
    .returning('id')
    .execute();
  companyMp = inserted[0].id;
  companyJgv = inserted[1].id;

  app = await buildServer(db, { logger: false });
  await app.ready();

  const mariaId = await createUser(db, { email: 'maria@mp.local', password: PASSWORD, fullName: 'María Pérez' });
  await grantMembership(db, { companyId: companyMp, userId: mariaId, roleCode: 'OWNER' });

  const carlosId = await createUser(db, { email: 'carlos@jgv.local', password: PASSWORD, fullName: 'Carlos Gómez' });
  await grantMembership(db, { companyId: companyJgv, userId: carlosId, roleCode: 'ACCOUNTANT' });

  const debilId = await createUser(db, { email: 'debil@mp.local', password: PASSWORD, fullName: 'Debil Rol' });
  await grantMembership(db, { companyId: companyMp, userId: debilId, roleCode: 'REPORT_IMPORTER' });

  const adminId = await createUser(db, {
    email: 'plataforma@local.test',
    password: PASSWORD,
    fullName: 'Plataforma Admin',
    platformAdmin: true,
  });
  await grantMembership(db, { companyId: companyMp, userId: adminId, roleCode: 'REPORT_IMPORTER' });

  maria = await login(app, 'maria@mp.local', PASSWORD);
  carlos = await login(app, 'carlos@jgv.local', PASSWORD);
  debil = await login(app, 'debil@mp.local', PASSWORD);
  admin = await login(app, 'plataforma@local.test', PASSWORD);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await db?.destroy();
  await pool?.end();
});

describe('sin sesión', () => {
  it('cualquier ruta protegida responde 401', async () => {
    const cases: InjectOptions[] = [
      { method: 'GET', url: `/api/documents?company_id=${companyMp}` },
      { method: 'GET', url: '/api/companies' },
      { method: 'GET', url: '/api/me' },
      { method: 'GET', url: `/api/companies/${companyMp}/integrations` },
      { method: 'PUT', url: '/api/settings', payload: {} },
      { method: 'POST', url: '/api/imports', payload: {} },
    ];
    for (const opts of cases) {
      const res = await app.inject(opts);
      expect(res.statusCode, `${opts.method} ${opts.url}`).toBe(401);
      expect(res.json().error.code, `${opts.method} ${opts.url}`).toBe('NO_AUTENTICADO');
    }
  });

  it('el health sigue público', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('login y credenciales', () => {
  it('contraseña o correo incorrectos => 401 genérico', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: await csrfHeaders(),
      payload: { email: 'maria@mp.local', password: 'otra-clave-mala' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json().error.code).toBe('CREDENCIALES_INVALIDAS');

    const wrongEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: await csrfHeaders(),
      payload: { email: 'nobody@local.test', password: PASSWORD },
    });
    expect(wrongEmail.statusCode).toBe(401);
    expect(wrongEmail.json().error.code).toBe('CREDENCIALES_INVALIDAS');
  });

  it('el login exige CSRF (doble submit)', async () => {
    const noToken = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'maria@mp.local', password: PASSWORD },
    });
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json().error.code).toBe('CSRF_INVALIDO');
  });

  it('la contraseña se guarda con Argon2id y nunca se devuelve', async () => {
    const row = await db
      .selectFrom('users')
      .select(['password_hash'])
      .where('email', '=', 'maria@mp.local')
      .executeTakeFirstOrThrow();
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(PASSWORD);

    const me = await authed(maria, { method: 'GET', url: '/api/me' });
    expect(me.body).not.toContain(PASSWORD);
    expect(me.body.toLowerCase()).not.toContain('password_hash');
    expect(me.json().user.email).toBe('maria@mp.local');
    expect(me.json().user.password_hash).toBeUndefined();
  });

  it('bloquea tras 10 fallos consecutivos (429 CUENTA_BLOQUEADA)', async () => {
    const email = 'fuerza@local.test';
    const userId = await createUser(db, { email, password: PASSWORD });

    const headers = await csrfHeaders();
    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers,
        payload: { email, password: 'clave-mala-123' },
      });
      expect(res.statusCode, `fallo ${i + 1}`).toBe(401);
    }

    const locked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { email, password: PASSWORD },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('CUENTA_BLOQUEADA');

    await setUserStatus(db, userId, 'ACTIVE');
    await db.updateTable('users').set({ locked_until: null, failed_attempts: 0 }).where('id', '=', userId).execute();
  }, 60_000);
});

describe('membresías: nadie accede a una empresa solo por conocer el id', () => {
  it('María (solo MP NET) lee su empresa pero recibe 403 en JGV', async () => {
    const own = await authed(maria, { method: 'GET', url: `/api/documents?company_id=${companyMp}` });
    expect(own.statusCode).toBe(200);

    const cases: InjectOptions[] = [
      { method: 'GET', url: `/api/documents?company_id=${companyJgv}` },
      { method: 'GET', url: `/api/documents/00000000-0000-4000-8000-000000000000?company_id=${companyJgv}` },
      { method: 'GET', url: `/api/companies/${companyJgv}/integrations` },
      { method: 'GET', url: `/api/companies/${companyJgv}/matches` },
      { method: 'GET', url: `/api/companies/${companyJgv}/sync/policies` },
      { method: 'GET', url: `/api/reporting/monthly?company_id=${companyJgv}` },
      { method: 'GET', url: `/api/reporting/taxes?company_id=${companyJgv}` },
      { method: 'GET', url: `/api/issues?company_id=${companyJgv}` },
      { method: 'GET', url: `/api/imports?company_id=${companyJgv}` },
      { method: 'GET', url: `/api/events?company_id=${companyJgv}` },
      { method: 'GET', url: `/api/settings?company_id=${companyJgv}` },
      // company_id metido a mano en el cuerpo:
      { method: 'PUT', url: '/api/settings', payload: { company_id: companyJgv, scope: 'general', key: 'maintenance_mode', value: true } },
      { method: 'POST', url: `/api/issues/00000000-0000-4000-8000-000000000000/resolve`, payload: { company_id: companyJgv } },
      { method: 'POST', url: `/api/companies/${companyJgv}/matches/recheck`, payload: {} },
      { method: 'POST', url: `/api/companies/${companyJgv}/sync/run`, payload: {} },
    ];
    for (const opts of cases) {
      const res = await authed(maria, opts);
      expect(res.statusCode, `${opts.method} ${opts.url}`).toBe(403);
      expect(res.json().error.code, `${opts.method} ${opts.url}`).toBe('SIN_ACCESO');
    }
  });

  it('Carlos (solo JGV) recibe 403 en MP NET', async () => {
    const cross = await authed(carlos, { method: 'GET', url: `/api/documents?company_id=${companyMp}` });
    expect(cross.statusCode).toBe(403);
    const own = await authed(carlos, { method: 'GET', url: `/api/documents?company_id=${companyJgv}` });
    expect(own.statusCode).toBe(200);
  });

  it('el selector (/api/companies) solo muestra empresas con membresía ACTIVE', async () => {
    const mariaList = await authed(maria, { method: 'GET', url: '/api/companies' });
    const mariaIds = (mariaList.json().companies as Array<{ id: string }>).map((c) => c.id);
    expect(mariaIds).toEqual([companyMp]);

    const carlosList = await authed(carlos, { method: 'GET', url: '/api/companies' });
    const carlosIds = (carlosList.json().companies as Array<{ id: string }>).map((c) => c.id);
    expect(carlosIds).toEqual([companyJgv]);
  });

  it('deshabilitar la membresía bloquea esa empresa pero no las demás', async () => {
    const carlosId = carlos.userId;
    const membership = await db
      .selectFrom('company_memberships')
      .select(['id'])
      .where('user_id', '=', carlosId)
      .where('company_id', '=', companyJgv)
      .executeTakeFirstOrThrow();

    await setMembershipStatus(db, membership.id, 'DISABLED');

    const blocked = await authed(carlos, { method: 'GET', url: `/api/documents?company_id=${companyJgv}` });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('SIN_ACCESO');

    const list = await authed(carlos, { method: 'GET', url: '/api/companies' });
    expect(list.json().companies).toEqual([]);

    await setMembershipStatus(db, membership.id, 'ACTIVE');
    const restored = await authed(carlos, { method: 'GET', url: `/api/documents?company_id=${companyJgv}` });
    expect(restored.statusCode).toBe(200);
  });
});

describe('permisos por rol (RBAC)', () => {
  it('REPORT_IMPORTER puede leer documentos pero no escribir settings', async () => {
    const read = await authed(debil, { method: 'GET', url: `/api/documents?company_id=${companyMp}` });
    expect(read.statusCode).toBe(200);

    const write = await authed(debil, {
      method: 'PUT',
      url: '/api/settings',
      payload: { company_id: companyMp, scope: 'general', key: 'maintenance_mode', value: true },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe('PERMISO_INSUFICIENTE');
  });

  it('el mismo usuario tiene roles distintos por empresa (carlos solo JGV)', async () => {
    // ACCOUNTANT en JGV: resuelve incidencias.
    const res = await authed(carlos, {
      method: 'POST',
      url: `/api/issues/00000000-0000-4000-8000-000000000000/resolve`,
      payload: { company_id: companyJgv },
    });
    // Sin membresía en MP NET siempre es 403, con ella sería 404 (id inexistente).
    expect(res.statusCode).toBe(404);

    const cross = await authed(carlos, {
      method: 'POST',
      url: `/api/issues/00000000-0000-4000-8000-000000000000/resolve`,
      payload: { company_id: companyMp },
    });
    expect(cross.statusCode).toBe(403);
  });

  it('platform_admin sigue necesitando membresía para cada empresa', async () => {
    const cross = await authed(admin, { method: 'GET', url: `/api/documents?company_id=${companyJgv}` });
    expect(cross.statusCode).toBe(403);

    // Con membresía, además ignora los permisos del rol (REPORT_IMPORTER no escribe settings).
    const write = await authed(admin, {
      method: 'PUT',
      url: '/api/settings',
      payload: { company_id: companyMp, scope: 'general', key: 'maintenance_mode', value: false },
    });
    expect(write.statusCode).toBe(200);
  });
});

describe('usuario deshabilitado', () => {
  it('no puede iniciar sesión (403 CUENTA_INACTIVA)', async () => {
    const email = 'suspensa@local.test';
    await createUser(db, { email, password: PASSWORD });
    const user = await db
      .selectFrom('users')
      .select(['id'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    await setUserStatus(db, user.id, 'DISABLED');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: await csrfHeaders(),
      payload: { email, password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CUENTA_INACTIVA');
  });

  it('una sesión abierta deja de servir al deshabilitar la cuenta', async () => {
    const email = 'abierta@local.test';
    await createUser(db, { email, password: PASSWORD });
    const session = await login(app, email, PASSWORD);

    const before = await authed(session, { method: 'GET', url: '/api/me' });
    expect(before.statusCode).toBe(200);

    const user = await db
      .selectFrom('users')
      .select(['id'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    await setUserStatus(db, user.id, 'DISABLED');

    const after = await authed(session, { method: 'GET', url: '/api/me' });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('USUARIO_INACTIVO');

    await setUserStatus(db, user.id, 'ACTIVE');
  });
});

describe('CSRF en mutaciones autenticadas', () => {
  it('rechaza mutaciones sin token o con token equivocado', async () => {
    const noHeader = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie: maria.headers.cookie },
      payload: { company_id: companyMp, scope: 'general', key: 'maintenance_mode', value: true },
    });
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json().error.code).toBe('CSRF_INVALIDO');

    const wrongToken = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { ...maria.headers, 'x-csrf-token': 'token-falso-para-la-prueba' },
      payload: { company_id: companyMp, scope: 'general', key: 'maintenance_mode', value: true },
    });
    expect(wrongToken.statusCode).toBe(403);
    expect(wrongToken.json().error.code).toBe('CSRF_INVALIDO');
  });
});

describe('sesiones', () => {
  it('logout revoca la sesión y el refresh rota los tokens', async () => {
    const pre = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
    const preToken = pre.json().csrfToken as string;
    const preCookie = pre.cookies.find((c) => c.name === 'acc_csrf')?.value ?? preToken;

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: `acc_csrf=${preCookie}`, 'x-csrf-token': preToken },
      payload: { email: 'maria@mp.local', password: PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    const sessionCookie = loginRes.cookies.find((c) => c.name === 'acc_session')!.value;
    const refreshCookie = loginRes.cookies.find((c) => c.name === 'acc_refresh')!.value;
    const csrfToken = loginRes.json().csrfToken as string;

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `acc_session=${sessionCookie}; acc_csrf=${csrfToken}`, 'x-csrf-token': csrfToken },
    });
    expect(me.statusCode).toBe(200);

    // Refresco: rota session+refresh; el token viejo deja de servir.
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: {
        cookie: `acc_session=${sessionCookie}; acc_refresh=${refreshCookie}; acc_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
    });
    expect(refreshRes.statusCode).toBe(200);
    const newSession = refreshRes.cookies.find((c) => c.name === 'acc_session')!.value;
    expect(newSession).not.toBe(sessionCookie);

    const withOld = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `acc_session=${sessionCookie}` },
    });
    expect(withOld.statusCode).toBe(401);

    const withNew = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `acc_session=${newSession}; acc_csrf=${csrfToken}` },
    });
    expect(withNew.statusCode).toBe(200);

    const staleRefresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: {
        cookie: `acc_session=${newSession}; acc_refresh=${refreshCookie}; acc_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
    });
    expect(staleRefresh.statusCode).toBe(401);

    // Logout cierra la sesión vigente.
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: `acc_session=${newSession}; acc_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `acc_session=${newSession}` },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('cambiar la contraseña cierra las demás sesiones', async () => {
    const first = await login(app, 'carlos@jgv.local', PASSWORD);
    const second = await login(app, 'carlos@jgv.local', PASSWORD);

    const change = await authed(first, {
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { current_password: PASSWORD, new_password: 'Nueva-Clave-2026!' },
    });
    expect(change.statusCode).toBe(200);

    const kept = await authed(first, { method: 'GET', url: '/api/me' });
    expect(kept.statusCode).toBe(200);

    const revoked = await authed(second, { method: 'GET', url: '/api/me' });
    expect(revoked.statusCode).toBe(401);

    const oldPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: await csrfHeaders(),
      payload: { email: 'carlos@jgv.local', password: PASSWORD },
    });
    expect(oldPassword.statusCode).toBe(401);

    const newPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: await csrfHeaders(),
      payload: { email: 'carlos@jgv.local', password: 'Nueva-Clave-2026!' },
    });
    expect(newPassword.statusCode).toBe(200);

    // se restaura para los demás tests
    const back = await authed(first, {
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { current_password: 'Nueva-Clave-2026!', new_password: PASSWORD },
    });
    expect(back.statusCode).toBe(200);
  });

  it('rechaza cambiar a una contraseña que no cumple la política', async () => {
    const res = await authed(maria, {
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { current_password: PASSWORD, new_password: 'corta' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('POLITICA_PASSWORD');
  });
});

describe('step-up para operaciones de riesgo', () => {
  it('exige reautenticación reciente para escribir credenciales', async () => {
    // La sesión se identifica por id, no por user: se envejecen todas.
    const sessions = await db
      .selectFrom('user_sessions')
      .select(['id'])
      .where('user_id', '=', maria.userId)
      .where('revoked_at', 'is', null)
      .execute();
    for (const session of sessions) {
      await db
        .updateTable('user_sessions')
        .set({ last_auth_at: new Date(Date.now() - 30 * 60_000) })
        .where('id', '=', session.id)
        .execute();
    }

    const blocked = await authed(maria, {
      method: 'PUT',
      url: `/api/companies/${companyMp}/integrations/SIIGO`,
      payload: { enabled: true, credentials: { username: 'u@x.co', access_key: 'k-123456' } },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PASO_REQUERIDO');

    const stepUp = await authed(maria, {
      method: 'POST',
      url: '/api/auth/step-up',
      payload: { password: PASSWORD },
    });
    expect(stepUp.statusCode).toBe(200);

    const allowed = await authed(maria, {
      method: 'PUT',
      url: `/api/companies/${companyMp}/integrations/SIIGO`,
      payload: { enabled: true, credentials: { username: 'u@x.co', access_key: 'k-123456' } },
    });
    expect(allowed.statusCode).toBe(200);
  });
});

describe('auditoría atribuible', () => {
  it('los login registran usuario, ip y agente (sin secretos)', async () => {
    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'LOGIN')
      .orderBy('created_at', 'desc')
      .limit(5)
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.actor_user_id).not.toBeNull();
      expect(row.actor_type).toBe('USER');
      expect(JSON.stringify(row.metadata ?? {})).not.toContain(PASSWORD);
    }
  });

  it('las incidencias resueltas quedan firmadas por el usuario real', async () => {
    const inserted = await db
      .insertInto('validation_issues')
      .values({
        company_id: companyMp,
        import_id: null,
        document_id: null,
        rule_code: 'TU004',
        severity: 'WARNING',
        message: 'NIT inválido',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const res = await authed(maria, {
      method: 'POST',
      url: `/api/issues/${inserted.id}/resolve`,
      payload: { company_id: companyMp, resolved_by: 'spoof-intent' },
    });
    expect(res.statusCode).toBe(200);

    const issue = await db
      .selectFrom('validation_issues')
      .select(['resolved_by'])
      .where('id', '=', inserted.id)
      .executeTakeFirstOrThrow();
    // El resolved_by del cliente se ignora: manda la sesión.
    expect(issue.resolved_by).toBe(maria.userId);

    const auditRow = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('entity_type', '=', 'validation_issues')
      .where('entity_id', '=', inserted.id)
      .executeTakeFirstOrThrow();
    expect(auditRow.actor_user_id).toBe(maria.userId);
  });
});

/** Cookie + token de CSRF anónimos (previos a cualquier login). */
async function csrfHeaders(): Promise<Record<string, string>> {
  const res = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  const token = res.json().csrfToken as string;
  const cookie = res.cookies.find((c) => c.name === 'acc_csrf')?.value ?? token;
  return { cookie: `acc_csrf=${cookie}`, 'x-csrf-token': token };
}
