---
id: normalization.variance_stabilizing_transform
title: Variance-stabilizing transform of depth-normalized counts
area: normalization
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [normalization.size_factor_estimation, normalization.dispersion_estimation]
feeds: [feature-selection.highly_variable_gene_selection, dim-reduction.normalized_cell_embedding, normalization.depth_confounding_diagnostic, normalization.normalization_pipeline_selection]
reads: [layers/counts, obs/size_factors, obs/total_counts, obs/batch, var/gene_mean, models/<name>]
writes: [layers/vst_shifted_log, layers/vst_acosh, layers/pearson_residuals, var/vst_overdispersion, var/vst_residual_variance, uns/vst_settings, models/vst_sctransform_v2, models/vst_glmgampoi_pearson]
devices: [cpu, cuda]
mcp_tool: singlet_normalization_variance_stabilizing_transform
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Variance-stabilizing transform of depth-normalized counts

> Transforms raw UMI counts into a cells-by-genes matrix whose variance is approximately independent of expression level, using a shifted logarithm, a closed-form delta-method transform or Pearson residuals from a depth-offset negative binomial model.

## 1. Question

Given raw UMI counts $Y_{gc}$ for genes $g$ and cells $c$ and per-cell size factors $s_c$, which transform gives a real-valued cells-by-genes matrix whose variance no longer depends on expression level, while keeping the neighbourhood and cluster structure that PCA, UMAP and clustering rely on? The output is log-scale values or Pearson residuals, plus fitted per-gene overdispersion for the model-based variants.

The literature judges the answer by four criteria: variance calibration under a known count model, neighbourhood preservation against a reference, marker-supported gene selection, and false-positive control in differential expression. None is accepted as ground truth, so each benchmark in section 8 fixes one.

## 2. Why this task matters and where the field stands

Raw UMI counts have a variance that grows with the mean, so PCA on counts is dominated by highly expressed genes, and the transform applied after size-factor normalization decides which genes and neighbours enter every later step. The shifted logarithm $\log(Y/s+1)$ is the practical default: scanpy scales each cell to the median of the non-zero cell totals before log1p, Seurat to 10,000 counts.

The field is **contested**. Ahlmann-Eltze and Huber compared transformations from four families (delta method, model residuals, inferred latent expression, factor analysis) on simulated and real data and report that the logarithm with a pseudo-count followed by PCA performs as well as or better than the more sophisticated alternatives [R1]. The best-practices chapter on normalization describes analytic Pearson residuals [R3] as well suited to selecting biologically variable genes and rare cell types, and notes that a benchmark against a range of downstream tasks is still outstanding [R13]. Choudhary and Satija analysed 59 scRNA-seq datasets and report that a negative binomial model is needed for genes with sufficient depth and that overdispersion varies widely between datasets [R4]. An independent pipeline comparison found that sctransform removed sampling effects while preserving cell heterogeneity [R11][R13]; [R6] reviews the problem.

Open problems:

- No transform is best on every criterion [R1][R3][R13].
- Pseudo-count 1 matches the large-mean limit of the delta-method transform only at large overdispersion; the preprint of [R1] gives $1/(4\alpha)$, the first-order derivation in section 3 gives $1/(2\alpha)$.
- Overdispersion is fixed, shared or per gene, with defaults that differ between tools (section 4), so residuals are not comparable across them.
- Depth regression can remove depth-correlated biology (section 10).

Also: log(x+1) distorts lowly expressed genes [R5], and log-transforming scaled counts can introduce systematic errors [R9] that downsampling remedies at a cost in efficiency [R10].

## 3. Theory and insight

Notation: $Y_{gc}$ count, $s_c$ size factor, $u_c$ total UMI of cell $c$, $x_{gc}=Y_{gc}/s_c$ normalised count, $\mu_{gc}=s_cq_g$ expected count with gene rate $q_g$, $\alpha_g=1/\theta_g$ NB2 overdispersion ($\alpha=0$ is Poisson), $y_0$ pseudo-count, $\kappa$ clipping bound, $\psi_1$ trigamma function. The parameterisations are not interchangeable: $\theta=100$ is $\alpha=0.01$, and $\alpha=0.05$ is $\theta=20$.

**Count model.** $Y_{gc}\mid\lambda_{gc}\sim\mathrm{Poisson}(\lambda_{gc})$ with gamma-distributed $\lambda_{gc}$ of mean $\mu_{gc}=s_cq_g$ and variance $\alpha_g\mu_{gc}^2$, so $\operatorname{Var}[Y_{gc}]=\mu_{gc}+\alpha_g\mu_{gc}^2$. The assumptions are independent cells, depth as the only cell-level technical factor and constant $\alpha_g$ within a gene [R2][R3]. Unmodelled cell-type structure in $q_g$ appears as extra overdispersion, and zero inflation violates the model. [R12] argues for separating measurement and expression models; the single NB term used here combines both.

**Delta method.** To first order $\operatorname{Var}[h(Y)]\approx h'(\mu)^2\operatorname{Var}[Y]$ [R7]. Unit variance requires $h'(\mu)=(\mu+\alpha\mu^2)^{-1/2}$, so with $h(0)=0$

$$
h(\mu)=\frac{2}{\sqrt\alpha}\operatorname{arsinh}\sqrt{\alpha\mu}=\frac{1}{\sqrt\alpha}\operatorname{arcosh}(1+2\alpha\mu).
$$

