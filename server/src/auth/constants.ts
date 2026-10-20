/** Constantes de autenticación. Fase 0-2: sin MFA todavía (Fase 4). */

export const SESSION_TTL_HOURS = 12;
export const REFRESH_TTL_DAYS = 30;

/** Fuerza bruta: 10 fallos en 15 minutos bloquean 15 minutos. */
export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_WINDOW_MIN = 15;
export const LOGIN_LOCK_MIN = 15;

/** Operaciones de riesgo exigen autenticación hace menos de 10 minutos. */
export const STEP_UP_WINDOW_MIN = 10;

export const PERMISSION_CACHE_TTL_MS = 60_000;

export const SESSION_COOKIE = 'acc_session';
export const REFRESH_COOKIE = 'acc_refresh';
export const CSRF_COOKIE = 'acc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export const CSRF_HEADER_LOWER = CSRF_HEADER;

export function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE === 'true';
}

/** Allowlist de orígenes con credenciales (cookies). */
export function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000';
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
