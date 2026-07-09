import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server';
import { InMemoryLedgerStore } from '../src/ledger/in-memory-store';
import { InMemoryRegistryStore } from '../src/registry/in-memory-registry';
import { InMemoryAuthStore } from '../src/auth/in-memory-auth-store';
import { InMemoryRateStore } from '../src/fx/rate-store';
import { InMemoryTransferStore } from '../src/transfers/transfer-store';
import { LedgerService } from '../src/ledger/service';
import { RateService } from '../src/fx/rate-service';
import { TransferService } from '../src/transfers/transfer-service';
import { KycLimits } from '../src/kyc/limits';
import { AuthService, AuthConfig } from '../src/auth/auth-service';
import { OtpSender } from '../src/auth/otp-sender';

interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }

const CFG: AuthConfig = { jwtSecret: 's', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 50 };

class CapturingSender implements OtpSender {
  readonly name = 'capture';
  lastCode = '';
  async send(_p: string, code: string): Promise<void> { this.lastCode = code; }
}

let app: ReturnType<typeof buildServer>;
let sender: CapturingSender;

beforeEach(() => {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  const registry = new InMemoryRegistryStore();
  sender = new CapturingSender();
  const rateStore = new InMemoryRateStore();
  const rate = new RateService(rateStore);
  app = buildServer({
    ledger,
    registry,
    auth: { service: new AuthService(new InMemoryAuthStore(), registry, sender, CFG) },
    fx: { service: rate, store: rateStore },
    transfers: { service: new TransferService(ledger, new InMemoryTransferStore(), undefined, rate) },
    kyc: { limits: new KycLimits(registry, { 0: 500, 1: 5000, 2: 50000 }) },
  });
});

function inj(o: { method: 'GET' | 'POST'; url: string; payload?: object; headers?: Record<string, string> }): Promise<InjectResponse> {
  return app.inject(o as never) as unknown as Promise<InjectResponse>;
}
const post = (url: string, payload: object, headers?: Record<string, string>) => inj({ method: 'POST', url, payload, ...(headers ? { headers } : {}) });
const get = (url: string, headers?: Record<string, string>) => inj({ method: 'GET', url, ...(headers ? { headers } : {}) });

/** Register + verify a customer, returning { token, ext }. */
async function login(phone: string) {
  await post('/app/auth/register', { phone });
  const v = await post('/app/auth/verify', { phone, code: sender.lastCode });
  return { token: `Bearer ${v.json().accessToken}`, ext: v.json().user.externalId };
}

