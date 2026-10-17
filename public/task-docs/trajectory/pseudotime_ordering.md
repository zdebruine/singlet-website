---
id: trajectory.pseudotime_ordering
title: Pseudotime ordering along a lineage
area: trajectory
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [trajectory.root_identification, dim-reduction.normalized_cell_embedding, neighbors.neighbor_count_selection, clustering.cell_partitioning]
feeds: [trajectory.pseudotime_de, trajectory.branch_point_assignment, trajectory.pseudotime_uncertainty, trajectory.gene_switch_timing]
reads: [obsm/X_pca, obsp/connectivities, obs/root_flag, obs/cluster]
writes: [obs/pseudotime_<method>, obs/pseudotime_<method>_lineage_<k>, obsm/<method>_curve_coords, uns/pseudotime_<method>_params, uns/pseudotime_<method>_orientation]
devices: [cpu, cuda]
mcp_tool: singlet_trajectory_pseudotime_ordering
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Pseudotime ordering along a lineage

> Assigns each cell a scalar progress value along one lineage, oriented by a required root cell, using diffusion, geodesic or curve-projection distances.

## 1. Question

Does a per-cell pseudotime rank cells in their true order of developmental or response progress along one lineage, with the root at the start? Inputs are an embedding (PCA by default), a kNN graph, a root cell and optional cluster labels. Output is one real value per cell per lineage. A correct answer is a monotone ranking of cells by true progress, with the root at the start.

## 2. Why this task matters and where the field stands

Pseudotime is the coordinate on which gene trends, branch points and differential progression are computed, so an ordering error propagates into every downstream trajectory result. Diffusion pseudotime [R1, R2] and Slingshot [R5] are the reference single-lineage and multi-lineage methods in this family. Palantir [R4] adds iterative refinement and fate probabilities, and TSCAN [R6] orders cells along a cluster tree. Model-based precedents exist, including a Gaussian-process latent variable model [R9] and a deconfounded time-series model [R10].

The status is **contested**. In the dynbenchmark study, performance varied strongly across datasets, and no single method worked well on every dataset [R7] (manuscript/paper.Rmd:137). Four open problems remain:

- The dynbenchmark correlation is reflection-invariant (B1), so it does not score orientation, although a wrong root reverses the ordering.
- The methods in section 4 return point estimates per cell, with no calibrated uncertainty.
- Cells shared by branches receive one value per lineage, or one arbitrary value.
- Results depend on the embedding and on the root.

## 3. Theory and insight

Let $x_c\in\mathbb{R}^d$ be the embedding of cell $c$ and $r$ the root. Each method builds pseudotime from one of three distance objects: a diffusion distance on a kNN Markov chain, a geodesic distance on a graph fitted to the cells, or the arc-length projection onto a fitted curve.

**Diffusion distance.** With a row-normalised Gaussian kNN kernel $K$, degree matrix $\mathbf{D}$, $P=\mathbf{D}^{-1}K$ and eigenpairs $P\psi_j=\lambda_j\psi_j$, the distance after $t$ random-walk steps is
$$d_t^2(i,k)=\sum_{j\ge1}\lambda_j^{2t}\bigl(\psi_j(i)-\psi_j(k)\bigr)^2 .$$
This is the Coifman and Lafon object [R3] used by Haghverdi et al. [R2]. Regime: connected graph, eigenpairs sorted by eigenvalue.

**Diffusion pseudotime as implemented.** scanpy weights the components differently (the cut-off and its source are in section 4):
$$d_{\mathrm{DPT}}^2(i,k)=\sum_{\lambda_j<0.9994}\Bigl(\tfrac{\lambda_j}{1-\lambda_j}\Bigr)^{2}\bigl(\psi_j(i)-\psi_j(k)\bigr)^2+\sum_{\lambda_j\ge0.9994}\bigl(\psi_j(i)-\psi_j(k)\bigr)^2 ,$$
and $\hat t_c=d_{\mathrm{DPT}}(r,c)$. Components with eigenvalue at or above 0.9994 enter unweighted. The factor $\lambda/(1-\lambda)=\sum_{s\ge1}\lambda^s$ is a geometric sum over walk lengths, so slowly decaying components carry most of the weight. The expression is the code's form and is not equal to $d_t$. Regime: a root is set and the graph is connected.

