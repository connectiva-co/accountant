import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

/** Inverso de domain/taxes.ts: código de tax_types -> columna de RADIAN. */
const RADIAN_TAX_COLUMNS: Record<string, string> = {
  IVA: 'IVA',
  IVA_RETE: 'Rete IVA',
  RENTA_RETE: 'Rete Renta',
  ICA_RETE: 'Rete ICA',
  INC: 'INC',
  IC: 'IC',
  ICA: 'ICA',
  INC_BOLSAS: 'INC Bolsas',
  IN_CARBONO: 'IN Carbono',
  INC_COMBUSTIBLES: 'IN Combustibles',
  IC_DATOS: 'IC Datos',
  ICL: 'ICL',
  INPP: 'INPP',
  IBUA: 'IBUA',
  ICUI: 'ICUI',
  TIMBRE: 'Timbre',
};

const ALL_TAX_COLUMNS = Object.values(RADIAN_TAX_COLUMNS);

export interface CompanyInfo {
  id: string;
  nit: string;
  legal_name: string;
  trade_name: string | null;
  currency: string;
  timezone: string;
  active: boolean;
}

export interface DatasetOptions {
  companyId?: string;
  from?: string;
  to?: string;
}

export interface Dataset {
  company: CompanyInfo;
  records: Array<Record<string, unknown>>;
  lastUpdate: string | null;
  counts: { documents: number; withFallbackUid: number };
}

export async function listCompanies(db: Kysely<Database>): Promise<CompanyInfo[]> {
  return db
    .selectFrom('companies')
    .select(['id', 'nit', 'legal_name', 'trade_name', 'currency', 'timezone', 'active'])
    .orderBy('legal_name')
    .execute();
}

export async function resolveCompany(
  db: Kysely<Database>,
  companyId?: string,
): Promise<CompanyInfo | null> {
  let q = db
    .selectFrom('companies')
    .select(['id', 'nit', 'legal_name', 'trade_name', 'currency', 'timezone', 'active']);
  q = companyId ? q.where('id', '=', companyId) : q.where('active', '=', true);
  const rows = await q.orderBy('created_at', 'asc').limit(companyId ? 1 : 50).execute();
  if (companyId) return rows[0] ?? null;
  return rows[0] ?? null;
}

function formatDate(d: Date | null): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateTime(d: Date | null): string {
  if (!d) return '';
  const date = formatDate(d);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${date} ${hh}:${mm}:${ss}`;
}

const FALLBACK_PREFIX = /^(FALLBACK|ROWHASH):/;

/**
 * Construye el "dataset" en forma RADIAN (mismas claves que la exportación
 * original) desde las tablas normalizadas: así la UI existente consume la base
 * sin cambiar su capa de derivación.
 */
export async function buildDataset(
  db: Kysely<Database>,
  options: DatasetOptions = {},
): Promise<Dataset | null> {
  const company = await resolveCompany(db, options.companyId);
  if (!company) return null;

  let docQuery = db
    .selectFrom('documents')
    .innerJoin('document_types', 'document_types.id', 'documents.document_type_id')
    .leftJoin('third_parties as issuer', 'issuer.id', 'documents.issuer_id')
    .leftJoin('third_parties as receiver', 'receiver.id', 'documents.receiver_id')
    .select([
      'documents.id as id',
      'documents.external_uid as external_uid',
      'documents.folio as folio',
      'documents.prefix as prefix',
      'documents.currency as currency',
      'documents.payment_form as payment_form',
      'documents.payment_method as payment_method',
      'documents.issued_at as issued_at',
      'documents.received_at as received_at',
      'documents.total as total',
      'documents.direction as direction',
      'documents.status as status',
      'documents.is_active as is_active',
      'documents.updated_at as updated_at',
      'document_types.name as type_name',
      'document_types.category as category',
      'issuer.tax_id as issuer_tax_id',
      'issuer.legal_name as issuer_name',
      'receiver.tax_id as receiver_tax_id',
      'receiver.legal_name as receiver_name',
    ])
    .where('documents.company_id', '=', company.id)
    .where('documents.is_active', '=', true);

  if (options.from) docQuery = docQuery.where('documents.issued_at', '>=', options.from);
  if (options.to) docQuery = docQuery.where('documents.issued_at', '<=', options.to);

  const docs = await docQuery
    .orderBy('documents.issued_at', 'asc')
    .orderBy('documents.created_at', 'asc')
    .execute();

  const taxRows = await db
    .selectFrom('document_taxes')
    .innerJoin('tax_types', 'tax_types.id', 'document_taxes.tax_type_id')
    .innerJoin('documents', 'documents.id', 'document_taxes.document_id')
    .select(['document_taxes.document_id as document_id', 'tax_types.code as code', 'document_taxes.amount as amount'])
    .where(
      'documents.company_id',
      '=',
      company.id,
    )
    .execute();

  const taxesByDoc = new Map<string, Map<string, number>>();
  for (const row of taxRows) {
    let map = taxesByDoc.get(row.document_id);
    if (!map) {
      map = new Map();
      taxesByDoc.set(row.document_id, map);
    }
    map.set(row.code, Number(row.amount));
  }

  const records = docs.map((d) => {
    const record: Record<string, unknown> = {
      'Tipo de documento': d.type_name,
      'CUFE/CUDE': FALLBACK_PREFIX.test(d.external_uid) ? '' : d.external_uid,
      Folio: d.folio ?? '',
      Prefijo: d.prefix ?? '',
      Divisa: d.currency,
      'Forma de Pago': d.payment_form ?? '',
      'Medio de Pago': d.payment_method ?? '',
      'Fecha Emisión': d.issued_at ? formatDate(parseIsoDate(d.issued_at)) : '',
      'Fecha Recepción': formatDateTime(d.received_at),
      'NIT Emisor': d.issuer_tax_id ?? '',
      'Nombre Emisor': d.issuer_name ?? '',
      'NIT Receptor': d.receiver_tax_id ?? '',
      'Nombre Receptor': d.receiver_name ?? '',
      Total: Number(d.total),
      Estado: d.status,
      Grupo: d.direction === 'ISSUED' ? 'Emitido' : d.direction === 'RECEIVED' ? 'Recibido' : '',
    };
    for (const col of ALL_TAX_COLUMNS) record[col] = 0;
    const taxes = taxesByDoc.get(d.id);
    if (taxes) {
      for (const [code, amount] of taxes) {
        const column = RADIAN_TAX_COLUMNS[code];
        if (column) record[column] = amount;
      }
    }
    return record;
  });

  const lastImport = await db
    .selectFrom('imports')
    .select('completed_at')
    .where('company_id', '=', company.id)
    .where('completed_at', 'is not', null)
    .orderBy('completed_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  return {
    company,
    records,
    lastUpdate: lastImport?.completed_at ? new Date(lastImport.completed_at).toISOString() : null,
    counts: {
      documents: docs.length,
      withFallbackUid: docs.filter((d) => FALLBACK_PREFIX.test(d.external_uid)).length,
    },
  };
}

function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
