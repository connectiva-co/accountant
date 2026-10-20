import type { Kysely } from 'kysely';
import type { Database, Json } from '../db/schema.js';
import { redactSecrets } from '../integrations/crypto.js';
import { isKnownScope, resolveScopeValues, validateSettingValue } from './schemas.js';

export type SettingsMap = Map<string, Json>;

export type SettingOrigin = 'COMPANY' | 'GLOBAL' | 'DEFAULT';

export interface SettingEntry {
  id: string | null;
  company_id: string | null;
  scope: string;
  key: string;
  value: Json;
  value_type: string | null;
  origin: SettingOrigin;
  is_system: boolean;
  description: string | null;
}

export interface SetSettingsOptions {
  actorType?: string;
  actorId?: string | null;
  description?: string | null;
}

/**
 * Único punto de lectura/escritura de `settings`.
 *
 * Resolución: setting de la empresa → setting global → default del schema.
 * Ninguna otra capa consulta la tabla directamente.
 */
export class SettingsService {
  constructor(private readonly db: Kysely<Database>) {}

  /** Mapa 'scope.key' → valor efectivo (para el motor de import/reportes). */
  async loadMap(companyId: string | null): Promise<SettingsMap> {
    const rows = await this.db
      .selectFrom('settings')
      .select(['company_id', 'scope', 'key', 'value'])
      .where((eb) =>
        companyId
          ? eb.or([eb('company_id', 'is', null), eb('company_id', '=', companyId)])
          : eb('company_id', 'is', null),
      )
      .execute();

    const byScope = new Map<string, Record<string, Json>>();
    const order: Array<{ company: boolean; scope: string; key: string; value: Json }> = [];
    for (const row of rows) {
      order.push({
        company: row.company_id !== null,
        scope: row.scope,
        key: row.key,
        value: row.value,
      });
    }

    const collect = (company: boolean) => {
      for (const row of order) {
        if (row.company !== company) continue;
        let bucket = byScope.get(row.scope);
        if (!bucket) {
          bucket = {};
          byScope.set(row.scope, bucket);
        }
        bucket[row.key] = row.value;
      }
    };
    collect(false); // globales primero
    collect(true); // luego los overrides de la empresa

    const map: SettingsMap = new Map();
    const scopes = new Set<string>([...allScopes(), ...byScope.keys()]);
    for (const scope of scopes) {
      const stored = byScope.get(scope) ?? {};
      for (const [key, value] of Object.entries(resolveScopeValues(scope, stored))) {
        map.set(`${scope}.${key}`, value);
      }
    }
    return map;
  }

  /** Valor efectivo de una clave concreta. */
  async get(companyId: string | null, scope: string, key: string): Promise<Json | undefined> {
    const map = await this.loadMap(companyId);
    return map.get(`${scope}.${key}`);
  }

  /**
   * Todas las entradas de un scope (o de todos) con su origen resuelto.
   * Es lo que consume la UI de Configuración.
   */
  async getAll(companyId: string | null, scope?: string): Promise<SettingEntry[]> {
    const rows = await this.db
      .selectFrom('settings')
      .select(['id', 'company_id', 'scope', 'key', 'value', 'value_type', 'is_system', 'description'])
      .where((eb) =>
        companyId
          ? eb.or([eb('company_id', 'is', null), eb('company_id', '=', companyId)])
          : eb('company_id', 'is', null),
      )
      .execute();

    const map = await this.loadMap(companyId);
    const scopes = new Set<string>(scope ? [scope] : allScopes());
    for (const row of rows) scopes.add(row.scope);

    interface EntryMeta {
      id: string;
      company_id: string | null;
      value_type: string | null;
      company: boolean;
      is_system: boolean;
      description: string | null;
    }
    const meta = new Map<string, EntryMeta>();
    for (const row of rows) {
      if (row.company_id !== null && row.company_id !== companyId) continue;
      const k = `${row.scope}.${row.key}`;
      const prev = meta.get(k);
      // Si existe en ambos niveles, manda el de la empresa.
      if (!prev || row.company_id !== null) {
        meta.set(k, {
          id: row.id,
          company_id: row.company_id,
          value_type: row.value_type,
          company: row.company_id !== null,
          is_system: row.is_system,
          description: row.description,
        });
      }
    }

    const entries: SettingEntry[] = [];
    for (const s of scopes) {
      for (const [key, value] of Object.entries(resolveScopeValues(s, {}))) {
        const k = `${s}.${key}`;
        const info = meta.get(k);
        entries.push({
          id: info?.id ?? null,
          company_id: info?.company_id ?? companyId,
          scope: s,
          key,
          value: map.get(k) ?? value,
          value_type: info?.value_type ?? null,
          origin: info ? (info.company ? 'COMPANY' : 'GLOBAL') : 'DEFAULT',
          is_system: info?.is_system ?? true,
          description: info?.description ?? null,
        });
      }
      // Claves legacy guardadas que no están en el schema.
      for (const [k, value] of map) {
        if (!k.startsWith(`${s}.`)) continue;
        const key = k.slice(s.length + 1);
        if (entries.some((e) => e.scope === s && e.key === key)) continue;
        const info = meta.get(k);
        entries.push({
          id: info?.id ?? null,
          company_id: info?.company_id ?? companyId,
          scope: s,
          key,
          value,
          value_type: info?.value_type ?? null,
          origin: info ? (info.company ? 'COMPANY' : 'GLOBAL') : 'DEFAULT',
          is_system: info?.is_system ?? false,
          description: info?.description ?? null,
        });
      }
    }
    return entries.sort((a, b) => a.scope.localeCompare(b.scope) || a.key.localeCompare(b.key));
  }

