---
id: embedding-viz.hyperparameter_selection
title: Selection of perplexity, neighbour count, min_dist and initialization
area: embedding-viz
scope: core
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection, embedding-viz.local_neighborhood_preservation]
feeds: [embedding-viz.embedding_stability, embedding-viz.cluster_gap_artifact_detection]
reads: [obsm/<reference.key>]
writes: [obsm/hyper_<embedding>, uns/hyper_<embedding>, obs/hyper_<embedding>_dubious]
devices: [cpu, cuda]
mcp_tool: singlet_embedding_viz_hyperparameter_selection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Selection of perplexity, neighbour count, min_dist and initialization

> Chooses t-SNE or UMAP hyperparameters for a fixed reference by scoring every candidate with label-free criteria, then writes the selected map with the scores that justify it.

## 1. Question

Given the first $n$ principal components $X$ of a dataset and candidate values of perplexity or $n_{\text{neighbors}}$, `min_dist`, learning rate, early exaggeration and initialization, which setting gives a two-dimensional map that keeps the neighbourhoods of $X$ and reproduces across seeds, without judging the map by eye? The output is one map, the per-setting scores and the rule used. A correct answer ranks settings by neighbourhood faithfulness and stability, not by the spacing of clusters on the map.

## 2. Why this task matters and where the field stands

Two-dimensional maps are used to judge clusters by eye, yet cluster sizes and inter-cluster distances carry little meaning and change with initialisation [R15]. Initialisation is critical for preserving global structure in t-SNE and UMAP [R3]. Perplexity or $n_{\text{neighbors}}$ fixes the input graph, so the same data yield different maps [R2, R5].

Status: **contested**. Library defaults are widely used. Belkina et al. stress the learning rate for large data [R4], and scDEED flags unreliable cells per setting [R12]. Open problems: (1) loss values are comparable only for one input graph, so settings with different perplexity cannot be ranked by loss; (2) rank-based neighbourhood scores favour local structure [R6]; (3) it is not known whether dubious-cell flags track biological validity.

## 3. Theory and insight

Perplexity sets a per-cell Gaussian bandwidth in the input space, and t-SNE matches input and map affinities [R1]:

$$
p_{j\mid i}=\frac{\exp(-\lVert x_i-x_j\rVert^{2}/2\sigma_i^{2})}{\sum_{k\ne i}\exp(-\lVert x_i-x_k\rVert^{2}/2\sigma_i^{2})},\qquad \mathrm{Perp}_i=2^{H_i},\quad H_i=-\sum_{j\ne i}p_{j\mid i}\log_2 p_{j\mid i}
$$

$$
\mathrm{KL}(P\Vert Q)=\sum_{i\ne j}p_{ij}\log\frac{p_{ij}}{q_{ij}},\qquad p_{ij}=\frac{p_{j\mid i}+p_{i\mid j}}{2n},\qquad q_{ij}\propto(1+\lVert y_i-y_j\rVert^{2})^{-1}
$$

Since $H_i\le\log_2(n-1)$, a perplexity must lie below $n-1$ for $\sigma_i$ to exist (derived here). Settings act in two stages. Perplexity, and $n_{\text{neighbors}}$ in UMAP [R5], changes $P$, so loss values are comparable only for one $P$. Learning rate, exaggeration, iterations and initialisation change the path to a minimum for fixed $P$.

Neighbourhood scores use ranks, with ties broken by cell index so that ranks are integers. Let $r_{ij}$ and $\hat r_{ij}$ be the reference and map ranks of $j$ around $i$, and $Q_{ab}$ count pairs with ranks $(a,b)$. The co-ranking quality $Q_{NX}(K)$ and its chance-corrected form LCMC are [R6, R7, R8]

$$
Q_{NX}(K)=\frac{1}{Kn}\sum_{a,b\le K}Q_{ab}=\frac1n\sum_i\frac{\lvert N^X_K(i)\cap N^Y_K(i)\rvert}{K},\qquad \mathrm{LCMC}(K)=Q_{NX}(K)-\frac{K}{n-1}.
$$

