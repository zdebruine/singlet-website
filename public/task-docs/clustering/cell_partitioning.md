---
id: clustering.cell_partitioning
title: Partitioning cells into clusters at a fixed granularity
area: clustering
scope: core
paradigm: heuristic
literature_status: contested
priority: P0
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection, neighbors.approximate_knn_search, neighbors.edge_weighting_adaptive_kernel]
feeds: [clustering.resolution_selection, clustering.cluster_stability, annotation.cluster_label_assignment, ambient.contamination_fraction]
reads: [obsm/<embedding_key>, obsp/<graph_key>, obs/<label_key>]
writes: [obs/<cluster_key>, uns/<cluster_key>/params, uns/<cluster_key>/modularity, uns/<cluster_key>/metrics, uns/<cluster_key>/contingency]
devices: [cpu, cuda]
mcp_tool: singlet_clustering_cell_partitioning
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Partitioning cells into clusters at a fixed granularity

> Assigns every cell one hard cluster label from an embedding or neighbour graph at one fixed granularity setting, with Leiden modularity optimisation as the default, and reports agreement with reference labels only when labels are supplied.

## 1. Question

Given a cell embedding $X \in \mathbb{R}^{n \times d}$ (principal components or a batch-aware latent space), or a weighted kNN or shared-neighbour graph $G$ built from it, and one granularity setting (a graph resolution $\gamma$ or a target number of clusters $K$), which hard partition $c:\{1,\dots,n\}\to\{1,\dots,\hat K\}$ assigns each cell to exactly one cluster? The output is one integer label per cell in `obs/<cluster_key>`. A correct partition agrees with reference cell-type labels at the stated granularity, measured by the chance-adjusted scores of Section 3.3; without reference labels this task defines no correctness. Choosing the granularity and judging stability belong to clustering.resolution_selection and clustering.cluster_stability.

## 2. Why this task matters and where the field stands

Every workflow that names cell types starts from a partition of cells; marker testing, annotation and composition analysis treat it as their unit of analysis. Graph-based partitioning is the default in the two most-used toolkits, scanpy and Seurat, whose default resolutions differ (Section 4). Running a partition is routine. Deciding what it means is contested, for four reasons.

1. **Granularity is not calibrated.** A fixed resolution or $K$ gives a cluster count that depends on the embedding, graph and algorithm; granularity mismatch is a challenge named for unsupervised clustering of scRNA-seq data [R1].
2. **Scores depend on how granularity is chosen.** scIB tunes the resolution per method against the reference labels and then scores the same labels [R2]; the OpenProblems clustering metrics follow the same pattern (B1). Scores obtained this way are optimistic for unlabelled data and are not comparable across resolution grids.
3. **Rankings depend on protocol.** Duò et al. compared 14 clustering algorithms (12 in the first version) on nine scRNA-seq datasets and three simulations, assessing recovery of known subpopulations, stability and run time [R3]; Freytag et al. compared R tools on 10x Genomics data [R4]; pipeComp scores whole pipelines [R5]. All predate atlas-scale data.
4. **Reference labels are circular.** Annotations are often themselves the output of an earlier clustering, so agreement partly measures a shared method.

Further open problems: the seed dependence of Leiden and Louvain partitions is not characterised by the benchmarks of Section 8; graph construction (neighbour count, metric, number of PCs) can move a partition as much as the algorithm does and is confounded with it there; partitioning at $10^6$ to $10^8$ cells on GPU has no common protocol. This document classifies the task as **contested**: the algorithms are routine to run, while the choice of granularity and the scoring protocol are disputed.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $n$, $d$, $k_{\mathrm{nn}}$ | cells, embedding dimension, neighbours per cell |
| $A_{ij}$, $s_i=\sum_j A_{ij}$, $2m=\sum_{i,j}A_{ij}$ | symmetric non-negative edge weight, weighted degree, total weight |
| $\gamma$, $c_i$ | resolution, cluster label of cell $i$ |
| $S_C=\sum_{i\in C}s_i$, $a_{i,C}=\sum_{j\in C}A_{ij}$ | degree of community $C$, weight from cell $i$ into $C$ |
| $\hat K$, $L$ | number of predicted clusters, number of reference classes |
| $n_{ij}$, $u_i$, $v_j$ | contingency count (cluster $i$, class $j$), row sum, column sum (Section 3.3 only) |

### 3.1 Graph partitioning

Given a graph or an embedding, the output is a deterministic function of an objective, a search procedure and a seed (visiting order of local moves, k-means initialisation). No likelihood is maximised, so the partition carries no posterior and no calibrated uncertainty. Modularity with resolution $\gamma$ is the Reichardt-Bornholdt form [R6]; $\gamma=1$ gives Newman-Girvan modularity [R7]:

$$
Q_\gamma(c)=\frac{1}{2m}\sum_{i,j}\Big[A_{ij}-\gamma\,\frac{s_i s_j}{2m}\Big]\,\delta(c_i,c_j).
$$

Modularity optimisation can fail to resolve modules smaller than a scale set by the total network size, of the order of $\sqrt{2L}$ internal links for $L$ links in an unweighted network at $\gamma=1$ [R8]. The constant Potts model (CPM) [R9], offered by leidenalg, uses a density threshold instead: with unit node sizes, $Q_{\mathrm{CPM}}=\sum_C\big[m_C-\gamma\binom{n_C}{2}\big]$, where $m_C$ is the internal edge weight and $n_C$ the node count of community $C$, so that favoured communities have internal density above $\gamma$. The objectives give different partitions at the same $\gamma$.

