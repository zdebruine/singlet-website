---
id: harmonization.gene_identifier_mapping
title: Gene identifier and symbol mapping
area: harmonization
scope: core
paradigm: heuristic
literature_status: routine
priority: P1
depends_on: [harmonization.count_matrix_state_detection, ingest-quant.reference_annotation_build]
feeds: [enrichment.over_representation_analysis, cross-species.ortholog_assignment, markers-de.cluster_marker_ranking]
reads: [var_names, var/gene_id, var/gene_name, layers/counts]
writes: [var/symbol_harmonized, var/ensembl_gene_id, var/ensembl_version, var/mapping_status, var/mapping_candidates, uns/gene_mapping_log, uns/gene_mapping_release, layers/counts_collapsed]
devices: [cpu]
mcp_tool: singlet_harmonization_gene_identifier_mapping
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Gene identifier and symbol mapping

> Resolves each feature name of a count matrix to one current gene in a pinned reference release, reports ambiguous, renamed and unmapped features with explicit statuses, and collapses duplicates only with a logged conservation check.

## 1. Question

Do a matrix's feature names (approved symbols, previous symbols, aliases, and Ensembl IDs with or without version suffixes) each resolve to exactly one gene in a chosen reference release? The input is a feature table, a species and a pinned release. The output is a stable Ensembl gene ID, an approved symbol and a mapping status per feature, plus a log of merged or dropped features. A correct answer assigns a feature to a gene only when its candidate set in that release has exactly one member; every other case is flagged rather than guessed.

## 2. Why this task matters and where the field stands

Feature names are the join key between a count matrix and external resources such as marker sets, pathway collections, cell-cycle gene lists and ortholog tables. Names change. HGNC maintains approved, previous and alias symbols for human genes [R1], so a name in an older matrix can point to a different current symbol. Names also corrupt in transit. Ziemann et al. found gene-name errors in supplementary Excel gene lists, where spreadsheet conversion turns symbols into dates or numbers [R2]. An unresolved or mis-resolved feature changes every gene-level result downstream, and the error is invisible unless the mapping reports it.

Status: **routine** for exact lookup of current symbols and IDs against one release. The policy questions are **contested**. The tools examined disagree on alias matches and multiple hits. Seurat's alias lookup accepts only single hits, while scib's Ensembl symbol query takes the first returned record (§4, §12).

Open problems: (1) the cited sources contain no accuracy benchmark for symbol-to-gene resolution, so correct resolution can be tested only with planted corruption (§8); [R2] measures error prevalence in files, not resolution accuracy. (2) "Current" is undefined without a release pin, and remote services answer for whichever release they serve. (3) Alias multiplicity has no principled tie-break. (4) Retirements, merges and splits need stable-ID history that the cited sources do not provide.

## 3. Theory and insight

**Estimand.** For feature $i$ with name $x_i$, the target is the stable gene $g_i^\ast$ from which its row was measured, in the pinned release $r$. The mapper returns an approved symbol, a stable ID $\hat g_i$ and a status $\sigma_r(x_i)$. The status and the candidate sets are exact functions of the release table, not estimates.

**Lookup.** Let $\mathcal{G}_r$ be the genes of release $r$, $s_r(g)$ the approved symbol of gene $g$ and $P_r(g)$ its previous-symbol set. After the species case convention is applied, define

$$C_r(x)=\{\,g\in\mathcal{G}_r : s_r(g)=x\,\},\qquad C^{\mathrm{prev}}_r(x)=\{\,g\in\mathcal{G}_r : x\in P_r(g)\,\},$$

and the status

$$\sigma_r(x)=\begin{cases}\text{unique} & |C_r(x)|=1\\ \text{renamed} & C_r(x)=\emptyset,\ |C^{\mathrm{prev}}_r(x)|=1\\ \text{ambiguous} & |C_r(x)|\ge 2,\ \text{or } C_r(x)=\emptyset \text{ and } |C^{\mathrm{prev}}_r(x)|\ge 2\\ \text{unmapped} & \text{otherwise}\end{cases}$$

