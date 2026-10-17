---
id: doublets.cross_species_multiplet_detection
title: Cross-species multiplet detection
area: doublets
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [ingest-quant.read_to_gene_mapping, cell-calling.cell_vs_empty_droplet_calling]
feeds: [doublets.expected_rate_estimation, doublets.expression_doublet_scoring]
reads: [layers/counts, var/species, obs/cellranger_gem_classification]
writes: [obs/species_genome0_umi, obs/species_genome1_umi, obs/species_label, obs/cross_species_multiplet, obs/cross_species_posterior, uns/cross_species_thresholds, uns/cross_species_rate]
devices: [cpu, cuda]
mcp_tool: singlet_doublets_cross_species_multiplet_detection
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Cross-species multiplet detection

> Assigns each barcode a species from its genome-specific UMI counts, flags barcodes that hold cells of both species, and converts the cross-species count into a total multiplet rate.

## 1. Question

Given the UMIs of each barcode split between two reference genomes, which barcodes hold cells of both species, and what total multiplet rate do those calls imply? The output is a species label per barcode, a cross-species flag, the threshold or posterior behind it, and a rate with an interval. A correct answer flags only minority-species counts that ambient RNA cannot explain, and gives a total that holds when cells pair at random with respect to species.

## 2. Why this task matters and where the field stands

Barnyard controls and xenografts (human tumour cells in a mouse host) are mixed-species designs in which some multiplets have a known composition. A cross-species barcode is the one multiplet class with direct evidence, and its count scales to a total rate without assuming that the two parent transcriptomes are similar [R1]. Same-species doublets stay invisible to this logic and need a score-based detector, benchmarked in [R2]. Sample tags such as cell hashing and MULTI-seq flag inter-sample multiplets [R4, R5]; they give an orthogonal check, not a cross-species call.

Status: **contested**. Counting cross-species barcodes is routine; the per-barcode cut is not. The published standard sets its cut at the 10th percentile of dominant-species counts, so by construction a tenth of those barcodes fall below it [R7]. The fixed quantile is least reliable under skewed species ratios and high ambient RNA. Open problems are ambient RNA at low UMI, skew, and bias in the total when random pairing fails through differences in cell size or RNA content [R1].

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $c^{(s)}_b$ | UMIs of barcode $b$ assigned to genome $s\in\{0,1\}$ |
| $t_b$, $f_b$ | total UMIs $c^{(0)}_b+c^{(1)}_b$, and minority fraction $c^{(1)}_b/t_b$ |
| $\pi_s$ | fraction of singlet cells from species $s$ |
| $p_x$ | share of multiplets whose two parents come from different species |
| $N_x$, $N_{\text{mult}}$, $N_{\text{called}}$ | cross-species multiplets, all multiplets, called barcodes |
| $s$, $w$ | detectable fraction of cross-species multiplets; cross-species share of called barcodes |

**Estimands.** The flag is set per called barcode when it holds cells of both species. $N_x$ counts flagged barcodes in the population; $N_{\text{mult}}$ counts all multiplets, same-species pairs included. Rates are per called barcode: $\hat\rho=\hat N_{\text{mult}}/N_{\text{called}}$. $f_b$ is a UMI fraction, not a cell fraction.

**Random pairing (E1).** For two cells drawn independently from the loaded pool, the probability that they come from different species is
$$p_x = 2\pi_0\pi_1 = 1-\pi_0^2-\pi_1^2.$$
Regime: first order, two-cell droplets, pairing random with respect to species; sampling without replacement is ignored. Cell-mixing designs estimate this frequency [R1].

**Total estimate (E2).** With $\hat\pi_s$ taken from the singlet calls,
$$\hat N_{\text{mult}}=\frac{n_{\text{obs}}}{2\hat\pi_0\hat\pi_1}.$$
Regime: detection sensitivity 1, large $n$, and few cross-species calls relative to singlets. The Cell Ranger code computes this quantity with a binomial estimator and caps it at $n_{\text{obs}}+n_0+n_1$ [R7]. 

