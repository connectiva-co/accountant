import type { Kysely } from 'kysely';
import type { Database, Json } from '../db/schema.js';
import { decryptSecrets, encryptSecrets, SecretsError } from './crypto.js';
import type { ConnectionTestResult } from './adapter.js';

/**
 * Acceso a datos de las integraciones de una empresa. Todo lo que lea o
 * escriba `company_integrations`, `integration_settings` o
 * `integration_secrets` pasa por aquí (los secretos solo se descifran aquí,
 * nunca se copian a otras capas).
 */

export interface IntegrationSummary {
  id: string;
  company_id: string;
  provider: string;
  provider_name: string;
  name: string | null;
  enabled: boolean;
  status: string;
  settings: Record<string, unknown>;
  has_credentials: boolean;
  last_connection_test_at: Date | null;
  last_test_status: string | null;
  last_test_message: string | null;
  last_successful_connection_at: Date | null;
}

type JoinedRow = {
  id: string;
  company_id: string;
  provider: string;
  provider_name: string;
  name: string | null;
  enabled: boolean;
  status: string;
  last_connection_test_at: Date | null;
  last_test_status: string | null;
  last_test_message: string | null;
  last_successful_connection_at: Date | null;
};

const BASE_SELECT = (db: Kysely<Database>) =>
  db
    .selectFrom('company_integrations as ci')
    .innerJoin('integration_providers as ip', 'ip.id', 'ci.provider_id')
    .select([
      'ci.id as id',
      'ci.company_id as company_id',
      'ip.code as provider',
      'ip.name as provider_name',
      'ci.name as name',
      'ci.enabled as enabled',
      'ci.status as status',
      'ci.last_connection_test_at as last_connection_test_at',
      'ci.last_test_status as last_test_status',
      'ci.last_test_message as last_test_message',
      'ci.last_successful_connection_at as last_successful_connection_at',
    ]);

export async function listIntegrations(db: Kysely<Database>, companyId: string): Promise<IntegrationSummary[]> {
  const rows = await BASE_SELECT(db).where('ci.company_id', '=', companyId).orderBy('ip.code').execute();
  return hydrate(db, rows);
}

export async function getIntegration(
  db: Kysely<Database>,
  companyId: string,
  provider: string,
): Promise<IntegrationSummary | null> {
  const row = await BASE_SELECT(db)
    .where('ci.company_id', '=', companyId)
    .where('ip.code', '=', provider)
    .executeTakeFirst();
  if (!row) return null;
  const [summary] = await hydrate(db, [row]);
  return summary ?? null;
}

export async function getIntegrationById(
  db: Kysely<Database>,
  companyId: string,
  companyIntegrationId: string,
): Promise<IntegrationSummary | null> {
  const row = await BASE_SELECT(db)
    .where('ci.company_id', '=', companyId)
    .where('ci.id', '=', companyIntegrationId)
    .executeTakeFirst();
  if (!row) return null;
  const [summary] = await hydrate(db, [row]);
  return summary ?? null;
}

async function hydrate(db: Kysely<Database>, rows: JoinedRow[]): Promise<IntegrationSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const settingsRows = await db
    .selectFrom('integration_settings')
    .select(['company_integration_id', 'settings'])
    .where('company_integration_id', 'in', ids)
    .execute();

  const secretRows = await db
    .selectFrom('integration_secrets')
    .select(['company_integration_id'])
    .where('company_integration_id', 'in', ids)
    .execute();

  const settingsById = new Map(settingsRows.map((row) => [row.company_integration_id, row.settings]));
  const secrets = new Set(secretRows.map((row) => row.company_integration_id));

  return rows.map((row) => ({
    id: row.id,
    company_id: row.company_id,
    provider: row.provider,
    provider_name: row.provider_name,
    name: row.name,
    enabled: row.enabled,
    status: row.status,
    settings: (settingsById.get(row.id) as Record<string, unknown> | undefined) ?? {},
    has_credentials: secrets.has(row.id),
    last_connection_test_at: row.last_connection_test_at,
    last_test_status: row.last_test_status,
    last_test_message: row.last_test_message,
    last_successful_connection_at: row.last_successful_connection_at,
  }));
}

