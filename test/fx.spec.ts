import { describe, expect, it } from 'vitest';
import { marginedRate, RateService } from '../src/fx/rate-service';
import { InMemoryRateStore } from '../src/fx/rate-store';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { LedgerService } from '../src/ledger/service';
import { AccountSpec } from '../src/ledger/types';
import { InMemoryTransferStore } from '../src/transfers/transfer-store';
import { TransferService } from '../src/transfers/transfer-service';

describe('marginedRate (exact decimal margin)', () => {
  it('moves the mid against the customer by the margin', () => {
    expect(marginedRate('24.36', 200)).toBe('23.8728'); // 2% spread
    expect(marginedRate('24.36', 0)).toBe('24.36'); // no margin
    expect(marginedRate('100', 100)).toBe('99'); // 1% of 100
    expect(marginedRate('1', 5000)).toBe('0.5'); // 50%
    expect(marginedRate('24.36', 250)).toBe('23.751'); // 24.36*0.975
  });
  it('rejects an invalid margin', () => {
    expect(() => marginedRate('10', -1)).toThrow();
    expect(() => marginedRate('10', 10000)).toThrow();
    expect(() => marginedRate('abc', 100)).toThrow();
  });
});

describe('RateService', () => {
  const svc = () => new RateService(new InMemoryRateStore(200));

  it('prices a configured pair (mid + margin -> customer rate)', async () => {
    const q = await svc().quote('BRL', 'HTG');
    expect(q).toMatchObject({ midRate: '24.36', marginBps: 200, rate: '23.8728' });
  });
  it('identity pair is 1:1', async () => {
    expect((await svc().quote('BRL', 'BRL')).rate).toBe('1');
  });
  it('throws for an unconfigured pair', async () => {
    await expect(svc().quote('HTG', 'BRL')).rejects.toThrow(/no FX rate/i);
  });
  it('setRate updates the priced rate', async () => {
    const s = svc();
    await s.setRate('BRL', 'HTG', '25.00', 100);
    expect((await s.quote('BRL', 'HTG')).rate).toBe('24.75'); // 25 * 0.99
  });
});

describe('transfer locks the FX-service rate when none is supplied', () => {
  const sys = (kind: string, ccy: any): AccountSpec => ({ ownerType: 'system', ownerId: null, kind: kind as any, currency: ccy });
  it('uses mid+margin and records the locked rate', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await ledger.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: 100000n, idempotencyKey: 'f' });
    const store = new InMemoryTransferStore();
    const svc = new TransferService(ledger, store, undefined, new RateService(new InMemoryRateStore(200)));

    const r = await svc.initiate({ senderId: 'jean', recipientRef: '509', fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 10000n, feeMinor: 0n, idempotencyKey: 'x1' });
    expect(r.quote.rate).toBe('23.8728'); // priced from the service, not supplied
    // 100.00 BRL * 23.8728 = 2387.28 HTG -> 238728 minor, parked in payout_suspense
    expect(await ledger.getBalance(sys('payout_suspense', 'HTG'))).toBe(238728n);
    expect((await store.get(r.correlationId))!.rate).toBe('23.8728'); // locked on the record
  });
});

describe('FX HTTP endpoints', () => {
  function app() {
    const store = new InMemoryRateStore(200);
    return buildServer({ ledger: new LedgerService(new InMemoryLedgerStore()), registry: new InMemoryRegistryStore(), fx: { service: new RateService(store), store } });
  }
  const inj = (o: object) => app().inject(o as never) as any;

  it('GET /fx/quote prices a pair and converts an amount', async () => {
    const r = await inj({ method: 'GET', url: '/fx/quote?from=BRL&to=HTG&amount=100.00' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ rate: '23.8728', sendMinor: '10000', receiveMinor: '238728' });
  });
  it('GET /fx/rates lists configured rates; POST sets one', async () => {
    const a = app();
    const list = (await (a.inject({ method: 'GET', url: '/fx/rates' } as never) as any)).json();
    expect(list.length).toBeGreaterThan(0);
    const set = await (a.inject({ method: 'POST', url: '/fx/rates', payload: { from: 'USD', to: 'HTG', midRate: '133.00', marginBps: 150 } } as never) as any);
    expect(set.statusCode).toBe(201);
    expect(set.json()).toMatchObject({ fromCurrency: 'USD', toCurrency: 'HTG', midRate: '133.00', marginBps: 150 });
  });
});
