-- Ticash Pay — Phase 3 WS-5: push notification device registry.
-- One row per device token, linked to an app_user. `disabled` is the opt-out flag.

BEGIN;

CREATE TABLE IF NOT EXISTS push_tokens (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES app_users(id),
  expo_token  TEXT NOT NULL UNIQUE,          -- ExponentPushToken[...]
  platform    TEXT,                          -- ios | android | web
  disabled    BOOLEAN NOT NULL DEFAULT false, -- opt-out (kept for audit, not deleted)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_tokens(user_id) WHERE disabled = false;

COMMIT;
