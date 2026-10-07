import type { Period, PeriodKind, RadianRecord } from '../types/radian';

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Serial de Excel (días desde 30/12/1899) a fecha local. */
function fromExcelSerial(serial: number): Date | null {
  if (!isFinite(serial)) return null;
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return plausible(local) ? local : null;
}

function plausible(d: Date): boolean {
  const y = d.getFullYear();
  return !isNaN(d.getTime()) && y >= 1990 && y <= 2100;
}

export function parseRecordDate(value: string | number | undefined | null): Date | null {
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
    return plausible(d) && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
  }

  m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return plausible(d) ? d : null;
  }

  // Serial de Excel guardado como texto (p. ej. "46265")
  if (/^\d{5}(\.\d+)?$/.test(raw)) return fromExcelSerial(Number(raw));

  const d = new Date(raw);
  if (isNaN(d.getTime()) || !plausible(d)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function monthLabel(d: Date): string {
  const name = MONTHS[d.getMonth()];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${d.getFullYear()}`;
}

export function shortDateLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** Fecha de referencia del conjunto de datos: la última fecha de emisión presente. */
export function referenceDate(records: RadianRecord[]): Date {
  let max: Date | null = null;
  for (const r of records) {
    const d = parseRecordDate(r['Fecha Emisión']);
    if (d && (!max || d > max)) max = d;
  }
  return max || new Date();
}

export function resolvePeriod(kind: PeriodKind, anchor: Date, range?: { from: string; to: string }): Period {
  if (kind === 'range' && range?.from && range?.to) {
    const from = fromISODate(range.from);
    const to = fromISODate(range.to);
    return {
      kind,
      start: range.from,
      end: range.to,
      label: `${shortDateLabel(from)} – ${shortDateLabel(to)}`,
    };
  }

  if (kind === 'quarter') {
    const q = Math.floor(anchor.getMonth() / 3);
    const start = new Date(anchor.getFullYear(), q * 3, 1);
    const end = new Date(anchor.getFullYear(), q * 3 + 3, 0);
    return {
      kind,
      start: toISODate(start),
      end: toISODate(end),
      label: `T${q + 1} ${anchor.getFullYear()}`,
    };
  }

  if (kind === 'year') {
    return {
      kind,
      start: toISODate(new Date(anchor.getFullYear(), 0, 1)),
      end: toISODate(new Date(anchor.getFullYear(), 11, 31)),
      label: String(anchor.getFullYear()),
    };
  }

  return {
    kind: 'month',
    start: toISODate(startOfMonth(anchor)),
    end: toISODate(endOfMonth(anchor)),
    label: monthLabel(anchor),
  };
}

/** Periodo inmediatamente anterior al seleccionado, con la misma duración calendárica. */
export function previousPeriod(period: Period): Period {
  const start = fromISODate(period.start);
  const end = fromISODate(period.end);

  if (period.kind === 'month') {
    const prev = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    return resolvePeriod('month', prev);
  }
  if (period.kind === 'quarter') {
    const prev = new Date(start.getFullYear(), start.getMonth() - 3, 1);
    return resolvePeriod('quarter', prev);
  }
  if (period.kind === 'year') {
    return resolvePeriod('year', new Date(start.getFullYear() - 1, 0, 1));
  }

  const duration = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(duration - 1));
  return {
    kind: 'range',
    start: toISODate(prevStart),
    end: toISODate(prevEnd),
    label: `${shortDateLabel(prevStart)} – ${shortDateLabel(prevEnd)}`,
  };
}

export function filterByPeriod(records: RadianRecord[], period: Period): RadianRecord[] {
  return records.filter((r) => {
    const d = parseRecordDate(r['Fecha Emisión']);
    if (!d) return false;
    const iso = toISODate(d);
    return iso >= period.start && iso <= period.end;
  });
}
