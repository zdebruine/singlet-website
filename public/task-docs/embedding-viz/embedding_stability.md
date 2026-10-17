---
id: embedding-viz.embedding_stability
title: Embedding stability across seeds, subsamples and hyperparameters
area: embedding-viz
scope: core
paradigm: hybrid
literature_status: open
priority: P2
depends_on: [dim-reduction.normalized_cell_embedding, clustering.cell_partitioning]
feeds: [embedding-viz.hyperparameter_selection, embedding-viz.cluster_gap_artifact_detection, clustering.cluster_significance_testing]
reads: [obsm/X_pca, obsp/connectivities, obs/leiden]
writes: [obsm/stability_rep<r>, uns/embedding_stability, obs/embedding_stable_cluster]
devices: [cpu, cuda]
mcp_tool: singlet_embedding_viz_embedding_stability
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Embedding stability across seeds, subsamples and hyperparameters

> Measures how much a two-dimensional map, and the cluster flags drawn from it, change under a different random seed, cell subsample or graph rebuild.

## 1. Question

For $n$ cells with a fixed matrix of principal components, how much does a two-dimensional embedding change when only the random seed, a cell subsample or the neighbour graph is perturbed? Inputs are the components and the perturbations. Outputs are a Procrustes disparity and a neighbour-overlap score per configuration, read against a chance value, and a stable or unstable flag per cluster. A stable map is self-consistent, which is not the same as faithful to the data. Sweeping perplexity, neighbour count or `min_dist` belongs to embedding-viz.hyperparameter_selection, and non-2D representations are outside this document.

## 2. Why this task matters and where the field stands

Neighbour embeddings are non-convex, so their optimum depends on initialisation and on the random sampling used by the optimiser [R6, R5]. Kobak and Linderman report that initialisation largely fixes the global layout of t-SNE and UMAP maps, and the literature expects local cluster membership to be more stable than that layout [R2]. Readers judge clusters by eye on these maps, so a layout that changes with the seed misleads them. Benchmarks of single-cell dimensionality reduction include robustness among their criteria [R14], but no accepted benchmark scores seed or subsample stability of two-dimensional maps.

The status is **open**. Subsampling-based robustness is an established heuristic for clustering [R9, R10], and it is kept here as the comparator. The caution that a stable map can still be wrong is attributed to [R3]. Open problems:

1. No accepted ground truth exists for seed or subsample stability of two-dimensional maps, so every accuracy benchmark in section 8 is proposed.
2. The cut-offs of the subsample procedure are rules of thumb, which its README calls subjective (section 4).
3. Stability of cluster membership and of inter-cluster geometry can disagree, and no unified score is established.

## 3. Theory and insight

Let $\bar X_a,\bar X_b\in\mathbb R^{n\times 2}$ be two replicate maps of the same cells, column-centred, and let $\mathcal N^{(a)}_k(i)$ be the $k$ nearest neighbours of cell $i$ in map $a$, with ties broken by cell index. Each output has one estimand and one normalisation.

- $S_k$ is the mean over cells of the fraction of neighbours shared by two maps. It lies in $[0,1]$ and is read against its chance value $k/(n-1)$.
- $D$ is the orthogonal Procrustes disparity [R12] after optional isotropic scaling, normalised by the squared norm of the first centred map. With scaling it lies in $[0,1]$, and it is zero when the maps agree up to a similarity transform.
- $\mathrm{stab}(C)$ is the median over subsamples of the best Jaccard match to a full-data cluster $C$. It lies in $[0,1]$.

$$S_k=\frac1n\sum_{i=1}^{n}\frac1k\bigl|\mathcal N^{(a)}_k(i)\cap\mathcal N^{(b)}_k(i)\bigr|,\qquad D=\min_{Q^\top Q=I,\;s>0}\frac{\lVert\bar X_a-s\,\bar X_bQ\rVert_F^2}{\lVert\bar X_a\rVert_F^2}$$

With $\bar X_b^\top\bar X_a=U\Sigma V^\top$, the optimal rotation is $Q^\star=UV^\top$, and the optimal scale gives $D=1-(\operatorname{tr}\Sigma)^2/(\lVert\bar X_a\rVert_F^2\lVert\bar X_b\rVert_F^2)$. This is exact when reflections are allowed. If reflections are excluded, $\operatorname{tr}\Sigma$ becomes $\operatorname{tr}(\Sigma S)$ with $S=\operatorname{diag}(1,\det(UV^\top))$. The identity says nothing about non-rigid distortion, and large coordinates dominate both norms.

