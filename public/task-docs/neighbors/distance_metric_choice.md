---
id: neighbors.distance_metric_choice
title: Distance metric for cell-cell similarity
area: neighbors
scope: core
paradigm: heuristic
literature_status: contested
priority: P1
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection]
feeds: [neighbors.neighbor_count_selection, neighbors.approximate_knn_search, neighbors.edge_weighting_adaptive_kernel, clustering.cell_partitioning]
reads: [layers/counts, X, var/highly_variable, obsm/<use_rep>, obs/<label_key>]
writes: [obsp/distances_<metric>, obsp/connectivities_<metric>, uns/neighbors_<metric>, obs/purity_<metric>, uns/metric_comparison]
devices: [cpu, cuda]
mcp_tool: singlet_neighbors_distance_metric_choice
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Distance metric for cell-cell similarity

> Choose the dissimilarity that defines cell neighbourhoods by building graphs under each candidate metric on one representation, scoring them against reference labels, and keeping Euclidean distance on PCs as the baseline until a candidate passes a stated rule.

## 1. Question

Given a representation $X\in\mathbb{R}^{n\times p}$ (log-normalised genes, analytic Pearson residuals or PC scores) and a dissimilarity $d$ from {Euclidean, cosine, Pearson, Spearman}, which $d$ gives $k$-nearest-neighbour sets whose members share the cell identity? The output is the kNN graph and its distances under the chosen $d$, plus per-metric scores against reference labels when they exist. A correct answer is a metric whose neighbour sets have higher label purity than the baseline on held-out studies, at equal $k$ and representation. No metric is correct for all data.

## 2. Why this task matters and where the field stands

Every graph-based step, including clustering, layouts, trajectory inference and kNN label transfer, starts from neighbour sets, so the metric fixes the geometry that later steps inherit [R1][R2]. The common defaults disagree. Scanpy and Seurat FindNeighbors use Euclidean distance on PCs, whereas Seurat's RunUMAP uses cosine and UMAP's own default is Euclidean [R3], so one Seurat pipeline uses two metrics (section 4).

The status is **contested**. Two comparative studies evaluate similarity metrics for scRNA-seq clustering and proximity structure. Kim et al. compare similarity metrics for clustering single-cell RNA-seq data [R4]. Watson et al. evaluate 17 proximity metrics against structural properties of scRNA-seq data and report that the best-performing metric differs between datasets [R5]. The evidence does not support one global default.

Open problems:

- No scRNA-seq benchmark isolates the metric from normalisation, centring, representation and graph construction; a factorial design is needed.
- Whether the best metric depends on sparsity, dimensionality, imbalance or rarity is raised by [R5] and has not been tested under a controlled design.
- Whether magnitude-aware or learned metrics beat Pearson or cosine on labelled data has not been shown.
- Whether analytic Pearson residuals with Euclidean distance beat log-normalised PCs under the same metric is addressed only in part by transformation comparisons [R6].

## 3. Theory and insight

### 3.1 Notation

| Symbol | Meaning |
|---|---|
| $x_i\in\mathbb{R}^p$ | representation of cell $i$: genes, residuals or PC scores |
| $\tilde x=x-\bar x\mathbf 1$ | profile centred across its own features, per cell |
| $k$ | neighbour list length counting the cell itself (Scanpy `n_neighbors`); each cell has $k-1$ other cells |
| $\mathcal N_k(i)$ | the $k-1$ nearest other cells of $i$ under $d$ |
| $y_i$, $\mathcal C$ | reference label of cell $i$; the labels with at least 10 cells |

### 3.2 Metrics and their identities

Cosine, Pearson and Spearman dissimilarities are

$$d_{\cos}(x,y)=1-\frac{x^\top y}{\lVert x\rVert\,\lVert y\rVert},\qquad d_r(x,y)=d_{\cos}(\tilde x,\tilde y),\qquad d_s(x,y)=d_r\big(\operatorname{rank}(x),\operatorname{rank}(y)\big).$$

Cosine is invariant to positive per-cell scaling. Pearson also removes an additive per-cell offset, because centring runs across the features of one cell, not across cells. Spearman is invariant to any monotone transform of each profile, and tied values, such as the many zeros of sparse data, receive midranks.

For unit vectors $\lVert u-v\rVert^2=2\,d_{\cos}(u,v)$, so Euclidean distance on L2-normalised rows orders neighbours as cosine does, up to ties. For per-cell standardised profiles $z_x=\tilde x/\sigma_x$ with $\sigma_x^2=\frac1p\sum_g\tilde x_g^2$,

$$\lVert z_x-z_y\rVert^2=2p\,d_r(x,y).$$

