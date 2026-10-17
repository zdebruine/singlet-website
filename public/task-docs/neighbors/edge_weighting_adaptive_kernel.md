---
id: neighbors.edge_weighting_adaptive_kernel
title: Edge weighting of kNN graphs: SNN/Jaccard, adaptive kernels and symmetrisation
area: neighbors
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [neighbors.approximate_knn_search, neighbors.neighbor_count_selection]
feeds: [clustering.cell_partitioning, embedding-viz.local_neighborhood_preservation, trajectory.pseudotime_ordering]
reads: [obsp/<key>_distances]
writes: [obsp/<key>_connectivities, obsp/<key>_transitions, obs/<key>_scale, obs/<key>_rho, uns/<key>]
devices: [cpu, cuda]
mcp_tool: singlet_neighbors_edge_weighting_adaptive_kernel
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Edge weighting of kNN graphs: SNN/Jaccard, adaptive kernels and symmetrisation

> Turn each cell's nearest-neighbour list into a symmetric weighted graph with a per-cell scale, using the calibrated adaptive kernel of UMAP by default, and judge the weighting by label recovery and by how well the graph keeps input neighbourhoods.

## 1. Question

Given the $k$-nearest-neighbour lists of $n$ cells with distances $d_{ij}$, which rule maps them to a symmetric weight matrix $W$ on the kNN edges (a fixed or per-cell adaptive Gaussian, fuzzy membership, shared-neighbour overlap or a calibrated affinity), and with which symmetrisation? The output is $W$, a per-cell scale, and optionally the row-stochastic transition matrix $P=D^{-1}W$. A correct answer is a weighting whose Leiden communities match labelled populations at a resolution fixed without those labels, and whose layout keeps the input neighbourhoods.

## 2. Why this task matters and where the field stands

Clustering, layout and trajectory methods read a weighted graph, not only neighbour sets, and the weights decide which edges carry community structure. A single global scale starves sparse regions of degree, Jaccard weights remove edges between populations that share few neighbours, and union symmetrisation raises the degree of hub cells (section 3). The defaults disagree: Scanpy uses the UMAP connectivity [R1][R9], Seurat a pruned Jaccard graph [R8], and PhenoGraph a Jaccard graph at $k=30$ [R7].

The status is **contested**. The field has not settled which weight, symmetrisation or scale to use, and the defaults are conventions rather than the outcome of a comparison. Open problems:

- No benchmark among the cited sources compares these weightings on identical kNN graphs. The clustering comparison of Duo et al. [R18] evaluates complete clustering pipelines, so weighting and clustering choices are confounded.
- Per-cell scales are motivated by local density, but their effect on label recovery at fixed $k$ has not been measured in the cited literature.
- Kobak and Linderman show that initialisation strongly controls global structure in t-SNE and UMAP [R3], so layout-based scores of a weighting mix weighting effects with initialisation effects.
- Jaccard weights are quantised at small $k$, and their prune threshold is coupled to $k$ (section 3.5).
- A calibrated probabilistic edge weight, fitted to labelled pairs, has not been shown to beat the heuristics.

## 3. Theory and insight

### 3.1 Notation

| Symbol | Meaning |
|---|---|
| $n$, $q$ | cells; intrinsic dimension of the cell-state manifold |
| $p(x)$ | cell density in the representation used for the kNN search |
| $k$ | `n_neighbors`, the list length including the cell (Scanpy convention) |
| $m=k-1$, $\mathcal N(i)$ | other neighbours of each cell, and their set |
| $d_{ij}$, $\bar d_i$ | distance between $i$ and $j$; largest listed distance of $i$ |
| $\sigma_i$, $\rho_i$ | per-cell scale; distance to the nearest non-zero neighbour (UMAP) |
| $\mu_{ij}$, $W_{ij}$ | directed membership; symmetric connectivity |
| $s_{ij}$, $J_{ij}$ | shared-neighbour count $\lvert\mathcal N(i)\cap\mathcal N(j)\rvert$; Jaccard weight |

### 3.2 Degree under one global scale

With one bandwidth $\sigma$ restricted to the kNN lists, cell $i$ has weighted degree

$$D_i=\sum_{j\in\mathcal N(i)}\exp\!\Big(-\frac{d_{ij}^2}{2\sigma^2}\Big),\qquad m\,e^{-\bar d_i^2/2\sigma^2}\le D_i\le m .$$

