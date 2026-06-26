import { createHmac } from 'node:crypto';
import { HttpClient, fetchHttpClient } from '../payments/types';
import { KycPort, KycStartResult, KycStatusResult, KycReview } from './types';

/**
 * Sumsub KYC adapter. Auth = signed request:
 *   X-App-Token, X-App-Access-Ts (unix seconds), X-App-Access-Sig = HMAC-SHA256(
 *     secret, ts + METHOD + path + body ).hex
 * (Confirmed against the live sandbox: GET applicant, POST accessTokens with NO body.)
 *
 * NOTE on time: Sumsub rejects a signature whose ts drifts from its server clock. We use
 * Date.now() — correct on an NTP-synced host (Render). `now` is injectable for tests/skew.
 */
export interface SumsubConfig {
  base: string; // https://api.sumsub.com
  appToken: string;
  secretKey: string;
}

export class SumsubAdapter implements KycPort {
  readonly name = 'sumsub';
  constructor(
    private readonly cfg: SumsubConfig,
    private readonly http: HttpClient = fetchHttpClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async startVerification(externalUserId: string, levelName: string): Promise<KycStartResult> {
    const path = `/resources/accessTokens?userId=${encodeURIComponent(externalUserId)}&levelName=${encodeURIComponent(levelName)}&ttlInSecs=600`;
    const b = await this.call('POST', path); // no body
    return { token: String(b.token), userId: String(b.userId ?? externalUserId), levelName, raw: b };
  }

  async getStatus(externalUserId: string): Promise<KycStatusResult> {
    const path = `/resources/applicants/-/one?externalUserId=${encodeURIComponent(externalUserId)}`;
    try {
      const b = await this.call('GET', path);
      return { externalUserId, applicantId: b.id ? String(b.id) : undefined, review: normalizeReview(b.review), levelName: b.levelName, raw: b };
    } catch (err) {
      // Applicant not created yet (user hasn't started the SDK flow) -> still pending.
      if (err instanceof KycError && (err.status === 404 || err.status === 400)) {
        return { externalUserId, review: 'pending', raw: err.body };
      }
      throw err;
    }
  }

  // --- signing + transport --------------------------------------------------

  private async call(method: 'GET' | 'POST', path: string, body = ''): Promise<any> {
    const ts = Math.floor(this.now() / 1000);
    const sig = createHmac('sha256', this.cfg.secretKey).update(ts + method + path + body).digest('hex');
    const headers: Record<string, string> = {
      'X-App-Token': this.cfg.appToken,
      'X-App-Access-Ts': String(ts),
      'X-App-Access-Sig': sig,
      Accept: 'application/json',
    };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await this.http.request({ url: this.cfg.base + path, method, headers, ...(body ? { body } : {}) });
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { _raw: text };
    }
    if (res.status >= 300) throw new KycError(`sumsub ${method} ${path} HTTP ${res.status}: ${json.description ?? ''}`, res.status, json);
    return json;
  }
}

export class KycError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = 'KycError';
  }
}

/** Map Sumsub's review object to our normalized status. */
export function normalizeReview(review: any): KycReview {
  if (!review) return 'pending';
  const status = String(review.reviewStatus ?? '').toLowerCase();
  const answer = String(review.reviewResult?.reviewAnswer ?? '').toUpperCase();
  if (status === 'completed') return answer === 'GREEN' ? 'approved' : answer === 'RED' ? 'rejected' : 'review';
  if (status === 'pending' || status === 'queued' || status === 'onhold') return 'review';
  return 'pending'; // init / not started
}
