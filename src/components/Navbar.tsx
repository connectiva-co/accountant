import React from 'react';
import { Upload, Download, RefreshCw, Layers, ShieldCheck } from 'lucide-react';
import { exportToMultiSheetExcel } from '../utils/radianEngine';
import type { RadianRecord } from '../types/radian';

interface NavbarProps {
  records: RadianRecord[];
  onUploadClick: () => void;
  onResetData: () => void;
  fileName: string;
}

export const Navbar: React.FC<NavbarProps> = ({ records, onUploadClick, onResetData, fileName }) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <Layers className="w-5 h-5 text-slate-950 font-bold" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-lg text-white tracking-tight">RADIAN Analytics Pro</h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-500/10 text-brand-400 border border-brand-500/20">
                <ShieldCheck className="w-3 h-3 mr-1" /> DIAN Validado
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate max-w-xs sm:max-w-md">
              Archivo activo: <span className="text-slate-200 font-mono">{fileName}</span> ({records.length} registros)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            onClick={onResetData}
            title="Recargar datos de muestra de Agosto"
            className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            <span className="hidden sm:inline">Datos Demo</span>
          </button>

          <button
            onClick={onUploadClick}
            className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700 shadow-sm"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5 text-brand-400" />
            <span>Cargar RADIAN (.xlsx)</span>
          </button>

          <button
            onClick={() => exportToMultiSheetExcel(records)}
            className="inline-flex items-center px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-950 bg-gradient-to-r from-brand-400 to-emerald-400 hover:from-brand-300 hover:to-emerald-300 transition-all font-semibold shadow-md shadow-brand-500/20"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            <span>Exportar Multi-Tab</span>
          </button>
        </div>
      </div>
    </header>
  );
};
