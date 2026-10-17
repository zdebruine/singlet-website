---
id: neighbors.approximate_knn_search
title: Approximate versus exact k-nearest-neighbour graph construction at scale
area: neighbors
scope: core
paradigm: heuristic
literature_status: routine
priority: P0
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection, neighbors.neighbor_count_selection]
feeds: [clustering.cell_partitioning, neighbors.edge_weighting_adaptive_kernel, neighbors.hubness_detection_correction, embedding-viz.large_scale_embedding]
reads: [obsm/<use_rep>]
writes: [obsp/<key>_distances, obsp/<key>_connectivities, uns/<key>, uns/<key>_recall_report]
devices: [cpu, cuda]
mcp_tool: singlet_neighbors_approximate_knn_search
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Approximate versus exact k-nearest-neighbour graph construction at scale

> Build the cell neighbour graph with an explicit exact-recall check: an approximate index is accepted only where it reproduces exact k-nearest neighbours on the same embedding to a stated recall target, with time and memory reported beside recall.

## 1. Question

Given an embedding $X \in \mathbb{R}^{n \times d}$ (usually PCA scores), a neighbour count $k$, the Euclidean metric and a seed, return for each cell $i$ a set $\hat N_k(i)$ of $k$ other cells that matches the exact set $N_k(i)$ (section 3.1) at the lowest time and peak memory, and report whether the approximation changes partitions built on the graph beyond seed-to-seed variation. Outputs are a sparse distance matrix, a sparse connectivity matrix (self excluded) and a recall report. Correctness is defined against exact search on the same embedding, metric, precision and tie rule; the graph has no biological ground truth, so agreement with the exact pipeline downstream is the accepted proxy.

## 2. Why this task matters and where the field stands

The cell-to-cell neighbour graph is the input of graph-based clustering and of the fuzzy graph of UMAP [R2]; the single-cell best-practices book proposes Leiden [R3] on a kNN graph built from the PC-reduced space [R4]. The graph is rebuilt for different embeddings and values of $k$. Exact search costs about $2n^2d$ floating-point operations in matrix-product form, roughly $10^{14}$ for $n=10^6$ and $d=50$, so approximate indices are standard at scale. The published standard is the Scanpy path [R1]: exact search below a cell-count threshold and NN-descent (pynndescent) above it (section 4).

The status is **routine**: the indices are mature, but evidence on their effect on single-cell conclusions is thin. The open problems are these.

1. The general benchmark of approximate-neighbour libraries [R7] uses generic vectors and reports recall against throughput; recall versus cluster agreement on single-cell data is unmeasured.
2. The single-cell evidence is qualitative. A Scanpy how-to compares brute-force, pynndescent and Annoy graphs on paul15 by timing and by Leiden and UMAP plots [R11]. The best-practices book expects "the bulk of cells" to stay in the same cluster when switching from exact to an approximate backend, with a few swapping [R4].
3. The switch from exact to approximate search is a convention: Scanpy uses 8192 cells for the Euclidean metric and 4096 otherwise (section 4), and the book calls GPU brute force best below about 500k cells [R4]. Neither is measured on singlet's hardware.
4. Hubness (a few cells in many neighbour lists) may make recall uneven across cell types; this is a hypothesis, linked to neighbors.hubness_detection_correction.
5. At the scale of singlet's catalogue (354M cells) no single index fits in memory (section 5), and the recall of sharded builds is unmeasured.

## 3. Theory and insight

The unit of analysis is the neighbour set of each cell. The exact set is deterministic once the metric, the embedding and a tie rule are fixed, and every approximate index is judged against it.

### 3.1 Exact sets and the recall estimand

The exact set is $N_k(i) = \{\, j \neq i : d(x_i,x_j) \le d_{(k)}(i) \,\}$, where $d_{(k)}(i)$ is the distance from cell $i$ to its $k$-th exact neighbour. It has more than $k$ members when several cells share that distance; the reference keeps exactly $k$ by sorting on distance, then on cell index. Set overlap penalises arbitrary tie breaks, so a returned neighbour $j$ of cell $i$ counts as a hit when

$$
\mathrm{hit}_{ij} = \mathbf{1}\{\, d(x_i,x_j) \le (1+\tau)\, d_{(k)}(i) + \varepsilon_a \,\}, \qquad h_i = \sum_{j \in \hat N_k(i)} \mathrm{hit}_{ij}, \qquad R_k = \frac{1}{mk} \sum_{i \in S} h_i .
$$

With tolerances $\tau = 10^{-6}$ and $\varepsilon_a = 10^{-12}$ (proposed) and a query sample $S$ of $m$ cells drawn uniformly without replacement, the estimand $R_k$ is the fraction of returned neighbours, averaged over the query cells, that lie within the tolerance of the exact $k$-th neighbour distance; per cell it is $h_i/k \in [0,1]$, and it is 1 for exact search. It is valid only when the reference uses the same metric, embedding and floating-point precision as the index under test. For independent cells the standard error is about $\sigma_h/(k\sqrt m)$, optimistic because neighbouring cells have correlated recall. Without ties the Jaccard overlap of two $k$-sets equals $R/(2-R)$, a monotone function of recall, so no separate overlap metric is used.

