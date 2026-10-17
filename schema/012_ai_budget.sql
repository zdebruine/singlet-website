-- Monthly AI token allowance, spend reservations and MCP usage.
-- Idempotent: apply once to production before merging code that uses it:
--   npx wrangler d1 execute singlet-catalog --remote --file=schema/012_ai_budget.sql

-- Settled spend per subject per UTC month. `micro_usd` is the internal unit
-- (millionths of a dollar); it is never shown to users, who see tokens.
-- The row with subject '*' is the global circuit breaker.
CREATE TABLE IF NOT EXISTS ai_spend (
  subject     TEXT    NOT NULL,
  month       TEXT    NOT NULL,              -- 'YYYY-MM' (UTC)
  micro_usd   INTEGER NOT NULL DEFAULT 0,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  calls       INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL,
  PRIMARY KEY (subject, month)
);

-- A call reserves its worst-case cost before the model runs and settles to the
-- real cost afterwards. Rows expire, so a crashed request cannot hold budget.
CREATE TABLE IF NOT EXISTS ai_reservation (
  id          TEXT    PRIMARY KEY,
  subject     TEXT    NOT NULL,
  month       TEXT    NOT NULL,
  micro_usd   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL               -- epoch ms
);
CREATE INDEX IF NOT EXISTS ai_reservation_subject ON ai_reservation (subject, month, expires_at);
CREATE INDEX IF NOT EXISTS ai_reservation_month   ON ai_reservation (month, expires_at);

-- MCP tool calls per subject, month and tool: the account page shows these and
-- they are the basis for any future per-call pricing.
CREATE TABLE IF NOT EXISTS mcp_usage (
  subject     TEXT    NOT NULL,
  month       TEXT    NOT NULL,
  tool        TEXT    NOT NULL,
  calls       INTEGER NOT NULL DEFAULT 0,
  last_at     TEXT    NOT NULL,
  PRIMARY KEY (subject, month, tool)
);

-- Fixed-window request counters (per API key), for burst limits.
CREATE TABLE IF NOT EXISTS rate_window (
  subject     TEXT    NOT NULL,
  bucket      TEXT    NOT NULL,              -- e.g. 'mcp'
  window      INTEGER NOT NULL,              -- floor(epoch ms / window length)
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, bucket, window)
);
