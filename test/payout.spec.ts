import { describe, expect, it } from 'vitest';
import { assertBalanced, sumByCurrency } from '../src/ledger/engine';
import * as ops from '../src/ledger/operations';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { LedgerService } from '../src/ledger/service';
import { AccountSpec } from '../src/ledger/types';
import { InMemoryPayoutStore } from '../src/payouts/payout-store';
import { PayoutService } from '../src/payouts/payout-service';
import { MonCashPayoutAdapter, MonCashConfig } from '../src/payouts/moncash-adapter';
import { PayoutPort, PayoutRequest, PayoutStatusResult, PayoutSubmitResult } from '../src/payouts/types';
import { HttpClient } from '../src/payments/types';

// ---- reverseTransfer ledger math -------------------------------------------

describe('reverseTransfer (ledger primitive)', () => {
  it('produces two balanced journals that negate the transfer per currency', () => {
    const quote = ops.quoteTransfer({ fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: 50000n, feeMinor: 1250n, rate: '24.36' });
    const [debit, fx] = ops.transfer({ senderId: 'jean', quote, correlationId: 'c1', recipientRef: 'm', idempotencyKeyDebit: 'd', idempotencyKeyFx: 'f' });
    const [rFx, rDebit] = ops.reverseTransfer({ senderId: 'jean', quote, correlationId: 'c1', idempotencyKeyFx: 'rf', idempotencyKeyDebit: 'rd' });

    for (const j of [rFx, rDebit]) {
      expect(() => assertBalanced(j)).not.toThrow();
      for (const [, total] of sumByCurrency(j.postings)) expect(total).toBe(0n);
    }
    // forward + reverse must cancel to zero on every account/currency.
    const net = new Map<string, bigint>();
    for (const j of [debit, fx, rDebit, rFx]) {
      for (const p of j.postings) {
        const k = `${p.account.kind}:${p.account.currency}`;
        net.set(k, (net.get(k) ?? 0n) + p.amountMinor);
      }
    }
    for (const [, v] of net) expect(v).toBe(0n);
  });
});

// ---- MonCash adapter (faked HTTP) ------------------------------------------

const mcCfg: MonCashConfig = { base: 'https://mc.test', clientId: 'cid', clientSecret: 'csec' };
class FakeHttp implements HttpClient {
  calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  constructor(private readonly handler: (req: any) => { status: number; body: string }) {}
  async request(req: any) {
    this.calls.push(req);
    const r = this.handler(req);
    return { status: r.status, text: async () => r.body };
  }
}

describe('MonCashPayoutAdapter', () => {
  const handler = (req: any) => {
    if (req.url.endsWith('/Api/oauth/token')) return { status: 200, body: JSON.stringify({ access_token: 'tok', token_type: 'bearer', expires_in: 59 }) };
    if (req.url.endsWith('/Api/v1/Transfert')) return { status: 200, body: JSON.stringify({ transfer: { transaction_id: 'mc-1' }, status: 200 }) };
    if (req.url.endsWith('/Api/v1/RetrieveTransactionPayment')) return { status: 200, body: JSON.stringify({ payment: { message: 'successful' } }) };
    return { status: 404, body: '{}' };
  };

  it('authenticates with Basic, sends a payout, returns the provider ref', async () => {
    const http = new FakeHttp(handler);
    const a = new MonCashPayoutAdapter(mcCfg, http, () => 1000);
    const res = await a.sendPayout({ correlationId: 'c1', currency: 'HTG', amountMinor: 1218000n, recipientRef: '50912345678' });
    expect(res.providerRef).toBe('mc-1');

    const auth = http.calls.find((c) => c.url.endsWith('/Api/oauth/token'))!;
    expect(auth.headers.authorization).toBe('Basic ' + Buffer.from('cid:csec').toString('base64'));
    const transfer = http.calls.find((c) => c.url.endsWith('/Api/v1/Transfert'))!;
    expect(transfer.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(transfer.body!)).toMatchObject({ amount: 12180, receiver: '50912345678' }); // gourdes, not cents
  });

  it('maps provider status to pending/success/failed', async () => {
    const ok = new MonCashPayoutAdapter(mcCfg, new FakeHttp(handler), () => 1000);
    expect((await ok.getStatus('mc-1')).state).toBe('success');
    const failHttp = new FakeHttp((req: any) =>
      req.url.endsWith('/Api/oauth/token')
        ? { status: 200, body: JSON.stringify({ access_token: 'tok', expires_in: 59 }) }
        : { status: 200, body: JSON.stringify({ payment: { message: 'transaction failed' } }) },
    );
    expect((await new MonCashPayoutAdapter(mcCfg, failHttp, () => 1000).getStatus('mc-1')).state).toBe('failed');
  });
});

