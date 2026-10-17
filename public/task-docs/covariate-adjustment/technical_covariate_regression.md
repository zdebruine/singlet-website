---
id: covariate-adjustment.technical_covariate_regression
title: Regression of technical covariates from expression
area: covariate-adjustment
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [qc.low_quality_cell_detection, normalization.size_factor_estimation, covariate-adjustment.covariate_variance_attribution]
feeds: [dim-reduction.normalized_cell_embedding, covariate-adjustment.gene_scaling_and_clipping, evaluation.overcorrection_detection]
reads: [layers/counts, layers/log1p_norm, obs/<covariate>, obs/<protect>]
writes: [layers/residual, varm/regression_coef, models/nb_glm, uns/covariate_regression]
devices: [cpu, cuda]
mcp_tool: singlet_covariate_adjustment_technical_covariate_regression
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Regression of technical covariates from expression

> Removes measured per-cell covariates such as total counts, detected genes and percent mitochondrial counts from expression, using an analytic depth model or linear and negative binomial residualization, and writes the residual matrix with the coefficients behind it.

## 1. Question

Does removing measured per-cell covariates (total UMI count, detected genes, percent mitochondrial counts and similar) from each gene's expression remove technical variation without also removing biology that co-varies with them, and which residualization form does this best? The input is a count or log-normalized cells by genes matrix with a covariate table. The output is a residual matrix of the same shape, with per-gene coefficients optionally kept. A correct answer removes the covariate-explained variation and keeps cell-type structure and protected biology.

## 2. Why this task matters and where the field stands

Library size, detected-gene count and mitochondrial fraction are measured per cell and vary with capture and cell state [R11]. Three published routes remove them before PCA: linear regression of log-normalized values in scanpy, whose docstring credits Seurat's regressOut [R1]; the `vars.to.regress` option of Seurat's ScaleData; and the second stage of SCTransform, which regresses clipped Pearson residuals of a per-gene negative binomial model linearly [R2, R4]. The status is **contested**. Linear removal on log values can delete biology that correlates with the covariate and can double-correct depth that size factors already absorbed. Model-based residuals avoid the second step: analytic Pearson residuals [R3] and the regularized negative binomial fit [R2] treat depth inside the model. Pipeline-level evaluations rank preprocessing tools as whole units [R5]. Against the more sophisticated transformations, Ahlmann-Eltze and Huber found that a logarithm with a pseudo-count followed by PCA performed as well as or better than them on simulated and real data [R6].

Open problems: (i) no benchmark isolates linear regression of total counts or percent mitochondrial counts against model residuals or against no regression; (ii) the protected-biology list, such as cell cycle or cell type, is not standardized; (iii) mitochondrial fraction differs between cell types and tissues, so global removal can delete real states [R11]; (iv) the order of regression relative to scaling and HVG selection differs between scanpy, Seurat and rapids-singlecell, and no study compares the orders.

## 3. Theory and insight

Let $x_{gc}$ be the expression of gene $g$ in cell $c$ on the scale of the input layer, and let $Z$ be the $n\times p$ covariate matrix with an intercept column. The notation is:

| Symbol | Meaning |
|---|---|
| $y_{gc}$, $y_{\cdot c}$, $y_{g\cdot}$, $y_{\cdot\cdot}$ | raw count, cell total, gene total, grand total |
| $s_c$ | size factor of cell $c$ |
| $Z$, $P$ | nuisance covariate matrix and protected design |
| $H=Z(Z^\top Z)^{-1}Z^\top$ | hat matrix of $Z$ |
| $\theta_g$ | negative binomial overdispersion of gene $g$ |
| $\lambda_i$, $\nu_i$ | variance of principal component $i$ and its share of the retained variance |

**Linear removal.** Ordinary least squares on the input scale projects each gene onto the complement of the covariates:

$$\tilde x_g=(I-H)\,x_g,\qquad H=Z(Z^\top Z)^{-1}Z^\top.$$

This is exact for a fixed design, an additive linear covariate effect on the input scale, full column rank of $Z$, and homoscedastic residuals. It ignores that count variance is $\mu+\mu^2/\theta_g$, so low-mean genes receive the same weight as high-mean genes.

**Attenuation.** If $x_g=B\gamma_g+Z\delta_g+\varepsilon_g$, then

$$\tilde x_g=(I-H)B\gamma_g+(I-H)\varepsilon_g,\qquad \lVert (I-H)v\rVert^2=\lVert v\rVert^2\,\bigl(1-R^2_{v\mid Z}\bigr),\quad v=B\gamma_g.$$

