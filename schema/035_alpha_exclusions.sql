-- 035_alpha_exclusions.sql — Research Alpha: samples and studies that are not part of singlet.bio.
--
-- Samples processed incorrectly (wrong strand, a non-RNA library processed as RNA, an empty count matrix) are not in the atlas:
-- no count, search result, facet, study page, sample table, manifest, sitemap entry, MCP answer or download link mentions them.
-- A study left with no sample is withheld: it answers 404 like an unknown study. docs/RESEARCH_ALPHA_PLAN.md §0 and §2b.
--
--   alpha_exclusions  one row per excluded sample (GSM). `reason` is a comma-separated list (strand, non_rna, empty); it is for
--                     internal tools only and never served.
--   alpha_withheld    one row per withheld study (GSE).
--
-- Both are filled by scripts/alpha/load-exclusions.ts from the census TSVs (idempotent upserts) and read by every public query
-- (functions/_shared/alpha.ts). They are data, so a later list (mouse strand) is a new load, not a code change.
--
-- Apply once, BEFORE loading the lists and before merging the code that reads them:
--   npx wrangler d1 execute singlet-catalog --remote --file=schema/035_alpha_exclusions.sql
-- Safe to run again (IF NOT EXISTS throughout).
CREATE TABLE IF NOT EXISTS alpha_exclusions (
  gsm_id         TEXT PRIMARY KEY,
  gse_id         TEXT NOT NULL,
  reason         TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_alpha_exclusions_gse ON alpha_exclusions(gse_id);

CREATE TABLE IF NOT EXISTS alpha_withheld (
  gse_id         TEXT PRIMARY KEY,
  reason         TEXT,
  policy_version TEXT NOT NULL,
  added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- @triggers (the test helper creates the tables above for every test database and these only where sample_qc and gse_meta exist)
--
-- gse_meta.n_usable_* are per-study rollups of sample_qc. Two writes used to leave them stale, which is why /api/stats and
-- /api/search disagreed from 2026-10-24 (54,676 against 54,746 samples): sample_qc is keyed on gsm_id alone, so when a second
-- study's file holds the same GSMs (a SuperSeries and its SubSeries) indexing it moves the rows to that study, and the first
-- study kept counting them. Each trigger marks the affected study stale (n_usable_samples = NULL), so the catalog crank
-- (/api/ingest/refresh-next, every 3 h) recomputes it.
CREATE TRIGGER IF NOT EXISTS trg_sample_qc_moved AFTER UPDATE OF gse_id ON sample_qc
  WHEN OLD.gse_id IS NOT NEW.gse_id
BEGIN
  UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = OLD.gse_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_alpha_exclusion_added AFTER INSERT ON alpha_exclusions
BEGIN
  UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = NEW.gse_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_alpha_exclusion_removed AFTER DELETE ON alpha_exclusions
BEGIN
  UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = OLD.gse_id;
END;