### 3.2 Approximate indices are heuristics

**Graph refinement (NN-descent).** Each iteration forms for cell $i$ a pool $C_i \subseteq N_i \cup \bigcup_{j \in N_i} N_j$ of at most $c$ candidates and keeps the $k$ closest. The heuristic is that a neighbour of a neighbour is likely a neighbour; it has no recovery guarantee. Recall depends on the initialisation (random-projection trees in pynndescent) and on $c$. Iteration stops once an iteration changes few entries (section 4), so more iterations do not raise recall after convergence. For fixed $c$ the cost per iteration is at most about $n c^2$ distance evaluations of cost $O(d)$. Scanpy and pynndescent use different tree-count rules (section 4): at $n = 10^4$ they give 10 and 8 trees, so recall measured under one rule does not transfer to the other.

**Hierarchical navigable small world graphs (HNSW).** With out-degree parameter $M$, element $i$ receives the top layer $\ell_i = \lfloor -\ln(U_i)\, m_L \rfloor$, $m_L = 1/\ln M$, $U_i \sim \mathrm{Unif}(0,1)$. Since $\ell_i \ge L$ exactly when $U_i \le M^{-L}$, a fraction $M^{-L}$ of elements reaches layer $L$ and about one remains at $L \approx \log_M n$ (independent $U_i$, $M \ge 2$). A query descends greedily from the sparse top layer and keeps a beam of width $\mathrm{ef}$ on the bottom layer; recall and cost rise with $\mathrm{ef}$ and $M$ [R6].

**Inverted files (IVF).** A coarse $k$-means quantiser splits the $N$ indexed vectors into $L$ lists and a query scans the $p$ nearest lists, about $pN/L$ vectors when lists are balanced (optimistic for skewed clusters). All cells together cost $n(L + pN/L)$ distance evaluations. The rapids-singlecell rule $L = 2\,\mathrm{nextpow2}(\sqrt N)$ (section 4) gives lists of between $\sqrt N/4$ and $\sqrt N/2$ vectors on average.

**Exact matrix-product search.** The identity $\lVert x_i - x_j\rVert^2 = \lVert x_i\rVert^2 + \lVert x_j\rVert^2 - 2\, x_i^{\top} x_j$ turns all-pairs distances into one matrix product, which is why GPU brute force is fast. In single precision the subtraction loses accuracy when $\lVert x_i - x_j\rVert^2 \ll \lVert x_i\rVert^2$ and near-ties flip, so the exact reference uses the test's precision with a float64 check. Time is $\Theta(n^2 d)$; $b$ query rows at a time need $4bn$ bytes of float32 distances.

### 3.3 Why heuristics work, and what a model adds

Recall rises with search breadth ($\mathrm{ef}$, $p$, $c$, trees) at rising cost, so recall-versus-cost curves, measured per dataset, are the standard tuning tool; none of the libraries read predicts recall for a new dataset. A model-based layer would predict the recall distribution from cheap features, select the cheapest configuration whose predicted recall clears a target at a stated risk, and be reused across datasets. Let $\phi$ collect $\log n$, $d$, a local intrinsic-dimension estimate, the skewness of the $k$-occurrence counts $O_j = \lvert\{i : j \in N_k(i)\}\rvert$ (a hubness measure), and the backend configuration $\theta$. Model $\operatorname{logit} R_k(\theta)$, with $R_k$ clipped to $[10^{-3}, 1-10^{-3}]$, as Gaussian with mean $\mu_\omega(\phi)$ and variance $\sigma^2_\omega(\phi)$, and select

$$
\theta^\star = \arg\min_\theta\ \mathrm{cost}(\theta;\phi) \quad \text{s.t.} \quad \Pr\bigl(R_k(\theta) \ge \text{target} \mid \phi\bigr) \ge 1 - \alpha, \qquad \alpha = 0.1 \text{ (proposed)}.
$$

The search stays heuristic; the model is a calibration layer. An untested hypothesis is that approximation errors sit among near-tied neighbours at rank $k$, in which case set-overlap recall understates the agreement of graph clusterings; the miss-depth metric of B2 tests it.

### 3.4 Pitfalls

