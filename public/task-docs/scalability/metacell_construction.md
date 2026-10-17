---
id: scalability.metacell_construction
title: Metacell construction (cell aggregation)
area: scalability
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [qc.low_quality_cell_detection, doublets.expression_doublet_scoring, ambient.count_removal, dim-reduction.normalized_cell_embedding]
feeds: [scalability.sketch_based_integration, clustering.cell_partitioning, reference-mapping.reference_construction, annotation.cluster_label_assignment]
reads: [layers/counts, obsm/X_pca]
writes: [obs/metacell, obsm/metacell_assignment, models/seacells_archetypes, uns/metacell_qc, uns/metacell_params]
devices: [cpu, cuda]
mcp_tool: singlet_scalability_metacell_construction
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Metacell construction (cell aggregation)

> Partition single cells into small, state-homogeneous metacells and aggregate their counts, with MetaCell-2 as the default, SEACells as the model-based option and SuperCell as a graph-based alternative, then check purity, structure preservation and cost against the cell-level data.

## 1. Question

Given raw UMI counts $X$ for $N$ cells, an embedding or kNN graph, and a target size $s$, which partition of the cells into about $N/s$ metacells is homogeneous in cell state, and what are the aggregated count profiles? The outputs are a cell-to-metacell assignment (hard, and soft for SEACells), the metacell-by-gene count matrix and per-metacell QC. A correct answer keeps label purity high at matched sizes and reproduces the cell-level gene-gene correlation and differential-expression structure within stated tolerances.

## 2. Why this task matters and where the field stands

Coarse-graining is needed when a cell-level analysis is too costly or too noisy at scale. The singlet catalogue holds 354M cells, and steps such as differential expression, network inference and reference building are expensive per cell. Summing or averaging groups of similar cells reduces sampling noise and gives a unit that downstream steps can handle [R1][R2]. The status is **contested**: the methods optimise different objectives, and no shared objective or independent benchmark is cited here.

- **Objectives differ.** MetaCell-2 partitions a cell graph within piles and removes deviant cells [R2]. SEACells fits a kernel archetypal model with soft memberships [R3]. SuperCell cuts a walktrap dendrogram into round(N/γ) groups [R4].
- **Evaluation is internal.** Published evaluations are mostly purity, compactness and self-consistency on the authors' own data [R2][R3][R4].
- **Homogeneity is rarely tested.** mcRigor reports that partitions depend strongly on hyperparameters and can contain heterogeneous groups [R5].
- **The target size has no principled default.** MetaCell-2 uses a cell count and a UMI target, SuperCell uses γ, and SEACells uses an archetype count, so results are comparable only at matched group counts.
- **Uncertainty is missing.** Hard-assignment methods give no membership uncertainty. Only SEACells gives soft weights.
- **Batch handling is unsettled.** SuperCell can split groups by condition, but no published benchmark for batch-aware metacells is cited here.

## 3. Theory and insight

Metacell construction is coarse-graining. A partition of $N$ cells into $m\approx N/s$ groups is chosen, and each group is summarised by a count profile. The gain is variance reduction and the cost is bias when a group mixes cell states. For $n_m$ independent cells drawn from one state with per-cell variance $\sigma_m^2$, the group mean has variance $\operatorname{Var}(\bar y_m)\approx\sigma_m^2/n_m$ (first-order approximation; requires homogeneity within the group and no batch effect). Between-state variance inside a group grows with $n_m$ and averaging does not remove it, so the useful size is the largest one that stays homogeneous. No single correct size exists, and the methods fix different quantities: a cell count, a UMI target, an archetype count or a graining level $\gamma$.

| Symbol | Meaning |
|---|---|
| $x_i$, $c_i=\mathbf 1^\top x_i$ | counts of cell $i$ over $G$ genes, and its total UMI count |
| $z_i$ | embedding row of cell $i$, for example principal components |
| $\mathcal M_m$, $n_m$ | members of metacell $m$ and its size |
| $W\in\mathbb R^{m\times N}$ | membership: hard (one 1 per cell) or soft |
| $y_m=\sum_i W_{mi}x_i$, $\bar y_m=y_m/n_m$ | summed and mean profile of metacell $m$ (hard $W$) |
| $K$, $\sigma_i$ | sparse adaptive kernel and per-cell bandwidth |
| $A\in\mathbb R^{k\times N}$, $B\in\mathbb R^{N\times k}$ | SEACells cell-to-archetype and archetype-to-cell weights, columns on the simplex |
| $\gamma$, $s$ | SuperCell graining level, and singlet target cells per metacell |

