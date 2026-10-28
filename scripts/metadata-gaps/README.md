# Catalog metadata gaps: measurement and backfill (2026-10-28)

`backfill.ts` proposes the rows the catalog misses for served samples, from the GEO text already in D1. It writes files only.
The header of `backfill.ts` lists the read-only export commands it reads. `out/` holds the run of 2026-10-28, which has **not** been applied.

| File | What | Apply? |
|---|---|---|
| `out/proposed-changes.csv` | one line per proposed change, with its evidence (the GEO text it came from and the mapping used) | review first |
| `out/backfill.sql` | sample_attr / sample_term rows from GEO characteristics and source; named gsm groups; gse_meta rollups of the studies touched | after review |
| `out/backfill-title.sql` | optional: tissue taken from the sample title alone (confidence 0.6), for samples with no characteristics or source stored | only if wanted, after backfill.sql |
| `out/summary.json` | counts by change type | — |

Apply with `npx wrangler d1 execute singlet-catalog --remote --file scripts/metadata-gaps/out/backfill.sql`. Every statement is idempotent.
Fallback groups ("Other", "Other / unspecified") are not in the files; the fixed catalog crank (`catalog-refresh.ts`) sets them.

What the 2026-10-28 run proposes (47,636 served samples):

| Change | geo fields | title only |
|---|---|---|
| new tissue attr / UBERON term | 2,844 / 2,273 | 3,811 / 3,746 |
| new disease attr / MONDO-PATO term | 205 / 110 | — |
| new age + life stage attr / HsapDv-MmusDv term | 1,069 / 879 | — |
| tissue rows dropped (`region: R1`…`R8` read as rhombomeres) | 24 | — |
| disease rows corrected (ENCODE "DM: no; HTN: no; CAD: no" read as a case) | 13 | — |
| gsm tissue_group / disease_group set to a named group | 3,307 / 196 | 3,391 / — |
| studies whose gse_meta groups are recomputed | 542 | 733 |

Values with no term in `ontology_value_map` and no exact UBERON / MONDO label stay unmapped: 794 tissue, 109 disease and 190 age
values. They need the model pass of `scripts/ontology/` (branch `claude/ontology-filters-46958f`).
