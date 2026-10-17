---
id: trajectory.topology_inference
title: Trajectory topology inference
area: trajectory
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection, clustering.cell_partitioning]
feeds: [trajectory.branch_point_assignment, trajectory.pseudotime_ordering, trajectory.terminal_state_identification]
reads: [obsm/X_pca, obs/cluster]
writes: [uns/trajectory_graph, obsm/milestone_percentages, obs/milestone, models/principal_graph]
devices: [cpu, cuda]
mcp_tool: singlet_trajectory_topology_inference
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Trajectory topology inference

> Infers the graph of milestones that a cell population traces in an embedding, and gives each cell soft positions on that graph.

## 1. Question

What graph (nodes, edges, branch points, endpoints, loops and disconnected components) best describes the state space of a continuously changing or responding population in a low-dimensional embedding, and where does each cell sit on that graph? The inputs are an embedding of normalised expression, optional cluster labels and an optional start cell. The outputs are a milestone network and per-cell milestone percentages. A correct answer matches the planted or reference topology class and the true cell positions, as scored in section 8.

## 2. Why this task matters and where the field stands

Branch points, lineage labels and pseudotime are all read off a graph, so an incorrect graph propagates into every downstream trajectory result. The status is **contested**. The published benchmark reports that no method is generally best and that the choice depends on dataset dimensions and the trajectory topology [R1, R9]. The choice of metric also changes ranks: an isomorphism test is binary, while HIM and F1 depend on edge-length normalisation and on how cells are grouped [R10, R11].

Open problems:

- **Identifiability.** Snapshots determine an undirected skeleton only under density and noise assumptions; direction, root and sparse branches need extra information [R7].
- **Loops against lineages.** Cyclic topologies are part of the benchmark design [R9], but cell-cycle or stress programs can close a loop that is not a lineage, so a cycle needs an orthogonal-process check.
- **Calibrated uncertainty.** The methods reviewed here return a point graph with no edge probabilities; uncertainty over graph structure is an open design space.
- **Lineage trees without barcodes.** Clonal barcodes give an orthogonal reference for fate splits in some systems [R8], but they are sparse and do not define topology directly.

## 3. Theory and insight

Cells are points $x_i\in\mathbb{R}^d$, $i=1,\dots,N$, in an embedding of dimension $d$. A graph has $K$ nodes (milestones) at positions $y_k$, and $R_{ik}$ is the responsibility of node $k$ for cell $i$. A principal-graph method minimises an explained-variance term plus a complexity penalty:

$$\min_{Y,R,T}\ \sum_{i=1}^{N}\sum_{k=1}^{K}R_{ik}\,\|x_i-y_k\|^2+\lambda\,P(T,Y)\quad\text{s.t.}\quad\sum_{k}R_{ik}=1\tag{E1}$$

where $T$ is the graph and $P$ penalises edge length, bending or extra branch points. This is a schematic common form: the principal-tree and elastic fits of scFates use different penalties [R6], and DDRTree uses its own latent-centre formulation [R2]. Responsibilities are Gaussian with bandwidth $\sigma$:

$$R_{ik}=\frac{\exp(-\|x_i-y_k\|^2/2\sigma^2)}{\sum_{l}\exp(-\|x_i-y_l\|^2/2\sigma^2)}\tag{E2}$$

As $\sigma\to0$ the assignment becomes hard and $k$-means-like; a large $\sigma$ blurs neighbouring nodes together and collapses branches. For a fixed graph with edge set $E$, the stretching penalty $\lambda\sum_{(k,l)\in E}\|y_k-y_l\|^2$ makes the node update linear:

$$\bigl(\mathrm{diag}(\nu)+\lambda L\bigr)\,Y=R^\top X,\qquad \nu_k=\sum_i R_{ik},\quad L=D-A\tag{E3}$$

with $A$ the graph adjacency, $D$ its degree matrix and $X$ the $N\times d$ cell matrix. The solve is exact for fixed $R$ and $E$, has $K$ unknowns per dimension, and has no bending term.

Cluster-based methods do not fit E1. PAGA's v1.2 connectivity between clusters $i$ and $j$ is

$$c_{ij}=\min\!\Bigl(1,\frac{e_{ij}}{\bar e_{ij}}\Bigr),\qquad \bar e_{ij}=\frac{e_i\,n_j+e_j\,n_i}{n-1}\tag{E4}$$

