import '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../api/errors.js';
import {
  CSRF_COOKIE,
  CSRF_HEADER_LOWER,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  STEP_UP_WINDOW_MIN,
} from './constants.js';
import {
  getPermission,
  hasGlobalPermission,
  hasPermission,
  resolveCompanyAccess,
  type CompanyAccess,
} from './permissions.js';
import { resolveSession, verifyCsrf } from './sessions.js';
import { readCookie, safeEqual } from './tokens.js';
import type { User, UserSession } from '../db/schema.js';
import type { Database } from '../db/schema.js';
import type { Kysely } from 'kysely';

export interface AuthPrincipal {
  user: User;
  session: UserSession;
  ip: string;
  userAgent: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Sesión resuelta por el hook global de autenticación. */
    auth?: AuthPrincipal;
    /** Acceso a la empresa de la ruta (fija requireCompany). */
    companyAccess?: CompanyAccess | null;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Rutas públicas (patrón de ruta Fastify, no la URL concreta). */
const PUBLIC_ROUTES: Array<{ method: string; url: string }> = [
  { method: 'GET', url: '/api/health' },
  { method: 'GET', url: '/api/auth/csrf' },
  { method: 'POST', url: '/api/auth/login' },
  { method: 'POST', url: '/api/auth/refresh' },
  { method: 'POST', url: '/api/auth/logout' },
];

function isPublic(method: string, routeUrl: string | undefined): boolean {
  if (!routeUrl) return false;
  return PUBLIC_ROUTES.some((r) => r.method === method && r.url === routeUrl);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractCompanyId(req: FastifyRequest): string | undefined {
  const params = (req.params ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = params.companyId ?? params.company_id ?? query.company_id ?? query.companyId ?? body.company_id ?? body.companyId;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  return raw;
}

export interface Guards {
  /** Hook global (onRequest): sesión + CSRF. */
  authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Exige company_id (params/query/body) y membresía ACTIVE → req.companyAccess. */
  requireCompany: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Igual, pero company_id opcional (si falta, req.companyAccess = null). */
  requireCompanyIfPresent: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Exige el permiso en la empresa de la ruta (o global si no hay empresa). */
  requirePermission: (code: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Solo exige sesión (rutas /auth, /me, /companies). */
  requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Comprobación programática (importaciones, resolución post-parseo). */
  assertCompanyPermission: (
    user: User,
    companyId: string,
    code: string,
  ) => Promise<CompanyAccess>;
  principal: (req: FastifyRequest) => AuthPrincipal;
}

function csrfCheck(req: FastifyRequest, session: UserSession | undefined): void {
  const header = req.headers[CSRF_HEADER_LOWER];
  const token = Array.isArray(header) ? header[0] : header;

  if (session) {
    if (!verifyCsrf(session, token)) {
      throw new HttpError(403, 'CSRF_INVALIDO', 'Token CSRF inválido o ausente.');
    }
    return;
  }

  // Sin sesión (login/refresh/logout): doble submit con la cookie acc_csrf.
  const cookie = readCookie(req.headers.cookie, CSRF_COOKIE);
  if (!token || !cookie || !safeEqual(token, cookie)) {
    throw new HttpError(403, 'CSRF_INVALIDO', 'Token CSRF inválido o ausente.');
  }
}

export function createGuards(db: Kysely<Database>): Guards {
  async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (req.method === 'OPTIONS') return;

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const resolution = await resolveSession(db, token);
    if (resolution.ok) {
      req.auth = {
        user: resolution.user,
        session: resolution.session,
        ip: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      };
    }

    const routeUrl = req.routeOptions?.url;
    const publicRoute = isPublic(req.method, routeUrl);

    if (publicRoute) {
      if (MUTATING.has(req.method)) csrfCheck(req, resolution.ok ? resolution.session : undefined);
      return;
    }

    if (!routeUrl) return; // sin ruta: el 404 de Fastify responde

    if (!req.auth) {
      const code = resolution.ok ? 'NO_AUTENTICADO' : resolution.code;
      const message = resolution.ok ? 'No hay sesión activa.' : resolution.message;
      throw new HttpError(401, code, message);
    }

    if (MUTATING.has(req.method)) csrfCheck(req, req.auth.session);
  }

  function principal(req: FastifyRequest): AuthPrincipal {
    if (!req.auth) throw new HttpError(401, 'NO_AUTENTICADO', 'No hay sesión activa.');
    return req.auth;
  }

  async function loadCompany(req: FastifyRequest, required: boolean): Promise<void> {
    const { user } = principal(req);
    let companyId = extractCompanyId(req);

    // Si viene vacío o literal 'undefined'/'null'
    if (!companyId || companyId === 'undefined' || companyId === 'null') {
      const firstMembership = await db
        .selectFrom('company_memberships')
        .select('company_id')
        .where('user_id', '=', user.id)
        .where('status', '=', 'ACTIVE')
        .executeTakeFirst();

      if (firstMembership) {
        companyId = firstMembership.company_id;
      } else if (required) {
        throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');
      } else {
        req.companyAccess = null;
        return;
      }
    }

    // Si pasaron un NIT en vez de UUID, resolver la empresa por NIT
    if (!UUID_RE.test(companyId)) {
      const cleanNit = companyId.replace(/\D/g, '');
      const found = await db
        .selectFrom('companies')
        .select('id')
        .where((eb) => eb.or([eb('nit', '=', companyId!), eb('nit', '=', cleanNit)]))
        .executeTakeFirst();

      if (found) {
        companyId = found.id;
      } else {
        throw new HttpError(400, 'SIN_EMPRESA', 'company_id inválido.');
      }
    }

    // Normalizar companyId resuelto en req.params y req.query
    if (req.params && typeof req.params === 'object') {
      (req.params as Record<string, unknown>).companyId = companyId;
      (req.params as Record<string, unknown>).company_id = companyId;
    }
    if (req.query && typeof req.query === 'object') {
      (req.query as Record<string, unknown>).companyId = companyId;
      (req.query as Record<string, unknown>).company_id = companyId;
    }

    const access = await resolveCompanyAccess(db, user, companyId);
    if (!access) {
      throw new HttpError(403, 'SIN_ACCESO', 'No tienes acceso a esta empresa.');
    }
    req.companyAccess = access;
  }

  async function stepUpCheck(req: FastifyRequest, code: string): Promise<void> {
    const permission = await getPermission(db, code);
    if (!permission?.requires_step_up) return;
    const { session } = principal(req);
    const age = Date.now() - new Date(session.last_auth_at).getTime();
    if (age > STEP_UP_WINDOW_MIN * 60_000) {
      throw new HttpError(
        403,
        'PASO_REQUERIDO',
        `La operación "${code}" exige reautenticación reciente.`,
      );
    }
  }

  const requireCompany = (req: FastifyRequest, _reply: FastifyReply) => loadCompany(req, true);
  const requireCompanyIfPresent = (req: FastifyRequest, _reply: FastifyReply) =>
    loadCompany(req, false);

  const requireAuth = async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    principal(req);
  };

  function requirePermission(code: string) {
    return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      const { user } = principal(req);
      const access = req.companyAccess; // undefined => guard de empresa no corre en esta ruta

      const granted =
        access === undefined || access === null
          ? await hasGlobalPermission(db, user, code)
          : hasPermission(access, code);

      if (!granted) {
        throw new HttpError(403, 'PERMISO_INSUFICIENTE', `No tienes el permiso "${code}".`);
      }
      await stepUpCheck(req, code);
    };
  }

  async function assertCompanyPermission(
    user: User,
    companyId: string,
    code: string,
  ): Promise<CompanyAccess> {
    const access = await resolveCompanyAccess(db, user, companyId);
    if (!access) {
      throw new HttpError(403, 'SIN_ACCESO', 'No tienes acceso a esta empresa.');
    }
    if (!hasPermission(access, code)) {
      throw new HttpError(403, 'PERMISO_INSUFICIENTE', `No tienes el permiso "${code}".`);
    }
    return access;
  }

  return {
    authenticate,
    requireCompany,
    requireCompanyIfPresent,
    requirePermission,
    requireAuth,
    assertCompanyPermission,
    principal,
  };
}

/** Lee el usuario autenticado en handlers (tras guards). */
export function currentUser(req: FastifyRequest): User {
  if (!req.auth) throw new HttpError(401, 'NO_AUTENTICADO', 'No hay sesión activa.');
  return req.auth.user;
}

/** Cookies de sesión/refresh/CSRF con banderas de seguridad. */
export function setSessionCookies(reply: FastifyReply, tokens: {
  sessionToken: string;
  refreshToken: string;
  csrfToken: string;
  maxAgeSessionSec: number;
  maxAgeRefreshSec: number;
}): void {
  const secure = process.env.COOKIE_SECURE === 'true';
  reply.setCookie(SESSION_COOKIE, tokens.sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: tokens.maxAgeSessionSec,
  });
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/api/auth',
    maxAge: tokens.maxAgeRefreshSec,
  });
  reply.setCookie(CSRF_COOKIE, tokens.csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: tokens.maxAgeRefreshSec,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  const secure = process.env.COOKIE_SECURE === 'true';
  reply.clearCookie(SESSION_COOKIE, { path: '/', sameSite: 'lax', secure });
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth', sameSite: 'lax', secure });
  reply.clearCookie(CSRF_COOKIE, { path: '/', sameSite: 'lax', secure });
}