MetaCell-2 sets the pile size of its first divide-and-conquer stage as

$$P^\ast=\min\{P_{\max},\ \max\{P_{\min},\ \max(s\,q,\ \operatorname{round}(qU/\bar c))\}\},$$

where $q$ is the target number of metacells per pile, $U$ the UMI target, $\bar c$ the mean cell UMI count, $P_{\min}=8000$ and $P_{\max}=24000$. Second-stage piles come from clustering metacells and vary around this value.

SuperCell cuts its walktrap dendrogram to $m_{\rm SC}=\operatorname{round}(N/\gamma)$ groups in exact mode. In approximate mode the graph is built on a random subsample of approx.N cells. Louvain ignores $\gamma$, so it does not control group size.

SEACells builds a sparse kernel on the symmetrised kNN graph of the embedding,

$$K_{ij}=\exp\!\Big(-\frac{\|z_i-z_j\|^2}{\sigma_i\,\sigma_j}\Big)\ \text{on the kNN support},\qquad K_{ij}=0\ \text{otherwise},$$

where $\sigma_i$ is the distance from $i$ to its neighbour at index $\lfloor n_{\rm nb}/2\rfloor$ in its kNN list. $K$ is non-negative, symmetric, sparse and has unit diagonal. Its objective and gradients are

$$\mathcal L(A,B)=\operatorname{tr}\big((I-BA)^\top K(I-BA)\big),\qquad \nabla_A\mathcal L=2(B^\top KBA-B^\top K),\qquad \nabla_B\mathcal L=2(KBAA^\top-KA^\top),$$

with the columns of $A$ and $B$ on the probability simplex. The Frank–Wolfe updates use these gradients with step $2/(t+2)$. Convergence is monitored instead on $\mathrm{RSS}=\|K-KBA\|_F$, which is a different function. If $K=\Phi^\top\Phi$ is positive semidefinite, $\mathcal L=\|\Phi-\Phi BA\|_F^2$ is the feature-space residual of archetypal analysis. The sparse adaptive kernel is not guaranteed to be positive semidefinite, so that reading holds only conditionally.

Purity uses labelled members only:

$$P_m=\max_\ell\frac{n_{m\ell}}{n^{\rm lab}_m},\qquad \bar P=\frac{\sum_m n^{\rm lab}_m P_m}{\sum_m n^{\rm lab}_m},$$

where $n_{m\ell}$ counts labelled members with label $\ell$ and $n^{\rm lab}_m$ counts all labelled members of $m$. Compactness and separation follow the SEACells definitions. With $\mathrm{DC}_{id}$ the ten palantir multiscale diffusion components of the embedding,

$$C_m=\frac1{10}\sum_{d=1}^{10}\widehat{\operatorname{Var}}_{i\in\mathcal M_m}(\mathrm{DC}_{id}),\qquad S_m=\min_{m'\neq m}\|\bar u_m-\bar u_{m'}\|_2,$$

where $\widehat{\operatorname{Var}}$ has denominator $n_m-1$ and $\bar u_m$ is the centroid of metacell $m$ in component space.

Estimands, one sentence each:

- **Metacell profile.** $Y=WX$ is the sum over members and $\bar Y=\operatorname{diag}(n)^{-1}Y$ is its per-cell mean; comparisons in section 8 use the mean on a common size-factor scale, because sums scale with $n_m$.
- **Hard label.** $\hat\ell_i=\arg\max_m W_{mi}$; soft weights are convex weights over metacells and are not calibrated probabilities.
- **Purity.** $\bar P$ estimates the fraction of labelled cells that carry their metacell's majority author label, unitless in $[0,1]$.
- **Compactness and separation.** $C_m$ and $S_m$ are in diffusion-component units, comparable only within one embedding, with lower $C$ and higher $S$ better.
- **Planted-group recovery.** The adjusted Rand index compares the planted partition with the majority-mapped partition of cells, and is invariant to label permutation and corrected for chance.
- **Gene-gene agreement.** Spearman correlation between upper-triangle gene correlations computed on cells and on metacells; unitless.
- **Scaling exponent.** The slope $\alpha$ of $\log(\text{time})$ on $\log N$ between the two largest scales.

