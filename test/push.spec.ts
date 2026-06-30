import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { InMemoryPushTokenStore } from '../src/push/push-token-store';
import { LedgerService } from '../src/ledger/service';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { PushService } from '../src/push/push-service';
import { OtpSender } from '../src/auth/otp-sender';
import { PushSender } from '../src/push/push-sender';
import { PushNotification } from '../src/push/types';

interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }
const CFG: AuthConfig = { jwtSecret: 's', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 50 };
class Sender implements OtpSender { readonly name = 'c'; last = ''; async send(_p: string, code: string) { this.last = code; } }
class CapturingPush implements PushSender {
  readonly name = 'cap';
  sent: { tokens: string[]; n: PushNotification }[] = [];
  async send(tokens: string[], n: PushNotification) { this.sent.push({ tokens, n }); }
}

describe('PushService (unit)', () => {
  it('registers, dispatches to a party\'s devices, dedups, and respects opt-out', async () => {
    const authStore = new InMemoryAuthStore();
    const pushStore = new InMemoryPushTokenStore();
    const cap = new CapturingPush();
    const svc = new PushService(pushStore, authStore, cap);
    const u = await authStore.createUser({ role: 'customer', externalId: 'cust-1', phone: '+550001' });

    await svc.register({ userId: u.id, expoToken: 'ExponentPushToken[A]' });
    await svc.register({ userId: u.id, expoToken: 'ExponentPushToken[A]' }); // same token -> upsert, still one
    await svc.register({ userId: u.id, expoToken: 'ExponentPushToken[B]' });
    const n = await svc.dispatchToExternalId('cust-1', { title: 'x', body: 'y' });
    expect(n).toBe(2);
    expect(cap.sent[0]?.tokens.sort()).toEqual(['ExponentPushToken[A]', 'ExponentPushToken[B]']);

    await svc.unregister('ExponentPushToken[A]'); // opt out one device
    cap.sent = [];
    expect(await svc.dispatchToExternalId('cust-1', { title: 'x', body: 'y' })).toBe(1);
    expect(cap.sent[0]?.tokens).toEqual(['ExponentPushToken[B]']);
  });

  it('dispatches nothing for a party with no devices (no throw)', async () => {
    const authStore = new InMemoryAuthStore();
    const cap = new CapturingPush();
    const svc = new PushService(new InMemoryPushTokenStore(), authStore, cap);
    expect(await svc.dispatchToExternalId('nobody', { title: 'x', body: 'y' })).toBe(0);
    expect(cap.sent.length).toBe(0);
  });
});

describe('/app/push + dispatch on money-in (HTTP)', () => {
  let app: ReturnType<typeof buildServer>;
  let otp: Sender;
  let cap: CapturingPush;

  beforeEach(() => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    const registry = new InMemoryRegistryStore();
    const authStore = new InMemoryAuthStore();
    otp = new Sender();
    cap = new CapturingPush();
    app = buildServer({
      ledger,
      registry,
      auth: { service: new AuthService(authStore, registry, otp, CFG) },
      push: { service: new PushService(new InMemoryPushTokenStore(), authStore, cap) },
    });
  });
  const inj = (o: any) => app.inject(o) as unknown as Promise<InjectResponse>;
  const post = (url: string, payload: object, headers?: Record<string, string>) => inj({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });
  // Dispatch is fire-and-forget, so it lands shortly AFTER the HTTP response. Poll.
  const until = async (pred: () => boolean, ms = 500) => {
    const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 5));
  };

  it('register requires auth; a cash-in pushes "money received" to the customer\'s device', async () => {
    // agent
    await post('/agents', { externalId: 'pedro', floatLimit: '100000.00', commissionBps: 0 });
    await post('/agents/pedro/app-login', { phone: '+5511900000100' });
    await post('/app/auth/otp', { phone: '+5511900000100' });
    const agentTok = `Bearer ${(await post('/app/auth/verify', { phone: '+5511900000100', code: otp.last })).json().accessToken}`;
    await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '1000.00', idempotencyKey: 'ft' });
    // customer registers a device
    await post('/app/auth/register', { phone: '+5511900000101' });
    const v = await post('/app/auth/verify', { phone: '+5511900000101', code: otp.last });
    const cust = v.json().user.externalId;
    const custTok = `Bearer ${v.json().accessToken}`;

    expect((await post('/app/push/register', { expoToken: 'ExponentPushToken[CUST]' })).statusCode).toBe(401); // no auth
    expect((await post('/app/push/register', { expoToken: 'ExponentPushToken[CUST]', platform: 'ios' }, { authorization: custTok })).statusCode).toBe(201);

    // agent cashes in -> the customer gets a push (dispatched after the response)
    await post('/app/agent/cash-in', { customerId: cust, currency: 'BRL', amount: '250.00' }, { authorization: agentTok });
    await until(() => cap.sent.length === 1);
    expect(cap.sent.length).toBe(1);
    expect(cap.sent[0]?.tokens).toEqual(['ExponentPushToken[CUST]']);
    expect(cap.sent[0]?.n.body).toContain('250');
    expect(cap.sent[0]?.n.data?.screen).toBe('/(app)/activity');
  });

  it('opt-out stops pushes; a cash-in still succeeds even with no devices', async () => {
    await post('/agents', { externalId: 'pedro', floatLimit: '100000.00', commissionBps: 0 });
    await post('/agents/pedro/app-login', { phone: '+5511900000102' });
    await post('/app/auth/otp', { phone: '+5511900000102' });
    const agentTok = `Bearer ${(await post('/app/auth/verify', { phone: '+5511900000102', code: otp.last })).json().accessToken}`;
    await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '1000.00', idempotencyKey: 'ft2' });
    await post('/app/auth/register', { phone: '+5511900000103' });
    const v = await post('/app/auth/verify', { phone: '+5511900000103', code: otp.last });
    const cust = v.json().user.externalId;
    const custTok = `Bearer ${v.json().accessToken}`;
    await post('/app/push/register', { expoToken: 'ExponentPushToken[D]' }, { authorization: custTok });
    await post('/app/push/unregister', { expoToken: 'ExponentPushToken[D]' }, { authorization: custTok });

    const ci = await post('/app/agent/cash-in', { customerId: cust, currency: 'BRL', amount: '50.00' }, { authorization: agentTok });
    expect(ci.statusCode).toBe(201); // money op succeeds
    await until(() => cap.sent.length > 0, 40); // give any dispatch a chance to land
    expect(cap.sent.length).toBe(0); // but no push (opted out)
  });
});
