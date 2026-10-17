---
id: scalability.out_of_core_processing
title: Atlas-scale execution fidelity: out-of-core, chunked and GPU computation versus in-memory CPU reference
area: scalability
scope: core
paradigm: hybrid
literature_status: routine
priority: P1
depends_on: [harmonization.count_matrix_state_detection, harmonization.object_integrity_checks]
feeds: [neighbors.approximate_knn_search, clustering.cell_partitioning, scalability.scalable_graph_clustering]
reads: [layers/counts, layers/log1p_norm, var/highly_variable, obsm/X_pca, obsp/connectivities]
writes: [layers/log1p_norm, obs/n_genes_by_counts, obs/total_counts, var/highly_variable, obsm/X_pca, varm/PCs, uns/pca, obsp/distances, obsp/connectivities, obs/leiden, uns/fidelity_report]
devices: [cpu, cuda]
mcp_tool: singlet_scalability_out_of_core_processing
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Atlas-scale execution fidelity: out-of-core, chunked and GPU computation versus in-memory CPU reference

> Check that chunked, disk-backed, Dask and GPU routes for standard single-cell steps reproduce the in-memory float64 CPU result within stated tolerances, and measure what they cost in time and memory.

## 1. Question

Given a sparse count matrix $X\in\mathbb{Z}_{\ge 0}^{n\times g}$ on disk that may not fit in memory, and a standard step (per-cell QC, normalisation, highly variable genes, PCA, kNN graph, Leiden clustering), does a chunked, disk-backed, Dask or GPU route return the same derived quantities as the in-memory float64 CPU reference, within a stated tolerance, and at what time and peak-memory cost? A correct answer matches integer quantities exactly, round-trips storage without loss, and states the error that any approximate route adds.

## 2. Why this task matters and where the field stands

Atlas-scale datasets exceed workstation memory, and the standard chain from counts to clusters is usually held in memory. Out-of-core CPU execution and RAPIDS GPU execution are the common ways around that limit. The status is **routine** for the exact steps: row-local transforms and associative reductions chunk without changing the result beyond rounding. The approximate steps (truncated or randomised SVD, approximate neighbour search, GPU graph clustering) are **contested**, because their departure from the reference depends on the method and on the reference chosen [R9, R10, R11].

Open problems:

- Truncated SVD on graphics processors is an active area, and its accuracy trade-offs bear on the GPU PCA route [R11].
- Leiden partitions vary with seed and implementation, so a partition difference counts as a fault only against a seed-to-seed noise floor [R9, R12].
- Approximate neighbour indices must be scored by recall against exact neighbours on the same embedding, since recall can fall on high-dimensional or heavy-tailed data (B3).
- The seurat_v3 score depends on a trend fitted over all genes, so its chunked form needs global summaries (section 3).

## 3. Theory and insight

Three classes of step need different criteria, and the class decides how closely a chunked result can match the in-memory one.

| Symbol | Meaning |
|---|---|
| $x_{ij}$ | count of gene $j$ in cell $i$; $n$ cells and $g$ genes after filtering, stored sparsely |
| $\mu_j$, $\sigma_j^2$ | sample mean and variance of gene $j$ over cells |
| $X_c=X-\mathbf 1\mu^\top$ | column-centred matrix, never formed |
| $s_1\ge\dots\ge s_g$ | singular values of $X_c$; $k$ is the target rank |
| $A_{ij}$, $k_i$, $m$ | graph weights, node degrees and total edge weight |

**Row-local transforms are exact under chunking.** Depth normalisation to a target library size $T$, $y_{ij}=\log\bigl(1+T\,x_{ij}/\sum_{j'}x_{ij'}\bigr)$, depends only on row $i$. The per-cell QC counts $n^{\mathrm{gen}}_i=\#\{j:x_{ij}>0\}$ and $t_i=\sum_j x_{ij}$ are integers. Chunking by whole rows reproduces both in exact arithmetic, and floating-point results differ only through evaluation order.

**Associative reductions merge across disjoint row chunks.** For chunks $A$ and $B$ with $n_A$ and $n_B$ cells, the pairwise update of Chan et al. [R14] gives

$$\delta=\mu_B-\mu_A,\qquad \mu=\mu_A+\tfrac{n_B}{n}\delta,\qquad M_2=M_{2,A}+M_{2,B}+\tfrac{n_An_B}{n}\delta^2,\qquad n=n_A+n_B,$$

where $M_2$ is the sum of squared deviations and the sample variance is $M_2/(n-1)$, applied elementwise to each gene. The centred covariance follows from the Gram matrix, which is a sum of chunk Gram matrices:

$$C=\frac{1}{n-1}\bigl(X^\top X-n\,\mu\mu^\top\bigr),\qquad \mu=\tfrac1n X^\top\mathbf 1.$$

This identity is exact in exact arithmetic. In floating point the subtraction cancels when $|\mu_j|\gg\sigma_j$. To first order in the unit roundoff $\varepsilon$, the relative error of $C_{jj}$ is of order $\varepsilon(\mu_j/\sigma_j)^2$, which makes float32 accumulation the failure case.