- **Self convention.** Scanpy's `n_neighbors` counts the cell itself: its distance matrix stores `n_neighbors - 1` entries per row (section 4). This document's $k$ excludes self, so a like-for-like comparison with Scanpy's default graph uses $k = 14$.
- **Small $n$ favours exact search.** In a Scanpy how-to on paul15 (2,730 cells), one call took 29.3 ms with brute force, 683 ms with pynndescent and 50.1 ms with Annoy (scanpy 1.10.0rc2.dev, pynndescent 0.5.11) [R11].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Exact brute force, CPU (scikit-learn `KNeighborsTransformer`, `algorithm="brute"`) | heuristic (exact) | Computes all pairwise distances and keeps the $k$ smallest per row | [R10] |
| Exact brute force, GPU (cuML `NearestNeighbors`, `algorithm="brute"`, through rapids-singlecell `brute`) | heuristic (exact) | The same computation on the GPU | [R9] |
| NN-descent (pynndescent; Scanpy and UMAP path) | heuristic | Local joins of neighbours of neighbours from a random-projection-tree initialisation, then graph diversification that prunes the longest edge of triangles | [R5] |
| HNSW (hnswlib) | heuristic | Layered proximity graph with exponentially thinning layers; greedy descent, then a beam of width $\mathrm{ef}$ on the bottom layer | [R6] |
| IVF-Flat on GPU (cuVS, through rapids-singlecell `ivfflat`) | heuristic | Coarse quantiser with `n_lists` clusters; a query searches `n_probes` clusters | [R9] |
| CAGRA (cuVS, through rapids-singlecell `cagra`) | heuristic | GPU graph index; rapids-singlecell sets the graph degree to $k$ and builds with NN-descent | [R8] |
| Annoy (called through sklearn-ann in the Scanpy how-to) | heuristic | Forest of binary trees, each node splitting by a random hyperplane equidistant from two sampled points | — |

The published standard is the Scanpy path: scikit-learn exact search below 8192 cells (Euclidean; 4096 otherwise) and pynndescent with UMAP's tree rule above. Exact search is the reference every approximate method is compared with and is the default backend of rapids-singlecell [R9]. HNSW and IVF are the usual alternatives [R6, R4]. Every singlet backend takes an $n \times d$ float32 or float64 embedding without missing values, $k$, the Euclidean metric and a seed; self is excluded and duplicates are kept.

Defaults of the methods singlet implements or compares. Prefixes: `rsc` = `src/rapids_singlecell/preprocessing/_neighbors/` (rapids-singlecell @ `e110792`); `nnd` = `pynndescent/pynndescent_.py` (pynndescent @ `05e62e3`); Scanpy @ `8ed52d9`; hnswlib @ `ca42672`; cuVS @ `3721d31`; Annoy @ `379f744`.

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| Scanpy | exact shortcut | scikit-learn `KNeighborsTransformer(algorithm="brute")` when $n < 8192$ (Euclidean) or $n < 4096$ (other metrics) | `src/scanpy/neighbors/__init__.py:680-685`; `src/scanpy/neighbors/_common.py:48-58` |
| Scanpy | `n_neighbors` | 15, counting the cell itself (the matrix holds `n_neighbors - 1` entries per row) | `src/scanpy/neighbors/__init__.py:65,158` |
| Scanpy | pynndescent `n_trees`; `n_iters` | `min(64, 5 + round(sqrt(n)/20))`; `max(5, round(log2 n))`, commented as UMAP's defaults | `src/scanpy/neighbors/_common.py:65-69` |
| Scanpy | Leiden `resolution` | 1 | `src/scanpy/tools/_leiden.py:57` |
| pynndescent | `n_neighbors`; `metric` | 30; `euclidean` | `nnd:979,982` |
| pynndescent | `n_trees`; `n_iters` (when None) | `max(3, min(12, round(2 log10 n)))`; `max(5, round(log2 n))` | `nnd:1009-1012` |
| pynndescent | `max_candidates` (when None); `delta` | `min(60, n_neighbors)`; 0.001, stop when an iteration makes at most $\delta k n$ updates | `nnd:1136`; `nnd:1002,317` |
| pynndescent | `diversify_prob`; `pruning_degree_multiplier`; `tree_init`; `low_memory` | 1.0; 1.5; True; True | `nnd:986-987,994,998` |
| pynndescent | query `epsilon`; transformer `search_epsilon`; transformer `n_neighbors` | 0.1; 0.1; 30 in the signature but 5 in the docstring | `nnd:2275,2716,2711,2569` |
| hnswlib | `M`; `ef_construction`; `random_seed` | 16; 200; 100 | `python_bindings/bindings.cpp:946-948`; `README.md:75` |
| hnswlib | query `ef` | 10 | `python_bindings/bindings.cpp:183`; `hnswlib/hnswalg.h:121` |
| hnswlib | level multiplier; layer-0 degree | $1/\ln M$; $2M$ | `hnswlib/hnswalg.h:152,229`; `hnswlib/hnswalg.h:119` |
| rapids-singlecell | `n_neighbors`; `algorithm`; `metric` | 15; `brute`; `euclidean` | `rsc__init__.py:47,52,53`; `rsc_algorithms/_brute.py:23-27` |
| rapids-singlecell | IVF-Flat `n_lists`; `n_probes` | $2 \cdot 2^{\lceil \log_2 \sqrt N \rceil}$; 20 | `rsc_helper/__init__.py:17-20`; `rsc_algorithms/_ivfflat.py:47-48` |
| rapids-singlecell | CAGRA | `graph_degree=k`; `build_algo="nn_descent"`; default search parameters | `rsc_algorithms/_cagra.py:52-58` |
| cuVS | IVF-Flat `n_lists`; `kmeans_n_iters`; `kmeans_trainset_fraction`; `n_probes` | 1024; 20; 0.5; 20 | `python/cuvs/cuvs/neighbors/ivf_flat/ivf_flat.pyx:99-103,282` |
| cuVS | CAGRA `intermediate_graph_degree`; `graph_degree`; `build_algo` | 128; 64; `ivf_pq` | `python/cuvs/cuvs/neighbors/cagra/cagra.pyx:234-236` |
| Annoy | `n_trees`; `search_k` | set at `build`, no default; `n_trees * n` | `README.rst:76,105` |

