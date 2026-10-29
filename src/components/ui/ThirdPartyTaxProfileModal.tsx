import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  Building2,
  User,
  ShieldCheck,
  Check,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  api,
  type TaxResponsibilityDto,
  type ThirdPartyTaxProfileDto,
  type ThirdPartyTaxRuleDto,
  type TaxConceptDto,
} from '../../api/client';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  thirdPartyIdentifier: string; // NIT o UUID
  thirdPartyName?: string;
  onProfileSaved?: () => void;
}

export const ThirdPartyTaxProfileModal: React.FC<Props> = ({
  isOpen,
  onClose,
  companyId,
  thirdPartyIdentifier,
  thirdPartyName,
  onProfileSaved,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'rules'>('profile');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Catálogo de responsabilidades
  const [catalogResponsibilities, setCatalogResponsibilities] = useState<TaxResponsibilityDto[]>([]);
  const [concepts, setConcepts] = useState<TaxConceptDto[]>([]);
  const [taxRules, setTaxRules] = useState<ThirdPartyTaxRuleDto[]>([]);

  // Datos del perfil
  const [personType, setPersonType] = useState<'NATURAL' | 'JURIDICA'>('JURIDICA');
  const [taxRegime, setTaxRegime] = useState<'ORDINARIO' | 'SIMPLE' | 'ESPECIAL' | 'NO_RESPONSABLE'>('ORDINARIO');
  const [isDeclarantRenta, setIsDeclarantRenta] = useState<boolean>(true);
  const [economicActivityCode, setEconomicActivityCode] = useState<string>('');
  const [icaMunicipalityCode, setIcaMunicipalityCode] = useState<string>('11001');
  const [selectedRespIds, setSelectedRespIds] = useState<string[]>([]);
  const [resolvedThirdParty, setResolvedThirdParty] = useState<{ id: string; tax_id: string; legal_name: string } | null>(null);

  // Formulario para nueva regla específica de este tercero
  const [showAddRule, setShowAddRule] = useState<boolean>(false);
  const [ruleTaxTypeId, setRuleTaxTypeId] = useState<string>('');
  const [ruleOpType, setRuleOpType] = useState<'ISSUED' | 'RECEIVED' | 'ALL'>('ALL');
  const [ruleDocCat] = useState<'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'SUPPORT' | 'ALL'>('ALL');
  const [ruleIsExempt, setRuleIsExempt] = useState<boolean>(false);
  const [ruleCustomRate, setRuleCustomRate] = useState<string>('');
  const [ruleRateBasis, setRuleRateBasis] = useState<'PERCENT' | 'PER_MILLE'>('PERCENT');
  const [ruleConceptId] = useState<string>('');
  const [ruleAccount, setRuleAccount] = useState<string>('');
  const [ruleNotes, setRuleNotes] = useState<string>('');

  const loadData = useCallback(async () => {
    if (!isOpen || !companyId || !thirdPartyIdentifier) return;
    setLoading(true);
    setError(null);

    try {
      const [respRes, profileRes, conceptsRes, rulesRes] = await Promise.all([
        api.getTaxResponsibilities(),
        api.getThirdPartyTaxProfile(companyId, thirdPartyIdentifier).catch(() => ({ profile: null, third_party: null } as any)),
        api.getTaxConcepts(),
        api.getThirdPartyTaxRules(companyId, thirdPartyIdentifier).catch(() => ({ rules: [] })),
      ]);

      setCatalogResponsibilities(respRes.responsibilities);
      setConcepts(conceptsRes.concepts);
      setTaxRules(rulesRes.rules);

      if (conceptsRes.concepts.length > 0 && !ruleTaxTypeId) {
        setRuleTaxTypeId(conceptsRes.concepts[0].tax_type_id);
      }

      const data = profileRes as { profile: ThirdPartyTaxProfileDto | null; third_party?: { id: string; tax_id: string; legal_name: string } | null };
      if (data.third_party) {
        setResolvedThirdParty(data.third_party);
      }

      if (data.profile) {
        const p = data.profile;
        setPersonType(p.person_type);
        setTaxRegime(p.tax_regime);
        setIsDeclarantRenta(p.is_declarant_renta);
        setEconomicActivityCode(p.economic_activity_code ?? '');
        setIcaMunicipalityCode(p.ica_municipality_code ?? '11001');
        setSelectedRespIds(p.responsibilities.map((r) => r.id));
      } else {
        const isNitJuridica = /^[89]/.test(thirdPartyIdentifier.replace(/\D/g, ''));
        setPersonType(isNitJuridica ? 'JURIDICA' : 'NATURAL');
        setTaxRegime('ORDINARIO');
        setIsDeclarantRenta(true);
        setEconomicActivityCode('');
        setIcaMunicipalityCode('11001');
        setSelectedRespIds([]);
      }
    } catch (err: any) {
      setError(err.message || 'Error cargando datos del tercero.');
    } finally {
      setLoading(false);
    }
  }, [isOpen, companyId, thirdPartyIdentifier, ruleTaxTypeId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleResp = (id: string) => {
    setSelectedRespIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !thirdPartyIdentifier) return;

    setSaving(true);
    setError(null);

    try {
      await api.saveThirdPartyTaxProfile(companyId, thirdPartyIdentifier, {
        person_type: personType,
        tax_regime: taxRegime,
        economic_activity_code: economicActivityCode.trim() || undefined,
        ica_municipality_code: icaMunicipalityCode.trim() || '11001',
        is_declarant_renta: isDeclarantRenta,
        responsibility_ids: selectedRespIds,
      });

      if (onProfileSaved) onProfileSaved();
    } catch (err: any) {
      setError(err.message || 'Error al guardar el perfil tributario.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !thirdPartyIdentifier || !ruleTaxTypeId) return;

    setSaving(true);
    setError(null);
    try {
      const rateNum = !ruleIsExempt && ruleCustomRate
        ? parseFloat(ruleCustomRate) / (ruleRateBasis === 'PER_MILLE' ? 1000 : 100)
        : null;

      await api.saveThirdPartyTaxRule(companyId, thirdPartyIdentifier, {
        tax_type_id: ruleTaxTypeId,
        operation_type: ruleOpType,
        document_category: ruleDocCat,
        is_exempt: ruleIsExempt,
        custom_rate: rateNum,
        rate_basis: ruleRateBasis,
        custom_concept_id: ruleConceptId || null,
        accounting_account: ruleAccount.trim() || null,
        notes: ruleNotes.trim() || null,
      });

      setShowAddRule(false);
      setRuleCustomRate('');
      setRuleAccount('');
      setRuleNotes('');
      setRuleIsExempt(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Error guardando regla del tercero.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('¿Eliminar esta regla específica del tercero?')) return;
    try {
      await api.deleteThirdPartyTaxRule(companyId, thirdPartyIdentifier, id);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Error eliminando regla.');
    }
  };

  if (!isOpen) return null;

  const displayName = resolvedThirdParty?.legal_name || thirdPartyName || 'Tercero';
  const displayNit = resolvedThirdParty?.tax_id || thirdPartyIdentifier;

  // Extraer tipos de impuesto únicos para el select
  const uniqueTaxTypes = Array.from(
    new Map(concepts.map((c) => [c.tax_type_id, { id: c.tax_type_id, name: c.tax_type_name, code: c.tax_type_code }])).values()
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-surface border border-line rounded-card shadow-2xl max-w-2xl w-full p-6 space-y-4 text-ink max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-line">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-brand" />
              <h2 className="font-semibold text-base text-ink">Perfil Tributario & Reglas</h2>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              <span className="font-medium text-ink">{displayName}</span> · NIT:{' '}
              <span className="font-mono text-ink font-medium">{displayNit}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-ink-muted hover:text-ink hover:bg-canvas transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pestañas del Modal */}
        <div className="flex items-center gap-2 border-b border-line text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`pb-2 px-1 border-b-2 transition ${
              activeTab === 'profile'
                ? 'border-brand text-brand font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            Datos RUT General
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rules')}
            className={`pb-2 px-1 border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'rules'
                ? 'border-brand text-brand font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <span>Reglas Específicas por Operación</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-brand/10 text-brand font-bold">
              {taxRules.length}
            </span>
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-xs text-ink-muted gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-brand" />
            <span>Consultando datos...</span>
          </div>
        ) : activeTab === 'profile' ? (
          <form onSubmit={handleSaveProfile} className="space-y-4">
            {/* Tipo de Persona & Régimen */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  Tipo de Persona
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPersonType('JURIDICA')}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                      personType === 'JURIDICA'
                        ? 'border-brand bg-brand/10 text-brand font-semibold'
                        : 'border-line bg-canvas text-ink hover:bg-surface'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    Jurídica
                  </button>
                  <button
                    type="button"
                    onClick={() => setPersonType('NATURAL')}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                      personType === 'NATURAL'
                        ? 'border-brand bg-brand/10 text-brand font-semibold'
                        : 'border-line bg-canvas text-ink hover:bg-surface'
                    }`}
                  >
                    <User className="w-3.5 h-3.5" />
                    Natural
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  Régimen Tributario
                </label>
                <select
                  value={taxRegime}
                  onChange={(e) => setTaxRegime(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs text-ink focus:outline-none focus:border-brand"
                >
                  <option value="ORDINARIO">Régimen Ordinario</option>
                  <option value="SIMPLE">Régimen Simple (SIMPLE)</option>
                  <option value="ESPECIAL">Régimen Tributario Especial (RTE)</option>
                  <option value="NO_RESPONSABLE">No Responsable</option>
                </select>
              </div>
            </div>

            {/* Declarante de Renta & Municipio */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  ¿Declarante de Renta?
                </label>
                <select
                  value={isDeclarantRenta ? 'true' : 'false'}
                  onChange={(e) => setIsDeclarantRenta(e.target.value === 'true')}
                  className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs text-ink focus:outline-none focus:border-brand"
                >
                  <option value="true">Sí (Tarifas declarante)</option>
                  <option value="false">No (Tarifas no declarante)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  Actividad Económica (CIIU)
                </label>
                <input
                  type="text"
                  maxLength={10}
                  value={economicActivityCode}
                  onChange={(e) => setEconomicActivityCode(e.target.value)}
                  placeholder="Ej. 6201"
                  className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs text-ink focus:outline-none focus:border-brand font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  Municipio ICA (Divipola)
                </label>
                <input
                  type="text"
                  maxLength={10}
                  value={icaMunicipalityCode}
                  onChange={(e) => setIcaMunicipalityCode(e.target.value)}
                  placeholder="11001 (Bogotá)"
                  className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs text-ink focus:outline-none focus:border-brand font-mono"
                />
              </div>
            </div>

            {/* Responsabilidades DIAN */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-ink">
                Calidades y Responsabilidades Tributarias (RUT)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 rounded-lg border border-line bg-canvas/50">
                {catalogResponsibilities.map((resp) => {
                  const checked = selectedRespIds.includes(resp.id);
                  return (
                    <div
                      key={resp.id}
                      onClick={() => toggleResp(resp.id)}
                      className={`p-2.5 rounded-md border flex items-start gap-2.5 cursor-pointer transition select-none ${
                        checked ? 'border-brand/40 bg-brand/5' : 'border-transparent hover:bg-canvas'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleResp(resp.id);
                        }}
                        className="mt-0.5 rounded border-line text-brand focus:ring-brand cursor-pointer"
                      />
                      <div className="flex-1 text-xs">
                        <span className="font-medium text-ink block">{resp.name}</span>
                        {resp.description && (
                          <span className="text-[10px] text-ink-muted block mt-0.5">
                            {resp.description}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-line flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-line text-xs font-medium text-ink hover:bg-canvas transition"
              >
                Cerrar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand/90 transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Guardar Perfil RUT</span>
              </button>
            </div>
          </form>
        ) : (
          /* Pestaña: Reglas específicas del tercero */
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2">
              <p className="text-xs text-ink-muted">
                Configura tarifas acordadas, conceptos automáticos o exenciones para este cliente/proveedor.
              </p>
              <button
                type="button"
                onClick={() => setShowAddRule(true)}
                className="px-2.5 py-1.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90 transition flex items-center gap-1 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar Regla
              </button>
            </div>

            {taxRules.length === 0 ? (
              <div className="py-8 text-center text-xs text-ink-muted border border-line rounded-lg bg-canvas/30">
                Este tercero no tiene reglas tributarias específicas. Se aplican las reglas globales de la empresa.
              </div>
            ) : (
              <div className="divide-y divide-line border border-line rounded-lg overflow-hidden">
                {taxRules.map((rule) => {
                  const rateDisplay = rule.is_exempt
                    ? 'Exento (0%)'
                    : rule.custom_rate !== null
                    ? rule.rate_basis === 'PER_MILLE'
                      ? `${(rule.custom_rate * 1000).toFixed(2)} ‰`
                      : `${(rule.custom_rate * 100).toFixed(2)} %`
                    : 'Tarifa Estándar';

                  const opLabel =
                    rule.operation_type === 'ISSUED'
                      ? 'Ventas'
                      : rule.operation_type === 'RECEIVED'
                      ? 'Compras'
                      : 'Todas las operaciones';

                  return (
                    <div
                      key={rule.id}
                      className="p-3 bg-surface flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink">{rule.tax_type_name}</span>
                          <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand text-[10px] font-mono">
                            {rule.tax_type_code}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-canvas border border-line text-ink-muted">
                            {opLabel}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                              rule.is_exempt
                                ? 'bg-blue-500/10 text-blue-600'
                                : 'bg-purple-500/10 text-purple-600'
                            }`}
                          >
                            {rateDisplay}
                          </span>
                          {rule.accounting_account && (
                            <span className="px-2 py-0.5 rounded bg-surface border border-line text-[10px] font-mono text-ink font-semibold">
                              Cuenta Siigo: {rule.accounting_account}
                            </span>
                          )}
                        </div>
                        {rule.notes && (
                          <div className="text-[11px] text-ink-muted">{rule.notes}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteRule(rule.id)}
                        className="p-1 text-ink-muted hover:text-rose-600 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Modal para agregar regla específica al tercero */}
            {showAddRule && (
              <form onSubmit={handleSaveRule} className="p-4 rounded-lg border border-brand/30 bg-brand/5 space-y-3 text-xs">
                <span className="font-semibold text-ink block">Nueva Regla para este Tercero</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-ink-muted mb-1">Impuesto *</label>
                    <select
                      value={ruleTaxTypeId}
                      onChange={(e) => setRuleTaxTypeId(e.target.value)}
                      required
                      className="w-full px-2.5 py-1.5 rounded border border-line bg-canvas text-ink"
                    >
                      {uniqueTaxTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-ink-muted mb-1">Operación *</label>
                    <select
                      value={ruleOpType}
                      onChange={(e) => setRuleOpType(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 rounded border border-line bg-canvas text-ink"
                    >
                      <option value="ALL">Todas las operaciones</option>
                      <option value="ISSUED">Solo Ventas (Emitidas)</option>
                      <option value="RECEIVED">Solo Compras (Recibidas)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ruleIsExempt}
                      onChange={(e) => setRuleIsExempt(e.target.checked)}
                      className="rounded border-line text-brand"
                    />
                    <span>Exento de este impuesto</span>
                  </label>

                  {!ruleIsExempt && (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={ruleCustomRate}
                        onChange={(e) => setRuleCustomRate(e.target.value)}
                        placeholder="Tarifa especial (ej. 0.55, 1.0, 9.66)"
                        className="px-2.5 py-1 rounded border border-line bg-canvas text-ink flex-1"
                      />
                      <select
                        value={ruleRateBasis}
                        onChange={(e) => setRuleRateBasis(e.target.value as any)}
                        className="px-2 py-1 rounded border border-line bg-canvas text-ink"
                      >
                        <option value="PERCENT">%</option>
                        <option value="PER_MILLE">‰</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-ink-muted mb-1">
                      Cuenta Contable Siigo (Opcional)
                    </label>
                    <input
                      type="text"
                      value={ruleAccount}
                      onChange={(e) => setRuleAccount(e.target.value)}
                      placeholder="Ej. 23657003"
                      className="w-full px-2.5 py-1.5 rounded border border-line bg-canvas text-ink font-mono font-medium"
                    />
                    <span className="text-[10px] text-ink-muted block mt-0.5">
                      Código contable donde se registrará la retención en Siigo
                    </span>
                  </div>
                  <div>
                    <label className="block text-[11px] text-ink-muted mb-1">Notas / Justificación</label>
                    <input
                      type="text"
                      value={ruleNotes}
                      onChange={(e) => setRuleNotes(e.target.value)}
                      placeholder="Ej. Tarifa acordada por contrato No 123"
                      className="w-full px-2.5 py-1.5 rounded border border-line bg-canvas text-ink"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddRule(false)}
                    className="px-3 py-1 rounded border border-line text-ink hover:bg-canvas"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-3 py-1 rounded bg-brand text-white font-medium hover:bg-brand/90"
                  >
                    Guardar
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