where $e_{ij}$ counts kNN edges between clusters $i$ and $j$, $e_i$ the edges incident to cluster $i$, $n_i$ the cluster size and $n$ the number of cells. The denominator is the expectation under random mixing, so $c_{ij}$ is an enrichment relative to a random-mixing null, valid for large $n$ and approximately random mixing; the cap at 1 hides enrichment above the null [R4]. A model-based alternative is the mixture of factor analysers that Campbell and Yau use to model bifurcations [R13]:

$$p(x)=\sum_{k=1}^{K}\pi_k\,\mathcal N\!\left(x;\ \mu_k,\ W_kW_k^\top+\Psi_k\right)\tag{E5}$$

Its responsibilities give soft segment assignments, and choosing $K$ by BIC or ICL decides whether a fork is resolved.

Estimands. Each output and ground-truth quantity is defined as follows.

- Milestone network: an undirected weighted graph with edge lengths in embedding units; topology comparisons divide each adjacency matrix by its total edge length, so only relative lengths matter.
- Milestone percentages: $\pi_{ik}\ge 0$ is the share of cell $i$ on milestone $k$, with $\sum_k\pi_{ik}=1$.
- Planted truth: the generator's network, normalised in the same way, and each cell's barycentric position on it.
- Group sets for F1: cells grouped by nearest edge or by nearest milestone, so F1 depends on the grouping.
- Stability: the HIM score between two networks fitted to different subsamples of one dataset.

Regime of validity. E1 recovers the skeleton only when the cloud concentrates around a one-dimensional graph, the noise is small relative to branch spacing, and each branch has enough cells. Outside that regime, node count trades off against noise and the penalty decides the result.

Assumptions and failure modes. The assumptions are that a continuous process concentrates near a skeleton in the embedding, that the embedding preserves branch geometry, that each branch has enough cells, that the true topology lies in the method's class (tree methods cannot represent cycles or disconnected components), and that cell-cycle or stress programs do not dominate the embedding. Failure modes follow the method family. Cluster-MST methods (Slingshot, TSCAN) inherit the clustering resolution, so the tree changes with the number of clusters [R3, R5]. PAGA gives a cluster graph rather than an ordering [R4]. Principal graphs (Monocle 2, scFates) need a node count: too few nodes merge forks and too many invent them, and the penalty sets the trade-off between false and missed branches [R2, R6]. Batch effects and doublets create artefactual bridges in every family.

Insight. Topology inference is model selection. Node count and penalty jointly set the operating point between spurious and missed branches, and that operating point is part of the result. Heuristic methods fix it implicitly through clustering or defaults. A penalised likelihood exposes it, lets BIC or ICL select it, and yields edge-level responsibilities; that claim holds only as far as the Gaussian-responsibility assumption on the embedding holds. Converting every method's output into a common milestone model can change its topology class, so the conversion is itself part of the score [R9].

## 4. Methods landscape

The published heuristic standard is the cluster-based family (Slingshot, TSCAN) and PAGA, which the benchmark executes with default parameters [R1, R9]. The hybrid standard is principal-graph fitting (Monocle 2 DDRTree, scFates). All five are kept as comparators; singlet's own model is in section 5. Other graph methods are omitted from the tables because their algorithm code was not reviewed (section 10).

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Monocle 2 (DDRTree) | hybrid | Reversed graph embedding: learns K centres and a principal tree over them, then projects cells onto the tree. | [R2] |
| Slingshot | heuristic | Minimum spanning tree over cluster centres, then simultaneous principal curves along lineages from a start cluster. | [R3] |
| TSCAN | heuristic | Cluster-based MST over cluster centres, with each cell projected onto the tree; accepts user-supplied reduced dimensions and clusters. | [R5] |
| PAGA | heuristic | Cluster graph whose edges carry the v1.2 connectivity (E4); a topology skeleton rather than an ordering. | [R4] |
| scFates | hybrid | Principal tree (ppt) or elastic principal graph (epg) fitted to an embedding, then tree-based pseudotime and bifurcation analysis. | [R6] |

Defaults taken from source code, with file and line in the repository at the stated commit:

