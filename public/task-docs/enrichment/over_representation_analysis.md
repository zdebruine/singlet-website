---
id: enrichment.over_representation_analysis
title: Over-representation analysis of marker or DE gene lists
area: enrichment
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [markers-de.cluster_marker_ranking, enrichment.pathway_resource_curation]
feeds: [annotation.cluster_label_assignment, programs.program_annotation, enrichment.enrichment_bias_correction]
reads: [uns/de/<name>, var/detected, var/tested, uns/gene_sets/<collection>]
writes: [uns/ora/<name>, uns/ora/<name>/meta]
devices: [cpu, cuda]
mcp_tool: singlet_enrichment_over_representation_analysis
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Over-representation analysis of marker or DE gene lists

> Tests whether a thresholded list of cluster-marker or differential-expression genes overlaps each predefined gene set more than chance allows, against an explicit background universe, and reports an odds ratio, fold enrichment, p-value and adjusted p-value for every set.

## 1. Question

Which predefined gene sets contain more members of a thresholded foreground list (cluster markers or DE genes) than expected if the list were drawn at random from a stated background universe, and by how much? The input is a foreground list, a universe and a gene-set collection. The output is one row per set with the overlap and its genes, an odds ratio, a fold enrichment, a raw p-value and an adjusted p-value. A correct answer has p-values calibrated under the stated null and is read only relative to that universe.

## 2. Why this task matters and where the field stands

Interpreting a cluster or a DE result against gene sets is a routine step. Over-representation analysis (ORA) is its simplest form: it uses only list membership and ignores gene-level magnitudes and ranks. It is a competitive test in the sense of Goeman and Bühlmann, which compares set members with the rest of the universe [R8]. Preranked enrichment uses a genome-wide statistic and a different null [R9], so it is a separate task. The R package clusterProfiler is widely used for ORA [R10].

Status: **contested**. The test is routine, but the universe, the collection and the list threshold together determine the result, and the literature does not settle them. Published single-cell benchmarks of ORA with a known truth are absent from the references below. The scanpy source leaves an enrichment option out of marker overlap, noting that it would need the size of the reference universe, which is at best approximately known (§12).

Open problems:

1. **Universe.** Marker lists in droplet data come from a detection-dependent subset of the annotation, so the eligible set must be stated explicitly for the p-values to mean anything.
2. **Selection bias.** Long and highly detected genes are over-called in gene-set tests on RNA-seq [R2]. Detection bias is documented for single-cell protocols [R3]; a single-cell correction is not yet established.
3. **Pseudoreplication.** Cell-level DE p-values are inflated, and thresholding them inflates ORA. Squair et al. document false discoveries in single-cell DE [R4].
4. **Overlapping sets.** Heavily overlapping collections make the family of tests dependent, so the standard adjustment is only a heuristic control (§3).

## 3. Theory and insight

Let $U$ be the universe with $N=|U|$, let $F\subseteq U$ be the foreground with $n=|F|$, and let $S$ be a gene set with $K=|S\cap U|$ members in the universe. The observed overlap is $k=|F\cap S|$.

The test asks how often a uniform random subset of $U$ of size $n$, independent of $S$, overlaps $S$ at least as much as $F$ does. Under that null the overlap $X$ is hypergeometric:

$$P(X=x)=\frac{\binom{K}{x}\binom{N-K}{n-x}}{\binom{N}{n}},\qquad \mathbb{E}[X]=\frac{nK}{N},\qquad \mathrm{Var}(X)=n\,\frac{K}{N}\Big(1-\frac{K}{N}\Big)\frac{N-n}{N-1}.$$

The one-sided (right-tail) p-value, the Fisher exact test of [R1], is $p_{\mathrm{R}}=P(X\ge k)$, which equals the one-sided Fisher exact p-value of the table $\begin{pmatrix}k & n-k\\ K-k & N-n-K+k\end{pmatrix}$. It is exact under the stated null and miscalibrated when that null fails.

