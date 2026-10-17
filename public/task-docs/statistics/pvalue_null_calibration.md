---
id: statistics.pvalue_null_calibration
title: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
area: statistics
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [markers-de.replicate_aware_condition_de, normalization.size_factor_estimation, annotation.cluster_label_assignment, simulation.reference_matched_counts]
feeds: [statistics.multiple_testing_control, sample-level.multi_sample_power_analysis]
reads: [layers/counts, obs/<donor_key>, obs/<condition_key>, obs/<cell_type_key>, obs/<batch_key>, obs/size_factor]
writes: [uns/null_calibration/summary, varm/null_pvalues_<method>, models/null_generator_<cell_type>]
devices: [cpu, cuda]
mcp_tool: singlet_statistics_pvalue_null_calibration
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Type I error and p-value calibration of single-cell tests under replicate-respecting nulls

> Measure whether a single-cell differential expression test keeps its nominal false-positive rate and uniform p-values when no condition effect exists, using nulls that treat donors (not cells) as the replicate, and report a calibration verdict for each method and cell type.

## 1. Question

When donors are the true sampling units and no condition effect exists, does a single-cell test keep its nominal false-positive rate at each level $\alpha$ and give uniform p-values, or does treating cells as replicates inflate its calls? The input is a raw count matrix with donor, condition and cell-type labels, the methods to evaluate and a null construction that keeps the donor hierarchy. The output, per method and cell type, is the empirical false-positive rate at each nominal level, p-value uniformity statistics, the rate of at least one Benjamini-Hochberg call under the complete null, and a verdict (inflated, calibrated, conservative or not assessable). Real data carry no gene-level truth, so the null is built from the data or from a simulator fitted to it with the condition effect set to zero.

## 2. Why this task matters and where the field stands

Multi-donor studies compare conditions across few donors that each contribute thousands of cells. A test that treats cells as independent replicates has an effective sample size of cells rather than donors. The best-practices chapter states that ignoring this correlation inflates the false discovery rate [R1, R2, R4, R7], and that sum-aggregated pseudobulk methods (edgeR, DESeq2, limma) and mixed models such as MAST with a random effect outperformed naive methods, namely the Wilcoxon rank-sum test and Seurat latent-variable models [R1, R7]. Soneson and Robinson benchmarked bias, robustness and scalability of single-cell differential expression methods [R3], and Das et al. survey the statistical approaches [R8].

The status is **contested**. Murphy and Skene re-examined the benchmark of Zimmerman et al. [R4] with a measure that balances type I and type II error and concluded that pseudobulk methods outperform mixed models and pseudoreplication approaches [R5]; the chapter adds that whether sum or mean aggregation works better needs further investigation [R1]. Zimmerman, Evans and Langefeld replied that pseudobulk and mixed models both account for within-sample correlation and that a two-part hurdle mixed model remains viable and controls type I error [R6].

Open problems:

1. Sum versus mean aggregation, and which test to apply to aggregated profiles [R1, R5].
2. Pseudobulk versus mixed models with a donor random effect [R5, R6].
3. Calibration with few donors, where reference distributions are asymptotic (section 10).
4. No accepted real-data null: each construction preserves a different part of the donor hierarchy (section 3.3).
5. Metric definitions: the false-positive-rate formula in a published evaluation framework counts missed differential genes (section 4, defaults table; [R10]).

## 3. Theory and insight

### 3.1 Notation

| Symbol | Meaning |
|---|---|
| $i, j, g, k, r$ | indices: cell, donor, gene, cell type, null replicate |
| $J$, $m$, $n=Jm$ | donors in the null pool (two arms of $J/2$), cells per donor (balanced), cells of one cell type; $n$ counts cells, never donors |
| $c_j\in\{0,1\}$, $\beta_1$ | pseudo-condition of donor $j$; condition effect, $H_0:\beta_1=0$ |
| $u_j$, $\tau^2$; $\varepsilon_{ij}$, $\sigma^2$ | donor random effect and its variance; cell residual and its variance |
| $\rho$, $\mathrm{DEFF}$ | donor intraclass correlation (ICC), $\tau^2/(\tau^2+\sigma^2)$; design effect of a cell-level test |
| $S_{jgk}$, $s_{jk}$, $\phi_{gk}$ | donor count sum, donor library size in cell type $k$, negative binomial dispersion |
| $\alpha$, $q$ | nominal per-test level; nominal FDR level (not a regression coefficient) |
| $B$, $p_{rg}$, $G_r$ | null replicates; p-value of gene $g$ in replicate $r$; genes tested in replicate $r$ |
| $\Theta$ | fitted generator parameters (per-gene mean, dispersion and donor ICC) |

### 3.2 Generative model and the design effect

A test is calibrated at level $a$ when $P(p\le a)=a$ for every null gene. Under a Gaussian working model on a log-normalised scale, cell $i$ of donor $j$ has expression

$$y_{ij} = \beta_0 + \beta_1 c_j + u_j + \varepsilon_{ij}, \qquad u_j \sim N(0,\tau^2), \quad \varepsilon_{ij} \sim N(0,\sigma^2), \quad \beta_1 = 0 \text{ under } H_0 .$$

Regime: balanced design, $m$ cells in each of $J$ donors, $J/2$ per arm, known variance components. The donor-level estimator of $\beta_1$ (difference of arm means of donor means) has variance $\mathrm{Var}_{\text{true}}=4(\tau^2+\sigma^2/m)/J$, which saturates at $4\tau^2/J$ as $m$ grows. A cell-level test that treats the $Jm$ cells as independent uses $\mathrm{Var}_{\text{naive}}=4(\tau^2+\sigma^2)/(Jm)$, so

