import { Currency } from '../money/currency';
import { TransferQuote, quoteTransfer } from '../ledger/operations';
import { LedgerService, deriveUuid } from '../ledger/service';
import { PayoutService } from '../payouts/payout-service';
import { NewTransfer, TransferRecord, TransferStore } from './transfer-store';

/**
 * Orchestrates a cross-currency transfer as a crash-safe saga. `initiate` persists
 * the intent up front, then `run` executes the remaining steps and advances the
 * status after each:
 *
 *   pending ─debit─► debited ─fx─► fx_booked ─payout─► completed
 *
 * Every step is idempotent (ledger by idempotency key, payout by correlationId), so
 * if the process dies between any two steps, calling `run` (or the boot `recover`
 * sweep) again resumes exactly where it left off — no double-post, no stuck funds.
 */
export class TransferService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly store: TransferStore,
    private readonly payouts?: PayoutService,
  ) {}

  async initiate(args: {
    senderId: string;
    recipientRef: string;
    fromCurrency: Currency;
    toCurrency: Currency;
    sendMinor: bigint;
    feeMinor: bigint;
    rate: string;
    idempotencyKey: string;
  }): Promise<{ correlationId: string; quote: TransferQuote; status: TransferRecord['status'] }> {
    const quote = quoteTransfer({
      fromCurrency: args.fromCurrency,
      toCurrency: args.toCurrency,
      sendMinor: args.sendMinor,
      feeMinor: args.feeMinor,
      rate: args.rate,
    });
    const correlationId = deriveUuid(args.idempotencyKey);
    const intent: NewTransfer = {
      correlationId,
      baseIdempotencyKey: args.idempotencyKey,
      senderId: args.senderId,
      recipientRef: args.recipientRef,
      fromCurrency: args.fromCurrency,
      toCurrency: args.toCurrency,
      sendMinor: args.sendMinor,
      feeMinor: args.feeMinor,
      rate: args.rate,
      receiveMinor: quote.receiveMinor,
    };
    await this.store.create(intent); // idempotent on correlationId
    const record = await this.run(correlationId);
    return { correlationId, quote, status: record.status };
  }

  /** Execute whatever steps remain for this transfer. Safe to call repeatedly. */
  async run(correlationId: string): Promise<TransferRecord> {
    let t = await this.store.get(correlationId);
    if (!t) throw new Error(`transfer ${correlationId} not found`);
    const quote = quoteFrom(t);

    if (t.status === 'pending') {
      await this.ledger.postTransferDebit({
        senderId: t.senderId,
        quote,
        correlationId,
        recipientRef: t.recipientRef,
        idempotencyKey: `${t.baseIdempotencyKey}:debit`,
      });
      t = await this.store.setStatus(correlationId, 'debited');
    }

    if (t.status === 'debited') {
      await this.ledger.postTransferFx({
        quote,
        correlationId,
        recipientRef: t.recipientRef,
        idempotencyKey: `${t.baseIdempotencyKey}:fx`,
      });
      t = await this.store.setStatus(correlationId, 'fx_booked');
    }

    if (t.status === 'fx_booked') {
      // Hand off to the payout state machine (idempotent per correlationId). When no
      // payout rail is configured, funds simply rest in payout_suspense — still complete.
      if (this.payouts) {
        await this.payouts.createForTransfer({ correlationId, recipientRef: t.recipientRef, quote, senderId: t.senderId });
      }
      t = await this.store.setStatus(correlationId, 'completed');
    }

    return t;
  }

  /**
   * Boot recovery: drive every half-finished transfer to completion. A failure on
   * one transfer is isolated (logged-by-caller via the count) and left for the next
   * sweep — it must never block the others or server startup. Returns # resumed.
   */
  async recover(): Promise<number> {
    const stuck = await this.store.listIncomplete();
    let resumed = 0;
    for (const t of stuck) {
      try {
        await this.run(t.correlationId);
        resumed++;
      } catch {
        // Leave this one for the next sweep; don't abort the batch or startup.
      }
    }
    return resumed;
  }

  list(): Promise<TransferRecord[]> {
    return this.store.listIncomplete();
  }
}

function quoteFrom(t: TransferRecord): TransferQuote {
  return {
    sendMinor: t.sendMinor,
    feeMinor: t.feeMinor,
    totalDebitMinor: t.sendMinor + t.feeMinor,
    rate: t.rate,
    receiveMinor: t.receiveMinor,
    fromCurrency: t.fromCurrency,
    toCurrency: t.toCurrency,
  };
}
