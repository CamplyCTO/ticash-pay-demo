-- Ticash Pay — Phase 2 payout state machine (PostgreSQL 16+)
-- One row per outbound leg of a transfer, joined to the ledger by correlation_id.
-- created -> submitted -> settled (provider success) | reversed (provider failure).

BEGIN;

CREATE TABLE IF NOT EXISTS payouts (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correlation_id TEXT NOT NULL UNIQUE,          -- ledger correlation id of the transfer
  provider       TEXT NOT NULL,                 -- 'moncash', ...
  provider_ref   TEXT,                          -- provider transaction id (after submit)
  recipient_ref  TEXT NOT NULL,                 -- MonCash msisdn
  currency       CHAR(4) NOT NULL,
  amount_minor   BIGINT NOT NULL CHECK (amount_minor > 0),
  status         TEXT NOT NULL DEFAULT 'created'
                   CHECK (status IN ('created','submitted','settled','reversed')),
  attempts       INT NOT NULL DEFAULT 0,
  last_error     TEXT,
  reversal       JSONB NOT NULL,                -- transfer quote needed to refund on failure
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);

COMMIT;
