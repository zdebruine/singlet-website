---
id: normalization.size_factor_estimation
title: Per-cell size factor estimation
area: normalization
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [ingest-quant.umi_deduplication, cell-calling.cell_vs_empty_droplet_calling, qc.low_quality_cell_detection]
feeds: [normalization.variance_stabilizing_transform, normalization.depth_confounding_diagnostic, dim-reduction.normalized_cell_embedding, markers-de.cell_level_two_group_de]
reads: [layers/counts, obs/<clusters_key>, var/<exclude_mask>]
writes: [obs/size_factor, obs/size_factor_log_se, layers/size_factor_scaled, uns/size_factor, models/size_factor_nb]
devices: [cpu, cuda]
mcp_tool: singlet_normalization_size_factor_estimation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Per-cell size factor estimation

> Estimate one strictly positive scale factor per cell from raw counts so that differences in sequencing depth and composition are removed without distorting real expression differences, with a documented scale convention and, where the model provides one, a log-scale standard error.

## 1. Question

Given a raw UMI or read count matrix (cells by genes), which positive factor $s_c$ per cell removes differences in sequencing depth, capture efficiency and composition without removing real expression differences? The output is $s_c$, defined up to one global constant fixed by `scale_convention`, and for model-based methods the standard error of $\log s_c$. A correct answer recovers planted factors in simulation, preserves known mixing ratios without residual depth structure in mixture data, and does not distort downstream results [R1][R2].

## 2. Why this task matters and where the field stands

Depth differs between cells for technical reasons (capture, library preparation, amplification) and biological ones (total RNA content), so any per-cell scale decides which genes define cell-to-cell ratios [R1], and log-normalised values, differential-expression models and residual embeddings inherit that decision [R2]. Library-size scaling is the default in scanpy and Seurat [R3][R4]; pooled deconvolution is designed for data with many zeros [R5].

The task is **contested**: the best-practices chapter notes that Ahlmann-Eltze and Huber compared 22 normalisation algorithms and that a benchmark across downstream tasks is still outstanding [R6][R2]. Published comparisons disagree:

- Ge et al.: six methods, 7 real and 4 simulated datasets; Dino best for clustering 10x-style and many-cell datasets, scTransform for full-length protocols, SCnorm for small datasets [R7].
- Vieth et al.: about 3,000 pipelines on simulated data; normalisation dominated when expression differences were asymmetric [R8].
- Lytal et al.: seven normalisers on two spike-in datasets, one simulation and two spike-in-free datasets [R9].
- Cole et al. (scone) and Germain et al. (pipeComp) provide ranking frameworks [R10][R11].

Open problems:

- **Output contract.** Dino returns resampled counts [R12], sctransform's depth term is an offset whose output is residuals [R13][R14], and analytic Pearson residuals are signed [R15]; none is a positive scalar.
- **Composition robustness.** Library-size and pooled estimates are biased under asymmetric differential expression of highly expressed genes [R1][R5].
- **Zero-dominated data.** DESeq2's median of ratios stops when every gene has a zero, and SCnorm is not intended above about 80% zeros [R19].
- **Biology in library size.** Cell size correlates with RNA content, so removing depth can remove signal (an inference).

Sarkar and Stephens separate measurement from expression models [R16]; the size factor is a measurement quantity.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $Y_{gc}$, $L_c=\sum_g Y_{gc}$ | count of gene $g$ in cell $c$; total count of cell $c$ |
| $s_c$, $\eta_c=\log s_c$ | size factor (positive, identified up to a global constant) and its log |
| $q_{gc}$ | expected count of gene $g$ in cell $c$ at unit size factor (the profile) |
| $\alpha_g$, $\theta$ | NB dispersion, $\operatorname{Var}=\mu+\alpha\mu^2$; sctransform's inverse dispersion $\theta=1/\alpha$ |

**Model.** UMI counts are modelled as $Y_{gc}\sim\mathrm{NB}(\mu_{gc},\alpha_g)$ with $\mu_{gc}=s_c q_{gc}$. This first-order model treats $q_{gc}$ as known, $\alpha_g$ as a function of the mean that does not depend on depth, and genes as independent given $(s_c,q_{gc},\alpha_g)$. Correlated genes make per-cell likelihood information too large; depth-dependent dispersion makes the variance model wrong.