| Method | Parameter | Value | Source |
|---|---|---|---|
| Monocle 2 | reduceDimension max_components | 2 | R/clustering.R:126 (monocle-release @ 7df1050) |
| Monocle 2 | DDRTree param.gamma, clustering path | 100 | R/clustering.R:130 @ 7df1050 |
| Monocle 2 | ncenter when unset and N ≥ 100: round(2·100·log N / (log N + log 100)) | formula | R/order_cells.R:1522-1529 and 1828-1830 @ 7df1050 |
| Slingshot | getLineages dist.method; use.median | "slingshot"; FALSE | R/getLineages.R:97 @ 3fa552f |
| Slingshot | getLineages omega; omega_scale | FALSE; 1.5 | R/getLineages.R:98 @ 3fa552f (see section 10) |
| Slingshot | getCurves shrink; extend | TRUE; 'y' | R/getCurves.R:145-146 @ 3fa552f |
| Slingshot | getCurves thresh; maxit; stretch | 0.001; 15; 2 | R/getCurves.R:149 @ 3fa552f |
| PAGA | model | 'v1.2' | src/scanpy/tools/_paga.py:27 @ 8ed52d9 |
| PAGA | use_rna_velocity | False | src/scanpy/tools/_paga.py:26 @ 8ed52d9 |
| PAGA | v1.2 connectivity | E4 | src/scanpy/tools/_paga.py:178-203 @ 8ed52d9 |
| scFates | tree method | 'ppt' | scFates/tools/graph_fitting.py:149 @ 8d8c0e6 |
| scFates | Nodes | None (automatic) | scFates/tools/graph_fitting.py:145 @ 8d8c0e6 |
| scFates | ppt_sigma; ppt_lambda | 0.1; 1 | scFates/tools/graph_fitting.py:151-152 @ 8d8c0e6 |
| scFates | ppt_metric; ppt_nsteps; ppt_err_cut | 'euclidean'; 50; 5e-3 | scFates/tools/graph_fitting.py:153-155 @ 8d8c0e6 |
| scFates | epg_lambda; epg_mu; epg_initnodes | 0.01; 0.1; 2 | scFates/tools/graph_fitting.py:157-160 @ 8d8c0e6 |
| dyneval (HIM) | netdist ga | 0.1 | R/metric_him.R:45 @ daeb26a |
| dyneval (edge flip) | limit_flips; limit_combinations | 5; choose(25, 4) | R/metric_flip.R:30-31 @ daeb26a |

## 5. Proposed singlet approach

Routes (section 12). PAGA and scFates are **ported**. Monocle 2 DDRTree, Slingshot and TSCAN are **reimplemented**; no code is copied. The dyneval metrics are **reimplemented** from the definitions in section 8.

**singlet_pgraph (proposed default)** is singlet's model-based principal graph. It maximises the E1 objective with E2 responsibilities and the stretching penalty of E3, by EM. The E-step is a distance matrix from one GEMM followed by a row-wise softmax; the M-step is the E3 solve. The node count and edge set are selected by BIC or ICL over candidates, and the fit reports $\lambda$ and $\sigma$. The bandwidth is expressed in units of the embedding's overall standard deviation; its default of 0.1 is a proposal aligned with the scFates ppt_sigma value, not a calibrated setting. Edge-level responsibilities are reported as soft assignments, and calibration is not claimed until B3 meets its acceptance criterion.

Falsification. The model-based selection is rejected if, on B2, its per-class exact-match rate falls below the best comparator minus the margin in section 8, or if its BIC-selected node count lies further from the planted count than the scFates default. Failing B3 rejects the stability claim on its own.

ML stack. No deep network is proposed for this task. The EM core is small, hot and fixed-shape, so it is hard-coded in CUDA: cuBLAS GEMM for the $N\times K$ distances, a fused softmax for responsibilities, reductions for $\nu_k$ and $R^\top X$, and a host $K\times K$ solve; CPU BLAS is the reference path. cuSPARSE CSR kernels compute the PAGA-style edge counts used by the PAGA port. PyTorch is reserved for a learned topology classifier, which belongs to trajectory.trajectory_presence_test rather than this task.

Devices and streaming. CPU and CUDA compute the same objective, and their graphs must agree within floating-point tolerance. Responsibilities are $N\times K$, so the v1 fit is not streaming; minibatch EM is a later option.

