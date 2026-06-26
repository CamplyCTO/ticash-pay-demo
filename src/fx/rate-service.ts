import { Currency } from '../money/currency';
import { convert, roundHalfUpDiv } from '../money/money';
import { LedgerError } from '../ledger/engine';
import { RateQuote, RateRecord, RateStore, TransferPricing } from './types';

/**
 * Apply a margin (basis points) to a mid rate, moving it AGAINST the customer:
 *   customerRate = mid * (10000 - marginBps) / 10000
 * Exact decimal math via BigInt — no floating point. e.g. marginedRate("24.36", 200) -> "23.8728".
 */
export function marginedRate(midRate: string, marginBps: number): string {
  assertBps(marginBps, 'marginBps');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(midRate.trim());
  if (!m) throw new LedgerError(`invalid mid rate: "${midRate}"`, 'VALIDATION');
  const midScaled = BigInt((m[1] as string) + (m[2] ?? ''));
  const num = midScaled * BigInt(10000 - marginBps);
  return renderScaled(num, (m[2] ?? '').length + 4);
}

/** amount * bps / 10000, integer minor units, rounded half-up. */
export function applyBps(amountMinor: bigint, bps: number): bigint {
  assertBps(bps, 'bps');
  return roundHalfUpDiv(amountMinor * BigInt(bps), 10000n);
}

function assertBps(bps: number, name: string): void {
  if (!Number.isInteger(bps) || bps < 0 || bps >= 10000) {
    throw new LedgerError(`invalid ${name}: ${bps} (expected 0..9999)`, 'VALIDATION');
  }
}

function renderScaled(value: bigint, scale: number): string {
  const s = value.toString().padStart(scale + 1, '0');
  const whole = s.slice(0, s.length - scale);
  const frac = s.slice(s.length - scale).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/** Prices corridors: rate (mid+margin) and the full transfer economics (fees, net, profit). */
export class RateService {
  constructor(private readonly store: RateStore) {}

  async quote(from: Currency, to: Currency): Promise<RateQuote> {
    if (from === to) {
      return { fromCurrency: from, toCurrency: to, midRate: '1', marginBps: 0, platformFeeBps: 0, providerFeeBps: 0, rate: '1', source: 'identity', asOf: ISO };
    }
    const rec = await this.require(from, to);
    return {
      fromCurrency: from, toCurrency: to,
      midRate: rec.midRate, marginBps: rec.marginBps, platformFeeBps: rec.platformFeeBps, providerFeeBps: rec.providerFeeBps,
      rate: marginedRate(rec.midRate, rec.marginBps), source: rec.source, asOf: rec.updatedAt,
    };
  }

  /**
   * Full economics of sending `sendMinor` over a corridor: what the customer pays,
   * what the recipient nets after the provider fee, and the platform's net profit
   * (in the destination currency). All exact integer math.
   */
  async priceTransfer(from: Currency, to: Currency, sendMinor: bigint): Promise<TransferPricing> {
    const rec = await this.require(from, to);
    const rate = marginedRate(rec.midRate, rec.marginBps);

    const platformFeeMinor = applyBps(sendMinor, rec.platformFeeBps); // source ccy
    const grossPayoutMinor = convert(sendMinor, from, to, rate); // dest ccy (customer rate)
    const grossAtMidMinor = convert(sendMinor, from, to, rec.midRate); // dest ccy (mid)
    const fxMarginMinor = grossAtMidMinor - grossPayoutMinor; // platform FX revenue (dest)
    const providerFeeMinor = applyBps(grossPayoutMinor, rec.providerFeeBps); // dest ccy (cost)
    const platformFeeInDest = convert(platformFeeMinor, from, to, rec.midRate); // fee -> dest for net calc

    return {
      fromCurrency: from, toCurrency: to, rate, midRate: rec.midRate,
      sendMinor,
      platformFeeMinor,
      totalDebitMinor: sendMinor + platformFeeMinor,
      grossPayoutMinor,
      providerFeeMinor,
      netToRecipientMinor: grossPayoutMinor - providerFeeMinor,
      fxMarginMinor,
      platformNetProfitMinor: fxMarginMinor + platformFeeInDest - providerFeeMinor,
    };
  }

  list() {
    return this.store.list();
  }
  setRate(from: Currency, to: Currency, midRate: string, marginBps: number, platformFeeBps: number, providerFeeBps: number, source = 'manual') {
    marginedRate(midRate, marginBps); // validate the rate math
    assertBps(platformFeeBps, 'platformFeeBps');
    assertBps(providerFeeBps, 'providerFeeBps');
    return this.store.set({ fromCurrency: from, toCurrency: to, midRate, marginBps, platformFeeBps, providerFeeBps, source });
  }

  private async require(from: Currency, to: Currency): Promise<RateRecord> {
    const rec = await this.store.get(from, to);
    if (!rec) throw new LedgerError(`no FX rate configured for ${from}->${to}`, 'VALIDATION');
    return rec;
  }
}

const ISO = new Date(Date.UTC(2026, 0, 1)).toISOString();
