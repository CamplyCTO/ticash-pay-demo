import { randomUUID } from 'node:crypto';
import { Currency } from '../money/currency';
import * as ops from './operations';
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

  /** Settle a confirmed outbound payout (funds leave payout_suspense to recipient). */
  settlePayout(args: {
    currency: Currency;
    amountMinor: bigint;
    correlationId: string;
    externalRef: string;
    idempotencyKey: string;
  }): Promise<PostedJournal> {
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

/** Deterministic UUIDv4-shaped id derived from a string (stable per idempotency key). */
export function deriveUuid(seed: string): string {
  // Not cryptographic; just a stable correlation id when the caller has none.
  if (seed.length === 0) return randomUUID();
  let h = 0x811c9dc5;
  const hex: string[] = [];
  for (let i = 0; i < 32; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i * 131;
    h = Math.imul(h, 0x01000193) >>> 0;
    hex.push((h & 0xf).toString(16));
  }
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
