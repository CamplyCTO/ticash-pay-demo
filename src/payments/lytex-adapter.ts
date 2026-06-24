import { createHmac, timingSafeEqual } from 'node:crypto';
import { Currency } from '../money/currency';
import {
  ChargeRequest,
  ChargeResult,
  HttpClient,
  PaymentEvent,
  PaymentInPort,
  fetchHttpClient,
} from './types';

/**
 * Lytex money-in adapter (Brazil: PIX + credit/debit card + boleto).
 *
 * Auth is OAuth2 client-credentials: we POST clientId/clientSecret to the auth
 * host once and cache the short-lived Bearer token, refreshing before expiry.
 * Charges are created on the API host; settlement arrives later by webhook
 * ("Liquidation"), which `parseWebhook` authenticates and normalises.
 *
 * The HTTP layer is injected (`HttpClient`) so every branch is unit-testable
 * without a network. Field shapes below follow the public Lytex integration
 * (auth flow + invoice schema confirmed from their SDK); the exact invoice
 * payload is the one thing to smoke-test against sandbox before go-live.
 */
export interface LytexConfig {
  authBase: string; // https://sandbox-auth-pay.lytex.com.br
  apiBase: string; // https://sandbox-api-pay.lytex.com.br
  clientId: string;
  clientSecret: string;
  callbackSecret: string; // validates webhooks (signature is in the body — see parseWebhook)
}

const TOKEN_SCOPES = ['client', 'invoice', 'paymentLink', 'product'];
const TOKEN_SKEW_MS = 60_000; // refresh a minute early

