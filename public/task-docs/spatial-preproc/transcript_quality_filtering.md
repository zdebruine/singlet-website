---
id: spatial-preproc.transcript_quality_filtering
title: Transcript quality filtering and false-positive estimation for imaging panels
area: spatial-preproc
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [spatial-preproc.multiplexed_fish_decoding, spatial-preproc.image_cell_segmentation]
feeds: [spatial-preproc.transcript_cell_assignment, spatial-preproc.spatial_unit_qc_filtering]
reads: [points/<name>, labels/<name>, var/feature_type, uns/codebook]
writes: [points/transcript_keep, points/transcript_noise_prob, var/false_call_rate, obs/retained_fraction, uns/transcript_qc]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_preproc_transcript_quality_filtering
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Transcript quality filtering and false-positive estimation for imaging panels

> Decides which decoded transcripts in an imaging panel are noise or misdecoded and estimates the residual false-call share, using quality values, control features and blank codewords as proxies for the truth.

## 1. Question

Given decoded transcripts with positions $x_i$, identities $g_i$ and quality values $q_i$, plus a codebook of $M$ codewords of which $B$ are blank, which calls are misdecoded or non-specific, and what share of all calls and of each gene's calls is false? A correct answer keeps valid calls, removes misdecoded ones, and reports a false-call share with its estimand stated. No transcript-level truth exists on real data, so correctness is indirect (section 8).

## 2. Why this task matters and where the field stands

Imaging platforms report every decoded transcript with coordinates, so one misdecoded or non-specific call becomes an observation that cell assignment, cell typing and per-gene statistics all consume [R5]. Quality-value cutoffs are already defaults in published pipelines, and Xenium Explorer import can fail when calls below 20 remain [R2]. Platform comparisons report false discovery rates and differences between platforms [R4]. The status is **contested**. Open problems:

- **No transcript-level truth.** Control features and blank codewords are proxies for misdecoding, and no transcript-level validation of them is cited here.
- **Each rule sees different evidence.** Quality values reflect decoder confidence, control counts reflect background, and Baysor's noise mixture reflects only spatial isolation [R1].
- **Segmentation-dependent filters.** Baysor and Proseg filter or reassign transcripts before any false-call estimate, so the estimate depends on segmentation choices [R1][R2].
- **Error structure is unknown.** Error-robust codebooks reserve unused codewords [R3], but whether misdecoding is uniform over the codebook has not been measured.

## 3. Theory and insight

Each decoded call is a valid gene call, a misdecoded call on a valid or blank codeword, or a call on a control feature. Notation: $N_{\mathrm{tot}}$ is the number of all decoded calls, $G$ the number of valid gene features, $M$ the number of codewords, $B$ the number of blank codewords, $N_U$ the calls on blank codewords, $\bar n_B=N_U/B$ the mean count per blank codeword, $\bar n_{NC}$ the mean count per negative-control feature, and $n_g$ the count of gene $g$.

**Quality rule (heuristic).**

$$k_i=\mathbf 1[q_i\ge q_{\min}],\qquad q_{\min}=20.$$

It applies to any call with a quality column and is not calibrated against truth. If the column is Phred-scaled, the implied probability that the identity is wrong is $p_i=10^{-q_i/10}$, so $q=20$ means $p=0.01$. The mapping is conditional on the vendor's convention (section 10).

**Control estimators (heuristic).** If a share $\varepsilon$ of all calls is misdecoded uniformly over $M$ codewords, each blank codeword receives on average $\varepsilon N_{\mathrm{tot}}/M$ calls. This gives the blank-channel estimate

$$\hat\varepsilon_{\mathrm{all}}=\frac{M}{N_{\mathrm{tot}}}\,\bar n_B=\frac{N_U}{N_{\mathrm{tot}}}\cdot\frac{M}{B},$$

the share of all calls misdecoded onto any codeword. Restricted to valid gene codewords, which receive the fraction $G/M$ of uniform misdecodes, the blank channel gives $G\bar n_B/N_{\mathrm{tot}}$. The negative-control channel instead assumes that each gene probe's non-specific count equals the mean negative-control count:

