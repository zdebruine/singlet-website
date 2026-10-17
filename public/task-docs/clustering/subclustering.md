---
id: clustering.subclustering
title: Subclustering a cell population
area: clustering
scope: core
paradigm: heuristic
literature_status: contested
priority: P1
depends_on: [clustering.cell_partitioning, normalization.variance_stabilizing_transform, dim-reduction.pc_number_selection, neighbors.approximate_knn_search]
feeds: [markers-de.cluster_marker_ranking, annotation.cluster_label_assignment, statistics.post_clustering_inference, clustering.cluster_stability]
reads: [layers/counts, obs/<parent_key>, obsm/X_pca, obsp/<graph_key>, obs/<batch_key>]
writes: [obs/<output_key>, uns/<output_key>/params, uns/<output_key>/tests, uns/<output_key>/features, obsm/<output_key>_embedding]
devices: [cpu, cuda]
mcp_tool: singlet_clustering_subclustering
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Subclustering a cell population

> Splits the cells of one parent cluster into nested subclusters, either by restricting the parent's graph or by re-selecting features and rebuilding the graph on the subset, and records the method, granularity setting and any split test with the result.

## 1. Question

Given the cells $S$ of one parent cluster ($S\subseteq\{1,\dots,n\}$), their raw counts, the parent embedding or neighbour graph, and one granularity setting, which partition $c_S:S\to\{1,\dots,K_S\}$ of those cells into subclusters does the data support, and does it reflect populations? Inputs are `layers/counts`, the parent labels in `obs/<parent_key>`, and `obsm/X_pca` or `obsp/<graph_key>`. The output is one nested label per parent cell (`<parent>.<k>`) in `obs/<output_key>`. A correct answer is a partition whose subclusters are reproducible and that a null of one population does not produce. No reference truth for subclusters is available in general (Section 2).

## 2. Why this task matters and where the field stands

A cluster whose marker genes mix several states is usually re-clustered. The OSCA advanced chapter proposes ranking clusters for subclustering by their root-mean-square deviation from the centroid, and cautions that clusters from low-library-size cells and boundary cells score high for reasons unrelated to structure [R10]. Running a subclustering is routine. Its meaning is contested, for four reasons.

1. **Granularity is uncalibrated.** A resolution gives different subcluster counts on different parents (Section 3.1). The granularity problem of unsupervised scRNA-seq clustering applies here [R1].
2. **Features and graph are a choice.** Graph restriction keeps the parent's features and embedding; recomputation re-selects genes and rebuilds the graph. The two answer different questions and give different subclusters.
3. **Over-splitting is the default risk.** The inferCNV README says the subclustering resolution is one of the settings that most runs must adjust to avoid oversplitting [R18], and scran's denoising assumes a homogeneous parent (Section 3.3).
4. **There is no reference truth.** Fine labels inside a parent exist only partly and are often derived from clustering the same data, so agreement scores can be circular.

Further open problems: differential expression after subclustering on the same cells inflates significance (double dipping), and selective inference for hierarchical clustering addresses post-clustering inference [R19]. Seurat FindSubCluster and scran quickSubCluster take no batch argument, so batch-driven subclusters are not handled by them. No published benchmark of subclustering is cited here; the benchmarks of Section 8 are proposed. The task is classified **contested**.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $S$, $n_S$ | parent cell set and its size |
| $A_{ij}$, $k_i$, $m$ | edge weight, degree and total weight of a graph, with $2m=\sum_{i,j}A_{ij}$ |
| $\gamma$ | resolution; $c_i$ cluster label of cell $i$ |
| $a_{i,C}$ | summed edge weight from cell $i$ into community $C$ |
| $K$ | number of clusters in CHOIR's first (P0) partition, `P0_clusters_n` |
| $\alpha_{\mathrm{sub}}$ | adjusted significance level of one subtree split |

### 3.1 Graph partitions and the induced subgraph

Leiden and Louvain optimise modularity at resolution $\gamma$, with $\gamma=1$ giving standard modularity [R4, R5, R6, R7]:

$$
Q_\gamma(c)=\frac{1}{2m}\sum_{i,j}\Big[A_{ij}-\gamma\,\frac{k_ik_j}{2m}\Big]\,\delta(c_i,c_j).
$$

Restricting the graph to a parent $S$ recomputes degrees and total weight on the induced subgraph, $k_i^S=\sum_{j\in S}A_{ij}$ and $2m_S=\sum_{i\in S}k_i^S$. The null term $k_i^Sk_j^S/(2m_S)$ then differs from $k_ik_j/(2m)$ whenever edges leave $S$. The same $\gamma$ therefore does not in general select the same granularity on the subset as on the parent. Regime: any $\gamma$ and any proper subset with boundary edges.

