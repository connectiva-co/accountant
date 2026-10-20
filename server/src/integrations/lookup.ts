import type { DocumentLookupQuery, ExternalDocumentCandidate } from './adapter.js';

/** yyyy-MM-dd ± N días (UTC). */
export function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Prefijo + número → 'FV-123' (o el valor disponible). */
export function docNumber(prefix: unknown, number: unknown): string | null {
  const p = prefix === undefined || prefix === null || prefix === '' ? null : String(prefix);
  const n = number === undefined || number === null ? null : String(number);
  if (p && n) return `${p}-${n}`;
  return p ?? n;
}

/**
 * Aplica las pistas que la query trae sobre un candidato. Los providers no
 * filtran por número ni por CUFE, así que el filtro fino es local.
 */
export function matchesLookupHints(candidate: ExternalDocumentCandidate, query: DocumentLookupQuery): boolean {
  // Coincidencia exacta por CUFE es definitiva (identificador universal DIAN)
  if (query.cufe && candidate.cufe && candidate.cufe.toUpperCase() === query.cufe.toUpperCase()) {
    return true;
  }
  if (query.cufe) {
    if ((candidate.cufe ?? '').toUpperCase() !== query.cufe.toUpperCase()) return false;
  }
  if (query.thirdPartyTaxId) {
    if ((candidate.thirdPartyTaxId ?? '') !== query.thirdPartyTaxId) return false;
  }
  if (query.number) {
    const number = (candidate.externalNumber ?? '').split('-').pop() ?? '';
    if (number !== query.number && !(candidate.externalNumber ?? '').endsWith(query.number)) return false;
  }
  if (query.prefix && candidate.externalNumber && candidate.externalNumber.includes('-')) {
    if (!candidate.externalNumber.toUpperCase().startsWith(query.prefix.toUpperCase())) return false;
  }
  if (query.issueDate && candidate.issueDate) {
    const a = new Date(`${candidate.issueDate.slice(0, 10)}T00:00:00Z`).getTime();
    const b = new Date(`${query.issueDate.slice(0, 10)}T00:00:00Z`).getTime();
    const window = (query.windowDays ?? 20) * 86_400_000;
    if (Math.abs(a - b) > window) return false;
  }
  const candidateTotal = candidate.total ?? null;
  if (query.total !== undefined && query.total !== null && candidateTotal !== null) {
    if (Math.abs(candidateTotal - query.total) > 0.01) return false;
  }
  return true;
}

/**
 * Los SDKs devuelven listas en formas distintas (array plano, {data: []},
 * {data: {content: []}}). Normaliza sin asumir una sola.
 */
export function extractItems(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (response && typeof response === 'object') {
    const record = response as Record<string, unknown>;
    if (Array.isArray(record.content)) return record.content;
    const data = record.data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const inner = data as Record<string, unknown>;
      for (const key of ['content', 'resultados', 'registros', 'documentos', 'terceros']) {
        if (Array.isArray(inner[key])) return inner[key] as unknown[];
      }
      // Página estilo Spring: { content: [] }
      if (Array.isArray(inner.content)) return inner.content as unknown[];
    }
  }
  return [];
}

export function truncateMessage(message: string, max = 300): string {
  return message.length > max ? `${message.slice(0, max)}…` : message;
}
