---
id: qc.sample_level_qc
title: Sample- and library-level QC pass/fail
area: qc
scope: core
paradigm: hybrid
literature_status: open
priority: P1
depends_on: [cell-calling.cell_vs_empty_droplet_calling, ingest-quant.umi_deduplication, qc.low_quality_cell_detection]
feeds: [integration.batch_corrected_embedding, markers-de.replicate_aware_condition_de, abundance.celltype_proportion_test]
reads: [layers/counts, var/mito, obs/<sample_key>, obs/<batch_key>, uns/cellranger_metrics]
writes: [uns/sample_qc, uns/sample_qc_params, obs/sample_qc_group, models/sampleqc]
devices: [cpu, cuda]
mcp_tool: singlet_qc_sample_level_qc
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Sample- and library-level QC pass/fail

> Decides which whole samples or libraries to exclude or re-run, using a per-batch scaled-MAD rule on sample summaries as the published standard and a joint Gaussian-mixture model (SampleQC) as the model-based alternative.

## 1. Question

Which whole samples or libraries fail quality control because their summary profile departs from the rest of the study (too few cells recovered, low UMI or gene content per cell, high mitochondrial fraction, or an outlying joint metric profile), and would removing them also remove healthy cell types? Inputs are a count matrix with sample and optional batch keys. Outputs are a per-sample pass or fail flag, the failing metrics, and the fraction of each sample's cells flagged by a cell-level model. A correct answer excludes technically failed libraries and nothing else. No accepted ground truth exists.

## 2. Why this task matters and where the field stands

A failed library distorts every downstream step that pools it, because batch correction, composition tests and replicate-aware differential expression all treat a sample as one unit. Cell-level filters cannot remove a whole library. The raw-processing chapter says consistently low barcode frequency or consistently low metrics across cells signal a data-quality problem [R1]. Upstream summaries are not neutral either: Cell Ranger's estimated cell count depends on cell calling [R2]. MultiQC combines upstream reports from many tools into one view [R3].

Status: **open**. No accepted ground truth exists for library pass/fail. The closest quantitative evaluation, pipeComp, scores preprocessing on cells of known identity and does not score samples [R4]. The open problems are:

- Batch-wise robust rules take the median and MAD of a batch as reference, so they assume most cells in each batch are acceptable; both have a 50% breakdown point, so a majority-poor batch defeats them. The OSCA chapter applies this rule per batch through `batch=` [R5].
- pipeComp's filter pairs 5-MAD thresholds on counts, features, top-20 share and feature-count distance with a 3-MAD mitochondrial rule whose upper tail counts only above 8% [R4].
- A union rule flags a cell on any single criterion, whereas pipeComp's lenient filter flags a cell only when at least two of five criteria agree [R4]. The two rules remove different cells.
- Joint multi-sample models group samples by distribution and fit mixtures across them. This protects rare cell types but adds choices of K and of transformation [R6][R7].

## 3. Theory and insight

### Estimand and normalisation

Index samples by $j$ and called cells by $i$, with $n_j$ cells in sample $j$. Sample summaries are $n_j$; $\tilde u_j$, the median over cells of total UMIs per cell; $\tilde g_j$, the median of detected genes per cell; and $\tilde\mu_j$, the median of the mitochondrial UMI fraction $\mu_i=m_i/t_i$, a fraction in $[0,1]$ and not a percentage. The cell outlier fraction $f_j=n_j^{-1}\sum_{i\in j}o_{ij}$ is the share of the sample's cells flagged, so it lies in $[0,1]$ and does not grow with sample size. The sample verdict $d_j\in\{0,1\}$ is 1 for fail. Ground-truth quantities are defined in section 8: planted cell labels give sensitivity and specificity as fractions of planted and healthy cells; planted sample labels give rates as fractions of failed and healthy samples; and per-type retention for type $c$ is its cells in passing samples divided by its cells in all samples.

| Symbol | Meaning |
|---|---|
| $i$, $j$, $b$ | cell, sample, batch (group of samples) |
| $m_i$, $t_i$ | mitochondrial and total UMIs of cell $i$ |
| $o_{ij}$, $f_j$ | cell outlier flag; sample outlier fraction |
| $d_j$ | sample verdict, 1 = fail |
| $r_{ij}$, $\beta_k$, $\Sigma_k$ | SampleQC residual, component offset and covariance |

