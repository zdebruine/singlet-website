---
id: normalization.depth_confounding_diagnostic
title: Residual depth-confounding diagnostic
area: normalization
scope: extended
paradigm: hybrid
literature_status: open
priority: P1
depends_on: [normalization.size_factor_estimation, normalization.variance_stabilizing_transform]
feeds: [normalization.normalization_pipeline_selection, normalization.count_noise_model_selection, covariate-adjustment.covariate_variance_attribution]
reads: [layers/counts, layers/<normalized_layer>, obs/size_factor, obs/<stratify_by>]
writes: [var/depth_r2, var/depth_flag, uns/depth_diagnostic/pc_r2, uns/depth_diagnostic/score, uns/depth_diagnostic/params]
devices: [cpu, cuda]
mcp_tool: singlet_normalization_depth_confounding_diagnostic
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Residual depth-confounding diagnostic

> Measures how much of a normalised matrix, per gene and per principal component, is still explained by sequencing depth and detection rate, using covariates computed from raw counts and a calibrated null within strata.

## 1. Question

Given a normalised matrix $X$ (cells by genes, or cells by principal components) and the raw counts it came from, how much of the remaining variation in $X$ is explained by each cell's total raw counts and detected-gene count, within strata of cell type or batch? The outputs are per-gene and per-component associations, an overall score $S_{\mathrm{depth}}\in[0,1]$, calibrated p-values and a list of depth-associated genes. A correct answer flags depth structure planted in simulation and does not flag depth-independent composition in mixture controls.

## 2. Why this task matters and where the field stands

Depth varies between cells for technical reasons (capture, amplification) and biological ones (RNA content, cell size), and each per-cell scale decides which genes drive distances [R1]. Residual depth structure can therefore create technical clusters, trajectories and differential-expression hits. The OSCA normalisation chapter shows that log-normalised CellBench pool-and-split libraries keep trajectories correlated with library size after library-size scaling, that these follow the mean of log counts differing from the log of the mean, and that downsampling removes them [R2]. It recommends downsampling only after such a trajectory is found.

The task is **open**. Published scores answer related but different questions. The scone EXP_QC_COR ratio measures how much expression variation quality components explain, and ranks normalisations [R3]. The pipeComp covariate correlation measures per-gene association with depth inside clusters [R4]. The scib principal-component regression was built for batch covariates [R5]. The best-practices chapter reports that a pipeComp comparison found analytic Pearson residuals removed sampling effects while preserving heterogeneity [R6, R4]. Detection-rate regression rests on a talk-summary claim that detected-gene share explains much variability and varies by batch [R7]. No benchmark of such a diagnostic is known from the sources cited here; the benchmarks above score normalisations, not diagnostics.

Open problems:

- **Calibration.** A component score has a closed-form null only for fixed covariates and Gaussian residuals, and components are chosen on the same data, so thresholds do not transfer between datasets.
- **Biology versus technology.** Cell size and RNA content vary within a cell type, so within-stratum depth association can be biological. Separating measurement and expression models [R8] places depth in the measurement model, but its biological part cannot be separated from it without strata.
- **Collinearity and saturation.** Log total counts and log detected-gene count are strongly related, and detection saturates at high depth, so per-covariate attributions are unstable without partial R-squared.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $L_c$, $D_c$ | total raw counts and detected-gene count of cell $c$, from `counts_layer` |
| $\tilde d_c$, $\tilde r_c$ | depth and detection covariates $\log L_c$ and $\log D_c$, centred within stratum |
| $\mathbf Z$, $H$ | stacked centred covariates ($n\times p$) and $H=\mathbf Z(\mathbf Z^\top\mathbf Z)^{-1}\mathbf Z^\top$ |
| $\mathbf U_k$, $\lambda_k$ | centred scores of component $k$ of the matrix under test, and their variance |
| $t_c$ | planted depth factor in simulation, normalised to geometric mean 1 |
| $\pi_g$, $\alpha_g$ | expected proportion and negative-binomial dispersion of gene $g$ |

