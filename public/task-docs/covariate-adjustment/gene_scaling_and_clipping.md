---
id: covariate-adjustment.gene_scaling_and_clipping
title: Gene scaling, centering and clipping before PCA
area: covariate-adjustment
scope: core
paradigm: heuristic
literature_status: contested
priority: P1
depends_on: [normalization.variance_stabilizing_transform, feature-selection.highly_variable_gene_selection]
feeds: [dim-reduction.normalized_cell_embedding, neighbors.approximate_knn_search]
reads: [layers/log1p_norm, layers/pearson_residuals, var/highly_variable, obs/<batch_key>]
writes: [layers/scaled, varm/scale_mean, varm/scale_std, uns/scale_params]
devices: [cpu, cuda]
mcp_tool: singlet_covariate_adjustment_gene_scaling_and_clipping
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Gene scaling, centering and clipping before PCA

> Decides whether each gene is centred and scaled to unit variance, with optional clipping of extreme values, before PCA and neighbour-graph construction, and writes the matrix those steps consume.

## 1. Question

Should each gene be centred, scaled to unit variance and clipped at a maximum before PCA and the neighbour graph, or should PCA use the unscaled log-normalised or residual matrix instead? The input is a cells-by-genes matrix, optionally restricted to highly variable genes. The output is either a standardised matrix with its per-gene parameters, or the unscaled input passed through unchanged. A correct answer preserves cell-type structure and gives batch mixing without over-correction, as judged by the benchmarks in section 8.

## 2. Why this task matters and where the field stands

Scaling sits between normalisation and PCA, and every embedding and graph built on it inherits its geometry. Status: **contested**. The two dominant conventions disagree. Seurat's ScaleData centres and scales each gene and clips at 10 by default [R6][R7]. The Single-Cell Best Practices book argues against z-scoring before PCA, because a lowly expressed gene can then contribute as much variance as a strongly expressed one, and it states that there is no consensus [R2]; the same book clips at 10 in its differential-expression notebook but scales without a clip in its multimodal integration notebook [R2]. In scanpy, `sc.pp.scale` is a separate call that clips nothing by default [R8]. Residual models offer a different standardisation: analytic Pearson residuals under a negative binomial null [R3], and regularised negative binomial regression [R4]. A comparison of transformations covers the transform choice more broadly [R5] and does not isolate scaling.

Open problems:

- Which genes should count equally downstream is unresolved. Variance-weighted PCA keeps the leverage of high-expression genes; standardised PCA weights every gene equally [R2][R6].
- The clip constant is unresolved: 10 in ScaleData, and the square root of the cell count in residual implementations [R3].
- The closest published evidence is the scIB integration benchmark [R1]. Its per-batch scaling wrapper is called only by a unit test in the released repository (section 10).

## 3. Theory and insight

Let $X \in \mathbb{R}^{n \times G}$ be the cells-by-genes matrix with entries $x_{cg}$. Let $\bar{x}_g$ and $s_g$ be the mean and standard deviation of gene $g$ over cells, $S = \operatorname{diag}(s_g)$, $\Sigma$ the gene covariance, and $R$ the gene correlation matrix. The clip bound is $c$.

Standardisation with one degree of freedom:

$$z_{cg} = \frac{x_{cg}-\bar{x}_g}{s_g}, \qquad \bar{x}_g=\frac{1}{n}\sum_{c} x_{cg}, \qquad s_g^2=\frac{1}{n-1}\sum_{c}\left(x_{cg}-\bar{x}_g\right)^2 .$$

Regime: $n \ge 2$ and $s_g > 0$. Zero-variance genes are set to 0 under the scanpy convention. Each scaled gene has sample variance exactly one by construction, so genes become comparable in units of their own spread.

Clipping, applied after standardisation:

$$\hat z_{cg}=\min\bigl(\max(z_{cg},-c),\,c\bigr)\ \text{(two-sided)}, \qquad \hat z_{cg}=\min(z_{cg},c)\ \text{(upper only)}.$$

Clipping bounds the leverage of a single cell on its gene. Wherever the bound binds, it also reduces that gene's variance, so the clipped matrix is no longer a standardisation of the original tails.

