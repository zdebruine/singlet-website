---
id: markers-de.cell_level_two_group_de
title: Cell-level two-group differential expression
area: markers-de
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [clustering.cell_partitioning, normalization.size_factor_estimation]
feeds: [markers-de.cluster_marker_ranking, markers-de.lfc_shrinkage_effect_size, statistics.pvalue_null_calibration]
reads: [layers/counts, layers/log1p_norm, obs/<contrast_key>, obs/<covariate_keys>, obs/<donor_key>]
writes: [uns/de_cell_level, uns/de_cell_level_diagnostics]
devices: [cpu, cuda]
mcp_tool: singlet_markers_de_cell_level_two_group_de
evidence_basis: corpus+repo+web
last_reviewed: 2026-10-17
---

# Cell-level two-group differential expression

> Tests each gene for a difference between two groups of cells, treating every cell as an independent observation, and reports whether the resulting p-values are calibrated for that unit of inference.

## 1. Question

Which genes differ between two groups of cells when each cell is treated as an independent observation, and are the resulting p-values calibrated for that choice of unit? Input is one cell population with raw counts or log-normalised expression, a two-level group label per cell and optional per-cell covariates. Output is, per gene, a statistic, p-value, FDR-adjusted value, log fold change and rank. A correct answer ranks genes by the stated contrast with a null distribution that holds when cells are the true unit, and flags the contrast when they are not.

## 2. Why this task matters and where the field stands

Status: **contested**. Cell-level two-group DE is a common first step in single-cell workflows, but its p-values are only as valid as the unit of inference. When the group effect varies between donors or samples, treating cells as independent replicates inflates significance. This is the central warning of Squair et al. [R3], which the scanpy `rank_genes_groups` docstring repeats. Pseudobulk aggregation over donors and mixed models with a donor term avoid the problem. Benchmarks find that approaches which account for subject structure outperform naive cell-level tests such as the Wilcoxon test [R8], and that pseudobulk methods perform best [R7]; a practical correction for pseudoreplication has also been proposed [R6].

Where cells are the true unit, as in cell-line mixtures or simulations with independent cells, cell-level tests are appropriate and the remaining questions are power and dropout handling. Even there the field disagrees. The best-practices chapter reports low consensus across DE tools [R2], and notes that single-cell-specific methods are especially prone to labelling highly expressed genes as differentially expressed.

Open problems:

- No accepted diagnostic tells a user whether their design makes cells the unit of inference.
- scanpy's default test depends on its preset (t-test under ScanpyV1, Wilcoxon under ScanpyV2Preview), so results depend on configuration.

## 3. Theory and insight

Notation: a gene's value in cell $c$ of group $g\in\{1,2\}$ is $Y_{gc}$, group sizes are $n_1$ and $n_2$, and $N=n_1+n_2$. Under the cell-as-unit model all $Y_{gc}$ are independent given their group; in the rank formula $X_i$ and $Y_j$ are the group-1 and group-2 values.

**Rank test.** The Wilcoxon statistic counts cross-group pairs,

$$U=\sum_{i=1}^{n_1}\sum_{j=1}^{n_2}\Big(\mathbf 1[X_i>Y_j]+\tfrac12\mathbf 1[X_i=Y_j]\Big),\qquad \mathbb E_{H_0}[U]=\tfrac{n_1n_2}{2}.$$

So $U/(n_1n_2)$ estimates $P(X>Y)+\tfrac12P(X=Y)$: the chance that a random cell of group 1 exceeds a random cell of group 2, with ties counting half. Under exchangeability the tie-corrected variance is

$$\operatorname{Var}_{H_0}(U)=\frac{n_1n_2}{12}\Big[(N+1)-\frac{\sum_g(t_g^3-t_g)}{N(N-1)}\Big],$$

where $t_g$ is the size of each tie group. Zero-inflated counts create large tie groups at zero, so the uncorrected variance is mis-scaled there. The normal approximation needs large $n_1$ and $n_2$, and small samples need exact tables [R13]. The estimand is a stochastic-ordering probability, not a difference in expression level, so a rank signal can arise from a change in detection rate alone.

