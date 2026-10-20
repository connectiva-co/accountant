import { z } from 'zod';
import {
  WorldOfficeAuthError,
  WorldOfficeClient,
  WorldOfficeTimeoutError,
} from '@connectiva-co/worldoffice-sdk';
import type { DocumentoEncabezadoPOJO, TerceroPojo } from '@connectiva-co/worldoffice-sdk';
import type {
  ConnectionTestResult,
  ExternalDocumentCandidate,
  ExternalThirdParty,
  IntegrationAdapter,
} from '../adapter.js';
import type { IntegrationCapability } from '../capabilities.js';
import { docNumber, extractItems, matchesLookupHints, truncateMessage } from '../lookup.js';

const optionalSecret = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.string().trim().min(1).max(400).optional(),
);

export const WorldOfficeSettingsSchema = z.object({
  base_url: z
    .string()
    .trim()
    .url('base_url debe ser una URL válida')
    .refine(
      (value) => !value.includes('azurewebsites.net'),
      'No uses la URL de desarrollo de World Office; registra la URL del entorno real',
    ),
  timeout_ms: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce.number().int().min(1_000).max(180_000).optional(),
  ),
});

export const WorldOfficeCredentialsSchema = z
  .object({
    token: optionalSecret,
    portal_token: optionalSecret,
    portal_ip: z
      .string()
      .trim()
      .max(64)
      .refine((value) => value === '' || /^[\w.:-]+$/.test(value), 'portal_ip no parece una IP válida')
      .optional()
      .or(z.literal('')),
  })
  .superRefine((value, ctx) => {
    if (!value.token && !value.portal_token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['token'],
        message: 'Debes registrar al menos un token (API) o un portal_token',
      });
    }
    if (value.portal_token && !value.portal_ip) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['portal_ip'],
        message: 'portal_ip es obligatorio cuando se usa portal_token',
      });
    }
  });

export type WorldOfficeSettings = z.infer<typeof WorldOfficeSettingsSchema>;
export type WorldOfficeCredentials = z.infer<typeof WorldOfficeCredentialsSchema>;

/**
 * Solo lo que este adapter implementa hoy: lookup de documentos (matching) y
 * lectura de terceros. Escrituras (crear tercero/factura/compra) quedan fuera
 * hasta que el SDK exponga los catálogos que exigen (ciudad, tipos de tercero,
 * clasificación impositiva, moneda y formas de pago).
 */
const WO_CAPABILITIES = ['DOCUMENT_LOOKUP_READ', 'THIRD_PARTIES_READ'] as const satisfies IntegrationCapability[];


const MAX_PAGES = 30;
const PAGE_SIZE = 100;
const MAX_CANDIDATES = 100;

type DocSource = 'SALES_INVOICE' | 'PURCHASE_INVOICE';

function isoNow(): string {
  return new Date().toISOString();
}

function readNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function toCandidate(source: DocSource, item: unknown): ExternalDocumentCandidate | null {
  if (!item || typeof item !== 'object') return null;
  const doc = item as DocumentoEncabezadoPOJO;
  if (doc.id === undefined || doc.id === null) return null;

  const raw = item as Record<string, unknown>;
  const taxId = doc.terceroExterno?.identificacion ?? doc.terceroInterno?.identificacion ?? null;
  const externalNumber = docNumber(doc.prefijo?.nombre ?? doc.prefijoExterno, doc.numero ?? doc.numeroExterno);

  return {
    externalId: `WORLD_OFFICE:${source}:${doc.id}`,
    externalDocumentType: (doc.documentoTipo as { codigoDocumento?: string } | undefined)?.codigoDocumento ?? source,
    externalNumber,
    cufe: doc.docAsociado?.cufe ?? null,
    total: readNumber(raw, ['total', 'valorTotal', 'totalDocumento', 'valorTotalDocumento']),
    issueDate: typeof doc.fecha === 'string' ? doc.fecha.slice(0, 10) : null,
    thirdPartyTaxId: taxId,
    contabilizado: doc.senContabilizado ?? null,
    payload: {
      wo_id: doc.id,
      numero: doc.numero ?? null,
      prefijo: doc.prefijo?.nombre ?? null,
      documento_tipo: (doc.documentoTipo as { nombreDocumento?: string } | undefined)?.nombreDocumento ?? null,
      estados: doc.documentoEncabezadosEstados?.map((estado) => estado.codigo ?? null) ?? null,
      numero_externo: doc.numeroExterno ?? null,
      doc_asociado_cufe: doc.docAsociado?.cufe ?? null,
    },
  };
}

function classifyError(error: unknown): ConnectionTestResult {
  const checkedAt = isoNow();
  if (error instanceof WorldOfficeAuthError) {
    return { ok: false, status: 'AUTH_ERROR', message: 'World Office rechazó el token', checkedAt };
  }
  if (error instanceof WorldOfficeTimeoutError) {
    return { ok: false, status: 'TIMEOUT', message: 'Tiempo de espera agotado al consultar World Office', checkedAt };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, status: 'ERROR', message: truncateMessage(message), checkedAt };
}

