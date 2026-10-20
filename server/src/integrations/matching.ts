import type { Kysely } from 'kysely';
import type { Database, Json } from '../db/schema.js';
import { taxIdDigits } from '../domain/text.js';
import type { DocumentLookupQuery, ExternalDocumentCandidate } from './adapter.js';
import type { ResolvedClient } from './manager.js';

export type MatchStatus = 'NOT_CHECKED' | 'MATCHED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'ERROR';
export type MatchMethod = 'CUFE' | 'TAX_ID' | 'FOLIO_THIRD_PARTY' | 'NUMBER_THIRD_PARTY_TOTAL_DATE' | 'EXTERNAL_ID';

/** Un match solo se da por bueno con esta confianza mínima. */
const MATCH_THRESHOLD = 0.85;
/** Dos candidatos a menos de esta distancia del mejor → ambigüedad. */
const AMBIGUITY_MARGIN = 0.05;
const MAX_REPORTED_CANDIDATES = 5;

export interface MatchableDocument {
  id: string;
  company_id: string;
  external_uid: string;
  prefix: string | null;
  folio: string | null;
  issued_at: string | null;
  total: number;
  direction: 'ISSUED' | 'RECEIVED' | 'UNKNOWN';
  counterparty_tax_id: string | null;
  company_tax_id: string | null;
}

export interface MatchOutcome {
  status: MatchStatus;
  method: MatchMethod | null;
  confidence: number | null;
  candidate: ExternalDocumentCandidate | null;
  candidates: ExternalDocumentCandidate[];
  errorMessage: string | null;
}

export function isFallbackUid(externalUid: string): boolean {
  return externalUid.startsWith('FALLBACK:');
}

export function isCufe(externalUid: string): boolean {
  return externalUid.length > 0 && !isFallbackUid(externalUid);
}

/** Pistas que el documento local aporta para buscar en el ERP. */
export function buildLookupQuery(doc: MatchableDocument, windowDays = 20): DocumentLookupQuery {
  return {
    direction: doc.direction,
    cufe: isCufe(doc.external_uid) ? doc.external_uid : null,
    thirdPartyTaxId: taxIdDigits(doc.counterparty_tax_id),
    prefix: doc.prefix ?? null,
    number: doc.folio ?? null,
    issueDate: doc.issued_at ?? null,
    total: doc.total ?? null,
    windowDays,
  };
}

interface Scored {
  score: number;
  method: MatchMethod;
}

/**
 * Puntúa un candidato externo contra el documento local.
 *
 * El cuadro de puntos es deliberadamente simple y determinista: CUFE o
 * identidad externa mandan; si no, se combinan NIT + folio/número + fecha +
 * total. Un candidato que solo coincide por NIT queda por debajo del umbral y
 * se reporta como ambiguo, nunca como match.
 */
export function scoreCandidate(
  candidate: ExternalDocumentCandidate,
  doc: MatchableDocument,
): Scored | null {
  const query = buildLookupQuery(doc);

  if (query.cufe && candidate.cufe && candidate.cufe.toUpperCase() === query.cufe.toUpperCase()) {
    return { score: 1, method: 'CUFE' };
  }
  if (candidate.externalId && candidate.externalId === doc.external_uid) {
    return { score: 1, method: 'EXTERNAL_ID' };
  }

  const localTax = query.thirdPartyTaxId;
  const externalTax = taxIdDigits(candidate.thirdPartyTaxId);
  const sameTax = Boolean(localTax && externalTax && localTax === externalTax);

  const sameNumber = Boolean(
    query.number &&
      candidate.externalNumber &&
      (splitNumber(candidate.externalNumber) === query.number ||
        candidate.externalNumber.endsWith(query.number)),
  );
  const samePrefix = Boolean(
    query.prefix &&
      candidate.externalNumber &&
      candidate.externalNumber.toUpperCase().startsWith(query.prefix.toUpperCase()),
  );
  const sameDate = Boolean(
    query.issueDate &&
      candidate.issueDate &&
    query.issueDate.slice(0, 10) === candidate.issueDate.slice(0, 10),
  );
  const candidateTotal = candidate.total ?? null;
  const sameTotal = Boolean(
    query.total !== undefined &&
      query.total !== null &&
      candidateTotal !== null &&
      Math.abs(candidateTotal - query.total) <= 0.01,
  );

  const score =
    (sameTax ? 0.4 : 0) +
    (samePrefix || sameNumber ? 0.35 : 0) +
    (sameDate ? 0.15 : 0) +
    (sameTotal ? 0.15 : 0);

  if (score <= 0) return null;

  let method: MatchMethod = 'TAX_ID';
  if (samePrefix || sameNumber) method = 'FOLIO_THIRD_PARTY';
  if (sameNumber && sameTax && sameTotal && sameDate) method = 'NUMBER_THIRD_PARTY_TOTAL_DATE';

  return { score: Math.min(1, score), method };
}

