---
id: clustering.cluster_stability
title: Cluster stability under resampling and perturbation
area: clustering
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [clustering.cell_partitioning, clustering.resolution_selection, feature-selection.highly_variable_gene_selection, dim-reduction.pc_number_selection]
feeds: [clustering.cluster_significance_testing, annotation.cluster_label_assignment, markers-de.cluster_marker_ranking]
reads: [layers/counts, obsm/X_pca, obs/<cluster_key>]
writes: [obs/<name>_score, uns/<name>_clusters, uns/<name>_replicate_ari]
devices: [cpu, cuda]
mcp_tool: singlet_clustering_cluster_stability
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Cluster stability under resampling and perturbation

> Scores how often each cluster of an existing partition is recovered when cells are resampled and the clustering is repeated, and reports per-cluster, per-cell and replicate agreement under stated cutoffs; it does not decide whether a stable cluster is a real cell type.

## 1. Question

Given a partition of $n$ cells into clusters $C_1,\dots,C_K$ from a fixed pipeline, and a resampling law $P$, what is the probability that each $C_i$ is recovered when the pipeline is applied to perturbed data, and how much do the partitions agree overall? Inputs are raw counts, the partition column and the pipeline settings; outputs are per-cluster scores with a stability flag, a per-cell score and one replicate ARI per resample. A correct answer is a reproducibility estimate under $P$, not evidence that a cluster corresponds to a biological type.

## 2. Why this task matters and where the field stands

Markers, annotation and composition results are all computed on clusters, and a partition from one seed at one resolution can reflect the seed, the feature set or the graph more than the cells. The status is **contested**. Reproducibility is widely measured, but the sources disagree on the perturbation (cells, features, seeds or parameters), the agreement measure (per-cluster overlap, co-clustering or global agreement) and the cutoff. Cluster-wise bootstrap Jaccard is a per-cluster form of the idea [R2], and scclusteval applies it to single-cell data with Seurat [R3]. chooseR scores co-clustering over subsamples and uses it to compare resolutions [R4]. Consensus matrices [R5] and ARI between partitions [R6] are the global counterparts, and [R7] is the general overview of clustering stability. Cross-resolution indices measure agreement over a ladder of resolutions rather than over resamples [R8][R9]. Unsupervised scRNA-seq clustering is reviewed as a field with open challenges [R1].

Open problems:

- No benchmark with external truth for stability is available in the cited sources, so the protocols in section 8 are proposals.
- The 0.6 Jaccard cutoff is a convention. Its dependence on cluster size and resample fraction is unmeasured.
- A method that returns the same partition on every resample is stable and can still be wrong.
- Whether features and PCA are recomputed per resample changes the answer, and the two reference tools differ on this [R3][R4].
- Maximal-overlap matching is not one-to-one, and a median can hide bimodal recovery.

## 3. Theory and insight

### 3.1 Estimands

Let $\mathcal C=\{C_1,\dots,C_K\}$ be the partition under test on $n$ cells. A resample $S_b$ holds a fraction $r$ of the cells, drawn without replacement by default; the pipeline is applied to $S_b$ and returns a partition $\mathcal D^{(b)}=\{D^{(b)}_j\}$ of $S_b$. With $J(A,B)=|A\cap B|/|A\cup B|$ and the replicate best match

$$J_{ib}=\max_j J\!\left(C_i\cap S_b,\;D^{(b)}_j\right),\qquad \bar J_i=\frac1B\sum_{b=1}^{B}J_{ib},$$

the per-cluster stability $\bar J_i$ estimates the expected best-match overlap under $P$, in $[0,1]$, normalised by the union of the two cell sets; replicates with an empty $C_i\cap S_b$ are excluded. Following the scclusteval code, a replicate recovers the cluster when $J_{ib}>\tau$ [R3], and the dissolution probability is $\hat p_i(\tau)=\frac1B\sum_b\mathbf 1[J_{ib}\le\tau]$. Because $J_{ib}$ depends on $r$ and on $|C_i|$, the same boundary noise costs a small cluster more overlap, so cutoffs are comparable only at matched $r$ and size.

