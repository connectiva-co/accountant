import React from 'react';
import { Download, FileDown, Menu, Upload } from 'lucide-react';
import { useApp } from '../../state/app-context';
import { PeriodSelector } from './PeriodSelector';
import { exportToMultiSheetExcel } from '../../utils/radianEngine';
import { generateFullPdfReport } from '../../utils/pdfGenerator';
import { formatNumber } from '../../utils/formatters';

interface TopHeaderProps {
  onMenuClick: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ onMenuClick }) => {
  const {
    company,
    kpis,
    records,
    periodRecords,
    prevRecords,
    prevKpis,
    compare,
    period,
    prevPeriod,
    fileName,
    openUpload,
    lastUpdate,
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
    <header className="sticky top-0 z-30 bg-surface border-b border-line">
      <div className="h-14 px-3 sm:px-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="lg:hidden w-8 h-8 inline-flex items-center justify-center border border-line rounded-md text-ink-muted hover:bg-canvas transition-colors"
          aria-label="Abrir navegación"
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[14px] font-semibold tracking-tight text-ink">Accountant</span>
        </div>

        <div className="hidden lg:flex flex-1 justify-center min-w-0">
          <div className="text-center leading-tight">
            <div className="text-[12.5px] font-medium text-ink truncate max-w-md">
              {company.name || 'Empresa sin identificar'}
            </div>
            <div className="text-[11px] text-ink-faint num">
              {company.nit ? `NIT ${company.nit}` : '—'}
            </div>
          </div>
        </div>

        <div className="flex-1 lg:flex-none" />

        <div className="flex items-center gap-2 shrink-0">
          {lastUpdate && (
            <span className="hidden xl:inline text-[11px] text-ink-faint num">
              Última actualización: {lastUpdate}
            </span>
          )}

          <PeriodSelector />

          <span className="hidden sm:block w-px h-6 bg-line" />

          <button
            type="button"
            onClick={openUpload}
            className="h-8 inline-flex items-center gap-1.5 px-2.5 text-xs font-medium rounded-md bg-brand text-white hover:bg-brand-600 transition-colors"
            title="Importar archivo de datos"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Importar datos</span>
          </button>

          <button
            type="button"
            onClick={() => exportToMultiSheetExcel(records)}
            className="h-8 hidden sm:inline-flex items-center gap-1.5 px-2.5 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors"
            title="Exportar libro de Excel con una hoja por tipo de documento"
          >
            <Download className="w-3.5 h-3.5 text-ink-faint" />
            <span className="hidden lg:inline">Exportar</span>
          </button>

          <button
            type="button"
            onClick={downloadPdf}
            className="h-8 inline-flex items-center gap-1.5 px-2.5 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors"
            title="Descargar informe en PDF"
          >
            <FileDown className="w-3.5 h-3.5 text-ink-faint" />
            <span className="hidden lg:inline">PDF</span>
          </button>
        </div>
      </div>

      <div className="hidden md:flex lg:hidden items-center justify-between px-4 h-9 border-t border-line bg-canvas">
        <div className="text-[11px] text-ink-muted truncate">
          {company.name || 'Empresa sin identificar'}
          {company.nit ? ` · NIT ${company.nit}` : ''}
        </div>
        <div className="text-[11px] text-ink-faint num">{formatNumber(periodRecords.length)} documentos</div>
      </div>
    </header>
  );
};
