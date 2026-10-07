import React from 'react';
import { cn } from '../../utils/cn';
import { classifyEstado } from '../../utils/derivations';

const styles: Record<string, string> = {
  aprobado: 'bg-success/10 text-success border-success/20',
  pendiente: 'bg-warning/10 text-warning border-warning/20',
  rechazado: 'bg-danger/10 text-danger border-danger/20',
  inconsistente: 'bg-gray-100 text-ink-muted border-gray-200',
};

interface StatusBadgeProps {
  estado?: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ estado, className }) => {
  const label = estado && estado.trim() ? estado : 'Sin estado';
  const kind = classifyEstado(estado);
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap',
        styles[kind],
        className
      )}
    >
      {label}
    </span>
  );
};