The assumptions are that cells in a group share one state, that the embedding or graph reflects that state, that counts can be summed or averaged, that batch is absent or split, and, for SEACells, that the archetype count is fixed and the kernel is sparse and symmetric. Graph-partition methods (MetaCell-2, SuperCell) draw boundaries along graph cuts, so a continuous trajectory is cut at arbitrary points, and SuperCell's $\gamma$ fixes the group count whether or not groups are homogeneous. The kernel model optimises a different function from the one it monitors and depends on random initialisation and waypoint sampling. All methods inherit embedding dependence, since compactness and separation move with the embedding. Two definitional pitfalls, circularity and size confounding, are listed in section 8.

A model adds calibrated memberships with uncertainty, a held-out likelihood that can choose the size, and a reusable archetype matrix for new cells. The heuristic keeps speed, known defaults and scale, and remains the comparator. The insight is that grouping reduces noise roughly in proportion to group size while heterogeneity grows with it, so purity and noise trade off. Published evaluations do not resolve this trade-off, so a reliable choice needs per-dataset calibration with a homogeneity check.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| MetaCell-2 | heuristic | Divide-and-conquer: cells are split into piles, seeded min-cut-style partitioning of a kNN graph gives candidate metacells, deviant cells are removed by gene-fold tests, and undersized metacells are dissolved. | [R2] |
| SEACells | model-based | Kernel archetypal analysis: archetypes are convex combinations of cells, cells take soft weights on archetypes, and both are fitted by Frank–Wolfe updates on a sparse adaptive kernel. | [R3][R6] |
| SuperCell | heuristic | Walktrap community detection on a kNN graph of principal components, cut to round(N/γ) groups, with optional splits by condition. | [R4] |
| MetaCell (2019) | heuristic | K-nn graph partitioning with fold-test outlier removal; superseded by MetaCell-2 and kept as a historical reference only. | [R1] |

MetaCell-2 is the published standard for scale and SuperCell for simplicity. SEACells is the only model-based construction method in this landscape. The MetacellAnalysisToolkit repository (section 12) applies these three methods behind one interface; it adds no partition algorithm and is not benchmarked here. A vendor aggregation stage is excluded (section 12).

Defaults below are read from the pinned source. Paths are relative to each repository in section 12.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| MetaCell-2 | target_metacell_size | 48 | metacells/parameters.py:128 @c5bd77a |
| MetaCell-2 | target_metacell_umis | 160000 | parameters.py:135 |
| MetaCell-2 | target_metacells_in_pile | 100 | parameters.py:121 |
| MetaCell-2 | min / max target pile size | 8000 / 24000 | parameters.py:108, :115 |
| MetaCell-2 | pile size rule | largest of s·q and round(q·U/mean UMI), clamped to the bounds | metacells/pipeline/divide_and_conquer.py:141 |
| MetaCell-2 | min_metacell_size | 12 | parameters.py:180; dissolution at metacells/tools/dissolve.py:154 |
| MetaCell-2 | min_cut_seed_cells | 7 | parameters.py:188 |
| MetaCell-2 | cells_similarity_method | abs_pearson | parameters.py:85 |
| MetaCell-2 | select_min_genes / select_min_gene_total | 100 / 50 | parameters.py:482, :465 |
| MetaCell-2 | deviant fold factors (strong / noisy) | 3.0 / 2.0 | parameters.py:34, :43 |
| MetaCell-2 | deviants_policy / deviants_max_cell_fraction | gaps / 0.25 | parameters.py:677, :758 |
| MetaCell-2 | knn_k when unset | largest of a size-based term, UMI-based terms and min_knn_k | metacells/pipeline/direct.py:251–267 |
| SEACells | n_SEACells | required | SEACells/core.py:16 @a1173c8 |
| SEACells | use_gpu | False | core.py:17 |
| SEACells | n_waypoint_eigs / n_neighbors | 10 / 15 | core.py:19, :20 |
| SEACells | convergence_epsilon | 1e-3 times the initial RSS | core.py:21; SEACells/cpu.py:281 |
| SEACells | l2_penalty | 0 | core.py:22 |
| SEACells | fit max_iter / min_iter | 100 / 10 | SEACells/cpu.py:655–656 |
| SEACells | graph construction | union (intersection optional) | SEACells/build_graph.py:113, :155–156 |
| SEACells | bandwidth neighbour index | k // 2 | build_graph.py:140 |
| SuperCell | gamma | 10 (suggested range 10 to 50) | R/SCimplify.R:70, :86–87 @f0a041e |
| SuperCell | k.knn / n.pc | 5 / 10 | R/SCimplify.R:71, :73 |
| SuperCell | n.var.genes | min(1000, number of genes) | R/SCimplify.R:69 |
| SuperCell | do.approx / approx.N | FALSE / 20000 | R/SCimplify.R:75–76 |
| SuperCell | clustering | walktrap (louvain ignores gamma) | R/SCimplify.R:79, :195–200 |
| SuperCell | group count | round(N/γ), cut from the dendrogram | R/SCimplify.R:193–197 |
| SuperCell | purity helper default | max_proportion | R/supercell_purity.R:21 |

