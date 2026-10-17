---
id: scalability.representative_cell_sketching
title: Representative cell sketching (subsampling)
area: scalability
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [normalization.variance_stabilizing_transform, feature-selection.highly_variable_gene_selection, dim-reduction.scalable_truncated_svd]
feeds: [scalability.sketch_based_integration, annotation.reference_label_transfer, clustering.cell_partitioning]
reads: [layers/log1p_norm, var/highly_variable, obsm/X_pca, obs/batch]
writes: [obs/sketch_mask, obs/sketch_weight, obs/sketch_nearest, uns/sketch_params]
devices: [cpu, cuda]
mcp_tool: singlet_scalability_representative_cell_sketching
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Representative cell sketching (subsampling)

> Choose a fixed-size subset of cells that covers the embedding and keeps rare populations, then measure how well analyses on that subset transfer to all cells.

## 1. Question

Given a log-normalised cell-by-gene matrix and a PCA embedding of $n$ cells, which subset $S$ of $N\ll n$ cells best reproduces full-data statistics, and how should every cell be assigned to its nearest sketch cell? A correct sketch covers the embedding, keeps each cell type at the rate its frequency predicts, and, where weights are reported, gives unbiased population totals. Outputs are a selection mask, design weights where the method defines them, and a nearest-sketch index for every cell.

## 2. Why this task matters and where the field stands

Atlases of a million or more cells make all-cell neighbour graphs, clustering and embedding slow and memory-heavy, so analyses increasingly run on a representative subset and project results back to every cell. The subset must keep rare populations, which uniform sampling loses at a fixed size (section 3). Status: **contested**. Geometric sketching covers the embedding with grid boxes and reports better rare-population retention than uniform sampling [R1]. Seurat v5's leverage-score sketch samples cells in proportion to an approximate statistical leverage [R2][R8]; its vignette states, citing a 2022 preprint [R4], that leverage is highest for rare populations [R8]. scSampler greedily selects cells that maximise spread in a radius-normalised embedding [R3].

Open problems:

- **Population estimates.** The published samplers return indices or cell names without weights (geosketch and scSampler return indices, Seurat returns cell names). Proportions computed from their output are therefore not design-based estimates. Geometric sketches do admit exact weights from their box table (section 3), but no published sampler reports them.
- **Head-to-head comparison.** A comparison of leverage and geometric sketches on one dataset is absent from the local bibliography (section 10).
- **Sketch size.** Published sizes range from 1,000 to 50,000 cells, and no rule links the size to the number of rare types.
- **Scale.** The Seurat vignette says the workflow scales beyond 10 million cells, without a quantitative table [R8].

## 3. Theory and insight

Let $\{x_i\}_{i=1}^n\subset\mathbb{R}^d$ be the sampling embedding ($d=50$ principal components unless stated), $y_i$ a cell-type label used only for evaluation, and $S$ the sketch with $|S|=N$. A design gives each cell an inclusion probability $\pi_i=P(i\in S)$. The three outputs have different estimands. The mask $S$ defines the sketch. The weights $w_i=1/\pi_i$ estimate population totals $T(f)=\sum_{i=1}^n f(x_i)$ through the Horvitz–Thompson (HT) sum $\hat T(f)=\sum_{i\in S}w_i f(x_i)$, which is unbiased under any design with known positive $\pi_i$ [R9]. The nearest-sketch map $a(i)=\arg\min_{s\in S}\|x_i-x_s\|_2$ carries labels or coordinates to every cell; its estimand is the full-data quantity itself.

**Uniform sampling.** Under simple random sampling without replacement, a type with frequency $f_t=n_t/n$ is absent from the sample with probability

$$P(\text{no type-}t\text{ cell in }S)=\frac{\binom{n-n_t}{N}}{\binom{n}{N}}\approx e^{-Nf_t},$$

to first order in $N/n$ and for small $f_t$. At $N=5000$ a type of 0.1 percent frequency is missed with probability about $e^{-5}\approx0.007$, and a type of 0.02 percent frequency with probability about $e^{-1}\approx0.37$. Weights are exact here, $w_i=n/N$, so this design is the reference for all others.

