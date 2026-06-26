import { Currency } from '../money/currency';
import { convert } from '../money/money';
import { AccountSpec, JournalDraft, PostingDraft } from './types';

/**
 * Pure builders that translate a business event into one or more BALANCED
 * journal drafts. No I/O. Sign convention: a posting amount is the signed change
 * to the holder's funds (+ credit / − debit); every journal nets to 0 per currency.
 */

// ---- account spec helpers --------------------------------------------------

export function customerWallet(customerId: string, currency: Currency): AccountSpec {
  return { ownerType: 'customer', ownerId: customerId, kind: 'wallet', currency };
}
export function agentFloat(agentId: string, currency: Currency): AccountSpec {
  return { ownerType: 'agent', ownerId: agentId, kind: 'agent_float', currency };
}
export function agentCommission(agentId: string, currency: Currency): AccountSpec {
  return { ownerType: 'agent', ownerId: agentId, kind: 'agent_commission', currency };
}
export function systemAccount(
  kind: 'settlement' | 'fee_revenue' | 'fx_position' | 'payout_suspense',
  currency: Currency,
): AccountSpec {
  return { ownerType: 'system', ownerId: null, kind, currency };
}

function credit(account: AccountSpec, amountMinor: bigint): PostingDraft {
  return { account, currency: account.currency, amountMinor };
}
function debit(account: AccountSpec, amountMinor: bigint): PostingDraft {
  return { account, currency: account.currency, amountMinor: -amountMinor };
}

// ---- operations ------------------------------------------------------------

/** External money enters and lands in a customer wallet (e.g. confirmed PIX in). */
export function fundWallet(args: {
  customerId: string;
  currency: Currency;
  amountMinor: bigint;
  idempotencyKey: string;
  externalRef?: string;
}): JournalDraft {
  const { customerId, currency, amountMinor } = args;
  return {
    type: 'fund_wallet',
    idempotencyKey: args.idempotencyKey,
    ...(args.externalRef ? { externalRef: args.externalRef } : {}),
    postings: [
      debit(systemAccount('settlement', currency), amountMinor),
      credit(customerWallet(customerId, currency), amountMinor),
    ],
  };
}

/** Cash-in: customer hands physical cash to an agent and receives e-money.
 *  Agent's float decreases, customer wallet increases. */
export function cashIn(args: {
  agentId: string;
  customerId: string;
  currency: Currency;
  amountMinor: bigint;
  idempotencyKey: string;
}): JournalDraft {
  const { agentId, customerId, currency, amountMinor } = args;
  return {
    type: 'cash_in',
    idempotencyKey: args.idempotencyKey,
    postings: [
      debit(agentFloat(agentId, currency), amountMinor),
      credit(customerWallet(customerId, currency), amountMinor),
    ],
  };
}

/** Cash-out: customer gives up e-money and receives physical cash from the agent. */
export function cashOut(args: {
  agentId: string;
  customerId: string;
  currency: Currency;
  amountMinor: bigint;
  idempotencyKey: string;
}): JournalDraft {
  const { agentId, customerId, currency, amountMinor } = args;
  return {
    type: 'cash_out',
    idempotencyKey: args.idempotencyKey,
    postings: [
      debit(customerWallet(customerId, currency), amountMinor),
      credit(agentFloat(agentId, currency), amountMinor),
    ],
  };
}

/** Agent buys more float with external money (e.g. PIX to the platform). */
export function floatTopup(args: {
  agentId: string;
  currency: Currency;
  amountMinor: bigint;
  idempotencyKey: string;
  externalRef?: string;
}): JournalDraft {
  const { agentId, currency, amountMinor } = args;
  return {
    type: 'float_topup',
    idempotencyKey: args.idempotencyKey,
    ...(args.externalRef ? { externalRef: args.externalRef } : {}),
    postings: [
      debit(systemAccount('settlement', currency), amountMinor),
      credit(agentFloat(agentId, currency), amountMinor),
    ],
  };
}

