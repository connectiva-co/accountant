import * as XLSX from 'xlsx';

export interface AccountingSimulationDocument {
  document_id: string;
  folio?: string;
  date?: string;
  third_party_nit?: string;
  third_party_name?: string;
  total?: number;
  base_gasto?: number;
  iva?: number;
  retenciones?: number;
  neto_pagar?: number;
  voucher_type?: string;
  items?: Array<{
    account: { code: string; movement: 'Debit' | 'Credit' };
    customer: { identification: string; branch_office: number };
    description: string;
    value: number;
    tax?: { id: number };
  }>;
  processed_taxes?: any[];
  warnings?: string[];
  errors?: string[];
  is_valid: boolean;
}

export function exportSimulationToExcel(
  documents: AccountingSimulationDocument[],
  filename = 'SIMULACION_CAUSACION_SIIGO.xlsx'
) {
  const wb = XLSX.utils.book_new();

  // Hoja 1: Resumen por Factura y Tercero
  const resumenRows = documents.map((d) => ({
    'ID Documento': d.document_id,
    'Folio / Prefijo': d.folio || 'N/A',
    'Fecha Factura': d.date || 'N/A',
    'NIT Proveedor': d.third_party_nit || 'N/A',
    'Razón Social': d.third_party_name || 'N/A',
    'Total Factura': d.total ?? 0,
    'Base Gasto': d.base_gasto ?? 0,
    'IVA Descontable': d.iva ?? 0,
    'Total Retenciones': d.retenciones ?? 0,
    'Neto CxP': d.neto_pagar ?? 0,
    'Tipo Comprobante': d.voucher_type || 'CC-43000',
    'Estado Simulación': d.is_valid ? 'VÁLIDO' : 'CON ERRORES',
    'Errores': (d.errors || []).join('; '),
    'Advertencias': (d.warnings || []).join('; '),
  }));

  const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'RESUMEN_FACTURAS');

  // Hoja 2: Asientos Contables Detallados (Movimientos PUC)
  const itemsRows: any[] = [];
  documents.forEach((d) => {
    (d.items || []).forEach((item, idx) => {
      itemsRows.push({
        'Folio Factura': d.folio || 'N/A',
        'NIT Tercero': item.customer?.identification || d.third_party_nit || '',
        'Nombre Tercero': d.third_party_name || '',
        'Línea': idx + 1,
        'Cuenta PUC': item.account.code,
        'Movimiento': item.account.movement,
        'Débito': item.account.movement === 'Debit' ? item.value : 0,
        'Crédito': item.account.movement === 'Credit' ? item.value : 0,
        'Concepto': item.description,
        'ID Impuesto Siigo': item.tax?.id ?? '',
      });
    });
  });

  const wsItems = XLSX.utils.json_to_sheet(itemsRows);
  XLSX.utils.book_append_sheet(wb, wsItems, 'PARTIDAS_CONTABLES');

  XLSX.writeFile(wb, filename);
}

