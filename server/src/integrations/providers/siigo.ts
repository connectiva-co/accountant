import { z } from 'zod';
import {
  SiigoAuthenticationError,
  SiigoClient,
  SiigoRateLimitError,
  SiigoTimeoutError,
} from '@connectiva-co/siigo-sdk';
import type {
  Customer,
  Invoice,
  PaginatedResponse,
  Purchase,
  PurchaseSupportDocument,
} from '@connectiva-co/siigo-sdk';
import type {
  ConnectionTestResult,
  ExternalDocumentCandidate,
  ExternalThirdParty,
  IntegrationAdapter,
  ThirdPartyWriteInput,
  ThirdPartyWriteResult,
} from '../adapter.js';
import type { IntegrationCapability } from '../capabilities.js';
import { docNumber, matchesLookupHints, shiftDays, truncateMessage } from '../lookup.js';

export const SiigoSettingsSchema = z.object({
  partner_id: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z
      .string()
      .trim()
      .min(3, 'partner_id debe tener al menos 3 caracteres')
      .max(100, 'partner_id no puede superar 100 caracteres')
      .regex(/^[A-Za-z0-9]+$/, 'partner_id solo admite letras y números, sin espacios')
      .optional(),
  ),
  base_url: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().url('base_url debe ser una URL válida').optional(),
  ),
  timeout_ms: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce.number().int().min(1_000).max(180_000).optional(),
  ),
  sales_withholding_account: z.preprocess(
    (value) => (value === '' || value === undefined ? '1355' : value),
    z.string().trim().max(30).default('1355'),
  ),
  purchases_withholding_account: z.preprocess(
    (value) => (value === '' || value === undefined ? '2365' : value),
    z.string().trim().max(30).default('2365'),
  ),
});

export const SiigoCredentialsSchema = z.object({
  username: z.string().trim().min(1, 'username es obligatorio').max(320),
  access_key: z.string().trim().min(1, 'access_key es obligatorio').max(400),
});

export type SiigoSettings = z.infer<typeof SiigoSettingsSchema>;
export type SiigoCredentials = z.infer<typeof SiigoCredentialsSchema>;

/**
 * Capacidades = operaciones que ESTE adapter implementa hoy (no lo que la API
 * del provider permitiría). Si se agrega un método (p. ej. escribir facturas),
 * se declara aquí y el SyncEngine empieza a ofrecer esa ruta.
 */
const SIIGO_CAPABILITIES = [
  'DOCUMENT_LOOKUP_READ',
  'THIRD_PARTIES_READ',
  'THIRD_PARTIES_WRITE',
] as const satisfies IntegrationCapability[];

const MAX_PAGES = 40;
const PAGE_SIZE = 100;
const MAX_CANDIDATES = 100;

type DocSource = 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'SUPPORT_DOCUMENT';

function isoNow(): string {
  return new Date().toISOString();
}

function toCandidate(
  source: DocSource,
  doc: Invoice | Purchase | PurchaseSupportDocument,
): ExternalDocumentCandidate {
  const stamp = 'stamp' in doc ? doc.stamp : undefined;
  const party =
    source === 'SALES_INVOICE'
      ? (doc as Invoice).customer
      : source === 'PURCHASE_INVOICE'
        ? (doc as Purchase).supplier
        : (doc as PurchaseSupportDocument).supplier;
  const providerRef = source === 'PURCHASE_INVOICE' ? (doc as Purchase).provider_invoice : undefined;
  const externalNumber = providerRef
    ? docNumber(providerRef.prefix, providerRef.number)
    : docNumber((doc as Invoice).document?.code, doc.number);

  return {
    externalId: `SIIGO:${source}:${doc.id}`,
    externalDocumentType: source,
    externalNumber,
    cufe: stamp?.cufe ?? stamp?.cude ?? null,
    total: doc.total ?? null,
    issueDate: doc.date ?? null,
    thirdPartyTaxId: party?.identification ?? null,
    contabilizado: null,
    payload: {
      siigo_id: doc.id,
      status: 'status' in doc ? (doc.status ?? null) : null,
      document: (doc as Invoice).document ?? null,
      metadata: doc.metadata ?? null,
    },
  };
}

