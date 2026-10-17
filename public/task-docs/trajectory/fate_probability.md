---
id: trajectory.fate_probability
title: Cell-fate probability estimation
area: trajectory
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [trajectory.root_identification, trajectory.terminal_state_identification, trajectory.pseudotime_ordering, neighbors.neighbor_count_selection]
feeds: [trajectory.branch_point_assignment, trajectory.pseudotime_de, lineage-tracing.clone_state_fate_bias_scoring, lineage-tracing.clone_informed_fate_probability]
reads: [obsm/X_pca, obsp/connectivities, obs/pseudotime, obs/root_flag, uns/terminal_states, obs/day]
writes: [obsm/fate_probabilities, uns/fate_probabilities_columns, obs/fate_entropy, obs/fate_argmax, obs/absorption_time]
devices: [cpu, cuda]
mcp_tool: singlet_trajectory_fate_probability
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Cell-fate probability estimation

> Estimates, for each cell, the probability of reaching each terminal state from a transition structure, and tests those probabilities against fates measured independently of expression.

## 1. Question

For each cell, what is the probability that its descendants reach each terminal state, and do these probabilities match fates measured independently of the transcriptome? Inputs are a kNN graph or velocity or time-course snapshots, terminal states (given or inferred) and an optional root. Outputs are a cells-by-terminal-states matrix whose rows sum to one, with per-cell entropy and argmax. A correct answer matches clonal descendant fractions where lineage barcodes exist, because snapshot expression alone does not determine fate probabilities [R1].

## 2. Why this task matters and where the field stands

Fate probabilities say which progenitor states feed which terminal lineages and how undecided each cell is, and they weight lineage-directed analyses. The established construction is an absorbing Markov chain. Palantir computes absorption probabilities over waypoints on a pseudotime-directed graph [R2]. CellRank 2 applies the same absorption step to multiview kernels that combine velocity, pseudotime and real-time couplings [R3, R4]. Optimal-transport methods instead couple consecutive snapshots and pull population labels back in time [R5]. The status is **contested**. Snapshots do not identify transition dynamics, so defensible kernels give different probabilities from the same data [R1], and every fate column inherits errors in the terminal states. Validation is scarce. The external per-cell truth available is clonal lineage barcoding [R6], and the trajectory comparison of Saelens et al. scores topology and pseudotime rather than fate probabilities [R7].

## 3. Theory and insight

A cell is a transient state of a time-homogeneous Markov chain with row-stochastic kernel $P$ over $N$ transient states (cells or waypoints) and $K$ absorbing terminal states. In block form,
$$P=\begin{pmatrix} Q & R\\ 0 & I\end{pmatrix},\qquad B=(I-Q)^{-1}R=NR,\qquad t=(I-Q)^{-1}\mathbf 1,$$
where $N=(I-Q)^{-1}$ is the fundamental matrix, $B_{ij}$ is the probability that a walk from transient state $i$ is absorbed in terminal state $j$, and $t_i$ is the expected number of steps to absorption. Rows of $B$ sum to one when every transient state reaches the absorbing set, which is what makes $I-Q$ invertible. Terminal states are made absorbing by giving them self-loops, as Palantir does.

Estimands, one sentence each:

- **Fate probability** $F_{ij}$ is the absorption probability of terminal state $j$ from cell $i$ on the chosen kernel. For Palantir, $F=W^{\top}B_{\mathrm{wp}}$ with $\sum_w W_{wi}=1$, so each row is a distribution over the $K$ terminal states, normalised within the chain and not over time.
- **Entropy** $H_i=-\sum_j F_{ij}\log F_{ij}$ is in nats, between $0$ for a committed cell and $\log K$ for an even split. It measures ambiguity, not potency.
- **Absorption time** $t_i$ is counted in steps of the kernel.
- **Waddington-OT fate** $F_t(i,j)$ is the probability of descent to a labelled population at the final time, conditional on reaching one. The pull-back is $F_t(i,j)\propto\sum_k\pi_{t,t+1}(i,k)F_{t+1}(k,j)$ with $F_T(k,j)=\mathbf 1[k\in\mathrm{pop}_j]$, and each row is divided by its sum over populations [R5]. Mass that leaves the labelled populations is removed by this normalisation, so $F$ is not an absorption probability when unlabelled mass exists.

