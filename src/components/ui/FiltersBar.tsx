import React from 'react';
import { RotateCcw, Search } from 'lucide-react';
import type { DocumentFilters } from '../../types/radian';
import { cn } from '../../utils/cn';

export interface FacetOption {
  value: string;
  label: string;
}

interface FiltersBarProps {
  filters: DocumentFilters;
  onChange: (next: DocumentFilters) => void;
  estados?: FacetOption[];
  tipos?: FacetOption[];
  parties?: FacetOption[];
  searchPlaceholder?: string;
  showIvaToggle?: boolean;
}

const control =
  'h-8 text-xs border border-line rounded-md bg-surface text-ink px-2 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30';

export const FiltersBar: React.FC<FiltersBarProps> = ({
  filters,
  onChange,
  estados = [],
  tipos = [],
  parties = [],
  searchPlaceholder = 'Buscar por folio, NIT o nombre...',
  showIvaToggle = true,
}) => {
  const set = (patch: Partial<DocumentFilters>) => onChange({ ...filters, ...patch });

  const hasActiveFilters =
    !!filters.dateFrom ||
    !!filters.dateTo ||
    !!filters.party ||
    !!filters.estado ||
    !!filters.tipo ||
    !!filters.minTotal ||
    !!filters.maxTotal ||
    filters.hasIva ||
    filters.onlyRejected ||
    filters.onlyPending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-ink-faint absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={filters.search || ''}
          onChange={(e) => set({ search: e.target.value })}
          placeholder={searchPlaceholder}
          className={cn(control, 'pl-8 w-56')}
        />
      </div>

      <input
        type="date"
        aria-label="Fecha desde"
        value={filters.dateFrom || ''}
        onChange={(e) => set({ dateFrom: e.target.value })}
        className={cn(control, 'num w-[140px]')}
        title="Fecha desde"
      />
      <input
        type="date"
        aria-label="Fecha hasta"
        value={filters.dateTo || ''}
        onChange={(e) => set({ dateTo: e.target.value })}
        className={cn(control, 'num w-[140px]')}
        title="Fecha hasta"
      />

      <select
        value={filters.party || ''}
        onChange={(e) => set({ party: e.target.value })}
        className={cn(control, 'w-48')}
        aria-label="Tercero"
      >
        <option value="">Tercero (todos)</option>
        {parties.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <select
        value={filters.estado || ''}
        onChange={(e) => set({ estado: e.target.value })}
        className={cn(control, 'w-40')}
        aria-label="Estado DIAN"
      >
        <option value="">Estado DIAN (todos)</option>
        {estados.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <select
        value={filters.tipo || ''}
        onChange={(e) => set({ tipo: e.target.value })}
        className={cn(control, 'w-48')}
        aria-label="Tipo de documento"
      >
        <option value="">Tipo de documento (todos)</option>
        {tipos.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <input
        type="number"
        value={filters.minTotal || ''}
        onChange={(e) => set({ minTotal: e.target.value })}
        placeholder="Valor mín."
        aria-label="Valor mínimo"
        className={cn(control, 'num w-28')}
      />
      <input
        type="number"
        value={filters.maxTotal || ''}
        onChange={(e) => set({ maxTotal: e.target.value })}
        placeholder="Valor máx."
        aria-label="Valor máximo"
        className={cn(control, 'num w-28')}
      />

      {showIvaToggle && (
        <label
          className={cn(
            'h-8 inline-flex items-center gap-1.5 px-2.5 text-xs border rounded-md cursor-pointer select-none',
            filters.hasIva ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-muted'
          )}
        >
          <input
            type="checkbox"
            className="accent-brand-500 w-3 h-3"
            checked={!!filters.hasIva}
            onChange={(e) => set({ hasIva: e.target.checked })}
          />
          Con IVA
        </label>
      )}

      {(filters.onlyRejected || filters.onlyPending) && (
        <span className="h-8 inline-flex items-center px-2.5 text-xs border border-danger/30 bg-danger/5 text-danger rounded-md">
          {filters.onlyRejected ? 'Solo rechazados' : 'Solo pendientes'}
        </span>
      )}

      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => onChange({ search: filters.search })}
          className="h-8 inline-flex items-center gap-1.5 px-2.5 text-xs text-ink-muted hover:text-ink border border-line rounded-md bg-surface transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Limpiar
        </button>
      )}
    </div>
  );
};
