import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../db/schema.js';
import { cleanName, nameKey, taxIdDigits } from '../../domain/text.js';
import { canWrite } from '../capabilities.js';
import { IntegrationError } from '../adapter.js';
import type { IntegrationManager } from '../manager.js';
import { ensureThirdParty } from '../../import/thirdParty.js';
import { getIntegrationById, listIntegrations } from '../store.js';

/**
 * Motor de sincronización.
 *
 * Lee `sync_policies` + `sync_routes` para decidir dirección y estrategia,
 * ejecuta la operación contra el adapter del provider y deja todo observable en
 * `integration_runs`, `sync_conflicts` y `entity_external_refs`.
 *
 * Por ahora el único dominio implementado de punta a punta es THIRD_PARTIES;
 * el resto de recursos entra agregando una rama en `runResourceSync`.
 */

type Db = Kysely<Database> | Transaction<Database>;

export type SyncStrategy =
  | 'SOURCE_WINS'
  | 'TARGET_WINS'
  | 'NEWEST_WINS'
  | 'MANUAL_REVIEW'
  | 'DO_NOT_OVERWRITE';

export interface SyncRunOptions {
  resource: 'THIRD_PARTIES';
  dryRun?: boolean;
  actorType?: string;
  actorId?: string | null;
  limit?: number;
}

export interface SyncRunResult {
  run_id: string | null;
  resource: string;
  dry_run: boolean;
  strategy: SyncStrategy;
  read: number;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  failed: number;
  pushed: number;
  skipped_write: string | null;
  errors: string[];
}

const DEFAULT_WRITE_LIMIT = 50;
const MAX_REPORTED_ERRORS = 10;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Política del dominio; se crea con valores seguros si aún no existe. */
export async function getOrCreatePolicy(db: Db, companyId: string, resource: string) {
  const existing = await db
    .selectFrom('sync_policies')
    .selectAll()
    .where('company_id', '=', companyId)
    .where('resource_type', '=', resource)
    .executeTakeFirst();
  if (existing) return existing;

  return db
    .insertInto('sync_policies')
    .values({ company_id: companyId, resource_type: resource })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Rutas vigentes: si la empresa no configuró ninguna, se usa como lectura la
 * integración habilitada del provider (todas las que tenga), sin escritura.
 */
async function resolveRoutes(db: Db, companyId: string, policyId: string) {
  const explicit = await db
    .selectFrom('sync_routes')
    .selectAll()
    .where('sync_policy_id', '=', policyId)
    .orderBy('priority')
    .execute();

  if (explicit.length > 0) return { routes: explicit, explicit: true };

  const integrations = await listIntegrations(db as Kysely<Database>, companyId);
  const enabled = integrations.filter((integration) => integration.enabled && integration.status !== 'DISABLED');
  return {
    routes: enabled.map((integration) => ({
      id: `ad-hoc:${integration.id}`,
      sync_policy_id: policyId,
      source_integration_id: integration.id,
      target_integration_id: null,
      read_enabled: true,
      write_enabled: false,
      priority: 100,
      created_at: new Date(),
      updated_at: new Date(),
    })),
    explicit: false,
  };
}

function newResult(resource: string, dryRun: boolean, strategy: SyncStrategy): SyncRunResult {
  return {
    run_id: null,
    resource,
    dry_run: dryRun,
    strategy,
    read: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    conflicts: 0,
    failed: 0,
    pushed: 0,
    skipped_write: null,
    errors: [],
  };
}

function pushError(result: SyncRunResult, message: string): void {
  if (result.errors.length < MAX_REPORTED_ERRORS) result.errors.push(message.slice(0, 300));
  result.failed += 1;
}

/**
 * Sincroniza terceros entre el ERP (fuente) y Accountant.
 *
 * Dirección por defecto: solo lectura desde el provider. La escritura ocurre
 * únicamente si hay ruta con `write_enabled` y el adapter declara
 * THIRD_PARTIES_WRITE.
 */
export async function runThirdPartySync(
  db: Kysely<Database>,
  manager: IntegrationManager,
  companyId: string,
  options: SyncRunOptions,
): Promise<SyncRunResult> {
  const policy = await getOrCreatePolicy(db, companyId, options.resource);
  const strategy = policy.conflict_strategy as SyncStrategy;
  const dryRun = options.dryRun ?? false;
  const result = newResult(options.resource, dryRun, strategy);

  const runId = await startRun(db, companyId, options.resource, dryRun);
  result.run_id = runId;

  try {
    const { routes } = await resolveRoutes(db, companyId, policy.id);
    const readRoutes = routes.filter((route) => route.read_enabled && route.source_integration_id);
    const writeRoutes = routes.filter((route) => route.write_enabled && route.target_integration_id);

    for (const route of readRoutes) {
      const integrationId = route.source_integration_id as string;
      const integration = await getIntegrationById(db, companyId, integrationId);
      if (!integration) continue;
      if (!integration.enabled || integration.status === 'DISABLED') {
        result.skipped_write = result.skipped_write ?? null;
        continue;
      }

      const resolved = await manager.getClient(companyId, integration.provider);
      if (typeof resolved.adapter.listThirdParties !== 'function') {
        result.skipped_write = `${integration.provider} no expone terceros`;
        continue;
      }

      const targetLimit = dryRun ? (options.limit ?? 50) : options.limit;
      const remote = await resolved.adapter.listThirdParties(resolved.client, { limit: targetLimit });
      result.read += remote.length;

      for (const party of remote) {
        try {
          await applyRemoteThirdParty(db, {
            companyId,
            integrationId,
            party,
            strategy,
            dryRun,
            result,
          });
        } catch (error) {
          pushError(result, error instanceof Error ? error.message : String(error));
        }
      }

      // Escritura local → provider.
      if (writeRoutes.some((route2) => route2.target_integration_id === integrationId)) {
        await pushLocalThirdParties(db, manager, companyId, integrationId, integration.provider, {
          dryRun,
          result,
          limit: options.limit ?? DEFAULT_WRITE_LIMIT,
        });
      }
    }

    if (readRoutes.length === 0) {
      result.skipped_write = 'Sin rutas de lectura configuradas';
    }

    await finishRun(db, runId, companyId, options.resource, result, options);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message.slice(0, 300));
    await finishRun(db, runId, companyId, options.resource, result, options, true);
    throw error instanceof IntegrationError ? error : new IntegrationError('PROVIDER_ERROR', message, error);
  }
}

