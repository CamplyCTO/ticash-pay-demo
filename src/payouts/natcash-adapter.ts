import { createHash, createHmac, randomUUID } from 'node:crypto';
import { fromMinor } from '../money/money';
import { HttpClient, fetchHttpClient } from '../payments/types';
import { PayoutPort, PayoutRequest, PayoutStatusResult, PayoutSubmitResult, RecipientInfo } from './types';

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

  /**
   * Resolve a NatCash recipient's registered account name for a PRE-SEND confirmation
   * (BenCash requires showing the name when the number is entered). Runs the
   * `requestcashin` INQUIRY only — NO money moves, `confirmcashin` is never called — with
   * a nominal WHOLE-gourde amount and a FRESH correlationId so it never collides with a
   * real payout or a prior lookup ("Invalid requestId, already exists"). Returns valid=false
   * (never throws for a bad number) so the app can just hide the name.
   */
  async verifyRecipient(recipient: string): Promise<RecipientInfo> {
    const probe = await this.probeRequestCashin({
      correlationId: `lookup:${randomUUID()}`,
      recipientRef: recipient,
      amountMinor: 10000n, // nominal 100 HTG (whole) — only to resolve the recipient
      currency: 'HTG',
    });
    const resp = probe.response as { resultCode?: string; error?: string; result?: { receiver?: { accountName?: string; accountCurrency?: string } } };
    const receiver = resp?.result?.receiver;
    const name = receiver?.accountName?.trim() || null;
    if (probe.ok && name) return { valid: true, name, currency: receiver?.accountCurrency ?? null };
    // Distinguish a SERVICE failure (connection error, or a 5xx like the "Invalid PrivateKey"
    // key-desync) from a genuine "no such account" (a clean 4xx recipient rejection) so the app
    // can say "couldn't verify now" instead of wrongly claiming the number is invalid.
    const rc = resp?.resultCode ?? '';
    const serviceError = !!resp?.error || rc === '' || rc.startsWith('5');
    return { valid: false, name: null, currency: receiver?.accountCurrency ?? null, error: serviceError };
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