The regime is one release, exact string equality and no cross-release information. Alias matches lie outside this rule (§5). A release table that lists two IDs under one name gives $|C_r|\ge 2$ by construction. Retirement, merger and split cannot be expressed without stable-ID history.

**Version stripping.** $\phi(\mathrm{ENSG}\,d_1\cdots d_{11}.v)=\mathrm{ENSG}\,d_1\cdots d_{11}$, with digits $d_j\in\{0,\dots,9\}$ and version $v\ge 1$. The map is many-to-one: two versions of one gene in one matrix collide after stripping and must pass through the collapse step. The map applies to human ENSG identifiers with or without a version; other suffixed forms are outside it.

**Collapse.** With a feature-to-gene map $f$ and the set $U$ of features kept unresolved or dropped, integer counts collapse as

$$Y_{g,c}=\sum_{i:\,f(i)=g}X_{i,c}.$$

The estimand is the total integer UMI count of gene $g$ in cell $c$. For normalised or log values the estimand is the member mean instead, because sums of such values have no meaning. The conservation identity is exact for integer counts:

$$\sum_{g}Y_{g,c}+\sum_{i\in U}X_{i,c}=\sum_{i}X_{i,c}\qquad\text{for every cell }c.$$

A non-zero residual means that a feature was lost silently. Dropped features belong to $U$ and must appear in the log.

**Rates.** The resolution rate $\hat\rho_r=\frac1p\sum_{i=1}^{p}\mathbf 1[\sigma_r(x_i)\in\{\text{unique},\text{renamed}\}]$ is a fraction of features, not of UMIs, for one matrix and release. The silent-error rate $\mathrm{WU}$ (wrong_unique_rate in B1) is the fraction of planted features with status unique or renamed whose $\hat g_i\neq g_i^\ast$; it requires planted truth. Both are reported beside the full status table.

**Noisy-channel proposal (no literature source, not fitted).** Let $N_r(g)$ be the names of gene $g$ in release $r$, $\varepsilon$ a corruption rate, $q$ a background name distribution and $\pi$ a prior over genes:

$$p(x\mid g,r)=(1-\varepsilon)\,\mathbf 1[x\in N_r(g)]+\varepsilon\,q(x),\qquad p(g\mid x,r)\propto\pi(g\mid r)\,p(x\mid g,r).$$

Its estimand is the probability that $g$ is the planted gene given an observed name. It would rank candidates for ambiguous and unmapped names. No cited source fits or validates it.

**Assumptions.** The release tables are complete and correct for the species and release, and the release is pinned. Feature strings were not altered by spreadsheet or text tools, which fails for the conversions described in [R2]. Stable identity across releases is available only through Ensembl's history, which the cited sources do not contain. Summation is valid only for additive counts.

**Failure modes.** Alias multiplicity: one alias maps to several genes, and the tools differ in how they choose (§4). Previous-symbol drift: a name retired in one release may point to another gene in a later release, so name-only lookups from old matrices can resolve wrongly; this follows from the rule and is not measured here. Silent loss: intersection-style filtering drops unmatched features with at most a warning. Version duplicates: stripping creates duplicates that must be collapsed. Suffix conventions: name-ID and name-N forms both occur, so mapping back from display names needs the scheme. Quantifier suffixes: splice-status features carry suffixes such as "-A" (example in §12) and must be parsed before lookup. One reviewed client queries its endpoint over plain HTTP, so responses are not authenticated in transit.

**Why rules first.** Lookup against one closed release table is exact and needs no fitted parameters. A model adds value only for ambiguous names, where calibration needs labelled corruption (B1). Most error comes from policy: whether aliases count, whether multiple hits are skipped, taken first or reported, and whether unresolved features are dropped or flagged. A release pin and explicit statuses make these choices visible and testable.

