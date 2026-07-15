-- Ticash Pay — P2P offer configuration (client request): per-order fiat limits +
-- the buyer's payment window. Backwards-compatible: existing offers keep NULL
-- limits (no floor/cap) and a default 15-minute window.

BEGIN;

ALTER TABLE p2p_offers ADD COLUMN IF NOT EXISTS min_fiat_minor BIGINT CHECK (min_fiat_minor >= 0);
ALTER TABLE p2p_offers ADD COLUMN IF NOT EXISTS max_fiat_minor BIGINT CHECK (max_fiat_minor > 0);
ALTER TABLE p2p_offers ADD COLUMN IF NOT EXISTS pay_window_min INT NOT NULL DEFAULT 15 CHECK (pay_window_min BETWEEN 1 AND 1440);

COMMIT;
