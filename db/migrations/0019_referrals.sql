-- Ticash Pay — referral / promo-code program.
--   (1) referral_codes: each user's shareable code (generated lazily on first view).
--   (2) referrals: one row per referred user. The REFERRER is rewarded once the
--       referred user makes their FIRST real transaction (anti-fraud: never on
--       signup alone). The bonus amount + currency are admin-editable via app_settings
--       (keys referral.bonus.minor / referral.bonus.currency).

BEGIN;

CREATE TABLE IF NOT EXISTS referral_codes (
  code               TEXT PRIMARY KEY,
  owner_external_id  TEXT NOT NULL UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referrals (
  referred_external_id  TEXT PRIMARY KEY,          -- one referral per referred user
  referrer_external_id  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',  -- pending | rewarded
  reward_minor          BIGINT,                    -- set when rewarded
  reward_currency       CHAR(4),                   -- set when rewarded
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  rewarded_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_external_id);

COMMIT;