Louvain alternates local node moves with aggregation of communities into super-nodes [R10]. Leiden adds a refinement step between the two and is designed to guarantee well-connected communities [R11]; Louvain carries no such guarantee. For an undirected graph and a node $i$ without self-loop that is first removed from its community, moving it into community $C$ changes $Q_\gamma$ by exactly

$$
\Delta Q_{i\to C}=\frac{a_{i,C}}{m}-\gamma\,\frac{S_C\,s_i}{2m^2}.
$$

A local-moving sweep visits each stored edge a constant number of times, $O(E)$ with $E\le n\,k_{\mathrm{nn}}$ before symmetrisation; the sweep count is data dependent (P1). The connectivity guarantee at a finite iteration count is not read from [R11] (Section 10).

### 3.2 Fixed-K partitions

The k-means objective is the within-cluster sum of squares, $J=\sum_{k=1}^{K}\sum_{i\in\mathcal S_k}\lVert x_i-\mu_k\rVert_2^2$ with $\mu_k$ the mean of $\mathcal S_k$. Lloyd iterations alternate nearest-mean assignment and mean update; $J$ is non-increasing and a fixed point is a local, not global, optimum, which is why seeding (k-means++ [R12]) and restarts matter. The method assumes compact clusters of similar spread and fails on elongated or continuous structure.

A Gaussian mixture is the model-based counterpart. Its responsibilities are

$$
r_{ik}=\frac{\pi_k\,\mathcal N(x_i\mid\mu_k,\Sigma_k)}{\sum_{j}\pi_j\,\mathcal N(x_i\mid\mu_j,\Sigma_j)},\qquad \hat c_i=\arg\max_k r_{ik}.
$$

With a shared isotropic covariance $\sigma^2 I$ and $\sigma^2\to0$ the responsibilities become indicators of the nearest mean, so hard k-means is the zero-variance limit; away from that regime the two partitions differ and the mixture keeps a posterior membership per cell and a likelihood for choosing $K$ (BIC).

### 3.3 Agreement measures (estimands)

Predicted clusters index the rows and reference classes the columns of the contingency table $n_{ij}$; every score below is a function of that table. Functions that take (truth, prediction) must be called in that order.

- **ARI** [R13]: $\mathrm{ARI}=\dfrac{\sum_{ij}\binom{n_{ij}}{2}-\Pi/\binom n2}{\tfrac12\big[\sum_i\binom{u_i}{2}+\sum_j\binom{v_j}{2}\big]-\Pi/\binom n2}$ with $\Pi=\sum_i\binom{u_i}{2}\sum_j\binom{v_j}{2}$. Its expectation is 0 under random labelings with fixed marginals, it can be negative, and as a pair-counting score it is dominated by large clusters, so it can hide the loss of a rare population.
- **NMI**: $I(U;V)/\tfrac12\big(H(U)+H(V)\big)$, $I(U;V)=\sum_{ij}\frac{n_{ij}}{n}\log\frac{n\,n_{ij}}{u_iv_j}$, in $[0,1]$ with arithmetic normalisation (the default of scikit-learn, scIB and OpenProblems). It is not corrected for chance and is biased upward when clusters are many and small [R14].
- **AMI**: $\big(I-\mathbb E[I]\big)/\big(\tfrac12(H(U)+H(V))-\mathbb E[I]\big)$ with the expectation under the same permutation model; the exact expectation is a costly sum over contingency tables [R14].
- **Homogeneity and completeness** [R15]: $h=1-H(C\mid K)/H(C)$ (each cluster holds one class) and $c=1-H(K\mid C)/H(K)$ (each class sits in one cluster), with $C$ the classes and $K$ the clusters; swapping the arguments swaps $h$ and $c$. Their harmonic mean, the V-measure, equals NMI with arithmetic normalisation (scikit-learn documentation), so it is not reported separately.
- **Purity**: $\frac1n\sum_i\max_j n_{ij}$ is maximal for one cell per cluster and is reported only with $\hat K$.
- **Matched macro-F1**: choose $\min(\hat K,L)$ distinct cluster-class pairs maximising $\sum n_{ij}$ (rectangular Hungarian matching); for class $j$ matched to cluster $i$, $F1_j=2n_{ij}/(u_i+v_j)$, and unmatched classes score 0; the score is the mean over all $L$ classes. It exposes rare-population loss and equals 1 only when the two partitions are identical up to relabelling.

### 3.4 Why heuristics work, and what a model adds

Graph partitioning works when populations appear as dense communities of a neighbourhood graph: most edges fall within populations, modularity rewards communities whose internal weight exceeds a degree-based expectation, and local moves scale to large graphs when memory allows. The same design is its limit: the graph is fixed before partitioning, so the partition is conditional on $k_{\mathrm{nn}}$, the metric and the number of PCs; the resolution is one scalar not calibrated to the number of populations; and no per-cell probability is produced.

