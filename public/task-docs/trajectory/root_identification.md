---
id: trajectory.root_identification
title: Root or start-state identification
area: trajectory
scope: core
paradigm: heuristic
literature_status: contested
priority: P1
depends_on: [dim-reduction.normalized_cell_embedding, neighbors.approximate_knn_search, imputation.expression_denoising]
feeds: [trajectory.pseudotime_ordering, trajectory.branch_point_assignment, trajectory.fate_probability]
reads: [layers/counts, layers/imputed, obsm/X_pca, obsp/connectivities, obs/cluster]
writes: [obs/root_score, obs/potency_score, obs/root_flag, uns/root, uns/root_candidates]
devices: [cpu, cuda]
mcp_tool: singlet_trajectory_root_identification
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Root or start-state identification

> Chooses the source cell or cluster of a developmental process, which fixes the origin and direction of pseudotime. The default is an anchored choice that is cross-checked against potency and graph criteria.

## 1. Question

Which cell or cluster is the source (progenitor) state of the process, so that pseudotime starts at the origin and points in the right direction? Inputs are an embedding and a kNN graph, counts for a gene-count potency score, optional cluster labels, and an optional anchor cell or cluster. Outputs are ranked root candidates and one selected root cell with its cluster. A correct answer is a cell of the source state, as defined by the benchmarks in section 8.

## 2. Why this task matters and where the field stands

Every pseudotime, branch and fate estimate needs an origin, and most tools take it as an input rather than inferring it. DPT takes a root index [R1], Palantir an early cell [R2], Monocle 2 a root state [R3], Slingshot a start cluster [R4] and scFates a fork or per-cell key [R5]. An orientation error reverses branch-specific ordering, so the root choice shapes every later result.

The status is **contested**. No shared benchmark scores root choice itself. The dynbenchmark study supplies the start cell as a prior and scores downstream trajectories, and it reports accuracy across trajectory types [R6]. The single-cell best-practices pseudotime chapter prefers prior biology: DPT pseudotime was inflated in the HSC_1 and HSC_2 clusters, which prior knowledge places at the start, so the authors kept the Palantir pseudotime.

Open problems: (i) gene-count potency scores [R7] have not been validated against independent progenitor truth in a shared benchmark; (ii) one root cannot represent several origins, parallel progenitor pools or cycles; (iii) some default roots are arbitrary, as the Monocle 2 diameter endpoint shows; (iv) velocity-based direction depends on kinetic assumptions that are questioned [R8].

## 3. Theory and insight

Cells $i=1,\dots,n$ have counts $x_{ig}$, gene count $n_i=\#\{g:x_{ig}>0\}$, an embedding $\mathbf{x}_i$ and a kNN graph. A root method scores candidate cells $C$ with $q_i$ and selects $r=\arg\max_{i\in C}q_i$, or the argmin when the extreme is the minimum. Pseudotime from the root is a distance $t_i=d(r,i)$.

Estimands, one sentence each:

- **Root hit**: $\mathbf{1}[r\in S_0]$ for the source population $S_0$, a binary value per method and dataset with no normalisation.
- **Potency score**: $q_i$ rescaled to $[0,1]$ over all cells of the dataset; only the ranks of $q$ select the root.
- **Pseudotime**: $t_i$ rescaled to $[0,1]$ over all cells, so it measures position along the process rather than absolute distance.
- **Generation index** $g_i$: the integer number of transitions from the source state; defined only in simulation.
- **Fate multiplicity**: the integer count of distinct terminal labels among cells that share a barcode with the root.

Diffusion pseudotime uses
$$D_t(x,y)^2=\sum_{l\ge 2}\lambda_l^{2t}\big(\psi_l(x)-\psi_l(y)\big)^2,\qquad t_i=D_t(r,i),$$
with eigenpairs $(\lambda_l,\psi_l)$ of the Markov matrix built on the kNN graph; $\lambda_1=1$ and its constant $\psi_1$ are excluded [R1]. The regime is a connected sparse graph, moderate $t$, leading components that carry the process, and a single source state $r$.

