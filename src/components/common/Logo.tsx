import React from 'react';
import { APP_NAME } from '../../config/company';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  light?: boolean;
  className?: string;
}

export const AccountantLogo: React.FC<LogoProps> = ({
  size = 'md',
  showText = true,
  light = false,
  className = '',
}) => {
  const sizeMap = {
    sm: { box: 'w-6 h-6 rounded-md', icon: 'w-3.5 h-3.5', text: 'text-[13px]', dot: 'w-1.5 h-1.5' },
    md: { box: 'w-7 h-7 rounded-lg', icon: 'w-4 h-4', text: 'text-[14.5px]', dot: 'w-1.5 h-1.5' },
    lg: { box: 'w-10 h-10 rounded-xl', icon: 'w-5 h-5', text: 'text-xl', dot: 'w-2 h-2' },
    xl: { box: 'w-16 h-16 rounded-2xl shadow-xl shadow-brand-900/40', icon: 'w-9 h-9', text: 'text-3xl', dot: 'w-2.5 h-2.5' },
  };

  const s = sizeMap[size];

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Geometric Ledger Emblem */}
      <div
        className={`${s.box} bg-gradient-to-br from-emerald-400 via-brand to-brand-700 flex items-center justify-center text-white shadow-sm shrink-0 relative overflow-hidden ring-1 ring-white/20`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${s.icon} text-white`}
        >
          {/* Stylized fiscal columns & geometric balance mark */}
          <rect x="3" y="4" width="7" height="16" rx="1.5" fill="currentColor" fillOpacity="0.95" />
          <rect x="14" y="4" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.95" />
          <rect x="14" y="13" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.45" />
          <circle cx="6.5" cy="8.5" r="1.25" fill="#0C5243" />
        </svg>
      </div>

      {showText && (
        <div className="flex items-center gap-1.5 leading-none">
          <span
            className={`${s.text} font-bold tracking-tight ${light ? 'text-white' : 'text-ink'
              }`}
          >
            {APP_NAME}
          </span>
        </div>
      )}
    </div>
  );
};
