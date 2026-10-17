---
id: spatial-preproc.transcript_cell_assignment
title: Transcript-to-cell assignment and boundary inference
area: spatial-preproc
scope: core
paradigm: model-based
literature_status: contested
priority: P0
depends_on: [spatial-preproc.transcript_quality_filtering, spatial-preproc.image_cell_segmentation]
feeds: [spatial-preproc.spatial_unit_qc_filtering, spatial-preproc.spatial_contamination_removal]
reads: [points/<name>, labels/<name>, images/<name>, uns/platform_units]
writes: [points/transcript_cell_id, points/transcript_cell_confidence, uns/cell_polygons, layers/counts, obs/n_transcripts, obs/cell_area, obsm/spatial, uns/<method>_run]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_preproc_transcript_cell_assignment
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Transcript-to-cell assignment and boundary inference

> Assigns each detected transcript to a cell or to background and returns cell boundaries and a cell-by-gene count matrix. The published standards are a fitted mixture and a leaky voxel label model; the proposed singlet route is a calibrated mixture with composition priors from the catalogue.

## 1. Question

Given $M$ detected transcripts with positions $x_m\in\mathbb{R}^2$ (or $\mathbb{R}^3$), gene identities $g_m$ and optional quality values, plus optional nuclear or stain-derived cell masks, which cell of origin, or background, does each transcript belong to, and where are the cell boundaries? A correct answer assigns each transcript to the cell that produced it, labels stray transcripts as background, and gives cell-level counts that match the cells that produced them. No cell of origin is observed on real data, so correctness is always indirect (section 8).

## 2. Why this task matters and where the field stands

Cell-level counts underlie clustering, annotation and spatial domains, but imaging platforms report transcripts with positions, not cells. Image-based segmentation gives masks [R5], and a mask cannot place a transcript that lies in a leaked or overlapping position, so an explicit transcript-level assignment step is needed. The status is **contested**. Open problems:

- **Leakage versus background.** Stray transcripts can come from displacement or from a background process. The voxel model describes displacement explicitly [R2]; the mixture absorbs strays into a background component [R1].
- **Prior dependence.** The voxel model's cell number and locations come from a prior segmentation [R2], and the mixture's output depends on a prior confidence [R1].
- **Learned assigners** are trained on links derived from an initial segmentation, so they inherit its errors [R4].
- **Sensitivity, specificity and contamination** are evaluated together for Xenium data [R7].
- **Rankings across methods are disputed.** The 2026 Xenium comparisons [R7][R8] are discussed in section 10; no ranking is used here.

## 3. Theory and insight

Transcript $m$ has position $x_m$, gene $g_m\in\{1,\dots,G\}$ and latent label $z_m\in\{0,1,\dots,K\}$, with 0 for background. Cell $k$ has centre $\mu_k$, covariance $\Sigma_k$, weight $\pi_k$ and gene composition $\theta_k$; background has weight $\pi_0$, spatial density $p_0$ and a uniform composition $\bar\theta_0$. Cell boundaries are level sets of the posterior label field. A mixture model fits a density per cell by alternating E and M steps. A voxelised label model fits a compactness-regularised field over a lattice by MCMC. A learned assigner replaces the likelihood with a neural objective. A heuristic rule has no likelihood.

Mixture density, as implemented in the Baysor C++ code:

$$p(x_m,g_m)=\sum_{k=1}^{K}\pi_k\,\mathcal N(x_m\mid\mu_k,\Sigma_k)\,\theta_{k,g_m}+\pi_0\,p_0(x_m)\,\bar\theta_0$$

Its E-step posterior of membership is

$$r_{mk}=\frac{\pi_k\,\mathcal N(x_m\mid\mu_k,\Sigma_k)\,\theta_{k,g_m}}{\pi_0\,p_0(x_m)\,\bar\theta_0+\sum_{j=1}^{K}\pi_j\,\mathcal N(x_m\mid\mu_j,\Sigma_j)\,\theta_{j,g_m}}$$

