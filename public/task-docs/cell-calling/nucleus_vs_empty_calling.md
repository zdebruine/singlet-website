---
id: cell-calling.nucleus_vs_empty_calling
title: Nucleus versus empty-droplet calling (single-nucleus RNA-seq)
area: cell-calling
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.intron_inclusive_gene_counting, ingest-quant.spliced_unspliced_counting, harmonization.count_matrix_state_detection]
feeds: [cell-calling.cell_count_cutoff_selection, cell-calling.residual_empty_droplet_removal, qc.single_nucleus_quality_filtering, ambient.profile_estimation]
reads: [raw/counts, raw/intronic, raw/exonic, obs/<sample_key>]
writes: [obs/nucleus_call_<method>, obs/nucleus_prob_<method>, obs/nucleus_fdr_<method>, obs/nucleus_qc_flag_<method>, obs/nucleus_ambient_score_<method>, uns/nucleus_ambient_profile_<method>, uns/nucleus_call_params_<method>, models/nucleus_call_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_cell_calling_nucleus_vs_empty_calling
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Nucleus versus empty-droplet calling in single-nucleus RNA-seq

> For each barcode of one unfiltered single-nucleus channel, decide whether its counts come from an intact nucleus or from ambient RNA, and state the error rate or probability that the decision carries.

## 1. Question

Given the unfiltered barcode-by-gene UMI matrix of one single-nucleus channel, which barcodes contain an intact nucleus, and which contain empty droplets, debris or ambient RNA? Inputs are the raw counts, ideally with intronic and exonic counts kept apart. Outputs are a per-barcode call, a score (a q-value or a posterior probability) where the method provides one, and the retained nucleus set. A correct answer agrees with a nucleus identity established independently of the caller, at a stated error rate. The final cut belongs to `cell-calling.cell_count_cutoff_selection`; cell data are covered by `cell-calling.cell_vs_empty_droplet_calling`.

## 2. Why this task matters and where the field stands

Single-nucleus RNA-seq is the usual choice for frozen or hard-to-dissociate tissue. Nuclear libraries carry many intronic reads [R13], and the ambient pool comes from the same nuclear preparation, so its composition is nucleus-like, which B3 tests. Depth alone does not separate nuclei from empties, and composition-based tests keep stripped and damaged nuclei.

Status: **contested**. Cell-tuned tools are documented as insufficient. EmptyDrops' documentation states that droplets with cell fragments, stripped nuclei and damaged cells remain significantly non-empty [R1]. The best-practices book notes that knee cut-offs can fail to work robustly where no clear knee is present [R14].

Nucleus-aware methods exist, but none has a benchmark against an independent nucleus label. DIEM was written for single-nucleus data and thresholds a debris score [R4]. QClus clusters droplets on mitochondrial, unspliced-fraction and cell-type metrics and was designed for human heart snRNA-seq [R8]. DropletQC flags empty droplets from nuclear fraction and was designed for single-cell data [R3]. CellBender states that it applies to snRNA-seq [R2].

Open problems:

- Whether intact nuclei stay separable from intron-rich ambient RNA [R1, R13].
- Whether EmptyDrops p-values are calibrated on nuclei; its test.ambient diagnostic addresses this, but no nucleus results are published [R1].
- Whether probabilities from CellBender, dropkick and EmptyNN are calibrated on nuclei [R2, R5, R6].
- Whether nuclear-fraction and mitochondrial cut-offs tuned on cells transfer [R3, R7].

No benchmark in the bibliography or repositories listed in section 12 scores nucleus calls against an independent nucleus label.

## 3. Theory and insight

Barcode $j$ has counts $y_{gj}$ over genes $g$, total $n_j=\sum_g y_{gj}$, intronic and exonic totals $I_j$ and $E_j$, and mitochondrial gene set $\mathcal{M}$.

| Symbol | Meaning |
|---|---|
| $\boldsymbol\pi$ | ambient gene distribution, $\sum_g \pi_g=1$ |
| $\ell_j$ | log multinomial probability of barcode $j$ under $\boldsymbol\pi$ |
| $N_{\text{iter}}$ | Monte Carlo draws per tested barcode |
| $\alpha$ | target false-call rate among tested barcodes |
| $\mathcal{A}$ | ambient gene set used in B3 |

**Nuclear fraction.**
$$\mathrm{NF}_j=\frac{I_j}{I_j+E_j},\qquad I_j+E_j>0.$$
Its meaning depends on whether intronic reads were tagged during alignment [R13].

**Ambient null.** Under $H_0$ the barcode holds ambient RNA only,
$$\mathbf{y}_j\mid n_j,\boldsymbol\pi\sim\mathrm{Mult}(n_j,\boldsymbol\pi),$$
with $\boldsymbol\pi$ estimated from barcodes at or below a count floor. The regime is $n_j$ above the floor, with the multinomial treated as exact: overdispersion and the uncertainty of the estimated $\boldsymbol\pi$ are ignored [R1].

**Monte Carlo p-value.** With $\ell_j=\log\Pr(\mathbf{y}_j\mid n_j,\boldsymbol\pi)$ and $\ell^{(s)}$ the same quantity for the $s$-th simulated draw of total $n_j$,
$$p_j=\frac{1+\#\{s\le N_{\text{iter}}:\ \ell^{(s)}\le \ell_j\}}{1+N_{\text{iter}}}.$$
The smallest attainable value is $1/(N_{\text{iter}}+1)$; barcodes at that floor are flagged as limited [R1].

**False-call control.**
$$q_j=\mathrm{BH}(p_j)\ \text{over tested barcodes},\qquad \text{call non-empty if } q_j\le\alpha.$$
Only barcodes above the floor are tested.

**Estimand of the ambient test.** A call states that the counts of barcode $j$ are improbable under the ambient multinomial, with false-call rate controlled at $\alpha$ among tested barcodes. It is not the probability that $j$ holds a nucleus. Stripped nuclei and damaged cells satisfy the same condition [R1].

**Mixture.**
$$p(\mathbf{y}_j)=\sum_{k=1}^{K}\pi_k\,\mathrm{Mult}(\mathbf{y}_j\mid n_j,\boldsymbol\theta_k),$$
fitted by EM on filtered genes, with one debris component among the $K$ [R4]. A droplet passes when its debris score is below a threshold and it has enough detected genes. The debris score is a model quantity, not a calibrated probability of nucleus identity.

**Posterior call.**
$$\hat c_j=\mathbb{1}\{\Pr(c_j=1\mid\mathbf{y}_j)>0.5\}.$$
The estimand is the posterior probability of cell presence under the model's generative assumptions, with one shared ambient profile [R2]. It is calibrated only if that model is well specified for nuclear profiles; no cited source tests this. The denoising false-positive rate changes counts, not the call [R2].

**Mitochondrial share.**
$$m_j=\frac{\sum_{g\in\mathcal M}y_{gj}}{n_j}.$$
Stripped nuclei carry no mitochondrial transcripts, so $m_j>0$ indicates cytoplasmic or ambient RNA [R15]. This is a qualitative diagnostic that fails when cytoplasm is incompletely removed.

**Ambient-set share (B3).**
$$a_j=\frac{\sum_{g\in\mathcal A}y_{gj}}{n_j},$$
the fraction of barcode $j$'s UMIs that fall in the ambient set $\mathcal A$, defined in B3.

**Ground-truth estimands.** In B1, $z_j=1$ for a confident singlet and $z_j=0$ for an unassigned barcode with $n_j\le100$. Recall is the fraction of $z_j=1$ barcodes called, and the false-call rate is the fraction of $z_j=0$ barcodes called. Expected calibration error is the sum over ten equal-width bins of the reported probability of $(|B_b|/n)\,|\mathrm{acc}_b-\mathrm{conf}_b|$.

**Assumptions and failure modes.** Null-model tests assume one ambient profile shared by all barcodes. The pool used to estimate it can contain partial nuclei, which makes the null resemble nuclei and reduces power [R1]. Calls can keep stripped and damaged nuclei [R1]. Learned classifiers (DIEM, dropkick, EmptyNN, CellBender) depend on their training data. Positive-unlabelled and mixture methods take positives from high counts or fitted components, so low-count nuclei can fall in the negative pool [R6]. Their calibration depends on the model being right for nuclei [R2, R5]. Rule-based methods assume structure. The knee fails when the rank curve has no clear knee [R14]. DropletQC's trough rule assumes a bimodal nuclear-fraction distribution, which may fail when most barcodes are intron-rich [R3]. Mitochondrial thresholds from cell-tuned tools may mis-flag nuclei [R7].

**Insight.** Nuclei and empties differ in composition more than in depth. Intact nuclei are intron-rich and carry little mitochondrial RNA [R13, R15], and the ambient pool is nucleus-like (inference). Composition-aware models can separate the classes only if the ambient profile is estimated from a pool that contains few nuclei. A model-based formulation adds calibrated probabilities, one ambient profile shared across barcodes, and a place for nuclear covariates. The cost is that the null or the training positives must be right.

**Regime of validity.** The multinomial p-values and the BH control hold for independent barcodes with a fixed ambient profile under the stated null. The Monte Carlo floor limits power when $N_{\text{iter}}$ is small [R1]. None of these conditions is known to hold exactly for nuclei, and the cited sources do not measure how far they fail.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| EmptyDrops | model-based | Multinomial ambient null, Monte Carlo p-values, BH control over barcodes above a floor | [R1] |
| EmptyDrops_CR (STARsolo flavour) | hybrid | Expected-cell rule, then the EmptyDrops test with an ambient pool from a UMI-rank window | [R1], [R11] |
| CellBender remove-background | model-based | Deep generative model of droplet counts; posterior probability of cell presence | [R2] |
| DropletQC nuclear fraction | heuristic | Nuclear-fraction density trough with UMI-based rescue; damaged-cell mixture model | [R3] |
| DIEM | model-based | EM mixture with a debris component; debris-score threshold | [R4] |
| dropkick | model-based | Elastic-net logistic regression on highly variable genes, trained on heuristic labels | [R5] |
| EmptyNN | model-based | Positive-unlabelled neural network; very-low-count barcodes as the cell-free set | [R6] |
| valiDrops | heuristic | Per-barcode mean-and-SD thresholds on mitochondrial share, feature distance and coding fraction | [R7] |
| QClus | hybrid | Clustering on mitochondrial, unspliced-fraction and cell-type metrics, then named sequential filters | [R8] |
| Knee on UMI rank | heuristic | Iterated maximum-distance cut from the chord of the cumulative sorted count curve, repeated until the index stops moving | [R9], [R10] |
| Fixed UMI floor | heuristic | Keep barcodes with at least a fixed UMI total | EmptyNN notebook, Reproducibility/Cell_calling.Rmd:58 |

The cited tools that process nuclear data expose the knee rule (alevin-fry, [R9]) and the Cell Ranger-style EmptyDrops variant (STARsolo, [R11]). Two methods were written for single-nucleus data or tested on it: DIEM and QClus [R4, R8]. singlet ports or reimplements the first group and keeps the rest as comparators (section 5). The paradigm column gives the dominant published approach for each method, not singlet's choice.

Exact defaults at the pinned commits:

| Method | Parameter | Value | Source |
|---|---|---|---|
| EmptyDrops | lower | 100 | DropletUtils R/emptyDrops.R:188 @ ba4152d |
| EmptyDrops | niters | 10000 | R/emptyDrops.R:188 @ ba4152d |
| EmptyDrops | test.ambient | FALSE | R/emptyDrops.R:188 @ ba4152d |
| EmptyDrops | FDR in documented example | 0.01 | R/emptyDropsCellRanger.R:78 @ ba4152d |
| EmptyDrops_CR | n.expected.cells | 3000 | R/emptyDropsCellRanger.R:103 @ ba4152d |
| EmptyDrops_CR | ambient rank window, 1-based ranks inclusive | 45000 to 90000 | R/emptyDropsCellRanger.R:111-112, :158 @ ba4152d |
| EmptyDrops_CR | niters | 10000 | R/emptyDropsCellRanger.R:116 @ ba4152d |
| STARsolo | soloCellFilter EmptyDrops_CR, ten hard-coded values | 3000 0.99 10 45000 90000 500 0.01 20000 0.01 10000 | docs/STARsolo.md:454 @ b1edc12 |
| CellBender | fpr | 0.01, denoised counts only | docs/source/usage/index.rst:197 @ f36ae29 |
| CellBender | barcode cut | posterior > 0.5 | docs/source/usage/index.rst:89-91 @ f36ae29 |
| CellBender | expected cells | automatic since v0.3.0 | docs/source/usage/index.rst:171-187 @ f36ae29 |
| CellBender | low-count threshold, function default | 15 | cellbender/remove_background/data/priors.py:179 @ f36ae29 |
| DropletQC | nf_rescue | 0.05 | R/identify_empty_drops.R:45 @ 5d7dadc |
| DropletQC | umi_rescue | 1000 | R/identify_empty_drops.R:46 @ 5d7dadc |
| DropletQC | damaged-cell model | Mclust, G = 1:2, EEI | R/identify_damaged_cells.R:332 @ 5d7dadc |
| DIEM | model | multinomial (mltn) | R/em.R:40 @ a9a4d9d |
| DIEM | max_iter, eps, psc | 1e3, 1e-4, 1e-10 | R/em.R:43-45 @ a9a4d9d |
| DIEM | k_init, use | 20, kmeans | R/init_clust.R:293-294 @ a9a4d9d |
| DIEM | debris test set min_counts | 100 | R/filter.R:39 @ a9a4d9d |
| DIEM | thresh_score, min_genes | 0.5, 200 | R/debris_id.R:85-88 @ a9a4d9d |
| dropkick | highly variable genes | 2000 | dropkick/__main__.py:195 @ bd2647a |
| dropkick | l1/l2 ratio | 0.1 | dropkick/__main__.py:203 @ bd2647a |
| valiDrops | mito.max, dist.threshold, coding.threshold | 0.3, 5, 3 (docstring at :14 says 5) | R/quality_filter.R:26 and :14 @ f67d751 |
| alevin-fry knee | knee call | get_knee(&frequencies, 100, log) | src/cellfilter.rs:759 @ ad05742 |
| alevin-fry knee | knee-distance flag | off by default; both settings select KneeFinding | src/main.rs:181, :437-448 @ ad05742 |
| EmptyNN | threshold, k, iteration (function defaults) | 100, 5, 5 | R/emptynn.R:2 @ e1e6226 |
| EmptyNN notebook | UMI floor | keep n_counts >= 200 | Reproducibility/Cell_calling.Rmd:58 @ e1e6226 |

## 5. Proposed singlet approach

**Routes** (section 12). Port: knee, dropletqc_nf, dropkick_logistic and cellbender, whose model is a PyTorch network. Reimplement: emptydrops_intronic, emptydrops_cr and diem. Callout only: EmptyNN, valiDrops, QClus, and the STARsolo flavour, which is a configuration reference. The umi_floor rule is written from scratch.

**Default.** emptydrops_intronic is model-based, needs no training, runs on CPU, and uses intron-inclusive counts when present. Its test keeps stripped and damaged nuclei [R1], so every call carries quality flags, and the default must pass B1 before any nucleus-specific claim is made.

**Proposed model (not in the enum until benchmarked).** A nucleus mixture fitted by EM on unlabelled catalogue barcodes. It has an ambient multinomial component whose profile is estimated from the pool at or below the count floor, and a nucleus component over genes with intronic fraction and mitochondrial share as covariates. Its outputs are a posterior nucleus probability and an expected false-call rate. No per-barcode labels are used. It is falsified if it misses the B1 criteria on any run, or if its expected calibration error on held-out barcodes exceeds 0.05 (proposed).

**Stack.** PyTorch for the mixture and the CellBender-style model. Hard-coded CUDA or cuSPARSE kernels for the small hot paths: sparse log-likelihoods $\sum_g y_{gj}\log\pi_g$, Monte Carlo draws shared across barcodes with equal totals as DropletUtils groups them [R1], and the logistic score of dropkick_logistic. The CPU path streams barcodes in chunks. The ambient profile is one vector over genes, so memory is dominated by the matrix.

**Quality flags.** obs/nucleus_qc_flag assigns, in order: low_umi (total at or below emptydrops.lower), high_mito (mitochondrial share above qc_flags.mito_max), damaged_suspect (damaged-cell model of dropletqc_nf), and ok. Flags never change the call.

**Defaults.** An agent calls emptydrops_intronic with the MCP defaults, once per channel. Any change to a default is recorded in uns/nucleus_call_params.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | raw/counts | sparse int | UMI counts of all barcodes of one channel, empty ones included |
| read | raw/intronic | sparse int | intronic UMIs per barcode and gene (optional); enables intron-inclusive calling |
| read | raw/exonic | sparse int | exonic UMIs (optional); with raw/intronic gives $\mathrm{NF}_j$ |
| read | obs/<sample_key> | categorical | channel label; calls run once per level |
| write | obs/nucleus_call_<method> | bool | call at the method's cut: q at most fdr, posterior above 0.5, or rank above the knee |
| write | obs/nucleus_prob_<method> | float32 | posterior probability of cell or nucleus membership, one per barcode; written by cellbender and the proposed mixture only |
| write | obs/nucleus_fdr_<method> | float32 | BH q-value of the ambient test among tested barcodes; NaN at or below the floor |
| write | obs/nucleus_qc_flag_<method> | categorical | low_umi, high_mito, damaged_suspect or ok, in rule order |
| write | obs/nucleus_ambient_score_<method> | float32 | ambient-set share $a_j$, normalised by total UMI |
| write | uns/nucleus_ambient_profile_<method> | float64 vector | estimated $\boldsymbol\pi$; sums to one |
| write | uns/nucleus_call_params_<method> | dict | method, cut, versions, seed, and any fallback |
| write | models/nucleus_call_<method> | object | fitted weights for model-based methods |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "emptydrops_intronic" | `emptydrops_intronic`, `emptydrops_cr`, `knee`, `dropletqc_nf`, `diem`, `cellbender`, `dropkick_logistic`, `umi_floor` | Calling method. emptydrops_intronic is the default; cellbender and diem are model-based alternatives; umi_floor is a baseline. |
| `sample_key` | string | "sample" | — | Obs column naming the channel; the tool runs once per level because ambient composition differs. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Seed for Monte Carlo draws, cross-validation and initialisation; unused by knee and umi_floor. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members of the same method suffix instead of failing. |
| `emptydrops` | object | — | — | Options for emptydrops_intronic; emptydrops_cr also reads niters and fdr. |
| `emptydrops.lower` | integer | 100 | min 1 | Total at or below which barcodes define the ambient profile and are not tested. |
| `emptydrops.niters` | integer | 10000 | min 1000 | Monte Carlo draws per tested barcode; the smallest p-value is 1/(niters+1). |
| `emptydrops.fdr` | number | 0.01 | > 0; < 1 | Benjamini-Hochberg false-call rate among tested barcodes. |
| `emptydrops.test_ambient` | boolean | false | — | Also test barcodes at or below lower for a p-value histogram diagnostic; their FDR stays NaN. |
| `cellbender` | object | — | — | Options for cellbender. |
| `cellbender.fpr` | number | 0.01 | > 0; < 1 | False-positive rate for denoised counts; does not change the nucleus call. |
| `cellbender.posterior_threshold` | number | 0.5 | > 0; < 1 | Posterior probability of cell presence above which a barcode is called. |
| `cellbender.expected_cells` | integer/null | null | min 1 | Expected nucleus count; null lets CellBender choose. |
| `dropletqc` | object | — | — | Options for dropletqc_nf. |
| `dropletqc.nf_rescue` | number | 0.05 | min 0; max 1 | Minimum nuclear fraction for UMI-based rescue of barcodes flagged empty. |
| `dropletqc.umi_rescue` | integer | 1000 | min 1 | Minimum UMI total for rescue, used together with nf_rescue. |
| `rank_rules` | object | — | — | Options for knee, emptydrops_cr and umi_floor. |
| `rank_rules.expected_cells` | integer/null | null | min 1 | Expected nucleus count for emptydrops_cr; null uses 3000. |
| `rank_rules.umi_floor` | integer | 200 | min 1 | Fixed minimum UMI total for the umi_floor baseline. |
| `rank_rules.knee_distance` | boolean | false | — | Select the knee-distance variant of the knee rule. In alevin-fry the flag selects the same knee-finding branch (section 4). |
| `qc_flags` | object | — | — | Quality flags written for every method; they never change the call. |
| `qc_flags.mito_max` | number | 0.3 | > 0; < 1 | Mitochondrial share above which a barcode is flagged high_mito; cell-tuned default. |
<!-- PARAMS:AUTO:END -->

Each option group applies only to its method: `emptydrops` to emptydrops_intronic and emptydrops_cr, `cellbender` to cellbender, `dropletqc` to dropletqc_nf, and `rank_rules` to knee, emptydrops_cr and umi_floor. diem and dropkick_logistic use the fixed published settings in section 4 and expose no option. `qc_flags` applies to every method and never changes the call. Options for unselected methods are ignored and listed as unused in uns/nucleus_call_params. Without raw/intronic, emptydrops_intronic runs on total counts and records the fallback, and dropletqc_nf stops with an error.

## 7. MCP tool

Tool `singlet_cell_calling_nucleus_vs_empty_calling` (definition in `tasks/mcp/singlet_cell_calling_nucleus_vs_empty_calling.json`). Example call:

```json
{"dataset": "run1.singlet", "method": "emptydrops_intronic", "sample_key": "sample", "emptydrops": {"fdr": 0.01}, "seed": 0}
```

Example result, abbreviated:

```json
{
  "dataset": "run1.singlet",
  "status": "completed",
  "wrote": ["obs/nucleus_call_emptydrops_intronic", "obs/nucleus_fdr_emptydrops_intronic", "obs/nucleus_qc_flag_emptydrops_intronic"],
  "summary": {"method": "emptydrops_intronic", "sample_key": "sample", "per_sample": {"<sample>": {"n_barcodes": "...", "n_tested": "...", "n_called": "...", "n_limited": "..."}}},
  "provenance_id": "..."
}
```

Long-running: cellbender on full matrices needs CUDA and is queued; emptydrops_intronic time grows with niters and tested barcodes. Stochastic: Monte Carlo draws, cross-validation and initialisation depend on the seed, so the same seed and device reproduce the calls. Dry run: returns seconds, peak memory and device from barcode count, tested-barcode count and niters, without computing calls.

## 8. Benchmarks

**Shared protocol.** Fitting methods (cellbender, diem and the proposed mixture) fit on a random half of barcodes and are scored on the other half; threshold methods use all barcodes. Every method runs at its MCP defaults unless a benchmark names a variant. Stochastic methods use seeds 0, 1 and 2, and the reported value is the median across seeds. Scores are computed per run and never pooled across runs. Methods never read labels or simulated truth. Each benchmark records the commit of every comparator (section 12), the device and the thread count. Pairwise Jaccard overlap of nucleus sets and the stability of each set under read downsampling to 50 and 25 percent accompany B1 as consistency diagnostics. They are not accuracy benchmarks.

### B1. Hashed or genotype-labelled nucleus run (proposed)

- **Goal**: measure per-barcode nucleus recall and false-call rate against a label set that does not depend on any caller.
- **Ground truth**: orthogonal measurement. $z_j=1$ for a barcode with a confident single-donor or single-hash assignment after doublets and ambiguous calls are removed; $z_j=0$ for an unassigned barcode with $n_j\le100$. Recall is computed over $z_j=1$ barcodes, and the false-call rate over $z_j=0$ barcodes.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Nucleus multiplexed run (to build; recipe below) | none in the bibliography | snRNA-seq, two or more donors or hash groups | — | primary benchmark |
| Cell-hashing mixture (Stoeckius et al.) | [R6] data README; DOI 10.1186/s13059-018-1603-1; GSE108313 | cells, not nuclei | — | cell-level pilot only |
| Multiplexed PBMC (Kang et al.) | [R6] data README; SRR5398237; [R12] | cells, PBMC | — | cell-level pilot |

- **Generator recipe**
  1. Pool nuclei from at least two donors or hash groups into one library set, and keep intron-inclusive and exonic counts.
  2. Demultiplex with a documented hashing or genotype caller; confident singlets get $z_j=1$.
  3. Remove doublets and ambiguous assignments from the labelled set.
  4. Set $z_j=0$ for unassigned barcodes with $n_j\le100$; leave other unassigned barcodes unscored.
  5. Split each run in half for fitting methods, as in the shared protocol.
- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Nucleus recall (>= 500 UMI) | called $z{=}1$ barcodes with $n_j\ge500$, divided by all $z{=}1$ barcodes with $n_j\ge500$ | higher | primary | — |
| Nucleus recall by UMI decile | as above, per decile of $n_j$ over $z{=}1$ barcodes | higher | primary | — |
| False-call rate | called $z{=}0$ barcodes, divided by all $z{=}0$ barcodes | lower | primary | — |
| Expected calibration error | ten equal-width bins of the reported probability; $\sum_b (\lvert B_b\rvert/n)\,\lvert \mathrm{acc}_b-\mathrm{conf}_b\rvert$ | lower | guardrail | — |

- **Comparators**: emptydrops_intronic, emptydrops_cr, knee, dropletqc_nf, diem, cellbender, dropkick_logistic and umi_floor at 200, each at MCP defaults.
- **Protocol**: at least two runs from different donors or hash groups, following the shared protocol.
- **Acceptance criterion** (proposed, not from the literature): on every run, recall of at least 0.90 on barcodes with at least 500 UMI and a false-call rate of at most 0.05. Among methods that pass, recall must be within 2 percentage points of the best comparator.
- **Known pitfalls**: label truncation means low-UMI nuclei lose their assignments, so $z_j=1$ is biased toward high counts, and precision is not reported because the negative set is low-count by construction. Hashing or genotype labels from cell datasets may not transfer to nuclei with different ambient composition.

### B2. Planted-population simulation (QClus generator)

- **Goal**: check that planted nuclei are recovered and that planted empties, debris, high-mito barcodes and doublets are rejected.
- **Ground truth**: planted simulation. Each barcode's population is fixed at generation. Estimands are the per-population fractions called non-empty for nuclei and not called for the other populations.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| QClus synthetic generator | [R8] tests/synthetic.py @ 441fbf6 | simulated counts, 2000 genes; planted CM 150, VEC 150, FB 150, debris 60, empty 40, high-mito 30, doublet 30 | — | default sizes; seeds 0 to 4 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Planted nucleus recall | called barcodes among planted CM, VEC and FB, divided by all planted CM, VEC and FB | higher | primary | — |
| Planted empty and debris rejection | non-called planted empty and debris barcodes, divided by all planted empty and debris | higher | primary | — |
| Planted high-mito and doublet rejection | non-called planted high-mito and doublet barcodes, divided by all of them | higher | guardrail | — |

- **Comparators**: QClus full pipeline, emptydrops_intronic and dropletqc_nf.
- **Protocol**: the generator at seeds 0 to 4, each method at defaults. Fractions are averaged over seeds, with the range reported.
- **Acceptance criterion**: the repository's unit-test threshold, not a literature value, is a planted nucleus pass fraction above 0.85 (tests/test_pipeline.py:24 @ 441fbf6). singlet applies the same 0.85 to planted nucleus recall as a smoke test (proposed).
- **Known pitfalls**: empties drawn from one ambient model make an EmptyDrops-type null correct by construction. Planted populations use cardiac gene sets, and nuclear-fraction distributions are simulated, not measured.

### B3. Ambient-signature and spliced-ratio diagnostic on mouse nuclei (indirect)

- **Goal**: check whether the retained barcodes of each caller carry less ambient-set RNA, and report how their spliced ratio differs.
- **Ground truth**: consistency; no per-barcode label exists. Estimand: the median over retained barcodes of $a_j=\sum_{g\in\mathcal A}y_{gj}/n_j$, where $\mathcal A$ holds the 100 most frequently detected genes among barcodes with $10<n_j<100$, sampled to 2000 barcodes [R6 Figure4.Rmd:29-33]. Spliced ratio is spliced over spliced plus unspliced UMIs per retained barcode, reported as a distribution.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Mouse brain nuclei (10x nuclei_2k) | [R6] data README; 10x dataset 2.1.0 nuclei_2k | mouse brain, snRNA-seq, size — | — | raw counts as in the EmptyNN analysis |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Ambient share of retained barcodes | median of $a_j$ over retained barcodes, with $\mathcal A$ fixed once per channel | lower (inferred from the aim) | primary | — |
| Spliced ratio of retained barcodes | distribution of spliced over spliced plus unspliced, per retained barcode | no direction; reported only | guardrail | — |

- **Comparators**: emptydrops_intronic, the Cell Ranger v3 calls (cellrangerv3 column of the retained object), and the EmptyNN retained set from its notebook.
- **Protocol**: reproduce Figure4.Rmd on the same channel for each caller. Define $\mathcal A$ once per channel, not per caller, and report the retained count beside each median.
- **Acceptance criterion** (proposed, not from the literature): the median ambient share of the candidate's retained barcodes is at least 10 percent lower (relative) than the comparator's on the same channel, with no more than a 5 percent drop in retained barcodes.
- **Known pitfalls**: $\mathcal A$ is derived from the same data, so callers that keep different low-count barcodes change the set they are scored on; fixing $\mathcal A$ once per channel limits this but does not remove it. Retained-set size confounds the median, and the spliced ratio has no direction of "better".

### P1. Performance and scaling

Wall time, peak memory and throughput at 10,000, 100,000 and 1,000,000 barcodes, on CPU, and on CUDA for the methods with a GPU path (cellbender and the proposed mixture), against every comparator in B1. Hold fixed: the intron-inclusive matrix, thread count, niters at the MCP default, CellBender epochs and learning rate at documented defaults, the expected-cell count, and the hardware description. Report the scaling exponent and peak resident memory. The sizes are proposed; the cited sources give no nucleus-calling timings. EmptyDrops cost is inferred to grow with niters times tested barcodes times genes, not measured. The CellBender tutorial states that the full heart10k matrix needs a CUDA GPU, while a trimmed copy of 500 high-UMI and 50,000 low-UMI barcodes runs on CPU (CellBender repository, docs/source/tutorial/index.rst).

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.intron_inclusive_gene_counting`: Intron-inclusive (gene versus gene-full) counting and pre-mRNA references for nuclei
  - `ingest-quant.spliced_unspliced_counting`: Spliced, unspliced and ambiguous molecule counting
  - `harmonization.count_matrix_state_detection`: Count-matrix processing-state detection
- **Feeds**:
  - `cell-calling.cell_count_cutoff_selection`: Cell/empty cutoff and expected cell-count selection
  - `cell-calling.residual_empty_droplet_removal`: Residual empty-droplet detection among called cells
  - `qc.single_nucleus_quality_filtering`: Nucleus-aware quality filtering for single-nucleus RNA-seq
  - `ambient.profile_estimation`: Ambient profile estimation
- **Reads**: `raw/counts`, `raw/intronic`, `raw/exonic`, `obs/<sample_key>`
- **Writes**: `obs/nucleus_call_<method>`, `obs/nucleus_prob_<method>`, `obs/nucleus_fdr_<method>`, `obs/nucleus_qc_flag_<method>`, `obs/nucleus_ambient_score_<method>`, `uns/nucleus_ambient_profile_<method>`, `uns/nucleus_call_params_<method>`, `models/nucleus_call_<method>`
<!-- CHAINING:AUTO:END -->

Nucleus calling follows intron-inclusive counting and precedes nucleus quality filtering. No named workflow (recipe) exists yet.

## 10. Risks, pitfalls and open questions

- **Floors.** The DropletUtils default floor is 100 (R/emptyDrops.R:188), and the EmptyNN notebook keeps barcodes with at least 200 UMI (Reproducibility/Cell_calling.Rmd:58). No higher floor is used here.
- **Source-level gaps.** The Monte Carlo counter (src/montecarlo_pval.cpp) is used only for its grouping; the p-value formula is taken from emptyDrops.R:253, and the direction of the count was not traced line by line in C++. The CellBender command-line default for the low-count threshold is not stated in the cited sources; the function default is 15 (priors.py:179). QClus default filter parameters were not extracted, so only its README and test facts are used.
- **Paper-level gaps and labels.** The benchmark results of the DIEM, valiDrops, EmptyNN, dropkick and QClus papers are not summarised here. The EmptyNN Figure 4 outcome is not reported in the cited sources, so the direction of its ambient comparison is unknown. Whether the 354M-cell catalogue records nucleus preparation per barcode is unknown, so this document uses no supervised nucleus label. The absence of a nucleus-level benchmark is claimed only for the bibliography index and repositories in section 12.
- **Repositories.** Three code repositories have incomplete statements. Their routes in section 12 must be confirmed before any port or reimplementation is merged.
- **Unsettled science.** Whether EmptyDrops p-values are calibrated on nuclei; whether DropletQC's bimodality holds for intron-rich nuclei; whether CellBender and posterior probabilities are calibrated on nuclei; whether a nuclear mitochondrial cut exists, since the 0.3 default is cell-tuned and used only as a flag; and how damaged nuclei should be labelled, since EmptyDrops retains them.
- **First experiment.** Build the B1 generator recipe on two donors, call with emptydrops_intronic, emptydrops_cr and knee at MCP defaults, and measure recall at 500 UMI and the false-call rate. The result decides whether the proposed mixture is worth building.

## 11. References

R1. Lun ATL, Riesenfeld S, Andrews T, Dao TP, Gomes T, Marioni JC. EmptyDrops: distinguishing cells from empty droplets in droplet-based single-cell RNA sequencing data. *Genome Biology* 2019;20:63. doi:10.1186/s13059-019-1662-y — verified (corpus)
R2. Fleming SJ, Chaffin MD, Arduini A, et al. Unsupervised removal of systematic background noise from droplet-based single-cell experiments using CellBender. *Nature Methods* 2023. doi:10.1038/s41592-023-01943-7 — verified (corpus)
R3. Muskovic W, Powell JE. DropletQC: improved identification of empty droplets and damaged cells in single-cell RNA-seq data. *Genome Biology* 2021. doi:10.1186/s13059-021-02547-0 — verified (corpus)
R4. Alvarez M, Rahmani E, Jew B, et al. Enhancing droplet-based single-nucleus RNA-seq resolution using the semi-supervised machine learning classifier DIEM. *Scientific Reports* 2020. doi:10.1038/s41598-020-67513-5 — verified (corpus)
R5. Heiser CN, Wang VM, Chen B, Hughey JJ, Lau KS. Automated quality control and cell identification of droplet-based single-cell data using dropkick. *Genome Research* 2021. doi:10.1101/gr.271908.120 — verified (corpus)
R6. Yan F, Simon LM, et al. EmptyNN: a neural network based on positive and unlabeled learning to remove cell-free droplets and recover lost cells in scRNA-seq data. *Patterns* 2021. doi:10.1016/j.patter.2021.100311 — verified (corpus)
R7. Kavaliauskaite G, Madsen JGS, et al. Automatic quality control of single-cell and single-nucleus RNA-seq using valiDrops. *NAR Genomics and Bioinformatics* 2023. doi:10.1093/nargab/lqad101 — partial (corpus)
R8. Schmauch E, Ojanen J, et al. QClus: a droplet filtering algorithm for enhanced snRNA-seq data quality in challenging samples. *Nucleic Acids Research* 2024. doi:10.1093/nar/gkae1145 — verified (corpus)
R9. He D, Zakeri M, Sarkar H, Soneson C, Srivastava A, Patro R. Alevin-fry unlocks rapid, accurate and memory-frugal quantification of single-cell RNA-seq data. *Nature Methods* 2022. doi:10.1038/s41592-022-01408-3 — verified (corpus)
R10. Smith T, Heger A, Sudbery I. UMI-tools: modeling sequencing errors in Unique Molecular Identifiers to improve quantification accuracy. *Genome Research* 2017;27:491-499. doi:10.1101/gr.209601.116 — verified (corpus)
R11. Kaminow B, Yunusov D, Dobin A. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021. doi:10.1101/2021.05.05.442755 — verified (corpus)
R12. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018. — verified (corpus)
R13. 10x Genomics. Technical note: interpreting intronic and antisense reads in 10x Genomics single cell gene expression data. 2021. https://www.10xgenomics.com/support/single-cell-gene-expression/documentation/steps/sequencing/interpreting-intronic-and-antisense-reads-in-10-x-genomics-single-cell-gene-expression-data — partial (corpus)
R14. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R15. Amezquita RA, Lun ATL, Hicks SC, Gottardo R, Geistlinger L, et al. Orchestrating single-cell analysis with Bioconductor, advanced chapter on single-nuclei RNA-seq processing (online book, OSCA.advanced). — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/MarioniLab/DropletUtils @ ba4152d | Aaron Lun (aut); Jonathan Griffiths (ctb, cre); Davis McCarthy (ctb); Dongze He (ctb); Rob Patro (ctb) | GPL-3 in DESCRIPTION; no LICENSE file in the repository | EmptyDrops and EmptyDrops_CR reference | reimplement |
| https://github.com/broadinstitute/CellBender @ f36ae29 | Stephen Fleming, Mehrtash Babadi (pyproject.toml) | BSD 3-Clause (LICENSE file and pyproject.toml agree) | posterior cell-presence model; tutorial | port |
| https://github.com/powellgenomicslab/DropletQC @ 5d7dadc | Walter Muskovic (maintainer) | MIT (LICENSE file and DESCRIPTION) | nuclear-fraction rule and damaged-cell model | port |
| https://github.com/marcalva/diem @ a9a4d9d | Marcus Alvarez, Elior Rahmani | GPL-3 in DESCRIPTION; no LICENSE file in the repository | mixture with debris component | reimplement |
| https://github.com/KenLauLab/dropkick @ bd2647a | Cody N. Heiser | MIT (LICENSE file, copyright 2020) | logistic comparator; dropkick_logistic | port |
| https://github.com/lkmklsmn/empty_nn @ e1e6226 | Fangfang Yan, Lukas M. Simon (DESCRIPTION) | placeholder text in DESCRIPTION; no LICENSE file | comparator; notebook baseline | callout |
| https://github.com/madsen-lab/valiDrops @ f67d751 | Jesper Grud Skat Madsen (cre, aut); Gabija Kavaliauskaite (aut) | GPL-3 (DESCRIPTION and LICENSE file) | per-barcode QC comparator | callout |
| https://github.com/scHEARTGROUP/qclus @ 441fbf6 | Eloi Schmauch, Johannes Ojanen (pyproject.toml) | MIT (LICENSE file and pyproject.toml) | comparator; planted generator for B2 | callout |
| https://github.com/COMBINE-lab/alevin-fry @ ad05742 | copyright holder University of Maryland; individual maintainers not captured | BSD 3-Clause (LICENSE file) | knee rule | port |
| https://github.com/alexdobin/STAR @ b1edc12 | Alexander Dobin (README) | MIT (LICENSE file) | source of the EmptyDrops_CR configuration | callout |
| https://github.com/OSCA-source/OSCA.advanced @ 2f10501 | Robert Amezquita, Aaron Lun, Stephanie Hicks, Raphael Gottardo, Ludwig Geistlinger, Peter Hickey (DESCRIPTION) | CC BY 4.0 (DESCRIPTION) | text reference for stripped-nucleus QC | callout (text only) |
| https://github.com/theislab/single-cell-best-practices | Lukas Heumos and co-authors (book) | Apache-2.0 (LICENSE file) | text reference for knee and nucleus caveats | callout (text only) |