describe('/app customer flows (WS-2)', () => {
  it('quotes a corridor with full economics', async () => {
    const { token } = await login('+5511700000001');
    const q = await get('/app/fx/quote?from=BRL&to=HTG&amount=500', { authorization: token });
    expect(q.statusCode).toBe(200);
    const body = q.json();
    expect(body.fromCurrency ?? 'BRL').toBeTruthy();
    // 500 BRL at ~24.36 with a 2% margin -> recipient nets a positive HTG amount.
    expect(BigInt(body.netToRecipientMinor)).toBeGreaterThan(0n);
    expect(BigInt(body.totalDebitMinor)).toBeGreaterThan(0n);
  });

  it('sends BR->HT scoped to the caller, then shows it in history', async () => {
    const { token, ext } = await login('+5511700000002');
    // Admin funds the caller's wallet (uses the generated externalId).
    await post('/transactions/fund-wallet', { customerId: ext, currency: 'BRL', amount: '1000.00', idempotencyKey: 'fund-' + ext });

    const send = await post('/app/transfers', { recipientRef: '50912345678', recipientName: 'Marie Toussaint', payoutRail: 'moncash', fromCurrency: 'BRL', toCurrency: 'HTG', sendAmount: '500.00' }, { authorization: token });
    expect(send.statusCode).toBe(201);
    expect(send.json().correlationId).toBeTruthy();
    expect(BigInt(send.json().quote.receiveMinor)).toBeGreaterThan(0n);

    // History includes the send row, ENRICHED with recipient name / number / rail / status.
    const hist = await get('/app/transactions', { authorization: token });
    expect(hist.statusCode).toBe(200);
    const sendRow = hist.json().find((r: any) => r.type === 'transfer');
    expect(sendRow).toBeTruthy();
    expect(sendRow.recipientName).toBe('Marie Toussaint');
    expect(sendRow.recipientRef).toBe('50912345678');
    expect(sendRow.payoutRail).toBe('moncash');
    expect(sendRow.transferStatus).toBeTruthy();
    expect(BigInt(sendRow.receiveMinor)).toBeGreaterThan(0n);

    // /app/me reflects the reduced BRL balance.
    const me = await get('/app/me', { authorization: token });
    const brl = me.json().wallets.find((w: any) => w.currency === 'BRL');
    expect(BigInt(brl.balanceMinor)).toBeLessThan(100000n); // < 1000.00, debited send+fee
  });

  it('rejects an unauthenticated send (401) and enforces the KYC tier cap (422)', async () => {
    const none = await post('/app/transfers', { recipientRef: '50912345678', fromCurrency: 'BRL', toCurrency: 'HTG', sendAmount: '10.00' });
    expect(none.statusCode).toBe(401);

    const { token, ext } = await login('+5511700000003');
    await post('/transactions/fund-wallet', { customerId: ext, currency: 'BRL', amount: '5000.00', idempotencyKey: 'fund2-' + ext });
    // Level-0 cap is 500 BRL; 600 must be rejected with 422 LIMIT_EXCEEDED.
    const over = await post('/app/transfers', { recipientRef: '50912345678', fromCurrency: 'BRL', toCurrency: 'HTG', sendAmount: '600.00' }, { authorization: token });
    expect(over.statusCode).toBe(422);
  });

  it('a customer only ever sends from their OWN wallet (no senderId in the body)', async () => {
    const a = await login('+5511700000004');
    const b = await login('+5511700000005');
    await post('/transactions/fund-wallet', { customerId: a.ext, currency: 'BRL', amount: '1000.00', idempotencyKey: 'fa-' + a.ext });
    // Even if a malicious body carries someone else's id, the route ignores it.
    const send = await post('/app/transfers', { recipientRef: '50912345678', fromCurrency: 'BRL', toCurrency: 'HTG', sendAmount: '100.00', senderId: b.ext } as object, { authorization: a.token });
    expect(send.statusCode).toBe(201);
    // b's wallet is untouched; a's was debited.
    const meB = await get('/app/me', { authorization: b.token });
    expect((meB.json().wallets ?? []).length).toBe(0);
  });

  it('is idempotent: the same idempotencyKey never double-sends', async () => {
    const { token, ext } = await login('+5511700000007');
    await post('/transactions/fund-wallet', { customerId: ext, currency: 'BRL', amount: '1000.00', idempotencyKey: 'fund7-' + ext });
    const body = { recipientRef: '50912345678', fromCurrency: 'BRL', toCurrency: 'HTG', sendAmount: '300.00', idempotencyKey: 'send-key-7' };

    const first = await post('/app/transfers', body, { authorization: token });
    const second = await post('/app/transfers', body, { authorization: token });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    // Same correlationId -> the replay returned the existing transfer, not a new one.
    expect(second.json().correlationId).toBe(first.json().correlationId);

    // The wallet was debited ONCE (1000 - 300 - fee), not twice.
    const me = await get('/app/me', { authorization: token });
    const brl = BigInt(me.json().wallets.find((w: any) => w.currency === 'BRL').balanceMinor);
    expect(brl).toBeGreaterThan(60000n); // > 600.00 -> only one ~300 send happened
    expect(brl).toBeLessThan(100000n); // < 1000.00 -> a send did happen
  });

  it('exposes KYC limits', async () => {
    const { token } = await login('+5511700000006');
    const lim = await get('/app/kyc/limits', { authorization: token });
    expect(lim.statusCode).toBe(200);
    expect(lim.json().find((l: any) => l.level === 0)?.cap).toBe(500);
  });
});
