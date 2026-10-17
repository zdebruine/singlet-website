---
id: clustering.cluster_significance_testing
title: Testing whether clusters or splits are statistically real, and merging over-split clusters
area: clustering
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [clustering.cell_partitioning, feature-selection.highly_variable_gene_selection, statistics.post_clustering_inference]
feeds: [clustering.cluster_stability, markers-de.cluster_marker_ranking, annotation.cluster_label_assignment]
reads: [layers/counts, obs/<partition_key>, uns/<partition_key>/params]
writes: [obs/<partition_key>_validated, uns/<partition_key>_validation/tests, uns/<partition_key>_validation/params, models/<partition_key>_null]
devices: [cpu, cuda]
mcp_tool: singlet_clustering_cluster_significance_testing
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Testing whether clusters or splits are statistically real, and merging over-split clusters

> Tests each split of a candidate partition against a single-population null, keeps the splits that survive, and returns a validated partition with a per-node table of raw and adjusted p-values.

## 1. Question

Is the separation between two clusters, or a candidate split of one cluster, larger than expected if all cells came from one homogeneous population processed by the same procedure? The input is raw counts, a candidate partition with the recipe that produced it, and a significance level $\alpha$. The output is a p-value for each tested node and a validated partition in which unsupported splits are removed or merged. A correct answer keeps the false split rate at $\alpha$ under the single-population null and detects planted two-population splits at the power reported in Section 8.

## 2. Why this task matters and where the field stands

Clusters become cell types, states and annotation targets, so an unsupported split creates a spurious type and an unsupported merge hides a real one. Choosing granularity is an open challenge in unsupervised clustering [R1], and resolution sweeps do not test whether a given split is distinguishable from a single population. Status: **contested**. The field disagrees on three points.

1. **The null.** "One homogeneous population" is ill-defined when states form a continuum, where a significant split can reflect a gradient rather than discrete populations.
2. **The test.** Conditioning on the selection event [R2], splitting counts [R3, R4], re-simulating the pipeline [R5, R6] and permuting classifier labels [R7] are all proposed. Common tooling pairs resolution sweeps with pairwise marker tests [R8, R9], which are not calibrated for clusters defined from the same counts.
3. **The error rate.** CHOIR thresholds each comparison with a Bonferroni adjustment [R7], and sc-SHC sets alpha as a family-wise error rate [R5]. No comparison on common data shows whether family-wise or false discovery control gives the better trade-off between false splits and power.

Significance also measures detectability rather than distinctness: power grows with the number of cells, so at large $n$ almost any real difference is significant. No accepted benchmark for this task is identified, so the benchmarks in Section 8 are proposed designs.

## 3. Theory and insight

For a node with cell set $S$ and children $A$ and $B$, let $X\in\mathbb N^{n\times g}$ be the counts and $s_i$ the size factor of cell $i$. The node null is

$$H_0:\ \text{all cells of } S \text{ are drawn from one distribution } F.$$

Under $H_0$ any split is an artefact of the procedure. Because the statistic is computed after the procedure chose $A$ and $B$, the reference distribution must reproduce that choice; a test on the same counts that defined the split is not valid. A p-value $p$ is valid when $\Pr_{H_0}(p\le\alpha)\le\alpha$ for all $\alpha\in(0,1)$.

**Estimands.** Each node p-value $p_v$ is the probability under the node null that the test statistic is at least as extreme as observed. The validated labelling removes or merges nodes whose adjusted $p_v\ge\alpha$; removed cells return to the parent label. Over $R$ null replicates the false split rate is $\mathrm{FWSR}=\frac1R\sum_{r}\mathbf 1\{\hat K_r\ge2\}$, the fraction of replicates whose final cluster count $\hat K_r$ is at least two. Planted and cell-line labels are one value per cell; ARI is chance-adjusted and invariant to label permutation, and NMI lies in $[0,1]$. Section 8 defines the ground truth for each benchmark.

Three routes give valid p-values after clustering.

**Count splitting.** Each count is thinned binomially,

