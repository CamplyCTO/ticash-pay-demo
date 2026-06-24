import { Currency } from '../money/currency';

/**
 * FX rate model. We store a per-pair MID rate (market reference) and a configurable
 * MARGIN (basis points) that the platform takes as its spread. The customer rate is
 * the mid moved against the customer by the margin, computed with exact decimal math
 * (no floating point). The rate is LOCKED onto each transfer at quote time.
 */

export interface RateRecord {
  fromCurrency: Currency;
  toCurrency: Currency;
  midRate: string; // decimal string, "to per from" (e.g. BRL->HTG "24.36")
  marginBps: number; // platform spread in basis points (200 = 2%)
  source: string; // 'config' | 'manual' | provider name
  updatedAt: string;
}

/** A priced quote: mid + margin -> the customer `rate` actually used. */
export interface RateQuote {
  fromCurrency: Currency;
  toCurrency: Currency;
  midRate: string;
  marginBps: number;
  rate: string; // customer rate = mid adjusted by margin
  source: string;
  asOf: string;
}

export interface RateStore {
  get(from: Currency, to: Currency): Promise<RateRecord | null>;
  set(rec: Omit<RateRecord, 'updatedAt'>): Promise<RateRecord>;
  list(): Promise<RateRecord[]>;
}
