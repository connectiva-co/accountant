import React, { useMemo } from 'react';
import { CircleCheck, FileSearch } from 'lucide-react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricCard } from '../components/ui/MetricCard';
import { MetricGroup } from '../components/ui/MetricGroup';
import { Panel } from '../components/ui/Panel';
import { SectionHeader } from '../components/ui/SectionHeader';
import { AttentionItem } from '../components/ui/AttentionItem';
import { EmptyState } from '../components/ui/EmptyState';
import { SalesPurchasesChart } from '../components/charts/SalesPurchasesChart';
import {
  attentionItems,
  buildObservations,
  qualityReport,
  routeForRecords,
  statusSummary,
  topParties,
  classifyEstado,
} from '../utils/derivations';
import { formatCurrency, formatNumber, formatPercent } from '../utils/formatters';

export const Resumen: React.FC = () => {
  const {
    records,
    periodRecords,
    prevRecords,
    kpis,
    prevKpis,
    compare,
    period,
    prevPeriod,
    nav,
  } = useApp();

  const trend = (curr: number, prev: number): number | null | undefined => {
    if (!compare) return undefined;
    if (!prev) return null;
    return ((curr - prev) / prev) * 100;
  };

  const ventasNetas = kpis.totalVentasBrutas - kpis.totalNotasCreditoEmitidas;
  const comprasNetas = kpis.totalComprasBrutas - kpis.totalNotasCreditoRecibidas;
  const prevVentasNetas = prevKpis.totalVentasBrutas - prevKpis.totalNotasCreditoEmitidas;
  const prevComprasNetas = prevKpis.totalComprasBrutas - prevKpis.totalNotasCreditoRecibidas;

  const notasCredito = kpis.totalNotasCreditoEmitidas + kpis.totalNotasCreditoRecibidas;
  const prevNotasCredito =
    prevKpis.totalNotasCreditoEmitidas + prevKpis.totalNotasCreditoRecibidas;

  const attention = useMemo(() => attentionItems(periodRecords), [periodRecords]);
  const status = useMemo(() => statusSummary(periodRecords), [periodRecords]);
  const quality = useMemo(() => qualityReport(periodRecords), [periodRecords]);
  const observations = useMemo(
    () => buildObservations(periodRecords, prevRecords, prevPeriod.label),
    [periodRecords, prevRecords, prevPeriod.label]
  );
  const clients = useMemo(() => topParties(periodRecords, 'cliente', 5), [periodRecords]);
  const suppliers = useMemo(() => topParties(periodRecords, 'proveedor', 5), [periodRecords]);

  const clientTotal = clients.reduce((a, c) => a + Math.max(0, c.total), 0);
  const supplierTotal = suppliers.reduce((a, s) => a + Math.max(0, s.total), 0);

  const statusSegments = [
    {
      key: 'aprobados',
      label: 'Aprobados',
      value: status.aprobados,
      color: 'bg-success',
      target: () => nav({ view: routeForRecords(periodRecords.filter((r) => classifyEstado(r.Estado) === 'aprobado')) }),
    },
    {
      key: 'pendientes',
      label: 'Pendientes',
      value: status.pendientes,
      color: 'bg-warning',
      target: () =>
        nav({
          view: routeForRecords(periodRecords.filter((r) => classifyEstado(r.Estado) === 'pendiente')),
          filters: { onlyPending: true },
        }),
    },
    {
      key: 'rechazados',
      label: 'Rechazados',
      value: status.rechazados,
      color: 'bg-danger',
      target: () =>
        nav({
          view: routeForRecords(periodRecords.filter((r) => classifyEstado(r.Estado) === 'rechazado')),
          filters: { onlyRejected: true },
        }),
    },
    {
      key: 'inconsistencias',
      label: 'Con inconsistencias',
      value: status.inconsistencias,
      color: 'bg-gray-300',
      target: () =>
        nav({
          view: routeForRecords(periodRecords.filter((r) => classifyEstado(r.Estado) === 'inconsistente')),
        }),
    },
  ];

  return (
    <>
      <PageHeader title="Resumen contable" subtitle={period.label} />

      <MetricGroup columns={5}>
        <MetricCard
          label="Ventas netas"
          value={formatCurrency(ventasNetas)}
          trend={trend(ventasNetas, prevVentasNetas)}
          compareLabel={prevPeriod.label.split(' ')[0]}
          footnote={`${formatNumber(kpis.totalVentasCount)} facturas`}
          onClick={() => nav({ view: 'ventas' })}
        />
        <MetricCard
          label="Compras netas"
          value={formatCurrency(comprasNetas)}
          trend={trend(comprasNetas, prevComprasNetas)}
          compareLabel={prevPeriod.label.split(' ')[0]}
          footnote={`${formatNumber(kpis.totalComprasCount)} facturas`}
          onClick={() => nav({ view: 'compras' })}
        />
        <MetricCard
          label="IVA generado"
          value={formatCurrency(kpis.ivaGenerado)}
          trend={trend(kpis.ivaGenerado, prevKpis.ivaGenerado)}
          compareLabel={prevPeriod.label.split(' ')[0]}
          footnote="Débito fiscal"
          onClick={() => nav({ view: 'ventas', filters: { hasIva: true } })}
        />
        <MetricCard
          label="IVA descontable"
          value={formatCurrency(kpis.ivaDescontable)}
          trend={trend(kpis.ivaDescontable, prevKpis.ivaDescontable)}
          compareLabel={prevPeriod.label.split(' ')[0]}
          footnote="Crédito fiscal"
          onClick={() => nav({ view: 'compras', filters: { hasIva: true } })}
        />
        <MetricCard
          label="IVA estimado por pagar"
          value={formatCurrency(kpis.ivaPorPagar)}
          trend={trend(kpis.ivaPorPagar, prevKpis.ivaPorPagar)}
          compareLabel={prevPeriod.label.split(' ')[0]}
          footnote="Estimación"
          onClick={() => nav({ view: 'iva' })}
        />
      </MetricGroup>

      <Panel className="mt-3 px-4 py-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            type="button"
            onClick={() => nav({ view: 'nomina' })}
            className="text-left group"
          >
            <div className="text-[11px] uppercase tracking-[0.04em] text-ink-faint font-medium">
              Nómina electrónica
            </div>
            <div className="num text-[16px] font-semibold text-ink mt-0.5 group-hover:text-brand-700 transition-colors">
              {formatCurrency(kpis.totalNomina)}
            </div>
            <div className="text-[11px] text-ink-muted num">
              {formatNumber(kpis.totalNominaCount)} documentos
              {compare && prevKpis.totalNomina > 0 && ` · ${formatCurrency(prevKpis.totalNomina)} en ${prevPeriod.label}`}
            </div>
          </button>

          <button type="button" onClick={() => nav({ view: 'dse' })} className="text-left group">
            <div className="text-[11px] uppercase tracking-[0.04em] text-ink-faint font-medium">
              Documento soporte
            </div>
            <div className="num text-[16px] font-semibold text-ink mt-0.5 group-hover:text-brand-700 transition-colors">
              {formatCurrency(kpis.totalDocSoporte)}
            </div>
            <div className="text-[11px] text-ink-muted num">
              {formatNumber(kpis.totalDocSoporteCount)} documentos
            </div>
          </button>

          <button type="button" onClick={() => nav({ view: 'nc' })} className="text-left group">
            <div className="text-[11px] uppercase tracking-[0.04em] text-ink-faint font-medium">
              Notas crédito
            </div>
            <div className="num text-[16px] font-semibold text-ink mt-0.5 group-hover:text-brand-700 transition-colors">
              {formatCurrency(notasCredito)}
            </div>
            <div className="text-[11px] text-ink-muted num">
              {formatNumber(kpis.totalNotasCreditoCount)} documentos
              {compare && prevNotasCredito > 0 && (
                <>
                  {' · '}
                  {formatCurrency(prevNotasCredito)} en {prevPeriod.label}
                </>
              )}
            </div>
          </button>

          <button type="button" onClick={() => nav({ view: 'fuentes' })} className="text-left group">
            <div className="text-[11px] uppercase tracking-[0.04em] text-ink-faint font-medium">
              Cantidad de documentos
            </div>
            <div className="num text-[16px] font-semibold text-ink mt-0.5 group-hover:text-brand-700 transition-colors">
              {formatNumber(periodRecords.length)}
            </div>
            <div className="text-[11px] text-ink-muted num">
              de {formatNumber(records.length)} en la fuente
            </div>
          </button>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
        <Panel className="overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <SectionHeader title="Requiere atención" description="Centro operativo del periodo" />
          </div>
          {attention.length === 0 ? (
            <EmptyState
              icon={CircleCheck}
              title="Sin pendientes"
              description="No se detectaron documentos rechazados, duplicados ni incompletos en el periodo."
            />
          ) : (
            <div>
              {attention.map((item) => (
                <AttentionItem key={item.id} item={item} onClick={() => nav(item.target)} />
              ))}
            </div>
          )}
        </Panel>

        <Panel className="p-4">
          <SectionHeader
            title="Estado documental"
            description={`${formatNumber(status.total)} documentos en el periodo`}
          />
          <div className="mt-3 flex h-2 w-full rounded-full overflow-hidden bg-gray-100">
            {statusSegments
              .filter((s) => s.value > 0)
              .map((s) => (
                <div
                  key={s.key}
                  className={s.color}
                  style={{ width: `${status.total ? (s.value / status.total) * 100 : 0}%` }}
                  title={`${s.label}: ${s.value}`}
                />
              ))}
          </div>
          <div className="mt-3 space-y-0.5">
            {statusSegments.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={s.target}
                disabled={s.value === 0}
                className="w-full flex items-center justify-between px-1 py-1.5 rounded-md text-xs transition-colors hover:bg-canvas disabled:hover:bg-transparent text-left"
              >
                <span className="inline-flex items-center gap-2 text-ink-muted">
                  <span className={`w-2 h-2 rounded-sm ${s.color}`} />
                  {s.label}
                </span>
                <span className="num text-ink">
                  {formatNumber(s.value)}
                  <span className="text-ink-faint ml-2">
                    {formatPercent(status.total ? (s.value / status.total) * 100 : 0, 1)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel className="p-4">
          <SectionHeader title="Calidad de datos" description="Validaciones aplicadas sobre los documentos" />
          <div className="mt-3 flex items-baseline gap-2">
            <span className="num text-[22px] font-semibold text-ink tracking-tight">
              {formatPercent(quality.validadosPct, 1)}
            </span>
            <span className="text-xs text-ink-muted">de documentos validados</span>
          </div>
          <div className="mt-3 space-y-1.5">
            {[
              { label: 'Documentos procesados', value: quality.procesados },
              { label: 'Aprobados', value: quality.aprobados },
              { label: 'Requieren revisión', value: quality.requierenRevision },
              { label: 'Posibles duplicados', value: quality.duplicados },
              { label: 'Sin fecha de emisión', value: quality.sinFecha },
              { label: 'NIT inválidos', value: quality.nitInvalidos },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between text-xs border-b border-line last:border-b-0 pb-1.5 last:pb-0"
              >
                <span className="text-ink-muted">{row.label}</span>
                <span className={`num font-medium ${row.value > 0 && row.label !== 'Documentos procesados' && row.label !== 'Aprobados' ? 'text-warning' : 'text-ink'}`}>
                  {formatNumber(row.value)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-3">
        <SalesPurchasesChart records={records} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <Panel className="p-4">
          <SectionHeader title="Principales clientes" description="Participación sobre ventas del periodo" />
          <table className="w-full mt-3 text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.05em] text-ink-faint border-b border-line">
                <th className="text-left font-semibold pb-1.5">Cliente</th>
                <th className="text-right font-semibold pb-1.5">Ventas</th>
                <th className="text-right font-semibold pb-1.5 w-20">Participación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-ink-muted text-xs">
                    Sin ventas registradas en el periodo.
                  </td>
                </tr>
              ) : (
                clients.map((c) => (
                  <tr
                    key={c.nit}
                    className="hover:bg-canvas cursor-pointer"
                    onClick={() => nav({ view: 'ventas', filters: { party: c.nit } })}
                  >
                    <td className="py-2 pr-3">
                      <div className="text-ink truncate max-w-[260px]" title={c.name}>
                        {c.name}
                      </div>
                      <div className="text-[10px] text-ink-faint num">
                        NIT {c.nit} · {formatNumber(c.count)} docs
                      </div>
                    </td>
                    <td className="py-2 text-right num text-ink font-medium">{formatCurrency(c.total)}</td>
                    <td className="py-2 text-right num text-ink-muted">
                      {formatPercent(clientTotal ? (c.total / clientTotal) * 100 : 0, 1)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Panel>

        <Panel className="p-4">
          <SectionHeader title="Principales proveedores" description="Participación sobre compras del periodo" />
          <table className="w-full mt-3 text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.05em] text-ink-faint border-b border-line">
                <th className="text-left font-semibold pb-1.5">Proveedor</th>
                <th className="text-right font-semibold pb-1.5">Compras</th>
                <th className="text-right font-semibold pb-1.5 w-20">Participación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-ink-muted text-xs">
                    Sin compras registradas en el periodo.
                  </td>
                </tr>
              ) : (
                suppliers.map((s) => (
                  <tr
                    key={s.nit}
                    className="hover:bg-canvas cursor-pointer"
                    onClick={() => nav({ view: 'compras', filters: { party: s.nit } })}
                  >
                    <td className="py-2 pr-3">
                      <div className="text-ink truncate max-w-[260px]" title={s.name}>
                        {s.name}
                      </div>
                      <div className="text-[10px] text-ink-faint num">
                        NIT {s.nit} · {formatNumber(s.count)} docs
                      </div>
                    </td>
                    <td className="py-2 text-right num text-ink font-medium">{formatCurrency(s.total)}</td>
                    <td className="py-2 text-right num text-ink-muted">
                      {formatPercent(supplierTotal ? (s.total / supplierTotal) * 100 : 0, 1)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel className="mt-3 p-4">
        <SectionHeader
          title="Observaciones"
          description="Lecturas derivadas de los documentos del periodo"
          action={
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
              <FileSearch className="w-3.5 h-3.5" />
              {observations.length} {observations.length === 1 ? 'lectura' : 'lecturas'}
            </span>
          }
        />
        <ul className="mt-2.5 space-y-1.5">
          {observations.map((obs, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-ink-muted">
              <span className="mt-[7px] w-1 h-1 rounded-full bg-ink-faint shrink-0" />
              <span>{obs}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
};
