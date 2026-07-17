import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { InMemoryCashoutStore } from '../src/cashout/cashout-store';
import { LedgerService } from '../src/ledger/service';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { CashoutService } from '../src/cashout/cashout-service';
import { OtpSender } from '../src/auth/otp-sender';

interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }
const CFG: AuthConfig = { jwtSecret: 's', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 50 };
class Sender implements OtpSender { readonly name = 'c'; last = ''; async send(_p: string, code: string) { this.last = code; } }

let app: ReturnType<typeof buildServer>;
let sender: Sender;

beforeEach(() => {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  const registry = new InMemoryRegistryStore();
  sender = new Sender();
  app = buildServer({
    ledger,
    registry,
    auth: { service: new AuthService(new InMemoryAuthStore(), registry, sender, CFG) },
    cashout: { service: new CashoutService(ledger, new InMemoryCashoutStore(), { expiryMinutes: 30 }) },
  });
});

function inj(o: { method: 'GET' | 'POST'; url: string; payload?: object; headers?: Record<string, string> }): Promise<InjectResponse> {
  return app.inject(o as never) as unknown as Promise<InjectResponse>;
}
const post = (url: string, payload: object, headers?: Record<string, string>) => inj({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });
const get = (url: string, headers?: Record<string, string>) => inj({ method: 'GET', url, ...(headers ? { headers } : {}) });
const bal = async (id: string) => Number((await get(`/accounts/balance?ownerType=customer&ownerId=${id}&kind=wallet&currency=BRL`)).json().balanceMinor);

async function loginCustomer(phone: string): Promise<{ ext: string; token: string }> {
  const r = await post('/app/auth/register', { phone });
  const ext = r.json().user.externalId as string;
  await post('/app/auth/otp', { phone });
  const v = await post('/app/auth/verify', { phone, code: sender.last });
  return { ext, token: `Bearer ${v.json().accessToken}` };
}
async function loginAgent(id: string, phone: string): Promise<{ id: string; token: string }> {
  await post('/agents', { externalId: id, floatLimit: '10000', commissionBps: 100 });
  await post(`/agents/${id}/app-login`, { phone });
  await post('/app/auth/otp', { phone });
  const v = await post('/app/auth/verify', { phone, code: sender.last });
  return { id, token: `Bearer ${v.json().accessToken}` };
}
const fund = (customerId: string, amount: string) => post('/transactions/fund-wallet', { customerId, currency: 'BRL', amount, idempotencyKey: `f:${customerId}:${amount}` });
const requestCashout = (agent: { token: string }, customerId: string, amount: string) =>
  post('/app/agent/cash-out', { customerId, currency: 'BRL', amount }, { authorization: agent.token });

describe('Cash-out approval (customer must approve before any debit)', () => {
  it('an agent request creates a PENDING request and does NOT debit', async () => {
    const cust = await loginCustomer('+5511900000001');
    await fund(cust.ext, '500.00');
    const agent = await loginAgent('agent-1', '+5511900000002');
    const r = await requestCashout(agent, cust.ext, '120.00');
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe('pending');
    expect(await bal(cust.ext)).toBe(50000); // unchanged — no money moved
  });

  it('customer approval runs the debit EXACTLY once (double-approve rejected)', async () => {
    const cust = await loginCustomer('+5511900000003');
    await fund(cust.ext, '500.00');
    const agent = await loginAgent('agent-2', '+5511900000004');
    const req = (await requestCashout(agent, cust.ext, '120.00')).json();
    const ap = await post(`/app/cashout/${req.id}/approve`, {}, { authorization: cust.token });
    expect(ap.statusCode).toBe(200);
    expect(ap.json().status).toBe('approved');
    expect(await bal(cust.ext)).toBe(38000); // 500 - 120
    const dbl = await post(`/app/cashout/${req.id}/approve`, {}, { authorization: cust.token });
    expect(dbl.statusCode).toBe(409);
    expect(await bal(cust.ext)).toBe(38000); // never debited twice
  });

  it('reject never debits, and another customer cannot approve', async () => {
    const cust = await loginCustomer('+5511900000005');
    await fund(cust.ext, '500.00');
    const agent = await loginAgent('agent-3', '+5511900000006');
    const other = await loginCustomer('+5511900000007');
    const req = (await requestCashout(agent, cust.ext, '120.00')).json();
    expect((await post(`/app/cashout/${req.id}/approve`, {}, { authorization: other.token })).statusCode).toBe(403);
    expect((await post(`/app/cashout/${req.id}/reject`, {}, { authorization: cust.token })).statusCode).toBe(200);
    expect(await bal(cust.ext)).toBe(50000);
    expect((await post(`/app/cashout/${req.id}/approve`, {}, { authorization: cust.token })).statusCode).toBe(409);
  });

  it('approval fails cleanly on insufficient funds and stays retryable (request not stuck approved)', async () => {
    const cust = await loginCustomer('+5511900000008');
    await fund(cust.ext, '50.00');
    const agent = await loginAgent('agent-4', '+5511900000009');
    const req = (await requestCashout(agent, cust.ext, '120.00')).json();
    const ap = await post(`/app/cashout/${req.id}/approve`, {}, { authorization: cust.token });
    expect(ap.statusCode).toBe(409); // INSUFFICIENT_FUNDS
    expect(await bal(cust.ext)).toBe(5000); // untouched
    // reverted to pending → the customer can approve again after funding
    await fund(cust.ext, '100.00');
    const ap2 = await post(`/app/cashout/${req.id}/approve`, {}, { authorization: cust.token });
    expect(ap2.statusCode).toBe(200);
    expect(await bal(cust.ext)).toBe(3000); // 150 - 120
  });
});
