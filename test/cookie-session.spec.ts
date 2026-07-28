import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { config } from '../src/config';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { LedgerService } from '../src/ledger/service';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { OtpSender } from '../src/auth/otp-sender';

/**
 * Web cookie session (WS-2): session creation sets an httpOnly refresh cookie + a
 * readable double-submit CSRF cookie; cookie-based refresh requires a matching CSRF
 * header; logout clears them. With the flag OFF (default) the token-in-body flow is
 * unchanged and NO cookies are set.
 */
interface Cookie { name: string; value: string; httpOnly?: boolean; sameSite?: string; path?: string }
interface InjectResponse { statusCode: number; cookies: Cookie[]; json<T = any>(): T }
const CFG: AuthConfig = { jwtSecret: 's', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 50 };
class Sender implements OtpSender { readonly name = 'c'; last = ''; async send(_p: string, code: string) { this.last = code; } }

const orig = { session: config.web.cookieSession, secure: config.web.cookieSecure };
let app: ReturnType<typeof buildServer>;
let sender: Sender;

function build() {
  sender = new Sender();
  const registry = new InMemoryRegistryStore();
  app = buildServer({
    ledger: new LedgerService(new InMemoryLedgerStore()),
    registry,
    auth: { service: new AuthService(new InMemoryAuthStore(), registry, sender, CFG) },
  });
}
const inj = (o: object) => app.inject(o as never) as unknown as Promise<InjectResponse>;
const post = (url: string, payload: object, headers?: Record<string, string>) => inj({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });
async function signup(phone: string): Promise<InjectResponse> {
  await post('/app/auth/register', { phone });
  return post('/app/auth/verify', { phone, code: sender.last });
}
const val = (res: InjectResponse, name: string) => res.cookies.find((c) => c.name === name)?.value ?? '';

afterEach(() => { (config.web as { cookieSession: boolean }).cookieSession = orig.session; (config.web as { cookieSecure: boolean }).cookieSecure = orig.secure; });

describe('cookie session ON', () => {
  beforeEach(() => { (config.web as { cookieSession: boolean }).cookieSession = true; (config.web as { cookieSecure: boolean }).cookieSecure = false; build(); });

  it('verify sets an httpOnly refresh cookie + a readable csrf cookie', async () => {
    const res = await signup('+5511960000001');
    const rt = res.cookies.find((c) => c.name === 'ticash_rt');
    const csrf = res.cookies.find((c) => c.name === 'ticash_csrf');
    expect(rt?.value).toBeTruthy();
    expect(rt?.httpOnly).toBe(true);      // refresh token not readable by JS
    expect(rt?.path).toBe('/app/auth');    // scoped: only sent on refresh/logout
    expect(csrf?.value).toBeTruthy();
    expect(csrf?.httpOnly).toBeFalsy();    // csrf must be readable to echo in the header
    expect(csrf?.path).toBe('/');          // Path=/ so document.cookie can read it from any page
  });

  it('refresh works from the cookie WITH a matching CSRF header (and rotates the cookie)', async () => {
    const s = await signup('+5511960000002');
    const r = await inj({ method: 'POST', url: '/app/auth/refresh', payload: {}, cookies: { ticash_rt: val(s, 'ticash_rt'), ticash_csrf: val(s, 'ticash_csrf') }, headers: { 'x-ticash-csrf': val(s, 'ticash_csrf') } });
    expect(r.statusCode).toBe(200);
    expect(r.json().accessToken).toBeTruthy();
    expect(r.cookies.find((c) => c.name === 'ticash_rt')?.value).toBeTruthy(); // rotated
  });

  it('refresh from the cookie WITHOUT the CSRF header is rejected (403)', async () => {
    const s = await signup('+5511960000003');
    const r = await inj({ method: 'POST', url: '/app/auth/refresh', payload: {}, cookies: { ticash_rt: val(s, 'ticash_rt'), ticash_csrf: val(s, 'ticash_csrf') } });
    expect(r.statusCode).toBe(403);
  });

  it('a body refresh token still works (native path, no CSRF needed)', async () => {
    const s = await signup('+5511960000004');
    const r = await post('/app/auth/refresh', { refreshToken: s.json().refreshToken });
    expect(r.statusCode).toBe(200);
  });

  it('logout clears the cookies', async () => {
    const s = await signup('+5511960000005');
    const r = await inj({ method: 'POST', url: '/app/auth/logout', payload: {}, cookies: { ticash_rt: val(s, 'ticash_rt') } });
    expect(r.statusCode).toBe(200);
    const rt = r.cookies.find((c) => c.name === 'ticash_rt');
    expect(rt?.value === '' || rt === undefined).toBe(true); // cleared
  });
});

describe('cookie session OFF (default)', () => {
  beforeEach(() => { (config.web as { cookieSession: boolean }).cookieSession = false; build(); });

  it('sets NO cookies and body-token refresh works unchanged', async () => {
    const s = await signup('+5511960000010');
    expect(s.cookies.find((c) => c.name === 'ticash_rt')).toBeUndefined();
    const r = await post('/app/auth/refresh', { refreshToken: s.json().refreshToken });
    expect(r.statusCode).toBe(200);
  });
});