The bounds hold for every $\sigma$, since $d_{ij}\le\bar d_i$. The largest listed distance follows local density to first order, $\bar d_i\approx\big((k-1)/(n\,V_q\,p(x_i))\big)^{1/q}$ with $V_q$ the unit-ball volume. This holds for $1\ll k\ll n$, smooth $p$ on the scale of $\bar d_i$ and a $q$-dimensional support, and it fails at support boundaries and in populations smaller than $k$, whose lists leave the population. Cells with $\bar d_i\gg\sigma$ therefore have almost no degree, and cells with $\bar d_i\ll\sigma$ have degree near $m$. A per-cell scale that follows $\bar d_i$ removes most of this dependence on density.

### 3.3 UMAP calibration and fuzzy union

UMAP fixes the directed membership mass of each cell and solves for its scale. With $\mu_{ij}=\exp\!\big(-\max(0,d_{ij}-\rho_i)/\sigma_i\big)$, $\sigma_i$ is the root of

$$\sum_{j\in\mathcal N(i)}\mu_{ij}=b\log_2 k ,$$

where $\rho_i$ is the smallest non-zero listed distance. The left side ranges from about 1 (as $\sigma_i\to0$, with a unique nearest neighbour) to $m$ (as $\sigma_i\to\infty$), so a root exists if and only if $1<b\log_2 k<m$. For $b=1$ this requires $k\ge3$. The out-membership mass is therefore the same for every cell regardless of density. Directed memberships are then joined by fuzzy union with mix $r$:

$$W_{ij}=r\,(\mu_{ij}+\mu_{ji}-\mu_{ij}\mu_{ji})+(1-r)\,\mu_{ij}\mu_{ji}.$$

At $r=1$ this is a probabilistic OR, correct under independence. Neighbours that share most of their lists have positively dependent memberships, so the union overstates the support of such edges.

### 3.4 Gaussian-adaptive weights

Scanpy's `gauss` uses, for sparse kNN input,

$$W_{ij}=\sqrt{\frac{2\sigma_i\sigma_j}{\sigma_i^2+\sigma_j^2}}\exp\!\Big(-\frac{d_{ij}^2}{\sigma_i^2+\sigma_j^2}\Big),\qquad \sigma_i^2=\operatorname*{median}_{j\in\mathcal N(i)}d_{ij}^2 .$$

It is symmetric by construction and reduces to $\exp(-d_{ij}^2/2\sigma^2)$ when $\sigma_i=\sigma_j=\sigma$. The median rule is a heuristic. The reference code states that it was chosen to reproduce figures of Haghverdi et al. [R6] and that it makes little difference.

### 3.5 Shared-neighbour overlap

With $s_{ij}=\lvert\mathcal N(i)\cap\mathcal N(j)\rvert$, the Jaccard weight is

$$J_{ij}=\frac{s_{ij}}{2m-s_{ij}} .$$

It is symmetric and depends only on the kNN sets, so it is unchanged by any monotone transformation of the distances. It takes only $m+1$ values, which gives coarse weights and many ties at small $k$. Seurat keeps an edge when $J_{ij}\ge\tau$, which holds if and only if $s_{ij}\ge 2m\tau/(1+\tau)$. For $\tau=1/15$ this is $s_{ij}\ge m/8$, so a cell is isolated exactly when no other cell shares at least $m/8$ of its neighbours. Computing every $s_{ij}$ costs $O(nk^2)$ operations, and all weights need $O(nk)$ memory.

### 3.6 Perplexity-calibrated affinities

The t-SNE kernel sets $\sigma_i$ by bisection so that $p_{j\mid i}\propto\exp(-d_{ij}^2/2\sigma_i^2)$ over $j\in\mathcal N(i)$ has Shannon perplexity $2^{H_i}$ equal to the target, where $H_i=-\sum_j p_{j\mid i}\log_2 p_{j\mid i}$. The joint affinity is

$$W_{ij}=\frac{p_{j\mid i}+p_{i\mid j}}{2n},$$

with missing directions set to zero, so $\sum_{ij}W_{ij}=1$. A solution of the bisection exists if and only if $1<\text{target}<m$. The total mass of one makes magnitudes incomparable with the other weights. Modularity-based partitioning is invariant to a global rescaling of $W$, so communities at a fixed resolution are unchanged, but thresholds and degrees are not.

