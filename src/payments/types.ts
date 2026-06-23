import { Currency } from '../money/currency';

/**
 * Phase 2 — money-in port (cash-in / top-up). One interface, many adapters:
 * Lytex (Brazil: PIX + card) now; Conekta/Stripe/tPago (MX/USA/DR) later. The
 * ledger core never learns who the provider is — it only sees a confirmed
 * `fundWallet`, posted by the webhook once the provider settles the charge.
 */

export type PaymentMethod = 'pix' | 'creditCard' | 'boleto';

export interface ChargePayer {
  name: string;
  /** Brazilian CPF (11 digits) or CNPJ (14 digits), digits only. */
  cpfCnpj: string;
  email?: string;
  cellphone?: string;
}

export interface ChargeRequest {
  /** Our customer external id — the wallet that gets funded when this settles. */
  customerId: string;
  currency: Currency; // BRL for Lytex
  amountMinor: bigint; // exact minor units (cents for BRL)
  methods: PaymentMethod[];
  payer: ChargePayer;
  /** Our stable reference for this charge (also the ledger idempotency seed). */
  reference: string;
  /** ISO date (YYYY-MM-DD). Defaults to today at the adapter if omitted. */
  dueDate?: string;
}

export interface ChargeResult {
  /** Provider's charge id (Lytex invoice `_id`) — the key everything joins on. */
  providerId: string;
  hashId?: string;
  status: string;
  /** PIX rendering, when the charge enables PIX. */
  pix?: { copyPaste?: string; qrCodeImage?: string };
  raw: unknown;
}

/** A provider webhook, verified and normalised into the domain's vocabulary. */
export interface PaymentEvent {
  providerId: string;
  /** True only when funds have actually settled (Lytex "Liquidation"). */
  paid: boolean;
  /** Raw provider event name, for logging/audit. */
  event: string;
  /** Amount the provider reports settled, when present (for cross-checking). */
  amountMinor?: bigint;
  currency?: Currency;
  raw: unknown;
}

/**
 * Money-in provider port. `createCharge` opens a charge; `parseWebhook`
 * authenticates an inbound notification and normalises it. `parseWebhook`
 * returns null when the signature is invalid — the caller must reject (401)
 * and never act on an unverified event.
 */
export interface PaymentInPort {
  readonly name: string;
  createCharge(req: ChargeRequest): Promise<ChargeResult>;
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): PaymentEvent | null;
}

// --- small injectable HTTP seam so adapters are unit-testable without network --

export interface HttpResponse {
  status: number;
  text(): Promise<string>;
}
export interface HttpClient {
  request(req: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<HttpResponse>;
}

/** Default HTTP client over Node's global fetch. */
export const fetchHttpClient: HttpClient = {
  async request(req) {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    return { status: res.status, text: () => res.text() };
  },
};
