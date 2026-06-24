import { Pool } from 'pg';
import { Currency } from '../money/currency';
import { RateRecord, RateStore } from './types';

/** Postgres-backed FX rates (table `fx_rates`, migration 0005). */
export class PgRateStore implements RateStore {
  constructor(private readonly pool: Pool) {}

  async get(from: Currency, to: Currency): Promise<RateRecord | null> {
    const res = await this.pool.query(
      `SELECT from_currency, to_currency, mid_rate, margin_bps, source, updated_at
         FROM fx_rates WHERE from_currency = $1 AND to_currency = $2`,
      [from, to],
    );
    return res.rows[0] ? mapRate(res.rows[0]) : null;
  }

  async set(rec: Omit<RateRecord, 'updatedAt'>): Promise<RateRecord> {
    const res = await this.pool.query(
      `INSERT INTO fx_rates (from_currency, to_currency, mid_rate, margin_bps, source)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (from_currency, to_currency)
       DO UPDATE SET mid_rate = EXCLUDED.mid_rate, margin_bps = EXCLUDED.margin_bps, source = EXCLUDED.source, updated_at = now()
       RETURNING from_currency, to_currency, mid_rate, margin_bps, source, updated_at`,
      [rec.fromCurrency, rec.toCurrency, rec.midRate, rec.marginBps, rec.source],
    );
    return mapRate(res.rows[0]);
  }

  async list(): Promise<RateRecord[]> {
    const res = await this.pool.query(
      `SELECT from_currency, to_currency, mid_rate, margin_bps, source, updated_at FROM fx_rates ORDER BY from_currency, to_currency`,
    );
    return res.rows.map(mapRate);
  }
}

function mapRate(r: any): RateRecord {
  return {
    fromCurrency: r.from_currency.trim() as Currency,
    toCurrency: r.to_currency.trim() as Currency,
    midRate: r.mid_rate,
    marginBps: Number(r.margin_bps),
    source: r.source,
    updatedAt: r.updated_at.toISOString(),
  };
}
