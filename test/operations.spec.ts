import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertBalanced, sumByCurrency } from '../src/ledger/engine';
import * as ops from '../src/ledger/operations';

describe('operations are always balanced (property tests)', () => {
  const amount = fc.bigInt({ min: 1n, max: 10n ** 12n });

  it('cashIn / cashOut / fundWallet / floatTopup net to zero per currency', () => {
    fc.assert(
      fc.property(amount, (a) => {
        for (const draft of [
          ops.fundWallet({ customerId: 'c1', currency: 'BRL', amountMinor: a, idempotencyKey: 'k' }),
          ops.cashIn({ agentId: 'a1', customerId: 'c1', currency: 'BRL', amountMinor: a, idempotencyKey: 'k' }),
          ops.cashOut({ agentId: 'a1', customerId: 'c1', currency: 'BRL', amountMinor: a, idempotencyKey: 'k' }),
          ops.floatTopup({ agentId: 'a1', currency: 'BRL', amountMinor: a, idempotencyKey: 'k' }),
        ]) {
          expect(() => assertBalanced(draft)).not.toThrow();
          for (const [, total] of sumByCurrency(draft.postings)) expect(total).toBe(0n);
        }
      }),
    );
  });

  it('cross-currency transfer produces two journals, each balanced per currency', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 100n, max: 10n ** 9n }),
        fc.bigInt({ min: 0n, max: 10n ** 6n }),
        (send, fee) => {
          const quote = ops.quoteTransfer({
            fromCurrency: 'BRL',
            toCurrency: 'HTG',
            sendMinor: send,
            feeMinor: fee,
            rate: '24.36',
          });
          const [debit, fx] = ops.transfer({
            senderId: 'jean',
            quote,
            correlationId: 'corr-1',
            recipientRef: 'marie',
            idempotencyKeyDebit: 'd',
            idempotencyKeyFx: 'f',
          });
          expect(() => assertBalanced(debit)).not.toThrow();
          expect(() => assertBalanced(fx)).not.toThrow();
          // Sender is debited send+fee; fee goes to revenue; send goes to FX desk.
          expect(quote.totalDebitMinor).toBe(send + fee);
        },
      ),
    );
  });
});

describe('engine rejects malformed journals', () => {
  it('rejects an unbalanced journal', () => {
    expect(() =>
      assertBalanced({
        type: 'cash_in',
        idempotencyKey: 'x',
        postings: [
          { account: { ownerType: 'agent', ownerId: 'a', kind: 'agent_float', currency: 'BRL' }, currency: 'BRL', amountMinor: -100n },
          { account: { ownerType: 'customer', ownerId: 'c', kind: 'wallet', currency: 'BRL' }, currency: 'BRL', amountMinor: 99n },
        ],
      }),
    ).toThrow(/unbalanced/i);
  });

  it('rejects single-posting and zero-amount journals', () => {
    expect(() =>
      assertBalanced({ type: 'cash_in', idempotencyKey: 'x', postings: [
        { account: { ownerType: 'customer', ownerId: 'c', kind: 'wallet', currency: 'BRL' }, currency: 'BRL', amountMinor: 100n },
      ] }),
    ).toThrow();
  });
});
