-- Singlet-Bio D1 catalog schema v0.9.0 — LOCAL DEV, NO FTS5
-- FTS5 virtual tables are not supported in wrangler local D1 sandbox.
-- This file creates the base tables only.
-- Production: use 001_init.sql which includes FTS5 + triggers.

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS gse (
  id                TEXT PRIMARY KEY,
  title             TEXT,
  abstract          TEXT,
  organism          TEXT,
  n_gsm_total       INTEGER NOT NULL DEFAULT 0,
  n_gsm_done        INTEGER NOT NULL DEFAULT 0,
  n_gsm_failed      INTEGER NOT NULL DEFAULT 0,
  n_cells           INTEGER NOT NULL DEFAULT 0,
  pubmed_ids        TEXT,
  r2_bundle_key     TEXT,
  r2_bundle_bytes   INTEGER,
  submitted_date    TEXT,
  last_updated      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS gsm (
  gsm_id            TEXT PRIMARY KEY,
  gse_id            TEXT NOT NULL REFERENCES gse(id),
  organism          TEXT,
  protocol          TEXT,
  modality          TEXT,
  tissue            TEXT,
  cell_type         TEXT,
  donor_id          TEXT,
  disease           TEXT,
  sex               TEXT,
  n_cells           INTEGER,
  mapping_rate      REAL,
  median_genes      REAL,
  median_umis       REAL,
  mt_pct            REAL,
  status            TEXT NOT NULL DEFAULT 'PENDING',
  qc_flag           TEXT,
  failure_category  TEXT,
  failure_detail    TEXT,
  singlet_version   TEXT,
  pipeline_date     TEXT,
  pz_size_bytes     INTEGER,
  title             TEXT,
  source            TEXT,
  srr_ids           TEXT,
  characteristics   TEXT,
  last_updated      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS publications (
  pmid              TEXT PRIMARY KEY,
  title             TEXT,
  doi               TEXT,
  abstract          TEXT,
  year              INTEGER,
  journal           TEXT
);

CREATE TABLE IF NOT EXISTS gse_publication (
  gse_id            TEXT NOT NULL REFERENCES gse(id),
  pmid              TEXT NOT NULL REFERENCES publications(pmid),
  PRIMARY KEY (gse_id, pmid)
);

CREATE TABLE IF NOT EXISTS meta_cache (
  key               TEXT PRIMARY KEY,
  value             TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_gsm_gse_id          ON gsm(gse_id);
CREATE INDEX IF NOT EXISTS idx_gsm_organism         ON gsm(organism);
CREATE INDEX IF NOT EXISTS idx_gsm_status           ON gsm(status);
CREATE INDEX IF NOT EXISTS idx_gsm_protocol         ON gsm(protocol);
CREATE INDEX IF NOT EXISTS idx_gsm_tissue           ON gsm(tissue);
CREATE INDEX IF NOT EXISTS idx_gsm_cell_type        ON gsm(cell_type);
CREATE INDEX IF NOT EXISTS idx_gsm_disease          ON gsm(disease);
CREATE INDEX IF NOT EXISTS idx_gsm_sex              ON gsm(sex);
CREATE INDEX IF NOT EXISTS idx_gsm_qc_flag          ON gsm(qc_flag);
CREATE INDEX IF NOT EXISTS idx_gsm_failure_category ON gsm(failure_category);
CREATE INDEX IF NOT EXISTS idx_gsm_n_cells          ON gsm(n_cells);
CREATE INDEX IF NOT EXISTS idx_gsm_pipeline_date    ON gsm(pipeline_date);
CREATE INDEX IF NOT EXISTS idx_gse_organism         ON gse(organism);
CREATE INDEX IF NOT EXISTS idx_gse_n_cells          ON gse(n_cells);
CREATE INDEX IF NOT EXISTS idx_gse_submitted_date   ON gse(submitted_date);
