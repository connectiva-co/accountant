import { describe, expect, it } from 'vitest';
import {
  monthOf,
  parseRecordDate,
  parseRecordDateTime,
  toIsoDate,
  yearOf,
} from '../../src/domain/dates.js';

describe('parseRecordDate', () => {
  it('acepta dd-mm-aaaa (formato RADIAN)', () => {
    const d = parseRecordDate('27-08-2026');
    expect(d).not.toBeNull();
    expect(toIsoDate(d!)).toBe('2026-08-27');
    expect(parseRecordDate('27/08/2026')).not.toBeNull();
    expect(parseRecordDate('27.08.2026')).not.toBeNull();
  });

  it('acepta aaaa-mm-dd y serial de Excel', () => {
    expect(toIsoDate(parseRecordDate('2026-08-27')!)).toBe('2026-08-27');
    // 46261 = 27/08/2026 en el sistema de fechas de Excel
    expect(toIsoDate(parseRecordDate(46261)!)).toBe('2026-08-27');
  });

  it('rechaza fechas ilegibles o fuera de rango creíble', () => {
    expect(parseRecordDate('')).toBeNull();
    expect(parseRecordDate(null)).toBeNull();
    expect(parseRecordDate('31-02-2026')).toBeNull();
    expect(parseRecordDate('no es fecha')).toBeNull();
    expect(parseRecordDate('27-08-1800')).toBeNull();
  });
});

describe('parseRecordDateTime', () => {
  it('lee "02-09-2026 11:26:20" con hora', () => {
    const d = parseRecordDateTime('02-09-2026 11:26:20');
    expect(d).not.toBeNull();
    expect(toIsoDate(d!)).toBe('2026-09-02');
    expect(d!.getHours()).toBe(11);
    expect(d!.getMinutes()).toBe(26);
    expect(d!.getSeconds()).toBe(20);
  });

  it('acepta ISO con T y devuelve null con basura', () => {
    const d = parseRecordDateTime('2026-09-02T11:26:20');
    expect(toIsoDate(d!)).toBe('2026-09-02');
    expect(parseRecordDateTime('')).toBeNull();
    expect(parseRecordDateTime(undefined)).toBeNull();
  });
});

describe('helpers de periodo', () => {
  it('extrae año y mes de una fecha local', () => {
    const d = new Date(2026, 7, 31);
    expect(yearOf(d)).toBe(2026);
    expect(monthOf(d)).toBe(8);
    expect(toIsoDate(d)).toBe('2026-08-31');
  });
});
