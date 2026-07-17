import { Currency } from '../money/currency';

/**
 * Cash-out approval (client security request): an agent can no longer debit a
 * customer's wallet just by knowing their number. A cash-out is a REQUEST that the
 * customer must APPROVE in-app before any money moves. The debit (agentCashOut on
 * the ledger) runs only on approval; reject/expire never touch the balance.
 */
export type CashoutStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

/** States a pending request can still transition to (nothing after a terminal state). */
export const CASHOUT_TERMINAL: ReadonlySet<CashoutStatus> = new Set<CashoutStatus>(['approved', 'rejected', 'cancelled', 'expired']);

export interface CashoutRequest {
  id: string;
  agentId: string;
  customerId: string;
  currency: Currency;
  amountMinor: bigint; // what the customer will be debited on approval
  commissionMinor: bigint; // the agent's commission (accrued by the ledger on approval)
  status: CashoutStatus;
  expiresAt: string | null; // pending requests auto-expire (no debit) after this
  createdAt: string;
  updatedAt: string;
}

export interface NewCashoutRequest {
  id: string;
  agentId: string;
  customerId: string;
  currency: Currency;
  amountMinor: bigint;
  commissionMinor: bigint;
  expiresAt: string | null;
}