If the neighbour sets of two maps were independent uniform $k$-subsets of the other $n-1$ cells, each neighbour would be shared with probability $k/(n-1)$, so $\mathbb E\,S_k=k/(n-1)$ exactly. Real maps are not independent, so $S_k$ is read against this value and not against zero.

The t-SNE objective is $C=\sum_{i\neq j}p_{ij}\log(p_{ij}/q_{ij})$, with perplexity-matched input affinities $p_{ij}$ and $q_{ij}\propto(1+\lVert y_i-y_j\rVert^2)^{-1}$ [R6]. UMAP minimises

$$C=\sum_{i\neq j}\Bigl[\mu_{ij}\log\tfrac{\mu_{ij}}{\nu_{ij}}+(1-\mu_{ij})\log\tfrac{1-\mu_{ij}}{1-\nu_{ij}}\Bigr],\qquad \nu_{ij}=\bigl(1+a\lVert y_i-y_j\rVert^{2b}\bigr)^{-1}$$

by negative sampling [R5], so the seed acts on both the start and the sampled gradients. Both objectives are non-convex, and the seed acts most strongly on inter-cluster geometry [R2]. Subsample stability uses the Jaccard index $J(A,B)=|A\cap B|/|A\cup B|$ and $\mathrm{stab}(C)=\operatorname{median}_s\max_{C'\in\mathcal C_s}J(C,C')$ [R9].

The heuristic scores depend only on the replicate maps and give no uncertainty for one cell. $D$ is dominated by global layout, where initialisation acts, while $S_k$ is dominated by local neighbourhoods. The two can disagree, so both are reported. t-SNE and UMAP sit on one attraction-repulsion spectrum [R8], which could parametrise expected variability; that is not used here.

$S_k$ depends on $k$ and on local density, so sparse regions inflate differences and dense clusters saturate near one. A collapsed map gives high overlap and low disparity, which the chance value exposes. Randomised SVD or randomised neighbour search inside the pipeline adds seed dependence unrelated to the objective. Choosing the best-looking seed after the fact inflates stability. Varying the components or the graph with the seed measures pipeline stability rather than embedding stability, so the measured quantity must be stated with every result.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| UMAP (umap-learn) | model-based | Cross-entropy between a fuzzy kNN graph and output memberships, optimised with negative sampling | [R4, R5] |
| t-SNE (openTSNE, PCA initialisation) | model-based | KL divergence between perplexity-matched input affinities and Student-t map affinities | [R1, R6] |
| PaCMAP | hybrid | Weighted loss over neighbour, mid-near and further pairs, with PCA initialisation | [R7] |
| Subsample Jaccard cluster stability | heuristic | Median best-match Jaccard of each full-data cluster across re-clustered subsamples | [R9, R10] |
| Co-ranking neighbour recall | heuristic | Shared-neighbour fraction from the co-ranking framework, precedent for $S_k$ | [R13] |

The published standard for stability is the subsample Jaccard procedure, which stays as the comparator. No published method scores seed-to-seed stability of two-dimensional maps, so the overlap and disparity statistics are defined in section 3. Each embedder is compared under its own library initialisation, because initialisation changes the global layout [R2]. Defaults used below:

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| Subsample Jaccard | subsample fraction | 0.8 (README example) | `README.md:56-90` @ b1b22c7 |
| Subsample Jaccard | subsamples | 20 (README example) | `README.md:56-90` @ b1b22c7 |
| Subsample Jaccard | unstable cutoff | 0.6 | `README.md:56-90` @ b1b22c7 |
| Subsample Jaccard | highly stable rule of thumb | 0.85 | `README.md:56-90` @ b1b22c7 |
| UMAP | init | spectral | `umap/umap_.py:1760` @ 33d7e6f |
| UMAP | parallel (simplicial_set_embedding) | False | `umap/umap_.py:1020` @ 33d7e6f |
| UMAP | random_state set | forces n_jobs=1 with a warning | `umap/umap_.py:2035-2038` @ 33d7e6f |
| openTSNE | initialization | pca | `openTSNE/tsne.py:1155` @ c2a8b28 |
| PaCMAP | init | pca (docstring default) | `source/pacmap/pacmap.py:1743` @ 2e7237a |
| PaCMAP | apply_pca | True | `source/pacmap/pacmap.py:1720` @ 2e7237a |

