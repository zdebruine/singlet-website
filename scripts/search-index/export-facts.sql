-- sample_attr rows for the samples the index holds, in the shape build-index.ts --facts reads
-- (schema/030_search_facts.sql). Only the attributes the index has a column for are exported, and only
-- the columns the builder uses.
--
--   wrangler d1 execute singlet-catalog --remote --json --file=scripts/search-index/export-facts.sql > facts.json
SELECT a.gsm_id, a.attr, a.value_norm, a.value_num, a.unit, a.source, a.confidence
FROM sample_attr a
JOIN gsm s ON s.gsm_id = a.gsm_id AND s.status = 'DONE'
WHERE a.attr IN ('tissue', 'disease', 'disease_state', 'sex', 'age', 'life_stage', 'sample_type', 'treatment_status')
ORDER BY a.gsm_id, a.attr, a.source, a.value_norm;
