import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ShieldCheck,
  Building2,
  User,
  Calculator,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Edit3,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import {
  api,
  type TaxConceptDto,
  type TaxDeterminationDto,
  type ThirdPartyTaxProfileDto,
} from '../../api/client';
import { formatCurrency } from '../../utils/formatters';
import { ThirdPartyTaxProfileModal } from './ThirdPartyTaxProfileModal';

interface InvoiceTaxLiquidatorProps {
  documentId: string;
  companyId: string | null;
  thirdPartyIdentifier?: string;
  thirdPartyName?: string;
  defaultBase: number;
  totalDocument: number;
  ivaDocument: number;
  onTaxesSaved?: () => void;
}

export const InvoiceTaxLiquidator: React.FC<InvoiceTaxLiquidatorProps> = ({
  documentId,
  companyId,
  thirdPartyIdentifier,
  thirdPartyName,
  defaultBase,
  totalDocument,
  ivaDocument: _ivaDocument,
  onTaxesSaved,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [calculating, setCalculating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Catálogos y datos
  const [concepts, setConcepts] = useState<TaxConceptDto[]>([]);
  const [profile, setProfile] = useState<ThirdPartyTaxProfileDto | null>(null);
  const [determinations, setDeterminations] = useState<TaxDeterminationDto[]>([]);
  const [companyConfigs, setCompanyConfigs] = useState<Record<string, boolean>>({});

  // Selección de conceptos
  const [selectedRentaConceptId, setSelectedRentaConceptId] = useState<string>('');
  const [selectedIcaConceptId, setSelectedIcaConceptId] = useState<string>('');

  // Modales
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [overrideTarget, setOverrideTarget] = useState<TaxDeterminationDto | null>(null);
  const [overrideRate, setOverrideRate] = useState<string>('');
  const [overrideAmount, setOverrideAmount] = useState<string>('');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [overrideSaving, setOverrideSaving] = useState<boolean>(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // Conceptos filtrados por impuesto
  const rentaConcepts = useMemo(
    () => concepts.filter((c) => c.tax_type_code === 'RENTA_RETE'),
    [concepts]
  );

  const icaConcepts = useMemo(
    () => concepts.filter((c) => c.tax_type_code === 'ICA_RETE'),
    [concepts]
  );

  // Ejecutar liquidación con el motor tributario
  const executeCalculation = useCallback(
    async (rentaId: string | null, icaId: string | null) => {
      if (!companyId || !documentId) return;

      setCalculating(true);
      setError(null);

      try {
        const res = await api.calculateDocumentTaxes(companyId, documentId, {
          renta_concept_id: rentaId || null,
          ica_concept_id: icaId || null,
        });

        setDeterminations(res.determinations);
        if (onTaxesSaved) onTaxesSaved();
      } catch (err: any) {
        setError(err.message || 'Error calculando retenciones');
      } finally {
        setCalculating(false);
      }
    },
    [companyId, documentId, onTaxesSaved]
  );

  // Cargar datos iniciales
  const loadInitialData = useCallback(async () => {
    if (!companyId || !documentId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [conceptsRes, detRes, configsRes] = await Promise.all([
        api.getTaxConcepts(),
        api.getDocumentTaxDeterminations(companyId, documentId).catch(() => ({ determinations: [] })),
        api.getCompanyTaxConfigurations(companyId).catch(() => ({ configurations: [] })),
      ]);

      setConcepts(conceptsRes.concepts);
      setDeterminations(detRes.determinations);

      // Mapear qué impuestos están habilitados para la empresa
      const enabledMap: Record<string, boolean> = {};
      for (const conf of configsRes.configurations) {
        if (conf.is_enabled) {
          enabledMap[conf.tax_type_code] = true;
          enabledMap[conf.tax_type_id] = true;
        }
      }
      setCompanyConfigs(enabledMap);

      let initialRenta = '';
      let initialIca = '';

      // Si ya existen determinaciones previas
      for (const d of detRes.determinations) {
        const cCode = d.tax_type_code || d.taxTypeCode;
        const cId = d.tax_concept_id || d.taxConceptId;
        if (cCode === 'RENTA_RETE' && cId) initialRenta = cId;
        if (cCode === 'ICA_RETE' && cId) initialIca = cId;
      }

      if (initialRenta) setSelectedRentaConceptId(initialRenta);
      if (initialIca) setSelectedIcaConceptId(initialIca);

      // Cargar perfil del tercero si hay identificador
      if (thirdPartyIdentifier) {
        try {
          const pRes = await api.getThirdPartyTaxProfile(companyId, thirdPartyIdentifier);
          setProfile(pRes.profile);
        } catch {
          setProfile(null);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Error cargando conceptos tributarios');
    } finally {
      setLoading(false);
    }
  }, [companyId, documentId, thirdPartyIdentifier]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  // Manejar cambio inmediato de concepto ReteFuente
  const handleRentaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setSelectedRentaConceptId(newId);
    void executeCalculation(newId || null, selectedIcaConceptId || null);
  };

  // Manejar cambio inmediato de concepto ReteICA
  const handleIcaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setSelectedIcaConceptId(newId);
    void executeCalculation(selectedRentaConceptId || null, newId || null);
  };

  // Abrir modal de sobrescritura manual
  const openOverrideModal = (det: TaxDeterminationDto) => {
    setOverrideTarget(det);
    const isIca = det.tax_type_code === 'ICA_RETE' || det.taxTypeCode === 'ICA_RETE';
    setOverrideRate(String(det.rate * (isIca ? 1000 : 100)));
    setOverrideAmount(String(det.amount));
    setOverrideReason(det.override_reason || det.overrideReason || '');
    setOverrideError(null);
  };

  // Guardar ajuste manual
  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !documentId || !overrideTarget) return;

    const taxTypeId = overrideTarget.tax_type_id || overrideTarget.taxTypeId;
    if (!taxTypeId) return;

    if (!overrideReason.trim() || overrideReason.trim().length < 5) {
      setOverrideError('Debe ingresar una justificación contable de al menos 5 caracteres.');
      return;
    }

    setOverrideSaving(true);
    setOverrideError(null);

    const isIca = overrideTarget.tax_type_code === 'ICA_RETE' || overrideTarget.taxTypeCode === 'ICA_RETE';
    const rateNum = Number(overrideRate) / (isIca ? 1000 : 100);
    const amountNum = Number(overrideAmount);

    try {
      const res = await api.overrideDocumentTax(companyId, documentId, {
        tax_type_id: taxTypeId,
        override_rate: isNaN(rateNum) ? 0 : rateNum,
        override_amount: isNaN(amountNum) ? 0 : amountNum,
        reason: overrideReason.trim(),
      });

      setDeterminations((prev) =>
        prev.map((d) => {
          const matchId = d.tax_type_id || d.taxTypeId;
          return matchId === taxTypeId ? { ...d, ...res.determination } : d;
        })
      );

      setOverrideTarget(null);
      if (onTaxesSaved) onTaxesSaved();
    } catch (err: any) {
      setOverrideError(err.message || 'Error aplicando ajuste manual');
    } finally {
      setOverrideSaving(false);
    }
  };

  // Totales
  const totalRetenciones = determinations.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const netoPagar = Math.max(0, totalDocument - totalRetenciones);

  return (
    <div className="p-4 rounded-card border border-line bg-surface space-y-4 text-ink">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-brand/10 text-brand">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-xs text-ink flex items-center gap-1.5">
              Liquidación Tributaria (Motor Parametrizable)
              <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                Normativa DIAN & Distrital
              </span>
            </h4>
            <p className="text-[11px] text-ink-muted">
              Seleccione el concepto de la operación; el motor determinará la regla y tarifa en tiempo real.
            </p>
          </div>
        </div>

        {/* Perfil RUT Trigger */}
        {thirdPartyIdentifier && (
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line hover:border-brand/40 bg-canvas/60 text-xs font-medium text-ink hover:text-brand transition shadow-sm"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-brand" />
            <span>{profile ? 'Ver / Editar Perfil RUT' : 'Configurar Perfil RUT'}</span>
            <ExternalLink className="w-3 h-3 text-ink-muted" />
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-600 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadInitialData()}
            className="text-xs underline hover:no-underline font-medium"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Resumen del Perfil Fiscal del Tercero */}
      {thirdPartyIdentifier && (
        <div className="p-3 rounded-lg border border-line bg-canvas/40 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink flex items-center gap-1.5">
              {profile?.person_type === 'NATURAL' ? (
                <User className="w-3.5 h-3.5 text-ink-muted" />
              ) : (
                <Building2 className="w-3.5 h-3.5 text-ink-muted" />
              )}
              {thirdPartyName || 'Tercero asociado'}{' '}
              <span className="font-mono text-ink-muted text-[11px]">({thirdPartyIdentifier})</span>
            </span>
            {profile ? (
              <span className="text-[11px] font-medium text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Perfil RUT activo
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowProfileModal(true)}
                className="text-[11px] font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1 underline"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Configurar Perfil RUT ahora
              </button>
            )}
          </div>

          {profile ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="px-2 py-0.5 rounded border border-line bg-surface text-ink font-medium">
                {profile.person_type === 'JURIDICA' ? 'Persona Jurídica' : 'Persona Natural'}
              </span>
              <span className="px-2 py-0.5 rounded border border-line bg-surface text-ink font-medium">
                {profile.tax_regime === 'SIMPLE' ? 'Régimen Simple (RST)' : `Régimen ${profile.tax_regime}`}
              </span>
              <span className="px-2 py-0.5 rounded border border-line bg-surface text-ink font-medium">
                {profile.is_declarant_renta ? 'Declarante de Renta' : 'No Declarante'}
              </span>
              <span className="px-2 py-0.5 rounded border border-line bg-surface text-ink font-medium">
                ICA: {profile.ica_municipality_code === '11001' ? 'Bogotá D.C. (11001)' : profile.ica_municipality_code}
              </span>
              {profile.responsibilities.map((r) => (
                <span
                  key={r.id}
                  className="px-2 py-0.5 rounded border border-brand/20 bg-brand/5 text-brand font-medium"
                >
                  {r.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-ink-muted">
              Sin perfil configurado: el motor no puede validar si aplica exención por RST o Autorretenedor.
            </p>
          )}
        </div>
      )}

      {/* Selectores de Conceptos con Cálculo Instantáneo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* ReteFuente Concept */}
        {(Object.keys(companyConfigs).length === 0 || companyConfigs['RENTA_RETE']) && (
          <div>
            <label className="block text-[11px] font-medium text-ink-muted mb-1">
              Concepto de Retención en la Fuente
            </label>
            <select
              value={selectedRentaConceptId}
              onChange={handleRentaChange}
              disabled={loading}
              className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs text-ink focus:outline-none focus:border-brand font-medium"
            >
              <option value="">-- No aplicar / Seleccionar concepto --</option>
              {rentaConcepts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ReteICA Concept */}
        {(Object.keys(companyConfigs).length === 0 || companyConfigs['ICA_RETE']) && (
          <div>
            <label className="block text-[11px] font-medium text-ink-muted mb-1">
              Concepto de Retención de ICA
            </label>
            <select
              value={selectedIcaConceptId}
              onChange={handleIcaChange}
              disabled={loading}
              className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs text-ink focus:outline-none focus:border-brand font-medium"
            >
              <option value="">-- No aplicar / Seleccionar concepto --</option>
              {icaConcepts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Barra de Estado y Base Gravable */}
      <div className="flex items-center justify-between pt-1">
        <div className="text-[11px] text-ink-muted">
          Base gravable neta:{' '}
          <span className="font-mono font-medium text-ink">{formatCurrency(defaultBase)}</span>
        </div>
        <div className="flex items-center gap-2">
          {calculating && (
            <span className="text-xs text-brand flex items-center gap-1 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Determinando...
            </span>
          )}
          <button
            type="button"
            onClick={() => void executeCalculation(selectedRentaConceptId || null, selectedIcaConceptId || null)}
            disabled={loading || calculating}
            className="px-3.5 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand/90 transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${calculating ? 'animate-spin' : ''}`} />
            <span>Recalcular</span>
          </button>
        </div>
      </div>

      {/* Tabla / Tarjetas de Determinaciones */}
      {determinations.length > 0 && (
        <div className="space-y-3 pt-3 border-t border-line">
          <span className="text-[11px] font-semibold text-ink uppercase tracking-wider block">
            Retenciones Liquidadas
          </span>

          <div className="space-y-2">
            {determinations.map((det, idx) => {
              const code = det.tax_type_code || det.taxTypeCode;
              const name = det.tax_type_name || det.taxTypeName || code;
              const conceptName = det.tax_concept_name || det.taxConceptName;
              const isIca = code === 'ICA_RETE';
              const rateDisplay = isIca
                ? `${(det.rate * 1000).toFixed(2)} ‰`
                : `${(det.rate * 100).toFixed(2)} %`;

              const statusConfig = {
                CALCULATED: { bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', label: 'Liquidado' },
                EXEMPT: { bg: 'bg-blue-500/10 text-blue-600 border-blue-500/20', label: 'Exento (0%)' },
                NOT_APPLICABLE: { bg: 'bg-gray-500/10 text-gray-500 border-gray-500/20', label: 'No Aplica (< Base Mínima)' },
                MISSING_PROFILE: { bg: 'bg-amber-500/10 text-amber-600 border-amber-500/20', label: 'Perfil Incompleto' },
                NO_MATCHING_RULE: { bg: 'bg-rose-500/10 text-rose-600 border-rose-500/20', label: 'Sin Regla Aplicable' },
                REQUIRES_REVIEW: { bg: 'bg-amber-500/10 text-amber-600 border-amber-500/20', label: 'Requiere Revisión' },
                MANUALLY_OVERRIDDEN: { bg: 'bg-purple-500/10 text-purple-600 border-purple-500/20', label: 'Ajustado Manualmente' },
              }[det.status] || { bg: 'bg-gray-500/10 text-gray-500 border-gray-500/20', label: det.status };

              return (
                <div
                  key={idx}
                  className="p-3.5 rounded-lg border border-line bg-canvas/60 space-y-2 hover:border-line/80 transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-ink">{name}</span>
                      {conceptName && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-surface border border-line text-ink-muted">
                          {conceptName}
                        </span>
                      )}
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${statusConfig.bg}`}>
                        {statusConfig.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="text-[11px] text-ink-muted block">
                          Base: {formatCurrency(det.taxable_base || det.taxableBase || defaultBase)} · Tarifa: {rateDisplay}
                        </span>
                        <span className="num font-bold text-xs text-ink">
                          {formatCurrency(det.amount)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => openOverrideModal(det)}
                        title="Modificar cálculo manualmente"
                        className="p-1.5 rounded-lg border border-line hover:border-purple-500/40 hover:bg-purple-500/5 text-ink-muted hover:text-purple-600 transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Explicación / Fundamento */}
                  {det.explanation && (
                    <div className="text-[11px] text-ink-muted bg-surface/80 p-2 rounded border border-line/60 flex items-start gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                      <span className="flex-1">{det.explanation}</span>
                    </div>
                  )}

                  {det.override_reason && (
                    <div className="text-[10px] text-purple-600 bg-purple-500/5 p-1.5 rounded border border-purple-500/20 font-medium">
                      Justificación contable: {det.override_reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Resumen Totalizador */}
          <div className="p-3.5 rounded-lg border border-line bg-surface flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div>
              <span className="text-[11px] text-ink-muted block">Total Retenciones Practicadas</span>
              <span className="num font-bold text-sm text-red-600">
                - {formatCurrency(totalRetenciones)}
              </span>
            </div>
            <div className="sm:text-right">
              <span className="text-[11px] text-ink-muted block">Neto Estimado a Girar / Cobrar</span>
              <span className="num font-bold text-base text-brand">
                {formatCurrency(netoPagar)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Modal Perfil RUT Tercero */}
      {showProfileModal && thirdPartyIdentifier && (
        <ThirdPartyTaxProfileModal
          isOpen={showProfileModal}
          onClose={() => setShowProfileModal(false)}
          companyId={companyId || ''}
          thirdPartyIdentifier={thirdPartyIdentifier}
          thirdPartyName={thirdPartyName}
          onProfileSaved={() => {
            void loadInitialData();
            if (selectedRentaConceptId || selectedIcaConceptId) {
              void executeCalculation(selectedRentaConceptId || null, selectedIcaConceptId || null);
            }
          }}
        />
      )}

      {/* Modal Ajuste Manual / Override */}
      {overrideTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface border border-line rounded-card shadow-2xl max-w-md w-full p-6 space-y-4 text-ink">
            <div className="flex items-center justify-between pb-2 border-b border-line">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-purple-600" />
                Modificar Cálculo Manualmente
              </h3>
              <button
                type="button"
                onClick={() => setOverrideTarget(null)}
                className="text-ink-muted hover:text-ink"
              >
                ✕
              </button>
            </div>

            <p className="text-[11px] text-ink-muted">
              Por trazabilidad contable, cualquier modificación manual sobre la tarifa o importe calculado requiere una justificación legal o soporte tributario auditado.
            </p>

            {overrideError && (
              <div className="p-2.5 rounded bg-red-500/10 border border-red-500/20 text-red-600 text-xs">
                {overrideError}
              </div>
            )}

            <form onSubmit={handleSaveOverride} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1">
                    Tarifa ({overrideTarget.tax_type_code === 'ICA_RETE' || overrideTarget.taxTypeCode === 'ICA_RETE' ? '‰' : '%'})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={overrideRate}
                    onChange={(e) => {
                      const newRate = e.target.value;
                      setOverrideRate(newRate);
                      const isIca = overrideTarget.tax_type_code === 'ICA_RETE' || overrideTarget.taxTypeCode === 'ICA_RETE';
                      const base = overrideTarget.taxable_base || overrideTarget.taxableBase || defaultBase;
                      const calculated = Math.round(base * (Number(newRate) / (isIca ? 1000 : 100)));
                      if (!isNaN(calculated)) setOverrideAmount(String(calculated));
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1">
                    Importe ($ COP)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={overrideAmount}
                    onChange={(e) => setOverrideAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Justificación Contable (Obligatorio)
                </label>
                <textarea
                  rows={3}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Ej: Proveedor presentó resolución de no sujeción radicada el 15 de marzo..."
                  className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs placeholder:text-ink-muted/50 focus:outline-none focus:border-brand"
                  required
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOverrideTarget(null)}
                  disabled={overrideSaving}
                  className="px-3 py-1.5 rounded-lg border border-line text-xs hover:bg-canvas"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={overrideSaving}
                  className="px-4 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {overrideSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Guardar Ajuste Auditado</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
