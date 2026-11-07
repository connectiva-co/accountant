import { getDb } from '../db/connection.js';
import { IntegrationManager } from '../integrations/manager.js';
import { AccountingEngine } from '../domain/accounting-engine.js';
import * as XLSX from 'xlsx';
import path from 'path';

interface Options {
  companyNit: string;
  dryRun: boolean;
  limit?: number;
  exportExcel?: boolean;
}

export async function runBulkSync(options: Options) {
  const db = getDb();

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
  const integrations = new IntegrationManager(db as any);
  const resolved = await integrations.getClient(company.id, 'SIIGO');
  const siigoClient = resolved.client as any;

  // Catálogo impuestos Siigo
  let siigoTaxes: any[] = [];
  try {
    siigoTaxes = await siigoClient.catalogs.taxes();
  } catch (err: any) {
    console.warn('No se pudo obtener catalogo de impuestos de Siigo:', err.message);
  }

  // Catálogo de conceptos de retención y cuentas contables para el Excel
  const allConcepts = await db.selectFrom('tax_concepts').selectAll().execute();
  const conceptNameMap = new Map(allConcepts.map((c) => [c.id, c.name]));

  const accountingAccounts = await db
    .selectFrom('accounting_accounts')
    .selectAll()
    .where('company_id', '=', company.id)
    .execute();
  const accountNameMap = new Map(accountingAccounts.map((a) => [a.code, a.name]));

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
      'tp.person_type',
      'tp.tax_regime',
      'tp.is_declarant_renta',
      'tp.ica_municipality_code',
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

  // Estructuras para recolectar datos del Excel
  const excelFacturas: any[] = [];
  const mapTerceros = new Map<string, any>();

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const doc = candidates[i];
    const folioStr = doc.prefix ? `${doc.prefix}-${doc.folio}` : (doc.folio || doc.id);
    const docDate = doc.issued_at ? String(doc.issued_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const totalDoc = Number(doc.total ?? 0);
    const expenseAccount = doc.doc_expense_account || doc.tp_expense_account || '';
    const payableAccount = doc.tp_payable_account || '22050501';

    console.log(`[${i + 1}/${candidates.length}] Procesando ${folioStr} | Proveedor: ${doc.issuer_name} (${doc.issuer_nit}) | Total: $${totalDoc.toLocaleString('es-CO')}`);

    try {
      const journalData = await AccountingEngine.buildPurchaseJournal(db, {
        companyId: company.id,
        documentId: doc.id,
        siigoTaxes,
      });

      if (journalData.blockingErrors.length > 0) {
        throw new Error(journalData.blockingErrors.join(' | '));
      }

      const items = journalData.items;
      const voucherTypeId = journalData.documentTypeId;
      const baseGasto = journalData.baseContableGasto;
      const ivaAmount = journalData.ivaAmount;
      const totalRetenciones = journalData.totalRetenciones;
      const netoPagar = journalData.netoPagar;

      // Guardar información para la hoja de Facturas en Excel
      excelFacturas.push({
        'Prefijo': doc.prefix || '',
        'Folio': doc.folio || '',
        'Fecha Emisión': docDate,
        'NIT Proveedor': doc.issuer_nit,
        'Razón Social': doc.issuer_name,
        'Total Factura': totalDoc,
        'Base Gasto': baseGasto,
        'Cuenta Gasto': expenseAccount,
        'Nombre Cuenta Gasto': accountNameMap.get(expenseAccount) || '',
        'IVA': ivaAmount,
        'Impuestos Adicionales': journalData.additionalTaxesAmount,
        'Retenciones': totalRetenciones,
        'Neto a Pagar': netoPagar,
        'Cuenta por Pagar': payableAccount,
        'Tipo Comprobante Siigo': `CC-${voucherTypeId}`,
      });

      // Guardar información única del Tercero para la hoja de Perfil RUT en Excel
      if (!mapTerceros.has(doc.issuer_nit)) {
        mapTerceros.set(doc.issuer_nit, {
          'NIT': doc.issuer_nit,
          'Razón Social': doc.issuer_name,
          'Tipo Persona': doc.person_type,
          'Régimen': doc.tax_regime,
          'Declarante Renta': doc.is_declarant_renta ? 'SÍ' : 'NO',
          'Municipio ICA': doc.ica_municipality_code || '11001',
          'Cuenta Gasto / Costo': doc.tp_expense_account || '',
          'Nombre Cuenta Gasto': accountNameMap.get(doc.tp_expense_account || '') || '',
          'Cuenta por Pagar': doc.tp_payable_account || '22050501',
          'Cuenta IVA Descontable': doc.tp_iva_account || '',
          'Concepto ReteFuente Default': doc.default_renta_concept_id ? conceptNameMap.get(doc.default_renta_concept_id) || doc.default_renta_concept_id : 'Sin concepto',
          'Concepto ReteICA Default': doc.default_ica_concept_id ? conceptNameMap.get(doc.default_ica_concept_id) || doc.default_ica_concept_id : 'Sin concepto',
          'Comprobante Siigo': doc.tp_document_type_id ? `CC-${doc.tp_document_type_id}` : 'Por defecto (CC-16)',
        });
      }

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
      const integrationRow = await db
        .selectFrom('company_integrations')
        .select(['id'])
        .where('company_id', '=', company.id)
        .where('provider_id', '=', (eb) =>
          eb.selectFrom('integration_providers').select('id').where('code', '=', 'SIIGO')
        )
        .executeTakeFirst();

      const chosenIntegrationId = integrationRow?.id || 'default';
      const journalId = journal.id || String(journal.number || Date.now());
      const extId = `SIIGO:JOURNAL:${journalId}`;
      await db
        .insertInto('document_integration_matches')
        .values({
          company_id: company.id,
          document_id: doc.id,
          company_integration_id: chosenIntegrationId,
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

  // Exportar Excel si se solicita o por defecto en dryRun
  if (options.exportExcel || options.dryRun) {
    const wb = XLSX.utils.book_new();

    // Hoja 1: Resumen de Facturas a sincronizar
    const wsFacturas = XLSX.utils.json_to_sheet(excelFacturas);
    XLSX.utils.book_append_sheet(wb, wsFacturas, 'Facturas a Sincronizar');

    // Hoja 2: Terceros y Parametrización RUT
    const wsTerceros = XLSX.utils.json_to_sheet(Array.from(mapTerceros.values()));
    XLSX.utils.book_append_sheet(wb, wsTerceros, 'Terceros Parametrizados');

    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `Simulacion_Sincronizacion_Siigo_${options.companyNit}_${timestamp}.xlsx`;
    const outputPath = path.resolve(process.cwd(), fileName);

    XLSX.writeFile(wb, outputPath);
    console.log(`📊 Reporte Excel generado exitosamente:`);
    console.log(`   ${outputPath}\n`);
  }
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
