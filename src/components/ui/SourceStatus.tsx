import React from 'react';
import { cn } from '../../utils/cn';
import { CheckCircle2, CircleDashed, AlertCircle } from 'lucide-react';

export type SourceState = 'connected' | 'partial' | 'disconnected';

const stateMeta: Record<SourceState, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  connected: { label: 'Conectado', className: 'text-success', icon: CheckCircle2 },
  partial: { label: 'Datos parciales', className: 'text-warning', icon: CircleDashed },
  disconnected: { label: 'Sin conexión', className: 'text-ink-faint', icon: AlertCircle },
};

interface SourceStatusProps {
  name: string;
  state: SourceState;
  meta?: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
}

export const SourceStatus: React.FC<SourceStatusProps> = ({ name, state, meta, detail, action }) => {
  const { label, className, icon: Icon } = stateMeta[state];
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5 border-b border-line last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink truncate">{name}</span>
          <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', className)}>
            <Icon className="w-3.5 h-3.5" />
            {label}
          </span>
        </div>
        {meta && <div className="mt-0.5 text-xs text-ink-muted num">{meta}</div>}
        {detail && <div className="mt-0.5 text-[11px] text-ink-faint">{detail}</div>}
      </div>
      {action}
    </div>
  );
};
