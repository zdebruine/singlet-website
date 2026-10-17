---
id: trajectory.terminal_state_identification
title: Initial and terminal state (macrostate) identification
area: trajectory
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [neighbors.neighbor_count_selection, dim-reduction.normalized_cell_embedding, trajectory.pseudotime_ordering, trajectory.root_identification]
feeds: [trajectory.fate_probability, trajectory.branch_point_assignment, trajectory.differential_progression]
reads: [obsp/connectivities, obsm/X_pca, obs/pseudotime]
writes: [obs/terminal_state, obsm/terminal_state_memberships, obsm/macrostate_memberships, uns/terminal_states, uns/coarse_T, uns/coarse_stationary, uns/initial_states]
devices: [cpu, cuda]
mcp_tool: singlet_trajectory_terminal_state_identification
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Initial and terminal state (macrostate) identification

> Finds the endpoints of a cell-state process and the cells that belong to each, from a directed transition kernel, and scores the calls on annotated endpoints, lineage fates and planted simulations.

## 1. Question

Given a kNN graph on an embedding, an optional direction (pseudotime) and an optional root cell, which macrostates are the terminal and initial states of the process, and which cells belong to each? Outputs are hard terminal labels, soft memberships and initial-state weights. A correct answer recovers the endpoints the sampled process reaches and does not call sampling edges or arrested states terminal.

## 2. Why this task matters and where the field stands

Terminal states are the sinks that fate probabilities absorb into, they anchor branch-specific pseudotime, and they define the groups compared in differential progression, so an error here propagates downstream. The field is **contested**. Palantir [R3] and CellRank [R1, R2] define endpoints from a directed Markov chain. Graph methods call leaves of a principal graph [R12] or of a cluster abstraction [R11] and do not model fate. Directed analyses need an approximately known start. Velocity-based directions inherit the assumptions of the velocity model [R18]. In the dynbenchmark study, a top model (score at least 95% of the best) was obtained about 27% of the time with one method, rising to up to 74% with six more methods (paper.Rmd:145) [R7]. That study scores whole trajectories, not endpoints.

Open problems: (i) most datasets have no endpoint truth, and annotation-based truth is partly circular because the same labels often choose the root or the number of states; (ii) measured fates exist for few systems, for example hematopoiesis [R9]; (iii) the number of terminal states has no calibrated criterion; (iv) directed kernels create sinks wherever sampling stops, and these look like endpoints.

## 3. Theory and insight

**Set-up.** Cells $i=1,\dots,n$ have symmetric kNN weights $W$ and a row-stochastic kernel $P$. Its stationary distribution satisfies

$$\pi^{\top}P=\pi^{\top},\qquad \textstyle\sum_i\pi_i=1,$$

and for $P=D^{-1}W$ (the reversible case) $\pi_i\propto d_i$, a standard result. The regime is an irreducible, aperiodic chain sampled densely along the process, and the statement is first order in the kernel. On an undirected kernel the chain is reversible: a macrostate with high self-transition marks a dense cluster with no preferred exit, so high stability there does not mark an endpoint. Direction is what makes an endpoint. A pseudotime $t$ gives the hard filter

$$K_{ij}=W_{ij}\,\mathbf 1\big[t_j\ge t_i\ \text{or}\ j\in N^{f}_{i}\big],$$

where $N^{f}_i$ are the $\lfloor f\,k\rfloor$ nearest neighbours of $i$ (default $f=0.3$, count capped at 30; _pseudotime_scheme.py:158), and a soft filter that multiplies each past edge by $2/(1+e^{b\Delta t})^{1/\nu}$ with $\Delta t=t_i-t_j$ (b = 10, ν = 0.5) [R14]. The source docstring lists three differences from Palantir's scheme (_pseudotime_scheme.py:122–127).

**GPCCA.** Generalised Perron cluster analysis [R4, R5, R6] coarse-grains $P$ into $m$ fuzzy macrostates with memberships $\chi_{iI}\ge0$, $\sum_I\chi_{iI}=1$, and coarse probabilities

$$\hat P_{IJ}=\frac{\sum_{i,j}\chi_{iI}\,\pi_i\,P_{ij}\,\chi_{jJ}}{\sum_{i}\chi_{iI}\,\pi_i},$$

