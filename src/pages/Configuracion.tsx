import React, { useEffect, useState } from 'react';
import {
  Building2,
  Database,
  Loader2,
  Plug,
  RefreshCw,
  Sliders,
  Upload,
} from 'lucide-react';
import { useApp } from '../state/app-context';
import { api, type SettingRow } from '../api/client';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { SectionHeader } from '../components/ui/SectionHeader';
import { IntegracionesPanel } from '../components/settings/IntegracionesPanel';
import { TaxSettingsPanel } from '../components/settings/TaxSettingsPanel';
import { APP_NAME } from '../config/company';
import { Percent } from 'lucide-react';

const control =
  'h-8 w-full text-xs border border-line rounded-md bg-surface px-2.5 text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30';

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-2.5 border-b border-line last:border-b-0 text-[13px]">
    <span className="text-ink-muted">{label}</span>
    <span className="num text-ink font-medium">{value}</span>
  </div>
);

const humanize = (key: string): string => key.replace(/_/g, ' ');

type ConfigTab = 'empresa' | 'impuestos' | 'integraciones' | 'sistema' | 'datos';

export const Configuracion: React.FC = () => {
  const { company, setCompany, anchor, fileName, resetDemo, openUpload, dataSource, apiOnline, apiCompany } =
    useApp();
  const [activeTab, setActiveTab] = useState<ConfigTab>('empresa');
  const [settings, setSettings] = useState<SettingRow[] | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [settingsCompany, setSettingsCompany] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (apiOnline === false) {
      setSettings((prev) => (prev && prev.length === 0 ? prev : []));
      setSettingsCompany(null);
      return;
    }
    const companyId = apiCompany?.id ?? null;
    if (settingsCompany === companyId && settings !== null) return;
    let cancelled = false;
    api
      .getSettings(apiCompany?.id)
      .then((response) => {
        if (!cancelled) {
          setSettings(response.rows);
          setSettingsCompany(companyId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettings([]);
          setSettingsCompany(companyId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiOnline, apiCompany?.id, settingsCompany, settings]);

  const updateSetting = async (row: SettingRow, value: unknown) => {
    const previous = row.value;
    const settingKey = `${row.scope}.${row.key}`;
    setSettings((prev) =>
      prev ? prev.map((r) => (`${r.scope}.${r.key}` === settingKey ? { ...r, value } : r)) : prev,
    );
    setSavingKey(`${row.scope}.${row.key}`);
    setSaveError(null);
    try {
      await api.saveSetting({
        scope: row.scope,
        key: row.key,
        value,
        description: row.description ?? undefined,
        companyId: apiCompany?.id ?? row.company_id,
      });
    } catch (error) {
      setSettings((prev) =>
        prev ? prev.map((r) => (`${r.scope}.${r.key}` === settingKey ? { ...r, value: previous } : r)) : prev,
      );
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar el valor.');
    } finally {
      setSavingKey(null);
    }
  };

  const tabs: Array<{ id: ConfigTab; label: string; icon: React.FC<{ className?: string }> }> = [
    { id: 'empresa', label: 'Empresa y formato', icon: Building2 },
    { id: 'impuestos', label: 'Impuestos y retenciones', icon: Percent },
    { id: 'integraciones', label: 'Integraciones', icon: Plug },
    { id: 'sistema', label: 'Parámetros del sistema', icon: Sliders },
    { id: 'datos', label: 'Fuente de datos', icon: Database },
  ];

  return (
    <>
      <PageHeader title="Configuración" subtitle="Parámetros generales, integraciones y preferencias del sistema" />

      {/* Selector de pestañas */}
      <div className="flex items-center gap-1 border-b border-line mb-4 -mt-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 text-[12px] font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 cursor-pointer ${
                active
                  ? 'border-brand text-brand font-semibold'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab: Empresa y formato */}
      {activeTab === 'empresa' && (
        <div className="space-y-4 max-w-4xl">
          <Panel className="p-5">
            <SectionHeader
              title="Información de la empresa"
              description="Detectada de la fuente de datos activa · se recalcula al importar nuevos periodos"
            />
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-[11px] text-ink-muted mb-1 font-medium">Razón social</span>
                <input
                  type="text"
                  className={control}
                  value={company.name}
                  onChange={(e) => setCompany({ ...company, name: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-ink-muted mb-1 font-medium">NIT</span>
                <input
                  type="text"
                  className={`${control} num`}
                  value={company.nit}
                  onChange={(e) => setCompany({ ...company, nit: e.target.value })}
                />
              </label>
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionHeader title="Formato y presentación" description="Parámetros regionales y de visualización" />
            <div className="mt-2 divide-y divide-line">
              <InfoRow label="Aplicación" value={APP_NAME} />
              <InfoRow label="Formato numérico" value="Colombiano — $ 159.553.441,75" />
              <InfoRow label="Moneda principal" value="COP" />
              <InfoRow label="Tipografía contable" value="Inter · tabular-nums" />
              <InfoRow label="Idioma" value="Español (Colombia)" />
            </div>
          </Panel>
        </div>
      )}

      {/* Tab: Impuestos y retenciones */}
      {activeTab === 'impuestos' && (
        <div className="max-w-5xl">
          <TaxSettingsPanel companyId={apiCompany?.id ?? null} />
        </div>
      )}

      {/* Tab: Integraciones */}
      {activeTab === 'integraciones' && (
        <div className="max-w-5xl">
          <IntegracionesPanel companyId={apiCompany?.id ?? null} />
        </div>
      )}

      {/* Tab: Parámetros del sistema */}
      {activeTab === 'sistema' && (
        <div className="max-w-4xl">
          <Panel className="p-5">
            <SectionHeader
              title="Parámetros del servidor"
              description="Variables persistidas en base de datos · se aplican en la siguiente importación o cálculo"
            />
            {settings === null && (
              <p className="mt-4 text-[12px] text-ink-muted flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Consultando configuración…
              </p>
            )}
            {settings !== null && settings.length === 0 && (
              <p className="mt-4 text-[12px] text-ink-muted">
                Sin configuración disponible: el servidor de Accountant no responde.
              </p>
            )}
            {settings !== null && settings.length > 0 && (
              <div className="mt-3 divide-y divide-line">
                {settings.map((row) => {
                  const settingKey = `${row.scope}.${row.key}`;
                  const id = `setting-${row.scope}-${row.key}`;
                  const busy = savingKey === settingKey;
                  return (
                    <div key={settingKey} className="py-2.5 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <label htmlFor={id} className="block text-[12px] text-ink font-medium capitalize">
                          {row.scope} · {humanize(row.key)}
                        </label>
                        {row.description && (
                          <p className="text-[11px] text-ink-muted leading-snug mt-0.5">{row.description}</p>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {busy && <Loader2 className="w-3 h-3 animate-spin text-ink-faint" />}
                        {row.value_type === 'boolean' ? (
                          <input
                            id={id}
                            type="checkbox"
                            checked={row.value === true}
                            onChange={(e) => void updateSetting(row, e.target.checked)}
                            className="w-4 h-4 accent-brand rounded cursor-pointer"
                          />
                        ) : (
                          <input
                            id={id}
                            type="text"
                            className={`${control} w-44 num`}
                            value={typeof row.value === 'string' ? row.value : String(row.value ?? '')}
                            onChange={(e) => void updateSetting(row, e.target.value)}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {saveError && <p className="mt-3 text-[11px] text-danger">{saveError}</p>}
          </Panel>
        </div>
      )}

      {/* Tab: Fuente de datos */}
      {activeTab === 'datos' && (
        <div className="space-y-4 max-w-4xl">
          <Panel className="p-5">
            <SectionHeader title="Fuente de datos activa" description="Estado de la conexión y periodo de referencia cargado" />
            <div className="mt-2 divide-y divide-line">
              <InfoRow label="Archivo activo" value={fileName || 'Ninguno'} />
              <InfoRow
                label="Origen de datos"
                value={dataSource === 'servidor' ? 'Base de datos PostgreSQL' : 'Local en memoria (demo)'}
              />
              <InfoRow
                label="Estado del servidor"
                value={
                  apiOnline === null ? 'Verificando…' : apiOnline ? 'Conectado / Disponible' : 'Desconectado'
                }
              />
              <InfoRow
                label="Fecha de referencia"
                value={anchor.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}
              />
              <InfoRow label="Fuentes conectadas" value="DIAN / RADIAN" />
            </div>

            <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openUpload}
                className="h-8 inline-flex items-center gap-1.5 px-3 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors font-medium cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-ink-muted" />
                Importar nuevo archivo
              </button>
              <button
                type="button"
                onClick={resetDemo}
                className="h-8 inline-flex items-center gap-1.5 px-3 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors font-medium cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-ink-muted" />
                Restaurar datos de muestra
              </button>
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionHeader title="Periodo de trabajo" description="Determinación del periodo contable activo" />
            <p className="mt-2 text-[12.5px] text-ink-muted leading-relaxed">
              El periodo de referencia se calcula automáticamente con la fecha de emisión más reciente
              presente en los documentos contables cargados. Desde el selector superior puedes cambiar a
              mes anterior, trimestre, año o un rango de fechas personalizado, así como activar la
              comparativa contra el periodo anterior.
            </p>
          </Panel>
        </div>
      )}
    </>
  );
};