### Robust batch rules

For a metric $x$ and batch $b$,

$$\tilde x_b=\operatorname{median}_{i\in b}x_i,\qquad \mathrm{MAD}_b=1.4826\,\operatorname{median}_{i\in b}\lvert x_i-\tilde x_b\rvert,\qquad o_i=\mathbb 1\{\lvert x_i-\tilde x_{b(i)}\rvert>k\,\mathrm{MAD}_{b(i)}\}.$$

The constant 1.4826 makes the MAD consistent for the standard deviation of a Gaussian. The rule holds when most values in the batch are acceptable, the metric is roughly unimodal after transformation, and the batch is large enough for stable medians. For sample verdicts the units are samples, so $x_i$ is a sample summary and $b$ a group of samples. With $S$ samples, both the median and the MAD rest on $S$ values, and small $S$ makes them unstable. A minimum distance floors the threshold, and one-sided variants keep one tail.

The mitochondrial fraction is logit-transformed before thresholding:

$$\ell_i=\operatorname{logit}\frac{m_i+1}{t_i+2}=\log\frac{m_i+1}{t_i-m_i+1}.$$

The pseudocounts keep cells with zero mitochondrial UMIs finite; the regime is any cell with $t_i\ge 0$.

Under a Gaussian metric, the two-sided probability of a value beyond $3\times1.4826$ standard deviations is about $8.7\times10^{-6}$, computed from the normal distribution. A 3-scaled-MAD rule therefore flags almost nothing on Gaussian data, and practical flags come from skew and heavy tails. The flagged fraction then depends on the metric's shape rather than on a designed false-positive rate.

### Joint mixture (SampleQC)

In the package source `fit_sampleqc.R`, the residuals $r_{ij}=x_{ij}-\mu_0-\alpha_j$ of the transformed QC vector follow a sample-specific mixture

$$r_{ij}\sim\sum_{k=1}^{K}p_{jk}\,\mathcal N(\beta_k,\Sigma_k),$$

with shared mean $\mu_0$, sample shift $\alpha_j$ and sample-specific component proportions $p_{jk}$. A cell is an outlier when its minimum Mahalanobis distance over components exceeds a chi-square cutoff:

$$d^2_{ij}=\min_k\,(r_{ij}-\beta_k)^\top\Sigma_k^{-1}(r_{ij}-\beta_k),\qquad o_{ij}=\mathbb 1\{d^2_{ij}>\chi^2_D(1-\alpha)\}.$$

The default is $\alpha=0.01$ [R7]; for $D=3$ the cutoff is about 11.34. Because the minimum is over components, a cell generated by component $k$ satisfies $d^2_{ij}\le(r_{ij}-\beta_k)^\top\Sigma_k^{-1}(r_{ij}-\beta_k)$. Under exact Gaussian components, $P(o_{ij}=1)\le\alpha$ for a cell drawn from any component, so a rare healthy type is explained by its own component rather than flagged. The regime is correct Gaussian components and metrics close to normal. Trimmed (MCD-type) estimation makes the parameters approximate in finite samples [R8], so the bound is a guide, not a guarantee.

### Proposed sample-level distance

The following sample score is proposed and is not taken from the literature. It is built from the sample summary vector $s_j$:

$$RD_j^2=(s_j-\hat m)^\top\hat S^{-1}(s_j-\hat m),\qquad \text{flag }j\text{ if }RD_j^2>\chi^2_p(1-\alpha_s),$$

where $\hat m$ and $\hat S$ are robust location and scatter across samples from an MCD-type estimator [R8]. The chi-square cutoff assumes multivariate normal summaries and is optimistic unless $S$ is large relative to $p$. The level $\alpha_s$ must be calibrated on B2.

### Failure modes by family

- Robust batch rules: a majority-poor batch pulls the median and MAD toward its bad units and hides them.
- Joint mixtures: a failure shared by every sample is absorbed into $\mu_0$ and cannot be seen, and the fit depends on $K$ and on the transformation.
- Unimodal cell-level cutoffs remove healthy cells of extreme types; the joint mixture keeps them but needs $K$.

### Heuristics versus models

