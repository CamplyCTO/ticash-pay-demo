import { Pool } from 'pg';
import { AirtimeMarginRecord, AirtimeMarginStore, norm } from './margin-store';

/** Postgres-backed per-country airtime margin (table `airtime_margins`, migration 0009). */
export class PgAirtimeMarginStore implements AirtimeMarginStore {
  constructor(private readonly pool: Pool, readonly defaultBps: number = 0) {}

  async get(countryIso: string): Promise<number> {
    const res = await this.pool.query('SELECT margin_bps FROM airtime_margins WHERE country_iso = $1', [norm(countryIso)]);
    return res.rows[0] ? Number(res.rows[0].margin_bps) : this.defaultBps;
  }
  async set(countryIso: string, marginBps: number): Promise<AirtimeMarginRecord> {
    const c = norm(countryIso);
    await this.pool.query(
      `INSERT INTO airtime_margins (country_iso, margin_bps) VALUES ($1,$2)
       ON CONFLICT (country_iso) DO UPDATE SET margin_bps = EXCLUDED.margin_bps, updated_at = now()`,
      [c, marginBps],
    );
    return { countryIso: c, marginBps };
  }
  async list(): Promise<AirtimeMarginRecord[]> {
    const res = await this.pool.query('SELECT country_iso, margin_bps FROM airtime_margins ORDER BY country_iso');
    return res.rows.map((r) => ({ countryIso: r.country_iso.trim(), marginBps: Number(r.margin_bps) }));
  }
}