**Sensitivity (E3).** If only a fraction $s$ of cross-species multiplets is detectable, $\mathbb{E}[n_{\text{obs}}]=sN_x$, so $\hat N^{(s)}_{\text{mult}}=n_{\text{obs}}/(s\,p_x)$ and E2 is low by the factor $s$. Missed low-UMI doublets cause $s<1$; the Cell Ranger code does not model it. Setting $s$ to measured recall uses the truth, so it is an oracle bound, not an estimator.

**Fixed cut (E4).** The standard sets $\tau_s$ to the 10th percentile of counts among barcodes dominated by species $s$, and calls a barcode when both counts reach their thresholds. If both thresholds are below 50 UMI and their fold change exceeds 25, both are replaced by one 10th percentile of total counts [R7]. Regime: the dominant-species tail sits near the cut. The quantile ignores ambient level and species ratio, and the fallback switches rules between samples.

**Mixture (E5, proposed).** Model the minority fraction as
$$p(f_b)=(1-w)\,\mathrm{Beta}(f_b;\alpha_0,\beta_0)+w\,p_D(f_b).$$
The first component holds singlets whose minority share is ambient; the second holds cross-species barcodes with interior fractions. $w$ is the cross-species share of called barcodes, so $\hat N_{\text{mult}}=\hat w N_{\text{called}}/p_x$, and $P(D\mid b)$ gives a per-barcode posterior. Regime: $t_b\gg1$, so that $f_b$ is informative. Because the fit covers the whole fraction distribution, it can count barcodes that a threshold misses; this holds only if $p_D$ separates from the ambient tail, which B1 tests.

**Failure modes.** Ambient RNA from one species raises minority counts in low-UMI singlets. Skew leaves the majority species near the fixed cut. Same-species doublets are invisible, and E2 is biased when species differ in cell size or RNA content, because random pairing then fails. Conserved genes that cross-map inflate minority counts.

**Insight.** Cross-species barcodes give a total-rate estimate that does not depend on how similar the parents' transcriptomes are. The limit is calibration of the call against ambient RNA and skew, not the counting. E5 moves that calibration into a fitted model whose estimates are only as good as its identifiability assumption.

## 4. Methods landscape

The published standard is the Cell Ranger multigenome classifier, kept as the comparator [R7]. DoubletDecon was read as a candidate; its species argument only controls gene-identifier conversion for cell-cycle removal, and no cross-species logic appears in the code read [R3]. Sample-tag multiplexing identifies inter-sample multiplets by design [R4, R5] and is outside this task. The table lists read methods only; the model in section 5 is singlet's own design.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Cell Ranger multigenome | heuristic | Per-species 10th-percentile thresholds on counts; total from E2 with a bootstrap rate interval | [R7] |
| DoubletDecon | heuristic | Deconvolution of each barcode against profiles built from the data | [R3] |

| Method | Parameter | Value | Source (Cell Ranger file:line) |
|---|---|---|---|
| Cell Ranger multigenome | `DEFAULT_MULTIPLET_THRESHOLD`: UMI threshold when one species is absent | 10 | `lib/python/cellranger/analysis/constants.py:48` |
| Cell Ranger multigenome | `MULTIPLET_PROB_THRESHOLD`: percentile as a fraction | 0.10 | `lib/python/cellranger/analysis/constants.py:49` |
| Cell Ranger multigenome | `NUM_MULTIPLET_BOOTSTRAP_SAMPLES` | 1000 | `lib/python/cellranger/analysis/multigenome.py:28` |
| Cell Ranger multigenome | Pooled-threshold fallback: lower threshold below 50 UMI and fold change above 25 | 50; 25 | `lib/python/cellranger/analysis/multigenome.py:162-165` |
| Cell Ranger multigenome | Rate interval: 2.5 and 97.5 percentiles of bootstrap counts | 2.5; 97.5 | `lib/python/cellranger/analysis/multigenome.py:295-300` |

## 5. Proposed singlet approach

