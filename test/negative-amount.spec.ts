import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { InMemoryRateStore } from '../src/fx/rate-store';
import { InMemoryTransferStore } from '../src/transfers/transfer-store';
import { InMemoryP2PStore } from '../src/p2p/p2p-store';
import { LedgerService } from '../src/ledger/service';
import { RateService } from '../src/fx/rate-service';
import { TransferService } from '../src/transfers/transfer-service';
import { P2PService } from '../src/p2p/p2p-service';
import { KycLimits } from '../src/kyc/limits';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { OtpSender } from '../src/auth/otp-sender';
import {
  fundWallet, cashIn, cashOut, agentCashIn, agentCashOut, floatTopup,
  quoteTransfer, transferDebitJournal, p2pLock, usdtWithdrawHold, airtimeTopup,
} from '../src/ledger/operations';

/**
 * Regression guard for the negative-amount money-minting / theft class.
 *
 * A negative business amount used to invert the money flow at the ledger while the
 * journal still netted to zero (reconciliation stayed Σ=0), so `/app/transfers`
 * could mint balance into the caller's own wallet and `/app/agent/cash-in` could
 * drain a funded customer. The whole class is now closed in two places:
 *   - the API edge (money() rejects <= 0), and
 *   - the ledger core (credit()/debit() reject a non-positive magnitude).
 * These tests lock BOTH layers.
 */

// ---- Layer 1: the ledger builders reject non-positive magnitudes ------------
describe('ledger builders reject non-positive amounts (core chokepoint)', () => {
  const key = 'k';
  const cases: Array<[string, () => unknown]> = [
    ['fundWallet', () => fundWallet({ customerId: 'c', currency: 'BRL', amountMinor: -100n, idempotencyKey: key })],
    ['fundWallet(0)', () => fundWallet({ customerId: 'c', currency: 'BRL', amountMinor: 0n, idempotencyKey: key })],
    ['cashIn', () => cashIn({ agentId: 'a', customerId: 'c', currency: 'BRL', amountMinor: -1n, idempotencyKey: key })],
    ['cashOut', () => cashOut({ agentId: 'a', customerId: 'c', currency: 'BRL', amountMinor: -1n, idempotencyKey: key })],
    ['agentCashIn', () => agentCashIn({ agentId: 'a', customerId: 'c', currency: 'BRL', amountMinor: -500n, commissionMinor: 0n, idempotencyKey: key })],
    ['agentCashOut', () => agentCashOut({ agentId: 'a', customerId: 'c', currency: 'BRL', amountMinor: -500n, commissionMinor: 0n, idempotencyKey: key })],
    ['floatTopup', () => floatTopup({ agentId: 'a', currency: 'BRL', amountMinor: -1n, idempotencyKey: key })],
    ['transferDebitJournal', () => transferDebitJournal({
      senderId: 's', correlationId: 'corr', idempotencyKey: key, recipientRef: 'r',
      quote: quoteTransfer({ fromCurrency: 'BRL', toCurrency: 'HTG', sendMinor: -10000n, feeMinor: 0n, rate: '24.36' }),
    })],
    ['p2pLock', () => p2pLock({ merchantId: 'm', currency: 'USDT', amountMinor: -1n, idempotencyKey: key })],
    ['usdtWithdrawHold', () => usdtWithdrawHold({ customerId: 'c', currency: 'USDT', amountMinor: -1n, idempotencyKey: key })],
    ['airtimeTopup', () => airtimeTopup({ customerId: 'c', currency: 'BRL', costMinor: -1n, marginMinor: 0n, idempotencyKey: key })],
  ];
  for (const [name, build] of cases) {
    it(`${name} throws on a non-positive amount`, () => {
      expect(build).toThrow(/positive/i);
    });
  }
});

// ---- Layer 2: the exact HTTP exploits are rejected end to end ----------------
interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }
const CFG: AuthConfig = { jwtSecret: 's', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 50 };
class Sender implements OtpSender { readonly name = 'c'; last = ''; async send(_p: string, code: string) { this.last = code; } }

let app: ReturnType<typeof buildServer>;
let sender: Sender;

beforeEach(() => {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  const registry = new InMemoryRegistryStore();
  sender = new Sender();
  const rateStore = new InMemoryRateStore();
  const rate = new RateService(rateStore);
  app = buildServer({
    ledger,
    registry,
    auth: { service: new AuthService(new InMemoryAuthStore(), registry, sender, CFG) },
    fx: { service: rate, store: rateStore },
    transfers: { service: new TransferService(ledger, new InMemoryTransferStore(), undefined, rate) },
    p2p: { service: new P2PService(ledger, new InMemoryP2PStore(), { asset: 'USDT', commissionBps: 200, confirmWindowMinutes: 30 }) },
    kyc: { limits: new KycLimits(registry, { 0: 500, 1: 5000, 2: 50000 }) },
  });
});

function inj(o: { method: 'GET' | 'POST'; url: string; payload?: object; headers?: Record<string, string> }): Promise<InjectResponse> {
  return app.inject(o as never) as unknown as Promise<InjectResponse>;
}
const post = (url: string, payload: object, headers?: Record<string, string>) => inj({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });
const get = (url: string, headers?: Record<string, string>) => inj({ method: 'GET', url, ...(headers ? { headers } : {}) });
const bal = async (q: string) => Number((await get('/accounts/balance?' + q)).json().balanceMinor);

