import { Currency } from '../money/currency';
import { LedgerError } from '../ledger/engine';
import { RateQuote, RateStore } from './types';

/**
 * Apply a margin (basis points) to a mid rate, moving it AGAINST the customer:
 *   customerRate = mid * (10000 - marginBps) / 10000
 * Exact decimal math via BigInt — no floating point. Returns a decimal string.
 * e.g. marginedRate("24.36", 200) -> "23.8728" (2% spread).
 */
export function marginedRate(midRate: string, marginBps: number): string {
  if (!Number.isInteger(marginBps) || marginBps < 0 || marginBps >= 10000) {
    throw new LedgerError(`invalid marginBps: ${marginBps} (expected 0..9999)`, 'VALIDATION');
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(midRate.trim());
  if (!m) throw new LedgerError(`invalid mid rate: "${midRate}"`, 'VALIDATION');
  const whole = m[1] as string;
  const frac = m[2] ?? '';
  const midScaled = BigInt(whole + frac); // mid * 10^fracLen
  const num = midScaled * BigInt(10000 - marginBps); // mid*(10000-bps) * 10^fracLen
  const scale = frac.length + 4; // divide by 10000 == shift 4 more decimals
  return renderScaled(num, scale);
}

/** Render a non-negative bigint as a fixed-point decimal string, trailing zeros trimmed. */
function renderScaled(value: bigint, scale: number): string {
  const s = value.toString().padStart(scale + 1, '0');
  const whole = s.slice(0, s.length - scale);
  let frac = s.slice(s.length - scale);
  frac = frac.replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Prices a transfer pair: reads the per-pair mid + margin from the store and returns
 * the customer rate to lock onto the transfer.
 */
export class RateService {
  constructor(private readonly store: RateStore) {}

  async quote(from: Currency, to: Currency): Promise<RateQuote> {
    if (from === to) {
      return { fromCurrency: from, toCurrency: to, midRate: '1', marginBps: 0, rate: '1', source: 'identity', asOf: nowIso() };
    }
    const rec = await this.store.get(from, to);
    if (!rec) throw new LedgerError(`no FX rate configured for ${from}->${to}`, 'VALIDATION');
    return {
      fromCurrency: from,
      toCurrency: to,
      midRate: rec.midRate,
      marginBps: rec.marginBps,
      rate: marginedRate(rec.midRate, rec.marginBps),
      source: rec.source,
      asOf: rec.updatedAt,
    };
  }

  list() {
    return this.store.list();
  }
  setRate(from: Currency, to: Currency, midRate: string, marginBps: number, source = 'manual') {
    // Validate the inputs by pricing them before persisting.
    marginedRate(midRate, marginBps);
    return this.store.set({ fromCurrency: from, toCurrency: to, midRate, marginBps, source });
  }
}

function nowIso(): string {
  return new Date(Date.UTC(2026, 0, 1)).toISOString();
}
