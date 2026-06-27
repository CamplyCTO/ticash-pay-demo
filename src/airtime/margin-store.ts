/**
 * Per-country airtime margin (basis points). The platform marks up the provider's
 * cost by this margin; the markup is the platform's revenue on a recharge. A country
 * with no explicit override falls back to the configured default. Works for ANY
 * country DingConnect supports — not just Haiti.
 */
export interface AirtimeMarginRecord {
  countryIso: string;
  marginBps: number;
}

export interface AirtimeMarginStore {
  /** Margin bps for a country: its override, else the default. */
  get(countryIso: string): Promise<number>;
  set(countryIso: string, marginBps: number): Promise<AirtimeMarginRecord>;
  list(): Promise<AirtimeMarginRecord[]>;
  readonly defaultBps: number;
}

export class InMemoryAirtimeMarginStore implements AirtimeMarginStore {
  private readonly byCountry = new Map<string, number>();
  constructor(readonly defaultBps: number = 0) {}

  async get(countryIso: string): Promise<number> {
    return this.byCountry.get(norm(countryIso)) ?? this.defaultBps;
  }
  async set(countryIso: string, marginBps: number): Promise<AirtimeMarginRecord> {
    const c = norm(countryIso);
    this.byCountry.set(c, marginBps);
    return { countryIso: c, marginBps };
  }
  async list(): Promise<AirtimeMarginRecord[]> {
    return [...this.byCountry.entries()].map(([countryIso, marginBps]) => ({ countryIso, marginBps })).sort((a, b) => a.countryIso.localeCompare(b.countryIso));
  }
}

export function norm(countryIso: string): string {
  return countryIso.trim().toUpperCase();
}
