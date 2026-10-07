import React, { useEffect, useRef, useState } from 'react';
import { Download, FileDown, FileSpreadsheet, Menu, Upload, ChevronDown } from 'lucide-react';
import { useApp } from '../../state/app-context';
import { PeriodSelector } from './PeriodSelector';
import { CompanySelector } from './CompanySelector';
import { exportToMultiSheetExcel } from '../../utils/radianEngine';
import { generateFullPdfReport } from '../../utils/pdfGenerator';

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

  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const downloadPdf = () => {
    setExportOpen(false);
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
  };

  const downloadExcel = () => {
    setExportOpen(false);
    exportToMultiSheetExcel(records);
  };

  return (
    <header className="sticky top-0 z-30 bg-surface border-b border-line">
      <div className="h-14 px-3 sm:px-4 flex items-center justify-between gap-3">
        {/* Lado izquierdo: Toggle mobile + Selector de Empresa */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onMenuClick}
            className="lg:hidden w-8 h-8 inline-flex items-center justify-center border border-line rounded-md text-ink-muted hover:bg-canvas transition-colors"
            aria-label="Abrir navegación"
          >
            <Menu className="w-4 h-4" />
          </button>
          <CompanySelector />
        </div>

        {/* Lado derecho: Periodo + Acciones Unificadas */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {lastUpdate && (
            <span className="hidden xl:inline text-[11px] text-ink-faint num mr-1">
              Act: {lastUpdate}
            </span>
          )}

          <PeriodSelector />

          <span className="hidden sm:block w-px h-5 bg-line mx-0.5" />

          {/* Botón Importar */}
          <button
            type="button"
            onClick={openUpload}
            className="h-8 inline-flex items-center gap-1.5 px-3 text-xs font-medium rounded-md bg-brand text-white hover:bg-brand-600 shadow-sm transition-colors"
            title="Importar archivo RADIAN / DIAN (.xlsx)"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Importar datos</span>
          </button>

          {/* Menú Dropdown Exportar */}
          <div ref={exportMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setExportOpen(!exportOpen)}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 text-xs font-medium border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors shadow-sm"
              title="Opciones de exportación"
            >
              <Download className="w-3.5 h-3.5 text-ink-faint" />
              <span>Exportar</span>
              <ChevronDown className={`w-3 h-3 text-ink-faint transition-transform duration-150 ${exportOpen ? 'rotate-180' : ''}`} />
            </button>

            {exportOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-60 bg-surface border border-line rounded-card shadow-dropdown p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  onClick={downloadExcel}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-xs text-ink hover:bg-canvas transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <div className="font-medium text-ink">Libro Excel (.xlsx)</div>
                    <div className="text-[10px] text-ink-faint">Multi-hoja con desglose por tabs</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={downloadPdf}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-xs text-ink hover:bg-canvas transition-colors"
                >
                  <FileDown className="w-4 h-4 text-rose-600 shrink-0" />
                  <div>
                    <div className="font-medium text-ink">Informe Ejecutivo (.pdf)</div>
                    <div className="text-[10px] text-ink-faint">Resumen fiscal y detalle tributario</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
