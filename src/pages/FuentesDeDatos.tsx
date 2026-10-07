import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, FileSpreadsheet, Plus } from 'lucide-react';
import { useApp } from '../state/app-context';
import { api, type ImportSummary, type IssueRow } from '../api/client';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { SectionHeader } from '../components/ui/SectionHeader';
import { SourceStatus, type SourceState } from '../components/ui/SourceStatus';
import { formatNumber } from '../utils/formatters';

const FUTURE_SOURCES = [
  'Bancos',
  'ERP',
  'POS',
  'PILA',
  'Extractos bancarios',
  'Facturación electrónica',
  'Información exógena',
];

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Completada',
  COMPLETED_WITH_WARNINGS: 'Completada con avisos',
  PROCESSING: 'En proceso',
  FAILED: 'Fallida',
  REPLAYED: 'Reprocesada',
};

const SEVERITY_STYLE: Record<IssueRow['severity'], string> = {
  INFO: 'text-ink-muted',
  WARNING: 'text-warning',
  ERROR: 'text-danger',
  CRITICAL: 'text-danger',
};

const shortDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export const FuentesDeDatos: React.FC = () => {
  const { records, fileName, lastUpdate, openUpload, dataSource, apiOnline, apiCompany } = useApp();
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [issueAction, setIssueAction] = useState<string | null>(null);

  useEffect(() => {
    if (apiOnline === false) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.getImports();
        if (!cancelled) setImports(response.imports);
      } catch {
        if (!cancelled) setImports([]);
      }
      if (!apiCompany) return;
      try {
        const response = await api.getIssues(apiCompany.id, { open: true, limit: 20 });
        if (!cancelled) setIssues(response.issues);
      } catch {
        if (!cancelled) setIssues([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiOnline, apiCompany, lastUpdate, records.length]);

  const resolveIssue = async (issue: IssueRow) => {
    setIssueAction(issue.id);
    try {
      await api.resolveIssue(issue.id);
      setIssues((prev) => prev.filter((i) => i.id !== issue.id));
    } catch {
      // Sin servidor no hay nada que resolver: se conserva la lista.
    } finally {
      setIssueAction(null);
    }
  };

  const stats = useMemo(() => {
    let nomina = 0;
    let soporte = 0;
    let otros = 0;
    for (const r of records) {
      const t = (r['Tipo de documento'] || '').toLowerCase();
      if (t.includes('nomina')) nomina++;
      else if (t.includes('soporte') || t.includes('pos')) soporte++;
      else otros++;
    }
    return { nomina, soporte, otros };
  }, [records]);

  const dianState: SourceState = records.length > 0 ? 'connected' : 'disconnected';

  return (
    <>
      <PageHeader
        title="Fuentes de datos"
        subtitle="Orígenes conectados a Accountant"
        actions={
          <button
            type="button"
            onClick={openUpload}
            className="h-8 inline-flex items-center gap-1.5 px-3 text-xs font-medium rounded-md bg-brand text-white hover:bg-brand-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Conectar fuente
          </button>
        }
      />

      <Panel className="overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <SectionHeader title="Fuentes conectadas" description="RADIAN / DIAN es una fuente de datos más dentro de Accountant" />
        </div>

        <SourceStatus
          name="DIAN / RADIAN"
          state={dianState}
          meta={`${formatNumber(records.length)} documentos`}
          detail={
            [
              dataSource === 'servidor' ? 'Base de datos (PostgreSQL)' : 'Datos locales en memoria',
              lastUpdate
                ? `Última sincronización: ${lastUpdate.split('-').reverse().join('/')}`
                : 'Sin sincronización registrada',
            ].join(' · ')
          }
          action={
            <button
              type="button"
              onClick={openUpload}
              className="h-7 px-2.5 text-[11px] border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors shrink-0"
            >
              Reimportar
            </button>
          }
        />

        <SourceStatus
          name="Nómina electrónica"
          state={stats.nomina > 0 ? 'connected' : 'disconnected'}
          meta={`${formatNumber(stats.nomina)} documentos`}
          detail="Incluida en la fuente activa"
        />

        <SourceStatus
          name="Documento soporte"
          state={stats.soporte > 0 ? 'connected' : 'disconnected'}
          meta={`${formatNumber(stats.soporte)} documentos`}
          detail="Incluida en la fuente activa"
        />

        <SourceStatus
          name="Archivo importado"
          state={fileName ? 'connected' : 'disconnected'}
          meta={fileName || 'Sin archivo importado'}
          detail={
            fileName
              ? `${formatNumber(stats.otros)} documentos adicionales en el archivo`
              : 'Importa un .xlsx de RADIAN / DIAN para empezar'
          }
          action={
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted shrink-0">
              <FileSpreadsheet className="w-3.5 h-3.5 text-ink-faint" />
              .xlsx
            </span>
          }
        />
      </Panel>

      {imports.length > 0 && (
        <Panel className="mt-3 overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <SectionHeader
              title="Historial de importaciones"
              description="Operaciones registradas en la base de datos · idempotentes por archivo"
            />
          </div>
          <div className="divide-y divide-line">
            {imports.slice(0, 8).map((row) => (
              <div key={row.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-[12px]">
                <div className="min-w-0">
                  <p className="text-ink font-medium truncate">{row.filename}</p>
                  <p className="text-ink-muted num truncate">
                    {shortDate(row.started_at)} · {row.rows_total} filas · {row.rows_inserted} nuevas ·{' '}
                    {row.rows_updated} actualizadas · {row.rows_rejected} rechazadas ·{' '}
                    {row.warnings_count} avisos
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[11px] px-2 h-5 inline-flex items-center rounded-full border ${
                    row.status === 'FAILED'
                      ? 'border-danger/30 text-danger bg-danger/5'
                      : row.status === 'COMPLETED_WITH_WARNINGS'
                        ? 'border-warning/30 text-warning bg-warning/5'
                        : 'border-success/30 text-success bg-success/5'
                  }`}
                >
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {issues.length > 0 && (
        <Panel className="mt-3 overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <SectionHeader
              title="Validaciones abiertas"
              description="Incidencias detectadas en la importación que siguen sin resolverse"
            />
          </div>
          <div className="divide-y divide-line">
            {issues.map((issue) => (
              <div key={issue.id} className="px-4 py-2.5 flex items-start justify-between gap-3 text-[12px]">
                <div className="min-w-0 flex items-start gap-2">
                  <AlertCircle
                    className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${SEVERITY_STYLE[issue.severity]}`}
                  />
                  <div className="min-w-0">
                    <p className="text-ink">
                      <span className="num font-medium">{issue.rule_code}</span> · {issue.message}
                    </p>
                    <p className="text-ink-muted num truncate">
                      {issue.document_uid ? `${issue.document_uid.slice(0, 16)}…` : 'sin documento'} ·{' '}
                      {shortDate(issue.created_at)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={issueAction === issue.id}
                  onClick={() => void resolveIssue(issue)}
                  className="shrink-0 h-6 px-2 inline-flex items-center gap-1 text-[11px] border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors disabled:opacity-40"
                >
                  <Check className="w-3 h-3" />
                  Resolver
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel className="mt-3 overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <SectionHeader
            title="Fuentes disponibles"
            description="Tipos de fuente que Accountant puede incorporar en el futuro"
          />
        </div>
        <div className="p-4 flex flex-wrap gap-2">
          {FUTURE_SOURCES.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] border border-line rounded-md bg-canvas text-ink-muted"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
              {s}
            </span>
          ))}
        </div>
      </Panel>
    </>
  );
};