### 3.7 Estimands and normalisation

- $W_{ij}$ is the weight of edge $ij$ on the kNN support; it lies in $[0,1]$ for umap, gauss_adaptive and jaccard, and sums to one for perplexity.
- $P_{ij}=W_{ij}/\sum_l W_{il}$ is the one-step probability from $i$ to $j$.
- $\sigma_i$ and $\rho_i$ are distances in the units of the representation.
- ARI is the chance-corrected pair agreement between a partition and the labels, in $[-1,1]$, with expectation zero for random partitions.
- Graph connectivity is the mean over labels of the fraction of each label's cells in the largest connected component of its induced subgraph, so every label has equal weight.
- Trustworthiness is the rank-penalised fraction of 2-D neighbours that are input neighbours, averaged over cells at a fixed $k$.

### 3.8 Symmetrisation and insight

Fuzzy union ($r=1$) adds in-degree and so raises hub degree; the product ($r=0$) acts as a soft mutual rule and can fragment rare populations. The `gauss` copy union takes the forward weight for a missing reverse edge, and the perplexity average halves a one-directional edge.

UMAP and the perplexity kernel are per-cell fits with a fixed target, whereas the Gaussian and Jaccard weights are fixed formulas. Neighbour-embedding objectives preserve which cells are neighbours rather than distances between distant cells [R2], so the comparisons that matter concern local degree and bridge edges. B1 and B2 test whether label-recovery differences among neighbour-based weightings exceed the acceptance margins. UMAP excludes zero distances from $\rho_i$. If more than half of a cell's list is at zero distance, its `gauss` median scale is zero, and the `gauss` weight between two such cells is undefined (0/0).

## 4. Methods landscape

The UMAP connectivity, and the Scanpy and Seurat SNN graphs, are the published defaults for kNN graphs. The perplexity kernel is the t-SNE standard. No benchmark of the weighting itself is cited for any of these defaults. The tables list only methods with a cited reference implementation; the others are listed in section 10.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| UMAP fuzzy simplicial set | hybrid | per-cell scale solved so memberships sum to $b\log_2 k$; directed memberships joined by fuzzy union | [R1] |
| Scanpy `gauss` | heuristic | Gaussian with per-cell scale from the median squared neighbour distance; reverse edges copied | [R5][R6][R9] |
| Seurat `FindNeighbors` SNN | heuristic | Jaccard overlap of kNN sets; edges below the prune value dropped | [R8] |
| PhenoGraph | heuristic | Jaccard-weighted kNN graph with $k=30$ and the cell excluded; Louvain communities | [R7][R10] |
| Scanpy `jaccard` | heuristic | Jaccard overlap with the cell excluded from its own list | [R7][R9] |
| t-SNE perplexity kernel (scikit-learn) | model-based | per-cell scale fitted to a target perplexity; joint affinity by averaging both directions | [R12][R2] |

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Scanpy | `n_neighbors` | 15 (cell counted) | src/scanpy/neighbors/__init__.py:65 @ 8ed52d9 |
| Scanpy | `method` | `umap` | src/scanpy/neighbors/__init__.py:71 |
| Scanpy | `knn` | True | src/scanpy/neighbors/__init__.py:70 |
| Scanpy | `gauss` $\sigma_i^2$ (lists) | median squared neighbour distance | src/scanpy/neighbors/_connectivity.py:49-54 @ 8ed52d9 |
| Scanpy | `gauss` reverse edge | copied from forward weight | src/scanpy/neighbors/_connectivity.py:94-97 |
| Scanpy | UMAP `set_op_mix_ratio`, `local_connectivity` | 1.0, 1.0 | src/scanpy/neighbors/_connectivity.py:109-110 |
| Scanpy | `jaccard` denominator | $2(\texttt{n\_neighbors}-1)-s$, cell excluded | src/scanpy/neighbors/_connectivity.py:141-175 |
| UMAP | `bandwidth` $b$; bisection iterations | 1.0; 64 | umap/umap_.py:153 @ 33d7e6f |
| UMAP | $\sigma$ floor | $10^{-3}$ times mean distance | umap/umap_.py:58 |
| UMAP | fuzzy union at $r=1$ | $\mu+\mu^\top-\mu\circ\mu^\top$ | umap/umap_.py:611-614 |
| Seurat | `k.param`; `prune.SNN` | 20; 1/15 | R/clustering.R:567, :570 @ 5f67c70 |
| Seurat | Jaccard value; keep rule | shared/(k + (k - shared)); value at least prune | src/snn.cpp:59 (formula); src/snn.cpp:61 (keep rule) |
| PhenoGraph | `k`; clustering | 30; Louvain | phenograph/cluster.py:177, :176 @ 72a3e62 |
| PhenoGraph | Jaccard formula | shared/(2k - shared) | phenograph/core.py:112-124 |
| scikit-learn | `perplexity` | 30.0 | sklearn/manifold/_t_sne.py:802 @ 85593ca |
| scikit-learn | list length; symmetrisation | min(n-1, int(3 x perplexity + 1)); $(P+P^\top)$ normalised by sum | _t_sne.py:942; 113-117 |

