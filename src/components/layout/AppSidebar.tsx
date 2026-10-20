import React, { useMemo } from 'react';
import type { ViewId } from '../../types/radian';
import { useApp } from '../../state/app-context';
import { useAuth } from '../../state/auth-context';
import { allowedGroups } from '../../config/nav';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../utils/formatters';
import { AccountantLogo } from '../common/Logo';
import { Database } from 'lucide-react';

interface AppSidebarProps {
  counts?: Partial<Record<ViewId, number>>;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ counts = {}, mobileOpen = false, onCloseMobile }) => {
  const { view, nav, periodRecords, fileName, selectedCompanyId } = useApp();
  const { hasPermission } = useAuth();

  // Solo se muestran las vistas permitidas en la empresa activa.
  const groups = useMemo(
    () => allowedGroups((code) => hasPermission(code, selectedCompanyId)),
    [hasPermission, selectedCompanyId],
  );

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-ink/30 z-40 lg:hidden backdrop-blur-xs transition-opacity"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed lg:sticky top-0 z-50 lg:z-auto h-screen w-[224px] shrink-0 bg-surface border-r border-line',
          'flex flex-col transition-transform duration-200 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Sidebar Header Brand Identity */}
        <div className="h-14 px-4 flex items-center border-b border-line shrink-0 bg-surface">
          <AccountantLogo size="md" />
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-3">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                {group.label}
              </div>
              <div className="space-y-0.5">
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
                        'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-all cursor-pointer group',
                        active
                          ? 'bg-brand-50 text-brand font-semibold shadow-xs'
                          : 'text-ink-muted hover:bg-canvas hover:text-ink'
                      )}
                    >
                      <Icon
                        className={cn(
                          'w-4 h-4 shrink-0 transition-colors',
                          active ? 'text-brand' : 'text-ink-faint group-hover:text-ink-muted'
                        )}
                      />
                      <span className="truncate text-left flex-1">{item.label}</span>
                      {count !== undefined && (
                        <span
                          className={cn(
                            'num text-[10.5px] tabular-nums font-mono px-1.5 py-0.2 rounded',
                            active
                              ? 'bg-brand-100/80 text-brand-700 font-medium'
                              : 'text-ink-faint group-hover:text-ink-muted'
                          )}
                        >
                          {formatNumber(count)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer - Active Data Source */}
        <div className="border-t border-line p-3 shrink-0 bg-surface/80">
          <div className="p-2.5 rounded-lg bg-canvas border border-line/70">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.06em] text-ink-faint font-semibold">
                <Database className="w-3 h-3 text-brand" />
                <span>Fuente activa</span>
              </div>
            </div>
            <div className="text-[11.5px] font-medium text-ink truncate mt-1" title={fileName}>
              RADIAN / DIAN
            </div>
            <div className="text-[10.5px] text-ink-faint num mt-0.5">
              {formatNumber(periodRecords.length)} docs en periodo
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