chosen to maximise metastability $\sum_I\hat P_{II}$. For crisp memberships this reduces to the PCCA+ form $(\chi^\top\Pi\chi)^{-1}\chi^\top\Pi P\chi$ of [R4–R6]. The regime is a spectral gap after the $m$-th eigenvalue and separated time scales. Without a gap, memberships inside a near-degenerate eigenspace are not identified. CellRank calls macrostate $I$ terminal when $\hat P_{II}\ge\tau=0.96$ and raises an error when no macrostate qualifies (_gpcca.py:296, 368–375) [R1].

**Estimands.** Each output is defined once here.
- Macrostate membership $\chi_{iI}\in[0,1]$ is the fuzzy weight of cell $i$ in macrostate $I$, summing to one over $I$; it is not an absorption probability.
- Terminal membership $\tau_i=\sum_{I\in\mathcal T}\chi_{iI}\in[0,1]$ is the unscaled weight of cell $i$ in the selected terminal set $\mathcal T$; CellRank's `terminal_states_probabilities` divides by the maximum membership for one selected macrostate, and for several divides each column by its own maximum and takes the row maximum (_gpcca.py:518–521); this task does not use that rescaling.
- Hard terminal label: the $n_{\rm cells}$ most likely cells per terminal macrostate (default 30; _gpcca.py:294), so a cell can have a high $\tau_i$ and still lack a hard label.
- Stability $s_I=\hat P_{II}\in[0,1]$ is the coarse one-step probability of staying in $I$, computed with $\pi$ weights; it is unitless and its time scale depends on the kernel normalisation.
- Initial weight $\hat\pi_I$ is the coarse stationary weight, summing to one over macrostates. Initial states are the $n_{\rm states}$ macrostates with the smallest weight, CellRank's rule (_gpcca.py:438); this is a heuristic, since a directed kernel's stationary mass tends to collect in sinks.

**Palantir.** Palantir [R3] builds a waypoint chain $T$ ordered by pseudotime from a start cell, takes the absolute leading left eigenvector $v$ as waypoint rank $r_i=|v_i|$ (eigs on $T^{\top}$, core.py:602), and calls waypoints above

$$c=\Phi^{-1}_{\mu,s}(0.9999),\qquad \mu=\operatorname{median}(r),\quad s=\operatorname{median}|r-\mu|$$

(core.py:607–611). Each connected component above $c$ contributes its maximum-pseudotime waypoint, which is snapped to the nearest diffusion-boundary waypoint (core.py:624–649). Because $s$ is the unscaled median absolute deviation, and the MAD of a normal sample is about $0.6745\,\sigma$, the cutoff under a normal rank model with standard deviation $\sigma$ sits near $\mu+2.51\,\sigma$. That is a one-sided tail of about 0.6%, or about 7 of the default 1,200 waypoints, rather than the $10^{-4}$ the quantile names. The cutoff is a fixed tail rule, not a test, and it does not depend on $n$.

**Absorbing chains.** If terminal macrostates are made absorbing, $P=\begin{pmatrix}Q&R\\0&I\end{pmatrix}$ and $B=(I-Q)^{-1}R$, where $B_{ik}$ is the probability that transient cell $i$ is eventually absorbed in terminal state $k$ (Kemeny and Snell [R17], from memory). The inverse exists when every transient cell can reach an absorbing set. This is the bridge to fate probabilities. This task outputs memberships, not $B$.

**Potency.** CellRank's CytoTRACE kernel is a re-implementation and does not reproduce CytoTRACE exactly (_cytotrace_kernel.py:118, 159) [R8]. It uses $1-$score as pseudotime (_cytotrace_kernel.py:148).

**Benchmark estimands.**
- End-state recall (B1): for each reference end milestone $e$, the fraction of its nearest-milestone group $G_e$ that lies in the predicted terminal set, averaged over $e$.
- Exact-k rate and absorption AUC (B2): the indicator that the number of terminal macrostates equals the planted $k$, and the ROC AUC of $\tau_i$ against $y_{ik}\in\{0,1\}$ for each planted leaf $k$.
- Clone fate recall (B3): for each clone with at least five final descendants, the fraction of its descendants in the predicted terminal set, averaged over clones with equal weight.

**Insight.**
- The answer is set by the direction and by $m$. The eigengap, top-$n$ and threshold rules give different $m$ on one kernel, and no calibrated rule chooses among them.
- Endpoints and sinks differ. A directed kernel makes a sink wherever sampling stops, and stability cannot tell an endpoint from truncation.
- Stability is not accuracy. A consistently wrong terminal set scores well under resampling.
- Annotation-based checks are partly circular when the labels also choose the root or the number of states. The cleanest checks are planted endpoints and lineage fates [R9].

