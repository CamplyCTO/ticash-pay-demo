-- Ticash Pay — (1) runtime-editable settings (admin-set P2P/USDT commission) and
-- (2) cash-out APPROVAL requests: an agent's cash-out is now a request the customer
-- must approve in-app before any debit runs.

BEGIN;

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cashout_requests (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_uid       UUID NOT NULL UNIQUE,
  agent_id          TEXT NOT NULL,
  customer_id       TEXT NOT NULL,
  currency          CHAR(4) NOT NULL,
  amount_minor      BIGINT NOT NULL CHECK (amount_minor > 0),
  commission_minor  BIGINT NOT NULL DEFAULT 0 CHECK (commission_minor >= 0),
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|cancelled|expired
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One open (pending) request per customer+agent at a time is fine; index the hot reads.
CREATE INDEX IF NOT EXISTS idx_cashout_customer_pending ON cashout_requests(customer_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cashout_agent ON cashout_requests(agent_id);

COMMIT;
