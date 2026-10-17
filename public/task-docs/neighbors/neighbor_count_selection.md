---
id: neighbors.neighbor_count_selection
title: Choice of neighbour count k and graph stability
area: neighbors
scope: core
paradigm: heuristic
literature_status: contested
priority: P0
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection]
feeds: [neighbors.approximate_knn_search, neighbors.edge_weighting_adaptive_kernel, clustering.cell_partitioning, clustering.resolution_selection]
reads: [obsm/<use_rep>, obs/<reference_label_key>, obs/<score_mask_key>]
writes: [uns/<key>/table, uns/<key>/selection, obs/<key>_leiden_k<k>]
devices: [cpu, cuda]
mcp_tool: singlet_neighbors_neighbor_count_selection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Choice of neighbour count k and graph stability

> Choose the number of neighbours by a stated, label-free rule (the smallest k whose Leiden partition survives cell subsampling) and report the label-based sensitivity curve beside it, at a fixed embedding, clustering resolution and seed.

## 1. Question

Given a cell embedding $X\in\mathbb{R}^{n\times p}$, a grid $K=\{k_1<\dots<k_r\}$ of candidate neighbour counts, a fixed Leiden resolution $\gamma$ and a seed, which $k\in K$ gives a kNN graph whose partition survives random cell subsampling and, where reference labels exist, recovers the labelled populations? The output is one chosen $k$, a per-$k$ table of partition stability, label agreement and connectivity, and optionally one partition per $k$. The literature has no ground truth for $k$ itself. The accepted proxies are recovery of expert labels at a stated granularity, connectivity of each label in the graph, and reproducibility across subsamples.

## 2. Why this task matters and where the field stands

Every graph-based step reads one scale parameter, the neighbour count: clustering on kNN or shared-nearest-neighbour graphs, two-dimensional layouts, trajectory methods and kNN label transfer [R1][R3]. It is usually left at a default that is never checked: 15 in Scanpy and UMAP, 20 in Seurat and 30 in the Scanpy wrapper of PhenoGraph (section 4). The counting conventions differ, because Scanpy and UMAP count the cell itself and PhenoGraph does not, so nominal values are not comparable.

The status is **contested**. The defaults are conventions, and none is derived from a benchmark of $k$. The methods disagree on how to choose: sweep $k$ against labels, test whether partitions survive subsampling, or keep the default. Label-based and stability-based criteria answer different questions and can disagree.

Open problems:

- Choosing $k$ by ARI or NMI against labels and then reporting the same score is optimistic. The OpenProblems clustering metric takes the maximum NMI over 20 resolutions with the arithmetic normaliser [R15], so its values are upper bounds. It builds the Scanpy default graph unless the input already carries one, so unmodified it does not score $k$.
- chooseR is a label-free robustness method for clustering parameters, and its published example sweeps resolution, not $k$ [R7]. Subsample stability of clusterings was introduced by Ben-Hur et al. [R8]. Reviews describe the general difficulty of evaluating partitions without labels [R9].
- The interaction of $k$ with the number of principal components, the dependence of the best $k$ on label granularity, and any rule relating the best $k$ to $n$ are uncharacterised.

## 3. Theory and insight

### 3.1 Notation

| Symbol | Meaning |
|---|---|
| $n$, $p$ | cells; embedding columns used (`n_pcs`) |
| $q$ | intrinsic dimension of the cell-state manifold |
| $k$ | list length including the cell itself (Scanpy `n_neighbors`), so each cell has $k-1$ other neighbours |
| $\mathcal N_k(i)$ | the $k-1$ nearest other cells of $i$, by Euclidean distance $d_{ij}$ |
| $G_k$ | graph from the $k$-prefix of every list |
| $\gamma$ | Leiden resolution, fixed across $k$ |
| $f$, $S$, $n_s$ | subsample fraction, a subsample of $\lfloor fn\rfloor$ cells, number of subsamples |
| $P_k$, $P^S_k$ | Leiden partitions of $G_k$ on all cells and of the graph rebuilt inside $S$ |

### 3.2 Scale

Treat cells as draws from a density $p(x)$ on a $q$-dimensional support, with $V_q$ the unit-ball volume. Setting the expected count $n\,p(x)V_qr^q$ in a ball of radius $r$ to $k-1$ gives

$$r_k(x)\approx\Big(\frac{k-1}{n\,V_q\,p(x)}\Big)^{1/q}.$$

This is derived here. It holds for $1\ll k\ll n$ with $p$ smooth and nearly constant over $r_k$. It fails at the support boundary, in populations of fewer than about $k$ cells (their lists leave the population) and where $p$ varies on the scale of $r_k$. Rank-based lists adapt to density, so the same $k$ spans different distances in dense and sparse regions. For a uniform subsample, $n\to fn$ gives $r^S_k\approx f^{-1/q}r_k$, independent of $k$ (1.12 for $f=0.8$, $q=2$): at first order subsampling shifts the scale equally across the grid. Second-order effects and the real $q$ are uncharacterised.

