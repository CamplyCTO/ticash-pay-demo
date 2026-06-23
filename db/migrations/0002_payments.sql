-- Ticash Pay — Phase 2 money-in persistence (PostgreSQL 16+)
-- Durable payment intents + a webhook audit/idempotency log. The ledger remains
-- the source of truth; these tables track the provider side of a cash-in.

BEGIN;

-- ---------------------------------------------------------------------------
-- Payment intents: one per opened charge (Lytex invoice, etc.). On settlement
-- the webhook credits the RECORDED amount to customer_id — never an amount from
-- the webhook body — so a forged/over-stated notification can't move more money.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_intents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider     TEXT NOT NULL,                       -- 'lytex', ...
  provider_id  TEXT NOT NULL UNIQUE,                -- provider charge id (invoice _id)
  customer_id  TEXT NOT NULL,                       -- wallet funded on settlement
  currency     CHAR(4) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  reference    TEXT NOT NULL,                       -- our charge reference
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','paid','expired','failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_customer ON payment_intents(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);

-- ---------------------------------------------------------------------------
-- Provider events: edge idempotency + audit for inbound webhooks. A redelivered
-- webhook (same provider + event_uid) is recorded once; processing is skipped on
-- replay. Independent of the ledger idempotency key (defense in depth).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider     TEXT NOT NULL,
  event_uid    TEXT NOT NULL,                       -- e.g. "<event>:<provider_id>"
  kind         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_uid)
);

COMMIT;
