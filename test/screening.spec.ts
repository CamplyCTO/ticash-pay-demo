import { describe, expect, it } from 'vitest';
import { normalize, nameScore, screenName } from '../src/screening/matcher';
import { DEFAULT_SANCTIONS, parseSimpleList } from '../src/screening/sanctions-list';
import { ScreeningService } from '../src/screening/screening-service';
import { InMemoryScreeningStore } from '../src/screening/hit-store';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryPaymentIntentStore } from '../src/payments/intent-store';
import { InMemoryProviderEventStore } from '../src/payments/event-store';
import { LedgerService } from '../src/ledger/service';

describe('sanctions matcher', () => {
  it('normalises names (diacritics, punctuation, case)', () => {
    expect(normalize("José  O'Brien-Smith")).toEqual(['jose', 'o', 'brien', 'smith']);
    expect(normalize('  MADURO,  Nicolás ')).toEqual(['maduro', 'nicolas']);
  });

  it('scores exact / contained / partial matches', () => {
    expect(nameScore(normalize('Nicolas Maduro'), 'Maduro Nicolas')).toBe(1); // order-independent
    expect(nameScore(normalize('Mr Osama Bin Laden Jr'), 'Osama Bin Laden')).toBe(0.95); // contains full name
    expect(nameScore(normalize('Jean Wilson Loute'), 'Osama Bin Laden')).toBe(0); // unrelated
  });

  it('flags sanctioned names (incl. aliases) and clears normal ones', () => {
    expect(screenName('Osama Bin Laden', DEFAULT_SANCTIONS, 0.85).length).toBeGreaterThan(0); // via alias
    expect(screenName('Blocked Testperson', DEFAULT_SANCTIONS, 0.85)[0]).toMatchObject({ list: 'TEST', score: 1 });
    expect(screenName('Maria da Silva', DEFAULT_SANCTIONS, 0.85)).toHaveLength(0);
  });

  it('parses a simple admin list format', () => {
    const e = parseSimpleList('# header\nJohn Doe|Johnny;JD|OFAC-SDN|TEST\n\nbad line');
    expect(e).toEqual([{ name: 'John Doe', aka: ['Johnny', 'JD'], list: 'OFAC-SDN', program: 'TEST' }]);
  });
});

describe('ScreeningService', () => {
  const svc = () => new ScreeningService(DEFAULT_SANCTIONS, new InMemoryScreeningStore(), 0.85);

  it('records a hit and clears a non-hit', async () => {
    const s = svc();
    const hit = await s.screen('Blocked Testperson', 'manual');
    expect(hit.hit).toBe(true);
    expect((await s.hits())[0]).toMatchObject({ subject: 'Blocked Testperson', matchedName: 'Blocked Testperson', context: 'manual' });

    const clear = await s.screen('Joana Pereira', 'manual');
    expect(clear.hit).toBe(false);
  });

  it('assertClear throws (FORBIDDEN) on a hit, passes otherwise', async () => {
    const s = svc();
    await expect(s.assertClear('Nicolas Maduro', 'transfer')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(s.assertClear('Joana Pereira', 'transfer')).resolves.toMatchObject({ hit: false });
  });
});

describe('screening over HTTP — blocks cash-in + transfer, exposes hits', () => {
  const stubGateway = { name: 'stub', async createCharge(): Promise<any> { return { providerId: 'stub-1', status: 'created', pix: {}, raw: {} }; }, parseWebhook() { return null; } };
  function app() {
    return buildServer({
      ledger: new LedgerService(new InMemoryLedgerStore()),
      registry: new InMemoryRegistryStore(),
      payments: { gateway: stubGateway as any, intents: new InMemoryPaymentIntentStore(), events: new InMemoryProviderEventStore() },
      screening: { service: new ScreeningService(DEFAULT_SANCTIONS, new InMemoryScreeningStore(), 0.85) },
    });
  }
  const inj = (o: object) => app().inject(o as never) as any;

  it('POST /screening/check returns a hit', async () => {
    const r = await inj({ method: 'POST', url: '/screening/check', payload: { name: 'Osama Bin Laden' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().hit).toBe(true);
  });

  it('blocks a cash-in charge for a sanctioned payer (403, gateway never reached)', async () => {
    const r = await inj({ method: 'POST', url: '/payments/charge', payload: { customerId: 'jean', amount: '100.00', payer: { name: 'Blocked Testperson', cpfCnpj: '11144477735' } } });
    expect(r.statusCode).toBe(403);
  });

  it('allows a clean payer', async () => {
    const a = app();
    const r = await (a.inject({ method: 'POST', url: '/payments/charge', payload: { customerId: 'jean', amount: '100.00', payer: { name: 'Joana Pereira', cpfCnpj: '11144477735' } } } as never) as any);
    expect(r.statusCode).toBe(201); // clean name passes screening through to the gateway
  });

  it('records the cash-in block as a hit', async () => {
    const a = app();
    await (a.inject({ method: 'POST', url: '/payments/charge', payload: { customerId: 'jean', amount: '100.00', payer: { name: 'Blocked Testperson', cpfCnpj: '11144477735' } } } as never) as any);
    const hits = (await (a.inject({ method: 'GET', url: '/screening/hits' } as never) as any)).json();
    expect(hits[0]).toMatchObject({ context: 'charge', matchedName: 'Blocked Testperson' });
  });

  it('blocks a transfer to a sanctioned recipient (403)', async () => {
    const r = await inj({ method: 'POST', url: '/transactions/transfer', payload: { senderId: 'jean', recipientRef: 'Nicolas Maduro', fromCurrency: 'BRL', toCurrency: 'HTG', sendAmount: '10.00', feeAmount: '0', rate: '24', idempotencyKey: 'b1' } });
    expect(r.statusCode).toBe(403);
  });
});
