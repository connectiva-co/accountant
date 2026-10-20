import type { ParsedUblInvoice } from '../types/radian';
export type { ParsedUblInvoice };
/**
 * Cliente HTTP de la API de Accountant (Fastify, server/).
 *
 * Todas las llamadas son defensivas: si el servidor no responde, el llamador
 * conserva el comportamiento local (datos demo / archivo en memoria) para no
 * romper la funcionalidad de la aplicación.
 */

const defaultApiUrl = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : 'http://localhost:3001';

const BASE = (import.meta.env.VITE_API_URL || defaultApiUrl).replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Código estable del backend (p. ej. CREDENCIALES_INVALIDAS, SIN_ACCESO). */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/* ---------------- Sesión (cookies) y CSRF ---------------- */

export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  must_change_password: boolean;
  platform_admin: boolean;
  last_login_at: string | null;
}

export interface AuthCompany {
  id: string;
  nit: string;
  legal_name: string;
  trade_name: string | null;
  currency: string;
  timezone: string;
  active: boolean;
  roles: string[];
  permissions: string[];
}

export interface MeResponse {
  user: AuthUser;
  csrfToken: string;
  companies: AuthCompany[];
  session: { id: string; expires_at: string; last_auth_at: string };
}

export interface LoginResponse {
  user: AuthUser;
  csrfToken: string;
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const part = document.cookie.split('; ').find((c) => c.startsWith('acc_csrf='));
  return part ? decodeURIComponent(part.slice('acc_csrf='.length)) : null;
}

/** Garantiza la cookie acc_csrf (necesaria antes del login o de un refresh). */
async function ensureCsrf(): Promise<string | null> {
  const existing = readCsrfCookie();
  if (existing) return existing;
  try {
    const res = await fetch(`${BASE}/api/auth/csrf`, { credentials: 'include' });
    const body = (await res.json().catch(() => null)) as { csrfToken?: string } | null;
    return body?.csrfToken ?? null;
  } catch {
    return null;
  }
}

let unauthorizedHandler: (() => void) | null = null;
/** Se invoca cuando la sesión ya no es válida (401 que el refresh no recupera). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

let refreshInFlight: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        await ensureCsrf();
        const token = readCsrfCookie();
        const res = await fetch(`${BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: token ? { 'x-csrf-token': token } : undefined,
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        // Se libera en el siguiente ciclo para agrupar llamadas concurrentes.
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      }
    })();
  }
  return refreshInFlight;
}

export interface ApiCompany {
  id: string;
  nit: string;
  legal_name: string;
  trade_name: string | null;
  currency: string;
  timezone: string;
  active: boolean;
}

export interface DatasetResponse {
  company: ApiCompany;
  records: Array<Record<string, unknown>>;
  lastUpdate: string | null;
  counts: { documents: number; withFallbackUid: number };
}

export interface ImportSummary {
  id: string;
  filename: string;
  source: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  rows_total: number;
  rows_inserted: number;
  rows_updated: number;
  rows_unchanged: number;
  rows_rejected: number;
  warnings_count: number;
  error_message: string | null;
  company_nit: string | null;
  company_name: string | null;
}

export interface ImportResult {
  importId: string;
  companyId: string | null;
  companyNit: string | null;
  companyName: string;
  replayed: boolean;
  status: string;
  periods: string[];
  error: string | null;
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  warnings: number;
}

export interface SettingRow {
  /** null cuando la clave existe solo por el schema (sin fila persistida). */
  id: string | null;
  company_id: string | null;
  scope: string;
  key: string;
  value: unknown;
  value_type: string | null;
  description: string | null;
  is_system: boolean;
}


export type IntegrationFieldType = 'text' | 'secret' | 'number' | 'boolean' | 'select';

/** Definición de campo que el backend expone para construir el formulario. */
export interface IntegrationField {
  key: string;
  label: string;
  type: IntegrationFieldType;
  group: 'credentials' | 'settings';
  required: boolean;
  help?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
}

export interface IntegrationCatalog {
  provider: string;
  name: string;
  capabilities: string[];
  sync_resources: string[];
  fields: IntegrationField[];
}

export interface IntegrationSummary {
  id: string;
  company_id: string;
  provider: string;
  provider_name: string;
  name: string | null;
  enabled: boolean;
  status: string;
  settings: Record<string, unknown>;
  has_credentials: boolean;
  last_connection_test_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  last_successful_connection_at: string | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: 'OK' | 'ERROR' | 'TIMEOUT' | 'AUTH_ERROR';
  message: string;
  checkedAt: string;
}

