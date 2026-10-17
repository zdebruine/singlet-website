---
id: qc.mito_fraction_cutoff_by_tissue
title: Tissue- and species-specific mitochondrial fraction cutoff
area: qc
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [cell-calling.cell_vs_empty_droplet_calling, cell-calling.nucleus_vs_empty_calling]
feeds: [qc.low_quality_cell_detection, qc.sample_level_qc]
reads: [layers/counts, var/mito, obs/<group_by>]
writes: [obs/pct_mito, obs/mito_flag, obs/prob_compromised, uns/mito_cutoff_by_group, models/mito_miqc, models/mito_mitochontrol]
devices: [cpu, cuda]
mcp_tool: singlet_qc_mito_fraction_cutoff_by_tissue
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Tissue- and species-specific mitochondrial fraction cutoff

> Flags cells whose mitochondrial UMI percent is high relative to their own group (tissue, sample or cluster) and reports the cutoff fitted for each group, using a published upper-tail MAD rule with a floor, a fixed bound, or one of two mixture models that condition on detected genes or cluster.

## 1. Question

Given raw UMI counts with species and group labels, which mitochondrial-percent cutoff, fitted per tissue, sample or cluster, separates cells that have lost cytoplasmic RNA from viable cells of naturally high-mitochondrial types, and which cells lie above it? A correct answer flags damaged cells while keeping every viable population. The output is a cutoff per group in percent of UMIs and a per-cell flag. The literature offers no per-cell viability truth for this question (section 10).

## 2. Why this task matters and where the field stands

Mitochondrial transcripts are retained when cytoplasmic mRNA leaks from a damaged cell, so a high mitochondrial fraction is a common damage signal, read best together with library size and detected genes [R4]. Tutorials apply a constant bound of 5 percent. A tissue-level study built on PanglaoDB [R7][R8] reports reference mitochondrial proportions for 44 human tissues and finds that the 5 percent bound holds for nearly all mouse tissues [R8]. Its human-tissue result is not reproduced here (section 10), so a single constant cannot be assumed to fit every tissue.

The task is **contested**.

1. **Constants do not transfer.** The miQC vignette in its repository calls mitochondrial thresholds arbitrary and at times detrimentally stringent, especially for archived tumour tissue (section 12).
2. **Biology confounds the signal.** QC metrics are assumed independent of biology, which fails in heterogeneous populations where some cell types naturally carry more mitochondria [R10].
3. **Library complexity confounds it too.** A high fraction with few detected genes suggests loss of cytoplasmic RNA, whereas a high fraction with many genes may be biology. miQC models the two jointly [R1].
4. **Ground truth is weak.** No dataset with independent viability labels is documented here, so evaluation rests on the designs in section 8.

Open problems are thresholds that hold across tissues, protocols and depths without tuning; separating damaged cells from viable high-mitochondrial types; nuclei, which should carry few mitochondrial transcripts; and a per-group cutoff with calibrated uncertainty, which no published heuristic provides.

## 3. Theory and insight

**Notation.** For cell $i$ in group $g$: $t_i$ is the total UMI count, $m_i$ the UMI count in the species mitochondrial gene set, $d_i$ the number of detected genes, $p_i = 100\,m_i/t_i$ the mitochondrial percent of UMIs, and $\ell_i = \operatorname{logit}\bigl((m_i+1)/(t_i+2)\bigr)$ the pseudocount logit. $\operatorname{expit}$ is the inverse logit.

**Estimands.** Every cutoff, flag and percent column is in percent of UMIs, so $p_i$ is the reported `pct_mito`, and the floor is written as 8, never as 0.08. The MAD cut $c^{\mathrm{MAD}}_g$ is the percent level at which the logit rule switches, up to the pseudocount. The floor $F=8$ is on the same percent scale. The miQC posterior $\gamma_i$ is the probability, under the fitted mixture, that cell $i$ belongs to the compromised component; it is a model quantity, not the probability that the cell is dead. The MitoChontrol posterior $P(z_i=c\mid p_i)$ is a model quantity of the same kind within a group. Ground-truth quantities: the planted label $y_i\in\{0,1\}$ per cell, fixed at generation; type retention $\mathrm{ret}(t)$, the number of kept cells of type $t$ over the number of cells of type $t$ (cell counts, not UMIs); and the removed fraction, flagged cells over cells in the group.

