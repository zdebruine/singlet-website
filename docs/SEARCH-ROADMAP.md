# Search roadmap: from study search to cell cohorts

State on 2026-10-20. This is a plan, not code. It is written to be picked up by an orchestrating session
(Sonnet 5.5 with Haiku 5.5 sub-agents, on Clipper for the heavy parts) and worked through as independent
tasks, each with its own validation criteria (section 8).

Repositories involved:

| Repo | Role in this plan |
|---|---|
| `zdebruine/singlet-website` (public, this repo) | catalog schema, enrichment ingest, search API, MCP server, site |
| `Singlet-Bio/singlet` (public) | Python/R clients: cohort loading, partial reads |
| `singlet-agents` (private) | batch jobs on Clipper (enrichment runs, phenotype runs), the cell phenotype engine (`feat/cell-phenotype`) |
| `singlet-cloud` (private) | paid layer; the conversational scoping agent and large cohort exports land here once the public primitives exist |

## 1. Where search stands today

What exists (all in `functions/_shared/`):

- `interpret.ts`: a deterministic vocabulary parse (organism aliases, `vocab_rules` for tissue / disease / assay,
  a curated cell-type list, cell-count and year phrases). Leftover words go to a model (Llama 4 Scout on Workers AI)
  once per distinct query, cached in `interpret_cache`. Output is five facet arrays plus keywords.
- `search-core.ts`: study-level search over `gse_meta` JSON arrays and FTS5 (`fts_gse`, `fts_gsm`), bm25 plus
  facet weights (`scoreStudy`), AND across facets, OR within. Sample level reuses the same filters on `gsm` columns.
- `nl-search-core.ts`: only the interpreted organism is a hard filter; everything else is a ranking signal.
  Zero results produce "drop this filter" suggestions.
- `conditions.ts`: per-study condition keys parsed from `gsm.characteristics` (2 to 12 distinct values).
- MCP: 14 tools, `search_datasets` fronting `/api/nl-search`; `get_partial_download` gives byte ranges for one file.
- Eval: `scripts/search-eval` with 39 keyword and 25 sentence queries; production flow scores 26/39 on the keyword set.

What the live catalog holds (production D1, 2026-10-20):

| Fact | Number |
|---|---|
| Studies with a published file / downloadable | 8,200 / 7,184 |
| Samples done / in files and usable | 85,897 / 53,438 |
| Cells in downloadable files | 241.7 M |
| Done samples with `characteristics` text | 67,167 |
| Done samples with structured `cell_type` / `sex` / `disease` / `tissue` / `donor_id` | 12 / 8 / 1 / 20 / 0 |
| Done samples with `tissue_group` NULL / "Other" | 35,282 / 4,249 |
| Done samples with `disease_group` NULL | 73,122 (85%) |
| Characteristics mentioning treatment / age / sex / cell type / genotype / cell line / donor / ancestry words | 20,362 / 18,412 / 13,486 / 33,559 / 19,710 / 11,054 / 10,567 / 2,759 |
| Published studies without an abstract; mean abstract length | 469; 881 chars |
| Studies with a PubMed id; rows in `publications` | 1,307; 0 |
| Studies whose files carry genetic sex / donor demultiplexing / doublet scores / ancestry (human) | 3,771 / 3,771 / 3,771 / 242 |

The conclusions that drive the plan:

1. **The structured sample columns are empty.** Everything a searcher wants (tissue, disease state, treatment,
   age, sex, cell type sorted, genotype, cell line vs primary) sits in the free-text `characteristics` string,
   in whatever key names each submitter chose. Search today is keyword search over that text plus two coarse
   group columns that are NULL for most samples. This, not the interpreter, is the ceiling on search quality.
2. **Abstracts are paper abstracts, not data descriptions.** They describe a finding; the searcher wants to know
   what tissue, which conditions were compared, how many donors, what treatment, which platform. We should not
   rewrite abstracts. We should add a structured, grounded study data card next to them (section 4.2) and
   keep the abstract as provenance.
3. **The pipeline already computes facts nobody can search on.** Genetic sex, continental ancestry, donor count,
   doublet rate, cell cycle, chemistry (from the file), depth. They are in the `.singlet` files and not in D1.
4. **There is no cell-level axis.** Author cell-type labels do not exist in the files ("counts, not annotations").
   The phenotype engine in `singlet-agents` is building per-cell labels; search needs a contract for ingesting
   them (section 4.4) so "adipocytes" can mean cells, not studies that mention adipocytes.
5. **The query language cannot say "not", "between", or "at least N donors".** Negation, ranges, set logic and
   cell-level predicates need a structured cohort query that both the UI and a model produce (section 5).
6. **Slicing is feasible without repacking.** `.1pz` is column-chunked (cells are columns, `chunk_cols` per
   chunk, fast random column access) and stored uncompressed inside the zip, so a set of cells maps to byte
   ranges in the public file. A cohort can be a manifest of (study, sample, column chunks) resolved from cached
   metadata and fetched with Range requests (section 6).