export const worldOfficeAdapter: IntegrationAdapter<
  WorldOfficeSettings,
  WorldOfficeCredentials,
  WorldOfficeClient
> = {
  provider: 'WORLD_OFFICE',
  displayName: 'World Office',

  settingsSchema: WorldOfficeSettingsSchema,
  credentialsSchema: WorldOfficeCredentialsSchema,

  fields: [
    {
      key: 'token',
      label: 'Token de API',
      type: 'secret',
      group: 'credentials',
      required: false,
      help: 'Token Bearer del backend de World Office. Obligatorio si no registras portal_token.',
    },
    {
      key: 'portal_token',
      label: 'Token de portal',
      type: 'secret',
      group: 'credentials',
      required: false,
      help: 'X-Portal-Token. Requiere también la IP del portal.',
    },
    { key: 'portal_ip', label: 'IP de portal', type: 'text', group: 'credentials', required: false, maxLength: 64 },
    {
      key: 'base_url',
      label: 'URL base',
      type: 'text',
      group: 'settings',
      required: true,
      placeholder: 'https://api.worldoffice.example',
      help: 'URL del entorno real de World Office (no la de desarrollo).',
    },
    { key: 'timeout_ms', label: 'Timeout (ms)', type: 'number', group: 'settings', required: false, min: 1_000, max: 180_000 },
  ],

  capabilities: [...WO_CAPABILITIES],
  syncResources: ['THIRD_PARTIES'],

  createClient(input) {
    return new WorldOfficeClient({
      token: input.credentials.token || undefined,
      portalToken: input.credentials.portal_token || undefined,
      portalIp: input.credentials.portal_ip || undefined,
      baseUrl: input.settings.base_url,
      timeout: input.settings.timeout_ms,
    });
  },

  async testConnection(client) {
    const started = Date.now();
    try {
      const monedas = await client.catalogos.consultarMonedas();
      const items = extractItems(monedas);
      return {
        ok: true,
        status: 'OK',
        message: 'Conexión verificada contra World Office',
        checkedAt: isoNow(),
        details: { latency_ms: Date.now() - started, monedas: items.length },
      };
    } catch (error) {
      return classifyError(error);
    }
  },

  async searchDocuments(client, query) {
    const sources: DocSource[] =
      query.direction === 'ISSUED'
        ? ['SALES_INVOICE']
        : query.direction === 'RECEIVED'
          ? ['PURCHASE_INVOICE']
          : ['SALES_INVOICE', 'PURCHASE_INVOICE'];

    const candidates: ExternalDocumentCandidate[] = [];

    for (const source of sources) {
      if (candidates.length >= MAX_CANDIDATES) break;
      let page = 1;
      while (page <= MAX_PAGES && candidates.length < MAX_CANDIDATES) {
        const queryArgs = { pagina: page, registrosPorPagina: PAGE_SIZE };
        const response =
          source === 'SALES_INVOICE'
            ? await client.documentos.consultarDocumentos<unknown>(queryArgs)
            : await client.compras.consultarFacturasCompra<unknown>(queryArgs);

        const items = extractItems(response);
        for (const item of items) {
          const candidate = toCandidate(source, item);
          if (candidate && matchesLookupHints(candidate, query)) candidates.push(candidate);
          if (candidates.length >= MAX_CANDIDATES) break;
        }

        if (items.length < PAGE_SIZE) break;
        page += 1;
      }
    }

    return candidates;
  },

  async listThirdParties(client) {
    const parties: ExternalThirdParty[] = [];
    let page = 1;
    while (page <= MAX_PAGES) {
      const response: unknown = await client.terceros.consultarTerceros({
        pagina: page,
        registrosPorPagina: PAGE_SIZE,
      });
      const items = extractItems(response);
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const tercero = item as TerceroPojo;
        if (tercero.id === undefined || tercero.id === null) continue;
        const composed = [tercero.primerNombre, tercero.segundoNombre, tercero.primerApellido, tercero.segundoApellido]
          .filter(Boolean)
          .join(' ')
          .trim();
        const name = tercero.nombreCompleto ?? (composed || null);
        parties.push({
          externalId: `WORLD_OFFICE:THIRD_PARTY:${tercero.id}`,
          taxId: tercero.identificacion ?? null,
          name: name || null,
          email: null,
          active: tercero.senActivo ?? null,
          sourceHash: null,
          payload: {
            wo_id: tercero.id,
            codigo: tercero.codigo ?? null,
            identificacion_tipo:
              typeof tercero.terceroTipoIdentificacion === 'object'
                ? tercero.terceroTipoIdentificacion?.abreviatura ?? null
                : tercero.terceroTipoIdentificacion ?? null,
          },
        });
      }
      if (items.length < PAGE_SIZE) break;
      page += 1;
    }
    return parties;
  },
};
