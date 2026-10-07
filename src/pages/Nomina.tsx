import React, { useMemo } from 'react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable } from '../components/ui/DataTable';
import { StatStrip } from '../components/ui/StatStrip';
import { Panel } from '../components/ui/Panel';
import { payrollColumns } from '../utils/columns';
import { formatCurrency, formatNumber } from '../utils/formatters';

export const Nomina: React.FC = () => {
  const { periodRecords, period, filters, setFilters } = useApp();

  const rows = useMemo(
    () => periodRecords.filter((r) => (r['Tipo de documento'] || '').toLowerCase().includes('nomina')),
    [periodRecords]
  );
  const columns = useMemo(() => payrollColumns(), []);

  const employees = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>();
    for (const r of rows) {
      const nit = String(r['NIT Receptor'] || '');
      const cur = map.get(nit) || { name: r['Nombre Receptor'] || '', total: 0 };
      cur.total += r.Total || 0;
      map.set(nit, cur);
    }
    return map;
  }, [rows]);

  const devengado = rows.reduce((a, r) => a + (r.Total || 0), 0);
  const count = employees.size;
  const promedio = count ? devengado / count : 0;
  const mayor = Array.from(employees.entries()).sort((a, b) => b[1].total - a[1].total)[0];

  return (
    <>
      <PageHeader
        title="Nómina"
        subtitle={`${period.label} · nómina electrónica individual`}
      />

      <StatStrip
        items={[
          { label: 'Empleados', value: formatNumber(count) },
          { label: 'Devengado total', value: formatCurrency(devengado) },
          { label: 'Promedio por empleado', value: formatCurrency(promedio) },
          {
            label: 'Mayor valor devengado',
            value: mayor ? formatCurrency(mayor[1].total) : '—',
            sub: mayor ? mayor[1].name : 'Sin datos',
          },
        ]}
      />

      <DataTable
        title="Comprobantes de nómina electrónica"
        description="Documentos individuales de nómina emitidos en el periodo."
        rows={rows}
        columns={columns}
        filters={filters}
        onFiltersChange={setFilters}
        partySide="receptor"
        searchPlaceholder="Buscar por documento, empleado o identificación..."
        emptyTitle="Sin comprobantes de nómina"
        emptyDescription="No hay nómina registrada en el periodo seleccionado."
      />

      <Panel className="mt-3 px-4 py-2.5">
        <p className="text-[11px] text-ink-muted">
          Deducciones, seguridad social, prestaciones y novedades se muestran cuando la fuente de
          datos activa incluye estos campos.
        </p>
      </Panel>
    </>
  );
};