This is exact, from $\lVert z_x\rVert^2=p$ and $z_x^\top z_y=p\,r(x,y)$, where $r$ is the Pearson correlation. The per-cell standardisation is a different operation from the per-gene scaling applied before PCA.

Magnitude separates the metrics. $d_{\cos}(cx,y)=d_{\cos}(x,y)$ for $c>0$, whereas $\lVert cx-y\rVert^2$ changes with $c$. Euclidean distance on data where depth has not been removed can therefore rank neighbours by depth-related magnitude.

The PCA truncation is an exact identity. With $V_k$ the orthonormal loadings of the centred, scaled matrix,

$$\lVert x-y\rVert^2=\lVert V_k^\top(x-y)\rVert^2+\lVert(I-V_kV_k^\top)(x-y)\rVert^2,$$

so Euclidean distance on $k$ PCs lower-bounds full-gene Euclidean distance. The residual term is small only when the leading components carry the variance of the differences between cells. Centring a PC vector across components of unequal variance has no biological meaning, so Pearson and Spearman are applied to genes in this document.

For analytic Pearson residuals, with cell totals $n_i$, gene totals $g_j$, grand total $N$ and overdispersion $\theta$, the expected count is $\mu_{ij}=n_ig_j/N$ and

$$r_{ij}=\frac{y_{ij}-\mu_{ij}}{\sqrt{\mu_{ij}+\mu_{ij}^2/\theta}}.$$

Under the negative-binomial model these residuals have approximately unit variance when $\mu_{ij}$ is large. For small $\mu_{ij}$ they are dominated by zeros and by clipping. If each residual has mean zero and unit variance, and the residuals of two cells are independent, then $\lVert r_i-r_j\rVert^2$ has expectation about $2G$ for $G$ genes. Its distribution is not derived here.

### 3.3 A learned metric (proposal)

A linear projection $f_W(x)=Wx$ defines $d_W(x,y)=\lVert f_W(x)-f_W(y)\rVert$. Soft neighbour probabilities

$$p_{ij}=\frac{\exp\!\big(-d_W(i,j)^2\big)}{\sum_{l\neq i}\exp\!\big(-d_W(i,l)^2\big)}$$

give the objective $\mathcal L(W)=-\sum_i\sum_{j\neq i,\;y_j=y_i}p_{ij}$, plus a weight-decay term, fitted on annotated cells of training studies. A calibrated pair probability $P(y_i=y_j\mid d)=\operatorname{expit}(a\,d+b)$, with $\operatorname{expit}$ the logistic function, is fitted by Platt scaling on held-out study pairs. Its estimand is the probability that two cells share the reference label at the scored granularity, in $[0,1]$.

### 3.4 Estimands

- **Neighbour set**: the $k-1$ closest other cells under $d$, ties broken by cell index.
- **Purity of cell $i$**: $\mathrm{pur}_i=\frac{1}{k-1}\sum_{j\in\mathcal N_k(i)}\mathbf 1[y_j=y_i]$, the fraction of its other neighbours with its label, in $[0,1]$.
- **Macro purity**: $P=\frac{1}{|\mathcal C|}\sum_{c\in\mathcal C}\frac{1}{|c|}\sum_{i\in c}\mathrm{pur}_i$, so each retained class counts equally.
- **Isolation rate**: the fraction of cells with $\mathrm{pur}_i=0$.
- **ARI**: the adjusted Rand index of a partition against labels, zero at chance, one at identity and negative below chance [R7].
- **NMI**: mutual information divided by the arithmetic mean of the two entropies, in $[0,1]$.

### 3.5 Assumptions and failure modes

Identity is carried by the direction of the normalised profile, which is the premise of cosine and correlation metrics. The representation is denoised, so distances approximate gene-space distances up to the residual energy of section 3.2. Depth is normalised or the metric removes magnitude. Reference labels are reliable and nested across the granularity scored. Zero-variance features are removed, because Pearson and Spearman are undefined for them.

Failure modes by family:

- Euclidean on PCs: depth-related magnitude enters neighbourhoods unless normalisation removes it.
- Cosine and Pearson: dropout dominates sparse, low-depth profiles; zero-zero pairs create ties and inflated similarity; populations separated mainly by graded intensity can merge [R5].
- Spearman: heavy ties on zero-inflated data leave little information about small differences.
- Residuals: small $\mu_{ij}$ makes residuals sparsity-driven, and the clip sets a ceiling.
- All metrics: batch structure is not removed, so a metric can improve mixing by mixing batch rather than biology.

### 3.6 Heuristic metrics and fitted models

