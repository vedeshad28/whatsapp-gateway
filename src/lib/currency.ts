/**
 * Currency — single source of truth for deal-value formatting and the
 * currency picker options. Ported verbatim from wacrm; the default
 * currency is per-workspace (`Workspace.defaultCurrency`, mirrors the
 * old `accounts.default_currency`), so every formatter takes a
 * currency and falls back to DEFAULT_CURRENCY only when nothing is
 * known.
 */

/** App-wide fallback when no workspace/deal currency is available. */
export const DEFAULT_CURRENCY = 'USD';

export interface CurrencyOption {
  /** ISO-4217 code, e.g. "USD". Stored verbatim in the DB. */
  code: string;
  /** Human label for the dropdown, e.g. "US Dollar". */
  label: string;
  /** Symbol for compact display, e.g. "$". */
  symbol: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'GBP', label: 'British Pound', symbol: '£' },
  { code: 'INR', label: 'Indian Rupee', symbol: '₹' },
  { code: 'AUD', label: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', label: 'Canadian Dollar', symbol: 'C$' },
  { code: 'BRL', label: 'Brazilian Real', symbol: 'R$' },
  { code: 'JPY', label: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', label: 'Chinese Yuan', symbol: '¥' },
  { code: 'AED', label: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'ZAR', label: 'South African Rand', symbol: 'R' },
  { code: 'NGN', label: 'Nigerian Naira', symbol: '₦' },
  { code: 'SGD', label: 'Singapore Dollar', symbol: 'S$' },
  { code: 'MXN', label: 'Mexican Peso', symbol: '$' },
];

/**
 * Format a deal value as a currency string (whole numbers only).
 * Never throws: `Intl.NumberFormat` rejects structurally invalid
 * currency codes, and nothing constrains `currency` to a real ISO
 * code at the DB layer, so a bad code falls back to "CODE 1,234".
 */
export function formatCurrency(
  value: number,
  currency: string = DEFAULT_CURRENCY
): string {
  const code = (currency || DEFAULT_CURRENCY).trim();
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${code} ${new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(amount)}`;
  }
}

/** Compact currency for tight spaces: "$1.2M" / "€34.5k" / "₹900". */
export function formatCurrencyShort(
  value: number,
  currency: string = DEFAULT_CURRENCY
): string {
  const code = currency || DEFAULT_CURRENCY;
  const symbol = CURRENCIES.find((c) => c.code === code)?.symbol ?? `${code} `;
  return `${symbol}${formatCompactNumber(value)}`;
}

/** Compact number for tight spaces: 1_234 → "1.2k", 1_200_000 → "1.2M". */
export function formatCompactNumber(value: number): string {
  const v = Number(value || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}
