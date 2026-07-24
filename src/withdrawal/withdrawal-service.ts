import { randomUUID } from 'node:crypto';
import { Currency } from '../money/currency';
import { LedgerService } from '../ledger/service';
import { WithdrawalError, WithdrawalStore } from './withdrawal-store';
import { WithdrawalRequest } from './types';

export interface WithdrawalConfig {
  asset: Currency; // 'USDT'
  feeMinor: bigint; // flat platform fee retained on each withdrawal (0 allowed)
  network: string; // 'TRC20'
  minAmountMinor: bigint; // reject dust withdrawals below this
}

/**
 * USDT withdrawal (off-ramp). Request HOLDS the USDT (debit wallet → suspense) —
 * this is where the balance check happens, so a customer can never request more
 * than they hold. The operator then COMPLETES (settle: the net leaves the platform,
 * the fee is retained) once the USDT is actually sent on-chain, or REJECTS (refund).
 * Every ledger post is idempotent on the withdrawal id; the atomic status `claim`
 * makes complete and reject mutually exclusive — a withdrawal can never both settle
 * and refund (which would double-spend the held USDT).
 */
export class WithdrawalService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly store: WithdrawalStore,
    private readonly cfg: WithdrawalConfig,
  ) {}

  /** Customer requests a withdrawal → HOLDS the USDT (fails if insufficient). */
  async request(args: { customerId: string; amountMinor: bigint; address: string }): Promise<WithdrawalRequest> {
    const address = args.address.trim();
    if (!address || address.length < 20 || address.length > 120) throw new WithdrawalError('invalid destination address', 'VALIDATION');
    if (args.amountMinor < this.cfg.minAmountMinor) throw new WithdrawalError('amount below the minimum withdrawal', 'VALIDATION');
    if (this.cfg.feeMinor >= args.amountMinor) throw new WithdrawalError('amount does not cover the withdrawal fee', 'VALIDATION');

    const id = randomUUID();
    // Hold FIRST: debits the wallet (INSUFFICIENT_FUNDS if not enough). Only then record it.
    await this.ledger.usdtWithdrawHold({ customerId: args.customerId, currency: this.cfg.asset, amountMinor: args.amountMinor, idempotencyKey: `wd:hold:${id}`, correlationId: id });
    try {
      return await this.store.create({ id, customerId: args.customerId, currency: this.cfg.asset, amountMinor: args.amountMinor, feeMinor: this.cfg.feeMinor, address, network: this.cfg.network });
    } catch (err) {
      // Compensate a failed insert so the customer's held USDT is never stranded.
      await this.ledger.usdtWithdrawRefund({ customerId: args.customerId, currency: this.cfg.asset, amountMinor: args.amountMinor, idempotencyKey: `wd:refund:${id}`, correlationId: id }).catch(() => {});
      throw err;
    }
  }

  /** Operator marks a withdrawal SENT on-chain → settle (net left the platform, fee retained). */
  async complete(args: { id: string; providerRef?: string }): Promise<WithdrawalRequest> {
    const w = await this.require(args.id);
    if (w.status !== 'pending') throw new WithdrawalError(`withdrawal is ${w.status}`, 'CONFLICT');
    const claimed = await this.store.claim(w.id, ['pending'], 'completed', args.providerRef);
    if (!claimed) throw new WithdrawalError('withdrawal is no longer pending', 'CONFLICT');
    try {
      await this.ledger.usdtWithdrawSettle({
        currency: w.currency,
        amountMinor: w.amountMinor,
        feeMinor: w.feeMinor,
        idempotencyKey: `wd:settle:${w.id}`,
        correlationId: w.id,
        ...(args.providerRef ? { externalRef: args.providerRef } : {}),
      });
    } catch (err) {
      await this.store.claim(w.id, ['completed'], 'pending').catch(() => {});
      throw err;
    }
    return claimed;
  }

  /** Operator (or the customer, while still pending) REJECTS → refund the held USDT. */
  async reject(args: { id: string; byCustomerId?: string }): Promise<WithdrawalRequest> {
    const w = await this.require(args.id);
    if (args.byCustomerId && w.customerId !== args.byCustomerId) throw new WithdrawalError('not your withdrawal', 'FORBIDDEN');
    if (w.status !== 'pending') throw new WithdrawalError(`withdrawal is ${w.status}`, 'CONFLICT');
    const claimed = await this.store.claim(w.id, ['pending'], 'rejected');
    if (!claimed) throw new WithdrawalError('withdrawal is no longer pending', 'CONFLICT');
    try {
      await this.ledger.usdtWithdrawRefund({ customerId: w.customerId, currency: w.currency, amountMinor: w.amountMinor, idempotencyKey: `wd:refund:${w.id}`, correlationId: w.id });
    } catch (err) {
      await this.store.claim(w.id, ['rejected'], 'pending').catch(() => {});
      throw err;
    }
    return claimed;
  }

  listPending(): Promise<WithdrawalRequest[]> {
    return this.store.listPending();
  }
  listByCustomer(customerId: string, limit = 50): Promise<WithdrawalRequest[]> {
    return this.store.listByCustomer(customerId, limit);
  }
  get(id: string): Promise<WithdrawalRequest | null> {
    return this.store.get(id);
  }
  feeMinor(): bigint {
    return this.cfg.feeMinor;
  }

  private async require(id: string): Promise<WithdrawalRequest> {
    const w = await this.store.get(id);
    if (!w) throw new WithdrawalError('withdrawal not found', 'NOT_FOUND');
    return w;
  }
}
