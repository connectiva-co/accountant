import type { DocumentType } from '../db/schema.js';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { norm } from './text.js';

/**
 * Sinónimos de rótulos RADIAN/DIAN -> código de document_types.
 * Se evalúa antes de la coincidencia exacta con `name`.
 */
const ALIASES: Record<string, string> = {
  'factura electronica': 'FACTURA_ELECTRONICA',
  'factura': 'FACTURA_ELECTRONICA',
  'factura de contingencia': 'FACTURA_CONTINGENCIA',
  'factura electronica de contingencia': 'FACTURA_CONTINGENCIA',
  'nota credito': 'NOTA_CREDITO',
  'nota credito electronica': 'NOTA_CREDITO',
  'nota de credito': 'NOTA_CREDITO',
  'nota de credito electronica': 'NOTA_CREDITO',
  'nota debito': 'NOTA_DEBITO',
  'nota debito electronica': 'NOTA_DEBITO',
  'nota de debito electronica': 'NOTA_DEBITO',
  'documento soporte': 'DOCUMENTO_SOPORTE',
  'documento soporte con no obligados': 'DOCUMENTO_SOPORTE_NO_OBLIGADO',
  'documento soporte no obligados': 'DOCUMENTO_SOPORTE_NO_OBLIGADO',
  'documento equivalente pos': 'DOCUMENTO_EQUIVALENTE_POS',
  'pos': 'DOCUMENTO_EQUIVALENTE_POS',
  'nomina individual': 'NOMINA_INDIVIDUAL',
  'nomina': 'NOMINA_INDIVIDUAL',
  'contingencia nomina': 'CONTINGENCIA_NOMINA',
  'application response': 'APPLICATION_RESPONSE',
  'respuesta de aplicacion': 'APPLICATION_RESPONSE',
};

export interface DocumentTypeIndex {
  byCode: Map<string, DocumentType>;
  byLabel: Map<string, DocumentType>;
  unknownCode: string;
}

export async function loadDocumentTypes(
  db: Kysely<Database>,
  unknownCode = 'OTRO',
): Promise<DocumentTypeIndex> {
  const rows = await db.selectFrom('document_types').selectAll().where('active', '=', true).execute();
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const byLabel = new Map(rows.map((r) => [norm(r.name), r]));
  return { byCode, byLabel, unknownCode };
}

/**
 * Resuelve el rótulo a un tipo de documento. Devuelve null si no se conoce:
 * el llamador aplica la configuración (mapear a OTRO o rechazar la fila).
 */
export function resolveDocumentType(
  index: DocumentTypeIndex,
  label: unknown,
): DocumentType | null {
  const key = norm(label);
  if (!key) return null;
  const alias = ALIASES[key];
  if (alias) {
    const byAlias = index.byCode.get(alias);
    if (byAlias) return byAlias;
  }
  return index.byLabel.get(key) ?? null;
}
