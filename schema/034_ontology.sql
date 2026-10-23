-- Ontology slice for sample filters (docs/ONTOLOGY.md). Terms used by the catalog and all their ancestors, the
-- (term, ancestor) closure over is_a and part_of, the labels a filter value may name, the value -> term map
-- scripts/ontology/ builds from sample_attr, and the per-sample terms the search filters read.
-- All CREATE ... IF NOT EXISTS; nothing reads these tables until code that uses them ships, and the search
-- filters match nothing (rather than fail) while they are empty.
--
--   wrangler d1 execute singlet-catalog --remote --file=schema/034_ontology.sql
--
-- Not applied to production by the PR that added this file.

-- One row per term in the slice. `ontology` is the id prefix (UBERON, CL, MONDO, PATO, HANCESTRO, HsapDv, MmusDv).
CREATE TABLE IF NOT EXISTS ontology_term (
  term_id      TEXT PRIMARY KEY,
  ontology     TEXT NOT NULL,
  label        TEXT NOT NULL,
  release      TEXT,                 -- data-version of the OBO file the term was read from
  depth        INTEGER               -- shortest is_a/part_of path to a root
);
CREATE INDEX IF NOT EXISTS idx_ontology_term_ontology ON ontology_term (ontology);

-- Every (term, ancestor) pair, the term itself included at distance 0. is_a for every ontology, part_of as well
-- for UBERON and the developmental-stage ontologies ("lung" includes "lobe of lung", "adult stage" includes
-- "sixth decade stage").
CREATE TABLE IF NOT EXISTS ontology_closure (
  term_id      TEXT NOT NULL,
  ancestor_id  TEXT NOT NULL,
  distance     INTEGER NOT NULL,
  PRIMARY KEY (ancestor_id, term_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_ontology_closure_term ON ontology_closure (term_id);

-- Names a filter value may use: the id lowercased (kind 'id'), the primary label and exact synonyms, normalised
-- as functions/_shared/ontology.ts normLabel does.
CREATE TABLE IF NOT EXISTS ontology_label (
  label_norm   TEXT NOT NULL,
  term_id      TEXT NOT NULL,
  ontology     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('id', 'label', 'exact')),
  PRIMARY KEY (label_norm, term_id)
) WITHOUT ROWID;

-- One row per distinct sample_attr value and the term it maps to. `organism` is '' when the mapping holds for any
-- species (tissue, cell type, disease, sex, ancestry) and the scientific name when it does not (age, life_stage).
-- method: id (the value is an ontology id), label, exact_synonym, synonym (related/narrow), variant (after
-- removing qualifiers such as "human" or plural endings), curated (scripts/ontology/aliases.ts), stage (age
-- placed in a stage's start/end interval), model (chosen by a model among candidate terms; source = 'model').
-- Values with no defensible term have no row.
CREATE TABLE IF NOT EXISTS ontology_value_map (
  attr           TEXT NOT NULL,      -- sample_attr.attr
  organism       TEXT NOT NULL DEFAULT '',
  value_norm     TEXT NOT NULL,
  term_id        TEXT NOT NULL,
  method         TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('geo', 'model')),
  confidence     REAL NOT NULL,
  evidence       TEXT,               -- the label or synonym matched, or the model's reason
  mapper_version TEXT NOT NULL,
  PRIMARY KEY (attr, organism, value_norm, term_id)
);

-- Per-sample terms, filled from sample_attr x ontology_value_map by scripts/ontology/refresh.sql. attr is the
-- filter attribute: tissue, cell_type (from cell_type_sorted), development_stage (from age and life_stage),
-- disease, ancestry, sex.
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

-- Downloadable samples and studies under each term, descendants included (the basis of the headline numbers).
-- Read by /api/ontology/terms for the Browse picker; refreshed with sample_term.
CREATE TABLE IF NOT EXISTS ontology_term_count (
  attr         TEXT NOT NULL,
  term_id      TEXT NOT NULL,
  n_samples    INTEGER NOT NULL,
  n_studies    INTEGER NOT NULL,
  n_direct     INTEGER NOT NULL,     -- samples mapped to this exact term
  PRIMARY KEY (attr, term_id)
);
