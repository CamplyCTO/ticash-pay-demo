-- Ticash Pay — Phase 2 transfer saga log (PostgreSQL 16+)
-- One row per cross-currency transfer, recording intent + saga progress so a crash
-- between steps (debit -> fx -> payout) can be resumed by the recovery sweep.
-- The ledger stays the source of truth; this is the orchestration log.

BEGIN;

CREATE TABLE IF NOT EXISTS transfers (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correlation_id    TEXT NOT NULL UNIQUE,        -- ledger correlation id
  base_idempotency  TEXT NOT NULL,               -- seed for per-leg idempotency keys
  sender_id         TEXT NOT NULL,
  recipient_ref     TEXT NOT NULL,
  from_currency     CHAR(4) NOT NULL,
  to_currency       CHAR(4) NOT NULL,
  send_minor        BIGINT NOT NULL CHECK (send_minor > 0),
  fee_minor         BIGINT NOT NULL CHECK (fee_minor >= 0),
  rate              TEXT NOT NULL,
  receive_minor     BIGINT NOT NULL CHECK (receive_minor > 0),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','debited','fx_booked','completed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Partial index over the recovery work-list (everything not yet completed).
CREATE INDEX IF NOT EXISTS idx_transfers_incomplete ON transfers(status) WHERE status <> 'completed';

COMMIT;
