import { Pool } from 'pg';
import { Currency } from '../money/currency';
import { ReferralRecord, ReferralStats, ReferralStatus, ReferralStore } from './referral-store';

/** Postgres-backed referral store (tables: referral_codes, referrals). */
export class PgReferralStore implements ReferralStore {
  constructor(private readonly pool: Pool) {}

  async getCodeForOwner(ownerExternalId: string): Promise<string | null> {
    const r = await this.pool.query('SELECT code FROM referral_codes WHERE owner_external_id = $1', [ownerExternalId]);
    return r.rows[0]?.code ?? null;
  }
  /** Plain INSERT: a duplicate code OR owner raises (unique_violation) so the caller
   *  can retry with a fresh code / re-read the owner's existing one. */
  async createCode(code: string, ownerExternalId: string): Promise<void> {
    await this.pool.query('INSERT INTO referral_codes (code, owner_external_id) VALUES ($1,$2)', [code, ownerExternalId]);
  }
  async ownerForCode(code: string): Promise<string | null> {
    const r = await this.pool.query('SELECT owner_external_id FROM referral_codes WHERE code = $1', [code]);
    return r.rows[0]?.owner_external_id ?? null;
  }

  async createReferral(referredExternalId: string, referrerExternalId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO referrals (referred_external_id, referrer_external_id) VALUES ($1,$2)
       ON CONFLICT (referred_external_id) DO NOTHING`,
      [referredExternalId, referrerExternalId],
    );
  }
  async getByReferred(referredExternalId: string): Promise<ReferralRecord | null> {
    const r = await this.pool.query('SELECT * FROM referrals WHERE referred_external_id = $1', [referredExternalId]);
    const row = r.rows[0];
    if (!row) return null;
    return {
      referredExternalId: row.referred_external_id,
      referrerExternalId: row.referrer_external_id,
      status: row.status as ReferralStatus,
      rewardMinor: row.reward_minor === null ? null : BigInt(row.reward_minor),
      rewardCurrency: row.reward_currency ? (String(row.reward_currency).trim() as Currency) : null,
    };
  }
  async markRewarded(referredExternalId: string, rewardMinor: bigint, rewardCurrency: Currency): Promise<void> {
    await this.pool.query(
      `UPDATE referrals SET status = 'rewarded', reward_minor = $2, reward_currency = $3, rewarded_at = now()
       WHERE referred_external_id = $1 AND status = 'pending'`,
      [referredExternalId, rewardMinor.toString(), rewardCurrency],
    );
  }
  async statsForReferrer(referrerExternalId: string): Promise<ReferralStats> {
    const total = await this.pool.query('SELECT count(*)::int AS n FROM referrals WHERE referrer_external_id = $1', [referrerExternalId]);
    const rewarded = await this.pool.query(
      `SELECT trim(reward_currency) AS ccy, count(*)::int AS n, sum(reward_minor)::bigint AS s
       FROM referrals WHERE referrer_external_id = $1 AND status = 'rewarded' GROUP BY trim(reward_currency)`,
      [referrerExternalId],
    );
    const earned: Record<string, string> = {};
    let rewardedCount = 0;
    for (const row of rewarded.rows) {
      rewardedCount += row.n;
      if (row.ccy) earned[row.ccy] = String(row.s);
    }
    return { referredCount: total.rows[0]?.n ?? 0, rewardedCount, earnedMinor: earned };
  }
}
