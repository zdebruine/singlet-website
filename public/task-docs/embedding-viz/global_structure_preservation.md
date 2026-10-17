---
id: embedding-viz.global_structure_preservation
title: Global structure and inter-cluster distance preservation
area: embedding-viz
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [dim-reduction.normalized_cell_embedding, annotation.cluster_label_assignment]
feeds: [embedding-viz.hyperparameter_selection, embedding-viz.embedding_stability, embedding-viz.cluster_gap_artifact_detection]
reads: [layers/normalized, obsm/X_pca, obs/<label_key>, obsm/<embedding>, uns/<embedding>_init]
writes: [uns/global_structure/<embedding>, uns/global_structure/init_effect, obs/is_waypoint]
devices: [cpu, cuda]
mcp_tool: singlet_embedding_viz_global_structure_preservation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Global structure and inter-cluster distance preservation

> Score whether a two-dimensional map keeps the arrangement of annotated groups, the distances between them and the orderings of random triplets implied by a high-dimensional reference, and how much that agreement depends on initialisation.

## 1. Question

Given a reference representation of $n$ cells (by default the normalised log-expression layer), group labels fixed before the map was computed, and a two-dimensional map of the same cells: do the distances between group centroids, between waypoint cells and centroids, and the orderings of random triplets agree between reference and map, and how much of that agreement changes with the initialisation? The output is a set of correlation or triplet-accuracy scores with intervals, and paired differences between initialisations. A high score means the map reproduces the reference's group geometry. It says nothing about neighbourhoods or local densities.

## 2. Why this task matters and where the field stands

Two-dimensional maps are read for relationships between populations: which clusters sit together, how far apart they are, and whether a gap is real [R2, R17]. Local neighbourhood scores do not test these readings, because a map can keep every neighbourhood while moving whole groups [R3, R17]. Global fidelity needs a separate measure.

The status is **contested**. Scoring is routine, but the field disagrees on which statistic to report and on whether distances between groups in a map mean anything. The best-practices chapter concludes that cluster sizes and distances between clusters in t-SNE and UMAP plots carry little meaning and change with initialisation [R17]. Kobak and Linderman argue that initialisation is critical for preserving global structure in both methods [R3]. Huang et al. and Heiser and Lau study structure preservation of dimensionality-reduction methods [R8, R9], and Chari and Pachter critique analysis choices in single-cell genomics [R15].

Open problems:

1. No accepted truth for group geometry exists beyond annotation labels, and those labels are contested in some tissues.
2. Scores depend on label granularity, the reference space and the correlation type, so values from different papers are not comparable.
3. Whether a higher group-distance correlation predicts a more interpretable map is not established.
4. Continuous trajectories have no centroids, so waypoint scores are the only option, and their behaviour under branching is uncharacterised.

## 3. Theory and insight

**Notation.** Cells $i=1,\dots,n$ carry labels $g(i)\in\{1,\dots,K\}$. The reference gives distances $d^X_{ij}$ and the map $Y\in\mathbb{R}^{n\times 2}$ gives $d^Y_{ij}$. Centroids are $c_k$ (mean reference coordinates of group $k$) and $\hat c_k$ (mean map coordinates). Group pairs form $\mathcal P_K=\{(k,l):k<l\}$ with $M=K(K-1)/2$ elements, and $W=\min(n,50{,}000)$ is the number of waypoint cells.

**Estimands and normalisation.** Each output is one of the following statistics.

- *Label-distance score* $S_{\mathrm{lab}}=\rho\big(\{D^X_{kl}\}_{\mathcal P_K},\{D^Y_{kl}\}_{\mathcal P_K}\big)$ with $D^X_{kl}=\|c_k-c_l\|$ and $D^Y_{kl}=\|\hat c_k-\hat c_l\|$; $\rho$ is Spearman or Pearson, reported separately. It lies in $[-1,1]$ and is invariant to the scale and shift of either matrix, so the arbitrary units of a map do not matter; Spearman is also invariant to monotone changes of distance.
- *Waypoint score* $S_{\mathrm{wp}}$: the same correlation over the $W(W-1)/2$ pairs of waypoint cells.
- *Centroid score* $S_{\mathrm{cen}}$: the same correlation over the $W\times K$ waypoint-to-centroid distances.
- *Random-triplet accuracy* $A_{\mathrm{rand}}$, a fraction in $[0,1]$. For anchor $i$ and draw $t$, let $j_t$ be the point nearer to $i$ in the reference and $k_t$ the other one. The draw is violated when $d^Y_{ik_t}<d^Y_{ij_t}$, so ties in the map count as satisfied. $A_{\mathrm{rand}}=1-(\text{violated draws})/(nm)$ with $m$ draws per anchor.
- *Centroid-triplet accuracy* $A_{\mathrm{cen}}$: the fraction of pairs $p<q$ of group pairs in $\mathcal P_K$ (lower-triangle order) for which $\mathbb 1[D^X_p>D^X_q]=\mathbb 1[D^Y_p>D^Y_q]$.

