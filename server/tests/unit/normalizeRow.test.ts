import { describe, expect, it } from 'vitest';
import type { DocumentType } from '../../src/db/schema.js';
import type { DocumentTypeIndex } from '../../src/domain/documentTypes.js';
import {
  normalizeRow,
  type NormalizeContext,
  type NormalizedRow,
} from '../../src/import/normalizeRow.js';

function typeRow(code: string, name: string): DocumentType {
  return {
    id: `id-${code}`,
    code,
    name,
    category: 'INVOICE',
    is_economic_document: true,
    active: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

const rows: DocumentType[] = [
  typeRow('FACTURA_ELECTRONICA', 'Factura electrónica'),
  typeRow('DOCUMENTO_SOPORTE_NO_OBLIGADO', 'Documento soporte con no obligados'),
  typeRow('DOCUMENTO_EQUIVALENTE_POS', 'Documento equivalente POS'),
  typeRow('OTRO', 'Otro documento'),
];

const docTypes: DocumentTypeIndex = {
  byCode: new Map(rows.map((r) => [r.code, r])),
  byLabel: new Map(rows.map((r) => [r.name.toLowerCase(), r])),
  unknownCode: 'OTRO',
};

function ctx(overrides: Partial<NormalizeContext> = {}): NormalizeContext {
  return {
    companyNitDigits: '900555053',
    docTypes,
    allowUnknownType: false,
    unknownTypeCode: 'OTRO',
    rejectRowsWithoutIds: false,
    seenUids: new Map(),
    ...overrides,
  };
}

function rawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Tipo de documento': 'Factura electrónica',
    'CUFE/CUDE': 'fb8257f1547f60233f492889af20eeacb76b4caf097d1ffe3e46560e887743c3142107a7e0d2a7d249c23f0db4378b61',
    Folio: '10349',
    Prefijo: 'FE',
    Divisa: 'COP',
    'Forma de Pago': 2,
    'Medio de Pago': '10',
    'Fecha Emisión': '27-08-2026',
    'Fecha Recepción': '02-09-2026 11:26:20',
    'NIT Emisor': 900555053,
    'Nombre Emisor': 'JGV GRUPO DE INVERSION S A S',
    'NIT Receptor': 1033733307,
    'Nombre Receptor': 'MAVEL CRISTINA ZULUAGA',
    IVA: 184000,
    'Rete Renta': 0,
    Total: 920000,
    Estado: 'Aprobado',
    Grupo: 'Emitido',
    ...overrides,
  };
}

function codes(row: NormalizedRow): string[] {
  return row.issues.map((i) => i.code);
}

