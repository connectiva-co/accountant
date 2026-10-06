import React from 'react';
import { TrendingUp, ShoppingBag, Users, Scale } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';
import type { FinancialKPIs } from '../types/radian';

interface KPICardsProps {
  kpis: FinancialKPIs;
}

export const KPICards: React.FC<KPICardsProps> = ({ kpis }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* 1. Total Ventas */}
      <div className="glass-card glass-card-hover rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-28 h-28 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Ventas Emitidas</span>
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-bold text-white mb-1 tracking-tight">
          {formatCurrency(kpis.totalVentasBrutas)}
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
          <span>Base: <span className="text-slate-200 font-mono">{formatCurrency(kpis.totalVentasBase)}</span></span>
          <span className="text-emerald-400 font-medium">{kpis.totalVentasCount} docs</span>
        </div>
      </div>

      {/* 2. Total Compras / Gastos */}
      <div className="glass-card glass-card-hover rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-28 h-28 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Compras & Gastos</span>
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <ShoppingBag className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-bold text-white mb-1 tracking-tight">
          {formatCurrency(kpis.totalComprasBrutas)}
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
          <span>Base: <span className="text-slate-200 font-mono">{formatCurrency(kpis.totalComprasBase)}</span></span>
          <span className="text-blue-400 font-medium">{kpis.totalComprasCount} docs</span>
        </div>
      </div>

      {/* 3. Balance IVA DIAN (Generado - Descontable) */}
      <div className="glass-card glass-card-hover rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Balance IVA (DIAN)</span>
          <div className={kpis.ivaPorPagar >= 0 ? 'p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}>
            <Scale className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-bold text-white mb-1 tracking-tight">
          {formatCurrency(Math.abs(kpis.ivaPorPagar))}
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
          <span>{kpis.ivaPorPagar >= 0 ? '⚠️ IVA a Pagar' : '✅ Saldo a Favor'}</span>
          <span className="text-slate-300 font-mono">IVA Vtas: {formatCurrency(kpis.totalVentasIVA)}</span>
        </div>
      </div>

      {/* 4. Total Documentos & Nómina */}
      <div className="glass-card glass-card-hover rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-28 h-28 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Nómina & Soporte</span>
          <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Users className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-bold text-white mb-1 tracking-tight">
          {formatCurrency(kpis.totalNomina + kpis.totalDocSoporte)}
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
          <span>Nómina: <span className="text-slate-200">{kpis.totalNominaCount}</span></span>
          <span className="text-purple-300 font-mono">DSE: {kpis.totalDocSoporteCount}</span>
        </div>
      </div>
    </div>
  );
};
