import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { LedgerService } from '../src/ledger/service';

/** Minimal structural type for a light-my-request response (avoids `export =` import friction). */
interface InjectResponse {
  statusCode: number;
  payload: string;
  json<T = any>(): T;
}

let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  app = buildServer({
    ledger: new LedgerService(new InMemoryLedgerStore()),
    registry: new InMemoryRegistryStore(),
  });
});

function inject(opts: { method: 'GET' | 'POST'; url: string; payload?: object }): Promise<InjectResponse> {
  return app.inject(opts as never) as unknown as Promise<InjectResponse>;
}
const post = (url: string, payload: object) => inject({ method: 'POST', url, payload });
const get = (url: string) => inject({ method: 'GET', url });

describe('HTTP API (in-process)', () => {
  it('health check', async () => {
    const res = await get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('funds a wallet and serializes BigInt balances as strings', async () => {
    const r = await post('/transactions/fund-wallet', {
      customerId: 'jean', currency: 'BRL', amount: '1240.00', idempotencyKey: 'f1',
    });
    expect(r.statusCode).toBe(200);

    const bal = await get('/accounts/balance?ownerType=customer&ownerId=jean&kind=wallet&currency=BRL');
    expect(bal.statusCode).toBe(200);
    // BigInt must come back as a JSON string, not throw or become a number.
    expect(bal.json()).toMatchObject({ balanceMinor: '124000' });
  });

  it('runs a full BR->HT transfer over HTTP', async () => {
    await post('/transactions/fund-wallet', { customerId: 'jean', currency: 'BRL', amount: '1240.00', idempotencyKey: 'f1' });
    const r = await post('/transactions/transfer', {
      senderId: 'jean', recipientRef: 'Marie/MonCash',
      fromCurrency: 'BRL', toCurrency: 'HTG',
      sendAmount: '500.00', feeAmount: '12.50', rate: '24.36', idempotencyKey: 'x1',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().quote.receiveMinor).toBe('1218000'); // 12180.00 HTG

    const recon = await get('/reconciliation');
    expect(recon.json()).toMatchObject({ balanced: true, consistent: true });
  });

  it('returns 409 on overdraft', async () => {
    const r = await post('/transactions/cash-out', {
      agentId: 'a1', customerId: 'broke', currency: 'BRL', amount: '10.00', idempotencyKey: 'od1',
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('INSUFFICIENT_FUNDS');
  });

  it('returns 400 on invalid input', async () => {
    const r = await post('/transactions/fund-wallet', { customerId: 'x', currency: 'XYZ', amount: '1', idempotencyKey: 'k' });
    expect(r.statusCode).toBe(400);
  });

  it('is idempotent over HTTP', async () => {
    const body = { customerId: 'jean', currency: 'BRL', amount: '500.00', idempotencyKey: 'dup' };
    const a = await post('/transactions/fund-wallet', body);
    const b = await post('/transactions/fund-wallet', body);
    expect(a.json().transactionUid).toBe(b.json().transactionUid);
    const bal = await get('/accounts/balance?ownerType=customer&ownerId=jean&kind=wallet&currency=BRL');
    expect(bal.json().balanceMinor).toBe('50000'); // not doubled
  });

  it('exposes the append-only ledger feed', async () => {
    await post('/transactions/fund-wallet', { customerId: 'jean', currency: 'BRL', amount: '10.00', idempotencyKey: 'f1' });
    const feed = await get('/ledger?limit=10');
    expect(feed.statusCode).toBe(200);
    expect(Array.isArray(feed.json())).toBe(true);
    expect(feed.json().length).toBeGreaterThan(0);
  });

  it('registers customers/agents and updates KYC', async () => {
    const c = await post('/customers', { externalId: 'jean' });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ externalId: 'jean', kycStatus: 'pending', kycLevel: 0 });

    // duplicate -> 409
    expect((await post('/customers', { externalId: 'jean' })).statusCode).toBe(409);

    const kyc = await post('/customers/jean/kyc', { level: 2, status: 'approved' });
    expect(kyc.json()).toMatchObject({ kycLevel: 2, kycStatus: 'approved' });

    const a = await post('/agents', { externalId: 'pedro', floatLimit: '15000.00', commissionBps: 75 });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ externalId: 'pedro', floatLimitMinor: '1500000', commissionBps: 75 });

    expect((await get('/customers')).json().length).toBe(1);
    expect((await get('/agents')).json().length).toBe(1);
  });

  it('updating KYC for an unknown customer returns 404', async () => {
    const r = await post('/customers/ghost/kyc', { level: 1, status: 'approved' });
    expect(r.statusCode).toBe(404);
  });

  it('serves the admin panel HTML', async () => {
    const r = await get('/admin');
    expect(r.statusCode).toBe(200);
    expect(r.payload).toContain('Painel Admin');
    expect(r.payload).toContain("api('GET','/reconciliation')");
  });
});
