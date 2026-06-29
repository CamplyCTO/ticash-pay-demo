/**
 * OTP delivery port. Behind this port so the build is not blocked on the client
 * picking an SMS gateway: today a console/log sender; later a Twilio (or the
 * gateway's OTP) adapter — the same ports-and-adapters pattern as Lytex/BenCash.
 */
export interface OtpSender {
  readonly name: string;
  send(phone: string, code: string, purpose: string): Promise<void>;
}

export interface OtpMessage {
  phone: string;
  code: string;
  purpose: string;
}

/**
 * Logs the OTP instead of sending an SMS. `sink` defaults to console; tests pass
 * a capturing sink to read the code. Never used once a real sender is wired.
 */
export class ConsoleOtpSender implements OtpSender {
  readonly name = 'console';
  constructor(
    private readonly sink: (msg: OtpMessage) => void = (m) =>
      // eslint-disable-next-line no-console
      console.log(`[otp] ${m.phone} -> ${m.code} (${m.purpose})`),
  ) {}

  async send(phone: string, code: string, purpose: string): Promise<void> {
    this.sink({ phone, code, purpose });
  }
}
