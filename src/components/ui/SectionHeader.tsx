import React from 'react';
import { cn } from '../../utils/cn';

interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, description, action, className }) => (
  <div className={cn('flex items-start justify-between gap-4', className)}>
    <div className="min-w-0">
      <h2 className="text-[13px] font-semibold text-ink leading-tight">{title}</h2>
      {description && <p className="text-xs text-ink-muted mt-0.5">{description}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
