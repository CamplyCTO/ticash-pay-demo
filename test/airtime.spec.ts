import { describe, expect, it } from 'vitest';
import { DingConnectAdapter, DingConfig } from '../src/airtime/dingconnect-adapter';
import { AirtimeService } from '../src/airtime/airtime-service';
import { AirtimePort } from '../src/airtime/types';
import { HttpClient } from '../src/payments/types';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { LedgerService } from '../src/ledger/service';
import { AccountSpec } from '../src/ledger/types';

const cfg: DingConfig = { base: 'https://ding.test/api/V1', apiKey: 'KEY' };
interface Rec { url: string; method: string; headers: Record<string, string>; body?: string }
class FakeHttp implements HttpClient {
  calls: Rec[] = [];
  constructor(private readonly h: (r: Rec) => { status: number; body: string }) {}
  async request(r: Rec) { this.calls.push(r); const x = this.h(r); return { status: x.status, text: async () => x.body }; }
}

describe('DingConnectAdapter', () => {
  const handler = (r: Rec) => {
    if (r.url.endsWith('/GetBalance')) return { status: 200, body: JSON.stringify({ Balance: 12.34, CurrencyIso: 'BRL', ResultCode: 1 }) };
    if (r.url.includes('/GetProducts')) return { status: 200, body: JSON.stringify({ ResultCode: 1, Items: [{ SkuCode: '4RHT10700', ProviderCode: '4RHT', Maximum: { SendValue: 64.28, SendCurrencyIso: 'BRL', ReceiveValue: 10, ReceiveCurrencyIso: 'USD' } }] }) };
    if (r.url.endsWith('/SendTransfer')) return { status: 200, body: JSON.stringify({ ResultCode: 1, ErrorCodes: [], TransferRecord: { TransferId: 'T-1' } }) };
    return { status: 404, body: '{}' };
  };

  it('reads balance and parses products', async () => {
    const a = new DingConnectAdapter(cfg, new FakeHttp(handler));
    expect(await a.balance()).toEqual({ amount: 12.34, currency: 'BRL' });
    const p = await a.products('HT');
    expect(p[0]).toMatchObject({ skuCode: '4RHT10700', sendValue: 64.28, sendCurrency: 'BRL', receiveValue: 10, receiveCurrency: 'USD' });
  });

  it('sends with api_key + browser UA and returns the transfer id', async () => {
    const http = new FakeHttp(handler);
    const res = await new DingConnectAdapter(cfg, http).send({ accountNumber: '50912345678', skuCode: '4RHT10700', sendValue: 64.28, sendCurrency: 'BRL', distributorRef: 'ref-1' });
    expect(res.providerRef).toBe('T-1');
    const call = http.calls.find((c) => c.url.endsWith('/SendTransfer'))!;
    expect(call.headers.api_key).toBe('KEY');
    expect(call.headers['user-agent']).toMatch(/Ticash/); // WAF needs a real UA
    expect(JSON.parse(call.body!)).toMatchObject({ SkuCode: '4RHT10700', SendValue: 64.28, AccountNumber: '50912345678', DistributorRef: 'ref-1' });
  });

  it('throws on a non-success ResultCode', async () => {
    const http = new FakeHttp((r) => (r.url.endsWith('/SendTransfer') ? { status: 200, body: JSON.stringify({ ResultCode: 0, ErrorCodes: ['InsufficientBalance'] }) } : { status: 200, body: '{}' }));
    await expect(new DingConnectAdapter(cfg, http).send({ accountNumber: '5', skuCode: 's', sendValue: 1, sendCurrency: 'BRL', distributorRef: 'r' })).rejects.toThrow(/InsufficientBalance/);
  });
});

class FakePort implements AirtimePort {
  readonly name = 'dingconnect';
  sent = 0;
  constructor(private readonly ok = true) {}
  async balance() { return { amount: 0, currency: 'BRL' }; }
  async products() { return []; }
  async send() { this.sent++; if (!this.ok) throw new Error('provider send failed'); return { providerRef: 'T-1', raw: {} }; }
}
const wallet = (id: string): AccountSpec => ({ ownerType: 'customer', ownerId: id, kind: 'wallet', currency: 'BRL' });

describe('AirtimeService — debit, send, refund-on-fail', () => {
  async function funded(amount: bigint) {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    await ledger.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: amount, idempotencyKey: 'f' });
    return ledger;
  }
  const args = { customerId: 'jean', currency: 'BRL' as const, accountNumber: '50912345678', skuCode: '4RHT10700', amountMinor: 6428n, idempotencyKey: 'air-1' };

  it('debits the wallet and sends', async () => {
    const ledger = await funded(10000n);
    const port = new FakePort(true);
    const r = await new AirtimeService(port, ledger).topup(args);
    expect(r.providerRef).toBe('T-1');
    expect(await ledger.getBalance(wallet('jean'))).toBe(3572n); // 100.00 - 64.28
    expect((await ledger.reconcile()).balanced).toBe(true);
  });

  it('rejects when the wallet has insufficient funds (no send attempted)', async () => {
    const ledger = await funded(1000n); // only R$10
    const port = new FakePort(true);
    await expect(new AirtimeService(port, ledger).topup(args)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(port.sent).toBe(0);
    expect(await ledger.getBalance(wallet('jean'))).toBe(1000n); // untouched
  });

  it('refunds the wallet when the provider send fails', async () => {
    const ledger = await funded(10000n);
    const port = new FakePort(false); // send throws
    await expect(new AirtimeService(port, ledger).topup(args)).rejects.toThrow(/send failed/);
    expect(await ledger.getBalance(wallet('jean'))).toBe(10000n); // refunded
    expect((await ledger.reconcile()).balanced).toBe(true);
  });
});
