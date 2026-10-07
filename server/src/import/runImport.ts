import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database, ImportStatus, Json, RowStatus } from '../db/schema.js';
import { loadSettings, settingBool, settingString, type SettingsMap } from '../db/settings.js';
import { fileSha256, sourceHash, type HashableDocument } from '../domain/hash.js';
import { loadDocumentTypes, type DocumentTypeIndex } from '../domain/documentTypes.js';
import { taxIdDigits } from '../domain/text.js';
import { deriveCompanyCandidate } from '../domain/uid.js';
import { parseSpreadsheet } from './spreadsheet.js';
import { normalizeRow, type NormalizedRow } from './normalizeRow.js';
import { ensureThirdParty } from './thirdParty.js';
import { periodsOfImportDocuments, refreshPeriods } from '../reporting/refresh.js';

export class ImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportInput {
  buffer: Buffer;
  filename: string;
  source?: string;
  createdBy?: string | null;
}

export interface ImportCounters {
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  warnings: number;
}

export interface ImportResult extends ImportCounters {
  importId: string;
  companyId: string | null;
  companyNit: string | null;
  companyName: string;
  /** true: el archivo ya estaba importado y no se procesó de nuevo (idempotencia). */
  replayed: boolean;
  status: ImportStatus;
  periods: string[];
  error: string | null;
}

/**
 * Importación RADIAN/XLSX:
 *  - idempotente por (empresa, SHA-256 del archivo);
 *  - reanudable: cada fila se confirma en su propia transacción;
 *  - determinista: mismo documento lógico => mismo source_hash => UNCHANGED.
 */