The constant Potts model [R8] uses $H_\gamma(c)=\sum_{i,j}(A_{ij}-\gamma\,n_in_j)\,\delta(c_i,c_j)$. With unit node weights $n_i=1$ and no self-loops, moving cell $i$ into community $C$ changes $H_\gamma$ by an amount proportional to $a_{i,C}-\gamma\,|C|$. This criterion depends on community size and edge weights, not on the total weight of the graph (derived). It also fixes a scale: if all weights are at most 1, as for Jaccard or fuzzy-kernel graphs, then $a_{i,C}\le|C|$, so every $\gamma\ge1$ admits no improving move, and CPM gives non-trivial communities only for $\gamma$ below 1 on that weight scale (derived). Regime: unit node weights and no self-loops.

### 3.2 Calibrated split test

CHOIR tests a candidate split of a subtree by fitting a random forest that predicts child membership from the selected features, giving a mean balanced accuracy $\bar a_{\mathrm{obs}}$. A null distribution $\hat F_{\mathrm{perm}}$ comes from label-permuted fits, estimated by a kernel density, and the split is tested at the adjusted level [R11]:

$$
p_{\mathrm{perm}}=1-\hat F_{\mathrm{perm}}\!\left(\bar a_{\mathrm{obs}}\right),\qquad \alpha_{\mathrm{sub}}=\frac{\alpha}{4K}.
$$

A split is kept when $\bar a_{\mathrm{obs}}\ge0.5$, $p_{\mathrm{perm}}<\alpha_{\mathrm{sub}}$ and, with `use_variance` set (default), the percentile of the permutation variance is also below $\alpha_{\mathrm{sub}}$. Regime: the test is exact only if child labels are exchangeable given the features. The features are selected from the same cells the split uses, so the null is approximate.

### 3.3 Feature re-selection

scran models the mean-variance trend and denoises the PCA with it. Its source comment gives the reason for the default: each parent cluster is hoped to be reasonably homogeneous, so that the trend estimates technical noise. Re-selection and denoising are therefore defensible for a parent that is already one population, and they can absorb a mixture's variance into the trend when it is not. Regime: valid when one mean-variance trend describes the parent's cells.

### 3.4 Estimands and normalisation

- **Subcluster label** $c_i$ of a parent cell: an integer, ids ordered by subcluster size; no normalisation.
- **Over-split indicator** $O$ for a null subsample: 1 when at least two subclusters hold at least $m=50$ cells. The over-split rate is its mean over subsamples.
- **Count error** $|\hat K-K|$, averaged over repeats: an unnormalised count of subclusters.
- **ARI** against planted labels, over all parent cells: $\mathrm{ARI}=\dfrac{\sum_{ij}\binom{n_{ij}}{2}-\Pi/\binom n2}{\tfrac12\big[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}\big]-\Pi/\binom n2}$ with $\Pi=\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}$ [R12]. It is 0 in expectation under random labelling and 1 for identical partitions.
- **NMI** with arithmetic normalisation, $I(U;V)/\tfrac12[H(U)+H(V)]$, in $[0,1]$ and not chance-corrected, as in the default of scIB's `nmi` [R13]. Its fairness for comparing community partitions has been questioned [R14].
- **ARI overlap** between two subclusterings restricted to cells present in both 80 percent subsamples; under independent subsampling this is about 64 percent of the parent ($0.8\times0.8$).
- **Wall-clock seconds** per call, unnormalised.

### 3.5 Why heuristics work and what a model adds

Graph restriction and recomputation work when a parent is a union of dense neighbourhoods: local moves find them and the subset is cheap to re-cluster. Neither gives a per-cell uncertainty, and the resolution is not calibrated across parents. A per-parent negative-binomial mixture fitted by EM, comparing $K=1$ with $K=2$ by likelihood ratio, would supply a null distribution by parametric bootstrap from the fitted one-population model, without label permutation, and per-cell posterior memberships. Its regime is one negative-binomial population per parent. Cell-cycle programmes and continuous gradients violate that regime, and feature selection must use held-out counts (count splitting) to avoid double dipping. No benchmark in this document compares it with the heuristics.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Seurat `FindSubCluster` | heuristic | Louvain at a fixed resolution on the induced subgraph of the parent's SNN graph; features and PCs kept | Repository (Section 12); [R2] describes Seurat v4 |
| scanpy `leiden` with `restrict_to` | heuristic | Leiden on the restricted neighbour graph; resolution is the only granularity setting | [R3], [R4] |
| scran `quickSubCluster` | heuristic | For each group of at least `min.ncells` cells: variance model, the larger of 500 genes and 10 percent of genes, denoised PCA, graph clustering | Repository (Section 12); [R9] is the scran normalisation paper, which does not describe `quickSubCluster` |
| pegasus `split_one_cluster` | heuristic | kNN graph on the parent PCA with Leiden tuned to a target cluster count; labels `<clust_id>-<k>` | Repository (Section 12) |
| CHOIR subtree split | hybrid | Features and embedding recomputed per subtree; a split is kept only if a random-forest permutation test separates the children | [R11] |
| inferCNV tumour subclustering | heuristic | Leiden with CPM on a kNN graph at a cell-count-dependent resolution; the package is no longer supported | [R18] |

