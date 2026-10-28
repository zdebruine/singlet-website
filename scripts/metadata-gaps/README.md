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

## GEO re-fetch and ontology long tail (2026-10-28, `out-geo/`, not applied)

Served samples with **no GEO text stored** (characteristics and source empty): 11,565 (9,151 mouse, 2,409 human, 5 other) in 2,349
series. `geo_refetch.py` fetched their SOFT from NCBI on Clipper (one request per series, 2.5 req/s, job 790794, 29 min): 11,563
recovered, 2 not served by GEO (GSM9092927, GSM9092928). Raw answers: `out-geo/geo_text.json.gz`.

`backfill.ts --upgrade-fallback` (new flag: a crank fallback group "Other" / "Other / unspecified" set because the sample had no text
is replaced by the named group the text now gives) was rerun over those samples with the fetched text. `map_unmapped.ts` then maps
values with no term: the 2026-10-23 mapper (`onto/`, vendored from `claude/ontology-filters-46958f`: aliases, unique label / exact
synonym, variants, HsapDv/MmusDv stage intervals), the 2026-10-23 model decisions, and `review-decisions-2026-10-28.jsonl` (64
reviewed decisions, precision first, rules of `model-pass.md`; every id checked against the 2026-10 OBO releases). Human bare decade
ranges ("50-59") are read as years; mouse bare numbers ("3", "8") stay unmapped.

Apply in this order, after `out/backfill.sql`. Every file is idempotent (checked: a second run changes nothing).

| file | what | statements | rows written (hand / `d1:estimate` upper bound) |
|---|---|---|---|
| `out-geo/gsm-text.sql` | fill empty `gsm.characteristics` / `source`; `gsm_au` reindexes `fts_gsm` | 11,563 UPDATE | ~140k (≈12 per row incl. FTS, measured on SQLite) / 347k |
| `out-geo/refetch-backfill.sql` | 14,947 sample_attr, 10,367 sample_term, 9,878 gsm named groups, 1,969 study rollups | ~37k row changes | ~100-130k / 395k |
| `out-geo/refetch-terms.sql` | terms for the re-fetched values the backfill could not place (1,284 samples) | 240 map + 1,289 term | ~8k / 11k |
| `out-geo/terms.sql` | terms for existing unmapped attrs (1,224 samples) | 166 map + 1,258 term | ~8k / 11k |

Total ≈ $0.26-0.30 (upper bound $0.76). Review CSVs: `refetch-proposed-changes.csv`, `refetch-terms-review.csv`, `terms-review.csv`.
Values still unmapped, with sample counts: `terms-unmapped.json` (1,570 values / 6,634 samples), `refetch-terms-unmapped.json`
(732 / 3,013): mostly tumours, organoids, cell lines, lavage fluids, arm labels ("Cases", "Convalescent") and ambiguous
abbreviations, which the rules leave unmapped. Only the top ~500 values by sample count were reviewed by hand.