**Estimand.** Only ratios $s_c/s_{c'}$ are identified, because $(s_c,q_{gc})$ and $(\kappa s_c,q_{gc}/\kappa)$ give the same means. `scale_convention` fixes $\kappa$: `median_one` sets the median factor to 1; `mean_one` sets the mean over positive factors to 1 (the scuttle output convention); `geomean_one` sets the mean of $\log s_c$ to 0; `median_nonzero_total` chooses the constant so that the median of $L_c/s_c$ over cells with $L_c>0$ equals the median non-zero total (for `library_size`, the scanpy default `target_sum`). The factor is identified only relative to the profile, so a wrong composition gives a wrong factor: the problem is joint depth and composition. In benchmarks the truth is the planted depth factor normalised to geometric mean 1 over cells (section 8).

**Library size.** $\mathbb E[L_c]=s_c\sum_g q_{gc}$, so $\hat s_c\propto L_c$ recovers $s_c$ only if $\sum_g q_{gc}$ is equal in every cell. More genes reduce sampling noise but not composition bias: highly expressed genes that are differentially expressed in one direction shift the total by cell type rather than by depth.

**Median of ratios.** With $G_0$ the genes positive in every cell, $\hat s_c=\operatorname{median}_{g\in G_0}Y_{gc}/(\prod_{c'}Y_{gc'})^{1/n}$ assumes most genes share the common cell-to-reference ratio. It is undefined when $G_0$ is empty, the normal case for droplet data at high zero fraction; DESeq2's `poscounts` variant takes geometric means over positive counts only. It is bulk-derived and kept as a comparator.

**Pooled deconvolution.** Within a cluster, cells ordered by library size define pools $P$ by a sliding window. For composition-similar cells $\mathbb E[Y_{gP}]=\sum_{c\in P}s_c q_{gc}\approx\Theta_P q_g$ with $\Theta_P=\sum_{c\in P}s_c$. Dividing the pool sum by a reference pseudo-cell (the average of prescaled counts) and taking the median over genes estimates $\Theta_P$. Windows of several sizes give an overdetermined system $A\mathbf s=\hat{\boldsymbol\Theta}$, with $A$ the 0/1 pool-membership matrix, solved by weighted least squares (QR). The solution is not constrained to be positive: non-positive entries raise a warning and, with `positive`, are replaced by values predicted from the number of detected genes. Regime: first order, many genes per pool, similar compositions within pools, and pools large enough for a non-zero median (scuttle recommends windows of at least 20 cells for UMI data and at least 100 cells per cluster).

**Per-cell maximum likelihood (`nb_mle`, proposed).** With $q_{gc}$ and $\alpha_g$ fixed, $\partial\ell/\partial\eta=(y-\mu)/(1+\alpha\mu)$ for $\mu=e^{\eta}q$ gives the score and expected information

$$S_c(\eta)=\sum_g\frac{y_{gc}-e^{\eta}q_{gc}}{1+\alpha_g e^{\eta}q_{gc}},\qquad I_c(\eta)=\sum_g\frac{e^{\eta}q_{gc}}{1+\alpha_g e^{\eta}q_{gc}}.$$

The log-likelihood is strictly concave in $\eta$, so Fisher scoring $\eta\leftarrow\eta+S_c/I_c$ reaches the unique maximum-likelihood factor, with $\operatorname{se}(\log\hat s_c)=I_c(\hat\eta)^{-1/2}$. Solving $S_c=0$ gives $\hat s_c=\sum_g w_g y_{gc}/\sum_g w_g q_{gc}$ with $w_g=1/(1+\alpha_g\hat\mu_{gc})$, a variance-weighted ratio estimator. For $\alpha_g\to0$ it is $L_c/\sum_g q_{gc}$, library size relative to the profile; the model-based gain is the down-weighting of high-count genes, where composition shifts concentrate, plus the standard error. Regime: correct NB variance, known profiles, many genes with non-negligible counts, independent genes. The standard error ignores uncertainty in $q$ and $\alpha$ and is too small under misspecification. A cell with $L_c=0$ has $S_c<0$ for every $\eta$, no finite maximum, and is rejected.

**Offset model (sctransform v2).** The v2 flavour fixes the depth slope, so $\log\mu_{gc}=\beta_{g0}+\log U_c$ with $U_c$ the cell's UMI total (the package stores $\log_{10}U_c$ with slope fixed at $\ln 10$). The implied cell scale is $U_c=L_c$, so a scalar derived from the offset is exactly library size; this follows from the equation and is not an empirical finding.

**Analytic residuals.** Lause et al. set $\hat\mu_{gc}=(\sum_{c'}Y_{gc'})L_c/\sum_{g',c'}Y_{g'c'}$ and $r_{gc}=(Y_{gc}-\hat\mu_{gc})/\sqrt{\hat\mu_{gc}+\hat\mu_{gc}^2/\theta}$ [R15]. The residuals are signed and replace the size-factor step. Regime: large $n$, fixed $\theta$, first order.

**Latent library (scVI).** The log library size has a Normal posterior from an encoder and a Normal prior with the per-batch mean and variance of observed log library sizes [R20]. Depth is a nuisance variable fitted jointly with expression: the posterior variance gives a standard error, and composition is corrected only as far as the decoder absorbs it. With the observed-library option (the scvi-tools default) the log total count is used, which is library size.

**Heuristics and models.** Library size and median of ratios are unbiased under composition invariance and cost $O(\mathrm{nnz})$, and pooling tolerates sparsity; they give a scalar with a clear convention and no fitted model, which is why they remain the comparators. A model adds a standard error, a reusable dispersion trend and weights against high-count genes, at the cost of a family that may be misspecified.

**Pitfalls.** Composition bias appears under asymmetric differential expression, and conclusions differ by protocol and dataset size [R7][R8]. Clusters used for pooling must not depend on the normalised output: rank-based clustering in scran is invariant to scaling and avoids the circularity, but its default uses log-expression values because they give finer clusters. The automatic minimum-mean rule filters genes on library-size-adjusted means, so the gene set depends on depth.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Library-size scaling (scanpy `normalize_total`, Seurat `LogNormalize`) | heuristic | $s_c\propto L_c$; scanpy divides counts by $L_c$/`target_sum`, Seurat uses a fixed scale factor (default 1e4) | [R3][R4] |
| scran/scuttle pooled deconvolution | hybrid | sliding library-size windows within clusters; median ratio of pool sums to an average pseudo-cell; one least-squares system for all pools | [R5] |
| DESeq2 median of ratios | heuristic | per-cell median of count over gene geometric mean, over genes with a finite geometric mean; `poscounts` uses positive counts only | [R17][R18] |
| SCnorm | model-based | quantile regression of expression on depth per gene; genes with similar dependence grouped; a second quantile regression estimates scale factors per group | [R19] |
| Dino | model-based | flexible per-gene negative-binomial mixture; normalised values sampled from the posterior of expected expression given depth | [R12] |
| sctransform | model-based | per-gene negative-binomial regression on log UMI count with regularised parameters; Pearson residuals; v2 fixes the depth slope | [R13][R14] |
| Analytic Pearson residuals | model-based | closed-form NB residuals from gene and cell totals at fixed $\theta$ | [R15] |
| scVI latent library size | model-based | log library size latent with an encoder posterior and per-batch Normal prior, or the observed total | [R20] |

Library-size scaling and pooled deconvolution are the heuristic and hybrid standards. The best-practices chapter presents the shifted logarithm on library-size factors, scran pooling and analytic Pearson residuals as the three normalisations in current workflows [R2]. sctransform and analytic residuals are the model-based alternatives; they work on residuals, not on a scalar.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| library_size | `target_sum` | None: median of the non-zero per-cell totals | scanpy src/scanpy/preprocessing/_normalization.py:20-26, 104-105, 117 @8ed52d9 |
| library_size | `exclude_highly_expressed`, `max_fraction` | False, 0.05 (highly expressed: above `max_fraction` of a cell's counts in at least one cell) | scanpy _normalization.py:131-132, 166-179 @8ed52d9 |
| pooled | `sizes` | seq(21, 101, 5), 17 windows | scuttle R/pooledSizeFactors.R:204 @d3476eb |
| pooled | `max.cluster.size` | 3000 | scuttle R/pooledSizeFactors.R:204 (docs :84) @d3476eb |
| pooled | `positive` | TRUE: non-positive estimates warned, then replaced via `cleanSizeFactors` | scuttle R/pooledSizeFactors.R:205, 356-359 @d3476eb |
| pooled | `min.mean` | NULL: median library size at most 50,000 gives 0.1; at least 100,000 gives 1; between gives 0.1 with a warning | scuttle R/pooledSizeFactors.R:292-301 (docs :141-145) @d3476eb |
| pooled | prescaling `scaling` | NULL: the cell's library size | scuttle R/pooledSizeFactors.R:328 @d3476eb |
| pooled | reference cluster | cluster with most non-zero entries in its pseudo-cell | scuttle R/pooledSizeFactors.R:263-265 @d3476eb |
| pooled | solve and output scale | QR least squares; final factors divided by their mean over positive values | scuttle R/pooledSizeFactors.R:351-352, 277-278 @d3476eb |
| pooled | `quickCluster` `min.size`, `method`, `graph.fun`, `use.ranks` | 100, "igraph", "walktrap", FALSE | scran R/quickCluster.R:147-148 (docs :79-80) @569d2f8 |
| median_ratio | `type` | "ratio" (error when every gene has a zero); "poscounts" | DESeq2 R/core.R:538, 544-549, 559 @76c5f85 |
| learned_library | `use_observed_lib_size` | True; if False, per-batch log-library mean and variance form the prior | scvi-tools src/scvi/module/_vae.py:168, 350-358 @5555ecc |
| sctransform v2 | `vst.flavor="v2"` | method glmGamPoi_offset, `n_cells` 2000, `exclude_poisson` TRUE; only the intercept varies | sctransform R/vst.R:140-158; R/fit.R:108-114 @49e35b5 |
| sctransform | `n_genes`, `min_cells`, `theta_estimation_fun` | 2000, 5, "theta.ml" | sctransform R/vst.R:114, 121, 129 @49e35b5 |
| sctransform | `theta_given` (offset method) | 100 | sctransform R/vst.R:183 @49e35b5 |
| analytic residuals | `theta` | 100 | scanpy src/scanpy/experimental/pp/_normalization.py:92-95 @8ed52d9 |

## 5. Proposed singlet approach

**Routes** (licences in section 12). `library_size`: **port** scanpy's `normalize_total` logic. `pooled`: **reimplement** from [R5] and the scuttle values in section 4. `median_ratio`: **reimplement** from the DESeq2 source and [R17], including `poscounts`. `nb_mle`: new design. `learned_library`: **port** the latent-library encoder and per-batch prior from scvi-tools, trained in PyTorch. **Callouts** (benchmark comparators only): Seurat `LogNormalize`, SCnorm, Dino, sctransform and analytic residuals. Not offered: TMM, spike-in scaling (normalization.spike_in_calibration) and a sctransform scalar (equal to library size; residuals belong to normalization.variance_stabilizing_transform).

**Default.** `method` = `pooled`, `scale_convention` = `median_one`, `clusters_key` null (internal clustering), scuttle defaults for every pooled option. Pass `clusters_key` when labels exist that were not built from the normalised output, run `dry_run` first on large datasets, and leave the pooled options at their defaults.

**Model-based formulation (`nb_mle`).** One scalar per cell as the maximum-likelihood factor under $\mathrm{NB}(s_c q_{gc},\alpha_g)$ (section 3). Profiles are cluster means of counts divided by the pooled factors, so cross-cluster scale and composition handling are inherited from `pooled`, which also initialises $\eta$; $s_c$ is expressed in pooled units. Dispersions $\alpha_g$ come from a mean-dispersion trend fitted on the dataset and are written to `models/size_factor_nb`. No published method has this exact form. Falsification (proposed thresholds; `learned_library` faces the same coverage and depth criteria):

- More composition-robust than `pooled`: falsified if on B2 (asymmetric arm) its RMS log error on group B is not lower than that of `pooled`.
- Calibrated standard error: falsified if standard-error coverage on B2 is below 0.90.
- No new depth structure: falsified if its depth association on B1 exceeds 0.2.

**Trained resources.** The B2 generator uses annotated catalogue cells (354M cells, about 40% with author annotations), excluded from any model training; dispersion trends can use all cells.

**Stack and kernels.** PyTorch trains `learned_library` only. Every other method is a small hot model, hard-coded: CPU sparse code for library size and the pooled least-squares system; CUDA with cuSPARSE for pool sums (products with $A$), per-pool medians over genes and the Fisher-scoring reductions. `library_size` and `nb_mle` stream by row chunks; `pooled` streams cluster by cluster, each system capped at `max_cluster_size`; `median_ratio` needs two passes.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse non-negative integer, CSR, cells by genes | raw UMI or read counts (parameter `layer`) |
| read | obs/<clusters_key> | categorical | optional rough cluster labels for pooling and profiles; must not depend on the normalised output |
| read | var/<exclude_mask> | boolean | optional genes excluded from estimation |
| write | obs/size_factor | float64, strictly positive | per-cell factor under `scale_convention` |
| write | obs/size_factor_log_se | float64 | standard error of $\log s_c$ (`nb_mle`, `learned_library`) |
| write | layers/size_factor_scaled | float32 | raw counts divided by `obs/size_factor` |
| write | uns/size_factor | mapping | method, parameters, convention, library versions, model reference |
| write | models/size_factor_nb | per-gene table | dispersion $\alpha_g$ used by `nb_mle` |

What `obs/size_factor` holds, by method:

| `method` | Scalar | Extra writes |
|---|---|---|
| `library_size` | $L_c$ over non-excluded genes, scaled by the convention | none |
| `pooled` | deconvolved pool solution after cluster rescaling; coerced entries are counted in the summary | none |
| `median_ratio` | median ratio against gene geometric means | none |
| `nb_mle` | maximum-likelihood $\hat s_c$ relative to the cluster profile, in pooled units | `obs/size_factor_log_se`, `models/size_factor_nb` |
| `learned_library` | exponential of the posterior mean log library size | `obs/size_factor_log_se` (posterior SD of the log) |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "counts" | — | Count layer to read; must hold raw non-negative counts (cells by genes), not normalized or log-transformed values. |
| `method` | string | "pooled" | `library_size`, `pooled`, `median_ratio`, `nb_mle`, `learned_library` | library_size: total counts; pooled: pooled deconvolution (default); median_ratio: DESeq-style median of ratios; nb_mle: per-cell negative-binomial maximum likelihood (proposed); learned_library: scVI latent library size. |
| `scale_convention` | string | "median_one" | `median_one`, `mean_one`, `geomean_one`, `median_nonzero_total` | Global constant fixing the scale: median factor 1, mean over positive factors 1, mean log factor 0, or scanpy-style median non-zero total. |
| `clusters_key` | string/null | null | — | obs column of rough cluster labels for pooled and nb_mle; must not derive from the normalized output. Null lets pooled cluster internally. |
| `exclude_mask` | string/null | null | — | var column (boolean) of genes excluded from estimation for every method, for example highly expressed genes. Null uses all genes. |
| `pooled` | object | — | — | Options for method pooled and the pooled initialisation of nb_mle; defaults follow scuttle. |
| `pooled.sizes` | array | [21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71, 76, 81, 86, 91, 96, 101] | — | Pool window sizes; each size adds one set of pool equations. The smallest window should be at least 20 for UMI data. |
| `pooled.max_cluster_size` | integer | 3000 | min 1 | Maximum cells per linear system; larger clusters are split before solving. |
| `pooled.min_mean` | number/null | null | min 0 | Minimum library-size-adjusted mean of genes used. Null picks 0.1 or 1 from the median library size. |
| `pooled.positive` | boolean | true | — | Replace non-positive estimates by values predicted from detected-gene counts and warn. When false, they raise an error. |
| `pooled.ref_cluster` | string/null | null | — | Reference cluster for rescaling clusters to one another. Null uses the cluster with the most non-zero pseudo-cell entries. |
| `pooled.prescale_rounds` | integer | 1 | min 1 | Number of pooling rounds; each later round prescales by the previous factors. Round one prescales by library size. |
| `pooled.quickcluster_min_size` | integer | 100 | min 1 | Minimum cluster size for internal clustering when clusters_key is null. |
| `pooled.quickcluster_use_ranks` | boolean | false | — | Cluster on ranks instead of log-expression, which avoids circularity with the normalization being estimated. |
| `median_ratio` | object | — | — | Options for method median_ratio. |
| `median_ratio.type` | string | "ratio" | `ratio`, `poscounts` | ratio uses genes positive in every cell and errors if none exist; poscounts takes geometric means over positive counts. |
| `seed` | integer | 0 | — | Random seed; used only by learned_library training. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing size factor members instead of failing. |
<!-- PARAMS:AUTO:END -->

`pooled` options apply to `method=pooled` and to the pooled initialisation of `nb_mle`; `median_ratio.type` only to `median_ratio`. `clusters_key` serves `pooled` and `nb_mle`; when null, `pooled` clusters internally with `quickcluster_min_size` and `quickcluster_use_ranks`. `exclude_mask` applies to every method, and scanpy's data-driven highly-expressed exclusion can be reproduced by passing a mask. `prescale_rounds` above 1 reruns pooling with the previous factors as prescaling, as the scuttle documentation suggests. `seed` matters only for `learned_library`. Cells with $L_c=0$ raise an error. A repeat call fails unless `overwrite` is true.

## 7. MCP tool

Tool name `singlet_normalization_size_factor_estimation` (definition in `tasks/mcp/singlet_normalization_size_factor_estimation.json`).

```json
{"dataset": "/data/example.singlet", "method": "pooled", "clusters_key": "leiden_coarse", "pooled": {"min_mean": 0.1}}
```

```json
{"dataset": "/data/example.singlet", "status": "completed",
 "wrote": ["obs/size_factor", "layers/size_factor_scaled", "uns/size_factor"],
 "summary": {"method": "pooled", "scale_convention": "median_one", "n_cells": "<int>",
   "size_factor_min": "<float>", "size_factor_median": 1.0, "size_factor_max": "<float>",
   "n_coerced_nonpositive": "<int>", "min_mean_applied": "<float>", "warnings": []},
 "provenance_id": "<string>"}
```

Long-running: yes for large inputs (the runtime may queue a job). Stochastic: only `learned_library`, through `seed`. Dry run: seconds, peak memory in GB and device for the chosen method.

## 8. Benchmarks

**Shared protocol.** All methods receive the same raw counts, gene set and `exclude_mask`. Size-factor metrics use the centred log ratio $d_c=\log\hat s_c-\log t_c-\bar d$, where $t_c$ is the planted depth factor normalised to geometric mean 1 over cells and $\bar d$ the mean of $\log\hat s_c-\log t_c$, so the global constant never enters. Downstream differential expression uses one test for all methods: a per-gene negative-binomial GLM Wald test with offset $\log\hat s_c$ and Benjamini-Hochberg adjustment. Arms are reported separately. Thresholds marked proposed come from singlet, not the literature.

### B1. Pool-and-split mixtures (CellBench)

- **Goal**: whether normalised data keep the known structure of mixture libraries while removing association with library size; the check follows the pool-and-split example of the OSCA book [R21] on the mixture design of Tian et al. [R22].
- **Ground truth**: orthogonal design. Each library carries a mixing-ratio class (the `mix` column), a categorical label with no scale.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellBench `mRNAmix_qc.RData`, object `sce8_qc` (SORT-seq pool-and-split libraries) | https://github.com/LuyiTian/CellBench_data, as loaded in the OSCA book [R21][R22] | RNA-mixture libraries, SORT-seq; species and size — | — | single dataset |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Mixing-ratio accuracy | 5-fold cross-validated 10-nearest-neighbour accuracy predicting the `mix` class from the top 10 principal components of log-normalised highly variable genes; ties broken by the nearest tied neighbour; mean over folds | higher | primary | proposed |
| Depth association | $\max_{k\le10}\lvert\rho_{\text{Spearman}}(\mathrm{PC}_k,\log L_c)\rvert$ | lower | guardrail | [R21] |

- **Comparators**: `library_size`, `pooled`, `median_ratio` (poscounts), `nb_mle`, `learned_library`; callouts sctransform residuals and analytic Pearson residuals with PCA on residuals.
- **Protocol**: normalise (log1p of counts over factors, or residuals), fix the highly variable gene set, compute components, repeat the fold assignment 20 times (proposed). Two further `pooled` arms: automatic `min_mean` against a fixed value, and `quickcluster_use_ranks` false against true. As an internal check, downsample libraries to the first percentile of the size factors as in the OSCA book and confirm depth association falls; this uses the estimated factors and tests consistency, not accuracy.
- **Acceptance criterion**: proposed. The selected method has depth association at most 0.2 and accuracy within 0.02 of the best comparator.
- **Known pitfalls**: mixing class may correlate with depth through the pooling design; one dataset only.

### B2. Planted simulation with composition and differential-expression arms (proposed)

- **Goal**: recover planted depth factors and differential expression under balanced, asymmetric and symmetric perturbations, following the contrast of Vieth et al. [R8].
- **Ground truth**: planted simulation: the depth factor $t_c$ and the set of genes perturbed in group B relative to group A.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| NB counts from catalogue cell-type profiles | generator below; singlet catalogue | simulated; 10,000 cells, 5 seeds (proposed) | catalogue terms | generator not yet implemented |

- **Generator**:
  1. Take $K=10$ annotated catalogue types; $m_{gk}$ is the type mean of library-size-normalised counts at the catalogue median library size.
  2. $\log t_c\sim\mathcal N(0,\sigma^2)$ with $\sigma$ the standard deviation of log library size within one catalogue type.
  3. Split type 1 into groups A and B under one cluster label. Arms: none; asymmetric (5% of genes multiplied by 3 in B); symmetric (2.5% by 3, 2.5% by 1/3 in B). The cluster key is the type label.
  4. $\alpha_g$ from a dispersion-mean trend in catalogue cells; $Y_{gc}\sim\mathrm{NB}(t_c m_{g,k(c)}\phi_{gc},\alpha_g)$ with $\phi$ the perturbation.
  5. Sensitivity arm: zero-inflated counts, so NB-based methods do not share the generator family.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Size-factor log error | $\sqrt{\frac1n\sum_c d_c^2}$ | lower | primary | proposed |
| DE F1 | F1 of perturbed genes against genes called at adjusted $p<0.05$, A versus B | higher | primary | [R8] |
| False-positive rate | fraction of unperturbed genes with nominal $p<0.05$, A versus B | lower | guardrail | [R8] |
| Standard-error coverage | fraction of cells with $\lvert d_c\rvert\le1.96\,\mathrm{se}_c$ | near 0.95 | guardrail | proposed |

- **Comparators**: all methods in section 5 (`median_ratio` as poscounts) and SCnorm.
- **Acceptance criterion**: proposed. No-perturbation arm: log error at most 0.05 for `pooled` and the model-based methods. Asymmetric arm: best log error at most 0.1. Selected method: false-positive rate at most 0.07; coverage at least 0.90 where a standard error is reported.
- **Known pitfalls**: catalogue annotations are not size-factor truth.

### P1. Performance and scaling

Wall time, peak memory and throughput at 10^4, 10^5 and 10^6 cells (10^7 only for a method that claims streaming), CPU and CUDA reported separately, on sparse CSR input with fixed gene set, thread count and memory budget. Comparators: scanpy `normalize_total`, scuttle `pooledSizeFactors` at identical window sizes, DESeq2 `poscounts`. Pooled cost grows with cells times the 17 default windows and each system is capped at 3000 cells. Acceptance criterion, proposed: the singlet pooled path is at least 5 times faster than scuttle at identical inputs, and its factors have Spearman correlation at least 0.99 with scuttle's.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
- **Feeds**:
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
  - `normalization.depth_confounding_diagnostic`: Residual depth-confounding diagnostic
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `markers-de.cell_level_two_group_de`: Cell-level two-group differential expression
- **Reads**: `layers/counts`, `obs/<clusters_key>`, `var/<exclude_mask>`
- **Writes**: `obs/size_factor`, `obs/size_factor_log_se`, `layers/size_factor_scaled`, `uns/size_factor`, `models/size_factor_nb`
<!-- CHAINING:AUTO:END -->

Follows quality control and cell calling and precedes variance stabilisation, feature selection and embedding [R2]. For spatial inputs compare with spatial-preproc.spatial_depth_normalization.

## 10. Risks, pitfalls and open questions

- **Published comparisons are not reproduced.** The datasets, truth definitions and metric formulae of Ge et al., Lytal et al., Vieth et al., scone and pipeComp are known only from abstracts and package descriptions [R7][R8][R9][R10][R11]; no benchmark here replays them. A downstream benchmark on annotated catalogue studies needs a registry of studies and thresholds first.
- **`nb_mle` is a proposal.** No published method has its form; B2 tests it on NB data from the same family, and calibration on real data has no truth.
- **Pooled defaults and gene filters.** The scuttle defaults come from its source and documentation, not from a validation at catalogue scale; the automatic minimum-mean rule makes the gene set depth-dependent.
- **Composition truth exists only in simulation.** No real dataset here has known composition bias; CellBench tests depth structure, not composition.
- **Sources not read.** TMM (edgeR), spike-in scaling, the SCnorm and Dino defaults, the scVI paper and the CellBench dataset size and licence were not read.
- **First experiment.** Run `library_size` and `pooled` on B1 and check the depth-association guardrail; then B2 arm 0 and the asymmetric arm; compare `nb_mle` and `quickcluster_use_ranks` only after those results.

## 11. References

R1. Vallejos CA, Risso D, Scialdone A, Dudoit S, Marioni JC. Normalizing single-cell RNA sequencing data: challenges and opportunities. *Nature Methods* 2017. doi:10.1038/nmeth.4292 — verified (corpus)

R2. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)

R3. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)

