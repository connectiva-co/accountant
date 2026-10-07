import React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { formatSignedPercent } from '../../utils/formatters';
import { cn } from '../../utils/cn';

interface TrendIndicatorProps {
  /** Variación porcentual vs. periodo de comparación */
  value: number | null;
  compareLabel?: string;
  className?: string;
}

export const TrendIndicator: React.FC<TrendIndicatorProps> = ({ value, compareLabel, className }) => {
  if (value === null || !isFinite(value)) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[11px] text-ink-faint', className)}>
        <Minus className="w-3 h-3" />
        Sin comparación
      </span>
    );
  }

  const up = value > 0.05;
  const down = value < -0.05;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium num',
        up && 'text-success',
        down && 'text-danger',
        !up && !down && 'text-ink-muted',
        className
      )}
    >
      <Icon className="w-3 h-3" />
      {formatSignedPercent(value)}
      {compareLabel && <span className="text-ink-faint font-normal">vs. {compareLabel}</span>}
    </span>
  );
};