export interface TransferQuote {
  sendMinor: bigint; // source currency, excl. fee
  feeMinor: bigint; // source currency
  totalDebitMinor: bigint; // sendMinor + feeMinor (debited from sender)
  rate: string; // sourceCcy -> destCcy
  receiveMinor: bigint; // destination currency
  fromCurrency: Currency;
  toCurrency: Currency;
}

/** Compute a cross-currency transfer quote (pure). */
export function quoteTransfer(args: {
  fromCurrency: Currency;
  toCurrency: Currency;
  sendMinor: bigint;
  feeMinor: bigint;
  rate: string;
}): TransferQuote {
  const receiveMinor = convert(args.sendMinor, args.fromCurrency, args.toCurrency, args.rate);
  return {
    sendMinor: args.sendMinor,
    feeMinor: args.feeMinor,
    totalDebitMinor: args.sendMinor + args.feeMinor,
    rate: args.rate,
    receiveMinor,
    fromCurrency: args.fromCurrency,
    toCurrency: args.toCurrency,
  };
}

/**
 * Cross-currency transfer (e.g. BRL -> HTG). Produces TWO balanced journals
 * sharing a correlationId:
 *   J1 (source ccy): debit sender wallet (send+fee); credit fee_revenue (fee);
 *                    credit fx_position (send)            -> nets 0
 *   J2 (dest ccy):   debit fx_position (receive);
 *                    credit payout_suspense (receive)     -> nets 0
 * The payout is later settled (payout_suspense -> settlement) by `settlePayout`.
 */
/** J1 (source ccy): debit sender (send+fee); credit fee_revenue (fee); credit fx_position (send). */
export function transferDebitJournal(args: {
  senderId: string;
  quote: TransferQuote;
  correlationId: string;
  idempotencyKey: string;
  recipientRef: string;
}): JournalDraft {
  const { quote } = args;
  const from = quote.fromCurrency;
  const postings: PostingDraft[] = [
    debit(customerWallet(args.senderId, from), quote.totalDebitMinor),
    credit(systemAccount('fx_position', from), quote.sendMinor),
  ];
  // Only book a fee posting when there actually is a fee (no zero-amount postings).
  if (quote.feeMinor > 0n) {
    postings.splice(1, 0, credit(systemAccount('fee_revenue', from), quote.feeMinor));
  }
  return {
    type: 'transfer',
    idempotencyKey: args.idempotencyKey,
    correlationId: args.correlationId,
    metadata: { recipientRef: args.recipientRef, rate: quote.rate },
    postings,
  };
}

/** J2 (dest ccy): debit fx_position (receive); credit payout_suspense (receive). */
export function transferFxJournal(args: {
  quote: TransferQuote;
  correlationId: string;
  idempotencyKey: string;
  recipientRef: string;
}): JournalDraft {
  const { quote } = args;
  const to = quote.toCurrency;
  return {
    type: 'transfer',
    idempotencyKey: args.idempotencyKey,
    correlationId: args.correlationId,
    metadata: { recipientRef: args.recipientRef, rate: quote.rate },
    postings: [
      debit(systemAccount('fx_position', to), quote.receiveMinor),
      credit(systemAccount('payout_suspense', to), quote.receiveMinor),
    ],
  };
}

/**
 * Cross-currency transfer (e.g. BRL -> HTG). Produces TWO balanced journals
 * sharing a correlationId (see the per-leg builders above). The payout is later
 * settled (payout_suspense -> settlement) by `settlePayout`, or unwound by
 * `reverseTransfer` if it fails.
 */
export function transfer(args: {
  senderId: string;
  quote: TransferQuote;
  correlationId: string;
  idempotencyKeyDebit: string;
  idempotencyKeyFx: string;
  recipientRef: string; // e.g. MonCash msisdn / name
}): [JournalDraft, JournalDraft] {
  return [
    transferDebitJournal({
      senderId: args.senderId,
      quote: args.quote,
      correlationId: args.correlationId,
      idempotencyKey: args.idempotencyKeyDebit,
      recipientRef: args.recipientRef,
    }),
    transferFxJournal({
      quote: args.quote,
      correlationId: args.correlationId,
      idempotencyKey: args.idempotencyKeyFx,
      recipientRef: args.recipientRef,
    }),
  ];
}

