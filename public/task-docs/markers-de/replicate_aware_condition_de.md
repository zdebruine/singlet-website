---
id: markers-de.replicate_aware_condition_de
title: Replicate-aware condition DE within a cell type
area: markers-de
scope: core
paradigm: model-based
literature_status: contested
priority: P0
depends_on: [qc.sample_level_qc, annotation.cluster_label_assignment, normalization.size_factor_estimation, demux.donor_assignment_reference_genotypes]
feeds: [markers-de.lfc_shrinkage_effect_size, enrichment.preranked_gene_set_enrichment, statistics.pvalue_null_calibration, sample-level.multi_sample_power_analysis]
reads: [layers/counts, obs/<cell_type_key>, obs/<donor_key>, obs/<condition_key>, obs/<covariate_keys>, obs/size_factor]
writes: [uns/de_replicate/<cell_type>/results, uns/de_replicate/<cell_type>/calibration, uns/pseudobulk/<cell_type>, models/<name>]
devices: [cpu, cuda]
mcp_tool: singlet_markers_de_replicate_aware_condition_de
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Replicate-aware condition DE within a cell type

> Test whether a gene's mean expression differs between conditions within one annotated cell type when donors or samples are the biological replicates, returning log2 fold changes, test statistics, p-values and FDR that are calibrated at the replicate level.

## 1. Question

Given raw UMI counts with a cell-type label, a donor (or sample) identifier and a condition label per cell, plus optional covariates, which genes change between conditions within each cell type when inference is made over donors rather than cells? Per cell type and gene the output is a log2 fold change with standard error, a test statistic, a p-value and a Benjamini-Hochberg FDR [R19]. A correct answer has a false positive rate under a donor-level null that matches the nominal level and recovers planted or biologically predicted effects. Real data seldom carry per-gene truth, so the accepted proxies are planted effects in simulation [R6], donor-level label permutation, and coarse gene sets in paired data [R15].

## 2. Why this task matters and where the field stands

Case-control and treated-versus-untreated studies usually sample thousands of cells from a modest number of donors. Cells from one donor share genotype, age, sex, handling and batch, so when the condition is assigned per donor they are not independent replicates. A test that counts each cell as an observation measures the cell count rather than the donor count, and its p-values are too small (pseudoreplication). Squair et al. showed that single-cell tests ignoring this produce many false discoveries [R1]; Zimmerman et al. documented the same bias and proposed replicate-aware alternatives [R2].

Status: **contested**. That the donor is the unit of inference is settled; the method is not. Zimmerman et al. and their reply describe pseudobulk as slightly conservative and slightly underpowered against a two-part hurdle mixed model when cells per individual are balanced, and less well powered as they become imbalanced [R2][R4]. Murphy and Skene argue that a balanced performance measure favours pseudobulk [R3]. Junttila et al. rank pseudobulk and mixed models above naive tests such as Wilcoxon [R5]. Soneson and Robinson compared bias, robustness and scalability earlier [R7]. Implementations include muscat [R6], dreamlet [R14] and NEBULA [R13].

Open problems:

- **Few donors**: dispersion and variance estimates are unstable and calibration rests on shrinkage; the sources give no validated minimum.
- **Within-donor designs**: the right strategy depends on whether the label varies within or is constant within a donor [R17].
- **Composition**: a change in cell-type proportions shifts donor-level means; abundance is a separate question addressed by differential abundance testing [R16].
- **Circular labels**: clusters inferred on the same data can carry the condition signal.
- **Multiplicity scope**: BH within each cell type or across all gives different discovery counts [R19].
- **Benchmark circularity**: NB simulations favour NB methods and real-data truth is coarse.

## 3. Theory and insight

**Notation.** $S$ donors per cell type, $m_s$ cells of that type in donor $s$, $G$ genes passing the filters, $p$ design coefficients, $x_s$ the donor-level condition indicator, $N_s$ the donor library size, $\phi_g$ the negative binomial (NB) dispersion with $\operatorname{Var}=\mu+\phi\mu^2$, $\varphi_g$ the quasi-likelihood dispersion, $\alpha$ the significance level only.

**Cell-level model.** A nested NB mixed model with a donor random intercept:

$$y_{gi}\sim\mathrm{NB}(\mu_{gi},\phi_g),\qquad \log\mu_{gi}=\log N_i+\beta_{0g}+\beta_{1g}x_{s(i)}+u_{gs(i)},\qquad u_{gs}\sim\mathcal N(0,\sigma_{b,g}^2).$$

It holds when the condition is constant within donor, donors are independent and exchangeable, enough cells per donor exist to estimate $\sigma_{b,g}^2$, and the NB approximation is adequate.

**Pseudobulk model.** Cells are summed to donor profiles, $Y_{gs}=\sum_{i\in s}y_{gi}$, with $\mu_{gs}=N_s\exp(\mathbf x_s^{\top}\boldsymbol\beta_g)$ and $\operatorname{Var}(Y_{gs})=\mu_{gs}+\phi_g\mu_{gs}^2$. The expected sum is $\sum_i N_i q_{gi}$; with near-constant composition inside the cell type it is proportional to $\sum_i N_i$, so the donor library size (with TMM factors [R21]) is the natural offset. Residual degrees of freedom come from $S-p$, not from the cell count. The regime is an NB approximation at donor level with $S>p$. With one pseudobulk sample per donor a donor random intercept cannot be separated from the dispersion, so the pseudobulk NB models carry no donor term; when a donor contributes paired samples the donor enters as a fixed block (edgeR, DESeq2, limma) or a random intercept (dreamlet).

