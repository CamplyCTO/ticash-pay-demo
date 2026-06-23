import { Currency } from '../money/currency';

export type PayoutStatus =
  | 'created' // row exists, not yet sent to the provider
  | 'submitted' // accepted by the provider, awaiting confirmation
  | 'settled' // provider confirmed + ledger settlePayout posted
  | 'reversed'; // provider failed + ledger reverseTransfer posted

/** Context needed to refund the sender if the payout fails (the transfer quote). */
export interface PayoutReversalContext {
  senderId: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  sendMinor: bigint;
  feeMinor: bigint;
  receiveMinor: bigint;
  rate: string;
}

export interface PayoutRecord {
  correlationId: string;
  provider: string;
  providerRef: string | null;
  recipientRef: string;
  currency: Currency;
  amountMinor: bigint;
  status: PayoutStatus;
  attempts: number;
  lastError: string | null;
  reversal: PayoutReversalContext;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutStore {
  create(rec: Omit<PayoutRecord, 'status' | 'attempts' | 'lastError' | 'createdAt' | 'updatedAt' | 'providerRef'>): Promise<PayoutRecord>;
  get(correlationId: string): Promise<PayoutRecord | null>;
  update(correlationId: string, patch: Partial<PayoutRecord>): Promise<PayoutRecord>;
  list(): Promise<PayoutRecord[]>;
}

export class InMemoryPayoutStore implements PayoutStore {
  private readonly byId = new Map<string, PayoutRecord>();
  constructor(private readonly clock: () => string = () => new Date(Date.UTC(2026, 0, 1)).toISOString()) {}

  async create(rec: Omit<PayoutRecord, 'status' | 'attempts' | 'lastError' | 'createdAt' | 'updatedAt' | 'providerRef'>): Promise<PayoutRecord> {
    const existing = this.byId.get(rec.correlationId);
    if (existing) return existing; // idempotent per transfer
    const now = this.clock();
    const full: PayoutRecord = {
      ...rec,
      providerRef: null,
      status: 'created',
      attempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(rec.correlationId, full);
    return full;
  }
  async get(correlationId: string): Promise<PayoutRecord | null> {
    return this.byId.get(correlationId) ?? null;
  }
  async update(correlationId: string, patch: Partial<PayoutRecord>): Promise<PayoutRecord> {
    const cur = this.byId.get(correlationId);
    if (!cur) throw new Error(`payout ${correlationId} not found`);
    const next = { ...cur, ...patch, updatedAt: this.clock() };
    this.byId.set(correlationId, next);
    return next;
  }
  async list(): Promise<PayoutRecord[]> {
    return [...this.byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
