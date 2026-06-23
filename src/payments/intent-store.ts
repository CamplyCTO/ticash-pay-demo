import { Currency } from '../money/currency';

/**
 * A pending money-in charge. When the provider settles it (webhook), we look the
 * intent up by `providerId` to know WHICH wallet to fund and for HOW MUCH — we
 * credit the amount we recorded, never an amount taken from the webhook body, so
 * a forged/over-stated notification can't move more money than was charged.
 */
export interface PaymentIntent {
  providerId: string; // provider charge id (Lytex invoice _id)
  provider: string; // e.g. 'lytex'
  customerId: string; // wallet to fund on settlement
  currency: Currency;
  amountMinor: bigint;
  reference: string; // our charge reference
  status: 'pending' | 'paid';
  createdAt: string;
}

export interface PaymentIntentStore {
  create(intent: Omit<PaymentIntent, 'status' | 'createdAt'>): Promise<PaymentIntent>;
  get(providerId: string): Promise<PaymentIntent | null>;
  markPaid(providerId: string): Promise<void>;
  list(): Promise<PaymentIntent[]>;
}

/** In-memory intents for the demo/tests. PG-backed version follows in deploy. */
export class InMemoryPaymentIntentStore implements PaymentIntentStore {
  private readonly byId = new Map<string, PaymentIntent>();
  private seq = 0;

  constructor(private readonly clock: () => string = () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString()) {}

  async create(intent: Omit<PaymentIntent, 'status' | 'createdAt'>): Promise<PaymentIntent> {
    const existing = this.byId.get(intent.providerId);
    if (existing) return existing; // idempotent on charge id
    const full: PaymentIntent = { ...intent, status: 'pending', createdAt: this.clock() };
    this.byId.set(intent.providerId, full);
    this.seq++;
    return full;
  }

  async get(providerId: string): Promise<PaymentIntent | null> {
    return this.byId.get(providerId) ?? null;
  }

  async markPaid(providerId: string): Promise<void> {
    const it = this.byId.get(providerId);
    if (it) it.status = 'paid';
  }

  async list(): Promise<PaymentIntent[]> {
    return [...this.byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