The first form is mean $K$-nearest-neighbour recall. For a random map each cell's expected overlap is $K^2/(n-1)$, so $\mathbb E\,Q_{NX}(K)=K/(n-1)$ and $\mathbb E\,\mathrm{LCMC}(K)=0$, under independence of map neighbours from reference ranks.

scDEED [R12] scores each cell by correlating its map distances, listed in reference-neighbour order, with the sorted map distances over the $m=\lfloor s\,n\rfloor$ nearest reference neighbours. It repeats this on data in which each gene's values are permuted across cells, which keeps marginals and removes gene correlation. A cell is dubious when its score falls below the 5% quantile of the pooled null. The null map is recomputed at every setting, so each setting is compared with its own null. If original and null scores were exchangeable, about 5% of cells would be flagged.

Estimands, one sentence each:
- $Q_{NX}(K)$: mean fraction of each scored cell's $K$ reference neighbours kept in the map, in $[0,1]$; the scored size $m$ must match across compared settings.
- LCMC: $Q_{NX}(K)$ minus its chance value, zero in expectation for a random map and negative when worse than chance.
- Dubious fraction: flagged cells divided by $m$, a proportion and not a probability of error.
- Across-seed 30-NN Jaccard: mean of $\lvert A\cap B\rvert/\lvert A\cup B\rvert$ over cells and seed pairs, with chance about $15/(m-1)$ for $m\gg30$.
- Planted-label ARI: agreement of $k$-means on the map with planted labels, zero at chance.
- Centroid correlation: Spearman correlation over the $K(K-1)/2$ pairs of centroids, so $K=5$ rests on ten pairs.

Insight: loss and neighbourhood scores answer different questions. Loss is comparable only within one $P$, and neighbourhood scores compare across $P$ but favour local structure. A label-free rule therefore needs an input-based score to choose $P$ and a loss-based check within it. Pitfalls: a single seed can misrank settings at small $N$; choosing and reporting on the same cells inflates quality; agreement with PCA geometry is not agreement with biology.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Library defaults (openTSNE, scanpy, umap-learn) | heuristic | Fixed published values; openTSNE's learning rate scales with cell number over exaggeration | [R2, R4] |
| Initialisation from leading PCs (t-SNE) or spectral embedding (UMAP) | heuristic | Start from the first two PCs scaled to a small standard deviation, or from a graph spectrum | [R3, R2] |
| Multiscale perplexity affinity (openTSNE) | model-based | Input affinity is a mixture of Gaussian kernels at several perplexities | [R2] |
| scDEED dubious-cell count | model-based | Per-cell correlation against a permutation null; choose the setting with fewest dubious cells | [R12] |
| Co-ranking grid search (singlet proposal) | heuristic | Score every setting by seed-averaged $Q_{NX}(30)$ with a stability tie-break | [R6, R7] |

The published standards are the library defaults, with openTSNE's learning-rate convention [R4], the perplexity and exaggeration advice cited by the FIt-SNE README [R2], and the scDEED count [R12]. Defaults ignore the dataset, and scDEED needs one permuted embedding per setting. Singlet makes the co-ranking grid its default and keeps the others as comparators and rules.

