---
id: evaluation.expression_based_cluster_purity
title: Expression-based label-free cluster purity and heterogeneity
area: evaluation
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [clustering.cell_partitioning, feature-selection.highly_variable_gene_selection, normalization.size_factor_estimation]
feeds: [clustering.resolution_selection, clustering.subclustering, clustering.cluster_significance_testing]
reads: [layers/counts, obs/<partition_key>, uns/<gene_subset>]
writes: [obs/purity_<method>_cell, uns/purity_<method>/cluster_table, uns/purity_<method>/granularity_curve]
devices: [cpu, cuda]
mcp_tool: singlet_evaluation_expression_based_cluster_purity
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Expression-based label-free cluster purity and heterogeneity

> Scores each cluster of a candidate partition for expression heterogeneity with ROGUE, SCCAF or phiclust, flags likely mixtures once calibrated, and reports how the scores change with clustering granularity.

## 1. Question

Given a normalised count matrix and one or more candidate cluster partitions, which clusters mix several expression states, and how homogeneous is each cluster? The output is a per-cluster score (ROGUE lies in $(0,1]$, higher is purer), a mixed-cluster flag once calibrated, and a partition-level summary across resolutions. A correct answer flags clusters that combine two populations in mixtures of known composition and leaves single-population clusters unflagged.

## 2. Why this task matters and where the field stands

Benchmarks grade clusters against reference labels, but an analysis usually has none. A cluster that merges two populations is then reported as one type, and its markers, differential expression and annotation inherit the mixture. The status is **contested**. Three families answer the question differently: expression-entropy deviation from a mean-dependent curve [R1], classifier recovery of the partition [R2], and structured variance above a random-matrix noise bulk [R3]. The challenges of unsupervised clustering of single-cell data are reviewed in [R4]. Two problems remain open. Purity and granularity are confounded, because finer partitions are purer almost by construction. A continuous gradient can also look like a mixture to the entropy and variance lenses.

## 3. Theory and insight

Each score is a statistic on a fixed partition. None is a likelihood over expression-state mixtures, so purity is inferred from dispersion, separability or structured variance.

**ROGUE.** For gene $g$ in a cluster of $n$ cells with normalised expression $x_{gc}$, let $H_g=\frac{1}{n}\sum_c\log(x_{gc}+1)$ and $m_g=\log(\bar x_g+r)$ [R1]. A loess curve $\hat f$ fitted across genes gives the expected entropy at each mean, and $d_g=\hat f(m_g)-H_g$ is the entropy reduction. Genes that pass both the raw and the FDR-adjusted upper-tail $z$-test on $d_g$ form $S$, and

$$\mathrm{ROGUE}=1-\frac{\sum_{g\in S}|d_g|}{\sum_{g\in S}|d_g|+K}.$$

The null is the cluster's own fit, so the score is relative and not comparable across gene sets. Because $\log(x+1)$ is concave, $\mathbb E\log(x+1)\le\log(\mathbb E x+1)$ for any non-negative $x$. Dispersion at a fixed mean therefore lowers $H_g$ and raises $d_g$. This is a derivation from Jensen's inequality, not a result from the source paper. Technical dispersion from depth variation or dropout has the same sign, which is the main failure mode.

**SCCAF.** A stratified split trains a classifier to predict cluster labels $y$ from expression. Held-out accuracy $A=\frac{1}{|T|}\sum_{i\in T}\mathbf 1[\hat y_i=y_i]$ measures how separable the partition is [R2]. The per-cluster reliability in the code is $R_k=\#\{i\in T:y_i=k,\hat y_i=k\}\,/\,\#\{i\in T:\hat y_i=k\}$, which is precision rather than recall. A cluster split into two separable pure subtypes can raise accuracy, so accuracy does not measure internal purity.

**phiclust.** Standardised log-normalised expression within a cluster is compared with the Marchenko–Pastur bulk of pure noise [R5],

$$\lambda_\pm=\sigma^2\left(1\pm\sqrt{\gamma}\right)^2,\qquad \gamma=p/n,$$

