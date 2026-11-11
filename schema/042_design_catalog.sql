-- Proposed D1 migration for curated study design, contrasts and per-sample processing status (Beta channel first).
-- Applies to singlet-website after schema/041. Additive only: no existing table or column changes.
-- Study keys follow s1_study (gse_id). Studies without a GEO series use their SRA study accession in gse_id (documented in the ingest body).

CREATE TABLE IF NOT EXISTS design_study (
  gse_id         TEXT PRIMARY KEY,
  tier           TEXT NOT NULL CHECK (tier IN ('confirmed','candidate','unresolved')),
  design_class   TEXT NOT NULL,
  summary        TEXT,
  prompt_version TEXT,
  model          TEXT,
  bundle_hash    TEXT,
  n_units        INTEGER,
  n_contrasts    INTEGER,
  paper_used     INTEGER NOT NULL DEFAULT 0,
  sidecar_key    TEXT,                -- s1/d/<study>.design.json in the data bucket
  rev            TEXT,                -- sidecar revision; a correction writes a new rev and keeps the old object addressable
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS design_factor (
  gse_id TEXT NOT NULL, factor_id TEXT NOT NULL, name TEXT, type TEXT, unit TEXT, source TEXT, confidence TEXT,
  PRIMARY KEY (gse_id, factor_id)
);
CREATE TABLE IF NOT EXISTS design_level (
  gse_id TEXT NOT NULL, factor_id TEXT NOT NULL, level_id TEXT NOT NULL, label TEXT, standard TEXT, role TEXT,
  ontology_ids TEXT,                  -- comma list, e.g. MONDO:0100096,PATO:0000461
  PRIMARY KEY (gse_id, factor_id, level_id)
);
CREATE INDEX IF NOT EXISTS design_level_onto ON design_level(ontology_ids);
-- The `unit` key: a GSM, or an origin within a GSM (GSM.o1) once demultiplexed. Until then a pooled library is one unit with
-- several design_unit_level rows (pooled = 1).
CREATE TABLE IF NOT EXISTS design_unit (
  gse_id TEXT NOT NULL, unit_id TEXT NOT NULL, gsm_id TEXT, library TEXT, biosample_key TEXT, donor TEXT,
  pool_type TEXT, pool_mapping TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',   -- mirrors sample_status.status for the unit's GSM
  PRIMARY KEY (gse_id, unit_id)
);
CREATE INDEX IF NOT EXISTS design_unit_gsm ON design_unit(gsm_id);
CREATE TABLE IF NOT EXISTS design_unit_level (
  gse_id TEXT NOT NULL, unit_id TEXT NOT NULL, factor_id TEXT NOT NULL, level_id TEXT NOT NULL, pooled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (gse_id, unit_id, factor_id, level_id)
);
CREATE TABLE IF NOT EXISTS design_contrast (
  gse_id TEXT NOT NULL, contrast_id TEXT NOT NULL, factor_id TEXT, factor_type TEXT, test TEXT, reference TEXT,
  symmetric INTEGER, kind TEXT, grade TEXT CHECK (grade IN ('A','B','C','D')), status TEXT, replication_unit TEXT,
  n_test INTEGER, n_reference INTEGER, pairing TEXT, confounds TEXT,
  PRIMARY KEY (gse_id, contrast_id)
);
CREATE INDEX IF NOT EXISTS design_contrast_type ON design_contrast(factor_type, grade);
CREATE TABLE IF NOT EXISTS design_contrast_attr (
  gse_id TEXT NOT NULL, contrast_id TEXT NOT NULL, attribute TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('shared','differs')), value TEXT, aligned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (gse_id, contrast_id, attribute, relation)
);

-- Per-sample processing status: the public, live view of campaign progress. One row per Beta sample (GSM, or SRS/ERS/DRS when the sample has no GEO record).
CREATE TABLE IF NOT EXISTS sample_status (
  sample_id   TEXT PRIMARY KEY,
  gse_id      TEXT,
  status      TEXT NOT NULL CHECK (status IN ('scheduled','held','running','counts_available','needs_debug')),
  reason      TEXT,                   -- held: multiplexing type from the hold table; needs_debug: short failure class
  object_url  TEXT,                   -- set with counts_available: https://beta-data.singlet.bio/s1/s/<GSM>/<digest>.s1
  assay       TEXT,
  read_pairs  INTEGER,
  attempt     INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS sample_status_study ON sample_status(gse_id, status);
CREATE INDEX IF NOT EXISTS sample_status_state ON sample_status(status);
