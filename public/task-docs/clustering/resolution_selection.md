---
id: clustering.resolution_selection
title: Choosing clustering resolution without reference labels
area: clustering
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [clustering.cell_partitioning, neighbors.approximate_knn_search, neighbors.neighbor_count_selection, dim-reduction.pc_number_selection]
feeds: [annotation.cluster_label_assignment, markers-de.cluster_marker_ranking, clustering.cluster_stability]
reads: [obsm/<embedding_key>, obsp/<graph_key>_connectivities, obs/<labels_key>, uns/<graph_key>/params]
writes: [obs/<output_key>, obs/<output_key>_res_<r>, uns/<output_key>/resolution_summary, uns/<output_key>/selection, obsp/<output_key>_coclust]
devices: [cpu, cuda]
mcp_tool: singlet_clustering_resolution_selection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Choosing clustering resolution without reference labels

> Selects one resolution from a sweep over an existing cell graph when no reference labels exist, by default with the chooseR subsample co-clustering rule, and always returns the full sweep so the choice can be inspected; no label-free rule has been validated across datasets.

## 1. Question

Given a weighted kNN or shared-nearest-neighbour graph on $n$ cells, a cell embedding and a grid $\mathcal{R}$ of resolution values, which single $\gamma^\star\in\mathcal{R}$ gives the partition at a biologically meaningful granularity when no reference labels exist? The outputs are the chosen resolution, its partition, one partition per grid value and a per-resolution summary of cluster counts, silhouette and robustness scores. There is no direct ground truth: a choice is judged against the criterion it optimises (agreement with labels, recovery of planted groups, reproducibility under subsampling), and these criteria disagree.

## 2. Why this task matters and where the field stands

Marker testing, annotation and composition analysis all treat a partition as their unit, and every partition is produced at some resolution. The two most used toolkits ship different default values (Section 4); they are conventions, not selection rules. Resolution is the scale parameter of a graph-partition objective [R3][R4], not an estimand with a true value, so choosing it needs a criterion outside the objective.

The status is **contested**. The algorithms are routine; unresolved is which criterion defines granularity.

- The criteria disagree. Silhouette, subsample stability and label agreement encode different ideas of a meaningful partition, and values do not transfer between graphs because neighbour count, principal components, normalisation and integration rescale the parameter.
- Label-based scores are optimistic when used for selection: scIB picks each method's resolution by agreement with the reference labels and then reports that agreement [R2].
- Practice differs by source. OSCA calls silhouette maximisation the simplest sweep strategy and any automatic choice a suggestion rather than a rule [R9]; chooseR proposes subsample co-clustering robustness with a threshold [R10]; clustering trees are a visual tool [R7]; reviews discuss the difficulty [R1].
- No dataset-independent rule has been validated against held-out ground truth across datasets.
- A stable partition can be poorly separated, and bootstrap stability ignores batch and donor effects [R9].
- A single resolution assumes one scale; nested populations need a multi-scale output such as a clustering tree [R7].
- The sensitivity of the chooseR threshold to the grid and the subsampling configuration is not quantified in the cited sources, and cell-type-number benchmarks [R14] address a different target.

## 3. Theory and insight

### 3.1 Objectives and optimisers

Resolution is a parameter of a quality function with no generative model. Louvain [R4] alternates local moves of cells with aggregation of communities; Leiden [R3] extends it and guarantees well-connected communities. Neither guarantees the global optimum, so the seed is part of the output.

For a symmetric graph with weights $A_{ij}\ge 0$, degrees $s_i=\sum_j A_{ij}$ and total weight $m=\tfrac12\sum_{i,j}A_{ij}$, resolution-parameterised modularity is

$$Q_\gamma(c)=\frac{1}{2m}\sum_{i,j}\Big[A_{ij}-\gamma\,\frac{s_i s_j}{2m}\Big]\delta(c_i,c_j),$$

with $\gamma=1$ the Newman–Girvan modularity; it underlies scanpy's default (`RBConfigurationVertexPartition`, up to the $1/2m$ factor) and Seurat's Louvain. The null term scales with $m$: at $\gamma=1$ modularity optimisation can fail to resolve modules below a scale set by the network size and the modules' interconnectedness [R5] (used qualitatively here), so one $\gamma$ means different granularities on graphs of different size or density. Each null-model term is non-negative, so $Q_\gamma(c)$ and its maximum over $c$ are non-increasing in $\gamma$: the argmax of the optimised objective over a grid is the smallest $\gamma$ and is not a selection rule.

The constant Potts model (CPM) replaces the degree null by a constant,

$$H_\gamma(c)=\sum_{k}\Big[m_k-\gamma\binom{n_k}{2}\Big],$$

