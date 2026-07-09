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
import { InMemoryPaymentIntentStore } from '../src/payments/intent-store';
import { InMemoryProviderEventStore } from '../src/payments/event-store';
import { PaymentInPort, ChargeRequest, ChargeResult } from '../src/payments/types';

const CFG: AuthConfig = { jwtSecret: 's', accessTtlSec: 900, refreshTtlSec: 3600, otpTtlSec: 300, otpLength: 6, otpMaxPerHour: 50 };
class CapturingSender implements OtpSender {
  readonly name = 'capture';
  lastCode = '';
  async send(_p: string, code: string): Promise<void> { this.lastCode = code; }
}

/** Fake Lytex-style gateway that records charges and returns a PIX rendering. */
class FakeGateway implements PaymentInPort {
  readonly name = 'fake';
  charges: ChargeRequest[] = [];
  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    this.charges.push(req);
    return { providerId: `inv-${this.charges.length}`, status: 'pending', pix: { copyPaste: 'PIX-EMV-CODE', qrCodeImage: 'imgdata' }, raw: {} };
  }
  parseWebhook(): null { return null; }
}

interface InjectResponse { statusCode: number; payload: string; json<T = any>(): T }
let app: ReturnType<typeof buildServer>;
let sender: CapturingSender;
let gateway: FakeGateway;
let intents: InMemoryPaymentIntentStore;

beforeEach(() => {
  const ledger = new LedgerService(new InMemoryLedgerStore());
  const registry = new InMemoryRegistryStore();
  sender = new CapturingSender();
  gateway = new FakeGateway();
  intents = new InMemoryPaymentIntentStore();
  const rateStore = new InMemoryRateStore();
  const rate = new RateService(rateStore);
  app = buildServer({
    ledger,
    registry,
    auth: { service: new AuthService(new InMemoryAuthStore(), registry, sender, CFG) },
    fx: { service: rate, store: rateStore },
    transfers: { service: new TransferService(ledger, new InMemoryTransferStore(), undefined, rate) },
    kyc: { limits: new KycLimits(registry, { 0: 500, 1: 5000, 2: 50000 }) },
    payments: { gateway, intents, events: new InMemoryProviderEventStore() },
  });
});

const post = (url: string, payload: object, headers?: Record<string, string>) =>
  app.inject({ method: 'POST', url, payload, ...(headers ? { headers } : {}) } as never) as unknown as Promise<InjectResponse>;

async function login(phone: string) {
  await post('/app/auth/register', { phone });
  const v = await post('/app/auth/verify', { phone, code: sender.lastCode });
  return { token: `Bearer ${v.json().accessToken}`, ext: v.json().user.externalId };
}

describe('/app/deposit/pix — self-service PIX deposit', () => {
  it('rejects an unauthenticated deposit', async () => {
    const r = await post('/app/deposit/pix', { amount: '100.00', payerName: 'Jean', payerCpf: '12345678901' });
    expect(r.statusCode).toBe(401);
  });

  it('creates a PIX charge scoped to the caller and returns the code + QR', async () => {
    const { token, ext } = await login('+5511700009001');
    const r = await post('/app/deposit/pix', { amount: '150.50', payerName: '  Jean Wilson  ', payerCpf: '123.456.789-01' }, { authorization: token });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.pix.copyPaste).toBe('PIX-EMV-CODE');
    expect(body.pix.qrCodeImage).toBeTruthy();
    expect(body.amountMinor).toBe('15050'); // R$150.50 in cents

    // The gateway was charged for THIS customer, BRL, PIX, with a digits-only CPF and trimmed name.
    expect(gateway.charges).toHaveLength(1);
    const c = gateway.charges[0]!;
    expect(c.customerId).toBe(ext);
    expect(c.currency).toBe('BRL');
    expect(c.amountMinor).toBe(15050n);
    expect(c.methods).toEqual(['pix']);
    expect(c.payer.name).toBe('Jean Wilson');
    expect(c.payer.cpfCnpj).toBe('12345678901');

    // An intent was recorded so the webhook can credit this wallet on payment.
    const intent = await intents.get(body.providerId);
    expect(intent?.customerId).toBe(ext);
    expect(intent?.amountMinor).toBe(15050n);
  });

  it('rejects a non-positive amount', async () => {
    const { token } = await login('+5511700009002');
    const r = await post('/app/deposit/pix', { amount: '0', payerName: 'Jean', payerCpf: '12345678901' }, { authorization: token });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(gateway.charges).toHaveLength(0);
  });
});