A magnitude-removing metric is a fixed transformation with no fitted parameter, so its neighbour sets are reproducible and transparent. A fitted model adds three things the fixed metrics lack: an objective that targets label agreement directly, per-pair probabilities calibrated on held-out studies, and a trained projection that can be reused across datasets. Its risk is circularity when training and scoring labels share one annotation process. Exact all-pairs distances cost $O(n^2p)$ through one Gram product after row normalisation or centring, and Spearman adds $O(p\log p)$ per cell for ranking.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Euclidean on PCs | heuristic | L2 distance between PC scores of scaled, highly variable genes; the default of Scanpy and Seurat FindNeighbors | [R1]; Seurat code (defaults below) |
| Cosine on PCs | heuristic | one minus cosine similarity of PC vectors; neighbour order equals Euclidean on L2-normalised PCs; the Seurat RunUMAP default | — |
| Pearson on genes (SC3) | heuristic | one minus the Pearson correlation of cell profiles across genes; SC3 applies PCA to the resulting distance matrix | [R8] |
| Spearman on genes | heuristic | Pearson distance on per-cell ranks; MetaNeighbor uses the Spearman correlation between cells as its similarity network | [R9][R8] |
| Analytic Pearson residuals then PCA | hybrid | negative-binomial Pearson residuals with overdispersion $\theta$, clipped, then PCA; a Euclidean or cosine step follows | [R10] |
| SIMLR | model-based | learns a similarity as a weighted combination of kernel matrices (multi-kernel learning, per the repository README) | [R11] |

The published standard is Euclidean distance on PCs, set as the default by Scanpy and Seurat, with cosine (Seurat RunUMAP) and the correlation measures of SC3 and MetaNeighbor as the alternatives in use. No benchmark isolates the metric factor cleanly, so these defaults are conventions. Analytic residuals change the input rather than the metric and enter as a representation option; SIMLR is the only learned similarity listed and enters as a comparator. On PCs, Pearson and Spearman centre across components and are not used as standards. Defaults and the file and line of each value follow.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| Scanpy | `metric` default | `euclidean` | src/scanpy/neighbors/\_\_init\_\_.py:188-189 @ 8ed52d9 |
| Scanpy | `n_neighbors` default | 15, counting the cell | src/scanpy/neighbors/\_\_init\_\_.py:65 @ 8ed52d9 |
| Scanpy | dense distance path | `metric` euclidean and fewer than 8192 cells, or `knn` off | src/scanpy/neighbors/\_\_init\_\_.py:680-682 @ 8ed52d9 |
| Seurat | `FindNeighbors` `annoy.metric` | `euclidean` | R/clustering.R:573 @ 5f67c70 |
| Seurat | `RunUMAP` `metric` | `cosine` | R/dimensional_reduction.R:1431 @ 5f67c70 |
| UMAP | `metric` default | `euclidean` | umap/umap\_.py:1754 @ 33d7e6f |
| Annoy | angular distance | $\sqrt{2(1-\cos(u,v))}$ for normalised vectors | README.rst:92 @ 379f744 |
| SC3 | distance set | `euclidean`, `pearson`, `spearman` | R/CoreMethods.R:302 @ 5f5161b |
| SC3 | Pearson distance | $1-\operatorname{cor}$ over columns (cells) | R/CoreFunctions.R:35-36 @ 5f5161b |
| SC3 | distance transform | `prcomp(center = TRUE, scale. = TRUE)` | R/CoreFunctions.R:59 @ 5f5161b |
| MetaNeighbor | similarity network | Spearman, $N=\operatorname{t}(Q^*)R^*$ | R/MetaNeighborUS.R:188-189 @ a0aad62 |
| Scanpy experimental | residual formula | $(y-\mu)/\sqrt{\mu+\mu^2/\theta}$ | src/scanpy/experimental/pp/\_normalization.py:76 @ 8ed52d9 |
| Scanpy experimental | `theta` default | 100 | src/scanpy/experimental/pp/\_normalization.py:95 @ 8ed52d9 |
| Scanpy experimental | `clip` default | `None`, resolved to $\sqrt{n_\text{cells}}$ | src/scanpy/experimental/pp/\_normalization.py:54-56 @ 8ed52d9 |
| OpenProblems clustering | resolution sweep | $2x/n$ for $x=1,\dots,n$ with $n=20$ | src/metrics/clustering\_performance/script.py:22-23 @ 360499d |
| OpenProblems clustering | NMI averaging | `arithmetic` | src/metrics/clustering\_performance/config.vsh.yaml:62 @ 360499d |

## 5. Proposed singlet approach

