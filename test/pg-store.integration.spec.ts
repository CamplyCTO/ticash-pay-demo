import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerService } from '../src/ledger/service';
import { PgLedgerStore } from '../src/ledger/pg-store';
import { customerWallet, agentFloat, systemAccount } from '../src/ledger/operations';
import { toMinor } from '../src/money/money';

/**
 * Real-Postgres integration test for PgLedgerStore.
 *
 * Skipped unless RUN_PG_TESTS=1 and DATABASE_URL is set, so the normal suite stays
 * DB-free. To run:
 *   docker compose up -d db
 *   RUN_PG_TESTS=1 DATABASE_URL=postgres://ticash:ticash@localhost:5432/ticash npx vitest run test/pg-store.integration.spec.ts
 */
const RUN = process.env.RUN_PG_TESTS === '1' && !!process.env.DATABASE_URL;

describe.skipIf(!RUN)('PgLedgerStore (real Postgres)', () => {
  let pool: Pool;
  let svc: LedgerService;
  const brl = (v: string) => toMinor(v, 'BRL');

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const sql = readFileSync(join(__dirname, '..', 'db', 'migrations', '0001_init.sql'), 'utf8');
    await pool.query(sql);
    // Clean slate for a deterministic run.
    await pool.query('TRUNCATE postings, transactions, account_balances, accounts RESTART IDENTITY CASCADE');
    svc = new LedgerService(new PgLedgerStore(pool));
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('persists balanced journals and computes balances', async () => {
    await svc.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: brl('1240.00'), idempotencyKey: 'pg-fund' });
    await svc.floatTopup({ agentId: 'pedro', currency: 'BRL', amountMinor: brl('8450.00'), idempotencyKey: 'pg-float' });
    await svc.cashIn({ agentId: 'pedro', customerId: 'souza', currency: 'BRL', amountMinor: brl('250.00'), idempotencyKey: 'pg-ci' });

    expect(await svc.getBalance(customerWallet('jean', 'BRL'))).toBe(brl('1240.00'));
    expect(await svc.getBalance(agentFloat('pedro', 'BRL'))).toBe(brl('8200.00'));
    expect(await svc.getBalance(customerWallet('souza', 'BRL'))).toBe(brl('250.00'));
  });

  it('enforces idempotency at the database', async () => {
    const args = { customerId: 'dup', currency: 'BRL' as const, amountMinor: brl('100.00'), idempotencyKey: 'pg-dup' };
    const a = await svc.fundWallet(args);
    const b = await svc.fundWallet(args);
    expect(a.transactionUid).toBe(b.transactionUid);
    expect(await svc.getBalance(customerWallet('dup', 'BRL'))).toBe(brl('100.00'));
  });

  it('rejects overdraft', async () => {
    await expect(
      svc.cashOut({ agentId: 'pedro', customerId: 'empty', currency: 'BRL', amountMinor: brl('5.00'), idempotencyKey: 'pg-od' }),
    ).rejects.toThrow(/insufficient funds/i);
  });

  it('runs a cross-currency transfer and reconciles to zero', async () => {
    const { quote, correlationId } = await svc.initiateTransfer({
      senderId: 'jean', recipientRef: 'Marie/MonCash', fromCurrency: 'BRL', toCurrency: 'HTG',
      sendMinor: brl('500.00'), feeMinor: brl('12.50'), rate: '24.36', idempotencyKey: 'pg-xfer',
    });
    expect(quote.receiveMinor).toBe(toMinor('12180.00', 'HTG'));
    await svc.settlePayout({
      currency: 'HTG', amountMinor: quote.receiveMinor, correlationId,
      externalRef: 'moncash-pg', idempotencyKey: 'pg-payout',
    });
    expect(await svc.getBalance(systemAccount('payout_suspense', 'HTG'))).toBe(0n);

    const recon = await svc.reconcile();
    expect(recon.balanced).toBe(true);
    expect(recon.consistent).toBe(true);
  });

  it('database trigger rejects an unbalanced transaction (defense in depth)', async () => {
    // Bypass the service and try to write an unbalanced journal directly.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = await client.query(
        `INSERT INTO transactions (type, idempotency_key) VALUES ('cash_in','pg-bad') RETURNING id`,
      );
      const txId = tx.rows[0].id;
      const acc = await client.query(
        `INSERT INTO accounts (account_key, owner_type, owner_id, kind, currency, non_negative)
         VALUES ('system:_:fee_revenue:BRL','system',NULL,'fee_revenue','BRL',false)
         ON CONFLICT (account_key) DO UPDATE SET account_key = EXCLUDED.account_key RETURNING id`,
      );
      await client.query(
        `INSERT INTO postings (transaction_id, account_id, currency, amount_minor) VALUES ($1,$2,'BRL',100)`,
        [txId, acc.rows[0].id],
      );
      // Single +100 posting -> nets 100, not 0. COMMIT must fail (deferred trigger).
      await expect(client.query('COMMIT')).rejects.toThrow(/unbalanced/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
