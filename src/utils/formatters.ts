import { parseRecordDate } from './period';

export function formatCurrency(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '$ 0';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatCompactNumber(amount: number): string {
  if (Math.abs(amount) >= 1_000_000_000) {
    return '$' + (amount / 1_000_000_000).toFixed(1).replace('.', ',') + ' mil M';
  }
  if (Math.abs(amount) >= 1_000_000) {
    return '$' + (amount / 1_000_000).toFixed(1).replace('.', ',') + ' M';
  }
  if (Math.abs(amount) >= 1_000) {
    return '$' + (amount / 1_000).toFixed(0) + ' k';
  }
  return formatCurrency(amount);
}

export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return '0';
  return new Intl.NumberFormat('es-CO').format(num);
}

export function formatPercent(value: number | undefined | null, digits = 1): string {
  if (value === undefined || value === null || isNaN(value)) return '—';
  return (
    new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value) + ' %'
  );
}

export function formatSignedPercent(value: number | undefined | null, digits = 1): string {
  if (value === undefined || value === null || isNaN(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value));
  return `${sign}${abs} %`;
}

/** Formatea fechas dd-mm-yyyy, yyyy-mm-dd o serial de Excel a dd/mm/aaaa */
export function formatDate(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '—';
  const parsed = parseRecordDate(value);
  if (parsed) {
    const dd = String(parsed.getDate()).padStart(2, '0');
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${parsed.getFullYear()}`;
  }
  return String(value).substring(0, 10);
}