Here $\bar\theta_0$ is the mean of $1/n_{\text{genes}}$ over components with non-trivial composition mass (bmm_algorithm.cpp:26–35, :141), so background composition is uniform. The regime is first order: each cell's transcripts are approximately Gaussian with width near the scale parameter. It breaks for elongated or multinucleate cells and for strongly leaky transcripts. Cell composition is smoothed (bmm_algorithm.cpp:397), so an unseen gene does not receive zero probability; the smoothing form differs between code paths (section 10).

Leakage in the voxel model, in the form given by its README (see section 10):

$$p(\hat x_m\mid x_m)=(1-p_d)\,\mathcal N(\hat x_m\mid x_m,\sigma_{\mathrm{near}}^2 I)+p_d\,\mathcal N(\hat x_m\mid x_m,\sigma_{\mathrm{far}}^2 I)$$

Here $x_m$ is the position of the cell of origin and $\hat x_m$ the observed one. The regime is two-dimensional or per voxel layer, and it is valid when displacement is well described by two scales. Cell expression is a negative-binomial mixture with ten components by default, fitted jointly with the labels.

Estimands and normalisation:

- **Transcript label**: the estimand is the cell of origin $z_m$; the output is $\hat z_m=\arg\max_{k\in\{0,\dots,K\}} r_{mk}$, with $\sum_k r_{mk}=1$ for each transcript.
- **Confidence**: $\max_k r_{mk}$ per transcript, a model posterior that is a calibrated frequency only after validation (section 8).
- **Cell-by-gene matrix**: $C_{kg}=\#\{m:\hat z_m=k,\,g_m=g\}$, unnormalised molecule counts with no size factor.
- **B1 truth**: the vendor raster label of each transcript; ARI is computed over transcripts with a non-zero label in either partition.
- **B2 truth**: the planted $z_m$; accuracy is normalised by the number of cell-derived transcripts.

Adjusted Rand index [R6]. With $n_{ij}$ the contingency counts of reference label $i$ against predicted label $j$ over the scored transcripts, $a_i=\sum_j n_{ij}$, $b_j=\sum_i n_{ij}$ and $n=\sum_{ij}n_{ij}$:

$$\mathrm{ARI}=\frac{\sum_{ij}\binom{n_{ij}}{2}-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}}{\tfrac12\Big[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}\Big]-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}}$$

It is exact for any pair of partitions and invariant to label permutation; its expectation is 0 under random partitions with the same marginals, and it is dominated by large clusters and by the background class.

Heuristic baseline: the nearest nucleus within radius $R$ of nucleus centroids $\mu_c$.

$$c(m)=\operatorname*{arg\,min}_{c:\ \lVert x_m-\mu_c\rVert\le R}\lVert x_m-\mu_c\rVert,\qquad c(m)=0 \text{ if no such } c$$

It is valid when cell centres approximately coincide with nuclear centroids and cells are roughly isotropic; it fails for elongated cells and for cells without nuclear signal.

Failure modes by family:

- **Mixture**: non-Gaussian cell shapes; leakage absorbed into background; composition fitted on the same data it assigns.
- **Voxel model**: the prior fixes the cell number and rough locations, so new cells are not introduced; cells with few transcripts give unstable boundaries; output varies between executions.
- **Learned**: errors in the initial boundaries propagate into the links the model is trained on.
- **Priors and heuristics**: nuclear misregistration in x, y or z, or a different resolution, biases nucleus-based rules; anucleate cells have no prior; overlapping or stacked cells share transcripts that one neighbourhood cannot separate.

