-- Private projects, files, cohorts and workspaces ("Stage 12") on D1. The
-- access rules live in functions/_shared/product.ts (D1 has no row-level
-- security).
--
-- Applied to the production catalog (singlet-catalog) once, after
-- 010_accounts.sql (every owner/member column references users(id)). Every
-- statement is idempotent so re-running is harmless.
--
-- Translation notes:
--   - uuid ids are TEXT, minted with crypto.randomUUID() in code.
--   - Postgres enums are TEXT with a CHECK, jsonb is TEXT holding JSON,
--     timestamptz is ISO-8601 UTC text (same format as 010_accounts.sql).
--   - Row-level security is gone: functions/_shared/product.ts enforces every
--     rule (owner, workspace member when visibility = 'workspace', share-link
--     token for cohorts with visibility = 'link', project read token for
--     private file downloads).
--   - D1 enforces foreign keys, so deleting a user cascades to everything
--     they own. product.ts still deletes child rows explicitly.
--   - updated_at is set by the code on every UPDATE (no triggers).

-- ── Workspaces ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspaces (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  -- ^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$
  slug       TEXT NOT NULL UNIQUE CHECK (
               length(slug) BETWEEN 3 AND 50
               AND slug NOT GLOB '*[^a-z0-9-]*'
               AND slug NOT GLOB '-*'
               AND slug NOT GLOB '*-'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS workspaces_owner ON workspaces (owner_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user ON workspace_members (user_id, workspace_id);

-- Invite links (7-day lifetime). Only sha256(token) is stored.
CREATE TABLE IF NOT EXISTS workspace_invites (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT,                                -- lower-cased, NULL = anyone with the link
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  accepted_at  TEXT,
  accepted_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS workspace_invites_workspace ON workspace_invites (workspace_id, expires_at DESC);

-- ── Private projects and their .singlet files ──────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id      TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  name              TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  description       TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  visibility        TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'workspace', 'link')),
  read_token_hash   TEXT NOT NULL UNIQUE,           -- sha256 of the spr_… loader token
  read_token_prefix TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projects_workspace ON projects (workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_files (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('upload', 'url')),
  filename   TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  object_key TEXT,                                  -- R2 key in USER_DATA (kind = 'upload')
  source_url TEXT,                                  -- public HTTPS URL (kind = 'url')
  bytes      INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0 AND bytes <= 2147483648),
  etag       TEXT,
  status     TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'indexing', 'ready', 'failed')),
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK ((kind = 'upload' AND object_key IS NOT NULL AND source_url IS NULL)
      OR (kind = 'url' AND source_url IS NOT NULL AND object_key IS NULL))
);
CREATE INDEX IF NOT EXISTS user_files_owner ON user_files (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_files_project ON user_files (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_files_status ON user_files (status, kind);

-- One in-flight R2 multipart upload per file (24 h reservation).
CREATE TABLE IF NOT EXISTS multipart_uploads (
  id             TEXT PRIMARY KEY,
  file_id        TEXT NOT NULL UNIQUE REFERENCES user_files(id) ON DELETE CASCADE,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_upload_id   TEXT NOT NULL,
  object_key     TEXT NOT NULL,
  expected_bytes INTEGER NOT NULL CHECK (expected_bytes > 0 AND expected_bytes <= 2147483648),
  reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes > 0),
  expires_at     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS multipart_uploads_owner ON multipart_uploads (owner_id);

-- ── Indexed metadata read out of each private .singlet ─────────────────────

CREATE TABLE IF NOT EXISTS user_studies (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id          TEXT NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_id         TEXT NOT NULL CHECK (length(study_id) BETWEEN 1 AND 120),
  title            TEXT,
  abstract         TEXT,
  organism_primary TEXT,
  organisms        TEXT NOT NULL DEFAULT '[]',      -- JSON array
  tissue_groups    TEXT NOT NULL DEFAULT '[]',      -- JSON array
  disease_groups   TEXT NOT NULL DEFAULT '[]',      -- JSON array
  assay_families   TEXT NOT NULL DEFAULT '[]',      -- JSON array
  cell_types_raw   TEXT NOT NULL DEFAULT '[]',      -- JSON array
  n_samples        INTEGER NOT NULL DEFAULT 0 CHECK (n_samples >= 0),
  n_cells          INTEGER,
  bytes            INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  reference_build  TEXT,
  singlet_version  TEXT,
  year             INTEGER,
  manifest         TEXT NOT NULL DEFAULT '{}',      -- JSON object
  study_meta       TEXT NOT NULL DEFAULT '{}',      -- JSON object
  indexed_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (project_id, study_id)
);
CREATE INDEX IF NOT EXISTS user_studies_owner ON user_studies (owner_id, indexed_at DESC);
CREATE INDEX IF NOT EXISTS user_studies_file ON user_studies (file_id);

CREATE TABLE IF NOT EXISTS user_samples (
  id              TEXT PRIMARY KEY,
  study_id        TEXT NOT NULL REFERENCES user_studies(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sample_id       TEXT NOT NULL CHECK (length(sample_id) BETWEEN 1 AND 160),
  organism        TEXT,
  tissue          TEXT,
  tissue_group    TEXT,
  disease         TEXT,
  disease_group   TEXT,
  protocol        TEXT,
  assay_family    TEXT,
  cell_type       TEXT,
  characteristics TEXT NOT NULL DEFAULT '{}',       -- JSON object
  UNIQUE (study_id, sample_id)
);
CREATE INDEX IF NOT EXISTS user_samples_facets ON user_samples (project_id, organism, tissue_group, disease_group, assay_family);

CREATE TABLE IF NOT EXISTS user_sample_qc (
  sample_id               TEXT PRIMARY KEY REFERENCES user_samples(id) ON DELETE CASCADE,
  project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  n_input_reads           INTEGER,
  uniquely_mapped_pct     REAL,
  n_cells_called          INTEGER,
  median_umi              REAL,
  median_genes            REAL,
  mapping_rate            REAL,
  median_mito_fraction    REAL,
  fraction_reads_in_cells REAL,
  reference_build         TEXT,
  singlet_version         TEXT,
  summary                 TEXT NOT NULL DEFAULT '{}', -- JSON object (the whole summary row)
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS user_sample_qc_project ON user_sample_qc (project_id);

-- ── Cohorts: pinned lists of public GSEs and private studies ───────────────

CREATE TABLE IF NOT EXISTS cohorts (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id       TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  name               TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  notes              TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  query              TEXT NOT NULL DEFAULT '' CHECK (length(query) <= 500),
  filters            TEXT NOT NULL DEFAULT '{}',    -- JSON object
  catalog_version    TEXT NOT NULL,
  visibility         TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'workspace', 'link')),
  share_token_hash   TEXT UNIQUE,                   -- sha256 of the sco_… link token (visibility = 'link')
  share_token_prefix TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS cohorts_owner ON cohorts (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS cohorts_workspace ON cohorts (workspace_id, updated_at DESC) WHERE workspace_id IS NOT NULL;

-- Exactly one of public_gse_id / private_study_id is set. The two partial
-- unique indexes are the SQLite spelling of Postgres
-- UNIQUE NULLS NOT DISTINCT (cohort_id, public_gse_id, private_study_id).
CREATE TABLE IF NOT EXISTS cohort_items (
  id               TEXT PRIMARY KEY,
  cohort_id        TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  public_gse_id    TEXT,
  private_study_id TEXT REFERENCES user_studies(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK ((public_gse_id IS NOT NULL) + (private_study_id IS NOT NULL) = 1)
);
CREATE INDEX IF NOT EXISTS cohort_items_cohort ON cohort_items (cohort_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS cohort_items_public_unique ON cohort_items (cohort_id, public_gse_id) WHERE public_gse_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cohort_items_private_unique ON cohort_items (cohort_id, private_study_id) WHERE private_study_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cohort_items_private_study ON cohort_items (private_study_id) WHERE private_study_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cohort_comments (
  id         TEXT PRIMARY KEY,
  cohort_id  TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS cohort_comments_cohort ON cohort_comments (cohort_id, created_at);

-- ── Activity feed, usage log, preferences ──────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('project_created', 'file_uploaded', 'file_registered', 'cohort_saved', 'comment_added', 'member_joined')),
  subject_id   TEXT,
  detail       TEXT NOT NULL DEFAULT '{}',          -- JSON object
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS activity_workspace ON activity_events (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  key_prefix TEXT,
  tool       TEXT NOT NULL CHECK (length(tool) BETWEEN 1 AND 80),
  kind       TEXT NOT NULL CHECK (kind IN ('mcp', 'api', 'download', 'partial_download')),
  calls      INTEGER NOT NULL DEFAULT 1 CHECK (calls > 0),
  bytes      INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  ms         INTEGER NOT NULL DEFAULT 0 CHECK (ms >= 0),
  day        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now')),   -- UTC date
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS usage_events_user_day ON usage_events (user_id, day DESC, kind, tool);

CREATE TABLE IF NOT EXISTS account_preferences (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  weekly_summary INTEGER NOT NULL DEFAULT 0 CHECK (weekly_summary IN (0, 1)),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