| Method | Parameter | Value | Source (file:line @ commit, or stated rule) |
|---|---|---|---|
| openTSNE t-SNE | perplexity | 30 | `openTSNE/tsne.py:1144` @ c2a8b28 |
| openTSNE t-SNE | learning rate | `auto`: cell number over exaggeration (exaggeration 1 if unset) | `tsne.py:94-97`; docstring credits Belkina et al. at `tsne.py:287-288` |
| openTSNE t-SNE | early exaggeration | 12, or max(12, exaggeration) | `tsne.py:1174-1178` |
| openTSNE t-SNE | early exaggeration iterations; iterations; late exaggeration | 250; 500; none | `tsne.py:1146, 1148, 1149` |
| openTSNE t-SNE | initialization | pca | `tsne.py:1155` |
| scanpy t-SNE | perplexity; early exaggeration; learning rate | 30; 12; 1000 | `src/scanpy/tools/_tsne.py:31, 33, 34` @ 8ed52d9 |
| umap-learn UMAP | n_neighbors; min_dist; init; learning rate | 15; 0.1; spectral; 1.0 | `umap/umap_.py:1752, 1761, 1760, 1759` @ 33d7e6f |
| scanpy UMAP | min_dist; init_pos | 0.5; spectral | `src/scanpy/tools/_umap.py:37, 44` @ 8ed52d9 |
| FIt-SNE guidance | PCA start scale | standard deviation 0.0001 | `README.md:15` @ 47ff14f |
| scDEED | similarity_percent; dubious and trustworthy cutoffs | 0.5; 0.05 and 0.95 | `R/scDEED.R:148, 150` @ 920acbc |
| scDEED | t-SNE perplexity grid | 20 to 410 step 30; 450 to 800 step 50 | `R/scDEED.R:149` |
| scDEED | UMAP grid | n_neighbors 5, 20, 30, 40, 50; min.dist 0.1, 0.4 | `R/scDEED.R:148` |
| scDEED | seeds | permutation 1000; embeddings 100 | `R/scDEED.R:19, 59, 77` |
| OpenProblems co-ranking | metrics | QNX and LCMC at k=30 | `src/metrics/coranking/config.vsh.yaml` @ 360499d |
| OpenProblems density | n_neighbors; seed | 30; 42 | `src/metrics/density_preservation/config.vsh.yaml:24, 28` @ 360499d |
| OpenProblems t-SNE | PCA dimensions | 50 | `src/methods/tsne/config.vsh.yaml:46` @ 360499d |
| singlet proposal | grids; seeds; scored sample | perplexity 15, 30, 50, 100; n_neighbors 10, 15, 30, 50; min_dist 0.1, 0.3, 0.5; 5 seeds; 5,000 cells | proposed |

## 5. Proposed singlet approach

**Routes.** `scdeed` is ported, since its package has a permissive licence (section 12); its statistic, permutation and per-setting null are short to re-express in the C++ core. `grid_search` is reimplemented from the co-ranking definitions, because the reference implementation is copyleft. `rule_based` calls the embedding implementation of the large-scale embedding task with library defaults.

**Model-based layer (proposed).** A Gaussian-process surrogate over the grid, fitted to seed-averaged $Q_{NX}(30)$ with expected-improvement acquisition, used when the grid exceeds the embedding budget. A predictor of the best perplexity or neighbour count from dataset statistics (cell number, PCA spectrum decay, kNN distance distribution), trained on catalogue subsamples with exhaustive-grid optima as targets. It needs no annotation. B1 falsifies the predictor and P1 the surrogate.

**ML stack.** PyTorch trains the predictor and surrogate. Hard-coded CUDA or cuSPARSE kernels cover only blocked distance tiles, row rank histograms and sparse neighbour overlaps.