$$\hat\varepsilon_{NC}=\frac{G\,\bar n_{NC}}{N_{\mathrm{tot}}},\qquad f_g=\frac{\bar n_{NC}}{n_g}.$$

The two channels therefore share one form, mean control count times $G/N_{\mathrm{tot}}$, and their ratio is $\rho=\bar n_B/\bar n_{NC}$. Agreement tests compare mean control counts per feature. The regime is first order ($\varepsilon\ll 1$), Poisson counts large enough that the means are stable, and uniform misdecoding for the blank channel. The negative-control channel estimates non-specific hybridisation of gene probes, not codeword misdecoding.

**Baysor confidence (model-based).** Let $d_i$ be a k-nearest-neighbour distance statistic, with $k$ set by `confidence_nn_id`. Baysor fits two Gaussian components, signal with mean $\mu_s$ and noise with mean $\mu_n$, to $\{d_i\}$ by an expectation-maximisation loop. Its E-step multiplies the signal weight by $\exp(\sum_j w_{ij}p_j)$ and the noise weight by $\exp(\sum_j w_{ij}(1-p_j))$, where $w_{ij}$ are neighbour weights and $p_j$ the signal probabilities of neighbours, updated in place in index order (`expect_noise_probabilities`, noise_estimation.cpp). The reported confidence is the signal posterior of the converged mixture without that coupling:

$$\mathrm{conf}_i=\frac{n_s\,\phi(d_i;\mu_s,\sigma_s)}{n_s\,\phi(d_i;\mu_s,\sigma_s)+n_n\,\phi(d_i;\mu_n,\sigma_n)},$$

where $n_s$ and $n_n$ are expected component counts and $\phi$ is the normal density. Molecules above the outlier cut are set to noise, and molecules inside prior segments are floored at $\pi^2$, where $\pi$ is the prior confidence (section 4). The fit uses no random numbers. The regime is two separable components in the distance distribution.

**Proposed background posterior.** For cell $c$ with volume $v_c$, the per-codeword background rate is $\hat\beta_c=N_{U,c}/(Bv_c)$, where $N_{U,c}$ counts blank calls in $c$. If gene $g$ has signal rate $\mu_{cg}$ in $c$ and background calls carry any identity equally, the probability that a call of $g$ in $c$ is background is

$$\pi_{ci}=\frac{\hat\beta_c}{\hat\beta_c+\mu_{cg_i}}.$$

It is valid when background is homogeneous within the cell and $\mu_{cg}$ is well above $\hat\beta_c$. It is not implemented and is not a method in section 4.

**Estimands and normalisation.**

- Keep flag $k_i$: a thresholded decision that call $i$ is a valid gene call; no normalisation.
- $\hat\varepsilon_{\mathrm{all}}$: share of all decoded calls, including blank and control calls, misdecoded onto any codeword.
- $\hat\varepsilon_{NC}$ and $G\bar n_B/N_{\mathrm{tot}}$: share of all decoded calls that are false calls on valid gene features.
- $f_g$: share of gene $g$'s own calls that are non-specific.
- $\mathrm{conf}_i$ and $\pi_{ci}$: per-call scores in $[0,1]$, not misdecoding probabilities until calibrated on planted data (section 8).
- `obs/retained_fraction`: retained transcripts divided by all transcripts assigned to the cell before filtering.

**Insight.** The three kinds of evidence are not interchangeable. A quality rule cannot see a confidently wrong call. Baysor's confidence cannot see gene identity, so a misdecode inside a dense neighbourhood looks like signal. Control counts estimate rates across the panel and say little about one call. A posterior that combines quality, control evidence and neighbourhood isolation, fitted to controls, is the proposal of section 5, and section 8 decides whether it adds value over the rules.

