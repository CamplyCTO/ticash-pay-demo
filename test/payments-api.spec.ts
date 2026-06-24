import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { LedgerService } from '../src/ledger/service';
import { InMemoryPaymentIntentStore } from '../src/payments/intent-store';
import { InMemoryProviderEventStore } from '../src/payments/event-store';
import { createHmac } from 'node:crypto';
import { LytexPaymentAdapter, LytexConfig } from '../src/payments/lytex-adapter';
import { HttpClient } from '../src/payments/types';

interface InjectResponse {
  statusCode: number;
  payload: string;
  json<T = any>(): T;
}

// Fake Lytex HTTP so /payments/charge works without a network.
class FakeHttp implements HttpClient {
  async request(req: { url: string }) {
    if (req.url.endsWith('/v1/oauth/obtain_token')) {
      return { status: 200, text: async () => JSON.stringify({ data: { accessToken: 'tok', expiresIn: 3600 } }) };
    }
    return {
      status: 200,
      text: async () => JSON.stringify({ data: { _id: 'inv1', status: 'created', paymentMethods: { pix: { qrCode: 'PIXCOPY' } } } }),
    };
  }
}

const cfg: LytexConfig = {
  authBase: 'https://auth.test',
  apiBase: 'https://api.test',
  clientId: 'cid',
  clientSecret: 'csec',
  callbackSecret: 'cb-secret',
};

let app: ReturnType<typeof buildServer>;
beforeEach(() => {
  app = buildServer({
    ledger: new LedgerService(new InMemoryLedgerStore()),
    registry: new InMemoryRegistryStore(),
    payments: {
      gateway: new LytexPaymentAdapter(cfg, new FakeHttp()),
      intents: new InMemoryPaymentIntentStore(),
      events: new InMemoryProviderEventStore(),
    },
  });
});

function inject(opts: { method: 'GET' | 'POST'; url: string; payload?: unknown; headers?: Record<string, string> }): Promise<InjectResponse> {
  return app.inject(opts as never) as unknown as Promise<InjectResponse>;
}
const balanceOf = async (id: string) =>
  (await inject({ method: 'GET', url: `/accounts/balance?ownerType=customer&ownerId=${id}&kind=wallet&currency=BRL` })).json().balanceMinor;

// Real Lytex webhook: { webhookType, data, signature } where
// signature = base64(HMAC-SHA256(callbackSecret, JSON.stringify(data))).
const webhook = (webhookType: string, data: object, secret = 'cb-secret') => {
  const signature = createHmac('sha256', secret).update(JSON.stringify(data), 'utf8').digest('base64');
  return inject({
    method: 'POST',
    url: '/webhooks/lytex',
    payload: JSON.stringify({ webhookType, data, signature }),
    headers: { 'content-type': 'application/json' },
  });
};

describe('Lytex money-in over HTTP', () => {
  it('opens a charge and records a pending intent', async () => {
    const r = await inject({
      method: 'POST',
      url: '/payments/charge',
      payload: { customerId: 'jean', amount: '100.00', payer: { name: 'Jean', cpfCnpj: '12345678901' } },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ providerId: 'inv1', pix: { copyPaste: 'PIXCOPY' } });
    expect(await balanceOf('jean')).toBe('0'); // not funded until settlement
  });

  it('rejects a webhook with a bad signature', async () => {
    const r = await webhook('receivedInvoice', { invoiceId: 'inv1', status: 'paid', invoiceValue: 10000 }, 'wrong-secret');
    expect(r.statusCode).toBe(401);
  });

  it('funds the wallet on a verified settlement, exactly once', async () => {
    await inject({
      method: 'POST',
      url: '/payments/charge',
      payload: { customerId: 'jean', amount: '100.00', payer: { name: 'Jean', cpfCnpj: '12345678901' } },
    });

    const data = { invoiceId: 'inv1', status: 'paid', invoiceValue: 10000 };
    const ok = await webhook('receivedInvoice', data);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ok).toBe(true);
    expect(await balanceOf('jean')).toBe('10000');

    // Duplicate delivery is deduped at the edge (provider_events) and never re-credits.
    const dup = await webhook('receivedInvoice', data);
    expect(dup.statusCode).toBe(200);
    expect(dup.json().duplicate).toBe(true);
    expect(await balanceOf('jean')).toBe('10000');

    const recon = (await inject({ method: 'GET', url: '/reconciliation' })).json();
    expect(recon).toMatchObject({ balanced: true, consistent: true });
  });

  it('acknowledges a settlement for an unknown charge without funding', async () => {
    const r = await webhook('receivedInvoice', { invoiceId: 'ghost', status: 'paid', invoiceValue: 10000 });
    expect(r.statusCode).toBe(200);
    expect(r.json().unmatched).toBe('ghost');
  });
});