**Approximate algorithms change the answer by more than rounding.** For a randomised range finder with a Gaussian test matrix $\Omega$ of $k+p$ columns, $p\ge 2$, and no power iterations, the expected Frobenius error obeys [R7, R8]

$$\mathbb E\,\lVert X_c-QQ^\top X_c\rVert_F\le\Bigl(1+\tfrac{k}{p-1}\Bigr)^{1/2}\Bigl(\sum_{j>k}s_j^2\Bigr)^{1/2},$$

with the expectation over $\Omega$. Subspace error is controlled by the gap $s_k-s_{k+1}$ and must be reported against it. The incremental PCA of Ross et al. [R13] updates the decomposition batch by batch. It stacks the scaled previous components, the new centred batch and the mean-correction row $\sqrt{n_an_b/(n_a+n_b)}\,(\bar x_a-\bar x_b)$, takes an SVD and truncates to $k$. Truncation after every batch makes the result depend on batch size and batch order.

**Highly variable genes (seurat_v3) are exact in two sweeps over the matrix, with state of size $g$.** The first sweep gives $\mu_j$ and $\sigma_j^2$ by the merge rule. A degree-2 loess fit of $\log_{10}\sigma_j^2$ on $\log_{10}\mu_j$ across all genes with non-zero variance gives the predicted variance $\hat\sigma_j^2$. The second sweep accumulates sums at the clip value $c_j=\mu_j+\sqrt N\,\hat\sigma_j$, and the score of gene $j$ is

$$\nu_j=\frac{1}{(N-1)\,\hat\sigma_j^{2}}\sum_{i}\bigl(\min(x_{ij},c_j)-\mu_j\bigr)^2 .$$

The loess fit is a single global step, so the chunked form matches the in-memory score up to rounding once the first sweep has finished.

**Estimands**, one sentence each:

- *QC:* $n^{\mathrm{gen}}_i$ and $t_i$ are the per-cell gene count and total count, unnormalised.
- *Normalised values:* $y_{ij}$ is the log-scale value after scaling each cell to $T$ counts.
- *HVG:* $\nu_j$ is the score above, and the selected set is the $n_{\mathrm{top}}$ genes with largest $\nu_j$, ties broken by gene index.
- *PCA:* scores $Z=X_cV_k$ per cell, unit-norm loadings $V_k$ per gene, and variance ratios $r_j=s_j^2/\lVert X_c\rVert_F^2$, normalised by the total centred variance of all $g$ genes rather than of the $k$ retained components.
- *Neighbours:* $\mathcal N_k(i)$ is the set of $k$ nearest cells by Euclidean distance in the first $d$ scores, self excluded, ties broken by index.
- *Clusters:* a partition of cells, compared by the adjusted Rand index [R12].
- *Differential expression:* for each group and gene, the statistic of the chosen test as computed by the in-memory implementation of that test for the group against the rest.

**Regime of validity.** Exact claims hold for float64 accumulation, or for float32 within the rounding bound above, and assume that no cell is split across chunks. The randomised bound assumes no power iterations, $p\ge 2$ and an expectation over $\Omega$. Subspace claims need a gap that is large relative to the perturbation.

**Graph clustering is global.** Leiden optimises a resolution-weighted modularity,

$$Q_\gamma=\frac{1}{2m}\sum_{i,j}\Bigl(A_{ij}-\gamma\,\frac{k_ik_j}{2m}\Bigr)\,\delta(c_i,c_j),$$

where $\gamma=1$ gives modularity, and it guarantees well-connected communities [R9]. The objective couples all nodes, so out-of-core execution applies to graph construction and not to the partition.

**Complexity.** Accumulating $X^\top X$ costs $\sum_i\mathrm{nnz}_i^2$ operations for sparse rows. The $g\times g$ eigendecomposition costs $O(g^3)$ and $8g^2$ bytes in float64. Brute-force neighbours cost $O(n^2d)$ for $d$ dimensions. Each out-of-core sweep reads the whole matrix once, so I/O grows with the number of sweeps.

**Model-based insight.** A model adds value where the exact reference cannot be computed at scale. For an approximate route, a regression of the measured error on the spectral gap gives a predictive interval for a new matrix, tested for coverage on held-out subsets. Deep generative models of counts can be trained from minibatches read from a store [R3]. The exact in-memory result remains the ground truth.

**Pitfalls.** A GPU result compared with another GPU result is circular. Graph error and clustering error are mixed when the graph is not fixed. A reference computed on a subset in only one path leaks into the comparison. Lossy storage that is not recorded as lossy looks exact.

## 4. Methods landscape

