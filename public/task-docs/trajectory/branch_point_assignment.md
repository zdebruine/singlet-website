---
id: trajectory.branch_point_assignment
title: Branch point localisation and cell-to-branch assignment
area: trajectory
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [trajectory.topology_inference, trajectory.pseudotime_ordering, trajectory.root_identification]
feeds: [trajectory.pseudotime_de, trajectory.differential_progression, trajectory.pseudotime_uncertainty]
reads: [layers/counts, obsm/X_pca, obsp/connectivities, uns/trajectory_graph, obs/root_flag, obs/cluster, uns/terminal_states]
writes: [obs/branch_label, obsm/branch_weights, obsm/fate_probabilities, obs/pseudotime_<lineage>, uns/branch_points, uns/fork_test_<pair>, models/principal_tree_<name>]
devices: [cpu, cuda]
mcp_tool: singlet_trajectory_branch_point_assignment
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Branch point localisation and cell-to-branch assignment

> Estimates where lineages split along a trajectory and assigns each cell to a branch, as hard labels, soft weights or fate probabilities, scored by split position and by branch agreement.

## 1. Question

Where along a trajectory do lineages split, and which branch does each cell belong to? Inputs are a trajectory graph or per-lineage pseudotime, the expression embedding, a required root cell and optional terminal states. Outputs are branch points (pseudotime and graph node), a hard label or soft weights per cell, and branch-specific pseudotime. A correct answer places each split at the true fork time and assigns each cell to the branch its true fate follows.

## 2. Why this task matters and where the field stands

Branching decides which genes change on which route, what fraction of cells take each fate, and where commitment happens, so most trajectory analyses depend on it. Branch-aware pseudotime was developed in diffusion-based [R5] and pseudotemporal-ordering [R1] methods. Principal curves [R9], principal graphs [R7] and absorbing Markov chains [R4, R10] followed. The families disagree on the same data. In the dynbenchmark study, performance depended strongly on trajectory type, a single method gave a top model, scoring at least 95% of the best, in about 27% of datasets, rising to 74% with six more methods (paper.Rmd:141–145) [R2]. The status is **contested**.

Open problems: split-location truth exists for real data mainly through lineage recording, which labels clones and fates in a few systems [R11, R12]; hard branch F1 and soft fate probabilities have no shared calibration metric; cluster-level methods cannot place a split finer than a cluster; and joint estimation of topology and branch assignment with uncertainty is unsolved (see trajectory.pseudotime_uncertainty).

## 3. Theory and insight

Cells $i=1,\dots,n$ have pseudotime $t_i$, embedding $x_i$, hard label $b_i\in\{1,\dots,L\}$ and soft weights $w_{i\ell}$. A split is a pseudotime $\tau$ at which two branches separate, and $\tau^{*}$ is its planted value. $P_{\text{cell}}\in[0,1]^{n\times T}$ holds terminal-state probabilities.

Estimands, one sentence each:

- **Split position**: $\hat\tau$ is the method's split pseudotime, min–max scaled over all cells of a trajectory, so $|\hat\tau-\tau^{*}|$ is a fraction of the span in $[0,1]$.
- **Branch agreement**: F1 compares hard partitions of cells into edges of the reference and predicted milestone networks; it is unitless in $[0,1]$ and does not use pseudotime.
- **Fate probability**: each row of $P_{\text{cell}}$ is a distribution over terminal states whose entries are absorption probabilities, not densities.

Palantir treats differentiation as an absorbing chain over waypoints [R4], and CellRank uses the same construction [R10]:
$$B=(I-Q)^{-1}R,\qquad P_{\text{cell}}=W^{\top}B,$$
where $Q$ and $R$ are the transient-to-transient and transient-to-terminal blocks, $B_{wt}$ is the probability that waypoint $w$ is absorbed into terminal state $t$, and $W$ maps cells to waypoints. The inverse exists when every transient waypoint reaches a terminal state, and terminal states must be absorbing and correctly identified. Branch points are implicit, located where rows of $P_{\text{cell}}$ begin to split. Pseudotime is refined with Gaussian weights $\exp(-D_{wc}^{2}/2\sigma^{2})$ and $\sigma=1.06\,\widehat{\mathrm{sd}}(D)\,M^{-1/5}$ where $M$ is the number of entries of $D$ (core.py:371); this is a rule-of-thumb constant, not a fitted parameter.

