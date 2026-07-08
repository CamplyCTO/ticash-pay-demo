import { describe, expect, it } from 'vitest';
import { TwilioVerifier, TwilioVerifyConfig } from '../src/auth/verifier';
import { HttpClient } from '../src/payments/types';

interface Recorded { url: string; method: string; headers: Record<string, string>; body?: string }
class FakeHttp implements HttpClient {
  calls: Recorded[] = [];
  constructor(private readonly handler: (req: Recorded) => { status: number; body: string }) {}
  async request(req: Recorded) {
    this.calls.push(req);
    const r = this.handler(req);
    return { status: r.status, text: async () => r.body };
  }
}

const cfg: TwilioVerifyConfig = {
  accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  authToken: 'tok-secret',
  serviceSid: 'VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  channels: ['sms'],
};

describe('TwilioVerifier', () => {
  it('start() posts To+Channel to Verifications with basic auth', async () => {
    const http = new FakeHttp(() => ({ status: 201, body: JSON.stringify({ sid: 'VE1', status: 'pending' }) }));
    const v = new TwilioVerifier(cfg, http);
    const res = await v.start('+5511999998888', 'login');

    expect(res.channel).toBe('sms');
    const call = http.calls[0]!;
    expect(call.url).toBe(`https://verify.twilio.com/v2/Services/${cfg.serviceSid}/Verifications`);
    expect(call.headers.Authorization).toBe('Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64'));
    const form = new URLSearchParams(call.body);
    expect(form.get('To')).toBe('+5511999998888');
    expect(form.get('Channel')).toBe('sms');
  });

  it('start() tries channels in order and falls back when the first fails', async () => {
    // whatsapp -> 400 (sender not ready), sms -> 201
    const http = new FakeHttp((req) => {
      const ch = new URLSearchParams(req.body).get('Channel');
      return ch === 'whatsapp'
        ? { status: 400, body: JSON.stringify({ code: 60200, message: 'Invalid parameter Channel' }) }
        : { status: 201, body: JSON.stringify({ status: 'pending' }) };
    });
    const v = new TwilioVerifier({ ...cfg, channels: ['whatsapp', 'sms'] }, http);
    const res = await v.start('+5511999998888', 'login');
    expect(res.channel).toBe('sms');
    expect(http.calls).toHaveLength(2); // whatsapp attempted, then sms
  });

  it('start() throws when every channel fails', async () => {
    const http = new FakeHttp(() => ({ status: 400, body: JSON.stringify({ code: 60200, message: 'bad' }) }));
    const v = new TwilioVerifier({ ...cfg, channels: ['whatsapp', 'sms'] }, http);
    await expect(v.start('+5511999998888', 'login')).rejects.toThrow(/verify.*failed/);
  });

  it('check() returns true only for status "approved"', async () => {
    const approved = new TwilioVerifier(cfg, new FakeHttp(() => ({ status: 200, body: JSON.stringify({ status: 'approved' }) })));
    const pending = new TwilioVerifier(cfg, new FakeHttp(() => ({ status: 200, body: JSON.stringify({ status: 'pending' }) })));
    expect(await approved.check('+5511999998888', '123456')).toBe(true);
    expect(await pending.check('+5511999998888', '000000')).toBe(false);
  });

  it('check() treats a 404 (expired / max attempts) as an invalid code, not an error', async () => {
    const v = new TwilioVerifier(cfg, new FakeHttp(() => ({ status: 404, body: JSON.stringify({ code: 20404, message: 'not found' }) })));
    expect(await v.check('+5511999998888', '123456')).toBe(false);
  });

  it('requires accountSid/authToken and a Verify serviceSid', () => {
    expect(() => new TwilioVerifier({ ...cfg, accountSid: '' })).toThrow(/accountSid/);
    expect(() => new TwilioVerifier({ ...cfg, serviceSid: '' })).toThrow(/serviceSid/);
  });
});
