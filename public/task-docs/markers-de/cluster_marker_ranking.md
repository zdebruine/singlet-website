---
id: markers-de.cluster_marker_ranking
title: Cluster marker gene ranking
area: markers-de
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [normalization.size_factor_estimation, clustering.cell_partitioning]
feeds: [annotation.cluster_label_assignment, annotation.llm_cluster_annotation, markers-de.compact_marker_panel_selection]
reads: [layers/log1p_norm, obs/<groupby>]
writes: [uns/marker_genes/<groupby>/<contrast>, uns/marker_genes/<groupby>/params]
devices: [cpu, cuda]
mcp_tool: singlet_markers_de_cluster_marker_ranking
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Cluster marker gene ranking

> Rank the genes that separate each cluster or cell type from the other cells, or from one chosen contrast group, and return per-group tables whose ordering, not whose p-values, is the working result.

## 1. Question

Given a log-normalised expression matrix and one categorical label per cell, which genes separate each labelled group from its contrast, ordered by a score that measures that separation? For each group the output is a ranked gene table with the score, a log fold change, the fraction of cells expressing the gene inside and outside the group, and descriptive p-values. A correct answer puts group-specific genes at the top, recovers planted or curated markers, and stays stable when cells are resampled. It asserts no false-discovery rate, because the groups were defined from the same expression data (section 2).

## 2. Why this task matters and where the field stands

Status: **contested**. Marker lists are the main evidence used to name clusters, so the ranking feeds annotation directly. The goal is agreed; the method is not. One point is settled: cell-level p-values for cluster markers are not valid inferences, because the groups come from the same matrix. The scanpy docstring states that comparing cells leads to highly inflated p-values [R4]. Zhang et al. proposed valid post-clustering inference that corrects for this double use of the data [R5].

Open problems:

- **Unit of inference.** No calibrated error rate exists for the markers of a data-defined cluster without a correction such as selective inference [R5] or synthetic nulls (section 10).
- **Choice of score.** Scores that are monotone in one another agree within a contrast (section 3). Scores that weight variance, detection or pairwise contrasts differently do not, and no consensus picks the one that matches biological specificity.
- **Pairwise summaries.** Combining many pairwise contrasts without letting one close cluster dominate is unresolved.
- **Depth and detection.** Genes detected more often in deeper cells rank high under most scores, and no single score removes this confound.
- **Model-based alternatives.** Discriminative models [R6] and detection-aware models offer alternatives whose advantage on marker tasks is open (section 10).

Pullin and McCarthy benchmarked 59 marker-selection methods on 14 real datasets and more than 170 simulated ones, scoring recovery of simulated and expert-annotated markers, the predictive quality of the selected gene sets, memory and speed, and implementation quality [R1]. The best-practices annotation chapter states that simple methods such as the Wilcoxon rank-sum test are thought to perform best, citing the 2022 preprint [R2]. Soneson and Robinson compared single-cell differential expression approaches for bias, robustness and scalability [R7]; that is a cell-level comparison, not a marker benchmark.

## 3. Theory and insight

### 3.1 Notation and estimands

Group $c$ is tested against a contrast $\bar c$, which is all other cells or one named group. Cells are $i\in c$ and $k\in\bar c$, $X_{ig}$ is the log-normalised value of gene $g$ in cell $i$, $y_{ig}$ is its raw count, and $n_c$ and $n_{\bar c}$ are the cell counts. Every output is defined as follows.

| Output | Estimand and normalisation |
|---|---|
| AUROC score | $\Pr(X_{ig}>X_{kg})+\tfrac12\Pr(X_{ig}=X_{kg})$; a probability in $[0,1]$, estimated as $U_{cg}/(n_c n_{\bar c})$ |
| Wilcoxon score | normal-approximate $z$ of the rank-sum $U_{cg}$; unitless |
| Welch t score | difference of group means over the Welch standard error; unitless |
| Cohen's d | difference of means over the average of the two standard deviations, against the contrast; unitless |
| logistic score | coefficient $\hat\beta_g$ of gene $g$ in a joint logistic regression of the group label on all genes; log-odds per unit of $X_{ig}$; depends on expression units |
| logFC | difference of group means of $X_{ig}$ in the input's log units; not standardised |
| pct_in, pct_out | share of cells with $y_{ig}>0$ inside and outside the group |
| pval, padj | nominal test p-value for Wilcoxon and t; Benjamini–Hochberg across genes within the group; descriptive only; absent for the other scores |