with $m_k$ the internal edge weight and $n_k$ the cell count of community $k$ (unit node sizes, the leidenalg default). At an optimum, communities have internal density at least $\gamma$ and external density at most $\gamma$, a threshold independent of graph size, which is the property behind resolution-limit-free detection [R6]. For connectivities with weights at most 1, every $\gamma>1$ makes each multi-cell community contribute negatively, so the optimum is all singletons and the modularity grid does not transfer to CPM. CPM on kNN graphs is not benchmarked in the cited sources.

### 3.2 Criteria and estimands

**Silhouette.** With $a(i)$ the mean dissimilarity of cell $i$ to the other cells of its cluster and $b(i)$ the smallest mean dissimilarity to any other cluster,

$$s(i)=\frac{b(i)-a(i)}{\max\{a(i),b(i)\}}\in[-1,1],$$

with $s(i)=0$ for singleton clusters; $\bar s_k$ is the mean of $s(i)$ over cluster $k$. Heterogeneous clusters raise $a(i)$ and over-split neighbours lower $b(i)$, so it reacts to under- and over-clustering, but it can penalise sensible partitions of continuous gradients [R9].

**Co-clustering frequency.** Cluster $B$ subsamples $S_t$, each a fraction $f$ of the cells drawn without replacement, at one resolution, giving labels $c^{(t)}$:

