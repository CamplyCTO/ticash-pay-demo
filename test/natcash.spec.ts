import { describe, expect, it } from 'vitest';
import { NatcashPayoutAdapter, NatcashConfig } from '../src/payouts/natcash-adapter';
import { HttpClient } from '../src/payments/types';
import { PayoutRequest } from '../src/payouts/types';

const cfg: NatcashConfig = { base: 'https://nc.test/api/channel', privateKey: 'pk-secret' };

interface Rec { url: string; method: string; headers: Record<string, string>; body?: string }
class FakeHttp implements HttpClient {
  calls: Rec[] = [];
  constructor(private readonly handler: (r: Rec) => { status: number; body: string }) {}
  async request(r: Rec) {
    this.calls.push(r);
    const res = this.handler(r);
    return { status: res.status, text: async () => res.body };
  }
}

const payout: PayoutRequest = { correlationId: 'corr-1', currency: 'HTG', amountMinor: 5050n, recipientRef: '50912345678' };
const okHandler = (r: Rec) => {
  if (r.url.endsWith('/requestcashin')) return { status: 200, body: JSON.stringify({ resultCode: '200', message: 'Success', result: { txId: 'tx-1', amount: '50.50' } }) };
  if (r.url.endsWith('/confirmcashin')) return { status: 200, body: JSON.stringify({ resultCode: '200', message: 'Success', result: { txId: 'tx-1', transactionId: 'TXN-1' } }) };
  return { status: 404, body: '{}' };
};

describe('NatcashPayoutAdapter', () => {
  it('runs requestcashin -> confirmcashin and returns the transactionId', async () => {
    const http = new FakeHttp(okHandler);
    const res = await new NatcashPayoutAdapter(cfg, http, () => 1700000000000).sendPayout(payout);
    expect(res.providerRef).toBe('TXN-1');

    const req = http.calls.find((c) => c.url.endsWith('/requestcashin'))!;
    expect(req.headers.skml).toBe('pk-secret'); // the header that fixes "error 46"
    const reqBody = JSON.parse(req.body!);
    expect(reqBody.amount).toBe(50.5); // 5050 HTG cents -> 50.5 major
    expect(typeof reqBody.requestId).toBe('number');
    expect(reqBody.requestId).toBeLessThanOrEqual(2147483647); // Int32
    expect(reqBody.signature).toMatch(/^[0-9a-f]{64}$/); // HMAC-SHA256 hex

    const conf = http.calls.find((c) => c.url.endsWith('/confirmcashin'))!;
    expect(conf.headers.skml).toBe('pk-secret');
    const confBody = JSON.parse(conf.body!);
    expect(confBody.txId).toBe('tx-1'); // carried from requestcashin
    expect(confBody.verifyCode).toBe('');
    expect(confBody.isConfirm).toBe('1');
  });

  it('derives a stable requestId from the correlationId (idempotent retries)', async () => {
    const a = new FakeHttp(okHandler), b = new FakeHttp(okHandler);
    await new NatcashPayoutAdapter(cfg, a, () => 1).sendPayout(payout);
    await new NatcashPayoutAdapter(cfg, b, () => 2).sendPayout(payout);
    expect(JSON.parse(a.calls[0]!.body!).requestId).toBe(JSON.parse(b.calls[0]!.body!).requestId);
  });

  it('throws when requestcashin is rejected', async () => {
    const http = new FakeHttp((r) => (r.url.endsWith('/requestcashin') ? { status: 200, body: JSON.stringify({ resultCode: '503', message: 'Invalid Signature' }) } : { status: 200, body: '{}' }));
    await expect(new NatcashPayoutAdapter(cfg, http).sendPayout(payout)).rejects.toThrow(/requestcashin failed/i);
  });

  it('throws when confirmcashin is rejected', async () => {
    const http = new FakeHttp((r) => (r.url.endsWith('/requestcashin') ? { status: 200, body: JSON.stringify({ resultCode: '200', result: { txId: 'tx-1' } }) } : { status: 200, body: JSON.stringify({ resultCode: '503', message: 'fail' }) }));
    await expect(new NatcashPayoutAdapter(cfg, http).sendPayout(payout)).rejects.toThrow(/confirmcashin failed/i);
  });

  it('getStatus reports success (synchronous provider)', async () => {
    const r = await new NatcashPayoutAdapter(cfg, new FakeHttp(okHandler)).getStatus('TXN-1');
    expect(r.state).toBe('success');
  });
});