**Ground-truth estimands.** In B1 the truth $g^\ast$ is the gene from which a planted name was generated, keyed by stable ID; ambiguity and unmapped labels are counted from the table. In B3 the truth is each collapsed row's planted member set, evaluated per cell.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| HGNC symbol lookup over approved, alias and previous symbols, one request per symbol and field | heuristic | accept a current symbol only when the lookup returns one record; warn and skip when it returns several | [R1]; §12 Seurat |
| Ensembl REST symbol-to-ID cross-reference | heuristic | take the first returned record | §12 scib |
| Ensembl BioMart attribute query | heuristic | query attributes at a chosen host, which selects the release | §12 scanpy |
| Duplicate-name index suffixing | heuristic | keep the first occurrence; append join and a counter to later duplicates | §12 anndata |
| Duplicate-name ID suffixing | heuristic | when row names are symbols, append the ID to every copy of a duplicated name | §12 DropletUtils, scuttle |
| Feature-set sum collapse | heuristic | sum (or average) counts over members | §12 scuttle |

No mapping method has a published accuracy benchmark in the cited sources, so none is a validated standard. The HGNC lookup and the scib first-hit query are kept as comparators. The release-table lookup of §5 is singlet's own design. Defaults of the implementations and comparators used in §8:

| Method | Parameter | Value | Source |
|---|---|---|---|
| Seurat GeneSymbolThesarus | search types | `c('alias_symbol','prev_symbol')` | R/utilities.R:979 @ 5f67c70 |
| Seurat GeneSymbolThesarus | endpoint | `http://rest.genenames.org/fetch` | R/utilities.R:983 @ 5f67c70 |
| Seurat GeneSymbolThesarus | timeout; several.ok | 10 s; FALSE | R/utilities.R:977-978 @ 5f67c70 |
| Seurat GeneSymbolThesarus | accept rule | one record accepted; several trigger a warning and are skipped | R/utilities.R:1005-1008 @ 5f67c70 |
| Seurat UpdateSymbolList | timeout; several.ok | 10 s; FALSE | R/utilities.R:1876-1877 @ 5f67c70 |
| Seurat UpdateSymbolList | search types | `'prev_symbol'` | R/utilities.R:1885 @ 5f67c70 |
| Seurat feature filtering | missing features | returned by intersection with the row names, with a warning only | R/utilities.R:380 @ 5f67c70 |
| scib get_gene_id_from_ensembl | base URL | `https://rest.ensembl.org`, no release parameter | scib/resources/convert_genes.py:27 and 32 @ cd67913 |
| scib get_gene_id_from_ensembl | symbol resolution | first returned record, `data[0]` | scib/resources/convert_genes.py:40 @ cd67913 |
| scib get_gene_id_from_ensembl | empty result | the string `Not Found` | scib/resources/convert_genes.py:43 @ cd67913 |
| scib get_gene_id_from_ensembl | non-200 response | input name kept as the ID | scib/resources/convert_genes.py:44-46 @ cd67913 |
| scanpy biomart_annotations | host | `www.ensembl.org` | src/scanpy/queries/_queries.py:88 @ 8ed52d9 |
| anndata make_index_unique | join | `"-"` | src/anndata/utils.py:291 @ e90df01 |
| anndata make_index_unique | first occurrence | kept unchanged | src/anndata/utils.py:321 @ e90df01 |
| anndata make_index_unique | collisions | counter increments until the name is unused; warning issued | src/anndata/utils.py:328-339 @ e90df01 |
| DropletUtils read10xCounts | row.names | default `"id"` (match.arg over `c("id","symbol")`) | R/read10xCounts.R:139, 153 @ ba4152d |
| DropletUtils read10xCounts | duplicate rule | `paste0(symbol, "_", ID)` for every copy, only when row.names is `"symbol"` | R/read10xCounts.R:181-183 @ ba4152d |
| scuttle uniquifyFeatureNames | missing names | replaced by the ID | R/uniquifyFeatureNames.R:31-32 @ d3476eb |
| scuttle uniquifyFeatureNames | duplicate rule | `paste0(name, "_", ID)` for every copy | R/uniquifyFeatureNames.R:33-34 @ d3476eb |
| scuttle sumCountsAcrossFeatures | average | FALSE (sum) | R/sumCountsAcrossFeatures.R:72 @ d3476eb |

