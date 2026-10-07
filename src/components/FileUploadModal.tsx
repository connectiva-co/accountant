import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Upload, X, FileSpreadsheet, AlertCircle, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { RadianRecord } from '../types/radian';
import { enrichRecords } from '../utils/radianEngine';
import { parseRecordDate } from '../utils/period';
import { api, ApiError, type ImportResult } from '../api/client';
import { useApp } from '../state/app-context';

interface FileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataLoaded: (records: RadianRecord[], fileName: string) => void;
}

const CANONICAL_KEYS = [
  'Tipo de documento', 'CUFE/CUDE', 'Folio', 'Prefijo', 'Divisa', 'Forma de Pago',
  'Medio de Pago', 'Fecha Emisión', 'Fecha Recepción', 'NIT Emisor', 'Nombre Emisor',
  'NIT Receptor', 'Nombre Receptor', 'IVA', 'ICA', 'IC', 'INC', 'Timbre', 'INC Bolsas',
  'IN Carbono', 'IN Combustibles', 'IC Datos', 'ICL', 'INPP', 'IBUA', 'ICUI',
  'Rete IVA', 'Rete Renta', 'Rete ICA', 'Total', 'Estado', 'Grupo',
];

const REQUIRED = ['tipo de documento', 'fecha emision'];

const norm = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const CANON_BY_NORM = new Map(CANONICAL_KEYS.map((k) => [norm(k), k]));
const HEADER_HINTS = new Set(CANONICAL_KEYS.map(norm));

function headerKey(cell: unknown): string {
  const raw = String(cell ?? '').replace(/\s+/g, ' ').trim();
  return CANON_BY_NORM.get(norm(raw)) || raw;
}

function sheetToRecords(ws: XLSX.WorkSheet): { records: Record<string, unknown>[]; headers: string[] } | null {
  const ref = ws['!ref'];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);

  let best = { score: 0, row: -1, hasTipo: false, hasFecha: false };
  const lastScan = Math.min(range.e.r, range.s.r + 40);
  for (let r = range.s.r; r <= lastScan; r++) {
    let score = 0;
    let hasTipo = false;
    let hasFecha = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || typeof cell.v !== 'string') continue;
      const n = norm(cell.v);
      if (!HEADER_HINTS.has(n)) continue;
      score++;
      if (n === 'tipo de documento') hasTipo = true;
      if (n === 'fecha emision') hasFecha = true;
    }
    const usable = score >= 2 && (hasTipo || hasFecha);
    if (usable && score > best.score) best = { score, row: r, hasTipo, hasFecha };
  }
  if (best.row < 0) return null;

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    range: XLSX.utils.encode_range({
      s: { c: range.s.c, r: best.row },
      e: { c: range.e.c, r: range.e.r },
    }),
    defval: '',
    blankrows: false,
    raw: true,
  });
  if (aoa.length < 2) return null;

  const headers = (aoa[0] as unknown[]).map(headerKey);
  const records: Record<string, unknown>[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[];
    const obj: Record<string, unknown> = {};
    let filled = false;
    headers.forEach((h, idx) => {
      if (!h) return;
      const v = row[idx];
      if (v !== undefined && v !== null && v !== '') filled = true;
      obj[h] = v;
    });
    if (filled) records.push(obj);
  }
  return { records, headers };
}

