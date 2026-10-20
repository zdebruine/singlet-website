-- Search facts (docs/SEARCH-ROADMAP.md, T1): typed sample facts with provenance, study data cards, and the
-- .1pz chunk map the cohort manifest reads. All CREATE ... IF NOT EXISTS; nothing reads these tables until the
-- code that fills them ships, and /api/cohort/manifest treats a missing pz_chunk_index as "no chunk plan".
--
--   wrangler d1 execute singlet-catalog --remote --file=schema/030_search_facts.sql
--
-- Not applied to production by the PR that added this file.

-- One row per fact. `source` is geo (declared by the submitter), pipeline (computed from reads) or model
-- (inferred, with confidence and the text it was read from). A model row sits beside a geo row, never over it.
CREATE TABLE IF NOT EXISTS sample_attr (
  gsm_id            TEXT NOT NULL,
  gse_id            TEXT NOT NULL,
  attr              TEXT NOT NULL,      -- closed list, see the roadmap section 4.1
  value_raw         TEXT,               -- as written in GEO
  value_norm        TEXT NOT NULL DEFAULT '',  -- normalised label; part of the key so one source can state several values
  ontology_id       TEXT,               -- UBERON:..., MONDO:..., CL:..., NULL when none applies
  unit              TEXT,
  value_num         REAL,               -- age, timepoint, depth
  source            TEXT NOT NULL CHECK (source IN ('geo', 'pipeline', 'model')),
  confidence        REAL,               -- NULL for geo and pipeline
  evidence          TEXT,               -- the key: value pair or text span the fact was read from
  extractor_version TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (gsm_id, attr, source, value_norm)
);
CREATE INDEX IF NOT EXISTS idx_sample_attr_attr_value ON sample_attr (attr, value_norm);
CREATE INDEX IF NOT EXISTS idx_sample_attr_attr_onto  ON sample_attr (attr, ontology_id);
CREATE INDEX IF NOT EXISTS idx_sample_attr_gse_attr   ON sample_attr (gse_id, attr);

-- One grounded card per study. grounded = 1 only when every entity in card_json resolves to a sample_attr,
-- sample_qc, bundle_manifest or gse_meta fact; ungrounded cards are not searched.
CREATE TABLE IF NOT EXISTS study_card (
  gse_id            TEXT PRIMARY KEY,
  card_json         TEXT NOT NULL,
  summary_text      TEXT,
  extractor_version TEXT NOT NULL,
  model             TEXT,
  grounded          INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_study_card_grounded ON study_card (grounded);

-- Column-chunk map of one .1pz entry, read from its header and footer. chunk_offsets is a JSON array of
-- n_chunks + 1 byte offsets relative to the first payload byte of the zip entry (chunk c spans
-- [o[c], o[c+1]) and o[0] is the header size). Together with bundle_index (zip entry offsets) it gives the
-- byte range of any chunk of a public file.
CREATE TABLE IF NOT EXISTS pz_chunk_index (
  gsm_id            TEXT NOT NULL,
  gse_id            TEXT NOT NULL,
  file              TEXT NOT NULL,      -- exon_counts.1pz, intron_counts.1pz, ...
  n_cols            INTEGER NOT NULL,   -- cells (columns)
  chunk_cols        INTEGER NOT NULL,   -- columns per chunk
  chunk_offsets     TEXT NOT NULL,      -- JSON array, n_chunks + 1 numbers
  perm_present      INTEGER NOT NULL DEFAULT 0,
  extractor_version TEXT,
  indexed_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (gsm_id, file)
);
CREATE INDEX IF NOT EXISTS idx_pz_chunk_index_gse ON pz_chunk_index (gse_id);