**Defaults for agents.** `method` grid_search; `embedding` tsne; 50 leading components; perplexities 15, 30, 50, 100 (each below $n-1$); 5 seeds; scored sample of 5,000 cells. `max_qnx_seed_tiebreak` takes the highest seed-averaged $Q_{NX}(30)$ and, among settings within one standard error of it, the highest across-seed Jaccard.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/`reference.key` | float, cells by components | Reference representation whose neighbourhoods are the ground truth |
| write | obsm/hyper_`embedding` | float32, cells by 2 | Selected map |
| write | uns/hyper_`embedding` | dictionary | Selected settings, rule, per-setting scores, seeds, timings |
| write | obs/hyper_`embedding`_dubious | boolean | Dubious flags, scdeed with `write_dubious_flags` only |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "grid_search" | `grid_search`, `scdeed`, `rule_based` | grid_search scores settings by neighbourhood preservation; scdeed counts dubious cells; rule_based keeps library defaults. |
| `embedding` | string | "tsne" | `tsne`, `umap` | Embedding algorithm whose hyperparameters are selected. |
| `reference` | object | — | — | Reference representation whose neighbourhoods are the ground truth. |
| `reference.key` | string | "X_pca" | — | obsm key of the reference, on the same cells as the map. |
| `reference.n_components` | integer | 50 | min 2 | Leading reference components used as input. |
| `grid` | object | — | — | Candidate values; the search is their Cartesian product. |
| `grid.perplexity` | array | [15, 30, 50, 100] | — | Candidate t-SNE perplexities; each must be below the number of cells minus one. |
| `grid.n_neighbors` | array | [10, 15, 30, 50] | — | Candidate UMAP neighbour counts. |
| `grid.min_dist` | array | [0.1, 0.3, 0.5] | — | Candidate UMAP minimum distances. |
| `grid.learning_rate` | array | [] | — | Candidate t-SNE learning rates; empty uses openTSNE auto, cell number over exaggeration. |
| `grid.early_exaggeration` | array | [12] | — | Candidate early exaggeration factors for t-SNE. |
| `grid.initialization` | array | ["pca"] | — | Candidate starting configurations. |
| `grid_search` | object | — | — | Options for the co-ranking grid search. |
| `grid_search.selection_rule` | string | "max_qnx_seed_tiebreak" | `max_qnx_seed_tiebreak`, `kl_fixed_perplexity` | Label-free rule; kl_fixed_perplexity needs exactly one perplexity. |
| `grid_search.n_seeds` | integer | 5 | min 1 | Embedding seeds per setting for selection. |
| `grid_search.score_k` | integer | 30 | min 5 | Neighbourhood size for QNX and LCMC. |
| `grid_search.score_subsample_n` | integer | 5000 | min 100 | Cells in the seeded scored sample. |
| `scdeed` | object | — | — | Options for the scDEED dubious-cell count. |
| `scdeed.similarity_percent` | number | 0.5 | max 1; > 0 | Fraction of cells used as neighbours in the similarity score. |
| `scdeed.dubious_cutoff` | number | 0.05 | min 0; max 0.5 | Null quantile below which a cell is flagged dubious. |
| `scdeed.trustworthy_cutoff` | number | 0.95 | min 0.5; max 1 | Null quantile above which a cell is trustworthy. |
| `scdeed.write_dubious_flags` | boolean | false | — | Store per-cell dubious flags in obs. |
| `rule_based` | object | — | — | Options for library-default settings. |
| `rule_based.multiscale_perplexities` | array | [] | — | Perplexities averaged in a multiscale affinity; empty uses one perplexity. |
| `rule_based.late_exaggeration` | number/null | null | min 1 | Exaggeration applied after the early phase; null disables it. |
| `seed` | integer | 0 | — | Random seed for the scored sample and embedding runs. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory, device and embedding count without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters: `method` selects one nested object, and `grid` feeds `grid_search` and `scdeed` while `rule_based` ignores it. `learning_rate` applies to t-SNE only, and `n_neighbors` and `min_dist` to UMAP only. Any perplexity at or above $n-1$ is rejected before embedding. `kl_fixed_perplexity` requires exactly one perplexity. Output members are named by embedding, so t-SNE and UMAP selections coexist.

## 7. MCP tool

Tool name `singlet_embedding_viz_hyperparameter_selection` (definition in `tasks/mcp/singlet_embedding_viz_hyperparameter_selection.json`).

```json
{"dataset": "data/example.singlet", "method": "grid_search", "embedding": "tsne", "grid": {"perplexity": [15, 30, 50]}, "seed": 0}
```

```json
{"dataset": "data/example.singlet", "status": "completed", "wrote": ["obsm/hyper_tsne", "uns/hyper_tsne"],
 "summary": {"method": "grid_search", "selection_rule": "max_qnx_seed_tiebreak",
   "selected": {"perplexity": "<float>", "early_exaggeration": "<float>", "initialization": "<string>"},
   "selected_scores": {"qnx_30": "<float>", "lcmc_30": "<float>", "jaccard_across_seed": "<float>"},
   "default_scores": {"qnx_30": "<float>"}, "n_settings": "<int>", "n_embeddings": "<int>", "scored_scope": "<string>"},
 "provenance_id": "<id>"}
```

Long-running: yes; the dry-run estimate states whether the call completes inline or is queued. Stochastic: yes, through `seed` for the scored sample and each embedding. Dry-run estimate: `seconds`, `peak_memory_gb`, `device`, `n_embeddings` and `n_scored`.

## 8. Benchmarks

