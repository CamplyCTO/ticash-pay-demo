import { PushNotification } from './types';

/**
 * Push delivery port. Behind this port so dispatch logic is testable without
 * network and the transport is swappable — `ExpoPushSender` (FCM/APNs via Expo)
 * in prod, `ConsolePushSender` in dev/tests. Same pattern as the OTP sender.
 */
export interface PushSender {
  readonly name: string;
  send(tokens: string[], notification: PushNotification): Promise<void>;
}

export class ExpoPushSender implements PushSender {
  readonly name = 'expo';
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly accessToken?: string;

  private readonly timeoutMs: number;

  constructor(opts: { accessToken?: string; base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
    this.base = (opts.base ?? 'https://exp.host').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.accessToken = opts.accessToken;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  async send(tokens: string[], n: PushNotification): Promise<void> {
    if (tokens.length === 0) return;
    const messages = tokens.map((to) => ({ to, title: n.title, body: n.body, sound: 'default', ...(n.data ? { data: n.data } : {}) }));
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    // Bounded: dispatch is awaited in the money path, so a hung Expo call must not
    // stall the response. The caller already treats failures as best-effort.
    const res = await this.fetchImpl(`${this.base}/--/api/v2/push/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`expo push failed: ${res.status} ${text.slice(0, 200)}`);
    }
  }
}

export class ConsolePushSender implements PushSender {
  readonly name = 'console';
  constructor(
    private readonly sink: (tokens: string[], n: PushNotification) => void = (tokens, n) =>
      // eslint-disable-next-line no-console
      console.log(`[push] -> ${tokens.length} device(s): ${n.title} — ${n.body}`),
  ) {}
  async send(tokens: string[], n: PushNotification): Promise<void> {
    if (tokens.length > 0) this.sink(tokens, n);
  }
}
