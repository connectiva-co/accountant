import type { Kysely } from 'kysely';
import type { Database, User } from '../db/schema.js';
import { LOGIN_LOCK_MIN, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MIN } from './constants.js';

export interface AttemptInput {
  email: string;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  success: boolean;
  failureReason?: string | null;
}

export async function recordAttempt(db: Kysely<Database>, input: AttemptInput): Promise<void> {
  await db
    .insertInto('login_attempts')
    .values({
      email: input.email,
      user_id: input.userId ?? null,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      success: input.success,
      failure_reason: input.failureReason ?? null,
    })
    .execute();
}

/** Bloqueo por fuerza bruta: N fallos en la ventana => locked_until. */
export async function registerFailure(
  db: Kysely<Database>,
  input: AttemptInput & { userId: string },
): Promise<void> {
  await recordAttempt(db, input);

  const since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60_000);
  const recent = await db
    .selectFrom('login_attempts')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('user_id', '=', input.userId)
    .where('success', '=', false)
    .where('created_at', '>', since)
    .executeTakeFirst();

  const failures = Number(recent?.count ?? 0);
  if (failures >= LOGIN_MAX_ATTEMPTS) {
    await db
      .updateTable('users')
      .set({
        failed_attempts: failures,
        locked_until: new Date(Date.now() + LOGIN_LOCK_MIN * 60_000),
      })
      .where('id', '=', input.userId)
      .execute();
  } else {
    await db
      .updateTable('users')
      .set({ failed_attempts: failures })
      .where('id', '=', input.userId)
      .execute();
  }
}

export async function registerSuccess(
  db: Kysely<Database>,
  user: User,
  input: Omit<AttemptInput, 'email' | 'userId' | 'success'>,
): Promise<void> {
  await recordAttempt(db, {
    email: user.email,
    userId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
    success: true,
  });
  await db
    .updateTable('users')
    .set({
      failed_attempts: 0,
      locked_until: null,
      last_login_at: new Date(),
      last_login_ip: input.ip ?? null,
    })
    .where('id', '=', user.id)
    .execute();
}

/** locked_until vigente, o null si no está bloqueada (limpiando bloqueos vencidos). */
export async function activeLock(
  db: Kysely<Database>,
  user: Pick<User, 'id' | 'locked_until'>,
): Promise<Date | null> {
  if (!user.locked_until) return null;
  const until = new Date(user.locked_until).getTime();
  if (until > Date.now()) return new Date(until);
  await db
    .updateTable('users')
    .set({ locked_until: null, failed_attempts: 0 })
    .where('id', '=', user.id)
    .execute();
  return null;
}
