---
id: clustering.cluster_number_estimation
title: Estimating the number of cell clusters or types
area: clustering
scope: core
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [normalization.size_factor_estimation, feature-selection.highly_variable_gene_selection, dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection]
feeds: [clustering.cell_partitioning, clustering.resolution_selection]
reads: [layers/log1p_norm, var/highly_variable, obsm/X_pca]
writes: [uns/cluster_number_estimation/k, uns/cluster_number_estimation/curve, obs/cluster_number_partition]
devices: [cpu, cuda]
mcp_tool: singlet_clustering_cluster_number_estimation
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Estimating the number of cell clusters or types

> Estimates how many cell populations a normalised dataset supports, using a published noise-bound count (SC3), a silhouette scan or a Gaussian-mixture BIC scan, and returns the score curve so that the estimate can be inspected rather than trusted.

## 1. Question

How many distinct cell populations does a normalised single-cell dataset support, estimated from expression alone? Inputs are log-normalised values on a gene set and a principal-component embedding; outputs are an integer $\hat k$, a score curve over candidate $k$ and optionally a partition at $\hat k$. A correct answer is a $\hat k$ that matches a stated reference granularity, such as annotated cell types or planted groups.

## 2. Why this task matters and where the field stands

Most downstream steps need a number of groups: a partition at a fixed granularity, a clustering resolution, or the clusters on which markers and annotation are computed. Without a stated $k$, the same data give different cluster counts under different embeddings and gene sets. The status is **contested**. The sources cited here do not establish one standard estimator for scRNA-seq. SC3 counts eigenvalues above a Tracy–Widom noise bound [R2]. Silhouette width is a generic cluster-validity score [R4], and Gaussian-mixture selection by BIC is implemented in mclust [R5]. Yu et al. benchmarked estimators on subsampled atlases with known cell-type counts [R1]. Unsupervised clustering of single-cell RNA-seq data is reviewed as a field with open challenges [R3]. Open problems: the reference $k$ depends on the annotation granularity chosen; continuous states have no discrete $k$; and $\hat k$ depends on the number of PCs and the gene set.

## 3. Theory and insight

Let $g$ be the number of retained genes and $c$ the number of cells. $L$ is the $g\times c$ matrix of log-normalised values on the gene set, and $\tilde L$ is $L$ with each cell (column) centred and scaled across genes. A partition of the cells is $\{C_1,\dots,C_K\}$.

**Noise-bound count (SC3).** With

$$\mu=(\sqrt{g-1}+\sqrt{c})^2,\qquad \sigma=(\sqrt{g-1}+\sqrt{c})\Big(\tfrac{1}{\sqrt{g-1}}+\tfrac{1}{\sqrt{c}}\Big)^{1/3},\qquad b=3.273\,\sigma+\mu,$$

the estimate is $\hat k_{\rm TW}=\max\{1,\#\{j:\lambda_j(\tilde L^\top\tilde L)>b\}\}$, where $\lambda_j$ are the eigenvalues of the un-normalised Gram matrix, as the code comment describes (section 10). Since $b>0$, zero eigenvalues never count, and $\tilde L^\top\tilde L$ and $\tilde L\tilde L^\top$ share their non-zero spectrum, so the count can use the smaller matrix. The bound is the Tracy–Widom edge for a Gaussian null with independent standardised entries, valid as $g$ and $c$ grow at a fixed ratio. The result is a spike count rather than a test of stated size, because eigenvalues are not corrected for multiplicity.

**Gaussian mixtures and BIC.** For $d$-dimensional PC scores $z_i$, $p(z\mid\theta_K)=\sum_{k=1}^K\pi_k\,\mathcal N(z\mid\mu_k,\Sigma_k)$ is fitted by EM. With $\hat\ell_K$ the maximised log-likelihood and $\nu_K$ the free-parameter count,

$$\mathrm{BIC}(K)=2\hat\ell_K-\nu_K\log c,\qquad \nu_K=\begin{cases}2Kd+K-1,&\text{diagonal }\Sigma_k\\ Kd+K\,d(d+1)/2+K-1,&\text{full }\Sigma_k.\end{cases}$$

This document treats larger as better; software conventions differ in sign. $\mathrm{BIC}/2$ approximates the log marginal likelihood for large $c$ at a fixed model class, so $\exp\{\mathrm{BIC}(K)/2\}$, normalised over $K$, is an approximate posterior under a uniform prior. This needs the mixture family to contain the truth. Skewed or continuous populations are split into several components, which inflates $\hat K$.

**Silhouette.** For cell $i$, let $\alpha(i)$ be its mean distance to its own group and $\beta(i)$ the smallest mean distance to another group. Then $s(i)=\{\beta(i)-\alpha(i)\}/\max\{\alpha(i),\beta(i)\}$, and $\bar s(K)$ is the mean of $s(i)$ over cells on the partition at $K$. The scIB average silhouette width rescales this to $(\bar s+1)/2$ [R6]; the rescaling is monotone, so the argmax is unchanged. The score has no likelihood and depends on dimension and group balance.

**Agreement.** For the partition at $\hat k$ and reference labels on the same cells, let $n_{ij}$ be the shared counts and $a_i$, $b_j$ the margins. Then

$$\mathrm{ARI}=\frac{\sum_{ij}\binom{n_{ij}}{2}-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom c2}}{\tfrac12\big[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}\big]-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom c2}}$$

