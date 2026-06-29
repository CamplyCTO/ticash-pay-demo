import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { LedgerService } from '../src/ledger/service';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { OtpSender } from '../src/auth/otp-sender';
import { signAccessToken } from '../src/auth/tokens';

interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }

const CFG: AuthConfig = { jwtSecret: 'boundary-secret', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 5 };
class NullSender implements OtpSender { readonly name = 'null'; async send(): Promise<void> {} }

let app: ReturnType<typeof buildServer>;
beforeEach(() => {
  const registry = new InMemoryRegistryStore();
  app = buildServer({
    ledger: new LedgerService(new InMemoryLedgerStore()),
    registry,
    auth: { service: new AuthService(new InMemoryAuthStore(), registry, new NullSender(), CFG) },
  });
});
const inj = (url: string, headers?: Record<string, string>) =>
  app.inject({ method: 'GET', url, ...(headers ? { headers } : {}) } as never) as unknown as Promise<InjectResponse>;

describe('/app/* auth boundary cannot be bypassed', () => {
  // The protected route must NEVER return 200 with data unless a valid token was presented.
  // A bypass would show up as statusCode 200 here.
  const tricks = [
    '/app/me',
    '/app/auth/../me',
    '/app/auth/%2e%2e/me',
    '/app/%2e%2e/app/me',
    '/app//me',
    '/APP/me',
    '/app/me/',
    '/app/me%00',
    '/app/me?x=/app/auth/',
    '/app/auth/me',           // public prefix but no such route
    '/./app/me',
  ];
  for (const url of tricks) {
    it(`no token on "${url}" never yields a 200`, async () => {
      const res = await inj(url);
      expect(res.statusCode).not.toBe(200);
      // And must not leak a user/profile body even via an error path.
      expect(res.payload).not.toContain('"role"');
      expect(res.payload).not.toContain('"externalId"');
    });
  }

  it('a VALID token on the canonical path still works (control)', async () => {
    const token = signAccessToken({ sub: 'u1', role: 'customer', ext: 'cust-1' }, CFG.jwtSecret, CFG.accessTtlSec);
    const res = await inj('/app/me', { authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.externalId).toBe('cust-1');
  });

  it('an EXPIRED token is rejected (401)', async () => {
    // Signed 2 hours in the past with a 900s TTL -> long expired.
    const past = Date.now() - 2 * 3600 * 1000;
    const expired = signAccessToken({ sub: 'u1', role: 'customer', ext: 'cust-1' }, CFG.jwtSecret, CFG.accessTtlSec, past);
    const res = await inj('/app/me', { authorization: `Bearer ${expired}` });
    expect(res.statusCode).toBe(401);
  });

  it('a token signed with the WRONG secret is rejected (401)', async () => {
    const forged = signAccessToken({ sub: 'u1', role: 'customer', ext: 'cust-1' }, 'attacker-secret', CFG.accessTtlSec);
    const res = await inj('/app/me', { authorization: `Bearer ${forged}` });
    expect(res.statusCode).toBe(401);
  });

  it('an alg:none style unsigned token is rejected (401)', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'customer', ext: 'cust-1', exp: 9999999999 })}.`;
    const res = await inj('/app/me', { authorization: `Bearer ${noneToken}` });
    expect(res.statusCode).toBe(401);
  });
});
