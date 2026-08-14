/**
 * Currency catalogue.
 *
 * Fiat currencies use ISO 4217 codes; USDT is an internal asset code (not ISO 4217).
 * `scale` is the number of decimal places stored as integer minor units
 * (e.g. BRL scale 2 -> R$ 1.00 == 100 minor units).
 */
export const CURRENCIES = {
  BRL: { scale: 2, symbol: 'R$', kind: 'fiat' },
  HTG: { scale: 2, symbol: 'G', kind: 'fiat' }, // Haitian gourde
  USD: { scale: 2, symbol: '$', kind: 'fiat' },
  DOP: { scale: 2, symbol: 'RD$', kind: 'fiat' }, // Dominican peso
  MXN: { scale: 2, symbol: 'MX$', kind: 'fiat' }, // Mexican peso
  USDT: { scale: 6, symbol: '₮', kind: 'asset' }, // Tether (internal asset code)
} as const;

export type Currency = keyof typeof CURRENCIES;

export function isCurrency(value: string): value is Currency {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function scaleOf(currency: Currency): number {
  return CURRENCIES[currency].scale;
}

/**
 * Minor-unit granularity a currency's payout rails accept. Haitian mobile-money rails
 * (NatCash via BenCash, and MonCash) accept ONLY whole gourdes — a fractional amount is
 * rejected by BenCash with a MISLEADING error ("Invalid phone number" / "requestId
 * already exists"), which cost real payouts (see stuck decimal payouts Aug 2026). So an
 * HTG payout must be a multiple of 1 gourde (10^scale = 100 minor). Every other currency
 * transacts at full minor precision (step 1n).
 */
export function payoutMinorStep(currency: Currency): bigint {
  return currency === 'HTG' ? 10n ** BigInt(CURRENCIES.HTG.scale) : 1n;
}

export function assertCurrency(value: string): Currency {
  if (!isCurrency(value)) {
    throw new Error(`Unsupported currency: ${value}`);
  }
  return value;
}
