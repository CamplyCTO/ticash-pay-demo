import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { LedgerService } from '../src/ledger/service';
import { applySecurity, assertSecureConfig, type SecurityConfig } from '../src/api/security';
import Fastify from 'fastify';

interface InjectResponse { statusCode: number; payload: string; headers: Record<string, string>; json<T = any>(): T }

function baseServer() {
  return buildServer({ ledger: new LedgerService(new InMemoryLedgerStore()), registry: new InMemoryRegistryStore() });
}

describe('WS-6 security headers', () => {
  it('sets hardening headers on every response; HSTS only behind TLS', async () => {
    const app = baseServer();
    const plain = (await app.inject({ method: 'GET', url: '/health' })) as unknown as InjectResponse;
    expect(plain.headers['x-content-type-options']).toBe('nosniff');
    expect(plain.headers['x-frame-options']).toBe('DENY');
    expect(plain.headers['referrer-policy']).toBe('no-referrer');
    expect(plain.headers['strict-transport-security']).toBeUndefined(); // no TLS header

    const tls = (await app.inject({ method: 'GET', url: '/health', headers: { 'x-forwarded-proto': 'https' } })) as unknown as InjectResponse;
    expect(tls.headers['strict-transport-security']).toContain('max-age=31536000');
  });
});

describe('WS-6 rate limiting', () => {
  // A tiny isolated app so we can use a low limit deterministically.
  function rlApp(rule: { max: number; windowMs: number }) {
    const app = Fastify({ trustProxy: true });
    const cfg: SecurityConfig = { hsts: 'off', rateLimit: { auth: rule, global: { max: 100000, windowMs: 60000 } } };
    applySecurity(app, cfg);
    app.post('/app/auth/otp', async () => ({ ok: true }));
    app.get('/health', async () => ({ status: 'ok' }));
    return app;
  }

  it('429s the auth surface after the limit, with Retry-After', async () => {
    const app = rlApp({ max: 5, windowMs: 60000 });
    const hit = () => app.inject({ method: 'POST', url: '/app/auth/otp', payload: { phone: '+550001' } }) as unknown as Promise<InjectResponse>;
    for (let i = 0; i < 5; i++) expect((await hit()).statusCode).toBe(200);
    const blocked = await hit();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeTruthy();
  });

  it('never rate-limits /health (platform probes)', async () => {
    const app = rlApp({ max: 2, windowMs: 60000 });
    for (let i = 0; i < 10; i++) {
      const r = (await app.inject({ method: 'GET', url: '/health' })) as unknown as InjectResponse;
      expect(r.statusCode).toBe(200);
    }
  });
});

describe('WS-6 body-size limit', () => {
  it('rejects an oversized request body (413)', async () => {
    const app = baseServer();
    const huge = JSON.stringify({ externalId: 'x'.repeat(300_000) }); // > 256 KiB
    const res = (await app.inject({ method: 'POST', url: '/customers', payload: huge, headers: { 'content-type': 'application/json' } })) as unknown as InjectResponse;
    expect(res.statusCode).toBe(413);
  });
});

describe('WS-6 production config guard', () => {
  const ok = { requireSecureConfig: true, jwtSecret: 'x'.repeat(40), basicAuthUser: 'a', basicAuthPass: 'b', useInMemory: false };

  it('no-ops unless requireSecureConfig is set', () => {
    expect(() => assertSecureConfig({ ...ok, requireSecureConfig: false, jwtSecret: 'dev-insecure-secret-change-me' })).not.toThrow();
  });
  it('passes a secure config', () => {
    expect(() => assertSecureConfig(ok)).not.toThrow();
  });
  it('rejects the dev default secret', () => {
    expect(() => assertSecureConfig({ ...ok, jwtSecret: 'dev-insecure-secret-change-me' })).toThrow(/AUTH_JWT_SECRET/);
  });
  it('rejects a short secret', () => {
    expect(() => assertSecureConfig({ ...ok, jwtSecret: 'short' })).toThrow(/at least 32/);
  });
  it('rejects missing admin basic auth', () => {
    expect(() => assertSecureConfig({ ...ok, basicAuthUser: '' })).toThrow(/BASIC_AUTH/);
  });
  it('rejects the in-memory store in production', () => {
    expect(() => assertSecureConfig({ ...ok, useInMemory: true })).toThrow(/Postgres/);
  });
});