The in-memory CPU functions of scanpy are the published standard, evaluated in float64 as the reference for every benchmark; rapids-singlecell's in-memory GPU functions are the standard GPU route. Other rows are routes compared or implemented here, each tied to cited code or a cited paper.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scanpy in-memory functions (CPU) | heuristic | Full matrix in RAM; the reference (float64 in this document). | [R1] |
| scanpy backed chunked PCA (`chunked=True`) | heuristic | Row chunks of an on-disk AnnData feed sklearn IncrementalPCA (`'auto'` solver); `zero_center` is ignored. | [R1], [R13] |
| scanpy PCAEighDask | heuristic | Summed per-block Gram matrices, then an in-memory eigendecomposition. | [R1], [R4] |
| scikit-learn IncrementalPCA | heuristic | Batch updates with mean correction; truncation after each batch. | [R13] |
| rapids-singlecell GPU (CuPy, cuML) | heuristic | In-memory GPU kernels; cuML incremental PCA when chunked. | [R5], [R6] |
| rapids-singlecell Dask-CUDA | heuristic | Row-chunked operations across GPUs; covariance route for PCA. | [R5], [R4] |
| rapids-singlecell seurat_v3 HVG | heuristic | Loess trend and clipped standardised variance per gene (section 3). | [R16] |
| Approximate kNN on GPU (CAGRA, IVF-PQ, NN-descent) | heuristic | CAGRA builds a proximity graph for search; IVF-PQ and NN-descent are the other indices used by rapids-singlecell; recall scored against brute force. | [R10]; cuVS (section 12) |
| Leiden (leidenalg on CPU; cuGraph on GPU via rapids-singlecell) | heuristic | Local moving with refinement; guarantees well-connected communities. | [R9] |
| AnnData h5ad (backed) and Zarr (lazy reads) | heuristic | Row-chunked stores read through backed mode or Dask views. | [R2] |
| BPCells on-disk sparse matrices | heuristic | Disk-backed, bit-packed storage with streaming C++ kernels. | [R15] |
| scvi-tools minibatch training | model-based | Generative model trained on minibatches from a store. | [R3] |

| Method | Parameter | Value | Source |
|---|---|---|---|
| scanpy PCA | chunked; chunk_size | False; None, required when chunked | `src/scanpy/preprocessing/_pca/__init__.py:66, 67, 158–160` @ 8ed52d9 |
| scanpy PCA | zero_center on chunked path; layer or obsm with chunked | ignored; rejected | `_pca/__init__.py:95, 205–207` @ 8ed52d9 |
| scanpy neighbours | n_neighbors; method | 15; umap | `src/scanpy/neighbors/__init__.py:65, 71` @ 8ed52d9 |
| scanpy Leiden | random_state; n_iterations | 0 (decorator); −1 | `src/scanpy/tools/_leiden.py:54, 65` @ 8ed52d9 |
| scanpy PCAEighDask | n_components; input | min(x.shape); CSR sparse Dask with unchunked feature axis | `src/scanpy/preprocessing/_pca/_dask.py:61–62, 51–57` (corpus checkout) |
| scikit-learn IncrementalPCA | batch_size; minimum batch | None (inferred as 5 × n_features); n_components | `sklearn/decomposition/_incremental_pca.py:67–69, 239–240` (corpus checkout) |
| rapids PCA | svd_solver for Dask input; chunked estimator | covariance_eigh; cuML IncrementalPCA with batch_size = chunk_size | `src/rapids_singlecell/preprocessing/_pca.py:306–313, 425–432` @ e110792 |
| rapids neighbours | n_neighbors; algorithm; metric | 15; brute; euclidean | `src/rapids_singlecell/preprocessing/_neighbors/__init__.py:47, 52, 53` @ e110792 |
| rapids neighbours | algorithm options | brute, cagra, ivfflat, ivfpq, mg variants, nn_descent (all_neighbors excluded, section 10) | `_neighbors/__init__.py:38`; `_neighbors/_neighbors.py:38` @ e110792 |
| rapids Leiden | resolution; n_iterations; random_state; use_dask | 1.0; 100; 0 (legacy decorator); False | `src/rapids_singlecell/tools/_clustering.py:142, 149, 139, 154` @ e110792 |
| rapids HVG | flavour under presets | seurat under scanpy-v1 (default); seurat_v3_paper under v2 preview | `src/rapids_singlecell/_settings.py:69, 70, 159` (corpus checkout) |
| rapids seurat_v3 | trend; clip value | loess, degree 2; mean + √N·σ̂ | `src/rapids_singlecell/preprocessing/_hvg/_seurat_v3.py:179, 182–185` (corpus checkout) |
| rapids docs example | chunk size; n_comps | 20,000 rows; 50 (example values, not library defaults) | `scverse_rapids_singlecell/docs/out_of_core.md:63, 92` (corpus checkout) |

## 5. Proposed singlet approach

