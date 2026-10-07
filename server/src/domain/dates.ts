/** Rango de años creíble para datos fiscales. */
function plausibleYear(year: number): boolean {
  return year >= 1990 && year <= 2100;
}

/** Serial de Excel (días desde 30/12/1899) a fecha local. */
function fromExcelSerial(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return plausibleYear(local.getFullYear()) ? local : null;
}

/**
 * Fecha contable (paridad con el frontend): dd-mm-aaaa, dd/mm/aaaa, aaaa-mm-dd,
 * serial de Excel (numérico o como texto) o fecha ISO. Devuelve Date local.
 */
export function parseRecordDate(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return fromExcelSerial(value);

  const raw = String(value).trim();
  if (!raw) return null;

  let m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    if (month > 12 && day <= 12) {
      const swap = day;
      day = month;
      month = swap;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Number(m[3]), month - 1, day);
    if (!plausibleYear(d.getFullYear()) || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  }

  m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return plausibleYear(d.getFullYear()) ? d : null;
  }

  if (/^\d{5}(\.\d+)?$/.test(raw)) return fromExcelSerial(Number(raw));

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime()) || !plausibleYear(parsed.getFullYear())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/**
 * Instante con hora (Fecha Recepción: '02-09-2026 11:26:20').
 * Los componentes se interpretan en la zona horaria del proceso (TZ en .env).
 */
export function parseRecordDateTime(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    const base = fromExcelSerial(value);
    if (!base) return null;
    const fraction = value - Math.floor(value);
    const ms = Math.round(fraction * 86_400_000);
    return new Date(base.getTime() + ms);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    if (month > 12 && day <= 12) {
      const swap = day;
      day = month;
      month = swap;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(
      Number(m[3]),
      month - 1,
      day,
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    );
    return plausibleYear(d.getFullYear()) ? d : null;
  }

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    return new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4] ?? 0),
      Number(iso[5] ?? 0),
      Number(iso[6] ?? 0),
    );
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function yearOf(d: Date): number {
  return d.getFullYear();
}

export function monthOf(d: Date): number {
  return d.getMonth() + 1;
}
