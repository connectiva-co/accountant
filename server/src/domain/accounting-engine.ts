import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { TaxEngine } from './tax-engine.js';
import { SettingsService } from '../settings/service.js';

export interface AccountingEntryItem {
  account: {
    code: string;
    movement: 'Debit' | 'Credit';
  };
  customer: {
    identification: string;
    branch_office: number;
  };
  description: string;
  value: number;
  tax?: {
    id: number;
  };
  due?: {
    prefix: string;
    consecutive: number;
    quote: number;
    date: string;
  };
}

export interface JournalBuildResult {
  documentId: string;
  folio: string;
  date: string;
  documentTypeId: number;
  thirdPartyNit: string;
  thirdPartyName: string;
  totalDocument: number;
  baseGravableIva: number;
  baseContableGasto: number;
  ivaAmount: number;
  additionalTaxesAmount: number;
  totalRetenciones: number;
  netoPagar: number;
  items: AccountingEntryItem[];
  processedTaxes: Array<{
    code: string;
    name?: string;
    amount: number;
    treatment: 'ADD_TO_EXPENSE' | 'CUSTOM_ACCOUNT' | 'REQUIRE_REVIEW' | 'VAT';
    account?: string;
  }>;
  warnings: string[];
  blockingErrors: string[];
  isBalanced: boolean;
}

export interface BuildJournalInput {
  companyId: string;
  documentId: string;
  siigoTaxes?: any[];
  userSettings?: any;
}

