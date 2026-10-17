---
id: markers-de.lfc_shrinkage_effect_size
title: Log fold-change shrinkage and effect-size ranking
area: markers-de
scope: extended
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [normalization.size_factor_estimation, normalization.dispersion_estimation, qc.sample_level_qc]
feeds: [markers-de.compact_marker_panel_selection, markers-de.celltype_response_prioritization, markers-de.cross_study_meta_analysis]
reads: [layers/counts, obs/<contrast_key>, obs/<donor_key>, obs/<cell_type_key>]
writes: [varm/lfc_shrunk_<contrast>, varm/lfc_se_<contrast>, varm/lfc_ci_<contrast>, varm/lfsr_<contrast>, varm/svalue_<contrast>, uns/lfc_shrink/<contrast>]
devices: [cpu, cuda]
mcp_tool: singlet_markers_de_lfc_shrinkage_effect_size
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Log fold-change shrinkage and effect-size ranking

> Shrinks donor-level pseudobulk log fold changes toward zero with an empirical-Bayes posterior and reports sign-aware error measures, so genes can be ranked by effect size with stated uncertainty.

## 1. Question

Given donor-level pseudobulk counts for one condition contrast within a cell type, which per-gene log2 fold change, uncertainty and sign-aware error measure ranks genes most accurately by their true fold change, and how much does shrinkage change that ranking for low-count genes? Inputs are raw counts with condition, donor and optional cell-type labels. Outputs are a shrunken log2 fold change with an interval, a local false sign rate (lfsr) and an s-value per gene. A correct answer lowers error against a truth defined on a stated estimand while keeping sign errors calibrated.

## 2. Why this task matters and where the field stands

Raw log fold changes are least reliable for low-count genes, where the largest estimates are dominated by noise. This winner's curse motivated empirical-Bayes shrinkage of RNA-seq fold changes [R1]. Two shrinkage families now exist for count data: heavy-tailed priors that keep large effects [R2], and adaptive mixture priors that return local false sign rates [R3]. Common single-cell tools report unshrunk log ratios of group means, with a pseudocount in Seurat [R4] or on the linear scale in scanpy [R5]. Neither has a variance model, so low-count error is uncontrolled.

The status is **contested**. Cells are not independent replicates, and treating them as replicates produces narrow standard errors and excess false discoveries [R6][R7]. The estimand also differs across tools: measurement and expression models should be separated before a true fold change is defined [R8]. Truth-based evaluation is thin. The main designs are known-ratio cell-line mixtures [R9] and planted simulations [R10]. No benchmark in the cited sources scores shrinkage estimators against known truth. Open problems are the prior shape for cell-type-specific genes, the ranking loss, and the stability of shrinkage with few donors.

## 3. Theory and insight

Let $g$ index genes, $i$ pseudobulk samples (donor, stratum and condition), $K_{gi}$ summed UMI counts, $s_i$ size factors and $\mathbf{x}_i$ design rows. Each contrast is fitted by a negative-binomial GLM:

$$K_{gi}\sim\mathrm{NB}(\mu_{gi},\alpha_g),\qquad \log\mu_{gi}=\log s_i+\mathbf{x}_i^{\top}\boldsymbol\beta_g,\qquad \mathrm{Var}(K_{gi})=\mu_{gi}+\alpha_g\mu_{gi}^2 .$$

This holds when donors are the independent units, size factors are correct and the dispersion model is well specified. *Estimand E1:* $\beta_g/\ln 2$ is the log2 ratio of expected size-factor-normalised counts, test over reference. Every count-based method starts from it.

The unshrunk estimate has standard error $\hat\sigma_g^2=[\mathbf X^{\top}W_g\mathbf X]^{-1}_{gg}$ with $W_g=\mathrm{diag}\big(\mu_{gi}/(1+\alpha_g\mu_{gi})\big)$. Its normal approximation needs large $n$ and $\mu_{gi}\gg1$. It breaks for sparse groups, near-zero counts and separation, where the MLE can be infinite.

