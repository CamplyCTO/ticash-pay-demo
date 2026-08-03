import { describe, expect, it } from 'vitest';
import { applyBps, marginedRate, RateService } from '../src/fx/rate-service';
import { InMemoryRateStore } from '../src/fx/rate-store';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { LedgerService } from '../src/ledger/service';
import { AccountSpec } from '../src/ledger/types';
import { InMemoryTransferStore } from '../src/transfers/transfer-store';
import { TransferService } from '../src/transfers/transfer-service';

const sys = (kind: string, ccy: any): AccountSpec => ({ ownerType: 'system', ownerId: null, kind: kind as any, currency: ccy });
const wallet = (id: string, ccy: any): AccountSpec => ({ ownerType: 'customer', ownerId: id, kind: 'wallet', currency: ccy });
// default store: margin 200bps, platform fee 0, provider fee 335bps (BenCash 3.35%)
const store = (over = {}) => new InMemoryRateStore({ marginBps: 200, platformFeeBps: 0, providerFeeBps: 335, ...over });

describe('marginedRate + applyBps (exact decimal/bps math)', () => {
  it('margins the rate against the customer', () => {
    expect(marginedRate('24.36', 200)).toBe('23.8728');
    expect(marginedRate('24.36', 0)).toBe('24.36');
    expect(marginedRate('100', 100)).toBe('99');
    expect(marginedRate('1', 5000)).toBe('0.5');
  });
  it('applyBps rounds half-up exactly', () => {
    expect(applyBps(10000n, 335)).toBe(335n);
    expect(applyBps(238728n, 335)).toBe(7997n); // 7997.388 -> 7997
    expect(applyBps(12345n, 0)).toBe(0n);
  });
  it('rejects out-of-range bps', () => {
    expect(() => marginedRate('10', 10000)).toThrow();
    expect(() => applyBps(1n, -1)).toThrow();
  });
});

describe('RateService.priceTransfer — full economics', () => {
  it('breaks down send/payout/provider-fee/net/profit (loss when margin < provider fee)', async () => {
    const p = await new RateService(store()).priceTransfer('BRL', 'HTG', 10000n); // R$100, margin 2%, provider 3.35%
    expect(p.rate).toBe('23.8728');
    expect(p.grossPayoutMinor).toBe(238728n); // 2387.28 HTG at customer rate
    expect(p.providerFeeMinor).toBe(7997n); // 3.35% of gross
    expect(p.netToRecipientMinor).toBe(230731n); // recipient gets this
    expect(p.fxMarginMinor).toBe(4872n); // platform FX revenue (2% of 2436)
    expect(p.platformNetProfitMinor).toBe(-3125n); // LOSS: 2% margin < 3.35% provider fee
  });

  it('shows a profit once margin/fee exceed the provider fee', async () => {
    const s = store();
    await new RateService(s).setRate('BRL', 'HTG', '24.36', 700, 50, 335); // 7% margin + 0.5% fee
    const p = await new RateService(s).priceTransfer('BRL', 'HTG', 10000n);
    expect(p.platformNetProfitMinor).toBeGreaterThan(0n);
    expect(p.platformFeeMinor).toBe(50n); // 0.5% of R$100 = R$0.50
  });

  it('prices same-currency (domestic HTG->HTG) at rate 1 + fees — a bogus X->X midRate cannot mint', async () => {
    const s = store();
    const rates = new RateService(s);
    await rates.setRate('HTG', 'HTG', '25', 300, 200, 500); // bogus midRate 25 + 2% platform, 5% provider
    const p = await rates.priceTransfer('HTG', 'HTG', 10000n); // send 100 HTG
    expect(p.rate).toBe('1'); // forced identity — NOT 25, so no minting
    expect(p.grossPayoutMinor).toBe(10000n); // rate 1 (not 250000)
    expect(p.platformFeeMinor).toBe(200n); // 2% of 100
    expect(p.providerFeeMinor).toBe(500n); // 5% of 100
    expect(p.netToRecipientMinor).toBe(9500n); // 100 - 5% provider fee
    expect(p.totalDebitMinor).toBe(10200n); // 100 + 2% platform fee
  });

  it('quote() same-currency exposes the row fees so the payout deducts the SAME provider fee', async () => {
    const s = store();
    const rates = new RateService(s);
    await rates.setRate('HTG', 'HTG', '1', 0, 200, 500);
    const q = await rates.quote('HTG', 'HTG');
    expect(q.rate).toBe('1');
    expect(q.platformFeeBps).toBe(200);
    expect(q.providerFeeBps).toBe(500); // NOT 0 — must match priceTransfer, else recipient gets gross
  });
});