The methods differ in what they model explicitly: a per-cell density and composition (mixture), leakage and compactness over a voxel lattice (voxel model), or a learned neighbour graph (learned). A model-based formulation adds a likelihood to compare against, membership posteriors that can be calibrated, and composition profiles that can be reused across datasets. Calibration is a claim to test on planted data (B2). The only benchmark read for this task scores against vendor-derived labels (B1).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Baysor mixture | model-based | Per-cell Gaussian position times smoothed gene composition, with a background component, fitted by alternating E and M steps | [R1] |
| Baysor segmentation-free mode | heuristic | Neighbourhood composition vector per molecule, written as overlapping neighbourhoods rather than cells | docs/segfree.md @ 619f09d |
| Proseg voxel model | model-based | Compactness-regularised voxel label field, negative-binomial expression mixture, leakage term, sampler with burn-in and hill-climb | [R2] |
| segger | model-based (learned) | Graph neural network with contrastive link prediction onto initial boundaries | [R4] |

Baysor and Proseg are the model-based methods covered by repository code, and segger is the learned alternative. The nearest-nucleus rule of section 3 is a baseline only and is not listed; BIDCell and SCS are excluded (section 10).

| Method | Parameter | Value | Source |
|---|---|---|---|
| Baysor mixture | min_molecules_per_cell | 0 documented (must be positive); 50 in the Xenium preset and wrapper | docs/configuration.md:70 and :31 @ 619f09d; OpenProblems task config src/methods/baysor/config.vsh.yaml |
| Baysor mixture | scale | -1.0, estimated from the prior; a positive value disables estimation | docs/configuration.md:82 @ 619f09d |
| Baysor mixture | scale_std | 25% | docs/configuration.md:83 @ 619f09d |
| Baysor mixture | cluster_method | mrf | docs/configuration.md:84 @ 619f09d |
| Baysor mixture | n_clusters | 0 (auto): 4 for mrf, 10 for graph methods | docs/configuration.md:85 @ 619f09d |
| Baysor mixture | prior_segmentation_confidence | 0.2; 0.5 in the Xenium preset; 0.8 in the wrapper | docs/configuration.md:90 and :31 @ 619f09d; src/methods/baysor/config.vsh.yaml |
| Baysor mixture | stochastic E-step flag | present; default — | src/processing/bmm_algorithm/bmm_algorithm.cpp:291-292 @ 619f09d |
| Baysor mixture | force_2d | true in the wrapper | src/methods/baysor/config.vsh.yaml |
| Baysor segmentation-free | k_neighbors | max(n_genes/10, min_molecules_per_cell, 3), integer division | docs/segfree.md; docs/configuration.md:47 @ 619f09d |
| Baysor segmentation-free | output | ncvs.loom, genes by molecules | docs/segfree.md @ 619f09d |
| Proseg | voxel_size | 1.0 µm | src/main.rs:39 @ 4caa6f3 |
| Proseg | burnin_voxel_size | 2.0 µm, an integer multiple of voxel_size | src/main.rs:38, :723–727; README.md:108 @ 4caa6f3 |
| Proseg | voxel_layers | 4 (Visium HD preset 1) | src/main.rs:243-244, :591 @ 4caa6f3 |
| Proseg | ncomponents | 10 | src/main.rs:235 @ 4caa6f3 |
| Proseg | burnin_samples, samples, hillclimb, recorded_samples | 200, 200, 50, 100 | src/main.rs:251, :255, :259, :264 @ 4caa6f3 |
| Proseg | cell_compactness | 0.04; 0.03 in the wrapper | src/main.rs:272 @ 4caa6f3; task repository src/methods/proseg/script.py:103 @ bdf3d5d |
| Proseg | diffusion_probability | 0.2 | src/main.rs:315 @ 4caa6f3; README.md:205 |
| Proseg | diffusion_sigma_near, diffusion_sigma_far | 1.0 µm, 4.0 µm (Visium HD preset 8.0 µm) | src/main.rs:40-41, :594 @ 4caa6f3 |
| Proseg | nuclear_reassignment_prob, prior_seg_reassignment_prob | 0.2, 0.5 | src/main.rs:279-280, :282-283 @ 4caa6f3 |
| segger | init_segmentation | auto: cell_id when present, otherwise Cellpose on morphology | OpenProblems task config src/methods/segger/config.vsh.yaml |
| segger | n_epochs | 20 | src/methods/segger/config.vsh.yaml |
| segger | prediction_expansion_ratio | 0.5 | src/methods/segger/config.vsh.yaml |
| segger | prediction_mode | nucleus | src/methods/segger/config.vsh.yaml |