## 5. Proposed singlet approach

- **Routes.** MetaCell-2 is **ported**. SEACells and SuperCell are **reimplemented** from the equations in section 3 and this document, not from their code. The 2019 MetaCell package is not implemented. Licence terms are in section 12.
- **Default and alternatives.** The default is `metacell2` with target size 48. SuperCell takes the same target as its graining level, overriding its own default $\gamma=10$. SEACells becomes the default only if it beats MetaCell-2 on both the B1 purity margin and the B2 adjusted Rand index at matched sizes.
- **Model-based formulation (proposed).** Each cell's counts are a size-factor-scaled mixture of metacell profiles with a negative-binomial likelihood, and memberships carry posterior weights. The archetype constraint of SEACells keeps metacells in the convex hull of cells, and the target size is chosen by held-out likelihood. It is rejected if (i) at matched sizes its B2 adjusted Rand index does not exceed SEACells, or (ii) its nominal 95% posterior predictive intervals cover fewer than 90% of held-out metacell profiles (proposed threshold).
- **Solver checks.** SEACells-type fits log both $\mathcal L$ and the monitored RSS. Gradients are checked against $\mathcal L$ by finite differences before any port.
- **ML stack.** Hard-coded CUDA and cuSPARSE kernels serve the sparse–dense products of SEACells-type updates, which have small $k$. Aggregation is one sparse product $Y=WX$, and kNN search and community detection stay on CPU. PyTorch is used only if a learned encoder [R9] is added after the hard-coded baseline validates.
- **Devices.** In singlet, metacell2 and supercell run on CPU and seacells on CPU or CUDA. The optional GPU path of the reference code imports CuPy (SEACells/gpu.py:1–2), which singlet does not require.
- **Scale and split.** This release has no out-of-core mode, which belongs to `scalability.out_of_core_processing`. SuperCell enforces `split_by` natively; for metacell2 and seacells, cells are partitioned by the column before construction.
- **Defaults.** method `metacell2`, target size 48, seed 0, device `auto`. Archetypes are round(N/48) for seacells. supercell runs exact unless `supercell.approx_n` is set; SuperCell's documentation recommends approximate mode above 50,000 cells (R/SCimplify.R:17), and singlet does not switch automatically.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, summed or averaged into metacells |
| read | obsm/X_pca | float32 | embedding for seacells (`seacells.embedding`) |
| read | obs/<split_by> | categorical | optional; values never mixed within a metacell |
| read | obs/<label> | categorical | optional; expert labels for purity QC only |
| write | obs/metacell | int32 | metacell id per cell (argmax for seacells) |
| write | obsm/metacell_assignment | sparse float | soft membership weights, seacells only |
| write | models/seacells_archetypes | sparse float | archetype matrix $B$, seacells only |
| write | uns/metacell_qc | dict | per-metacell size, purity when labels are given, compactness, separation |
| write | uns/metacell_params | dict | method, parameters, seed and library versions |