**Heuristic rule.** Let $\tilde\ell_g$ and $\mathrm{MAD}_g(\ell)$ be the median and the unscaled median absolute deviation of $\ell_i$ in group $g$. The conjunctive rule flags cell $i$ when

$$\ell_i>\tilde\ell_g+k\,\mathrm{MAD}_g(\ell)\quad\wedge\quad p_i>F.$$

The logit is monotone, so the first arm is equivalent, up to the pseudocount, to $p_i > c^{\mathrm{MAD}}_g = 100\,\operatorname{expit}\bigl(\tilde\ell_g+k\,\mathrm{MAD}_g(\ell)\bigr)$. The rule then flags, up to the pseudocount, the cells above $\max(c^{\mathrm{MAD}}_g,F)$. The floor is inactive when $c^{\mathrm{MAD}}_g\ge F$ and binds when $c^{\mathrm{MAD}}_g<F$. Because it only removes flags, it relaxes removal in groups with a low MAD cut. It does not protect a group whose healthy cells are highly mitochondrial, since the MAD cut already lies above 8 percent there. *Regime*: the median and MAD describe the bulk when most cells are intact and the transformed values are roughly unimodal. If most cells have zero mitochondrial counts, the median sits at the zero value and the MAD is small, so the logit arm flags cells with few counts and the floor is the only guard. Heterogeneous groups inflate the MAD, which protects rare types at the cost of power [R10].

**Fixed bound.** Flag when $p_i > c$. The constant describes one population and does not adapt to a group.

**miQC.** Within a group, with $v_i = p_i$,

$$p(v_i\mid d_i)=\sum_{k=1}^{2}\pi_k\,\mathcal N\bigl(v_i\mid\beta_{k0}+\beta_{k1}d_i,\sigma_k^2\bigr),\qquad \gamma_i=\frac{\pi_{c^*}\,\phi_{c^*}(v_i\mid d_i)}{\sum_{k=1}^{2}\pi_k\,\phi_k(v_i\mid d_i)},$$

where $\phi_k$ is the normal density of component $k$ and $c^*$ is the component with the larger intercept $\beta_{k0}$. A cell is flagged when $\gamma_i>\tau$. A percent cutoff for a group is the lowest $v$ with $\gamma(v,\tilde d_g)=\tau$ at the group median $\tilde d_g$ of $d_i$, because the boundary moves with detected genes. *Regime*: two identifiable linear Gaussian components over the group's range of $d_i$; $\gamma$ is calibrated only if the model holds. The reference implementation keeps cells below the fitted intact line and, with its left-cutoff option, also discards cells with no more detected genes than the least mitochondrial discarded cell and at least its mitochondrial percent [R1]. It stops with an error when every cell passes the posterior cut, and its fit depends on the random seed [R1].

**MitoChontrol.** Within a cluster, a Gaussian mixture of up to five components is fitted to $p_i$ by online EM. The compromised component is chosen from average posteriors in the high and low mitochondrial regions, and the cutoff is where $P(z_i=c\mid p_i)$ reaches a threshold $\theta$ [R9]. *Regime*: valid within a cluster that is itself homogeneous, so clustering resolution moves the cutoff.

**Why model-based adds value.** A joint model of $p_i$ and $d_i$ separates loss from biology in a way a single MAD cannot, and it returns a posterior whose calibration can be checked on planted cells (section 8). The cost is assumptions that can fail. Heuristics are transparent and reproducible, and their threshold summarises the bulk without modelling damage.

**Failure modes.** Heuristics assume the upper tail is damage. A heterogeneous tissue inflates the MAD and makes the rule permissive, while a fixed bound removes viable high-mitochondrial types. Mixtures need two identifiable components, depend on seeds, and fail in small groups. No rule that conditions only on mitochondrial RNA sees compromise that does not raise the mitochondrial share, such as degradation without cytoplasmic loss.

