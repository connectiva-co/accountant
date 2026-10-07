import React from 'react';
import { cn } from '../../utils/cn';

interface MetricGroupProps {
  children: React.ReactNode;
  columns?: 3 | 4 | 5;
  className?: string;
}

const gridByColumns: Record<number, string> = {
  3: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
};

export const MetricGroup: React.FC<MetricGroupProps> = ({ children, columns = 4, className }) => (
  <div className={cn('grid gap-3', gridByColumns[columns], className)}>{children}</div>
);
