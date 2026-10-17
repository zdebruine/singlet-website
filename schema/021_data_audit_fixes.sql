-- 021_data_audit_fixes.sql — PROPOSED data corrections from the 2026-10-17 audit (docs/DATA-AUDIT.md).
-- NOT APPLIED. Run only after the code that goes with it is deployed, one statement at a time:
--   wrangler d1 execute singlet-catalog --remote --command "<statement>"

-- 1. Genus-only organism names (normOrganism now resolves these; existing rows still hold the old value).
UPDATE gsm SET organism_primary = 'Mus musculus'  WHERE organism_primary = 'Mus';
UPDATE gsm SET organism_primary = 'Homo sapiens'  WHERE organism_primary = 'Homo';
-- Mark the affected studies for recomputation; the catalog crank rebuilds gse_meta from gsm.
UPDATE gse_meta SET n_usable_samples = NULL
 WHERE gse_id IN (SELECT DISTINCT gse_id FROM gsm WHERE organism IN ('Mus', 'Homo') OR organism LIKE 'Homo;%' OR organism LIKE 'Mus;%');

-- 2. Retired qc_flag vocabulary (migration 003 mapped gold to HEALTHY; the audit found 350 downloadable
--    gold samples with a median under 30 genes per cell, so these verdicts are cleared instead).
UPDATE gsm SET qc_flag = NULL WHERE qc_flag IN ('gold', 'silver', 'bronze');