**Pitfalls.** Applying the adaptive rule to pooled batches lets a shallow batch shift the median and inflate the MAD, so thresholds belong per batch. Percent and fraction conventions differ across tools, so an unlabelled 0.08 can be silently 0.08 percent. A cutoff chosen from the same labels it is judged against is circular.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Fixed percent bound | heuristic | One constant for every group; 5 in the Seurat pbmc3k tutorial | — |
| MAD with 8 percent floor (best-practices notebook) | heuristic | Median plus 3 unscaled MADs on the logit fraction, combined by AND with an 8 percent floor | [R4] |
| MAD outlier (scuttle `isOutlier`) | heuristic | Scaled MAD outlier on a metric; the mitochondrial use is the upper tail, per batch if requested | [R5] (function now in scuttle, section 12) |
| pipeComp mitochondrial rule | heuristic | Upper-tail MAD with a 0.08 floor, plus a lower-tail MAD test | [R3] |
| miQC | model-based | Two-component mixture of linear regressions on detected genes; posterior cut | [R1] |
| MitoChontrol | model-based | Per-cluster Gaussian mixture; posterior threshold on the compromised component | [R9] |

The routine standard is the fixed tutorial bound and the MAD outlier rule with an 8 percent floor from the best-practices notebook [R4]; the scuttle function [R5] is the same statistic on the raw fraction. miQC [R1] and MitoChontrol [R9] are the model-based alternatives, and both are compared with the heuristics in section 8. Classifiers of whole-cell quality, cellity [R2] and dropkick [R6], return labels rather than a mitochondrial cutoff and are covered by `qc.low_quality_cell_detection`.

Exact defaults used for the comparators:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| Notebook | MAD function | `median_abs_deviation` with scipy's default scale (unscaled) | jupyter-book/preprocessing_visualization/quality_control.ipynb cell index 20 @ d581689 |
| Notebook | logit transform | logit of (m+1)/(t+2) | cell index 22 @ d581689 |
| Notebook | mitochondrial MAD multiple and floor | 3 upper MADs, and pct_counts_mt > 8 | cell index 24 @ d581689 |
| scuttle | `isOutlier` nmads, type, log | 3, both, FALSE | R/isOutlier.R:91 @ d3476eb |
| scuttle | MAD constant | `formals(mad)$constant` (1.4826) | R/isOutlier.R:181 @ d3476eb |
| pipeComp | `filt.lenient` mitochondrial rule | 3 MADs lower; 3 MADs higher and > 0.08 | inst/extdata/scrna_alternatives.R:262-263 @ a3fd419 |
| pipeComp | `filt.default` mitochondrial rule (used by stringent) | 3 MADs lower; 2.5 MADs higher and > 0.08 | scrna_alternatives.R:285-286 @ a3fd419 |
| miQC | model type and mixture | linear; flexmix k = 2 on mito percent ~ detected | R/mixtureModel.R:52 @ a31358e |
| miQC | posterior cutoff | 0.75 | R/filterCells.R:54 @ a31358e |
| miQC | keep below boundary, left cutoff | TRUE, TRUE | R/filterCells.R:55-56 @ a31358e |
| miQC | compromised component | larger intercept | R/filterCells.R:66 @ a31358e |
| MitoChontrol | pipeline threshold | (0.8,) | mitochontrol/pipelines.py:312-313 @ 4fb35d5 |
| MitoChontrol | threshold function default | 0.75 | mitochontrol/thresholding.py:188 @ 4fb35d5 |
| MitoChontrol | mixture initialisation and components | quantile; up to 5 | mitochontrol/pipelines.py:231-232 @ 4fb35d5 |
| MitoChontrol | online EM learning rate | 0.05 | mitochontrol/models.py:391 @ 4fb35d5 |
| MitoChontrol | high and low posterior thresholds | 0.2 and 0.2 | mitochontrol/thresholding.py:337-338 @ 4fb35d5 |
| MitoChontrol | mitochondrial prefix | MT- (mouse needs mt-) | mitochontrol/core.py:196 @ 4fb35d5 |
| Seurat pbmc3k tutorial | percent.mt bound | < 5 | vignettes/pbmc3k_tutorial.Rmd:122 @ 5f67c70 |
| Seurat WNN tutorial | percent.mt bound | < 20 | vignettes/weighted_nearest_neighbor_analysis.Rmd:225 @ 5f67c70 |
| dropkick | mitochondrial gene pattern | `^mt-\|^MT-` | dropkick/api.py:31 @ bd2647a |

## 5. Proposed singlet approach

**Routes.** `mad` ports the notebook rule and reimplements the per-group median and MAD with scuttle's batch semantics. `fixed` is new. `miqc` is a port. `mitochontrol` is ported from the code, with the preprint read before the port is final (section 10). pipeComp, scanpy, Seurat and dropkick are callouts used as comparators or as sources of defaults.