### 3.3 The UMAP calibration and fuzzy union

For each cell, $\sigma_i$ solves

$$\sum_{j\in\mathcal N_k(i)}\exp\!\Big(-\frac{\max(0,\,d_{ij}-\rho_i)}{\sigma_i}\Big)=\log_2 k,$$

where $\rho_i$ is the smallest non-zero distance in the list and the summands are the directed memberships $w_{ij}$. The sum runs over the $k-1$ other neighbours and the target uses the list length $k$ (section 4 defaults). The left side increases strictly in $\sigma_i$ from 1 (the nearest neighbour contributes 1) to $k-1$, so a root with $\sigma_i>0$ exists only if $1<\log_2 k<k-1$, that is $k\ge3$. Directed memberships combine by fuzzy union,

$$w^{\mathrm{sym}}_{ij}=w_{ij}+w_{ji}-w_{ij}w_{ji}.$$

This is a probabilistic OR under independence. When $i$ and $j$ share most neighbours the memberships are positively dependent and the formula overstates the union (derived here, size uncharacterised).

### 3.4 Shared-neighbour weights and the prune

For neighbour sets of size $m$ sharing $s$ members the Jaccard weight is $J_{ij}=s/(2m-s)$. PhenoGraph uses $m=k$ without the cell, Seurat $m=$`k.param`, and Scanpy's `jaccard` method $m=k-1$ (section 4). Seurat keeps an edge when $J\ge\tau$, that is $s\ge 2m\tau/(1+\tau)$. At $\tau=1/15$ and $m=20$ this needs $\lceil m/8\rceil=3$ shared neighbours. The absolute threshold tightens as $k$ grows, so pruning and $k$ are coupled.

### 3.5 Criteria that score a graph

**Label agreement.** $\mathrm{ARI}=(\mathrm{RI}-E[\mathrm{RI}])/(\max\mathrm{RI}-E[\mathrm{RI}])$ [R14][R13], zero in expectation for random partitions with equal marginals. $\mathrm{NMI}=I(X;Y)/\mathrm{mean}(H(X),H(Y))$ with the arithmetic mean [R15]; it is not chance-corrected and grows with the number of clusters, so compare it only at similar granularity.

**Graph connectivity** [R12]. $\mathrm{GC}=\frac1{|C|}\sum_{c\in C}|\mathrm{LCC}(G_c)|/|c|$, with $G_c$ the subgraph of $G_k$ induced by label class $c$ and LCC its largest connected component (scib applies `connected_components(connection="strong")` to the symmetric connectivities). The UMAP connectivity has the union of the neighbour lists as support. Under exact search with consistent tie-breaking these lists are nested in $k$, so GC is non-decreasing in $k$ and GC alone favours large $k$. A prune, or Jaccard weights (zero-overlap edges are dropped), can break this.

**Partition stability.** With $P_k|_S$ the full-data partition restricted to $S$,

$$\mathrm{PStab}(k)=\mathbb E_S\big[\mathrm{ARI}\big(P_k|_S,\;P^S_k\big)\big].$$

It is the agreement between the partition from all cells and the one from a random fraction $f$ of them, 1 for identical partitions and near 0 for unrelated ones. Its reference is the seed floor, the mean ARI between full-data Leiden partitions from different seeds: a value at the floor means subsampling adds no instability beyond Leiden randomness. PStab is comparable only at equal $f$, $n_s$ and $\gamma$, includes the density shift of section 3.2, and is uninformative for a $k$ whose partition has one cluster.

**Why not neighbour overlap.** With exact search and a fixed embedding, a full-data neighbour of $i$ that lies in $S$ stays among the $k-1$ nearest in $S$, because its rank can only fall. The retained fraction is $\mathrm{Binomial}(k-1,f)/(k-1)$ with mean $f$ whatever the data (ties aside), so list overlap under cell subsampling carries no information.

### 3.6 The selection problem

$$\hat k=\min\{k\in K:\ \mathrm{PStab}(k)\ge\tau_s\},$$

with the fallback $\arg\max_k\mathrm{PStab}(k)$ when the set is empty. The label-based rule, for benchmarking only, is

$$\hat k_{\mathrm{lab}}=\min\{k\in K^{\ast}:\ \mathrm{ARI}(k)\ge\max_{K^{\ast}}\mathrm{ARI}-\delta\},\quad K^{\ast}=\{k:\mathrm{PStab}(k)\ge\tau_s\}.$$

The co-clustering rule follows chooseR [R7]: $F^{(k)}_{ij}$ is the fraction of subsamples containing both cells in which they share a cluster, and $\hat k$ maximises the median silhouette of $P_k$ on the distance $1-F^{(k)}$. The same subsample partitions $P^S_k$ serve both label-free rules. All rules prefer the smaller of two adequate values. They are statements about a finite grid, not estimates of an optimum.

