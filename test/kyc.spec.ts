import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { SumsubAdapter, SumsubConfig, normalizeReview } from '../src/kyc/sumsub-adapter';
import { KycService } from '../src/kyc/kyc-service';
import { KycLimits } from '../src/kyc/limits';
import { KycPort } from '../src/kyc/types';
import { HttpClient } from '../src/payments/types';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';

const cfg: SumsubConfig = { base: 'https://sum.test', appToken: 'APP', secretKey: 'SECRET' };
interface Rec { url: string; method: string; headers: Record<string, string>; body?: string }
class FakeHttp implements HttpClient {
  calls: Rec[] = [];
  constructor(private readonly h: (r: Rec) => { status: number; body: string }) {}
  async request(r: Rec) { this.calls.push(r); const x = this.h(r); return { status: x.status, text: async () => x.body }; }
}
const FIXED = 1_700_000_000_000; // fixed clock for deterministic signatures

describe('SumsubAdapter — signing + endpoints', () => {
  it('starts verification: signed POST to accessTokens with NO body', async () => {
    const http = new FakeHttp(() => ({ status: 200, body: JSON.stringify({ token: '_act-sbx-jwt', userId: 'cust-1' }) }));
    const r = await new SumsubAdapter(cfg, http, () => FIXED).startVerification('cust-1', 'id-and-liveness');
    expect(r).toMatchObject({ token: '_act-sbx-jwt', userId: 'cust-1', levelName: 'id-and-liveness' });
    const call = http.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.body).toBeUndefined(); // Sumsub rejects an (even empty) body here
    const ts = String(Math.floor(FIXED / 1000));
    const path = call.url.replace(cfg.base, '');
    const expectSig = createHmac('sha256', 'SECRET').update(ts + 'POST' + path + '').digest('hex');
    expect(call.headers['X-App-Token']).toBe('APP');
    expect(call.headers['X-App-Access-Ts']).toBe(ts);
    expect(call.headers['X-App-Access-Sig']).toBe(expectSig);
  });

  it('reads status and normalizes a GREEN review to approved', async () => {
    const http = new FakeHttp(() => ({ status: 200, body: JSON.stringify({ id: 'app-9', review: { reviewStatus: 'completed', reviewResult: { reviewAnswer: 'GREEN' } } }) }));
    const r = await new SumsubAdapter(cfg, http, () => FIXED).getStatus('cust-1');
    expect(r).toMatchObject({ applicantId: 'app-9', review: 'approved' });
  });

  it('treats a not-found applicant as pending (user has not started yet)', async () => {
    const http = new FakeHttp(() => ({ status: 404, body: JSON.stringify({ description: 'not found' }) }));
    const r = await new SumsubAdapter(cfg, http, () => FIXED).getStatus('cust-x');
    expect(r.review).toBe('pending');
  });

  it('normalizeReview maps the review matrix', () => {
    expect(normalizeReview({ reviewStatus: 'completed', reviewResult: { reviewAnswer: 'GREEN' } })).toBe('approved');
    expect(normalizeReview({ reviewStatus: 'completed', reviewResult: { reviewAnswer: 'RED' } })).toBe('rejected');
    expect(normalizeReview({ reviewStatus: 'pending' })).toBe('review');
    expect(normalizeReview({ reviewStatus: 'init' })).toBe('pending');
    expect(normalizeReview(undefined)).toBe('pending');
  });
});

class FakePort implements KycPort {
  readonly name = 'sumsub';
  constructor(private readonly review: 'approved' | 'rejected' | 'review' | 'pending') {}
  async startVerification(externalUserId: string, levelName: string) { return { token: 'tok', userId: externalUserId, levelName, raw: {} }; }
  async getStatus(externalUserId: string) { return { externalUserId, review: this.review, raw: {} }; }
}

describe('KycService — sync persists the review onto the customer', () => {
  it('approved -> level 2 + approved', async () => {
    const reg = new InMemoryRegistryStore();
    await reg.createCustomer({ externalId: 'cust-1', kycLevel: 0, kycStatus: 'pending' });
    const out = await new KycService(new FakePort('approved'), reg, 'id-and-liveness').sync('cust-1');
    expect(out).toMatchObject({ review: 'approved', kycLevel: 2, kycStatus: 'approved' });
    expect((await reg.getCustomer('cust-1'))!.kycLevel).toBe(2);
  });

  it('rejected -> DROPS to level 0 (a failed check must revoke a prior tier)', async () => {
    const reg = new InMemoryRegistryStore();
    await reg.createCustomer({ externalId: 'cust-2', kycLevel: 2, kycStatus: 'approved' });
    const out = await new KycService(new FakePort('rejected'), reg, 'id-and-liveness').sync('cust-2');
    expect(out).toMatchObject({ review: 'rejected', kycLevel: 0, kycStatus: 'rejected' });
    expect((await reg.getCustomer('cust-2'))!.kycLevel).toBe(0);
  });

  it('review (in-progress) keeps the existing level', async () => {
    const reg = new InMemoryRegistryStore();
    await reg.createCustomer({ externalId: 'cust-3', kycLevel: 1, kycStatus: 'approved' });
    const out = await new KycService(new FakePort('review'), reg, 'id-and-liveness').sync('cust-3');
    expect(out).toMatchObject({ review: 'review', kycLevel: 1 }); // unchanged mid-verification
  });

  it('creates the customer if it does not exist yet', async () => {
    const reg = new InMemoryRegistryStore();
    await new KycService(new FakePort('review'), reg, 'id-and-liveness').sync('newbie');
    expect((await reg.getCustomer('newbie'))!.kycStatus).toBe('review');
  });
});

describe('KycLimits — per-level transaction caps', () => {
  const limits = (reg: InMemoryRegistryStore) => new KycLimits(reg, { 0: 500, 1: 5000, 2: 50000 });

  it('rejects an amount over the level-0 cap (unregistered = level 0)', async () => {
    const reg = new InMemoryRegistryStore();
    await expect(limits(reg).assertWithinLimit('stranger', 60000n /* R$600 */, 'BRL')).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    await expect(limits(reg).assertWithinLimit('stranger', 40000n /* R$400 */, 'BRL')).resolves.toBeUndefined();
  });

  it('allows a large amount for a fully-verified (level 2) customer', async () => {
    const reg = new InMemoryRegistryStore();
    await reg.createCustomer({ externalId: 'vip', kycLevel: 2, kycStatus: 'approved' });
    await expect(limits(reg).assertWithinLimit('vip', 4_000_000n /* R$40000 */, 'BRL')).resolves.toBeUndefined();
    await expect(limits(reg).assertWithinLimit('vip', 6_000_000n /* R$60000 */, 'BRL')).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('exposes the cap table', () => {
    expect(limits(new InMemoryRegistryStore()).table()).toEqual([{ level: 0, cap: 500 }, { level: 1, cap: 5000 }, { level: 2, cap: 50000 }]);
  });
});