The per-cell stability is a proposed definition, since no standard exists in the cited sources. For a cell $x$ in original cluster $i_x$, let $j^*_b(i)$ index the replicate cluster that best matches $C_i$ in replicate $b$:

$$s_x=\frac{\sum_b\mathbf 1[x\in S_b]\,\mathbf 1[x\in D^{(b)}_{j^*_b(i_x)}]}{\sum_b\mathbf 1[x\in S_b]}\in[0,1],$$

the estimated probability that $x$ stays with its cluster's match, given that it was sampled.

The replicate agreement $\mathrm{ARI}_b$ compares $\mathcal C$ and $\mathcal D^{(b)}$ on $S_b$, with $n_{ij}$ the shared-cell contingency counts and $a_i$, $b_j$ their margins:

$$\mathrm{ARI}=\frac{\sum_{ij}\binom{n_{ij}}2-\frac{\sum_i\binom{a_i}2\sum_j\binom{b_j}2}{\binom n2}}{\tfrac12\Big[\sum_i\binom{a_i}2+\sum_j\binom{b_j}2\Big]-\frac{\sum_i\binom{a_i}2\sum_j\binom{b_j}2}{\binom n2}}.$$

It is chance-corrected, invariant to label permutation, and has expectation zero for random partitions with the same margins [R6].

The co-clustering score uses chooseR's normalisation, in which a pair counts only in replicates where both cells were sampled [R4]. With $m_{ib}=|C_i\cap S_b|$ and $n_{ijb}=|C_i\cap D^{(b)}_j|$, the fraction of co-sampled within-cluster pairs that stay together is

$$\rho_{ib}=\frac{\sum_j\binom{n_{ijb}}2}{\binom{m_{ib}}2},$$

summarised over $b$ as $J_{ib}$ is. It needs one $K\times K$ table per replicate rather than a pair matrix. chooseR averages each pair over replicates before averaging pairs (group_scores, R/pipeline.R:135) [R4], so the two weight pairs differently. The consensus idea behind both is Monti's [R5]. SC3 averages binary co-membership and needs no co-sampling normalisation, because every cell is labelled in every repetition [R8].

For the cross-resolution index of a cluster $c_{k,i}$, with $L$ the other resolutions and $N_l$ the clusters at resolution $l$ that overlap $c_{k,i}$,

$$s(c_{k,i})=\frac1{|L|+1}\sum_{l\in L}\sum_{j\in N_l}\frac{|c_{k,i}\cap c_{l,j}|}{|c_{l,j}|\,|N_l|^2}$$

is clustree's implementation [R9]: for each cluster it sums the overlap with each overlapping cluster, normalised by that cluster's size and by the squared number of overlapping clusters. The SC3 function computes the same sum over cuts of its consensus tree (R/ShinyFunctions.R:311) [R8]. It uses no resamples, and a cluster identical to one cluster at each other resolution scores $|L|/(|L|+1)$, so it never reaches 1.

Count splitting is the model-based route. Binomial thinning, $X^{(1)}_{gi}\sim\mathrm{Bin}(X_{gi},\varepsilon)$ with $X^{(2)}=X-X^{(1)}$, gives independent Poisson folds with means $\varepsilon\mu$ and $(1-\varepsilon)\mu$ when $X\sim\mathrm{Poisson}(\mu)$ [R10]. The countsplit code treats absent overdispersion as infinite, which is the Poisson split (R/countsplit.R:53, :55), and uses beta-binomial or Dirichlet-multinomial splits for finite overdispersion [R11]. Independence requires a correct dispersion. Each fold holds about $\varepsilon$ of the counts, so two equal folds have half the depth, and their agreement is biased low relative to full data.

The Monte Carlo error $\mathrm{SE}(\bar J_i)\approx s_i/\sqrt B$, with $s_i$ the sample standard deviation of the $J_{ib}$, treats replicates as independent. Two resamples share on average $r^2$ of the cells (0.64 at $r=0.8$), so the true error is larger.

### 3.2 Failure modes

These follow from the definitions and the source code, not from benchmark results.