Scanpy's list counts the cell, so PhenoGraph's $k=30$ corresponds to `n_neighbors` = 31 here.

## 5. Proposed singlet approach

Routes: **port** for umap, gauss_adaptive, jaccard and perplexity, whose kernels are short fixed formulas; each is ported to the CPU core with attribution and implemented as a CUDA row kernel. **Callout** for Scanpy, Seurat, PhenoGraph and rapids-singlecell, used as comparators (section 8). The graph-connectivity metric is **reimplemented** (section 12).

The model-based formulation proposed here is a calibrated edge probability on kNN edges:

$$\Pr(z_i=z_j)=\operatorname{logit}^{-1}\!\Big(\beta_0+\beta_1\,\frac{d_{ij}}{\sigma_i+\sigma_j}+\beta_2\,\frac{s_{ij}}{m}\Big),$$

with $\sigma_i$ from the umap calibration. The three coefficients are fitted by maximum likelihood on annotated cell pairs, labelled same when both cells carry the same author annotation at a stated granularity, with train and test splits by study. The output is a calibrated probability on kNN edges, symmetric by construction. It is rejected if, on held-out studies, it does not beat the best heuristic on B1 and B2 under their acceptance rules, or if its calibration error is not below that of the umap weights read as probabilities. A hypergeometric alternative, $W_{ij}=-\log\Pr(S\ge s_{ij})$ with $S$ hypergeometric under independent uniform $m$-subsets, corrects the Jaccard ratio for $m$. Neighbour sets are positively correlated within populations, so the null is violated there and this variant needs the same calibration check.

The three-coefficient link is a GLM, which is hard-coded in CUDA with the row kernels, so PyTorch is not needed; PyTorch is justified only for a learned scorer, which this task does not propose for the first release. Core kernels are a per-row bisection (64 iterations, as UMAP), an SpGEMM of the kNN incidence matrix with its transpose for $s_{ij}$ (cuSPARSE), and an element-wise transpose-add for symmetrisation. Storage is CSR. CPU and CUDA paths share the formula and must agree numerically. Row blocks can be processed for umap, gauss_adaptive and perplexity, but symmetrisation needs a global transpose, so streaming is not claimed.