The PCA identity:

$$Z = X_c S^{-1}, \qquad \frac{1}{n-1} Z^{\top} Z = S^{-1}\Sigma S^{-1} = R .$$

Without scaling, PCA eigendecomposes $\Sigma$, so gene $g$ carries weight $s_g^2$ in the total variance. With scaling it eigendecomposes $R$, so every gene carries unit weight. The identity is exact for any centred matrix before clipping, and clipping breaks it. Its biological reading is sensible only where variance is informative, such as log-normalised values; on raw counts, variance is largely depth-driven.

Sparse binary features. For a feature detected in a fraction $p_g$ of cells, an expressing cell has standardised value $z_+ = \sqrt{(1-p_g)/p_g}$, and the clip binds if and only if $p_g < 1/(c^2+1)$. With $c = 10$ this threshold is 1/101, about 1 percent. Regime: binary features. For log-normalised counts the expressing values vary, so this identifies which genes dominate rather than giving exact values.

Analytic Pearson residuals under a shared-dispersion negative binomial null:

$$r_{cg}=\frac{y_{cg}-\mu_{cg}}{\sqrt{\mu_{cg}+\mu_{cg}^2/\theta}},\qquad \mu_{cg}=s_c\,\pi_g,\qquad \pi_g=\frac{\sum_c y_{cg}}{\sum_{c,g} y_{cg}},\qquad s_c=\sum_g y_{cg}.$$

Here $\theta$ is a shared dispersion, and $\theta \to \infty$ gives Poisson residuals. Regime: UMI counts, a shared-$\theta$ negative binomial, and $\mu$ known. Estimating $\pi_g$ and $s_c$ from the data holds the unit-variance property to first order.

Two consequences follow. First, with constant size factors and Poisson counts whose empirical standard deviation approximates the square root of the mean, the z-score and the Poisson Pearson residual agree to first order; they differ through depth and overdispersion. Second, for a singleton count with expected count $\mu = 1/n$ under a Poisson null, the residual is $(1-1/n)/\sqrt{1/n} = \sqrt{n}\,(1-1/n) \approx \sqrt{n}$. This derivation is ours, and it explains why $\sqrt{n}$ is a natural clip: it truncates singleton-type outliers and no more. The bound therefore changes with dataset size. Regime: Poisson null, large $n$, expected count near $1/n$.

Estimands of the outputs:

- The scaled and clipped matrix $\hat z_{cg}$ is the standardised deviation of gene $g$ in cell $c$ from the gene's mean over the input cells, with per-batch means only when a batch key is set.
- The residual $r_{cg}$ is the count's deviation from its null mean in units of the null standard deviation; the normalisation comes from the null, not from the empirical variance.
- The embedding is the cell coordinates on the top principal axes of the matrix passed to PCA, with unit-norm loadings.

Scaling is a per-gene reweighting. It trades the leverage of highly expressed, high-variance genes for that of low-expressed, noisy genes, and clipping limits the leverage of rare outliers. Which trade-off is right depends on whether expression magnitude carries signal worth keeping. Heuristic standardisation fails in three ways. Rare genes are amplified: a gene detected in under about 1 percent of cells has standardised values beyond 10, so a few cells can dominate its variance unless clipped. Clipping also truncates the informative tails of genuinely rare states along with technical spikes. Per-batch centring removes between-batch mean differences but introduces batch-specific scalings that downstream metrics can read as structure.

Model-based standardisation supplies what a heuristic cannot: a reference distribution. Residuals have approximately unit variance under the null, which makes genes comparable across depth, and a clip can in principle be set as a tail probability of that null rather than as a fixed constant. Both benefits hold only where the null fits; heterogeneous overdispersion makes the unit-variance property approximate.

Batch-removal metrics can be maximised by removing all batch structure, so biological-conservation guardrails must be read with them [R1].