function splitNumber(externalNumber: string): string {
  return externalNumber.split('-').pop() ?? externalNumber;
}

/**
 * Busca el documento en el ERP vía el adapter y decide el estado de match.
 *
 * Reglas de oro:
 * - Un error del provider (token vencido, 429, timeout, red) es ERROR, nunca
 *   NOT_FOUND: "no pude consultar" no es "no existe".
 * - Dos candidatos casi empatados son AMBIGUOUS, no se elige al azar.
 */
export async function matchDocument(
  resolved: ResolvedClient,
  doc: MatchableDocument,
  options: { windowDays?: number } = {},
): Promise<MatchOutcome> {
  const query = buildLookupQuery(doc, options.windowDays);

  let candidates: ExternalDocumentCandidate[];
  try {
    candidates = await resolved.adapter.searchDocuments(resolved.client, query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'ERROR',
      method: null,
      confidence: null,
      candidate: null,
      candidates: [],
      errorMessage: message.slice(0, 500),
    };
  }

  if (candidates.length === 0) {
    return { status: 'NOT_FOUND', method: null, confidence: null, candidate: null, candidates: [], errorMessage: null };
  }

  const scored = candidates
    .map((candidate) => ({ candidate, scored: scoreCandidate(candidate, doc) }))
    .filter((entry): entry is { candidate: ExternalDocumentCandidate; scored: Scored } => entry.scored !== null)
    .sort((a, b) => b.scored.score - a.scored.score);

  if (scored.length === 0) {
    return { status: 'NOT_FOUND', method: null, confidence: null, candidate: null, candidates: [], errorMessage: null };
  }

  const best = scored[0];
  const runnerUp = scored[1];
  const reported = scored.slice(0, MAX_REPORTED_CANDIDATES).map((entry) => entry.candidate);

  const ambiguous =
    runnerUp !== undefined && best.scored.score - runnerUp.scored.score <= AMBIGUITY_MARGIN;

  if (ambiguous) {
    return {
      status: 'AMBIGUOUS',
      method: best.scored.method,
      confidence: round(best.scored.score),
      candidate: best.candidate,
      candidates: reported,
      errorMessage: null,
    };
  }

  if (best.scored.score >= MATCH_THRESHOLD) {
    return {
      status: 'MATCHED',
      method: best.scored.method,
      confidence: round(best.scored.score),
      candidate: best.candidate,
      candidates: reported,
      errorMessage: null,
    };
  }

  return {
    status: 'AMBIGUOUS',
    method: best.scored.method,
    confidence: round(best.scored.score),
    candidate: best.candidate,
    candidates: reported,
    errorMessage: null,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Documento local con las pistas de matching (issuer/receiver resueltos). */
export async function loadMatchableDocument(
  db: Kysely<Database>,
  companyId: string,
  documentId: string,
): Promise<MatchableDocument | null> {
  const row = await db
    .selectFrom('documents as d')
    .leftJoin('third_parties as issuer', 'issuer.id', 'd.issuer_id')
    .leftJoin('third_parties as receiver', 'receiver.id', 'd.receiver_id')
    .leftJoin('companies as c', 'c.id', 'd.company_id')
    .select([
      'd.id as id',
      'd.company_id as company_id',
      'd.external_uid as external_uid',
      'd.prefix as prefix',
      'd.folio as folio',
      'd.issued_at as issued_at',
      'd.total as total',
      'd.direction as direction',
      'issuer.tax_id as issuer_tax_id',
      'receiver.tax_id as receiver_tax_id',
      'c.nit as company_nit',
    ])
    .where('d.company_id', '=', companyId)
    .where('d.id', '=', documentId)
    .executeTakeFirst();

  if (!row) return null;

  const counterparty =
    row.direction === 'RECEIVED' ? (row.issuer_tax_id ?? null) : (row.receiver_tax_id ?? null);

  return {
    id: row.id,
    company_id: row.company_id,
    external_uid: row.external_uid,
    prefix: row.prefix,
    folio: row.folio,
    issued_at: row.issued_at,
    total: row.total,
    direction: row.direction,
    counterparty_tax_id: counterparty,
    company_tax_id: row.company_nit ?? null,
  };
}

export interface PersistMatchInput {
  companyId: string;
  documentId: string;
  companyIntegrationId: string;
  outcome: MatchOutcome;
  /** `true` en dry-run: no escribe, solo devuelve lo que se escribiría. */
  dryRun?: boolean;
}

/** Upsert del resultado en `document_integration_matches`. */
export async function persistMatch(
  db: Kysely<Database>,
  input: PersistMatchInput,
): Promise<{ status: MatchStatus; written: boolean }> {
  const now = new Date();
  const candidate = input.outcome.candidate;
  const values = {
    company_id: input.companyId,
    document_id: input.documentId,
    company_integration_id: input.companyIntegrationId,
    external_id: candidate?.externalId ?? null,
    external_document_type: candidate?.externalDocumentType ?? null,
    external_number: candidate?.externalNumber ?? null,
    match_status: input.outcome.status,
    match_method: input.outcome.method,
    confidence: input.outcome.confidence,
    matched_at: input.outcome.status === 'MATCHED' ? now : null,
    last_checked_at: now,
    external_payload: (candidate ? candidate.payload : null) as Json | null,
    error_message: input.outcome.errorMessage,
  };

  if (input.dryRun) return { status: input.outcome.status, written: false };

  await db
    .insertInto('document_integration_matches')
    .values(values)
    .onConflict((oc) =>
      oc.columns(['company_integration_id', 'document_id']).doUpdateSet({
        external_id: values.external_id,
        external_document_type: values.external_document_type,
        external_number: values.external_number,
        match_status: values.match_status,
        match_method: values.match_method,
        confidence: values.confidence,
        matched_at: values.matched_at,
        last_checked_at: values.last_checked_at,
        external_payload: values.external_payload,
        error_message: values.error_message,
      }),
    )
    .execute();

  return { status: input.outcome.status, written: true };
}

export interface RecheckOptions {
  provider?: string;
  limit?: number;
  windowDays?: number;
  dryRun?: boolean;
}

export interface RecheckSummary {
  checked: number;
  NOT_CHECKED: number;
  MATCHED: number;
  NOT_FOUND: number;
  AMBIGUOUS: number;
  ERROR: number;
  skipped: string | null;
}

/**
 * Revisa un lote de documentos contra la integración indicada (o contra todas
 * las habilitadas si no se especifica provider).
 *
 * Nunca borra matches previos: un error de ERP conserva lo que ya se sabía.
 */
export async function recheckMatches(
  db: Kysely<Database>,
  companyId: string,
  resolveIntegration: (provider: string) => Promise<ResolvedClient>,
  options: RecheckOptions = {},
): Promise<RecheckSummary> {
  const limit = options.limit ?? 100;
  const summary: RecheckSummary = {
    checked: 0,
    NOT_CHECKED: 0,
    MATCHED: 0,
    NOT_FOUND: 0,
    AMBIGUOUS: 0,
    ERROR: 0,
    skipped: null,
  };

  const integrations = await listEnabledIntegrations(db, companyId, options.provider);
  if (integrations.length === 0) {
    summary.skipped = options.provider
      ? `Sin integración habilitada para ${options.provider}`
      : 'Sin integraciones habilitadas';
    return summary;
  }

  const documents = await db
    .selectFrom('documents')
    .select(['id'])
    .where('company_id', '=', companyId)
    .where('is_active', '=', true)
    .orderBy('issued_at', 'desc')
    .limit(limit)
    .execute();

  for (const integration of integrations) {
    let resolved: ResolvedClient;
    try {
      resolved = await resolveIntegration(integration.provider);
    } catch (error) {
      summary.skipped = error instanceof Error ? error.message.slice(0, 300) : String(error);
      continue;
    }

    for (const document of documents) {
      const doc = await loadMatchableDocument(db, companyId, document.id);
      if (!doc) continue;
      const outcome = await matchDocument(resolved, doc, { windowDays: options.windowDays });
      // Throttle para respetar límite de tasa de Siigo (100 req/min)
      await new Promise((r) => setTimeout(r, 120));
      await persistMatch(db, {
        companyId,
        documentId: document.id,
        companyIntegrationId: integration.id,
        outcome,
        dryRun: options.dryRun,
      });
      summary.checked += 1;
      summary[outcome.status] += 1;
    }
  }

  return summary;
}

async function listEnabledIntegrations(
  db: Kysely<Database>,
  companyId: string,
  provider?: string,
): Promise<Array<{ id: string; provider: string }>> {
  let query = db
    .selectFrom('company_integrations as ci')
    .innerJoin('integration_providers as ip', 'ip.id', 'ci.provider_id')
    .select(['ci.id as id', 'ip.code as provider'])
    .where('ci.company_id', '=', companyId)
    .where('ci.enabled', '=', true)
    .where('ci.status', '!=', 'DISABLED');
  if (provider) query = query.where('ip.code', '=', provider);
  return query.execute();
}
