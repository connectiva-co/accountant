import React, { useMemo } from 'react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable } from '../components/ui/DataTable';
import { StatStrip } from '../components/ui/StatStrip';
import { filterRecords } from '../utils/radianEngine';
import { invoiceColumns } from '../utils/columns';
import { formatCurrency, formatNumber } from '../utils/formatters';

export const Compras: React.FC = () => {
  const { periodRecords, period, filters, setFilters, kpis } = useApp();
  const rows = useMemo(() => filterRecords(periodRecords, 'compras'), [periodRecords]);
  const columns = useMemo(() => invoiceColumns('emisor'), []);

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle={`${period.label} · ${formatNumber(rows.length)} facturas recibidas`}
      />

      <StatStrip
        items={[
          { label: 'Total comprado', value: formatCurrency(kpis.totalComprasBrutas) },
          { label: 'Base gravable', value: formatCurrency(kpis.totalComprasBase) },
          { label: 'IVA descontable', value: formatCurrency(kpis.totalComprasIVA) },
          {
            label: 'Notas crédito recibidas',
            value: formatCurrency(kpis.totalNotasCreditoRecibidas),
            sub: `${formatNumber(periodRecords.filter((r) => (r['Tipo de documento'] || '').toLowerCase().includes('nota de cr') && (r['Grupo'] || '').toLowerCase() === 'recibido').length)} documentos`,
          },
        ]}
      />

      <DataTable
        title="Facturas electrónicas de compra"
        description="Documentos recibidos de proveedores con IVA acreditable."
        rows={rows}
        columns={columns}
        filters={filters}
        onFiltersChange={setFilters}
        partySide="emisor"
        searchPlaceholder="Buscar por folio, proveedor o NIT..."
        emptyTitle="Sin facturas de compra"
        emptyDescription="No hay facturas recibidas que coincidan con los filtros del periodo."
      />
    </>
  );
};
