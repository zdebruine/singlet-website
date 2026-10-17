---
id: spatial-preproc.image_cell_segmentation
title: Cell and nucleus segmentation from stain images of spatial transcriptomics sections
area: spatial-preproc
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [spatial-registration.image_coordinate_registration]
feeds: [spatial-preproc.transcript_cell_assignment, spatial-preproc.spatial_unit_qc_filtering, spatial-preproc.overlapping_cell_detection]
reads: [images/<name>]
writes: [labels/cell_instances, labels/nucleus_instances, shapes/cell_boundaries, obs/cell_area, obs/cell_confidence, obs/nucleus_area, obsm/spatial, uns/segmentation]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_preproc_image_cell_segmentation
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Cell and nucleus segmentation from stain images of spatial transcriptomics sections

> Assigns one integer label per nucleus and per cell in a registered stain image. A learned flow model is the proposed default; a training-free Otsu and distance-watershed baseline is kept as the heuristic comparator.

## 1. Question

Which pixels of a registered DAPI, membrane or H&E image belong to each nucleus and each cell, and where do the boundaries lie? The input is a multichannel tile in global coordinates. The output is integer instance masks for nuclei and cells, with polygons, centroids and areas. A correct answer gives one ID per object that matches manual masks at the stated IoU thresholds, and whose boundaries place transcripts with the cell of origin (section 8).

## 2. Why this task matters and where the field stands

Status: **contested**. Cell and nucleus masks define the unit to which transcripts are assigned, so a boundary error changes every expression profile derived from it. Learned instance models are built as generalists: Cellpose [R1][R2] and StarDist [R3] are pretrained once and applied to new images. Training-free watershed methods remain common because they are transparent. Mesmer is a learned generalist for tissue images trained on the TissueNet annotations [R4]. The field disagrees about what counts as correct: agreement with manual masks [R4] and agreement of transcripts with the cell of origin answer different questions.

Open problems:

- **Transcript-level truth.** Pixel masks are a proxy for the cell of origin, and no pixel-level benchmark with an independent transcript-level truth is available. The spatial benchmark that does exist scores transcript assignment, and part of its truth is vendor-derived (section 8).
- **Validation.** Pixel-mask scores (B2, B3) and transcript scores (B1) answer different questions, so agreement on one does not establish the other (section 8).
- **Unit.** Methods disagree on whether the unit is the nucleus, a membrane-bounded cell or a transcript-based cell, so cross-method comparisons need a shared definition (section 8).
- **Versioning.** The default Cellpose model is cpsam_v2, an update of Cellpose-SAM [R2] documented in the Cellpose README, so unpinned installs change their results.

## 3. Theory and insight

Let $I:\Omega\to\mathbb{R}^C$ be a registered stain image and $L:\Omega\to\{0,1,\dots,K\}$ the label image, with $L=0$ for background. Learned instance models estimate per-pixel quantities and decode them into instances. Heuristics threshold $I$ into a foreground $F=\{I\ge t\}$ and split $F$ with a distance map. Both must decide which pixels form one object, and their errors differ in kind.

**Pixel agreement.** For predicted and true masks $a,b$ (pixel sets), $\mathrm{IoU}(a,b)=|a\cap b|/|a\cup b|$. Per image, a one-to-one matching $M_t$ of predicted to true instances is found by linear assignment, maximising the number of pairs with $\mathrm{IoU}\ge t$. Then

$$\mathrm{AP}_t=\frac{\mathrm{TP}_t}{\mathrm{TP}_t+\mathrm{FP}_t+\mathrm{FN}_t},\qquad \mathrm{TP}_t=\sum_{(i,j)\in M_t}\mathbf{1}[\mathrm{IoU}_{ij}\ge t],$$

where FP is the number of unmatched predicted instances and FN the number of unmatched true instances. The estimand is a per-image score in $[0,1]$ in which every instance has equal weight; images are then averaged with equal weight. A pair exactly at $t$ counts as a match.

**Boundary sensitivity (derived here).** For concentric discs of radii $r$ and $r+\delta$,

$$\mathrm{IoU}=\left(\frac{r}{r+\delta}\right)^2\approx 1-\frac{2\delta}{r}\qquad(\delta\ll r).$$

A radius of 5 px with a 1 px error gives IoU 0.69: it passes $t=0.5$ and fails $t=0.75$. At 10 px the IoU is 0.83. Small nuclei therefore fail high thresholds on one-pixel errors even when every object is detected. The result is exact only for idealised discs and to first order in $\delta/r$.