Slingshot fits a principal curve per lineage, $f(\lambda)=\mathbb{E}[X\mid\lambda_f(X)=\lambda]$ [R9, R6]. Its sample version is a smoothing spline with 5 degrees of freedom (getCurves.R:199). The identity holds in the population limit, so accuracy depends on cell density along each lineage. Shrinkage at forks and reweighting of shared cells are heuristics on top of the fit. Hard labels follow from soft weights by the rule $b_i=\{\ell: w_{i\ell}\ge 1/L\}$ (branchID.R:28), so cells can carry several labels and the threshold is not tuned against truth.

Principal trees (scFates) fit a tree with a preset node count, by PPT or ElPiGraph, and define pseudotime as distance from the root on the projected tree [R8]. The node count changes both the number of branches and the split positions.

The scFates fork test fits, per gene, $\text{exp}\sim s(t)+s(t,\,\text{by}=\text{as.factor}(i))+\text{as.factor}(i)$ with cell weights as an mgcv GAM (bifurcation_tools.py:330–334). Per-leaf p-values are Bonferroni-adjusted and combined by median across leaves (bifurcation_tools.py:224–227, 266–267). Per-leaf Bonferroni-adjusted values are thresholded at 0.05 (bifurcation_tools.py:243), and the per-leaf indicators are averaged across leaves (bifurcation_tools.py:269). The regime is a shared trunk followed by two branches, with pseudotime treated as known; error in $t$ then enters as covariate noise.

The benchmark F1 [R3, R2], as implemented in dyneval, is
$$J(A,B)=\frac{|A\cap B|}{|A|+|B|-|A\cap B|},\quad \mathrm{Rec}=\frac{1}{|\mathcal R|}\sum_{A\in\mathcal R}\max_{B\in\mathcal P}J(A,B),\quad \mathrm{Rel}=\frac{1}{|\mathcal P|}\sum_{B\in\mathcal P}\max_{A\in\mathcal R}J(A,B),$$
with $F_1$ the harmonic mean of Rec and Rel. Here $\mathcal R$ and $\mathcal P$ are groups of cells on reference and predicted edges of the simplified milestone network, and each cell belongs to one edge. The intersection counts only cells present in both trajectories, while set sizes count every cell of a group in its own trajectory, so a cell missing from one side lowers the score (metric_mapping.R:11–96).

Insight:

- Split localisation is a sparse-region problem. Its error is governed mainly by the spacing of cells around the fork in the embedding, and for cluster-based methods by the cluster width. Cells near the fork are ambiguous by construction.
- Hard labels hide the uncertainty that soft weights and fate probabilities carry. F1 scores cell groups, not split positions, so two methods with identical groups but different split pseudotimes score the same.
- Heuristic and model-based methods share a weakness. Constants set the answer (the $1/L$ threshold, the Palantir neighbour count, the scFates node count), and neither family reports a calibrated interval for the split position.
- Method rankings change with trajectory type, so F1 must be reported per type.

Assumptions: the embedding preserves branching geometry at cell resolution; branches share a trunk; the root is correct, since a wrong root reverses branch-specific pseudotime; cell density near the fork is adequate; expression varies smoothly along each branch.

Failure modes: splits limited to cluster boundaries; spurious forks in over-resolved graphs; multifurcations forced into binary splits; shared-trunk cells assigned by threshold; fork tests flagging density or batch genes when pseudotime is poor.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Palantir | model-based | Absorbing Markov chain over waypoints on a kNN graph; fate probabilities by absorption; branch points where they split | [R4] |
| scFates | model-based | Principal tree (PPT default, ElPiGraph optional) fitted to cells; pseudotime from root; GAM fork test per gene | [R8] |
| Slingshot | heuristic | Cluster MST gives lineages; principal curves per lineage with shrinkage and reweighting; soft weights, then hard labels by threshold | [R6] |

Slingshot is the heuristic reference and Palantir and scFates are the model-based references. These three are the methods with source-level defaults below and the only ones in the tool enum. Other catalogue methods are listed in section 10.