is chance-corrected and unclipped [R8]. It measures agreement of partitions, not the count, so it is always reported with $\hat k-k$.

**Estimands.** Each output and ground truth is defined as follows.
- $\hat k$ is an integer: for SC3 the spike count with a floor of one; for the scans, the argmax of the curve.
- The curve is $\mathrm{BIC}(K)$ (unnormalised; only differences matter), the mean silhouette $\bar s(K)\in[-1,1]$, or for SC3 the eigenvalues and $b$.
- Truth $k$ is the number of distinct labels among labelled cells of the evaluation set. Planted $k_p$ is the number of simulated groups with at least one cell.
- The deviation $\hat k-k$ is signed per repeat; the exact-match rate is the fraction of repeats with $\hat k=k$.

**Insight.** The three criteria answer different questions: whether a spike exceeds noise, whether a score improves with $K$, and whether a likelihood improves beyond a penalty. None measures the number of cell types directly. Failure modes follow from the assumptions: over-splitting of skewed populations by mixtures, under-splitting of rare groups by silhouette, and a bound null that ignores library-size and dropout effects. Whether the explicit penalty and the approximate posterior of the model-based route are calibrated is tested in section 8.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| SC3 noise-bound count | heuristic | Count eigenvalues of the standardised Gram matrix above a Tracy–Widom bound; no scan over $K$ | [R2] |
| Silhouette width scan | heuristic | Choose the $K$ that maximises the mean silhouette of a PC partition at each $K$ | [R4], [R6] |
| BIC over Gaussian mixtures | model-based | Fit mixtures for each $K$ by EM and choose the $K$ that maximises BIC | [R5] |

No single estimator is standard in the cited sources. SC3 is the only estimator in the table whose reference code computes a $k$ (section 12). Silhouette is a label-free validity score; scIB uses it for label agreement, so choosing $K$ with it repurposes it. Mixture BIC is the standard model-based selector and the route this task tests against the heuristics.

Defaults taken from code, with file and line:

| Method | Parameter | Value | Source |
|---|---|---|---|
| SC3 noise-bound count | noise-bound constant | 3.273 (comment: p = 0.001 percentile) | hemberg-lab/sc3 1.15.1, `R/CoreFunctions.R:163` |
| SC3 noise-bound count | $g$ and $c$ | $g$ = rows, $c$ = columns of the gene-filtered matrix | `R/CoreFunctions.R:155-156` |
| SC3 noise-bound count | input matrix | `logcounts`, restricted to rows where `sc3_gene_filter` is TRUE | `R/CoreFunctions.R:242-248` |
| SC3 noise-bound count | $\hat k$ reuse | stored as `k_estimation`; used as the default $k$ when none is supplied | `R/CoreMethods.R:52`, `:259-264` |
| Silhouette (scIB) | rescale | TRUE, giving $(\bar s+1)/2$ | YosefLab/scib-metrics 0.6.1, `src/scib_metrics/metrics/_silhouette.py:12`, `:38-39` |
| Silhouette (scIB) | metric | `euclidean` (`cosine` optional) | `src/scib_metrics/metrics/_silhouette.py:14` |

## 5. Proposed singlet approach

The silhouette computation is **ported** from scib-metrics under its notice. The SC3 count and the mixture fit are **reimplemented** from section 3, and the reference code is kept only as a parity target. The default is `sc3_tw`: it is the published count, needs no scan, and costs one eigenvalue solve on the smaller Gram matrix. The model-based route is `gmm_bic`, with diagonal covariance by default, several EM restarts, and BIC weights as the approximate posterior over $K$. It becomes the default only if it meets B2's calibration criterion and B1's accuracy criterion at matched cost (P1).