**Transcript agreement.** For a truth partition $a$ and a predicted partition $b$ of the same transcripts, let $n_{ij}$ be the number of transcripts shared by truth cell $i$ and predicted cell $j$, $a_i$ and $b_j$ the marginal counts and $n$ the total:

$$\mathrm{ARI}=\frac{\sum_{ij}\binom{n_{ij}}{2}-E}{\tfrac12\Bigl[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}\Bigr]-E},\qquad E=\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}.$$

ARI is 1 for identical partitions and about 0 for random ones. Its estimand is chance-corrected agreement of transcript-to-cell membership, with each transcript weighted equally, so large cells dominate. Unassigned transcripts (label 0) form a cluster in both partitions, so the score depends on how many transcripts are unassigned; that count is reported with every value.

**Learned instance models.** StarDist predicts, per pixel, an object probability and $n=32$ radial distances. The polygon is $\{x+d_k(x)(\cos\theta_k,\sin\theta_k)\}_{k=1}^{32}$ with $\theta_k=2\pi k/32$, and candidates above a probability threshold are kept after overlap-based suppression. This is valid for objects that are star-convex about their centre pixel; elongated or strongly concave cells are approximated poorly. Cellpose predicts a flow field $\mathbf{v}$ toward each cell centre and a cell probability. Pixels are advected, $x^{(k+1)}=x^{(k)}+\mathbf{v}(x^{(k)})$ for $k<\mathrm{niter}$, and endpoints are clustered into masks kept when the cell probability exceeds cellprob_threshold and the flow error is below flow_threshold. Only this structure is written here; the step rule is an implementation detail of the package. The regime is roughly centre-convergent cells near the training scale; the repository advises cells under about 100 px across.

**Heuristic watershed.** With $F=\{I\ge t\}$, distance $D(x)=\min_{y\in\mathrm{bg}}\lVert x-y\rVert_2$ and markers $M=\{x\in F:\,D(x)=\max_{N_{5\times5}(x)}D\}$, the labels are $L=\mathrm{watershed}(-D,\,M,\,\mathrm{mask}=F)$. When $t$ is unset it is Otsu's threshold [R9]. The estimand is the instance partition of $F$. It is valid for well-separated nuclei with a shape neck between touching ones and a single threshold that holds over the tile; strong illumination gradients break the global threshold, so dim regions are lost or merged.

**Fixed-radius expansion.** Each nucleus is grown by $r$ pixels into unlabelled foreground without overlap, approximating the cell boundary. It ignores cell shape, so it over-covers elongated sparse cells and under-covers large ones. It has no default radius here; the radius is swept on a split separate from test data (section 8).

**Ground truth.** Manual masks are a proxy for the true boundary, and annotation noise caps the AP any method can reach. Transcript truth is the cell of origin, which is observed only in simulation (section 8).

**Why model-based.** A learned instance model fits a conditional distribution of masks given pixels and reuses one weight set across tissues of the same stain. A watershed has no objective to fit, so its threshold and footprint cannot be calibrated against truth. A model-based formulation adds an explicit probability per instance that can be recalibrated (section 5). Pixel AP and transcript ARI reward different things and need not agree, so section 8 reports both.

**Failure modes.**

- Learned models assume that test tissue resembles training tissue in stain, magnification and cell size. A fluorescence model applied to H&E gives poor masks without an error.
- Heuristics fail under uneven illumination and on touching nuclei without a neck.
- Thick or out-of-focus sections, and 2D projection of 3D stacks, merge or split instances and lose overlap information.
- Expansion over-covers elongated cells and under-covers large ones.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Cellpose (flow model; current default cpsam_v2) | model-based | Network predicts flows toward cell centres and a cell-probability map; pixels are advected and clustered into masks | [R1], [R2] |
| StarDist (2D_versatile_fluo) | model-based | Per-pixel object probability and 32 radial distances; candidates pruned by polygon overlap | [R3] |
| Squidpy distance watershed | heuristic | Otsu foreground, distance-map maxima as markers, flooding of the negative distance | section 12 |
| Baysor | model-based, transcript-driven | Bayesian segmentation of molecule positions and gene composition, with or without a prior segmentation | [R6] |
| Proseg | model-based, transcript-driven | Probabilistic voxel assignment with a compactness prior, sampled by MCMC; can start from Cellpose masks | [R5] |
| segger | model-based, learned, transcript-driven | Heterogeneous graph neural network that frames segmentation as transcript-to-cell link prediction, optionally using single-cell RNA-seq | [R7] |

