-- 032_v2_catalog.sql — the v2 catalog: which studies and samples exist as immutable v2 objects, where their members
-- sit inside those objects, and how far each study's migration from the legacy bundle has got.
-- Spec: docs/format-v2.md (singlet-bio repo) sections 2, 7, 8 and 10; docs/v2-migration.md D2, D10.
--
-- Written only by POST /api/ingest/v2-study (functions/api/ingest/v2-study.ts) from a study manifest
-- (v2/m/<GSE>.json). Nothing reads these tables until a study is posted, and every reader treats a missing
-- table or a missing study as "not migrated, answer from the legacy bundle".
--
-- Apply BEFORE merging the code that reads them (all statements are idempotent):
--   npx wrangler d1 execute singlet-catalog --remote --file=schema/032_v2_catalog.sql
--
-- Read budget (CLAUDE.md): sample rows are fetched by primary key or by (gse_id) prefix, and the large JSON columns
-- (members_json, cell_stats_json) are only selected for one sample at a time or for an explicit page of samples.
-- Never json_each over v2_sample without a gse_id predicate.

-- One row per study that has a v2 manifest.
CREATE TABLE IF NOT EXISTS v2_study (
  gse_id          TEXT PRIMARY KEY,
  manifest_key    TEXT NOT NULL,                 -- v2/m/<GSE>.json (mutable, max-age 300 at the edge)
  rev             TEXT NOT NULL,                 -- 16 hex: digest of the sorted sample keys + study files; the "unchanged since" token
  bytes           INTEGER,                       -- total size of the study's sample objects
  n_samples       INTEGER NOT NULL,
  created_at      TEXT,                          -- manifest created_at
  legacy_bytes    INTEGER,                       -- size of the legacy bundle this study replaced
  manifest_bytes  INTEGER,                       -- size and SHA-256 of the manifest object itself, as uploaded
  manifest_sha256 TEXT,
  n_cells_called  INTEGER,                       -- sum of n_called over the samples
  reference_build TEXT,
  packs_json      TEXT,                          -- {"exon": id, "intron": id, "whitelist": id|null}: pack ids, small
  pipeline_json   TEXT,                          -- manifest "pipeline" block, small
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- One row per (study, sample) object. The primary key is (gse_id, gsm_id) and not gsm_id alone: a SuperSeries and its
-- SubSeries pack the same GSM (sample_qc has to special-case this, see index-next), and their manifests may point at
-- different objects for it.
CREATE TABLE IF NOT EXISTS v2_sample (
  gse_id          TEXT NOT NULL,
  gsm_id          TEXT NOT NULL,
  key             TEXT NOT NULL,                 -- v2/s/<GSM>/<32 hex>.s2 (immutable, content-addressed)
  bytes           INTEGER,
  sha256          TEXT,
  n_columns       INTEGER,                       -- matrix columns (barcodes) in the cells table
  n_called        INTEGER,                       -- called cells
  n_members       INTEGER,
  median_umi      REAL,                          -- from stats; typed so depth filters run in SQL
  median_genes    REAL,
  modalities      TEXT,                          -- JSON array of modality names present (public members only)
  members_json    TEXT,                          -- {member: {kind, off, len, digest, chunk_cols, chunk_index, nnz, ...}} for ONE sample
  cell_stats_json TEXT,                          -- manifest "stats" block: quantiles etc.
  rev             TEXT NOT NULL,                 -- study rev this row was written under; rows of an older rev are removed on the final post
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (gse_id, gsm_id)
);
CREATE INDEX IF NOT EXISTS idx_v2_sample_gsm ON v2_sample (gsm_id);

-- Migration state per study. status: pending | running | uploaded | verified | failed | retired.
-- A study is served from v2 when it has a v2_study row and either no row here or status verified/retired.
-- The full history is the ledger object (v2/ledger/<GSE>.jsonl); this row is its latest line.
CREATE TABLE IF NOT EXISTS v2_migration (
  gse_id       TEXT PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'running', 'uploaded', 'verified', 'failed', 'retired')),
  legacy_key   TEXT,                             -- data/<GSE>/<GSE>.singlet
  legacy_etag  TEXT,
  legacy_bytes INTEGER,
  v2_bytes     INTEGER,
  n_samples    INTEGER,
  members_by_kind TEXT,                          -- JSON counts of members per treatment (matrix / recipe / stored / raw), small
  verify_ok    INTEGER,                          -- 1 when the bit-for-bit verification passed
  commit_sha   TEXT,                             -- code that ran the migration
  migrated_at  TEXT,
  verified_at  TEXT,
  ledger_key   TEXT,
  error        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_migration_status ON v2_migration (status);
