-- Airtime recharge margin per country (basis points). The platform marks up the
-- provider cost; the markup is booked to fee_revenue as platform profit. Any country
-- DingConnect supports can have its own fee; absent rows fall back to the config default.
CREATE TABLE IF NOT EXISTS airtime_margins (
  country_iso TEXT PRIMARY KEY,
  margin_bps  INTEGER NOT NULL CHECK (margin_bps >= 0 AND margin_bps < 10000),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