$$X^{(1)}_{ij}\mid X_{ij}\sim\mathrm{Binomial}(X_{ij},\varepsilon),\qquad X^{(2)}_{ij}=X_{ij}-X^{(1)}_{ij}.$$

If $X_{ij}\sim\mathrm{Poisson}(\lambda_{ij})$, then $X^{(1)}_{ij}\sim\mathrm{Poisson}(\varepsilon\lambda_{ij})$ and $X^{(2)}_{ij}\sim\mathrm{Poisson}((1-\varepsilon)\lambda_{ij})$ are independent, so labels derived from fold 1 leave fold-2 tests valid. This is exact for Poisson counts; for negative-binomial counts with known overdispersion a thinning analogue exists [R4], not re-derived here. Thinning multiplies each cell's mean by the same factor, so the expected fold-2 log fold change between $A$ and $B$ equals the full-data value, while power falls because each fold carries part of the information. Size factors, HVG selection or PCA computed on all counts can use fold-2 counts and reintroduce dependence.

**Selective conditioning.** For a contrast $\eta$ between two children, conditioning on the selection event $\mathcal S(x_{\mathrm{obs}})$ and the nuisance projection gives

$$p=\Pr\!\left(\eta^{\top}X\ge\eta^{\top}x_{\mathrm{obs}}\;\middle|\;X\in\mathcal S(x_{\mathrm{obs}}),\ P^{\perp}X=P^{\perp}x_{\mathrm{obs}}\right).$$

For polyhedral selection sets, $\eta^{\top}X$ given the nuisance is truncated normal with data-dependent limits [R10], so $p$ is a truncated-normal tail at the observed statistic. The regime is Gaussian data with known covariance; counts with mean-dependent variance are outside it, so these tests are approximate for counts. Gao et al. apply this to linkage-based agglomerative trees [R2]. The truncated-normal test [R11] uses the separating SVM hyperplane as the truncation, estimated by data splitting, and fits means and variance by maximum likelihood.

**Re-simulation.** A Monte Carlo p-value compares the observed node statistic with $B$ statistics from data simulated under a single-population fit and re-clustered by the same procedure,