$$M_{ij}=\frac{\#\{t:\ i,j\in S_t,\ c^{(t)}_i=c^{(t)}_j\}}{\#\{t:\ i,j\in S_t\}}\in[0,1],\qquad D_{ij}=1-M_{ij}.$$

The chooseR code divides by the number of subsamples containing both cells and sets $M_{ij}=0$ for pairs that never match (Section 4). A pair appears together in about $f^2B$ subsamples, so $M_{ij}$ has binomial sampling error at most $0.5/\sqrt{f^2B}$ (large $n$, subsamples independent given the data), about 0.06 at $f=0.8$, $B=100$.

**The chooseR rule as implemented.** For each grid value $r$, let $c_r$ be the clustering of all cells, with $K_r$ clusters, and $\bar s_k$ the mean silhouette of its cluster $k$ computed on $D$. Let $\mathrm{med}_r$ be the median of the $\bar s_k$ over clusters and $\ell_r$ the lower end of its BCa interval from a bootstrap over clusters. Then

$$\tau=\max_{r\in\mathcal{R}}\ell_r,\qquad r^\star=\arg\max\{K_r:\ \mathrm{med}_r\ge\tau\}.$$

Among admissible values the rule takes the finest partition; the example script resolves ties in $K_r$ to the larger resolution as a side effect of its sort. The admissible set is non-empty when the interval at the maximiser of $\ell_r$ contains its own median, which an implementation must test; with few clusters the bootstrap is coarse. No optimality or calibration property is derived here.

**ARI and NMI.** With $a$ cell pairs together in both partitions and $b$ pairs apart in both, $\mathrm{RI}=(a+b)/\binom n2$ and $\mathrm{ARI}=(\mathrm{RI}-E[\mathrm{RI}])/(\max\mathrm{RI}-E[\mathrm{RI}])$, the expectation being under random labelling with the same cluster sizes [R16]; ARI is 1 for identical partitions. NMI with arithmetic normalisation is $2I(X;Y)/(H(X)+H(Y))\in[0,1]$, the scIB and OpenProblems default [R2][R15]; it is not adjusted for chance, so finer partitions can score higher and the two metrics can rank resolutions differently.

**Estimands.** $\gamma^\star$ is a grid value on the scale of the supplied graph and $K_r$ the cluster count of the all-cell partition at $r$. Label agreement is NMI and ARI against author annotations, with label-optimal resolution $\arg\max_r\mathrm{NMI}$ (ties to the smaller $r$); planted-group agreement is ARI against the simulator's labels, and the cluster-count error is $\lvert K_{r^\star}-G\rvert$ for $G$ planted groups.

### 3.3 Assumptions and failure modes

- **Modularity or CPM sweep.** Assumes the graph encodes the structure of interest; neighbour count, principal components and embedding set the scale of $\gamma$.
- **Silhouette.** Assumes compact, separated clusters; well-separated clusters typically correspond to known cell types, so its maximum can miss structure [R9].
- **Subsample stability.** Assumes variation is sampling noise only; batch and donor effects are ignored [R9].
- **Label agreement.** Assumes correct labels unused in building the graph or choosing the resolution; the optimum follows annotation granularity [R2].
- **Threshold rules.** Depend on the grid (chooseR's example reaches 16), on $B$ and on the bootstrap [R10].

### 3.4 Why heuristics work, and what a model-based formulation adds

A sweep with a robustness or separation score separates two questions one objective conflates: whether a partition is a good optimum of a graph objective, which is cheap per grid value, and whether it is reproduced under resampling, which subsampling makes empirical. The heuristics give no probability that the chosen resolution is right, no common scale across resolutions and no transfer between datasets.

A model-based formulation could add three things, each a proposal (Section 5) without a benchmark in the cited sources: an explicit likelihood over the nested partitions $\{c_\gamma\}$ that scores all resolutions on one scale and takes batch or donor as covariates; a calibrated probability that a partition is reproducible, from subsample co-membership; and a model fitted on annotated studies that maps cheap dataset summaries to a resolution, whose target is annotation granularity as much as biology. A sweep costs $\lvert\mathcal{R}\rvert$ clustering calls and subsampling $B\lvert\mathcal{R}\rvert$; a dense $M$ or silhouette needs $O(n^2)$ memory, a kNN-restricted $M$ only $O(\lvert E\rvert)$ memory and $O(B\lvert E\rvert)$ work.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Leiden or Louvain modularity sweep (scanpy `leiden`, Seurat `FindClusters`) | heuristic | Optimise resolution-parameterised modularity on a kNN or SNN graph at each grid value; the value is then fixed by convention or an external rule | [R3][R4][R5][R11] |
| Leiden with the constant Potts model | heuristic | Replace modularity by CPM so that the resolution is an internal-density threshold | [R3][R6] |
| Clustering tree (clustree) | heuristic | One layer per resolution, showing how cells move between clusters as the number of clusters increases | [R7] |
| Silhouette maximisation | heuristic | Choose the resolution whose partition has the highest mean silhouette on the embedding | [R8][R9] |
| chooseR | hybrid | Cluster repeated 80% subsamples at each value, build the co-clustering frequency, score the all-cell partition by the BCa-thresholded median cluster silhouette on one minus co-clustering, and take the admissible value with the most clusters | [R10] |
| scclusteval Jaccard stability | hybrid | Recluster 80% subsamples drawn without replacement; a cluster's stability is the median or mean over subsamples of its best Jaccard coefficient with a subsample cluster, and the README selects the neighbour count that gives the most stable clusters | [R12] |
| SCCAF | hybrid | Iteratively applies clustering and a machine-learning classifier to expression profiles to identify putative cell types | [R13] |
| Label-optimised resolution (scIB) | heuristic | Cluster at 10 resolutions, score each partition against reference labels by NMI and keep the best; uses the labels it scores | [R2][R15] |

The published standards are the toolkit default value (a convention) and the label-optimised scIB protocol [R2], which scores with the labels it selects on. Among label-free rules, chooseR is the only one read that combines a stability measure with a separation criterion and ships code. Clustering trees, Jaccard stability and SCCAF are inspection or assessment tools; none is a resolution rule validated across datasets.

Exact defaults of the methods singlet implements or compares against:

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| scanpy `leiden` | `resolution` | 1 | `scverse/scanpy` src/scanpy/tools/_leiden.py:57 @ 8ed52d9 |
| scanpy `leiden` | `n_iterations` | -1 (iterate to convergence); 2 for the planned `igraph` flavour | _leiden.py:65, 254 @ 8ed52d9 |
| scanpy `leiden` | `partition_type` | `RBConfigurationVertexPartition` (flavour `leidenalg`) | _leiden.py:109, 175 @ 8ed52d9 |
| Seurat `FindClusters` | `resolution` | 0.8 | `satijalab/seurat` R/clustering.R:313 @ 5f67c70 |
| Seurat `FindClusters` | `algorithm` | 1 (original Louvain) | R/clustering.R:285, 315 @ 5f67c70 |
| Seurat `FindClusters` | `random.seed` | 0 | R/clustering.R:320 @ 5f67c70 |
| leidenalg `CPMVertexPartition` | `resolution_parameter`, `node_sizes` | 1.0, 1 per node | `vtraag/leidenalg` src/leidenalg/VertexPartition.py:893 @ 9890a99 |
| chooseR `multiple_cluster` | `n` subsamples, `size` fraction, `npcs` | 100, 0.8, 100 | `rbpatt2019/chooseR` R/pipeline.R:32-34 @ 410bdbf |
| chooseR | subsampling | without replacement | R/helper_functions.R:87-88 @ 410bdbf |
| chooseR `boot_median` | replicates, interval, type | 25000, 0.95, BCa | R/pipeline.R:193 @ 410bdbf |
| chooseR | co-clustering | matches divided by subsamples containing both cells; $M_{ij}=0$ where no match; silhouette on $1-M$ | R/pipeline.R:88-92, 112-113; examples/1_seurat_pipeline.R:68, 73-75 @ 410bdbf |
| chooseR | example grid | 0.8, 1, 1.2, 1.6, 2, 4, 6, 8, 12, 16 | examples/1_seurat_pipeline.R:17 @ 410bdbf |
| chooseR | threshold rule | $\tau$ = maximum lower bound; last row after sorting admissible values by cluster count | examples/1_seurat_pipeline.R:111-116 @ 410bdbf |
| scclusteval | `jaccard_cutoff` | 0.6 | `crazyhottommy/scclusteval` R/scclusterboot.R:167 @ b1b22c7 |
| scIB `cluster_optimal_resolution` | grid | `get_resolutions(n=10, max=2)`: 0.2 to 2.0 in steps of 0.2 | `theislab/scib` scib/metrics/clustering.py:12, 111 @ cd67913 |
| scIB `nmi` | average method | arithmetic | scib/metrics/nmi.py:17 @ cd67913 |
| OpenProblems `clustering_performance` | grid | 20 values, 0.1 to 2.0 in steps of 0.1 | `openproblems-bio/task_dimensionality_reduction` src/metrics/clustering_performance/script.py:22-23 @ 360499d |

## 5. Proposed singlet approach

- **Routes** (licences in Section 12). Leiden, Louvain and the CPM gain function are reimplemented in the C++ core from [R3][R4][R6]; chooseR from its algorithm, with the tie rule that the larger resolution wins; the silhouette from its formula; the ARI and NMI definitions are ported from scIB with attribution. Other tools are callout comparators or generators; scclusteval, SCCAF and the tree view are deferred.
- **Default rule.** `chooser_threshold` with $B=100$ subsamples of fraction 0.8, 25000 bootstrap replicates, a 95% interval, the scIB grid, Leiden to convergence on modularity and seed 0. It is unvalidated and provisional; changing it needs B1 to B3 (B3 also runs chooseR's wider example grid).
- **Model-based formulation (hypothesis).** (a) Score each resolution of the nested sequence by a penalised likelihood (a degree-corrected stochastic block model with a description-length penalty, or a Gaussian mixture on principal components with BIC). (b) Convert subsample co-membership into a calibrated probability that each partition is reproducible. (c) Learn a map from graph summaries (cell and edge counts, degree distribution, modularity-curve shape, co-clustering summaries) to the resolution maximising agreement with author annotations, using a small PyTorch multilayer perceptron (no GPU needed) trained on annotated catalogue studies with study-level holdout. Falsified if (1) on B1 the 95% paired bootstrap interval of the NMI-ratio difference to `chooser_threshold` lies below zero, (2) on B2 at high separation its median ARI is lower, (3) on B3 its choice varies more across seeds, or (4) predicted reproducibility departs from observed by more than 0.1 (proposed) on held-out subsamples.
- **Kernels and devices.** (1) Local moving and aggregation on a compressed-sparse-row graph, CPU first. (2) A sparse contingency table for ARI and NMI. (3) CUDA co-membership accumulation over kNN edges: each edge with both endpoints in a subsample increments a numerator and a denominator counter. (4) Silhouette on $D$ or on embedding distances, dense for small $n$ and kNN-restricted for large $n$ (proposed approximation). (5) A vectorised BCa bootstrap over clusters, CPU. The graph is held in memory (`streaming: false`).
- **Agent defaults.** Use the defaults without asking; never select by `label_nmi` for a label-free choice; report the grid with the chosen value.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/`embedding_key` | float matrix, $n\times d$ | Cell embedding, for example principal components; used by `max_silhouette` |
| read | obsp/`graph_key`_connectivities | sparse float, $n\times n$ | Weighted kNN or SNN graph $A_{ij}$; required, never rebuilt |
| read | obs/`labels_key` | categorical | Reference labels; required by `label_nmi`, otherwise used only for report-time NMI and ARI |
| read | uns/`graph_key`/params | record | Neighbour count, embedding and metric that built the graph; copied to provenance |
| write | obs/`output_key` | categorical | Chosen partition; not written by `report_only` |
| write | obs/`output_key`_res_`r` | categorical | One partition per grid value |
| write | uns/`output_key`/resolution_summary | table | Per grid value: resolution, $K_r$ (`n_clusters`), `modularity` $Q_\gamma$ of the all-cell partition at its own $\gamma$ (not comparable across rows), `mean_silhouette` (mean $s(i)$ on Euclidean distances in the embedding, `max_silhouette` only), `median_silhouette_coclust` $\mathrm{med}_r$ and `ci_low`, `ci_high` (BCa bounds, `chooser_threshold` only), `chosen` |
| write | uns/`output_key`/selection | record | Rule, parameter values, seed, grid, chosen resolution, graph provenance |
| write | obsp/`output_key`_coclust | sparse float, $n\times n$ | $M_{ij}$ on kNN edges at the chosen resolution; written only by `chooser_threshold` |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `graph_key` | string | "neighbors" | — | Graph to sweep; reads obsp/<graph_key>_connectivities. The graph is not rebuilt. |
| `embedding_key` | string | "X_pca" | — | Cell embedding in obsm, used by max_silhouette and recorded for the other rules. |
| `labels_key` | string/null | null | — | Obs column with reference labels. Required by label_nmi; otherwise only adds report-time NMI and ARI, never used for selection. |
| `output_key` | string | "cluster_selected" | — | Prefix of the written members. Existing members with this prefix are replaced only when overwrite is true. |
| `resolutions` | array | [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0] | — | Grid of resolution values, each greater than 0; the default is the scIB grid. The grid is reported with every result. |
| `selection_rule` | string | "chooser_threshold" | `chooser_threshold`, `max_silhouette`, `label_nmi`, `report_only` | Rule that picks one resolution: chooser_threshold, max_silhouette (mean silhouette on the embedding), label_nmi (uses labels; comparator only) or report_only (no selection). |
| `chooser_threshold` | object | — | — | Options of the chooser_threshold rule; ignored by the other rules. |
| `chooser_threshold.n_subsamples` | integer | 100 | min 2 | Number of subsamples B. The cost is B times the number of grid values clustering calls. |
| `chooser_threshold.subsample_fraction` | number | 0.8 | > 0; < 1 | Fraction of cells in each subsample, drawn without replacement. |
| `chooser_threshold.bootstrap_reps` | integer | 25000 | min 1000 | Bootstrap replicates for the BCa interval of the median cluster silhouette. |
| `chooser_threshold.ci_level` | number | 0.95 | > 0; < 1 | Coverage of the bootstrap interval. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. CUDA accelerates co-membership counting only. |
| `seed` | integer | 0 | min 0 | Random seed for subsampling and optimiser tie-breaking. |
| `dry_run` | boolean | false | — | Return estimated time, peak memory and device without clustering. |
| `overwrite` | boolean | false | — | Replace existing output members with the same output_key instead of failing. |
<!-- PARAMS:AUTO:END -->

Cross-parameter rules. The `chooser_threshold` options apply to that rule only. `max_silhouette` reads `embedding_key` and ignores the subsampling options; `label_nmi` requires `labels_key`, and with any other rule `labels_key` only adds report-time NMI and ARI to the summary. `report_only` writes the sweep and summary but no `obs/output_key` partition. Grid values are sorted and de-duplicated. Leiden runs to convergence on the modularity objective; the CPM objective and an iteration limit are not exposed in the first version. The same seed, build and inputs must give the same members.

## 7. MCP tool

Tool name `singlet_clustering_resolution_selection` (definition in `tasks/mcp/singlet_clustering_resolution_selection.json`).

```json
{
  "dataset": "example.singlet",
  "graph_key": "neighbors",
  "resolutions": [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0],
  "selection_rule": "chooser_threshold",
  "chooser_threshold": {"n_subsamples": 100, "subsample_fraction": 0.8},
  "seed": 0
}
```

```json
{
  "dataset": "example.singlet",
  "status": "completed",
  "wrote": ["obs/cluster_selected", "obs/cluster_selected_res_0.2", "uns/cluster_selected/selection"],
  "summary": {
    "chosen_resolution": "<grid value>",
    "n_clusters": "<integer>",
    "selection_rule": "chooser_threshold",
    "per_resolution": [{"resolution": "<grid value>", "n_clusters": "<integer>",
      "median_silhouette_coclust": "<number>", "ci_low": "<number>", "chosen": "<boolean>"}],
    "labels_used": false
  },
  "provenance_id": "<id>"
}
```

Long-running: a large sweep may return `queued` with a `job_id`. Stochastic: yes, through `seed`. Dry run: returns `seconds`, `peak_memory_gb` and `device`, computed from $n$, $\lvert E\rvert$, $B$ and $\lvert\mathcal{R}\rvert$ without clustering.

## 8. Benchmarks

**Shared protocol.** Every rule sees the same embedding and the same kNN graph per dataset (fixed neighbour count and number of principal components) and the same grid, 0.2 to 2.0 in steps of 0.2, unless a benchmark says otherwise. Each rule is scored at its own chosen resolution; label-based metrics are computed after selection from labels the rule never saw. Stochastic steps use seeds 0 to 9 unless a benchmark states its own, and results are medians over seeds. NMI is arithmetic-mean normalised and ARI is as in Section 3.2; ties in an argmax over resolutions go to the smaller value. Acceptance criteria marked proposed are design choices, not literature values.

### B1. Label agreement on annotated studies (scIB protocol; proposed instantiation)

- **Goal**: measure how close each label-free rule gets to the label-optimal resolution, and test the model-based claim of Section 5 on held-out studies. The scIB protocol [R2] defines the label-optimised value; this benchmark uses it as an oracle, not a rule.
- **Ground truth**: author cell-type annotation in `labels_key`, used only for scoring (and for fitting the learned map on training studies, never on test studies). Score: NMI in $[0,1]$ and ARI at the chosen value; the ratio $\mathrm{NMI}(r^\star)/\max_r\mathrm{NMI}(r)$ normalises each study by its own oracle.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Annotated studies of the singlet catalogue | singlet catalogue (about 40% of cells carry author annotations) | scRNA-seq and snRNA-seq; study table frozen before evaluation | — | Training and test studies disjoint by study |
| `cxg_mouse_pancreas_atlas` | OpenProblems task_dimensionality_reduction test resource (`obs["cell_type"]`) | mouse pancreas atlas; size — | — | Public check dataset |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| NMI ratio to oracle | $\mathrm{NMI}(c_{r^\star},y)/\max_{r\in\mathcal{R}}\mathrm{NMI}(c_r,y)$ per study | higher is better | primary | [R2][R15] |
| ARI at the chosen value | ARI between $c_{r^\star}$ and $y$ | higher is better | guardrail | [R16] |
| Chosen resolution and $K_{r^\star}$ | Reported, not scored | report | report | — |

- **Comparators**: `chooser_threshold`, `max_silhouette`, fixed resolutions 1.0 and 0.8 (the scanpy and Seurat values), the model-based rule when built, and the oracle.
- **Protocol**: also repeat on the OpenProblems 20-value grid (Section 4) to measure grid sensitivity; differences are paired by study, with a bootstrap over studies.
- **Acceptance criterion** (proposed): a rule is accepted if its NMI ratio is at least 0.9 on at least 80% of test studies; the model-based rule replaces `chooser_threshold` as default only if the 95% bootstrap interval of its paired NMI-ratio difference lies above zero.
- **Known pitfalls**: annotation granularity differs between studies, so the NMI optimum reflects the labels' granularity.

### B2. Planted-group simulation (proposed)

- **Goal**: test whether a rule recovers the planted group number and membership across separation levels and group proportions.
- **Ground truth**: planted simulation; the simulator assigns every cell to one of $G$ groups. Scores: ARI against the planted labels and the cluster-count error $\lvert K_{r^\star}-G\rvert$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter group simulations (recipe below) | Splatter [R17] | simulated scRNA-seq counts, no species; 10,000 cells and 5,000 genes (proposed) | — | 10 seeds per setting |

Generator recipe:

1. Fix $G\in\{5,10\}$ with equal `group.prob`, plus one unequal setting for $G=5$ (0.4, 0.3, 0.15, 0.1, 0.05).
2. Set separation by the fraction of differentially expressed genes `de.prob` and the log fold-change location `de.facLoc`: low (0.05, 0.1), medium (0.1, 0.2), high (0.2, 0.4) (proposed values).
3. Simulate counts with `splatSimulate(method = "groups")`, simulator seed equal to the run seed, and store group membership as the label column.
4. Preprocess every dataset identically: library-size normalisation, log transform, 2,000 highly variable genes, 50 principal components, a kNN graph with 15 neighbours (proposed fixed values).
5. Repeat each setting for seeds 0 to 9.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI at the chosen value | ARI between $c_{r^\star}$ and the planted groups | higher is better | primary | [R16] |
| Cluster-count error | $\lvert K_{r^\star}-G\rvert$ | lower is better | primary | — |

- **Comparators**: fixed resolution 1.0, `max_silhouette`, `chooser_threshold`, and the oracle (`label_nmi` with the planted labels).
- **Acceptance criterion** (proposed): at high separation, `chooser_threshold` reaches a median ARI of at least 0.9 over the 10 seeds and $\lvert K_{r^\star}-G\rvert\le1$ in at least 80% of seeds; low and medium separation are reported, not gated.
- **Known pitfalls**: planted groups are separated by construction and flat, so results overstate performance on hierarchical or continuous biology.

### B3. Reproduction and stability of chooseR on its example data (consistency)

- **Goal**: check that singlet reproduces the deterministic part of chooseR exactly, and that the selected resolution is reproducible across seeds and subsample sets and under the graph-restricted approximations of Section 5.
- **Ground truth**: none. Consistency only: agreement with the chooseR implementation on identical inputs, and agreement of the selection across repeats.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Ding et al. 2020 PBMC Smart-seq | [R19]; `data/ding_smartseq_pbmc_preprocessed.rds` in the chooseR repository | human PBMC, Smart-seq; about 500 cells (repository README) | — | Normalised with SCTransform and PCA |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Deterministic agreement | Maximum absolute difference of $M_{ij}$ and of $\mathrm{med}_r$ between singlet and chooseR given the same subsample labels | lower is better | primary | [R10] |
| Selection stability | Fraction of seed and subsample-set combinations that choose the same $r^\star$ | higher is better | primary | — |
| Dense versus restricted | Fraction of runs in which the kNN-restricted silhouette chooses the same $r^\star$ as the dense one | higher is better | guardrail | — |

- **Comparators**: the chooseR example scripts run in R as the reference (callout), and `max_silhouette` on $D$.
- **Protocol**: run chooseR on the example grid to obtain the subsample labels, then feed those labels to singlet. Run singlet end to end with 3 seeds and 2 independent subsample sets on the example grid and on the scIB grid.
- **Acceptance criterion** (proposed): given identical subsample labels, $M_{ij}$ and $\mathrm{med}_r$ agree to $10^{-9}$ and $r^\star$ is identical; on the example grid $r^\star$ is identical across all 3 seeds and 2 subsample sets; the restricted silhouette chooses the dense $r^\star$ in all runs.
- **Known pitfalls**: the repository's `find_clusters` helper passes an undefined `assay = integtrated` (R/helper_functions.R:45), so the harness patches it before running; robustness does not establish correctness [R9].

### P1. Performance and scaling

Wall time per grid value and in total, peak host and device memory, co-clustering storage (dense against kNN-restricted) and cells per second, at 10 thousand, 100 thousand and 1 million cells on CPU and CUDA; no larger scale is claimed. Comparators: scanpy `leiden` (both flavours), leidenalg called directly, Seurat `FindClusters`, rapids_singlecell `leiden` (GPU) and a chooseR-style loop over $B$ subsamples as overhead. Held fixed: the kNN graph, seed, $\lvert\mathcal{R}\rvert$, $B$ and thread count. Acceptance (proposed): at every grid value singlet's objective is at least 0.99 times leidenalg's median over 10 seeds on the same graph, and the log-log slope of peak memory against $\lvert E\rvert$ between 10 thousand and 1 million cells is within 1.0 ± 0.15, with no $n\times n$ allocation. Pitfall: dense silhouette and co-clustering matrices exhaust memory before the Leiden step does.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `neighbors.neighbor_count_selection`: Choice of neighbour count k and graph stability
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
- **Feeds**:
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `clustering.cluster_stability`: Cluster stability under resampling and perturbation
- **Reads**: `obsm/<embedding_key>`, `obsp/<graph_key>_connectivities`, `obs/<labels_key>`, `uns/<graph_key>/params`
- **Writes**: `obs/<output_key>`, `obs/<output_key>_res_<r>`, `uns/<output_key>/resolution_summary`, `uns/<output_key>/selection`, `obsp/<output_key>_coclust`
<!-- CHAINING:AUTO:END -->

No named recipe is assigned yet. The task follows graph construction and precedes annotation and marker ranking; `clustering.cell_partitioning` is the fixed-resolution routine the sweep calls at each grid value.

## 10. Risks, pitfalls and open questions

- **Unsettled literature.** No label-free rule has been validated against held-out ground truth across datasets, so the model-based proposal is a hypothesis. Cell-type number and resolution are different targets, and stability can reward reproducibility over information.
- **Benchmarks not instantiated.** Yu et al. [R14] benchmark 14 clustering methods on estimating the number of cell types, with data sampled from Tabula Muris and Tabula Sapiens; their metric formulas, accessions and method names are not available here, so no benchmark is built on them. The mixture-control datasets of Tian et al. [R18] (cells or RNA from up to five cancer cell lines, 14 datasets) have no accession or per-cell identity labels stated here. The scIB repository README does not enumerate its datasets.
- **Evidence at description level.** The catalogue figures (354 million cells, about 40% annotated) are internal. The mechanics of Louvain [R4] and the guarantee of Leiden [R3] are taken from the titles and the leidenalg README, and the resolution-limit scale [R5] is used only qualitatively.
- **Approximations.** The kNN-restricted $M_{ij}$ and silhouette are proposed approximations of chooseR's dense computation (tested in B3); the BCa interval over few clusters is coarse; the admissible set must be tested for emptiness.
- **Grid and seed sensitivity.** The chooseR outcome depends on the upper end of the grid, on $B$ and on the seed, and singlet's default grid is narrower than chooseR's example grid. Data licences of the catalogue studies and the Ding data are not recorded.
- **First experiment.** On one labelled dataset with a fixed graph, sweep the grid and compare `chooser_threshold`, `max_silhouette` and `label_nmi` with the reference labels; then vary the grid's upper end and $B$ and measure how much the selected value moves between seeds.

## 11. References

R1. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R2. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2021. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R3. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)
R4. Blondel VD, Guillaume JL, Lambiotte R, Lefebvre E. Fast unfolding of communities in large networks. *Journal of Statistical Mechanics: Theory and Experiment* 2008. doi:10.1088/1742-5468/2008/10/p10008 — verified (corpus)
R5. Fortunato S, Barthélemy M. Resolution limit in community detection. *Proceedings of the National Academy of Sciences* 2007;104(1):36-41. doi:10.1073/pnas.0605965104 — verified (search)
R6. Traag VA, Van Dooren P, Nesterov Y. Narrow scope for resolution-limit-free community detection. *Physical Review E* 2011;84(1):016114. doi:10.1103/PhysRevE.84.016114 — verified (repo)
R7. Zappia L, Oshlack A. Clustering trees: a visualization for evaluating clusterings at multiple resolutions. *GigaScience* 2018;7(7). doi:10.1093/gigascience/giy083 — verified (repo)
R8. Rousseeuw PJ. Silhouettes: a graphical aid to the interpretation and validation of cluster analysis. *Journal of Computational and Applied Mathematics* 1987;20:53-65. — verified (repo)
R9. Amezquita R, Lun A, Hicks S, Gottardo R. Orchestrating Single-Cell Analysis with Bioconductor, chapter More clustering. Bioconductor book 2022. https://bioconductor.org/books/release/OSCA/ — verified (corpus)
R10. Patterson-Cross RB, Levin AJ, Menon V. Selecting single cell clustering parameter values using subsampling-based robustness metrics. 2021. doi:10.1186/s12859-021-03957-4 — verified (corpus)
R11. Satija R, Farrell JA, Gennert D, Schier AF, Regev A. Spatial reconstruction of single-cell gene expression data. *Nature Biotechnology* 2015. doi:10.1038/nbt.3192 — verified (corpus)
R12. Tang M, Kaymaz Y, Logeman BL, Eichhorn S, Liang ZS, Dulac C, Sackton TB. Evaluating single-cell cluster stability using the Jaccard similarity index. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa956 — verified (corpus)
R13. Putative cell type discovery from single-cell gene expression data (SCCAF). *Nature Methods* 2020. doi:10.1038/s41592-020-0825-9 — partial (corpus)
R14. Yu L, Cao Y, Yang JYH, Yang P. Benchmarking clustering algorithms on estimating the number of cell types from single-cell RNA-sequencing data. *Genome Biology* 2022;23:49. doi:10.1186/s13059-022-02622-0 — verified (search)
R15. Emmons S, Kobourov S, Gallant M, Börner K. Analysis of network clustering algorithms and cluster quality metrics at scale. *PLOS ONE* 2016. doi:10.1371/journal.pone.0159161 — verified (corpus)
R16. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R17. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R18. Tian L, Dong X, Freytag S, Lê Cao KA, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R19. Ding et al. *Nature Biotechnology* 2020. https://www.nature.com/articles/s41587-020-0465-8 (as cited in the chooseR README for the PBMC Smart-seq dataset) — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/vtraag/leidenalg | V.A. Traag (pyproject.toml) | GPL-3.0-or-later (pyproject.toml; LICENSE is the GNU GPL v3 text) | Leiden optimiser with modularity and CPM quality functions | reimplement; callout comparator in P1 |
| https://github.com/scverse/scanpy | Adam Gayoso, Alex Wolf and others (pyproject.toml authors) | BSD-3-clause (pyproject.toml; LICENSE) | `sc.tl.leiden` defaults | callout: comparator in B1 and P1 |
| https://github.com/satijalab/seurat | Seurat authors (LICENSE); contributors listed in DESCRIPTION include Andrew Butler, Saket Choudhary, David Collins | MIT + file LICENSE (DESCRIPTION) | `FindClusters` defaults | callout: comparator in B1 and P1 |
| https://github.com/rbpatt2019/chooseR | Patterson-Cross RB, Levin AJ, Menon V (README) | GPL-3.0 (LICENSE is the GNU GPL v3 text) | Subsample co-clustering robustness and the threshold rule | reimplement from the algorithm; callout comparator in B3 |
| https://github.com/lazappi/clustree | Luke Zappia, Alicia Oshlack and others (DESCRIPTION) | GPL-3 (DESCRIPTION; LICENSE) | Clustering-tree visualisation | reimplement the overlap view later |
| https://github.com/crazyhottommy/scclusteval | Ming Tang (DESCRIPTION) | MIT + file LICENSE (DESCRIPTION) | Per-cluster Jaccard stability | callout; not in the first version |
| https://github.com/SCCAF/sccaf | Chichau Miau (setup.py) | MIT (LICENSE; setup.py) | Classifier-based cluster assessment | callout; not in the first version |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt; pyproject.toml) | NMI and ARI definitions; label-optimised resolution | port the NMI and ARI definitions with attribution; the label-optimised rule is a callout comparator in B1 |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Christina Azodi, Alicia Oshlack (DESCRIPTION) | GPL-3 + file LICENSE (DESCRIPTION) | Simulator for B2 | callout: benchmark generator |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (pyproject.toml) | MIT (LICENSE) | GPU Leiden comparator | callout: comparator in P1 |
| https://github.com/openproblems-bio/task_dimensionality_reduction | OpenProblems project (_viash.yaml authors include Luke Zappia, Michal Klein, Scott Gigante) | MIT (_viash.yaml; LICENSE) | Clustering-performance grid and metric configuration; B1 check dataset | callout; formulas reimplemented |