R4. Stuart T, Butler A, Hoffman P, Hafemeister C, Papalexi E, Mauck WM, Hao Y, Stoeckius M, Smibert P, Satija R. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)

R5. Lun ATL, Bach K, Marioni JC. Pooling across cells to normalize single-cell RNA sequencing data with many zero counts. *Genome Biology* 2016;17:75. doi:10.1186/s13059-016-0947-7 — verified (repo)

R6. Ahlmann-Eltze C, Huber W. Comparison of transformations for single-cell RNA-seq data. *Nature Methods* 2023. doi:10.1038/s41592-023-01814-1 — verified (corpus)

R7. Ge Q, Sheng Y, Lu J, Yang Y, Pan M. Single-cell RNA-seq data normalization: a benchmarking study. *PLOS ONE* 2025. doi:10.1371/journal.pone.0335102 — verified (search)

R8. Vieth B, Parekh S, Ziegenhain C, Enard W, Hellmann I. A systematic evaluation of single cell RNA-seq analysis pipelines. *Nature Communications* 2019;10:4667. doi:10.1038/s41467-019-12266-7 — verified (search)

R9. Lytal N, Ran D, An L. Normalization methods on single-cell RNA-seq data: an empirical survey. *Frontiers in Genetics* 2020;11:41. doi:10.3389/fgene.2020.00041 — verified (search)