**Failure modes by family.** Quality rules depend on the quality scale and remove real low-abundance signal, so per-gene sensitivity falls for lowly expressed genes. Control estimators assume uniform misdecoding over codewords (blank channel) or equal non-specific signal across gene probes (negative-control channel). If blank codewords sit far from valid codewords in Hamming distance, the blank channel would underestimate misdecoding onto valid genes; this is reasoning, not a measurement. Baysor's distances are blind to identity and treat crowded noise as signal. Proseg's keep rule reduces to the quality threshold plus name exclusion, and its leaky model is a segmentation model, not a keep rule. The background posterior needs homogeneous backgrounds within cells and is noisy in small cells, where $\hat\beta_c$ rests on few blank calls.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Quality-value threshold | heuristic | Drop calls with quality value below 20; the default in Proseg's Xenium preset, the Sopa Proseg wrapper and the Giotto Xenium object | [R2] |
| Control-class exclusion with negative-control rate | heuristic | Classify features by type, drop control calls, and estimate the non-specific share from negative-control counts | Sopa, Giotto (section 12) |
| Baysor noise mixture | model-based | Two Gaussian components on neighbour distances, neighbour-coupled fitting, molecule confidence | [R1] |
| Proseg leaky voxel model | model-based | Compactness-regularised voxel labels, negative-binomial expression mixture, transcript diffusion prior | [R2] |

The quality threshold and the control-class rule are the published standard for keep decisions and remain comparators in every benchmark. Baysor's mixture is the only probabilistic noise model among the methods cited here. Proseg is a segmentation model whose keep rule is the quality threshold plus name exclusion, so it enters only as a comparator. The blank-channel estimator is derived in section 3 rather than taken from a published method.

Defaults used by this document (repository-relative paths; repositories in section 12):

| Method | Parameter | Value | Source |
|---|---|---|---|
| Quality-value threshold | min_qv | 20.0 | Proseg `src/main.rs:504` |
| Quality-value threshold | qv column | `qv` | Proseg `src/main.rs:503` |
| Quality-value threshold | min-qv when a qv column exists | 20.0 | Sopa `sopa/segmentation/methods/_proseg.py:251-252` |
| Quality-value threshold | qv slot of the Xenium object | 20 | Giotto `R/convenience_xenium.R:45` |
| Control classes | gene exclusion pattern | `nan\|<NA>\|.*control.*\|blank.*\|antisense.*\|unassigned.*\|deprecated.*\|intergenic.*\|false.*\|neg.*` | Sopa `sopa/_settings.py:26` |
| Control classes | name rules and class columns | `negcontrol\|negprobe`; `blank`; `systemcontrol\|falsecode`; nine Xenium class columns | Sopa `sopa/io/explorer/points.py:190-212` |
| Control classes | Xenium feature types | `rna`, `NegControlProbe`, `UnassignedCodeword`, `NegControlCodeword`, `GenomicControl` | Giotto `R/convenience_xenium.R:265-300` |
| Control classes | CosMx negative-probe key | `NegPrb` | Giotto `R/convenience_cosmx.R:330-331` |
| Baysor mixture | min_molecules_per_gene (Xenium preset) | 10 | Baysor `configs/xenium.toml:7` |
| Baysor mixture | exclude_genes (Xenium preset) | `NegControl*,BLANK_*,antisense_*` | Baysor `configs/xenium.toml:8` |
| Baysor mixture | min_molecules_per_cell (Xenium preset) | 50 | Baysor `configs/xenium.toml:9` |
| Baysor mixture | prior_segmentation_confidence | 0.2 (code default); 0.5 (Xenium preset) | Baysor `include/baysor/utils/options.h:61`; `configs/xenium.toml:15` |
| Baysor mixture | min_qv | -1, disabled | Baysor `docs/configuration.md:72` |
| Baysor mixture | confidence_nn_id | 0, which selects max(n_genes/10, 10) | Baysor `src/cli/main.cpp:598`; `noise_estimation.cpp:276` |
| Baysor mixture | initial components | 10th and 90th percentiles of $d$; spread $(q_{90}-q_{10})/4$ | Baysor `noise_estimation.cpp:124-127` |
| Baysor mixture | outlier cut | $q_{90}+3(q_{90}-q_{10})/4$ | Baysor `noise_estimation.cpp:137` |
| Baysor mixture | floor inside prior segments | $\pi^2$ | Baysor `noise_estimation.cpp:98-99, 239-243, 294-296` |
| Proseg | excluded genes unless negative controls are kept | `^(Deprecated\|NegControl\|Unassigned\|Intergenic)` | Proseg `src/main.rs:505-508` |
| Proseg | ncomponents | 10 | Proseg `src/main.rs:235` |
| Proseg | diffusion probability | 0.2 | Proseg `src/main.rs:315` |
| Proseg | diffusion sigma near, far (µm) | 1.0, 4.0 (Visium HD preset 2.0, 8.0) | Proseg `src/main.rs:40-41`, preset `src/main.rs:593-594` |

