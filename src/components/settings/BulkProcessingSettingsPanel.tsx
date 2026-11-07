import React, { useEffect, useState } from 'react';
import { api, type AccountingAccountDto } from '../../api/client';
import { SectionHeader } from '../ui/SectionHeader';
import { Panel } from '../ui/Panel';
import { Loader2, Check, AlertCircle, Save } from 'lucide-react';

interface Props {
  companyId: string | null;
}

interface BulkSettings {
  validate_third_parties: boolean;
  unconfigured_taxes_treatment: 'REQUIRE_REVIEW' | 'ADD_TO_EXPENSE' | 'DEFAULT_ACCOUNT';
  show_simulation: boolean;
  allow_partial_sync: boolean;
  default_expense_account: string | null;
  default_payable_account: string | null;
  default_iva_account: string | null;
  default_purchase_voucher_type_id: number | null;
  tax_treatment_rules: Record<
    string,
    {
      treatment: 'ADD_TO_EXPENSE' | 'CUSTOM_ACCOUNT' | 'REQUIRE_REVIEW';
      account?: string | null;
    }
  >;
}

const DEFAULT_SETTINGS: BulkSettings = {
  validate_third_parties: true,
  unconfigured_taxes_treatment: 'REQUIRE_REVIEW',
  show_simulation: true,
  allow_partial_sync: true,
  default_expense_account: null,
  default_payable_account: '22050501',
  default_iva_account: '24081501',
  default_purchase_voucher_type_id: 43000,
  tax_treatment_rules: {
    INC: { treatment: 'ADD_TO_EXPENSE', account: null },
    IBUA: { treatment: 'ADD_TO_EXPENSE', account: null },
    INC_BOLSAS: { treatment: 'ADD_TO_EXPENSE', account: null },
  },
};