The gene set is the highly variable set, not SC3's gene filter, so parity is tested with the same gene set on both sides. The silhouette and the partitions at each $K$ use k-means on the PCs, a choice of this design that the reference does not make. An agent should use `sc3_tw` unless a scan is requested; the other defaults are proposed except where section 4 states them.

The EM and silhouette kernels are small and repeated over $K$, so they are hard-coded CUDA kernels on the PC matrix, with no PyTorch dependency. A learned estimator would need PyTorch and is outside the first version. Memory is $O(cK)$ for responsibilities, and no $c\times c$ matrix is formed. The silhouette takes time $O(s^2)$ on $s$ scored cells. Streaming is not claimed.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/log1p_norm | float32 | log-normalised values; the sc3_tw count is computed on the gene set |
| read | var/highly_variable | bool | gene set for sc3_tw |
| read | obsm/X_pca | float32 | principal components for gmm_bic, silhouette and the partition |
| write | uns/cluster_number_estimation/k | integer | estimated $\hat k$ |
| write | uns/cluster_number_estimation/curve | table | score by candidate $K$ (BIC and normalised weights, or mean silhouette); for sc3_tw, sorted eigenvalues and $b$ |
| write | obs/cluster_number_partition | categorical | partition at $\hat k$, when `partition` is true |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "sc3_tw" | `sc3_tw`, `gmm_bic`, `silhouette` | Estimator: sc3_tw is the default (one noise-bound count, no scan); gmm_bic and silhouette scan k_range. |
| `k_range` | object | {"min": 2, "max": 30} | — | Candidate k range for gmm_bic and silhouette; ignored by sc3_tw. |
| `k_range.min` | integer | 2 | min 1 | Smallest candidate k: at least 1 for gmm_bic, at least 2 for silhouette. |
| `k_range.max` | integer | 30 | min 2 | Largest candidate k; must be below the number of cells. |
| `n_pcs` | integer | 50 | min 2 | Principal components for gmm_bic, silhouette and the partition; the sc3_tw count uses genes. |
| `gmm_bic` | object | {"covariance": "diagonal", "n_restarts": 5} | — | Options for gmm_bic: covariance structure and EM restarts per candidate k. |
| `gmm_bic.covariance` | string | "diagonal" | `diagonal`, `full` | Covariance per component: diagonal is cheaper; full needs more cells per component. |
| `gmm_bic.n_restarts` | integer | 5 | min 1 | EM restarts per candidate k; the best log-likelihood is kept. |
| `silhouette` | object | {"metric": "euclidean", "max_cells": 10000} | — | Options for silhouette: distance metric and the number of cells scored. |
| `silhouette.metric` | string | "euclidean" | `euclidean`, `cosine` | Distance metric used for silhouette widths. |
| `silhouette.max_cells` | integer | 10000 | min 100 | Cells scored, drawn with the seed; pairwise distances grow with the square of this number. |
| `partition` | boolean | true | — | Also write a partition at k_hat: k-means on PCs, or mixture labels for gmm_bic. |
| `seed` | integer | 0 | — | Seed for EM starts, silhouette subsampling and k-means; identical inputs give identical outputs. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules: `method` decides which options apply. `k_range` and the `gmm_bic` and `silhouette` objects are read only by their methods, and `sc3_tw` ignores them. `k_range.min` must be at least 2 for `silhouette`, because its score is undefined for one group. With `dry_run` set, no member is written.

## 7. MCP tool

Tool name `singlet_clustering_cluster_number_estimation` (definition in `tasks/mcp/singlet_clustering_cluster_number_estimation.json`).

Example call:

```json
{"dataset": "data/example.singlet", "method": "gmm_bic", "k_range": {"min": 1, "max": 20}, "seed": 0}
```

Example result:

