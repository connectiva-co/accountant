import React, { useMemo } from 'react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable, type ColumnDef } from '../components/ui/DataTable';
import { StatStrip } from '../components/ui/StatStrip';
import { formatCurrency, formatNumber, formatPercent, formatDate } from '../utils/formatters';

interface RetentionInfo {
  concepts: string[];
  valor: number;
}

function retentionOf(r: { 'Rete Renta'?: number; 'Rete IVA'?: number; 'Rete ICA'?: number }): RetentionInfo {
  const concepts: string[] = [];
  let valor = 0;
  if ((r['Rete Renta'] || 0) > 0) {
    concepts.push('Retención en la fuente');
    valor += r['Rete Renta'] || 0;
  }
  if ((r['Rete IVA'] || 0) > 0) {
    concepts.push('ReteIVA');
    valor += r['Rete IVA'] || 0;
  }
  if ((r['Rete ICA'] || 0) > 0) {
    concepts.push('ReteICA');
    valor += r['Rete ICA'] || 0;
  }
  return { concepts, valor };
}

export const Retenciones: React.FC = () => {
  const { periodRecords, period, filters, setFilters, kpis } = useApp();

  const rows = useMemo(() => periodRecords.filter((r) => retentionOf(r).valor > 0), [periodRecords]);

  const columns = useMemo<ColumnDef[]>(
    () => [
      {
        key: 'concepto',
        header: 'Concepto',
        sortValue: (r) => retentionOf(r).concepts.join(', '),
        render: (r) => (
          <span className="block text-ink">
            {retentionOf(r).concepts.map((c) => (
              <span key={c} className="block">
                {c}
              </span>
            ))}
          </span>
        ),
      },
      {
        key: 'base',
        header: 'Base',
        align: 'right',
        sortValue: (r) => r.baseCalculada || 0,
        render: (r) => <span className="num text-ink-muted">{formatCurrency(r.baseCalculada || 0)}</span>,
      },
      {
        key: 'tarifa',
        header: 'Tarifa',
        align: 'right',
        sortValue: (r) => {
          const info = retentionOf(r);
          return info.concepts.length === 1 && r.baseCalculada ? (info.valor / r.baseCalculada) * 100 : 0;
        },
        render: (r) => {
          const info = retentionOf(r);
          if (info.concepts.length === 1 && r.baseCalculada) {
            return (
              <span className="num text-ink">
                {formatPercent((info.valor / r.baseCalculada) * 100, 2)}
              </span>
            );
          }
          return <span className="text-ink-faint">—</span>;
        },
      },
      {
        key: 'valor',
        header: 'Valor retenido',
        align: 'right',
        sortValue: (r) => retentionOf(r).valor,
        render: (r) => (
          <span className="num font-semibold text-ink">{formatCurrency(retentionOf(r).valor)}</span>
        ),
      },
      {
        key: 'tercero',
        header: 'Tercero',
        sortValue: (r) => String(r['Nombre Receptor'] || ''),
        render: (r) => (
          <span className="block truncate max-w-[200px] text-ink">
            {(r['Grupo'] || '').toLowerCase() === 'emitido'
              ? r['Nombre Receptor'] || '—'
              : r['Nombre Emisor'] || '—'}
          </span>
        ),
      },
      {
        key: 'documento',
        header: 'Documento',
        sortValue: (r) => String(r.Folio),
        render: (r) => (
          <span className="num text-ink-muted">
            {r.Prefijo ? `${r.Prefijo}-${r.Folio}` : r.Folio}
          </span>
        ),
      },
      {
        key: 'fecha',
        header: 'Fecha',
        sortValue: (r) => String(r['Fecha Emisión'] || ''),
        render: (r) => <span className="num text-ink-muted">{formatDate(r['Fecha Emisión'])}</span>,
      },
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="Retenciones"
        subtitle={`${period.label} · retenciones practicadas en el periodo`}
      />

      <StatStrip
        items={[
          { label: 'Retención en la fuente', value: formatCurrency(kpis.retencionesFuente) },
          { label: 'ReteIVA', value: formatCurrency(kpis.retencionesIVA) },
          { label: 'ReteICA', value: formatCurrency(kpis.retencionesICA) },
          { label: 'Autorretenciones', value: '—', sub: 'Sin fuente de datos' },
          {
            label: 'Total retenido',
            value: formatCurrency(kpis.retencionesTotales),
            sub: `${formatNumber(rows.length)} documentos`,
          },
        ]}
      />

      <DataTable
        title="Detalle de retenciones"
        description="Una fila por documento con retención practicada en el periodo."
        rows={rows}
        columns={columns}
        filters={filters}
        onFiltersChange={setFilters}
        partySide="both"
        searchPlaceholder="Buscar por concepto, tercero o documento..."
        emptyTitle="Sin retenciones en el periodo"
        emptyDescription="No se registraron retenciones de fuente, IVA o ICA sobre los documentos del periodo seleccionado."
        showIvaToggle={false}
      />
    </>
  );
};
