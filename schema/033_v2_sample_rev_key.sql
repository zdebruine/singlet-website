-- 033_v2_sample_rev_key.sql — v2_sample keyed (gse_id, rev, gsm_id), so a new revision of a study is written BESIDE the served one.
--
-- 032 keyed v2_sample by (gse_id, gsm_id): posting a new rev of a study overwrote its sample rows one by one while v2_study still named the
-- old rev, and a reader listing the samples of that rev saw a mix. With the rev in the key, POST /api/ingest/v2-study writes the new rev's
-- rows (nobody reads them yet), flips v2_study.rev, and removes the older rows in the same transaction.
--
-- Rebuilds the table and keeps its rows (the tables are empty in production when this is written). Safe to run again: it renames whatever
-- v2_sample is, recreates it with the new key and copies the rows back. Apply BEFORE the code that writes the new key is merged:
--   npx wrangler d1 execute singlet-catalog --remote --file=schema/033_v2_sample_rev_key.sql
--
-- Row writes (D1 counts table and index rows): a new sample 3 (row, primary-key index, gsm_id index); a deleted sample 3.
DROP INDEX IF EXISTS idx_v2_sample_gsm;
ALTER TABLE v2_sample RENAME TO v2_sample_old;
CREATE TABLE v2_sample (
  gse_id          TEXT NOT NULL,
  gsm_id          TEXT NOT NULL,
  key             TEXT NOT NULL,
  bytes           INTEGER,
  sha256          TEXT,
  n_columns       INTEGER,
  n_called        INTEGER,
  n_members       INTEGER,
  median_umi      REAL,
  median_genes    REAL,
  modalities      TEXT,
  members_json    TEXT,
  cell_stats_json TEXT,
  rev             TEXT NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (gse_id, rev, gsm_id)
);
INSERT INTO v2_sample (gse_id, gsm_id, key, bytes, sha256, n_columns, n_called, n_members, median_umi, median_genes, modalities, members_json, cell_stats_json, rev, updated_at)
  SELECT gse_id, gsm_id, key, bytes, sha256, n_columns, n_called, n_members, median_umi, median_genes, modalities, members_json, cell_stats_json, rev, updated_at
    FROM v2_sample_old;
DROP TABLE v2_sample_old;
CREATE INDEX IF NOT EXISTS idx_v2_sample_gsm ON v2_sample (gsm_id);
