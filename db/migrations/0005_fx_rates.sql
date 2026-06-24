-- Ticash Pay — Phase 2 FX rates (PostgreSQL 16+)
-- Per-pair mid rate + platform margin (bps). The customer rate is derived
-- (mid adjusted by margin) and LOCKED onto each transfer at quote time.

BEGIN;

CREATE TABLE IF NOT EXISTS fx_rates (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_currency CHAR(4) NOT NULL,
  to_currency   CHAR(4) NOT NULL,
  mid_rate      TEXT NOT NULL,                 -- decimal string, "to per from"
  margin_bps    INT NOT NULL DEFAULT 0 CHECK (margin_bps >= 0 AND margin_bps < 10000),
  source        TEXT NOT NULL DEFAULT 'config',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_currency, to_currency)
);

COMMIT;
