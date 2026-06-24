import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { LedgerService } from '../src/ledger/service';
import { AccountSpec } from '../src/ledger/types';
import { InMemoryPayoutStore } from '../src/payouts/payout-store';
import { PayoutService } from '../src/payouts/payout-service';

interface InjectResponse { statusCode: number; json<T = any>(): T }

// ---- block / disable parties (over HTTP) -----------------------------------

let app: ReturnType<typeof buildServer>;
beforeEach(() => {
  app = buildServer({ ledger: new LedgerService(new InMemoryLedgerStore()), registry: new InMemoryRegistryStore() });
});
const post = (url: string, payload: object) =>
  app.inject({ method: 'POST', url, payload } as never) as unknown as Promise<InjectResponse>;

describe('block / disable parties', () => {
  it('blocks an agent from transacting, then re-activates', async () => {
    await post('/agents', { externalId: 'pedro', floatLimit: '1000.00' });
    expect((await post('/agents/pedro/status', { status: 'blocked' })).statusCode).toBe(200);

    const blocked = await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '100.00', idempotencyKey: 'k1' });
    expect(blocked.statusCode).toBe(403);

    await post('/agents/pedro/status', { status: 'active' });
    const ok = await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '100.00', idempotencyKey: 'k2' });
    expect(ok.statusCode).toBe(200);
  });

  it('blocks a customer from funding/transferring', async () => {
    await post('/customers', { externalId: 'jean' });
    await post('/customers/jean/status', { status: 'blocked' });
    expect((await post('/transactions/fund-wallet', { customerId: 'jean', currency: 'BRL', amount: '10.00', idempotencyKey: 'f1' })).statusCode).toBe(403);
  });

  it('does not block unregistered ids (no party record = allowed)', async () => {
    const r = await post('/transactions/fund-wallet', { customerId: 'stranger', currency: 'BRL', amount: '10.00', idempotencyKey: 'f2' });
    expect(r.statusCode).toBe(200);
  });
});

// ---- manual payout release (no provider) -----------------------------------

const sys = (kind: string, ccy: any): AccountSpec => ({ ownerType: 'system', ownerId: null, kind: kind as any, currency: ccy });
const wallet = (id: string, ccy: any): AccountSpec => ({ ownerType: 'customer', ownerId: id, kind: 'wallet', currency: ccy });

async function manualSetup() {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  await ledger.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: 100000n, idempotencyKey: 'f' });
  const t = await ledger.initiateTransfer({ senderId: 'jean', recipientRef: '50912345678', fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 50000n, feeMinor: 1250n, rate: '24.36', idempotencyKey: 'x' });
  const svc = new PayoutService(undefined, new InMemoryPayoutStore(), ledger); // no provider -> manual mode
  await svc.createForTransfer({ correlationId: t.correlationId, recipientRef: '50912345678', quote: t.quote, senderId: 'jean' });
  return { ledger, svc, correlationId: t.correlationId };
}

describe('manual payout (no provider configured)', () => {
  it('releaseManually settles the ledger and is idempotent', async () => {
    const { ledger, svc, correlationId } = await manualSetup();
    const p = await svc.releaseManually(correlationId, 'natcash-tx-1');
    expect(p.status).toBe('settled');
    expect(p.providerRef).toBe('natcash-tx-1');
    expect(await ledger.getBalance(sys('payout_suspense', 'HTG'))).toBe(0n);
    expect(await ledger.getBalance(sys('settlement', 'HTG'))).toBe(1218000n);
    expect((await ledger.reconcile()).balanced).toBe(true);

    await svc.releaseManually(correlationId); // idempotent
    expect(await ledger.getBalance(sys('settlement', 'HTG'))).toBe(1218000n);
  });

  it('failManually reverses and refunds the sender', async () => {
    const { ledger, svc, correlationId } = await manualSetup();
    const p = await svc.failManually(correlationId);
    expect(p.status).toBe('reversed');
    expect(await ledger.getBalance(wallet('jean', 'BRL'))).toBe(100000n);
    expect((await ledger.reconcile()).balanced).toBe(true);
  });

  it('submit throws without a provider (manual-only mode)', async () => {
    const { svc, correlationId } = await manualSetup();
    await expect(svc.submit(correlationId)).rejects.toThrow(/no payout provider/i);
  });
});
