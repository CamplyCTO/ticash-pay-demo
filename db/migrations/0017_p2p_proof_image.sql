-- Ticash Pay — P2P payment proof IMAGE (client request): a buyer uploads a photo/
-- screenshot of their off-platform payment (MonCash/NatCash) and the seller views it
-- before releasing USDT. Stored as bytea (compressed client-side); one per order.

BEGIN;

CREATE TABLE IF NOT EXISTS p2p_order_proofs (
  order_uid    UUID PRIMARY KEY REFERENCES p2p_orders(order_uid),
  image        BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