Kernel construction sets the answer. Palantir's affinity $W_{ij}=\exp(-d_{ij}^2/2\sigma_i^2-d_{ij}^2/2\sigma_j^2)$ uses a local bandwidth $\sigma_i$, and an edge $i\to j$ survives only when $\mathrm{pt}_j\ge\mathrm{pt}_i-\sigma_i$. This forces probability to flow forward in pseudotime, which encodes monotone differentiation. CellRank's hard threshold removes backward-in-pseudotime edges except to the closest `frac_to_keep` fraction of neighbours, which are kept in either direction, so the outcome depends on that fraction. Velocity kernels orient edges by predicted expression change [R8]; their direction is only as reliable as the kinetic model, and steady-state assumptions and mismatched RNA time scales often fail [R9]. Unbalanced entropic transport between snapshots solves
$$\min_{\pi\ge 0}\ \langle C,\pi\rangle+\varepsilon\sum_{ik}\pi_{ik}(\log\pi_{ik}-1)+\lambda_1\,\mathrm{KL}(\pi\mathbf 1\,\|\,a)+\lambda_2\,\mathrm{KL}(\pi^{\top}\mathbf 1\,\|\,b),$$
which is the standard unbalanced form [R10], with entropic regularisation solved by Sinkhorn scaling [R11]. Small $\varepsilon$ gives near-deterministic maps but risks instability. Small $\lambda$ permits mass creation and death, and large $\lambda$ approaches balanced transport. Probabilistic mixture models fit a generative model along pseudotime and return posterior branch probabilities; no such method is adopted here (section 10).

Heuristic standards set the answer through their constants: the neighbour count, the pseudotime threshold, the terminal set and, for transport, $\varepsilon$. The absorption step is an exact linear solve given the kernel. A model-based formulation adds what fixed constants cannot give: probabilities calibrated against outcomes, uncertainty over kernels and parameters, and a trained model that transfers to new cells. The published heuristics remain as comparators.

Assumptions and failure modes by family:

- Absorbing chains: kernel direction must follow progenitor-to-terminal order, and terminal states must truly absorb. Direction errors flip probabilities, outflow from terminal states leaks mass, and Palantir clips negative entries of $B$ to zero, so rows can stop summing to one.
- Transport: snapshots must sample the same population, and transitions must be captured by couplings. Larger $\varepsilon$ spreads fate mass across neighbours.
- All families: dense sampling favours densely sampled terminal states, terminal misdetection propagates to every column, and commitment can precede measurable transcriptional bias, so early fate probabilities can be late.

Insight: row sums and defined entropy show internal consistency, not validity. Correctness belongs to the kernel and the terminal set, and only outcomes measured independently of the kernel, such as clonal descendants or time-resolved composition, test it. Regime of validity: absorption probabilities hold for the fixed kernel supplied, are not kinetic rates, and support claims about commitment only with outcome data. Dense inversion of $I-Q$ costs $O(N^3)$ in transient states, which is why Palantir restricts $N$ to its waypoints and CellRank solves its $K$ right-hand sides iteratively.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Palantir | hybrid | Pseudotime-directed adaptive kNN chain over waypoints; absorption probabilities lifted to cells | [R2] |
| CellRank 2 | hybrid | Weighted sum of velocity, pseudotime and real-time kernels; GPCCA macrostates; absorption by sparse linear solve | [R3], [R4], [R12] |
| Waddington-OT | model-based | Unbalanced entropic couplings between time points; labelled populations pulled back and normalised | [R5] |
| URD | heuristic | Pseudotime-biased random walks; visitation frequency, a comparator and not an absorption probability | [R13] |