- **Routing by operation.** Row-local steps (`qc_metrics`, `normalize`) stream row chunks through `backed_chunked`, and `highly_variable_genes` uses the two-sweep seurat_v3 route. Out of core, `pca` defaults to the exact `dask_covariance`, with the approximate `backed_chunked` kept for comparison. `neighbors` computes exact brute-force neighbours in row chunks, with approximate GPU indices as options. `leiden` works on the full in-memory graph. `auto` picks `in_memory` when the peak estimate fits host memory, and the chunked route above otherwise.
- **Port or reimplement.** The covariance accumulation and seurat_v3 sweeps are ported from permissively licensed references (section 12) to the C++ core and CUDA kernels. Leiden is reimplemented from the paper, and the reference package is not vendored (section 12).
- **Model-based formulation.** Approximate routes report a calibrated error model beside the measured error: a log-linear regression of the error (subspace error for PCA, $1-R@k$ for neighbours) on the gap ratio and on the batch-size or index setting, fitted to B1 and B3 inputs and tested on held-out subsets. Its predictive interval goes to `uns/fidelity_report`. The model is falsified if nominal 95% intervals cover fewer than 90% of held-out subsets (proposed threshold). The exact routes remain the references.
- **Stack.** PyTorch serves only the scVI-family route, which is not in this version's enum. Hard-coded CUDA with cuSPARSE handles the chunked Gram and clipped-sum accumulations, whose state has length $g^2$ or $g$. Randomised PCA belongs to `dim-reduction.scalable_truncated_svd`.
- **Engineering.** Readers hold one chunk and a state of size $g$. GPU routes use a pool allocator, since managed memory is incompatible with UCX. The CuPy sparse index width, which bounds GPU chunk size, is noted in section 10.
- **Defaults an agent should use.** `strategy` auto, `operation` pca, `chunk_size` 20,000, `n_comps` 50, `zero_center` true, `seed` 0; `target_sum` 10,000 and `n_top_genes` 2,000 (singlet choices, not taken from the reference libraries); neighbours with 15 neighbours, euclidean and brute force; Leiden at resolution 1.0 for 100 iterations, without Dask.
- **Falsification.** If `dask_covariance` misses the float64 thresholds of B1, the implementation is at fault, not the method. If the predictor misses coverage, its interval is withheld.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse integer, row-chunked on disk | source for QC, normalisation and HVG; every route streams it |
| read | layers/log1p_norm | sparse float | PCA input, written by `normalize` |
| read | var/highly_variable | bool | PCA gene mask |
| read | obsm/X_pca | float, $n\times$ `n_comps` | input to `neighbors` |
| read | obsp/connectivities | sparse float | input to `leiden` |
| write | layers/log1p_norm | float | normalised values $\log(1+Tx/\sum x)$ |
| write | obs/n_genes_by_counts, obs/total_counts | integer | per-cell QC, exact |
| write | var/highly_variable | bool | seurat_v3 selection of `n_top_genes` |
| write | obsm/X_pca, varm/PCs, uns/pca | float, float, dict | scores $Z$, loadings $V_k$, variance ratios and resolved route |
| write | obsp/distances, obsp/connectivities | sparse float | neighbour graph |
| write | obs/leiden | categorical | cluster labels |
| write | uns/fidelity_report | dict | per-metric errors, tolerance results and predictive intervals when present |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `operation` | string | "pca" | `qc_metrics`, `normalize`, `highly_variable_genes`, `pca`, `neighbors`, `leiden` | Standard step to run; leiden needs neighbors output and neighbors needs pca output. |
| `strategy` | string | "auto" | `auto`, `in_memory`, `backed_chunked`, `dask_covariance`, `gpu`, `gpu_dask` | Execution route; auto uses in_memory when the peak estimate fits RAM, otherwise a chunked route. |
| `chunk_size` | integer | 20000 | min 1 | Rows per chunk for chunked and Dask routes; backed_chunked PCA needs chunk_size of at least n_comps. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Seed for Leiden, approximate neighbour indices and fidelity subsets; exact routes ignore it. |
| `dry_run` | boolean | false | — | Return estimated time, peak host and device memory and the resolved strategy without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `n_comps` | integer | 50 | min 2; max 200 | Number of principal components k; neighbours use the first n_comps scores. |
| `zero_center` | boolean | true | — | Centre genes before PCA on every route; scanpy's chunked path ignores this option. |
| `fidelity` | object | — | — | Validation against the in-memory CPU float64 reference; off by default. |
| `fidelity.reference` | string | "none" | `none`, `in_memory` | in_memory computes the CPU reference and writes uns/fidelity_report. |
| `fidelity.subset_cells` | integer | 0 | min 0 | Cells in a fixed random subset used for both candidate and reference; 0 uses all cells. |
| `fidelity.pca_rtol` | number | 1e-07 | > 0 | Relative tolerance on PCA scores and loadings after sign alignment. |
| `fidelity.pca_atol` | number | 1e-06 | min 0 | Absolute tolerance on PCA scores and loadings after sign alignment. |
| `fidelity.variance_rtol` | number | 1e-05 | > 0 | Relative tolerance on variance ratios. |
| `fidelity.hvg_rtol` | number | 2e-05 | > 0 | Relative tolerance on HVG scores; the selected gene set must match exactly. |
| `fidelity.min_recall` | number | 0.9 | min 0; max 1 | Minimum neighbour recall R@k against brute-force neighbours. |
| `fidelity.min_ari` | number | 0.9 | min 0; max 1 | Minimum adjusted Rand index between candidate and reference partitions. |
| `options` | object | — | — | Method-specific options; each object applies only to the operation of the same name. |
| `options.normalize` | object | — | — | Options for normalize. |
| `options.normalize.target_sum` | number | 10000 | > 0 | Library size each cell is scaled to before log1p. |
| `options.highly_variable_genes` | object | — | — | Options for highly_variable_genes. |
| `options.highly_variable_genes.n_top_genes` | integer | 2000 | min 10; max 50000 | Number of genes selected by the seurat_v3 score. |
| `options.highly_variable_genes.flavor` | string | "seurat_v3" | `seurat_v3` | Only flavour in this version; the trend is fitted across all genes. |
| `options.neighbors` | object | — | — | Options for neighbors. |
| `options.neighbors.n_neighbors` | integer | 15 | min 1; max 200 | Neighbours per cell, self excluded. |
| `options.neighbors.metric` | string | "euclidean" | `euclidean` | Distance between cells in the first n_comps scores. |
| `options.neighbors.algorithm` | string | "brute" | `brute`, `cagra`, `ivfflat`, `ivfpq`, `mg_ivfflat`, `mg_ivfpq`, `nn_descent` | brute is exact; all other values are approximate and need recall checks. |
| `options.leiden` | object | — | — | Options for leiden. |
| `options.leiden.resolution` | number | 1.0 | > 0 | Resolution of the modularity objective; larger values give more clusters. |
| `options.leiden.n_iterations` | integer | 100 | min -1; max 10000 | Maximum iterations; -1 iterates until convergence. |
| `options.leiden.use_dask` | boolean | false | — | Distributes clustering over GPUs; requires strategy gpu_dask. |
<!-- PARAMS:AUTO:END -->