**Palantir.** Waypoints $w$ are chosen by max–min sampling, $D_{wc}$ is the kNN geodesic distance from waypoint $w$ to cell $c$, and the bandwidth is $\sigma=1.06\,\mathrm{sd}(D)\,M^{-1/5}$ with $M=|W|\,n$ the number of entries of $D$. The fixed point is
$$W_{wc}=\frac{\exp\!\bigl(-\tfrac12(D_{wc}/\sigma)^2\bigr)}{\sum_{w'}\exp\!\bigl(-\tfrac12(D_{w'c}/\sigma)^2\bigr)},\qquad t_c\leftarrow\sum_w W_{wc}\bigl(t_w+s_{wc}D_{wc}\bigr),$$
with $s_{wc}=-1$ if $t_c<t_w$ and $+1$ otherwise (source lines in section 4). The start waypoint is fixed at $t=0$. Iteration stops when the Pearson correlation of successive iterates exceeds 0.9999, or when the loop counter reaches 25 (core.py:381), which allows 24 updates; the output is min–max scaled to $[0,1]$. Regime: geodesic distance tracks progress; the stopping rule is empirical.

**Slingshot.** For lineage $\ell$ with fitted curve $f_\ell$, pseudotime is the arc length $\hat t_c=\lambda_\ell(x_c)$ from the curve start to the projection of $x_c$. The curve step rests on the principal-curve self-consistency condition of Hastie and Stuetzle [R8],
$$f(\lambda)=\mathbb{E}\bigl[X\mid \lambda_f(X)=\lambda\bigr],$$
which Slingshot approximates with a smoothing spline, reassignment and reweighting of shared cells (defaults in section 4). Regime: a smooth curve in the population limit. In practice the curve sits on a cluster MST scaffold, so the cluster structure sets the scaffold.

**Estimands and normalisation.**

- Pseudotime $\hat t$, per lineage: rank scores use only its order. DPT is an unscaled distance from the root, Palantir is min–max scaled to $[0,1]$, and Slingshot is arc length in embedding units.
- Simulated progress $\tau$, per lineage: the generator's progress scaled to $[0,1]$ (B2); rank scores are invariant to its scale.
- Orientation: the sign of the Spearman correlation between $\hat t$ and $\tau$ over the cells of one lineage.
- Dynbenchmark correlation: Spearman correlation of geodesic distances from waypoint cells, floored at 0 and so in $[0,1]$ (B1).

**Insight.** Where geometry is one-dimensional and well sampled, the three distances are close to monotone in progress, so the methods agree. Disagreement concentrates at forks, in dense or sparse regions and near the root. The root fixes orientation in all three methods, so a correct root gives a positive sign by construction. The informative quantity is therefore how the ordering responds to a wrong root (B3). Pseudotime is a rank, not a duration. Model-based alternatives add a likelihood over expression, which gives a posterior per cell, a reusable fitted model for new cells and room for covariates; the heuristic distances above provide none of these.

**Assumptions.** One lineage in the chosen representation, or the path from the root through a tree. Sampling is adequate along the curve. The root is correct. Progression is the main source of variation, with cell cycle, stress and batch small or regressed out. The kNN graph is connected and locally correct.

**Failure modes.**

- A single pseudotime forced through a bifurcation gives shared cells arbitrary values.
- A wrong root reverses or shifts the ordering.
- Orthogonal programmes such as the cell cycle dominate the geometry.
- Cluster-based scaffolds change branch number with cluster resolution.
- Disconnected kNN components give unreachable cells artefactual distances; Palantir adds connecting edges before its shortest paths (core.py:361).
- Density bias: dense regions compress distance, and plateaus create ties.
- Stochastic waypoints make Palantir depend on its seed.
- On bone marrow, DPT gave extremely high values in the CLP cluster and inflated values in HSC_1 and HSC_2, which contradict the prior knowledge stated in the chapter. The chapter continues with the Palantir pseudotime [R17].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Diffusion pseudotime (DPT) | hybrid | Diffusion distance from the root on a kNN graph, computed from stored diffusion components | [R1, R2] |
| Palantir | hybrid | Kernel-weighted signed geodesic offsets from waypoints, iterated to a fixed point | [R4] |
| Slingshot | hybrid | Cluster MST, then simultaneous principal curves per lineage; pseudotime is arc length | [R5] |
| TSCAN | heuristic | Cluster-level MST over mclust clusters; cells are ordered along MST paths and pseudotime is their rank | [R6] |
| scFates | hybrid | Principal tree fitted to the embedding (ElPiGraph or simplePPT-style); pseudotime is the geodesic distance from the root | [R15, R16] |

