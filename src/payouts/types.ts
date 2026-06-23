import { Currency } from '../money/currency';

/**
 * Phase 2 — money-out port. One interface, swappable rail: MonCash (Haiti) now;
 * NatCash later. ALL corridors (BR/MX/USA/DR → HT) pay out through this same port,
 * so a new corridor only adds a money-IN adapter, never a new payout.
 */

export interface PayoutRequest {
  correlationId: string; // links to the transfer in the ledger
  currency: Currency; // HTG for MonCash
  amountMinor: bigint;
  recipientRef: string; // MonCash msisdn (e.g. 509XXXXXXXX)
  desc?: string;
}

export interface PayoutSubmitResult {
  providerRef: string; // provider transaction id
  raw: unknown;
}

/** Normalised provider status. `pending` = keep polling. */
export interface PayoutStatusResult {
  state: 'pending' | 'success' | 'failed';
  raw: unknown;
}

export interface PayoutPort {
  readonly name: string;
  sendPayout(req: PayoutRequest): Promise<PayoutSubmitResult>;
  getStatus(providerRef: string): Promise<PayoutStatusResult>;
}