The metacell profile matrix is returned as a separate AnnData with summed counts in `layers/counts` and log-normalised values in `X`; it is not a `.singlet` member.

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "metacell2" | `metacell2`, `seacells`, `supercell` | Algorithm: metacell2 (published standard), seacells (model-based, soft memberships) or supercell (graph-based). |
| `target_size` | integer | 48 | min 2 | Target cells per metacell; sets the MetaCell-2 target, the SEACells archetype count round(N/size) or the SuperCell gamma. |
| `split_by` | string/null | null | — | Obs column whose values are never mixed within a metacell, such as batch or donor. |
| `label` | string/null | null | — | Obs column of expert labels used only for purity QC; labels never influence construction. |
| `seed` | integer | 0 | — | Random seed for SEACells initialisation and SuperCell approximate sampling; fixes reproducibility. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; only seacells uses cuda, and auto selects it only when enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, peak memory and device without constructing metacells. |
| `overwrite` | boolean | false | — | Replace existing metacell members instead of failing. |
| `metacell2` | object | — | — | Options used only when method is metacell2. |
| `metacell2.min_metacell_size` | integer | 12 | min 1 | Metacells smaller than this are dissolved into outlier cells. |
| `metacell2.target_metacell_umis` | integer | 160000 | min 1 | UMI target per metacell, combined with the target size to set the divide-and-conquer pile size. |
| `metacell2.deviants_max_cell_fraction` | number | 0.25 | min 0; max 1 | Maximum fraction of cells that can be flagged as deviant. |
| `seacells` | object | — | — | Options used only when method is seacells. |
| `seacells.n_metacells` | integer/null | null | min 1 | Number of archetypes; null uses round(N / target_size). |
| `seacells.embedding` | string | "X_pca" | — | obsm key of the embedding used to build the kernel. |
| `seacells.n_neighbors` | integer | 15 | min 1 | kNN size of the adaptive kernel; the bandwidth uses the neighbour at index n_neighbors // 2. |
| `seacells.n_waypoint_eigs` | integer | 10 | min 1 | Diffusion eigenvectors used for waypoint initialisation. |
| `seacells.convergence_epsilon` | number | 0.001 | min 0 | Stop when the reconstruction error falls below this fraction of its initial value. |
| `seacells.max_iter` | integer | 100 | min 1 | Maximum Frank-Wolfe outer iterations. |
| `seacells.min_iter` | integer | 10 | min 1 | Minimum outer iterations before convergence is checked. |
| `seacells.graph_construction` | string | "union" | `union`, `intersection` | How the directed kNN graph is symmetrised for the kernel support. |
| `supercell` | object | — | — | Options used only when method is supercell. |
| `supercell.k_knn` | integer | 5 | min 1 | Number of neighbours in the single-cell graph. |
| `supercell.n_pc` | integer | 10 | min 1 | Principal components used to build the single-cell graph. |
| `supercell.n_var_genes` | integer | 1000 | min 1 | Most variable genes used for the principal components. |
| `supercell.approx_n` | integer/null | null | min 1 | Subsample size for approximate mode; null is exact, and documentation suggests approximate mode above 50,000 cells. |
<!-- PARAMS:AUTO:END -->

`target_size` is interpreted per method: a target cell count for metacell2, the archetype count round(N/size) for seacells unless `seacells.n_metacells` is set, and the graining level $\gamma$ for supercell. Setting `seacells.n_metacells` together with a non-default `target_size` is an error. A nested object for a method other than the one selected is rejected rather than ignored. `split_by` and `label` must name existing `obs` columns. `label` affects QC only, and construction never reads it. `seed` applies to seacells initialisation and supercell approximate sampling.

## 7. MCP tool

Tool name `singlet_scalability_metacell_construction` (definition in `tasks/mcp/singlet_scalability_metacell_construction.json`). Example call:

```json
{"dataset": "/data/pancreas.singlet", "method": "metacell2", "target_size": 48, "label": "cell_type", "seed": 0}
```