export interface MatchRow {
  id: string;
  document_id: string;
  company_integration_id: string;
  match_status: 'NOT_CHECKED' | 'MATCHED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'ERROR';
  match_method: string | null;
  confidence: string | number | null;
  external_id: string | null;
  external_document_type: string | null;
  external_number: string | null;
  matched_at: string | null;
  last_checked_at: string | null;
  error_message: string | null;
  external_uid: string;
  prefix: string | null;
  folio: string | null;
  issued_at: string | null;
  total: number | string;
  direction: 'ISSUED' | 'RECEIVED' | 'UNKNOWN';
}

export interface SyncRunResult {
  run_id: string | null;
  resource: string;
  dry_run: boolean;
  strategy: string;
  read: number;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  failed: number;
  pushed: number;
  skipped_write: string | null;
  errors: string[];
}

export interface MatchOutcome {
  status: MatchRow['match_status'];
  method: string | null;
  confidence: number | null;
  errorMessage: string | null;
}

export interface RecheckSummary {
  checked: number;
  NOT_CHECKED: number;
  MATCHED: number;
  NOT_FOUND: number;
  AMBIGUOUS: number;
  ERROR: number;
  skipped: string | null;
}

export interface SyncConflict {
  id: string;
  company_id: string;
  resource_type: string;
  entity_type: string;
  entity_id: string;
  source_integration_id: string | null;
  target_integration_id: string | null;
  status: 'OPEN' | 'RESOLVED' | 'IGNORED';
  resolution: string | null;
  source_payload: Record<string, unknown> | null;
  target_payload: Record<string, unknown> | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface IssueRow {
  id: string;
  rule_code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  details: Record<string, unknown> | null;
  resolved_at: string | null;
  created_at: string;
  document_uid: string | null;
  issued_at: string | null;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  // Las cookies de sesión viajan siempre; las mutaciones llevan el token CSRF
  // (cookie legible por JS → header, doble submit validado por el servidor).
  if (MUTATING_METHODS.has(method) && !headers.has('x-csrf-token')) {
    const token = readCsrfCookie();
    if (token) headers.set('x-csrf-token', token);
  }
  return fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await rawFetch(path, init);
  } catch {
    throw new ApiError('El servidor de Accountant no está disponible.', 0);
  }

  const isAuthPath = path.startsWith('/api/auth') || path.startsWith('/api/health');
  if (response.status === 401 && !isAuthPath) {
    // Sesión vencida: rotar refresh y reintentar una vez con las cookies nuevas.
    const refreshed = await refreshSession();
    if (refreshed) {
      try {
        response = await rawFetch(path, init);
      } catch {
        throw new ApiError('El servidor de Accountant no está disponible.', 0);
      }
    } else {
      unauthorizedHandler?.();
    }
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(
      error?.message ?? `Error ${response.status} en ${path}`,
      response.status,
      error?.code,
    );
  }
  return body as T;
}

function jsonInit(method: string, payload?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  };
}