Zeros stay zero for every $\alpha>0$, and $h\to2\sqrt\mu$ as $\alpha\to0$, so the Poisson square root needs no separate method. Regime: $h$ nearly linear over the spread of $Y$, that is $\alpha\mu\gg1$. Unit variance also holds only to first order in $\alpha$: as $\mu\to\infty$, $Y/\mu$ tends to a gamma law of shape $1/\alpha$, so $\operatorname{Var}[h(Y)]\to L(\alpha)=\psi_1(1/\alpha)/\alpha=1+\alpha/2+O(\alpha^2)$, which is 1.005, 1.025 and 1.107 for $\alpha=0.01,0.05,0.2$. For $s_c\neq1$ the variance of $x$ is $q/s+\alpha q^2$ rather than the $q+\alpha q^2$ that $h$ assumes (with $q=\mathbb{E}x$), so the transformed variance is off by the factor $(1/s+\alpha q)/(1+\alpha q)$, which tends to 1 only for $\alpha q\gg1$.

**Shifted logarithm as the large-mean limit.** Since $\operatorname{arcosh}(1+2z)=\log(4z+2)+O(z^{-2})$,

$$
h(\mu)=\alpha^{-1/2}\Big[\log\big(\mu+\tfrac{1}{2\alpha}\big)+\log 4\alpha\Big]+O\big(\alpha^{-1/2}(\alpha\mu)^{-2}\big),
$$

so $\alpha^{-1/2}\log(Y+y_0)$ with $y_0=1/(2\alpha)$ is the large-mean asymptote of $h$. Its first-order variance is $1+(1-2\alpha y_0)/(\alpha\mu)+O((\alpha\mu)^{-2})$: $y_0=1/(2\alpha)$ removes the leading excess, $y_0=1/(4\alpha)$ (transformGamPoi) leaves $1/(2\alpha\mu)$, and $y_0=1$ leaves $(1/\alpha-2)/\mu$, which is large for small $\alpha$. Exact summation over the NB probability mass function at unit size factor gives the variances below.

| $\alpha$ | $\alpha\mu$ | $L(\alpha)$ | acosh | $y_0=\tfrac{1}{2\alpha}$ | $y_0=\tfrac{1}{4\alpha}$ | $y_0=1$ |
|---|---|---|---|---|---|---|
| 0.05 | 10 | 1.0254 | 1.0256 | 1.0228 | 1.0776 | 1.1248 |
| 0.05 | 100 | 1.0254 | 1.0254 | 1.0254 | 1.0309 | 1.0354 |
| 0.2 | 10 | 1.1066 | 1.1088 | 1.1018 | 1.1808 | 1.1980 |

**Zero preservation.** A constant added to every output changes no variance and no PCA, so $\log(x+y_0)$ can be written $\log(1+x/y_0)$, which maps zero to zero for every $y_0$; the pseudo-count then rescales the size factors by $y_0$. transformGamPoi's $\alpha^{-1/2}\log(1+4\alpha x)$ is this form with $y_0=1/(4\alpha)$. singlet writes every shifted logarithm in this form, so all three log-scale outputs are sparse.

**Analytic Pearson residuals.** Lause, Berens and Kobak use an intercept-only gene model with a cell-size offset and a shared $\theta$ [R3]:

$$
\hat\mu_{gc}=\frac{\big(\sum_{g'}Y_{g'c}\big)\big(\sum_{c'}Y_{gc'}\big)}{\sum_{g'c'}Y_{g'c'}},\qquad
r_{gc}=\frac{Y_{gc}-\hat\mu_{gc}}{\sqrt{\hat\mu_{gc}+\hat\mu_{gc}^2/\theta}},
$$

clipped at $\pm\kappa$ with $\kappa=\sqrt n$. $\hat\mu$ is the exact Poisson maximum-likelihood fit of the rank-one independence model and does not depend on $\theta$; using it in the NB residual is an approximation. If the NB model, a shared $\alpha=1/\theta$ and $\hat\mu\approx\mu$ hold (large $n$, no zero inflation), $\mathbb{E}[r]\approx0$ and $\operatorname{Var}[r]\approx1$, the calibration target of B3. Clipping makes the values depend on the number of cells.

**Per-gene models.** sctransform regresses each gene's counts on log depth: a Poisson fit gives the mean, $\theta_g$ is estimated by maximum likelihood, and the parameters are regularised across genes by kernel regression on gene mean [R2]. Version 2 fixes the slope (offset $\log u_c$), estimates $\theta$ with glmGamPoi and excludes Poisson-like genes from regularisation [R4]. Residuals are clipped at $\pm\sqrt n$, and the fit uses a gene subset and a cell subsample. glmGamPoi fits per-gene gamma-Poisson GLMs with a size-factor offset and shrinks dispersions towards a median trend over expression [R8]. Regime: the mean model is correct up to depth.

**Heuristic and model.** The logarithm compresses large counts, keeps zeros at zero and costs one pass over the non-zeros; variance calibration is one criterion among several and does not by itself predict neighbourhood preservation [R1]. A model adds calibrated uncertainty on $\alpha_g$, a prior shared across genes, covariates through offsets and regression terms, and testable calibration (B3, B4). Whether this helps downstream is empirical, so shifted_log stays the comparator.

**Failure modes and pitfalls.**

- Shifted logarithm: an unmatched pseudo-count inflates the variance at low and moderate means; depth enters only through the size factor.
- acosh: first order and poor for $\alpha\mu\lesssim1$; an error in $\alpha$ rescales the whole gene.
- Analytic residuals: $\theta=100$ underestimates the variance of genes with $\alpha>0.01$ and inflates their residual variance (B3); clipping truncates large counts; output is dense.
- Per-gene residuals: the depth regressor can absorb depth-correlated biology; low-count genes are unstable; results depend on the subsample. Any residual transform shows zero inflation or other misspecification as residual variance different from one.
- Benchmarks: the reference neighbourhood drives the ranking, which also changes with the number of components and with $k$ [R1]; $\alpha=0$ favours square-root behaviour; gene-wise $\alpha$ estimated on the evaluation cells is an oracle; target sums and $\theta$ differ between tools, so values are not comparable across them.