// ---- PayoutService state machine (real ledger) -----------------------------

class FakePort implements PayoutPort {
  readonly name = 'moncash';
  sent = 0;
  constructor(private readonly state: 'success' | 'failed' | 'pending') {}
  async sendPayout(_req: PayoutRequest): Promise<PayoutSubmitResult> {
    this.sent++;
    return { providerRef: 'mc-1', raw: {} };
  }
  async getStatus(): Promise<PayoutStatusResult> {
    return { state: this.state, raw: {} };
  }
}

const sys = (kind: string, currency: any): AccountSpec => ({ ownerType: 'system', ownerId: null, kind: kind as any, currency });
const wallet = (id: string, currency: any): AccountSpec => ({ ownerType: 'customer', ownerId: id, kind: 'wallet', currency });

async function setupTransfer(port: PayoutPort) {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  await ledger.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: 100000n, idempotencyKey: 'fund' });
  const t = await ledger.initiateTransfer({
    senderId: 'jean', recipientRef: '50912345678', fromCurrency: 'BRL', toCurrency: 'HTG',
    sendMinor: 50000n, feeMinor: 1250n, rate: '24.36', idempotencyKey: 'xfer-1',
  });
  const svc = new PayoutService(port, new InMemoryPayoutStore(), ledger);
  await svc.createForTransfer({ correlationId: t.correlationId, recipientRef: '50912345678', quote: t.quote, senderId: 'jean' });
  return { ledger, svc, correlationId: t.correlationId };
}

describe('PayoutService state machine', () => {
  it('success path: submit -> sync -> settled (suspense drained, ledger balanced)', async () => {
    const { ledger, svc, correlationId } = await setupTransfer(new FakePort('success'));
    await svc.submit(correlationId);
    const p = await svc.sync(correlationId);
    expect(p.status).toBe('settled');

    expect(await ledger.getBalance(sys('payout_suspense', 'HTG'))).toBe(0n); // funds left the system
    expect(await ledger.getBalance(sys('settlement', 'HTG'))).toBe(1218000n);
    expect((await ledger.reconcile()).balanced).toBe(true);
  });

  it('failure path: submit -> sync -> reversed (sender refunded, ledger balanced)', async () => {
    const { ledger, svc, correlationId } = await setupTransfer(new FakePort('failed'));
    await svc.submit(correlationId);
    const p = await svc.sync(correlationId);
    expect(p.status).toBe('reversed');

    expect(await ledger.getBalance(wallet('jean', 'BRL'))).toBe(100000n); // fully refunded
    expect(await ledger.getBalance(sys('payout_suspense', 'HTG'))).toBe(0n);
    const recon = await ledger.reconcile();
    expect(recon.balanced && recon.consistent).toBe(true);
  });

  it('is idempotent: re-syncing a settled payout does not double-post', async () => {
    const { ledger, svc, correlationId } = await setupTransfer(new FakePort('success'));
    await svc.submit(correlationId);
    await svc.sync(correlationId);
    await svc.sync(correlationId); // no-op (already settled)
    expect(await ledger.getBalance(sys('settlement', 'HTG'))).toBe(1218000n); // not doubled
  });
});