Cellpose and StarDist are the learned instance standards, and the squidpy watershed is the heuristic standard kept as comparator. Baysor, Proseg and segger refine boundaries from molecules; they are comparators here and are developed in transcript_cell_assignment. Mesmer is not listed (section 10). The expansion baseline of section 3 is not tabulated because it has no default radius. Routes for each method are in section 12.

| Method | Parameter | Value | Source |
|---|---|---|---|
| Cellpose | flow_threshold | 0.4 | cellpose/models.py:169 @ a54cb48 |
| Cellpose | cellprob_threshold | 0.0 | cellpose/models.py:169 @ a54cb48 |
| Cellpose | min_size | 15 px | cellpose/models.py:170 and :202 @ a54cb48 |
| Cellpose | niter | automatic (None) | cellpose/models.py:171 @ a54cb48 |
| Cellpose | resample | true | cellpose/models.py:167 @ a54cb48 |
| Cellpose | batch_size | 8 | cellpose/models.py:167 @ a54cb48 |
| Cellpose | diameter | None; not set by the OpenProblems wrapper | cellpose/models.py:168; src/methods/cellpose/config.vsh.yaml @ bdf3d5d |
| Cellpose | pretrained model | cpsam_v2 | cellpose/models.py:104 @ a54cb48 |
| Cellpose | OpenProblems wrapper | channel 0 only; test-only values diameter 30, flow 0, niter 10, min_size -1, resample false | src/methods/cellpose/script.py and config.vsh.yaml @ bdf3d5d |
| StarDist | n_rays | 32 | stardist/models/model2d.py:198 @ e80c6de |
| StarDist | model | 2D_versatile_fluo | src/methods/stardist/config.vsh.yaml @ bdf3d5d |
| StarDist | prob_thresh, nms_thresh | — | stardist/models/model2d.py:521-522 @ e80c6de (values in model config) |
| StarDist | input normalisation | percentiles 1 and 99.8 of channel 0 | src/methods/stardist/script.py @ bdf3d5d |
| Watershed | threshold | Otsu when unset | src/squidpy/im/_segment.py:229-230 @ f030690 |
| Watershed | geq | true (mask = I >= threshold) | src/squidpy/im/_segment.py:225 and 231 @ f030690 |
| Watershed | marker footprint | 5 x 5 ones | src/squidpy/im/_segment.py:233 @ f030690 |
| Baysor (B1) | min_molecules_per_cell | 50 | src/methods/baysor/config.vsh.yaml @ bdf3d5d |
| Baysor (B1) | prior segmentation key | nucleus_labels | src/methods/baysor/config.vsh.yaml @ bdf3d5d |
| segger (B1) | init_segmentation | auto: cell_id when present, else Cellpose on morphology | src/methods/segger/config.vsh.yaml @ bdf3d5d |
| Proseg (B3) | prior input | registered mask array, such as Cellpose masks | README, "Initializing using Cellpose masks" @ 4caa6f3 |

## 5. Proposed singlet approach

The proposed default is cellpose with its model pinned to cpsam_v2 and recorded in uns/segmentation. The watershed is the training-free baseline. Both are scored in section 8 against each other and against the comparators.

1. **Learned default.** Network inference in PyTorch with the pretrained weights. Flow dynamics, mask clustering and the size filter execute as CUDA kernels, with a CPU path that performs the same steps.
2. **Calibrated confidence.** Each cell receives a probability that it matches a true cell at IoU 0.5, from temperature scaling of the cell probability, fitted on planted tiles (B3) and checked on manual masks (B2). The model-based claim is falsified if expected calibration error on B2 exceeds 0.05, a proposed threshold.
3. **Heuristic baseline.** The watershed is implemented in C++ on the CPU, with Otsu thresholding, the distance transform, marker detection and flooding. It has no learned weights and no GPU path; its cost grows with the foreground pixel count.

The default is kept only if cellpose beats the watershed on B2 in AP at 0.75, with a paired confidence interval excluding zero on most platforms. Otherwise the watershed becomes the default. This is the falsification test for the model-based route.

