---
id: embedding-viz.large_scale_embedding
title: Embedding of very large datasets
area: embedding-viz
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.scalable_truncated_svd, neighbors.approximate_knn_search]
feeds: [embedding-viz.local_neighborhood_preservation, embedding-viz.embedding_stability, embedding-viz.out_of_sample_placement]
reads: [obsm/<representation>]
writes: [obsm/X_<method>, obsp/knn_<backend>_k<k>, uns/emb_<method>/params, uns/emb_<method>/timing, uns/emb_<method>/kl_approx]
devices: [cpu, cuda]
mcp_tool: singlet_embedding_viz_large_scale_embedding
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Embedding of very large datasets

> Compute a two-dimensional map of $10^5$ to $10^7$ cells within a fixed memory budget by approximating the neighbour graph and the repulsive force, and measure how far the map departs from the exact method on subsamples where that method can be computed.

## 1. Question

Can a two-dimensional map of $10^5$ to $10^7$ cells be computed in practical time and memory while keeping the neighbourhoods of the exact or full-data method? Input: a PCA matrix $X\in\mathbb{R}^{N\times d}$ (default $d=50$) with a time and memory budget, optionally a GPU. Output: coordinates $Y\in\mathbb{R}^{N\times 2}$, stage timings, peak memory and the stored affinity count. A correct answer means that the measured cost follows the complexity of the chosen algorithm and that local neighbourhoods agree with the exact method wherever it can be computed (section 8).

## 2. Why this task matters and where the field stands

Atlases routinely exceed $10^5$ cells, and exact neighbour embedding costs $O(N^2)$ per iteration (section 3). Two families now serve as default visualisations. t-SNE-type methods minimise a Kullback–Leibler divergence [R1]; FIt-SNE [R2] and openTSNE [R3] accelerate the repulsive term by interpolation onto a grid. UMAP fits a fuzzy graph layout [R4] and has been applied to single-cell visualisation [R5].

The status is **contested**. Wall-clock cost is no longer the main obstacle for the mainstream implementations, but three points remain disputed.

1. Global arrangement depends largely on initialisation, not only on the method family [R6]. Neighbourhood scores cannot see this.
2. Cluster sizes and the distances between clusters in both kinds of map carry weak meaning [R7, R8]. Quantitative frameworks for structure preservation exist [R9].
3. Defaults differ across libraries for learning rate, minimum distance and epochs. The FIt-SNE README cites Belkina et al. for learning-rate advice on large datasets [R10]. Comparisons are meaningful only when the settings are fixed explicitly (section 4).

No accepted fidelity benchmark exists at million-cell scale, so fidelity there is extrapolated from subsamples (section 8).

## 3. Theory and insight

**Neighbour affinities and the t-SNE objective.** The input affinity is a Gaussian kernel on the $k$ nearest neighbours of each cell, with bandwidth $\sigma_i$ chosen so that $2^{H(P_i)}$ equals the perplexity:

$$p_{j\mid i}=\frac{\exp\!\left(-\lVert x_i-x_j\rVert^2/2\sigma_i^2\right)}{\sum_{l\ne i}\exp\!\left(-\lVert x_i-x_l\rVert^2/2\sigma_i^2\right)},\qquad p_{ij}=\frac{p_{j\mid i}+p_{i\mid j}}{2N},$$

with $k=\min(N-1,\lfloor 3\cdot\text{perplexity}\rfloor)$. The $p_{ij}$ sum to one over ordered pairs. The map affinity is a Student-t kernel with one degree of freedom, $q_{ij}=w_{ij}/Z$ with $w_{ij}=(1+\lVert y_i-y_j\rVert^2)^{-1}$ and $Z=\sum_{k\ne l}w_{kl}$. The method minimises $C=\mathrm{KL}(P\Vert Q)$ in nats [R1]. The gradient splits into an attractive part over the sparse graph and a repulsive part over all pairs:

$$\frac{\partial C}{\partial y_i}=\underbrace{4\sum_{j\in\mathcal N_k(i)}p_{ij}\,w_{ij}(y_i-y_j)}_{\text{attraction, }O(Nk)}-\underbrace{\frac{4}{Z}\sum_{j\ne i}w_{ij}^2\,(y_i-y_j)}_{\text{repulsion, exact }O(N^2)}.$$

Barnes–Hut [R11] replaces distant groups of repulsive terms by tree cells selected with an opening angle $\theta$, giving $O(N\log N)$ per iteration. The FFT scheme interpolates the kernel onto $M$ grid intervals with Lagrange nodes and evaluates the grid convolution with an FFT [R2]; its cost is near-linear for a fixed grid. Interpolation is valid when the kernel is smooth on the grid spacing. The grid grows with the spread of the map, so a spread map costs more time and memory.

**Schedule.** Early exaggeration multiplies $p_{ij}$ by $\alpha$ for the first iterations (defaults in section 4). Because $p_{ij}=O(1/N)$, the attractive step per point is $O(k/N)$, so the learning rate must scale with $N$ to keep steps of order one. The argument holds where the kernel weights $w_{ij}$ are close to one. The openTSNE rule $\eta=N/\text{exaggeration}$ is a heuristic, not an optimum, and other libraries choose differently (section 4).