Rules that span parameters: `dask_covariance` applies only to `pca`. `gpu` and `gpu_dask` need a CUDA device, and `device` auto selects CUDA for GPU strategies. `backed_chunked` PCA needs `chunk_size` of at least `n_comps`. Approximate neighbour algorithms need CUDA and are reported as approximate. `leiden.use_dask` needs `gpu_dask`. `fidelity.reference` in_memory needs the matrix, or the subset, to fit in host memory. `fidelity.subset_cells` is drawn with `seed` and used for both candidate and reference. `zero_center` applies to every PCA route.

## 7. MCP tool

Tool name `singlet_scalability_out_of_core_processing` (definition in `tasks/mcp/singlet_scalability_out_of_core_processing.json`). Example call:

```json
{"dataset": "atlas.singlet", "operation": "pca", "strategy": "auto", "chunk_size": 20000, "n_comps": 50, "fidelity": {"reference": "in_memory", "subset_cells": 10000}}
```

Example result:

```json
{"dataset": "atlas.singlet", "status": "completed", "wrote": ["obsm/X_pca", "varm/PCs", "uns/pca", "uns/fidelity_report"], "summary": {"operation": "pca", "strategy_resolved": "dask_covariance", "n_cells": "<value>", "n_genes": "<value>", "wall_seconds": "<value>", "peak_host_gb": "<value>", "peak_device_gb": null, "fidelity_passed": "<true or false>", "max_errors": "<per metric>"}, "provenance_id": "<provenance id>", "job_id": null, "estimate": null}
```

Long-running: calls above the inline limit are queued and return a `job_id`. Stochastic: yes, because Leiden, approximate indices and fidelity subsets use `seed`; exact routes do not. Dry run: returns seconds, peak host and device memory and the resolved strategy without computing.

## 8. Benchmarks

All accuracy benchmarks share this protocol unless a block says otherwise. The reference is the in-memory float64 CPU result of the same scanpy function, with the same matrix, gene set and parameters, and seed 0. Candidates are evaluated in float64; float32 PCA candidates use rtol $10^{-3}$. Chunk sizes are 1, 7, 1,000 and 20,000 rows, including sizes that do not divide $n$ and single-cell chunks. GPU candidates are compared with the CPU reference and never with another GPU result. Inputs are written to disk before measurement, and each candidate's dtype and index type are recorded. Sign alignment precedes every embedding comparison.

### B1. Per-step fidelity of QC, normalisation, HVG selection and PCA

- **Goal**: Show that chunked, disk-backed, Dask and GPU routes match the in-memory CPU result within tolerance, and mark approximate routes.
- **Ground truth**: consistency with the in-memory float64 CPU result, same function, matrix and parameters; estimands in section 3.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| pbmc3k_processed | `scanpy.datasets` loader | scRNA-seq, human, size — | — | PCA check on a public matrix |
| Negative-binomial generator | generated by singlet | simulated counts; $n=2\times10^4$ and $2\times10^5$, $g=3{,}000$ | — | Recipe below |

Recipe: lognormal cell depths $d_i$ ($\sigma=0.5$); gene means $m_j$ lognormal (log-mean $-4.6$, $\sigma=1.5$); five cell groups, each with five genes raised fourfold; $x_{ij}\sim\mathrm{NB}(d_im_j)$ with variance $\mu+0.2\mu^2$; 5% of rows and two genes set to zero.

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| PCA score and loading agreement | sign-invariant rule $\bigl\lvert\lvert S^c_{ij}\rvert-\lvert S^r_{ij}\rvert\bigr\rvert\le\text{atol}+\text{rtol}\,\lvert S^r_{ij}\rvert$, float64 rtol $10^{-7}$ and atol $10^{-6}$; loadings alike | lower | primary | [R5] |
| Variance-ratio difference | $\max_j\lvert v^c_j-v^r_j\rvert/v^r_j\le10^{-5}$ | lower | primary | [R5] |
| HVG agreement | Jaccard index of selected sets equal to 1; maximum relative difference of $\nu_j$ at most $2\times10^{-5}$ | higher, lower | primary | [R5] |
| QC exactness | integer counts equal in every cell; totals within rtol $10^{-7}$ | lower | guardrail | — |

