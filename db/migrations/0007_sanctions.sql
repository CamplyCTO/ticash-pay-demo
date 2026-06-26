-- Ticash Pay — Phase 2 AML/sanctions hit log (PostgreSQL 16+)
-- Every screening hit (on cash-in, transfer, or a manual check) is recorded here
-- for review/audit. The block decision happens in the app; this is the trail.

BEGIN;

CREATE TABLE IF NOT EXISTS sanctions_hits (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject      TEXT NOT NULL,           -- the name screened
  context      TEXT NOT NULL,           -- 'charge' | 'transfer' | 'manual'
  list         TEXT NOT NULL,           -- e.g. 'OFAC-SDN'
  matched_name TEXT NOT NULL,
  score        NUMERIC NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sanctions_hits_created ON sanctions_hits(created_at DESC);

COMMIT;
