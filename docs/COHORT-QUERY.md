# Cohort query, resolve and manifest

Status 2026-10-20. Implements the index-answerable part of `SEARCH-ROADMAP.md` sections 5 and 6 (that file is on
`docs/dense-metadata`). New endpoints only; `/api/nl-search` and `DOWNLOADABLE_SQL` are unchanged.

| Piece | File |
|---|---|
| Attribute list, bins, source tiers | `functions/_shared/cohort-schema.ts` |
| Index format and queries (bitsets, popcount, ranking) | `functions/_shared/bitindex.ts` |
| Index writer | `functions/_shared/bitindex-build.ts`, `scripts/search-index/build-index.ts` |
| Grammar, resolver | `functions/_shared/cohort-core.ts`, `GET/POST /api/cohort/resolve` |
| Manifest, downsampling | `functions/_shared/cohort-manifest.ts`, `GET/POST /api/cohort/manifest` |
| Tables for extracted facts and chunk maps | `schema/030_search_facts.sql` (not applied to production) |

## 1. The index

Every processed sample is one bit position. Samples are sorted by (GSE, GSM), so a study is a contiguous range.
Each attribute is dictionary-encoded (code 0 = unknown) and stored as

- a code column, uint8 or uint16 per sample (single-valued attributes), used for lookups and ranking;
- one bitset per value and source tier, as `ceil(n/32)` Uint32 words, or a sorted id list when the value has fewer
  members than words.

A query is bitwise AND (across clauses), OR (within `any`), ANDNOT (excludes), then popcounts. Ranking is cosine
similarity between a weighted query vector and each candidate's one-hot profile over the code columns.

Attributes: organism, tissue_group, tissue, disease_group, disease, disease_state, sex, sex_genetic,
ancestry_genetic, life_stage, sample_type, chemistry, nuclei, treatment_status, layer (several per sample: gene_counts,
splicing, junctions, mtdna, vdj, snps, donors, sex, doublets), qc_tier, pipeline_version, downloadable, usable, and the
numeric year, age (years) and n_cells. Numeric values are quantised to bins (`cohort-schema.ts` has the edges); a range
snaps outward to bin edges and the response says to which (`snapped`). `min_cells` is exact.

Source tiers: `geo`, `pipeline`, `model` with confidence at or above 0.8, `model` below 0.8. A fact lives in one tier.
`sources` (default `["geo","pipeline","model>=0.8"]`) chooses the tiers a query reads; a threshold of 0.8 or more
keeps the high band, anything lower keeps both. `organism`, `layer`, `qc_tier`, `pipeline_version`, `downloadable`,
`usable`, `year` and `n_cells` are catalog facts and ignore `sources`.

Files (built offline, served from the public data bucket, loaded once per Worker isolate, dictionary re-checked every
5 minutes, binary fetched only when the version changes):

```
search-index/v1/index.json                 dictionary: version, studies, attribute dictionaries, offsets
search-index/v1/index.<version>.sbix       binary, immutable
```

Binary layout (little endian): 32-byte header (`SBIX`, format 1, n_samples, words, total bytes), then 4-byte
aligned blobs: GSM numbers, study index per sample, study start offsets, cells called per sample, then per attribute its
code column and bitsets. The dictionary gives each blob's offset and length. The same layout holds for cells instead
of samples once per-cell labels exist (`study_start` becomes the sample starts); `cell_type` clauses are rejected until then.

Build and publish:

```
node scripts/search-index/d1-export.mjs scripts/search-index/export-samples.sql samples.json
node scripts/search-index/build-index.ts --samples samples.json --out dist/search-index
wrangler r2 object put singlet-data/search-index/v1/index.<version>.sbix --file=dist/search-index/index.<version>.sbix
wrangler r2 object put singlet-data/search-index/v1/index.json --file=dist/search-index/index.json
```

`scripts/search-index/publish.sh` does all of this (including `export-facts.sql`, the `sample_attr` rows) and
`.github/workflows/search-index.yml` runs it nightly; a catalog `geo` value wins over a `sample_attr` row for the same
sample and attribute. The facts are filled by `npm run enrich:cards -- --all` and `npm run enrich:ingest`
(`scripts/enrich/`), which write `sample_attr` and `study_card` through `POST /api/ingest/<table>`.

`SEARCH_INDEX_BASE` (Pages variable) overrides the base URL. Until the files exist the endpoints answer 503.
`npx vite-node scripts/search-index/bench.ts` times queries on a synthetic 100k-sample catalog.

## 2. Cohort query grammar

```json
{
  "version": 1,
  "include": [
    {"attr": "organism", "any": ["Homo sapiens"]},
    {"attr": "tissue_group", "any": ["Brain", "Blood"]},
    {"attr": "year", "num": {"min": 2018}}
  ],
  "exclude": [{"attr": "treatment_status", "any": ["treated"]}],
  "require": {"min_cells": 500, "min_samples_per_study": 2, "qc_tier": [0]},
  "sources": ["geo", "pipeline", "model>=0.8"],
  "level": "sample"
}
```