**Procedure and default.** The default is `metric: euclidean` on `representation: pca`. It reproduces the Euclidean neighbour lists of Scanpy and Seurat, so results match existing pipelines, and it is the baseline of every comparison; it is not claimed to be the best metric. A candidate replaces the default only in a versioned release, and only if it passes the B1 acceptance rule on held-out studies. Candidates are requested through `comparison.metrics`, which returns one graph per metric and the paired differences against the baseline.

**Routes.** Euclidean, cosine, Pearson and Spearman are reimplemented in the C++ core from the formulas of section 3; no code from SC3 is ported. The residual formula is ported from the scanpy implementation, with attribution (section 12). Seurat, UMAP, Annoy, MetaNeighbor and SIMLR are callouts: comparators and reference defaults only.

**Model-based position.** The learned projection of section 3.3 is a proposal and is not in the MCP enum. It would be trained on study-disjoint annotated cells with PyTorch, because the soft-neighbour objective needs automatic differentiation, and its pair probabilities would be calibrated on held-out study pairs. It is rejected if it does not beat the best fixed metric under the B1 rule; its benefit has not been shown.

**Kernels and devices.** Inference is a small, hot, dense pipeline: a blocked Gram product (cuBLAS on CUDA), row-wise top-$k$ selection and per-row normalisation. These can be hard-coded in CUDA with a fused top-$k$ reduction, with no framework dependency at inference. Spearman adds a per-cell rank transform. Leiden and scoring execute on CPU. Out-of-core operation is not claimed.

**Defaults without asking.** `metric: euclidean`, `representation: pca`, `n_neighbors: 15`, no labels, `n_pcs` from `dim-reduction.pc_number_selection`, and seed 0. Pearson and Spearman are meant for `genes_hvg`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse integer | raw UMI counts; needed by `pearson_residuals_pca` |
| read | X | float32, cells by genes | log-normalised values; needed by `genes_hvg` |
| read | var/highly_variable | boolean | gene subset for `genes_hvg` and `pearson_residuals_pca` |
| read | obsm/`use_rep` | float32, cells by dimensions | embedding for `pca` |
| read | obs/`label_key` | categorical or string | reference labels for scoring |
| write | obsp/distances_`metric` | sparse float32 | distances to the $k-1$ neighbours of each cell |
| write | obsp/connectivities_`metric` | sparse boolean | unweighted kNN adjacency, symmetrised by union |
| write | obs/purity_`metric` | float32 | per-cell purity $\mathrm{pur}_i$; only with labels |
| write | uns/neighbors_`metric` | record | metric, representation, `n_neighbors`, `n_pcs`, seed, device, library versions |
| write | uns/metric_comparison | table | macro purity, isolation rate, ARI, NMI, bootstrap intervals, differences against the baseline, dropped gene count |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Seed for Leiden partitions, bootstrap resamples and any approximate search. |
| `dry_run` | boolean | false | — | Return estimated time, peak memory, device and dense matrix size per metric without running. |
| `overwrite` | boolean | false | — | Replace existing output members with the same key instead of failing. |
| `metric` | string | "euclidean" | `euclidean`, `cosine`, `pearson`, `spearman` | Dissimilarity for the graph. euclidean matches Scanpy and Seurat FindNeighbors; cosine equals euclidean on L2-normalised rows; pearson and spearman suit genes_hvg. |
| `representation` | string | "pca" | `pca`, `pearson_residuals_pca`, `genes_hvg` | pca: obsm embedding named embedding.use_rep. pearson_residuals_pca: negative-binomial Pearson residuals, then PCA. genes_hvg: log-normalised highly variable genes. |
| `n_neighbors` | integer | 15 | min 3 | Neighbour list length counting the cell itself (Scanpy convention); each cell has n_neighbors minus one others. |
| `embedding` | object | — | — | Embedding and PCA settings for representations pca and pearson_residuals_pca. |
| `embedding.use_rep` | string | "X_pca" | — | Key of the obsm embedding (cells by dimensions) used by representation pca; it may hold a latent embedding. |
| `embedding.n_pcs` | integer/null | null | min 2 | Columns used for pca, or components computed for pearson_residuals_pca. Take it from dim-reduction.pc_number_selection; null keeps all pca columns. |
| `pearson_residuals` | object | — | — | Settings used only by representation pearson_residuals_pca. |
| `pearson_residuals.theta` | number | 100 | > 0 | Negative-binomial overdispersion of the Pearson residuals. |
| `pearson_residuals.clip` | number/null | null | min 0 | Clipping of residuals; null sets the clip to the square root of the number of cells. |
| `comparison` | object | — | — | Optional comparison of metrics on one representation. An empty metrics list builds only the single metric. |
| `comparison.metrics` | array | [] | — | Metrics built on one representation. Euclidean is always added as the paired baseline when the list is non-empty. |
| `scoring` | object | — | — | Optional reference labels and clustering settings for the scores. |
| `scoring.label_key` | string/null | null | — | obs column of reference labels; without it only the graphs are built. |
| `scoring.fixed_resolution` | number | 1.0 | > 0 | Leiden resolution for the fixed-resolution ARI and NMI. |
| `scoring.resolution_grid` | array | [] | — | Leiden resolutions for the maximum-over-sweep score; empty uses 0.1 to 2.0 in 20 steps. |
| `scoring.n_bootstrap` | integer | 1000 | min 100 | Cell-level bootstrap resamples for paired confidence intervals. |
| `scoring.ceiling_threshold` | number | 0.98 | min 0; max 1 | Baseline macro purity at or above which a dataset is excluded from ranking. |
<!-- PARAMS:AUTO:END -->

