---
id: cell-calling.cell_count_cutoff_selection
title: Cell/empty cut-off and expected cell-count selection
area: cell-calling
scope: core
paradigm: hybrid
literature_status: open
priority: P2
depends_on: [harmonization.count_matrix_state_detection, ingest-quant.umi_deduplication]
feeds: [doublets.expected_rate_estimation, qc.sample_level_qc]
reads: [layers/counts, obs/<sample_key>, uns/expected_cells]
writes: [uns/cell_count/estimated_cells, uns/cell_count/threshold_umi, uns/cell_count/fdr_level, uns/cell_count/ci_low, uns/cell_count/ci_high, uns/cell_count/sensitivity_table, obs/is_cell_cutoff]
devices: [cpu, cuda]
mcp_tool: singlet_cell_calling_cell_count_cutoff_selection
evidence_basis: corpus+repo+memory
last_reviewed: 2026-10-17
---

# Cell/empty cut-off and expected cell-count selection

> Choose where the cell/empty boundary sits on one unfiltered droplet channel, and report the cell count that boundary implies together with its sensitivity to the FDR level, the cut-off rule and the expected-cell input.

## 1. Question

Given the barcode totals and counts of one unfiltered droplet channel, where should the cell/empty boundary be set, and how many barcodes contain cells when no per-barcode truth exists? Inputs are the unfiltered matrix and optionally an expected cell count or per-barcode statistics. Outputs are a cut-off or error level, the count it implies, the retained set and a sensitivity table. The count is a scalar judged against orthogonal counts, not against per-barcode labels, which belong to cell-calling.cell_vs_empty_droplet_calling.

## 2. Why this task matters and where the field stands

Every droplet analysis starts from the barcodes kept as cells. Empty droplets carry ambient RNA shared across the channel, so calling errors propagate into normalisation, clustering, doublet scoring and ambient correction [R1]. A total-count threshold can also discard real cells with little RNA [R1]. Status: **open**. No source reviewed validates a cut-off or a count against an independent count; ranking comparisons, such as the ROC analyses of EmptyNN [R4], test the ordering of barcodes, not the boundary.

Open problems:

- **Conventions, not calibration.** The FDR level is 0.01 in the DropletUtils vignette [R7] and 0.001 in the OSCA chapter [R2] and for listed Cell Ranger chemistries [R8].
- **Ambient reference.** `lower` defines the null; OSCA advises lowering it when low-total p-values pile up near zero [R2].
- **Rough expected counts.** CellBender's help text tolerates a factor of two (section 4); no source benchmark measures how Cell Ranger responds.
- **Version drift.** OSCA calls Cell Ranger version 3 similar to EmptyDrops [R2]; the Cell Ranger code reviewed is one revision [R8].

## 3. Theory and insight

Notation: barcode $b$ has total UMI $N_b$; the tested set is $\mathcal T=\{b:N_b>\mathrm{lower}\}$, with $m=|\mathcal T|$; $\boldsymbol\rho$ is the ambient gene profile.

The total is not a cell label. A two-component mixture describes the totals, with cell fraction $\pi$:

$$p(N_b)=\pi\,f_{\mathrm{cell}}(N_b)+(1-\pi)\,f_{\mathrm{empty}}(N_b)$$

Its posterior cell probability is

$$q_b=\frac{\pi\,f_{\mathrm{cell}}(N_b)}{\pi\,f_{\mathrm{cell}}(N_b)+(1-\pi)\,f_{\mathrm{empty}}(N_b)}$$

and a barcode is called a cell when $q_b>\tau$, with $\tau=0.5$ the equal-cost Bayes boundary. The expected count $\hat N=\sum_b q_b$ has approximate variance $\sum_b q_b(1-q_b)$. That treats barcodes as independent and conditions on fitted parameters, so it understates uncertainty. This mixture is the proposed model, not a published method; knee rules approximate its boundary, and $q_b$ is calibrated only if the component densities are correct.