A model-based formulation would add a posterior membership per cell, a likelihood that compares granularities by an information criterion, a fitted object reusable on new cells, and explicit covariates such as batch. None is an established benchmark win here, so these are proposals with falsification conditions (Section 5). Benchmarks add a caution: tuning the resolution on the scoring labels inflates ARI and NMI, and one resolution gives different $\hat K$ on different embeddings.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Leiden | heuristic | Local moving, refinement and aggregation that optimise modularity at resolution $\gamma$ or CPM and keep communities well connected | [R11] |
| Louvain | heuristic | Local moving and aggregation that optimise modularity, without a refinement step | [R10] |
| PhenoGraph | heuristic | kNN graph weighted by the Jaccard coefficient of neighbour sets, symmetrised by averaging with its transpose, then Louvain (Leiden optional); clusters of at most `min_cluster_size` cells are labelled $-1$ | [R16] |
| PARC | heuristic | HNSW kNN graph pruned locally by distance and globally by Jaccard weight, partitioned with leidenalg; clusters above a size fraction are re-clustered | [R18] |
| k-means | heuristic | Lloyd iterations minimise the within-cluster sum of squares for fixed $K$, seeded by k-means++ | [R12] |
| Gaussian mixture | model-based | EM fit of a finite Gaussian mixture; posterior responsibilities give soft membership and BIC can select $K$ | — |
| SC3 | hybrid | Euclidean, Pearson and Spearman distances, each transformed by PCA or graph-Laplacian eigenvectors, k-means on leading eigenvectors for each $K$, consensus matrix, hierarchical clustering | [R17] |

The published standard is Leiden or Louvain over a resolution grid, as in the scIB and OpenProblems metrics and the scanpy and Seurat defaults, with k-means at a known $K$ as the baseline. Exact defaults used for reproduction, with the protocol constants of the benchmarks of Section 8:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| scanpy `tl.leiden` | `resolution`; `n_iterations` | 1; −1 (runs to convergence) | `src/scanpy/tools/_leiden.py:57`, `:65` @8ed52d9 |
| scanpy `tl.leiden` | legacy `random_state` | 0 | `_leiden.py:54` @8ed52d9 |
| scanpy `tl.leiden` | flavor by preset | leidenalg (ScanpyV1, the default preset); igraph (ScanpyV2Preview) | `src/scanpy/_settings/presets.py:274-275`, `__init__.py:64` @8ed52d9 |
| scanpy `tl.leiden` | igraph flavor | objective `modularity`; directed graph raises an error | `_leiden.py:194`, `:241` @8ed52d9 |
| scanpy `pp.neighbors` | `n_neighbors` | 15 | `src/scanpy/neighbors/__init__.py:65` @8ed52d9 |
| leidenalg `find_partition` | `n_iterations` | 2 | `src/leidenalg/functions.py:21` @9890a99 |
| rapids-singlecell `tl.leiden` | `resolution`; `n_iterations` | 1.0; 100 | `src/rapids_singlecell/tools/_clustering.py:142`, `:149` @e110792 |
| Seurat `FindClusters` | `resolution`; `algorithm` | 0.8; 1 (1 original Louvain, 2 Louvain with multilevel refinement, 3 SLM, 4 Leiden) | `R/clustering.R:313`, `:315`, `:285-287` @5f67c70 |
| Seurat `FindClusters` | `n.start`; `n.iter`; `random.seed` | 10; 10; 0 | `R/clustering.R:318-320` @5f67c70 |
| Seurat `FindNeighbors` | `k.param`; `prune.SNN`; `nn.method` | 20; 1/15; `annoy` | `R/clustering.R:567`, `:570`, `:571` @5f67c70 |
| PhenoGraph `cluster` | `clustering_algo`; `k`; `jaccard` | `louvain`; 30; True | `phenograph/cluster.py:176-177`, `:181` @72a3e62 |
| PhenoGraph `cluster` | `min_cluster_size`; `q_tol`; `resolution_parameter`; `n_iterations` | 10; 1e-3; 1; −1 | `cluster.py:180`, `:186`, `:190-191` @72a3e62 |
| PhenoGraph `sort_by_size` | relabel rule | clusters with size $\le$ `min_size` get label −1 (the docstring says "smaller than") | `cluster.py:80` @72a3e62 |
| PARC | `knn`; `n_iter_leiden`; `random_seed` | 30; 5; 42 | `parc/_parc.py:14` @b568630 |
| PARC | `dist_std_local`; `jac_std_global`; `too_big_factor`; `small_pop`; `resolution_parameter` | 3; `'median'`; 0.4; 10; 1.0 | `parc/_parc.py:13-15` @b568630 |
| scikit-learn `KMeans` | `init`; `n_init`; `max_iter`; `tol`; `algorithm` | `k-means++`; `auto`; 300; 1e-4; `lloyd` | `sklearn/cluster/_kmeans.py:1376-1383` @85593ca |
| scikit-learn `GaussianMixture` | `covariance_type`; `n_init`; `max_iter`; `tol`; `init_params` | `full`; 1; 100; 1e-3; `kmeans` | `sklearn/mixture/_gaussian_mixture.py:767-774` @85593ca |
| SC3 `sc3` | `gene_filter`; `pct_dropout_min`/`max`; `d_region_min`/`max` | TRUE; 10/90; 0.04/0.07 | `R/AllGenerics.R:3-4` @5f5161b |
| SC3 `sc3` | `svm_max` (no SVM below this many cells); `kmeans_iter_max`; `rand_seed` | 5000; 1e9; 1 | `R/AllGenerics.R:5-6` @5f5161b |
| Splatter `SplatParams` | `de.prob`; `de.facLoc`; `de.facScale`; `bcv.common`; `lib.loc`; `dropout.type` | 0.1; 0.1; 0.4; 0.1; 11; none | `R/AllClasses.R:244-264` @eeb1dfc |
| scIB `cluster_optimal_resolution` | grid; ties | `get_resolutions(n=10, max=2)` = 0.2, 0.4, …, 2.0; first maximum wins (`score_max < score`) | `scib/metrics/clustering.py:111`, `:12-32`, `:135` @cd67913 |
| OpenProblems `clustering_performance` | grid; NMI normaliser | 0.1, 0.2, …, 2.0 (20 values), first maximum wins; `arithmetic` | `src/metrics/clustering_performance/script.py:22-23`, `:42`; `config.vsh.yaml:62` @360499d |
| OpenProblems `clustering_overlap` | grid; precomputed clusters | 0.2, 0.3, …, 0.8; Leiden with igraph flavor and `n_iterations=2` on CPU | `src/metrics/clustering_overlap/config.vsh.yaml:101`; `src/data_processors/precompute_clustering_run/script.py:34-35` @b3da9d6 |