## 5. Proposed singlet approach

Licences and routes are in section 12:

- **Baysor mixture.** The proposed default: E and M steps, scale estimation and prior adjustment in C++, with a CUDA E-step.
- **Proseg voxel model.** Built only if the planted benchmark shows the mixture's leakage term underperforms the voxel model at $p_d=0.2$, from the published model and the README without copying code.
- **segger.** A comparator; its learned objective is not adopted in the first version.
- **Segmentation-free output.** Not a cell call, and not scored.
- **Nearest-nucleus rule.** The in-house baseline of section 3.

The proposed model is the mixture of section 3 with three additions. Thresholds are proposed design values.

1. **Composition priors.** $\theta_k$ takes scRNA-derived profiles from the catalogue as fixed or hierarchical priors. Falsified if B1 ARI with catalogue priors does not exceed per-dataset composition on at least two of three replicates.
2. **Leakage term.** Each transcript carries a latent displacement from the two-scale kernel of section 3, so strays are neither forced into a cell nor into background. Falsified if B2 accuracy at $p_d=0.2$ does not exceed that of the mixture without the term.
3. **Calibrated membership.** $r_{mk}$ is recalibrated by temperature scaling or conformal sets fitted on planted data. Falsified if expected calibration error on B2 exceeds 0.05.

No neural network is planned for the first version. The E-step of a small-K Gaussian mixture with sparse composition is a dense small kernel over sparse inputs, so it is hard-coded in CUDA with cuSPARSE for composition products. PyTorch is reserved for a learned prior, should one be added. Core kernels are spatial grid hashing, the E-step, a sparse composition scatter-add in the M-step, and background density. The CPU path uses the same algorithm with threads. Streaming is not claimed; each section is fitted in memory.