**Estimands.** `layers/vst_*` hold natural-log values of $x$ (shifted_log), values on the unit-variance scale of $h$ (acosh, shifted_log_overdispersion) or dimensionless clipped Pearson residuals. `var/vst_overdispersion` holds the $\alpha_g$ used (a fixed value is broadcast). `var/vst_residual_variance` is the sample variance over cells of each gene's residuals, 1 under calibration. In B3 and B4 the truth is the planted $\alpha$ and $\mu$, normalised by $L(\alpha)$ in B4. Cost: closed forms $O(\mathrm{nnz})$; analytic residuals $O(ng)$ time and $4ng$ bytes in float32.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Shifted logarithm, median target sum (scanpy `normalize_total`, `log1p`) | heuristic | scale each cell to the median of the non-zero cell totals, then $\log(x+1)$ | [R1][R13] |
| Shifted logarithm, counts per 10,000 (Seurat `LogNormalize`) | heuristic | scale each cell to 10,000 counts, then $\log(x+1)$ | — |
| Delta-method acosh (transformGamPoi `acosh_transform`) | model-based | $\alpha^{-1/2}\operatorname{arcosh}(1+2\alpha x)$ on size-factor-normalised counts; $\alpha$ fixed or from a glmGamPoi fit shrunk to the trend | [R1] |
| Shifted logarithm with overdispersion pseudo-count (transformGamPoi `shifted_log_transform`) | hybrid | $\alpha^{-1/2}\log(1+4\alpha x)$, pseudo-count $1/(4\alpha)$ | [R1] |
| sctransform v1 and v2 | model-based | per-gene NB regression on log depth, parameters regularised across genes by kernel regression on gene mean; v2 uses the offset model and excludes Poisson-like genes from regularisation | [R2][R4] |
| Analytic Pearson residuals | model-based | closed-form intercept-only NB residuals with a cell-size offset, shared $\theta$, clipping at $\sqrt n$ | [R3] |
| glmGamPoi Pearson residuals | model-based | per-gene gamma-Poisson GLM with size-factor offset and dispersions shrunk to a trend; Pearson residual $(y-\mu)/\sqrt{\mu+\alpha\mu^2}$ | [R8] |

The shifted logarithm is the default of scanpy and Seurat, the comparator in every benchmark of section 8, and competitive on the criteria of [R1]. Analytic and per-gene Pearson residuals are the model-based alternatives reported as useful for gene selection and rare populations [R3][R13]. The acosh transform is the closed-form model-based baseline. The proposed default stays shifted_log until B1 to B4 support a change.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| scanpy `normalize_total` | `target_sum` | None, meaning the median of the non-zero cell totals | src/scanpy/preprocessing/_normalization.py:130, 20-26, 104-105 @ 8ed52d9 |
| scanpy `normalize_total` | `exclude_highly_expressed`, `max_fraction` | False, 0.05 | src/scanpy/preprocessing/_normalization.py:131-132 @ 8ed52d9 |
| scanpy `log1p` | `base` | None (natural logarithm) | src/scanpy/preprocessing/_simple.py:311-314 @ 8ed52d9 |
| scanpy `normalize_pearson_residuals` | `theta`, `clip`, `check_values` | 100; None, meaning $\sqrt{n_{\mathrm{obs}}}$; True | src/scanpy/experimental/pp/_normalization.py:95-97, 54-56 @ 8ed52d9 |
| rapids-singlecell `normalize_pearson_residuals` | `theta`, `clip` | 100; None, meaning $\sqrt{n_{\mathrm{obs}}}$ | src/rapids_singlecell/preprocessing/_normalize.py:524-526 @ e110792 |
| Seurat `LogNormalize` | `scale.factor` | 1e4 | R/generics.R:381 @ 5f67c70 |
| umi-normalization `pearson_residuals` | `clipping` | True, clip at $\sqrt{N}$; $\hat\mu$ from row and column sums | tools.py:174-190 @ 696086c |
| transformGamPoi `acosh_transform` | `overdispersion`, `size_factors` | 0.05; TRUE | R/delta_method_transform.R:54-55 @ 10bcccd |
| transformGamPoi `shifted_log_transform` | `overdispersion`, `pseudo_count`, `minimum_overdispersion` | 0.05; $1/(4\cdot$`overdispersion`$)$; 0.001 | R/delta_method_transform.R:134-137 @ 10bcccd |
| transformGamPoi `residual_transform` | `residual_type`, `clipping`, `overdispersion` | first of ("randomized_quantile", "pearson", "analytic_pearson"); FALSE (TRUE means $\sqrt{\text{ncol}}$, line 39); 0.05 | R/residual_transform.R:102-104 @ 10bcccd |
| sctransform `vst` | `n_genes`, `n_cells`, `method` | 2000; NULL (2000 for `vst.flavor="v2"`); "poisson" ("glmGamPoi_offset" for v2) | R/vst.R:114-116, 145, 158 @ 49e35b5 |
| sctransform `vst` | `theta_regularization`, `res_clip_range`, `bin_size`, `min_cells` | "od_factor"; $\pm\sqrt{\text{ncol(umi)}}$; 500; 5 | R/vst.R:118-121 @ 49e35b5 |
| sctransform `vst` | `residual_type`, `theta_estimation_fun`, `exclude_poisson`, `use_geometric_mean` | "pearson"; "theta.ml"; FALSE (TRUE for v2, line 156); TRUE | R/vst.R:122, 129, 131-132 @ 49e35b5 |
| glmGamPoi `glm_gp` | `size_factors`, `overdispersion`, `overdispersion_shrinkage` | "normed_sum"; TRUE; TRUE | R/glm_gp.R:223-225 @ 95cffb7 |