$$\mathrm{DEFF} = \frac{\mathrm{Var}_{\text{true}}}{\mathrm{Var}_{\text{naive}}} = \frac{m\tau^2+\sigma^2}{\tau^2+\sigma^2} = 1+(m-1)\rho, \qquad \mathrm{FPR}(\alpha) \approx 2\,\Phi\!\left(-\frac{z_{\alpha/2}}{\sqrt{\mathrm{DEFF}}}\right),$$

because the cell-level Wald statistic is approximately $N(0,\mathrm{DEFF})$ under $H_0$ ($\Phi$ is the standard normal distribution function, $z_{\alpha/2}$ its upper $\alpha/2$ quantile). With estimated variances and few donors the inflation is approximate and depends on how the naive standard error is computed. Rank tests share the mechanism, since their null variance also assumes independent cells, but the formula is not derived for them. Values derived from the formula at $\alpha = 0.05$, not measured:

| DEFF | 1 | 2 | 5 | 10 | 20 |
|---|---|---|---|---|---|
| Approximate FPR | 0.050 | 0.166 | 0.381 | 0.535 | 0.661 |

With $\rho = 0.01$ and $m = 1000$, $\mathrm{DEFF} = 10.99$ and about 0.55 of true-null cell-level tests reject at nominal 0.05: deeper sampling makes a cell-level test worse, not better.

### 3.3 Null constructions and what each detects

- **Donor-label permutation among control donors.** Each donor keeps all its cells and its real donor variance; under $H_0$ donors are exchangeable with respect to the pseudo-arm labels. $J$ controls give $\binom{J}{J/2}/2$ distinct balanced splits: 35 for $J=8$, 92,378 for $J=20$. The methods' own parametric p-values are evaluated on each split, so the split count limits replication, not p-value resolution; splits reuse the same donors and are dependent.
- **Technical-replicate null.** Replicates of one sample (for example processing batches of a cell-line mixture [R9]) have identical composition. The null holds technical variance only and omits $\tau^2$, so methods that fail on donor data can pass.
- **Cell split within donors.** Each donor contributes cells to both pseudo-groups equally, so the donor effect cancels and cell-level tests are calibrated by construction. It checks the harness and cannot reveal pseudoreplication.
- **Fitted hierarchical null.** A generator with donor random effects is fitted to a donor-labelled reference, $\beta_1$ is set to 0 and replicates are drawn for chosen $(J, m, \rho)$ [R20]. It is valid only as far as it reproduces $\rho$; a generator that underestimates $\rho$ makes every method look calibrated.

### 3.4 Method families and their assumptions

- **Cell-level tests** (Wilcoxon, t-test, MAST without a donor term) treat cells as independent given condition; their null variance is correct only when $\rho\approx 0$.
- **Pseudobulk negative binomial GLMs** (edgeR quasi-likelihood [R13], DESeq2 [R14]) sum counts per donor and cell type, so the donor is the observation:

$$S_{jgk} \sim \mathrm{NB}(\mu_{jgk},\phi_{gk}), \qquad \log\mu_{jgk} = \log s_{jk} + \beta_{0gk} + \beta_{1gk} c_j .$$

  Donor-to-donor variation enters through $\phi_{gk}$, stabilised by shrinkage across genes. The quasi-likelihood F-test has donor-dependent degrees of freedom; a normal reference for a Wald statistic is too narrow when donors are few. No small-donor correction is derived here.
- **Pseudobulk linear models** (limma-trend and limma-voom [R15], dreamlet [R18]) model log-scale donor profiles with moderated variances; dreamlet adds per-cell-type mixed models with a donor effect and precision weights. They assume approximate normality of transformed donor profiles, weakest with few donors.
- **Cell-level mixed models** (NEBULA [R19], MAST with a donor intercept [R17]) place a subject random effect in the cell-level model. NEBULA-LN is an approximation that works best with many cells per subject, with an h-likelihood (HL) refit; the donor-level effect is still estimated from $J$ donors.
- **Diagnostics.** P-value histograms and quantile-quantile plots cannot separate miscalibration from signal when the null is unknown; with a replicate-respecting null they become quantitative. The complete-null call rate follows from the Benjamini-Hochberg procedure [R16], whose FDR control is established under independence; gene-gene correlation makes it an empirical check.

### 3.5 Why heuristics work and what a model-based formulation adds

Minimum cells per donor, minimum counts per pseudobulk and removal of library-size outlier donors work by dropping donors with too little information; they do not remove the design-effect inflation, which is a property of the variance estimator. A model-based formulation puts the donor component in the variance and then gives an estimate of $\rho$ per gene and cell type with uncertainty, a generator that reproduces the design so calibration can be predicted before real nulls are examined, and empirical-Bayes sharing of dispersion across genes and cell types, which matters most when donors per cell type are few. Each is a claim that can fail (section 5).

### 3.6 Verdict rule and pitfalls

The false-positive rate at $\alpha$ for a method and cell type is averaged over the $B$ null replicates, with 95% bounds from a t-interval on the replicate-level rates ($B-1$ degrees of freedom); because replicates share donors the bounds are approximate. The verdict, at $\alpha=0.05$ and at $0.01$, is `inflated` when the lower bound exceeds $f_{\mathrm{infl}}\alpha$, `conservative` when the upper bound is below $f_{\mathrm{cons}}\alpha$, otherwise `calibrated`; it is `not_assessable` when $B<20$, when fewer than 5,000 genes are testable in the cell type, or when `donor_permutation` has fewer than 8 control donors. The factors 1.5 and 0.5 and the minimums are proposed, not from the literature.