**Estimands.** For component $k$, $R^2_k$ is the share of the within-stratum variance of its scores that a linear function of the centred covariates explains. $S_{\mathrm{depth}}$ is the variance-weighted mean of $\max(0,R^2_k)$ over the $K$ components computed, so its value depends on $K$. For gene $g$, $R^2_g$ is the same share for its centred values. The elasticity $\beta_{g1}$ is the log-log slope of the expected count per unit size factor against total raw counts within strata, dimensionless. In simulation the truth is the planted $t_c$ on the geometric-mean-one scale, and a depth-free normalisation should give zero dependence of its output on $\log t_c$ within strata. In mixtures the truth is the mixing class, categorical and unscaled. $R^2$ and $S_{\mathrm{depth}}$ are unchanged when the matrix is multiplied by a constant.

For components, with $\mathbf Z$ the stacked within-stratum centred covariates and $\mathbf U_k$ the centred scores,

$$R^2_k = 1-\frac{\lVert (I-H)\,\mathbf U_k\rVert^2}{\lVert \mathbf U_k\rVert^2},\qquad S_{\mathrm{depth}}=\sum_{k=1}^{K}\frac{\lambda_k}{\sum_{j=1}^{K}\lambda_j}\,\max(0,R^2_k).$$

Regime: linear association and $n$ much larger than $p$.