**Leverage scores.** For $A=U\Sigma V^\top$, the statistical leverage $\ell_i=\|U_{i\cdot}\|_2^2$ satisfies $\sum_i\ell_i=\operatorname{rank}(A)$. Seurat avoids the SVD: it forms $SA=QR$ with $S$ a CountSketch of $s$ rows and returns $\tilde\ell_i=\|A_{i\cdot}R^{-1}G\|_2^2$, where $G$ is a Johnson–Lindenstrauss projection with $k=\lfloor 4\ln(\text{ndims})/(\epsilon^2/2-\epsilon^3/3)\rfloor$ columns (sketching.R:766–776) [R5][R8]. This approximates $\ell_i$ only when $S$ is a subspace embedding for $A$, which needs $s$ large relative to the feature count; the code raises $s$ to 1.1 times the feature count and refuses feature sets above 5000 features or above cells/1.1 (defaults table). Below $1.5s$ cells it uses exact scores (defaults table). Cells are then drawn one at a time with probability proportional to the remaining scores (sketching.R:117–120). Inclusion probabilities are therefore not $N\tilde\ell_i/\sum_j\tilde\ell_j$ when scores are skewed, and no closed form is available.

**Geometric covering.** Geosketch shifts each dimension to a zero minimum, divides by the global maximum (sketch.py:77–80), then bisects the box side length until the number of occupied boxes $K$ is within $\alpha$ of the target, then draws $N$ boxes and one cell from each (sketch.py:171–189). Conditional on the grid, the box draws form a simple random sample of $N$ boxes from $K$ when $N\le K$, and the within-box draw is uniform over the $m_b$ cells of the box. Each cell's inclusion probability is therefore

$$\pi_i=\frac{N}{K\,m_{b(i)}},\qquad w_i=\frac{K\,m_{b(i)}}{N},$$

an exact identity for the scheme, not a model. It holds for $N\le K$. The published target $K\in[N(1-\alpha),N(1+\alpha)]$ allows $K<N$, where a second round of draws applies and the formula is approximate. Inclusion is inversely proportional to local occupancy, so cells in sparse regions, where rare types may sit, are over-sampled, and raw sample proportions over-represent sparse regions. The bias belongs to the design, and the weights remove it in expectation; the published samplers do not return the weights.

**Greedy diversity.** scSampler's first cell is random. Each further cell minimises the accumulated potential $\Phi(j)=\sum_{s\in S}\|\tilde x_j-\tilde x_s\|_2^{-\alpha}$, where $\tilde x$ is the embedding scaled by the radius of a bounding ball of 100 random points (uclab.py:17–22, 53–59). The docstring states that a larger $\alpha$ gives better diversity (main.py:44). This design has no inclusion probabilities, and its selection depends on the greedy order.

**Model-based design.** An explicit design lets inclusion probabilities be chosen rather than implied. Let $\hat\rho$ be a density model of the embedding fitted before sampling, and let $q_i=\frac{1-\lambda}{n}+\lambda\,\hat\rho_i^{-1}/\sum_j\hat\rho_j^{-1}$ mix uniform sampling with inverse-density sampling. Then $\pi_i=\min(1,cq_i)$, with $c$ fixed by $\sum_i\pi_i=N$. The mixture gives every cell $\pi_i\ge c(1-\lambda)/n$, which bounds the HT variance, and it keeps the density-driven coverage. Poisson sampling yields a random sample size, so the sample is drawn with a fixed-size systematic probability-proportional-to-size design with the same first-order $\pi_i$. What the heuristic samplers lack is a calibrated $\hat\rho$ that can be fitted once and reused, and a choice of $\lambda$ that trades coverage against variance under a stated estimator.

**Estimands.** A type proportion $p_t=n_t/n$ is estimated by $\hat p_t=\frac1n\sum_{i\in S:\,y_i=t}w_i$, normalised by the full $n$ and not by $\sum_{i\in S}w_i$; the ratio form is a different estimand. A rare count is the number of sampled cells with label $t$, unnormalised. Every other metric is defined in section 8 where it is used.

