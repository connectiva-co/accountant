import React, { useMemo, useState } from 'react';
import { AppProvider, useApp } from './state/app-context';
import { AppSidebar } from './components/layout/AppSidebar';
import { TopHeader } from './components/layout/TopHeader';
import { FileUploadModal } from './components/FileUploadModal';
import { Resumen } from './pages/Resumen';
import { Ventas } from './pages/Ventas';
import { Compras } from './pages/Compras';
import { NotasCredito } from './pages/NotasCredito';
import { DocumentoSoporte } from './pages/DocumentoSoporte';
import { Nomina } from './pages/Nomina';
import { Iva } from './pages/Iva';
import { Retenciones } from './pages/Retenciones';
import { Conciliacion } from './pages/Conciliacion';
import { Obligaciones } from './pages/Obligaciones';
import { Terceros } from './pages/Terceros';
import { Reportes } from './pages/Reportes';
import { FuentesDeDatos } from './pages/FuentesDeDatos';
import { Configuracion } from './pages/Configuracion';
import type { ViewId } from './types/radian';
import { APP_NAME } from './config/company';

const Shell: React.FC = () => {
  const { view, periodRecords, isUploadOpen, closeUpload, loadRecords, period } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const counts = useMemo(() => {
    const c: Partial<Record<ViewId, number>> = {
      inicio: periodRecords.length,
      iva: periodRecords.length,
    };
    c.ventas = periodRecords.filter(
      (r) =>
        (r['Tipo de documento'] || '').toLowerCase().includes('factura') &&
        (r['Grupo'] || '').toLowerCase() === 'emitido'
    ).length;
    c.compras = periodRecords.filter(
      (r) =>
        (r['Tipo de documento'] || '').toLowerCase().includes('factura') &&
        (r['Grupo'] || '').toLowerCase() === 'recibido'
    ).length;
    c.nc = periodRecords.filter((r) =>
      (r['Tipo de documento'] || '').toLowerCase().includes('nota de crédito')
    ).length;
    c.dse = periodRecords.filter((r) => {
      const t = (r['Tipo de documento'] || '').toLowerCase();
      return t.includes('soporte') || t.includes('pos');
    }).length;
    c.nomina = periodRecords.filter((r) =>
      (r['Tipo de documento'] || '').toLowerCase().includes('nomina')
    ).length;
    return c;
  }, [periodRecords]);

  const renderView = () => {
    switch (view) {
      case 'ventas':
        return <Ventas />;
      case 'compras':
        return <Compras />;
      case 'nc':
        return <NotasCredito />;
      case 'dse':
        return <DocumentoSoporte />;
      case 'nomina':
        return <Nomina />;
      case 'iva':
        return <Iva />;
      case 'retenciones':
        return <Retenciones />;
      case 'conciliacion':
        return <Conciliacion />;
      case 'obligaciones':
        return <Obligaciones />;
      case 'terceros':
        return <Terceros />;
      case 'reportes':
        return <Reportes />;
      case 'fuentes':
        return <FuentesDeDatos />;
      case 'configuracion':
        return <Configuracion />;
      default:
        return <Resumen />;
    }
  };

  return (
    <div className="min-h-screen flex bg-canvas">
      <AppSidebar
        counts={counts}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 w-full max-w-[1640px] px-4 lg:px-6 py-5">
          {renderView()}
        </main>

        <footer className="border-t border-line bg-surface px-4 lg:px-6 py-2.5 text-[11px] text-ink-faint flex flex-wrap items-center justify-between gap-2">
          <span>
            {APP_NAME} · Contabilidad e impuestos
          </span>
          <span className="num">
            Periodo activo: {period.label}
          </span>
        </footer>
      </div>

      <FileUploadModal
        isOpen={isUploadOpen}
        onClose={closeUpload}
        onDataLoaded={loadRecords}
      />
    </div>
  );
};

export const App: React.FC = () => (
  <AppProvider>
    <Shell />
  </AppProvider>
);

export default App;
