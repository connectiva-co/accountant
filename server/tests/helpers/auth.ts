import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/db/schema.js';
import { hashPassword } from '../../src/auth/passwords.js';
import { grantMembership } from '../../src/auth/memberships.js';
import { invalidateAccess } from '../../src/auth/permissions.js';

export interface AuthedSession {
  /** Headers cookie + CSRF listos para app.inject. */
  headers: Record<string, string>;
  csrfToken: string;
  userId: string;
}

/** Crea un usuario ACTIVE con la contraseña dada. */
export async function createUser(
  db: Kysely<Database>,
  input: { email: string; password: string; platformAdmin?: boolean; fullName?: string },
): Promise<string> {
  const row = await db
    .insertInto('users')
    .values({
      email: input.email,
      full_name: input.fullName ?? input.email.split('@')[0],
      password_hash: await hashPassword(input.password),
      status: 'ACTIVE',
      platform_admin: input.platformAdmin ?? false,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function setUserStatus(
  db: Kysely<Database>,
  userId: string,
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED' | 'LOCKED',
): Promise<void> {
  await db.updateTable('users').set({ status }).where('id', '=', userId).execute();
}

export async function setMembershipStatus(
  db: Kysely<Database>,
  membershipId: string,
  status: 'INVITED' | 'ACTIVE' | 'DISABLED',
): Promise<void> {
  await db
    .updateTable('company_memberships')
    .set({ status, ...(status === 'DISABLED' ? { disabled_at: new Date() } : {}) })
    .where('id', '=', membershipId)
    .execute();
  invalidateAccess();
}

export { grantMembership };

/**
 * Login completo respetando el doble submit de CSRF previo al login:
 * GET /api/auth/csrf -> POST /api/auth/login -> GET /api/me (que rota el CSRF
 * de la sesión) -> headers vigentes.
 */
export async function login(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<AuthedSession> {
  const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  if (csrfRes.statusCode !== 200) throw new Error(`GET /api/auth/csrf => ${csrfRes.statusCode}`);
  const preToken = csrfRes.json().csrfToken as string;
  const preCookie = csrfRes.cookies.find((c) => c.name === 'acc_csrf')?.value ?? preToken;

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { cookie: `acc_csrf=${preCookie}`, 'x-csrf-token': preToken },
    payload: { email, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login ${email} => ${res.statusCode}: ${res.body}`);
  }

  const sessionCookie = res.cookies.find((c) => c.name === 'acc_session')?.value;
  if (!sessionCookie) throw new Error('El login no devolvió acc_session.');

  // /api/me rota el token CSRF de la sesión: el vigente es el que devuelve.
  const me = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { cookie: `acc_session=${sessionCookie}` },
  });
  if (me.statusCode !== 200) throw new Error(`GET /api/me => ${me.statusCode}: ${me.body}`);

  const csrfToken = me.json().csrfToken as string;
  const csrfCookie = me.cookies.find((c) => c.name === 'acc_csrf')?.value ?? csrfToken;

  return {
    headers: {
      cookie: `acc_session=${sessionCookie}; acc_csrf=${csrfCookie}`,
      'x-csrf-token': csrfToken,
    },
    csrfToken,
    userId: me.json().user.id as string,
  };
}

/** app.inject con los headers de sesión añadidos (los explícitos mandan). */
export function withAuth(
  app: FastifyInstance,
  headers: Record<string, string>,
  opts: InjectOptions,
): Promise<LightMyRequestResponse> {
  return app.inject({ ...opts, headers: { ...headers, ...(opts.headers ?? {}) } });
}