The proposed default is baysor_mixture with nucleus_labels as its prior. The vendor cell ID is never a prior, and segger's default initialisation is cellpose, not the auto setting of the OpenProblems wrapper (section 4). Defaults and ranges are in section 6.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | points/<name> | table | Transcripts: x, y, optional z, gene (categorical), optional qv |
| read | labels/<name> | int raster | Optional nucleus or stain-derived cell prior in the same frame |
| read | images/<name> | image | Morphology image for segger's default initialisation |
| read | uns/platform_units | string | Coordinate unit, microns; needed for scale and voxel sizes |
| write | points/transcript_cell_id | int32 | Assigned cell ID per transcript; 0 is background |
| write | points/transcript_cell_confidence | float32 | Baysor posterior of the assigned cell |
| write | uns/cell_polygons | geometry | Cell boundary polygons |
| write | layers/counts | sparse int | Cell-by-gene molecule counts, unnormalised |
| write | obs/n_transcripts, obs/cell_area | int, float | Molecules per cell; polygon area in µm² |
| write | obsm/spatial | float | Cell centroids |
| write | uns/<method>_run | record | Method, version or commit, seed and all parameters |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI with a points table of x, y and gene. |
| `method` | string | "baysor_mixture" | `baysor_mixture`, `proseg`, `segger` | Assignment model; baysor_mixture is the proposed default. segger needs a morphology image for its default initialisation. |
| `prior_source` | string | "nucleus_labels" | `nucleus_labels`, `stain_cell_mask`, `none` | Prior raster from labels/. Vendor cell IDs are never accepted; proseg requires a prior. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Seed for the stochastic E-step of baysor_mixture. The proseg source has no seed option, so its repeated executions are reported as a spread. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `baysor` | object | — | — | Options for method baysor_mixture; other methods ignore them. |
| `baysor.scale` | number | -1.0 | — | Cell radius in microns; -1 estimates it from the prior and needs prior_source other than none. |
| `baysor.scale_std` | string | "25%" | — | Spread of scale across cells, absolute or percentage. |
| `baysor.min_molecules_per_cell` | integer | 50 | min 1 | Minimum molecules for a cell call; must be positive. |
| `baysor.prior_segmentation_confidence` | number | 0.2 | min 0; max 1 | Confidence in the prior segmentation, from 0 to 1. |
| `baysor.n_clusters` | integer | 4 | min 1 | Number of composition clusters for the mrf method. |
| `baysor.force_2d` | boolean | true | — | Ignore the z column, as the benchmark wrapper does. |
| `proseg` | object | — | — | Options for method proseg; other methods ignore them. |
| `proseg.voxel_size_um` | number | 1.0 | > 0 | Voxel size in x and y, in microns. |
| `proseg.burnin_voxel_size_um` | number | 2.0 | > 0 | Burn-in voxel size in microns; an integer multiple of voxel_size_um. |
| `proseg.voxel_layers` | integer | 4 | min 1 | Number of z layers in the voxel lattice. |
| `proseg.burnin_samples` | integer | 200 | min 1 | Samples taken at the burn-in voxel size. |
| `proseg.samples` | integer | 200 | min 1 | Samples taken after burn-in. |
| `proseg.hillclimb` | integer | 50 | min 0 | Final hill-climb iterations. |
| `proseg.ncomponents` | integer | 10 | min 1 | Negative-binomial mixture components for cell expression. |
| `proseg.cell_compactness` | number | 0.04 | min 0 | Compactness prior; smaller values give rounder cells. |
| `proseg.diffusion_probability` | number | 0.2 | min 0; max 1 | Prior probability that a transcript is diffused and repositioned. |
| `proseg.diffusion_sigma_near_um` | number | 1.0 | min 0 | Repositioning SD for non-diffused transcripts, in microns. |
| `proseg.diffusion_sigma_far_um` | number | 4.0 | min 0 | Repositioning SD for diffused transcripts, in microns. |
| `proseg.nuclear_reassignment_prob` | number | 0.2 | min 0; max 1 | Prior probability that the initial nuclear assignment is wrong. |
| `segger` | object | — | — | Options for method segger; other methods ignore them. |
| `segger.n_epochs` | integer | 20 | min 1 | Training epochs for the link predictor. |
| `segger.prediction_expansion_ratio` | number | 0.5 | min 0 | Fraction of each polygon's equivalent radius used to expand it for prediction. |
| `segger.init_segmentation` | string | "cellpose" | `cellpose`, `auto` | Initial boundaries: cellpose from morphology, or auto, which uses the vendor cell ID when present. |
<!-- PARAMS:AUTO:END -->

Rules that span parameters: Proseg needs a prior, because it does not create cells. With prior_source none, baysor.scale must be positive, since a negative value is estimated from the prior. The vendor cell ID is not a prior option; it appears only in benchmark controls. segger's default initialisation reads a morphology image. All distances are in microns, and a mismatch with uns/platform_units changes results silently. Set seed for every method that accepts one and report the spread across seeds or repeated executions.

## 7. MCP tool

Tool `singlet_spatial_preproc_transcript_cell_assignment` (definition in `tasks/mcp/singlet_spatial_preproc_transcript_cell_assignment.json`). Example call, then an example result in which angle-bracket placeholders are not values.

```json
{"dataset": "/data/xenium_rep1.singlet", "method": "baysor_mixture", "prior_source": "nucleus_labels", "seed": 0}
```