Cross-parameter rules. `embedding.use_rep` and `embedding.n_pcs` apply to `pca`; `embedding.n_pcs` also sets the number of components of `pearson_residuals_pca`, and neither applies to `genes_hvg`. `pearson_residuals` applies only to `pearson_residuals_pca`. Zero-variance genes are dropped before Pearson and Spearman, and their count is reported. `comparison.metrics` fixes one representation; to compare across representations, call once per representation and join the per-cell purities. Every score needs `scoring.label_key`; `resolution_grid` and `n_bootstrap` apply only with labels. Connectivities are unweighted; weighting belongs to neighbors.edge_weighting_adaptive_kernel.

## 7. MCP tool

Tool name `singlet_neighbors_distance_metric_choice` (definition in `tasks/mcp/singlet_neighbors_distance_metric_choice.json`). Angle-bracketed values are measured quantities.

```json
{"dataset": "atlas_subset.singlet",
 "metric": "euclidean",
 "representation": "pca",
 "embedding": {"use_rep": "X_pca", "n_pcs": 30},
 "comparison": {"metrics": ["cosine"]},
 "scoring": {"label_key": "cell_type"},
 "seed": 0}
```

```json
{"dataset": "atlas_subset.singlet", "status": "completed",
 "wrote": ["obsp/distances_euclidean", "obsp/connectivities_euclidean", "uns/neighbors_euclidean", "obs/purity_euclidean", "obsp/distances_cosine", "obsp/connectivities_cosine", "uns/neighbors_cosine", "obs/purity_cosine", "uns/metric_comparison"],
 "summary": {"metric": "euclidean", "representation": "pca", "n_neighbors": 15, "n_cells": "<int>",
  "scores": [{"metric": "<each metric>", "macro_purity": "<float>", "isolation_rate": "<float>", "ari_fixed": "<float>", "nmi_fixed": "<float>"}],
  "difference_vs_baseline": [{"metric": "cosine", "macro_purity_diff": "<float>", "ci95": ["<float>", "<float>"]}],
  "device": "<cuda or cpu>", "seconds": "<float>"},
 "provenance_id": "<id>", "job_id": null}
```

- **Long-running**: yes for large $n$ or several metrics; the call may return `queued` with a `job_id`.
- **Stochastic**: yes; `seed` fixes the Leiden partitions and bootstrap resamples, so output reproduces on the same hardware and device.
- **Dry run**: returns `seconds`, `peak_memory_gb`, `device` and the dense matrix size per metric.

## 8. Benchmarks

**Shared protocol.** Representations are built once per dataset as in `dim-reduction.normalized_cell_embedding`, with the PC count from `dim-reduction.pc_number_selection`. $k=15$ counts the cell; the seed is 0; zero-variance genes are dropped before Pearson and Spearman. Scores use labelled cells only. Within one representation all metrics share cells and settings. Paired differences are against euclidean on pca, computed per cell, with 95% percentile intervals from 1000 bootstrap resamples of cells. A dataset whose baseline macro purity is at least 0.98 is excluded from ranking.

### B1. Labelled-dataset kNN label purity (proposed)

- **Goal**: compare macro kNN label purity of five metric and representation pairs against the Euclidean-on-PCs baseline.
- **Ground truth**: expert or orthogonal labels. CellBench cells carry genotype-based demultiplexed cell-line labels [R13]; the OpenProblems resource carries `cell_type`; the catalogue subset carries author annotations, with held-out studies. The estimand per cell is $\mathrm{pur}_i$ of section 3.4, the share of its $k-1$ neighbours with its label, averaged within class and then over classes with at least 10 cells.
- **Datasets**