**Failure modes by family.** Directed kernels create sinks at sampling edges. Palantir's cutoff sets the count by its tail rule. GPCCA raises an error when no macrostate meets the threshold and over-selects when $m$ is set too large. Graph leaves depend on node count and regularisation, and one branch can split into several leaves [R12].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CellRank GPCCA, stability rule | model-based | Generalised Perron cluster analysis of a directed kernel; macrostates with $\hat P_{II}\ge0.96$ are terminal | [R1, R4, R5] |
| CellRank GPCCA, top-$n$ and eigengap rules | model-based | Same macrostates; the $n$ macrostates with the largest diagonal, with $n$ given (top-n) or taken from the transition-matrix eigengap (eigengap) | [R1] |
| CellRank pseudotime kernels (hard, soft) | heuristic | Direct the kNN graph by removing or down-weighting edges into the pseudotime past | [R2, R3, R14] |
| CellRank CytoTRACE kernel | heuristic | Potency score used as pseudotime to direct the kernel | [R2, R8] |
| Palantir terminal states | hybrid | Waypoint Markov chain; leading eigenvector rank; fixed normal-quantile cutoff; boundary snapping | [R3] |
| Monocle 2 graph leaves | heuristic | Out-degree-zero nodes of the fitted principal graph, with pseudotime from the root | [R12] |
| PAGA leaf clusters (comparator) | heuristic | Degree-one clusters of the undirected PAGA graph; a leaf rule defined for this comparison, not by PAGA | [R11] |

GPCCA with stability selection [R1] and Palantir [R3] are the reference implementations for directed endpoint calling. Among methods whose code was read, GPCCA is the only model-based rule. Graph leaves are the usual heuristic comparators in trajectory benchmarks [R7]. Wishbone [R13] is superseded by Palantir, as the scanpy deprecation notice states (_wishbone.py:19–25). STREAM, scFates and URD are outside this table.

Commits: CellRank d7821af, Palantir f819d51, scanpy 8ed52d9, Monocle 2 release 7df1050. Files: CellRank `estimators/terminal_states/_gpcca.py` and `kernels/_pseudotime_kernel.py`, `kernels/utils/_pseudotime_scheme.py`, `kernels/_cytotrace_kernel.py`; Palantir `src/palantir/core.py`; scanpy `src/scanpy/tools/_paga.py` and `src/scanpy/external/tl/_wishbone.py`; Monocle 2 `R/order_cells.R`.

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| CellRank GPCCA | method | `stability` | _gpcca.py:293 |
| CellRank GPCCA | stability_threshold | 0.96 | _gpcca.py:296 |
| CellRank GPCCA | n_cells (terminal selection) | 30 | _gpcca.py:294 |
| CellRank GPCCA | n_cells (macrostates) | 30 | _gpcca.py:161 |
| CellRank GPCCA | alpha (eigengap) | 1 | _gpcca.py:295 |
| CellRank GPCCA | allow_overlap | False | _gpcca.py:298 |
| CellRank GPCCA | n_states when None | eigengap plus 1 | _gpcca.py:845–847 |
| CellRank GPCCA | complex-conjugate fallback | n_states + 1, with warning | _gpcca.py:251–253 |
| CellRank pseudotime kernel | threshold_scheme | `hard` | _pseudotime_kernel.py:83 |
| CellRank pseudotime kernel | frac_to_keep | 0.3 | _pseudotime_kernel.py:84 |
| CellRank pseudotime kernel | b (soft) | 10.0 | _pseudotime_kernel.py:85 |
| CellRank pseudotime kernel | nu (soft) | 0.5 | _pseudotime_kernel.py:86 |
| CellRank pseudotime kernel | hard-filter neighbour cap | 30 | _pseudotime_scheme.py:158 |
| Palantir | knn | 30 | core.py:410 |
| Palantir | num_waypoints | 1200 | core.py:411 |
| Palantir | max_iterations | 25 | core.py:413 |
| Palantir | seed | 20 | core.py:414 |
| Palantir | cutoff quantile (hard-coded) | 0.9999, unscaled MAD | core.py:607–611 |
| scanpy PAGA | use_rna_velocity | False | _paga.py:26 |
| scanpy PAGA | model | v1.2 | _paga.py:27 |
| Monocle 2 release | leaf definition | out-degree 0 | order_cells.R:84 |

## 5. Proposed singlet approach