Defaults an agent should use without asking: method singlet_pgraph; embedding X_pca with 50 dimensions (a singlet choice); node_selection bic; penalty 1; sigma 0.1; seed 0; cluster_key cluster for cluster-based methods; root only for slingshot. Principal-graph outputs are undirected; slingshot orients its lineages only when a root is given.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/X_pca | float32, N × d | Default embedding; any obsm key can be named |
| read | obs/cluster | categorical, N | Cluster labels for slingshot, tscan and paga |
| write | uns/trajectory_graph | dict | Milestone nodes, edges and edge lengths in embedding units |
| write | obsm/milestone_percentages | float32, N × K | Per-cell milestone percentages; each row sums to 1 |
| write | obs/milestone | categorical, N | Milestone with the largest percentage for each cell |
| write | models/principal_graph | dict | Node positions, sigma, penalty, K and selection criterion; principal-graph methods only |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "singlet_pgraph" | `singlet_pgraph`, `monocle2_ddrtree`, `slingshot`, `paga`, `tscan`, `scfates` | Topology method. singlet_pgraph is the proposed default; slingshot, tscan and paga need cluster_key. |
| `embedding` | object | — | — | Embedding the graph is fitted on. |
| `embedding.key` | string | "X_pca" | — | obsm key of the embedding, for example X_pca or X_diffmap. |
| `embedding.n_dims` | integer | 50 | min 2 | Leading embedding dimensions used for fitting; the default is a singlet choice. |
| `cluster_key` | string | "cluster" | — | obs column of cluster labels used by slingshot, tscan and paga. |
| `root` | string | — | — | Start cell id or cluster label. slingshot uses it as the start cluster; other methods ignore it. |
| `n_nodes` | integer/null | null | min 2 | Node or cluster count. Null lets the method's selection criterion choose it. |
| `stability` | object | — | — | Subsampling stability report. |
| `stability.n_bootstrap` | integer | 0 | min 0 | Number of subsampled refits. Zero disables the stability report. |
| `stability.bootstrap_frac` | number | 0.95 | max 1; > 0 | Fraction of cells and features kept in each subsample. |
| `options` | object | — | — | Method-specific options, nested by method name. Each applies only to its own method. |
| `options.singlet_pgraph` | object | — | — | Options for singlet_pgraph, the proposed principal-graph default. |
| `options.singlet_pgraph.sigma` | number | 0.1 | > 0 | Responsibility bandwidth in units of the embedding's overall standard deviation (proposed). |
| `options.singlet_pgraph.penalty` | number | 1 | min 0 | Graph penalty weight; larger values give fewer nodes and edges. |
| `options.singlet_pgraph.node_selection` | string | "bic" | `bic`, `icl`, `fixed` | Criterion for the node count; fixed uses n_nodes. |
| `options.singlet_pgraph.max_iter` | integer | 100 | min 1 | Maximum number of EM iterations. |
| `options.scfates` | object | — | — | Options for scfates principal tree or elastic graph fitting. |
| `options.scfates.tree_method` | string | "ppt" | `ppt`, `epg` | ppt fits a principal tree; epg fits an elastic principal graph. |
| `options.scfates.ppt_lambda` | number | 1 | min 0 | Tree penalty weight for the ppt fit. |
| `options.scfates.ppt_sigma` | number | 0.1 | > 0 | Responsibility smoothing scale for the ppt fit. |
| `options.scfates.epg_lambda` | number | 0.01 | min 0 | Stretching penalty for the epg fit. |
| `options.scfates.epg_mu` | number | 0.1 | min 0 | Bending penalty for the epg fit. |
| `options.slingshot` | object | — | — | Options for slingshot lineage and curve fitting. |
| `options.slingshot.omega` | boolean | false | — | Cap MST edge lengths at omega_scale times the median unsupervised MST edge length. |
| `options.slingshot.omega_scale` | number | 1.5 | > 0 | Scaling factor for the omega cap; used only when omega is true. |
| `options.slingshot.stretch` | number | 2 | min 0 | Factor by which lineage curves are extended beyond their ends. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for the stochastic initialisation of principal-graph fits. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Parameters apply by method: options.singlet_pgraph to singlet_pgraph, options.scfates to scfates and options.slingshot to slingshot. An option for a method that is not selected is rejected rather than ignored. n_nodes sets the node count for monocle2_ddrtree, scfates and singlet_pgraph, and the cluster count where a cluster method accepts one. cluster_key is required by slingshot, tscan and paga; the call fails if the column is absent rather than clustering internally. root is used only by slingshot. node_selection fixed requires n_nodes. Each stability refit repeats the whole fit, so cost grows with n_bootstrap.