**UMAP.** UMAP builds memberships $\mu_{ij}=\exp(-(d_{ij}-\rho_i)/\sigma_i)$ on a kNN graph. The bandwidth $\sigma_i$ is fitted so that each row sums to $\log_2 k$. Memberships are symmetrised by fuzzy union, $\mu_{ij}+\mu_{ji}-\mu_{ij}\mu_{ji}$. The map kernel is $\nu_{ij}=(1+a\lVert y_i-y_j\rVert^{2b})^{-1}$, with $(a,b)$ fitted to the spread and minimum distance [R4]. The layout minimises cross-entropy over edges, with negatively sampled non-edges:

$$\mathcal L=\sum_{(i,j)\in E}\left[\mu_{ij}\log\frac{\mu_{ij}}{\nu_{ij}}+(1-\mu_{ij})\log\frac{1-\mu_{ij}}{1-\nu_{ij}}\right].$$

No global normaliser appears, so UMAP fits an edge model rather than matching two distributions. Its layout depends on the epoch count, which is 500 for $N\le 10^4$ and 200 otherwise. Stochastic gradient descent with negative sampling approximates the full sum; the approximation is exact only in expectation.

**Separable costs and errors.** Scalability has three components: the neighbour graph (backend and parameters), the repulsion approximation (Barnes–Hut, FFT or negative sampling), and the schedule. Fidelity has two independent error sources. An approximate graph changes $P$ before any optimisation, and an approximate repulsion changes every gradient step. Replacing one component at a time with its exact counterpart on subsamples isolates each error.

**Estimands.** Each output is defined as follows.

- $Y$ estimates the local optimum reached from the stated initialisation under the stated schedule. Coordinates have arbitrary units, and only within-map neighbourhoods are interpretable.
- Neighbour recall at $k$ is the fraction of each cell's $k$ exact neighbours that the approximate graph keeps, averaged over cells, so it lies in $[0,1]$.
- The approximate KL is $\sum p\log(p/q)$ in nats with $P$ taken from the approximate graph. It is not comparable across backends.
- The exact-$P$ KL uses $P$ recomputed from exact neighbours on the same $k$, normalised over ordered pairs, with $Q$ from the candidate map.
- Timing is wall-clock seconds per stage. Peak memory is the maximum resident set in GB, sampled every 100 ms.
- The stored affinity count is $\mathrm{nnz}(P)$ after symmetrisation.

**Memory.** A dense $P$ has $N^2$ entries, which is $10^{10}$ at $N=10^5$ and about 80 GB at 8 bytes per entry. The sparse symmetric $P$ has $Nk\le\mathrm{nnz}(P)\le 2Nk$ entries. With $k=90$ (perplexity 30) and $N=10^7$ this gives $9\times10^8$ to $1.8\times10^9$ entries, or 10.8 to 21.6 GB at 12 bytes per in-memory entry (a 4-byte column index and an 8-byte value).

**Assumptions and failure modes.**

- Restricting $P$ to $k$ neighbours is accurate only if the Gaussian mass lies on the nearest $3\times$perplexity cells.
- Low kNN recall in high intrinsic dimension or with hubness changes $P$ with no visible error.
- Barnes–Hut with a large $\theta$ misestimates repulsion. The FFT path loses accuracy with a coarse grid or a spread map.
- Defaults that depend on $N$ create discontinuities at the thresholds listed in section 4.

**Insight.** The t-SNE objective is an explicit divergence between two distributions over pairs, so the error of its gradient approximation can be measured against the objective itself. UMAP's objective is a fitted edge model. Approximate neighbour backends are heuristic, but their recall is a random quantity that can be modelled from cheap statistics of the data (section 5). Standard large-scale methods give no calibrated uncertainty for map positions. The practical substitutes are seed and subsample spread.

## 4. Methods landscape

The reference implementations are openTSNE and FIt-SNE for neighbour embeddings and umap-learn for UMAP [R2, R3, R4]. Pynndescent is the standard approximate neighbour search for UMAP [R12]. Methods are included only where their code or primary paper was read, and the omitted ones are listed in section 10. FIt-SNE is kept as a comparator and a reimplementation target.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| FIt-SNE | model-based | t-SNE objective with FFT-interpolated repulsion and Annoy input neighbours | [R2] |
| openTSNE | model-based | Modular t-SNE with FFT or Barnes–Hut repulsion, PCA initialisation and placement of new cells | [R3] |
| umap-learn | hybrid | Fuzzy graph from a kNN search, then SGD on cross-entropy with negative sampling | [R4] |
| pynndescent | heuristic | Neighbour descent that refines a random-projection-tree graph | [R12] |
| Annoy | heuristic | Random-projection forest; accuracy set by trees at build and search_k at query | — |
| hnswlib | heuristic | Layered small-world graph; recall set by degree M and query breadth ef | [R13] |
| TriMap | heuristic | Triplet constraints from nearest, outlier and random pairs | [R14] |
| GPU UMAP (cuML) | hybrid | UMAP layout on GPU, exposed through rapids-singlecell | [R15] |
| tsne-cuda | model-based | CUDA t-SNE; its README describes an optimised CUDA version of the FIt-SNE algorithm | [R16] |
| Subsample then place | model-based | Embed a subsample, then place each other cell against the fixed map | [R3] |

