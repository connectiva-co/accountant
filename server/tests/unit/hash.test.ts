import { describe, expect, it } from 'vitest';
import { fileSha256, sourceHash, type HashableDocument } from '../../src/domain/hash.js';

function doc(overrides: Partial<HashableDocument> = {}): HashableDocument {
  return {
    externalUid: 'fb8257f1547f60233f492889af20eeac',
    documentTypeCode: 'FACTURA_ELECTRONICA',
    folio: '10349',
    prefix: 'DS',
    currency: 'COP',
    paymentForm: '2',
    paymentMethod: '10',
    issuedAt: '2026-08-27',
    receivedAt: '2026-09-02 11:26:20',
    issuerTaxId: '900555053',
    issuerName: 'JGV GRUPO DE INVERSION S A S',
    receiverTaxId: '1033733307',
    receiverName: 'MAVEL CRISTINA ZULUAGA',
    total: 920000,
    status: 'Aprobado',
    direction: 'ISSUED',
    taxes: [
      { code: 'IVA', amount: 1000 },
      { code: 'RET_RENTA', amount: 0 },
    ],
    ...overrides,
  };
}

describe('sourceHash', () => {
  it('es estable entre ejecuciones (mismo documento => mismo hash)', () => {
    expect(sourceHash(doc())).toBe(sourceHash(doc()));
  });

  it('no depende del orden de las claves ni de las taxes', () => {
    const a = doc();
    const b = doc({
      taxes: [...a.taxes].reverse(),
    });
    expect(sourceHash(b)).toBe(sourceHash(a));
  });

  it('cambia cuando cambia un campo normalizado', () => {
    expect(sourceHash(doc({ total: 920001 }))).not.toBe(sourceHash(doc()));
    expect(sourceHash(doc({ status: 'Rechazado' }))).not.toBe(sourceHash(doc()));
    expect(sourceHash(doc({ direction: 'RECEIVED' }))).not.toBe(sourceHash(doc()));
    expect(
      sourceHash(doc({ taxes: [...doc().taxes, { code: 'INC', amount: 5 }] })),
    ).not.toBe(sourceHash(doc()));
  });

  it('tolera ruido de decimales (round a 2 decimales)', () => {
    expect(sourceHash(doc({ total: 920000.001 }))).toBe(sourceHash(doc({ total: 920000 })));
    expect(
      sourceHash(doc({ taxes: [{ code: 'IVA', amount: 1000.004 }, { code: 'RET_RENTA', amount: 0 }] })),
    ).toBe(sourceHash(doc()));
  });

  it('produce hex de 64 caracteres (SHA-256)', () => {
    expect(sourceHash(doc())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('fileSha256', () => {
  it('depende del contenido del buffer', () => {
    expect(fileSha256(Buffer.from('hola'))).toBe(fileSha256(Buffer.from('hola')));
    expect(fileSha256(Buffer.from('hola'))).not.toBe(fileSha256(Buffer.from('holb')));
    expect(fileSha256(Buffer.from('hola'))).toMatch(/^[0-9a-f]{64}$/);
  });
});
