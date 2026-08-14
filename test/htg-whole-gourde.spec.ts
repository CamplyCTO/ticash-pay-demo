import { describe, expect, it } from 'vitest';
import { payoutMinorStep } from '../src/money/currency';
import { floorToPayoutUnit } from '../src/money/money';
import { quoteTransfer } from '../src/ledger/operations';
import { LedgerService } from '../src/ledger/service';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRateStore } from '../src/fx/rate-store';
import { RateService } from '../src/fx/rate-service';
import { InMemoryTransferStore } from '../src/transfers/transfer-store';
import { TransferService, autoDisburseKey } from '../src/transfers/transfer-service';
import { PayoutService } from '../src/payouts/payout-service';
import { InMemoryPayoutStore } from '../src/payouts/payout-store';
import { InMemorySettingsStore } from '../src/settings/settings-store';
import { PayoutPort, PayoutRequest, PayoutStatusResult, PayoutSubmitResult } from '../src/payouts/types';

/**
 * REGRESSION: Haiti mobile-money rails (NatCash via BenCash, MonCash) accept ONLY whole
 * gourdes; a fractional HTG amount is rejected (BenCash returned a misleading error and
 * real decimal payouts got stuck, Aug 2026). Every HTG payout must be a whole gourde, and
 * the ledger must stay balanced (the <1-gourde remainder becomes platform FX margin).
 */
describe('HTG payouts are whole gourdes (BenCash rejects cents)', () => {
  it('floorToPayoutUnit floors HTG to whole gourdes, leaves other currencies at full precision', () => {
    expect(payoutMinorStep('HTG')).toBe(100n); // 1 gourde = 100 minor
    expect(payoutMinorStep('BRL')).toBe(1n);
    expect(payoutMinorStep('USDT')).toBe(1n);

    expect(floorToPayoutUnit(238728n, 'HTG')).toBe(238700n); // 2387.28 -> 2387.00
    expect(floorToPayoutUnit(4872n, 'HTG')).toBe(4800n); // 48.72 -> 48.00
    expect(floorToPayoutUnit(10000n, 'HTG')).toBe(10000n); // already whole (100.00)
    expect(floorToPayoutUnit(99n, 'HTG')).toBe(0n); // 0.99 -> 0.00 (floors toward zero)
    expect(floorToPayoutUnit(238728n, 'BRL')).toBe(238728n); // untouched
  });

  it('quoteTransfer floors the HTG recipient amount to a whole gourde', () => {
    const q = quoteTransfer({ fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 10000n, feeMinor: 0n, rate: '23.8728' });
    expect(q.receiveMinor).toBe(238700n); // 2387.28 -> 2387.00
    expect(q.receiveMinor % 100n).toBe(0n); // whole gourdes
  });

  it('quoteTransfer does NOT round a non-HTG destination', () => {
    const q = quoteTransfer({ fromCurrency: 'BRL', toCurrency: 'USD', sendMinor: 10000n, feeMinor: 0n, rate: '0.1817' });
    expect(q.receiveMinor).toBe(1817n); // 18.17 USD — cents preserved
  });

  it('end-to-end: the exact amount sent to the NatCash rail is a whole gourde, and Σ=0', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await ledger.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: 100000n, idempotencyKey: 'f' });

    const rateStore = new InMemoryRateStore({ marginBps: 200, platformFeeBps: 0, providerFeeBps: 335 });
    const rates = new RateService(rateStore);

    // A fake NatCash port that RECORDS the exact amount it is asked to send.
    let sentMinor: bigint | null = null;
    const port: PayoutPort = {
      name: 'natcash',
      async sendPayout(req: PayoutRequest): Promise<PayoutSubmitResult> {
        sentMinor = req.amountMinor;
        return { providerRef: 'ref-1', raw: {} };
      },
      async getStatus(): Promise<PayoutStatusResult> {
        return { state: 'success', raw: {} };
      },
    };
    const payouts = new PayoutService(port, new InMemoryPayoutStore(), ledger);
    const settings = new InMemorySettingsStore();
    await settings.set(autoDisburseKey('natcash'), '1'); // auto-disburse ON for natcash

    const svc = new TransferService(ledger, new InMemoryTransferStore(), payouts, rates, settings);
    const r = await svc.initiate({
      senderId: 'jean',
      recipientRef: '50935434168',
      payoutRail: 'natcash',
      fromCurrency: 'BRL',
      toCurrency: 'HTG',
      sendMinor: 10000n, // R$100 -> 2387.28 HTG at 23.8728, must floor to 2387.00
      idempotencyKey: 'x1',
    });

    // The amount that actually reached the rail is a whole gourde (no cents).
    expect(sentMinor).toBe(238700n);
    expect(sentMinor! % 100n).toBe(0n);
    // The persisted payout matches, and it settled.
    const payout = (await payouts.list()).find((p) => p.correlationId === r.correlationId)!;
    expect(payout.amountMinor).toBe(238700n);
    expect(payout.status).toBe('settled');

    // Ledger reconciles: every currency sums to zero across all accounts.
    const recon = await ledger.reconcile();
    expect(recon.balanced).toBe(true);
  });
});