**Quasi-likelihood test.** The variance scales freely, $\operatorname{Var}(Y_{gs})=\varphi_g V(\mu_{gs})$, with $\varphi_g$ shrunk by empirical Bayes toward a trend, and the condition term is tested by

$$F_g=\frac{\Delta D_g/\mathrm{df}_1}{\hat\varphi_g}\sim F(\mathrm{df}_1,\mathrm{df}_2),\qquad \mathrm{df}_2=S-p+\mathrm{df}_{\mathrm{prior}},$$

where $\Delta D_g$ is the deviance reduction from dropping the term. This is the standard form; it is best when $\hat\varphi_g$ is well determined, and with small $S$ the prior degrees of freedom carry most of the information, so the shrinkage prior is the main source of calibration.

**Design effect.** For a balanced design with $m$ cells per donor, $S_1,S_2$ donors per group, between-donor variance $\sigma_b^2$ and within-donor variance $\sigma_w^2$, the correct variance of the difference of group means is $(\sigma_b^2+\sigma_w^2/m)(1/S_1+1/S_2)$, while a test treating all cells as independent uses $(\sigma_b^2+\sigma_w^2)(1/(mS_1)+1/(mS_2))$. Their ratio is

$$\frac{\operatorname{Var}_{\mathrm{correct}}}{\operatorname{Var}_{\mathrm{naive}}}=1+(m-1)\rho,\qquad \rho=\frac{\sigma_b^2}{\sigma_b^2+\sigma_w^2},$$

so the naive standard error is too small by $\sqrt{1+(m-1)\rho}$; for illustration $m=100,\rho=0.05$ gives a variance ratio of $5.95$ and a standard error about $2.44$ times too small. The regime is the balanced Gaussian approximation on the log scale with the condition constant within donor.

**Precision-weighted linear mixed model** (dreamlet): $\log_2\mathrm{CPM}_{gs}=\mathbf x_s^{\top}\boldsymbol\beta_g+u_{gs}+\varepsilon_{gs}$ with $\operatorname{Var}(\varepsilon_{gs})=\tau_g^2/w_{gs}$. The weights $w_{gs}$ come from a mean-variance trend and from sample-level cell counts and library sizes, so they are approximate. The moderated statistic is $\tilde t_g=\hat\beta_{1g}/(\tilde s_g\sqrt{v_g})$ with $\tilde s_g^2=(d_0s_0^2+d_gs_g^2)/(d_0+d_g)$, shrinking each residual variance toward a prior with $d_0$ degrees of freedom. $u_{gs}$ is identified only when a donor has more than one sample per cell type.

**Weighting.** In the Gaussian random-intercept model donor $s$ receives weight proportional to $m_s/(1+(m_s-1)\rho)$, which tends to equal weights as $\rho$ grows; in an NB GLM on sums the IRLS weight is $\mu_{gs}/(1+\phi_g\mu_{gs})$, which grows with cell count and saturates. Mean aggregation removes the count scale and changes which donors dominate, which is why singlet sums.

**FDR.** Benjamini-Hochberg over the $G$ genes of a cell type gives $q_{(i)}=\min_{j\ge i}Gp_{(j)}/j$; control is proven under independence [R19], and correlated gene tests make it approximate.

**Estimands.** `log_fc` is the condition coefficient on the log2 scale, $\hat\beta_{1g}/\ln 2$: the log2 ratio of expected counts per unit library size between condition levels (a ratio of donor-level means, not a mean of cell-level ratios), and `log_fc_se` its standard error; `statistic` and `pvalue` test $\beta_{1g}=0$, or $|\beta_{1g}|\le$ a threshold when `lfc_threshold` is set; `fdr` is BH over the genes of one cell type, or of all cell types when `fdr_scope=global`. Ground truth: in B1 every gene is null (the expected pseudo-condition difference is zero over the random assignment); in B2 the planted log2 ratio of the group-B mean to the group-A mean, zero for equal-expression genes; in B3 binary membership of a gene set.

**Failure modes by family.**

- *Cell-level tests that ignore donors*: standard errors too small by $\sqrt{1+(m-1)\rho}$; rank-sum p-values depend on the cell count.
- *Pseudobulk NB and quasi-likelihood*: unstable at low counts, dispersion unreliable at small $S$, power limited by $S$, composition shifts bias donor means, and the tested gene set depends on the filter.
- *Cell-level mixed models*: singular fits and non-convergence for zero-heavy genes; NEBULA-LN assumes many cells per donor.
- *Donor-level precision-weighted models*: estimated weights, approximate normality of log-CPM, poorly determined random-effect variance with few donors.
- *Moderated statistics*: calibration depends on the prior degrees of freedom and variance when donors are few.
- *Benchmarks*: NB simulations favour NB methods; labels derived from the same data can absorb the condition effect; a random donor split can coincide with batch; the ranking of methods depends on the performance measure [R2][R3][R4].