and the score is the maximum, over singular vectors that rise above the bulk, of a per-vector angle measure. The asymptotic bulk assumes $n,p\to\infty$ at fixed $p/n$ with i.i.d. noise. phiclust fits the bulk empirically and clips scaled values. Covariates are removed only when supplied, so library size or mitochondrial axes can drive the score.

**Silhouette.** For an embedding, $s(i)=\frac{b(i)-a(i)}{\max\{a(i),b(i)\}}$, where $a$ is the mean distance within the cell's cluster and $b$ the smallest mean distance to another cluster [R6]. It is the geometry baseline and inherits the embedding's batch artefacts.

**Estimands.** The ROGUE output is $\mathrm{ROGUE}_{c,s}\in(0,1]$ for cluster $c$ and sample $s$, undefined below a minimum cell count, and a cluster value needs a stated summary across samples. The SCCAF output is $R_k\in[0,1]$ on the held-out half. The phiclust output is a per-cluster value with BH-adjusted Marchenko–Pastur p-values across clusters. For mixtures the truth is $f_c$, the share of cells in cluster $c$ from the minor line. For simulations it is the share from group B. For partitions the summary is $\sum_c (n_c/N)\,\mathrm{score}_c$, compared with the adjusted Rand index to author labels [R10].

**Insight.** Each lens asks a different question: whether a cluster's genes are more dispersed than its mean-entropy relation predicts (ROGUE), whether a classifier recovers the partition (SCCAF), and whether a cluster holds structure beyond noise (phiclust). A pure but continuous cluster can look heterogeneous to ROGUE and phiclust. Splitting a mixture into separable subtypes can look fine to SCCAF; this is a reasoned consequence, not a measured result.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| ROGUE | hybrid | Loess of expression entropy against mean expression; genes significantly below the curve give a score $1-\Sigma/(\Sigma+K)$ | [R1] |
| SCCAF self-projection | model-based | Cross-validated L1 logistic classifier recovers cluster labels; held-out precision per cluster | [R2] |
| phiclust | model-based | Marchenko–Pastur bulk fitted per cluster; significant singular vectors give clusterability | [R3] |

ROGUE is the default: it has an explicit expected-entropy null, returns one value per cluster and sample, and needs no classifier fit. SCCAF and phiclust are model-based comparators. SCCAF measures how separable a cluster is, not its internal homogeneity, so it is reported beside ROGUE rather than as a substitute.

Defaults and code-level definitions for the methods singlet will implement (file:line at the commit shown):

