import React, { useMemo } from 'react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable } from '../components/ui/DataTable';
import { StatStrip } from '../components/ui/StatStrip';
import { filterRecords } from '../utils/radianEngine';
import { invoiceColumns } from '../utils/columns';
import { formatCurrency, formatNumber } from '../utils/formatters';

export const Ventas: React.FC = () => {
  const { periodRecords, period, filters, setFilters, kpis } = useApp();
  const rows = useMemo(() => filterRecords(periodRecords, 'ventas'), [periodRecords]);
  const columns = useMemo(() => invoiceColumns('receptor'), []);

  return (
    <>
      <PageHeader
        title="Ventas"
        subtitle={`${period.label} · ${formatNumber(rows.length)} facturas emitidas`}
      />

      <StatStrip
        items={[
          { label: 'Total facturado', value: formatCurrency(kpis.totalVentasBrutas) },
          { label: 'Base gravable', value: formatCurrency(kpis.totalVentasBase) },
          { label: 'IVA generado', value: formatCurrency(kpis.totalVentasIVA) },
          {
            label: 'Notas crédito emitidas',
            value: formatCurrency(kpis.totalNotasCreditoEmitidas),
            sub: `${formatNumber(periodRecords.filter((r) => (r['Tipo de documento'] || '').toLowerCase().includes('nota de cr') && (r['Grupo'] || '').toLowerCase() === 'emitido').length)} documentos`,
          },
        ]}
      />

      <DataTable
        title="Facturas electrónicas de venta"
        description="Emisor: la empresa actual. Base gravable calculada sobre el total del documento."
        rows={rows}
        columns={columns}
        filters={filters}
        onFiltersChange={setFilters}
        partySide="receptor"
        searchPlaceholder="Buscar por folio, cliente o NIT..."
        emptyTitle="Sin facturas de venta"
        emptyDescription="No hay facturas emitidas que coincidan con los filtros del periodo."
      />
    </>
  );
};
