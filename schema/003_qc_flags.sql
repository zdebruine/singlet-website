-- 003_qc_flags.sql — surface the pipeline's per-sample QC verdict in the catalog.
--
-- Run: wrangler d1 execute singlet-catalog --remote --file schema/003_qc_flags.sql
--
-- Background
-- ----------
-- scripts/pipeline/backfill_qc_flags.py has always computed a per-sample verdict
-- (HEALTHY / WARN / LOW_QUALITY) but only ever wrote it to a TSV, so gsm.qc_flag
-- stayed ~98.6% NULL and the strongest quality signal in the project was
-- invisible on the website. The write path is POST /api/ingest/gsm_qc.
--
-- The v0.9.0 schema comment described a 'gold'|'silver'|'bronze' vocabulary that
-- nothing ever produced; this migration adopts the vocabulary the pipeline
-- actually emits and migrates any legacy values.

-- Human-readable reasons behind a WARN / LOW_QUALITY verdict, e.g.
-- "core_metric_low=0.211;vbc_soft=0.42". Null for HEALTHY.
ALTER TABLE gsm ADD COLUMN qc_reasons TEXT;

-- Map the never-used legacy vocabulary onto the real one.
UPDATE gsm SET qc_flag = 'HEALTHY'     WHERE qc_flag = 'gold';
UPDATE gsm SET qc_flag = 'WARN'        WHERE qc_flag = 'silver';
UPDATE gsm SET qc_flag = 'LOW_QUALITY' WHERE qc_flag = 'bronze';

-- Anything outside the closed vocabulary is not a verdict we can defend.
UPDATE gsm SET qc_flag = NULL
 WHERE qc_flag IS NOT NULL
   AND qc_flag NOT IN ('HEALTHY', 'WARN', 'LOW_QUALITY');

-- idx_gsm_qc_flag already exists (001_init.sql). This one serves the common
-- "healthy samples in this study" lookup.
CREATE INDEX IF NOT EXISTS idx_gsm_gse_qc ON gsm(gse_id, qc_flag);
