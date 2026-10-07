import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { SectionHeader } from '../components/ui/SectionHeader';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { cn } from '../utils/cn';

const PENDING_CONCEPTS = [
  'Saldo a favor anterior',
  'Retenciones de IVA',
  'Ajustes',
  'Devoluciones',
  'Importaciones',
  'IVA retenido',
  'Operaciones excluidas',
  'Operaciones exentas',
];

export const Iva: React.FC = () => {
  const { period, periodRecords, kpis, nav } = useApp();

  const saldo = kpis.ivaPorPagar;
  const esPago = saldo >= 0;

  return (
    <>
      <PageHeader title="IVA" subtitle={`Determinación del IVA · ${period.label}`} />

      <Panel className="p-4">
        <SectionHeader
          title="Determinación del IVA"
          description="Débito fiscal menos crédito fiscal sobre los documentos electrónicos del periodo"
        />

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-0">
            <button
              type="button"
              onClick={() => nav({ view: 'ventas', filters: { hasIva: true } })}
              className="w-full flex items-center justify-between gap-4 py-3 border-b border-line text-left hover:bg-canvas transition-colors px-2 -mx-2 rounded-md"
            >
              <span>
                <span className="text-[13px] text-ink">IVA generado</span>
                <span className="block text-[11px] text-ink-muted">
                  Débito fiscal · {formatNumber(kpis.totalVentasCount)} facturas emitidas
                </span>
              </span>
              <span className="flex items-center gap-2 num text-[15px] font-semibold text-ink">
                {formatCurrency(kpis.ivaGenerado)}
                <ChevronRight className="w-3.5 h-3.5 text-ink-faint" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => nav({ view: 'compras', filters: { hasIva: true } })}
              className="w-full flex items-center justify-between gap-4 py-3 border-b border-line text-left hover:bg-canvas transition-colors px-2 -mx-2 rounded-md"
            >
              <span>
                <span className="text-[13px] text-ink">(-) IVA descontable</span>
                <span className="block text-[11px] text-ink-muted">
                  Crédito fiscal · {formatNumber(kpis.totalComprasCount)} facturas recibidas
                </span>
              </span>
              <span className="flex items-center gap-2 num text-[15px] font-semibold text-ink">
                {formatCurrency(kpis.ivaDescontable)}
                <ChevronRight className="w-3.5 h-3.5 text-ink-faint" />
              </span>
            </button>

            <div className="flex items-center justify-between gap-4 py-3 px-2 -mx-2">
              <span>
                <span className="text-[13px] font-semibold text-ink">Saldo estimado</span>
                <span className="block text-[11px] text-ink-muted">
                  {esPago ? 'IVA estimado por pagar' : 'Saldo a favor estimado'}
                </span>
              </span>
              <span className={cn('num text-[19px] font-semibold', esPago ? 'text-ink' : 'text-success')}>
                {formatCurrency(Math.abs(saldo))}
              </span>
            </div>
          </div>

          <div className="border border-line rounded-md p-4 bg-canvas">
            <div className="text-[10px] uppercase tracking-[0.06em] text-ink-faint font-semibold">
              IVA estimado por pagar
            </div>
            <div className={cn('num text-[24px] font-semibold tracking-tight mt-1', esPago ? 'text-ink' : 'text-success')}>
              {formatCurrency(Math.abs(saldo))}
            </div>
            <div className="text-[11px] text-ink-muted mt-1">{period.label}</div>
            <div className="mt-3 pt-3 border-t border-line space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-ink-muted">Documentos del periodo</span>
                <span className="num text-ink">{formatNumber(periodRecords.length)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">Retenciones practicadas</span>
                <span className="num text-ink">{formatCurrency(kpis.retencionesTotales)}</span>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-ink-muted border-t border-line pt-3">
          Estimación basada en los documentos electrónicos disponibles para el periodo seleccionado.
          No constituye declaración oficial.
        </p>
      </Panel>

      <Panel className="p-4 mt-3">
        <SectionHeader
          title="Otros conceptos del Formulario 300"
          description="Espacio reservado para conceptos que requieren una fuente de datos adicional"
        />
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {PENDING_CONCEPTS.map((c) => (
            <div
              key={c}
              className="flex items-center justify-between py-2 border-b border-line text-[13px]"
            >
              <span className="text-ink-muted">{c}</span>
              <span className="flex items-center gap-2">
                <span className="num text-ink-faint">—</span>
                <span className="text-[10px] uppercase tracking-[0.04em] text-ink-faint border border-line rounded px-1.5 py-0.5">
                  Sin fuente
                </span>
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
};
