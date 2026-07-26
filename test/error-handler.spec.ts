import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { LedgerService } from '../src/ledger/service';

interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }

/** Build a server whose balance read throws a given driver error, then GET /balances. */
async function hitWithError(code: string, message: string): Promise<InjectResponse> {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  // Simulate the DB being unreachable mid-request (what Jean saw as a raw ECONNREFUSED).
  (ledger as unknown as { listBalances: () => Promise<unknown> }).listBalances = async () => {
    const e = new Error(message) as Error & { code?: string };
    e.code = code;
    throw e;
  };
  const app = buildServer({ ledger, registry: new InMemoryRegistryStore() });
  return app.inject({ method: 'GET', url: '/balances' }) as unknown as Promise<InjectResponse>;
}

describe('error handler: DB/connection outages return a clean, friendly 503 (no internal-IP leak)', () => {
  it('maps ECONNREFUSED to 503 with a friendly message and no raw host/IP', async () => {
    const r = await hitWithError('ECONNREFUSED', 'connect ECONNREFUSED 10.13.237.139:5432');
    expect(r.statusCode).toBe(503);
    const body = r.json();
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.message).toBe('Serviço temporariamente indisponível. Tente novamente em instantes.');
    // The raw driver text (and the internal IP) must never reach the client.
    expect(r.payload).not.toContain('ECONNREFUSED');
    expect(r.payload).not.toContain('10.13.237.139');
    expect(r.payload).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('maps a Postgres "cannot connect now" SQLSTATE (57P03) to the same friendly 503', async () => {
    const r = await hitWithError('57P03', 'the database system is starting up');
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe('SERVICE_UNAVAILABLE');
  });

  it('does NOT swallow ordinary domain errors (a normal 404 still passes through)', async () => {
    const ledger = new LedgerService(new InMemoryLedgerStore());
    const app = buildServer({ ledger, registry: new InMemoryRegistryStore() });
    const r = (await app.inject({ method: 'GET', url: '/no-such-route' })) as unknown as InjectResponse;
    expect(r.statusCode).toBe(404);
    expect(r.json().code).not.toBe('SERVICE_UNAVAILABLE');
  });
});
