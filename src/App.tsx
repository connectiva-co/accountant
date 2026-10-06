import React, { useState, useMemo } from 'react';
import {
  LayoutDashboard,
  TrendingUp,
  ShoppingBag,
  RotateCcw,
  FileCheck,
  Users,
  Scale,
  Sparkles,
} from 'lucide-react';
import sampleDataRaw from './data/sampleRadian.json';
import { enrichRecords, computeKPIs, filterRecords } from './utils/radianEngine';
import type { RadianRecord } from './types/radian';
import { Navbar } from './components/Navbar';
import { KPICards } from './components/KPICards';
import { ChartsView } from './components/ChartsView';
import { DataTable } from './components/DataTable';
import { FiscalReconciliation } from './components/FiscalReconciliation';
import { FileUploadModal } from './components/FileUploadModal';

export const App: React.FC = () => {
  const [records, setRecords] = useState<RadianRecord[]>(() => enrichRecords(sampleDataRaw));
  const [fileName, setFileName] = useState<string>('RADIAN AGOSTO JGV.xlsx');
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);

  const kpis = useMemo(() => computeKPIs(records), [records]);

  const ventasRecords = useMemo(() => filterRecords(records, 'ventas'), [records]);
  const comprasRecords = useMemo(() => filterRecords(records, 'compras'), [records]);
  const ncRecords = useMemo(() => filterRecords(records, 'notas_credito'), [records]);
  const dseRecords = useMemo(() => filterRecords(records, 'dse'), [records]);
  const nominaRecords = useMemo(() => filterRecords(records, 'nomina_pos'), [records]);

  const handleResetData = () => {
    setRecords(enrichRecords(sampleDataRaw));
    setFileName('RADIAN AGOSTO JGV.xlsx (Datos Demo)');
  };

  const handleDataLoaded = (newRecords: RadianRecord[], newFileName: string) => {
    setRecords(newRecords);
    setFileName(newFileName);
  };

  const tabs = [
    { id: 'overview', label: 'Dashboard Ejecutivo', icon: LayoutDashboard, count: records.length },
    { id: 'ventas', label: 'Ventas (Emitidas)', icon: TrendingUp, count: ventasRecords.length },
    { id: 'compras', label: 'Compras (Recibidas)', icon: ShoppingBag, count: comprasRecords.length },
    { id: 'nc', label: 'Notas Crédito', icon: RotateCcw, count: ncRecords.length },
    { id: 'dse', label: 'Doc. Soporte (DSE)', icon: FileCheck, count: dseRecords.length },
    { id: 'nomina', label: 'Nómina & POS', icon: Users, count: nominaRecords.length },
    { id: 'fiscal', label: 'Conciliación Fiscal DIAN', icon: Scale },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Navbar
        records={records}
        kpis={kpis}
        onUploadClick={() => setIsUploadOpen(true)}
        onResetData={handleResetData}
        fileName={fileName}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Banner de Bienvenida / Estado */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-brand-950/40 border border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-brand-500/10 text-brand-400 border border-brand-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                Movimientos de Facturación Electrónica DIAN / RADIAN
              </h2>
              <p className="text-xs text-slate-400">
                Total de <span className="text-brand-400 font-bold font-mono">{records.length} transacciones</span> segregadas y conciliadas automáticamente con cálculo de bases e impuestos.
              </p>
            </div>
          </div>
        </div>

        {/* KPIs Principales */}
        <KPICards kpis={kpis} />

        {/* Selector de Pestañas */}
        <div className="flex overflow-x-auto space-x-2 border-b border-slate-800 mb-6 pb-2 scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={
                  isActive
                    ? 'flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all bg-brand-500/10 text-brand-400 border border-brand-500/30 shadow-sm'
                    : 'flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
                }
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={
                      isActive
                        ? 'px-1.5 py-0.5 rounded text-[10px] font-mono bg-brand-500/20 text-brand-300'
                        : 'px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400'
                    }
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Contenido de la Pestaña Activa */}
        <div className="space-y-6">
          {activeTab === 'overview' && (
            <>
              <ChartsView records={records} />
              <DataTable
                records={records}
                title="Historial Maestro de Documentos (RADIAN)"
                subtitle="Listado unificado de facturas, notas de crédito, nómina y documentos soporte"
              />
            </>
          )}

          {activeTab === 'ventas' && (
            <DataTable
              records={ventasRecords}
              title="Facturas Electrónicas de Venta Emitidas"
              subtitle="Ingresos operacionales con desglose de base gravable e IVA generado"
            />
          )}

          {activeTab === 'compras' && (
            <DataTable
              records={comprasRecords}
              title="Facturas Electrónicas de Compra & Gastos Recibidas"
              subtitle="Costos y deducciones con IVA descontable para declaración tributaria"
            />
          )}

          {activeTab === 'nc' && (
            <DataTable
              records={ncRecords}
              title="Notas de Crédito Electrónicas"
              subtitle="Devoluciones y anulaciones que disminuyen la base gravable en ventas o compras"
            />
          )}

          {activeTab === 'dse' && (
            <DataTable
              records={dseRecords}
              title="Documentos Soporte con No Obligados a Facturar (DSE)"
              subtitle="Pagos realizados a personas naturales sin RUT comercial o no obligadas"
            />
          )}

          {activeTab === 'nomina' && (
            <DataTable
              records={nominaRecords}
              title="Nómina Electrónica & Documentos Equivalentes POS"
              subtitle="Costos salariales devengados y compras de caja menor por sistema POS"
            />
          )}

          {activeTab === 'fiscal' && (
            <FiscalReconciliation kpis={kpis} records={records} />
          )}
        </div>
      </main>

      <FileUploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onDataLoaded={handleDataLoaded}
      />
    </div>
  );
};

export default App;
