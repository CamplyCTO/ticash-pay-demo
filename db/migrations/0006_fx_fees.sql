-- Ticash Pay — Phase 2 FX fees (PostgreSQL 16+)
-- Add the platform fee + provider fee knobs to the per-corridor FX config, so the
-- panel can show net-to-recipient and the platform's net profit per transfer.

BEGIN;

ALTER TABLE fx_rates
  ADD COLUMN IF NOT EXISTS platform_fee_bps INT NOT NULL DEFAULT 0
    CHECK (platform_fee_bps >= 0 AND platform_fee_bps < 10000);

ALTER TABLE fx_rates
  ADD COLUMN IF NOT EXISTS provider_fee_bps INT NOT NULL DEFAULT 0
    CHECK (provider_fee_bps >= 0 AND provider_fee_bps < 10000);

COMMIT;
