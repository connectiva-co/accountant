import type { Direction, Severity } from '../db/schema.js';
import { parseRecordDate, parseRecordDateTime, toIsoDate } from '../domain/dates.js';
import type { DocumentTypeIndex } from '../domain/documentTypes.js';
import { resolveDocumentType } from '../domain/documentTypes.js';
import { externalUidFor } from '../domain/uid.js';
import { taxCodeForColumn } from '../domain/taxes.js';
import {
  cleanName,
  isPlaceholderName,
  isValidNit,
  nameKey,
  norm,
  parseAmount,
  taxIdDigits,
} from '../domain/text.js';

export interface RowIssue {
  code: string;
  severity: Severity;
  message: string;
  reject?: boolean;
}

export interface NormalizedTax {
  code: string;
  amount: number;
}

export interface NormalizedRow {
  rowNumber: number;
  externalUid: string | null;
  typeLabel: string;
  typeCode: string | null;
  isEvent: boolean;
  folio: string | null;
  prefix: string | null;
  currency: string;
  paymentForm: string | null;
  paymentMethod: string | null;
  issuedAt: string | null;
  receivedAt: Date | null;
  issuerTaxId: string | null;
  issuerCheckDigit: string | null;
  issuerName: string | null;
  issuerNameKey: string | null;
  receiverTaxId: string | null;
  receiverCheckDigit: string | null;
  receiverName: string | null;
  receiverNameKey: string | null;
  total: number;
  status: string;
  group: string | null;
  direction: Direction;
  taxes: NormalizedTax[];
  issues: RowIssue[];
  raw: Record<string, unknown>;
}

export interface NormalizeContext {
  companyNitDigits: string | null;
  docTypes: DocumentTypeIndex;
  allowUnknownType: boolean;
  unknownTypeCode: string;
  rejectRowsWithoutIds: boolean;
  /** uid -> número de fila de la primera aparición (detección de duplicados en el archivo). */
  seenUids: Map<string, number>;
}

const GROUP_TO_DIRECTION: Record<string, Direction> = { emitido: 'ISSUED', recibido: 'RECEIVED' };

