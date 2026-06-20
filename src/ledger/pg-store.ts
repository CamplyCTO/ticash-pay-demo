import { Pool, PoolClient } from 'pg';
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
} from './types';

/**
 * Production ledger store. Each `post` runs in a SERIALIZABLE transaction:
 *   1. assert balanced (domain invariant)
 *   2. idempotency lookup (unique idempotency_key)
 *   3. upsert + LOCK each touched balance row (SELECT ... FOR UPDATE)
 *   4. overdraft guard for non-negative kinds
 *   5. insert transaction + postings, bump balance cache
 * The DB enforces the same invariants independently via the balanced / append-only
 * triggers, so even a buggy caller cannot corrupt the ledger.
 */
export class PgLedgerStore implements LedgerStore {
  constructor(private readonly pool: Pool) {}

  async post(journal: JournalDraft): Promise<PostedJournal> {
    assertBalanced(journal);
    // SERIALIZABLE transactions can abort with 40001 (serialization_failure) or
    // 40P01 (deadlock) under contention; these are safe to retry transparently.
    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.postOnce(journal);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if ((code === '40001' || code === '40P01') && attempt < MAX_ATTEMPTS) {
          continue;
        }
        throw err;
      }
    }
  }

  private async postOnce(journal: JournalDraft): Promise<PostedJournal> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      const existing = await this.findByIdempotencyKey(client, journal.idempotencyKey);
      if (existing) {
        await client.query('COMMIT');
        return existing;
      }

      // Resolve accounts and aggregate deltas per account.
      const deltas = new Map<string, { spec: AccountSpec; accountId: number; delta: bigint }>();
      for (const p of journal.postings) {
        const key = accountKey(p.account);
        const accountId = await this.ensureAccount(client, p.account);
        const entry = deltas.get(key);
        if (entry) entry.delta += p.amountMinor;
        else deltas.set(key, { spec: p.account, accountId, delta: p.amountMinor });
      }

      // Lock balance rows in a deterministic order to avoid deadlocks.
      const ordered = [...deltas.values()].sort((a, b) => a.accountId - b.accountId);
      for (const { spec, accountId, delta } of ordered) {
        const cur = await this.lockBalance(client, accountId);
        const next = cur + delta;
        if (NON_NEGATIVE_KINDS.has(spec.kind) && next < 0n) {
          throw new LedgerError(
            `insufficient funds for ${accountKey(spec)}: balance would become ${next}`,
            'INSUFFICIENT_FUNDS',
          );
        }
      }

      // Insert journal header.
      const txRes = await client.query(
        `INSERT INTO transactions (type, external_ref, idempotency_key, correlation_id, metadata)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, transaction_uid, created_at`,
        [
          journal.type,
          journal.externalRef ?? null,
          journal.idempotencyKey,
          journal.correlationId ?? null,
          journal.metadata ?? {},
        ],
      );
      const txId = txRes.rows[0].id as number;

      // Insert postings + bump balance cache.
      for (const p of journal.postings) {
        const accountId = deltas.get(accountKey(p.account))!.accountId;
        await client.query(
          `INSERT INTO postings (transaction_id, account_id, currency, amount_minor)
           VALUES ($1,$2,$3,$4)`,
          [txId, accountId, p.currency, p.amountMinor.toString()],
        );
      }
      for (const { accountId, delta } of ordered) {
        await client.query(
          `UPDATE account_balances
             SET balance_minor = balance_minor + $2, version = version + 1, updated_at = now()
           WHERE account_id = $1`,
          [accountId, delta.toString()],
        );
      }

      await client.query('COMMIT');
      return {
        transactionUid: txRes.rows[0].transaction_uid,
        type: journal.type,
        idempotencyKey: journal.idempotencyKey,
        correlationId: journal.correlationId ?? null,
        externalRef: journal.externalRef ?? null,
        createdAt: txRes.rows[0].created_at.toISOString(),
        postings: journal.postings.map((p) => ({
          accountKey: accountKey(p.account),
          currency: p.currency,
          amountMinor: p.amountMinor,
        })),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getBalance(spec: AccountSpec): Promise<bigint> {
    const res = await this.pool.query(
      `SELECT ab.balance_minor
         FROM account_balances ab
         JOIN accounts a ON a.id = ab.account_id
        WHERE a.account_key = $1`,
      [accountKey(spec)],
    );
    return res.rows[0] ? BigInt(res.rows[0].balance_minor) : 0n;
  }

  async listBalances(): Promise<BalanceRow[]> {
    const res = await this.pool.query(
      `SELECT a.account_key, a.owner_type, a.owner_id, a.kind, a.currency,
              COALESCE(ab.balance_minor, 0) AS balance_minor
         FROM accounts a
         LEFT JOIN account_balances ab ON ab.account_id = a.id
        ORDER BY a.account_key`,
    );
    return res.rows.map((r) => ({
      accountKey: r.account_key,
      ownerType: r.owner_type,
      ownerId: r.owner_id,
      kind: r.kind,
      currency: r.currency.trim() as Currency,
      balanceMinor: BigInt(r.balance_minor),
    }));
  }

  async getFeed(filter: FeedFilter = {}): Promise<FeedRow[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.type) {
      params.push(filter.type);
      clauses.push(`t.type = $${params.length}`);
    }
    if (filter.accountKey) {
      params.push(filter.accountKey);
      clauses.push(`a.account_key = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(filter.limit ?? 100);
    const res = await this.pool.query(
      `SELECT t.transaction_uid, t.type, t.external_ref, t.correlation_id, t.created_at,
              a.account_key, p.currency, p.amount_minor
         FROM postings p
         JOIN transactions t ON t.id = p.transaction_id
         JOIN accounts a ON a.id = p.account_id
         ${where}
        ORDER BY p.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows.map((r) => ({
      transactionUid: r.transaction_uid,
      type: r.type,
      externalRef: r.external_ref,
      correlationId: r.correlation_id,
      createdAt: r.created_at.toISOString(),
      accountKey: r.account_key,
      currency: r.currency.trim() as Currency,
      amountMinor: BigInt(r.amount_minor),
    }));
  }

  async reconcile(): Promise<ReconResult> {
    const perCcy = await this.pool.query(
      `SELECT a.currency, COALESCE(SUM(ab.balance_minor),0) AS total
         FROM accounts a
         LEFT JOIN account_balances ab ON ab.account_id = a.id
        GROUP BY a.currency`,
    );
    const divergences = await this.pool.query(
      `SELECT a.account_key,
              COALESCE(ab.balance_minor,0) AS cached,
              COALESCE((SELECT SUM(p.amount_minor) FROM postings p WHERE p.account_id = a.id),0) AS computed
         FROM accounts a
         LEFT JOIN account_balances ab ON ab.account_id = a.id`,
    );
    const perCurrencyTotals: Record<string, string> = {};
    let balanced = true;
    for (const r of perCcy.rows) {
      perCurrencyTotals[r.currency.trim()] = String(r.total);
      if (BigInt(r.total) !== 0n) balanced = false;
    }
    const cacheDivergences = divergences.rows
      .filter((r) => BigInt(r.cached) !== BigInt(r.computed))
      .map((r) => ({ accountKey: r.account_key, cached: String(r.cached), computed: String(r.computed) }));
    return {
      perCurrencyTotals,
      cacheDivergences,
      balanced,
      consistent: cacheDivergences.length === 0,
    };
  }

  // --- helpers --------------------------------------------------------------

  private async ensureAccount(client: PoolClient, spec: AccountSpec): Promise<number> {
    const key = accountKey(spec);
    const nonNegative = NON_NEGATIVE_KINDS.has(spec.kind);
    const res = await client.query(
      `INSERT INTO accounts (account_key, owner_type, owner_id, kind, currency, non_negative)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (account_key) DO UPDATE SET account_key = EXCLUDED.account_key
       RETURNING id`,
      [key, spec.ownerType, spec.ownerId, spec.kind, spec.currency, nonNegative],
    );
    const accountId = res.rows[0].id as number;
    await client.query(
      `INSERT INTO account_balances (account_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [accountId],
    );
    return accountId;
  }

  private async lockBalance(client: PoolClient, accountId: number): Promise<bigint> {
    const res = await client.query(
      `SELECT balance_minor FROM account_balances WHERE account_id = $1 FOR UPDATE`,
      [accountId],
    );
    return res.rows[0] ? BigInt(res.rows[0].balance_minor) : 0n;
  }

  private async findByIdempotencyKey(
    client: PoolClient,
    key: string,
  ): Promise<PostedJournal | null> {
    const tx = await client.query(
      `SELECT id, transaction_uid, type, external_ref, correlation_id, created_at
         FROM transactions WHERE idempotency_key = $1`,
      [key],
    );
    if (!tx.rows[0]) return null;
    const row = tx.rows[0];
    const postings = await client.query(
      `SELECT a.account_key, p.currency, p.amount_minor
         FROM postings p JOIN accounts a ON a.id = p.account_id
        WHERE p.transaction_id = $1`,
      [row.id],
    );
    return {
      transactionUid: row.transaction_uid,
      type: row.type,
      idempotencyKey: key,
      correlationId: row.correlation_id,
      externalRef: row.external_ref,
      createdAt: row.created_at.toISOString(),
      postings: postings.rows.map((r) => ({
        accountKey: r.account_key,
        currency: r.currency.trim() as Currency,
        amountMinor: BigInt(r.amount_minor),
      })),
    };
  }
}