The ML stack is PyTorch for the network, which is the deep part of the method. Hard-coded CUDA covers the decode and the IoU matrix for AP, which are data-parallel and memory-bound; linear assignment for matching runs on the CPU. cuSPARSE is not needed in this task because no transcript aggregation occurs here. Whole slides are processed as overlapping tiles, with overlap set by the implementation; streaming over a whole slide is not claimed.

Defaults an agent should use without asking: method cellpose, model cpsam_v2, automatic diameter, flow_threshold 0.4, cellprob_threshold 0.0, min_size 15 px, nuclear_channel DAPI, device auto, and a membrane channel whenever one is present. Without a membrane channel, cell instances equal nuclear instances.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | images/<name> | numeric array, channels by Y by X | registered stain image in global coordinates; the nuclear channel is chosen by nuclear_channel |
| write | labels/nucleus_instances | int32 | one ID per nucleus; 0 is background |
| write | labels/cell_instances | int32 | one ID per cell; the ID matches the nucleus ID when that nucleus lies in the cell |
| write | shapes/cell_boundaries | polygons | outline of each cell instance |
| write | obs/cell_area | float32 | mask area in $\mu$m$^2$: pixel count times pixel area from the image transform |
| write | obs/nucleus_area | float32 | nucleus mask area, same convention |
| write | obs/cell_confidence | float32 | calibrated probability that the cell matches a true cell at IoU 0.5 |
| write | obsm/spatial | float64, n by 2 | centroid of each cell instance in global coordinates |
| write | uns/segmentation | dictionary | method, model name, parameters, device and version |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "cellpose" | `cellpose`, `watershed` | Segmentation method. cellpose is the learned default; watershed is the training-free baseline. |
| `nuclear_channel` | string | "DAPI" | — | Channel of the stain image used to find nuclei, named as stored under images/<name>. |
| `membrane_channel` | string/null | null | — | Optional membrane or cytoplasm channel for whole-cell masks; null makes cell instances equal nuclear instances. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return the estimated time, memory and device without segmenting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `cellpose` | object | — | — | Options for method cellpose; rejected when method is watershed. |
| `cellpose.model` | string | "cpsam_v2" | — | Pretrained model name; the pinned default is recorded in uns/segmentation. |
| `cellpose.diameter_px` | number/null | null | — | Expected cell diameter in pixels; null estimates it from the image. |
| `cellpose.flow_threshold` | number | 0.4 | min 0 | Maximum flow error for a kept mask. |
| `cellpose.cellprob_threshold` | number | 0.0 | — | Cell-probability cut; pixels below it do not form masks. |
| `cellpose.min_size_px` | integer | 15 | — | Discard masks smaller than this many pixels; -1 disables the filter. |
| `cellpose.niter` | integer/null | null | min 1 | Flow dynamics iterations; null uses the package's automatic value. |
| `cellpose.resample` | boolean | true | — | Apply flow dynamics at the original image size rather than a resampled size. |
| `cellpose.batch_size` | integer | 8 | min 1 | Tiles per network batch. |
| `watershed` | object | — | — | Options for method watershed; rejected when method is cellpose. |
| `watershed.threshold` | number/null | null | — | Foreground threshold on the nuclear channel; null uses Otsu's method. |
| `watershed.footprint` | integer | 5 | min 1 | Side in pixels of the square footprint that finds distance maxima. |
<!-- PARAMS:AUTO:END -->

Options are nested. Cellpose options apply only when method is cellpose, and watershed options only when method is watershed; the other object is rejected. A null diameter_px means automatic estimation; a value applies to every tile of the dataset. A membrane channel enables whole-cell masks for cellpose. Channel names must exist under images/<name>. dry_run reports time and memory for the chosen device and writes nothing. overwrite replaces only the members listed in writes. Changing the model name changes the outputs, and the name is recorded.

## 7. MCP tool

Tool `singlet_spatial_preproc_image_cell_segmentation` (definition in `tasks/mcp/singlet_spatial_preproc_image_cell_segmentation.json`). Example call and compact result:

```json
{"dataset": "/data/xenium_brain.singlet", "method": "cellpose", "nuclear_channel": "DAPI", "membrane_channel": "membrane", "cellpose": {"model": "cpsam_v2"}}
{"dataset": "/data/xenium_brain.singlet", "status": "completed", "wrote": ["labels/cell_instances", "labels/nucleus_instances", "shapes/cell_boundaries", "obs/cell_area", "obs/cell_confidence", "obs/nucleus_area", "obsm/spatial", "uns/segmentation"],
 "summary": {"method": "cellpose", "model": "cpsam_v2", "n_nuclei": "<int>", "n_cells": "<int>", "cells_without_nucleus": "<int>", "median_cell_area_um2": "<float>", "device": "cuda"}, "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: when the dry-run estimate exceeds the inline limit, the call returns status queued with a job_id. Stochastic: no; with the pinned model and device the output is deterministic up to floating-point effects on GPU. Dry run: returns seconds, peak memory in GB and device without writing members.

## 8. Benchmarks

Shared protocol. All image methods receive the nuclear channel and, when present, the membrane channel from the same registered image. Three-dimensional stacks are projected to 2D by a maximum over z, and the projection is recorded. Instance matching and AP follow section 3; transcript ARI uses the kept-transcript rule of section 3. Every score is reported with its number of images or transcripts. Timing uses three replicates with fixed thread count, batch size and tile size, and records device and model version. The heuristic comparator's threshold and radius are set on a split separate from test data.

### B1. OpenProblems transcript-level ARI on Xenium resources (published)

- **Goal**: score whether each transcript falls in the same cell as in held-out labels.
- **Ground truth**: per-cell labels held out from the resource (groundtruth_cell_labels in the OpenProblems format); the vendor cell_labels field is separate. Estimand: each transcript's truth label at its position after transform (nearest pixel, clipped), then ARI over transcripts with a non-zero truth or prediction label.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Xenium V1 fresh-frozen mouse brain, replicate 1 (OpenProblems combined resource) | 10x Genomics dataset | Xenium V1 transcripts and images, mouse brain, size — | — |
| Xenium Prime 5K FFPE human cervical cancer (ground-truth annotated resource) | 10x Genomics dataset | Xenium Prime 5K FFPE, human cervical cancer, size — | Ground-truth labels from the OpenProblems loader tenx_xenium_groundtruth |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI over transcripts | Equation of section 3 on kept transcripts | maximise, −1 to 1 | primary | [R8] |

- **Comparators**: controls (true labels, random Voronoi partition, empty labels; bounds taken from implementation output); cellpose (cpsam_v2); StarDist (2D_versatile_fluo); squidpy watershed (f030690); Baysor (cpp at 619f09d; prior nucleus labels; minimum 50 molecules per cell); Proseg; segger (default initialisation).
- **Protocol**: apply each method to the unlabelled spatial input (channel 0 for image methods, transcripts for transcript methods), write a label image, and compute ARI in the solution coordinate system. Report each dataset with its kept-transcript count. segger reads the vendor cell_id column in its auto and transcript_cell_id initialisation modes.
- **Acceptance criterion**: a method beats a comparator on a dataset if the paired difference in transcript ARI has a 95% bootstrap confidence interval above zero (1,000 transcript resamples, proposed).
- **Known pitfalls**: where the truth is vendor-derived, a method that reproduces the vendor segmentation scores high by construction. segger's automatic initialisation uses the vendor cell ID when present, so its score is not comparable.

### B2. TissueNet instance-mask accuracy (published)

- **Goal**: measure pixel-mask accuracy for nuclear and whole-cell instances against paired manual annotations.
- **Ground truth**: expert manual annotation of nuclear and whole-cell instances. Estimand: per-image AP at each IoU threshold (section 3), averaged over images with equal weight.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| TissueNet (introduced with Mesmer) | Greenwald et al. [R4] | paired nuclear and whole-cell annotations; more than one million annotated cells as reported in [R4] | Held-out partition as defined by the source (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AP at IoU 0.5, 0.75 and 0.9 | One-to-one matching of pairs with IoU at or above t, per image; mean over images | maximise, 0 to 1 | primary | [R1] |

- **Comparators**: cellpose (cpsam_v2); StarDist (2D_versatile_fluo); squidpy watershed (f030690); fixed-radius expansion with its radius set on a separate split.
- **Protocol**: score the held-out images of the source's test partition at the pixel size in the source metadata. Score nuclear and whole-cell masks separately. Report per platform and per organ, with paired bootstrap over images (1,000 resamples, proposed). No per-dataset tuning.
- **Acceptance criterion**: proposed design criterion. A method is accepted if, on most platforms, the 95% paired-bootstrap interval for its AP at 0.5 difference from the best comparator excludes zero.
- **Known pitfalls**: stains in the source need not match the DAPI and membrane channels of transcript panels, so a score here does not transfer by itself. AP at 0.75 and 0.9 is dominated by one-pixel errors on small nuclei (section 3).

### B3. Planted simulation for stain images and transcripts (proposed)

- **Goal**: test segmentation against exact planted identities across density, size, overlap and noise, which real data cannot give.
- **Ground truth**: planted cell and nucleus masks and transcript identities, background 0. Estimand: per-tile AP against planted masks, and per-tile transcript ARI against planted identities.
- **Generator recipe** (values are set before the sweep):
  1. Sample cell centres from a Poisson point process with intensity $\lambda$.
  2. Draw each cell as a star-convex nucleus and cell with radii in $[r_{\min},r_{\max}]$.
  3. Draw per-cell gene profiles from catalogue cell types, fixed before the sweep.
  4. Sample transcript counts per cell from a Poisson or negative-binomial rate set by the sweep.
  5. Move a fraction $p_m$ of transcripts to a neighbouring cell and apply a diffusion scale.
  6. Render nuclear and membrane images by blurring masks with a point-spread sigma and adding Poisson noise.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Planted tiles | generator recipe above | simulated stain pair and transcripts | No real data |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AP at IoU 0.5, 0.75 and 0.9 | As in B2, matched to planted masks | maximise | primary | [R1] |
| Transcript ARI | As in B1, against planted identities | maximise | primary | [R8] |

- **Comparators**: cellpose (cpsam_v2); StarDist; squidpy watershed; Proseg with Cellpose masks as prior (prior-consistency check).
- **Protocol**: sweep the four factors on a grid fixed beforehand, reporting each metric against each factor, with three seeds and the tile size of B2.
- **Acceptance criterion**: proposed. A method is credible if its AP at 0.5 on simulated tiles lies within a margin, fixed before the sweep, of its AP at 0.5 on B2.
- **Known pitfalls**: a generator from the same model family as a comparator, such as Proseg's cell-simulation model, favours that comparator by construction. Clean stains make every method look good, so the grid includes degraded noise.

### P1. Performance and scaling

Ladder: planted tiles from the B3 recipe with $10^4$, $10^5$ and $10^6$ cells, one tile size per rung. Metrics: wall time, CPU time, peak memory per device and cells per second. Comparators: cellpose on GPU and CPU, StarDist on GPU and CPU, watershed on CPU. Hold fixed: thread count (reported), batch size 8, tile size, device and model version, with three replicates. Acceptance (proposed, fixed before measurement): the fitted log-log slope of wall time against cell count is at most 1.2 for both cellpose and the watershed. Streaming is not claimed, so no $10^7$ rung is planned.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-registration.image_coordinate_registration`: Same-section image and cross-platform coordinate registration
- **Feeds**:
  - `spatial-preproc.transcript_cell_assignment`: Transcript-to-cell assignment and boundary inference
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `spatial-preproc.overlapping_cell_detection`: Overlapping-cell (spatial doublet) and segmentation-integrity detection in imaging-based spatial transcriptomics
- **Reads**: `images/<name>`
- **Writes**: `labels/cell_instances`, `labels/nucleus_instances`, `shapes/cell_boundaries`, `obs/cell_area`, `obs/cell_confidence`, `obs/nucleus_area`, `obsm/spatial`, `uns/segmentation`
<!-- CHAINING:AUTO:END -->