Palantir identifies terminal states as absorbing states of its Markov chain [R2]. Absorption probabilities follow from
$$B=(I-Q)^{-1}R,$$
where $Q$ and $R$ are the transient-to-transient and transient-to-terminal blocks. The regime is that every transient state reaches a terminal state. The root enters through shortest-path pseudotime, not through $B$.

The gene-count score used by CellRank is
$$\mathrm{CT}_i=\frac{1}{|G^\ast|}\sum_{g\in G^\ast}\hat x_{ig},$$
where $G^\ast$ holds the top genes by positive correlation with $n$, and $\hat x$ is an imputed layer [R7, R9]. It assumes that differentiated cells express fewer genes. Depth, RNA content and the imputation choice all change the ranking.

Steady-state splicing kinetics give $u_g/s_g=\gamma_g/\beta_g$ at equilibrium and a velocity $v_g=\beta_g\big(u_g-\tfrac{\gamma_g}{\beta_g}s_g\big)$, for unspliced $u_g$ and spliced $s_g$ [R10]. The root direction is read from the sign of $v$. The regime is constant rates, a common splicing rate and equilibrium. The dynamical model removes the equilibrium and shared-rate assumptions but keeps constant rates [R11]. Velocity is a local direction, so a root drawn from it is valid only where these assumptions hold [R8].

With $\texttt{root\_state}=\texttt{NULL}$, Monocle 2 sets the root to the first endpoint of the longest path (diameter) of its spanning tree, and to the last endpoint when reverse is TRUE [R3]. The orientation then follows the tree labelling, not biology.

The dynbenchmark correlation is
$$\rho=\max\!\Big(0,\ \mathrm{Spearman}\big(\mathrm{vec}\,G^{\mathrm{ref}},\ \mathrm{vec}\,G^{\mathrm{pred}}\big)\Big),$$
computed over pairs of waypoint cells, where $G$ holds geodesic distances; $\rho=0$ when either matrix is constant [R6]. Its estimand is agreement of topology and position. Because $G$ is symmetric, reversing a trajectory leaves $\rho$ unchanged, so this score cannot detect a wrong root.

Assumptions: a single source state is present or named by the user; potency falls along the process; gene counts track potency rather than depth or cell cycle; the graph has a true end at the source. Failure modes: sampling that begins after commitment, rare progenitor pools, several origins, cell-cycle or stress programs that raise gene counts, and default roots that are tree endpoints.

Insight: root identification is an orientation problem, and orientation is invisible to any score built on undirected distances, so topology benchmarks say little about the root. Orientation needs root-specific truth such as progenitor labels, clonal fate or generation index. Anchored roots, marker choices and diffusion extremes are cheap and interpretable, but each encodes an assumption. A model-based root, such as a calibrated posterior over candidates, reports uncertainty and disagreement, but no benchmark yet tests whether its calibration improves the root. A prior start cell in a benchmark also leaks the answer into the score, so the dynbenchmark protocol measures downstream sensitivity rather than identification [R6].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Anchored root (prior start cell, markers, earliest timepoint) | heuristic | The analyst or sample metadata names the source, which is passed as the origin | [R6] |
| DPT root index or diffusion extreme | heuristic | Diffusion pseudotime from a root cell; the root is a user index or an extreme of a diffusion component | [R1] |
| Palantir early cell | hybrid | Early cell mapped to the nearest boundary cell; shortest-path pseudotime; absorbing chain for fates | [R2] |
| CytoTRACE-style gene-count score (CellRank kernel) | heuristic | Mean imputed expression of genes correlated with genes per cell; the highest score marks the source | [R7, R9] |
| Monocle 2 root state or diameter endpoint | heuristic | Root in a named principal-graph state, or the diameter endpoint by default | [R3] |
| Slingshot start cluster | heuristic | An optional root cluster label, one per disconnected component, roots the lineages on the minimum spanning tree over clusters | [R4] |
| scFates root key | heuristic | A fork id or per-cell key; the node with the extreme weighted average is the root | [R5] |

