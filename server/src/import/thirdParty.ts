import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/schema.js';
import { nameKey } from '../domain/text.js';

export interface PartySide {
  taxId: string | null;
  checkDigit: string | null;
  name: string | null;
  nameKey: string | null;
}

export type Db = Kysely<Database> | Transaction<Database>;

/**
 * Asegura la existencia del tercero (maestro único por empresa + NIT) y mantiene
 * el histórico SCD2: si el nombre cambia, se cierra la versión vigente y se abre
 * otra con los nuevos valores.
 */
export async function ensureThirdParty(
  db: Db,
  companyId: string,
  side: PartySide,
  importId: string | null,
): Promise<string | null> {
  if (!side.taxId) return null;

  const existing = await db
    .selectFrom('third_parties')
    .select(['id', 'legal_name', 'normalized_name'])
    .where('company_id', '=', companyId)
    .where('tax_id', '=', side.taxId)
    .executeTakeFirst();

  if (!existing) {
    const inserted = await db
      .insertInto('third_parties')
      .values({
        company_id: companyId,
        tax_id: side.taxId,
        check_digit: side.checkDigit,
        legal_name: side.name,
        normalized_name: side.nameKey,
        first_seen_at: new Date(),
        last_seen_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('third_party_history')
      .values({
        third_party_id: inserted.id,
        valid_from: new Date(),
        tax_id: side.taxId,
        legal_name: side.name,
        normalized_name: side.nameKey,
        payload: { legal_name: side.name, tax_id: side.taxId, check_digit: side.checkDigit },
        source_import_id: importId,
      })
      .execute();

    return inserted.id;
  }

  await db
    .updateTable('third_parties')
    .set({ last_seen_at: new Date() })
    .where('id', '=', existing.id)
    .execute();

  const newNameKey = nameKey(side.name);
  const oldNameKey = existing.normalized_name;
  if (newNameKey && newNameKey !== oldNameKey) {
    await db
      .updateTable('third_parties')
      .set({ legal_name: side.name, normalized_name: newNameKey })
      .where('id', '=', existing.id)
      .execute();

    await db
      .updateTable('third_party_history')
      .set({ valid_to: new Date() })
      .where('third_party_id', '=', existing.id)
      .where('valid_to', 'is', null)
      .execute();

    await db
      .insertInto('third_party_history')
      .values({
        third_party_id: existing.id,
        valid_from: new Date(),
        tax_id: side.taxId,
        legal_name: side.name,
        normalized_name: newNameKey,
        payload: { legal_name: side.name, tax_id: side.taxId, check_digit: side.checkDigit },
        source_import_id: importId,
      })
      .execute();
  }

  return existing.id;
}