The two-sided Fisher p-value sums the probabilities of all tables no more probable than the observed one, $p_{\mathrm{2s}}=\sum_{x:\,P(X=x)\le P(X=k)}P(X=x)$. When $k$ is at or above the mode, $p_{\mathrm{2s}}\ge p_{\mathrm{R}}$, because every table with $x\ge k$ is included. The two conventions are not interchangeable, and §4 shows that the tools compared here use both.

Two descriptive effect sizes accompany the p-value. The fold enrichment $\mathrm{FE}=(k/n)/(K/N)$ compares set-member rates in the foreground and the universe; it is a first-order summary when $k$ is not small. The Haldane-corrected odds ratio $\mathrm{OR}_{\mathrm{HA}}=\frac{(k+c)(N-n-K+k+c)}{(n-k+c)(K-k+c)}$, with $c=0.5$, matters only when a cell is small.

The EASE-style p-value of §4 is $p_{\mathrm{E}}=P(X'\ge k-1)$ with $X'\sim\mathrm{Hypergeom}(N,K,n-1)$. Removing one uniformly chosen foreground member gives a uniform subset of size $n-1$ whose overlap satisfies $X'\ge X-1$, so $\{X\ge k\}\subseteq\{X'\ge k-1\}$ and $p_{\mathrm{E}}\ge p_{\mathrm{R}}$ for every $k$.

For $m$ sets with ordered raw p-values $p_{(1)}\le\dots\le p_{(m)}$, the Benjamini–Hochberg adjustment is $\tilde p_{(i)}=\min_{j\ge i}\min\{1,\tfrac{m}{j}p_{(j)}\}$. It controls the false discovery rate under independence or positive dependence [R13]. Gene sets overlap, so the family is generally dependent; the Benjamini–Yekutieli adjustment controls the rate under arbitrary dependence at the cost of a factor $\sum_{j=1}^{m}1/j$ [R14].

Estimands. Each raw $p$ answers one question for one set: the null probability of an overlap at least $k$. The adjusted value answers it for the family of sets in one collection and one list. FE and $\mathrm{OR}_{\mathrm{HA}}$ are ratios of within-universe rates, normalised by $N$ and $n$, and do not depend on the number of cells. The benchmark quantities in §8 are defined per list or per cluster, never per cell.

Failure modes. The null fails in six ways. Selection: DE and marker tests favour long and highly detected genes, so sets of those genes are over-called [R2][R3]. Universe: the same list gives different p-values under different $N$, which is the main calibration risk (§8, B1). Pseudoreplication: lists from cell-level tests carry inflated significance [R4]. Dependence: nested sets report one signal many times, and BH does not correct for this. Threshold: changing the cut-off changes $n$ and $k$ together, so calls can flip. Small sets: overlaps are small integers and p-values take few values, so single genes dominate.

Why model-based. The list-construction step (threshold, universe, collection) is heuristic, while the test itself is an explicit null, so this document classes the method as hybrid. A model-based extension is proposed only where the null is known to fail: a learned, covariate-aware selection model replaces the uniform null with per-gene selection probabilities and can be checked on held-out datasets (§5, B3). Under the uniform null the threshold-and-BH pipeline is the published standard and stays as a comparator.

Complexity. Overlap counts cost $O(\sum_S |S| + n)$ per list with hashed membership, and each exact tail sum has at most $\min(n,K)+1$ terms.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Hypergeometric ORA on the top ranked features (decoupler-py `mt.ora`) | hybrid | Per-observation 2×2 table with a fixed background size, Haldane log odds ratio, two-sided Fisher p-value | [R5] |
| Hypergeometric ORA on `rank_genes_groups` markers (pertpy `Enrichment.hypergeometric`) | hybrid | Markers with adjusted p below a threshold, one-sided hypergeometric over all genes in the object, Benjamini–Hochberg | [R6] |
| Fisher ORA with EASE-style table reduction (Mixscale `fisher_enrich_test`) | hybrid | One-sided Fisher test on the tested genes, with the overlap and list margin reduced by one (EASE table) unless the overlap is below 1 or the EASE flag is TRUE | §12 |