Shrinkage replaces $\hat\beta_g$ by a shrunken summary under an across-gene prior:

- **Normal** (DESeq2 normal [R1]). With $\beta_g\sim\mathcal N(0,\tau^2)$ and $\hat\sigma_g$ treated as known, the conjugate posterior mean is $\hat\beta_g\,\tau^2/(\tau^2+\hat\sigma_g^2)$ with posterior variance $(\tau^{-2}+\hat\sigma_g^{-2})^{-1}$. DESeq2 instead maximises a Gaussian-penalised NB likelihood, so its coefficient is a MAP estimate rather than this closed form. The shrinkage factor is near 1 for precise genes and near 0 for noisy ones. $\tau$ is matched to the weighted 0.05 upper quantile of the MLEs. Normal tails shrink large true effects as strongly as small ones.
- **Cauchy** (apeglm [R2]). $\beta_{gk}\sim t_1(0,S_k)$, with $S_k$ adapted to the MLE spread. The posterior mode is reported with Laplace intervals. Heavy tails keep large effects; the intervals assume a local Gaussian posterior.
- **Mixture** (ashr [R3]). $\hat\beta_g\mid\beta_g\sim\mathcal N(\beta_g,\hat\sigma_g^2)$ and $\beta_g\sim g=\sum_k\pi_k g_k$, with each $g_k$ symmetric and unimodal about zero. $g$ is fitted across genes, $\hat\sigma_g$ is treated as known, and the posterior mean is reported.

Sign-error measures are

$$\mathrm{lfsr}_g=\min\{P(\beta_g\le0\mid\hat\beta_g),\,P(\beta_g\ge0\mid\hat\beta_g)\},\qquad s_{(k)}=\frac1k\sum_{j\le k}\mathrm{lfsr}_{(j)},$$

where the s-value is evaluated in order of increasing lfsr. Under a Gaussian posterior with mode $m$ and SD $s$, apeglm's fsr equals $\Phi(-|m|/s)$, which equals the lfsr of that posterior. Both are calibrated only when the prior family is correct. The s-value is a ranking-level average of the lfsr.

Heuristic comparators are plug-in log ratios without a posterior:

$$\mathrm{FC}_g=\log_2\frac{\sum_{i\in A}\mathrm{expm1}(x_{gi})+1}{n_A}-\log_2\frac{\sum_{i\in B}\mathrm{expm1}(x_{gi})+1}{n_B},\qquad \mathrm{lfc}_g=\log_2\frac{\mathrm{expm1}(\bar x_{gA})+10^{-9}}{\mathrm{expm1}(\bar x_{gB})+10^{-9}}.$$

Here $x$ is log1p-normalised expression. *Estimand E2* (first term) is the log2 ratio of linear-scale group means with an additive pseudocount in summed-count units, so the bias toward zero falls with group size and depends on the normalisation target. *Estimand E3* (second term) is the log2 ratio of linear-scale group means with a numerical guard and no shrinkage, so low-count genes are noisy.

Under squared-error loss the optimal summary is the posterior mean, $\hat\theta_g=\mathbb E[\beta_g\mid\hat\beta_g]$, under the assumed prior. Every output is on the log2 scale of E1. Ranking by $|\hat\theta_g|$, by lfsr or by s-value optimises different losses, so a single ranking must name its loss.

The ground-truth estimands are as follows.

- *Estimand E4 (mixtures).* For mixtures $i$ and $j$ with known RNA-mass fractions $p_{iL}$ of cell lines $L$, and pure-line RNA shares $a_{gL}$ that sum to 1 over genes, $\beta^{*}_g=\log_2\frac{\sum_L p_{iL}a_{gL}}{\sum_L p_{jL}a_{gL}}$. The normalisation is expected library share, so every method is mapped to this scale.
- *Estimand E5 (simulation).* For planted group factors $f_{g1}$ and $f_{g2}$ on the simulator's expected-mean scale, $\beta^{*}_g=\log_2(f_{g2}/f_{g1})$. Library-size scaling changes realised shares when group sizes differ, so the expected means, not the factors alone, define the truth.

