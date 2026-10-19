-- 023_library_feedback.sql — per-user libraries (named folders of studies) and the feedback form.
--
-- Apply to production (singlet-catalog) before merging the code that uses it:
--   wrangler d1 execute singlet-catalog --remote --file=schema/023_library_feedback.sql
-- Every statement is idempotent. Libraries reference users(id) from 010_accounts.sql.

CREATE TABLE IF NOT EXISTS libraries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS libraries_user ON libraries (user_id, created_at);

CREATE TABLE IF NOT EXISTS library_items (
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  gse_id     TEXT NOT NULL CHECK (gse_id GLOB 'GSE[0-9]*'),
  added_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (library_id, gse_id)
);
CREATE INDEX IF NOT EXISTS library_items_gse ON library_items (gse_id);

-- Feedback from the site. `subject` is the salted hash used for throttling (user:<id> when signed in).
CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject    TEXT NOT NULL,
  category   TEXT NOT NULL CHECK (category IN ('bug','data','idea','other')),
  message    TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 4000),
  email      TEXT,
  page       TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_subject ON feedback (subject, created_at);