describe('RateService.quote', () => {
  it('includes margin + fee knobs and the priced rate', async () => {
    const q = await new RateService(store()).quote('BRL', 'HTG');
    expect(q).toMatchObject({ midRate: '24.36', marginBps: 200, platformFeeBps: 0, providerFeeBps: 335, rate: '23.8728' });
  });
  it('throws for an unconfigured pair', async () => {
    await expect(new RateService(store()).quote('HTG', 'BRL')).rejects.toThrow(/no FX rate/i);
  });
});

describe('transfer applies the corridor rate + platform fee automatically', () => {
  it('uses the configured margin + fee when caller omits rate/fee', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await ledger.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: 100000n, idempotencyKey: 'f' });
    const s = store();
    await new RateService(s).setRate('BRL', 'HTG', '24.36', 200, 100, 335); // 1% platform fee
    const tstore = new InMemoryTransferStore();
    const svc = new TransferService(ledger, tstore, undefined, new RateService(s));

    const r = await svc.initiate({ senderId: 'jean', recipientRef: '509', fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 10000n, idempotencyKey: 'x1' });
    expect(r.quote.rate).toBe('23.8728');
    expect((await tstore.get(r.correlationId))!.feeMinor).toBe(100n); // 1% of R$100 = R$1.00, from config
    // sender debited send (100) + fee (1) = 101; fee_revenue gets 1.00
    expect(await ledger.getBalance(wallet('jean', 'BRL'))).toBe(89900n);
    expect(await ledger.getBalance(sys('fee_revenue', 'BRL'))).toBe(100n);
  });

  it('a duplicate initiate keeps the locked rate even if the live rate changed', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await ledger.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: 100000n, idempotencyKey: 'f' });
    const rates = new RateService(store());
    const svc = new TransferService(ledger, new InMemoryTransferStore(), undefined, rates);
    const args = { senderId: 'jean', recipientRef: '509', fromCurrency: 'BRL' as const, toCurrency: 'HTG' as const, sendMinor: 10000n, feeMinor: 0n, idempotencyKey: 'dup' };
    const r1 = await svc.initiate(args);
    await rates.setRate('BRL', 'HTG', '30.00', 0, 0, 335);
    const r2 = await svc.initiate(args);
    expect(r2.correlationId).toBe(r1.correlationId);
    expect(r2.quote.rate).toBe('23.8728'); // locked, not 30.00
  });
});

describe('FX HTTP endpoints', () => {
  function app() {
    const s = store();
    return buildServer({ ledger: new LedgerService(new InMemoryLedgerStore()), registry: new InMemoryRegistryStore(), fx: { service: new RateService(s), store: s } });
  }

  it('GET /fx/quote?amount returns the full economic breakdown', async () => {
    const r = await (app().inject({ method: 'GET', url: '/fx/quote?from=BRL&to=HTG&amount=100.00' } as never) as any);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ rate: '23.8728', grossPayoutMinor: '238728', providerFeeMinor: '7997', netToRecipientMinor: '230731', platformNetProfitMinor: '-3125' });
  });

  it('POST /fx/rates sets margin + fees', async () => {
    const set = await (app().inject({ method: 'POST', url: '/fx/rates', payload: { from: 'BRL', to: 'HTG', midRate: '25.00', marginBps: 600, platformFeeBps: 100, providerFeeBps: 335 } } as never) as any);
    expect(set.statusCode).toBe(201);
    expect(set.json()).toMatchObject({ marginBps: 600, platformFeeBps: 100, providerFeeBps: 335 });
  });
});
