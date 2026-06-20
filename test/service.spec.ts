import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { LedgerService } from '../src/ledger/service';
import { customerWallet, agentFloat, systemAccount } from '../src/ledger/operations';
import { toMinor } from '../src/money/money';

let svc: LedgerService;
let store: InMemoryLedgerStore;

beforeEach(() => {
  store = new InMemoryLedgerStore();
  svc = new LedgerService(store);
});

const brl = (v: string) => toMinor(v, 'BRL');

describe('LedgerService — core money flows', () => {
  it('funds a wallet and reflects the balance', async () => {
    await svc.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: brl('1240.00'), idempotencyKey: 'fund-1' });
    expect(await svc.getBalance(customerWallet('jean', 'BRL'))).toBe(brl('1240.00'));
    // settlement carries the contra (negative): system "paid out" into the system
    expect(await svc.getBalance(systemAccount('settlement', 'BRL'))).toBe(brl('-1240.00'));
  });

  it('cash-in moves float -> wallet, cash-out reverses', async () => {
    await svc.floatTopup({ agentId: 'pedro', currency: 'BRL', amountMinor: brl('1000.00'), idempotencyKey: 'ft-1' });
    await svc.cashIn({ agentId: 'pedro', customerId: 'souza', currency: 'BRL', amountMinor: brl('250.00'), idempotencyKey: 'ci-1' });
    expect(await svc.getBalance(agentFloat('pedro', 'BRL'))).toBe(brl('750.00'));
    expect(await svc.getBalance(customerWallet('souza', 'BRL'))).toBe(brl('250.00'));

    await svc.cashOut({ agentId: 'pedro', customerId: 'souza', currency: 'BRL', amountMinor: brl('100.00'), idempotencyKey: 'co-1' });
    expect(await svc.getBalance(agentFloat('pedro', 'BRL'))).toBe(brl('850.00'));
    expect(await svc.getBalance(customerWallet('souza', 'BRL'))).toBe(brl('150.00'));
  });

  it('rejects overdraft on a customer wallet', async () => {
    await expect(
      svc.cashOut({ agentId: 'pedro', customerId: 'broke', currency: 'BRL', amountMinor: brl('10.00'), idempotencyKey: 'od-1' }),
    ).rejects.toThrow(/insufficient funds/i);
  });

  it('is idempotent: replaying the same key does not double-post', async () => {
    const args = { customerId: 'jean', currency: 'BRL' as const, amountMinor: brl('500.00'), idempotencyKey: 'dup-1' };
    const a = await svc.fundWallet(args);
    const b = await svc.fundWallet(args); // replay
    expect(a.transactionUid).toBe(b.transactionUid);
    expect(await svc.getBalance(customerWallet('jean', 'BRL'))).toBe(brl('500.00')); // not 1000
  });

  it('runs a cross-currency transfer and settles the payout', async () => {
    await svc.fundWallet({ customerId: 'jean', currency: 'BRL', amountMinor: brl('1240.00'), idempotencyKey: 'fund-jean' });
    const { quote, correlationId } = await svc.initiateTransfer({
      senderId: 'jean',
      recipientRef: 'marie/MonCash',
      fromCurrency: 'BRL',
      toCurrency: 'HTG',
      sendMinor: brl('500.00'),
      feeMinor: brl('12.50'),
      rate: '24.36',
      idempotencyKey: 'xfer-1',
    });
    expect(quote.receiveMinor).toBe(toMinor('12180.00', 'HTG'));
    // sender debited 512.50
    expect(await svc.getBalance(customerWallet('jean', 'BRL'))).toBe(brl('727.50'));
    // fee captured
    expect(await svc.getBalance(systemAccount('fee_revenue', 'BRL'))).toBe(brl('12.50'));
    // HTG parked in payout suspense
    expect(await svc.getBalance(systemAccount('payout_suspense', 'HTG'))).toBe(toMinor('12180.00', 'HTG'));

    await svc.settlePayout({
      currency: 'HTG',
      amountMinor: toMinor('12180.00', 'HTG'),
      correlationId,
      externalRef: 'moncash-abc123',
      idempotencyKey: 'payout-1',
    });
    expect(await svc.getBalance(systemAccount('payout_suspense', 'HTG'))).toBe(0n);
  });
});

describe('reconciliation invariant holds after random sequences', () => {
  it('every currency nets to zero and cache matches sum(postings)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            op: fc.constantFrom('fund', 'topup', 'cashin', 'cashout'),
            amt: fc.integer({ min: 1, max: 100000 }),
          }),
          { minLength: 1, maxLength: 60 },
        ),
        async (events) => {
          const s = new InMemoryLedgerStore();
          const service = new LedgerService(s);
          let i = 0;
          for (const e of events) {
            i++;
            const amountMinor = BigInt(e.amt);
            try {
              if (e.op === 'fund') await service.fundWallet({ customerId: 'c', currency: 'BRL', amountMinor, idempotencyKey: `k${i}` });
              else if (e.op === 'topup') await service.floatTopup({ agentId: 'a', currency: 'BRL', amountMinor, idempotencyKey: `k${i}` });
              else if (e.op === 'cashin') await service.cashIn({ agentId: 'a', customerId: 'c', currency: 'BRL', amountMinor, idempotencyKey: `k${i}` });
              else await service.cashOut({ agentId: 'a', customerId: 'c', currency: 'BRL', amountMinor, idempotencyKey: `k${i}` });
            } catch (err) {
              // overdrafts are legitimately rejected; the ledger must remain consistent
              if (!/insufficient funds/i.test((err as Error).message)) throw err;
            }
          }
          const recon = await service.reconcile();
          expect(recon.balanced).toBe(true);
          expect(recon.consistent).toBe(true);
        },
      ),
    );
  });
});