Ground-truth quantities (planted set, curated set, Jaccard overlap) are defined with their benchmarks in section 8.

### 3.2 Rank statistics

The Mann–Whitney count satisfies $U_{cg}=n_c n_{\bar c}\,\widehat{\mathrm{AUC}}_{cg}$. Its normal approximation is

$$z_{cg}=\frac{U_{cg}-n_c n_{\bar c}/2}{\sqrt{n_c n_{\bar c}(n_c+n_{\bar c}+1)/12}},$$

valid for moderate sample sizes and few ties. Substituting the AUC identity gives

$$z_{cg}=\Big(\widehat{\mathrm{AUC}}_{cg}-\tfrac12\Big)\sqrt{\frac{12\,n_c n_{\bar c}}{n_c+n_{\bar c}+1}}.$$

Within one group and one contrast, this uncorrected $z$ is an increasing function of AUC, so the two rankings coincide exactly. Across groups the prefactor depends on $n_c$ and $n_{\bar c}$, so the rankings can differ. With tie correction the variance depends on each gene's tie structure and the identity breaks. A strictly increasing transform of the data preserves both ranks and ties, so AUC and the Wilcoxon ranking do not depend on the log transform, whereas t, Cohen's d and logFC do.

### 3.3 Moment and fitted scores

Welch's statistic and the pairwise Cohen's d are

$$t_{cg}=\frac{\bar X_{cg}-\bar X_{\bar c g}}{\sqrt{s^2_{cg}/n_c+s^2_{\bar c g}/n_{\bar c}}},\qquad d_{cg}=\frac{\bar X_{cg}-\bar X_{\bar c g}}{\tfrac12\,(s_{cg}+s_{\bar c g})}.$$

The first is approximately normal for large $n$ on the log scale. For zero-inflated counts the mean follows detection, so $t$ is a ranking device and not a calibrated test. The second is a standardised log fold change against the contrast. scran reports the same quantity for each pair of groups and summarises it; that summary is a comparator only. The logistic score regresses the group label $\zeta_i$ on the log-expression of all genes jointly,

$$\eta_{ic}=\beta_{0c}+\sum_{h}\beta_{ch}X_{ih},$$

with a binary logistic link for two groups and a multi-class link otherwise, a penalty supplied by the wrapped estimator, and uses $\hat\beta_{cg}$ as the score for gene $g$. Because the fit is joint, a gene's coefficient depends on the other genes; its scale follows the expression units; and it gives no p-values.

### 3.4 Assumptions and failure modes

- **Exchangeable cells.** Rank, moment and logistic statistics treat cells as independent draws. Cells from one donor are not independent replicates [R4], and a donor-specific cluster yields donor markers rather than cell-type markers.
- **Groups from the data.** Labels defined by clustering the same matrix make every cell-level p-value optimistic. For the same AUC, $z$ scales with $\sqrt{n_c n_{\bar c}/(n_c+n_{\bar c}+1)}$, so equally specific genes receive different p-values in groups of different size.
- **AUROC ceiling.** Complete separation gives AUC 1 whatever the effect size, so the top of the list ties and needs a tie-break by effect size.
- **Detection dominance.** A gene detected in 95 percent of group cells and 5 percent of the rest has a high AUC even when its positive levels differ little from the contrast.
- **Variance sensitivity.** Cohen's d can rank highly genes with small log fold changes when within-group variance is low, as the scran documentation warns (section 12).
- **Discrete ties.** Without tie correction the Wilcoxon variance is wrong for count data with many ties, and scanpy's default leaves the correction off.
- **Pairwise summaries.** A minimum over contrasts is set by the closest group, and a mean is pulled toward the groups that are easiest to separate.
- **Depth confounding.** Genes whose detection rises with library size rank high under AUC and Cohen's d alike.

### 3.5 Why heuristics work, and what a model adds