- A joint error measure can hide one-sided miscalibration: a method can rank highly on a balanced measure while its false-positive rate at a fixed $\alpha$ is above nominal [R5]. False-positive rates are therefore reported separately (B3).
- If processing batch aligns with donor identity among control donors, the donor-level null also carries batch; batch balance across pseudo-arms is reported.
- Simulated nulls cannot show failure modes absent from the simulator, such as library-size outliers or donor-specific dropout.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Pseudobulk edgeR quasi-likelihood (as called by muscat `pbDS`) | model-based | Sum counts per donor and cell type; negative binomial GLM with library-size normalisation, dispersion estimation, quasi-likelihood fit and F-test | [R13], [R12] |
| Pseudobulk DESeq2 Wald test; PyDESeq2 | model-based | Negative binomial GLM on donor sums with moderated dispersion and a Wald test; PyDESeq2 re-implements the default single- and multi-factor Wald workflow in Python | [R14] |
| Pseudobulk limma-trend and limma-voom | model-based | Linear model on log-scale pseudobulk with empirical-Bayes moderated t-statistics; trend uses a trended robust prior variance, voom adds observation weights | [R15], [R12] |
| dreamlet | model-based | Linear (mixed) models with precision weights on pseudobulk, fitted per cell type, with empirical-Bayes moderation | [R18] |
| NEBULA | model-based | Negative binomial gamma mixed model with a subject random effect; LN approximates the likelihood for speed, HL uses an h-likelihood, and LN fits are refitted with HL when the estimated kappa is below the user value | [R19] |
| MAST with donor random intercept | model-based | Two-part hurdle model (detection and conditional expression); random effects through the lme4 wrapper, where empirical-Bayes shrinkage is not implemented | [R17] |
| MAST without donor term | heuristic | Cell-level hurdle model with cells as replicates | [R17] |
| Cell-level Wilcoxon rank-sum and t-test | heuristic | Cells as independent replicates; the baseline whose inflation under pseudoreplication motivates the task | [R2], [R4], [R7], [R1] |
| muscat `pbDS` and `aggregateData` | model-based | Sum aggregation per sample and cell type, pseudobulk filters, then edgeR, DESeq2 or limma | [R12] |
| hierarchicell | model-based | Estimates library-size, dropout and gene-mean distributions and a hierarchical variance structure from counts, simulates cell-type-specific hierarchical data and computes type 1 error (fold change 1) or power for tools including MAST with individual random effects | [R20] |
| pipeComp DEA evaluator | heuristic | Truth-based TP, FP, TPR, PPV, FDR and FPR at FDR thresholds | [R10] |

The published reference set is the donor-aware pseudobulk family (edgeR, DESeq2, limma), with donor-random-effect mixed models as the main alternative [R1, R5, R7]; cell-level tests are the inflating baseline. singlet uses the donor-permutation null and the fitted hierarchical null; the technical-replicate null is a complementary check with known truth but weak donor variance.

Defaults taken from source (commit shorthand after @):

| Method | Parameter | Value | Source |
|---|---|---|---|
| muscat `pbDS` | method | `"edgeR"` first of edgeR, DESeq2, limma-trend, limma-voom, DD | `R/pbDS.R:85` @ 8616831 |
| muscat `pbDS` | min_cells | 10 | `R/pbDS.R:86` @ 8616831 |
| muscat `pbDS` | filter | `"both"` (genes and samples) | `R/pbDS.R:87` @ 8616831 |
| muscat `pbDS` | library-size outliers | `isOutlier(colSums, log=TRUE, type="lower", nmads=3)`, lower tail only | `R/pbDS.R:149` @ 8616831 |
| muscat `pbDS` | gene filter | edgeR `filterByExpr`, applied only when the maximum count exceeds 100 | `R/pbDS.R:157-158` @ 8616831 |
| muscat `aggregateData` | fun | `"sum"` | `R/aggregateData.R:72` @ 8616831 |
| muscat edgeR path | call sequence | `DGEList(remove.zeros=TRUE)`, `normLibSizes`, `estimateDisp`, `glmQLFit`, `glmQLFTest` | `R/utils-pbDS.R:71-79` @ 8616831 |
| muscat limma path | trend, robust | TRUE for limma-trend; FALSE for voom, which first applies `voom` | `R/utils-pbDS.R:131-136` @ 8616831 |
| decoupler `filter_samples` | min_cells, min_counts | 10, 1000; the book gives the same guideline [R1] | `src/decoupler/pp/anndata.py:442-443` @ 3132edc |
| dreamlet | min.cells, robust | 10, FALSE | `R/dreamlet.R:713` @ 6ddcb83 |
| NEBULA | method, kappa | `"LN"`, 800 | `R/nebula.R:43` @ 70593f9 |
| NEBULA | kappa floor, HL switch | kappa below 200 not recommended; method set to HL when cells per subject is below 30 | `README.md:388-400` @ 70593f9 |
| PyDESeq2 | alpha, cooks_filter, independent_filter | 0.05, True, True | `src/pydeseq2/ds.py:101-103` @ 2ca3b74 |
| MAST | method, ebayes | `"bayesglm"`, TRUE | `R/zeroinf.R:84` @ d46c1d1 |
| hierarchicell | foldchange for type 1 error | 1 (a message is issued otherwise) | `R/04_compute_error.R:186` @ 183ef08 |
| pipeComp | FPR in code | `(P-TP)/sum(!isDE)`, which divides missed differential genes by the number of null genes; the false-positive rate is `(called-TP)/sum(!isDE)` | `vignettes/pipeComp_dea.Rmd:75`, `R/dea_evaluationFunctions.R:47` @ a3fd419 |