**Routes.** `two_component_em` is singlet's model (E5) and has no source to port; it is reimplemented from section 3. `cellranger_multigenome` is a callout comparator. Its formulas E2 and E4 may be reimplemented only after the review in section 12; its code is not copied.

**Default.** `two_component_em` with `sensitivity_s` 1.0. The mixture fits the whole fraction distribution, so the total needs no separate sensitivity term; a supplied $s$ divides the total as in E3. Its calls carry per-barcode posteriors. Intervals for both methods come from resampling barcodes, and each resample starts from the full-data solution.

**Acceptance and falsification.** The mixture becomes the default only if B1 and B3 meet their acceptance criteria in section 8; otherwise the default is `cellranger_multigenome`. It is falsified on B1 at $r=0.05$ if its calibration error is not lower than that of `cellranger_multigenome`, because then the fitted tail adds nothing over the fixed cut.

**Stack and devices.** Per-barcode fractions and the EM sums are reductions over per-species count vectors in CSR form, hard-coded for CPU and for CUDA with cuSPARSE row sums; the core needs no PyTorch. PyTorch is reserved for a learned classifier trained on planted labels. EM accumulates sufficient statistics chunk by chunk, taking one sweep over the chunks per iteration.

**Defaults without asking.** Use the MCP defaults in section 6. An input without a species label for each feature fails rather than guessing a species.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | UMI counts per barcode and feature for both genomes |
| read | var/species | categorical | genome label of each feature; exactly two labels |
| read | obs/cellranger_gem_classification | table | optional import with genome0, genome1 and call columns |
| write | obs/species_genome0_umi | int | UMIs assigned to genome 0 per barcode |
| write | obs/species_genome1_umi | int | UMIs assigned to genome 1 per barcode |
| write | obs/species_label | categorical | species 0 singlet, species 1 singlet, or cross-species |
| write | obs/cross_species_multiplet | bool | cross-species flag |
| write | obs/cross_species_posterior | float32 | per-barcode posterior; `two_component_em` only |
| write | uns/cross_species_thresholds | dict | method, cut or posterior threshold, fallback used |
| write | uns/cross_species_rate | dict | total multiplet count, rate per called barcode, interval |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `species_key` | string | "var/species" | — | Feature column giving the genome of each feature; must hold exactly two labels. |
| `method` | string | "two_component_em" | `two_component_em`, `cellranger_multigenome` | Caller. cellranger_multigenome applies fixed per-species percentile thresholds and is the published comparator. |
| `sensitivity_s` | number | 1.0 | max 1; > 0 | Detectable fraction of cross-species multiplets; 1 gives the uncorrected total. Supplied by the user. |
| `bootstraps` | integer | 1000 | min 100 | Barcode resamples for the rate interval, used by both methods. |
| `cellranger` | object | — | — | Options for cellranger_multigenome. |
| `cellranger.multiplet_percentile` | number | 0.1 | max 0.5; > 0 | Quantile of dominant-species counts that sets each per-species threshold. |
| `cellranger.default_threshold_umi` | integer | 10 | min 1 | Threshold used when no barcode is dominated by one species. |
| `cellranger.pure_fallback_min_umi` | integer | 50 | min 1 | Lower threshold below this value, with fold change above pure_fallback_fold, triggers pooled thresholds. |
| `cellranger.pure_fallback_fold` | number | 25 | min 1 | Fold-change trigger for the pooled-threshold fallback. |
| `em` | object | — | — | Options for two_component_em. |
| `em.max_iter` | integer | 200 | min 1 | Iteration cap for the EM fit. |
| `em.tol` | number | 1e-06 | > 0 | Log-likelihood change that stops the EM fit. |
| `seed` | integer | 0 | — | Seed for barcode resampling in the rate interval; the EM fit itself is deterministic. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`cellranger.*` applies only to `cellranger_multigenome`, and `em.*` only to `two_component_em`. `sensitivity_s` divides the total for both methods. Barcodes must already be cell-called; features without a label are excluded, not assigned a species. Existing outputs are replaced only when `overwrite` is true.

## 7. MCP tool