These are exact functionals of the given matrices. Any statement about their values under a null holds only under that null: reference and map independent, distances continuous.

**Null behaviour.** A simulation with Gaussian group centroids in 50 dimensions and independent Gaussian two-dimensional centroids (seed 0; 1,500 replicates for $K=5,10,20$ and 300 for $K=50$) gives, for $S_{\mathrm{lab}}$ on the upper triangle, a mean near zero and standard deviations 0.35, 0.19, 0.12 and 0.07. The flattened full matrix used by OpenProblems gives means of +0.48, +0.27, +0.15 and +0.06 at the same $K$. The $K$ diagonal zeros are tied in both matrices and occupy the lowest ranks, so they add agreement unrelated to group geometry, with weight about $1/K$. The spread is also wider than the independent-pair value $1/\sqrt{M-1}$ (0.33, 0.15, 0.07 and 0.03 at these $K$), and the gap grows with $K$ because distances among groups share members.

**Triplet expectation.** For a random map independent of the reference, a non-degenerate draw is violated with probability one half. Draws with $j_t=i$, $k_t=i$ or $j_t=k_t$, a fraction of about $3/n$, cannot be violated. Hence $\mathbb E[A_{\mathrm{rand}}]\approx\tfrac12+\tfrac{3}{2n}$. With 20 draws per point, the simulation gives 0.5495 at $n=30$ and 0.5149 at $n=100$, against 0.5500 and 0.5150.

**Why heuristics work and where models add.** Each embedding objective is an explicit model of neighbour relations. t-SNE minimises $\mathrm{KL}(P\Vert Q)$ between Gaussian input affinities and Student-t output affinities [R1, R2]:

$$p_{j\mid i}=\frac{\exp(-\|x_i-x_j\|^2/2\sigma_i^2)}{\sum_{k\neq i}\exp(-\|x_i-x_k\|^2/2\sigma_i^2)},\qquad p_{ij}=\frac{p_{j\mid i}+p_{i\mid j}}{2n},\qquad q_{ij}\propto(1+\|y_i-y_j\|^2)^{-1}.$$

The gradient is $4\sum_j(p_{ij}-q_{ij})(y_i-y_j)(1+\|y_i-y_j\|^2)^{-1}$. A pair with $p_{ij}\approx 0$ feels only repulsion, so the arrangement of groups is set by the start and the early optimisation [R3, R4]. Regime: $\sigma_i$ is set by perplexity, the exact form costs $O(n^2)$ per iteration, and Barnes-Hut or FFT approximations are used at scale.

UMAP builds fuzzy memberships $\mu_{i\to j}=\exp(-\max(0,d_{ij}-\rho_i)/\sigma_i)$, symmetrised as $\mu_{ij}=\mu_{i\to j}+\mu_{j\to i}-\mu_{i\to j}\mu_{j\to i}$, and minimises a cross-entropy against output memberships $\nu_{ij}=(1+a\|y_i-y_j\|^{2b})^{-1}$ [R5]. The constants $a,b$ are fitted to min_dist and spread, and repulsion comes from negative sampling. PHATE embeds $U=-\log(P^t+10^{-7})$ by metric MDS, so that diffusion-based potential distances carry global transitions [R11, R12]. PaCMAP and TriMap change which pairs or triplets are sampled and how they are weighted [R6, R7].

Model-based additions change no score. They add intervals from a bootstrap over cells and seeds, a variance decomposition of initialisation effects, and shrinkage of small centroids (section 5). The heuristic scores remain comparators and the acceptance reference.

**Failure modes.** For centroid scores: label granularity changes which centroids exist; imbalance and outliers move means; labels from clustering on the same map create circularity; non-convex populations have no meaningful centroid. For triplets: draws share anchors, so binomial intervals are too narrow, and degenerate draws inflate accuracy. For distance correlation: the value depends on the reference (normalised genes, PCs or spectral layout) and on whether both triangles and the diagonal are included. For all scores: a two-dimensional target cannot match high-dimensional distances exactly (Shepard distortion), so a faithful map can have a modest correlation.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| t-SNE (scikit-learn, PCA start) | model-based | KL divergence between Gaussian input and Student-t output affinities | [R1, R2] |
| openTSNE (PCA start, multiscale kernels) | model-based | Interpolation-based t-SNE with multiscale kernels that aim to preserve global structure | [R10] |
| UMAP (umap-learn, spectral start) | model-based | Cross-entropy between fuzzy kNN memberships and output memberships | [R5, R3] |
| PaCMAP | hybrid | Neighbour, mid-near and further pairs with annealed loss weights | [R7] |
| TriMap | model-based | Weighted triplet loss over kNN inliers, outliers and random triplets | [R6, R7] |
| PHATE | heuristic | Diffusion potential distance embedded by metric MDS | [R11, R12] |
| PCA, two components | heuristic | Projection onto the top two principal components | [R16] |
| Group and waypoint distance correlation (OpenProblems) | heuristic | Spearman over waypoint, centroid and between-centroid distance matrices | [R13] |
| Pearson variant of the same statistics (cellstruct) | heuristic | Pearson correlation of cell-cell (waypoint) distance matrices and of centroid-centroid distance matrices | [R14] |
| Centroid and random triplet scores (PaCMAP evaluation code) | heuristic | Fraction of distance orderings kept | [R7] |