**Welch test.** $t=(\bar x_1-\bar x_2)/\sqrt{s_1^2/n_1+s_2^2/n_2}$ on log-normalised values estimates a difference in mean log expression. It is a Gaussian approximation to a skewed, zero-inflated variable and is poor for dropout-dominated genes. The reference distribution is the approximate Student t of [R14].

**Count and hurdle models.** The zero-inflated negative binomial (ZINB) model for one gene has

$$P(Y=0)=\pi+(1-\pi)f(0;\mu,\theta),\qquad P(Y=y)=(1-\pi)f(y;\mu,\theta)\ (y>0),$$

where $f$ is the negative binomial mass function, $\pi$ the dropout probability, and $\mathbb E[Y]=(1-\pi)\mu$. DEsingle fits this per group and tests all parameters jointly ($\chi^2_3$), dropout alone ($\pi_1=\pi_2$, $\chi^2_1$) and the negative binomial pair alone ($\chi^2_2$) [R9]. Its estimands are the group differences in $\pi$ and in $(\mu,\theta)$, identifiable only with enough expressing observations. MAST models detection and level separately,

$$\Pr(Z_{gc}=1)=\sigma(x_c^\top\gamma_g),\qquad Y_{gc}\mid Z_{gc}=1\sim\mathcal N(x_c^\top\beta_g,\sigma_g^2),\qquad Z_{gc}=\mathbf 1[Y_{gc}>0],$$

and its code combines the two likelihood-ratio parts into a two-degree-of-freedom test [R4]. Its default fit shrinks variances empirically, so the test is an approximation rather than a plain likelihood ratio. Its regime is a normal approximation to log expression among expressers with many expressing cells per group.

**Multiple testing.** For $m$ tested genes with sorted p-values $p_{(1)}\le\dots\le p_{(m)}$, the Benjamini-Hochberg adjusted value is $\hat q_{(i)}=\min_{j\ge i}\min(1,mp_{(j)}/j)$ [R12]. Its guarantee needs independent or positively dependent statistics. Cells from one donor are dependent, so the nominal level holds only when the cell is the true unit.

**Estimands.** Each output and ground-truth quantity has one estimand:

- Rank statistic: $U/(n_1n_2)$, on $[0,1]$.
- Log fold change for rank and t tests: difference of mean log-normalised expression in natural-log units. For MAST it is $\beta_g$; for DEsingle it is the difference in abundance parameters.
- Adjusted p-value: the BH value over tested genes after filtering.
- Planted-truth FDP: false calls divided by all calls at adjusted p at most 0.05, set to zero when nothing is called.
- Planted-truth TPR: planted-DE genes called divided by planted-DE genes.
- Donor-split rate: called genes divided by tested genes, for each donor split.

**Assumptions and failure modes.** Every family assumes cells are conditionally independent given group and that group is not confounded with donor, batch or detection rate. Pseudoreplication is the main failure: the p-value scales with cell count rather than donor count, so FDR inflates [R3]. A detection-rate or depth difference between groups yields significant genes with no change among expressers. Single-cell-specific tools over-call highly expressed genes, as the best-practices chapter reports. Mean-based tests miss changes in distribution shape. Simulations with independent cells favour cell-level tests by construction [R1].

**What a model adds.** The model-based methods add dropout handling, covariate adjustment and an explicit likelihood for calibration, and that calibration holds only under their stated model. Neither family calibrates a patient design without a donor-level null. The insight is that the unit of inference decides validity more than the choice of statistic.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Wilcoxon rank-sum on cells | heuristic | Rank test of stochastic ordering of expression between groups, each cell an independent observation | [R5], [R13] |
| Welch t-test on cells | heuristic | Unequal-variance t-test on log-normalised expression | [R5], [R14] |
| MAST hurdle | model-based | Logistic detection part and Gaussian level part among expressers, with covariates; combined two-degree-of-freedom likelihood-ratio statistic | [R4] |
| DEsingle ZINB LRT | model-based | Per-gene ZINB per group; overall, proportion-only and abundance-only tests; DEg, DEs and DEa classes | [R9] |
| Logistic regression, one-vs-rest | model-based | Classifier coefficients ranked per gene; yields scores rather than calibrated p-values | [R10] |

