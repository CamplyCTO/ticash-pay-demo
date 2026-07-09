import { Currency } from '../money/currency';
import { TransferQuote, quoteTransfer } from '../ledger/operations';
import { LedgerError } from '../ledger/engine';
import { LedgerService, deriveUuid } from '../ledger/service';
import { PayoutService } from '../payouts/payout-service';
import { RateService, applyBps } from '../fx/rate-service';
import { TransferPricing } from '../fx/types';
import { NewTransfer, PayoutRail, TransferRecord, TransferStore } from './transfer-store';

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
    private readonly rates?: RateService,
  ) {}

  async initiate(args: {
    senderId: string;
    recipientRef: string;
    recipientName?: string | null;
    payoutRail?: PayoutRail | null;
    fromCurrency: Currency;
    toCurrency: Currency;
    sendMinor: bigint;
    feeMinor?: bigint; // optional: when omitted, the corridor's platform fee (bps) is applied
    rate?: string; // optional: when omitted, the rate service prices + LOCKS the rate
    idempotencyKey: string;
  }): Promise<{ correlationId: string; quote: TransferQuote; status: TransferRecord['status'] }> {
    // Lock rate + fee at quote time: caller-supplied, else priced from the corridor config.
    const priced =
      args.rate === undefined || args.feeMinor === undefined
        ? await this.price(args.fromCurrency, args.toCurrency, args.sendMinor)
        : undefined;
    const rate = args.rate ?? (priced as TransferPricing).rate;
    const feeMinor = args.feeMinor ?? (priced as TransferPricing).platformFeeMinor;
    const quote = quoteTransfer({
      fromCurrency: args.fromCurrency,
      toCurrency: args.toCurrency,
      sendMinor: args.sendMinor,
      feeMinor,
      rate,
    });
    const correlationId = deriveUuid(args.idempotencyKey);
    const intent: NewTransfer = {
      correlationId,
      baseIdempotencyKey: args.idempotencyKey,
      senderId: args.senderId,
      recipientRef: args.recipientRef,
      recipientName: args.recipientName ?? null,
      payoutRail: args.payoutRail ?? null,
      fromCurrency: args.fromCurrency,
      toCurrency: args.toCurrency,
      sendMinor: args.sendMinor,
      feeMinor, // the LOCKED fee (caller-supplied or the corridor's platform fee)
      rate, // the LOCKED rate (caller-supplied or priced by the FX service)
      receiveMinor: quote.receiveMinor,
    };
    // Idempotent on correlationId: returns the EXISTING record on a replay. Build the
    // response quote from the persisted record so a duplicate call always reports the
    // LOCKED rate, even if the live rate changed between calls.
    const created = await this.store.create(intent);
    const record = await this.run(correlationId);
    return { correlationId, quote: quoteFrom(created), status: record.status };
  }

  /** The caller's own transfers, newest first — enriches the app's activity history. */
  history(senderId: string, limit: number): Promise<TransferRecord[]> {
    return this.store.listBySender(senderId, limit);
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
        // Lock the rail's fee (corridor providerFeeBps × gross). Resolved here so it
        // survives crash recovery; the payout's create is idempotent, so the value
        // computed on the FIRST run is the one that sticks.
        const providerFeeMinor = await this.resolveProviderFee(t.fromCurrency, t.toCurrency, quote.receiveMinor);
        await this.payouts.createForTransfer({ correlationId, recipientRef: t.recipientRef, quote, senderId: t.senderId, providerFeeMinor });
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

  private async price(from: Currency, to: Currency, sendMinor: bigint): Promise<TransferPricing> {
    if (!this.rates) throw new LedgerError('no rate/fee provided and no FX rate service configured', 'VALIDATION');
    return this.rates.priceTransfer(from, to, sendMinor);
  }

  /** The corridor's payout-rail fee on the gross payout. 0 when no corridor is configured. */
  private async resolveProviderFee(from: Currency, to: Currency, grossMinor: bigint): Promise<bigint> {
    if (!this.rates) return 0n;
    try {
      const q = await this.rates.quote(from, to);
      return applyBps(grossMinor, q.providerFeeBps);
    } catch {
      return 0n; // no corridor config (e.g. caller-supplied rate on an unconfigured pair)
    }
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