Routes per method. GPCCA selection rules and the pseudotime kernels are **ported**. Palantir terminal states are **ported** with their cutoff kept, so their behaviour stays comparable. The CytoTRACE-type potency kernel is **reimplemented** from the published score definition. PAGA and Monocle 2 leaves are **callouts**, used only as comparators. Velocity-directed kernels are produced by the velocity tasks and are outside this tool's default.

The model-based formulation singlet proposes has two parts.
- (a) **Posterior stability.** Place a Dirichlet posterior on each row of the fine kernel $P$, with the kNN weights as pseudo-counts. Push each draw through the fixed memberships $\chi$ to obtain a posterior over the diagonal of $\hat P$, and call $I$ terminal when $\Pr(\hat P_{II}\ge0.96\mid\text{data})\ge\tfrac12$. It is falsified if, on B2 at equal $m$, it does not raise exact-k rate or absorption AUC over the point rule, or if it over-selects more often.
- (b) **Potency-informed prior.** A PyTorch classifier trained on catalogue cells, with author-annotated terminal types as weak labels and study-held-out splits, gives a per-cell terminal probability used as a prior on membership. It is falsified if held-out-study recall of terminal types does not exceed the unprior rule, or if its held-out calibration error is not below a level fixed before training.

The ML stack is PyTorch only for (b). Hard-coded CUDA and cuSPARSE cover the hot kernels: sparse power iteration for $\pi$, a sparse solve for $(I-Q)^{-1}R$ by conjugate gradient or Krylov methods, and sparse products throughout. The Schur step and the $m\times m$ coarse operations stay on the CPU. A dense decomposition of an $n\times n$ kernel costs $O(n^3)$ in general, while each sparse product costs $O(\mathrm{nnz})$.

Defaults an agent should use without asking: `method` gpcca_stability; `pseudotime_key` supplied, since undirected kernels return clusters; `gpcca.n_states` null (eigengap rule); `stability_threshold` 0.96; `n_cells` 30; `threshold_scheme` hard; `frac_to_keep` 0.3; for palantir, knn 30, num_waypoints 1200, seed 20. The four enum values are the GPCCA selection rules and the Palantir chain, all read in code (section 4).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsp/connectivities | sparse float | kNN graph (k = 30 by default), the undirected base of the kernel |
| read | obsm/X_pca | float32, n × d | embedding and data matrix for palantir |
| read | obs/pseudotime | float, n | direction for gpcca_* methods; required there |
| write | obs/terminal_state | categorical | hard terminal label from the top-n selection; NaN for other cells |
| write | obsm/terminal_state_memberships | float32, n × T | unscaled terminal membership $\tau$ per terminal macrostate |
| write | obsm/macrostate_memberships | float32, n × m | PCCA+ memberships $\chi$; rows sum to one |
| write | uns/terminal_states | dict | names, stability values, method and parameters |
| write | uns/coarse_T | float64, m × m | coarse transition matrix $\hat P$; rows sum to one |
| write | uns/coarse_stationary | float64, m | coarse stationary weights; sum to one |
| write | uns/initial_states | dict | initial macrostates (smallest coarse stationary weight) and their weights |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "gpcca_stability" | `gpcca_stability`, `gpcca_top_n`, `gpcca_eigengap`, `palantir` | Terminal-state rule. gpcca_* methods use a pseudotime-directed kernel; palantir uses a root cell. |
| `root` | string/null | null | — | Root cell id. Required for palantir; optional orientation for gpcca_* methods. |
| `pseudotime_key` | string/null | null | — | obs key of pseudotime that directs the kernel. Required for gpcca_* methods; ignored by palantir. |
| `gpcca` | object | — | — | Options for gpcca_* methods; ignored for palantir. |
| `gpcca.n_states` | integer/null | null | min 1 | Number of macrostates; null uses the eigengap rule. gpcca_top_n requires a value. |
| `gpcca.stability_threshold` | number | 0.96 | min 0; max 1 | Minimum coarse self-transition for a terminal macrostate (gpcca_stability). |
| `gpcca.n_cells` | integer | 30 | min 1 | Most likely cells per terminal macrostate. |
| `gpcca.alpha` | number | 1.0 | min 0 | Eigengap weight used by gpcca_eigengap. |
| `gpcca.allow_overlap` | boolean | false | — | Allow one cell to belong to more than one terminal state. |
| `gpcca.threshold_scheme` | string | "hard" | `hard`, `soft` | Pseudotime edge filter: hard removes past edges except nearest neighbours; soft down-weights them. |
| `gpcca.frac_to_keep` | number | 0.3 | min 0; max 1 | Share of nearest neighbours always kept under the hard filter. |
| `gpcca.posterior_draws` | integer | 0 | min 0 | Dirichlet posterior draws for stability intervals (singlet extension); 0 gives the point estimate. |
| `palantir` | object | — | — | Options for palantir; ignored for gpcca_* methods. |
| `palantir.knn` | integer | 30 | min 2 | Neighbours for the waypoint Markov chain. |
| `palantir.num_waypoints` | integer | 1200 | min 1 | Number of max-min sampled waypoints. |
| `palantir.max_iterations` | integer | 25 | min 1 | Maximum iterations of the pseudotime convergence. |
| `seed` | integer | 20 | — | Waypoint sampling seed for palantir (Palantir default); unused by gpcca_* methods. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Which parameters apply: `gpcca.*` only to the three gpcca_* methods, and `palantir.*` and `seed` only to palantir. `root` is required for palantir and `pseudotime_key` for gpcca_*. For palantir the macrostate and coarse members are not written, and the terminal members are 0/1 indicators of Palantir's terminal cells. Validation: `n_cells` must be positive (_gpcca.py:1353); `n_states` is required for `gpcca_top_n` (_gpcca.py:359). Changing `n_states` changes every terminal set, so compare values only on the same kernel.

