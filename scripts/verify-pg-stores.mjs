// One-off: exercise the Phase-2 PG stores against a REAL Postgres (remote, SSL).
// Proves the SQL (CHAR(4) trim, bigint round-trip, JSONB reversal, ON CONFLICT
// idempotency, dynamic UPDATE) — the in-memory tests can't. Run:
//   DATABASE_URL=... node scripts/verify-pg-stores.mjs
import pg from 'pg';
import { PgPaymentIntentStore } from '../dist/payments/pg-intent-store.js';
import { PgProviderEventStore } from '../dist/payments/event-store.js';
import { PgPayoutStore } from '../dist/payouts/pg-payout-store.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ID = 'verify-' + Date.now();
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : ' FAIL ') + msg); if (!cond) failures++; };

try {
  const intents = new PgPaymentIntentStore(pool);
  const events = new PgProviderEventStore(pool);
  const payouts = new PgPayoutStore(pool);

  // --- payment intents ---
  const i1 = await intents.create({ provider: 'lytex', providerId: ID, customerId: 'verify-cust', currency: 'BRL', amountMinor: 12345n, reference: 'ref-' + ID });
  ok(i1.status === 'pending', 'intent created pending');
  ok(i1.amountMinor === 12345n && typeof i1.amountMinor === 'bigint', 'intent amount bigint round-trip = 12345n');
  ok(i1.currency === 'BRL', 'intent currency trimmed to BRL (CHAR(4))');
  const i2 = await intents.create({ provider: 'lytex', providerId: ID, customerId: 'x', currency: 'BRL', amountMinor: 999n, reference: 'dup' });
  ok(i2.amountMinor === 12345n, 'intent create is idempotent on provider_id (no overwrite)');
  await intents.markPaid(ID);
  ok((await intents.get(ID)).status === 'paid', 'intent markPaid -> paid');

  // --- provider events (edge idempotency) ---
  ok((await events.seen('lytex', 'ev-' + ID)) === false, 'event not seen initially');
  await events.record('lytex', 'ev-' + ID, 'invoice.liquidated', { a: 1 });
  ok((await events.seen('lytex', 'ev-' + ID)) === true, 'event seen after record');
  await events.record('lytex', 'ev-' + ID, 'invoice.liquidated', { a: 2 }); // ON CONFLICT DO NOTHING
  ok((await events.seen('lytex', 'ev-' + ID)) === true, 'event record is idempotent (no throw)');

  // --- payouts (state machine + JSONB reversal) ---
  const reversal = { senderId: 'jean', fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 50000n, feeMinor: 1250n, receiveMinor: 1218000n, rate: '24.36' };
  const p1 = await payouts.create({ correlationId: ID, provider: 'moncash', recipientRef: '50912345678', currency: 'HTG', amountMinor: 1218000n, reversal });
  ok(p1.status === 'created' && p1.providerRef === null, 'payout created');
  const p2 = await payouts.update(ID, { status: 'submitted', providerRef: 'mc-' + ID, attempts: 1 });
  ok(p2.status === 'submitted' && p2.providerRef === 'mc-' + ID && p2.attempts === 1, 'payout update -> submitted');
  const p3 = await payouts.get(ID);
  ok(p3.reversal.sendMinor === 50000n && p3.reversal.receiveMinor === 1218000n, 'reversal bigints round-trip via JSONB');
  ok(p3.currency === 'HTG', 'payout currency trimmed to HTG');
  await payouts.update(ID, { status: 'settled' });
  ok((await payouts.get(ID)).status === 'settled', 'payout update -> settled');
  const pc = await payouts.create({ correlationId: ID, provider: 'moncash', recipientRef: 'x', currency: 'HTG', amountMinor: 1n, reversal });
  ok(pc.status === 'settled', 'payout create idempotent on correlation_id');
} finally {
  // cleanup test rows (these tables are separate from the ledger)
  await pool.query('DELETE FROM payment_intents WHERE provider_id = $1', [ID]);
  await pool.query('DELETE FROM provider_events WHERE event_uid = $1', ['ev-' + ID]);
  await pool.query('DELETE FROM payouts WHERE correlation_id = $1', [ID]);
  await pool.end();
}
console.log(failures === 0 ? '\nALL PG STORE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