**Default.** `mad` with $k=3$ unscaled MADs, the logit transform and an 8 percent floor, computed per `group_by` group. This is the published heuristic, kept as the default because no model-based method yet meets the B1 and B2 criteria. `miqc` becomes the default only if it meets both criteria and its B2 retention is at least that of `mad`.

**Proposed model.** A hierarchical miQC. For a group $g$ (tissue and protocol) and a sample $s$ in it, the mixture parameters are $\theta_s=\bar\theta_g+\delta_s$ with $\delta_s\sim\mathcal N(0,\Omega_g)$. The group parameters $\bar\theta_g$ and $\Omega_g$ are estimated by empirical Bayes from unlabelled covariates across the singlet catalogue (354 million cells, about 40 percent author-annotated), stratified by tissue and protocol. The output is $\gamma_i$ per cell and a cutoff per group. Four results would reject it, each fixed before the comparison: (i) more failed fits than per-sample `miqc` on small samples; (ii) planted fractions in equal-width bins of $\gamma$ falling outside bootstrap intervals over libraries; (iii) recall at a false-positive rate of 0.05 on B1 not exceeding `mad` by a stated margin; (iv) minimum type retention below 0.95 on B2.

**Stack.** The two-component EM and the group-level empirical Bayes are small, hot models. They are hard-coded in C++ with CUDA kernels (one sample per block) and do not use PyTorch. The metric pass is a row-local reduction over the CSR matrix, with cuSPARSE for the mitochondrial sums, and the MAD uses selection. Fits hold one value per cell per group, while the metric pass streams row blocks. PyTorch would be needed only for a learned conditional density, which is not proposed.

**Defaults without asking.** `method` mad; `floor_percent` 8.0; `nmads` 3; `transform` logit; `group_by` set to the tissue key when present; `dry_run` first above one million cells. Set `species` explicitly.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Raw UMI counts, cells by genes; $t_i$ is the row sum over all genes. |
| read | var/mito | bool | Mitochondrial gene mask; derived from the species prefix when absent. |
| read | obs/`group_by` | categorical | Group labels; required when `group_by` is set. |
| write | obs/pct_mito | float32 | $p_i$, percent of UMIs. |
| write | obs/mito_flag | bool | True when the cell is above its group cutoff for the chosen method. |
| write | obs/prob_compromised | float32 | $\gamma_i$ (miqc) or $P(z_i=c\mid p_i)$ (mitochontrol); absent for mad and fixed. |
| write | uns/mito_cutoff_by_group | table | Group, method, cutoff in percent, cells, flagged cells and removed fraction. |
| write | models/mito_miqc, models/mito_mitochontrol | object | Per-group fitted parameters, seed and convergence status. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `species` | string | required | `human`, `mouse`, `other` | Sets the mitochondrial gene prefix: MT- for human, mt- for mouse; other reads var/mito. No safe default. |
| `method` | string | "mad" | `mad`, `fixed`, `miqc`, `mitochontrol` | mad: upper-tail MAD on logit fraction with floor (default). fixed: constant bound. miqc, mitochontrol: model posteriors. |
| `group_by` | string/null | null | — | obs column defining fit groups, such as tissue or sample; use the cluster key for mitochontrol. Null means the whole dataset. |
| `mad` | object | — | — | Options for method mad. |
| `mad.nmads` | number | 3 | > 0 | Upper-tail threshold in unscaled MADs above the group median of the transformed fraction. |
| `mad.transform` | string | "logit" | `logit`, `identity` | Scale on which the median and MAD are computed: logit (with pseudocount) or identity. |
| `mad.floor_percent` | number/null | 8.0 | min 0; max 100 | Percent of UMIs a cell must also exceed to be flagged (AND rule); null disables the floor. |
| `fixed` | object | — | — | Options for method fixed. |
| `fixed.mito_percent` | number | 5.0 | min 0; max 100 | Cells with mitochondrial percent above this are flagged; a tutorial convention, comparator only. |
| `miqc` | object | — | — | Options for method miqc. |
| `miqc.posterior_cutoff` | number | 0.75 | min 0; max 1 | Cells with posterior probability of the compromised component above this are flagged. |
| `miqc.model_type` | string | "linear" | `linear`, `spline`, `polynomial`, `one_dimensional` | Regression of mitochondrial percent on detected genes: linear, spline, polynomial or one-dimensional. |
| `miqc.enforce_left_cutoff` | boolean | true | — | Also flag low-complexity cells with mitochondrial percent at or above the least-mitochondrial flagged cell. |
| `mitochontrol` | object | — | — | Options for method mitochontrol. |
| `mitochontrol.threshold_prob` | number | 0.8 | min 0; max 1 | Posterior probability threshold for the compromised component within each group. |
| `seed` | integer | 0 | — | Initialisation seed for miqc and mitochontrol mixtures; mad and fixed are deterministic. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Parameters under `mad`, `fixed`, `miqc` and `mitochontrol` are read only by their own method; the output records any that are ignored. `seed` acts on `miqc` and `mitochontrol` only. `keep_all_below_boundary` is fixed at its miQC default and not exposed. Each group is fitted separately, and a group that fails to fit, for example because every cell passes the miQC cut, returns its status rather than a cutoff. A missing prefix yields zero mitochondrial counts, so the tool reports an error when no gene matches.