## 5. Proposed singlet approach

**Routes.** The quality rule and the control-class rules are reimplemented; the control-class name rules are ported from Sopa (routes in section 12). The Baysor noise model is ported. Proseg is a callout. The blank and negative-control estimators and the background posterior are new.

**Default.** The default method is `control_feature_fdr`. It drops control-class calls and calls below `min_qv` (20), then reports $\hat\varepsilon_{\mathrm{all}}$, $\hat\varepsilon_{NC}$, $\rho$ and $f_g$ for each section. This is the published heuristic in combined form. No probabilistic posterior has passed a benchmark, so the default stays heuristic and remains the comparator for every model-based option.

**Model-based options.** `baysor_noise_mixture` applies the quality rule and then keeps molecules whose noise posterior is at most 0.05 (proposed). The background posterior of section 3 enters the method enum only after it passes B2. It is falsified if its AUROC on planted calls does not exceed that of the quality rule, or if its relative share error exceeds 25% at any planted rate.

**Calibration.** Posteriors are recalibrated by temperature scaling fitted on planted data (B2) only, so that the controls used for estimation are not reused to calibrate the same estimate.

**ML stack.** No learned model is planned for the first version. The per-call kernels are fixed-size neighbour sums and Poisson rate evaluations. They are hard-coded in CUDA: a spatial grid for neighbour distances, a sparse neighbour-weight product for the coupled update (cuSPARSE), and per-cell count reductions. PyTorch is not used. The CPU path implements the same algorithm with threads. Streaming is not claimed; each section is held in memory.

**Defaults for agents.** `method` = `control_feature_fdr`, `min_qv` = 20, `estimator` = `auto`, `device` = `auto`. No seed is needed because no rule is stochastic.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | points/<name> | table | Transcripts: x, y, optional z, gene or codeword identity, qv |
| read | labels/<name> | int raster | Optional cell mask; supplies the Baysor prior and per-cell background |
| read | var/feature_type | categorical | Feature class per codeword: gene, negative control, blank, unassigned, genomic control, anti-sense, deprecated |
| read | uns/codebook | dict | Codebook size $M$, blank count $B$, negative-control count |
| write | points/transcript_keep | bool | Keep flag per transcript |
| write | points/transcript_noise_prob | float32 | Noise posterior per transcript; written by `baysor_noise_mixture` only |
| write | var/false_call_rate | float32 | Per-gene non-specific share $f_g$ |
| write | obs/retained_fraction | float32 | Share of each cell's transcripts retained |
| write | uns/transcript_qc | dict | Thresholds, $\hat\varepsilon$ values, $\rho$ and removed counts by class |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle (.singlet path or URI) with a transcript table and codebook metadata. |
| `method` | string | "control_feature_fdr" | `control_feature_fdr`, `qv_threshold`, `baysor_noise_mixture` | Keep rule. control_feature_fdr is the default; baysor_noise_mixture is the model-based option. |
| `min_qv` | number | 20.0 | min 0 | Drop calls with quality value below this value; 0 disables the quality rule. |
| `control_feature_fdr` | object | — | — | Options for control_feature_fdr. |
| `control_feature_fdr.estimator` | string | "auto" | `auto`, `negative_control`, `blank_codeword` | auto uses negative-control features when present, otherwise blank codewords. |
| `control_feature_fdr.fallback_pattern` | string | "NegControl*,BLANK_*,antisense_*" | — | Glob patterns for control features, used only when var/feature_type is absent. |
| `baysor_noise_mixture` | object | — | — | Options for baysor_noise_mixture. |
| `baysor_noise_mixture.prior_segmentation_confidence` | number | 0.2 | min 0; max 1 | Confidence in the prior cell mask, used when labels/<name> is supplied. |
| `baysor_noise_mixture.confidence_nn_id` | integer | 0 | min 0 | Neighbours for the distance statistic; 0 selects max(n_genes/10, 10). |
| `baysor_noise_mixture.max_noise_posterior` | number | 0.05 | min 0; max 1 | Keep molecules whose noise posterior is at or below this value (proposed). |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA for the Baysor option when a device is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing keep flags and QC members instead of failing. |
<!-- PARAMS:AUTO:END -->

