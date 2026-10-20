import { ZodError } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { redactSecrets, SecretsError } from './crypto.js';
import { IntegrationError } from './adapter.js';
import type { AnyIntegrationAdapter, ConnectionTestResult } from './adapter.js';
import { requireAdapter } from './registry.js';
import {
  getIntegration,
  readIntegrationCredentials,
  recordConnectionTest,
} from './store.js';
import type { IntegrationSummary } from './store.js';

export interface IntegrationLogger {
  warn: (data: unknown, message?: string) => void;
  error: (data: unknown, message?: string) => void;
}

export interface ResolvedClient {
  integration: IntegrationSummary;
  adapter: AnyIntegrationAdapter;
  client: unknown;
  settings: unknown;
}

interface CacheEntry {
  companyId: string;
  integrationId: string;
  adapter: AnyIntegrationAdapter;
  client: unknown;
  settings: unknown;
}

function zodIssues(error: ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Resuelve el adapter de un provider para una empresa y gestiona los clientes.
 *
 * - El core (rutas, sync, matching) pide `getClient()` o `withClient()` y solo
 *   ve la abstracción `IntegrationAdapter`; nunca importa un SDK concreto.
 * - Los clientes se cachean por `company_integration_id`; cualquier cambio de
 *   settings o credenciales debe llamar `invalidate()`.
 * - Dos peticiones simultáneas para la misma integración comparten un único
 *   `createClient` (single-flight) para no duplicar tokens.
 */
export class IntegrationManager {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<CacheEntry>>();

  constructor(
    private readonly db: Kysely<Database>,
    private readonly logger?: IntegrationLogger,
  ) {}

  async getClient(companyId: string, provider: string): Promise<ResolvedClient> {
    const integration = await getIntegration(this.db, companyId, provider);
    if (!integration) {
      throw new IntegrationError(
        'SIN_INTEGRACION',
        `La empresa no tiene integración registrada para "${provider}".`,
      );
    }
    if (!integration.enabled || integration.status === 'DISABLED') {
      throw new IntegrationError('INTEGRACION_DESHABILITADA', `La integración con "${provider}" está deshabilitada.`);
    }

    const cached = this.cache.get(integration.id);
    if (cached && cached.companyId === companyId) {
      return { integration, adapter: cached.adapter, client: cached.client, settings: cached.settings };
    }

    const pending = this.inflight.get(integration.id) ?? this.create(integration);
    this.inflight.set(integration.id, pending);

    try {
      const entry = await pending;
      if (entry.companyId !== companyId) {
        throw new IntegrationError('SIN_INTEGRACION', 'La integración resolvió a otra empresa.');
      }
      return { integration, adapter: entry.adapter, client: entry.client, settings: entry.settings };
    } finally {
      this.inflight.delete(integration.id);
    }
  }

  /** Ejecuta `fn` con el cliente resuelto (cacheado) de la integración. */
  async withClient<T>(
    companyId: string,
    provider: string,
    fn: (resolved: ResolvedClient) => Promise<T>,
  ): Promise<T> {
    const resolved = await this.getClient(companyId, provider);
    return fn(resolved);
  }

  /**
   * Prueba la conexión contra el provider, deja el resultado en la BD y lo
   * audita. Usa un cliente nuevo para que una credencial recién escrita no
   * se pruebe con el cliente cacheado anterior.
   */
  async testConnection(
    companyId: string,
    provider: string,
    options: { actorType?: string; actorId?: string | null } = {},
  ): Promise<ConnectionTestResult> {
    const resolved = await this.getClient(companyId, provider);
    this.invalidate(resolved.integration.id);

    const fresh = await this.getClient(companyId, provider);
    let result: ConnectionTestResult;
    try {
      result = await fresh.adapter.testConnection(fresh.client);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        ok: false,
        status: 'ERROR',
        message: message.slice(0, 300),
        checkedAt: new Date().toISOString(),
      };
      this.logger?.warn({ provider, companyId, err: message.slice(0, 300) }, 'testConnection lanzó excepción');
    }

    await recordConnectionTest(this.db, resolved.integration.id, result);
    await this.audit(companyId, resolved.integration.id, provider, result, options);
    return result;
  }

  /** Invalida el cliente cacheado (settings/credenciales cambiaron). */
  invalidate(companyIntegrationId: string): void {
    const entry = this.cache.get(companyIntegrationId);
    if (!entry) return;
    this.cache.delete(companyIntegrationId);
    this.destroy(entry);
  }

  /** Invalida todas las integraciones de una empresa. */
  invalidateCompany(companyId: string): void {
    for (const [id, entry] of [...this.cache]) {
      if (entry.companyId !== companyId) continue;
      this.cache.delete(id);
      this.destroy(entry);
    }
  }

  dispose(): void {
    for (const entry of this.cache.values()) this.destroy(entry);
    this.cache.clear();
    this.inflight.clear();
  }

  private async create(integration: IntegrationSummary): Promise<CacheEntry> {
    const adapter = requireAdapter(integration.provider);

    let settings: unknown;
    try {
      settings = adapter.settingsSchema.parse(integration.settings);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new IntegrationError(
          'CONFIGURACION_INVALIDA',
          `Configuración inválida para ${integration.provider}: ${zodIssues(error)}`,
          error,
        );
      }
      throw error;
    }

    const rawCredentials = await this.readCredentials(integration);
    let credentials: unknown;
    try {
      credentials = adapter.credentialsSchema.parse(rawCredentials);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new IntegrationError(
          'CREDENCIALES_INVALIDAS',
          `Credenciales inválidas para ${integration.provider}: ${zodIssues(error)}`,
          error,
        );
      }
      throw error;
    }

    const client = await adapter.createClient({ settings, credentials } as never);
    const entry: CacheEntry = {
      companyId: integration.company_id,
      integrationId: integration.id,
      adapter,
      client,
      settings,
    };
    this.cache.set(integration.id, entry);
    return entry;
  }

  private async readCredentials(integration: IntegrationSummary): Promise<Record<string, unknown>> {
    try {
      const credentials = await readIntegrationCredentials(this.db, integration.id);
      if (!credentials) {
        throw new IntegrationError(
          'SIN_CREDENCIALES',
          `Faltan credenciales para ${integration.provider}; regístralas antes de usarla.`,
        );
      }
      return credentials;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      if (error instanceof SecretsError) {
        const missingKey = /SECRETS_MASTER_KEY/.test(error.message);
        this.logger?.error({ provider: integration.provider }, 'No se pudieron descifrar credenciales');
        throw new IntegrationError(
          missingKey ? 'SECRETS_SIN_LLAVE' : 'CREDENCIALES_INVALIDAS',
          error.message,
          error,
        );
      }
      throw error;
    }
  }

  private async audit(
    companyId: string,
    companyIntegrationId: string,
    provider: string,
    result: ConnectionTestResult,
    options: { actorType?: string; actorId?: string | null },
  ): Promise<void> {
    await this.db
      .insertInto('audit_log')
      .values({
        company_id: companyId,
        entity_type: 'company_integration',
        entity_id: companyIntegrationId,
        action: 'INTEGRATION_CONNECTION_TESTED',
        actor_type: options.actorType ?? 'USER',
        actor_id: options.actorId ?? null,
        before: null,
        after: redactSecrets({ provider, ...result } as never) as never,
        metadata: {},
      })
      .execute();
  }

  private destroy(entry: CacheEntry): void {
    try {
      entry.adapter.destroyClient?.(entry.client);
    } catch (error) {
      this.logger?.warn(
        { integrationId: entry.integrationId, err: error instanceof Error ? error.message : String(error) },
        'destroyClient falló',
      );
    }
  }
}
