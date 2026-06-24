import { Currency } from '../money/currency';
import { RateRecord, RateStore } from './types';

/** Starting mid-rates per corridor (to HTG). Admin-configurable at runtime. */
export const DEFAULT_MID_RATES: Array<{ from: Currency; to: Currency; mid: string }> = [
  { from: 'BRL', to: 'HTG', mid: '24.36' },
  { from: 'USD', to: 'HTG', mid: '132.00' },
  { from: 'MXN', to: 'HTG', mid: '7.20' },
  { from: 'DOP', to: 'HTG', mid: '2.18' },
];

/** Seed the default mid-rates if absent (idempotent). Used on boot for Postgres. */
export async function seedDefaultRates(store: RateStore, marginBps: number): Promise<void> {
  for (const r of DEFAULT_MID_RATES) {
    if (!(await store.get(r.from, r.to))) {
      await store.set({ fromCurrency: r.from, toCurrency: r.to, midRate: r.mid, marginBps, source: 'config' });
    }
  }
}

const key = (f: Currency, t: Currency) => `${f}:${t}`;

export class InMemoryRateStore implements RateStore {
  private readonly rates = new Map<string, RateRecord>();
  constructor(
    seedMarginBps = 200,
    private readonly clock: () => string = () => new Date(Date.UTC(2026, 0, 1)).toISOString(),
  ) {
    for (const r of DEFAULT_MID_RATES) {
      this.rates.set(key(r.from, r.to), { fromCurrency: r.from, toCurrency: r.to, midRate: r.mid, marginBps: seedMarginBps, source: 'config', updatedAt: this.clock() });
    }
  }
  async get(from: Currency, to: Currency): Promise<RateRecord | null> {
    return this.rates.get(key(from, to)) ?? null;
  }
  async set(rec: Omit<RateRecord, 'updatedAt'>): Promise<RateRecord> {
    const full: RateRecord = { ...rec, updatedAt: this.clock() };
    this.rates.set(key(rec.fromCurrency, rec.toCurrency), full);
    return full;
  }
  async list(): Promise<RateRecord[]> {
    return [...this.rates.values()].sort((a, b) => key(a.fromCurrency, a.toCurrency).localeCompare(key(b.fromCurrency, b.toCurrency)));
  }
}
