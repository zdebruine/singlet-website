---
id: embedding-viz.trajectory_structure_preservation
title: Trajectory and branch preservation in a 2D layout
area: embedding-viz
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [dim-reduction.normalized_cell_embedding, clustering.cell_partitioning, simulation.trajectory_lineage_simulation]
feeds: [embedding-viz.hyperparameter_selection, embedding-viz.embedding_stability]
reads: [obsm/X_pca, obsp/connectivities, obs/leiden, uns/trajectory_graph, obsm/milestone_percentages, obs/delayed_commitment_zone]
writes: [obsm/X_trajectory_2d, uns/trajectory_layout_eval]
devices: [cpu, cuda]
mcp_tool: singlet_embedding_viz_trajectory_structure_preservation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Trajectory and branch preservation in a 2D layout

> Scores whether a 2D layout keeps a reference trajectory's geodesic order, branch sets and milestone topology, measured on the graph that the layout itself implies.

## 1. Question

Does a two-dimensional layout keep a known trajectory intact, with cells ordered along each branch, branch membership preserved and branch points where the reference puts them, or does it cut the continuum into artificial clusters or merge branches? Inputs are the PCA coordinates and kNN graph of a dataset with a reference trajectory (simulated, or labelled by sampling time) and a 2D layout. The output is one score per layout, metric, dataset and seed. A good layout reproduces the reference geodesic order and milestone topology; the score says nothing about cluster sizes or global density.

## 2. Why this task matters and where the field stands

Two-dimensional maps are the default view of developmental data, and a layout that bends or splits a continuum makes an analyst count clusters that do not exist. Layouts built for this purpose include PHATE, which embeds diffusion geometry so that progressions appear as curves [R1], and PAGA, whose cluster-level graph keeps coarse topology that a cell layout can inherit [R4]. Trajectory inference has its own benchmark and metrics [R7], but those metrics were validated on trajectory-inference outputs, not on maps.

Status: **contested**. Methods disagree on what a faithful map is, the score depends on how a graph is extracted from the map, and no accepted protocol scores a 2D layout against trajectory truth.

Open problems:

1. No published benchmark applies trajectory metrics to graphs extracted from layouts [R7].
2. The rule that turns coordinates into milestones and branch labels is not standardised, and scores move with it.
3. Snapshot measurements cannot identify the true topology [R9], so reference trajectories must come from simulation or time labels.

## 3. Theory and insight

**Estimands.** Let $W$ be the 100 waypoint cells and $C$ all cells. The reference geodesic $d^{\mathrm{ref}}(a,b)$ is the shortest path in the reference milestone network, with edges weighted by length [R7]. The predicted geodesic $d^{\mathrm{pred}}(a,b)$ is the shortest path in the graph extracted from the layout (section 8). Geodesic correlation is

$$\rho_{\mathrm{geo}}=\mathrm{Spearman}\big(\{d^{\mathrm{ref}}(a,b)\}_{a\in W,\,b\in C},\ \{d^{\mathrm{pred}}(a,b)\}_{a\in W,\,b\in C}\big),$$

with averaged ranks for ties, set to zero when negative or when either matrix is constant [R7]. It is invariant to a global change of distance unit, but not to the relative lengths of different edges, which the layout sets through centroid distances.

