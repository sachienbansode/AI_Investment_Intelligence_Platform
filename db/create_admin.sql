-- ============================================================================
-- Create an admin user directly in PostgreSQL.
-- Uses pgcrypto's Blowfish crypt ($2a$ bcrypt) — compatible with the app's
-- password verification.
--
-- 1. Replace the email and password placeholders below.
-- 2. Run:
--    psql "host=YOUR-DB-HOST port=5432 user=postgres dbname=broking_ai sslmode=require" -f create_admin.sql
--
-- SECURITY: the plaintext password appears in this file and in psql history.
-- Delete/clear both after running, or prefer `python scripts/create_admin.py`
-- which prompts interactively and never stores the password anywhere.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- New admin (fails if email already exists)
INSERT INTO users (email, full_name, hashed_password, is_admin, is_active, created_at)
VALUES (
    lower('admin@YOURCOMPANY.com'),                      -- << your email
    'Administrator',
    crypt('REPLACE_WITH_STRONG_PASSWORD', gen_salt('bf', 12)),  -- << your password
    TRUE, TRUE, now()
);

-- ── OR: reset password / promote an existing user ──────────────────────────
-- UPDATE users
-- SET hashed_password = crypt('REPLACE_WITH_STRONG_PASSWORD', gen_salt('bf', 12)),
--     is_admin = TRUE, is_active = TRUE
-- WHERE email = lower('admin@YOURCOMPANY.com');

-- Verify
SELECT id, email, is_admin, is_active FROM users;