async function loginCustomer(phone: string) {
  await post('/app/auth/register', { phone });
  const v = await post('/app/auth/verify', { phone, code: sender.last });
  return { token: `Bearer ${v.json().accessToken}`, ext: v.json().user.externalId as string };
}
async function loginAgent(externalId: string, phone: string) {
  await post('/agents', { externalId, floatLimit: '100000.00', commissionBps: 0 });
  await post(`/agents/${externalId}/app-login`, { phone });
  await post('/app/auth/otp', { phone });
  const v = await post('/app/auth/verify', { phone, code: sender.last });
  return `Bearer ${v.json().accessToken}`;
}

describe('negative-amount HTTP exploits are rejected (edge guard)', () => {
  it('a customer CANNOT mint balance via a negative /app/transfers', async () => {
    const { token, ext } = await loginCustomer('+5511990000001');
    const res = await post('/app/transfers',
      { recipientRef: 'Marie', fromCurrency: 'BRL', toCurrency: 'HTG', sendAmount: '-100.00' },
      { authorization: token });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    // Wallet was NEVER credited — the mint is blocked, not just hidden.
    expect(await bal(`ownerType=customer&ownerId=${ext}&kind=wallet&currency=BRL`)).toBe(0);
    const recon = (await get('/reconciliation')).json();
    expect(recon.balanced).toBe(true);
    expect(recon.consistent).toBe(true);
  });

  it('an agent CANNOT drain a funded customer via a negative /app/agent/cash-in', async () => {
    const token = await loginAgent('pedro', '+5511990000010');
    const { ext: victim } = await loginCustomer('+5511990000011');
    await post('/agents/float-topup', { agentId: 'pedro', currency: 'BRL', amount: '5000.00', idempotencyKey: 'ft' });
    // Fund the victim legitimately (within the L0 KYC cap) so a sign-flip drain
    // would have something to steal.
    await post('/app/agent/cash-in', { customerId: victim, currency: 'BRL', amount: '400.00' }, { authorization: token });

    const attack = await post('/app/agent/cash-in',
      { customerId: victim, currency: 'BRL', amount: '-400.00' },
      { authorization: token });

    expect(attack.statusCode).toBeGreaterThanOrEqual(400);
    expect(attack.statusCode).toBeLessThan(500);
    // Victim keeps their R$400; the agent's float did not balloon.
    expect(await bal(`ownerType=customer&ownerId=${victim}&kind=wallet&currency=BRL`)).toBe(40000);
    expect(await bal('ownerType=agent&ownerId=pedro&kind=agent_float&currency=BRL')).toBe(460000);
    expect((await get('/reconciliation')).json().balanced).toBe(true);
  });

  it('still accepts a normal positive transfer (guard is not over-broad)', async () => {
    const token = await loginAgent('pedro2', '+5511990000020');
    const { token: ctoken, ext } = await loginCustomer('+5511990000021');
    await post('/agents/float-topup', { agentId: 'pedro2', currency: 'BRL', amount: '5000.00', idempotencyKey: 'ft2' });
    await post('/app/agent/cash-in', { customerId: ext, currency: 'BRL', amount: '400.00' }, { authorization: token });

    const ok = await post('/app/transfers',
      { recipientRef: 'Marie', fromCurrency: 'BRL', toCurrency: 'HTG', sendAmount: '100.00' },
      { authorization: ctoken });
    expect(ok.statusCode).toBe(201);
  });
});

// ---- The guard must NOT reject legitimate ZERO on non-movement fields --------
// (fee = 0 and "no minimum" = 0 are valid; only actual money MOVEMENTS must be > 0.)
describe('legitimate zero on limit/fee fields is still accepted', () => {
  it('admin transfer accepts an explicit zero fee', async () => {
    // Fund the sender, then transfer with feeAmount "0.00" — a zero platform fee.
    await post('/transactions/fund-wallet', { customerId: 'senderZ', currency: 'BRL', amount: '500.00', idempotencyKey: 'fz' });
    const res = await post('/transactions/transfer', {
      senderId: 'senderZ', recipientRef: 'Marie', fromCurrency: 'BRL', toCurrency: 'HTG',
      sendAmount: '100.00', feeAmount: '0.00', idempotencyKey: 'xfer-zero-fee',
    });
    // Accepted (not a 400 "amount cannot be negative/greater than zero").
    expect(res.statusCode).toBeLessThan(400);
  });

  it('P2P offer accepts minAmount "0" (no floor) but rejects a negative minimum', async () => {
    const seller = await loginCustomer('+5511990000030');
    await post('/transactions/fund-wallet', { customerId: seller.ext, currency: 'USDT', amount: '100.000000', idempotencyKey: 'fu' });

    const ok = await post('/app/p2p/offers', {
      fiatCurrency: 'BRL', pricePerUnit: '6.20', amount: '100.000000', minAmount: '0',
      methods: [{ type: 'moncash', label: 'MonCash', account: '509-1234' }],
    }, { authorization: seller.token });
    expect(ok.statusCode).toBe(201);

    const bad = await post('/app/p2p/offers', {
      fiatCurrency: 'BRL', pricePerUnit: '6.20', amount: '10.000000', minAmount: '-5',
      methods: [{ type: 'moncash', label: 'MonCash', account: '509-1234' }],
    }, { authorization: seller.token });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad.statusCode).toBeLessThan(500);
  });
});