**Failure modes.** Uniform sampling loses rare types, as above. Geometric covering degenerates when most boxes hold one cell, which happens at high dimension, and the bisection can stop at `max_iter` with a warning (sketch.py:161–164). Leverage scores follow high-variance directions, so technical or cell-cycle variation can dominate the scores, and rare types with weak variance receive low ones. Greedy and coverage samplers over-represent sparse regions, and the initial check exits when $\alpha$ is too large to avoid overflow (uclab.py:29–30). Every design fails when the sampling embedding separates types poorly, and every label transfer inherits the nearest-sketch map.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Geometric sketching (geosketch gs_gap) | heuristic | Equal-side grid over the embedding, side bisected to about N occupied boxes; one cell per box | [R1] |
| Leverage-score sketching (Seurat SketchData) | hybrid | Approximate leverage of cells in the variable-feature matrix by CountSketch and projection; weighted draw without replacement | [R2][R8] |
| Uniform random sampling | heuristic | Simple random sample of N cells without replacement; baseline for every comparison | [R1] |
| k-means++ seeding (kmeanspp) | heuristic | Sequential squared-distance seeding: the first cell is uniform, and each further cell is drawn with probability proportional to its squared distance to the nearest chosen cell; N cells in total | [R6] |
| Greedy diversity sampler (scSampler uclab) | heuristic | Greedy minimisation of an inverse-power potential over a radius-normalised embedding | [R3] |

Geometric sketching and Seurat leverage sampling are the published standards; uniform sampling is the baseline; the k-means++ and greedy samplers are coverage comparators. Code for all five is listed in section 12. The defaults below are taken from the code at the commits in section 12.

| Method | Parameter | Value | Source (repository @ commit: file:line) |
|---|---|---|---|
| geometric | `k` | `'auto'`, equal to N when `replace=False` | geosketch @73d6f4f: sketch.py:17, 67–71 |
| geometric | `alpha` | 0.1 | geosketch @73d6f4f: sketch.py:18 |
| geometric | `max_iter` | 200 | geosketch @73d6f4f: sketch.py:18 |
| geometric | `replace` | False (not exposed) | geosketch @73d6f4f: sketch.py:17 |
| geometric | `seed` | None; seeds the global NumPy RNG | geosketch @73d6f4f: sketch.py:57–58 |
| uniform | `replace` | False | geosketch @73d6f4f: sketch.py:439 |
| kmeanspp | `n_clusters` | N, the sketch size | geosketch @73d6f4f: kmeanspp.py:3; bin/experiments.py:419 |
| kmeanspp | `n_local_trials` | 1 | geosketch @73d6f4f: kmeanspp.py:4 |
| kmeanspp | `seed` | not used; draws from the global NumPy generator | geosketch @73d6f4f: kmeanspp.py:8 |
| leverage | `ncells` (SketchData) | 5000 | Seurat @5f67c70: R/sketching.R:48 |
| leverage | `method` (SketchData) | `LeverageScore`, first of `LeverageScore`, `Uniform` | Seurat @5f67c70: R/sketching.R:50 |
| leverage | `seed` (SketchData) | 123; reset for each layer | Seurat @5f67c70: R/sketching.R:53, 110–111 |
| leverage | `nsketch` | 5000 | Seurat @5f67c70: R/sketching.R:396 |
| leverage | `eps` | 0.5 | Seurat @5f67c70: R/sketching.R:399 |
| leverage | `ndims` | NULL, resolved to the number of cells | Seurat @5f67c70: R/sketching.R:397, 419 |
| leverage | feature guard | aborts above 5000 features or above cells/1.1 | Seurat @5f67c70: R/sketching.R:414–417 |
| leverage | exact-score branch | used when cells < 1.5 × `nsketch` (top-50 right singular vectors via irlba) | Seurat @5f67c70: R/sketching.R:406–412 |
| leverage | `nsketch` floor | raised to 1.1 × feature count when smaller | Seurat @5f67c70: R/sketching.R:420–421 |
| uclab | `alpha` | 50 | scSampler @ff589b0: scsampler/main.py:23 |
| uclab | `random_state` | 0; seeds NumPy at call time | scSampler @ff589b0: main.py:22, 97 |
| uclab | `obsm` | `'X_pca'` | scSampler @ff589b0: main.py:25 |
| uclab | `random_split` | None, treated as 1 | scSampler @ff589b0: main.py:29, 112 |
| uclab | bounding-ball sample | 100 random points | scSampler @ff589b0: scsampler/uclab.py:17 |

## 5. Proposed singlet approach

