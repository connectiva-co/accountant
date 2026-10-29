import React, { useEffect, useState, useCallback } from 'react';
import {
  Percent,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  Edit2,
} from 'lucide-react';
import {
  api,
  type CompanyTaxConfigurationDto,
  type TaxConceptDto,
} from '../../api/client';
import { Panel } from '../ui/Panel';

interface TaxTypeOption {
  id: string;
  code: string;
  name: string;
  category: string;
}

export const TaxSettingsPanel: React.FC<{ companyId: string | null }> = ({ companyId }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [taxTypes, setTaxTypes] = useState<TaxTypeOption[]>([]);
  const [concepts, setConcepts] = useState<TaxConceptDto[]>([]);
  const [configurations, setConfigurations] = useState<CompanyTaxConfigurationDto[]>([]);

  // Modal / Form para agregar o editar regla por empresa
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTaxTypeId, setFormTaxTypeId] = useState<string>('');
  const [formOperationType, setFormOperationType] = useState<'ISSUED' | 'RECEIVED' | 'ALL'>('ALL');
  const [formDocCategory] = useState<'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'SUPPORT' | 'ALL'>('ALL');
  const [formRate, setFormRate] = useState<string>('');
  const [formRateBasis, setFormRateBasis] = useState<'PERCENT' | 'PER_MILLE'>('PERCENT');
  const [formConceptId, setFormConceptId] = useState<string>('');
  const [formMinBase, setFormMinBase] = useState<string>('0');
  const [formLabel, setFormLabel] = useState<string>('');
  const [formNote, setFormNote] = useState<string>('');

  const loadData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [confRes, concRes] = await Promise.all([
        api.getCompanyTaxConfigurations(companyId),
        api.getTaxConcepts(),
      ]);
      setConfigurations(confRes.configurations);
      setConcepts(concRes.concepts);

      // Extraer tipos de impuestos únicos a partir de los conceptos o catálogo
      const typesMap = new Map<string, TaxTypeOption>();
      for (const c of concRes.concepts) {
        if (!typesMap.has(c.tax_type_id)) {
          typesMap.set(c.tax_type_id, {
            id: c.tax_type_id,
            code: c.tax_type_code,
            name: c.tax_type_name,
            category: 'WITHHOLDING',
          });
        }
      }
      setTaxTypes(Array.from(typesMap.values()));
      if (typesMap.size > 0 && !formTaxTypeId) {
        setFormTaxTypeId(Array.from(typesMap.values())[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Error cargando configuración de impuestos.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleToggleEnable = async (conf: CompanyTaxConfigurationDto) => {
    if (!companyId) return;
    try {
      await api.saveCompanyTaxConfiguration(companyId, {
        tax_type_id: conf.tax_type_id,
        operation_type: conf.operation_type,
        document_category: conf.document_category,
        is_enabled: !conf.is_enabled,
        default_rate: conf.default_rate,
        rate_basis: conf.rate_basis,
        default_concept_id: conf.default_concept_id,
        min_base_cop: conf.min_base_cop,
        metadata: conf.metadata,
      });
      await loadData();
    } catch (err: any) {
      setError(err.message || 'No se pudo actualizar el estado.');
    }
  };

  const handleOpenEdit = (conf: CompanyTaxConfigurationDto) => {
    setEditingId(conf.id);
    setFormTaxTypeId(conf.tax_type_id);
    setFormOperationType(conf.operation_type);
    setFormRateBasis(conf.rate_basis);
    setFormRate(
      conf.default_rate !== null
        ? String(conf.rate_basis === 'PER_MILLE' ? conf.default_rate * 1000 : conf.default_rate * 100)
        : ''
    );
    setFormConceptId(conf.default_concept_id ?? '');
    setFormMinBase(String(conf.min_base_cop ?? 0));
    setFormLabel(conf.metadata?.label ?? '');
    setFormNote(conf.metadata?.note ?? '');
    setShowAddModal(true);
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    if (taxTypes.length > 0) setFormTaxTypeId(taxTypes[0].id);
    setFormOperationType('ALL');
    setFormRateBasis('PERCENT');
    setFormRate('');
    setFormConceptId('');
    setFormMinBase('0');
    setFormLabel('');
    setFormNote('');
    setShowAddModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!companyId) return;
    if (!confirm('¿Seguro que deseas eliminar esta regla impositiva por defecto?')) return;
    try {
      await api.deleteCompanyTaxConfiguration(companyId, id);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'No se pudo eliminar la regla.');
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !formTaxTypeId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const rateNum = formRate ? parseFloat(formRate) / (formRateBasis === 'PER_MILLE' ? 1000 : 100) : null;
    const minBaseNum = formMinBase ? parseFloat(formMinBase) : 0;

    try {
      await api.saveCompanyTaxConfiguration(companyId, {
        tax_type_id: formTaxTypeId,
        operation_type: formOperationType,
        document_category: formDocCategory,
        is_enabled: true,
        default_rate: rateNum,
        rate_basis: formRateBasis,
        default_concept_id: formConceptId || null,
        min_base_cop: minBaseNum,
        metadata: {
          label: formLabel.trim() || undefined,
          note: formNote.trim() || undefined,
        },
      });
      setSuccess('Regla guardada correctamente.');
      setShowAddModal(false);
      setFormRate('');
      setFormLabel('');
      setFormNote('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Error guardando regla impositiva.');
    } finally {
      setSaving(false);
    }
  };

  if (!companyId) {
    return (
      <Panel className="p-6 text-center text-ink-muted">
        Selecciona una empresa para gestionar la parametrización de impuestos.
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <Panel className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
          <div>
            <h3 className="font-semibold text-sm text-ink flex items-center gap-2">
              <Percent className="w-4 h-4 text-brand" />
              Impuestos y Retenciones por Empresa
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              Define qué impuestos se calculan, sus tarifas por defecto y si aplican a ventas, compras o notas crédito.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="px-3 py-1.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90 transition flex items-center gap-1.5 self-start sm:self-auto shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Nueva Regla Impositiva
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {loading ? (
          <div className="py-8 flex items-center justify-center text-xs text-ink-muted gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-brand" />
            Cargando parametrización...
          </div>
        ) : configurations.length === 0 ? (
          <div className="py-8 text-center text-xs text-ink-muted">
            No hay impuestos o retenciones parametrizadas para esta empresa. Haz clic en "Nueva Regla Impositiva".
          </div>
        ) : (
          <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {configurations.map((conf) => {
              const rateDisplay =
                conf.default_rate !== null
                  ? conf.rate_basis === 'PER_MILLE'
                    ? `${(conf.default_rate * 1000).toFixed(2)} ‰`
                    : `${(conf.default_rate * 100).toFixed(2)} %`
                  : 'Según Reglas RUT';

              const opLabel =
                conf.operation_type === 'ISSUED'
                  ? 'Ventas (Emitidas)'
                  : conf.operation_type === 'RECEIVED'
                  ? 'Compras (Recibidas)'
                  : 'Todas las operaciones';

              return (
                <div
                  key={conf.id}
                  className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors ${
                    conf.is_enabled ? 'bg-surface' : 'bg-canvas/60 opacity-60'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink">{conf.tax_type_name}</span>
                      <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand text-[10px] font-mono font-medium">
                        {conf.tax_type_code}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-canvas border border-line font-medium text-ink-muted">
                        {opLabel}
                      </span>
                      {conf.metadata?.label && (
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 text-[10px] font-medium border border-amber-500/20">
                          {conf.metadata.label}
                        </span>
                      )}
                    </div>
                    <div className="text-ink-muted text-[11px] flex items-center gap-3">
                      <span>
                        Tarifa:{' '}
                        <strong className="text-ink font-mono">{rateDisplay}</strong>
                      </span>
                      {conf.default_concept_name && (
                        <span>
                          Concepto por defecto:{' '}
                          <span className="text-ink">{conf.default_concept_name}</span>
                        </span>
                      )}
                      {conf.min_base_cop > 0 && (
                        <span>
                          Base mínima:{' '}
                          <span className="font-mono text-ink">${conf.min_base_cop.toLocaleString('es-CO')}</span>
                        </span>
                      )}
                    </div>
                    {conf.metadata?.note && (
                      <div className="text-[10px] text-ink-muted italic">
                        {conf.metadata.note}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => void handleToggleEnable(conf)}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                        conf.is_enabled
                          ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                          : 'bg-gray-500/10 text-gray-500 hover:bg-gray-500/20'
                      }`}
                    >
                      {conf.is_enabled ? 'Habilitado' : 'Deshabilitado'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(conf)}
                      className="p-1.5 text-ink-muted hover:text-brand transition rounded hover:bg-canvas"
                      title="Editar regla"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(conf.id)}
                      className="p-1.5 text-ink-muted hover:text-rose-600 transition rounded hover:bg-canvas"
                      title="Eliminar regla"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Modal Nueva Regla Impositiva */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface border border-line rounded-card shadow-2xl max-w-lg w-full p-6 space-y-4 text-ink">
            <div className="flex items-center justify-between pb-2 border-b border-line">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                {editingId ? <Edit2 className="w-4 h-4 text-brand" /> : <Plus className="w-4 h-4 text-brand" />}
                {editingId ? 'Editar Regla Impositiva' : 'Nueva Regla de Impuesto para la Empresa'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-ink-muted hover:text-ink text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRule} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1">
                    Tipo de Impuesto *
                  </label>
                  <select
                    value={formTaxTypeId}
                    onChange={(e) => setFormTaxTypeId(e.target.value)}
                    required
                    className="w-full px-2.5 py-1.5 rounded border border-line bg-canvas text-ink"
                  >
                    {taxTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1">
                    Aplica a Operación
                  </label>
                  <select
                    value={formOperationType}
                    onChange={(e) => setFormOperationType(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 rounded border border-line bg-canvas text-ink"
                  >
                    <option value="ALL">Todas (Ventas y Compras)</option>
                    <option value="ISSUED">Solo Ventas (Emitidas)</option>
                    <option value="RECEIVED">Solo Compras (Recibidas)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-ink-muted mb-1">
                    Tarifa por defecto
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={formRate}
                      onChange={(e) => setFormRate(e.target.value)}
                      placeholder="Ej. 0.55 para autorrenta, 2.5, 11.04"
                      className="w-full pl-2.5 pr-14 py-1.5 rounded border border-line bg-canvas text-ink"
                    />
                    <div className="absolute inset-y-0 right-1 flex items-center">
                      <select
                        value={formRateBasis}
                        onChange={(e) => setFormRateBasis(e.target.value as any)}
                        className="h-6 text-[10px] bg-surface border border-line rounded px-1 text-ink focus:outline-none"
                      >
                        <option value="PERCENT">%</option>
                        <option value="PER_MILLE">‰ (por mil)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1">
                    Base mínima COP
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formMinBase}
                    onChange={(e) => setFormMinBase(e.target.value)}
                    placeholder="0"
                    className="w-full px-2.5 py-1.5 rounded border border-line bg-canvas text-ink"
                  >
                  </input>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Concepto Tributario por Defecto (Opcional)
                </label>
                <select
                  value={formConceptId}
                  onChange={(e) => setFormConceptId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-line bg-canvas text-ink"
                >
                  <option value="">-- Sin concepto fijo / Determinado en factura --</option>
                  {concepts
                    .filter((c) => !formTaxTypeId || c.tax_type_id === formTaxTypeId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1">
                    Etiqueta Descriptiva
                  </label>
                  <input
                    type="text"
                    value={formLabel}
                    onChange={(e) => setFormLabel(e.target.value)}
                    placeholder="Ej. Autorrenta Especial Ventas"
                    className="w-full px-2.5 py-1.5 rounded border border-line bg-canvas text-ink"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1">
                    Nota o Referencia
                  </label>
                  <input
                    type="text"
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    placeholder="Ej. Decreto 2201 / Acuerdo empresa"
                    className="w-full px-2.5 py-1.5 rounded border border-line bg-canvas text-ink"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded border border-line text-xs text-ink hover:bg-canvas transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !formTaxTypeId}
                  className="px-4 py-1.5 rounded bg-brand text-white text-xs font-medium hover:bg-brand/90 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Guardar Regla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
