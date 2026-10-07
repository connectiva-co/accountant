import { norm } from './text.js';

/** Columnas de impuesto de RADIAN (crudo -> código de tax_types). */
export const TAX_COLUMNS: Record<string, string> = {
  iva: 'IVA',
  'rete iva': 'IVA_RETE',
  'rete renta': 'RENTA_RETE',
  'rete ica': 'ICA_RETE',
  inc: 'INC',
  ic: 'IC',
  ica: 'ICA',
  'inc bolsas': 'INC_BOLSAS',
  'in carbono': 'IN_CARBONO',
  'inc combustibles': 'INC_COMBUSTIBLES',
  'ic datos': 'IC_DATOS',
  icl: 'ICL',
  inpp: 'INPP',
  ibua: 'IBUA',
  icui: 'ICUI',
  timbre: 'TIMBRE',
};

/** Impuestos que el frontend suma como indirectos (base gravable / IVA). */
export const INDIRECT_TAX_CODES = new Set([
  'IVA',
  'INC',
  'IBUA',
  'INC_BOLSAS',
  'IC',
  'ICA',
  'TIMBRE',
  'ICUI',
]);

export const WITHHOLDING_TAX_CODES = new Set(['IVA_RETE', 'RENTA_RETE', 'ICA_RETE']);

export function taxCodeForColumn(header: unknown): string | null {
  return TAX_COLUMNS[norm(header)] ?? null;
}