Within one contrast the rank statistics and AUC agree, so the substantive choices are the summary over pairwise contrasts, whether variance is penalised, the detection filter and the normalisation. Rank statistics need no count model, are invariant to monotone transforms, and are cheap, which is why they are the usual published choice (section 4). Their weakness is the absence of calibrated uncertainty. A fitted model-based score adds a posterior probability of specificity, intervals and covariate adjustment, at the cost of a fitted prior (section 5). The heuristic standard stays as a comparator in every benchmark.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Wilcoxon rank-sum (`wilcoxon`; scanpy `wilcoxon`, Seurat `wilcox`) | heuristic | rank-sum $z$ of the group against the contrast; no count model | [R2], [R3]; §12 |
| Welch t-test (`t_test`; scanpy `t-test`, `t-test_overestim_var`) | heuristic | Welch statistic on log values; the overestimated-variance variant uses the group size for the rest | §12 |
| AUROC (`auroc`; Seurat `roc`, scran `mean.AUC`) | heuristic | probability that a group cell exceeds a contrast cell, ties counted as one half | §12 |
| Cohen's d (`cohen_d`; scran pairwise) | heuristic | standardised mean difference against the contrast | §12 |
| Logistic regression on all genes (`logreg`; scanpy `logreg`) | model-based | coefficient from a logistic regression of the group label on all genes jointly; no p-values | [R6]; §12 |

The Wilcoxon test is the default of Seurat's `FindAllMarkers` and of the ScanpyV2Preview preset, and the best-practices chapter [R2] names it as the simple method thought to perform best. The ScanpyV1 preset uses the Welch t-test. AUROC and Cohen's d are the score families in scran, and scanpy cites [R6] for its logistic option. Methods whose primary paper and code were not read are excluded and listed in section 10.

| Source | Parameter | Value | Location |
|---|---|---|---|
| scanpy preset | `method`, `mean_in_log_space` | ScanpyV1: `t-test`, True; ScanpyV2Preview: `wilcoxon` (illico implementation), False | `src/scanpy/_settings/presets.py:239-252` @8ed52d9 |
| scanpy | `tie_correct` | False | `src/scanpy/tools/_rank_genes_groups.py:768` @8ed52d9 |
| scanpy | `corr_method` | benjamini-hochberg | `src/scanpy/tools/_rank_genes_groups.py:767` @8ed52d9 |
| scanpy t-test | `equal_var` | False (Welch) | `src/scanpy/tools/_rank_genes_groups.py:501` @8ed52d9 |
| scanpy t-test | rest-group size `n` | `t-test`: size of the rest group; `t-test_overestim_var`: size of the group | `src/scanpy/tools/_rank_genes_groups.py:483`, `486` @8ed52d9 |
| scanpy logreg | estimator and score | `LogisticRegression(**kwds)` fitted on all genes jointly (`X[mask, :]`); score `clf.coef_`, no p-values | `src/scanpy/tools/_rank_genes_groups.py:594`, `600-602`, `606-614` @8ed52d9 |
| Seurat `FindAllMarkers` | `test.use`, `min.pct`, `logfc.threshold`, `return.thresh` | `'wilcox'`, 0.01, 0.1, 1e-2 | `R/differential_expression.R:45-66` @5f67c70 |
| Seurat `FindAllMarkers` | `p_val_adj` | Bonferroni over features | `R/differential_expression.R:764` @5f67c70 |
| Seurat `roc` | ranking | power = abs(AUC − 0.5) × 2, ordered by power; not corrected | `R/differential_expression.R:758-759`, `2533` @5f67c70 |
| scran `scoreMarkers` | `lfc` | 0 | `R/scoreMarkers.R:173` @569d2f8 |
| scran `scoreMarkers` | `logFC.cohen` | standardised log fold change, i.e. Cohen's d | `R/scoreMarkers.R:39` @569d2f8 |

## 5. Proposed singlet approach

**Routes.** Wilcoxon and t-test follow the logic of scanpy and are ported into CPU and CUDA kernels. AUROC is implemented from its definition in section 3.1. Cohen's d is reimplemented from its documented formula. The logistic score uses singlet's own solver with scanpy's output convention (coefficient, no p-value). Seurat, scran and scanpy otherwise serve as comparators only; routes are in section 12.

**Default.** `wilcoxon` with `tie_correct` true, contrast `rest`, layer `log1p_norm`, `n_genes` 100, and `min_pct` 0.01 and `min_logfc` 0.1 as candidate pre-filters. All cells are used with no subsampling, so the ranking is deterministic. This is a design choice that follows the best-practices preference [R2]; it is not a verified result, and B1 and B2 decide whether it stays.