The published standard is an anchored root, a prior start cell as in the best-practices pseudotime chapter, with DPT or Palantir as the pseudotime engine. The common data-driven choices are the Monocle 2 default and the gene-count score. Rows cover only methods whose source code or primary paper was checked; section 10 lists the exclusions.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| DPT (scanpy) | iroot | none; a warning is issued and the tip search then starts from cell 0 | _dpt.py:122–128, 284–285 @ 8ed52d9 |
| DPT (scanpy) | branch tip | argmax of distances from iroot | _dpt.py:283 @ 8ed52d9 |
| Palantir | knn | 30 | core.py:67 @ f819d51 |
| Palantir | num_waypoints | 1200; raised to max(3, number of components) when smaller | core.py:68, 280–287 @ f819d51 |
| Palantir | scale_components | True | core.py:70 @ f819d51 |
| Palantir | use_early_cell_as_start | False; start is the nearest boundary cell | core.py:71, 192–194 @ f819d51 |
| Palantir | max_iterations | 25 | core.py:72 @ f819d51 |
| Palantir | seed | 20 | core.py:79 @ f819d51 |
| Palantir | early_cell | must be an obs name, otherwise an error | core.py:167–172 @ f819d51 |
| CellRank CytoTRACE kernel | layer | imputed | _cytotrace_kernel.py:113 @ d7821af |
| CellRank CytoTRACE kernel | aggregation | mean | _cytotrace_kernel.py:114 @ d7821af |
| CellRank CytoTRACE kernel | use_raw | False | _cytotrace_kernel.py:115 @ d7821af |
| CellRank CytoTRACE kernel | n_genes | 200 | _cytotrace_kernel.py:116 @ d7821af |
| Monocle 2 orderCells | root_state | NULL | order_cells.R:1064 @ 7df1050 |
| Monocle 2 orderCells | reverse | NULL, treated as FALSE | order_cells.R:1015–1019, 1066 @ 7df1050 |
| Slingshot | start.clus | optional (NULL); when set, must match a cluster label | AllClasses.R:31, 154–156 @ 3fa552f |
| scFates root | min_val | False; argmax of node-weighted averages | root.py:90–95 @ 8d8c0e6 |

## 5. Proposed singlet approach

Routes: DPT root index and diffusion extreme are ported; Palantir early cell is ported; the CytoTRACE-style score is ported; Monocle 2, Slingshot and scFates are callouts used only as comparators; the dynbenchmark correlation is reimplemented from its formula.

**Default.** The default method is manual. With no anchor the tool raises an error rather than choosing a root, and the agent asks the user for a cell or a cluster. Automatic methods are available on request and are always reported beside the anchor: the output writes the ranked candidates, the potency score and a cluster agreement, the share of cross-check roots that fall in the selected root's cluster, so disagreement stays visible. Orientation is checked only on the selected root.

**Ports.** The Palantir port uses the shared kNN graph from neighbors.approximate_knn_search, so the knn default in section 4 does not apply. Its only randomness is waypoint sampling, set by seed.

**Model-based formulation (proposed).** A posterior $p(r=i\mid f_i)$ over candidate cells, where $f_i$ holds the potency score, the diffusion-extreme score and the distance to the anchor. A small multilayer perceptron in PyTorch is trained on author-annotated progenitor and differentiated cells from the catalogue, with splits by study and temperature scaling for calibration. It becomes the default only if B2 and B4 meet their criteria. It is falsified if B2 root hits fall below the B2 criterion, or if generation_spearman in B4 falls below its criterion on held-out simulated datasets.

**Stack.** PyTorch for the posterior model. Hard-coded CUDA or cuSPARSE kernels for the small hot operations: per-cell nonzero counts, sparse products for gene-count correlation, top-k means, and power iteration on the sparse transition matrix. Dijkstra on the kNN graph stays on the CPU. CPU and CUDA outputs must agree to a documented floating-point tolerance.