Tool name `singlet_doublets_cross_species_multiplet_detection` (definition in `tasks/mcp/singlet_doublets_cross_species_multiplet_detection.json`). Example call and compact result:

```json
{"dataset": "mixture.singlet", "method": "two_component_em", "sensitivity_s": 1.0}
```

```json
{"dataset": "mixture.singlet", "status": "completed",
 "wrote": ["obs/species_label", "obs/cross_species_multiplet", "obs/cross_species_posterior", "uns/cross_species_thresholds", "uns/cross_species_rate"],
 "summary": {"n_called": "<int>", "n_cross_species": "<int>", "rate_per_called": "<float>", "rate_ci": ["<float>", "<float>"]}}
```

Long-running: no; a job is queued only when the dry-run estimate exceeds the host limit. Stochastic: yes, through the barcode-resampling interval, fixed by `seed`. Dry run: returns seconds, peak memory and device for the chosen method and `bootstraps`.

## 8. Benchmarks

Shared protocol: pure-species barcodes come from the 1:1 cell-line mixture in [R8]. A barcode is pure when at least 0.9 of its UMIs map to one genome; this rule does not use the flag under test. Planted doublets are sums of two pure barcodes drawn with replacement from the pooled pure set, so same-species pairs appear at the rate E1 implies. A planted doublet is cross-species when its parents differ. Thresholds are fixed before planted labels are seen, and labels are never used for tuning. Each setting uses 5 seeds; report mean and spread.

### B1. Planted cross-species doublets from pure pools (proposed)

- **Goal**: Measure flag precision, recall and F1, minority-fraction AUPRC, and total-rate calibration on planted truth.
- **Ground truth**: Planted simulation. The planted total is the planted doublet count $N_{\text{doublet}}$; the planted rate is $r=N_{\text{doublet}}/(N_{\text{singlet}}+N_{\text{doublet}})$ per barcode.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 1:1 HEK-293T / NIH-3T3 mixture, pure barcodes | [R8] | scRNA-seq; human and mouse cell lines; size — | — | Pure rule in section 8 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Precision, recall, F1 of the flag | TP/(TP+FP), TP/(TP+FN), harmonic mean; mean over seeds | maximize | primary | — |
| AUPRC of $f_b$ | Step-interpolated precision-recall area over $f_b$ | maximize | primary | — |
| Total-rate calibration error | $\lvert\hat N_{\text{mult}}/N_{\text{doublet}}-1\rvert$ at $s=1$, and with E3 at $s$ set to measured recall (oracle bound) | minimize | primary | [R1] |

- **Comparators**: `cellranger_multigenome`, `two_component_em`.
- **Protocol**: Planted rates $r\in\{0.01,0.05,0.10\}$ (proposed grid); each caller at its defaults.
- **Acceptance criterion**: Proposed design target, not a literature value: at $r=0.05$, recall at least 0.80, precision at least 0.90, and calibration error at most 0.20 after the E3 correction.
- **Known pitfalls**:
  1. Summing two pure profiles omits droplet saturation and capture, and carries only the source's own ambient.
  2. Choosing pure labels with a caller's own thresholds would be circular.

### B2. Real 1:1 mixture consistency (proposed)

- **Goal**: Check the scaled total on real 1:1 data against random pairing and Poisson loading.
- **Ground truth**: Consistency, not truth. Under Poisson loading with mean $\lambda$ cells per droplet, the occupied droplets with two or more cells have fraction $\rho(\lambda)=\dfrac{1-(1+\lambda)e^{-\lambda}}{1-e^{-\lambda}}$. The expected total is $N_{\text{exp}}=\rho(\lambda)N_{\text{called}}$, with $\lambda$ implied by the loaded cell count, normalised per called barcode. Regime: Poisson loading, independent cells.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 1:1 HEK-293T / NIH-3T3 mixture, filtered matrix | [R8] | scRNA-seq; human and mouse cell lines; size — | — | Ratio from dataset name |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Relative error of the scaled total | $\lvert\hat N_{\text{mult}}-N_{\text{exp}}\rvert/N_{\text{exp}}$, method's total | minimize | primary | [R1] |
| Call stability | Fraction of flags that change when the cut moves to percentile 0.08 or 0.12 (`cellranger_multigenome`) or posterior 0.4 or 0.6 (`two_component_em`) | minimize | guardrail | — |