```json
{"dataset": "/data/xenium_rep1.singlet", "status": "completed",
 "wrote": ["points/transcript_cell_id", "points/transcript_cell_confidence", "uns/cell_polygons", "layers/counts", "obs/n_transcripts", "obs/cell_area", "obsm/spatial", "uns/baysor_mixture_run"],
 "summary": {"method": "baysor_mixture", "n_transcripts": "<int>", "n_cells": "<int>", "call_rate": "<fraction>", "background_fraction": "<fraction>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

- Long-running: large sections may return status queued with a job_id.
- Stochastic: seed controls the stochastic E-step of baysor_mixture; the proseg source has no seed option, so its repeated executions are reported as a spread.
- Dry run: returns estimated seconds, peak memory and device without fitting.

## 8. Benchmarks

Every accuracy benchmark compares per-transcript labels with a reference label per transcript. Background is label 0 and counts as one class, and predictions are read at transcript coordinates. Each comparison fixes and reports the prior source, the Baysor prior confidence and the minimum molecules per cell. Stochastic methods use five seeds (proposed). Replicates and seeds are reported individually, not pooled.

### B1. Vendor-label agreement on Xenium mouse brain (published protocol, extended)

- **Goal**: Score per-transcript assignments against vendor-derived labels on three Xenium mouse-brain replicates, as in the OpenProblems spatial segmentation task.
- **Ground truth**: Another pipeline's segmentation (the vendor cell_labels raster), not manual and not orthogonal. Each transcript takes the raster value at its truncated integer (y, x) pixel after clipping to the raster; background is 0. The estimand is the adjusted Rand index between the vendor and predicted transcript partitions over transcripts with a non-zero label in either (task repository src/metrics/ari/script.py:34–57).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Xenium V1 fresh-frozen mouse brain, replicates 1 to 3 | 10x dataset page https://www.10xgenomics.com/datasets/fresh-frozen-mouse-brain-replicates-1-standard; replicate 1 archive https://cf.10xgenomics.com/samples/xenium/1.0.2/Xenium_V1_FF_Mouse_Brain_MultiSection_1/Xenium_V1_FF_Mouse_Brain_MultiSection_1_outs.zip (both URLs in the task repository's process_10x_xenium.sh) | Xenium v1; *Mus musculus*; size — | — | Replicates 2 and 3 are listed in the same processing script; test resource mouse_brain_combined |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | Adjusted Rand index (section 3) between reference and predicted IDs over transcripts with a non-zero label in either; sklearn implementation | maximise | primary | [R6] |
| Call rate | Fraction of all transcripts with a non-zero predicted label; reported beside ARI | report | guardrail | — |

- **Comparators**: Controls are true labels, empty labels (all background), random Voronoi (one random seed per reference cell; proposed) and vendor passthrough (transcript cell ID). Methods use the OpenProblems wrapper settings: Baysor at 619f09d (nucleus labels, prior confidence 0.8, 50 molecules), Proseg 3.2.0 (compactness 0.03, starting IDs from a 20 µm grid rather than the vendor cell ID), segger 0.3.0 (auto initialisation, which uses the transcripts' cell_id column when present), and the nearest-nucleus rule (proposed).
- **Protocol**: Three replicates; controls, then methods, per replicate, one invocation each, with viash and Nextflow as in the task repository.
- **Acceptance criterion** (proposed, not from the literature): ARI of true labels at least 0.999 on every replicate; ARI of empty labels at most 0.05 and of random Voronoi at most 0.10; each method at least the passthrough ARI minus 0.05 on at least two of three replicates.
- **Known pitfalls**: (1) The vendor partition is the reference and the vendor cell ID is an allowed input, so copying it scores highest by construction; the passthrough is a control, not a competitor. (2) Background disagreements count as errors, so ARI moves with call rate.

### B2. Planted simulation with exact labels (proposed)

- **Goal**: Measure accuracy where the cell of origin is known by construction, under controlled leakage and overlap.
- **Ground truth**: Planted; the generator stores each transcript's true cell ID (0 for background). The estimand is the fraction of cell-derived transcripts assigned to their planted cell, normalised by their number.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated 2-D tissue (recipe below) | singlet generator; no external accession | Simulated transcripts; size per replicate | — | — |

Recipe (proposed design settings, not data-derived):

1. A 500 µm square field; cell centres from a hard-core process with mean spacing 8 µm, so dense areas overlap.
2. Cell radius lognormal with median 5 µm and 25% spread.
3. Composition from per-type profiles (source in section 10).
4. Transcripts per cell negative binomial with mean 100 and dispersion 10.
5. With probability $p_d\in\{0,0.2,0.4\}$, a transcript is displaced by an isotropic exponential distance of mean 2 µm; otherwise it is placed uniformly in its cell.
6. Uniform background at 5% of cell-derived transcripts.
7. One nucleus per cell at the centre, shifted by 0, 1 or 2 µm; no vendor cell ID.
8. Five simulated replicates per setting.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| transcript_accuracy | Fraction of cell-derived transcripts assigned to their planted cell; background calls count as errors | maximise | primary | — |
| background_precision | Fraction of background-called transcripts that are planted background | maximise | guardrail | — |
| boundary_IoU | Mean per-cell IoU between predicted and planted masks, rasterised at 1 µm (proposed) | maximise | guardrail | — |

- **Comparators**: Baysor mixture, Proseg 3.2.0 and the nearest-nucleus rule, with default settings and nucleus priors. segger is omitted: its default initialisation needs morphology images, which the generator does not produce.
- **Protocol**: For each $p_d$ and offset, execute each comparator on the same five replicates; report accuracy by both.
- **Acceptance criterion** (proposed): for the best method, transcript_accuracy at least 0.9 at $p_d=0$ and at least 0.8 at $p_d=0.2$.
- **Known pitfalls**: (1) The simulator's exponential kernel (step 5) is not Proseg's two-scale form; a simulator that used Proseg's own leakage prior would favour Proseg. (2) Planted boundaries are not biological boundaries, so boundary IoU is only an agreement check.

### P1. Performance and scaling

Wall time, peak memory and transcripts per second at 1e5, 1e6 and 1e7 transcripts (proposed sizes), subsampled from one Xenium-type section. Baysor cpp-0.9.0, Proseg 3.2.0 and the nearest-nucleus rule are measured on CPU; segger 0.3.0 and the CUDA E-step are measured on GPU, with the GPU model recorded. Hold fixed: threads, the Proseg sampler schedule (burn-in 200, samples 200, hill-climb 50), prior settings and voxel settings. Proseg memory scales with the voxel lattice, and its README lists voxel size, voxel layers and diffusion as the memory levers. Report the log-log scaling exponent per method.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.transcript_quality_filtering`: Transcript quality filtering and false-positive estimation for imaging panels
  - `spatial-preproc.image_cell_segmentation`: Cell and nucleus segmentation from stain images of spatial transcriptomics sections