## 5. Proposed singlet approach

**Routes.** The release-table lookup (default) is reimplemented: no code is copied, and the comparators are callouts. The anndata naming convention is ported (§12). The ID-suffix convention and the sum collapse are reimplemented from their documented behaviour (§12).

**Method and defaults.** `release_table` resolves each feature through $C_r$ and $C^{\mathrm{prev}}_r$ of §3 against the pinned tables. Defaults applied when a caller omits them: `strip_version` true; `alias_policy` approved_and_prev; `ambiguity_policy` report; `unmapped_policy` keep_and_flag; `duplicate_policy` sum for counts. Two decisions are singlet's own. An alias-only match under `alias_policy: all` is written with status renamed and logged as an alias match; it is never unique. The statuses retired, merged and split are reserved: the release table holds no stable-ID history, so this method never emits them. The first version supports human only, since mouse needs its own release tables (§10).

**Model-based extension (proposed).** The core stays deterministic. For ambiguous and unmapped names, the noisy-channel posterior of §3 would rank candidates with calibrated probabilities. It would be rejected if, on the B1 ambiguous names, its top-ranked gene is not more often the planted gene than the prior-only ranking, or if its expected calibration error is not lower than the prior's.

**ML stack.** None for the core. If the extension is built, a small logistic ranker in PyTorch on CPU is enough. CUDA kernels are not justified: the work is hash lookups and one pass over nonzeros.

**Kernels.** Build hash maps from approved, previous and alias names to gene indices for the species, once per release. Features are mapped in O(p). Collapse applies the feature-to-gene index over the nonzeros, in O(nnz), and computes the conservation residual per cell. The original matrix is left unchanged.

**Devices and memory.** CPU only. The collapse processes blocks of cells, so peak memory is bounded by the block and the index rather than by the whole matrix.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | var_names | str | feature names: the index, or a var column chosen by `feature_key` |
| read | var/gene_id | str | optional Ensembl IDs, possibly versioned |
| read | var/gene_name | str | optional symbols, for example from a 10x features table |
| read | layers/counts | int or float | counts collapsed when duplicate_policy merges features |
| write | var/symbol_harmonized | str | approved symbol of the resolved gene; empty when unresolved |
| write | var/ensembl_gene_id | str | unversioned stable ID of the resolved gene |
| write | var/ensembl_version | int, nullable | version suffix removed by strip_version |
| write | var/mapping_status | categorical | unique, renamed, ambiguous or unmapped; retired, merged and split are reserved (§5) |
| write | var/mapping_candidates | str | pipe-separated stable IDs for ambiguous features |
| write | uns/gene_mapping_log | table | source name, action, target and reason; one row per collapsed, dropped or alias-matched feature |
| write | uns/gene_mapping_release | str | HGNC snapshot date and Ensembl release |
| write | layers/counts_collapsed | int or float | collapsed matrix; a new feature-axis object when the number of rows changes |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `species` | string | required | `human` | Organism whose release tables are used. Only human is implemented in this version. |
| `release_pin` | string | required | — | Reference release as HGNC snapshot date plus Ensembl release, for example hgnc-<date>+ensembl-<release>. Required; no default. |
| `feature_key` | string | "var_names" | `var_names`, `gene_id`, `gene_name` | Column holding the input names: the feature index, or the var column gene_id or gene_name. |
| `method` | string | "release_table" | `release_table`, `name_suffix_only` | release_table resolves names against the pinned tables and is the default; name_suffix_only only makes display names unique. |
| `layer` | string | "counts" | — | Count layer collapsed when duplicate_policy merges features; not read otherwise. |
| `device` | string | "cpu" | `cpu` | Only cpu is implemented; lookups are hash operations and gain nothing from CUDA. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing members. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `release_table` | object | — | — | Options for method release_table. |
| `release_table.strip_version` | boolean | true | — | Remove Ensembl version suffixes before lookup; the version is kept in var/ensembl_version. |
| `release_table.alias_policy` | string | "approved_and_prev" | `approved_and_prev`, `all` | all also resolves alias symbols; alias-only matches get status renamed and a log row, never unique. |
| `release_table.ambiguity_policy` | string | "report" | `report`, `drop`, `pick_first` | report keeps ambiguous features with candidates; drop removes and logs them; pick_first takes the first candidate and logs it. |
| `release_table.unmapped_policy` | string | "keep_and_flag" | `keep_and_flag`, `drop_and_log` | keep_and_flag keeps unmapped features; drop_and_log removes them with a log row. Silent drops are not allowed. |
| `release_table.duplicate_policy` | string | "sum" | `sum`, `mean`, `keep_first`, `suffix_id` | sum for integer counts; mean for normalised or log values; keep_first; suffix_id keeps rows labelled name_ID. |
| `name_suffix_only` | object | — | — | Options for method name_suffix_only. |
| `name_suffix_only.join` | string | "-" | — | Delimiter placed before the counter when a duplicated display name is made unique. |
<!-- PARAMS:AUTO:END -->

