import { getDb } from '../db/connection.js';
import { IntegrationManager } from '../integrations/manager.js';
import { TaxEngine } from '../domain/tax-engine.js';
import { sql } from 'kysely';

interface Options {
  companyNit: string;
  dryRun: boolean;
  limit?: number;
}

export async function runBulkSync(options: Options) {
  const db = getDb();
  const masterKey = process.env.SECRETS_MASTER_KEY || 'z+R8bvqHC1MQiVQSV7QmSlq1cUt+GFNDYtf7dC6y8aQ=';

  // 1. Resolver empresa
  const company = await db
    .selectFrom('companies')
    .selectAll()
    .where('nit', '=', options.companyNit)
    .executeTakeFirst();

  if (!company) {
    console.error(`Empresa con NIT ${options.companyNit} no encontrada.`);
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`EMPRESA: ${company.legal_name} (NIT: ${company.nit})`);
  console.log(`MODO: ${options.dryRun ? 'DRY RUN (Solo simulación, no sube nada)' : 'EJECUCIÓN REAL (Sube a Siigo)'}`);
  console.log(`======================================================\n`);

  // 2. Integración Siigo
  const integrations = new IntegrationManager(db as any, { masterKey });
  const resolved = await integrations.getClient(company.id, 'SIIGO');
  const siigoClient = resolved.client as any;

  // Catálogo impuestos Siigo
  let siigoTaxes: any[] = [];
  try {
    siigoTaxes = await siigoClient.catalogs.taxes();
  } catch (err: any) {
    console.warn('No se pudo obtener catalogo de impuestos de Siigo:', err.message);
  }

  // 3. Buscar facturas de compras (RECEIVED) de terceros con Perfil RUT que tengan expense_account
  // y que NO hayan sido sincronizadas a Siigo todavía (sin match MATCHED)
  const query = db
    .selectFrom('documents as d')
    .innerJoin('third_parties as issuer', 'issuer.id', 'd.issuer_id')
    .innerJoin('third_party_tax_profiles as tp', 'tp.third_party_id', 'd.issuer_id')
    .leftJoin('document_integration_matches as dim', (join) =>
      join
        .onRef('dim.document_id', '=', 'd.id')
        .on('dim.match_status', '=', 'MATCHED')
    )
    .select([
      'd.id',
      'd.prefix',
      'd.folio',
      'd.issued_at',
      'd.total',
      'issuer.tax_id as issuer_nit',
      'issuer.legal_name as issuer_name',
      'd.expense_account as doc_expense_account',
      'd.iva_account as doc_iva_account',
      'd.siigo_voucher_type_id',
      'tp.expense_account as tp_expense_account',
      'tp.payable_account as tp_payable_account',
      'tp.iva_account as tp_iva_account',
      'tp.document_type_id as tp_document_type_id',
      'tp.default_renta_concept_id',
      'tp.default_ica_concept_id',
    ])
    .where('d.company_id', '=', company.id)
    .where('d.direction', '=', 'RECEIVED')
    .where('dim.id', 'is', null) // No sincronizada
    .where((eb) =>
      eb.or([
        eb('d.expense_account', 'is not', null),
        eb('tp.expense_account', 'is not', null),
      ])
    )
    .orderBy('d.issued_at', 'asc');

  const candidates = options.limit ? await query.limit(options.limit).execute() : await query.execute();

  console.log(`Total facturas encontradas con Perfil RUT y cuenta de gasto: ${candidates.length}\n`);

  if (candidates.length === 0) {
    console.log('No hay facturas pendientes para sincronizar con los criterios dados.');
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const doc = candidates[i];
    const folioStr = doc.prefix ? `${doc.prefix}-${doc.folio}` : (doc.folio || doc.id);
    const docDate = doc.issued_at ? String(doc.issued_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const docPrefix = doc.prefix || 'FE';
    const docFolioNum = parseInt(String(doc.folio || '1').replace(/\D/g, ''), 10) || 1;
    const totalDoc = Number(doc.total ?? 0);
    const expenseAccount = doc.doc_expense_account || doc.tp_expense_account;
    const payableAccount = doc.tp_payable_account || '22050501';

    console.log(`[${i + 1}/${candidates.length}] Procesando ${folioStr} | Proveedor: ${doc.issuer_name} (${doc.issuer_nit}) | Total: $${totalDoc.toLocaleString('es-CO')}`);

    try {
      // Liquidar / Asegurar determinaciones tributarias
      let determinations = await db
        .selectFrom('document_tax_determinations as d')
        .innerJoin('tax_types as tt', 'tt.id', 'd.tax_type_id')
        .selectAll('d')
        .select(['tt.code as tax_type_code', 'tt.name as tax_type_name'])
        .where('d.document_id', '=', doc.id)
        .where('d.company_id', '=', company.id)
        .execute();

      if (determinations.length === 0) {
        // Calcular con motor
        await TaxEngine.determine(db, {
          companyId: company.id,
          documentId: doc.id,
        });

        determinations = await db
          .selectFrom('document_tax_determinations as d')
          .innerJoin('tax_types as tt', 'tt.id', 'd.tax_type_id')
          .selectAll('d')
          .select(['tt.code as tax_type_code', 'tt.name as tax_type_name'])
          .where('d.document_id', '=', doc.id)
          .where('d.company_id', '=', company.id)
          .execute();
      }

      // IVA
      const docTaxes = await db
        .selectFrom('document_taxes as dt')
        .innerJoin('tax_types as tt', 'tt.id', 'dt.tax_type_id')
        .select(['dt.amount', 'tt.code as tax_code'])
        .where('dt.document_id', '=', doc.id)
        .execute();

      const ivaTax = docTaxes.find((t) => t.tax_code === '01' || t.tax_code === 'IVA');
      const ivaAmount = ivaTax ? Number(ivaTax.amount) : 0;
      const baseGasto = totalDoc - ivaAmount;

      const items: any[] = [];
      let totalRetenciones = 0;

      // Líneas de retenciones
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

        const retItem: any = {
          account: { code: accountCode, movement: 'Credit' },
          customer: { identification: doc.issuer_nit, branch_office: 0 },
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

      // Gasto
      items.push({
        account: { code: expenseAccount, movement: 'Debit' },
        customer: { identification: doc.issuer_nit, branch_office: 0 },
        description: `Gasto Factura ${folioStr}`,
        value: baseGasto,
      });

      // IVA
      if (ivaAmount > 0) {
        const vatAccount = doc.doc_iva_account || doc.tp_iva_account || '24081501';
        let matchedIva: any = null;
        if (vatAccount === '24081501') {
          matchedIva = siigoTaxes.find((st) => st.id === 21284);
        } else if (vatAccount === '24081003') {
          matchedIva = siigoTaxes.find((st) => st.id === 6500);
        } else {
          matchedIva = siigoTaxes.find((st) => st.id === 6499);
        }

        const ivaItem: any = {
          account: { code: vatAccount, movement: 'Debit' },
          customer: { identification: doc.issuer_nit, branch_office: 0 },
          description: `IVA Factura ${folioStr}`,
          value: ivaAmount,
        };
        if (matchedIva) ivaItem.tax = { id: matchedIva.id };
        items.push(ivaItem);
      }

      // Neto proveedor
      const netoPagar = totalDoc - totalRetenciones;
      items.push({
        account: { code: payableAccount, movement: 'Credit' },
        customer: { identification: doc.issuer_nit, branch_office: 0 },
        description: `Neto Factura ${folioStr}`,
        value: netoPagar,
        due: {
          prefix: docPrefix,
          consecutive: docFolioNum,
          quote: 1,
          date: docDate,
        },
      });

      const voucherTypeId = doc.siigo_voucher_type_id || doc.tp_document_type_id || 43000;

      if (options.dryRun) {
        console.log(`  -> [DRY RUN OK] Comprobante tipo CC-${voucherTypeId} listo: Gasto $${baseGasto}, IVA $${ivaAmount}, Retenciones $${totalRetenciones}, Neto $${netoPagar}`);
        successCount++;
        continue;
      }

      // Subir a Siigo
      let journal: any;
      try {
        journal = await siigoClient.journals.create({
          document: { id: voucherTypeId },
          date: docDate,
          items,
          observations: `Contabilizado desde Accountant (Lote Masivo) · Factura DIAN ${folioStr}`,
        });
      } catch (firstErr: any) {
        const rawErrors = firstErr?.rawBody?.Errors || firstErr?.errors || [];
        const rejectedItemIndices = new Set<number>();
        for (const errItem of rawErrors) {
          if (errItem.Code === 'account_settings' || errItem.Code === 'tax_settings') {
            for (const param of errItem.Params || []) {
              const match = param.match(/^items\[(\d+)\]/);
              if (match) rejectedItemIndices.add(Number(match[1]));
            }
          }
        }

        if (rejectedItemIndices.size > 0) {
          for (const idx of rejectedItemIndices) {
            if (items[idx]?.tax) delete items[idx].tax;
          }
          journal = await siigoClient.journals.create({
            document: { id: voucherTypeId },
            date: docDate,
            items,
            observations: `Contabilizado desde Accountant (Lote Masivo) · Factura DIAN ${folioStr}`,
          });
        } else {
          throw firstErr;
        }
      }

      // Registrar match
      const journalId = journal.id || String(journal.number || Date.now());
      const extId = `SIIGO:JOURNAL:${journalId}`;
      await db
        .insertInto('document_integration_matches')
        .values({
          company_id: company.id,
          document_id: doc.id,
          company_integration_id: resolved.id,
          external_id: extId,
          external_number: journal.number ? String(journal.number) : extId,
          external_document_type: 'Journal',
          match_status: 'MATCHED',
          confidence: 1.0,
          last_checked_at: new Date(),
          matched_at: new Date(),
          external_payload: journal,
        })
        .onConflict((oc) =>
          oc.columns(['company_integration_id', 'document_id']).doUpdateSet({
            external_id: extId,
            external_number: journal.number ? String(journal.number) : extId,
            external_document_type: 'Journal',
            match_status: 'MATCHED',
            confidence: 1.0,
            last_checked_at: new Date(),
            matched_at: new Date(),
            external_payload: journal,
          })
        )
        .execute();

      console.log(`  -> [SYNC EXITOSO] Comprobante Siigo No. ${journal.number ?? journalId}`);
      successCount++;
    } catch (err: any) {
      console.error(`  -> [ERROR] No se pudo procesar ${folioStr}:`, err?.message || err);
      errorCount++;
    }
  }

  console.log(`\n======================================================`);
  console.log(`RESUMEN SINCRONIZACIÓN MASIVA`);
  console.log(`Total elegibles: ${candidates.length}`);
  console.log(`Exitosos: ${successCount}`);
  console.log(`Fallidos: ${errorCount}`);
  console.log(`======================================================\n`);
}

// Ejecución directa CLI
if (process.argv[1]?.endsWith('bulk-sync-siigo.ts')) {
  const args = process.argv.slice(2);
  const companyNit = args.find((a) => !a.startsWith('--')) || '900555053';
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  runBulkSync({ companyNit, dryRun, limit })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error fatal:', err);
      process.exit(1);
    });
}