**Model-based formulation (proposed; not in v1 or the tool enum).** A hierarchical shrinkage model per gene. For group $c$ and gene $g$ the mean shift is a spike-and-slab mixture,

$$\theta_{cg}=\delta_{cg}\,\eta_{cg},\qquad \delta_{cg}\sim\mathrm{Bernoulli}(\pi_g),\qquad \eta_{cg}\sim\mathcal N(\mu_0,\tau_0^2),$$

where $(\pi_g,\mu_0,\tau_0)$ are learned on held-out catalogue studies and each gene's count likelihood uses size factors as offset. The output is $\Pr(\delta_{cg}=1\mid D)$ and an interval for $\theta_{cg}$. The formulation is falsified if (a) with labels assigned at random inside one population, the posterior probability averaged over genes exceeds the learned prior mean; (b) its 90 percent intervals cover planted shifts in B1 at a rate outside 0.85 to 0.95 (proposed); or (c) its B1 recall falls below the best comparator by more than the B1 criterion.

**ML stack.** The rank, moment and logistic statistics are small and hot, so they are hard-coded in CUDA: sort-based ranking, per-group reductions and cuSPARSE CSR products. The hierarchical model is fitted in PyTorch with a MAP or variational objective.

**Kernels and streaming.** Zeros in CSR input are handled analytically. The rank sum of zeros needs only the zero count per group, and the moment sums need only non-zero entries plus cell counts, so cost follows the number of non-zeros. Genes are processed in column blocks for the rank and moment statistics, so their memory is linear in the number of cells plus one block. The joint logistic fit does not stream by block: it holds the candidate matrix in memory, and P1 reports it separately. The CPU path uses the same blocks, parallel across blocks.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/log1p_norm | float, sparse CSR | log-normalised expression, cells by genes |
| read | obs/<groupby> | categorical | cluster or cell-type label per cell |
| write | uns/marker_genes/<groupby>/<contrast> | table | gene, rank, score, logfc, pct_in, pct_out, pval, padj |
| write | uns/marker_genes/<groupby>/params | record | method, settings, group sizes and dataset provenance |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `groupby` | string | required | — | Categorical obs column holding the cluster or cell-type label to rank within. |
| `contrast` | string | "rest" | — | 'rest' compares each group with all other cells; a group label gives a one-vs-one comparison. |
| `method` | string | "wilcoxon" | `wilcoxon`, `t_test`, `auroc`, `cohen_d`, `logreg` | Ranking score. wilcoxon is the default; logreg gives a coefficient score without p-values. |
| `layer` | string | "log1p_norm" | — | Log-normalised layer to test; t_test, cohen_d and auroc need log values. |
| `n_genes` | integer | 100 | min 1 | Top genes kept per group, ordered by descending score. |
| `min_pct` | number | 0.01 | min 0; max 1 | Minimum detection fraction on either side, for wilcoxon, t_test and cohen_d candidates. |
| `min_logfc` | number | 0.1 | min 0 | Minimum absolute log fold change for wilcoxon, t_test and cohen_d candidates; pre-filter only. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `wilcoxon` | object | — | — | Options for the wilcoxon method only. |
| `wilcoxon.tie_correct` | boolean | true | — | Use the tie-corrected variance; needed for discrete counts with many ties. |
<!-- PARAMS:AUTO:END -->

`method` selects the score and `contrast` selects the comparison; a group label switches to one-vs-one. `min_pct` and `min_logfc` pre-filter candidates for `wilcoxon`, `t_test` and `cohen_d` only; `auroc` and `logreg` are not pre-filtered. `wilcoxon.tie_correct` affects only the Wilcoxon method. Pre-filters change the candidate set and therefore the top-k, so hold them fixed when comparing methods. A layer without log values, or a `groupby` column that is not categorical, is refused.

## 7. MCP tool

Tool name `singlet_markers_de_cluster_marker_ranking` (definition in `tasks/mcp/singlet_markers_de_cluster_marker_ranking.json`). Call and result, with illustrative values:

```json
{"dataset": "/data/pbmc.singlet", "groupby": "cell_type", "method": "wilcoxon", "n_genes": 50}
```

