import * as XLSX from 'xlsx';
import type { RadianRecord, FinancialKPIs } from '../types/radian';

export function enrichRecords(records: any[]): RadianRecord[] {
  return records.map((r) => {
    const total = Number(r['Total']) || 0;
    const iva = Number(r['IVA']) || 0;
    const inc = Number(r['INC']) || 0;
    const ibua = Number(r['IBUA']) || 0;
    const incBolsas = Number(r['INC Bolsas']) || 0;
    const ic = Number(r['IC']) || 0;
    const ica = Number(r['ICA']) || 0;
    const timbre = Number(r['Timbre']) || 0;
    const icui = Number(r['ICUI']) || 0;

    const totalImpuestos = iva + inc + ibua + incBolsas + ic + ica + timbre + icui;
    // Base gravable = Total - Impuestos indirectos
    const baseCalculada = Math.max(0, total - totalImpuestos);

    return {
      ...r,
      Total: total,
      IVA: iva,
      INC: inc,
      IBUA: ibua,
      'INC Bolsas': incBolsas,
      'Rete IVA': Number(r['Rete IVA']) || 0,
      'Rete Renta': Number(r['Rete Renta']) || 0,
      'Rete ICA': Number(r['Rete ICA']) || 0,
      baseCalculada,
      totalImpuestos,
      Grupo: r['Grupo'] || (r['Tipo de documento'] === 'Nomina Individual' ? 'Emitido' : 'Recibido'),
    };
  });
}

export function computeKPIs(records: RadianRecord[]): FinancialKPIs {
  let totalVentasBrutas = 0;
  let totalVentasBase = 0;
  let totalVentasIVA = 0;
  let totalVentasCount = 0;

  let totalComprasBrutas = 0;
  let totalComprasBase = 0;
  let totalComprasIVA = 0;
  let totalComprasCount = 0;

  let totalNotasCreditoEmitidas = 0;
  let totalNotasCreditoRecibidas = 0;

  let totalDocSoporte = 0;
  let totalDocSoporteCount = 0;

  let totalNomina = 0;
  let totalNominaCount = 0;

  let retencionesTotales = 0;

  for (const r of records) {
    const docType = (r['Tipo de documento'] || '').toLowerCase();
    const grupo = (r['Grupo'] || '').toLowerCase();
    const total = r.Total || 0;
    const base = r.baseCalculada || 0;
    const iva = r.IVA || 0;

    retencionesTotales += (r['Rete IVA'] || 0) + (r['Rete Renta'] || 0) + (r['Rete ICA'] || 0);

    if (docType.includes('factura electrónica') || docType.includes('factura')) {
      if (grupo === 'emitido') {
        totalVentasBrutas += total;
        totalVentasBase += base;
        totalVentasIVA += iva;
        totalVentasCount++;
      } else {
        totalComprasBrutas += total;
        totalComprasBase += base;
        totalComprasIVA += iva;
        totalComprasCount++;
      }
    } else if (docType.includes('nota de crédito') || docType.includes('nota credito')) {
      if (grupo === 'emitido') {
        totalNotasCreditoEmitidas += total;
      } else {
        totalNotasCreditoRecibidas += total;
      }
    } else if (docType.includes('soporte') || docType.includes('no obligados')) {
      totalDocSoporte += total;
      totalDocSoporteCount++;
    } else if (docType.includes('nomina')) {
      totalNomina += total;
      totalNominaCount++;
    }
  }

  const ivaPorPagar = totalVentasIVA - totalComprasIVA;

  return {
    totalVentasBrutas,
    totalVentasBase,
    totalVentasIVA,
    totalVentasCount,
    totalComprasBrutas,
    totalComprasBase,
    totalComprasIVA,
    totalComprasCount,
    totalNotasCreditoEmitidas,
    totalNotasCreditoRecibidas,
    totalDocSoporte,
    totalDocSoporteCount,
    totalNomina,
    totalNominaCount,
    ivaPorPagar,
    retencionesTotales,
    totalTransacciones: records.length,
  };
}

export function filterRecords(records: RadianRecord[], category: string): RadianRecord[] {
  switch (category) {
    case 'ventas':
      return records.filter(
        (r) =>
          (r['Tipo de documento'] || '').toLowerCase().includes('factura') &&
          (r['Grupo'] || '').toLowerCase() === 'emitido'
      );
    case 'compras':
      return records.filter(
        (r) =>
          (r['Tipo de documento'] || '').toLowerCase().includes('factura') &&
          (r['Grupo'] || '').toLowerCase() === 'recibido'
      );
    case 'notas_credito':
      return records.filter((r) =>
        (r['Tipo de documento'] || '').toLowerCase().includes('nota de crédito')
      );
    case 'dse':
      return records.filter((r) =>
        (r['Tipo de documento'] || '').toLowerCase().includes('soporte')
      );
    case 'nomina_pos':
      return records.filter(
        (r) =>
          (r['Tipo de documento'] || '').toLowerCase().includes('nomina') ||
          (r['Tipo de documento'] || '').toLowerCase().includes('pos') ||
          (r['Tipo de documento'] || '').toLowerCase().includes('contingencia')
      );
    default:
      return records;
  }
}

export function exportToMultiSheetExcel(records: RadianRecord[], filename = 'RADIAN_CONSOLIDADO_DIAN.xlsx') {
  const wb = XLSX.utils.book_new();

  // 1. Hoja Maestra
  const wsMaster = XLSX.utils.json_to_sheet(records);
  XLSX.utils.book_append_sheet(wb, wsMaster, 'RADIAN_MASTER');

  // 2. Ventas
  const ventas = filterRecords(records, 'ventas');
  const wsVentas = XLSX.utils.json_to_sheet(ventas);
  XLSX.utils.book_append_sheet(wb, wsVentas, 'VENTAS');

  // 3. Compras
  const compras = filterRecords(records, 'compras');
  const wsCompras = XLSX.utils.json_to_sheet(compras);
  XLSX.utils.book_append_sheet(wb, wsCompras, 'COMPRAS');

  // 4. Notas Crédito
  const nc = filterRecords(records, 'notas_credito');
  const wsNC = XLSX.utils.json_to_sheet(nc);
  XLSX.utils.book_append_sheet(wb, wsNC, 'NOTAS_CREDITO');

  // 5. Documentos Soporte (DSE)
  const dse = filterRecords(records, 'dse');
  const wsDSE = XLSX.utils.json_to_sheet(dse);
  XLSX.utils.book_append_sheet(wb, wsDSE, 'DOC_SOPORTE');

  // 6. Nómina & POS
  const nomina = filterRecords(records, 'nomina_pos');
  const wsNomina = XLSX.utils.json_to_sheet(nomina);
  XLSX.utils.book_append_sheet(wb, wsNomina, 'NOMINA_POS');

  XLSX.writeFile(wb, filename);
}
