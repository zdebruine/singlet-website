---
id: embedding-viz.local_neighborhood_preservation
title: Local neighbourhood preservation of an embedding or reduced representation
area: embedding-viz
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection]
feeds: [embedding-viz.hyperparameter_selection, embedding-viz.embedding_stability, embedding-viz.cluster_gap_artifact_detection]
reads: [obsm/<reference> or layers/<reference>, obsm/<embedding>, obs/<waypoint_key>]
writes: [obs/nnpres_recall_k<k>_<embedding>, obs/nnpres_trust_k<k>_<embedding>, obs/nnpres_cont_k<k>_<embedding>, uns/nnpres_<embedding>]
devices: [cpu, cuda]
mcp_tool: singlet_embedding_viz_local_neighborhood_preservation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Local neighbourhood preservation of an embedding or reduced representation

> Score how well each cell's nearest neighbours in a reference representation stay nearest neighbours in a low-dimensional map, per cell and as global summaries that are corrected for chance.

## 1. Question

Given a reference representation $X$ of $n$ cells (by default the first 50 principal components of normalised expression, or the full normalised layer), a low-dimensional map $Y$ of the same cells and neighbourhood sizes $k$: how many of each cell's $k$ nearest reference neighbours remain among its $k$ nearest map neighbours, and how far outside the neighbourhood do displaced neighbours fall? The output is a score per cell and $k$, plus global summaries over the scored cells, including the chance-corrected co-ranking curve $R_{NX}$. A high score means the map is locally faithful to the reference. It says nothing about distances or densities between distant groups of cells.

## 2. Why this task matters and where the field stands

Two-dimensional maps are the default way to look at single-cell data: UMAP and t-SNE are used to judge cluster membership by eye [R5, R2]. A map that misplaces neighbours misleads every such judgement, so local faithfulness needs a quantitative check. The standard measures are trustworthiness, which penalises map neighbours that are far away in the reference, and continuity, which penalises reference neighbours that are far away in the map [R15, R16]; the co-ranking family extends both to every neighbourhood size [R17, R19, R20].

The status is **contested**. Computing the metrics is routine (scikit-learn, coRanking). Method choice is not settled. Sun et al. benchmark 18 methods on 30 scRNA-seq datasets, including neighbourhood preservation [R12]. Huang et al. compare t-SNE, art-SNE, UMAP, PaCMAP, TriMap and ForceAtlas2 on local and global structure and on sensitivity to parameters and preprocessing [R10]. Heiser and Lau score local, global and organisational structure for eleven methods and conclude that the input cell distribution and method parameters largely determine preservation [R11]. The best-practices book summarises Xiang et al. as t-SNE best overall and UMAP most stable [R13]. Verdicts depend on dataset, reference and $k$, so this task reports curves and per-cell distributions, not a winner.

Open problems:

1. Local rank metrics are blind to global structure: naive t-SNE misrepresents it and initialisation matters [R2, R3]; the support for two- and three-dimensional maps is also disputed [R4].
2. The reference defines the ground truth, and no benchmark varies it at a fixed embedding.
3. Raw values are not zero-based: a random map scores about one half on trustworthiness and continuity (section 3.1), so comparison across $n$ or $k$ needs $R_{NX}$ [R17].
4. Circularity: a method that optimises the graph used for scoring is graded on its own objective, as for UMAP on a 15-neighbour graph scored at $k=15$ [R6].

## 3. Theory and insight

**Notation.** $n$ is the number of scored cells and $d^X_{ij}$, $d^Y_{ij}$ are Euclidean distances in the reference and the map. $r_{ij}$ and $\hat r_{ij}$ are the ranks of $j$ among the other cells by $d^X_{i\cdot}$ and $d^Y_{i\cdot}$, nearest $=1$. $N^X_k(i)$ and $N^Y_k(i)$ are the $k$ nearest reference and map neighbours. $U_k(i)=N^Y_k(i)\setminus N^X_k(i)$ and $V_k(i)=N^X_k(i)\setminus N^Y_k(i)$. $k$ is the size for per-cell scores and $K$ the index along a curve. $Q_{ab}=\#\{(i,j):r_{ij}=a,\ \hat r_{ij}=b\}$ is the co-ranking matrix.

**Ties.** Under `ordinal` ranks, tied cells are ordered by cell index and every rank is an integer. Under `average`, tied cells share the mean of their positions. Neighbour sets are always cut by cell index, so $\lvert N_k\rvert=k$. Co-ranking summaries need integer ranks and always use `ordinal`.

**3.1 Trustworthiness and continuity.** The per-cell scores are

$$
T_i(k)=1-\frac{2}{k(2n-3k-1)}\sum_{j\in U_k(i)}(r_{ij}-k),\qquad
C_i(k)=1-\frac{2}{k(2n-3k-1)}\sum_{j\in V_k(i)}(\hat r_{ij}-k),
$$

and the global scores $M_T(k)$, $M_C(k)$ are their means over cells, which is the Venna and Kaski form [R15, R16]. For $k<n/2$ the normaliser equals the largest attainable sum, reached when the $k$ displaced neighbours occupy the $k$ farthest ranks, so $T_i,C_i\in[0,1]$ exactly: 1 when no neighbour is displaced, 0 in the worst case. Both implementations in the comparator set use the same normaliser below $n/2$; coRanking changes it above (section 4 defaults), and this task rejects such $k$. In scikit-learn `trustworthiness(X, X_embedded)` takes the reference first, so continuity is the same call with the arguments swapped.