The rank test and the Welch test are the defaults that scanpy applies under its presets: the t-test under the ScanpyV1 preset, and the Wilcoxon test under ScanpyV2Preview, where it executes as wilcoxon_illico. MAST and DEsingle both appear in the conquer comparison [R1], and their primary source code is part of this specification (section 12). Logistic regression is kept as a discriminative reference only, because it returns scores rather than p-values and so is outside the proposed enum.

Paths below are relative to each repository root. Scanpy is at 8ed52d9, MAST at d46c1d1, DEsingle at 3cf7d9b, Splatter at eeb1dfc and csoneson/conquer_comparison at 3c93f77.

| Method | Parameter | Value | Source |
|---|---|---|---|
| scanpy rank_genes_groups | reference | rest | src/scanpy/tools/_rank_genes_groups.py:760 |
| scanpy rank_genes_groups | pts | False | src/scanpy/tools/_rank_genes_groups.py:763 |
| scanpy rank_genes_groups | corr_method | benjamini-hochberg | src/scanpy/tools/_rank_genes_groups.py:767 |
| scanpy Wilcoxon | tie_correct | False | src/scanpy/tools/_rank_genes_groups.py:768 |
| scanpy presets | method, ScanpyV1 | t-test, mean_in_log_space True | src/scanpy/_settings/presets.py:246-251 |
| scanpy presets | method, ScanpyV2Preview | wilcoxon, executed as wilcoxon_illico | src/scanpy/tools/_rank_genes_groups.py:893-896 |
| scanpy t-test | variance | Welch, equal_var False | src/scanpy/tools/_rank_genes_groups.py:501 |
| scanpy logreg | output | coefficients as scores; p-values only for t-test and Wilcoxon | src/scanpy/tools/_rank_genes_groups.py:588-600, 1031 |
| MAST zlm | method, ebayes, parallel | bayesglm, TRUE, TRUE | R/zeroinf.R:84 |
| MAST summary | doLRT | FALSE | R/ZlmFit.R:225 |
| MAST combined LRT | degrees of freedom | 2 (binomial 1, normal 1) | R/lrtest.R:38-40 |
| DEsingle overall LRT | degrees of freedom | 3 | R/DEsingle.R:480 |
| DEsingle proportion LRT | degrees of freedom | 1 | R/DEsingle.R:619 |
| DEsingle abundance LRT | degrees of freedom | 2 | R/DEsingle.R:621 |
| DEsingle multiple testing | method | Benjamini-Hochberg on each p-value | R/DEsingle.R:648-650 |
| DEsingle DEtype | threshold range | 0 < threshold at most 0.1 | R/DEtype.R:71-72 |
| DEsingle DEtype | classes | DEg if overall and both partial tests reach the threshold; DEs if proportion only; DEa if abundance only | R/DEtype.R:81-95 |
| Splatter planted DE | de.prob, de.downProb, de.facLoc, de.facScale | 0.1, 0.5, 0.1, 0.4 | R/AllClasses.R:258-261 |
| conquer simulate_data | log-fold-change draw | random sign times Gamma(shape 4, rate 2) | scripts/simulate_data.R:60 |

## 5. Proposed singlet approach

**Routes.** The Wilcoxon and Welch tests are ported from scanpy's implementations, MAST and DEsingle are reimplemented from their published descriptions and code, and the conquer comparison, Splatter and the GPU reference are callouts used only for benchmarks. The basis for each route is in section 12.

**Default.** The proposed default is the tie-corrected Wilcoxon test on log-normalised expression with a cell contrast. It is calibrated only when cells are the unit, so the tool reports a confounding diagnostic whenever a donor key is given and points to replicate-aware condition DE when group and donor are confounded. The default is falsified for a dataset if its mean FDP on mock splits exceeds 0.05 in more than 10 percent of combinations (B1).