DPT is the reference diffusion method in scanpy, and Slingshot is the reference curve method. Palantir adds refinement and fate probabilities. TSCAN and scFates are comparators and are not in the tool enum. Other published methods are discussed in section 10.

Defaults for the methods singlet will implement, from the pinned source commits:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| DPT | n_dcs | 10 | scanpy src/scanpy/tools/_dpt.py:26 @8ed52d9 |
| DPT | n_neighbors (graph) | 15 | scanpy src/scanpy/neighbors/__init__.py:65 @8ed52d9 |
| DPT | stationary eigenvalue cut-off | 0.9994 | scanpy src/scanpy/neighbors/__init__.py:856–866 @8ed52d9 |
| Palantir | knn | 30 | src/palantir/core.py:67 @f819d51 |
| Palantir | num_waypoints | 1200; raised when below the minimum for the component count | core.py:68, 281–287 @f819d51 |
| Palantir | max_iterations | 25 (24 updates) | core.py:72, loop core.py:381 @f819d51 |
| Palantir | seed (waypoint sampling) | 20 upstream; singlet default 0 (section 5) | core.py:79, 121–122 @f819d51 |
| Palantir | convergence (Pearson r) | greater than 0.9999 | core.py:393 @f819d51 |
| Palantir | bandwidth | 1.06 sd(D) M^(−1/5) | core.py:371 @f819d51 |
| Slingshot | shrink | TRUE | R/getCurves.R:145 @3fa552f |
| Slingshot | extend | 'y' | R/getCurves.R:146 @3fa552f |
| Slingshot | reweight, reassign | TRUE, TRUE | R/getCurves.R:147–148 @3fa552f |
| Slingshot | thresh, maxit | 0.001, 15 | R/getCurves.R:149 @3fa552f |
| Slingshot | stretch | 2 | R/getCurves.R:149 @3fa552f |
| Slingshot | approx_points | NULL; 150 when n > 150, otherwise FALSE | R/getCurves.R:187–191 @3fa552f |
| Slingshot | smoother | 'smooth.spline' | R/getCurves.R:151 @3fa552f |
| Slingshot | dist.method | 'slingshot' | R/getLineages.R:97 @3fa552f |
| Slingshot | start.clus | NULL | R/getLineages.R:96 @3fa552f |

## 5. Proposed singlet approach

**Routes.** DPT and Palantir are ported from their reference code. Slingshot is reimplemented (section 12 gives its licence). TSCAN and scFates are callouts, used as comparators only.

**Default.** `method = dpt`, with `root` required, `representation = obsm/X_pca`, `dpt.n_dcs = 10`, `dpt.n_neighbors = 15` and `seed = 0`. The first experiment in section 10 settles it: if DPT fails the B2 acceptance criterion and Palantir meets it, the default becomes `palantir`. Every output records the root and the orientation check in `uns`.

**Model-based formulation proposed.** Each cell has a latent progress $t_c\in[0,1]$ with a uniform prior. Gene $g$ has counts $y_{gc}\sim\mathrm{NB}\bigl(s_c\exp f_g(t_c),\phi_g\bigr)$, where $f_g$ is a smooth B-spline function and $s_c$ a size factor. Inference is amortised: a PyTorch encoder maps each cell to a posterior over $t_c$, initialised from the DPT ordering, and returns a posterior mean and standard deviation. The formulation is falsified on the B2 linear arm if its median Spearman correlation is below DPT's, or if its nominal 90% intervals cover the true $\tau$ for fewer than 80% of cells (proposed threshold). It enters the tool enum only after it meets the B2 and B3 criteria.