## 5. Proposed singlet approach

Routes (port, reimplement, callout) per method are listed in section 12. The proposed default method is `pseudobulk_nb`; the inflating baseline `cell_wilcoxon` is always reported beside it so the size of the inflation is visible.

**Model-based formulation.** Donor sums follow the negative binomial GLM of section 3.4 with a hierarchical prior $\log\phi_{gk}\sim N(\eta_k,\lambda_k^2)$, whose cell-type hyperparameters are learned by marginal likelihood from donor-labelled datasets. The fitted null for a design $(J,m,\rho)$ sets $\beta_1=0$, draws donor effects on the log scale with the fitted ICC and draws cell counts from a negative binomial with parameters $\Theta$. The claims are falsified if, on the benchmarks:

1. the median absolute ICC error exceeds 0.02 (B2);
2. the observed-to-formula DEFF ratio leaves [0.8, 1.2] (B2);
3. a method's false-positive rate under the fitted null differs from its donor-permutation rate by more than $0.2\alpha$ (B1, B2);
4. empirical-Bayes dispersion does not reduce $|\mathrm{FPR}-\alpha|$ at $J=8$ relative to unshrunk per-gene dispersion (B1).

**Trained resources.** Cell-type dispersion hyperpriors and generator parameters $\Theta$, trained on donor-labelled datasets of the singlet catalogue (354M cells, about 40 percent annotated) and validated on donor-permutation nulls of held-out datasets.

**ML stack.** PyTorch fits the hyperpriors (Adam, minibatches over genes). Hard-coded CUDA with cuSPARSE covers three small hot kernels: pseudobulk aggregation as a sparse-dense product with the cell-to-(donor, cell type) indicator matrix, batched IRLS for negative binomial GLMs across genes (each design is $J\times p$), and the donor-permutation gather.

**Kernels and devices.** Aggregation is linear in stored nonzeros, streams cells in chunks and keeps a $J\times K\times G$ accumulator (160 MB for $J=100$, $K=10$, $G=20{,}000$ in float64, derived). Donor sums do not change when labels are permuted, so aggregation is done once per cell type and each replicate refits only the design column, at a cost of $O(GJp^2)$ per IRLS iteration. Cell-level rank tests need a cell type in memory, or gene chunks.

**Defaults without asking.** `null.type` is `donor_permutation` (needs `null.control_condition`; a `dry_run` call reports it), `methods` is `pseudobulk_nb` and `cell_wilcoxon`, `null.n_replicates` is 20, `calibration.alpha_levels` are 0.001, 0.01, 0.05, 0.1 with `fdr_q` 0.05, and a `dry_run` call precedes every full execution.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Raw UMI counts, cells by genes; normalised layers are rejected |
| read | obs/`donor_key` | string | Donor or sample identity, the unit of inference (required) |
| read | obs/`condition_key` | string | Condition label; identifies control donors |
| read | obs/`cell_type_key` | string | Stratum of every per-cell-type calibration |
| read | obs/`batch_key` | string, optional | Processing batch; required by the technical-replicate null, otherwise used for batch balance |
| read | obs/size_factor | float32, optional | Per-cell size factors for cell-level methods; pseudobulk methods use donor library sums |
| write | uns/null_calibration/summary | object | Per method and cell type: false-positive rates, KS distance, $\lambda_{GC}$, complete-null call rate, testable genes, verdict |
| write | varm/null_pvalues_`<method>` | float32 genes by cell types | Median p-value over null replicates; NaN where untested |
| write | models/null_generator_`<cell_type>` | object | Fitted generator parameters $\Theta$; written only for `fitted_null` |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. Needs raw counts in layers/counts. |
| `donor_key` | string | required | — | obs column identifying the donor or sample, the unit of inference. Required. |
| `cell_type_key` | string | "cell_type" | — | obs column defining the per-cell-type strata for calibration. |
| `null` | object | — | — | Null construction and its design. |
| `null.type` | string | "donor_permutation" | `donor_permutation`, `replicate_batch`, `cell_split_within_donor`, `fitted_null` | donor_permutation relabels control donors; replicate_batch compares batches of one sample; cell_split_within_donor is a harness check; fitted_null uses a fitted generator. |
| `null.condition_key` | string | "condition" | — | obs column with the condition; identifies control donors. |
| `null.control_condition` | string/null | null | — | Level of condition_key marking control donors. Required for donor_permutation and cell_split_within_donor. |
| `null.batch_key` | string/null | null | — | obs column with processing batch. Required for replicate_batch; otherwise only used to report batch balance. |
| `null.n_replicates` | integer | 20 | min 20 | Number of null replicates. For donor_permutation, distinct balanced splits are used without repetition. |
| `methods` | array | ["pseudobulk_nb", "cell_wilcoxon"] | — | Methods to evaluate. pseudobulk_nb is the proposed default; cell_* and mast_cell are inflating baselines without a donor term. |
| `calibration` | object | — | — | Reporting levels and verdict rule. |
| `calibration.alpha_levels` | array | [0.001, 0.01, 0.05, 0.1] | — | Nominal thresholds at which false-positive rates are reported. |
| `calibration.fdr_q` | number | 0.05 | max 1; > 0 | Benjamini-Hochberg level for the complete-null call rate. |
| `calibration.inflation_factor` | number | 1.5 | > 1 | Inflated when the lower 95% bound of the false-positive rate exceeds this factor times alpha. Proposed, not from the literature. |
| `calibration.conservative_factor` | number | 0.5 | max 1; > 0 | Conservative when the upper 95% bound is below this factor times alpha. Proposed, not from the literature. |
| `calibration.cell_types` | array | [] | — | Cell types to evaluate. Empty means every level of cell_type_key. |
| `pseudobulk` | object | — | — | Options for pseudobulk_* methods and dreamlet. |
| `pseudobulk.min_cells` | integer | 10 | min 1 | Minimum cells per donor and cell type for a pseudobulk to be kept. |
| `pseudobulk.min_counts` | integer | 1000 | min 0 | Minimum total counts per pseudobulk. |
| `pseudobulk.outlier_nmads` | number | 3 | > 0 | Lower-tail library-size outlier threshold in median absolute deviations. Applies to pseudobulk_nb and pseudobulk_deseq2. |
| `nebula` | object | — | — | Options for the nebula method. |
| `nebula.kappa` | integer | 800 | min 200 | LN fits with estimated kappa below this value are refitted with HL. Values below 200 are refused. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Random seed for split subsets, batch sampling and generator draws; exhaustive split enumeration is deterministic. |
| `dry_run` | boolean | false | — | Return estimated seconds, peak memory, device and number of distinct splits without executing. |
| `overwrite` | boolean | false | — | Replace existing output members for the requested methods instead of failing. |
<!-- PARAMS:AUTO:END -->

