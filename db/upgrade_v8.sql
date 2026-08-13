-- ============================================================================
-- UPGRADE v8 — Email verification token + user-activity fields (signup/last IP,
-- last login). Idempotent. Run in pgAdmin against broking_ai. The backend also
-- adds these on startup; this is for the DB-first workflow.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token   VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip      VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip        VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at  TIMESTAMPTZ;
