import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { formatCurrency } from '../../utils/formatters';
import { Check, Loader2, Calculator, AlertCircle } from 'lucide-react';

interface InvoiceTaxLiquidatorProps {
  documentId: string;
  companyId: string | null;
  defaultBase: number;
  totalDocument: number;
  ivaDocument: number;
  onTaxesSaved?: () => void;
}

const RETEFUENTE_PRESETS = [
  { label: '0%', rate: 0, desc: 'Sin retención' },
  { label: '2.5%', rate: 2.5, desc: 'Compras declarantes' },
  { label: '3.5%', rate: 3.5, desc: 'Compras no declarantes' },
  { label: '4.0%', rate: 4.0, desc: 'Servicios declarantes' },
  { label: '6.0%', rate: 6.0, desc: 'Servicios no declarantes' },
  { label: '11.0%', rate: 11.0, desc: 'Honorarios' },
];

const RETEICA_PRESETS = [
  { label: '0‰', ratePerMil: 0, desc: 'Sin ReteICA' },
  { label: '4.14‰', ratePerMil: 4.14, desc: 'Industrial' },
  { label: '6.90‰', ratePerMil: 6.90, desc: 'Comercial' },
  { label: '9.66‰', ratePerMil: 9.66, desc: 'Servicios' },
  { label: '11.04‰', ratePerMil: 11.04, desc: 'Financiero/Otros' },
];

const RETEIVA_PRESETS = [
  { label: '0%', rate: 0, desc: 'Sin ReteIVA' },
  { label: '15%', rate: 15.0, desc: '15% del IVA facturado' },
];