## 7. MCP tool

Tool name `singlet_trajectory_terminal_state_identification` (definition in `tasks/mcp/singlet_trajectory_terminal_state_identification.json`). Example call, then an illustrative result with angle-bracket placeholders:

```json
{"dataset": "path/to/dataset.singlet", "method": "gpcca_stability", "pseudotime_key": "pseudotime", "gpcca": {"n_states": 4}}
```

```json
{"dataset": "path/to/dataset.singlet", "status": "completed",
 "wrote": ["obs/terminal_state", "obsm/terminal_state_memberships", "obsm/macrostate_memberships", "uns/terminal_states", "uns/coarse_T", "uns/coarse_stationary", "uns/initial_states"],
 "summary": {"method": "gpcca_stability", "n_macrostates": 4, "terminal_states": ["<name>"], "stability": {"<name>": "<float>"}, "initial_states": ["<name>"], "warnings": []},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: false; the call completes inline and returns `queued` with a `job_id` only when the sparse eigensolve does not converge within its iteration cap. Stochastic: only palantir, through waypoint sampling with `seed` (default 20); the gpcca methods are deterministic given the kernel. Dry run: returns `estimate` (seconds, peak memory, device) and the number of macrostates the call would compute.

## 8. Benchmarks

Shared protocol. Every method uses the same kNN graph (k = 30) on the same embedding. Directed methods use one pseudotime from trajectory.pseudotime_ordering, and Palantir uses the same root cell. No root, kernel or number of states is chosen from terminal labels. Each benchmark reports medians and interquartile ranges over replicates, where a replicate is an 80% cell subsample with a fixed seed; five seeds are used (design choice). Stability, the median Jaccard overlap of terminal cell sets across subsamples, is reported with every benchmark and does not establish accuracy. Defaults apply unless a benchmark sweeps a parameter.

### B1. dynverse milestone evaluation with end states (published benchmark, terminal use extended)

- **Goal**: whether the predicted terminal set covers the end states of reference trajectories, using the milestone model of the dynverse study.
- **Ground truth**: a planted reference trajectory for the synthetic datasets, simulated with several simulators including dyngen and Splatter, and a gold or silver standard reference for real data (paper.Rmd:95, 436, 469, 632) [R7]. End states are milestones with only incoming edges (paper.Rmd:341). Each cell is assigned to its nearest reference milestone (metric_mapping.R:30), giving group $G_e$ for each end milestone $e$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| dynverse trajectory compendium | [R7] | synthetic and real single-cell trajectory datasets (paper.Rmd:95) | see section 12 | results reported per topology |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| end-state recall $R_{\rm end}$ | mean over reference end milestones of $\lvert G_e\cap\hat{\mathcal T}\rvert/\lvert G_e\rvert$, with $\hat{\mathcal T}$ the hard terminal set; NA set to 0 | maximize | primary | [R7] |
| end-state count agreement | fraction of datasets whose number of predicted terminal macrostates equals the number of reference end milestones | maximize (exact match) | guardrail | [R7] |

- **Comparators**: PAGA leaf clusters and Monocle 2 leaves (callouts), and the GPCCA and Palantir rules of this document.
- **Protocol**: the shared protocol; results per topology class (linear, bifurcating, tree, cyclic).
- **Acceptance criterion** (proposed design criterion, not a published value): $R_{\rm end}\ge0.80$ on synthetic linear and bifurcating topologies, and exact end-state count on at least 80% of datasets.
- **Known pitfalls**: nearest-milestone groups depend on milestone placement, so a method with more terminal sets can raise recall; the count guardrail limits this. For silver-standard data the reference end states come from expression, so agreement is partly circular.

### B2. Planted endpoints (proposed; generator recipe)

- **Goal**: exact recovery of the number and membership of planted absorbing endpoints under controlled topology and sampling density.
- **Ground truth**: planted simulation. $y_{ik}\in\{0,1\}$ marks the leaf whose lineage cell $i$ lies on; planted $k$ counts leaves with at least $n_{\min}$ sampled cells, fixed in advance (design choice).
- **Generator recipe**
  1. Draw a rooted tree with $k\in\{2,3,5\}$ leaves and fixed branch-length law.
  2. Place nodes in a $d$-dimensional latent space by a random walk, with $d$ fixed.
  3. Simulate a discrete-time Markov chain of latent states from the root, drifting to the child with Gaussian noise; leaves are absorbing.
  4. Set $\mu_{gi}=s_i\exp(\beta_g^{\top}z_i)$ and draw negative-binomial counts with fixed dispersion.
  5. Sample $n$ cells at uniform times, truncating the horizon at three fixed levels for the density axis.
  6. Set $y_{ik}$ from each lineage, the root from the root node, and pseudotime from simulation time.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| planted-endpoint generator | recipe above | synthetic counts; sizes are design choices | not applicable | parameters reported per replicate |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| exact-k rate | replicates whose predicted terminal count equals planted $k$ | maximize | primary | — |
| per-cell absorption AUC | mean over leaves of the ROC AUC of $\tau_i$ for $y_{ik}$ | maximize | primary | — |
| Brier score (posterior variant) | mean of $(p_{ik}-y_{ik})^2$, with $p_{ik}$ the posterior terminal probability | minimize | guardrail | — |

- **Comparators**: GPCCA stability (default), GPCCA top-$n$ with planted $k$ (oracle), Palantir with the true root, PAGA and Monocle 2 leaves.
- **Protocol**: $k\in\{2,3,5\}$ by three densities, replicates fixed in advance; results per topology and density.
- **Acceptance criterion** (proposed): exact-k rate and mean per-cell absorption AUC at least 0.90 for $k=2$ and $k=3$.
- **Known pitfalls**: simulator-matched kernels look better than on real data; leaves with few cells are invisible to all methods, so report the minimum leaf size.

### B3. Lineage-barcode fates (proposed; orthogonal measurement)

- **Goal**: whether predicted terminal states contain the clonal fate outcomes measured by lineage barcodes.
- **Ground truth**: orthogonal measurement. For clone $c$ with at least five final-time descendants $D_c$, the outcome is the empirical fate distribution $f_{ck}=\lvert\{i\in D_c: \text{state } k\}\rvert/\lvert D_c\rvert$, summing to one over states. The estimand is the fraction of each clone's final descendants in the predicted terminal set. The kernel is built from the snapshot without barcodes.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| LARRY lineage-barcoded hematopoiesis | [R9] | barcoded scRNA-seq; organism and size not confirmed in the corpus | not confirmed | accession and size in section 10 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| clone-level fate recall | mean over clones with at least five descendants of $\lvert D_c\cap\hat{\mathcal T}\rvert/\lvert D_c\rvert$ | maximize | primary | [R9] |
| fate distribution divergence | Jensen–Shannon divergence between the predicted absorption distribution $B_{c\cdot}$ of the clone's start cells and $f_c$ | minimize | guardrail | shared with the fate-probability task |

- **Comparators**: GPCCA stability (default) and Palantir.
- **Protocol**: the clone-size filter (five descendants) and barcode-quality filters are fixed before calling terminal states; the kernel uses no barcode information.
- **Acceptance criterion** (proposed design criterion): clone-level fate recall at least 0.70.
- **Known pitfalls**: a clone can end in a transitional state, so clonal outcomes are not terminal states; barcode sampling at one time point limits what fates can be inferred.

### P1. Performance and scaling

Wall time and peak memory for terminal-state calling after the kernel is built, at 10k, 100k and 1M cells, with kNN = 30, on single-thread CPU, multi-thread CPU and CUDA. Kernel build time and memory are reported separately, with sparse-kernel and coarse-matrix memory listed apart. Comparators: GPCCA through CellRank, Palantir `identify_terminal_states`, PAGA leaves, Monocle 2 leaves. Hold fixed: kNN 30, the selection rule, Palantir `num_waypoints` 1200, thread count and seed. Real anchor sizes from the CellRank loaders (datasets.py shape tuples): zebrafish 2,434; pancreas 2,531; bone marrow 5,780; lung 24,882; reprogramming (Morris) 104,679; reprogramming (Schiebinger) 236,285 cells. No streaming claim is made, so 10M cells are not reported.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `neighbors.neighbor_count_selection`: Choice of neighbour count k and graph stability
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `trajectory.pseudotime_ordering`: Pseudotime ordering along a lineage
  - `trajectory.root_identification`: Root or start-state identification
- **Feeds**:
  - `trajectory.fate_probability`: Cell-fate probability estimation
  - `trajectory.branch_point_assignment`: Branch point localisation and cell-to-branch assignment
  - `trajectory.differential_progression`: Differential progression, topology and fate selection between conditions
- **Reads**: `obsp/connectivities`, `obsm/X_pca`, `obs/pseudotime`
- **Writes**: `obs/terminal_state`, `obsm/terminal_state_memberships`, `obsm/macrostate_memberships`, `uns/terminal_states`, `uns/coarse_T`, `uns/coarse_stationary`, `uns/initial_states`
<!-- CHAINING:AUTO:END -->

Named recipes for this task are not yet fixed. The chain goes from the neighbour graph and pseudotime to fate mapping and differential progression.

## 10. Risks, pitfalls and open questions

- The pancreas data (Bastidas-Ponce et al. 2019 [R10], loaded by `cellrank.datasets.pancreas`, 2,531 cells) and the zebrafish data (Farrell et al. 2018 [R16], axial mesoderm, 2,434 cells) are not benchmarks here, because their annotation column names and terminal label sets are not in the corpus, and the candidate endocrine types (alpha, beta, delta, epsilon) come from memory. The bone marrow data (Setty et al. 2019 [R3], 5,780 cells, with a precomputed Palantir pseudotime) are excluded for circularity and because the terminal population set is unsettled. All three become candidates once their label sets are read.
- The accession and size for LARRY [R9] and the sizes and licences of the figshare datasets loaded by CellRank are not in the corpus, so B3 cannot be used yet.
- The published Palantir benchmarks are not in the corpus, and the cutoff analysis in section 3 is derived from code. The pyGPCCA source is not in the corpus, so the coarse-graining equation is taken from [R4–R6] and its code form is unverified.
- Literature unsettled: no calibrated rule for the number of terminal states; sinks at sampling edges versus biological endpoints; kernel dependence (connectivity, pseudotime, velocity) is rarely benchmarked; multi-fate and transient end states (cell cycle, stress) are not handled consistently.
- Technical risks: GPCCA raises an error when no macrostate meets the threshold (_gpcca.py:368–375), so pipelines must catch it rather than report zero terminal states. A learned potency hint is not used here, and its adoption needs a licence decision (section 12).
- First experiment: B1 on the synthetic linear and bifurcating topologies with GPCCA stability and Palantir on the same pseudotime-directed kernel, recording end-state recall and count, then B2 at $k=2$ and $k=3$. Its result decides whether the posterior variant in section 5 is worth building.

## 11. References

R1. Lange M, et al. CellRank for directed single-cell fate mapping. *Nature Methods* 2022. doi:10.1038/s41592-021-01346-6 — verified (corpus)
R2. Weiler P, Lange M, Klein M, Pe'er D, Theis F. CellRank 2: unified fate mapping in multiview single-cell data. *Nature Methods* 2024. doi:10.1038/s41592-024-02303-9 — verified (corpus)
R3. Setty M, Kiseliovas V, Levine J, Gayoso A, Mazutis L, Pe'er D. Characterization of cell fate probabilities in single-cell data with Palantir. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0068-4 — verified (corpus)
R4. Reuter B, Weber M, Fackeldey K, Roblitz S, Garcia ME. Generalized Markov State Modeling Method for Nonequilibrium Biomolecular Dynamics: Exemplified on Amyloid β Conformational Dynamics Driven by an Oscillating Electric Field. *Journal of Chemical Theory and Computation* 2018. doi:10.1021/acs.jctc.8b00079 — verified (corpus)
R5. Reuter B, Fackeldey K, Weber M. Generalized Markov modeling of nonreversible molecular kinetics. *The Journal of Chemical Physics* 2019. doi:10.1063/1.5064530 — verified (corpus)
R6. Deuflhard P, Weber M. Robust Perron cluster analysis in conformation dynamics. *Linear Algebra and its Applications* 398 (2005) 161–184; DOI not confirmed. — partial (search)
R7. Saelens W, Cannoodt R, Todorov H, Saeys Y. A comparison of single-cell trajectory inference methods. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0071-9 — verified (corpus)
R8. Gulati GS, et al. Single-cell transcriptional diversity is a hallmark of developmental potential. *Science* 2020. doi:10.1126/science.aax0249 — verified (corpus)
R9. Weinreb C, Rodriguez-Fraticelli A, Camargo FD, Klein AM. Lineage tracing on transcriptional landscapes links state to fate during differentiation. *Science* 2020. doi:10.1126/science.aaw3381 — verified (corpus)
R10. Bastidas-Ponce A, et al. Comprehensive single cell mRNA profiling reveals a detailed roadmap for pancreatic endocrinogenesis. *Development* 2019. doi:10.1242/dev.173849 — verified (corpus)
R11. Wolf FA, Hamey FK, Plass M, Solana J, Dahlin JS, Göttgens B, et al. PAGA: graph abstraction reconciles clustering with trajectory inference through a topology preserving map of single cells. *Genome Biology* 2019. doi:10.1186/s13059-019-1663-x — verified (corpus)
R12. Qiu X, Mao Q, Tang Y, Wang L, Chawla R, Pliner HA, Trapnell C. Reversed graph embedding resolves complex single-cell trajectories. *Nature Methods* 2017. doi:10.1038/nmeth.4402 — verified (corpus)
R13. Setty M, Tadmor MD, Reich-Zeliger S, et al. Wishbone identifies bifurcating developmental trajectories from single-cell data. *Nature Biotechnology* 2016. doi:10.1038/nbt.3569 — verified (corpus)
R14. Stassen SV, Yip GGK, Wong KKY, Ho JWK, Tsia KK. Generalized and scalable trajectory inference in single-cell omics data with VIA. *Nature Communications* 2021. doi:10.1038/s41467-021-25773-3 — verified (corpus)
R15. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R16. Farrell JA, Wang Y, Riesenfeld SJ, Shekhar K, Regev A, Schier AF. Single-cell reconstruction of developmental trajectories during zebrafish embryogenesis. *Science* 2018. doi:10.1126/science.aar3131 — verified (corpus)
R17. Kemeny JG, Snell JL. *Finite Markov Chains*. Van Nostrand; 1960. — unverified (memory)
R18. La Manno G, et al. RNA velocity of single cells. *Nature* 2018. doi:10.1038/s41586-018-0414-6 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/cellrank | Marius Lange, Michal Klein, Philipp Weiler (pyproject.toml); Theis Lab (LICENSE) | BSD-3-Clause (LICENSE; corpus commit d7821af) | GPCCA selection rules, pseudotime and CytoTRACE kernels, default values | port (GPCCA, pseudotime kernels); reimplement (CytoTRACE score) |
| https://github.com/dpeerlab/Palantir | Dana Pe'er Lab (LICENSE) | MIT (LICENSE and pyproject.toml; corpus commit f819d51) | waypoint chain and terminal cutoff | port |
| https://github.com/scverse/scanpy | scverse; F. Alexander Wolf, P. Angerer, Theis Lab (LICENSE) | BSD-3-Clause (LICENSE; corpus commit 8ed52d9) | PAGA defaults; Wishbone deprecation | callout |
| https://github.com/cole-trapnell-lab/monocle-release (Monocle 2.9.0 release) | Cole Trapnell (DESCRIPTION) | Artistic-2.0 (DESCRIPTION; corpus commit 7df1050) | graph-leaf comparator | callout |
| https://github.com/dynverse/dynbenchmark (corpus commit 3d8bd6c) | Robrecht Cannoodt, Wouter Saelens (LICENSE) | MIT (LICENSE.md) | benchmark design and end-state definitions | callout (cited text) |
| https://github.com/dynverse/dyneval (corpus commit daeb26a) | Robrecht Cannoodt (aut, cre), Wouter Saelens, Helena Todorov (DESCRIPTION) | GPL-3 (DESCRIPTION) | milestone grouping and F1 definitions | reimplement (definitions from the description; no code copied) |
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE) | Apache-2.0 (LICENSE; corpus commit d581689) | RNA velocity, pseudotemporal and lineage-tracing takeaways | callout (cited text) |
