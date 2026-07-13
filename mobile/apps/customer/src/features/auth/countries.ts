import type { Currency } from '@ticash/api-client';

/** Supported signup countries; the country sets the account's home currency. */
export interface Country {
  code: string; // ISO-3166 alpha-2
  labelPt: string;
  flag: string;
  currency: Currency;
  dial: string; // default phone dial prefix
}

export const COUNTRIES: Country[] = [
  { code: 'BR', labelPt: 'Brasil', flag: '🇧🇷', currency: 'BRL', dial: '+55' },
  { code: 'HT', labelPt: 'Haiti', flag: '🇭🇹', currency: 'HTG', dial: '+509' },
  { code: 'US', labelPt: 'Estados Unidos', flag: '🇺🇸', currency: 'USD', dial: '+1' },
  { code: 'MX', labelPt: 'México', flag: '🇲🇽', currency: 'MXN', dial: '+52' },
  { code: 'DO', labelPt: 'Rep. Dominicana', flag: '🇩🇴', currency: 'DOP', dial: '+1' },
];

export function currencyForCountry(code?: string | null): Currency {
  return COUNTRIES.find((c) => c.code === code)?.currency ?? 'BRL';
}

/**
 * Countries offered at signup in v1 — only where funding is live (Brazil / PIX).
 * The others stay in COUNTRIES (currency logic keeps working) and are re-enabled
 * here one by one as each country's cash-in rail goes live.
 */
export const SIGNUP_COUNTRIES: Country[] = COUNTRIES.filter((c) => c.code === 'BR');