Biology that co-varies with the covariates loses the fraction $R^2_{v\mid Z}$ of its centred variance. With one covariate of correlation $\rho$ the lost fraction is $\rho^2$. The statement needs the covariates to be measured without error and not caused by the biology.

**Count models.** Under a negative binomial measurement model,

$$Y_{gc}\sim\mathrm{NB}(\mu_{gc},\theta_g),\qquad \log\mu_{gc}=\log s_c+f_g(z_c),\qquad \mathrm{Var}(Y_{gc})=\mu_{gc}+\mu_{gc}^2/\theta_g,$$

depth enters multiplicatively through $s_c$. The analytic Pearson residual uses the null model $\mu_{gc}=y_{\cdot c}\,y_{g\cdot}/y_{\cdot\cdot}$ with one shared overdispersion:

$$r_{gc}=\frac{y_{gc}-\mu_{gc}}{\sqrt{\mu_{gc}+\mu_{gc}^2/\theta}},\qquad r_{gc}\ \text{clipped to}\ [-\sqrt{n},\sqrt{n}].$$

It approximates the negative binomial fit when gene dispersions are similar, has no covariates, and needs no log transform or pseudo-count. The Gaussian approximation to the residual is first order in $\mu\gg1$; for $\mu$ of order one or below, the $\mu^2/\theta$ term and zero inflation dominate and the approximation degrades.

**Joint fit.** With a protected design $P$, the fit $x_g\sim[P\;Z]$ gives $\hat x_g^{\mathrm{adj}}=x_g-Z\hat\beta_{Z,g}$. Protected biology survives to the extent that $P$ contains it; unprotected biology correlated with $Z$ is still removed.

**Estimands.** Each output is defined on its own scale:

- Linear residual: the input-layer value minus its fitted covariate component, in the units of the input layer, with no re-normalization.
- Pearson residual: dimensionless, per cell and gene, approximately unit variance under the null, clipped at $\sqrt{n}$.
- Negative binomial residual: Pearson residual of the per-gene fit with covariate terms, clipped at $\sqrt{n/30}$.
- Cell-type and cell-line truth: one categorical label per cell.
- True profile $m_{gk}$: log expression rate of gene $g$ in type $k$, centred across types.
- Held-out molecules: integer counts per cell and gene in the test split.

**Insight.** Depth is a measurement effect. If expression rates do not depend on library size given biology [R10], depth belongs in the measurement model, and regressing it out of log values double-corrects and distorts the nonlinear transform. For non-depth covariates the cost is governed by $R^2$ against the biology, so linear removal is defensible only after the confounding check (covariate-adjustment.covariate_variance_attribution) and with a protected design.

A consequence for evaluation: the linear residual matrix is orthogonal to every column of $Z$, so each principal component of it has zero $R^2$ on the covariates and the PCR-based covariate score equals 1 by construction. The score therefore cannot detect over-removal by linear methods, and B1 reads label retention instead.

**Covariate variance.** The principal-component regression share of a covariate $C$ in an embedding is the sum over the first 50 components of their $R^2$ on $C$, weighted by each component's variance share:

$$R^2\mathrm{Var}(C)=\sum_{i\le 50}\max\bigl(0,\,R^2(\mathrm{PC}_i\mid C)\bigr)\,\nu_i,\qquad \nu_i=\frac{\lambda_i}{\sum_{j\le 50}\lambda_j}.$$


## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scanpy `regress_out` (OLS on log-normalized values) | heuristic | per-gene least squares on an intercept and listed keys; residuals replace the matrix | [R1] origin; code §12 |
| Seurat `ScaleData` `vars.to.regress` | heuristic | linear regression of normalized data before centring and scaling | [R1]; code §12 |
| rapids-singlecell `regress_out` (GPU) | heuristic | GPU equivalent of the OLS, batched over genes, float64 Gram matrix | code §12 |
| SCTransform with covariates in the second stage | model-based | per-gene regularized negative binomial fit on log UMI, then clipped Pearson residuals regressed linearly | [R2, R4] |
| Analytic Pearson residuals | model-based | closed-form negative binomial null from row and column sums; no covariates | [R3] |
| scVI covariate conditioning | model-based | decoder conditioned on covariate keys such as batch | [R13] |

The published standard for linear removal is log-scale regression in scanpy and Seurat, which most pipelines use. SCTransform is the model-based standard in Seurat, and its v2 flavour is the default in the code [R2, R4]. Analytic Pearson residuals are the closed-form alternative [R3]. The scVI row is a route, not a comparator here. Every row except scVI is a comparator in section 8.