- **Stable but wrong.** A procedure that returns the same partition on every resample is called stable. The test measures reproducibility, not correctness.
- **Resolution and size bias.** Smaller clusters, at higher resolution or larger $K$, lose more Jaccard from the same boundary noise, so scores are not comparable across sizes or along a ladder.
- **Rare populations.** A real population smaller than a resample can fall below $\tau$ and be called dissolved.
- **Bimodal recovery.** A median can call a cluster unstable although most resamples recover it; report the fraction above $\tau$ beside it.
- **Fixed features.** Fixing features and PCA on the full data excludes feature-selection variance and overstates stability [R3][R4].
- **Non-injective matching.** Two original clusters can match one replicate cluster, which inflates agreement.
- **Quadratic objects.** A dense $n\times n$ consensus matrix at $n=10^5$ needs about 40 GB in float32 (derived). The chooseR reference builds a dense $n\times n$ matrix for each clustering column (R/pipeline.R:88-92) [R4].

### 3.3 Why heuristics work and what a model-based formulation adds

Resampling with the pipeline as a black box estimates recovery under $P$ for any clustering, without assumptions about the cells, which is why it is the usual choice. It gives no calibrated uncertainty about individual cells and cannot separate a stable real population from a stable artefact of the procedure. A model-based formulation adds a generative law for the replicates: count splitting draws them from a fitted Poisson or negative binomial model, so fold disagreement has a model-based reading. Posterior resampling from a fitted mixture is outside the first version. Both depend on the fitted model and must be calibrated on null and planted data (section 8).

### 3.4 Insight

Stability is a bias-variance diagnostic for the procedure. Partitions that reproduce under resampling reflect structure the procedure detects robustly. That is necessary for a cluster to be biologically meaningful but not sufficient, so the stability flag should be read together with the null and planted benchmarks.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Cluster-wise subsample Jaccard (scclusteval) | heuristic | Recluster cell subsamples with the full pipeline, match each cluster to its best replicate cluster, and summarise the overlaps by median, mean or fraction above a cutoff | [R2][R3] |
| Co-clustering robustness (chooseR) | heuristic | Fraction of co-sampled within-cluster pairs that stay together across subsamples, summarised per cluster and used to compare resolutions | [R4] |
| SC3 consensus | heuristic | Average of binary co-membership over repeated k-means with varied distances and dimensions; every cell is labelled in every repetition | [R8] |
| Cross-resolution index (clustree; SC3 cross-k) | heuristic | Overlap of each cluster with clusters at other resolutions, normalised by cluster and cluster-count sizes; no resampling | [R8][R9] |
| Count splitting | model-based | Binomial or beta-binomial thinning of counts into folds that are independent under a fitted Poisson or negative binomial model | [R10][R11] |

In the cited single-cell sources, the closest thing to a standard for per-cluster reproducibility is the subsample Jaccard of scclusteval, built on the cluster-wise bootstrap [R2][R3]. chooseR's co-clustering robustness is the other documented route with stated defaults [R4]. The cross-resolution indices answer a different question. Count splitting is the only model-based replicate generator among the cited tools; its per-cluster definition is not settled, so it is kept out of the first version.

Defaults of the two methods that singlet implements, and of the count-splitting code used in section 3:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| scclusteval | replicates `n` | 4 | R/scclusterboot.R:267 @ b1b22c7 |
| scclusteval | subsample fraction `rate` | 0.8 | R/scclusterboot.R:267 |
| scclusteval | cells per replicate | round(rate × n), drawn with `sample()` | R/randomsubsetdata.R:22, :26 |
| scclusteval | summary method | jaccard_median | R/scclusterboot.R:166 |
| scclusteval | `jaccard_cutoff` | 0.6 | R/scclusterboot.R:167 |
| scclusteval | `percent_cutoff` | 0.6 | R/scclusterboot.R:168 |
| chooseR | subsamples `n` | 100 | R/pipeline.R:32 @ 410bdbf |
| chooseR | subsample fraction `size` | 0.8 | R/pipeline.R:33 |
| chooseR | `npcs` | 100 | R/pipeline.R:34; R/helper_functions.R:36 |
| chooseR | `res` in multiple_cluster | 1.2 | R/pipeline.R:35 |
| chooseR | `resolution` in find_clusters | 0.8 | R/helper_functions.R:39 |
| chooseR | reduction handling | reused from the full object, not recomputed per subsample | R/pipeline.R:48-56 |
| countsplit | folds | 2 | R/countsplit.R:53 @ a9e9ad2 |
| countsplit | epsilon | rep(1/folds, folds) | R/countsplit.R:53 |
| countsplit | overdisps | NULL, which sets Inf (Poisson) for every gene | R/countsplit.R:53, :55 |