/** Crea (o reutiliza) la integración de un provider para la empresa. */
export async function upsertIntegration(
  db: Kysely<Database>,
  input: { companyId: string; provider: string; name?: string | null; enabled?: boolean; status?: string },
): Promise<string> {
  const provider = await db
    .selectFrom('integration_providers')
    .select(['id', 'enabled'])
    .where('code', '=', input.provider)
    .executeTakeFirst();
  if (!provider) throw new Error(`Proveedor "${input.provider}" no existe en integration_providers.`);

  const existing = await db
    .selectFrom('company_integrations')
    .select(['id'])
    .where('company_id', '=', input.companyId)
    .where('provider_id', '=', provider.id)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('company_integrations')
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where('id', '=', existing.id)
      .execute();
    return existing.id;
  }

  const inserted = await db
    .insertInto('company_integrations')
    .values({
      company_id: input.companyId,
      provider_id: provider.id,
      name: input.name ?? null,
      enabled: input.enabled ?? true,
      status: input.status ?? 'NOT_CONFIGURED',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return inserted.id;
}

export async function writeIntegrationSettings(
  db: Kysely<Database>,
  companyIntegrationId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  await db
    .insertInto('integration_settings')
    .values({ company_integration_id: companyIntegrationId, settings: settings as Json })
    .onConflict((oc) =>
      oc.column('company_integration_id').doUpdateSet({ settings: settings as Json }),
    )
    .execute();
}

/** Cifra y guarda credenciales. Nunca las devuelve en claro al llamador. */
export async function writeIntegrationCredentials(
  db: Kysely<Database>,
  companyIntegrationId: string,
  credentials: Record<string, unknown>,
): Promise<void> {
  const encrypted = encryptSecrets(credentials);
  await db
    .insertInto('integration_secrets')
    .values({
      company_integration_id: companyIntegrationId,
      encrypted_payload: encrypted.encryptedPayload,
      nonce: encrypted.nonce,
      auth_tag: encrypted.authTag,
      encryption_key_version: encrypted.keyVersion,
    })
    .onConflict((oc) =>
      oc.column('company_integration_id').doUpdateSet({
        encrypted_payload: encrypted.encryptedPayload,
        nonce: encrypted.nonce,
        auth_tag: encrypted.authTag,
        encryption_key_version: encrypted.keyVersion,
      }),
    )
    .execute();
}

export async function clearIntegrationCredentials(
  db: Kysely<Database>,
  companyIntegrationId: string,
): Promise<void> {
  await db
    .deleteFrom('integration_secrets')
    .where('company_integration_id', '=', companyIntegrationId)
    .execute();
}

/** Devuelve las credenciales descifradas o `null` si no hay secreto guardado. */
export async function readIntegrationCredentials(
  db: Kysely<Database>,
  companyIntegrationId: string,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .selectFrom('integration_secrets')
    .select(['encrypted_payload', 'nonce', 'auth_tag', 'encryption_key_version'])
    .where('company_integration_id', '=', companyIntegrationId)
    .executeTakeFirst();
  if (!row) return null;
  return decryptSecrets(row);
}

export async function recordConnectionTest(
  db: Kysely<Database>,
  companyIntegrationId: string,
  result: ConnectionTestResult,
): Promise<void> {
  const now = new Date();
  await db
    .updateTable('company_integrations')
    .set({
      last_connection_test_at: now,
      last_test_status: result.status,
      last_test_message: result.message,
      ...(result.ok ? { last_successful_connection_at: now } : {}),
      status: result.ok ? 'CONNECTED' : 'ERROR',
    })
    .where('id', '=', companyIntegrationId)
    .execute();
}

export { SecretsError };
