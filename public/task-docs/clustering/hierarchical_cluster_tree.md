---
id: clustering.hierarchical_cluster_tree
title: Hierarchical tree of cell clusters
area: clustering
scope: core
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection, clustering.cell_partitioning]
feeds: [abundance.hierarchical_composition_test, clustering.cluster_significance_testing, annotation.hierarchical_annotation]
reads: [obsm/X_pca, obs/<groupby>]
writes: [uns/<name>/linkage, uns/<name>/newick, uns/<name>/distance, obs/<name>_cut_<k>, uns/<name>/persistence]
devices: [cpu, cuda]
mcp_tool: singlet_clustering_hierarchical_cluster_tree
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Hierarchical tree of cell clusters

> Builds a nested tree over the groups of an existing cluster column from centroid distances, writes cut labels at chosen cluster counts and reports how persistent each split is; it does not show that a split is a lineage.

## 1. Question

Given cells embedded as $x_i\in\mathbb{R}^d$ and a grouping of the cells into $G$ leaf groups, which binary tree over the groups best describes how populations split and merge, and which flat labels follow from cutting it? Inputs are the embedding, the group column and a centroid method. Outputs are a linkage matrix, a Newick tree, the centroid distance matrix, cut labels and optional split persistence. A correct answer is a tree whose merge order is reproducible and agrees with a known hierarchy; the literature defines no unique correct tree for cell populations.

## 2. Why this task matters and where the field stands

Cell populations are reported as flat clusters, but they often nest: a lineage splits into subtypes, and a coarse type contains finer states. A tree over clusters gives the order in which populations separate, which annotation, marker ranking and subclustering can use. The status is **contested**. The field's challenges are reviewed in [R1]. The published centroid tools (section 4) build one tree deterministically from one distance matrix and report no uncertainty about its merge order; scanpy's dendrogram is described in [R5]. pcaReduce merges cell-level k-means groups with a Gaussian-likelihood rule [R6]. Open problems:

- No hierarchy-specific benchmark exists in the cited sources. The systematic evaluation scores flat partitions [R2].
- Two hierarchies serve as truth, developmental lineage and ontology is-a, and they disagree about what a split means.
- Partitions at different resolutions do not nest, so their cuts can conflict [R7].
- Cell-level trees need a distance between every pair of cells [R3], which limits scale.
- The sensitivity of the tree to embedding dimension and feature choice is not quantified in the cited sources.

## 3. Theory and insight

Let group $g$ contain cells $S_g$ with centroid $c_g=\lvert S_g\rvert^{-1}\sum_{i\in S_g}x_i$. A centroid tree comes from agglomerative linkage on a dissimilarity $d(g,h)$ between centroids: at each step the two current clusters with the smallest linkage distance are joined. The estimand is the merge order and merge heights of this greedy sequence, a deterministic function of $d$ and the linkage; it is not a distribution over trees.

Ward's linkage joins the pair that gives the smallest increase in within-cluster sum of squares:

$$\Delta(A,B)=\frac{\lvert A\rvert\,\lvert B\rvert}{\lvert A\rvert+\lvert B\rvert}\,\lVert c_A-c_B\rVert^2 .$$

Its Lance–Williams update is exact for squared Euclidean distances [R4]; Ward favours compact clusters of similar size.

Complete linkage, $d(A,B)=\max_{g\in A,\,h\in B}d(g,h)$, is monotone for any dissimilarity. The correlation distance $d(g,h)=1-r(c_g,c_h)$ uses the Pearson correlation over the $p$ coordinates of the centroids. After each centroid vector is standardised over its coordinates, $\lVert z_g-z_h\rVert^2=2p\,d(g,h)$, so Ward's identity applies only in that transformed space. Centroid and median linkages are not monotone and can invert, so their heights do not order merges [R3].

Cutting at $k$ clusters removes the $k-1$ highest merges; the cut-label estimand is the partition of groups into the $k$ remaining clades, with each cell taking its group's clade. Labels are not normalised.

Split persistence is the fraction of the full-data tree's non-trivial clades (at least two leaves, not all) that appear in at least 80% of trees built on 50% cell subsamples, over the number of such clades; the thresholds are proposed. With leaves fixed it measures sensitivity of the merge order to cell sampling, not group stability (clustering.cluster_stability).

Evaluation estimands:

- Dendrogram purity for one planted level, with leaves as groups and classes as planted groups:

