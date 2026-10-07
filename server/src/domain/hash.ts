import { createHash } from 'node:crypto';
import { stableStringify } from './text.js';

export interface HashableDocument {
  externalUid: string;
  documentTypeCode: string;
  folio: string | null;
  prefix: string | null;
  currency: string;
  paymentForm: string | null;
  paymentMethod: string | null;
  issuedAt: string | null;
  receivedAt: string | null;
  issuerTaxId: string | null;
  issuerName: string | null;
  receiverTaxId: string | null;
  receiverName: string | null;
  total: number;
  status: string;
  direction: string;
  taxes: Array<{ code: string; amount: number }>;
}

/**
 * SHA-256 determinista sobre los campos normalizados del documento (no sobre
 * el crudo del archivo): el mismo documento lógico produce el mismo hash aunque
 * cambie el formato de la celda. Es la base de INSERT / UNCHANGED / UPDATE.
 */
export function sourceHash(doc: HashableDocument): string {
  const taxes = [...doc.taxes]
    .map((t) => ({ code: t.code, amount: round2(t.amount) }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const payload: HashableDocument = { ...doc, total: round2(doc.total), taxes };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function fileSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