Complexity: standardisation touches each stored entry a constant number of times, so cost is linear in stored entries when zero entries are handled analytically; dense zero-centring of a sparse input costs $O(nG)$ memory.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Seurat ScaleData z-score with clip at scale.max | heuristic | centre each gene, divide by its SD over cells, clip above scale.max | [R6], [R7] |
| scanpy sc.pp.scale | heuristic | per-gene centring and unit variance; two-sided clip when max_value is set | [R8] |
| No scaling (PCA on log-normalised values) | heuristic | centring inside PCA only; gene weight follows variance | [R2] |
| Scaling restricted to highly variable genes | heuristic | standardise only selected genes; the Seurat tutorial scales variable features by default | — |
| Analytic Pearson residuals with clip at sqrt(n) | model-based | standardise counts against a shared-dispersion negative binomial null | [R3], [R4] |
| Per-batch scaling (scIB scale_batch) | heuristic | scale each batch separately before merging | [R1] |
| GPU z-score (rapids-singlecell) | heuristic | per-gene scaling on CUDA for dense and sparse input, with a max_value option | — |

Two published conventions exist: z-scoring with a clip of 10, as in Seurat [R6][R7], and no scaling before PCA, as in the best-practices book [R2]; scanpy's PCA centres without scaling. Residual standardisation is the model-based alternative. The per-batch and GPU rows are implementation variants of the z-score, and restricting scaling to highly variable genes is a feature-selection choice shared with that task.

Exact defaults, with repository file and line (commit where recorded):

| Method | Parameter | Value | Source |
|---|---|---|---|
| Seurat ScaleData | scale.max | 10 | satijalab/seurat R/preprocessing.R:5398 @5f67c70 |
| Seurat ScaleData | do.center, do.scale | TRUE, TRUE | R/preprocessing.R:5396-5397 |
| Seurat ScaleData | features | all rownames when NULL; tutorial scales variable features only | R/preprocessing.R:5405; vignettes/pbmc3k_tutorial.Rmd:171 |
| Seurat ScaleData (dense C++ kernel) | clip direction | upper bound only (`clip_scale_value`) | src/data_manipulation.cpp:329-331 @5f67c70, called at R/preprocessing.R:5462 |
| scanpy sc.pp.scale | max_value | None | src/scanpy/preprocessing/_scale.py:92 @8ed52d9 |
| scanpy sc.pp.scale | zero_center | True (ScanpyV1); None (ScanpyV2Preview) | _scale.py:91; src/scanpy/_settings/presets.py:258-259 |
| scanpy sc.pp.scale | ddof | 1 (divide by n_obs - 1) | _scale.py:103-108 |
| scanpy sc.pp.scale | clip direction | two-sided if zero_center; upper bound only otherwise | _scale.py:58-74 (clip_array) |
| scanpy sc.pp.pca | zero_center | True (centring inside PCA, no gene scaling) | src/scanpy/preprocessing/_pca/__init__.py:64 |
| scanpy experimental Pearson residuals | clip | sqrt(n_obs) when None | src/scanpy/experimental/pp/_normalization.py:53-56 @8ed52d9 |
| sctransform | res_clip_range | c(-sqrt(ncol), sqrt(ncol)) | R/utils.R:216 @49e35b5 |
| Seurat SCTransform | clip.range | c(-sqrt(n/30), sqrt(n/30)) | R/preprocessing.R:3896 @5f67c70 |
| scib scale_batch | max_value | no clip argument; per-batch sc.pp.scale | scib/preprocessing.py:351-386 @cd67913 |
| scib DESC scale_bygroup | max_value | 6 | scib/integration.py:449 @cd67913 |
| rapids-singlecell scale | max_value | None (docstring); sparse path clips the upper bound only | src/rapids_singlecell/preprocessing/_scale.py:55, 269 @e110792 |

## 5. Proposed singlet approach

Routes. The z-score path is ported from scanpy, and the per-batch wrapper is ported from scIB; upstream terms allow reuse (section 12). The analytic residual clip is ported from its scanpy implementation, and sctransform code is not used. Seurat ScaleData, the sctransform constant and the OpenProblems metric configurations are callouts for comparison. The rapids-singlecell kernels inform the CUDA layout only.

