import { describe, expect, it } from 'vitest';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { LedgerService } from '../src/ledger/service';
import { AccountSpec } from '../src/ledger/types';
import { applyBps, RateService } from '../src/fx/rate-service';
import { InMemoryRateStore } from '../src/fx/rate-store';
import { InMemoryTransferStore } from '../src/transfers/transfer-store';
import { TransferService } from '../src/transfers/transfer-service';
import { InMemoryPayoutStore } from '../src/payouts/payout-store';
import { PayoutService } from '../src/payouts/payout-service';
import { ProviderFeeReconciliation } from '../src/payouts/reconciliation';

const sys = (kind: string, ccy: any): AccountSpec => ({ ownerType: 'system', ownerId: null, kind: kind as any, currency: ccy });
const rateStore = () => new InMemoryRateStore({ marginBps: 200, platformFeeBps: 0, providerFeeBps: 335 });

describe('settlePayout — provider-fee split', () => {
  it('splits gross into net (settlement) + fee (provider_fee), stays balanced', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await ledger.settlePayout({ currency: 'HTG', amountMinor: 100000n, providerFeeMinor: 3350n, correlationId: 'c1', externalRef: 'x', idempotencyKey: 'k1' });
    expect(await ledger.getBalance(sys('settlement', 'HTG'))).toBe(96650n); // net to recipient
    expect(await ledger.getBalance(sys('provider_fee', 'HTG'))).toBe(3350n); // rail's cut
    expect(await ledger.getBalance(sys('payout_suspense', 'HTG'))).toBe(-100000n);
    expect((await ledger.reconcile()).balanced).toBe(true);
  });

  it('no fee -> a single settlement posting (back-compat)', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await ledger.settlePayout({ currency: 'HTG', amountMinor: 100000n, correlationId: 'c2', externalRef: 'x', idempotencyKey: 'k2' });
    expect(await ledger.getBalance(sys('settlement', 'HTG'))).toBe(100000n);
    expect(await ledger.getBalance(sys('provider_fee', 'HTG'))).toBe(0n);
  });

  it('rejects a fee greater than the payout (would imply a negative net)', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await expect(
      ledger.settlePayout({ currency: 'HTG', amountMinor: 100n, providerFeeMinor: 200n, correlationId: 'c3', externalRef: 'x', idempotencyKey: 'k3' }),
    ).rejects.toThrow(/out of range/);
  });

  it('idempotent settle does not double-count the provider fee', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    const args = { currency: 'HTG' as const, amountMinor: 100000n, providerFeeMinor: 3350n, correlationId: 'c4', externalRef: 'x', idempotencyKey: 'k4' };
    await ledger.settlePayout(args);
    await ledger.settlePayout(args); // replay
    expect(await ledger.getBalance(sys('provider_fee', 'HTG'))).toBe(3350n);
  });
});

describe('provider-fee reconciliation — end to end', () => {
  async function setup() {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await ledger.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: 1_000_000n, idempotencyKey: 'fund' });
    const payoutStore = new InMemoryPayoutStore();
    const payouts = new PayoutService(undefined, payoutStore, ledger); // manual rail
    const transfers = new TransferService(ledger, new InMemoryTransferStore(), payouts, new RateService(rateStore()));
    const recon = new ProviderFeeReconciliation(payoutStore, ledger);
    return { ledger, payoutStore, payouts, transfers, recon };
  }

  it('locks the corridor fee on the payout, splits it at settle, and reconciles', async () => {
    const { ledger, payoutStore, payouts, transfers, recon } = await setup();
    const r = await transfers.initiate({ senderId: 'jean', recipientRef: 'Marie / MonCash', fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 50000n, idempotencyKey: 'x1' });

    const p = (await payoutStore.list())[0]!;
    const gross = p.amountMinor;
    expect(gross).toBeGreaterThan(0n);
    expect(p.providerFeeMinor).toBe(applyBps(gross, 335)); // 3.35% LOCKED at creation

    await payouts.releaseManually(r.correlationId); // settle
    expect(await ledger.getBalance(sys('provider_fee', 'HTG'))).toBe(p.providerFeeMinor);
    expect(await ledger.getBalance(sys('settlement', 'HTG'))).toBe(gross - p.providerFeeMinor);
    expect((await ledger.reconcile()).balanced).toBe(true);

    const report = await recon.report();
    expect(report.consistent).toBe(true); // payout-sum == ledger provider_fee balance
    expect(report.byProvider[0]).toMatchObject({ provider: 'manual', currency: 'HTG', settledCount: 1, totalProviderFeeMinor: p.providerFeeMinor, totalGrossMinor: gross, totalNetToRecipientMinor: gross - p.providerFeeMinor });
  });

  it('matches our recorded fee against the rail statement and reports the delta', async () => {
    const { payouts, transfers, recon } = await setup();
    const r = await transfers.initiate({ senderId: 'jean', recipientRef: 'Marie', fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 50000n, idempotencyKey: 'x2' });
    await payouts.releaseManually(r.correlationId);
    const ours = (await recon.report()).byProvider[0]!.totalProviderFeeMinor;

    const exact = await recon.match('manual', 'HTG', ours);
    expect(exact).toMatchObject({ matches: true, deltaMinor: 0n, settledCount: 1 });

    const off = await recon.match('manual', 'HTG', ours - 100n);
    expect(off).toMatchObject({ matches: false, deltaMinor: 100n }); // we recorded 100 more than reported
  });
});