export const FileUploadModal: React.FC<FileUploadModalProps> = ({ isOpen, onClose, onDataLoaded }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { reloadDataset, apiOnline } = useApp();
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [loadingName, setLoadingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (!summary) return;
    const timer = setTimeout(() => {
      setSummary(null);
      onClose();
    }, 2400);
    return () => clearTimeout(timer);
  }, [summary, onClose]);

  if (!isOpen) return null;

  const openPicker = () => inputRef.current?.click();

  const processFile = async (file: File) => {
    setLoading(true);
    setLoadingStep("1/3: Validando estructura y columnas del archivo...");
    setLoadingName(file.name);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });

      let parsed: { records: Record<string, unknown>[]; headers: string[] } | null = null;
      for (const sheetName of workbook.SheetNames) {
        const candidate = sheetToRecords(workbook.Sheets[sheetName]);
        if (candidate && candidate.records.length > 0) {
          parsed = candidate;
          break;
        }
      }

      if (!parsed) {
        throw new Error(
          `No se reconocieron los encabezados en "${file.name}". Se espera una hoja con columnas como ` +
            '"Tipo de documento", "Fecha Emisión", "NIT Emisor", "Total". ' +
            `Hojas encontradas: ${workbook.SheetNames.join(', ')}.`
        );
      }

      const missing = REQUIRED.filter((k) => !parsed!.headers.some((h) => norm(h) === k));
      if (missing.length > 0) {
        const labels: Record<string, string> = {
          'tipo de documento': '"Tipo de documento"',
          'fecha emision': '"Fecha Emisión"',
        };
        throw new Error(
          `Faltan columnas obligatorias: ${missing.map((m) => labels[m] || m).join(', ')}. ` +
            `Columnas detectadas: ${parsed.headers.filter(Boolean).slice(0, 12).join(', ') || 'ninguna'}.`
        );
      }

      setLoadingStep("2/3: Guardando en PostgreSQL y conciliando impuestos...");
      const enriched = enrichRecords(parsed.records);
      const withDate = enriched.filter((r) => parseRecordDate(r['Fecha Emisión']));
      if (withDate.length === 0) {
        throw new Error(
          'Se encontraron las columnas pero ningún valor de "Fecha Emisión" pudo leerse. ' +
            'Formatos admitidos: dd-mm-aaaa, aaaa-mm-dd o fecha de Excel.'
        );
      }

      // Importación persistente en la base de datos (server/).
      // Si el servidor no está disponible, la aplicación conserva el archivo
      // en memoria para no romper la funcionalidad.
      try {
        const result = await api.uploadImport(file);
        setLoadingStep("3/3: Actualizando métricas y períodos...");
        const reloaded = await reloadDataset();
        if (reloaded) {
          setSummary(result);
          return;
        }
      } catch (err) {
        if (err instanceof ApiError && err.status !== 0) {
          // El servidor respondió: es un error de negocio (archivo inválido, etc.).
          throw err;
        }
        // Servidor caído => sigue en modo local con los registros ya leídos.
      }

      onDataLoaded(enriched, file.name);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'No se pudo leer el archivo. Verifica que sea un .xlsx válido.');
    } finally {
      setLoading(false);
      setLoadingName('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40">
      <div className="w-full max-w-lg bg-surface border border-line rounded-card shadow-dropdown relative">
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-line">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-4 h-4 text-ink-faint" />
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Importar datos</h3>
              <p className="text-[11px] text-ink-muted">
                Archivo .xlsx con documentos electrónicos (formato RADIAN / DIAN)
              </p>
            </div>
          </div>
          <button
            onClick={() => !loading && onClose()}
            disabled={loading}
            className="text-ink-faint hover:text-ink p-1 rounded-md hover:bg-canvas transition-colors disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {error && (
            <div className="mb-4 p-3 rounded-md bg-danger/5 border border-danger/20 text-danger text-xs leading-relaxed flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {summary && (
            <div className="mb-4 p-3 rounded-md bg-success/5 border border-success/20 text-success text-xs leading-relaxed flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  {summary.replayed ? 'Archivo ya importado (sin cambios)' : 'Importado a la base de datos'}
                </p>
                <p className="text-ink-muted mt-0.5 num">
                  {summary.total} filas · {summary.inserted} nuevas · {summary.updated} actualizadas ·{' '}
                  {summary.unchanged} sin cambios · {summary.rejected} rechazadas · {summary.warnings} avisos
                </p>
              </div>
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={loading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processFile(file);
              e.target.value = '';
            }}
          />

          <div
            onClick={() => !loading && openPicker()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!loading) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (!loading && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                openPicker();
              }
            }}
            className={
              loading
                ? 'border-2 border-dashed rounded-md p-8 text-center transition-colors border-brand bg-brand-50 cursor-wait'
                : isDragging
                  ? 'border-2 border-dashed rounded-md p-8 text-center transition-colors border-brand bg-brand-50 cursor-pointer'
                  : 'border-2 border-dashed rounded-md p-8 text-center transition-colors border-line bg-canvas hover:border-gray-300 cursor-pointer'
            }
          >
            {loading ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin text-brand mx-auto mb-3" />
                <div className="text-[13px] font-medium text-ink">Procesando archivo…</div>
                <p className="text-[11px] text-brand font-medium mt-1">{loadingStep}</p>
                <p className="text-[11px] text-ink-muted mt-1 truncate max-w-xs mx-auto" title={loadingName}>
                  {loadingName}
                </p>
              </>
            ) : (
              <>
                <div className="w-9 h-9 rounded-md border border-line bg-surface flex items-center justify-center mx-auto mb-3 text-ink-faint">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="text-[13px] font-medium text-ink">
                  Arrastra el archivo o haz clic para seleccionarlo
                </div>
                <p className="text-[11px] text-ink-muted mt-1">Formatos compatibles: .xlsx, .xls, .csv</p>
                <span className="mt-4 inline-flex items-center h-8 px-4 text-xs font-medium bg-brand hover:bg-brand-600 text-white rounded-md cursor-pointer transition-colors">
                  Seleccionar archivo
                </span>
              </>
            )}
          </div>

          <p className="mt-3 text-[11px] text-ink-muted">
            Al importar, el archivo se valida y se guarda en la base de datos: la operación es
            idempotente (el mismo archivo no duplica documentos) y queda registrada en el historial.
          </p>
          {apiOnline === false && (
            <p className="mt-1.5 text-[11px] text-warning">
              El servidor de Accountant no responde: el archivo se usará solo en memoria para esta
              sesión y no quedará guardado.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
