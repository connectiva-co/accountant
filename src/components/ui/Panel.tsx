import React from 'react';
import { cn } from '../../utils/cn';

interface PanelProps {
  children: React.ReactNode;
  className?: string;
}

export const Panel: React.FC<PanelProps> = ({ children, className }) => (
  <section className={cn('bg-surface border border-line rounded-card shadow-card', className)}>
    {children}
  </section>
);