`null.control_condition` is required for `donor_permutation` and `cell_split_within_donor` and ignored by `replicate_batch` and `fitted_null`; `null.batch_key` is required for `replicate_batch` and otherwise only reports batch balance. The `pseudobulk` options apply to the `pseudobulk_*` methods and `dreamlet`, with `outlier_nmads` only for `pseudobulk_nb` and `pseudobulk_deseq2`; `nebula.kappa` applies only to `nebula`. Verdicts under `cell_split_within_donor` are labelled `sanity_check_only`. For `donor_permutation` the distinct balanced splits are used without repetition, and if fewer than `n_replicates` exist all are used and the count is reported.

## 7. MCP tool

Tool name `singlet_statistics_pvalue_null_calibration` (definition in `tasks/mcp/singlet_statistics_pvalue_null_calibration.json`). Example call and compact result (placeholders in angle brackets are filled at execution time):

```json
{"dataset": "/data/kang_pbmc.singlet", "donor_key": "replicate", "cell_type_key": "cell_type",
 "null": {"type": "donor_permutation", "condition_key": "label", "control_condition": "ctrl"},
 "methods": ["pseudobulk_nb", "cell_wilcoxon"], "dry_run": false}
```

```json
{"dataset": "/data/kang_pbmc.singlet", "status": "completed",
 "wrote": ["uns/null_calibration/summary", "varm/null_pvalues_pseudobulk_nb", "varm/null_pvalues_cell_wilcoxon"],
 "summary": {"null_type": "donor_permutation", "control_donors": "<count>", "splits_used": "<count>",
  "calibration": [{"method": "cell_wilcoxon", "cell_type": "<cell type>", "fpr": {"0.01": "<measured>", "0.05": "<measured>"},
   "ks_distance": "<measured>", "lambda_gc": "<measured>", "complete_null_call_rate": "<measured>",
   "testable_genes": "<count>", "verdict": "<inflated | calibrated | conservative | not_assessable>"}],
  "warnings": []},
 "provenance_id": "<id>", "job_id": null}
```

Long-running for large datasets (a `dry_run` call precedes execution). Stochastic: `seed` fixes split subsets, batch sampling and generator draws; exhaustive split enumeration and the verdict arithmetic are deterministic. The `dry_run` estimate gives seconds, peak memory in gigabytes, device and the number of distinct splits.

## 8. Benchmarks

**Shared protocol.** Null replicates are the distinct balanced donor splits, or a seeded subset of at least 20 when more exist. Each method is fitted with its own filters (pseudobulk `min_cells` 10, `min_counts` 1000, `outlier_nmads` 3), p-values are its own parametric p-values, and a cell type qualifies when at least 5,000 genes are testable for the method. Reference implementations are executed on CPU with a fixed thread count and recorded seeds, on identical splits and filters. $\mathrm{FPR}(\alpha)$, KS distance, $\lambda_{GC}$ and the complete-null call rate are defined once, in the B1 metric table. All thresholds below are proposed unless a reference is given.

### B1. Donor-label permutation and cell split on control donors (Kang PBMC)

