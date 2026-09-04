-- Local mirror of the D1 `singlet-catalog` schema (subset used by the API).
CREATE TABLE IF NOT EXISTS gse (
  id TEXT PRIMARY KEY,
  title TEXT,
  abstract TEXT,
  organism TEXT,
  n_gsm_total INTEGER DEFAULT 0,
  n_gsm_done INTEGER DEFAULT 0,
  n_gsm_failed INTEGER DEFAULT 0,
  n_cells INTEGER DEFAULT 0,
  pubmed_ids TEXT DEFAULT '[]',
  r2_bundle_key TEXT,
  r2_bundle_bytes INTEGER,
  submitted_date TEXT,
  last_updated TEXT
);

CREATE TABLE IF NOT EXISTS gsm (
  gsm_id TEXT PRIMARY KEY,
  gse_id TEXT NOT NULL,
  organism TEXT,
  organism_primary TEXT,
  protocol TEXT,
  assay_family TEXT,
  modality TEXT,
  tissue TEXT,
  tissue_group TEXT,
  cell_type TEXT,
  donor_id TEXT,
  disease TEXT,
  disease_group TEXT,
  sex TEXT,
  n_cells INTEGER,
  mapping_rate REAL,
  median_genes INTEGER,
  median_umis INTEGER,
  mt_pct REAL,
  status TEXT,
  qc_flag TEXT,
  failure_category TEXT,
  failure_detail TEXT,
  singlet_version TEXT,
  pipeline_date TEXT,
  pz_size_bytes INTEGER,
  title TEXT,
  source TEXT,
  srr_ids TEXT DEFAULT '[]',
  characteristics TEXT,
  last_updated TEXT
);
CREATE INDEX IF NOT EXISTS idx_gsm_gse ON gsm(gse_id);
CREATE INDEX IF NOT EXISTS idx_gsm_org ON gsm(organism_primary);
CREATE INDEX IF NOT EXISTS idx_gsm_tissue_group ON gsm(tissue_group);

CREATE TABLE IF NOT EXISTS gse_meta (
  gse_id TEXT PRIMARY KEY,
  organism_primary TEXT,
  organisms TEXT DEFAULT '[]',
  tissue_groups TEXT DEFAULT '[]',
  disease_groups TEXT DEFAULT '[]',
  assay_families TEXT DEFAULT '[]',
  tissues_raw TEXT DEFAULT '[]',
  cell_types_raw TEXT DEFAULT '[]',
  n_conditions INTEGER DEFAULT 0,
  n_done INTEGER DEFAULT 0,
  n_total INTEGER DEFAULT 0,
  n_cells INTEGER DEFAULT 0,
  has_bundle INTEGER DEFAULT 0,
  year INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS vocab_rules (
  field TEXT NOT NULL,
  priority INTEGER NOT NULL,
  grp TEXT NOT NULL,
  match_type TEXT NOT NULL,
  pattern TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta_cache (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS publications (
  pmid TEXT PRIMARY KEY, title TEXT, doi TEXT, abstract TEXT, year INTEGER, journal TEXT
);
CREATE TABLE IF NOT EXISTS gse_publication (gse_id TEXT, pmid TEXT);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_gse USING fts5(id, title, abstract, organism, tokenize='unicode61');
CREATE VIRTUAL TABLE IF NOT EXISTS fts_gsm USING fts5(
  gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics, tokenize='unicode61'
);