Example result:

```json
{
  "dataset": "/data/pancreas.singlet",
  "status": "completed",
  "wrote": ["obs/metacell", "uns/metacell_qc", "uns/metacell_params"],
  "summary": {"method": "metacell2", "target_size": 48, "n_cells": "<int>",
              "n_metacells": "<int>", "size_median": "<float>", "weighted_purity": "<float>"},
  "provenance_id": "<id>",
  "job_id": null,
  "estimate": null
}
```

Long-running: when the estimate exceeds the inline limit, the call returns `queued` with a `job_id`. Stochastic: results depend on `seed` for seacells and for supercell approximate mode, and GPU reductions can change results at round-off. Dry run: `dry_run` returns estimated seconds, peak memory and device without writing members.

## 8. Benchmarks

Every method is applied to the same cells. The same embedding (50 principal components of log-normalised counts, a proposed choice) defines the compactness and separation metrics and the k-means baseline. The target size is 48 for all methods: MetaCell-2 `target_size` 48, SEACells $n=\operatorname{round}(N/48)$, and SuperCell $\gamma=48$. Realised metacell counts are reported, and metrics are reported per dataset and per metacell-size bin. Seeds are 0 to 2, and results are medians across seeds with the range. Thread count, hardware and library versions are written to `uns/metacell_params`.

### B1. Label purity, compactness and separation at matched sizes

- **Goal.** Judge partitions by label homogeneity, compactness and separation in one fixed embedding, at matched sizes.
- **Ground truth.** Expert author annotations, mapped to metacells by membership. The metacell label is its majority label among labelled members, and purity uses labelled cells only (estimand in section 3).
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue, author-annotated subsets | singlet catalogue (internal); no accession | scRNA-seq; tissue-stratified subsets chosen by the benchmark designer | — | Subset sizes set by the designer |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| size-weighted purity | $\bar P$ as in section 3 | maximise | primary | [R3] |
| purity margin over random | $\bar P$ minus $\bar P$ of a random partition with identical sizes | maximise | primary | — |
| compactness | $C_m$, median over metacells | minimise | guardrail | [R3] |
| separation | $S_m$, median over metacells | maximise | guardrail | [R3] |

- **Comparators.** MetaCell-2 (default), SEACells, SuperCell, a random partition with identical sizes, and k-means on the same embedding with $k=\operatorname{round}(N/48)$.
- **Protocol.** Shared protocol above. Purity is also reported against size quartiles.
- **Acceptance criterion.** Proposed, not from the literature: size-weighted purity at least 0.90 where the random partition scores at most 0.50; a purity gain of at least 0.02 over k-means; median separation not below k-means; and, for SuperCell at $\gamma=10$, a margin over random of at least 0.30.
- **Known pitfalls.** Circularity: labels derived from the same principal components inflate purity. Size confounding: compare at matched sizes only.

### B2. Planted-group recovery (proposed)

- **Goal.** Check that metacells recover known simulated groups before real-data claims.
- **Ground truth.** The planted group of each cell, exact by construction; a metacell takes its majority planted group, and the adjusted Rand index compares planted and majority-mapped partitions.
- **Generator recipe.**
  1. For each seed in {0, 1, 2}, simulate $N=48K$ cells in $K$ planted groups with Splatter [R7], $K$ from a designer-chosen set; use equal group probabilities and a differential-expression probability that separates groups; keep each cell's group label.
  2. Simulate a continuous-trajectory variant with the same seeds using a designer-chosen path model, and define planted groups as $K$ equal-width bins of pseudotime.
  3. Compute 50 principal components of log-normalised counts as the shared embedding, apply each method at target size 48 and at matched counts.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter simulation, group and trajectory variants | simulator recipe [R7] | simulated scRNA-seq; $N=48K$ with $K$ set by the designer | — | No accession; parameters fixed by the recipe |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| metacell purity | purity as in B1 with planted labels | maximise | primary | [R3] |
| adjusted Rand index | Hubert–Arabie index between planted and majority-mapped partitions | maximise | primary | [R8] |
| group coverage | fraction of groups with at least 24 cells (twice the minimum metacell size) that hold a metacell with that majority label | maximise | guardrail | — |
| metacell size | median and interquartile range against the target of 48 | report | guardrail | — |