**Null.** With $p$ covariates and $S$ strata, the null of no association gives $R^2_k\sim\mathrm{Beta}\!\left(\tfrac p2,\tfrac{n-S-p}{2}\right)$ and $\mathbb E[R^2_k]=p/(n-S)$, which is the familiar $p/(n-1)$ for one stratum. The derivation needs fixed covariates and Gaussian residuals. Components maximise variance on the same matrix, so the top components have inflated $R^2$ under the null. A calibrated null therefore permutes depth and detection jointly within strata, which keeps the stratum structure and the covariate distribution; $S_{\mathrm{depth}}$ then has permutation p-value $(1+\#\{S^{\mathrm{perm}}\ge S^{\mathrm{obs}}\})/(P+1)$. Per gene, the same ratio with an $F$ test on $p$ and $n-S-p$ degrees of freedom gives the Gaussian p-value.

**Gene test.** For gene $g$ with stratum effects $\gamma_{g,s}$,

$$y_{gc}\sim\mathrm{NB}(\mu_{gc},\alpha_g),\qquad \log\mu_{gc}=o_c+\gamma_{g,s(c)}+\boldsymbol\beta_g^{\top}\mathbf z_c,$$

where $o_c$ is the offset, $\log\hat s_c$ from the normalisation under test or $\log L_c$, and $\mathbf z_c$ holds the centred covariates, spline-expanded if requested. The likelihood-ratio statistic for $\boldsymbol\beta_g=0$ is asymptotically $\chi^2_p$, valid for large per-gene counts. If the offset omits depth and expression is a fixed proportion of depth, $\beta_{g1}=1$; a correct offset gives $\beta_{g1}=0$ for depth-free genes.

**Detection link.** Under Poisson sampling, $\Pr(y_{gc}>0)=1-e^{-s_c\pi_g}$ and the expected detected-gene count is $\mathbb E[D_c]=\sum_g(1-e^{-s_c\pi_g})$. For $s_c\pi_g\ll1$ this is roughly linear in depth, and for highly expressed genes it saturates. A linear term in $\tilde r_c$ therefore under-describes the relation at high depth, and $\tilde d_c$ and $\tilde r_c$ are partly redundant.

**Variance link.** For Poisson counts with mean $\mu_{gc}=s_c\rho_g$, the first-order delta method gives

$$\operatorname{Var}\!\left[\log\!\left(\tfrac{Y_{gc}}{s_c}+y_0\right)\right]\approx\frac{\rho_g}{s_c(\rho_g+y_0)^2},$$

so the variance of log-normalised values falls roughly as $1/s_c$. Shallow cells are noisier, and PCA can rank depth-structured noise among the leading components even when expression is unrelated to depth. Regime: first order, moderate $\mu_{gc}$, no overdispersion. The mean-of-logs non-linearity identified by [R2] is a related effect with a different derivation.

**Assumptions and failure modes.** Covariates come from raw counts before any normalisation; association is linear in the covariates or spline-expanded; strata are known or estimable. Violations cause five failures: biological depth within a stratum (cell size, activation) reads as technical; strata or clusters defined from depth-driven components remove or manufacture the signal; depth recomputed from normalised values hides residual dependence; batch-specific depth distributions create between-batch differences that look global; and zero-variance genes in a stratum give undefined correlations. Thresholds on $S_{\mathrm{depth}}$ also do not transfer across $n$ and $K$.

**Heuristics and what a model adds.** The published scores need no fitted model and remain the comparators. They have no null for the score, clip negative $R^2$ at zero (which biases the mean upward at small $n$), and weight components by variance over the $K$ computed. The gene test adds a likelihood-ratio statistic per gene, an elasticity with a standard error, and an offset that tests the normalisation's own size factor. Its calibration depends on the negative-binomial variance: overdispersion is absorbed by $\alpha_g$, and misspecified dispersion changes the null.

**Necessary, not sufficient.** Depth association is necessary but not sufficient evidence of a technical artefact, because cell size and RNA content are biological and correlate with total counts. Stratification separates the two only as far as strata are biologically homogeneous, since cell size still varies within a cell type. A flag therefore prompts inspection of the flagged genes and components; a depth-free normalisation should clear it, but the flag does not by itself establish technical origin.

**Pitfall shown by benchmarks.** Downsampling removes the trajectories in the OSCA data, but the chapter calls it statistically inefficient, so it is a check on a normalisation rather than a normalisation [R2].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scib principal-component regression | heuristic | variance-weighted $R^2$ of components on a covariate; negative values clipped at zero | [R5] |
| scone EXP_QC_COR | heuristic | $R^2$ of expression PC projections on quality PCs, pooled over cells; when stratified, a size-weighted average over biology-by-batch strata | [R3] |
| pipeComp `evaluateNorm` | heuristic | per-gene correlation with depth covariates within each cluster; mean absolute correlation over clusters | [R4] |
| sctransform | model-based | per-gene regularised negative-binomial regression on log UMI count; Pearson residuals | [R9], [R10] |
| Analytic Pearson residuals | model-based | closed-form residuals of a depth-offset negative-binomial model at fixed $\theta$ | [R11] |
| scry multinomial null residuals | model-based | deviance or Pearson residuals under an approximate multinomial null that gives each feature a constant rate; documented for un-normalised counts | [R12] |
| scVI observed library size | model-based | negative-binomial or zero-inflated variational model with the observed total as offset by default | [R13] |

The heuristic scores are the published standard for covariate association and are kept as comparators. Analytic residuals and sctransform are model-based normalisations that this diagnostic examines, not competing diagnostics. scry and scVI are model-based references for residual depth and latent offsets. Detection-rate regression [R7] is not tabulated; section 10 gives the reason.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| scib PCR | `pcr_comparison` `linreg_method` | `numpy` | scib/metrics/pcr.py:15 @cd67913 |
| scib PCR | `pc_regression` `n_comps` | 50 | scib/metrics/pcr.py:200 @cd67913 |
| scib PCR | `pc_regression` `linreg_method` | `sklearn` | scib/metrics/pcr.py:202 @cd67913 |
| scib PCR | negative $R^2$ | clipped at 0 | scib/metrics/pcr.py:292 @cd67913 |
| scib PCR | component weights | variance over the computed components | scib/metrics/pcr.py:294 @cd67913 |
| scone | `k_qc` | 5 | R/scone_main.R:171 @120e114 |
| scone | `eval_pcs` | 3 | R/scone_main.R:174 @120e114 |
| scone | quality components | `prcomp(qc, center=TRUE, scale=TRUE)$x` | R/scone_main.R:291 @120e114 |
| pipeComp | `evaluateNorm` covariates | `log10_total_counts`, `total_features` | R/scrna_evaluationFunctions.R:542 @a3fd419 |
| pipeComp | `evaluateDimRed` dimensions | 10, 20, 50 | R/scrna_evaluationFunctions.R:164 @a3fd419 |
| scry | `nullResiduals` `type` | `deviance`, `pearson` | R/nullResiduals.R:172 @1375237 |
| scry | `size_factors` | NULL | R/nullResiduals.R:44 @1375237 |
| sctransform | `latent_var` | `log_umi` | R/vst.R:111 @49e35b5 |
| sctransform | `n_genes`, `min_cells` | 2000, 5 | R/vst.R:114, 121 @49e35b5 |
| sctransform | `method`, `theta_regularization` | `poisson`, `od_factor` | R/vst.R:116, 118 @49e35b5 |
| analytic residuals | `theta` | 100 | scanpy src/scanpy/experimental/pp/_normalization.py:95 @8ed52d9 |
| scVI | `dispersion`, `gene_likelihood` | `gene`, `zinb` | scvi-tools src/scvi/module/_vae.py:158, 160 @5555ecc |
| scVI | `use_observed_lib_size` | True | scvi-tools src/scvi/module/_vae.py:168 @5555ecc |

## 5. Proposed singlet approach

**Routes.** `pc_r2` **ports** the component weighting and clipping of scib (permissive; section 12); its within-stratum projection is new. `pipecomp_gene_cor` is **reimplemented** from pipeComp (copyleft; section 12). `nb_lrt` is a **new design**; its negative-binomial fitting is written from the model, not copied from sctransform. The scone, scry, sctransform, analytic-residual, scVI and scuttle implementations are **callouts**, used only as comparators in section 8.

**Defaults.** `method` is `pc_r2` with 50 components and a 1000-draw permutation null within strata. `stratify_by` should be set whenever cell-type or batch labels exist, because an unstratified score mostly measures biology. `nb_lrt` is the model-based option; it becomes the default only if the B2 criteria in section 8 are met, and until then it is the comparator. `pipecomp_gene_cor` takes no options.

**Model-based formulation.** `nb_lrt` fits the gene model of section 3 for every gene, with the normalisation's size factor as offset. Gene-level likelihood-ratio tests with Benjamini–Hochberg control give `var/depth_flag`, and deviance explained gives `var/depth_r2`. The estimand is the elasticity $\beta_{g1}$. It is a new design that builds on the depth-offset likelihood of sctransform [R9]. The test is falsified by the B2 criteria in section 8.

**Stack and kernels.** The diagnostic has no trained weights, so PyTorch is not used. The hot kernels are hard-coded: cuBLAS GEMM for component projections (the projection needs only $(\mathbf Z^\top\mathbf Z)^{-1}$, which is $p\times p$, so each permutation costs one small GEMM); batched iteratively reweighted least squares with $(S+p)\times(S+p)$ normal equations per gene for `nb_lrt`, $S$ being the number of strata; and cuSPARSE products for sparse inputs and stratum sums. On CPU, sparse row chunks give the covariates and gene column chunks give the fits. Component scores come from `obsm/X_pca` when present. For catalogue-scale inputs of 354M cells, $\mathbf Z^\top\mathbf Z$ and $\mathbf Z^\top\mathbf U_k$ are accumulated in chunks after a first sweep over the cells for stratum means, which is exact because centring is linear within strata.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw counts; source of depth and detection covariates |
| read | layers/<normalized_layer> | float | matrix under test (default X) |
| read | obs/size_factor | float | `nb_lrt` offset; when absent, log library size is used |
| read | obs/<stratify_by> | categorical | strata for within-stratum centring |
| write | var/depth_r2 | float32 | per gene: $R^2$ (`pc_r2`, `nb_lrt`) or, for `pipecomp_gene_cor`, the mean absolute correlation over clusters (pipeComp's statistic, not an R²) |
| write | var/depth_flag | bool | `nb_lrt` only: gene flagged at the Benjamini–Hochberg threshold |
| write | uns/depth_diagnostic/pc_r2 | float32 vector | within-stratum $R^2$ per component |
| write | uns/depth_diagnostic/score | float | $S_{\mathrm{depth}}$ with its permutation p-value |
| write | uns/depth_diagnostic/params | dict | parameters, seed and null used |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `counts_layer` | string | "counts" | — | Raw count layer from which depth and detection covariates are computed. |
| `normalized_layer` | string | "X" | — | Normalised matrix to diagnose: X or the name of a layer. |
| `method` | string | "pc_r2" | `pc_r2`, `nb_lrt`, `pipecomp_gene_cor` | pc_r2: stratified PC R-squared for any matrix; nb_lrt: per-gene negative-binomial test on counts; pipecomp_gene_cor: pipeComp-style per-gene correlation. |
| `stratify_by` | string/null | null | — | obs column defining strata, for example cell type; null treats all cells as one stratum. |
| `pc_r2` | object | — | — | Options for method pc_r2. |
| `pc_r2.n_pcs` | integer | 50 | min 2; max 200 | Number of principal components of the matrix under test to evaluate. |
| `pc_r2.null_method` | string | "permutation" | `beta`, `permutation` | beta: closed-form null; permutation: depth and detection shuffled within strata, calibrated. |
| `pc_r2.n_permutations` | integer | 1000 | min 10 | Permutation draws for the within-stratum null. |
| `nb_lrt` | object | — | — | Options for method nb_lrt. |
| `nb_lrt.spline_df` | integer | 1 | min 1; max 6 | Spline basis columns per covariate; 1 means linear. |
| `nb_lrt.null_method` | string | "chi_square" | `chi_square`, `permutation` | chi_square: asymptotic likelihood-ratio test; permutation: within-stratum shuffles. |
| `nb_lrt.n_permutations` | integer | 100 | min 10 | Permutation draws, used only when null_method is permutation. |
| `nb_lrt.fdr_threshold` | number | 0.05 | > 0; < 1 | Benjamini-Hochberg threshold for flagging depth-associated genes. |
| `nb_lrt.min_cells_per_gene` | integer | 10 | min 1 | Minimum detected cells for a gene to be tested. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for permutation nulls; a fixed seed gives identical results. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Options are nested by method: `pc_r2.*` applies to any matrix or embedding, `nb_lrt.*` only when raw counts are available, and `pipecomp_gene_cor` takes no options. `stratify_by` applies to every method; without strata, biology between cell types is scored as depth. `null_method` set to `permutation` draws depth and detection jointly within strata with `seed` and is the calibrated choice; `chi_square` is valid only for large per-gene counts. A `spline_df` above 1 multiplies the covariate count, so $p$ and the degrees of freedom change. Set `min_cells_per_gene` to avoid undefined correlations and unstable fits.

## 7. MCP tool

Tool name `singlet_normalization_depth_confounding_diagnostic` (definition in `tasks/mcp/singlet_normalization_depth_confounding_diagnostic.json`).

```json
{"dataset": "/data/example.singlet", "normalized_layer": "lognorm", "stratify_by": "cell_type", "method": "pc_r2", "pc_r2": {"n_pcs": 50}}
```

```json
{"dataset": "/data/example.singlet", "status": "completed",
 "wrote": ["var/depth_r2", "uns/depth_diagnostic/pc_r2", "uns/depth_diagnostic/score", "uns/depth_diagnostic/params"],
 "summary": {"method": "pc_r2", "n_strata": "<int>", "score": "<float in 0 to 1>", "n_components": 50,
   "null_method": "permutation", "n_permutations": 1000, "p_value": "<float>"},
 "provenance_id": "<string>"}
```

Long-running: yes on large inputs and for `nb_lrt` with permutations, which may queue a job. Stochastic: yes, for permutation nulls, fixed by `seed`. Dry run: returns seconds, peak memory in GB and device for the chosen method.

## 8. Benchmarks

**Shared protocol.** Every method receives the same raw counts, strata and gene filter (`min_cells_per_gene`). Depth and detection covariates are computed from raw counts only, so only the matrix under test changes between normalisations. $S_{\mathrm{depth}}$ uses $K=10$ components in B1 and $K=50$ in B2 and P1. Permutation nulls use 1000 draws with seeds 0 to 4 (proposed). Arms are reported separately. Thresholds marked proposed are singlet's, not from the literature.

### B1. Pool-and-split mixtures (CellBench), proposed analysis

- **Goal**: whether the diagnostic flags library-size structure that normalisation should remove, while mixing-class structure survives.
- **Ground truth**: design label. Each library carries a mixing class from the experimental design, categorical and unscaled; library size is measured from counts, not planted.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellBench SORT-seq pool-and-split libraries (`mRNAmix_qc`) | [R14]; CellBench_data repository as loaded in [R2] | RNA mixtures, —, — | see section 12 | one dataset |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| $S_{\mathrm{depth}}$ ($K=10$) | diagnostic score of the matrix under test, stratified by mixing class | lower | primary | proposed |
| Mixing-class accuracy | five-fold 10-nearest-neighbour accuracy on the top 10 components | higher | guardrail | proposed |

- **Comparators** (normalisations): log-normalised with library-size factors, `pooled` deconvolution [R15], analytic Pearson residuals [R11] and sctransform residuals [R9]; `nb_lrt` on counts with each offset.
- **Protocol**: normalise each way; fix the gene set; compute components on the matrix under test; score within mixing class with 1000 permutations; repeat accuracy over 20 fold assignments. Downsampling as in [R2] is an internal consistency check, not a comparator.
- **Acceptance criterion**: proposed. The log-normalised matrix is flagged (permutation p below 0.05). The best depth-free normalisation lowers $S_{\mathrm{depth}}$ by at least 50% relative to the log-normalised value, with accuracy within 0.02 of the best comparator.
- **Known pitfalls**: the mixing class may correlate with depth through the pooling design, so stratifying by it can hide the signal; one dataset only.

### B2. Planted depth and differential expression (proposed)

- **Goal**: recover planted depth with and without true differential expression.
- **Ground truth**: planted simulation; depth truth $t_c$ normalised to geometric mean 1 over cells; perturbed genes known. The planted elasticity is 1 without an offset and 0 with the oracle offset $\log t_c$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Negative-binomial counts from the generator below | proposed; simulation context from [R16] | simulated; 5,000 genes; two groups of 1,000 cells | — | no real data |

- **Generator**:
  1. Base profiles $q_g$ from a gamma distribution with shape 0.5, normalised to sum 1 (proposed).
  2. Group B differs from group A: a random 5% of genes have $\phi_g=2$ and the rest have $\phi_g=1$.
  3. $t_c=\exp(\sigma z_c)$ with $z_c\sim\mathcal N(0,1)$ and $\sigma\in\{0,0.25,0.5,0.75,1\}$, normalised to geometric mean 1.
  4. $Y_{gc}\sim\mathrm{NB}(L\,t_c\,\pi_{gc},\alpha_g)$ with $\pi_{gc}=q_g\phi_{gc}/\sum_{g'}q_{g'}\phi_{g'c}$, $L=3000$ and $\alpha_g=0.1$ (proposed).
  5. Arms: with and without the step-2 perturbation, each with seeds 0 to 4.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Dose-response | Spearman of $\sigma$ with $S_{\mathrm{depth}}$ over five levels, library-size log counts | higher | primary | proposed |
| Residual score | $S_{\mathrm{depth}}$ on analytic Pearson residuals at $\sigma=1$ | lower | primary | proposed |
| Null false-positive rate | fraction of genes with p below 0.05 under oracle offset, no perturbation, $\sigma=1$ | nominal 0.05 | guardrail | proposed |
| Depth recall | fraction of genes at BH q below 0.05 without offset, $\sigma\ge0.5$ | higher | guardrail | proposed |

- **Comparators**: `pc_r2`, `pipecomp_gene_cor` and `nb_lrt` on their applicable matrices; normalisations are library size, the `pooled` offset [R15] and analytic residuals [R11].
- **Protocol**: $K=50$; 1000 permutations for `pc_r2`, 100 for `nb_lrt`; no gene selection.
- **Acceptance criterion**: proposed. Dose-response at least 0.9; residual score below 0.01; null false-positive rate at most 0.07; depth recall at least 0.8.
- **Known pitfalls**: the only composition shift is the planted set, so composition bias is untested (section 10); planted depth changes mean and noise together.

### B3. Binomial thinning of mixture libraries (proposed)

- **Goal**: the score should respond monotonically to a known loss of depth in real libraries with known composition.
- **Ground truth**: planted depth on real data. Each thinning level keeps a fraction $r$ of every cell's raw counts by binomial sampling, with $r\in\{1,0.8,0.6,0.4,0.2,0.1\}$ (proposed); the mixing class is the composition label.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellBench SORT-seq libraries of B1, thinned | as B1 | as B1 | see section 12 | same dataset as B1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Thinning response | Spearman correlation between $\log r$ and $S_{\mathrm{depth}}$ over the six levels, on log-normalised counts | closer to $-1$ | primary | proposed |
| Residual response | the same correlation on analytic Pearson residuals | closer to 0 | primary | proposed |
| Mixing-class accuracy | as B1 | higher | guardrail | proposed |

- **Comparators**: the normalisations of B1.
- **Protocol**: thin raw counts after the B1 filters and before any normalisation; recompute the stratified score and accuracy for each normalisation with 1000 permutations and seeds 0 to 4.
- **Acceptance criterion**: proposed. Absolute Spearman correlation at least 0.9 for the log-normalised matrix and at most 0.2 for the residual matrix.
- **Known pitfalls**: thinning changes noise as well as depth, so the response is depth loss plus added variance; thinning must follow any count-based filter.

### P1. Performance and scaling

Wall time, peak memory and throughput at $10^4$, $10^5$ and $10^6$ cells with 20,000 genes and $K=50$, on CPU and CUDA, with PCA timed separately from the diagnostic. Hold fixed: $p=2$, float32, thread count and precomputed components. Comparators: scib `pc_regression` with its numpy and sklearn back ends [R5], the per-stratum and per-component `lm()` loop of scone's EXP_QC_COR [R3], and pipeComp's per-cluster correlations [R4]. Catalogue-scale chunked timings (354M cells) are reported separately. Acceptance criterion (proposed): `pc_r2` is at least 10 times faster than the scone loop at $10^5$ cells on identical inputs.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
- **Feeds**:
  - `normalization.normalization_pipeline_selection`: Data-driven normalization pipeline selection
  - `normalization.count_noise_model_selection`: Count noise-model selection and zero-inflation diagnosis
  - `covariate-adjustment.covariate_variance_attribution`: Covariate variance attribution and confounding check before removal
- **Reads**: `layers/counts`, `layers/<normalized_layer>`, `obs/size_factor`, `obs/<stratify_by>`
- **Writes**: `var/depth_r2`, `var/depth_flag`, `uns/depth_diagnostic/pc_r2`, `uns/depth_diagnostic/score`, `uns/depth_diagnostic/params`
<!-- CHAINING:AUTO:END -->

Part of the normalisation recipe: size factors, then transformation, then this check, then pipeline selection.

## 10. Risks, pitfalls and open questions

- **Benchmarks not replayed.** The Cole et al. validation datasets and the Germain et al. benchmark datasets and quantitative results were not read, so the scone and pipeComp rankings are not reproduced here. The pipeComp finding on analytic residuals is taken from the best-practices normalisation notebook [R6], not from the paper [R4]. References R3 and R15 match the corpus by DOI and title only.
- **Detection-rate reanalysis.** The quantitative detection-rate claim and its five-study count come from a talk summary [R7]; detection-rate regression is therefore not proposed as a method.
- **Negative-control attribution.** The catalogue entry lists negative-control variance checks under [R12]. The scry source documents deviance residuals under a multinomial null for un-normalised counts, so no negative-control variant is proposed.
- **Repository identity.** The catalogue entry gives github.com/bioc/pipeComp, whereas the upstream repository used here is github.com/plger/pipeComp.
- **CellBench size.** The dataset size was not read; B1 leaves it as a dash. The data licence is in section 12.
- **First experiment.** Compute `pc_r2` with `stratify_by` set to the mixing class on B1 for the log-normalised and library-size-offset matrices, then check whether the flag clears under analytic residuals; then the B2 $\sigma$ grid with and without offset.

## 11. References

R1. Vallejos CA, Risso D, Scialdone A, Dudoit S, Marioni JC. Normalizing single-cell RNA sequencing data: challenges and opportunities. *Nature Methods* 2017. doi:10.1038/nmeth.4292 — verified (corpus)

R2. Amezquita R, Lun A, Hicks S, Gottardo R, et al. Normalization, redux. *Orchestrating Single-Cell Analysis with Bioconductor*, online book (chapter `inst/book/more-norm.Rmd` of OSCA-source/OSCA.advanced). https://bioconductor.org/books/release/OSCA/ — verified (corpus)

R3. Cole MB, Risso D, Wagner A, DeTomaso D, Ngai J, Purdom E, Dudoit S, Yosef N. Performance assessment and selection of normalization procedures for single-cell RNA-seq. *Cell Systems* 2019. doi:10.1016/j.cels.2019.03.010 — partial (corpus)

R4. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)

R5. Luecken MD, Büttner M, Chaichoompu K, Danese A, Interlandi M, Mueller MF, Strobl DC, Zappia L, Dugas M, Colomé-Tatché M, Theis FJ. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)

R6. Single-cell best practices, online book, normalization chapter (`jupyter-book/preprocessing_visualization/normalization.ipynb`, section "Analytic Pearson residuals"). https://github.com/theislab/single-cell-best-practices — verified (repo)

R7. Hicks SC, Teng M, Irizarry RA. On the widespread and critical impact of systematic bias and batch effects in single-cell RNA-Seq data. *bioRxiv* preprint. doi:10.1101/025528 — verified (search)

R8. Sarkar A, Stephens M. Separating measurement and expression models clarifies confusion in single-cell RNA sequencing analysis. *Nature Genetics* 2021. doi:10.1038/s41588-021-00873-4 — verified (corpus)

R9. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019. doi:10.1186/s13059-019-1874-1 — verified (corpus)

R10. Choudhary S, Satija R. Comparison and evaluation of statistical error models for scRNA-seq. *Genome Biology* 2022;23:27. doi:10.1186/s13059-021-02584-9 — verified (search)

R11. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)

