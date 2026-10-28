# Cell search: every cell of the atlas, by any metadata

Status 2026-10-28: live on singlet.bio (zdebruine/singlet-website#88), measured on production. Numbers below come from
`docs/cell-search-measurements.json` (`npm run cells:bench`), which the grant figure reads.

## What it answers

"Female CD8 T cells from lung cancer" over the whole Research Alpha atlas (46,649 QC-passed samples, 221,164,736 called cells
of 6,977 studies): how many cells, in which studies and samples, how they split by every other facet, which descendant terms
contributed, and the byte ranges of exactly those cells in the per-sample `.s1` objects.

| Surface | Path |
|---|---|
| Query API | `GET|POST /api/cells` (`where=` JSON, flat field parameters, or `q=` plain English) |
| Vocabulary | `GET /api/cells/fields`: every filter, its level, ontology, source table, coverage and top values |
| Cells, paged | `GET|POST /api/cells/slice` (`page_cells` <= 10,000, `cursor`) |
| MCP | `search_cells`, `get_cells_page` (next to `find_cells`, `slice_cells`) |
| Website | `/cells` (linked from Browse) |

## Filters

Combinable with AND / OR / NOT. An ontology filter takes ids or labels (synonyms from `ontology_label`, a few abbreviations
such as "CD8 T cell", "Treg", "adult") and matches the term and every descendant; `exact: true` matches the term alone.

| Level | Field | Ontology / values | Source |
|---|---|---|---|
| cell | `cell_type` | CL | cell index (`ct`, with each term's CL ancestors) |
| cell | `sex` | PATO: female, male, ambiguous, unknown | cell index (`sex`) |
| cell | `ancestry` | HANCESTRO (children of HANCESTRO:0004) | cell index (`anc`) |
| cell | `n_umi`, `n_genes` | ranges | cell index rows (data Worker row scan; AND with plain cell filters) |
| sample | `tissue` | UBERON (is_a + part_of) | D1 `sample_term` |
| sample | `disease` | MONDO, PATO:0000461 normal | D1 `sample_term` |
| sample | `development_stage` | HsapDv, MmusDv | D1 `sample_term` |
| sample | `age_years` | range | D1 `sample_attr` age (GEO), in years |
| sample | `donor_sex`, `donor_ancestry`, `sorted_cell_type` | PATO, HANCESTRO, CL (as the authors recorded them) | D1 `sample_term` |
| sample | `organism`, `assay`, `chemistry`, `tissue_group`, `disease_group` | catalog values | D1 `gsm`, `sample_qc.protocol` |
| sample | `donor_status`, `perturbation`, `sample_kind` | healthy/diseased; treated/genetic/control; primary/cell_line/stem_cell/organoid/xenograft | D1 `sample_property` |
| sample | `median_umi`, `median_genes`, `mito_fraction`, `cells_called`, `mapping_rate`, `qc` | ranges; pass / low | D1 `sample_qc` |
| sample / study | `sample`, `study` | GSM, GSE | D1 `s1_sample` |
| study | `year`, `has_publication` | range; boolean | D1 `gse_meta.year`, `gse.pubmed_ids` |

Not available today (listed under `unavailable` by `/api/cells/fields`): GEO submitter (not in D1), SRA run ids (stored, not
indexed), per-cell mitochondrial fraction (not in the cell index; `mito_fraction` is the sample median). Tissue, disease and
stage are sample facts: a cell inherits its sample's terms. The release policy id (`alpha_exclusions.policy_version`, today
`alpha-2026-10-27e`) is reported with every answer rather than filtered on: every served sample is under it.

Forms:

```
/api/cells?cell_type=T%20cell|B%20cell&tissue=lung&not_disease=cancer&age_years=18..65
/api/cells?where={"cell_type":"T cell","sex":"female","not":{"disease":"MONDO:0004992"}}
/api/cells?where={"and":[{"field":"cell_type","any":["CL:0000084"]},{"or":[{"field":"tissue","any":["lung"]},{"field":"disease","any":["lung cancer"]}]}]}
/api/cells?q=female%20CD8%20T%20cells%20from%20lung%20cancer
```

## How it works

```
 question --nl.ts (vocabulary; the catalog interpreter for leftovers)--> filter tree
 filter tree --query.ts--> evaluated over the cell index summary in isolate memory:
     1,476,601 rows = sample x cell type x chromosomal sex x genetic ancestry -> cells   (s1/cidx summary, 6.0 MB, immutable)
     joined by sample ordinal to the served samples' facts                              (D1 snapshot, ~5 MB JSON)
 answer: totals, studies, samples, facets, cell-type lineage, contributing terms, relaxations when empty
 slice: matching samples in pages -> POST data.singlet.bio/s1/cidx/query (the cells) -> plan blocks + planGather (byte ranges)
```

- **No cell data and no D1 per query.** The cell index summary and sample table (7.8 MB, immutable, content-addressed) are read once
  per isolate through the edge cache and decoded into typed arrays; only `s1/cidx/current.json` is re-read (once a minute). The
  sample facts are one snapshot built from D1 once per colo and six hours (about 400k rows read), kept in the Cache API and the isolate.
- **Exact boolean evaluation.** Every leaf becomes a mask over cell-type / sex / ancestry codes or over samples; AND narrows a sorted
  row list (sample filters first), OR evaluates each member on the rows not yet taken, NOT is a sorted difference.
- **Served basis = the site's headline basis.** Studies on `DOWNLOADABLE_SQL`, `sample_qc.usable` with `qc_tier = 0` (tier 1 with
  `include_low_qc`), Alpha exclusions and withheld studies removed. With no filter the engine returns the headline numbers exactly
  (221,164,736 cells, 46,649 samples on the snapshot of 2026-10-28; `/api/stats` says 221,161,455 / 46,649).
