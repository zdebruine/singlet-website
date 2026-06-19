-- Singlet-Bio D1 catalog schema v0.9.0
-- Run: wrangler d1 execute singlet-catalog --local --file schema/001_init.sql

PRAGMA journal_mode = WAL;

-- ── GSE (Series) ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gse (
  id                TEXT PRIMARY KEY,  -- e.g. GSE123456
  title             TEXT,
  abstract          TEXT,
  organism          TEXT,
  n_gsm_total       INTEGER NOT NULL DEFAULT 0,
  n_gsm_done        INTEGER NOT NULL DEFAULT 0,
  n_gsm_failed      INTEGER NOT NULL DEFAULT 0,
  n_cells           INTEGER NOT NULL DEFAULT 0,
  pubmed_ids        TEXT,              -- JSON array: ["12345678"]
  r2_bundle_key     TEXT,              -- R2 object key for the .1pz bundle
  r2_bundle_bytes   INTEGER,
  submitted_date    TEXT,
  last_updated      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── GSM (Sample) ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gsm (
  gsm_id            TEXT PRIMARY KEY,  -- e.g. GSM123456
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
  qc_flag           TEXT,              -- 'gold' | 'silver' | 'bronze' | null
  failure_category  TEXT,
  failure_detail    TEXT,
  singlet_version   TEXT,
  pipeline_date     TEXT,
  pz_size_bytes     INTEGER,
  title             TEXT,
  source            TEXT,
  srr_ids           TEXT,              -- JSON array: ["SRR123"]
  characteristics   TEXT,              -- JSON object
  last_updated      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── Publications ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS publications (
  pmid              TEXT PRIMARY KEY,
  title             TEXT,
  doi               TEXT,
  abstract          TEXT,
  year              INTEGER,
  journal           TEXT
);

-- ── GSE <-> Publication join ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gse_publication (
  gse_id            TEXT NOT NULL REFERENCES gse(id),
  pmid              TEXT NOT NULL REFERENCES publications(pmid),
  PRIMARY KEY (gse_id, pmid)
);

-- ── Meta cache (corpus-wide KV) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta_cache (
  key               TEXT PRIMARY KEY,
  value             TEXT NOT NULL,     -- JSON
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── FTS5 virtual tables ──────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS fts_gsm USING fts5(
  gsm_id,
  gse_id,
  title,
  source,
  tissue,
  cell_type,
  organism,
  disease,
  content='gsm',
  content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_gse USING fts5(
  id,
  title,
  abstract,
  organism,
  content='gse',
  content_rowid='rowid'
);

-- ── Triggers to keep FTS in sync ─────────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS gsm_ai AFTER INSERT ON gsm BEGIN
  INSERT INTO fts_gsm(rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease)
  VALUES (new.rowid, new.gsm_id, new.gse_id, new.title, new.source, new.tissue, new.cell_type, new.organism, new.disease);
END;

CREATE TRIGGER IF NOT EXISTS gsm_au AFTER UPDATE ON gsm BEGIN
  INSERT INTO fts_gsm(fts_gsm, rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease)
  VALUES ('delete', old.rowid, old.gsm_id, old.gse_id, old.title, old.source, old.tissue, old.cell_type, old.organism, old.disease);
  INSERT INTO fts_gsm(rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease)
  VALUES (new.rowid, new.gsm_id, new.gse_id, new.title, new.source, new.tissue, new.cell_type, new.organism, new.disease);
END;

CREATE TRIGGER IF NOT EXISTS gsm_ad AFTER DELETE ON gsm BEGIN
  INSERT INTO fts_gsm(fts_gsm, rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease)
  VALUES ('delete', old.rowid, old.gsm_id, old.gse_id, old.title, old.source, old.tissue, old.cell_type, old.organism, old.disease);
END;

CREATE TRIGGER IF NOT EXISTS gse_ai AFTER INSERT ON gse BEGIN
  INSERT INTO fts_gse(rowid, id, title, abstract, organism)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.organism);
END;

CREATE TRIGGER IF NOT EXISTS gse_au AFTER UPDATE ON gse BEGIN
  INSERT INTO fts_gse(fts_gse, rowid, id, title, abstract, organism)
  VALUES ('delete', old.rowid, old.id, old.title, old.abstract, old.organism);
  INSERT INTO fts_gse(rowid, id, title, abstract, organism)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.organism);
END;

CREATE TRIGGER IF NOT EXISTS gse_ad AFTER DELETE ON gse BEGIN
  INSERT INTO fts_gse(fts_gse, rowid, id, title, abstract, organism)
  VALUES ('delete', old.rowid, old.id, old.title, old.abstract, old.organism);
END;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_gsm_gse_id         ON gsm(gse_id);
CREATE INDEX IF NOT EXISTS idx_gsm_organism        ON gsm(organism);
CREATE INDEX IF NOT EXISTS idx_gsm_status          ON gsm(status);
CREATE INDEX IF NOT EXISTS idx_gsm_protocol        ON gsm(protocol);
CREATE INDEX IF NOT EXISTS idx_gsm_tissue          ON gsm(tissue);
CREATE INDEX IF NOT EXISTS idx_gsm_cell_type       ON gsm(cell_type);
CREATE INDEX IF NOT EXISTS idx_gsm_disease         ON gsm(disease);
CREATE INDEX IF NOT EXISTS idx_gsm_sex             ON gsm(sex);
CREATE INDEX IF NOT EXISTS idx_gsm_qc_flag         ON gsm(qc_flag);
CREATE INDEX IF NOT EXISTS idx_gsm_failure_category ON gsm(failure_category);
CREATE INDEX IF NOT EXISTS idx_gsm_n_cells         ON gsm(n_cells);
CREATE INDEX IF NOT EXISTS idx_gsm_pipeline_date   ON gsm(pipeline_date);
CREATE INDEX IF NOT EXISTS idx_gse_organism        ON gse(organism);
CREATE INDEX IF NOT EXISTS idx_gse_n_cells         ON gse(n_cells);
CREATE INDEX IF NOT EXISTS idx_gse_submitted_date  ON gse(submitted_date);