function classifyError(error: unknown): ConnectionTestResult {
  const message = error instanceof Error ? error.message : String(error);
  const checkedAt = isoNow();
  if (error instanceof SiigoAuthenticationError) {
    return { ok: false, status: 'AUTH_ERROR', message: 'Credenciales de Siigo rechazadas', checkedAt };
  }
  if (error instanceof SiigoRateLimitError) {
    return {
      ok: false,
      status: 'ERROR',
      message: 'Siigo rechazó la petición por límite de velocidad (100 req/min por empresa)',
      checkedAt,
    };
  }
  if (error instanceof SiigoTimeoutError) {
    return { ok: false, status: 'TIMEOUT', message: 'Tiempo de espera agotado al consultar Siigo', checkedAt };
  }
  return {
    ok: false,
    status: 'ERROR',
    message: truncateMessage(message),
    checkedAt,
  };
}

export const siigoAdapter: IntegrationAdapter<SiigoSettings, SiigoCredentials, SiigoClient> = {
  provider: 'SIIGO',
  displayName: 'Siigo',

  settingsSchema: SiigoSettingsSchema,
  credentialsSchema: SiigoCredentialsSchema,

  fields: [
    { key: 'username', label: 'Usuario Siigo', type: 'secret', group: 'credentials', required: true, maxLength: 320 },
    { key: 'access_key', label: 'Access key', type: 'secret', group: 'credentials', required: true, maxLength: 400 },
    {
      key: 'partner_id',
      label: 'Partner ID',
      type: 'text',
      group: 'settings',
      required: false,
      maxLength: 100,
      help: 'Identificador de 3 a 100 caracteres alfanuméricos que Siigo registra como integrante.',
    },
    {
      key: 'base_url',
      label: 'URL base',
      type: 'text',
      group: 'settings',
      required: false,
      placeholder: 'https://api.siigo.com',
      help: 'Vacío usa https://api.siigo.com.',
    },
    {
      key: 'timeout_ms',
      label: 'Timeout (ms)',
      type: 'number',
      group: 'settings',
      required: false,
      min: 1_000,
      max: 180_000,
      help: 'Por defecto 30000.',
    },
    {
      key: 'sales_withholding_account',
      label: 'Cuenta Contable Retenciones Ventas',
      type: 'text',
      group: 'settings',
      required: false,
      placeholder: '1355',
      help: 'Cuenta contable en Siigo para retenciones practicadas en ventas (por defecto 1355 - Anticipo de impuestos).',
    },
    {
      key: 'purchases_withholding_account',
      label: 'Cuenta Contable Retenciones Compras',
      type: 'text',
      group: 'settings',
      required: false,
      placeholder: '2365',
      help: 'Cuenta contable en Siigo para retenciones practicadas en compras (por defecto 2365 - Retención en la fuente).',
    },
  ],

  capabilities: [...SIIGO_CAPABILITIES],
  syncResources: ['THIRD_PARTIES'],

  createClient(input) {
    return new SiigoClient({
      auth: { username: input.credentials.username, access_key: input.credentials.access_key },
      partnerId: input.settings.partner_id,
      baseUrl: input.settings.base_url,
      timeout: input.settings.timeout_ms,
    });
  },

  async testConnection(client) {
    const started = Date.now();
    try {
      await client.auth.getToken();
      const res: PaginatedResponse<Customer> = await client.customers.list({ page: 1, page_size: 1 });
      return {
        ok: true,
        status: 'OK',
        message: 'Conexión verificada contra la API de Siigo',
        checkedAt: isoNow(),
        details: {
          latency_ms: Date.now() - started,
          customers_total: res.pagination?.total_results ?? null,
        },
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
          ? ['PURCHASE_INVOICE', 'SUPPORT_DOCUMENT']
          : ['SALES_INVOICE', 'PURCHASE_INVOICE', 'SUPPORT_DOCUMENT'];

    const candidates: ExternalDocumentCandidate[] = [];
    const createdStart = query.issueDate ? { created_start: shiftDays(query.issueDate, -(query.windowDays ?? 20)) } : {};

    for (const source of sources) {
      if (candidates.length >= MAX_CANDIDATES) break;
      let page = 1;
      while (page <= MAX_PAGES && candidates.length < MAX_CANDIDATES) {
        const params = {
          page,
          page_size: PAGE_SIZE,
          ...createdStart,
          ...(source === 'SALES_INVOICE' && query.thirdPartyTaxId
            ? { customer_identification: query.thirdPartyTaxId }
            : {}),
          ...(source === 'PURCHASE_INVOICE' && query.thirdPartyTaxId
            ? { provider_identification: query.thirdPartyTaxId }
            : {}),
          ...(source === 'SUPPORT_DOCUMENT' && query.thirdPartyTaxId
            ? { supplier_identification: query.thirdPartyTaxId }
            : {}),
        };

        let res: PaginatedResponse<Invoice | Purchase | PurchaseSupportDocument>;
        if (source === 'SALES_INVOICE') {
          res = (await client.invoices.list(params)) as unknown as PaginatedResponse<
            Invoice | Purchase | PurchaseSupportDocument
          >;
        } else if (source === 'PURCHASE_INVOICE') {
          res = (await client.purchases.list(params)) as unknown as PaginatedResponse<
            Invoice | Purchase | PurchaseSupportDocument
          >;
        } else {
          res = (await client.purchaseSupportDocuments.list(params)) as unknown as PaginatedResponse<
            Invoice | Purchase | PurchaseSupportDocument
          >;
        }

        for (const doc of res.results) {
          const candidate = toCandidate(source, doc);
          if (matchesLookupHints(candidate, query)) candidates.push(candidate);
          if (candidates.length >= MAX_CANDIDATES) break;
        }

        if (res.results.length < PAGE_SIZE) break;
        page += 1;
      }
    }

    return candidates;
  },

  async getDocumentXml(client: SiigoClient, externalIdOrSiigoId: string): Promise<string> {
    const id = externalIdOrSiigoId.startsWith('SIIGO:')
      ? externalIdOrSiigoId.split(':')[2]
      : externalIdOrSiigoId;
    const res = await client.invoices.getXml(id);
    return Buffer.from(res.base64, 'base64').toString('utf-8');
  },

  async listThirdParties(client, options) {
    const parties: ExternalThirdParty[] = [];
    const targetLimit = options?.limit ?? Infinity;
    let page = 1;
    while (page <= MAX_PAGES && parties.length < targetLimit) {
      const pageSize = targetLimit < PAGE_SIZE ? targetLimit : PAGE_SIZE;
      const res: PaginatedResponse<Customer> = await client.customers.list({ page, page_size: pageSize });
      for (const customer of res.results) {
        parties.push({
          externalId: `SIIGO:THIRD_PARTY:${customer.id}`,
          taxId: customer.identification ?? null,
          name: [customer.name].flat().filter(Boolean).join(' ').trim() || null,
          email: customer.contacts?.[0]?.email ?? null,
          active: customer.active ?? null,
          sourceHash: null,
          payload: {
            siigo_id: customer.id,
            person_type: customer.person_type ?? null,
            id_type: typeof customer.id_type === 'string' ? customer.id_type : customer.id_type?.code ?? null,
            commercial_name: customer.commercial_name ?? null,
          },
        });
        if (parties.length >= targetLimit) break;
      }
      if (res.results.length < pageSize || parties.length >= targetLimit) break;
      page += 1;
    }
    return parties;
  },

  async createThirdParty(client, input: ThirdPartyWriteInput): Promise<ThirdPartyWriteResult> {
    const name = input.name.trim().split(/\s+/);
    const firstName = name.slice(0, -1).join(' ') || name[0] || input.name;
    const lastName = name.slice(-1)[0] ?? input.name;

    const created = await client.customers.create({
      person_type: input.taxId.length <= 10 ? 'Person' : 'Company',
      id_type: 'CC',
      identification: input.taxId,
      name,
      address: {},
      phones: [],
      contacts: input.email
        ? [{ first_name: firstName, last_name: lastName, email: input.email }]
        : [],
    } as unknown as Parameters<typeof client.customers.create>[0]);

    return { externalId: `SIIGO:THIRD_PARTY:${created.id}`, externalCode: created.id };
  },
};