- `include`, `exclude`: clauses. A categorical clause has `attr` and a non-empty `any` (values matched case-insensitively,
  at most 200); a numeric clause has `num` with `min` and/or `max` (inclusive, snapped outward to bins).
- `require.min_cells`: samples with at least this many cells called. `min_samples_per_study`: studies left with fewer
  selected samples are removed. `qc_tier`: `[0]` (default) or `[0,1]` (adds low-QC samples; tier 2 is refused).
- `level`: `sample` (default) or `study`. `cell` is refused until per-cell labels are indexed.
- Every cohort also requires `downloadable`, `usable` and the QC tier above: the same basis as the headline numbers
  (`totals.basis = "file"`).

Semantics. AND across clauses, OR within `any`. An include needs a fact in an allowed tier: a sample unknown on the
attribute is not included. An exclude removes only samples that carry a matching fact: a sample unknown on the attribute
is kept. In both cases the unknown samples are counted (`unknown_by_attr`). A value the index has never seen is not an
error: it matches nothing and is listed in `unmatched`. An unknown attribute, a malformed clause or a bad source is a
400 `{error, token}` naming the offending token.

GET: `?query=<url-encoded JSON>`, or flat parameters: `tissue_group=Brain,Blood`, `not_treatment_status=treated`,
`year_min=2018&year_max=2022`, `min_cells=500`, `min_samples_per_study=2`, `include_low_qc=1`, `sources=geo,pipeline`.
POST: the query as the body, or `{"query": {...}, "max_cells": 50000, ...options}`.

## 3. `/api/cohort/resolve`

Options: `facet_limit` (15), `study_limit` (50, max 2000), `what_if=0`, `facets=0`.

```
{ query, index: {version, built_at, n_samples},
  totals: {studies, samples, cells, basis: "file"},
  studies: [{gse_id, n_samples, n_cells}], studies_truncated,
  facets: {attr: {label, constrained, values: [{value, n}], unknown}},
  unknown_by_attr: {attr: n},
  what_if: [{clause, samples, studies, cells, gain_samples}],
  ambiguities: [{attr, values: [{value, n}]}],
  unmatched: [{clause, value}], snapped: [{clause, attr, min, max}], base: [...] }
```

- `facets` are counts over the included samples by popcount; numeric attributes list their bins in order.
- `unknown_by_attr[attr]`: for an attribute with an include clause, the samples that pass every other clause but have
  no fact for it (candidates the query cannot see); otherwise the included samples with no fact.
- `what_if`: totals if that one clause were dropped. The query itself is never relaxed.
- `ambiguities`: attributes the query leaves open where the included set mixes states (at least two values at 5% or more
  of the known samples): treatment_status, disease_state, nuclei, life_stage, sample_type, sex.

Measured on a synthetic 100,000-sample catalog (Node 24, one core, six clauses plus a cell floor): clause masks about 2 ms,
totals (studies, samples, cells) about 3 ms, with facets and what-if about 11 to 19 ms. Index 5.3 MB binary plus 0.2 MB
dictionary for that synthetic catalog (about 20 populated attributes per sample; ids of rare values are 4 bytes each).

## 4. `/api/cohort/manifest`

Same query as resolve, plus: `max_cells`, `seed` (default `0`, at most 64 characters), `min_cells_per_sample` (default 50),
`files` (comma list of file names, default `exon_counts.1pz,intron_counts.1pz`), `offset`, `limit` (samples per page,
default 100, max 500), `indices=none`. The Worker reads no data: it reads the cohort from the index, entry offsets from
`bundle_index` and chunk maps from `pz_chunk_index` (absent until schema/030 is applied and filled), for the samples on
the page only.

```
{ cohort: {hash, index_version, query, totals},
  files: [...],
  downsample: null | {max_cells, seed, min_cells_per_sample, algorithm, cells_before, cells_after,
                      samples_before, samples_after, dropped: [{gsm_id, gse_id, n_cells}]},
  page: {offset, limit, n_samples, next_offset},
  studies: [{gse_id, url, indexed, samples: [{
      gsm_id, n_cells, keep_cells,
      keep_runs: [start, length, start, length, ...] | null,      // null: all columns
      files: [{path, method: "stored"|"deflate", compressed_bytes, uncompressed_bytes,
               local_header_offset, data_offset_min, data_offset | null, range | null,
               chunks: null | {n_cols, chunk_cols, perm_present, header: {start, end}, n_chunks_total,
                               n_chunks_needed, ranges: [{first_chunk, last_chunk, start, end}],
                               bytes_to_fetch, bytes_total, overread_ratio}}]}]}],
  warnings, notes }
```

