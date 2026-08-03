import { describe, expect, it } from 'vitest';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { LedgerService, deriveUuid } from '../src/ledger/service';
import { quoteTransfer } from '../src/ledger/operations';
import { AccountSpec } from '../src/ledger/types';
import { InMemoryTransferStore } from '../src/transfers/transfer-store';
import { TransferService } from '../src/transfers/transfer-service';
import { InMemoryPayoutStore } from '../src/payouts/payout-store';
import { PayoutService } from '../src/payouts/payout-service';
import { PayoutPort } from '../src/payouts/types';
import { RateService } from '../src/fx/rate-service';
import { InMemoryRateStore } from '../src/fx/rate-store';
import { InMemorySettingsStore } from '../src/settings/settings-store';

/** A settings store with a rail's auto-disburse toggle ON. */
async function autoOn(rail: 'natcash' | 'moncash') {
  const s = new InMemorySettingsStore();
  await s.set(`payout.auto.${rail}`, '1');
  return s;
}

const sys = (kind: string, ccy: any): AccountSpec => ({ ownerType: 'system', ownerId: null, kind: kind as any, currency: ccy });
const wallet = (id: string, ccy: any): AccountSpec => ({ ownerType: 'customer', ownerId: id, kind: 'wallet', currency: ccy });
const ARGS = {
  senderId: 'jean', recipientRef: '50912345678', fromCurrency: 'BRL' as const, toCurrency: 'HTG' as const,
  sendMinor: 50000n, feeMinor: 1250n, rate: '24.36', idempotencyKey: 'xfer-1',
};
const QUOTE = quoteTransfer({ fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 50000n, feeMinor: 1250n, rate: '24.36' });

async function fundedLedger() {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  await ledger.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: 100000n, idempotencyKey: 'fund' });
  return ledger;
}

class FakePort implements PayoutPort {
  readonly name = 'moncash';
  async sendPayout() { return { providerRef: 'mc-1', raw: {} }; }
  async getStatus() { return { state: 'pending' as const, raw: {} }; }
}

// Like the real Natcash/BenCash rail: confirmed-at-send, so getStatus → success → settle.
// Counts sendPayout calls to catch a double-pay.
class SettlingPort implements PayoutPort {
  readonly name = 'natcash';
  sends = 0;
  async sendPayout() { this.sends++; return { providerRef: 'bc-' + this.sends, raw: {} }; }
  async getStatus() { return { state: 'success' as const, raw: {} }; }
}