- **Goal**: measure false-positive rate and p-value uniformity when no condition effect exists in real cells, by relabelling control donors (donor-level null) and by splitting cells within donors (harness positive control).
- **Ground truth**: planted null by construction, per gene and cell type. (a) The 8 control aliquots (`label == ctrl`) are assigned to two pseudo-arms of 4 donors and each cell inherits its donor's arm. (b) Each donor's cells are split at random into two equal halves. Every gene is null in both.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Kang et al. 2018 PBMC, control aliquots | GEO GSE96583 [R11]; the book's copy carries `label`, `replicate`, `cell_type` [R1] | 10x scRNA-seq, human PBMC, 8 lupus patients before and after 6 h IFN-beta (16 samples), 24,673 cells by 15,706 genes in the book's copy, 8 cell types [R1] | — | Stimulated aliquots are excluded |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| False-positive rate | $\mathrm{FPR}(\alpha)=\frac1B\sum_r\frac1{G_r}\sum_g\mathbf 1\{p_{rg}\le\alpha\}$, $G_r$ the genes the method tested in replicate $r$; spread across replicates reported | Close to $\alpha$ | primary | — |
| KS distance | $\sup_x\lvert\hat F(x)-x\rvert$ over p-values pooled across genes and replicates; ties at their value | Close to 0 | primary | — |
| Genomic inflation factor | $\lambda_{GC}=\mathrm{median}_g(z_g^2)/0.4549$, $z_g=\Phi^{-1}(1-p_g/2)$; 0.4549 is the median of $\chi^2_1$ | Close to 1 | primary | — |
| Complete-null call rate | Fraction of replicates with at least one Benjamini-Hochberg adjusted value $\le q$; resolution $1/B$ | At most $q$ | guardrail | [R16] |
| Reference parity | $\lvert\mathrm{FPR}_{\text{singlet}}-\mathrm{FPR}_{\text{reference}}\rvert$ on identical splits | Close to 0 | primary | — |

- **Comparators**: muscat `pbDS` (edgeR, DESeq2, limma-trend, limma-voom) and PyDESeq2; dreamlet; NEBULA; MAST with and without a donor term; cell-level Wilcoxon and t-test; versions at the commits in section 4.
- **Protocol**: per qualifying cell type take the 8 control donors; for (a) enumerate the 35 balanced 4-versus-4 splits, for (b) draw 20 seeded random cell splits. Pool p-values across genes and replicates. Do not use the permutation distribution as the p-value reference: its floor is $1/35\approx0.029$.
- **Acceptance criterion** (proposed): (i) under (b), each cell-level test has pooled $\mathrm{FPR}(\alpha)$ within $[0.8\alpha,1.2\alpha]$ at $\alpha=0.01$ and $0.05$ in every qualifying cell type; (ii) under (a), singlet's `pseudobulk_nb`, `pseudobulk_deseq2` and `nebula` reproduce the reference $\mathrm{FPR}(\alpha)$ within $0.2\alpha$ at the same two levels; (iii) every method receives a verdict (section 3.6) in at least one qualifying cell type.
- **Known pitfalls**: the 35 splits share the same 8 donors, so their spread is descriptive and 8 donors give little power to detect moderate miscalibration; the effective donor count per cell type is reported with every verdict.

### B2. Fitted hierarchical null with zero condition effect (proposed)

- **Goal**: check that a generator fitted to real donor structure reproduces donor ICC and design effect, so calibration can be studied across $J$, $m$ and $\rho$ with known truth.
- **Ground truth**: planted simulation with $\beta_1=0$ for every gene. The ICC estimand $\hat\rho_{gk}$ is the REML one-way random-intercept estimate on log1p library-size-normalised expression of cell type $k$, computed identically on real and simulated data. Observed DEFF is the median over genes of the variance across replicates of the cell-level t statistic, which is $N(0,\mathrm{DEFF})$ under section 3.2.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulations fitted to the Kang control donors of B1 | singlet generator (parameters $\Theta$); hierarchicell [R20] as comparator generator | Simulated counts, 20,000 genes; $J\in\{8,20,50,100\}$, $m\in\{50,500\}$, $\rho\in\{0.005,0.02,0.05\}$ and the fitted $\rho$ | — | $\Theta$ is fitted per cell type before generation |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| False-positive rate | As in B1, on simulated replicates | Close to $\alpha$ | primary | — |
| ICC error | Median over genes and cell types of $\lvert\hat\rho^{\text{sim}}_{gk}-\hat\rho^{\text{real}}_{gk}\rvert$ at the fitted $\rho$ | Close to 0 | guardrail | — |
| DEFF ratio | Observed DEFF divided by $1+(m-1)\hat\rho$ | Close to 1 | guardrail | — |

- **Comparators**: hierarchicell estimated and simulated from the same reference [R20]; pseudobulk methods, NEBULA, dreamlet, MAST with a donor term and cell-level tests fitted to both generators.
- **Protocol** (generator recipe): 1. fit per-gene mean, dispersion and ICC per cell type on the control donors; 2. for each grid cell draw donor effects $u_j$ on the log scale with the variance that gives $\rho$, and counts from a negative binomial; 3. draw $B=20$ replicates with $\beta_1=0$; 4. fit every method and compute the metrics; 5. compare each method's $\mathrm{FPR}(\alpha)$ at the reference design with its B1 value.
- **Acceptance criterion** (proposed): median ICC error at most 0.02, DEFF ratio in $[0.8,1.2]$ at the reference design, and each method's $\mathrm{FPR}(\alpha)$ within $0.2\alpha$ of its B1 donor-permutation value at $\alpha=0.01$ and $0.05$.
- **Known pitfalls**: a generator that underestimates $\rho$ makes all methods look calibrated, so generator and methods are circular unless step 5 holds; gene-level ICC is noisy with 8 donors, hence the median.

### B3. Joint error under planted effects (proposed)