`cohort.hash` is the first 16 hex characters of SHA-256 over (canonical query, index version, max_cells, seed,
min_cells_per_sample): a stable id for the plan. `studies[].url` is the public file on `data.singlet.bio`.

Offsets. `local_header_offset` is the zip local header of the entry. The payload starts at
`local_header_offset + 30 + name_length + extra_length`, where the two lengths are at bytes 26 and 28 of the header.
`data_offset_min` assumes no extra field; `data_offset` and `range` are filled when the indexer has recorded the exact
start. Chunk and header ranges are inclusive byte offsets relative to the first payload byte, so the absolute range
is `data_offset + start` to `data_offset + end`. Only `stored` entries get chunk plans.

`pz_chunk_index.chunk_offsets` contract (for the indexer that fills it): JSON array of `n_chunks + 1` offsets relative to
the first payload byte; chunk `c` spans `[o[c], o[c+1])`; `o[0]` is the size of everything before the first chunk.
Column `j` is in chunk `floor(j / chunk_cols)`. Column indices in this manifest are positions in the stored
matrix (after the file's permutation), 0-based, the same numbering `cell_labels.tsv` uses in the roadmap.

### Downsampling

With `max_cells` set and a cohort larger than that:

1. Each sample's share is `n_cells * max_cells / total`, rounded by largest remainder so shares sum to exactly
   `max_cells` and no sample exceeds its own size. Ties go to the sample with the lower `fnv1a32("<seed>|<GSM>")`.
2. A sample is dropped whole only if its share would fall below `min_cells_per_sample` (at least 1). Drops start with the
   smallest sample (ties by the same hash) and stop at the fewest drops that let every kept sample clear the floor;
   shares are then recomputed over the kept samples. Dropped samples are listed in `downsample.dropped`. If even the
   largest sample cannot clear the floor, that one sample is kept with `max_cells` cells.
3. Within a sample the kept columns are drawn without replacement by selection sampling: for `i` in `0..n-1`, take column
   `i` when `rand() * (n - i) < k - taken`, stopping at `k`. `rand()` is mulberry32 seeded with
   `fnv1a32("<seed>|<GSM>")` (UTF-8 bytes), each output divided by 2^32.
4. The result depends only on (cohort, max_cells, seed, min_cells_per_sample), not on request order or paging.

```
fnv1a32: h = 0x811c9dc5; for each byte b: h = ((h ^ b) * 0x01000193) mod 2^32
mulberry32(seed): a = seed; each call: a = (a + 0x6D2B79F5) mod 2^32; t = a;
  t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2^32
```

Conformance vectors: `fnv1a32("a") = 0xe40c292c`; `fnv1a32("7|GSM100") = 3090295242`; `mulberry32(1)` first three outputs
times 2^32, floored: `2693262067, 11749833, 2265367787`; `selectColumns(n=20, k=5, seed="7", gsm="GSM100") = [0, 4, 14, 15, 16]`.

Column selection is by cell, not by chunk, so a 10% subset touches most chunks of a sample; `overread_ratio` reports
cells fetched per cell kept. A chunk-aware variant would trade statistical uniformity for fewer bytes; not done here.

### What the client must do (`Singlet-Bio/singlet`, Python and R)

1. `singlet.cohort(query)` calls `/api/cohort/resolve` and shows totals, `unknown_by_attr` and `what_if`; it never edits the
   query itself.
2. `singlet.load(cohort=..., max_cells=..., seed=...)` pages `/api/cohort/manifest` until `next_offset` is null and keeps
   `cohort.hash` in the result's `uns` for provenance.
3. For each file: read the 30-byte local header at `local_header_offset` unless `data_offset` is given, then fetch with
   Range requests (parallel, same host): the `header` range once, then each `chunks.ranges` entry (add `data_offset`).
   With `chunks: null`, fetch the whole entry (`compressed_bytes`).
4. Decode the `.1pz` chunks as `read_1pz` does, keep the columns in `keep_runs` (expand `[start, length]` pairs; `null`
   keeps all), and concatenate samples with `obs` columns from the resolve facets or `/api/gse`. Exon and intron
   matrices share the same columns.
5. Verify `keep_cells` against the columns kept, and the number of cells against `n_cells`; a mismatch is a stale
   catalog, not an error to hide. The `warnings` array lists samples whose chunk map disagrees with the catalog.
6. Re-running with the same `seed` must give the same cells; a new `seed` gives an independent subsample.
7. Deflated entries cannot be sliced: fetch the entry and inflate it.

## 5. Not covered yet

Ontology expansion (`expand: "descendants"`), cell-level clauses and `cell_type`, `text`, `min_donors_per_study`, per-study
evidence strings, saved cohorts, NL translation. They need `sample_attr` filled (schema/030), the ontology slice (T2) and
the phenotype labels (T13). The index builder already accepts `sample_attr` rows with `--facts`.