**Scale.** Count statistics stream in row chunks, but the kNN graph is held in memory, so the tool is not streaming. Root selection after the graph is O(n). Agents use the defaults in section 6 and ask for an anchor when none is given.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts; gene counts per cell |
| read | layers/imputed | sparse float32 | imputed expression for the CytoTRACE-style score |
| read | obsm/X_pca | float32, n by d | embedding for medoid anchoring and diffusion |
| read | obsp/connectivities | sparse float32 | kNN graph for diffusion and shortest paths |
| read | obs/cluster | categorical | anchor cluster labels |
| write | obs/root_score | float32 | per-cell root candidate score, rescaled to [0,1] |
| write | obs/potency_score | float32 | CytoTRACE-style score, rescaled to [0,1] |
| write | obs/root_flag | bool | true for the selected root cell |
| write | uns/root | dict | method, root cell, root cluster, cluster agreement, parameters |
| write | uns/root_candidates | table | ranked top candidates with score and cluster |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `root_method` | string | "manual" | `manual`, `dpt_extreme`, `palantir_early`, `cytotrace` | Root method. manual anchors on root_cell or root_cluster; palantir_early needs root_cell; dpt_extreme and cytotrace choose from the data. |
| `root_cell` | string | — | — | Obs name of an anchor cell: the root for manual, the early cell for palantir_early. |
| `root_cluster` | string | — | — | Obs label of an anchor cluster; its medoid cell in PCA space becomes the root for manual. |
| `n_root_candidates` | integer | 5 | min 1 | Number of ranked root candidates written to uns/root_candidates. |
| `cytotrace` | object | — | — | CytoTRACE-style gene-count potency score, also computed as a cross-check for every method. |
| `cytotrace.layer` | string | "imputed" | — | Expression layer for the gene-correlation score; CellRank default. |
| `cytotrace.aggregation` | string | "mean" | `mean`, `median`, `hmean`, `gmean` | Aggregation over the top correlated genes. |
| `cytotrace.n_genes` | integer | 200 | min 1 | Number of top positively correlated genes averaged into the score. |
| `palantir` | object | — | — | Palantir early-cell options, used by palantir_early only. |
| `palantir.use_early_cell_as_start` | boolean | false | — | Start from root_cell itself rather than the nearest boundary cell. |
| `palantir.max_iterations` | integer | 25 | min 1 | Maximum iterations of pseudotime refinement. |
| `dpt` | object | — | — | Diffusion-extreme options, used by dpt_extreme only. |
| `dpt.component` | integer | 1 | min 1 | Diffusion component index used to pick the extreme cell; index 0 is trivial and excluded. |
| `dpt.extreme` | string | "min" | `min`, `max` | Take the minimum or maximum of the chosen component as the root. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for Palantir waypoint sampling; the other methods are deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

The root_method decides which parameters apply: root_cell and root_cluster for manual, root_cell for palantir_early, dpt for dpt_extreme, and cytotrace for cytotrace. The cytotrace block also sets the potency cross-check written to obs/potency_score for every method. The tool raises an error for a missing anchor, for a root_cell that is not an obs name, and for a root_cluster that is not a label of obs/cluster; there is no silent fallback. The palantir block applies only to palantir_early.

## 7. MCP tool

Tool name `singlet_trajectory_root_identification` (definition in `tasks/mcp/singlet_trajectory_root_identification.json`). Example call and compact result, with illustrative values:

```json
{"dataset": "example.singlet", "root_method": "manual", "root_cluster": "HSC_1", "n_root_candidates": 3}
```

```json
{
  "dataset": "example.singlet",
  "status": "completed",
  "wrote": ["obs/root_score", "obs/potency_score", "obs/root_flag", "uns/root", "uns/root_candidates"],
  "summary": {
    "root_method": "manual",
    "root_cell": "cell_0412",
    "root_cluster": "HSC_1",
    "candidates": [{"cell": "cell_0412", "score": 1.0, "cluster": "HSC_1"}],
    "cluster_agreement": 0.67
  },
  "provenance_id": "prov_0001"
}
```

