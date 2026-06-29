import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { LedgerService } from '../src/ledger/service';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { OtpSender } from '../src/auth/otp-sender';

interface InjectResponse {
  statusCode: number;
  payload: string;
  json<T = any>(): T;
}

const CFG: AuthConfig = { jwtSecret: 'http-secret', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 5 };

class CapturingSender implements OtpSender {
  readonly name = 'capture';
  lastCode = '';
  async send(_phone: string, code: string): Promise<void> {
    this.lastCode = code;
  }
}

let app: ReturnType<typeof buildServer>;
let sender: CapturingSender;

beforeEach(() => {
  const registry = new InMemoryRegistryStore();
  sender = new CapturingSender();
  app = buildServer({
    ledger: new LedgerService(new InMemoryLedgerStore()),
    registry,
    auth: { service: new AuthService(new InMemoryAuthStore(), registry, sender, CFG) },
  });
});

function inject(opts: { method: 'GET' | 'POST'; url: string; payload?: object; headers?: Record<string, string> }): Promise<InjectResponse> {
  return app.inject(opts as never) as unknown as Promise<InjectResponse>;
}
const post = (url: string, payload: object, headers?: Record<string, string>) => inject({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });
const get = (url: string, headers?: Record<string, string>) => inject({ method: 'GET', url, ...(headers ? { headers } : {}) });

describe('/app mobile API (in-process)', () => {
  it('register -> verify OTP -> access own profile end to end', async () => {
    const reg = await post('/app/auth/register', { phone: '+5511900000001' });
    expect(reg.statusCode).toBe(201);

    const verify = await post('/app/auth/verify', { phone: '+5511900000001', code: sender.lastCode });
    expect(verify.statusCode).toBe(200);
    const { accessToken, refreshToken } = verify.json();
    expect(accessToken).toBeTruthy();

    const me = await get('/app/me', { authorization: `Bearer ${accessToken}` });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.role).toBe('customer');
    expect(me.json().user.externalId).toBe(verify.json().user.externalId);

    // Refresh works over HTTP and returns a new pair.
    const refreshed = await post('/app/auth/refresh', { refreshToken });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().refreshToken).not.toBe(refreshToken);
  });

  it('rejects protected access with no / bad token (401)', async () => {
    const none = await get('/app/me');
    expect(none.statusCode).toBe(401);
    const bad = await get('/app/me', { authorization: 'Bearer not.a.jwt' });
    expect(bad.statusCode).toBe(401);
  });

  it('maps a wrong OTP to 401', async () => {
    await post('/app/auth/register', { phone: '+5511900000002' });
    // Flip the first digit of the real code -> a well-formed but guaranteed-wrong code.
    const first = sender.lastCode[0] === '0' ? '1' : '0';
    const wrong = first + sender.lastCode.slice(1);
    const verify = await post('/app/auth/verify', { phone: '+5511900000002', code: wrong });
    expect(verify.statusCode).toBe(401);
  });
});