*Random map.* Suppose the $k$ map neighbours are an exchangeable subset of the other cells, independent of the reference ranks. Each has reference rank uniform on $\{1,\dots,n-1\}$ and contributes $(r-k)_+$, whose mean is $(n-1-k)(n-k)/(2(n-1))$. Hence

$$
\mathbb E[M_T(k)]=\mathbb E[M_C(k)]=1-\frac{(n-1-k)(n-k)}{(n-1)(2n-3k-1)}\ \xrightarrow[n\to\infty]{}\ \tfrac12 ,
$$

which is $0.5007$ at $n=5000$, $k=15$. The expectation is exact under the stated independence. Twelve random two-dimensional maps against 50-dimensional Gaussian references at $n=3000$, $k=15$ gave $0.5012$ (standard error $0.0004$) against $0.5012$ from the formula.

**3.2 Recall and the co-ranking curve.** Per-cell recall is $R_k(i)=\lvert N^X_k(i)\cap N^Y_k(i)\rvert/k$, with $\mathbb E[R_k(i)]=k/(n-1)$ for a random map. Define $H(K)=\#\{(i,j):\max(r_{ij},\hat r_{ij})\le K\}=\sum_{a,b\le K}Q_{ab}$. Then, for integer ranks,

$$
Q_{NX}(K)=\frac{H(K)}{Kn}=\frac1n\sum_{i}R_K(i)=\bar R_K,\qquad
R_{NX}(K)=\frac{(n-1)Q_{NX}(K)-K}{n-1-K},\qquad
\mathrm{LCMC}(K)=Q_{NX}(K)-\frac{K}{n-1},
$$

with $K\le n-2$ for $R_{NX}$ [R17, R18]. Three consequences follow. Mean $K$-nearest-neighbour recall and $Q_{NX}(K)$ are one quantity, so the task computes it once. $R_{NX}$ is $\mathrm{LCMC}$ rescaled by $(n-1)/(n-1-K)$: both are zero in expectation for a random map and $R_{NX}$ is one for the identity map. And every co-ranking summary depends only on the histogram of $\max(r_{ij},\hat r_{ij})$ with $n-1$ bins, so the $n\times n$ matrix $Q$ is never stored. The Open Problems summaries are $\mathrm{AUC}=\frac1{n-1}\sum_{K}Q_{NX}(K)$, the local quality (mean of $Q_{NX}$ for $K\le K^\star$) and the global quality (mean for $K>K^\star$), where $K^\star$ is the first $\arg\max_K\mathrm{LCMC}(K)$ [R23]. LCMC is negative for maps worse than chance.

**3.3 Triplet accuracy.** For an anchor $i$ and a pair $(j,l)$, a triplet is correctly ordered when $\operatorname{sgn}(d^X_{ij}-d^X_{il})=\operatorname{sgn}(d^Y_{ij}-d^Y_{il})$. $A_T$ is the fraction of correctly ordered sampled triplets, equal to $\tfrac12$ for a random map. The PaCMAP evaluation code draws five random pairs per anchor, uniformly with replacement from all cells [R9]. That is the global stratum here. This task also draws a local stratum, with $j\in N^X_k(i)$ and $l\notin N^X_k(i)$, and excludes triplets with equal reference distances and reports their count.

**3.4 What the embeddings optimise.** t-SNE minimises $\mathrm{KL}(P\Vert Q)$ between Gaussian input affinities with bandwidths set by perplexity, $p_{ij}=(p_{j\mid i}+p_{i\mid j})/2n$, and Student-t output affinities $q_{ij}\propto(1+\lVert y_i-y_j\rVert^2)^{-1}$ [R1]. UMAP minimises a cross-entropy between a fuzzy neighbour graph $\mu_{ij}$ and output memberships $\nu_{ij}=(1+a\lVert y_i-y_j\rVert^{2b})^{-1}$ [R6]; densMAP adds a density-correlation term [R7]. PaCMAP optimises neighbour, mid-near and further pairs, using mid-near pairs first to capture global structure and then refining local structure [R9]; TriMap optimises weighted triplet constraints [R8]. PHATE embeds a diffusion potential with metric MDS [R14]. PCA is the best rank-two linear least-squares projection. Local attraction preserves neighbourhoods but no part of these objectives fixes large-scale distances, which is why initialisation matters [R3, R21].

**3.5 Heuristic and model-based.** The scores are deterministic functions of two rank orders, with no fitted parameters and no uncertainty for an individual cell. The model-based additions of section 5 do not change any score; they predict the per-cell overlap $h_i=kR_k(i)\in\{0,\dots,k\}$ from local geometry, with predictive intervals, and give dataset-level credible intervals. The published scores stay as comparators and as the acceptance reference.