Long-running: no; the cost sits in the graph built upstream. Stochastic: yes, and only through the Palantir waypoint seed. Dry run returns estimated seconds, peak memory and device from the number of cells and graph nonzeros.

## 8. Benchmarks

**Shared protocol.** Every method receives the same counts, the same PCA embedding and the same kNN graph, with the neighbour count set by neighbors.neighbor_count_selection. Each method uses its default parameters from section 4 unless a benchmark says otherwise. The root is chosen without any ground-truth label, and ties in candidate ranking go to the top-ranked candidate. Subsampling uses seeds 0 to 9. Where progenitor labels are used, the anchor markers must be disjoint from the markers that define those labels.

### B1. Start-cell sensitivity on dynbenchmark datasets

- **Goal**: measure how much a start-accepting trajectory method changes when the start cell moves within the source milestone.
- **Ground truth**: planted reference milestone networks for synthetic data and expert-assigned milestones for real data. The truth matrix per dataset holds geodesic distances between waypoint cells on the reference network, compared by rank and so not rescaled. The prior start cell is the cell closest in geodesic distance to the milestone with only outgoing edges, with ties broken at random and a random cell for cyclic datasets [R6; manuscript/paper.Rmd:339 @ 3d8bd6c].

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| dynbenchmark module-network datasets | [R6]; generator at paper.Rmd:476 | simulated scRNA-seq; —; — | known milestone network |
| dynbenchmark real GEO datasets | [R6]; keyword query of GEO at paper.Rmd:433 | scRNA-seq from sampled stages; —; — | some split into connected components |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| correlation | Spearman correlation of flattened waypoint geodesic-distance matrices, clipped at 0 (formula in section 3; dyneval calculate_metrics.R:48–85 @ daeb26a) | maximise | primary | [R6] |
| sensitivity | absolute change in correlation from the prior start cell to each alternative | minimise | primary | — |

- **Comparators**: the start-accepting methods of the dynbenchmark harness.
- **Protocol**: for each dataset, the prior start cell and 10 alternative start cells drawn uniformly from cells of the source milestone, with seeds 0 to 9; each method is applied with each start cell and sensitivity is computed per method.
- **Acceptance criterion**: proposed, not from the literature: each alternative start cell changes the correlation by at most 0.05. The threshold is to be set on a development subset before the benchmark is fixed.
- **Known pitfalls**: correlation is invariant to reversal (section 3), so a flipped root scores as correct; the benchmark measures downstream sensitivity, not identification.

### B2. Known-progenitor concordance on annotated atlases

- **Goal**: test whether a method's root lies in a population that expert annotation marks as progenitor, without using those labels.
- **Ground truth**: expert labels. The per-cell label is 1 for the HSC_1 and HSC_2 clusters, which the best-practices chapter treats as the beginning of the process, and 0 otherwise. The root-hit estimand is the indicator that the selected root cell carries label 1, with ties resolved to the top-ranked candidate. The rank fraction is the share of label-1 cells whose DPT rank from the selected root lies in the earliest 10% of cells, with rank 1 for the root.

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Adult human bone marrow analysed in the best-practices pseudotime chapter | [R2]; Palantir sample notebook linked from the chapter | human bone marrow scRNA-seq; —; — | labels as in the ground-truth line |
| singlet catalogue, author-annotated subset | internal catalogue | uniformly processed; —; 354M cells, about 40% annotated | label set fixed before scoring |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| root_hit | 1 if the selected root carries a progenitor label, averaged over subsamples | maximise | primary | — |
| progenitor_rank_fraction | rank share defined in the ground truth above | maximise | guardrail | [R1] |

- **Comparators**: the manual anchor on markers disjoint from the labelling markers, the CytoTRACE-style root, the DPT extreme root and the Palantir early-cell root.
- **Protocol**: 10 random subsamples of 50% of cells, seeds 0 to 9; the progenitor count is reported for each subsample; pseudotime for the rank fraction is DPT from the selected root.
- **Acceptance criterion**: proposed, not from the literature: root_hit equals 1 in at least 9 of 10 subsamples for a method on a dataset.
- **Known pitfalls**: circularity when the anchor markers also define the labels; subsampling can remove the progenitor pool, so counts are reported.