- **Comparators.** As in B1.
- **Protocol.** Shared protocol above, summarised across seeds, $K$ and variants.
- **Acceptance criterion.** Proposed design targets, not literature values: median metacell purity at least 0.95, adjusted Rand index at least 0.90, and 100% coverage of covered groups.
- **Known pitfalls.** Simulated groups are easier than real states, hence the trajectory variant. Majority mapping hides mixed metacells, so purity is reported with the index.

### B3. Gene-gene structure and differential-expression preservation (proposed)

- **Goal.** Check that metacell profiles keep the gene-gene correlation structure and the differential-expression signal of their member cells.
- **Ground truth.** Consistency with the cell-level analysis of the same cells; there is no external truth. Both sides use the same gene set and the same per-cell scale, so metacell profiles are mean counts.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue, author-annotated subsets (as B1) | singlet catalogue (internal); no accession | scRNA-seq; the same cells as B1 | — | Cell-type pairs chosen by the designer from the annotations |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| gene-gene agreement | Spearman correlation of upper-triangle gene correlations, cells versus metacells, over the top 1000 variable genes chosen on cells | maximise | primary | — |
| DE top-gene overlap | Jaccard index of the top 100 genes ranked by absolute difference in mean normalised expression between two annotated types, cells versus metacells; metacells take the majority type and are excluded below purity 0.90 (proposed) | maximise | guardrail | — |

- **Comparators.** MetaCell-2, SEACells and SuperCell at matched counts.
- **Protocol.** Shared protocol above.
- **Acceptance criterion.** Proposed design targets, not literature values: gene-gene agreement at least 0.80 and DE Jaccard at least 0.60.
- **Known pitfalls.** Selecting variable genes on metacell data inflates agreement, so selection uses cells only. Summing rescales expression with group size, which the common mean scale removes.

### P1. Performance and scaling

Wall time (excluding data loading, mean over repeats), peak resident memory, throughput in cells per second and metacell count, at 10k, 100k and 1M cells drawn as nested subsamples of the catalogue. Ten million cells are not claimed, because streaming is not in this release. Comparators are MetaCell-2 on CPU, SEACells on CPU and CUDA, SuperCell exact, and SuperCell approximate with approx.N 20000. Hold fixed the target size 48, 50 embedding dimensions, the thread count and the seed. Report the scaling exponent of time against cells, and report B1 purity at each scale for one dataset, so that speed is not bought with homogeneity. Acceptance (proposed): the exponent between the two largest scales is at most 1.3 for every method, and memory is reported rather than capped. Known pitfall: SEACells memory at small $k$ is measured here, not assumed.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `doublets.expression_doublet_scoring`: Expression-based per-cell doublet scoring
  - `ambient.count_removal`: Ambient count removal
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
- **Feeds**:
  - `scalability.sketch_based_integration`: Sketch-then-integrate fidelity
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `reference-mapping.reference_construction`: Reusable reference construction and compression
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Reads**: `layers/counts`, `obsm/X_pca`
- **Writes**: `obs/metacell`, `obsm/metacell_assignment`, `models/seacells_archetypes`, `uns/metacell_qc`, `uns/metacell_params`
<!-- CHAINING:AUTO:END -->

This task belongs to the atlas-scale coarse-graining workflow, which follows cell filtering and doublet removal and precedes sketch-based integration and reference construction.

## 10. Risks, pitfalls and open questions