The two graph-restriction routes are Seurat FindSubCluster and scanpy's `restrict_to`. Only scran and CHOIR re-select features on the subset, and only CHOIR calibrates the split. The pegasus route reuses the parent PCA and fixes the count, so it cannot return one population by design. inferCNV's rule is included as the one size-dependent resolution in the set. Routes per method are in Section 12. Exact defaults, with source locations:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| Seurat `FindSubCluster` | `resolution`; `algorithm` | 0.5; 1 (original Louvain) | `R/clustering.R:170-171` @5f67c70; codes `:285-287` |
| Seurat `FindSubCluster` | subgraph | `object[[graph.name]][sub.cell, sub.cell]` | `R/clustering.R:174` @5f67c70 |
| scanpy `leiden` | `resolution`; `n_iterations`; `restrict_to` | 1; -1; None | `src/scanpy/tools/_leiden.py:57`, `:65`, `:59`; restriction at `:156` @8ed52d9 |
| scanpy `pp.neighbors` | `n_neighbors` (upstream graph) | 15 | `src/scanpy/neighbors/__init__.py:65` @8ed52d9 |
| scran `quickSubCluster` | `min.ncells`; `normalize` | 50; TRUE | `R/quickSubCluster.R:98`, `:97` @569d2f8 |
| scran `quickSubCluster` | features and PCA | `getTopHVGs(n = 500, prop = 0.1)`, the larger of 500 genes and 10 percent, then `denoisePCA` | `R/quickSubCluster.R:118-119` @569d2f8 |
| scran `quickSubCluster` | graph clustering; label format | `NNGraphParam()`; `'%s.%s'` | `R/quickSubCluster.R:98-99` @569d2f8 |
| pegasus `split_one_cluster` | `rep`; `random_state` | `'pca'`; 0 | `pegasus/tools/clustering.py:642-650` @484617d |
| pegasus `split_one_cluster` | target; label | Leiden with `n_clust` and no resolution; `<clust_id>-<k>` | `clustering.py:715`, `:720` @484617d |
| CHOIR | `alpha`; `p_adjust` | 0.05; `bonferroni` | `R/CHOIR.R:312-313` @e9ebfbc |
| CHOIR | `n_iterations`; `n_trees`; `min_accuracy` | 100; 50; 0.5 | `R/CHOIR.R:316-317`, `:319` @e9ebfbc |
| CHOIR | `use_variance`; `subtree_reductions`; `min_cluster_depth` | TRUE; TRUE; 2000 | `R/CHOIR.R:318`, `:331`, `:329` @e9ebfbc |
| CHOIR | `n_var_features` | NULL in signature; 2000 for RNA | `R/CHOIR.R:334`; `R/TreeUtils.R:157` @e9ebfbc |
| CHOIR | `countsplit` | FALSE | `R/buildTree.R:310` @e9ebfbc |
| CHOIR | subtree alpha | $\alpha/(4K)$, with $K$ = `P0_clusters_n` | `R/buildTree.R:1135` @e9ebfbc |
| CHOIR | split decision | mean accuracy, percentile and variance conditions | `R/ComparisonUtils.R:352-355` @e9ebfbc |
| inferCNV | `k_nn`; `leiden_function`; `leiden_resolution` | 20; CPM first; `"auto"` | `R/inferCNV_tumor_subclusters.R:4`, `:6`, `:7` @65e6bf5 |
| inferCNV | auto resolution | $(11.98/n)^{1/1.165}$, $n$ cells in the tumour group | `R/inferCNV_tumor_subclusters.R:587-588` @65e6bf5 |

## 5. Proposed singlet approach

Routes follow Section 12. The recomputation route is **reimplemented** from scran's documented steps. The CHOIR permutation logic is **ported**. The graph restriction of `graph_subset` is **ported** from Seurat's subgraph call, which is a single line. scanpy and pegasus are **callouts**: comparators only. The target-count method is singlet's own resolution scan on the parent embedding, stopping at the requested count or at a grid limit; pegasus's resolution selection is an open item (Section 10).

