import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { LedgerService } from '../src/ledger/service';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { OtpSender } from '../src/auth/otp-sender';
import { KycLimits } from '../src/kyc/limits';

interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }
const CFG: AuthConfig = { jwtSecret: 's', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 50 };
class Sender implements OtpSender { readonly name = 'c'; last = ''; async send(_p: string, code: string) { this.last = code; } }

let app: ReturnType<typeof buildServer>;
let sender: Sender;

beforeEach(() => {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  const registry = new InMemoryRegistryStore();
  sender = new Sender();
  app = buildServer({ ledger, registry, auth: { service: new AuthService(new InMemoryAuthStore(), registry, sender, CFG) } });
});

function inj(o: { method: 'GET' | 'POST'; url: string; payload?: object; headers?: Record<string, string> }): Promise<InjectResponse> {
  return app.inject(o as never) as unknown as Promise<InjectResponse>;
}
const post = (url: string, payload: object, headers?: Record<string, string>) => inj({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });
const get = (url: string, headers?: Record<string, string>) => inj({ method: 'GET', url, ...(headers ? { headers } : {}) });

async function loginAgent(externalId: string, phone: string, commissionBps: number) {
  await post('/agents', { externalId, floatLimit: '100000.00', commissionBps });
  await post(`/agents/${externalId}/app-login`, { phone });
  await post('/app/auth/otp', { phone });
  const v = await post('/app/auth/verify', { phone, code: sender.last });
  return `Bearer ${v.json().accessToken}`;
}
async function registerCustomer(phone: string) {
  const r = await post('/app/auth/register', { phone });
  return r.json().user.externalId as string;
}
const bal = async (q: string) => Number((await get('/accounts/balance?' + q)).json().balanceMinor);

