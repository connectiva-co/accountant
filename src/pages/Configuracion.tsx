import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Upload } from 'lucide-react';
import { useApp } from '../state/app-context';
import { api, type SettingRow } from '../api/client';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { SectionHeader } from '../components/ui/SectionHeader';
import { APP_NAME } from '../config/company';

const control =
  'h-8 w-full text-xs border border-line rounded-md bg-surface px-2.5 text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30';

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-2 border-b border-line last:border-b-0 text-[13px]">
    <span className="text-ink-muted">{label}</span>
    <span className="num text-ink">{value}</span>
  </div>
);

const humanize = (key: string): string => key.replace(/_/g, ' ');

export const Configuracion: React.FC = () => {
  const { company, setCompany, anchor, fileName, resetDemo, openUpload, dataSource, apiOnline } =
    useApp();
  const [settings, setSettings] = useState<SettingRow[] | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (settings !== null) return;
    if (apiOnline === false) {
      setSettings([]);
      return;
    }
    let cancelled = false;
    api
      .getSettings()
      .then((response) => {
        if (!cancelled) setSettings(response.rows);
      })
      .catch(() => {
        if (!cancelled) setSettings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiOnline, settings]);

  const updateSetting = async (row: SettingRow, value: unknown) => {
    const previous = row.value;
    setSettings((prev) =>
      prev ? prev.map((r) => (r.id === row.id ? { ...r, value } : r)) : prev,
    );
    setSavingKey(`${row.scope}.${row.key}`);
    setSaveError(null);
    try {
      await api.saveSetting({
        scope: row.scope,
        key: row.key,
        value,
        description: row.description ?? undefined,
      });
    } catch (error) {
      setSettings((prev) =>
        prev ? prev.map((r) => (r.id === row.id ? { ...r, value: previous } : r)) : prev,
      );
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar el valor.');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <>
      <PageHeader title="Configuración" subtitle="Parámetros generales de la aplicación" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel className="p-4">
          <SectionHeader title="Empresa" description="Detectada de la fuente de datos activa · se recalcula al importar" />
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="block text-[11px] text-ink-muted mb-1">Razón social</span>
              <input
                type="text"
                className={control}
                value={company.name}
                onChange={(e) => setCompany({ ...company, name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink-muted mb-1">NIT</span>
              <input
                type="text"
                className={`${control} num`}
                value={company.nit}
                onChange={(e) => setCompany({ ...company, nit: e.target.value })}
              />
            </label>
          </div>
        </Panel>

        <Panel className="p-4">
          <SectionHeader title="Formato y presentación" description="Parámetros fijos de la aplicación" />
          <div className="mt-2">
            <InfoRow label="Aplicación" value={APP_NAME} />
            <InfoRow label="Formato numérico" value="Colombiano — $ 159.553.441,75" />
            <InfoRow label="Moneda" value="COP" />
            <InfoRow label="Tipografía" value="Inter · tabular-nums" />
            <InfoRow label="Idioma" value="Español" />
          </div>
        </Panel>

        <Panel className="p-4">
          <SectionHeader title="Datos" description="Fuente de datos activa y periodo de referencia" />
          <div className="mt-2">
            <InfoRow label="Archivo activo" value={fileName} />
            <InfoRow
              label="Origen"
              value={dataSource === 'servidor' ? 'Base de datos' : 'Local (memoria)'}
            />
            <InfoRow
              label="Servidor"
              value={
                apiOnline === null ? 'Verificando…' : apiOnline ? 'Disponible' : 'No disponible'
              }
            />
            <InfoRow
              label="Fecha de referencia"
              value={anchor.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}
            />
            <InfoRow label="Fuentes conectadas" value="DIAN / RADIAN" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openUpload}
              className="h-8 inline-flex items-center gap-1.5 px-3 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-ink-faint" />
              Importar archivo
            </button>
            <button
              type="button"
              onClick={resetDemo}
              className="h-8 inline-flex items-center gap-1.5 px-3 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 text-ink-faint" />
              Restaurar datos demostrativos
            </button>
          </div>
        </Panel>

        <Panel className="p-4">
          <SectionHeader
            title="Base de datos"
            description="Parámetros persistidos en el servidor · se aplican en la siguiente importación"
          />
          {settings === null && (
            <p className="mt-3 text-[12px] text-ink-muted flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Consultando configuración…
            </p>
          )}
          {settings !== null && settings.length === 0 && (
            <p className="mt-3 text-[12px] text-ink-muted">
              Sin configuración disponible: el servidor de Accountant no responde.
            </p>
          )}
          {settings !== null && settings.length > 0 && (
            <div className="mt-2 divide-y divide-line">
              {settings.map((row) => {
                const id = `setting-${row.scope}-${row.key}`;
                const busy = savingKey === `${row.scope}.${row.key}`;
                return (
                  <div key={row.id} className="py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <label htmlFor={id} className="block text-[12px] text-ink capitalize">
                        {row.scope} · {humanize(row.key)}
                      </label>
                      {row.description && (
                        <p className="text-[11px] text-ink-muted leading-snug">{row.description}</p>
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
                          className="w-4 h-4 accent-brand"
                        />
                      ) : (
                        <input
                          id={id}
                          type="text"
                          className={`${control} w-32 num`}
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
          {saveError && <p className="mt-2 text-[11px] text-danger">{saveError}</p>}
        </Panel>

        <Panel className="p-4">
          <SectionHeader title="Periodo de trabajo" description="Cómo se determina el periodo activo" />
          <p className="mt-2 text-[13px] text-ink-muted">
            El periodo de referencia se calcula con la fecha de emisión más reciente presente en los
            documentos cargados. Desde el selector superior se puede cambiar a mes anterior, trimestre,
            año o un rango personalizado, y activar la comparación contra el periodo anterior.
          </p>
        </Panel>
      </div>
    </>
  );
};