The defaults that matter for comparison are listed below. Each value is read from the cited line at the pinned commit.

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| openTSNE | perplexity | 30 | tsne.py:1144 @ c2a8b28 |
| openTSNE | learning_rate | auto = N / exaggeration; exaggeration 1, so N | tsne.py:92-97 @ c2a8b28 |
| openTSNE | early exaggeration | auto: 12, or max(12, exaggeration) if set | tsne.py:1174-1180 @ c2a8b28 |
| openTSNE | early_exaggeration_iter; n_iter | 250; 500 | tsne.py:1146, 1148 @ c2a8b28 |
| openTSNE | theta; dof | 0.5; 1 | tsne.py:1151, 1150 @ c2a8b28 |
| openTSNE | n_interpolation_points; min_num_intervals | 3; 50 | tsne.py:1152-1153 @ c2a8b28 |
| openTSNE | initialization; max_step_norm | pca; 5 | tsne.py:1155, 1161 @ c2a8b28 |
| openTSNE | negative_gradient_method | bh if N < 10,000, else fft | tsne.py:48-58 @ c2a8b28 |
| openTSNE | input neighbours k | min(N − 1, int(3 × perplexity)) | affinity.py:177-178 @ c2a8b28 |
| openTSNE | perplexity above k | lowered to k/3 | affinity.py:355-360 @ c2a8b28 |
| openTSNE | neighbour method | exact below 1,000 cells; otherwise Annoy (pynndescent if installed and input sparse or metric non-standard) | affinity.py:386-409 @ c2a8b28 |
| openTSNE | Annoy trees | 50 | nearest_neighbors.py:291 @ c2a8b28 |
| openTSNE transform | perplexity; k; learning_rate | 5; 25; 0.1 | tsne.py:700-707 @ c2a8b28 |
| openTSNE transform | early exaggeration; its iterations; exaggeration; n_iter | 4; 0; 1.5; 250 | tsne.py:700-707 @ c2a8b28 |
| FIt-SNE | perplexity; theta; max_iter | 30; 0.5; 750 | fast_tsne.py:22, 21, 24 @ 47ff14f |
| FIt-SNE | stop_early_exag_iter; early_exag_coeff | 250; 12 | fast_tsne.py:25, 34 @ 47ff14f |
| FIt-SNE | learning_rate | auto = max(200, N / early_exag_coeff) | fast_tsne.py:178 @ 47ff14f |
| FIt-SNE | nterms; min_num_intervals; df | 3; 50; 1 | fast_tsne.py:40-47 @ 47ff14f |
| umap-learn | n_neighbors; min_dist; spread | 15; 0.1; 1.0 | umap/umap_.py:1752, 1761, 1762 @ 33d7e6f |
| umap-learn | learning_rate; init | 1.0; spectral | umap_.py:1759-1760 @ 33d7e6f |
| umap-learn | negative_sample_rate; set_op_mix_ratio | 5; 1.0 | umap_.py:1768, 1765 @ 33d7e6f |
| umap-learn | n_epochs | 500 if N ≤ 10,000, else 200 | umap_.py:1136-1145 @ 33d7e6f |
| umap-learn | exact neighbours | below 4,096 samples unless forced | umap_.py:2654-2655 @ 33d7e6f |
| pynndescent | n_neighbors; n_trees; n_iters | 30; max(3, min(12, round(2 log10 N))); max(5, round(log2 N)) | pynndescent_.py:982, 1010, 1012 @ 05e62e3 |
| hnswlib | M; ef_construction; random_seed | 16; 200; 100 | README.md:75 @ ca42672 |
| TriMap | n_inliers; n_outliers; n_random | 12; 4; 3 | README.rst:80, 82, 84 @ 3d1bf1e |
| rapids-singlecell | t-SNE perplexity; early exaggeration; learning_rate | 30; 12; 200 | src/rapids_singlecell/tools/_tsne.py:32-34 @ e110792 |
| rapids-singlecell | UMAP min_dist; negative_sample_rate; epochs | 0.5; 5; 500 if N ≤ 10,000, else 200 | src/rapids_singlecell/tools/_umap.py:64, 69, 191 @ e110792 |
| scanpy | t-SNE learning_rate; UMAP min_dist | 1000; 0.5 | src/scanpy/tools/_tsne.py:34; _umap.py:37 @ 8ed52d9 |

## 5. Proposed singlet approach

**Routes.** *Port* (permissive licences; section 12): openTSNE's affinity computation, Barnes–Hut and FFT repulsion, PCA initialisation and placement; umap-learn's fuzzy graph, spectral initialisation and layout; pynndescent and Annoy. *Reimplement* from the paper: FIt-SNE. *Callout* (benchmark comparator only, never vendored): tsne-cuda, hnswlib, TriMap, cuML and rapids-singlecell, and scanpy.

**Model-based formulation.** Three components are proposed, each falsifiable.

1. *Default layout.* The openTSNE objective, $\mathrm{KL}(P\Vert Q)$ with kNN-restricted $P$ and FFT repulsion, is kept because its approximation error is an error on a stated gradient, which B1 measures. Falsified if FFT-path recall at 15 falls below the exact-gradient reference by more than the B1 margin.
2. *Calibrated neighbour-backend choice.* A small predictor maps cheap statistics (N, d, PCA spectrum, sampled neighbour distances, intrinsic dimension, backend and $k$) to expected recall at $k$. It is fitted on catalogue subsamples with exact neighbours, with split-conformal intervals. It is falsified if nominal 90% intervals cover less than 90% of held-out subsamples, or if it does not beat the default backend's constant recall.
3. *Amortised placement* (later stage). A PyTorch MLP trained on a subsample map (parametric t-SNE [R17]) places each new cell in constant time; falsified if it fails B2.

**ML stack.** PyTorch trains the predictor and placement network, which are small. The embedding loop uses hand-written CUDA for its small, regular, memory-bound kernels: CSR attraction (cuSPARSE or a custom kernel), cuFFT grid convolution for repulsion, and tiled GEMM for exact neighbours. The dependency-free CPU C++ core is the default.