## 5. Proposed singlet approach

- **Routes.** `shifted_log`: port from scanpy, with GPU kernels from rapids-singlecell (the Seurat rule is `shifted_log.target_sum=1e4`). `analytic_pearson`: port from scanpy and rapids-singlecell. `acosh`, `shifted_log_overdispersion`: reimplement from section 3. `sctransform_v2`: reimplement from the published description and the `vst` source. `glmgampoi_pearson`: port the IRLS and dispersion kernels. umi-normalization, transformGamPoi and sctransform are validation callouts. The latent-expression and factor-analysis families of [R1], proportional-fitting pipelines and OSCA downsampling are not implemented.
- **Model-based formulation.** Empirical-Bayes $\alpha_g$ with a smooth mean-dispersion trend fitted on a catalogue sample stratified by technology and tissue; the trend is the prior for small datasets (`overdispersion: models/<name>`). It is falsified if (i) the B3 deviation exceeds its tolerance when $\theta=1/\alpha$; (ii) acosh with prior-derived $\alpha_g$ has a B1 kNN overlap or label purity at $k=50$ more than 0.01 below shifted_log on any dataset row; (iii) the $1/(4\alpha)$ rule is not worse than $1/(2\alpha)$ at $\alpha\mu=10$ in B4; (iv) an amortised overdispersion predictor does not beat per-gene empirical Bayes in held-out negative log-likelihood.
- **Trained resources and ML stack.** The trend and the optional amortised predictor are batched NB likelihoods of moderate size, trained in PyTorch. Annotated catalogue cells (about 40% of 354M) serve evaluation only. The closed forms and the two-coefficient IRLS are hard-coded in CUDA with cuSPARSE segmented reductions.
- **Kernels.** (1) row, column and total sums over CSR; (2) elementwise log1p and arcosh on stored non-zeros; (3) a block-wise residual writer from marginal sums; (4) per-gene two-coefficient IRLS; (5) one-pass per-gene residual mean and variance. CUDA IRLS falls back to CPU until it matches the CPU reference within the registry tolerance.
- **Streaming.** Closed forms need only each cell's size factor and stream over cell blocks. Analytic residuals stream in two passes (marginals, then residual blocks). sctransform_v2 and glmgampoi_pearson fit on a subsample and apply block-wise. At full catalogue scale only the sparse methods run; residuals use a gene subset.
- **Defaults.** Use `shifted_log` with default arguments and do not switch without a stated reason. Do not estimate overdispersion on cells used for evaluation, and never choose a transform by agreement with labels that will score it.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int (CSR) | raw UMI integers, never modified |
| read | obs/size_factors | float32 per cell | $s_c$; derived from totals when absent |
| read | obs/total_counts | float32 per cell | $u_c$; source of `log_umi` |
| read | obs/batch | categorical per cell | batch covariate named by `sctransform_v2.batch_var` |
| read | var/gene_mean | float32 per gene | gene means seeding the overdispersion trend for `overdispersion: estimate` |
| read | models/<name> | model | per-gene overdispersion prior named by `overdispersion` |
| write | layers/vst_shifted_log | float32, sparse | $\log(1+x/y_0)$ or $\alpha_g^{-1/2}\log(1+x/y_{0,g})$ |
| write | layers/vst_acosh | float32, sparse | $\alpha_g^{-1/2}\operatorname{arcosh}(1+2\alpha_g x)$ |
| write | layers/pearson_residuals | float32, dense (cells by selected genes) | clipped Pearson residuals of the three residual methods |
| write | var/vst_overdispersion | float32 per gene | $\alpha_g$ used by every method that has one |
| write | var/vst_residual_variance | float32 per gene | sample variance over cells of the residuals (residual methods) |
| write | uns/vst_settings | dictionary | method, effective and ignored parameters, size-factor source, library versions |
| write | models/vst_sctransform_v2 | model | per-gene coefficients and $\hat\theta_g$ |
| write | models/vst_glmgampoi_pearson | model | per-gene coefficients and dispersions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "shifted_log" | `shifted_log`, `shifted_log_overdispersion`, `acosh`, `analytic_pearson`, `sctransform_v2`, `glmgampoi_pearson` | Transform: shifted_log (default), shifted_log_overdispersion, acosh, or Pearson residuals via analytic_pearson, sctransform_v2 or glmgampoi_pearson. Outputs differ by method. |
| `overdispersion` | any | 0.05 | — | Overdispersion alpha for acosh, shifted_log_overdispersion and glmgampoi_pearson: a fixed value (0 gives Poisson), 'estimate' (per gene, shrunk), or a models/<name> prior. |
| `gene_subset` | array/null | null | — | Genes to write, by name. Null writes all genes for sparse outputs and genes detected in at least min_cells cells for residual methods. |
| `shifted_log` | object | — | — | Options for shifted_log and shifted_log_overdispersion. |
| `shifted_log.target_sum` | number/null | null | > 0 | Per-cell total that counts are scaled to when obs/size_factors is absent. Null uses the median of non-zero cell totals. |
| `shifted_log.pseudo_count` | number | 1 | > 0 | Pseudo-count y0 of shifted_log, written as log(1 + x/y0) so that zeros stay zero. Ignored by shifted_log_overdispersion. |
| `shifted_log.divisor` | integer | 4 | `2`, `4` | shifted_log_overdispersion only: pseudo-count is 1/(divisor*alpha). 4 reproduces transformGamPoi; 2 is the first-order asymptote of acosh. |
| `analytic_pearson` | object | — | — | Options for analytic_pearson. |
| `analytic_pearson.theta` | number | 100 | > 0 | Shared negative binomial size, so that alpha = 1/theta. |
| `analytic_pearson.clip` | number/null | null | > 0 | Symmetric clipping bound for residuals. Null means the square root of the number of cells. |
| `analytic_pearson.min_cells` | integer | 5 | min 1 | Genes detected in fewer cells than this are dropped from the residual output. |
| `sctransform_v2` | object | — | — | Options for sctransform_v2. |
| `sctransform_v2.n_genes` | integer | 2000 | min 1 | Genes used to fit and regularise the per-gene parameters. |
| `sctransform_v2.n_cells` | integer | 2000 | min 1 | Cells subsampled (see seed) to fit the per-gene parameters. |
| `sctransform_v2.latent_var` | array | ["log_umi"] | — | Obs columns used as depth covariates; log_umi is log10 of obs/total_counts, computed when absent. |
| `sctransform_v2.batch_var` | string/null | null | — | Obs column used as batch covariate. Null means no batch term. |
| `sctransform_v2.clip` | number/null | null | > 0 | Symmetric clipping bound for residuals. Null means the square root of the number of cells. |
| `sctransform_v2.min_cells` | integer | 5 | min 1 | Genes detected in fewer cells than this are dropped from the residual output. |
| `glmgampoi_pearson` | object | — | — | Options for glmgampoi_pearson. |
| `glmgampoi_pearson.clip` | number/null | null | > 0 | Symmetric clipping bound for residuals. Null means the square root of the number of cells. |
| `glmgampoi_pearson.min_cells` | integer | 5 | min 1 | Genes detected in fewer cells than this are dropped from the residual output. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto selects CUDA only for methods whose CUDA output matches the CPU reference within the registry tolerance. |
| `seed` | integer | 0 | min 0 | Random seed for the cell subsample of sctransform_v2; other methods are deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory, device and output size without writing. |
| `overwrite` | boolean | false | — | Replace the output members this tool writes; never replaces the counts layer. |
<!-- PARAMS:AUTO:END -->