Heuristics (rank tests, fold-change cut-offs) are fast, robust to outliers and often order strong effects sensibly, but lack a sampling model with donor-level variance. A model-based formulation gives each p-value a defined null, places covariates in a design matrix, yields a standard error per effect and allows shrinkage of dispersions and effects, which is what makes replicate-level calibration checkable (B1).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| edgeR quasi-likelihood on donor sums | model-based | Donor-by-cell-type sums enter an NB GLM after library-size normalisation, dispersions are estimated and shrunk, and the condition term is tested by the quasi-likelihood F-test (`glmQLFit`, `glmQLFTest`; `glmTreat` for a fold-change threshold) | [R9][R21] |
| DESeq2 via PyDESeq2 | model-based | NB GLM on donor sums with median-of-ratios size factors, a fitted dispersion trend with per-gene shrinkage and a Wald test; PyDESeq2 is a from-scratch re-implementation of the Wald-test path whose values can differ from R | [R8][R20] |
| limma-trend and limma-voom on donor profiles | model-based | Linear model on log-CPM with a mean-variance trend in the empirical Bayes step (trend) or voom precision weights, followed by moderated t | [R10] |
| dreamlet | model-based | Per cell type, sample and gene filtering, TMM, precision weights from sample cell counts and library sizes (`voomWithDreamWeights`), linear mixed model fit by `dream`, empirical Bayes | [R14] |
| muscat `pbDS` and `mmDS` | model-based wrapper | `pbDS` runs edgeR, DESeq2 or limma on sum pseudobulk per cluster; `mmDS` fits cell-level mixed models (default `dream2`, lme4 with voom weights) | [R6] |
| MAST with donor random effect | model-based | Two-part hurdle (discrete and continuous components); `zlm` fits mixed models through its `glmer` method when the formula has a random effect | [R11][R5] |
| NEBULA | model-based | NB gamma mixed model with a subject random effect; LN approximates the likelihood by the law of large numbers, HL uses an h-likelihood | [R13] |
| glmmTMB NB GLMM | model-based | Cell-level NB mixed model with donor random intercept fitted by Template Model Builder | [R12] |
| Naive cell-level Wilcoxon (scanpy) | heuristic | Rank-sum test on cells ignoring donors | [R1][R5] |

Pseudobulk with summed counts and an NB or moderated linear model is the published standard path (muscat `pbDS` [R6]; scran `pseudoBulkDGE` with covariates as design terms [R18]). Cell-level mixed models are the other family [R2], and precision-weighted donor models are the route for large atlases [R14]. The rank-sum test is kept as the pseudoreplication-prone negative control. Defaults for the methods singlet implements, read from source:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| muscat `pbDS` | `method`, `min_cells`, `filter`, `treat` | edgeR, 10, both, FALSE | `R/pbDS.R:85-87` @ 8616831 |
| muscat `pbDS` | sample outliers | `isOutlier` on library size, log scale, lower tail, 3 MADs | `R/pbDS.R:149` |
| muscat `pbDS` | too few samples | cell type returns NULL if any group has fewer than 2 samples or the design is rank deficient | `R/pbDS.R:152-155` |
| muscat `pbDS` | gene filter | `filterByExpr(counts, design)` only when the maximum count exceeds 100 | `R/pbDS.R:157` |
| muscat edgeR path | pipeline | `normLibSizes`, `estimateDisp`, `glmQLFit` (robust unset), `glmQLFTest` or `glmTreat` | `R/utils-pbDS.R:69-79` |
| muscat limma path | `trend`, `robust` | TRUE, TRUE for limma-trend; FALSE, FALSE for voom; `lmFit` weights are cells per sample | `R/utils-pbDS.R:131-139` |
| scran `pseudoBulkDGE` | `method`, `qualities`, `robust` | edgeR, TRUE, TRUE | `R/pseudoBulkDGE.R:146` @ 569d2f8 |
| scran `pseudoBulkDGE` | pipeline | `filterByExpr(design, group)`, `calcNormFactors`, `estimateDisp`, `glmQLFit(robust)`, `glmQLFTest` or `glmTreat` | `R/pseudoBulkDGE.R:238-263` |
| dreamlet `processAssays` | `min.cells`, `min.count`, `min.samples`, `min.prop`, `normalize.method` | 5, 5, 4, 0.4, TMM | `R/processAssays.R:187` @ 6ddcb83 |
| dreamlet `processAssays` | semantics | a sample needs `min.cells` cells; a cluster needs `min.samples` retained samples; a gene needs CPM above `min.count`/median library size × 10^6 (edgeR `filterByExpr`) in `min.prop` of samples | `R/processAssays.R:141-155` |
| dreamlet `dreamlet` | `min.cells`, `robust`, `use.eBayes` | 10, FALSE, TRUE | `R/dreamlet.R:713` |
| NEBULA | `model`, `method`, `cutoff_cell`, `kappa`, `opt` | NBGMM, LN, 20, 800, lbfgs | `R/nebula.R:43` @ 70593f9 |
| NEBULA | `cpc`, `mincp`, `reml`, `ncore` | 0.005, 5, 0, 2 | `R/nebula.R:44` |
| NEBULA | overdispersion bounds `min`, `max` | c(1e-4, 1e-4), c(10, 1000) | `R/nebula.R:42` |
| NEBULA | HL switch | `method` becomes HL when mean cells per subject is below 30; a gene is refit by HL when cells per subject × overdispersion is below `cutoff_cell` | `R/nebula.R:147-150`, `:19` |
| NEBULA | p-value | `pchisq(estimate^2 / variance, 1)` | `R/nebula.R:415` |
| PyDESeq2 | `fit_type`, `size_factors_fit_type`, `min_mu`, `refit_cooks`, `min_replicates` | parametric, ratio, 0.5, True, 7 | `src/pydeseq2/dds.py:174-181` @ 2ca3b74 |
| PyDESeq2 | size factors | median of ratios; iterative method when every gene has a zero count | `src/pydeseq2/dds.py:558` |
| PyDESeq2 | `alpha`, `cooks_filter`, `independent_filter`, `lfc_null` | 0.05, True, True, 0.0 | `src/pydeseq2/ds.py:101-105` |
| scanpy `rank_genes_groups` | `tie_correct` | False | `src/scanpy/tools/_rank_genes_groups.py:768` @ 8ed52d9 |

