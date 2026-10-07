import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RadianRecord } from '../../types/radian';
import { buildSalesPurchasesSeries } from '../../utils/derivations';
import { formatCompactNumber, formatCurrency } from '../../utils/formatters';
import { Panel } from '../ui/Panel';

interface SalesPurchasesChartProps {
  records: RadianRecord[];
}

interface TooltipPayloadItem {
  name?: string;
  value?: number;
  color?: string;
}

const ChartTooltip: React.FC<{ active?: boolean; payload?: TooltipPayloadItem[]; label?: string }> = ({
  active,
  payload,
  label,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-surface border border-line rounded-md shadow-dropdown px-2.5 py-2 text-[11px]">
      <div className="font-medium text-ink mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 num">
          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
          <span className="text-ink-muted">{p.name}</span>
          <span className="ml-auto font-medium text-ink">{formatCurrency(p.value || 0)}</span>
        </div>
      ))}
    </div>
  );
};

export const SalesPurchasesChart: React.FC<SalesPurchasesChartProps> = ({ records }) => {
  const { mode, data } = useMemo(() => buildSalesPurchasesSeries(records), [records]);

  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Ventas vs. compras</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            {mode === 'month' ? 'Últimos 6 meses con actividad' : 'Últimos días con actividad'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-brand" />
            Ventas
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-info" />
            Compras
          </span>
        </div>
      </div>

      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#98A2B3' }}
              tickLine={false}
              axisLine={{ stroke: '#E5E7EB' }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#98A2B3' }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => formatCompactNumber(v)}
            />
            <Tooltip
              cursor={{ fill: '#F7F8FA' }}
              content={<ChartTooltip />}
            />
            <Bar dataKey="ventas" name="Ventas" fill="#147D64" radius={[2, 2, 0, 0]} maxBarSize={22} />
            <Bar dataKey="compras" name="Compras" fill="#2563EB" radius={[2, 2, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
};