**3.6 Pitfalls.** Local metrics ignore global distortion [R2, R4]. Results move with perplexity, $n_{\text{neighbors}}$ and `min_dist`, whose defaults differ between the scanpy wrapper and umap-learn (section 4 defaults) [R10]. Libraries tie-break differently: coRanking's compiled path uses `std::sort`, which is not stable, while its R path ranks by position, and scikit-learn uses `np.argsort`. scikit-learn allocates several $n\times n$ arrays (distances, argsort indices and an inverted index), about 20 GB each at $n=50{,}000$ for 8-byte entries. OpenProblems scores 50,000 waypoints while cellstruct uses 10,000, so the two are different quantities. The exact pass costs $O(n^2(d+\log n))$ time and $O(nd+n\lvert k\rvert)$ memory when streamed by row.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Trustworthiness and continuity | heuristic | Rank penalties for map neighbours far away in the reference, and reference neighbours far away in the map | [R15, R16] |
| kNN recall, $Q_{NX}$, LCMC, $R_{NX}$ | heuristic | Neighbour-set overlap and its curve over $K$ from the co-ranking matrix, with chance correction | [R17, R18, R19, R20] |
| Triplet accuracy | heuristic | Fraction of sampled triplets whose distance order is kept | [R9] |
| cellstruct (GS, LS, GC) | heuristic | Correlation of cell-cell distances over waypoints (GS), ratio of mean squared distances of reference and map neighbours from the target cell, measured in the reference (LS), correlation of cluster-centroid distances (GC) | [R22] |
| t-SNE (scanpy, scikit-learn backend) | model-based | KL divergence between Gaussian input and Student-t output affinities | [R1, R2] |
| UMAP (umap-learn) | model-based | Cross-entropy between a fuzzy kNN graph and output memberships, with negative sampling | [R6, R5] |
| densMAP (`densmap=True`) | model-based | UMAP objective plus a density-correlation term | [R7] |
| PaCMAP | model-based | Loss over neighbour, mid-near and further pairs | [R9] |
| TriMap (scanpy wrapper) | model-based | Weighted triplet constraints sampled from the high-dimensional data | [R8] |
| PHATE | model-based | Diffusion potential from an alpha-decay kernel, embedded by metric MDS | [R14] |
| PCA (two components) | model-based | Rank-two least-squares projection onto the top variance directions | [R23] |

**Published standard.** Trustworthiness and continuity [R15, R16] with the co-ranking summaries [R17, R19] as implemented in coRanking [R20]. The Open Problems task fixes a concrete protocol: Euclidean distances on the normalised layer of at most 50,000 waypoints and the metrics at $K=30$ [R23]. The standard comparators for embeddings are the default t-SNE and UMAP settings of scanpy and umap-learn [R1, R6].

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| Open Problems | waypoints | 50,000; all cells if fewer, else `np.random.seed(0)` and `np.random.choice` without replacement | `src/data_processors/process_dataset/script.py:34-42` @ 360499d |
| Open Problems | reference distances | Euclidean on `layers["normalized"]`, all features | `process_dataset/script.py:46-50` @ 360499d |
| Open Problems | map distances | Euclidean on `obsm["X_emb"]` of the waypoints | `src/data_processors/process_embedding/script.py:27-29` @ 360499d |
| Open Problems co-ranking | metrics | $k=30$; `kmax = which.max(lcmc)`; `qnx_auc = mean(qnx)`; local and global means split at `kmax` | `src/metrics/coranking/script.R:39-61` @ 360499d |
| Open Problems co-ranking | NaN rule | all seven metrics set to 0 if any embedding distance is NaN | `script.R:20-27` @ 360499d |
| Open Problems trustworthiness | status | disabled; value taken from the co-ranking metric | `src/metrics/trustworthiness/config.vsh.yaml:8` @ 360499d |
| Open Problems t-SNE, UMAP, densMAP, PHATE | PCA dimensions | 50 | `src/methods/tsne/script.py:8`, `umap/script.py:9`, `densmap/script.py:9`, `phate/script.py:8` @ 360499d |
| Open Problems densMAP | call | `UMAP(densmap=True, random_state=42)` | `src/methods/densmap/script.py:34` @ 360499d |
| coRanking | normaliser | $N K(2N-3K-1)$ for $K<N/2$, else $N(N-K)(N-K-1)$ | `R/criteria.R:2-3` @ 4b26431 |
| coRanking | tie ranking | R path `ties.method="first"`; compiled path `std::sort` (default `use="C"`) | `R/coranking_internals.R:24`, `src/coranking.cpp:47`, `R/rankmatrix.R:21` @ 4b26431 |
| scikit-learn trustworthiness | `n_neighbors` | 5; error if `n_neighbors >= n_samples / 2` | `sklearn/manifold/_t_sne.py:454, 521` @ 85593ca |
| t-SNE (scanpy) | perplexity, early exaggeration, learning rate | 30, 12, 1000 | `src/scanpy/tools/_tsne.py:31, 33, 34` @ 8ed52d9 |
| UMAP (umap-learn) | `n_neighbors`, `min_dist`, `init`, `learning_rate`, `negative_sample_rate` | 15, 0.1, spectral, 1.0, 5 | `umap/umap_.py:1752, 1761, 1760, 1759, 1768` @ 33d7e6f |
| UMAP (scanpy) | `min_dist` | 0.5 | `src/scanpy/tools/_umap.py:37` @ 8ed52d9 |
| densMAP (umap-learn) | `densmap`, `dens_lambda`, `dens_frac` | False, 2.0, 0.3 | `umap/umap_.py:1784-1786` @ 33d7e6f |
| PaCMAP | `n_neighbors`, `MN_ratio`, `FP_ratio` | 10, 0.5, 2.0 | `README.md:142, 144, 146` @ 2e7237a |
| TriMap (scanpy wrapper) | `n_inliers`, `n_outliers`, `n_random`, `weight_adj` | 10, 5, 5, 500 | `src/scanpy/external/tl/_trimap.py:33-35, 37` @ 8ed52d9 |
| PHATE | `knn`, `decay`, `n_landmark`, `t`, `gamma`, `n_pca`, `mds` | 5, 40, 2000, auto, 1, 100, metric | `Python/phate/phate.py:190-195, 200` @ 65a1f73 |
| cellstruct | waypoint cells for GS | 10,000 | `README.md:24` @ 9058e8f |