Palantir and CellRank are the established absorbing-chain implementations, and Waddington-OT is the established time-course coupling method. These three are the methods singlet will implement. URD is kept as a heuristic comparator only. CellRank 2 deprecates several high-level v1 `cellrank.tl` functions, so the CellRank row covers v2. Its soft pseudotime threshold is VIA-inspired [R14].

Defaults for the methods in section 5 and the URD comparator, from source at the commits shown:

| Method | Parameter | Value | Source |
|---|---|---|---|
| Palantir (f819d51) | knn | 30 | src/palantir/core.py:67 |
| Palantir | num_waypoints | 1200 | src/palantir/core.py:68 |
| Palantir | max_iterations | 25 | src/palantir/core.py:72 |
| Palantir | scale_components | True | src/palantir/core.py:70 |
| Palantir | seed | 20 | src/palantir/core.py:79 |
| Palantir | adaptive neighbour index $k_a$ | $\min(\lfloor k/3\rfloor-1,\,30)$ | src/palantir/core.py:532 |
| CellRank 2 (d7821af) | solver | gmres | src/cellrank/estimators/mixins/src/cellrank/estimators/mixins/_fate_probabilities.py:181; src/cellrank/_utils/_linear_solver.py:15 |
| CellRank 2 | tol | 1e-6 | _fate_probabilities.py:186 |
| CellRank 2 | check_sum_tol | 1e-3 | _fate_probabilities.py:188 |
| CellRank 2 | threshold_scheme | hard | src/cellrank/kernels/_pseudotime_kernel.py:83 |
| CellRank 2 | frac_to_keep | 0.3 | _pseudotime_kernel.py:84 |
| Waddington-OT (ca5e94f) | epsilon | 0.05 | wot/commands/util.py:204 |
| Waddington-OT | lambda1 | 1 | wot/commands/util.py:210 |
| Waddington-OT | lambda2 | 50 | wot/commands/util.py:213 |
| Waddington-OT | epsilon0 | 1 | wot/commands/util.py:222 |
| Waddington-OT | max_iter | 1e7 | wot/commands/util.py:216 |
| Waddington-OT | scaling_iter | 3000 | wot/commands/util.py:201 |
| Waddington-OT | inner_iter_max | 50 | wot/commands/util.py:202 |
| Waddington-OT | tolerance | 1e-8 (declared int) | wot/commands/util.py:220 |
| URD (0fed8b8) | n.per.tip | 10000 | R/diffusion.R:254 |
| URD | max.steps (simulateRandomWalk) | 5000 | R/diffusion.R:193 |
| URD | max.steps (simulateRandomWalksFromTips) | ncol(object@logupx.data) | R/diffusion.R:254 |

## 5. Proposed singlet approach

Source routes and licences are in section 12. The absorption step follows Palantir and CellRank 2, the coupling and pull-back follow Waddington-OT, and Sinkhorn scaling is reimplemented for the GPU.

The default method is `palantir`. It has the most direct absorbing-chain objective and source-level defaults, and it returns a soft matrix without an extra kernel choice. Agents use the section 6 defaults and supply `root` whenever `obs/pseudotime` is absent. Terminal states are auto-detected only when `terminal_key` is null, and detected states must be reviewed before use.

The proposed model is a sparse absorbing-chain estimator on a learned transition kernel, with fate probabilities calibrated by temperature scaling on one clone split and scored on the other (B1), and uncertainty from kernel ensembles or a Laplace approximation. The kernel is learned by maximum likelihood on time-course snapshots that carry day labels. It is falsified if its B2 MAE is not below Palantir's at knn 30, or if its B1 expected calibration error is not below that of uncalibrated Palantir output. It stays out of the enum until it meets both.

An amortised regressor $F_\theta(x)=\mathrm{softmax}(f_\theta(x))$ in PyTorch is trained on absorption pseudo-fates from one kernel and on clonal distributions held out by clone. This measures the kernel's bias on held-out clones rather than inheriting it.

