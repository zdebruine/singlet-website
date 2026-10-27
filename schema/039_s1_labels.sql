-- 039_s1_labels.sql — the .s1 per-cell labels (cell type, chromosomal sex, genetic ancestry; Singlet-Bio/singlet
-- docs/cell_annotation.md) as searchable sample and study facts. Public cell metadata: only the raw genotype inputs are private,
-- and none of them reach these tables.
--
--   sample_cell_summary  per sample and label term: the cells that carry it (exact CL / PATO / HANCESTRO ids, no roll-up). Loaded
--                        from the atlas cell index build (`scripts/s1_cidx_build.py --d1-export`, sample_cell_summary.csv) by
--                        `npm run s1:labels-sql`. Production already has this table (ontology work, 2026-10-23); same layout.
--   ontology_closure,    term -> ancestor pairs and term labels (production already has both, CL loaded); the cell-type roll-up and
--   ontology_term        the fact labels read them.
--   label_term           the labeller's vocabulary with labels (from the cell index directory, same loader).
--   sample_attr          (schema/030) gets source = 'pipeline' rows sex_genetic, ancestry_genetic and cell_type, derived from
--                        sample_cell_summary by functions/_shared/s1-labels.ts (labelFactsSql).
--   study_label          per study the label values its served samples carry (rolled up from sample_attr), for study search and
--                        facets (functions/_shared/search-core.ts, facets-core.ts).
--
-- Apply before merging the code that reads study_label (the facets read it on every search):
--   npx wrangler d1 execute singlet-catalog --remote --file=schema/039_s1_labels.sql
-- Safe to run again (IF NOT EXISTS throughout).
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

CREATE TABLE IF NOT EXISTS ontology_closure (
  term_id      TEXT NOT NULL,
  ancestor_id  TEXT NOT NULL,
  distance     INTEGER NOT NULL,
  PRIMARY KEY (ancestor_id, term_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS ontology_term (
  term_id      TEXT PRIMARY KEY,
  ontology     TEXT NOT NULL,
  label        TEXT NOT NULL,
  release      TEXT,
  depth        INTEGER
);

-- The labeller's own vocabulary (every term of the atlas cell index's cell_type / ancestry dictionaries, with its label): the cell-type
-- roll-up counts a call for an ancestor only when the ancestor is one of these, so "cell" or "eukaryotic cell" never become facts.
CREATE TABLE IF NOT EXISTS label_term (
  term_id    TEXT PRIMARY KEY,
  subject    TEXT NOT NULL CHECK (subject IN ('cell_type', 'ancestry')),
  label      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS study_label (
  gse_id      TEXT NOT NULL,
  attr        TEXT NOT NULL CHECK (attr IN ('sex_genetic', 'ancestry_genetic', 'cell_type')),
  value       TEXT NOT NULL,       -- sample_attr.value_norm: female / male, the HANCESTRO or CL label
  ontology_id TEXT,
  n_samples   INTEGER NOT NULL,    -- served samples of the study with this value
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (gse_id, attr, value)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_study_label_attr_value ON study_label (attr, value);
CREATE INDEX IF NOT EXISTS idx_study_label_attr_onto ON study_label (attr, ontology_id);