## 5. Proposed singlet approach

Leiden and Louvain share one native C++/CUDA kernel (CSR graph, local moving, aggregation, and a refinement step for Leiden); routes per repository are in Section 12. Defaults an agent uses without asking: `leiden` with modularity, `resolution` 1.0, `n_iterations` −1, seed 0, on a kNN graph with $k_{\mathrm{nn}}=15$ from the first `n_pcs` columns of `X_pca` (`n_pcs` from dim-reduction.pc_number_selection, otherwise 30). `louvain` is the published comparator, `kmeans` the fixed-$K$ baseline. PhenoGraph is Louvain on a Jaccard-weighted `graph_key` graph (neighbors.edge_weighting_adaptive_kernel). `evaluation.tune_resolution` reproduces the scIB search; its output is flagged `tuned_on_labels` and must be reported as label-tuned.

**Model-based challenger.** A degree-corrected stochastic block model on the kNN graph (Karrer and Newman [R19]): $A_{ij}\sim\mathrm{Poisson}(\theta_i\theta_j\,\omega_{z_iz_j})$ for $i<j$, with block $z_i$, degree parameter $\theta_i$ and block matrix $\omega$. Variational EM gives posterior memberships $q(z_i)$, the MAP block is the hard label, and an information criterion chooses the number of blocks. The variational fit and the Poisson form for non-integer weights (a quasi-likelihood) are singlet's choices, not results of [R19]. It is falsified on B3 and B1 if its ARI at the true $K$ is more than 0.02 below Leiden's at $\gamma=1$; its posterior is miscalibrated (among cells with maximum posterior at least $p$, the fraction in the planted group is below $p-0.05$); its between-seed agreement is below Leiden's; or its information-criterion $\hat K$ matches the annotated granularity no better than a fixed resolution.

**Optional granularity selector.** A small model maps graph statistics (modularity-versus-resolution curve, cluster-size spectrum) to the resolution that best matches annotation, trained on annotated studies of the 354M-cell catalogue with splits by study. It is falsified if its held-out ARI does not exceed the default resolution's with a paired interval excluding zero, or if it tracks study annotation depth instead of embedding structure. It belongs to clustering.resolution_selection.

**Stack and devices.** PyTorch is used only for that selector. Local moving is an irregular sparse gather and scatter, so it and the k-means assignment are hard-coded CUDA kernels; aggregation is a sparse product (cuSPARSE). CPU runs the same kernels; `device=auto` selects CUDA when the graph fits in device memory. No streaming is claimed; atlas scale is scalability.scalable_graph_clustering.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/`<embedding_key>` | float32, $n \times d$ | PCs or batch-aware latent coordinates |
| read | obsp/`<graph_key>` | sparse float32, $n \times n$ | symmetric non-negative weighted kNN or shared-neighbour graph; replaces the in-call kNN build when set |
| read | obs/`<label_key>` | categorical | reference labels; used only for metrics and for the optional label-tuned resolution search |
| write | obs/`<cluster_key>` | int32 | cluster id per cell, ids ordered by decreasing cluster size; every cell is assigned |
| write | uns/`<cluster_key>`/params | dict | method, resolved parameters (including the selected resolution), seed, graph source, $\hat K$, `tuned_on_labels` |
| write | uns/`<cluster_key>`/modularity | float | $Q_1$ (Section 3.1 with $\gamma=1$, normalised by $2m$) of the final partition on the graph used; graph methods only |
| write | uns/`<cluster_key>`/metrics | dict | with `label_key`: ARI, NMI (arithmetic), AMI, homogeneity, completeness, purity, matched macro-F1, $\hat K$, $L$ (Section 3.3) |
| write | uns/`<cluster_key>`/contingency | int matrix, $\hat K \times L$ | counts $n_{ij}$; with `label_key` only |

