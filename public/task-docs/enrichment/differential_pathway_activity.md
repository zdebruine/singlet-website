---
id: enrichment.differential_pathway_activity
title: Replicate-aware differential activity of pathways, regulons and programs between conditions
area: enrichment
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [annotation.cluster_label_assignment, qc.sample_level_qc, markers-de.replicate_aware_condition_de, enrichment.pathway_resource_curation]
feeds: [statistics.pvalue_null_calibration, statistics.multiple_testing_control, sample-level.multi_sample_power_analysis]
reads: [layers/counts, obs/<donor_key>, obs/<cell_type_key>, obs/<condition_key>, obs/<covariate_keys>, obsm/<score_key>, uns/<resource_name>]
writes: [uns/pathway_de/<method>/<cell_type>, uns/pathway_de/<method>/null, models/pathway_de_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_enrichment_differential_pathway_activity
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Replicate-aware differential activity of pathways, regulons and programs between conditions

> Test whether pathway, regulon or program activity differs between conditions within each cell type when donors or samples are the replicates, returning donor-level effects, standard errors, p-values and FDR calibrated by donor-label permutation.

## 1. Question

Within one annotated cell type, does the activity of a pathway, TF regulon, gene program or metabolic pathway differ between conditions when donors or biological samples, not cells, are the replicates? Inputs are raw UMI counts with donor, cell-type and condition labels, optional covariates, and a gene-set or signed footprint resource. Per pathway and cell type the output is an effect, its standard error, a statistic, a p-value and a Benjamini-Hochberg FDR across pathways [R17]. A correct answer has the nominal false-positive rate under a donor-level null and recovers planted or expected effects.

## 2. Why this task matters and where the field stands

Case-control and treated-versus-untreated studies usually sample many cells from few donors. When the condition is constant within a donor, cells from one donor share genotype, sex, handling and batch, so counting cells as replicates shrinks standard errors and inflates significance. Single-cell differential expression tests that do this produce many false discoveries [R1], and a practical remedy for this pseudoreplication bias has been proposed [R2]. Pathway-level tests add two dependence problems. Genes inside a pathway are correlated and gene sets overlap. Competitive tests compare a set with the rest of the genome and sample genes, not donors [R6]; self-contained tests need the donor as the sampling unit. Enrichment on gene-level statistics [R7] therefore inherits both problems.

Status: **contested**. Donor-level inference is the accepted unit; the pathway-level method is not settled. Murphy and Skene report superior performance of pseudobulk methods under a balanced performance measure [R3]. Junttila et al. benchmark differential-state methods on multi-subject data [R4], and muscat supplies a pseudobulk and mixed-model framework for multi-sample, multi-condition data [R5]. No cited benchmark covers pathway activity on donor-replicated data, so no accepted pathway-level standard is cited. Open problems:

- **Calibration of competitive statistics**: whether gene-set tests can be calibrated against donor permutations when sets overlap heavily.
- **Few donors**: the donor count needed for a valid test is unknown, and permutation floors bind early.
- **Aggregation**: the choice between sum and mean of cell values is unresolved.
- **Resource dependence**: whether signed footprints [R9] and regulons [R20] give concordant donor-level results is an empirical question.
- **Composition**: a shift in cell-type proportions moves donor-level scores without any change inside a cell state.

## 3. Theory and insight

Notation: donors $s=1,\dots,S$; $m_s$ cells of one cell type in donor $s$; genes $g$; pathways $k$; $\mathbf x_s\in\mathbb R^p$ holds the condition indicator (constant within donor) and covariates; $N_s$ is the donor library size.

**Pseudobulk model.** Donor sums $Y_{gs}=\sum_{i\in s}y_{gi}$ follow a negative binomial (NB) GLM,

$$Y_{gs}\sim\mathrm{NB}(\mu_{gs},\phi_g),\qquad \log\mu_{gs}=\log N_s+\mathbf x_s^{\top}\boldsymbol\beta_g,\tag{1}$$

with per-gene dispersion shrunk toward a trend, as in edgeR [R10] and DESeq2 [R11]. Residual degrees of freedom come from $S-p$, not from the cell count. The regime is a donor-level NB approximation with large counts ($\mu\gg1$), $S>p$ and reliable dispersions; with few donors the shrinkage prior carries most of the calibration.

**Design effect.** For a donor-level score with intraclass correlation $\rho=\sigma_u^2/(\sigma_u^2+\sigma_w^2)$ and $m$ cells per donor, a pooled cell-level test understates the variance of a two-group contrast:

$$\frac{\mathrm{Var}_{\mathrm{true}}(\hat\Delta)}{\mathrm{Var}_{\mathrm{naive}}(\hat\Delta)}=1+(m-1)\rho.\tag{2}$$

The naive standard error is too small by $\sqrt{1+(m-1)\rho}$; for $m=100$ and $\rho=0.05$ the variance is inflated 5.95-fold and the standard error 2.44-fold. The regime is balanced donors and cells, Gaussian scores and a condition constant within donor. A group mean has variance $\sigma_u^2/S+\sigma_w^2/(Sm)$, so cells per donor reduce only the second term and the number of donors sets power.

**Signed linear model.** Given gene-level contrast statistics $t_g$ from a donor-aware model and signed footprint weights $w_{gk}$ (zero when gene $g$ is absent from source $k$), each source is scored by

$$t_g=\beta_{0k}+\beta_{1k}w_{gk}+e_g,\qquad \mathrm{score}_k=\hat\beta_{1k}/\widehat{\mathrm{se}}(\hat\beta_{1k}),\tag{3}$$

on $n-2$ residual degrees of freedom. The t reference assumes independent genes, which fails for correlated pathway genes, so calibration must come from the donor null.

**Donor-label permutation.** Permuting the condition label across donors within a cell type, and recomputing (1) and (3) for each permutation $\pi$, gives

$$p_k=\frac{1+\#\{\pi:\ |T_k^{\pi}|\ge|T_k|\}}{B+1}.\tag{4}$$

The number of distinct assignments bounds the smallest attainable p-value: for 8 donors split 4 versus 4 there are $\binom{8}{4}=70$ assignments, so no exact p-value falls below about $1/70$. The regime is exchangeable donors within cell type under the null.

**Estimands.** Each output and truth is defined as follows.

- The pseudobulk coefficient $\beta_{1g}$ is the natural-log ratio (the scale of eq. 1) of donor-level expected counts per unit library size between condition levels, a ratio of donor-level means rather than a mean of cell-level ratios.
- The slope $\beta_{1k}$ of eq. (3) is the change in gene-level contrast $t$ per unit footprint weight, and the reported score is its $t$ value.
- The planted shift in B2 is the difference between condition-group means of donor-level pathway activity, in units of the within-cell-type donor standard deviation, so it is dimensionless.
- The null truth in B1 is $\beta_{1k}=0$ by construction, because donor labels are permuted.
- The expected direction in B3 is the sign of the donor-level effect, fixed before analysis.
- The inflation ratio in B4 is the ratio of standard deviations of null z-statistics from two tests, dimensionless and predicted by eq. (2).

**Failure modes.**

- Cell-level tests that ignore donors understate standard errors by the factor in eq. (2).
- Rank-based per-cell scores have no donor-level sampling model and can distort condition effects.
- With few donors, variances and degrees of freedom are unstable and exact p-values are coarse.
- Overlapping sets, such as two interferon signalling sets, are counted as separate support.
- Pathway activity methods differ in accuracy, stability and scalability on scRNA-seq data [R19], and bulk footprint tools applied to single-cell data have been benchmarked against single-cell tools [R18].
- Composition shifts move donor-level scores; include proportions as covariates or report composition-adjusted results.

**Insight.** The inferential unit is the donor. Cell-level statistics understate variance by the factor in eq. (2), and extra cells per donor add precision only within donors, so power is set by donor count. Pathway statistics add gene correlation and set overlap on top. Donor-label permutation supplies a null that respects the sampling unit and is therefore the calibration reference for B1. Heuristic scores (GSVA, AUCell with donor means) are fast, but their p-values carry no donor-level sampling model, so they are kept as comparators. A model-based formulation adds a stated null, covariates in a design matrix, a standard error for every effect, and shrinkage that planted effects can test (B2).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| decoupler pseudobulk with signed ULM | model-based | Donor-by-cell-type sums are tested per gene with a donor-aware model; decoupler's ULM then fits eq. (3) per signed footprint and reports the t value | [R8][R9] |
| muscat pbDS (edgeR) | model-based | Summed pseudobulk per cell type in an edgeR quasi-likelihood model; supplies gene statistics | [R5][R10] |
| muscat mmDS (dream2) | model-based | Cell-level linear mixed model with a donor random effect on voom-type weights | [R5] |
| dreamlet | model-based | Donor-level precision-weighted linear mixed model with empirical Bayes moderation | [R13] |
| NEBULA | model-based | Cell-level negative binomial mixed model with a subject random effect | [R14] |
| MAST hurdle GLM | model-based | Two-part GLM per gene at cell level; the comparator omits the donor term although MAST has an lmer/glmer wrapper | [R15] |
| GSVA on donor pseudobulk | heuristic | GSVA scores (rank-based, kernel CDF with kcdf gaussian by default) per donor pseudobulk, tested with a donor-level limma model | [R12][R8] |
| AUCell scores with donor means | heuristic | Per-cell rank-based set scores averaged per donor, then a linear test | [R16] |
| Donor-label permutation | heuristic | Recomputes any statistic under permuted donor labels within cell type (eq. 4) | — (singlet design) |

Pseudobulk models with donor-level replicates are the route the cited benchmarks favour for gene-level condition effects [R1][R3]; cell-level mixed models [R5] and donor-level precision-weighted models [R13] are the alternatives. For pathway activity the proposed route is a donor-aware gene statistic followed by the signed linear model of eq. (3). The rank-based per-cell route is kept only as the pseudoreplication-prone comparator, and gene-set tests without a donor null are excluded from the default for the reasons in section 3.

Defaults and source-stated values for the methods singlet implements:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| decoupler-py | pseudobulk aggregation | sum | `src/decoupler/pp/anndata.py:312` @ 3132edc |
| decoupler-py | filter_samples min_cells | 10 | `src/decoupler/pp/anndata.py:442` @ 3132edc |
| decoupler-py | filter_samples min_counts | 1000 | `src/decoupler/pp/anndata.py:443` @ 3132edc |
| decoupler-py | tmin in mt.run and query_set | 5 | `src/decoupler/mt/_run.py:48`, `src/decoupler/mt/_query_set.py:18` @ 3132edc |
| decoupler-py | tmin in ULM docstring example | 3 | `src/decoupler/mt/_ulm.py:93` @ 3132edc |
| decoupler-py | ULM score | t value of slope on residual df | `src/decoupler/mt/_ulm.py:61-106` @ 3132edc |
| decoupler-py | GSVA kcdf | gaussian or poisson; poisson requires integer input | `src/decoupler/mt/_gsva.py:123-135` @ 3132edc |
| decoupler-py | GSVA kcdf default | gaussian | `src/decoupler/mt/_gsva.py:296` @ 3132edc |
| muscat pbDS | method | edgeR (first option) | `R/pbDS.R:84-85` @ 8616831 |
| muscat pbDS | min_cells | 10 | `R/pbDS.R:86` @ 8616831 |
| muscat pbDS | filter | both (genes and samples) | `R/pbDS.R:87` @ 8616831 |
| muscat mmDS | method | dream2 (lme4 with voom weights) | `R/mmDS.R:12, 68` @ 8616831 |
| muscat mmDS | ddf | Satterthwaite | `R/mmDS.R:72` @ 8616831 |
| muscat mmDS | n_cells, n_samples, min_count, min_cells | 10, 2, 1, 20 | `R/mmDS.R:68-69` @ 8616831 |

## 5. Proposed singlet approach

**Routes.** The decoupler ULM and GSVA code is ported (routes in section 12). The muscat, dreamlet, NEBULA, MAST and AUCell implementations are callouts, used only as comparators. The gene-level statistic of the default comes from the donor-aware condition model of `markers-de.replicate_aware_condition_de`, so this task fits no second DE model. Methods that supply gene statistics (decoupler, muscat, dreamlet) differ only in that gene model; the pathway step, eq. (3), is shared, so B1 and B2 isolate the gene model.

**Model-based formulation.** A donor-aware gene contrast $t_g$, then eq. (3) per pathway and cell type, with p-values from eq. (4). Each permutation recomputes $t_g$ and eq. (3), so the null keeps within-donor correlation. A learned prior on donor variance across pathways, fitted offline on catalogue donors, is an extension (E1) that is added only if it improves B1 and B2. The default is falsified if its B1 rejection rate leaves the band in section 8, if its B2 power at matched false-positive rate is below the best calibrated comparator, or if its B3 hit rate is below 0.8.

**Stack and kernels.** No neural network is needed; PyTorch is used only for the offline fit of E1. Hard-coded CUDA covers the hot kernels: K1 donor-by-cell aggregation as a sparse membership product, streamed over donor-sorted chunks; K2 closed-form slopes and t values for the sparse footprint matrix, $O(GK)$; K3 the permutation loop, which refits the gene model and K2 for each labelling; K4 Benjamini-Hochberg by sort and cumulative minimum. CPU builds thread over pathways.

**Cost and enumeration.** Permutation nulls multiply cost by $B$ and are timed separately (P1). When the number of distinct assignments is at most $B$, the call enumerates them all.

**Rules.** Cell-level units are refused for condition tests. A cell type with fewer than `min_donors_per_group` donors in a level is skipped and listed. Every calibrated result reports its permutation floor, $1/\binom{S}{S_1}$ for unpaired designs and $2^{-S}$ for sign-flip designs.

**Defaults.** An agent supplies the dataset, the donor, cell-type and condition keys and a resource, and takes everything else from the generated defaults in section 6. The default route is the one above; the other enum values are comparators.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse non-negative integer | raw UMI counts; normalised input is rejected |
| read | obs/<donor_key> | categorical | donor or sample identifier; the replicate |
| read | obs/<cell_type_key> | categorical | population tested separately |
| read | obs/<condition_key> | categorical, two or more levels | constant within donor for donor-level designs |
| read | obs/<covariate_keys> | categorical or numeric | design covariates, for example batch or depth |
| read | obsm/<score_key> | float | optional per-cell scores, used only by the per-cell comparator |
| read | uns/<resource_name> | long table | source, target, weight; signed footprints or gene sets |
| write | uns/pathway_de/<method>/<cell_type> | table | pathway, effect, se, stat, pval, fdr, n_donors_per_group |
| write | uns/pathway_de/<method>/null | table | donor-permutation statistics when calibration is enabled |
| write | models/pathway_de_<method> | metadata | method, design, resource, seed |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "decoupler_pb_ulm_on_de_statistic" | `decoupler_pb_ulm_on_de_statistic`, `decoupler_gsva_pseudobulk_then_limma`, `muscat_pbDS_edgeR`, `muscat_mmDS_dream2_cell_level`, `dreamlet_precision_weighted_lmm_pseudobulk`, `per_cell_score_then_donor_mean_limma` | Pathway inference route. Keep the default; the other values are comparators with documented outputs. |
| `design` | object | — | — | Donor, cell-type, condition and covariate keys, and the replicate unit. |
| `design.donor_key` | string | "donor" | — | obs column naming the donor or biological sample. |
| `design.cell_type_key` | string | "cell_type" | — | obs column of cell-type labels; each type is tested separately. |
| `design.condition_key` | string | "condition" | — | obs column of condition labels with two or more levels. |
| `design.unit` | string | "donor" | `donor`, `sample` | Replicate unit; cell-level units are rejected for condition tests. |
| `design.covariates` | array | [] | — | obs columns added to the design, such as batch, sex, age or depth. |
| `pseudobulk` | object | — | — | Donor-by-cell-type aggregation and filtering before testing. |
| `pseudobulk.aggregation` | string | "sum" | `sum`, `mean` | Cell aggregation; mean is available as a sensitivity check. |
| `pseudobulk.min_cells` | integer | 10 | min 1 | Minimum cells in a donor-by-cell-type pseudobulk. |
| `pseudobulk.min_counts` | integer | 1000 | min 0 | Minimum total counts per pseudobulk sample. |
| `pseudobulk.min_donors_per_group` | integer | 3 | min 2 | Minimum donors per condition level before a cell type is tested. |
| `pathway_set` | object | — | — | Pathway resource and set-size limits, required by every method. |
| `pathway_set.resource` | string | — | — | uns key of a long table with source, target and weight columns. |
| `pathway_set.min_size` | integer | 10 | min 1 | Minimum set size after intersection with tested genes. |
| `pathway_set.max_size` | integer | 500 | min 1 | Maximum set size after intersection with tested genes. |
| `decoupler_pb_ulm_on_de_statistic` | object | — | — | Options for the default signed univariate linear model route. |
| `decoupler_pb_ulm_on_de_statistic.tmin` | integer | 5 | min 1 | Minimum targets per source for a fit; decoupler examples use 3. |
| `decoupler_pb_ulm_on_de_statistic.signed` | boolean | true | — | Use signed footprint weights; false uses unsigned set membership. |
| `calibration` | object | — | — | Donor-label permutation null used to calibrate p-values. |
| `calibration.enabled` | boolean | true | — | Permute donor labels within cell type to build an empirical null. |
| `calibration.n_permutations` | integer | 1000 | min 100 | Donor-label permutations per cell type; exhaustive when fewer exist. |
| `alpha` | number | 0.05 | min 0; max 1 | Nominal FDR level for significance, Benjamini-Hochberg within cell type. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for donor permutations and subsampling. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device only; no pathway tests are computed. |
| `overwrite` | boolean | false | — | Replace existing pathway_de members for the same method instead of failing. |
<!-- PARAMS:AUTO:END -->

`design.unit` and `design.covariates` apply to every method. `pseudobulk.*` applies to the pseudobulk routes, and the per-cell comparator uses only `pseudobulk.aggregation` for its donor means. `decoupler_pb_ulm_on_de_statistic.*` applies only to the default route. `calibration.n_permutations` is ignored when `calibration.enabled` is false. `pathway_set.resource` is required for every method.

## 7. MCP tool

Tool name `singlet_enrichment_differential_pathway_activity` (definition in `tasks/mcp/singlet_enrichment_differential_pathway_activity.json`). Example call:

```json
{"dataset": "/path/to/study.singlet",
 "design": {"donor_key": "donor", "cell_type_key": "cell_type", "condition_key": "condition", "covariates": ["batch"]},
 "pathway_set": {"resource": "signed_footprints"},
 "calibration": {"enabled": true, "n_permutations": 1000}}
```

Example compact result:

```json
{"dataset": "/path/to/study.singlet", "status": "completed",
 "wrote": ["uns/pathway_de/decoupler_pb_ulm_on_de_statistic/<cell_type>", "uns/pathway_de/decoupler_pb_ulm_on_de_statistic/null"],
 "summary": {"method": "decoupler_pb_ulm_on_de_statistic", "cell_types_tested": "<int>", "n_tests": "<int>", "n_fdr_below_alpha": "<int>", "donors_per_group_min": "<int>", "null_min_pvalue": "<float>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: with calibration enabled the call may return `status: queued` with a `job_id`. Stochastic: permutations use `seed`, so identical inputs and seed give identical nulls. Dry run: returns an estimate of seconds, peak memory and device, with test and permutation counts.

## 8. Benchmarks

Shared protocol: all accuracy benchmarks use donor-by-cell-type pseudobulks with the same filters, the pathway collection after set-size filtering, Benjamini-Hochberg within cell type at alpha 0.05 with ties counted as rejections, and seeds 0 to 9. Comparators use the defaults in section 4 unless stated. Accuracy and timing are reported per method and per cell type. Each benchmark states only what differs from this protocol.

### B1. Donor-permutation null calibration

- **Goal**: test whether p-values are uniform when donors, not cells, are exchangeable.
- **Ground truth**: consistency. Each null test has $\beta_{1k}=0$ by construction (donor labels permuted); the statistic is the method's pathway score on permuted labels, in section 3 units.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue subset with donor IDs and cell-type labels | singlet catalogue (354M cells in total; internal) | scRNA-seq; species as present; subset size — | — | cell types with at least 8 donors; real donor structure |
| Best-practices DE chapter example | best-practices DE chapter text; no accession | scRNA-seq, human; 8 donors, 8 cell types, 2 conditions, 128 pseudobulks | — | paired by donor; permutation floor binds |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Rejection rate at alpha | Fraction of null tests with BH q ≤ 0.05; at least 2,000 tests per method | minimise \|rate − 0.05\| | primary | [R17] |
| Null uniformity | KS distance from null p-values to Uniform(0,1); observed fractions below 0.01 and 0.1 | minimise | guardrail | — |

- **Comparators**: decoupler ULM (default); muscat pbDS-edgeR, muscat mmDS-dream2 and dreamlet gene models with eq. (3); GSVA and AUCell donor-level routes; MAST without a donor term.
- **Protocol**: for each method and cell type, permute the condition label among donors within cell type (and within strata if defined) for $B=200$, enumerating all assignments when $\binom{S}{S_1}\le B$. For the paired best-practices example (each donor contributes both conditions), permute by within-donor sign flips instead, which give $2^S$ assignments (256 for $S=8$, so $B=200$ samples them). Use the real donor structure of both datasets and simulated donors from recipe G1 to G3 with between-donor variance matched to the catalogue.
- **Acceptance criterion**: rejection rate in [0.03, 0.07] over at least 2,000 null tests per method, and KS distance at most 0.05. Design thresholds. Donor-level methods are expected to pass; cell-level and per-cell routes to fail.
- **Known pitfalls**: permuting cells rather than donors destroys the donor structure and falsely passes cell-level tests. With 8 donors split 4 versus 4 only 70 assignments exist, so resampling with replacement repeats labellings and the null tests are not independent.

### B2. Planted donor-level shift recovery

- **Goal**: estimate power and sign accuracy at matched empirical false-positive rate for a planted donor-level shift.
- **Ground truth**: planted simulation. Planted tests have label 1 and effect $\delta$, the difference of condition-group means of donor-level pathway activity in within-cell-type donor SD units; others have label 0 and $\delta=0$.
- **Generator recipe**: G1, fit per-gene NB mean and dispersion to donor-level sums of each catalogue cell type with at least 8 donors. G2, draw donor effects $u_s\sim\mathcal N(0,\sigma_u^2)$, with $\sigma_u^2$ set for $\rho\in\{0.02,0.05,0.1\}$. G3, draw $m\in\{100,1000\}$ cells per donor from the fitted NB model with the donor effect. G4, assign $S\in\{4,8,16,32\}$ donors per group and plant $\delta\in\{0.25,0.5,1.0\}$ in a random pathway subset.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated donor-structured pathway counts over catalogue cell types | recipe G1 to G4; parameters fitted on catalogue donors | scRNA-seq-like counts; $S$, $m$ and $\delta$ on the grid above | — | no published dataset |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC over tests | AUROC of $-\log_{10}p$, planted-positive against planted-null tests; mid-ranks for ties | maximise | primary | — |
| Power at FDR 0.05 | Fraction of planted-positive tests with BH q ≤ 0.05, averaged over seeds, per $\delta$ | maximise | primary | [R17] |
| Sign accuracy among discoveries | Among planted-positive discoveries (q ≤ 0.05), fraction with the planted sign | maximise | guardrail | — |

- **Comparators**: decoupler ULM (default); decoupler GSVA; muscat mmDS-dream2; dreamlet; default statistic with donor-label null.
- **Protocol**: grid over $S$, $m$, $\delta$, $\rho$; 10 seeds. Power is compared only between methods meeting B1 at that grid point.
- **Acceptance criterion**: a method is compared on power only when it meets B1 at every grid point; among calibrated methods power is non-decreasing in $S$. 
- **Known pitfalls**: a simulator sharing the test's donor-variance model overstates power, so fit it on catalogue donors and test with models that do not share that fit. Gene-level and pathway-level planting give different power; both are reported.

### B3. Expected-direction recovery in interferon stimulation

- **Goal**: check that known interferon-response pathways are recovered with the expected sign and a high rank in a real stimulation contrast.
- **Ground truth**: expert labels. Each pathway in a fixed interferon-response list carries an expected positive sign for stimulated versus control; the list is written before any method is applied, and a hit is a positive signed effect with BH q ≤ 0.05.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Best-practices DE chapter example, stimulated versus control | best-practices DE chapter text; no accession | scRNA-seq, human; 8 donors, each with control and stimulated pseudobulks; CD14+ monocytes among cell types | — | the chapter reports the direction, so the expectation is not independent of it |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Expected-direction hit rate | Fraction of the fixed list with positive effect and q ≤ 0.05 for stimulated versus control | maximise | primary | — |
| Median rank of expected pathways | Median position of expected pathways in the ranking by signed statistic, ranking fixed before inspection | minimise | guardrail | — |

- **Comparators**: decoupler ULM (default); decoupler GSVA; AUCell scores with donor means.
- **Protocol**: all methods take the same donor-by-cell-type pseudobulks; hit rate and median rank are reported per cell type; nothing is tuned after results are seen.
- **Acceptance criterion**: hit rate at least 0.8 for the default in cell types with at least 4 donors per condition. Results are reported whatever their outcome.
- **Known pitfalls**: overlapping interferon sets, such as REACTOME_INTERFERON_ALPHA_BETA_SIGNALING and REACTOME_INTERFERON_SIGNALING, inflate hit rates, so overlapping sets are counted once. The expected list must not be chosen after results.

### B4. Pseudoreplication inflation versus donor count

- **Goal**: show how cell-level and donor-level pathway tests diverge as donors and cells per donor change, against the design-effect prediction.
- **Ground truth**: consistency. The estimand is the ratio of standard deviations of null z-statistics from a cell-level test and a donor-level test; eq. (2) predicts $\sqrt{1+(m-1)\rho}$ for the cell-level test and 1 for the donor-level test.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated Gaussian donor-structured pathway scores with known $\rho$ | recipe G1 to G3 with Gaussian scores in place of NB | scRNA-seq-like; $m\in\{10,100,1000\}$, $\rho\in\{0.02,0.05,0.1\}$ | — | balanced donors; condition constant within donor |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Observed inflation ratio | SD of null z-statistics, cell-level over donor-level test, compared with $\sqrt{1+(m-1)\rho}$ | match prediction | primary | [R2] |
| Donor-level ratio | SD of null z-statistics of the donor-level test | match 1 | guardrail | — |

- **Comparators**: MAST hurdle (cell level, no donor term); muscat mmDS-dream2 (cell level); decoupler ULM (donor level).
- **Protocol**: 500 replicates per grid point; the observed ratio is compared with eq. (2) at each $(m,\rho)$, and departures are reported rather than forced to agree.
- **Acceptance criterion**: cell-level observed ratio within 10% of the prediction across the grid; donor-level ratio within 0.9 to 1.1.
- **Known pitfalls**: non-Gaussian scores and unequal donor sizes change the constant in eq. (2), so the departure is reported. The prediction also assumes a condition constant within donor.

### P1. Performance and scaling

Wall time, peak memory and throughput in tests per second at $10^5$, $10^6$ and $10^7$ cells, with 8, 50 and 200 donors and 500 and 5,000 pathways, on CPU and CUDA for the default route. Comparators: decoupler pseudobulk with ULM (Python, CPU), muscat pbDS-edgeR (R, CPU), dreamlet (R, CPU), NEBULA (R, CPU, timing only), AUCell scores with donor means (R, CPU), and the CUDA build of the default route (to be built). Hold fixed the pathway collection, one condition term plus one covariate, and the number of cell types. Permutation nulls are reported as cost per permutation, because they multiply cost by $B$. The streaming claim holds only if the $10^7$-cell case completes on CPU and CUDA within the stated memory.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
  - `enrichment.pathway_resource_curation`: Curated pathway gene-set and signed footprint resource construction
- **Feeds**:
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
  - `sample-level.multi_sample_power_analysis`: Power and sample-number planning for multi-sample designs
- **Reads**: `layers/counts`, `obs/<donor_key>`, `obs/<cell_type_key>`, `obs/<condition_key>`, `obs/<covariate_keys>`, `obsm/<score_key>`, `uns/<resource_name>`
- **Writes**: `uns/pathway_de/<method>/<cell_type>`, `uns/pathway_de/<method>/null`, `models/pathway_de_<method>`
<!-- CHAINING:AUTO:END -->

Sits in the condition-association chain, after donor-aware gene-level DE and before null calibration and multiplicity control.

## 10. Risks, pitfalls and open questions

- **Sources not read**: the dream method and variancePartition were not read, so the dream2 option rests on muscat's source alone.
- **Benchmark designs**: the datasets, sizes, metrics and results of the Squair, Zimmerman and Murphy papers are not reproduced here; every grid, seed count, replicate number and acceptance threshold in section 8 is a proposed design value, not a literature value.
- **Parameter discrepancies**: decoupler's ULM default `tmin` is 5 in the signatures but 3 in the examples; reconcile before release.
- **Data access**: the 8-donor chapter example has no accession or licence, and the catalogue's donor-field coverage, donors per cell type and licence terms are unknown; the B1 subset depends on them.
- **Paired example**: in the best-practices example each donor contributes control and stimulated pseudobulks, which breaks the constant-within-donor condition of section 3; B1 uses within-donor sign flips for it, and B3 on the same data needs a donor term in the gene model, which section 5 takes from `markers-de.replicate_aware_condition_de`.
- **Identifiers**: no DOI is printed for Goeman and Buhlmann (R6); the dreamlet journal DOI and the preprint DOI in R13 refer to different records of the same work.
- **Open method and first experiment**: sum versus mean aggregation, the donor count needed for valid calibration and composition adjustment are unresolved. The first experiment is B1 on the catalogue subset with at least 8 donors per cell type, with top-20 Jaccard stability under 50% gene subsampling (100 subsamples, proposed threshold 0.8) as a guardrail.

## 11. References

R1. Squair JW, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R2. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)
R3. Murphy AE, Skene NG. A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nature Communications* 2022. doi:10.1038/s41467-022-35519-4 — verified (corpus)
R4. Junttila S, Smolander J, Elo LL. Benchmarking methods for detecting differential states between conditions from multi-subject single-cell RNA-seq data. *bioRxiv* 2022. doi:10.1101/2022.02.16.480662 — verified (corpus)
R5. Crowell HL, Soneson C, Germain PL, et al. muscat detects subpopulation-specific state transitions from multi-sample multi-condition single-cell transcriptomics data. *Nature Communications* 2020. doi:10.1038/s41467-020-19894-4 — verified (corpus)
R6. Goeman JJ, Buhlmann P. Analyzing gene expression data in terms of gene sets: methodological issues. *Bioinformatics* 2007. — verified (corpus)
R7. Subramanian A, et al. Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. *Proceedings of the National Academy of Sciences* 2005. doi:10.1073/pnas.0506580102 — verified (corpus)
R8. Badia-i-Mompel P, et al. decoupleR: ensemble of computational methods to infer biological activities from omics data. *Bioinformatics Advances* 2022. doi:10.1093/bioadv/vbac016 — verified (corpus)
R9. Schubert M, et al. Perturbation-response genes reveal signaling footprints in cancer gene expression. *Nature Communications* 2018. doi:10.1038/s41467-017-02391-6 — verified (corpus)
R10. Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. *Bioinformatics* 2009. doi:10.1093/bioinformatics/btp616 — verified (corpus)
R11. Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. *Genome Biology* 2014. doi:10.1186/s13059-014-0550-8 — verified (corpus)
R12. Hänzelmann S, Castelo R, Guinney J. GSVA: gene set variation analysis for microarray and RNA-seq data. *BMC Bioinformatics* 2013. doi:10.1186/1471-2105-14-7 — verified (corpus)
R13. Hoffman GE, et al. Efficient differential expression analysis of large-scale single-cell transcriptomics data using Dreamlet. *Nature Communications* 2026. doi:10.1038/s41467-026-75680-8 (bioRxiv preprint doi:10.1101/2023.03.17.533005) — verified (repo)
R14. He L, et al. NEBULA is a fast negative binomial mixed model for differential or co-expression analysis of large-scale multi-subject single-cell data. *Communications Biology* 2021. doi:10.1038/s42003-021-02146-6 — verified (repo)
R15. Finak G, et al. MAST: a flexible statistical framework for assessing transcriptional changes and characterizing heterogeneity in single-cell RNA sequencing data. *Genome Biology* 2015. doi:10.1186/s13059-015-0844-5 — verified (corpus)
R16. Aibar S, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — verified (corpus)
R17. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)
R18. Holland CH, et al. Robustness and applicability of transcription factor and pathway analysis tools on single-cell RNA-seq data. *Genome Biology* 2020. doi:10.1186/s13059-020-1949-z — verified (search)
R19. Zhang Y, et al. Benchmarking algorithms for pathway activity transformation of single-cell RNA-seq data. *Computational and Structural Biotechnology Journal* 2020. doi:10.1016/j.csbj.2020.10.007 — verified (search)
R20. Müller-Dott S, et al. Expanding the coverage of regulons from high-confidence prior knowledge for accurate estimation of transcription factor activities. *Nucleic Acids Research* 2023. doi:10.1093/nar/gkad841 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/saezlab/decoupler-py | Pau Badia i Mompel (first author in pyproject.toml) | BSD-3-Clause (LICENSE file; copyright 2025 scverse and 2025 Pau Badia i Mompel, Saez lab) | ULM, GSVA and pseudobulk reference implementation | port |
| https://github.com/HelenaLC/muscat | Helena L. Crowell (aut, cre) | GPL-3 (DESCRIPTION); GPL-2.0-or-later (scRNA-tools record); no LICENSE file at the root | pbDS and mmDS comparators | callout |
| https://github.com/DiseaseNeurogenomics/dreamlet | Gabriel Hoffman (aut, cre) | Artistic-2.0 (DESCRIPTION; scRNA-tools record agrees); no LICENSE file at the root | precision-weighted donor model comparator | callout |
| https://github.com/lhe17/nebula | Liang He (maintainer) | MIT (DESCRIPTION and LICENSE file); GPL-2.0 (scRNA-tools record) | cell-level timing comparator | callout |
| https://github.com/RGLab/MAST | Andrew McDavid (aut, cre) | GPL (>= 2) (DESCRIPTION) | cell-level hurdle reference | callout |
| https://github.com/aertslab/AUCell | Sara Aibar and Stein Aerts (Author field); Gert Hulselmans (maintainer) | GPL-3 (DESCRIPTION); "Custom" (scRNA-tools record) | per-cell score comparator | callout |