**Shared protocol.** The reference is 50 leading PCs of log-normalised expression, recomputed per dataset. Selection and reporting use disjoint cell halves, stratified by label where present. Co-ranking scores use a seeded uniform sample of at most 5,000 cells, $K=30$ and ordinal ties, with one scored set per dataset shared by all settings. Selection uses seeds 0 to 4 and reporting seeds 5 to 9. Results are medians over seeds with paired differences from defaults. *Recipe G1 (planted geometry):* `sklearn.datasets.make_blobs(n_samples=N, centers=K, n_features=50, center_box=(-c, c), cluster_std=1, random_state=seed)` for $N\in\{2000,5000\}$, $K\in\{5,10\}$, $c\in\{5,10\}$ and seeds 0 to 9, keeping the labels and centres. *Recipe G2 (catalogue):* for each of at least five catalogue studies with a curated label field, one uniform draw of 10,000 cells with seed 0.

### B1. Neighbourhood preservation of the selected setting

- **Goal**: test whether the label-free rule beats library defaults on reporting cells.
- **Ground truth**: consistency with the reference (30 nearest reference neighbours per cell; estimand in section 3).

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| OpenProblems test resource cxg_mouse_pancreas_atlas | `resources_test/task_dimensionality_reduction/cxg_mouse_pancreas_atlas/dataset.h5ad` [R14] | scRNA-seq, mouse pancreas; — | — | Example only |
| Catalogue subsamples (recipe G2) | singlet catalogue | scRNA-seq; 10,000 cells per study, at least five studies (proposed) | per source | Labels for stratification only |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| $Q_{NX}(30)$ | section 3, on the scored set | higher | primary | [R6] |
| LCMC(30) | $Q_{NX}(30)-30/(m-1)$, can be negative | higher | guardrail | [R7] |
| Density preservation | Pearson correlation of local radii at $n_{\text{neighbors}}=30$ | higher | guardrail | [R9] |
| Waypoint distance correlation | Spearman correlation of pairwise input and map distances | higher | guardrail | [R13] |

- **Comparators**: openTSNE, scanpy and umap-learn defaults; the OpenProblems t-SNE baseline [R14]; the oracle (best reporting-cell setting).
- **Protocol**: shared protocol; apply the rule on the selection half, then embed the selected and default settings on the reporting half.
- **Acceptance criterion**: PROPOSED. Selected median $Q_{NX}(30)$ at least the default's on at least 80% of datasets, and within 0.02 of the oracle.
- **Known pitfalls**: $Q_{NX}$ at $K=30$ rewards small perplexity and penalises global structure; pair it with waypoint correlation.

### B2. Planted-structure recovery (proposed simulation)

- **Goal**: test recovery of planted clusters and centroid geometry across separation and cell number.
- **Ground truth**: planted simulation. Each cell carries its generator label and each cluster its centre. The estimands are the ARI between $k$-means ($k=K$, fixed seed) on the map and the planted labels, zero at chance; and the Spearman correlation between pairwise planted-centre distances in input space and between cluster means in the map.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Gaussian mixture, recipe G1 | generated | simulated, 50 features, $N\in\{2000,5000\}$, 10 seeds | not applicable | Separation $c\in\{5,10\}$ |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | $k$-means on the map against planted labels | higher | primary | — |
| Centroid correlation | Spearman over centroid-distance pairs | higher | primary | [R13] |
| $Q_{NX}(30)$ | as in B1 | higher | guardrail | [R6] |

- **Comparators**: the oracle grid best on the same simulation; library defaults.
- **Protocol**: full grid with the same seeds; the rule sees only the map and the PCs, never labels; report regret distributions per simulation.
- **Acceptance criterion**: PROPOSED. Median ARI regret against the oracle at most 0.02, and ARI at least 0.9 for $c=10$.
- **Known pitfalls**: Gaussian mixtures favour aggressive settings. With $K=5$ the centroid correlation rests on ten pairs.

### B3. Stability of the selected map (proposed)

- **Goal**: check that the selected map is reproducible across seeds and cell subsamples.
- **Ground truth**: consistency, with no external label; the estimand is the across-seed Jaccard of section 3.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B1 datasets and 80% cell subsamples | B1 and recipe G2 | as in B1 | as in B1 | Subsamples seeded |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Across-seed 30-NN Jaccard | mean over cells and seed pairs | higher | primary | — |
| Across-seed cluster ARI | ARI at fixed resolution between seeds | higher | guardrail | — |
| Across-subsample centroid correlation | Spearman over shared cell-type centroids | higher | guardrail | [R13] |