Branch sets are cell sets. A reference set holds the cells whose closest milestone is one milestone; a predicted set holds the cells nearest one centroid. With $J(b,b')=|b\cap b'|/|b\cup b'|$, recovery $R$ and relevance $P$ are the mean best Jaccard match of each reference (predicted) set among the predicted (reference) sets, and $F_1=2RP/(R+P)$ [R7]; $J$ and $F_1$ lie in $[0,1]$. The Hamming–Ipsen–Mikhailov similarity compares the edge-length-weighted adjacency matrices of two milestone networks, with $\gamma=0.1$ [R8]. Zone purity is, per cell in a delayed-commitment zone, the fraction of its $k$ nearest 2D neighbours that share its dominant reference milestone (the argmax of its milestone percentages); the output is the mean over zone cells, in $[0,1]$.

**Diffusion geometry.** For a row-normalised kernel $P=D^{-1}W$ with eigenpairs $(\lambda_l,\psi_l)$, the diffusion distance at time $t$ is

$$D_t(x_i,x_j)^2=\sum_{l\ge 1}\lambda_l^{2t}\big(\psi_l(x_i)-\psi_l(x_j)\big)^2$$

as defined in [R2]. The sum omits the steady-state vector $\psi_0$. A diffusion map uses the first two non-trivial coordinates as its layout. The approximation holds for a connected kNN graph with a locally set bandwidth, and the leading components carry the coarse branch structure.

**Potential distances.** PHATE takes the logarithm of $t$-step diffusion probabilities, $U_i=-\log P^{t}_{i\cdot}$, and embeds $\lVert U_i-U_j\rVert_2$ by metric MDS [R1]. This is the $\gamma=1$ case; $\gamma=0$ gives a square-root transform. The map preserves potential distances, not $D_t$.

**Group graph.** PAGA scores each group pair by observed over expected connectivity under a random-rewiring null. With $n$ cells, $n_i$ cells in group $i$, $\varepsilon_i$ edges touching group $i$ and $a_{ij}$ the inter-group edge weight,

$$E_{ij}=\frac{\varepsilon_i n_j+\varepsilon_j n_i}{n-1},\qquad \hat c_{ij}=\min\!\Big(\frac{a_{ij}}{E_{ij}},\,1\Big)$$

as in [R4]. The comparison holds for a fixed partition, so the partition and its resolution are inputs to the score.

**Attraction layouts.** UMAP minimises a cross-entropy between fuzzy neighbour memberships in the input and in the map [R5]. ForceAtlas2 balances attraction along edges against degree-weighted repulsion [R6], and its stationary state is the regime of validity. Neither objective targets distances between distant cells, so a change of seed or hyperparameters can drop or invent a branch.

**Heuristic and model-based.** Diffusion geometry keeps continuous paths continuous by design; UMAP's objective protects neighbourhoods but not the placement of distant branches. This is a design argument, and no head-to-head trajectory score on shared data is cited here. A model-based layout adds a fitted objective that can be trained on simulated geodesics, and the spread across seeds gives a per-cell uncertainty.

**Pitfalls.** A reference pseudotime taken from diffusion pseudotime on the layout's own graph is circular [R3]. kNN shortcuts across branches merge them in the layout graph.

## 4. Methods landscape

Trajectory scoring follows [R7]. PHATE [R1] and UMAP [R5] are the standard 2D views, and PAGA [R4] supplies coarse topology for initialisation. The table keeps only methods whose code or defaults were read; PCA is the textbook linear baseline. Defaults singlet uses follow, with sources in the last column.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| PHATE | heuristic | Log potential of $t$-step diffusion probabilities, embedded by metric MDS | [R1] |
| Diffusion map | heuristic | Leading non-trivial eigenvectors of the Markov operator; Euclidean distance approximates diffusion distance | [R2] |
| UMAP, spectral or PAGA initialisation | model-based | Cross-entropy between fuzzy neighbour memberships in the input and the map | [R5], [R4] |
| ForceAtlas2 (`draw_graph_fa`) | heuristic | Attraction along edges and degree-weighted repulsion, to a stationary state | [R6] |
| PCA to 2D (baseline) | model-based | Projection onto the two leading principal components | — |

| Method | Parameter | Value | Source (file @ commit) |
|---|---|---|---|
| PHATE | n_components | 2 | phate.py:189 @ 65a1f73 |
| PHATE | knn | 5 | phate.py:190 |
| PHATE | decay | 40 | phate.py:191 |
| PHATE | n_landmark | 2000 | phate.py:192 |
| PHATE | t | auto | phate.py:193 |
| PHATE | gamma | 1 (log potential) | phate.py:194; docstring :84 |
| PHATE | n_pca, mds_solver | 100, sgd | phate.py:195–196 |
| PHATE | knn_dist, mds_dist, mds | euclidean, euclidean, metric | phate.py:197, 199, 200 |
| PHATE | random_state | None | phate.py:202 |
| Diffusion map | n_comps | 15 | _diffmap.py:27 @ 8ed52d9 |
| PAGA | model | v1.2 | _paga.py:27 @ 8ed52d9 |
| PAGA | connectivity cap | 1 | _paga.py:201 |
| UMAP | n_neighbors | 15 | umap_.py:1752 @ 33d7e6f |
| UMAP | init | spectral | umap_.py:1760 |
| UMAP | min_dist | 0.1 | umap_.py:1761 |
| ForceAtlas2 | layout engine | fa | _draw_graph.py:40 @ 8ed52d9 |
| ForceAtlas2 | init_pos | None | _draw_graph.py:42 |
| ForceAtlas2 | backend | fa2_modified | _draw_graph.py:185 |

## 5. Proposed singlet approach

**Routes.** PHATE is reimplemented from its documented algorithm; diffusion maps, PAGA and UMAP are ported from permissively licensed code; ForceAtlas2 and both metric implementations are reimplemented. PCA and the dynbenchmark datasets are benchmark comparators only (section 12).

**Model-based formulation.** The proposed layout is a network $f_\theta$ from input PCs to two dimensions, trained on simulated trajectories with known milestone networks. Its loss matches a differentiable soft rank of 2D geodesics to reference geodesics on the waypoint set, plus a term that keeps kNN neighbourhoods. Per-cell uncertainty is the spread of coordinates across seeds, drawn as an ellipse. **Falsification:** on B1, if the layout does not exceed the best published comparator by 0.05 in median `cor_geodesic` (proposed), or lowers zone purity in B2, the route is dropped and PHATE stays the default.

**ML stack.** PyTorch trains the layout network. Hard-coded CUDA or cuSPARSE kernels cover the hot sparse operations: products with $P^t$ and the kNN Laplacian, the sparse eigensolve for diffusion coordinates, and force repulsion. All-pairs repulsion costs $O(n^2)$ and needs a Barnes–Hut approximation at scale.

**Devices and streaming.** A layout needs the whole kNN graph in memory, so streaming is not claimed. CPU runs use sparse solvers and metric MDS; CUDA runs use the kernels above.

**Defaults.** Use `layout_method` phate, `input_pcs` 50 (proposed), `seed` 0, `evaluation.n_seeds` 5 (proposed), all four metrics and `paga.groups_key` leiden. PHATE builds its own kernel and does not read `obsp/connectivities`; the other layouts do.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/X_pca | float32 | Input principal components; 50 used by default |
| read | obsp/connectivities | sparse float | kNN graph for graph-based layouts |
| read | obs/leiden | categorical | PAGA groups; key set by `paga.groups_key` |
| read | uns/trajectory_graph | graph | Reference milestone network (evaluation) |
| read | obsm/milestone_percentages | float32 | Per-cell milestone percentages, rows sum to 1 (evaluation) |
| read | obs/delayed_commitment_zone | bool | Zone membership (zone purity only) |
| write | obsm/X_trajectory_2d | float32 | Coordinates of the evaluated layout |
| write | uns/trajectory_layout_eval | dict | Scores and predicted branch counts per layout and metric |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layout_method` | string | "phate" | `phate`, `diffmap`, `umap_spectral`, `umap_paga`, `draw_graph_fa` | 2D layout to evaluate. phate is the default and the only layout that builds its own kernel. |
| `input_pcs` | integer | 50 | min 2 | Principal components of obsm/X_pca used as layout input (proposed default). |
| `metrics` | array | ["cor_geodesic", "f1_branches", "him", "delayed_commitment_purity"] | — | Trajectory metrics to compute. Each metric needs its reference members; missing members are an error. |
| `phate` | object | {} | — | PHATE options, used only when layout_method is phate. |
| `phate.knn` | integer | 5 | min 1 | Neighbours in the PHATE alpha-decay kernel. |
| `phate.decay` | number | 40 | min 0 | Alpha-decay of the PHATE kernel. |
| `phate.n_landmark` | integer/null | 2000 | min 1 | Landmarks for MDS; null disables landmarking. |
| `phate.t` | integer/string | "auto" | — | Diffusion time; auto chooses it from the data. |
| `phate.gamma` | number | 1 | min -1; max 1 | Potential transform; 1 is the log potential, 0 the square root. |
| `paga` | object | {} | — | PAGA options, used only when layout_method is umap_paga. |
| `paga.groups_key` | string | "leiden" | — | obs key of the PAGA groups; the key must exist before the call. |
| `evaluation` | object | {} | — | Evaluation options shared by all layouts. |
| `evaluation.n_waypoints` | integer | 100 | min 10 | Waypoint cells shared by reference and prediction. |
| `evaluation.purity_k` | integer | 15 | min 1 | Neighbours in the 2D graph used for zone purity. |
| `evaluation.n_seeds` | integer | 5 | min 1 | Number of seeds, counted from seed (proposed default). |
| `evaluation.ceiling_control` | boolean | true | — | Also score the same graph rule applied to PCA input. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | First random seed for layouts and the k-means step of the graph rule. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`layout_method` selects one layout; `phate` applies only to `phate`, and `paga` only to `umap_paga`. `evaluation.ceiling_control` adds the PCA-50 control under the same graph rule. The graph rule is fixed, not a parameter, so every method is scored on one extraction. Missing reference members raise an error; a metric is never skipped silently. `seed` seeds the layouts and the k-means step, and seeds run from `seed` to `seed` plus `n_seeds` minus one.

## 7. MCP tool

Tool name `singlet_embedding_viz_trajectory_structure_preservation` (definition in `tasks/mcp/singlet_embedding_viz_trajectory_structure_preservation.json`). Angle brackets mark placeholders, not measurements.

```json
{"dataset": "path/to/simulated.singlet", "layout_method": "phate",
 "metrics": ["cor_geodesic", "f1_branches", "him"],
 "evaluation": {"n_seeds": 5, "ceiling_control": true}}
```

```json
{"dataset": "path/to/simulated.singlet", "status": "completed",
 "wrote": ["obsm/X_trajectory_2d", "uns/trajectory_layout_eval"],
 "summary": {"layout_method": "phate",
   "scores": {"cor_geodesic": "<median>", "f1_branches": "<median>", "him": "<median>"},
   "predicted_branches": "<count>", "ceiling_scores": "<median>"},
 "provenance_id": "<id>"}
```

Long-running: jobs queue when the dry-run estimate exceeds the inline limit, which the P1 measurements set. Stochastic: results are reproducible for a fixed seed and device. Dry run: returns estimated seconds, peak memory and device for each requested layout without computing it.

## 8. Benchmarks

**Shared protocol.** Each layout uses its defaults and seeds from `seed` to `seed` plus `n_seeds` minus one (proposed). One graph rule applies to every method: k-means with $k$ equal to the reference milestone count, then a minimum spanning tree over the centroids (proposed). Each cell takes its nearest centroid as its predicted group and lies on its nearest tree edge for geodesics (proposed). Reference and prediction share the same 100 waypoint cells, stratified over milestones, edges and delayed-commitment zones [R7]. The PCA-50 ceiling applies the same rule to PCA coordinates. Scores are medians and interquartile ranges over datasets and seeds.

### B1. Simulated milestone fidelity of 2D layouts

- **Goal**: whether a 2D layout reproduces the planted milestone network, milestone grouping and geodesic order of simulated trajectories.
- **Ground truth**: planted simulation. Milestone percentages sum to one per cell; a cell's reference group is its closest milestone; reference edge lengths are drawn uniformly from 0.5 to 1 [R7].
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Synthetic trajectories from four simulator wrappers: dyngen, PROSSTT, Splatter, dyntoy | Scripts 02a–02d of the dynbenchmark synthetic pipeline [R7] | Simulated scRNA-seq; cell count equal to a real reference dataset | §12 | Each design links a platform, a topology and a seed |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| `cor_geodesic` | Spearman $\rho_{\mathrm{geo}}$ of section 3, clamped at zero | maximise, 0 to 1 | primary | [R7] |
| `f1_branches` | Harmonic mean of recovery and relevance over cell sets; predicted branch count reported alongside | maximise, 0 to 1 | primary | [R7] |
| `him` | Hamming–Ipsen–Mikhailov similarity of milestone networks, $\gamma=0.1$ | maximise | primary | [R8] |

- **Comparators**: PHATE, diffusion map, UMAP with spectral and with PAGA initialisation, ForceAtlas2, PCA to 2D, and the PCA-50 ceiling control.
- **Protocol**: the shared protocol; scores are reported per simulator as well as pooled.
- **Acceptance criterion** (proposed, no literature threshold): on a dataset, $\rho_{\mathrm{geo}}\ge 0.8$ and $F_1\ge 0.8$; the median across datasets of each metric exceeds PCA to 2D by at least 0.10. Calibrate against the ceiling control before adoption.
- **Known pitfalls**: $F_1$ rewards merging when few branches are predicted; $\rho_{\mathrm{geo}}$ depends on the waypoint set, so one set is shared.

### B2. Delayed-commitment zone purity (proposed)

- **Goal**: whether cells in delayed-commitment zones, where branch membership is mixed by construction, keep locally consistent branch labels in 2D.
- **Ground truth**: planted simulation. The zone comes from the trajectory model; the dominant milestone is the argmax of milestone percentages.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Synthetic trajectories in which delayed-commitment zones were added to a divergence in a random half of cases | Synthetic pipeline of [R7], zone subset | Simulated scRNA-seq; — | §12 | Generated as in B1 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Zone purity | Mean over zone cells of the fraction of $k=15$ nearest 2D neighbours sharing the dominant milestone | maximise, 0 to 1 | primary | [R7] |
| Random-label control | Dominant labels permuted within their class sizes; reported beside each value | reference level | control | — |

- **Comparators**: PCA to 2D, UMAP with spectral initialisation, PHATE, UMAP with PAGA initialisation.
- **Protocol**: zone cells come from simulation metadata; the 2D graph follows the shared protocol with $k=15$.
- **Acceptance criterion** (proposed, no literature threshold): mean purity at least 0.8, with the random-label control below 0.5.
- **Known pitfalls**: the dominant label is ambiguous inside a zone, so report the entropy of milestone percentages as a covariate; purity rewards over-merging near junctions, so read it with B1's $F_1$.

### P1. Performance and scaling

Inputs are uniform random subsamples of one catalogue dataset at 10k, 100k and 1M cells (proposed scales, matching embedding-viz.large_scale_embedding), with the same cells for every method. Comparators are PHATE with default landmarking and with landmarking off, diffusion map, both UMAP variants, ForceAtlas2 and PCA to 2D. Measure wall time and peak resident memory separately for graph construction and the layout step, on CPU and CUDA, and report cells per second. Hold fixed: two output dimensions, 50 input PCs, $k$, seeds, thread count and hardware. PHATE's kernel is private, so the shared graph is timed only for graph-based layouts.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `simulation.trajectory_lineage_simulation`: Trajectory and branching-lineage simulation with known pseudotime
- **Feeds**:
  - `embedding-viz.hyperparameter_selection`: Selection of perplexity, neighbour count, min_dist and initialization
  - `embedding-viz.embedding_stability`: Embedding stability across seeds, subsamples and hyperparameters
- **Reads**: `obsm/X_pca`, `obsp/connectivities`, `obs/leiden`, `uns/trajectory_graph`, `obsm/milestone_percentages`, `obs/delayed_commitment_zone`
- **Writes**: `obsm/X_trajectory_2d`, `uns/trajectory_layout_eval`
<!-- CHAINING:AUTO:END -->

Workflows: layout choice for trajectory-like data, and the simulated benchmark recipe.

## 10. Risks, pitfalls and open questions

- **Sources not read.** The PHATE paper, including its trajectory evaluation and the DEMaP metric, was not read, so PHATE's theory follows its documentation. Code for openTSNE, SPRING and the Haghverdi et al. simulations was not read, so those methods and benchmarks are absent. The scikit-learn PCA code, the fa2-modified code and the dynbenchmark design scripts' per-simulator counts were not read. The manuscript gives no weights for combining the Hamming and Ipsen–Mikhailov distances. Line numbers refer to corpus copies, which carry no git metadata, at the commits in section 4 and section 12.
- **Licence decisions.** PHATE's package metadata (GPL-2.0) conflicts with its LICENSE.md (non-commercial), so its reimplementation waits for a licence decision. The fa2-modified licence is unknown and dyneval is GPL-3, so both are reimplemented from their documented algorithms.
- **Unsettled science.** No published score evaluates 2D layouts against trajectory truth. The graph rule is a confound, and the ceiling control is the only check on it. Branch-point location in 2D has no agreed measure. Time-course order fidelity and clone coherence are omitted because no dataset carrying sampling times or clone barcodes for this role is named.
- **Risks and first experiment.** Reference pseudotime must not come from diffusion pseudotime on the layout's graph. Compute B1 on the simulated datasets for PHATE, diffusion map, UMAP spectral, ForceAtlas2 and PCA to 2D, with the PCA-50 ceiling. If the ceiling itself does not reach the reference order, the graph rule dominates the score and the thresholds are invalid. P1 also needs one named catalogue dataset.

## 11. References

R1. Moon KR, van Dijk D, Wang Z, et al. Visualizing structure and transitions in high-dimensional biological data. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0336-3 — verified (corpus)

R2. Coifman RR, Lafon S. Diffusion maps. *Applied and Computational Harmonic Analysis* 2006. doi:10.1016/j.acha.2006.04.006 — verified (corpus)

R3. Haghverdi L, Büttner M, Wolf FA, Buettner F, Theis FJ. Diffusion pseudotime robustly reconstructs lineage branching. *Nature Methods* 2016. doi:10.1038/nmeth.3971 — verified (corpus)

R4. Wolf FA, Hamey FK, Plass M, et al. PAGA: graph abstraction reconciles clustering with trajectory inference through a topology preserving map of single cells. *Genome Biology* 2019. doi:10.1186/s13059-019-1663-x — verified (corpus)

R5. McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction. *arXiv* 2018. doi:10.48550/arxiv.1802.03426 — verified (corpus)

R6. Jacomy M, Venturini T, Heymann S, Bastian M. ForceAtlas2, a continuous graph layout algorithm for handy network visualization designed for the Gephi software. *PLoS ONE* 2014. doi:10.1371/journal.pone.0098679 — verified (corpus)

R7. Saelens W, Cannoodt R, Todorov H, Saeys Y. A comparison of single-cell trajectory inference methods. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0071-9 — verified (corpus)

R8. Jurman G, Visintainer R, Filosi M, Riccadonna S, Furlanello C. The HIM glocal metric and kernel for network comparison and classification. *2015 IEEE International Conference on Data Science and Advanced Analytics (DSAA)* 2015. doi:10.1109/dsaa.2015.7344816 — verified (corpus)

R9. Weinreb C, Wolock S, Tusi BK, Socolovsky M, Klein AM. Fundamental limits on dynamic inference from single-cell snapshots. *Proceedings of the National Academy of Sciences* 2018. doi:10.1073/pnas.1714723115 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/KrishnaswamyLab/PHATE | KrishnaswamyLab; LICENSE.md copyright Yale University (2024) | Conflict: GPL-2.0 in pyproject.toml; Yale Non-Commercial License in LICENSE.md | PHATE defaults and documented algorithm | reimplement, pending licence decision |
| https://github.com/scverse/scanpy | scverse developers; LICENSE names F. Alexander Wolf, P. Angerer, Theis Lab (2017) and scverse (2025) | BSD-3-Clause | Diffusion map, PAGA v1.2, draw_graph and UMAP wrappers | port |
| https://github.com/lmcinnes/umap | Leland McInnes (LICENSE.txt, 2017) | BSD-3-Clause | UMAP defaults and optimisation | port |
| https://github.com/AminAlam/fa2_modified | — | GPL-3.0 (LICENSE) | ForceAtlas2 backend used by scanpy draw_graph | reimplement |
| https://github.com/dynverse/dynbenchmark | Robrecht Cannoodt, Wouter Saelens (copyright holders) | MIT (LICENSE.md) | Synthetic datasets (scripts 02a–02d); manuscript metric and protocol text (paper.Rmd lines 133, 342–343, 611, 649–662) | callout (datasets) |
| https://github.com/dynverse/dyneval | Robrecht Cannoodt, Wouter Saelens, Helena Todorov (Authors@R) | GPL-3 (DESCRIPTION; no LICENSE file in the corpus copy) | Reference correlation and HIM code (calculate_metrics.R) | reimplement |
| https://github.com/scikit-learn/scikit-learn | scikit-learn developers | BSD-3-Clause (pyproject.toml, COPYING) | PCA baseline and PCA-50 control | callout |
