import React, { useMemo, useState } from 'react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { EmptyState } from '../components/ui/EmptyState';
import { buildThirdParties, type ThirdPartyKind } from '../utils/derivations';
import { formatCurrency, formatDate, formatNumber } from '../utils/formatters';
import { cn } from '../utils/cn';
import { Users } from 'lucide-react';

const TABS: { id: ThirdPartyKind; label: string }[] = [
  { id: 'cliente', label: 'Clientes' },
  { id: 'proveedor', label: 'Proveedores' },
  { id: 'empleado', label: 'Empleados' },
  { id: 'otro', label: 'Otros' },
];

export const Terceros: React.FC = () => {
  const { periodRecords, period, nav } = useApp();
  const [kind, setKind] = useState<ThirdPartyKind>('cliente');

  const all = useMemo(() => buildThirdParties(periodRecords), [periodRecords]);
  const counts = useMemo(() => {
    const c: Record<ThirdPartyKind, number> = { cliente: 0, proveedor: 0, empleado: 0, otro: 0 };
    for (const t of all) c[t.kind] += 1;
    return c;
  }, [all]);

  const list = all.filter((t) => t.kind === kind);

  const openDetail = (nit: string) => {
    if (kind === 'cliente') nav({ view: 'ventas', filters: { party: nit } });
    else if (kind === 'proveedor') nav({ view: 'compras', filters: { party: nit } });
    else if (kind === 'empleado') nav({ view: 'nomina', filters: { party: nit } });
    else nav({ view: 'dse', filters: { party: nit } });
  };

  const metricLabel =
    kind === 'cliente' ? 'Ventas periodo' : kind === 'proveedor' ? 'Compras periodo' : kind === 'empleado' ? 'Devengado periodo' : 'Valor periodo';
  const ivaLabel = kind === 'cliente' ? 'IVA generado' : 'IVA descontable';

  return (
    <>
      <PageHeader
        title="Terceros"
        subtitle={`${period.label} · ${formatNumber(all.length)} terceros identificados en los documentos`}
      />

      <div className="flex items-center gap-1 border-b border-line mb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setKind(t.id)}
            className={cn(
              'px-3 py-2 text-xs border-b-2 -mb-px transition-colors',
              kind === t.id
                ? 'border-brand text-brand-700 font-medium'
                : 'border-transparent text-ink-muted hover:text-ink'
            )}
          >
            {t.label}
            <span className="ml-1.5 num text-ink-faint">{formatNumber(counts[t.id])}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Users}
            title={`Sin ${TABS.find((t) => t.id === kind)?.label.toLowerCase()} en el periodo`}
            description="Los terceros se derivan de los documentos electrónicos cargados para el periodo seleccionado."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((t) => (
            <button
              key={`${t.kind}-${t.nit}`}
              type="button"
              onClick={() => openDetail(t.nit)}
              className="text-left bg-surface border border-line rounded-card shadow-card p-4 transition-colors hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              <div className="text-[13px] font-semibold text-ink truncate" title={t.name}>
                {t.name}
              </div>
              <div className="text-[11px] text-ink-faint num mt-0.5">NIT {t.nit}</div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 pt-3 border-t border-line">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.04em] text-ink-faint font-semibold">
                    {metricLabel}
                  </div>
                  <div className="num text-[14px] font-semibold text-ink">{formatCurrency(t.total)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.04em] text-ink-faint font-semibold">
                    Documentos
                  </div>
                  <div className="num text-[14px] font-semibold text-ink">{formatNumber(t.documentos)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.04em] text-ink-faint font-semibold">
                    Último documento
                  </div>
                  <div className="num text-[13px] text-ink">{t.lastDate ? formatDate(t.lastDate) : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.04em] text-ink-faint font-semibold">
                    {ivaLabel}
                  </div>
                  <div className="num text-[13px] text-ink">{formatCurrency(t.iva)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
};