The hypergeometric test on a thresholded list is the published standard, and the three tools above implement it. They share the arithmetic but not the tail convention: decoupler-py reports the two-sided p, while pertpy and Mixscale report the one-sided p. Mixscale's EASE flag acts inversely to its documentation at the commit in §12, as the table below shows. These three are the methods whose source is described here; the other enrichment tools named in §2 and §10 are not in the table.

Defaults, exact and taken from source at the commits in §12:

| Method | Parameter | Value | Source |
|---|---|---|---|
| decoupler-py `mt.ora` | n_up | None, resolved to max(ceil(0.05 × features), 2) | src/decoupler/mt/_ora.py:253-254 @ 3132edc |
| decoupler-py `mt.ora` | n_bm | 0 | src/decoupler/mt/_ora.py:182 @ 3132edc |
| decoupler-py `mt.ora` | n_bg | 20000; None selects a feature-specific background | _ora.py:183; :257-258 |
| decoupler-py `mt.ora` | background when n_bg = 0 | all ranked features outside the set and the foreground | _ora.py:164-168 |
| decoupler-py `mt.ora` | ha_corr | 0.5, added to all four cells | _ora.py:184; :129-132 |
| decoupler-py `mt.ora` | p-value | two-sided Fisher: tables no more probable than the observed one (`_mlnTest2t`, reached from `_runora` through `_test1t`) | _ora.py:32-105; :109-116; :171 |
| decoupler-py `mt.ora` | foreground | features ranked above nvar − n_up, or at or below n_bm | _ora.py:283-284 |
| decoupler-py `mt.ora` | input check | n_up + n_bm ≤ n_bg unless n_bg = 0 | _ora.py:266-269 |
| pertpy `Enrichment.hypergeometric` | padj_threshold | 0.05 | src/pertpy/tools/_enrichment.py:402 @ c246f24 |
| pertpy | direction | both | _enrichment.py:404 |
| pertpy | corr_method | benjamini-hochberg | _enrichment.py:405 |
| pertpy | universe | set(adata.var_names) | _enrichment.py:434 |
| pertpy | marker set | pvals_adj below padj_threshold, then score sign for up or down; no fold-change cut | _enrichment.py:455-460 |
| pertpy | p-value | one-sided: hypergeom.sf(k − 1, N, markers, group size) | _enrichment.py:472 |
| pertpy | adjustment | fdr_bh; Bonferroni as min(1, m·p) | _enrichment.py:477-478 |
| Mixscale `fisher_enrich_test` | background | rownames(DE_res), the genes tested in the DE table | R/enrichment_test.R:75 @ 3d3a2cd |
| Mixscale | universe size | PT = length(background) | R/enrichment_test.R:392 |
| Mixscale | EASE table | overlap LH − 1, list margin LT − 1 | R/enrichment_test.R:410 |
| Mixscale | EASE flag | the condition LH < 1 or EASE equal to TRUE selects the uncorrected table, so EASE = TRUE gives the uncorrected table, the inverse of the documented meaning | R/enrichment_test.R:412 (docs :380) |
| Mixscale | list-gene branch | corrected table unless LH < 1; EASE is not consulted | R/enrichment_test.R:441-445 |
| Mixscale | test | fisher.test(alternative = "greater"), one-sided | R/enrichment_test.R:416 |

## 5. Proposed singlet approach

**Routes.** Each source is ported, reimplemented or cited as a callout, as recorded in §12.

**Default.** `method = hypergeometric`, the one-sided test, is the default because it answers the over-representation question directly and matches pertpy's convention. `fisher_two_sided` (decoupler's convention) and `fisher_ease` are exposed so that results can be compared with the source tools. `fisher_ease` applies the corrected table, following the documented intent rather than the inverted flag.

**Universe.** `universe.mode = detected` with `min_cells = 10` (proposed) is the default: the foreground is drawn from genes the data can detect, so the detected set is the natural null. B1 tests this choice against the alternatives before the default is fixed.