Failure modes by family. Model-based: cell-type-specific genes with large, separated effects violate the unimodal-at-zero assumption and are over-shrunk by normal tails. Count-model: pseudoreplication underestimates standard errors, so every posterior built on them is overconfident. Heuristic: additive pseudocounts depend on group size and depth. Few donors: dispersion and prior scale are unstable, which can matter more than the choice of shrinkage.

Insight. Shrinkage is a bias-variance trade. It improves ranking by magnitude only when the prior describes the across-gene effect distribution. The gain holds when most true effects are small relative to their standard errors and standard errors vary across genes. It is largest for low-count genes and small for precisely measured ones. Posterior magnitude and sign confidence answer different questions and should not be merged without an explicit loss.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| DESeq2 normal | model-based | Zero-centred normal prior on NB GLM coefficients, variance matched to the MLE distribution | [R1] |
| apeglm | model-based | Adaptive Cauchy prior; posterior mode, Laplace intervals, fsr and s-values | [R2] |
| ashr | model-based | Empirical-Bayes posterior under a fitted unimodal mixture prior; posterior mean, lfsr and s-values | [R3] |
| DESeq2 MLE (`mle`) | model-based | Unshrunk NB GLM coefficient and Wald standard error | [R1] |
| MAST bayesglm | model-based | Cell-level hurdle GLM with coefficients under a Cauchy-type prior | [R11] |
| Seurat avg_log2FC | heuristic | Log2 difference of group means of expm1-normalised expression, with the pseudocount added to each group sum | [R4]; formula from code at 5f67c70 |
| scanpy logfoldchanges | heuristic | Log2 ratio of linear-scale group means, with expm1 applied to log-space means and a 1e-9 guard | [R5]; formula from code at 8ed52d9 |

The published standards are DESeq2's apeglm default for bulk counts and the unshrunk log ratios used for single cells. Only methods whose primary code was read appear in the tables and the MCP enum. limma moderated t [R12], edgeR prior counts [R13] and Bayesian count-model posteriors [R14] are cited for context and are absent from both.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| DESeq2 normal | lfcShrink type default | apeglm; normal is not the default | R/lfcShrink.R:155 @76c5f85 |
| DESeq2 normal | lfcThreshold | 0 | R/lfcShrink.R:156 @76c5f85 |
| DESeq2 normal | svalue | FALSE | R/lfcShrink.R:157 @76c5f85 |
| DESeq2 normal | prior quantile | 0.05 upper quantile, weighted | R/core.R:1609, 2437 @76c5f85 |
| DESeq2 normal | interaction designs | not supported | R/lfcShrink.R:260 @76c5f85 |
| DESeq2 ashr | ashr call (type `ashr`) | mixcompdist normal, method shrink | R/lfcShrink.R:468 @76c5f85 |
| apeglm | prior.df | 1 (Cauchy) | R/apeglm.R:219 @0abaccb |
| apeglm | prior.scale | 1 by default; with MLE supplied, multiplier (1) times prior SD, capped at 1 | R/apeglm.R:203, 218, 249-251 @0abaccb |
| apeglm | prior.no.shrink.scale | 15 | R/apeglm.R:221 @0abaccb |
| apeglm | interval.type | laplace | R/apeglm.R:197 @0abaccb |
| apeglm | interval.level | 0.95 | R/apeglm.R:198 @0abaccb |
| apeglm | fsr | pnorm(-abs(MAP), 0, SD) | R/apeglm.R:560 @0abaccb |
| apeglm | s-value | cumulative mean of sorted fsr | R/svalue.R:31-35 @0abaccb |
| ashr | mixcompdist | uniform (first option) | R/ash.R:233-237, 339 @d3c2b4e |
| ashr | method shrink | pointmass FALSE, prior uniform | R/ash.R:262 @d3c2b4e |
| ashr | lfsr | minimum of the two side probabilities, from NegativeProb and ZeroProb | R/ash.R:532-534 @d3c2b4e |
| ashr | s-value | qval.from.lfdr of lfsr (cumulative mean) | R/output.R:54-56 @d3c2b4e |
| Seurat | pseudocount.use | 1 | R/differential_expression.R:1241 @5f67c70 |
| Seurat | log mean | log((rowSums(expm1(x)) + pseudocount)/n, base) | R/differential_expression.R:1251 @5f67c70 |
| Seurat | logfc.threshold | 0.1 (FindMarkers pre-filter) | R/differential_expression.R:50 @5f67c70 |
| Seurat | test.use | wilcox | R/differential_expression.R:51 @5f67c70 |
| Seurat | min.pct | 0.01 | R/differential_expression.R:53 @5f67c70 |
| scanpy | pseudocount | 1e-9 added to expm1 means | src/scanpy/tools/_rank_genes_groups.py:734-738 @8ed52d9 |
| scanpy | reference group | rest | src/scanpy/tools/_rank_genes_groups.py:760 @8ed52d9 |
| MAST | method | bayesglm; LFC not antisymmetric when fitted separately | R/ZlmFit-logFC.R:23-24 @d46c1d1 |
| MAST | bayesglm prior | location 0, scale 2.5, df 1 (the roxygen note at line 75 says scale 2) | R/AllClasses.R:86 @d46c1d1 |
| Splatter (B2) | de.prob, de.facLoc, de.facScale | 0.1, 0.1, 0.4 | R/AllClasses.R:258, 260, 261 @eeb1dfc |
| Splatter (B2) | truth factors | rowData DEFacGroup columns hold the factors that multiply expected means | R/splat-simulate.R:510-511 @eeb1dfc |

