import { z } from 'zod';
import type { Json } from '../db/schema.js';

/**
 * Schemas tipados por scope. Son la única fuente de verdad sobre qué claves
 * existen, qué tipo tienen y cuál es su default: no hay strings mágicos
 * dispersos ni escrituras de claves desconocidas.
 *
 * Los defaults son exactamente los que el código usaba como fallback, de modo
 * que respetarlos no cambia el comportamiento actual.
 */

export const ImportSettingsSchema = z.object({
  allow_unknown_document_type: z.boolean().default(false),
  require_company_nit: z.boolean().default(true),
  reject_rows_without_ids: z.boolean().default(true),
  unknown_document_type_code: z.string().min(1).max(64).default('OTRO'),
});

export const ReportingSettingsSchema = z.object({
  include_events_in_metrics: z.boolean().default(false),
  include_inactive_documents: z.boolean().default(false),
});

export const CurrencySettingsSchema = z.object({
  display: z
    .enum(['COP', 'USD', 'EUR'])
    .default('COP'),
  rounding_mode: z
    .enum(['HALF_UP', 'HALF_EVEN', 'HALF_DOWN', 'UP', 'DOWN', 'CEILING', 'FLOOR'])
    .default('HALF_UP'),
});

export const CompanySettingsSchema = z.object({
  default_timezone: z.string().min(1).max(64).default('America/Bogota'),
  default_currency: z.string().length(3).default('COP'),
});

/**
 * Configuración fiscal. `withholding_mode` documenta el comportamiento actual
 * de la app: hoy solo REPORTA las retenciones que trae el archivo (FILE_ONLY);
 * CALCULATED queda reservado para derivarlas de tarifas sobre la base gravable.
 */
export const TaxSettingsSchema = z.object({
  default_vat_rate: z.number().min(0).max(100).default(19),
  withholding_mode: z.enum(['FILE_ONLY', 'CALCULATED']).default('FILE_ONLY'),
  withholding_sources: z.array(z.enum(['RENTA', 'IVA', 'ICA'])).default(['RENTA', 'IVA', 'ICA']),
});

/** Ajustes generales de la aplicación (no fiscales, no de integración). */
export const GeneralSettingsSchema = z.object({
  locale: z.string().min(2).max(16).default('es-CO'),
  date_format: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY']).default('DD/MM/YYYY'),
  maintenance_mode: z.boolean().default(false),
});

export const SETTINGS_SCHEMAS = {
  import: ImportSettingsSchema,
  reporting: ReportingSettingsSchema,
  currency: CurrencySettingsSchema,
  company: CompanySettingsSchema,
  tax: TaxSettingsSchema,
  general: GeneralSettingsSchema,
} as const;

export type SettingsScope = keyof typeof SETTINGS_SCHEMAS;

export function isKnownScope(scope: string): scope is SettingsScope {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMAS, scope);
}

export function isKnownKey(scope: string, key: string): boolean {
  if (!isKnownScope(scope)) return false;
  const shape = (SETTINGS_SCHEMAS[scope] as z.AnyZodObject).shape;
  return Object.prototype.hasOwnProperty.call(shape, key);
}

/** Defaults del schema de un scope ({} parseado contra el schema). */
export function scopeDefaults(scope: string): Record<string, Json> {
  if (!isKnownScope(scope)) return {};
  return SETTINGS_SCHEMAS[scope].parse({}) as Record<string, Json>;
}

/**
 * Combina defaults del schema con los valores guardados, validando cada clave.
 * - Clave desconocida en BD: se conserva (no rompe lecturas legacy) pero nunca
 *   se podrá escribir de nuevo.
 * - Clave guardada con tipo inválido: vuelve al default (no se propaga basura).
 */
export function resolveScopeValues(scope: string, stored: Record<string, Json>): Record<string, Json> {
  if (!isKnownScope(scope)) return { ...stored };
  const shape = (SETTINGS_SCHEMAS[scope] as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
  const defaults = scopeDefaults(scope);
  const out: Record<string, Json> = {};

  for (const [key, type] of Object.entries(shape)) {
    if (Object.prototype.hasOwnProperty.call(stored, key)) {
      const parsed = type.safeParse(stored[key]);
      out[key] = parsed.success ? (parsed.data as Json) : defaults[key];
    } else {
      out[key] = defaults[key];
    }
  }
  for (const [key, value] of Object.entries(stored)) {
    if (!Object.prototype.hasOwnProperty.call(shape, key)) out[key] = value;
  }
  return out;
}

/** Valida un valor para (scope, key). Lanza ZodError si es inválido. */
export function validateSettingValue(scope: string, key: string, value: unknown): Json {
  if (!isKnownScope(scope)) {
    throw new UnknownScopeError(scope);
  }
  const shape = (SETTINGS_SCHEMAS[scope] as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
  if (!Object.prototype.hasOwnProperty.call(shape, key)) {
    throw new UnknownSettingKeyError(scope, key);
  }
  return shape[key].parse(value) as Json;
}

export class UnknownScopeError extends Error {
  constructor(public readonly scope: string) {
    super(`Scope de settings desconocido: "${scope}". Scopes válidos: ${Object.keys(SETTINGS_SCHEMAS).join(', ')}.`);
    this.name = 'UnknownScopeError';
  }
}

export class UnknownSettingKeyError extends Error {
  constructor(
    public readonly scope: string,
    public readonly key: string,
  ) {
    super(`Setting desconocida: "${scope}.${key}".`);
    this.name = 'UnknownSettingKeyError';
  }
}
