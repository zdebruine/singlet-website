#!/usr/bin/env bash
# Distinct sample_attr values with counts, the input of scripts/ontology/build.ts (read-only query).
#   scripts/ontology/export-values.sh > values.json
set -euo pipefail
npx wrangler d1 execute singlet-catalog --remote --json --command "
SELECT a.attr, COALESCE(g.organism_primary, '') AS organism, a.value_norm, MIN(a.value_raw) AS value_raw,
       a.unit, a.value_num, COUNT(*) AS n, COUNT(DISTINCT a.gse_id) AS n_studies
FROM sample_attr a LEFT JOIN gsm g ON g.gsm_id = a.gsm_id
WHERE a.attr IN ('tissue', 'cell_type_sorted', 'disease', 'ancestry', 'sex', 'life_stage', 'age')
GROUP BY a.attr, organism, a.value_norm"
