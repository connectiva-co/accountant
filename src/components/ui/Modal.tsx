import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  busy?: boolean;
}

export const Modal: React.FC<ModalProps> = ({ title, subtitle, onClose, children, footer, className, busy }) => (
  <div
    className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6 bg-ink/40"
    role="dialog"
    aria-modal="true"
  >
    <div className={cn('w-full bg-surface border border-line rounded-card shadow-dropdown mt-[5vh]', className)}>
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-line">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
          {subtitle && <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => !busy && onClose()}
          disabled={busy}
          className="text-ink-faint hover:text-ink p-1 rounded-md hover:bg-canvas transition-colors disabled:opacity-40 shrink-0"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
      {footer && <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line">{footer}</div>}
    </div>
  </div>
);
