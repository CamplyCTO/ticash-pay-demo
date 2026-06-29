/** Currency catalogue — mirrors the backend `src/money/currency.ts` (scale + symbol). */
export const CURRENCIES = {
  BRL: { scale: 2, symbol: 'R$' },
  HTG: { scale: 2, symbol: 'G' },
  USD: { scale: 2, symbol: '$' },
  DOP: { scale: 2, symbol: 'RD$' },
  MXN: { scale: 2, symbol: 'MX$' },
  USDT: { scale: 6, symbol: '₮' },
} as const;

export type Currency = keyof typeof CURRENCIES;

export function isCurrency(v: string): v is Currency {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, v);
}

export function scaleOf(c: Currency): number {
  return CURRENCIES[c].scale;
}

export function symbolOf(c: Currency): string {
  return CURRENCIES[c].symbol;
}