$$\mathrm{DP}=\frac{1}{\sum_c\binom{\lvert c\rvert}{2}}\sum_c\sum_{\{x,y\}\subseteq c}\frac{\lvert\mathrm{leaves}(\mathrm{lca}(x,y))\cap c\rvert}{\lvert\mathrm{leaves}(\mathrm{lca}(x,y))\rvert}$$

It equals 1 when every class is a clade [R8].

- Normalised Robinson–Foulds distance between rooted binary trees on $n$ leaves: $\lvert C(T_1)\triangle C(T_2)\rvert/(2(n-2))$, where $C(T)$ is the set of non-trivial clades. Zero means identical clade sets [R10].
- Dasgupta cost $C(T)=\sum_{i<j}w_{ij}\,\lvert\mathrm{leaves}(\mathrm{lca}_T(i,j))\rvert$, with $w_{ij}$ the number of planted nodes that contain both leaves. The reported quantity is $C(\hat T)/C(T^*)$; lower is better [R9].
- Cell-level adjusted Rand index, $(\mathrm{RI}-E[\mathrm{RI}])/(\max\mathrm{RI}-E[\mathrm{RI}])$, with cells as items [R11, R12]. Normalised mutual information with the arithmetic normaliser, $I(X;Y)/\tfrac12(H(X)+H(Y))$, with cells as items [R13].
- Hierarchical F1 for one cell with predicted term $p$ and author term $t$. With $A(\cdot)$ the set of ancestors including the term, $hP=\lvert A(p)\cap A(t)\rvert/\lvert A(p)\rvert$ and $hR=\lvert A(p)\cap A(t)\rvert/\lvert A(t)\rvert$; the per-cell harmonic mean is averaged over cells.

The model-based proposal (section 5) gives each candidate merge a posterior probability under a Gaussian model:

$$r_k=\frac{\pi_k\,m_k}{\pi_k\,m_k+(1-\pi_k)\,m_i\,m_j}$$

Here $m_k$ is the marginal likelihood of the merged group's data as one cluster, $m_i$ and $m_j$ are those of the two subtrees, and $\pi_k$ is the prior probability that the merged subtree is one cluster [R8]. The regime is Gaussian within-group principal components with a conjugate prior. $r_k$ is a model probability of the merge, not the probability that a biological split exists.

Insight: a tree adds information only if its merge order is stable under resampling and feature choice, so it should be validated by persistence and by partition agreement at its cuts. Ground truth must be an external hierarchy, planted or ontological, never the labels used to build the tree.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Ward centroid tree (pegasus `calc_dendrogram`) | heuristic | Ward linkage on group centroids | [R4] |
| Correlation centroid tree (scanpy `sc.tl.dendrogram`) | heuristic | 1 minus Pearson correlation of group means, complete linkage | [R5] |
| Euclidean centroid tree (Seurat `BuildClusterTree`) | heuristic | Euclidean centroid distance, complete linkage | — |
| pcaReduce | hybrid | PCA, q+1 k-means clusters, then repeated Gaussian-likelihood merges over nbt replicates | [R6] |

The three centroid tools are the published standard for trees over clusters and are the comparators in every benchmark of section 8. pcaReduce is the only cell-level method tabulated; its merge rule is a Gaussian likelihood inside a heuristic pipeline. Only methods whose code or primary paper is cited here appear in the table; section 10 lists the rest.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| pegasus | linkage | `ward` (docstring default) | `pegasus/tools/clustering.py:761` @ — |
| pegasus | backend | `scipy.cluster.hierarchy.linkage` | `pegasus/tools/clustering.py:819` @ — |
| scanpy | cor_method | `pearson` | `src/scanpy/tools/_dendrogram.py:34` @ 8ed52d9 |
| scanpy | linkage_method | `complete` | `src/scanpy/tools/_dendrogram.py:35` @ 8ed52d9 |
| scanpy | optimal_ordering | `False` (changes leaf order only) | `src/scanpy/tools/_dendrogram.py:36` @ 8ed52d9 |
| scanpy | distance | 1 minus Pearson r of group means | `src/scanpy/tools/_dendrogram.py:163-166` @ 8ed52d9 |
| Seurat | reduction | `pca` | `R/tree.R:61-73` @ — |
| Seurat | dims | `NULL` (features path, pseudobulk profiles) | `R/tree.R:61-73` @ — |
| Seurat | distance, dims path | Euclidean distance of centroids in PC space | `R/tree.R:134` @ — |
| Seurat | distance, features path | Euclidean distance of pseudobulk profiles | `R/tree.R:161` @ — |
| Seurat | linkage | `hclust` default, complete | `R/tree.R:163` @ — |
| pcaReduce | nbt, q | 100 and 30, example call only (no defaults in the function) | `pcaReduce_example.R:52` @ b7c7707 |
| pcaReduce | method | `S` (sampling) or `M` (maximum probability) | `R/pca_reduce.R:12-14` @ b7c7707 |
| pcaReduce | initial clusters | q+1 k-means groups | `R/pca_reduce.R:22-23` @ b7c7707 |