$$p=\frac{1+\#\{b:\,T^{(b)}_0\ge T_{\mathrm{obs}}\}}{B+1}.$$

This is valid when the fitted null reproduces the real within-node dispersion, zeros and gene correlation. Its smallest value is $1/(B+1)$; with $B=100$ no p-value falls below 0.0099. ClusterDE builds its null with scDesign3 [R12] and calls genes from $c_g=-\log_{10}s^{\mathrm{tgt}}_g-(-\log_{10}s^{\mathrm{null}}_g)$ using the Clipper contrast procedure (threshold DS) at FDR 0.05 [R6]; this is valid when the synthetic null approximates one-cluster data [R6, R12]. CHOIR instead permutes labels: for sibling clusters $i,j$ with mean balanced accuracy $\bar a_{ij}$ of a random forest, $p_{ij}=1-\hat F_{\mathrm{perm}}(\bar a_{ij})$, where $\hat F_{\mathrm{perm}}$ is a kernel CDF of accuracies under permuted labels, and a variance percentile must also pass [R7]. Permuting labels among the same cells tests separability against arbitrary groupings, which equals the single-population null only if the cells are exchangeable.

**Assumptions and failure modes.** Conditioning needs a polyhedral selection event and a Gaussian model. Count splitting needs Poisson or negative-binomial counts with the right overdispersion and fold independence from every upstream step; a wrong dispersion makes the fold-2 null too narrow and creates false splits in overdispersed data. Re-simulation needs a generator that reproduces zeros, library size and gene correlation. Batch, mitochondrial and ambient structure can yield significant, non-biological splits unless those features are excluded, as CHOIR allows. Small clusters have low power, so minimum size and read filters decide many outcomes.

**Heuristics and the model-based gain.** Pairwise marker merges have no calibrated null. Testing genes that defined the clusters is double dipping [R6, R11]. A fitted count model gives per-node p-values with an explicit null, places depth and covariates in the same model, and lets a null fitted once, for example a dispersion trend, be reused across datasets. Its calibration is only as good as the model, so Section 8 tests it rather than assuming it.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CHOIR | hybrid | Over-clusters, then tests each sibling pair with random forests against permuted labels: a kernel percentile of mean balanced accuracy and a bootstrap variance percentile | [R7] |
| Count splitting (countsplit) | model-based | Binomial thinning into folds; cluster on one fold, test each node on another | [R3, R4] |
| Selective inference for hierarchical clustering | model-based | Conditions the two-cluster mean contrast on the linkage selection event | [R2, R10] |
| TN test | model-based | Truncated-normal likelihood with the SVM hyperplane as truncation | [R11] |
| sc-SHC | model-based | Model-based hypothesis test on hierarchical splits, built into clustering or applied to clusters from any algorithm; alpha is a family-wise error rate | [R5] |
| ClusterDE | hybrid | Synthetic one-cluster null and target-minus-null gene contrast at a false discovery rate | [R6, R12] |
| Seurat FindMarkers | heuristic | Wilcoxon rank-sum marker tests between two clusters; merge decisions are made by the analyst | [R8] |
| scran findMarkers | heuristic | Pairwise t, Wilcoxon or binomial tests combined per gene by pval.type | [R9] |
| clustree | heuristic | Multi-resolution visualisation of cell movement; a diagnostic without p-values | [R13] |

The common practice is a heuristic pairwise marker comparison between clusters at a chosen resolution, with merge decisions left to the analyst (Seurat [R8], scran [R9]). It stays as a comparator. The significance-based methods are CHOIR [R7], ClusterDE [R6], countsplit [R3] and sc-SHC [R5]. Selective inference [R2] has no listed code repository, and the TN test [R11] is a comparator only (Section 12). scCCESS [R14] is excluded because it is a consensus clustering method rather than a significance test. The CHOIR test is also exposed by clustering.subclustering.

Exact defaults for the methods singlet will implement or compare:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| CHOIR | alpha | 0.05 | R/CHOIR.R:312 @ e9ebfbc |
| CHOIR | p_adjust | bonferroni | R/CHOIR.R:313 @ e9ebfbc |
| CHOIR | feature_set | var | R/CHOIR.R:314 @ e9ebfbc |
| CHOIR | n_iterations | 100 | R/CHOIR.R:316 @ e9ebfbc |
| CHOIR | n_trees | 50 | R/CHOIR.R:317 @ e9ebfbc |
| CHOIR | min_reads | NULL | R/CHOIR.R:327 @ e9ebfbc |
| CHOIR | n_cores | NULL | R/CHOIR.R:350 @ e9ebfbc |
| countsplit | folds | 2 | R/countsplit.R:53 @ a9e9ad2 |
| countsplit | epsilon | 1/folds per fold | R/countsplit.R:53 @ a9e9ad2 |
| countsplit | overdisps | NULL (Poisson splitting) | R/countsplit.R:53-56 @ a9e9ad2 |
| ClusterDE | approximation | none | R/construct_null.R:28-40 @ 7985feb |
| ClusterDE | family | nb | R/construct_null.R:28-40 @ 7985feb |
| ClusterDE | corr_cut | 0.1 | R/construct_null.R:28-40 @ 7985feb |
| ClusterDE | n_pcs | 200 | R/construct_null.R:28-40 @ 7985feb |
| ClusterDE | n_rep | 1 | R/construct_null.R:28-40 @ 7985feb |
| ClusterDE | seed | 123 | R/construct_null.R:28-40 @ 7985feb |
| ClusterDE | FDR | 0.05 | R/call_de.R:25-34 @ 7985feb |
| ClusterDE | contrastScore | diff | R/call_de.R:25-34 @ 7985feb |
| ClusterDE | nlogTrans | TRUE | R/call_de.R:25-34 @ 7985feb |
| ClusterDE | threshold | DS | R/call_de.R:25-34 @ 7985feb |
| Seurat FindMarkers | test.use | wilcox | R/differential_expression.R:645 @ 5f67c70 |
| Seurat FindMarkers | logfc.threshold | 0.1 | R/differential_expression.R:644 @ 5f67c70 |
| Seurat FindMarkers | min.pct | 0.01 | R/differential_expression.R:646 @ 5f67c70 |
| Seurat FindMarkers | only.pos | FALSE | R/differential_expression.R:649 @ 5f67c70 |
| Seurat FindMarkers | random.seed | 1 | R/differential_expression.R:651 @ 5f67c70 |

## 5. Proposed singlet approach

**Routes.** countsplit, CHOIR, ClusterDE and the Seurat FindMarkers comparator are **ported** (see Section 12). Selective inference, the TN test, sc-SHC, scran findMarkers and clustree are **callouts**: benchmark comparators only.

**Proposed model.** The default is a count-split test with a parametric null. Labels and the tree are re-derived on fold 1 from the stored recipe. For each internal node $v$ with children $A$ and $B$, a negative-binomial GLM is fitted on fold 2 for each highly variable gene $g$, selected on fold 1, with a size-factor offset,

$$\log\mathbb E\big[X^{(2)}_{ig}\big]=\log s_i+\beta_{0g}+\beta_{1g}\,\mathbf 1\{i\in B\},$$

with dispersion shared through a mean-dispersion trend. The node statistic is $T_v=\max_g z_{vg}^2$, the largest squared Wald statistic for $\beta_{1g}$. Its null is simulated from the one-population fit to the parent's fold-2 cells, with the same size factors, and refitted per replicate. The node p-value is the Monte Carlo value of Section 3 with $B=1000$, so that $1/(B+1)\le\alpha/m$ for up to 20 tested nodes at $\alpha=0.05$. A node survives when its Bonferroni-adjusted p-value is below $\alpha$ and some tested gene has a fold-2 log fold change of at least 0.1, a proposed effect floor, not a published threshold. Unsupported nodes merge into their parent.

**Falsification.** The model fails if countsplit leaves the B1 FWSR or calibration band; the default then moves to CHOIR, which must also pass B1. It also fails if B2 finds a grid cell where de_merge reaches power 0.8 and countsplit does not; the default then moves to a full-data test with a simulated null.

**ML stack.** No learned model is needed: per-gene NB GLM fitting and binomial thinning are small, regular kernels, hard-coded in CUDA with cuSPARSE for the sparse thinning. PyTorch is reserved for a learned node-statistic calibrator, added only if B1 fails on real data.

**Cores and streaming.** Thinning streams over non-zero entries in cell chunks; GLM solves run per gene and node. Streaming is not claimed, because each node's null needs all its fold-2 counts.

**Defaults.** countsplit with folds 2, dispersion nb, p_adjust bonferroni, alpha 0.05, seed 0 and device auto. de_merge is a comparator; its output is not evidence of validity.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts; required by countsplit and clusterde |
| read | obs/<partition_key> | label | candidate labels; define the granularity and the number of nodes |
| read | uns/<partition_key>/params | dict | clustering recipe used to re-derive fold-1 labels and the tree |
| write | obs/<partition_key>_validated | label | labels after unsupported nodes are removed or merged |
| write | uns/<partition_key>_validation/tests | table | one row per node: children, statistic, raw and adjusted p, log fold change, decision |
| write | uns/<partition_key>_validation/params | dict | method, alpha, adjustment, folds, dispersion mode and seed |
| write | models/<partition_key>_null | dict | fitted one-population parameters per parent node |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `partition_key` | string | required | — | obs column holding the candidate labels; the recipe in uns/<key>/params must exist. |
| `method` | string | "countsplit" | `countsplit`, `choir`, `clusterde`, `de_merge` | countsplit (default) is calibrated under its count model; de_merge is a heuristic comparator without calibration. |
| `alpha` | number | 0.05 | > 0; < 1 | Significance level for each node test; the threshold is adjusted by p_adjust. |
| `p_adjust` | string | "bonferroni" | `bonferroni`, `bh`, `none` | Adjustment across tree nodes; bonferroni controls the family-wise false split rate. |
| `seed` | integer | 0 | min 0 | Seed for fold assignment, permutations and null simulation. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `countsplit` | object | — | — | Options for method countsplit (binomial thinning into folds, Neufeld et al. semantics). |
| `countsplit.folds` | integer | 2 | min 2 | Number of count-split folds; each fold gets an equal share of the counts. |
| `countsplit.dispersion` | string | "nb" | `nb`, `poisson` | nb fits per-gene overdispersion; poisson assumes none and is exact only for Poisson counts. |
| `choir` | object | — | — | Options for method choir (random-forest permutation tests on sibling clusters). |
| `choir.n_iterations` | integer | 100 | min 10 | Label permutations for the null; run time grows with this value. |
| `choir.n_trees` | integer | 50 | min 1 | Trees per random-forest classifier. |
| `choir.feature_set` | string | "var" | `var`, `all` | Train classifiers on variable features (var) or on all features (all). |
| `choir.exclude_features` | array | [] | — | Feature names removed before classification, for example mitochondrial or ambient genes. |
| `clusterde` | object | — | — | Options for method clusterde (synthetic one-cluster null with contrast-based FDR). |
| `clusterde.null_family` | string | "nb" | — | Count family of the synthetic one-cluster null; nb is the package default. |
| `clusterde.n_pcs` | integer | 200 | min 2 | Principal components used when building the synthetic null. |
| `clusterde.fdr` | number | 0.05 | > 0; < 1 | False discovery rate used to call genes from the target-minus-null contrast. |
<!-- PARAMS:AUTO:END -->

Parameters split by scope. alpha, p_adjust, seed, device, dry_run and overwrite apply to every method. The countsplit, choir and clusterde objects are read only when that method is selected. de_merge takes no options and uses the Seurat test and thresholds in Section 4. countsplit re-clusters fold 1 with the stored recipe and reports both partitions; a missing recipe fails the call rather than re-clustering with guessed settings. Under p_adjust bonferroni the node threshold is alpha divided by the number of tested nodes.

## 7. MCP tool

Tool name `singlet_clustering_cluster_significance_testing` (definition in `tasks/mcp/singlet_clustering_cluster_significance_testing.json`). Example call:

```json
{"dataset": "example.singlet", "partition_key": "leiden_r1", "method": "countsplit", "countsplit": {"folds": 2, "dispersion": "nb"}, "seed": 0}
```

Example result (placeholders, not outputs):

```json
{"dataset": "example.singlet", "status": "completed", "wrote": ["obs/leiden_r1_validated", "uns/leiden_r1_validation/tests", "uns/leiden_r1_validation/params", "models/leiden_r1_null"], "summary": {"method": "countsplit", "nodes_tested": "<int>", "splits_retained": "<int>", "clusters_before": "<int>", "clusters_after": "<int>"}, "provenance_id": "<id>"}
```

Long-running: choir and clusterde may be queued as jobs (status queued, see job_id); countsplit is expected to complete inline. Stochastic: seed fixes fold assignment, permutations and null simulation. Dry run: dry_run returns seconds, peak_memory_gb and device without running.

## 8. Benchmarks

**Shared protocol.** Each method is applied through its complete pipeline to the same input: normalisation, feature selection, dimension reduction, the over-clustered candidate partition (Leiden at one fixed resolution, identical across methods) and every node test. Seeds are fixed per replicate and shared across methods. Feature selection is repeated inside each null replicate rather than done once on the real data. FWSR and calibration use raw node p-values, and adjusted p-values enter only through the final partition. Replicates are independent; nodes within a replicate are not.

### B1. Calibration under a single population

- **Goal**: estimate false split rate and p-value calibration when all cells come from one population.
- **Ground truth**: homogeneous by construction: one simulated group, one fitted type, or one culture per cell. The estimands are the per-replicate indicator $\mathbf 1\{\hat K_r\ge2\}$, averaged over replicates, and the raw node p-values.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter single-group simulation | [R15] | scRNA-seq simulation; proposed 2,000 to 20,000 cells | — | one group, no DE genes |
| ClusterDE one-type null | [R6], generator [R12] | fitted to one annotated type of a real dataset | §12 | fit on held-out cells |
| CellBench single cell lines | [R16]; GEO GSE118767 | human HCC827, H1975, H2228; CEL-seq2, Drop-seq, 10x Chromium | §12 | cultured separately; subclone structure remains |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Family-wise false split rate (FWSR) | mean over $R$ null replicates of $\mathbf 1\{\hat K_r\ge2\}$ | min | primary | — |
| P-value calibration | for $\alpha\in\{0.01,0.05,0.10\}$, the fraction of raw node p-values at or below $\alpha$; Kolmogorov distance of raw p-values from Uniform(0,1) | min deviation from nominal | primary | — |
| Cluster-count inflation | mean of $\hat K_r-1$ over replicates | min | guardrail | — |

- **Comparators**: de_merge [R8]; scran findMarkers [R9]; CHOIR [R7]; sc-SHC [R5]; countsplit with a per-node Wilcoxon test; Leiden at the fixed resolution, unvalidated, as the reference point.
- **Protocol**: $R=200$ replicates per generator or cell line; ClusterDE nulls use its defaults (Section 4).
- **Acceptance criterion**: proposed. FWSR must be at most $\alpha+2\sqrt{\alpha(1-\alpha)/R}$, which is 0.081 at $\alpha=0.05$ and $R=200$. Calibration must lie within $\alpha\pm2\sqrt{\alpha(1-\alpha)/m}$ at each nominal level, with $m$ the number of node tests.
- **Known pitfalls**: (1) The band assumes independent tests; $m$ counts nodes when replicates hold several. (2) The null must use the real analysis's normalisation and HVG selection; choosing HVGs on real data first leaks structure.

### B2. Power on planted two-group splits

- **Goal**: measure detection of a planted two-population split against DE gene fraction and fold change, at FWSR near $\alpha$.
- **Ground truth**: planted simulation, with group membership drawn by the generator, and two-line mixtures with a known design. The per-cell label is the group of origin. The estimand is the per-replicate indicator of two validated clusters with ARI at least 0.9 against the planted labels, averaged over replicates.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter two-group simulation | [R15] | scRNA-seq simulation; group proportion, DE fraction and fold change varied | — | planted effects drawn from the tested count family |
| CellBench two- and three-line mixtures | [R16]; GEO GSE118767 | human cell lines as in B1 | §12 | mixtures give known planted groups |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Split detection rate | fraction of replicates with two validated clusters and ARI at least 0.9 (threshold proposed) | max | primary | — |
| ARI of final partition | adjusted Rand index against planted labels; permutation-invariant | max | primary | — |
| FWSR under null | as in B1, reported jointly | min | guardrail | — |

- **Comparators**: as in B1.
- **Protocol**: grid over DE gene fraction {0.01, 0.05, 0.10} and fold change {1.5, 2, 4} (proposed), $R=100$ per cell, $\alpha=0.05$. Detection curves are compared at FWSR matched to B1.
- **Acceptance criterion**: proposed. At each grid cell where de_merge reaches power at least 0.8, countsplit reaches power at least 0.8 with FWSR inside the B1 band.
- **Known pitfalls**: (1) Planted effects drawn from the tested count family are circular for count-based tests. (2) Distinct cell-line mixtures are very separable and overstate power.

### B3. Over-split check on cell-line mixtures

- **Goal**: check whether validation returns the known number of cell lines on real equal-proportion mixtures, and whether merging recovers them after over-splitting.
- **Ground truth**: orthogonal measurement. The per-cell label is the cell line of origin from the culture and mixing design, or sorted-well membership in plate-based protocols. The estimands are the final cluster count $\hat K$ (target 3), and ARI and NMI between final labels and cell-line labels, computed on the fixed partition with no resolution search against labels.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| sc_mixology (CellBench three-line data) | [R16]; GEO GSE118767 | human HCC827, H1975, H2228; CEL-seq2, Drop-seq, 10x Chromium; 9-cell sorted wells and 90-cell controls; bulk mixtures at 3.75 to 30 pg | §12 | each protocol analysed separately |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recovered cluster number | final cluster count on equal-proportion mixtures | closest to 3 | primary | — |
| ARI and NMI before and after validation | on the fixed over-clustered partition and on the validated partition | max | primary | — |
| Over-split rate | fraction of mixtures with more than 3 final clusters | min | guardrail | — |

- **Comparators**: as in B1.
- **Protocol**: each protocol's equal-proportion mixture goes through the pipeline at one fixed over-clustered resolution, then through each procedure. The sorted 9-cell and 90-cell series are reported separately to test small-n behaviour.
- **Acceptance criterion**: proposed. Exactly three final clusters in at least 90% of equal-proportion mixtures for each protocol, and ARI at least 0.95 after validation.
- **Known pitfalls**: (1) Three distinct lines cannot assess splits within one cell type; that is B1's job. (2) Sorted-cell and bulk-mixed series test different properties and are not pooled.

### P1. Performance and scaling

Wall time, peak memory and throughput at 10k, 100k and 1M cells, on CPU and CUDA, against de_merge with Leiden, countsplit with a per-node Wilcoxon test, CHOIR and sc-SHC. Streaming is not claimed, so 10M cells are not required. Hold fixed: 2,000 HVGs and 50 PCs (proposed), $R=100$ null replicates, $\alpha=0.05$, a fixed seed, and 1 and 8 cores. Report the node-test count with every timing, because run time scales with it. No published scaling curve is used (Section 10).

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `statistics.post_clustering_inference`: Post-clustering inference with valid p-values (double-dipping correction)
- **Feeds**:
  - `clustering.cluster_stability`: Cluster stability under resampling and perturbation
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Reads**: `layers/counts`, `obs/<partition_key>`, `uns/<partition_key>/params`
- **Writes**: `obs/<partition_key>_validated`, `uns/<partition_key>_validation/tests`, `uns/<partition_key>_validation/params`, `models/<partition_key>_null`
<!-- CHAINING:AUTO:END -->

No named recipe yet contains this step. It sits after partitioning and before marker ranking and annotation of validated clusters.

## 10. Risks, pitfalls and open questions

- **Selective and TN methods.** Selective inference [R2] is used through its abstract and has no listed code repository. The truncated-normal limits [R10] are cited from memory and are unchecked against the source text. The TN test is described from its code.
- **sc-SHC and CHOIR.** sc-SHC is cited by its journal DOI, with the title taken from the preprint record, and is described from its README only, so its null construction and code defaults are not given. The CHOIR full text is not used, so its benchmark claims are excluded.
- **Benchmark and metadata gaps.** B4, label concordance with scib-metrics NMI and ARI [R17], is omitted because its dataset list is not specified. The CellBench cell counts are not stated. The ClusterDE "DS" threshold rule is not derived here. Author lists for R12 and R14 are omitted because the records do not carry them. scran findMarkers has no dedicated citation, so [R9] is its normalisation paper. The scib-metrics rule picks the best of ten Leiden resolutions using labels, which is optimistic.
- **Unsettled literature.** Family-wise against false discovery control across nodes has no head-to-head comparison. Gradients can yield significant splits. At large $n$ significance measures detectability; the effect floor in Section 5 is proposed, not validated. Null calibration across tissues is unknown.
- **Technical risks.** Comparators whose terms do not permit porting stay comparators (Section 12). Feature selection on all cells can break fold independence silently, so B1 on real controls is the check. GLM solves over many nodes may dominate run time (P1).
- **First experiment.** Apply B1 to Splatter single-group data and CellBench single-line data for countsplit with NB and Poisson dispersion, de_merge and CHOIR, at $R=200$ with the Section 8 protocol. The B1 calibration band is the first go or no-go decision.

## 11. References

R1. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R2. Gao LL, Bien J, Witten D. Selective inference for hierarchical clustering. *Journal of the American Statistical Association* 2024;119(545):332-342. doi:10.1080/01621459.2022.2116331 — verified (search)
R3. Neufeld A, Gao L, Popp J, Battle A, Witten D. Inference after latent variable estimation for single-cell RNA sequencing data. *Biostatistics* 2022. doi:10.1093/biostatistics/kxac047 — verified (repo)
R4. Neufeld A, Popp J, Gao L, Battle A, Witten D. Negative binomial count splitting for single-cell RNA sequencing data. arXiv:2307.12985 (2023). — verified (repo)
R5. Grabski IN, Street K, Irizarry RA. Significance analysis for clustering with single-cell RNA-sequencing data. *Nature Methods* 2023;20(8):1196-1202. doi:10.1038/s41592-023-01933-9 — verified (search)
R6. Song D, Li K, Chen S, Yang Y, et al. ClusterDE: a post-clustering differential expression (DE) method robust to false-positive inflation caused by double dipping. *bioRxiv* 2023. doi:10.1101/2023.07.21.550107 — verified (corpus)
R7. Sant et al. CHOIR improves significance-based detection of cell types and states from single-cell data. *Nature Genetics* 2025. doi:10.1038/s41588-025-02148-8 — verified (corpus)
R8. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)
R9. Lun ATL, Bach K, Marioni JC. Pooling across cells to normalize single-cell RNA sequencing data with many zero counts. *Genome Biology* 2016. doi:10.1186/s13059-016-0947-7 — verified (corpus)
R10. Lee JD, Sun DL, Sun Y, Taylor JE. Exact post-selection inference, with application to the lasso. *Annals of Statistics* 2016. — unverified (memory)
R11. Zhang JM, Kamath GM, Tse DN. Valid post-clustering differential analysis for single-cell RNA-seq. *Cell Systems* 2019. doi:10.1016/j.cels.2019.07.012 — verified (corpus)
R12. scDesign3 generates realistic in silico data for multimodal single-cell and spatial omics. *Nature Biotechnology* 2023. doi:10.1038/s41587-023-01772-1 — verified (corpus)
R13. Zappia L, Oshlack A. Clustering trees: a visualization for evaluating clusterings at multiple resolutions. *GigaScience* 2018;7. doi:10.1093/gigascience/giy083 — verified (repo)
R14. Autoencoder-based cluster ensembles for single-cell RNA-seq data analysis. *BMC Bioinformatics* 2019. doi:10.1186/s12859-019-3179-5 — verified (corpus)
R15. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R16. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R17. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/corceslab/CHOIR | Sant et al. (per README citation) | MIT (LICENSE file and DESCRIPTION agree) | permutation tests on sibling clusters | port |
| https://github.com/anna-neufeld/countsplit | Anna Neufeld (author, maintainer); Mischko Heming, Joshua Popp, Sebastian Quadrini (contributors) | MIT (DESCRIPTION; LICENSE file) | count splitting, Poisson and negative binomial | port |
| https://github.com/SONGDONGYUAN1994/ClusterDE | Dongyuan Song (author, maintainer); Kexin Li, Siqi Chen, Yiwen Yang (authors) | MIT (DESCRIPTION; LICENSE file) | synthetic-null DE with FDR control | port |
| https://github.com/satijalab/seurat | Seurat authors (LICENSE copyright holder) | MIT (LICENSE file) | FindMarkers comparator and defaults | port |
| https://github.com/MarioniLab/scran | Aaron Lun (author, maintainer); Karsten Bach (author); Jong Kyoung Kim, Antonio Scialdone (contributors) | GPL-3 (DESCRIPTION; no LICENSE file at root) | findMarkers comparator | callout |
| https://github.com/lazappi/clustree | Luke Zappia, Alicia Oshlack (authors, DESCRIPTION) | GPL-3 (LICENSE file and DESCRIPTION agree) | multi-resolution diagnostic | callout |
| https://github.com/jessemzhang/tn_test | Jesse Min Zhang (setup.py author) | none stated | TN test comparator | callout |
| https://github.com/igrabski/sc-SHC | repository owner igrabski | Artistic-2.0 (DESCRIPTION); no LICENSE file at root | sc-SHC comparator | callout |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian (copyright holder) | MIT (LICENSE file, 2018) | benchmark data | callout |