- **Comparators**: `cellranger_multigenome`, `two_component_em`.
- **Protocol**: Apply both callers to the filtered matrix; report totals with intervals beside $N_{\text{exp}}$.
- **Acceptance criterion**: Proposed design target, not a literature value: scaled total within 20% of $N_{\text{exp}}$.
- **Known pitfalls**:
  1. The $\hat\pi_s$ split comes from the same calls: this checks consistency, not accuracy.
  2. Random pairing fails when cell lines differ in RNA content or size; ambient RNA inflates minority counts.

### B3. Skewed-ratio planted mixtures (proposed)

- **Goal**: Compare recall and precision of cross-species flags when the minority species is a small share of cells.
- **Ground truth**: Planted simulation as in B1 at ratios 50:50, 80:20 and 95:5 (minority share of singlets), planted rate 0.05 per bin.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pure barcodes of the 1:1 mixture, subsampled to each ratio | [R8] | scRNA-seq; human and mouse cell lines; size — | — | Subsampling only |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recall per ratio | TP/(TP+FN) over planted cross-species barcodes, per ratio | maximize | primary | — |
| Precision per ratio | TP/(TP+FP), per ratio | maximize | primary | — |
| FPR at 95:5 | FP/(FP+TN) over singlets in the 95:5 bin | minimize | guardrail | — |

- **Comparators**: `cellranger_multigenome`, `two_component_em`.
- **Protocol**: Planting and seeds as in B1 at each ratio. Report per-bin metrics, counts beside rates, and the difference from 50:50 without assuming its sign.
- **Acceptance criterion**: Proposed design target, not a literature value: at 95:5, recall at least 0.60 and FPR at most 0.02.
- **Known pitfalls**:
  1. At 95:5 the cross-species share of planted pairs is $2\pi_0\pi_1=0.095$, so few planted cross-species barcodes exist per bin.
  2. Majority-species doublets carrying ambient RNA can resemble majority singlets.

### P1. Performance and scaling

Wall time and peak memory at $10^4$, $10^5$ and $10^6$ barcodes (grid values, not dataset sizes), for `two_component_em` on CPU and CUDA and for `cellranger_multigenome` on CPU with the default bootstrap count. Hold fixed: two species, CSR per-species count vectors, one CPU and one GPU, repeated timings per setting, and the bootstrap count. Report barcodes per second beside total time. The comparator's bootstrap costs $O(Bn)$ and is expected to dominate its time. Comparator use is subject to section 12.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
- **Feeds**:
  - `doublets.expected_rate_estimation`: Expected doublet rate estimation
  - `doublets.expression_doublet_scoring`: Expression-based per-cell doublet scoring
- **Reads**: `layers/counts`, `var/species`, `obs/cellranger_gem_classification`
- **Writes**: `obs/species_genome0_umi`, `obs/species_genome1_umi`, `obs/species_label`, `obs/cross_species_multiplet`, `obs/cross_species_posterior`, `uns/cross_species_thresholds`, `uns/cross_species_rate`
<!-- CHAINING:AUTO:END -->

Belongs to the doublet-QC step of barnyard and xenograft analyses, after cell calling and before rate-based call thresholding.

## 10. Risks, pitfalls and open questions

