import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FinancialKPIs, Period, RadianRecord } from '../types/radian';
import type { CompanyInfo } from '../config/company';
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from './formatters';
import { filterRecords } from './radianEngine';
import {
  attentionItems,
  buildObservations,
  buildSalesPurchasesSeries,
  buildThirdParties,
  qualityReport,
  statusSummary,
  topParties,
} from './derivations';
import { parseRecordDate } from './period';

export interface PdfReportInput {
  /** Documentos del periodo activo */
  records: RadianRecord[];
  /** Todos los documentos de la fuente */
  sourceRecords: RadianRecord[];
  prevRecords: RadianRecord[];
  kpis: FinancialKPIs;
  prevKpis: FinancialKPIs;
  compare: boolean;
  period: Period;
  prevPeriod: Period;
  company: CompanyInfo;
  fileName: string;
}

type RGB = [number, number, number];

const BRAND: RGB = [20, 125, 100];
const INK: RGB = [17, 24, 39];
const TEXT: RGB = [55, 65, 81];
const MUTED: RGB = [102, 112, 133];
const FAINT: RGB = [152, 162, 179];
const LINE: RGB = [229, 231, 235];
const WHITE: RGB = [255, 255, 255];
const SOFT: RGB = [247, 248, 250];

export function generateFullPdfReport(input: PdfReportInput): void {
  const {
    records,
    sourceRecords,
    prevRecords,
    kpis,
    prevKpis,
    compare,
    period,
    prevPeriod,
    company,
    fileName,
  } = input;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const right = pageWidth - margin;
  const bottomLimit = pageHeight - 46;

  let section = 0;
  let y = 0;

  /* ---------------------------------------------------------------- */
  /* Utilidades de layout                                              */
  /* ---------------------------------------------------------------- */

  const ensure = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = 52;
    }
  };

  const sectionTitle = (title: string, subtitle?: string) => {
    const h = 24 + (subtitle ? 12 : 0);
    ensure(h + 34);
    section += 1;
    doc.setFillColor(...BRAND);
    doc.rect(margin, y - 9, 3, 13, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(`${section}. ${title}`, margin + 9, y + 1);
    y += 13;
    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(doc.splitTextToSize(subtitle, right - margin - 9)[0], margin + 9, y + 4);
      y += 11;
    }
    y += 7;
  };

  interface TableOpts {
    stripe?: boolean;
    headColor?: RGB;
    fontSize?: number;
    totalRow?: boolean;
  }

  const table = (
    head: string[],
    body: (string | number)[][],
    opts: TableOpts = {},
    foot?: (string | number)[]
  ) => {
    ensure(46);
    autoTable(doc, {
      startY: y,
      theme: opts.stripe ? 'striped' : 'grid',
      head: [head],
      body,
      foot: foot ? [foot] : undefined,
      margin: { left: margin, right: margin, top: 52, bottom: 46 },
      headStyles: {
        fillColor: opts.headColor || INK,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      bodyStyles: {
        fontSize: opts.fontSize || 8,
        textColor: TEXT,
        cellPadding: 4,
      },
      footStyles: {
        fillColor: SOFT,
        textColor: INK,
        fontStyle: 'bold',
        fontSize: opts.fontSize || 8,
        cellPadding: 4,
      },
      alternateRowStyles: { fillColor: SOFT },
      styles: { lineColor: LINE, lineWidth: 0.5, overflow: 'linebreak' },
    });
    y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 15;
  };

  const note = (text: string) => {
    const lines = doc.splitTextToSize(text, right - margin);
    ensure(lines.length * 11 + 8);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text(lines, margin, y + 4);
    y += lines.length * 10 + 8;
  };

  const bullets = (items: string[]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT);
    for (const item of items) {
      const lines = doc.splitTextToSize(item, right - margin - 12) as string[];
      ensure(lines.length * 11 + 6);
      doc.setTextColor(...BRAND);
      doc.text('•', margin + 2, y + 3);
      doc.setTextColor(...TEXT);
      doc.text(lines, margin + 12, y + 3);
      y += lines.length * 11 + 5;
    }
    y += 8;
  };

  const trend = (curr: number, prev: number): string => {
    if (!compare) return '—';
    if (!prev) return 'sin base';
    return formatSignedPercent(((curr - prev) / prev) * 100, 1);
  };

  const money = (v: number) => formatCurrency(v);
  const count = (v: number) => formatNumber(v);

  const byDate = (a: RadianRecord, b: RadianRecord) =>
    (parseRecordDate(a['Fecha Emisión'])?.getTime() ?? 0) -
    (parseRecordDate(b['Fecha Emisión'])?.getTime() ?? 0);

  const docLabel = (r: RadianRecord) =>
    r.Prefijo ? `${r.Prefijo}-${r.Folio}` : String(r.Folio ?? '—');

  const party = (r: RadianRecord) => {
    const emitido = (r.Grupo || '').toLowerCase() === 'emitido';
    return {
      name: emitido ? r['Nombre Receptor'] : r['Nombre Emisor'],
      nit: emitido ? r['NIT Receptor'] : r['NIT Emisor'],
    };
  };

  const sum = (rows: RadianRecord[], pick: (r: RadianRecord) => number) =>
    rows.reduce((acc, r) => acc + (pick(r) || 0), 0);

  /* ---------------------------------------------------------------- */
  /* Encabezado primera página                                         */
  /* ---------------------------------------------------------------- */

  doc.setFillColor(...WHITE);
  doc.rect(0, 0, pageWidth, 84, 'F');
  doc.setFillColor(...BRAND);
  doc.rect(0, 82, pageWidth, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  doc.text('Accountant', margin, 36);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text('Contabilidad e impuestos · Informe de gestión y conciliación fiscal', margin, 52);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(company.name || 'Empresa sin identificar', right, 34, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(company.nit ? `NIT ${company.nit}` : '—', right, 48, { align: 'right' });

  y = 104;

  /* ---------------------------------------------------------------- */
  /* 1. Contexto del informe                                           */
  /* ---------------------------------------------------------------- */

  sectionTitle('Contexto del informe', 'Alcance, periodo y fuente de datos utilizada');

  const generated = new Date().toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  table(
    ['Campo', 'Valor'],
    [
      ['Empresa', company.name || 'Empresa sin identificar'],
      ['NIT', company.nit || '—'],
      ['Periodo analizado', period.label],
      ['Periodo de comparación', compare ? prevPeriod.label : 'Sin comparación'],
      ['Documentos en el periodo', count(records.length)],
      ['Documentos en la fuente', count(sourceRecords.length)],
      ['Archivo de origen', fileName],
      ['Generado', generated],
    ],
    { headColor: INK }
  );

  /* ---------------------------------------------------------------- */
  /* 2. Indicadores principales                                        */
  /* ---------------------------------------------------------------- */

  sectionTitle(
    'Indicadores principales',
    `Comparado contra ${prevPeriod.label}${compare ? '' : ' (comparación desactivada)'}`
  );

  const ventasNetas = kpis.totalVentasBrutas - kpis.totalNotasCreditoEmitidas;
  const comprasNetas = kpis.totalComprasBrutas - kpis.totalNotasCreditoRecibidas;
  const prevVentasNetas = prevKpis.totalVentasBrutas - prevKpis.totalNotasCreditoEmitidas;
  const prevComprasNetas = prevKpis.totalComprasBrutas - prevKpis.totalNotasCreditoRecibidas;

  table(
    ['Indicador', 'Periodo actual', 'Periodo anterior', 'Variación', 'Nota'],
    [
      [
        'Ventas netas',
        money(ventasNetas),
        compare ? money(prevVentasNetas) : '—',
        trend(ventasNetas, prevVentasNetas),
        `${count(kpis.totalVentasCount)} facturas emitidas`,
      ],
      [
        'Compras netas',
        money(comprasNetas),
        compare ? money(prevComprasNetas) : '—',
        trend(comprasNetas, prevComprasNetas),
        `${count(kpis.totalComprasCount)} facturas recibidas`,
      ],
      [
        'IVA generado (débito fiscal)',
        money(kpis.ivaGenerado),
        compare ? money(prevKpis.ivaGenerado) : '—',
        trend(kpis.ivaGenerado, prevKpis.ivaGenerado),
        'Sobre ventas del periodo',
      ],
      [
        'IVA descontable (crédito fiscal)',
        money(kpis.ivaDescontable),
        compare ? money(prevKpis.ivaDescontable) : '—',
        trend(kpis.ivaDescontable, prevKpis.ivaDescontable),
        'Sobre compras del periodo',
      ],
      [
        kpis.ivaPorPagar >= 0 ? 'IVA estimado por pagar' : 'IVA estimado a favor',
        money(Math.abs(kpis.ivaPorPagar)),
        compare ? money(Math.abs(prevKpis.ivaPorPagar)) : '—',
        trend(kpis.ivaPorPagar, prevKpis.ivaPorPagar),
        kpis.ivaPorPagar >= 0 ? 'Estimación de pago' : 'Estimación de saldo a favor',
      ],
    ],
    { headColor: BRAND }
  );

  /* ---------------------------------------------------------------- */
  /* 3. Indicadores secundarios                                        */
  /* ---------------------------------------------------------------- */

  sectionTitle('Indicadores secundarios', 'Operación no incluida en los indicadores principales');

  const notasCredito = kpis.totalNotasCreditoEmitidas + kpis.totalNotasCreditoRecibidas;
  const prevNotasCredito =
    prevKpis.totalNotasCreditoEmitidas + prevKpis.totalNotasCreditoRecibidas;

  table(
    ['Indicador', 'Periodo actual', 'Documentos', 'Periodo anterior', 'Variación'],
    [
      [
        'Nómina electrónica',
        money(kpis.totalNomina),
        count(kpis.totalNominaCount),
        compare ? money(prevKpis.totalNomina) : '—',
        trend(kpis.totalNomina, prevKpis.totalNomina),
      ],
      [
        'Documento soporte (DSE + POS)',
        money(kpis.totalDocSoporte),
        count(kpis.totalDocSoporteCount),
        compare ? money(prevKpis.totalDocSoporte) : '—',
        trend(kpis.totalDocSoporte, prevKpis.totalDocSoporte),
      ],
      [
        'Notas crédito (emitidas + recibidas)',
        money(notasCredito),
        count(kpis.totalNotasCreditoCount),
        compare ? money(prevNotasCredito) : '—',
        trend(notasCredito, prevNotasCredito),
      ],
      [
        'Total de documentos',
        count(records.length),
        'en el periodo',
        compare ? count(prevRecords.length) : '—',
        trend(records.length, prevRecords.length),
      ],
    ],
    { headColor: INK }
  );

  /* ---------------------------------------------------------------- */
  /* 4. Requiere atención                                              */
  /* ---------------------------------------------------------------- */

  const attention = attentionItems(records);
  sectionTitle(
    'Requiere atención',
    attention.length === 0
      ? 'Sin hallazgos en el periodo'
      : `${attention.length} hallazgo${attention.length === 1 ? '' : 's'} sobre los documentos del periodo`
  );

  table(
    ['Hallazgo', 'Severidad', 'Documentos'],
    attention.length === 0
      ? [
          [
            'Sin documentos rechazados, duplicados ni incompletos en el periodo.',
            'Sin novedad',
            '0',
          ],
        ]
      : attention.map((a) => [
          a.label,
          a.severity === 'error' ? 'Requiere acción' : a.severity === 'warning' ? 'Revisar' : 'Informativo',
          count(a.count),
        ]),
    { headColor: attention.length ? undefined : BRAND }
  );

  /* ---------------------------------------------------------------- */
  /* 5. Estado documental                                              */
  /* ---------------------------------------------------------------- */

  const status = statusSummary(records);
  sectionTitle('Estado documental', `${count(status.total)} documentos en el periodo`);

  const pct = (v: number) => formatPercent(status.total ? (v / status.total) * 100 : 0, 1);
  table(
    ['Estado', 'Documentos', 'Participación'],
    [
      ['Aprobados', count(status.aprobados), pct(status.aprobados)],
      ['Pendientes', count(status.pendientes), pct(status.pendientes)],
      ['Rechazados', count(status.rechazados), pct(status.rechazados)],
      ['Con inconsistencias', count(status.inconsistencias), pct(status.inconsistencias)],
    ],
    { headColor: INK },
    ['Total', count(status.total), '100,0 %']
  );

  /* ---------------------------------------------------------------- */
  /* 6. Calidad de datos                                               */
  /* ---------------------------------------------------------------- */

  const quality = qualityReport(records);
  sectionTitle('Calidad de datos', 'Validaciones aplicadas sobre los documentos del periodo');

  table(
    ['Validación', 'Valor'],
    [
      ['Documentos validados', `${formatPercent(quality.validadosPct, 1)} del total`],
      ['Documentos procesados', count(quality.procesados)],
      ['Aprobados', count(quality.aprobados)],
      ['Requieren revisión', count(quality.requierenRevision)],
      ['Posibles duplicados', count(quality.duplicados)],
      ['Sin fecha de emisión', count(quality.sinFecha)],
      ['NIT inválidos', count(quality.nitInvalidos)],
    ],
    { headColor: INK }
  );

  /* ---------------------------------------------------------------- */
  /* 7. Serie de ventas y compras                                      */
  /* ---------------------------------------------------------------- */

  const series = buildSalesPurchasesSeries(records);
  sectionTitle(
    'Serie de ventas y compras',
    series.mode === 'month'
      ? 'Agrupación mensual de facturación emitida y recibida'
      : 'Agrupación diaria de facturación emitida y recibida'
  );

  table(
    ['Periodo', 'Ventas', 'Compras', 'Neto'],
    series.data.map((p) => [p.label, money(p.ventas), money(p.compras), money(p.ventas - p.compras)]),
    { headColor: BRAND, stripe: true, fontSize: 8 },
    [
      'Total',
      money(series.data.reduce((a, p) => a + p.ventas, 0)),
      money(series.data.reduce((a, p) => a + p.compras, 0)),
      money(
        series.data.reduce((a, p) => a + p.ventas - p.compras, 0)
      ),
    ]
  );

  /* ---------------------------------------------------------------- */
  /* 8-9. Terceros destacados                                          */
  /* ---------------------------------------------------------------- */

  const clients = topParties(records, 'cliente', 10);
  const suppliers = topParties(records, 'proveedor', 10);
  const clientTotal = clients.reduce((a, c) => a + Math.max(0, c.total), 0);
  const supplierTotal = suppliers.reduce((a, s) => a + Math.max(0, s.total), 0);

  sectionTitle('Principales clientes', 'Participación sobre las ventas del periodo');
  table(
    ['Cliente', 'NIT', 'Documentos', 'Ventas', 'Participación'],
    clients.length === 0
      ? [['Sin ventas registradas en el periodo.', '—', '—', '—', '—']]
      : clients.map((c) => [
          c.name,
          c.nit,
          count(c.count),
          money(Math.max(0, c.total)),
          formatPercent(clientTotal ? (c.total / clientTotal) * 100 : 0, 1),
        ]),
    { headColor: BRAND, stripe: true }
  );

  sectionTitle('Principales proveedores', 'Participación sobre las compras del periodo');
  table(
    ['Proveedor', 'NIT', 'Documentos', 'Compras', 'Participación'],
    suppliers.length === 0
      ? [['Sin compras registradas en el periodo.', '—', '—', '—', '—']]
      : suppliers.map((s) => [
          s.name,
          s.nit,
          count(s.count),
          money(Math.max(0, s.total)),
          formatPercent(supplierTotal ? (s.total / supplierTotal) * 100 : 0, 1),
        ]),
    { headColor: BRAND, stripe: true }
  );

  /* ---------------------------------------------------------------- */
  /* 10. Observaciones                                                 */
  /* ---------------------------------------------------------------- */

  const observations = buildObservations(records, prevRecords, prevPeriod.label);
  sectionTitle(
    'Observaciones',
    `${observations.length} lectura${observations.length === 1 ? '' : 's'} derivadas de los documentos`
  );
  if (observations.length === 0) {
    note('Sin observaciones relevantes para el periodo seleccionado.');
  } else {
    bullets(observations);
  }

  /* ---------------------------------------------------------------- */
  /* 11. Determinación del IVA                                         */
  /* ---------------------------------------------------------------- */

  sectionTitle('Determinación del IVA', 'Débito fiscal menos crédito fiscal sobre el periodo');

  table(
    ['Concepto', 'Valor', 'Base'],
    [
      ['IVA generado (débito fiscal)', money(kpis.ivaGenerado), `${count(kpis.totalVentasCount)} facturas emitidas`],
      [
        'IVA descontable (crédito fiscal)',
        money(kpis.ivaDescontable),
        `${count(kpis.totalComprasCount)} facturas recibidas`,
      ],
      [
        'IVA en notas crédito emitidas (incluido)',
        money(kpis.ncEmitidasIVA),
        `${count(kpis.totalNotasCreditoCount)} notas crédito`,
      ],
      [
        'IVA en notas crédito recibidas (incluido)',
        money(kpis.ncRecibidasIVA),
        `${count(kpis.totalNotasCreditoCount)} notas crédito`,
      ],
      [
        kpis.ivaPorPagar >= 0 ? '(=) IVA estimado por pagar' : '(=) IVA estimado a favor',
        money(Math.abs(kpis.ivaPorPagar)),
        kpis.ivaPorPagar >= 0 ? 'Obligación estimada' : 'Saldo a favor estimado',
      ],
      ['Retenciones practicadas', money(kpis.retencionesTotales), 'Fuente, IVA e ICA'],
    ],
    { headColor: BRAND },
    ['Saldo estimado', money(Math.abs(kpis.ivaPorPagar)), kpis.ivaPorPagar >= 0 ? 'Pagar' : 'A favor']
  );

  note(
    'Estimación basada en los documentos electrónicos disponibles para el periodo seleccionado. ' +
      'No constituye declaración oficial.'
  );

  /* ---------------------------------------------------------------- */
  /* 12. Conciliación Formulario 300                                   */
  /* ---------------------------------------------------------------- */

  sectionTitle(
    'Conciliación de IVA · simulación Formulario 300',
    'Renglones derivados únicamente de los documentos electrónicos del periodo'
  );

  table(
    ['Renglón', 'Valor', 'Efecto impositivo'],
    [
      ['Ingresos brutos por facturación', money(kpis.totalVentasBrutas), 'Base'],
      ['(-) Notas crédito emitidas', `- ${money(kpis.totalNotasCreditoEmitidas)}`, 'Descuento'],
      ['(=) Ingresos netos', money(ventasNetas), 'Base gravable'],
      ['Total IVA generado (débito fiscal)', money(kpis.totalVentasIVA), 'Impuesto a cargo'],
      ['', '', ''],
      ['Compras y gastos con factura', money(kpis.totalComprasBrutas), 'Base'],
      ['(-) Notas crédito recibidas', `- ${money(kpis.totalNotasCreditoRecibidas)}`, 'Descuento'],
      ['(=) Compras netas', money(comprasNetas), 'Base gravable'],
      ['Total IVA descontable (crédito fiscal)', money(kpis.totalComprasIVA), 'Descuento tributario'],
      ['', '', ''],
      ['(+) Débito fiscal', money(kpis.totalVentasIVA), 'Debito'],
      ['(-) Crédito fiscal', `- ${money(kpis.totalComprasIVA)}`, 'Credito'],
      [
        kpis.ivaPorPagar >= 0 ? '(=) Saldo estimado a pagar a la DIAN' : '(=) Saldo estimado a favor',
        money(Math.abs(kpis.ivaPorPagar)),
        kpis.ivaPorPagar >= 0 ? 'Pago DIAN' : 'A favor',
      ],
      ['Total retenciones reportadas', money(kpis.retencionesTotales), 'Retención en la fuente'],
    ],
    { headColor: INK }
  );

  note(
    'Otros renglones del Formulario 300 (saldo a favor anterior, importaciones, operaciones ' +
      'excluidas o exentas) requieren una fuente de datos adicional y se muestran como "sin fuente" en la aplicación.'
  );

  /* ---------------------------------------------------------------- */
  /* 13. Retenciones                                                   */
  /* ---------------------------------------------------------------- */

  sectionTitle('Retenciones', 'Resumen y detalle de retenciones practicadas en el periodo');

  const retentionOf = (r: RadianRecord): { concepts: string[]; valor: number } => {
    const concepts: string[] = [];
    let valor = 0;
    if ((r['Rete Renta'] || 0) > 0) {
      concepts.push('Retención en la fuente');
      valor += r['Rete Renta'] || 0;
    }
    if ((r['Rete IVA'] || 0) > 0) {
      concepts.push('ReteIVA');
      valor += r['Rete IVA'] || 0;
    }
    if ((r['Rete ICA'] || 0) > 0) {
      concepts.push('ReteICA');
      valor += r['Rete ICA'] || 0;
    }
    return { concepts, valor };
  };

  table(
    ['Tipo de retención', 'Valor'],
    [
      ['Retención en la fuente', money(kpis.retencionesFuente)],
      ['ReteIVA', money(kpis.retencionesIVA)],
      ['ReteICA', money(kpis.retencionesICA)],
      ['Autorretenciones', '— (sin fuente)'],
    ],
    { headColor: INK },
    ['Total retenido', money(kpis.retencionesTotales)]
  );

  const retentionRows = records
    .filter((r) => retentionOf(r).valor > 0)
    .sort((a, b) => byDate(a, b));

  y += 4;
  table(
    ['Concepto', 'Documento', 'Fecha', 'Tercero', 'Base', 'Valor retenido'],
    retentionRows.length === 0
      ? [['Sin retenciones en el periodo.', '—', '—', '—', '—', '—']]
      : retentionRows.map((r) => {
          const info = retentionOf(r);
          const p = party(r);
          return [
            info.concepts.join(', '),
            docLabel(r),
            formatDate(r['Fecha Emisión']),
            String(p.name || '—'),
            money(r.baseCalculada || 0),
            money(info.valor),
          ];
        }),
    { headColor: BRAND, stripe: true, fontSize: 7.5 },
    retentionRows.length > 0
      ? [
          'Total',
          `${count(retentionRows.length)} docs`,
          '',
          '',
          money(sum(retentionRows, (r) => r.baseCalculada || 0)),
          money(sum(retentionRows, (r) => retentionOf(r).valor)),
        ]
      : undefined
  );

  /* ---------------------------------------------------------------- */
  /* 14. Obligaciones                                                  */
  /* ---------------------------------------------------------------- */

  const obligations: { concepto: string; valor: number; nota: string }[] = [];
  if (Math.abs(kpis.ivaPorPagar) > 0) {
    obligations.push({
      concepto: `IVA estimado por pagar — ${period.label}`,
      valor: Math.abs(kpis.ivaPorPagar),
      nota: 'Fecha de vencimiento sin configurar',
    });
  }
  if (kpis.retencionesTotales > 0) {
    obligations.push({
      concepto: `Retenciones practicadas — ${period.label}`,
      valor: kpis.retencionesTotales,
      nota: 'Reporte de retenciones sin fecha configurada',
    });
  }

  sectionTitle('Obligaciones del periodo', 'Valores calculados a partir de los documentos disponibles');
  table(
    ['Concepto', 'Valor estimado', 'Calendario', 'Estado'],
    obligations.length === 0
      ? [['Sin obligaciones calculadas para el periodo.', '—', '—', '—']]
      : obligations.map((o) => [o.concepto, money(o.valor), o.nota, 'Pendiente']),
    { headColor: INK }
  );

  /* ---------------------------------------------------------------- */
  /* 15. Terceros                                                      */
  /* ---------------------------------------------------------------- */

  const thirdParties = buildThirdParties(records).sort((a, b) => b.total - a.total);
  sectionTitle(
    'Terceros del periodo',
    `${count(thirdParties.length)} terceros identificados en los documentos del periodo`
  );

  table(
    ['Identificación', 'Tercero', 'Tipo', 'Documentos', 'Total', 'IVA', 'Última fecha'],
    thirdParties.length === 0
      ? [['—', 'Sin terceros en el periodo.', '—', '—', '—', '—', '—']]
      : thirdParties.map((t) => [
          t.nit,
          t.name,
          t.kind === 'cliente' ? 'Cliente' : t.kind === 'proveedor' ? 'Proveedor' : 'Otro',
          count(t.documentos),
          money(t.total),
          money(t.iva),
          t.lastDate ? formatDate(t.lastDate) : '—',
        ]),
    { headColor: INK, stripe: true, fontSize: 7.5 }
  );

  /* ---------------------------------------------------------------- */
  /* 16+. Detalle por módulo                                           */
  /* ---------------------------------------------------------------- */

  const detailSection = (
    title: string,
    subtitle: string,
    rows: RadianRecord[],
    head: string[],
    build: (r: RadianRecord) => (string | number)[],
    color: RGB,
    foot?: (string | number)[]
  ) => {
    const sorted = [...rows].sort(byDate);
    sectionTitle(title, `${subtitle} · ${count(sorted.length)} documentos`);
    if (sorted.length === 0) {
      note('Sin documentos de este tipo en el periodo seleccionado.');
      return;
    }
    table(
      head,
      sorted.map(build),
      { headColor: color, stripe: true, fontSize: 7.5 },
      foot ? foot : undefined
    );
  };

  const ventas = filterRecords(records, 'ventas');
  detailSection(
    'Detalle de ventas emitidas',
    'Facturación electrónica emitida del periodo',
    ventas,
    ['Fecha', 'Documento', 'Cliente', 'NIT', 'Base gravable', 'IVA', 'Total', 'Estado'],
    (r) => [
      formatDate(r['Fecha Emisión']),
      docLabel(r),
      String(r['Nombre Receptor'] || '—'),
      String(r['NIT Receptor'] || '—'),
      money(r.baseCalculada || 0),
      money(r.IVA || 0),
      money(r.Total || 0),
      String(r.Estado || '—'),
    ],
    BRAND,
    [
      'Total',
      `${count(ventas.length)}`,
      '',
      '',
      money(sum(ventas, (r) => r.baseCalculada || 0)),
      money(sum(ventas, (r) => r.IVA || 0)),
      money(sum(ventas, (r) => r.Total || 0)),
      '',
    ]
  );

  const compras = filterRecords(records, 'compras');
  detailSection(
    'Detalle de compras recibidas',
    'Facturación recibida y costos del periodo',
    compras,
    ['Fecha', 'Documento', 'Proveedor', 'NIT', 'Base gravable', 'IVA descontable', 'Total', 'Estado'],
    (r) => [
      formatDate(r['Fecha Emisión']),
      docLabel(r),
      String(r['Nombre Emisor'] || '—'),
      String(r['NIT Emisor'] || '—'),
      money(r.baseCalculada || 0),
      money(r.IVA || 0),
      money(r.Total || 0),
      String(r.Estado || '—'),
    ],
    [37, 99, 235],
    [
      'Total',
      `${count(compras.length)}`,
      '',
      '',
      money(sum(compras, (r) => r.baseCalculada || 0)),
      money(sum(compras, (r) => r.IVA || 0)),
      money(sum(compras, (r) => r.Total || 0)),
      '',
    ]
  );

  const notas = filterRecords(records, 'notas_credito');
  detailSection(
    'Notas crédito electrónicas',
    'Notas crédito emitidas y recibidas del periodo',
    notas,
    ['Fecha', 'Documento', 'Grupo', 'Tercero', 'NIT', 'Base', 'IVA', 'Total'],
    (r) => {
      const p = party(r);
      return [
        formatDate(r['Fecha Emisión']),
        docLabel(r),
        r.Grupo || '—',
        String(p.name || '—'),
        String(p.nit || '—'),
        money(r.baseCalculada || 0),
        money(r.IVA || 0),
        money(r.Total || 0),
      ];
    },
    [190, 24, 93],
    [
      'Total',
      `${count(notas.length)}`,
      '',
      '',
      '',
      money(sum(notas, (r) => r.baseCalculada || 0)),
      money(sum(notas, (r) => r.IVA || 0)),
      money(sum(notas, (r) => r.Total || 0)),
    ]
  );

  const dse = filterRecords(records, 'dse');
  detailSection(
    'Documentos soporte',
    'Documento soporte con no obligados a expedir factura y POS',
    dse,
    ['Fecha', 'Tipo', 'Documento', 'Tercero', 'NIT', 'IVA', 'Total', 'Estado'],
    (r) => {
      const p = party(r);
      return [
        formatDate(r['Fecha Emisión']),
        String(r['Tipo de documento'] || '—'),
        docLabel(r),
        String(p.name || '—'),
        String(p.nit || '—'),
        money(r.IVA || 0),
        money(r.Total || 0),
        String(r.Estado || '—'),
      ];
    },
    [126, 34, 206],
    [
      'Total',
      '',
      `${count(dse.length)}`,
      '',
      '',
      money(sum(dse, (r) => r.IVA || 0)),
      money(sum(dse, (r) => r.Total || 0)),
      '',
    ]
  );

  const nomina = filterRecords(records, 'nomina_pos').filter((r) =>
    (r['Tipo de documento'] || '').toLowerCase().includes('nomina')
  );
  detailSection(
    'Nómina electrónica',
    'Comprobantes de nómina individual del periodo',
    nomina,
    ['Fecha', 'Tipo', 'Documento', 'Empleado', 'Identificación', 'Total', 'Estado'],
    (r) => [
      formatDate(r['Fecha Emisión']),
      String(r['Tipo de documento'] || '—'),
      docLabel(r),
      String(r['Nombre Receptor'] || r['Nombre Emisor'] || '—'),
      String(r['NIT Receptor'] || r['NIT Emisor'] || '—'),
      money(r.Total || 0),
      String(r.Estado || '—'),
    ],
    [234, 88, 12],
    [
      'Total',
      '',
      `${count(nomina.length)}`,
      '',
      '',
      money(sum(nomina, (r) => r.Total || 0)),
      '',
    ]
  );

  detailSection(
    'Maestro de documentos del periodo',
    'Relación completa de documentos que soportan todos los indicadores',
    records,
    ['Fecha', 'Tipo', 'Documento', 'Emisor', 'Receptor', 'IVA', 'Total', 'Estado'],
    (r) => [
      formatDate(r['Fecha Emisión']),
      String(r['Tipo de documento'] || '—'),
      docLabel(r),
      String(r['Nombre Emisor'] || '—'),
      String(r['Nombre Receptor'] || '—'),
      money(r.IVA || 0),
      money(r.Total || 0),
      String(r.Estado || '—'),
    ],
    INK,
    [
      'Total',
      `${count(records.length)}`,
      '',
      '',
      '',
      money(sum(records, (r) => r.IVA || 0)),
      money(sum(records, (r) => r.Total || 0)),
      '',
    ]
  );

  /* ---------------------------------------------------------------- */
  /* Encabezado de páginas siguientes y pie de página                  */
  /* ---------------------------------------------------------------- */

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    if (i > 1) {
      doc.setFillColor(...BRAND);
      doc.rect(margin, 30, 3, 10, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...INK);
      doc.text('Accountant', margin + 8, 38);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text(
        `${company.name || 'Empresa sin identificar'} · ${period.label}`,
        right,
        38,
        { align: 'right' }
      );
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.5);
      doc.line(margin, 44, right, 44);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text(
      `Accountant · Informe de gestión · ${period.label} · Página ${i} de ${totalPages}`,
      pageWidth / 2,
      pageHeight - 20,
      { align: 'center' }
    );
  }

  const outputFileName = `ACCOUNTANT_${fileName.replace(/\.[^/.]+$/, '')}_${new Date()
    .toISOString()
    .substring(0, 10)}.pdf`;
  doc.save(outputFileName);
}