| Method | Parameter | Value | Source |
|---|---|---|---|
| ROGUE | Entropy pseudo-count $r$ | 1 | R/ROGUE.R:11 @ 6e1c8f9 |
| ROGUE | loess span $\alpha$ | 0.5 | R/ROGUE.R:38, 90 @ 6e1c8f9 |
| ROGUE | Multiple-testing method | fdr (BH) | R/ROGUE.R:38, 66 @ 6e1c8f9 |
| ROGUE | Genes used to refit the curve | $p>0.1$, two refits | R/ROGUE.R:46, 55 @ 6e1c8f9 |
| ROGUE | Significance cut (adjusted and raw) | 0.05 | R/ROGUE.R:245, 266 @ 6e1c8f9 |
| ROGUE | $K$ (UMI / full-length) | 45 / 500 | R/ROGUE.R:250–252 @ 6e1c8f9 |
| ROGUE | Cells removed per significant gene ($n$) | 2, highest values | R/ROGUE.R:287, 296–297 @ 6e1c8f9 |
| ROGUE | Minimum cells per cluster and sample | 10 | R/ROGUE.R:331, 340 @ 6e1c8f9 |
| SCCAF | Classifier | LR | SCCAF/__init__.py:266 @ 4c43fd6 |
| SCCAF | Penalty; solver | l1; liblinear, one-vs-rest | SCCAF/__init__.py:267, 271, 329 @ 4c43fd6 |
| SCCAF | Sparsity $C$ | 0.5 | SCCAF/__init__.py:268, 329 @ 4c43fd6 |
| SCCAF | Test fraction (stratified split) | 0.5 | SCCAF/__init__.py:269, 325–326 @ 4c43fd6 |
| SCCAF | random_state | 1 for the classifier; the split passes none | SCCAF/__init__.py:270, 325–326 @ 4c43fd6 |
| SCCAF | Cross-validation folds | 5 | SCCAF/__init__.py:273, 348 @ 4c43fd6 |
| SCCAF | Per-cluster reliability (code) | diagonal over predicted-column totals | SCCAF/__init__.py:435 @ 4c43fd6 |
| SCCAF | Optimiser: c_iter, n_iter, sparsity, n | 3, 10, 0.5, 100 | SCCAF/__init__.py:685–690 @ 4c43fd6 |
| SCCAF | Optimiser stopping accuracy (min_acc) | 1 | SCCAF/__init__.py:697 @ 4c43fd6 |
| SCCAF | Accuracy target in README (not a code default) | above 90% | README.md:132 @ 4c43fd6 |
| phiclust | Neighbourhood fraction (minimum 10) | 0.01 | R/phiclust.R:53, 125 @ d72a80f |
| phiclust | Marchenko–Pastur p.val | 0.01 | R/phiclust.R:53; R/fit_mp.R:46 @ d72a80f |
| phiclust | Singular values nu | 50 | R/phiclust.R:53; R/fit_mp.R:46 @ d72a80f |
| phiclust | Minimum cells per cluster | 10 | R/phiclust.R:75 @ d72a80f |
| phiclust | Sampled fit below 50 cells | sample = TRUE | R/phiclust.R:117–121 @ d72a80f |
| phiclust | Clipping of scaled values | $\pm\sqrt{n}$ | R/phiclust.R:111–112 @ d72a80f |
| phiclust | Gene filter | at least 2 cells above 1 | R/phiclust.R:81–82 @ d72a80f |
| phiclust | Cross-cluster p adjustment | BH | R/phiclust.R:250 @ d72a80f |

## 5. Proposed singlet approach

**Routes.** SCCAF is ported because its licence is permissive. ROGUE and phiclust are reimplemented because their licences are copyleft or conflicting (section 12). The silhouette baseline and the simulators are benchmark-only callouts.

**Model-based formulation (proposed).** For each cluster and gene in the scoring subset, compare a one-state negative-binomial model with a two-state mixture, fitted with a penalty or by variational Bayes. The output is the posterior probability that one state explains the cluster, with a credible interval, and the expected dominant-state fraction. A logistic calibration layer maps this to $P(\text{mixed})$, trained on planted mixtures built from catalogue cells with single-type author labels and split by study. Label noise is modelled explicitly, since about 40 percent of the 354M catalogue cells carry author annotations. The formulation is falsified if the calibrated posterior does not reach the B1 threshold on two platforms, or if on B2 its correlation with $f$ stays below the B2 threshold.

**ML stack.** PyTorch fits the mixture and variational updates on GPU with autograd. The per-gene sparse sufficient statistics (column sums and log1p reductions over sparse counts) and the logistic calibration layer are small and hot, so they are hard-coded in CUDA or cuSPARSE.

**Enum scope.** The model-based variant is not exposed in the tool until its B1 and B2 results are read, because the MCP enum lists only methods whose papers or code were read.