function str(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  if (v === undefined || v === null) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

function splitTaxId(rawValue: unknown): { taxId: string | null; checkDigit: string | null } {
  const raw = String(rawValue ?? '').trim().replace(/\.0$/, '');
  if (!raw) return { taxId: null, checkDigit: null };
  const dash = raw.match(/^(.*?)-(\d{1,2})$/);
  const digits = taxIdDigits(dash ? dash[1] : raw);
  if (!digits) return { taxId: null, checkDigit: null };
  return { taxId: digits, checkDigit: dash ? dash[2] : null };
}

function plausibleStatus(status: string): boolean {
  const s = norm(status);
  if (!s) return false;
  return (
    s.includes('aprob') ||
    s.includes('aceptad') ||
    s.includes('pendient') ||
    s.includes('proceso') ||
    s.includes('enviad') ||
    s.includes('rechaz') ||
    s.includes('inconsisten') ||
    s.includes('advertenc') ||
    s.includes('recibid') ||
    s.includes('emitid')
  );
}

export function normalizeRow(
  raw: Record<string, unknown>,
  rowNumber: number,
  ctx: NormalizeContext,
): NormalizedRow {
  const issues: RowIssue[] = [];

  /* --- identificadores --- */
  const typeLabel = str(raw, 'Tipo de documento');
  const folio = str(raw, 'Folio') || null;
  const prefix = str(raw, 'Prefijo') || null;
  const issuedDate = parseRecordDate(raw['Fecha Emisión']);
  const issuedAt = issuedDate ? toIsoDate(issuedDate) : null;

  if (!issuedDate) {
    issues.push({
      code: 'TU002',
      severity: 'ERROR',
      message: 'Fecha de emisión ausente o ilegible (admite dd-mm-aaaa, aaaa-mm-dd o fecha de Excel).',
      reject: true,
    });
  }

  const cufe = str(raw, 'CUFE/CUDE');
  const issuer = splitTaxId(raw['NIT Emisor']);
  const receiver = splitTaxId(raw['NIT Receptor']);
  const issuerName = cleanName(raw['Nombre Emisor']);
  const receiverName = cleanName(raw['Nombre Receptor']);

  let externalUid = externalUidFor({
    cufe,
    issuerTaxId: issuer.taxId,
    prefix,
    folio,
    issuedAtIso: issuedAt,
  });
  if (!externalUid && !ctx.rejectRowsWithoutIds) {
    // Último recurso determinista permitido por configuración: hash del contenido.
    externalUid = `ROWHASH:${rowNumber}`;
  }
  if (!externalUid) {
    issues.push({
      code: 'TU011',
      severity: 'ERROR',
      message: 'Sin CUFE/CUDE ni identificador compuesto (NIT emisor + prefijo + folio + fecha).',
      reject: true,
    });
  }

  const seen = externalUid ? ctx.seenUids.get(externalUid) : undefined;
  if (externalUid && seen !== undefined) {
    issues.push({
      code: 'TU010',
      severity: 'WARNING',
      message: `Duplicado en el archivo: mismo identificador que la fila ${seen}.`,
      reject: true,
    });
  } else if (externalUid) {
    ctx.seenUids.set(externalUid, rowNumber);
  }

  /* --- tipo de documento --- */
  const typeMatch = resolveDocumentType(ctx.docTypes, typeLabel);
  let typeCode: string | null = typeMatch?.code ?? null;
  if (!typeMatch) {
    if (ctx.allowUnknownType && ctx.docTypes.byCode.has(ctx.unknownTypeCode)) {
      typeCode = ctx.unknownTypeCode;
      issues.push({
        code: 'TU007',
        severity: 'WARNING',
        message: `Tipo de documento desconocido "${typeLabel || 'vacío'}": se clasifica como ${ctx.unknownTypeCode}.`,
      });
    } else {
      issues.push({
        code: 'TU007',
        severity: 'ERROR',
        message: `Tipo de documento desconocido o vacío: "${typeLabel || 'vacío'}".`,
        reject: true,
      });
    }
  }
  const docType = typeCode ? ctx.docTypes.byCode.get(typeCode) : undefined;

  /* --- terceros --- */
  if (issuer.taxId && !isPlaceholderName(issuerName ?? '') && !isValidNit(issuer.taxId)) {
    issues.push({ code: 'TU003', severity: 'WARNING', message: `NIT emisor inválido: ${issuer.taxId}.` });
  }
  if (receiver.taxId && !isValidNit(receiver.taxId)) {
    issues.push({ code: 'TU004', severity: 'WARNING', message: `NIT receptor inválido: ${receiver.taxId}.` });
  }
  if (!issuerName) issues.push({ code: 'TU005', severity: 'WARNING', message: 'Falta el nombre del emisor.' });
  if (!receiverName) issues.push({ code: 'TU005', severity: 'WARNING', message: 'Falta el nombre del receptor.' });

  /* --- recepción --- */
  const receivedDate = parseRecordDateTime(raw['Fecha Recepción']);
  if (!receivedDate) {
    issues.push({ code: 'TU006', severity: 'WARNING', message: 'Documento sin fecha de recepción.' });
  }

  /* --- dirección: NIT de la empresa manda; Grupo como respaldo y validación --- */
  const group = str(raw, 'Grupo') || null;
  const groupDirection = group ? (GROUP_TO_DIRECTION[norm(group)] ?? null) : null;
  let direction: Direction = 'UNKNOWN';

  if (ctx.companyNitDigits) {
    const iAmIssuer = Boolean(issuer.taxId && issuer.taxId === ctx.companyNitDigits);
    const iAmReceiver = Boolean(receiver.taxId && receiver.taxId === ctx.companyNitDigits);
    if (iAmIssuer !== iAmReceiver) direction = iAmIssuer ? 'ISSUED' : 'RECEIVED';
    else if (groupDirection) direction = groupDirection;
  } else if (groupDirection) {
    direction = groupDirection;
  }

  if (direction === 'UNKNOWN') {
    issues.push({
      code: 'TU008',
      severity: 'WARNING',
      message: 'No se pudo determinar la dirección (NIT de la empresa no coincide con emisor ni receptor).',
    });
  } else if (groupDirection && groupDirection !== direction) {
    issues.push({
      code: 'TU008',
      severity: 'WARNING',
      message: `Inconsistencia de dirección: el archivo dice "${group}" pero el NIT de la empresa indica ${direction}.`,
    });
  }

  /* --- importes --- */
  const totalParsed = parseAmount(raw['Total']);
  let total = totalParsed ?? 0;
  if (totalParsed === null) {
    issues.push({ code: 'TU009', severity: 'WARNING', message: 'Total ilegible o vacío: se registra como 0.' });
  }
  if (total < 0) {
    issues.push({ code: 'TU014', severity: 'WARNING', message: `Total negativo: ${total}.` });
  }

  const taxes: NormalizedTax[] = [];
  for (const [header, value] of Object.entries(raw)) {
    const code = taxCodeForColumn(header);
    if (!code) continue;
    const amount = parseAmount(value);
    if (amount === null || amount === 0) continue;
    taxes.push({ code, amount });
  }
  taxes.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  /* --- estado --- */
  const status = str(raw, 'Estado') || 'UNKNOWN';
  if (!plausibleStatus(status)) {
    issues.push({ code: 'TU013', severity: 'INFO', message: `Estado fuera de los valores conocidos: "${status}".` });
  }

  const currencyRaw = str(raw, 'Divisa').toUpperCase();
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : 'COP';

  return {
    rowNumber,
    externalUid,
    typeLabel,
    typeCode,
    isEvent: docType?.category === 'EVENT',
    folio,
    prefix,
    currency,
    paymentForm: str(raw, 'Forma de Pago') || null,
    paymentMethod: str(raw, 'Medio de Pago') || null,
    issuedAt,
    receivedAt: receivedDate,
    issuerTaxId: issuer.taxId,
    issuerCheckDigit: issuer.checkDigit,
    issuerName,
    issuerNameKey: nameKey(issuerName),
    receiverTaxId: receiver.taxId,
    receiverCheckDigit: receiver.checkDigit,
    receiverName,
    receiverNameKey: nameKey(receiverName),
    total,
    status,
    group,
    direction,
    taxes,
    issues,
    raw,
  };
}
