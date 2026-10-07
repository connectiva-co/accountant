import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import type { DocumentFilters, RadianRecord } from '../../types/radian';
import { cn } from '../../utils/cn';
import { parseRecordDate, toISODate } from '../../utils/period';
import { classifyEstado } from '../../utils/derivations';
import { formatNumber } from '../../utils/formatters';
import { FiltersBar, type FacetOption } from './FiltersBar';
import { EmptyState } from './EmptyState';

export interface ColumnDef {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  sortValue?: (r: RadianRecord) => string | number;
  render: (r: RadianRecord, index: number) => React.ReactNode;
}

interface DataTableProps {
  title: string;
  description?: string;
  rows: RadianRecord[];
  columns: ColumnDef[];
  filters: DocumentFilters;
  onFiltersChange: (next: DocumentFilters) => void;
  partySide?: 'emisor' | 'receptor' | 'both';
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  pageSize?: number;
  showIvaToggle?: boolean;
  actions?: React.ReactNode;
  onRowClick?: (r: RadianRecord) => void;
}

function applyFilters(rows: RadianRecord[], f: DocumentFilters): RadianRecord[] {
  return rows.filter((r) => {
    if (f.search && f.search.trim()) {
      const q = f.search.trim().toLowerCase();
      const haystack = [
        String(r.Folio),
        String(r.Prefijo || ''),
        r['Nombre Emisor'],
        r['Nombre Receptor'],
        String(r['NIT Emisor']),
        String(r['NIT Receptor']),
        r['Tipo de documento'],
        r['Estado'],
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    if (f.dateFrom || f.dateTo) {
      const d = parseRecordDate(r['Fecha Emisión']);
      if (!d) return false;
      const iso = toISODate(d);
      if (f.dateFrom && iso < f.dateFrom) return false;
      if (f.dateTo && iso > f.dateTo) return false;
    }

    if (f.party) {
      const nitE = String(r['NIT Emisor'] || '');
      const nitR = String(r['NIT Receptor'] || '');
      if (nitE !== f.party && nitR !== f.party) return false;
    }

    if (f.estado && (r.Estado || '') !== f.estado) return false;
    if (f.tipo && (r['Tipo de documento'] || '') !== f.tipo) return false;

    if (f.minTotal && f.minTotal.trim() && r.Total < Number(f.minTotal)) return false;
    if (f.maxTotal && f.maxTotal.trim() && r.Total > Number(f.maxTotal)) return false;

    if (f.hasIva && !(r.IVA > 0)) return false;
    if (f.onlyRejected && classifyEstado(r.Estado) !== 'rechazado') return false;
    if (f.onlyPending && classifyEstado(r.Estado) !== 'pendiente') return false;

    return true;
  });
}

export const DataTable: React.FC<DataTableProps> = ({
  title,
  description,
  rows,
  columns,
  filters,
  onFiltersChange,
  partySide = 'both',
  searchPlaceholder,
  emptyTitle = 'Sin resultados',
  emptyDescription = 'No hay documentos que coincidan con los filtros aplicados.',
  pageSize = 15,
  showIvaToggle = true,
  actions,
  onRowClick,
}) => {
  const [sortKey, setSortKey] = useState<string>('fecha');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);

  const facetEstados = useMemo<FacetOption[]>(
    () =>
      Array.from(new Set(rows.map((r) => r.Estado || '')))
        .filter(Boolean)
        .sort()
        .map((v) => ({ value: v, label: v })),
    [rows]
  );

  const facetTipos = useMemo<FacetOption[]>(
    () =>
      Array.from(new Set(rows.map((r) => r['Tipo de documento'] || '')))
        .filter(Boolean)
        .sort()
        .map((v) => ({ value: v, label: v })),
    [rows]
  );

  const facetParties = useMemo<FacetOption[]>(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (partySide !== 'receptor') {
        const nit = String(r['NIT Emisor'] || '').trim();
        if (nit && !map.has(nit)) map.set(nit, `${r['Nombre Emisor']} · ${nit}`);
      }
      if (partySide !== 'emisor') {
        const nit = String(r['NIT Receptor'] || '').trim();
        if (nit && !map.has(nit)) map.set(nit, `${r['Nombre Receptor']} · ${nit}`);
      }
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 300);
  }, [rows, partySide]);

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const sortableColumns = useMemo(() => columns.filter((c) => c.sortValue), [columns]);
  const activeColumn = useMemo(
    () => sortableColumns.find((c) => c.key === sortKey) || sortableColumns[0],
    [sortableColumns, sortKey]
  );

  const sorted = useMemo(() => {
    if (!activeColumn?.sortValue) return filtered;
    const get = activeColumn.sortValue;
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
      return sortAsc
        ? String(va).localeCompare(String(vb), 'es')
        : String(vb).localeCompare(String(va), 'es');
    });
  }, [filtered, activeColumn, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, totalPages);
  const pageRows = sorted.slice((current - 1) * pageSize, current * pageSize);
  const from = sorted.length === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, sorted.length);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
    setPage(1);
  };

  const updateFilters = (next: DocumentFilters) => {
    onFiltersChange(next);
    setPage(1);
  };

  return (
    <div className="bg-surface border border-line rounded-card shadow-card overflow-hidden">
      <div className="px-4 pt-3.5 pb-3 border-b border-line">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
              <span className="text-[11px] text-ink-faint num">
                {formatNumber(filtered.length)} {filtered.length === 1 ? 'resultado' : 'resultados'}
              </span>
            </div>
            {description && <p className="text-xs text-ink-muted mt-0.5">{description}</p>}
          </div>
          {actions}
        </div>

        <FiltersBar
          filters={filters}
          onChange={updateFilters}
          estados={facetEstados}
          tipos={facetTipos}
          parties={facetParties}
          searchPlaceholder={searchPlaceholder}
          showIvaToggle={showIvaToggle}
        />

        {sortableColumns.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2 text-[11px] text-ink-muted">
            <span>Ordenar por</span>
            <div className="flex flex-wrap items-center gap-1">
              {sortableColumns.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => handleSort(c.key)}
                  className={cn(
                    'px-1.5 py-0.5 rounded border text-[11px] transition-colors',
                    sortKey === c.key
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-line bg-surface text-ink-muted hover:text-ink'
                  )}
                >
                  {c.header}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSortAsc(!sortAsc)}
                className="px-1.5 py-0.5 rounded border border-line bg-surface text-ink-muted hover:text-ink inline-flex items-center gap-1"
                title={sortAsc ? 'Ascendente' : 'Descendente'}
              >
                {sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-canvas border-b border-line">
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={cn(
                    'px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-faint whitespace-nowrap',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    c.sortValue && 'cursor-pointer hover:text-ink-muted'
                  )}
                  onClick={c.sortValue ? () => handleSort(c.key) : undefined}
                >
                  <span className={cn('inline-flex items-center gap-1', c.align === 'right' && 'justify-end')}>
                    {c.header}
                    {c.sortValue && sortKey === c.key &&
                      (sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState
                    icon={SearchX}
                    title={rows.length === 0 ? 'Sin documentos en el periodo' : emptyTitle}
                    description={
                      rows.length === 0
                        ? 'No hay documentos registrados para el periodo seleccionado.'
                        : emptyDescription
                    }
                    action={
                      rows.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => onFiltersChange({})}
                          className="h-8 px-3 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors"
                        >
                          Limpiar filtros
                        </button>
                      ) : undefined
                    }
                  />
                </td>
              </tr>
            ) : (
              pageRows.map((r, i) => (
                <tr
                  key={`${r['Tipo de documento']}-${r.Folio}-${i}`}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cn(
                    'transition-colors',
                    onRowClick ? 'cursor-pointer hover:bg-canvas' : 'hover:bg-canvas/60'
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        'px-3 py-2 text-ink align-middle',
                        c.align === 'right' && 'text-right num',
                        c.align === 'center' && 'text-center'
                      )}
                    >
                      {c.render(r, (current - 1) * pageSize + i)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2.5 border-t border-line flex items-center justify-between text-[11px] text-ink-muted">
        <span className="num">
          Mostrando {formatNumber(from)}–{formatNumber(to)} de {formatNumber(sorted.length)} documentos
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, current - 1))}
            disabled={current === 1}
            className="w-7 h-7 inline-flex items-center justify-center border border-line rounded-md bg-surface disabled:opacity-40 hover:bg-canvas transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="num">
            {current} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, current + 1))}
            disabled={current === totalPages}
            className="w-7 h-7 inline-flex items-center justify-center border border-line rounded-md bg-surface disabled:opacity-40 hover:bg-canvas transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