**Execution.** Counts are normalised to 10,000 per cell and log-transformed. Per-cluster sums need one sweep over the matrix, and ROGUE's outlier removal one further sweep over significant genes. SCCAF's split is seeded in singlet, unlike the reference. Agent defaults: method rogue, platform UMI, span 0.5, $r$ 1, minimum 10 cells, gene subset hvg2000, seed 0.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse int | raw UMI counts, normalised internally |
| read | `obs/<partition_key>` | categorical | one candidate partition per key |
| read | `uns/<gene_subset>` | string list | genes used for scoring |
| write | `obs/purity_<method>_cell` | float32 | SCCAF only: 1 if a held-out cell is predicted correctly, missing otherwise |
| write | `uns/purity_<method>/cluster_table` | table | cluster, sample, n_cells, score, mixed_flag, p_adj where defined |
| write | `uns/purity_<method>/granularity_curve` | table | partition key, cell-weighted mean score, number of clusters |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI, or a workspace handle. |
| `method` | string | "rogue" | `rogue`, `sccaf`, `phiclust` | Score to compute; rogue is the default, sccaf and phiclust are comparators. |
| `partition_keys` | array | — | — | obs columns holding candidate partitions, one per resolution; each is scored per cluster. |
| `gene_subset` | string | "hvg2000" | — | uns key of the scoring gene list; fix it before any thinning or subsampling. |
| `rogue` | object | — | — | Options for method rogue. |
| `rogue.platform` | string | "UMI" | `UMI`, `full-length` | Selects K = 45 for UMI or K = 500 for full-length data. |
| `rogue.span` | number | 0.5 | — | loess smoothing parameter of the expected entropy curve. |
| `rogue.r` | number | 1 | — | Pseudo-count inside log(mean expression + r). |
| `rogue.min_cell_n` | integer | 10 | — | Minimum cells per cluster and sample before a value is reported. |
| `rogue.remove_outlier_n` | integer | 2 | — | Highest values removed per significant gene before refitting. |
| `rogue.sample_key` | string/null | null | — | obs column giving samples; null treats each cluster as one sample. |
| `rogue.flag_below` | number/null | null | — | Scores below this are flagged mixed; null until calibrated on B2. |
| `sccaf` | object | — | — | Options for method sccaf. |
| `sccaf.classifier` | string | "LR" | `LR`, `RF`, `GNB`, `GPC`, `SVM`, `SH`, `PCP`, `DT` | Classifier for the self-projection; LR is the default. |
| `sccaf.sparsity` | number | 0.5 | — | Inverse regularisation strength C of the logistic classifier. |
| `sccaf.fraction` | number | 0.5 | — | Held-out test fraction of the stratified split. |
| `sccaf.cv` | integer | 5 | — | Cross-validation folds on the training split. |
| `sccaf.flag_below` | number/null | null | — | Reliability below this is flagged mixed; null until calibrated on B2. |
| `phiclust` | object | — | — | Options for method phiclust. |
| `phiclust.exp_genes` | number | 0.01 | — | Fraction of genes setting the neighbourhood size, minimum 10. |
| `phiclust.p_val` | number | 0.01 | — | Marchenko-Pastur fit p-value threshold for significant singular vectors. |
| `phiclust.nu` | integer | 50 | — | Number of singular values retained in the Marchenko-Pastur fit. |
| `phiclust.exclude_covariates` | array | [] | — | obs columns regressed out of singular vectors; recommended when technical axes are present. |
| `phiclust.flag_above` | number/null | null | — | Clusterability above this is flagged mixed; null until calibrated on B2. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for the held-out split, classifier and sampled Marchenko-Pastur fits. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Options for methods other than the selected one are ignored. Each partition key is scored independently. Flag thresholds default to null, so no mixed flag is written until B2 calibrates them. Changing the gene subset or normalisation changes every score, so existing outputs are replaced only with overwrite set.

## 7. MCP tool

Tool name `singlet_evaluation_expression_based_cluster_purity` (definition in `tasks/mcp/singlet_evaluation_expression_based_cluster_purity.json`). Example call and compact result:

```json
{"dataset": "example.singlet", "method": "rogue", "partition_keys": ["leiden_0.5", "leiden_1.0"], "rogue": {"platform": "UMI"}}
```

```json
{"dataset": "example.singlet", "status": "completed", "wrote": ["uns/purity_rogue/cluster_table", "uns/purity_rogue/granularity_curve"],
 "summary": {"method": "rogue", "n_clusters": "<int>", "n_flagged": null, "n_genes": "<int>"}, "provenance_id": "<id>"}
```