## 7. MCP tool

Tool name `singlet_trajectory_topology_inference` (definition in `tasks/mcp/singlet_trajectory_topology_inference.json`). One example call and one compact result:

```json
{"dataset": "/data/example.singlet", "method": "singlet_pgraph", "embedding": {"key": "X_pca", "n_dims": 30}, "options": {"singlet_pgraph": {"node_selection": "bic"}}, "seed": 0}
```

```json
{"dataset": "/data/example.singlet", "status": "completed", "wrote": ["uns/trajectory_graph", "obsm/milestone_percentages", "obs/milestone", "models/principal_graph"], "summary": {"method": "singlet_pgraph", "n_nodes": "<int>", "n_edges": "<int>", "n_branch_points": "<int>", "selected_by": "bic"}, "provenance_id": "<id>"}
```

Long-running: large inputs can return status queued with a job_id; poll that job rather than resubmitting. Stochastic: seed fixes the initialisation of principal-graph fits, while cluster-based fits given fixed labels are deterministic. Dry run: dry_run returns estimated seconds, peak memory and device, and writes nothing.

## 8. Benchmarks

Shared protocol. Each method is fitted with default parameters unless a benchmark says otherwise, on the same leading 50 embedding dimensions (section 5). Priors (start cell, end-state count, cluster count, branch count) are supplied only where a method requires them and are recorded per method. Every output is wrapped into a milestone network with per-cell milestone percentages before scoring. Scores are computed per dataset and aggregated per topology class, with 95% percentile bootstrap intervals over datasets. Seeds are fixed, and varied where a benchmark says so.

### B1. dynbenchmark trajectory topology benchmark (published)

- **Goal**: Score a predicted milestone network and cell positions against a reference network on synthetic and real datasets [R1, R9].
- **Ground truth**: Synthetic datasets are planted simulations, with the generator's network and each cell's true percentages. Real datasets carry a gold standard (cell sorting, cell mixing or time sampling independent of expression) or a silver standard (study groups with a validated milestone network). Networks are normalised by total edge length, and percentages sum to 1 per cell.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| dynbenchmark trajectory collection | doi:10.5281/zenodo.1443566 [R9, R16] | 110 real and 229 synthetic datasets [R9]; per-dataset modality and species not stated here | — | Real and synthetic subsets |
| dyngen simulations | github.com/dynverse/dyngen [R14] | Simulated single-cell data from a multi-modal simulator; size set per simulation | see §12 | Synthetic datasets in the benchmark [R9] |
| Tian et al. mixology mixtures | doi:10.1101/433102 [R15] | — | — | Gold-standard candidates (cell sorting or mixing) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| HIM score | $s=1-\max(0,d)$, where $d$ is the HIM distance between adjacency matrices divided by their total edge lengths (netdist with $\gamma$ as in section 4); $s=0$ if either network has zero total length | maximise, [0,1] | primary | [R10, R11, R12] |
| F1 branches | Harmonic mean of recovery and relevance on cell sets grouped by nearest trajectory edge. Recovery is the mean over reference groups of the best Jaccard overlap, relevance the mean over predicted groups; a group with no overlap scores 0 | maximise, [0,1] | primary | [R10] |
| F1 milestones | As F1 branches, with cells grouped by nearest milestone | maximise, [0,1] | guardrail | [R10] |
| Isomorphic | 1 if the predicted and reference networks are graph-isomorphic (igraph), ignoring edge lengths; otherwise 0 | maximise, {0,1} | guardrail | [R10] |
| Edge flip | $s=1-n_\mathrm{flips}/U$, where $n_\mathrm{flips}$ is the fewest edge flips found within the limits in section 4 and $U$ is the sum of the lower-triangle adjacency entries of both networks minus 2 (or 1 if that is at most 0); $s=0$ when a limit is exceeded | maximise, [0,1] | guardrail | [R10] |