```json
{"dataset": "data/example.singlet", "status": "completed",
 "wrote": ["uns/cluster_number_estimation/k", "uns/cluster_number_estimation/curve", "obs/cluster_number_partition"],
 "summary": {"method": "gmm_bic", "k_hat": "<int>", "bound": null, "n_cells": "<int>", "n_pcs": 50},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: when the number of cells or the $K$ range is large, the call returns `queued` with a `job_id`. Stochastic: EM starts, silhouette subsampling and k-means depend on `seed`, so identical inputs give identical outputs. `dry_run` returns an `estimate` with seconds, peak memory and device, scaling with cell number, the $K$ range and `n_restarts`.

## 8. Benchmarks

Every benchmark fixes the gene set, the log-normalised values and 50 PCs unless stated, and calls each method on the same inputs. Repeats use seeds 0 to 9 (proposed). Each call records $\hat k$, the full curve and the partition at $\hat k$. Scores are $\hat k-k$ (signed and absolute), the exact-match rate and ARI at $\hat k$. Thresholds are fixed before scoring and applied identically to all methods.

### B1. Subsampled atlases with known cell-type counts

- **Goal**: score $\hat k$ against the annotated cell-type count of atlas subsamples.
- **Ground truth**: expert labels; $k$ is the number of distinct labelled types in each subsample, and the same labels give the ARI reference.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Tabula Muris, subsampled | design of [R1] | scRNA-seq, mouse; — | — | four sampling settings; $k$ from 5 to 20 |
| Tabula Sapiens, subsampled | design of [R1] | scRNA-seq, human; — | — | same design |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Deviation from $k$ | $\hat k-k$ per repeat, signed and absolute | minimise absolute | primary | [R1] |
| Exact-match rate | fraction of repeats with $\hat k=k$ | maximise | primary | [R1] |
| ARI at $\hat k$ | partition at $\hat k$ against the labels | maximise | primary | [R8], [R9] |
| Runtime and peak memory | per estimator call | minimise | guardrail | — |

- **Comparators**: `sc3_tw`, `silhouette` and `gmm_bic`.
- **Protocol**: the design of [R1], with 10 repeats per true-$k$ level. Record $k$ per repeat, since subsampling can remove rare types.
- **Acceptance criterion**: proposed, not from the literature. For the default, median $|\hat k-k|\le1$ and exact-match rate $\ge0.5$; recalibrate after a pilot.
- **Known pitfalls**: atlas labels may sit at a granularity other than the design assumes; report the annotation level.

### B2. Planted-group simulations with known $k$ (proposed)

- **Goal**: measure $\hat k$ accuracy as separation, imbalance and dropout vary, including a one-group null.
- **Ground truth**: planted simulation; $k_p$ is the number of groups with at least one cell, and each cell's label is its group.
- **Generator recipe**:
  1. Grid: $k_p$ from 1 (null) to 20; separation, imbalance and dropout levels set the Splatter settings in step 2.
  2. Simulate with `splatSimulateGroups` [R10], setting `group.prob`, `de.prob`, `de.facLoc`, `de.facScale` and `dropout.mid`.
  3. For $k_p\ge2$, a cell is separable when k-means with the true $k_p$ on the PCs reaches ARI 0.5 against the planted labels (proposed).
  4. Fix preprocessing and 50 PCs; call each method on the same gene set, with at least 10 seeds per cell.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter simulations on the grid | recipe; [R10] | simulated scRNA-seq; — | — | separation is measured in step 3 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Deviation from $k_p$ | $\lvert\hat k-k_p\rvert$ per simulation | minimise | primary | [R10] |
| ARI at $\hat k$ | partition at $\hat k$ against planted labels | maximise | primary | [R8] |
| Exact-match rate | fraction of repeats with $\hat k=k_p$, separable cells | maximise | primary | — |

- **Comparators**: `sc3_tw`, `silhouette` and `gmm_bic`.
- **Protocol**: accuracy surfaces over the grid and the null column; gene set and PCs fixed.
- **Acceptance criterion**: proposed. Exact-match rate at least 0.5 over separable cells, and $\hat k=1$ on at least 0.9 of null repeats.
- **Known pitfalls**: negative-binomial counts violate the Gaussian null by construction, so a poor score is a finding. Unseparable cells are excluded before scoring.

### B3. Annotated catalogue datasets (proposed)

- **Goal**: check $\hat k$ on catalogue data against the annotated type count at a documented level.
- **Ground truth**: expert labels. $k_a$ is the number of distinct author labels at the documented level, with unlabelled cells excluded. The catalogue holds 354M cells, about 40% with author annotations.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue, annotated subset | singlet internal catalogue | scRNA-seq; dataset count — | — | only datasets with a documented annotation level |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Deviation from $k_a$ | $\lvert\hat k-k_a\rvert$ per dataset | minimise | primary | — |
| Modal-$k$ fraction | fraction of settings (seeds 0 to 9; PC counts 30, 50 and 100) giving the most frequent $\hat k$ | maximise | guardrail | — |

- **Comparators**: `sc3_tw`, `silhouette` and `gmm_bic`.
- **Protocol**: one embedding per dataset from the default pipeline; the annotation level is reported with each result; thresholds come from B2.
- **Acceptance criterion**: proposed. Modal-$k$ fraction at least 0.8 for the default.
- **Known pitfalls**: labels produced by clustering the same embedding make agreement circular, and annotation levels differ between studies.

### P1. Performance and scaling

Wall time, peak memory and throughput at 10k, 100k and 1M cells, on CPU and CUDA, for each method, with the $K$ range fixed at 1 to 20 and 50 PCs. Silhouette is scored on `max_cells` cells (proposed default 10,000), so its time is reported separately from the cell count. Data are generated with the B2 recipe at each size. Proposed acceptance, not from the literature: the CUDA mixture fit at 1M cells is at least five times faster than the CPU fit.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
- **Feeds**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `clustering.resolution_selection`: Choosing clustering resolution without reference labels
- **Reads**: `layers/log1p_norm`, `var/highly_variable`, `obsm/X_pca`
- **Writes**: `uns/cluster_number_estimation/k`, `uns/cluster_number_estimation/curve`, `obs/cluster_number_partition`
<!-- CHAINING:AUTO:END -->

No named recipe is assigned yet. The estimate fixes the granularity of the partition task, and it can be compared with the resolution that the resolution-selection task chooses on the same embedding.

## 10. Risks, pitfalls and open questions

- **Constant and implementation.** The constant 3.273 is taken from the code comment (p = 0.001), and the code gives no source for it; the Tracy–Widom reference behind it was not read. The compiled routine that forms the Gram matrix was not read, so its normalisation rests on the comment. The bound treats genes as independent observations of standardised cells, which real counts violate; B2's null column is the first test.
- **Sources not read.** The gap statistic [R7], the consensus CDF knee and consensus stability are left out because their primary papers were not read. The k-selection steps of scCCESS, REBET and CHOIR were not read; those tools are omitted for that reason and because their licence statements are unsettled. The body of [R5] and its BIC sign convention were not read, and the method ranking of [R1] was not read, so no default is taken from it.
- **Dataset and parameter gaps.** Accessions, cell counts, subsample sizes and licences for the subsampled atlases in [R1] were not read, and the licences of the catalogue datasets were not read. The mapping from Splatter parameters to separation is measured in B2 rather than assumed.
- **First experiment.** Call the three methods on B2's null column with at least 10 seeds and the fixed embedding. If the default returns $\hat k\ge2$ on more than 10% of null repeats (proposed), it is not shipped, and the separable grid decides between the methods.

## 11. References

R1. Yu L, Cao Y, Yang JYH, Yang P. Benchmarking clustering algorithms on estimating the number of cell types from single-cell RNA-sequencing data. *Genome Biology* 2022;23:49. doi:10.1186/s13059-022-02622-0 — partial (search)
R2. Kiselev VY, Kirschner K, Schaub MT, et al. SC3: consensus clustering of single-cell RNA-seq data. *Nature Methods* 2017. doi:10.1038/nmeth.4236 — verified (corpus)
R3. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R4. Rousseeuw PJ. Silhouettes: a graphical aid to the interpretation and validation of cluster analysis. *Journal of Computational and Applied Mathematics* 1987. — unverified (memory)
R5. Scrucca L, Fop M, Murphy TB, Raftery AE. mclust 5: clustering, classification and density estimation using Gaussian finite mixture models. *The R Journal* 2016;8(1):289-317. doi:10.32614/RJ-2016-021 — partial (search)
R6. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R7. Tibshirani R, Walther G, Hastie T. Estimating the number of clusters in a data set via the gap statistic. *Journal of the Royal Statistical Society: Series B* 2001. — unverified (memory)
R8. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R9. Santos JM, Embrechts M. On the use of the adjusted Rand index as a metric for evaluating supervised classification. *ICANN 2009* (Springer LNCS). doi:10.1007/978-3-642-04277-5_18 — verified (corpus)
R10. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/hemberg-lab/sc3 | Vladimir Kiselev (DESCRIPTION Author and Maintainer) | GPL-3 (LICENSE is the GPL v3 text; DESCRIPTION `License: GPL-3`) | Noise-bound count reference (`estkTW`), version 1.15.1 | reimplement (copyleft); parity target |
| https://github.com/YosefLab/scib-metrics | Adam Gayoso (pyproject authors and maintainers) | BSD 3-Clause (LICENSE, copyright 2022 Adam Gayoso) | Silhouette computation and rescaling, version 0.6.1 | port (keep notice) |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Alicia Oshlack (authors); Christina Azodi (contributor) | GPL-3 (DESCRIPTION `GPL-3 + file LICENSE`; LICENSE is the GPL v3 text) | Simulator for B2 and P1, version 1.37.1 | callout (benchmark generator) |