**Model-based contribution.** singlet proposes a calibration layer rather than a new test. With `null_calibration` set, the tool builds an empirical null by permuting group labels among donors within cell type and study (or among cells where cells are the unit), and reports the fraction of tested genes called under that null. Offline, empirical-Bayes priors for DEsingle's ZINB dispersion and zero-inflation are fitted per gene and technology across the catalogue, so small groups borrow strength. The priors are falsified if they do not raise power on B3 at small group sizes without pushing the B2 rate above 0.05.

**ML stack.** Offline fitting of priors and any learned calibrator uses PyTorch. Inference kernels are hard-coded CUDA: per-gene rank computation by sorting or counting, sums for the t-test, and batched IRLS or EM for the two-to-five-column per-gene designs of MAST and DEsingle, with cuSPARSE for sparse-dense products. Exact Wilcoxon is in-core only, because the rapids-singlecell documentation excludes exact Wilcoxon from its out-of-core path (`docs/out_of_core.md`).

**Defaults an agent uses without asking.** Method wilcoxon with tie correction on; genes need at least 3 cells per group and 1 percent detection in one group; Benjamini-Hochberg at 0.05; layer auto. The tool default for `null_calibration` is none, and agents set donor_permutation whenever a donor key is present.

**Execution.** Streaming is not claimed: exact ranks need all cells of a gene in memory at once. The CPU path uses CSR input; CUDA keeps counts on the device for the duration of a gene batch.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts; required by desingle |
| read | layers/log1p_norm | sparse float32 | log-normalised expression for wilcoxon, t-test and mast |
| read | obs/<contrast_key> | categorical | two-level group label defining the contrast |
| read | obs/<covariate_keys> | numeric or categorical | covariates for mast, for example detection rate |
| read | obs/<donor_key> | categorical | donor or sample identifiers for calibration |
| write | uns/de_cell_level | table | per gene: statistic, p-value, adjusted p-value, log fold change, rank, cells per group, detection per group |
| write | uns/de_cell_level_diagnostics | table | donor-by-group cell counts, detection balance, confounding flag |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `seed` | integer | 0 | — | Permutation seed for inference.null_calibration; the test itself is deterministic. |
| `method` | string | "wilcoxon" | `wilcoxon`, `t-test`, `mast`, `desingle` | Two-group test: wilcoxon (rank, default), t-test (Welch), mast (hurdle) or desingle (ZINB likelihood ratio). |
| `contrast` | object | — | — | Group contrast: the two-level column in key, with group tested against reference. |
| `contrast.key` | string | — | — | obs column holding the two-level group label. |
| `contrast.group` | string | — | — | Level of the contrast column to test. |
| `contrast.reference` | string | "rest" | — | Comparison level, or rest for all other cells. |
| `layer` | string | "auto" | — | Expression layer; auto uses layers/log1p_norm for wilcoxon, t-test and mast, and layers/counts for desingle. |
| `covariates` | array | [] | — | obs columns added to the mast design, for example a detection-rate column; ignored by other methods. |
| `filters` | object | — | — | Gene filters applied before testing. |
| `filters.min_cells_per_group` | integer | 3 | min 1 | Genes with fewer cells than this in either group are not tested. |
| `filters.min_detect_frac` | number | 0.01 | min 0; max 1 | Minimum fraction of cells expressing the gene in at least one group. |
| `inference` | object | — | — | Multiple-testing and calibration settings. |
| `inference.fdr_threshold` | number | 0.05 | max 1; > 0 | Adjusted p-value threshold for calling a gene DE. |
| `inference.corr_method` | string | "benjamini-hochberg" | `benjamini-hochberg`, `bonferroni` | Multiple-testing correction across tested genes. |
| `inference.null_calibration` | string | "none" | `none`, `donor_permutation`, `cell_permutation` | Empirical null for calibrated FDR; donor_permutation needs donor_key. |
| `inference.donor_key` | string | — | — | obs column with donor or sample identifiers; required for donor_permutation. |
| `options` | object | — | — | Method-specific options; each block applies only to the method it names. |
| `options.wilcoxon` | object | — | — | Options for the wilcoxon method. |
| `options.wilcoxon.tie_correct` | boolean | true | — | Use the tie-corrected rank variance; recommended for zero-inflated data. |
| `options.mast` | object | — | — | Options for the mast method. |
| `options.mast.ebayes` | boolean | true | — | Empirical-Bayes variance shrinkage in the MAST fit, as in its default. |
| `options.desingle` | object | — | — | Options for the desingle method. |
| `options.desingle.type_threshold` | number | 0.05 | max 0.1; > 0 | Threshold for classifying DEs, DEa and DEg genes; must be in (0, 0.1]. |
<!-- PARAMS:AUTO:END -->