Rules spanning parameters: `species` and `release_pin` are required and define every table; `feature_key` chooses the input names; `strip_version` applies only to Ensembl-style input and precedes the collapse; `mean` replaces `sum` for normalised or log values; `name_suffix_only` ignores the release_table options and writes no status; `pick_first` logs every choice and is never the default.

## 7. MCP tool

Tool `singlet_harmonization_gene_identifier_mapping` (definition in `tasks/mcp/singlet_harmonization_gene_identifier_mapping.json`). Example call and compact result; the release value is a format placeholder.

```json
{"dataset": "/data/pbmc.singlet", "species": "human", "release_pin": "hgnc-<date>+ensembl-<release>", "method": "release_table"}
```

```json
{"dataset": "/data/pbmc.singlet", "status": "completed", "wrote": ["var/symbol_harmonized", "var/ensembl_gene_id", "var/mapping_status", "uns/gene_mapping_log"], "summary": {"status_counts": {"unique": "<n>", "renamed": "<n>", "ambiguous": "<n>", "unmapped": "<n>"}, "resolution_rate": "<fraction>", "collapsed_features": "<n>", "conservation_error": 0}, "provenance_id": "<id>"}
```

The task is not long-running: lookup and collapse complete inline in one pass over the feature table and the nonzeros. It is not stochastic. A dry run returns estimated index and collapse memory from p and nnz, with device cpu, and writes nothing.

## 8. Benchmarks

Shared protocol: each benchmark uses one species and one pinned release, recorded in `uns/gene_mapping_release`. The stable Ensembl ID is the truth key; approved symbols are never the key. Metrics are reported for every status, not only for accuracy, with bootstrap intervals over features (1,000 resamples). Planted sets are repeated over five seeds. Remote comparators are cached with request, response and date, and their HTTP request counts are reported. Fractions over features count features, not UMIs.

### B1. Planted-corruption recovery (proposed)