No graph is written by this task; persisted graphs come from neighbors.approximate_knn_search.

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "leiden" | `leiden`, `louvain`, `kmeans` | leiden: default, graph method with modularity or CPM. louvain: graph method, modularity only, published comparator. kmeans: fixed K on the embedding. |
| `resolution` | number | 1.0 | > 0 | Granularity gamma for leiden and louvain; larger values tend to give more clusters. Ignored by kmeans. Defaults differ between tools. |
| `n_clusters` | integer/null | null | min 2 | Target number of clusters K. Required for kmeans; ignored by leiden and louvain. |
| `input` | object | — | — | Where cells and graph come from. |
| `input.embedding_key` | string | "X_pca" | — | obsm key with the embedding; builds the graph when graph_key is null and is used directly by kmeans. |
| `input.graph_key` | string/null | null | — | obsp key with a precomputed weighted graph; null builds a kNN graph from embedding_key. Refused for kmeans. |
| `input.n_pcs` | integer | 30 | min 1 | Leading embedding columns used; set to the k chosen by dim-reduction.pc_number_selection when available. |
| `input.n_neighbors` | integer | 15 | min 2 | Neighbours per cell for the in-call kNN graph; ignored when graph_key is set. |
| `leiden` | object | — | — | Options used only when method is leiden. |
| `leiden.n_iterations` | integer | -1 | min -1 | Iteration limit; -1 iterates until no node moves, a positive value caps the iterations; 0 is invalid. |
| `leiden.objective` | string | "modularity" | `modularity`, `CPM` | Quality function: modularity with resolution gamma, or the constant Potts model. |
| `evaluation` | object | — | — | Agreement with reference labels; labels never influence the partition unless tune_resolution is true. |
| `evaluation.label_key` | string/null | null | — | obs column with reference labels; when set, metrics and the contingency table are written. |
| `evaluation.tune_resolution` | boolean | false | — | Choose resolution as the NMI-maximising grid value against label_key. Label-circular: output is flagged tuned_on_labels. Graph methods only. |
| `evaluation.resolution_grid` | array/null | null | — | Resolutions searched when tune_resolution is true; null uses 0.2, 0.4, ..., 2.0 (scIB grid). |
| `cluster_key` | string | "partition" | — | Output name: writes obs/<cluster_key> and uns/<cluster_key>. Existing members are replaced only when overwrite is true. |
| `seed` | integer | 0 | min 0 | Random seed for local-move order and k-means seeding. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated seconds, peak memory and device without writing anything. |
| `overwrite` | boolean | false | — | Replace existing obs/<cluster_key> and uns/<cluster_key> members instead of failing. |
<!-- PARAMS:AUTO:END -->

`resolution` applies to `leiden` and `louvain`; `n_clusters` is required for `kmeans` and ignored otherwise. `leiden.*` options are refused for other methods, and `louvain` always optimises modularity. When `input.graph_key` is set, `n_neighbors` is ignored and `kmeans` is refused because it uses only the embedding; an `n_pcs` larger than the embedding width is refused. `evaluation.tune_resolution` requires `evaluation.label_key` and a graph method; it replaces `resolution` by the NMI-optimal grid value (default grid 0.2, 0.4, …, 2.0; first maximum on ties) and sets `tuned_on_labels`. Without `label_key` no metrics or contingency are written. Labels are reproducible only for the same seed, thread count and device.

## 7. MCP tool

Tool name `singlet_clustering_cell_partitioning` (definition in `tasks/mcp/singlet_clustering_cell_partitioning.json`).

```json
{"dataset": "/data/atlas.singlet", "method": "leiden", "resolution": 1.0,
 "input": {"embedding_key": "X_pca", "n_pcs": 30, "n_neighbors": 15},
 "evaluation": {"label_key": "cell_type"}, "cluster_key": "partition", "seed": 0}
```

```json
{"dataset": "/data/atlas.singlet", "status": "completed",
 "wrote": ["obs/partition", "uns/partition/params", "uns/partition/modularity",
           "uns/partition/metrics", "uns/partition/contingency"],
 "summary": {"method": "leiden", "n_clusters": "<int>", "resolution": 1.0,
   "modularity": "<float>", "smallest_cluster": "<int>", "disconnected_clusters": "<int>",
   "tuned_on_labels": false, "metrics": {"ari": "<float>", "nmi": "<float>", "ami": "<float>"}},
 "provenance_id": "<id>", "job_id": null}
```

- **Long-running**: yes for graph methods at large $n$; the call may return `queued` with a `job_id`.
- **Stochastic**: yes; `seed` fixes local-move order and k-means seeding.
- **Dry-run**: estimated seconds, peak memory in GB and device, from $n$, stored edges (or $n\,k_{\mathrm{nn}}$), method and device; calibrated in P1.

## 8. Benchmarks

**Shared protocol.** Each dataset is embedded once and one graph is built per dataset ($k_{\mathrm{nn}}=15$ unless stated); every comparator that accepts a graph receives the same one. Stochastic methods run with seeds 0 to 4 and results are reported as mean and range. Every score is reported with $\hat K$ and with a label stating whether labels chose the granularity ("tuned") or the granularity was fixed ("fixed"). Metrics are those of Section 3.3, called as (truth, prediction). Comparator defaults and published grids are in the defaults table of Section 4. Unless stated, the embedding is the `X_pca` written by dim-reduction.normalized_cell_embedding with that task's defaults.

### B1. Label agreement after a resolution search (scIB and OpenProblems protocols; published)

