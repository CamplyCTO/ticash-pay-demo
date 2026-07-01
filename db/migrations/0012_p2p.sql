-- Ticash Pay — Phase 3 WS-4: P2P USDT escrow marketplace.
-- Offers (a seller lists USDT, locked in the ledger escrow) and orders (a buyer
-- reserves part of an offer, pays off-platform, seller confirms → release).
-- Money itself lives in the ledger; these tables hold marketplace state only.

BEGIN;

CREATE TABLE IF NOT EXISTS p2p_offers (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_uid       UUID NOT NULL UNIQUE,
  merchant_id     TEXT NOT NULL,                       -- seller party external_id
  asset           CHAR(4) NOT NULL,                    -- USDT
  fiat_currency   CHAR(4) NOT NULL,                    -- BRL / HTG / ...
  price_per_unit  TEXT NOT NULL,                       -- fiat per 1 asset unit (decimal string)
  total_minor     BIGINT NOT NULL CHECK (total_minor > 0),
  remaining_minor BIGINT NOT NULL CHECK (remaining_minor >= 0),
  methods         JSONB NOT NULL DEFAULT '[]',         -- accepted payment methods + details
  status          TEXT NOT NULL DEFAULT 'active',      -- active | closed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_offers_active ON p2p_offers(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_p2p_offers_merchant ON p2p_offers(merchant_id);

CREATE TABLE IF NOT EXISTS p2p_orders (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_uid           UUID NOT NULL UNIQUE,
  offer_uid           UUID NOT NULL REFERENCES p2p_offers(offer_uid),
  merchant_id         TEXT NOT NULL,
  buyer_id            TEXT NOT NULL,
  asset               CHAR(4) NOT NULL,
  asset_minor         BIGINT NOT NULL CHECK (asset_minor > 0),
  commission_minor    BIGINT NOT NULL CHECK (commission_minor >= 0),
  net_to_buyer_minor  BIGINT NOT NULL CHECK (net_to_buyer_minor >= 0),
  fiat_currency       CHAR(4) NOT NULL,
  fiat_minor          BIGINT NOT NULL CHECK (fiat_minor >= 0),
  price_per_unit      TEXT NOT NULL,
  method              JSONB NOT NULL,
  status              TEXT NOT NULL DEFAULT 'created',  -- created|payment_submitted|released|cancelled|disputed
  proof_ref           TEXT,
  dispute_reason      TEXT,
  timeout_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_buyer ON p2p_orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_merchant ON p2p_orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_offer ON p2p_orders(offer_uid);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_status ON p2p_orders(status);

COMMIT;
