import { createHash, randomUUID } from 'node:crypto';
import { Currency } from '../money/currency';
import * as ops from './operations';
import { LedgerError } from './engine';
import { BalanceRow, FeedFilter, FeedRow, LedgerStore, ReconResult } from './store';
import { AccountSpec, PostedJournal } from './types';

/**
 * Business-facing service. Translates app operations into balanced journals and
 * posts them through the store port. Storage-agnostic (in-memory or Postgres).
 */
export class LedgerService {
  constructor(private readonly store: LedgerStore) {}

  fundWallet(args: {
    customerId: string;
    currency: Currency;
    amountMinor: bigint;
    idempotencyKey: string;
    externalRef?: string;
  }): Promise<PostedJournal> {
    return this.store.post(ops.fundWallet(args));
  }

  cashIn(args: {
    agentId: string;
    customerId: string;
    currency: Currency;
    amountMinor: bigint;
    idempotencyKey: string;
  }): Promise<PostedJournal> {
    return this.store.post(ops.cashIn(args));
  }

  cashOut(args: {
    agentId: string;
    customerId: string;
    currency: Currency;
    amountMinor: bigint;
    idempotencyKey: string;
  }): Promise<PostedJournal> {
    return this.store.post(ops.cashOut(args));
  }

  floatTopup(args: {
    agentId: string;
    currency: Currency;
    amountMinor: bigint;
    idempotencyKey: string;
    externalRef?: string;
  }): Promise<PostedJournal> {
    return this.store.post(ops.floatTopup(args));
  }

  quoteTransfer = ops.quoteTransfer;

  /** Post the source-currency debit leg of a transfer (idempotent by key). Saga step. */
  postTransferDebit(args: {
    senderId: string;
    quote: ops.TransferQuote;
    correlationId: string;
    recipientRef: string;
    idempotencyKey: string;
  }): Promise<PostedJournal> {
    return this.store.post(ops.transferDebitJournal(args));
  }

  /** Post the destination-currency FX leg of a transfer (idempotent by key). Saga step. */
  postTransferFx(args: {
    quote: ops.TransferQuote;
    correlationId: string;
    recipientRef: string;
    idempotencyKey: string;
  }): Promise<PostedJournal> {
    return this.store.post(ops.transferFxJournal(args));
  }

  /**
   * Initiate a cross-currency transfer. Posts the source-currency debit journal
   * and the FX journal (funds parked in payout_suspense), sharing a correlationId.
   * Returns the correlationId so the payout can later be settled.
   */
  async initiateTransfer(args: {
    senderId: string;
    recipientRef: string;
    fromCurrency: Currency;
    toCurrency: Currency;
    sendMinor: bigint;
    feeMinor: bigint;
    rate: string;
    idempotencyKey: string; // caller-supplied base key for the whole event
  }): Promise<{
    correlationId: string;
    quote: ops.TransferQuote;
    debit: PostedJournal;
    fx: PostedJournal;
  }> {
    const quote = ops.quoteTransfer({
      fromCurrency: args.fromCurrency,
      toCurrency: args.toCurrency,
      sendMinor: args.sendMinor,
      feeMinor: args.feeMinor,
      rate: args.rate,
    });
    const correlationId = deriveUuid(args.idempotencyKey);
    const [debitDraft, fxDraft] = ops.transfer({
      senderId: args.senderId,
      quote,
      correlationId,
      recipientRef: args.recipientRef,
      idempotencyKeyDebit: `${args.idempotencyKey}:debit`,
      idempotencyKeyFx: `${args.idempotencyKey}:fx`,
    });
    // Debit first: if the sender lacks funds it throws before any FX leg is booked.
    const debit = await this.store.post(debitDraft);
    const fx = await this.store.post(fxDraft);
    return { correlationId, quote, debit, fx };
  }

  /**
   * Reverse a transfer when its payout fails (before settlement): posts the two
   * reversal journals, returning the sender to whole. Idempotent per correlation.
   */
  async reverseTransfer(args: {
    senderId: string;
    quote: ops.TransferQuote;
    correlationId: string;
    idempotencyKeyFx: string;
    idempotencyKeyDebit: string;
  }): Promise<{ fx: PostedJournal; debit: PostedJournal }> {
    const [fxDraft, debitDraft] = ops.reverseTransfer(args);
    const fx = await this.store.post(fxDraft);
    const debit = await this.store.post(debitDraft);
    return { fx, debit };
  }

  /** Debit a wallet for airtime: cost leaves to the provider, margin is platform revenue. */
  airtimeTopup(args: {
    customerId: string;
    currency: Currency;
    costMinor: bigint;
    marginMinor: bigint;
    idempotencyKey: string;
    externalRef?: string;
  }): Promise<PostedJournal> {
    return this.store.post(ops.airtimeTopup(args));
  }

  /** Refund an airtime debit (retail) when the provider send fails. */
  reverseAirtime(args: {
    customerId: string;
    currency: Currency;
    costMinor: bigint;
    marginMinor: bigint;
    idempotencyKey: string;
  }): Promise<PostedJournal> {
    return this.store.post(ops.reverseAirtime(args));
  }

  /** Settle a confirmed outbound payout (funds leave payout_suspense; rail fee split out). */
  async settlePayout(args: {
    currency: Currency;
    amountMinor: bigint;
    correlationId: string;
    externalRef: string;
    idempotencyKey: string;
    providerFeeMinor?: bigint;
  }): Promise<PostedJournal> {
    const fee = args.providerFeeMinor ?? 0n;
    if (fee < 0n || fee > args.amountMinor) {
      throw new LedgerError(`provider fee ${fee} out of range for payout ${args.amountMinor}`, 'VALIDATION');
    }
    return this.store.post(ops.settlePayout(args));
  }

  getBalance(spec: AccountSpec): Promise<bigint> {
    return this.store.getBalance(spec);
  }
  listBalances(): Promise<BalanceRow[]> {
    return this.store.listBalances();
  }
  getFeed(filter?: FeedFilter): Promise<FeedRow[]> {
    return this.store.getFeed(filter);
  }
  reconcile(): Promise<ReconResult> {
    return this.store.reconcile();
  }
}

/**
 * Deterministic, collision-resistant UUIDv4-shaped id derived from a string
 * (stable per idempotency key). Uses SHA-256 so distinct keys cannot collide into
 * the same correlationId — a collision would let the `transfers`/`payouts` unique
 * constraint mis-treat one transfer as a replay of another. Money must not collide.
 */
export function deriveUuid(seed: string): string {
  if (seed.length === 0) return randomUUID();
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