**Streaming, memory and determinism.** Neighbour queries are chunked, but the optimisation holds $Y$ (O(N)) and $P$ (O(Nk)), so the method is not streaming. `memory_budget_gb` is checked against section 3 before any work. Seeds fix subsampling and negative sampling; multithreaded updates and GPU reductions can change low-order bits, so reproducibility is measured against a tolerance (P1).

**Defaults for an agent.** Method `opentsne_fft` with the section 6 defaults. Initialise from the PCA scaled to standard deviation $10^{-4}$, as the FIt-SNE README suggests following Kobak and Berens [R8]. For UMAP, use the umap-learn defaults with spectral initialisation.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/<representation> | float32, N × d | PCA of normalised expression; default X_pca with d = 50 |
| write | obsm/X_<method> | float32, N × 2 | map coordinates, one column per axis |
| write | obsp/knn_<backend>_k<k> | sparse float32 | neighbour graph with distances, cached for reuse |
| write | uns/emb_<method>/params | dictionary | resolved parameters, seed and package versions |
| write | uns/emb_<method>/timing | dictionary | seconds per stage, peak memory and stored affinity count |
| write | uns/emb_<method>/kl_approx | float | t-SNE family only; KL from the approximate $P$, not comparable across backends |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `representation` | string | "X_pca" | — | obsm key of the input representation, normally 50 principal components of normalised expression. |
| `method` | string | "opentsne_fft" | `opentsne_fft`, `opentsne_bh`, `umap_cpu`, `subsample_project` | Embedding method. opentsne_fft is the default; opentsne_bh suits small inputs; umap_cpu computes UMAP; subsample_project places cells on a subsample map. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for subsampling, approximate neighbour construction and negative sampling. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `knn` | object | — | — | Neighbour graph settings shared by all methods; omit for method defaults. |
| `knn.backend` | string | "auto" | `auto`, `exact`, `annoy`, `pynndescent` | auto: exact below 1,000 cells (t-SNE) or 4,096 (UMAP), otherwise Annoy (t-SNE) or pynndescent (UMAP). |
| `knn.k` | integer | — | min 2 | Neighbours per cell; default is 3 x perplexity for t-SNE and 15 for UMAP. |
| `knn.annoy_n_trees` | integer | 50 | min 1 | Trees in the Annoy forest; more trees raise recall and memory. |
| `opentsne` | object | — | — | t-SNE optimisation settings for opentsne_fft, opentsne_bh and subsample_project. |
| `opentsne.perplexity` | number | 30 | min 1 | Effective neighbours for the input affinity; neighbour count k is 3 x perplexity. |
| `opentsne.learning_rate` | number/string | "auto" | — | Gradient step size; auto is N divided by exaggeration, which equals N by default. |
| `opentsne.early_exaggeration` | number | 12 | min 1 | Attraction multiplier during the early phase. |
| `opentsne.early_exaggeration_iter` | integer | 250 | min 0 | Iterations in the early exaggeration phase. |
| `opentsne.n_iter` | integer | 750 | min 1 | Iterations after the early phase; 750 matches the openTSNE benchmark schedule. |
| `opentsne.theta` | number | 0.5 | min 0 | Barnes-Hut opening angle; used only by opentsne_bh. |
| `opentsne.n_interpolation_points` | integer | 3 | min 1 | Lagrange nodes per grid interval; used only by opentsne_fft. |
| `opentsne.min_num_intervals` | integer | 50 | min 1 | Minimum number of grid intervals; used only by opentsne_fft. |
| `opentsne.dof` | number | 1 | min 0.1 | Degrees of freedom of the Student-t map kernel. |
| `opentsne.initialization` | string | "pca" | `pca`, `random` | Initial map coordinates. |
| `umap` | object | — | — | UMAP settings for umap_cpu. |
| `umap.min_dist` | number | 0.1 | min 0 | Minimum distance in the map; 0.1 is the umap-learn default and differs from some wrappers. |
| `umap.spread` | number | 1 | min 0 | Scale of the map kernel, fitted together with min_dist. |
| `umap.n_epochs` | integer/null | null | min 1 | Optimisation epochs; null uses 500 for N up to 10,000, otherwise 200. |
| `umap.negative_sample_rate` | integer | 5 | min 1 | Negative samples per positive edge. |
| `umap.init` | string | "spectral" | `spectral`, `random` | Initial map coordinates. |
| `subsample` | object | — | — | subsample_project embeds a subsample with opentsne_fft, then places all other cells on that map. |
| `subsample.n` | integer | 50000 | min 1000 | Cells embedded with the full method before placing the rest; a design choice. |
| `subsample.transform_perplexity` | number | 5 | min 1 | Perplexity used when placing each cell on the fixed map. |
| `subsample.transform_k` | integer | 25 | min 2 | Reference neighbours used when placing each cell. |
| `subsample.transform_n_iter` | integer | 250 | min 1 | Optimisation iterations when placing each cell. |
| `memory_budget_gb` | number/null | null | min 0 | Fail before any work if the estimated peak memory exceeds this many GB; null disables the check. |
<!-- PARAMS:AUTO:END -->

The t-SNE options apply to `opentsne_fft`, `opentsne_bh` and `subsample_project`; the UMAP options apply to `umap_cpu`; the subsample options apply only to `subsample_project`. The FFT options are ignored by the Barnes–Hut path and `theta` is ignored by the FFT path. The method refuses to start when the perplexity is at least $k$ or when $N\le k+1$. It does not lower the perplexity silently, unlike openTSNE (section 4). Specify `learning_rate` explicitly when comparing with other tools, because libraries differ.

