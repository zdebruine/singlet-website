---
id: statistics.post_clustering_inference
title: Post-clustering inference with valid p-values (double-dipping correction)
area: statistics
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [clustering.cell_partitioning, feature-selection.highly_variable_gene_selection, normalization.count_noise_model_selection]
feeds: [statistics.multiple_testing_control, markers-de.cluster_marker_ranking, clustering.cluster_significance_testing]
reads: [layers/counts, obs/<cluster_key>, var/highly_variable, var/<overdispersion_key>]
writes: [layers/split_fold1, layers/split_fold2, varm/post_clust_pval_<method>, varm/post_clust_qval_<method>, uns/post_clust/params]
devices: [cpu, cuda]
mcp_tool: singlet_statistics_post_clustering_inference
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Post-clustering inference with valid p-values (double-dipping correction)

> Test whether genes differ between clusters that were defined from the same counts, reporting per-gene p-values and BH q-values whose false positive rate stays at the nominal level after the clustering step.

## 1. Question

Are genes that differ between clusters still significant when the clusters were defined from the same counts, once that clustering step is accounted for? The input is a cell-by-gene UMI matrix and cluster labels computed from it, or the procedure that produced them. The output is a per-gene p-value and a Benjamini-Hochberg q-value for each cluster contrast. A correct answer keeps the false positive rate at the nominal level under the null of no true mean difference between the clusters the algorithm returns.

## 2. Why this task matters and where the field stands

Cell types are usually found by clustering cells and then naming the clusters by their marker genes, so the same counts drive both steps. Clustering picks partitions that separate the cells well, and a test that assumes fixed groups then rejects too often even when the data come from one population [R1]. Cluster boundaries are also unstable and depend on resolution [R10]. Seurat's differential-expression documentation warns that the p-values "should be interpreted cautiously" for this reason (R/generics.R:130 at 5f67c70). The problem is **contested**: practice relies on the uncorrected Wilcoxon test, and the corrected methods are recent and few.

Open problems:

- No accepted community benchmark of post-clustering validity exists; the method papers use their own simulations [R1][R7].
- Exact selective methods are known for hierarchical clustering [R2] and for k-means [R3]. No exact selective event is established for graph-based clustering (Leiden or Louvain), which is the default in common pipelines.
- Clusters taken from batch-corrected or integrated embeddings change the selection event, and no selective analysis for that case has been identified.
- Splitting discards part of the information, and the best split ratio for sparse UMI data has no established optimality result.
- Pseudobulk and mixed-model tests remove donor-level pseudoreplication [R8] but reuse the same labels, so they do not address selection.

## 3. Theory and insight

Let $X$ be the count matrix, $\hat C=c(X)$ the labels from a fixed clustering algorithm $c$, and $s_i$ the size factor of cell $i$. The estimand for gene $g$ and contrast $k$ (cluster $k$ against the rest) is the log fold change of size-factor-normalised population means, $\delta_{gk}=\log(\rho_{gk}/\rho_{g\bar k})$, and the null is $\delta_{gk}=0$. The statistic $T_g(X)=\bar X_{g,\hat C_k}-\bar X_{g,\hat C_{\bar k}}$ is computed from the same data that determine $\hat C$, so its reference distribution is not the one for fixed groups. Three routes give valid answers: (a) condition on the selection event; (b) make the test data independent of the labels by splitting the counts; (c) calibrate the whole pipeline against a single-population null.

**Count splitting.** If $X_{ig}\sim\mathrm{Poi}(\lambda_{ig})$, then $X^{(1)}_{ig}\mid X_{ig}\sim\mathrm{Bin}(X_{ig},\varepsilon)$ and $X^{(2)}_{ig}=X_{ig}-X^{(1)}_{ig}$ are independent Poisson variables with means $\varepsilon\lambda_{ig}$ and $(1-\varepsilon)\lambda_{ig}$. For negative binomial counts with $\mathrm{E}[X]=\mu$, $\mathrm{Var}[X]=\mu+\mu^2/b_g$ and $b_g$ known,