- **Goal**: whether each planted name variant resolves to its planted gene, and whether ambiguous and unmapped names are flagged instead of resolved.
- **Ground truth**: planted simulation. Each feature is generated from one gene of the pinned table and carries that gene's stable ID $g^\ast$. Ambiguity and unmapped labels are counted from the pinned table's candidate sets, not from the mapper. The estimand for a variant type is the proportion of its planted features whose output stable ID equals $g^\ast$, normalised by the planted features of that type.
- **Generator recipe (proposed)**:
  1. Load the pinned release table and an earlier HGNC snapshot that the mapper never reads.
  2. Draw n genes per variant type without replacement; n is set at implementation.
  3. Plant names. Approved: the current symbol. Previous: an approved symbol of the earlier snapshot that is no longer approved in the pinned release. Alias: an alias with one candidate. Versioned: the Ensembl ID with a random version from 1 to 20. Case: the human symbol in the wrong case. Shared: a previous or alias name with two or more candidates, whose truth is undefined and which enters only the ambiguity recall.
  4. Duplicate a fixed fraction of rows, keeping the name and truth.
  5. Record the variant type, truth and table candidate counts per row. The two renamed-symbol pairs from the vignette output (§12) are added as spot checks.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pinned HGNC and Ensembl release tables | HGNC REST (R1); Ensembl REST and BioMart (§12) | gene reference tables, human; size — | §12 | generator input and mapper reference |
| Earlier HGNC snapshot | HGNC release files at an earlier date; source chosen at implementation | human; size — | §12 | source of previous-symbol names only |
| Renamed-symbol seeds | vignette output table in saeyslab/multinichenetr, vignettes/multifactorial_analysis_BreastCancer.knit.md, lines 464 and 572 (§12) | human; two pairs | §12 | MARCH1 to MARCHF1 and SEPT1 to SEPTIN1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| recovery_rate | planted features with truth whose output ID equals $g^\ast$ and whose status is unique or renamed, over planted features with truth | higher | primary | proposed |
| wrong_unique_rate | planted features with truth whose status is unique or renamed and whose output ID differs from $g^\ast$, over planted features with truth | lower | guardrail | proposed |
| ambiguity_recall | among planted names the §3 rule labels ambiguous when counted from the table, the fraction with status ambiguous | higher | primary | proposed |
| unmapped_recall | among planted names the table labels unmapped under the default alias policy, the fraction with status unmapped | higher | primary | proposed |
| version_strip_accuracy | among versioned planted IDs, the fraction whose unversioned output equals the planted gene | higher | primary | proposed |

- **Comparators**: Seurat UpdateSymbolList, scored on the symbol it returns, mapped to a stable ID through the pinned table (§12); scib get_gene_id_from_ensembl, scored on its returned ID (§12). anndata make_index_unique and the ID-suffix tools return names but no stable IDs, so they are scored on name uniqueness only.
- **Protocol**: each mapper is applied with default settings and with the policy under test (ambiguity_policy and alias_policy), over five seeds. Metrics are reported per variant type with intervals.
- **Acceptance criterion** (proposed design targets, not literature thresholds): wrong_unique_rate equal to 0 over all planted names; recovery_rate at least 0.99 for approved names; ambiguity_recall and unmapped_recall equal to 1.0; version_strip_accuracy equal to 1.0.
- **Known pitfalls**: if the generator and the mapper read the same snapshot, previous-symbol recovery is tautological, so the earlier snapshot must stay out of the mapper. Remote comparators change with the server's current release; cache them and record the date.

### B2. Release-drift consistency (proposed)

- **Goal**: whether an old approved symbol resolves in a newer release to the same stable gene, and whether renamed genes are reported as renamed rather than attached to another gene.
- **Ground truth**: consistency. For a gene present in both releases, the stable ID recorded in the older table is the truth for its old symbol. The estimand is per gene, reported per status and per symbol-change type.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Two HGNC snapshots and two Ensembl gene tables, one species | HGNC REST (R1); Ensembl REST and BioMart (§12) | gene reference tables, human; size — | §12 | two dates chosen so that approved symbols change; the number of changes is counted, not assumed |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| identity_preservation | genes in both releases whose old symbol, resolved in the new release, gives the same stable ID with status unique or renamed, over genes in both releases | higher | primary | proposed |
| false_merge_rate | old names resolved (unique or renamed) in the new release whose stable ID differs from the ID recorded in the old release, over old names resolved | lower | guardrail | proposed |
| rename_recall | genes whose approved symbol changed, whose old symbol resolves to the same ID with status renamed, over genes whose approved symbol changed | higher | primary | proposed |

