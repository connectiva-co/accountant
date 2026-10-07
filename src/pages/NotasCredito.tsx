import React, { useMemo } from 'react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable } from '../components/ui/DataTable';
import { StatStrip } from '../components/ui/StatStrip';
import { filterRecords } from '../utils/radianEngine';
import { creditNoteColumns } from '../utils/columns';
import { formatCurrency, formatNumber } from '../utils/formatters';

export const NotasCredito: React.FC = () => {
  const { periodRecords, period, filters, setFilters, kpis } = useApp();
  const rows = useMemo(() => filterRecords(periodRecords, 'notas_credito'), [periodRecords]);
  const columns = useMemo(() => creditNoteColumns(), []);

  const emitidas = rows.filter((r) => (r['Grupo'] || '').toLowerCase() === 'emitido').length;
  const recibidas = rows.length - emitidas;

  return (
    <>
      <PageHeader
        title="Notas crédito"
        subtitle={`${period.label} · ${formatNumber(rows.length)} documentos`}
      />

      <StatStrip
        items={[
          { label: 'Total notas crédito', value: formatCurrency(kpis.totalNotasCreditoEmitidas + kpis.totalNotasCreditoRecibidas) },
          { label: 'Emitidas', value: formatCurrency(kpis.totalNotasCreditoEmitidas), sub: `${formatNumber(emitidas)} documentos` },
          { label: 'Recibidas', value: formatCurrency(kpis.totalNotasCreditoRecibidas), sub: `${formatNumber(recibidas)} documentos` },
          { label: 'IVA asociado', value: formatCurrency(kpis.ncEmitidasIVA + kpis.ncRecibidasIVA) },
        ]}
      />

      <DataTable
        title="Notas crédito electrónicas"
        description="Devoluciones y ajustes que modifican la base gravable de ventas o compras."
        rows={rows}
        columns={columns}
        filters={filters}
        onFiltersChange={setFilters}
        partySide="both"
        searchPlaceholder="Buscar por número, tercero o NIT..."
        emptyTitle="Sin notas crédito"
        emptyDescription="No hay notas crédito registradas en el periodo seleccionado."
      />
    </>
  );
};