Defaults an agent uses without asking: `method` is `recompute_features` with modularity at resolution 1.0, 2,000 re-selected genes, denoised PCA with `n_pcs` from dim-reduction.pc_number_selection or 30, 15 neighbours, seed 0 and `min_cells` 50. These match the scanpy default for resolution and neighbour count, so results compare with the scanpy comparator on the same graph.

**Model-based challenger.** A per-parent negative-binomial mixture fitted by EM, with $K=1$ against $K=2$ by likelihood ratio, a parametric bootstrap null, and count splitting for feature selection (Section 3.5). It is falsified if its B1 over-split rate exceeds 0.05, or if its B2 ARI at $\mathrm{de.facLoc}=0.4$ falls more than 0.05 below the best graph comparator at the true $K$.

**Stack and devices.** The mixture EM is a small, hot kernel: per-cell responsibilities over few components and gene sums on sparse counts, written as hard-coded CUDA kernels with cuSPARSE for the sparse sums, with a CPU implementation of the same computation. Leiden is shared with clustering.cell_partitioning. PyTorch is used only if a learned null classifier is later trained on catalogue cells, which is not proposed for the first release. A parent is held in memory; streaming is not claimed.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/`<layer>` (default `counts`) | sparse int | raw counts for re-selected features |
| read | obs/`<parent_key>` | categorical | parent labels |
| read | obsm/X_pca | float32, $n\times d$ | parent embedding used by `target_count` |
| read | obsp/`<graph_key>` | sparse float32, $n\times n$ | parent graph used by `graph_subset` |
| read | obs/`<batch_key>` | categorical | batch covariate, optional |
| write | obs/`<output_key>` | categorical | nested label `<parent>.<k>`; parent label kept for unchanged parents and small subclusters |
| write | uns/`<output_key>`/params | dict | method, resolved parameters, seed, graph source, realised counts |
| write | uns/`<output_key>`/tests | dict | per split: $\bar a_{\mathrm{obs}}$, $p_{\mathrm{perm}}$, $\alpha_{\mathrm{sub}}$; `choir_permutation` only |
| write | uns/`<output_key>`/features | list | genes selected on the subset |
| write | obsm/`<output_key>`_embedding | float32 | subset PCA, optional |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `parent` | string/array | required | — | Parent cluster label or list of labels to subcluster; each must occur in obs/<parent_key>. |
| `parent_key` | string | "partition" | — | obs column holding the parent labels; the default matches clustering.cell_partitioning. |
| `output_key` | string | "subcluster" | — | Name of the output: writes obs/<output_key> and uns/<output_key>; replaced only when overwrite is true. |
| `method` | string | "recompute_features" | `recompute_features`, `graph_subset`, `choir_permutation`, `target_count` | recompute_features re-selects genes and rebuilds the graph (default); graph_subset restricts the parent graph; choir_permutation tests splits; target_count fixes K. |
| `layer` | string | "counts" | — | Raw counts layer; required by recompute_features and choir_permutation, unused by graph_subset and target_count. |
| `min_cells` | integer | 50 | min 2 | Parents with fewer cells keep their label; subclusters smaller than this return to the parent label. |
| `seed` | integer | 0 | min 0 | Random seed for graph clustering and permutation tests. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `recompute_features` | object | — | — | Options for method recompute_features (scran quickSubCluster semantics). |
| `recompute_features.n_top_features` | integer | 2000 | min 50 | Genes re-selected on the subset; scran uses the larger of 500 genes and 10 percent of genes, CHOIR 2000. |
| `recompute_features.n_pcs` | integer/null | null | min 1 | Principal components on the subset; null uses dim-reduction.pc_number_selection if present, else 30. |
| `recompute_features.k_neighbors` | integer | 15 | min 2 | Neighbours per cell in the subset graph. |
| `recompute_features.denoise_pca` | boolean | true | — | Denoise the subset PCA with the mean-variance trend, which assumes a homogeneous parent. |
| `recompute_features.objective` | string | "modularity" | `modularity`, `CPM` | Leiden quality function; CPM needs a resolution on the edge-weight scale (Section 3). |
| `recompute_features.resolution` | number | 1.0 | > 0 | Leiden resolution; its meaning depends on the objective and on the subset size (Section 3). |
| `graph_subset` | object | — | — | Options for method graph_subset (Seurat FindSubCluster and scanpy restrict_to semantics). |
| `graph_subset.graph_key` | string | "neighbors" | — | obsp key of the parent graph; must contain every parent cell. |
| `graph_subset.objective` | string | "modularity" | `modularity`, `CPM` | Leiden quality function; CPM needs a resolution on the edge-weight scale (Section 3). |
| `graph_subset.resolution` | number | 1.0 | > 0 | Leiden resolution on the restricted graph; not comparable with the parent setting. |
| `choir_permutation` | object | — | — | Options for method choir_permutation (CHOIR subtree semantics). |
| `choir_permutation.alpha` | number | 0.05 | max 1; > 0 | Split significance level; adjusted per subtree as alpha/(4K) when p_adjust is bonferroni. |
| `choir_permutation.n_iterations` | integer | 100 | min 10 | Label permutations per split comparison; run time grows with this value. |
| `choir_permutation.n_trees` | integer | 50 | min 1 | Trees per random-forest classifier in the split test. |
| `choir_permutation.p_adjust` | string | "bonferroni" | `bonferroni`, `none` | bonferroni applies the subtree adjustment; none uses alpha unchanged. |
| `choir_permutation.use_variance` | boolean | true | — | Also require the permutation variance test to pass (CHOIR default). |
| `choir_permutation.countsplit` | boolean | false | — | Split cells into two count halves so that feature selection and the test use disjoint data. |
| `choir_permutation.batch_key` | string/null | null | — | obs column with a batch covariate for the subset embedding; null disables it. |
| `target_count` | object | — | — | Options for method target_count (pegasus split_one_cluster semantics). |
| `target_count.n_subclusters` | integer | 2 | min 2 | Requested number of subclusters; the output reports the realised count. |
<!-- PARAMS:AUTO:END -->