describe('/app agent flows (WS-3)', () => {
  it('cash-in moves float->wallet, accrues commission, and reconciles to zero', async () => {
    const token = await loginAgent('pedro', '+5511800000001', 75); // 0.75%
    const cust = await registerCustomer('+5511800000002');
    await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '5000.00', idempotencyKey: 'ft1' });

    const ci = await post('/app/agent/cash-in', { customerId: cust, currency: 'BRL', amount: '1000.00' }, { authorization: token });
    expect(ci.statusCode).toBe(201);

    expect(await bal(`ownerType=customer&ownerId=${cust}&kind=wallet&currency=BRL`)).toBe(100000); // customer +1000
    expect(await bal('ownerType=agent&ownerId=pedro&kind=agent_float&currency=BRL')).toBe(400000); // 5000 - 1000
    expect(await bal('ownerType=agent&ownerId=pedro&kind=agent_commission&currency=BRL')).toBe(750); // 0.75% of 1000 = 7.50
    expect(await bal('ownerType=system&kind=fee_revenue&currency=BRL')).toBe(-750); // platform funded the commission

    const recon = (await get('/reconciliation')).json();
    expect(recon.balanced).toBe(true);
    expect(recon.consistent).toBe(true);
  });

  it('cash-out moves wallet->float, accrues commission', async () => {
    const token = await loginAgent('pedro', '+5511800000003', 100); // 1%
    const cust = await registerCustomer('+5511800000004');
    await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '2000.00', idempotencyKey: 'ft2' });
    await post('/app/agent/cash-in', { customerId: cust, currency: 'BRL', amount: '1000.00' }, { authorization: token });

    const co = await post('/app/agent/cash-out', { customerId: cust, currency: 'BRL', amount: '400.00' }, { authorization: token });
    expect(co.statusCode).toBe(201);
    expect(await bal(`ownerType=customer&ownerId=${cust}&kind=wallet&currency=BRL`)).toBe(60000); // 1000 - 400
    expect(await bal('ownerType=agent&ownerId=pedro&kind=agent_float&currency=BRL')).toBe(140000); // 2000-1000+400
    expect(await bal('ownerType=agent&ownerId=pedro&kind=agent_commission&currency=BRL')).toBe(1000 + 400); // 1% of 1000 + 1% of 400 = 10.00 + 4.00
    expect((await get('/reconciliation')).json().balanced).toBe(true);
  });

  it('is idempotent: replaying a cash-in never double-moves float or commission', async () => {
    const token = await loginAgent('pedro', '+5511800000010', 75);
    const cust = await registerCustomer('+5511800000011');
    await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '2000.00', idempotencyKey: 'ftx' });
    const body = { customerId: cust, currency: 'BRL', amount: '300.00', idempotencyKey: 'agent-ci-key' };

    const a = await post('/app/agent/cash-in', body, { authorization: token });
    const b = await post('/app/agent/cash-in', body, { authorization: token });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json().transactionUid).toBe(a.json().transactionUid); // same journal, not a new one

    // Moved ONCE: float 2000-300, wallet +300, commission 0.75% of 300 (not 600).
    expect(await bal('ownerType=agent&ownerId=pedro&kind=agent_float&currency=BRL')).toBe(170000);
    expect(await bal(`ownerType=customer&ownerId=${cust}&kind=wallet&currency=BRL`)).toBe(30000);
    expect(await bal('ownerType=agent&ownerId=pedro&kind=agent_commission&currency=BRL')).toBe(225);
    expect((await get('/reconciliation')).json().balanced).toBe(true);
  });

  it('is scoped: a customer cannot use agent endpoints (403); unauth is 401', async () => {
    await registerCustomer('+5511800000005');
    const v = await post('/app/auth/verify', { phone: '+5511800000005', code: sender.last });
    const custToken = `Bearer ${v.json().accessToken}`;
    const forbidden = await post('/app/agent/cash-in', { customerId: 'x', currency: 'BRL', amount: '1.00' }, { authorization: custToken });
    expect(forbidden.statusCode).toBe(403);
    const unauth = await post('/app/agent/cash-in', { customerId: 'x', currency: 'BRL', amount: '1.00' });
    expect(unauth.statusCode).toBe(401);
  });

  it('looks up a customer by phone; rejects cash-in to an unknown customer (404)', async () => {
    const token = await loginAgent('pedro', '+5511800000006', 50);
    const cust = await registerCustomer('+5511800000007');
    const look = await post('/app/agent/customer', { phone: '+5511800000007' }, { authorization: token });
    expect(look.statusCode).toBe(200);
    expect(look.json().externalId).toBe(cust);

    await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '100.00', idempotencyKey: 'ft3' });
    const ghost = await post('/app/agent/cash-in', { customerId: 'nobody', currency: 'BRL', amount: '10.00' }, { authorization: token });
    expect(ghost.statusCode).toBe(404);
  });

  it('enforces the customer KYC cap on cash-in (422) but not on cash-out', async () => {
    // A server WITH KYC limits (L0 cap = 500 BRL).
    const ledger = new LedgerService(new InMemoryLedgerStore());
    const registry = new InMemoryRegistryStore();
    const s = new Sender();
    const app2 = buildServer({ ledger, registry, auth: { service: new AuthService(new InMemoryAuthStore(), registry, s, CFG) }, kyc: { limits: new KycLimits(registry, { 0: 500, 1: 5000, 2: 50000 }) } });
    const inj2 = (o: any) => app2.inject(o) as unknown as Promise<InjectResponse>;
    const p2 = (url: string, payload: object, headers?: Record<string, string>) => inj2({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });

    await p2('/agents', { externalId: 'ana', floatLimit: '100000.00', commissionBps: 50 });
    await p2('/agents/ana/app-login', { phone: '+5511800000020' });
    await p2('/app/auth/otp', { phone: '+5511800000020' });
    const token = `Bearer ${(await p2('/app/auth/verify', { phone: '+5511800000020', code: s.last })).json().accessToken}`;
    const cust = (await p2('/app/auth/register', { phone: '+5511800000021' })).json().user.externalId;
    await p2('/agents/float-topup', { agentId: 'ana', currency: 'BRL', amount: '5000.00', idempotencyKey: 'fa' });

    // 600 > L0 cap 500 -> blocked
    expect((await p2('/app/agent/cash-in', { customerId: cust, currency: 'BRL', amount: '600.00' }, { authorization: token })).statusCode).toBe(422);
    // 400 within cap -> ok
    expect((await p2('/app/agent/cash-in', { customerId: cust, currency: 'BRL', amount: '400.00' }, { authorization: token })).statusCode).toBe(201);
    // Top up the wallet over the cap (admin), then cash-out 600 -> NOT capped (spending own funds).
    await p2('/transactions/fund-wallet', { customerId: cust, currency: 'BRL', amount: '1000.00', idempotencyKey: 'fw' });
    expect((await p2('/app/agent/cash-out', { customerId: cust, currency: 'BRL', amount: '600.00' }, { authorization: token })).statusCode).toBe(201);
  });

  it('a panel commission edit takes effect on the next cash-in (and caps out-of-range)', async () => {
    const token = await loginAgent('pedro', '+5511800000030', 0); // created at 0%
    const cust = await registerCustomer('+5511800000031');
    await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '5000.00', idempotencyKey: 'ftc' });

    const upd = await post('/agents/pedro/commission', { commissionBps: 150 }); // 1.50%
    expect(upd.statusCode).toBe(200);
    expect(upd.json().commissionBps).toBe(150);
    expect((await get('/agents')).json().find((a: any) => a.externalId === 'pedro').commissionBps).toBe(150);

    // The next cash-in accrues at the NEW rate.
    await post('/app/agent/cash-in', { customerId: cust, currency: 'BRL', amount: '1000.00' }, { authorization: token });
    expect(await bal('ownerType=agent&ownerId=pedro&kind=agent_commission&currency=BRL')).toBe(1500); // 1.5% of 1000

    expect((await post('/agents/pedro/commission', { commissionBps: 99999 })).statusCode).toBe(400); // capped
    expect((await post('/agents/ghost/commission', { commissionBps: 100 })).statusCode).toBe(404); // unknown agent
  });

  it('agent /app/me + history reflect the float and operations', async () => {
    const token = await loginAgent('pedro', '+5511800000008', 75);
    const cust = await registerCustomer('+5511800000009');
    await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '500.00', idempotencyKey: 'ft4' });
    await post('/app/agent/cash-in', { customerId: cust, currency: 'BRL', amount: '200.00' }, { authorization: token });
    const me = await get('/app/me', { authorization: token });
    expect(me.json().user.role).toBe('agent');
    const float = me.json().float.find((w: any) => w.currency === 'BRL');
    expect(Number(float.balanceMinor)).toBe(30000); // 500 - 200
    const hist = await get('/app/transactions', { authorization: token });
    expect(hist.json().some((r: any) => r.type === 'cash_in')).toBe(true);
  });
});