The per-batch rule is transparent, has one main tuning constant (`nmads`), and needs no training. It gives no calibrated probability for a sample and combines metrics only by counting flags. A joint model gives each cell a Mahalanobis distance with a stated level, a sample score that can be calibrated on planted failures, a fitted reference that can be reused across studies, and a place for covariates such as protocol. Its costs are $K$, the transformation and fitting time. The batch medians cost $O(N\log N)$ per metric and each SampleQC EM iteration costs $O(NKD^2)$; both are derived, not measured.

### Measuring type loss

The closest benchmark measure of cell-type loss is pipeComp's per-subpopulation loss, pc.lost, which scores cells of known identity rather than samples [R4]. Loss of a whole healthy type after sample exclusion must therefore be measured separately (B3).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scuttle `isOutlier` with `batch` | heuristic | Per-batch median and scaled MAD; flags values beyond `nmads` scaled MADs in the chosen direction. | [R9][R10] |
| pipeComp lenient filter (`filt.lenient`) | heuristic | Five per-cell criteria: four at 5 MAD, and mitochondrial at 3 MAD (upper tail only above 8%); a cell is flagged when two or more criteria agree. | [R4][R11] |
| SampleQC | model-based | Samples grouped by pairwise MMD and Louvain clustering; a robust Gaussian mixture fitted jointly across the group; cell outliers by Mahalanobis distance at chi-square level $\alpha$. | [R6][R7] |
| Cell Ranger metric definitions | heuristic | Per-library summary metrics (for example estimated cells and median genes per cell) defined in the webshim constants module. | [R2] |
| MultiQC | heuristic | Aggregates per-sample outputs of many tools into one comparable report. | [R3] |

The published heuristic standard is the per-batch scaled-MAD rule of the Bioconductor toolchain [R12][R13], and it is kept as the comparator in every benchmark. SampleQC is the model-based method in this set. Cell Ranger and MultiQC supply inputs rather than decisions, and the pipeComp filter is a cell-level comparator. The sample verdict below therefore uses the scuttle rule on sample summaries, and SampleQC contributes per-sample cell outlier fractions and sample groups.

Exact defaults from the source, with file and line:

| Method | Parameter | Value | Source |
|---|---|---|---|
| scuttle `isOutlier` | `nmads` | 3 | `R/isOutlier.R:91-94` @ d3476eb |
| scuttle `isOutlier` | `type` | both | `R/isOutlier.R:91-94` |
| scuttle `isOutlier` | `log` | FALSE; TRUE applies log2 | `R/isOutlier.R:92`, `:101-103` |
| scuttle `isOutlier` | `share.medians`, `share.mads` | FALSE, FALSE | `R/isOutlier.R:92-93` |
| scuttle `isOutlier` | `share.missing` | TRUE | `R/isOutlier.R:93` |
| scuttle `isOutlier` | `min.diff` | NA; threshold is the larger of `nmads` MADs and `min.diff` | `R/isOutlier.R:93` |
| scuttle `isOutlier` | MAD constant | 1.4826, the `mad()` default | `R/isOutlier.R:181` |
| pipeComp `filt.lenient` | count and feature criteria | 5 MAD, both directions | `inst/extdata/scrna_alternatives.R:253-261` @ a3fd419 |
| pipeComp `filt.lenient` | mitochondrial criterion | 3 MAD; upper tail only above 0.08 | `inst/extdata/scrna_alternatives.R:262-263` |
| pipeComp `filt.lenient` | vote | flagged by at least 2 of 5 | `inst/extdata/scrna_alternatives.R:266` |
| SampleQC | `alpha` | 0.01 | `R/fit_sampleqc.R:59` @ adf0d97 |
| SampleQC | `em_iters` | 50 | `R/fit_sampleqc.R:59` |
| SampleQC | `mcd_alpha`, `mcd_iters` | 0.5, 50 | `R/fit_sampleqc.R:59` |
| SampleQC | `method`, `bp_seed` | robust, 22 | `R/fit_sampleqc.R:60` |
| SampleQC | outlier cutoff | `qchisq(1 - alpha, df = D)`; minimum over components | `R/fit_sampleqc.R:429`, `:442`, `:450` |
| SampleQC | `qc_names` | log_counts, log_feats, logit_mito | `R/calc_pairwise_mmds.R:44-45` |
| SampleQC | `subsample`, `n_times`, `seed`, `n_cores` | 100, 20, 22, 4 | `R/calc_pairwise_mmds.R:46-47` |
| SampleQC | `one_group_only` | TRUE when there are 10 or fewer samples | `R/calc_pairwise_mmds.R:57-58` |
| SampleQC | `K_all` or `K_list` | no code default; README recommends K = 1 per group first | `README.md:108` |
| SampleQC simulator | `n_groups`, `n_cells`, `cells_p_s`, `D`, `K` | 4, 1e5, 2000, 3, 4 | `R/simulate_qcs.R:47` |