Defaults an agent should use without asking: `weighting` umap, `n_neighbors` 15, `symmetrisation` native, `row_normalise` false, umap `bandwidth` 1.0, `local_connectivity` 1.0, `min_sigma_scale` 0.001, jaccard `prune` 1/15, and perplexity `target` null.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsp/<key>_distances | float32 CSR | kNN distances; each row lists its $m$ neighbours, cell excluded |
| write | obsp/<key>_connectivities | float32 CSR, symmetric | edge weights $W$ on kNN edges, in the units of section 3.7 |
| write | obsp/<key>_transitions | float32 CSR, row-stochastic | $D^{-1}W$, only when `row_normalise` is true |
| write | obs/<key>_scale | float32 per cell | $\sigma_i$ (umap, gauss_adaptive, perplexity) |
| write | obs/<key>_rho | float32 per cell | $\rho_i$ (umap only) |
| write | uns/<key> | dict | method, `n_neighbors`, symmetrisation and the parameter record |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `weighting` | string | "umap" | `umap`, `gauss_adaptive`, `jaccard`, `perplexity` | Edge-weight family computed from the kNN lists; umap is the default, jaccard gives scale-free shared-neighbour weights. |
| `n_neighbors` | integer | 15 | min 3 | Neighbour count k, Scanpy convention (the cell counts). Must not exceed the stored kNN list length plus one. |
| `symmetrisation` | string | "native" | `native`, `fuzzy_union`, `fuzzy_intersection`, `copy_union`, `average` | native uses the method's own rule (umap: fuzzy_union; gauss_adaptive: copy_union; perplexity: average); jaccard is already symmetric. |
| `row_normalise` | boolean | false | — | Also write obsp/<key>_transitions, the row-stochastic Markov matrix for diffusion or pseudotime. |
| `key` | string | "weighted" | — | Stem for the written members: obsp/<key>_connectivities, obs/<key>_scale and uns/<key>. |
| `umap` | object | — | — | Options for weighting umap; ignored by other methods. |
| `umap.bandwidth` | number | 1.0 | > 0 | Target scale b in the calibration sum equal to b times log2 k. |
| `umap.local_connectivity` | number | 1.0 | min 0 | Number of nearest non-zero neighbours assumed connected; sets rho_i. |
| `umap.min_sigma_scale` | number | 0.001 | > 0 | Floor for sigma_i as a fraction of the mean kNN distance. |
| `jaccard` | object | — | — | Options for weighting jaccard; ignored by other methods. |
| `jaccard.prune` | number | 0.06666666666666667 | min 0; max 1 | Edges with Jaccard weight below this value are dropped (Seurat default 1/15). |
| `perplexity` | object | — | — | Options for weighting perplexity; ignored by other methods. |
| `perplexity.target` | number/null | null | — | Target perplexity; null uses (n_neighbors-1)/3. Must lie in (1, n_neighbors-1). |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Every method reads the first `n_neighbors` minus one listed neighbours of each cell, so the stored list must be at least that long. The perplexity target must lie in $(1, \texttt{n\_neighbors}-1)$; its null default makes the calibrated list the stored list. `symmetrisation` native gives each method's own rule. Any other value is applied after weighting, except for jaccard, which is symmetric by construction and records the ignored value in `uns/<key>`. The `umap` block applies only to umap, and `jaccard.prune` only to jaccard.

## 7. MCP tool

Tool name `singlet_neighbors_edge_weighting_adaptive_kernel` (definition in `tasks/mcp/singlet_neighbors_edge_weighting_adaptive_kernel.json`). Example call and compact result:

```json
{"dataset": "/data/example.singlet", "weighting": "umap", "n_neighbors": 15, "key": "weighted"}
```

```json
{"dataset": "/data/example.singlet", "status": "completed",
 "wrote": ["obsp/weighted_connectivities", "obs/weighted_scale", "obs/weighted_rho", "uns/weighted"],
 "summary": {"n_cells": "n", "n_edges": "E", "mean_degree": "...", "isolated_cells": "...",
   "weighting": "umap", "symmetrisation": "fuzzy_union", "scale_quantiles": {}},
 "provenance_id": "prov_..."}
```

Long-running: at atlas scale the job may be queued when the dry-run estimate exceeds the inline limit. Stochastic: no; the weights are deterministic given the kNN lists, and there is no seed. Dry run: returns the time and memory estimate from the $O(nk)$ and $O(nk^2)$ terms of section 3 with the device, and writes nothing.

## 8. Benchmarks

**Shared protocol.** All accuracy benchmarks use exact kNN on one fixed representation whose dimensionality is set before any result is seen. Each weighting is applied to the same prefix lists for `n_neighbors` in $\{10,15,20,30\}$. Communities are Leiden partitions [R11] of $W$ on the resolution grid $\{0.25,0.5,1.0,2.0\}$, with fixed seeds. The main summary uses the grid median, chosen without labels; the best-resolution variant is reported separately as an oracle. ARI is the primary label metric, and graph connectivity and NMI are guardrails.

### B1. Cell-line mixture label recovery

- **Goal**: recover the three cell lines of a controlled mixture from the weighted graph.
- **Ground truth**: orthogonal measurement. Each single cell's label is its cell line, stored in `colData()` as `cell_line_demuxlet`. Only the equal-proportion mixtures are used.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| sc_mixology, CEL-seq2 | [R13]; repository `LuyiTian/CellBench_data` at 7d00ffb; GEO GSE118767 | scRNA-seq; human lung adenocarcinoma lines HCC827, H1975, H2228; — | Section 12 | — |
| sc_mixology, Drop-seq | as above | scRNA-seq; as above; — | Section 12 | |
| sc_mixology, 10x Chromium | as above | scRNA-seq; as above; — | Section 12 | |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | chance-corrected pair agreement between the Leiden partition and the cell-line labels | maximise, $[-1,1]$ | primary | [R19] |
| NMI | mutual information over the arithmetic mean of the two entropies | maximise, $[0,1]$ | guardrail | [R14] |
| Graph connectivity | mean over labels of the fraction of a label's cells in its largest connected component of the induced kNN subgraph | maximise, $(0,1]$ | guardrail | [R15] |

