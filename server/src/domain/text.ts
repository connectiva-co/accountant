/** Normaliza para comparación: sin acentos, espacios colapsados, minúsculas. */
export function norm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** NIT sin formato ('900.555.053-8' -> '9005550538' conservando DV). */
export function normalizeTaxId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim().replace(/\.0$/, '');
  if (!raw) return null;
  const cleaned = raw.replace(/[^\dA-Za-z]/g, '');
  return cleaned || null;
}

/** Dígitos únicamente, para comparar NITs de forma agnóstica al formato. */
export function taxIdDigits(value: unknown): string | null {
  const id = normalizeTaxId(value);
  if (!id) return null;
  const digits = id.replace(/\D/g, '');
  return digits || null;
}

/** Regla del frontend: 6 a 10 dígitos. */
export function isValidNit(value: unknown): boolean {
  const digits = taxIdDigits(value);
  if (!digits) return false;
  return digits.length >= 6 && digits.length <= 10;
}

const PLACEHOLDER_NITS = new Set(['222222222222', '9999999999999', '0', '111111111', '900000000']);
const PLACEHOLDER_NAMES = ['consumidor final', 'cliente final', 'genérico', 'publico en general', 'varios'];

export function isPlaceholderNit(value: unknown): boolean {
  const digits = taxIdDigits(value);
  if (!digits) return true;
  return PLACEHOLDER_NITS.has(digits);
}

export function isPlaceholderName(value: unknown): boolean {
  const n = norm(value);
  if (!n) return true;
  return PLACEHOLDER_NAMES.some((p) => n === p || n.startsWith(p));
}

/** Nombre tal cual (solo colapsa espacios): se guarda para mostrar. */
export function cleanName(value: unknown): string | null {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  return raw || null;
}

/** Clave de comparación de nombres: mayúsculas, sin acentos ni puntuación. */
export function nameKey(value: unknown): string | null {
  const clean = cleanName(value);
  if (!clean) return null;
  return clean
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Serialización determinista: claves ordenadas, sin dependencia del orden
 * de inserción. Dos importaciones del mismo documento producen el mismo string
 * (y por tanto el mismo SHA-256).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Suma robusta de importes: cualquier valor ilegible cuenta como 0 (nunca se inventa). */
export function parseAmount(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    const ones = (s.match(/,/g) || []).length;
    s = ones === 1 && decimals > 0 && decimals <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const decimals = s.length - lastDot - 1;
    const ones = (s.match(/\./g) || []).length;
    if (ones > 1 || decimals === 3) s = s.replace(/\./g, '');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
