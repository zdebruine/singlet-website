-- 035_beta_signups.sql — the Beta sign-up form on /beta (POST /api/beta-signup).
--
-- Apply to production (singlet-catalog) before merging the code that uses it:
--   wrangler d1 execute singlet-catalog --remote --file=schema/035_beta_signups.sql
-- Every statement is idempotent. user_id references users(id) from 010_accounts.sql.
--
-- One row per email address (lower-cased). A repeat sign-up with the same address changes nothing, so a visitor cannot
-- overwrite someone else's entry. `subject` is the salted identity hash used for throttling (user:<id> when signed in);
-- no network address or user agent is stored.

CREATE TABLE IF NOT EXISTS beta_signups (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  email          TEXT NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  name           TEXT CHECK (name IS NULL OR length(name) <= 120),
  institution    TEXT CHECK (institution IS NULL OR length(institution) <= 200),
  role           TEXT CHECK (role IS NULL OR role IN ('student','postdoc','faculty','staff_scientist','industry','clinician','engineer','other')),
  interests      TEXT CHECK (interests IS NULL OR length(interests) <= 2000),
  updates_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (updates_opt_in IN (0, 1)),
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS beta_signups_created ON beta_signups (created_at DESC);
CREATE INDEX IF NOT EXISTS beta_signups_subject ON beta_signups (subject, created_at);