## 7. MCP tool

Tool name `singlet_qc_mito_fraction_cutoff_by_tissue` (definition in `tasks/mcp/singlet_qc_mito_fraction_cutoff_by_tissue.json`). Example call and compact result:

```json
{"dataset": "data/lib.singlet", "species": "human", "method": "mad",
 "group_by": "tissue", "mad": {"nmads": 3, "floor_percent": 8.0}}
```

```json
{"dataset": "data/lib.singlet", "status": "completed",
 "wrote": ["obs/mito_flag", "uns/mito_cutoff_by_group"],
 "summary": {"method": "mad", "groups": "<g>", "cells_in": "<n>", "cells_flagged": "<k>", "cutoff_range": "<min-max>"},
 "provenance_id": "<id>"}
```

Large inputs may return `queued` with a `job_id`. Stochastic: `miqc` and `mitochontrol` through `seed`. Dry-run returns `seconds`, `peak_memory_gb` and `device`, estimated from cell count, group count and method.

## 8. Benchmarks

Every benchmark uses the same metric definitions. Cell labels are per cell, retention and removed fraction are cell counts, and metrics are computed per dataset and macro-averaged. A group is a tissue within a protocol, the unit at which `group_by` is set. Stochastic methods use seeds 0 to 4 and report the mean and range. Comparators run at the section 4 defaults unless stated, with hardware, versions and commits recorded. All thresholds are fixed before results are seen.

### B1. Planted mitochondrial compromise (proposed)

- **Goal**: per-cell recall and specificity of each method when compromise is injected with known labels.
- **Ground truth**: planted simulation. A cell is labelled 1 when injected and 0 otherwise, fixed at generation. The estimand is the injected indicator per cell; prevalence is the injected cells over all cells.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| pipeComp `mixology10x5cl` | figshare 10.6084/m9.figshare.11787210.v1, listed in the pipeComp repository [R3] | scRNA-seq (10x, per dataset name); species and size not confirmed | not confirmed | Base population assumed intact; untouched cells form the specificity set. |

- **Generator** (proposed):
  1. Draw 10 percent of cells per seed as injected; the prevalence is an assumption.
  2. Multiply the mitochondrial UMIs of injected cells by $f$.
  3. Binomially thin the non-mitochondrial UMIs of injected cells with retention $r$, to mimic cytoplasmic loss, and recompute totals.
  4. Grid: $f\in\{2,4,8\}$ and $r\in\{0.5,0.8\}$, with five seeds.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Precision, recall, F1 | Positives are injected cells; $P=\mathrm{TP}/(\mathrm{TP}+\mathrm{FP})$, $R=\mathrm{TP}/(\mathrm{TP}+\mathrm{FN})$, $F_1=2PR/(P+R)$, per seed | maximize | primary | — |
| Specificity | $1-$ flagged untouched cells / untouched cells | maximize | guardrail | — |

- **Comparators**: `fixed` at 5 percent; `mad` at its defaults; `miqc` at posterior 0.75; `mitochontrol` at threshold 0.8 on Leiden clusters computed before injection with the resolution fixed in advance.
- **Protocol**: one group per dataset; each method at its defaults, over the grid and seeds above.
- **Acceptance criterion** (proposed): F1 at least 0.8 at $f=8$ and $r=0.5$, and specificity at least 0.95.
- **Known pitfalls**: a thinning generator favours covariates built on detected genes, so `miqc` gains from the generator's own structure; mitochondrial-only injection does not reproduce degradation, so B1 cannot show misses of compromise without RNA loss.

