-- 0013: capture the recipient name + chosen payout rail (MonCash/NatCash) on a transfer.
-- Additive + nullable so existing rows are unaffected.
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS recipient_name TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS payout_rail    TEXT;
