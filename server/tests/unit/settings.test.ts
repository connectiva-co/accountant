import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  UnknownScopeError,
  UnknownSettingKeyError,
  isKnownKey,
  resolveScopeValues,
  scopeDefaults,
  validateSettingValue,
} from '../../src/settings/schemas.js';

describe('validación de settings', () => {
  it('acepta valores válidos y los normaliza (defaults del schema)', () => {
    expect(validateSettingValue('tax', 'default_vat_rate', 19)).toBe(19);
    expect(validateSettingValue('general', 'maintenance_mode', false)).toBe(false);
    expect(validateSettingValue('tax', 'withholding_sources', ['RENTA'])).toEqual(['RENTA']);
    expect(validateSettingValue('currency', 'display', 'USD')).toBe('USD');
  });

  it('rechaza scope desconocido con UnknownScopeError (no ZodError genérico)', () => {
    expect(() => validateSettingValue('integrations', 'x', 1)).toThrow(UnknownScopeError);
    try {
      validateSettingValue('integrations', 'x', 1);
    } catch (error) {
      expect((error as UnknownScopeError).scope).toBe('integrations');
      expect((error as Error).message).toContain('integrations');
    }
  });

  it('rechaza clave desconocida con UnknownSettingKeyError', () => {
    expect(() => validateSettingValue('tax', 'no_existe', 1)).toThrow(UnknownSettingKeyError);
    expect(isKnownKey('tax', 'default_vat_rate')).toBe(true);
    expect(isKnownKey('tax', 'no_existe')).toBe(false);
    expect(isKnownKey('nope', 'default_vat_rate')).toBe(false);
  });

  it('rechaza tipos fuera de esquema con ZodError', () => {
    expect(() => validateSettingValue('tax', 'default_vat_rate', '19')).toThrow(ZodError);
    expect(() => validateSettingValue('tax', 'default_vat_rate', -1)).toThrow(ZodError);
    expect(() => validateSettingValue('tax', 'default_vat_rate', 101)).toThrow(ZodError);
    expect(() => validateSettingValue('currency', 'display', 'GBP')).toThrow(ZodError);
    expect(() => validateSettingValue('general', 'date_format', 'YYYY/MM/DD')).toThrow(ZodError);
  });

  it('resolveScopeValues completa defaults para claves ausentes', () => {
    expect(resolveScopeValues('currency', {})).toEqual({
      display: 'COP',
      rounding_mode: 'HALF_UP',
    });
    expect(resolveScopeValues('general', {})).toEqual({
      locale: 'es-CO',
      date_format: 'DD/MM/YYYY',
      maintenance_mode: false,
    });
  });

  it('resolveScopeValues mezcla defaults + guardados y sanea tipos rotos', () => {
    const resolved = resolveScopeValues('reporting', {
      include_events_in_metrics: true,
      include_inactive_documents: 'si' as never, // tipo inválido → default
      clave_legacy: 'queda' as never, // fuera de schema → se conserva en lectura
    });
    expect(resolved).toEqual({
      include_events_in_metrics: true,
      include_inactive_documents: false,
      clave_legacy: 'queda',
    });
  });

  it('scopeDefaults cubre las claves de todos los scopes', () => {
    const defaults = scopeDefaults('tax');
    expect(defaults.default_vat_rate).toBe(19);
    expect(defaults.withholding_mode).toBe('FILE_ONLY');
    expect(scopeDefaults('nope')).toEqual({});
  });
});