- **Evidence.** The multipletR package was located only in a package listing; its source, paper, licence and authors were not obtained, so it is excluded from tables, the enum and the benchmarks. Cell Ranger line numbers refer to a corpus clone without commit metadata; GitHub HEAD 669395e was checked for existence and licence only. The Cell Ranger patent was not obtained, so the claim that only between-species doublets are flagged rests on the genome0 and genome1 classes in the code. Bloom 2018 was matched on DOI, venue and year only, and its equations were not checked against E1 and E2. The Stoeckius and McGinnis titles, venues and authors come from memory. The dataset's cell count, loading and chemistry are not recorded here, and B2 needs its loaded cell count. How reads that match both genomes are handled was not read. A 2025 multiplet-removal study (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12574873/) was not read and may not benchmark species mixtures.
- **Unsettled literature.** The 10th-percentile quantile is a code convention with no cited justification. No published benchmark of cross-species callers was located. The effect of cross-mapping of conserved genes on minority counts is unquantified, and so is the size bias of E2 when species differ in RNA content. Biological fusion or engulfment, such as phagocytosed mouse cells inside a human tumour, may produce cross-species barcodes; this is an open question, not an established phenomenon. The standard counts only called barcodes.
- **Technical and licence risks.** Reimplementation of E2 and E4 proceeds only after the review in section 12. The interval from the standard reflects count resampling only, not threshold or model error. False flags from ambient RNA on single-species controls cannot yet be measured, because no single-species control datasets were identified; this is the key missing test. The fallback can switch the rule between samples. E5 is identifiable only if $p_D$ separates from the ambient tail, and its Beta approximation is weak at small totals.
- **First experiment.** Apply B1 at $r=0.05$ to both callers on the pure pools. It decides the default, and it is the only test in this document of the E1 and E2 assumptions against known truth.

## 11. References

R1. Bloom JD. Estimating the frequency of multiplets in single-cell RNA sequencing from cell-mixing experiments. *PeerJ* 2018;6:e5578. doi:10.7717/peerj.5578 — partial (search)
R2. Xi NM, Li JJ. Benchmarking computational doublet-detection methods for single-cell RNA sequencing data. *Cell Systems* 2021. doi:10.1016/j.cels.2020.11.008 — verified (corpus)
R3. DePasquale EAK, et al. DoubletDecon: deconvoluting doublets from single-cell RNA-sequencing data. *Cell Reports* 2019. doi:10.1016/j.celrep.2019.09.082 — verified (corpus)
R4. Stoeckius M, et al. Cell Hashing with barcoded antibodies enables multiplexing and doublet detection for single cell genomics. *Genome Biology* 2018. doi:10.1186/s13059-018-1603-1 — partial (repo)
R5. McGinnis CS, et al. MULTI-seq: sample multiplexing for single-cell RNA sequencing using lipid-tagged indices. *Nature Methods* 2019. doi:10.1038/s41592-019-0433-8 — partial (repo)
R6. Zhu Q, Conrad DN, Gartner ZJ. deMULTIplex2: robust sample demultiplexing for scRNA-seq. *bioRxiv* 2023. doi:10.1101/2023.04.11.536275 — verified (corpus)
R7. 10x Genomics. Cell Ranger source: lib/python/cellranger/analysis/multigenome.py and constants.py. GitHub 10XGenomics/cellranger. — partial (repo)
R8. 10x Genomics. Dataset page: 1:1 mixture of fresh-frozen human HEK-293T and mouse NIH-3T3 cells, https://www.10xgenomics.com/resources/datasets/12-k-1-1-mixture-of-fresh-frozen-human-hek-293-t-and-mouse-nih-3-t-3-cells-2-standard-2-1-0 — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/10XGenomics/cellranger | 10x Genomics | 10x Genomics custom licence in LICENSE (copyright 2026): internal use, tied to 10x products, no redistribution | Published comparator; source of E2 and E4 [R7] | callout; reimplement E2 and E4 only after legal review |
| https://github.com/EDePasquale/DoubletDecon | Erica DePasquale (DESCRIPTION) | MIT per DESCRIPTION; no LICENSE file at the root | Read as a candidate; no cross-species logic [R3] | none (not used) |
| https://github.com/Gartner-Lab/deMULTIplex2 | Qin Zhu (maintainer), Daniel N. Conrad, Zev J. Gartner (DESCRIPTION) | CC BY 4.0 (LICENSE.md); a content licence, not a software licence | Inter-sample tag calls, an orthogonal check [R6] | none (not used) |
