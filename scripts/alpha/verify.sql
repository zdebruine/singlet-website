-- Read-only check after loading the Research Alpha lists (scripts/alpha/load-exclusions.ts):
--   npx wrangler d1 execute singlet-catalog --remote --file=scripts/alpha/verify.sql
-- 1. what was loaded; 2. the headline the site serves, computed two ways (stats basis and search basis), which must agree;
-- 3. downloadable studies whose rollup still disagrees with sample_qc (must be 0).
SELECT policy_version, COUNT(*) AS excluded_samples, COUNT(DISTINCT gse_id) AS studies, SUM(reason = 'unspecified') AS placed_from_catalog
  FROM alpha_exclusions GROUP BY policy_version;
SELECT policy_version, COUNT(*) AS withheld_studies FROM alpha_withheld GROUP BY policy_version;

SELECT
  (SELECT COUNT(*) FROM gse_meta m
    WHERE m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM alpha_withheld w WHERE w.gse_id = m.gse_id)) AS studies,
  (SELECT COUNT(*) FROM sample_qc q WHERE q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM alpha_exclusions x WHERE x.gsm_id = q.gsm_id)
      AND q.gse_id IN (SELECT m.gse_id FROM gse_meta m WHERE m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
                         AND NOT EXISTS (SELECT 1 FROM alpha_withheld w WHERE w.gse_id = m.gse_id))) AS stats_samples,
  (SELECT SUM(q.n_cells_called) FROM sample_qc q WHERE q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM alpha_exclusions x WHERE x.gsm_id = q.gsm_id)
      AND q.gse_id IN (SELECT m.gse_id FROM gse_meta m WHERE m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
                         AND NOT EXISTS (SELECT 1 FROM alpha_withheld w WHERE w.gse_id = m.gse_id))) AS stats_cells,
  (SELECT SUM(COALESCE(m.n_usable_samples, 0)) FROM gse_meta m
    WHERE m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM alpha_withheld w WHERE w.gse_id = m.gse_id)) AS search_samples,
  (SELECT SUM(COALESCE(m.n_usable_cells, 0)) FROM gse_meta m
    WHERE m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM alpha_withheld w WHERE w.gse_id = m.gse_id)) AS search_cells,
  (SELECT COUNT(*) FROM gse_meta m WHERE m.has_bundle = 1 AND m.n_usable_samples IS NULL) AS stale_rollups;

SELECT COUNT(*) AS drifted FROM gse_meta m
  WHERE m.has_bundle = 1 AND m.n_usable_samples IS NOT NULL
    AND m.n_usable_samples != (SELECT COUNT(*) FROM sample_qc q WHERE q.gse_id = m.gse_id AND q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0
                                AND NOT EXISTS (SELECT 1 FROM alpha_exclusions x WHERE x.gsm_id = q.gsm_id));
