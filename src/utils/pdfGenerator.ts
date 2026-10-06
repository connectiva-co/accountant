import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RadianRecord, FinancialKPIs } from '../types/radian';
import { formatCurrency } from './formatters';
import { filterRecords } from './radianEngine';

export function generateFullPdfReport(
  records: RadianRecord[],
  kpis: FinancialKPIs,
  fileName: string = 'RADIAN AGOSTO JGV.xlsx'
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const primaryColor: [number, number, number] = [15, 23, 42]; // Slate 900
  const brandGreen: [number, number, number] = [22, 163, 74]; // Emerald 600
  const brandBlue: [number, number, number] = [37, 99, 235]; // Blue 600
  const textDark: [number, number, number] = [30, 41, 59];

  // Helper para dibujar banner de encabezado en la primera página
  const drawHeader = () => {
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 75, 'F');

    doc.setFillColor(...brandGreen);
    doc.rect(0, 72, pageWidth, 3, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text('RADIAN Analytics Pro', margin, 38);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text('Informe Ejecutivo & Conciliación Fiscal de Facturación Electrónica DIAN', margin, 54);

    const now = new Date().toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.setFontSize(8);
    doc.text(`Generado: ${now} | Archivo: ${fileName}`, pageWidth - margin, 46, { align: 'right' });
  };

  drawHeader();

  let y = 95;

  // --- SECCIÓN: RESUMEN EJECUTIVO Y KPIS ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...textDark);
  doc.text('1. Resumen Ejecutivo & Métricas Financieras Clave', margin, y);
  y += 15;

  const ventasNetas = kpis.totalVentasBrutas - kpis.totalNotasCreditoEmitidas;
  const comprasNetas = kpis.totalComprasBrutas - kpis.totalNotasCreditoRecibidas;

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: textDark,
    },
    head: [['Concepto Financiero / Tributario', 'Documentos', 'Base Gravable', 'Impuestos (IVA)', 'Total Neto']],
    body: [
      [
        'Ventas Facturadas (Emitidas)',
        `${kpis.totalVentasCount} facturas`,
        formatCurrency(kpis.totalVentasBase),
        formatCurrency(kpis.totalVentasIVA),
        formatCurrency(kpis.totalVentasBrutas),
      ],
      [
        '(-) Devoluciones / Notas Crédito Ventas',
        '-',
        '-',
        '-',
        `- ${formatCurrency(kpis.totalNotasCreditoEmitidas)}`,
      ],
      [
        '(=) Total Ingresos Netos Operacionales',
        '-',
        '-',
        '-',
        formatCurrency(ventasNetas),
      ],
      [
        'Compras & Gastos (Recibidas)',
        `${kpis.totalComprasCount} facturas`,
        formatCurrency(kpis.totalComprasBase),
        formatCurrency(kpis.totalComprasIVA),
        formatCurrency(kpis.totalComprasBrutas),
      ],
      [
        '(-) Notas Crédito Recibidas',
        '-',
        '-',
        '-',
        `- ${formatCurrency(kpis.totalNotasCreditoRecibidas)}`,
      ],
      [
        '(=) Total Compras & Gastos Netos',
        '-',
        '-',
        '-',
        formatCurrency(comprasNetas),
      ],
      [
        'Documentos Soporte con No Obligados (DSE)',
        `${kpis.totalDocSoporteCount} operaciones`,
        '-',
        '-',
        formatCurrency(kpis.totalDocSoporte),
      ],
      [
        'Nómina Electrónica Individual',
        `${kpis.totalNominaCount} comprobantes`,
        '-',
        '-',
        formatCurrency(kpis.totalNomina),
      ],
    ],
    margin: { left: margin, right: margin },
  });

  y = (doc as any).lastAutoTable.finalY + 20;

  // --- SECCIÓN: CONCILIACIÓN FISCAL (SIMULACIÓN FORMULARIO 300 DIAN) ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...textDark);
  doc.text('2. Conciliación Fiscal de IVA (Simulación Formulario 300 DIAN)', margin, y);
  y += 15;

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    headStyles: {
      fillColor: [51, 65, 85],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: textDark,
    },
    head: [['Renglón / Concepto Fiscal', 'Valor Calculado', 'Efecto Impositivo']],
    body: [
      ['(+) IVA Generado en Ventas (Débito Fiscal)', formatCurrency(kpis.totalVentasIVA), 'Impuesto a Cargo'],
      ['(-) IVA Descontable en Compras (Crédito Fiscal)', formatCurrency(kpis.totalComprasIVA), 'Descuento Tributario'],
      [
        kpis.ivaPorPagar >= 0 ? '(=) Saldo Estimado a Pagar a la DIAN' : '(=) Saldo Estimado a Favor del Contribuyente',
        formatCurrency(Math.abs(kpis.ivaPorPagar)),
        kpis.ivaPorPagar >= 0 ? 'PAGO DIAN' : 'A FAVOR',
      ],
      ['Total Retenciones DIAN Reportadas (Renta, IVA, ICA)', formatCurrency(kpis.retencionesTotales), 'Retención en la Fuente'],
    ],
    margin: { left: margin, right: margin },
  });

  // --- TAB 1: VENTAS (FACTURAS EMITIDAS) ---
  doc.addPage();
  y = 40;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...textDark);
  doc.text('3. Detalle de Ventas Facturadas (Emitidas)', margin, y);
  y += 12;

  const ventas = filterRecords(records, 'ventas');
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    headStyles: {
      fillColor: brandGreen,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: textDark,
    },
    head: [['Folio', 'Fecha', 'Receptor / Cliente', 'NIT Receptor', 'Base Gravable', 'IVA', 'Total']],
    body: ventas.slice(0, 30).map((r) => [
      r.Prefijo ? `${r.Prefijo}-${r.Folio}` : String(r.Folio),
      String(r['Fecha Emisión']).substring(0, 10),
      (r['Nombre Receptor'] || '').substring(0, 24),
      String(r['NIT Receptor'] || ''),
      formatCurrency(r.baseCalculada),
      formatCurrency(r.IVA),
      formatCurrency(r.Total),
    ]),
    margin: { left: margin, right: margin },
  });

  // --- TAB 2: COMPRAS Y GASTOS (RECIBIDAS) ---
  doc.addPage();
  y = 40;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...textDark);
  doc.text('4. Detalle de Compras & Gastos con Factura (Recibidas)', margin, y);
  y += 12;

  const compras = filterRecords(records, 'compras');
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    headStyles: {
      fillColor: brandBlue,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: textDark,
    },
    head: [['Folio', 'Fecha', 'Emisor / Proveedor', 'NIT Emisor', 'Base Gravable', 'IVA Descontable', 'Total']],
    body: compras.slice(0, 30).map((r) => [
      r.Prefijo ? `${r.Prefijo}-${r.Folio}` : String(r.Folio),
      String(r['Fecha Emisión']).substring(0, 10),
      (r['Nombre Emisor'] || '').substring(0, 24),
      String(r['NIT Emisor'] || ''),
      formatCurrency(r.baseCalculada),
      formatCurrency(r.IVA),
      formatCurrency(r.Total),
    ]),
    margin: { left: margin, right: margin },
  });

  // --- TAB 3: NOTAS CRÉDITO & DOCUMENTOS SOPORTE ---
  doc.addPage();
  y = 40;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...textDark);
  doc.text('5. Notas de Crédito Electrónicas', margin, y);
  y += 12;

  const notas = filterRecords(records, 'notas_credito');
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    headStyles: {
      fillColor: [225, 29, 72], // Rose 600
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: textDark,
    },
    head: [['Folio', 'Fecha', 'Emisor / Receptor', 'Grupo', 'Base', 'IVA', 'Total']],
    body: notas.slice(0, 20).map((r) => [
      String(r.Folio),
      String(r['Fecha Emisión']).substring(0, 10),
      (r['Nombre Receptor'] || r['Nombre Emisor'] || '').substring(0, 24),
      r.Grupo || 'Emitido',
      formatCurrency(r.baseCalculada),
      formatCurrency(r.IVA),
      formatCurrency(r.Total),
    ]),
    margin: { left: margin, right: margin },
  });

  y = (doc as any).lastAutoTable.finalY + 25;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...textDark);
  doc.text('6. Documentos Soporte (No Obligados) & Nómina', margin, y);
  y += 12;

  const dseAndNomina = [
    ...filterRecords(records, 'dse'),
    ...filterRecords(records, 'nomina_pos'),
  ];

  autoTable(doc, {
    startY: y,
    theme: 'striped',
    headStyles: {
      fillColor: [126, 34, 206], // Purple 700
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: textDark,
    },
    head: [['Tipo Documento', 'Folio', 'Fecha', 'Beneficiario / Sujeto', 'Identificación', 'Total']],
    body: dseAndNomina.slice(0, 20).map((r) => [
      r['Tipo de documento'],
      String(r.Folio),
      String(r['Fecha Emisión']).substring(0, 10),
      (r['Nombre Receptor'] || r['Nombre Emisor'] || '').substring(0, 24),
      String(r['NIT Receptor'] || r['NIT Emisor'] || ''),
      formatCurrency(r.Total),
    ]),
    margin: { left: margin, right: margin },
  });

  // Enumeración de páginas en el pie
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // Slate 400
    doc.text(
      `RADIAN Analytics Pro · Informe Oficial DIAN · Página ${i} de ${totalPages}`,
      pageWidth / 2,
      pageHeight - 20,
      { align: 'center' }
    );
  }

  // Descarga del PDF
  const outputFileName = `REPORTE_RADIAN_${fileName.replace(/\.[^/.]+$/, '')}_${new Date().toISOString().substring(0, 10)}.pdf`;
  doc.save(outputFileName);
}