### B3. Lineage-barcode fate multiplicity

- **Goal**: test whether a root candidate's clone spans several terminal fates, a progenitor signature.
- **Ground truth**: orthogonal clonal barcodes. Each barcode groups cells whose terminal fate labels come from the dataset annotation. The estimand for the selected root is the integer number of distinct terminal labels among cells that share its barcode. Clone coverage is the fraction of barcoded clones that contain at least one candidate; neither quantity is normalised.

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Weinreb et al. 2020 lineage-barcode scRNA-seq, as cited in the best-practices lineage chapter | [R12] | scRNA-seq with clonal barcodes; —; — | see section 10 |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| fate_multiplicity | distinct terminal labels among cells sharing the selected root's barcode | maximise | primary | [R12] |
| clone_coverage | fraction of barcoded clones that contain at least one root candidate | maximise | guardrail | [R12] |

- **Comparators**: the root methods of B2.
- **Protocol**: each method is applied once with default parameters; the fraction of selections with fate_multiplicity of at least 2 is reported.
- **Acceptance criterion**: proposed, not from the literature: at least 80% of root selections have fate_multiplicity of at least 2.
- **Known pitfalls**: barcode collisions and noisy fate labels; clonal and transcriptional progenitors need not coincide.

### B4. Planted branching simulation with known generation index

- **Goal**: test root identification where each cell's generation index is known.
- **Ground truth**: the simulator's generation index $g_i$, the number of transitions from the source node. Estimands: generation_spearman, the Spearman correlation across cells between $q_i$ (rescaled to $[0,1]$) and $g_i$; and root_generation_zero, the indicator $g_r=0$.
- **Generator recipe (proposed)**:
  1. Build a rooted binary tree of depth $d\in\{2,3\}$.
  2. Draw each cell's node with weights that decay with depth; $g_i$ is that node's depth.
  3. For gene $g$, set $\mu_{ig}=\exp(\beta_g+\mathbf{w}_g^{\top}\mathbf{z}_{v(i)})$, with random node vectors $\mathbf{z}_v$ of dimension 3 and $v(i)$ the node of cell $i$.
  4. Draw $x_{ig}\sim\mathrm{NB}(\ell_i\mu_{ig},\phi)$ with $\phi=0.2$ and log-normal size factors $\ell_i$ of scale in $\{0.2, 1.0\}$.
  5. Add a cell-cycle term to 5% of genes for a random 30% of cells.
  6. Use 5,000 cells and 2,000 genes per dataset, with seeds 0 to 9; the root set is $\{g_i=0\}$.

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Simulated datasets from recipe steps 1 to 6 | singlet recipe; module-network design as in [R6] | simulated scRNA-seq counts; —; 5,000 cells by 2,000 genes | 2 depths by 2 size-factor scales by 10 seeds, 40 datasets |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| generation_spearman | Spearman correlation over cells between $q_i$ and $g_i$ | maximise | primary | — |
| root_generation_zero | 1 if the selected root has $g=0$ | maximise | primary | — |

- **Comparators**: the CytoTRACE-style root, the DPT extreme root with its default component, and an oracle anchor on a random generation-0 cell (root_generation_zero only).
- **Protocol**: depth and size-factor scale form the grid; every method is applied to every dataset.
- **Acceptance criterion**: proposed, not from the literature: generation_spearman of at least 0.8, and root_generation_zero equal to 1 for at least 90% of datasets.
- **Known pitfalls**: the simulator encodes the potency assumption, so success is weak evidence on real data; depth confounding must be in the design (steps 4 and 5).

### P1. Performance and scaling

