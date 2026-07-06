import { HttpClient, fetchHttpClient } from '../payments/types';
import { OtpSender } from './otp-sender';

/**
 * Twilio SMS adapter for OTP delivery. Same ports-and-adapters pattern as the
 * payment/airtime providers — swaps in for ConsoleOtpSender once the client has
 * a Twilio account (they create it, send us the SID + token; we set env vars).
 *
 * Endpoint (confirmed against Twilio's REST API):
 *   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
 *   Auth:  HTTP Basic  AccountSid:AuthToken
 *   Body:  application/x-www-form-urlencoded  To, Body, and (From | MessagingServiceSid)
 *   OK:    201 Created  { sid, status, error_code, ... }
 *
 * We keep our own OTP generation/expiry/rate-limiting (in AuthService) and use
 * Twilio purely as the delivery channel, so this stays a thin, replaceable send().
 */
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** A Twilio phone number in E.164 (e.g. +15551234567). Used when no messaging service is set. */
  from?: string;
  /** Optional Messaging Service SID (MG…). Preferred over `from` when present (sender pool/compliance). */
  messagingServiceSid?: string;
  /** Override the SMS template. `{code}` is substituted. Defaults to a PT-BR login message. */
  template?: string;
}

const DEFAULT_TEMPLATE = 'Ticash Pay: seu codigo e {code}. Valido por 5 minutos. Nao compartilhe.';

export class TwilioOtpSender implements OtpSender {
  readonly name = 'twilio';
  private readonly url: string;
  private readonly auth: string;

  constructor(
    private readonly cfg: TwilioConfig,
    private readonly http: HttpClient = fetchHttpClient,
  ) {
    if (!cfg.accountSid || !cfg.authToken) {
      throw new Error('TwilioOtpSender requires accountSid and authToken');
    }
    if (!cfg.from && !cfg.messagingServiceSid) {
      throw new Error('TwilioOtpSender requires either `from` or `messagingServiceSid`');
    }
    this.url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
    this.auth = 'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
  }

  async send(phone: string, code: string, _purpose: string): Promise<void> {
    const body = (this.cfg.template ?? DEFAULT_TEMPLATE).replace('{code}', code);
    const form = new URLSearchParams({ To: phone, Body: body });
    if (this.cfg.messagingServiceSid) form.set('MessagingServiceSid', this.cfg.messagingServiceSid);
    else form.set('From', this.cfg.from as string);

    const res = await this.http.request({
      url: this.url,
      method: 'POST',
      headers: {
        Authorization: this.auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    const raw = await res.text();
    if (res.status < 200 || res.status >= 300) {
      // Twilio returns a JSON error body { code, message, ... }; surface it without
      // leaking the auth header. Never include the OTP code in the thrown message.
      let detail = raw.slice(0, 300);
      try {
        const j = JSON.parse(raw);
        detail = `${j.code ?? res.status}: ${j.message ?? 'send failed'}`;
      } catch {
        /* non-JSON error body — use the truncated raw text */
      }
      throw new Error(`twilio send failed (${res.status}) ${detail}`);
    }
  }
}
