import { Pool } from 'pg';
import { Currency } from '../money/currency';
import {
  NewPayout,
  PayoutRecord,
  PayoutReversalContext,
  PayoutStore,
} from './payout-store';

/** Postgres-backed payout state machine (table `payouts`, migration 0003). */
export class PgPayoutStore implements PayoutStore {
  constructor(private readonly pool: Pool) {}

  async create(rec: NewPayout): Promise<PayoutRecord> {
    const res = await this.pool.query(
      `INSERT INTO payouts (correlation_id, provider, recipient_ref, currency, amount_minor, provider_fee_minor, reversal)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (correlation_id) DO NOTHING
       RETURNING *`,
      [rec.correlationId, rec.provider, rec.recipientRef, rec.currency, rec.amountMinor.toString(), (rec.providerFeeMinor ?? 0n).toString(), serializeReversal(rec.reversal)],
    );
    if (res.rows[0]) return mapPayout(res.rows[0]);
    const existing = await this.get(rec.correlationId);
    if (!existing) throw new Error(`payout upsert race for ${rec.correlationId}`);
    return existing;
  }

  async get(correlationId: string): Promise<PayoutRecord | null> {
    const res = await this.pool.query(`SELECT * FROM payouts WHERE correlation_id = $1`, [correlationId]);
    return res.rows[0] ? mapPayout(res.rows[0]) : null;
  }

  async update(correlationId: string, patch: Partial<PayoutRecord>): Promise<PayoutRecord> {
    // Whitelist the columns the state machine actually patches.
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.providerRef !== undefined) add('provider_ref', patch.providerRef);
    if (patch.attempts !== undefined) add('attempts', patch.attempts);
    if (patch.lastError !== undefined) add('last_error', patch.lastError);
    sets.push('updated_at = now()');
    params.push(correlationId);
    const res = await this.pool.query(
      `UPDATE payouts SET ${sets.join(', ')} WHERE correlation_id = $${params.length} RETURNING *`,
      params,
    );
    if (!res.rows[0]) throw new Error(`payout ${correlationId} not found`);
    return mapPayout(res.rows[0]);
  }

  async list(): Promise<PayoutRecord[]> {
    const res = await this.pool.query(`SELECT * FROM payouts ORDER BY created_at`);
    return res.rows.map(mapPayout);
  }
}

function serializeReversal(r: PayoutReversalContext): string {
  return JSON.stringify({
    senderId: r.senderId,
    fromCurrency: r.fromCurrency,
    toCurrency: r.toCurrency,
    sendMinor: r.sendMinor.toString(),
    feeMinor: r.feeMinor.toString(),
    receiveMinor: r.receiveMinor.toString(),
    rate: r.rate,
  });
}

function deserializeReversal(j: any): PayoutReversalContext {
  return {
    senderId: j.senderId,
    fromCurrency: j.fromCurrency,
    toCurrency: j.toCurrency,
    sendMinor: BigInt(j.sendMinor),
    feeMinor: BigInt(j.feeMinor),
    receiveMinor: BigInt(j.receiveMinor),
    rate: j.rate,
  };
}

function mapPayout(r: any): PayoutRecord {
  return {
    correlationId: r.correlation_id,
    provider: r.provider,
    providerRef: r.provider_ref,
    recipientRef: r.recipient_ref,
    currency: r.currency.trim() as Currency,
    amountMinor: BigInt(r.amount_minor),
    providerFeeMinor: BigInt(r.provider_fee_minor ?? 0),
    status: r.status,
    attempts: Number(r.attempts),
    lastError: r.last_error,
    reversal: deserializeReversal(r.reversal),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
