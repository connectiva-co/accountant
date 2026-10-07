import React from 'react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { SectionHeader } from '../components/ui/SectionHeader';
import { StatStrip } from '../components/ui/StatStrip';
import { formatCurrency, formatNumber } from '../utils/formatters';

interface LineRow {
  label: string;
  value: string;
  tone?: 'default' | 'negative' | 'total';
}

const Row: React.FC<LineRow> = ({ label, value, tone = 'default' }) => (
  <div
    className={`flex items-center justify-between gap-4 py-2 border-b border-line last:border-b-0 text-[13px] ${
      tone === 'total' ? 'font-semibold' : ''
    }`}
  >
    <span className={tone === 'negative' ? 'text-ink-muted' : tone === 'total' ? 'text-ink' : 'text-ink-muted'}>
      {label}
    </span>
    <span className={`num ${tone === 'negative' ? 'text-danger' : tone === 'total' ? 'text-ink' : 'text-ink'}`}>
      {value}
    </span>
  </div>
);

export const Conciliacion: React.FC = () => {
  const { period, periodRecords, kpis, nav } = useApp();

  const ventasNetas = kpis.totalVentasBrutas - kpis.totalNotasCreditoEmitidas;
  const comprasNetas = kpis.totalComprasBrutas - kpis.totalNotasCreditoRecibidas;

  return (
    <>
      <PageHeader
        title="Conciliación"
        subtitle={`Simulación Formulario 300 · ${period.label}`}
        actions={
          <button
            type="button"
            onClick={() => nav({ view: 'iva' })}
            className="h-8 px-3 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors"
          >
            Ver módulo IVA
          </button>
        }
      />

      <StatStrip
        items={[
          { label: 'IVA generado (débito)', value: formatCurrency(kpis.totalVentasIVA) },
          { label: 'IVA descontable (crédito)', value: formatCurrency(kpis.totalComprasIVA) },
          {
            label: kpis.ivaPorPagar >= 0 ? 'Saldo estimado a pagar' : 'Saldo estimado a favor',
            value: formatCurrency(Math.abs(kpis.ivaPorPagar)),
          },
          { label: 'Total retenciones', value: formatCurrency(kpis.retencionesTotales) },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel className="p-4">
          <SectionHeader
            title="1. Ingresos e IVA generado"
            description="Débito fiscal del periodo"
            action={<span className="text-[11px] text-ink-faint num">Ventas</span>}
          />
          <div className="mt-2">
            <Row label="Ingresos brutos por facturación" value={formatCurrency(kpis.totalVentasBrutas)} />
            <Row
              label="(-) Notas crédito emitidas"
              value={`- ${formatCurrency(kpis.totalNotasCreditoEmitidas)}`}
              tone="negative"
            />
            <Row label="(=) Ingresos netos" value={formatCurrency(ventasNetas)} tone="total" />
            <Row label="Total IVA generado (débito fiscal)" value={formatCurrency(kpis.totalVentasIVA)} tone="total" />
          </div>
        </Panel>

        <Panel className="p-4">
          <SectionHeader
            title="2. Costos, gastos e IVA descontable"
            description="Crédito fiscal del periodo"
            action={<span className="text-[11px] text-ink-faint num">Compras</span>}
          />
          <div className="mt-2">
            <Row label="Compras brutas con factura" value={formatCurrency(kpis.totalComprasBrutas)} />
            <Row
              label="(-) Notas crédito recibidas"
              value={`- ${formatCurrency(kpis.totalNotasCreditoRecibidas)}`}
              tone="negative"
            />
            <Row label="(=) Compras netas" value={formatCurrency(comprasNetas)} tone="total" />
            <Row label="Total IVA descontable (crédito fiscal)" value={formatCurrency(kpis.totalComprasIVA)} tone="total" />
          </div>
        </Panel>
      </div>

      <Panel className="p-4 mt-3">
        <SectionHeader
          title="3. Resultado de la conciliación"
          description="Saldo estimado según documentos electrónicos del periodo"
        />
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border border-line rounded-md p-3">
            <div className="text-[10px] uppercase tracking-[0.05em] text-ink-faint font-semibold">
              Débito fiscal
            </div>
            <div className="num text-[15px] font-semibold text-ink mt-1">
              {formatCurrency(kpis.totalVentasIVA)}
            </div>
          </div>
          <div className="border border-line rounded-md p-3">
            <div className="text-[10px] uppercase tracking-[0.05em] text-ink-faint font-semibold">
              Crédito fiscal
            </div>
            <div className="num text-[15px] font-semibold text-ink mt-1">
              {formatCurrency(kpis.totalComprasIVA)}
            </div>
          </div>
          <div className="border border-line rounded-md p-3">
            <div className="text-[10px] uppercase tracking-[0.05em] text-ink-faint font-semibold">
              Retenciones DIAN
            </div>
            <div className="num text-[15px] font-semibold text-ink mt-1">
              {formatCurrency(kpis.retencionesTotales)}
            </div>
          </div>
          <div className="border border-brand-200 bg-brand-50 rounded-md p-3">
            <div className="text-[10px] uppercase tracking-[0.05em] text-brand-700 font-semibold">
              IVA estimado por pagar
            </div>
            <div className="num text-[15px] font-semibold text-brand-700 mt-1">
              {formatCurrency(Math.abs(kpis.ivaPorPagar))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-line">
          <div>
            <div className="text-[11px] text-ink-muted">Documento soporte</div>
            <div className="num text-[14px] font-semibold text-ink">{formatCurrency(kpis.totalDocSoporte)}</div>
            <div className="text-[11px] text-ink-faint num">
              {formatNumber(kpis.totalDocSoporteCount)} operaciones
            </div>
          </div>
          <div>
            <div className="text-[11px] text-ink-muted">Nómina electrónica</div>
            <div className="num text-[14px] font-semibold text-ink">{formatCurrency(kpis.totalNomina)}</div>
            <div className="text-[11px] text-ink-faint num">
              {formatNumber(kpis.totalNominaCount)} comprobantes
            </div>
          </div>
          <div>
            <div className="text-[11px] text-ink-muted">Documentos conciliados</div>
            <div className="num text-[14px] font-semibold text-ink">{formatNumber(periodRecords.length)}</div>
            <div className="text-[11px] text-ink-faint">en el periodo seleccionado</div>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-ink-muted">
          Estimación basada en los documentos electrónicos disponibles para el periodo seleccionado.
        </p>
      </Panel>
    </>
  );
};