## 7. MCP tool

Tool `singlet_embedding_viz_large_scale_embedding` (definition in `tasks/mcp/singlet_embedding_viz_large_scale_embedding.json`). An example call and a compact result, with placeholders where a value depends on the data:

```json
{"dataset": "atlas.singlet", "method": "opentsne_fft", "seed": 0}
```

```json
{"dataset": "atlas.singlet", "status": "completed",
 "wrote": ["obsm/X_opentsne_fft", "obsp/knn_annoy_k90", "uns/emb_opentsne_fft/params", "uns/emb_opentsne_fft/timing", "uns/emb_opentsne_fft/kl_approx"],
 "summary": {"n_cells": "<int>", "method": "opentsne_fft", "knn_backend": "annoy", "k": 90, "seconds_knn": "<float>", "seconds_gradient": "<float>", "seconds_total": "<float>", "peak_rss_gb": "<float>", "nnz_P": "<int>", "knn_recall_sample": "<float>", "kl_approx": "<float>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: when the estimate exceeds the interactive limit, the tool returns `status` `queued` with a `job_id`. Stochastic: the output is fixed by `seed` up to thread-level rounding, and repeated calls with `overwrite` are not bit-identical. Dry run: `dry_run` returns seconds, peak memory and device without writing members.

## 8. Benchmarks

**Shared protocol.** The input is 50 principal components of log-CP10k counts (50 components follow the openTSNE benchmarks; the OpenProblems task supplies the normalised matrix). T-SNE-family methods use perplexity 30 (so $k=90$), PCA initialisation, a learning rate of $N$, early exaggeration 12 for 250 iterations, then 750 iterations. Use five seeds per method and size, each drawing a new subsample. Fix thread counts and report hardware. Report medians with interquartile ranges, never single measurements.

### B1. Exact-reference neighbourhood fidelity on subsamples

- **Goal**: measure how closely a scalable map reproduces exact-map neighbourhoods on those cells, with and without swapping in one exact component.
- **Ground truth**: consistency with an exact reference: t-SNE with full pairwise affinities and exact gradient (scikit-learn `TSNE(method="exact")`) on the same cells. Its optimiser differs from openTSNE's, so disagreement mixes algorithmic and approximation effects. Per-cell label: the $k$ nearest reference-map neighbours.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Macosko et al. 2015, mouse retina | [R18]; file at http://file.biolab.si/opentsne/benchmark/macosko_2015.pkl.gz | scRNA-seq, mouse retina, 44,808 cells | — | 50 features and cell-type keys |
| singlet catalogue subsamples (proposed) | singlet catalogue, 354M cells | scRNA-seq; 5,000 and 10,000 cells | — | stratified by tissue and platform |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| kNN recall at 15 and 30 | Share of each cell's $k$ reference-map neighbours kept among its $k$ candidate-map neighbours (Euclidean; ties by index), averaged | maximise | primary | — |
| Trustworthiness and continuity at 15 | Venna–Kaski measures; reference map as input | maximise | guardrail | [R19, R24] |
| KL with exact $P$ | $\sum p\log(p/q)$ in nats; $P$ from exact $k$-NN, normalised over ordered pairs; $Q$ from the candidate | minimise | guardrail | [R1] |

- **Comparators**: openTSNE FFT and Barnes–Hut; FIt-SNE defaults; umap-learn defaults and exact neighbours below 4,096 cells; scanpy defaults; tsne-cuda; GPU UMAP through rapids-singlecell with minimum distance 0.1 (its default is 0.5); PCA to two components.
- **Protocol**: sizes 5,000 and 10,000 (exact-reference cost limits sizes; section 3). Five seeds, each drawing a subsample; the reference's seed spread is the noise floor.
- **Acceptance** (proposed): candidate median recall at 15 is at least the reference's seed-to-seed median minus 0.05; trustworthiness at 15 lies within 0.02 of the reference's seed-to-seed spread; KL with exact $P$ is at most 0.05 nats above the reference's.
- **Known pitfalls**: a shared input or bias is invisible here; the reference is a fidelity target, not ground truth. Local recall cannot see global arrangement.

### B2. Out-of-sample placement fidelity (proposed)

- **Goal**: check that cells placed on a fixed map reproduce the neighbourhoods of a joint embedding of all cells.
- **Ground truth**: consistency with a joint embedding of all cells by the same method and settings. The joint map is a target, not a unique truth, because adding cells changes it. The per-cell label is the 15 nearest reference cells on the joint map; recall is taken among reference cells only.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Macosko et al. 2015 (as in B1) | [R18] | 44,808 cells; 10% (4,481) held out | — | reference pool of 40,327 cells, subsampled to 10,000 and also used whole |
| singlet catalogue subsamples (proposed) | singlet catalogue | reference of 50,000 cells; 5,000 query cells | — | batch-stratified queries |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recall at 15 for query cells | Per query, the overlap between its 15 nearest reference cells on the joint map and in the placed position, averaged over queries | maximise | primary | — |
| Placement displacement | Median distance between placed and joint positions after a similarity Procrustes fit on reference cells, divided by the reference map's RMS radius | minimise | guardrail | — |

- **Comparators**: the openTSNE transform with its defaults (section 4) and a tuned variant reported separately; umap-learn transform; inverse-distance regression over the positions of reference neighbours (heuristic baseline).
- **Protocol**: five seeds; PCA-50 of log-CP10k; the same perplexity and $k$ as the reference map; a batch-stratified held-out test.
- **Acceptance** (proposed): median query recall at 15 is at least 0.7 and at least 0.05 above the regression baseline.
- **Known pitfalls**: placed cells collapse onto dense reference regions when the placement learning rate or iteration count is too small. Batch or technical shifts move held-out cells systematically, so the stratified test is required.

### B3. Approximate neighbour recall at scale (proposed)

- **Goal**: test whether approximate neighbour backends reproduce exact neighbours at $10^5$ to $10^6$ cells in 50 dimensions.
- **Ground truth**: the exact $k$ nearest neighbours by brute-force tiled distance computation on the identical matrix, with ties broken by lower index and each cell excluded from its own list. Per-cell recall is $|\text{approx}\cap\text{exact}|/k$, averaged over cells.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue PCA-50 subsets (proposed) | singlet catalogue | scRNA-seq; $10^5$ and $10^6$ cells | — | retains real density and hubness |
| Synthetic control (proposed; recipe below) | generated | 50 dimensions; $10^5$ and $10^6$ cells; three seeds | — | design constants, not literature values |

Recipe for the synthetic control: (1) draw $M=100$ centres $c_m\sim\mathcal N(0,25\,I_{50})$; (2) for each cell, draw $m$ uniformly and set $x=c_m+\epsilon$ with $\epsilon\sim\mathcal N(0,I_{50})$; (3) repeat for $N\in\{10^5,10^6\}$ with three seeds.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recall at 15 and 90 | Mean per-cell recall as defined above, for $k=15$ and $k=90$ | maximise | primary | [R12, R13] |
| Build and query cost | Wall-clock seconds to build the index and to query all cells; peak memory in GB | minimise | guardrail | — |

- **Comparators**: pynndescent with $n_\text{neighbors}$ of 15 and 90 and otherwise defaults; Annoy with 50 trees; hnswlib with M = 16 and ef_construction = 200, with the query breadth recorded for each measurement; exact brute force as the reference.
- **Protocol**: three repetitions per backend and size; threads fixed; parameters stated for each backend; queries over all cells.
- **Acceptance** (proposed): default-setting recall at 15 is at least 0.95 for pynndescent and hnswlib up to $10^6$ cells, and recall at 90 is at least 0.90.
- **Known pitfalls**: the synthetic control overstates recall on real data with hubness and uneven density, which is why catalogue subsets are included. Duplicated cells create ties in the exact list, so the tie rule above matters.

### B4. OpenProblems metric panel (published metrics)

- **Goal**: score each two-dimensional map against the high-dimensional expression with the OpenProblems dimensionality-reduction metrics, as a general fidelity panel.
- **Ground truth**: consistency with the input expression (log-CP10k). Each metric compares neighbourhoods or diffusion distances between the input and the map, and no labels are used. Co-ranking and trustworthiness scores lie in $[0,1]$; correlation scores lie in $[-1,1]$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B1 subsamples (Macosko; catalogue) | as in B1 | scRNA-seq; 5,000 and 10,000 cells | — | co-ranking needs all pairwise distances, so larger sizes are excluded |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Continuity, trustworthiness, QNX and LCMC at 30; QNX AUC | Co-ranking measures between log-CP10k and the map at $k=30$ | maximise | primary | [R19, R20, R21, R25] |
| Trustworthiness at 15 | scikit-learn trustworthiness on the expression matrix and the map | maximise | guardrail | [R24] |
| Spectral distance correlation | Spearman correlation of pairwise diffusion distances, input versus map | maximise | guardrail | [R22] |
| Density preservation | Pearson correlation of local radii at 30 neighbours, input versus map | maximise | guardrail | [R23] |

- **Comparators**: PCA to two components; openTSNE FFT; umap-learn; the exact reference from B1.
- **Protocol**: input log-CP10k as in the OpenProblems pipeline; metrics on the two-dimensional output; each metric reported separately, with no unweighted average.
- **Acceptance** (proposed guardrail, not a published threshold): the candidate's continuity at 30 is at least 0.9 times the exact reference's value on the same data.
- **Known pitfalls**: trustworthiness saturates on well-separated data and cannot rank methods there. Methods and metrics must share the input normalisation, or methods that match the metric's normalisation score higher.

### P1. Performance and scaling

Wall-clock time and peak memory of t-SNE-family and UMAP implementations as $N$ grows. The $10^7$ memory test comes first, because the sparse $P$ dominates memory. Sizes follow the openTSNE benchmark design (1,000; 100,000; 250,000; 500,000; 750,000 and 1,000,000 cells, five subsamples each, drawn from the 10X Genomics 1.3 million mouse brain cells dataset), with 10,000 added here.

- **Metrics**: seconds for the kNN stage, the gradient stage and the total (primary, minimise); peak resident memory as a ratio to PCA bytes ($4Nd$) plus $P$ bytes ($12\times\mathrm{nnz}(P)$) (guardrail); the log–log slope of total time against $N$ with a 95% interval over subsamples (guardrail).
- **Comparators**: scikit-learn Barnes–Hut t-SNE (0.24.2); MulticoreTSNE (0.1); FIt-SNE (1.2.1); openTSNE (0.6.0, FFT and Barnes–Hut); umap-learn (0.5.1); cuML t-SNE and UMAP through rapids-singlecell; tsne-cuda. Versions are those of the openTSNE benchmark and are to be updated.
- **Protocol**: the shared protocol above, except the openTSNE benchmark schedule (learning rate 200; 250 exaggeration iterations at 12, then 750 at 1), reported separately from the defaults of section 5. Thread counts are set through `OMP_NUM_THREADS` and `NUMBA_NUM_THREADS`, with a numba warm-up before UMAP timing. Single- and multi-thread results are reported, along with hardware (the openTSNE benchmarks used an Intel Xeon E5-2650 v4).
- **Acceptance** (proposed): the log–log slope of FFT-path time between $10^5$ and $10^6$ cells is at most 1.2; peak memory is within 4 times (PCA bytes plus $P$ bytes); repeated measurements on the same hardware agree within 15%.
- **Known pitfalls**: thread oversubscription from MKL and numba distorts comparisons, and default learning rates differ across libraries, so timings must compare identical settings.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.scalable_truncated_svd`: Approximate PCA and truncated SVD at atlas scale
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
- **Feeds**:
  - `embedding-viz.local_neighborhood_preservation`: Local neighbourhood preservation of an embedding or reduced representation
  - `embedding-viz.embedding_stability`: Embedding stability across seeds, subsamples and hyperparameters
  - `embedding-viz.out_of_sample_placement`: Out-of-sample placement of new cells on a fixed 2D map
