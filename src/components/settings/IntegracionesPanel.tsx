import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, Code2, Copy, Loader2, Plug, Play, RefreshCw, Save, Search, Trash2 , FileCheck2 } from 'lucide-react';
import { api } from '../../api/client';
import type {
  ConnectionTestResult,
  IntegrationCatalog,
  IntegrationField,
  IntegrationSummary,
  MatchRow,
  RecheckSummary,
  SyncConflict,
  SyncRunResult,
} from '../../api/client';
import { Panel } from '../ui/Panel';
import { SectionHeader } from '../ui/SectionHeader';

const control =
  'h-8 w-full text-xs border border-line rounded-md bg-surface px-2.5 text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30';
const button =
  'h-7 px-2.5 inline-flex items-center gap-1.5 text-[11px] border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors disabled:opacity-40';

const STATUS_LABELS: Record<string, string> = {
  NOT_CONFIGURED: 'Sin configurar',
  CONFIGURED: 'Configurada',
  CONNECTED: 'Conectada',
  ERROR: 'Con error',
  DISABLED: 'Deshabilitada',
};

const MATCH_LABELS: Record<MatchRow['match_status'], string> = {
  NOT_CHECKED: 'Sin revisar',
  MATCHED: 'Coincide',
  NOT_FOUND: 'No existe en el ERP',
  AMBIGUOUS: 'Ambiguo',
  ERROR: 'Error de consulta',
};

interface ProviderForm {
  name: string;
  enabled: boolean;
  settings: Record<string, string>;
  credentials: Record<string, string>;
}

const emptyForm = (integration: IntegrationSummary | null, fields: IntegrationField[]): ProviderForm => {
  const settings: Record<string, string> = {};
  const credentials: Record<string, string> = {};
  for (const field of fields) {
    const target = field.group === 'credentials' ? credentials : settings;
    if (field.group === 'credentials') {
      target[field.key] = '';
      continue;
    }
    const value = integration?.settings?.[field.key];
    target[field.key] = value === undefined || value === null ? '' : String(value);
  }
  return {
    name: integration?.name ?? '',
    enabled: integration?.enabled ?? false,
    settings,
    credentials,
  };
};

const coerce = (field: IntegrationField, raw: string): unknown => {
  if (field.type === 'number') {
    if (raw.trim() === '') return undefined;
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? raw : parsed;
  }
  return raw.trim() === '' ? undefined : raw;
};

interface Props {
  companyId: string | null;
}

