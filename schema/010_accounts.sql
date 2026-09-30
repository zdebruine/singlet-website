-- Accounts, sessions, API keys and AI budgets on D1 (replaces Lovable Cloud /
-- Supabase auth, api_keys, ai_search_usage and explanations).
--
-- Applied to the production catalog (singlet-catalog) once; every statement is
-- idempotent so re-running is harmless. Timestamps are ISO-8601 UTC text.

-- One row per person. Email is the verified address reported by the last
-- provider used; it links a GitHub and a Google identity with the same
-- verified address to one account.
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,                 -- random uuid
  email           TEXT,
  display_name    TEXT,
  avatar_url      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_sign_in_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;

-- Provider accounts attached to a user ("github" / "google").
CREATE TABLE IF NOT EXISTS oauth_identities (
  provider         TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS oauth_identities_user ON oauth_identities (user_id);

-- Browser sessions. The cookie carries a random token; only sha256(token) is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);

-- In-flight OAuth round-trips (10-minute lifetime). state is random; only its
-- hash is stored. code_verifier is the PKCE secret for this attempt.
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash    TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  origin        TEXT NOT NULL,                      -- where the browser started (singlet.bio or a preview host)
  return_to     TEXT NOT NULL DEFAULT '/browse',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at    TEXT NOT NULL
);

-- Personal API keys: sk_live_<40 chars>. Only sha256(key) and a display prefix are kept.
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_used_at TEXT,
  expires_at   TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys (user_id);

-- Daily AI budgets. subject = "user:<id>" or "anon:<salted ip hash>"; day = YYYY-MM-DD (UTC).
CREATE TABLE IF NOT EXISTS ai_usage (
  subject  TEXT NOT NULL,
  day      TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('search', 'explain')),
  user_id  TEXT,
  count    INTEGER NOT NULL DEFAULT 0,
  first_at TEXT NOT NULL,
  last_at  TEXT NOT NULL,
  PRIMARY KEY (subject, day, kind)
);
CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage (day);

-- Query interpretations, keyed by normalised query + rules version, so a
-- repeated question never spends model quota.
CREATE TABLE IF NOT EXISTS interpret_cache (
  qnorm         TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  model         TEXT,
  json          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (qnorm, rules_version)
);

-- One-sentence "why this study matches" explanations, cached per (query, study).
CREATE TABLE IF NOT EXISTS explanations (
  cache_key   TEXT PRIMARY KEY,                     -- sha256("v1|" + qnorm + "|" + gse_id)
  query_norm  TEXT NOT NULL,
  gse_id      TEXT NOT NULL,
  explanation TEXT NOT NULL,
  model       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
