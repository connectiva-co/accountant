import React from 'react';
import { Scale } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';
import type { FinancialKPIs, RadianRecord } from '../types/radian';

interface FiscalProps {
  kpis: FinancialKPIs;
  records: RadianRecord[];
}

export const FiscalReconciliation: React.FC<FiscalProps> = ({ kpis }) => {
  const ventasNetas = kpis.totalVentasBrutas - kpis.totalNotasCreditoEmitidas;
  const comprasNetas = kpis.totalComprasBrutas - kpis.totalNotasCreditoRecibidas;

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Scale className="w-5 h-5 text-amber-400" />
              Conciliación Fiscal & Simulación Formulario 300 DIAN (IVA)
            </h3>
            <p className="text-xs text-slate-400">
              Cálculo estimado del impuesto a las ventas conforme a transacciones electrónicas reportadas en RADIAN
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400 uppercase font-semibold">Resultado Fiscal Estimado</div>
            <div className={kpis.ivaPorPagar >= 0 ? "text-xl font-bold font-mono text-amber-400" : "text-xl font-bold font-mono text-emerald-400"}>
              {kpis.ivaPorPagar >= 0 ? `A Pagar: ${formatCurrency(kpis.ivaPorPagar)}` : `A Favor: ${formatCurrency(Math.abs(kpis.ivaPorPagar))}`}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3 bg-slate-900/50 rounded-xl p-4 border border-slate-800">
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center justify-between">
              <span>1. Ingresos & IVA Generado</span>
              <span className="text-slate-400 font-normal font-mono">Ventas</span>
            </h4>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">Ingresos Brutos por Facturación:</span>
                <span className="text-white font-semibold">{formatCurrency(kpis.totalVentasBrutas)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">(-) Devoluciones / Notas Crédito Emitidas:</span>
                <span className="text-rose-400">- {formatCurrency(kpis.totalNotasCreditoEmitidas)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60 font-semibold">
                <span className="text-emerald-300">(=) Ingresos Netos Operacionales:</span>
                <span className="text-emerald-300">{formatCurrency(ventasNetas)}</span>
              </div>
              <div className="flex justify-between py-1 text-amber-300 font-bold pt-2">
                <span>Total IVA Generado (Débito Fiscal):</span>
                <span>{formatCurrency(kpis.totalVentasIVA)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 bg-slate-900/50 rounded-xl p-4 border border-slate-800">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center justify-between">
              <span>2. Costos, Gastos & IVA Descontable</span>
              <span className="text-slate-400 font-normal font-mono">Compras</span>
            </h4>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">Compras Brutas con Factura:</span>
                <span className="text-white font-semibold">{formatCurrency(kpis.totalComprasBrutas)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">(-) Notas Crédito Recibidas:</span>
                <span className="text-rose-400">- {formatCurrency(kpis.totalNotasCreditoRecibidas)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60 font-semibold">
                <span className="text-blue-300">(=) Compras Netas:</span>
                <span className="text-blue-300">{formatCurrency(comprasNetas)}</span>
              </div>
              <div className="flex justify-between py-1 text-blue-300 font-bold pt-2">
                <span>Total IVA Descontable (Crédito Fiscal):</span>
                <span>{formatCurrency(kpis.totalComprasIVA)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
            Retenciones y Otros Impuestos Reportados
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
              <div className="text-slate-400 text-[10px]">Documento Soporte (No obligados)</div>
              <div className="text-base font-bold text-white mt-1">{formatCurrency(kpis.totalDocSoporte)}</div>
              <div className="text-[10px] text-slate-400 mt-1">{kpis.totalDocSoporteCount} operaciones</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
              <div className="text-slate-400 text-[10px]">Nómina Electrónica Individual</div>
              <div className="text-base font-bold text-purple-300 mt-1">{formatCurrency(kpis.totalNomina)}</div>
              <div className="text-[10px] text-slate-400 mt-1">{kpis.totalNominaCount} empleados/mes</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
              <div className="text-slate-400 text-[10px]">Total Retenciones DIAN</div>
              <div className="text-base font-bold text-emerald-400 mt-1">{formatCurrency(kpis.retencionesTotales)}</div>
              <div className="text-[10px] text-slate-400 mt-1">Renta, IVA e ICA</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
