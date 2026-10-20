import type { Kysely } from 'kysely';
import { HttpError } from '../api/errors.js';
import type { Database, Json, User } from '../db/schema.js';
import { activeLock, recordAttempt, registerFailure, registerSuccess } from './attempts.js';
import {
  REFRESH_TTL_DAYS,
  SESSION_TTL_HOURS,
  STEP_UP_WINDOW_MIN,
} from './constants.js';
import { assertPasswordPolicy, PasswordPolicyError, hashPassword, verifyPassword, verifyAgainstDummy } from './passwords.js';
import {
  createSession,
  revokeSession,
  revokeUserSessions,
  rotateSessionTokens,
  validateRefreshToken,
} from './sessions.js';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginResult {
  user: User;
  sessionToken: string;
  refreshToken: string;
  csrfToken: string;
}

export async function audit(
  db: Kysely<Database>,
  entry: {
    companyId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    userId: string | null;
    before?: Json | null;
    after?: Json | null;
    metadata?: Json;
    ip?: string | null;
    userAgent?: string | null;
    targetUserId?: string | null;
  },
): Promise<void> {
  await db
    .insertInto('audit_log')
    .values({
      company_id: entry.companyId ?? null,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      actor_type: entry.userId ? 'USER' : 'SYSTEM',
      actor_id: entry.userId,
      actor_user_id: entry.userId,
      target_user_id: entry.targetUserId ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      metadata: (entry.metadata ?? {}) as Json,
    })
    .execute();
}

async function findUserByEmail(db: Kysely<Database>, email: string): Promise<User | undefined> {
  return db
    .selectFrom('users')
    .selectAll()
    .where((eb) => eb.fn('lower', ['email']), '=', email.toLowerCase())
    .executeTakeFirst();
}

export async function login(
  db: Kysely<Database>,
  input: { email: string; password: string },
  meta: RequestMeta = {},
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const user = await findUserByEmail(db, email);

  if (!user) {
    await verifyAgainstDummy(input.password);
    await recordAttempt(db, {
      email,
      ip: meta.ip,
      userAgent: meta.userAgent,
      success: false,
      failureReason: 'USUARIO_NO_EXISTE',
    });
    throw new HttpError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.');
  }

  const lockedUntil = await activeLock(db, user);
  if (lockedUntil) {
    await recordAttempt(db, {
      email,
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      success: false,
      failureReason: 'BLOQUEADO',
    });
    throw new HttpError(
      429,
      'CUENTA_BLOQUEADA',
      `Demasiados intentos. Intenta de nuevo después de ${lockedUntil.toISOString()}.`,
    );
  }

  if (user.status !== 'ACTIVE') {
    await recordAttempt(db, {
      email,
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      success: false,
      failureReason: 'CUENTA_INACTIVA',
    });
    throw new HttpError(403, 'CUENTA_INACTIVA', 'La cuenta no está activa. Contacta al administrador.');
  }

  const ok = await verifyPassword(user.password_hash, input.password);
  if (!ok) {
    await registerFailure(db, {
      email,
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      success: false,
      failureReason: 'PASSWORD_INVALIDA',
    });
    throw new HttpError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.');
  }

  await registerSuccess(db, user, { ip: meta.ip, userAgent: meta.userAgent });

  const issued = await createSession(db, {
    userId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  await audit(db, {
    entityType: 'users',
    entityId: user.id,
    action: 'LOGIN',
    userId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    after: { email: user.email } as Json,
  });

  return {
    user,
    sessionToken: issued.sessionToken,
    refreshToken: issued.refreshToken,
    csrfToken: issued.csrfToken,
  };
}

export async function logout(
  db: Kysely<Database>,
  session: { id: string; user_id: string },
  meta: RequestMeta = {},
): Promise<void> {
  await revokeSession(db, session.id, 'LOGOUT');
  await audit(db, {
    entityType: 'users',
    entityId: session.user_id,
    action: 'SESSION_REVOKED',
    userId: session.user_id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    metadata: { reason: 'LOGOUT', session_id: session.id } as Json,
  });
}

export async function refresh(
  db: Kysely<Database>,
  refreshToken: string | undefined,
): Promise<{ sessionToken: string; refreshToken: string }> {
  const valid = await validateRefreshToken(db, refreshToken);
  if (!valid) {
    throw new HttpError(401, 'SESION_INVALIDA', 'Sesión de refresco inválida.');
  }
  return rotateSessionTokens(db, valid.session);
}

export async function changePassword(
  db: Kysely<Database>,
  user: User,
  input: { currentPassword: string; newPassword: string },
  meta: RequestMeta & { sessionId: string },
): Promise<void> {
  const ok = await verifyPassword(user.password_hash, input.currentPassword);
  if (!ok) {
    throw new HttpError(401, 'CREDENCIALES_INVALIDAS', 'La contraseña actual no es correcta.');
  }

  try {
    assertPasswordPolicy(input.newPassword);
  } catch (error) {
    if (error instanceof PasswordPolicyError) {
      throw new HttpError(422, 'POLITICA_PASSWORD', error.message);
    }
    throw error;
  }

  if (await verifyPassword(user.password_hash, input.newPassword)) {
    throw new HttpError(422, 'POLITICA_PASSWORD', 'La nueva contraseña debe ser distinta a la actual.');
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db
    .updateTable('users')
    .set({ password_hash: passwordHash, must_change_password: false })
    .where('id', '=', user.id)
    .execute();

  // El cambio de contraseña cierra el resto de sesiones (la actual sobrevive).
  await revokeUserSessions(db, user.id, 'PASSWORD_CHANGED', meta.sessionId);

  await audit(db, {
    entityType: 'users',
    entityId: user.id,
    action: 'PASSWORD_CHANGED',
    userId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    targetUserId: user.id,
  });
}

/** Reautenticación: confirma la contraseña y reactiva la ventana de step-up. */
export async function stepUp(
  db: Kysely<Database>,
  user: User,
  input: { password: string },
  meta: RequestMeta & { sessionId: string },
): Promise<void> {
  const ok = await verifyPassword(user.password_hash, input.password);
  if (!ok) {
    throw new HttpError(401, 'CREDENCIALES_INVALIDAS', 'La contraseña no es correcta.');
  }
  await db
    .updateTable('user_sessions')
    .set({ last_auth_at: new Date() })
    .where('id', '=', meta.sessionId)
    .execute();

  await audit(db, {
    entityType: 'users',
    entityId: user.id,
    action: 'LOGIN',
    userId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    metadata: { kind: 'step-up', window_min: STEP_UP_WINDOW_MIN } as Json,
  });
}

export const sessionTtlSec = SESSION_TTL_HOURS * 3_600;
export const refreshTtlSec = REFRESH_TTL_DAYS * 86_400;
