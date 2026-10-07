import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { AttentionItemData } from '../../types/radian';

const severityDot: Record<AttentionItemData['severity'], string> = {
  error: 'bg-danger',
  warning: 'bg-warning',
  neutral: 'bg-gray-400',
};

interface AttentionItemProps {
  item: AttentionItemData;
  onClick: () => void;
}

export const AttentionItem: React.FC<AttentionItemProps> = ({ item, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-line last:border-b-0 text-left transition-colors hover:bg-canvas focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/30"
  >
    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', severityDot[item.severity])} />
    <span className="flex-1 text-[13px] text-ink">{item.label}</span>
    <span className="num text-[11px] text-ink-faint">{item.count}</span>
    <ChevronRight className="w-3.5 h-3.5 text-ink-faint" />
  </button>
);
