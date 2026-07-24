-- Ticash Pay — USDT withdrawal (off-ramp / "Sacar USDT"). A customer requests to
-- send USDT to their external wallet; the USDT is held (ledger: withdrawal_suspense)
-- until the operator sends it on-chain (completed) or rejects it (refund).

BEGIN;

CREATE TABLE IF NOT EXISTS usdt_withdrawals (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  withdrawal_uid UUID NOT NULL UNIQUE,
  customer_id    TEXT NOT NULL,
  currency       CHAR(4) NOT NULL,                    -- USDT
  amount_minor   BIGINT NOT NULL CHECK (amount_minor > 0),
  fee_minor      BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  address        TEXT NOT NULL,                       -- external destination wallet
  network        TEXT NOT NULL DEFAULT 'TRC20',
  status         TEXT NOT NULL DEFAULT 'pending',     -- pending | completed | rejected
  provider_ref   TEXT,                                -- on-chain tx hash / provider payout id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_pending ON usdt_withdrawals(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_withdrawals_customer ON usdt_withdrawals(customer_id);

COMMIT;