`method` selects one parameter block and the other blocks are refused. `resolution` and `objective` apply to `recompute_features` and `graph_subset` only, and a resolution is not comparable across parents or methods (Section 3.1). `choir_permutation` requires enough cells in each candidate child for the forest to train. `target_count` ignores `resolution`. A parent with fewer than `min_cells` cells returns unchanged. `layer` must hold raw counts.

## 7. MCP tool

Tool name `singlet_clustering_subclustering` (definition in `tasks/mcp/singlet_clustering_subclustering.json`).

```json
{"dataset": "/data/atlas.singlet", "parent": "3", "parent_key": "partition",
 "method": "recompute_features", "recompute_features": {"n_top_features": 2000, "resolution": 1.0},
 "output_key": "subcluster", "seed": 0}
```

```json
{"dataset": "/data/atlas.singlet", "status": "completed",
 "wrote": ["obs/subcluster", "uns/subcluster/params", "uns/subcluster/features"],
 "summary": {"method": "recompute_features", "parents_processed": "<int>", "parents_split": "<int>",
   "subclusters_per_parent": {"3": "<int>"}, "returned_to_parent": "<int>",
   "objective": "modularity", "resolution": 1.0},
 "provenance_id": "<id>", "job_id": null}
```

- **Long-running**: yes for `recompute_features` and `choir_permutation` on large parents; the call may return `queued` with a `job_id`.
- **Stochastic**: yes; `seed` fixes the Leiden visiting order and the permutations.
- **Dry-run**: estimated seconds, peak memory and device, from parent size, re-selected gene count and `n_iterations`; calibrated in P1.

## 8. Benchmarks

**Shared protocol.** Every method runs at its Section 4 defaults unless a benchmark states otherwise, on the same parent cells, counts and embedding, with one kNN graph per parent at $k=15$ for graph methods. Stochastic methods run with seeds 0 to 2 and are reported as mean and range. Each score is reported with the realised subcluster count $\hat K$, the over-split rate and the minimum subcluster size of 50 cells. Target-count methods are scored for ARI and count error only. Each simulator recipe is numbered in its benchmark.

### B1. Over-splitting of one population (proposed)

- **Goal**: estimate how often each method at defaults splits a population that is one by construction.
- **Ground truth**: planted null. Each subsample comes from one cell line within one protocol, so the true population count is one. The estimand is the rate of the over-split indicator $O$ (Section 3.4). Cell-line labels come from `cell_line_demuxlet` and only select subsamples.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellBench single cells `sce10x_qc`, `sce4_qc`, `scedrop_qc_qc` | `data/sincell_with_class.RData` [R16, R17] | scRNA-seq, human lung adenocarcinoma lines HCC827, H1975, H2228; cell counts — | Section 12 | three protocols: 10x Chromium, CEL-seq2, Drop-seq |
| Splatter single-population control | simulator [R15], `splatSimulate(method = "single")` | simulated scRNA-seq, 5,000 genes | Section 12 | library sizes matched to the CellBench subsample |

  Control recipe: (1) `splatSimulate(method = "single")`, `nGenes` 5,000, 500 cells; (2) `lib.loc` and `lib.scale` set so the median library size matches the matched CellBench subsample; (3) truth is one population.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| over_split_rate | fraction of subsamples with at least two subclusters of at least 50 cells | minimise | primary | — |