`method` selects the keep rule, and `min_qv` applies to every method (0 disables it). `control_feature_fdr.estimator` = `auto` uses negative-control features when `var/feature_type` marks any, and blank codewords otherwise; the blank estimate needs $B\ge 1$ and $M$ from `uns/codebook`. `fallback_pattern` applies only when `var/feature_type` is absent. The `baysor_noise_mixture` settings apply only to that method, and its prior confidence only when `labels/<name>` is supplied. Parameters take the design values of section 5 and are not tuned on the sections they are scored on.

## 7. MCP tool

Tool name `singlet_spatial_preproc_transcript_quality_filtering` (definition in `tasks/mcp/singlet_spatial_preproc_transcript_quality_filtering.json`). Example call and compact result:

```json
{"dataset": "/data/pancreas_xenium.singlet", "method": "control_feature_fdr", "min_qv": 20}
```

```json
{"dataset": "/data/pancreas_xenium.singlet", "status": "completed",
 "wrote": ["points/transcript_keep", "var/false_call_rate", "obs/retained_fraction", "uns/transcript_qc"],
 "summary": {"method": "control_feature_fdr", "estimator": "negative_control", "n_transcripts": "<int>",
   "n_removed": "<int>", "epsilon_blank": "<float>", "epsilon_nc": "<float>", "agreement_ratio": "<float>",
   "removed_by_class": {"control": "<int>", "quality": "<int>"}},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: the `baysor_noise_mixture` option is queued above $10^7$ transcripts (proposed); the other methods run inline. Stochastic: no. A dry run returns estimated seconds, peak memory in GB and device from the transcript count, without reading the table.

## 8. Benchmarks

All benchmarks score raw decoded calls, before segmentation or cell assignment, one section at a time. Estimates are computed per section and summarised by the median across sections. Controls and planted labels are fixed before any keep rule is applied. Every benchmark uses the control-class definition of section 4. Thresholds are design values fixed before analysis and are labelled proposed where they are not literature values. Seeds 0 to 4 apply to the planted benchmark only.

### B1. Negative-control and blank-codeword agreement

- **Goal**: test whether the blank and negative-control channels agree ($\rho=1$) on sections from platforms with negative-control features. The protocol is proposed; the data are published.
- **Ground truth**: proxy labels. Blank and negative-control calls are noise by construction for their own channel, labelled from `var/feature_type`, not per transcript. Estimands as in section 3, normalised by all decoded calls; $f_g$ by the gene's own count.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| FFPE tissue microarray serial sections on Xenium, CosMx and MERSCOPE | [R4] | Human FFPE, three imaging platforms | — | $\rho$ only where negative controls exist |
| 10x Genomics FFPE human pancreas, Xenium multimodal segmentation (377 genes) | Baysor example README (section 12); https://www.10xgenomics.com/datasets/ffpe-human-pancreas-with-xenium-multimodal-cell-segmentation-1-standard | Human FFPE pancreas, Xenium, 7,170,423 high-quality decoded transcripts (README) | — | Base section for B2 |

- **Metrics**

| Metric | Definition (aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Agreement $\rho$ | $\bar n_B/\bar n_{NC}$ per section; median | closer to 1 | primary | section 3 |
| Negative-control share | $\hat\varepsilon_{NC}$ on retained calls | lower | primary | section 3 |
| Per-gene share | median $f_g$ over genes | lower | guardrail | section 3 |
| Blank-call fraction | $N_U/N_{\mathrm{tot}}$ on retained calls | lower | guardrail | section 3 |

- **Comparators**: no filter; `min_qv` 20 alone; the default; Baysor posterior at 0.05 with `min_qv` disabled; Proseg Xenium preset (callout).
- **Protocol**: for each section with negative-control features, compute both channels on raw calls, apply each comparator, and recompute on retained calls. Default thresholds are fixed on half the sections and scored on the other half.
- **Acceptance criterion**: proposed design values. $\rho$ lies in $[0.5,2]$ on at least 80% of sections, and $\hat\varepsilon_{NC}$ after the default filter is below 5%.
- **Known pitfalls**: (1) gene-probe non-specificity is not codeword misdecoding, so agreement can arise from shared chemistry or by coincidence; (2) if control counts also set the threshold, the retained share is optimistic.

### B2. Spike-in simulation with planted misdecoding

- **Goal**: test whether each keep rule and estimator recovers a planted share of misdecoded calls (proposed design).
- **Ground truth**: planted simulation; inserted calls are labelled 1 and base calls 0. The estimand is the planted share of all calls, $\varepsilon_p=N_{\mathrm{ins}}/(N_0+N_{\mathrm{ins}})$, matched by $\hat\varepsilon_{\mathrm{all}}$ after subtracting the unplanted section's estimate.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pancreas base section with synthetic insertions | Base section of B1 | As in B1 | — | Generated per rate and seed |

Generator: (1) take the unplanted section ($N_0$ calls); (2) for $\varepsilon_p\in\{0.01,0.02,0.05,0.10\}$, insert $N_{\mathrm{ins}}=\varepsilon_pN_0/(1-\varepsilon_p)$ calls; (3) place them uniformly over the section's convex hull; (4) draw identities uniformly over all $M$ codewords, including blank and negative-control ones; (5) draw qualities from the section's blank calls; (6) drop insertions within 1 µm of a base transcript (proposed); (7) seeds 0 to 4.

- **Metrics**

| Metric | Definition (aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Relative share error | $\lvert\hat\varepsilon_{\mathrm{all}}-\hat\varepsilon^{(0)}_{\mathrm{all}}-\varepsilon_p\rvert/\varepsilon_p$, mean over seeds | lower | primary | section 3 |
| Removal recall | planted calls with keep false, split at quality 20 | higher | primary | section 8 |
| AUROC of noise score | against planted label, overall and in the densest tenth of each section (model-based only) | higher | guardrail | section 8 |

- **Comparators**: quality threshold; the default; Baysor posterior at 0.05; Proseg Xenium preset (keep flags only).
- **Protocol**: the control-class rule can remove planted calls only on control-class codewords, a share $M_{\mathrm{ctl}}/M$ in expectation, where $M_{\mathrm{ctl}}$ counts those codewords.
- **Acceptance criterion**: proposed design values. Relative share error is at most 25% at every rate from 1% to 10%, and removal recall is at least 0.9 among planted calls with quality below 20.
- **Known pitfalls**: (1) uniform identities meet the blank channel's uniform-misdecoding assumption by construction, so B2 cannot detect bias from non-uniform misdecoding; (2) uniform insertions are spatially isolated, which favours distance-based scores in sparse tissue.

### P1. Performance and scaling

Wall time, peak memory and throughput in transcripts per second for each method at $10^6$, $10^7$ and $10^8$ transcripts, on CPU and CUDA. The quality rule plus control-class filter is the linear-time baseline, and the Baysor and Proseg presets are the published comparators. Scales are a design choice. Hold fixed: thread count, input format, and presence of a prior label raster. Report the empirical exponent of time against transcript count and peak memory per transcript. Do not compare across machines without normalisation.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.multiplexed_fish_decoding`: Multiplexed FISH spot detection and codebook decoding
  - `spatial-preproc.image_cell_segmentation`: Cell and nucleus segmentation from stain images of spatial transcriptomics sections