### B2. Protected cell-type retention (proposed)

- **Goal**: whether a rule removes viable cell types with naturally high mitochondrial content within a tissue, at each operating point.
- **Ground truth**: expert labels. Each cell carries the curated author cell-type label from the catalogue; protected types are defined before results are seen, from tissue-specific marker sets. The estimand is $\mathrm{ret}(t)$ as defined in section 3.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Annotated catalogue subsets | singlet catalogue, annotated subset (section 5) | scRNA-seq; species and size not stated here | internal | Tissues and protocols chosen by a rule fixed before results are seen. |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Minimum type retention | $\min_t\mathrm{ret}(t)$ over protected types with at least 100 cells | maximize | guardrail | — |
| Removed fraction | Flagged cells over cells in the group, per tissue and protocol | minimize | guardrail | — |

- **Comparators**: `fixed` at 5 percent; `mad` and `miqc` per tissue; `mitochontrol` per cluster.
- **Protocol**: each rule per tissue and protocol with `group_by` set to tissue; report the trade-off curve of removed fraction against minimum retention over the cutoff or posterior.
- **Acceptance criterion** (proposed): at the chosen operating point, retain at least 0.95 of every protected type.
- **Known pitfalls**: author labels may use mitochondrial content or QC-based clusters, which makes the truth circular; dissociation-stressed cells can carry a high-mitochondrial type label.

### P1. Performance and scaling

Wall time, peak memory and throughput at 10k, 100k, 1M and 10M cells (10M to support the streaming claim), on CPU and CUDA, for `fixed`, `mad`, `miqc` and `mitochontrol`. Hold fixed: the CSR input, species prefix, group count, seeds and thread count. Record miQC iterations, convergence failures and the spread of cutoffs across seeds at each scale.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `cell-calling.nucleus_vs_empty_calling`: Nucleus versus empty-droplet calling in single-nucleus RNA-seq
- **Feeds**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
- **Reads**: `layers/counts`, `var/mito`, `obs/<group_by>`
- **Writes**: `obs/pct_mito`, `obs/mito_flag`, `obs/prob_compromised`, `uns/mito_cutoff_by_group`, `models/mito_miqc`, `models/mito_mitochontrol`
<!-- CHAINING:AUTO:END -->

Consumes cell-calling output; its per-cell flags and group cutoffs feed the low-quality detector and sample-level QC.

## 10. Risks, pitfalls and open questions

- **Tissue-level evidence rests on one study.** [R8] was read through a search summary of its abstract, which gives reference thresholds for 44 human tissues and reports that the 5 percent bound holds for nearly all mouse tissues. The per-tissue values are not reproduced here, so no reference table ships and no reference method is in the enum.
- **No viability truth.** No dataset with independent viability or damage labels is documented, so the orthogonal-label benchmark cannot be executed; B1 and B2 are the only criteria for the default and the proposed model.
- **MitoChontrol's model.** The README describes per-cluster naive Bayes, the code fits a Gaussian mixture, and the preprint text was not read, so the port follows the code and the paper is checked before it is final.
- **Units differ across tasks.** This task reports percent of UMIs. The sibling task `qc.low_quality_cell_detection` uses a fraction (0.08) for its mitochondrial cutoff, so the two must be reconciled before implementation. pipeComp applies 0.08 to a column whose scale is set by an external function, so its unit is inferred.
- **Nuclei and ambient RNA.** Intact nuclei should carry few mitochondrial transcripts, so the MAD degenerates on them and ambient mitochondrial RNA can dominate. The nucleus-specific rule belongs to `qc.single_nucleus_quality_filtering` and is not settled here. Whether mitochondrial rules apply before or after ambient correction is unsettled.
- **Open design values and first experiment.** No minimum group size is source-backed, so B2 sets it. The first experiment applies `mad` and `miqc` per tissue on the B1 grid with seeds 0 to 4 and reports the spread of cutoffs; the proposed model is tested only after that.

## 11. References

