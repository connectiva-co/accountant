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
    return '$' + (amount / 1_000_000_000).toFixed(2) + 'B';
  }
  if (Math.abs(amount) >= 1_000_000) {
    return '$' + (amount / 1_000_000).toFixed(2) + 'M';
  }
  if (Math.abs(amount) >= 1_000) {
    return '$' + (amount / 1_000).toFixed(1) + 'K';
  }
  return formatCurrency(amount);
}

export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return '0';
  return new Intl.NumberFormat('es-CO').format(num);
}