- **Goal**: reproduce the label-tuned clustering scores of scIB [R2] and the OpenProblems metrics, and place singlet's Leiden among their implementations.
- **Ground truth**: expert or curated `cell_type` labels of the task's solution file. The estimand is ARI and NMI (arithmetic normaliser, in $[0,1]$) between those labels and the Leiden partition at $r^\*=\arg\max_{r\in\mathcal R}\mathrm{NMI}$, with $\mathcal R$ the grid of the protocol; ties resolve to the smallest resolution.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_mouse_pancreas_atlas | test resource of openproblems-bio/task_dimensionality_reduction (`src/metrics/clustering_performance/script.py`) | scRNA-seq, mouse pancreas, — | — | embedding and solution files |
| cxg_immune_cell_atlas | test resource of openproblems-bio/task_batch_integration (`src/metrics/clustering_overlap/script.py`) | scRNA-seq, —, — | — | integrated embedding and solution files |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI at $r^\*$ | Section 3.3 | higher is better, $\le 1$ | primary | [R13] |
| NMI at $r^\*$ | Section 3.3, arithmetic | higher is better, 0 to 1 | primary | [R2] |
| $\hat K$ at $r^\*$ | number of non-empty clusters | reported | guardrail | — |

- **Comparators**: scanpy Leiden (igraph and leidenalg flavours, `n_iterations` 2 and −1); singlet Leiden (`n_iterations` −1 and 2) and Louvain; k-means with $K=L$; rapids-singlecell Leiden.
- **Protocol**: the three published grids (Section 4), each reported separately because scores from different grids are not comparable.
- **Acceptance criterion** (proposed): (i) singlet ARI and NMI equal scikit-learn's to within $10^{-9}$ on identical label vectors; (ii) singlet native Leiden NMI at $r^\*$ is within 0.01 of scanpy-igraph Leiden (mean over seeds) on both datasets; (iii) the same $r^\*$ is selected in at least 80 percent of dataset-seed pairs.
- **Known pitfalls**: the clustering_overlap configuration describes NMI-optimised Louvain, while its script scores precomputed Leiden clusters; singlet states which it reproduces. scIB's `nmi` and `ari` take (adata, cluster_key, label_key) but `cluster_optimal_resolution` calls its metric as (adata, label_key, cluster_key); this is harmless for symmetric NMI and ARI but would swap an asymmetric metric such as homogeneity.

### B2. CellBench cell-line mixtures (published)

- **Goal**: recovery of cell-line identity in single-cell mixtures, where the truth is fixed by the experimental design and not by clustering choices (Tian et al. [R20]).
- **Ground truth**: orthogonal measurement. Each cell carries the cell-line label (HCC827, H1975 or H2228) stored in the `cell_line_demuxlet` column of `colData`; the estimand is ARI and matched macro-F1 between that label and the partition. Cells without one of the three labels are excluded.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 10x Chromium (`sce10x_qc`) | LuyiTian/CellBench_data, `data/sincell_with_class.RData`; GEO GSE118767 | scRNA-seq, human lung adenocarcinoma cell lines, — | — | after QC by the authors |
| CEL-seq2 (`sce4_qc`) | same file and accession | same, — | — | one protocol per row; not pooled |
| Drop-seq (`scedrop_qc_qc`) | same file and accession | same, — | — | |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI vs cell line | Section 3.3 | higher is better | primary | [R13] |
| Matched macro-F1 | Section 3.3 (rectangular matching) | higher is better, 0 to 1 | primary | — |
| $\lvert\hat K-3\rvert$ | absolute difference to the three cell lines | lower is better | guardrail | — |

- **Comparators**: singlet Leiden and Louvain at fixed $\gamma=1$; scanpy Leiden at $\gamma=1$; k-means and Gaussian mixture at $K=3$; SC3 at $K=3$ where it runs.
- **Protocol**: QC and normalisation without labels; scores per protocol.
- **Acceptance criterion** (proposed): singlet Leiden ARI within 0.02 of scanpy Leiden on each protocol, and at least one of Leiden ($\gamma=1$) and k-means ($K=3$) reaches ARI of at least 0.9 on each protocol.
- **Known pitfalls**: three well-separated lines make the benchmark insensitive to granularity; the protocols differ in chemistry and depth, so they are never pooled.

### B3. Splatter planted groups with tunable separation (proposed)

- **Goal**: recovery of planted groups as separation varies, with exact truth, and the falsification test of the block model (Section 5).
- **Ground truth**: planted simulation. The `Group` factor that Splatter stores in `colData`; the estimand is ARI, AMI and $\lvert\hat K-K\rvert$ against that factor.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter groups simulations | Splatter [R21], `splatSimulate(method="groups")`; generated by the recipe below | synthetic scRNA-seq, 5,000 genes, $n\in\{2{,}000;20{,}000\}$ cells | — | $K\in\{5,10\}$, 4 separations, 5 seeds |

  Generator recipe: (1) `nGenes` 5,000, `batchCells` $n$, `group.prob` $=(1/K,\dots,1/K)$; (2) `de.prob` at its default and `de.facLoc` $\in\{0.05,0.1,0.2,0.4\}$, all other parameters at the Splatter defaults (Section 4); (3) one count matrix per (K, n, separation, seed); (4) preprocess with the singlet defaults without labels, 2,000 highly variable genes and 30 PCs, then build the kNN graph; (5) truth is the `Group` column.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | partition vs `Group` | higher is better | primary | [R13] |