## 5. Proposed singlet approach

- **Routes** (licences in section 12). Exact brute force on CPU and CUDA: **reimplement** as a blocked matrix-product distance kernel (cuBLAS on CUDA) with per-row top-$k$; it is also the exact reference. NN-descent: **port** pynndescent to the C++ core ([R5], without Numba-specific code). HNSW: **port** hnswlib [R6], pinned to a tagged release because its README labels the current version a release candidate. IVF-Flat on CPU and CUDA: **reimplement** (k-means quantiser, inverted lists, probed-list scan). Everything else in section 4, including the Scanpy path, is a **callout**.
- **Backend selection.** `auto` runs exact search below `exact_threshold_n` (4096) and NN-descent above it with the Scanpy tree rule. NN-descent and HNSW run on the CPU in this release, and the output records `device: cpu`. The GPU switch point is an output of P1.
- **Recall-targeted tuning** (measured, not modelled). Build with defaults, measure $R_k$ on a uniform cell sample and, below target, raise the breadth parameter: the pool $c$ for NN-descent (iterations stop early), $\mathrm{ef}$ from $2k$ by doubling for HNSW, $p$ from 20 by doubling for IVF-Flat. Stop at the target or when the estimated cost reaches that of exact search; otherwise keep the most accurate configuration and record `target_met: false`.
- **Calibration model** (proposed, outside first-release acceptance). A small PyTorch network fitted by maximum likelihood on exact-versus-approximate pairs from catalogue subsamples (recipe G2, section 8). It is rejected, keeping the measured tuner, if on held-out datasets the $(1-\alpha)$ interval covers less than $1-\alpha-0.05$, more than $\alpha + 0.05$ of selected configurations miss the target, or it is slower than default NN-descent at equal recall on most datasets.
- **Kernels and scale.** Hard-coded CUDA only for the small hot kernels (distances, top-$k$, IVF assignment and scan). Exact search and the IVF scan stream query blocks; NN-descent and HNSW hold the embedding in memory. At 354M cells and $d=50$ a float32 embedding is 70.8 GB, so catalogue-scale graphs are sharded builds with recorded overlap.
- **Defaults and falsifiers.** Agents leave parameters at their defaults. `exact_threshold_n` fails if exact search on the same device beats NN-descent at equal recall above 4096 cells or loses below it (P1); NN-descent as default fails if tuned HNSW reaches the target at lower cost on most B2 datasets.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/`use_rep` | float32 or float64, cells by dimensions | Embedding to search (default `X_pca`); no missing values |
| write | obsp/`key`_distances | float32 sparse, cells by cells | $k$ stored distances per row, self excluded, ascending |
| write | obsp/`key`_connectivities | float32 sparse, cells by cells | Unweighted symmetric adjacency: 1 where $j \in \hat N_k(i)$ or $i \in \hat N_k(j)$; weighting is left to neighbors.edge_weighting_adaptive_kernel |
| write | uns/`key` | dictionary | Requested and resolved backend, device, parameters, seed, precision, timings |
| write | uns/`key`_recall_report | dictionary | Recall, miss depth and tie count (section 7) |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `use_rep` | string | "X_pca" | — | Key of the obsm embedding to search (cells by dimensions); must contain no missing values. |
| `key` | string | "knn" | — | Stem of the output members obsp/<key>_distances, obsp/<key>_connectivities, uns/<key> and uns/<key>_recall_report. |
| `n_neighbors` | integer | 15 | min 1 | Neighbours per cell, self excluded; at most the number of cells minus one. Scanpy's default graph corresponds to 14. |
| `metric` | string | "euclidean" | `euclidean` | Distance metric; only euclidean is supported in this release. |
| `backend` | string | "auto" | `auto`, `brute`, `nn_descent`, `hnsw`, `ivfflat` | Index. auto picks brute below auto.exact_threshold_n, else nn_descent. brute is exact; the others are approximate and tuned to validation.target. |
| `auto` | object | — | — | Options of backend auto. |
| `auto.exact_threshold_n` | integer | 4096 | min 1 | Cell count below which auto uses exact search. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. nn_descent and hnsw always run on CPU. |
| `seed` | integer | 0 | min 0 | Random seed for the query sample, trees, quantiser and approximate-index randomness. |
| `validation` | object | — | — | Recall check against exact search and optional downstream agreement check. |
| `validation.sample_size` | integer | 2000 | min 1 | Number of uniformly sampled query cells used to measure recall against exact search. |
| `validation.target` | number | 0.95 | min 0; max 1 | Mean recall an approximate backend must reach on the sample; its breadth parameter is raised until it does. |
| `validation.downstream_ari` | boolean | false | — | Also run Leiden on the approximate and the exact graph and record their ARI against an exact seed control; adds clustering time. |
| `validation.downstream_resolution` | number | 1.0 | > 0 | Leiden resolution for the downstream check; used only when downstream_ari is true. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members with the same key instead of failing. |
<!-- PARAMS:AUTO:END -->