- **Comparators**: Seurat UpdateSymbolList, current release only; scanpy biomart_annotations with an archive host where one is available (§12).
- **Protocol**: for each gene in both releases, query the old symbol in the newer release and compare stable IDs. The comparison is exhaustive, so no seeds apply. Cache responses; report counts per status and per symbol-change type.
- **Acceptance criterion** (proposed): false_merge_rate equal to 0 for stable IDs; identity_preservation and rename_recall reported with bootstrap intervals. No literature threshold applies.
- **Known pitfalls**: symbol reuse across releases can attach an old name to a different gene, so the check must key on stable IDs. Without stable-ID history, treating the ID column as the same gene is an assumption (§10).

### B3. Collapse conservation and logging (proposed)

- **Goal**: whether collapsing duplicate and versioned features conserves totals exactly and logs every merged, dropped or alias-matched feature.
- **Ground truth**: consistency. Each collapsed row's member set is recorded at generation. The conservation identity of §3 must hold per cell for integer counts, and the mean rule must hold for normalised input. The estimand is the exact per-cell residual and the per-row agreement.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Synthetic integer count matrices with planted duplicates and versioned features | generated for this benchmark | feature and cell counts set at implementation; size — | — | a second arm uses normalised values to test the mean rule |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| conservation_error | sum over cells of the absolute value of $\sum_g Y_{g,c}+\sum_{i\in U}X_{i,c}-\sum_i X_{i,c}$; zero for integer counts | lower | guardrail | proposed |
| log_completeness | features merged, dropped or alias-matched that appear in uns/gene_mapping_log, over all such features | higher | primary | proposed |
| collapse_correctness | collapsed rows whose values equal the sum (integer input) or mean (normalised input) of their planted members in every cell, over collapsed rows | higher | primary | proposed |

- **Comparators**: scuttle sumCountsAcrossFeatures, deprecated in favour of aggregateAcrossFeatures (R/sumCountsAcrossFeatures.R:74), sum and average (§12); anndata make_index_unique, which keeps rows and so makes conservation trivial, and is scored on naming only.
- **Protocol**: generate integer counts, plant duplicates and version variants, apply the collapse, then check the identity and the log. Repeat over five seeds, and repeat with normalised input and duplicate_policy mean.
- **Acceptance criterion** (proposed): conservation_error equal to 0; log_completeness and collapse_correctness equal to 1.0.
- **Known pitfalls**: summing normalised or log values gives meaningless totals, so the mean arm is required. Comparing row counts alone does not test conservation.

### P1. Performance and scaling