## 5. Proposed singlet approach

**Paradigm.** The scores are deterministic and parameter-free once reference, map and $k$ are fixed, so singlet reports them as published and keeps the published implementations as comparators. The model-based layer is optional and alters no score.

**Routes.** Scoring kernels (trustworthiness, continuity, per-cell recall, co-ranking, triplets) are a new design in the C++ core, written from the published definitions [R15, R17, R19] and streamed by row; coRanking is reimplemented, not ported. scikit-learn, coRanking and the PaCMAP evaluation code are numerical oracles (B2). The Open Problems protocol specifies B1. cellstruct and the embedding methods are callouts; embedding methods belong to the embedding tasks.

**Model-based layer (proposed).** (1) A per-cell predictor of the overlap $h_i=kR_k(i)$, $h_i\mid\phi_i\sim\mathrm{BetaBinomial}(k,\alpha(\phi_i),\beta(\phi_i))$, with $\phi_i$ the local features of map and reference (distance to the $k$-th neighbour in each space and their ratio, mutual map neighbours, a local intrinsic-dimension estimate, the $k$-occurrence count). A small multilayer perceptron in PyTorch outputs $\alpha,\beta$, fitted by maximum likelihood one $k$ at a time because overlaps at different $k$ are nested. It attaches calibrated intervals to cells outside a waypoint sample. (2) A hierarchical beta-binomial over datasets with a shared hyperprior gives credible intervals for dataset-level recall. Training pairs are subsamples of singlet's catalogue of 354M uniformly processed cells with maps from the embedding tasks; author annotations are unused. B3 falsifies the layer.

**Kernels and scale.** Distance tiles are GEMM products (cuBLAS; float32 with a float64 CPU reference on a sample); each row is sorted and inverted to ranks; the histogram of $\max(r,\hat r)$ and per-cell sums accumulate per row block (CUDA scatter-add); overlap counts use sparse products (cuSPARSE). Only the predictor is trained in PyTorch, then exported to the C++ core; the exact kernels are small and hot. Streaming keeps memory at $O(nd+n\lvert k\rvert)$; above `sample.max_cells` the rank-based scores use the waypoint sample. Defaults are the generated defaults of section 6.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/`reference.key` or layers/`reference.key` | float, cells by features | Reference representation, no missing values, same cells in the same order as the map |
| read | obsm/`embedding` | float, cells by at least 2 | The map to score |
| read | obs/`sample.waypoint_key` | boolean | Optional explicit scored set |
| write | obs/nnpres_recall_k`k`_`embedding` | float32, scored cells; NaN elsewhere | $R_k(i)$ for each requested $k$ |
| write | obs/nnpres_trust_k`k`_`embedding` | float32, scored cells; NaN elsewhere | $T_i(k)$ |
| write | obs/nnpres_cont_k`k`_`embedding` | float32, scored cells; NaN elsewhere | $C_i(k)$ |
| write | uns/nnpres_`embedding` | dictionary | Parameters, resolved defaults, curves and summaries, tie counts, timings, seed |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `embedding` | string | required | — | Key in obsm of the map to score, with at least two columns. |
| `reference` | object | — | — | Reference representation whose Euclidean neighbours are the ground truth. |
| `reference.kind` | string | "obsm" | `obsm`, `layer` | Whether key names an obsm matrix or a layer. A layer uses all its features. |
| `reference.key` | string | "X_pca" | — | Name of the obsm key or layer, on the same cells in the same order as the map. |
| `reference.n_components` | integer | 50 | min 2 | Leading components used when kind is obsm; ignored for layers. |
| `k` | array | [5, 10, 15, 30, 50, 100] | — | Neighbourhood sizes for per-cell scores and curve summaries. Values at or above half the scored cells are skipped and listed in summary.k_skipped. |
| `scores` | array | ["knn_recall", "trustworthiness_continuity", "coranking"] | — | Score families to compute. triplets is computed only when requested. |
| `sample` | object | — | — | Scored set for rank-based scores. |
| `sample.max_cells` | integer | 50000 | min 2 | Datasets with more cells are scored on a seeded uniform sample of this size. |
| `sample.waypoint_key` | string/null | null | — | Obs key of a boolean mask giving the scored cells, for example is_waypoint. Overrides sampling. |
| `trustworthiness_continuity` | object | — | — | Options for trustworthiness and continuity. |
| `trustworthiness_continuity.tie_rule` | string | "average" | `average`, `ordinal` | average gives tied distances their mean rank; ordinal breaks ties by cell index. Co-ranking always uses ordinal. |
| `triplets` | object | — | — | Options for triplet accuracy. |
| `triplets.n_triplets` | integer | 1000000 | min 1000 | Number of sampled triplets, split equally between local and global strata. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for the scored-set sample and the triplet sample. |
| `dry_run` | boolean | false | — | Return estimated time, memory, device and scored-set size without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters. `scores` selects the outputs: `knn_recall` writes the recall arrays and `summary.mean_recall`, `trustworthiness_continuity` the trust and continuity arrays, `coranking` the curves, `triplets` the triplet summary. `trustworthiness_continuity.tie_rule` applies to trust and continuity only; `triplets.n_triplets` only to `triplets`. `reference.n_components` is ignored for layer references and the summary records that. A `k` at or above half the scored cells is skipped and listed. `seed` controls the sample when `sample.waypoint_key` is null and the triplets. A map with missing values is refused. Only Euclidean distance is supported. Embedding hyperparameters belong to the task that produced the map.