## 5. Proposed singlet approach

Routes. The scuttle rule is **reimplemented** in the C++ core from its published definition (section 12). SampleQC is **ported** (section 12). The pipeComp filter is a **callout** and is not ported. Cell Ranger metric names and MultiQC output are **reimplemented** as readers; no upstream code is copied.

Default. The default is `mad_batch`, the scuttle rule on sample summaries, with `batch_key` setting the groups. Its only free constant is `nmads`, fixed at the published 3; it gives sample-level flags directly; and no benchmark yet supports a model-based verdict. `sampleqc` applies SampleQC with K = 1 per group and reports cell outlier fractions and groups; its verdict stays null until B2 calibrates it.

Model-based formulation singlet proposes. The sample score is the robust distance of section 3 over the summaries, with $\alpha_s$ calibrated on B2 and reported beside $f_j$. It replaces the default only if it meets the B2 acceptance criterion. It is falsified if its B2 sample TPR at FPR 0.05 stays below 0.90 for $\delta\ge 2$, or if B3 type loss exceeds 0.10.

ML stack. No deep network is needed: $S$ is in the thousands at most and $D$ is about 3 to 6 (proposed). A PyTorch reference density over the catalogue is a later step. Hard-coded CUDA is justified only for the cell-level EM of a small fixed Gaussian mixture ($D$ up to about 6, $K$ up to about 10, proposed), mirroring SampleQC; cuSPARSE is not needed for the dense per-cell table.

Kernels and streaming. Per-group medians and MADs sort each group of summaries, and per-sample summaries accumulate in one pass over the counts, so the `mad_batch` path streams. SampleQC holds the cells for its EM in memory, $O(ND)$, and subsamples cells for MMD. CPU is the reference; CUDA covers only the EM kernel.

