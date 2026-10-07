import { cleanName, isPlaceholderName, isValidNit, normalizeTaxId, taxIdDigits } from './text.js';
import { toIsoDate } from './dates.js';

export interface ExternalUidInput {
  cufe: unknown;
  issuerTaxId: unknown;
  prefix: unknown;
  folio: unknown;
  issuedAtIso: string | null;
}

/**
 * Identificador externo único del documento:
 * 1. CUFE/CUDE si existe (emisión electrónica).
 * 2. Fallback determinista compuesto por NIT emisor + prefijo + folio + fecha.
 * 3. null si no hay forma de identificarlo (la fila se rechaza según configuración).
 */
export function externalUidFor(input: ExternalUidInput): string | null {
  const cufe = String(input.cufe ?? '').trim().replace(/\s+/g, '');
  if (cufe) return cufe.slice(0, 128);

  const issuer = taxIdDigits(input.issuerTaxId);
  const folio = String(input.folio ?? '').trim().replace(/\s+/g, '').toUpperCase();
  const prefix = String(input.prefix ?? '').trim().replace(/\s+/g, '').toUpperCase();
  if (!issuer || !folio) return null;

  const parts = ['FALLBACK', issuer, prefix, folio, input.issuedAtIso ?? ''];
  const uid = parts.join(':').slice(0, 128);
  return uid;
}

export interface CompanyCandidate {
  nit: string;
  legalName: string;
}

interface RawPartySide {
  nit: unknown;
  name: unknown;
}

/**
 * Empresa a partir de las filas del archivo (paridad con deriveCompany del
 * frontend): NIT más frecuente descartando placeholders, con nombre asociado
 * más frecuente. No se inventa: si no hay candidato, devuelve null.
 */
export function deriveCompanyCandidate(rows: Array<{ issuer: RawPartySide; receiver: RawPartySide }>): CompanyCandidate | null {
  const docsByNit = new Map<string, number>();
  const namesByNit = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const seen = new Set<string>();
    for (const side of [row.issuer, row.receiver]) {
      const nit = taxIdDigits(side.nit);
      if (!nit || !isValidNit(nit)) continue;
      if (seen.has(nit)) continue;
      seen.add(nit);
      docsByNit.set(nit, (docsByNit.get(nit) || 0) + 1);

      const name = cleanName(side.name);
      if (!name || isPlaceholderName(name)) continue;
      let names = namesByNit.get(nit);
      if (!names) {
        names = new Map();
        namesByNit.set(nit, names);
      }
      names.set(name, (names.get(name) || 0) + 1);
    }
  }

  if (docsByNit.size === 0) return null;

  const ranked = [...docsByNit.entries()]
    .map(([nit, docs]) => ({ nit, docs, hasName: (namesByNit.get(nit)?.size || 0) > 0 }))
    .sort(
      (a, b) =>
        b.docs - a.docs ||
        Number(b.hasName) - Number(a.hasName) ||
        a.nit.localeCompare(b.nit),
    );

  const winner = ranked.find((c) => c.hasName) || ranked[0];
  const names = namesByNit.get(winner.nit);
  const bestName = names
    ? [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]
    : '';

  // legal_name puede quedar vacío (no se inventa el nombre de la empresa).
  return { nit: normalizeTaxId(winner.nit) ?? winner.nit, legalName: bestName };
}

export { toIsoDate };
