import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { InMemoryWithdrawalStore } from '../src/withdrawal/withdrawal-store';
import { LedgerService } from '../src/ledger/service';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { WithdrawalService } from '../src/withdrawal/withdrawal-service';
import { OtpSender } from '../src/auth/otp-sender';

interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }
const CFG: AuthConfig = { jwtSecret: 's', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 50 };
class Sender implements OtpSender { readonly name = 'c'; last = ''; async send(_p: string, code: string) { this.last = code; } }

const ADDR = 'TXYZ1234567890abcdefTRC20wallet0001';
// 1 USDT fee, 5 USDT minimum — exercises the fee path on settle.
const WCFG = { asset: 'USDT' as const, feeMinor: 1_000_000n, network: 'TRC20', minAmountMinor: 5_000_000n };

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
    withdrawal: { service: new WithdrawalService(ledger, new InMemoryWithdrawalStore(), WCFG) },
  });
});

function inj(o: { method: 'GET' | 'POST'; url: string; payload?: object; headers?: Record<string, string> }): Promise<InjectResponse> {
  return app.inject(o as never) as unknown as Promise<InjectResponse>;
}
const post = (url: string, payload: object, headers?: Record<string, string>) => inj({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });
const get = (url: string, headers?: Record<string, string>) => inj({ method: 'GET', url, ...(headers ? { headers } : {}) });
const usdtBal = async (id: string) => Number((await get(`/accounts/balance?ownerType=customer&ownerId=${id}&kind=wallet&currency=USDT`)).json().balanceMinor);
const fundUsdt = (customerId: string, amount: string) => post('/transactions/fund-wallet', { customerId, currency: 'USDT', amount, idempotencyKey: `f:${customerId}:${amount}` });

async function loginCustomer(phone: string): Promise<{ ext: string; token: string }> {
  const r = await post('/app/auth/register', { phone });
  const ext = r.json().user.externalId as string;
  await post('/app/auth/otp', { phone });
  const v = await post('/app/auth/verify', { phone, code: sender.last });
  return { ext, token: `Bearer ${v.json().accessToken}` };
}
const requestWithdraw = (cust: { token: string }, amount: string, address = ADDR) =>
  post('/app/usdt/withdraw', { address, amount }, { authorization: cust.token });

describe('USDT withdrawal (off-ramp): request HOLDS, operator settles/refunds', () => {
  it('a request HOLDS the USDT immediately (wallet debited, no on-chain settle yet)', async () => {
    const cust = await loginCustomer('+5511900010001');
    await fundUsdt(cust.ext, '100.00');
    const r = await requestWithdraw(cust, '30.00');
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe('pending');
    expect(await usdtBal(cust.ext)).toBe(70_000_000); // 100 - 30 held
    // operator sees exactly this pending request
    const pending = (await get('/withdrawals')).json();
    expect(pending).toHaveLength(1);
    expect(pending[0].customerId).toBe(cust.ext);
    expect(Number(pending[0].amountMinor)).toBe(30_000_000);
  });

  it('completion settles: wallet stays debited, fee retained, request leaves the queue', async () => {
    const cust = await loginCustomer('+5511900010002');
    await fundUsdt(cust.ext, '100.00');
    const w = (await requestWithdraw(cust, '30.00')).json();
    const done = await post(`/withdrawals/${w.id}/complete`, { providerRef: '0xTXHASH123' });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe('completed');
    expect(done.json().providerRef).toBe('0xTXHASH123');
    expect(await usdtBal(cust.ext)).toBe(70_000_000); // held amount is gone for good
    expect((await get('/withdrawals')).json()).toHaveLength(0); // no longer pending
  });

  it('double-complete is rejected (409) and never double-settles', async () => {
    const cust = await loginCustomer('+5511900010003');
    await fundUsdt(cust.ext, '100.00');
    const w = (await requestWithdraw(cust, '30.00')).json();
    expect((await post(`/withdrawals/${w.id}/complete`, {})).statusCode).toBe(200);
    expect((await post(`/withdrawals/${w.id}/complete`, {})).statusCode).toBe(409);
    expect(await usdtBal(cust.ext)).toBe(70_000_000);
  });

  it('operator reject REFUNDS the full held amount', async () => {
    const cust = await loginCustomer('+5511900010004');
    await fundUsdt(cust.ext, '100.00');
    const w = (await requestWithdraw(cust, '30.00')).json();
    const rej = await post(`/withdrawals/${w.id}/reject`, {});
    expect(rej.statusCode).toBe(200);
    expect(rej.json().status).toBe('rejected');
    expect(await usdtBal(cust.ext)).toBe(100_000_000); // fully refunded
    // completing after a reject is impossible
    expect((await post(`/withdrawals/${w.id}/complete`, {})).statusCode).toBe(409);
  });

  it('customer can cancel their OWN pending request (refund); a stranger cannot', async () => {
    const cust = await loginCustomer('+5511900010005');
    const other = await loginCustomer('+5511900010006');
    await fundUsdt(cust.ext, '100.00');
    const w = (await requestWithdraw(cust, '30.00')).json();
    expect((await post(`/app/usdt/withdrawals/${w.id}/cancel`, {}, { authorization: other.token })).statusCode).toBe(403);
    expect(await usdtBal(cust.ext)).toBe(70_000_000); // still held after the failed foreign cancel
    const cancel = await post(`/app/usdt/withdrawals/${w.id}/cancel`, {}, { authorization: cust.token });
    expect(cancel.statusCode).toBe(200);
    expect(await usdtBal(cust.ext)).toBe(100_000_000); // refunded
  });

  it('rejects an over-balance request without moving money (insufficient funds)', async () => {
    const cust = await loginCustomer('+5511900010007');
    await fundUsdt(cust.ext, '10.00');
    const r = await requestWithdraw(cust, '30.00');
    expect(r.statusCode).toBe(409);
    expect(await usdtBal(cust.ext)).toBe(10_000_000); // untouched
    expect((await get('/withdrawals')).json()).toHaveLength(0);
  });

  it('rejects a below-minimum amount and a blank address (validation)', async () => {
    const cust = await loginCustomer('+5511900010008');
    await fundUsdt(cust.ext, '100.00');
    expect((await requestWithdraw(cust, '1.00')).statusCode).toBe(400); // below 5 USDT min
    expect((await requestWithdraw(cust, '30.00', '')).statusCode).toBe(400); // empty address
    expect(await usdtBal(cust.ext)).toBe(100_000_000); // nothing held
  });
});
