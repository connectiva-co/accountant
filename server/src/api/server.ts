import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database, Json } from '../db/schema.js';
import { loadSettings } from '../db/settings.js';
import { ImportError } from '../import/runImport.js';
import { runImport } from '../import/runImport.js';
import { SpreadsheetError } from '../import/spreadsheet.js';
import { buildDataset, listCompanies } from '../services/dataset.js';
import {
  QueryError,
  counterpartiesQuery,
  datasetQuery,
  documentsQuery,
  eventsQuery,
  issuesQuery,
  parseQuery,
  periodQuery,
  companyQuery,
  resolveIssueBody,
  settingsBody,
} from './schemas.js';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

interface ServerOptions {
  logger?: boolean;
}

function periodToIndex(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return y * 12 + (m - 1);
}

export async function buildServer(
  db: Kysely<Database>,
  options: ServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger
      ? { level: process.env.LOG_LEVEL ?? 'info' }
      : false,
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((rawError: unknown, _req, reply) => {
    const error = rawError as Error & { statusCode?: number };
    if (error instanceof QueryError) {
      return reply.status(400).send({ error: { code: 'QUERY_INVALIDA', message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ImportError) {
      return reply.status(422).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof SpreadsheetError) {
      return reply.status(422).send({ error: { code: 'ARCHIVO_INVALIDO', message: error.message } });
    }
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode < 500) {
      return reply.status(statusCode).send({ error: { code: 'SOLICITUD_INVALIDA', message: error.message } });
    }
    app.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNO', message: error.message } });
  });

  /* ---------------------------------------------------------------- */
  /* Salud y empresas                                                  */
  /* ---------------------------------------------------------------- */

  app.get('/api/health', async () => ({ ok: true, now: new Date().toISOString() }));

  app.get('/api/companies', async () => ({ companies: await listCompanies(db) }));

  /* ---------------------------------------------------------------- */
  /* Dataset (forma RADIAN, alimenta la UI existente)                  */
  /* ---------------------------------------------------------------- */

  app.get('/api/dataset', async (req) => {
    const q = parseQuery(datasetQuery, req.query);
    const dataset = await buildDataset(db, q);
    if (!dataset) throw new HttpError(404, 'SIN_EMPRESA', 'No hay empresas registradas todavía.');
    return dataset;
  });

  /* ---------------------------------------------------------------- */
  /* Importaciones                                                     */
  /* ---------------------------------------------------------------- */

  app.get('/api/imports', async (req) => {
    const q = parseQuery(companyQuery, req.query);
    let query = db
      .selectFrom('imports')
      .leftJoin('companies', 'companies.id', 'imports.company_id')
      .select([
        'imports.id as id',
        'imports.filename as filename',
        'imports.source as source',
        'imports.status as status',
        'imports.started_at as started_at',
        'imports.completed_at as completed_at',
        'imports.rows_total as rows_total',
        'imports.rows_inserted as rows_inserted',
        'imports.rows_updated as rows_updated',
        'imports.rows_unchanged as rows_unchanged',
        'imports.rows_rejected as rows_rejected',
        'imports.warnings_count as warnings_count',
        'imports.error_message as error_message',
        'companies.nit as company_nit',
        'companies.legal_name as company_name',
      ])
      .orderBy('imports.started_at', 'desc')
      .limit(100);
    if (q.company_id) query = query.where('imports.company_id', '=', q.company_id);
    return { imports: await query.execute() };
  });

  app.post('/api/imports', async (req, reply) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'SIN_ARCHIVO', 'Falta el archivo en el campo "file".');
    const buffer = await file.toBuffer();
    const result = await runImport(db, {
      buffer,
      filename: file.filename,
      source: 'RADIAN',
      createdBy: 'api',
    });
    return reply.status(result.replayed ? 200 : 201).send(result);
  });

  app.get('/api/imports/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = await db
      .selectFrom('imports')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HttpError(404, 'NO_ENCONTRADA', 'Importación no encontrada.');

    const rows = await db
      .selectFrom('import_rows')
      .select(['processing_status', (eb) => eb.fn.countAll<number>().as('count')])
      .where('import_id', '=', id)
      .groupBy('processing_status')
      .execute();

    const rejected = await db
      .selectFrom('import_rows')
      .select(['row_number', 'error_code', 'error_message'])
      .where('import_id', '=', id)
      .where('processing_status', '=', 'REJECTED')
      .orderBy('row_number')
      .limit(100)
      .execute();

    return {
      import: row,
      byStatus: rows.map((r) => ({ status: r.processing_status, count: Number(r.count) })),
      rejected,
    };
  });

  /* ---------------------------------------------------------------- */
  /* Documentos                                                        */
  /* ---------------------------------------------------------------- */

  app.get('/api/documents', async (req) => {
    const q = parseQuery(documentsQuery, req.query);
    if (!q.company_id) throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');

    let base = db
      .selectFrom('documents')
      .innerJoin('document_types', 'document_types.id', 'documents.document_type_id')
      .leftJoin('third_parties as issuer', 'issuer.id', 'documents.issuer_id')
      .leftJoin('third_parties as receiver', 'receiver.id', 'documents.receiver_id')
      .where('documents.company_id', '=', q.company_id)
      .where('documents.is_active', '=', true);

    if (q.from) base = base.where('documents.issued_at', '>=', q.from);
    if (q.to) base = base.where('documents.issued_at', '<=', q.to);
    if (q.direction) base = base.where('documents.direction', '=', q.direction);
    if (q.category) base = base.where('document_types.category', '=', q.category);
    if (q.search) {
      const like = `%${q.search}%`;
      base = base.where((eb) =>
        eb.or([
          eb('documents.external_uid', 'like', like),
          eb('documents.folio', 'like', like),
          eb('documents.status', 'like', like),
          eb('issuer.legal_name', 'like', like),
          eb('receiver.legal_name', 'like', like),
          eb('issuer.tax_id', 'like', like),
          eb('receiver.tax_id', 'like', like),
        ]),
      );
    }

    const totalRow = await base.select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirst();
    const rows = await base
      .select([
        'documents.id as id',
        'documents.external_uid as external_uid',
        'documents.issued_at as issued_at',
        'documents.total as total',
        'documents.direction as direction',
        'documents.status as status',
        'documents.folio as folio',
        'documents.prefix as prefix',
        'document_types.name as type_name',
        'document_types.code as type_code',
        'document_types.category as category',
        'issuer.tax_id as issuer_tax_id',
        'issuer.legal_name as issuer_name',
        'receiver.tax_id as receiver_tax_id',
        'receiver.legal_name as receiver_name',
      ])
      .orderBy('documents.issued_at', 'desc')
      .limit(q.limit)
      .offset(q.offset)
      .execute();

    return { total: Number(totalRow?.count ?? 0), documents: rows };
  });

  app.get('/api/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await db
      .selectFrom('documents')
      .innerJoin('document_types', 'document_types.id', 'documents.document_type_id')
      .leftJoin('third_parties as issuer', 'issuer.id', 'documents.issuer_id')
      .leftJoin('third_parties as receiver', 'receiver.id', 'documents.receiver_id')
      .selectAll('documents')
      .select([
        'document_types.name as type_name',
        'document_types.code as type_code',
        'document_types.category as category',
        'issuer.tax_id as issuer_tax_id',
        'issuer.legal_name as issuer_name',
        'receiver.tax_id as receiver_tax_id',
        'receiver.legal_name as receiver_name',
      ])
      .where('documents.id', '=', id)
      .executeTakeFirst();
    if (!doc) throw new HttpError(404, 'NO_ENCONTRADO', 'Documento no encontrado.');

    const [taxes, versions, history, issues, events] = await Promise.all([
      db
        .selectFrom('document_taxes')
        .innerJoin('tax_types', 'tax_types.id', 'document_taxes.tax_type_id')
        .select([
          'tax_types.code as code',
          'tax_types.name as name',
          'tax_types.category as category',
          'document_taxes.amount as amount',
          'document_taxes.taxable_base as taxable_base',
          'document_taxes.rate as rate',
        ])
        .where('document_taxes.document_id', '=', id)
        .execute(),
      db
        .selectFrom('document_versions')
        .select(['id', 'version_number', 'source_hash', 'created_at', 'import_id'])
        .where('document_id', '=', id)
        .orderBy('version_number', 'desc')
        .execute(),
      db
        .selectFrom('document_status_history')
        .select(['status', 'observed_at', 'import_id'])
        .where('document_id', '=', id)
        .orderBy('observed_at', 'asc')
        .execute(),
      db
        .selectFrom('validation_issues')
        .selectAll()
        .where('document_id', '=', id)
        .orderBy('created_at', 'desc')
        .execute(),
      db
        .selectFrom('document_events')
        .selectAll()
        .where('document_id', '=', id)
        .orderBy('occurred_at', 'desc')
        .execute(),
    ]);

    return { document: doc, taxes, versions, history, issues, events };
  });

  /* ---------------------------------------------------------------- */
  /* Eventos                                                           */
  /* ---------------------------------------------------------------- */

  app.get('/api/events', async (req) => {
    const q = parseQuery(eventsQuery, req.query);
    let query = db
      .selectFrom('document_events')
      .select([
        'id',
        'event_uid',
        'event_type',
        'status',
        'occurred_at',
        'document_id',
        'import_id',
        'created_at',
      ])
      .orderBy('occurred_at', 'desc')
      .limit(q.limit);
    if (q.company_id) query = query.where('company_id', '=', q.company_id);
    return { events: await query.execute() };
  });

  /* ---------------------------------------------------------------- */
  /* Validaciones                                                      */
  /* ---------------------------------------------------------------- */

  app.get('/api/issues', async (req) => {
    const q = parseQuery(issuesQuery, req.query);
    if (!q.company_id) throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');

    let query = db
      .selectFrom('validation_issues')
      .leftJoin('documents', 'documents.id', 'validation_issues.document_id')
      .selectAll('validation_issues')
      .select(['documents.external_uid as document_uid', 'documents.issued_at as issued_at'])
      .where('validation_issues.company_id', '=', q.company_id)
      .orderBy('validation_issues.created_at', 'desc')
      .limit(q.limit);

    if (q.open === 'true') query = query.where('validation_issues.resolved_at', 'is', null);
    if (q.open === 'false') query = query.where('validation_issues.resolved_at', 'is not', null);
    if (q.severity) query = query.where('validation_issues.severity', '=', q.severity);
    if (q.rule_code) query = query.where('validation_issues.rule_code', '=', q.rule_code);

    return { issues: await query.execute() };
  });

  app.post('/api/issues/:id/resolve', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseQuery(resolveIssueBody, req.body);
    const issue = await db
      .selectFrom('validation_issues')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!issue) throw new HttpError(404, 'NO_ENCONTRADA', 'Incidencia no encontrada.');

    await db
      .updateTable('validation_issues')
      .set({ resolved_at: new Date(), resolved_by: body.resolved_by ?? 'api' })
      .where('id', '=', id)
      .execute();

    await db
      .insertInto('audit_log')
      .values({
        company_id: issue.company_id,
        entity_type: 'validation_issues',
        entity_id: id,
        action: 'RESOLVE',
        actor_type: 'USER',
        actor_id: body.resolved_by ?? null,
        before: { resolved_at: issue.resolved_at } as Json,
        after: { resolved_at: new Date().toISOString() } as Json,
      })
      .execute();

    return { resolved: true, id };
  });

  /* ---------------------------------------------------------------- */
  /* Configuración                                                     */
  /* ---------------------------------------------------------------- */

  app.get('/api/settings', async (req) => {
    const q = parseQuery(companyQuery, req.query);
    const settings = await loadSettings(db, q.company_id ?? null);
    const rows = await db
      .selectFrom('settings')
      .selectAll()
      .where((eb) =>
        q.company_id
          ? eb.or([eb('company_id', 'is', null), eb('company_id', '=', q.company_id)])
          : eb('company_id', 'is', null),
      )
      .orderBy('scope')
      .orderBy('key')
      .execute();
    return { rows, effective: Object.fromEntries(settings) };
  });

  app.put('/api/settings', async (req) => {
    const body = parseQuery(settingsBody, req.body);
    const valueType = Array.isArray(body.value)
      ? 'array'
      : body.value === null
        ? 'null'
        : typeof body.value === 'object'
          ? 'object'
          : typeof body.value;
    if (!['string', 'number', 'boolean', 'array', 'object', 'null'].includes(valueType)) {
      throw new HttpError(400, 'VALOR_INVALIDO', `Tipo de valor no soportado: ${valueType}`);
    }

    const existing = await db
      .selectFrom('settings')
      .select(['id'])
      .where('scope', '=', body.scope)
      .where('key', '=', body.key)
      .where((eb) =>
        body.company_id
          ? eb('company_id', '=', body.company_id)
          : eb('company_id', 'is', null),
      )
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable('settings')
        .set({
          value: body.value as Json,
          value_type: valueType === 'null' ? null : valueType,
          description: body.description ?? null,
        })
        .where('id', '=', existing.id)
        .execute();
      return { updated: true, id: existing.id };
    }

    const inserted = await db
      .insertInto('settings')
      .values({
        company_id: body.company_id ?? null,
        scope: body.scope,
        key: body.key,
        value: body.value as Json,
        value_type: valueType === 'null' ? null : valueType,
        description: body.description ?? null,
        is_system: false,
      })
      .returning('id')
      .executeTakeFirst();
    return { created: true, id: inserted?.id };
  });

  /* ---------------------------------------------------------------- */
  /* Reportería                                                        */
  /* ---------------------------------------------------------------- */

  app.get('/api/reporting/monthly', async (req) => {
    const q = parseQuery(periodQuery, req.query);
    if (!q.company_id) throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');
    const from = q.from ? periodToIndex(q.from) : null;
    const to = q.to ? periodToIndex(q.to) : null;

    let query = db
      .selectFrom('reporting_monthly')
      .selectAll()
      .where('company_id', '=', q.company_id)
      .orderBy('year', 'asc')
      .orderBy('month', 'asc');
    if (from !== null) query = query.where(sql<boolean>`year * 12 + month - 1 >= ${from}`);
    if (to !== null) query = query.where(sql<boolean>`year * 12 + month - 1 <= ${to}`);

    return { periods: await query.execute() };
  });

  app.get('/api/reporting/counterparties', async (req) => {
    const q = parseQuery(counterpartiesQuery, req.query);
    if (!q.company_id) throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');
    const from = q.from ? periodToIndex(q.from) : null;
    const to = q.to ? periodToIndex(q.to) : null;

    let query = db
      .selectFrom('reporting_counterparty_monthly as m')
      .innerJoin('third_parties', 'third_parties.id', 'm.third_party_id')
      .select([
        'third_parties.id as id',
        'third_parties.tax_id as tax_id',
        'third_parties.legal_name as legal_name',
        'third_parties.normalized_name as normalized_name',
        (eb) => eb.fn.sum<number>('m.sales_count').as('sales_count'),
        (eb) => eb.fn.sum<number>('m.sales_total').as('sales_total'),
        (eb) => eb.fn.sum<number>('m.purchase_count').as('purchase_count'),
        (eb) => eb.fn.sum<number>('m.purchase_total').as('purchase_total'),
        (eb) => eb.fn.sum<number>('m.credit_notes_count').as('credit_notes_count'),
        (eb) => eb.fn.sum<number>('m.credit_notes_total').as('credit_notes_total'),
        (eb) => eb.fn.sum<number>('m.tax_total').as('tax_total'),
        (eb) => eb.fn.min<string>('m.first_transaction_date').as('first_transaction_date'),
        (eb) => eb.fn.max<string>('m.last_transaction_date').as('last_transaction_date'),
      ])
      .where('m.company_id', '=', q.company_id)
      .groupBy(['third_parties.id', 'third_parties.tax_id', 'third_parties.legal_name', 'third_parties.normalized_name'])
      .orderBy(sql<number>`sum(m.sales_total) + sum(m.purchase_total)`, 'desc')
      .limit(q.limit);

    if (from !== null) query = query.where(sql<boolean>`m.year * 12 + m.month - 1 >= ${from}`);
    if (to !== null) query = query.where(sql<boolean>`m.year * 12 + m.month - 1 <= ${to}`);
    if (q.search) query = query.where('third_parties.legal_name', 'ilike', `%${q.search}%`);

    let rows = await query.execute();
    if (q.role === 'cliente') rows = rows.filter((r) => Number(r.sales_count) > 0);
    if (q.role === 'proveedor') rows = rows.filter((r) => Number(r.purchase_count) > 0);

    const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

    return {
      counterparties: rows.map((r) => ({
        ...r,
        sales_count: Number(r.sales_count),
        sales_total: round2(Number(r.sales_total)),
        purchase_count: Number(r.purchase_count),
        purchase_total: round2(Number(r.purchase_total)),
        credit_notes_count: Number(r.credit_notes_count),
        credit_notes_total: round2(Number(r.credit_notes_total)),
        tax_total: round2(Number(r.tax_total)),
        total: round2(Number(r.sales_total) + Number(r.purchase_total)),
      })),
    };
  });

  app.get('/api/reporting/taxes', async (req) => {
    const q = parseQuery(periodQuery, req.query);
    if (!q.company_id) throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');
    const from = q.from ? periodToIndex(q.from) : null;
    const to = q.to ? periodToIndex(q.to) : null;

    let query = db
      .selectFrom('reporting_tax_monthly as r')
      .innerJoin('tax_types', 'tax_types.id', 'r.tax_type_id')
      .select([
        'tax_types.code as code',
        'tax_types.name as name',
        'tax_types.category as category',
        'r.direction as direction',
        (eb) => eb.fn.sum<number>('r.document_count').as('document_count'),
        (eb) => eb.fn.sum<number>('r.tax_amount').as('tax_amount'),
      ])
      .where('r.company_id', '=', q.company_id)
      .groupBy(['tax_types.code', 'tax_types.name', 'tax_types.category', 'r.direction'])
      .orderBy('tax_types.code');

    if (from !== null) query = query.where(sql<boolean>`r.year * 12 + r.month - 1 >= ${from}`);
    if (to !== null) query = query.where(sql<boolean>`r.year * 12 + r.month - 1 <= ${to}`);

    const rows = await query.execute();
    return {
      taxes: rows.map((r) => ({
        ...r,
        document_count: Number(r.document_count),
        tax_amount: Number(r.tax_amount),
      })),
    };
  });

  return app;
}