- **Feeds**:
  - `spatial-preproc.transcript_cell_assignment`: Transcript-to-cell assignment and boundary inference
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
- **Reads**: `points/<name>`, `labels/<name>`, `var/feature_type`, `uns/codebook`
- **Writes**: `points/transcript_keep`, `points/transcript_noise_prob`, `var/false_call_rate`, `obs/retained_fraction`, `uns/transcript_qc`
<!-- CHAINING:AUTO:END -->

Used in imaging-panel preprocessing: decoding, then this filter, then transcript-to-cell assignment and spatial-unit QC.

## 10. Risks, pitfalls and open questions

- **Untested assumptions.** Uniform misdecoding over codewords (section 3) has not been measured, and the direction of the bias it would cause is untested. The Phred mapping of the quality column is conditional on a convention that no vendor document cited here confirms. No OpenProblems task in the local corpus is named for transcript-level filtering, so no community metric is taken from one.
- **Control designs.** Whether MERSCOPE panels carry negative-control probes needs the platform documentation, and the blank-barcode substitute on that platform is untested. The `is_predicted_false_positive` class in the native Xenium format has no documented method in the sources read.
- **Partial sources.** R1 and R2 are checked against their repository citation files and READMEs, not full text. R3 and R4 match search records for title, venue, year and DOI; R4's authors after the first, and the blank-codeword design of the 2016 codebook, remain to be checked against the full texts.
- **Repository inconsistencies.** Baysor's documentation gives the default for `confidence_nn_id` as max(m/2+1, 5), whereas the code uses max(n_genes/10, 10) (section 4); the code value is used here. Line references in section 4 point to the repository snapshots named in section 12, which carry no version metadata and may drift with later commits.
- **Access and licences.** Licence and access terms for both datasets in section 8 are open, so no data may be redistributed from them. Proseg's copyleft licence (section 12) rules out porting its code into a permissively licensed package, and singlet's own licence decision is outside this document.
- **First experiment.** Run B2 on the pancreas base section at 1% and 5% planted rates, comparing the default, the quality rule and the Baysor option. The result decides whether the background posterior is implemented next.