**Published standard.** The OpenProblems distance-correlation metrics [R13] are the published standard for waypoint and group distance correlation. They fix a 50,000-waypoint cap and a Spearman statistic over flattened matrices. The triplet scores come from the PaCMAP evaluation code [R7]. Comparator embeddings are the default t-SNE and UMAP wrappers of scanpy and umap-learn; their defaults are in the table below, taken from source.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| t-SNE (scikit-learn) | init | `pca` | `sklearn/manifold/_t_sne.py:810` @ 85593ca |
| t-SNE (scanpy wrapper) | perplexity, early exaggeration, learning rate | 30, 12, 1000 | `src/scanpy/tools/_tsne.py:31-34` @ 8ed52d9 |
| t-SNE (scanpy wrapper) | init | not supplied, so the scikit-learn default applies | `src/scanpy/tools/_tsne.py:114-150` @ 8ed52d9 |
| openTSNE | initialization | `pca` | `openTSNE/tsne.py:1155` @ c2a8b28 |
| UMAP (umap-learn) | n_neighbors, min_dist, init, negative_sample_rate | 15, 0.1, `spectral`, 5 | `umap/umap_.py:1752, 1761, 1760, 1768` @ 33d7e6f |
| UMAP (umap-learn) | a, b | fitted from min_dist and spread | `umap/umap_.py:1478` @ 33d7e6f |
| UMAP (scanpy wrapper) | min_dist, init_pos | 0.5, `spectral` | `src/scanpy/tools/_umap.py:37, 44` @ 8ed52d9 |
| PaCMAP | n_neighbors, MN_ratio, FP_ratio, num_iters, lr, apply_pca | 10, 0.5, 2.0, (100, 100, 250), 1.0, True | `source/pacmap/pacmap.py:1109-1125` @ 2e7237a |
| PaCMAP | init | `pca` (None maps to PCA) | `source/pacmap/pacmap.py:793, 1242-1243` @ 2e7237a |
| PaCMAP | mid-near weight | 1000 decaying linearly to 3 over phase 1 | `source/pacmap/pacmap.py:348-364, 809` @ 2e7237a |
| PaCMAP | neighbour and further-pair weights | 2, 3, 1 for neighbours by phase; 1 for further pairs | `source/pacmap/pacmap.py:312, 348-364` @ 2e7237a |
| TriMap | n_inliers, n_outliers, n_random | 12, 4, 3 | `trimap/trimap_.py:692-694` @ 3d1bf1e |
| PHATE | knn, decay, n_landmark, t, gamma, n_pca, mds, mds_dist | 5, 40, 2000, `auto`, 1, 100, `metric`, `euclidean` | `Python/phate/phate.py:189-204` @ 65a1f73 |
| PHATE | potential at gamma = 1 | $-\log(P^t+10^{-7})$ | `Python/phate/phate.py:1075-1076` (in `_calculate_potential`, defined at line 1037) @ 65a1f73 |
| OpenProblems processors | waypoint cap and seed | 50,000; `np.random.seed(0)` before the draw | `src/data_processors/process_dataset/script.py:34-41` @ 360499d |
| OpenProblems processors | distances and centroids | Euclidean on `layers["normalized"]`; centroids are means over all cells of each `cell_type` | `src/data_processors/process_dataset/script.py:46-71` @ 360499d |
| OpenProblems metric | correlation | `scipy.stats.spearmanr(..., axis=None)` on full matrices | `src/metrics/distance_correlation/script.py` @ 360499d |
| OpenProblems spectral metric | reference layout | UMAP spectral layout with `np.random.default_rng()` (unseeded); `n_comps = min(1000, min(shape) - 2)` | `src/metrics/spectral_distance_correlation/script.py:36-39` @ 360499d |
| PaCMAP evaluation | draws per point; tolerant margin | 20; 0.2 | `evaluation/evaluation.py:59, 48` @ 2e7237a |
| PaCMAP evaluation | random draws and reference | `np.random.randint` (unseeded); TruncatedSVD to 100 components when p > 100 | `evaluation/evaluation.py:59-72` @ 2e7237a |
| PaCMAP evaluation | centroid triplets | lower triangle; agreement of the greater-than indicator | `evaluation/evaluation.py:219-257` @ 2e7237a |
| cellstruct | waypoint cells; correlation | 10,000; Pearson | `README.md` @ 9058e8f |
| PCA baseline | components | 2 | task definition |