**Routes.** The geosketch sampler is ported with the bisection and draw loop kept, except where stated below; the box table is an integer hash grid per cell. Seurat's leverage sampler is ported: CountSketch as a one-nonzero-per-column sparse product, the small QR, and the projection as dense products, with the sequential weighted draw reproduced for parity. The greedy sampler and k-means++ seeding are ported, and uniform is written directly. Each route is a comparator in section 8 before any change is made.

**Exact geometric weights.** Singlet sets the bisection target to $K\in[N,\,N(1+\alpha)]$ instead of the published $N(1\pm\alpha)$, so that $N\le K$ holds and the weights $w_i=Km_{b(i)}/N$ of section 3 are exact. This changes the published sampler, so B1 and B2 compare it directly with the published output.

**Proposed model-based design.** The mixture design of section 3, with $\hat\rho$ a density model in the 50-component space fitted by maximum likelihood on the 354-million-cell catalogue (about 40 percent annotated), using study-held-out splits, and $\lambda$ chosen on held-out studies. Its HT estimates should be unbiased for type proportions, with the B4 weighted-ratio check within 0.05 of 1 for abundant components. It is falsified if (i) HT-weighted proportions of types with at least 1 percent prevalence differ from truth by more than 0.01 on held-out studies (proposed threshold), or (ii) its rare-type recall does not exceed geometric sampling at equal N in B1 or B4. If falsified, the exact geometric weights remain the weighted default. The design joins the MCP enum only after its code and these benchmarks exist.

**ML stack.** PyTorch fits the density model, a small normalising flow or Gaussian mixture in 50 dimensions. Hard-coded CUDA covers the hot paths: CountSketch as a cuSPARSE sparse-dense product, the small QR with cuSOLVER or a batched kernel, the projection as GEMM, nearest-sketch assignment as a tiled distance kernel, geometric occupancy as a hash-count kernel, and the greedy update as one reduction per selected cell.

**Devices and streaming.** Geometric and greedy sampling hold the $n\times d$ embedding in memory, about 2 GB in float32 at $10^7$ cells with 50 components. Leverage can stream rows into the CountSketch. Streaming is not claimed for the first release.

**Defaults for an agent.** Method `geometric`, `n_sketch` 5000 (the Seurat default; the vignette uses 50,000 for 1.3 million cells), `n_dims` 50, `seed` 123, `batch.key` null, `device` auto. Use uniform only as a baseline, or where unbiased totals are the sole goal, because it loses rare types.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/log1p_norm | float32 sparse | log-normalised expression; source of leverage features |
| read | var/highly_variable | bool | feature mask for the leverage path |
| read | obsm/X_pca | float32, n × d | embedding for sampling and nearest-sketch assignment |
| read | obs/batch | categorical | batch labels (column named by `batch.key`) when batching is set |
| write | obs/sketch_mask | bool | selected cells |
| write | obs/sketch_weight | float32 | design weight $1/\pi_i$ for uniform and geometric; NaN for other methods |
| write | obs/sketch_nearest | int64 | index of the nearest sketch cell for every cell |
| write | uns/sketch_params | dict | method, parameters, seed, version and commit |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "geometric" | `geometric`, `leverage`, `uniform`, `kmeanspp`, `uclab` | Sampling design; geometric is the published default, uniform the baseline. |
| `n_sketch` | integer | 5000 | min 1 | Cells in the sketch; every cell is returned when this is at least the cell count. |
| `n_dims` | integer | 50 | min 2; max 200 | Embedding components used for sampling and nearest-sketch assignment. |
| `batch` | object | — | — | Batch options applying to every method. |
| `batch.key` | string/null | null | — | obs column defining batches; required when per_batch_sizing is true. |
| `batch.per_batch_sizing` | boolean | false | — | Allocate n_sketch per batch, as Seurat does per layer, instead of globally. |
| `seed` | integer | 123 | — | Seed for the sampler's own generator; a fixed seed and dataset reproduce the mask. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `geometric` | object | — | — | Options for method geometric. |
| `geometric.alpha` | number | 0.1 | > 0 | Bisection tolerance on the occupied-box count, relative to n_sketch. |
| `geometric.max_iter` | integer | 200 | min 1 | Maximum bisection iterations; a warning is written when reached. |
| `leverage` | object | — | — | Options for method leverage. |
| `leverage.nsketch` | integer | 5000 | min 1 | CountSketch rows; raised to 1.1 times the feature count when smaller. |
| `leverage.eps` | number | 0.5 | max 1; > 0 | Johnson-Lindenstrauss error tolerance; smaller values give wider projections. |
| `leverage.max_features` | integer | 5000 | min 1 | Feature-count guard; larger feature sets are refused. |
| `uclab` | object | — | — | Options for method uclab. |
| `uclab.alpha` | number | 50 | > 0 | Exponent of the inverse-distance potential; very large values overflow. |
| `uclab.random_split` | integer/null | null | min 1 | Independent chunks for speed; null means one chunk. |
<!-- PARAMS:AUTO:END -->

