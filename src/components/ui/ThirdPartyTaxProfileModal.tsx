import React, { useEffect, useState } from 'react';
import { X, Building2, User, ShieldCheck, Check, Loader2, AlertCircle } from 'lucide-react';
import { api, type TaxResponsibilityDto, type ThirdPartyTaxProfileDto } from '../../api/client';

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
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  // Catálogo de responsabilidades
  const [catalogResponsibilities, setCatalogResponsibilities] = useState<TaxResponsibilityDto[]>([]);

  // Datos del perfil
  const [personType, setPersonType] = useState<'NATURAL' | 'JURIDICA'>('JURIDICA');
  const [taxRegime, setTaxRegime] = useState<'ORDINARIO' | 'SIMPLE' | 'ESPECIAL' | 'NO_RESPONSABLE'>('ORDINARIO');
  const [isDeclarantRenta, setIsDeclarantRenta] = useState<boolean>(true);
  const [economicActivityCode, setEconomicActivityCode] = useState<string>('');
  const [icaMunicipalityCode, setIcaMunicipalityCode] = useState<string>('11001');
  const [selectedRespIds, setSelectedRespIds] = useState<string[]>([]);
  const [resolvedThirdParty, setResolvedThirdParty] = useState<{ id: string; tax_id: string; legal_name: string } | null>(null);

  useEffect(() => {
    if (!isOpen || !companyId || !thirdPartyIdentifier) return;

    let active = true;
    const loadData = async () => {
      setLoading(true);
      setError(null);
      setSuccess(false);

      try {
        const [respRes, profileRes] = await Promise.all([
          api.getTaxResponsibilities(),
          api.getThirdPartyTaxProfile(companyId, thirdPartyIdentifier).catch(() => ({ profile: null, third_party: null } as any)),
        ]);

        if (!active) return;

        setCatalogResponsibilities(respRes.responsibilities);

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
          // Valores por defecto basados en NIT
          const isNitJuridica = /^[89]/.test(thirdPartyIdentifier.replace(/\D/g, ''));
          setPersonType(isNitJuridica ? 'JURIDICA' : 'NATURAL');
          setTaxRegime('ORDINARIO');
          setIsDeclarantRenta(true);
          setEconomicActivityCode('');
          setIcaMunicipalityCode('11001');
          setSelectedRespIds([]);
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Error cargando datos del perfil RUT');
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadData();
    return () => {
      active = false;
    };
  }, [isOpen, companyId, thirdPartyIdentifier]);

  if (!isOpen) return null;

  const toggleResponsibility = (id: string) => {
    setSelectedRespIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      await api.saveThirdPartyTaxProfile(companyId, thirdPartyIdentifier, {
        person_type: personType,
        tax_regime: taxRegime,
        economic_activity_code: economicActivityCode.trim() || null,
        ica_municipality_code: icaMunicipalityCode.trim() || '11001',
        is_declarant_renta: isDeclarantRenta,
        responsibility_ids: selectedRespIds,
      });

      setSuccess(true);
      if (onProfileSaved) onProfileSaved();
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Error al guardar el perfil tributario');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-surface border border-line rounded-card shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden text-ink">
        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between bg-canvas/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand/10 text-brand">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Perfil Tributario / RUT del Tercero</h3>
              <p className="text-[11px] text-ink-muted">
                NIT: <span className="font-mono font-medium text-ink">{resolvedThirdParty?.tax_id || thirdPartyIdentifier}</span>
                {thirdPartyName || resolvedThirdParty?.legal_name ? ` · ${thirdPartyName || resolvedThirdParty?.legal_name}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-canvas text-ink-muted hover:text-ink transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-600 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-ink-muted text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-brand" />
              <span>Cargando perfil tributario...</span>
            </div>
          ) : (
            <>
              {/* Tipo de Persona y Régimen */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1.5">
                    Tipo de Persona
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPersonType('JURIDICA')}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                        personType === 'JURIDICA'
                          ? 'border-brand bg-brand/10 text-brand font-semibold'
                          : 'border-line bg-canvas/40 text-ink-muted hover:border-ink/20'
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
                          : 'border-line bg-canvas/40 text-ink-muted hover:border-ink/20'
                      }`}
                    >
                      <User className="w-3.5 h-3.5" />
                      Natural
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1.5">
                    Régimen Tributario
                  </label>
                  <select
                    value={taxRegime}
                    onChange={(e) => setTaxRegime(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs text-ink focus:outline-none focus:border-brand"
                  >
                    <option value="ORDINARIO">Régimen Ordinario</option>
                    <option value="SIMPLE">Régimen Simple (RST - Art. 911 E.T.)</option>
                    <option value="ESPECIAL">Régimen Tributario Especial (RTE)</option>
                    <option value="NO_RESPONSABLE">No Responsable</option>
                  </select>
                </div>
              </div>

              {/* Declarante de Renta & Municipio ICA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1.5">
                    ¿Es Declarante de Renta?
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIsDeclarantRenta(true)}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition ${
                        isDeclarantRenta
                          ? 'border-brand bg-brand/10 text-brand font-semibold'
                          : 'border-line bg-canvas/40 text-ink-muted hover:border-ink/20'
                      }`}
                    >
                      Sí, Declarante
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsDeclarantRenta(false)}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition ${
                        !isDeclarantRenta
                          ? 'border-brand bg-brand/10 text-brand font-semibold'
                          : 'border-line bg-canvas/40 text-ink-muted hover:border-ink/20'
                      }`}
                    >
                      No Declarante
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1.5">
                    Municipio ReteICA (Divipola)
                  </label>
                  <select
                    value={icaMunicipalityCode}
                    onChange={(e) => setIcaMunicipalityCode(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs text-ink focus:outline-none focus:border-brand"
                  >
                    <option value="11001">11001 - Bogotá D.C.</option>
                    <option value="05001">05001 - Medellín</option>
                    <option value="76001">76001 - Cali</option>
                    <option value="08001">08001 - Barranquilla</option>
                    <option value="68001">68001 - Bucaramanga</option>
                  </select>
                </div>
              </div>

              {/* Actividad Económica CIIU */}
              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1.5">
                  Código de Actividad Económica Principal (CIIU)
                </label>
                <input
                  type="text"
                  placeholder="Ej: 6201, 4659, 7020..."
                  value={economicActivityCode}
                  onChange={(e) => setEconomicActivityCode(e.target.value)}
                  maxLength={10}
                  className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-xs text-ink placeholder:text-ink-muted/50 focus:outline-none focus:border-brand font-mono"
                />
              </div>

              {/* Responsabilidades Tributarias (RUT) */}
              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1.5">
                  Calidades y Responsabilidades Tributarias (RUT)
                </label>
                <div className="space-y-2 border border-line rounded-lg p-3 bg-canvas/30 max-h-48 overflow-y-auto">
                  {catalogResponsibilities.map((resp) => {
                    const checked = selectedRespIds.includes(resp.id);
                    return (
                      <label
                        key={resp.id}
                        onClick={() => toggleResponsibility(resp.id)}
                        className={`flex items-start gap-2.5 p-2 rounded-lg border cursor-pointer transition ${
                          checked
                            ? 'border-brand/40 bg-brand/5'
                            : 'border-transparent hover:bg-canvas'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {}} // handled by onClick
                          className="mt-0.5 rounded border-line text-brand focus:ring-brand"
                        />
                        <div className="flex-1 text-xs">
                          <span className="font-medium text-ink block">{resp.name}</span>
                          {resp.description && (
                            <span className="text-[10px] text-ink-muted block mt-0.5">
                              {resp.description}
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Footer Actions */}
          <div className="pt-4 border-t border-line flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-line text-xs font-medium text-ink hover:bg-canvas transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || saving}
              className="px-4 py-2 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand/90 transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Guardando...</span>
                </>
              ) : success ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                  <span>¡Guardado!</span>
                </>
              ) : (
                <span>Guardar Perfil RUT</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
