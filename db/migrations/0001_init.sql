-- Ticash Pay — Phase 1 ledger schema (PostgreSQL 16+)
-- Append-only double-entry ledger. Balance is derived; postings are immutable.

BEGIN;

-- ---------------------------------------------------------------------------
-- Parties (identity lives outside the ledger; the ledger holds no PII)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_uid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  external_id  TEXT UNIQUE,                  -- app-facing id
  kyc_level    SMALLINT NOT NULL DEFAULT 0,
  kyc_status   TEXT NOT NULL DEFAULT 'pending',
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_uid         UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  external_id       TEXT UNIQUE,
  float_limit_minor BIGINT NOT NULL DEFAULT 0,
  commission_bps    INT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Accounts: one per (owner, kind, currency)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_uid  UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  account_key  TEXT NOT NULL UNIQUE,         -- canonical "owner:id:kind:ccy"
  owner_type   TEXT NOT NULL CHECK (owner_type IN ('customer','agent','system')),
  owner_id     TEXT,
  kind         TEXT NOT NULL,
  currency     CHAR(4) NOT NULL,
  non_negative BOOLEAN NOT NULL,             -- wallet/agent_float/commission -> true
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Transactions: the business event (journal header). Append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_uid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  type            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'posted',
  external_ref    TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id  UUID,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Postings: immutable double-entry lines. SUM per (txn,ccy) MUST be 0.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS postings (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id),
  account_id     BIGINT NOT NULL REFERENCES accounts(id),
  currency       CHAR(4) NOT NULL,
  amount_minor   BIGINT NOT NULL CHECK (amount_minor <> 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_postings_account ON postings(account_id);
CREATE INDEX IF NOT EXISTS idx_postings_txn ON postings(transaction_id);

-- ---------------------------------------------------------------------------
-- Balance cache: atomic same-transaction cache, used for fast reads and for
-- overdraft control via row lock. Source of truth is SUM(postings).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_balances (
  account_id    BIGINT PRIMARY KEY REFERENCES accounts(id),
  balance_minor BIGINT NOT NULL DEFAULT 0,
  version       BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Invariant 1: a transaction's postings must net to zero per currency.
-- Enforced as a DEFERRED constraint trigger (checked at COMMIT, so all lines
-- of a journal can be inserted before the balance is validated).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_transaction_balanced() RETURNS trigger AS $$
DECLARE
  bad RECORD;
BEGIN
  FOR bad IN
    SELECT currency, SUM(amount_minor) AS total
    FROM postings
    WHERE transaction_id = COALESCE(NEW.transaction_id, OLD.transaction_id)
    GROUP BY currency
    HAVING SUM(amount_minor) <> 0
  LOOP
    RAISE EXCEPTION 'unbalanced transaction % : % nets %',
      COALESCE(NEW.transaction_id, OLD.transaction_id), bad.currency, bad.total;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_balanced ON postings;
CREATE CONSTRAINT TRIGGER trg_balanced
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();

-- ---------------------------------------------------------------------------
-- Invariant 2: postings are immutable (no UPDATE/DELETE). Corrections are
-- new reversal transactions. Enforced by a trigger (belt) + GRANTs (braces).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_posting_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'postings are append-only; use a reversal transaction';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_mutation ON postings;
CREATE TRIGGER trg_no_mutation
  BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION forbid_posting_mutation();

COMMIT;