Batch options apply to every method. With `per_batch_sizing` false, one global sketch is drawn; with it true, `n_sketch` is allocated to each batch, as Seurat does per layer. Method options apply only to their method: `geometric.*` to geometric, `leverage.*` to leverage, `uclab.*` to uclab. `n_dims` applies to geometric, kmeanspp and uclab. The leverage path works on features, but nearest-sketch assignment always uses the first `n_dims` components of `obsm/X_pca`. When `n_sketch` is at least the cell count, every cell is returned with weight 1. The tool refuses to proceed when `obsm/X_pca` is absent and does not compute a PCA.

## 7. MCP tool

Tool name `singlet_scalability_representative_cell_sketching` (definition in `tasks/mcp/singlet_scalability_representative_cell_sketching.json`). Example call and compact result, with placeholders in angle brackets:

```json
{"dataset": "atlas.singlet", "method": "geometric", "n_sketch": 5000, "seed": 123}
```

```json
{
  "dataset": "atlas.singlet",
  "status": "completed",
  "wrote": ["obs/sketch_mask", "obs/sketch_weight", "obs/sketch_nearest", "uns/sketch_params"],
  "summary": {"method": "geometric", "n_cells": "<int>", "n_sketch": 5000, "dims_used": 50,
    "weight_kind": "exact", "occupied_boxes": "<int>", "bisection_iterations": "<int>",
    "max_min_distance": "<float>", "q99_min_distance": "<float>"},
  "provenance_id": "<id>",
  "job_id": null
}
```

Long-running: jobs above a size threshold set from P1 are queued, and uclab reaches that threshold first because its cost scales with $Nnd$. Stochastic: yes, seeded; a fixed seed and dataset reproduce the mask. Dry run: estimates time and peak memory from $n$, $d$, $N$ and the method's cost model (P1), without writing.

## 8. Benchmarks

**Shared protocol.** Sample sizes $N\in\{1000,5000,10000,20000,50000\}$ and seeds $10$–$19$ follow the geosketch harness (bin/experiments.py at 73d6f4f: sizes from line 163, seeds from line 366, whose default is 10 seeds). Sampling is without replacement only. The sampling embedding is the first $d=50$ components of `obsm/X_pca`, computed once and shared by all methods. Evaluation labels are fixed per dataset and are never read by a sampler. Results are reported as mean and standard error over seeds, plus paired differences from uniform at the same seed, tested with a paired $t$-test over 10 pairs. Uniform is the comparator for every acceptance criterion. Hardware, package versions and commits are logged with each result.

### B1. Rare-type retention at fixed size

- **Goal**: At equal N, does a sketch keep more cells of rare types, and more of the full-data types, than uniform sampling?
- **Ground truth**: Labels read from `data/cell_labels/mouse_brain_cluster.txt` (mouse_brain.py:96); the origin of this file is not stated in the repository (section 10). Estimand: label counts over all $n$ cells, with proportions $p_t=n_t/n$ normalised by the full $n$. Rare types are those with $p_t<0.01$ (proposed).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| DropViz mouse brain, nine regions (mouse_brain.py:21–29) | [R7]; data bundle at http://cb.csail.mit.edu/cb/geosketch/data.tar.gz (geosketch README) | scRNA-seq, mouse brain, 690,000 cells in the source paper | — | Region list as in the harness; QC index at mouse_brain.py:99 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| rare_count | Sampled cells with a rare-type label, unnormalised count, averaged over seeds | maximise | primary | harness `rare` (experiments.py:456) |
| rare_type_recall | Fraction of the $T$ label types with at least one sampled cell, averaged over seeds (proposed) | maximise | primary | — |
| entropy_gap | $\lvert H_S/\log T-H_{\text{full}}/\log T\rvert$, with $H$ the Shannon entropy of the label histogram | minimise | guardrail | harness `normalized_entropy` (experiments.py:210, 467) |
| kl_proportions | $\mathrm{KL}(\hat p\,\Vert\,p)$ in nats between sample and full label proportions over $T$ types | minimise | guardrail | harness `kl_divergence` (experiments.py:469–481) |

