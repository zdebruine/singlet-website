-- OAuth 2.1 authorization server for the MCP endpoint (functions/_shared/mcp-oauth.ts), so
-- https://singlet.bio/mcp can be added as a custom connector in Claude (and any MCP client that
-- speaks the MCP authorization spec) by signing in with GitHub or Google instead of pasting a key.
--
-- Applied to the production catalog (singlet-catalog) once; every statement is idempotent so
-- re-running is harmless. Timestamps are ISO-8601 UTC text. Secrets, codes and tokens are random;
-- only their sha256 is stored.

-- Clients registered through dynamic client registration (RFC 7591, POST /oauth/register).
-- Public clients (token_endpoint_auth_method 'none', PKCE only) have no secret.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                  TEXT PRIMARY KEY,           -- scl_<random>
  client_secret_hash         TEXT,                       -- confidential clients only
  client_name                TEXT,
  client_uri                 TEXT,
  redirect_uris              TEXT NOT NULL,              -- JSON array
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_used_at               TEXT
);
CREATE INDEX IF NOT EXISTS oauth_clients_created ON oauth_clients (created_at);

-- An authorization request waiting for the visitor to sign in and approve (15-minute lifetime).
CREATE TABLE IF NOT EXISTS oauth_requests (
  request_hash   TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,                          -- S256
  scope          TEXT NOT NULL,
  resource       TEXT NOT NULL,
  state          TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at     TEXT NOT NULL
);

-- Single-use authorization codes (5-minute lifetime). used_at is set on exchange; a second
-- exchange of the same code revokes the grant it produced.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  grant_id       TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope          TEXT NOT NULL,
  resource       TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at     TEXT NOT NULL,
  used_at        TEXT
);

-- One connection: a user's approval of one client. Every token belongs to a grant, so
-- disconnecting (revoked_at) ends all of its tokens at once. Listed on /account.
CREATE TABLE IF NOT EXISTS oauth_grants (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL,
  client_name  TEXT,
  scope        TEXT NOT NULL,
  resource     TEXT NOT NULL,                            -- the MCP URL the tokens are good for
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS oauth_grants_user ON oauth_grants (user_id);

-- Access tokens (sat_…, 1 hour) and refresh tokens (srt_…, 60 days, rotated on every use).
-- revoked_reason: 'rotated' (replaced by a refresh) or 'revoked'.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash     TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  grant_id       TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens (grant_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_expires ON oauth_tokens (expires_at);