## 5. Proposed singlet approach

Routes are set per source in section 12.

Pipeline. Cells are streamed into pseudobulk sums per donor, stratum and condition; samples failing the filters are dropped; a batched NB GLM is fitted per gene, using the upstream dispersion when supplied; the chosen method is applied and written.

Proposed model. Singlet's candidate is an ashr-type grid prior $g$ per cell type, fitted by EM or mixSQP across catalogue studies, giving a posterior mean, lfsr and s-value per gene from the NB fit. Catalogue data supply the prior but no truth, so calibration is tested only on B1 and B2. The grid prior joins the MCP enum only after implementation and benchmarking. *Falsification:* it is rejected if its lowest-quartile MAE on B1 or B2 is not at least 10% below the MLE, if its B1 sign error at lfsr at most 0.05 exceeds 0.07, or if its B2 wrong-sign fraction exceeds $a+0.02$ at any threshold $a\in\{0.01,0.05,0.10\}$.

Default. apeglm, DESeq2's default, whose heavy-tailed prior keeps large effects. It stays the default unless the grid prior passes both B1 and B2.

ML stack. The NB fit and posteriors are many small per-gene problems with few coefficients, so they are hard-coded in CUDA: batched IRLS, per-gene Newton for the apeglm mode and grid EM, with cuSPARSE for pseudobulk aggregation. PyTorch is used only if an amortised prior network beats the grid prior on B1 and B2 calibration.

Core kernels. Sparse segment sums, batched NB IRLS, per-gene Newton, grid EM, sorting for s-values.

CPU, CUDA and streaming. Aggregation streams cells in chunks, so memory does not grow with cell count; fits act on genes by pseudobulk samples; CUDA batches genes.

