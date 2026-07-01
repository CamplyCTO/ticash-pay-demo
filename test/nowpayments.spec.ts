import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { InMemoryPaymentIntentStore } from '../src/payments/intent-store';
import { InMemoryProviderEventStore } from '../src/payments/event-store';
import { LedgerService } from '../src/ledger/service';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { OtpSender } from '../src/auth/otp-sender';
import { NowPaymentsAdapter, signIpn, stableStringify } from '../src/deposits/nowpayments-adapter';
import type { HttpClient } from '../src/payments/types';

interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }
const CFG: AuthConfig = { jwtSecret: 's', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 50 };
class Sender implements OtpSender { readonly name = 'c'; last = ''; async send(_p: string, code: string) { this.last = code; } }

const NP_CFG = { apiBase: 'https://np.test/v1', apiKey: 'key', ipnSecret: 'ipn-secret-xyz', payCurrency: 'usdttrc20', priceCurrency: 'usd' };
const mockHttp = (response: unknown, status = 200): HttpClient => ({
  async request() { return { status, text: async () => JSON.stringify(response) }; },
});

// ---- adapter unit tests ----------------------------------------------------
describe('NowPaymentsAdapter', () => {
  it('createDeposit posts the amount and returns the pay address', async () => {
    const adapter = new NowPaymentsAdapter(NP_CFG, mockHttp({ payment_id: 55555, pay_address: 'TXabc', pay_amount: 100.5, pay_currency: 'usdttrc20', payment_status: 'waiting' }));
    const r = await adapter.createDeposit({ amountMinor: 100_000000n, orderId: 'dep-1', callbackUrl: 'https://x/webhooks/nowpayments' });
    expect(r.paymentId).toBe('55555');
    expect(r.payAddress).toBe('TXabc');
    expect(r.payAmount).toBe('100.5');
    expect(r.status).toBe('waiting');
  });

  it('createDeposit throws on a provider error', async () => {
    const adapter = new NowPaymentsAdapter(NP_CFG, mockHttp({ message: 'bad currency' }, 400));
    await expect(adapter.createDeposit({ amountMinor: 1_000000n, orderId: 'd', callbackUrl: '' })).rejects.toThrow(/createDeposit failed/);
  });

  it('parseIpn accepts a correctly-signed body and flags finished', () => {
    const adapter = new NowPaymentsAdapter(NP_CFG);
    const body = { payment_id: 55555, payment_status: 'finished', pay_currency: 'usdttrc20', actually_paid: 100.5, order_id: 'dep-1' };
    const sig = signIpn(body, NP_CFG.ipnSecret);
    const ipn = adapter.parseIpn(JSON.stringify(body), sig);
    expect(ipn).not.toBeNull();
    expect(ipn!.finished).toBe(true);
    expect(ipn!.paymentId).toBe('55555');
    expect(ipn!.actuallyPaid).toBe('100.5');
  });

  it('parseIpn rejects a wrong signature, a tampered body, and a missing signature', () => {
    const adapter = new NowPaymentsAdapter(NP_CFG);
    const body = { payment_id: 1, payment_status: 'finished' };
    const sig = signIpn(body, NP_CFG.ipnSecret);
    expect(adapter.parseIpn(JSON.stringify(body), 'deadbeef')).toBeNull(); // wrong sig
    expect(adapter.parseIpn(JSON.stringify({ ...body, payment_status: 'finishedX' }), sig)).toBeNull(); // tampered
    expect(adapter.parseIpn(JSON.stringify(body), undefined)).toBeNull(); // missing sig
  });

  it("parseIpn accepts NOWPayments' PHP-style (slash-escaped) signing", () => {
    const adapter = new NowPaymentsAdapter(NP_CFG);
    const body = { payment_id: 9, payment_status: 'finished', order_description: 'a/b/c' };
    const sig = signIpn(body, NP_CFG.ipnSecret, true); // escapeSlash = PHP json_encode default
    expect(adapter.parseIpn(JSON.stringify(body), sig)).not.toBeNull();
  });

  it('stableStringify sorts keys recursively (deterministic bytes)', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it('non-finished statuses are not flagged finished', () => {
    const adapter = new NowPaymentsAdapter(NP_CFG);
    for (const s of ['waiting', 'confirming', 'confirmed', 'partially_paid', 'expired']) {
      const body = { payment_id: 1, payment_status: s };
      const ipn = adapter.parseIpn(JSON.stringify(body), signIpn(body, NP_CFG.ipnSecret));
      expect(ipn!.finished).toBe(false);
    }
  });
});

// ---- webhook -> wallet credit (integration) --------------------------------
describe('USDT deposit settlement (NOWPayments IPN → wallet)', () => {
  let app: ReturnType<typeof buildServer>;
  let sender: Sender;

  beforeEach(() => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    const registry = new InMemoryRegistryStore();
    sender = new Sender();
    const gateway = new NowPaymentsAdapter(NP_CFG, mockHttp({ payment_id: 55555, pay_address: 'TXabc', pay_amount: 100, pay_currency: 'usdttrc20', payment_status: 'waiting' }));
    app = buildServer({
      ledger,
      registry,
      auth: { service: new AuthService(new InMemoryAuthStore(), registry, sender, CFG) },
      deposits: { gateway, intents: new InMemoryPaymentIntentStore(), events: new InMemoryProviderEventStore(), callbackUrl: 'https://x/webhooks/nowpayments' },
    });
  });

  const inj = (o: any) => app.inject(o) as unknown as Promise<InjectResponse>;
  const post = (url: string, payload: object, headers?: Record<string, string>) => inj({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });
  const get = (url: string) => inj({ method: 'GET', url });
  const bal = async (id: string) => Number((await get(`/accounts/balance?ownerType=customer&ownerId=${id}&kind=wallet&currency=USDT`)).json().balanceMinor);

  async function loginCustomer(phone: string): Promise<{ ext: string; token: string }> {
    const r = await post('/app/auth/register', { phone });
    const ext = r.json().user.externalId as string;
    await post('/app/auth/otp', { phone });
    const v = await post('/app/auth/verify', { phone, code: sender.last });
    return { ext, token: `Bearer ${v.json().accessToken}` };
  }
  const ipn = (body: object, secret = NP_CFG.ipnSecret) => post('/webhooks/nowpayments', body, { 'x-nowpayments-sig': signIpn(body, secret) });

  it('create deposit → signed finished IPN credits the USDT wallet, and Σ=0', async () => {
    const me = await loginCustomer('+5511700000001');
    const created = await post('/app/usdt/deposit', { amount: '100' }, { authorization: me.token });
    expect(created.statusCode).toBe(201);
    expect(created.json().payAddress).toBe('TXabc');
    expect(created.json().paymentId).toBe('55555');
    expect(await bal(me.ext)).toBe(0); // nothing credited until settlement

    const res = await ipn({ payment_id: 55555, payment_status: 'finished', pay_currency: 'usdttrc20', actually_paid: 100, order_id: `dep-${me.ext}-x` });
    expect(res.statusCode).toBe(200);
    expect(await bal(me.ext)).toBe(100_000000); // 100 USDT credited

    const recon = (await get('/reconciliation')).json();
    expect(recon.balanced).toBe(true);
    expect(recon.consistent).toBe(true);
  });

  it('a forged/invalid signature is rejected with 401 and never credits', async () => {
    const me = await loginCustomer('+5511700000002');
    await post('/app/usdt/deposit', { amount: '100' }, { authorization: me.token });
    const res = await post('/webhooks/nowpayments', { payment_id: 55555, payment_status: 'finished' }, { 'x-nowpayments-sig': 'forged' });
    expect(res.statusCode).toBe(401);
    expect(await bal(me.ext)).toBe(0);
  });

  it('a redelivered finished IPN does not double-credit', async () => {
    const me = await loginCustomer('+5511700000003');
    await post('/app/usdt/deposit', { amount: '100' }, { authorization: me.token });
    const body = { payment_id: 55555, payment_status: 'finished', pay_currency: 'usdttrc20', actually_paid: 100 };
    expect((await ipn(body)).statusCode).toBe(200);
    const dup = await ipn(body);
    expect(dup.json().duplicate).toBe(true);
    expect(await bal(me.ext)).toBe(100_000000); // still just one credit
  });

  it('non-finished statuses are acknowledged but do not credit', async () => {
    const me = await loginCustomer('+5511700000004');
    await post('/app/usdt/deposit', { amount: '100' }, { authorization: me.token });
    for (const s of ['waiting', 'confirming', 'partially_paid']) {
      const res = await ipn({ payment_id: 55555, payment_status: s });
      expect(res.statusCode).toBe(200);
      expect(res.json().ignored).toBe(s);
    }
    expect(await bal(me.ext)).toBe(0);
  });

  it('an IPN for an unknown payment is acknowledged without crashing', async () => {
    const res = await ipn({ payment_id: 999999, payment_status: 'finished' });
    expect(res.statusCode).toBe(200);
    expect(res.json().unmatched).toBe('999999');
  });
});