async function applyRemoteThirdParty(
  db: Db,
  input: {
    companyId: string;
    integrationId: string;
    party: { externalId: string; taxId: string | null; name: string | null; sourceHash?: string | null; payload: Record<string, unknown> };
    strategy: SyncStrategy;
    dryRun: boolean;
    result: SyncRunResult;
  },
): Promise<void> {
  const { party, strategy, dryRun, result } = input;

  const taxId = taxIdDigits(party.taxId);
  if (!taxId) {
    pushError(result, `Tercero externo ${party.externalId} sin identificación`);
    return;
  }

  const cleanTaxId = party.taxId?.trim() ?? taxId;
  const incomingName = cleanName(party.name);
  const incomingKey = nameKey(party.name);

  const existing = await db
    .selectFrom('third_parties')
    .select(['id', 'legal_name', 'normalized_name'])
    .where('company_id', '=', input.companyId)
    .where('tax_id', '=', cleanTaxId)
    .executeTakeFirst();

  if (!existing) {
    if (dryRun) {
      result.created += 1;
    } else {
      const createdId = await ensureThirdParty(
        db,
        input.companyId,
        { taxId: cleanTaxId, checkDigit: null, name: incomingName, nameKey: incomingKey },
        null,
      );
      if (createdId) {
        result.created += 1;
        await upsertExternalRef(db, {
          companyId: input.companyId,
          integrationId: input.integrationId,
          entityType: 'THIRD_PARTY',
          entityId: createdId,
          externalId: party.externalId,
          externalCode: null,
          sourceHash: sha256(`${cleanTaxId}|${incomingKey ?? ''}`),
        });
      } else {
        pushError(result, `No se pudo crear el tercero ${cleanTaxId}`);
      }
    }
    return;
  }

  const localKey = existing.normalized_name;
  const sameName = Boolean(incomingKey && localKey && incomingKey === localKey);

  if (sameName) {
    result.unchanged += 1;
    if (!dryRun) {
      await upsertExternalRef(db, {
        companyId: input.companyId,
        integrationId: input.integrationId,
        entityType: 'THIRD_PARTY',
        entityId: existing.id,
        externalId: party.externalId,
        externalCode: null,
        sourceHash: sha256(`${cleanTaxId}|${incomingKey ?? ''}`),
      });
    }
    return;
  }

  if (strategy === 'SOURCE_WINS') {
    if (dryRun) {
      result.updated += 1;
    } else {
      await ensureThirdParty(
        db,
        input.companyId,
        { taxId: cleanTaxId, checkDigit: null, name: incomingName, nameKey: incomingKey },
        null,
      );
      result.updated += 1;
      await upsertExternalRef(db, {
        companyId: input.companyId,
        integrationId: input.integrationId,
        entityType: 'THIRD_PARTY',
        entityId: existing.id,
        externalId: party.externalId,
        externalCode: null,
        sourceHash: sha256(`${cleanTaxId}|${incomingKey ?? ''}`),
      });
    }
    return;
  }

  // Cualquier otra estrategia no sobrescribe: queda un conflicto abierto.
  result.conflicts += 1;
  if (dryRun) return;
  await openConflict(db, {
    companyId: input.companyId,
    resourceType: 'THIRD_PARTIES',
    entityType: 'THIRD_PARTY',
    entityId: existing.id,
    sourceIntegrationId: input.integrationId,
    targetIntegrationId: null,
    sourcePayload: { name: incomingName, tax_id: cleanTaxId, external_id: party.externalId },
    targetPayload: { name: existing.legal_name, tax_id: cleanTaxId, external_id: null },
  });
  await upsertExternalRef(db, {
    companyId: input.companyId,
    integrationId: input.integrationId,
    entityType: 'THIRD_PARTY',
    entityId: existing.id,
    externalId: party.externalId,
    externalCode: null,
    sourceHash: sha256(`${cleanTaxId}|${incomingKey ?? ''}`),
  });
}