- **Comparators**: the binary kNN graph (all weights 1) and a fixed-bandwidth Gaussian with $\sigma$ set to the median listed distance (both controls), and the methods of section 4 (with the defaults of section 4).
- **Protocol**: the shared protocol, with the three protocols analysed separately and their mean ARI as the summary.
- **Acceptance criterion** (proposed): a weighting is preferred if its mean ARI exceeds the best comparator by at least 0.02, with a paired bootstrap 95% interval over cells excluding zero in at least two of the three protocols. If every scheme reaches ARI of at least 0.95, the benchmark is declared saturated and non-discriminative.
- **Known pitfalls**: three well-separated lines give ARI near 1 for most schemes, so the benchmark has little power. The protocol is confounded with the design, so differences can reflect batch.

### B2. Planted density-contrast recovery (proposed)

- **Goal**: test whether a weighting keeps a low-density population connected and recovers it, using exact planted labels.
- **Ground truth**: planted simulation. The label is the mixture component that generated the cell. ARI needs no normalisation; graph connectivity is computed per component.
- **Generator recipe** (all parameters are proposals):
  1. Fix a seed. Place $C\in\{5,10\}$ centres $\mu_c$ equally spaced on a circle of radius 10 in $\mathbb{R}^2$.
  2. Let the first $C-1$ components have $m_0$ cells each and the last have $m_0/R$, with density ratio $R\in\{1,10,100\}$ at equal spread. Choose $m_0$ so the total is $n\in\{10^4,10^5\}$.
  3. Draw latent $z_i\sim\mathcal N(\mu_{c(i)},I_2)$.
  4. Draw $Q\in\mathbb{R}^{50\times2}$ with orthonormal columns (QR of a Gaussian matrix), and set $x_i=Qz_i+0.1\,\varepsilon_i$ with $\varepsilon_i\sim\mathcal N(0,I_{50})$.
  5. Keep $c(i)$ as the label, and use 20 seeds per setting.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| planted generator, $C$, $R$, $n$ as in the recipe | recipe above | simulated; $d=50$; $n\in\{10^4,10^5\}$ | — | none (generated) |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | chance-corrected pair agreement with the planted labels on Leiden partitions at resolution 1.0 | maximise, $[-1,1]$ | primary | [R19] |
| Within-cluster edge AUC | ROC AUC of $W_{ij}$ over kNN edges, separating within-component from between-component pairs | maximise, $[0,1]$ | guardrail | — |

- **Comparators**: the controls and methods of B1.
- **Protocol**: `n_neighbors` 15 and Leiden resolution 1.0, fixed in advance; mean and bootstrap interval over the 20 seeds; the rare component's graph connectivity is reported beside ARI.
- **Acceptance criterion** (proposed): a weighting is preferred if its ARI at $R=100$ exceeds the best comparator by at least 0.05, with a paired seed-level interval excluding zero.
- **Known pitfalls**: at $R=100$ and $n=10^4$ the rare component can hold fewer cells than $k$, where section 3.2 applies and its weights reflect list truncation. Dense components are well separated, so ARI differences come from the rare component alone.

### B3. Neighbourhood trustworthiness of a graph-derived layout

- **Goal**: test whether the weighted graph's neighbourhoods are faithful to the input space, without using labels.
- **Ground truth**: consistency. The reference is each cell's neighbour ranks in the representation used for the kNN search.
- **Layout**: the first two non-trivial eigenvectors of the symmetric normalised Laplacian of $W$, with a fixed eigen-solver seed and identical for every weighting. No layout optimiser is used, so the score does not reward UMAP's own objective.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| planted generator, $R\in\{1,100\}$ | recipe of B2 | simulated; $d=50$ | — | 20 seeds |
| sc_mixology, equal mixtures | B1 | scRNA-seq; as in B1 | Section 12 | three protocols |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Trustworthiness at $k=15$ | $1-\frac{2}{nk(2n-3k-1)}\sum_i\sum_{j\in U_i}(r_{ij}-k)$, with $r_{ij}$ the input-space rank of $j$ around $i$ and $U_i$ the cells in the 2-D $k$-neighbourhood but not the input $k$-neighbourhood | maximise, $[0,1]$ | primary | [R16] |

