import { createHmac, timingSafeEqual } from 'node:crypto';
import { fromMinor } from '../money/money';
import { HttpClient, fetchHttpClient } from '../payments/types';

/**
 * NOWPayments USDT on-ramp adapter.
 *
 * `createDeposit` opens a crypto payment (POST /v1/payment) and returns the
 * address + amount the user must send. Settlement arrives later as an IPN
 * webhook, authenticated by an HMAC-SHA512 signature over the alphabetically
 * key-sorted JSON body (header `x-nowpayments-sig`). `parseIpn` verifies that
 * signature and returns null on any failure — the caller must 401 and never act
 * on an unverified event.
 *
 * The HTTP layer is injected so every branch is unit-testable without a network.
 * The signature scheme follows NOWPayments' documented method (sorted keys →
 * HMAC-SHA512 hex); PHP's json_encode escapes '/', so we accept BOTH the plain
 * and slash-escaped serialization. The exact byte-encoding is the one thing to
 * smoke-test against a real IPN before go-live (as with the Lytex adapter).
 */
export interface NowPaymentsConfig {
  apiBase: string;
  apiKey: string;
  ipnSecret: string;
  payCurrency: string; // e.g. 'usdttrc20'
  priceCurrency: string; // e.g. 'usd'
}

export interface DepositCreated {
  paymentId: string;
  payAddress: string;
  payAmount: string; // amount of pay_currency the user must send
  payCurrency: string;
  status: string;
  raw: unknown;
}

export interface DepositIpn {
  paymentId: string;
  status: string; // waiting | confirming | confirmed | sending | partially_paid | finished | failed | refunded | expired
  finished: boolean; // true only on 'finished' (fully settled)
  actuallyPaid?: string; // pay_currency amount actually received (for cross-check/logging)
  payCurrency?: string;
  orderId?: string;
  raw: unknown;
}

export class NowPaymentsAdapter {
  readonly name = 'nowpayments';

  constructor(
    private readonly cfg: NowPaymentsConfig,
    private readonly http: HttpClient = fetchHttpClient,
  ) {}

  /** Open a USDT deposit. `amountMinor` is USDT (scale 6). */
  async createDeposit(args: { amountMinor: bigint; orderId: string; callbackUrl: string }): Promise<DepositCreated> {
    const payload = {
      price_amount: Number(fromMinor(args.amountMinor, 'USDT')),
      price_currency: this.cfg.priceCurrency,
      pay_currency: this.cfg.payCurrency,
      order_id: args.orderId,
      order_description: 'Ticash Pay USDT deposit',
      ...(args.callbackUrl ? { ipn_callback_url: args.callbackUrl } : {}),
    };
    const res = await this.http.request({
      url: `${this.cfg.apiBase}/payment`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.cfg.apiKey },
      body: JSON.stringify(payload),
    });
    const body = await parseJson(res.text());
    if (res.status >= 300) {
      throw new NowPaymentsError(`nowpayments createDeposit failed (${res.status}): ${body?.message ?? ''}`, body);
    }
    const paymentId = body?.payment_id;
    const payAddress = body?.pay_address;
    if (!paymentId || !payAddress) throw new NowPaymentsError('nowpayments createDeposit: missing payment_id/pay_address', body);
    return {
      paymentId: String(paymentId),
      payAddress: String(payAddress),
      payAmount: String(body?.pay_amount ?? ''),
      payCurrency: String(body?.pay_currency ?? this.cfg.payCurrency),
      status: String(body?.payment_status ?? 'waiting'),
      raw: body,
    };
  }

  /** Verify + normalise an IPN. Returns null on bad/missing signature or unparseable body. */
  parseIpn(rawBody: string, signature: string | undefined): DepositIpn | null {
    if (!signature || !this.cfg.ipnSecret) return null;
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (!body || typeof body !== 'object') return null;
    if (!this.verifySignature(rawBody, body, signature)) return null;
    const paymentId = body.payment_id != null ? String(body.payment_id) : '';
    if (!paymentId) return null;
    const status = String(body.payment_status ?? '');
    return {
      paymentId,
      status,
      finished: status === 'finished',
      ...(body.actually_paid != null ? { actuallyPaid: String(body.actually_paid) } : {}),
      ...(body.pay_currency ? { payCurrency: String(body.pay_currency) } : {}),
      ...(body.order_id ? { orderId: String(body.order_id) } : {}),
      raw: body,
    };
  }

  /**
   * Accept the signature if it matches ANY plausible NOWPayments serialization —
   * the raw bytes as sent, the alpha-sorted JSON (plain), or the sorted JSON with
   * PHP's default '/' escaping. Each candidate is a full HMAC-SHA512 keyed by the
   * IPN secret, so trying several does NOT weaken security (a forger still needs
   * the secret) — it only makes us robust to their exact encoding.
   */
  private verifySignature(rawBody: string, body: unknown, signature: string): boolean {
    const candidates = [rawBody, stableStringify(body, false), stableStringify(body, true)];
    for (const c of candidates) {
      const expected = createHmac('sha512', this.cfg.ipnSecret).update(c, 'utf8').digest('hex');
      if (constantTimeEqual(expected, signature)) return true;
    }
    return false;
  }
}

export class NowPaymentsError extends Error {
  constructor(message: string, readonly providerBody?: unknown) {
    super(message);
    this.name = 'NowPaymentsError';
  }
}

/**
 * Deterministic JSON with alphabetically-sorted object keys (recursively), to
 * reproduce the bytes NOWPayments signs. `escapeSlash` mirrors PHP json_encode's
 * default of escaping '/' as '\/'. Exported for the signing side in tests.
 */
export function stableStringify(v: unknown, escapeSlash = false): string {
  if (v === null || typeof v !== 'object') {
    const s = JSON.stringify(v);
    return escapeSlash ? s.replace(/\//g, '\\/') : s;
  }
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x, escapeSlash)).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    const key = JSON.stringify(k);
    const encKey = escapeSlash ? key.replace(/\//g, '\\/') : key;
    return `${encKey}:${stableStringify((v as Record<string, unknown>)[k], escapeSlash)}`;
  });
  return `{${parts.join(',')}}`;
}

/** Compute an IPN signature the way NOWPayments does (test/helper). */
export function signIpn(body: unknown, ipnSecret: string, escapeSlash = false): string {
  return createHmac('sha512', ipnSecret).update(stableStringify(body, escapeSlash), 'utf8').digest('hex');
}

async function parseJson(textPromise: Promise<string>): Promise<any> {
  const t = await textPromise;
  if (!t) return {};
  try {
    return JSON.parse(t);
  } catch {
    return { _raw: t };
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
