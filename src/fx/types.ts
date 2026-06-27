import { Currency } from '../money/currency';

/**
 * FX rate + fee model. Per corridor we store a MID rate and three bps knobs:
 *   - marginBps      : platform FX spread (mid vs customer rate) — platform revenue
 *   - platformFeeBps : platform transfer fee (% of send)         — platform revenue
 *   - providerFeeBps : the payout rail's cut (BenCash 5%, confirmed live) — a COST
 * The customer rate is the mid moved against the customer by the margin, computed
 * with exact decimal math (no floating point), and LOCKED onto each transfer.
 */

export interface RateRecord {
  fromCurrency: Currency;
  toCurrency: Currency;
  midRate: string; // decimal string, "to per from" (e.g. BRL->HTG "24.36")
  marginBps: number; // platform FX spread (200 = 2%)
  platformFeeBps: number; // platform transfer fee (% of send)
  providerFeeBps: number; // payout rail's fee (cost)
  source: string;
  updatedAt: string;
}

export interface RateQuote {
  fromCurrency: Currency;
  toCurrency: Currency;
  midRate: string;
  marginBps: number;
  platformFeeBps: number;
  providerFeeBps: number;
  rate: string; // customer rate = mid adjusted by margin
  source: string;
  asOf: string;
}

/** Full economics of a transfer of `sendMinor` — what the customer pays, what the */
/** recipient nets, and the platform's net profit (in the destination currency). */
export interface TransferPricing {
  fromCurrency: Currency;
  toCurrency: Currency;
  rate: string; // customer rate (locked)
  midRate: string;
  sendMinor: bigint; // source ccy
  platformFeeMinor: bigint; // source ccy — platform fee revenue
  totalDebitMinor: bigint; // source ccy — send + fee (what the customer pays)
  grossPayoutMinor: bigint; // dest ccy — converted at the customer rate
  providerFeeMinor: bigint; // dest ccy — rail's cut
  netToRecipientMinor: bigint; // dest ccy — what the recipient receives
  fxMarginMinor: bigint; // dest ccy — platform FX revenue (mid vs customer rate)
  platformNetProfitMinor: bigint; // dest ccy — fxMargin + fee(in dest) - providerFee
}

export interface RateStore {
  get(from: Currency, to: Currency): Promise<RateRecord | null>;
  set(rec: Omit<RateRecord, 'updatedAt'>): Promise<RateRecord>;
  list(): Promise<RateRecord[]>;
}