Defaults an agent uses without asking: `method` = `mad_batch`; `nmads` = 3; `type` = both; `log` = true for count-like summaries, which departs from the section 4 source default because sample totals are multiplicative (proposed); `min_flagged_metrics` = 1, the union rule; `include_upstream` = true.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts for totals, genes and mitochondrial fraction |
| read | var/mito | bool | mitochondrial gene flag |
| read | obs/`<sample_key>` | categorical | sample or library, the unit of the verdict |
| read | obs/`<batch_key>` | categorical | optional group of samples for medians and MADs |
| read | uns/cellranger_metrics | table | optional upstream summary, reported when `include_upstream` is set |
| write | uns/sample_qc | table | per sample: cells, medians, flagged metrics, cell outlier fraction, pass flag |
| write | uns/sample_qc_params | dict | parameters used, for provenance |
| write | obs/sample_qc_group | categorical | SampleQC group of each cell (`sampleqc` only) |
| write | models/sampleqc | dict | fitted K, mu_0, alpha_j, beta_k, Sigma_k, p_jk (`sampleqc` only) |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `sample_key` | string | "sample_id" | — | obs column identifying each sample or library, the unit of the pass or fail decision. |
| `batch_key` | string/null | null | — | obs column grouping samples into batches for medians and MADs; null pools all samples into one group. |
| `method` | string | "mad_batch" | `mad_batch`, `sampleqc` | mad_batch gives the sample verdict; sampleqc adds cell outlier fractions and sample groups, with a verdict only after calibration. |
| `mad_batch` | object | — | — | Options for method mad_batch: scaled-MAD rule on sample summaries. |
| `mad_batch.metrics` | array | ["n_cells", "median_total_counts", "median_genes", "median_mito_frac"] | — | Per-sample summaries compared across samples within each batch. |
| `mad_batch.nmads` | number | 3 | > 0 | Scaled MAD multiplier for the flag threshold. |
| `mad_batch.type` | string | "both" | `both`, `lower`, `higher` | Tail direction in which a sample can be flagged. |
| `mad_batch.log` | boolean | true | — | Apply log2 to count-like summaries (n_cells, median_total_counts, median_genes); mito fraction stays linear. |
| `mad_batch.min_diff` | number/null | null | — | Minimum distance from the median before a sample is flagged; null disables the floor. |
| `mad_batch.min_flagged_metrics` | integer | 1 | min 1; max 4 | Number of metrics that must flag a sample; 1 is the union rule, where any flagged metric fails the sample. |
| `sampleqc` | object | — | — | Options for method sampleqc: joint robust Gaussian mixture with MMD sample groups. |
| `sampleqc.K` | integer | 1 | min 1 | Mixture components per sample group; start at 1 and check the rendered diagnostics. |
| `sampleqc.alpha` | number | 0.01 | > 0; < 1 | Chi-square tail level for the cell outlier cutoff. |
| `sampleqc.em_iters` | integer | 50 | min 1 | Maximum EM iterations. |
| `sampleqc.mcd_alpha` | number | 0.5 | > 0; < 1 | Trimming proportion for the robust MCD-type estimates. |
| `sampleqc.mcd_iters` | integer | 50 | min 1 | Iterations of the robust MCD-type estimator. |
| `sampleqc.subsample` | integer | 100 | min 1 | Cells per sample drawn for each MMD distance. |
| `sampleqc.n_times` | integer | 20 | min 1 | Number of subsampled MMD repetitions per sample pair. |
| `sampleqc.n_cores` | integer | 4 | min 1 | Parallel workers for the pairwise MMD computation. |
| `include_upstream` | boolean | true | — | Report Cell Ranger or MultiQC summaries from uns when present; they never change the verdict. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; cuda applies only to the sampleqc EM kernel when available. |
| `seed` | integer | 0 | — | Random seed for MMD subsampling and MCD resampling in sampleqc. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

The `mad_batch` block is read only when `method` is `mad_batch`, and the `sampleqc` block only for `sampleqc`. The `pass` flag in `uns/sample_qc` comes from the `mad_batch` rule and is null under `sampleqc` until calibration. Raising `min_flagged_metrics` above 1 increases specificity and reduces sensitivity; B2 should set it. `batch_key` affects only `mad_batch`, because SampleQC derives its own groups from MMD distances. `one_group_only` follows the sample count and is not exposed. The tool never removes cells or samples; exclusion is the caller's decision.

## 7. MCP tool

Tool name `singlet_qc_sample_level_qc` (definition in `tasks/mcp/singlet_qc_sample_level_qc.json`). Illustrative call and result, with placeholder values rather than measurements:

```json
{"dataset": "/data/study.singlet", "sample_key": "library_id", "batch_key": "site", "mad_batch": {"min_flagged_metrics": 2}}
```

```json
{"dataset": "/data/study.singlet", "status": "completed", "wrote": ["uns/sample_qc", "uns/sample_qc_params"],
 "summary": {"n_samples": "<int>", "n_failed": "<int>", "failing_samples": ["<sample_key value>"], "method": "mad_batch"},
 "provenance_id": "<id>"}
```

Long-running: `mad_batch` completes inline; `sampleqc` returns `queued` with a `job_id` when the fit exceeds the inline limit. Stochastic: only `sampleqc`, through MMD subsampling and MCD resampling; `seed` fixes both. Dry run: returns estimated seconds, peak memory and device for the chosen method without writing.

## 8. Benchmarks

Shared protocol. Every benchmark uses per-cell log counts, log features and logit mitochondrial fraction as its QC table, the SampleQC default metrics in section 4. Each scenario is repeated over 10 seeds (proposed), reported as mean and range. Score-based comparators get cutoffs that set FPR to 0.05 on a separate healthy calibration set, then held fixed. Methods use their section 4 defaults unless a benchmark states otherwise. Wall time and peak memory are measured on the same CPU for every method (P1).

### B1. Planted cell outliers and rare-type retention

