import type { Kysely } from 'kysely';
import type { Database, Json } from '../db/schema.js';

export type SettingsMap = Map<string, Json>;

/**
 * Configuración efectiva: claves globales (company_id IS NULL) con los
 * overrides de la empresa por encima. Las claves se exponen como 'scope.key'.
 */
export async function loadSettings(db: Kysely<Database>, companyId: string | null): Promise<SettingsMap> {
  let query = db.selectFrom('settings').select(['company_id', 'scope', 'key', 'value']);
  if (companyId) query = query.where((eb) => eb.or([eb('company_id', 'is', null), eb('company_id', '=', companyId)]));
  else query = query.where('company_id', 'is', null);

  const rows = await query.execute();
  const map: SettingsMap = new Map();
  // Primero globales, luego overrides de la empresa.
  for (const row of rows.filter((r) => r.company_id === null)) {
    map.set(`${row.scope}.${row.key}`, row.value);
  }
  for (const row of rows.filter((r) => r.company_id !== null)) {
    map.set(`${row.scope}.${row.key}`, row.value);
  }
  return map;
}

export function settingBool(settings: SettingsMap, key: string, fallback: boolean): boolean {
  const v = settings.get(key);
  return typeof v === 'boolean' ? v : fallback;
}

export function settingString(settings: SettingsMap, key: string, fallback: string): string {
  const v = settings.get(key);
  return typeof v === 'string' ? v : fallback;
}