**Foreground and sets.** Thresholds follow pertpy's convention, with no fold-change cut by default. Sets are intersected with the universe before the size and overlap filters in §6 apply, and BH is applied across the sets of one list and collection.

**Model-based extension (proposed, not in the enum).** A per-gene probability of list membership is learned from the membership indicators of cluster-marker and DE lists across the catalogue, with covariates such as detection rate, mean expression and gene length where the reference provides it. A logistic GLM is fitted with leave-dataset-out evaluation. Its probabilities define a covariate-stratified null, in which random lists match the covariate composition of the foreground. The extension enters the enum only if B3 is calibrated and B2 top-1 recall does not fall more than 0.05 below the default. It is falsified if B3 fails at any decile.

**ML stack.** The GLM has tens of covariates and one row per gene per list, so it is fitted on CPU with a standard GLM solver, or in PyTorch if a shared training loop is wanted. Scoring is a hard-coded kernel: overlap counts are a sparse set-by-gene matrix times a gene-by-list indicator matrix (cuSPARSE SpMM on CUDA), and tail sums are evaluated in log space from a log-factorial table. No deep-learning framework is needed at inference.

**Devices and streaming.** The computation is gene-level, so cell counts do not enter it and streaming is not needed. CUDA helps only when many lists and sets are tested together; `device = auto` selects CUDA when the set-by-list overlap product fits in device memory. The CPU path is the reference.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/de/<name> | table | gene, group, logfc, pval, padj: the source of the foreground |
| read | var/detected | bool | genes detected in at least `min_cells` cells (detected universe) |
| read | var/tested | bool | genes with a tested result in the DE table (tested universe) |
| read | uns/gene_sets/<collection> | mapping | set name to member genes |
| write | uns/ora/<name> | table | one row per set and group: overlap, set size, foreground size, universe size, odds ratio, fold enrichment, p-value, adjusted p-value, overlap genes |
| write | uns/ora/<name>/meta | mapping | parameters, universe definition and counts |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `de_table` | string | required | — | Name of the marker or DE table under uns/de/ with gene, group, logfc, pval and padj columns. |
| `collection` | string | required | — | Gene-set collection under uns/gene_sets/. Required; there is no default collection. |
| `method` | string | "hypergeometric" | `hypergeometric`, `fisher_two_sided`, `fisher_ease` | One-sided hypergeometric (default), two-sided Fisher, or EASE-reduced Fisher. |
| `universe` | object | {"mode": "detected", "min_cells": 10, "var_key": null} | — | Background universe that defines the population size N. |
| `universe.mode` | string | "detected" | `detected`, `tested`, `annotated`, `var_column` | Detected: genes passing min_cells; tested: DE table genes; annotated: all genes; var_column: boolean var column. |
| `universe.min_cells` | integer | 10 | min 1 | Minimum cells expressing a gene for the detected universe (proposed default). |
| `universe.var_key` | string/null | null | — | Boolean var column used only when mode is var_column. |
| `foreground` | object | {"padj_threshold": 0.05, "min_logfc": null, "direction": "both", "top_n": null} | — | Thresholds that define the foreground gene list from the DE table. |
| `foreground.padj_threshold` | number | 0.05 | min 0; max 1 | Adjusted p-value cut-off for foreground genes. |
| `foreground.min_logfc` | number/null | null | min 0 | Absolute log fold-change cut-off; null applies no fold-change filter. |
| `foreground.direction` | string | "both" | `up`, `down`, `both` | Sign of the score that defines the foreground. |
| `foreground.top_n` | integer/null | null | min 1 | Use the top N genes by score instead of thresholds when set. |
| `sets` | object | {"min_size": 10, "max_size": 500, "min_overlap": 3} | — | Size filters applied after intersection with the universe. |
| `sets.min_size` | integer | 10 | min 1 | Minimum set size after intersection with the universe (proposed default). |
| `sets.max_size` | integer | 500 | min 1 | Maximum set size after intersection with the universe (proposed default). |
| `sets.min_overlap` | integer | 3 | min 1 | Minimum number of foreground genes in a set before it is reported (proposed default). |
| `correction` | string | "bh" | `bh`, `bonferroni` | Multiplicity adjustment across the sets of one list and collection. |
| `ha_corr` | number | 0.5 | min 0 | Haldane-Anscombe correction added to each cell for the reported odds ratio only. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing the tests. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`de_table` and `foreground` define the list. `universe` defines $N$; foreground genes outside it are dropped and counted in the metadata. `sets` and `correction` define the family of tests. `method` selects the tail: `hypergeometric` is one-sided, while `fisher_two_sided` and `fisher_ease` follow the source tools in §4. `ha_corr` changes only the reported odds ratio, never a p-value. When `top_n` is set, `padj_threshold` and `min_logfc` are ignored. The `var_column` mode needs a boolean `var` column named by `var_key`.