  /**
   * Escribe un setting validado (scope, clave y tipo contra el schema) y lo
   * audita. `companyId === null` escribe el valor global.
   */
  async set(
    companyId: string | null,
    scope: string,
    key: string,
    value: unknown,
    options: SetSettingsOptions = {},
  ): Promise<SettingEntry> {
    const validated = validateSettingValue(scope, key, value);

    const existing = await this.db
      .selectFrom('settings')
      .selectAll()
      .where('scope', '=', scope)
      .where('key', '=', key)
      .where((eb) => (companyId === null ? eb('company_id', 'is', null) : eb('company_id', '=', companyId)))
      .executeTakeFirst();

    const origin: SettingOrigin = companyId ? 'COMPANY' : 'GLOBAL';
    let rowId = existing?.id ?? null;

    if (existing) {
      await this.db
        .updateTable('settings')
        .set({ value: validated, value_type: jsonType(validated), description: options.description ?? existing.description })
        .where('id', '=', existing.id)
        .execute();
    } else {
      const inserted = await this.db
        .insertInto('settings')
        .values({
          company_id: companyId,
          scope,
          key,
          value: validated,
          value_type: jsonType(validated),
          description: options.description ?? null,
          is_system: false,
        })
        .returning('id')
        .executeTakeFirst();
      rowId = inserted?.id ?? null;
    }

    await this.audit(companyId, {
      action: 'SETTINGS',
      entityType: 'settings',
      entityId: `${scope}.${key}`,
      before: existing ? { value: existing.value, origin: existing.company_id ? 'COMPANY' : 'GLOBAL' } : null,
      after: { value: validated, origin },
      actorType: options.actorType ?? 'USER',
      actorId: options.actorId ?? null,
    });

    return {
      id: rowId,
      company_id: companyId,
      scope,
      key,
      value: validated,
      value_type: jsonType(validated),
      origin,
      is_system: existing?.is_system ?? false,
      description: options.description ?? existing?.description ?? null,
    };
  }

  private async audit(
    companyId: string | null,
    entry: {
      action: string;
      entityType: string;
      entityId: string;
      before: Json | null;
      after: Json | null;
      actorType: string;
      actorId: string | null;
    },
  ): Promise<void> {
    await this.db
      .insertInto('audit_log')
      .values({
        company_id: companyId,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        action: entry.action,
        actor_type: entry.actorType,
        actor_id: entry.actorId,
        before: redactSecrets(entry.before),
        after: redactSecrets(entry.after),
        metadata: {},
      })
      .execute();
  }
}

function allScopes(): string[] {
  return ['general', 'company', 'import', 'reporting', 'currency', 'tax'];
}

function jsonType(value: Json): string | null {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  return null;
}

/** Compatibilidad con el código que ya consumía `loadSettings`. */
export async function loadSettingsFromService(
  db: Kysely<Database>,
  companyId: string | null,
): Promise<SettingsMap> {
  return new SettingsService(db).loadMap(companyId);
}

export { isKnownScope };