## 5. Proposed singlet approach

Routes: the subsample Jaccard is **ported** from scclusteval, keeping its notice. The co-clustering score is **reimplemented** from the chooseR algorithm and not copied. The cross-resolution indices and SC3 are **callouts**, used only as benchmark comparators. Count splitting is a **callout** until it clears the null benchmark in section 8, after which it is a port candidate.

The default is `subsample_jaccard` with 100 resamples, a fraction 0.8 without replacement, a median summary, $\tau=0.6$ and a percent cutoff of 0.6. Features are re-selected and PCA recomputed per resample (`recompute_features` true). scclusteval's code repeats it on every subsample [R3], and fixed features overstate stability (section 3.2). Each resample repeats variable-feature selection and PCA with the settings recorded in the dataset provenance, and every setting is written there. The default is also the published heuristic, which stays as the comparator even if a model-based route is adopted.

The model-based route is count-split replicates, which enter the method enum only after they are calibrated on section 8's null benchmark. The route is rejected if depth matching cannot be achieved, if the dispersion check fails on the null data, or if it does not improve planted-group recovery on B1 over `subsample_jaccard` at matched cost. Posterior resampling from a fitted negative binomial mixture is a later extension.

The core kernels are small, memory-bound and repeated $B$ times: binomial thinning on a device random generator, $K\times K$ contingency tables with Jaccard and ARI, max-overlap matching on small tables, and per-cell accumulators. They are written as hard-coded CUDA or cuSPARSE kernels. PyTorch is needed only if posterior resampling is added, where a Poisson or negative binomial mixture is fitted by minibatch. Peak memory is $O(n)$ for per-cell accumulators plus $O(K^2)$ per replicate, so the method never builds an $n\times n$ object. The chooseR-style pairwise store is avoided for that reason. Streaming is not claimed.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, used when features are recomputed |
| read | obs/<cluster_key> | categorical | partition under test |
| read | obsm/X_pca | float32 | embedding, used when `recompute_features` is false |
| write | obs/<name>_score | float32 | per-cell stability $s_x$ in [0,1] |
| write | uns/<name>_clusters | table | one row per cluster: cluster, n_cells, mean_score, median_score, pct_above_cutoff, dissolution_rate, stable |
| write | uns/<name>_replicate_ari | float64 vector | $\mathrm{ARI}_b$ for each resample, length `n_resamples` |

