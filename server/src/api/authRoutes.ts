import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import { HttpError } from './errors.js';
import type { Database, User } from '../db/schema.js';
import type { Guards } from '../auth/guards.js';
import { clearSessionCookies, setSessionCookies } from '../auth/guards.js';
import { CSRF_COOKIE, REFRESH_TTL_DAYS, SESSION_TTL_HOURS } from '../auth/constants.js';
import { randomToken, sha256 } from '../auth/tokens.js';
import {
  changePassword,
  login,
  logout,
  refresh,
  stepUp,
} from '../auth/service.js';
import {
  listMemberCompanies,
  resolveCompanyAccess,
} from '../auth/permissions.js';
import { rotateCsrfToken } from '../auth/sessions.js';

const loginBody = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(512),
});

const changePasswordBody = z.object({
  current_password: z.string().min(1).max(512),
  new_password: z.string().min(1).max(512),
});

const stepUpBody = z.object({
  password: z.string().min(1).max(512),
});

export function safeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    status: user.status,
    must_change_password: user.must_change_password,
    platform_admin: user.platform_admin,
    last_login_at: user.last_login_at,
  };
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new HttpError(422, 'VALIDACION', message);
  }
  return result.data as z.output<S>;
}

function meta(req: FastifyRequest) {
  return {
    ip: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
}

const SESSION_MAX_AGE = SESSION_TTL_HOURS * 3_600;
const REFRESH_MAX_AGE = REFRESH_TTL_DAYS * 86_400;

export async function registerAuthRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  guards: Guards,
): Promise<void> {
  /** Cookie acc_csrf legible por JS: base del doble submit en el login. */
  app.get('/api/auth/csrf', async (req: FastifyRequest, reply: FastifyReply) => {
    const existing = req.cookies?.acc_csrf;
    const csrfToken = existing && existing.length >= 32 ? existing : randomToken();
    reply.setCookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
      maxAge: REFRESH_MAX_AGE,
    });
    return { csrfToken };
  });

  app.post('/api/auth/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parse(loginBody, req.body);
    const result = await login(db, body, meta(req));
    setSessionCookies(reply, {
      sessionToken: result.sessionToken,
      refreshToken: result.refreshToken,
      csrfToken: result.csrfToken,
      maxAgeSessionSec: SESSION_MAX_AGE,
      maxAgeRefreshSec: REFRESH_MAX_AGE,
    });
    return { user: safeUser(result.user), csrfToken: result.csrfToken };
  });

  app.post('/api/auth/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await refresh(db, req.cookies?.acc_refresh);
    setSessionCookies(reply, {
      ...result,
      csrfToken: req.cookies?.acc_csrf ?? randomToken(),
      maxAgeSessionSec: SESSION_MAX_AGE,
      maxAgeRefreshSec: REFRESH_MAX_AGE,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.auth) {
      await logout(db, { id: req.auth.session.id, user_id: req.auth.user.id }, meta(req));
    }
    clearSessionCookies(reply);
    return { ok: true };
  });

  app.post(
    '/api/auth/change-password',
    { preHandler: guards.requireAuth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = parse(changePasswordBody, req.body);
      const principal = guards.principal(req);
      await changePassword(
        db,
        principal.user,
        { currentPassword: body.current_password, newPassword: body.new_password },
        { ...meta(req), sessionId: principal.session.id },
      );
      // La sesión actual sigue viva; los tokens no rotan (solo se cierran las demás).
      return reply.status(200).send({ ok: true });
    },
  );

  app.post('/api/auth/step-up', { preHandler: guards.requireAuth }, async (req: FastifyRequest) => {
    const body = parse(stepUpBody, req.body);
    const principal = guards.principal(req);
    await stepUp(db, principal.user, { password: body.password }, {
      ...meta(req),
      sessionId: principal.session.id,
    });
    return { ok: true };
  });

  /**
   * Identidad + empresas accesibles + token CSRF.
   * No rota si la cookie vigente ya coincide con la sesión (rotar en cada carga
   * rompería otras pestañas abiertas): solo repara cookies ausentes o ajenas.
   */
  app.get('/api/me', { preHandler: guards.requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const principal = guards.principal(req);
    const incoming = req.cookies?.acc_csrf;
    const matches = typeof incoming === 'string' && incoming.length > 0 &&
      sha256(incoming) === principal.session.csrf_token_hash;
    const csrfToken = matches
      ? incoming
      : await rotateCsrfToken(db, principal.session);
    if (!matches) {
      reply.setCookie(CSRF_COOKIE, csrfToken as string, {
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        path: '/',
        maxAge: REFRESH_MAX_AGE,
      });
    }

    const memberships = await listMemberCompanies(db, principal.user.id);
    const allPermissions = await db
      .selectFrom('permissions')
      .select('code')
      .execute();

    const companies = [];
    for (const member of memberships) {
      const access = await resolveCompanyAccess(db, principal.user, member.id);
      companies.push({
        id: member.id,
        nit: member.nit,
        legal_name: member.legal_name,
        trade_name: member.trade_name,
        currency: member.currency,
        timezone: member.timezone,
        active: member.active,
        roles: member.roles,
        permissions: access?.platformAdmin
          ? allPermissions.map((p) => p.code)
          : [...(access?.permissions ?? [])],
      });
    }

    return {
      user: safeUser(principal.user),
      csrfToken: csrfToken as string,
      companies,
      session: {
        id: principal.session.id,
        expires_at: principal.session.expires_at,
        last_auth_at: principal.session.last_auth_at,
      },
    };
  });
}