The ML stack is PyTorch for the regressor and learned kernel. Hard-coded CUDA with cuSPARSE handles the absorption solve $(I-Q)X=R$ with $K$ right-hand sides by GMRES or BiCGSTAB, and the kNN graph through existing kernels, because these are small, repeated, sparse non-symmetric operations. A CPU C++ reference reproduces Palantir and CellRank 2 on small $N$. CPU comes first and CUDA covers the solve. Streaming is not claimed, because the kernel and the waypoint lift need all cells. Each call reports the solver residual and $\max_i\lvert\sum_j F_{ij}-1\rvert$, and fails when the residual exceeds the solver tolerance or the row-sum error exceeds $10^{-3}$.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/X_pca | float32 | embedding for the kNN graph (name set by `embedding`) |
| read | obsp/connectivities | sparse float | optional precomputed kNN graph |
| read | obs/pseudotime | float32 | optional; computed from `root` when absent |
| read | obs/root_flag | bool | single TRUE start cell (column set by `root`) |
| read | uns/terminal_states | table | optional terminal states (key set by `terminal_key`) |
| read | obs/day | numeric or categorical | time labels for `waddington_ot` (column set by `waddington_ot.time_key`) |
| write | obsm/fate_probabilities | float32, n × K | rows sum to one over terminal states |
| write | uns/fate_probabilities_columns | string array | terminal-state names in column order |
| write | obs/fate_entropy | float32 | Shannon entropy of each row, in nats |
| write | obs/fate_argmax | categorical | most probable terminal state |
| write | obs/absorption_time | float32 | expected steps to absorption; `cellrank` only |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "palantir" | `palantir`, `cellrank`, `waddington_ot` | palantir: absorbing chain on a kNN graph; cellrank: multiview kernel absorption; waddington_ot: time-course couplings. |
| `embedding` | string | "X_pca" | — | obsm key of the embedding used to build the kNN graph when no graph is stored. |
| `root` | string/null | null | — | Start cell: obs column with one TRUE value. Required when obs/pseudotime is absent. |
| `terminal_key` | string/null | null | — | uns key listing terminal states; null uses the method's own terminal-state detection. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 20 | — | Seed for Palantir waypoint sampling; default matches Palantir. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `palantir` | object | — | — | Options used when method is palantir. |
| `palantir.knn` | integer | 30 | min 1 | Neighbours per cell in the kNN graph. |
| `palantir.num_waypoints` | integer | 1200 | min 1 | Waypoints for the absorbing chain; cells are lifted to them. |
| `palantir.max_iterations` | integer | 25 | min 1 | Maximum pseudotime refinement iterations. |
| `cellrank` | object | — | — | Options used when method is cellrank. |
| `cellrank.threshold_scheme` | string | "hard" | `hard`, `soft` | Pseudotime edge rule: hard keeps forward edges plus a neighbour fraction; soft is VIA-inspired. |
| `cellrank.frac_to_keep` | number | 0.3 | min 0; max 1 | Fraction of neighbours kept regardless of direction (hard scheme). |
| `cellrank.tol` | number | 1e-06 | min 0 | Relative residual tolerance for the absorption linear solve. |
| `waddington_ot` | object | — | — | Options used when method is waddington_ot. |
| `waddington_ot.time_key` | string | "day" | — | obs column with time-point labels; required for this method. |
| `waddington_ot.epsilon` | number | 0.05 | > 0 | Entropic regularisation; small values give near-deterministic maps. |
| `waddington_ot.lambda1` | number | 1 | min 0 | Unbalanced penalty on the source marginal. |
| `waddington_ot.lambda2` | number | 50 | min 0 | Unbalanced penalty on the target marginal. |
<!-- PARAMS:AUTO:END -->