export const InvoiceTaxLiquidator: React.FC<InvoiceTaxLiquidatorProps> = ({
  documentId,
  companyId,
  defaultBase,
  totalDocument,
  ivaDocument,
  onTaxesSaved,
}) => {
  const [base, setBase] = useState<number>(defaultBase > 0 ? defaultBase : Math.max(0, totalDocument - ivaDocument));
  const [customBaseInput, setCustomBaseInput] = useState<string>('');

  // Selected rates
  const [reteFuenteRate, setReteFuenteRate] = useState<number>(0);
  const [reteIcaRatePerMil, setReteIcaRatePerMil] = useState<number>(0);
  const [reteIvaRate, setReteIvaRate] = useState<number>(0);

  // Loading & feedback states
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load existing saved taxes if present
  useEffect(() => {
    let active = true;
    const fetchExistingTaxes = async () => {
      if (!companyId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await api.getDocumentTaxes(companyId, documentId);
        if (active && res.taxes.length > 0) {
          for (const t of res.taxes) {
            if (t.tax_code === 'RENTA_RETE') {
              if (t.taxable_base > 0) setBase(t.taxable_base);
              if (t.rate !== null && t.rate !== undefined) setReteFuenteRate(t.rate);
              else if (t.taxable_base > 0) setReteFuenteRate(Math.round((t.amount / t.taxable_base) * 10000) / 100);
            }
            if (t.tax_code === 'ICA_RETE') {
              if (t.rate !== null && t.rate !== undefined) setReteIcaRatePerMil(t.rate);
              else if (t.taxable_base > 0) setReteIcaRatePerMil(Math.round((t.amount / t.taxable_base) * 100000) / 100);
            }
            if (t.tax_code === 'IVA_RETE') {
              if (t.rate !== null && t.rate !== undefined) setReteIvaRate(t.rate);
              else if (ivaDocument > 0) setReteIvaRate(Math.round((t.amount / ivaDocument) * 10000) / 100);
            }
          }
        }
      } catch {
        // Silently use defaults if no saved taxes yet
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchExistingTaxes();
    return () => {
      active = false;
    };
  }, [companyId, documentId, ivaDocument]);

  // Calculations
  const activeBase = customBaseInput !== '' ? Number(customBaseInput) || 0 : base;
  const reteFuenteAmount = Math.round(activeBase * (reteFuenteRate / 100) * 100) / 100;
  const reteIcaAmount = Math.round(activeBase * (reteIcaRatePerMil / 1000) * 100) / 100;
  const reteIvaAmount = Math.round(ivaDocument * (reteIvaRate / 100) * 100) / 100;

  const totalRetenciones = reteFuenteAmount + reteIcaAmount + reteIvaAmount;
  const netoPagar = Math.max(0, totalDocument - totalRetenciones);

  const handleSave = async () => {
    if (!companyId) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const taxesPayload = [
        {
          tax_code: 'RENTA_RETE',
          taxable_base: activeBase,
          rate: reteFuenteRate,
          amount: reteFuenteAmount,
        },
        {
          tax_code: 'ICA_RETE',
          taxable_base: activeBase,
          rate: reteIcaRatePerMil,
          amount: reteIcaAmount,
        },
        {
          tax_code: 'IVA_RETE',
          taxable_base: ivaDocument,
          rate: reteIvaRate,
          amount: reteIvaAmount,
        },
      ];

      await api.updateDocumentTaxes(companyId, documentId, taxesPayload);
      setSaveSuccess(true);
      onTaxesSaved?.();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err?.message || 'Error al guardar los impuestos del documento.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 rounded-card border border-line bg-canvas flex items-center justify-center gap-2 text-ink-muted text-[12px]">
        <Loader2 className="w-4 h-4 animate-spin text-brand" />
        <span>Consultando liquidación tributaria…</span>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-canvas p-4 space-y-4">
      {/* Title & Base Gravable Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-line">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-brand shrink-0" />
          <h4 className="text-[13px] font-semibold text-ink">Liquidador de Retenciones</h4>
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-ink-muted">Base gravable:</span>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-ink num">{formatCurrency(activeBase)}</span>
            {customBaseInput !== '' && (
              <button
                type="button"
                onClick={() => setCustomBaseInput('')}
                className="text-[10px] text-brand hover:underline cursor-pointer"
              >
                (Restablecer)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Retenciones Pickers */}
      <div className="space-y-3.5">
        {/* 1. ReteFuente */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-ink">
              Retención en la fuente (Renta) {reteFuenteRate > 0 && `(${reteFuenteRate}%)`}
            </span>
            <span className="font-semibold num text-rose-600 dark:text-rose-400">
              {reteFuenteAmount > 0 ? `-${formatCurrency(reteFuenteAmount)}` : '$0'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RETEFUENTE_PRESETS.map((p) => {
              const selected = reteFuenteRate === p.rate;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setReteFuenteRate(p.rate)}
                  title={p.desc}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition cursor-pointer border ${
                    selected
                      ? 'bg-brand text-surface border-brand shadow-xs'
                      : 'bg-surface hover:bg-canvas text-ink border-line'
                  }`}
                >
                  {p.label} <span className="text-[10px] opacity-75 font-normal">({p.desc.split(' ')[0]})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. ReteICA */}
        <div className="space-y-1.5 pt-2 border-t border-line/60">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-ink">
              ReteICA (Industria y Comercio) {reteIcaRatePerMil > 0 && `(${reteIcaRatePerMil}‰)`}
            </span>
            <span className="font-semibold num text-rose-600 dark:text-rose-400">
              {reteIcaAmount > 0 ? `-${formatCurrency(reteIcaAmount)}` : '$0'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RETEICA_PRESETS.map((p) => {
              const selected = reteIcaRatePerMil === p.ratePerMil;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setReteIcaRatePerMil(p.ratePerMil)}
                  title={p.desc}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition cursor-pointer border ${
                    selected
                      ? 'bg-brand text-surface border-brand shadow-xs'
                      : 'bg-surface hover:bg-canvas text-ink border-line'
                  }`}
                >
                  {p.label} <span className="text-[10px] opacity-75 font-normal">({p.desc})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. ReteIVA */}
        {ivaDocument > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-line/60">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-ink">
                ReteIVA (Sobre IVA de {formatCurrency(ivaDocument)}) {reteIvaRate > 0 && `(${reteIvaRate}%)`}
              </span>
              <span className="font-semibold num text-rose-600 dark:text-rose-400">
                {reteIvaAmount > 0 ? `-${formatCurrency(reteIvaAmount)}` : '$0'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RETEIVA_PRESETS.map((p) => {
                const selected = reteIvaRate === p.rate;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setReteIvaRate(p.rate)}
                    title={p.desc}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition cursor-pointer border ${
                      selected
                        ? 'bg-brand text-surface border-brand shadow-xs'
                        : 'bg-surface hover:bg-canvas text-ink border-line'
                    }`}
                  >
                    {p.label} <span className="text-[10px] opacity-75 font-normal">({p.desc.split(' ')[0]})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Summary Box & Save Button */}
      <div className="pt-3 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-line/80">
        <div className="space-y-0.5 text-[11px]">
          <div className="text-ink-muted">
            Total Factura: <span className="num font-medium text-ink">{formatCurrency(totalDocument)}</span> ·
            Retenciones: <span className="num font-medium text-rose-600 dark:text-rose-400">-{formatCurrency(totalRetenciones)}</span>
          </div>
          <div className="text-[13px] font-bold text-ink flex items-center gap-1.5">
            <span>Neto a Pagar:</span>
            <span className="num text-emerald-600 dark:text-emerald-400">{formatCurrency(netoPagar)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveError && (
            <span className="text-[11px] text-danger inline-flex items-center gap-1" title={saveError}>
              <AlertCircle className="w-3.5 h-3.5" />
              Error
            </span>
          )}
          {saveSuccess && (
            <span className="text-[11px] text-emerald-600 font-medium inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              ¡Guardado!
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-3.5 py-1.5 rounded-md bg-brand hover:bg-brand/90 text-surface text-[12px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shadow-xs"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {saving ? 'Guardando…' : 'Guardar retenciones'}
          </button>
        </div>
      </div>
    </div>
  );
};