- **Comparators**: Slingshot, TSCAN, PAGA, PAGA Tree, Monocle 2 DDRTree, SLICER, and the MST and first-principal-component baselines, all with default parameters [R1, R9]; singlet_pgraph is added.
- **Protocol**: Default parameters only, with the benchmark's wrapping rules [R9].
- **Acceptance criterion** (PROPOSED, not from the literature): on the synthetic and gold-standard subsets, singlet_pgraph's mean HIM is at least the best comparator's mean minus 0.02, and its mean F1 branches is at least the best comparator's mean minus 0.05; both differences are judged with 95% bootstrap intervals over datasets. Margins are calibrated after the first full fit.
- **Known pitfalls**: Silver standards are built from clusters of the same expression the methods see, which favours cluster-based methods. Priors given to some methods and not others change the ranking, so every prior is recorded per method.

### B2. Planted-topology stress test (proposed)

- **Goal**: Test whether a method recovers the planted topology class across controlled topology families, cell counts, feature counts and noise levels.
- **Ground truth**: Planted simulation. The planted milestone network and each cell's true percentages are known, and networks are normalised as in B1.
- **Generator recipe (proposed)**:
  1. Draw a backbone from the linear, cycle, bifurcation, converging, binary-tree and tree-with-3-to-6-branch-points families (the linear, bifurcating, multifurcating, cyclic and tree classes follow [R9]), then add a random divergence, loop, convergence or divergence-convergence modification.
  2. Draw each edge length from U(0.5, 1).
  3. Place N cells along the edges with probability proportional to edge length; the true percentages are the barycentric positions.
  4. In half of the divergent backbones, insert a delayed-commitment region before the divergence [R9].
  5. Draw G features from a log-linear program in the true percentages, with a coefficient vector per edge, and negative-binomial counts whose dispersion sets the noise level.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted replicates | Recipe above | Simulated scRNA-seq; N ∈ {10^3, 10^4} cells; G ∈ {10^3, 10^4} features (proposed sweep) | n/a | Replicates per class and setting; cells per branch reported |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Exact class match | 1 if the predicted network is isomorphic to the planted network; averaged over replicates | maximise, per class | primary | [R10] |
| HIM score | As in B1, against the planted network | maximise, [0,1] | primary | [R10, R11] |
| Edge flip | As in B1 | maximise, [0,1] | guardrail | [R10] |
| F1 branches | As in B1, with cells grouped by planted edges | maximise, [0,1] | guardrail | [R10] |

- **Comparators**: Slingshot, TSCAN, PAGA, Monocle 2 DDRTree, scFates ppt, and singlet_pgraph.
- **Protocol**: Matched N and G; sweep N, G and dispersion. Each method uses defaults and, where it accepts one, a node or cluster count equal to the planted count. Report the per-class exact-match rate and median HIM with bootstrap intervals over replicates.
- **Acceptance criterion** (PROPOSED): on each topology class, singlet_pgraph's exact-match rate is not below the best comparator's rate minus 0.10, and its median HIM is at least 0.8 for the linear and bifurcating classes.
- **Known pitfalls**: The generator's assumptions (smooth progression, negative-binomial noise) favour methods that share them, so B1 is the real-data check. Sampling density per branch is a hidden variable and must be reported.

### B3. Topology stability under subsampling (consistency)

- **Goal**: Measure how stable the fitted network is when cells and features are resampled, separating topology instability from method randomness.
- **Ground truth**: Consistency only. Each comparison is between two fits of the same dataset, with no external truth.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B2 replicates | Recipe in B2 | As in B2 | n/a | Every topology class at one N and one G (proposed) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| HIM between consecutive fits | $s_\mathrm{HIM}$ between the networks of consecutive subsampled fits, each on a 95% subsample of cells and features with its own seed; median over pairs | maximise, [0,1] | primary | [R10, R11] |

- **Comparators**: Slingshot, PAGA, Monocle 2 DDRTree, singlet_pgraph.
- **Protocol**: Ten subsamples of 95% of cells and 95% of features, with a new seed for each; compare consecutive fits and report the median and interquartile range of the pairwise scores.
- **Acceptance criterion** (PROPOSED): median consecutive-fit HIM of at least 0.9 for singlet_pgraph on the B2 replicates.
- **Known pitfalls**: A fixed seed makes a fragile method look stable, so the seed must change per subsample. Subsampling changes the cell set, so the shared-cell count for each pair is reported.

### P1. Performance and scaling

