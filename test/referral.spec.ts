import { describe, expect, it } from 'vitest';
import { LedgerService } from '../src/ledger/service';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemorySettingsStore } from '../src/settings/settings-store';
import { InMemoryReferralStore } from '../src/referrals/referral-store';
import { ReferralService } from '../src/referrals/referral-service';
import { AccountSpec } from '../src/ledger/types';

const wallet = (id: string, ccy = 'BRL'): AccountSpec => ({ ownerType: 'customer', ownerId: id, kind: 'wallet', currency: ccy as any });
const promo = (ccy = 'BRL'): AccountSpec => ({ ownerType: 'system', ownerId: null, kind: 'promo_expense', currency: ccy as any });

function make() {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  const settings = new InMemorySettingsStore();
  const svc = new ReferralService(new InMemoryReferralStore(), ledger, settings);
  return { ledger, settings, svc };
}

describe('ReferralService — codes', () => {
  it('allocates a stable code and returns the same on repeat', async () => {
    const { svc } = make();
    const a = await svc.codeFor('cust-A');
    const b = await svc.codeFor('cust-A');
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Z2-9]{6}$/); // no 0/O/1/I
  });

  it('gives different owners different codes', async () => {
    const { svc } = make();
    expect(await svc.codeFor('cust-A')).not.toBe(await svc.codeFor('cust-B'));
  });
});

describe('ReferralService — record (signup)', () => {
  it('records a valid referral as pending', async () => {
    const { svc } = make();
    const code = await svc.codeFor('cust-A');
    await svc.record('cust-B', code.toLowerCase()); // case-insensitive
    const info = await svc.infoFor('cust-A');
    expect(info.stats.referredCount).toBe(1);
    expect(info.stats.rewardedCount).toBe(0);
  });

  it('ignores an unknown code', async () => {
    const { svc } = make();
    await svc.record('cust-B', 'ZZZZZZ');
    expect((await svc.infoFor('cust-A')).stats.referredCount).toBe(0);
  });

  it('ignores a self-referral', async () => {
    const { svc } = make();
    const code = await svc.codeFor('cust-A');
    await svc.record('cust-A', code);
    expect((await svc.infoFor('cust-A')).stats.referredCount).toBe(0);
  });

  it('keeps the first referrer when recorded twice', async () => {
    const { svc } = make();
    const a = await svc.codeFor('cust-A');
    const b = await svc.codeFor('cust-B');
    await svc.record('cust-C', a);
    await svc.record('cust-C', b); // should not overwrite
    expect((await svc.infoFor('cust-A')).stats.referredCount).toBe(1);
    expect((await svc.infoFor('cust-B')).stats.referredCount).toBe(0);
  });
});

describe('ReferralService — reward on first transaction', () => {
  it('rewards the referrer once, balanced, and is idempotent', async () => {
    const { svc, ledger } = make();
    const code = await svc.codeFor('cust-A');
    await svc.record('cust-B', code);

    await svc.onReferredUserTransacted('cust-B');
    expect(await ledger.getBalance(wallet('cust-A'))).toBe(500n); // default R$5.00
    expect(await ledger.getBalance(promo())).toBe(-500n);
    expect((await ledger.reconcile()).balanced).toBe(true);

    // Second call must NOT pay again.
    await svc.onReferredUserTransacted('cust-B');
    expect(await ledger.getBalance(wallet('cust-A'))).toBe(500n);

    const info = await svc.infoFor('cust-A');
    expect(info.stats.rewardedCount).toBe(1);
    expect(info.stats.earnedMinor).toEqual({ BRL: '500' });
  });

  it('does nothing for a user who was never referred', async () => {
    const { svc, ledger } = make();
    await svc.onReferredUserTransacted('cust-nobody');
    expect((await ledger.reconcile()).balanced).toBe(true);
    expect(await ledger.getBalance(promo())).toBe(0n);
  });

  it('honors an admin-set bonus amount + currency', async () => {
    const { svc, ledger } = make();
    await svc.setBonus(1000n, 'HTG');
    const code = await svc.codeFor('cust-A');
    await svc.record('cust-B', code);
    await svc.onReferredUserTransacted('cust-B');
    expect(await ledger.getBalance(wallet('cust-A', 'HTG'))).toBe(1000n);
    expect((await ledger.reconcile()).balanced).toBe(true);
  });

  it('pays nothing while the bonus is 0 (paused), leaving it pending', async () => {
    const { svc, ledger } = make();
    await svc.setBonus(0n, 'BRL');
    const code = await svc.codeFor('cust-A');
    await svc.record('cust-B', code);
    await svc.onReferredUserTransacted('cust-B');
    expect(await ledger.getBalance(wallet('cust-A'))).toBe(0n);
    // Re-enable → the still-pending referral now pays.
    await svc.setBonus(500n, 'BRL');
    await svc.onReferredUserTransacted('cust-B');
    expect(await ledger.getBalance(wallet('cust-A'))).toBe(500n);
  });
});

describe('ReferralService — bonus setting', () => {
  it('defaults to R$5.00 BRL and round-trips a change', async () => {
    const { svc } = make();
    expect(await svc.getBonus()).toEqual({ amountMinor: 500n, currency: 'BRL' });
    await svc.setBonus(250n, 'BRL');
    expect(await svc.getBonus()).toEqual({ amountMinor: 250n, currency: 'BRL' });
  });

  it('rejects a negative bonus', async () => {
    const { svc } = make();
    await expect(svc.setBonus(-1n, 'BRL')).rejects.toThrow();
  });
});
