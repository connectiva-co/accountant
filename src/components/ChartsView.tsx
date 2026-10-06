import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { formatCurrency, formatCompactNumber } from '../utils/formatters';
import type { RadianRecord } from '../types/radian';

interface ChartsViewProps {
  records: RadianRecord[];
}

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];

export const ChartsView: React.FC<ChartsViewProps> = ({ records }) => {
  const dateMap: Record<string, { date: string; ventas: number; compras: number }> = {};
  const clientMap: Record<string, { name: string; nit: string; total: number; count: number }> = {};
  const supplierMap: Record<string, { name: string; nit: string; total: number; count: number }> = {};

  let totalIVA = 0;
  let totalINC = 0;
  let totalIBUA = 0;
  let totalReteIVA = 0;
  let totalReteRenta = 0;
  let totalReteICA = 0;

  records.forEach((r) => {
    const rawDate = r['Fecha Emisión'] || '';
    const date = rawDate.substring(0, 10);
    const grupo = (r['Grupo'] || '').toLowerCase();
    const docType = (r['Tipo de documento'] || '').toLowerCase();
    const total = r.Total || 0;

    totalIVA += r.IVA || 0;
    totalINC += r.INC || 0;
    totalIBUA += r.IBUA || 0;
    totalReteIVA += r['Rete IVA'] || 0;
    totalReteRenta += r['Rete Renta'] || 0;
    totalReteICA += r['Rete ICA'] || 0;

    if (date) {
      if (!dateMap[date]) {
        dateMap[date] = { date, ventas: 0, compras: 0 };
      }
      if (grupo === 'emitido' && docType.includes('factura')) {
        dateMap[date].ventas += total;
      } else if (grupo === 'recibido' && docType.includes('factura')) {
        dateMap[date].compras += total;
      }
    }

    if (grupo === 'emitido' && docType.includes('factura')) {
      const name = r['Nombre Receptor'] || 'Sin Nombre';
      const nit = String(r['NIT Receptor'] || '');
      if (!clientMap[nit]) clientMap[nit] = { name, nit, total: 0, count: 0 };
      clientMap[nit].total += total;
      clientMap[nit].count += 1;
    } else if (grupo === 'recibido' && docType.includes('factura')) {
      const name = r['Nombre Emisor'] || 'Sin Nombre';
      const nit = String(r['NIT Emisor'] || '');
      if (!supplierMap[nit]) supplierMap[nit] = { name, nit, total: 0, count: 0 };
      supplierMap[nit].total += total;
      supplierMap[nit].count += 1;
    }
  });

  const timelineData = Object.values(dateMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-15);

  const topClients = Object.values(clientMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const topSuppliers = Object.values(supplierMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const taxData = [
    { name: 'IVA Generado', value: totalIVA },
    { name: 'INC Consumo', value: totalINC },
    { name: 'IBUA Ultraproc.', value: totalIBUA },
    { name: 'Rete Fuente', value: totalReteRenta },
    { name: 'Rete IVA', value: totalReteIVA },
    { name: 'Rete ICA', value: totalReteICA },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6 mb-8">
      {/* Gráfico 1: Línea de tiempo Ventas vs Compras */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-card rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-white">Flujo Diario: Ventas vs Compras</h3>
              <p className="text-xs text-slate-400">Movimiento consolidado por fecha de emisión</p>
            </div>
            <div className="flex items-center space-x-3 text-xs">
              <div className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5"></span>Ventas</div>
              <div className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 mr-1.5"></span>Compras</div>
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timelineData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(val) => formatCompactNumber(val)} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }}
                  formatter={(value: any) => [formatCurrency(Number(value)), '']}
                />
                <Bar dataKey="ventas" fill="#22c55e" radius={[4, 4, 0, 0]} name="Ventas" />
                <Bar dataKey="compras" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Compras" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 2: Composición Impositiva */}
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-base font-bold text-white mb-1">Estructura de Impuestos & Retenciones</h3>
          <p className="text-xs text-slate-400 mb-4">Distribución total de tributos en el periodo</p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={taxData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {taxData.map((_, index) => (
                    <Cell key={'tax-cell-' + index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }}
                  formatter={(value: any) => [formatCurrency(Number(value)), 'Total']}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top 6 Clientes y Proveedores */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-base font-bold text-white mb-1">Top Clientes (Mayor Facturación)</h3>
          <p className="text-xs text-slate-400 mb-4">Ranking de adquirentes en facturas emitidas</p>
          <div className="space-y-3">
            {topClients.map((c, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/50 border border-slate-800/80 hover:border-emerald-500/30 transition-colors">
                <div className="flex items-center space-x-3 truncate">
                  <span className="w-6 h-6 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-bold flex items-center justify-center border border-emerald-500/20">
                    {i + 1}
                  </span>
                  <div className="truncate">
                    <div className="text-xs font-medium text-slate-200 truncate max-w-xs">{c.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">NIT: {c.nit} · {c.count} facturas</div>
                  </div>
                </div>
                <div className="text-xs font-bold text-emerald-400 font-mono ml-2">
                  {formatCurrency(c.total)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-base font-bold text-white mb-1">Top Proveedores (Mayor Gasto)</h3>
          <p className="text-xs text-slate-400 mb-4">Ranking de emisores en facturas recibidas</p>
          <div className="space-y-3">
            {topSuppliers.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/50 border border-slate-800/80 hover:border-blue-500/30 transition-colors">
                <div className="flex items-center space-x-3 truncate">
                  <span className="w-6 h-6 rounded-lg bg-blue-500/10 text-blue-400 text-xs font-bold flex items-center justify-center border border-blue-500/20">
                    {i + 1}
                  </span>
                  <div className="truncate">
                    <div className="text-xs font-medium text-slate-200 truncate max-w-xs">{s.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">NIT: {s.nit} · {s.count} facturas</div>
                  </div>
                </div>
                <div className="text-xs font-bold text-blue-400 font-mono ml-2">
                  {formatCurrency(s.total)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
