/**
 * Cliente HTTP de la API de Accountant (Fastify, server/).
 *
 * Todas las llamadas son defensivas: si el servidor no responde, el llamador
 * conserva el comportamiento local (datos demo / archivo en memoria) para no
 * romper la funcionalidad de la aplicación.
 */

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
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
  id: string;
  company_id: string | null;
  scope: string;
  key: string;
  value: unknown;
  value_type: string | null;
  description: string | null;
  is_system: boolean;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError('El servidor de Accountant no está disponible.', 0);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `Error ${response.status} en ${path}`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  baseUrl: BASE,

  getDataset: (companyId?: string) =>
    request<DatasetResponse>(`/api/dataset${companyId ? `?company_id=${companyId}` : ''}`),

  getImports: () => request<{ imports: ImportSummary[] }>('/api/imports'),

  uploadImport: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<ImportResult>('/api/imports', { method: 'POST', body: form });
  },

  getSettings: (companyId?: string) =>
    request<{ rows: SettingRow[]; effective: Record<string, unknown> }>(
      `/api/settings${companyId ? `?company_id=${companyId}` : ''}`,
    ),

  saveSetting: (input: { scope: string; key: string; value: unknown; description?: string }) =>
    request<{ created?: boolean; updated?: boolean; id: string }>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  getIssues: (companyId: string, options: { open?: boolean; limit?: number } = {}) => {
    const params = new URLSearchParams({ company_id: companyId });
    if (options.open) params.set('open', 'true');
    params.set('limit', String(options.limit ?? 50));
    return request<{ issues: IssueRow[] }>(`/api/issues?${params.toString()}`);
  },

  resolveIssue: (id: string) =>
    request<{ resolved: boolean; id: string }>(`/api/issues/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved_by: 'ui' }),
    }),
};