export class LytexPaymentAdapter implements PaymentInPort {
  readonly name = 'lytex';
  private token: { value: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly cfg: LytexConfig,
    private readonly http: HttpClient = fetchHttpClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  // --- auth -----------------------------------------------------------------

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAtMs - TOKEN_SKEW_MS > this.now()) {
      return this.token.value;
    }
    const res = await this.http.request({
      url: `${this.cfg.authBase}/v1/oauth/obtain_token`,
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grantType: 'clientCredentials',
        clientId: this.cfg.clientId,
        clientSecret: this.cfg.clientSecret,
        scopes: TOKEN_SCOPES,
      }),
    });
    const body = await parseJson(res.text());
    if (res.status >= 300) {
      throw new PaymentProviderError(`lytex auth failed (${res.status})`, body);
    }
    const data = body?.data ?? body;
    const value = data?.accessToken ?? data?.access_token;
    if (!value) throw new PaymentProviderError('lytex auth: no accessToken in response', body);
    this.token = { value, expiresAtMs: tokenExpiryMs(data, this.now()) };
    return value;
  }

  // --- charge ---------------------------------------------------------------

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    const token = await this.accessToken();
    const digits = req.payer.cpfCnpj.replace(/\D/g, '');
    const payload = {
      client: {
        name: req.payer.name,
        type: digits.length > 11 ? 'pj' : 'pf',
        cpfCnpj: digits,
        ...(req.payer.email ? { email: req.payer.email } : {}),
        ...(req.payer.cellphone ? { cellphone: req.payer.cellphone } : {}),
      },
      // Lytex invoice value is in CENTS (integer minor units) — matches amountMinor for BRL.
      items: [{ name: 'Ticash Pay', quantity: 1, value: Number(req.amountMinor) }],
      dueDate: req.dueDate ?? isoDate(this.now()),
      // Our own reference travels on the invoice so reconciliation can join back.
      referenceId: req.reference,
      paymentMethods: {
        pix: { enable: req.methods.includes('pix') },
        creditCard: { enable: req.methods.includes('creditCard') },
        boleto: { enable: req.methods.includes('boleto') },
      },
    };
    const res = await this.http.request({
      url: `${this.cfg.apiBase}/v2/invoices`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await parseJson(res.text());
    if (res.status >= 300) {
      throw new PaymentProviderError(`lytex createCharge failed (${res.status})`, body);
    }
    const data = body?.data ?? body;
    const providerId = data?._id ?? data?.id;
    if (!providerId) throw new PaymentProviderError('lytex createCharge: no invoice id', body);
    const pix = data?.paymentMethods?.pix ?? {};
    return {
      providerId: String(providerId),
      hashId: data?._hashId ?? data?.hashId,
      status: data?.status ?? 'created',
      pix: {
        // Lytex returns the PIX copy-and-paste (EMV) string as `qrcode` (lowercase c).
        copyPaste: pix.qrcode ?? pix.qrCode ?? pix.copyPaste ?? pix.emv,
        qrCodeImage: pix.qrCodeImage ?? pix.image,
      },
      raw: body,
    };
  }

  // --- webhook --------------------------------------------------------------

  /**
   * Lytex posts the webhook signature INSIDE the JSON body (no header):
   *   { webhookType, data: {...}, signature }
   * where signature = base64( HMAC-SHA256( callbackSecret, JSON.stringify(data) ) ).
   * (Verified by reverse-engineering two real sandbox deliveries.) The invoice id
   * is `data.invoiceId`. Returns null on any verification/parse failure → caller 401s.
   */
  parseWebhook(rawBody: string, _headers: Record<string, string | undefined>): PaymentEvent | null {
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const data = body?.data;
    if (!data || typeof body?.signature !== 'string') return null;
    if (!this.verifyBodySignature(rawBody, body)) return null;

    const providerId = data.invoiceId ?? data._id ?? data.id;
    if (!providerId) return null;
    const webhookType = String(body.webhookType ?? '');
    const status = String(data.status ?? '');
    // Paid only on a clear settlement signal; "dueInvoice"/"waitingPayment" are NOT paid.
    const paid = /paid|received|liquidat|settle|confirm/i.test(webhookType) || /paid|received|liquidat|settled|confirmed/i.test(status);
    const cents = data.invoiceValue ?? data.paidValue ?? data.value;
    return {
      providerId: String(providerId),
      paid,
      event: webhookType || status || 'unknown',
      ...(cents != null ? { amountMinor: BigInt(Math.round(Number(cents))) } : {}),
      currency: 'BRL' as Currency,
      raw: body,
    };
  }

  private verifyBodySignature(rawBody: string, body: any): boolean {
    const secret = this.cfg.callbackSecret;
    if (!secret) return false;
    const sig: string = body.signature;
    // Primary: HMAC over JSON.stringify(data) (re-stringify round-trips to Lytex's bytes).
    const reStringified = createHmac('sha256', secret).update(JSON.stringify(body.data), 'utf8').digest('base64');
    if (constantTimeEqual(sig, reStringified)) return true;
    // Fallback: HMAC over the exact raw `data` substring Lytex sent (robust to any
    // serialization quirk), assuming the conventional `...,"signature":...` tail.
    const i = rawBody.indexOf('"data":');
    const j = rawBody.indexOf(',"signature":');
    if (i >= 0 && j > i) {
      const rawData = rawBody.slice(i + 7, j);
      const overRaw = createHmac('sha256', secret).update(rawData, 'utf8').digest('base64');
      if (constantTimeEqual(sig, overRaw)) return true;
    }
    return false;
  }
}

export class PaymentProviderError extends Error {
  constructor(message: string, readonly providerBody?: unknown) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

// --- helpers ----------------------------------------------------------------

async function parseJson(textPromise: Promise<string>): Promise<any> {
  const t = await textPromise;
  if (!t) return {};
  try {
    return JSON.parse(t);
  } catch {
    return { _raw: t };
  }
}

function tokenExpiryMs(data: any, nowMs: number): number {
  // Prefer an explicit expiry; fall back to a conservative 50 minutes.
  if (data?.expireAt || data?.expiresAt) {
    const t = Date.parse(data.expireAt ?? data.expiresAt);
    if (!Number.isNaN(t)) return t;
  }
  const secs = Number(data?.expireIn ?? data?.expiresIn);
  if (Number.isFinite(secs) && secs > 0) return nowMs + secs * 1000;
  return nowMs + 50 * 60_000;
}

function isoDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