- **Edge caching.** `/api/cells` GETs are cached for 5 minutes in the colo's Cache API, keyed by the canonical filter (keys and
  OR / AND members sorted), flags and paging, so the same question asked two ways shares one entry. `/api/cells/fields` is cached
  for an hour. Answers that needed a degraded model reading are not cached.
- **Per-cell ranges** (`n_umi`, `n_genes`) are not in the summary: the answer adds `row_scan`, a count by the data Worker's row scan
  over the matching samples (exact; seconds, not milliseconds; AND with plain cell filters only).
- **Natural language** reads the longest phrase that is a label or synonym of a term the atlas uses (CL of the cell index, UBERON,
  MONDO, HsapDv/MmusDv, HANCESTRO), sex words, organisms and sample properties; "not / non- / without / excluding" negate the next
  phrase; values of one field are OR-ed; fields are AND-ed. Words it cannot place go to the catalog's existing interpreter
  (`interpretQuery`, the same one `/api/nl-search` uses; vocabulary first, model only if needed, charged to the caller's AI
  allowance, `ai=0` skips it). The filters read are returned (`question.readings`) and shown as chips on `/cells`.
- **Empty answers** carry `relaxations`: per AND-ed filter, the cells it matches alone and the cells of the query without it.

## Getting the cells

