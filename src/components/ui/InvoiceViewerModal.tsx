import React, { useEffect, useState } from 'react';
import {
  X,
  FileCheck2,
  Copy,
  Check,
  Download,
  AlertCircle,
  Building2,
  User,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Loader2,
  Code2,
} from 'lucide-react';
import { api, type ParsedUblInvoice } from '../../api/client';
import type { RadianRecord } from '../../types/radian';
import { formatCurrency, formatDate } from '../../utils/formatters';

interface Props {
  document: RadianRecord;
  companyId: string | null;
  onClose: () => void;
}

export const InvoiceViewerModal: React.FC<Props> = ({ document, companyId, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ invoice: ParsedUblInvoice; raw_xml: string } | null>(null);
  const [copiedCufe, setCopiedCufe] = useState(false);
  const [showRawXml, setShowRawXml] = useState(false);

  const docFolio = document.Prefijo ? `${document.Prefijo}-${document.Folio}` : String(document.Folio);

  const fetchXml = React.useCallback(async () => {
    if (!companyId || !document.id) {
      setError('Documento o empresa no identificados.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDocumentXml(companyId, document.id);
      setData({ invoice: res.invoice, raw_xml: res.raw_xml });
      setLoading(false);
    } catch (err: any) {
      setError(err?.message || 'No se pudo obtener el XML oficial desde Siigo.');
      setLoading(false);
    }
  }, [companyId, document.id]);

  useEffect(() => {
    void fetchXml();
  }, [fetchXml]);

  const handleCopyCufe = (cufe: string) => {
    navigator.clipboard.writeText(cufe);
    setCopiedCufe(true);
    setTimeout(() => setCopiedCufe(false), 2000);
  };

  const handleDownloadXml = () => {
    if (!data?.raw_xml) return;
    const blob = new Blob([data.raw_xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `Factura_${docFolio}_${data.invoice.id || 'UBL21'}.xml`;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6 bg-ink/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-4xl bg-surface border border-line rounded-card shadow-dropdown my-6 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-canvas">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-brand/10 border border-brand/20 flex items-center justify-center text-brand">
              <FileCheck2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold text-ink">Factura Electrónica de Venta</h2>
                <span className="num font-semibold text-xs px-2 py-0.5 rounded bg-brand text-surface">
                  {docFolio}
                </span>
                <span className="text-[11px] font-medium text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" />DIAN</span>
              </div>
              
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <button
                type="button"
                onClick={handleDownloadXml}
                className="px-2.5 py-1.5 rounded-md bg-canvas hover:bg-surface border border-line text-ink text-[12px] font-medium inline-flex items-center gap-1.5 transition cursor-pointer"
                title="Descargar archivo XML oficial firmado"
              >
                <Download className="w-3.5 h-3.5 text-brand" />
                Descargar XML
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-canvas transition cursor-pointer"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {loading && (
            <div className="py-20 flex flex-col items-center justify-center text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-brand" />
              <p className="text-[13px] text-ink-muted">Cargando factura {docFolio}…</p>
            </div>
          )}

          {error && !loading && (
            <div className="p-5 rounded-md border border-red-500/20 bg-red-500/5 text-danger space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
                <div className="space-y-1.5 flex-1">
                  <p className="text-[14px] font-semibold text-ink">No se pudo cargar la factura {docFolio}</p>
                  <div className="text-[12px] text-red-600 dark:text-red-400 font-mono bg-surface p-2.5 rounded border border-red-500/20 break-words">
                    {error}
                  </div>
                  {document.match_error && document.match_error !== error && (
                    <p className="text-[11px] text-ink-muted">
                      Último estado registrado en cotejo: <span className="font-mono text-ink font-medium">{document.match_error}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-red-500/10">
                <button
                  type="button"
                  onClick={() => void fetchXml()}
                  className="px-3 py-1.5 rounded-md bg-brand text-surface text-[12px] font-medium hover:bg-brand/90 transition cursor-pointer inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reintentar sincronización ahora
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-md bg-surface hover:bg-canvas border border-line text-ink text-[12px] font-medium transition cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-6">
              {/* Header Box: Supplier & Customer Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Emisor */}
                <div className="p-4 rounded-card border border-line bg-canvas space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand uppercase tracking-wider">
                    <Building2 className="w-3.5 h-3.5" />
                    Emisor / Proveedor
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold text-ink">{data.invoice.supplier.name}</h3>
                    <p className="text-[12px] text-ink-muted num font-medium">
                      NIT: {data.invoice.supplier.taxId}
                      {data.invoice.supplier.dv ? `-${data.invoice.supplier.dv}` : ''}
                    </p>
                  </div>
                  {(data.invoice.supplier.address || data.invoice.supplier.city) && (
                    <p className="text-[11px] text-ink-muted pt-1 border-t border-line">
                      {[data.invoice.supplier.address, data.invoice.supplier.city, data.invoice.supplier.department]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>

                {/* Cliente */}
                <div className="p-4 rounded-card border border-line bg-canvas space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand uppercase tracking-wider">
                    <User className="w-3.5 h-3.5" />
                    Cliente / Receptor
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold text-ink">{data.invoice.customer.name}</h3>
                    <p className="text-[12px] text-ink-muted num font-medium">
                      NIT / Identificación: {data.invoice.customer.taxId}
                      {data.invoice.customer.dv ? `-${data.invoice.customer.dv}` : ''}
                    </p>
                  </div>
                  {(data.invoice.customer.address || data.invoice.customer.city || data.invoice.customer.email) && (
                    <p className="text-[11px] text-ink-muted pt-1 border-t border-line">
                      {[data.invoice.customer.email, data.invoice.customer.address, data.invoice.customer.city]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              </div>

              {/* Invoice Meta Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-surface border border-line text-[11px]">
                <div>
                  <span className="text-ink-muted block text-[10px]">Fecha de Emisión</span>
                  <span className="num font-semibold text-ink">{formatDate(data.invoice.issueDate)}</span>
                </div>
                <div>
                  <span className="text-ink-muted block text-[10px]">Hora Oficial</span>
                  <span className="num font-medium text-ink">{data.invoice.issueTime || '—'}</span>
                </div>
                <div>
                  <span className="text-ink-muted block text-[10px]">Moneda</span>
                  <span className="num font-semibold text-ink">{data.invoice.currency}</span>
                </div>
                <div>
                  <span className="text-ink-muted block text-[10px]">Folio DIAN</span>
                  <span className="num font-semibold text-brand">{data.invoice.id}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="border border-line rounded-card overflow-hidden">
                <div className="px-4 py-2.5 bg-canvas border-b border-line flex items-center justify-between">
                  <h4 className="text-[12px] font-semibold text-ink uppercase tracking-wide">
                    Detalle de Productos y Servicios
                  </h4>
                  <span className="text-[11px] text-ink-muted num">
                    {data.invoice.lines.length} línea{data.invoice.lines.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead className="bg-canvas/50 text-[11px] text-ink-muted border-b border-line">
                      <tr>
                        <th className="px-4 py-2 font-medium w-12 text-center">#</th>
                        <th className="px-4 py-2 font-medium">Descripción</th>
                        <th className="px-4 py-2 font-medium text-right w-20">Cant.</th>
                        <th className="px-4 py-2 font-medium text-right w-28">V/r Unitario</th>
                        <th className="px-4 py-2 font-medium text-center w-28">Impuesto</th>
                        <th className="px-4 py-2 font-medium text-right w-32">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.invoice.lines.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-ink-muted text-[12px]">
                            Sin líneas detalladas registradas en el XML.
                          </td>
                        </tr>
                      ) : (
                        data.invoice.lines.map((l) => (
                          <tr key={l.id} className="hover:bg-canvas/40 transition">
                            <td className="px-4 py-2.5 text-center text-ink-muted num text-[11px]">{l.id}</td>
                            <td className="px-4 py-2.5 text-ink font-medium">{l.description}</td>
                            <td className="px-4 py-2.5 text-right num text-ink-muted">
                              {l.quantity} {l.unitCode !== 'UN' && l.unitCode !== 'ZZ' ? l.unitCode : ''}
                            </td>
                            <td className="px-4 py-2.5 text-right num text-ink-muted">{formatCurrency(l.unitPrice)}</td>
                            <td className="px-4 py-2.5 text-center">
                              {l.taxes.length > 0 ? (
                                l.taxes.map((t, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand/10 text-brand num"
                                  >
                                    {t.name} {t.percent}%
                                  </span>
                                ))
                              ) : (
                                <span className="text-[11px] text-ink-muted">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right num font-semibold text-ink">
                              {formatCurrency(l.subtotal)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Taxes & Totals Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Notes & Taxes Breakdown */}
                <div className="space-y-3">
                  {data.invoice.taxes.length > 0 && (
                    <div className="p-3.5 rounded-card border border-line bg-canvas space-y-2">
                      <span className="text-[11px] font-semibold text-ink uppercase tracking-wide block">
                        Desglose de Impuestos
                      </span>
                      <div className="space-y-1.5 text-[11px]">
                        {data.invoice.taxes.map((t, idx) => (
                          <div key={idx} className="flex items-center justify-between py-1 border-b border-line last:border-0">
                            <span className="text-ink-muted">
                              {t.name} ({t.percent}%) · Base: {formatCurrency(t.taxableAmount)}
                            </span>
                            <span className="num font-semibold text-ink">{formatCurrency(t.taxAmount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {data.invoice.notes.length > 0 && (
                    <div className="p-3 rounded-card border border-line bg-surface text-[11px] text-ink-muted space-y-1">
                      <span className="font-semibold text-ink block text-[10px] uppercase">Notas de la Factura:</span>
                      {data.invoice.notes.map((n, idx) => (
                        <p key={idx}>{n}</p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Final Totals Box */}
                <div className="p-4 rounded-card border border-line bg-canvas flex flex-col justify-between space-y-3">
                  <div className="space-y-2 text-[12px]">
                    <div className="flex justify-between text-ink-muted">
                      <span>Subtotal bruto</span>
                      <span className="num font-medium text-ink">
                        {formatCurrency(data.invoice.totals.lineExtensionAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-ink-muted">
                      <span>Base gravable neta</span>
                      <span className="num font-medium text-ink">
                        {formatCurrency(data.invoice.totals.taxExclusiveAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-ink-muted">
                      <span>Total impuestos liquidados</span>
                      <span className="num font-medium text-ink">
                        {formatCurrency(
                          data.invoice.totals.taxInclusiveAmount - data.invoice.totals.taxExclusiveAmount
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-line flex items-baseline justify-between">
                    <div>
                      <span className="text-[11px] font-semibold text-ink uppercase tracking-wider block">
                        Total a Pagar
                      </span>
                      <span className="text-[10px] text-ink-muted">Moneda legal colombiana ({data.invoice.currency})</span>
                    </div>
                    <span className="text-xl font-bold text-brand num">
                      {formatCurrency(data.invoice.totals.payableAmount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* CUFE Box & Compliance */}
              <div className="p-3.5 rounded-card border border-line bg-canvas space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Código Único de Factura Electrónica (CUFE)
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyCufe(data.invoice.cufe)}
                    className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline font-medium cursor-pointer"
                  >
                    {copiedCufe ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    {copiedCufe ? '¡Copiado!' : 'Copiar CUFE'}
                  </button>
                </div>
                <p className="font-mono text-[10px] text-ink-muted break-all bg-surface p-2 rounded border border-line select-all">
                  {data.invoice.cufe}
                </p>
              </div>

              {/* Raw XML Collapsible View */}
              <div className="border border-line rounded-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowRawXml(!showRawXml)}
                  className="w-full px-4 py-2.5 bg-canvas hover:bg-surface border-b border-line flex items-center justify-between text-[11px] text-ink font-medium transition cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5 text-ink-muted" />
                    Ver XML original
                  </span>
                  {showRawXml ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {showRawXml && (
                  <pre className="p-4 bg-ink text-surface/90 text-[10px] font-mono overflow-x-auto max-h-60 leading-relaxed">
                    {data.raw_xml}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-line bg-canvas text-[11px] text-ink-muted">
          
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-surface hover:bg-canvas border border-line text-ink font-medium transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