Which parameters apply: `method` selects one of four tests; `covariates` applies only to mast; each `options` block applies only to the method it names; `contrast.reference` set to rest is the one-versus-all contrast. `inference.donor_key` is required for donor_permutation and ignored otherwise. Validation: `contrast.group` must be a level of the contrast column, and an explicit `contrast.reference` must be another level; each compared group must have at least `filters.min_cells_per_group` cells. The call fails before any output is written if a check fails.

## 7. MCP tool

Tool name `singlet_markers_de_cell_level_two_group_de` (definition in `tasks/mcp/singlet_markers_de_cell_level_two_group_de.json`). Example call:

```json
{"dataset": "/path/to/example.singlet", "method": "wilcoxon", "contrast": {"key": "condition", "group": "stim", "reference": "ctrl"}, "inference": {"null_calibration": "donor_permutation", "donor_key": "donor"}, "seed": 0}
```

Example result, with placeholders for values:

```json
{"dataset": "/path/to/example.singlet", "status": "completed", "wrote": ["uns/de_cell_level", "uns/de_cell_level_diagnostics"], "summary": {"n_tested": "<int>", "n_called": "<int>", "calibration": {"called_fraction_under_null": "<float>"}, "confounding": ["<flag>"]}, "provenance_id": "<id>", "job_id": null}
```

Long-running: wilcoxon and t-test execute inline; mast and desingle queue as jobs on large inputs. Stochastic: deterministic unless `inference.null_calibration` is set, in which case `seed` fixes the permutations. Dry run: returns estimated seconds, peak memory and device from cell and gene counts without computing tests.

## 8. Benchmarks

**Shared protocol.** Where a planted or known truth exists, each accuracy benchmark reports, per method, the FDP and TPR at adjusted p at most 0.05 and the AUROC of the p-value ranking, with the estimands of section 3. Rank and t tests read log1p-normalised expression, MAST reads the same layer with detection covariates where stated, and DEsingle reads counts. Untested genes count as not called. Each benchmark states its own seeds, subset sizes and dataset identifiers, so comparisons are made within a benchmark only.

### B1. Soneson and Robinson 2018 mock and planted designs

- **Goal**: Measure false discovery control under a true null and power under planted DE for cell-level tests on real subsets of several sizes [R1].
- **Ground truth**: Random-assignment null (mock) and planted simulation (sim123). In the mock design one population (the 16-cell stage blastomere group of GSE45719) is split at random into two groups (scripts/generate_subsets.R), so every gene is null by construction. In the sim123 design, counts are simulated with powsim from a real dataset (scripts/simulate_data.R), and the planted fold changes are a random sign times a Gamma draw with shape 4 and rate 2 (scripts/simulate_data.R; see section 4), so the truth is the simulator's gene-level DE indicator.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| GSE45719, GSE74596, EMTAB2805, GSE63818-GPL16791, GSE60749-GPL13112, GSE48968-GPL13112, UsoskinGSE59739, GSE62270-GPL17021, 10XMonoCytoT; mock variants of eight of them; sim123 variants of GSE45719, GSE74596 and GSE60749-GPL13112 | conquer_comparison include_datasets.mk; data bundle described in its README [R1] | scRNA-seq; subset sizes and replicate counts per dataset as in each config (GSE45719 mock: 24, 12, 6 with 1, 5, 5 replicates; GSE45719 sim123: 50, 24, 12, 6 with 1, 5, 5, 5); seed 42 in the configs | — | Mock uses one population split at random; sim123 uses two populations named in its config |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| FDP at adjusted p at most 0.05 | False calls divided by called genes; zero when nothing is called (convention used here) | minimise, target at most 0.05 | primary | [R1] |
| TPR at adjusted p at most 0.05 | Planted-DE genes called divided by planted-DE genes (sim123) | maximise | primary | [R1] |
| AUROC of p-values | Area under the ROC of the p-value ranking against truth; scores used only where a method gives no p-values | maximise | primary | [R1] |