describe('normalizeRow', () => {
  it('normaliza una fila válida: uid, dirección por NIT, impuestos e importes', () => {
    const row = normalizeRow(rawRow(), 2, ctx());
    expect(row.externalUid).toBe(rawRow()['CUFE/CUDE']);
    expect(row.issuedAt).toBe('2026-08-27');
    expect(row.direction).toBe('ISSUED');
    expect(row.typeCode).toBe('FACTURA_ELECTRONICA');
    expect(row.total).toBe(920000);
    expect(row.taxes).toEqual([{ code: 'IVA', amount: 184000 }]);
    expect(row.issues.filter((i) => i.reject)).toEqual([]);
    expect(codes(row)).not.toContain('TU004');
  });

  it('rechaza la fila sin fecha de emisión (TU002)', () => {
    const row = normalizeRow(rawRow({ 'Fecha Emisión': '' }), 3, ctx());
    expect(row.issuedAt).toBeNull();
    expect(row.issues.some((i) => i.code === 'TU002' && i.reject)).toBe(true);
  });

  it('acepta fecha ISO y serial de Excel', () => {
    expect(normalizeRow(rawRow({ 'Fecha Emisión': '2026-08-27' }), 4, ctx()).issuedAt).toBe('2026-08-27');
    expect(normalizeRow(rawRow({ 'Fecha Emisión': 46261 }), 5, ctx()).issuedAt).toBe('2026-08-27');
  });

  it('rechaza tipos de documento desconocidos (TU007) y los clasifica como OTRO si está permitido', () => {
    const rejected = normalizeRow(rawRow({ 'Tipo de documento': 'Carta magica' }), 6, ctx());
    expect(rejected.issues.some((i) => i.code === 'TU007' && i.reject)).toBe(true);

    const tolerated = normalizeRow(
      rawRow({ 'Tipo de documento': 'Carta magica' }),
      7,
      ctx({ allowUnknownType: true }),
    );
    expect(tolerated.typeCode).toBe('OTRO');
    expect(tolerated.issues.some((i) => i.code === 'TU007' && !i.reject)).toBe(true);
  });

  it('marca duplicados en el archivo (TU010) sin perder el primer registro', () => {
    const c = ctx();
    const first = normalizeRow(rawRow(), 8, c);
    const second = normalizeRow(rawRow(), 9, c);
    expect(first.issues.filter((i) => i.code === 'TU010')).toHaveLength(0);
    expect(second.issues.some((i) => i.code === 'TU010' && i.reject)).toBe(true);
  });

  it('advierte NIT de receptor placeholder (TU004)', () => {
    const row = normalizeRow(rawRow({ 'NIT Receptor': 222222222222 }), 10, ctx());
    expect(row.issues.some((i) => i.code === 'TU004' && !i.reject)).toBe(true);
  });

  it('la dirección la decide el NIT de la empresa; Grupo solo como respaldo', () => {
    // El archivo dice "Emitido", pero el NIT de la empresa es el receptor.
    const received = normalizeRow(
      rawRow({ 'NIT Emisor': 1033733307, 'Nombre Emisor': 'PROVEEDOR SAS', 'NIT Receptor': 900555053 }),
      11,
      ctx(),
    );
    expect(received.direction).toBe('RECEIVED');
    expect(codes(received)).toContain('TU008');

    // Sin NIT de la empresa en la fila => cae al Grupo.
    const fallback = normalizeRow(
      rawRow({ 'NIT Emisor': 1033733307, 'NIT Receptor': 800123456 }),
      12,
      ctx({ companyNitDigits: null }),
    );
    expect(fallback.direction).toBe('ISSUED');
  });

  it('sin CUFE usa el fallback determinista NIT+prefijo+folio+fecha', () => {
    const row = normalizeRow(rawRow({ 'CUFE/CUDE': '' }), 13, ctx());
    expect(row.externalUid).toBe('FALLBACK:900555053:FE:10349:2026-08-27');
  });

  it('sin identificador y con rejectRowsWithoutIds rechaza la fila (TU011)', () => {
    const row = normalizeRow(
      rawRow({ 'CUFE/CUDE': '', Folio: '', 'NIT Emisor': '' }),
      14,
      ctx({ rejectRowsWithoutIds: true }),
    );
    expect(row.externalUid).toBeNull();
    expect(row.issues.some((i) => i.code === 'TU011' && i.reject)).toBe(true);
  });

  it('sin identificador y con rejectRowsWithoutIds=false usa el hash de contenido de la fila', () => {
    const row = normalizeRow(
      rawRow({ 'CUFE/CUDE': '', Folio: '', 'NIT Emisor': '' }),
      14,
      ctx(),
    );
    expect(row.externalUid).toBe('ROWHASH:14');
  });

  it('total ilegible queda en 0 con aviso (TU009), nunca se inventa', () => {
    const row = normalizeRow(rawRow({ Total: 'mil pesos' }), 15, ctx());
    expect(row.total).toBe(0);
    expect(codes(row)).toContain('TU009');
  });

  it('normaliza divisa inválida a COP', () => {
    expect(normalizeRow(rawRow({ Divisa: 'pesos' }), 16, ctx()).currency).toBe('COP');
    expect(normalizeRow(rawRow({ Divisa: 'usd' }), 17, ctx()).currency).toBe('USD');
  });
});
