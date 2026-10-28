# Cell search: every cell of the atlas, by any metadata

Status 2026-10-28: built and measured on live data; not deployed (see "Deploy" at the end). Numbers below come from
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
  sample facts are one snapshot built from D1 once per colo and hour (about 400k rows read), kept in the Cache API and the isolate.
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

MEASUREMENTS

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