| AMI | partition vs `Group` | higher is better | primary | [R14] |
| $\lvert\hat K-K\rvert$ | absolute difference to the planted group count | lower is better | guardrail | — |

- **Comparators**: singlet Leiden and Louvain at $\gamma=1$ (fixed); k-means and Gaussian mixture at true $K$; PARC; the block model of Section 5.
- **Protocol**: no tuning on labels; for the block model the information-criterion $\hat K$ is reported next to the fixed-$K$ fit.
- **Acceptance criterion** (proposed): singlet Leiden mean ARI within 0.02 of scanpy Leiden on the same graph; mean ARI non-decreasing in `de.facLoc` at fixed $K$ and $n$. The generator is accepted only if k-means at true $K$ reaches ARI of at least 0.9 at `de.facLoc` 0.4.
- **Known pitfalls**: simulated groups have no hierarchy and are not cell types; library-size and dropout settings at Splatter defaults can make groups easier than real data.

### P1. Performance and scaling

- **Scales**: $n=10^4$, $10^5$, $10^6$ for all methods and $10^7$ for graph methods where memory permits; seeded subsamples of the singlet catalogue embedded with the defaults of dim-reduction.normalized_cell_embedding, graphs from neighbors.approximate_knn_search (timed separately).
- **Hold fixed**: graph, $\gamma=1$, seed, thread count (one and all) and device; `n_iterations` −1 and 2 for every Leiden implementation, because comparator defaults differ (Section 4).
- **Metrics**: wall-clock seconds of the partition step, peak memory in GB and per stored edge, cells per second, final $Q_1$, $\hat K$.
- **Comparators**: scanpy igraph and leidenalg Leiden; rapids-singlecell Leiden on GPU; Seurat Louvain and Leiden; PhenoGraph; PARC; scikit-learn k-means at $K=L$.
- **Acceptance criterion** (proposed): singlet CPU Leiden within 1.5 times the wall time of scanpy-igraph at $10^5$ cells and final $Q_1$ within 0.5 percent (relative) of its mean; CUDA at least 5 times faster than singlet CPU at $10^6$; three repeated calls with the same seed, threads and device return identical labels. Published GPU speed-up figures are not used as criteria.
- **Known pitfalls**: implementations visit nodes in different orders, so equal modularity at a fixed seed is not expected; graph construction can dominate and is reported separately.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `neighbors.edge_weighting_adaptive_kernel`: Edge weighting of kNN graphs: SNN/Jaccard, adaptive kernels and symmetrisation
- **Feeds**:
  - `clustering.resolution_selection`: Choosing clustering resolution without reference labels
  - `clustering.cluster_stability`: Cluster stability under resampling and perturbation
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `ambient.contamination_fraction`: Contamination fraction estimation
- **Reads**: `obsm/<embedding_key>`, `obsp/<graph_key>`, `obs/<label_key>`
- **Writes**: `obs/<cluster_key>`, `uns/<cluster_key>/params`, `uns/<cluster_key>/modularity`, `uns/<cluster_key>/metrics`, `uns/<cluster_key>/contingency`
<!-- CHAINING:AUTO:END -->

The task belongs to the standard graph-clustering workflow of the single-cell best-practices material: normalise, select features, reduce dimension, build the neighbour graph, partition, embed for visualisation, rank marker genes.

## 10. Risks, pitfalls and open questions

- **Seed, iterations and connectivity.** The seed dependence of partitions is not characterised, and the best-practices chapter states that Leiden avoids disconnected clusters at two iterations, which was not checked against [R11]; the output reports `disconnected_clusters`. First experiment: B1 on one dataset with a fixed graph, both `n_iterations` settings and two seeds, comparing the between-seed change with the between-algorithm change before any claim about either.
- **Evidence limits.** For Leiden, Louvain, PhenoGraph, SC3 and PARC the primary papers were checked at record level (title, venue, DOI) and the algorithms were read from code and documentation. The dataset list, per-dataset results and method ranking of Duò et al. [R3] are not available in the sources read, so it is cited at design level and is not a numbered benchmark; the same holds for the scIB atlas list and the OpenProblems production datasets (sizes, species, licences). The journal volume and pages of [R19] are not confirmed.
- **Not covered.** Walktrap, SIMLR, CIDR, RaceID3, hierarchical (Ward, average linkage), spectral and t-SNE or UMAP followed by k-means are not listed because neither their primary papers nor their code were read; add them after reading.
- **Block model and selector.** Neither has a validated result; the Poisson likelihood for non-integer edge weights is a quasi-likelihood. B3 is the first test.
- **Orthogonal truth.** FACS-purified PBMC populations of Zheng et al. [R22] are a candidate next benchmark; its population list, accession and licence are not stated in the sources read.
- **Reproducibility across tools.** Default `n_iterations` ranges from 2 to 100 across tools (Section 4) and resolution defaults differ, so cluster counts are not comparable across tools without matching settings.

## 11. References