| Dataset | Source (reference, accession) | Modality, species, size | Notes |
|---|---|---|---|
| CellBench sc_mixology: HCC827, H1975 and H2228 lines; CEL-seq2, Drop-seq and 10x Chromium | Tian et al. [R12]; GEO GSE118767 | scRNA-seq, human cell lines; — | three-class mixture; subject to the ceiling exclusion |
| OpenProblems resource cxg_mouse_pancreas_atlas | OpenProblems dimensionality-reduction task (section 12) | scRNA-seq, mouse pancreas; — | test fixture only |
| singlet catalogue annotated subset | singlet catalogue | multi-study scRNA-seq; size to be computed | study-held-out splits |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| macro kNN label purity | section 3.4 with $k=15$; classes under 10 cells excluded; ties by cell index | maximise | primary | [R4][R5] |
| isolation rate | fraction of cells with purity 0 | minimise | guardrail | — |

- **Comparators**: euclidean on pca (baseline); cosine on pca; pearson and spearman on genes_hvg; euclidean on pearson_residuals_pca. Each representation is one tool call; per-cell purities are joined for paired differences.
- **Protocol**: the shared protocol, with three tool calls per dataset (pca, genes_hvg, pearson_residuals_pca).
- **Acceptance criterion**: proposed. A candidate is preferred if the mean paired difference in macro purity over non-ceiling datasets is at least 0.01, with a 95% interval excluding zero, and the isolation rate does not rise by more than 0.01 absolute.
- **Known pitfalls**: author labels derived by clustering on the baseline PCA favour the baseline; well-separated mixtures sit near the ceiling and compress differences.

### B2. Leiden partition agreement with reference types (OpenProblems procedure, extended)

- **Goal**: test whether a fixed Leiden procedure on each metric's graph agrees better with reference cell types.
- **Ground truth**: expert labels (`cell_type` in the OpenProblems resource; cell-line labels in CellBench). The estimands are NMI and ARI over labelled cells, as defined in section 3.4.
- **Datasets**

| Dataset | Source (reference, accession) | Modality, species, size | Notes |
|---|---|---|---|
| CellBench sc_mixology | as in B1 | as in B1 | same cells as B1 |
| OpenProblems resource cxg_mouse_pancreas_atlas | as in B1 | as in B1 | same cells as B1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| NMI | arithmetic-mean normaliser; maximum over the resolution sweep, and the value at resolution 1.0 | maximise | primary | — |
| ARI | section 3.4 on the same partitions | maximise | primary | [R7] |

- **Comparators**: the five graphs of B1.
- **Protocol**: each candidate builds its own graph with its own metric, because the OpenProblems script uses the default Euclidean graph and a cosine or Pearson candidate must not be scored on it. Leiden is repeated with seeds 0 to 4 for spread [R14]. The OpenProblems summary is the maximum NMI over 20 resolutions $2x/n$ ($n=20$, 0.1 to 2.0), reported with the ARI at that resolution; the fixed summary is resolution 1.0. Intervals follow the shared protocol.
- **Acceptance criterion**: proposed. A candidate is preferred if its fixed-resolution ARI difference against the baseline is at least 0.02, with a 95% interval excluding zero, and its maximum NMI does not fall.
- **Known pitfalls**: the OpenProblems summary takes the maximum over the sweep and reports the matching ARI, which is optimistic; ARI also depends on the number of clusters.

### B3. Planted-structure simulation (proposed)

- **Goal**: measure metric behaviour where the true groups and the library-size spread are set by the simulator.
- **Ground truth**: planted group labels returned by the simulator. The estimand is macro purity against those groups, as in section 3.4; the guardrail is the change of that purity across library-size spread.
- **Datasets**

| Dataset | Source (reference, accession) | Modality, species, size | Notes |
|---|---|---|---|
| Splatter simulations | Zappia et al. [R15] | simulated scRNA-seq; size set per setting | parameters `group.prob`, `de.prob`, `lib.scale`, `dropout.mid`, `nGenes` |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| macro purity against planted groups | section 3.4 with planted labels | maximise | primary | — |
| purity change across library-size spread | absolute change between the lowest and highest `lib.scale` | minimise | guardrail | — |

- **Comparators**: all four metrics, each on the representation of its tool call, built from un-normalised log1p counts without size-factor scaling so that depth enters the magnitude.
- **Protocol**: a factorial design over group count and balance (`group.prob`), differential-expression proportion (`de.prob`), library-size spread (`lib.scale`) and dropout midpoint (`dropout.mid`), with at least two levels per axis fixed before simulation and at least five seeds per setting. $n_\text{pcs}$ and $k$ are fixed.
- **Acceptance criterion**: proposed hypothesis. Cosine and Pearson change by at most 0.02 across `lib.scale`, and the Euclidean change exceeds both by at least 0.01; otherwise the hypothesis is rejected.
- **Known pitfalls**: simulated structure differs from real biology, so the test checks mechanism only; simulator dropout models shape how metrics compare.

