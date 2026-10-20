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
  type AuthedSession,
} from '../helpers/auth.js';

/**
 * Fase 3: administración de usuarios, memberships, roles, permisos y sesiones.
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
let ownerJgv: AuthedSession; // OWNER solo en JGV
let carlos: AuthedSession; // ACCOUNTANT solo en JGV
let debil: AuthedSession; // REPORT_IMPORTER solo en MP NET (se reloguea tras disable)
let juana: AuthedSession; // creada por OWNER, contraseña temporal de creación

let juanaId: string;
let debilId: string;
let creationTemp: string;

const authed = (session: AuthedSession, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject({ ...opts, headers: { ...session.headers, ...(opts.headers ?? {}) } });

const q = (companyId: string) => ({ company_id: companyId });

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

  const ownerJgvId = await createUser(db, { email: 'owner@jgv.local', password: PASSWORD, fullName: 'Óscar JGV' });
  await grantMembership(db, { companyId: companyJgv, userId: ownerJgvId, roleCode: 'OWNER' });

  debilId = await createUser(db, { email: 'debil@mp.local', password: PASSWORD, fullName: 'Debil Rol' });
  await grantMembership(db, { companyId: companyMp, userId: debilId, roleCode: 'REPORT_IMPORTER' });

  const carlosId = await createUser(db, { email: 'carlos@jgv.local', password: PASSWORD, fullName: 'Carlos Gómez' });
  await grantMembership(db, { companyId: companyJgv, userId: carlosId, roleCode: 'ACCOUNTANT' });

  maria = await login(app, 'maria@mp.local', PASSWORD);
  ownerJgv = await login(app, 'owner@jgv.local', PASSWORD);
  debil = await login(app, 'debil@mp.local', PASSWORD);
  carlos = await login(app, 'carlos@jgv.local', PASSWORD);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await db?.destroy();
  await pool?.end();
});

describe('listado y creación de usuarios', () => {
  it('exige sesión (401) y membresía de la empresa (403)', async () => {
    const sinSesion = await app.inject({ method: 'GET', url: `/api/users?${new URLSearchParams(q(companyMp))}` });
    expect(sinSesion.statusCode).toBe(401);

    const ajena = await authed(maria, { method: 'GET', url: `/api/users?${new URLSearchParams(q(companyJgv))}` });
    expect(ajena.statusCode).toBe(403);
    expect(ajena.json().error.code).toBe('SIN_ACCESO');
  });

  it('REPORT_IMPORTER no tiene users.read', async () => {
    const res = await authed(debil, { method: 'GET', url: `/api/users?${new URLSearchParams(q(companyMp))}` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISO_INSUFICIENTE');
  });

  it('OWNER lista los usuarios de su empresa', async () => {
    const res = await authed(maria, { method: 'GET', url: `/api/users?${new URLSearchParams(q(companyMp))}` });
    expect(res.statusCode).toBe(200);
    const users = res.json().users as Array<{ email: string; roles: string[] }>;
    expect(users.map((u) => u.email).sort()).toEqual(['debil@mp.local', 'maria@mp.local']);
    const mariaRow = users.find((u) => u.email === 'maria@mp.local');
    expect(mariaRow?.roles).toContain('OWNER');
  });

  it('crea un usuario con contraseña temporal de un solo uso', async () => {
    const res = await authed(maria, {
      method: 'POST',
      url: `/api/users?${new URLSearchParams(q(companyMp))}`,
      payload: { email: 'juana@mp.local', full_name: 'Juana López' },
    });
    expect([200, 201]).toContain(res.statusCode);
    creationTemp = res.json().temporary_password as string;
    expect(creationTemp).toMatch(/^Acc-/);
    juanaId = res.json().user.id as string;

    const lista = await authed(maria, { method: 'GET', url: `/api/users?${new URLSearchParams(q(companyMp))}` });
    const users = lista.json().users as Array<{ email: string; must_change_password: boolean }>;
    const juanaRow = users.find((u) => u.email === 'juana@mp.local');
    expect(juanaRow).toBeTruthy();
    expect(juanaRow?.must_change_password).toBe(true);
  });

  it('la contraseña temporal de creación permite el primer inicio', async () => {
    juana = await login(app, 'juana@mp.local', creationTemp);
    const me = await authed(juana, { method: 'GET', url: '/api/me' });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.must_change_password).toBe(true);
  });

  it('rechaza correo duplicado y política de contraseña débil', async () => {
    const dup = await authed(maria, {
      method: 'POST',
      url: `/api/users?${new URLSearchParams(q(companyMp))}`,
      payload: { email: 'DEBIL@mp.local', full_name: 'Otra Persona' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('EXISTE');

    const debilPerm = await authed(debil, {
      method: 'POST',
      url: `/api/users?${new URLSearchParams(q(companyMp))}`,
      payload: { email: 'nuevo@mp.local', full_name: 'Nuevo' },
    });
    expect(debilPerm.statusCode).toBe(403);

    const corta = await authed(maria, {
      method: 'POST',
      url: `/api/users?${new URLSearchParams(q(companyMp))}`,
      payload: { email: 'corta@mp.local', full_name: 'Corta Clave', password: 'corta' },
    });
    expect(corta.statusCode).toBe(422);
    expect(corta.json().error.code).toBe('POLITICA_PASSWORD');
  });

  it('GET /api/users/:id valida existencia y pertenencia a la empresa', async () => {
    const desconocido = await authed(maria, {
      method: 'GET',
      url: `/api/users/00000000-0000-4000-8000-000000000000?${new URLSearchParams(q(companyMp))}`,
    });
    expect(desconocido.statusCode).toBe(404);

    // ownerJgv solo administra JGV: ver a juana (solo en MP) desde JGV → 403.
    const ajeno = await authed(ownerJgv, {
      method: 'GET',
      url: `/api/users/${juanaId}?${new URLSearchParams(q(companyJgv))}`,
    });
    expect(ajeno.statusCode).toBe(403);
    expect(ajeno.json().error.code).toBe('SIN_ACCESO');
  });

  it('PUT actualiza el nombre y deja rastro en auditoría', async () => {
    const res = await authed(maria, {
      method: 'PUT',
      url: `/api/users/${juanaId}?${new URLSearchParams(q(companyMp))}`,
      payload: { full_name: 'Juana López Restrepo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.full_name).toBe('Juana López Restrepo');

    const audit = await db
      .selectFrom('audit_log')
      .select(['action'])
      .where('action', '=', 'USER_UPDATED')
      .where('entity_id', '=', juanaId)
      .executeTakeFirst();
    expect(audit).toBeTruthy();
  });
});

describe('reset de contraseña', () => {
  let tempPassword: string;

  it('genera contraseña temporal, invalida la anterior y cierra sesiones', async () => {
    const res = await authed(maria, {
      method: 'POST',
      url: `/api/users/${juanaId}/reset-password?${new URLSearchParams(q(companyMp))}`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    tempPassword = res.json().temporary_password as string;
    expect(tempPassword).toMatch(/^Acc-/);
    expect(tempPassword).not.toBe(creationTemp);

    // La sesión previa quedó revocada.
    const sesionVieja = await authed(juana, { method: 'GET', url: '/api/me' });
    expect(sesionVieja.statusCode).toBe(401);

    // La contraseña de creación ya no sirve.
    const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
    const preToken = csrf.json().csrfToken as string;
    const preCookie = csrf.cookies.find((c) => c.name === 'acc_csrf')?.value ?? preToken;
    const loginFallido = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: `acc_csrf=${preCookie}`, 'x-csrf-token': preToken },
      payload: { email: 'juana@mp.local', password: creationTemp },
    });
    expect(loginFallido.statusCode).toBe(401);
    expect(loginFallido.json().error.code).toBe('CREDENCIALES_INVALIDAS');
  });

  it('la temporal permite iniciar sesión con must_change_password', async () => {
    juana = await login(app, 'juana@mp.local', tempPassword);
    const me = await authed(juana, { method: 'GET', url: '/api/me' });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.must_change_password).toBe(true);

    const audit = await db
      .selectFrom('audit_log')
      .select(['action'])
      .where('action', '=', 'PASSWORD_RESET_REQUESTED')
      .where('entity_id', '=', juanaId)
      .executeTakeFirst();
    expect(audit).toBeTruthy();
  });

  it('REPORT_IMPORTER no puede restablecer contraseñas', async () => {
    const res = await authed(debil, {
      method: 'POST',
      url: `/api/users/${debilId}/reset-password?${new URLSearchParams(q(companyMp))}`,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('deshabilitar y reactivar usuarios', () => {
  it('ACCOUNTANT no tiene users.disable', async () => {
    const res = await authed(carlos, {
      method: 'POST',
      url: `/api/users/${ownerJgv.userId}/disable?${new URLSearchParams(q(companyJgv))}`,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('deshabilita una cuenta, cierra sesiones y bloquea el login', async () => {
    const res = await authed(maria, {
      method: 'POST',
      url: `/api/users/${debilId}/disable?${new URLSearchParams(q(companyMp))}`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.status).toBe('DISABLED');

    const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
    const preToken = csrf.json().csrfToken as string;
    const preCookie = csrf.cookies.find((c) => c.name === 'acc_csrf')?.value ?? preToken;
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: `acc_csrf=${preCookie}`, 'x-csrf-token': preToken },
      payload: { email: 'debil@mp.local', password: PASSWORD },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('CUENTA_INACTIVA');
  });

  it('no permite deshabilitar al último OWNER de una empresa', async () => {
    const res = await authed(maria, {
      method: 'POST',
      url: `/api/users/${maria.userId}/disable?${new URLSearchParams(q(companyMp))}`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ULTIMO_OWNER');
  });

  it('reactiva la cuenta y limpia intentos', async () => {
    const res = await authed(maria, {
      method: 'POST',
      url: `/api/users/${debilId}/reactivate?${new URLSearchParams(q(companyMp))}`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.status).toBe('ACTIVE');

    // Las sesiones se habían revocado al deshabilitar: vuelve a iniciar sesión.
    debil = await login(app, 'debil@mp.local', PASSWORD);

    const audit = await db
      .selectFrom('audit_log')
      .select(['action'])
      .where('action', '=', 'USER_DISABLED')
      .executeTakeFirst();
    expect(audit).toBeTruthy();
  });
});

describe('memberships por empresa', () => {
  it('asigna una empresa a un usuario existente', async () => {
    const res = await authed(ownerJgv, {
      method: 'POST',
      url: `/api/users/${juanaId}/companies/${companyJgv}`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const me = await authed(juana, { method: 'GET', url: '/api/me' });
    const ids = (me.json().companies as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(companyJgv);
    expect(ids).toContain(companyMp);
  });

  it('quitar el acceso surte efecto inmediato en /api/me', async () => {
    const res = await authed(ownerJgv, {
      method: 'POST',
      url: `/api/users/${juanaId}/companies/${companyJgv}/disable`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const me = await authed(juana, { method: 'GET', url: '/api/me' });
    const ids = (me.json().companies as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(companyJgv);
    expect(ids).toContain(companyMp);
  });

  it('el acceso se puede reactivar', async () => {
    const res = await authed(ownerJgv, {
      method: 'POST',
      url: `/api/users/${juanaId}/companies/${companyJgv}/reactivate`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const me = await authed(juana, { method: 'GET', url: '/api/me' });
    expect((me.json().companies as Array<{ id: string }>).map((c) => c.id)).toContain(companyJgv);
  });

  it('no se puede quitar la empresa al último OWNER', async () => {
    const res = await authed(ownerJgv, {
      method: 'POST',
      url: `/api/users/${ownerJgv.userId}/companies/${companyJgv}/disable`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ULTIMO_OWNER');
  });

  it('un usuario sin autoridad en la empresa destino no puede asignar', async () => {
    const res = await authed(debil, {
      method: 'POST',
      url: `/api/users/${debilId}/companies/${companyJgv}`,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('SIN_ACCESO');
  });
});

describe('empresas administrables', () => {
  it('solo devuelve empresas donde el actor tiene users.company.assign', async () => {
    const deMaria = await authed(maria, { method: 'GET', url: '/api/admin/companies' });
    expect(deMaria.statusCode).toBe(200);
    expect((deMaria.json().companies as Array<{ id: string }>).map((c) => c.id)).toEqual([companyMp]);

    const deOwnerJgv = await authed(ownerJgv, { method: 'GET', url: '/api/admin/companies' });
    expect((deOwnerJgv.json().companies as Array<{ id: string }>).map((c) => c.id)).toEqual([companyJgv]);

    const deCarlos = await authed(carlos, { method: 'GET', url: '/api/admin/companies' });
    expect(deCarlos.json().companies).toEqual([]);
  });

  it('GET /api/users/:id/companies solo lista empresas administradas por el actor', async () => {
    // juana pertenece a MP y JGV; maria solo administra MP.
    const res = await authed(maria, { method: 'GET', url: `/api/users/${juanaId}/companies` });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().companies as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toEqual([companyMp]);
  });
});

describe('roles y permisos', () => {
  let roleId: string;

  it('lista roles preset del sistema', async () => {
    const res = await authed(maria, { method: 'GET', url: `/api/companies/${companyMp}/roles` });
    expect(res.statusCode).toBe(200);
    const roles = res.json().roles as Array<{ code: string; is_system: boolean }>;
    expect(roles.length).toBeGreaterThanOrEqual(6);
    expect(roles.filter((r) => r.is_system).length).toBeGreaterThanOrEqual(6);
    expect(roles.find((r) => r.code === 'OWNER')?.is_system).toBe(true);
  });

  it('crea un rol personalizado con permisos', async () => {
    const res = await authed(maria, {
      method: 'POST',
      url: `/api/companies/${companyMp}/roles`,
      payload: { name: 'Gestor de acceso', description: 'Administra usuarios', permissions: ['users.read', 'sessions.read'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role.code).toBe('GESTOR_DE_ACCESO');
    expect(res.json().role.permissions.sort()).toEqual(['sessions.read', 'users.read']);
    roleId = res.json().role.id as string;

    const audit = await db
      .selectFrom('audit_log')
      .select(['action'])
      .where('action', '=', 'ROLE_CREATED')
      .executeTakeFirst();
    expect(audit).toBeTruthy();
  });

  it('rechaza nombres duplicados, permisos desconocidos y edición de roles del sistema', async () => {
    const dup = await authed(maria, {
      method: 'POST',
      url: `/api/companies/${companyMp}/roles`,
      payload: { name: 'gestor de acceso', permissions: ['users.read'] },
    });
    expect(dup.statusCode).toBe(409);

    const invalido = await authed(maria, {
      method: 'POST',
      url: `/api/companies/${companyMp}/roles`,
      payload: { name: 'Rol inválido', permissions: ['no.existe'] },
    });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json().error.code).toBe('PERMISO_INVALIDO');

    const ownerRole = await authed(maria, { method: 'GET', url: `/api/companies/${companyMp}/roles` });
    const owner = (ownerRole.json().roles as Array<{ id: string; code: string }>).find((r) => r.code === 'OWNER');
    const sistema = await authed(maria, {
      method: 'PUT',
      url: `/api/companies/${companyMp}/roles/${owner?.id}`,
      payload: { name: 'Owner editado', permissions: ['users.read'] },
    });
    expect(sistema.statusCode).toBe(403);
    expect(sistema.json().error.code).toBe('ROL_NO_EDITABLE');
  });

  it('actualiza permisos de un rol personalizado', async () => {
    const res = await authed(maria, {
      method: 'PUT',
      url: `/api/companies/${companyMp}/roles/${roleId}`,
      payload: { name: 'Gestor de acceso', description: 'Administra usuarios', permissions: ['users.read'] },
    });
    expect(res.statusCode).toBe(200);

    const lista = await authed(maria, { method: 'GET', url: `/api/companies/${companyMp}/roles` });
    const rol = (lista.json().roles as Array<{ id: string; permissions: string[] }>).find((r) => r.id === roleId);
    expect(rol?.permissions).toEqual(['users.read']);
  });

  it('asignar y quitar roles surte efecto inmediato en los permisos', async () => {
    const asignar = await authed(maria, {
      method: 'POST',
      url: `/api/companies/${companyMp}/users/${debilId}/roles/${roleId}`,
      payload: {},
    });
    expect(asignar.statusCode).toBe(200);

    // debil pasa a tener users.read vía el rol personalizado.
    const ahoraPuede = await authed(debil, { method: 'GET', url: `/api/users?${new URLSearchParams(q(companyMp))}` });
    expect(ahoraPuede.statusCode).toBe(200);

    const quitar = await authed(maria, {
      method: 'DELETE',
      url: `/api/companies/${companyMp}/users/${debilId}/roles/${roleId}`,
    });
    expect(quitar.statusCode).toBe(200);

    const yaNo = await authed(debil, { method: 'GET', url: `/api/users?${new URLSearchParams(q(companyMp))}` });
    expect(yaNo.statusCode).toBe(403);
  });

  it('asignar OWNER exige users.roles.assign_owner (sin escalada de privilegios)', async () => {
    // Rol con users.roles.assign pero SIN assign_owner.
    const gestor = await authed(maria, {
      method: 'POST',
      url: `/api/companies/${companyMp}/roles`,
      payload: { name: 'Coordinador', permissions: ['users.read', 'users.roles.assign', 'users.company.assign'] },
    });
    expect(gestor.statusCode).toBe(200);
    const gestorId = gestor.json().role.id as string;

    const asignarGestor = await authed(maria, {
      method: 'POST',
      url: `/api/companies/${companyMp}/users/${juanaId}/roles/${gestorId}`,
      payload: {},
    });
    expect(asignarGestor.statusCode).toBe(200);

    const ownerRole = await authed(maria, { method: 'GET', url: `/api/companies/${companyMp}/roles` });
    const owner = (ownerRole.json().roles as Array<{ id: string; code: string }>).find((r) => r.code === 'OWNER');

    // juana (Coordinador, sin assign_owner) intenta hacer OWNER a debil.
    const intento = await authed(juana, {
      method: 'POST',
      url: `/api/companies/${companyMp}/users/${debilId}/roles/${owner?.id}`,
      payload: {},
    });
    expect(intento.statusCode).toBe(403);
    expect(intento.json().error.code).toBe('PERMISO_INSUFICIENTE');

    // maria (OWNER con assign_owner) sí puede.
    const ok = await authed(maria, {
      method: 'POST',
      url: `/api/companies/${companyMp}/users/${debilId}/roles/${owner?.id}`,
      payload: {},
    });
    expect(ok.statusCode).toBe(200);
  });

  it('no permite quitar el rol OWNER al último OWNER', async () => {
    const lista = await authed(maria, { method: 'GET', url: `/api/companies/${companyMp}/roles` });
    const owner = (lista.json().roles as Array<{ id: string; code: string }>).find((r) => r.code === 'OWNER');

    // debil sigue siendo OWNER del paso anterior: primero se le quita.
    const quitarDebil = await authed(maria, {
      method: 'DELETE',
      url: `/api/companies/${companyMp}/users/${debilId}/roles/${owner?.id}`,
    });
    expect(quitarDebil.statusCode).toBe(200);

    const res = await authed(maria, {
      method: 'DELETE',
      url: `/api/companies/${companyMp}/users/${maria.userId}/roles/${owner?.id}`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ULTIMO_OWNER');
  });
});

describe('sesiones de usuarios', () => {
  it('sin sessions.read no se listan; con permiso sí', async () => {
    const sinPermiso = await authed(carlos, {
      method: 'GET',
      url: `/api/users/${ownerJgv.userId}/sessions?${new URLSearchParams(q(companyJgv))}`,
    });
    expect(sinPermiso.statusCode).toBe(403);

    const conPermiso = await authed(maria, {
      method: 'GET',
      url: `/api/users/${juanaId}/sessions?${new URLSearchParams(q(companyMp))}`,
    });
    expect(conPermiso.statusCode).toBe(200);
    expect((conPermiso.json().sessions as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('revoke-all cierra todas las sesiones del usuario', async () => {
    const res = await authed(maria, {
      method: 'POST',
      url: `/api/users/${juanaId}/sessions/revoke-all?${new URLSearchParams(q(companyMp))}`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const posterior = await authed(juana, { method: 'GET', url: '/api/me' });
    expect(posterior.statusCode).toBe(401);

    const audit = await db
      .selectFrom('audit_log')
      .select(['action'])
      .where('action', '=', 'SESSIONS_REVOKED')
      .executeTakeFirst();
    expect(audit).toBeTruthy();
  });
});

describe('2FA (documentado, Fase 4)', () => {
  it('las acciones MFA responden 501 hasta la Fase 4', async () => {
    for (const action of ['require', 'reset']) {
      const res = await authed(maria, {
        method: 'POST',
        url: `/api/users/${juanaId}/mfa/${action}?${new URLSearchParams(q(companyMp))}`,
        payload: {},
      });
      expect(res.statusCode, action).toBe(501);
      expect(res.json().error.code, action).toBe('MFA_NO_DISPONIBLE');
    }
  });
});