Used in spatial preprocessing of imaging and sequencing panels, before transcript-to-cell assignment and unit quality control.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The Mesmer application code, its default resolution and its post-processing were not read, and the Mesmer paper is cited from its summary only. The TissueNet accession, platform list and split were not read. The probability and NMS thresholds of 2D_versatile_fluo are stored in model files and were not read. The training corpus of cpsam_v2 was not read, so overlap with TissueNet test images cannot be excluded; the terms of the pretrained weights were not read either.
- **Unsettled literature.** The 2025 Nature Methods paper on the segmentation challenge [R10], listed in the Proseg README, was not read. An admixture audit on real crops was left out because the code of its metric tool was not read. The vendor's cell-segmentation algorithm and its default expansion radius are not documented in the sources read.
- **Data risks.** The sizes and access terms of the two OpenProblems datasets were not read. Code routes are in section 12.
- **Technical risks.** Unpinned Cellpose installs drift when the default model changes, so the pin in the tool is required. StarDist's fluorescence model gives poor masks on H&E. Behaviour of Cellpose on 3D stacks and on H&E was not read, and projection to 2D loses overlap information.
- **Definition.** Cell and nucleus units differ across methods, so cross-method comparisons use the shared definition in section 8, and nucleus and cell labels are scored separately.
- **First experiment.** Apply cellpose (cpsam_v2) and the watershed to the planted tiles at the three densities with three seeds, fixing the grid and the watershed threshold on a separate split before any test image is scored. Then score B2 on the same settings.