Long-running: the default method is expected to finish inline at small sizes; P1 measures the larger sizes. Stochastic: the seed affects only the SCCAF split and sampled Marchenko–Pastur fits, so ROGUE is deterministic. Dry run: returns estimated seconds, peak memory and device from cluster sizes and gene count.

## 8. Benchmarks

**Shared protocol.** All accuracy benchmarks use counts normalised to 10,000 per cell and log(x+1), a 2,000-gene subset fixed before any subsampling or thinning, and the candidate partitions as given. Every score is oriented so that higher means more mixed (ROGUE and SCCAF reliability are negated), so Spearman and AUROC share one sign. Seed 0 unless stated. Thresholds labelled proposal are design choices, not literature values. Flag thresholds are set on B2 and fixed for B1.

### B1. Cell-line mixtures: pure versus mixed clusters

- **Goal**: test whether scores flag clusters built from two cell lines and leave single-line clusters unflagged, on real expression whose cell identity is known independently.
- **Ground truth**: orthogonal measurement. Each cell's line comes from demultiplexing (column `cell_line_demuxlet`). Mixed clusters are built by construction from two lines at 1:1 ($f=0.5$) or 3:1 ($f=0.25$), where $f$ is the minor-line share of cells, so the mixed label is artificial.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellBench cell-line mixtures (sc_mixology single cells) | [R7], [R8]; GEO GSE118767 | scRNA-seq; human lung adenocarcinoma lines HCC827, H1975, H2228; 10x Chromium, CEL-seq2, Drop-seq; cells — | section 12 | Equal line proportions; bulk RNA mixtures excluded because they carry no per-cell truth |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC_mixed | AUROC for mixed versus pure clusters on the oriented score; midranks for ties | maximise | primary | — |
| Spearman_f | Spearman ρ between the oriented score and $f$ over mixed clusters | maximise | guardrail | — |
| Pure_false_flag | fraction of pure clusters flagged at the B2 threshold | minimise | guardrail | — |

- **Comparators**: ROGUE (K 45 for UMI, 500 for full-length); SCCAF reliability with default LR; phiclust; silhouette on a 50-PC embedding; a random partition with matched cluster sizes as the chance reference.
- **Protocol**: pure clusters are $n$ cells of one line. Mixed clusters combine two lines at the same $n$, for $n\in\{10,50,200\}$. Draw 50 times per condition and platform. Report AUROC per platform and pooled with platform as a stratum.
- **Acceptance criterion** (proposal): the best method reaches AUROC_mixed at least 0.90 for $f=0.5$ with $n\ge50$ on at least two platforms, is at least 0.05 above silhouette, and has Pure_false_flag at most 0.05.
- **Known pitfalls**: three distinct lines may saturate AUROC, so include a harder or downsampled pair. Platform effects can mimic mixing, so stratify by platform.

### B2. Planted mixtures from a simulator

- **Goal**: measure how faithfully each score tracks a planted minor fraction and how it responds to thinning, where the truth is exact.
- **Ground truth**: planted simulation. Group membership is fixed by the generator, and $f$ is the group-B share of cells in the cluster, defined at the level of membership rather than expression state.
- **Generator recipe** (proposed):
  1. Simulate two groups with differential expression, varying the DE probability and fold change over a grid.
  2. Vary dropout and library size over a grid.
  3. Form clusters from groups A and B at $f\in\{0.05,0.1,0.2,0.3,0.5\}$, with sizes from 10 to 500 cells.
  4. Repeat 50 times per setting with fixed seeds. For depth sensitivity, thin UMIs binomially to 50 percent with the gene list fixed.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Two-group Splatter simulation | [R9]; Oshlack/splatter | simulated scRNA-seq; cell and gene counts set by the configuration | section 12 | Group A is major, group B minor |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC_f0.1 | AUROC for mixed ($f\ge0.1$) versus pure clusters on the oriented score | maximise | primary | — |
