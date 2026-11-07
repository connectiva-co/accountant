import { describe, it, expect } from 'vitest';
import { AccountingEngine } from '../../src/domain/accounting-engine.js';

describe('AccountingEngine Unit Tests', () => {
  it('separa base gravable de IVA de impuestos adicionales y balancea débitos y créditos con INC como mayor valor del gasto', async () => {
    // Factura:
    // Base Gasto: 1.000.000
    // IVA (19%): 190.000
    // INC (8%): 80.000
    // Total: 1.270.000
    // Retefuente (4% sobre 1.000.000): 40.000
    // ReteICA (9.66 por mil sobre 1.000.000): 9.660
    // Neto a pagar = 1.270.000 - 49.660 = 1.220.340

    const mockDb: any = {
      selectFrom: (table: string) => {
        const query: any = {
          leftJoin: () => query,
          innerJoin: () => query,
          selectAll: () => query,
          select: () => query,
          where: () => query,
          orderBy: () => query,
          executeTakeFirst: async () => {
            if (table === 'documents') {
              return {
                id: 'doc-1',
                company_id: 'comp-1',
                issuer_id: 'third-1',
                issuer_nit: '900123456',
                issuer_name: 'PROVEEDOR TEST S.A.S',
                folio: '1001',
                prefix: 'FE',
                issued_at: '2026-08-15',
                total: 1270000,
                expense_account: '51959501',
                payable_account: '22050501',
                iva_account: '24081501',
                siigo_voucher_type_id: 43000,
              };
            }
            if (table === 'third_party_tax_profiles') {
              return {
                id: 'prof-1',
                company_id: 'comp-1',
                third_party_id: 'third-1',
                expense_account: '51959501',
                payable_account: '22050501',
                iva_account: '24081501',
                document_type_id: 43000,
              };
            }
            return null;
          },
          execute: async () => {
            if (table === 'settings') {
              return [
                {
                  company_id: 'comp-1',
                  scope: 'bulk_processing',
                  key: 'validate_third_parties',
                  value: true,
                },
                {
                  company_id: 'comp-1',
                  scope: 'bulk_processing',
                  key: 'tax_treatment_rules',
                  value: {
                    INC: { treatment: 'ADD_TO_EXPENSE', account: null },
                  },
                },
              ];
            }
            if (table === 'document_taxes as dt') {
              return [
                { amount: 190000, taxable_base: 1000000, rate: 0.19, tax_code: 'IVA', tax_name: 'IVA 19%' },
                { amount: 80000, taxable_base: 1000000, rate: 0.08, tax_code: 'INC', tax_name: 'INC 8%' },
              ];
            }
            if (table === 'document_tax_determinations as d') {
              return [
                { amount: 40000, rate: 0.04, tax_type_code: 'RENTA_RETE', tax_type_name: 'Retefuente Servicios', accounting_account: '23652501' },
                { amount: 9660, rate: 0.00966, tax_type_code: 'ICA_RETE', tax_type_name: 'ReteICA Servicios', accounting_account: '23680505' },
              ];
            }
            return [];
          },
        };
        return query;
      },
    };

    const result = await AccountingEngine.buildPurchaseJournal(mockDb, {
      companyId: 'comp-1',
      documentId: 'doc-1',
      siigoTaxes: [
        { id: 21284, type: 'IVA', percentage: 19, name: 'IVA Servicios 19%' },
        { id: 21285, type: 'Retefuente', percentage: 4, name: 'RteFte Servicios 4%' },
      ],
    });

    expect(result.isBalanced).toBe(true);
    expect(result.blockingErrors).toHaveLength(0);
    expect(result.baseGravableIva).toBe(1000000);
    // Base contable de gasto debe absorber el INC (1.270.000 - 190.000 = 1.080.000)
    expect(result.baseContableGasto).toBe(1080000);
    expect(result.ivaAmount).toBe(190000);
    expect(result.totalRetenciones).toBe(49660);
    expect(result.netoPagar).toBe(1220340);

    const debits = result.items
      .filter((i) => i.account.movement === 'Debit')
      .reduce((a, b) => a + b.value, 0);
    const credits = result.items
      .filter((i) => i.account.movement === 'Credit')
      .reduce((a, b) => a + b.value, 0);

    expect(debits).toBe(1270000);
    expect(credits).toBe(1270000);
    expect(Math.abs(debits - credits)).toBeLessThan(0.01);
  });

  it('contabiliza impuesto adicional en cuenta PUC separada cuando está configurado como CUSTOM_ACCOUNT', async () => {
    const mockDb: any = {
      selectFrom: (table: string) => {
        const query: any = {
          leftJoin: () => query,
          innerJoin: () => query,
          selectAll: () => query,
          select: () => query,
          where: () => query,
          orderBy: () => query,
          executeTakeFirst: async () => {
            if (table === 'documents') {
              return {
                id: 'doc-2',
                company_id: 'comp-1',
                issuer_id: 'third-1',
                issuer_nit: '900123456',
                issuer_name: 'PROVEEDOR TEST S.A.S',
                folio: '1002',
                prefix: 'FE',
                issued_at: '2026-08-15',
                total: 1270000,
                expense_account: '51959501',
                payable_account: '22050501',
                iva_account: '24081501',
                siigo_voucher_type_id: 43000,
              };
            }
            if (table === 'third_party_tax_profiles') {
              return {
                id: 'prof-1',
                company_id: 'comp-1',
                third_party_id: 'third-1',
                expense_account: '51959501',
                payable_account: '22050501',
                iva_account: '24081501',
              };
            }
            return null;
          },
          execute: async () => {
            if (table === 'settings') {
              return [
                {
                  company_id: 'comp-1',
                  scope: 'bulk_processing',
                  key: 'validate_third_parties',
                  value: true,
                },
                {
                  company_id: 'comp-1',
                  scope: 'bulk_processing',
                  key: 'tax_treatment_rules',
                  value: {
                    INC: { treatment: 'CUSTOM_ACCOUNT', account: '51159501' },
                  },
                },
              ];
            }
            if (table === 'document_taxes as dt') {
              return [
                { amount: 190000, taxable_base: 1000000, rate: 0.19, tax_code: 'IVA', tax_name: 'IVA 19%' },
                { amount: 80000, taxable_base: 1000000, rate: 0.08, tax_code: 'INC', tax_name: 'INC 8%' },
              ];
            }
            if (table === 'document_tax_determinations as d') {
              return [];
            }
            return [];
          },
        };
        return query;
      },
    };

    const result = await AccountingEngine.buildPurchaseJournal(mockDb, {
      companyId: 'comp-1',
      documentId: 'doc-2',
    });

    expect(result.isBalanced).toBe(true);
    // Gasto general queda en 1.000.000 (total 1.270.000 - 190.000 IVA - 80.000 INC cuenta separada)
    expect(result.baseContableGasto).toBe(1000000);
    const incItem = result.items.find((i) => i.account.code === '51159501');
    expect(incItem).toBeDefined();
    expect(incItem?.value).toBe(80000);
    expect(incItem?.account.movement).toBe('Debit');
  });

  it('bloquea el asiento contable con REQUIRE_REVIEW cuando un impuesto adicional no está parametrizado', async () => {
    const mockDb: any = {
      selectFrom: (table: string) => {
        const query: any = {
          leftJoin: () => query,
          innerJoin: () => query,
          selectAll: () => query,
          select: () => query,
          where: () => query,
          orderBy: () => query,
          executeTakeFirst: async () => {
            if (table === 'documents') {
              return {
                id: 'doc-3',
                company_id: 'comp-1',
                issuer_id: 'third-1',
                issuer_nit: '900123456',
                issuer_name: 'PROVEEDOR TEST S.A.S',
                folio: '1003',
                issued_at: '2026-08-15',
                total: 1050000,
                expense_account: '51959501',
                payable_account: '22050501',
              };
            }
            if (table === 'third_party_tax_profiles') {
              return {
                id: 'prof-1',
                company_id: 'comp-1',
                third_party_id: 'third-1',
              };
            }
            return null;
          },
          execute: async () => {
            if (table === 'settings') {
              return [
                {
                  company_id: 'comp-1',
                  scope: 'bulk_processing',
                  key: 'unconfigured_taxes_treatment',
                  value: 'REQUIRE_REVIEW',
                },
                {
                  company_id: 'comp-1',
                  scope: 'bulk_processing',
                  key: 'tax_treatment_rules',
                  value: {},
                },
              ];
            }
            if (table === 'document_taxes as dt') {
              return [
                { amount: 50000, taxable_base: 1000000, rate: 0.05, tax_code: 'IBUA', tax_name: 'Bebidas Azucaradas' },
              ];
            }
            if (table === 'document_tax_determinations as d') {
              return [];
            }
            return [];
          },
        };
        return query;
      },
    };

    const result = await AccountingEngine.buildPurchaseJournal(mockDb, {
      companyId: 'comp-1',
      documentId: 'doc-3',
    });

    expect(result.blockingErrors.length).toBeGreaterThan(0);
    expect(result.blockingErrors[0]).toContain('requiere revisión de parametrización');
  });

  it('respeta la prioridad de cuenta por pagar: Factura -> Tercero -> Global Empresa -> 22050501', async () => {
    const mockDb: any = {
      selectFrom: (table: string) => {
        const query: any = {
          leftJoin: () => query,
          innerJoin: () => query,
          selectAll: () => query,
          select: () => query,
          where: () => query,
          orderBy: () => query,
          executeTakeFirst: async () => {
            if (table === 'documents') {
              return {
                id: 'doc-4',
                company_id: 'comp-1',
                issuer_id: 'third-1',
                issuer_nit: '900123456',
                issuer_name: 'PROVEEDOR TEST S.A.S',
                folio: '1004',
                issued_at: '2026-08-15',
                total: 500000,
                expense_account: '51959501',
                payable_account: '22050599', // Asignada en factura
              };
            }
            if (table === 'third_party_tax_profiles') {
              return {
                id: 'prof-1',
                payable_account: '22050502', // Asignada en tercero
              };
            }
            return null;
          },
          execute: async () => {
            if (table === 'settings') return [];
            if (table === 'document_taxes as dt') return [];
            if (table === 'document_tax_determinations as d') return [];
            return [];
          },
        };
        return query;
      },
    };

    const result = await AccountingEngine.buildPurchaseJournal(mockDb, {
      companyId: 'comp-1',
      documentId: 'doc-4',
    });

    const payableItem = result.items.find((i) => i.account.movement === 'Credit');
    expect(payableItem?.account.code).toBe('22050599');
  });
});
