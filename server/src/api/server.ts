import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError, z } from 'zod';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database, Json } from '../db/schema.js';
import { ImportError } from '../import/runImport.js';
import { ensureCompany } from '../import/runImport.js';
import { IntegrationError } from '../integrations/adapter.js';
import { IntegrationManager } from '../integrations/manager.js';
import { listAdapters } from '../integrations/registry.js';
import { loadMatchableDocument, matchDocument, persistMatch, recheckMatches } from '../integrations/matching.js';
import { parseUblInvoice } from '../domain/ubl.js';
import { siigoAdapter } from '../integrations/providers/siigo.js';
import { runThirdPartySync } from '../integrations/sync/engine.js';
import {
  clearIntegrationCredentials,
  getIntegration,
  listIntegrations,
  upsertIntegration,
  writeIntegrationCredentials,
  writeIntegrationSettings,
} from '../integrations/store.js';
import { nameKey } from '../domain/text.js';
import { SettingsService } from '../settings/service.js';
import { UnknownScopeError, UnknownSettingKeyError } from '../settings/schemas.js';
import { runImport } from '../import/runImport.js';
import { SpreadsheetError } from '../import/spreadsheet.js';
import { buildDataset } from '../services/dataset.js';
import { createGuards, currentUser } from '../auth/guards.js';
import { listMemberCompanies } from '../auth/permissions.js';
import { grantMembership } from '../auth/memberships.js';
import { allowedOrigins, CSRF_HEADER } from '../auth/constants.js';
import { audit } from '../auth/service.js';
import { registerAuthRoutes } from './authRoutes.js';
import { registerAdminRoutes } from './adminRoutes.js';
import { registerTaxRoutes } from './taxRoutes.js';
import { HttpError } from './errors.js';
import {
  QueryError,
  conflictResolveBody,
  companyParams,
  counterpartiesQuery,
  datasetQuery,
  documentsQuery,
  eventsQuery,
  integrationBody,
  integrationParams,
  issuesQuery,
  matchBody,
  matchesQuery,
  parseBody,
  parseQuery,
  periodQuery,
  companyQuery,
  resolveIssueBody,
  settingsBody,
  syncRunBody,
} from './schemas.js';

export { HttpError };

interface ServerOptions {
  logger?: boolean;
}

function periodToIndex(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return y * 12 + (m - 1);
}

