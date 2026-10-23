-- Rebuild sample_property (schema/035, docs/CELL-ARCHITECTURE.md section 5). Run after scripts/ontology/refresh.sql:
--
--   wrangler d1 execute singlet-catalog --remote --file=scripts/ontology/properties.sql
--
-- A sample whose evidence names two exclusive values of a property (healthy and diseased; control and treated/genetic)
-- keeps neither: the conflict is reported by leaving the property unknown.

DELETE FROM sample_property;

-- donor_status from the mapped disease terms: PATO:0000461 normal -> healthy, any MONDO term -> diseased.
INSERT OR REPLACE INTO sample_property (gsm_id, gse_id, property, value, source, confidence, evidence, version)
SELECT st.gsm_id, st.gse_id, 'donor_status', CASE WHEN st.term_id = 'PATO:0000461' THEN 'healthy' ELSE 'diseased' END,
       st.source, MAX(st.confidence), 'disease term ' || MIN(st.term_id), 'props-2026-10-23'
FROM sample_term st
WHERE st.attr = 'disease'
GROUP BY st.gsm_id, CASE WHEN st.term_id = 'PATO:0000461' THEN 'healthy' ELSE 'diseased' END;

INSERT OR REPLACE INTO sample_property (gsm_id, gse_id, property, value, source, confidence, evidence, version)
SELECT a.gsm_id, a.gse_id, p.property, p.prop_value, 'geo', MAX(p.confidence), MIN(p.evidence), p.version
FROM sample_attr a JOIN property_value_map p ON p.attr = a.attr AND p.match_on = 'value_norm' AND p.value = a.value_norm
GROUP BY a.gsm_id, p.property, p.prop_value;

INSERT OR REPLACE INTO sample_property (gsm_id, gse_id, property, value, source, confidence, evidence, version)
SELECT a.gsm_id, a.gse_id, p.property, p.prop_value, 'geo', MAX(p.confidence), MIN(p.evidence), p.version
FROM sample_attr a JOIN property_value_map p ON p.attr = a.attr AND p.match_on = 'value_raw' AND p.value = a.value_raw
GROUP BY a.gsm_id, p.property, p.prop_value;

-- Conflicts.
DELETE FROM sample_property WHERE property = 'donor_status' AND gsm_id IN (
  SELECT gsm_id FROM sample_property WHERE property = 'donor_status' GROUP BY gsm_id HAVING COUNT(*) > 1);
DELETE FROM sample_property WHERE property = 'perturbation' AND value = 'control' AND gsm_id IN (
  SELECT gsm_id FROM sample_property WHERE property = 'perturbation' AND value IN ('treated', 'genetic'));
DELETE FROM sample_property WHERE property = 'sample_kind' AND gsm_id IN (
  SELECT gsm_id FROM sample_property WHERE property = 'sample_kind' GROUP BY gsm_id HAVING COUNT(*) > 1);