### 3.7 Failure modes and what a model adds

- **Technical axes dominate the embedding**: distances reflect depth, not state, and every criterion inherits this.
- **Populations smaller than $k$**: their GC is reported separately.
- **Fixed $\gamma$**: the cluster count changes with $k$, so ARI curves mix graph and cluster-count effects. Report it beside every score.
- **Label-selected $k$ scored on the same labels** is optimistic, and silhouette can favour compact, over-merged clusters.

Rank-based lists are robust to density variation, and a moderate $k$ connects each population while staying local, which makes the defaults reasonable starting points; no benchmark read establishes any as optimal. The UMAP calibration is already a model step (memberships fitted to a stated total, target fixed rather than estimated). A model-based $k$ would add calibrated uncertainty and a held-out objective; no likelihood for $k$ appears in the literature read.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Scanpy `sc.pp.neighbors` | hybrid | kNN search, then connectivities by method `umap` (default), `gauss` or `jaccard`; `n_neighbors` counts the cell itself | [R1][R2] |
| UMAP fuzzy simplicial set | hybrid | per-cell bandwidth solved so that memberships to the $k-1$ neighbours sum to $\log_2 k$; directed memberships combined by fuzzy union | [R2] |
| Seurat `FindNeighbors` | heuristic | kNN lists (Annoy by default), then a shared-neighbour graph with Jaccard weights; edges below `prune.SNN` dropped | [R3] |
| PhenoGraph | heuristic | Jaccard-weighted kNN graph ($k$ neighbours, cell excluded); Louvain is the default clusterer in the Scanpy wrapper | [R4][R5] |
| Leiden | heuristic | community detection that guarantees well-connected communities; the fixed clusterer of every sweep here | [R6] |
| chooseR | hybrid | re-clusters 100 subsamples of 80% of the cells per resolution; co-clustering frequency; silhouette of the full-data clusters on $1-F$; BCa interval of the median | [R7] |

The de facto standard is the UMAP connectivity of Scanpy at 15 neighbours followed by Leiden, and Seurat's SNN graph at 20 in its ecosystem. None is derived from a benchmark of $k$. chooseR is the nearest published label-free method but selects a resolution. The OpenProblems clustering metric is the standard reporting metric for label agreement, with the caveat in section 2. The subsampling idea of Ben-Hur et al. [R8] has no code base read here, and the partition stability of section 3.5 is a new design.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| Scanpy | `n_neighbors` | 15 | src/scanpy/neighbors/\_\_init\_\_.py:65 @ 8ed52d9 |
| Scanpy | `n_pcs`, `knn`, `method` | None, True, "umap" | neighbors/\_\_init\_\_.py:66, :70, :71 |
| Scanpy | documented range of `n_neighbors`; self counted | 2 to 100; each row has `n_neighbors`−1 non-zero distances | neighbors/\_\_init\_\_.py:98, :158 |
| Scanpy | connectivity methods | `umap`, `gauss`, `jaccard` | neighbors/\_\_init\_\_.py:115-117 |
| Scanpy | `jaccard` weight and symmetrisation | shared/(2(`n_neighbors`−1)−shared), self excluded; averaged with the transpose | neighbors/_connectivity.py:163, :174, :184 |
| Scanpy | Leiden `resolution` | 1 | src/scanpy/tools/_leiden.py:57 |
| Scanpy PhenoGraph wrapper | `k`, `clustering_algo` | 30, "louvain" | src/scanpy/external/tl/_phenograph.py:38, :36 |
| UMAP | `n_neighbors` | 15 | umap/umap_.py:1752 @ 33d7e6f |
| UMAP | `set_op_mix_ratio`, `local_connectivity` | 1.0, 1.0 | umap/umap_.py:1765, :1766 |
| UMAP | calibration target; terms summed | $\log_2 k$ with $k$=`n_neighbors`; columns 1 to $k-1$ (column 0 is the cell) | umap/umap_.py:192, :234, :591-593 |
| UMAP | bandwidth floor | 1e-3 × mean distance | umap/umap_.py:58, :259 |
| UMAP | fuzzy union when `set_op_mix_ratio`=1.0 | $w+w^{\top}-w\circ w^{\top}$ | umap/umap_.py:611-614 |
| Seurat | `k.param` | 20 | R/clustering.R:567 @ 5f67c70 |
| Seurat | `prune.SNN` | 1/15 | R/clustering.R:570 |
| Seurat | `nn.method`, `n.trees` | "annoy", 50 | R/clustering.R:571, :572 |
| Seurat | SNN weight; edge kept when | shared/(2k−shared); weight ≥ prune | src/snn.cpp:59, :61 |
| PhenoGraph | neighbours searched; weight | $k+1$ searched, self removed; shared/(2$k$−shared) | phenograph/core.py:51, :124 @ 72a3e62 |
| chooseR | subsamples; fraction | 100; 0.8 | examples/1_seurat_pipeline.R:39-40 @ 410bdbf |
| chooseR | resolution grid | 0.8, 1, 1.2, 1.6, 2, 4, 6, 8, 12, 16 | examples/1_seurat_pipeline.R:17 |
| chooseR | BCa interval of the median | 25000 resamples, level 0.95 | R/pipeline.R:193 |
| chooseR | subsample clustering | `FindNeighbors` on the existing reduction, then `FindClusters` | R/helper_functions.R:3-4, :40 |
| scib | graph connectivity | `connected_components(connection="strong")` on `connectivities` | scib/metrics/graph_connectivity.py:53-54 @ cd67913 |
| OpenProblems `clustering_performance` | resolutions; NMI normaliser; graph | 0.1 to 2.0 in 20 steps; arithmetic; Scanpy neighbours only if absent | src/metrics/clustering_performance/script.py:22-23, :30; config.vsh.yaml:60-62 @ 360499d |