- **Comparators**: scanpy backed chunked PCA [R1]; scanpy PCAEighDask [R1, R4]; scikit-learn IncrementalPCA [R13]; rapids-singlecell GPU and Dask-CUDA [R5].
- **Protocol**: $n_{\mathrm{comps}}=50$, centring on. The scanpy chunked comparator ignores centring, so it is reported separately.
- **Acceptance criterion**: Proposed. `dask_covariance` in float64 meets every PCA, variance and HVG rule and gives exact QC integers. `backed_chunked` and the scikit-learn comparator are reported as approximations, with maximum errors reported.
- **Known pitfalls**:
  1. The covariance route loses accuracy as $\mu_j/\sigma_j$ grows, most in float32; report the ratio.
  2. PCA signs are arbitrary; compare absolute values under a stated rule.

### B2. Storage round-trip exactness

- **Goal**: Show that each on-disk format returns the in-memory arrays exactly, so that later differences are attributable to computation.
- **Ground truth**: the in-memory AnnData object before writing. A lossless round trip shows no difference in any component.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Negative-binomial generator (B1) | generated by singlet | sparse integer and float; $n=2\times10^4$, $g=3{,}000$ | — | Includes empty rows, an all-zero gene column and a string-typed obs column |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Mismatched entries | count of stored X entries whose value, index or dtype differs, plus mismatched obs and var entries, dtypes and column order; target 0 | lower | primary | — |
| Size and load time | bytes on disk; seconds to open, to read everything and to read a 10% row slice; median of three | lower | guardrail | — |

- **Comparators**: AnnData h5ad [R2]; AnnData Zarr through zarr-python (section 12); the BPCells on-disk store, only once its installation is verified (section 10).
- **Protocol**: write each format from one object; read it back in the same process and in a fresh process; compare every component; record size and time.
- **Acceptance criterion**: Proposed. Zero mismatched entries for X, obs and var (bitwise identity) for each format. A format with any mismatch is excluded from B1 and B3 until corrected.
- **Known pitfalls**:
  1. A float tolerance would hide lossy compression, so the comparison is by exact equality.
  2. A codec that is lossy by design is recorded as non-lossless and is excluded from the exactness claim.

### B3. Approximate neighbours and clustering on a fixed graph

- **Goal**: Separate the error of approximate neighbour search from the error of graph clustering, on matched inputs.
- **Ground truth**: exact brute-force neighbours on the same embedding, ties broken by cell index; the CPU Leiden partition on the exact graph with seed 0; the noise floor from seeds 0 to 4.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| pbmc68k_reduced | `scanpy.datasets` loader | scRNA-seq, human, size — | — | Recall on a public embedding |
| Heavy-tailed embedding | generated by singlet | $n=10^5$ points, 50 dimensions | — | 20 Gaussian centres with Student-$t$ ($\nu=3$) noise scaled to unit variance |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Neighbour recall R@k | $\frac1n\sum_i\lvert\mathcal N^{\mathrm{approx}}_k(i)\cap\mathcal N^{\mathrm{exact}}_k(i)\rvert/k$ at $k=15$; threshold above 0.9 | higher | primary | [R10] |
| Partition agreement | adjusted Rand index between candidate and reference on the same graph; threshold at least 0.9 | higher | primary | [R12] |
| Seed noise floor | adjusted Rand index between two CPU Leiden runs with seeds 0 and 1 on the same graph | reported | guardrail | [R9] |

- **Comparators**: rapids-singlecell brute force, CAGRA, IVF-flat, IVF-PQ, NN-descent and the multi-GPU variants [R10]; Dask-CUDA Leiden against non-Dask Leiden on the same graph [R5]; leidenalg as the CPU reference [R9].
- **Protocol**: $n_{\mathrm{comps}}=50$ with euclidean distance; Leiden resolution 1.0 and 100 iterations on both sides; seeds 0 to 4, reported as median and interquartile range; $k$ reported with every result.
- **Acceptance criterion**: Proposed; the 0.9 thresholds match tolerances in the rapids-singlecell tests [R5]. Each approximate algorithm has R@k above 0.9; Dask and non-Dask Leiden have ARI of at least 0.9 on the same graph, with the noise floor reported beside it.
- **Known pitfalls**:
  1. Tie-breaking in the exact reference changes R@k, so ties are broken by cell index.
  2. Clustering comparisons must hold the graph fixed, or graph and partition errors are confounded.

### B4. Differential-expression statistic fidelity

- **Goal**: Check that per-gene test statistics computed on chunked or Dask inputs match the in-memory statistics for each test that supports them.
- **Ground truth**: the in-memory CPU statistic of the same test on the same matrix. Groups are the reference Leiden partition from B3 on the generator matrix, and each group is compared with the rest.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Negative-binomial generator (B1) | generated by singlet | sparse integer; $n=2\times10^4$, $g=3{,}000$ | — | Five groups from the reference partition; counts are non-negative |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Rank correlation of statistics | Spearman $\rho$ across genes, per group, between candidate and reference statistics; threshold 0.99 for t-test and logreg | higher | primary | [R5] |
| Unsupported Dask method | Wilcoxon on Dask input is rejected by the source; reported as a documented deviation with no threshold | — | guardrail | [R5] |