`auto` resolves to `brute` below `auto.exact_threshold_n` and to `nn_descent` otherwise. `brute` writes an exact graph; its report compares the device result with a float64 CPU reference on the sample, and on CPU recall is 1 up to ties. `nn_descent`, `hnsw` and `ivfflat` are tuned to `validation.target` on `validation.sample_size` cells. `hnsw` uses $M = 16$, $\mathrm{ef}_{\text{construction}} = 200$ and a tuned $\mathrm{ef} \ge$ `n_neighbors`; the library default of 10 is below $k = 15$. `ivfflat` uses the list rule of section 4 and a tuned $p$. `device` is honoured by `brute` and `ivfflat`. `seed` seeds the sample, trees, quantiser and index, and `brute` uses it only for the sample. `n_neighbors` must not exceed $n - 1$.

## 7. MCP tool

Tool name `singlet_neighbors_approximate_knn_search` (definition in `tasks/mcp/singlet_neighbors_approximate_knn_search.json`). Example call, then a compact result for a dataset of at least 4096 cells, where `auto` resolves to NN-descent (angle-bracket values are placeholders).

```json
{"dataset": "data/example.singlet", "use_rep": "X_pca", "n_neighbors": 15, "backend": "auto",
 "validation": {"sample_size": 2000, "target": 0.95}, "seed": 0}
```

```json
{
  "dataset": "data/example.singlet",
  "status": "completed",
  "wrote": ["obsp/knn_distances", "obsp/knn_connectivities", "uns/knn", "uns/knn_recall_report"],
  "summary": {
    "backend": "nn_descent", "device": "cpu", "n_cells": "<int>", "n_neighbors": 15,
    "tuned": {"max_candidates": "<int>"},
    "recall": {"sample_size": 2000, "mean_R_k": "<float>", "p05_cell_recall": "<float>",
               "target_met": "<bool>", "mean_miss_depth": "<float>", "cells_with_ties": "<int>"},
    "timing_s": {"build": "<float>", "total": "<float>"}, "peak_memory_gb": "<float>",
    "graph": {"n_connected_components": "<int>"}, "downstream": null
  },
  "provenance_id": "<id>"
}
```

Long-running: yes; the dry-run estimate says whether the call completes inline or is queued, and the queueing threshold is an operational setting. Stochastic: yes, through `seed`, for the approximate backends and the query sample. Dry-run estimate: `seconds`, `peak_memory_gb`, `device` and the resolved `backend`, from a per-device throughput table to be fitted on P1; it is an estimate, not a measurement.

## 8. Benchmarks

**Shared protocol.** Euclidean distance, self excluded, $k = 15$ (B1: $k = 10$). The exact reference is computed by singlet's brute-force kernel in float32 with the tie rule of section 3.1 and checked against a float64 CPU run on the query sample. Query cells are drawn uniformly; three seeds change the query sample and the index seed; results are the mean and the 5th percentile over seeds. CPU and GPU model, thread count and precision are recorded. Embeddings are $d = 50$ PCA scores (proposed) of log-normalised expression on highly variable genes, computed once per dataset and shared by all comparators. B1 follows the published ANN-Benchmarks design [R7]; B2, B3 and P1 are proposed.

### B1. Parity with reference libraries on ANN-Benchmarks vectors

- **Goal**: check that each ported or reimplemented index reproduces the recall-throughput behaviour of its reference library on a published generic benchmark, before any single-cell claim.
- **Ground truth**: exact 10 nearest neighbours of each query among the training vectors, computed by singlet's brute-force kernel; per-query recall is $h/10 \in [0,1]$ with the tolerant hit of section 3.1.
- **Datasets**