- **Goal**: Check that a cell-level outlier rule removes planted low-quality cells and keeps healthy cells of rare or extreme types, the cell-level step on which sample summaries rest.
- **Ground truth**: planted simulation. Each simulated cell carries the generator's label for planted outlier and for its component [R7]. Sensitivity is the fraction of planted outlier cells flagged; specificity is the fraction of healthy cells not flagged; rare-type retention for component $k$ is healthy cells of $k$ kept divided by healthy cells of $k$ simulated, for components with prevalence below 5% of all cells (proposed cut-off).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| `simulate_qcs` cell-level QC table | [R7], `R/simulate_qcs.R` | Synthetic per-cell log counts, log features and logit mitochondrial fraction at generator defaults | — | Labels are planted by the generator |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Outlier sensitivity | planted outlier cells flagged / planted outlier cells | maximise | primary | — |
| Outlier specificity | healthy cells not flagged / healthy cells | maximise | primary | — |
| Rare-type retention | minimum over rare components of retained / simulated healthy cells | maximise | guardrail | — |

- **Comparators**: scuttle `isOutlier` per sample (`nmads` 3); `isOutlier` with `batch` set to the sample group; SampleQC with K = 1 per group. The pipeComp filter is not run, because the generator does not produce its top-20 share and feature-count inputs.
- **Protocol**: simulate at generator defaults over the shared seeds; each comparator flags cells in the per-cell table; metrics are computed per seed.
- **Acceptance criterion**: proposed, not from the literature: rare-type retention at least 0.95 and sensitivity at least 0.80 among methods whose specificity is at least 0.99.
- **Known pitfalls**: the generator is a Gaussian mixture, the family SampleQC fits, so the comparison favours SampleQC. The 5% prevalence cut-off decides which components count as rare.

### B2. Planted sample-level failures (proposed)

- **Goal**: Score sample pass or fail decisions when whole samples are planted as failed libraries.
- **Ground truth**: planted simulation. Each sample carries a generator label, failed (1) or healthy (0). Rates are per class: failed samples flagged over failed samples, and healthy samples flagged over healthy samples.
- **Generator recipe** (proposed): (1) draw $S\in\{20,50,100\}$ samples of 2000 cells each (`cells_p_s`); (2) mark a fraction $f\in\{0.05,0.1,0.2\}$ of samples failed; (3) shift log counts and log features of failed samples down by $\delta\in\{1,2,3\}$ within-sample standard deviations, or plant outliers in 20% of their cells; (4) for the held-out condition, shift only logit mitochondrial fraction and remove mitochondrial inputs from the detectors; (5) repeat over the shared seeds.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Generator recipe above on `simulate_qcs` | [R7]; recipe is specific to this document | Synthetic per-cell and per-sample QC; $S\in\{20,50,100\}$; 2000 cells per sample | — | Sizes are design choices |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Sample TPR | failed samples flagged / failed samples, at the method's cutoff | maximise | primary | — |
| Sample FPR | healthy samples flagged / healthy samples | minimise | primary | — |
| Sample AUC | Mann–Whitney AUC of the continuous score, ties averaged | maximise | primary | — |
| Rare-type retention in passing samples | as in B1, over samples that pass | maximise | guardrail | — |