## 11. References

R1. Petukhov V, Xu RJ, Soldatov RA, Cadinu P, Khodosevich K, Moffitt JR, Kharchenko PV. Cell segmentation in imaging-based spatial transcriptomics. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-01044-w — verified (corpus)

R2. Jones DC, Elz AE, Hadadianpour A, et al. Cell simulation as cell segmentation. *Nature Methods* 2025. doi:10.1038/s41592-025-02697-0 — verified (corpus)

R3. Moffitt JR, et al. High-throughput single-cell gene-expression profiling with multiplexed error-robust fluorescence in situ hybridization. *Proceedings of the National Academy of Sciences* 2016. doi:10.1073/pnas.1612826113 — partial (search)

R4. Wang H, et al. Systematic benchmarking of imaging spatial transcriptomics platforms in FFPE tissues. *Nature Communications* 2025. doi:10.1038/s41467-025-64990-y — partial (search)

R5. Moffitt JR, Lundberg E, Heyn H. The emerging landscape of spatial profiling technologies. *Nature Reviews Genetics* 2022. doi:10.1038/s41576-022-00515-3 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/kharchenkolab/Baysor | Viktor Petukhov, Peter Kharchenko | MIT (LICENSE file) | Molecule noise model, fitting code and presets | port |
| https://github.com/dcjones/proseg | Daniel C. Jones | GPL-3.0 (LICENSE.md) | Xenium preset comparator; quality and name rules | callout |
| https://github.com/gustaveroussy/sopa | Quentin Blampey | BSD-3-Clause (LICENSE; pyproject.toml) | Control-class name rules; quality default | port |
| https://github.com/drieslab/Giotto | — | MIT (DESCRIPTION; LICENSE file) | Cross-check of quality default and feature types | callout |
