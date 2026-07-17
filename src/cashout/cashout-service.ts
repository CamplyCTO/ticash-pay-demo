import { randomUUID } from 'node:crypto';
import { Currency } from '../money/currency';
import { LedgerService } from '../ledger/service';
import { CashoutError, CashoutStore } from './cashout-store';
import { CashoutRequest } from './types';

export interface CashoutConfig {
  expiryMinutes: number; // a pending request auto-expires (no debit) after this
}

/**
 * Cash-out APPROVAL flow. An agent creates a pending request (no money moves); the
 * customer approves in-app, and only then does the debit run — exactly once. The
 * atomic `claim` (pending → approved) makes approve mutually exclusive with
 * reject/cancel/expire, and the ledger post is idempotent on the request id, so a
 * retried approval can never double-debit.
 */
export class CashoutService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly store: CashoutStore,
    private readonly cfg: CashoutConfig,
  ) {}

  /** Agent asks to cash a customer out. Creates a PENDING request — NO debit yet. */
  async request(args: { agentId: string; customerId: string; currency: Currency; amountMinor: bigint; commissionMinor: bigint }): Promise<CashoutRequest> {
    if (args.amountMinor <= 0n) throw new CashoutError('amount must be positive', 'VALIDATION');
    const expiresAt = new Date(Date.now() + this.cfg.expiryMinutes * 60_000).toISOString();
    return this.store.create({ id: randomUUID(), ...args, expiresAt });
  }

  /** Customer approves → run the debit (agent cash-out) exactly once. */
  async approve(args: { requestId: string; customerId: string }): Promise<CashoutRequest> {
    const req = await this.require(args.requestId);
    if (req.customerId !== args.customerId) throw new CashoutError('not your request', 'FORBIDDEN');
    if (req.status !== 'pending') throw new CashoutError(`request is ${req.status}`, 'CONFLICT');
    if (req.expiresAt && Date.parse(req.expiresAt) < Date.now()) {
      await this.store.claim(req.id, ['pending'], 'expired').catch(() => {});
      throw new CashoutError('request expired', 'CONFLICT');
    }
    // Claim FIRST (atomic) so a concurrent approve/reject can't both take effect.
    const claimed = await this.store.claim(req.id, ['pending'], 'approved');
    if (!claimed) throw new CashoutError('request is no longer pending', 'CONFLICT');
    try {
      await this.ledger.agentCashOut({
        agentId: req.agentId,
        customerId: req.customerId,
        currency: req.currency,
        amountMinor: req.amountMinor,
        commissionMinor: req.commissionMinor,
        idempotencyKey: `cashout:${req.id}`,
      });
    } catch (err) {
      // Debit failed (e.g. insufficient funds) — revert so the customer can retry.
      await this.store.claim(req.id, ['approved'], 'pending').catch(() => {});
      throw err;
    }
    return claimed;
  }

  /** Customer rejects a pending request → no debit ever runs. */
  async reject(args: { requestId: string; customerId: string }): Promise<CashoutRequest> {
    const req = await this.require(args.requestId);
    if (req.customerId !== args.customerId) throw new CashoutError('not your request', 'FORBIDDEN');
    const updated = await this.store.claim(req.id, ['pending'], 'rejected');
    if (!updated) throw new CashoutError(`request is ${req.status}, cannot reject`, 'CONFLICT');
    return updated;
  }

  /** Agent cancels their own still-pending request. */
  async cancel(args: { requestId: string; agentId: string }): Promise<CashoutRequest> {
    const req = await this.require(args.requestId);
    if (req.agentId !== args.agentId) throw new CashoutError('not your request', 'FORBIDDEN');
    const updated = await this.store.claim(req.id, ['pending'], 'cancelled');
    if (!updated) throw new CashoutError(`request is ${req.status}, cannot cancel`, 'CONFLICT');
    return updated;
  }

  listPending(customerId: string): Promise<CashoutRequest[]> {
    return this.store.listPendingByCustomer(customerId);
  }
  listByAgent(agentId: string, limit = 50): Promise<CashoutRequest[]> {
    return this.store.listByAgent(agentId, limit);
  }
  get(id: string): Promise<CashoutRequest | null> {
    return this.store.get(id);
  }

  private async require(id: string): Promise<CashoutRequest> {
    const r = await this.store.get(id);
    if (!r) throw new CashoutError('request not found', 'NOT_FOUND');
    return r;
  }
}
