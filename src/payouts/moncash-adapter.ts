import { fromMinor } from '../money/money';
import { HttpClient, fetchHttpClient } from '../payments/types';
import { PayoutPort, PayoutRequest, PayoutStatusResult, PayoutSubmitResult } from './types';

/**
 * MonCash (Digicel, Haiti) payout adapter.
 *
 * Auth: HTTP Basic (clientId:clientSecret) → short-lived Bearer token
 * (`POST /Api/oauth/token`, ~60s TTL, cached with skew). Disbursement:
 * `POST /Api/v1/Transfert {amount, receiver, desc}`; status:
 * `POST /Api/v1/RetrieveTransactionPayment {transactionId}`. Endpoints follow the
 * official MonCash REST API doc — confirm against sandbox at integration time.
 *
 * ⚠️ Disbursement (paying OUT) needs a separate Digicel agreement; the public API
 * is collection-first. This adapter is built + tested against the documented
 * disbursement endpoint; real money-out is gated on that agreement.
 */
export interface MonCashConfig {
  base: string; // https://sandbox.moncashbutton.digicelgroup.com
  clientId: string;
  clientSecret: string;
}

const TOKEN_SKEW_MS = 10_000; // tokens are short-lived (~60s); refresh early

export class MonCashPayoutAdapter implements PayoutPort {
  readonly name = 'moncash';
  private token: { value: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly cfg: MonCashConfig,
    private readonly http: HttpClient = fetchHttpClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAtMs - TOKEN_SKEW_MS > this.now()) {
      return this.token.value;
    }
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const res = await this.http.request({
      url: `${this.cfg.base}/Api/oauth/token`,
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: 'scope=read,write&grant_type=client_credentials',
    });
    const body = await parseJson(res.text());
    if (res.status >= 300 || !body?.access_token) {
      throw new PayoutProviderError(`moncash auth failed (${res.status})`, body);
    }
    const ttlMs = (Number(body.expires_in) || 59) * 1000;
    this.token = { value: body.access_token, expiresAtMs: this.now() + ttlMs };
    return body.access_token;
  }

  async sendPayout(req: PayoutRequest): Promise<PayoutSubmitResult> {
    const token = await this.accessToken();
    const res = await this.http.request({
      url: `${this.cfg.base}/Api/v1/Transfert`,
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      // MonCash amount is in gourdes (major units); our amountMinor is HTG cents.
      body: JSON.stringify({
        amount: Number(fromMinor(req.amountMinor, req.currency)),
        receiver: req.recipientRef,
        desc: req.desc ?? `Ticash payout ${req.correlationId}`,
      }),
    });
    const body = await parseJson(res.text());
    if (res.status >= 300) throw new PayoutProviderError(`moncash payout failed (${res.status})`, body);
    const transfer = body?.transfer ?? body;
    const providerRef = transfer?.transaction_id ?? transfer?.transactionId ?? transfer?.id;
    if (!providerRef) throw new PayoutProviderError('moncash payout: no transaction id', body);
    return { providerRef: String(providerRef), raw: body };
  }

  async getStatus(providerRef: string): Promise<PayoutStatusResult> {
    const token = await this.accessToken();
    const res = await this.http.request({
      url: `${this.cfg.base}/Api/v1/RetrieveTransactionPayment`,
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ transactionId: providerRef }),
    });
    const body = await parseJson(res.text());
    if (res.status >= 300) {
      // A not-yet-final transaction may 404; treat transport errors as pending.
      return { state: 'pending', raw: body };
    }
    const payment = body?.payment ?? body;
    const message = String(payment?.message ?? payment?.status ?? '').toLowerCase();
    if (/success|complete|paid|transfer/i.test(message)) return { state: 'success', raw: body };
    if (/fail|error|cancel|decline|reject/i.test(message)) return { state: 'failed', raw: body };
    return { state: 'pending', raw: body };
  }
}

export class PayoutProviderError extends Error {
  constructor(message: string, readonly providerBody?: unknown) {
    super(message);
    this.name = 'PayoutProviderError';
  }
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
