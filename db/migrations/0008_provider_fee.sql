-- WS provider-fee reconciliation: lock the payout rail's fee (e.g. BenCash ~3.35%)
-- on each payout so settlement can split it into a distinct, reconcilable ledger cost.
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS provider_fee_minor BIGINT NOT NULL DEFAULT 0;