## 5. Proposed singlet approach

Routes per method are in section 12. The proposed default is `partition_stability`.

**Procedure.** (1) Validate: no missing values; $k\ge3$ for the `umap` graph; subsample size above $k_{\max}$. (2) Search all cells once at $k_{\max}$ (cell included); every $k$ is a prefix of the sorted lists. (3) For each $k$, build $G_k$ and run Leiden at $\gamma$. (4) With labels, score ARI, NMI and GC on labelled, unmasked cells. (5) For each of $n_s$ subsamples, search inside $S$ at $k_{\max}$, build the graph and $P^S_k$ for every $k$, then compute $\mathrm{PStab}(k)$, its spread and the seed floor. (6) Only for `coclustering_robustness`: tally $F^{(k)}$ from the same partitions, compute the silhouette of $P_k$ on $1-F^{(k)}$ and a BCa 95% interval from 25000 resamples; the $n\times n$ matrix is as in chooseR, and the call is refused when it does not fit in memory (the dry run reports its size). (7) Select $\hat k$ by section 3.6 and record any fallback. Per-$k$ graphs are not stored; the final graph is built by `neighbors.approximate_knn_search`.

**Model-based position.** The tool is heuristic by design: PStab with its spread is a reproducibility estimate, not a likelihood. A held-out option would treat $k$ as the hyperparameter of a per-cell adaptive kernel and score it by predicting held-out cells from training-cell lists. It is untested and enters only if B1 or B3 show the stability rule insufficient. The rule is falsified if the B1 acceptance criterion fails, PStab if the permuted control of B3 does not lower it, and the calibration port if its connectivities differ from UMAP at the pinned commit beyond float tolerance.

**Machine learning and kernels.** No learned parameter or trained resource; PyTorch is not needed. Kernels: blocked distance GEMM (cuBLAS on CUDA) with row-wise top-$k_{\max}$; prefix slicing; per-cell bandwidth root finding (CPU or CUDA); sparse fuzzy union and Jaccard weights; Leiden and scoring on CPU through the shared clustering implementation. Out-of-core operation is not claimed.