## 5. Proposed singlet approach

**Routes.** The three centroid methods are **port** targets: one linkage kernel with three distance conventions that must reproduce scipy on identical inputs (P1). pcaReduce is a **callout**: it is copyleft and cell-level, so it is a cost comparator only.

**Model-based proposal.** Each group stores its size and the sum and scatter of its PCs, which give $r_k$ in closed form under a normal–inverse-Wishart prior, so no $n$-by-$n$ matrix is needed. Greedy merging joins the pair with the largest $r_k$. Calibration on B1 (proposed): among merges with $r_k\ge 0.9$, at least 90% should lie in the planted tree. The proposal is falsified if this fails, if the reliability curve departs from the diagonal by more than 0.1 in any bin (proposed), or if planted purity falls below ward_centroid.

**Default and enum.** ward_centroid is the default: it is the published standard, and no hierarchy benchmark has been run. The model-based method joins the enum after passing B1 and B2.

**Stack.** Conjugate updates are closed form and run on CPU without a deep-learning framework; a learned variant (PyTorch, validated on held-out studies) is deferred. Kernels are segmented group sums in one streaming pass over obsm rows, the $k$-by-$k$ distance matrix, NN-chain linkage for Ward and complete [R3], and union-find for cut labels. A GPU helps only for distances and persistence at large $k$.

**Defaults an agent should use.** method ward_centroid; use_rep X_pca; n_pcs from dim-reduction.pc_number_selection, else all components; cut_ks 5, 10 and 20 without expert labels; persistence off unless requested, then 50 subsamples of 50% of cells, threshold 0.8 (all proposed).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/X_pca | float32 matrix | embedding for group centroids (`use_rep`) |
| read | obs/<groupby> | categorical | tree leaves |
| write | uns/<name>/linkage | float64, (k−1) by 4 | merge matrix: two children, height, size |
| write | uns/<name>/newick | string | tree with group labels as leaves |
| write | uns/<name>/distance | float32, k by k | centroid distances for the chosen method |
| write | obs/<name>_cut_<k> | categorical | cluster of each cell at each k in `cut_ks` |
| write | uns/<name>/persistence | table | per-clade persistence, when `persistence.n_bootstrap` is above 0 |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `groupby` | string | required | — | obs column whose categories are the tree leaves; use an unsupervised partition when labels will be scored. |
| `method` | string | "ward_centroid" | `ward_centroid`, `complete_correlation`, `complete_euclidean` | Centroid distance and linkage: Ward (default), correlation with complete linkage, or Euclidean with complete linkage. |
| `use_rep` | string | "X_pca" | — | obsm key of the embedding from which group centroids are computed. |
| `n_pcs` | integer/null | null | min 1 | Leading components of use_rep to use; null uses all of them. |
| `cut_ks` | array | [5, 10, 20] | — | Cluster counts for cut labels; pass the expert-label count when a reference exists. |
| `name` | string | "hierarchy" | — | Prefix for written members, for example uns/hierarchy/linkage. |
| `seed` | integer | 0 | — | Random seed for persistence subsamples; unused when persistence.n_bootstrap is 0. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA only for large distance matrices or persistence. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `persistence` | object | — | — | Split persistence under cell subsampling; disabled by default. |
| `persistence.n_bootstrap` | integer | 0 | min 0 | Number of subsample trees; 0 disables persistence. |
| `persistence.subsample_fraction` | number | 0.5 | > 0; < 1 | Fraction of cells per subsample, drawn without replacement. |
| `persistence.threshold` | number | 0.8 | min 0; max 1 | Fraction of subsample trees in which a clade must appear to count as persistent. |
<!-- PARAMS:AUTO:END -->

