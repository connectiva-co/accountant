import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { cn } from '../../utils/cn';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, icon: Icon = Inbox, action, className }) => (
  <div className={cn('flex flex-col items-center justify-center text-center px-6 py-10', className)}>
    <div className="w-9 h-9 rounded-card border border-line bg-canvas flex items-center justify-center text-ink-faint">
      <Icon className="w-4 h-4" />
    </div>
    <p className="mt-3 text-[13px] font-medium text-ink">{title}</p>
    {description && <p className="mt-1 text-xs text-ink-muted max-w-sm">{description}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);