- **Comparators**: `mad_batch` verdict (score is the largest scaled deviation across metrics); per-sample fraction of cells flagged by `isOutlier`; SampleQC with groups excluded through `get_outliers` (score is the group's outlier fraction); the proposed distance of section 3.
- **Protocol**: cross $f$ and $\delta$; detectors read log counts and log features, plus median mitochondrial fraction outside the held-out condition; cutoffs as in the shared protocol.
- **Acceptance criterion**: proposed: sample TPR at least 0.90 at FPR of at most 0.05, and AUC at least 0.95, for $\delta\ge 2$.
- **Known pitfalls**: a shift on a metric the detector reads is circular, which the held-out condition tests. With $S=20$, medians and MADs vary widely across seeds.

### B3. Cell-type loss after sample exclusion

- **Goal**: Check that excluding samples does not remove whole cell types from the retained data.
- **Ground truth**: orthogonal measurement. Cell types are the dataset's own annotations, assigned before any exclusion and not derived from the QC metrics. Per-type retention for type $c$ is type-$c$ cells in passing samples divided by type-$c$ cells in all samples. Composition shift is the total variation distance between type proportions before and after exclusion, $\tfrac12\sum_c\lvert p_c^{\text{before}}-p_c^{\text{after}}\rvert$, in $[0,1]$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| NeurIPS 2021 multiome bone marrow, RNA side (donor and site identifiers in the release) | [R14] | 10x Multiome RNA; human bone marrow mononuclear cells | — | Donor identifiers give natural samples, so the multi-donor release is needed |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-type retention | as defined above | maximise | primary | — |
| Maximum type loss | 1 minus the minimum per-type retention over types with at least 50 cells (50 proposed) | minimise | guardrail | — |
| Composition shift | total variation distance, as defined above | minimise | guardrail | — |

- **Comparators**: no exclusion (baseline); `mad_batch` with `batch_key` unset; `mad_batch` with `batch_key` set to site; SampleQC with K = 1 per group.
- **Protocol**: each method excludes samples on its own verdict over the real samples, with no simulated failures; metrics are computed for each method, and SampleQC is repeated over the shared seeds.
- **Acceptance criterion**: proposed: maximum type loss at most 0.10 for types with at least 50 cells, unless the type occurs only in flagged samples.
- **Known pitfalls**: annotations derived from QC-filtered data make retention circular. Small types have high-variance retention, so per-sample type counts are reported beside each result.

### P1. Performance and scaling

Measure wall time, peak memory and throughput in cells per second for the `mad_batch` summary pass, and for each SampleQC stage (MMD, grouping, EM, outlier pass), at 10 k, 100 k, 1 M and 10 M cells. The 10 M setting is reported for `mad_batch` only, since SampleQC holds its EM in memory. Sample counts are $S\in\{10,50,172\}$; the SampleQC article reports a real dataset of 172 samples and 867 k cells [R6]. Comparators are scuttle `isOutlier` per batch (vectorised) and SampleQC with K = 1 and K = 3 per group (proposed). Hold fixed the metrics, `nmads`, `alpha`, `em_iters`, `n_cores`, `seed`, `subsample` and `n_times` at their section 4 values. Dry-run estimates are checked against these measurements. CPU is the reference; CUDA is reported only where implemented.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
- **Feeds**:
  - `integration.batch_corrected_embedding`: Batch-corrected joint embedding
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
  - `abundance.celltype_proportion_test`: Differential abundance of predefined cell types between conditions
- **Reads**: `layers/counts`, `var/mito`, `obs/<sample_key>`, `obs/<batch_key>`, `uns/cellranger_metrics`
- **Writes**: `uns/sample_qc`, `uns/sample_qc_params`, `obs/sample_qc_group`, `models/sampleqc`
<!-- CHAINING:AUTO:END -->

Workflow: the sample-level step after cell-level QC and before integration and replicate-aware testing; no named recipe yet.

## 10. Risks, pitfalls and open questions

- **Evidence limits.** Performance figures come from the SampleQC abstract only. The article's simulation design is not described here, and the per-cell label output of `simulate_qcs` is treated as generator-provided in B1.
- **Unsettled methods.** The stability of the sample-level MAD for small $S$ and the effect of $K$ on SampleQC verdicts are uncharacterised in the sources used.
- **Package risks.** scuttle is described as legacy utilities, and a replacement was not identified. Only Cell Ranger metric names and definitions are reused; no Cell Ranger code is copied.
- **Data gaps.** The accession, terms of use, donor count and site count of the NeurIPS 2021 donor set are not confirmed in the sources. No labelled collection of failed or re-run libraries has been identified, so an expert-labelled benchmark (Cohen kappa against consensus pass or fail) is deferred until one exists. Genotype-based swap checks need multi-donor data with genotypes, which has not been identified.
- **Technical risks.** Cell counts depend on the cell caller, and cell-based thresholds mislead in low-RNA tissues and in nuclei; nuclear rules are in `qc.single_nucleus_quality_filtering`. A whole-batch failure may need reference distributions from the catalogue to be detected.
- **First experiment.** Evaluate B2 for `mad_batch`, SampleQC with K = 1, and the proposed distance, to calibrate the sample cutoff and $\alpha_s$. Adopt a model-based verdict only if it meets the B2 acceptance criterion, then check B3 on the multi-donor NeurIPS data.

## 11. References

R1. Single-cell Best Practices Consortium. Raw data processing. In: *Single-cell best practices online book*. 2023. — partial (corpus)

R2. 10x Genomics. Cell Ranger source repository: webshim metric definitions (`lib/python/cellranger/webshim/constants/gex.py`). GitHub repository 10XGenomics/cellranger. 2026. https://github.com/10XGenomics/cellranger — verified (repo)

R3. Ewels P, Magnusson M, Lundin S, Käller M. MultiQC: summarize analysis results for multiple tools and samples in a single report. *Bioinformatics* 2016. doi:10.1093/bioinformatics/btw354 — partial (repo)

R4. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)

