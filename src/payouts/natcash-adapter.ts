import { createHash, createHmac } from 'node:crypto';
import { fromMinor } from '../money/money';
import { HttpClient, fetchHttpClient } from '../payments/types';
import { PayoutPort, PayoutRequest, PayoutStatusResult, PayoutSubmitResult } from './types';

/**
 * Natcash payout via BenCash "Deposit Channel" (Haiti). A payout is a two-call
 * flow done atomically inside sendPayout:
 *   1. POST /requestcashin  — initialize + fee/recipient inquiry → txId
 *   2. POST /confirmcashin  — confirm (verifyCode empty) → completes the payout
 *
 * Auth (reverse-engineered + verified against the live sandbox):
 *   - header `skml` = privateKey (without it the API returns "Request Failed 46")
 *   - signature = HMAC-SHA256(privateKey, dataString) hex, where dataString is
 *     brace-wrapped `$`-joined `key=value` pairs, prefixed by accessKey = privateKey+requestId:
 *       req:  {accessKey=<ak>$requestId=<id>$toAccountNumber=<to>$amount=<amt>$content=<c>$timestamp=<ts>}
 *       conf: {accessKey=<ak>$requestId=<id>$txId=<tx>$isConfirm=<n>}     (empty verifyCode omitted)
 *   - requestId is an Int32, derived deterministically from correlationId so a retry
 *     reuses it (Natcash can dedupe) rather than risk a double payout.
 */
export interface NatcashConfig {
  base: string; // e.g. https://reseller.test.bencashgroup.com/api/channel
  privateKey: string;
}

export class NatcashPayoutAdapter implements PayoutPort {
  readonly name = 'natcash';

  constructor(
    private readonly cfg: NatcashConfig,
    private readonly http: HttpClient = fetchHttpClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Build the EXACT `requestcashin` request (URL + JSON body + the signed dataString).
   * Extracted so a diagnostic can reproduce precisely what production sends to BenCash
   * WITHOUT posting (no money, no external call). `signedData` contains the accessKey
   * (= privateKey+requestId) in cleartext — callers that surface it must redact the key.
   */
  buildRequestCashin(req: PayoutRequest): {
    url: string;
    requestId: number;
    ak: string;
    signedData: string;
    body: Record<string, unknown>;
  } {
    const requestId = requestIdFor(req.correlationId);
    const ak = this.cfg.privateKey + requestId;
    const amount = Number(fromMinor(req.amountMinor, req.currency)); // HTG major units
    const content = (req.desc ?? 'transfer').replace(/[${}]/g, ' ').slice(0, 60);
    const timestamp = this.now();
    const signedData = `{accessKey=${ak}$requestId=${requestId}$toAccountNumber=${req.recipientRef}$amount=${String(amount)}$content=${content}$timestamp=${timestamp}}`;
    const body = { requestId, toAccountNumber: req.recipientRef, amount, content, timestamp, signature: this.sign(signedData) };
    return { url: `${this.cfg.base}/requestcashin`, requestId, ak, signedData, body };
  }

  async sendPayout(req: PayoutRequest): Promise<PayoutSubmitResult> {
    // --- 1. requestcashin (initialize) ---
    const { requestId, ak, body: reqBody } = this.buildRequestCashin(req);
    const reqResp = await this.post('requestcashin', reqBody);
    if (reqResp.resultCode !== '200' || !reqResp.result?.txId) {
      throw new NatcashError(`requestcashin failed: ${reqResp.message ?? reqResp.resultCode}`, reqResp);
    }
    const txId: string = reqResp.result.txId;

    // --- 2. confirmcashin (complete) ---
    const confData = `{accessKey=${ak}$requestId=${requestId}$txId=${txId}$isConfirm=1}`;
    const confResp = await this.post('confirmcashin', {
      requestId,
      txId,
      verifyCode: '', // always empty per BenCash; omitted from the signature
      isConfirm: '1',
      signature: this.sign(confData),
    });
    if (confResp.resultCode !== '200') {
      throw new NatcashError(`confirmcashin failed: ${confResp.message ?? confResp.resultCode}`, confResp);
    }
    const providerRef = confResp.result?.transactionId ?? confResp.result?.txId ?? txId;
    return { providerRef: String(providerRef), raw: confResp };
  }

  /**
   * DIAGNOSTIC: perform ONLY the `requestcashin` inquiry (API 1) and return BenCash's raw
   * response. It does NOT call `confirmcashin` (API 2), so NO money moves — this is the
   * fee/recipient/signature validation step BenCash asks us to "run again" after a key
   * change. Never throws: connectivity/HTTP errors are returned in the result.
   */
  async probeRequestCashin(req: PayoutRequest): Promise<{ ok: boolean; response: unknown }> {
    try {
      const { body } = this.buildRequestCashin(req);
      const resp = await this.post('requestcashin', body);
      return { ok: resp?.resultCode === '200', response: resp };
    } catch (e) {
      return { ok: false, response: { error: String((e as Error)?.message ?? e) } };
    }
  }

  /**
   * The BenCash doc exposes no status endpoint; a confirmed payout is final and we
   * only reach getStatus after a successful sendPayout, so report success.
   */
  async getStatus(_providerRef: string): Promise<PayoutStatusResult> {
    return { state: 'success', raw: { note: 'natcash payout is synchronous (confirmed at send)' } };
  }

  // --- helpers --------------------------------------------------------------

  private sign(data: string): string {
    return createHmac('sha256', this.cfg.privateKey).update(data, 'utf8').digest('hex');
  }

  private async post(path: string, body: Record<string, unknown>): Promise<any> {
    const res = await this.http.request({
      url: `${this.cfg.base}/${path}`,
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', skml: this.cfg.privateKey },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { _raw: text };
    }
    if (res.status >= 300) {
      // TEMP DIAGNOSTIC (remove after go-live): capture the EXACT request we send +
      // BenCash's response, so BenCash can diagnose their 500. `reqBody` holds the
      // posted JSON (requestId/toAccountNumber/amount/content/timestamp/signature) — the
      // signature is an HMAC digest, NOT the key, and the `skml` header (the key) is
      // deliberately NOT logged. No payer PII.
      try {
        console.log(JSON.stringify({
          audit: 'natcash.error',
          path,
          url: `${this.cfg.base}/${path}`,
          status: res.status,
          reqBody: body,
          respBody: text.slice(0, 1200),
        }));
      } catch { /* ignore */ }
      throw new NatcashError(`natcash ${path} HTTP ${res.status}`, json);
    }
    return json;
  }
}

export class NatcashError extends Error {
  constructor(message: string, readonly providerBody?: unknown) {
    super(message);
    this.name = 'NatcashError';
  }
}

/** Deterministic positive Int32 requestId from a correlationId (stable for retries). */
function requestIdFor(correlationId: string): number {
  const h = createHash('sha256').update(correlationId).digest('hex').slice(0, 8);
  return (parseInt(h, 16) % 1_900_000_000) + 1;
}