R10. Cole MB, Risso D, et al. Performance assessment and selection of normalization procedures for single-cell RNA-seq. *Cell Systems* 2019. doi:10.1016/j.cels.2019.03.010 — partial (corpus)

R11. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)

R12. Brown J, Ni Z, Mohanty C, Bacher R, Kendziorski C. Normalization by distributional resampling of high throughput single-cell RNA-sequencing data. *Bioinformatics* 2021. doi:10.1093/bioinformatics/btab450 — verified (corpus)

R13. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019;20:296. doi:10.1186/s13059-019-1874-1 — verified (repo)

R14. Choudhary S, Satija R. Comparison and evaluation of statistical error models for scRNA-seq. *Genome Biology* 2022;23:20. doi:10.1186/s13059-021-02584-9 — verified (repo)

R15. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)

R16. Sarkar A, Stephens M. Separating measurement and expression models clarifies confusion in single-cell RNA sequencing analysis. *Nature Genetics* 2021. doi:10.1038/s41588-021-00873-4 — verified (corpus)

R17. Anders S, Huber W. Differential expression analysis for sequence count data. *Genome Biology* 2010;11:106. doi:10.1186/gb-2010-11-10-r106 — verified (repo)

R18. Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. *Genome Biology* 2014. doi:10.1186/s13059-014-0550-8 — verified (corpus)