## 7. MCP tool

Tool name `singlet_embedding_viz_local_neighborhood_preservation` (definition in `tasks/mcp/singlet_embedding_viz_local_neighborhood_preservation.json`; the keys of `summary` are listed in its output schema).

```json
{
  "dataset": "data/example.singlet",
  "embedding": "X_umap",
  "reference": {"kind": "obsm", "key": "X_pca", "n_components": 50},
  "k": [15, 30],
  "scores": ["trustworthiness_continuity", "coranking"]
}
```

```json
{
  "dataset": "data/example.singlet", "status": "completed",
  "wrote": ["obs/nnpres_trust_k15_X_umap", "obs/nnpres_cont_k15_X_umap", "uns/nnpres_X_umap"],
  "summary": {
    "n_scored": "<int>", "scored_scope": "waypoints",
    "trustworthiness": {"15": "<float>", "30": "<float>"},
    "continuity": {"15": "<float>", "30": "<float>"},
    "coranking": {"qnx": {"30": "<float>"}, "lcmc": {"30": "<float>"}, "kmax_lcmc": "<int>", "qnx_auc": "<float>", "qlocal": "<float>", "qglobal": "<float>"}
  },
  "provenance_id": "<id>"
}
```

Long-running: yes; the dry-run estimate states whether the call completes inline or is queued. Stochastic: yes, through `seed`, for the scored-set sample and the triplets. Dry-run estimate: `seconds`, `peak_memory_gb`, `device`, `n_scored`, `scored_scope`.

## 8. Benchmarks

**Shared protocol.** Maps are scored against a Euclidean reference on the scored set: all cells when $n\le50{,}000$, otherwise the Open Problems waypoint rule. Co-ranking ranks use `ordinal` ties. Acceptance checks use float64; throughput measurements use float32. Reported values are means over seeds with the range. *Recipe G1 (planted geometry):* for seeds 0 to 9 and $n\in\{2000,5000\}$ draw scikit-learn `make_swiss_roll` and `make_s_curve` (three-dimensional reference) and `make_blobs` with 10 centres and 50 features (50-dimensional reference); record seed and arguments. *Recipe G2 (catalogue subsample):* draw cells uniformly from singlet's 354M-cell catalogue, take 50 principal components from `dim-reduction.normalized_cell_embedding` as the reference, and record sample size and catalogue identifiers.

### B1. Open Problems dimensionality-reduction protocol (published)

- **Goal**: reproduce the co-ranking metrics of the Open Problems dimensionality-reduction task [R23] with singlet kernels, before any ranking of methods is trusted.
- **Ground truth**: consistency with the high-dimensional reference. The reference distances are Euclidean on the `normalized` layer of the waypoint cells, and each metric is the coRanking value computed on the same two distance matrices (defaults table, section 4). The metrics are rank fractions in $[0,1]$ except LCMC, which can be negative.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_mouse_pancreas_atlas (test resource) | `s3://openproblems-data/resources_test/task_dimensionality_reduction/cxg_mouse_pancreas_atlas/` [R23] | single-cell expression, mouse pancreas atlas; — | — | `dataset.h5ad` with `layers["normalized"]`; embeddings from the task's methods |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| $M_T(30)$, $M_C(30)$ | section 3.1 on the waypoints | higher | primary | [R15, R16] |
| $Q_{NX}(30)$, $\mathrm{LCMC}(30)$ | section 3.2; $Q_{NX}(30)$ equals mean 30-neighbour recall | higher | primary | [R17, R18] |
| `qnx_auc`, `qlocal`, `qglobal` | means of $Q_{NX}(K)$ over all $K$, $K\le K^\star$, $K>K^\star$ | higher | primary | [R19, R23] |

- **Comparators**: coRanking on the same waypoint distances (oracle); embeddings from the PCA, t-SNE, UMAP, densMAP and PHATE methods of the task at their own settings, plus its control methods `true_features`, `spectral_features` and `random_features`.
- **Protocol**: build the waypoint mask as the task does and pass it as `sample.waypoint_key`; use `reference.kind` `layer` with the task's `normalized` layer; set `k` to include 30, `ordinal` ties and float64. Count rows of both distance matrices that contain ties before comparing.
- **Acceptance criterion** (proposed): on tie-free rows singlet equals the coRanking values for all seven metrics to within $10^{-9}$. With ties, the discrepancy and the tied-row count are reported.
- **Known pitfalls**: scores depend on the waypoint sample, so the same mask is required. The task reports 0 for every metric when any embedding distance is NaN (defaults table); singlet refuses such a map.

### B2. Metric calibration on planted geometry (proposed)