R1. Hippen AA, Falco MM, Weber LM, Erkan EP, Zhang K, Doherty JA, Vähärautio A, Greene CS, Hicks SC. miQC: An adaptive probabilistic framework for quality control of single-cell RNA-sequencing data. *PLoS Computational Biology* 2021. doi:10.1371/journal.pcbi.1009290 — verified (corpus)
R2. Ilicic T, Kim JK, Kolodziejczyk AA, Bagger FO, McCarthy DJ, Marioni JC, Teichmann SA. Classification of low quality cells from single-cell RNA-seq data. *Genome Biology* 2016. doi:10.1186/s13059-016-0888-1 — verified (corpus)
R3. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)
R4. Heumos L, Schaar AC, Lance C, Litinetskaya A, Drost F, Zappia L, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R5. McCarthy DJ, Campbell KR, Lun ATL, Wills QF. Scater: pre-processing, quality control, normalization and visualization of single-cell RNA-seq data in R. *Bioinformatics* 2017. doi:10.1093/bioinformatics/btw777 — verified (corpus)
R6. Heiser CN, Wang VM, Chen B, Hughey JJ, Lau KS. Automated quality control and cell identification of droplet-based single-cell data using dropkick. *Genome Research* 2021. doi:10.1101/gr.271908.120 — verified (corpus)
R7. Franzén O, Gan LM, Björkegren JLM. PanglaoDB: a web server for exploration of mouse and human single-cell RNA sequencing data. *Database* 2019. doi:10.1093/database/baz046 — verified (corpus)
R8. Osorio D, Cai JJ. Systematic determination of the mitochondrial proportion in human and mice tissues for single-cell RNA-sequencing data quality control. *Bioinformatics* 2021;37(7):963. doi:10.1093/bioinformatics/btaa751 — verified (search)
R9. Strassburg C, Pitlor D, Singhi AD, Gottschalk R, Uttam S. MitoChontrol: Adaptive mitochondrial filtering for robust single-cell RNA sequencing quality control. *bioRxiv* 2026 (preprint). doi:10.64898/2026.04.04.716517 — verified (repo)
R10. Amezquita RA, Lun ATL, Hicks SC, Gottardo R. Orchestrating Single-Cell Analysis with Bioconductor. Bioconductor online book, 2022. https://bioconductor.org/books/release/OSCA/ — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE copyright line); book authors as cited in [R4] | Apache License 2.0 (LICENSE) | Notebook MAD rule on the logit fraction with floor | port |
| https://github.com/LTLA/scuttle | Aaron Lun (aut, cre), Davis McCarthy (aut), per DESCRIPTION | GPL-3 (DESCRIPTION); no LICENSE file | `isOutlier` semantics and MAD constant | reimplement |
| https://github.com/greenelab/miQC | Ariel Hippen (aut, cre), Stephanie Hicks (aut), per DESCRIPTION | BSD-3-Clause (LICENSE) | Two-component mixture and posterior cut | port |
| https://github.com/uttamLab/MitoChontrol | Strassburg (pyproject.toml); Strassburg C, Pitlor D, Singhi AD, Gottschalk R, Uttam S (README citation) | BSD-3-Clause (LICENSE and pyproject.toml) | Per-cluster posterior threshold | port |
| https://github.com/plger/pipeComp | Pierre-Luc Germain (cre, aut), Anthony Sonrel (aut), Mark D. Robinson (aut, fnd), per DESCRIPTION | GPL (DESCRIPTION); LICENSE file is the GNU GPL v3 text, whose section 13 names the Affero licence, which is why automated detection reported AGPL | Lenient and default mitochondrial rules; B1 dataset source | callout |
| https://github.com/scverse/scanpy | Ilan Gold, Philipp Angerer, Severin Dicks, per pyproject.toml | BSD-3-Clause (LICENSE) | `pct_counts_mt` metric | callout |
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and contributors, per DESCRIPTION | MIT + file LICENSE (DESCRIPTION) | Tutorial bounds | callout |
| https://github.com/KenLauLab/dropkick | Cody N. Heiser (LICENSE copyright line) | MIT (LICENSE); vendored glmnet components under GPL-2 (LICENSES/) | Mitochondrial gene pattern | callout |
| https://github.com/teichlab/cellity | Tomislav Illicic (aut, cre), Davis McCarthy (aut), per DESCRIPTION | GPL (>= 2) (DESCRIPTION); no LICENSE file | Out-of-scope whole-cell classifier | callout |