export const IntegracionesPanel: React.FC<Props> = ({ companyId }) => {
  const [data, setData] = useState<{ integrations: IntegrationSummary[]; catalog: IntegrationCatalog[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, ProviderForm>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, ConnectionTestResult | null>>({});
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [recheck, setRecheck] = useState<RecheckSummary | null>(null);
  const [syncRun, setSyncRun] = useState<SyncRunResult | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [showSyncDebug, setShowSyncDebug] = useState(false);
  const [copiedDebug, setCopiedDebug] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setData({ integrations: [], catalog: [] });
      return;
    }
    setError(null);
    try {
      const [integrations, matchList, conflictList] = await Promise.all([
        api.listIntegrations(companyId),
        api.listMatches(companyId, { limit: 500 }),
        api.listConflicts(companyId, { status: 'OPEN' }),
      ]);
      setData(integrations);
      setMatches(matchList.matches);
      setConflicts(conflictList.conflicts);
      const next: Record<string, ProviderForm> = {};
      for (const catalog of integrations.catalog) {
        const existing = integrations.integrations.find((item) => item.provider === catalog.provider) ?? null;
        next[catalog.provider] = emptyForm(existing, catalog.fields);
      }
      setForms(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la configuración de integraciones.');
      setData({ integrations: [], catalog: [] });
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const matchCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of matches ?? []) counts[row.match_status] = (counts[row.match_status] ?? 0) + 1;
    return counts;
  }, [matches]);

  const updateField = (provider: string, group: 'settings' | 'credentials', key: string, value: string) => {
    setForms((prev) => {
      const form = prev[provider];
      if (!form) return prev;
      return { ...prev, [provider]: { ...form, [group]: { ...form[group], [key]: value } } };
    });
  };

  const save = async (catalog: IntegrationCatalog) => {
    if (!companyId) return;
    const form = forms[catalog.provider];
    if (!form) return;
    setBusy(`save:${catalog.provider}`);
    setError(null);
    try {
      const settings: Record<string, unknown> = {};
      for (const field of catalog.fields.filter((f) => f.group === 'settings')) {
        const value = coerce(field, form.settings[field.key] ?? '');
        if (value !== undefined) settings[field.key] = value;
      }
      const credentials: Record<string, unknown> = {};
      let hasSecrets = false;
      for (const field of catalog.fields.filter((f) => f.group === 'credentials')) {
        const raw = (form.credentials[field.key] ?? '').trim();
        if (raw !== '') {
          credentials[field.key] = raw;
          hasSecrets = true;
        }
      }
      await api.saveIntegration(companyId, catalog.provider, {
        name: form.name.trim() || null,
        enabled: form.enabled,
        settings,
        ...(hasSecrets ? { credentials } : {}),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la integración.');
    } finally {
      setBusy(null);
    }
  };

  const clearCredentials = async (provider: string) => {
    if (!companyId) return;
    setBusy(`clear:${provider}`);
    try {
      await api.saveIntegration(companyId, provider, { clear_credentials: true });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron borrar las credenciales.');
    } finally {
      setBusy(null);
    }
  };

  const test = async (provider: string) => {
    if (!companyId) return;
    setBusy(`test:${provider}`);
    setError(null);
    try {
      const response = await api.testIntegration(companyId, provider);
      setTests((prev) => ({ ...prev, [provider]: response.result }));
      await load();
    } catch (err) {
      setTests((prev) => ({
        ...prev,
        [provider]: {
          ok: false,
          status: 'ERROR',
          message: err instanceof Error ? err.message : 'No se pudo probar la conexión.',
          checkedAt: new Date().toISOString(),
        },
      }));
    } finally {
      setBusy(null);
    }
  };

  const runRecheck = async () => {
    if (!companyId) return;
    setBusy('recheck');
    setError(null);
    try {
      const response = await api.recheckMatches(companyId, { limit: 100 });
      setRecheck(response.summary);
      const list = await api.listMatches(companyId, { limit: 500 });
      setMatches(list.matches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo revisar los documentos.');
    } finally {
      setBusy(null);
    }
  };

  const runSync = async (dryRun: boolean) => {
    if (!companyId) return;
    setBusy(dryRun ? 'sync:dry' : 'sync:run');
    setError(null);
    try {
      const response = await api.runSync(companyId, { dry_run: dryRun, limit: 50 });
      setSyncRun(response.run);
      const conflictList = await api.listConflicts(companyId, { status: 'OPEN' });
      setConflicts(conflictList.conflicts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ejecutar la sincronización.');
    } finally {
      setBusy(null);
    }
  };

  const resolveConflict = async (conflict: SyncConflict, resolution: string) => {
    if (!companyId) return;
    setBusy(`conflict:${conflict.id}`);
    try {
      await api.resolveConflict(companyId, conflict.id, resolution);
      const conflictList = await api.listConflicts(companyId, { status: 'OPEN' });
      setConflicts(conflictList.conflicts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo resolver el conflicto.');
    } finally {
      setBusy(null);
    }
  };

  if (!companyId) {
    return (
      <Panel className="p-4">
        <SectionHeader
          title="Integraciones y sincronización"
          description="Conecta tu ERP contable (Siigo, World Office, …) para leer y cruzar documentos"
        />
        <p className="mt-3 text-[12px] text-ink-muted">
          Sin empresa activa en el servidor no hay integraciones que configurar: importa un archivo
          RADIAN o selecciona una empresa para habilitar este panel.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="p-4">
      <SectionHeader
        title="Integraciones y sincronización"
        description="Proveedores disponibles, pruebas de conexión, matching RADIAN ↔ ERP y sincronización de terceros"
      />

      {error && (
        <p className="mt-3 text-[11px] text-danger flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      {data === null && (
        <p className="mt-3 text-[12px] text-ink-muted flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Consultando integraciones…
        </p>
      )}

      {data !== null && data.catalog.length === 0 && (
        <p className="mt-3 text-[12px] text-ink-muted">No hay proveedores registrados en el servidor.</p>
      )}

      {data !== null && data.catalog.length > 0 && (
        <div className="mt-4 space-y-4">
          {data.catalog.map((catalog) => {
            const integration = data.integrations.find((item) => item.provider === catalog.provider) ?? null;
            const form = forms[catalog.provider];
            if (!form) return null;
            const result = tests[catalog.provider] ?? null;
            const lastStatus = integration?.last_test_status;
            return (
              <div key={catalog.provider} className="border border-line rounded-md bg-canvas">
                <div className="px-3 py-2.5 border-b border-line flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink font-medium">{catalog.name}</p>
                    <p className="text-[11px] text-ink-muted num">
                      {integration ? (
                        <>
                          {STATUS_LABELS[integration.status] ?? integration.status}
                          {integration.last_test_status &&
                            ` · última prueba: ${integration.last_test_status} (${new Date(
                              integration.last_connection_test_at ?? Date.now(),
                            ).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })})`}
                        </>
                      ) : (
                        'Sin configurar'
                      )}
                      {' · '}
                      {catalog.capabilities.length} operaciones soportadas
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 accent-brand"
                        checked={form.enabled}
                        onChange={(e) =>
                          setForms((prev) => ({
                            ...prev,
                            [catalog.provider]: { ...form, enabled: e.target.checked },
                          }))
                        }
                      />
                      Habilitada
                    </label>
                    <button
                      type="button"
                      className={button}
                      disabled={busy !== null}
                      onClick={() => void test(catalog.provider)}
                    >
                      {busy === `test:${catalog.provider}` ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Plug className="w-3 h-3" />
                      )}
                      Probar conexión
                    </button>
                    <button
                      type="button"
                      className={button}
                      disabled={busy !== null}
                      onClick={() => void save(catalog)}
                    >
                      {busy === `save:${catalog.provider}` ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Save className="w-3 h-3" />
                      )}
                      Guardar
                    </button>
                  </div>
                </div>

                <div className="px-3 py-3 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                  <label className="block md:col-span-2">
                    <span className="block text-[11px] text-ink-muted mb-1">Nombre visible</span>
                    <input
                      type="text"
                      className={control}
                      value={form.name}
                      placeholder={catalog.name}
                      onChange={(e) =>
                        setForms((prev) => ({ ...prev, [catalog.provider]: { ...form, name: e.target.value } }))
                      }
                    />
                  </label>

                  {catalog.fields.map((field) => {
                    const id = `int-${catalog.provider}-${field.group}-${field.key}`;
                    const value = (field.group === 'credentials' ? form.credentials : form.settings)[field.key] ?? '';
                    return (
                      <label key={id} htmlFor={id} className="block">
                        <span className="block text-[11px] text-ink-muted mb-1">
                          {field.label}
                          {field.required && <span className="text-danger"> *</span>}
                        </span>
                        {field.type === 'boolean' ? (
                          <input
                            id={id}
                            type="checkbox"
                            className="w-4 h-4 accent-brand"
                            checked={value === 'true'}
                            onChange={(e) =>
                              updateField(catalog.provider, field.group, field.key, e.target.checked ? 'true' : 'false')
                            }
                          />
                        ) : field.type === 'select' ? (
                          <select
                            id={id}
                            className={control}
                            value={value}
                            onChange={(e) => updateField(catalog.provider, field.group, field.key, e.target.value)}
                          >
                            <option value="">—</option>
                            {(field.options ?? []).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={id}
                            type={field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                            className={field.type === 'number' ? `${control} num` : control}
                            value={value}
                            autoComplete={field.group === 'credentials' ? 'new-password' : 'off'}
                            placeholder={
                              field.type === 'secret' && integration?.has_credentials
                                ? '•••••••• (vacío conserva la actual)'
                                : field.placeholder
                            }
                            min={field.min}
                            max={field.max}
                            onChange={(e) => updateField(catalog.provider, field.group, field.key, e.target.value)}
                          />
                        )}
                        {field.help && <span className="block text-[10px] text-ink-faint leading-snug mt-0.5">{field.help}</span>}
                      </label>
                    );
                  })}
                </div>

                <div className="px-3 py-2 border-t border-line flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-[11px]">
                    {result ? (
                      <span className={result.ok ? 'text-success' : 'text-danger'}>
                        {result.ok ? 'Conexión exitosa' : 'Fallo'} · {result.message}
                      </span>
                    ) : lastStatus ? (
                      <span className={lastStatus === 'OK' ? 'text-success' : 'text-ink-muted'}>
                        {integration?.last_test_message ?? lastStatus}
                      </span>
                    ) : (
                      <span className="text-ink-muted">Sin prueba de conexión registrada</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {integration?.has_credentials && (
                      <button
                        type="button"
                        className={button}
                        disabled={busy !== null}
                        onClick={() => void clearCredentials(catalog.provider)}
                      >
                        {busy === `clear:${catalog.provider}` ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        Borrar credenciales
                      </button>
                    )}
                    <span className="text-[10px] text-ink-faint num">
                      {catalog.sync_resources.join(' · ') || 'sin recursos de sincronización'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="border border-line rounded-md bg-canvas p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[13px] text-ink font-medium">Coincidencias RADIAN ↔ ERP</p>
              <p className="text-[11px] text-ink-muted">
                {matches === null
                  ? 'Cargando…'
                  : `${matches.length} documentos revisados (lote de 500)`}
              </p>
            </div>
            <button type="button" className={button} disabled={busy !== null} onClick={() => void runRecheck()}>
              {busy === 'recheck' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Revisar de nuevo
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(Object.keys(MATCH_LABELS) as Array<MatchRow['match_status']>).map((status) => (
              <span
                key={status}
                className="h-6 px-2 inline-flex items-center gap-1 text-[11px] border border-line rounded-full bg-surface text-ink-muted"
              >
                {MATCH_LABELS[status]}
                <span className="num font-medium text-ink">{matchCounts[status] ?? 0}</span>
              </span>
            ))}
          </div>
          {recheck && (
            <p className="mt-2 text-[11px] text-ink-muted num">
              Revisión: {recheck.checked} consultados · {recheck.MATCHED} coincidencias ·{' '}
              {recheck.NOT_FOUND} ausentes · {recheck.AMBIGUOUS} ambiguos · {recheck.ERROR} errores
              {recheck.skipped ? ` · omitidos: ${recheck.skipped}` : ''}
            </p>
          )}
        </div>


        {/* Matriz de capacidades de sincronización ERP */}
        <div className="border border-line rounded-md bg-canvas p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[13px] text-ink font-semibold flex items-center gap-1.5">
                <FileCheck2 className="w-4 h-4 text-brand" />
                Matriz de Capacidades de Sincronización Siigo / ERP
              </p>
              <p className="text-[11px] text-ink-muted mt-0.5">
                Resumen oficial de los recursos y tipos de documentos que la API de Siigo expone para sincronización y descarga
              </p>
            </div>
            <span className="text-[11px] text-brand bg-brand/10 border border-brand/20 px-2.5 py-0.5 rounded-full font-medium">
              API Siigo v1
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div className="p-2.5 rounded bg-surface border border-line flex items-start gap-2">
              <span className="text-emerald-500 font-bold shrink-0">✓</span>
              <div>
                <strong className="text-ink font-medium block">Facturas de Venta (Emitidas)</strong>
                <p className="text-ink-muted text-[10px] mt-0.5">
                  Sincronización de metadatos y visor de factura XML.
                </p>
              </div>
            </div>

            <div className="p-2.5 rounded bg-surface border border-line flex items-start gap-2">
              <span className="text-amber-500 font-bold shrink-0">⚠</span>
              <div>
                <strong className="text-ink font-medium block">Facturas de Compra (Recibidas)</strong>
                <p className="text-ink-muted text-[10px] mt-0.5">
                  Cruce de valores y fechas con la DIAN/RADIAN.
                </p>
              </div>
            </div>

            <div className="p-2.5 rounded bg-surface border border-line flex items-start gap-2">
              <span className="text-emerald-500 font-bold shrink-0">✓</span>
              <div>
                <strong className="text-ink font-medium block">Terceros, Clientes y Proveedores</strong>
                <p className="text-ink-muted text-[10px] mt-0.5">
                  Sincronización bidireccional automática continua (Lectura y Escritura con normalización de NIT y DV).
                </p>
              </div>
            </div>

            <div className="p-2.5 rounded bg-surface border border-line flex items-start gap-2">
              <span className="text-emerald-500 font-bold shrink-0">✓</span>
              <div>
                <strong className="text-ink font-medium block">Saldos Contables y Bancos</strong>
                <p className="text-ink-muted text-[10px] mt-0.5">
                  Extracción de saldos en tiempo real de cuentas 11 (Cajas y Bancos) vía reportes de balance de prueba.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="border border-line rounded-md bg-canvas p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[13px] text-ink font-medium">Sincronización de terceros</p>
                {busy === 'sync:dry' && (
                  <span className="text-[11px] text-brand bg-brand/10 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Simulando…
                  </span>
                )}
                {busy === 'sync:run' && (
                  <span className="text-[11px] text-brand bg-brand/10 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Ejecutando…
                  </span>
                )}
              </div>
              <p className="text-[11px] text-ink-muted mt-0.5">
                Lee los terceros del ERP configurado y los cruza con la base contable local
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                className={button}
                disabled={busy !== null}
                onClick={() => void runSync(true)}
                title="Prueba la lectura sin alterar los datos locales"
              >
                {busy === 'sync:dry' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Simular
              </button>
              <button
                type="button"
                className={button}
                disabled={busy !== null}
                onClick={() => void runSync(false)}
                title="Aplica los cambios en la base de datos"
              >
                {busy === 'sync:run' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Ejecutar
              </button>
            </div>
          </div>

          {syncRun && (
            <div className="space-y-2 pt-2 border-t border-line">
              {/* Badge métricas de resultado */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-ink uppercase tracking-wide">
                  {syncRun.dry_run ? 'Resultado de la simulación' : 'Resultado de la ejecución'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowSyncDebug(!showSyncDebug)}
                  className="text-[11px] text-brand hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <Code2 className="w-3 h-3" />
                  {showSyncDebug ? 'Ocultar JSON debug' : 'Ver detalle / JSON debug'}
                  {showSyncDebug ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5 text-[11px]">
                <div className="p-2 rounded bg-surface border border-line text-center">
                  <span className="block text-ink-muted text-[10px]">Leídos ERP</span>
                  <span className="num font-semibold text-ink text-xs">{syncRun.read}</span>
                </div>
                <div className="p-2 rounded bg-surface border border-line text-center">
                  <span className="block text-ink-muted text-[10px]">Nuevos</span>
                  <span className="num font-semibold text-brand text-xs">+{syncRun.created}</span>
                </div>
                <div className="p-2 rounded bg-surface border border-line text-center">
                  <span className="block text-ink-muted text-[10px]">Actualizados</span>
                  <span className="num font-semibold text-ink text-xs">{syncRun.updated}</span>
                </div>
                <div className="p-2 rounded bg-surface border border-line text-center">
                  <span className="block text-ink-muted text-[10px]">Sin cambios</span>
                  <span className="num font-medium text-ink-muted text-xs">{syncRun.unchanged}</span>
                </div>
                <div className="p-2 rounded bg-surface border border-line text-center">
                  <span className="block text-ink-muted text-[10px]">Conflictos</span>
                  <span className="num font-semibold text-warning text-xs">{syncRun.conflicts}</span>
                </div>
                <div className="p-2 rounded bg-surface border border-line text-center">
                  <span className="block text-ink-muted text-[10px]">Fallidos</span>
                  <span className={`num font-semibold text-xs ${syncRun.failed > 0 ? 'text-danger' : 'text-ink-muted'}`}>
                    {syncRun.failed}
                  </span>
                </div>
              </div>

              {syncRun.skipped_write && (
                <div className="p-2 rounded bg-warning/5 border border-warning/20 text-[11px] text-warning flex items-center justify-between gap-2">
                  <span>Aviso: {syncRun.skipped_write}</span>
                </div>
              )}

              {syncRun.errors.length > 0 && (
                <div className="p-2.5 rounded bg-danger/5 border border-danger/20 space-y-1">
                  <span className="block text-[11px] font-semibold text-danger">
                    Errores reportados ({syncRun.errors.length}):
                  </span>
                  <ul className="space-y-0.5">
                    {syncRun.errors.map((msg, i) => (
                      <li key={i} className="text-[11px] text-danger/90 font-mono break-all leading-tight">
                        • {msg}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {showSyncDebug && (
                <div className="mt-2 p-3 bg-surface rounded-md border border-line space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] uppercase font-bold text-ink-muted tracking-wider">
                      Payload técnico de depuración
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(JSON.stringify(syncRun, null, 2));
                        setCopiedDebug(true);
                        setTimeout(() => setCopiedDebug(false), 1500);
                      }}
                      className="text-[11px] text-ink-muted hover:text-ink inline-flex items-center gap-1 px-2 py-0.5 rounded border border-line bg-canvas cursor-pointer"
                    >
                      {copiedDebug ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />}
                      {copiedDebug ? 'Copiado' : 'Copiar JSON'}
                    </button>
                  </div>
                  <pre className="p-2.5 bg-canvas rounded border border-line text-[11px] font-mono text-ink overflow-x-auto max-h-56 leading-relaxed">
                    {JSON.stringify(syncRun, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="mt-3 border border-line rounded-md bg-canvas">
          <div className="px-3 py-2 border-b border-line">
            <p className="text-[13px] text-ink font-medium">Conflictos abiertos</p>
            <p className="text-[11px] text-ink-muted">
              La estrategia de la política decide qué gana; aquí se resuelven los pendientes
            </p>
          </div>
          <div className="divide-y divide-line">
            {conflicts.map((conflict) => (
              <div key={conflict.id} className="px-3 py-2 flex items-center justify-between gap-3 text-[12px]">
                <div className="min-w-0">
                  <p className="text-ink truncate">
                    {conflict.entity_type} · {conflict.resource_type}
                  </p>
                  <p className="text-ink-muted num truncate text-[11px]">
                    {String((conflict.source_payload as { name?: string } | null)?.name ?? conflict.entity_id)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    className={button}
                    disabled={busy !== null}
                    onClick={() => void resolveConflict(conflict, 'SOURCE_WINS')}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Usa el ERP
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy !== null}
                    onClick={() => void resolveConflict(conflict, 'TARGET_WINS')}
                  >
                    Usa la base local
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
};
