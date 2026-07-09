import { Currency } from '../money/currency';

/**
 * Saga status for a cross-currency transfer. The transfer is a multi-step process
 * (debit → fx → payout) that must survive a crash between steps:
 *
 *   pending ─► debited ─► fx_booked ─► completed
 *
 * Each step is idempotent (ledger by idempotency key, payout by correlationId), so
 * re-running `TransferService.run` from any status resumes safely. A boot recovery
 * sweep drives every non-`completed` row to completion.
 */
export type TransferStatus = 'pending' | 'debited' | 'fx_booked' | 'completed';

/** Haiti mobile-money payout rail the sender chose for this transfer. */
export type PayoutRail = 'moncash' | 'natcash';

export interface TransferRecord {
  correlationId: string;
  baseIdempotencyKey: string;
  senderId: string;
  recipientRef: string;
  /** Human name of the person receiving the money (shown in history + on the payout). */
  recipientName: string | null;
  /** Chosen payout rail (MonCash/NatCash) when the destination is Haiti. */
  payoutRail: PayoutRail | null;
  fromCurrency: Currency;
  toCurrency: Currency;
  sendMinor: bigint;
  feeMinor: bigint;
  rate: string;
  receiveMinor: bigint;
  status: TransferStatus;
  createdAt: string;
  updatedAt: string;
}

export type NewTransfer = Omit<TransferRecord, 'status' | 'createdAt' | 'updatedAt'>;

export interface TransferStore {
  /** Idempotent on correlationId: returns the existing row if already present. */
  create(t: NewTransfer): Promise<TransferRecord>;
  get(correlationId: string): Promise<TransferRecord | null>;
  setStatus(correlationId: string, status: TransferStatus): Promise<TransferRecord>;
  /** All transfers not yet `completed` — the recovery work-list. */
  listIncomplete(): Promise<TransferRecord[]>;
  /** The caller's own transfers, newest first — for the app's activity history. */
  listBySender(senderId: string, limit: number): Promise<TransferRecord[]>;
}

export class InMemoryTransferStore implements TransferStore {
  private readonly byId = new Map<string, TransferRecord>();
  constructor(private readonly clock: () => string = () => new Date(Date.UTC(2026, 0, 1)).toISOString()) {}

  async create(t: NewTransfer): Promise<TransferRecord> {
    const existing = this.byId.get(t.correlationId);
    if (existing) return existing;
    const now = this.clock();
    const full: TransferRecord = { ...t, status: 'pending', createdAt: now, updatedAt: now };
    this.byId.set(t.correlationId, full);
    return full;
  }
  async get(correlationId: string): Promise<TransferRecord | null> {
    return this.byId.get(correlationId) ?? null;
  }
  async setStatus(correlationId: string, status: TransferStatus): Promise<TransferRecord> {
    const cur = this.byId.get(correlationId);
    if (!cur) throw new Error(`transfer ${correlationId} not found`);
    const next = { ...cur, status, updatedAt: this.clock() };
    this.byId.set(correlationId, next);
    return next;
  }
  async listIncomplete(): Promise<TransferRecord[]> {
    return [...this.byId.values()].filter((t) => t.status !== 'completed').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async listBySender(senderId: string, limit: number): Promise<TransferRecord[]> {
    return [...this.byId.values()]
      .filter((t) => t.senderId === senderId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