- **Comparators**: the controls and methods of B1.
- **Protocol**: the layout above; metric per dataset and per seed; `n_neighbors` 15 for the input ranks.
- **Acceptance criterion** (proposed): a weighting is preferred if trustworthiness at $k=15$ is higher by at least 0.01 on at least two datasets, with the same eigen-solver seed.
- **Known pitfalls**: trustworthiness is local, so it does not score global layout, which initialisation controls [R3]. A two-dimensional spectral layout compresses the graph, so the score reflects the layout as well as the weights; values are comparable across weightings here, not with UMAP-layout literature.

### P1. Performance and scaling

Build time and peak memory for each weighting at $n\in\{10^4,10^5,10^6\}$ cells and `n_neighbors` in $\{15,30\}$, on CPU and CUDA. Comparators: Scanpy (`umap`, `gauss`, `jaccard`), Seurat `ComputeSNN` in `src/snn.cpp`, the PhenoGraph `jaccard_kernel` (naive and parallel), and rapids-singlecell for the GPU forms of the same methods. Symmetrisation time is reported separately from weight construction. Each measurement is the median of 5 timings, with the spread reported. Hold fixed: the kNN indices and distances, the thread count, CSR storage and the hardware. Compare outputs numerically on identical inputs before timing, because the Scanpy and rapids-singlecell paths call different internals. No speed target is set against the comparators.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `neighbors.neighbor_count_selection`: Choice of neighbour count k and graph stability
- **Feeds**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `embedding-viz.local_neighborhood_preservation`: Local neighbourhood preservation of an embedding or reduced representation
  - `trajectory.pseudotime_ordering`: Pseudotime ordering along a lineage
- **Reads**: `obsp/<key>_distances`
- **Writes**: `obsp/<key>_connectivities`, `obsp/<key>_transitions`, `obs/<key>_scale`, `obs/<key>_rho`, `uns/<key>`
<!-- CHAINING:AUTO:END -->

The task sits after the kNN search and the choice of neighbour count, and before partitioning, layout and trajectory steps.

## 10. Risks, pitfalls and open questions

- Omitted methods: the self-tuning local-scaling kernel, the Jarvis-Patrick and SNN-Cliq methods, and the rank- and count-based SNN weights of bluster are not in the tables or the enum because no reference implementation is cited for them. The density normalisation of Coifman and Lafon [R17], which Scanpy applies in `compute_transitions` (`density_normalize`, with no alpha parameter), is a step on the weights rather than a weighting, so it is not in the enum; `row_normalise` writes $D^{-1}W$ as computed.
- Heiser and Lau [R4] have no matching record in the local corpus, and no source for their metric definitions, datasets or sizes is cited, so B3 uses the trustworthiness metric instead.
- The DuoClustering2018 benchmark [R18] is not used: its dataset list, label provenance, subsampling and label-matching rules are unknown here, and its full-pipeline design confounds weights with clustering. The cell counts of the CellBench protocol subsets are also unknown, so B1 cannot be sized yet.
- Seurat's convention for whether the cell counts in `k.param` is unknown here, and Jaccard denominators differ between Seurat ($2k$), PhenoGraph ($2k$ with the cell excluded) and Scanpy ($2(\texttt{n\_neighbors}-1)$). A single convention must be fixed before comparing counts.
- The calibrated model depends on author annotations, which are noisy. The pair labels must be defined at one granularity and split by study, or the calibration will not transfer.
- The first experiment is B1 and B2 with the four methods and two controls at `n_neighbors` 15, to measure whether differences exceed the acceptance margins before the calibrated model is built.

## 11. References

R1. McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction. *arXiv* 2018. doi:10.48550/arXiv.1802.03426 — verified (corpus)

R2. Kobak D, Berens P. The art of using t-SNE for single-cell transcriptomics. *Nat Commun* 2019. doi:10.1038/s41467-019-13056-x — verified (corpus)