Wall time and peak memory for the root step and for the graph step, reported separately, at 10,000, 100,000 and 1,000,000 cells, on CPU and CUDA, against DPT (scanpy), Palantir and the CellRank CytoTRACE kernel. Hold fixed the neighbour count, the number of principal components, the layer and the hardware. Root selection after the graph is O(n), so P1 reports the graph and root steps separately. Dynbenchmark scaled its datasets from 10 to 100,000 cells (paper.Rmd:685) [R6]. Streaming is not claimed, so 10 million cells is out of scope. No acceptance threshold is set; the output is a cost table. Peak memory is compared against the dynbenchmark cap only after the conflict in section 10 is resolved.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `imputation.expression_denoising`: Expression denoising, posterior expression estimation and dropout imputation of UMI counts
- **Feeds**:
  - `trajectory.pseudotime_ordering`: Pseudotime ordering along a lineage
  - `trajectory.branch_point_assignment`: Branch point localisation and cell-to-branch assignment
  - `trajectory.fate_probability`: Cell-fate probability estimation
- **Reads**: `layers/counts`, `layers/imputed`, `obsm/X_pca`, `obsp/connectivities`, `obs/cluster`
- **Writes**: `obs/root_score`, `obs/potency_score`, `obs/root_flag`, `uns/root`, `uns/root_candidates`
<!-- CHAINING:AUTO:END -->

Part of the trajectory workflow: anchor the origin, order cells by pseudotime, then localise branches and fates. No named recipe is defined for it yet.

## 10. Risks, pitfalls and open questions

- **Not covered.** Monocle 3 root selection, scVelo root handling, CellRank initial-state code beyond one error message, TSCAN entropy, the original CytoTRACE code and the CytoTRACE 2 benchmark numbers do not appear in the tables or the enum. Palantir fate probabilities and waypoint refinement are described only up to start-cell selection. No accession is given for the Setty bone-marrow or Weinreb lineage datasets, and the Weinreb species is not stated.
- **Source conflicts.** The dynbenchmark memory cap is 16 GB at paper.Rmd:681 and 10 GB at paper.Rmd:688.
- **Excluded comparators and tests.** Entropy-based potency proxies [R13, R14] are excluded because their implementations are not covered here. The time-stamped reprogramming test [R15] is excluded because reprogramming may not be monotone in time. A velocity-direction simulation is excluded because the velocity root code is not covered.
- **Unsettled literature.** No benchmark scores root choice. A single root cannot represent several origins, parallel progenitor pools or cycles. Clonal and transcriptional progenitor definitions can disagree, so B2 and B3 are reported side by side and neither is treated as truth.
- **Data risks.** Dataset terms for B1 to B4 are not recorded in the tables and must be checked before use. The catalogue's author annotations (about 40% of 354M cells) have not been inspected, so B2's progenitor labels may be coarse. The CytoTRACE 2 terms in section 12 prevent porting.
- **Model and first experiment.** The posterior has no designed calibration metric or threshold yet, and the labels used to train it must come from different studies from those used to score it. First experiment: apply B2 to the bone-marrow dataset with the four root methods over ten subsamples; the result decides whether a learned posterior is worth building.

## 11. References

R1. Haghverdi L, Büttner M, Wolf FA, Buettner F, Theis FJ. Diffusion pseudotime robustly reconstructs lineage branching. *Nature Methods* 2016. doi:10.1038/nmeth.3971 — verified (corpus)

R2. Setty M, Kiseliovas V, Levine J, et al. Characterization of cell fate probabilities in single-cell data with Palantir. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0068-4 — verified (corpus)

R3. Qiu X, Mao Q, Tang Y, et al. Reversed graph embedding resolves complex single-cell trajectories. *Nature Methods* 2017. doi:10.1038/nmeth.4402 — verified (corpus)

R4. Street K, Risso D, Fletcher RB, et al. Slingshot: cell lineage and pseudotime inference for single-cell transcriptomics. *BMC Genomics* 2018. doi:10.1186/s12864-018-4772-0 — verified (corpus)

R5. Faure L, Soldatov R, Kharchenko PV, Adameyko I. scFates: a scalable python package for advanced pseudotime and bifurcation analysis from single cell data. *Bioinformatics* 2022. doi:10.1093/bioinformatics/btac746 — verified (repo)