- **Comparators**: uniform; geometric (published gs_gap with $k=N$, $\alpha=0.1$) and the exact-weight variant of section 5; kmeanspp; uclab; leverage.
- **Protocol**: Section 8 shared protocol. Rare-count differences are reported per seed.
- **Acceptance criterion** (PROPOSED): at $N=5000$, every type with expected uniform count $Nf_t<2$ is present in at least 9 of 10 seeds for the method, and the mean rare_count exceeds the uniform mean with a paired $t$-test $p<0.05$.
- **Known pitfalls**: (1) If the labels come from clustering in the same components used for sampling, agreement is favoured by construction; the label source must be independent of the sampling embedding (section 10). (2) Seeds set the global NumPy RNG, so calls in one process share state.

### B2. Covering radius and worst-case gap

- **Goal**: Does the sketch leave no region of the full data far from every sampled cell?
- **Ground truth**: Consistency (geometric; no labels). Estimand: for each cell $i$, $d_i=\min_{s\in S}\|x_i-x_s\|_2$ in the 50-component sampling embedding, in principal-component units. Metrics are the maximum and quantiles of the $n$ values $d_i$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| DropViz mouse brain regions, as in B1 | [R7] | scRNA-seq, mouse brain, — cells | — | Same files as B1 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| max_min_distance | $\max_i d_i$ | minimise | primary | harness `max_min_dist` |
| q99_min_distance | 99th percentile of $(d_i)$, linear interpolation | minimise | primary | harness `np.percentile` |
| q9999_min_distance | 0.9999 quantile of $(d_i)$ | minimise | guardrail | harness `np.quantile` |

- **Comparators**: uniform; geometric (published and exact-weight variants); kmeanspp; uclab.
- **Protocol**: Section 8 shared protocol. Distances are computed against the sample in batches of 20,000 cells, as in the harness, and quantiles are reported per seed.
- **Acceptance criterion** (PROPOSED): the mean q99_min_distance is no larger than the uniform mean at every N, and lower than uniform on at least 8 of 10 seeds at N=5000.
- **Known pitfalls**: (1) Evaluating in an embedding other than the sampling embedding changes the ranking of methods. (2) The maximum is driven by outliers and doublets, so it is always reported with the quantiles.

### B3. Cluster agreement after projection

- **Goal**: Do clusters computed on the sketch and propagated to all cells agree with the full-data partition?
- **Ground truth**: The author-provided labels of B1. Estimand: agreement between $y_i$ and $\hat y_i=\hat y(a(i))$ over all $n$ cells, where $\hat y$ are $k$-means labels on the sketch with $k$ equal to the number of distinct labels and $a(i)$ is the nearest sketch cell. NMI lies in $[0,1]$ and ARI has chance value 0; both are invariant to label permutation.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| DropViz mouse brain regions, as in B1 | [R7] | scRNA-seq, mouse brain, — cells | — | Same files as B1 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| nmi_propagated | Normalised mutual information between $y$ and $\hat y$, arithmetic normalisation (harness default, supervised.py:796) | maximise | primary | harness `kmeans_nmi` |
| ari_propagated | Adjusted Rand index between $y$ and $\hat y$ | maximise | primary | — |

- **Comparators**: uniform; geometric; leverage.
- **Protocol**: Section 8 shared protocol. Propagation is nearest sketch cell ($k=1$) for every method, including leverage.
- **Acceptance criterion** (PROPOSED): the mean ari_propagated at N=5000 is at least 0.02 above the uniform mean, with a paired $t$-test $p<0.05$.
- **Known pitfalls**: (1) Nearest-sketch propagation is a Voronoi assignment, which inflates agreement for large compact clusters, so the comparison is valid across methods rather than in absolute terms. (2) NMI rewards many small clusters, so ARI carries the decision.

### B4. Planted rare-type simulation