Model-based formulation. Pearson residuals are computed once, in normalization.variance_stabilizing_transform, which owns the dispersion and size factors. This task only clips them and standardises the output, so the residual formula lives in one place. A calibrated clip, set at a tail probability of the simulated null, is proposed but is not exposed by the tool until B2 supports it. It is falsified if B2 shows no ARI gain over the square-root-of-n clip on contaminated simulations, or a loss of rare-group recall. The unscaled default is replaced only if the B1 acceptance rule holds.

ML stack. No learned model is required. Per-gene sums and sums of squares are sparse reductions, and standardisation and clipping are elementwise, so the core is hard-coded CUDA with cuSPARSE rather than PyTorch. PyTorch would be justified only for a learned dispersion, which belongs to the residual task.

Core kernels and storage. Statistics accumulate in float64 with compensated updates over cells, because float32 sums of squares lose precision for genes with large means. With zero_center false, stored values are divided by $s_g$ and sparsity is kept. With zero_center true, every zero entry of gene $g$ has the same standardised value, so only the non-zero entries and one per-gene constant are needed for an implicitly centred operator. Zero entries of residuals depend on the cell through $s_c$, so they are stored as per-cell and per-gene constants. Materialised output is written for consumers that need it; PCA may consume the implicit form where memory is the constraint.

Backends and streaming. Both backends compute the same statistics. CUDA processes blocks of genes. Streaming reads chunks of cells twice, once for statistics and once for writing, because the statistics are per gene.

Defaults an agent uses without asking. Method none, unless scaling is requested. When requested: zscore with max_value 10, two_sided clipping, zero_center true, ddof 1 and highly variable features. For pearson_residuals: clip sqrt_n on the residual layer written by the variance-stabilising task.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/log1p_norm | float32 | log-normalised values, cells by genes (zscore) |
| read | layers/pearson_residuals | float32 | residuals from the variance-stabilising transform (pearson_residuals) |
| read | var/highly_variable | bool | gene mask, used when features is highly_variable |
| read | obs/<batch_key> | categorical | batch labels, used only when zscore batch_key is set |
| write | layers/scaled | float32 | scaled or clipped matrix; dense when zero_center is true, sparse otherwise; zero for unselected genes |
| write | varm/scale_mean | float32 | per-gene mean (zscore); one column per batch when batch_key is set |
| write | varm/scale_std | float32 | per-gene standard deviation, with the same layout (zscore) |
| write | uns/scale_params | dict | method, features, clip settings, ddof, n_obs, batch_key, source layer |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "log1p_norm" | — | Normalised layer under layers/ that method zscore scales; ignored by the other methods. |
| `method` | string | "none" | `none`, `zscore`, `pearson_residuals` | none leaves PCA on unscaled values (default); zscore standardises each gene; pearson_residuals clips existing residuals. |
| `features` | string | "highly_variable" | `highly_variable`, `all` | Genes to scale. highly_variable needs var/highly_variable and fails if absent; other genes are written as zero. |
| `zscore` | object | — | — | Options for method zscore. |
| `zscore.zero_center` | boolean | true | — | Subtract the per-gene mean. False keeps sparse input sparse. |
| `zscore.max_value` | number/null | 10 | > 0 | Clip magnitude after scaling; null disables clipping. |
| `zscore.clip_mode` | string | "two_sided" | `two_sided`, `upper_only` | two_sided clips both tails; upper_only clips the upper tail only, as in some implementations. |
| `zscore.ddof` | integer | 1 | `0`, `1` | Degrees of freedom for the per-gene standard deviation. |
| `zscore.batch_key` | string/null | null | — | Obs column; when set, each batch is scaled separately. |
| `pearson_residuals` | object | — | — | Options for method pearson_residuals. |
| `pearson_residuals.residual_layer` | string | "pearson_residuals" | — | Residual layer under layers/ written by normalization.variance_stabilizing_transform. |
| `pearson_residuals.clip` | number/string | "sqrt_n" | — | Symmetric residual clip: a positive number, or sqrt_n for the square root of the number of cells. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Parameters apply by method. The zscore object is read only when method is zscore, and pearson_residuals only for that method. Method none ignores every nested field and writes only uns/scale_params. Highly variable features fail when var/highly_variable is absent, rather than falling back to all genes, so the scaled set is never chosen silently. With zero_center false, scanpy's convention clips only the upper tail, so clip_mode should be set explicitly whenever max_value is used. The residual clip can only tighten residuals that the variance-stabilising task already clipped, so comparison arms must use unclipped residuals.

