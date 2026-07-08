import { HttpClient, fetchHttpClient } from '../payments/types';

export type VerifyChannel = 'sms' | 'whatsapp' | 'call';

/**
 * OTP delivery + validation delegated to a provider (Twilio Verify) that generates,
 * sends, and checks the code over provider-managed, region-compliant routes. This is
 * how we deliver login codes reliably in Brazil (raw A2P SMS is heavily filtered
 * there): WhatsApp-first with SMS fallback, one API.
 *
 * When a Verifier is configured, AuthService uses it INSTEAD of generating / storing /
 * sending its own OTP — so the app flow (phone -> code -> verify) is unchanged.
 */
export interface Verifier {
  readonly name: string;
  /** Send a code to `phone`. Returns the channel actually used. */
  start(phone: string, purpose: string): Promise<{ channel: string }>;
  /** Check the code the user entered. true = approved. */
  check(phone: string, code: string): Promise<boolean>;
}

export interface TwilioVerifyConfig {
  accountSid: string;
  authToken: string;
  serviceSid: string; // VA…
  /** Channels tried in order for `start` (e.g. ['whatsapp','sms'] = WhatsApp first, SMS fallback). */
  channels: VerifyChannel[];
}

/**
 * Twilio Verify adapter. Endpoints (confirmed against the Verify v2 API):
 *   POST /v2/Services/{VA}/Verifications        { To, Channel }   -> sends a code
 *   POST /v2/Services/{VA}/VerificationCheck     { To, Code }      -> { status: 'approved' | 'pending' }
 * Auth = HTTP Basic AccountSid:AuthToken. Verify owns the code lifecycle, retries,
 * expiry, and per-number rate limiting, so AuthService doesn't.
 */
export class TwilioVerifier implements Verifier {
  readonly name = 'twilio-verify';
  private readonly base: string;
  private readonly auth: string;
  private readonly channels: VerifyChannel[];

  constructor(private readonly cfg: TwilioVerifyConfig, private readonly http: HttpClient = fetchHttpClient) {
    if (!cfg.accountSid || !cfg.authToken) throw new Error('TwilioVerifier requires accountSid and authToken');
    if (!cfg.serviceSid) throw new Error('TwilioVerifier requires a Verify serviceSid (VA…)');
    this.channels = cfg.channels?.length ? cfg.channels : ['sms'];
    this.base = `https://verify.twilio.com/v2/Services/${encodeURIComponent(cfg.serviceSid)}`;
    this.auth = 'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
  }

  async start(phone: string, _purpose: string): Promise<{ channel: string }> {
    let lastErr: Error | null = null;
    // Try each channel in order: e.g. WhatsApp first, then SMS if WhatsApp is
    // unreachable for this number (no WhatsApp, sender not yet approved, etc.).
    for (const channel of this.channels) {
      try {
        await this.post('/Verifications', { To: phone, Channel: channel });
        return { channel };
      } catch (err) {
        lastErr = err as Error;
      }
    }
    throw lastErr ?? new Error('twilio verify: no channels configured');
  }

  async check(phone: string, code: string): Promise<boolean> {
    try {
      const body = await this.post('/VerificationCheck', { To: phone, Code: code });
      return body.status === 'approved';
    } catch {
      // 404 (no pending verification: expired / already used / max attempts) or any
      // provider error is treated as an invalid code — never a 500 for the user.
      return false;
    }
  }

  private async post(path: string, params: Record<string, string>): Promise<any> {
    const res = await this.http.request({
      url: this.base + path,
      method: 'POST',
      headers: { Authorization: this.auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const raw = await res.text();
    if (res.status < 200 || res.status >= 300) {
      let detail = raw.slice(0, 300);
      try {
        const j = JSON.parse(raw);
        detail = `${j.code ?? res.status}: ${j.message ?? 'verify failed'}`;
      } catch {
        /* non-JSON body */
      }
      throw new Error(`twilio verify ${path} failed (${res.status}) ${detail}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
}