Commits: Palantir f819d51, scFates 8d8c0e6, Slingshot 3fa552f.

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| Palantir | knn | 30 | core.py:67 |
| Palantir | num_waypoints | 1200, raised to a minimum when too small for the components | core.py:68, 281–287 |
| Palantir | max_iterations | 25 | core.py:72 |
| Palantir | scale_components | True (min–max scaling) | core.py:70 |
| Palantir | use_early_cell_as_start | False | core.py:71 |
| Palantir | n_jobs | −1 | core.py:69 |
| Palantir | pseudotime bandwidth | $1.06\,\widehat{\mathrm{sd}}\,M^{-1/5}$ | core.py:371 |
| scFates | method | ppt (alternative epg) | graph_fitting.py:149 @ 8d8c0e6 |
| scFates | Nodes | None in code (no default); singlet requires it | graph_fitting.py:145 |
| scFates | ppt_sigma, ppt_lambda, ppt_nsteps, ppt_err_cut | 0.1, 1, 50, 5e-3 | graph_fitting.py:151, 152, 154, 155 |
| scFates | epg_lambda, epg_mu | 0.01, 0.1 | graph_fitting.py:157, 158 |
| scFates | epg_trimmingradius, epg_initnodes | inf, 2 | graph_fitting.py:159, 160 |
| scFates | fork-test significance | per-leaf Bonferroni fdr < 0.05, indicators averaged across leaves | bifurcation_tools.py:224–227, 243, 269 |
| scFates | pseudotime | distance from root on the projected tree; n_map (default 1; 1 uses likelihood mapping) | pseudotime.py:21, 36–37, 85 |
| Slingshot | shrink, reweight, extend | TRUE, TRUE, 'y' | getCurves.R:145–147 |
| Slingshot | shrink.method | cosine | getCurves.R:152 |
| Slingshot | thresh, maxit, stretch | 0.001, 15, 2 | getCurves.R:149 |
| Slingshot | approx_points | NULL, resolved to 150 when n > 150 | getCurves.R:187–191 |
| Slingshot | curve smoother | smooth.spline with df 5 | getCurves.R:151, 199 |
| Slingshot | getLineages omega, omega_scale | FALSE, 1.5 in code (roxygen states 3) | getLineages.R:98, 42 |
| Slingshot | hard-label threshold | 1/L | branchID.R:28 |

## 5. Proposed singlet approach

Routes: Palantir and scFates are ported; Slingshot and the F1 implementation are reimplemented (section 12). The scFates fork test is re-expressed on a fixed spline basis so it can be batched.

The default method is palantir. It is model-based, has an explicit absorbing-chain objective, returns soft outputs, and is the most direct port. Agents should use `embedding` X_pca, knn 30, num_waypoints 1200, max_iterations 25 and scale_components true, and must supply the root. The effective num_waypoints is returned when it is raised.

The proposed singlet model is a sparse absorbing-chain estimator on a learned cell graph, with fate probabilities calibrated against lineage-barcode and simulated truth (B3, B4). It is cheap and GPU-friendly. It is falsified if its planted split error exceeds the best comparator's by more than 0.02 (B4), or if its fate probabilities are less calibrated than Palantir's on clonal data (B3). A variational latent-path model with a change-point prior on fork location would give a posterior over the split position, but it needs PyTorch training and is not in the enum.

The ML stack uses PyTorch for embedding training and any variational model. Small hot kernels are hard-coded in CUDA or cuSPARSE: kNN construction through existing kernels; sparse solves of $(I-Q)X=R$ by triangular or conjugate-gradient iterations, replacing a dense $O(W^3)$ inverse; batched shortest paths from the start cell to waypoints; and batched per-gene spline fits for the fork test.

