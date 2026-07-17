import { Pool } from 'pg';
import { assertCurrency } from '../money/currency';
import { CashoutRequest, CashoutStatus, NewCashoutRequest } from './types';

export type CashoutErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'FORBIDDEN';

export class CashoutError extends Error {
  constructor(message: string, readonly code: CashoutErrorCode) {
    super(message);
    this.name = 'CashoutError';
  }
}

/**
 * Persistence for cash-out approval requests. `claim` is the ATOMIC status
 * transition (pending → approved/rejected/…) so a request can never be approved
 * twice (which would double-debit) — it's the same guard as the P2P casUpdate.
 */
export interface CashoutStore {
  create(r: NewCashoutRequest): Promise<CashoutRequest>;
  get(id: string): Promise<CashoutRequest | null>;
  listPendingByCustomer(customerId: string): Promise<CashoutRequest[]>;
  listByAgent(agentId: string, limit: number): Promise<CashoutRequest[]>;
  /** Set status to `to` ONLY IF currently one of `from`. Returns the updated row or null (lost race). */
  claim(id: string, from: CashoutStatus[], to: CashoutStatus): Promise<CashoutRequest | null>;
}

// --- in-memory (tests / demo): single-threaded ⇒ each method is atomic --------
export class InMemoryCashoutStore implements CashoutStore {
  private readonly reqs = new Map<string, CashoutRequest>();

  async create(r: NewCashoutRequest): Promise<CashoutRequest> {
    const now = new Date().toISOString();
    const req: CashoutRequest = { ...r, status: 'pending', createdAt: now, updatedAt: now };
    this.reqs.set(r.id, req);
    return clone(req);
  }
  async get(id: string): Promise<CashoutRequest | null> {
    const r = this.reqs.get(id);
    return r ? clone(r) : null;
  }
  async listPendingByCustomer(customerId: string): Promise<CashoutRequest[]> {
    return [...this.reqs.values()].filter((r) => r.customerId === customerId && r.status === 'pending').sort(byNewest).map(clone);
  }
  async listByAgent(agentId: string, limit: number): Promise<CashoutRequest[]> {
    return [...this.reqs.values()].filter((r) => r.agentId === agentId).sort(byNewest).slice(0, limit).map(clone);
  }
  async claim(id: string, from: CashoutStatus[], to: CashoutStatus): Promise<CashoutRequest | null> {
    const r = this.reqs.get(id);
    if (!r || !from.includes(r.status)) return null;
    r.status = to;
    r.updatedAt = new Date().toISOString();
    return clone(r);
  }
}

const byNewest = (a: CashoutRequest, b: CashoutRequest) => (a.createdAt < b.createdAt ? 1 : -1);
function clone<T>(v: T): T {
  return structuredClone(v);
}

// --- Postgres -----------------------------------------------------------------
export class PgCashoutStore implements CashoutStore {
  constructor(private readonly pool: Pool) {}

  async create(r: NewCashoutRequest): Promise<CashoutRequest> {
    const res = await this.pool.query(
      `INSERT INTO cashout_requests (request_uid, agent_id, customer_id, currency, amount_minor, commission_minor, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [r.id, r.agentId, r.customerId, r.currency, r.amountMinor.toString(), r.commissionMinor.toString(), r.expiresAt],
    );
    return mapRow(res.rows[0]);
  }
  async get(id: string): Promise<CashoutRequest | null> {
    const res = await this.pool.query(`SELECT * FROM cashout_requests WHERE request_uid = $1`, [id]);
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }
  async listPendingByCustomer(customerId: string): Promise<CashoutRequest[]> {
    const res = await this.pool.query(
      `SELECT * FROM cashout_requests WHERE customer_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [customerId],
    );
    return res.rows.map(mapRow);
  }
  async listByAgent(agentId: string, limit: number): Promise<CashoutRequest[]> {
    const res = await this.pool.query(`SELECT * FROM cashout_requests WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`, [agentId, limit]);
    return res.rows.map(mapRow);
  }
  async claim(id: string, from: CashoutStatus[], to: CashoutStatus): Promise<CashoutRequest | null> {
    const res = await this.pool.query(
      `UPDATE cashout_requests SET status = $3, updated_at = now() WHERE request_uid = $1 AND status = ANY($2) RETURNING *`,
      [id, from, to],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }
}

function mapRow(r: any): CashoutRequest {
  return {
    id: r.request_uid,
    agentId: r.agent_id,
    customerId: r.customer_id,
    currency: assertCurrency(r.currency.trim()),
    amountMinor: BigInt(r.amount_minor),
    commissionMinor: BigInt(r.commission_minor),
    status: r.status,
    expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
