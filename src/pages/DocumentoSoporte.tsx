import React, { useMemo } from 'react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable } from '../components/ui/DataTable';
import { StatStrip } from '../components/ui/StatStrip';
import { supportDocColumns } from '../utils/columns';
import { classifyEstado, statusSummary } from '../utils/derivations';
import { formatCurrency, formatNumber } from '../utils/formatters';

export const DocumentoSoporte: React.FC = () => {
  const { periodRecords, period, filters, setFilters } = useApp();

  const rows = useMemo(
    () =>
      periodRecords.filter((r) => {
        const t = (r['Tipo de documento'] || '').toLowerCase();
        return t.includes('soporte') || t.includes('pos');
      }),
    [periodRecords]
  );
  const columns = useMemo(() => supportDocColumns(), []);

  const total = rows.reduce((a, r) => a + (r.Total || 0), 0);
  const status = statusSummary(rows);
  const aprobados = rows.filter((r) => classifyEstado(r.Estado) === 'aprobado').length;

  return (
    <>
      <PageHeader
        title="Documento soporte"
        subtitle={`${period.label} · ${formatNumber(rows.length)} documentos`}
      />

      <StatStrip
        items={[
          { label: 'Cantidad de documentos', value: formatNumber(rows.length) },
          { label: 'Valor total', value: formatCurrency(total) },
          { label: 'Notas de ajuste', value: '—', sub: 'Sin fuente de datos configurada' },
          {
            label: 'Estado DIAN',
            value: status.total === 0 ? '—' : `${formatNumber(aprobados)} aprobados`,
            sub: status.total === 0 ? 'Sin documentos' : `${formatNumber(status.total - aprobados)} con observación`,
          },
        ]}
      />

      <DataTable
        title="Documentos soporte y equivalentes"
        description="Pagos a personas no obligadas a facturar y documentos equivalentes de compra."
        rows={rows}
        columns={columns}
        filters={filters}
        onFiltersChange={setFilters}
        partySide="both"
        searchPlaceholder="Buscar por documento, tercero o NIT..."
        emptyTitle="Sin documentos de soporte"
        emptyDescription="No hay documentos soporte en el periodo seleccionado."
      />
    </>
  );
};
