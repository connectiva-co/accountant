import { describe, expect, it } from 'vitest';
import {
  cleanName,
  isPlaceholderName,
  isPlaceholderNit,
  isValidNit,
  nameKey,
  norm,
  normalizeTaxId,
  parseAmount,
  stableStringify,
  taxIdDigits,
} from '../../src/domain/text.js';

describe('norm', () => {
  it('quita acentos, colapsa espacios y pasa a minúsculas', () => {
    expect(norm('  Factura   Electrónica ')).toBe('factura electronica');
    expect(norm(null)).toBe('');
    expect(norm(undefined)).toBe('');
  });
});

describe('NIT', () => {
  it('normaliza formato con puntos y guion conservando el dígito de verificación', () => {
    expect(normalizeTaxId('900.555.053-8')).toBe('9005550538');
    expect(taxIdDigits('900.555.053-8')).toBe('9005550538');
    expect(taxIdDigits(900555053)).toBe('900555053');
    expect(normalizeTaxId(900555053.0)).toBe('900555053');
    expect(normalizeTaxId('   ')).toBeNull();
    expect(normalizeTaxId(null)).toBeNull();
  });

  it('aplica la regla de longitud del frontend: 6 a 10 dígitos', () => {
    expect(isValidNit(900555053)).toBe(true);
    expect(isValidNit('222222222222')).toBe(false); // 12 dígitos
    expect(isValidNit('123')).toBe(false); // muy corto
    expect(isValidNit('')).toBe(false);
  });

  it('reconoce placeholders', () => {
    expect(isPlaceholderNit('222222222222')).toBe(true);
    expect(isPlaceholderNit(900555053)).toBe(false);
    expect(isPlaceholderNit(null)).toBe(true);
    expect(isPlaceholderName('Consumidor Final')).toBe(true);
    expect(isPlaceholderName('MAVEL CRISTINA ZULUAGA')).toBe(false);
  });
});

describe('nombres', () => {
  it('cleanName solo colapsa espacios (para mostrar)', () => {
    expect(cleanName('  JGV   GRUPO  ')).toBe('JGV GRUPO');
    expect(cleanName('')).toBeNull();
  });

  it('nameKey es mayúsculas sin acentos ni puntuación (para comparar)', () => {
    expect(nameKey('Jóhn D.')).toBe('JOHN D');
    expect(nameKey('Mavel Cristina Zuluaga')).toBe('MAVEL CRISTINA ZULUAGA');
    expect(nameKey('   ')).toBeNull();
  });
});

describe('parseAmount', () => {
  it('entiende formatos latinos y anglosajones', () => {
    expect(parseAmount('1.234.567,89')).toBe(1234567.89);
    expect(parseAmount('1,234,567.89')).toBe(1234567.89);
    expect(parseAmount('1.234')).toBe(1234); // miles sin decimales
    expect(parseAmount('1.23')).toBe(1.23);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount(42)).toBe(42);
    expect(parseAmount('920000.0')).toBe(920000);
  });

  it('devuelve null (no inventa) ante valores ilegibles', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('-')).toBeNull();
    expect(parseAmount(Number.NaN)).toBeNull();
  });
});

describe('stableStringify', () => {
  it('es independiente del orden de claves (base del hash idempotente)', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ a: undefined, b: 1 })).toBe(stableStringify({ b: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify([{ b: 1, a: 2 }])).toBe(stableStringify([{ a: 2, b: 1 }]));
  });
});