## 5. Proposed singlet approach

**Paradigm and routes.** The published scores stay as defined; their implementations serve as numerical oracles. The OpenProblems metrics are reimplemented in the C++ core from their definitions [R13]. The PaCMAP triplet functions are reimplemented from the definitions in section 3 and checked against that code [R7]. cellstruct is reimplemented from its README specification only [R14]. The embedding methods are callouts used as comparators; producing maps belongs to the embedding tasks.

**Model-based layer (proposed).** (1) *Intervals.* A label-stratified bootstrap over cells, with seeds as a second level, gives every score an interval; the triplet bootstrap resamples anchors. (2) *Initialisation effects.* For each method $m$ and dataset $d$ with paired maps, $\Delta_{m,d}$ comes from the mixed model $s\sim\mathrm{method}\times\mathrm{init}+(1\mid\mathrm{dataset})+(1\mid\mathrm{seed})$ fitted by REML to per-seed scores, replacing a single paired difference with a variance decomposition. (3) *Shrunken centroids.* For small groups, centroids shrink towards the global mean with weight $|C_k|/(|C_k|+\lambda)$, with $\lambda$ fixed in advance; raw means are reported beside them. The claim that initialisation sets group arrangement is falsified on datasets with at least 20 groups if $\Delta$ is indistinguishable from zero on most of them.

**ML stack.** The scores are sums, sorts and dense matrix products, so they are hard-coded: a CUDA GEMM kernel for pairwise distances and a radix-sort kernel for ranks, both small and hot. No deep network is needed. A learned map, if added later, would be trained in PyTorch and exported to a fixed forward computation.

**Kernels and devices.** Centroid sums stream over cells in a single sweep. Waypoint pairs are bounded by `max_waypoints`; at 50,000 waypoints the upper triangle has $1.25\times10^9$ values, so distances are float32 and ranks come from a chunked external sort on CPU or a radix sort on GPU. The seed fixes waypoint sampling and anchors.

**Defaults an agent should use.** `reference.space` normalized; `label_key` cell_type; `scores` label_distance and triplet_random; `distance_correlation.correlation` spearman with `upper_triangle_only` true; `max_waypoints` 50000; `seed` 0. Pass `paired_embeddings` whenever maps with other initialisations exist. The spectral reference uses the UMAP spectral layout of the waypoint cells, seeded; this differs from the OpenProblems spectral metric, which uses all cells.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/normalized | float32, sparse | log-normalised expression; reference for centroids and distances |
| read | obsm/X_pca | float32 | principal components, used when `reference.space` is pca50 |
| read | obs/<label_key> | categorical | author annotations; labels fixed before the map was computed |
| read | obsm/<embedding> | float32, two columns | the map to score; paired maps are other keys of the same kind |
| read | uns/<embedding>_init | string | initialisation that produced the map, for paired differences |
| write | uns/global_structure/<embedding> | dict | scores with intervals, centroids in both spaces, correlation type, seed |
| write | uns/global_structure/init_effect | table | paired differences by method and dataset |
| write | obs/is_waypoint | bool | waypoint mask from the seeded sample |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `embedding` | string | required | — | Key in obsm of the two-dimensional map to score. |
| `paired_embeddings` | array | [] | — | Other obsm maps of the same cells that differ only in initialisation; adds paired differences. |
| `label_key` | string | "cell_type" | — | Obs column of author annotations defining groups; fixed before the map was computed. |
| `reference` | object | — | — | High-dimensional reference geometry against which distances and orderings are compared. |
| `reference.space` | string | "normalized" | `normalized`, `pca50`, `spectral` | normalized: log-normalised genes; pca50: leading PCs; spectral: UMAP spectral layout of waypoints, seeded. |
| `reference.n_components` | integer | 50 | min 2 | Leading principal components used when space is pca50. |
| `scores` | array | ["label_distance", "triplet_random"] | — | Score families to compute; label and centroid scores need label_key; triplet_random needs no labels. |
| `distance_correlation` | object | — | — | Options for waypoint, centroid and label distance correlations. |
| `distance_correlation.correlation` | string | "spearman" | `spearman`, `pearson` | Spearman as in OpenProblems; Pearson as in cellstruct. Reported separately. |
| `distance_correlation.upper_triangle_only` | boolean | true | — | Use unique pairs only; false reproduces the OpenProblems flattened full matrix. |
| `distance_correlation.max_waypoints` | integer | 50000 | min 2 | Waypoint cap; larger datasets are subsampled with the seed. |
| `triplets` | object | — | — | Options for random-anchor and centroid triplet accuracy. |
| `triplets.n_per_point` | integer | 20 | min 1 | Random anchor draws per point. |
| `triplets.margin` | number | 0.2 | min 0; max 1 | Relative margin of the tolerant variant; 0 gives the strict variant only. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for waypoint sampling and triplet anchors. |
| `dry_run` | boolean | false | — | Return estimated time, memory, device and waypoint count without computing scores. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Label and centroid scores (`label_distance`, `centroid_distance`, `triplet_centroid`) need `label_key`; `triplet_random` and `waypoint_distance` do not. `correlation` applies to every distance score, and Spearman and Pearson are never mixed in one summary. `paired_embeddings` must share cells and order with `embedding`, and a paired difference is written only when every map has an initialisation label. A `margin` of 0 gives strict triplets only; otherwise both variants are reported. `reference.space` spectral uses the seeded spectral layout of waypoints, so its cost is bounded by `max_waypoints`.