**Defaults without asking.** `partition_stability`, no labels, and the parameter values of section 6. Never report a `label_ari` selection as validated.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/`use_rep` | float32, $n\times p_{\text{stored}}$ | cell embedding; only the first `n_pcs` columns are used |
| read | obs/`reference_label_key` | categorical or string | optional reference labels; required by `label_ari` |
| read | obs/`score_mask_key` | boolean | optional; only true cells are scored against labels |
| write | uns/`key`/table | table, one row per $k$ | `k`, `n_clusters`, `pstab`, `pstab_sd`, `seed_floor`, `ari_mean`, `ari_min`, `ari_max`, `nmi`, `gc`, `median_silhouette`, `silhouette_ci_low`, `silhouette_ci_high`; null where not computed |
| write | uns/`key`/selection | record | rule, `chosen_k`, `fallback_used`, `stability_target_met`, `selection_uses_labels`, search requested and resolved, device, seed, all parameter values |
| write | obs/`key`_leiden_k<k> | categorical | full-data Leiden partition at $\gamma$ for each $k$, only with `write_partitions`; seed of the first Leiden run |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `embedding` | object | — | — | Embedding used for every neighbour search. |
| `embedding.use_rep` | string | "X_pca" | — | Key of the obsm embedding (cells by dimensions); it must contain no missing values. |
| `embedding.n_pcs` | integer | 30 | min 2 | Number of leading embedding columns used. Use the value from dim-reduction.pc_number_selection when that step has run. |
| `k_grid` | array | [5, 10, 15, 20, 30, 50] | — | Candidate neighbour counts, each at least 3, counting the cell itself. The largest is k_max; the subsample size must exceed k_max. |
| `selection_rule` | string | "partition_stability" | `partition_stability`, `label_ari`, `coclustering_robustness` | partition_stability: label-free, smallest k with stability at least min_stability. label_ari: benchmarking only, uses labels. coclustering_robustness: label-free, memory-heavy, highest median co-clustering silhouette. |
| `graph` | object | — | — | Graph construction from each k-prefix, and the fixed Leiden step applied at every k. |
| `graph.method` | string | "umap" | `umap`, `snn` | umap: fuzzy simplicial set with smooth-kNN calibration to log2 k. snn: shared-neighbour Jaccard weights, pruned at snn_prune. |
| `graph.snn_prune` | number | 0.06666666666666667 | min 0; max 1 | Jaccard weights below this value are dropped (Seurat default 1/15). Used only by method snn. |
| `graph.search` | string | "exact" | `exact`, `approximate` | exact: brute-force search. approximate: the engine of neighbors.approximate_knn_search; its recall is not measured here. |
| `graph.leiden_resolution` | number | 1.0 | > 0 | Fixed Leiden resolution used for every partition at every k. |
| `graph.leiden_seeds` | integer | 1 | min 1; max 25 | Leiden seeds per k on the full data. Values above 1 give the seed spread of ARI, NMI and GC and the seed floor. |
| `subsampling` | object | — | — | Cell subsampling for partition stability, the label_ari stability guard and coclustering_robustness. |
| `subsampling.n_subsamples` | integer | 20 | min 2 | Number of random subsamples. |
| `subsampling.fraction` | number | 0.8 | > 0; < 1 | Fraction of cells drawn without replacement into each subsample. |
| `subsampling.min_stability` | number | 0.7 | min 0; max 1 | Threshold on mean partition ARI between subsample and full data. Uncalibrated. Ignored by coclustering_robustness. |
| `labels` | object | — | — | Optional reference labels. Required for label_ari; otherwise they add reporting columns only. |
| `labels.reference_label_key` | string/null | null | — | obs column of reference labels used for ARI, NMI and graph connectivity. |
| `labels.score_mask_key` | string/null | null | — | obs boolean column; only true cells are scored, for example to exclude doublets. Cells with a missing label are always excluded. |
| `labels.ari_tolerance` | number | 0.02 | min 0 | Tolerance below the best ARI among stable k. Used by label_ari only. |
| `output` | object | — | — | Names and extent of the written members. |
| `output.key` | string | "neighbor_k_selection" | — | Stem of the output members uns/<key>/table, uns/<key>/selection and obs/<key>_leiden_k<k>. |
| `output.write_partitions` | boolean | false | — | Write one full-data Leiden partition per k to obs/<key>_leiden_k<k>, from the first seed. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device for the exact search; auto picks CUDA when a device with enough memory is available. Leiden runs on CPU. |
| `seed` | integer | 0 | min 0 | Seed for subsample draws, Leiden runs and approximate search. A fixed seed, search and device reproduce the output on the same hardware. |
| `dry_run` | boolean | false | — | Return estimated time, memory, device and the planned numbers of searches and Leiden runs without running. |
| `overwrite` | boolean | false | — | Replace existing output members with the same key instead of failing. |
<!-- PARAMS:AUTO:END -->

Cross-parameter rules. $k$ counts the cell itself, so 15 reproduces Scanpy's default; Seurat's `k.param` and PhenoGraph's $k$ are compared at the nearest grid value (B1). `labels.reference_label_key` is required by `label_ari` and otherwise adds reporting columns only. `subsampling.*` applies to `partition_stability`, `coclustering_robustness` and the stability guard of `label_ari`; `min_stability` is ignored by `coclustering_robustness`. `labels.ari_tolerance` is used only by `label_ari`, and `graph.snn_prune` only by method `snn`. Distances are Euclidean (other metrics: `neighbors.distance_metric_choice`). No graph is written to `obsp`.

## 7. MCP tool

Tool name `singlet_neighbors_neighbor_count_selection` (definition in `tasks/mcp/singlet_neighbors_neighbor_count_selection.json`). Angle-bracketed values in the result are placeholders for measured quantities.

```json
{"dataset": "atlas_subset.singlet",
 "embedding": {"use_rep": "X_pca", "n_pcs": 30},
 "k_grid": [5, 10, 15, 20, 30, 50],
 "selection_rule": "partition_stability",
 "subsampling": {"n_subsamples": 20, "fraction": 0.8, "min_stability": 0.7},
 "seed": 0}
```

```json
{"dataset": "atlas_subset.singlet", "status": "completed",
 "wrote": ["uns/neighbor_k_selection/table", "uns/neighbor_k_selection/selection"],
 "summary": {"selection_rule": "partition_stability", "chosen_k": "<k in k_grid>",
  "fallback_used": "<bool>", "selection_uses_labels": false,
  "per_k": [{"k": "<k>", "n_clusters": "<int>", "pstab": "<float>", "pstab_sd": "<float>", "ari_mean": null}],
  "search": {"requested": "exact", "resolved": "exact"}, "device": "<cuda or cpu>", "seconds": "<float>"},
 "provenance_id": "<id>", "job_id": null}
```

