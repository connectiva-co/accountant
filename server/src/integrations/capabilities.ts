/**
 * Capacidades de un provider, distinguiendo lectura y escritura.
 *
 * El core solo conoce estos nombres: nunca pregunta "¿puede Siigo?" sino
 * "¿este provider tiene THIRD_PARTIES_WRITE?". El catálogo define qué
 * operaciones existen por recurso; cada adapter declara cuáles soporta.
 */

export const RESOURCE_OPERATIONS = {
  DOCUMENT_LOOKUP: ['READ'],
  SALES_INVOICES: ['READ', 'WRITE'],
  PURCHASE_INVOICES: ['READ', 'WRITE'],
  SUPPORT_DOCUMENTS: ['READ', 'WRITE'],
  CREDIT_NOTES: ['READ', 'WRITE'],
  JOURNALS: ['READ', 'WRITE'],
  THIRD_PARTIES: ['READ', 'WRITE'],
  CUSTOMERS: ['READ', 'WRITE'],
  PRODUCTS: ['READ', 'WRITE'],
  ACCOUNTS: ['READ', 'WRITE'],
  COST_CENTERS: ['READ', 'WRITE'],
  PAYMENT_METHODS: ['READ', 'WRITE'],
  TAXES: ['READ', 'WRITE'],
  USERS_OR_SELLERS: ['READ'],
  FINANCIAL_REPORTS: ['READ'],
  ACCOUNTING: ['READ', 'WRITE'],
  DIAN: ['READ', 'WRITE'],
  RIPS: ['READ', 'WRITE'],
  HEALTH: ['READ'],
} as const satisfies Record<string, readonly string[]>;

export type SyncResource = keyof typeof RESOURCE_OPERATIONS;
export type ResourceOperation = 'READ' | 'WRITE';
export type IntegrationCapability = `${SyncResource}_${ResourceOperation}`;

/** Dominios que la app sabe sincronizar (sección 48 del diseño). */
export const SYNCABLE_RESOURCES = [
  'THIRD_PARTIES',
  'SALES_INVOICES',
  'PURCHASE_INVOICES',
  'SUPPORT_DOCUMENTS',
  'CREDIT_NOTES',
  'PRODUCTS',
  'ACCOUNTS',
  'COST_CENTERS',
  'PAYMENT_METHODS',
  'TAXES',
  'JOURNALS',
  'USERS_OR_SELLERS',
] as const satisfies readonly SyncResource[];

export type SyncableResource = (typeof SYNCABLE_RESOURCES)[number];

/** Todas las capabilities (READ/WRITE) que un recurso puede declarar. */
export function capabilitiesForResource(resource: SyncResource): IntegrationCapability[] {
  return (RESOURCE_OPERATIONS[resource] ?? []).map((op) => `${resource}_${op}` as IntegrationCapability);
}

export function hasCapability(
  capabilities: readonly string[],
  resource: SyncResource,
  operation: ResourceOperation,
): boolean {
  return capabilities.includes(`${resource}_${operation}`);
}

export function canRead(capabilities: readonly string[], resource: SyncResource): boolean {
  return hasCapability(capabilities, resource, 'READ');
}

export function canWrite(capabilities: readonly string[], resource: SyncResource): boolean {
  return hasCapability(capabilities, resource, 'WRITE');
}
