import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { config } from '../src/config';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { LedgerService } from '../src/ledger/service';

/**
 * CORS for the browser web apps (customer + agent). The allowlist is echoed only
 * for known origins, with credentials enabled, and a preflight OPTIONS is answered
 * before the auth/rate-limit hooks. Native apps / curl send no Origin and must be
 * unaffected.
 */
interface InjectResponse { statusCode: number; headers: Record<string, string | undefined>; payload: string }

const ALLOWED = 'https://app.ticashpay.com';
let app: ReturnType<typeof buildServer>;
// Preserve + restore the process-wide config so other test files aren't affected.
const original = [...config.web.allowedOrigins];

beforeEach(() => {
  (config.web as { allowedOrigins: string[] }).allowedOrigins = [ALLOWED, 'https://agent.ticashpay.com'];
  app = buildServer({ ledger: new LedgerService(new InMemoryLedgerStore()), registry: new InMemoryRegistryStore() });
});
afterEach(() => {
  (config.web as { allowedOrigins: string[] }).allowedOrigins = original;
});

const inject = (o: object) => app.inject(o as never) as unknown as Promise<InjectResponse>;

describe('CORS', () => {
  it('echoes the origin + credentials for an allowed origin on a normal request', async () => {
    const res = await inject({ method: 'GET', url: '/health', headers: { origin: ALLOWED } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['vary']).toContain('Origin');
  });

  it('answers a preflight OPTIONS with 204 + CORS headers, without hitting auth', async () => {
    const res = await inject({
      method: 'OPTIONS', url: '/app/transfers',
      headers: { origin: ALLOWED, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
    });
    expect(res.statusCode).toBe(204); // NOT 401/429 — CORS short-circuits before auth
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('authorization');
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('does NOT send CORS headers for an unknown origin (browser will block)', async () => {
    const res = await inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(200); // server still serves; CORS is browser-enforced
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('is a no-op for non-browser requests (no Origin header)', async () => {
    const res = await inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