emptyDrops replaces the mixture with an ambient null. Each tested barcode's counts are multinomial with profile $\boldsymbol\rho$, estimated from barcodes at or below `lower`, and its p-value is the add-one Monte Carlo estimate over $M$ draws:

$$x_b\mid N_b\sim\mathrm{Multinomial}(N_b,\boldsymbol\rho),\qquad \hat p_b=\frac{1+\#\{j\le M:\ \ell^{(j)}\le \ell_b\}}{1+M}$$

Here $\ell_b$ is the barcode's multinomial log-likelihood and $\ell^{(j)}$ that of the $j$-th draw. The smallest attainable value is $1/(M+1)$, so $M$ must grow as the target FDR shrinks. Benjamini-Hochberg over the $m$ tested barcodes gives

$$\mathrm{FDR}_{(i)}=\min_{j\ge i}\frac{m\,p_{(j)}}{j}$$

and calls are barcodes with $\mathrm{FDR}\le\alpha$. Under valid nulls, with independence or positive dependence, the expected proportion of calls that are empty is at most $\alpha$. Validity requires that barcodes at or below `lower` are ambient; section 5 checks this.

Cell Ranger's expected-cell rule has no error model. With $R$ the expected recovered count, $c_{(k)}$ the $(k+1)$-th largest total and $k=\operatorname{round}(0.01R)$:

$$\tau=\max\bigl(1,\operatorname{round}(0.1\,c_{(k)})\bigr),\qquad \mathcal C=\{b:\ c_b\ge\tau\}$$

Here $\mathcal C$ is the called set. The expected count fixes the baseline rank and therefore the total directly; the 0.01 is one minus the 0.99 quantile constant (section 4).

Accuracy against a reference count is $\mathrm{RCE}=\lvert\hat N-N^\star\rvert/N^\star$, valid only where $N^\star$ counts the same barcodes and is orthogonal to the rule.

Estimands: $\hat N$ is an absolute barcode count per sample, not normalised to cells; $\alpha$ is the expected proportion of called barcodes that are empty (the denominator is calls, not tested barcodes); $q_b$ is one barcode's posterior cell probability.

Insight: without per-barcode truth, the boundary is controlled in one of two honest ways, an error rate among calls (emptyDrops, calibrated probabilistic callers) or a prior on the count (expected-cell rules), and the count should be reported as a function of both. A ROC or AUC ranks barcodes and does not validate the cut-off or the count it implies. Two pitfalls recur: `retain` keeps very large totals regardless of the ambient test, so $\alpha$ does not move the top of the curve; and tuning a cut-off on labels, then reporting accuracy on those labels, is circular.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Barcode-rank knee and inflection (barcodeRanks) | heuristic | Knee or inflection of the log-log rank curve | [R7] |
| emptyDrops | model-based | Multinomial ambient test, Monte Carlo p-values, BH FDR | [R1], [R7] |
| emptyDropsCellRanger | hybrid | Presumed-real subset from the expected count, then the emptyDrops test | [R7] |
| Cell Ranger expected-cell rule | heuristic | Baseline rank from the expected count; cut-off one order of magnitude below; bootstrap interval | [R8] |
| Cell Ranger non-ambient test | model-based | Multinomial test with Good-Turing ambient profile and seeded simulation | [R8], [R1] |
| CellBender remove-background | model-based | Deep generative model with latent ambient profile; cell probability per droplet | [R3] |
| EmptyNN | model-based | Positive-unlabelled neural network, averaged over folds and iterations | [R4] |
| Fixed 200-UMI rule | heuristic | Retain barcodes with at least 200 UMIs | [R4] |

In practice the published standard for the count is the Cell Ranger expected-cell rule, and for the boundary an emptyDrops-type FDR test [R8, R2]. Rank rules are the fallback without an expected count. CellBender and EmptyNN are model-based callers evaluated against labels [R3, R4]; here they are comparators only. Paths are relative to each repository root.

| Method | Parameter | Value | Source (file:line @ revision) |
|---|---|---|---|
| barcodeRanks | lower | 100 | R/barcodeRanks.R:86 @ ba4152de |
| barcodeRanks | exclude.from | 50 | R/barcodeRanks.R:86 |
| barcodeRanks | df | 20 | R/barcodeRanks.R:86 |
| emptyDrops | lower | 100 | R/emptyDrops.R:381 |
| emptyDrops | niters | 10000 | R/emptyDrops.R:188 |
| emptyDrops | alpha | Inf (multinomial) | R/emptyDrops.R:188 |
| emptyDrops | p-value estimator | (count above + 1)/(niters + 1) | R/emptyDrops.R:253 |
| emptyDrops | retain | NULL: knee-based; very large totals get p = 0 | R/emptyDrops.R:381; vignettes/DropletUtils.Rmd:162 |
| emptyDrops | FDR, vignette | 0.01 | vignettes/DropletUtils.Rmd:160 |
| emptyDrops | FDR, OSCA chapter | 0.001 | OSCA droplet-processing.Rmd:65 |
| emptyDropsCellRanger | n.expected.cells; max.percentile; max.min.ratio | 3000; 0.99; 10 | R/emptyDropsCellRanger.R:103 |
| Cell Ranger | routing, RNA without force-cells | ORDMAG_NONAMBIENT | mro/rna/stages/counter/filter_barcodes/__init__.py:563-571 @ 669395e2 |
| Cell Ranger | bootstrap samples; baseline quantile | 100; 0.99 | cell_calling_helpers.py:53-54 |
| Cell Ranger | cut-off as fraction of baseline | 0.1 | cell_calling_helpers.py:902 |
| Cell Ranger | non-ambient adjusted p | 0.001 listed chemistries; 0.01 otherwise | cell_calling.py:105-110 |
| Cell Ranger | non-ambient minimum UMI; simulations | 500; 100000 | cell_calling.py:41, 43 |
| CellBender | --fpr | 0.01 (help: target delta false-positive rate) | cellbender/remove_background/argparser.py:196 @ f36ae299 |
| CellBender | --expected-cells | user input; help: a factor of two is sufficient | cellbender/remove_background/argparser.py:83-88 |
| EmptyNN | iterations N | 10 | README.md:8 |
| Fixed UMI rule | threshold | 200 | Reproducibility/Cell_calling.Rmd:56-58 |

## 5. Proposed singlet approach

Section 12 gives each method's route and licence. The enum holds the three methods whose primary code was read and that singlet implements from documented behaviour; other methods are comparators called outside singlet.

**Default.** `emptydrops` at `fdr` 0.001 (defaults in section 6): the only enum method that attaches an error rate to every call, the boundary control section 3 identifies as honest without truth. The expected count enters through the sensitivity sweep and `expected_cells_ordmag`.

**Diagnostic gate.** Before a count is reported, ambient-null p-values for barcodes at or below `lower` must look uniform: Kolmogorov-Smirnov distance to uniform at most 0.05, and at most 0.02 of p-values at or below 0.01 (proposed). If the gate fails, lower `lower` and repeat, as OSCA advises [R2].

**Proposed extension (not in the enum).** Fit the section 3 mixture with a prior on $N$ centred on the expected count, scoring barcodes with the multinomial ambient likelihood; the output would be $\hat N=\sum_b q_b$ with posterior intervals. It is falsified if its count error exceeds the B1 or B2 criterion, or if its 95 percent interval covers the planted count in fewer than 95 percent of B3 replicates.

**Stack.** One streaming pass in row chunks computes totals and the rank curve. Monte Carlo draws are independent across barcodes, so they parallelise on CPU and map to a batched kernel; a hand-written CUDA kernel is justified only if profiling shows that stage dominates. The mixture fit would use PyTorch.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | unfiltered barcode-by-gene UMI counts, all barcodes |
| read | obs/<sample_key> | string | sample label; one ambient profile per sample |
| read | uns/expected_cells | int | expected recovered cells, used when no argument is given |
| write | uns/cell_count/estimated_cells | int | absolute count of barcodes called non-empty |
| write | uns/cell_count/threshold_umi | int | smallest total among called barcodes; the cut-off for threshold rules |
| write | uns/cell_count/fdr_level | float | FDR level used; null for threshold rules |
| write | uns/cell_count/ci_low, uns/cell_count/ci_high | int | interval for the count; null for emptydrops |
| write | uns/cell_count/sensitivity_table | table | count and Jaccard with the default call set, per setting |
| write | obs/is_cell_cutoff | bool | barcode retained by the selected rule |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Unfiltered UMI matrix handle (.singlet path or URI, or workspace handle). |
| `method` | string | "emptydrops" | `emptydrops`, `barcode_rank_knee`, `expected_cells_ordmag` | Cut-off rule; emptydrops is the default. |
| `expected_cells` | integer | — | min 1 | Expected recovered cells; falls back to uns/expected_cells. |
| `lower` | integer | 100 | min 0 | Totals at or below this define the ambient reference. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto prefers CUDA when memory allows. |
| `seed` | integer | 0 | — | Seed for Monte Carlo draws and bootstrap resamples. |
| `dry_run` | boolean | false | — | Return the estimate only; write nothing. |
| `overwrite` | boolean | false | — | Replace existing outputs instead of failing. |
| `emptydrops` | object | — | — | Options for emptydrops. |
| `emptydrops.fdr` | number | 0.001 | max 1; > 0 | Benjamini-Hochberg level for called barcodes. |
| `emptydrops.niters` | integer | 10000 | min 1 | Monte Carlo draws per tested barcode. |
| `emptydrops.retain` | string | "knee" | `knee`, `none` | knee leaves totals above the knee untested; none disables this. |
| `barcode_rank_knee` | object | — | — | Options for barcode_rank_knee. |
| `barcode_rank_knee.exclude_from` | integer | 50 | min 0 | Top-ranked barcodes excluded from the knee search. |
| `barcode_rank_knee.window_log10` | number | 1 | > 0 | Knee search window in log10 units. |
| `expected_cells_ordmag` | object | — | — | Options for expected_cells_ordmag. |
| `expected_cells_ordmag.within_fraction` | number | 0.1 | max 1; > 0 | Cut-off as a fraction of the baseline barcode count. |
| `expected_cells_ordmag.bootstrap_samples` | integer | 100 | min 1 | Bootstrap resamples for the count interval. |
| `sensitivity` | object | — | — | Settings for the sensitivity table. |
| `sensitivity.fdr_levels` | array | [0.001, 0.01] | — | FDR levels swept for emptydrops. |
| `sensitivity.expected_scales` | array | [0.5, 1, 2] | — | Multipliers on the expected count, when one exists. |
<!-- PARAMS:AUTO:END -->

`lower` applies to `emptydrops` and `barcode_rank_knee` and is ignored by `expected_cells_ordmag`. `expected_cells` is read from `uns/expected_cells` when absent, and `expected_cells_ordmag` then uses a bootstrap estimate. `sensitivity.expected_scales` applies only when an expected count exists. If barcodes near the boundary are Limited, raise `emptydrops.niters`. With `overwrite` false, existing outputs cause failure.

## 7. MCP tool

Tool name `singlet_cell_calling_cell_count_cutoff_selection` (definition in `tasks/mcp/singlet_cell_calling_cell_count_cutoff_selection.json`). Example call and compact result; values in angle brackets are schematic:

```json
{"dataset": "pbmc_unfiltered.singlet", "method": "emptydrops", "emptydrops": {"fdr": 0.001}}
```

```json
{"dataset": "pbmc_unfiltered.singlet", "status": "completed",
 "wrote": ["uns/cell_count/estimated_cells", "uns/cell_count/threshold_umi", "uns/cell_count/fdr_level", "uns/cell_count/ci_low", "uns/cell_count/ci_high", "uns/cell_count/sensitivity_table", "obs/is_cell_cutoff"],
 "summary": {"method": "emptydrops", "estimated_cells": "<int>", "threshold_umi": "<int>", "fdr_level": 0.001, "ci_low": null, "ci_high": null, "limited_share": "<fraction>", "sensitivity_table": "<rows>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: yes; large matrices return `queued` with a `job_id`, and runtime is not measured (P1). Stochastic: yes; `seed` fixes the Monte Carlo draws and bootstrap resamples. Dry run: returns `estimate` (seconds, peak memory, device) and writes nothing.

## 8. Benchmarks

Shared protocol: every accuracy benchmark applies each comparator at its documented default to the same matrix, with one ambient profile per sample fixed across sweeps. No parameter is chosen on the labels that score it, and sweeps are reported in full. Stochastic methods use five seeds, reported as mean and spread. Count and recall are computed on the same barcode set for every method.

### B1. Cell-hashing labels (published design, extended to count)

- **Goal**: test whether one rule's retained count and set match the hashing-defined cell-containing barcodes of one matrix.
- **Ground truth**: orthogonal measurement (antibody hashing). Cell-containing means any label other than Negative, as mapped in the EmptyNN analysis [R4]. $N^\star$ counts those barcodes in the labelled matrix, and the rule is applied to that same matrix, so the estimand is an absolute barcode count.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Stoeckius et al. cell-hashing data, as packaged for EmptyNN | [R5]; GSE108313 and the labelled RData file, linked in the EmptyNN repository (data/README.md:2-3) | Droplet scRNA-seq, hashtag antibodies; species —; barcodes — | One label per barcode |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Relative count error | $\lvert\hat N-N^\star\rvert/N^\star$; $\hat N$ = barcodes retained | minimise | primary | [R4] |
| ROC AUC | area under the ROC curve of each score; binary calls give balanced accuracy | maximise | guardrail | [R4] |
| Per-barcode F1 | F1 of retained barcodes against the label, over all barcodes | maximise | guardrail | [R4] |

- **Comparators**: EmptyNN; Cell Ranger v2 and v3 calls in the EmptyNN analysis; emptyDrops at FDR 0.001 and 0.01; CellBender at 20000 expected cells and 25000 droplets, as in the EmptyNN reproducibility code; the 200-UMI rule.
- **Protocol**: sweep emptyDrops FDR and CellBender expected cells (scaled by 0.5, 1 and 2); sweep the expected count for `expected_cells_ordmag`.
- **Acceptance criterion** (proposed, not from the literature): at default settings some method has RCE at or below 0.10 and F1 at or above 0.90, and every method's count lies within a factor of two of $N^\star$.
- **Known pitfalls**: hashing negatives can include low-quality cells, so $N^\star$ carries error; AUC ranks barcodes and does not validate the count.

### B2. Genotype-demultiplexed labels (published design, extended to count)

- **Goal**: test whether each cut-off keeps genotype-defined cell-containing barcodes and excludes none of them.
- **Ground truth**: orthogonal measurement (natural genetic variation; demuxlet). Singlet or doublet calls are cell-containing; unassigned or ambiguous barcodes are left out. $N^\star$ counts singlets plus doublets, and $\hat N$ counts retained barcodes among the assigned set, so both sides share one barcode set.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Multiplexed PBMC with demuxlet output | Reproducibility/Figure3.Rmd; demuxlet code at github.com/yelabucsf/demuxlet_paper_code [R6] | Droplet scRNA-seq, human PBMC; barcodes — | Counts regenerated with Cell Ranger 2.0 (data/README.md:6) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cell-containing recall | fraction of assigned cell-containing barcodes retained | maximise | primary | [R6] |
| Relative count error | $\lvert\hat N-N^\star\rvert/N^\star$ with $N^\star$ = singlets plus doublets | minimise | primary | [R6] |
| Recall by total-UMI decile | recall within each decile of total UMI | report | guardrail | — |

- **Comparators**: EmptyNN; Cell Ranger 2.0 calls in the repository analysis; emptyDrops at FDR 0.001; CellBender as in the repository's Cell_calling analysis.
- **Protocol**: the sweeps of B1; recall is stratified by total-UMI decile, where the methods differ.
- **Acceptance criterion** (proposed, not from the literature): recall at or above 0.95 among assigned barcodes with at least 1,000 total UMI at default settings.
- **Known pitfalls**: assignment needs informative reads, so low-depth cells are unlabelled and the test favours well-covered barcodes; doublets are cells, so retaining them is not an error.

### B3. Planted cells and empties (proposed)

- **Goal**: measure how well each rule recovers a known planted count across RNA content and depth.
- **Ground truth**: planted simulation; each barcode is a planted cell or empty by construction. $N_{\mathrm{planted}}$ counts planted cells; recall is taken per decile of planted-cell total UMI; realised FDR is planted empties divided by calls.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| One user-supplied unfiltered matrix with an empty tail | user input, through the recipe below | Droplet scRNA-seq; size set by the user | Depth distribution sets the result |

- **Generator recipe**:
  1. Estimate $\boldsymbol\rho$ from barcodes at or below `lower`.
  2. Bin presumed cells (above the barcode-rank knee) by total UMI.
  3. Thin presumed cells binomially to target depths; these are planted cells.
  4. Redraw barcodes at or below `lower`, scaled so that a set share lies above `lower`, multinomially from $\boldsymbol\rho$; these are planted empties.
  5. Mix $N_{\mathrm{planted}}$ cells (user values, for example 2,000, 5,000 and 10,000) with the empties.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Relative count error | $\lvert\hat N-N_{\mathrm{planted}}\rvert/N_{\mathrm{planted}}$ | minimise | primary | — |
| Recall by planted-cell decile | fraction of planted cells called, per decile of total UMI | maximise | primary | — |
| Realised FDR | planted empties among calls, divided by calls | minimise | guardrail | — |

- **Comparators**: barcode-rank knee; emptyDrops at FDR 0.001 and 0.01; emptyDropsCellRanger (callout); the Cell Ranger expected-cell rule given the planted count; CellBender at 0.5, 1 and 2 times the expected cells.
- **Protocol**: five seeds per count and depth bin, reported as mean and spread; `lower` and the bins are fixed across rules.
- **Acceptance criterion** (proposed, not from the literature): count error at or below 0.10 in the deepest bin, and realised FDR at or below 0.01 at the default FDR level.
- **Known pitfalls**: planted empties come from the fitted ambient model and planted cells lack real ambient contamination; both flatter emptyDrops-type rules.

### P1. Performance and scaling

Wall time and peak memory of each rule as raw barcodes grow from 1e4 to 3e6 (about the size of a 3-million-entry barcode whitelist), with genes, CPU threads, `niters`, FDR and seed fixed on one simulated matrix. Report the log-log slope of time against barcodes per method, timing ambient estimation, simulation and p-value adjustment separately. Comparators: barcodeRanks; emptyDrops and emptyDropsCellRanger at 10000 draws; the Cell Ranger non-ambient test at 100000 simulations, where the pipeline can run on the same matrix; CellBender on CPU and GPU, reported separately; EmptyNN at defaults, which the EmptyNN reproducibility notes place at about 30 minutes on unspecified hardware (repository in section 12). From code reading, not timings: barcodeRanks is dominated by a sort, O(B log B); emptyDrops scales with draws times tested barcodes. Acceptance (proposed): a GPU kernel is considered only if Monte Carlo draws dominate the measured time at 1e6 barcodes.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.count_matrix_state_detection`: Count-matrix processing-state detection
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
- **Feeds**:
  - `doublets.expected_rate_estimation`: Expected doublet rate estimation
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
- **Reads**: `layers/counts`, `obs/<sample_key>`, `uns/expected_cells`
- **Writes**: `uns/cell_count/estimated_cells`, `uns/cell_count/threshold_umi`, `uns/cell_count/fdr_level`, `uns/cell_count/ci_low`, `uns/cell_count/ci_high`, `uns/cell_count/sensitivity_table`, `obs/is_cell_cutoff`
<!-- CHAINING:AUTO:END -->

This step follows the count-matrix checks and feeds expected doublet rates and sample QC. No named workflow recipe is assigned in this document.

## 10. Risks, pitfalls and open questions

- **Unverified inputs.** B1 species, barcode count and label derivation; the B2 link to SRR5398237 and the demuxlet output convention; dataset licences for B1 to B3. The Cell Ranger and DropletUtils revisions are remote heads at check time and may differ from those that produced any dataset. The ORDMAG_NONAMBIENT combination with the ambient test was not traced, the OSCA release year differs between sources, and no timings were measured.
- **Unsettled literature.** The usual FDR level; the tolerance of expected-cell rules to rough inputs; ambient heterogeneity across samples and nuclei; differences between Cell Ranger major versions; whether knee rules are conservative on real data.
- **Risks.** The emptyDrops count is conditional on `lower`, `fdr` and `retain`, so a single number misleads without the sensitivity table. Monte Carlo cost scales with `niters` times the tested barcodes. Reimplementations must follow documented behaviour (section 12).
- **First experiment.** Apply the diagnostic gate and then B3 to one matrix, checking that realised FDR tracks the nominal level; proceed to B1 and B2 only if it does.

## 11. References

R1. Lun ATL, Riesenfeld S, Andrews T, Dao TP, Gomes T, Marioni JC. EmptyDrops: distinguishing cells from empty droplets in droplet-based single-cell RNA sequencing data. *Genome Biology* 2019. doi:10.1186/s13059-019-1662-y — verified (corpus)

R2. Amezquita RA, Lun ATL, et al. Orchestrating Single-Cell Analysis with Bioconductor: droplet processing chapter (OSCA.advanced). Bioconductor online book. — verified (corpus)

R3. Fleming SJ, et al. Unsupervised removal of systematic background noise from droplet-based single-cell experiments using CellBender. *Nature Methods* 2023. doi:10.1038/s41592-023-01943-7 — verified (corpus)

R4. — . EmptyNN: A neural network based on positive and unlabeled learning to remove cell-free droplets and recover lost cells in scRNA-seq data. *Patterns* 2021. doi:10.1016/j.patter.2021.100311 — verified (corpus)

R5. Stoeckius M, Zheng S, Houck-Loomis B, Hao S, Yeung BZ, Mauck WM, Smibert P, Satija R. Cell Hashing with barcoded antibodies enables multiplexing and doublet detection for single cell genomics. *Genome Biology* 2018. doi:10.1186/s13059-018-1603-1 — partial (repo)

R6. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018. — verified (corpus)

R7. DropletUtils: Utilities for Handling Single-Cell Droplet Data, R package version 1.33.2 (MarioniLab/DropletUtils). — partial (repo)

R8. Cell Ranger source code: cell_calling, cell_calling_helpers and filter_barcodes modules (10XGenomics/cellranger). — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/MarioniLab/DropletUtils | Aaron Lun (aut); Jonathan Griffiths (ctb, cre); others as listed in DESCRIPTION | GPL-3 (DESCRIPTION); no LICENSE file at the repository root | barcodeRanks, emptyDrops and emptyDropsCellRanger source | reimplement barcodeRanks and emptyDrops from the paper and documented behaviour; emptyDropsCellRanger callout |
| https://github.com/10XGenomics/cellranger | 10x Genomics | 10x Genomics licence (LICENSE): internal use, tied to 10x products or data | expected-cell rule and non-ambient test source | reimplement the expected-cell rule from documented behaviour, copying no code; non-ambient test callout |
| https://github.com/broadinstitute/CellBender | Stephen Fleming; Mehrtash Babadi (pyproject.toml) | BSD-3-Clause (LICENSE) | model-based comparator | callout |
| https://github.com/lkmklsmn/empty_nn | Fangfang Yan; Lukas M. Simon (DESCRIPTION) | none: no LICENSE file; the DESCRIPTION licence field is a placeholder | hashing and genotype data; EmptyNN comparator | callout |
