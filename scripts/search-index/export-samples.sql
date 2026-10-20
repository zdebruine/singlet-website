-- One row per processed sample, in the flat shape build-index.ts reads. Works on today's schema (no sample_attr):
-- attributes that are not stored yet (life stage, nuclei, treatment, ...) are simply absent and count as unknown.
--
--   wrangler d1 execute singlet-catalog --remote --json --file=scripts/search-index/export-samples.sql > samples.json
--   node scripts/search-index/build-index.ts --samples samples.json --out dist/search-index
--
-- `downloadable` is the DOWNLOADABLE_SQL rule (functions/_shared/search-core.ts) evaluated for the sample's study;
-- `usable` and `qc_tier` come from sample_qc. `layer` is read per study from the file listing, so it says what the
-- study's file holds, not which sample has it. A D1 result this size should be fetched in pages if the CLI
-- truncates (add LIMIT/OFFSET on s.gsm_id).
WITH lay AS (
  -- One pass over each study's file listing, not one per sample.
  SELECT gse_id,
    TRIM(
      CASE WHEN entries LIKE '%exon_counts.1pz%'       THEN 'gene_counts|' ELSE '' END ||
      CASE WHEN entries LIKE '%intron_counts.1pz%'     THEN 'splicing|'    ELSE '' END ||
      CASE WHEN entries LIKE '%sj_counts.1pz%'         THEN 'junctions|'   ELSE '' END ||
      CASE WHEN entries LIKE '%mt_heteroplasmy.1pz%'   THEN 'mtdna|'       ELSE '' END ||
      CASE WHEN entries LIKE '%vdj_gene_usage.1pz%'    THEN 'vdj|'         ELSE '' END ||
      CASE WHEN entries LIKE '%snp_ad.1pz%'            THEN 'snps|'        ELSE '' END ||
      CASE WHEN entries LIKE '%donor_assignments.tsv%' THEN 'donors|'      ELSE '' END ||
      CASE WHEN entries LIKE '%sex_call.json%'         THEN 'sex|'         ELSE '' END ||
      CASE WHEN entries LIKE '%doublet_scores.tsv%'    THEN 'doublets|'    ELSE '' END,
      '|') AS layer
  FROM bundle_index
)
SELECT
  s.gsm_id,
  s.gse_id,
  COALESCE(q.n_cells_called, 0)                              AS n_cells,
  s.organism_primary                                         AS organism,
  s.tissue_group,
  s.tissue,
  s.disease_group,
  s.disease,
  CASE WHEN LOWER(s.sex) IN ('male', 'female') THEN LOWER(s.sex) END AS sex,
  q.protocol                                                 AS chemistry,
  q.singlet_version                                          AS pipeline_version,
  CASE WHEN q.gsm_id IS NULL THEN NULL ELSE CAST(COALESCE(q.qc_tier, 0) AS TEXT) END AS qc_tier,
  CASE WHEN q.usable = 1 THEN '1' END                        AS usable,
  CASE WHEN m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0 THEN '1' END AS downloadable,
  m.year,
  l.layer
FROM gsm s
LEFT JOIN sample_qc q    ON q.gsm_id = s.gsm_id
LEFT JOIN gse_meta m     ON m.gse_id = s.gse_id
LEFT JOIN lay l       ON l.gse_id = s.gse_id
WHERE s.status = 'DONE'
ORDER BY s.gse_id, s.gsm_id;
