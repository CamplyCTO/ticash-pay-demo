import { describe, expect, it } from 'vitest';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { OtpSender } from '../src/auth/otp-sender';
import { Verifier } from '../src/auth/verifier';
import { verifyAccessToken } from '../src/auth/tokens';

const CFG: AuthConfig = {
  jwtSecret: 'test-secret',
  accessTtlSec: 900,
  refreshTtlSec: 3600,
  otpTtlSec: 300,
  otpLength: 6,
  otpMaxPerHour: 3,
};

/** Capturing sender so tests can read the OTP that would have been texted. */
class CapturingSender implements OtpSender {
  readonly name = 'capture';
  last: { phone: string; code: string; purpose: string } | null = null;
  codes: string[] = [];
  async send(phone: string, code: string, purpose: string): Promise<void> {
    this.last = { phone, code, purpose };
    this.codes.push(code);
  }
}

function build(nowRef = { ms: Date.UTC(2026, 0, 1) }) {
  const store = new InMemoryAuthStore();
  const registry = new InMemoryRegistryStore();
  const sender = new CapturingSender();
  const svc = new AuthService(store, registry, sender, CFG, () => nowRef.ms);
  return { store, registry, sender, svc, nowRef };
}

describe('AuthService — customer signup + OTP login', () => {
  it('self-signup creates a customers row, sends an OTP, and logs in', async () => {
    const { svc, registry, sender } = build();
    const { user } = await svc.registerCustomer({ phone: '+5511999990000' });
    expect(user.role).toBe('customer');

    // The signup created a real customer party (not just a login link).
    const customer = await registry.getCustomer(user.externalId);
    expect(customer).not.toBeNull();
    expect(sender.last?.purpose).toBe('signup');

    const code = sender.last!.code;
    const tokens = await svc.verifyOtp({ phone: '+5511999990000', code });
    expect(tokens.user.externalId).toBe(user.externalId);

    // The access token is a valid HS256 JWT scoped to the caller's external_id.
    const claims = verifyAccessToken(tokens.accessToken, CFG.jwtSecret, Date.UTC(2026, 0, 1));
    expect(claims).toMatchObject({ sub: user.id, role: 'customer', ext: user.externalId });
  });

  it('rejects a wrong or reused OTP code', async () => {
    const { svc, sender } = build();
    await svc.registerCustomer({ phone: '+550001' });
    const good = sender.last!.code;

    await expect(svc.verifyOtp({ phone: '+550001', code: '000000-wrong' })).rejects.toMatchObject({ code: 'INVALID_OTP' });
    await svc.verifyOtp({ phone: '+550001', code: good }); // consume it
    await expect(svc.verifyOtp({ phone: '+550001', code: good })).rejects.toMatchObject({ code: 'INVALID_OTP' });
  });

  it('expires an OTP after its TTL', async () => {
    const nowRef = { ms: Date.UTC(2026, 0, 1) };
    const { svc, sender } = build(nowRef);
    await svc.registerCustomer({ phone: '+550002' });
    const code = sender.last!.code;
    nowRef.ms += (CFG.otpTtlSec + 1) * 1000; // jump past expiry
    await expect(svc.verifyOtp({ phone: '+550002', code })).rejects.toMatchObject({ code: 'INVALID_OTP' });
  });

  it('rejects duplicate phone signup', async () => {
    const { svc } = build();
    await svc.registerCustomer({ phone: '+550003' });
    await expect(svc.registerCustomer({ phone: '+550003' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rate-limits OTP requests per phone', async () => {
    const { svc } = build();
    await svc.registerCustomer({ phone: '+550004' }); // 1 OTP sent
    await svc.requestOtp('+550004'); // 2
    await svc.requestOtp('+550004'); // 3 (== max)
    await expect(svc.requestOtp('+550004')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('AuthService — refresh rotation + logout', () => {
  it('rotates the refresh token and invalidates the old one', async () => {
    const { svc, sender } = build();
    await svc.registerCustomer({ phone: '+550005' });
    const first = await svc.verifyOtp({ phone: '+550005', code: sender.last!.code });

    const rotated = await svc.refresh(first.refreshToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    // The old refresh token no longer works after rotation.
    await expect(svc.refresh(first.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH' });
    // The new one does.
    const again = await svc.refresh(rotated.refreshToken);
    expect(again.accessToken).toBeTruthy();
  });

  it('logout revokes the session', async () => {
    const { svc, sender } = build();
    await svc.registerCustomer({ phone: '+550006' });
    const tokens = await svc.verifyOtp({ phone: '+550006', code: sender.last!.code });
    await svc.logout(tokens.refreshToken);
    await expect(svc.refresh(tokens.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH' });
  });
});

describe('AuthService — agents are admin-provisioned', () => {
  it('provisions an existing agent and logs them in; unknown agent is rejected', async () => {
    const { svc, registry, sender } = build();
    await expect(svc.provisionAgentLogin('pedro', '+550007')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await registry.createAgent({ externalId: 'pedro' });
    const user = await svc.provisionAgentLogin('pedro', '+550007');
    expect(user).toMatchObject({ role: 'agent', externalId: 'pedro' });

    await svc.requestOtp('+550007');
    const tokens = await svc.verifyOtp({ phone: '+550007', code: sender.last!.code });
    expect(tokens.user.role).toBe('agent');
  });
});

describe('AuthStore guards (one-time use + reuse-safety)', () => {
  it('consumeOtp succeeds once then fails (one-time use)', async () => {
    const store = new InMemoryAuthStore();
    const now = '2026-01-01T00:00:00.000Z';
    const exp = '2026-01-01T00:05:00.000Z';
    await store.saveOtp({ phone: '+1', codeHash: 'h', purpose: 'login', expiresAt: exp });
    expect(await store.consumeOtp('+1', 'h', now)).toBe(true);
    expect(await store.consumeOtp('+1', 'h', now)).toBe(false); // already consumed
  });

  it('consumeOtp fails once expired', async () => {
    const store = new InMemoryAuthStore();
    await store.saveOtp({ phone: '+2', codeHash: 'h', purpose: 'login', expiresAt: '2026-01-01T00:05:00.000Z' });
    expect(await store.consumeOtp('+2', 'h', '2026-01-01T00:06:00.000Z')).toBe(false);
  });

  it('rotateSession only rotates for the current hash, not a stale one', async () => {
    const store = new InMemoryAuthStore();
    const s = await store.createSession({ userId: 'u', refreshTokenHash: 'old', expiresAt: '2026-12-31T00:00:00.000Z' });
    expect(await store.rotateSession(s.id, 'old', 'new', '2027-01-01T00:00:00.000Z')).toBe(true);
    // Replaying the stale hash must not rotate again (reuse rejected).
    expect(await store.rotateSession(s.id, 'old', 'newer', '2027-01-01T00:00:00.000Z')).toBe(false);
    expect(await store.rotateSession(s.id, 'new', 'newer', '2027-01-01T00:00:00.000Z')).toBe(true);
  });

  it('rotateSession refuses a revoked session', async () => {
    const store = new InMemoryAuthStore();
    const s = await store.createSession({ userId: 'u', refreshTokenHash: 'old', expiresAt: '2026-12-31T00:00:00.000Z' });
    await store.revokeSession(s.id, '2026-06-01T00:00:00.000Z');
    expect(await store.rotateSession(s.id, 'old', 'new', '2027-01-01T00:00:00.000Z')).toBe(false);
  });
});

describe('AuthService — blocked users', () => {
  it('blocks OTP verification for a blocked user', async () => {
    const { svc, store, sender } = build();
    const { user } = await svc.registerCustomer({ phone: '+550008' });
    const code = sender.last!.code;
    // Block the login directly in the store.
    const blocked = await store.getUserById(user.id);
    (blocked as { status: string }).status = 'blocked';
    await expect(svc.verifyOtp({ phone: '+550008', code })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('AuthService — provider-managed OTP (Twilio Verify branch)', () => {
  /** Fake Verifier: records sends, approves a single expected code. */
  class FakeVerifier implements Verifier {
    readonly name = 'fake-verify';
    starts: { phone: string; purpose: string }[] = [];
    constructor(private readonly expectedCode = '424242') {}
    async start(phone: string, purpose: string) {
      this.starts.push({ phone, purpose });
      return { channel: 'sms' };
    }
    async check(_phone: string, code: string) {
      return code === this.expectedCode;
    }
  }

  function buildWithVerifier() {
    const store = new InMemoryAuthStore();
    const registry = new InMemoryRegistryStore();
    const sender = new CapturingSender();
    const verifier = new FakeVerifier();
    const svc = new AuthService(store, registry, sender, CFG, () => Date.UTC(2026, 0, 1), verifier);
    return { store, registry, sender, verifier, svc };
  }

  it('delegates send to the verifier and never touches the local OTP sender/store', async () => {
    const { svc, sender, verifier, store } = buildWithVerifier();
    const { user } = await svc.registerCustomer({ phone: '+5511988887777' });

    // Verify was asked to send; the local SMS sender was NOT used.
    expect(verifier.starts).toEqual([{ phone: '+5511988887777', purpose: 'signup' }]);
    expect(sender.last).toBeNull();
    // No local OTP row was written (the provider owns the code).
    expect(await store.countOtpsSince('+5511988887777', new Date(0).toISOString())).toBe(0);
    expect(user.role).toBe('customer');
  });

  it('logs in when the verifier approves the code, and rejects a wrong code', async () => {
    const { svc } = buildWithVerifier();
    await svc.registerCustomer({ phone: '+5511988887777' });

    await expect(svc.verifyOtp({ phone: '+5511988887777', code: '000000' })).rejects.toMatchObject({ code: 'INVALID_OTP' });
    const tokens = await svc.verifyOtp({ phone: '+5511988887777', code: '424242' });
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.user.phone).toBe('+5511988887777');
  });
});