export const BulkProcessingSettingsPanel: React.FC<Props> = ({ companyId }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountingAccountDto[]>([]);
  const [siigoDocTypes, setSiigoDocTypes] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [settings, setSettings] = useState<BulkSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [settRes, accRes, siigoTypesRes] = await Promise.all([
          api.getSettings(companyId ?? undefined).catch(() => ({ rows: [], effective: {} })),
          companyId ? api.getAccountingAccounts(companyId).catch(() => ({ accounts: [] })) : Promise.resolve({ accounts: [] }),
          companyId ? api.getSiigoDocumentTypes(companyId, { type: 'CC' }).catch(() => ({ document_types: [] })) : Promise.resolve({ document_types: [] }),
        ]);

        if (cancelled) return;
        setAccounts(accRes.accounts);
        setSiigoDocTypes(siigoTypesRes.document_types);

        const currentSettings: BulkSettings = { ...DEFAULT_SETTINGS };
        for (const row of settRes.rows) {
          if (row.scope === 'bulk_processing') {
            (currentSettings as any)[row.key] = row.value;
          }
        }
        setSettings(currentSettings);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Error cargando configuración');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setSaving(true);
    setError(null);
    setSavedSuccess(false);

    try {
      const keys: Array<keyof BulkSettings> = [
        'validate_third_parties',
        'unconfigured_taxes_treatment',
        'show_simulation',
        'allow_partial_sync',
        'default_expense_account',
        'default_payable_account',
        'default_iva_account',
        'default_purchase_voucher_type_id',
        'tax_treatment_rules',
      ];

      for (const key of keys) {
        await api.saveSetting({
          scope: 'bulk_processing',
          key,
          value: settings[key],
          companyId,
        });
      }

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Error guardando parámetros de procesamiento masivo');
    } finally {
      setSaving(false);
    }
  };

  const updateRule = (taxCode: string, field: 'treatment' | 'account', val: any) => {
    setSettings((prev) => {
      const current = prev.tax_treatment_rules[taxCode] || { treatment: 'ADD_TO_EXPENSE', account: null };
      return {
        ...prev,
        tax_treatment_rules: {
          ...prev.tax_treatment_rules,
          [taxCode]: {
            ...current,
            [field]: val,
          },
        },
      };
    });
  };

  if (loading) {
    return (
      <Panel className="p-5">
        <p className="text-xs text-ink-muted flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Cargando configuración de procesamiento masivo...
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <SectionHeader
        title="Procesamiento masivo"
        description="Reglas globales de validación, simulación y contabilización hacia Siigo para la empresa activa"
      />

      <form onSubmit={handleSave} className="mt-4 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 4 Controles Prioritarios */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 divide-y md:divide-y-0 md:divide-x divide-line">
          <div className="space-y-4">
            {/* 1. Validar terceros antes del envío masivo */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-xs font-semibold text-ink block">
                  Validar terceros antes del envío masivo
                </label>
                <p className="text-[11px] text-ink-muted">
                  Exige que cada proveedor tenga perfil RUT configurado antes de contabilizar.
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.validate_third_parties}
                onChange={(e) => setSettings({ ...settings, validate_third_parties: e.target.checked })}
                className="h-4 w-4 rounded border-line text-brand focus:ring-brand/30"
              />
            </div>

            {/* 2. Tratamiento de impuestos sin parametrizar */}
            <div>
              <label className="text-xs font-semibold text-ink block mb-1">
                Impuestos sin parametrizar
              </label>
              <p className="text-[11px] text-ink-muted mb-2">
                Tratamiento contable para impuestos adicionales no reconocidos en las reglas.
              </p>
              <select
                value={settings.unconfigured_taxes_treatment}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    unconfigured_taxes_treatment: e.target.value as any,
                  })
                }
                className="w-full text-xs border border-line rounded-md bg-surface px-2.5 py-1.5 text-ink focus:outline-none focus:border-brand"
              >
                <option value="REQUIRE_REVIEW">Requerir revisión (Bloquea causación)</option>
                <option value="ADD_TO_EXPENSE">Mayor valor del gasto</option>
                <option value="DEFAULT_ACCOUNT">Cuenta predeterminada</option>
              </select>
            </div>
          </div>

          <div className="space-y-4 md:pl-4 pt-4 md:pt-0">
            {/* 3. Mostrar simulación antes del envío */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-xs font-semibold text-ink block">
                  Mostrar simulación antes del envío
                </label>
                <p className="text-[11px] text-ink-muted">
                  Genera una vista previa contable con débitos y créditos antes de emitir a Siigo.
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.show_simulation}
                onChange={(e) => setSettings({ ...settings, show_simulation: e.target.checked })}
                className="h-4 w-4 rounded border-line text-brand focus:ring-brand/30"
              />
            </div>

            {/* 4. Permitir envío parcial */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-xs font-semibold text-ink block">
                  Permitir envío parcial
                </label>
                <p className="text-[11px] text-ink-muted">
                  Permite sincronizar facturas válidas aunque existan otras con errores o pendientes de revisión.
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.allow_partial_sync}
                onChange={(e) => setSettings({ ...settings, allow_partial_sync: e.target.checked })}
                className="h-4 w-4 rounded border-line text-brand focus:ring-brand/30"
              />
            </div>
          </div>
        </div>

        {/* Reglas específicas para impuestos adicionales (INC, IBUA, Bolsas) */}
        <div className="border-t border-line pt-4 space-y-3">
          <h5 className="text-xs font-semibold text-ink">
            Tratamiento de Impuestos Adicionales del RADIAN
          </h5>
          <p className="text-[11px] text-ink-muted">
            Configura el destino contable para el Impuesto al Consumo (INC), Bebidas Azucaradas (IBUA) e Impuesto a las Bolsas.
          </p>

          <div className="space-y-2">
            {[
              { code: 'INC', label: 'INC (Impuesto Nacional al Consumo)' },
              { code: 'IBUA', label: 'IBUA (Bebidas Ultraprocesadas Azucaradas)' },
              { code: 'INC_BOLSAS', label: 'INC Bolsas Plásticas' },
            ].map((tax) => {
              const rule = settings.tax_treatment_rules[tax.code] || {
                treatment: 'ADD_TO_EXPENSE',
                account: null,
              };
              return (
                <div
                  key={tax.code}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center p-2.5 rounded-lg border border-line bg-canvas/30 text-xs"
                >
                  <div className="sm:col-span-4 font-medium text-ink">
                    {tax.label}
                  </div>
                  <div className="sm:col-span-4">
                    <select
                      value={rule.treatment}
                      onChange={(e) => updateRule(tax.code, 'treatment', e.target.value)}
                      className="w-full text-xs border border-line rounded-md bg-surface px-2 py-1 text-ink focus:outline-none focus:border-brand"
                    >
                      <option value="ADD_TO_EXPENSE">Mayor valor del gasto</option>
                      <option value="CUSTOM_ACCOUNT">Cuenta PUC independiente</option>
                      <option value="REQUIRE_REVIEW">Requerir revisión</option>
                    </select>
                  </div>
                  <div className="sm:col-span-4">
                    {rule.treatment === 'CUSTOM_ACCOUNT' ? (
                      <select
                        value={rule.account || ''}
                        onChange={(e) => updateRule(tax.code, 'account', e.target.value || null)}
                        className="w-full text-xs border border-line rounded-md bg-surface px-2 py-1 text-ink font-mono focus:outline-none focus:border-brand"
                      >
                        <option value="">-- Seleccionar cuenta PUC --</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.code}>
                            {acc.code} - {acc.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[11px] text-ink-faint italic">
                        {rule.treatment === 'ADD_TO_EXPENSE' ? 'Se incorpora a la cuenta de gasto' : 'Bloquea envío sin parametrizar'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cuentas PUC Globales por defecto */}
        <div className="border-t border-line pt-4 space-y-3">
          <h5 className="text-xs font-semibold text-ink">
            Cuentas Contables Globales por Defecto de la Empresa
          </h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Cuenta Gasto / Costo Global */}
            <div>
              <label className="block text-[11px] font-medium text-ink-muted mb-1">
                Cuenta Gasto / Costo Global
              </label>
              <select
                value={settings.default_expense_account || ''}
                onChange={(e) => setSettings({ ...settings, default_expense_account: e.target.value || null })}
                className="w-full text-xs border border-line rounded-md bg-surface px-2.5 py-1.5 text-ink font-mono focus:outline-none focus:border-brand truncate"
              >
                <option value="">-- Sin cuenta predeterminada --</option>
                {accounts
                  .filter((a) => a.code.startsWith('5') || a.code.startsWith('6') || a.code.startsWith('7'))
                  .map((acc) => (
                    <option key={acc.id} value={acc.code}>
                      {acc.code} - {acc.name}
                    </option>
                  ))}
                {settings.default_expense_account &&
                  !accounts.some((a) => a.code === settings.default_expense_account) && (
                    <option value={settings.default_expense_account}>
                      {settings.default_expense_account} (Personalizada)
                    </option>
                  )}
              </select>
            </div>

            {/* Cuenta por Pagar Global */}
            <div>
              <label className="block text-[11px] font-medium text-ink-muted mb-1">
                Cuenta por Pagar Global (CxP)
              </label>
              <select
                value={settings.default_payable_account || '22050501'}
                onChange={(e) => setSettings({ ...settings, default_payable_account: e.target.value || null })}
                className="w-full text-xs border border-line rounded-md bg-surface px-2.5 py-1.5 text-ink font-mono focus:outline-none focus:border-brand truncate"
              >
                <option value="22050501">22050501 - Proveedores nacionales (Default)</option>
                {accounts
                  .filter((a) => a.code.startsWith('22') || a.code.startsWith('23'))
                  .filter((a) => a.code !== '22050501')
                  .map((acc) => (
                    <option key={acc.id} value={acc.code}>
                      {acc.code} - {acc.name}
                    </option>
                  ))}
                {settings.default_payable_account &&
                  settings.default_payable_account !== '22050501' &&
                  !accounts.some((a) => a.code === settings.default_payable_account) && (
                    <option value={settings.default_payable_account}>
                      {settings.default_payable_account} (Personalizada)
                    </option>
                  )}
              </select>
            </div>

            {/* Cuenta IVA Descontable Global */}
            <div>
              <label className="block text-[11px] font-medium text-ink-muted mb-1">
                Cuenta IVA Descontable Global
              </label>
              <select
                value={settings.default_iva_account || '24081501'}
                onChange={(e) => setSettings({ ...settings, default_iva_account: e.target.value || null })}
                className="w-full text-xs border border-line rounded-md bg-surface px-2.5 py-1.5 text-ink font-mono focus:outline-none focus:border-brand truncate"
              >
                <option value="24081501">24081501 - IVA Descontable Servicios (19% / Default)</option>
                <option value="24081001">24081001 - IVA Descontable Compras Generales</option>
                {accounts
                  .filter((a) => a.code.startsWith('2408'))
                  .filter((a) => a.code !== '24081501' && a.code !== '24081001')
                  .map((acc) => (
                    <option key={acc.id} value={acc.code}>
                      {acc.code} - {acc.name}
                    </option>
                  ))}
                {settings.default_iva_account &&
                  settings.default_iva_account !== '24081501' &&
                  settings.default_iva_account !== '24081001' &&
                  !accounts.some((a) => a.code === settings.default_iva_account) && (
                    <option value={settings.default_iva_account}>
                      {settings.default_iva_account} (Personalizada)
                    </option>
                  )}
              </select>
            </div>

            {/* Tipo de Comprobante */}
            <div>
              <label className="block text-[11px] font-medium text-ink-muted mb-1">
                Tipo Comprobante (Siigo)
              </label>
              <select
                value={settings.default_purchase_voucher_type_id ?? ''}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    default_purchase_voucher_type_id: e.target.value ? parseInt(e.target.value, 10) : null,
                  })
                }
                className="w-full text-xs border border-line rounded-md bg-surface px-2.5 py-1.5 text-ink focus:outline-none focus:border-brand truncate"
              >
                <option value="">Por defecto de empresa (CC-43000)</option>
                {siigoDocTypes.map((dt) => (
                  <option key={dt.id} value={dt.id}>
                    CC-{dt.code}: {dt.name}
                  </option>
                ))}
                {settings.default_purchase_voucher_type_id &&
                  !siigoDocTypes.some((dt) => dt.id === settings.default_purchase_voucher_type_id) && (
                    <option value={settings.default_purchase_voucher_type_id}>
                      CC-{settings.default_purchase_voucher_type_id}
                    </option>
                  )}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
          {savedSuccess && (
            <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Cambios guardados correctamente
            </span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand/90 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Guardando...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Guardar configuración</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Panel>
  );
};