## 5. Proposed singlet approach

**Routes** (section 12): port PyDESeq2, NEBULA and scanpy's rank-sum; reimplement edgeR quasi-likelihood, limma and dreamlet from their papers and the defaults above; muscat, MAST, glmmTMB and the R packages run only as benchmark comparators.

**Default formulation.** The donor-level NB GLM with TMM offsets on donor sums, empirical-Bayes dispersions toward a trend and a quasi-likelihood F-test of the condition term (`edgeR_QL`, section 3) [R9]. Covariates enter the design as terms rather than as corrections applied to counts, as in scran's `pseudoBulkDGE` [R18]. A donor random intercept is not added to per-cell-type pseudobulk with one sample per donor (identifiability, section 3). Two research extensions stay out of the tool until they meet the benchmark criteria:

- **E1, learned dispersion trend**: fit the mean-dispersion trend offline on donor-level pseudobulk of catalogue datasets with donor identifiers and use it as the prior mean of the empirical-Bayes step. Falsified if it misses the B1 acceptance criterion or lowers B2 TPR more than 0.05 below the best pseudobulk comparator.
- **E2, pooled shrinkage of condition effects**: a zero-centred normal prior learned across genes and cell types, for ranking only (overlaps `markers-de.lfc_shrinkage_effect_size`). Falsified if it does not raise B3 split-half replicability or breaks the B1 criterion.

**Stack and kernels.** No neural network is needed; the per-gene models are small and hot, so they are hard-coded in CUDA. PyTorch is used only if E1 is fitted by gradient methods, at training time. K1: donor-by-cell aggregation as a sparse membership product (cuSPARSE or segmented reduction on CUDA) streaming over donor-sorted chunks; the donor matrix is $S\times G$ per cell type. K2: per-gene NB IRLS with batched $p\times p$ solves on CUDA, threads over genes on CPU. K3: empirical-Bayes dispersion and the F test, closed form per gene. K4: moderated $t$ and dreamlet mixed models. K5: BH by sort and cumulative minimum. Calibration mode repeats K1-K5 on seeded donor partitions. NEBULA needs per-donor sufficient statistics from the same streaming sweep.

**Defaults without asking.** `method=edgeR_QL`, `keys.cell_type=cell_type`, `keys.condition=condition`, `design.paired_donor_block=true`, `filters.min_cells_per_donor=10`, `filters.min_donors_per_group=2` with a warning below 4 (a proposal), `filters.libsize_outlier_nmads=3`, `filters.gene_filter=dreamlet`, `testing.robust_ebayes=true`, `testing.fdr_scope=within_cell_type`, `testing.alpha=0.05`. Ask for `keys.donor`. Run `mode=random_split_null` before trusting a result from few donors.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse non-negative integer | raw counts; normalised or log values are rejected |
| read | obs/<cell_type_key> | categorical | cell-type label defining each tested population |
| read | obs/<donor_key> | categorical | donor or sample identifier; the unit of inference |
| read | obs/<condition_key> | categorical, two or more levels | condition; constant within donor for a between-donor design |
| read | obs/<covariate_keys> | categorical or numeric | covariates named in `design.formula` |
| read | obs/size_factor | float | optional size factor from normalization.size_factor_estimation; offset for `nebula_LN`; without it donor library size with TMM is used |
| write | uns/de_replicate/<cell_type>/results | table | `gene`, `log_fc`, `log_fc_se`, `statistic`, `pvalue`, `fdr`, `tested`; `log_fc_se` is NaN where the method gives no standard error |
| write | uns/de_replicate/<cell_type>/calibration | table | `random_split_null` only: per-partition type I error at 0.05 and 0.01, lambda_GC, tested gene fraction |
| write | uns/pseudobulk/<cell_type> | float matrix | donor-by-gene sums and donor cell counts |
| write | models/<name> | metadata | method, design matrix, dispersions, prior parameters; `<name>` defaults to `de_replicate_<method>` |