## 2. Who searches, and for what

| Persona | Typical ask | How they want to search | What "done" looks like |
|---|---|---|---|
| Computational biologist building a reference, training set or benchmark | "all human CD8 T cells from blood, healthy adults, 10x 3' v3, at least 3 donors per study" | structured filters they can see and edit; reproducible spec; bulk manifest; Python/R one-liner | a cohort spec + manifest + loader call that returns one AnnData |
| Translational / wet-lab researcher with a biological question | "adipocytes in obese adults, no GLP-1 treatment, not pediatric, with lean controls" | one sentence, then a short back-and-forth that narrows by what exists | a scoped cohort with the caveats spelled out (which studies were excluded and why) |
| An AI agent (Claude, ChatGPT, Cursor through MCP) acting for either | the same, programmatically | deterministic, small, explainable tool results; counts before data; the ability to ask "what if I drop X" | a cohort id it can hand to the loader |
| Method developer | "paired cells/nuclei from the same tissue", "time courses with 4+ points", "studies with VDJ and SNPs" | design and layer filters more than biology | a list of studies with the design facts verified |

Query shapes the system must handle, with examples drawn from the personas above:

- Entity constraints on several axes at once: organism, tissue (with anatomy hierarchy), cell type (with
  ontology hierarchy), disease (with hierarchy), treatment / perturbation, genotype, age or life stage, sex,
  ancestry, sample type (primary tissue, cell line, organoid, PDX, iPSC-derived), platform and chemistry, depth.
- Negation and exclusion: "not treated", "no cell lines", "exclude pediatric", "not tumor-adjacent".
- Baseline vs perturbed: most askers want untreated baseline unless they say otherwise; the system must say
  which it returned and offer the other.
- Controls: "with matched healthy", "case and control from the same study".
- Quantities: cells, donors, samples per group, sequencing depth, year.
- Design: time course, dose response, knockout vs wild type, paired tissue sites.
- Open-ended topic: "what do we have on gut microbes and infant immunity" (recall over data cards).

## 3. What AI-native search means for singlet

1. **The unit of retrieval is a cell cohort**, not a study. A result is a reproducible specification
   (the cohort query), its resolution (counts by study, sample, cell label), and a manifest the loader can
   fetch. Studies remain the unit of provenance and download.
2. **Every attribute is a typed fact with provenance.** `source` is one of `geo` (declared by the submitter),
   `pipeline` (computed from reads), `model` (inferred from text by a model, with confidence and evidence).
   Agents and users can filter on source ("declared only") and the UI labels inferred values as such. This
   is what makes model enrichment safe to ship: nothing inferred is silently promoted to fact.
3. **Natural language is a translation step, execution is deterministic.** NL goes to a structured cohort
   query (section 5) by a model that has the ontology and can count; the query runs as SQL; the same query
   can be edited as chips, saved, shared and re-run. No ranking tricks stand in for logic.