| Spearman_f | Spearman ρ between the oriented score and $f$ over mixed clusters | maximise | primary | — |
| Depth_sensitivity | mean absolute change in per-cluster score under 50 percent thinning, clusters with at least 50 cells | minimise | guardrail | — |

- **Comparators**: ROGUE (K 45 and 500); SCCAF reliability; phiclust; silhouette on 50 PCs.
- **Protocol**: all scores on identical clusters. Summarise AUROC and Spearman as functions of $f$ and of the simulation grid.
- **Acceptance criterion** (proposal): Spearman ρ at least 0.8 for $f\ge0.1$ at default settings, and Depth_sensitivity at most 0.05 for clusters with at least 50 cells.
- **Known pitfalls**: independent DE genes may match or mismatch ROGUE's null and so favour some scores. Using one simulator for generation and scoring risks circularity.

### B3. Partition purity versus author-annotated labels

- **Goal**: test whether a label-free partition summary ranks resolutions in the same order as agreement with author annotations, and whether it selects a near-best resolution.
- **Ground truth**: expert labels, noisy and granularity-dependent. The partition summary is the cell-weighted mean of per-cluster purity (higher is purer). Agreement is the adjusted Rand index to the author column [R10].

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue annotated subset | internal catalogue of 354M cells, about 40 percent annotated | scRNA-seq and related modalities; study count fixed at build | — | Excludes studies whose annotations came from the clustering being scored |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Kendall_tau_b | Kendall tau-b between partition purity and ARI across Leiden resolutions 0.2 to 2.0 in steps of 0.2 | maximise | primary | — |
| Argmax_regret | maximum ARI minus ARI at the resolution with the highest partition purity | minimise | primary | — |
| Monotone_fraction | fraction of resolution steps at which purity increases | minimise | guardrail | — |

- **Comparators**: mean silhouette on PCA (cell-weighted); cluster count alone as the granularity-only baseline; ROGUE, SCCAF and phiclust summaries.
- **Protocol**: Leiden over the resolution grid on one embedding per study. Compute purity and ARI per resolution, and report median and interquartile range of tau-b and regret across studies.
- **Acceptance criterion** (proposal): median Kendall tau-b at least 0.5; median Argmax_regret at most 0.05 ARI; the granularity-only baseline reported beside Monotone_fraction.
- **Known pitfalls**: purity rises with granularity almost by construction, so the granularity-only baseline is required. Author labels may sit at a different granularity from the partition, and labels derived from the scored embedding inflate agreement.

### P1. Performance and scaling

- **Measure**: wall time and peak resident memory for each method on CPU and CUDA, at $10^4$, $10^5$ and $10^6$ cells, with 2,000 and 20,000 genes, 10 and 50 clusters, and 1 and 8 threads (proposal scales).
- **Comparators**: ROGUE R reference with the platform K; SCCAF Python reference with identical train and test indices; phiclust R reference with defaults; scikit-learn silhouette, exact and sampled.
- **Hold fixed**: normalisation, gene list, partitions, seeds, hardware and BLAS settings. Expected cost drivers from reading the code are one loess per cluster and sample, the classifier fits and one SVD per cluster (not measured).
- **Acceptance criterion** (proposal): outputs agree with each reference within $10^{-6}$ relative error on identical inputs, and ROGUE and phiclust are at least 5 times faster than the R references at $10^5$ cells (design target).

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Feeds**:
  - `clustering.resolution_selection`: Choosing clustering resolution without reference labels
  - `clustering.subclustering`: Subclustering a cell population
  - `clustering.cluster_significance_testing`: Testing whether clusters or splits are statistically real, and merging over-split clusters
- **Reads**: `layers/counts`, `obs/<partition_key>`, `uns/<gene_subset>`
- **Writes**: `obs/purity_<method>_cell`, `uns/purity_<method>/cluster_table`, `uns/purity_<method>/granularity_curve`
<!-- CHAINING:AUTO:END -->