For `subsample_jaccard`, `mean_score` and `median_score` summarise $J_{ib}$ over $b$; for `coclustering_robustness` they summarise $\rho_{ib}$. `pct_above_cutoff` is the fraction of resamples with score above $\tau$, and `dissolution_rate` is one minus that fraction.

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `cluster_key` | string | required | — | obs column holding the partition to test, for example a Leiden column at one resolution. |
| `method` | string | "subsample_jaccard" | `subsample_jaccard`, `coclustering_robustness` | Scoring rule. subsample_jaccard is the default (per-cluster best-match Jaccard); coclustering_robustness scores within-cluster pair retention. |
| `name` | string | "stability" | — | Prefix for written members: stability gives obs/stability_score, uns/stability_clusters and uns/stability_replicate_ari. |
| `resampling` | object | — | — | Resampling law: number of resamples, fraction of cells per resample and replacement. |
| `resampling.n_resamples` | integer | 100 | min 2 | Number of cell resamples B; more gives a finer per-cluster distribution and smaller Monte Carlo error. |
| `resampling.subsample_fraction` | number | 0.8 | > 0; < 1 | Fraction r of cells per resample; scores are comparable only at a matched fraction. |
| `resampling.replace` | boolean | false | — | Draw cells with replacement; default is without replacement, as in scclusteval. |
| `pipeline` | object | — | — | Clustering pipeline re-applied to each resample: layer, resolution, PCs and feature recomputation. |
| `pipeline.layer` | string | "counts" | — | Raw-count layer used when features are recomputed per resample. |
| `pipeline.resolution` | number | 0.8 | > 0 | Graph-clustering resolution applied to each resample. |
| `pipeline.n_pcs` | integer | 100 | min 2 | Principal components used for the neighbour graph in each resample. |
| `pipeline.recompute_features` | boolean | true | — | Re-select variable features and recompute PCA per resample; false reuses the full-data embedding and understates variance. |
| `scoring` | object | — | — | Per-cluster thresholds and the rule that calls a cluster stable. |
| `scoring.jaccard_cutoff` | number | 0.6 | min 0; max 1 | Cutoff tau: a resample recovers a cluster when its score exceeds tau; 0.6 is the scclusteval default. |
| `scoring.stable_summary` | string | "median" | `median`, `mean`, `percent` | Stable rule: median or mean score above tau, or the fraction above tau exceeding percent_cutoff. |
| `scoring.percent_cutoff` | number | 0.6 | min 0; max 1 | Fraction of resamples above tau required by the percent rule. |
| `scoring.min_cluster_size` | integer | 0 | min 0 | Clusters with fewer cells are reported but not scored; 0 scores every cluster. |
| `seed` | integer | 0 | — | Base seed; each resample is seeded from it, so identical inputs give identical outputs. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules spanning parameters: `resampling` and `pipeline` apply to both methods, and `scoring` is read by both. The 0.6 cutoff is the scclusteval Jaccard default and has no calibrated counterpart for the co-clustering score, which is judged on section 8's benchmarks. `pipeline.recompute_features=false` uses the full-data embedding and gives the chooseR behaviour. `min_cluster_size` only excludes clusters from scoring. `cluster_key` must be categorical with at least two clusters.

## 7. MCP tool

Tool name `singlet_clustering_cluster_stability` (definition in `tasks/mcp/singlet_clustering_cluster_stability.json`).

Example call:

```json
{"dataset": "data/example.singlet", "cluster_key": "leiden_res_0.8", "resampling": {"n_resamples": 100}, "seed": 0}
```

Example compact result:

```json
{"dataset": "data/example.singlet", "status": "completed",
 "wrote": ["obs/stability_score", "uns/stability_clusters", "uns/stability_replicate_ari"],
 "summary": {"method": "subsample_jaccard", "n_resamples": 100, "n_clusters": "<K>", "n_stable": "<int>", "median_replicate_ari": "<float>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: the call performs $B$ clustering replicates, so above the inline limit it returns `queued` with a `job_id`. Stochastic: outputs depend only on the inputs and `seed`, so identical inputs give identical outputs. Dry run: returns `estimate` with seconds, peak memory in GB and device, scaling with `n_resamples`, cell number and `recompute_features`.

## 8. Benchmarks

Shared protocol: every benchmark uses the headline setting (`recompute_features` true, $B=100$ and $r=0.8$ without replacement unless stated, median rule with $\tau=0.6$ and percent cutoff 0.6) and reports the full grid of $\tau$ values, not only the best. Per-cluster metrics are stratified by cluster size. Simulations are generated per seed and setting and are not reused for threshold choice; thresholds are fixed before scoring. Comparators use the same simulated data, the same pipeline, and the cross-resolution index on the resolution ladder.

### B1. Planted-structure tracking (proposed)

- **Goal**: test whether stability separates planted groups from spurious splits.
- **Ground truth**: planted simulation. The planted F1 of a cluster is its best F1 against a simulator group, $\max_g 2|C_i\cap G_g|/(|C_i|+|G_g|)$, over the full data; ties go to the lowest group index.
- **Generator recipe**:
  1. For each seed and grid level of $K$, $n$ and separation, simulate with Splatter's group, differential-expression and fold-change parameters.
  2. Record each cell's group label from the colData field `Group`.
  3. Apply the fixed pipeline (highly variable genes, PCA, kNN graph, Leiden) over a resolution ladder.
  4. Compute each score with $B=100$ and $r=0.8$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter simulations on the grid, at least 20 seeds per cell | Generator [R12]; levels fixed before scoring | simulated; grid sizes | — | Simulator group label |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Per-cluster $\bar J_i$ | Mean of $J_{ib}$ over $B$ | maximise | score under test | [R2][R3] |
| Planted F1 | As in ground truth, per cluster | — | truth | — |
| Spearman $\rho$ | Between $\bar J_i$ and planted F1 over clusters and settings | maximise | primary | — |
| ROC-AUC real vs spurious | Real if planted F1 is at least 0.9 (proposed); score $\bar J_i$; ties by trapezoid | maximise | primary | — |
| False discovery proportion | Fraction spurious among clusters stable by the median rule at $\tau=0.6$ | minimise | guardrail | — |

- **Comparators**: scclusteval rules [R3]; the co-clustering score [R4]; cross-resolution index [R8][R9].
- **Protocol**: the shared protocol, with the settings above.
- **Acceptance**: proposed design target, not from the literature. AUC at least 0.90 where planted F1 reaches 0.90; false discovery proportion at most 0.10 for $\bar J_i\ge 0.6$; Spearman $\rho\ge 0.6$.
- **Known pitfalls**: strong differential expression makes groups trivially separable, inflating AUC; sweep separation. Cluster size changes Jaccard independently; stratify by size.

### B2. Null calibration (proposed)

- **Goal**: check whether arbitrary splits of a homogeneous population are called stable.
- **Ground truth**: planted simulation with no structure, so every cluster is spurious. The flagged-stable rate $\pi(K)$ is the fraction of the $K$ clusters of a forced partition that meet the stable rule, averaged over seeds and normalised by $K$.
- **Generator recipe**:
  1. Simulate one population of $n$ cells with Splatter using a single group.
  2. Build a QC-driven null by multiplying each cell's library size by a log-linear factor of a simulated continuous covariate, with no group structure.
  3. For each seed and each $K$ from 2 to 10, force a partition by k-means with $K$ clusters on the PCA of the null data.
  4. Score each forced partition with $B=50$ and $r=0.8$, and with $B=100$ as a sensitivity check.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Single-group simulation | Generator [R12] | simulated scRNA-seq; $n$ fixed before scoring | — | No structure |
| Library-size gradient null | Recipe step 2 | simulated scRNA-seq; as above | — | Technical gradient, no biology |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Flagged-stable rate $\pi(K)$ | Fraction of the $K$ clusters passing the stable rule, mean over seeds, reported by $K$ | minimise | primary | — |
| Seed-replicate ARI | Mean pairwise ARI between clusterings of the same null data at different seeds | minimise | guardrail | [R6] |

- **Comparators**: the scclusteval median, mean and percent rules [R3]; the co-clustering score [R4]; count-split fold ARI [R10][R11]; seed-replicate ARI as a global reference.
- **Protocol**: at least 20 seeds per $K$; the headline acceptance uses $B=50$.
- **Acceptance**: proposed design target, not from the literature. $\pi(K)\le 0.10$ at the default cutoff with $B=50$, across at least 20 seeds.
- **Known pitfalls**: forced splits of one population often look stable, the failure targeted here. Technical gradients create stable artefacts, which the QC null targets.

### B3. Consistency on the bundled PBMC example (consistency)

- **Goal**: reproduce a chooseR-style robustness profile on a public PBMC example, as a sanity check of the reimplementation.
- **Ground truth**: consistency only, with no labels. The estimand is the agreement between full-data clusterings with different seeds, computed on cells in clusters flagged stable.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| `ding_smartseq_pbmc_preprocessed.rds` in the chooseR repository | Repository [R4]; study [R13] | human PBMC, Smart-seq, about 500 cells (README); SCTransform and PCA precomputed | — | Raw-count retention is listed in section 10 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Replicate ARI on stable clusters | ARI between two full-data clusterings with different seeds, restricted to cells in clusters flagged stable by the median rule at $\tau=0.6$ | maximise | primary | [R4] |
| Dissolution rate | Mean over replicates of $\hat p_i(0.6)$, for clusters with at least 1% of cells | minimise | guardrail | — |

- **Comparators**: the scclusteval rules [R3]; chooseR itself [R4], with the undefined symbol corrected in a local copy.
- **Protocol**: resolutions 0.8 and 1.2, the chooseR defaults in section 4; $B=100$ and $r=0.8$; two seeds.
- **Acceptance**: proposed design target, not from the literature. Replicate ARI at least 0.9 for stable clusters across the two seeds; dissolution rate at most 0.05 for clusters with at least 1% of cells.
- **Known pitfalls**: about 500 cells give small resamples, so Jaccard is strongly size-sensitive. High replicate agreement does not establish correctness.

### P1. Performance and scaling

Wall time per resample, peak memory and throughput at 10k, 100k and 1M cells, on CPU and CUDA, for `subsample_jaccard` against scclusteval (R, Seurat) and for `coclustering_robustness` against chooseR (R, Seurat). The cross-resolution index is a cost reference only. Hold fixed: $B$, $r$, `n_pcs`, resolution, seed, thread count and the recompute setting. Data are generated with the B1 recipe at each size. The chooseR reference builds $n\times n$ matrices, so its memory grows as $n^2$ and it is compared only at sizes where it completes. Proposed acceptance, not from the literature: per-cluster $\bar J_i$ within $10^{-6}$ of the scclusteval reference on identical replicate index sets exported from R, and at least five times faster than the R loop at 100k cells.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `clustering.resolution_selection`: Choosing clustering resolution without reference labels
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
- **Feeds**:
  - `clustering.cluster_significance_testing`: Testing whether clusters or splits are statistically real, and merging over-split clusters
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
- **Reads**: `layers/counts`, `obsm/X_pca`, `obs/<cluster_key>`
- **Writes**: `obs/<name>_score`, `uns/<name>_clusters`, `uns/<name>_replicate_ari`
<!-- CHAINING:AUTO:END -->

No named recipe is assigned yet. The task takes a partition at a chosen resolution and gives evidence to significance testing, annotation and marker ranking, which should use only clusters flagged stable.

## 10. Risks, pitfalls and open questions

- **Unvalidated cutoffs.** The 0.6 default is scclusteval's. Its README rule of thumb (below 0.6 unstable, 0.6 to 0.75 a pattern, above 0.85 stable) cites no primary source, and the README does not contain the bimodal advice that secondary summaries attribute to it. Cutoffs must be calibrated by size and $r$ on section 8's benchmarks before any default is claimed.
- **Bibliographic evidence.** Hennig [R2] is confirmed only as a bibliographic record (sole author, venue, volume and pages), so the cutoff of 0.75 attributed to Hennig's mean-Jaccard guidance is unchecked against the paper. Monti [R5] is confirmed from an aggregator record rather than the article. Kiselev et al. [R1] are cited for the field's challenges only, and a secondary summary's claim that they call stability unresolved is unchecked against the review. Neufeld et al. 2022 [R10] is cited through the countsplit README, which gives the same title. The chooseR byline (Patterson-Cross, Levin, Menon) comes from a README whose title differs from the 2021 record in [R4].
- **Replicate counts and benchmarks.** No benchmark in the cited sources compares stability scores with accuracy, so the acceptance numbers in section 8 are design targets. No minimum $B$ is set by the sources: scclusteval's code default is 4, its README example uses 20, and chooseR uses 100.
- **Implementation risks.** The chooseR `find_clusters` body uses an undefined symbol, `integtrated` (R/helper_functions.R:45 @ 410bdbf), so the reference does not work unmodified. Routes for each source are in section 12. The bundled PBMC object's retention of raw counts, which `recompute_features` true needs, is unchecked.
- **Unresolved design choices.** The per-cell score is this document's definition, not a standard. Count splitting stays out of the first version until its per-cluster definition and depth matching are settled. Combining stability with resolution selection and significance testing risks counting the same evidence twice.
- **First experiment.** On the B2 null with default settings, compute the flagged-stable rate for $K$ from 2 to 10 over at least 20 seeds. If $\pi(K)$ exceeds 0.10 at $\tau=0.6$, the default cutoff is not shipped; then compute B1 over the grid. A cross-study concordance benchmark (within-study stability against cross-study agreement of cell types) is deferred, because the tissues and studies are not yet chosen.

## 11. References

R1. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R2. Hennig C. Cluster-wise assessment of cluster stability. *Computational Statistics & Data Analysis* 2007;52(1):258-271. — partial (search)
R3. Tang M, Kaymaz Y, Logeman BL, Eichhorn S, Liang ZS, Dulac C, Sackton TB. Evaluating single-cell cluster stability using the Jaccard similarity index. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa956 — verified (corpus)
R4. Patterson-Cross RB, Levin AJ, Menon V. Selecting single cell clustering parameter values using subsampling-based robustness metrics. *BMC Bioinformatics* 2021. doi:10.1186/s12859-021-03957-4 — partial (corpus)
R5. Monti S, Tamayo P, Mesirov J, Golub T. Consensus clustering: a resampling-based method for class discovery and visualization of gene expression microarray data. *Machine Learning* 2003;52(1):91-118. doi:10.1023/A:1023949509487 — partial (search)
R6. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R7. von Luxburg U. Clustering stability: an overview. *Foundations and Trends in Machine Learning* 2010;2(3):235-274. — unverified (memory)
R8. Kiselev VY, et al. SC3: consensus clustering of single-cell RNA-seq data. *Nature Methods* 2017. doi:10.1038/nmeth.4236 — partial (corpus)
R9. Zappia L, Oshlack A. Clustering trees: a visualization for evaluating clusterings at multiple resolutions. *GigaScience* 2018;7(7). doi:10.1093/gigascience/giy083 — verified (repo)
R10. Neufeld A, Gao L, Popp J, Battle A, Witten D. Inference after latent variable estimation for single-cell RNA sequencing data. *Biostatistics* 2022; arXiv:2207.00554. — partial (repo)
R11. Neufeld A, Popp J, Gao L, Battle A, Witten D. Negative binomial count splitting for single-cell RNA sequencing data. arXiv:2307.12985 (preprint) 2023. — verified (corpus)
R12. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R13. Ding J, Adiconis X, Simmons SK, et al. Systematic comparison of single-cell and single-nucleus RNA-sequencing methods. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0465-8 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/crazyhottommy/scclusteval | Ming Tang (DESCRIPTION Authors@R) | MIT + file LICENSE (DESCRIPTION); LICENSE.md is the MIT text, 2018 | Cluster-wise subsample Jaccard; default algorithm and comparator | port (keep notice) |
| https://github.com/rbpatt2019/cluster.stability | Patterson-Cross RB, Levin AJ, Menon V (README); chooseR | GPL-3.0 (LICENSE is the GPL v3 text) | Co-clustering robustness; PBMC example data | reimplement; comparator in B3 |
| https://github.com/hemberg-lab/sc3 | Vladimir Kiselev (DESCRIPTION) | GPL-3 (LICENSE; DESCRIPTION) | SC3 consensus and cross-k index arithmetic | callout (comparator only) |
| https://github.com/lazappi/clustree | Luke Zappia (DESCRIPTION maintainer) | GPL-3 (LICENSE; DESCRIPTION) | Cross-resolution index (R/stability.R) | callout (comparator only) |
| https://github.com/anna-neufeld/countsplit | Anna Neufeld (LICENSE copyright holder) | MIT + file LICENSE (DESCRIPTION) | Count splitting for the model-based route | callout; port candidate if validated |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Christina Azodi (contributor), Alicia Oshlack (DESCRIPTION Authors@R) | GPL-3 + file LICENSE (DESCRIPTION) | Simulator for B1, B2 and P1 | callout (benchmark generator) |