async function pushLocalThirdParties(
  db: Db,
  manager: IntegrationManager,
  companyId: string,
  integrationId: string,
  provider: string,
  input: { dryRun: boolean; result: SyncRunResult; limit: number },
): Promise<void> {
  const resolved = await manager.getClient(companyId, provider);
  const { adapter } = resolved;

  if (typeof adapter.createThirdParty !== 'function' || !canWrite(adapter.capabilities, 'THIRD_PARTIES')) {
    input.result.skipped_write = `${provider} no soporta escritura de terceros`;
    return;
  }

  const linked = await db
    .selectFrom('entity_external_refs')
    .select('entity_id')
    .where('company_id', '=', companyId)
    .where('company_integration_id', '=', integrationId)
    .where('entity_type', '=', 'THIRD_PARTY')
    .execute();
  const linkedIds = new Set(linked.map((row) => row.entity_id));

  const pending = await db
    .selectFrom('third_parties')
    .select(['id', 'tax_id', 'legal_name'])
    .where('company_id', '=', companyId)
    .where('tax_id', 'is not', null)
    .orderBy('last_seen_at', 'desc')
    .limit(input.limit * 4)
    .execute();

  const toPush = pending.filter((row) => !linkedIds.has(row.id)).slice(0, input.limit);

  for (const row of toPush) {
    if (input.dryRun) {
      input.result.pushed += 1;
      continue;
    }
    try {
      const written = await adapter.createThirdParty(resolved.client, {
        taxId: row.tax_id as string,
        name: row.legal_name ?? row.tax_id,
      });
      input.result.pushed += 1;
      await upsertExternalRef(db, {
        companyId,
        integrationId,
        entityType: 'THIRD_PARTY',
        entityId: row.id,
        externalId: written.externalId,
        externalCode: written.externalCode ?? null,
        sourceHash: sha256(`${row.tax_id}|${nameKey(row.legal_name) ?? ''}`),
      });
    } catch (error) {
      pushError(input.result, error instanceof Error ? error.message : String(error));
    }
  }
}