Applied after clustering and before annotation or differential expression, as a label-free check. The granularity curve informs resolution choice and sub-clustering decisions.

## 10. Risks, pitfalls and open questions

- **Evidence**: the benchmark results in the ROGUE, SCCAF and phiclust papers were not read, so no relative ranking is claimed. The phiclust authors and year come from catalogue metadata and the repository's DOI link. The silhouette and Marchenko–Pastur statements are from memory, and the scikit-learn silhouette and the fit_mp parametrisation were not checked against source. CDI was excluded because its paper and internals were not read.
- **Data and metadata**: CellBench cell counts per line and platform were not read from the data objects, so B1 sizes follow the protocol rather than the data. The annotated study list for B3 is fixed at build time. The ROGUE author list comes from a web record, and the Miao et al. list beyond its first three names is catalogue metadata.
- **Method risks**: SCCAF's split is unseeded in the reference, so parity needs fixed indices, and its optimiser's stopping accuracy defaults to 1 (section 4). ROGUE's p-values are per gene, so cluster flags need a threshold. The ROGUE licence conflict (section 12) blocks code reuse until resolved.
- **First experiment**: fit the flag thresholds on the B2 planted mixtures first, then score the CellBench single-cell clusters (B1) with ROGUE, SCCAF and phiclust on identical 2,000-gene inputs.

## 11. References

R1. Liu B, Li C, Li Z, Wang D, Ren X, Zhang Z. An entropy-based metric for assessing the purity of single cell populations. *Nature Communications* 2020;11:3155. doi:10.1038/s41467-020-16904-3 — verified (corpus)
R2. Miao Z, Moreno P, Huang N, et al. Putative cell type discovery from single-cell gene expression data. *Nature Methods* 2020. doi:10.1038/s41592-020-0825-9 — verified (corpus)
R3. Phiclust: a clusterability measure for single-cell transcriptomics reveals phenotypic subpopulations. *Genome Biology* 2022. doi:10.1186/s13059-021-02590-x — verified (corpus)
R4. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R5. Marchenko VA, Pastur LA. Distribution of eigenvalues for some sets of random matrices. *Mathematics of the USSR-Sbornik* 1967. — unverified (memory)
R6. Rousseeuw PJ. Silhouettes: a graphical aid to the interpretation and validation of cluster analysis. *Journal of Computational and Applied Mathematics* 1987. — unverified (memory)
R7. Tian L, Dong X, Freytag S, Lê Cao KA, Su S, JalalAbadi A, Amann-Zalcenstein D, Weber TS, Seidi A, Jabbari JS, Naik SH, Ritchie ME. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R8. Tian L, Dong X, Freytag S, Lê Cao KA, Su S, Amann-Zalcenstein D, Weber TS, Seidi A, Naik SH, Ritchie ME. scRNA-Seq mixology: towards better benchmarking of single cell RNA-seq protocols and analysis methods. *bioRxiv* 2018. doi:10.1101/433102 — verified (corpus)
R9. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R10. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/PaulingLiu/ROGUE | Pauling Liu (author and maintainer, DESCRIPTION); paper authors as in [R1] | BSD-3-Clause (LICENSE) and GPL (>= 2) (DESCRIPTION): the two conflict | purity statistic and reference implementation | reimplement |
| https://github.com/SCCAF/sccaf | Chichau Miau (setup.py author field); Teichmann Group (LICENSE copyright) | MIT (LICENSE, setup.py) | self-projection classifier and reliability | port |
| https://github.com/semraulab/phiclust | Maria Mircea (author and maintainer, DESCRIPTION) | GPL-3 (LICENSE, DESCRIPTION) | clusterability reference | reimplement |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian (copyright holder, LICENSE) | MIT (LICENSE) | cell-line mixture data for B1 | callout (benchmark data) |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Alicia Oshlack (DESCRIPTION) | GPL-3 with file LICENSE (DESCRIPTION) | simulator for B2 | callout (simulator) |