$$X^{(1)}_{ig}\mid X_{ig}\sim\mathrm{BetaBin}\!\left(X_{ig};\ \varepsilon b_g,\ (1-\varepsilon)b_g\right).$$

This is exact. If $Y\sim\mathrm{NB}(a,p)$ and $Z\sim\mathrm{NB}(c,p)$ are independent with the same $p$, then $Y\mid Y+Z=n$ is beta-binomial$(n;a,c)$ and $Y+Z\sim\mathrm{NB}(a+c,p)$. With $a=\varepsilon b_g$ and $c=(1-\varepsilon)b_g$, the two folds have the joint law of two independent negative binomial variables. Zeros stay zero in both folds, so the split touches only non-zero entries. The regime is the stated count model with $b_g$ fixed in advance; the countsplit documentation ties fold independence to the Poisson or negative binomial model (section 12).

**Power.** Under the Poisson model the Fisher information about $\lambda$ in $X^{(2)}$ is $(1-\varepsilon)$ times the information in $X$, so at $\varepsilon=1/2$ the test uses half of the information.

**Truncated-normal test.** For a pair of clusters, a linear SVM fitted on an estimation half of the cells labels the other half, and the per-gene statistic compares the two cluster sums with truncated-normal moments under the null of equal means:

$$Z_g=\frac{\sum_{i\in\hat z}x_{ig}-\sum_{i\in\hat y}x_{ig}-\big(n_z m^{z}_g-n_y m^{y}_g\big)}{\sqrt{n_y v^{y}_g+n_z v^{z}_g}},\qquad p_g=2\min\{\Phi(Z_g),\Phi(-Z_g)\},$$

where $m$ and $v$ are the mean and variance of the truncated normals implied by the hyperplane, using per-gene maximum-likelihood means. The truncation is required because the labels of the test half are functions of that half's own values. The regime is Gaussian values with diagonal covariance, and the p-value is approximate because the moments are plug-in estimates (section 10).

**ClusterDE.** For gene $g$, the contrast score compares $-\log_{10}p$ from the real data with the same quantity from a one-population synthetic null, $c_g=-\log_{10}p^{\rm real}_g+\log_{10}p^{\rm null}_g$. The estimated false discovery proportion at threshold $t$ is