export const api = {
  baseUrl: BASE,

  /* ---------------- Autenticación ---------------- */

  getMe: () => request<MeResponse>('/api/me'),

  login: async (email: string, password: string): Promise<LoginResponse> => {
    await ensureCsrf();
    return request<LoginResponse>('/api/auth/login', jsonInit('POST', { email, password }));
  },

  logout: () => request<{ ok: boolean }>('/api/auth/logout', jsonInit('POST')),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/change-password', jsonInit('POST', {
      current_password: currentPassword,
      new_password: newPassword,
    })),

  stepUp: (password: string) =>
    request<{ ok: boolean }>('/api/auth/step-up', jsonInit('POST', { password })),

  /* ---------------- Administración (Fase 3) ---------------- */

  listUsers: (companyId: string) =>
    request<{ users: AdminUserSummary[] }>(`/api/users?company_id=${companyId}`),

  getUser: (userId: string, companyId: string) =>
    request<{ user: AdminUserDetail }>(`/api/users/${userId}?company_id=${companyId}`),

  createUser: (companyId: string, input: { email: string; full_name: string; password?: string }) =>
    request<{ user: AdminUserSummary; temporary_password: string | null }>(
      `/api/users?company_id=${companyId}`,
      jsonInit('POST', input),
    ),

  updateUser: (userId: string, companyId: string, input: { full_name: string }) =>
    request<{ user: AdminUserSummary }>(
      `/api/users/${userId}?company_id=${companyId}`,
      jsonInit('PUT', input),
    ),

  disableUser: (userId: string, companyId: string) =>
    request<{ user: { id: string; status: string } }>(
      `/api/users/${userId}/disable?company_id=${companyId}`,
      jsonInit('POST'),
    ),

  reactivateUser: (userId: string, companyId: string) =>
    request<{ user: { id: string; status: string } }>(
      `/api/users/${userId}/reactivate?company_id=${companyId}`,
      jsonInit('POST'),
    ),

  resetPassword: (userId: string, companyId: string) =>
    request<{ ok: boolean; temporary_password: string }>(
      `/api/users/${userId}/reset-password?company_id=${companyId}`,
      jsonInit('POST'),
    ),

  listUserCompanies: (userId: string) =>
    request<{ companies: UserCompanyRow[] }>(`/api/users/${userId}/companies`),

  assignCompany: (userId: string, companyId: string) =>
    request<{ ok: boolean }>(`/api/users/${userId}/companies/${companyId}`, jsonInit('POST')),

  removeCompany: (userId: string, companyId: string) =>
    request<{ ok: boolean }>(`/api/users/${userId}/companies/${companyId}/disable`, jsonInit('POST')),

  reactivateCompany: (userId: string, companyId: string) =>
    request<{ ok: boolean }>(`/api/users/${userId}/companies/${companyId}/reactivate`, jsonInit('POST')),

  getAdminCompanies: () => request<{ companies: AdminCompanyRow[] }>('/api/admin/companies'),

  listPermissions: () => request<{ permissions: PermissionRow[] }>('/api/permissions'),

  listRoles: (companyId: string) =>
    request<{ roles: RoleRow[] }>(`/api/companies/${companyId}/roles`),

  assignRole: (companyId: string, userId: string, roleId: string) =>
    request<{ ok: boolean }>(`/api/companies/${companyId}/users/${userId}/roles/${roleId}`, jsonInit('POST')),

  removeRole: (companyId: string, userId: string, roleId: string) =>
    request<{ ok: boolean }>(`/api/companies/${companyId}/users/${userId}/roles/${roleId}`, {
      method: 'DELETE',
    }),

  createRole: (companyId: string, input: { name: string; description?: string | null; permissions: string[] }) =>
    request<{ role: RoleRow }>(`/api/companies/${companyId}/roles`, jsonInit('POST', input)),

  updateRole: (companyId: string, roleId: string, input: { name: string; description?: string | null; permissions: string[] }) =>
    request<{ ok: boolean }>(`/api/companies/${companyId}/roles/${roleId}`, jsonInit('PUT', input)),

  listSessions: (userId: string, companyId: string) =>
    request<{ sessions: SessionRow[] }>(`/api/users/${userId}/sessions?company_id=${companyId}`),

  revokeSession: (userId: string, sessionId: string, companyId: string) =>
    request<{ ok: boolean }>(
      `/api/users/${userId}/sessions/${sessionId}/revoke?company_id=${companyId}`,
      jsonInit('POST'),
    ),

  revokeAllSessions: (userId: string, companyId: string) =>
    request<{ ok: boolean }>(
      `/api/users/${userId}/sessions/revoke-all?company_id=${companyId}`,
      jsonInit('POST'),
    ),

  /* ---------------- Catálogo ---------------- */

  getCompanies: () => request<{ companies: ApiCompany[] }>('/api/companies'),

  getDataset: (companyId?: string) =>
    request<DatasetResponse>(`/api/dataset${companyId ? `?company_id=${companyId}` : ''}`),

  getImports: (companyId: string) => request<{ imports: ImportSummary[] }>(`/api/imports?company_id=${companyId}`),

  uploadImport: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<ImportResult>('/api/imports', { method: 'POST', body: form });
  },

  getSettings: (companyId?: string) =>
    request<{ rows: SettingRow[]; effective: Record<string, unknown> }>(
      `/api/settings${companyId ? `?company_id=${companyId}` : ''}`,
    ),

  saveSetting: (input: {
    scope: string;
    key: string;
    value: unknown;
    description?: string;
    companyId?: string | null;
  }) =>
    request<{ created?: boolean; updated?: boolean; id: string | null }>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, company_id: input.companyId ?? null }),
    }),

  getIssues: (companyId: string, options: { open?: boolean; limit?: number } = {}) => {
    const params = new URLSearchParams({ company_id: companyId });
    if (options.open) params.set('open', 'true');
    params.set('limit', String(options.limit ?? 50));
    return request<{ issues: IssueRow[] }>(`/api/issues?${params.toString()}`);
  },

  resolveIssue: (id: string, companyId: string) =>
    request<{ resolved: boolean; id: string }>(`/api/issues/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, resolved_by: 'ui' }),
    }),

  /* ---------------- Integraciones y sincronización ---------------- */

  listIntegrations: (companyId: string) =>
    request<{ integrations: IntegrationSummary[]; catalog: IntegrationCatalog[] }>(
      `/api/companies/${companyId}/integrations`,
    ),

  getIntegration: (companyId: string, provider: string) =>
    request<{ integration: IntegrationSummary; catalog: IntegrationCatalog }>(
      `/api/companies/${companyId}/integrations/${provider}`,
    ),

  saveIntegration: (
    companyId: string,
    provider: string,
    input: {
      name?: string | null;
      enabled?: boolean;
      settings?: Record<string, unknown>;
      credentials?: Record<string, unknown> | null;
      clear_credentials?: boolean;
    },
  ) =>
    request<{ integration: IntegrationSummary | null; catalog: IntegrationCatalog | null }>(
      `/api/companies/${companyId}/integrations/${provider}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ),

  testIntegration: (companyId: string, provider: string) =>
    request<{ result: ConnectionTestResult; integration: IntegrationSummary | null }>(
      `/api/companies/${companyId}/integrations/${provider}/test`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
    ),

  matchDocument: (companyId: string, documentId: string, options: { provider?: string } = {}) =>
    request<{ document_id: string; provider: string; outcome: MatchOutcome; saved: boolean }>(
      `/api/companies/${companyId}/documents/${documentId}/match`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      },
    ),

  listMatches: (companyId: string, options: { status?: MatchRow['match_status']; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    return request<{ matches: MatchRow[] }>(
      `/api/companies/${companyId}/matches${query ? `?${query}` : ''}`,
    );
  },

  recheckMatches: (
    companyId: string,
    options: { provider?: string; limit?: number; dry_run?: boolean } = {},
  ) =>
    request<{ summary: RecheckSummary }>(`/api/companies/${companyId}/matches/recheck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    }),

  runSync: (companyId: string, options: { resource?: string; dry_run?: boolean; limit?: number } = {}) =>
    request<{ run: SyncRunResult }>(`/api/companies/${companyId}/sync/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: options.resource ?? 'THIRD_PARTIES', ...options }),
    }),

  listConflicts: (companyId: string, options: { status?: SyncConflict['status'] } = {}) =>
    request<{ conflicts: SyncConflict[] }>(
      `/api/companies/${companyId}/sync/conflicts${options.status ? `?status=${options.status}` : ''}`,
    ),

  getDocumentXml: (companyId: string, documentId: string) =>
    request<{
      document_id: string;
      siigo_invoice_id: string;
      invoice: ParsedUblInvoice;
      raw_xml: string;
    }>(`/api/companies/${companyId}/documents/${documentId}/xml`),

  getDocumentTaxes: (companyId: string, documentId: string) =>
    request<{
      document_id: string;
      taxes: Array<{
        tax_code: string;
        tax_name: string;
        taxable_base: number;
        rate: number | null;
        amount: number;
      }>;
    }>(`/api/companies/${companyId}/documents/${documentId}/taxes`),

  updateDocumentTaxes: (
    companyId: string,
    documentId: string,
    taxes: Array<{
      tax_code: string;
      taxable_base: number;
      rate?: number | null;
      amount: number;
    }>,
  ) =>
    request<{
      document_id: string;
      taxes: Array<{
        tax_code: string;
        tax_name: string;
        taxable_base: number;
        rate: number | null;
        amount: number;
      }>;
    }>(`/api/companies/${companyId}/documents/${documentId}/taxes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taxes }),
    }),

  resolveConflict: (companyId: string, conflictId: string, resolution: string) =>
    request<{ resolved: boolean; id: string }>(
      `/api/companies/${companyId}/sync/conflicts/${conflictId}/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution }),
      },
    ),
};

export interface AdminUserSummary {
  id: string;
  email: string;
  full_name: string;
  status: string;
  last_login_at: string | null;
  two_factor_enabled: boolean;
  must_change_password: boolean;
  membership_status: string;
  roles: string[];
  companies_count: number;
}

export interface AdminUserDetail {
  id: string;
  email: string;
  full_name: string;
  status: string;
  must_change_password: boolean;
  platform_admin: boolean;
  last_login_at: string | null;
  two_factor_enabled: boolean;
  created_at: string;
  membership_status: string;
}

export interface UserCompanyRow {
  id: string;
  nit: string;
  legal_name: string;
  trade_name: string | null;
  membership_status: string;
  membership_id: string;
  roles: Array<{ code: string; name: string }>;
}

export interface AdminCompanyRow {
  id: string;
  nit: string;
  legal_name: string;
  trade_name: string | null;
  permissions: string[];
  platform_admin: boolean;
}

export interface SessionRow {
  id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_auth_at: string;
}

export interface PermissionRow {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  risk_level: string;
  requires_step_up: boolean;
}

export interface RoleRow {
  id: string;
  company_id: string | null;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_editable: boolean;
  active: boolean;
  permissions: string[];
}
