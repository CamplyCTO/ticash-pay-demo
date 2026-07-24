import { Pool } from 'pg';
import { assertCurrency } from '../money/currency';
import { NewWithdrawal, WithdrawalRequest, WithdrawalStatus } from './types';

export type WithdrawalErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'FORBIDDEN';

export class WithdrawalError extends Error {
  constructor(message: string, readonly code: WithdrawalErrorCode) {
    super(message);
    this.name = 'WithdrawalError';
  }
}

/** Persistence for USDT withdrawals. `claim` is the ATOMIC status transition
 *  (pending → completed/rejected) so a withdrawal can never settle AND refund. */
export interface WithdrawalStore {
  create(w: NewWithdrawal): Promise<WithdrawalRequest>;
  get(id: string): Promise<WithdrawalRequest | null>;
  listPending(): Promise<WithdrawalRequest[]>;
  listByCustomer(customerId: string, limit: number): Promise<WithdrawalRequest[]>;
  /** Set status to `to` ONLY IF currently one of `from`; optionally set providerRef. Returns the row or null. */
  claim(id: string, from: WithdrawalStatus[], to: WithdrawalStatus, providerRef?: string): Promise<WithdrawalRequest | null>;
}

// --- in-memory (tests / demo) -------------------------------------------------
export class InMemoryWithdrawalStore implements WithdrawalStore {
  private readonly rows = new Map<string, WithdrawalRequest>();

  async create(w: NewWithdrawal): Promise<WithdrawalRequest> {
    const now = new Date().toISOString();
    const row: WithdrawalRequest = { ...w, status: 'pending', providerRef: null, createdAt: now, updatedAt: now };
    this.rows.set(w.id, row);
    return clone(row);
  }
  async get(id: string): Promise<WithdrawalRequest | null> {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }
  async listPending(): Promise<WithdrawalRequest[]> {
    return [...this.rows.values()].filter((r) => r.status === 'pending').sort(byNewest).map(clone);
  }
  async listByCustomer(customerId: string, limit: number): Promise<WithdrawalRequest[]> {
    return [...this.rows.values()].filter((r) => r.customerId === customerId).sort(byNewest).slice(0, limit).map(clone);
  }
  async claim(id: string, from: WithdrawalStatus[], to: WithdrawalStatus, providerRef?: string): Promise<WithdrawalRequest | null> {
    const r = this.rows.get(id);
    if (!r || !from.includes(r.status)) return null;
    r.status = to;
    if (providerRef !== undefined) r.providerRef = providerRef;
    r.updatedAt = new Date().toISOString();
    return clone(r);
  }
}

const byNewest = (a: WithdrawalRequest, b: WithdrawalRequest) => (a.createdAt < b.createdAt ? 1 : -1);
function clone<T>(v: T): T {
  return structuredClone(v);
}

// --- Postgres -----------------------------------------------------------------
export class PgWithdrawalStore implements WithdrawalStore {
  constructor(private readonly pool: Pool) {}

  async create(w: NewWithdrawal): Promise<WithdrawalRequest> {
    const res = await this.pool.query(
      `INSERT INTO usdt_withdrawals (withdrawal_uid, customer_id, currency, amount_minor, fee_minor, address, network)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [w.id, w.customerId, w.currency, w.amountMinor.toString(), w.feeMinor.toString(), w.address, w.network],
    );
    return mapRow(res.rows[0]);
  }
  async get(id: string): Promise<WithdrawalRequest | null> {
    const res = await this.pool.query(`SELECT * FROM usdt_withdrawals WHERE withdrawal_uid = $1`, [id]);
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }
  async listPending(): Promise<WithdrawalRequest[]> {
    const res = await this.pool.query(`SELECT * FROM usdt_withdrawals WHERE status = 'pending' ORDER BY created_at DESC`);
    return res.rows.map(mapRow);
  }
  async listByCustomer(customerId: string, limit: number): Promise<WithdrawalRequest[]> {
    const res = await this.pool.query(`SELECT * FROM usdt_withdrawals WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2`, [customerId, limit]);
    return res.rows.map(mapRow);
  }
  async claim(id: string, from: WithdrawalStatus[], to: WithdrawalStatus, providerRef?: string): Promise<WithdrawalRequest | null> {
    const res = await this.pool.query(
      `UPDATE usdt_withdrawals SET status = $3, provider_ref = COALESCE($4, provider_ref), updated_at = now()
       WHERE withdrawal_uid = $1 AND status = ANY($2) RETURNING *`,
      [id, from, to, providerRef ?? null],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }
}

function mapRow(r: any): WithdrawalRequest {
  return {
    id: r.withdrawal_uid,
    customerId: r.customer_id,
    currency: assertCurrency(r.currency.trim()),
    amountMinor: BigInt(r.amount_minor),
    feeMinor: BigInt(r.fee_minor),
    address: r.address,
    network: r.network,
    status: r.status,
    providerRef: r.provider_ref ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