- **Goal**: confirm that the kernels satisfy the closed forms of section 3 and agree with independent implementations.
- **Ground truth**: planted maps with known answers. Identity map: every score equals 1. Random map: $\mathbb E[M_T]=\mathbb E[M_C]$ from section 3.1, $\mathbb E[\bar R_k]=k/(n-1)$, $\mathbb E[R_{NX}]=0$, $A_T=\tfrac12$. Noisy maps: scores fall as noise grows. Oracle values come from scikit-learn ($M_T=$`trustworthiness(X, Y)`, $M_C=$`trustworthiness(Y, X)`), coRanking (`coranking(X, Y)`; $M_T$, $M_C$, $Q_{NX}$, LCMC) and the PaCMAP random-triplet evaluation.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Swiss roll and S-curve | recipe G1 | synthetic; $n\in\{2000,5000\}$, 10 seeds | — | three-dimensional reference |
| Ten-cluster Gaussian mixture | recipe G1 | synthetic; $n\in\{2000,5000\}$, 10 seeds | — | 50-dimensional reference |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| $M_T(k)$, $M_C(k)$, $T_i(k)$ | section 3.1 | higher | primary | [R15, R16] |
| $\bar R_k$, $R_{NX}(k)$ | section 3.2 | higher | primary | [R17] |
| $A_T$ (all, local, global) | section 3.3 | higher | guardrail | [R9] |

- **Comparators**: scikit-learn `trustworthiness`, coRanking, PaCMAP `random_triplet_eval` (oracles).
- **Protocol**: maps are the identity, a standard-normal two-dimensional random map, PCA, t-SNE and UMAP at their library defaults (section 4), each with Gaussian noise of $\sigma\in\{0,0.1,0.3,1\}$ times the map standard deviation; $k\in\{5,15,30\}$; $n\le5000$ so every cell is scored.
- **Acceptance criterion** (proposed): identity scores equal 1 within $10^{-9}$. For random maps at $n=5000$, $k=15$, the 10-seed mean $M_T$ is within 0.005 of $0.5007$ and the mean $R_{NX}$ within 0.002 of 0. Singlet agrees with scikit-learn and coRanking on $M_T$, $M_C$, $Q_{NX}$ and LCMC within $10^{-6}$ for $n\le2000$. The global $A_T$ at $10^6$ triplets is within 0.01 of the mean of 10 repeats of the PaCMAP code. Mean scores fall monotonically with $\sigma$ at every $k$.
- **Known pitfalls**: scikit-learn requires $k<n/2$ and does not document its tie order, so oracle comparisons use continuous planted data. The PaCMAP code does not exclude tied triplets.

### B3. Calibration of the overlap predictor (proposed)

- **Goal**: test whether the model-based layer of section 5 gives calibrated per-cell intervals and a better point estimate than a per-map mean.
- **Ground truth**: the exact overlap $h_i=kR_k(i)\in\{0,\dots,k\}$ at $k=15$ from the exact pass against the 50-component reference. Recall is $h_i/k\in[0,1]$.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue subsamples (recipe G2) | singlet catalogue | scRNA-seq; 40 samples of 5,000 cells from distinct studies | per source | held out by study in 5 folds |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Interval coverage | fraction of held-out cells with $h_i$ inside the nominal 90% predictive interval | target 0.90 | primary | — |
| Mean absolute error | $\lvert\hat R_k(i)-R_k(i)\rvert$ averaged over held-out cells | lower | primary | — |
| Hierarchical coverage | fraction of held-out cells inside the 95% posterior predictive interval | target 0.95 | guardrail | — |

- **Comparators**: the per-map mean recall computed from the held-out labels (a deliberately strong baseline) and a beta-binomial with constant parameters.
- **Protocol**: each sample is embedded by PCA, t-SNE (perplexity 10, 30, 100) and UMAP (`n_neighbors` 5, 15, 50); all maps of a sample stay in one fold; five seeds for the predictor.
- **Acceptance criterion** (proposed): pooled coverage of the 90% interval between 0.85 and 0.95; mean absolute error below the baseline for at least 80% of held-out maps; at most 10% of held-out cells outside the 95% interval of the hierarchical model.
- **Known pitfalls**: maps of one sample share a reference, so folds must be split by sample. Subsamples of 5,000 cells have coarser neighbourhoods than the full study.

### P1. Performance and scaling (proposed)

- **Goal**: wall time, peak memory and throughput of the default score families against the comparators.
- **Datasets**: recipe G1 blobs at $n=10^4$, $5\times10^4$, $2\times10^5$ and $10^6$, and G2 subsamples at the same sizes. For $n>5\times10^4$ the rank-based scores use the 50,000-cell sample, so those sizes measure the sampling path.

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Wall time | median and interquartile range of three repeats after one warm-up call, build and score separately | lower | primary | — |
| Throughput | $n$ divided by the median total time | higher | primary | — |
| Peak memory | peak resident memory in GB | lower | guardrail | — |

- **Comparators**: scikit-learn `trustworthiness` (up to $n=2\times10^4$), the coRanking path of the Open Problems script, and singlet on CPU and on CUDA. Hold fixed: $k=15$, Euclidean distance, 50-component PCA reference, seed 0, thread count; record CPU model, core count, GPU model and memory.
- **Acceptance criterion** (proposed): at $n=5\times10^4$ the default score families finish with peak memory below 4 GB on both devices, singlet CPU at $n=2\times10^4$ is at least 5 times faster than scikit-learn plus coRanking on the same hardware, and CUDA is at least 10 times faster than singlet CPU at $n=5\times10^4$.
- **Known pitfalls**: synthetic data have no biological structure, so timings do not depend on biology. First calls include compilation, which the warm-up absorbs.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
- **Feeds**:
  - `embedding-viz.hyperparameter_selection`: Selection of perplexity, neighbour count, min_dist and initialization
  - `embedding-viz.embedding_stability`: Embedding stability across seeds, subsamples and hyperparameters
  - `embedding-viz.cluster_gap_artifact_detection`: Detection of artefactual clusters, gaps and distances in a 2D map