`statistic` is the method's own statistic: F for `edgeR_QL`, Wald for `DESeq2`, moderated t for limma and dreamlet, a 1-df chi-square for `nebula_LN`, and the rank-sum z for `wilcoxon_naive`.

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Random seed; fixes the donor partitions in random_split_null mode. Condition DE is deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing uns/de_replicate and models members for the same cell types instead of failing. |
| `method` | string | "edgeR_QL" | `edgeR_QL`, `DESeq2`, `limma_voom`, `limma_trend`, `dreamlet`, `nebula_LN`, `wilcoxon_naive` | Test method. DESeq2 runs the PyDESeq2 port (Wald test); wilcoxon_naive ignores donors and is a negative control only. |
| `mode` | string | "condition_de" | `condition_de`, `random_split_null` | condition_de tests the real contrast. random_split_null reassigns conditions among donors to measure calibration; needs one true condition. |
| `keys` | object | required | — | Names of the obs columns and the counts layer. |
| `keys.donor` | string | — | — | obs column identifying the donor or sample; the unit of inference. |
| `keys.cell_type` | string | "cell_type" | — | obs column with cell-type labels; each cell type is tested separately. |
| `keys.condition` | string | "condition" | — | obs column with the condition; constant within donor for a between-donor design. |
| `keys.counts_layer` | string | "counts" | — | Layer holding raw counts. |
| `design` | object | — | — | Model specification. |
| `design.formula` | string | "" | — | Model formula over obs columns; must contain the condition term. Empty means ~ condition. |
| `design.contrast` | string | "" | — | Coefficient or contrast to test. Empty tests the second condition level against the first. |
| `design.paired_donor_block` | boolean | true | — | Add the donor as a blocking term when the condition varies within donor; ignored with a warning when constant within donor. |
| `filters` | object | — | — | Donor, cell-type and gene filters. |
| `filters.cell_types` | array | [] | — | Cell types to test; empty means all. |
| `filters.min_cells_per_donor` | integer | 10 | min 1 | A donor enters a cell type only with at least this many cells of that type. |
| `filters.min_donors_per_group` | integer | 2 | min 1 | Minimum donors per condition for a cell type to be tested; a warning is issued below 4. |
| `filters.libsize_outlier_nmads` | number | 3 | min 0 | Drop donors whose log library size is a lower-tail outlier beyond this many MADs; 0 disables. |
| `filters.gene_filter` | string | "dreamlet" | `dreamlet`, `filterByExpr` | dreamlet: min.count 5, min.prop 0.4, min.samples 4. filterByExpr: edgeR rule, applied only when the maximum count exceeds 100. |
| `testing` | object | — | — | Multiple testing, shrinkage and calibration options. |
| `testing.fdr_scope` | string | "within_cell_type" | `within_cell_type`, `global` | Apply Benjamini-Hochberg within each cell type or across all tested cell types. |
| `testing.alpha` | number | 0.05 | max 1; > 0 | Significance level for calls and calibration summaries. |
| `testing.robust_ebayes` | boolean | true | — | Robust empirical Bayes shrinkage; edgeR_QL, limma_voom and limma_trend only. |
| `testing.lfc_threshold` | number | 0 | min 0 | Test against this minimum absolute log2 fold change (TREAT-style); 0 tests against zero. edgeR_QL and limma only. |
| `testing.n_partitions_null` | integer | 20 | min 1 | Random donor partitions drawn in random_split_null mode. |
| `nebula` | object | — | — | nebula_LN options. |
| `nebula.cutoff_cell` | integer | 20 | min 1 | Refit a gene with the HL likelihood when cells per subject times cell-level overdispersion falls below this value. |
| `nebula.cpc` | number | 0.005 | min 0 | Genes with counts per cell below this value are not analysed. |
<!-- PARAMS:AUTO:END -->

Rules across parameters. `keys.donor` is required. `design.paired_donor_block` adds the donor as a fixed block for `edgeR_QL`, `DESeq2`, `limma_voom` and `limma_trend`, and as a random intercept for `dreamlet`; `nebula_LN` always fits a donor intercept on cells and `wilcoxon_naive` ignores donors. `testing.robust_ebayes` and `testing.lfc_threshold` apply to `edgeR_QL` and limma only, `nebula.*` to `nebula_LN` only, and `testing.n_partitions_null` and `seed` to `random_split_null`, which reassigns conditions among donors balanced by cell count. Cell types with too few donors in a condition, or with one condition, are skipped and listed with the reason.

## 7. MCP tool

Tool name `singlet_markers_de_replicate_aware_condition_de` (definition in `tasks/mcp/singlet_markers_de_replicate_aware_condition_de.json`).

```json
{"dataset": "./kang2018_pbmc.singlet", "method": "edgeR_QL",
 "keys": {"donor": "donor_id", "condition": "condition", "cell_type": "cell_type"},
 "design": {"paired_donor_block": true}}
```

```json
{"dataset": "./kang2018_pbmc.singlet", "status": "completed",
 "wrote": ["uns/de_replicate/<cell_type>/results", "uns/pseudobulk/<cell_type>", "models/de_replicate_edgeR_QL"],
 "summary": {"method": "edgeR_QL", "mode": "condition_de", "paired_donor_block_applied": true,
  "n_cell_types_tested": "<int>",
  "per_cell_type": {"<cell_type>": {"donors_per_condition": "<int>", "genes_tested": "<int>", "genes_fdr_le_alpha": "<int>"}},
  "skipped": {}, "warnings": []}, "provenance_id": "<id>", "job_id": null}
```

Long-running: large datasets are queued with a `job_id`. Stochastic: only in `random_split_null` mode, where `seed` fixes the partitions. Dry run: returns estimated seconds, peak memory in gigabytes and the device chosen.

## 8. Benchmarks

**Shared protocol.** Every benchmark runs each method per cell type with the defaults of section 4 (10 cells per donor, dreamlet gene filter, 3-MAD library-size outliers), two-sided tests and BH within cell type; the design is `~ condition`, or `~ donor + condition` for paired data (random donor intercept for `dreamlet`; `nebula_LN` always on cells). Comparators are the singlet implementations (`edgeR_QL`, `DESeq2`, `limma_trend`, `limma_voom`, `dreamlet`, `nebula_LN`, `wilcoxon_naive`) and the R callouts muscat `pbDS` edgeR, MAST with a donor random effect and glmmTMB, at the commits of section 12. Report means and standard deviations over partitions or seeds. Numeric thresholds are proposals. lambda_GC is computed from p-values, $\lambda_{GC}=\operatorname{median}_g\,F^{-1}_{\chi^2_1}(1-p_g)/0.4549$ with 0.4549 the median of $\chi^2_1$, so it is valid for every test statistic.

### B1. Donor-label permutation null on real control cells (proposed)

