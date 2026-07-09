-- 0014: WS-0 v2 — profile + password login for the mobile apps.
-- Adds name/country and a phone-verified flag; email + password_hash already exist
-- (0010). A case-insensitive unique email index enables login-by-email.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS name           TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS country        TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_users (lower(email)) WHERE email IS NOT NULL;
