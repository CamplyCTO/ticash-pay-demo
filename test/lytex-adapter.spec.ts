import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LytexPaymentAdapter, LytexConfig } from '../src/payments/lytex-adapter';
import { ChargeRequest, HttpClient } from '../src/payments/types';

const cfg: LytexConfig = {
  authBase: 'https://auth.test',
  apiBase: 'https://api.test',
  clientId: 'cid',
  clientSecret: 'csec',
  callbackSecret: 'sek',
};

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
class FakeHttp implements HttpClient {
  calls: Recorded[] = [];
  constructor(private readonly handler: (req: Recorded) => { status: number; body: string }) {}
  async request(req: Recorded) {
    this.calls.push(req);
    const r = this.handler(req);
    return { status: r.status, text: async () => r.body };
  }
}

const charge: ChargeRequest = {
  customerId: 'jean',
  currency: 'BRL',
  amountMinor: 10000n, // R$100.00
  methods: ['pix'],
  payer: { name: 'Jean Wilson', cpfCnpj: '12345678901' },
  reference: 'chg-1',
};

function defaultHandler(authCounter?: { n: number }) {
  return (req: Recorded) => {
    if (req.url.endsWith('/v1/oauth/obtain_token')) {
      if (authCounter) authCounter.n++;
      return { status: 200, body: JSON.stringify({ data: { accessToken: 'tok1', expiresIn: 3600 } }) };
    }
    if (req.url.endsWith('/v2/invoices')) {
      return {
        status: 200,
        body: JSON.stringify({
          data: { _id: 'inv1', _hashId: 'h1', status: 'waitingPayment', paymentMethods: { pix: { qrcode: 'PIXCOPY' } } },
        }),
      };
    }
    return { status: 404, body: '{}' };
  };
}

describe('LytexPaymentAdapter — auth + charge', () => {
  it('creates a PIX charge with a Bearer token and parses the result', async () => {
    const http = new FakeHttp(defaultHandler());
    const adapter = new LytexPaymentAdapter(cfg, http, () => 1000);
    const r = await adapter.createCharge(charge);

    expect(r.providerId).toBe('inv1');
    expect(r.hashId).toBe('h1');
    expect(r.pix?.copyPaste).toBe('PIXCOPY');

    const inv = http.calls.find((c) => c.url.endsWith('/v2/invoices'))!;
    expect(inv.headers.authorization).toBe('Bearer tok1');
    const body = JSON.parse(inv.body!);
    expect(body.paymentMethods.pix.enable).toBe(true);
    expect(body.paymentMethods.creditCard.enable).toBe(false);
    expect(body.items[0].value).toBe(10000); // cents, exact
    expect(body.client.type).toBe('pf'); // 11-digit CPF
    expect(body.referenceId).toBe('chg-1');
  });

  it('caches the access token across calls and refreshes after expiry', async () => {
    const counter = { n: 0 };
    const http = new FakeHttp(defaultHandler(counter));
    let now = 1000;
    const adapter = new LytexPaymentAdapter(cfg, http, () => now);

    await adapter.createCharge(charge);
    await adapter.createCharge(charge);
    expect(counter.n).toBe(1); // token reused, not re-fetched

    now += 3600_000; // jump past the 1h expiry
    await adapter.createCharge(charge);
    expect(counter.n).toBe(2); // refreshed
  });

  it('throws a PaymentProviderError on a non-2xx', async () => {
    const http = new FakeHttp(() => ({ status: 401, body: JSON.stringify({ message: 'bad creds' }) }));
    const adapter = new LytexPaymentAdapter(cfg, http, () => 1000);
    await expect(adapter.createCharge(charge)).rejects.toThrow(/auth failed/i);
  });
});

describe('LytexPaymentAdapter — webhook verification', () => {
  const adapter = new LytexPaymentAdapter(cfg, new FakeHttp(defaultHandler()), () => 1000);
  // Real Lytex shape: signature lives in the body = base64(HMAC-SHA256(secret, JSON.stringify(data))).
  const lytexBody = (webhookType: string, data: object) => {
    const signature = createHmac('sha256', 'sek').update(JSON.stringify(data), 'utf8').digest('base64');
    return JSON.stringify({ webhookType, data, signature });
  };

  it('accepts a correctly body-signed settlement and marks it paid', () => {
    const body = lytexBody('receivedInvoice', { invoiceId: 'inv1', status: 'paid', invoiceValue: 10000 });
    const ev = adapter.parseWebhook(body, {});
    expect(ev).not.toBeNull();
    expect(ev!.paid).toBe(true);
    expect(ev!.providerId).toBe('inv1'); // from data.invoiceId
    expect(ev!.amountMinor).toBe(10000n); // from data.invoiceValue (cents)
  });

  it('rejects a tampered body / bad signature (returns null)', () => {
    const good = lytexBody('receivedInvoice', { invoiceId: 'inv1', status: 'paid', invoiceValue: 10000 });
    const tampered = good.replace('"invoiceValue":10000', '"invoiceValue":999999'); // signature no longer matches
    expect(adapter.parseWebhook(tampered, {})).toBeNull();
    expect(adapter.parseWebhook('{"data":{"invoiceId":"x"},"signature":"nope"}', {})).toBeNull();
    expect(adapter.parseWebhook('not json', {})).toBeNull();
  });

  it('parses a due/creation event as not-paid', () => {
    const body = lytexBody('dueInvoice', { invoiceId: 'inv1', status: 'waitingPayment', invoiceValue: 10000 });
    const ev = adapter.parseWebhook(body, {});
    expect(ev!.paid).toBe(false);
  });
});