- **Goal**: measure false-positive calibration when no condition effect exists.
- **Ground truth**: planted null. Within one true condition, donors are split into two pseudo-conditions, so every gene is null: the expected pseudo-condition difference is zero over the random assignment, while real inter-donor differences remain as nuisance variance.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Kang et al. 2018, control cells only | GEO GSE96583 [R15]; ExperimentHub EH2259 (muscat vignette) | 10x droplet scRNA-seq, human PBMC; 8 control donors | — | 35 balanced 4-versus-4 partitions, $\binom{8}{4}/2$ |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| type I error | fraction of tested genes with raw p at most $\alpha\in\{0.05,0.01\}$, per cell type and partition | closer to $\alpha$; above is anticonservative | primary | — |
| BH discovery fraction | genes with $q\le0.05$ over tested genes, per cell type and partition | lower | primary | [R19] |
| lambda_GC | as defined in the shared protocol, per cell type | closer to 1 | guardrail | — |
| tested gene fraction | genes with a p-value over genes before filtering | higher at fixed type I error | guardrail | — |

- **Comparators**: shared set.
- **Protocol** (generator recipe): 1. Take the control cells with the dataset's cell-type labels. 2. Enumerate the 35 partitions. 3. Per partition and cell type, run every method with `~ pseudo_condition` and record p, q and lambda_GC.
- **Acceptance criterion** (proposed): for each pseudobulk comparator, type I error at 0.05 lies in 0.03 to 0.07 in at least 90 percent of cell-type-by-partition combinations and the median BH discovery fraction is at most 0.001. `wilcoxon_naive` is the negative control and should fail; if it passes, B1 is uninformative.
- **Known pitfalls**: the 35 partitions share donors and are not independent draws, and p-values are coarse with 4 donors per side, so report the spread; systematic donor differences give real signal rather than method error.

### B2. Planted differential expression in multi-sample simulation (published simulator)

- **Goal**: measure power and false discovery proportion for planted effects, and the gain from donor blocking in paired designs.
- **Ground truth**: planted simulation with muscat `simData` [R6] at `p_dd = c(0.9, 0, 0.1, 0, 0, 0)`: equal-expression ("ee", negative) and differentially expressed ("de", positive) genes, with class and planted log2 fold change (random sign) in `metadata(.)$gene_info`.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| `simData` on the Kang et al. reference | muscat [R6]; GEO GSE96583 [R15] | simulated 10x-style counts from 8 reference samples | — | sample-wise means from the reference |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| observed FDP | fraction of "ee" among genes with $q\le0.05$; 0 without discoveries | at most 0.05 | primary | [R6] |
| TPR | fraction of "de" genes with $q\le0.05$ | higher | primary | [R6] |
| AUROC | per cell type, $-\log_{10}p$, "de" versus "ee", tied ranks averaged | higher | primary | [R6] |
| fold-change recovery | Pearson r and median absolute error of `log_fc` versus planted log2 fold change, "de" genes | higher r, lower error | guardrail | [R6] |

- **Comparators**: shared set.
- **Protocol** (generator recipe): 1. Run `prepSim` on the reference. 2. Simulate unpaired designs with 4 donors per group (disjoint reference samples) and with 8 using `force = TRUE` (groups share the 8 reference samples, an optimistic arm), and a paired design (`paired = TRUE`, 8 donors). 3. Use 50, 200 and 800 mean cells per donor and cell type, plus an imbalanced arm via sample `probs`. 4. Use 20 or more seeds per setting; fit the paired arm with and without the donor term.
- **Acceptance criterion** (proposed): observed FDP at most 0.07 for each pseudobulk comparator in both unpaired arms; the default's TPR within 0.05 of the best pseudobulk comparator or higher; in the paired arm blocked TPR at least unblocked TPR, with FDP at most 0.07.
- **Known pitfalls**: NB simulation favours NB methods (see B3); `paired = TRUE` plants no donor-by-condition interaction.

### B3. Interferon-beta response in paired PBMC (published data, biological gene set)

- **Goal**: check that a method recovers the interferon response in donors sampled before and after stimulation and that its estimates replicate across donors.
- **Ground truth**: a coarse proxy, not per-gene truth: membership in the MSigDB Hallmark set HALLMARK_INTERFERON_ALPHA_RESPONSE (97 genes in the v7.5.1 symbols file distributed with the pegasus repository). Responding genes outside the set count as negatives, so AUROC is a lower bound.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Kang et al. 2018, control and IFN-beta cells | GEO GSE96583 [R15]; EH2259 | 10x droplet scRNA-seq, human PBMC; 8 lupus patients before and after 6 h of IFN-beta, 16 samples, about 29,000 cells before filtering | — | paired design; the donor enters as a block |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC of the gene set | per major cell type, score $-\log_{10}p$ over tested genes, label set membership, ties by average rank; major cell types are those retained by the default filters in all 8 donors | higher | primary | [R15] |
| split-half replicability | Spearman correlation of `log_fc` between two disjoint halves of 4 donors over the 100 genes with smallest full-data p; median over the 35 splits | higher | primary | [R15] |
| genes at $q\le0.05$ | count per cell type | reported | guardrail | — |

- **Comparators**: shared set with donor blocking.
- **Protocol**: fit `~ donor + condition` per cell type on the full data and on each of the 35 balanced splits (each half holds both conditions of its donors).
- **Acceptance criterion** (proposed): AUROC at least 0.75 in every major cell type and median split-half Spearman at least 0.8 for the default method.
- **Known pitfalls**: interferon-stimulated genes respond in most cell types, so the set is not a clean truth for each; a method that ignores pairing loses power rather than calibration, so report power as well as AUROC.

