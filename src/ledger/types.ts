import { Currency } from '../money/currency';

/** Who owns a balance-bearing account. */
export type OwnerType = 'customer' | 'agent' | 'system';

/** Account kinds. User-facing kinds must never go negative; system kinds may. */
export type AccountKind =
  | 'wallet' // customer e-money wallet
  | 'agent_float' // agent's pre-funded e-money
  | 'agent_commission' // agent earnings
  | 'p2p_escrow' // seller's asset locked for a P2P (USDT) sell offer — holder-owned, non-negative
  | 'settlement' // external world / bank rail (PIX in/out, payout out) — system
  | 'fee_revenue' // platform fees — system
  | 'fx_position' // FX desk position per currency — system
  | 'payout_suspense' // funds owed to an outbound payout (e.g. MonCash) — system
  | 'provider_fee'; // payout rail's fee taken on settlement (e.g. BenCash) — system

/** Account kinds that may NOT carry a negative balance. */
export const NON_NEGATIVE_KINDS: ReadonlySet<AccountKind> = new Set<AccountKind>([
  'wallet',
  'agent_float',
  'agent_commission',
  'p2p_escrow',
]);

/** A stable, human-readable account identity used by the domain. */
export interface AccountSpec {
  ownerType: OwnerType;
  ownerId: string | null; // null only for system accounts
  kind: AccountKind;
  currency: Currency;
}

/** Canonical string key for an account spec (used as map key / uniqueness). */
export function accountKey(spec: AccountSpec): string {
  return `${spec.ownerType}:${spec.ownerId ?? '_'}:${spec.kind}:${spec.currency}`;
}

export type TxType =
  | 'fund_wallet'
  | 'cash_in'
  | 'cash_out'
  | 'float_topup'
  | 'transfer'
  | 'payout'
  | 'airtime'
  | 'p2p_lock' // seller locks USDT into escrow for a sell offer
  | 'p2p_release' // escrow released to buyer, platform takes commission
  | 'p2p_unlock' // un-sold escrow returned to the seller
  | 'reversal';

/** One immutable double-entry line, pre-persistence. */
export interface PostingDraft {
  account: AccountSpec;
  currency: Currency;
  amountMinor: bigint; // signed: >0 credit (increases holder funds), <0 debit
}

/** A journal entry (one balanced business event), pre-persistence. */
export interface JournalDraft {
  type: TxType;
  idempotencyKey: string;
  postings: PostingDraft[];
  correlationId?: string; // links multi-journal events (e.g. cross-currency transfer)
  externalRef?: string; // provider ref (PIX e2e id, MonCash tx id, ...)
  metadata?: Record<string, unknown>;
}

/** A persisted journal, returned after posting. */
export interface PostedJournal {
  transactionUid: string;
  type: TxType;
  idempotencyKey: string;
  correlationId: string | null;
  externalRef: string | null;
  postings: PostedPosting[];
  createdAt: string;
}

export interface PostedPosting {
  accountKey: string;
  currency: Currency;
  amountMinor: bigint;
}
