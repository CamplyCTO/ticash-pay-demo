import { Currency } from '../money/currency';

/**
 * USDT withdrawal (off-ramp / "Sacar USDT"). A customer requests to send USDT to
 * their own external wallet (TRC20 address). On request the USDT is HELD (debited
 * from the wallet into withdrawal_suspense) — no on-chain money moves yet. The
 * operator (admin) verifies, sends the USDT on-chain (manually, or via a payout
 * provider later), and marks it COMPLETED (settle) with the tx hash; or REJECTS it
 * (refund). Same admin-approval + provider-port pattern as the Haiti fiat payouts.
 */
export type WithdrawalStatus = 'pending' | 'completed' | 'rejected';

export interface WithdrawalRequest {
  id: string;
  customerId: string;
  currency: Currency; // 'USDT'
  amountMinor: bigint; // total requested (held from the wallet)
  feeMinor: bigint; // platform fee retained on settle (net = amount - fee is sent on-chain)
  address: string; // external destination wallet address
  network: string; // e.g. 'TRC20'
  status: WithdrawalStatus;
  providerRef: string | null; // on-chain tx hash / provider payout id (set on completion)
  createdAt: string;
  updatedAt: string;
}

export interface NewWithdrawal {
  id: string;
  customerId: string;
  currency: Currency;
  amountMinor: bigint;
  feeMinor: bigint;
  address: string;
  network: string;
}