**ML stack.** The encoder and decoder are PyTorch modules. The small, hot kernels are hard-coded: kNN graph construction, sparse matrix–vector products for the diffusion eigenproblem (cuSPARSE on CUDA), the waypoint shortest paths, and the Palantir fixed-point refinement, which is an iterated weighted average. Slingshot's spline fitting stays on the CPU.

**Backends and streaming.** CPU and CUDA share one algorithm. The graph and eigenproblem need the full dataset, so streaming is not claimed. Large inputs go to the long-job queue.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/X_pca | float32, n by d | embedding for distances and curves |
| read | obsp/connectivities | sparse float | kNN graph for DPT, built when absent |
| read | obs/root_flag | bool | start cells, when `root` names a flag column |
| read | obs/cluster | categorical | cluster labels for the Slingshot scaffold |
| write | obs/pseudotime_<method> | float32 | one value per cell |
| write | obs/pseudotime_<method>_lineage_<k> | float32 | one column per lineage (Slingshot) |
| write | obsm/<method>_curve_coords | float32 | projection coordinates on the fitted curve (Slingshot) |
| write | uns/pseudotime_<method>_params | dict | root, parameters, seed and library versions |
| write | uns/pseudotime_<method>_orientation | dict | Spearman correlation with `orientation_markers`, when given |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `root` | string | required | — | Root cell id, or the name of a boolean obs column marking start cells. Sets origin and sign; required. |
| `method` | string | "dpt" | `dpt`, `palantir`, `slingshot` | Ordering method. Use dpt unless lineage-specific values (slingshot) or refinement (palantir) are needed. |
| `representation` | string | "obsm/X_pca" | — | Embedding used for distances and curve fitting, with one row per cell. |
| `orientation_markers` | object | {} | — | Gene to expected sign with progression (+1 rising, -1 falling). Used only for the orientation record. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Waypoint sampling seed for palantir; dpt and slingshot are deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `dpt` | object | — | — | Options for method dpt. |
| `dpt.n_dcs` | integer | 10 | min 2 | Number of diffusion components used in the distance. |
| `dpt.n_neighbors` | integer | 15 | min 2 | kNN size for the graph when obsp/connectivities is absent. |
| `palantir` | object | — | — | Options for method palantir. |
| `palantir.knn` | integer | 30 | min 2 | kNN size for the geodesic graph. |
| `palantir.num_waypoints` | integer | 1200 | min 50 | Number of waypoints from max-min sampling. |
| `palantir.max_iterations` | integer | 25 | min 1 | Maximum fixed-point refinement iterations. |
| `slingshot` | object | — | — | Options for method slingshot. |
| `slingshot.cluster_key` | string | "cluster" | — | obs column of cluster labels that defines the lineage scaffold. |
| `slingshot.start_cluster` | string/null | null | — | Start cluster for orientation; null uses the cluster containing the root. |
| `slingshot.approx_points` | integer/null | null | — | Points approximating each curve; null gives 150 when n exceeds 150. |
| `slingshot.stretch` | number | 2 | min 0 | Factor by which curves may extend beyond endpoint clusters. |
| `slingshot.thresh` | number | 0.001 | min 0 | Convergence threshold on percent change in projection distance. |
| `slingshot.maxit` | integer | 15 | min 1 | Maximum curve-fitting iterations. |
<!-- PARAMS:AUTO:END -->

Each method reads only its own options: a `dpt`, `palantir` or `slingshot` object given for another method is rejected. `orientation_markers` changes only the orientation record, never the ordering. `root` must identify exactly one cell, and a flag column with several true values is an error. `representation` must have one row per cell.

## 7. MCP tool

Tool name `singlet_trajectory_pseudotime_ordering` (definition in `tasks/mcp/singlet_trajectory_pseudotime_ordering.json`). Example call and compact result, with angle-bracket placeholders for values that depend on the dataset:

```json
{"dataset": "data/example.singlet", "root": "<root_cell_id>", "method": "dpt", "dpt": {"n_dcs": 10, "n_neighbors": 15}}
```