R5. Amezquita R, Lun A, Hicks S, Gottardo R. Orchestrating Single-Cell Analysis with Bioconductor. Bioconductor book, 2022. https://bioconductor.org/books/release/OSCA/ — verified (corpus)

R6. Macnair W, Robinson MD. SampleQC: robust multivariate, multi-cell type, multi-sample quality control for single-cell data. *Genome Biology* 2023;24:23. doi:10.1186/s13059-023-02859-3 — verified (search)

R7. Macnair W. SampleQC: R package, version 0.6.6. GitHub repository wmacnair/sampleqc. 2021. https://github.com/wmacnair/sampleqc — verified (repo)

R8. Rousseeuw PJ, Van Driessen K. A fast algorithm for the minimum covariance determinant estimator. *Technometrics* 1999;41(3):212–223. doi:10.2307/1270566 — partial (search)

R9. Lun ATL, McCarthy DJ. scuttle: Legacy Utilities for Single-Cell RNA-Seq Analysis, R package version 1.23.2. GitHub repository LTLA/scuttle. https://github.com/LTLA/scuttle — verified (repo)

R10. McCarthy DJ, Campbell KR, Lun ATL, Wills QF, et al. scater R package. GitHub repository Alanocallaghan/scater. https://github.com/Alanocallaghan/scater — partial (repo)

R11. Germain PL, Sonrel A, Robinson MD. pipeComp R package. GitHub repository plger/pipeComp. https://github.com/plger/pipeComp — verified (repo)

R12. McCarthy DJ, Campbell KR, Lun ATL, Wills QF. Scater: pre-processing, quality control, normalization and visualization of single-cell RNA-seq data in R. *Bioinformatics* 2017. doi:10.1093/bioinformatics/btw777 — verified (corpus)

R13. Lun ATL, McCarthy DJ, Marioni JC. A Step-by-Step Workflow for Low-Level Analysis of Single-Cell RNA-Seq Data with Bioconductor. *F1000Research* 2016. doi:10.12688/f1000research.9501.2 — verified (corpus)

R14. Luecken MD, Burkhardt DB, Cannoodt R, et al. A sandbox for prediction and integration of DNA, RNA, and proteins in single cells. NeurIPS 2021 Datasets and Benchmarks Track. — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/LTLA/scuttle | Aaron Lun, Davis McCarthy | GPL-3 (DESCRIPTION; no LICENSE file at the repository root) | Per-batch scaled-MAD rule | reimplement |
| https://github.com/Alanocallaghan/scater | Davis McCarthy, Kieran Campbell, Aaron Lun, Quin Wills and others | GPL-3 (DESCRIPTION) | Re-exports `isOutlier` from scuttle | reimplement (same rule) |
| https://github.com/wmacnair/sampleqc | Will Macnair | MIT + file LICENSE (copyright 2021 Will Macnair) | Joint mixture, cell outliers, sample groups | port |
| https://github.com/plger/pipeComp | Pierre-Luc Germain, Anthony Sonrel, Mark D. Robinson | GPL (DESCRIPTION, version not stated); GPL-3 LICENSE file | Lenient vote filter | callout |
| https://github.com/10XGenomics/cellranger | 10x Genomics | 10x Genomics licence (MIT-style permission text; rights exercisable only with 10x Genomics products) | Metric names and definitions | reimplement |
| https://github.com/ewels/MultiQC | Philip Ewels, Måns Magnusson, Sverker Lundin, Max Käller | GPL-3 (LICENSE file) | Reader for upstream report output | reimplement |