```json
{"dataset": "/data/pbmc.singlet", "status": "completed",
 "wrote": ["uns/marker_genes/cell_type/rest", "uns/marker_genes/cell_type/params"],
 "summary": {"method": "wilcoxon", "n_groups": 3, "n_genes_tested": 2000,
             "top_markers": {"group_a": ["GENE1", "GENE2", "GENE3"]}},
 "provenance_id": "prov_example"}
```

Long-running: no; the call executes inline and returns `queued` only when the input exceeds the inline limit of the implementation. Stochastic: no; the ranking is deterministic and ties break by gene index. Dry run: returns the estimated time, peak memory and device, computed from cell, group and gene counts; the estimate is checked against measurements in P1.

## 8. Benchmarks

Every method receives the same layer, groups, contrast and gene set after pre-filtering. Scores are sorted in descending order, so the top-k set holds the k genes most increased in the group, with ties broken by lower gene index; recall, precision and Jaccard are computed on these sets. Comparators are pinned: scanpy at commit 8ed52d9 with the preset and `tie_correct` set explicitly, and Seurat at 5f67c70 and scran at 569d2f8 where used. Every result stores versions, seeds, hardware and the Seurat presto status.

### B1. Planted-marker recovery in simulation (proposed)

- **Goal**: test whether each method's top-k recovers the genes planted as increased in each group, in data with donor structure and known labels.
- **Ground truth**: planted simulation. For group $c$, the planted set $P_c$ holds the 20 genes given a positive mean shift in that group, disjoint across groups. Membership is fixed by construction, so the truth carries no sampling noise.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| sim-A, replicates with seeds 0 to 9 | generator recipe below (proposed) | synthetic counts; 10,000 cells; 2,000 genes; 5 groups; 8 donors | — | all inputs and truth sets are emitted |

Recipe (proposed design parameters, not literature values):

1. Draw baseline profiles $\mu_g$ for 2,000 genes with $\log\mu_g\sim\mathcal N(-2,1)$.
2. For each group $c$, set $\mu_{gc}=4\mu_g$ for its 20 planted genes and $\mu_{gc}=\mu_g$ otherwise.
3. Assign each cell uniformly at random to one of 5 groups and one of 8 donors.
4. Draw donor effects $u_{sg}\sim\mathcal N(0,0.3^2)$ and library sizes $\ell_i\sim\mathrm{LogNormal}(\log 2000,\,0.3^2)$.
5. For cell $i$ in group $c$ and donor $s$, let $p_{ig}\propto\mu_{gc}e^{u_{sg}}$ normalised over genes, and draw $y_{ig}\sim\mathrm{NB}(\ell_i p_{ig},\,\phi=0.1)$ with variance $\mu+\phi\mu^2$.
6. Output raw counts, group and donor labels, library sizes and the sets $P_c$. The normalised layer is $\log(1+10^4\,y_{ig}/\sum_h y_{ih})$.

- **Metrics**