- **Feeds**:
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `spatial-preproc.spatial_contamination_removal`: Background and neighbour-contamination correction in spatial data
- **Reads**: `points/<name>`, `labels/<name>`, `images/<name>`, `uns/platform_units`
- **Writes**: `points/transcript_cell_id`, `points/transcript_cell_confidence`, `uns/cell_polygons`, `layers/counts`, `obs/n_transcripts`, `obs/cell_area`, `obsm/spatial`, `uns/<method>_run`
<!-- CHAINING:AUTO:END -->

This task sits in the imaging preprocessing workflow after transcript quality filtering and before cell-level QC. The stain-derived prior comes from image cell segmentation when that is used.

## 10. Risks, pitfalls and open questions

- **Truth and data.** The solution schema defines both cell_labels and groundtruth_cell_labels (task repository src/api/file_spatial_solution.yaml:43, :51), but the ARI script reads cell_labels (src/metrics/ari/script.py:45); the intended truth must be fixed before any score is published. A Xenium Prime cervical-cancer ground-truth dataset is listed in the task scripts (scripts/create_resources/xenium_gt_annotated_data.sh:13–18), and its use is undefined. The sizes of the mouse-brain replicates are not stated in the task scripts.
- **Sources.** BIDCell and SCS were identified from secondary summaries only, with no repository located, so they are excluded from tables and the enum. The Baysor equations come from the C++ source, and the paper's year is 2021 in the repository citation. The Proseg sampler code is not among the cited files. The nearest-nucleus rule has no primary source.
- **Contested rankings.** R8 reports Proseg with the highest average performance across ten mouse tissues, with an advantage that varies by tissue; its purity score needs no ground-truth annotation, so it cannot settle B1 or B2. R7 studies sensitivity, specificity and contamination in Xenium. Both are known from abstract-level sources, so no ranking is used.
- **Prior dependence.** Baysor's prior confidence and minimum molecules differ between its documentation, its Xenium preset and the wrapper (section 4), and no sensitivity study is in the cited sources. The wrappers also differ in which cell ID they read (B1), so the prior set must be fixed in every comparison.
- **Reproducibility and porting.** The OpenProblems wrapper runs `cargo install proseg` unpinned and builds the Baysor cpp branch at HEAD; pin Proseg 3.2.0 and cpp-0.9.0 (commit 619f09d at review), and record the task-repository commit used for each run. The composition smoothing differs between code paths (pseudo-count at molecule_clustering.cpp:111, floor of 0.1 at molecule_clustering_ica.cpp:313), so the path used by the mixture must be fixed in the port. Proseg's per-transcript confidence is not defined in the cited sources. A unit mismatch changes results silently.
- **First experiment.** Execute B2 at $p_d$ 0, 0.2 and 0.4 with the vendor cell ID excluded, comparing the mixture with and without the leakage term against Proseg and the nearest-nucleus rule; then execute B1 with the passthrough control. Marker-purity and profile-agreement checks are deferred: the marker-set rule and the reference cell types are unspecified, and the scRNA reference has no bibliographic record in the cited sources.