### P1. Performance and scaling

Wall time, peak memory and throughput (cells per second) at $10^4$, $10^5$, $10^6$ and $10^7$ cells (streaming aggregation is claimed), on CPU and CUDA, for `edgeR_QL`, `DESeq2`, `limma_voom`, `dreamlet`, `nebula_LN` and the R callouts muscat `pbDS` edgeR and glmmTMB. Inputs are NB counts generated from the B2 reference parameters with 8 to 200 donors, 10 to 30 cell types and $10^4$ tested genes. Hold fixed the thread count, gene filter, a two-group design with one covariate, hardware, and the donor and cell-type structure; report time per cell type and in total, and the spread over repeated runs. Acceptance (proposed): at fixed seed `log_fc` agrees across thread counts to a relative difference of at most $10^{-6}$; `edgeR_QL` is faster than the muscat edgeR path at $10^5$ cells and above; peak memory at $10^7$ cells is at most 1.5 times that at $10^6$ cells.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `demux.donor_assignment_reference_genotypes`: Reference-based genotype donor assignment with doublet calling and cluster-to-individual mapping
- **Feeds**:
  - `markers-de.lfc_shrinkage_effect_size`: Log fold-change shrinkage and effect-size ranking
  - `enrichment.preranked_gene_set_enrichment`: Preranked gene set enrichment on gene-level statistics
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
  - `sample-level.multi_sample_power_analysis`: Power and sample-number planning for multi-sample designs
- **Reads**: `layers/counts`, `obs/<cell_type_key>`, `obs/<donor_key>`, `obs/<condition_key>`, `obs/<covariate_keys>`, `obs/size_factor`
- **Writes**: `uns/de_replicate/<cell_type>/results`, `uns/de_replicate/<cell_type>/calibration`, `uns/pseudobulk/<cell_type>`, `models/<name>`
<!-- CHAINING:AUTO:END -->

Belongs to the multi-sample condition-comparison workflow: sample QC, annotation, size factors, this task, effect-size shrinkage, preranked enrichment. B1 doubles as the null-calibration check.

## 10. Risks, pitfalls and open questions

- **Few donors.** Calibration and power below a handful of donors per condition have no validated minimum in the sources; the warning at 4 donors per group is a proposal, and B2 covers 4 and 8 donors per group only.
- **Evidence level.** Statements about [R2]-[R5] and [R17] rest on abstracts and published summaries; their full texts and the authors of [R17] were not available. The voom, dream and edgeR quasi-likelihood method papers are not in the curated corpus, so limma-voom and the F-test are described from the muscat and scran code. edgeR and limma sources were not found in a public repository, so their licences and defaults are unrecorded. PyDESeq2 supports only Wald tests and its values can differ from R DESeq2.
- **Unsettled science.** The ranking of pseudobulk and mixed models ([R2]-[R5]), sum versus mean aggregation (only sums are implemented), composition-driven shifts, circular cell-type labels and the FDR scope.
- **Data.** The Kang et al. dataset licence is not stated in the sources; B1 has a single control cohort of 8 donors; donor-identifier coverage of the singlet catalogue is unchecked, which limits E1 and extra calibration cohorts.
- **Technical.** Mixed models fail to converge on zero-heavy genes; NEBULA switches to HL below 30 mean cells per subject, which changes its cost and approximation; log fold changes of low-count genes belong to `markers-de.lfc_shrinkage_effect_size`.
- **First experiment.** Run B1 with `edgeR_QL` on the 35 partitions of the Kang control cells, then the same with `wilcoxon_naive` to confirm that it fails.

## 11. References