## 5. Proposed singlet approach

**Routes.** UMAP, openTSNE and PaCMAP are ported, as their licences are permissive. The subsample procedure is ported from the scclusteval README. Overlap and disparity are reimplemented from section 3.

**Model.** Let $z_{ir}\in\mathbb R^2$ be cell $i$ in replicate $r$, aligned to replicate 0 by the scale-optimal similarity transform. We model $z_{ir}=\mu_i+\varepsilon_{ir}$ with $\varepsilon_{ir}\sim\mathcal N(0,\Sigma_i)$ independent over $r$, shrinking $\Sigma_i$ toward its cluster's pooled covariance by empirical Bayes. Displacement $\operatorname{tr}\Sigma_i$ is reported in units of the root-mean-square radius of the centred first map. A cluster is flagged unstable when the posterior probability that its mean displacement exceeds a scale $\tau$ reaches a threshold, with $\tau$ and the threshold set on B1 to match the nominal null false-positive rate. The Gaussian form is first order, for small, roughly isotropic displacements. Five replicates leave four residual degrees of freedom per cell, so shrinkage is needed.

**Falsification.** Rejected on B1 if its AUROC does not exceed the subsample comparator's or its null false-positive rate is higher.

**Stack and resources.** The model is closed form and needs no trained network, so PyTorch is not used. The 2×2 SVDs and set intersections may be hard-coded in CUDA, with the CPU path as reference. Overlap runs in row blocks, so neighbour lists need $O(nk)$ memory. Subsample re-clustering keeps the components fixed; the README's re-run of variable-gene selection and PCA measures pipeline stability and is not the default.

**Defaults.** The proposed default method is `umap` with library initialisation. Agents use the section 6 defaults without asking.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/X_pca | float32, n × d | Input components; the `representation` parameter may name another key. |
| read | obsp/connectivities | sparse | Fixed graph reused across replicates when `neighbour_overlap.recompute_graph_per_seed` is false. |
| read | obs/leiden | categorical | Full-data clusters for the subsample procedure (`scclusteval.cluster_key`). |
| write | obsm/stability_rep<r> | float32, n × 2 | Unaligned replicate map for replicate r. |
| write | uns/embedding_stability | table | Per method and setting: seeds, D with and without scale, $S_k$ with its chance value, flagged clusters. |
| write | obs/embedding_stable_cluster | categorical | Per-cell full-data cluster and its stable or unstable flag. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "umap" | `umap`, `opentsne`, `pacmap` | Embedding whose stability is measured; umap is the proposed default. |
| `representation` | string | "X_pca" | — | Key in obsm holding the components; the same matrix is used for every replicate. |
| `init` | string | "default" | `default`, `pca`, `spectral`, `random` | default is each method's library initialisation; spectral is valid for umap only. |
| `n_seeds` | integer | 5 | min 2 | Number of replicate embeddings, each with its own seed derived from the base seed. |
| `seed` | integer | 0 | min 0 | Base seed; replicate seeds are derived from it deterministically. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device for one replicate and for the full run, without running. |
| `overwrite` | boolean | false | — | Replace existing members written by this tool instead of failing. |
| `neighbour_overlap` | object | — | — | Options for the kNN overlap statistic. |
| `neighbour_overlap.k` | integer | 15 | min 1 | Neighbourhood size; must be below the number of scored cells minus one. |
| `neighbour_overlap.recompute_graph_per_seed` | boolean | false | — | Rebuild the kNN graph for each replicate, so the score includes graph variability. |
| `procrustes` | object | — | — | Options for Procrustes disparity. |
| `procrustes.scale` | boolean | true | — | Allow an isotropic scale when aligning replicate maps. |
| `procrustes.allow_reflection` | boolean | false | — | Allow orthogonal alignments that include reflections. |
| `scclusteval` | object | — | — | Options for subsample Jaccard cluster stability. |
| `scclusteval.cluster_key` | string | "leiden" | — | Obs key of the full-data clusters to score. |
| `scclusteval.subsample_fraction` | number | 0.8 | > 0; < 1 | Fraction of cells per subsample, drawn without replacement. |
| `scclusteval.n_subsamples` | integer | 20 | min 1 | Number of subsample re-clusterings. |
| `scclusteval.jaccard_cutoff` | number | 0.6 | min 0; max 1 | Clusters with median Jaccard below this value are flagged unstable. |
<!-- PARAMS:AUTO:END -->

