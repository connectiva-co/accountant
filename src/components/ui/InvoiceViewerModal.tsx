import React, { useEffect, useState } from 'react';
import {
  X,
  FileCheck2,
  Copy,
  Check,
  Download,
  Building2,
  User,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Loader2,
  Code2,
  RefreshCw,
  UploadCloud,
} from 'lucide-react';
import { api, type ParsedUblInvoice } from '../../api/client';
import type { RadianRecord } from '../../types/radian';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { InvoiceTaxLiquidator } from './InvoiceTaxLiquidator';

interface Props {
  document: RadianRecord;
  companyId: string | null;
  onClose: () => void;
  onTaxesSaved?: () => void;
}

export const InvoiceViewerModal: React.FC<Props> = ({ document, companyId, onClose, onTaxesSaved }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ invoice: ParsedUblInvoice; raw_xml: string } | null>(null);
  const [copiedCufe, setCopiedCufe] = useState(false);
  const [showRawXml, setShowRawXml] = useState(false);

  const effectiveCompanyId =
    companyId ||
    (typeof window !== 'undefined' ? localStorage.getItem('accountant_selected_company_id') : null) ||
    'c92e7f20-3aff-4c6d-860e-795bbf5c061d';

  const [syncingToSiigo, setSyncingToSiigo] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSyncToSiigo = async () => {
    if (!document.id || !effectiveCompanyId) return;
    try {
      setSyncingToSiigo(true);
      setSyncResult(null);
      const res = await api.syncDocumentToSiigo(effectiveCompanyId, document.id);
      setSyncResult({
        success: true,
        message: `Comprobante creado exitosamente en Siigo: #${res.number || res.external_id || 'OK'}`,
      });
      if (onTaxesSaved) {
        onTaxesSaved();
      }
    } catch (err) {
      setSyncResult({
        success: false,
        message: err instanceof Error ? err.message : 'Error al sincronizar con Siigo',
      });
    } finally {
      setSyncingToSiigo(false);
    }
  };

  const docFolio = document.Prefijo ? `${document.Prefijo}-${document.Folio}` : String(document.Folio);

  const fetchXml = React.useCallback(async () => {
    if (!document.id) {
      setError('Documento no identificado.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDocumentXml(effectiveCompanyId, document.id);
      setData({ invoice: res.invoice, raw_xml: res.raw_xml });
      setLoading(false);
    } catch (err: any) {
      setError(err?.message || 'No se pudo obtener el XML oficial desde Siigo.');
      setLoading(false);
    }
  }, [effectiveCompanyId, document.id]);

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
            <div className="space-y-5">
              {/* Document Summary Card from RADIAN */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-card border border-line bg-canvas space-y-1.5">
                  <span className="text-[11px] font-semibold text-brand uppercase tracking-wider block">
                    Emisor / Proveedor
                  </span>
                  <h3 className="text-[14px] font-bold text-ink">{document['Nombre Emisor'] || '—'}</h3>
                  <p className="text-[12px] text-ink-muted num font-medium">NIT: {document['NIT Emisor'] || '—'}</p>
                </div>
                <div className="p-4 rounded-card border border-line bg-canvas space-y-1.5">
                  <span className="text-[11px] font-semibold text-brand uppercase tracking-wider block">
                    Receptor / Cliente
                  </span>
                  <h3 className="text-[14px] font-bold text-ink">{document['Nombre Receptor'] || '—'}</h3>
                  <p className="text-[12px] text-ink-muted num font-medium">NIT: {document['NIT Receptor'] || '—'}</p>
                </div>
              </div>

              {/* Financial values strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-surface border border-line text-[11px]">
                <div>
                  <span className="text-ink-muted block text-[10px]">Fecha Emisión</span>
                  <span className="num font-semibold text-ink">{document['Fecha Emisión'] || '—'}</span>
                </div>
                <div>
                  <span className="text-ink-muted block text-[10px]">IVA Reportado</span>
                  <span className="num font-semibold text-ink">{formatCurrency(document.IVA || 0)}</span>
                </div>
                <div>
                  <span className="text-ink-muted block text-[10px]">Total Documento</span>
                  <span className="num font-bold text-brand">{formatCurrency(document.Total || 0)}</span>
                </div>
              </div>

              {/* Tax liquidator for this document */}
              {document.id && (
                <InvoiceTaxLiquidator
                  documentId={document.id}
                  companyId={effectiveCompanyId}
                  thirdPartyIdentifier={String(
                    document.Grupo === 'Recibido' ? document['NIT Emisor'] : document['NIT Receptor']
                  )}
                  thirdPartyName={String(
                    document.Grupo === 'Recibido' ? document['Nombre Emisor'] : document['Nombre Receptor']
                  )}
                  defaultBase={document.baseCalculada || Math.max(0, (document.Total || 0) - (document.IVA || 0))}
                  totalDocument={document.Total || 0}
                  ivaDocument={document.IVA || 0}
                  onTaxesSaved={onTaxesSaved}
                />
              )}

              {/* Technical XML Note & Retry */}
              <div className="p-3 rounded-md border border-line bg-canvas flex items-center justify-between gap-3 text-[11px] text-ink-muted">
                <span className="truncate">
                  {document.Grupo === 'Recibido'
                    ? 'Factura recibida (Compra): La liquidación de retenciones se calcula directamente sobre los valores registrados en la DIAN.'
                    : error}
                </span>
                {document.Grupo !== 'Recibido' && (
                  <button
                    type="button"
                    onClick={() => void fetchXml()}
                    className="px-2 py-1 rounded bg-surface hover:bg-canvas border border-line text-ink text-[11px] font-medium transition cursor-pointer inline-flex items-center gap-1 shrink-0"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reintentar XML
                  </button>
                )}
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

              <InvoiceTaxLiquidator
                documentId={document.id || ''}
                companyId={companyId}
                thirdPartyIdentifier={String(
                  document.Grupo === 'Emitido' ? document['NIT Receptor'] : document['NIT Emisor']
                )}
                thirdPartyName={String(
                  document.Grupo === 'Emitido' ? document['Nombre Receptor'] : document['Nombre Emisor']
                )}
                defaultBase={document.baseCalculada || data.invoice.totals.lineExtensionAmount || (document.Total - (document.IVA || 0))}
                totalDocument={document.Total || data.invoice.totals.payableAmount}
                ivaDocument={document.IVA || (data.invoice.totals.taxInclusiveAmount - data.invoice.totals.taxExclusiveAmount)}
                onTaxesSaved={onTaxesSaved}
              />

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
        <div className="flex items-center justify-between px-6 py-3 border-t border-line bg-canvas text-[11px] text-ink-muted">
          <div>
            {syncResult && (
              <span className={`text-[12px] font-medium ${syncResult.success ? 'text-emerald-700' : 'text-rose-700'}`}>
                {syncResult.message}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSyncToSiigo}
              disabled={syncingToSiigo || document.match_status === 'MATCHED'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition cursor-pointer text-white shadow-xs ${
                document.match_status === 'MATCHED'
                  ? 'bg-ink-muted/50 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {syncingToSiigo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
              {document.match_status === 'MATCHED' ? 'Sincronizado con Siigo' : syncingToSiigo ? 'Subiendo a Siigo...' : 'Subir a Siigo (Comprobante)'}
            </button>
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
    </div>
  );
};