- **Long-running**: yes; $n_s$ subsample searches and $n_s|K|$ Leiden clusterings, so the call may return `queued`.
- **Stochastic**: yes; `seed` fixes subsamples, Leiden and approximate search, and the output is reproducible on the same hardware, search and device.
- **Dry-run estimate**: `seconds`, `peak_memory_gb`, `device`, resolved search, `planned_searches`, `planned_leiden_runs` and, for `coclustering_robustness`, the frequency-matrix size.

## 8. Benchmarks

Shared protocol. Embedding: the normalisation, feature-selection and PCA chain of `dim-reduction.normalized_cell_embedding` with $n_{\text{pcs}}=30$. Grid $K=\{5,10,15,20,30,50\}$ counting the cell itself; $\gamma=1.0$ (Scanpy default); $f=0.8$, $n_s=20$; Leiden seeds 0 to 4 on all cells (mean and range reported), seed 0 for subsamples. The graph is searched once at $k_{\max}$ and sliced. ARI, NMI and GC use labelled, unmasked cells only, and every score is reported with the cluster count. Software-default comparators (Scanpy 15 with `umap` connectivities, Seurat 20 and PhenoGraph 30 with `snn`) go through the same Leiden step, so they differ from the sweep only in $k$ and connectivity. Thread count, device and hardware are recorded.

### B1. CellBench single-cell cell-line mixtures

- **Goal**: test whether the label-free rule picks a $k$ whose partition recovers known cell-line identity.
- **Ground truth**: orthogonal measurement. Each cell carries the label of its cell line in column `cell_line_demuxlet`, which the repository README names as the single-cell ground truth (categorical, no normalisation).
- **Datasets**

| Dataset | Source (accession, files in LuyiTian/CellBench_data) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| sc_10x | [R10]; GSM3022245; `data/csv/sc_10x.*` | 10x, three human lung adenocarcinoma lines; 902 cells | — | H2228 315, H1975 313, HCC827 274 |
| sc_celseq2 | GSM3336845; `sc_celseq2.*` | CEL-seq2, same lines; 274 cells | — | H1975 114, H2228 81, HCC827 79 |
| sc_dropseq | GSM3336849; `sc_dropseq.*` | Drop-seq, same lines; 225 cells | — | H1975 92, HCC827 68, H2228 65 |
| sc_10x_5cl | GSM3618014; `sc_10x_5cl.*` | 10x, five lines; 3,918 cells | — | A549 1244, H838 840, H2228 751, HCC827 568, H1975 515 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | full-data Leiden partition at $\gamma=1.0$ against labels (section 3.5); mean and range over seeds | higher | primary | [R13][R14] |
| NMI | arithmetic normaliser, same partitions | higher | guardrail | [R15] |
| GC | scib graph connectivity over label classes | higher | guardrail | [R12] |
| Max NMI over resolutions | OpenProblems procedure with $G_k$ supplied as the neighbours graph: Leiden at 0.1 to 2.0 in 20 steps, maximum NMI; reporting only | higher | reporting | [R15] |
| PStab | section 3.5 | higher | selection criterion | proposed |

- **Comparators**: Scanpy $k=15$ with `umap`; Seurat-style $k=20$ and PhenoGraph-style $k=30$ with `snn`; extremes $k=5$ and $k=50$.
- **Protocol**: each dataset is analysed independently; labels only evaluate the label-free choice.
- **Acceptance criterion** (proposed): on at least three of the four datasets, $\mathrm{ARI}(\hat k)\ge\max_K\mathrm{ARI}-0.02$ and $\mathrm{ARI}(\hat k)\ge\mathrm{ARI}(15)$ minus the seed range at $k=15$.
- **Known pitfalls**: the three-line datasets are nearly separable, so ARI saturates and cannot rank $k$. The `cellmix*` objects in the repository are 9-cell mixtures per well, not single cells, and are not used.

### B2. Label-free rules on the chooseR PBMC example

- **Goal**: test whether `partition_stability` and the chooseR-style co-clustering rule choose compatible $k$ on data with no cell-line truth.
- **Ground truth**: none. The estimand is reproducibility of partitions across subsamples, not accuracy.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| chooseR example | rbpatt2019/chooseR `data/ding_smartseq_pbmc_preprocessed.rds`; data from [R11] | Smart-seq, human PBMCs; about 500 cells (README) | — | normalised and PCA-reduced in Seurat; the PCA embedding is exported |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Median co-clustering silhouette | section 3.6 with 100 subsamples of 80%; BCa 95% interval, 25000 resamples | higher | primary | [R7] |
| Interval width | width of that interval at the chosen $k$ | lower | guardrail | [R7] |
| PStab | section 3.5 on the same subsample partitions | higher | selection criterion | proposed |