async function upsertExternalRef(
  db: Db,
  input: {
    companyId: string;
    integrationId: string;
    entityType: string;
    entityId: string;
    externalId: string;
    externalCode: string | null;
    sourceHash: string | null;
  },
): Promise<void> {
  await db
    .insertInto('entity_external_refs')
    .values({
      company_id: input.companyId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      company_integration_id: input.integrationId,
      external_id: input.externalId,
      external_code: input.externalCode,
      source_hash: input.sourceHash,
      last_seen_at: new Date(),
    })
    .onConflict((oc) =>
      oc
        .columns(['company_integration_id', 'entity_type', 'external_id'])
        .doUpdateSet({
          entity_id: input.entityId,
          external_code: input.externalCode,
          source_hash: input.sourceHash,
          last_seen_at: new Date(),
        }),
    )
    .execute();
}

async function openConflict(
  db: Db,
  input: {
    companyId: string;
    resourceType: string;
    entityType: string;
    entityId: string;
    sourceIntegrationId: string | null;
    targetIntegrationId: string | null;
    sourcePayload: Record<string, unknown>;
    targetPayload: Record<string, unknown>;
  },
): Promise<void> {
  const open = await db
    .selectFrom('sync_conflicts')
    .select(['id'])
    .where('company_id', '=', input.companyId)
    .where('entity_type', '=', input.entityType)
    .where('entity_id', '=', input.entityId)
    .where('source_integration_id', '=', input.sourceIntegrationId)
    .where('status', '=', 'OPEN')
    .executeTakeFirst();
  if (open) return;

  await db
    .insertInto('sync_conflicts')
    .values({
      company_id: input.companyId,
      resource_type: input.resourceType,
      entity_type: input.entityType,
      entity_id: input.entityId,
      source_integration_id: input.sourceIntegrationId,
      target_integration_id: input.targetIntegrationId,
      source_payload: input.sourcePayload as never,
      target_payload: input.targetPayload as never,
    })
    .execute();
}

async function startRun(db: Kysely<Database>, companyId: string, resource: string, dryRun: boolean): Promise<string> {
  const row = await db
    .insertInto('integration_runs')
    .values({
      company_id: companyId,
      operation: `SYNC_${resource}`,
      metadata: { dry_run: dryRun } as never,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function finishRun(
  db: Kysely<Database>,
  runId: string,
  companyId: string,
  resource: string,
  result: SyncRunResult,
  options: SyncRunOptions,
  failed = false,
): Promise<void> {
  const status = failed ? 'FAILED' : result.failed > 0 ? 'PARTIAL' : 'COMPLETED';
  await db
    .updateTable('integration_runs')
    .set({
      // Mismo reloj que started_at (DEFAULT now() de PostgreSQL): si la API y la
      // BD están en hosts distintos, un new Date() local puede quedar por detrás.
      finished_at: sql`now()`,
      status,
      records_read: result.read,
      records_matched: result.created + result.updated + result.pushed,
      records_not_found: result.unchanged,
      records_failed: result.failed,
      error_summary: result.errors.length > 0 ? result.errors.join('\n') : null,
      metadata: {
        dry_run: result.dry_run,
        strategy: result.strategy,
        conflicts: result.conflicts,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        pushed: result.pushed,
        skipped_write: result.skipped_write,
      } as never,
    })
    .where('id', '=', runId)
    .execute();

  await db
    .updateTable('sync_policies')
    .set({ last_run_at: new Date() })
    .where('company_id', '=', companyId)
    .where('resource_type', '=', resource)
    .execute();

  await db
    .insertInto('audit_log')
    .values({
      company_id: companyId,
      entity_type: 'sync_run',
      entity_id: runId,
      action: 'SYNC_RUN',
      actor_type: options.actorType ?? 'USER',
      actor_id: options.actorId ?? null,
      before: null,
      after: {
        resource,
        status,
        dry_run: result.dry_run,
        read: result.read,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        conflicts: result.conflicts,
        pushed: result.pushed,
        failed: result.failed,
      } as never,
      metadata: { resource } as never,
    })
    .execute();
}