Devices: CPU first, with CUDA for the solve and the batched tests. Streaming is not claimed, because graph and tree fits need all cells at once.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | counts for fork tests and marker checks |
| read | obsm/X_pca | float32 | embedding for graph and geometry (name set by `embedding`) |
| read | obsp/connectivities | sparse float | kNN graph used by Palantir |
| read | uns/trajectory_graph | graph | topology from trajectory inference, when supplied |
| read | obs/root_flag | bool | single TRUE start cell (column set by `root`) |
| read | obs/cluster | categorical | cluster labels for Slingshot (column set by `slingshot.cluster_key`) |
| read | uns/terminal_states | table | optional terminal states (key set by `terminal_key`) |
| write | obs/branch_label | categorical | hard label; Slingshot uses its threshold, Palantir the largest branch weight |
| write | obsm/branch_weights | float32, n × L | soft weights in [0, 1]; Palantir sums fate probability over the terminal states of each branch |
| write | obsm/fate_probabilities | float32, n × T | Palantir only; rows sum to 1 over terminal states |
| write | obs/pseudotime_<lineage> | float32 | branch-specific pseudotime, NaN outside the lineage |
| write | uns/branch_points | table | node, split pseudotime $\hat\tau$, position, n_cells, support |
| write | uns/fork_test_<pair> | table | scFates only: gene, p, fdr, effect size |
| write | models/principal_tree_<name> | graph | scFates only: fitted node and edge graph |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "palantir" | `palantir`, `scfates`, `slingshot` | palantir: soft fate probabilities; scfates: principal tree with fork tests; slingshot: lineage curves and weights. |
| `embedding` | string | "X_pca" | — | obsm key of the embedding used for the graph and branch geometry. |
| `root` | string | required | — | obs column with one TRUE start cell, or a cell identifier. Required; the tool never infers a root. |
| `terminal_key` | string/null | null | — | uns key listing terminal states; null uses the method's own terminal-state step. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for Palantir waypoint sampling and other stochastic steps. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `palantir` | object | — | — | Options used when method is palantir. |
| `palantir.knn` | integer | 30 | min 1 | Neighbours in the kNN graph and the Markov chain. |
| `palantir.num_waypoints` | integer | 1200 | min 1 | Waypoints for the absorbing chain; raised if too small for the components. |
| `palantir.max_iterations` | integer | 25 | min 1 | Iterations for pseudotime refinement. |
| `palantir.scale_components` | boolean | true | — | Min-max scale diffusion components before pseudotime. |
| `scfates` | object | — | — | Options used when method is scfates. |
| `scfates.nodes` | integer | — | min 1 | Principal-tree node count; required when method is scfates. |
| `scfates.tree_method` | string | "ppt" | `ppt`, `epg` | ppt: principal tree fit; epg: ElPiGraph elastic graph. |
| `scfates.epg_lambda` | number | 0.01 | min 0 | ElPiGraph stretching penalty; used when tree_method is epg. |
| `scfates.epg_mu` | number | 0.1 | min 0 | ElPiGraph bending penalty; used when tree_method is epg. |
| `scfates.fork_fdr` | number | 0.05 | min 0; max 1 | FDR cutoff for genes that differ between branches in fork tests. |
| `slingshot` | object | — | — | Options used when method is slingshot. |
| `slingshot.cluster_key` | string | "cluster" | — | obs column with cluster labels for the cluster-level minimum spanning tree. |
| `slingshot.shrink` | boolean | true | — | Shrink branching lineages toward their average before the split. |
| `slingshot.reweight` | boolean | true | — | Reweight cells shared between lineages during curve fitting. |
| `slingshot.approx_points` | integer/null | null | — | Points used to approximate each curve; null uses 150 when cells exceed 150. |
| `slingshot.branch_threshold` | number/null | null | min 0; max 1 | Minimum soft weight for a hard label; null uses 1/L. |
| `slingshot.omega` | boolean | false | — | Cap MST edge length using an artificial outgroup cluster. |
| `slingshot.omega_scale` | number | 1.5 | min 0 | Scale factor for omega when omega is true. |
<!-- PARAMS:AUTO:END -->

Each method reads only its own block: `palantir.*` for palantir, `scfates.*` for scfates and `slingshot.*` for slingshot. The tool rejects a call without `root`, refuses scfates without `scfates.nodes`, and refuses Slingshot when `slingshot.cluster_key` is absent from obs. A null `branch_threshold` means $1/L$. Defaults are those in section 4; changing them is a benchmark decision, not a tuning step.

## 7. MCP tool

Tool `singlet_trajectory_branch_point_assignment` (definition in `tasks/mcp/singlet_trajectory_branch_point_assignment.json`). Example call and result; values in angle brackets are placeholders.

```json
{"dataset": "data/lineage.singlet", "root": "root_flag", "method": "palantir", "palantir": {"knn": 30}}
```