## 7. MCP tool

Tool name `singlet_covariate_adjustment_gene_scaling_and_clipping` (definition in `tasks/mcp/singlet_covariate_adjustment_gene_scaling_and_clipping.json`).

Example call:

```json
{"dataset": "atlas.singlet", "method": "zscore", "features": "highly_variable",
 "zscore": {"zero_center": true, "max_value": 10, "clip_mode": "two_sided"}}
```

Example result (placeholders, not measurements):

```json
{"dataset": "atlas.singlet", "status": "completed",
 "wrote": ["layers/scaled", "varm/scale_mean", "varm/scale_std", "uns/scale_params"],
 "summary": {"method": "zscore", "n_cells": "<int>", "n_genes_scaled": "<int>", "clipped_fraction": "<float>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Not long-running: the call is two sweeps over the matrix and completes inline. Not stochastic: no seed is accepted. Dry run returns estimated seconds, peak memory in GB and device, and states whether zero-centring densifies the input, without writing.

## 8. Benchmarks

Shared protocol. Every arm receives the same cells, the same gene list, the same PCA dimension (50 components) and the same neighbour parameters, all fixed before any arm is applied. The gene list is one fixed size, set before any arm runs; the protocol uses 2000 genes, one of the settings in the best-practices notebooks [R2]. Arms differ only in the matrix passed to PCA. Results are paired differences against the no-scaling arm, reported as distributions across datasets and methods rather than as means alone. Scores are never min-max rescaled across methods. Seeds are fixed wherever a method is stochastic.

### B1. Scaling and clipping on integration quality (published datasets)

- **Goal**: Measure whether z-scoring, clipping, per-batch scaling or residual standardisation before PCA and the kNN graph changes the batch-removal and bio-conservation profile relative to no scaling.
- **Ground truth**: Expert cell-type labels from the dataset annotation and the dataset batch column. Both are observed rather than planted, and neither depends on the arm. Each metric is normalised to [0,1] with higher values better, as in the table below.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| scIB integration task datasets | [R1] | scRNA-seq integration tasks; —; — | — | Each arm applies its own normalisation |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| iLISI | Local inverse Simpson index of batch labels on the kNN graph, rescaled to [0,1] | maximise | primary | [R1] |
| Batch ASW | For each cell-type label, the mean over its cells of 1 minus the absolute batch silhouette; averaged over labels | maximise | primary | [R1] |
| PCR batch | Reduction in the variance of the embedding explained by batch after integration, scaled to [0,1] with 0 meaning no change (scib/metrics/pcr.py:43-45 @cd67913) | maximise | primary | [R1] |
| kBET | Average per-label kBET acceptance, i.e. 1 minus the average rejection rate (scib/metrics/kbet.py:25, 42), with neighbourhood size k0 = min(70, max(10, floor(mean batch size within the label / 4))) (kbet.py:114 @cd67913) | maximise | primary | [R1] |
| cLISI | LISI on cell-type labels, inverted and rescaled to [0,1] | maximise | guardrail | [R1] |
| Label ASW | (ASW_C + 1)/2, with ASW computed on cell-type labels | maximise | guardrail | [R1] |
| Graph connectivity | Mean over labels of the share of each label's kNN subgraph in its largest connected component | maximise | guardrail | [R1] |
| NMI and ARI | Louvain clusters at the NMI-optimal resolution, compared with cell-type labels | maximise | guardrail | [R1] |

- **Comparators**: no scaling (reference arm); z-score of all genes with clip at 10; z-score of all genes without clip; z-score of highly variable genes only; per-batch z-score; analytic Pearson residuals with clip at sqrt(n).
- **Protocol**: For each dataset, each arm supplies the matrix to PCA. Every integration method in the reference set whose input is a PCA embedding or kNN graph is applied to each arm, with the method list fixed before comparison. Differences are computed per dataset and method, scaled arm minus unscaled arm.
- **Acceptance criterion**: Proposed, not from the literature. Scaling is adopted for a method and dataset pair only if the paired difference in the bio-conservation family mean is at least +0.01 and the batch-family difference is no worse than -0.01, reproduced in at least three datasets. Otherwise the unscaled default stands.
- **Known pitfalls**: Labels derived by clustering on the scaled PCA favour the scaled arm, so labels must come from the dataset annotation. Batch metrics reward over-correction, so the guardrails must be read with them.

### B2. Clip sensitivity on planted groups with rare high-leverage genes (proposed)

- **Goal**: Test whether the clip rule changes recovery of planted groups when rare genes carry standardised values beyond the bound.
- **Ground truth**: Planted simulation. The generator assigns each cell to one of K equal-size groups, and the noiseless log-mean profile of each group is known. The estimand is the agreement between Leiden clusters on the top 10 principal components and the planted labels, with resolution chosen so the partition has K clusters.
- **Generator recipe (proposed)**:
  1. Assign n cells, with n in {10^4, 10^5}, to K equal-size groups, K fixed in the protocol.
  2. Draw baseline means for G = 2000 genes from a log-normal with parameters fixed in the protocol.
  3. For a fraction of genes, multiply the mean in one randomly chosen group by a fold change.
  4. For a rare-gene fraction in {0, 0.01, 0.05}, lower detection of those genes to below 1 percent of cells: restrict expression to a random cell subset and draw values from a heavy-tailed distribution, so that standardised values exceed c. A spike fraction in {0, 0.001} sets the share of heavy-tailed cells within those genes.
  5. Add a two-level batch effect as a per-batch, per-gene multiplier with log-scale spread fixed in the protocol.
  6. Draw counts from a negative binomial with mean $s_c \mu_{cg}$ and a shared dispersion, with $s_c$ from a log-normal fixed in the protocol.
  7. Normalise to size factors and log1p. The noiseless profile is the log1p of each group's expected normalised values.
  8. Clean setting: rare-gene fraction 0 and no heavy-tailed spikes; otherwise identical.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated counts from recipe steps 1 to 8 | Recipe in this section; no external data | RNA counts; 2000 genes; n as in step 1 | not applicable | Contamination must match a real detection-rate distribution |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | Adjusted Rand index between clusters and planted labels | maximise | primary | — |
| NMI | Normalised mutual information with arithmetic-mean normalisation | maximise | primary | — |
| Outlier-driven variance fraction | Share of the variance of PC1 to PC10 contributed by cells with any standardised value beyond c, computed before clipping | minimise | guardrail | — |
| Procrustes distance | Both embeddings centred and scaled to unit Frobenius norm, optimally aligned by an orthogonal map; residual distance to the noiseless-profile embedding | minimise | guardrail | — |
| Rare-group recall | Share of cells in groups below 5 percent prevalence whose cluster has their group as majority label | maximise | guardrail | — |

- **Comparators**: no clip; clip at 10; clip at sqrt(n/30); clip at sqrt(n) on z-scores; analytic Pearson residuals with clip at sqrt(n).
- **Protocol**: All arms share the 2000 simulated genes, with 50 principal components computed and the top 10 used for clustering. Results are reported separately for contaminated and clean settings, at each n and grid value, over three simulation seeds.
- **Acceptance criterion**: Proposed, not from the literature. A clip counts as beneficial if ARI rises by at least 0.05 over no clip on contaminated simulations and falls by no more than 0.01 on clean simulations.
- **Known pitfalls**: A simulator can make rare genes more informative than real ones, so the detection-rate histogram of the contaminated simulations must be compared with a real dataset before use. A clip that helps planted groups can delete real rare populations; the rare-group recall guardrail exists for that reason.

### P1. Performance and scaling

Wall time, peak host memory, peak device memory and whether sparsity survives, for each arm at 10^4, 10^5 and 10^6 cells by 2000 genes generated by recipe B2 with rare-gene fraction 0, and at catalogue subsample sizes fixed when the benchmark is specified. Comparators: scanpy `sc.pp.scale` on CPU with zero_center True and False; Seurat ScaleData through its R interface; rapids-singlecell scale on GPU; the singlet CUDA kernel; and a copy-only baseline. Hold fixed: float32, 2000 genes, the same hardware (CPU and GPU models recorded), sparse and dense input reported separately, and three repetitions. Each implementation must match a CPU reference within 1e-4 absolute on standardised values (proposed tolerance). Dense float32 at 10^6 by 2000 is 8 GB (10^6 x 2000 x 4 bytes); the implicit route avoids materialising it for PCA, and this benchmark measures both. No speed threshold is set until baselines are measured.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
- **Feeds**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
- **Reads**: `layers/log1p_norm`, `layers/pearson_residuals`, `var/highly_variable`, `obs/<batch_key>`
- **Writes**: `layers/scaled`, `varm/scale_mean`, `varm/scale_std`, `uns/scale_params`
<!-- CHAINING:AUTO:END -->

Belongs to the standard embedding workflow, after normalisation and gene selection and before PCA and the neighbour graph, and to integration workflows that take a PCA input.

## 10. Risks, pitfalls and open questions

- **scIB evidence**: The scaling conditions and aggregate weights of the scIB paper were not checked against its text. In the released repository, `scale_batch` is called only from a unit test. The B1 dataset row gives no access URL, and its licence, species and cell counts are dashes because no access record was located.
- **Unverified defaults**: The Seurat feature default comes from tutorial text, and the Seurat and sctransform author lists come from README text. scanpy's zero_center under the ScanpyV2Preview preset was taken from code and not executed. The square-root-of-n rationale in Lause et al. and the clip statement in Hafemeister and Satija are unverified against the paper texts.
- **Unsettled literature**: The interaction with highly variable gene choice, whether scaling should feed only the graph or also the embedding, and the effect of per-batch offsets on batch metrics are unstudied.
- **Technical risks**: sctransform code is not ported (section 12). PCA reads its input through a layer argument, so using this output requires layer set to scaled; zero-filled unselected genes must not change its gene selection.
- **Calibrated clip gap**: The tail probability for the calibrated clip is unset, and that option is absent from the tool definition. The dispersion default that the residual input uses is set by the variance-stabilising task.
- **First experiment**: B2 on the clean and contaminated grid at n = 10^4 with the five arms. It decides whether the clip rule matters at all before the cost of the B1 integration arms is paid.

## 11. References

R1. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022;19:41-50. doi:10.1038/s41592-021-01336-8 — verified (corpus)

R2. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)

R3. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)

R4. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019. doi:10.1186/s13059-019-1874-1 — verified (corpus)

R5. Ahlmann-Eltze C, Huber W. Comparison of transformations for single-cell RNA-seq data. *Nature Methods* 2023. doi:10.1038/s41592-023-01814-1 — verified (corpus)

R6. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)

R7. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)

R8. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | scverse (LICENSE copyright line); pyproject.toml author list, including Alex Wolf | BSD-3-Clause (pyproject.toml; LICENSE file) | z-score, analytic residual clip and PCA defaults | port |
| https://github.com/satijalab/seurat | Seurat authors, Satija Lab at NYGC (README) | MIT + file LICENSE (DESCRIPTION; LICENSE header 2021) | ScaleData and SCTransform constants | callout |
| https://github.com/ChristophH/sctransform | Christoph Hafemeister, developed in Rahul Satija's lab at NYGC (README) | GPL-3 (DESCRIPTION; LICENSE file is the GPL v3 text) | clip constant comparison only | callout |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt; pyproject) | per-batch scaling wrapper | port |
| https://github.com/openproblems-bio/openproblems | OpenProblems project (LICENSE copyright holder) | MIT (LICENSE file) | metric configurations for B1 | callout |
| https://github.com/scverse/rapids-singlecell | Severin Dicks (pyproject.toml); scverse (LICENSE copyright line) | MIT (LICENSE; copyright Dicks 2022 and scverse 2025) | GPU z-score and sparse clip reference | port |
