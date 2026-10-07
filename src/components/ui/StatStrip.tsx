import React from 'react';
import { Panel } from './Panel';
import { cn } from '../../utils/cn';

export interface StatItem {
  label: string;
  value: string;
  sub?: string;
}

interface StatStripProps {
  items: StatItem[];
  className?: string;
}

export const StatStrip: React.FC<StatStripProps> = ({ items, className }) => (
  <Panel className={cn('px-4 py-2.5 mb-3', className)}>
    <div className="flex flex-wrap gap-y-2">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn(
            'flex-1 min-w-[160px] px-4 first:pl-0',
            i > 0 && 'border-l border-line'
          )}
        >
          <div className="text-[10px] uppercase tracking-[0.05em] text-ink-faint font-semibold">
            {item.label}
          </div>
          <div className="num text-[15px] font-semibold text-ink mt-0.5">{item.value}</div>
          {item.sub && <div className="text-[11px] text-ink-muted num mt-0.5">{item.sub}</div>}
        </div>
      ))}
    </div>
  </Panel>
);