### B4. Structural stratification (proposed)

- **Goal**: test whether the best metric changes with dataset structure, the question raised by [R5].
- **Ground truth**: author annotations, which are noisy, or expert labels where available, with held-out studies. The estimand is ARI within each stratum at resolution 1.0, and the rank of each metric by mean ARI across strata.
- **Datasets**

| Dataset | Source (reference, accession) | Modality, species, size | Notes |
|---|---|---|---|
| singlet catalogue annotated subset | singlet catalogue | multi-study scRNA-seq; size to be computed | study-held-out splits |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI per stratum | section 3.4 within each stratum | maximise | primary | [R7] |
| top-three count | number of strata in which a metric ranks in the top three by mean ARI | maximise | primary | — |

- **Comparators**: all four metrics, with euclidean on pca as the baseline.
- **Protocol**: strata are fixed before analysis: sparsity tertiles of the detected-gene fraction, class imbalance as the ratio of the largest to the smallest class, and rarity as the smallest class frequency. Within each stratum the B2 protocol is applied. Splits are study-held-out, so no study appears in two strata, and stratification is within study where possible.
- **Acceptance criterion**: proposed. The claim that the best metric depends on structure holds if top-three membership changes between at least two strata, with an ARI difference of at least 0.02 whose bootstrap interval excludes zero.
- **Known pitfalls**: strata computed from the scoring representation are circular; sparsity is confounded with study and platform.

### P1. Performance and scaling

Wall time and peak memory for the graph under each metric at $10^4$, $10^5$ and $10^6$ cells, on CPU and CUDA. Comparators are the Scanpy and Seurat defaults of section 4 (Scanpy neighbors with Euclidean distance, dense below 8192 cells and approximate above; Seurat FindNeighbors with Annoy Euclidean), Annoy's angular index, and a brute-force Gram path for the correlation metrics. Hold $n_\text{pcs}$, $k$, threads and hardware fixed. Report medians over repeated measurements, distance and top-$k$ times separately, and recall of exact neighbour sets for approximate backends (see neighbors.approximate_knn_search). The $10^6$ point is a plan; no dataset of that size is asserted.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
- **Feeds**:
  - `neighbors.neighbor_count_selection`: Choice of neighbour count k and graph stability
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `neighbors.edge_weighting_adaptive_kernel`: Edge weighting of kNN graphs: SNN/Jaccard, adaptive kernels and symmetrisation
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Reads**: `layers/counts`, `X`, `var/highly_variable`, `obsm/<use_rep>`, `obs/<label_key>`
- **Writes**: `obsp/distances_<metric>`, `obsp/connectivities_<metric>`, `uns/neighbors_<metric>`, `obs/purity_<metric>`, `uns/metric_comparison`
<!-- CHAINING:AUTO:END -->

Graph construction for clustering and embedding: normalisation, highly variable genes, PCA and `pc_number_selection`, then this task, then neighbour-count choice and edge weighting.

## 10. Risks, pitfalls and open questions

- **Comparative claims.** The Watson et al. [R5] statement that the best metric differs between datasets is confirmed only from a retrieved abstract summary; its metric-level results and effect sizes were not confirmed. The Kim et al. [R4] result on Pearson distance and its SIMLR modification were not confirmed and are not stated in this document. The SC3 per-metric accuracy values [R8] were not read.
- **Secondary citations.** The statement that the pipeline benchmark of Duò et al. [R16] does not isolate the metric comes from the catalogue description; its full text was not read. The transformation comparison of Ahlmann-Eltze and Huber [R6] is likewise cited from the catalogue description.
- **Labelled-data gaps.** CellBench cell counts and the demultiplexing error rate were not established from the repository. The provenance of the cxg_mouse_pancreas_atlas resource was not established; the clustering metric it is scored with lies in the task_dimensionality_reduction repository (section 12). The size of the annotated catalogue subset is not computed.
- **Code and parameters not read.** The SIMLR objective and author list were not read. Splatter parameter semantics were not checked beyond their names. Annoy has no paper in the corpus and no year is recorded.
- **Unsettled literature and the first experiment.** No benchmark isolates the metric factor, and whether the best metric depends on structure and whether a learned metric beats Pearson or cosine are open. A depth-thinning check (binomial thinning at fractions 0.5 and 0.25, with the change in B1 purity) is a candidate not published here. First experiment: confirm that euclidean on pca reproduces the Scanpy neighbour lists, then apply B1 to CellBench and the catalogue subset with the five pairs.
- **Operational risks.** The dense all-pairs distance matrix costs $O(n^2)$ memory unless it is computed blockwise. The learned projection has no measured benefit, and its training labels may be circular with the scoring labels.