Defaults taken from source code at the stated commit:

| Method | Parameter | Value | Source |
|---|---|---|---|
| scanpy `regress_out` | signature | `keys` required (str or list); `layer=None` regresses `X`; `n_jobs=None` | `src/scanpy/preprocessing/_simple.py:513–518` @8ed52d9 |
| scanpy `regress_out` | intercept | column of ones inserted at index 0 | `_simple.py:597` @8ed52d9 |
| scanpy `regress_out` | fast path | `np.linalg.inv` on the normal equations when det(ZᵀZ) ≠ 0 (`numpy_regress_out`); otherwise per-gene GLM fallback | `_simple.py:499–510`, `603`, `616–674` @8ed52d9 |
| scanpy `regress_out` | single categorical key | per-group gene means regressed out | `_simple.py:571` @8ed52d9 |
| scanpy `regress_out` | sparse input | densified before regression | `_simple.py:567`, `586` @8ed52d9 |
| Seurat `ScaleData` | `vars.to.regress` | NULL | `R/preprocessing.R:5391` @5f67c70 |
| Seurat `ScaleData` | `model.use`, `use.umi` | `'linear'`, `FALSE` | `R/preprocessing.R:5394–5395` @5f67c70 |
| Seurat `ScaleData` | `scale.max` | 10 | `R/preprocessing.R:5398` @5f67c70 |
| SCTransform | `vst.flavor` | `'v2'` | `R/preprocessing.R:3897` @5f67c70 |
| SCTransform | `ncells` (fit subsample) | 5000 | `R/preprocessing.R:3888` @5f67c70 |
| SCTransform | `clip.range` | ±√(cells/30) | `R/preprocessing.R:3896` @5f67c70 |
| SCTransform | internal residual clip | ±√(cells) | `R/preprocessing.R:3978` @5f67c70 |
| SCTransform | `do.correct.umi` | TRUE | `R/preprocessing.R:3887` @5f67c70 |
| SCTransform | second stage | `ScaleData(model.use='linear', use.umi=FALSE)` | `R/preprocessing.R:4309–4310`, `4334–4335` @5f67c70 |
| Analytic Pearson | `theta` | 100 | `src/scanpy/experimental/pp/_normalization.py:95` @8ed52d9 |
| Analytic Pearson | `clip` | None, which becomes √n_obs | `_normalization.py:54–56`, `96` @8ed52d9 |
| Analytic Pearson | `mu` and residual | `sums_cells @ sums_genes / sum_total`; `(x − mu)/sqrt(mu + mu²/theta)` | `_normalization.py:74`, `76` @8ed52d9 |
| rapids-singlecell `regress_out` | `batchsize` | None: 100 genes per batch when n_obs > 100000, else 'all' | `src/rapids_singlecell/preprocessing/_regress_out.py:156–159` @e110792 |
| rapids-singlecell `regress_out` | regressors | float64 Gram matrix; centred, unit-norm regressors | `_regress_out.py:127–146` @e110792 |
| scib `pcr_comparison` | score | (before − after)/before, clamped at 0 | `scib/metrics/pcr.py:94–100` @cd67913 |
| scib `pc_regression` | R²Var | r² clamped at 0, weighted by pca_var/sum(pca_var) | `scib/metrics/pcr.py:292–295` @cd67913 |
| scib `cell_cycle` | score | 1 − abs(after − before)/before, clamped at 0 | `scib/metrics/cell_cycle.py:109–118` @cd67913 |

## 5. Proposed singlet approach

- **`pearson_analytic`: port.** Closed form from the scanpy implementation (§12). It needs only marginal sums and one dense read of the counts. It is the default for depth.
- **`ols_log`: port** the numerical design of scanpy and rapids-singlecell (§12). The regressors are centred and unit-normed and the Gram matrix is accumulated in float64. It exists to reproduce scanpy and Seurat output and is never the default.
- **`nb_glm_residual`: reimplement** from [R2] and [R4]; the reference implementation is copyleft (§12), so no code is copied. Each gene gets a batched iteratively reweighted least squares fit of the negative binomial model with offset $\log s_c$ and design $[P\;Z]$. The nuisance term is removed from the linear predictor before the residual is formed, so protected terms stay in the expected count.
- **Protected terms** are a singlet variant of `ols_log` and `nb_glm_residual`, not a separate enum value; no published method is claimed for it.

