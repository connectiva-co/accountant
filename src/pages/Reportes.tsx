import React from 'react';
import { Download, FileDown, FileSpreadsheet } from 'lucide-react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { SectionHeader } from '../components/ui/SectionHeader';
import { exportToMultiSheetExcel } from '../utils/radianEngine';
import { generateFullPdfReport } from '../utils/pdfGenerator';

export const Reportes: React.FC = () => {
  const {
    records,
    periodRecords,
    prevRecords,
    kpis,
    prevKpis,
    compare,
    period,
    prevPeriod,
    company,
    fileName,
    openUpload,
  } = useApp();

  const downloadPdf = () =>
    generateFullPdfReport({
      records: periodRecords,
      sourceRecords: records,
      prevRecords,
      kpis,
      prevKpis,
      compare,
      period,
      prevPeriod,
      company,
      fileName,
    });

  return (
    <>
      <PageHeader title="Reportes" subtitle={`Exportaciones y entregables de ${period.label}`} />

      <Panel className="overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <SectionHeader title="Exportaciones disponibles" description="Generadas con los documentos cargados" />
        </div>

        <div className="divide-y divide-line">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-8 h-8 rounded-md border border-line bg-canvas flex items-center justify-center text-ink-muted shrink-0">
                <FileDown className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">Informe ejecutivo en PDF</div>
                <p className="text-xs text-ink-muted mt-0.5">
                  Mismas secciones y discriminación del tablero: contexto, indicadores, atención,
                  estado documental, calidad, terceros, IVA, conciliación, retenciones, obligaciones
                  y el detalle completo de todos los documentos del periodo.
                </p>
                <p className="text-[11px] text-ink-faint num mt-1">
                  {records.length} documentos en la fuente · {periodRecords.length} en el periodo
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={downloadPdf}
              className="h-8 shrink-0 inline-flex items-center gap-1.5 px-3 text-xs font-medium rounded-md bg-brand text-white hover:bg-brand-600 transition-colors"
            >
              <FileDown className="w-3.5 h-3.5" />
              Descargar PDF
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 px-4 py-3.5">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-8 h-8 rounded-md border border-line bg-canvas flex items-center justify-center text-ink-muted shrink-0">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">Libro de Excel multi-hoja</div>
                <p className="text-xs text-ink-muted mt-0.5">
                  Una hoja por tipo de documento: maestro, ventas, compras, notas crédito, documento
                  soporte y nómina.
                </p>
                <p className="text-[11px] text-ink-faint mt-1">Formato .xlsx</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => exportToMultiSheetExcel(records)}
              className="h-8 shrink-0 inline-flex items-center gap-1.5 px-3 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-ink-faint" />
              Exportar
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 px-4 py-3.5">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-8 h-8 rounded-md border border-line bg-canvas flex items-center justify-center text-ink-muted shrink-0">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">Actualizar archivo de origen</div>
                <p className="text-xs text-ink-muted mt-0.5">
                  Reemplaza la fuente de datos activa con un archivo .xlsx nuevo.
                </p>
                <p className="text-[11px] text-ink-faint num mt-1">Archivo actual: {fileName}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={openUpload}
              className="h-8 shrink-0 inline-flex items-center gap-1.5 px-3 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors"
            >
              Importar datos
            </button>
          </div>
        </div>
      </Panel>

      <Panel className="mt-3 p-4">
        <SectionHeader
          title="Contenido del informe PDF"
          description="Secciones incluidas en la descarga"
        />
        <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-[13px] text-ink-muted">
          {[
            '1. Contexto del informe',
            '2. Indicadores principales',
            '3. Indicadores secundarios',
            '4. Requiere atención',
            '5. Estado documental',
            '6. Calidad de datos',
            '7. Serie de ventas y compras',
            '8. Principales clientes',
            '9. Principales proveedores',
            '10. Observaciones',
            '11. Determinación del IVA',
            '12. Conciliación de IVA (Formulario 300)',
            '13. Retenciones (resumen y detalle)',
            '14. Obligaciones del periodo',
            '15. Terceros del periodo',
            '16. Detalle de ventas emitidas',
            '17. Detalle de compras recibidas',
            '18. Notas crédito electrónicas',
            '19. Documentos soporte',
            '20. Nómina electrónica',
            '21. Maestro de documentos del periodo',
          ].map((s) => (
            <div key={s} className="py-1 border-b border-line last:border-b-0">
              {s}
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
};
