import { CURRENCIES, type Currency, scaleOf, symbolOf } from './currency';

export interface MoneyParts {
  code: Currency;
  symbol: string;
  integer: string; // grouped, e.g. "1.240"
  fraction: string; // e.g. "00"
  negative: boolean;
}

/**
 * Format a minor-unit amount (string, as the API serialises BigInt) into display
 * parts. Pure integer string math — no float. Grouping with '.', fraction kept
 * to the currency scale (USDT scale 6 trimmed to 2 for display).
 */
export function formatMoneyParts(minor: string | number | bigint, currency: Currency): MoneyParts {
  const scale = scaleOf(currency);
  let n = typeof minor === 'bigint' ? minor : BigInt(typeof minor === 'number' ? Math.trunc(minor) : minor.trim() || '0');
  const negative = n < 0n;
  if (negative) n = -n;
  const divisor = 10n ** BigInt(scale);
  const whole = (n / divisor).toString();
  let frac = scale > 0 ? (n % divisor).toString().padStart(scale, '0') : '';
  // Display at most 2 fraction digits (USDT's 6 are exact internally, noisy on screen).
  if (frac.length > 2) frac = frac.slice(0, 2);
  return { code: currency, symbol: symbolOf(currency), integer: group(whole), fraction: frac, negative };
}

/** "1240.00"-style plain string (no symbol/grouping) for inputs/quotes. */
export function formatPlain(minor: string | bigint, currency: Currency): string {
  const p = formatMoneyParts(minor, currency);
  const body = p.fraction ? `${p.integer.replace(/\./g, '')}.${p.fraction}` : p.integer.replace(/\./g, '');
  return p.negative ? `-${body}` : body;
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export { CURRENCIES };