describe('deriveUuid (correlation id)', () => {
  it('is deterministic, distinct per seed, and UUID-shaped', () => {
    expect(deriveUuid('xfer-1')).toBe(deriveUuid('xfer-1')); // stable for retries
    expect(deriveUuid('xfer-1')).not.toBe(deriveUuid('xfer-2'));
    expect(deriveUuid('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    // No collisions across many distinct seeds (SHA-256 backed).
    const ids = new Set(Array.from({ length: 5000 }, (_, i) => deriveUuid(`k-${i}`)));
    expect(ids.size).toBe(5000);
  });
});

describe('TransferService saga', () => {
  it('completes a transfer end-to-end and stays balanced', async () => {
    const ledger = await fundedLedger();
    const store = new InMemoryTransferStore();
    const r = await new TransferService(ledger, store).initiate(ARGS);

    expect(r.status).toBe('completed');
    expect(r.quote.receiveMinor).toBe(1218000n);
    expect(await ledger.getBalance(wallet('jean', 'BRL'))).toBe(48750n); // 1000 - (500 + 12.50)
    expect(await ledger.getBalance(sys('payout_suspense', 'HTG'))).toBe(1218000n);
    expect((await ledger.reconcile()).balanced).toBe(true);
    expect((await store.get(r.correlationId))!.status).toBe('completed');
  });

  it('AUTO-submits the payout when the rail toggle is ON', async () => {
    const ledger = await fundedLedger();
    const payoutStore = new InMemoryPayoutStore();
    const payouts = new PayoutService(new FakePort(), payoutStore, ledger);
    const svc = new TransferService(ledger, new InMemoryTransferStore(), payouts, undefined, await autoOn('natcash'));
    const r = await svc.initiate({ ...ARGS, payoutRail: 'natcash' });

    const payoutsList = await payoutStore.list();
    expect(payoutsList).toHaveLength(1);
    // auto-disbursed: created -> submitted (FakePort returns providerRef, then pending on sync)
    expect(payoutsList[0]).toMatchObject({ correlationId: r.correlationId, status: 'submitted', providerRef: 'mc-1', amountMinor: 1218000n });
  });

  it('leaves the payout `created` for MANUAL release when the rail toggle is OFF (default)', async () => {
    const ledger = await fundedLedger();
    const payoutStore = new InMemoryPayoutStore();
    const payouts = new PayoutService(new FakePort(), payoutStore, ledger);
    // no settings store -> auto is off -> payout must NOT be submitted (Jean's manual fallback)
    await new TransferService(ledger, new InMemoryTransferStore(), payouts).initiate({ ...ARGS, payoutRail: 'natcash' });
    expect((await payoutStore.list())[0]!.status).toBe('created');
  });

  it('EXECUTES a same-currency Haiti HTG->HTG transfer: rate 1, fees applied, ledger balanced, no minting', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await ledger.fundWallet({ customerId: 'ht', currency: 'HTG', amountMinor: 100000n, idempotencyKey: 'fund-htg' }); // 1000 HTG
    const rates = new RateService(new InMemoryRateStore({ marginBps: 200, platformFeeBps: 0, providerFeeBps: 335 }));
    await rates.setRate('HTG', 'HTG', '1', 0, 200, 500); // rate 1, 2% platform, 5% provider
    const store = new InMemoryTransferStore();
    const payoutStore = new InMemoryPayoutStore();
    const payouts = new PayoutService(new FakePort(), payoutStore, ledger);
    const svc = new TransferService(ledger, store, payouts, rates, await autoOn('natcash'));

    const r = await svc.initiate({
      senderId: 'ht', recipientRef: '50912345678', fromCurrency: 'HTG', toCurrency: 'HTG',
      payoutRail: 'natcash', sendMinor: 10000n, idempotencyKey: 'htg-dom-1', // send 100 HTG
    });

    expect(r.status).toBe('completed');            // the saga runs to completion for from===to
    expect(r.quote.rate).toBe('1');                // no FX
    expect(r.quote.receiveMinor).toBe(10000n);     // gross = send at rate 1 — NOT minted (e.g. not 250000)
    expect(await ledger.getBalance(wallet('ht', 'HTG'))).toBe(89800n); // 100000 - (10000 + 2% platform fee)
    expect((await ledger.reconcile()).balanced).toBe(true);           // <-- the real check: money is conserved
    const p = (await payoutStore.list())[0]!;
    expect(p.amountMinor).toBe(10000n);            // gross handed to the payout rail
    expect(p.providerFeeMinor).toBe(500n);         // 5% locked (the quote() fix) => recipient nets 9500
    expect(p.status).toBe('submitted');            // auto-disbursed (FakePort accepted, sync pending)
  });

  it('auto-disburse SETTLES to the ledger, stays balanced, and never double-pays on re-run', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await ledger.fundWallet({ customerId: 'ht', currency: 'HTG', amountMinor: 100000n, idempotencyKey: 'f' }); // 1000 HTG
    const rates = new RateService(new InMemoryRateStore({ marginBps: 200, platformFeeBps: 0, providerFeeBps: 335 }));
    await rates.setRate('HTG', 'HTG', '1', 0, 200, 500); // 2% platform, 5% provider
    const port = new SettlingPort();
    const payoutStore = new InMemoryPayoutStore();
    const payouts = new PayoutService(port, payoutStore, ledger);
    const svc = new TransferService(ledger, new InMemoryTransferStore(), payouts, rates, await autoOn('natcash'));

    const r = await svc.initiate({
      senderId: 'ht', recipientRef: '55342510', fromCurrency: 'HTG', toCurrency: 'HTG',
      payoutRail: 'natcash', sendMinor: 10000n, idempotencyKey: 'auto-1', // send 100 HTG
    });

    const p = (await payoutStore.list())[0]!;
    expect(p.status).toBe('settled');              // auto submitted + synced to settled (no manual step)
    expect(port.sends).toBe(1);                    // provider called EXACTLY once
    expect(await ledger.getBalance(wallet('ht', 'HTG'))).toBe(89800n);          // debited 100 + 2%
    expect(await ledger.getBalance(sys('payout_suspense', 'HTG'))).toBe(0n);    // drained by settle
    expect((await ledger.reconcile()).balanced).toBe(true);                     // money conserved after settle
    // crash-recovery / duplicate run must NOT double-pay or unbalance
    await svc.run(r.correlationId);
    expect(port.sends).toBe(1);
    expect((await ledger.reconcile()).balanced).toBe(true);
  });

  it('is idempotent: re-initiating with the same key never double-posts', async () => {
    const ledger = await fundedLedger();
    const svc = new TransferService(ledger, new InMemoryTransferStore());
    const a = await svc.initiate(ARGS);
    const b = await svc.initiate(ARGS);
    expect(b.correlationId).toBe(a.correlationId);
    expect(await ledger.getBalance(wallet('jean', 'BRL'))).toBe(48750n); // not 47500
  });

  it('resumes a transfer that crashed between the debit and fx legs', async () => {
    const ledger = await fundedLedger();
    const store = new InMemoryTransferStore();
    const svc = new TransferService(ledger, store);
    const correlationId = deriveUuid('xfer-resume');

    // Simulate a crash AFTER the debit leg posted + status advanced, BEFORE the fx leg.
    await store.create({
      correlationId, baseIdempotencyKey: 'xfer-resume', senderId: 'jean', recipientRef: '50912345678',
      recipientName: null, payoutRail: null,
      fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 50000n, feeMinor: 1250n, rate: '24.36', receiveMinor: 1218000n,
    });
    await ledger.postTransferDebit({ senderId: 'jean', quote: QUOTE, correlationId, recipientRef: '50912345678', idempotencyKey: 'xfer-resume:debit' });
    await store.setStatus(correlationId, 'debited');
    expect(await ledger.getBalance(sys('payout_suspense', 'HTG'))).toBe(0n); // fx leg not booked yet

    // Resume.
    const rec = await svc.run(correlationId);
    expect(rec.status).toBe('completed');
    expect(await ledger.getBalance(wallet('jean', 'BRL'))).toBe(48750n); // debit not duplicated
    expect(await ledger.getBalance(sys('payout_suspense', 'HTG'))).toBe(1218000n); // fx now booked
    expect((await ledger.reconcile()).balanced).toBe(true);

    // Running again is a no-op.
    await svc.run(correlationId);
    expect(await ledger.getBalance(sys('payout_suspense', 'HTG'))).toBe(1218000n);
  });

  it('recover() isolates a failing transfer and still completes the others', async () => {
    const ledger = await fundedLedger(); // funds 'jean' only
    const store = new InMemoryTransferStore();
    const svc = new TransferService(ledger, store);
    const good = deriveUuid('good');
    const bad = deriveUuid('bad');
    const base = { recipientRef: '50912345678', recipientName: null, payoutRail: null, fromCurrency: 'BRL' as const, toCurrency: 'HTG' as const, sendMinor: 50000n, feeMinor: 1250n, rate: '24.36', receiveMinor: 1218000n };
    await store.create({ correlationId: good, baseIdempotencyKey: 'good', senderId: 'jean', ...base });
    await store.create({ correlationId: bad, baseIdempotencyKey: 'bad', senderId: 'broke', ...base }); // no funds -> debit throws

    const resumed = await svc.recover(); // must not throw
    expect(resumed).toBe(1);
    expect((await store.get(good))!.status).toBe('completed');
    expect((await store.get(bad))!.status).toBe('pending'); // left for next sweep
    expect((await ledger.reconcile()).balanced).toBe(true);
  });

  it('recover() drives every incomplete transfer to completion', async () => {
    const ledger = await fundedLedger();
    const store = new InMemoryTransferStore();
    const svc = new TransferService(ledger, store);
    const correlationId = deriveUuid('xfer-stuck');
    await store.create({
      correlationId, baseIdempotencyKey: 'xfer-stuck', senderId: 'jean', recipientRef: '50912345678',
      recipientName: null, payoutRail: null,
      fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 50000n, feeMinor: 1250n, rate: '24.36', receiveMinor: 1218000n,
    });

    const n = await svc.recover();
    expect(n).toBe(1);
    expect((await store.get(correlationId))!.status).toBe('completed');
    expect((await ledger.reconcile()).balanced).toBe(true);
    expect(await svc.recover()).toBe(0); // nothing left incomplete
  });
});
