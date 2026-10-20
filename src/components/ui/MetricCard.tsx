import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';
import { TrendIndicator } from './TrendIndicator';

interface MetricCardProps {
  label: string;
  value: string;
  sublabel?: string;
  trend?: number | null;
  compareLabel?: string;
  footnote?: React.ReactNode;
  onClick?: () => void;
  size?: 'default' | 'compact';
  className?: string;
  loading?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  sublabel,
  trend,
  compareLabel,
  footnote,
  onClick,
  size = 'default',
  className,
  loading = false,
}) => {
  if (loading) {
    return (
      <div className={cn('bg-surface border border-line rounded-card shadow-card px-4 py-3.5 animate-pulse', className)}>
        <div className="flex items-center justify-between gap-2">
          <div className="h-3 w-20 bg-line rounded" />
          <div className="w-3.5 h-3.5 bg-line/60 rounded-full shrink-0" />
        </div>
        <div className={cn('bg-line rounded mt-2.5 mb-2', size === 'default' ? 'h-7 w-32' : 'h-6 w-24')} />
        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="h-3 w-16 bg-line rounded" />
          <div className="h-3 w-20 bg-line/60 rounded" />
        </div>
      </div>
    );
  }
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-ink-faint truncate">
          {label}
        </span>
        {onClick && <ChevronRight className="w-3.5 h-3.5 text-ink-faint shrink-0" />}
      </div>

      <div
        className={cn(
          'num font-semibold text-ink tracking-tight mt-1.5',
          size === 'default' ? 'text-[21px] leading-7' : 'text-[17px] leading-6'
        )}
      >
        {value}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 min-h-[16px]">
        {trend !== undefined ? (
          <TrendIndicator value={trend} compareLabel={compareLabel} />
        ) : (
          <span />
        )}
        {footnote && <span className="text-[11px] text-ink-muted num truncate">{footnote}</span>}
      </div>

      {sublabel && <div className="mt-1 text-[11px] text-ink-muted">{sublabel}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'w-full text-left bg-surface border border-line rounded-card shadow-card px-4 py-3.5',
          'transition-colors hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30',
          className
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={cn('bg-surface border border-line rounded-card shadow-card px-4 py-3.5', className)}>
      {content}
    </div>
  );
};