- **Comparators**: rapids-singlecell in-memory GPU and Dask-CUDA for logreg, t-test, t-test_overestim_var and wilcoxon_binned [R5].
- **Protocol**: the shared protocol with default test options; $\rho$ per group and per method; medians over seeds 0 to 4 for the partition.
- **Acceptance criterion**: Proposed. $\rho\ge 0.99$ per group for t-test and logreg candidates. wilcoxon_binned results are reported with their $\rho$ and no threshold.
- **Known pitfalls**:
  1. Exact Wilcoxon is unavailable on Dask input, so a Dask comparison of that test is not an equivalence check.
  2. wilcoxon_binned rejects negative values in Dask sparse input, which is why the generator is non-negative.

### P1. Performance and scaling

Measure wall time; peak host memory from `resource.getrusage(RUSAGE_SELF).ru_maxrss` (kilobytes on Linux); peak GPU memory from CuPy pool statistics and the driver, reported separately from host memory; on-disk size; and load and 10% slice times. Use $10^4$, $10^5$ and $10^6$ cells, plus $10^7$ cells with host memory capped below the stored matrix size for the out-of-core claim. Compare each step on CPU and CUDA with the B1 comparators. Hold fixed: chunk size 20,000 rows, $n_{\mathrm{comps}}=50$, thread count, storage codec, dtype, `n_top_genes`, neighbour count and metric, and the Leiden seed and resolution. Report cold and warm cache separately, repeat at least three times, and report the median with spread. No speed or memory threshold is set in this version; targets follow the first measurements and are not taken from the literature.