| mean_subclusters | mean number of subclusters of at least 50 cells per subsample | minimise | guardrail | — |
| wall_clock_seconds | per call, with seed and thread count | minimise | guardrail | — |

- **Comparators**: Seurat `FindSubCluster` (resolution 0.5); scanpy `leiden` with `restrict_to` (resolution 1); scran `quickSubCluster`; CHOIR subtree split (alpha 0.05). pegasus target-count is excluded, since a requested count of two splits by construction; it is scored in B2.
- **Protocol**: 50 subsamples of 500 cells per protocol and cell-line pair, plus 50 simulated null subsamples; seeds 0 to 2.
- **Acceptance criterion**: proposed. over_split_rate at most 0.05 at defaults over at least 50 subsamples per population; higher rates are reported as over-splitting, not rejected.
- **Known pitfalls**: cell-cycle and stress programmes make the rate an upper bound on false splits; the 500-cell subsample size is reported with each value.

### B2. Recovery of planted subgroups (simulation, proposed)

- **Goal**: test recovery of planted subgroups as their separation varies, and whether one subcluster is returned when none is planted.
- **Ground truth**: planted simulation; membership is the simulator's `Group` factor, exact by construction. Estimands: ARI and NMI between subcluster and planted labels over all parent cells, and $|\hat K-K|$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter groups parents | simulator [R15], `splatSimulate(method = "groups")` | simulated scRNA-seq, 5,000 genes, $n\in\{2{,}000;10{,}000\}$ cells | Section 12 | $K\in\{2,3\}$; `de.facLoc` in {0.05, 0.1, 0.2, 0.4}; seeds 0 to 2 |
| Splatter single-population control | simulator [R15], `method = "single"` | as above | Section 12 | one group; scored for over-splitting only |

  Recipe: (1) `nGenes` 5,000, `batchCells` $n$, uniform `group.prob` over $K$, one matrix per $(K, n, \mathrm{de.facLoc}, \text{seed})$; (2) other parameters at Splatter defaults; (3) embedding and graph built without labels; (4) truth is `Group`.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | partition against planted groups, Section 3.4 | maximise | primary | [R12] |
| NMI_arithmetic | Section 3.4 | maximise | guardrail | [R13] |
| count_error | $\lvert\hat K-K\rvert$, averaged over repeats | minimise | guardrail | — |

- **Comparators**: Seurat `FindSubCluster`; scanpy `leiden` with `restrict_to`; scran `quickSubCluster`; pegasus target-count with $n_{\mathrm{subclusters}}=K$, an oracle count; CHOIR subtree split; singlet `recompute_features` at defaults.
- **Protocol**: no tuning on labels; defaults for each method, seeds 0 to 2; ARI and NMI computed per repeat and then averaged. Control parents are scored by over-splitting only, because ARI is degenerate for a single true class.
- **Acceptance criterion**: proposed. Median ARI at least 0.8 at `de.facLoc` 0.4 for both $K$, with the correct count in at least 80 percent of repeats; control parents at over_split_rate at most 0.05.
- **Known pitfalls**: one simulator favours methods whose assumptions match its generator, so a second generator is an open item (Section 10). ARI and NMI weigh extra clusters differently, so both are reported.

### B3. Stability under subsampling (proposed)

- **Goal**: test whether subclusters are reproducible when 80 percent of a parent is resampled.
- **Ground truth**: consistency. No labels are used. The estimand is the agreement between two subclusterings of one parent, restricted to cells present in both subsamples.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellBench mixed parents | B1 source | scRNA-seq, three cell lines pooled within each protocol | Section 12 | one parent per protocol |
| Planted parent | B2 generator | simulated, $K=3$, `de.facLoc` 0.4 | Section 12 | planted structure |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI_overlap_80pct | ARI between the two subclusterings on cells present in both subsamples, averaged over 20 repeats | maximise | primary | [R12] |
| subcluster_count_spread | standard deviation of the subcluster count across repeats | minimise | guardrail | — |

- **Comparators**: all B1 methods at defaults with fixed seeds, plus a seed-only arm (same subsample, different seeds) reported separately.
- **Protocol**: for each parent, 20 pairs of 80 percent subsamples drawn without replacement; each method is run on both members of a pair with the same settings; median and spread are reported.
- **Acceptance criterion**: proposed. Median ARI_overlap_80pct at least 0.7 for a parent to be reported as stably subclustered.
- **Known pitfalls**: a method that returns one cluster is trivially stable, so stability is always reported with over-split rate and count. Seed variation of Leiden can dominate, which is why the seed-only arm is kept.