| Dataset | Source | Modality, size | License | Notes |
|---|---|---|---|---|
| SIFT-128-euclidean | ann-benchmarks.com [R7] | image descriptors, not single-cell; 1,000,000 training vectors of dimension 128 and 10,000 queries (per the ANN-Benchmarks preprint) | — | Named in the pynndescent README benchmark figure |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recall@10 | Mean over queries of $h/10$ | higher is better | primary | [R7] |
| Queries per second | Queries answered per second at a fixed parameter setting: one thread and one query at a time on CPU, batched queries on GPU | higher is better | primary | [R7] |
| Build time and index size | Wall-clock seconds and resident GB at the same setting | lower is better | guardrail | [R7] |

- **Comparators**: pynndescent and hnswlib as the references of the NN-descent and HNSW ports; cuVS IVF-Flat through rapids-singlecell for the IVF-Flat reimplementation on the GPU; exact brute force.
- **Protocol**: six settings per index (HNSW: $\mathrm{ef}$; NN-descent: pool size $c$; IVF-Flat: $p$); plot recall against queries per second and take the Pareto front.
- **Acceptance criterion** (proposed): at matched parameters, mean recall of each port is within 0.01 of its reference library (0.02 for IVF-Flat, whose k-means initialisation differs), and queries per second at recall $\ge 0.90$ are at least 0.8 times the reference's.
- **Known pitfalls**: image descriptors do not represent PCA scores, so the front does not transfer to B2. NYTimes-256 (angular) is not used because singlet supports only the Euclidean metric.

### B2. Recall against exact search on cell embeddings

- **Goal**: test whether each approximate backend reproduces the exact $k = 15$ neighbour sets, per cell and on average, and whether the loss concentrates in particular cell populations.
- **Ground truth**: consistency with exact search on the same embedding; the label of a query cell is its exact top-15 list. Every metric is normalised per cell.
- **Datasets**

| Dataset | Source | Modality, size | License | Notes |
|---|---|---|---|---|
| paul15 | `scanpy.datasets.paul15` [R13] | myeloid progenitors, scRNA-seq; 2,730 cells × 3,451 genes | — | Approximate backends forced |
| G2-100k | catalogue, recipe G2 | scRNA-seq; $10^5$ cells | — | — |
| G2-1M | catalogue, recipe G2 | scRNA-seq; $10^6$ cells | — | — |

  **Recipe G2.** (1) Fix a seed. (2) Draw cells uniformly from the catalogue of 354M uniformly processed cells. (3) Log-normalise, select highly variable genes and compute 50 PCA components with the upstream tasks of section 9, identically for all comparators. (4) Keep the author cell-type label where present.

- **Metrics** ($m = 10{,}000$ query cells)

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Mean recall $R_{15}$ | Tolerant-hit recall of section 3.1 averaged over query cells | higher is better | primary | [R7] |
| 5th-percentile cell recall | 5th percentile over query cells of $h_i/15$, linear interpolation | higher is better | primary | — |
| Mean miss depth | Mean over missed exact neighbours $j$ of $g = (d_{(k)}(i) - d(i,j))/d_{(k)}(i)$, for cells with $d_{(k)}(i) > 0$; near 0 means misses are near-ties | lower is better | guardrail | — |
| Minimum label-group recall | Mean $R_{15}$ within each author-label group of the sample, minimum over groups with at least 50 sampled cells | higher is better | guardrail | — |

- **Comparators**: the Scanpy default path; singlet NN-descent, HNSW and IVF-Flat; callouts Annoy and cuVS CAGRA and IVF-Flat through rapids-singlecell. Graphs are self-graphs.
- **Acceptance criterion** (proposed, not from the literature): for the default approximate backend, mean $R_{15} \ge 0.95$ and 5th-percentile cell recall $\ge 0.80$ on G2-100k, G2-1M and paul15; the exact backend gives $R = 1$ up to ties for $n \le 4096$.
- **Known pitfalls**: a Scanpy-matched graph uses $k = 14$ (section 3.4). Float32 and float64 references can disagree on near-ties.

### B3. Downstream agreement with the exact pipeline

- **Goal**: test whether approximation changes Leiden partitions more than the seed-to-seed variation of Leiden on the exact graph.
- **Ground truth**: the partition of the exact graph at the same resolution; for G1 also the planted labels. Agreement is the adjusted Rand index (ARI [R12]): symmetric, 1 for identical partitions, 0 in expectation for independent ones.
- **Datasets**

| Dataset | Source | Modality, size | License | Notes |
|---|---|---|---|---|
| G1 | generated, recipe G1 | synthetic; $n \in \{10^4, 10^5\}$, $d = 50$, $K = 20$ clusters, $\sigma \in \{0.3, 0.6\}$ | not applicable | Planted labels |
| G2-100k | as B2 | scRNA-seq; $10^5$ cells | — | No planted labels |

  **Recipe G1.** (1) Fix a seed. (2) Draw $K = 20$ centres $\mu_c \sim \mathcal{N}(0, I_{50})$. (3) Assign each of $n$ cells to a cluster with equal probability. (4) Set $x_i = \mu_{c(i)} + \sigma \varepsilon_i$ with $\varepsilon_i \sim \mathcal{N}(0, I_{50})$. (5) Keep $c(i)$ as the planted label. Isotropic noise in 50 dimensions is unlike real embeddings, so G1 serves partitions, not recall.

