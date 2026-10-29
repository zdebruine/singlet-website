-- 041: the sample fact tables as they exist in production D1 (created on 2026-10-23 from the ontology-filters branch, never recorded
-- here). IF NOT EXISTS throughout, so applying it to production changes nothing; it gives tests and local databases the same shapes.
--
--   sample_term       ontology terms per sample: tissue (UBERON), disease (MONDO, PATO:0000461 normal), development_stage, sex, ancestry,
--                     cell_type (sorted, CL) and cell_line (Cellosaurus CVCL_xxxx, ./functions/_shared/sample-type.ts)
--   sample_property   derived values: donor_status, perturbation, sample_kind, tissue_type (CELLxGENE 7.0.0), tumor_sample_type (GDC)
--   ontology_term / ontology_label / ontology_closure   labels, synonyms and is_a / part_of ancestors of the terms samples use

CREATE TABLE IF NOT EXISTS sample_term (
  gsm_id         TEXT NOT NULL,
  gse_id         TEXT NOT NULL,
  attr           TEXT NOT NULL,
  term_id        TEXT NOT NULL,
  source         TEXT NOT NULL,      -- geo | model, from ontology_value_map
  confidence     REAL NOT NULL,
  from_attr      TEXT NOT NULL,      -- the sample_attr.attr it came from
  PRIMARY KEY (attr, term_id, gsm_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_sample_term_gsm ON sample_term (gsm_id);
CREATE INDEX IF NOT EXISTS idx_sample_term_gse ON sample_term (attr, term_id, gse_id);

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

CREATE TABLE IF NOT EXISTS ontology_term (
  term_id      TEXT PRIMARY KEY,
  ontology     TEXT NOT NULL,
  label        TEXT NOT NULL,
  release      TEXT,                 -- data-version of the OBO file the term was read from
  depth        INTEGER               -- shortest is_a/part_of path to a root
);

CREATE TABLE IF NOT EXISTS ontology_label (
  label_norm   TEXT NOT NULL,
  term_id      TEXT NOT NULL,
  ontology     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('id', 'label', 'exact')),
  PRIMARY KEY (label_norm, term_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS ontology_closure (
  term_id      TEXT NOT NULL,
  ancestor_id  TEXT NOT NULL,
  distance     INTEGER NOT NULL,
  PRIMARY KEY (ancestor_id, term_id)
) WITHOUT ROWID;