- **Goal**: With known component labels, do sketches recover a rare component across rare fractions and tail weights, and do weighted designs estimate component proportions without bias?
- **Ground truth**: Planted component labels, exact for every cell. Estimand: component proportions $p_k=n_k/n$, and coverage of rare-component cells as defined below.
- **Generator recipe**
  1. Fix $n=200{,}000$, $d=50$, and seed $s\in\{10,\dots,19\}$.
  2. Draw nine abundant means $\mu_k\sim N(0,16I_d)$, and set the rare mean $\mu_{10}=\mu_j+4u$, with $j$ uniform over the nine and $u$ a random unit vector.
  3. Set mixing weights $(1-f)/9$ for components 1–9 and $f\in\{0.001,0.01\}$ for component 10.
  4. Draw cells $x_i=\mu_{y_i}+\varepsilon_i$, with $\varepsilon_i\sim N(0,I_d)$ (Gaussian variant) or $\varepsilon_i$ a multivariate $t$ with 3 degrees of freedom scaled by $1/\sqrt3$ to identity covariance (heavy-tailed variant).
  5. Set the radius $r$ to the median, over a 20,000-cell subsample, of each cell's distance to its nearest other cell.
  6. Evaluate $N\in\{1000,5000,10000,20000,50000\}$ on the 50 coordinates directly, with no further preprocessing.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted mixture from recipe steps 1–6 | generator only | simulated, $d=50$, $n=200{,}000$ | not applicable | Gaussian and heavy-tailed variants |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| rare_type_recall | Fraction of rare-component cells $i$ with $\min_{s\in S}\|x_i-x_s\|_2\le r$ | maximise | primary | — |
| ht_ratio | Largest deviation from 1 of the seed-mean ratio $\hat p_k/p_k$, $\hat p_k=\frac1n\sum_{i\in S,\,y_i=k}w_i$, over abundant components; weighted designs only | minimise | guardrail | — |
| density_bias | Same ratio with unweighted sample proportions; descriptive only | — | reported | — |

- **Comparators**: uniform; geometric with exact weights; uclab; leverage.
- **Protocol**: 2 rare fractions, 2 tail models, 5 sample sizes and 10 seeds. Report curves of rare_type_recall against the expected rare count in the sample, $Nf$.
- **Acceptance criterion** (PROPOSED): a weighted design is retained for rare recall only if its rare_type_recall exceeds uniform at $f=0.001$ and $N=5000$, and its ht_ratio deviation is at most 0.05 for every abundant component.
- **Known pitfalls**: (1) Gaussian geometry favours coverage designs, which is why the heavy-tailed variant is included. (2) The recipe is fixed before any method is scored, so the generator is not tuned to the methods under test.

### P1. Performance and scaling

Wall time (median of five timed repetitions after one warm-up), peak resident memory, and throughput in cells per second, at $n=10^5$, $10^6$ and $10^7$ cells from the B4 generator with $d=50$ and $N=20{,}000$. Comparators: uniform, geometric (CPU and CUDA), kmeanspp, leverage on features, and uclab. uclab is timed at $10^5$ and $10^6$ only; its $10^7$ cost is reported from its model. Where the 1.3-million-cell developing mouse brain dataset of the Seurat vignette [R8] is accessible, it is added at $n\approx1.3\times10^6$. Hold fixed: $d$, $N$, threads, seed, in-memory format and hardware; record the CPU and GPU models. Cost model: geometric $O(nd)$ per bisection step, at most 200 steps; leverage $O(\mathrm{nnz})+O(sf^2)+O(nfk)$; uclab $O(Nnd)$. The harness timing script (bin/benchmark_samplers.py) repeats the embedding along axis 1, so its sizes scale dimensions rather than cells, and it is not used.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `dim-reduction.scalable_truncated_svd`: Approximate PCA and truncated SVD at atlas scale
- **Feeds**:
  - `scalability.sketch_based_integration`: Sketch-then-integrate fidelity
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Reads**: `layers/log1p_norm`, `var/highly_variable`, `obsm/X_pca`, `obs/batch`
- **Writes**: `obs/sketch_mask`, `obs/sketch_weight`, `obs/sketch_nearest`, `uns/sketch_params`
<!-- CHAINING:AUTO:END -->

Workflows: atlas-scale sketch-then-analyse (sketch, cluster, project and transfer labels) and sketch-then-integrate.

## 10. Risks, pitfalls and open questions