Each method reads only its own block: `palantir.*`, `cellrank.*` or `waddington_ot.*`. The tool requires `root` or `obs/pseudotime`, refuses `waddington_ot` without `obs/day`, and refuses a `terminal_key` that names no `uns` entry. Defaults are those in section 4, and changing one is a benchmark decision, not a tuning step. `seed` affects Palantir's waypoint sampling only; the other methods are deterministic given their inputs.

## 7. MCP tool

Tool `singlet_trajectory_fate_probability` (definition in `tasks/mcp/singlet_trajectory_fate_probability.json`). Example call and result; angle brackets mark placeholders.

```json
{"dataset": "data/hematopoiesis.singlet", "method": "palantir", "root": "root_flag", "palantir": {"knn": 30}}
```

```json
{"dataset": "data/hematopoiesis.singlet", "status": "completed",
 "wrote": ["obsm/fate_probabilities", "uns/fate_probabilities_columns", "obs/fate_entropy", "obs/fate_argmax"],
 "summary": {"method": "palantir", "terminal_states": "<int>", "waypoints": "<int>", "row_sum_error_max": "<float>", "solver_residual_max": "<float>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: `palantir` and `cellrank` on large inputs return `queued` with a `job_id`. Dry run: returns `seconds`, `peak_memory_gb` and `device` and writes nothing.

## 8. Benchmarks

All methods receive the same embedding, kNN graph, root and terminal-state set, so differences come from the fate step. Each method uses its section 4 defaults, and graph-based methods add a knn sweep over 15 and 30. A failed fit, a fit over the memory limit or a fit over one hour is reported as a failure and never dropped. Learned models are split by clone or study, so that no clone or study spans training and evaluation. No published fate benchmark is used, so every threshold below is a proposal. Results are reported per dataset, with medians over seeds.

### B1. Clonal fate concordance on lineage-barcoded scRNA-seq (proposed)

- **Goal**: test whether early barcoded cells' fate probabilities match their clonal descendants' terminal types, an outcome measured independently of expression.
- **Ground truth**: orthogonal measurement. For early cell $i$ with clonal relatives at a later time, let $c_{ij}$ count differentiated relatives in terminal type $j$, excluding undifferentiated relatives and barcodes seen in more than one library type. The estimand is $q_{ij}=c_{ij}/\sum_{j'}c_{ij'}$, the fraction of differentiated clonal relatives in terminal type $j$, normalised so $\sum_j q_{ij}=1$. Cells without differentiated relatives are excluded, terminal labels come from late cells only, and $q$ is never used for fitting.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| LARRY lineage-barcoded hematopoiesis | [R6] | scRNA-seq with clonal barcodes; species —; size — | — | Access terms in section 10 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-terminal AUROC | Mean over $j$ with both classes present of the AUROC of $F_{ij}$ for $y_{ij}=\mathbf 1[q_{ij}\ge 0.5]$, midranks for ties | maximise | primary | — |
| Expected calibration error | Pool all $(i,j)$ pairs; 10 equal-width bins of $F_{ij}$; $\sum_b (n_b/n)\lvert\bar F_b-\bar y_b\rvert$ | minimise | primary | — |
| Entropy correlation | Spearman correlation of $H_i$ with $-\sum_j q_{ij}\log q_{ij}$ | maximise | guardrail | — |
| Top-1 concordance | Cells with $\max_j q_{ij}>0.5$ and a unique maximum: fraction with matching argmax | maximise | guardrail | — |

- **Comparators**: uniform $F_{ij}=1/K$; kNN majority of late terminal labels; pseudotime-nearest terminal; Palantir with given and detected terminals; CellRank 2 with pseudotime and velocity kernels; Waddington-OT with day labels.
- **Protocol**: as in the section 8 preamble, with bootstrap intervals over clones.
- **Acceptance criterion**: proposed. Median per-terminal AUROC at least 0.70, ECE at most 0.10, and AUROC at least 0.05 above both the uniform and kNN-majority baselines.
- **Known pitfalls**:
  - Clonal relatives record proliferation history and time lag as well as fate, and large clones favour fast-cycling lineages.
  - Terminal labels derived from the features being scored are circular.

### B2. Planted absorbing chain with exact absorption probabilities (proposed)

- **Goal**: accuracy of $F$ and entropy where true absorption probabilities are known, under noise, sampling density and kernel misspecification.
- **Ground truth**: planted simulation. The estimand is $F^{*}_i=(I-Q^{*})^{-1}R^{*}$ for the latent state of cell $i$, an exact absorption probability normalised over the $K$ terminal states. $H^{*}_i$ is its entropy in nats.
- **Generator recipe**:
  1. Draw a forward-only directed graph of $M$ latent states with one root and $K\in\{2,5\}$ absorbing terminal states.
  2. Draw outgoing transition probabilities from a seeded Dirichlet; store $Q^{*}$, $R^{*}$, $F^{*}$.
  3. Sample cells from latent states with per-cell latent time $\tau_i$, and assign snapshot day labels.
  4. Set expression $x_i=Az_i+\varepsilon_i$, with $A$ a fixed random matrix, Gaussian noise at three levels and count sampling.
  5. Build the kNN graph from $x$; supply root, terminal labels and days. For misspecification, perturb kernel edge weights lognormally.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Recipe above | singlet proposal | simulated scRNA-seq; sizes on a grid, every grid point reported | — | Truth is exact |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Mean absolute error | $\frac{1}{nK}\sum_{i,j}\lvert F_{ij}-F^{*}_{ij}\rvert$ | minimise | primary | — |
| Brier score | $\frac{1}{n}\sum_{i,j}(F_{ij}-F^{*}_{ij})^2$ | minimise | primary | — |
| Entropy correlation | Spearman correlation of $H_i$ and $H^{*}_i$ | maximise | guardrail | — |
| Row-sum violation | $\max_i\lvert\sum_j F_{ij}-1\rvert$ | minimise | guardrail | — |

- **Comparators**: uniform; pseudotime-nearest terminal; Palantir; CellRank 2; Waddington-OT with simulated day labels; URD visitation fractions.
- **Protocol**: at least 10 seeds per condition; medians and interquartile ranges; defaults plus the knn sweep.
- **Acceptance criterion**: proposed. The best method has MAE at most 0.10 under clean geometry and at least a twofold reduction in MAE against the uniform baseline.
- **Known pitfalls**:
  - A simulator from the same kernel family as a method inflates that method's accuracy.
  - Sparse sampling can disconnect the kNN graph and penalise methods unevenly.

### B3. Terminal marker consistency on annotated catalogue cells (proposed)

- **Goal**: check that confident fates point to terminal types whose marker programme is expressed, using author annotations held out from fitting. This is a consistency check, not a per-cell truth.
- **Ground truth**: held-out expert annotation. Terminal states come from one annotated subset, and marker sets for each terminal come from the author labels of a different held-out subset. The estimand is the marker-set enrichment for the terminal state assigned by $F$, over cells with $\max_j F_{ij}\ge 0.8$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue, annotated subset | singlet catalogue | scRNA-seq, multi-study; about 40% of 354M cells carry author annotations | internal | Terminal and evaluation annotations from different studies |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Marker enrichment AUROC | For each terminal $j$, AUROC separating the marker-set score of $j$ in cells assigned to $j$ from cells assigned elsewhere; mean over $j$; marker sets from held-out annotation only | maximise | primary | — |

- **Comparators**: uniform; pseudotime-nearest terminal; kNN majority of annotations.
- **Protocol**: choose studies that carry terminal annotations, and report coverage (the share of cells above 0.8) beside every metric.
- **Acceptance criterion**: proposed. Marker enrichment AUROC at least 0.80 on confidently assigned cells.
- **Known pitfalls**:
  - Marker sets often coincide with clustering features, so agreement can be circular.
  - High-confidence subsets are dominated by easy cells, which is why coverage is reported.

### P1. Performance and scaling

Measure wall time, peak memory and throughput at $10^4$, $10^5$ and $10^6$ cells, on CPU and CUDA, for `palantir`, `cellrank` and `waddington_ot`, with moscot couplings as the coupling-step comparator where time labels exist. Report time per $10^5$ cells with the fitted scaling exponent. Hold graph construction, knn 30, the terminal set and the thread count fixed, and time only the absorption or coupling step. Include a dense-inverse baseline at small $N$ only. Proposed acceptance: every call passes the section 5 checks for every cell.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `trajectory.root_identification`: Root or start-state identification
  - `trajectory.terminal_state_identification`: Initial and terminal state (macrostate) identification
  - `trajectory.pseudotime_ordering`: Pseudotime ordering along a lineage
  - `neighbors.neighbor_count_selection`: Choice of neighbour count k and graph stability
- **Feeds**:
  - `trajectory.branch_point_assignment`: Branch point localisation and cell-to-branch assignment
  - `trajectory.pseudotime_de`: Pseudotime-associated and lineage-specific differential expression
  - `lineage-tracing.clone_state_fate_bias_scoring`: Clone-state coupling and clonal fate-bias scoring
  - `lineage-tracing.clone_informed_fate_probability`: Clone-informed state-to-fate probability and transition-map inference
- **Reads**: `obsm/X_pca`, `obsp/connectivities`, `obs/pseudotime`, `obs/root_flag`, `uns/terminal_states`, `obs/day`
- **Writes**: `obsm/fate_probabilities`, `uns/fate_probabilities_columns`, `obs/fate_entropy`, `obs/fate_argmax`, `obs/absorption_time`
<!-- CHAINING:AUTO:END -->

## 10. Risks, pitfalls and open questions

- **Clonal truth.** LARRY access terms, accession, licence and species are unconfirmed, so B1 is deferred. Cell and clone counts and a timing claim for fate choice appear only in secondary summaries, which are unverified and not used. The filtering rule in B1 is a singlet definition, not a published one.
- **Excluded sources.** GPfates' posterior fate computation and terminal mapping are not specified here, so it is absent from the tables and enum. Wishbone is excluded: its probability output is unverified, and its scanpy wrapper returns hard integer labels. The CellRank v1 defaults are not given, and the 30-fold speed-up in the CellRank 2 documentation is not benchmarked. A diffusion-based branch-probability method has no confirmed source.
- **Code-level details.** The unbalanced objective in section 3 is the standard form. The objective WOT's solver minimises is not derived here. WOT row-normalises in `fates()`, while `pull_back` runs with `normalize=False`. The WOT command line declares `--tolerance` as an integer with default 1e-8, so fractional values fail to parse.
- **Method validation.** The validation experiments in [R2]–[R6] are not reproduced, so their accuracy claims are not restated here. No shared benchmark for probabilistic fate calls is established.
- **Benchmarks withheld.** A held-out-time composition benchmark is not defined for fate probabilities: the pull-back fixes fates at the final time, and forward mass transport to an interior time would test couplings rather than fates. A lineage-tree benchmark with descendant-leaf truth (TedSim, the Cassiopeia simulator, the DREAM lineage datasets) is withheld because licences, URLs and DOIs for those sources are unconfirmed, and simulators that generate both expression and lineage are circular.
- **First experiment.** Apply the B2 recipe at its smallest grid point to Palantir and CellRank 2 at defaults, and measure MAE, row-sum error and entropy correlation before any GPU work. Add B1 once LARRY terms are confirmed.

## 11. References

R1. Weinreb C, Wolock S, Tusi BK, Socolovsky M, Klein AM. Fundamental limits on dynamic inference from single-cell snapshots. *Proceedings of the National Academy of Sciences* 2018. doi:10.1073/pnas.1714723115 — verified (corpus)
R2. Setty M, Kiseliovas V, Levine J, Gayoso A, Mazutis L, Pe'er D. Characterization of cell fate probabilities in single-cell data with Palantir. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0068-4 — verified (corpus)
R3. Weiler P, Lange M, Klein M, Pe'er D, Theis F. CellRank 2: unified fate mapping in multiview single-cell data. *Nature Methods* 2024. doi:10.1038/s41592-024-02303-9 — verified (corpus)
R4. Lange M, Bergen V, Klein M, et al. CellRank for directed single-cell fate mapping. *Nature Methods* 2022. doi:10.1038/s41592-021-01346-6 — verified (corpus)
R5. Schiebinger G, Shu J, Tabaka M, et al. Optimal-transport analysis of single-cell gene expression identifies developmental trajectories in reprogramming. *Cell* 2019. doi:10.1016/j.cell.2019.01.006 — verified (corpus)
R6. Weinreb C, Rodriguez-Fraticelli A, Camargo FD, Klein AM. Lineage tracing on transcriptional landscapes links state to fate during differentiation. *Science* 2020. doi:10.1126/science.aaw3381 — verified (corpus)
R7. Saelens W, Cannoodt R, Todorov H, Saeys Y. A comparison of single-cell trajectory inference methods. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0071-9 — verified (corpus)
R8. La Manno G, Soldatov R, Zeisel A, et al. RNA velocity of single cells. *Nature* 2018. doi:10.1038/s41586-018-0414-6 — verified (corpus)
R9. Bergen V, Soldatov RA, Kharchenko PV, Theis FJ. RNA velocity: current challenges and future perspectives. *Molecular Systems Biology* 2021. doi:10.15252/msb.202110282 — verified (corpus)
R10. Chizat L, Peyré G, Schmitzer B, Vialard FX. Scaling algorithms for unbalanced optimal transport problems. *Mathematics of Computation* 2018. — verified (corpus)
R11. Cuturi M. Sinkhorn distances: lightspeed computation of optimal transport. *Advances in Neural Information Processing Systems* 2013. — verified (corpus)
R12. Reuter B, Weber M, Fackeldey K, Röblitz S, Garcia ME. Generalized Markov state modeling method for nonequilibrium biomolecular dynamics: exemplified on amyloid beta conformational dynamics driven by an oscillating electric field. *Journal of Chemical Theory and Computation* 2018. doi:10.1021/acs.jctc.8b00079 — verified (corpus)
R13. Farrell JA, Wang Y, Riesenfeld SJ, et al. Single-cell reconstruction of developmental trajectories during zebrafish embryogenesis. *Science* 2018. doi:10.1126/science.aar3131 — verified (corpus)
R14. Stassen SV, Yip GGK, Wong KKY, Ho JWK, Tsia KK. Generalized and scalable trajectory inference in single-cell omics data with VIA. *Nature Communications* 12 (2021), article 5528. doi:10.1038/s41467-021-25773-3 — verified (corpus)
R15. Klein D, Palla G, Lange M, et al. Mapping cells through time and space with moscot. *Nature* 2025. doi:10.1038/s41586-024-08453-2 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/dpeerlab/Palantir | Palantir development team (pyproject.toml) | MIT (LICENSE; pyproject.toml) | Absorbing chain, waypoint lift, pseudotime, defaults | port |
| https://github.com/theislab/cellrank | Marius Lange, Michal Klein, Philipp Weiler (pyproject.toml) | BSD-3-Clause (LICENSE; pyproject.toml) | Absorption solve, hard pseudotime kernel | port |
| https://github.com/broadinstitute/wot | WOT Team (setup.py) | BSD 3-Clause (LICENSE) | Unbalanced couplings, pull-back, defaults | port |
| https://github.com/theislab/moscot | Dominik Klein, Giovanni Palla, Michal Klein, Zoe Piran, Marius Lange (pyproject.toml) | BSD-3-Clause (LICENSE; pyproject.toml) | Time-course couplings for comparator use | callout |
| https://github.com/farrellja/URD | Jeffrey Farrell (DESCRIPTION) | GPL-3 (LICENSE; DESCRIPTION) | Visitation comparator | reimplement |