- **Reads**: `obsm/<representation>`
- **Writes**: `obsm/X_<method>`, `obsp/knn_<backend>_k<k>`, `uns/emb_<method>/params`, `uns/emb_<method>/timing`, `uns/emb_<method>/kl_approx`
<!-- CHAINING:AUTO:END -->

Part of the atlas visualisation workflow: it follows PCA and graph construction and precedes map quality control and placement of new cells.

## 10. Risks, pitfalls and open questions

- **Sources not read.** The FIt-SNE and openTSNE papers, and the Dong, Malkov and van der Maaten 2014 papers, were not opened, so statements about them come from code, documentation or bibliographic records. LargeVis (Tang et al., 2016), the opt-SNE procedure (Belkina et al., 2019) and cuVS CAGRA are omitted from the tables and the tool because their primary code or paper was not read; no public opt-SNE code was found.
- **Algorithm class.** The tsne-cuda README describes an optimised CUDA version of the FIt-SNE algorithm; its paper was not read, so it remains a comparator. The FIt-SNE reimplementation route also depends on reading the FIt-SNE paper first.
- **Citation metadata.** Heiser and Lau (2020) and Belkina et al. (2019) are confirmed from a secondary web record, not from the publisher page. Dong et al. (2011) has no DOI or page range in the sources used. The pynndescent docstring at pynndescent_.py:866-867 gives a different default for $n_\text{trees}$ than the code at line 1010; the table follows the code.
- **Datasets and licences.** The Macosko and 10X pickled files were not inspected or downloaded. The licences for the Macosko data, the 10X data and the OpenProblems test sets are unknown, so the licence cells are em dashes.
- **Scale and unsettled literature.** No exact reference exists above $10^4$ cells, so fidelity claims at $10^6$ to $10^7$ cells are extrapolations from subsample trends. Global arrangement and cluster-size effects are not scored here.
- **First experiment.** Measure the seed-to-seed spread of the exact reference and of openTSNE FFT on 5,000 cells (B1) before any optimisation. If the spread exceeds the 0.05 recall margin, redefine the acceptance criterion before further work.