`method` sets both distance and linkage, so there is no separate linkage option. All methods use centroids from `use_rep` and `n_pcs`; complete_correlation correlates over those coordinates, the PC-space variant of the scanpy convention. `groupby` must not be an author label column when those labels are scored (section 8). Each `cut_ks` value must not exceed the number of leaves. `seed` and `persistence` matter only when `persistence.n_bootstrap` exceeds 0. Two trees on one dataset need different `name` values.

## 7. MCP tool

Tool name `singlet_clustering_hierarchical_cluster_tree` (definition in `tasks/mcp/singlet_clustering_hierarchical_cluster_tree.json`). Example call:

```json
{"dataset": "/data/atlas.singlet", "groupby": "leiden_r0.5", "cut_ks": [6, 12]}
```

Example result:

```json
{"dataset": "/data/atlas.singlet", "status": "completed",
 "wrote": ["uns/hierarchy/linkage", "uns/hierarchy/newick", "uns/hierarchy/distance", "obs/hierarchy_cut_6", "obs/hierarchy_cut_12"],
 "summary": {"method": "ward_centroid", "n_leaves": "<int>", "monotone": true, "cut_sizes": {"6": "<int>", "12": "<int>"}},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: only persistence can return `queued`, because it recomputes centroids for every subsample. Stochastic: outputs depend on `seed` only when `persistence.n_bootstrap` is above 0. Dry run: `estimate` gives seconds, peak memory and device, scaling with $k$, the cell number and `persistence.n_bootstrap`.

## 8. Benchmarks

**Shared protocol.** Every benchmark uses the embedding fixed by the tasks in section 9, the three centroid methods with the conventions of section 4, and the full set of cut heights. The pre-specified cluster count is the primary read-out; other heights are secondary. Seeds, subsample draws and partition resolutions are fixed before scoring. Scores are summarised per seed by median and interquartile range. Benchmarks whose leaves come from the scored labels are not reported.

### B1. Planted hierarchy recovery (proposed)

- **Goal**: test whether the tree recovers a planted nested structure when the leaves are the planted populations.
- **Ground truth**: exact planted tree; each cell carries its planted leaf, and the planted partition at a level is the set of ancestors of those leaves at that depth.
- **Generator recipe** (custom; Splatter [R14] is a one-level sanity check only):
  1. Draw a binary tree $T^*$ with $n_{\mathrm{leaf}}$ leaves and a fixed cell count per leaf; for each internal node $v$, draw $\delta_{vg}\sim N(0,s_{\mathrm{depth}(v)}^2)$ for a random fraction $p$ of genes, else zero.
  2. Set each leaf's log-mean to $b_g+\sum_{v\in\mathrm{path}(\ell)}\delta_{vg}$; draw negative-binomial counts with dispersion $\phi$.
  3. Normalise, select highly variable genes, take principal components, and set the groups to the planted leaves. The grid is fixed before scoring.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted simulations | Recipe above; [R14] for the sanity check | simulated; grid of leaves and cells | — | Exact tree per seed |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Dendrogram purity | Section 3, per planted level | maximise | primary | [R8] |
| Normalised RF | Clade symmetric difference over 2(n−2) | minimise | primary | [R10] |
| Cell ARI | Cut at the planted count | maximise | guardrail | [R11][R12] |
| Dasgupta ratio | $C(\hat T)/C(T^*)$, planted weights | minimise | guardrail | [R9] |
| Split persistence | Section 3; threshold 0.8 | maximise | guardrail, label-free | — |

- **Comparators**: the three centroid methods.
- **Protocol**: a fixed seed set per grid cell, shared by all methods.
- **Acceptance**: proposed, not from the literature. Dendrogram purity and cell ARI are both at least 0.90 at both planted levels, wherever the flat ARI of the planted partition on the same embedding is at least 0.95.
- **Known pitfalls**: planted leaves remove the partition step, so B1 tests linkage, not clustering; strong effects separate leaves trivially, so sweep $s$.

### B2. Flat-cut agreement with expert labels (extended from a flat benchmark)

- **Goal**: test whether the tree cut at the expert-label count agrees with expert labels as well as a flat partition with the same count.
- **Ground truth**: expert labels present in each dataset, one per cell; no label is derived from the tree. Scores treat cells as items.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Author-annotated datasets, one annotation column each | singlet catalogue; list frozen before scoring | scRNA-seq; species and size per dataset in the frozen list | — | Fixed before scoring |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| ARI at the expert count | Cut with $k$ equal to the number of expert labels | maximise | primary | [R11][R12] |
| NMI at the expert count | Arithmetic normaliser, same cut | maximise | guardrail | [R13] |

- **Comparators**: ward_centroid, complete_correlation, complete_euclidean, and the flat partition from clustering.cell_partitioning with the same $k$.
- **Protocol**: leaves from clustering.cell_partitioning at a fixed resolution. Duo et al. [R2] score flat partitions; scoring tree cuts the same way is the extension.
- **Acceptance**: proposed, not from the literature. The ARI of the tree cut is not below the flat partition's ARI at the same $k$ by more than 0.02 on the median dataset.
- **Known pitfalls**: choosing the best height on the labels inflates the score, so the expert count is primary; expert labels are usually flat.

### B3. Agreement with a Cell Ontology hierarchy (proposed)

- **Goal**: test whether cuts of the tree respect the ontology structure of annotated cell types.
- **Ground truth**: author labels mapped to Cell Ontology terms by annotation.cell_ontology_mapping; $A(t)$ holds the is-a ancestors of $t$, including $t$. The ontology tree covers the labels present, one leaf per term. Scores are per cell.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B2 datasets whose labels map to Cell Ontology terms | B2 frozen list | as in B2 | — | Mapping coverage reported per dataset |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Hierarchical F1 | Section 3 definition, mean over cells | maximise | primary | — |
| RF to ontology tree | Leaves collapsed to one per majority term; normalised RF | minimise | guardrail | [R10] |

- **Comparators**: the three centroid methods and the flat partition from clustering.cell_partitioning, mapped the same way.
- **Protocol**: each cut cluster takes the majority term from a random half of cells; scoring uses the other half, repeated over seeds, cutting at the number of mapped terms.
- **Acceptance**: proposed, not from the literature. The hierarchical F1 difference from the flat partition at equal $k$ lies between −0.02 and +0.05 on every dataset.
- **Known pitfalls**: is-a links describe classification, not lineage; annotation granularity differs across studies, so leaf terms need a common level first.

### P1. Performance and scaling

Wall time and peak memory of the centroid pass and of linkage for $k\in\{10,100,1000\}$ centroids in 30 PCs, and of the centroid pass alone for $n\in\{10^4,10^5,10^6\}$ cells, on CPU and CUDA. Comparators are the three centroid implementations in their own languages; pcaReduce is a cell-level cost reference at the sizes where it completes. Hold fixed the embedding dimension, linkage, thread count, hardware and seed. Report log-log exponents with fit error. Proposed acceptance, not from the literature: linkage matrices identical to scipy's on the same inputs (merge order exact, heights within relative $10^{-6}$), and a centroid-pass exponent in $n$ of at most 1.1.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Feeds**:
  - `abundance.hierarchical_composition_test`: Resolution-robust composition testing across a cell-type hierarchy
  - `clustering.cluster_significance_testing`: Testing whether clusters or splits are statistically real, and merging over-split clusters
  - `annotation.hierarchical_annotation`: Hierarchical, ontology-aware coarse-to-fine annotation
- **Reads**: `obsm/X_pca`, `obs/<groupby>`
- **Writes**: `uns/<name>/linkage`, `uns/<name>/newick`, `uns/<name>/distance`, `obs/<name>_cut_<k>`, `uns/<name>/persistence`
<!-- CHAINING:AUTO:END -->

Belongs to no named recipe yet. It turns a fixed partition into a tree for composition and annotation; the feeds should use it only after the section 8 acceptance criteria pass.

## 10. Risks, pitfalls and open questions

- **Evidence gaps and omitted methods.** Primary papers and code of CellBIC, HGC and MarkovHC, all in the local bibliography, are not reviewed here, so these methods appear in no table or enum. A nested stochastic block model on the kNN graph [R15] is the main model-based alternative and is not tabulated. No paper introducing Seurat's BuildClusterTree was identified. The clustree paper's details come from one secondary record, and the first-author spelling in [R2] comes from the local record only. Complexity statements are general knowledge, not taken from [R3].
- **Line references and provenance.** Only the pcaReduce clone records a commit (b7c7707). The scanpy lines are cited at remote HEAD 8ed52d9, and the pegasus, Seurat and scanpy clones may differ from it.
- **Licences and data.** pcaReduce has a GPL DESCRIPTION and no LICENSE file, so no code is ported from it. clustree and Splatter are GPL-3, so no code is ported from them either. The Cell Ontology release for B3 is not fixed. The frozen dataset lists for B2 and B3 must record each dataset's licence before scoring.
- **Model calibration and first experiment.** B1 counts come from the generator, so its calibration is optimistic for real data; B2 and B3 are the first real-data tests. First experiment: on B1 with planted leaves and default settings, compute purity and normalised RF for the three centroid methods over the grid. If ward_centroid misses the proposed gate at either planted level, check the embedding (dim-reduction.pc_number_selection) before comparing methods. Then fit the conjugate merge and check its reliability on the same simulations.

## 11. References

R1. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R2. Du A, Robinson MD, Soneson C. A systematic performance evaluation of clustering methods for single-cell RNA-seq data. *F1000Research* 2018. doi:10.12688/f1000research.15666.1 — verified (corpus)
R3. Müllner D. Modern hierarchical, agglomerative clustering algorithms. *arXiv* 2011. doi:10.48550/arxiv.1109.2378 — verified (corpus)
R4. Ward JH Jr. Hierarchical grouping to optimize an objective function. *Journal of the American Statistical Association* 1963. — unverified (memory)
R5. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R6. Zurauskiene J, Yau C. pcaReduce: hierarchical clustering of single cell transcriptional profiles. *BMC Bioinformatics* 2016. doi:10.1186/s12859-016-0984-y — verified (corpus)
R7. Zappia L, Oshlack A. Clustering trees: a visualization for evaluating clusterings at multiple resolutions. *GigaScience* 2018;7(7). doi:10.1093/gigascience/giy083 — partial (search)
R8. Heller KA, Ghahramani Z. Bayesian hierarchical clustering. *Proceedings of the 22nd International Conference on Machine Learning* 2005. — unverified (memory)
R9. Dasgupta S. A cost function for similarity-based hierarchical clustering. *Proceedings of the 48th Annual ACM Symposium on Theory of Computing* 2016. — unverified (memory)
R10. Robinson DF, Foulds LR. Comparison of phylogenetic trees. *Mathematical Biosciences* 1981. — unverified (memory)
R11. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R12. Santos JM, Embrechts M. On the use of the adjusted Rand index as a metric for evaluating supervised classification. *Artificial Neural Networks – ICANN 2009*. doi:10.1007/978-3-642-04277-5_18 — verified (corpus)
R13. Emmons S, Kobourov S, Gallant M, Börner K. Analysis of network clustering algorithms and cluster quality metrics at scale. *PLOS ONE* 2016. doi:10.1371/journal.pone.0159161 — verified (corpus)
R14. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R15. Morelli L, Giansanti V, Cittaro D. Nested stochastic block models applied to the analysis of single cell data. *BMC Bioinformatics* 2021. doi:10.1186/s12859-021-04489-7 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/lilab-bcb/pegasus | Yiming Yang, Joshua Gould, Bo Li (setup.py); Broad Institute and Genentech (LICENSE) | BSD-3-Clause (LICENSE) | Ward centroid tree; default linkage and backend | port |
| https://github.com/theislab/scanpy | F. Alexander Wolf, P. Angerer, Theis Lab (LICENSE, 2017); scverse (LICENSE, 2025) | BSD 3-Clause (LICENSE) | Correlation centroid tree; dendrogram conventions | port |
| https://github.com/satijalab/seurat | Seurat authors (LICENSE copyright holder) | MIT with file LICENSE | Euclidean centroid tree (BuildClusterTree) | port |
| https://github.com/JustinaZ/pcaReduce | Justina Zurauskiene (maintainer); Christopher Yau (DESCRIPTION) | GPL (>= 2) per DESCRIPTION; no LICENSE file at repo root | Cell-level cost comparator only | callout |
| https://github.com/lazappi/clustree | Luke Zappia, Alicia Oshlack (paper authors) | GPL-3 (LICENSE file) | Cross-resolution nesting reference | callout |
| https://github.com/Oshlack/splatter | Zappia L, Phipson B, Oshlack A (paper authors) | GPL-3 (LICENSE file) | One-level simulation sanity check for B1 | callout |