function integrationStatus(error: IntegrationError): number {
  switch (error.code) {
    case 'PROVIDER_DESCONOCIDO':
    case 'SIN_INTEGRACION':
      return 404;
    case 'INTEGRACION_DESHABILITADA':
    case 'SIN_CREDENCIALES':
    case 'SIN_CAPABILIDAD':
      return 409;
    case 'CONFIGURACION_INVALIDA':
    case 'CREDENCIALES_INVALIDAS':
      return 422;
    case 'SECRETS_SIN_LLAVE':
      return 503;
    case 'TEST_FALLIDO':
    case 'PROVIDER_ERROR':
      return 502;
    default:
      return 500;
  }
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

  await app.register(cookie);

  // Cookies de sesión: solo orígenes permitidos (CORS con credenciales).
  const explicitOrigins = allowedOrigins();
  const allowAll = explicitOrigins.includes('*');
  await app.register(cors, {
    credentials: true,
    origin: (origin, cb) => {
      if (!origin || allowAll) return cb(null, true);
      if (explicitOrigins.includes(origin)) return cb(null, true);
      try {
        const host = new URL(origin).hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local')) {
          return cb(null, true);
        }
        const parts = host.split('.').map(Number);
        if (parts.length === 4 && parts.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
          // Local/private IPv4 and Tailscale (100.64.0.0/10)
          if (parts[0] === 127 || parts[0] === 10) return cb(null, true);
          if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return cb(null, true);
          if (parts[0] === 192 && parts[1] === 168) return cb(null, true);
          if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return cb(null, true);
        }
      } catch {
        // origen mal formado
      }
      return cb(null, false);
    },
    allowedHeaders: ['Content-Type', CSRF_HEADER],
  });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });

  const settings = new SettingsService(db);
  const integrations = new IntegrationManager(db, {
    warn: (data, message) => app.log.warn(data, message),
    error: (data, message) => app.log.error(data, message),
  });
  app.addHook('onClose', async () => integrations.dispose());

  // Autenticación global: sesión por cookie httpOnly + CSRF en mutaciones.
  // Las rutas definen además empresa (membresía) y permisos vía guards.
  const guards = createGuards(db);
  app.addHook('onRequest', guards.authenticate);

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
    if (error instanceof IntegrationError) {
      return reply.status(integrationStatus(error)).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof UnknownScopeError || error instanceof UnknownSettingKeyError) {
      return reply.status(400).send({ error: { code: 'SETTING_DESCONOCIDO', message: error.message } });
    }
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(422).send({ error: { code: 'VALIDACION', message } });
    }
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode < 500) {
      return reply.status(statusCode).send({ error: { code: 'SOLICITUD_INVALIDA', message: error.message } });
    }
    app.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNO', message: error.message } });
  });

  /* ---------------------------------------------------------------- */
  /* Salud, autenticación y empresas                                  */
  /* ---------------------------------------------------------------- */

  await registerAuthRoutes(app, db, guards);
  registerAdminRoutes(app, db, guards);
  registerTaxRoutes(app, db, guards);

  app.get('/api/health', async () => ({ ok: true, now: new Date().toISOString() }));

  app.get('/api/companies', { preHandler: guards.requireAuth }, async (req) => {
    const user = guards.principal(req).user;
    const rows = await listMemberCompanies(db, user.id);
    return {
      companies: rows.map((row) => ({
        id: row.id,
        nit: row.nit,
        legal_name: row.legal_name,
        trade_name: row.trade_name,
        currency: row.currency,
        timezone: row.timezone,
        active: row.active,
      })),
    };
  });

  /* ---------------------------------------------------------------- */
  /* Dataset (forma RADIAN, alimenta la UI existente)                  */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/dataset',
    { preHandler: [guards.requireCompanyIfPresent, guards.requirePermission('documents.read')] },
    async (req) => {
      const q = parseQuery(datasetQuery, req.query);
      let companyId = q.company_id;
      if (!companyId) {
        // Sin company_id explícito: la primera empresa con membresía ACTIVE.
        const user = currentUser(req);
        const member = (await listMemberCompanies(db, user.id))[0];
        if (!member) throw new HttpError(403, 'SIN_ACCESO', 'No tienes empresas asignadas.');
        companyId = member.id;
      }
      const dataset = await buildDataset(db, { companyId, from: q.from, to: q.to });
      if (!dataset) throw new HttpError(404, 'SIN_EMPRESA', 'No hay empresas registradas todavía.');
      return dataset;
    },
  );

  /* ---------------------------------------------------------------- */
  /* Importaciones                                                     */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/imports',
    { preHandler: [guards.requireCompany, guards.requirePermission('radian.read')] },
    async (req) => {
      const q = parseQuery(companyQuery, req.query);
      if (!q.company_id) throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');
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
    query = query.where('imports.company_id', '=', q.company_id);
    return { imports: await query.execute() };
  });

  app.post(
    '/api/imports',
    { preHandler: [guards.requireAuth, guards.requirePermission('radian.import')] },
    async (req, reply) => {
      const file = await req.file();
      if (!file) throw new HttpError(400, 'SIN_ARCHIVO', 'Falta el archivo en el campo "file".');
      const buffer = await file.toBuffer();
      const user = currentUser(req);

      // La empresa se conoce recién al parsear el archivo (NIT emisor/receptor):
      // se exige la membresía ANTES de persistir cualquier cosa.
      const resolveCompany = async (candidate: { nit: string; legalName: string } | null) => {
        if (!candidate) return ensureCompany(db, null);
        const existing = await db
          .selectFrom('companies')
          .select(['id'])
          .where('nit', '=', candidate.nit)
          .executeTakeFirst();
        if (existing) {
          await guards.assertCompanyPermission(user, existing.id, 'radian.import');
          return ensureCompany(db, candidate);
        }
        // Empresa nueva: la crea y queda como OWNER quien importa (nunca un
        // usuario ajeno puede quedarse con el acceso).
        const company = await ensureCompany(db, candidate);
        await grantMembership(db, {
          companyId: company.id,
          userId: user.id,
          roleCode: 'OWNER',
        });
        await audit(db, {
          companyId: company.id,
          entityType: 'companies',
          entityId: company.id,
          action: 'INSERT',
          userId: user.id,
          ip: req.ip,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
          after: { nit: company.nit, legal_name: company.legal_name } as Json,
          metadata: { via: 'import' } as Json,
        });
        return company;
      };

      const result = await runImport(db, {
        buffer,
        filename: file.filename,
        source: 'RADIAN',
        createdBy: user.id,
        resolveCompany,
      });
      return reply.status(result.replayed ? 200 : 201).send(result);
    },
  );

  app.get(
    '/api/imports/:id',
    { preHandler: [guards.requireCompany, guards.requirePermission('radian.read')] },
    async (req) => {
    const { id } = req.params as { id: string };
    const q = parseQuery(companyQuery, req.query);
    if (!q.company_id) throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');
    const row = await db
      .selectFrom('imports')
      .selectAll()
      .where('id', '=', id)
      .where('company_id', '=', q.company_id)
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

  app.get(
    '/api/documents',
    { preHandler: [guards.requireCompany, guards.requirePermission('documents.read')] },
    async (req) => {
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

  app.get(
    '/api/documents/:id',
    { preHandler: [guards.requireCompany, guards.requirePermission('documents.read')] },
    async (req) => {
      const { id } = req.params as { id: string };
    const q = parseQuery(companyQuery, req.query);
    if (!q.company_id) throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');
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
      .where('documents.company_id', '=', q.company_id)
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

  app.get(
    '/api/events',
    { preHandler: [guards.requireCompany, guards.requirePermission('documents.read')] },
    async (req) => {
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
    if (!q.company_id) throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');
    query = query.where('company_id', '=', q.company_id);
    return { events: await query.execute() };
  });

  /* ---------------------------------------------------------------- */
  /* Validaciones                                                      */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/issues',
    { preHandler: [guards.requireCompany, guards.requirePermission('issues.read')] },
    async (req) => {
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

  app.post(
    '/api/issues/:id/resolve',
    { preHandler: [guards.requireCompany, guards.requirePermission('issues.resolve')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = parseQuery(resolveIssueBody, req.body);
      const user = currentUser(req);
      if (!body.company_id) throw new HttpError(400, 'SIN_EMPRESA', 'company_id es obligatorio.');
    const issue = await db
      .selectFrom('validation_issues')
      .selectAll()
      .where('id', '=', id)
      .where('company_id', '=', body.company_id)
      .executeTakeFirst();
    if (!issue) throw new HttpError(404, 'NO_ENCONTRADA', 'Incidencia no encontrada.');

    await db
      .updateTable('validation_issues')
      .set({ resolved_at: new Date(), resolved_by: user.id })
      .where('id', '=', id)
      .execute();

    await audit(db, {
      companyId: issue.company_id,
      entityType: 'validation_issues',
      entityId: id,
      action: 'RESOLVE',
      userId: user.id,
      ip: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      before: { resolved_at: issue.resolved_at } as Json,
      after: { resolved_at: new Date().toISOString() } as Json,
    });

    return { resolved: true, id };
  });

  /* ---------------------------------------------------------------- */
  /* Configuración                                                     */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/settings',
    { preHandler: [guards.requireCompanyIfPresent, guards.requirePermission('settings.read')] },
    async (req) => {
      const q = parseQuery(companyQuery, req.query);
    const rows = await settings.getAll(q.company_id ?? null);
    const effective = await settings.loadMap(q.company_id ?? null);
    return { rows, effective: Object.fromEntries(effective) };
  });

  app.put(
    '/api/settings',
    { preHandler: [guards.requireCompanyIfPresent, guards.requirePermission('settings.write')] },
    async (req) => {
      const body = parseQuery(settingsBody, req.body);
      const user = currentUser(req);
      const entry = await settings.set(body.company_id ?? null, body.scope, body.key, body.value, {
        actorType: 'USER',
        actorId: user.id,
        description: body.description ?? null,
      });
    return { created: entry.id === null, updated: entry.id !== null, id: entry.id, entry };
  });

  /* ---------------------------------------------------------------- */
  /* Integraciones                                                     */
  /* ---------------------------------------------------------------- */

  const catalogEntry = (provider: string) => {
    const adapter = listAdapters().find((item) => item.provider === provider);
    if (!adapter) return null;
    return {
      provider: adapter.provider,
      name: adapter.displayName,
      capabilities: adapter.capabilities,
      sync_resources: adapter.syncResources,
      fields: adapter.fields,
    };
  };

  /** Integración habilitada a usar: la indicada o la primera disponible. */
  const pickIntegration = async (companyId: string, provider?: string) => {
    const summaries = (await listIntegrations(db, companyId)).filter(
      (item) => item.enabled && item.status !== 'DISABLED',
    );
    const chosen = provider ? summaries.find((item) => item.provider === provider) : summaries[0];
    if (!chosen) {
      throw new HttpError(
        409,
        'SIN_INTEGRACION',
        provider
          ? `La empresa no tiene una integración habilitada con "${provider}".`
          : 'La empresa no tiene integraciones habilitadas.',
      );
    }
    return chosen;
  };

  app.get(
    '/api/companies/:companyId/integrations',
    { preHandler: [guards.requireCompany, guards.requirePermission('integrations.read')] },
    async (req) => {
      const { companyId } = parseBody(companyParams, req.params);
    return {
      integrations: await listIntegrations(db, companyId),
      catalog: listAdapters().map((adapter) => ({
        provider: adapter.provider,
        name: adapter.displayName,
        capabilities: adapter.capabilities,
        sync_resources: adapter.syncResources,
        fields: adapter.fields,
      })),
    };
  });

  app.get(
    '/api/companies/:companyId/integrations/:provider',
    { preHandler: [guards.requireCompany, guards.requirePermission('integrations.read')] },
    async (req) => {
      const params = parseBody(integrationParams, req.params);
    const integration = await getIntegration(db, params.companyId, params.provider);
    if (!integration) throw new HttpError(404, 'SIN_INTEGRACION', 'Integración no registrada.');
    return { integration, catalog: catalogEntry(params.provider) };
  });

  /**
   * Crea/actualiza la integración. Los settings se validan contra el schema
   * del adapter; las credenciales se validan igual y se guardan cifradas.
   * Nunca se devuelven secretos en la respuesta.
   */
  app.put(
    '/api/companies/:companyId/integrations/:provider',
    {
      preHandler: [
        guards.requireCompany,
        (req, reply) => {
          const body = (req.body ?? {}) as { credentials?: unknown; clear_credentials?: boolean };
          const writesCredentials =
            body.credentials !== undefined || body.clear_credentials === true;
          return guards.requirePermission(
            writesCredentials ? 'integrations.credentials.write' : 'integrations.configure',
          )(req, reply);
        },
      ],
    },
    async (req) => {
      const params = parseBody(integrationParams, req.params);
      const body = parseBody(integrationBody, req.body);
      const user = currentUser(req);
    const adapter = listAdapters().find((item) => item.provider === params.provider);
    if (!adapter) throw new HttpError(404, 'PROVIDER_DESCONOCIDO', `Provider "${params.provider}" no registrado.`);

    const before = await getIntegration(db, params.companyId, params.provider);
    const integrationId = await upsertIntegration(db, {
      companyId: params.companyId,
      provider: params.provider,
      name: body.name,
      enabled: body.enabled,
    });

    if (body.settings !== undefined) {
      const parsed = adapter.settingsSchema.parse(body.settings ?? {});
      await writeIntegrationSettings(db, integrationId, parsed as Record<string, unknown>);
    }

    if (body.credentials !== undefined && body.credentials !== null) {
      const parsed = adapter.credentialsSchema.parse(body.credentials);
      await writeIntegrationCredentials(db, integrationId, parsed as Record<string, unknown>);
    }

    if (body.clear_credentials) await clearIntegrationCredentials(db, integrationId);

    const summary = await getIntegration(db, params.companyId, params.provider);
    if (summary) {
      const nextStatus = !summary.has_credentials
        ? 'NOT_CONFIGURED'
        : summary.status === 'NOT_CONFIGURED'
          ? 'CONFIGURED'
          : summary.status;
      if (nextStatus !== summary.status) {
        await db
          .updateTable('company_integrations')
          .set({ status: nextStatus })
          .where('id', '=', integrationId)
          .execute();
      }
    }

    integrations.invalidate(integrationId);

    const actions: Array<{ action: string; after: Json }> = [];
    if (!before) actions.push({ action: 'INTEGRATION_CREATED', after: { provider: params.provider, enabled: body.enabled ?? true } as Json });
    if (body.settings !== undefined) actions.push({ action: 'INTEGRATION_SETTINGS_UPDATED', after: (body.settings ?? {}) as Json });
    if (body.credentials !== undefined || body.clear_credentials) {
      actions.push({ action: 'INTEGRATION_CREDENTIALS_UPDATED', after: { has_credentials: Boolean(body.credentials) && !body.clear_credentials } as Json });
    }
    if (body.enabled !== undefined && before && body.enabled !== before.enabled) {
      actions.push({ action: body.enabled ? 'INTEGRATION_ENABLED' : 'INTEGRATION_DISABLED', after: { enabled: body.enabled } as Json });
    }

    for (const entry of actions) {
      await audit(db, {
        companyId: params.companyId,
        entityType: 'company_integration',
        entityId: integrationId,
        action: entry.action,
        userId: user.id,
        ip: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        before: null,
        after: entry.after,
        metadata: { provider: params.provider } as Json,
      });
    }

    return {
      integration: await getIntegration(db, params.companyId, params.provider),
      catalog: catalogEntry(params.provider),
    };
  });

  app.post(
    '/api/companies/:companyId/integrations/:provider/test',
    { preHandler: [guards.requireCompany, guards.requirePermission('integrations.test')] },
    async (req) => {
      const params = parseBody(integrationParams, req.params);
    const result = await integrations.testConnection(params.companyId, params.provider, {
      actorType: 'USER',
      actorId: 'api',
    });
    return { result, integration: await getIntegration(db, params.companyId, params.provider) };
  });

  /* ---------------------------------------------------------------- */
  /* Matching RADIAN ↔ ERP                                             */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/companies/:companyId/matches',
    { preHandler: [guards.requireCompany, guards.requirePermission('sync.read')] },
    async (req) => {
      const { companyId } = parseBody(companyParams, req.params);
    const q = parseQuery(matchesQuery, req.query);
    let query = db
      .selectFrom('document_integration_matches as m')
      .innerJoin('documents as d', 'd.id', 'm.document_id')
      .select([
        'm.id as id',
        'm.document_id as document_id',
        'm.company_integration_id as company_integration_id',
        'm.match_status as match_status',
        'm.match_method as match_method',
        'm.confidence as confidence',
        'm.external_id as external_id',
        'm.external_document_type as external_document_type',
        'm.external_number as external_number',
        'm.matched_at as matched_at',
        'm.last_checked_at as last_checked_at',
        'm.error_message as error_message',
        'd.external_uid as external_uid',
        'd.prefix as prefix',
        'd.folio as folio',
        'd.issued_at as issued_at',
        'd.total as total',
        'd.direction as direction',
      ])
      .where('m.company_id', '=', companyId)
      .orderBy('m.updated_at', 'desc')
      .limit(q.limit);
    if (q.status) query = query.where('m.match_status', '=', q.status);
    return { matches: await query.execute() };
  });

  app.post(
    '/api/companies/:companyId/documents/:documentId/match',
    { preHandler: [guards.requireCompany, guards.requirePermission('sync.execute')] },
    async (req) => {
      const params = parseBody(companyParams.extend({ documentId: z.string().uuid() }), req.params);
    const body = parseBody(matchBody, req.body);
    const chosen = await pickIntegration(params.companyId, body.provider);
    const resolved = await integrations.getClient(params.companyId, chosen.provider);

    const doc = await loadMatchableDocument(db, params.companyId, params.documentId);
    if (!doc) throw new HttpError(404, 'NO_ENCONTRADO', 'Documento no encontrado.');

    const outcome = await matchDocument(resolved, doc, { windowDays: body.window_days });
    const saved = await persistMatch(db, {
      companyId: params.companyId,
      documentId: params.documentId,
      companyIntegrationId: chosen.id,
      outcome,
      dryRun: body.dry_run,
    });

    return { document_id: params.documentId, provider: chosen.provider, outcome, saved };
  });

  app.post(
    '/api/companies/:companyId/matches/recheck',
    { preHandler: [guards.requireCompany, guards.requirePermission('sync.execute')] },
    async (req) => {
      const { companyId } = parseBody(companyParams, req.params);
    const body = parseBody(matchBody, req.body);
    const summary = await recheckMatches(db, companyId, (provider) => integrations.getClient(companyId, provider), {
      provider: body.provider,
      limit: body.limit,
      windowDays: body.window_days,
      dryRun: body.dry_run,
    });
    return { summary };
  });

  app.get(
    '/api/companies/:companyId/documents/:documentId/xml',
    { preHandler: [guards.requireCompany, guards.requirePermission('documents.read')] },
    async (req) => {
      const { companyId, documentId } = parseBody(companyParams.extend({ documentId: z.string().uuid() }), req.params);

      const doc = await db
        .selectFrom('documents')
        .innerJoin('document_types', 'document_types.id', 'documents.document_type_id')
        .selectAll('documents')
        .select(['document_types.code as type_code', 'document_types.name as type_name'])
        .where('documents.id', '=', documentId)
        .where('documents.company_id', '=', companyId)
        .executeTakeFirst();

      if (!doc) throw new HttpError(404, 'NO_ENCONTRADO', 'Documento no encontrado.');

      if (doc.direction !== 'ISSUED') {
        throw new HttpError(
          400,
          'XML_NO_DISPONIBLE_ERP',
          'La API de Siigo solo expone XML UBL 2.1 para Facturas de Venta emitidas. Para compras o gastos recibidos, el XML se consulta en el buzón DIAN/RADIAN.',
        );
      }

      // 1. Check for existing match
      const match = await db
        .selectFrom('document_integration_matches')
        .selectAll()
        .where('document_id', '=', documentId)
        .where('company_id', '=', companyId)
        .executeTakeFirst();

      let siigoInvoiceId: string | null = null;
      if (match?.external_id && match.external_id.startsWith('SIIGO:SALES_INVOICE:')) {
        siigoInvoiceId = match.external_id.replace('SIIGO:SALES_INVOICE:', '');
      }

      const resolved = await integrations.getClient(companyId, 'SIIGO');

      // 2. If not yet matched, attempt dynamic match against Siigo
      if (!siigoInvoiceId) {
        const matchable = await loadMatchableDocument(db, companyId, documentId);
        if (matchable) {
          const outcome = await matchDocument(resolved, matchable, { windowDays: 45 });
          if (outcome.candidate?.payload && typeof outcome.candidate.payload.siigo_id === 'string') {
            siigoInvoiceId = outcome.candidate.payload.siigo_id;
            const chosen = await pickIntegration(companyId, 'SIIGO');
            await persistMatch(db, {
              companyId,
              documentId,
              companyIntegrationId: chosen.id,
              outcome,
              dryRun: false,
            });
          } else if (outcome.status === 'ERROR') {
            const chosen = await pickIntegration(companyId, 'SIIGO');
            await persistMatch(db, {
              companyId,
              documentId,
              companyIntegrationId: chosen.id,
              outcome,
              dryRun: false,
            });
            throw new HttpError(
              502,
              'ERROR_CONSULTA_SIIGO',
              `Error al consultar en Siigo: ${outcome.errorMessage || 'Error desconocido del ERP'}`,
            );
          }
        }
      }

      if (!siigoInvoiceId) {
        const prevMatch = await db
          .selectFrom('document_integration_matches')
          .select(['match_status', 'error_message'])
          .where('company_id', '=', companyId)
          .where('document_id', '=', documentId)
          .executeTakeFirst();

        const extra = prevMatch?.error_message ? ` (Detalle reportado: ${prevMatch.error_message})` : '';

        throw new HttpError(
          404,
          'FACTURA_NO_ENCONTRADA_SIIGO',
          `No se encontró la factura ${doc.prefix ? `${doc.prefix}-${doc.folio}` : doc.folio || doc.external_uid} en Siigo${extra}.`,
        );
      }

      try {
        if (!siigoAdapter.getDocumentXml) {
          throw new HttpError(500, 'NO_IMPLEMENTADO', 'El adaptador de Siigo no implementa descarga de XML.');
        }
        const rawXml = await siigoAdapter.getDocumentXml(resolved.client as any, siigoInvoiceId);
        const invoice = parseUblInvoice(rawXml);

        return {
          document_id: documentId,
          siigo_invoice_id: siigoInvoiceId,
          invoice,
          raw_xml: rawXml,
        };
      } catch (err: any) {
        throw new HttpError(
          502,
          'ERROR_DESCARGA_XML_SIIGO',
          `Error al obtener el XML UBL 2.1 desde Siigo: ${err?.message || String(err)}`,
        );
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Catálogo de Tipos de Documento/Comprobante de Siigo              */
  /* ---------------------------------------------------------------- */
  app.get(
    '/api/companies/:companyId/integrations/siigo/document-types',
    {
      preHandler: [guards.requireCompany, guards.requirePermission('sync.execute')],
    },
    async (req) => {
      const { companyId } = req.params as { companyId: string };
      const { type } = req.query as { type?: string };
      const resolved = await integrations.getClient(companyId, 'SIIGO');
      const siigoClient = resolved.client as any;
      try {
        const types = await siigoClient.catalogs.documentTypes({ type: type || 'CC' });
        return { document_types: types || [] };
      } catch (err: any) {
        throw new HttpError(502, 'ERROR_CATALOGO_SIIGO', `Error consultando tipos de documento de Siigo: ${err?.message || String(err)}`);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Plan de Cuentas (PUC / Accounting Accounts)                      */
  /* ---------------------------------------------------------------- */
  app.get(
    '/api/companies/:companyId/accounting-accounts',
    {
      preHandler: [guards.requireCompany, guards.requirePermission('integrations.read')],
    },
    async (req) => {
      const { companyId } = req.params as { companyId: string };
      const { activeOnly, category } = req.query as { activeOnly?: string; category?: string };

      let query = db
        .selectFrom('accounting_accounts')
        .selectAll()
        .where('company_id', '=', companyId);

      if (activeOnly === 'true') {
        query = query.where('is_active', '=', true);
      }
      if (category) {
        query = query.where('category', '=', category);
      }

      const accounts = await query.orderBy('code', 'asc').execute();
      return { accounts };
    },
  );

  app.patch(
    '/api/companies/:companyId/accounting-accounts/toggle-all',
    {
      preHandler: [guards.requireCompany, guards.requirePermission('integrations.configure')],
    },
    async (req) => {
      const { companyId } = req.params as { companyId: string };
      const { is_active, category } = req.body as { is_active: boolean; category?: string };

      let query = db
        .updateTable('accounting_accounts')
        .set({ is_active, updated_at: new Date() })
        .where('company_id', '=', companyId);

      if (category && category !== 'ALL') {
        if (category === 'EXPENSE') {
          query = query.where((eb) =>
            eb.or([
              eb('code', 'like', '5%'),
              eb('code', 'like', '6%'),
              eb('code', 'like', '7%'),
            ])
          );
        } else if (category === 'LIABILITY') {
          query = query.where('code', 'like', '2%');
        } else if (category === 'ASSET') {
          query = query.where('code', 'like', '1%');
        } else if (category === 'REVENUE') {
          query = query.where('code', 'like', '4%');
        }
      }

      await query.execute();
      return { success: true };
    },
  );

  app.patch(
    '/api/companies/:companyId/accounting-accounts/:id/toggle',
    {
      preHandler: [guards.requireCompany, guards.requirePermission('integrations.configure')],
    },
    async (req) => {
      const { companyId, id } = req.params as { companyId: string; id: string };
      const { is_active } = req.body as { is_active: boolean };

      await db
        .updateTable('accounting_accounts')
        .set({ is_active, updated_at: new Date() })
        .where('id', '=', id)
        .where('company_id', '=', companyId)
        .execute();

      return { success: true };
    },
  );

  app.post(
    '/api/companies/:companyId/integrations/siigo/sync-accounts',
    {
      preHandler: [guards.requireCompany, guards.requirePermission('sync.execute')],
    },
    async (req) => {
      const { companyId } = req.params as { companyId: string };
      const resolved = await integrations.getClient(companyId, 'SIIGO');
      const siigoClient = resolved.client as any;

      try {
        const currentYear = new Date().getFullYear();
        // 1. Solicitar a Siigo el reporte de balance de prueba
        const report = await siigoClient.reports.testBalance({
          year: currentYear,
          month_start: 1,
          month_end: 12,
          includes_tax_difference: true,
        });

        if (!report || !report.file_url) {
          throw new HttpError(502, 'ERROR_REPORTE_SIIGO', 'Siigo no devolvió la URL del archivo de balance.');
        }

        // 2. Descargar el archivo Excel
        const fileResponse = await fetch(report.file_url);
        if (!fileResponse.ok) {
          throw new HttpError(502, 'ERROR_DESCARGA_EXCEL', 'No se pudo descargar el archivo Excel de Siigo.');
        }

        const arrayBuffer = await fileResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        sheet['!ref'] = 'A1:Z10000';
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        // 3. Extraer cuentas auxiliares transaccionales (Nivel: Auxiliar, Transaccional: Sí)
        const accountsToUpsert = new Map<string, { code: string; name: string; level: string; category: string }>();

        for (let i = 8; i < rows.length; i++) {
          const row = rows[i];
          if (!row) continue;
          const level = String(row[0] || '').trim();
          const code = String(row[2] || '').trim();
          const name = String(row[3] || '').trim();

          // Filtrar por Nivel Auxiliar y código numérico válido
          if (level === 'Auxiliar' && code && /^\d+$/.test(code)) {
            let cat = 'OTHER';
            if (code.startsWith('1')) cat = 'ASSET';
            else if (code.startsWith('2')) cat = 'LIABILITY';
            else if (code.startsWith('3')) cat = 'EQUITY';
            else if (code.startsWith('4')) cat = 'REVENUE';
            else if (code.startsWith('5') || code.startsWith('6') || code.startsWith('7')) cat = 'EXPENSE';

            accountsToUpsert.set(code, {
              code,
              name: name || `Cuenta ${code}`,
              level,
              category: cat,
            });
          }
        }

        // 4. Guardar en base de datos
        let inserted = 0;
        let updated = 0;

        for (const item of accountsToUpsert.values()) {
          const existing = await db
            .selectFrom('accounting_accounts')
            .select(['id'])
            .where('company_id', '=', companyId)
            .where('code', '=', item.code)
            .executeTakeFirst();

          if (existing) {
            await db
              .updateTable('accounting_accounts')
              .set({
                name: item.name,
                level: item.level,
                category: item.category,
                updated_at: new Date(),
              })
              .where('id', '=', existing.id)
              .execute();
            updated++;
          } else {
            await db
              .insertInto('accounting_accounts')
              .values({
                company_id: companyId,
                code: item.code,
                name: item.name,
                level: item.level,
                category: item.category,
                is_transactional: true,
                is_active: false,
              })
              .execute();
            inserted++;
          }
        }

        return {
          success: true,
          total_synced: accountsToUpsert.size,
          inserted,
          updated,
        };
      } catch (err: any) {
        req.log.error({ err }, 'Error sincronizando cuentas contables desde Siigo');
        throw new HttpError(502, 'ERROR_SYNC_CUENTAS', `Error sincronizando cuentas desde Siigo: ${err.message || String(err)}`);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Emisión / Sincronización de Factura o Compra a Siigo             */
  /* ---------------------------------------------------------------- */
  app.post(
    '/api/companies/:companyId/documents/:documentId/sync-to-siigo',
    {
      preHandler: [guards.requireCompany, guards.requirePermission('sync.execute')],
    },
    async (req) => {
      const { companyId, documentId } = req.params as { companyId: string; documentId: string };

      // 1. Obtener documento y terceros
      const doc = await db
        .selectFrom('documents')
        .leftJoin('third_parties as issuer', 'issuer.id', 'documents.issuer_id')
        .leftJoin('third_parties as receiver', 'receiver.id', 'documents.receiver_id')
        .selectAll('documents')
        .select([
          'issuer.tax_id as issuer_nit',
          'issuer.legal_name as issuer_name',
          'receiver.tax_id as receiver_nit',
          'receiver.legal_name as receiver_name',
        ])
        .where('documents.id', '=', documentId)
        .where('documents.company_id', '=', companyId)
        .executeTakeFirst();

      if (!doc) {
        throw new HttpError(404, 'DOCUMENTO_NO_ENCONTRADO', 'Documento no encontrado.');
      }

      // 2. Obtener cliente Siigo
      const resolved = await integrations.getClient(companyId, 'SIIGO');
      const siigoClient = resolved.client as any;

      // 3. Determinar tercero y dirección
      const isPurchase = doc.direction === 'RECEIVED';
      const thirdPartyId = isPurchase ? doc.issuer_id : doc.receiver_id;
      const thirdPartyNit = isPurchase ? doc.issuer_nit : doc.receiver_nit;

      if (!thirdPartyNit) {
        throw new HttpError(400, 'TERCERO_SIN_NIT', 'El tercero del documento no tiene NIT.');
      }

      // 4. Obtener determinaciones de impuestos
      const determinations = await db
        .selectFrom('document_tax_determinations as d')
        .innerJoin('tax_types as tt', 'tt.id', 'd.tax_type_id')
        .selectAll('d')
        .select(['tt.code as tax_type_code', 'tt.name as tax_type_name'])
        .where('d.document_id', '=', documentId)
        .where('d.company_id', '=', companyId)
        .execute();

      // 5. Obtener reglas de cuenta contable del tercero y de la empresa
      const tpRules = thirdPartyId
        ? await db
            .selectFrom('third_party_tax_rules')
            .selectAll()
            .where('company_id', '=', companyId)
            .where('third_party_id', '=', thirdPartyId)
            .execute()
        : [];

      const companyConfigs = await db
        .selectFrom('company_tax_configurations')
        .selectAll()
        .where('company_id', '=', companyId)
        .execute();

      // Perfil del tercero para cuentas de gasto / contrapartida y por pagar
      const tpProfile = thirdPartyId
        ? await db
            .selectFrom('third_party_tax_profiles')
            .selectAll()
            .where('company_id', '=', companyId)
            .where('third_party_id', '=', thirdPartyId)
            .orderBy('valid_from', 'desc')
            .executeTakeFirst()
        : null;

      // 6. Preparar líneas del comprobante contable (Journal)
      // Tipo de comprobante en Siigo:
      // Prioridad 1: Configuración específica del tercero (document_type_id)
      // Prioridad 2: Setting de la empresa (siigo.purchase_voucher_type_id)
      // Prioridad 3: Buscar comprobante CC-16 ("CAUSACION CUENTAS POR PAGAR" id 43000) o primer CC
      let documentTypeId = tpProfile?.document_type_id ?? null;

      if (!documentTypeId) {
        // Intentar leer de settings de la empresa
        const compSetting = await db
          .selectFrom('settings')
          .select(['value'])
          .where('company_id', '=', companyId)
          .where('scope', '=', 'siigo')
          .where('key', '=', 'purchase_voucher_type_id')
          .executeTakeFirst();

        if (compSetting?.value && Number(compSetting.value)) {
          documentTypeId = Number(compSetting.value);
        }
      }

      if (!documentTypeId) {
        try {
          const docTypes = await siigoClient.catalogs.documentTypes({ type: 'CC' });
          if (docTypes && docTypes.length > 0) {
            // Buscar CC-16 (CAUSACION CUENTAS POR PAGAR)
            const cc16 = docTypes.find((dt: any) => String(dt.code) === '16' || String(dt.id) === '43000');
            documentTypeId = cc16 ? cc16.id : docTypes[0].id;
          }
        } catch {
          documentTypeId = 43000; // Default CC-16 en Siigo
        }
      }

      if (!documentTypeId) {
        documentTypeId = 43000;
      }

      // Catálogo de impuestos en Siigo para enlazar retenciones requeridas
      let siigoTaxes: any[] = [];
      try {
        siigoTaxes = await siigoClient.catalogs.taxes();
      } catch {
        // ignorar si falla
      }

      const totalDoc = Number(doc.total ?? 0);
      const docDate = doc.issued_at ? String(doc.issued_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
      const docPrefix = doc.prefix || 'FE';
      const docFolioNum = parseInt(String(doc.folio || '1').replace(/\D/g, ''), 10) || 1;
      const folioStr = doc.prefix ? `${doc.prefix}-${doc.folio}` : (doc.folio || doc.external_uid || documentId);

      const items: any[] = [];
      let totalRetenciones = 0;

      // Líneas de retenciones calculadas
      for (const det of determinations) {
        const amount = Number(det.amount);
        if (amount <= 0) continue;

        const tpRule = tpRules.find((r) => r.tax_type_id === det.tax_type_id);
        const compRule = companyConfigs.find((c) => c.tax_type_id === det.tax_type_id);

        const accountCode =
          tpRule?.accounting_account ||
          compRule?.accounting_account ||
          (isPurchase ? '23654001' : '13551501');

        // Mapear impuesto de Siigo por porcentaje/tipo si la cuenta lo requiere
        // Nota: para ICA la tarifa en det.rate viene por mil (ej. 0.00866 = 8.66 por mil)
        const ratePercent = Number(det.rate) <= 0.05
          ? Number(det.rate) * 1000 // Si es menor a 0.05 (ej. 0.00866 o 0.01104), probar por mil (8.66 o 11.04)
          : Number(det.rate) <= 1
          ? Number(det.rate) * 100
          : Number(det.rate);

        const matchedTax = siigoTaxes.find((st) => {
          if (det.tax_type_code.includes('ICA')) {
            // Comparar contra 8.66, 11.04, 9.66 o contra porcentaje directo
            return st.type === 'ReteICA' && (
              Math.abs(st.percentage - ratePercent) < 0.1 ||
              Math.abs(st.percentage - Number(det.rate) * 1000) < 0.1 ||
              Math.abs(st.percentage - Number(det.rate) * 100) < 0.1
            );
          }
          if (det.tax_type_code.includes('RENTA')) {
            return st.type === 'Retefuente' && (
              Math.abs(st.percentage - (Number(det.rate) <= 1 ? Number(det.rate) * 100 : Number(det.rate))) < 0.1
            );
          }
          if (det.tax_type_code.includes('IVA')) {
            return st.type === 'ReteIVA' && Math.abs(st.percentage - (Number(det.rate) <= 1 ? Number(det.rate) * 100 : Number(det.rate))) < 0.1;
          }
          return false;
        });

        const retItem: any = {
          account: {
            code: accountCode,
            movement: isPurchase ? 'Credit' : 'Debit',
          },
          customer: {
            identification: thirdPartyNit,
            branch_office: 0,
          },
          description: `Retención ${det.tax_type_name} Factura ${folioStr}`,
          value: amount,
        };

        if (matchedTax) {
          retItem.tax = { id: matchedTax.id };
        }

        items.push(retItem);
        totalRetenciones += amount;
      }

      // Cuenta de gasto/contrapartida (ej. 51103001) y cuenta por pagar/cobrar
      const expenseAccount = tpProfile?.expense_account;
      if (!expenseAccount) {
        throw new HttpError(
          400,
          'CUENTA_GASTO_NO_CONFIGURADA',
          `El tercero ${doc.issuer_name || thirdPartyNit} no tiene configurada la Cuenta Contable de Gasto/Contrapartida (ej. 51103001) en su Perfil Tributario. Por favor parametrice la cuenta en Terceros antes de sincronizar.`,
        );
      }

      const payableAccount = tpProfile?.payable_account || (isPurchase ? '22050501' : '13050501');

      // Consultar impuestos de la factura para separar IVA descontable (2408)
      const docTaxes = await db
        .selectFrom('document_taxes')
        .selectAll()
        .where('document_id', '=', documentId)
        .execute();

      const ivaTax = docTaxes.find((t) => t.tax_code === '01' || t.tax_code === 'IVA');
      const ivaAmount = ivaTax ? Number(ivaTax.tax_amount) : 0;
      const baseGasto = totalDoc - ivaAmount;

      // Base gravable / Gasto
      const netoPagar = totalDoc - totalRetenciones;

      items.push({
        account: {
          code: expenseAccount,
          movement: isPurchase ? 'Debit' : 'Credit',
        },
        customer: {
          identification: thirdPartyNit,
          branch_office: 0,
        },
        description: `Gasto Factura ${folioStr}`,
        value: baseGasto,
      });

      // Si la factura tiene IVA, registrar línea de IVA Descontable
      if (ivaAmount > 0) {
        const vatAccount = isPurchase ? '24081501' : '24080501';
        items.push({
          account: {
            code: vatAccount,
            movement: isPurchase ? 'Debit' : 'Credit',
          },
          customer: {
            identification: thirdPartyNit,
            branch_office: 0,
          },
          description: `IVA Factura ${folioStr}`,
          value: ivaAmount,
        });
      }

      // Cuenta por pagar proveedor (o por cobrar cliente) con objeto "due" obligatorio en Siigo
      items.push({
        account: {
          code: payableAccount,
          movement: isPurchase ? 'Credit' : 'Debit',
        },
        customer: {
          identification: thirdPartyNit,
          branch_office: 0,
        },
        description: `Neto Factura ${folioStr}`,
        value: netoPagar,
        due: {
          prefix: docPrefix,
          consecutive: docFolioNum,
          quote: 1,
          date: docDate,
        },
      });

      // 7. Enviar a Siigo mediante Journals (Comprobante Contable)
      try {
        const journal = await siigoClient.journals.create({
          document: { id: documentTypeId },
          date: docDate,
          items,
          observations: `Contabilizado desde Accountant · Factura DIAN ${folioStr}`,
        });

        // 8. Guardar match y actualizar estado
        const chosen = await pickIntegration(companyId, 'SIIGO');
        const journalId = journal.id || String(journal.number || Date.now());
        const extId = `SIIGO:JOURNAL:${journalId}`;

        await db
          .insertInto('document_integration_matches')
          .values({
            company_id: companyId,
            document_id: documentId,
            company_integration_id: chosen.id,
            external_id: extId,
            external_number: journal.number ? String(journal.number) : extId,
            external_document_type: 'Journal',
            match_status: 'MATCHED',
            confidence: 1.0,
            last_checked_at: new Date(),
            matched_at: new Date(),
            external_payload: journal,
          })
          .onConflict((oc) =>
            oc.columns(['company_integration_id', 'document_id']).doUpdateSet({
              external_id: extId,
              external_number: journal.number ? String(journal.number) : extId,
              external_document_type: 'Journal',
              match_status: 'MATCHED',
              confidence: 1.0,
              last_checked_at: new Date(),
              matched_at: new Date(),
              external_payload: journal,
            }),
          )
          .execute();

        return {
          success: true,
          external_id: extId,
          number: journal.number,
          message: `Factura sincronizada exitosamente en Siigo como Comprobante No. ${journal.number ?? journalId}`,
        };
      } catch (err: any) {
        req.log.error({ err, items, docDate, documentTypeId }, 'Error emitiendo a Siigo');
        const detail = err?.details ? JSON.stringify(err.details) : err?.message || String(err);
        throw new HttpError(
          502,
          'ERROR_EMISION_SIIGO',
          `Error emitiendo a Siigo: ${detail}`,
        );
      }
    },
  );


  /* ---------------------------------------------------------------- */
  /* Impuestos y Retenciones del Documento                            */
  /* ---------------------------------------------------------------- */

  const updateDocumentTaxesBody = z.object({
    taxes: z.array(
      z.object({
        tax_code: z.string(),
        taxable_base: z.number().nonnegative(),
        rate: z.number().nullable().optional(),
        amount: z.number().nonnegative(),
      }),
    ),
  });

  const companyDocParams = companyParams.extend({ documentId: z.string().uuid() });

  app.get(
    '/api/companies/:companyId/documents/:documentId/taxes',
    { preHandler: [guards.requireCompany, guards.requirePermission('documents.read')] },
    async (req) => {
      const { companyId, documentId } = parseBody(companyDocParams, req.params);
      const doc = await db
        .selectFrom('documents')
        .select(['id'])
        .where('company_id', '=', companyId)
        .where('id', '=', documentId)
        .executeTakeFirst();
      if (!doc) throw new HttpError(404, 'NO_ENCONTRADO', 'Documento no encontrado.');

      const rows = await db
        .selectFrom('document_taxes as dt')
        .innerJoin('tax_types as tt', 'tt.id', 'dt.tax_type_id')
        .select(['tt.code as tax_code', 'tt.name as tax_name', 'dt.taxable_base', 'dt.rate', 'dt.amount'])
        .where('dt.document_id', '=', documentId)
        .execute();

      return {
        document_id: documentId,
        taxes: rows.map((r) => ({
          tax_code: r.tax_code,
          tax_name: r.tax_name,
          taxable_base: Number(r.taxable_base ?? 0),
          rate: r.rate !== null ? Number(r.rate) : null,
          amount: Number(r.amount),
        })),
      };
    },
  );

  app.put(
    '/api/companies/:companyId/documents/:documentId/taxes',
    { preHandler: [guards.requireCompany, guards.requirePermission('documents.read')] },
    async (req) => {
      const { companyId, documentId } = parseBody(companyDocParams, req.params);
      const body = parseBody(updateDocumentTaxesBody, req.body);

      const doc = await db
        .selectFrom('documents')
        .select(['id'])
        .where('company_id', '=', companyId)
        .where('id', '=', documentId)
        .executeTakeFirst();
      if (!doc) throw new HttpError(404, 'NO_ENCONTRADO', 'Documento no encontrado.');

      const allTaxTypes = await db
        .selectFrom('tax_types')
        .select(['id', 'code'])
        .execute();
      const taxTypeMap = new Map(allTaxTypes.map((t) => [t.code, t.id]));

      const managedCodes = ['RENTA_RETE', 'ICA_RETE', 'IVA_RETE'];
      const managedTypeIds: string[] = managedCodes
        .map((c) => taxTypeMap.get(c))
        .filter((id): id is string => typeof id === 'string');

      await db.transaction().execute(async (trx) => {
        if (managedTypeIds.length > 0) {
          await trx
            .deleteFrom('document_taxes')
            .where('document_id', '=', documentId)
            .where('tax_type_id', 'in', managedTypeIds)
            .execute();
        }

        for (const item of body.taxes) {
          const typeId = taxTypeMap.get(item.tax_code);
          if (!typeId || item.amount <= 0) continue;

          await trx
            .insertInto('document_taxes')
            .values({
              document_id: documentId,
              tax_type_id: typeId,
              taxable_base: sql`${item.taxable_base}::numeric`,
              rate: item.rate !== null && item.rate !== undefined ? sql`${item.rate}::numeric` : null,
              amount: sql`${item.amount}::numeric`,
            })
            .execute();
        }
      });

      const updated = await db
        .selectFrom('document_taxes as dt')
        .innerJoin('tax_types as tt', 'tt.id', 'dt.tax_type_id')
        .select(['tt.code as tax_code', 'tt.name as tax_name', 'dt.taxable_base', 'dt.rate', 'dt.amount'])
        .where('dt.document_id', '=', documentId)
        .execute();

      return {
        document_id: documentId,
        taxes: updated.map((r) => ({
          tax_code: r.tax_code,
          tax_name: r.tax_name,
          taxable_base: Number(r.taxable_base ?? 0),
          rate: r.rate !== null ? Number(r.rate) : null,
          amount: Number(r.amount),
        })),
      };
    },
  );

  /* ---------------------------------------------------------------- */
  /* Sincronización                                                    */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/companies/:companyId/sync/policies',
    { preHandler: [guards.requireCompany, guards.requirePermission('sync.read')] },
    async (req) => {
      const { companyId } = parseBody(companyParams, req.params);
    const rows = await db.selectFrom('sync_policies').selectAll().where('company_id', '=', companyId).execute();
    const routes = await db
      .selectFrom('sync_policies')
      .innerJoin('sync_routes', 'sync_routes.sync_policy_id', 'sync_policies.id')
      .selectAll('sync_routes')
      .where('sync_policies.company_id', '=', companyId)
      .execute();
    return { policies: rows, routes };
  });

  app.post(
    '/api/companies/:companyId/sync/run',
    { preHandler: [guards.requireCompany, guards.requirePermission('sync.execute')] },
    async (req) => {
      const { companyId } = parseBody(companyParams, req.params);
    const body = parseBody(syncRunBody, req.body);
    if (body.resource !== 'THIRD_PARTIES') {
      throw new HttpError(400, 'RECURSO_NO_SOPORTADO', `Recurso "${body.resource}" aún no está soportado.`);
    }
    const result = await runThirdPartySync(db, integrations, companyId, {
      resource: 'THIRD_PARTIES',
      dryRun: body.dry_run,
      limit: body.limit,
      actorType: 'USER',
      actorId: 'api',
    });
    return { run: result };
  });

  app.get(
    '/api/companies/:companyId/sync/conflicts',
    { preHandler: [guards.requireCompany, guards.requirePermission('sync.read')] },
    async (req) => {
      const { companyId } = parseBody(companyParams, req.params);
    const q = parseQuery(z.object({ status: z.enum(['OPEN', 'RESOLVED', 'IGNORED']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    let query = db
      .selectFrom('sync_conflicts')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('created_at', 'desc')
      .limit(q.limit);
    if (q.status) query = query.where('status', '=', q.status);
    return { conflicts: await query.execute() };
  });

  app.post(
    '/api/companies/:companyId/sync/conflicts/:id/resolve',
    { preHandler: [guards.requireCompany, guards.requirePermission('sync.resolve_conflict')] },
    async (req) => {
      const params = parseBody(companyParams.extend({ id: z.string().uuid() }), req.params);
      const body = parseBody(conflictResolveBody, req.body);
      const user = currentUser(req);
    const conflict = await db
      .selectFrom('sync_conflicts')
      .selectAll()
      .where('id', '=', params.id)
      .where('company_id', '=', params.companyId)
      .executeTakeFirst();
    if (!conflict) throw new HttpError(404, 'NO_ENCONTRADO', 'Conflicto no encontrado.');

    if (body.resolution === 'SOURCE_WINS' && conflict.entity_type === 'THIRD_PARTY') {
      const name = (conflict.source_payload as { name?: string } | null)?.name ?? null;
      if (name) {
        await db
          .updateTable('third_parties')
          .set({ legal_name: name, normalized_name: nameKey(name) })
          .where('id', '=', conflict.entity_id)
          .where('company_id', '=', params.companyId)
          .execute();
      }
    }

    await db
      .updateTable('sync_conflicts')
      .set({
        status: 'RESOLVED',
        resolution: body.resolution,
        resolved_at: new Date(),
        resolved_by: user.id,
      })
      .where('id', '=', params.id)
      .execute();

    await audit(db, {
      companyId: params.companyId,
      entityType: 'sync_conflicts',
      entityId: params.id,
      action: 'RESOLVE',
      userId: user.id,
      ip: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      before: { status: conflict.status, resolution: conflict.resolution } as Json,
      after: { status: 'RESOLVED', resolution: body.resolution } as Json,
      metadata: { resource_type: conflict.resource_type } as Json,
    });

    return { resolved: true, id: params.id };
  });

  app.get(
    '/api/companies/:companyId/integration-runs',
    { preHandler: [guards.requireCompany, guards.requirePermission('sync.read')] },
    async (req) => {
      const { companyId } = parseBody(companyParams, req.params);
    const q = parseQuery(z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }), req.query);
    const runs = await db
      .selectFrom('integration_runs')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('started_at', 'desc')
      .limit(q.limit)
      .execute();
    return { runs };
  });

  /* ---------------------------------------------------------------- */
  /* Reportería                                                        */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/reporting/monthly',
    { preHandler: [guards.requireCompany, guards.requirePermission('reports.read')] },
    async (req) => {
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

  app.get(
    '/api/reporting/counterparties',
    { preHandler: [guards.requireCompany, guards.requirePermission('reports.read')] },
    async (req) => {
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

  app.get(
    '/api/reporting/taxes',
    { preHandler: [guards.requireCompany, guards.requirePermission('reports.read')] },
    async (req) => {
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
