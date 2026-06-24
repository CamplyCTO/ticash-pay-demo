import { Pool } from 'pg';
import { Currency } from '../money/currency';
import { NewTransfer, TransferRecord, TransferStatus, TransferStore } from './transfer-store';

/** Postgres-backed transfer saga log (table `transfers`, migration 0004). */
export class PgTransferStore implements TransferStore {
  constructor(private readonly pool: Pool) {}

  async create(t: NewTransfer): Promise<TransferRecord> {
    const res = await this.pool.query(
      `INSERT INTO transfers
         (correlation_id, base_idempotency, sender_id, recipient_ref, from_currency, to_currency, send_minor, fee_minor, rate, receive_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (correlation_id) DO NOTHING
       RETURNING *`,
      [t.correlationId, t.baseIdempotencyKey, t.senderId, t.recipientRef, t.fromCurrency, t.toCurrency, t.sendMinor.toString(), t.feeMinor.toString(), t.rate, t.receiveMinor.toString()],
    );
    if (res.rows[0]) return mapTransfer(res.rows[0]);
    const existing = await this.get(t.correlationId);
    if (!existing) throw new Error(`transfer upsert race for ${t.correlationId}`);
    return existing;
  }

  async get(correlationId: string): Promise<TransferRecord | null> {
    const res = await this.pool.query(`SELECT * FROM transfers WHERE correlation_id = $1`, [correlationId]);
    return res.rows[0] ? mapTransfer(res.rows[0]) : null;
  }

  async setStatus(correlationId: string, status: TransferStatus): Promise<TransferRecord> {
    const res = await this.pool.query(
      `UPDATE transfers SET status = $2, updated_at = now() WHERE correlation_id = $1 RETURNING *`,
      [correlationId, status],
    );
    if (!res.rows[0]) throw new Error(`transfer ${correlationId} not found`);
    return mapTransfer(res.rows[0]);
  }

  async listIncomplete(): Promise<TransferRecord[]> {
    const res = await this.pool.query(`SELECT * FROM transfers WHERE status <> 'completed' ORDER BY created_at`);
    return res.rows.map(mapTransfer);
  }
}

function mapTransfer(r: any): TransferRecord {
  return {
    correlationId: r.correlation_id,
    baseIdempotencyKey: r.base_idempotency,
    senderId: r.sender_id,
    recipientRef: r.recipient_ref,
    fromCurrency: r.from_currency.trim() as Currency,
    toCurrency: r.to_currency.trim() as Currency,
    sendMinor: BigInt(r.send_minor),
    feeMinor: BigInt(r.fee_minor),
    rate: r.rate,
    receiveMinor: BigInt(r.receive_minor),
    status: r.status,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
