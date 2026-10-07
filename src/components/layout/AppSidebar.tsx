import React from 'react';
import {
  Home,
  ReceiptText,
  ShoppingCart,
  RotateCcw,
  FileCheck2,
  Users,
  Landmark,
  Percent,
  Scale,
  CalendarClock,
  Building2,
  FileText,
  Database,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ViewId } from '../../types/radian';
import { useApp } from '../../state/app-context';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../utils/formatters';

interface NavItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Resumen',
    items: [{ id: 'inicio', label: 'Inicio', icon: Home }],
  },
  {
    label: 'Operación',
    items: [
      { id: 'ventas', label: 'Ventas', icon: ReceiptText },
      { id: 'compras', label: 'Compras', icon: ShoppingCart },
      { id: 'nc', label: 'Notas crédito', icon: RotateCcw },
      { id: 'dse', label: 'Documento soporte', icon: FileCheck2 },
      { id: 'nomina', label: 'Nómina', icon: Users },
    ],
  },
  {
    label: 'Fiscal',
    items: [
      { id: 'iva', label: 'IVA', icon: Landmark },
      { id: 'retenciones', label: 'Retenciones', icon: Percent },
      { id: 'conciliacion', label: 'Conciliación', icon: Scale },
      { id: 'obligaciones', label: 'Obligaciones', icon: CalendarClock },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { id: 'terceros', label: 'Terceros', icon: Building2 },
      { id: 'reportes', label: 'Reportes', icon: FileText },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { id: 'fuentes', label: 'Fuentes de datos', icon: Database },
      { id: 'configuracion', label: 'Configuración', icon: Settings },
    ],
  },
];

interface AppSidebarProps {
  counts?: Partial<Record<ViewId, number>>;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ counts = {}, mobileOpen = false, onCloseMobile }) => {
  const { view, nav, periodRecords, fileName } = useApp();

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-ink/30 z-40 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed lg:sticky top-0 z-50 lg:z-auto h-screen w-[212px] shrink-0 bg-surface border-r border-line',
          'flex flex-col transition-transform duration-200 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="h-14 px-4 flex items-center border-b border-line shrink-0">
          <span className="text-[15px] font-semibold tracking-tight text-ink">Accountant</span>
          <span className="ml-2 w-1.5 h-1.5 rounded-full bg-brand" aria-hidden="true" />
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-1.5">
              <div className="px-2 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                {group.label}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                const count = counts[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      nav({ view: item.id });
                      onCloseMobile?.();
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-[7px] rounded-md text-[12.5px] transition-colors mb-0.5',
                      active
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-ink-muted hover:bg-canvas hover:text-ink'
                    )}
                  >
                    <Icon className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-brand' : 'text-ink-faint')} />
                    <span className="truncate text-left flex-1">{item.label}</span>
                    {count !== undefined && (
                      <span className="num text-[10px] text-ink-faint tabular-nums">{formatNumber(count)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-3 py-2.5 shrink-0">
          <div className="text-[10px] uppercase tracking-[0.06em] text-ink-faint font-semibold">
            Fuente activa
          </div>
          <div className="text-[11px] text-ink-muted truncate mt-0.5" title={fileName}>
            RADIAN / DIAN
          </div>
          <div className="text-[11px] text-ink-faint num">
            {formatNumber(periodRecords.length)} documentos en periodo
          </div>
        </div>
      </aside>
    </>
  );
};