- **Dataset facts.** DropViz terms and the QC subset size are absent from the local sources. The origin of the cluster-label file is not stated, and the harness writes k-means labels into that path when it is missing (experiments.py:113–118), so label independence for B1 to B3 cannot yet be checked. The umbilical cord blood set is omitted: its bundle path is inferred from a harness script, its label source is unknown, and its rare-macrophage claim rests on a secondary summary.
- **Citations.** The scSampler author list beyond the code author is absent from the local bibliography, so its reference gives the code author only. Balanced NMI is omitted; the harness defines it in supervised.py (`dist='balanced'`), which is not reproduced here.
- **Unevaluated methods.** The density-aware sampler in dropClust and the Sphetcher spherical-thresholding variant have no code evaluated here and are excluded.
- **Performance and scaling.** No timing or memory measurement exists in the local sources, so P1 is a plan. The vignette's scaling claim beyond 10 million cells is untested.
- **Unsettled literature.** No head-to-head comparison of leverage and geometric sketches on one dataset exists locally. The Seurat v5 publication [R2] is not used for its sketch content; the leverage description rests on the code and the vignette. The results sections of the geosketch and scSampler papers are not covered here. The vignette illustrates its rare-population statement with one example, C1qa macrophages. Fidelity of sketch-then-project on the 1.3-million-cell dataset is not a benchmark here, because the vignette's cluster labels are not independent truth and no independent annotation is identified.
- **Risks and first experiment.** Exact geometric weights need the modified target $N\le K$, which changes the published sampler. The first experiment is B1 and B2 on the DropViz regions at $N=5000$, comparing published gs_gap, the modified target and uniform, with a weighted-proportion check on the same labels (the B4 ht_ratio applied to DropViz), before any model-based work.

## 11. References

R1. Hie B, Cho H, DeMeo B, Bryson B, Berger B. Geometric sketching compactly summarizes the single-cell transcriptomic landscape. *Cell Systems* 2019;8(6). doi:10.1016/j.cels.2019.05.003 — verified (corpus)
R2. Hao Y, Stuart T, Kowalski MH, Choudhary S, Hoffman P, Hartman A, Srivastava A, Molla G, Madad S, Fernandez-Granda C, Satija R. Dictionary learning for integrative, multimodal and scalable single-cell analysis. *Nature Biotechnology* 2024. doi:10.1038/s41587-023-01767-y — verified (corpus)
R3. Song D, et al. scSampler: fast diversity-preserving subsampling of large-scale single-cell transcriptomic data. *Bioinformatics* 2022. doi:10.1093/bioinformatics/btac271 — verified (corpus)
R4. Hao Y, et al. Dictionary learning for integrative, multimodal, and scalable single-cell analysis. *bioRxiv* 2022. doi:10.1101/2022.02.24.481684 — verified (corpus)
R5. Clarkson KL, Woodruff DP. Low rank approximation and regression in input sparsity time. *STOC* 2013. — unverified (memory)
R6. Arthur D, Vassilvitskii S. k-means++: the advantages of careful seeding. *SODA* 2007. — unverified (memory)
R7. Saunders A, Macosko EZ, Wysoker A, et al. Molecular diversity and specializations among the cells of the adult mouse brain. *Cell* 2018;174(4):1015–1030. doi:10.1016/j.cell.2018.07.028. DropViz portal dropviz.org, as cited in the geosketch README. — verified (search)
R8. Satija Lab. Sketch-based analysis in Seurat v5 (vignette seurat5_sketch_analysis.Rmd, satijalab/seurat at 5f67c70). — verified (repo)
R9. Horvitz DG, Thompson DJ. A generalization of sampling without replacement from a finite universe. *Journal of the American Statistical Association* 1952;47(260):663–685. doi:10.1080/01621459.1952.10483446 — verified (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/brianhie/geosketch | Brian Hie (package author) | MIT (LICENSE file; setup.py agrees) | gs_gap, uniform, kmeanspp; benchmark harness | port |
| https://github.com/satijalab/seurat | Satija Lab (NYGC) and contributors | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE.md holds the MIT text) | SketchData and LeverageScore | port |
| https://github.com/SONGDONGYUAN1994/scsampler | Dongyuan Song (package author) | MIT (LICENCE file) | uclab greedy sampler | port |
