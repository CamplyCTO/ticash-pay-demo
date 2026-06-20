import { Currency } from '../money/currency';
import { assertBalanced, LedgerError } from './engine';
import {
  BalanceRow,
  FeedFilter,
  FeedRow,
  LedgerStore,
  ReconResult,
} from './store';
import {
  accountKey,
  AccountSpec,
  JournalDraft,
  NON_NEGATIVE_KINDS,
  PostedJournal,
  PostedPosting,
} from './types';

interface StoredJournal {
  transactionUid: string;
  seq: number;
  journal: JournalDraft;
  createdAt: string;
}

/**
 * Deterministic in-memory ledger store. Mirrors the exact orchestration of the
 * Postgres adapter (balance check -> idempotency -> overdraft guard -> persist
 * postings + balance cache), but with no I/O. Used for unit/property tests and
 * the runnable demo, and as the executable specification the SQL adapter matches.
 *
 * NOTE: single-threaded JS means `post` is naturally serialized; the Postgres
 * adapter achieves the same isolation via SELECT ... FOR UPDATE + a serializable
 * transaction.
 */
export class InMemoryLedgerStore implements LedgerStore {
  private readonly journals: StoredJournal[] = [];
  private readonly byIdempotencyKey = new Map<string, StoredJournal>();
  private readonly balances = new Map<string, bigint>();
  private readonly accounts = new Map<string, AccountSpec>();
  private seq = 0;

  constructor(private readonly clock: () => string = defaultClock) {}

  async post(journal: JournalDraft): Promise<PostedJournal> {
    // 1. structural invariant
    assertBalanced(journal);

    // 2. idempotency: same key -> return the already-posted journal unchanged
    const existing = this.byIdempotencyKey.get(journal.idempotencyKey);
    if (existing) {
      return this.toPosted(existing);
    }

    // 3. overdraft guard: compute prospective balances first, commit only if valid
    const deltas = new Map<string, bigint>();
    for (const p of journal.postings) {
      const key = accountKey(p.account);
      this.accounts.set(key, p.account);
      deltas.set(key, (deltas.get(key) ?? 0n) + p.amountMinor);
    }
    for (const [key, delta] of deltas) {
      const next = (this.balances.get(key) ?? 0n) + delta;
      const kind = this.accounts.get(key)!.kind;
      if (NON_NEGATIVE_KINDS.has(kind) && next < 0n) {
        throw new LedgerError(
          `insufficient funds for ${key}: balance would become ${next}`,
          'INSUFFICIENT_FUNDS',
        );
      }
    }

    // 4. commit (atomic in single-threaded JS)
    for (const [key, delta] of deltas) {
      this.balances.set(key, (this.balances.get(key) ?? 0n) + delta);
    }
    const stored: StoredJournal = {
      transactionUid: `tx_${++this.seq}`,
      seq: this.seq,
      journal,
      createdAt: this.clock(),
    };
    this.journals.push(stored);
    this.byIdempotencyKey.set(journal.idempotencyKey, stored);
    return this.toPosted(stored);
  }

  async getBalance(spec: AccountSpec): Promise<bigint> {
    return this.balances.get(accountKey(spec)) ?? 0n;
  }

  async listBalances(): Promise<BalanceRow[]> {
    return [...this.accounts.entries()]
      .map(([key, spec]) => ({
        accountKey: key,
        ownerType: spec.ownerType,
        ownerId: spec.ownerId,
        kind: spec.kind,
        currency: spec.currency,
        balanceMinor: this.balances.get(key) ?? 0n,
      }))
      .sort((a, b) => a.accountKey.localeCompare(b.accountKey));
  }

  async getFeed(filter: FeedFilter = {}): Promise<FeedRow[]> {
    const rows: FeedRow[] = [];
    for (let i = this.journals.length - 1; i >= 0; i--) {
      const j = this.journals[i]!;
      if (filter.type && j.journal.type !== filter.type) continue;
      for (const p of j.journal.postings) {
        const key = accountKey(p.account);
        if (filter.accountKey && key !== filter.accountKey) continue;
        rows.push({
          transactionUid: j.transactionUid,
          type: j.journal.type,
          externalRef: j.journal.externalRef ?? null,
          correlationId: j.journal.correlationId ?? null,
          createdAt: j.createdAt,
          accountKey: key,
          currency: p.currency,
          amountMinor: p.amountMinor,
        });
      }
      if (filter.limit && rows.length >= filter.limit) break;
    }
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  async reconcile(): Promise<ReconResult> {
    // (a) per-currency closure: sum of all balances per currency must be 0
    const perCurrency = new Map<Currency, bigint>();
    for (const [key, spec] of this.accounts) {
      perCurrency.set(
        spec.currency,
        (perCurrency.get(spec.currency) ?? 0n) + (this.balances.get(key) ?? 0n),
      );
    }
    // (b) cache vs recomputed sum(postings)
    const computed = new Map<string, bigint>();
    for (const j of this.journals) {
      for (const p of j.journal.postings) {
        const key = accountKey(p.account);
        computed.set(key, (computed.get(key) ?? 0n) + p.amountMinor);
      }
    }
    const cacheDivergences: ReconResult['cacheDivergences'] = [];
    for (const [key] of this.accounts) {
      const cached = this.balances.get(key) ?? 0n;
      const sum = computed.get(key) ?? 0n;
      if (cached !== sum) {
        cacheDivergences.push({ accountKey: key, cached: `${cached}`, computed: `${sum}` });
      }
    }

    const perCurrencyTotals: Record<string, string> = {};
    let balanced = true;
    for (const [ccy, total] of perCurrency) {
      perCurrencyTotals[ccy] = `${total}`;
      if (total !== 0n) balanced = false;
    }
    return {
      perCurrencyTotals,
      cacheDivergences,
      balanced,
      consistent: cacheDivergences.length === 0,
    };
  }

  private toPosted(stored: StoredJournal): PostedJournal {
    const postings: PostedPosting[] = stored.journal.postings.map((p) => ({
      accountKey: accountKey(p.account),
      currency: p.currency,
      amountMinor: p.amountMinor,
    }));
    return {
      transactionUid: stored.transactionUid,
      type: stored.journal.type,
      idempotencyKey: stored.journal.idempotencyKey,
      correlationId: stored.journal.correlationId ?? null,
      externalRef: stored.journal.externalRef ?? null,
      postings,
      createdAt: stored.createdAt,
    };
  }
}

let counter = 0;
function defaultClock(): string {
  // Monotonic, deterministic-ish timestamp surrogate for the demo/tests.
  return new Date(Date.UTC(2026, 0, 1, 0, 0, counter++)).toISOString();
}