`/api/cells/slice` walks the matching samples in accession order. A page takes whole samples up to `page_cells` (<= 10,000), 10
studies, 200 samples and one organism (the cell index's per-request caps); a larger sample is split by the index's cursor. Per page:
the cells as `[GSM, [columns]]`, per sample object the coalesced byte ranges (matrix prefixes + chunk runs) and the body that
streams them in one `POST data.singlet.bio/s1/cidx/gather`. When every cell filter is a plain AND-ed filter the cell index applies
them (`filtered: index`); otherwise (OR / NOT across cell fields) the page asks for all cells of its samples with their labels and
filters them itself (`filtered: here`). The data host needs no account; an API key in `Authorization` is forwarded so the key's
allowance (2 M cells / day) applies instead of the anonymous one.

```python
import requests
import anndata as ad
from singlet.s1 import atlas  # pip install "singlet-bio @ git+https://github.com/Singlet-Bio/singlet"

url = "https://singlet.bio/api/cells/slice"
params = {"where": '{"cell_type": "CD8 T cell", "sex": "female", "disease": "lung cancer"}', "page_cells": "5000"}
parts, cursor = [], None
while True:
    page = requests.get(url, params={**params, **({"cursor": cursor} if cursor else {})}).json()
    if page["cells"]:
        parts.append(atlas.gather(page["cells"]))  # one streamed request per page
    cursor = page["next_cursor"]
    if not cursor:
        break
adata = ad.concat(parts, join="outer")
```

Every `/api/cells` answer carries this snippet for its own filter (`slice.python`).

## Measurements

Live data: cell index `20261027T2236Z-3bdf42bc` (1,476,601 summary rows), sample-facts snapshot of 2026-10-28T11:38Z (47,670 samples, release policy `alpha-2026-10-27e`). Edge: production (`https://singlet.bio`) after the merge, timed from a residential connection, so every number includes the network round trip. CPU: the evaluator in V8 (node v24.14.1) on a laptop, 25 runs per query; Workers time is not observable from inside a Worker (timers stop during CPU work).

### Latency per query

| Query | Kind / ontology depth | Cells | Edge, cache miss p50 / p95 (ms) | Edge, cache hit p50 / p95 (ms) | CPU p50 / p95 (ms) |
|---|---|---:|---:|---:|---:|
| (no filter) | none | 221,164,736 | 147.4 / 1760.4 | 137.3 / 223.7 | 148.3 / 251.3 |
| {"cell_type": "CL:0000988"} | CL compartment (hematopoietic cell) | 92,743,222 | 123.9 / 193 | 132.1 / 164.7 | 116.2 / 161.2 |
| {"cell_type": "CL:0000738"} | CL closure only (leukocyte) | 27,677,032 | 114.9 / 185.2 | 115.5 / 186.6 | 98.2 / 126.5 |
| {"cell_type": "CL:0000542"} | CL lineage (lymphocyte) | 48,871,610 | 116.5 / 238 | 118.6 / 154.1 | 79.5 / 103.5 |
| {"cell_type": "CL:0000084"} | CL cell type (T cell) | 33,312,852 | 105.7 / 235.9 | 104.5 / 165.3 | 64.1 / 103.6 |
| {"cell_type": "CL:0000625"} | CL type (CD8 alpha-beta T cell) | 12,450,443 | 109.7 / 236.2 | 108.3 / 117.5 | 58.4 / 77.6 |
| {"cell_type": "CL:0000913"} | CL subtype (effector memory CD8) | 2,197,120 | 96.2 / 134.6 | 95.2 / 122.4 | 46.9 / 91.3 |
| {"sex": "female"} | PATO | 82,122,774 | 99.4 / 171.4 | 107.7 / 128.3 | 130.1 / 270.6 |
| {"ancestry": "HANCESTRO:0010"} | HANCESTRO | 188,804 | 73.2 / 93.1 | 68.7 / 113.7 | 33.6 / 97.2 |
| {"tissue": "UBERON:0001004"} | UBERON system (respiratory system) | 7,737,697 | 115.6 / 182.3 | 89.6 / 128.4 | 40.2 / 99.7 |
| {"tissue": "UBERON:0002048"} | UBERON organ (lung) | 6,837,872 | 116.8 / 203.5 | 103.4 / 212.9 | 30.7 / 81.4 |
| {"disease": "MONDO:0004992"} | MONDO root-level (cancer) | 3,004,380 | 104.6 / 140.7 | 95.2 / 115.3 | 28.3 / 83.3 |
| {"disease": "MONDO:0008903"} | MONDO organ (lung cancer) | 648,540 | 96.9 / 222.9 | 142.5 / 433.4 | 29.5 / 74.9 |
| {"disease": "MONDO:0005233"} | MONDO leaf (NSCLC) | 630,944 | 83.1 / 142.8 | 165.1 / 310.2 | 37.3 / 90.5 |
| {"development_stage": "adult"} | HsapDv/MmusDv (adult) | 21,030,872 | 116.7 / 261.7 | 265.4 / 480.9 | 96.2 / 177 |
| {"year": [2023, 2026]} | study | 156,797,004 | 113.4 / 148.6 | 143.3 / 547.5 | 266.8 / 421.6 |
| {"cell_type": "CL:0000625", "sex": "female", "disease": "MONDO:0008903 | combined | 129,143 | 64.5 / 118.2 | 67.4 / 100.4 | 32 / 63 |
| {"cell_type": "CL:0000625", "sex": "female", "development_stage": "adu | combined | 0 | 64.4 / 310.6 | 59.1 / 94 | 65.6 / 139.1 |
| {"or": [{"tissue": "lung"}, {"cell_type": "hepatocyte"}], "not": {"sex | combined | 3,958,475 | 101.1 / 161.1 | 130.5 / 165 | 163 / 262 |
| {"or": [{"and": [{"tissue": "blood"}, {"cell_type": "B cell"}]}, {"and | combined | 2,670,283 | 101.5 / 183.8 | 109.5 / 149 | 186.4 / 340.2 |
| {"organism": "Homo sapiens", "disease": "MONDO:0004992", "not_cell_typ | combined | 2,057,506 | 91.6 / 134.8 | 100.4 / 135.4 | 74.9 / 135.4 |
| "female CD8 T cells from adult lung tumours of African ancestry" | question | 0 | 65.5 / 531.8 | 57.4 / 179.7 | 37.1 / 97.6 |
| "female CD8 T cells from lung cancer" | question | 129,143 | 62.9 / 107.5 | 142.6 / 261.2 | 25.9 / 73.4 |
| "microglia from aged mouse brain" | question | 10,094 | 57.5 / 89.5 | 99.4 / 121.3 | 44.5 / 109.2 |
| "B cells or plasma cells in human bone marrow, not leukemia" | question | 501,741 | 86.7 / 127.5 | 146.6 / 250.1 | 85 / 153.5 |

Cache misses run the whole query in an isolate that already holds its inputs; every repeated request was an edge-cache hit (12 of 12 per query). Hits and misses take about the same time from here: network and the 10-40 kB answer dominate, not the evaluation. A cold isolate pays for its inputs once:

- cold isolate, snapshot built from D1 (first request on the PR preview): 4,101 ms in the Function.
- cold isolate, snapshot built from D1 (after a preview redeploy): 2,343 ms in the Function.
- cold isolate, snapshot from the colo's Cache API (preview): 257 ms in the Function.
- first production request after the deploy (cold isolate, snapshot from the Cache API): 72 ms in the Function.
- Index summary + sample table: 7.8 MB in 4 reads of immutable objects (edge-cached); sample facts: 5.1 MB JSON, built from 467,824 D1 rows.

### Slicing (first page of each query, `page_cells=5000`, counts = spliced + unspliced)

| Query | Cells | Samples | Bytes | Ranged reads | Bytes / cell | Filtered by | Page answer (ms) | Streamed by the data Worker |
|---|---:|---:|---:|---:|---:|---|---:|---|
| `{"cell_type": "CL:0000625", "sex": "female", "disease": "MON` | 3,886 | 3 | 10.3 MB | 6 | 2,662 | index | 578 | 10.3 MB in 6.4 s |
| `{"cell_type": "CL:0000913"}` | 2 | 1 | 0.2 MB | 4 | 90,368 | index | 1399 | 0.2 MB in 0.3 s |
| `{"or": [{"tissue": "lung"}, {"cell_type": "hepatocyte"}], "n` | 1,745 | 4 | 6.0 MB | 8 | 3,447 | here | 1286 | 5.9 MB in 3.5 s |

Matrices are stored in chunks of up to 4,096 columns, so a cell costs its chunk's share: 2.7-3.4 kB per cell when the matching cells are dense in their sample, up to 90 kB for a lone cell. `filtered: here` pages ask the index for every cell of their samples and filter them in the Function (OR / NOT across cell fields). The stream rate is this connection's (about 2 MB/s), not the data Worker's. Egress is free.

### Cost per million queries (Cloudflare list prices, Workers Paid, beyond the included allowances)

| Unit | Price | Source |
|---|---:|---|
| Workers / Pages Functions request | 0.3 $ / M requests | https://developers.cloudflare.com/workers/platform/pricing/ |
| Workers CPU time | 0.02 $ / M CPU-ms | https://developers.cloudflare.com/workers/platform/pricing/ |
| R2 Class B (read) operation | 0.36 $ / M reads | https://developers.cloudflare.com/r2/pricing/ |
| R2 egress | 0 $ / GB | https://developers.cloudflare.com/r2/pricing/ |
| D1 rows read | 0.001 $ / M rows | https://developers.cloudflare.com/d1/platform/pricing/ |

- **Uncached query:** 1 request + CPU (median query 64.1 ms, p95 340.2 ms) + 0 D1 rows + 0 R2 reads = **$1.58 per million queries** at the median, $7.1 at the p95 CPU.
- **Repeated query (edge-cache hit):** **$0.32 per million** (the request; no CPU billed on a hit).
- **Inputs:** the sample-facts snapshot costs 467,824 D1 rows ($0.00047) per colo every 6 hours; the worst case, all 330 colos all month, is 18.5 B rows ($18.53 beyond the included 25 B). The index objects are immutable and edge-cached: R2 Class B reads only on a cache miss.
- **A slice page** (one Function request, one cell-index query, one gather, its ranged reads counted as R2 misses): **$4.78 per million pages** worst case, plus $0 egress.

### Coverage per field (QC-passed samples)

| Field | Level | Ontology | Samples (share) | Cells (share) |
|---|---|---|---:|---:|
| cell_type | cell | CL | per cell | 159,085,553 (71.9%) |
| sex | cell | PATO | per cell | 196,310,887 (88.8%) |
| ancestry | cell | HANCESTRO | per cell | 3,457,431 (1.6%) |
| n_umi | cell |  | per-cell range (row scan) | |
| n_genes | cell |  | per-cell range (row scan) | |
| tissue | sample | UBERON | 21,082 (45.2%) | 96,105,057 (43.5%) |
| disease | sample | MONDO, PATO | 3,401 (7.3%) | 15,209,166 (6.9%) |
| development_stage | sample | HsapDv, MmusDv | 5,903 (12.7%) | 26,147,072 (11.8%) |
| age_years | sample |  | 5,707 (12.2%) | 24,920,002 (11.3%) |
| donor_sex | sample | PATO | 6,410 (13.7%) | 30,315,371 (13.7%) |
| donor_ancestry | sample | HANCESTRO | 1,155 (2.5%) | 4,639,808 (2.1%) |
| sorted_cell_type | sample | CL | 8,561 (18.4%) | 41,511,080 (18.8%) |
| organism | sample |  | 46,617 (99.9%) | 221,046,502 (100.0%) |
| assay | sample |  | 44,135 (94.6%) | 210,638,935 (95.2%) |
| chemistry | sample |  | 46,579 (99.9%) | 221,158,729 (100.0%) |
| tissue_group | sample |  | 27,705 (59.4%) | 128,195,339 (58.0%) |
| disease_group | sample |  | 7,868 (16.9%) | 39,030,554 (17.6%) |
| donor_status | sample |  | 3,401 (7.3%) | 15,209,166 (6.9%) |
| perturbation | sample |  | 11,711 (25.1%) | 58,017,905 (26.2%) |
| sample_kind | sample |  | 2,885 (6.2%) | 15,317,651 (6.9%) |
| median_umi | sample |  | 46,649 (100.0%) | 221,164,736 (100.0%) |
| median_genes | sample |  | 46,649 (100.0%) | 221,164,736 (100.0%) |
| mito_fraction | sample |  | 43,627 (93.5%) | 203,493,300 (92.0%) |
| cells_called | sample |  | 46,649 (100.0%) | 221,164,736 (100.0%) |
| mapping_rate | sample |  | 46,649 (100.0%) | 221,164,736 (100.0%) |
| qc | sample |  | 46,649 (100.0%) | 221,164,736 (100.0%) |
| sample | sample |  | 46,649 (100.0%) | 221,164,736 (100.0%) |
| study | study |  | 46,649 (100.0%) | 221,164,736 (100.0%) |
| year | study |  | 46,163 (99.0%) | 219,670,877 (99.3%) |
| has_publication | study |  | 6,415 (13.8%) | 30,453,658 (13.8%) |

Per-cell fields count cells with a call (cell type: any CL term; sex: female or male; ancestry: any group). The rarest filters matter most for questions like "of African ancestry": genetic ancestry is called for 1.6% of cells, so the example "female CD8 T cells from adult lung tumours of African ancestry" matches **0 cells** today, and its relaxations say why (`ancestry=African` alone: 188,804 cells in 87 samples of 19 studies; `development_stage` and `disease` together cover few samples). "Female CD8 T cells from lung cancer" matches 129,143 cells in 69 samples of 7 studies.

## Label quality (read before quoting a count)

- Cell types are the `.s1` labeller's forced calls on the Cell Ontology, validated per study at four depths: compartment 0.84,
  lineage 0.75, cell type 0.43, subtype 0.32. Counts at cell-type and subtype depth (CD8 alpha-beta T cell, effector memory CD8)
  are previews; lineage-level terms (T cell, B cell, myeloid cell) are the reliable ones. The calibrated cell-type model and its
  public benchmark against CellTypist, scANVI, Seurat mapping and SingleR (Singlet-Bio/singlet#32, #44) are research-beta work, not
  merged; Alpha serves the forced labels.
- Chromosomal sex agrees with GEO's recorded sex for 98.1% of samples; cells without enough XIST / chrY signal are `unknown`.
- Genetic ancestry is called only for human donors with enough covered sites: it covers a small part of the atlas (see coverage),
  so an ancestry filter answers for that part only. Genotypes are never stored or served.
- Tissue, disease, stage, recorded sex and ancestry are GEO text mapped to ontologies; a sample whose record does not say is
  "not recorded" in every breakdown, and a filter on these fields leaves it out.

## Deploy (needs Zach's approval)

No migration: the endpoints read existing D1 tables (`s1_sample`, `s1_study`, `gse_meta`, `gse`, `gsm`, `sample_qc`, `sample_term`,
`sample_property`, `sample_attr`, `ontology_closure`, `ontology_term`, `ontology_label`, `alpha_exclusions`, `alpha_withheld`)
and the live cell index on data.singlet.bio; nothing is written to D1 or R2, and the data Worker is unchanged.

1. Merge the PR into `main` (Cloudflare Pages deploys `main` to singlet.bio).
2. Check it is live: `curl -s https://singlet.bio/api/cells/fields | head -c 300` and
   `curl -s "https://singlet.bio/api/cells?cell_type=T%20cell&tissue=lung" | head -c 300`.
3. `bash scripts/smoke.sh https://singlet.bio`.
4. Re-run the edge measurements against production: `npm run cells:bench -- edge --base https://singlet.bio` then
   `npm run cells:bench -- cost`.