## 7. MCP tool

Tool name `singlet_enrichment_over_representation_analysis` (definition in `tasks/mcp/singlet_enrichment_over_representation_analysis.json`). Example call and compact result:

```json
{"dataset": "example.singlet", "de_table": "markers_leiden", "collection": "<collection>", "method": "hypergeometric", "universe": {"mode": "detected", "min_cells": 10}, "foreground": {"padj_threshold": 0.05, "direction": "up"}}
```

```json
{"dataset": "example.singlet", "status": "completed", "wrote": ["uns/ora/markers_leiden_<collection>", "uns/ora/markers_leiden_<collection>/meta"], "summary": {"n_foreground": "<int>", "universe_size": "<int>", "n_sets_tested": "<int>", "n_sets_significant": "<int>", "method": "hypergeometric", "correction": "bh"}, "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: no, the test completes inline. Stochastic: no, the output is a deterministic function of the inputs. Dry run: returns estimated seconds, peak memory and device from the list and set sizes, without computing the tests.

## 8. Benchmarks

**Shared protocol.** All benchmarks fix the universe rule, the gene-set collection and its size filter (10 to 500 members after intersection with the universe), the correction (BH across the sets of one list) and every threshold before any result is seen. Each comparator receives identical lists. Random lists use seeds 0 to 99 (proposed). Accuracy is reported per dataset and as the median across datasets. Wall time and peak memory are measured on one host with the thread count recorded. Only settings listed in a benchmark differ from this protocol. None of the references provides a single-cell ORA truth set, so B1 to B3 are proposed here, and each input is produced by the recipe given.

### B1. Null calibration of the universe choice (proposed)

- **Goal**: Measure whether each candidate universe gives calibrated list-level error when the foreground is random among the genes the data can detect.
- **Ground truth**: Planted null. For each size $n\in\{50,200,1000\}$, draw at least 1000 foreground lists uniformly without replacement from the detected universe $U_{\det}$. Set membership is independent of the foreground by construction, so every significant set is a false positive. Estimand: list-level family-wise error (FWER), the fraction of lists with at least one set whose BH-adjusted p is below $\alpha$; normalised per list.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Detected universe $U_{\det}$ | one catalogue dataset with author labels, named in the benchmark record before use; genes detected in at least 10 cells (proposed) | scRNA-seq; species and size as recorded | internal catalogue | sets the eligible genes |
| Gene-set collection | frozen before the benchmark, from the curation task enrichment.pathway_resource_curation | — | — | defines the sets |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| List-level FWER | fraction of lists with at least one set BH-adjusted p below $\alpha\in\{0.05,0.01\}$ | at or below $\alpha$ | primary | [R13] |
| Per-set rejection rate | fraction of (list, set) pairs with raw p below $\alpha$ | at or below $\alpha$ | guardrail | — |
| KS distance | Kolmogorov–Smirnov distance of raw p-values from uniform, pooled over sets | lower | guardrail | — |

- **Comparators**: (C1) one-sided hypergeometric, universe detected (the proposed default); (C2) one-sided, universe all genes in the annotation; (C3) one-sided, $N$ fixed at 20,000 as in decoupler-py's default constant; (C4) two-sided Fisher, universe detected (decoupler-py's convention). The all-genes rule of pertpy equals C2 when the object carries the full annotation.
- **Protocol**: For each list size, apply C1 to C4 to the same lists, with the same collection and size filter. Compute FWER at 0.05 and 0.01, per-set rejection rates and the KS distance, and report each universe separately for each list size.
- **Acceptance criterion**: Proposed, not from the literature: C1 list-level FWER at $\alpha=0.05$ of at most 0.06 (1.2 times nominal). Comparators above 0.06 are reported as miscalibrated for the detected universe.
- **Known pitfalls**: Uniform random lists omit selection bias, so meeting this criterion says nothing about real marker lists (B3 addresses covariates). Overlapping sets make per-set p-values dependent, which is why the list-level FWER is the primary measure.

### B2. Recovery of expert cluster labels (proposed)

- **Goal**: Test whether ORA on cluster markers recovers the curated marker set for each cluster's expert label.
- **Ground truth**: Expert labels. A cluster's label is the author cell-type label covering at least 80% of its cells (proposed); clusters below that share are excluded. The expected set is the curated set for the label, mapped through a name table fixed before the benchmark. The curated collection merges CellMarker [R11] and PanglaoDB [R12] and excludes any set derived from the dataset under test. Estimand: for each cluster, the rank of the expected set among all tested sets ordered by BH-adjusted p, with ties broken by smaller raw p and then larger odds ratio; top-k recall is the fraction of clusters whose expected set has rank at most $k$. Normalised per cluster, not per cell.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| D1, D2 | two catalogue datasets from different tissues with author cell-type labels (about 40% of the 354M catalogued cells carry author annotations), named before use | scRNA-seq; species and size as recorded | internal catalogue | any set derived from the same dataset is excluded |
| Curated collection | CellMarker [R11]; PanglaoDB [R12] | — | — | frozen union for the benchmark |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Top-1 recall | fraction of clusters with the expected set at rank 1 | higher | primary | — |
| Top-5 recall | fraction of clusters with the expected set at rank 5 or better | higher | primary | — |

- **Comparators**: (C1) one-sided hypergeometric, detected universe (the proposed default); (C2) one-sided, all genes in the annotation; (C3) Fisher test with EASE-style reduction, with the corrected table always applied.
- **Protocol**: Cluster markers come from markers-de.cluster_marker_ranking, with method and thresholds fixed before the benchmark (padj 0.05, direction up). Apply C1 to C3 to every labelled cluster and report recall per dataset, together with the number of clusters above the label threshold.
- **Acceptance criterion**: Proposed: C1 top-1 recall of at least 0.7 and top-5 recall of at least 0.9 on clusters above the label threshold.
- **Known pitfalls**: Circularity: curated sets derived from the same dataset or clustering inflate recall, so the exclusion rule above is required. Nested cell-type sets overlap, so ranks depend on how the collection is pruned; the collection is frozen for that reason.

### B3. Covariate-selected lists (proposed)

- **Goal**: Measure the false-positive rate of ORA when the foreground is selected only by a gene covariate, gene length or detection rate.
- **Ground truth**: Planted null with covariate-preserving randomisation. Genes in the universe are binned into deciles of the covariate. For each set, its members are re-drawn within the same bins, keeping set size and bin counts, so that membership is independent of the gene given the covariate. The foreground is the set of genes above one cut-off per decile. Under this null every significant call is a false positive. Estimand: list-level false-positive rate, the fraction of covariate-selected lists with at least one set BH-adjusted p below 0.05; normalised per list and reported per decile.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| D3 | one catalogue dataset with detection rates, plus gene length from the reference annotation used to count it | scRNA-seq; species and size as recorded | internal catalogue | gene length is not stored for every reference |
| Collection | frozen gene-set collection, as in B1 | — | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| List-level false-positive rate | as defined in the ground truth, at BH 0.05, overall and per decile | lower | primary | [R2] |
| Maximum decile rate | largest per-decile false-positive rate | lower | guardrail | — |

- **Comparators**: (C1) one-sided hypergeometric, detected universe (the proposed default); (C2) covariate-stratified null (§5), in which random lists match the bin counts of each selected list. C2 is not in the enum until it meets the acceptance criterion.
- **Protocol**: The cut-offs are the ten decile boundaries of the covariate, fixed before the benchmark; each defines one selected list per covariate. For each collection, draw 20 stratified permutations of set membership (proposed). Apply C1 and C2 to every selected list against every permuted collection, and compute the rates per decile.
- **Acceptance criterion**: Proposed: C2 false-positive rate of at most 0.05 in every decile. The C1 rate is reported as the baseline.
- **Known pitfalls**: Gene length correlates with annotation density. The permutation keeps each set's covariate composition, so calls produced by composition alone are counted as false positives, while within-bin biology is destroyed. Cut-offs must be fixed before any result is seen.

### P1. Performance and scaling

Wall time, peak memory and throughput (list-set tests per second) for C1 of B1 on CPU and CUDA, against decoupler-py `mt.ora`, pertpy `Enrichment.hypergeometric` and a direct log-space reference implementation (not yet written). The scales are proposed: 1, 20 and 200 lists; foreground sizes 50, 500 and 5000; collections of 100, 1000, 10000 and 100000 sets; a universe of 20,000 genes. Cell count does not enter once the gene list exists, so cell-count scales belong to the upstream marker step. Hold fixed the universe, membership matrix, size filter and BH, with one CPU thread for the reference. Report the maximum absolute difference of log10 p against the reference implementation. Timings are not reported here.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `enrichment.pathway_resource_curation`: Curated pathway gene-set and signed footprint resource construction
- **Feeds**:
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `programs.program_annotation`: Biological annotation of gene programs
  - `enrichment.enrichment_bias_correction`: Background universe and selection-bias correction for enrichment
- **Reads**: `uns/de/<name>`, `var/detected`, `var/tested`, `uns/gene_sets/<collection>`
- **Writes**: `uns/ora/<name>`, `uns/ora/<name>/meta`
<!-- CHAINING:AUTO:END -->

No named workflow (recipe) is indexed for this task yet. The links above define its place: marker ranking and gene-set curation feed it, and label assignment, program annotation and bias correction consume it.

## 10. Risks, pitfalls and open questions

- **Tools not covered.** The enrichers of clusterProfiler, Enrichr (through GSEApy), goseq, topGO, g:Profiler and DAVID are absent from §4, the enum and the comparators, so their defaults and null models are not described here. Remote services (Enrichr, g:Profiler, DAVID) change their libraries between releases, so any comparator built on them needs a versioned snapshot.
- **Tail convention and the EASE flag.** decoupler-py reports the two-sided p, which for over-represented overlaps is never below the one-sided p (§3), and Mixscale's EASE flag is inverted at 3d3a2cd (§4). The enum value `fisher_ease` follows the documented intent. Results from different tools are comparable only with the same tail and table, and the flag should be reported to its maintainers.
- **Gold standard is bulk.** The gold standard of [R7] is built on bulk expression compendia. Its relevance-ranking metric estimator, compared methods and per-dataset accessions are not described here, so it is not used as a benchmark. Bulk relevance rankings may not transfer to single-cell marker lists.
- **Universe and labels.** No published single-cell ORA benchmark with a known truth is among the references. The scanpy comment in §12 states the universe problem, and B1 tests the universe on planted nulls without showing which universe is correct for real marker lists. B2 scores the merged CellMarker and PanglaoDB collection only, so their disagreement is not separated.
- **First experiment.** Apply B1 to one catalogue dataset with the four universes and both tail conventions, then B3 on a covariate with a known source. The B1 result fixes the default universe and the `min_cells` value, which remain proposals until then.

## 11. References

R1. Fisher RA. On the interpretation of χ² from contingency tables, and the calculation of P. *Journal of the Royal Statistical Society* 1922. doi:10.2307/2340521 — verified (corpus)
R2. Young MD, Wakefield MJ, Smyth GK, Oshlack A. Gene ontology analysis for RNA-seq: accounting for selection bias. *Genome Biology* 2010;11(2):R14. doi:10.1186/gb-2010-11-2-r14 — verified (search)
R3. Phipson B, Zappia L, Oshlack A. Gene length and detection bias in single cell RNA sequencing protocols. *F1000Research* 2017. doi:10.12688/f1000research.11290.1 — verified (corpus)
R4. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R5. Badia-i-Mompel P, Velez Santiago J, Braunger J, et al. decoupleR: Ensemble of computational methods to infer biological activities from omics data. *Bioinformatics Advances* 2022. doi:10.1093/bioadv/vbac016 — verified (repo)
R6. Heumos L, Ji Y, May L, et al. Pertpy: an end-to-end framework for perturbation analysis. *Nature Methods* 2025. doi:10.1038/s41592-025-02909-7 — verified (corpus)
R7. Geistlinger L, Csaba G, Santarelli M, et al. Toward a gold standard for benchmarking gene set enrichment analysis. *Briefings in Bioinformatics* 2020;22(1):545-556. — verified (corpus)
R8. Goeman JJ, Bühlmann P. Analyzing gene expression data in terms of gene sets: methodological issues. *Bioinformatics* 2007;23(8):980-987. — verified (corpus)
R9. Subramanian A, Tamayo P, Mootha VK, et al. Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. *Proceedings of the National Academy of Sciences* 2005. doi:10.1073/pnas.0506580102 — verified (corpus)
R10. Yu G, Wang LG, Han Y, He QY. clusterProfiler: an R package for comparing biological themes among gene clusters. *OMICS* 2012;16(5):284-287. doi:10.1089/omi.2011.0118 — verified (repo)
R11. Zhang X, Lan Y, Xu J, et al. CellMarker: a manually curated resource of cell markers in human and mouse. *Nucleic Acids Research* 2019. — verified (corpus)
R12. Franzén O, Gan LM, Björkegren JLM. PanglaoDB: a web server for exploration of mouse and human single-cell RNA sequencing data. *Database* 2019. doi:10.1093/database/baz046 — verified (corpus)
R13. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)
R14. Benjamini Y, Yekutieli D. The control of the false discovery rate in multiple testing under dependency. *Annals of Statistics* 2001;29(4):1165-1188. doi:10.1214/aos/1013699998 — verified (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/saezlab/decoupler-py @ 3132edc | Pau Badia i Mompel (pyproject.toml) | BSD-3-Clause (LICENSE; copyright 2025 scverse and Pau Badia i Mompel, Saez lab) | `mt.ora`: two-sided Fisher p-value, Haldane odds ratio, default constants | port |
| https://github.com/scverse/pertpy @ c246f24 | Lukas Heumos, Lilly May, Stefan Peidli, Johannes Ostner and others (pyproject.toml) | MIT (LICENSE file, copyright 2021 Lukas Heumos and 2025 scverse); CITATION.cff and the pyproject classifier state Apache-2.0 | `Enrichment.hypergeometric`: one-sided test with BH | port |
| https://github.com/satijalab/Mixscale @ 3d3a2cd | — | none (no LICENSE file; DESCRIPTION has no License field) | `fisher_enrich_test`: EASE-style table | reimplement (formula only) |
| https://github.com/YuLab-SMU/clusterProfiler @ c7404be | Guangchuang Yu (maintainer, DESCRIPTION) | Artistic-2.0 (DESCRIPTION; no LICENSE file at root) | landscape mention only; enricher source not read | callout |
| https://github.com/scverse/scanpy @ 8ed52d9 | scverse (LICENSE copyright holders include F. Alexander Wolf, P. Angerer, Theis Lab) | BSD-3-Clause (LICENSE) | source of the universe caveat, src/scanpy/tools/_marker_gene_overlap.py:275-280 | callout |
