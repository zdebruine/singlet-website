-- Tier-1 tables for cell search (docs/CELL-ARCHITECTURE.md): derived sample properties, the registry of per-cell features,
-- and per-sample summaries of cell labels and features. No per-cell rows: cells live in R2 (cell-index shards, feature
-- sidecars) and are joined by (sample ordinal, col).
--
--   wrangler d1 execute singlet-catalog --remote --file=schema/035_cell_tier.sql
--
-- All CREATE ... IF NOT EXISTS.

-- Properties derived per sample from its facts (scripts/ontology/properties.sql), one closed vocabulary per property:
--   donor_status   healthy | diseased            (sample_term disease: PATO:0000461 normal vs a MONDO term)
--   perturbation   none | treated | genetic      (sample_attr treatment_status, genotype)
--   sample_kind    primary | cell_line | organoid | xenograft   (sample_attr sample_type, tissue values)
-- A sample with conflicting evidence for a property gets no row for it.
CREATE TABLE IF NOT EXISTS sample_property (
  gsm_id      TEXT NOT NULL,
  gse_id      TEXT NOT NULL,
  property    TEXT NOT NULL,
  value       TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('geo', 'pipeline', 'model')),
  confidence  REAL NOT NULL,
  evidence    TEXT,
  version     TEXT NOT NULL,
  PRIMARY KEY (property, value, gsm_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_sample_property_gsm ON sample_property (gsm_id);
CREATE INDEX IF NOT EXISTS idx_sample_property_gse ON sample_property (property, value, gse_id);

-- Value-level rules behind sample_property (scripts/ontology/properties.ts, written by build.ts --props). `match_on` says
-- which sample_attr column `value` is compared with: value_norm, or value_raw where value_norm only names the key
-- (sample_type "cell line: K562" has value_norm 'cell line').
CREATE TABLE IF NOT EXISTS property_value_map (
  attr        TEXT NOT NULL,
  match_on    TEXT NOT NULL CHECK (match_on IN ('value_norm', 'value_raw')),
  value       TEXT NOT NULL,
  property    TEXT NOT NULL,
  prop_value  TEXT NOT NULL,
  confidence  REAL NOT NULL,
  evidence    TEXT,
  version     TEXT NOT NULL,
  PRIMARY KEY (attr, match_on, value, property, prop_value)
);

-- One row per per-cell feature that is computed atlas-wide and can be searched. A feature belongs to a feature set (one
-- sidecar object per sample and set, or core columns of the cell-index shards). Scores are in [0, 1] and stored as u8
-- (round(x * 254), 255 = NA); categories as u16 codes with `categories` naming them.
CREATE TABLE IF NOT EXISTS cell_feature (
  feature_id     TEXT PRIMARY KEY,   -- '<set>/<name>', e.g. 'hallmark-2023.1/HALLMARK_HYPOXIA', 'malignancy-cnv-1/score'
  feature_set    TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('score', 'category', 'flag')),
  label          TEXT NOT NULL,
  description    TEXT,
  method         TEXT NOT NULL,      -- e.g. 'rank-auc', 'cnv-inference', 'guide-call'
  method_version TEXT NOT NULL,
  source_ref     TEXT,               -- gene-set collection and release, reference panel, or model
  licence        TEXT,               -- licence of the gene set / reference (the atlas is CC0)
  organisms      TEXT,               -- JSON array of scientific names
  ontology_id    TEXT,               -- the term the feature is about, when there is one (GO, CL, ...)
  categories     TEXT,               -- JSON array, kind = 'category'
  thresholds     TEXT NOT NULL DEFAULT '[0.5, 0.8]',  -- JSON: the two cut-offs sample_cell_summary counts
  -- 'atlas': the value means the same in every study (cell-intrinsic rank statistic, fixed reference), so it may be
  -- filtered across studies; 'sample': calibrated within a sample (e.g. z against the sample's own null), comparable
  -- between cells of one sample only, never used as a cross-study filter.
  comparable     TEXT NOT NULL DEFAULT 'atlas' CHECK (comparable IN ('atlas', 'sample')),
  storage        TEXT NOT NULL CHECK (storage IN ('shard', 'sidecar')),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_cell_feature_set ON cell_feature (feature_set);

-- Per sample, per cell label term or feature: what a query needs to count cells and prune samples without reading cells.
--   subject 'cell_type' | 'sex' | 'ancestry'  item = the ontology id the cells were labelled with (exact term; ancestors
--                                              are summed through ontology_closure at query time)
--   subject 'feature'                         item = cell_feature.feature_id
-- n_cells: labelled cells (label) or cells with a value (feature); n_hi1 / n_hi2: cells at or above the feature's two
-- thresholds (for a label: cells whose label score is at or above them); q50/q90/mean over the cells with a value.
-- Written by the annotation and feature jobs through POST /api/ingest/sample_cell_summary; replaced per (sample, version).
CREATE TABLE IF NOT EXISTS sample_cell_summary (
  gsm_id     TEXT NOT NULL,
  gse_id     TEXT NOT NULL,
  subject    TEXT NOT NULL CHECK (subject IN ('cell_type', 'sex', 'ancestry', 'feature')),
  item       TEXT NOT NULL,
  n_cells    INTEGER NOT NULL,
  n_hi1      INTEGER,
  n_hi2      INTEGER,
  q50        REAL,
  q90        REAL,
  mean       REAL,
  version    TEXT NOT NULL,        -- labels model_version or feature method_version
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (subject, item, gsm_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_sample_cell_summary_gsm ON sample_cell_summary (gsm_id);
CREATE INDEX IF NOT EXISTS idx_sample_cell_summary_gse ON sample_cell_summary (subject, item, gse_id);