```json
{"dataset": "data/example.singlet", "status": "completed",
 "wrote": ["obs/pseudotime_dpt", "uns/pseudotime_dpt_params", "uns/pseudotime_dpt_orientation"],
 "summary": {"method": "dpt", "root_cell": "<root_cell_id>", "n_cells": "<n>", "n_unreachable": "<k>", "n_lineages": 1, "orientation_rho": null},
 "provenance_id": "<provenance_id>", "job_id": null, "estimate": null}
```

Long-running: inputs above the backend's size threshold return `status: queued` with a `job_id`. Dry run: returns estimated seconds, peak memory and device without writing any member.

## 8. Benchmarks

**Shared protocol.** All methods take the same embedding and graph, the same root (the simulated or sorted start cell), and default settings unless a benchmark states otherwise. Palantir is repeated with seeds 0 to 9 (proposed). Scores are computed per lineage, reported per dataset, and summarised by median across datasets or replicates. Rank metrics use average ranks for ties. Hardware and library versions are recorded with each result. No threshold in this section is taken from the literature.

### B1. Dynbenchmark correlation metric (published)

- **Goal**: score how closely predicted geodesic distances reproduce those of the reference trajectory [R7].
- **Ground truth**: planted simulation, gold standard (reference grouping supplied by the original study's authors, manuscript/paper.Rmd:436) and silver standard (reference derived from expression). Per cell, the label is the position on the reference milestone network. The score is unitless and rank-based, with distances weighted by milestone-network edge length.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| dynbenchmark processed trajectory datasets | Zenodo doi:10.5281/zenodo.1443566, as cited in the dynbenchmark repository [R7] | scRNA-seq, real and synthetic; synthetic cases from dyntoy and dyngen [R12] | see section 12 | Gold: grouping from the original study; silver: expression-derived reference |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Dynbenchmark correlation | Spearman correlation between prediction and reference geodesic distances from 100 stratified waypoint cells to all other cells, floored at 0 | maximize | primary | [R7] |
| Reflection invariance | Score unchanged when a linear trajectory is reversed (derived from the definition) | n/a | guardrail | [R7] |

- **Comparators**: dpt, palantir, slingshot (start cluster from the root), and TSCAN and scFates with default settings (versions in section 12).
- **Protocol**: predicted pseudotime is converted to a milestone network by the manuscript rules, linear pseudotime to two milestones and end-state probabilities to a star network (manuscript/paper.Rmd:385–387). The same conversion is applied to every method. Scores are aggregated per trajectory type.
- **Acceptance criterion**: proposed. Median correlation of at least 0.90 over linear datasets, and no linear dataset below 0.60, for the default method.
- **Known pitfalls**: the correlation is blind to orientation, so B3 is required. The silver standard is derived from expression, so agreement with methods that use similar features is not independent evidence.

### B2. Known-progression rank agreement on simulated trajectories (proposed)

- **Goal**: test whether pseudotime ranks cells in their simulated order within each lineage.
- **Ground truth**: planted simulation. The per-cell label is the simulated progress $\tau\in[0,1]$ on each lineage, known by construction.
- **Generator recipe** (every input is produced here):
  1. Linear arm: one lineage, $\tau\sim\mathrm{Uniform}(0,1)$. Bifurcating arm: $\tau\sim\mathrm{Uniform}(0,1)$; cells with $\tau\le0.5$ are trunk cells belonging to both lineages; cells with $\tau>0.5$ are assigned to lineage A or B with probability 1/2 each.
  2. Gene programme: for gene $g$ and lineage $\ell$, $f_{g\ell}(\tau)=b_g+\sum_{k=1}^{6}w_{gk}B_k(\tau)$ with cubic B-spline basis functions $B_k$; $w_{gk}\sim N(0,\sigma_w^2)$ for a random 10% of genes, zero otherwise (proposed).
  3. Counts: size factors $s_c\sim\mathrm{LogNormal}(0,0.3)$; $y_{gc}\sim\mathrm{NB}(s_c e^{f_{g\ell_c}(\tau_c)},\phi_g)$, where $\ell_c$ is the lineage of cell $c$ and trunk cells use lineage A; gene dispersions $\phi_g$ follow the biological coefficient of variation model of Splatter [R13].
  4. Grid (proposed): $n\in\{2\,000,\,10\,000\}$ cells; $\sigma_w\in\{0.5,\,1,\,2\}$; 10 seeds per grid point.
  5. Embedding: log-normalised counts, PCA with 20 components, stored as `obsm/X_pca`.
  6. Root: the simulated start cell ($\tau=0$ on the trunk). Clusters for Slingshot: k-means with $k=10$ on the principal components (proposed).

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Linear arm (recipe steps 1–6) | Generated here; count model after Splatter [R13] | Synthetic scRNA-seq; n from the grid | — | Per-cell $\tau$ known |
| Bifurcating arm (recipe steps 1–6) | Generated here; count model after Splatter [R13] | Synthetic scRNA-seq; n from the grid | — | Trunk cells belong to both lineages |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Spearman $\rho$ | Signed Spearman correlation between $\hat t$ and $\tau$ over the cells of one lineage, ties averaged; unreachable cells excluded and counted | maximize | primary | — |
| Kendall $\tau_b$ | Tie-corrected Kendall rank correlation over the same cells | maximize | primary | [R14, R18] |

- **Comparators**: dpt, palantir, slingshot (start cluster from the root), and TSCAN and scFates with default settings (versions in section 12). Baselines (proposed): shortest-path distance from the root on the kNN graph, and PC1.
- **Protocol**: per grid point, 10 seeds; median $\rho$ and $\tau_b$ across seeds, reported per arm. The bifurcating arm is scored per lineage.
- **Acceptance criterion**: proposed. Median $\rho$ of at least 0.90 on the linear arm for the default method, and not below the shortest-path baseline on the same data.
- **Known pitfalls**: $\tau$ is a proxy for biological progress. Using the simulator's own embedding inflates scores, so recipe step 5 recomputes the PCA from counts.

### B3. Orientation and root sensitivity (proposed)

- **Goal**: check that a correct root gives the correct sign, and measure how a plausible wrong root changes the ordering.
- **Ground truth**: planted simulation. The true start cell and $\tau$ come from B2; a correct root must give $\rho(\hat t,\tau)>0$.
- **Datasets**: the B2 linear arm at both grid sizes, 10 seeds each. The wrong root is one cell drawn at random from the cells with $\tau\in[0.1,0.2)$, a stand-in for a root placed one cluster away from the start (proposed).

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B2 linear arm with true and wrong roots | Generated by the B2 recipe | Synthetic scRNA-seq; n from the B2 grid | — | Start cell and $\tau$ known |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Sign accuracy | Fraction of replicates with $\rho>0$ when the true root is given | maximize | primary | — |
| Wrong-root flip rate | Fraction of replicates with $\rho<0$ when the wrong root is given | minimize | guardrail | — |

- **Comparators**: dpt, palantir, slingshot; the root from root identification (trajectory.root_identification) applied to the same data, in place of the true root.
- **Protocol**: each method is given the true root and then the wrong root on each replicate. Sign accuracy and flip rate are reported per method.
- **Acceptance criterion**: proposed. Sign accuracy of 1.0 with the true root for every method on the linear arm; a flip rate reported for every method; a flip rate of 0.10 or less for the default.
- **Known pitfalls**: sign accuracy is near-trivial when the root is right, because distance and start-cluster orientation are fixed by construction, so the flip rate carries the information. Flip rates depend on where the wrong root falls.

### B4. Stability under subsampling (consistency)

- **Goal**: measure how much the ordering changes when the input changes slightly.
- **Ground truth**: consistency only; each replicate is compared with its neighbour.
- **Datasets**: the B2 linear and bifurcating arms at $n=10\,000$, each subsampled to 95% of cells and 95% of genes, ten times. The protocol follows the stability section of the manuscript (manuscript/paper.Rmd:710) [R7].

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B2 arms, subsampled | Generated by the B2 recipe | Synthetic scRNA-seq; n = 10 000 | — | Root kept in every subsample |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Consecutive-replicate $\rho$ | Spearman correlation between replicates $i$ and $i+1$ over shared cells; median over pairs | maximize | primary | [R7] |
| Seed spread | Range of $\rho$ against the seed-0 ordering across Palantir seeds 0 to 9 | minimize | guardrail | — |

- **Comparators**: dpt, palantir, slingshot.
- **Protocol**: PCA is recomputed on each subsample. The root cell is kept in every subsample.
- **Acceptance criterion**: proposed. Median consecutive $\rho$ of at least 0.90 for the default.
- **Known pitfalls**: a deterministic method can look stable without being robust, so seed spread is reported separately. Feature subsampling can drop signal genes; the 95% fraction follows the manuscript.

### P1. Performance and scaling

Wall time, peak memory and throughput at $10^4$, $10^5$ and $10^6$ cells (proposed grid), using the B2 bifurcating arm, for dpt, palantir, slingshot, TSCAN and scFates, on CPU and CUDA where implemented. Hold fixed: 20 principal components, the default kNN sizes, 1200 waypoints and the thread count. Report the B2 accuracy at the same sizes beside the timings. No streaming claim is made, so no larger grid point is proposed.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `trajectory.root_identification`: Root or start-state identification
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `neighbors.neighbor_count_selection`: Choice of neighbour count k and graph stability
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Feeds**:
  - `trajectory.pseudotime_de`: Pseudotime-associated and lineage-specific differential expression
  - `trajectory.branch_point_assignment`: Branch point localisation and cell-to-branch assignment
  - `trajectory.pseudotime_uncertainty`: Pseudotime and trajectory uncertainty quantification
  - `trajectory.gene_switch_timing`: Gene expression shape classes and switch timing along pseudotime
- **Reads**: `obsm/X_pca`, `obsp/connectivities`, `obs/root_flag`, `obs/cluster`
- **Writes**: `obs/pseudotime_<method>`, `obs/pseudotime_<method>_lineage_<k>`, `obsm/<method>_curve_coords`, `uns/pseudotime_<method>_params`, `uns/pseudotime_<method>_orientation`
<!-- CHAINING:AUTO:END -->

Part of the trajectory workflow. It follows embedding and root identification and precedes pseudotime differential expression and branch analysis.

## 10. Risks, pitfalls and open questions

- **Unexamined sources.** The Monocle 2 and Monocle 3 principal graphs, Wishbone, principal curves beyond their definition, the Bayesian GP-LVM and deconfounded models, and scVelo latent time [R11] were not examined at source. They appear here as precedents only, and are absent from the tables, the enum and the comparators.
- **Metric provenance.** The dynbenchmark correlation is defined in the manuscript (manuscript/paper.Rmd:660–662) and implemented in dynverse/dyneval (`R/calculate_metrics.R:84`, Spearman with a floor at 0). Its direction is inferred, and its reflection invariance is derived from the definition. No dynbenchmark result is used.
- **Open literature.** The four gaps in section 2 are not closed by the sources read: no benchmark there scores orientation, and none benchmarks per-cell uncertainty for DPT, Palantir or Slingshot. The best-practices chapter [R17] is a single worked example of the bone-marrow failure and reports no benchmark.
- **Dropped benchmark.** A sampling-time agreement benchmark is omitted, because no time-labelled trajectory dataset with per-cell sampling times was identified. Sampling time is also a partial proxy of developmental stage.
- **First experiment.** Apply dpt, palantir and slingshot to the B2 linear arm at 2 000 cells with the true root and 10 seeds, and report $\rho$, $\tau_b$ and the B3 flip rate. The outcome sets the default in section 5.

## 11. References

R1. Haghverdi L, Büttner M, Wolf FA, et al. Diffusion pseudotime robustly reconstructs lineage branching. *Nature Methods* 2016. doi:10.1038/nmeth.3971 — verified (corpus)
R2. Haghverdi L, Buettner F, Theis FJ. Diffusion maps for high-dimensional single-cell analysis of differentiation data. *Bioinformatics* 2015. doi:10.1093/bioinformatics/btv325 — verified (corpus)
R3. Coifman RR, Lafon S. Diffusion maps. *Applied and Computational Harmonic Analysis* 2006. doi:10.1016/j.acha.2006.04.006 — verified (corpus)
R4. Setty M, Kiseliovas V, Levine J, et al. Characterization of cell fate probabilities in single-cell data with Palantir. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0068-4 — verified (corpus)
R5. Street K, Risso D, Fletcher RB, et al. Slingshot: cell lineage and pseudotime inference for single-cell transcriptomics. *BMC Genomics* 2018. doi:10.1186/s12864-018-4772-0 — verified (corpus)
R6. Ji Z, Ji H. TSCAN: pseudo-time reconstruction and evaluation in single-cell RNA-seq analysis. *Nucleic Acids Research* 2016. doi:10.1093/nar/gkw430 — verified (corpus)
R7. Saelens W, Cannoodt R, Todorov H, Saeys Y. A comparison of single-cell trajectory inference methods. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0071-9 — verified (corpus)
R8. Hastie T, Stuetzle W. Principal curves. *Journal of the American Statistical Association* 1989;84(406):502–516. doi:10.2307/2289936 — verified (search)
R9. Campbell K, Yau C. Bayesian Gaussian process latent variable models for pseudotime inference in single-cell RNA-seq data. *bioRxiv* 2015 (preprint). doi:10.1101/026872 — verified (corpus)
R10. Reid JE, Wernisch L. Pseudotime estimation: deconfounding single cell time series. *Bioinformatics* 2016. doi:10.1093/bioinformatics/btw372 — verified (corpus)
R11. Bergen V, Lange M, Peidli S, Wolf FA, Theis FJ. Generalizing RNA velocity to transient cell states through dynamical modeling. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0591-3 — verified (corpus)
R12. Cannoodt R, et al. Spearheading future omics analyses using dyngen, a multi-modal simulator of single cells. *Nature Communications* 2021. doi:10.1038/s41467-021-24152-2 — partial (corpus)
R13. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R14. Kendall MG. A new measure of rank correlation. *Biometrika* 1938. doi:10.1093/biomet/30.1-2.81 — verified (corpus)
R15. Faure L, Soldatov R, Kharchenko PV, Adameyko I. scFates: a scalable python package for advanced pseudotime and bifurcation analysis from single-cell data. *Bioinformatics* 2022. doi:10.1093/bioinformatics/btac746 — partial (corpus)
R16. Albergante L, Mirkes EM, Chen H, et al. Robust and scalable learning of complex dataset topologies via ElPiGraph. *Entropy* 2020;22(3):296. — verified (repo)
R17. Weiler P, Kim SH, Heumos L. Pseudotemporal ordering. Single-cell best practices, trajectories chapter (online book). n.d. — verified (repo)
R18. Kendall MG. The treatment of ties in ranking problems. *Biometrika* 1945;33(3):239–251. doi:10.1093/biomet/33.3.239 — partial (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | scanpy authors (pyproject.toml) | BSD-3-Clause (LICENSE) | DPT reference implementation, commit 8ed52d9 | port |
| https://github.com/dpeerlab/Palantir | Palantir development team (pyproject.toml) | MIT (LICENSE) | Palantir reference implementation, v1.4.5, commit f819d51 | port |
| https://github.com/kstreet13/slingshot | Kelly Street and co-authors (DESCRIPTION) | Artistic-2.0 (DESCRIPTION) | Slingshot reference implementation, v2.7.0, commit 3fa552f | reimplement |
| https://github.com/zji90/TSCAN | Zhicheng Ji, Hongkai Ji (DESCRIPTION) | GPL (>= 2) (DESCRIPTION) | comparator, v2.0.0, commit ca9d201 | callout |
| https://github.com/LouisFaure/scFates | Louis Faure (pyproject.toml) | BSD-3-Clause (LICENSE) | comparator, commit 8d8c0e6 | callout |
| https://github.com/dynverse/dynbenchmark | Robrecht Cannoodt, Wouter Saelens (LICENSE) | MIT (LICENSE) | benchmark definitions and dataset DOI | callout |
| https://github.com/theislab/single-cell-best-practices | Philipp Weiler, Seo H. Kim, Lukas Heumos (chapter front matter) | Apache-2.0 (LICENSE) | evidence for the DPT failure on bone marrow | callout |

Dataset licence: the dynbenchmark Zenodo deposit (doi:10.5281/zenodo.1443566) has no licence stated in the repository files read; check it before redistributing derived data. The simulated arms in B2 to B4 are generated here and carry no third-party licence.