- **Comparators**: the chooseR example as shipped (resolution sweep at Seurat defaults); Scanpy default $k=15$.
- **Protocol**: first 30 PCs of the exported embedding; $n_s=100$ and $f=0.8$ as in the example; ties in the median go to the smaller $k$.
- **Acceptance criterion** (proposed): the interval width at the co-clustering choice is at most 0.1, and the two rules choose $k$ within one grid step.
- **Known pitfalls**: the shipped code sweeps resolution, so its numbers do not carry over to $k$. The tally is memory-heavy: the example loops over subsamples because its vectorised form exhausts memory for nearly all datasets.

### B3. Planted-partition recovery on simulated data

- **Goal**: test whether the sweep recovers planted groups and how the best $k$ moves with the number of groups, group separation and dropout. Proposed benchmark with generator recipe G1.
- **Ground truth**: planted simulation. Splatter's `groups` method writes the group of each cell as `Group` in `colData` (categorical, no normalisation).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter simulations, recipe G1 | [R16]; `splatSimulate(method="groups")` | simulated counts; 10,000 cells; eight settings, three seeds each | — | no fixed dataset |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | section 3.5 against planted groups, each $k$ | higher | primary | [R13][R14] |
| PStab, GC | sections 3.5, planted groups as labels for GC | higher | guardrail | proposed; [R12] |

- **Comparators**: the grid and Scanpy default $k=15$.
- **Protocol** (recipe G1): (1) settings: groups $\in\{5,10\}$ with equal `group.prob`, `de.facLoc` $\in\{0.1,0.4\}$, `dropout.type="experiment"` with `dropout.mid` $\in\{0,3\}$, `de.prob=0.1`; (2) simulate, log-normalise, PCA to 30 components; (3) run the sweep and record ARI for every $k$; (4) record whether the ARI-maximising $k$ moves monotonically across settings; (5) negative control: permute every embedding column independently across cells and rerun.
- **Acceptance criterion** (proposed): ARI at $\hat k$ of at least 0.9 for the setting with `de.facLoc=0.4`, `dropout.mid=0`, and PStab at least 0.3 lower under the control at every $k$.
- **Known pitfalls**: simulated structure is easier than real data, and planted groups need not correspond to cell types.

### P1. Performance and scaling

Recipe G2: draw 10k, 100k and 1M cells uniformly without replacement from the singlet catalogue with a fixed seed, and compute a 30-column embedding. CPU and CUDA, exact and approximate search, thread count fixed. Metrics: wall time per stage (search, slicing, connectivity, Leiden, subsample searches, co-clustering tally), peak memory, graph bytes, cells per second for the full sweep. Comparators: a separate search per $k$, Scanpy `sc.pp.neighbors` at 15, and Seurat `FindNeighbors` at 20. Timings are repeated and their spread reported. Acceptance: for exact search the prefix lists equal those of a separate search per $k$ except at ties, and the full-data search stage for the grid costs at most 1.2 times one search at $k_{\max}$ (proposed). No speed target against the comparators; 10M cells are not claimed, because the task is not streaming. Approximate-search results are reported separately, and Leiden time dominates at large $k$.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
- **Feeds**:
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `neighbors.edge_weighting_adaptive_kernel`: Edge weighting of kNN graphs: SNN/Jaccard, adaptive kernels and symmetrisation
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `clustering.resolution_selection`: Choosing clustering resolution without reference labels
- **Reads**: `obsm/<use_rep>`, `obs/<reference_label_key>`, `obs/<score_mask_key>`
- **Writes**: `uns/<key>/table`, `uns/<key>/selection`, `obs/<key>_leiden_k<k>`
<!-- CHAINING:AUTO:END -->

Graph-based clustering workflow: normalisation, highly variable genes, PCA, `pc_number_selection`, this task, final graph, Leiden. Related, not chained: `neighbors.label_neighborhood_purity`, `clustering.cluster_stability`.

## 10. Risks, pitfalls and open questions

- **Calibration.** The stability threshold 0.7, the partition-stability estimand and the seed floor are proposals; no value of the threshold has been calibrated. B1 and B3 settle it. Second-order effects of subsampling on the grid, and the intrinsic dimension $q$ of real embeddings, are uncharacterised.
- **Evidence on $k$.** No benchmark that varies only the neighbour count was found in the curated literature corpus. The interaction of $k$, $n_{\text{pcs}}$ and $\gamma$, the dependence on label granularity, and any rule linking $k$ to $n$ remain untested.
- **Dataset labels.** The README does not describe how `cell_line_demuxlet` was derived or its error rate. CellBench cell counts come from the repository's metadata files. Data terms beyond the GEO accessions are not stated, and the GEO series of the five-line data was not read.
- **Code and papers not read.** Whether Seurat's $k$-parameter lists contain the query cell; the leidenalg source and the Leiden paper beyond their metadata; the Ben-Hur paper beyond its bibliographic record and abstract-level summaries; the OpenProblems dataset names beyond the test fixture `cxg_mouse_pancreas_atlas`; the scib benchmark datasets.
- **Operational risks.** Leiden seed variance can mask stability differences (the seed floor reports it); the co-clustering matrix can exceed memory; approximate search changes the neighbour lists.
- **First experiment.** Run B1 on the four CellBench datasets with the label-free rule and five Leiden seeds, compare with $k=15$, and set `min_stability` from the seed floor and the ARI curves before any claim.