| Metric | Definition (ties, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Recall at planted size | $\lvert\mathrm{top}_{20}(c)\cap P_c\rvert/\lvert P_c\rvert$, averaged over groups and replicates; ties broken by gene index | max | primary | [R1] |
| AUROC of the score | AUROC of the score for membership in $P_c$ over all genes, averaged over groups | max | guardrail | — |

- **Comparators**: singlet `wilcoxon`, `t_test`, `auroc`, `cohen_d` and `logreg`; scanpy `wilcoxon` (with and without tie correction), `t-test` and `logreg`.
- **Protocol**: 10 replicates with seeds 0 to 9; all 2,000 genes tested; top-20 sets; CPU.
- **Acceptance criterion** (proposed design criterion, not a literature value): the default method's mean recall is within 0.05 of the best comparator in the same evaluation.
- **Known pitfalls**: a constant mean shift with fixed dispersion favours methods that assume a mean shift, and says nothing about bimodal or zero-inflated genes. Library size is independent of group, so depth confounding is absent (see 3.4).

### B2. Cross-split reproducibility of top-20 markers (proposed)

- **Goal**: measure how stable a group's top-20 set is when its cells are split into halves, and when donors are split, so unstable rankings are flagged.
- **Ground truth**: consistency; no external truth. For top-20 sets $T_A$ and $T_B$ computed on two disjoint halves of a group's cells, the estimand is $J=\lvert T_A\cap T_B\rvert/\lvert T_A\cup T_B\rvert$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| sim-A, replicates with seeds 0 to 9 | generator recipe in B1 (proposed) | synthetic counts; 10,000 cells; 2,000 genes; 5 groups; 8 donors | — | same labels as B1; the real-data arm is in section 10 |

- **Metrics**

| Metric | Definition (ties, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Mean Jaccard over cell halves | median over groups of the mean $J$ over 20 random half-splits, stratified by donor | max | primary | — |
| Jaccard over donor halves | median over groups of $J$ when donors are split four against four | max | guardrail | — |

- **Comparators**: as in B1.
- **Protocol**: groups with at least 200 cells per half; 20 random half-splits per group with seeds 0 to 19; the contrast is split by the same rule; report the median over groups and the interquartile range over splits.
- **Acceptance criterion** (proposed design criterion): median mean-Jaccard at k=20 of at least 0.6 over groups with at least 200 cells per half; smaller groups are reported separately and never pooled.
- **Known pitfalls**: labels are known in simulation, so the bias of estimated clusters is absent; and k=20 is arbitrary, so k=10 and k=50 are reported as well.

### B3. Agreement with curated marker lists (proposed)

- **Goal**: test whether the top-ranked genes of a cluster annotated as type $T$ include the curated markers of $T$, using a resource independent of the expression data.
- **Ground truth**: expert labels. $M_T$ is the marker set for type $T$ in CellMarker [R9]. Each annotated cluster is matched to exactly one type, and the estimand is the fraction of its top 20 genes that lie in $M_T$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellMarker marker table | [R9] | curated marker sets, human and mouse | — | version and table format in section 10 |
| Catalogue datasets with author cluster annotations | singlet catalogue; about 40 percent of its cells carry author annotations | single-cell RNA-seq; species and tissues as catalogued | — | selection rule in section 10 |

- **Metrics**

| Metric | Definition (ties, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Precision at 20 | $\lvert\mathrm{top}_{20}\cap M_T\rvert/20$ per cluster, averaged over clusters; ties broken by gene index | max | primary | — |
| Recall at 20 and 50 | $\lvert\mathrm{top}_k\cap M_T\rvert/\lvert M_T\rvert$ for $k=20$ and $k=50$ | max | guardrail | — |

- **Comparators**: scanpy `wilcoxon`, `t-test` and `logreg`; singlet `wilcoxon`, `t_test`, `auroc`, `cohen_d` and `logreg`.
- **Protocol**: match each cluster to exactly one curated type and drop clusters without a unique match; report the mean and 95 percent bootstrap intervals over clusters (1,000 resamples); stratify by cluster size.
- **Acceptance criterion** (proposed design criterion): precision at 20 of at least 0.3 over clusters with a unique match, reported with intervals.
- **Known pitfalls**: curated lists are incomplete and tissue-specific, so low precision can reflect a gap in the list; expert annotations often rest on the same markers, so agreement is partly circular.

### P1. Performance and scaling

Measure wall time, peak resident memory and throughput (cells times tested genes per second) for one-vs-rest ranking of all groups at $10^4$, $10^5$ and $10^6$ cells, with 10, 50 and 200 groups, on CPU and CUDA. Comparators: scanpy `t-test` (ScanpyV1 preset), scanpy `wilcoxon` (ScanpyV2Preview preset), scanpy `logreg`, Seurat `FindAllMarkers` with `wilcox` (presto recorded as installed or not), and scran `scoreMarkers` effect sizes only. Hold fixed: sparse CSR input, thread count, the gene set (all genes, and the 2,000 most variable by variance of log values), the group count and the seed. Report log-log scaling exponents in cells and in groups separately. The dry-run estimate is checked against these measurements. Scales are proposed design choices; no acceptance threshold is set, and hardware is recorded with each result.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Feeds**:
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `annotation.llm_cluster_annotation`: LLM-based cluster annotation from marker gene lists
  - `markers-de.compact_marker_panel_selection`: Compact marker panel selection
- **Reads**: `layers/log1p_norm`, `obs/<groupby>`
- **Writes**: `uns/marker_genes/<groupby>/<contrast>`, `uns/marker_genes/<groupby>/params`
<!-- CHAINING:AUTO:END -->

This task belongs to the cluster annotation workflow: it follows clustering and normalisation and precedes label assignment.

## 10. Risks, pitfalls and open questions

- **Full-text benchmark not examined.** Pullin and McCarthy [R1] is known here only from summaries of the published record (design in section 2). Its headline ordering and the accessions of its 14 real datasets are not stated. No ordering is quoted, and the B1 criterion must be checked against the full article before release.
- **Methods left out.** MAST [R8] is excluded because its likelihood and defaults have not been checked against its source. The GPU ranking in rapids-singlecell, COSG, COT, Cepo and ClusterDE are excluded for the same reason. The penalty behind the scikit-learn comparator is whatever the installed version uses; singlet's own logistic solver fixes its penalty in v1.
- **Unsettled literature.** The Wilcoxon preference [R2] is stated in the best-practices chapter and rests on the 2022 preprint; the published version [R1] has not been checked for it. Post-clustering calibration by synthetic nulls or selective inference [R5] is not implemented in v1, so no output carries a calibrated error rate.
- **Data plan.** The real-data arms of B2 and B3 need named catalogue datasets with donor and author labels, and the donor-identifier coverage of the catalogue is unchecked. The CellMarker table version and format were not examined, and the corpus record gives no DOI [R9]. The CITE-seq protein check and the held-out study transfer designs are not specified to dataset level, so they are not benchmarks yet.
- **First experiment.** Before any benchmark, check the closed-form identities on random data: within one group and contrast, the uncorrected Wilcoxon $z$ must order genes exactly as AUC does, and the Welch statistic must match an independent computation. Then evaluate B1 at seeds 0 to 9 against scanpy at 8ed52d9.

## 11. References

R1. Pullin JM, McCarthy DJ. A comparison of marker gene selection methods for single-cell RNA sequencing data. *Genome Biology* 2024;25:56. doi:10.1186/s13059-024-03183-0 — partial (search)
R2. Pullin JM, McCarthy DJ. A comparison of marker gene selection methods for single-cell RNA sequencing data. *bioRxiv* 2022 (preprint). doi:10.1101/2022.05.09.490241 — verified (corpus)
R3. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R4. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R5. Zhang JM, Kamath GM, Tse DN. Valid post-clustering differential analysis for single-cell RNA-seq. *Cell Systems* 2019. doi:10.1016/j.cels.2019.07.012 — verified (corpus)
R6. Ntranos V, Yi L, Melsted P, Pachter L. A discriminative learning approach to differential expression analysis for single-cell RNA-seq. *Nature Methods* 2019. doi:10.1038/s41592-018-0303-9 — verified (corpus)
R7. Soneson C, Robinson MD. Bias, robustness and scalability in single-cell differential expression analysis. *Nature Methods* 2018. doi:10.1038/nmeth.4612 — verified (corpus)
R8. Finak G, McDavid A, Yajima M, et al. MAST: a flexible statistical framework for assessing transcriptional changes and characterizing heterogeneity in single-cell RNA sequencing data. *Genome Biology* 2015. doi:10.1186/s13059-015-0844-5 — verified (corpus)
R9. Zhang X, Lan Y, Xu J, et al. CellMarker: a manually curated resource of cell markers in human and mouse. *Nucleic Acids Research* 2019;47(D1):D721–D728. — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/scanpy | scverse; LICENSE copyright F. Alexander Wolf, P. Angerer, Theis Lab (2017) and scverse (2025) | BSD 3-Clause | reference for `wilcoxon`, `t_test`, `logreg` and presets; comparator | port (logic); callout (comparator) |
| https://github.com/satijalab/seurat | Seurat authors | MIT (DESCRIPTION: 'MIT + file LICENSE'; LICENSE.md holds the MIT text, copyright Seurat authors 2021) | `FindAllMarkers` Wilcoxon and roc power; comparator | callout (comparator) |
| https://github.com/MarioniLab/scran | Aaron Lun (maintainer) and co-authors listed in DESCRIPTION `Authors@R` | GPL-3 (DESCRIPTION); no LICENSE file at the repository root | pairwise effect sizes (`cohen_d`) and mean AUC (`auroc`); comparator | reimplement from formula (`cohen_d`); callout (comparator) |
