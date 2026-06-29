-- Ticash Pay — Phase 3 WS-0: end-user authentication (mobile apps).
-- Login identity for the customer + agent apps. Separate from the admin Basic Auth:
-- the apps authenticate per-user (phone + OTP -> JWT), under the /app/* boundary.
-- Identity lives here; the ledger/registry still hold the money + party records.

BEGIN;

-- ---------------------------------------------------------------------------
-- app_users: one login per end user, linked to the existing party.
--   customer self-signup creates a customers row + this row;
--   agents are admin-provisioned (a row here links to an existing agent).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role          TEXT NOT NULL CHECK (role IN ('customer','agent')),
  external_id   TEXT NOT NULL,                 -- links to customers/agents.external_id
  phone         TEXT NOT NULL UNIQUE,          -- login handle (E.164)
  email         TEXT,
  password_hash TEXT,                          -- reserved (email+password is optional/future)
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_users_external ON app_users(role, external_id);

-- ---------------------------------------------------------------------------
-- otp_codes: one-time login codes. Only the HASH is stored; never the code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'login',
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, created_at);

-- ---------------------------------------------------------------------------
-- sessions: refresh-token registry. Only the HASH is stored. Rotation on
-- refresh (new hash replaces old); revoked_at enables remote logout.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES app_users(id),
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device             TEXT,
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

COMMIT;
