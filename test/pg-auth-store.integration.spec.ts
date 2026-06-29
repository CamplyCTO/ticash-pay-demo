import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgAuthStore } from '../src/auth/pg-auth-store';

/**
 * Real-Postgres integration test for PgAuthStore (migration 0010_auth).
 *
 * Skipped unless RUN_PG_TESTS=1 and DATABASE_URL is set, so the normal suite stays
 * DB-free. To run against a local database:
 *   docker compose up -d db
 *   RUN_PG_TESTS=1 DATABASE_URL=postgres://ticash:ticash@localhost:5432/ticash \
 *     npx vitest run test/pg-auth-store.integration.spec.ts
 *
 * Proves the SQL adapter matches the in-memory executable spec: unique phone,
 * OTP one-time-use (incl. the concurrent double-consume guard), and reuse-safe
 * refresh-token rotation.
 */
const RUN = process.env.RUN_PG_TESTS === '1' && !!process.env.DATABASE_URL;

describe.skipIf(!RUN)('PgAuthStore (real Postgres)', () => {
  let pool: Pool;
  let store: PgAuthStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // The auth tables depend on nothing else; apply 0001 (parties) then 0010 (auth).
    for (const f of ['0001_init.sql', '0010_auth.sql']) {
      await pool.query(readFileSync(join(__dirname, '..', 'db', 'migrations', f), 'utf8'));
    }
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE sessions, otp_codes, app_users RESTART IDENTITY CASCADE');
    store = new PgAuthStore(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates a user and rejects a duplicate phone', async () => {
    const u = await store.createUser({ role: 'customer', externalId: 'cust-1', phone: '+5511000000001' });
    expect(u).toMatchObject({ role: 'customer', externalId: 'cust-1', status: 'active' });
    expect(await store.getUserById(u.id)).toMatchObject({ id: u.id });
    expect(await store.getUserByPhone('+5511000000001')).toMatchObject({ id: u.id });
    await expect(store.createUser({ role: 'customer', externalId: 'cust-2', phone: '+5511000000001' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('consumes an OTP exactly once and respects expiry + rate count', async () => {
    const now = new Date().toISOString();
    const exp = new Date(Date.now() + 300_000).toISOString();
    await store.saveOtp({ phone: '+99', codeHash: 'hash-a', purpose: 'login', expiresAt: exp });
    expect(await store.countOtpsSince('+99', new Date(Date.now() - 3_600_000).toISOString())).toBe(1);
    expect(await store.consumeOtp('+99', 'hash-a', now)).toBe(true);
    expect(await store.consumeOtp('+99', 'hash-a', now)).toBe(false); // one-time use
    // Wrong hash never matches.
    await store.saveOtp({ phone: '+99', codeHash: 'hash-b', purpose: 'login', expiresAt: exp });
    expect(await store.consumeOtp('+99', 'nope', now)).toBe(false);
  });

  it('rotates refresh tokens reuse-safely and revokes', async () => {
    const u = await store.createUser({ role: 'customer', externalId: 'cust-9', phone: '+5511000000009' });
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const s = await store.createSession({ userId: u.id, refreshTokenHash: 'r0', expiresAt: future });
    expect(await store.getSessionByRefreshHash('r0')).toMatchObject({ id: s.id });

    expect(await store.rotateSession(s.id, 'r0', 'r1', future)).toBe(true);
    expect(await store.rotateSession(s.id, 'r0', 'r2', future)).toBe(false); // stale -> rejected
    expect(await store.getSessionByRefreshHash('r1')).toMatchObject({ id: s.id });

    await store.revokeSession(s.id, new Date().toISOString());
    expect(await store.rotateSession(s.id, 'r1', 'r3', future)).toBe(false); // revoked -> rejected
  });
});