R3. Kobak D, Linderman GC. Initialization is critical for preserving global data structure in both t-SNE and UMAP. *Nat Biotechnol* 2021. doi:10.1038/s41587-020-00809-z — verified (corpus)

R4. Heiser CN, Lau KS. A quantitative framework for evaluating single-cell data structure preservation by dimensionality reduction techniques. *Cell Rep* 2020;31(5):107576. — unverified (memory)

R5. Coifman RR, Lafon S, Lee AB, Maggioni M, Nadler B, Warner F, Zucker SW. Geometric diffusions as a tool for harmonic analysis and structure definition of data: diffusion maps. *Proc Natl Acad Sci USA* 2005. doi:10.1073/pnas.0500334102 — verified (corpus)

R6. Haghverdi L, Buettner M, Wolf FA, Buettner F, Theis FJ. Diffusion pseudotime robustly reconstructs lineage branching. *Nat Methods* 2016. doi:10.1038/nmeth.3971 — verified (corpus)

R7. Levine JH, Simonds EF, Bendall SC, et al. Data-driven phenotypic dissection of AML reveals progenitor-like cells that correlate with prognosis. *Cell* 2015. doi:10.1016/j.cell.2015.05.047 — verified (corpus)

R8. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)

R9. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biol* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)

R10. Blondel VD, Guillaume JL, Lambiotte R, Lefebvre E. Fast unfolding of communities in large networks. *J Stat Mech* 2008. doi:10.1088/1742-5468/2008/10/P10008 — verified (corpus)

R11. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Sci Rep* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)

R12. van der Maaten L, Hinton G. Visualizing data using t-SNE. *J Mach Learn Res* 2008;9. http://jmlr.org/papers/v9/vandermaaten08a.html — verified (corpus)

R13. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nat Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)

R14. Emmons S, Kobourov S, Gallant M, Börner K. Analysis of network clustering algorithms and cluster quality metrics at scale. *PLoS ONE* 2016. doi:10.1371/journal.pone.0159161 — verified (corpus)

R15. Luecken MD, Buttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nat Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)

R16. Venna J, Kaski S. Neighborhood preservation in nonlinear projection methods: an experimental study. *ICANN 2001*. doi:10.1007/3-540-44668-0_68 — verified (corpus)

R17. Coifman RR, Lafon S. Diffusion maps. *Appl Comput Harmon Anal* 2006. doi:10.1016/j.acha.2006.04.006 — verified (corpus)

R18. Duo A, Robinson MD, Soneson C. A systematic performance evaluation of clustering methods for single-cell RNA-seq data. *F1000Research* 2018. doi:10.12688/f1000research.15666.1 — verified (corpus)

R19. Hubert L, Arabie P. Comparing partitions. *J Classif* 1985. doi:10.1007/bf01908075 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/lmcinnes/umap | Leland McInnes (copyright holder in LICENSE.txt); paper authors McInnes, Healy, Melville | BSD-3-Clause (LICENSE.txt); pyproject.toml states `BSD` | calibration and fuzzy union (umap) | port |
| https://github.com/scverse/scanpy | Adam Gayoso, Alex Wolf, Andrés R. Muñoz-Rojas, Davide Cittaro and others (pyproject.toml); copyright scverse® 2025 (LICENSE) | BSD-3-clause | `gauss` and `jaccard` formulas; default weighting | port (formulas); callout (comparator) |
| https://github.com/satijalab/seurat | Andrew Butler, Saket Choudhary, David Collins, Charlotte Darby and others (DESCRIPTION) | MIT + file LICENSE (DESCRIPTION) | SNN Jaccard kernel, `src/snn.cpp` | callout (comparator) |
| https://github.com/dpeerlab/PhenoGraph | Jacob Levine, Columbia University (LICENSE) | MIT (LICENSE) | Jaccard-weighted kNN comparator | callout |
| https://github.com/scikit-learn/scikit-learn | The scikit-learn developers | BSD-3-Clause (COPYING; pyproject.toml) | perplexity calibration, `_t_sne.py` and `_utils.pyx` | port |
| https://github.com/scverse/rapids-singlecell | Severin Dicks (pyproject.toml; LICENSE) | MIT (LICENSE) | GPU comparator (P1) | callout |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt; pyproject.toml) | graph-connectivity metric (`graph_connectivity.py`) | reimplement |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian (LICENSE) | MIT (LICENSE) | B1 input data | callout (benchmark data) |
