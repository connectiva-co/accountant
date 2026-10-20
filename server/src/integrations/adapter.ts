import type { z } from 'zod';
import type { IntegrationCapability, SyncResource } from './capabilities.js';

/** Códigos conocidos. Cualquier provider nuevo agrega su código aquí. */
export type IntegrationProviderCode = 'SIIGO' | 'WORLD_OFFICE';

export type FieldType = 'text' | 'secret' | 'number' | 'boolean' | 'select';

/** Definición de campo que el frontend usa para construir el formulario. */
export interface IntegrationFieldDefinition {
  key: string;
  label: string;
  type: FieldType;
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

export type ConnectionTestStatus = 'OK' | 'ERROR' | 'TIMEOUT' | 'AUTH_ERROR';

/** Resultado sanitizado: nunca contiene payloads sensibles del provider. */
export interface ConnectionTestResult {
  ok: boolean;
  status: ConnectionTestStatus;
  message: string;
  checkedAt: string;
  details?: Record<string, unknown>;
}

export interface DocumentLookupQuery {
  direction: 'ISSUED' | 'RECEIVED' | 'UNKNOWN';
  cufe?: string | null;
  thirdPartyTaxId?: string | null;
  prefix?: string | null;
  number?: string | null;
  issueDate?: string | null;
  total?: number | null;
  /** Ventana de búsqueda cuando el provider no permite filtrar por número/CUFE. */
  windowDays?: number;
}

/** Candidato externo devuelto por un adapter, en forma normalizada. */
export interface ExternalDocumentCandidate {
  externalId: string;
  externalDocumentType?: string | null;
  externalNumber?: string | null;
  cufe?: string | null;
  total?: number | null;
  issueDate?: string | null;
  thirdPartyTaxId?: string | null;
  /** Señal de causación/contabilización cuando el provider la expone. */
  contabilizado?: boolean | null;
  payload: Record<string, unknown>;
}

export interface ExternalThirdParty {
  externalId: string;
  taxId: string | null;
  name: string | null;
  email?: string | null;
  active?: boolean | null;
  sourceHash?: string | null;
  payload: Record<string, unknown>;
}

export interface ThirdPartyWriteInput {
  taxId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface ThirdPartyWriteResult {
  externalId: string;
  externalCode?: string | null;
}

/**
 * Contrato único que implementa cada provider. El core (IntegrationManager,
 * SyncEngine, matching) solo conoce esta interfaz: nunca importa Siigo ni
 * World Office directamente.
 */
export interface IntegrationAdapter<TSettings = unknown, TCredentials = unknown, TClient = unknown> {
  provider: IntegrationProviderCode;
  displayName: string;

  settingsSchema: z.ZodType<TSettings, z.ZodTypeDef, unknown>;
  credentialsSchema: z.ZodType<TCredentials, z.ZodTypeDef, unknown>;

  /** Definición de campos para el formulario dinámico del frontend. */
  fields: IntegrationFieldDefinition[];

  capabilities: IntegrationCapability[];
  /** Dominios que este provider puede participar al sincronizar. */
  syncResources: SyncResource[];

  createClient(input: { settings: TSettings; credentials: TCredentials }): TClient | Promise<TClient>;

  /** Liberar recursos (sockets, timers). El manager lo llama al invalidar cache. */
  destroyClient?(client: TClient): void;

  testConnection(client: TClient): Promise<ConnectionTestResult>;

  /** Búsqueda de documentos para el matching RADIAN ↔ ERP. */
  searchDocuments(client: TClient, query: DocumentLookupQuery): Promise<ExternalDocumentCandidate[]>;

  listThirdParties?(client: TClient, options?: { limit?: number }): Promise<ExternalThirdParty[]>;

  /** Descarga el XML UBL 2.1 oficial del ERP (solo soportado para facturas de venta en Siigo). */
  getDocumentXml?(client: TClient, externalIdOrSiigoId: string): Promise<string>;

  createThirdParty?(
    client: TClient,
    input: ThirdPartyWriteInput,
    options?: { idempotencyKey?: string },
  ): Promise<ThirdPartyWriteResult>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyIntegrationAdapter = IntegrationAdapter<any, any, any>;

export class IntegrationError extends Error {
  constructor(
    public readonly code:
      | 'PROVIDER_DESCONOCIDO'
      | 'SIN_INTEGRACION'
      | 'INTEGRACION_DESHABILITADA'
      | 'SIN_CREDENCIALES'
      | 'CREDENCIALES_INVALIDAS'
      | 'CONFIGURACION_INVALIDA'
      | 'SECRETS_SIN_LLAVE'
      | 'TEST_FALLIDO'
      | 'PROVIDER_ERROR'
      | 'SIN_CAPABILIDAD',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}