- **Comparators**: Wilcoxon and Welch t-test as applied in the conquer scripts (apply_Wilcoxon.R, which uses TMM-normalised CPM from TPM and a per-gene wilcox.test; apply_ttest.R); MAST as in apply_MASTcpm.R and apply_MASTcpmDetRate.R; DEsingle as in apply_DEsingle.R.
- **Protocol**: Apply each comparator to every subset size and replicate, using the conquer subsets and their gene filters (include_filterings.mk). Score against the design-specific truth, and report mean and range across replicates.
- **Acceptance criterion**: Proposed, not from the publication. A cell-level method meets the calibration gate if its mean FDP on mock subsets is at most 0.05 in at least 90 percent of dataset, size and replicate combinations. Power is reported as mean TPR with replicate range on sim123 at the same sizes, without a threshold.
- **Known pitfalls**: Sim123 cells are independent draws, so B1 cannot expose pseudoreplication; B2 tests that directly. The mock split is random over one population, so any plate or batch structure in the source data becomes a confounder of the split.

### B2. Donor-split null on multi-donor data (proposed)

- **Goal**: Measure how often each cell-level method calls genes when donors, not cells, are the true unit and no donor-level difference exists [R3, R6].
- **Ground truth**: Donor-level null by construction. Only control cells are used, so no condition effect is present, and donors are assigned to pseudo-groups, so any call is false.
- **Recipe**:
  1. Choose one cell type with at least 8 donors, each contributing at least 3 cells.
  2. Keep control cells of that type only.
  3. Enumerate the 35 unordered splits of the donors into two pseudo-groups of four donors each.
  4. For each split, assign every cell its donor's pseudo-group, and apply each method with cells as the unit and no donor term.
  5. Record the called fraction per split and method, then report its mean and range.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Kang et al. 2018 PBMC interferon-beta data | Described in the best-practices chapter [R11] | scRNA-seq, human PBMC; 8 donors, 16 samples (control and stimulated) | — | Use control cells only |
| Any singlet catalogue dataset with at least 8 donors | singlet catalogue | scRNA-seq; size per recipe | — | Used as the second dataset |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Called fraction at adjusted p at most 0.05 | Called genes divided by tested genes, per split; mean over the 35 splits | minimise; calibrated if at most 0.05 | primary | [R12] |
| Split range | Minimum and maximum of the per-split called fraction | report | guardrail | [R12] |

- **Comparators**: Wilcoxon, Welch t-test, MAST and DEsingle, as in section 4. The donor-level pseudobulk reference is computed by the replicate-aware task.
- **Protocol**: Apply each method at `contrast` set to the pseudo-groups with `null_calibration` none. Evaluate the calibration layer on a different cell type or dataset from the one used to build its null, so the check is not circular.
- **Acceptance criterion**: Proposed. A method is calibrated for donor designs if its mean called fraction is at most 0.05; it is flagged anti-conservative if the mean exceeds 0.05 by a margin fixed in advance.
- **Known pitfalls**: Sex-linked and genotype-dependent genes differ between donors in fact, so some splits contain true donor-level DE; exclude them or stratify splits by sex. The 35 splits share donors, so their values are correlated and are reported as a range, not as independent replicates.

### B3. Planted-DE power on Splatter simulations (proposed)