## 11. References

R1. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R2. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R3. McInnes L, Healy J, Melville J. UMAP: uniform manifold approximation and projection for dimension reduction. *arXiv* 2018. doi:10.48550/arxiv.1802.03426 — verified (corpus)
R4. Kim T, Chen IR, Lin Y, Wang AY-Y, Yang JYH, Yang P. Impact of similarity metrics on single-cell RNA-seq data clustering. *Briefings in Bioinformatics* 2018 (online; volume, pages and authors not confirmed). doi:10.1093/bib/bby076 — partial (corpus)
R5. Watson ER, Mora A, Taherian Fard A, Mar JC. How does the structure of data impact cell-cell similarity? Evaluating how structural properties influence the performance of proximity metrics in single cell RNA-seq data. *Briefings in Bioinformatics* 2022;23(6):bbac387. doi:10.1093/bib/bbac387 — verified (corpus)
R6. Ahlmann-Eltze C, Huber W. Comparison of transformations for single-cell RNA-seq data. *Nature Methods* 2023. doi:10.1038/s41592-023-01814-1 — verified (corpus)
R7. Santos JM, Embrechts M. On the use of the adjusted Rand index as a metric for evaluating supervised classification. *Artificial Neural Networks - ICANN 2009* 2009. doi:10.1007/978-3-642-04277-5_18 — verified (corpus)
R8. Kiselev VY, Kirschner K, Schaub MT, et al. SC3: consensus clustering of single-cell RNA-seq data. *Nature Methods* 2017. doi:10.1038/nmeth.4236 — verified (corpus)
R9. Crow M, et al. Characterizing the replicability of cell types defined by single cell RNA-sequencing data using MetaNeighbor. *Nature Communications* 2018. doi:10.1038/s41467-018-03282-0 — verified (corpus)
R10. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)
R11. Wang B, Zhu J, Pierson E, Ramazzotti D, Batzoglou S. Visualization and analysis of single-cell RNA-seq data by kernel-based similarity learning. *Nature Methods* 2017. doi:10.1038/nmeth.4207 — verified (corpus)
R12. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R13. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018. doi:10.1038/nbt.4042 — verified (corpus)
R14. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)
R15. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R16. Duò A, Robinson MD, Soneson C. A systematic performance evaluation of clustering methods for single-cell RNA-seq data. *F1000Research* 2018. doi:10.12688/f1000research.15666.1 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | Scanpy authors (pyproject.toml); maintainers Ilan Gold, Philipp Angerer, Severin Dicks | BSD-3-Clause (LICENSE; pyproject.toml) | defaults; experimental Pearson residuals | port of the residual formula, with attribution |
| https://github.com/satijalab/seurat | Rahul Satija (author and maintainer, DESCRIPTION) | MIT with file LICENSE (DESCRIPTION) | FindNeighbors and RunUMAP defaults | callout |
| https://github.com/spotify/annoy | Erik Bernhardsson (setup.py author) | Apache-2.0 (LICENSE) | angular distance identity; approximate cosine comparator | callout |
| https://github.com/lmcinnes/umap | Leland McInnes (copyright holder) | BSD-3-Clause (LICENSE; pyproject.toml says BSD) | default metric | callout |
| https://github.com/hemberg-lab/SC3 | Vladimir Kiselev (author and maintainer, DESCRIPTION); Martin Hemberg (Authors@R) | GPL-3 (LICENSE; DESCRIPTION) | Pearson and Spearman distances; PCA of the distance matrix | reimplement the formulas of section 3; no code ported |
| https://github.com/gillislab/MetaNeighbor | Megan Crow (aut, cre) and Jesse Gillis (aut) per Authors@R; Stephan Fischer (Maintainer field) | MIT (LICENSE; DESCRIPTION) | Spearman similarity network | callout |
| https://github.com/BatzoglouLabSU/SIMLR | — | GPL-3 (LICENSE) | learned-similarity comparator | callout |
| https://github.com/openproblems-bio/task_dimensionality_reduction | Open Problems in Single-Cell Analysis | MIT (LICENSE; copyright 2024) | clustering procedure of B2 | callout |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian | MIT (LICENSE; copyright 2018) | labelled benchmark data (B1, B2) | callout |
| https://github.com/Oshlack/splatter | Luke Zappia (author and maintainer, DESCRIPTION) | GPL-3 (LICENSE text; DESCRIPTION: GPL-3 + file LICENSE) | simulator of B3 | callout |