R19. Bacher R, Chu LF, Leng N, Gasch AP, Thomson JA, Stewart RM, Newton M, Kendziorski C. SCnorm: robust normalization of single-cell RNA-seq data. *Nature Methods* 2017;14(6):584-586. doi:10.1038/nmeth.4263 — verified (repo)

R20. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)

R21. Amezquita R, Lun A, Hicks S, Gottardo R. Orchestrating Single-Cell Analysis with Bioconductor. Bioconductor book, 2022. https://bioconductor.org/books/release/OSCA/ — verified (corpus)

R22. Tian L, Dong X, Freytag S, Lê Cao KA, Su S, JalalAbadi A, Amann-Zalcenstein D, Weber TS, Seidi A, Jabbari JS, Naik SH, Ritchie ME. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | authors listed in pyproject.toml (including Adam Gayoso, Alex Wolf, Ilan Gold, Philipp Angerer; full list in the file) | BSD-3-Clause (LICENSE; pyproject.toml) | `normalize_total`; analytic Pearson residuals | port (`library_size`) |
| https://github.com/LTLA/scuttle | Aaron Lun (aut, cre), Davis McCarthy (aut) | GPL-3 (DESCRIPTION) | pooled size-factor implementation | reimplement (`pooled`) |
| https://github.com/MarioniLab/scran | Aaron Lun (aut, cre), Karsten Bach (aut), Jong Kyoung Kim (ctb), Antonio Scialdone (ctb) | GPL-3 (DESCRIPTION) | `quickCluster`; wrapper over scuttle | reimplement (internal clustering) |
| https://github.com/mikelove/DESeq2 | Michael Love (aut, cre), Simon Anders (aut, ctb), Wolfgang Huber (aut, ctb) and contributors listed in DESCRIPTION | LGPL (>= 3) (DESCRIPTION) | median of ratios | reimplement (`median_ratio`) |
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml) | BSD-3-Clause (LICENSE) | latent library-size encoder and prior | port (`learned_library`) |
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and contributors listed in DESCRIPTION | MIT + file LICENSE (DESCRIPTION) | `LogNormalize` | callout |
| https://github.com/ChristophH/sctransform | Christoph Hafemeister (aut), Saket Choudhary (aut, cre), Rahul Satija (ctb) | GPL-3 (DESCRIPTION: GPL-3 \| file LICENSE; the LICENSE file is the GPL version 3 text) | regularised NB offset model and residuals | callout |
| https://github.com/rhondabacher/SCnorm | Rhonda Bacher (author, maintainer) | GPL (>= 2) (DESCRIPTION) | quantile-regression scale factors | callout |
| https://github.com/JBrownBiostat/Dino | Jared Brown (aut, cre), Christina Kendziorski (ctb) | GPL-3 (DESCRIPTION) | distributional resampling | callout |
