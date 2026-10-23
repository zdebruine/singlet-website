-- Rebuild sample_term and ontology_term_count from sample_attr x ontology_value_map (docs/ONTOLOGY.md), and set
-- sample_attr.ontology_id where a value maps to exactly one term. Idempotent; run after ontology-load.sql and
-- whenever sample_attr has grown:
--
--   wrangler d1 execute singlet-catalog --remote --file=scripts/ontology/refresh.sql
--
-- One statement per attribute keeps each under D1's statement time limit.

DELETE FROM sample_term;

INSERT OR REPLACE INTO sample_term (gsm_id, gse_id, attr, term_id, source, confidence, from_attr)
SELECT a.gsm_id, a.gse_id, 'tissue', m.term_id, CASE WHEN a.source = 'model' THEN 'model' ELSE m.source END, m.confidence, a.attr
FROM sample_attr a JOIN ontology_value_map m ON m.attr = a.attr AND m.organism = '' AND m.value_norm = a.value_norm
WHERE a.attr = 'tissue';

INSERT OR REPLACE INTO sample_term (gsm_id, gse_id, attr, term_id, source, confidence, from_attr)
SELECT a.gsm_id, a.gse_id, 'cell_type', m.term_id, CASE WHEN a.source = 'model' THEN 'model' ELSE m.source END, m.confidence, a.attr
FROM sample_attr a JOIN ontology_value_map m ON m.attr = a.attr AND m.organism = '' AND m.value_norm = a.value_norm
WHERE a.attr = 'cell_type_sorted';

INSERT OR REPLACE INTO sample_term (gsm_id, gse_id, attr, term_id, source, confidence, from_attr)
SELECT a.gsm_id, a.gse_id, a.attr, m.term_id, CASE WHEN a.source = 'model' THEN 'model' ELSE m.source END, m.confidence, a.attr
FROM sample_attr a JOIN ontology_value_map m ON m.attr = a.attr AND m.organism = '' AND m.value_norm = a.value_norm
WHERE a.attr IN ('disease', 'ancestry', 'sex');

-- Developmental stage depends on the species: the map is keyed by organism for age and life_stage.
INSERT OR REPLACE INTO sample_term (gsm_id, gse_id, attr, term_id, source, confidence, from_attr)
SELECT a.gsm_id, a.gse_id, 'development_stage', m.term_id, CASE WHEN a.source = 'model' THEN 'model' ELSE m.source END, m.confidence, a.attr
FROM sample_attr a
JOIN gsm g ON g.gsm_id = a.gsm_id
JOIN ontology_value_map m ON m.attr = a.attr AND m.organism = g.organism_primary AND m.value_norm = a.value_norm
WHERE a.attr IN ('age', 'life_stage');

UPDATE sample_attr SET ontology_id = (
  SELECT CASE WHEN COUNT(*) = 1 THEN MIN(m.term_id) END FROM ontology_value_map m
  WHERE m.attr = sample_attr.attr AND m.organism = '' AND m.value_norm = sample_attr.value_norm
)
WHERE attr IN ('tissue', 'cell_type_sorted', 'disease', 'ancestry', 'sex');

UPDATE sample_attr SET ontology_id = (
  SELECT CASE WHEN COUNT(*) = 1 THEN MIN(m.term_id) END FROM ontology_value_map m JOIN gsm g ON g.gsm_id = sample_attr.gsm_id
  WHERE m.attr = sample_attr.attr AND m.organism = g.organism_primary AND m.value_norm = sample_attr.value_norm
)
WHERE attr IN ('age', 'life_stage');

-- Counts on the basis of the headline numbers: usable, tier-0 samples of downloadable studies (DOWNLOADABLE_SQL).
DELETE FROM ontology_term_count;

INSERT INTO ontology_term_count (attr, term_id, n_samples, n_studies, n_direct)
SELECT st.attr, c.ancestor_id, COUNT(DISTINCT st.gsm_id), COUNT(DISTINCT st.gse_id),
       COUNT(DISTINCT CASE WHEN c.distance = 0 THEN st.gsm_id END)
