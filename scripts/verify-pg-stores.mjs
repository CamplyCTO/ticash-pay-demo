// One-off: exercise the Phase-2 PG stores against a REAL Postgres (remote, SSL).
// Proves the SQL (CHAR(4) trim, bigint round-trip, JSONB reversal, ON CONFLICT
// idempotency, dynamic UPDATE) — the in-memory tests can't. Run:
//   DATABASE_URL=... node scripts/verify-pg-stores.mjs
import pg from 'pg';
import { PgPaymentIntentStore } from '../dist/payments/pg-intent-store.js';
import { PgProviderEventStore } from '../dist/payments/event-store.js';
import { PgPayoutStore } from '../dist/payouts/pg-payout-store.js';
import { PgTransferStore } from '../dist/transfers/pg-transfer-store.js';
import { PgRateStore } from '../dist/fx/pg-rate-store.js';
import { PgScreeningStore } from '../dist/screening/pg-hit-store.js';

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
  const p1 = await payouts.create({ correlationId: ID, provider: 'moncash', recipientRef: '50912345678', currency: 'HTG', amountMinor: 1218000n, providerFeeMinor: 40803n, reversal });
  ok(p1.status === 'created' && p1.providerRef === null, 'payout created');
  ok(p1.providerFeeMinor === 40803n, 'payout provider_fee_minor persisted (migration 0008)');
  const p2 = await payouts.update(ID, { status: 'submitted', providerRef: 'mc-' + ID, attempts: 1 });
  ok(p2.status === 'submitted' && p2.providerRef === 'mc-' + ID && p2.attempts === 1, 'payout update -> submitted');
  const p3 = await payouts.get(ID);
  ok(p3.reversal.sendMinor === 50000n && p3.reversal.receiveMinor === 1218000n, 'reversal bigints round-trip via JSONB');
  ok(p3.currency === 'HTG', 'payout currency trimmed to HTG');
  await payouts.update(ID, { status: 'settled' });
  ok((await payouts.get(ID)).status === 'settled', 'payout update -> settled');
  const pc = await payouts.create({ correlationId: ID, provider: 'moncash', recipientRef: 'x', currency: 'HTG', amountMinor: 1n, reversal });
  ok(pc.status === 'settled', 'payout create idempotent on correlation_id');

  // --- transfers (saga log) ---
  const transfers = new PgTransferStore(pool);
  const t1 = await transfers.create({ correlationId: ID, baseIdempotencyKey: 'base-' + ID, senderId: 'jean', recipientRef: '50912345678', fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 50000n, feeMinor: 1250n, rate: '24.36', receiveMinor: 1218000n });
  ok(t1.status === 'pending' && t1.sendMinor === 50000n && t1.receiveMinor === 1218000n, 'transfer created pending, bigints round-trip');
  ok(t1.fromCurrency === 'BRL' && t1.toCurrency === 'HTG', 'transfer currencies trimmed');
  await transfers.setStatus(ID, 'debited');
  ok((await transfers.listIncomplete()).some((t) => t.correlationId === ID), 'incomplete list includes debited transfer');
  await transfers.setStatus(ID, 'completed');
  ok(!(await transfers.listIncomplete()).some((t) => t.correlationId === ID), 'completed transfer drops out of incomplete list');
  const tc = await transfers.create({ correlationId: ID, baseIdempotencyKey: 'x', senderId: 'x', recipientRef: 'x', fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 1n, feeMinor: 0n, rate: '1', receiveMinor: 1n });
  ok(tc.status === 'completed', 'transfer create idempotent on correlation_id');

  // --- fx rates (with WS-7 fee knobs) ---
  const rates = new PgRateStore(pool);
  const f1 = await rates.set({ fromCurrency: 'MXN', toCurrency: 'USD', midRate: '0.058', marginBps: 100, platformFeeBps: 50, providerFeeBps: 200, source: 'manual' });
  ok(f1.midRate === '0.058' && f1.marginBps === 100 && f1.platformFeeBps === 50 && f1.providerFeeBps === 200 && f1.fromCurrency === 'MXN', 'fx rate set with margin + fees');
  const f2 = await rates.get('MXN', 'USD');
  ok(f2 && f2.toCurrency === 'USD' && f2.platformFeeBps === 50, 'fx rate get (currencies trimmed, fees)');
  const f3 = await rates.set({ fromCurrency: 'MXN', toCurrency: 'USD', midRate: '0.060', marginBps: 50, platformFeeBps: 75, providerFeeBps: 335, source: 'manual' });
  ok(f3.marginBps === 50 && f3.platformFeeBps === 75 && f3.providerFeeBps === 335, 'fx rate upsert (margin + fees)');

  // --- sanctions hits ---
  const screening = new PgScreeningStore(pool);
  await screening.record({ subject: 'verify-' + ID, context: 'manual', list: 'TEST', matchedName: 'Blocked Testperson', score: 1 });
  const hits = await screening.list(50);
  const mine = hits.find((h) => h.subject === 'verify-' + ID);
  ok(mine && mine.list === 'TEST' && mine.score === 1 && mine.context === 'manual', 'sanctions hit recorded + listed');
} finally {
  // cleanup test rows (these tables are separate from the ledger)
  await pool.query('DELETE FROM payment_intents WHERE provider_id = $1', [ID]);
  await pool.query('DELETE FROM provider_events WHERE event_uid = $1', ['ev-' + ID]);
  await pool.query('DELETE FROM payouts WHERE correlation_id = $1', [ID]);
  await pool.query('DELETE FROM transfers WHERE correlation_id = $1', [ID]);
  await pool.query("DELETE FROM fx_rates WHERE from_currency = 'MXN ' AND to_currency = 'USD '");
  await pool.query('DELETE FROM sanctions_hits WHERE subject = $1', ['verify-' + ID]);
  await pool.end();
}
console.log(failures === 0 ? '\nALL PG STORE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