- **SEACells objective.** The updates minimise $\mathcal L$, but convergence is tested on $\|K-KBA\|_F$, so the stopping rule does not track the objective. The Frank–Wolfe gradients match the reference code (cpu.py:425–500). A finite-difference check on synthetic data is still required before any port, together with a check of positive semidefiniteness of the sparse adaptive kernel.
- **Sources not read in full.** The mcRigor generator, its mcDiv statistic and its reported correlations were not read, so B2 uses a planted design rather than the published generator. The SuperCell 2.0 branch, the SEACells benchmark datasets and the ATAC variant were not read. The palantir diffusion functions were read only for their n_eigs handling (utils.py:853–902), and SEACells passes n_eigs=10 (evaluate.py:22, :46). MetaCell-2's deviant rules were read only as parameters, and its scaling claim comes from its README. The SEACells memory limit at small $k$ comes from a review appendix and is unverified.
- **Bibliographic gaps.** The archetypal-analysis primary source is absent from the local bibliography, so the SEACells objective rests on R3 and its code. R2 lists its first three authors from the repository README, and R3 and R4 list only their first authors, so the remaining authors are not confirmed. R5 is known from one web search, and its title and DOI are not confirmed. R9 has no confirmed authors.
- **Data.** The annotated subsets come from an internal catalogue with no accession, so B1 and B3 can be reproduced only with catalogue identifiers. Annotation covers about 40% of the 354M cells, unevenly across tissues, so purity may not transfer to unannotated tissues.
- **Licences and porting.** The routes in section 5 carry the licence constraints listed in section 12. The vendor aggregation stage is excluded on those terms, and the MetaCell-2 port follows the terms in section 12.
- **First experiment.** After the gradient check, run B2 for the three methods at matched sizes, then choose the default from the B2 adjusted Rand index and the B1 purity margin on the annotated subsets.

## 11. References

R1. Baran Y, Bercovich A, Sebe-Pedros A, Lubling Y, Giladi A, Chomsky E, Meir Z, Hoichman M, Lifshitz A, Tanay A. MetaCell: analysis of single-cell RNA-seq data using K-nn graph partitions. *Genome Biology* 2019. doi:10.1186/s13059-019-1812-2 — verified (corpus)

R2. Ben-Kiki O, Bercovich A, Lifshitz A, et al. Metacell-2: a divide-and-conquer metacell algorithm for scalable scRNA-seq analysis. *Genome Biology* 2022;23:100. doi:10.1186/s13059-022-02667-1 — verified (repo)

R3. Persad S, et al. SEACells infers transcriptional and epigenomic cellular states from single-cell genomics data. *Nature Biotechnology* 2023. doi:10.1038/s41587-023-01716-9 — partial (corpus)

R4. Bilous M, et al. Metacells untangle large and complex single-cell transcriptome networks. *BMC Bioinformatics* 2022. doi:10.1186/s12859-022-04861-1 — partial (corpus)

R5. Liu P, Li JJ. mcRigor: metacell partition rigor method (article title not confirmed). *Nature Communications* 2025. — partial (search)

R6. Setty M, Kiseliovas V, Levine J, Gayoso A, Mazutis L, Pe'er D. Characterization of cell fate probabilities in single-cell data with Palantir. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0068-4 — verified (corpus)

R7. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)

R8. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)

R9. Authors not confirmed. Non-linear archetypal analysis of single-cell RNA-seq data by deep autoencoders. *PLOS Computational Biology* 2022. doi:10.1371/journal.pcbi.1010025 — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/tanaylab/metacells (commit c5bd77a) | Oren Ben-Kiki (setup.py author); Weizmann Institute of Science (copyright 2020–2023) | MIT (LICENSE.rst) | MetaCell-2 reference implementation | port |
| https://github.com/tanaylab/metacell (HEAD 9035ce5) | Amos Tanay (LICENSE copyright holder) | MIT (LICENSE) | original MetaCell package, superseded | not implemented |
| https://github.com/dpeerlab/SEACells (commit a1173c8) | Pe'er Lab (pyproject.toml authors) | GPL-2.0 (LICENSE.txt) | SEACells reference implementation | reimplement |
| https://github.com/GfellerLab/SuperCell (commit f0a041e) | Mariia Bilous (DESCRIPTION author) | GPL-3.0 (LICENSE) | SuperCell reference implementation | reimplement |
| https://github.com/GfellerLab/MetacellAnalysisToolkit (commit bc3c67a) | not confirmed | No LICENSE file at the root; DESCRIPTION says `License: file LICENSE` | interface that applies the three methods | not used |
| 10x Genomics Cell Ranger source, create_meta_cells stage | 10x Genomics (LICENSE copyright 2026; stage file 2025) | Source licence: use only with 10x products or data generated with them, no redistribution (LICENSE) | vendor aggregation stage | excluded |