## 11. References

R1. Wolf FA, Angerer P, Theis FJ. SCANPY: Large-Scale Single-Cell Gene Expression Data Analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R2. McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction. *arXiv* 2018. doi:10.48550/arxiv.1802.03426 — verified (corpus)
R3. Stuart T, Butler A, Hoffman P, Hafemeister C, Papalexi E, Mauck WM, Hao Y, Stoeckius M, Smibert P, Satija R. Comprehensive Integration of Single-Cell Data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R4. Levine JH, Simonds EF, Bendall SC, et al. Data-Driven Phenotypic Dissection of AML Reveals Progenitor-like Cells that Correlate with Prognosis. *Cell* 2015. doi:10.1016/j.cell.2015.05.047 — verified (corpus)
R5. Blondel VD, Guillaume JL, Lambiotte R, Lefebvre E. Fast unfolding of communities in large networks. *Journal of Statistical Mechanics: Theory and Experiment* 2008. doi:10.1088/1742-5468/2008/10/p10008 — verified (corpus)
R6. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)
R7. Patterson-Cross RB, Levin AJ, Menon V. Selecting single cell clustering parameter values using subsampling-based robustness metrics. 2021. doi:10.1186/s12859-021-03957-4 — partial (corpus)
R8. Ben-Hur A, Elisseeff A, Guyon I. A stability based method for discovering structure in clustered data. *Pacific Symposium on Biocomputing* 2002:6-17. — partial (search)
R9. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R10. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R11. Ding J, Adiconis X, Simmons SK, et al. Systematic comparison of single-cell and single-nucleus RNA-sequencing methods. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0465-8 — verified (corpus)
R12. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2021. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R13. Santos JM, Embrechts M. On the Use of the Adjusted Rand Index as a Metric for Evaluating Supervised Classification. *Artificial Neural Networks - ICANN 2009*. doi:10.1007/978-3-642-04277-5_18 — verified (corpus)
R14. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R15. Emmons S, Kobourov S, Gallant M, Börner K. Analysis of Network Clustering Algorithms and Cluster Quality Metrics at Scale. *PLOS ONE* 2016. doi:10.1371/journal.pone.0159161 — verified (corpus)
R16. Zappia L, Phipson B, Oshlack A. Splatter: Simulation of Single-Cell RNA Sequencing Data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/scanpy | maintainers Ilan Gold, Philipp Angerer, Severin Dicks (pyproject); copyright scverse | BSD-3-Clause (LICENSE; pyproject) | defaults; connectivity wiring; `jaccard` and `umap` methods | port of the connectivity wiring, with attribution |
| https://github.com/lmcinnes/umap | Leland McInnes (pyproject maintainer; copyright 2017) | BSD 3-Clause (LICENSE.txt; pyproject says "BSD") | smooth-kNN calibration and fuzzy union | port, with attribution |
| https://github.com/satijalab/seurat | Rahul Satija (author, maintainer) and contributors in DESCRIPTION; copyright holder "Seurat authors" | MIT with file LICENSE (DESCRIPTION) | `FindNeighbors` defaults; SNN weight and prune | port of the SNN weight, with attribution |
| https://github.com/dpeerlab/PhenoGraph | Jacob Levine (version.py; copyright 2015 Columbia University) | MIT permission text (LICENSE; setup.py names the file only) | Jaccard weight and Louvain reference | callout; the same weight is implemented from section 3.4 |
| https://github.com/vtraag/leidenalg | V.A. Traag (pyproject) | GPL-3.0-or-later (pyproject) | Leiden clusterer | reimplement from Traag et al. |
| https://github.com/rbpatt2019/chooseR | Patterson-Cross RB, Levin AJ, Menon V (README citation) | GPL-3.0 (LICENSE text) | co-clustering robustness; B2 comparator | reimplement from the paper and example; comparator in B2 |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject) | MIT (LICENSE.txt; pyproject) | graph connectivity definition | port of the GC function, with attribution |
| https://github.com/openproblems-bio/task_dimensionality_reduction | Open Problems in Single-Cell Analysis (copyright 2024) | MIT (LICENSE) | `clustering_performance` procedure used in B1 | callout; reporting metric only |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian (copyright 2018) | MIT (LICENSE) | single-cell cell-line data of B1 | callout; benchmark data |
| https://github.com/Oshlack/splatter | Luke Zappia (author, maintainer; DESCRIPTION) | GPL-3 + file LICENSE (DESCRIPTION) | simulator of B3 | callout; benchmark generator |
