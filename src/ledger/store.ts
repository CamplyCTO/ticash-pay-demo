import { Currency } from '../money/currency';
import { AccountSpec, JournalDraft, PostedJournal, TxType } from './types';

export interface BalanceRow {
  accountKey: string;
  ownerType: string;
  ownerId: string | null;
  kind: string;
  currency: Currency;
  balanceMinor: bigint;
}

export interface FeedFilter {
  limit?: number;
  type?: TxType;
  accountKey?: string;
}

export interface FeedRow {
  transactionUid: string;
  type: TxType;
  externalRef: string | null;
  correlationId: string | null;
  createdAt: string;
  accountKey: string;
  currency: Currency;
  amountMinor: bigint;
}

export interface ReconResult {
  /** Per-currency sum of ALL account balances; must be 0 in a closed system. */
  perCurrencyTotals: Record<string, string>;
  /** Accounts where the cached balance != sum(postings). Must be empty. */
  cacheDivergences: Array<{ accountKey: string; cached: string; computed: string }>;
  balanced: boolean; // perCurrencyTotals all zero
  consistent: boolean; // no cache divergences
}

/**
 * The persistence port. Implemented by InMemoryLedgerStore (tests/demo) and
 * PgLedgerStore (production). `post` is atomic and idempotent.
 */
export interface LedgerStore {
  /**
   * Atomically validate + persist a journal. If a journal with the same
   * idempotencyKey already exists, returns it unchanged (idempotent replay).
   * Enforces non-negative balances for user-facing account kinds.
   */
  post(journal: JournalDraft): Promise<PostedJournal>;

  getBalance(spec: AccountSpec): Promise<bigint>;
  listBalances(): Promise<BalanceRow[]>;
  getFeed(filter?: FeedFilter): Promise<FeedRow[]>;
  reconcile(): Promise<ReconResult>;
}