Size factors are `obs/size_factors` rescaled to mean 1 when present; otherwise $s_c=u_c/T$ with $T$ the `shifted_log.target_sum` (log methods) or the mean total (acosh). `analytic_pearson` takes depth from the row totals, `sctransform_v2` from `latent_var` and `glmgampoi_pearson` from the size factors. Options of other methods are ignored and listed under `ignored_parameters`. Residual outputs are dense, so set `gene_subset` at large $n$; the dry run reports the size. `overdispersion: estimate` fits per-gene $\alpha_g$ shrunk to the mean-dispersion trend, and a `models/<name>` prior replaces the fit. `seed` affects only the `sctransform_v2` subsample.

## 7. MCP tool

Tool name `singlet_normalization_variance_stabilizing_transform` (definition in `tasks/mcp/singlet_normalization_variance_stabilizing_transform.json`).

```json
{"dataset": "/data/pbmc.singlet", "method": "acosh", "overdispersion": 0.05, "device": "auto"}
```

```json
{
  "dataset": "/data/pbmc.singlet", "status": "completed",
  "wrote": ["layers/vst_acosh", "var/vst_overdispersion", "uns/vst_settings"],
  "summary": {"method": "acosh", "overdispersion_mode": "fixed", "overdispersion_value": 0.05,
    "n_cells": "<int>", "n_genes_out": "<int>", "zero_mapped_to_zero": true,
    "size_factor_source": "obs/size_factors", "ignored_parameters": [], "device_used": "cuda"},
  "provenance_id": "<id>", "job_id": null, "estimate": null
}
```

- **Long-running**: yes when the output exceeds the runtime's inline limit; status `queued` returns a `job_id`.
- **Stochastic**: only `sctransform_v2` (cell subsample, controlled by `seed`).
- **Dry-run estimate**: `seconds`, `peak_memory_gb`, `device` and, for dense output, `output_bytes` (4 bytes per float32 element).

## 8. Benchmarks

**Shared protocol.** Size factors as in section 6; genes detected in at least 5 cells; PCA by truncated SVD with 50 components unless varied; neighbours by exact Euclidean search with ties broken by cell index; clusters by Leiden on the kNN graph at one resolution fixed in the registry for all transforms. Seed 0, hardware recorded, each dataset row reported before any mean. Thresholds without a citation are singlet proposals. **Annotated strata (A)** are tissue-by-technology strata of the singlet catalogue with one level of author labels, at least five cell types of at least 100 cells and at least three donors; strata and licences are listed in the registry.

**Generators.**