## 7. MCP tool

Tool name `singlet_embedding_viz_global_structure_preservation` (definition in `tasks/mcp/singlet_embedding_viz_global_structure_preservation.json`). Example call and compact result:

```json
{"dataset": "study.singlet", "embedding": "X_umap", "paired_embeddings": ["X_umap_random"], "label_key": "cell_type", "scores": ["label_distance", "triplet_random"], "seed": 0}
```

```json
{"dataset": "study.singlet", "status": "completed",
 "wrote": ["uns/global_structure/X_umap", "uns/global_structure/init_effect", "obs/is_waypoint"],
 "summary": {"correlation": "spearman", "n_waypoints": "<int>",
   "label_distance": {"n_labels": "<int>", "estimate": "<float>", "interval95": ["<float>", "<float>"]},
   "triplet_random": {"tolerant": "<float>", "strict": "<float>", "n_triplets": "<int>"},
   "init_effect": {"label_distance_delta": "<float>"}, "timing_s": "<float>", "peak_memory_gb": "<float>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: the waypoint and centroid stages return a `job_id` above a size threshold. Stochastic: waypoint sampling and triplet anchors depend on `seed`. Dry run: returns estimated seconds, peak memory, device and waypoint count without computing scores.

## 8. Benchmarks

**Shared protocol.** Labels come from the obs column named by `label_key` and are fixed before any map is computed. Distances are Euclidean in the reference and in the map. Each map is scored in its own coordinates, which the correlations and orderings do not depend on in scale. Spearman and Pearson are reported separately. Stochastic embedders use seeds 0 to 4; waypoints and anchors use seed 0 unless a benchmark says otherwise. Intervals are 95% from a bootstrap stratified by label over cells, resampling anchors for triplets. Hardware and wall time are recorded only in P1.

### B1. OpenProblems distance-correlation metrics (published)

- **Goal**: score how well a two-dimensional map keeps waypoint, waypoint-to-centroid and between-centroid distances of the normalised high-dimensional data [R13].
- **Ground truth**: consistency with reference distances, with groups given by the `cell_type` column fixed before embedding. The estimand is the Spearman correlation between flattened distance matrices in the normalised layer and in the map, including both triangles and the zero diagonal, as in the source.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_mouse_pancreas_atlas (test resource) | [R13], `resources_test` path named in the metric scripts | scRNA-seq, mouse, pancreas (from the name) | — | the only dataset named in the metric scripts |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| waypoint_distance_correlation | Spearman over the full matrix of waypoint distances, `layers/normalized` against `obsm/X_emb` | maximise | primary | [R13, R14] |
| centroid_distance_correlation | Spearman over flattened waypoint-to-centroid distances | maximise | primary | [R13] |
| label_distance_correlation | Spearman over flattened between-centroid distances | maximise | primary | [R13, R14] |

- **Comparators**: the controls `random_features` (chance level), `spectral_features` and `true_features`, and the other methods that the repository's method directory names.
- **Protocol**: apply the repository processors unchanged to the reference and map steps, so that the distance and label settings match the source. Then compute the three correlations, with the upper triangle as a sensitivity check and the Pearson variant with 10,000 waypoints as a second check [R14].
- **Acceptance criterion**: proposed, not from the literature. A method is above chance on a dataset when its label-distance Spearman exceeds the `random_features` value in at least 90% of seeds.
- **Known pitfalls**: (1) the full-matrix statistic is biased upward at small label counts (section 3), so the upper-triangle value is reported beside it; (2) the centroid statistics change with the annotation granularity of `cell_type`, so granularity is fixed per dataset before scoring.

### B2. Initialisation effect on group arrangement (proposed, extending [R3])

- **Goal**: test whether group arrangement depends on initialisation, and by how much, for t-SNE, openTSNE, UMAP and PaCMAP [R3, R4].
- **Ground truth**: the upper-triangle label-distance Spearman of section 3, with labels fixed before embedding. The estimand is $\Delta_{m,d}=\bar S^{\mathrm{inf}}_{m,d}-\bar S^{\mathrm{rand}}_{m,d}$, the difference of seed means in correlation units.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue subsets chosen by the rule below | singlet catalogue (internal, no accession) | scRNA-seq; species and sizes follow from the rule | — | rule (proposed): author annotations present, one study per subset, at least 20 groups of at least 50 cells each; the list is fixed before any map is computed |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| label_distance_spearman | upper-triangle label-distance Spearman, mean over seeds | maximise | primary | [R3, R13] |
| init_delta | $\Delta_{m,d}$ for informative minus random start, paired by seed | larger favours the informative start | primary | [R3] |

- **Comparators**: t-SNE with random and PCA starts; UMAP with random and spectral starts; openTSNE with a PCA start; PaCMAP with PCA and random starts; PHATE; PCA to two components.
- **Protocol**: 50 PCs as reference; perplexity or neighbour count, learning rate and all other settings fixed across starts; seeds 0 to 4 per method and start; mean, SD and $\Delta$ with intervals; the method-by-start term of section 5.
- **Acceptance criterion**: proposed, not from the literature. On datasets with at least 20 groups, the random start of t-SNE or UMAP is at least 0.1 below the informative start on 80% of datasets, and the seed SD of the informative start is below 0.02 on each dataset.
- **Known pitfalls**: (1) the start is confounded with seed, perplexity and learning rate unless all are fixed; (2) below 20 groups the null spread of the score is large (section 3), which is why the 0.1 criterion applies only to larger label sets.

### B3. Triplet accuracy with intervals (published code)

- **Goal**: measure how many sampled distance orderings and centroid-distance orderings a map keeps, without a correlation over all distances [R7].
- **Ground truth**: reference distances for random draws and label centroids for centroid triplets, with labels fixed before embedding. The estimands are $A_{\mathrm{rand}}$ and $A_{\mathrm{cen}}$ of section 3; for a random map $\mathbb E[A_{\mathrm{rand}}]\approx\tfrac12+\tfrac{3}{2n}$ and $\mathbb E[A_{\mathrm{cen}}]=\tfrac12$ under exchangeability.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| shared set of B1 and B2 | as in B1 and B2 | as in B1 and B2 | — | same reference, labels and seeds |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| triplet_random_tolerant | $A_{\mathrm{rand}}$ with the source's tolerant rule (`score_largely`): a triplet whose relative reference gap $(d_{ik}-d_{ij})/d_{ik}$ is below 0.2 is violated only when the map places the reference-nearer point at least 0.2 (relative) farther than the other; other triplets use the strict rule | maximise | primary | [R7] |
| triplet_random_strict | $A_{\mathrm{rand}}$ with margin 0 (ties in the map satisfied) | maximise | primary | [R7] |
| triplet_centroid | $A_{\mathrm{cen}}$ over lower-triangle centroid-distance pairs | maximise | primary | [R7] |

- **Comparators**: PCA to two components; t-SNE and UMAP with random and informative starts; PaCMAP; TriMap; PHATE.
- **Protocol**: anchors drawn with seed 0 and 20 draws per point. The reference is reduced to 100 TruncatedSVD components when it has more than 100 features, as the source does, and the unreduced normalised layer is a sensitivity check. Intervals come from an anchor-level bootstrap, because draws that share an anchor are not independent.
- **Acceptance criterion**: proposed. The two implementations agree to $10^{-9}$ on a toy input with identical draws. For random anchors, the independent-draw half-width $1.96\sqrt{p(1-p)/m}$ is at most 0.003 at $p=0.5$ only when $m\ge1.1\times10^5$ draws; the anchor bootstrap interval is reported as well.
- **Known pitfalls**: (1) the source draws anchors and pairs with unseeded `np.random`, and its strict rule counts map ties as satisfied; (2) the function named `score` returns violations, not accuracy, and the median-centroid variant (`faster_centroid_triplet_eval`) changes the statistic.

### B4. Planted geometry with distorted maps (proposed)

- **Goal**: test whether the group-distance score detects a planted map distortion when the true centroid geometry is known [R15].
- **Ground truth**: planted centroid distances $D^\ast_{kl}$. The estimand is the Spearman correlation between $D^\ast$ and the map's upper-triangle centroid distances; detection is the fraction of replicates in which the faithful map outranks its distorted version.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| planted generator (recipe below) | generated here; no external source | simulated; $n=3{,}000$ cells, 50 features | — | all inputs come from the recipe |

Recipe, per setting $(K,\alpha,\sigma,f)$:

1. Draw $K\in\{8,\dots,12\}$ and group proportions $\pi\sim\mathrm{Dirichlet}(\alpha\mathbf 1_K)$ with $\alpha\in\{10,1,0.3\}$.
2. Draw centroids $c_k\sim N(0,I_{50})$ independently and set $D^\ast_{kl}=\|c_k-c_l\|$.
3. Assign each cell a group $g(i)\sim\pi$ and set $x_i=c_{g(i)}+\sigma\varepsilon_i$ with $\varepsilon_i\sim N(0,I_{50})$ and $\sigma\in\{0.5,1,2\}$.
4. Faithful maps: each comparator embeds $x$ in two dimensions with the seeded settings of B2.
5. Distorted maps: choose a random third $S$ of the groups and scale their two-dimensional coordinates about the map's global mean by $f$, drawn uniformly from $(0.5,2)$.
6. Score both maps against $D^\ast$ and record which outranks the other (seeds 0 to 49).

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| label_distance_vs_planted | Spearman between $D^\ast$ and the map's upper-triangle centroid distances | maximise | primary | [R13] |
| detection_rate | fraction of replicates where the faithful map outranks the distorted map on the primary | maximise | guardrail | — |

- **Comparators**: PCA to two components; t-SNE with PCA start; UMAP with spectral start; random-start controls.
- **Protocol**: 50 replicates per setting; report detection rate and median primary score for each setting.
- **Acceptance criterion**: proposed, not from the literature. At $\sigma=0.5$ the faithful map outranks its distorted version in at least 95% of replicates.
- **Known pitfalls**: (1) the planted geometry is isotropic and does not transfer to real cells, so it supplements B1 to B3; (2) the distortion scheme decides which score wins, so every setting is reported.

### P1. Performance and scaling

Proposed grid: $n\in\{10^4,10^5,10^6\}$ cells, $K\in\{10,50,200\}$, $W=\min(n,50{,}000)$, on CPU and CUDA. Measure wall time and peak memory per stage, for map construction (t-SNE, openTSNE, UMAP, PaCMAP, TriMap, PHATE with landmarks, PCA) and for scoring (OpenProblems metrics, triplet score, centroid score), against the comparators of B1 and B3. Centroid sums alone should be timed at $10^7$ cells if streaming is claimed. Hold fixed: 50 PCs, seed, label key, normalisation, waypoint cap and 20 draws per point. At $W=50{,}000$ a float64 matrix has $2.5\times10^9$ entries, about 20 GB, and the upper triangle has $1.25\times10^9$ values that the rank statistic must order; report peak memory and rank throughput per billion pairs.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Feeds**:
  - `embedding-viz.hyperparameter_selection`: Selection of perplexity, neighbour count, min_dist and initialization
  - `embedding-viz.embedding_stability`: Embedding stability across seeds, subsamples and hyperparameters
  - `embedding-viz.cluster_gap_artifact_detection`: Detection of artefactual clusters, gaps and distances in a 2D map
- **Reads**: `layers/normalized`, `obsm/X_pca`, `obs/<label_key>`, `obsm/<embedding>`, `uns/<embedding>_init`
- **Writes**: `uns/global_structure/<embedding>`, `uns/global_structure/init_effect`, `obs/is_waypoint`
<!-- CHAINING:AUTO:END -->

Belongs to the embedding evaluation workflow: normalise, reduce, choose the component count, embed, then score global structure here before choosing hyperparameters or checking stability.

## 10. Risks, pitfalls and open questions

- **Sources read in part.** The Kobak and Linderman statistic, initialisation results and datasets (the paper is cited by title), the Wang et al. paper text, the Chari and Pachter simulation design, the early scikit-learn default history and the PHATE alpha-decay bandwidth rule could not be read. Findings attributed to [R3, R4, R7, R15] come from the best-practices chapter, from source code, or from titles.
- **Heiser and Lau.** The metric definitions and datasets of [R9] were not read. A search summary reports three cell-cell distance metrics and a benchmark of 11 methods on real and synthetic scRNA-seq data, but that study supports no benchmark here.
- **Unmatched DOIs.** Two DOIs in `src/metrics/distance_correlation/config.vsh.yaml` of the OpenProblems task (lines 19 and 33: 10.1038/s42003-022-03628-x and 10.1038/s41467-023-37478-w) match no local bibliography record, so the original source of the waypoint and centroid statistics is unidentified.
- **OpenProblems datasets.** Only the test resource is named in the metric scripts. The task's full dataset collection, and the test resource's species, size and terms of use, could not be read.
- **Technical risks.** Full waypoint matrices at 50,000 cells occupy about 20 GB in float64. The OpenProblems spectral metric seeds its layout from an unseeded generator. Two routes (PHATE as a comparator only, cellstruct as a specification only) depend on terms stated in section 12.
- **First experiment.** Calibrate every score on random maps and on B4 before any method comparison, then apply the paired initialisation design (B2) to one annotated dataset with 20 or more groups.

## 11. References

R1. van der Maaten L, Hinton G. Visualizing Data using t-SNE. *Journal of Machine Learning Research* 9, 2008. — verified (corpus)
R2. Kobak D, Berens P. The art of using t-SNE for single-cell transcriptomics. *Nature Communications* 2019. doi:10.1038/s41467-019-13056-x — verified (corpus)
R3. Kobak D, Linderman GC. Initialization is critical for preserving global data structure in both t-SNE and UMAP. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00809-z — verified (corpus)
R4. Böhm JN, Berens P, Kobak D. Attraction-Repulsion Spectrum in Neighbor Embeddings. *Journal of Machine Learning Research* 23, 2022. — verified (corpus)
R5. McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction. arXiv:1802.03426, 2018. doi:10.48550/arxiv.1802.03426 — verified (corpus)
R6. Amid E, Warmuth MK. TriMap: Large-scale Dimensionality Reduction Using Triplets. arXiv:1910.00204, 2019. doi:10.48550/arxiv.1910.00204 — verified (corpus)
R7. Wang Y, Huang H, Rudin C, Shaposhnik Y. Understanding How Dimension Reduction Tools Work: An Empirical Approach to Deciphering t-SNE, UMAP, TriMap, and PaCMAP for Data Visualization. *Journal of Machine Learning Research* 22(201), 1-73, 2021. — verified (repo)
R8. Huang H, Wang Y, Rudin C, Browne EP. Towards a comprehensive evaluation of dimension reduction methods for transcriptomic data visualization. *Communications Biology* 5(1):719, 2022. — verified (repo)
R9. Heiser CN, Lau KS. A quantitative framework for evaluating single-cell data structure preservation by dimensionality reduction techniques. *Cell Reports* 31(5), 107576, 2020. doi:10.1016/j.celrep.2020.107576 — verified (search)
R10. Policar PG, Strazar M, Zupan B. openTSNE: A Modular Python Library for t-SNE Dimensionality Reduction and Embedding. *Journal of Statistical Software* 109(3), 2024. doi:10.18637/jss.v109.i03 — verified (repo)
R11. Moon KR, van Dijk D, Wang Z, Gigante S, et al. Visualizing structure and transitions in high-dimensional biological data. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0336-3 — verified (corpus)
R12. Coifman RR, Lafon S. Diffusion maps. *Applied and Computational Harmonic Analysis* 2006. doi:10.1016/j.acha.2006.04.006 — verified (corpus)
R13. Zappia L, Vinyard M, Klein M, Gigante S, DeMeo B, Cannoodt R, et al. openproblems-bio/task_dimensionality_reduction (GitHub repository). — verified (repo)
R14. Loh JW, Ouyang J. cellstruct for quantifying single-cell structure (R package). bioRxiv preprint doi:10.1101/2023.11.13.566337. — verified (corpus)
R15. Chari T, Pachter L. The specious art of single-cell genomics. *PLOS Computational Biology* 2023. doi:10.1371/journal.pcbi.1011288 — verified (corpus)
R16. Pearson K. On lines and planes of closest fit to systems of points in space. *Philosophical Magazine* 1901. doi:10.1080/14786440109462720 — verified (corpus)
R17. theislab/single-cell-best-practices, dimensionality reduction chapter (online book, GitHub repository). — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scikit-learn/scikit-learn | scikit-learn developers | BSD-3-Clause (COPYING) | t-SNE with PCA start; PCA baseline | callout |
| https://github.com/scverse/scanpy | scverse developers | BSD-3-Clause (LICENSE) | default parameters of the t-SNE and UMAP wrappers | callout (defaults only) |
| https://github.com/pavlin-policar/openTSNE | Pavlin Poličar (copyright line); Policar PG, Strazar M, Zupan B (paper) | BSD-3-Clause (LICENSE) | comparator | callout |
| https://github.com/lmcinnes/umap | Leland McInnes (copyright line); McInnes L, Healy J, Melville J (paper) | BSD-3-Clause (LICENSE.txt) | comparator; defaults and fitted constants | callout |
| https://github.com/YingfanWang/PaCMAP | Yingfan Wang, Haiyang Huang, Cynthia Rudin, Yaron Shaposhnik | Apache-2.0 (LICENSE) | comparator; triplet evaluation code | reimplement from the definitions; source as oracle |
| https://github.com/eamid/trimap | Ehsan Amid; Manfred K. Warmuth (paper) | Apache-2.0 (LICENSE) | comparator | callout |
| https://github.com/KrishnaswamyLab/PHATE | Moon KR, van Dijk D, Wang Z, Gigante S and others (paper) | Non-Commercial License (LICENSE.md, Yale University); the scRNA-tools database records GPL-2.0 | comparator | callout only; no vendoring |
| https://github.com/openproblems-bio/task_dimensionality_reduction | Luke Zappia (maintainer); Vinyard M, Klein M, Gigante S, DeMeo B, Cannoodt R (authors, per README) | MIT (LICENSE) | published metric definitions and processors | reimplement; source as oracle |
| https://github.com/the-ouyang-lab/cellstruct | Jui Wan Loh and John Ouyang (README); Jui Wan (DESCRIPTION author) | GPL-3.0 (LICENSE; DESCRIPTION) | Pearson variants of the distance correlations | reimplement from the README specification only; no code copied |