- **Goal**: prevent a uniformly conservative method from passing calibration by reporting false-positive rate, true-positive rate and a balanced measure together, in the spirit of [R5].
- **Ground truth**: planted simulation from the B2 generator at $J\in\{8,20\}$, $m=500$ and the fitted $\rho$; 10 percent of genes receive a $\log_2$ fold change drawn equally from $\{\pm0.5,\pm1,\pm2\}$, the rest are null. A gene is differential if its planted fold change is nonzero.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B2 generator with planted effects | singlet generator fitted to the Kang control donors [R11] | Simulated counts, 20,000 genes, 20 replicates per design | — | Effect fraction and sizes are proposed design choices |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| False-positive rate | Fraction of null genes with $p\le\alpha$ at $\alpha=0.05$, pooled over replicates | Close to 0.05 | primary | [R2] |
| True-positive rate | Fraction of differential genes with $p\le\alpha$ at the same $\alpha$ | Higher | primary | [R5] |
| Matthews correlation coefficient | $\dfrac{TP\,TN-FP\,FN}{\sqrt{(TP+FP)(TP+FN)(TN+FP)(TN+FN)}}$ over all genes at $\alpha=0.05$; defined as 0 when a factor of the denominator is 0 | Higher | primary | [R5] |

- **Comparators**: pseudobulk methods, dreamlet, NEBULA, MAST with a donor term, cell-level tests.
- **Protocol**: generate each design with fixed seeds, fit every method, compute the three metrics, repeat over 20 seeds.
- **Acceptance criterion** (proposed): a method with $\mathrm{FPR}(0.05)>0.075$ is flagged inflated and excluded from the Matthews ranking, whatever its coefficient; singlet's reimplemented methods match their reference Matthews coefficient within 0.02.
- **Known pitfalls**: the coefficient mixes false positives and false negatives and depends on the effect fraction and size distribution; the published conclusions on this question are disputed [R6].

### P1. Performance and scaling

- **Measures**: wall time per null replicate and in total, peak memory, genes per second, and generator fitting time.
- **Scales**: 10^4, 10^5, 10^6 cells (and 10^7 for streaming aggregation) from the B2 generator; $J$ of 8, 20, 50 and 100; 5,000 and 20,000 genes; $B$ of 20 and 100.
- **Comparators**: muscat `pbDS` with edgeR, PyDESeq2, limma, dreamlet, NEBULA, MAST, and cell-level tests, on CPU and CUDA.
- **Hold fixed**: donor and cell-type design, $B$, the gene set after each method's filter, thread count, GPU model and seed; record the hardware.
- **Acceptance criterion** (proposed): aggregation time scales with stored nonzeros with log-log slope in $[0.9,1.1]$ over 10^4 to 10^6 cells, and per-replicate time for each pseudobulk method does not exceed the fastest reference implementation on identical hardware.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `simulation.reference_matched_counts`: Reference-matched count simulation and simulator realism / fitness-for-purpose assessment
- **Feeds**:
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
  - `sample-level.multi_sample_power_analysis`: Power and sample-number planning for multi-sample designs
- **Reads**: `layers/counts`, `obs/<donor_key>`, `obs/<condition_key>`, `obs/<cell_type_key>`, `obs/<batch_key>`, `obs/size_factor`
- **Writes**: `uns/null_calibration/summary`, `varm/null_pvalues_<method>`, `models/null_generator_<cell_type>`
<!-- CHAINING:AUTO:END -->

Workflows: calibrated condition differential expression (annotation, size factors, `markers-de.replicate_aware_condition_de`, this task, `statistics.multiple_testing_control`); pre-analysis audit with `dry_run`. The `random_split_null` mode of the condition-DE task and this task share one null generator.

## 10. Risks, pitfalls and open questions

- Donor-label coverage of the singlet catalogue (354M cells, about 40 percent annotated) bounds the feasibility of donor-level nulls and trained priors; the data licence of GSE96583 is not stated in the sources read.
- No published small-donor calibration result is cited for the quasi-likelihood F-test, NEBULA or dreamlet at $J=8$; the NEBULA and dreamlet repositories report no calibration results, and the 35 permutation splits are dependent.
- The primary articles of Squair et al. [R2], Soneson and Robinson [R3], Zimmerman et al. [R4] and Murphy and Skene [R5] were read only at record level: their donor-permutation and mock-comparison designs, the GEE versus GLMM formulation of [R4] (so no Zimmerman method is in the tool), and the identity of the balanced measure of [R5] (Matthews coefficient is assumed in B3) are unchecked. The reply [R6] is known from its published summary.
- A technical-replicate benchmark on cell-line mixtures [R9] is omitted because no accession, composition or size record is available; the `replicate_batch` null is implemented but unbenchmarked.
- All verdict and acceptance thresholds (factors 1.5 and 0.5, bands $[0.8\alpha,1.2\alpha]$ and $0.2\alpha$, 5,000 genes, 20 replicates, ICC error 0.02, DEFF band, Matthews tolerance 0.02) are proposed and are to be tuned on B1 and B2 first.
- First experiment: B1(a) and (b) on the 8 Kang control donors for `pseudobulk_nb` and `cell_wilcoxon`; check the Kolmogorov-Smirnov and $\lambda_{GC}$ code on a constructed case with a known answer, and measure time with `dry_run`.

## 11. References