Cell counts 10^3, 10^4, 10^5 and 10^6 and feature counts 10^3 and 10^4 (proposed; the feature sweep uses the B2 recipe). Measure wall time, peak memory and throughput on CPU and on CUDA, and fit a log–log time model with a 95% band, classed as sublinear, linear or quadratic. Comparators: Slingshot, TSCAN, PAGA, Monocle 2 DDRTree and scFates ppt. Held fixed: 50 embedding dimensions, thread count, seed and default parameters. The one-hour timeout is taken from the benchmark manuscript [R9]. Acceptance criterion (PROPOSED): singlet_pgraph on CUDA completes 10^5 cells within the timeout, with peak memory no more than twice the best CPU comparator at the same size.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Feeds**:
  - `trajectory.branch_point_assignment`: Branch point localisation and cell-to-branch assignment
  - `trajectory.pseudotime_ordering`: Pseudotime ordering along a lineage
  - `trajectory.terminal_state_identification`: Initial and terminal state (macrostate) identification
- **Reads**: `obsm/X_pca`, `obs/cluster`
- **Writes**: `uns/trajectory_graph`, `obsm/milestone_percentages`, `obs/milestone`, `models/principal_graph`
<!-- CHAINING:AUTO:END -->

Follows embedding and clustering. Its topology is the graph that branch assignment, pseudotime and terminal-state tasks read.

## 10. Risks, pitfalls and open questions

- **Unverified figures.** Per-topology rankings were not checked against the published text [R1]. The scaling statement (only a handful of graph and tree methods complete within a day on a million cells) and the one-hour timeout come from the benchmark manuscript source [R9], not from the published paper.
- **Methods not carried forward.** Monocle 3 learn_graph, URD, SLICER, STREAM, Wishbone and ElPiGraph are absent from the tables and the enum. Their algorithm code was not reviewed. The ElPiGraph algorithm that scFates uses (its repository is named in the scFates README) is not in the local records and was not reviewed. The DDRTree internals (maxIter, sigma, lambda), which a reimplementation needs, and the TSCAN defaults are not stated here. The Slingshot roxygen text gives omega_scale as 3 while the code default is 1.5; the code value is used.
- **Metric internals.** The F1 harmonic mean is taken from the dynutils dependency (dyneval metric_mapping.R:96 calls calculate_harmonic_mean and does not define it), which was not reviewed. The cell-position and feature-importance metrics have code in dyneval (metric_position_predict.R, metric_featureimp.R) that was not reviewed, so they are not used in any acceptance criterion.
- **Lineage-tree benchmark.** The transcriptome-only lineage-tree question has no benchmark here. The LARRY dataset [R8] has no accession or cell counts stated, and a barcode-supported fate split has no operational definition for a tree with branch points. The data licence of the Zenodo collection is not stated [R16]; check it before redistribution.
- **Interface and first experiment.** trajectory.branch_point_assignment reads uns/trajectory_graph, the member written here; both documents must agree on it and on the percentage layout (rows are cells, columns are nodes). The first experiment is B2 at the smallest sweep point against the six methods of section 8, to calibrate penalty, sigma and the acceptance margins before the full fit.

## 11. References

