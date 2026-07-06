import { describe, expect, it } from 'vitest';
import { TwilioOtpSender, TwilioConfig } from '../src/auth/twilio-otp-sender';
import { HttpClient } from '../src/payments/types';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
class FakeHttp implements HttpClient {
  calls: Recorded[] = [];
  constructor(private readonly handler: (req: Recorded) => { status: number; body: string }) {}
  async request(req: Recorded) {
    this.calls.push(req);
    const r = this.handler(req);
    return { status: r.status, text: async () => r.body };
  }
}

const cfg: TwilioConfig = {
  accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  authToken: 'tok-secret',
  from: '+15551230000',
};
const ok = () => ({ status: 201, body: JSON.stringify({ sid: 'SM1', status: 'queued', error_code: null }) });

describe('TwilioOtpSender', () => {
  it('posts a form-encoded SMS to the Twilio Messages endpoint with basic auth', async () => {
    const http = new FakeHttp(ok);
    const sender = new TwilioOtpSender(cfg, http);
    await sender.send('+5511999998888', '123456', 'login');

    expect(http.calls).toHaveLength(1);
    const call = http.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
    );
    expect(call.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    // Basic auth = base64(sid:token), never the raw token
    expect(call.headers.Authorization).toBe(
      'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64'),
    );
    const form = new URLSearchParams(call.body);
    expect(form.get('To')).toBe('+5511999998888');
    expect(form.get('From')).toBe('+15551230000');
    expect(form.get('Body')).toContain('123456');
    expect(form.get('MessagingServiceSid')).toBeNull();
  });

  it('prefers MessagingServiceSid over From when both are set', async () => {
    const http = new FakeHttp(ok);
    const sender = new TwilioOtpSender({ ...cfg, messagingServiceSid: 'MGabc' }, http);
    await sender.send('+509123456', '999000', 'login');
    const form = new URLSearchParams(http.calls[0]!.body);
    expect(form.get('MessagingServiceSid')).toBe('MGabc');
    expect(form.get('From')).toBeNull();
  });

  it('applies a custom template with {code} substitution', async () => {
    const http = new FakeHttp(ok);
    const sender = new TwilioOtpSender({ ...cfg, template: 'Code: {code}' }, http);
    await sender.send('+5511999998888', '424242', 'login');
    expect(new URLSearchParams(http.calls[0]!.body).get('Body')).toBe('Code: 424242');
  });

  it('throws with the Twilio error detail on a non-2xx response, without leaking the code', async () => {
    const http = new FakeHttp(() => ({
      status: 400,
      body: JSON.stringify({ code: 21211, message: "Invalid 'To' phone number" }),
    }));
    const sender = new TwilioOtpSender(cfg, http);
    await expect(sender.send('bad', '777111', 'login')).rejects.toThrow(/twilio send failed \(400\).*21211/);
    await expect(sender.send('bad', '777111', 'login')).rejects.not.toThrow(/777111/);
  });

  it('rejects construction without credentials or a sender', () => {
    expect(() => new TwilioOtpSender({ accountSid: '', authToken: 't', from: '+1' })).toThrow(/accountSid/);
    expect(() => new TwilioOtpSender({ accountSid: 'AC', authToken: 't' })).toThrow(/from.*messagingServiceSid/);
  });
});