- **Goal**: Measure power and FDP of cell-level tests when DE is planted and cells are independent, as a power reference for B1 [R15].
- **Ground truth**: Gene-level DE indicator set by the simulator. Splatter's planted DE uses a per-gene probability, a downward fraction and log-normal fold changes (defaults in section 4).
- **Recipe**:
  1. Fit Splatter's gene-level parameters to one catalogue dataset.
  2. Simulate two groups. Keep the Splatter defaults for the DE probability (0.1), downward fraction (0.5) and fold-change scale (0.4), and vary the fold-change location over 0.1 (default) and 0.5 (proposed).
  3. Use cells per group of 6, 12, 24 and 50 (the B1 sizes) and 500 (proposed).
  4. Use 10 seeds per setting (proposed).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter simulated counts | Splatter [R15]; simulator code in section 12 | simulated scRNA-seq; cells per group as recipe | not applicable | Independent cells; planted DE |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| TPR at adjusted p at most 0.05 | Planted-DE genes called divided by planted-DE genes; mean and range across seeds | maximise | primary | [R15] |
| FDP at adjusted p at most 0.05 | False calls divided by all calls; zero if none | minimise | primary | [R15] |

- **Comparators**: Wilcoxon, Welch t-test, MAST and DEsingle.
- **Protocol**: Apply each method to each setting and seed; plot TPR against cells per group at the fixed FDP rule.
- **Acceptance criterion**: Proposed. Report mean TPR with the replicate range at each size; no literature threshold exists.
- **Known pitfalls**: Large fold changes make all methods look alike, so the fold-change grid must include small values.

### P1. Performance and scaling

Wall time, peak memory and throughput at 10k, 100k and 1M cells, on CPU and CUDA, with two balanced groups and 20,000 genes (proposed). Comparators: scanpy wilcoxon with tie correction on and off, scanpy t-test, rapids-singlecell exact Wilcoxon and its binned variant (an approximation, per its documentation), MAST and DEsingle. Hold fixed the input format (CSR float32), thread count, hardware, tie-correction setting and gene filter. Exact and binned results are reported separately. Proposed acceptance: singlet's CPU Wilcoxon p-values agree with scanpy's exact Wilcoxon to a relative error of 1e-6 or better.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Feeds**:
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `markers-de.lfc_shrinkage_effect_size`: Log fold-change shrinkage and effect-size ranking
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
- **Reads**: `layers/counts`, `layers/log1p_norm`, `obs/<contrast_key>`, `obs/<covariate_keys>`, `obs/<donor_key>`
- **Writes**: `uns/de_cell_level`, `uns/de_cell_level_diagnostics`
<!-- CHAINING:AUTO:END -->

This task follows clustering and normalisation, and its outputs feed marker ranking and effect-size shrinkage. Donor designs leave this recipe for markers-de.replicate_aware_condition_de.

## 10. Risks, pitfalls and open questions

- **Evidence not reproduced here**: The quantitative false-positive results of Squair et al. [R3] are not used; their pseudoreplication claim is cited only through the scanpy warning, which attributes it to them.
- **Published results**: The results of Soneson and Robinson [R1] are not reproduced here. B1 uses the design files of the conquer comparison (section 12), and the dataset licences are not stated.
- **Excluded methods**: SCDE [R18] (its code and paper are not part of this specification), ZINB-WaVE observation weights [R17] (its source is not part of this specification), and edgeR and DESeq2 applied to cells [R19, R20] (their package sources are not part of this specification; only the conquer apply scripts are). None appears in the tables or the enum.
- **Excluded benchmark**: The cell-line mixture design of Tian et al. [R16] is not used, because its truth definition is not stated here.
- **Unsettled literature**: Whether dropout modelling improves calibration or power over the rank test on real data [R1] is open. The wilcoxon_illico implementation depends on an external package outside this specification. The accuracy cost of the binned Wilcoxon variant is uncharacterised.
- **Version risk**: The DEsingle README links a 1.0.5 Bioconductor tarball while its DESCRIPTION gives 1.19.1. The first experiment is B2 on Kang control cells over all 35 splits, for wilcoxon and mast with and without detection covariates.

## 11. References