- **Metrics** (Leiden [R3] at the Scanpy default resolution 1; 5 seeds; $a \ne b$ ranges over ordered seed pairs)

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI, approximate versus exact | $\mathrm{ARI}(P_{\text{approx}}^{(a)}, P_{\text{exact}}^{(b)})$ averaged over pairs | higher is better | primary | [R12, R3] |
| Seed-control ARI | $\mathrm{ARI}(P_{\text{exact}}^{(a)}, P_{\text{exact}}^{(b)})$ over the same pairs; the noise floor | reference level | primary | [R12, R3] |
| ARI to planted labels (G1) | ARI between each graph's partition and $c(i)$ | higher is better | primary | [R12] |
| Connected components | Number of connected components of the symmetrised graph | equal to the exact graph | guardrail | — |

- **Comparators**: the exact brute-force graph as reference and each approximate backend at its tuned default.
- **Acceptance criterion** (proposed, not from the literature): mean ARI(approximate, exact) is at least the seed-control ARI minus 0.02 on every dataset, and on G1 the ARI to planted labels of the approximate graph is within 0.02 of that of the exact graph.
- **Known pitfalls**: a different cluster count inflates or deflates ARI, so counts are reported next to it. Independent seeds $a \ne b$ keep a shared seed from inflating agreement.

### P1. Performance and scaling

Wall time, peak memory and throughput at $n = 10^4$, $10^5$, $10^6$ and, for the streaming backends (exact search on CUDA and IVF-Flat), $10^7$ cells, on CPU and CUDA. Data: G1 ($\sigma = 0.6$) at all sizes and G2 up to $10^6$.

- **Measured**: median and interquartile range of three repeats after one discarded warm-up call (just-in-time compilation), with build and query timed separately; throughput as $n$ divided by the median total time; peak resident memory in GB; $R_{15}$ on the B2 sample at the same setting, since a faster setting may simply be less accurate.
- **Held fixed**: $k = 15$, Euclidean metric, float32 PCA input, seed, thread count and hardware, all recorded.
- **Comparators**: exact brute force on CPU (up to $10^6$) and CUDA; the three singlet approximate backends; callouts Annoy, rapids-singlecell brute force, cuVS IVF-Flat and CAGRA.
- **Acceptance criterion** (proposed): at $n = 10^6$ the default approximate backend reaches $R_{15} \ge 0.95$ in no more wall time than exact search on the same device. Per device, the crossover size (the smallest $n$ at which the approximate backend is faster at $R_{15} \ge 0.95$) is reported; it replaces `exact_threshold_n` and confirms or rejects the Scanpy thresholds and the book's 500k-cell statement.
- **Known pitfalls**: first calls include compilation time. Sharded catalogue-scale builds change both time and boundary recall, so they are reported with their overlap.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
  - `neighbors.neighbor_count_selection`: Choice of neighbour count k and graph stability
- **Feeds**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `neighbors.edge_weighting_adaptive_kernel`: Edge weighting of kNN graphs: SNN/Jaccard, adaptive kernels and symmetrisation
  - `neighbors.hubness_detection_correction`: Hubness detection and correction in cell neighbour graphs
  - `embedding-viz.large_scale_embedding`: Embedding of very large datasets
- **Reads**: `obsm/<use_rep>`
- **Writes**: `obsp/<key>_distances`, `obsp/<key>_connectivities`, `uns/<key>`, `uns/<key>_recall_report`
<!-- CHAINING:AUTO:END -->

This task belongs to the graph-based clustering and embedding workflow: normalisation, highly variable genes, PCA, number of components, neighbour graph, then partitioning and layout. Related, not chained: neighbors.batch_aware_knn_graph and neighbors.distance_metric_choice.

## 10. Risks, pitfalls and open questions

- **Recall versus partitions is unmeasured.** None of the sources read relates kNN recall (for example 0.9 versus 0.99) to Leiden partitions at fixed resolution (section 2, item 1). B3 is the first test, and the first experiment is the recall-versus-ARI curve on singlet's own embeddings with the exact-versus-exact seed control.
- **Thresholds are conventions.** Scanpy's 8192 and 4096 cells and the book's 500k cells [R4] are not measured on singlet's hardware, and the book statement is not a benchmark.
- **Primary papers not read.** The papers on NN-descent [R5] and HNSW [R6] were not read; the algorithms are taken from the pynndescent and hnswlib code. The CAGRA paper [R8] is matched by bibliographic record only. FAISS (paper and code) and cuML internals were not read, so FAISS is not a comparator.
- **Data licences and composition.** The licences of the SIFT-128 and paul15 data are not stated in the sources read. Per-source licences of the catalogue cells used in G2 and the composition of the calibration model's training subsamples are not inventoried.
- **Untested hypotheses.** Errors may sit among near-ties at rank $k$ (section 3.3); the approximate graph may miss the few edges bridging clusters and change connected components; multi-threaded NN-descent and GPU atomics may give different graphs under one seed; float32 distances may flip near-ties against a float64 reference. B2, B3 and P1 test these.
- **Scale and the calibration model.** The boundary recall of sharded catalogue-scale builds is unmeasured, and the calibration model is not validated; the rules of section 5 decide whether it is adopted.