Defaults an agent uses without asking are the section 6 values, with log2 output and test over reference.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts summed into pseudobulk samples |
| read | obs/<contrast_key> | categorical | condition labels for test and reference levels |
| read | obs/<donor_key> | categorical | biological replicate identifiers; required |
| read | obs/<cell_type_key> | categorical | optional strata for per-cell-type contrasts |
| write | varm/lfc_shrunk_<contrast> | float32 per gene | shrunken log2 fold change |
| write | varm/lfc_se_<contrast> | float32 per gene | posterior or Wald standard error |
| write | varm/lfc_ci_<contrast> | float32 per gene, 2 columns | interval bounds at `ci_level` |
| write | varm/lfsr_<contrast> | float32 per gene | local false sign rate; apeglm and ashr only |
| write | varm/svalue_<contrast> | float32 per gene | cumulative mean of lfsr; apeglm and ashr only |
| write | uns/lfc_shrink/<contrast> | dict | method, prior summary, parameters, filter counts |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "counts" | — | Raw count layer summed into pseudobulk samples. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing LFC output members for this contrast instead of failing. |
| `method` | string | "apeglm" | `apeglm`, `normal`, `ashr`, `mle`, `seurat_avg_log2fc`, `scanpy_logfc` | Shrinkage method. apeglm is the default; seurat and scanpy methods are unshrunk comparators. |
| `contrast` | object | required | — | Test level compared with a reference level, optionally within strata. |
| `contrast.column` | string | — | — | obs column holding condition labels. |
| `contrast.test` | string | — | — | Level whose expression is compared with the reference. |
| `contrast.reference` | string | — | — | Denominator level of the log fold change. |
| `contrast.donor_column` | string | — | — | obs column with biological replicate (donor) identifiers. |
| `contrast.cell_type_column` | string/null | null | — | obs column defining strata; null pools all cells. |
| `filters` | object | — | — |  |
| `filters.min_cells` | integer | 10 | min 1 | Minimum cells per pseudobulk sample. |
| `filters.min_umis` | integer | 1000 | min 1 | Minimum total UMIs per pseudobulk sample. |
| `filters.min_gene_umis` | integer | 10 | min 0 | Genes with fewer total UMIs across samples are not ranked. |
| `outputs` | object | — | — |  |
| `outputs.ci_level` | number | 0.95 | max 1; > 0 | Coverage of the reported intervals. |
| `outputs.svalue` | boolean | true | — | Compute lfsr and s-values; applies to apeglm and ashr only. |
| `apeglm` | object | — | — |  |
| `apeglm.prior_scale` | number/null | null | — | Cauchy prior scale; null adapts it to the MLE spread, capped at 1. |
| `apeglm.interval_type` | string | "laplace" | `laplace`, `HPD`, `credible` | Interval construction for the apeglm posterior. |
| `ashr` | object | — | — |  |
| `ashr.mixcompdist` | string | "normal" | `normal`, `uniform` | Mixture component family; normal matches the DESeq2 call. |
| `seurat` | object | — | — |  |
| `seurat.pseudocount` | number | 1 | min 0 | Pseudocount added to group sums of normalised counts. |
<!-- PARAMS:AUTO:END -->

Donor replicates are required: a contrast without a donor column is refused rather than fitted on cells. Filters apply to every method. Prior settings apply to apeglm only, `mixcompdist` to ashr only, and `pseudocount` to Seurat only. `svalue` applies to apeglm and ashr, the only methods with posterior sign probabilities; normal, mle, Seurat and scanpy write no sign-error measures. Each contrast writes its own member set, and strata are fitted separately.

## 7. MCP tool

Tool name `singlet_markers_de_lfc_shrinkage_effect_size` (definition in `tasks/mcp/singlet_markers_de_lfc_shrinkage_effect_size.json`). Example call:

```json
{"dataset": "<dataset handle>",
 "contrast": {"column": "<condition>", "test": "<level>", "reference": "<level>", "donor_column": "<donor>"},
 "method": "apeglm"}
```

Example result:

```json
{"dataset": "<dataset handle>", "status": "completed",
 "wrote": ["varm/lfc_shrunk_<contrast>", "varm/lfc_se_<contrast>", "varm/lfc_ci_<contrast>", "varm/lfsr_<contrast>", "varm/svalue_<contrast>", "uns/lfc_shrink/<contrast>"],
 "summary": {"method": "apeglm", "n_pseudobulk_samples": "<int>", "n_genes_ranked": "<int>", "prior_scale": "<float>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

- **Long-running**: no for one contrast, which runs inline; several contrasts can be queued.
- **Stochastic**: no; the output is determined by the data and method.
- **Dry run**: reports sample and gene counts, device and an estimate from the analytic cost model in section 8 (P1), not a measured timing.

## 8. Benchmarks

Shared protocol. Samples are donor-level pseudobulk sums per donor, stratum and condition, filtered as in section 5 unless a benchmark states otherwise. Contrast direction is fixed as test over reference for every method, because MAST's bayesglm estimates are not antisymmetric when the two directions are fitted separately. All estimates are mapped to log2 on the estimand of section 3. Expression quartiles are computed from each benchmark's own mean normalised expression before fitting, and stratify every accuracy metric. Metrics use the first 20 seeds (proposed), reported as mean and spread. The MLE is the reference comparator in every benchmark.

### B1. Known-ratio cell-line mixtures (extended)

- **Goal**: recover known between-mixture log2 fold changes and check sign calibration.
- **Ground truth**: orthogonal measurement; $\beta^{*}_g$ is E4, with pure-line shares from cell-line-labelled single cells, never from test libraries [R9].
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| RNA mixtures (`mRNAmix_qc.RData`) | [R9]; LuyiTian/CellBench_data; GEO GSE118767 | bulk RNA mixtures at 3.75 to 30 pg input; human; three lines; seven proportions; CEL-seq2 and SORT-seq | see section 12 | primary; RNA-mass truth |
| Nine-cell wells (`9cellmix_qc.RData`) | [R9]; same repository | nine-cell wells of the three lines; composition label per cell | see section 12 | secondary; assumes equal RNA per cell |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| MAE_q | mean absolute difference from E4 over genes in each expression quartile | minimise | primary | [R9] |
| Spearman | rank correlation with E4 over filtered genes; average ranks for ties | maximise | primary | [R9] |
| Top-K overlap | overlap of top-K genes by absolute value, divided by K = 100 (proposed) | maximise | primary | [R2] |
| Coverage95 | fraction of genes with E4 inside the 95% interval | 0.93 to 0.97 | guardrail | [R2] |
| Sign error | fraction of genes at lfsr at most 0.05 whose sign disagrees with E4 | minimise; nominal 0.05 | guardrail | [R3] |

- **Comparators**: MLE; DESeq2 normal, apeglm, ashr; Seurat and scanpy (MAE and Spearman only); MAST bayesglm on cells.
- **Protocol**: each RNA-mixture library is one technical sample: minimum-cell filter 1, UMI filter kept. Contrasts are all pairs of mixtures with different proportions (proposed); 20 seeds (proposed) thin UMIs to a common depth.
- **Acceptance criterion**: proposed. The best shrinkage method lowers lowest-quartile MAE by at least 10% relative to the MLE; top-quartile Spearman drops by at most 0.01; Coverage95 lies in 0.93 to 0.97; sign error is at most 0.07.
- **Known pitfalls**: linear mixing fails when capture efficiency differs between lines; truth is noisy for low-count genes.

### B2. Planted effects in simulated donor-level data (proposed)

- **Goal**: measure effect-size accuracy, rank quality and sign calibration against planted truth.
- **Ground truth**: planted simulation; $\beta^{*}_g$ is E5, and null genes have factor 1. Generator recipe:
  1. Splatter group model, two groups and two cell types; grids of gene count (proposed 10,000 to 20,000), `de.prob`, `de.facLoc`, `de.facScale`; the Splatter defaults in section 4 are not used.
  2. Per seed, add donor-level log-normal per-gene factors on a grid of standard deviations (proposed); mean zero on the log scale keeps E5 unchanged.
  3. Use 3, 5 or 8 donors per group (proposed).
  4. Record E5 from planted factors; null genes are 0.
  5. Pseudobulk by donor, cell type and group; fit comparators over at least 20 seeds (proposed).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter simulator | [R10]; Oshlack/splatter | simulated counts; size per recipe | see section 12 | generator only |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| MAE_q | as in B1, against E5 | minimise | primary | [R10] |
| Spearman | as in B1, against E5 | maximise | primary | [R10] |
| Top-K overlap | as in B1, K = planted DE gene count (proposed) | maximise | primary | [R2] |
| Wrong-sign excess | wrong-sign fraction minus a, among genes at lfsr at most a, for a in {0.01, 0.05, 0.10}; maximum | minimise | guardrail | [R3] |
| Coverage95 | fraction of genes with E5 inside the 95% interval | target 0.95 | guardrail | [R2] |

- **Comparators**: as in B1; MAST bayesglm on cells [R11].
- **Protocol**: grids as in the recipe; dispersion, threads and hardware fixed.
- **Acceptance criterion**: proposed. At 3 donors per group, the best shrinkage method cuts lowest-quartile MAE by at least 10% versus the MLE; each wrong-sign fraction is at most a + 0.02.
- **Known pitfalls**: a generator-matched prior favours empirical Bayes, so the grid includes shapes no single prior matches; cell-level errors give false precision, so only the MAST contrast uses cells.

### P1. Performance and scaling

Measure wall time and peak memory per contrast on CPU and CUDA, for 16, 64 and 256 pseudobulk samples (proposed), about 20,000 genes, and one or ten contrasts, against the MLE with normal, apeglm and ashr. For cell-level comparators (Seurat, scanpy, MAST), measure at 10^4, 10^5 and 10^6 cells, and at 10^7 for the streaming claim (proposed). Hold gene count, dispersion distribution, thread count and hardware class fixed. The analytic cost is $O(np^2)$ per gene and IRLS iteration for $n$ samples and $p$ coefficients, so time is predicted to grow about quadratically in $p$ and linearly in genes; the benchmark tests this. No timings or memory figures are reported here.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `normalization.dispersion_estimation`: Per-gene overdispersion estimation with shrinkage
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
- **Feeds**:
  - `markers-de.compact_marker_panel_selection`: Compact marker panel selection
  - `markers-de.celltype_response_prioritization`: Cell-type prioritisation of response to a perturbation or condition
  - `markers-de.cross_study_meta_analysis`: Cross-study meta-analysis and replication of cell-type-specific condition effects
- **Reads**: `layers/counts`, `obs/<contrast_key>`, `obs/<donor_key>`, `obs/<cell_type_key>`
- **Writes**: `varm/lfc_shrunk_<contrast>`, `varm/lfc_se_<contrast>`, `varm/lfc_ci_<contrast>`, `varm/lfsr_<contrast>`, `varm/svalue_<contrast>`, `uns/lfc_shrink/<contrast>`
<!-- CHAINING:AUTO:END -->

Workflow: condition-contrast analysis within cell types on pseudobulk, followed by effect-size ranking for marker and response prioritisation.

## 10. Risks, pitfalls and open questions

- **Secondary-summary claims.** The apeglm paper's benchmark statements (apeglm, ashr and edgeR prior counts giving the highest concordance of top-ranked genes with true fold change in 3-versus-3 simulations, and unshrunk DESeq2 showing the largest error in the largest-effect bin) come from a secondary summary; the primary text was not examined. Practitioner reports that apeglm shrinks pseudobulk genes more than ashr have no ground truth.
- **Unexamined code and text.** The limma and edgeR sources were not read, so the edgeR prior-count default is unknown here. The Tian et al. 2019 Methods text was not examined; cell lines and mixing design come from the CellBench README, and the seven proportion values are stored in the object's proportion columns.
- **Unsettled literature.** The prior shape for cell-type-specific genes is unresolved: unimodal (ashr) and single-normal (DESeq2 normal) priors may misfit, while pooling across cell types pulls effects toward a common value. The estimand choice between measurement and expression models is open [R8]. The ranking loss, and detection versus expression shrinkage for dropout-prone data, are also unresolved.
- **Few donors and missing identifiers.** With 3 to 8 donors per group, dispersion and prior scale are unstable. Donor identifiers in the catalogue are unverified, so the catalogue prior of section 5 cannot be trained until they are checked. DESeq2 normal refuses interaction designs, so it cannot serve interaction contrasts.
- **Mapping of shares to counts.** Method outputs are mapped to expected library share (E4). This equals the count-model estimand only when size factors track library size, which is untested for the RNA mixtures, where each library is one sample.
- **First experiment.** Compare the MLE, apeglm, ashr, normal, Seurat and scanpy on B1 (RNA mixtures) and B2 at 3, 5 and 8 donors per group, and apply the falsification rule in section 5 before any change to the default.

## 11. References

R1. Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. *Genome Biology* 2014. doi:10.1186/s13059-014-0550-8 — verified (corpus)
R2. Zhu A, Ibrahim JG, Love MI. Heavy-tailed prior distributions for sequence count data: removing the noise and preserving large differences. *Bioinformatics* 2018. doi:10.1093/bioinformatics/bty895 — verified (repo)
R3. Stephens M. False discovery rates: a new deal. *Biostatistics* 2016;18(2). doi:10.1093/biostatistics/kxw041 — verified (repo)
R4. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R5. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R6. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R7. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)
R8. Sarkar A, Stephens M. Separating measurement and expression models clarifies confusion in single-cell RNA sequencing analysis. *Nature Genetics* 2021. doi:10.1038/s41588-021-00873-4 — verified (corpus)
R9. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R10. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R11. Finak G, McDavid A, Yajima M, et al. MAST: a flexible statistical framework for assessing transcriptional changes and characterizing heterogeneity in single-cell RNA sequencing data. *Genome Biology* 2015. doi:10.1186/s13059-015-0844-5 — verified (corpus)
R12. Ritchie ME, Phipson B, Wu D, et al. limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 2015. doi:10.1093/nar/gkv007 — verified (corpus)
R13. Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. *Bioinformatics* 2010. doi:10.1093/bioinformatics/btp616 — verified (corpus)
R14. Kharchenko PV, Silberstein L, Scadden DT. Bayesian approach to single-cell differential expression analysis. *Nature Methods* 2014. doi:10.1038/nmeth.2967 — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/mikelove/DESeq2 | Michael I. Love (maintainer); other authors in DESCRIPTION | LGPL (>= 3) per DESCRIPTION; no LICENSE file at root | normal prior, MLE fit, defaults | reimplement |
| https://github.com/azhu513/apeglm | Anqi Zhu (author, maintainer); Joshua Zitovsky (contributor); Joseph Ibrahim and Michael Love (authors) | GPL-2 per DESCRIPTION; no LICENSE file at root | Cauchy posterior, fsr, s-values | reimplement |
| https://github.com/stephens999/ashr | Matthew Stephens (author); Peter Carbonetto (maintainer); further authors in DESCRIPTION | GPL (>= 3) per DESCRIPTION; LICENSE file is the GPL-3 text | mixture posterior, lfsr | reimplement |
| https://github.com/satijalab/seurat | Seurat authors (copyright 2021 per LICENSE) | MIT with file LICENSE | avg_log2FC formula comparator | port |
| https://github.com/theislab/scanpy | scverse (copyright 2025); F. Alexander Wolf, P. Angerer, Theis Lab (copyright 2017, per LICENSE) | BSD-3-Clause LICENSE file | logfoldchanges formula comparator | port |
| https://github.com/RGLab/MAST | Andrew McDavid (author, maintainer); other authors in DESCRIPTION | GPL (>= 2) per DESCRIPTION; no LICENSE file at root | cell-level bayesglm comparator | callout |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Alicia Oshlack (authors); Christina Azodi (contributor) | GPL-3 per DESCRIPTION; LICENSE file is the GPL-3 text | B2 generator | callout |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian (copyright holder per LICENSE) | MIT LICENSE file | B1 mixture data | callout |
