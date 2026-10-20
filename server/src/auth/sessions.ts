import type { Kysely } from 'kysely';
import type { Database, User, UserSession } from '../db/schema.js';
import { REFRESH_TTL_DAYS, SESSION_TTL_HOURS } from './constants.js';
import { randomToken, sha256 } from './tokens.js';

export interface IssuedSession {
  session: UserSession;
  sessionToken: string;
  refreshToken: string;
  csrfToken: string;
}

export async function createSession(
  db: Kysely<Database>,
  input: { userId: string; ip?: string | null; userAgent?: string | null },
): Promise<IssuedSession> {
  const sessionToken = randomToken();
  const refreshToken = randomToken();
  const csrfToken = randomToken();
  const now = Date.now();

  const session = await db
    .insertInto('user_sessions')
    .values({
      user_id: input.userId,
      session_token_hash: sha256(sessionToken),
      refresh_token_hash: sha256(refreshToken),
      csrf_token_hash: sha256(csrfToken),
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      expires_at: new Date(now + SESSION_TTL_HOURS * 3_600_000),
      refresh_expires_at: new Date(now + REFRESH_TTL_DAYS * 86_400_000),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { session, sessionToken, refreshToken, csrfToken };
}

export type SessionResolution =
  | { ok: true; session: UserSession; user: User }
  | {
      ok: false;
      code: 'NO_AUTENTICADO' | 'SESION_INVALIDA' | 'USUARIO_INACTIVO';
      message: string;
    };

export async function resolveSession(
  db: Kysely<Database>,
  token: string | undefined,
): Promise<SessionResolution> {
  if (!token) {
    return { ok: false, code: 'NO_AUTENTICADO', message: 'No hay sesión activa.' };
  }

  const session = await db
    .selectFrom('user_sessions')
    .selectAll()
    .where('session_token_hash', '=', sha256(token))
    .executeTakeFirst();

  if (!session) {
    return { ok: false, code: 'NO_AUTENTICADO', message: 'Sesión no reconocida.' };
  }
  if (session.revoked_at) {
    return { ok: false, code: 'SESION_INVALIDA', message: 'La sesión fue cerrada.' };
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    return { ok: false, code: 'SESION_INVALIDA', message: 'La sesión expiró.' };
  }

  const user = await db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', session.user_id)
    .executeTakeFirst();

  if (!user) {
    return { ok: false, code: 'NO_AUTENTICADO', message: 'Sesión no reconocida.' };
  }
  if (user.status !== 'ACTIVE') {
    return {
      ok: false,
      code: 'USUARIO_INACTIVO',
      message: 'La cuenta no está activa. Contacta al administrador.',
    };
  }

  return { ok: true, session, user };
}

/** Rotación de tokens de sesión/refresh. El token CSRF no rota en el refresh. */
export async function rotateSessionTokens(
  db: Kysely<Database>,
  session: UserSession,
): Promise<{ sessionToken: string; refreshToken: string }> {
  const sessionToken = randomToken();
  const refreshToken = randomToken();
  const now = Date.now();

  await db
    .updateTable('user_sessions')
    .set({
      session_token_hash: sha256(sessionToken),
      refresh_token_hash: sha256(refreshToken),
      expires_at: new Date(now + SESSION_TTL_HOURS * 3_600_000),
      refresh_expires_at: new Date(now + REFRESH_TTL_DAYS * 86_400_000),
      last_used_at: new Date(),
    })
    .where('id', '=', session.id)
    .execute();

  return { sessionToken, refreshToken };
}

/** Nuevo token CSRF: se entrega solo por respuesta JSON autenticada o cookie legible. */
export async function rotateCsrfToken(
  db: Kysely<Database>,
  session: UserSession,
): Promise<string> {
  const csrfToken = randomToken();
  await db
    .updateTable('user_sessions')
    .set({ csrf_token_hash: sha256(csrfToken) })
    .where('id', '=', session.id)
    .execute();
  return csrfToken;
}

export function verifyCsrf(session: UserSession, token: unknown): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  return sha256(token) === session.csrf_token_hash;
}

export async function revokeSession(
  db: Kysely<Database>,
  sessionId: string,
  reason: string,
): Promise<void> {
  await db
    .updateTable('user_sessions')
    .set({ revoked_at: new Date(), revoked_reason: reason })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .execute();
}

/** Cambio de contraseña / revocación global: cierra sesiones del usuario. */
export async function revokeUserSessions(
  db: Kysely<Database>,
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<void> {
  let query = db
    .updateTable('user_sessions')
    .set({ revoked_at: new Date(), revoked_reason: reason })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null);
  if (exceptSessionId) query = query.where('id', '!=', exceptSessionId);
  await query.execute();
}

/** Evita una escritura por request: solo refresca last_used_at si tiene >60s. */
export async function touchSession(db: Kysely<Database>, session: UserSession): Promise<void> {
  if (Date.now() - new Date(session.last_used_at).getTime() < 60_000) return;
  await db
    .updateTable('user_sessions')
    .set({ last_used_at: new Date() })
    .where('id', '=', session.id)
    .execute();
}

/** Valida el cookie de refresh y devuelve la sesión vigente (para rotarla). */
export async function validateRefreshToken(
  db: Kysely<Database>,
  refreshToken: string | undefined,
): Promise<{ session: UserSession; user: User } | null> {
  if (!refreshToken) return null;
  const session = await db
    .selectFrom('user_sessions')
    .selectAll()
    .where('refresh_token_hash', '=', sha256(refreshToken))
    .executeTakeFirst();
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.refresh_expires_at).getTime() <= Date.now()) return null;

  const user = await db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', session.user_id)
    .executeTakeFirst();
  if (!user || user.status !== 'ACTIVE') return null;

  return { session, user };
}