## 11. References

R1. Petukhov V, Xu RJ, Soldatov RA, Cadinu P, Khodosevich K, Moffitt JR, Kharchenko PV. Cell segmentation in imaging-based spatial transcriptomics. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-01044-w — verified (repo)

R2. Jones DC, Elz AE, Hadadianpour A, et al. Cell simulation as cell segmentation. *Nature Methods* 2025. doi:10.1038/s41592-025-02697-0 — verified (repo)


R4. Heidari, Moorman, et al. Segger: fast and accurate cell segmentation of imaging-based spatial transcriptomics data. *bioRxiv* 2025. doi:10.1101/2025.03.14.643160 — partial (repo)

R5. Stringer C, Wang T, Michaelos M, Pachitariu M. Cellpose: a generalist algorithm for cellular segmentation. *Nature Methods* 2021. doi:10.1038/s41592-020-01018-x — verified (corpus)

R6. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)

R7. Resolving sensitivity, specificity and signal contamination in Xenium spatial transcriptomics. *Nature Methods* 2026; 23:1152–1162. doi:10.1038/s41592-026-03089-8 — partial (search)

R8. Rose JR, Santangelo PJ, et al. CRISP enables comparisons of image-based spatial transcriptomic segmentation quality across ten organs. *bioRxiv* 2026. doi:10.64898/2026.04.16.718947 — partial (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/kharchenkolab/Baysor | Viktor Petukhov, Peter Kharchenko (LICENSE) | MIT (LICENSE file) | Mixture model, segmentation-free mode, defaults in section 4 | port (mixture); callout (segmentation-free) |
| https://github.com/dcjones/proseg | Daniel C. Jones (Cargo.toml) | GNU GPL v3 (LICENSE.md) | Voxel label model, defaults in section 4 | reimplement |
| https://github.com/dpeerlab/segger | Heidari, Moorman, et al. (README) | MIT declared in pyproject.toml; no LICENSE file at the repository root | Learned comparator | callout |
| https://github.com/openproblems-bio/task_spatial_segmentation | Open Problems in Single-Cell Analysis (LICENSE copyright line) | MIT (LICENSE file) | Benchmark wrappers, data scripts, ARI script | callout |
| https://github.com/MouseLand/cellpose (paper [R5]) | Stringer C, Wang T, Michaelos M, Pachitariu M (paper); setup.py names Pachitariu M and Stringer C | BSD-3-Clause (LICENSE file; setup.py says BSD; README badge says GPL v3) | Default initial boundaries for segger | callout (dependency) |