R6. Saelens W, Cannoodt R, Todorov H, Saeys Y. A comparison of single-cell trajectory inference methods. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0071-9 — verified (corpus)

R7. Gulati GS, Sikandar SS, Wesche DJ, et al. Single-cell transcriptional diversity is a hallmark of developmental potential. *Science* 2020. doi:10.1126/science.aax0249 — verified (corpus)

R8. Bergen V, Soldatov RA, Kharchenko PV, Theis FJ. RNA velocity—current challenges and future perspectives. *Molecular Systems Biology* 2021. doi:10.15252/msb.202110282 — verified (corpus)

R9. Lange M, Bergen V, Klein M, et al. CellRank for directed single-cell fate mapping. *Nature Methods* 2022. doi:10.1038/s41592-021-01346-6 — verified (corpus)

R10. La Manno G, Soldatov R, Zeisel A, et al. RNA velocity of single cells. *Nature* 2018. doi:10.1038/s41586-018-0414-6 — verified (corpus)

R11. Bergen V, Lange M, Peidli S, Wolf FA, Theis FJ. Generalizing RNA velocity to transient cell states through dynamical modeling. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0591-3 — verified (corpus)

R12. Weinreb C, Rodriguez-Fraticelli A, Camargo FD, Klein AM. Lineage tracing on transcriptional landscapes links state to fate during differentiation. *Science* 2020. doi:10.1126/science.aaw3381 — verified (corpus)

R13. Grün D, Muraro MJ, Boisset JC, et al. De novo prediction of stem cell identity using single-cell transcriptome data. *Cell Stem Cell* 2016. doi:10.1016/j.stem.2016.05.010 — verified (corpus)

R14. Teschendorff AE, Enver T. Single-cell entropy for accurate estimation of differentiation potency from a cell's transcriptome. *Nature Communications* 2017. doi:10.1038/ncomms15599 — verified (corpus)

R15. Schiebinger G, Shu J, Tabaka M, et al. Optimal-transport analysis of single-cell gene expression identifies developmental trajectories in reprogramming. *Cell* 2019. doi:10.1016/j.cell.2019.01.006 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | Ilan Gold, Philipp Angerer, Severin Dicks (maintainers, pyproject.toml) | BSD-3-Clause (LICENSE) | DPT root index, iroot and tip logic | port |
| https://github.com/dpeerlab/Palantir | Palantir development team (pyproject.toml); copyright Dana Pe'er Lab (LICENSE) | MIT (LICENSE) | early-cell start selection and shortest-path pseudotime | port |
| https://github.com/scverse/cellrank | Marius Lange, Philipp Weiler (maintainers, pyproject.toml) | BSD-3-Clause (LICENSE) | gene-count potency kernel | port |
| https://github.com/cole-trapnell-lab/monocle-release | Cole Trapnell (DESCRIPTION) | Artistic-2.0 (DESCRIPTION; no LICENSE file) | root_state and diameter default root | callout |
| https://github.com/kstreet13/slingshot | Kelly Street (aut, cre, cph) and others (DESCRIPTION) | Artistic-2.0 (DESCRIPTION) | start.clus root cluster | callout |
| https://github.com/LouisFaure/scFates | Louis Faure, Ruslan Soldatov, Peter V. Kharchenko, Igor Adameyko (README) | BSD-3-Clause (LICENSE) | principal-graph root key | callout |
| https://github.com/dynverse/dynbenchmark | Robrecht Cannoodt, Wouter Saelens (LICENSE.md copyright holders) | MIT (LICENSE.md; LICENSE holds only the year and copyright lines) | start-cell rule, module networks, B1 harness | callout |
| https://github.com/dynverse/dyneval | Robrecht Cannoodt (aut, cre) and others (DESCRIPTION) | GPL-3 (DESCRIPTION) | correlation metric for B1 | reimplement (formula only) |
| https://github.com/digitalcytometry/cytotrace2 | — | Stanford Non-Commercial Software License Agreement (LICENSE) | learned potency model; cited, not benchmarked here | callout (no port; non-commercial terms) |
