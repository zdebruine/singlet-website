-- 022_low_qc.sql — sample quality control tiers (functions/_shared/qc-rules.ts, docs/QC.md).
--
-- Applied to production in three steps, in this order:
--   1. the ALTERs, before the code that reads the columns is deployed (old code ignores them);
--   2. deploy the code (every read tolerates NULL tiers: NULL counts as tier 0);
--   3. the tier backfill and the study totals below.
-- Step 3 statements are safe to re-run. Re-run them after changing a threshold in qc-rules.ts.
--
-- Tiers:  0 passed QC   1 low QC (median genes < 30 OR reads mapped < 20%)   2 removed (mapped < 5% AND median genes < 10)
-- gse_meta.n_usable_samples / n_usable_cells now count tier-0 samples only (so DOWNLOADABLE_SQL, the headline and
-- default searches leave low-QC samples out); n_lowqc_samples / n_lowqc_cells count tier 1.

-- ── 1. columns (ensureCatalogColumns adds them on first use too; a second run fails harmlessly) ──
ALTER TABLE sample_qc ADD COLUMN qc_tier INTEGER;
ALTER TABLE gse_meta ADD COLUMN n_lowqc_samples INTEGER;
ALTER TABLE gse_meta ADD COLUMN n_lowqc_cells INTEGER;

-- ── 3a. tier for every sample that has count data ───────────────────────────────
UPDATE sample_qc
   SET qc_tier = CASE
         WHEN median_genes IS NOT NULL AND mapping_rate IS NOT NULL AND mapping_rate < 0.05 AND median_genes < 10 THEN 2
         WHEN median_genes < 30 OR mapping_rate < 0.2 THEN 1
         ELSE 0 END
 WHERE usable = 1;

-- ── 3b. study totals for every study QC touched ─────────────────────────────────
UPDATE gse_meta
   SET n_usable_samples = (SELECT COUNT(*) FROM sample_qc q WHERE q.gse_id = gse_meta.gse_id AND q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0),
       n_usable_cells   = (SELECT COALESCE(SUM(q.n_cells_called), 0) FROM sample_qc q WHERE q.gse_id = gse_meta.gse_id AND q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0),
       n_lowqc_samples  = (SELECT COUNT(*) FROM sample_qc q WHERE q.gse_id = gse_meta.gse_id AND q.usable = 1 AND q.qc_tier = 1),
       n_lowqc_cells    = (SELECT COALESCE(SUM(q.n_cells_called), 0) FROM sample_qc q WHERE q.gse_id = gse_meta.gse_id AND q.usable = 1 AND q.qc_tier = 1)
 WHERE gse_id IN (SELECT DISTINCT gse_id FROM sample_qc WHERE usable = 1 AND qc_tier >= 1)
    OR n_lowqc_samples > 0;

-- ── 3c. everything else has no low-QC samples ───────────────────────────────────
UPDATE gse_meta SET n_lowqc_samples = 0, n_lowqc_cells = 0 WHERE n_lowqc_samples IS NULL;