### P1. Performance and scaling

- **Scales**: parent sizes $10^3$, $10^4$, $10^5$ and $10^6$ cells (proposed), from the B2 generator at each size, plus one real-data check on the largest parent available.
- **Hold fixed**: 2,000 features for recomputing methods (scran's 500-or-10-percent rule is a separate arm), 30 PCs, $k=15$, seed 0, one thread and all threads, and CPU for every comparator.
- **Metrics**: wall-clock seconds per stage (graph construction, feature selection, embedding, clustering) and in total; peak memory in GB; seconds per returned subcluster.
- **Comparators**: Seurat `FindSubCluster` and scanpy `restrict_to` (graph only); scran `quickSubCluster`; pegasus `split_one_cluster`; CHOIR subtree split at fixed `n_iterations` 100 and its default downsampling.
- **Acceptance criterion**: proposed. Log-log slope of total time against $n$ between $10^3$ and $10^6$ at most 1.2 for graph-only methods; singlet CUDA at least 5 times faster than singlet CPU at $10^6$ cells; repeated calls with the same seed return identical labels.
- **Known pitfalls**: graph construction dominates the recomputing methods and is timed separately. CHOIR cost grows with `n_iterations` and with the number of comparisons, so it is reported at fixed iterations only.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
- **Feeds**:
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `statistics.post_clustering_inference`: Post-clustering inference with valid p-values (double-dipping correction)
  - `clustering.cluster_stability`: Cluster stability under resampling and perturbation
- **Reads**: `layers/counts`, `obs/<parent_key>`, `obsm/X_pca`, `obsp/<graph_key>`, `obs/<batch_key>`
- **Writes**: `obs/<output_key>`, `uns/<output_key>/params`, `uns/<output_key>/tests`, `uns/<output_key>/features`, `obsm/<output_key>_embedding`
<!-- CHAINING:AUTO:END -->

Within graph clustering this task follows partitioning: subcluster the clusters that show heterogeneity by RMSD or marker structure, then rank markers within subclusters.

## 10. Risks, pitfalls and open questions

- **Unverified source details.** The origin of the factor 4 in CHOIR's $\alpha/(4K)$ is not documented in the source. The CHOIR decision logic was read for the default conjunction and the variance option only. The bluster default algorithm behind `NNGraphParam()` is not in the sources. The pegasus target-count resolution selection and its full `subcluster` recomputation path were not traced.
- **Literature gaps.** No published subclustering benchmark was found in the reviewed sources, so B1 to B3 are proposed. A 2023 Bayesian zero-inflated mixture for subpopulations (doi:10.1089/cmb.2022.0273) is excluded from the tables because its code was not reviewed. The journal version of [R19] was not confirmed, so only the arXiv record is cited.
- **Folded expert-label benchmark.** Agreement with author fine labels inside parent types is not benchmarked. The sources do not name parent types, their sizes or the provenance of their labels, and author labels are often derived from clustering the same data. First step: choose parent types with at least two fine labels from studies with marker-validated labels, then score ARI on held-out cells.
- **Data sizes.** The CellBench README gives no cell counts per object. The Splatter single-population recipe with matched library sizes is defined in B1 but has not been checked against real library-size distributions.
- **Granularity calibration.** The CPM resolution scale for the singlet graph is not set. The default is modularity at 1.0 by convention, matching scanpy, and CPM becomes the size-stable option only after a resolution on the edge-weight scale is calibrated on B1 and B2. Behaviour of modularity under subsetting is derived here, not measured.
- **First experiment.** Run B1 on the 10x CellBench objects with the `recompute_features` and `graph_subset` defaults at seeds 0 to 2. B2 and B3 follow only if B1 meets its acceptance criterion, and the model-based challenger is evaluated on the same B1 subsamples.

## 11. References

R1. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R2. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)
R3. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R4. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)
R5. Blondel VD, Guillaume JL, Lambiotte R, Lefebvre E. Fast unfolding of communities in large networks. *Journal of Statistical Mechanics: Theory and Experiment* 2008. doi:10.1088/1742-5468/2008/10/p10008 — verified (corpus)
R6. Newman MEJ, Girvan M. Finding and evaluating community structure in networks. *Physical Review E* 2004;69(2):026113. doi:10.1103/PhysRevE.69.026113 — verified (repo)
R7. Reichardt J, Bornholdt S. Statistical mechanics of community detection. *Physical Review E* 2006;74(1):016110. doi:10.1103/PhysRevE.74.016110 — verified (repo)
R8. Traag VA, Van Dooren P, Nesterov Y. Narrow scope for resolution-limit-free community detection. *Physical Review E* 2011;84(1):016114. doi:10.1103/PhysRevE.84.016114 — verified (repo)
R9. Lun ATL, et al. Pooling across cells to normalize single-cell RNA sequencing data with many zero counts. *Genome Biology* 2016. doi:10.1186/s13059-016-0947-7 — verified (corpus)
R10. Amezquita RA, Lun A, Hicks SC, Gottardo R, et al. Advanced Single-Cell Analysis, chapter "More clustering" (RMSD and its caveats). Bioconductor book, source version 1.21.2 (OSCA-source/OSCA.advanced). — verified (repo)
R11. Sant C, et al. CHOIR improves significance-based detection of cell types and states from single-cell data. *Nature Genetics* 2025. doi:10.1038/s41588-025-02148-8 — verified (corpus)
R12. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R13. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022;19:41-50. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R14. Amelio A, Pizzuti C. Is Normalized Mutual Information a Fair Measure for Comparing Community Detection Methods? *Proceedings of the 2015 IEEE/ACM International Conference on Advances in Social Networks Analysis and Mining* 2015. doi:10.1145/2808797.2809344 — verified (corpus)
R15. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R16. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R17. Tian L. CellBench_data. GitHub repository LuyiTian/CellBench_data; raw data under GEO GSE118767 (stated in the README). — verified (repo)
R18. Tickle T, Tirosh I, Georgescu C, Brown M, Haas B. Infer Copy Number Variation from Single-Cell RNA-Seq Data. R package version 1.23.0, GitHub repository broadinstitute/inferCNV. — verified (repo)
R19. Gao LL, Bien J, Witten D. Selective inference for hierarchical clustering. arXiv:2012.02936 (2020). — verified (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and contributors (DESCRIPTION) | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE copyright Seurat authors 2021) | FindSubCluster semantics; Louvain algorithm codes | port (subgraph call only) |
| https://github.com/scverse/scanpy | scverse; maintainers Ilan Gold, Philipp Angerer, Severin Dicks (pyproject.toml) | BSD-3-Clause (LICENSE, copyright 2025 scverse) | `leiden` with `restrict_to`; defaults | callout |
| https://github.com/MarioniLab/scran | Aaron Lun (aut, cre), Karsten Bach (aut), Jong Kyoung Kim and Antonio Scialdone (ctb) (DESCRIPTION) | GPL-3 (DESCRIPTION); no LICENSE file at the repository root | `quickSubCluster`; recomputation route | reimplement |
| https://github.com/lilab-bcb/pegasus | Yiming Yang, Joshua Gould, Bo Li (setup.py) | BSD-3-Clause (LICENSE) | `split_one_cluster` target-count semantics | callout |
| https://github.com/corceslab/CHOIR | Cathrine Sant (aut, cre) (DESCRIPTION) | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE copyright 2023 Corces Lab) | permutation split test and subtree defaults | port |
| https://github.com/broadinstitute/inferCNV | Timothy Tickle, Itay Tirosh, Christophe Georgescu (cre), Maxwell Brown, Brian Haas (DESCRIPTION) | BSD-3-Clause (DESCRIPTION: BSD_3_clause + file LICENSE; the LICENSE file holds the copyright fields only) | auto resolution rule, cited as an example | callout |
| https://github.com/vtraag/leidenalg | V.A. Traag (pyproject.toml) | GPL-3.0-or-later (pyproject.toml; LICENSE is GPL v3) | reference Leiden with modularity and CPM | reimplement |
| https://github.com/Oshlack/splatter | Luke Zappia (aut, cre), Belinda Phipson (aut), Alicia Oshlack (aut), Christina Azodi (ctb) (DESCRIPTION) | GPL-3 + file LICENSE (DESCRIPTION) | simulator for B1 to B3 | callout |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian (LICENSE, copyright 2018) | MIT (repository LICENSE); the README states no licence for the data files | data source for B1 and B3 | callout |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt) | arithmetic NMI definition | callout |
| https://github.com/OSCA-source/OSCA.advanced | Robert Amezquita, Aaron Lun, Stephanie Hicks, Raphael Gottardo (aut); Ludwig Geistlinger (cre); Peter Hickey (ctb) (DESCRIPTION) | CC BY 4.0 (DESCRIPTION) | RMSD ranking and caveats | callout |
| https://github.com/theislab/single-cell-best-practices | Theislab (copyright holder, LICENSE) | Apache License 2.0 (LICENSE) | routine sub-clustering guidance | callout |