Method-specific options are nested. The `init` value `spectral` is valid for `umap` only; `default` resolves to spectral for umap and to PCA for openTSNE and PaCMAP. `neighbour_overlap.k` must be below the number of scored cells minus one, and `n_seeds` must be at least two. The `scclusteval` block applies to every method and is skipped when its cluster key is absent.

## 7. MCP tool

Tool name `singlet_embedding_viz_embedding_stability` (definition in `tasks/mcp/singlet_embedding_viz_embedding_stability.json`). Example call and result:

```json
{"dataset": "example.singlet", "method": "umap", "n_seeds": 5, "seed": 0, "scclusteval": {"cluster_key": "leiden"}}
```

```json
{"dataset": "example.singlet", "status": "completed", "wrote": ["obsm/stability_rep<r>", "uns/embedding_stability", "obs/embedding_stable_cluster"], "summary": {"n_seeds": 5, "median_procrustes_disparity": "<float>", "mean_neighbour_overlap": "<float>", "chance_overlap": "<float>", "n_clusters_flagged": "<int>"}, "provenance_id": "<id>"}
```

Long-running: yes; the run may be queued, returning status `queued` and a `job_id`. Stochastic: yes; replicate seeds are derived from `seed`. Dry run: returns the estimated time, peak memory and device for one replicate and for the full run.

## 8. Benchmarks

**Shared protocol.** Unless a benchmark states otherwise, inputs are 50 principal components of normalised expression and $k=15$. Replicates use five seeds derived from a base seed. Subsamples are 80% of cells drawn without replacement, 20 per clustering. Leiden runs on a kNN graph of the fixed components, rebuilt for each subsample, at a resolution fixed across conditions. Metrics use only cells present in every replicate. Software versions and hardware are written to the output.

### B1. Planted-structure calibration of cluster stability flags

- **Goal**: check that the subsample flag separates simulated groups from splits within one population.
- **Ground truth**: planted simulation. In multi-group simulations a cluster is real when one group holds at least 0.8 of its cells, otherwise null; single-population clusters are null by construction. Estimand: a binary label per cluster, summarised as AUROC and as the null fraction flagged stable.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Multi-group Splatter simulations | Splatter [R11] | simulated scRNA-seq; 10^4 cells; grid over group count and DE strength | — | Generator defines the truth |
| Single-population Splatter simulations | Splatter [R11] | simulated scRNA-seq; 10^4 cells; one group | — | Null by construction |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC, real versus null | Mann–Whitney over clusters, scored by median Jaccard; ties average | maximise | primary | [R9, R11] |
| Null false-positive rate | fraction of null clusters at or above the section 4 cutoff | minimise | guardrail | [R9] |

- **Comparators**: subsample Jaccard flag; per-cluster neighbour overlap and Procrustes disparity; the variance flag of section 5.
- **Protocol**: shared protocol on the Splatter grid.
- **Acceptance criterion**: AUROC at least 0.90 and null false-positive rate at most 0.05. Proposed.
- **Known pitfalls**: the simulator defines the truth, so results are optimistic; vary effect sizes, and fix the Leiden resolution across conditions.

### B2. Seed-to-seed Procrustes disparity by initialisation

- **Goal**: test whether PCA or spectral initialisation reduces across-seed variation in global layout.
- **Ground truth**: consistency. The ordering is fixed before running: median $D$ under PCA or spectral initialisation is below that under random initialisation. Estimand: median $D$ over replicate-map pairs.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_mouse_pancreas_atlas | OpenProblems dimensionality-reduction resource | scRNA-seq, mouse pancreas; size — | — | Name from the task resource |
| Author-annotated catalogue datasets | singlet catalogue (354M cells, about 40% annotated) | scRNA-seq; species per dataset | singlet internal | At least 10^4 annotated cells; fixed before running |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Median pairwise $D$ | over $R=10$ replicate maps; with and without scale | minimise | primary | [R12, R2] |
| Mean neighbour overlap $S_k$ | over cells, reported against $k/(n-1)$ | maximise | guardrail | [R2] |

