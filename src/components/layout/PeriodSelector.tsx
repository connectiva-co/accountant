import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { useApp } from '../../state/app-context';
import { cn } from '../../utils/cn';

interface Preset {
  key: string;
  label: string;
  apply: () => void;
}

export const PeriodSelector: React.FC = () => {
  const { period, prevPeriod, periodSelection, setPeriodSelection, compare, setCompare } = useApp();
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(period.start);
  const [customTo, setCustomTo] = useState(period.end);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (period.kind === 'range') {
      setCustomFrom(period.start);
      setCustomTo(period.end);
    }
  }, [period.kind, period.start, period.end]);

  const presets: Preset[] = [
    { key: 'mes', label: 'Este mes', apply: () => setPeriodSelection({ kind: 'month', monthOffset: 0 }) },
    { key: 'anterior', label: 'Mes anterior', apply: () => setPeriodSelection({ kind: 'month', monthOffset: -1 }) },
    { key: 'trimestre', label: 'Este trimestre', apply: () => setPeriodSelection({ kind: 'quarter', monthOffset: 0 }) },
    { key: 'anio', label: 'Año actual', apply: () => setPeriodSelection({ kind: 'year', monthOffset: 0 }) },
  ];

  const activeKey =
    periodSelection.kind === 'range'
      ? 'custom'
      : periodSelection.kind === 'month'
        ? (periodSelection.monthOffset || 0) === 0
          ? 'mes'
          : 'anterior'
        : periodSelection.kind === 'quarter'
          ? 'trimestre'
          : 'anio';

  const applyCustom = () => {
    if (customFrom && customTo && customFrom <= customTo) {
      setPeriodSelection({ kind: 'range', range: { from: customFrom, to: customTo } });
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-8 inline-flex items-center gap-2 px-2.5 text-xs border rounded-md bg-surface transition-colors',
          open ? 'border-brand-500 ring-1 ring-brand-500/30 text-ink' : 'border-line text-ink hover:bg-canvas'
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Seleccionar periodo"
      >
        <CalendarDays className="w-3.5 h-3.5 text-ink-faint" />
        <span className="num font-medium">{period.label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-ink-faint" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[300px] bg-surface border border-line rounded-card shadow-dropdown z-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint mb-1.5">
            Periodo
          </div>

          <div className="space-y-0.5">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  p.apply();
                  setOpen(false);
                }}
                className={cn(
                  'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors',
                  activeKey === p.key ? 'bg-brand-50 text-brand-700 font-medium' : 'text-ink hover:bg-canvas'
                )}
              >
                {p.label}
                {activeKey === p.key && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint mt-3 mb-1.5">
            Personalizado
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="num h-8 flex-1 min-w-0 text-xs border border-line rounded-md px-2 focus:outline-none focus:border-brand-500"
              aria-label="Desde"
            />
            <span className="text-ink-faint text-xs">–</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="num h-8 flex-1 min-w-0 text-xs border border-line rounded-md px-2 focus:outline-none focus:border-brand-500"
              aria-label="Hasta"
            />
          </div>
          <button
            type="button"
            onClick={applyCustom}
            className="mt-2 w-full h-8 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors"
          >
            Aplicar rango
          </button>

          <div className="border-t border-line mt-3 pt-2.5">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-brand-500 w-3.5 h-3.5 mt-0.5"
                checked={compare}
                onChange={(e) => setCompare(e.target.checked)}
              />
              <span className="text-xs text-ink">
                Comparar con periodo anterior
                <span className="block text-[11px] text-ink-muted num">{prevPeriod.label}</span>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