R1. Soneson C, Robinson MD. Bias, robustness and scalability in single-cell differential expression analysis. *Nature Methods* 2018. doi:10.1038/nmeth.4612 — verified (corpus)
R2. Wang T, Li B, Nelson CE, Nabavi S. Comparative analysis of differential gene expression analysis tools for single-cell RNA sequencing data. *BMC Bioinformatics* 2019. doi:10.1186/s12859-019-2599-6 — verified (corpus)
R3. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R4. Finak G, McDavid A, Yajima M, et al. MAST: a flexible statistical framework for assessing transcriptional changes and characterizing heterogeneity in single-cell RNA sequencing data. *Genome Biology* 2015. doi:10.1186/s13059-015-0844-5 — verified (corpus)
R5. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R6. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)
R7. Murphy AE, Skene NG. A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nature Communications* 2022. doi:10.1038/s41467-022-35519-4 — verified (corpus)
R8. Junttila S, Smolander J, Elo LL. Benchmarking methods for detecting differential states between conditions from multi-subject single-cell RNA-seq data. *bioRxiv* 2022. doi:10.1101/2022.02.16.480662 — verified (corpus)
R9. Miao Z, et al. DEsingle for detecting three types of differential expression in single-cell RNA-seq data. *Bioinformatics* 2018. doi:10.1093/bioinformatics/bty332 — verified (corpus)
R10. Ntranos V, Yi L, Melsted P, Pachter L. A discriminative learning approach to differential expression analysis for single-cell RNA-seq. *Nature Methods* 2019. doi:10.1038/s41592-018-0303-9 — verified (corpus)
R11. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018. — verified (corpus)
R12. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)
R13. Mann HB, Whitney DR. On a test of whether one of two random variables is stochastically larger than the other. *Annals of Mathematical Statistics* 18(1):50–60, 1947. doi:10.1214/aoms/1177730491 — verified (search)
R14. Welch BL. The generalization of Student's problem when several different population variances are involved. *Biometrika* 34(1/2):28–35, 1947. doi:10.2307/2332510 — verified (search)
R15. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R16. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R17. Van den Berge K, et al. Observation weights unlock bulk RNA-seq tools for zero inflation and single-cell applications. *Genome Biology* 2018. doi:10.1186/s13059-018-1406-4 — verified (corpus)
R18. Kharchenko PV, Silberstein L, Scadden DT. Bayesian approach to single-cell differential expression analysis. *Nature Methods* 2014. doi:10.1038/nmeth.2967 — verified (corpus)
R19. Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. *Bioinformatics* 2009. doi:10.1093/bioinformatics/btp616 — verified (corpus)
R20. Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. *Genome Biology* 2014. doi:10.1186/s13059-014-0550-8 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | F. Alexander Wolf, P. Angerer, Theis Lab (2017); scverse (2025), per LICENSE | BSD-3-Clause (LICENSE) | Wilcoxon, t-test and logreg semantics and defaults | port (Wilcoxon, t-test) |
| https://github.com/RGLab/MAST | Andrew McDavid (aut, cre); Greg Finak (aut); Masanao Yajima (aut), per DESCRIPTION | GPL (>= 2) (DESCRIPTION; no LICENSE file at root) | hurdle model and combined test | reimplement |
| https://github.com/miaozhun/DEsingle | Zhun Miao (author and maintainer), per DESCRIPTION | GPL-2 (DESCRIPTION; no LICENSE file at root) | ZINB likelihood-ratio tests and DEtype classes | reimplement |
| https://github.com/csoneson/conquer_comparison | Charlotte Soneson (copyright 2018, per LICENSE) | MIT (LICENSE) | design of benchmark B1 and dataset identifiers | callout |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Alicia Oshlack (aut); Christina Azodi (ctb), per DESCRIPTION | GPL-3 (DESCRIPTION: GPL-3 + file LICENSE; LICENSE file is GPL version 3) | simulator for benchmark B3 | callout |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (copyright 2022) and scverse (copyright 2025), per LICENSE | MIT (LICENSE) | GPU exact and binned Wilcoxon reference for P1 | callout |