export async function runImport(db: Kysely<Database>, input: ImportInput): Promise<ImportResult> {
  const sha = fileSha256(input.buffer);
  const sheet = parseSpreadsheet(input.buffer, input.filename);

  const sides = sheet.records.map((r) => ({
    issuer: { nit: r['NIT Emisor'], name: r['Nombre Emisor'] },
    receiver: { nit: r['NIT Receptor'], name: r['Nombre Receptor'] },
  }));
  const candidate = deriveCompanyCandidate(sides);

  const globalSettings = await loadSettings(db, null);
  if (!candidate && settingBool(globalSettings, 'import.require_company_nit', true)) {
    throw new ImportError(
      'TU012',
      'No se pudo determinar el NIT de la empresa a partir de las filas del archivo ' +
        '(no hay NITs de emisor/receptor válidos).',
    );
  }

  const company = await ensureCompany(db, candidate);
  const settings = await loadSettings(db, company.id);

  // Idempotencia: mismo archivo para la misma empresa => no reprocesar.
  const existing = await db
    .selectFrom('imports')
    .selectAll()
    .where('company_id', '=', company.id)
    .where('file_sha256', '=', sha)
    .executeTakeFirst();

  let importId: string;
  if (existing) {
    if (existing.status === 'COMPLETED' || existing.status === 'COMPLETED_WITH_WARNINGS') {
      // Reprocesar el mismo archivo es un no-op documental, pero la reportería
      // es derivada: se refresca igual (protege contra fallos entre pasos).
      const priorPeriods = await periodsOfImportDocuments(db, existing.id);
      const refreshed = await refreshPeriods(db, company.id, priorPeriods);
      return {
        importId: existing.id,
        companyId: company.id,
        companyNit: company.nit,
        companyName: company.legal_name,
        replayed: true,
        status: existing.status,
        periods: refreshed,
        error: null,
        total: existing.rows_total,
        inserted: existing.rows_inserted,
        updated: existing.rows_updated,
        unchanged: existing.rows_unchanged,
        rejected: existing.rows_rejected,
        warnings: existing.warnings_count,
      };
    }
    importId = existing.id;
    await db
      .updateTable('imports')
      .set({ status: 'PROCESSING', error_message: null })
      .where('id', '=', importId)
      .execute();
  } else {
    const inserted = await db
      .insertInto('imports')
      .values({
        company_id: company.id,
        source: input.source ?? 'RADIAN',
        filename: input.filename,
        file_sha256: sha,
        status: 'PROCESSING',
        rows_total: sheet.records.length,
        created_by: input.createdBy ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    importId = inserted.id;
  }

  try {
    await processRows(db, {
      importId,
      companyId: company.id,
      companyNitDigits: taxIdDigits(company.nit),
      records: sheet.records,
      settings,
      filename: input.filename,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .updateTable('imports')
      .set({ status: 'FAILED', completed_at: new Date(), error_message: message })
      .where('id', '=', importId)
      .execute();
    if (error instanceof ImportError) throw error;
    throw new ImportError('TU999', `Fallo procesando "${input.filename}": ${message}`);
  }

  // Contadores y estado finales (derivados de las filas, no del estado en memoria).
  const counters = await countRows(db, importId);
  const warnings = await countWarnings(db, importId);
  const status: ImportStatus =
    counters.rejected > 0 || warnings > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';

  await db
    .updateTable('imports')
    .set({
      status,
      completed_at: new Date(),
      rows_total: sheet.records.length,
      rows_inserted: counters.inserted,
      rows_updated: counters.updated,
      rows_unchanged: counters.unchanged,
      rows_rejected: counters.rejected,
      warnings_count: warnings,
      error_message: null,
    })
    .where('id', '=', importId)
    .execute();

  // Reportería: solo los periodos con documentos tocados por esta importación.
  const periods = await periodsOfImportDocuments(db, importId);
  const refreshed = await refreshPeriods(db, company.id, periods);

  await db
    .insertInto('audit_log')
    .values({
      company_id: company.id,
      entity_type: 'imports',
      entity_id: importId,
      action: 'IMPORT',
      actor_type: 'IMPORT',
      actor_id: input.createdBy ?? null,
      after: {
        filename: input.filename,
        sha256: sha,
        status,
        rows: { ...counters, warnings, total: sheet.records.length },
        periods: refreshed,
      } as Json,
    })
    .execute();

  return {
    importId,
    companyId: company.id,
    companyNit: company.nit,
    companyName: company.legal_name,
    replayed: false,
    status,
    periods: refreshed,
    error: null,
    total: sheet.records.length,
    inserted: counters.inserted,
    updated: counters.updated,
    unchanged: counters.unchanged,
    rejected: counters.rejected,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Empresa                                                             */
/* ------------------------------------------------------------------ */

async function ensureCompany(
  db: Kysely<Database>,
  candidate: { nit: string; legalName: string } | null,
): Promise<{ id: string; nit: string; legal_name: string }> {
  if (!candidate) throw new ImportError('TU012', 'Empresa no determinable desde el archivo.');

  const existing = await db
    .selectFrom('companies')
    .select(['id', 'nit', 'legal_name'])
    .where('nit', '=', candidate.nit)
    .executeTakeFirst();

  if (existing) {
    if (!existing.legal_name && candidate.legalName) {
      await db
        .updateTable('companies')
        .set({ legal_name: candidate.legalName })
        .where('id', '=', existing.id)
        .execute();
      return { ...existing, legal_name: candidate.legalName };
    }
    return existing;
  }

  const inserted = await db
    .insertInto('companies')
    .values({ nit: candidate.nit, legal_name: candidate.legalName })
    .onConflict((oc) => oc.column('nit').doNothing())
    .returning(['id', 'nit', 'legal_name'])
    .executeTakeFirst();

  if (inserted) return inserted;

  const raced = await db
    .selectFrom('companies')
    .select(['id', 'nit', 'legal_name'])
    .where('nit', '=', candidate.nit)
    .executeTakeFirstOrThrow();
  return raced;
}

/* ------------------------------------------------------------------ */
/* Procesamiento de filas                                              */
/* ------------------------------------------------------------------ */

interface ProcessContext {
  importId: string;
  companyId: string;
  companyNitDigits: string | null;
  records: Record<string, unknown>[];
  settings: SettingsMap;
  filename: string;
}

async function processRows(db: Kysely<Database>, ctx: ProcessContext): Promise<void> {
  const allowUnknownType = settingBool(ctx.settings, 'import.allow_unknown_document_type', false);
  const unknownTypeCode = settingString(ctx.settings, 'import.unknown_document_type_code', 'OTRO');
  const rejectWithoutIds = settingBool(ctx.settings, 'import.reject_rows_without_ids', true);
  const docTypes = await loadDocumentTypes(db, unknownTypeCode);

  const taxTypeRows = await db.selectFrom('tax_types').select(['id', 'code']).execute();
  const taxTypes = new Map(taxTypeRows.map((r) => [r.code, r.id]));

  // Reanudación: filas ya terminadas y UIDs ya vistos.
  const prior = await db
    .selectFrom('import_rows')
    .select(['row_number', 'external_uid', 'processing_status'])
    .where('import_id', '=', ctx.importId)
    .execute();
  const done = new Set(
    prior
      .filter((r) => r.processing_status !== 'PENDING')
      .map((r) => r.row_number),
  );
  const seenUids = new Map<string, number>();
  for (const r of prior) {
    if (r.external_uid) seenUids.set(r.external_uid, r.row_number);
  }

  for (let i = 0; i < ctx.records.length; i++) {
    const rowNumber = i + 1;
    if (done.has(rowNumber)) continue;
    const row = normalizeRow(ctx.records[i], rowNumber, {
      companyNitDigits: ctx.companyNitDigits,
      docTypes,
      allowUnknownType,
      unknownTypeCode,
      rejectRowsWithoutIds: rejectWithoutIds,
      seenUids,
    });
    await processRow(db, ctx, row, docTypes, taxTypes);
  }
}

async function processRow(
  db: Kysely<Database>,
  ctx: ProcessContext,
  row: NormalizedRow,
  docTypes: DocumentTypeIndex,
  taxTypes: Map<string, string>,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const importRow = await trx
      .insertInto('import_rows')
      .values({
        import_id: ctx.importId,
        row_number: row.rowNumber,
        external_uid: row.externalUid,
        raw_payload: row.raw as Json,
        processing_status: 'PENDING',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const rejecting = row.issues.find((i) => i.reject);
    let rowStatus: RowStatus = 'INSERTED';
    let documentId: string | null = null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    if (rejecting) {
      rowStatus = 'REJECTED';
      errorCode = rejecting.code;
      errorMessage = rejecting.message;
    } else if (row.isEvent) {
      rowStatus = await upsertEvent(trx, ctx, row);
    } else if (row.typeCode && row.externalUid) {
      const typeId = docTypes.byCode.get(row.typeCode)?.id;
      if (!typeId) {
        rowStatus = 'REJECTED';
        errorCode = 'TU007';
        errorMessage = `Tipo de documento no resoluble: ${row.typeCode}`;
      } else {
        const outcome = await upsertDocument(trx, ctx, row, typeId, taxTypes);
        documentId = outcome.documentId;
        rowStatus = outcome.status;
      }
    } else {
      rowStatus = 'REJECTED';
      errorCode = 'TU011';
      errorMessage = 'Fila sin identificador ni tipo de documento resoluble.';
    }

    for (const issue of row.issues) {
      await trx
        .insertInto('validation_issues')
        .values({
          company_id: ctx.companyId,
          document_id: documentId,
          import_row_id: importRow.id,
          import_id: ctx.importId,
          rule_code: issue.code,
          severity: issue.severity,
          message: issue.message,
          details: { row: row.rowNumber, label: row.typeLabel } as Json,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }

    await trx
      .updateTable('import_rows')
      .set({
        processing_status: rowStatus,
        error_code: errorCode,
        error_message: errorMessage,
        document_id: documentId,
      })
      .where('id', '=', importRow.id)
      .execute();
  });
}

interface DocumentOutcome {
  documentId: string;
  status: RowStatus;
}

async function upsertDocument(
  trx: Transaction<Database>,
  ctx: ProcessContext,
  row: NormalizedRow,
  documentTypeId: string,
  taxTypes: Map<string, string>,
): Promise<DocumentOutcome> {
  const issuerId = await ensureThirdParty(
    trx,
    ctx.companyId,
    { taxId: row.issuerTaxId, checkDigit: row.issuerCheckDigit, name: row.issuerName, nameKey: row.issuerNameKey },
    ctx.importId,
  );
  const receiverId = await ensureThirdParty(
    trx,
    ctx.companyId,
    { taxId: row.receiverTaxId, checkDigit: row.receiverCheckDigit, name: row.receiverName, nameKey: row.receiverNameKey },
    ctx.importId,
  );

  const hashable: HashableDocument = {
    externalUid: row.externalUid!,
    documentTypeCode: row.typeCode!,
    folio: row.folio,
    prefix: row.prefix,
    currency: row.currency,
    paymentForm: row.paymentForm,
    paymentMethod: row.paymentMethod,
    issuedAt: row.issuedAt,
    receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
    issuerTaxId: row.issuerTaxId,
    issuerName: row.issuerName,
    receiverTaxId: row.receiverTaxId,
    receiverName: row.receiverName,
    total: row.total,
    status: row.status,
    direction: row.direction,
    taxes: row.taxes,
  };
  const hash = sourceHash(hashable);

  const existing = await trx
    .selectFrom('documents')
    .selectAll()
    .where('company_id', '=', ctx.companyId)
    .where('external_uid', '=', row.externalUid!)
    .executeTakeFirst();

  if (!existing) {
    const doc = await trx
      .insertInto('documents')
      .values({
        company_id: ctx.companyId,
        external_uid: row.externalUid!,
        document_type_id: documentTypeId,
        folio: row.folio,
        prefix: row.prefix,
        currency: row.currency,
        payment_form: row.paymentForm,
        payment_method: row.paymentMethod,
        issued_at: row.issuedAt,
        received_at: row.receivedAt,
        issuer_id: issuerId,
        receiver_id: receiverId,
        total: row.total,
        direction: row.direction,
        status: row.status,
        source: 'RADIAN',
        source_hash: hash,
        first_seen_import_id: ctx.importId,
        last_seen_import_id: ctx.importId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('document_versions')
      .values({
        document_id: doc.id,
        version_number: 1,
        source_hash: hash,
        snapshot: { ...hashable, raw: row.raw } as unknown as Json,
        import_id: ctx.importId,
      })
      .execute();

    await trx
      .insertInto('document_status_history')
      .values({ document_id: doc.id, status: row.status, import_id: ctx.importId })
      .execute();

    await insertTaxes(trx, doc.id, row.taxes, taxTypes);
    return { documentId: doc.id, status: 'INSERTED' };
  }

  if (existing.source_hash === hash) {
    await trx
      .updateTable('documents')
      .set({ last_seen_import_id: ctx.importId })
      .where('id', '=', existing.id)
      .execute();
    return { documentId: existing.id, status: 'UNCHANGED' };
  }

  await trx
    .updateTable('documents')
    .set({
      document_type_id: documentTypeId,
      folio: row.folio,
      prefix: row.prefix,
      currency: row.currency,
      payment_form: row.paymentForm,
      payment_method: row.paymentMethod,
      issued_at: row.issuedAt,
      received_at: row.receivedAt,
      issuer_id: issuerId,
      receiver_id: receiverId,
      total: row.total,
      direction: row.direction,
      status: row.status,
      source_hash: hash,
      last_seen_import_id: ctx.importId,
    })
    .where('id', '=', existing.id)
    .execute();

  const nextVersion =
    ((await trx
      .selectFrom('document_versions')
      .select((eb) => eb.fn.max<number>('version_number').as('max'))
      .where('document_id', '=', existing.id)
      .executeTakeFirst())?.max ?? 0) + 1;

  await trx
    .insertInto('document_versions')
    .values({
      document_id: existing.id,
      version_number: nextVersion,
      source_hash: hash,
      snapshot: { ...hashable, raw: row.raw } as unknown as Json,
      import_id: ctx.importId,
    })
    .execute();

  if (existing.status !== row.status) {
    await trx
      .insertInto('document_status_history')
      .values({ document_id: existing.id, status: row.status, import_id: ctx.importId })
      .execute();
  }

  await trx.deleteFrom('document_taxes').where('document_id', '=', existing.id).execute();
  await insertTaxes(trx, existing.id, row.taxes, taxTypes);

  return { documentId: existing.id, status: 'UPDATED' };
}

async function upsertEvent(
  trx: Transaction<Database>,
  ctx: ProcessContext,
  row: NormalizedRow,
): Promise<RowStatus> {
  const issuerId = await ensureThirdParty(
    trx,
    ctx.companyId,
    { taxId: row.issuerTaxId, checkDigit: row.issuerCheckDigit, name: row.issuerName, nameKey: row.issuerNameKey },
    ctx.importId,
  );
  const receiverId = await ensureThirdParty(
    trx,
    ctx.companyId,
    { taxId: row.receiverTaxId, checkDigit: row.receiverCheckDigit, name: row.receiverName, nameKey: row.receiverNameKey },
    ctx.importId,
  );

  const referenced = await trx
    .selectFrom('documents')
    .select('id')
    .where('company_id', '=', ctx.companyId)
    .where('external_uid', '=', row.externalUid!)
    .executeTakeFirst();

  const inserted = await trx
    .insertInto('document_events')
    .values({
      company_id: ctx.companyId,
      document_id: referenced?.id ?? null,
      event_uid: row.externalUid!,
      event_type: row.typeCode ?? 'APPLICATION_RESPONSE',
      status: row.status,
      occurred_at: row.receivedAt,
      issuer_id: issuerId,
      receiver_id: receiverId,
      source_payload: row.raw as Json,
      import_id: ctx.importId,
    })
    .onConflict((oc) => oc.columns(['company_id', 'event_uid']).doNothing())
    .returning('id')
    .executeTakeFirst();

  return inserted ? 'INSERTED' : 'UNCHANGED';
}

async function insertTaxes(
  trx: Transaction<Database>,
  documentId: string,
  taxes: Array<{ code: string; amount: number }>,
  taxTypes: Map<string, string>,
): Promise<void> {
  const values = taxes
    .filter((t) => taxTypes.has(t.code))
    .map((t) => ({ document_id: documentId, tax_type_id: taxTypes.get(t.code)!, amount: t.amount }));
  if (values.length === 0) return;
  await trx
    .insertInto('document_taxes')
    .values(values)
    .onConflict((oc) => oc.columns(['document_id', 'tax_type_id']).doUpdateSet({ amount: sql`excluded.amount` }))
    .execute();
}

/* ------------------------------------------------------------------ */
/* Contadores                                                          */
/* ------------------------------------------------------------------ */

async function countRows(
  db: Kysely<Database>,
  importId: string,
): Promise<Omit<ImportCounters, 'warnings'>> {
  const rows = await db
    .selectFrom('import_rows')
    .select(['processing_status', (eb) => eb.fn.countAll<number>().as('count')])
    .where('import_id', '=', importId)
    .groupBy('processing_status')
    .execute();

  const by = new Map(rows.map((r) => [r.processing_status, Number(r.count)]));
  return {
    total: [...by.values()].reduce((a, b) => a + b, 0),
    inserted: by.get('INSERTED') ?? 0,
    updated: by.get('UPDATED') ?? 0,
    unchanged: by.get('UNCHANGED') ?? 0,
    rejected: (by.get('REJECTED') ?? 0) + (by.get('ERROR') ?? 0),
  };
}

async function countWarnings(db: Kysely<Database>, importId: string): Promise<number> {
  const row = await db
    .selectFrom('validation_issues')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('import_id', '=', importId)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}
