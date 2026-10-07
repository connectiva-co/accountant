import React from 'react';
import { cn } from '../../utils/cn';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions, className }) => (
  <div className={cn('flex flex-wrap items-end justify-between gap-3 mb-4', className)}>
    <div>
      <h1 className="text-[17px] font-semibold text-ink tracking-tight leading-tight">{title}</h1>
      {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);