## 11. References

R1. Stringer C, Wang T, Michaelos M, Pachitariu M. Cellpose: a generalist algorithm for cellular segmentation. *Nature Methods* 2021;18:100–106. doi:10.1038/s41592-020-01018-x — verified (search)
R2. Pachitariu M, Rariden M, Stringer C. Cellpose-SAM: superhuman generalization for cellular segmentation. *bioRxiv* 2025. doi:10.1101/2025.04.28.651001 — verified (repo)
R3. Schmidt U, Weigert M, Broaddus C, Myers G. Cell detection with star-convex polygons. *MICCAI 2018*, Part II. doi:10.1007/978-3-030-00934-2_30 — verified (corpus)
R4. Greenwald NF, Miller G, Moen E, et al. Whole-cell segmentation of tissue images with human-level performance using large-scale data annotation and deep learning. *Nature Biotechnology* 2022;40:555–565. doi:10.1038/s41587-021-01094-0 — verified (search)
R5. Jones DC, Elz AE, Hadadianpour A, Ryu H, Glass DR, Newell EW. Cell simulation as cell segmentation. *Nature Methods* 2025. doi:10.1038/s41592-025-02697-0 — verified (repo)
R6. Petukhov V, Xu RJ, Soldatov RA, Cadinu P, Khodosevich K, Moffitt JR, Kharchenko PV. Cell segmentation in imaging-based spatial transcriptomics. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-01044-w — verified (repo)
R7. Heidari E, Moorman A, et al. Segger: fast and accurate cell segmentation of imaging-based spatial transcriptomics data. *bioRxiv* 2025. doi:10.1101/2025.03.14.643160 — verified (repo)
R8. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R9. Otsu N. A threshold selection method from gray-level histograms. *IEEE Transactions on Systems, Man, and Cybernetics* 1979. — unverified (memory)
R10. Confronting the challenge of cell segmentation in spatial transcriptomics. *Nature Methods* 2025. doi:10.1038/s41592-025-02717-z — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/mouseland/cellpose | Marius Pachitariu and Carsen Stringer (setup.py); HHMI copyright 2020 | BSD-3-Clause (LICENSE file and setup.py); README badge says GPL v3 and disagrees with both | proposed default; flow dynamics, mask decode and AP metric | port |
| https://github.com/stardist/stardist | Uwe Schmidt and Martin Weigert (LICENSE.txt copyright, 2018–2025) | BSD-3-Clause (LICENSE.txt) | learned comparator (B1–B3) | callout |
| https://github.com/scverse/squidpy | Theis Lab (copyright 2021, LICENSE header) | BSD-3-Clause (LICENSE) | heuristic baseline; watershed code | port |
| https://github.com/vanvalenlab/deepcell-tf | Van Valen Lab (repository owner) | modified Apache 2 (README); LICENSE file is Apache-2.0 text | source of the TissueNet definition; Mesmer not applied | callout |
| https://github.com/dcjones/proseg | Daniel C. Jones (Cargo.toml; LICENSE.md copyright 2024) | GPL-3.0 (LICENSE.md) | prior-consistency comparator (B3) | callout |
| https://github.com/kharchenkolab/Baysor | Viktor Petukhov and Peter Kharchenko (LICENSE copyright 2020) | MIT (LICENSE) | transcript comparator (B1) | callout |
| https://github.com/dpeerlab/segger | Elyas Heidari, Andrew Moorman et al. (pyproject.toml) | MIT in pyproject.toml; no LICENSE file at the repository root | transcript comparator (B1) | callout |
| https://github.com/openproblems-bio/task_spatial_segmentation | Romanovskaia D, Heyl F, Cannoodt R et al. (README) | MIT (LICENSE) | benchmark definition for B1 | callout |