- **Comparators**: openTSNE (PCA, random initialisation); UMAP (random, spectral initialisation).
- **Protocol**: fixed components and, where accepted, a fixed graph; only seed and initialisation vary; ten seeds per setting.
- **Acceptance criterion**: PCA or spectral initialisation gives lower median $D$ than random initialisation in at least 90% of datasets, with overlap at most 0.05 below the random value. Proposed.
- **Known pitfalls**: the expected ordering is a literature expectation, not a benchmark result; rebuilding the graph per seed mixes graph and layout variability.

### B3. Agreement of stable clusters with author annotations

- **Goal**: check that stable clusters are coherent with annotated groups and cover the annotated types.
- **Ground truth**: expert labels; a cluster takes its majority author label. Estimand: purity is the cell-weighted fraction of stable-cluster cells with their cluster's majority label; recall is the fraction of labels with at least 50 cells that have a majority-matching stable cluster.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_mouse_pancreas_atlas | OpenProblems dimensionality-reduction resource | scRNA-seq, mouse pancreas; size — | — | Provenance per section 10 |
| Author-annotated catalogue datasets | singlet catalogue, selection rule of B2 | scRNA-seq; species per dataset | singlet internal | Provenance per study |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Cell-weighted purity | of stable clusters, at or above the cutoff of section 4 | maximise | primary | [R9] |
| Recall of labels | as defined above, for labels with at least 50 cells | maximise | guardrail | [R9] |

- **Comparators**: subsample Jaccard flags; neighbour-overlap-only flags; no stability filter.
- **Protocol**: shared protocol on each annotated dataset, for UMAP, openTSNE (PCA) and PaCMAP.
- **Acceptance criterion**: purity at least 0.90 and recall at least 0.80 at the cutoff. Proposed, not from the literature.
- **Known pitfalls**: labels made on the same embedding make agreement circular; labels are not structural truth, so recall depends on annotation granularity.

### P1. Performance and scaling

Measure wall time per replicate, total stability time, peak resident memory and the time of the overlap step alone, at 10^4, 10^5 and 10^6 cells, on CPU and CUDA. Compare UMAP (spectral), openTSNE (PCA), PaCMAP (PCA) and exact versus approximate kNN for the overlap. Hold fixed 50 components, $k=15$, five seeds and 20 subsamples at 80%, and record hardware. The 10^6 value is a grid point, not a dataset size. Seeded UMAP runs on one thread (section 4), so compare it only with single-thread settings. For large $n$ the overlap uses a fixed random subset of cells, with its size set before running.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Feeds**:
  - `embedding-viz.hyperparameter_selection`: Selection of perplexity, neighbour count, min_dist and initialization
  - `embedding-viz.cluster_gap_artifact_detection`: Detection of artefactual clusters, gaps and distances in a 2D map
  - `clustering.cluster_significance_testing`: Testing whether clusters or splits are statistically real, and merging over-split clusters
- **Reads**: `obsm/X_pca`, `obsp/connectivities`, `obs/leiden`
- **Writes**: `obsm/stability_rep<r>`, `uns/embedding_stability`, `obs/embedding_stable_cluster`
<!-- CHAINING:AUTO:END -->

A diagnostic that follows the standard embedding and clustering steps. No named recipe is assigned yet.

## 10. Risks, pitfalls and open questions

- **Evidence not independently confirmed.** Kobak and Berens 2019 was not available as full text; its claims come from a best-practice summary and a repository citation. Chari and Pachter 2023 is cited for its title, venue and DOI, so the stable-but-wrong argument rests on its title. The authors of [R9] and [R10], and the venue of [R10], were not matched in the corpus. Random initialisation for openTSNE and PaCMAP was not checked in their code. FIt-SNE's code and defaults were not read, so it is excluded from the method values and from P1. scipy's Procrustes normalisation was not compared with section 3. Line numbers refer to corpus copies; each hash is the remote head at checking time.
- **Unsettled literature.** No accepted truth exists for seed or subsample stability, and the cut-offs of section 4 are rules of thumb. Whether stability is reported per cell, per cluster or per map region is open. The relation to structure preservation is untested; the preprint [R15] proposes a framework for it, and its results were not read.
- **Technical and data risks.** Seeded UMAP runs single-threaded, so timings differ from parallel runs. Randomised SVD or neighbour search in the pipeline adds seed dependence. Annotations may come from a UMAP of the same cells, which makes B3 circular. The Splatter licence was not read, and its repository URL is taken from a corpus clone name. Non-2D latent representations from the merged entry are not specified.
- **First experiment.** Run B1 on the Splatter grid, including the single-population null, before any real-data claim, to measure both flags on data with known truth.

