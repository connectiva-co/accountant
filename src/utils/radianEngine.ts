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
  let totalNotasCreditoCount = 0;
  let ncEmitidasIVA = 0;
  let ncRecibidasIVA = 0;

  let totalDocSoporte = 0;
  let totalDocSoporteCount = 0;

  let totalNomina = 0;
  let totalNominaCount = 0;

  let retencionesTotales = 0;
  let retencionesFuente = 0;
  let retencionesIVA = 0;
  let retencionesICA = 0;

  for (const r of records) {
    const docType = (r['Tipo de documento'] || '').toLowerCase();
    const grupo = (r['Grupo'] || '').toLowerCase();
    const total = r.Total || 0;
    const base = r.baseCalculada || 0;
    const iva = r.IVA || 0;
    const reteFuente = r['Rete Renta'] || 0;
    const reteIVA = r['Rete IVA'] || 0;
    const reteICA = r['Rete ICA'] || 0;

    retencionesFuente += reteFuente;
    retencionesIVA += reteIVA;
    retencionesICA += reteICA;
    retencionesTotales += reteFuente + reteIVA + reteICA;

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
      totalNotasCreditoCount++;
      if (grupo === 'emitido') {
        totalNotasCreditoEmitidas += total;
        ncEmitidasIVA += iva;
      } else {
        totalNotasCreditoRecibidas += total;
        ncRecibidasIVA += iva;
      }
    } else if (docType.includes('soporte') || docType.includes('no obligados')) {
      totalDocSoporte += total;
      totalDocSoporteCount++;
    } else if (docType.includes('nomina')) {
      totalNomina += total;
      totalNominaCount++;
    }
  }

  const ivaGenerado = totalVentasIVA - ncEmitidasIVA;
  const ivaDescontable = totalComprasIVA - ncRecibidasIVA;
  const ivaPorPagar = ivaGenerado - ivaDescontable;

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
    totalNotasCreditoCount,
    ncEmitidasIVA,
    ncRecibidasIVA,
    totalDocSoporte,
    totalDocSoporteCount,
    totalNomina,
    totalNominaCount,
    ivaGenerado,
    ivaDescontable,
    ivaPorPagar,
    retencionesTotales,
    retencionesFuente,
    retencionesIVA,
    retencionesICA,
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

export function exportToMultiSheetExcel(records: RadianRecord[], filename = 'ACCOUNTANT_CONSOLIDADO.xlsx') {
  const wb = XLSX.utils.book_new();

  const wsMaster = XLSX.utils.json_to_sheet(records);
  XLSX.utils.book_append_sheet(wb, wsMaster, 'MAESTRO');

  const ventas = filterRecords(records, 'ventas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ventas), 'VENTAS');

  const compras = filterRecords(records, 'compras');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compras), 'COMPRAS');

  const nc = filterRecords(records, 'notas_credito');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(nc), 'NOTAS_CREDITO');

  const dse = filterRecords(records, 'dse');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dse), 'DOC_SOPORTE');

  const nomina = filterRecords(records, 'nomina_pos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(nomina), 'NOMINA_POS');

  XLSX.writeFile(wb, filename);
}