/**
 * Reverse a cross-currency transfer when the outbound payout fails (before settle).
 * Produces TWO journals that EXACTLY negate `transfer`'s journals, sharing the
 * transfer's correlationId, returning the sender to whole:
 *   R-FX (dest ccy):   debit payout_suspense (receive); credit fx_position (receive)
 *   R-debit (src ccy): debit fx_position (send); debit fee_revenue (fee);
 *                      credit sender wallet (send + fee)
 * After reversal payout_suspense + fx_position net back to 0 and the sender is refunded.
 */
export function reverseTransfer(args: {
  senderId: string;
  quote: TransferQuote;
  correlationId: string;
  idempotencyKeyFx: string;
  idempotencyKeyDebit: string;
}): [JournalDraft, JournalDraft] {
  const { quote } = args;
  const from = quote.fromCurrency;
  const to = quote.toCurrency;

  const fxJournal: JournalDraft = {
    type: 'reversal',
    idempotencyKey: args.idempotencyKeyFx,
    correlationId: args.correlationId,
    postings: [
      debit(systemAccount('payout_suspense', to), quote.receiveMinor),
      credit(systemAccount('fx_position', to), quote.receiveMinor),
    ],
  };

  const debitPostings: PostingDraft[] = [
    debit(systemAccount('fx_position', from), quote.sendMinor),
    credit(customerWallet(args.senderId, from), quote.totalDebitMinor),
  ];
  if (quote.feeMinor > 0n) {
    debitPostings.splice(1, 0, debit(systemAccount('fee_revenue', from), quote.feeMinor));
  }
  const debitJournal: JournalDraft = {
    type: 'reversal',
    idempotencyKey: args.idempotencyKeyDebit,
    correlationId: args.correlationId,
    postings: debitPostings,
  };

  return [fxJournal, debitJournal];
}

/**
 * Mobile airtime top-up: the customer's wallet pays for airtime sent to a phone via
 * a provider (DingConnect). Funds leave the wallet to the external world (settlement).
 */
export function airtimeTopup(args: {
  customerId: string;
  currency: Currency;
  amountMinor: bigint;
  idempotencyKey: string;
  externalRef?: string;
}): JournalDraft {
  const { customerId, currency, amountMinor } = args;
  return {
    type: 'airtime',
    idempotencyKey: args.idempotencyKey,
    ...(args.externalRef ? { externalRef: args.externalRef } : {}),
    postings: [
      debit(customerWallet(customerId, currency), amountMinor),
      credit(systemAccount('settlement', currency), amountMinor),
    ],
  };
}

/** Reverse an airtime debit (refund the wallet) when the provider send fails. */
export function reverseAirtime(args: {
  customerId: string;
  currency: Currency;
  amountMinor: bigint;
  idempotencyKey: string;
}): JournalDraft {
  const { customerId, currency, amountMinor } = args;
  return {
    type: 'reversal',
    idempotencyKey: args.idempotencyKey,
    postings: [
      debit(systemAccount('settlement', currency), amountMinor),
      credit(customerWallet(customerId, currency), amountMinor),
    ],
  };
}

/** Settle a confirmed outbound payout: funds leave the system to the recipient. */
export function settlePayout(args: {
  currency: Currency;
  amountMinor: bigint;
  correlationId: string;
  idempotencyKey: string;
  externalRef: string; // MonCash payout id
}): JournalDraft {
  const { currency, amountMinor } = args;
  return {
    type: 'payout',
    idempotencyKey: args.idempotencyKey,
    correlationId: args.correlationId,
    externalRef: args.externalRef,
    postings: [
      debit(systemAccount('payout_suspense', currency), amountMinor),
      credit(systemAccount('settlement', currency), amountMinor),
    ],
  };
}