R1. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R2. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2021. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R3. Duò A, Robinson MD, Soneson C. A systematic performance evaluation of clustering methods for single-cell RNA-seq data. *F1000Research* 2018;7:1141. doi:10.12688/f1000research.15666.1 — verified (corpus)
R4. Freytag S, Tian L, Lönnstedt I, Ng M, Bahlo M. Comparison of clustering tools in R for medium-sized 10x Genomics single-cell RNA-sequencing data. *F1000Research* 2018. doi:10.12688/f1000research.15809.1 — verified (corpus)
R5. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)
R6. Reichardt J, Bornholdt S. Statistical mechanics of community detection. *Physical Review E* 2006;74(1):016110. doi:10.1103/PhysRevE.74.016110 — verified (repo)
R7. Newman MEJ, Girvan M. Finding and evaluating community structure in networks. *Physical Review E* 2004;69(2):026113. doi:10.1103/PhysRevE.69.026113 — verified (repo)
R8. Fortunato S, Barthélemy M. Resolution limit in community detection. *Proceedings of the National Academy of Sciences* 2007;104(1):36-41. doi:10.1073/pnas.0605965104 — verified (search)
R9. Traag VA, Van Dooren P, Nesterov Y. Narrow scope for resolution-limit-free community detection. *Physical Review E* 2011;84(1):016114. doi:10.1103/PhysRevE.84.016114 — verified (repo)
R10. Blondel VD, Guillaume JL, Lambiotte R, Lefebvre E. Fast unfolding of communities in large networks. *Journal of Statistical Mechanics: Theory and Experiment* 2008. doi:10.1088/1742-5468/2008/10/p10008 — verified (corpus)
R11. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)
R12. Arthur D, Vassilvitskii S. k-means++: the advantages of careful seeding. *Proceedings of the eighteenth annual ACM-SIAM symposium on Discrete algorithms* 2007. — verified (repo)
R13. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R14. Vinh NX, Epps J, Bailey J. Information theoretic measures for clusterings comparison: variants, properties, normalization and correction for chance. *Journal of Machine Learning Research* 2010;11. — verified (repo)
R15. Rosenberg A, Hirschberg J. V-measure: a conditional entropy-based external cluster evaluation measure. 2007. ACL Anthology D07-1043. — partial (repo)
R16. Levine JH, Simonds EF, Bendall SC, et al. Data-driven phenotypic dissection of AML reveals progenitor-like cells that correlate with prognosis. *Cell* 2015. doi:10.1016/j.cell.2015.05.047 — verified (corpus)
R17. Kiselev VY, et al. SC3: consensus clustering of single-cell RNA-seq data. *Nature Methods* 2017. doi:10.1038/nmeth.4236 — partial (corpus)
R18. Stassen S, et al. PARC: ultrafast and accurate clustering of phenotypic data of millions of single cells. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa042 — partial (corpus)
R19. Karrer B, Newman MEJ. Stochastic blockmodels and community structure in networks. 2010. arXiv:1008.3926 (preprint) — partial (search)
R20. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R21. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R22. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/vtraag/leidenalg | V.A. Traag (pyproject.toml) | GPL-3.0-or-later (pyproject.toml); LICENSE is the GNU GPL v3 | Reference Leiden and CPM implementation; comparator | reimplement |
| https://github.com/scverse/scanpy | scverse; maintainers Ilan Gold, Philipp Angerer, Severin Dicks (pyproject.toml) | BSD-3-clause (pyproject.toml) | Defaults and `tl.leiden` comparator | callout |
| https://github.com/satijalab/seurat | Rahul Satija and contributors (Authors@R in DESCRIPTION) | MIT + file LICENSE (DESCRIPTION) | Louvain and Leiden defaults; comparator | callout |
| https://github.com/dpeerlab/phenograph | Jacob Levine (`version.py`) | MIT (LICENSE) | PhenoGraph reference; comparator | callout |
| https://github.com/ShobiStassen/PARC | ShobiStassen (copyright holder in LICENSE) | MIT (LICENSE; setup.py) | Scale comparator | callout |
| https://github.com/hemberg-lab/sc3 | Vladimir Kiselev, Andrew Yiu, Tallulah Andrews (Authors@R in DESCRIPTION) | GPL-3 (DESCRIPTION); LICENSE is the GNU GPL v3 | Consensus comparator | callout |
| https://github.com/scikit-learn/scikit-learn | The scikit-learn developers (COPYING) | BSD-3-Clause (pyproject.toml; COPYING) | `KMeans` and `GaussianMixture` comparators; metric semantics | callout |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (pyproject.toml) | MIT (LICENSE) | GPU Leiden comparator in P1 | callout |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt; pyproject.toml) | Label-tuned protocol and metrics for B1 | callout |
| https://github.com/openproblems-bio/task_dimensionality_reduction | Open Problems in Single-Cell Analysis (copyright holder in LICENSE) | MIT (LICENSE) | clustering_performance protocol for B1 | callout |
| https://github.com/openproblems-bio/task_batch_integration | Open Problems in Single-Cell Analysis (copyright holder in LICENSE) | MIT (LICENSE) | clustering_overlap protocol for B1 | callout |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian (copyright holder in LICENSE) | MIT (LICENSE) | Data source for B2 | callout |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Christina Azodi, Alicia Oshlack (Authors@R in DESCRIPTION) | GPL-3 + file LICENSE (DESCRIPTION) | Simulator for B3 | callout |
| https://github.com/theislab/single-cell-best-practices | Theislab (copyright holder in LICENSE) | Apache License 2.0 (LICENSE) | Recommended settings and workflow description | callout |
