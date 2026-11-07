import React from 'react';
import { X, CheckCircle2, AlertTriangle, Download, ArrowRight, ShieldCheck, Loader2 } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';
import { exportSimulationToExcel, type AccountingSimulationDocument } from '../../utils/simulationExcel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirmSync?: (selectedDocs: AccountingSimulationDocument[]) => void;
  isSyncing?: boolean;
  simulationData: {
    summary: {
      total_documents: number;
      valid: number;
      errors: number;
      total_debits: number;
      total_credits: number;
      is_balanced: boolean;
    };
    documents: AccountingSimulationDocument[];
  } | null;
}

export const SimulationResultsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onConfirmSync,
  isSyncing,
  simulationData,
}) => {
  if (!isOpen || !simulationData) return null;

  const { summary, documents } = simulationData;
  const validDocs = documents.filter((d) => d.is_valid);

  const handleExportExcel = () => {
    exportSimulationToExcel(documents);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface rounded-xl border border-line shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line bg-canvas/50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-brand/10 text-brand">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">
                Simulación Contable y Validación Masiva (Dry Run)
              </h3>
              <p className="text-[11px] text-ink-muted">
                Previsualización de asientos contables en Siigo sin modificar base de datos ni emitir comprobantes
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-ink-muted hover:text-ink hover:bg-canvas transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Resumen KPIs de Simulación */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 bg-canvas/30 border-b border-line text-xs">
          <div className="p-2.5 rounded-lg border border-line bg-surface">
            <span className="text-ink-muted block text-[11px]">Total Analizadas</span>
            <span className="font-semibold text-sm text-ink num">{summary.total_documents}</span>
          </div>
          <div className="p-2.5 rounded-lg border border-line bg-surface">
            <span className="text-emerald-600 block text-[11px] font-medium">Facturas Válidas</span>
            <span className="font-semibold text-sm text-emerald-600 num">{summary.valid}</span>
          </div>
          <div className="p-2.5 rounded-lg border border-line bg-surface">
            <span className="text-rose-600 block text-[11px] font-medium">Con Observaciones</span>
            <span className="font-semibold text-sm text-rose-600 num">{summary.errors}</span>
          </div>
          <div className="p-2.5 rounded-lg border border-line bg-surface">
            <span className="text-ink-muted block text-[11px]">Total Débitos</span>
            <span className="font-semibold text-sm text-ink num font-mono">
              {formatCurrency(summary.total_debits)}
            </span>
          </div>
          <div className="p-2.5 rounded-lg border border-line bg-surface">
            <span className="text-ink-muted block text-[11px]">Total Créditos</span>
            <span className="font-semibold text-sm text-ink num font-mono">
              {formatCurrency(summary.total_credits)}
            </span>
          </div>
        </div>

        {/* Lista de Documentos con Detalle de Partidas */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {documents.map((doc, idx) => (
            <div
              key={doc.document_id || idx}
              className={`rounded-lg border p-3 text-xs transition ${
                doc.is_valid
                  ? 'border-line bg-surface hover:border-brand/40'
                  : 'border-rose-500/30 bg-rose-500/5'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-line/60 pb-2">
                <div className="flex items-center gap-2">
                  {doc.is_valid ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <div>
                    <span className="font-bold text-ink mr-2">
                      {doc.folio || 'Sin Folio'}
                    </span>
                    <span className="text-ink-muted">
                      {doc.third_party_name} ({doc.third_party_nit})
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-ink-muted">
                    Total: <strong className="text-ink font-mono">{formatCurrency(doc.total || 0)}</strong>
                  </span>
                  <span className="text-[11px] text-ink-muted">
                    Neto: <strong className="text-ink font-mono">{formatCurrency(doc.neto_pagar || 0)}</strong>
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                      doc.is_valid
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : 'bg-rose-500/10 text-rose-600'
                    }`}
                  >
                    {doc.is_valid ? 'Lista' : 'Bloqueada'}
                  </span>
                </div>
              </div>

              {/* Errores o Advertencias */}
              {((doc.errors && doc.errors.length > 0) || (doc.warnings && doc.warnings.length > 0)) && (
                <div className="mt-2 space-y-1">
                  {doc.errors?.map((err, i) => (
                    <p key={i} className="text-[11px] text-rose-600 font-medium flex items-center gap-1">
                      • {err}
                    </p>
                  ))}
                  {doc.warnings?.map((w, i) => (
                    <p key={i} className="text-[11px] text-amber-600 flex items-center gap-1">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Previsualización Asiento Contable (Items) */}
              {doc.items && doc.items.length > 0 && (
                <div className="mt-2 pt-2 border-t border-line/40">
                  <div className="text-[10px] font-medium text-ink-faint uppercase mb-1">
                    Movimientos Contables Generados ({doc.voucher_type || 'CC-43000'})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-1 text-[11px] font-mono">
                    {doc.items.map((it, iIdx) => (
                      <React.Fragment key={iIdx}>
                        <div className="sm:col-span-3 text-ink font-semibold truncate">
                          {it.account.code}
                        </div>
                        <div className="sm:col-span-5 text-ink-muted truncate font-sans">
                          {it.description}
                        </div>
                        <div className="sm:col-span-4 text-right">
                          {it.account.movement === 'Debit' ? (
                            <span className="text-brand">+{formatCurrency(it.value)} (D)</span>
                          ) : (
                            <span className="text-ink-muted">-{formatCurrency(it.value)} (C)</span>
                          )}
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer con Acciones */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-line bg-canvas/50">
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-canvas text-ink text-xs font-medium transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Descargar Excel de Simulación</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-canvas text-ink-muted hover:text-ink text-xs font-medium transition"
            >
              Cerrar
            </button>
            {onConfirmSync && validDocs.length > 0 && (
              <button
                type="button"
                onClick={() => onConfirmSync(validDocs)}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Enviando lote...</span>
                  </>
                ) : (
                  <>
                    <span>Sincronizar {validDocs.length} facturas válidas</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