R1. Saelens W, Cannoodt R, Todorov H, Saeys Y. A comparison of single-cell trajectory inference methods. *Nature Biotechnology* 2019;37:547–554. doi:10.1038/s41587-019-0071-9 — verified (corpus)
R2. Qiu X, Mao Q, Tang Y, et al. Reversed graph embedding resolves complex single-cell trajectories. *Nature Methods* 2017. doi:10.1038/nmeth.4402 — verified (corpus)
R3. Street K, Risso D, Fletcher RB, et al. Slingshot: cell lineage and pseudotime inference for single-cell transcriptomics. *BMC Genomics* 2018. doi:10.1186/s12864-018-4772-0 — verified (corpus)
R4. Wolf FA, Hamey FK, Plass M, et al. PAGA: graph abstraction reconciles clustering with trajectory inference through a topology preserving map of single cells. *Genome Biology* 2019. doi:10.1186/s13059-019-1663-x — verified (corpus)
R5. Ji Z, Ji H. TSCAN: pseudo-time reconstruction and evaluation in single-cell RNA-seq analysis. *Nucleic Acids Research* 2016. doi:10.1093/nar/gkw430 — verified (corpus)
R6. scFates: a scalable python package for advanced pseudotime and bifurcation analysis from single-cell data. *Bioinformatics* 2022. doi:10.1093/bioinformatics/btac746 — verified (corpus)
R7. Weinreb C, Wolock S, Tusi BK, Socolovsky M, Klein AM. Fundamental limits on dynamic inference from single-cell snapshots. *Proceedings of the National Academy of Sciences* 2018. doi:10.1073/pnas.1714723115 — verified (corpus)
R8. Weinreb C, Rodriguez-Fraticelli A, Camargo FD, Klein AM. Lineage tracing on transcriptional landscapes links state to fate during differentiation. *Science* 2020. doi:10.1126/science.aaw3381 — verified (corpus)
R9. Cannoodt R, Saelens W. dynbenchmark: benchmarking trajectory inference methods. GitHub repository dynverse/dynbenchmark, commit 3d8bd6c (manuscript and protocol). — verified (repo)
R10. Cannoodt R, Saelens W, Todorov H. dyneval: evaluating trajectory inference methods. GitHub repository dynverse/dyneval, commit daeb26a (metric code). — verified (repo)
R11. Jurman G, Visintainer R, Filosi M, Riccadonna S, Furlanello C. The HIM glocal metric and kernel for network comparison and classification. *IEEE DSAA* 2015. doi:10.1109/dsaa.2015.7344816 — verified (corpus)
R12. Ipsen M, Mikhailov AS. Evolutionary reconstruction of networks. *Physical Review E* 2002. doi:10.1103/physreve.66.046109 — verified (corpus)
R13. Campbell KR, Yau C. Probabilistic modeling of bifurcations in single-cell gene expression data using a Bayesian mixture of factor analyzers. *Wellcome Open Research* 2017. doi:10.12688/wellcomeopenres.11087.1 — verified (corpus)
R14. Cannoodt R, Saelens W, Deconinck L, Saeys Y. Spearheading future omics analyses using dyngen, a multi-modal simulator of single cells. *Nature Communications* 2021. doi:10.1038/s41467-021-24152-2 — verified (repo)
R15. Tian L, Dong X, Freytag S, et al. scRNA-Seq Mixology: Towards Better Benchmarking of Single Cell RNA-Seq Protocols and Analysis Methods. *bioRxiv* 2018. doi:10.1101/433102 — verified (corpus)
R16. Cannoodt R, Saelens W, Todorov H, Saeys Y. Single-Cell -Omics Datasets for Containing a Trajectory (title as recorded in the dynbenchmark bibliography). Zenodo, doi:10.5281/zenodo.1443566 (year not in the record) — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/cole-trapnell-lab/monocle-release | Cole Trapnell (author and maintainer, DESCRIPTION) | Artistic-2.0 (DESCRIPTION) | Monocle 2 DDRTree defaults and method | reimplement |
| https://github.com/kstreet13/slingshot | Kelly Street (maintainer); Davide Risso, Diya Das, Sandrine Dudoit, Koen Van den Berge, Robrecht Cannoodt (Authors@R) | Artistic-2.0 (DESCRIPTION) | Slingshot defaults and method | reimplement |
| https://github.com/scverse/scanpy | scverse; LICENSE copyright F. Alexander Wolf, P. Angerer, Theis Lab | BSD-3-Clause (LICENSE) | PAGA v1.2 connectivity | port |
| https://github.com/LouisFaure/scFates | LouisFaure (LICENSE copyright) | BSD-3-Clause (LICENSE) | Principal tree and graph fitting, defaults | port |
| https://github.com/zji90/TSCAN | Zhicheng Ji, Hongkai Ji (DESCRIPTION) | GPL (>= 2) (DESCRIPTION) | Cluster-based MST method; README at ca9d201 | reimplement |
| https://github.com/dynverse/dyneval | Robrecht Cannoodt, Wouter Saelens, Helena Todorov (Authors@R) | GPL-3 (DESCRIPTION) | Metric definitions for B1 to B3 | reimplement |
| https://github.com/dynverse/dynbenchmark | Robrecht Cannoodt, Wouter Saelens (LICENSE copyright) | MIT (LICENSE.md) | Benchmark protocol, manuscript and collection | callout |
| https://github.com/dynverse/dyngen | Robrecht Cannoodt (LICENSE copyright) | MIT + file LICENSE (DESCRIPTION) | One simulator behind the B1 synthetic datasets [R9] | callout |