- **G1 (planted NB counts).** (i) Draw $s_c$ log-normal (parameters in registry). (ii) Draw $q_g$ gamma-distributed (registry) and rescale so the means cover the range needed. (iii) Draw $Y_{gc}$ negative binomial with mean $s_cq_g$ and variance $\mu+\alpha\mu^2$ for $\alpha\in\{0.01,0.05,0.2\}$. (iv) Registry fixes $n$, $g$ and seeds. B3 uses $n=10^5$ cells. B4 sets $s_c=1$, places genes on the grid $\alpha q\in\{10,30,100,300,10^3,10^4\}$ and draws $R=10^6$ cells per grid point.
- **G3 (planted structure).** (i) Draw $K$ cluster centres and cell latent vectors $z_c\in\mathbb{R}^5$ around them. (ii) Set $q_{gc}=\exp(a_g+b_g^\top z_c)$ with gamma-derived baselines $a_g$ and normal loadings $b_g$ (scales in registry). (iii) Draw counts as in G1(iii) with $\mu_{gc}=s_cq_{gc}$. The reference neighbours of cell $c$ are its $k$ nearest cells in the noise-free profile $\log q_{\cdot c}$.

### B1. Neighbourhood preservation and cluster agreement after PCA

- **Goal**: rank transforms by how well PCA preserves reference neighbourhoods and clusters; [R1] is the published comparison on simulated and real data.
- **Ground truth**: planted simulation (reference neighbours and clusters from G3) and expert labels (author annotations in A); fixed neighbour-set size $k$ keeps overlaps in $[0,1]$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G3 at $\alpha\in\{0.01,0.05,0.2\}$ | singlet generator | simulated UMI counts; $n$, $g$, $K$ in registry | not applicable (generated) | planted truth |
| Annotated strata (A) | singlet catalogue | UMI, tissues and technologies in registry | per source dataset, in registry | author labels |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| kNN overlap, $k\in\{10,50,100\}$ (G3) | $\frac1n\sum_i\lvert N^{\mathrm{ref}}_k(i)\cap N^{T}_k(i)\rvert/k$, $N^{T}_k(i)$ the $k$ nearest cells of $i$ in the first $d\in\{10,50\}$ principal components | higher is better | primary | — |
| kNN label purity, $k=50$ (A) | $\frac1n\sum_i\lvert\{j\in N^{T}_{50}(i):\ell_j=\ell_i\}\rvert/50$ for author labels $\ell$ | higher is better | primary | — |
| ARI | adjusted Rand index of Leiden clusters against planted clusters (G3) or author labels (A); 0 for chance, negatives reported | higher is better | primary | — |

- **Comparators**: shifted_log (median and 10,000 target sums); acosh at $\alpha=0$, 0.05 and `estimate`; shifted_log_overdispersion (divisors 4, 2); the three residual methods.
- **Protocol**: all filtered genes, and the 2,000 most variable genes under each transform's own criterion (residual variance, or scanpy `highly_variable_genes` for log methods).
- **Acceptance criterion**: a singlet transform is non-inferior if its kNN overlap at $k=50$ (G3) and label purity (A) are each at most 0.01 below shifted_log on every dataset row and its wall time is at most twice that of shifted_log. The competitiveness of shifted_log reported in [R1] is supported if no comparator beats it by more than 0.02 in mean kNN overlap at $k=50$ over the G3 rows (proposed).
- **Known pitfalls**: G3 rewards its own log-linear structure and author labels reward annotator clustering; report both.

### B2. Marker precision of selected genes on annotated strata

- **Goal**: test whether residual-based variability rankings select more marker genes than the shifted logarithm and keep PCA structure on the selected genes.
- **Ground truth**: orthogonal measurement. For each stratum the marker set $M$ is the genes with Benjamini-Hochberg adjusted $p<0.01$ and log2 fold change above 1 for at least one author-labelled type, in a catalogue study of the same tissue and technology that is disjoint from the evaluated study (Wilcoxon rank-sum on shifted_log values).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Annotated strata (A) with a disjoint marker study | singlet catalogue | UMI; pairs of studies per stratum, sizes in registry | per source dataset, recorded in registry | marker study never used for evaluation cells |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Marker precision at $N\in\{500,2000\}$ | $\lvert T_N\cap M\rvert/N$ for the top $N$ genes $T_N$ ranked by `var/vst_residual_variance` (residual methods) or by scanpy `highly_variable_genes` on shifted_log values; bounded by $\lvert M\rvert/N$ | higher is better | primary | — |
| Marker recall at $N$ | $\lvert T_N\cap M\rvert/\lvert M\rvert$ | higher is better | guardrail | — |
| kNN label purity at $k=50$ | as in B1, on the $N$ selected genes | higher is better | guardrail | — |

- **Comparators**: shifted_log with scanpy `highly_variable_genes`; analytic_pearson, sctransform_v2 and glmgampoi_pearson ranked by residual variance.
- **Protocol**: rank genes per transform, take the top $N$, compute precision, recall and purity; markers are fixed before evaluation.
- **Acceptance criterion**: a residual method is accepted for gene selection if its precision at $N=2000$ is at least the shifted_log value minus 0.02 on every stratum (proposed).
- **Known pitfalls**: deriving $M$ from shifted_log values favours the shifted logarithm; rankings change with $N$ and with $\kappa$.

### B3. Residual variance calibration on planted NB simulations (proposed)

- **Goal**: check that Pearson residuals have variance one when the NB model is correct, and measure the response to misspecified overdispersion.
- **Ground truth**: planted $\alpha$ and $\mu_{gc}$ from G1. The estimand is $\operatorname{Var}_c(r_{gc})$, equal to 1 under a correct model.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G1 at $\alpha\in\{0.01,0.05,0.2\}$, $n=10^5$ | singlet generator | simulated UMI counts; $g$ in registry | not applicable (generated) | no zero inflation |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Mean absolute deviation of residual variance | over genes $G$ with mean count at least 0.1, the mean of $\lvert\operatorname{Var}_c(r_{gc})-1\rvert$ ($\operatorname{Var}_c$ the sample variance over cells), by mean-count stratum and $\alpha$ | lower is better | primary | — |
| Fraction of miscalibrated genes | $\lvert\{g\in G:\lvert\operatorname{Var}_c(r_{gc})-1\rvert>0.2\}\rvert/\lvert G\rvert$ | lower is better | guardrail | — |