## 11. References

R1. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R2. McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction. *arXiv* 2018; arXiv:1802.03426. doi:10.48550/arxiv.1802.03426 — verified (corpus)
R3. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)
R4. Single-cell best-practices book (theislab): chapters `cellular_structure/clustering` and `introduction/rapids_singlecell`. Online book, repository theislab/single-cell-best-practices at commit d581689. — verified (repo)
R5. Dong W, Moses C, Li K. Efficient k-nearest neighbor graph construction for generic similarity measures. *Proceedings of the 20th International Conference on World Wide Web*, ACM; 2011. — verified (repo)
R6. Malkov YA, Yashunin DA. Efficient and robust approximate nearest neighbor search using hierarchical navigable small world graphs. *IEEE Transactions on Pattern Analysis and Machine Intelligence* 2018;42(4):824-836. doi:10.1109/tpami.2018.2889473 — verified (search)
R7. Aumüller M, Bernhardsson E, Faithfull A. ANN-Benchmarks: a benchmarking tool for approximate nearest neighbor algorithms. *Information Systems* 2019; arXiv:1807.05614. doi:10.1016/j.is.2019.02.006 — verified (search)
R8. Ootomo H, Naruse A, Nolet C, Wang R, Araki T, Futamura Y, Sakurai T. CAGRA: Highly Parallel Graph Construction and Approximate Nearest Neighbor Search for GPUs. *2024 IEEE 40th International Conference on Data Engineering (ICDE)* 2024. doi:10.1109/icde60146.2024.00428 — verified (corpus)
R9. Dicks S, Heumos L, May L, Jimenez S, Angerer P, Gold I, Virshup I, Fischer F, Gill M, Boerries M, Nolet CJ, Chen TJ, Theis FJ. GPU-accelerated single-cell analysis at scale with rapids-singlecell. *arXiv* 2026; arXiv:2603.02402. doi:10.48550/arxiv.2603.02402 — verified (corpus)
R10. Pedregosa F, Varoquaux G, Gramfort A, et al. Scikit-learn: Machine Learning in Python. *Journal of Machine Learning Research* 2011. — verified (corpus)
R11. Scanpy developers (scverse). Using other kNN libraries in Scanpy (how-to notebook `docs/how-to/knn-transformers.ipynb`). Scanpy documentation, scanpy 1.10.0rc2.dev. — verified (repo)
R12. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R13. Paul F, Arkin Y, Giladi A, et al. Transcriptional heterogeneity and lineage commitment in myeloid progenitors. *Cell* 2015;163(7):1663-1677. doi:10.1016/j.cell.2015.11.013 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scikit-learn/scikit-learn | The scikit-learn developers (COPYING) | BSD-3-Clause (COPYING; pyproject.toml) | Exact brute-force comparator and Scanpy's small-$n$ backend | callout |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (pyproject.toml authors); copyright Severin Dicks and scverse | MIT (LICENSE) | GPU brute force (cuML), IVF-Flat and CAGRA comparators; source of GPU defaults | callout |
| https://github.com/lmcinnes/pynndescent | Leland McInnes (pyproject.toml authors and maintainers) | BSD-2-Clause (LICENSE; pyproject.toml) | Basis of the NN-descent backend and its defaults | port |
| https://github.com/nmslib/hnswlib | "Yury Malkov and others" (setup.py author) | Apache-2.0 (LICENSE) | Basis of the HNSW backend | port |
| https://github.com/spotify/annoy | Erik Bernhardsson (setup.py author) | Apache-2.0 (LICENSE; setup.py) | Comparator in B2 and P1 | callout |
| https://github.com/scikit-learn-contrib/sklearn-ann | scikit-ann contributors (LICENSE) | BSD-3-Clause (LICENSE; pyproject.toml) | Wrapper through which the Scanpy how-to calls Annoy | callout |
| https://github.com/rapidsai/cuvs | NVIDIA Corporation (LICENSE appendix) | Apache-2.0 (LICENSE) | IVF-Flat and CAGRA comparators; source of cuVS defaults | callout |
| https://github.com/scverse/scanpy | scverse; maintainers in pyproject.toml: Ilan Gold, Philipp Angerer, Severin Dicks | BSD-3-Clause (LICENSE; pyproject.toml) | Default graph path, thresholds and Leiden resolution; paul15 loader | callout |
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE) | Apache-2.0 (LICENSE holds the standard notice only) | Source of the book statements in R4 | callout (text reference only) |
