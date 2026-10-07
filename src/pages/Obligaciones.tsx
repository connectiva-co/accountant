import React from 'react';
import { CalendarClock } from 'lucide-react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { SectionHeader } from '../components/ui/SectionHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { formatCurrency } from '../utils/formatters';

export const Obligaciones: React.FC = () => {
  const { period, kpis, nav } = useApp();

  const obligaciones: { concepto: string; valor: number; nota: string }[] = [];
  if (Math.abs(kpis.ivaPorPagar) > 0) {
    obligaciones.push({
      concepto: `IVA estimado por pagar — ${period.label}`,
      valor: Math.abs(kpis.ivaPorPagar),
      nota: 'Fecha de vencimiento sin configurar',
    });
  }
  if (kpis.retencionesTotales > 0) {
    obligaciones.push({
      concepto: `Retenciones practicadas — ${period.label}`,
      valor: kpis.retencionesTotales,
      nota: 'Reporte de retenciones sin fecha configurada',
    });
  }

  return (
    <>
      <PageHeader title="Obligaciones" subtitle={`Obligaciones fiscales derivadas de ${period.label}`} />

      <Panel className="overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <SectionHeader
            title="Obligaciones del periodo"
            description="Valores calculados a partir de los documentos disponibles"
          />
        </div>

        {obligaciones.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Sin obligaciones calculadas"
            description="No se detectaron valores a pagar para el periodo seleccionado."
          />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-canvas border-b border-line text-[10px] uppercase tracking-[0.05em] text-ink-faint">
                <th className="text-left font-semibold px-4 py-2">Concepto</th>
                <th className="text-right font-semibold px-4 py-2">Valor estimado</th>
                <th className="text-left font-semibold px-4 py-2">Calendario</th>
                <th className="text-center font-semibold px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {obligaciones.map((o) => (
                <tr key={o.concepto} className="hover:bg-canvas">
                  <td className="px-4 py-2.5 text-ink">{o.concepto}</td>
                  <td className="px-4 py-2.5 text-right num font-semibold text-ink">
                    {formatCurrency(o.valor)}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{o.nota}</td>
                  <td className="px-4 py-2.5 text-center">
                    <StatusBadge estado="Pendiente" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel className="mt-3 px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <p className="text-[11px] text-ink-muted max-w-2xl">
            Las fechas de vencimiento y el calendario tributario se habilitan al conectar una fuente
            de datos de obligaciones. Los valores mostrados son estimaciones calculadas con los
            documentos electrónicos del periodo.
          </p>
          <button
            type="button"
            onClick={() => nav({ view: 'iva' })}
            className="h-8 shrink-0 px-3 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors"
          >
            Ver módulo IVA
          </button>
        </div>
      </Panel>
    </>
  );
};