- **Reads**: `obsm/<reference> or layers/<reference>`, `obsm/<embedding>`, `obs/<waypoint_key>`
- **Writes**: `obs/nnpres_recall_k<k>_<embedding>`, `obs/nnpres_trust_k<k>_<embedding>`, `obs/nnpres_cont_k<k>_<embedding>`, `uns/nnpres_<embedding>`
<!-- CHAINING:AUTO:END -->

Belongs to the embedding workflow: normalise, select genes, PCA, choose components, embed, score here, then select hyperparameters or check stability. Pair with the global-structure and density tasks.

## 10. Risks, pitfalls and open questions

- **Sources read.** Records for the method papers [R1, R6, R7, R8, R14] and for [R10, R11, R12, R13] were matched against bibliographic records only; the findings attributed to [R10, R11, R12, R13] come from abstracts and from the best-practices book, and the triplet measure of [R9] was read from the PaCMAP evaluation code, not the paper. Method-ranking benchmarks after Sun et al., Huang et al. and Heiser and Lau cannot be specified (datasets, metric definitions, thresholds) until those papers are read, so they are not benchmarks here. The Open Problems benchmark dataset list, sizes and licences are not listed in the task repository.
- **Ties and range.** The compiled coRanking path orders tied cells arbitrarily, so exact agreement is guaranteed on tie-free rows only. LCMC can be negative although the Open Problems configuration declares the range 0 to 1, and reported values are not clipped.
- **Unmeasured effects.** Effect of the reference choice (components, genes, layer), of the waypoint sample size on neighbourhood scale, of hubness on per-cell scores (a hypothesis), and of seed variation in t-SNE and UMAP.
- **Predictor.** Untrained; training-set size and composition are not fixed, and the thresholds of B3 and P1 are proposals. The 5-fold design assumes at least 40 catalogue studies suitable for 5,000-cell subsamples.
- **Atlas scale.** All-cell neighbour sets at millions of cells need an approximate-neighbour path (`neighbors.approximate_knn_search`); boundary effects of a sharded neighbour build are unmeasured.
- **First experiment.** Implement the row pass and the histogram, reproduce coRanking on the Open Problems test resource (B1), then run the random-map check at $n=5000$, $k=15$ (B2) before ranking embeddings.

## 11. References

R1. van der Maaten L, Hinton G. Visualizing data using t-SNE. *Journal of Machine Learning Research* 2008;9:2579–2605. http://jmlr.org/papers/v9/vandermaaten08a.html — verified (corpus)

R2. Kobak D, Berens P. The art of using t-SNE for single-cell transcriptomics. *Nature Communications* 2019;10:5416. doi:10.1038/s41467-019-13056-x — verified (corpus)

R3. Kobak D, Linderman GC. Initialization is critical for preserving global data structure in both t-SNE and UMAP. *Nature Biotechnology* 2021;39:156–157. doi:10.1038/s41587-020-00809-z — verified (corpus)

R4. Chari T, Pachter L. The specious art of single-cell genomics. *PLOS Computational Biology* 2023;19:e1011288. doi:10.1371/journal.pcbi.1011288 — verified (corpus)

R5. Becht E, McInnes L, Healy J, Dutertre CA, Kwok IWH, Ng LG, Ginhoux F, Newell EW. Dimensionality reduction for visualizing single-cell data using UMAP. *Nature Biotechnology* 2019;37:38–44. doi:10.1038/nbt.4314 — verified (corpus)

R6. McInnes L, Healy J, Melville J. UMAP: Uniform manifold approximation and projection for dimension reduction. *arXiv* 2018. doi:10.48550/arxiv.1802.03426 — verified (corpus)

R7. Narayan A, Berger B, Cho H. Assessing single-cell transcriptomic variability through density-preserving data visualization. *Nature Biotechnology* 2021;39:765–774. doi:10.1038/s41587-020-00801-7 — verified (corpus)

R8. Amid E, Warmuth MK. TriMap: Large-scale dimensionality reduction using triplets. *arXiv* 2019. doi:10.48550/arxiv.1910.00204 — verified (corpus)

R9. Wang Y, Huang H, Rudin C, Shaposhnik Y. Understanding how dimension reduction tools work: an empirical approach to deciphering t-SNE, UMAP, TriMap, and PaCMAP for data visualization. *Journal of Machine Learning Research* 2021;22(201):1–73. http://jmlr.org/papers/v22/20-1061.html — verified (repo)

R10. Huang H, Wang Y, Rudin C, Browne EP. Towards a comprehensive evaluation of dimension reduction methods for transcriptomic data visualization. *Communications Biology* 2022;5:719. doi:10.1038/s42003-022-03628-x — verified (search)

R11. Heiser CN, Lau KS. A quantitative framework for evaluating single-cell data structure preservation by dimensionality reduction techniques. *Cell Reports* 2020;31:107576. doi:10.1016/j.celrep.2020.107576 — verified (search)