- **Comparators**: analytic_pearson at $\theta=100$, at $\theta=1/\alpha$ (oracle) and at $\theta$ off by a factor 2 either way; sctransform_v2; glmgampoi_pearson with estimated overdispersion.
- **Protocol**: report with clipping off and at the default $\sqrt n$. With assumed $\alpha'$ in place of $\alpha$ and large $n$, the expected residual variance is $(\mu+\alpha\mu^2)/(\mu+\alpha'\mu^2)$.
- **Acceptance criterion**: mean absolute deviation at most 0.05 for analytic_pearson at $\theta=1/\alpha$ with clipping off (proposed). The sampling error of a residual variance is about $\sqrt{(2+1/m)/n}\approx0.011$ for a Poisson-like gene of mean $m=0.1$ at $n=10^5$. Mismatch results are reported without a threshold.
- **Known pitfalls**: fitting with the true $\alpha$ is an oracle, so mismatched results must be reported; clipping at $\sqrt n$ truncates the variance of high-count genes.

### B4. Pseudo-count rules against the delta-method limit on planted NB simulations (proposed)

- **Goal**: test the $1/(2\alpha)$ rule against the $1/(4\alpha)$ rule and the pseudo-count 1 for variance stabilization at large mean.
- **Ground truth**: planted $\alpha$ and $\mu$ from G1 with $s_c=1$. The target is $L(\alpha)=\psi_1(1/\alpha)/\alpha$, the limit of the transformed variance as $\mu\to\infty$ (section 3).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G1 grid $\alpha\mu\in\{10,30,100,300,10^3,10^4\}$ at $\alpha\in\{0.01,0.05,0.2\}$ | singlet generator | simulated UMI counts; $R=10^6$ draws per grid point | not applicable (generated) | variance estimated at fixed $\mu$ |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Relative variance deviation | $\lvert V_h(\mu)/L(\alpha)-1\rvert$ with $V_h$ the sample variance over the $R$ draws of the output on the scale of $h$ (shifted logarithms multiplied by $\alpha^{-1/2}$ with the planted $\alpha$), per grid point | lower is better | primary | — |

- **Comparators**: shifted_log_overdispersion with divisor 2 and 4, shifted_log with pseudo-count 1, and acosh. Expected values at $\alpha\mu=10$ are in the table of section 3.
- **Protocol**: report the metric per $\alpha$ and per $\alpha\mu$ stratum with the non-zero fraction; the sampling error of $V_h$ is about $\sqrt{2/R}\approx0.0014$.
- **Acceptance criterion**: acosh and the divisor-2 rule have deviation at most 0.01 at every $\alpha\mu\ge10$ (predicted at most 0.005); the divisor-4 rule has deviation at least 0.03 at $\alpha\mu=10$ (predicted 0.05 to 0.07). If the divisor-4 deviation is below 0.02, the first-order matching claim is refuted. The divisor-2 rule becomes the `shifted_log_overdispersion` default only if both hold (proposed).
- **Known pitfalls**: the matching is first order in $1/(\alpha\mu)$ and weights high-mean points little; the result is stated per stratum, not as one mean.

### P1. Performance and scaling (proposed)

- **Goal**: wall time, peak memory, throughput and output size of each method at 10k, 100k, 1M and 10M cells on CPU and CUDA.
- **Protocol**: hold fixed the gene count, float32, CSR input, thread count and seed; report non-zero fraction before and after, with CPU and CUDA separate. Comparators: scanpy `normalize_total` plus `log1p`, rapids-singlecell `normalize_total`, `log1p` and `normalize_pearson_residuals`, transformGamPoi `acosh_transform` and `shifted_log_transform`, sctransform `vst` with `vst.flavor="v2"`, scanpy `normalize_pearson_residuals`.
- **Metrics**: wall time (s), peak memory (GB), throughput (cells/s), output bytes.
- **Acceptance criterion**: for the sparse methods, time per non-zero entry at 10M cells is within 1.5 times that at 100k cells, and CUDA throughput at 1M cells is at least 5 times the CPU throughput (proposed). Residual methods run on a gene subset whose dense output fits the dry-run memory estimate.
- **Known pitfalls**: thread count, storage format and disk caching change timings and are recorded with each run.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `normalization.dispersion_estimation`: Per-gene overdispersion estimation with shrinkage
- **Feeds**:
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `normalization.depth_confounding_diagnostic`: Residual depth-confounding diagnostic
  - `normalization.normalization_pipeline_selection`: Data-driven normalization pipeline selection
- **Reads**: `layers/counts`, `obs/size_factors`, `obs/total_counts`, `obs/batch`, `var/gene_mean`, `models/<name>`
- **Writes**: `layers/vst_shifted_log`, `layers/vst_acosh`, `layers/pearson_residuals`, `var/vst_overdispersion`, `var/vst_residual_variance`, `uns/vst_settings`, `models/vst_sctransform_v2`, `models/vst_glmgampoi_pearson`
<!-- CHAINING:AUTO:END -->

Standard recipe: size factors, this transform, highly variable genes, PCA, neighbour graph and clustering. Residual methods feed gene selection through `var/vst_residual_variance`; the default `shifted_log` feeds PCA directly.

## 10. Risks, pitfalls and open questions