R1. Single-cell best practices (online book), chapter "Differential gene expression analysis", v0.2.0, 2026-06-11. https://sc-best-practices.org — partial (repo)
R2. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R3. Soneson C, Robinson MD. Bias, robustness and scalability in single-cell differential expression analysis. *Nature Methods* 2018. doi:10.1038/nmeth.4612 — verified (corpus)
R4. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)
R5. Murphy AE, Skene NG. A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nature Communications* 2022. doi:10.1038/s41467-022-35519-4 — verified (corpus)
R6. Zimmerman KD, Evans C, Langefeld CD. Reply to: A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nature Communications* 2022;13:7852. doi:10.1038/s41467-022-35520-x — verified (search)
R7. Junttila S, Smolander J, Elo LL. Benchmarking methods for detecting differential states between conditions from multi-subject single-cell RNA-seq data. *bioRxiv* 2022. doi:10.1101/2022.02.16.480662 — verified (corpus)
R8. Das S, Rai A, Merchant ML, Cave MC, Rai SN. A comprehensive survey of statistical approaches for differential expression analysis in single-cell RNA sequencing studies. *Genes (Basel)* 2021. — verified (corpus)
R9. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R10. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)
R11. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018;36:89-94. doi:10.1038/nbt.4042 — verified (repo)
R12. Crowell HL, Soneson C, Germain PL, et al. muscat detects subpopulation-specific state transitions from multi-sample multi-condition single-cell transcriptomics data. *Nature Communications* 2020. doi:10.1038/s41467-020-19894-4 — verified (corpus)
R13. Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. *Bioinformatics* 2010. doi:10.1093/bioinformatics/btp616 — verified (corpus)
R14. Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. *Genome Biology* 2014. doi:10.1186/s13059-014-0550-8 — verified (corpus)
R15. Ritchie ME, Phipson B, Wu D, et al. limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 2015. doi:10.1093/nar/gkv007 — verified (corpus)
R16. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)
R17. Finak G, McDavid A, Yajima M, et al. MAST: a flexible statistical framework for assessing transcriptional changes and characterizing heterogeneity in single-cell RNA sequencing data. *Genome Biology* 2015. doi:10.1186/s13059-015-0844-5 — verified (corpus)
R18. Hoffman G, et al. Efficient differential expression analysis of large-scale single-cell transcriptomics data using Dreamlet. *Nature Communications* 2026. doi:10.1038/s41467-026-75680-8 (preprint doi:10.1101/2023.03.17.533005) — partial (repo)
R19. He L, Davila-Velderrain J, Sumida TS, Hafler DA, Kellis M, Kulminski AM. NEBULA is a fast negative binomial mixed model for differential or co-expression analysis of large-scale multi-subject single-cell data. *Communications Biology* 2021;629. doi:10.1038/s42003-021-02146-6 — verified (repo)
R20. Hierarchicell: an R-package for estimating power for tests of differential expression with single-cell data. 2021. doi:10.1186/s12864-021-07635-w — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/HelenaLC/muscat | Helena L. Crowell (aut, cre), Pierre-Luc Germain, Charlotte Soneson, Anthony Sonrel, Jeroen Gilis, Davide Risso, Lieven Clement, Mark D. Robinson | GPL-3 (DESCRIPTION); no LICENSE file | Pseudobulk aggregation, filters and edgeR/limma wrappers | reimplement; callout comparator |
| https://github.com/owkin/PyDESeq2 | Boris Muzellec, Maria Telenczuk, Vincent Cabelli, Mathieu Andreux (pyproject.toml) | MIT (LICENSE, copyright Owkin) | DESeq2-style Wald test on pseudobulk | port |
| https://github.com/thelovelab/DESeq2 | Michael Love (aut, cre), Simon Anders, Wolfgang Huber and contributors (DESCRIPTION) | LGPL (>= 3) (DESCRIPTION) | Reference DESeq2 for the PyDESeq2 comparison | callout |
| https://github.com/DiseaseNeurogenomics/dreamlet | Gabriel Hoffman (aut, cre) | Artistic-2.0 (DESCRIPTION); no LICENSE file | Precision-weighted mixed models on pseudobulk | reimplement; callout comparator |
| https://github.com/lhe17/nebula | Liang He (aut, cre), Raghav Sharma (ctb) | MIT (DESCRIPTION and LICENSE.md); the scRNA-tools registry lists GPL-2.0 | NEBULA-LN and HL mixed model | port |
| https://github.com/RGLab/MAST | Andrew McDavid (aut, cre), Greg Finak, Masanao Yajima | GPL(>= 2) (DESCRIPTION); no LICENSE file | Hurdle model with and without donor intercept | reimplement; callout comparator |
| https://github.com/kdzimm/hierarchicell | Kip Zimmerman (aut, cre) | CC0 (DESCRIPTION); no LICENSE file | Hierarchical simulator and type 1 error routine | port |
| https://github.com/plger/pipeComp | Pierre-Luc Germain (cre, aut), Anthony Sonrel, Mark D. Robinson | GPL (DESCRIPTION); LICENSE file is the GPL version 3 text | Truth-based DEA evaluator; FPR formula | reimplement metrics with the corrected formula; callout |
| https://github.com/scverse/decoupler | Pau Badia i Mompel (pyproject.toml) | BSD 3-Clause (LICENSE) | `filter_samples` pseudobulk filter defaults | port |
| Bioconductor packages edgeR and limma | Robinson MD, McCarthy DJ, Smyth GK [R13]; Ritchie ME et al. [R15] | — | Pseudobulk quasi-likelihood and moderated-t tests, called through muscat | reimplement; callout comparator |