R12. Townes FW, Hicks SC, Aryee MJ, Irizarry RA. Feature selection and dimension reduction for single-cell RNA-Seq based on a multinomial model. *Genome Biology* 2019. doi:10.1186/s13059-019-1861-6 — verified (corpus)

R13. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)

R14. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)

R15. Lun ATL, Bach K, Marioni JC. Pooling across cells to normalize single-cell RNA sequencing data with many zero counts. *Genome Biology* 2016. doi:10.1186/s13059-016-0947-7 — partial (corpus)

R16. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/YosefLab/scone | Michael Cole (aut, cph); Davide Risso (aut, cre, cph); Matteo Borella (ctb); Chiara Romualdi (ctb) | Artistic-2.0 (DESCRIPTION; no LICENSE file at root) | EXP_QC_COR comparator | callout |
| https://github.com/plger/pipeComp | Pierre-Luc Germain (cre, aut); Anthony Sonrel (aut); Mark D. Robinson (aut, fnd) | GPL-3 (LICENSE file contains the GPL-3.0 text); DESCRIPTION states GPL without a version | per-gene covariate correlation | reimplement (`pipecomp_gene_cor`) |
| https://github.com/theislab/scib | Malte D. Luecken; Maren Buettner; Daniel C. Strobl; Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt) | component weighting and clipping | port (`pc_r2`) |
| https://github.com/kstreet13/scry | Kelly Street (aut, cre); F. William Townes (aut, cph); Davide Risso (aut); Stephanie Hicks (aut) | Artistic-2.0 (DESCRIPTION; no LICENSE file at root) | multinomial null residuals | callout |
| https://github.com/ChristophH/sctransform | Christoph Hafemeister (aut); Saket Choudhary (aut, cre); Rahul Satija (ctb) | GPL-3 (LICENSE file) | regularised negative-binomial model and residuals | callout |
| https://github.com/scverse/scanpy | Ilan Gold, Philipp Angerer, Severin Dicks (maintainers, pyproject.toml); further authors listed there | BSD-3-Clause (LICENSE) | analytic Pearson residuals | callout |
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml) | BSD-3-Clause (LICENSE) | observed library-size offset | callout |
| https://github.com/LTLA/scuttle | Aaron Lun (aut, cre); Davis McCarthy (aut) | GPL-3 (DESCRIPTION; no LICENSE file at root) | `pooled` offset comparator | callout |
| https://github.com/OSCA-source/OSCA.advanced | Robert Amezquita, Aaron Lun, Stephanie Hicks, Raphael Gottardo, Ludwig Geistlinger (cre), Peter Hickey (ctb) | CC BY 4.0 (DESCRIPTION) | downsampling check and CellBench loading | — |
| https://github.com/theislab/single-cell-best-practices | theislab repository maintainers | Apache-2.0 (LICENSE) | normalisation notebook summarising a pipeComp comparison [R6] | — |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian (copyright holder, LICENSE file) | MIT (LICENSE file) | B1 and B3 data (`mRNAmix_qc`) | — |