Pitfalls: managed memory slows oversubscribed workloads, and host RSS then does not show GPU residency; UCX is incompatible with managed memory (rapids-singlecell out-of-core guide). Calling `.compute()` gathers the whole result into one process, so the benchmark never calls it on the full matrix.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.count_matrix_state_detection`: Count-matrix processing-state detection
  - `harmonization.object_integrity_checks`: Matrix and metadata integrity checks
- **Feeds**:
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `scalability.scalable_graph_clustering`: Scalable graph clustering fidelity and cost at atlas scale
- **Reads**: `layers/counts`, `layers/log1p_norm`, `var/highly_variable`, `obsm/X_pca`, `obsp/connectivities`
- **Writes**: `layers/log1p_norm`, `obs/n_genes_by_counts`, `obs/total_counts`, `var/highly_variable`, `obsm/X_pca`, `varm/PCs`, `uns/pca`, `obsp/distances`, `obsp/connectivities`, `obs/leiden`, `uns/fidelity_report`
<!-- CHAINING:AUTO:END -->

Workflow: scaled preprocessing, from counts through QC, normalisation, highly variable genes, PCA, neighbours and Leiden, for matrices that exceed memory.

## 10. Risks, pitfalls and open questions

- **Storage and tool evidence.** BPCells is confirmed by its repository README (preprint link) and its title by a search result; its author list was not confirmed, and its installation is not yet verified. Its README claims (1.3 million cells in 4 minutes with 2 GB) are self-reported and were not measured here. TileDB-SOMA has no implementation repository or peer-reviewed paper among the sources used here, so it is excluded.
- **Self-reported speed claims.** The 1.4-million-cell Dask claim in the scanpy 1.10 release notes, and the best-practices figures of 10–20× end to end and 50–200× for UMAP, t-SNE and Leiden, were not measured here and are not acceptance criteria.
- **Missing comparison evidence.** No paired study of chunked against in-memory fidelity across formats, and no study of GPU against CPU Leiden partitions or their seed noise, is among the sources used; B1 to B4 would be the first such tables. The cuVS benchmark definitions are not among the sources, so the B3 recall protocol is this document's own. The fidelity and speed of the scVI-family streaming dataloader are unverified.
- **Recalled sources and conflicting defaults.** The Halko et al. bound in section 3 was not checked against the paper text: its form and equation number are recalled, and the SIAM Review record [R8] is not in the sources. The Chan et al. update formulas were not checked against the report, which is confirmed only as a bibliographic record [R14]. In the rapids-singlecell checkout used here, the default scanpy-v1 preset maps HVG to seurat, and seurat_v3 appears only under the v2 preview preset (`_settings.py:69–70`); the seurat_v3 kernel sits under `_hvg/`. The Leiden iteration defaults conflict (100 in rapids-singlecell, −1 in scanpy), so singlet fixes 100. The sizes of pbmc3k_processed and pbmc68k_reduced were not confirmed.
- **Technical risks.** Leiden is reimplemented rather than vendored (section 12). The CuPy sparse index width, which would bound stored values per GPU block, was not confirmed in the sources. UCX is incompatible with managed memory, and Dask `.compute()` gathers results into one process.
- **First experiment.** On pbmc3k_processed and a $2\times10^4$-cell generated matrix, write h5ad and Zarr and compare the round trips (B2). Then compare `dask_covariance` PCA and seurat_v3 HVG with the in-memory CPU reference at chunk sizes 1, 7, 1,000 and 20,000 (B1). If the exact routes meet their thresholds, the defaults in section 5 stand; otherwise the implementation is corrected first.

## 11. References

R1. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R2. Virshup I, Bredikhin D, Heumos L, et al. The scverse project provides a computational ecosystem for single-cell omics data analysis. *Nature Biotechnology* 2023. doi:10.1038/s41587-023-01733-8 — verified (corpus)
R3. Gayoso A, Lopez R, Xing G, et al. A Python library for probabilistic analysis of single-cell omics data. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01206-w — verified (corpus)
R4. Rocklin M. Dask: parallel computation with blocked algorithms and task scheduling. *Proceedings of the 14th Python in Science Conference* 2015. doi:10.25080/majora-7b98e3ed-013 — verified (corpus)
R5. Dicks S, Heumos L, et al. GPU-accelerated single-cell analysis at scale with rapids-singlecell. *arXiv:2603.02402* 2026. doi:10.48550/arxiv.2603.02402 — verified (corpus)
R6. Nolet CJ, Gala D, et al. cuML: a library for GPU accelerated machine learning. Software, rapids.ai 2024. — verified (corpus)
R7. Halko N, Martinsson PG, Tropp JA. Finding structure with randomness: probabilistic algorithms for constructing approximate matrix decompositions. *arXiv:0909.4061* 2009. doi:10.48550/arxiv.0909.4061 — verified (corpus)
R8. Halko N, Martinsson PG, Tropp JA. Finding structure with randomness: probabilistic algorithms for constructing approximate matrix decompositions. *SIAM Review* 2011. — unverified (memory)
R9. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)
R10. Ootomo H, Naruse A, et al. CAGRA: highly parallel graph construction and approximate nearest neighbor search for GPUs. *2024 IEEE 40th International Conference on Data Engineering (ICDE)* 2024. doi:10.1109/icde60146.2024.00428 — verified (corpus)
R11. Tomás AE, Quintana-Ortí ES, Anzt H. Fast truncated SVD of sparse and dense matrices on graphics processors. *The International Journal of High Performance Computing Applications* 2024. doi:10.1177/10943420231179699 — verified (corpus)
R12. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R13. Ross DA, Lim J, Lin RS, Yang MH. Incremental learning for robust visual tracking. *International Journal of Computer Vision* 77(1–3):125–141, 2008. — verified (repo)
R14. Chan TF, Golub GH, LeVeque RJ. Updating formulae and a pairwise algorithm for computing sample variances. Stanford Computer Science report STAN-CS-79-773, 1979. — verified (search)
R15. Scalable high-performance single cell data analysis with BPCells. *bioRxiv* 2025. doi:10.1101/2025.03.27.645853 — verified (repo)
R16. Stuart T, Butler A, Hoffman P, et al. Comprehensive Integration of Single-Cell Data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | F. Alexander Wolf, P. Angerer, Theis Lab; scverse (LICENSE) | BSD-3-Clause | in-memory reference; backed chunked PCA; Dask covariance PCA; neighbours and Leiden wrappers | port (covariance accumulation); callout (comparator) |
| https://github.com/scverse/anndata | P. Angerer, F. Alexander Wolf, Theis Lab; scverse (LICENSE) | BSD-3-Clause | h5ad and Zarr stores; backed mode; lazy element reads | port (format compatibility) |
| https://github.com/scverse/rapids-singlecell | Severin Dicks (pyproject); LICENSE names Severin Dicks and scverse | MIT | GPU in-memory and Dask-CUDA routes; seurat_v3 kernels; neighbour and Leiden wrappers | port (kernel design); callout (comparator) |
| https://github.com/scikit-learn/scikit-learn | scikit-learn developers (COPYING) | BSD-3-Clause | IncrementalPCA with the Ross et al. update | callout (comparator); port (mean correction) |
| https://github.com/dask/dask | Matthew Rocklin (pyproject maintainer); contributors | BSD-3-Clause | blocked-array runtime for Dask input | callout |
| https://github.com/rapidsai/cuvs | RAPIDS and NVIDIA contributors | Apache-2.0 | approximate indices used by rapids-singlecell (CAGRA, IVF, NN-descent) | callout (external dependency) |
| https://github.com/rapidsai/cuml | RAPIDS contributors | Apache-2.0 (LICENSE file; no licence field in pyproject.toml) | incremental PCA and PCA solvers | callout (external dependency) |
| https://github.com/vtraag/leidenalg | V. A. Traag | GPL-3.0-or-later (pyproject.toml); LICENSE file is the GPL-3.0 text | CPU Leiden reference used by scanpy | reimplement from [R9]; do not vendor |
| https://github.com/bnprks/BPCells | Benjamin Parks (maintainer); Immanuel Abdi (DESCRIPTION) | Apache-2.0 or MIT (DESCRIPTION; LICENSE-APACHE and LICENSE-MIT files) | disk-backed sparse comparator | callout only, until installation is verified (section 10) |
| https://github.com/scverse/scvi-tools | Yosef Lab and scverse contributors | BSD-3-Clause | model-based minibatch training over stores | callout in this version (PyTorch dependency) |
| https://github.com/zarr-developers/zarr-python | zarr-developers | MIT | storage layer under AnnData Zarr | callout (dependency) |