Wall time and peak memory for building the index for one species and release, and for mapping p features and collapsing a matrix with nnz nonzeros. p is the feature count of the release table (counted at implementation) and the feature count of one matrix. Collapse is timed at 10k, 100k and 1M cells. The benchmark is CPU only, since CUDA is not implemented. Comparators: anndata make_index_unique and scuttle uniquifyFeatureNames (in memory); Seurat UpdateSymbolList and scib get_gene_id_from_ensembl (network, reporting HTTP request counts and cache state). Hold fixed: local tables cached, same host, identical feature order, median over repeated timings.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.count_matrix_state_detection`: Count-matrix processing-state detection
  - `ingest-quant.reference_annotation_build`: Reference genome and annotation preparation for single-cell counting (including custom host-plus-pathogen and transgene references)
- **Feeds**:
  - `enrichment.over_representation_analysis`: Over-representation analysis of marker or DE gene lists
  - `cross-species.ortholog_assignment`: Gene orthology assignment across species
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
- **Reads**: `var_names`, `var/gene_id`, `var/gene_name`, `layers/counts`
- **Writes**: `var/symbol_harmonized`, `var/ensembl_gene_id`, `var/ensembl_version`, `var/mapping_status`, `var/mapping_candidates`, `uns/gene_mapping_log`, `uns/gene_mapping_release`, `layers/counts_collapsed`
<!-- CHAINING:AUTO:END -->

Used in ingest workflows before any step that matches gene names to external resources.

## 10. Risks, pitfalls and open questions

- **Cited sources**: R2 is cited from memory, without a DOI; its record and the spreadsheet-conversion finding are not checked against the article.
- **Stable-ID history and exclusions**: retired, merged and split statuses need Ensembl stable-ID history, which the cited sources do not contain; they are reserved and untested. The spreadsheet date-conversion variant is left out of B1 because the conversion rules are not specified in the cited sources. Mouse is out of the first version because no mouse release-table source is cited.
- **Data terms**: the terms of the HGNC and Ensembl release tables were not read, so release tables are not redistributed with the catalogue until they are.
- **Live services**: Ensembl REST and BioMart answers are read from code and were not checked against the live services; their release depends on the host called.
- **First experiment**: apply B1 to one species with the pinned tables and the default policy. If wrong_unique_rate is above zero, keep alias_policy at approved_and_prev and report the failing variant type before changing anything else.

## 11. References

R1. Seal RL, Braschi B, et al. Genenames.org: the HGNC resources in 2023. *Nucleic Acids Research* 2023;51(D1):D1003–D1009. doi:10.1093/nar/gkac888 — verified (search)
R2. Ziemann M, Eren Y, El-Osta A. Gene name errors are widespread in the scientific literature. *Genome Biology* 2016;17:177. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and contributors listed in DESCRIPTION | MIT + file LICENSE (LICENSE: copyright 2021, Seurat authors) | HGNC symbol lookup policy and missing-feature handling; comparator in B1 and P1 | callout |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt) | Ensembl REST symbol-to-ID helper; comparator in B1 and P1 | callout |
| https://github.com/scverse/scanpy | scverse contributors (pyproject.toml lists Adam Gayoso, Alex Wolf and others) | BSD-3-Clause (LICENSE) | BioMart query helper and host choice; comparator in B2 | callout |
| https://github.com/scverse/anndata | Philipp Angerer, Alex Wolf, Isaac Virshup, Sergei Rybakov, Ilan Gold (pyproject.toml) | BSD-3-Clause (LICENSE) | duplicate-name index suffixing convention | port |
| https://github.com/LTLA/scuttle | Aaron Lun (aut, cre), Davis McCarthy (aut) (DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file at the root) | name uniquifying and feature-set sum; comparator in B3 | reimplement |
| https://github.com/MarioniLab/DropletUtils | Aaron Lun (aut); Jonathan Griffiths (ctb, cre); Davis McCarthy, Dongze He, Rob Patro (ctb) (DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file at the root) | symbol-row duplicate suffixing | reimplement |
| https://github.com/theislab/single-cell-best-practices | Theislab (copyright holder per LICENSE) | Apache-2.0 (LICENSE) | example of splice-status suffixed names (simpleaf/alevin output, jupyter-book/introduction/raw_data_processing.md lines 940-956) and of the GRCh38 (GENCODE v32/Ensembl 98) reference (line 814) | callout |
| https://github.com/saeyslab/multinichenetr | Robin Browaeys (DESCRIPTION) | GPL-3 + file LICENSE (LICENSE file: GPL-3 text) | source of two renamed-symbol seed pairs in vignette output | callout |
| https://rest.genenames.org (HGNC web service, endpoint as used in Seurat) | HGNC / genenames.org (R1) | — | release-table source for approved, previous and alias symbols | import (data) |
| https://rest.ensembl.org (Ensembl REST, endpoint as used in scib) | Ensembl | — | release-table source for gene IDs | import (data) |