## 11. References

R1. van der Maaten L, Hinton G. Visualizing data using t-SNE. *Journal of Machine Learning Research* 2008;9:2579–2605. — verified (corpus)
R2. Linderman GC, Rachh M, Hoskins JG, et al. Fast interpolation-based t-SNE for improved visualization of single-cell RNA-seq data. *Nature Methods* 2019;16(3):243–245. doi:10.1038/s41592-018-0308-4 — verified (corpus)
R3. Poličar PG, Strażar M, Zupan B. openTSNE: a modular Python library for t-SNE dimensionality reduction and embedding. *Journal of Statistical Software* 2024;109(3). doi:10.18637/jss.v109.i03 — verified (repo)
R4. McInnes L, Healy J, Melville J. UMAP: uniform manifold approximation and projection for dimension reduction. arXiv:1802.03426, 2018. doi:10.48550/arxiv.1802.03426 — verified (corpus)
R5. Becht E, McInnes L, Healy J, et al. Dimensionality reduction for visualizing single-cell data using UMAP. *Nature Biotechnology* 2019;37(1):38–44. doi:10.1038/nbt.4314 — verified (corpus)
R6. Kobak D, Linderman GC. Initialization is critical for preserving global data structure in both t-SNE and UMAP. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00809-z — verified (corpus)
R7. Chari T, Pachter L. The specious art of single-cell genomics. *PLOS Computational Biology* 2023. doi:10.1371/journal.pcbi.1011288 — verified (corpus)
R8. Kobak D, Berens P. The art of using t-SNE for single-cell transcriptomics. *Nature Communications* 2019;10:5416. doi:10.1038/s41467-019-13056-x — verified (corpus)
R9. Heiser CN, Lau KS. A quantitative framework for evaluating single-cell data structure preservation by dimensionality reduction techniques. *Cell Reports* 2020;31(5):107576. doi:10.1016/j.celrep.2020.107576 — verified (search)
R10. Belkina AC, Ciccolella CO, Anno R, et al. Automated optimized parameters for T-distributed stochastic neighbor embedding improve visualization and analysis of large datasets. *Nature Communications* 2019;10:5415. doi:10.1038/s41467-019-13055-y — verified (search)
R11. van der Maaten L. Accelerating t-SNE using tree-based algorithms. *Journal of Machine Learning Research* 2014;15(1):3221–3245. — verified (repo)
R12. Dong W, Moses C, Li K. Efficient k-nearest neighbor graph construction for generic similarity measures. *Proceedings of the 20th International Conference on World Wide Web* 2011. — verified (repo)
R13. Malkov YA, Yashunin DA. Efficient and robust approximate nearest neighbor search using hierarchical navigable small world graphs. *IEEE Transactions on Pattern Analysis and Machine Intelligence* 2018;42(4):824–836. — verified (repo)
R14. Amid E, Warmuth MK. TriMap: large-scale dimensionality reduction using triplets. arXiv:1910.00204, 2019. doi:10.48550/arxiv.1910.00204 — verified (corpus)
R15. Nolet CJ, Lafargue V, Raff E, et al. Bringing UMAP closer to the speed of light with GPU acceleration. *Proceedings of the AAAI Conference on Artificial Intelligence* 2021;35(1):418–426. doi:10.1609/aaai.v35i1.16118 — verified (corpus)
R16. Chan DM, Rao R, Huang F, Canny JF. t-SNE-CUDA: GPU-accelerated t-SNE and its applications to modern data. arXiv:1807.11824, 2018. doi:10.48550/arxiv.1807.11824 — verified (corpus)
R17. van der Maaten L. Learning a parametric embedding by preserving local structure. *Artificial Intelligence and Statistics (AISTATS)* 2009, pp. 384–391. — verified (repo)
R18. Macosko EZ, Basu A, Satija R, et al. Highly parallel genome-wide expression profiling of individual cells using nanoliter droplets. *Cell* 2015. doi:10.1016/j.cell.2015.05.002 — verified (corpus)
R19. Venna J, Kaski S. Local multidimensional scaling. *Neural Networks* 2006. doi:10.1016/j.neunet.2006.05.014 — verified (corpus)
R20. Lee JA, Verleysen M. Quality assessment of dimensionality reduction: rank-based criteria. *Neurocomputing* 2009. doi:10.1016/j.neucom.2008.12.017 — verified (corpus)
R21. Chen L, Buja A. Local multidimensional scaling for nonlinear dimension reduction, graph drawing, and proximity analysis. *Journal of the American Statistical Association* 2009. doi:10.1198/jasa.2009.0111 — verified (corpus)
R22. Coifman RR, Lafon S. Diffusion maps. *Applied and Computational Harmonic Analysis* 2006. doi:10.1016/j.acha.2006.04.006 — verified (corpus)
R23. Narayan A, Berger B, Cho H. Assessing single-cell transcriptomic variability through density-preserving data visualization. *Nature Biotechnology* 2021;39(6):765–774. doi:10.1038/s41587-020-00801-7 — verified (corpus)
R24. Venna J, Kaski S. Neighborhood preservation in nonlinear projection methods: an experimental study. *Artificial Neural Networks — ICANN 2001*, pp. 485–491. doi:10.1007/3-540-44668-0_68 — verified (corpus)
R25. Lueks W, Mokbel B, Biehl M, Hammer B. How to evaluate dimensionality reduction? Improving the co-ranking matrix. arXiv:1110.3917, 2011. doi:10.48550/arXiv.1110.3917 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/pavlin-policar/openTSNE | Pavlin Poličar (setup.py author) | BSD-3-Clause (LICENSE) | default t-SNE path, FFT repulsion, placement | port |
| https://github.com/KlugerLab/FIt-SNE | Per-file copyright notices in LICENSE.txt: George C. Linderman; Laurens van der Maaten; Prakhar Srivastav; Spotify AB | per file: BSD with advertising clause (tsne.h, tsne.cpp, sptree.h, sptree.cpp, vptree.h); MIT (nbodyfft.h, nbodyfft.cpp, parallel_for.h, time_code.h, ProgressBar.hpp); Apache-2.0 (annoylib.h) | comparator; FFT scheme reference | reimplement |
| https://github.com/lmcinnes/umap | Leland McInnes (copyright holder) | BSD-3-Clause (LICENSE.txt); pyproject.toml states BSD | UMAP graph and layout | port |
| https://github.com/lmcinnes/pynndescent | Leland McInnes | BSD-2-Clause (LICENSE) | approximate neighbours for UMAP | port |
| https://github.com/spotify/annoy | Erik Bernhardsson (setup.py author) | Apache-2.0 (LICENSE) | approximate neighbours for t-SNE | port |
| https://github.com/nmslib/hnswlib | Yury Malkov and others (setup.py author) | Apache-2.0 (LICENSE) | comparator | callout |
| https://github.com/eamid/trimap | Ehsan Amid (setup.py author) | Apache-2.0 (LICENSE) | comparator | callout |
| https://github.com/CannyLab/tsne-cuda | The Regents of the University of California (copyright, 2018) | BSD-3-Clause (LICENSE) | comparator | callout |
| https://github.com/rapidsai/cuml | NVIDIA and RAPIDS contributors | Apache-2.0 (LICENSE) | GPU UMAP comparator | callout |
| https://github.com/scverse/rapids-singlecell | Severin Dicks (pyproject.toml author); scverse | MIT (LICENSE; copyright 2022 Severin Dicks, 2025 scverse) | GPU t-SNE and UMAP defaults | callout |
| https://github.com/scverse/scanpy | F. Alexander Wolf, P. Angerer, Theis Lab (LICENSE copyright) | BSD-3-Clause (LICENSE) | default-settings comparator | callout |
