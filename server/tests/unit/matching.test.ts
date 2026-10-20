import { describe, expect, it } from 'vitest';
import type { AnyIntegrationAdapter, ExternalDocumentCandidate } from '../../src/integrations/adapter.js';
import type { ResolvedClient } from '../../src/integrations/manager.js';
import {
  buildLookupQuery,
  matchDocument,
  scoreCandidate,
  type MatchableDocument,
} from '../../src/integrations/matching.js';

const DOC: MatchableDocument = {
  id: 'doc-1',
  company_id: 'company-1',
  external_uid: '8E1B3B0A-CUFE-4E2D-9F0A-111111111111',
  prefix: 'FE',
  folio: '123',
  issued_at: '2026-08-15T00:00:00.000Z',
  total: 119000,
  direction: 'ISSUED',
  counterparty_tax_id: '900123456',
  company_tax_id: '900999888',
};

function resolvedWith(search: () => Promise<ExternalDocumentCandidate[]>): ResolvedClient {
  const adapter = { searchDocuments: () => search() } as unknown as AnyIntegrationAdapter;
  return {
    integration: { id: 'int-1' } as ResolvedClient['integration'],
    adapter,
    client: {},
    settings: {},
  };
}

function candidate(overrides: Partial<ExternalDocumentCandidate>): ExternalDocumentCandidate {
  return { externalId: 'ext-1', payload: {}, ...overrides };
}

describe('buildLookupQuery', () => {
  it('usa el external_uid como CUFE solo si no es un fallback sintético', () => {
    expect(buildLookupQuery(DOC).cufe).toBe(DOC.external_uid);
    expect(
      buildLookupQuery({ ...DOC, external_uid: 'FALLBACK:FE-123' }).cufe,
    ).toBeNull();
  });

  it('normaliza el NIT de la contraparte', () => {
    expect(buildLookupQuery({ ...DOC, counterparty_tax_id: '900.123.456-7' }).thirdPartyTaxId).toBe('9001234567');
  });
});

describe('scoreCandidate', () => {
  it('CUFE idéntico (ignorando mayúsculas) = 1.0', () => {
    const scored = scoreCandidate(candidate({ cufe: DOC.external_uid.toLowerCase() }), DOC);
    expect(scored).toEqual({ score: 1, method: 'CUFE' });
  });

  it('solo NIT = 0.4: por debajo del umbral, nunca un match', () => {
    const scored = scoreCandidate(candidate({ thirdPartyTaxId: '900123456' }), DOC);
    expect(scored).toEqual({ score: 0.4, method: 'TAX_ID' });
  });

  it('NIT + prefijo + fecha + total da el puntaje completo', () => {
    const scored = scoreCandidate(
      candidate({
        externalNumber: 'FE-123',
        thirdPartyTaxId: '900123456',
        issueDate: '2026-08-15T18:00:00Z',
        total: 119000.005,
      }),
      DOC,
    );
    expect(scored).toEqual({ score: 1, method: 'NUMBER_THIRD_PARTY_TOTAL_DATE' });
  });

  it('totales que no cuadran aportan 0', () => {
    const scored = scoreCandidate(
      candidate({ externalNumber: 'FE-123', thirdPartyTaxId: '900123456', issueDate: '2026-08-15', total: 500 }),
      DOC,
    );
    expect(scored?.score).toBeCloseTo(0.9, 5);
  });

  it('sin ninguna pista coincidente → null', () => {
    expect(scoreCandidate(candidate({ thirdPartyTaxId: '999999999' }), DOC)).toBeNull();
  });
});

describe('matchDocument', () => {
  it('un error del provider es ERROR, jamás NOT_FOUND', async () => {
    const outcome = await matchDocument(resolvedWith(async () => {
      throw new Error('429 Too Many Requests');
    }), DOC);

    expect(outcome.status).toBe('ERROR');
    expect(outcome.errorMessage).toContain('429');
    expect(outcome.candidate).toBeNull();
    expect(outcome.status).not.toBe('NOT_FOUND');
  });

  it('respuesta vacía sí es NOT_FOUND', async () => {
    const outcome = await matchDocument(resolvedWith(async () => []), DOC);
    expect(outcome.status).toBe('NOT_FOUND');
    expect(outcome.errorMessage).toBeNull();
  });

  it('un único candidato con CUFE correcto es MATCHED', async () => {
    const outcome = await matchDocument(
      resolvedWith(async () => [candidate({ cufe: DOC.external_uid, issueDate: DOC.issued_at, total: DOC.total })]),
      DOC,
    );
    expect(outcome.status).toBe('MATCHED');
    expect(outcome.method).toBe('CUFE');
    expect(outcome.confidence).toBe(1);
  });

  it('coincidencia solo por NIT queda AMBIGUOUS, nunca MATCHED', async () => {
    const outcome = await matchDocument(
      resolvedWith(async () => [
        candidate({ externalId: 'a', thirdPartyTaxId: '900123456' }),
        candidate({ externalId: 'b', thirdPartyTaxId: '900123456' }),
      ]),
      DOC,
    );
    expect(outcome.status).toBe('AMBIGUOUS');
    expect(outcome.confidence).toBeLessThan(0.85);
  });

  it('dos candidatos empatados son AMBIGUOUS (no se elige al azar)', async () => {
    const both = (id: string) =>
      candidate({ externalId: id, cufe: DOC.external_uid, issueDate: DOC.issued_at, total: DOC.total });
    const outcome = await matchDocument(resolvedWith(async () => [both('a'), both('b')]), DOC);
    expect(outcome.status).toBe('AMBIGUOUS');
    expect(outcome.candidates).toHaveLength(2);
  });

  it('el mejor candidato supera al segundo por más del margen → MATCHED', async () => {
    const outcome = await matchDocument(
      resolvedWith(async () => [
        candidate({ externalId: 'fuera', thirdPartyTaxId: '999999999', total: 5 }),
        candidate({
          externalId: 'bueno',
          externalNumber: 'FE-123',
          thirdPartyTaxId: '900123456',
          issueDate: DOC.issued_at,
          total: DOC.total,
        }),
      ]),
      DOC,
    );
    expect(outcome.status).toBe('MATCHED');
    expect(outcome.candidate?.externalId).toBe('bueno');
    expect(outcome.confidence).toBe(1);
  });

  it('candidatos que no aportan ninguna pista se ignoran (NOT_FOUND)', async () => {
    const outcome = await matchDocument(
      resolvedWith(async () => [candidate({ thirdPartyTaxId: '999999999' })]),
      DOC,
    );
    expect(outcome.status).toBe('NOT_FOUND');
  });
});