R12. Sun S, Zhu J, Ma Y, Zhou X. Accuracy, robustness and scalability of dimensionality reduction methods for single-cell RNA-seq analysis. *Genome Biology* 2019;20:269. doi:10.1186/s13059-019-1898-6 — verified (search)

R13. Xiang R, Wang W, Yang L, Wang S, Xu C, Chen X. A comparison for dimensionality reduction methods of single-cell RNA-seq data. *Frontiers in Genetics* 2021;12. doi:10.3389/fgene.2021.646936 — verified (corpus)

R14. Moon KR, van Dijk D, Wang Z, Gigante S, Burkhardt DB, Chen WS, Yim K, van den Elzen A, Hirn MJ, Coifman RR, Ivanova NB, Wolf G, Krishnaswamy S. Visualizing structure and transitions in high-dimensional biological data. *Nature Biotechnology* 2019;37:1482–1492. doi:10.1038/s41587-019-0336-3 — verified (corpus)

R15. Venna J, Kaski S. Neighborhood preservation in nonlinear projection methods: an experimental study. *Artificial Neural Networks (ICANN 2001)* 2001:485–491. doi:10.1007/3-540-44668-0_68 — verified (corpus)

R16. Venna J, Kaski S. Local multidimensional scaling. *Neural Networks* 2006;19:889–899. doi:10.1016/j.neunet.2006.05.014 — verified (corpus)

R17. Lee JA, Verleysen M. Quality assessment of dimensionality reduction: rank-based criteria. *Neurocomputing* 2009;72:1431–1443. doi:10.1016/j.neucom.2008.12.017 — verified (corpus)

R18. Chen L, Buja A. Local multidimensional scaling for nonlinear dimension reduction, graph drawing, and proximity analysis. *Journal of the American Statistical Association* 2009;104:209–219. doi:10.1198/jasa.2009.0111 — verified (corpus)

R19. Lueks W, Mokbel B, Biehl M, Hammer B. How to evaluate dimensionality reduction? Improving the co-ranking matrix. *arXiv* 2011. doi:10.48550/arxiv.1110.3917 — verified (corpus)

R20. Kraemer G, Reichstein M, Mahecha MD. dimRed and coRanking: unifying dimensionality reduction in R. *The R Journal* 2018;10:342. doi:10.32614/rj-2018-039 — verified (corpus)

R21. Böhm JN, Berens P, Kobak D. Attraction-repulsion spectrum in neighbor embeddings. *Journal of Machine Learning Research* 2022;23(95):1–32. — verified (corpus)

R22. cellstruct: metrics scores to quantify the biological preservation between two embeddings. *bioRxiv* preprint. doi:10.1101/2023.11.13.566337 — partial (corpus)

R23. Open Problems in Single-Cell Analysis. Dimensionality reduction for visualization (task_dimensionality_reduction). GitHub repository, commit 360499d. https://github.com/openproblems-bio/task_dimensionality_reduction — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | maintainers Ilan Gold, Philipp Angerer, Severin Dicks; authors listed in pyproject.toml | BSD-3-Clause (LICENSE; pyproject.toml) | t-SNE, UMAP and TriMap wrappers; source of comparator defaults | callout |
| https://github.com/lmcinnes/umap | Leland McInnes (LICENSE copyright line) | BSD-3-Clause (LICENSE.txt) | UMAP and densMAP comparator | callout |
| https://github.com/hhcho/densvis | Ashwinn Narayan and Hoon Cho (LICENSE copyright line) | MIT (LICENSE) | densMAP reference repository | callout |
| https://github.com/YingfanWang/PaCMAP | Yingfan Wang, Haiyang Huang, Cynthia Rudin, Yaron Shaposhnik (pyproject.toml) | Apache-2.0 (LICENSE; pyproject.toml) | PaCMAP comparator; random-triplet evaluation code | callout |
| https://github.com/eamid/trimap | — | Apache-2.0 (LICENSE) | TriMap comparator | callout |
| https://github.com/KrishnaswamyLab/PHATE | Daniel Burkhardt, Krishnaswamy Lab, Yale University; maintainers João Felipe Rocha, Matthew Scicluna (Python/pyproject.toml) | LICENSE.md is a Yale non-commercial licence; Python/pyproject.toml states GNU General Public License Version 2 | PHATE comparator | callout only; the licence texts conflict |
| https://github.com/scikit-learn/scikit-learn | The scikit-learn developers (COPYING) | BSD-3-Clause (COPYING; pyproject.toml) | trustworthiness oracle; comparator in B2 and P1 | callout |
| https://github.com/gdkrmr/coRanking | Guido Kraemer (DESCRIPTION) | GPL-3 \| file LICENSE (DESCRIPTION; LICENSE is GNU GPL version 3) | co-ranking oracle in B1 and B2 | reimplement from the published definitions |
| https://github.com/openproblems-bio/task_dimensionality_reduction | Open Problems in Single-Cell Analysis (LICENSE copyright line) | MIT (LICENSE) | waypoint protocol and metric configuration for B1 | reimplement the waypoint protocol; the metric script is not ported because it calls coRanking |
| https://github.com/the-ouyang-lab/cellstruct | Jui Wan Loh and John Ouyang (README); DESCRIPTION lists Jui Wan | GPL-3 (DESCRIPTION); LICENSE is GNU GPL version 3 | related metrics (GS, LS, GC) | callout |

No public code was identified for the stratified triplet accuracy of section 3.3 beyond the PaCMAP evaluation code.