export class AccountingEngine {
  /**
   * Genera las partidas contables exactas y balanceadas para un documento (Compra/Gasto)
   * respetando:
   * 1. Separación de base gravable IVA vs impuestos adicionales vs base contable.
   * 2. Tratamiento de impuestos adicionales: Mayor valor del gasto vs Cuenta independiente vs Requerir revisión.
   * 3. Jerarquía de cuentas contables: Factura -> Tercero -> Global Empresa -> Fallback seguro.
   * 4. Idempotencia y validación de balance contable Débitos == Créditos.
   */
  static async buildPurchaseJournal(
    db: Kysely<Database>,
    input: BuildJournalInput,
  ): Promise<JournalBuildResult> {
    const { companyId, documentId, siigoTaxes = [] } = input;
    const warnings: string[] = [];
    const blockingErrors: string[] = [];

    // 1. Cargar documento con terceros
    const doc = await db
      .selectFrom('documents')
      .leftJoin('third_parties as issuer', 'issuer.id', 'documents.issuer_id')
      .leftJoin('third_parties as receiver', 'receiver.id', 'documents.receiver_id')
      .selectAll('documents')
      .select([
        'issuer.tax_id as issuer_nit',
        'issuer.legal_name as issuer_name',
        'receiver.tax_id as receiver_nit',
        'receiver.legal_name as receiver_name',
      ])
      .where('documents.id', '=', documentId)
      .where('documents.company_id', '=', companyId)
      .executeTakeFirst();

    if (!doc) {
      throw new Error(`Documento ${documentId} no encontrado.`);
    }

    const thirdPartyId = doc.issuer_id;
    const thirdPartyName = doc.issuer_name || 'Proveedor';
    if (!doc.issuer_nit) {
      blockingErrors.push(`El tercero emisor de la factura no tiene NIT.`);
    }
    const thirdPartyNit = doc.issuer_nit || '';

    // 2. Cargar configuración global de bulk_processing / settings
    const settingsService = new SettingsService(db);
    const globalSettings = await settingsService.loadMap(companyId);

    const validateThirdParties = (globalSettings.get('bulk_processing.validate_third_parties') as boolean) ?? true;
    const unconfiguredTreatment = (globalSettings.get('bulk_processing.unconfigured_taxes_treatment') as string) ?? 'REQUIRE_REVIEW';
    const taxTreatmentRules = (globalSettings.get('bulk_processing.tax_treatment_rules') as Record<string, any>) ?? {
      INC: { treatment: 'ADD_TO_EXPENSE', account: null },
      IBUA: { treatment: 'ADD_TO_EXPENSE', account: null },
      INC_BOLSAS: { treatment: 'ADD_TO_EXPENSE', account: null },
    };

    const defaultGlobalExpense = (globalSettings.get('bulk_processing.default_expense_account') as string) || null;
    const defaultGlobalPayable = (globalSettings.get('bulk_processing.default_payable_account') as string) || '22050501';
    const defaultGlobalIva = (globalSettings.get('bulk_processing.default_iva_account') as string) || '24081501';
    const defaultGlobalVoucher = (globalSettings.get('bulk_processing.default_purchase_voucher_type_id') as number) || 43000;

    // 3. Perfil RUT del tercero
    const tpProfile = thirdPartyId
      ? await db
          .selectFrom('third_party_tax_profiles')
          .selectAll()
          .where('company_id', '=', companyId)
          .where('third_party_id', '=', thirdPartyId)
          .orderBy('valid_from', 'desc')
          .executeTakeFirst()
      : null;

    if (validateThirdParties && !tpProfile) {
      blockingErrors.push(`El tercero ${thirdPartyName} (${thirdPartyNit || 'Sin NIT'}) no tiene perfil RUT configurado.`);
    }

    // 4. Determinar Cuentas Contables Clave
    // Prioridad: Factura -> Perfil Tercero -> Global Empresa -> Fallback
    const expenseAccount = doc.expense_account || tpProfile?.expense_account || defaultGlobalExpense;
    if (!expenseAccount) {
      blockingErrors.push(`No se ha configurado la Cuenta Contable de Gasto/Costo para esta factura ni para el tercero.`);
    }

    const payableAccount = (doc as any).payable_account || tpProfile?.payable_account || defaultGlobalPayable;
    const vatAccount = doc.iva_account || tpProfile?.iva_account || defaultGlobalIva;

    // 5. Determinar Tipo de Comprobante
    let documentTypeId = doc.siigo_voucher_type_id || tpProfile?.document_type_id || defaultGlobalVoucher;

    // 6. Consultar impuestos reportados en RADIAN (document_taxes)
    const reportedTaxes = await db
      .selectFrom('document_taxes as dt')
      .innerJoin('tax_types as tt', 'tt.id', 'dt.tax_type_id')
      .select(['dt.amount', 'dt.taxable_base', 'dt.rate', 'tt.code as tax_code', 'tt.name as tax_name'])
      .where('dt.document_id', '=', documentId)
      .execute();

    const ivaTax = reportedTaxes.find((t) => t.tax_code === '01' || t.tax_code === 'IVA');
    const ivaAmount = ivaTax ? Number(ivaTax.amount) : 0;
    const baseGravableIva = ivaTax?.taxable_base ? Number(ivaTax.taxable_base) : (doc.total ? Number(doc.total) - ivaAmount : 0);

    const additionalTaxes = reportedTaxes.filter((t) => t.tax_code !== '01' && t.tax_code !== 'IVA' && !t.tax_code.includes('RETE'));

    // 7. Asegurar y cargar determinaciones de retenciones
    let determinations = await db
      .selectFrom('document_tax_determinations as d')
      .innerJoin('tax_types as tt', 'tt.id', 'd.tax_type_id')
      .selectAll('d')
      .select(['tt.code as tax_type_code', 'tt.name as tax_type_name'])
      .where('d.document_id', '=', documentId)
      .where('d.company_id', '=', companyId)
      .execute();

    if (determinations.length === 0 && thirdPartyId) {
      try {
        await TaxEngine.determine(db, { companyId, documentId });
        determinations = await db
          .selectFrom('document_tax_determinations as d')
          .innerJoin('tax_types as tt', 'tt.id', 'd.tax_type_id')
          .selectAll('d')
          .select(['tt.code as tax_type_code', 'tt.name as tax_type_name'])
          .where('d.document_id', '=', documentId)
          .where('d.company_id', '=', companyId)
          .execute();
      } catch (err: any) {
        warnings.push(`No se pudo ejecutar la determinación automática de retenciones: ${err?.message || err}`);
      }
    }

    const totalDoc = Number(doc.total ?? 0);
    const docDate = doc.issued_at ? String(doc.issued_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const docFolioNum = parseInt(String(doc.folio || '1').replace(/\D/g, ''), 10) || 1;
    const folioStr = doc.prefix ? `${doc.prefix}-${doc.folio}` : (doc.folio || doc.external_uid || documentId);

    const items: AccountingEntryItem[] = [];
    const processedTaxes: JournalBuildResult['processedTaxes'] = [];
    let totalRetenciones = 0;

    // A. Tratamiento de Impuestos Adicionales (INC, IBUA, Bolsas, etc.)
    let additionalTaxesToSeparateAccounts = 0;
    let additionalTaxesAmountTotal = 0;

    for (const addTax of additionalTaxes) {
      const taxCode = addTax.tax_code;
      const amount = Number(addTax.amount);
      if (amount <= 0) continue;

      additionalTaxesAmountTotal += amount;
      const rule = taxTreatmentRules[taxCode];
      const treatment = rule?.treatment || (unconfiguredTreatment === 'ADD_TO_EXPENSE' ? 'ADD_TO_EXPENSE' : unconfiguredTreatment === 'DEFAULT_ACCOUNT' ? 'CUSTOM_ACCOUNT' : 'REQUIRE_REVIEW');

      if (treatment === 'REQUIRE_REVIEW') {
        blockingErrors.push(`El impuesto adicional ${addTax.tax_name || taxCode} ($${amount.toLocaleString('es-CO')}) requiere revisión de parametrización.`);
        processedTaxes.push({ code: taxCode, name: addTax.tax_name, amount, treatment: 'REQUIRE_REVIEW' });
      } else if (treatment === 'CUSTOM_ACCOUNT') {
        const taxAccount = rule?.account;
        if (!taxAccount) {
          blockingErrors.push(`El impuesto ${taxCode} está configurado con cuenta independiente pero no tiene cuenta PUC asignada.`);
        } else {
          items.push({
            account: { code: taxAccount, movement: 'Debit' },
            customer: { identification: thirdPartyNit, branch_office: 0 },
            description: `${addTax.tax_name || taxCode} Factura ${folioStr}`,
            value: amount,
          });
          additionalTaxesToSeparateAccounts += amount;
          processedTaxes.push({ code: taxCode, name: addTax.tax_name, amount, treatment: 'CUSTOM_ACCOUNT', account: taxAccount });
        }
      } else {
        // ADD_TO_EXPENSE: Mayor valor del gasto (queda absorbido en la partida de gasto)
        processedTaxes.push({ code: taxCode, name: addTax.tax_name, amount, treatment: 'ADD_TO_EXPENSE' });
      }
    }

    // B. Base Contable de Gasto
    // totalDoc = BaseGasto + IVA + ImpuestosAdicionales
    // Si los impuestos adicionales van a cuenta independiente, se restan del total junto con el IVA.
    // Si van como mayor valor del gasto, se quedan en la base de gasto.
    const baseContableGasto = totalDoc - ivaAmount - additionalTaxesToSeparateAccounts;

    items.push({
      account: {
        code: expenseAccount || '51959501',
        movement: 'Debit',
      },
      customer: {
        identification: thirdPartyNit,
        branch_office: 0,
      },
      description: `Gasto Factura ${folioStr}`,
      value: Math.round(baseContableGasto * 100) / 100,
    });

    // C. Línea de IVA Descontable
    if (ivaAmount > 0) {
      let matchedIva: any = null;
      if (vatAccount === '24081501') {
        matchedIva = siigoTaxes.find((st) => st.id === 21284) || siigoTaxes.find((st) => st.type === 'IVA' && st.name.toLowerCase().includes('servicio'));
      } else if (vatAccount === '24081003') {
        matchedIva = siigoTaxes.find((st) => st.id === 6500 || (st.type === 'IVA' && Math.abs(st.percentage - 5) < 1));
      } else {
        matchedIva = siigoTaxes.find((st) => st.id === 6499 || (st.type === 'IVA' && Math.abs(st.percentage - 19) < 1 && !st.name.toLowerCase().includes('servicio')));
      }

      const ivaItem: AccountingEntryItem = {
        account: {
          code: vatAccount,
          movement: 'Debit',
        },
        customer: {
          identification: thirdPartyNit,
          branch_office: 0,
        },
        description: `IVA Factura ${folioStr}`,
        value: ivaAmount,
      };

      if (matchedIva) {
        ivaItem.tax = { id: matchedIva.id };
      }
      items.push(ivaItem);
      processedTaxes.push({ code: 'IVA', name: 'IVA Descontable', amount: ivaAmount, treatment: 'VAT', account: vatAccount });
    }

    // D. Líneas de Retenciones
    for (const det of determinations) {
      const amount = Number(det.amount);
      if (amount <= 0) continue;

      let accountCode = (det as any).accounting_account;
      const numRate = Number(det.rate);

      if (!accountCode) {
        if (det.tax_type_code.includes('RENTA')) {
          if (Math.abs(numRate - 0.04) < 0.001) accountCode = '23652503';
          else if (Math.abs(numRate - 0.06) < 0.001) accountCode = '23652501';
          else if (Math.abs(numRate - 0.01) < 0.001) accountCode = '23652505';
          else if (Math.abs(numRate - 0.035) < 0.001) accountCode = '23654004';
          else if (Math.abs(numRate - 0.025) < 0.001) accountCode = '23654001';
          else if (Math.abs(numRate - 0.11) < 0.001 || Math.abs(numRate - 0.10) < 0.001) accountCode = '23651501';
          else accountCode = '23654001';
        } else if (det.tax_type_code.includes('ICA')) {
          if (Math.abs(numRate - 0.00966) < 0.0001) accountCode = '23680505';
          else if (Math.abs(numRate - 0.00866) < 0.0001) accountCode = '23680501';
          else if (Math.abs(numRate - 0.01104) < 0.0001) accountCode = '23680502';
          else accountCode = '23680505';
        } else {
          accountCode = '23654001';
        }
      }

      const ratePercent = Number(det.rate) <= 0.05
        ? Number(det.rate) * 1000
        : Number(det.rate) <= 1
        ? Number(det.rate) * 100
        : Number(det.rate);

      const matchedTax = siigoTaxes.find((st) => {
        if (det.tax_type_code.includes('ICA')) {
          return st.type === 'ReteICA' && (
            Math.abs(st.percentage - ratePercent) < 0.1 ||
            Math.abs(st.percentage - Number(det.rate) * 1000) < 0.1 ||
            Math.abs(st.percentage - Number(det.rate) * 100) < 0.1
          );
        }
        if (det.tax_type_code.includes('RENTA')) {
          if (accountCode.startsWith('236530')) return st.id === 21285;
          return st.type === 'Retefuente' && (
            Math.abs(st.percentage - (Number(det.rate) <= 1 ? Number(det.rate) * 100 : Number(det.rate))) < 0.1
          );
        }
        if (det.tax_type_code.includes('IVA')) {
          return st.type === 'ReteIVA' && Math.abs(st.percentage - (Number(det.rate) <= 1 ? Number(det.rate) * 100 : Number(det.rate))) < 0.1;
        }
        return false;
      });

      const retItem: AccountingEntryItem = {
        account: {
          code: accountCode,
          movement: 'Credit',
        },
        customer: {
          identification: thirdPartyNit,
          branch_office: 0,
        },
        description: `Retención ${det.tax_type_name} Factura ${folioStr}`,
        value: amount,
      };

      const isGenericTaxAccount =
        accountCode === '23657003' ||
        accountCode === '23659901' ||
        accountCode === '23657501' ||
        accountCode.endsWith('09') ||
        accountCode.endsWith('99');

      if (matchedTax && !isGenericTaxAccount) {
        retItem.tax = { id: matchedTax.id };
      }

      items.push(retItem);
      totalRetenciones += amount;
    }

    // E. Cuenta por Pagar Proveedor (Crédito)
    const netoPagar = Math.round((totalDoc - totalRetenciones) * 100) / 100;
    const dueInfo = doc.folio
      ? {
          prefix: doc.prefix || '',
          consecutive: docFolioNum,
          quote: 1,
          date: docDate,
        }
      : undefined;

    items.push({
      account: {
        code: payableAccount,
        movement: 'Credit',
      },
      customer: {
        identification: thirdPartyNit,
        branch_office: 0,
      },
      description: `Neto Factura ${folioStr}`,
      value: netoPagar,
      ...(dueInfo ? { due: dueInfo } : {}),
    });

    // F. Validación estricta de balance: Débitos == Créditos
    const debits = items
      .filter((i) => i.account.movement === 'Debit')
      .reduce((acc, i) => acc + i.value, 0);
    const credits = items
      .filter((i) => i.account.movement === 'Credit')
      .reduce((acc, i) => acc + i.value, 0);

    const diff = Math.abs(debits - credits);
    const isBalanced = diff < 0.05;

    if (!isBalanced) {
      blockingErrors.push(`Asiento contable desbalanceado: Débitos ($${debits}) != Créditos ($${credits}). Diferencia: $${diff}`);
    }

    return {
      documentId,
      folio: folioStr,
      date: docDate,
      documentTypeId,
      thirdPartyNit,
      thirdPartyName,
      totalDocument: totalDoc,
      baseGravableIva,
      baseContableGasto,
      ivaAmount,
      additionalTaxesAmount: additionalTaxesAmountTotal,
      totalRetenciones,
      netoPagar,
      items,
      processedTaxes,
      warnings,
      blockingErrors,
      isBalanced,
    };
  }
}