$$\widehat{\mathrm{FDP}}(t)=\min\Big\{1,\ \frac{\#\{g:\ c_g\le -t\}}{\#\{g:\ c_g\ge t\}}\Big\},$$

made monotone over increasing $t$ (the default threshold "DS"; the alternative "BC" adds one to the numerator). The output is an empirical q-value per gene, not a p-value, and it is calibrated only if the synthetic null reproduces the null behaviour of the real pipeline, including its clustering.

**Estimands.** For every p-value method, $p_{gk}$ is valid when $\Pr_{H_0}(p_{gk}\le\alpha)\le\alpha$ for every $\alpha$. For count splitting, fold-2 log fold changes equal full-count ones in expectation, because thinning multiplies both cluster means by the same factor. The q-value is the BH adjustment over the $m_k$ genes tested for contrast $k$:

$$q_{(j)}=\min_{l\ge j}\frac{m_k\,p_{(l)}}{l}.$$

For the truncated-normal test, the estimand is the difference of the two cluster means of gene $g$ on the input scale, so inputs should be log-normalised or variance-stabilised. Regimes: splitting is exact under the count model with known sizes; the truncated-normal test is approximate; ClusterDE is empirical.

**Failure modes.**

- Naive tests: the labels separate the same counts, so the nominal level is exceeded. Seurat's Wilcoxon p-value adjustment is Bonferroni over all features, a family-wise correction that does not address selection.
- Trying several resolutions or values of k and reporting the most significant contrast is uncontrolled selection that none of the three routes covers.
- Splitting: sizes estimated from the same counts break the independence argument, and sparse UMI data lose power.
- Truncated-normal test: labels for the estimation half must come from cells not used for testing, and clusters that a hyperplane cannot separate violate the model.
- ClusterDE: the synthetic null is only as good as its generator; missing gene-gene, depth or cell-cycle structure gives miscalibrated FDR.
- All routes: depth, quality or donor-composition differences give significant contrasts that are confounders, not selection artefacts. Arbitrary cuts of a continuum make the one-population null ill-posed, so an FDR is then not a cell-type error rate.

**Insight.** Splitting is model-based and algorithm-agnostic, at a cost in power. The truncated-normal test conditions on a hyperplane and a Gaussian model. ClusterDE trades formal guarantees for an empirical null. The heuristic tests fail because the labels and the test share the same counts, not because of their test statistic.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Naive Wilcoxon on cluster labels (Seurat FindMarkers) | heuristic | Rank-sum test of each gene between labels computed from the same counts; p-values assume fixed groups | [R9] |
| Truncated-normal (TN) test | model-based | Hyperplane fitted on one half of the cells; per-gene truncated-normal test on the other half | [R1] |
| Count splitting, Poisson and negative binomial | model-based | Split each count into independent folds; cluster on fold 1, test fold 2 of the same cells | [R4][R5] |
| ClusterDE | model-based | One-population synthetic null run through the whole pipeline; empirical FDR of contrast scores | [R7] |

Seurat's FindMarkers is the common practice and serves as the uncorrected baseline. The three corrected methods have public source code that defines their outputs. The selective-inference methods for hierarchical [R2] and k-means clustering [R3] and data thinning [R6] are left out of this table and the MCP enum (see section 10). Pseudobulk tests [R8] are useful for donor-level validity only and are not tabulated, because they reuse the same labels.

Defaults taken from source:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Seurat FindMarkers | test.use | "wilcox" | R/differential_expression.R:645 @5f67c70 |
| Seurat FindMarkers | min.pct | 0.01 | R/differential_expression.R:646 @5f67c70 |
| Seurat FindMarkers | logfc.threshold | 0.1 | R/differential_expression.R:644 @5f67c70 |
| Seurat FindMarkers | p_val_adj | Bonferroni over all features in the object, for every test except roc | R/differential_expression.R:762-765 and :2067 @5f67c70 |
| TN test | split_prop | 0.5 | truncated_normal/truncated_normal.py:551 @bf9fd2b |
| TN test | C (SVM penalty) | 100 | truncated_normal/truncated_normal.py:546 @bf9fd2b |
| TN test | use_tdist | False (True gives t with n_y+n_z-2 df) | truncated_normal/truncated_normal.py:555 and :414 @bf9fd2b |
| Count splitting | folds | 2 | R/countsplit.R:53 @a9e9ad2 |
| Count splitting | epsilon | (1/2, 1/2) | R/countsplit.R:53 @a9e9ad2 |
| Count splitting | overdisps | NULL (Poisson splitting) | R/countsplit.R:53 @a9e9ad2 |
| ClusterDE null | approximation | "none" | R/construct_null.R:30 @7985feb |
| ClusterDE null | corr_cut | 0.1 | R/construct_null.R:31 @7985feb |
| ClusterDE null | family | "nb" | R/construct_null.R:33 @7985feb |
| ClusterDE null | n_pcs, n_rep, seed | 200, 1, 123 | R/construct_null.R:37, :38, :40 @7985feb |
| ClusterDE callDE | FDR, contrastScore, correct, threshold | 0.05, "diff", FALSE, "DS" | R/call_de.R:29-32 @7985feb |

## 5. Proposed singlet approach

Routes, per method:

- **Count splitting (Poisson and negative binomial): port** (see section 12). The split is a per-entry sampler over non-zero counts: beta-binomial draws, or Dirichlet-multinomial draws for equal folds, which give the same two-fold law. The fold-2 test is a per-gene likelihood-ratio test of a cluster indicator in a negative binomial GLM with fixed size $b_g$ and log size-factor offsets. This GLM is a choice of this proposal; the countsplit package supplies only the split.
- **ClusterDE: port** of the pipeline logic. Its R dependencies for null generation are replaced by singlet code.
- **TN test: reimplement** from the paper; the repository code serves only as a reference for outputs and checks (see section 12).
- **Naive Wilcoxon: reimplement** the rank-sum test from its definition, for benchmarking only. Seurat is a callout comparator.

The model singlet proposes is negative binomial count splitting with known per-gene size as the default. It is falsified if the B1 replicate FDR exceeds 0.07 in any grid cell, if the naive baseline does not exceed alpha in the same grid (the benchmark would then not detect double dipping), or if B2 power falls below 0.5 times the oracle power where the oracle power is at least 0.8.

No learned model is in the default path. The split and the per-gene GLM are small, hot kernels and are hard-coded in CUDA (per-entry sampling with cuRAND, per-gene iteratively reweighted least squares), with a CPU implementation of the same semantics. PyTorch is reserved for the learned null in section 10. Core kernels are the sparse split, the fold-2 GLM and the BH step (sort and cumulative minimum).

The split is independent across entries and can run in blocks of cells; the GLM runs per gene block on the fold-2 counts in memory.

Defaults are in section 6. Genes are restricted to `var/highly_variable`, and the per-gene size must be supplied in a `var` column (for example from an upstream noise-model task, section 9).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, cells by genes |
| read | obs/<cluster_key> | categorical | labels learned on fold-1 or estimation-half cells only |
| read | var/highly_variable | bool | gene set shared by all methods |
| read | var/<overdispersion_key> | float32 | per-gene negative binomial size for countsplit_nb |
| write | layers/split_fold1 | sparse int | clustering fold (splitting methods) |
| write | layers/split_fold2 | sparse int | testing fold (splitting methods) |
| write | varm/post_clust_pval_<method> | float32, genes by contrasts | corrected p-values (not clusterde) |
| write | varm/post_clust_qval_<method> | float32, genes by contrasts | BH q-values; empirical q-values for clusterde |
| write | uns/post_clust/params | dict | method, alpha, seed, fold settings, provenance |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `cluster_key` | string | — | — | obs column with cluster labels, learned only on fold-1 or estimation-half cells for splitting and tn_test. |
| `method` | string | "countsplit_nb" | `countsplit_nb`, `countsplit_poisson`, `tn_test`, `clusterde`, `naive_wilcoxon` | Test to run. countsplit_nb is the model-based default; naive_wilcoxon is a baseline only. |
| `alpha` | number | 0.05 | max 1; > 0 | BH false discovery rate level per contrast; also the clusterde FDR level. |
| `seed` | integer | 0 | — | Random seed for the fold assignment and the TN split. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `countsplit` | object | — | — | Options for countsplit_poisson and countsplit_nb. |
| `countsplit.epsilon` | number | 0.5 | > 0; < 1 | Share of each count given to fold 1 (clustering); the test uses the rest. |
| `countsplit.overdispersion_key` | string | "overdisp_b" | — | var column with known per-gene negative binomial size; required by countsplit_nb, ignored by countsplit_poisson. |
| `tn_test` | object | — | — | Options for tn_test. |
| `tn_test.split_prop` | number | 0.5 | > 0; < 1 | Fraction of cells used to fit the separating hyperplane. |
| `tn_test.svm_C` | number | 100 | > 0 | Penalty C passed to the linear SVM that fits the hyperplane. |
| `tn_test.use_tdist` | boolean | false | — | Use a t reference with n_y+n_z-2 degrees of freedom instead of normal. |
| `clusterde` | object | — | — | Options for clusterde null generation and calibration. |
| `clusterde.null_family` | string | "nb" | `nb` | Per-gene family for the single-population null; nb is the recommended family for UMI counts. |
| `clusterde.corr_cut` | number | 0.1 | — | Correlation cutoff used by the null generator. |
| `clusterde.n_pcs` | integer | 200 | min 1 | Number of principal components used in null generation. |
| `clusterde.n_rep` | integer | 1 | min 1 | Number of single-population null replicates generated. |
| `naive_wilcoxon` | object | — | — | Pre-filters for the naive Wilcoxon baseline. |
| `naive_wilcoxon.min_pct` | number | 0.01 | min 0; max 1 | Minimum fraction of cells expressing the gene in either group. |
| `naive_wilcoxon.logfc_threshold` | number | 0.1 | min 0 | Minimum average log fold change for a gene to be tested. |
<!-- PARAMS:AUTO:END -->

Options for countsplit apply to countsplit_poisson and countsplit_nb, and overdispersion_key is ignored by countsplit_poisson. tn_test options apply to tn_test, clusterde options to clusterde, and naive_wilcoxon options to naive_wilcoxon; options for other methods are ignored and recorded in uns/post_clust/params. For splitting and TN methods, cluster_key must come from fold-1 or estimation-half cells. The tool checks the provenance record and refuses otherwise, because labels computed on all cells invalidate every p-value. alpha is the BH level per contrast and the clusterde FDR level.

## 7. MCP tool

Tool name `singlet_statistics_post_clustering_inference` (definition in `tasks/mcp/singlet_statistics_post_clustering_inference.json`). Example call and result; values in angle brackets are placeholders, not results.

```json
{"dataset": "data/pbmc.singlet", "cluster_key": "leiden_fold1", "method": "countsplit_nb", "countsplit": {"epsilon": 0.5, "overdispersion_key": "overdisp_b"}, "alpha": 0.05, "seed": 0}
```

```json
{"dataset": "data/pbmc.singlet", "status": "completed", "wrote": ["layers/split_fold1", "layers/split_fold2", "varm/post_clust_pval_countsplit_nb", "varm/post_clust_qval_countsplit_nb", "uns/post_clust/params"], "summary": {"contrasts": "<int>", "genes_tested": "<int>", "discoveries_q_le_alpha": "<int per contrast>", "provenance_check": "passed"}, "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: tn_test and clusterde above the in-memory threshold return status queued with a job id. Stochastic: seed fixes the fold assignment and the TN split, so identical seeds reproduce outputs. Dry run: dry_run true returns seconds, peak memory and device in estimate without writing.

## 8. Benchmarks

No published benchmark of post-clustering validity was identified, so every accuracy benchmark below is a singlet proposal. Shared protocol: each benchmark fixes the clustering algorithm, its resolution or k, and the gene set (var/highly_variable) before any test runs. Replicate r uses seed r. Splitting methods cluster fold 1 only, and gene pre-filters are identical for all methods. Rejection rates and FDR use BH at alpha 0.05, with 95% Wilson intervals across replicates. Depth is a stratifier in every table.

### B1. Null type I error and p-value uniformity under one population

- **Goal**: measure the rejection rate and p-value uniformity of between-cluster tests when every gene is null.
- **Ground truth**: planted simulation; every gene is null, so no cell labels are needed. Estimand: share of (gene, replicate) pairs with corrected p at or below alpha, over tested genes.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Single-population NB counts | generator recipe below | UMI-type counts; sizes set by singlet | — | Per-gene means and sizes from a reference fit |
| Real-data nulls from tn_test and ClusterDE example data | [R1], [R7]; section 12 | scRNA-seq; sizes — | — | One annotated type split at random |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| per_gene_rejection_rate | Share of (gene, replicate) pairs with p at or below alpha | must not exceed alpha | primary | [R1] |
| ks_uniformity | Kolmogorov-Smirnov distance of pooled null p-values from U(0,1) | minimise | primary | — |
| replicate_fdr | Mean over replicates of V_r / max(R_r, 1); under one population, the probability of any discovery | must not exceed alpha | primary | [R7] |

- **Comparators**: naive_wilcoxon, tn_test, countsplit_poisson, countsplit_nb, clusterde.
- **Protocol**: at least 200 replicates, seed equal to replicate index. Counts $X_{ig}\sim\mathrm{NB}(s_i\mu_g,b_g)$ for one population, with means and sizes fitted to a reference chosen by singlet. Fold 1 only for splitting methods; include the naive baseline; stratify by depth.
- **Acceptance criterion** (singlet proposal, not from the literature): replicate_fdr at or below 0.07 (0.05 plus 0.02 Monte Carlo slack) for every method claiming validity; the 95% Wilson interval of per_gene_rejection_rate covers alpha at 0.05 and 0.01; the naive baseline exceeds alpha.
- **Known pitfalls**: library-size separation; generator leakage (fit the generator on held-out cells).

### B2. Planted between-cluster difference: power and realised FDR

- **Goal**: measure power and realised FDR when a known gene set differs between two populations, against an oracle that knows the true labels.
- **Ground truth**: planted simulation. A set $D$ of genes has log fold change $\Delta$ between two populations, and the per-gene truth is membership in $D$. Power is the mean over replicates of the fraction of $D$ with q at or below alpha. Realised FDR is the mean over replicates of $V_r/\max(R_r,1)$, where $V_r$ counts non-$D$ genes with q at or below alpha. The oracle uses the population labels and is a ceiling only.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Two-population NB counts with planted set D | generator recipe below; singlet design, no accession | UMI-type counts; sizes set by singlet | — | Populations differ by $\Delta$ on $D$ only |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| power_at_fdr | Mean over replicates of the fraction of $D$ with q at or below alpha | maximise | primary | [R1] |
| realized_fdr | As defined above | must not exceed alpha | guardrail | [R1] |
| oracle_power_ratio | Power of the method divided by the power of a t-test on true labels at the same $\Delta$ | maximise | primary | — |

- **Comparators**: t-test on true labels (oracle), naive_wilcoxon, tn_test, countsplit_poisson, countsplit_nb, clusterde.
- **Protocol**: grid over $\Delta$ and the fraction of planted genes. Generate two populations with the planted fold change on $D$, cluster with the fixed algorithm, and fit each method. Report power, realised FDR and oracle power ratio with bootstrap intervals across replicates.
- **Acceptance criterion** (singlet proposal): realised FDR at or below 0.07; where oracle power is at least 0.8, method power is at least 0.5 times oracle power.
- **Known pitfalls**: planted genes also drive clustering, which inflates power relative to real data with weaker clusters; the oracle cannot be used in practice.

### P1. Performance and scaling

Wall time, peak memory and throughput (gene tests per second and non-zero entries split per second) at 10k, 100k and 1M cells, on CPU and CUDA, against Seurat FindMarkers (wilcox), the countsplit R package, the tn_test Python code and ClusterDE. Hold fixed the number of clusters, highly variable genes, folds and replicate count. Count splitting touches only non-zero entries (R/countsplit.R:83 and :90), so its cost should scale with the number of non-zero entries. Sizes above 1M cells are outside this benchmark.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `normalization.count_noise_model_selection`: Count noise-model selection and zero-inflation diagnosis
- **Feeds**:
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `clustering.cluster_significance_testing`: Testing whether clusters or splits are statistically real, and merging over-split clusters
- **Reads**: `layers/counts`, `obs/<cluster_key>`, `var/highly_variable`, `var/<overdispersion_key>`
- **Writes**: `layers/split_fold1`, `layers/split_fold2`, `varm/post_clust_pval_<method>`, `varm/post_clust_qval_<method>`, `uns/post_clust/params`
<!-- CHAINING:AUTO:END -->

Typical sequence: split counts, cluster fold 1 with a fixed algorithm, test fold 2 with this task, then control FDR across contrasts.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** Public code exists for the hierarchical [R2] and k-means [R3] selective-inference methods, but it has not been read for this task. Data thinning [R6] is known from its arXiv record and README. No runtime measurements exist yet. None of the three is in the methods table or the MCP enum.
- **Conflicting bibliographic records.** The ClusterDE author lists differ across the package DESCRIPTION, the RECOMB 2025 record and the 2023 preprint, which lists a larger group; [R7] follows the RECOMB 2025 record. [R2] is dated 2022 online and 2024 in print. The Biostatistics volume and issue of [R4] are not given in the repository.
- **Unsettled theory.** The open benchmark and selective-inference gaps are listed in section 2. Sizes estimated from the same counts break the exact independence argument, and the size of this effect is not quantified. The power cost of splitting on sparse UMI data is unmeasured. Multi-contrast dependence belongs to statistics.multiple_testing_control.
- **Technical risks.** The TN test is reimplemented, not ported (section 12). When no hyperplane is supplied, its driver estimates one on a random split of the same cells, and its own warning calls this technically incorrect because the second half was used for clustering (truncated_normal.py:607-613). ClusterDE's null generator depends on R packages whose port cost is unestimated.
- **Source corrections.** The TN code's docstring calls C a tolerance (truncated_normal.py:496), but it is passed to sklearn's linear SVC as the penalty (truncated_normal.py:523), so the MCP descriptions follow the code.
- **First experiment.** On the B1 generator, run the naive baseline and countsplit_nb on the same grid. Confirm that the baseline exceeds alpha before trusting any calibration result, then run B2 on the same generator. The learned single-population null in PyTorch is future work and is not part of this proposal.

## 11. References

R1. Zhang JM, Kamath GM, Tse DN. Valid post-clustering differential analysis for single-cell RNA-seq. *Cell Systems* 2019;9(4):383-392.e6. doi:10.1016/j.cels.2019.07.012 — verified (corpus)

R2. Gao LL, Bien J, Witten D. Selective inference for hierarchical clustering. *Journal of the American Statistical Association* 2024;119(545):332-342 (online 2022); arXiv:2012.02936. — verified (search)

R3. Chen YT, Witten DM. Selective inference for k-means clustering. *Journal of Machine Learning Research* 2023;24(152):1-41. — verified (search)

R4. Neufeld A, Gao LL, Popp J, Battle A, Witten D. Inference after latent variable estimation for single-cell RNA sequencing data. *Biostatistics* 2022. doi:10.1093/biostatistics/kxac047 — verified (repo)

R5. Neufeld A, Popp J, Gao L, Battle A, Witten D. Negative binomial count splitting for single-cell RNA sequencing data. arXiv:2307.12985; 2023. — verified (repo)

R6. Neufeld A, Dharamshi A, Gao LL, Witten D. Data thinning for convolution-closed distributions. arXiv:2301.07276; 2023. — verified (repo)

R7. Song D, Chen S, Lee C, Li K, Ge X, Li JJ. Synthetic control removes spurious discoveries from double dipping in single-cell and spatial transcriptomics data analyses. RECOMB 2025 proceedings, *Lecture Notes in Computer Science* 15647:400-404, Springer. doi:10.1007/978-3-031-90252-9_48 — verified (corpus)

R8. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)

R9. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)

R10. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/anna-neufeld/countsplit | Anna Neufeld (author, maintainer, copyright holder); Mischko Heming, Joshua Popp, Sebastian Quadrini (contributors) | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE: 2021, Anna Neufeld) | reference implementation of Poisson and negative binomial count splitting | port |
| https://github.com/SONGDONGYUAN1994/ClusterDE | Dongyuan Song (author, maintainer), Kexin Li, Siqi Chen, Yiwen Yang (authors; DESCRIPTION) | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE.md: 2023, ClusterDE authors) | single-population null and FDR calibration | port |
| https://github.com/jessemzhang/tn_test | Jesse Min Zhang (setup.py author) | none stated (no LICENSE file; no license field in setup.py) | TN test reference implementation | reimplement |
| https://github.com/satijalab/seurat | Seurat authors (LICENSE copyright holder; many contributors in DESCRIPTION) | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE: 2021, Seurat authors) | FindMarkers Wilcoxon baseline | callout |
