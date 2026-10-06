import React, { useState } from 'react';
import { Upload, X, FileSpreadsheet, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { RadianRecord } from '../types/radian';
import { enrichRecords } from '../utils/radianEngine';

interface FileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataLoaded: (records: RadianRecord[], fileName: string) => void;
}

export const FileUploadModal: React.FC<FileUploadModalProps> = ({ isOpen, onClose, onDataLoaded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const processFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawJson = XLSX.utils.sheet_to_json(worksheet);

      if (!rawJson || rawJson.length === 0) {
        throw new Error('El archivo seleccionado no contiene filas o está vacío.');
      }

      const enriched = enrichRecords(rawJson);
      onDataLoaded(enriched, file.name);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Error al procesar el archivo Excel. Verifica el formato.');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg rounded-2xl p-6 border border-slate-700 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 rounded-xl bg-brand-500/10 text-brand-400 border border-brand-500/20">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Cargar Reporte RADIAN DIAN</h3>
            <p className="text-xs text-slate-400">Sube un archivo .xlsx descargado de la DIAN</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={isDragging ? 'border-2 border-dashed rounded-xl p-8 text-center transition-all border-brand-500 bg-brand-500/5' : 'border-2 border-dashed rounded-xl p-8 text-center transition-all border-slate-700 bg-slate-900/40 hover:border-slate-600'}
        >
          <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-400">
            <Upload className="w-6 h-6 text-brand-400" />
          </div>
          <div className="text-sm font-medium text-white mb-1">
            Arrastra tu archivo aquí o haz clic para buscar
          </div>
          <p className="text-xs text-slate-400 mb-4">Formatos compatibles: .xlsx, .xls, .csv</p>

          <label className="inline-flex items-center px-4 py-2 rounded-xl text-xs font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 cursor-pointer shadow-md shadow-brand-500/20 transition-all">
            {loading ? 'Procesando archivo...' : 'Seleccionar Archivo'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={loading}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  processFile(e.target.files[0]);
                }
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
};
