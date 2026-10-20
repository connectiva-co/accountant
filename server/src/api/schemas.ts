import { z } from 'zod';

export const companyQuery = z.object({
  company_id: z.string().uuid().optional(),
});

export const datasetQuery = companyQuery.extend({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const periodQuery = companyQuery.extend({
  from: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const issuesQuery = companyQuery.extend({
  open: z.enum(['true', 'false']).optional(),
  severity: z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']).optional(),
  rule_code: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const counterpartiesQuery = periodQuery.extend({
  role: z.enum(['cliente', 'proveedor', 'todos']).default('todos'),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const documentsQuery = companyQuery.extend({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  direction: z.enum(['ISSUED', 'RECEIVED', 'UNKNOWN']).optional(),
  category: z.enum(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT', 'PAYROLL', 'EVENT', 'OTHER']).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export const companyParams = z.object({
  companyId: z.string().uuid(),
});

export const integrationParams = companyParams.extend({
  provider: z.string().min(1).max(64),
});

export const integrationBody = z.object({
  name: z.string().trim().max(128).nullable().optional(),
  enabled: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
  credentials: z.record(z.unknown()).nullable().optional(),
  clear_credentials: z.boolean().optional(),
});

export const matchBody = z.object({
  provider: z.string().max(64).optional(),
  window_days: z.number().int().min(1).max(90).optional(),
  dry_run: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export const matchesQuery = z.object({
  status: z.enum(['NOT_CHECKED', 'MATCHED', 'NOT_FOUND', 'AMBIGUOUS', 'ERROR']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const syncRunBody = z.object({
  resource: z.enum(['THIRD_PARTIES']).default('THIRD_PARTIES'),
  dry_run: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const conflictResolveBody = z.object({
  resolution: z.enum(['SOURCE_WINS', 'TARGET_WINS', 'NEWEST_WINS', 'MANUAL_REVIEW', 'DO_NOT_OVERWRITE']),
  resolved_by: z.string().max(64).optional(),
});

export const settingsBody = z.object({
  scope: z.string().min(1).max(64),
  key: z.string().min(1).max(128),
  value: z.unknown(),
  company_id: z.string().uuid().nullable().optional(),
  description: z.string().max(500).optional(),
});

export const resolveIssueBody = z.object({
  company_id: z.string().uuid(),
  resolved_by: z.string().max(64).optional(),
});

export const eventsQuery = companyQuery.extend({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** Igual que parseQuery pero para cuerpos/params (mismo error tipado). */
export function parseBody<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new QueryError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data as z.output<S>;
}

export function parseQuery<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new QueryError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data as z.output<S>;
}

export class QueryError extends Error {}