FROM sample_term st
JOIN ontology_closure c ON c.term_id = st.term_id
JOIN sample_qc q ON q.gsm_id = st.gsm_id AND COALESCE(q.usable, 1) = 1 AND COALESCE(q.qc_tier, 0) = 0
JOIN gse_meta m ON m.gse_id = st.gse_id
WHERE st.attr = 'tissue'
  AND m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
GROUP BY st.attr, c.ancestor_id;

INSERT INTO ontology_term_count (attr, term_id, n_samples, n_studies, n_direct)
SELECT st.attr, c.ancestor_id, COUNT(DISTINCT st.gsm_id), COUNT(DISTINCT st.gse_id),
       COUNT(DISTINCT CASE WHEN c.distance = 0 THEN st.gsm_id END)
FROM sample_term st
JOIN ontology_closure c ON c.term_id = st.term_id
JOIN sample_qc q ON q.gsm_id = st.gsm_id AND COALESCE(q.usable, 1) = 1 AND COALESCE(q.qc_tier, 0) = 0
JOIN gse_meta m ON m.gse_id = st.gse_id
WHERE st.attr = 'cell_type'
  AND m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
GROUP BY st.attr, c.ancestor_id;

INSERT INTO ontology_term_count (attr, term_id, n_samples, n_studies, n_direct)
SELECT st.attr, c.ancestor_id, COUNT(DISTINCT st.gsm_id), COUNT(DISTINCT st.gse_id),
       COUNT(DISTINCT CASE WHEN c.distance = 0 THEN st.gsm_id END)
FROM sample_term st
JOIN ontology_closure c ON c.term_id = st.term_id
JOIN sample_qc q ON q.gsm_id = st.gsm_id AND COALESCE(q.usable, 1) = 1 AND COALESCE(q.qc_tier, 0) = 0
JOIN gse_meta m ON m.gse_id = st.gse_id
WHERE st.attr = 'development_stage'
  AND m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
GROUP BY st.attr, c.ancestor_id;

INSERT INTO ontology_term_count (attr, term_id, n_samples, n_studies, n_direct)
SELECT st.attr, c.ancestor_id, COUNT(DISTINCT st.gsm_id), COUNT(DISTINCT st.gse_id),
       COUNT(DISTINCT CASE WHEN c.distance = 0 THEN st.gsm_id END)
FROM sample_term st
JOIN ontology_closure c ON c.term_id = st.term_id
JOIN sample_qc q ON q.gsm_id = st.gsm_id AND COALESCE(q.usable, 1) = 1 AND COALESCE(q.qc_tier, 0) = 0
JOIN gse_meta m ON m.gse_id = st.gse_id
WHERE st.attr = 'disease'
  AND m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
GROUP BY st.attr, c.ancestor_id;

INSERT INTO ontology_term_count (attr, term_id, n_samples, n_studies, n_direct)
SELECT st.attr, c.ancestor_id, COUNT(DISTINCT st.gsm_id), COUNT(DISTINCT st.gse_id),
       COUNT(DISTINCT CASE WHEN c.distance = 0 THEN st.gsm_id END)
FROM sample_term st
JOIN ontology_closure c ON c.term_id = st.term_id
JOIN sample_qc q ON q.gsm_id = st.gsm_id AND COALESCE(q.usable, 1) = 1 AND COALESCE(q.qc_tier, 0) = 0
JOIN gse_meta m ON m.gse_id = st.gse_id
WHERE st.attr = 'ancestry'
  AND m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
GROUP BY st.attr, c.ancestor_id;

INSERT INTO ontology_term_count (attr, term_id, n_samples, n_studies, n_direct)
SELECT st.attr, c.ancestor_id, COUNT(DISTINCT st.gsm_id), COUNT(DISTINCT st.gse_id),
       COUNT(DISTINCT CASE WHEN c.distance = 0 THEN st.gsm_id END)
FROM sample_term st
JOIN ontology_closure c ON c.term_id = st.term_id
JOIN sample_qc q ON q.gsm_id = st.gsm_id AND COALESCE(q.usable, 1) = 1 AND COALESCE(q.qc_tier, 0) = 0
JOIN gse_meta m ON m.gse_id = st.gse_id
WHERE st.attr = 'sex'
  AND m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0
GROUP BY st.attr, c.ancestor_id;
