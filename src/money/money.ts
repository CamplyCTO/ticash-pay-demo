import { Currency, scaleOf } from './currency';

/**
 * Money is always represented as BigInt minor units. No floating point ever
 * touches a monetary value. All helpers here are exact.
 */

const POW10: bigint[] = Array.from({ length: 19 }, (_, i) => 10n ** BigInt(i));

function pow10(n: number): bigint {
  if (n < 0) throw new Error(`negative power: ${n}`);
  return n < POW10.length ? (POW10[n] as bigint) : 10n ** BigInt(n);
}

/**
 * Parse a decimal string ("1234.56") or integer-major number into minor units
 * for the given currency. Rejects values with more decimals than the currency scale.
 */
export function toMinor(amount: string | number | bigint, currency: Currency): bigint {
  if (typeof amount === 'bigint') return amount; // already minor units
  const scale = scaleOf(currency);
  const str = typeof amount === 'number' ? numberToDecimalString(amount) : amount.trim();

  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(str);
  if (!match) throw new Error(`Invalid money amount: "${str}"`);

  const sign = match[1] ? -1n : 1n;
  const whole = match[2] as string;
  const frac = match[3] ?? '';
  if (frac.length > scale) {
    throw new Error(`Amount "${str}" has more precision than ${currency} (scale ${scale})`);
  }
  const fracPadded = frac.padEnd(scale, '0');
  const minor = BigInt(whole) * pow10(scale) + (fracPadded ? BigInt(fracPadded) : 0n);
  return sign * minor;
}

/** Render minor units back to a fixed-decimal string ("1234.56"). */
export function fromMinor(minor: bigint, currency: Currency): string {
  const scale = scaleOf(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const divisor = pow10(scale);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const body = scale === 0 ? `${whole}` : `${whole}.${frac.toString().padStart(scale, '0')}`;
  return negative ? `-${body}` : body;
}

/** Human formatting with the currency symbol, e.g. "R$ 1.240,00" style left to UI. */
export function formatMoney(minor: bigint, currency: Currency): string {
  return `${fromMinor(minor, currency)} ${currency}`;
}

/**
 * Convert an amount across currencies at a given rate, with HALF-UP rounding.
 * `rate` is a decimal string of "to per from" (e.g. BRL->HTG "24.36").
 * Pure integer math: no float rounding error.
 */
export function convert(
  fromMinorAmount: bigint,
  from: Currency,
  to: Currency,
  rate: string,
): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!m) throw new Error(`Invalid rate: "${rate}"`);
  const rateWhole = m[1] as string;
  const rateFrac = m[2] ?? '';
  const rateScaled = BigInt(rateWhole + rateFrac); // rate * 10^rateScale
  const rateScale = rateFrac.length;

  const fromScale = scaleOf(from);
  const toScale = scaleOf(to);

  // result_minor = from_minor * rate * 10^toScale / (10^fromScale * 10^rateScale)
  const numerator = fromMinorAmount * rateScaled * pow10(toScale);
  const denominator = pow10(fromScale) * pow10(rateScale);
  return roundHalfUpDiv(numerator, denominator);
}

/** Integer division rounding half away from zero. */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = abs / denominator;
  const r = abs % denominator;
  const rounded = r * 2n >= denominator ? q + 1n : q;
  return negative ? -rounded : rounded;
}

function numberToDecimalString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid money number: ${n}`);
  // Avoid scientific notation for typical monetary magnitudes.
  return Number.isInteger(n) ? n.toFixed(0) : n.toString();
}
