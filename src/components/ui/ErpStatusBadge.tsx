import React from 'react';
import { cn } from '../../utils/cn';

export interface ErpStatusBadgeProps {
  status?: 'NOT_CHECKED' | 'MATCHED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'ERROR' | string;
  externalNumber?: string | null;
  errorMessage?: string | null;
  className?: string;
}

export const ErpStatusBadge: React.FC<ErpStatusBadgeProps> = ({ status = 'NOT_CHECKED', externalNumber, errorMessage, className }) => {
  switch (status) {
    case 'MATCHED':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-400',
            className
          )}
          title={externalNumber ? `Registrada en Siigo: ${externalNumber}` : 'Registrada y contabilizada en Siigo'}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          En Siigo
        </span>
      );
    case 'NOT_FOUND':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap bg-amber-500/10 text-amber-700 border-amber-500/25 dark:text-amber-400',
            className
          )}
          title="Factura DIAN no encontrada en Siigo"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          Pendiente ERP
        </span>
      );
    case 'AMBIGUOUS':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap bg-indigo-500/10 text-indigo-700 border-indigo-500/25 dark:text-indigo-400',
            className
          )}
          title="Múltiples coincidencias en Siigo"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
          Ambiguo
        </span>
      );
    case 'ERROR':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap bg-rose-500/10 text-rose-700 border-rose-500/25 dark:text-rose-400',
            className
          )}
          title={errorMessage ? `Error de Siigo: ${errorMessage}` : "Error al consultar en Siigo"}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
          Error ERP
        </span>
      );
    default:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap bg-canvas text-ink-muted border-line',
            className
          )}
          title="Sin cotejar aún contra el ERP"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-ink-faint shrink-0" />
          Sin cotejar
        </span>
      );
  }
};