R1. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R2. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)
R3. Murphy AE, Skene NG. A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nature Communications* 2022. doi:10.1038/s41467-022-35519-4 — verified (corpus)
R4. Zimmerman KD, Evans C, Langefeld CD. Reply to: A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nature Communications* 2022;13:7852. doi:10.1038/s41467-022-35520-x — verified (search)
R5. Junttila S, Smolander J, Elo LL. Benchmarking methods for detecting differential states between conditions from multi-subject single-cell RNA-seq data. *bioRxiv* 2022 (preprint). doi:10.1101/2022.02.16.480662 — verified (corpus)
R6. Crowell HL, Soneson C, Germain PL, et al. muscat detects subpopulation-specific state transitions from multi-sample multi-condition single-cell transcriptomics data. *Nature Communications* 2020. doi:10.1038/s41467-020-19894-4 — verified (corpus)
R7. Soneson C, Robinson MD. Bias, robustness and scalability in single-cell differential expression analysis. *Nature Methods* 2018;15(4):255-261. doi:10.1038/nmeth.4612 — verified (corpus)
R8. Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. *Genome Biology* 2014. doi:10.1186/s13059-014-0550-8 — verified (corpus)
R9. Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. *Bioinformatics* 2010 (published online 2009). doi:10.1093/bioinformatics/btp616 — verified (corpus)
R10. Ritchie ME, Phipson B, Wu D, Hu Y, Law CW, Shi W, Smyth GK. limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 2015. doi:10.1093/nar/gkv007 — verified (corpus)
R11. Finak G, McDavid A, Yajima M, et al. MAST: a flexible statistical framework for assessing transcriptional changes and characterizing heterogeneity in single-cell RNA sequencing data. *Genome Biology* 2015. doi:10.1186/s13059-015-0844-5 — verified (corpus)
R12. Brooks ME, Kristensen K, van Benthem KJ, et al. glmmTMB balances speed and flexibility among packages for zero-inflated generalized linear mixed modeling. *The R Journal* 2017. doi:10.32614/rj-2017-066 — verified (corpus)
R13. He L, Davila-Velderrain J, Sumida TS, Hafler DA, Kellis M, Kulminski AM. NEBULA is a fast negative binomial mixed model for differential or co-expression analysis of large-scale multi-subject single-cell data. *Communications Biology* 2021, article 629. doi:10.1038/s42003-021-02146-6 — verified (repo)
R14. Hoffman GE, et al. Efficient differential expression analysis of large-scale single cell transcriptomics data using dreamlet. *bioRxiv* (preprint). doi:10.1101/2023.03.17.533005; published as *Nature Communications* 2026, doi:10.1038/s41467-026-75680-8 (dreamlet README) — partial (corpus)
R15. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018;36(1):89-94. doi:10.1038/nbt.4042 — verified (corpus)
R16. Dann E, Henderson NC, Teichmann SA, Morgan MD, Marioni JC. Differential abundance testing on single-cell data using k-nearest neighbor graphs. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01033-z — verified (corpus)
R17. General solution to inflated type I and II errors in multi-subject single-cell differential gene expression analysis. *bioRxiv* 2023 (preprint). doi:10.1101/2023.01.09.523212 — partial (search)
R18. Lun ATL, Marioni JC. Overcoming confounding plate effects in differential expression analyses of single-cell RNA-seq data. *Biostatistics* 2017;18:451-464. — verified (repo)
R19. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B (Methodological)* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)
R20. Muzellec B, Telenczuk M, Cabeli V, Andreux M. PyDESeq2: a python package for bulk RNA-seq differential expression analysis. *Bioinformatics* 2023. doi:10.1093/bioinformatics/btad547 — verified (corpus)
R21. Robinson MD, Oshlack A. A scaling normalization method for differential expression analysis of RNA-seq data. *Genome Biology* 2010. doi:10.1186/gb-2010-11-3-r25 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/thelovelab/DESeq2 @ 76c5f85 | Michael Love (aut, cre); Simon Anders, Wolfgang Huber (aut, ctb); Constantin Ahlmann-Eltze, Anqi Zhu, Nikolaos Ignatiadis, Raphael Rossellini, Kwame Forbes (ctb), per DESCRIPTION | LGPL (>= 3) per DESCRIPTION (version 1.53.6) | reference NB GLM; parity comparator for PyDESeq2 | callout |
| https://github.com/owkin/PyDESeq2 @ 2ca3b74 | Boris Muzellec (maintainer, author); Maria Telenczuk, Vincent Cabelli, Mathieu Andreux (authors), per pyproject.toml | MIT (LICENSE, copyright 2022 Owkin) | Python implementation of DESeq2 | port |
| https://github.com/MarioniLab/scran @ 569d2f8 | Aaron Lun (aut, cre); Karsten Bach (aut); Jong Kyoung Kim, Antonio Scialdone (ctb), per DESCRIPTION | GPL-3 per DESCRIPTION (version 1.41.1) | `pseudoBulkDGE` call sequence and defaults | reimplement |
| https://github.com/HelenaLC/muscat @ 8616831 | Helena L. Crowell (aut, cre); Pierre-Luc Germain, Charlotte Soneson, Anthony Sonrel, Jeroen Gilis, Davide Risso, Lieven Clement (aut); Mark D. Robinson (aut, fnd), per DESCRIPTION | GPL-3 per DESCRIPTION (version 1.26.0) | `pbDS` defaults; `simData` generator; comparator | callout |
| https://github.com/DiseaseNeurogenomics/dreamlet @ 6ddcb83 | Gabriel Hoffman (aut, cre) per DESCRIPTION | Artistic-2.0 per DESCRIPTION (version 1.9.3) | the method and its defaults | reimplement |
| https://github.com/lhe17/nebula @ 70593f9 | Liang He (aut, cre); Raghav Sharma (ctb), per DESCRIPTION | MIT + file LICENSE per DESCRIPTION (version 1.5.8) | NEBULA-LN algorithm and defaults | port |
| https://github.com/RGLab/MAST @ d46c1d1 | Andrew McDavid (aut, cre); Greg Finak, Masanao Yajima (aut), per DESCRIPTION | GPL (>= 2) per DESCRIPTION (version 1.35.2) | hurdle model with random effect; comparator | callout |
| https://github.com/glmmTMB/glmmTMB @ 1db3b46 | Mollie Brooks (aut, cre); Ben Bolker, Kasper Kristensen and further authors, per glmmTMB/DESCRIPTION | AGPL-3 per glmmTMB/DESCRIPTION (version 1.1.15.9000) | cell-level NB GLMM comparator | callout |
| https://github.com/scverse/scanpy @ 8ed52d9 | scverse; LICENSE copyright lines name F. Alexander Wolf, P. Angerer and Theis Lab | BSD-3-Clause (LICENSE) | naive rank-sum baseline | port |
| https://github.com/lilab-bcb/pegasus | The Broad Institute, Inc. and The General Hospital Corporation (LICENSE copyright) | BSD 3-Clause (LICENSE) | distributes the Hallmark symbols file used for the B3 gene set | callout (data file only) |
| edgeR and limma (Bioconductor packages; no GitHub repository found) | Robinson MD, McCarthy DJ, Smyth GK (edgeR); Ritchie ME, Phipson B, Wu D, Hu Y, Law CW, Shi W, Smyth GK (limma), as in [R9] and [R10] | — | quasi-likelihood and moderated linear model definitions; comparators | reimplement |
