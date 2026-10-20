import type { Kysely } from 'kysely';
import type { Database, Json } from '../db/schema.js';
import { SettingsService } from '../settings/service.js';

export type SettingsMap = Map<string, Json>;

/**
 * Configuración efectiva (claves globales + overrides de la empresa como
 * 'scope.key'). Delega en SettingsService para que exista una única ruta de
 * lectura: schema, defaults y merges viven ahí.
 */
export async function loadSettings(db: Kysely<Database>, companyId: string | null): Promise<SettingsMap> {
  return new SettingsService(db).loadMap(companyId);
}

export function settingBool(settings: SettingsMap, key: string, fallback: boolean): boolean {
  const v = settings.get(key);
  return typeof v === 'boolean' ? v : fallback;
}

export function settingString(settings: SettingsMap, key: string, fallback: string): string {
  const v = settings.get(key);
  return typeof v === 'string' ? v : fallback;
}
