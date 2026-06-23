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
    private readonly port: PayoutPort,
    private readonly store: PayoutStore,
    private readonly ledger: LedgerService,
  ) {}

  /** Record the outbound leg of a transfer (status `created`). Idempotent per transfer. */
  createForTransfer(args: {
    correlationId: string;
    recipientRef: string;
    quote: TransferQuote;
    senderId: string;
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
      provider: this.port.name,
      recipientRef: args.recipientRef,
      currency: quote.toCurrency,
      amountMinor: quote.receiveMinor,
      reversal,
    });
  }

  /** Send the payout to the provider. created → submitted. */
  async submit(correlationId: string): Promise<PayoutRecord> {
    const p = await this.require(correlationId);
    if (p.status !== 'created') return p; // already submitted/settled/reversed
    try {
      const res = await this.port.sendPayout({
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
    if (p.status !== 'submitted' || !p.providerRef) return p;
    const status = await this.port.getStatus(p.providerRef);
    if (status.state === 'success') return this.settle(p);
    if (status.state === 'failed') return this.reverse(p);
    return p; // pending
  }

  private async settle(p: PayoutRecord): Promise<PayoutRecord> {
    await this.ledger.settlePayout({
      currency: p.currency,
      amountMinor: p.amountMinor,
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