- **Source papers.** Full texts of [R1], [R3], [R4] and [R5] were not read: the dataset list, generators and metric definitions of [R1] are not reproduced (B1 is singlet-constructed), the 59-dataset count of [R4] and the content of [R5] are taken from bibliographic records and abstract-level summaries, and the volume and pages of [R5] are not recorded.
- **Pseudo-count rule.** The first-order derivation and exact NB variances favour $1/(2\alpha)$, while transformGamPoi uses $1/(4\alpha)$ and the preprint of [R1] states that it approximates the variance-stabilizing transform. B4 decides; the first experiment is B4, then B3, then B1 with shifted_log as comparator.
- **Overdispersion defaults.** scanpy uses $\theta=100$ ($\alpha=0.01$), transformGamPoi $\alpha=0.05$ and sctransform a per-gene estimate, so residuals differ in scale across tools. G1 has no zero inflation, so calibration on real UMI data is untested.
- **Deferred benchmarks.** Differential-expression false-positive control under donor-level splits is not benchmarked because cell-level tests are inflated by donor pseudoreplication whatever the transform, and with a donor-aware test the transform is expected to matter little (untested). The OpenProblems dimensionality-reduction metrics are not used: that task fixes a log-10k input and its repository states no dataset list. Removal of depth-correlated biology by depth regression has no catalogue-scale benchmark.
- **Catalogue data.** Per-dataset licences of the annotated strata must be filtered in the registry; author labels differ in granularity across studies.
- **Scale.** Dense residuals at catalogue scale require the gene-subset policy of section 6; the CUDA IRLS path is unproven until it matches the CPU reference.

## 11. References

R1. Ahlmann-Eltze C, Huber W. Comparison of transformations for single-cell RNA-seq data. *Nature Methods* 2023;20:665–672. doi:10.1038/s41592-023-01814-1 — verified (corpus)
R2. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019. doi:10.1186/s13059-019-1874-1 — verified (corpus)
R3. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)
R4. Choudhary S, Satija R. Comparison and evaluation of statistical error models for scRNA-seq. *Genome Biology* 2022;23:27. doi:10.1186/s13059-021-02584-9 — verified (search)
R5. Booeshaghi AS, Pachter L. Normalization of single-cell RNA-seq counts by log(x + 1) or log(1 + x). *Bioinformatics* 2021. doi:10.1093/bioinformatics/btab085 — verified (search)
R6. Vallejos CA, Risso D, Scialdone A, Dudoit S, Marioni JC. Normalizing single-cell RNA sequencing data: challenges and opportunities. *Nature Methods* 2017. doi:10.1038/nmeth.4292 — verified (corpus)
R7. Dorfman RA. A note on the δ-method for finding variance formulae. *Biometric Bulletin* 1938. — verified (corpus)
R8. Ahlmann-Eltze C, Huber W. glmGamPoi: fitting Gamma-Poisson generalized linear models on single cell count data. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa1009 — verified (repo)
R9. Lun A. Overcoming systematic errors caused by log-transformation of normalized single-cell RNA sequencing data. *bioRxiv* 2018. — verified (repo)
R10. Amezquita R, Lun A, Hicks S, Gottardo R. Orchestrating single-cell analysis with Bioconductor, chapter on further normalization topics. Online book, https://bioconductor.org/books/release/OSCA/ (2022). — verified (corpus)
R11. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)
R12. Abhishek Sarkar, Matthew Stephens. Separating measurement and expression models clarifies confusion in single-cell RNA sequencing analysis. *Nature Genetics* 2021. doi:10.1038/s41588-021-00873-4 — verified (corpus)
R13. Schaar A, Kim SH. Normalization. In: Best practices for single-cell analysis across modalities (online book, theislab); consortium reference Heumos L, Schaar AC, Lance C, et al. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | maintainers Ilan Gold, Philipp Angerer, Severin Dicks; authors listed in pyproject.toml (Alex Wolf, Isaac Virshup, Lukas Heumos, Malte Luecken and others) | BSD-3-clause (pyproject.toml; LICENSE: BSD 3-Clause, copyright 2025 scverse) | shifted logarithm with median target sum; analytic Pearson residuals | port |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (pyproject.toml) | MIT (LICENSE; copyright 2022 Severin Dicks, 2025 scverse) | GPU normalize_total, log1p and Pearson residuals | port |
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and contributors per DESCRIPTION | MIT + file LICENSE (DESCRIPTION; LICENSE: 2021, Seurat authors) | counts-per-10,000 `LogNormalize` | callout (rule reproduced by `shifted_log.target_sum=1e4`) |
| https://github.com/const-ae/transformGamPoi | Constantin Ahlmann-Eltze (aut, cre) | GPL-3 (DESCRIPTION; no LICENSE file) | acosh and overdispersion-pseudo-count transforms; residual transform | reimplement |
| https://github.com/ChristophH/sctransform | Christoph Hafemeister (aut), Saket Choudhary (aut, cre), Rahul Satija (ctb) | GPL-3 \| file LICENSE (DESCRIPTION; LICENSE is the GNU GPL v3 text) | sctransform v1 and v2 residuals | reimplement |
| https://github.com/berenslab/umi-normalization | Jan Lause, Philipp Berens, Dmitry Kobak (README) | AGPL-3.0 (LICENSE file) | original analytic Pearson residual code | callout |
| https://github.com/const-ae/glmGamPoi | Constantin Ahlmann-Eltze (aut, cre), Nathan Lubock (ctb), Michael Love (ctb) | MIT + file LICENSE (DESCRIPTION; LICENSE: 2026, Constantin Ahlmann-Eltze) | gamma-Poisson GLM and Pearson residuals | port |