```json
{"dataset": "data/lineage.singlet", "status": "completed",
 "wrote": ["obs/branch_label", "obsm/branch_weights", "obsm/fate_probabilities", "uns/branch_points"],
 "summary": {"method": "palantir", "n_branches": "<int>", "n_branch_points": "<int>", "effective_num_waypoints": "<int>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: palantir and scfates can take long on large inputs; `queued` returns a `job_id`. Stochastic: `seed` controls Palantir waypoint sampling. Dry run: returns `seconds`, `peak_memory_gb` and `device` and writes nothing.

## 8. Benchmarks

All methods receive the same embedding, graph and root, chosen by the benchmark's start-cell rule. Each method uses its section 4 defaults unless a benchmark says otherwise. Hard labels come from each method's own rule (section 3) and are converted to the milestone model before scoring. A failed fit, a fit over one hour or over the memory limit, or an error scores zero (paper.Rmd:681). The memory limit is stated per benchmark. One CPU core is used per fit, and results are reported per trajectory type.

### B1. dynbenchmark branch-assignment accuracy (published)

- **Goal**: score a predicted hard branch partition against a reference partition on real and synthetic trajectories.
- **Ground truth**: expert grouping. Real datasets use gold grouping when built independently of expression and silver grouping otherwise (paper.Rmd:436) [R2]. Synthetic datasets use the simulator's branch of origin, with positions rebuilt by dynamic time warping (paper.Rmd:577) [R2]. Estimand: the reference edge of each cell. Normalisation: within each dataset, scores are standardised across methods and mapped through the standard normal density to $[0,1]$ (paper.Rmd:671–672).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Real trajectories from GEO, gold or silver grouping | [R2] (paper.Rmd:432–436) | scRNA-seq; more than 200 datasets in the accuracy analysis (paper.Rmd:248) | — | — |
| dyngen module networks and dyntoy topology generators | [R2], [R13] | simulated scRNA-seq; cell numbers matched to real datasets (paper.Rmd:568) | — | Module networks set topology (paper.Rmd:476) |
| PROSSTT and Splatter simulations | [R14], [R15] | simulated scRNA-seq | — | Path simulators (paper.Rmd:454–455) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| F1_branches | Harmonic mean of recovery and relevance over edge groups, as in section 3 | maximise | primary | [R2], [R3] |
| correlation | Spearman rank correlation between geodesic distances from 100 stratified waypoint cells to all cells, prediction against reference (paper.Rmd:662–664) | maximise | guardrail | [R2] |

- **Comparators**: Slingshot, Palantir and scFates at section 4 defaults; the MST baseline (PCA, mclust clustering, minimum spanning tree, orthogonal projection; paper.Rmd:422) [R2].
- **Protocol**: the start cell for each milestone is the cell nearest in geodesic distance among milestones with only outgoing edges. Aggregation: arithmetic means within source and trajectory type, source means weighted by how far synthetic and silver scores correlate with gold, arithmetic means over trajectory types, and a geometric mean across metrics (paper.Rmd:671–678). F1_branches is reported separately for bifurcating and tree types.
- **Acceptance criterion**: proposed, not from the literature. On bifurcating and tree types, the candidate's median F1_branches is at least the best comparator's median minus 0.02 and at least the MST baseline median.
- **Known pitfalls**:
  - Silver groupings built by clustering the same expression give circular, optimistic scores.
  - A failed fit scores zero, so runtime and memory failures lower accuracy.

### B2. Branch stability under subsampling (published protocol)

- **Goal**: test whether the branch partition changes little when cells and features are subsampled.
- **Ground truth**: consistency only, with no external truth. Each dataset gives 10 subsample fits, each on 95% of cells and 95% of features. The manuscript averages pairwise similarity across the models using the accuracy metrics (paper.Rmd:211–214) [R2]; the F1_branches component is reported here. Normalisation: F1 is already on $[0,1]$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 25% of the B1 datasets, accounting for 15% of total runtime | [R2] (paper.Rmd:710) | scRNA-seq; sizes as in B1 | — | Chosen so the overall score correlates above 0.99 with the full set |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Mean pairwise F1_branches | Average of F1_branches over the 45 pairs of the 10 subsample outputs, on cells present in both outputs of each pair | maximise | primary | [R2] |

- **Comparators**: as in B1.
- **Protocol**: subsamples are drawn once per dataset. Each fit uses the method's default seed.
- **Acceptance criterion**: proposed, not from the literature. The candidate's median mean pairwise F1_branches is at least 0.9, reported next to B1.
- **Known pitfalls**:
  - Fixed-topology methods are stable by construction (paper.Rmd:214), so stability is read only together with B1.
  - Repeated fits on identical input with one seed measure little, because many tools reset their random generator internally (paper.Rmd:710).

### B3. Lineage-barcode clonal branch purity (proposed)

- **Goal**: check that cells of one barcoded clone fall on one predicted branch, using lineage recording as an orthogonal fate measurement.
- **Ground truth**: orthogonal measurement. Clone identity comes from heritable barcodes, and a clone's terminal fates come from its lineage tree rather than from clustering. Estimand: for a clone $c$ with $n_c\ge 5$ cells spanning at least two reference terminal fates, $\mathrm{purity}_c=\max_\ell|\{i\in c: b_i=\ell\}|/n_c\in(0,1]$, averaged without weighting over qualifying clones. Ties in the maximum go to the lower branch index (proposal).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Zebrafish embryo single-cell atlas with lineage barcodes | [R12] | scRNA-seq with barcodes; zebrafish; size — | — | Clone identity from barcodes |
| LARRY lineage tracing of differentiation | [R11] | scRNA-seq with barcodes; size — | — | Clone fates from the lineage tree |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Clonal branch purity | Mean of $\mathrm{purity}_c$ over qualifying clones; equals 1 when every clone sits on one branch | maximise | primary | [R11], [R12] |
| Branch count ratio | Predicted branches divided by reference terminal fates; reported, not scored | report | guardrail | — |

- **Comparators**: Slingshot, Palantir and scFates at section 4 defaults.
- **Protocol**: all methods receive the same embedding, graph and root. Purity is reported for clone-size strata of 5–9 cells and 10 or more cells.
- **Acceptance criterion**: proposed, not from the literature. Purity is at least 0.8 for clones with at least 10 cells, where the branch count ratio is at least 1.
- **Known pitfalls**:
  - A single-branch prediction maximises purity, which is why the branch count ratio guardrail applies.
  - Barcode dropout and clone bias add noise to the truth, and the lineage-recording data come from a separate experiment from the scRNA-seq used to infer the trajectory.

### B4. Planted bifurcation: split position and labels (proposed)

- **Goal**: check that a known fork is placed at its planted time, with correct labels on each side.
- **Ground truth**: planted simulation. $\tau^{*}$ is the simulator time of the fork, and each cell has a simulator branch. Estimand: $\hat\tau$ is the branch-node pseudotime for scFates, or otherwise the first pseudotime where the two branch weights cross $1/2$ after smoothing (Palantir, Slingshot); both $\hat\tau$ and $\tau^{*}$ are min–max scaled over all cells, so the error is a fraction of the span.
- **Generator recipe**:
  1. Simulate a bifurcating module network with one shared trunk and one fork, as in the dynbenchmark bifurcation design (paper.Rmd:476) [R2], using dyngen [R13]; keep each cell's simulator time and branch.
  2. Vary cell count and technical noise over a grid fixed in the configuration, and report every grid point.
  3. Build one shared input (library-normalised log expression, PCA with fixed components, one kNN graph) and give the earliest-time cell as root.
  4. Fit each method at section 4 defaults and extract $\hat\tau$ and labels.
  5. Exclude cells whose simulator time lies in the window around $\tau^{*}$ where the two branches are indistinguishable; the window is fixed before fitting.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated bifurcation from the recipe | [R13] | simulated scRNA-seq; grid as recipe step 2 | — | Simulator time is the planted truth |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Normalised split-location error | Median over fits of $\lvert\hat\tau-\tau^{*}\rvert$ on the scaled span, per grid point | minimise | primary | [R13] |
| F1_branches | As in B1, on non-excluded cells with the two simulator branches as reference groups | maximise | guardrail | [R2] |

- **Comparators**: Slingshot, Palantir, scFates and the MST baseline.
- **Protocol**: all methods get the true root and the recipe grid.
- **Acceptance criterion**: proposed, not from the literature. The candidate's median normalised split error is at most 0.05 and no worse than the best comparator plus 0.02.
- **Known pitfalls**:
  - The dynbenchmark rebuilds synthetic positions by dynamic time warping (paper.Rmd:577); reconstructed time biases this error.
  - Simulated noise can be cleaner than real data and inflate scores.

### P1. Performance and scaling

The design follows the dynbenchmark scalability study: five real datasets chosen by k-medoids, scaled between 10 and 100,000 cells and features with at most 1,000,000 values, where new cells or features are linear combinations of one to three existing ones along a 10-nearest-neighbour graph (paper.Rmd:685) [R2].

Hold fixed: one CPU core per fit; the timer starts at data load and stops at output, including method-specific preprocessing (paper.Rmd:688); a one-hour limit; and the memory limit stated per benchmark (16 GB in the method-execution section, paper.Rmd:681; 10 GB in the scalability section, paper.Rmd:688). Peak memory from the scheduler's maximum virtual memory is described by its authors as noisy.

Measure: wall time, peak memory and throughput at 10k, 100k and 1M cells on CPU and CUDA, against Slingshot, Palantir, scFates and the MST baseline, with the fitted complexity class from the dynbenchmark classifier. Reference point: most graph and tree methods did not finish within an hour at 10,000 cells by 10,000 features, and more than half of all methods were quadratic or superquadratic in cells (paper.Rmd:176–179) [R2]. Proposed acceptance: the CUDA fit is linear or sublinear in cells, and 1M cells complete within the one-hour limit at the fixed feature count.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `trajectory.topology_inference`: Trajectory topology inference
  - `trajectory.pseudotime_ordering`: Pseudotime ordering along a lineage
  - `trajectory.root_identification`: Root or start-state identification
- **Feeds**:
  - `trajectory.pseudotime_de`: Pseudotime-associated and lineage-specific differential expression
  - `trajectory.differential_progression`: Differential progression, topology and fate selection between conditions
  - `trajectory.pseudotime_uncertainty`: Pseudotime and trajectory uncertainty quantification
- **Reads**: `layers/counts`, `obsm/X_pca`, `obsp/connectivities`, `uns/trajectory_graph`, `obs/root_flag`, `obs/cluster`, `uns/terminal_states`
- **Writes**: `obs/branch_label`, `obsm/branch_weights`, `obsm/fate_probabilities`, `obs/pseudotime_<lineage>`, `uns/branch_points`, `uns/fork_test_<pair>`, `models/principal_tree_<name>`
<!-- CHAINING:AUTO:END -->

This task sits in the trajectory workflow after topology and pseudotime inference, and before fate, differential progression and uncertainty analyses.

## 10. Risks, pitfalls and open questions

- **Source coverage.** Monocle 2, URD, STREAM and Wishbone are excluded from the tables and the tool enum because their algorithms and defaults are not reviewed for this task. The ElPiGraph and DDRTree primary papers are not in the local index. Palantir's automatic terminal-state step and the cell-to-edge rule of dynwrap (`group_onto_trajectory_edges`) are outside the sources used here.
- **Protocol gaps.** The manuscript gives 16 GB as the memory limit in one section and 10 GB in another (paper.Rmd:681, 688), so each benchmark states its own limit. It does not say how cells absent from one subsample are handled in pairwise stability (B2), and it does not state a random seed for the 100 waypoint cells sampled for the correlation metric (paper.Rmd:662).
- **Ground truth and citations.** Split-location truth in real data exists only for lineage-recording systems, so B3 is limited to them and B4 is simulated. The principal-curve reference [R9] is absent from the local index and was confirmed by one web search, not from the full text. The clone-level divergence-time metric has no defined truth and is not benchmarked.
- **Implementation risks.** A fixed-basis fork test replaces mgcv's smoothing, which changes the test statistic and needs its own null calibration (see statistics.pvalue_null_calibration). The GPU sparse solves and batched spline fits are new code, without a reference implementation in the sources used here.
- **First experiment.** Simulate one bifurcation with the B4 recipe at the smallest grid point, fit Palantir and scFates at defaults, and measure split error with simulator time before any GPU work.

## 11. References

R1. Trapnell C, Cacchiarelli D, Grimsby J, et al. The dynamics and regulators of cell fate decisions are revealed by pseudotemporal ordering of single cells. *Nature Biotechnology* 2014. doi:10.1038/nbt.2859 — verified (corpus)
R2. Saelens W, Cannoodt R, Todorov H, Saeys Y. A comparison of single-cell trajectory inference methods. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0071-9 — verified (corpus)
R3. Saelens W, Cannoodt R, Saeys Y. A comprehensive evaluation of module detection methods for gene expression data. *Nature Communications* 2018. doi:10.1038/s41467-018-03424-4 — verified (corpus)
R4. Setty M, Kiseliovas V, Levine J, et al. Characterization of cell fate probabilities in single-cell data with Palantir. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0068-4 — verified (corpus)
R5. Haghverdi L, Büttner M, Wolf FA, Buettner F, Theis FJ. Diffusion pseudotime robustly reconstructs lineage branching. *Nature Methods* 2016. doi:10.1038/nmeth.3971 — verified (corpus)
R6. Street K, Risso D, Fletcher RB, et al. Slingshot: cell lineage and pseudotime inference for single-cell transcriptomics. *BMC Genomics* 2018. doi:10.1186/s12864-018-4772-0 — verified (corpus)
R7. Qiu X, Mao Q, Tang Y, et al. Reversed graph embedding resolves complex single-cell trajectories. *Nature Methods* 2017. doi:10.1038/nmeth.4402 — verified (corpus)
R8. Faure L, Soldatov R, Kharchenko PV, Adameyko I. scFates: a scalable python package for advanced pseudotime and bifurcation analysis from single-cell data. *Bioinformatics* 2022. doi:10.1093/bioinformatics/btac746 — verified (repo)
R9. Hastie T, Stuetzle W. Principal curves. *Journal of the American Statistical Association* 1989;84(406):502–516. doi:10.2307/2289936 — verified (search)
R10. Lange M, Bergen V, Klein M, et al. CellRank for directed single-cell fate mapping. *Nature Methods* 2022. doi:10.1038/s41592-021-01346-6 — verified (corpus)
R11. Weinreb C, Rodriguez-Fraticelli A, Camargo FD, Klein AM. Lineage tracing on transcriptional landscapes links state to fate during differentiation. *Science* 2020. doi:10.1126/science.aaw3381 — verified (corpus)
R12. Wagner DE, Weinreb C, Collins ZM, et al. Single-cell mapping of gene expression landscapes and lineage in the zebrafish embryo. *Science* 2018. doi:10.1126/science.aar4362 — verified (corpus)
R13. Cannoodt R, et al. Spearheading future omics analyses using dyngen, a multi-modal simulator of single cells. *Nature Communications* 2021. doi:10.1038/s41467-021-24152-2 — partial (corpus)
R14. Papadopoulos N, Parra RG, Soeding J. PROSSTT: probabilistic simulation of single-cell RNA-seq data for complex differentiation processes. *Bioinformatics* 2019. doi:10.1093/bioinformatics/btz078 — verified (corpus)
R15. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/dpeerlab/Palantir | Palantir development team (pyproject.toml); copyright Dana Pe'er Lab (LICENSE) | MIT | Fate probabilities, waypoint chain, pseudotime | port |
| https://github.com/LouisFaure/scFates | Louis Faure (pyproject.toml) | BSD-3-Clause | Principal tree fit and fork test | port (fork test on a fixed spline basis) |
| https://github.com/kstreet13/slingshot | Kelly Street (aut, cre, cph); Davide Risso, Diya Das (aut); Sandrine Dudoit (ths); Koen Van den Berge, Robrecht Cannoodt (ctb) | Artistic-2.0 (DESCRIPTION; no LICENSE file) | Lineage curves, soft weights, hard threshold | reimplement |
| https://github.com/dynverse/dyneval | Robrecht Cannoodt (aut, cre); Wouter Saelens (aut); Helena Todorov (aut) (DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file) | F1_branches and correlation metric | reimplement |
| https://github.com/dynverse/dynbenchmark | Robrecht Cannoodt, Wouter Saelens (LICENSE.md) | MIT | Accuracy, stability and scalability protocols | reimplement (protocol only) |