- **Comparators**: library defaults; random against PCA start for t-SNE; random against spectral start for UMAP [R3].
- **Protocol**: 5 seeds on all cells and 5 seeds on seeded 80% subsamples; paired differences against defaults.
- **Acceptance criterion**: PROPOSED. Jaccard at least 0.05 above the default's, and cluster ARI at least 0.8.
- **Known pitfalls**: a consistently wrong map scores well here, so pair with B1. Subsamples change the reference set, so compare shared cells only.

### P1. Performance and scaling (proposed)

- **Goal**: wall time and peak memory of selection against exhaustive grid search, and the regret of cheaper strategies.
- **Datasets**: subsamples of the 1.3 million 10x brain cells used in the openTSNE benchmark notes (https://support.10xgenomics.com/single-cell-gene-expression/datasets) at $10^4$, $10^5$ and $10^6$ cells (proposed).

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Wall time | median of 3 repeats after one warm-up, build and score timed apart | lower | primary | — |
| Regret | best $Q_{NX}(30)$ minus the exhaustive best | lower | primary | [R6] |
| Peak memory | peak resident memory in GB | lower | guardrail | — |

- **Comparators**: exhaustive grid; successive halving over seeds (proposed); the Gaussian-process surrogate (proposed); one library-default embedding; FIt-SNE for large $N$ [R10]; GPU t-SNE [R11].
- **Acceptance criterion**: PROPOSED. A search strategy reaches within 0.02 of the exhaustive best $Q_{NX}(30)$ using at most 25% of the embeddings.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
  - `embedding-viz.local_neighborhood_preservation`: Local neighbourhood preservation of an embedding or reduced representation
- **Feeds**:
  - `embedding-viz.embedding_stability`: Embedding stability across seeds, subsamples and hyperparameters
  - `embedding-viz.cluster_gap_artifact_detection`: Detection of artefactual clusters, gaps and distances in a 2D map
- **Reads**: `obsm/<reference.key>`
- **Writes**: `obsm/hyper_<embedding>`, `uns/hyper_<embedding>`, `obs/hyper_<embedding>_dubious`
<!-- CHAINING:AUTO:END -->

Belongs to the embedding workflow: reduce, choose components, score neighbourhoods, select settings, then check stability and cluster artefacts on the chosen map.

## 10. Risks, pitfalls and open questions

- **Belkina et al. (2019).** The paper's optimiser, stopping rule and benchmarks are not described here, and no method row rests on it. The openTSNE docstring credits it with the learning-rate rule, and the FIt-SNE README credits it with the learning-rate point for large data [R4].
- **scDEED.** The statistic and null are taken from the R source at 920acbc. Its benchmark and its validation against biology are outside this document. Exact reproduction of counts requires matching Seurat's `RunTSNE` (`do.fast=T`) and `RunUMAP` (`seed.use=100`) implementations.
- **Attributions and conflicts.** The PCA scale, late exaggeration and perplexity combination are taken from the FIt-SNE README [R2], not from the paper's text. The second DOI that the OpenProblems distance-correlation config attaches to the same metrics (10.1038/s42003-022-03628-x) is omitted because its record is not in the local index.
- **Unsettled, risks and first experiment.** Open: whether a learned predictor beats fixed grids, whether seed-averaged $Q_{NX}$ tracks biology, and how much the 5,000-cell subsample biases $Q_{NX}$. Data licences for the test resource and the catalogue subsets are set per source. First experiment: implement the row-wise co-ranking and the scDEED statistic, reproduce the OpenProblems co-ranking values on the test resource, then compare the two rules on one grid (B1).

## 11. References

R1. van der Maaten L, Hinton G. Visualizing data using t-SNE. *Journal of Machine Learning Research* 2008;9(86). — verified (corpus)
R2. Kobak D, Berens P. The art of using t-SNE for single-cell transcriptomics. *Nature Communications* 2019. doi:10.1038/s41467-019-13056-x — verified (corpus)
R3. Kobak D, Linderman GC. Initialization is critical for preserving global data structure in both t-SNE and UMAP. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00809-z — verified (corpus)
R4. Belkina AC, et al. Automated optimized parameters for T-distributed stochastic neighbor embedding improve visualization and analysis of large datasets. *Nature Communications* 2019. doi:10.1038/s41467-019-13055-y — partial (search)
R5. McInnes L, Healy J, Melville J. UMAP: Uniform manifold approximation and projection for dimension reduction. *arXiv* 2018. doi:10.48550/arxiv.1802.03426 — verified (corpus)
R6. Lee JA, Verleysen M. Quality assessment of dimensionality reduction: rank-based criteria. *Neurocomputing* 2009. doi:10.1016/j.neucom.2008.12.017 — verified (corpus)
R7. Chen L, Buja A. Local multidimensional scaling for nonlinear dimension reduction, graph drawing, and proximity analysis. *Journal of the American Statistical Association* 2009. doi:10.1198/jasa.2009.0111 — verified (corpus)
R8. Kraemer G, Reichstein M, Mahecha MD. dimRed and coRanking: unifying dimensionality reduction in R. *The R Journal* 2018. doi:10.32614/rj-2018-039 — verified (corpus)
R9. Narayan A, Berger B, Cho H. Assessing single-cell transcriptomic variability through density-preserving data visualization. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00801-7 — verified (corpus)
R10. Linderman GC, Rachh M, Hoskins JG, Steinerberger S, Kluger Y. Fast interpolation-based t-SNE for improved visualization of single-cell RNA-seq data. *Nature Methods* 2019. doi:10.1038/s41592-018-0308-4 — partial (repo)
R11. Chan DM, Rao R, Huang F, Canny JF. t-SNE-CUDA: GPU-accelerated t-SNE and its applications to modern data. *arXiv* 2018. doi:10.48550/arxiv.1807.11824 — verified (corpus)
R12. Xia L, Liu T, et al. Statistical method scDEED for detecting dubious 2D single-cell embeddings and optimizing t-SNE and UMAP hyperparameters. *Nature Communications* 2024. doi:10.1038/s41467-024-45891-y — verified (corpus)
R13. Loh JW, Ouyang J, et al. cellstruct: Metrics scores to quantify the biological preservation between two embeddings. *bioRxiv* preprint. doi:10.1101/2023.11.13.566337 — verified (corpus)
R14. Open Problems in Single-Cell Analysis. Dimensionality reduction task (task_dimensionality_reduction), commit 360499d. *GitHub repository*. — partial (repo)
R15. Theis lab. Single-cell best practices: dimensionality reduction keytakeaways. *Online book*, theislab/single-cell-best-practices. — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/pavlin-policar/openTSNE | Pavlin Poličar (setup.py author) | BSD-3-Clause (LICENSE; setup.py) | t-SNE defaults and learning-rate convention; benchmark notes | callout |
| https://github.com/lmcinnes/umap | Leland McInnes (LICENSE.txt) | BSD-3-Clause (LICENSE.txt) | UMAP defaults comparator | callout |
| https://github.com/scverse/scanpy | scverse (LICENSE copyright line) | BSD-3-Clause (LICENSE) | Fixed-learning-rate t-SNE and UMAP defaults comparator | callout |
| https://github.com/JSB-UCLA/scDEED | Lucy Xia, Tianyang Liu (DESCRIPTION); maintainer Lucy Xia | MIT (LICENSE; DESCRIPTION) | scDEED statistic and permutation null | port |
| https://github.com/gdkrmr/coRanking | Guido Kraemer (DESCRIPTION) | GPL-3 (DESCRIPTION; LICENSE) | QNX and LCMC definitions; oracle in B1 and B2 | reimplement |
| https://github.com/openproblems-bio/task_dimensionality_reduction | Open Problems in Single-Cell Analysis (LICENSE) | MIT (LICENSE) | Benchmark protocol, metric configurations, test resource | port the protocol; metric scripts callout |
| https://github.com/KlugerLab/FIt-SNE | George C. Linderman et al. (README) | Several licences, assigned per file in LICENSE.txt | Large-N comparator | callout |