The proposed model-based formulation is a per-gene negative binomial measurement model with offset $\log s_c$, covariate terms, and protected terms kept in the expected count. It is falsified on the benchmarks in two ways. If the analytic depth model loses cell-line ARI by more than 0.05 against no regression on any protocol in B2, depth-as-measurement is rejected for that data type. If the protected negative binomial fit does not recover more biology than plain OLS at $\delta>0$ in B4, the protected-design claim is rejected.

The per-gene designs are small (p of about 10 or fewer) and regular, so the iteratively reweighted fit and the OLS normal equations are hard-coded in CUDA, with cuSPARSE for sparse sufficient statistics. PyTorch is not used here; it is reserved for the conditional negative binomial model of [R13], which is outside this tool. Core kernels are marginal sums, batched float64 Gram accumulation, and batched per-gene fits.

On CPU the computation proceeds in gene blocks with dense float32 output. The output needs $4nG$ bytes, so 100,000 cells by 2,000 genes needs 0.8 GB before overhead. Streaming end to end is not claimed.

Defaults an agent uses without asking: `pearson_analytic`; empty covariates for depth alone; for percent mitochondrial counts, `nb_glm_residual` with `total_counts` and `pct_counts_mt`, protecting the cell-type column when present; `layer` null; `device` auto. Covariates with pairwise correlation above 0.9 are flagged (proposed; no literature default). Use `ols_log` only to reproduce scanpy or Seurat output, and say so in the result.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts for `pearson_analytic` and `nb_glm_residual` |
| read | layers/log1p_norm | sparse float32 | size-factor normalized log values for `ols_log` |
| read | `obs/<covariate>` | float or categorical | each requested covariate, for example total_counts |
| read | `obs/<protect>` | float or categorical | protected terms kept in the joint fit |
| write | layers/residual | float32 dense | residualized cells by genes matrix, same shape as the input |
| write | varm/regression_coef | float64 | per-gene coefficients for `ols_log` and `nb_glm_residual` |
| write | models/nb_glm | table | per-gene dispersion and coefficients for `nb_glm_residual` |
| write | uns/covariate_regression | dict | method, covariates, protect, clip, condition number of ZᵀZ |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "pearson_analytic" | `pearson_analytic`, `nb_glm_residual`, `ols_log` | Residualization path. pearson_analytic removes depth only; nb_glm_residual and ols_log accept covariates. |
| `covariates` | array | [] | — | obs columns to remove. Must be empty for pearson_analytic. Collinear covariates are flagged. |
| `protect` | array | [] | — | obs columns kept in the joint fit so only the nuisance component is subtracted. Not used by pearson_analytic. |
| `layer` | string/null | null | — | Input layer. Null selects layers/counts for pearson_analytic and nb_glm_residual, and layers/log1p_norm for ols_log. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing the residuals. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `pearson_analytic` | object | — | — |  |
| `pearson_analytic.theta` | number | 100 | > 0 | Shared overdispersion in the Pearson denominator, as in scanpy normalize_pearson_residuals. |
| `pearson_analytic.clip` | number/null | null | min 0 | Residual clip; null means sqrt(n_cells), the scanpy default. |
| `nb_glm_residual` | object | — | — |  |
| `nb_glm_residual.clip` | number/null | null | min 0 | Residual clip; null means sqrt(n_cells/30), the SCTransform clip.range default. |
| `ols_log` | object | — | — |  |
| `ols_log.batch_genes` | integer/string/null | null | — | GPU genes per batch (integer or 'all'); null uses 100 above 100000 cells, else 'all'. Affects memory only. |
<!-- PARAMS:AUTO:END -->

Covariates must be empty for `pearson_analytic`, which models depth inside its null; `protect` is ignored by it and must be empty. Protected terms may not be collinear with the covariates. When the design is ill-conditioned the call fails and reports the condition number of $Z^\top Z$. `ols_log` takes log-normalized input and refuses raw counts rather than transforming them. Clip defaults differ by method: $\sqrt{n}$ for Pearson residuals, $\sqrt{n/30}$ for the negative binomial residual. Without `overwrite`, an existing `layers/residual` makes the call fail.

## 7. MCP tool

Tool name `singlet_covariate_adjustment_technical_covariate_regression` (definition in `tasks/mcp/singlet_covariate_adjustment_technical_covariate_regression.json`). Example call, with illustrative inputs:

```json
{"dataset": "/data/example.singlet", "method": "nb_glm_residual",
 "covariates": ["total_counts", "pct_counts_mt"], "protect": ["cell_type"],
 "nb_glm_residual": {"clip": null}}
```

Example result, with placeholders for computed values:

```json
{"dataset": "/data/example.singlet", "status": "completed",
 "wrote": ["layers/residual", "varm/regression_coef", "models/nb_glm", "uns/covariate_regression"],
 "summary": {"method": "nb_glm_residual", "covariates": ["total_counts", "pct_counts_mt"],
   "protect": ["cell_type"], "clip": "sqrt(n_cells/30)", "clipped_fraction": "<fraction>",
   "condition_number_ZtZ": "<float>", "n_genes": "<int>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long jobs: calls above the inline size limit return `queued` with a `job_id`; smaller calls return inline. Stochastic: no; the output is a deterministic function of the input and parameters. Dry-run estimate: returns estimated seconds and peak memory from $4nG$ bytes and the device, without computing residuals.

## 8. Benchmarks

Shared protocol. All accuracy benchmarks use the same comparators (section 4, plus no regression), the same 2,000 highly variable genes chosen before residualization, 50 principal components, a kNN graph with k = 15, and Leiden clustering at resolution 1.0 (all proposed). The study is the unit of replication; each benchmark reports per-study values, the median and a paired comparison across studies. Every method reports total PCA variance retained beside any score. Random subsamples use seeds 0 to 4.

### B1. Label retention and covariate removal on annotated catalogue studies

- **Goal**: Measure whether residualizing total counts or percent mitochondrial counts keeps author cell-type structure and cell-cycle variance, while the covariate's share of the embedding falls, following the scib framework [R7].
- **Ground truth**: Expert labels. Each labelled cell carries the author cell-type annotation of its source study, used as one categorical value per cell. The adjusted Rand index (ARI) is computed on labelled cells only. Covariates are observed quantities, not truth.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Annotated studies from the singlet catalogue | singlet catalogue; study list fixed by the protocol before analysis | scRNA-seq; — | — | Use studies where the covariate and the label are not perfectly confounded |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cell-type ARI | ARI between Leiden clusters on the kNN graph of the residualized PCA and author labels, labelled cells only | maximize | primary | [R7] |
| PCR covariate score | $(R^2\mathrm{Var}_{\mathrm{before}}-R^2\mathrm{Var}_{\mathrm{after}})/R^2\mathrm{Var}_{\mathrm{before}}$, clamped at 0, with $R^2\mathrm{Var}$ as in section 3; equals 1 for linear residuals by construction | maximize | guardrail | [R7] |
| Cell-cycle conservation | $1-\lvert\mathrm{Var}_{\mathrm{after}}-\mathrm{Var}_{\mathrm{before}}\rvert/\mathrm{Var}_{\mathrm{before}}$ on S and G2M scores, clamped at 0, per study, aggregated by scib's `agg_func` | maximize | guardrail when cell cycle is protected | [R7] |

- **Comparators**: no regression; scanpy `regress_out`; Seurat `ScaleData` `vars.to.regress`; SCTransform with covariates; analytic Pearson residuals; singlet `nb_glm_residual`; singlet `ols_log` with `protect`.
- **Protocol**: For each study, covariate sets {total_counts}, {total_counts, n_genes_by_counts} and {total_counts, pct_counts_mt}. A second arm protects the S and G2M scores. The raw PCR difference is reported beside the clamped score.
- **Acceptance criterion**: Proposed, not from the literature. ARI within 0.02 absolute of the no-regression baseline for each method that keeps depth; cell-cycle conservation at least 0.8 whenever the cell cycle is protected.
- **Known pitfalls**: (1) Circularity: labels obtained by clustering a residualized embedding inflate ARI for that method, so labels must come from the source study. (2) scib defines the PCR for batch and cell-cycle covariates; for depth the score also reflects sampling variance carried by the principal components.

### B2. Cell-line identity under depth-correlated cell lines

- **Goal**: Test whether residualizing total counts keeps cell-line identity in controlled mixtures where cell lines differ in depth [R9].
- **Ground truth**: Orthogonal measurement. Each single cell's cell line is the deposited label `cell_line_demuxlet`, one categorical value per cell among HCC827, H1975 and H2228. ARI is computed over all cells of a protocol.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| sc_mixology mixtures (CellBench_data) | GEO GSE118767 [R9] | scRNA-seq; human lung adenocarcinoma lines HCC827, H1975 and H2228; — | — | One design, three protocols: 10x Chromium, CEL-seq2, Drop-seq |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cell-line ARI | ARI between Leiden clusters on the residualized kNN graph and the cell-line label | maximize | primary | [R9] |
| Residual depth R² | variance-weighted mean over 50 PCs of the R² of each PC on log total counts, weights $\lambda_i/\sum_j\lambda_j$ | minimize | guardrail | [R7] |
| Depth–identity η² | between-line share of the variance of log total counts, before processing | report only | context | — |

- **Comparators**: no regression; scanpy `regress_out` on total_counts; analytic Pearson residuals; singlet `nb_glm_residual` on total_counts.
- **Protocol**: Each protocol is residualized separately with total_counts only. Five cell subsamples (seeds 0 to 4) test sensitivity, and η² is reported with each result. The linear residual depth R² is zero by construction, so the guardrail informs only the non-linear methods.
- **Acceptance criterion**: Proposed. Residual depth R² at most 0.1 for the method kept as the depth method; cell-line ARI within 0.05 absolute of the no-regression baseline.
- **Known pitfalls**: (1) Three idealised lines do not establish performance on tissue, where separation is weaker. (2) If depth separates the lines strongly, removing depth also removes identity; η² must be read before the ARI.

### B3. Held-out molecule prediction on catalogue count data (proposed)

- **Goal**: Test whether a covariate-aware count model predicts held-out molecules better than a depth-only model, following molecular cross-validation [R8].
- **Ground truth**: Consistency. Test molecules are held out from the same cells, so the target is the integer count per cell and gene in the test split, with no size-factor normalization of the target.
- **Datasets**: Generator recipe applied to each study:
  1. Take the raw UMI count matrix $y_{gc}$ of the study after upstream quality control.
  2. Thin each count binomially: $y^{\mathrm{tr}}_{gc}\sim\mathrm{Binomial}(y_{gc},0.5)$ and $y^{\mathrm{te}}_{gc}=y_{gc}-y^{\mathrm{tr}}_{gc}$.
  3. Fit each comparator on the training matrix only, with offsets from training totals.
  4. Predict expected counts $\hat y_{gc}$ for every cell and gene, and rescale them by the ratio of total test to total training counts, as in the OpenProblems implementation.
  5. Score with the metrics below, for split seeds 0 to 4.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Raw-count layers of catalogue studies | singlet catalogue; study list fixed by the protocol | scRNA-seq; —; — | — | One study per replicate unit |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Held-out Poisson NLL | mean over cells and genes of $\hat y'_{gc}-y^{\mathrm{te}}_{gc}\log(\hat y'_{gc}+10^{-6})$, with $\hat y'$ the rescaled prediction | minimize | primary | [R8] |
| Held-out log MSE | mean squared difference between log1p of test counts and of predictions, each normalized to $10^4$ UMI per cell | minimize | guardrail | [R8] |

- **Comparators**: depth-only negative binomial fit with $\mu_{gc}=s_c f_g$ and $s_c$ the training total; singlet `nb_glm_residual` with covariate terms; analytic Pearson null mean $\mu_{gc}=y_{\cdot c}y_{g\cdot}/y_{\cdot\cdot}$ on training counts. Linear residuals on log values have no expected count and are not scored here.
- **Protocol**: Five split seeds per study; medians across studies; paired sign test across studies.
- **Acceptance criterion**: Proposed. The covariate-aware model has lower held-out Poisson NLL than the depth-only model in the median study and in at least 75 percent of studies; the threshold is to be set by the team.
- **Known pitfalls**: (1) Depth-only models score well because test counts scale with depth, so the baseline is mandatory. (2) Binomial thinning is a modelling assumption for UMI counts (section 10).

### B4. Planted depth and percent-mitochondrial confounding (proposed)

- **Goal**: Test whether residualization removes planted nuisance structure while keeping planted cell-type signal that is correlated with the nuisance.
- **Ground truth**: Planted simulation. Cell type, the true centred log expression rate $m_{gk}$, and the planted covariates are known by construction.
- **Datasets**: Generator recipe, with every parameter proposed:
  1. Draw $\mu_{gk}\sim\mathcal N(0,1)$ for $G=2{,}000$ genes and $K=3$ types; set $\pi_{gk}=\mathrm{softmax}_g(\mu_{gk})$ and $m_{gk}=\log\pi_{gk}-\overline{\log\pi}_{\cdot k}$.
  2. Assign each of $n=5{,}000$ cells a type $k_c$ uniformly at random.
  3. Depth: $\log L_c=8+\delta\,\mathbb 1[k_c=1]+0.3\,\varepsilon_c$, with $\varepsilon_c\sim\mathcal N(0,1)$ and $\delta\in\{0,0.5,1\}$.
  4. Percent mitochondrial counts: $100\,p_c$ with $p_c=\mathrm{expit}(\eta\,\mathbb 1[k_c=2]+0.5\,\xi_c)$, $\xi_c\sim\mathcal N(0,1)$ and $\eta\in\{0,0.5,1\}$.
  5. Counts: $\mathbb E[Y_{gc}]=L_c\,\pi_{g,k_c}$ and $Y_{gc}\sim\mathrm{NB}(\mathbb E[Y_{gc}],\theta_g)$ with $\theta_g=10$.
  6. Replicate five times with seeds 0 to 4 at each $(\delta,\eta)$. Outputs are counts, total counts, percent mitochondrial counts, cell type and $m_{gk}$.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated counts from the recipe above | generator recipe | simulated scRNA-seq; $G=2{,}000$; $n=5{,}000$ per replicate | — | Grid $\delta\times\eta$ with five replicates |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recovered-biology correlation | per type, Pearson correlation across genes between the type-mean residual, centred across types, and $m_{gk}$; averaged over types | maximize | primary | — |
| Residual nuisance R² | mean over genes of the R² of each residual gene on the planted covariate (total counts or $100\,p_c$) | minimize | primary | — |
| Cell-type ARI | ARI between Leiden clusters on the residualized embedding and the planted types | maximize | guardrail | [R7] |

- **Comparators**: no regression; scanpy `regress_out`; singlet `nb_glm_residual` on total_counts; analytic Pearson residuals; singlet `ols_log` with `protect` set to the cell type.
- **Protocol**: Every grid point is evaluated. The realized R² between type and the covariate is reported beside each grid point, and recovered biology is plotted against that realized R², not only against the grid index.
- **Acceptance criterion**: Proposed. At $\delta=\eta=0$ every method keeps recovered biology within 0.02 of no regression; at $\delta=1$ the protected fit retains at least the recovered biology of plain OLS.
- **Known pitfalls**: (1) The simulation encodes the models' assumptions, so results do not establish real-data performance. (2) Here percent mitochondrial counts shift cell-type composition but not expression, so removing them can only cost biology; the benchmark measures attenuation, not benefit.

### P1. Performance and scaling

Measure wall time, peak memory and throughput in cells per second at 10,000, 100,000 and 1,000,000 cells, on CPU and CUDA, for the comparators in section 8 (scanpy; rapids-singlecell with batch size `all` and 100; Seurat `ScaleData` and SCTransform; analytic Pearson) and for singlet's three methods. Hold fixed the gene count (2,000 highly variable genes in one arm, the full transcriptome in another), $p=3$ covariates (total counts, detected genes, percent mitochondrial counts), float32 and float64 separately, matrix density, `n_jobs` and thread count. Record the condition number of $Z^\top Z$ for every arm. Densification is timed with the regression for scanpy, since it is part of that cost. Ten million cells are not measured because end-to-end streaming is not claimed.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `covariate-adjustment.covariate_variance_attribution`: Covariate variance attribution and confounding check before removal
- **Feeds**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `covariate-adjustment.gene_scaling_and_clipping`: Gene scaling, centering and clipping before PCA
  - `evaluation.overcorrection_detection`: Over-correction after batch or covariate removal
- **Reads**: `layers/counts`, `layers/log1p_norm`, `obs/<covariate>`, `obs/<protect>`
- **Writes**: `layers/residual`, `varm/regression_coef`, `models/nb_glm`, `uns/covariate_regression`
<!-- CHAINING:AUTO:END -->

Belongs to the preprocessing recipe from quality control through normalization to embedding, placed after the confounding check.

## 10. Risks, pitfalls and open questions

- **Evidence limits**: The result of Ahlmann-Eltze and Huber [R6] is taken from its abstract; the benchmark tables are not part of this record. Cole et al. [R12] is cited for its record only, so whether it evaluated covariate regression is open. limma's `removeBatchEffect` [R14] and GLM-PCA with covariates [R15] are named and excluded from section 4. The NaiveDE regression function is not part of this record.
- **Code-level defects**: The OpenProblems Poisson script calls `poisson_nll_loss(test_data, denoised_data)`, which supplies the test counts as the prediction. The loss is then linear in the predictions with coefficient $-\log(y^{\mathrm{te}}+10^{-6})$, positive for zero test counts and negative otherwise, so it rewards inflating predictions on observed molecules. B3 uses the standard orientation $\hat y'-y^{\mathrm{te}}\log(\hat y'+10^{-6})$ instead. The OpenProblems MSE is computed on log1p of $10^4$-normalized counts, not on raw counts.
- **Data gaps**: Cell numbers for the three CellBench protocols were not found in the README text or the summary table image and must be read from the R objects, so B2 sizes are open. The scanpy docstring states that `regress_out` can overcorrect in some circumstances and cites issue 526; the issue text is not part of this record. Binomial thinning in B3 follows the molecular cross-validation approach of [R8]; the original text is not part of this record. Terms of catalogue studies vary by source and are not listed here.
- **Unsettled literature**: The order of operations differs: scanpy and Seurat regress before PCA, and SCTransform regresses clipped residuals. No study compares the orders. The protected-biology list is not standardized, and whether percent mitochondrial counts should be removed at all depends on tissue [R11].
- **Technical risks**: The dense output needs $4nG$ bytes. The rapids-singlecell code comments cite a condition number near $10^{11}$ for covariates on very different scales, which float32 cannot carry, so the float64 Gram matrix and the normal-equations path need checking. The 0.9 correlation warning and the confounding threshold are team-set values with no literature default. The reference SCTransform implementation is copyleft (section 12), so the negative binomial route is written from the papers [R2, R4].
- **First experiment**: Reproduce scanpy `regress_out` and analytic Pearson residuals on the sc_10x mixture (B2) to floating-point tolerance, then measure η² and cell-line ARI for each method.

## 11. References

R1. Satija R, Farrell JA, Gennert D, Schier AF, Regev A. Spatial reconstruction of single-cell gene expression data. *Nature Biotechnology* 2015. doi:10.1038/nbt.3192 — verified (corpus)
R2. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019. doi:10.1186/s13059-019-1874-1 — verified (corpus)
R3. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)
R4. Choudhary S, Satija R. Comparison and evaluation of statistical error models for scRNA-seq. *Genome Biology* 2022. doi:10.1186/s13059-021-02584-9 — verified (search)
R5. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)
R6. Ahlmann-Eltze C, Huber W. Comparison of transformations for single-cell RNA-seq data. *Nature Methods* 2023. doi:10.1038/s41592-023-01814-1 — verified (corpus)
R7. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2021. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R8. Batson J, Royer L, Webber J. Molecular cross-validation for single-cell RNA-seq. *bioRxiv* 2019. doi:10.1101/786269 — verified (corpus)
R9. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R10. Sarkar A, Stephens M. Separating measurement and expression models clarifies confusion in single-cell RNA sequencing analysis. *Nature Genetics* 2021. doi:10.1038/s41588-021-00873-4 — verified (corpus)
R11. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R12. Cole MB, Risso D, Wagner A, DeTomaso D, Ngai J, Purdom E, Dudoit S, Yosef N. Performance assessment and selection of normalization procedures for single-cell RNA-seq. *Cell Systems* 2019. doi:10.1016/j.cels.2019.03.010 — verified (corpus)
R13. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R14. Ritchie ME, Phipson B, Wu D, Hu Y, Law CW, Shi W, Smyth GK. limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 2015. doi:10.1093/nar/gkv007 — verified (corpus)
R15. Townes FW, Hicks SC, Aryee MJ, Irizarry RA. Feature selection and dimension reduction for single-cell RNA-seq based on a multinomial model. *Genome Biology* 2019. doi:10.1186/s13059-019-1861-6 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | Adam Gayoso, Alex Wolf and others (pyproject.toml) | BSD-3-Clause (LICENSE) | `regress_out` and analytic Pearson reference code, @8ed52d9 | port |
| https://github.com/satijalab/seurat | Rahul Satija (author, maintainer); Seurat contributors (DESCRIPTION) | MIT + file LICENSE (copyright holder Seurat authors) | `ScaleData` linear regression, @5f67c70 | port |
| https://github.com/ChristophH/sctransform | Christoph Hafemeister (author); Saket Choudhary (author, maintainer) (DESCRIPTION) | GPL-3 (DESCRIPTION; LICENSE is the GPL-3 text) | stage-one negative binomial model reference, @49e35b5 | reimplement |
| https://github.com/scverse/rapids-singlecell | Severin Dicks (pyproject.toml) | MIT (LICENSE, copyright 2022 Severin Dicks) | GPU OLS and batching, @e110792 | port |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt) | PCR and cell-cycle metric definitions, @cd67913 | callout |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian (LICENSE) | MIT (LICENSE, copyright 2018 Luyi Tian) | sc_mixology data for B2, @7d00ffb | callout |
| https://github.com/openproblems-bio/task_denoising | Wesley Lewis, Scott Gigante (author, maintainer); Robrecht Cannoodt (author) (README) | MIT (LICENSE) | Poisson and MSE definitions in B3, @6233222 | callout |