## 11. References

R1. Kobak D, Berens P. The art of using t-SNE for single-cell transcriptomics. *Nature Communications* 2019. doi:10.1038/s41467-019-13056-x — verified (corpus)
R2. Kobak D, Linderman GC. Initialization is critical for preserving global data structure in both t-SNE and UMAP. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00809-z — verified (corpus)
R3. Chari T, Pachter L. The specious art of single-cell genomics. *PLOS Computational Biology* 2023. doi:10.1371/journal.pcbi.1011288 — verified (corpus)
R4. Becht E, McInnes L, Healy J, Dutertre CA, Kwok IWH, Ng LG, Ginhoux F, Newell EW. Dimensionality reduction for visualizing single-cell data using UMAP. *Nature Biotechnology* 2019. doi:10.1038/nbt.4314 — verified (corpus)
R5. McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction. *arXiv preprint* 2018; arXiv:1802.03426. doi:10.48550/arxiv.1802.03426 — verified (corpus)
R6. van der Maaten L, Hinton G. Visualizing Data using t-SNE. *Journal of Machine Learning Research* 2008. — verified (corpus)
R7. Wang Y, Huang H, Rudin C, Shaposhnik Y. Understanding How Dimension Reduction Tools Work: An Empirical Approach to Deciphering t-SNE, UMAP, TriMap, and PaCMAP for Data Visualization. *Journal of Machine Learning Research* 2021; 22(201). — partial (repo)
R8. Bohm JN, Berens P, Kobak D. Attraction-Repulsion Spectrum in Neighbor Embeddings. *Journal of Machine Learning Research* 2022. — verified (corpus)
R9. —. Evaluating single-cell cluster stability using the Jaccard similarity index. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa956 — verified (corpus)
R10. —. Selecting single cell clustering parameter values using subsampling-based robustness metrics. 2021. doi:10.1186/s12859-021-03957-4 — verified (corpus)
R11. Zappia L, Phipson B, Oshlack A. Splatter: Simulation of Single-Cell RNA Sequencing Data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R12. Gower JC. Generalized procrustes analysis. *Psychometrika* 1975. doi:10.1007/bf02291478 — verified (corpus)
R13. Lueks W, Mokbel B, Biehl M, Hammer B. How to Evaluate Dimensionality Reduction? - Improving the Co-ranking Matrix. *arXiv preprint* 2011; arXiv:1110.3917. doi:10.48550/arxiv.1110.3917 — verified (corpus)
R14. Sun S, Zhu J, Ma Y, Zhou X. Accuracy, robustness and scalability of dimensionality reduction methods for single-cell RNA-seq analysis. *Genome Biology* 2019. doi:10.1186/s13059-019-1898-6 — partial (search)
R15. Novak D, de Bodt C, Lambert P, Lee JA, Van Gassen S, Saeys Y. A framework for quantifiable local and global structure preservation in single-cell dimensionality reduction. *bioRxiv* 2023 (preprint). doi:10.1101/2023.11.23.568428 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/lmcinnes/umap | Leland McInnes (LICENSE.txt copyright) | BSD-3-Clause | UMAP embedder whose stability is measured | port |
| https://github.com/pavlin-policar/openTSNE | Pavlin Policar (LICENSE copyright, setup.py author) | BSD-3-Clause | openTSNE embedder with PCA initialisation | port |
| https://github.com/YingfanWang/PaCMAP | Yingfan Wang, Haiyang Huang, Cynthia Rudin, Yaron Shaposhnik (pyproject.toml) | Apache-2.0 | PaCMAP embedder | port |
| https://github.com/crazyhottommy/scclusteval | Ming Tang (LICENSE.md copyright) | MIT | subsample Jaccard procedure | port |
| https://github.com/scipy/scipy | SciPy Developers (LICENSE.txt) | BSD-style | Procrustes comparator in benchmarks | callout |
| https://github.com/Oshlack/splatter | — | GPL-3.0 (LICENSE) | simulator for B1 data | callout |
