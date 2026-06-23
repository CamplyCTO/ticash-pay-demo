import { Pool } from 'pg';
import { Currency } from '../money/currency';
import { PaymentIntent, PaymentIntentStore } from './intent-store';

/** Postgres-backed payment intents (table `payment_intents`, migration 0002). */
export class PgPaymentIntentStore implements PaymentIntentStore {
  constructor(private readonly pool: Pool) {}

  async create(intent: Omit<PaymentIntent, 'status' | 'createdAt'>): Promise<PaymentIntent> {
    const res = await this.pool.query(
      `INSERT INTO payment_intents (provider, provider_id, customer_id, currency, amount_minor, reference)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (provider_id) DO NOTHING
       RETURNING provider, provider_id, customer_id, currency, amount_minor, reference, status, created_at`,
      [
        intent.provider,
        intent.providerId,
        intent.customerId,
        intent.currency,
        intent.amountMinor.toString(),
        intent.reference,
      ],
    );
    if (res.rows[0]) return mapIntent(res.rows[0]);
    // Conflict: an intent for this provider_id already exists — return it (idempotent).
    const existing = await this.get(intent.providerId);
    if (!existing) throw new Error(`payment_intent upsert race for ${intent.providerId}`);
    return existing;
  }

  async get(providerId: string): Promise<PaymentIntent | null> {
    const res = await this.pool.query(
      `SELECT provider, provider_id, customer_id, currency, amount_minor, reference, status, created_at
         FROM payment_intents WHERE provider_id = $1`,
      [providerId],
    );
    return res.rows[0] ? mapIntent(res.rows[0]) : null;
  }

  async markPaid(providerId: string): Promise<void> {
    await this.pool.query(
      `UPDATE payment_intents SET status = 'paid', paid_at = now()
        WHERE provider_id = $1 AND status <> 'paid'`,
      [providerId],
    );
  }

  async list(): Promise<PaymentIntent[]> {
    const res = await this.pool.query(
      `SELECT provider, provider_id, customer_id, currency, amount_minor, reference, status, created_at
         FROM payment_intents ORDER BY created_at`,
    );
    return res.rows.map(mapIntent);
  }
}

function mapIntent(r: any): PaymentIntent {
  return {
    provider: r.provider,
    providerId: r.provider_id,
    customerId: r.customer_id,
    currency: r.currency.trim() as Currency,
    amountMinor: BigInt(r.amount_minor),
    reference: r.reference,
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}
