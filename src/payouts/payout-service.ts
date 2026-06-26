import { LedgerService } from '../ledger/service';
import { TransferQuote } from '../ledger/operations';
import { PayoutRecord, PayoutReversalContext, PayoutStore } from './payout-store';
import { PayoutPort } from './types';

/**
 * Drives the payout state machine, the bridge between the payout rail and the ledger:
 *
 *   created ──submit()──► submitted ──sync()──► settled   (provider success → settlePayout)
 *                              │
 *                              └────sync()────► reversed  (provider failure → reverseTransfer)
 *
 * Every ledger post is idempotent (keyed by correlationId), so re-running submit/sync
 * after a crash or duplicate webhook never double-pays or double-reverses. This is also
 * what a boot-time recovery sweep calls for any payout stuck in `submitted`.
 */
export class PayoutService {
  constructor(
    private readonly port: PayoutPort | undefined,
    private readonly store: PayoutStore,
    private readonly ledger: LedgerService,
  ) {}

  /** Record the outbound leg of a transfer (status `created`). Idempotent per transfer.
   *  `providerFeeMinor` (the rail's cut on the gross payout) is LOCKED here and later
   *  split out of the settlement so the ledger records the real provider cost. */
  createForTransfer(args: {
    correlationId: string;
    recipientRef: string;
    quote: TransferQuote;
    senderId: string;
    providerFeeMinor?: bigint;
  }): Promise<PayoutRecord> {
    const { quote } = args;
    const reversal: PayoutReversalContext = {
      senderId: args.senderId,
      fromCurrency: quote.fromCurrency,
      toCurrency: quote.toCurrency,
      sendMinor: quote.sendMinor,
      feeMinor: quote.feeMinor,
      receiveMinor: quote.receiveMinor,
      rate: quote.rate,
    };
    return this.store.create({
      correlationId: args.correlationId,
      provider: this.port?.name ?? 'manual',
      recipientRef: args.recipientRef,
      currency: quote.toCurrency,
      amountMinor: quote.receiveMinor,
      ...(args.providerFeeMinor !== undefined ? { providerFeeMinor: args.providerFeeMinor } : {}),
      reversal,
    });
  }

  /** Send the payout to the provider. created → submitted. Requires a provider. */
  async submit(correlationId: string): Promise<PayoutRecord> {
    const p = await this.require(correlationId);
    if (p.status !== 'created') return p; // already submitted/settled/reversed
    const port = this.port;
    if (!port) throw new Error('no payout provider configured — use releaseManually');
    try {
      const res = await port.sendPayout({
        correlationId,
        currency: p.currency,
        amountMinor: p.amountMinor,
        recipientRef: p.recipientRef,
      });
      return this.store.update(correlationId, {
        status: 'submitted',
        providerRef: res.providerRef,
        attempts: p.attempts + 1,
        lastError: null,
      });
    } catch (err) {
      // Stay in `created` so it can be retried; record the error.
      return this.store.update(correlationId, {
        attempts: p.attempts + 1,
        lastError: (err as Error).message,
      });
    }
  }

  /** Poll the provider and advance: success → settle, failure → reverse. */
  async sync(correlationId: string): Promise<PayoutRecord> {
    const p = await this.require(correlationId);
    if (p.status !== 'submitted' || !p.providerRef || !this.port) return p;
    const status = await this.port.getStatus(p.providerRef);
    if (status.state === 'success') return this.settle(p);
    if (status.state === 'failed') return this.reverse(p);
    return p; // pending
  }

  /**
   * MANUAL mode (no auto-disbursement yet): the operator paid the recipient out of
   * band (Natcash/MonCash by hand) and releases the payout here → posts settlePayout.
   * Idempotent; `providerRef` is the external tx id the operator used, if any.
   */
  async releaseManually(correlationId: string, providerRef?: string): Promise<PayoutRecord> {
    const p = await this.require(correlationId);
    if (p.status === 'settled') return p;
    if (p.status === 'reversed') throw new Error(`payout ${correlationId} already reversed`);
    const withRef = providerRef ? await this.store.update(correlationId, { providerRef }) : p;
    return this.settle(withRef);
  }

  /** MANUAL mode: the out-of-band payout failed — reverse it (refund the sender). */
  async failManually(correlationId: string): Promise<PayoutRecord> {
    const p = await this.require(correlationId);
    if (p.status === 'reversed') return p;
    if (p.status === 'settled') throw new Error(`payout ${correlationId} already settled`);
    return this.reverse(p);
  }

  private async settle(p: PayoutRecord): Promise<PayoutRecord> {
    await this.ledger.settlePayout({
      currency: p.currency,
      amountMinor: p.amountMinor,
      providerFeeMinor: p.providerFeeMinor,
      correlationId: p.correlationId,
      externalRef: p.providerRef ?? p.correlationId,
      idempotencyKey: `payout-settle:${p.correlationId}`,
    });
    return this.store.update(p.correlationId, { status: 'settled', lastError: null });
  }

  private async reverse(p: PayoutRecord): Promise<PayoutRecord> {
    const r = p.reversal;
    const quote: TransferQuote = {
      sendMinor: r.sendMinor,
      feeMinor: r.feeMinor,
      totalDebitMinor: r.sendMinor + r.feeMinor,
      rate: r.rate,
      receiveMinor: r.receiveMinor,
      fromCurrency: r.fromCurrency,
      toCurrency: r.toCurrency,
    };
    await this.ledger.reverseTransfer({
      senderId: r.senderId,
      quote,
      correlationId: p.correlationId,
      idempotencyKeyFx: `reversal-fx:${p.correlationId}`,
      idempotencyKeyDebit: `reversal-debit:${p.correlationId}`,
    });
    return this.store.update(p.correlationId, { status: 'reversed', lastError: 'payout failed; reversed' });
  }

  list(): Promise<PayoutRecord[]> {
    return this.store.list();
  }

  private async require(correlationId: string): Promise<PayoutRecord> {
    const p = await this.store.get(correlationId);
    if (!p) throw new Error(`payout ${correlationId} not found`);
    return p;
  }
}