4. **Scoping is a dialogue over counts.** For any query the server returns the distribution of what exists
   on every axis (including treatment, age, sex, platform) and the ambiguities it detected ("obesity: 3 of
   11 studies are GLP-1 treated; 2 are pediatric"). The client (site or MCP agent) narrows with the user.
   The server never relaxes a filter on its own (the existing rule stays).
5. **Explain every inclusion and exclusion.** Per study and per sample: which facts matched, which filter
   excluded it, with the evidence string. Low QC, reference mismatch and the QC tiers keep their current
   semantics (`docs/QC.md`).
6. **Public primitives, paid conversation.** Enrichment, the cohort query executor, counts, manifests and
   the MCP tools are catalog infrastructure and belong on singlet.bio (CC0 data, open code). The multi-turn
   scoping agent, large cohort exports materialised on Clipper, and anything that spends model tokens per
   turn beyond the free daily quota run in singlet-cloud on the same primitives.

## 4. Metadata: what to extract, how to store it, how to trust it

### 4.1 Sample facts (`sample_attr`)

One long table, one row per fact, instead of adding columns to `gsm`:

```
sample_attr(
  gsm_id, gse_id, attr, value_raw, value_norm, ontology_id, unit, value_num,
  source ('geo'|'pipeline'|'model'), confidence REAL, evidence TEXT,
  extractor_version TEXT, updated_at
)  PRIMARY KEY (gsm_id, attr, source)
```

Attributes (the closed list; add by migration, not ad hoc):

| attr | value_norm | ontology | typical source |
|---|---|---|---|
| `organism` | scientific name | NCBITaxon | geo (already `organism_primary`) |
| `tissue` | UBERON label | UBERON | geo characteristics (`tissue:`), model from title/source when absent |
| `tissue_group` | one of the 28 groups | derived from UBERON ancestors | derived |
| `sample_type` | `primary tissue`, `cell line`, `organoid`, `pdx`, `ipsc derived`, `sorted population`, `other` | fixed list | model |
| `cell_type_sorted` | CL label of the population the sample was enriched for (not per-cell) | CL | geo (`cell type:`, `sort:`), model |
| `disease` | MONDO label; `healthy` for declared controls | MONDO | geo (`disease:`, `disease state:`, `diagnosis:`), model |
| `disease_state` | `case`, `control`, `unaffected tissue`, `unknown` | fixed | model, grounded in a characteristics key |
| `disease_group` | one of the 12 groups | derived from MONDO ancestors | derived |
| `treatment` | agent name (ChEBI/DrugBank label when a drug), else free label; `none` for declared vehicle/untreated | ChEBI where possible | geo (`treatment:`, `agent:`, `stimulation:`), model |
| `treatment_status` | `untreated`, `treated`, `vehicle`, `unknown` | fixed | model |
| `timepoint` | value_num + unit, `baseline` when stated | UO | geo, model |
| `genotype` | free label; `wild type` normalised | none | geo (`genotype:`, `strain:`) |
| `age` | value_num + unit (years, months, weeks, days, pcw, E-days) | UO | geo (`age:`), model for ranges ("65-70" → 67.5 with evidence) |
| `life_stage` | `embryonic`, `fetal`, `neonatal`, `pediatric`, `adult`, `aged`, `unknown`, species-aware thresholds | fixed | derived from age, else model |
| `sex` | `male`, `female`, `mixed`, `unknown` | PATO | geo (`sex:`, `gender:`) |
| `sex_genetic` | same | PATO | pipeline (`sex_call.json`) |
| `ancestry` | HANCESTRO label | HANCESTRO | geo (`race:`, `ethnicity:`) |
| `ancestry_genetic` | continental | HANCESTRO | pipeline (`ancestry_call.json`) |
| `donor` | donor label within study; `n_donors` on the sample from `donor_assignments.tsv` | none | geo, pipeline |
| `chemistry` | from the file (`summary.json` protocol) | EFO | pipeline (replaces the catalog guess; the audit showed 22k disagreements) |
| `nuclei` | `cells`, `nuclei` | fixed | geo (`single nucleus`), model |
| `depth` | median UMI, median genes (already in `sample_qc`) | | pipeline |

Rules:

- `geo` rows are written only from an explicit characteristics key or the sample title / source field, with
  `evidence` = the exact key: value pair. A `model` row is written only with `evidence` quoting the text it
  was read from; a model row never overrides a `geo` row for the same attr, it sits beside it.
- Default search semantics: `geo` and `pipeline` rows count; `model` rows count when `confidence ≥ 0.8`
  and the UI shows the badge. `include_inferred=0` turns model rows off (API and MCP).
- Conflicts are facts too: `sex` ≠ `sex_genetic` or `organism` ≠ reference build are surfaced as sample
  flags (the latter already exists as `reference_mismatch`).

### 4.2 Study data cards (`study_card`)

```
study_card(gse_id, card_json, summary_text, extractor_version, model, grounded INTEGER, updated_at)
```

`card_json` is a fixed schema: organisms; tissues (UBERON); sample types; design (`comparison_axes`:
the condition keys from `conditions.ts` mapped to attrs, with the groups and sample counts per group);
diseases with case/control counts; treatments with treated/untreated counts; age range and life stages;
sexes; donors (declared and genetic); platforms from the files; layers present; the one-line "what you can do
with it" and the caveats (no donor ids, pooled sexes, cell line only, no controls).

`summary_text` is 2 to 4 sentences written for a searcher, not a reviewer: "Subcutaneous adipose tissue from
12 adult human donors, 6 obese and 6 lean, no treatment, 10x 3' v3, snRNA-seq, about 80k cells after QC.
Author labels absent; genetic sex and donor demultiplexing available."

`grounded = 1` only when every entity in the card resolves to a `sample_attr` row or a `sample_qc` /
`bundle_manifest` fact. A card that mentions a treatment no sample row carries is not grounded and is not
indexed for search. This is the answer to "do we need to rewrite the abstracts": no; we write a grounded
card from title + abstract + every characteristics string + the computed facts, and search runs on the card
and the facts. The abstract stays on the study page.

### 4.3 Ontologies

Load a small, versioned slice of each ontology into D1 (`ontology_term`, `ontology_synonym`,
`ontology_closure` with ancestor pairs), restricted to terms that occur in the catalog plus their ancestors:
UBERON (tissue), CL (cell type), MONDO (disease), NCBITaxon (organism, already handled), HANCESTRO (ancestry),
EFO (assay), PATO (sex), ChEBI (treatment agents, small). A few thousand terms, well within D1.

Why ontologies and not the current group lists: hierarchy is what makes "T cell" include "CD8 T cell" and
"gut" include "colon" without hand-written rules, and it is what the phenotype engine's labels will be
(CL ids). The 28 tissue groups and 12 disease groups stay as roll-ups derived from ancestors, so the UI and
the existing API do not change on day one. `vocab_rules` remains the fallback mapper for raw strings and
becomes the seed for the synonym table.

Can diseases be standardized? For the bulk, yes: the catalog's disease strings are dominated by a few hundred
distinct phrases (cancers by site, COVID-19, IBD, lupus, AD, PD, T1D/T2D, obesity, fibrosis). MONDO covers
them, and a model maps the long tail with evidence. The hard cases (study-specific models, "disease model
induced by X") are handled as `disease` + `treatment` pairs, not as new disease terms. Review is per attr
with a gold set (section 8), not per study.

### 4.4 Cell-level labels (contract with the phenotype engine)

The engine is proprietary and stays in `singlet-agents`. What crosses into the public catalog is data:

- In each published file, per sample: `samples/<GSM>/phenotype/cell_labels.tsv` with `column` (the .1pz
  column index after permutation), `barcode`, `label_id` (CL), `label`, `confidence`, `state` (optional
  program labels), `pheno_version`. STORED or DEFLATED like other tables. Adding it means re-packing the
  study file; the alternative is a sidecar object `data/<GSE>/<GSE>.phenotype.<version>.zip` next to the
  bundle, which keeps published files immutable and is the recommended first step.
- In D1, per sample: `cell_pheno_summary(gsm_id, label_id, n_cells, n_conf80, pheno_version)` and per
  study roll-ups in `gse_meta` (`cell_labels` JSON, `n_labeled_cells`). This is what cohort queries count.
- Whether the per-cell labels are published CC0 in the public files or stay a Cloud feature is a business
  decision to make before task T13 starts; the catalog counts can be public either way.

Can we reliably detect what the user wants in cell types? Yes at the ontology level: the query term maps to a
CL id (synonyms included), the closure expands it, and `cell_pheno_summary` says how many cells of that id
and its descendants each sample holds with confidence ≥ threshold. Reliability of the labels themselves is
the engine's benchmark (its held-out sets), and the confidence column is what the query thresholds on.

### 4.5 Computed per-sample facts already in the files

`sex_call.json`, `ancestry_call.json`, `donor_assignments.tsv` (donor count, doublet rate),
`doublet_scores.tsv`, `cell_cycle_scores.tsv`, `cell_qc_metrics.tsv` (per-cell QC distributions),
`summary.json` protocol (chemistry). An indexer reads them per study, like `index-next` reads `summary.json`
today, and writes `pipeline` rows into `sample_attr`. It also records the `.1pz` chunk map (section 6).

## 5. The cohort query

One JSON grammar used by the UI (chips), the NL translator, the MCP tools and the clients:

```json
{
  "version": 1,
  "include": [
    {"attr": "organism", "any": ["NCBITaxon:9606"]},
    {"attr": "tissue", "any": ["UBERON:0002190"], "expand": "descendants"},
    {"attr": "cell_type", "any": ["CL:0000136"], "expand": "descendants", "level": "cell", "min_confidence": 0.8},
    {"attr": "disease", "any": ["MONDO:0011122"]},
    {"attr": "life_stage", "any": ["adult", "aged"]},
    {"attr": "age", "num": {"min": 18, "unit": "year"}}
  ],
  "exclude": [
    {"attr": "treatment", "any": ["CHEBI:semaglutide", "CHEBI:liraglutide"], "expand": "descendants"},
    {"attr": "sample_type", "any": ["cell line", "organoid"]}
  ],
  "require": {"min_donors_per_study": 3, "min_cells": 500, "qc_tier": 0, "chemistry": ["10x 3' v3"]},
  "sources": ["geo", "pipeline", "model>=0.8"],
  "text": "GLP-1",
  "level": "cell"
}
```

Semantics: AND across clauses, OR within `any`; `exclude` removes a sample when any excluded fact is present
with an accepted source; an attribute that is `unknown` on a sample neither includes nor excludes it, and the
resolution reports how many samples were unknown on each axis (this is what the scoping dialogue shows).
`level` decides what the manifest counts: `study`, `sample`, or `cell` (needs 4.4).

Resolution (`POST /api/cohort/resolve`) returns: totals (studies, samples, cells), per-study rows with the
matched and excluded facts and evidence, the facet distribution of every attr over the included samples,
`unknown_by_attr`, `ambiguities` (axes where the included set mixes states the query did not constrain:
treated and untreated, cases and controls, cells and nuclei, pediatric and adult), and `what_if` counts for
dropping each clause. All deterministic SQL on `sample_attr` + `ontology_closure` + `sample_qc` + `gse_meta`,
no model call. Saved cohorts (`cohorts` table exists) store the query and the resolved manifest hash.

NL translation (`/api/nl-search` v2): the model receives the grammar, the attribute list, and tools to
look up ontology terms and to count a candidate query; it returns a cohort query plus a short list of
assumptions it made ("read 'adult' as age ≥ 18 years; treated samples left in, say 'untreated' to drop
them"). The deterministic parser in `interpret.ts` stays as the free path and becomes a first draft the
model edits. Validation of the model's output against the ontology stays (nothing enters a query that is
not a known term, a number, or free text in `text`).

## 6. Assembling the data for a cohort

The files are one zip64 per study on `data.singlet.bio`; the matrices are `.1pz` entries STORED (not
deflated), each a header plus column chunks of `chunk_cols` cells with a permutation that groups cells by
density. Cells are columns. So:

1. **Chunk map per sample** (`pz_chunk_index(gsm_id, file, n_cols, chunk_cols, chunk_offsets JSON, perm_present)`),
   read once from the file header and footer with two Range requests when the sample is indexed (task T6).
   Together with `bundle_index` (zip entry offsets) this gives the absolute byte range of any chunk.
2. **Cell selection** from `cell_labels.tsv` (column indices) or from `cell_calls.tsv` for whole samples.
   Selected columns map to chunks; the manifest lists, per sample, the chunk byte ranges to fetch and the
   column indices to keep inside them. Because the permutation groups by density, a label's cells are spread
   over many chunks; the first implementation fetches whole chunks and measures the over-read (expected
   2 to 5x for a 10% subset; acceptable at first, and the measurement decides whether per-label shards are
   worth packing later).
3. **The Worker plans, the client fetches.** Workers cannot hold matrices; `/api/cohort/manifest` returns the
   plan (JSON or TSV: study, sample, entry, byte ranges, columns, label counts, checksums, version hash).
   `singlet.load(cohort=...)` in the Python client, and `singlet_load_cohort()` in R, fetch the ranges in
   parallel (free egress from the public domain), decode the chunks, keep the selected columns, and return one
   AnnData/Seurat object with obs columns filled from `sample_attr` and the labels. Large cohorts
   (hundreds of studies) are materialised as h5ad on Clipper by a Cloud job from the same manifest.
4. **Caching.** Manifests are deterministic for (query, catalog version), so they are cached in the Cache
   API keyed by the query hash plus `extractor_version` + `pheno_version`. Popular cohorts (PBMC healthy
   adult, all microglia, all cardiomyocytes) can later be pre-sliced into their own `.singlet` objects.

Platform and filter effects on assembly: chemistry, nuclei vs cells, depth and QC tier all enter as
`require` clauses and are reported per study in the manifest so the loader can set `obs` batch columns. The
default is the current downloadable rule (tier 0, no reference mismatch), which must not change.

## 7. Development framework

Phases, in dependency order. Tasks inside a phase are independent unless stated.

```
Phase 0  Foundations        T1 schema + migrations     T2 ontology slice       T3 cohort grammar + resolver skeleton   T4 eval sets
Phase 1  Enrichment         T5 GEO fact extractor      T6 file fact indexer    T7 study cards                           T8 disease/tissue/treatment mapping review
Phase 2  Search             T9 resolver complete       T10 NL translator v2    T11 scoping API + UI                     T12 MCP tools v2
Phase 3  Cells              T13 phenotype ingest       T14 chunk-level manifests + client loading
Phase 4  Quality loop       T15 query log + feedback   T16 recall via embeddings (Vectorize)   T17 docs + launch checks
```

Rules for the orchestrator and every agent:

- Branch + PR per task, CI green, smoke test on the preview, migration applied to production before the code
  that reads it merges (`CLAUDE.md`). Previews share production D1: enrichment writes go through
  `/api/ingest/<table>` with the ingest token, never from a preview's request path.
- `search-core.ts` is a hot file: at most one task edits it at a time (T9, then T11). Other tasks add new
  modules (`cohort-core.ts`, `ontology.ts`, `attr-extract.ts`, `study-card.ts`, `pz-chunks.ts`).
- Model calls for enrichment use Haiku 5.5 through the Anthropic API from Clipper jobs in `singlet-agents`
  (batched per study: all of a study's characteristics in one call for within-study consistency, with
  prompt caching on the shared instructions). Extraction prompts and schemas live in this public repo
  (`scripts/enrich/`), the job scripts in `singlet-agents/hpc/`. Nothing from the phenotype engine is copied here.
- Default search behaviour, headline numbers and `DOWNLOADABLE_SQL` must not change until Phase 2 ships
  behind the new endpoints; the old `/api/nl-search` stays until the golden sets show v2 is better.
- Every task's PR description ends with the validation it ran and the numbers.

## 8. Tasks with validation criteria

Owner: S = Sonnet 5.5 session, H = Haiku 5.5 sub-agent (read, extract, test), C = runs on Clipper.
Each task names the files it owns; two tasks never own the same file.

### Phase 0

**T1. Schema and migrations** (S)
- Files: `schema/030_search_facts.sql` (`sample_attr`, `study_card`, `ontology_term`, `ontology_synonym`,
  `ontology_closure`, `pz_chunk_index`, `cell_pheno_summary`, indexes on `(attr, value_norm)`,
  `(attr, ontology_id)`, `(gse_id, attr)`); `schema/001_init_local.sql` twin for the dev harness;
  `functions/api/ingest/[table].ts` accepting the new tables with the existing token and ≤ 100 bound params.
- Validate: migration applies to a local D1 and is idempotent (run twice); `npm run check` green;
  `POST /api/ingest/sample_attr` with 1,000 rows writes in ≤ 10 batches; a `select` with the planned
  `(attr, ontology_id)` lookup over 1 M rows uses the index (`EXPLAIN QUERY PLAN` in the local harness).

**T2. Ontology slice** (H for extraction, S for the loader)
- Files: `scripts/ontology/` (download UBERON, CL, MONDO, HANCESTRO, EFO, PATO, ChEBI subsets; build
  `term`, `synonym`, `closure` TSVs restricted to terms matched by the catalog's distinct raw values plus
  ancestors; pinned ontology release versions in `scripts/ontology/VERSIONS`), `functions/_shared/ontology.ts`
  (lookup by id, by synonym, descendants(id), ancestors(id), roll-up to `tissue_group` / `disease_group`).
- Validate: unit tests: "T cell" → CL:0000084, descendants include CL:0000625 (CD8 T cell); "colon"
  ancestors include UBERON:0001555 (gut); every one of the 28 tissue groups and 12 disease groups has a
  defined ancestor set and the roll-up reproduces the current `vocab_rules` group for ≥ 95% of the raw
  tissue/disease strings in production (measured over the distinct values, report the misses); the loaded
  slice is ≤ 20 k terms and ≤ 200 k closure rows.

**T3. Cohort grammar and resolver skeleton** (S)
- Files: `docs/COHORT-QUERY.md` (grammar, semantics, examples incl. negation and unknown handling),
  `functions/_shared/cohort-core.ts` (parse + validate a query, SQL builder over `sample_attr` +
  `ontology_closure` + `sample_qc` + `gse_meta`, resolution shape), `functions/api/cohort/resolve.ts`,
  `src/test/cohort-core.test.ts`.
- Validate: 30 unit tests over the local harness with seeded facts: AND/OR/exclude, descendants expansion,
  unknown-neither-includes-nor-excludes, source gating (`model>=0.8`), numeric ranges with units, level =
  study/sample; a query with 50 ontology ids compiles to ≤ 100 bound parameters (ids passed as one JSON
  array through `json_each`); an unknown attr or id is a 400 with the offending token.

**T4. Evaluation sets** (H writes, S reviews)
- Files: `scripts/search-eval/golden-cohort.json` (80 queries: the persona asks in section 2, each with the
  expected cohort query and, where the answer is known, expected studies that must be in and must be out),
  `scripts/search-eval/golden-facts.json` (200 studies × attrs: hand-checked `sample_attr` values for
  tissue, disease, disease_state, treatment, treatment_status, age, life_stage, sex, sample_type,
  cell_type_sorted; built by a strong model and verified by a human spot-check of 50 studies, the file
  records who checked each row), `scripts/search-eval/run-cohort.ts`.
- Validate: the gold fact file covers every attr with ≥ 150 labelled samples; at least 25 cohort queries
  contain a negation, 15 a numeric range, 15 a treatment/baseline distinction, 10 a cell-level ask; the
  runner prints precision/recall per attr and per query a pass/fail with the diff.

### Phase 1

**T5. GEO fact extractor** (S designs, H runs in batches, C)
- Files: `scripts/enrich/extract-sample-attrs.{md,ts}` (prompt, JSON schema, batching per study, evidence
  requirement, confidence calibration instructions), `scripts/enrich/run-extract.py` (Clipper job: pulls
  `gsm` rows per study from `/api/gsm?gse=`, calls Haiku 5.5 with prompt caching, validates every value
  against T2's ontology, posts `geo` rows for explicit key: value pairs and `model` rows for inferred ones to
  `/api/ingest/sample_attr`), deterministic pre-pass for the explicit keys (`tissue:`, `sex:`, `age:`,
  `treatment:`, `cell type:`, `disease state:`) that needs no model.
- Validate: on `golden-facts.json`: precision ≥ 0.95 and recall ≥ 0.85 for `geo` rows; precision ≥ 0.90 for
  `model` rows at confidence ≥ 0.8; every row has non-empty `evidence` that is a substring of the sample's
  title, source or characteristics; cost per study ≤ $0.01 measured on 100 studies before the full run; the
  full run over 8,200 studies completes idempotently (re-running changes 0 rows when `extractor_version` is
  unchanged).

**T6. File fact indexer** (S, C)
- Files: `scripts/enrich/index-file-facts.py` (per study: read `sex_call.json`, `ancestry_call.json`,
  `donor_assignments.tsv`, `doublet_scores.tsv`, `summary.json` protocol and the `.1pz` header/footer of
  `exon_counts` and `intron_counts` via Range requests; post `pipeline` rows and `pz_chunk_index` rows),
  `functions/_shared/pz-chunks.ts` (header parse shared with the manifest planner).
- Validate: for 20 studies the chunk map's byte ranges, fetched and decoded with the Python `read_1pz`
  path, reproduce the full matrix column for column; `sex_genetic` agrees with declared `sex` on ≥ 95% of
  samples that have both (report disagreements as a list, they are findings); 7,184 downloadable studies
  indexed; the run is resumable and skips studies whose `extractor_version` matches.

**T7. Study cards** (S designs, H runs, C)
- Files: `scripts/enrich/study-card.{md,ts}` (prompt + schema), `scripts/enrich/run-cards.py`,
  `functions/_shared/study-card.ts` (grounding check: every entity in the card must match a `sample_attr`,
  `sample_qc`, `bundle_manifest` or `gse_meta` fact, else `grounded = 0`), `functions/api/gse/[id].ts` adds
  `card` to the study JSON, study page shows `summary_text` above the abstract labelled "Data summary".
- Validate: ≥ 90% of downloadable studies grounded; a Haiku judge pass on 100 cards scores "would a searcher
  know what tissue, conditions, treatment, donors and platform this is" ≥ 4/5 on 90 of them, and 20 are
  read by a human; no card contains a number that is not in the facts (checked by regex over the summary
  against the card's own counts); summary ≤ 600 characters.

**T8. Mapping review for disease, tissue, treatment** (H, with a human in the loop)
- Files: `scripts/enrich/review/` (reports: top 500 distinct raw values per attr with their mapped term,
  confidence and sample count; unmapped values ranked by sample count), `scripts/ontology/overrides.tsv`
  (hand-approved mappings that beat the model).
- Validate: the top 500 raw values per attr (which cover ≥ 85% of samples) are each either mapped with an
  approved override or flagged; unmapped share of samples ≤ 10% per attr after overrides; re-running T5 with
  overrides changes only the rows the overrides touch.

### Phase 2

**T9. Resolver complete** (S; the one task that edits `search-core.ts` in this phase)
- Files: `functions/_shared/cohort-core.ts` (facets over the included set, `unknown_by_attr`, `ambiguities`,
  `what_if`, evidence per study), `functions/_shared/search-core.ts` (expose the per-study evidence shape so
  Browse can render it), `functions/api/cohort/resolve.ts`, `functions/api/cohort/facets.ts`.
- Validate: on `golden-cohort.json`, every expected-in study is included and every expected-out study is
  excluded for ≥ 70 of 80 queries (the rest listed with the reason); p95 latency ≤ 800 ms on production D1
  for the 80 queries with ≤ 50 k rows read each (measure with D1's `rows_read`); the `what_if` block lists
  one count per clause and never relaxes the query itself; response cached by query hash.

**T10. NL translator v2** (S)
- Files: `functions/_shared/interpret-cohort.ts` (model prompt with the grammar, attr list, tool calls
  `lookup_term` and `count_query`; validation of the output against the ontology; assumptions list),
  `functions/api/nl-search.ts` (v2 behind `?v=2`, old path untouched), `scripts/search-eval/run-cohort.ts`
  hooks, `INTERPRET_RULES_VERSION` bump.
- Validate: on `golden-cohort.json` the produced query equals the expected one (after canonicalisation) for
  ≥ 60 of 80; all 25 negations end up in `exclude`; all 15 ranges carry the right unit; the deterministic
  parser path still answers ≥ 60% of the keyword golden set without a model call; cost per model call
  ≤ $0.003 on Workers AI or ≤ $0.01 on Haiku 5.5 measured; model output that names an unknown term is
  rejected and reported in `dropped`.

**T11. Scoping API and site** (S for API, H for UI pieces)
- Files: `src/components/search/` (editable chips for include/exclude/require, "unknown on N samples"
  counts, ambiguity prompts as one-click refinements, per-study evidence drawer, source badges for inferred
  values), `src/pages/Browse.tsx`, `src/pages/AiSearch.tsx`, `src/lib/api.ts` types.
- Validate: Playwright: type "adipocytes in obese adults, not GLP-1 treated" → chips show include adipocyte
  (CL), obesity (MONDO), life stage adult; exclude semaglutide/liraglutide; the ambiguity row offers "cases
  and controls are mixed, keep controls?"; removing a chip re-resolves; URL round-trips the query; zero
  console errors; no change to the home page headline numbers.

**T12. MCP tools v2** (S)
- Files: `functions/_shared/mcp-tools.ts` (new tools `search_cells`, `resolve_cohort`, `refine_cohort`,
  `cohort_manifest`, `lookup_term`; `search_datasets` unchanged), `src/pages/DocsMcp.tsx`, `README.md`.
- Validate: a transcript with Claude via MCP that goes from one sentence to a saved cohort in ≤ 4 tool
  calls for 10 of the persona asks; each tool result ≤ 20 KB; `structuredContent` carries the cohort query;
  metering unchanged (only a fresh model reading spends budget).

### Phase 3

**T13. Phenotype ingest** (S here, the engine side stays in `singlet-agents`)
- Files: `docs/PHENOTYPE-CONTRACT.md` (the sidecar layout and `cell_labels.tsv` columns from section 4.4,
  `pheno_version` semantics), `functions/api/ingest/[table].ts` for `cell_pheno_summary`,
  `functions/_shared/catalog-refresh.ts` roll-ups into `gse_meta`, `functions/_shared/cohort-core.ts`
  cell-level predicates (`level: "cell"`, `min_confidence`).
- Validate: with a sidecar for 20 studies produced by the engine's held-out run: counts in D1 equal the
  sidecar's row counts per label; a cell-level query for CL:0000084 (T cell) returns descendants' counts
  summed; `include_inferred=0` leaves cell labels in (they are `pipeline`, not `model`); the study page shows
  label counts as "computed labels (version)".

**T14. Chunk-level manifests and client loading** (S here and in `Singlet-Bio/singlet`)
- Files: `functions/api/cohort/manifest.ts` (plan from `pz_chunk_index` + `bundle_index` + labels),
  `python/singlet/_cohort.py` (`singlet.load(cohort=...)`, parallel Range fetches, chunk decode, column
  selection, obs from facts and labels), `r/R/cohort.R`, docs.
- Validate: for a cohort of ~1 M cells across 30 studies, the client loads it with ≤ 3x the bytes of the
  selected columns and reproduces, column for column, the subset of a full `singlet.load` of each study;
  the manifest is byte-identical across two runs; a tampered range (checksum mismatch) raises.

### Phase 4

**T15. Query log and feedback** (S)
- Files: `schema/031_search_log.sql` (`search_log`: query hash, normalised text, cohort query, totals, ms,
  model used, anonymous subject hash; no raw IPs), `functions/_shared/search-log.ts`, a weekly report
  script that lists top queries, zero-result queries and dropped terms for the golden sets.
- Validate: rows written only with `waitUntil`, never on the request path; privacy page updated; the report
  runs against production read-only within the daily budget.

**T16. Recall via embeddings** (S, optional until T15 shows open-ended queries failing)
- Files: `scripts/enrich/embed-cards.py` (study card + sample facts text → Workers AI bge embeddings →
  Cloudflare Vectorize index with `gse_id` metadata), `functions/_shared/recall.ts` (candidate studies from
  vector search, then the structured resolver filters them; vector rank only orders, never includes).
- Validate: on the 25 sentence queries and 20 new open-ended ones, recall@20 of expected studies improves
  over FTS alone by a measured margin and the structured filters still exclude everything they should.

**T17. Docs and launch checks** (H)
- Files: `src/pages/Docs.tsx` (cohort queries, provenance sources, inferred values), `docs/QC.md` links,
  `scripts/smoke.sh` additions for `/api/cohort/resolve` and the manifest, README MCP tool list.
- Validate: smoke passes on a preview and on production after merge; every example query in the docs
  resolves to ≥ 1 study.

## 9. Decisions needed before the agents start

1. Publish per-cell phenotype labels in the public files (CC0) or keep them Cloud-only with public counts.
2. Accept the ontology set in 4.3 (UBERON, CL, MONDO, HANCESTRO, EFO, PATO, ChEBI) and the rule that the
   28 tissue groups and 12 disease groups become derived roll-ups.
3. Model-inferred facts count in default searches at confidence ≥ 0.8 with a visible badge (recommended),
   or declared facts only by default.
4. Enrichment model and budget: Haiku 5.5 via the Anthropic API from Clipper (recommended, roughly
   $100 to $200 for the full catalog on the first pass at the measured per-study cost), or Workers AI.
5. The public / Cloud split in section 3 point 6.

## 10. Session brief for the orchestrator

Start in `singlet-website` on a new branch per task. Read this file, `CLAUDE.md`, `docs/QC.md`,
`docs/DATA-AUDIT.md`, `functions/_shared/{interpret,search-core,nl-search-core,conditions,vocab}.ts`,
`functions/_shared/{bundle-reader,bundle-core,modalities,layers-core}.ts`, and the `.1pz` and `.singlet`
format docs in `Singlet-Bio/singlet/docs/`. Then:

1. Confirm the five decisions above with the user; record them at the top of this file.
2. Run Phase 0 as four parallel tasks (T1 to T4), merge T1 first and apply the migration to production.
3. Run T5, T6 and T7 on Clipper against 100 studies, report the validation numbers, then the full catalog.
4. Phase 2 in the order T9, T10, T12, T11. Phase 3 when the engine's held-out sidecars exist.
5. After every merge: `scripts/smoke.sh https://singlet.bio`, and re-run the golden sets; append the numbers
   to `scripts/search-eval/README.md`.

Haiku sub-agents take: reading and summarising files, writing gold labels for review, running batch
extraction scripts, writing tests from a stated spec, and UI pieces with a pinned design. Sonnet keeps:
schema, the grammar, the resolver, the prompts, anything touching `search-core.ts`, and all merges.
