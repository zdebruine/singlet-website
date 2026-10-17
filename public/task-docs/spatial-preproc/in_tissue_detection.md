---
id: spatial-preproc.in_tissue_detection
title: In-tissue region detection for sequencing-based spatial data
area: spatial-preproc
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [spatial-registration.image_coordinate_registration]
feeds: [spatial-preproc.spatial_unit_qc_filtering, spatial-domains.single_slice_domains, spatial-deconv-mapping.spot_celltype_proportions]
reads: [obs/in_tissue, obsm/spatial, layers/counts, obs/pct_counts_mt, uns/spatial/<library_id>/images/hires]
writes: [obs/in_tissue, obs/in_tissue_prob, obs/artifact_local, uns/in_tissue, uns/spatial/<library_id>/tissue_mask, models/in_tissue_weka]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_preproc_in_tissue_detection
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# In-tissue region detection for sequencing-based spatial data

> Assigns each spot or bin to tissue or background from the registered histology image, optionally with count evidence, a probability and local-artefact flags, and writes the flag that downstream steps use.

## 1. Question

Which spots or bins lie on tissue, and which are background, edge, fold or tear artefacts? The input is a histology image registered to a spot or bin lattice, with optional total UMI and mitochondrial fraction per unit. The output is a binary in-tissue flag per unit, an optional probability and optional local-artefact flags. A correct answer agrees with a consensus expert outline at the centre pixel of each unit, and the rule for edge and artefact units is fixed before evaluation.

## 2. Why this task matters and where the field stands

**Contested.** The step is routine in use but disputed at the boundary. Visium pipelines store an in-tissue flag for every barcode, and most downstream code reads it without checking the outline. The flag comes from Space Ranger's automatic detector, which is not in the cellranger repository (section 12).

Open image methods are the published alternatives. Otsu thresholding [R1] is the simplest; graph superpixels [R2] and a random forest trained on self-generated seeds, in the style of trainable segmentation [R3], are implemented in squidpy [R4]. Count rules borrowed from deconvolution pre-processing [R5] treat low total UMI as background; they are a proxy, not a detector. Artefact detection is handled by SpotSweeper [R6], which flags regional outliers in mitochondrial variance rather than folds or tears.

The evidence gaps are listed in section 10.

## 3. Theory and insight

**Notation.** Units $i=1,\dots,N$ have centres $c_i$ in full-resolution pixel coordinates. The image $I(p)$ is one grey-level channel on pixel grid $\Omega$. The tissue mask $M\subseteq\Omega$ gives the unit flag $\hat y_i=\mathbf 1[c_i\in M]$. The expert consensus $G$ is the pixel-wise majority of annotator masks. $n_i$ is total UMI and $m_i$ the mitochondrial fraction.

**Estimands and normalisation.** Each output and ground-truth quantity is defined as follows.

- Unit flag $\hat y_i$: indicator that the centre pixel lies in $M$; no normalisation.
- Unit probability $\hat p_i$: target $P(y_i=1\mid I)$ for the centre pixel; calibration is claimed only where stated below.
- Ground-truth label $y_i=\mathbf 1[c_i\in G]$: consensus value at the centre pixel, with ties counted as tissue.
- Mask Dice and IoU: pixel-count ratios on one evaluation grid with the frame removed, computed per section and averaged over sections with equal weight.
- Artefact flag: indicator per unit whose estimand is the planted label of section 8, not tissue status.

**Threshold family.** For grey levels $t$ with class probabilities $\omega_0(t),\omega_1(t)$ and class means $\mu_0(t),\mu_1(t)$, Otsu's threshold maximises between-class variance:

$$\sigma_B^2(t)=\omega_0(t)\,\omega_1(t)\,\bigl[\mu_0(t)-\mu_1(t)\bigr]^2,\qquad t^{*}=\arg\max_{t}\,\sigma_B^2(t).$$

It is valid for a bimodal histogram and treats pixels as independent, so spatial structure enters only through the polarity rule. The polarity is set by comparing the mean grey level of the corner boxes with the image median. Because the fitted threshold ignores position, frame and slide pixels in the tissue grey range are foreground unless they are excluded before fitting. Histogram accumulation and 256 candidate thresholds give a cost of $O(P+256)$ for $P$ pixels.

**Graph family.** Felzenszwalb and Huttenlocher's predicate keeps two components $C_1,C_2$ apart when

$$D(C_1,C_2)=\mathbf 1\Bigl[\mathrm{Dif}(C_1,C_2)>\min\bigl(\mathrm{Int}(C_1)+\tau(C_1),\,\mathrm{Int}(C_2)+\tau(C_2)\bigr)\Bigr],\quad \mathrm{Int}(C)=\max_{e\in\mathrm{MST}(C)}w(e),\quad \tau(C)=k/|C|,$$

where $\mathrm{Dif}$ is the smallest grey difference across the edges between the components and $w(e)$ is the grey difference along edge $e$. The scale $k$ fixes the preferred region size. Sorting $E$ edges and merging with union-find costs $O(E\log E)$. The grey image is Gaussian-smoothed first, so the result depends on the blur as well as on $k$. The regime is greedy merging on a smoothed image: stain variation inside tissue splits regions, and weak contrast at the boundary merges tissue with background.

**Seeded forest family.** Corner pixels are background seeds, non-corner pixels above the 90th percentile of distance from background are tissue seeds, and all other pixels are unlabelled and excluded from training. The forest probability averages $B$ trees:

$$\hat p(y_p=\mathrm{tissue}\mid x_p)=\frac1B\sum_{b=1}^{B}\hat p_b(y_p=\mathrm{tissue}\mid x_p).$$

The rule is valid only when corner pixels are truly background; when tissue reaches the corners the corner seeds are then wrong. The average of tree votes is not a calibrated posterior, and its values depend on the seed percentile and tree count. Pixels excluded by the border margin become background seeds, so the fiducial ring is treated as background rather than tissue.

**Count family.** RCTD keeps a unit when its total UMI lies in a band $[n_{\min},n_{\max}]$ and its counts over the selected genes clear a threshold. Used as a background proxy, the call is $\hat y_i=\mathbf 1[n_{\min}\le n_i\le n_{\max}]$. It is exact as a pixel-retention rule but is not a classifier. It assumes background units fall below $n_{\min}$ and tissue units lie above it, which fails for low-RNA tissue and for background rich in ambient RNA.

**Proposal (not from the literature).** A two-component mixture on log total UMI gives a per-unit posterior that could serve as a spatial prior:

$$\log n_i\sim\pi\,\mathcal N(\mu_t,\sigma_t^2)+(1-\pi)\,\mathcal N(\mu_b,\sigma_b^2),\qquad P(y_i=1\mid n_i)=\frac{\pi\,\phi_t(\log n_i)}{\pi\,\phi_t(\log n_i)+(1-\pi)\,\phi_b(\log n_i)}.$$

It requires separated log-count components, ignores position, and is untested on Visium. It appears here only as a candidate for the count comparator in section 8.

**Overlap metrics.** For predicted mask $P$ and reference mask $G$ on one grid,

$$\mathrm{Dice}(P,G)=\frac{2\,\lvert P\cap G\rvert}{\lvert P\rvert+\lvert G\rvert},\qquad \mathrm{IoU}(P,G)=\frac{\lvert P\cap G\rvert}{\lvert P\cup G\rvert}=\frac{\mathrm{Dice}(P,G)}{2-\mathrm{Dice}(P,G)}.$$

Both masks must share the grid and the frame must be removed first. Both empty gives 1 by definition.

**What a model adds.** The heuristics return a threshold, a partition, a vote fraction or a count band, and none carries an uncertainty. A probabilistic unit model gives a posterior that can be calibrated on held-out sections, quantifies disagreement between annotators, is reused on new sections without refitting the image rule, and accepts covariates such as counts, mitochondrial fraction and neighbourhood labels. The heuristics remain comparators and defaults until a benchmark shows a gain.

**Failure modes by family.** Thresholds fail under uneven illumination, faint stain and dark backgrounds. Graph and forest methods fail when stain varies within tissue or tissue touches the image corners. Count rules fail at low-RNA tissue and sparse edges. Local-variance artefact rules can confuse high-mitochondrial biology at the tissue edge with technical damage. Registration error affects every family equally, because each one assigns labels by position on the lattice.

**Insight.** In-tissue detection is an image segmentation problem with a weak spatial prior, and its hard cases are boundaries, folds and frames. Global thresholds work when the background is uniformly bright and the stain is strong. Count data is independent evidence, since background units tend to have low UMI, but it is confounded by low-RNA tissue and sparse edges, so it is a secondary signal rather than a detector. The Space Ranger flag is an automatic label: it is a comparator and a weak label, never the evaluation truth.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Space Ranger automatic detection | heuristic | Aligns the H&E image to the fiducial frame and writes a per-barcode in-tissue flag; the detector is not in the cellranger repository (section 12) | — |
| Flag consumer filter | heuristic | Keeps barcodes whose flag is positive; reads no image | — |
| Otsu with corner polarity | heuristic | One grey threshold with polarity from corner means, then area and hole filters | [R1], [R4] |
| Felzenszwalb superpixels | heuristic | Superpixels of a smoothed grey image, each kept or dropped by an Otsu threshold on its mean grey level | [R2], [R4] |
| Seeded random forest | hybrid | Multiscale pixel features; corner and high-distance pixels as seeds; unlabelled pixels excluded | [R3], [R4] |
| Count band | heuristic | Keeps units whose total UMI lies in a band; RCTD also requires counts over its DE gene list to clear a threshold, which count_band omits | [R5] |
| Local-variance artefacts | heuristic | Local variance of log mitochondrial fraction over hexagonal neighbourhoods of orders 1 to n_order, PCA, then two-cluster k-means; the lower-variance cluster is the artefact | [R6] |

The published standard for Visium is the Space Ranger flag, which most downstream code reads without change. The open image methods are squidpy's three detectors, of which Otsu is the default. The count band comes from deconvolution pre-processing and serves as a proxy. Local-variance artefact detection is SpotSweeper's. Because this document cites no benchmark of any of these against expert outlines, the image defaults are kept as comparators.

| Method | Parameter | Value | Source |
|---|---|---|---|
| squidpy Otsu | method | OTSU | scverse_squidpy/src/squidpy/experimental/im/_detect_tissue.py:176 @ f030690 |
| squidpy Otsu | corners_are_background | True | _detect_tissue.py:179 @ f030690 |
| squidpy Otsu | corner_size_pct | 0.01 | _detect_tissue.py:180 @ f030690 |
| squidpy Otsu | border_margin_px | 0 | _detect_tissue.py:181 @ f030690 |
| squidpy Otsu | min_specimen_area_frac | 0.01 | _detect_tissue.py:182 @ f030690 |
| squidpy Otsu | auto_max_pixels | 5000000 | _detect_tissue.py:184 @ f030690 |
| squidpy Otsu | close_holes_smaller_than_frac | 0.0001 | _detect_tissue.py:185 @ f030690 |
| squidpy Otsu | threshold | skimage threshold_otsu on the float grey image | _detect_tissue.py:530 @ f030690 |
| squidpy Otsu | polarity | bright background when corner mean is at least the image median | _detect_tissue.py:850-865 @ f030690 |
| squidpy Felzenszwalb | grid_rows, grid_cols | 100, 100 | scverse_squidpy/src/squidpy/types.py:25, :28 @ f030690 |
| squidpy Felzenszwalb | sigma_frac | 0.008, clipped to 1 to 5 px | types.py:31; _detect_tissue.py:541 @ f030690 |
| squidpy Felzenszwalb | scale_coef, min_size_coef | 0.25, 0.20 | types.py:34, :37; _detect_tissue.py:546-547 @ f030690 |
| squidpy Felzenszwalb | superpixel mask | Otsu on per-superpixel mean grey, oriented by corner polarity | _detect_tissue.py:795-826 @ f030690 |
| squidpy weka | sigma_min, sigma_max | 1.0, 16.0 | types.py:47, :50 @ f030690 |
| squidpy weka | edges | True | types.py:53 @ f030690 |
| squidpy weka | pseudo_tissue_percentile | 90.0 | types.py:56 @ f030690 |
| squidpy weka | pseudo_min_pixels | 50 | types.py:59 @ f030690 |
| squidpy weka | rf_estimators, rf_max_depth | 100, 10 | types.py:62, :65 @ f030690 |
| squidpy weka | rf_max_samples | 0.05 | types.py:68 @ f030690 |
| squidpy weka | rng, refine_with_classifier | None, True | types.py:71, :74 @ f030690 |
| squidpy weka | seeds | corners as background; excluded border as background; top percentile as tissue | _detect_tissue.py:608-644 @ f030690 |
| squidpy weka | corner requirement | error when no corner is flagged as background | _detect_tissue.py:279-280 @ f030690 |
| squidpy weka test | border_margin_px on its example | 1500 | tests/experimental/test_detect_tissue.py:44 @ f030690 |
| RCTD count band | UMI_min, UMI_max, UMI_min_sigma | 100, 20000000, 300 | dmcable_spacexr/R/spacexr.R:43 @ 9f5dc33 |
| RCTD count band | counts_MIN passed as counts_thresh | 10 | spacexr.R:43 and :78 @ 9f5dc33 |
| RCTD count band | keep rule | nUMI within [UMI_thresh, UMI_max] and gene-list counts at least counts_thresh | dmcable_spacexr/R/SpatialRNA.R:205-209 @ 9f5dc33 |
| SpotSweeper | shape, n_order, log, mito_percent | hexagonal, 5, TRUE, expr_chrM_ratio | MicTott_SpotSweeper/R/findArtifacts.R:57-60 @ 7e6ebf6 |
| SpotSweeper | k-means | 2 centres, nstart 25 | findArtifacts.R:160 @ 7e6ebf6 |
| SpotSweeper | artefact cluster | cluster with lower mean of the 18-neighbour local variance | findArtifacts.R:169-174 @ 7e6ebf6 |
| BayesSpace | in-tissue filter | keeps rows with in_tissue greater than 0 | edward130603_BayesSpace/R/readVisium.R:300 @ ba8b422 |
| Seurat | filter.matrix | TRUE, keeping tissue equal to 1 rows | satijalab_seurat/R/preprocessing.R:1356, :1507-1509 @ 5f67c70 |
| Space Ranger | hires maximum dimension | 2000 px (Visium), 6000 px (Visium HD) | 10XGenomics_cellranger/lib/python/cellranger/spatial/data_utils.py:37-38 @ 669395e |
| Space Ranger | tissue_positions columns | barcode, in_tissue, array_row, array_col, pxl_row_in_fullres, pxl_col_in_fullres | data_utils.py:18-25 @ 669395e |

## 5. Proposed singlet approach

Routes follow section 12. **spaceranger_flag** is a port: it validates the flag and keeps it without opening an image. **otsu** and **felzenszwalb** are ports with the defaults of section 4, the same polarity rule and hole filling, and squidpy stays as the parity comparator. **weka** ports the feature, seeding and forest steps; the forest trains on CPU with a standard tree implementation. **count_band** reimplements the total-UMI part of RCTD's keep rule, with no code copied. **artifact flags** are ports of the local-variance and clustering steps, and the cluster rule is checked on the example before use (section 10). The Space Ranger detector is a **callout**: it cannot be reproduced, so it is a comparator on spot metrics only.

The model-based candidate is a per-unit posterior with spatial smoothing, and it is not yet in the enum. For unit $i$, let $\phi_i=(x_i,\,\log n_i,\,m_i)$, where $x_i$ are image features sampled over the spot footprint. The unit model is $P(y_i=1\mid\phi_i)=\sigma(\beta^\top\phi_i)$. Neighbouring units on a k-nearest-neighbour graph $E$ are coupled by a Potts prior, $p(\mathbf y)\propto\prod_i p_i^{y_i}(1-p_i)^{1-y_i}\exp\{\lambda\sum_{(i,j)\in E}\mathbf 1[y_i=y_j]\}$, with mean-field inference. The model is falsified if it does not beat squidpy Otsu on B1 with a positive paired difference in mean Dice over sections. Training uses expert masks from B1 split by section, planted labels from B2, and Space Ranger flags as weak labels only.

The ML stack is PyTorch for a convolutional network on hires patches, used only if the unit model with smoothing fails B1. Hard-coded CUDA with cuSPARSE covers the per-unit logistic and the neighbour smoothing, since both are small and run for every section. Image methods, connected components, hole filling, distance transforms and the lattice graph run on CPU in the dependency-free core. Streaming does not apply, because one image is processed per call at the scale set by auto_max_pixels.

Defaults an agent uses without asking: spaceranger_flag when obs/in_tissue exists; otherwise otsu with corners enabled, the default auto_max_pixels, and an explicit border margin for Visium frames; artefact flags off unless requested; an explicit seed for weka.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obs/in_tissue | bool | Space Ranger flag; required by spaceranger_flag |
| read | obsm/spatial | float (N by 2) | Unit centres in full-resolution pixels, registered to the image |
| read | layers/counts | sparse int | Raw UMI counts; total UMI for count_band |
| read | obs/pct_counts_mt | float | Mitochondrial percentage for artefact flags |
| read | uns/spatial/<library_id>/images/hires | uint8 image | H&E image at hires scale; not read by flag or count methods |
| write | obs/in_tissue | bool | Output flag of the selected method; off-tissue units are flagged, never removed |
| write | obs/in_tissue_prob | float32 | Forest vote fraction for weka; not calibrated; absent otherwise |
| write | obs/artifact_local | bool | Lower-variance cluster of the local-variance rule; regional, not fold or tear specific |
| write | uns/in_tissue | dict | Method, parameters, scale used, image shape in pixels, singlet version |
| write | uns/spatial/<library_id>/tissue_mask | uint8 | Mask at the recorded scale (optional) |
| write | models/in_tissue_weka | model | Fitted forest (optional) |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "spaceranger_flag" | `spaceranger_flag`, `otsu`, `felzenszwalb`, `weka`, `count_band` | Detector. spaceranger_flag needs obs/in_tissue; image methods need an H&E image; count_band uses total UMI only. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; image methods and weka run on CPU, so auto selects CPU for them. |
| `seed` | integer | 0 | min 0 | Random seed for weka and the artifact k-means; deterministic methods ignore it. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing or writing members. |
| `overwrite` | boolean | false | — | Replace existing obs/in_tissue and related members instead of failing. |
| `artifact_flags` | boolean | false | — | Also write obs/artifact_local using the spotsweeper options; regional artifacts only, not folds or tears. |
| `image` | object | — | — | Options shared by the image methods otsu, felzenszwalb and weka. |
| `image.image_key` | string | "hires" | — | Key of the H&E image under uns/spatial/<library_id>/images. |
| `image.library_id` | string/null | null | — | Library to process; null uses the only library in the dataset and fails when there are several. |
| `image.corners_are_background` | boolean | true | — | Use the four image corners as background seeds and set the background polarity. |
| `image.corner_size_pct` | number | 0.01 | max 1; > 0 | Corner box size as a fraction of image height and width. |
| `image.border_margin_px` | integer | 0 | min 0 | Pixels excluded at every border to mask the fiducial frame; set explicitly on Visium images. |
| `image.min_specimen_area_frac` | number | 0.01 | min 0; max 1 | Smallest kept tissue region as a fraction of the image area. |
| `image.close_holes_smaller_than_frac` | number | 0.0001 | min 0; max 1 | Fill holes smaller than this fraction of the image area. |
| `image.auto_max_pixels` | integer | 5000000 | min 1 | Downscale the image to at most this many pixels before processing; the scale is reported. |
| `felzenszwalb` | object | — | — | Superpixel options for the felzenszwalb method. |
| `felzenszwalb.grid_rows` | integer | 100 | min 1 | Target superpixel grid rows. |
| `felzenszwalb.grid_cols` | integer | 100 | min 1 | Target superpixel grid columns. |
| `felzenszwalb.sigma_frac` | number | 0.008 | min 0 | Gaussian blur as a fraction of the short image side, clipped to 1 to 5 pixels. |
| `felzenszwalb.scale_coef` | number | 0.25 | min 0 | Felzenszwalb scale as a multiple of the target superpixel area. |
| `felzenszwalb.min_size_coef` | number | 0.2 | min 0 | Minimum superpixel size as a multiple of the target superpixel area. |
| `weka` | object | — | — | Random-forest options for the weka method; requires corners_are_background true. |
| `weka.sigma_min` | number | 1.0 | min 0 | Smallest Gaussian scale of the multiscale pixel features. |
| `weka.sigma_max` | number | 16.0 | min 0 | Largest Gaussian scale of the multiscale pixel features. |
| `weka.edges` | boolean | true | — | Include edge-filter responses among the pixel features. |
| `weka.pseudo_tissue_percentile` | number | 90 | min 0; max 100 | Percentile of distance-from-background above which non-corner pixels seed tissue. |
| `weka.pseudo_min_pixels` | integer | 50 | min 1 | Minimum number of tissue seed pixels, taken from the largest distances when short. |
| `weka.rf_estimators` | integer | 100 | min 1 | Number of trees in the random forest. |
| `weka.rf_max_depth` | integer/null | 10 | min 1 | Maximum tree depth; null grows trees without a depth limit. |
| `weka.rf_max_samples` | number | 0.05 | max 1; > 0 | Fraction of seed pixels drawn for each tree. |
| `weka.refine_with_classifier` | boolean | true | — | Run a second-stage classifier that refines the first mask. |
| `count_band` | object | — | — | Total-UMI band for the count_band method; a background proxy only. |
| `count_band.layer` | string | "counts" | — | Layer whose column sums give total UMI per unit. |
| `count_band.count_min` | integer | 100 | min 0 | Units with total UMI below this are called background. |
| `count_band.count_max` | integer | 20000000 | min 1 | Units with total UMI above this are excluded from tissue calls. |
| `spotsweeper` | object | — | — | Local-variance options used when artifact_flags is true. |
| `spotsweeper.n_order` | integer | 5 | min 1 | Number of neighbourhood orders over which local variance is computed. |
| `spotsweeper.shape` | string | "hexagonal" | `hexagonal`, `square` | Lattice neighbourhood shape; hexagonal matches Visium spot geometry. |
| `spotsweeper.log` | boolean | true | — | Apply a log transform to the mitochondrial percentage before local variance. |
<!-- PARAMS:AUTO:END -->

Each method reads only the members it needs, and `artifact_flags` adds `obs/pct_counts_mt`. Options for a method that is not selected are an error. The weka method requires `image.corners_are_background` to be true. Set `image.border_margin_px` on Visium frames, since the default 0 suits only cropped images. The scale chosen by `image.auto_max_pixels` is recorded in `uns/in_tissue`, and any downstream overlay must use that scale.

## 7. MCP tool

Tool name `singlet_spatial_preproc_in_tissue_detection` (definition in `tasks/mcp/singlet_spatial_preproc_in_tissue_detection.json`). Example call:

```json
{"dataset": "/data/visium_section_01.singlet", "method": "otsu", "image": {"border_margin_px": 1500}}
```

Example result, with placeholders where values depend on the dataset:

```json
{"dataset": "/data/visium_section_01.singlet", "status": "completed",
 "wrote": ["obs/in_tissue", "uns/in_tissue", "uns/spatial/<library_id>/tissue_mask"],
 "summary": {"n_units": "<int>", "n_in_tissue": "<int>", "method": "otsu",
             "scale": "<float>", "image_shape_px": ["<int>", "<int>"], "n_artifact_local": null},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: no; one image is processed inline, and runtime limits are set from P1. Stochastic: yes only for weka and the artefact k-means, where the seed fixes both; other methods are deterministic. Dry run: `dry_run` returns seconds, peak memory and device from the image size after the `auto_max_pixels` downscale, without reading unit data.

## 8. Benchmarks

**Shared protocol.** All image methods receive the same hires image, downscaled once by `image.auto_max_pixels`, and the scale is reported. Every method is scored on one evaluation grid at full resolution, with the declared frame and slide-edge margin removed. Methods run at shipped defaults, and `border_margin_px` is set once per slide type and reported. Splits are by section, never by unit. Metrics are computed per section and averaged with equal weight; intervals come from a bootstrap over sections. Stochastic methods run with five seeds and report the median.

### B1. Agreement with expert tissue outlines on Visium H&E (proposed)

- **Goal**: measure how well the mask and unit flags agree with consensus expert outlines.
- **Ground truth**: expert labels. At least two annotators outline tissue on the hires image at one scale; $G$ is the pixel-wise majority, ties counted as tissue, and $y_i=\mathbf 1[c_i\in G]$ at the centre pixel. Pairwise inter-annotator Dice is the ceiling.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Visium CytAssist, Mouse Embryo, 11 mm capture area (FFPE) | [R8] | Visium CytAssist, mouse, — | — | Masks to be created |
| Visium CytAssist, post-Xenium Mouse Brain (FF) | [R9] | Visium CytAssist, mouse brain, — | — | Clean test of edges |
| Visium CytAssist, post-Xenium Human Colon Cancer (FFPE) | [R10] | Visium CytAssist, human, — | — | FFPE folds may differ |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Mask Dice | $2\lvert P\cap G\rvert/(\lvert P\rvert+\lvert G\rvert)$ per section, averaged | higher | primary | [R7] |
| Mask IoU | $\lvert P\cap G\rvert/\lvert P\cup G\rvert$; equals Dice/(2 - Dice) | higher | primary | — |
| Component count difference | $\bigl\lvert\lvert\mathrm{CC}(P)\rvert-\lvert\mathrm{CC}(G)\rvert\bigr\rvert$, 8-connectivity; components under 0.01 percent of the grid dropped | lower | guardrail | — |
| Boundary Hausdorff distance | symmetric maximum of nearest-boundary distances, full-resolution pixels | lower | guardrail | — |
| Unit balanced accuracy | $(\text{sensitivity}+\text{specificity})/2$ over units outside the frame, positive when $c_i\in P$ | higher | primary | — |

- **Comparators**: spaceranger_flag (unit metric only); squidpy Otsu, Felzenszwalb and weka at defaults with the weka seed fixed.
- **Protocol**: two annotators per section; their pairwise Dice is reported beside the methods.
- **Acceptance criterion**: PROPOSED, not from the literature. Mean mask Dice at least 0.95 and unit balanced accuracy at least 0.98 on held-out sections, to be revised once the inter-annotator ceiling is measured. A model-based method replaces squidpy Otsu as image default only with a positive paired mean-Dice gain over sections.
- **Known pitfalls**: using the Space Ranger flag as truth is circular, so the flag is scored only against consensus. Smooth outlines miss small islands, which the component guardrail exposes.

### B2. Planted fold and tear artefacts on real Visium sections (proposed)

- **Goal**: test whether a method flags folds, tears and edge units when their positions are planted.
- **Ground truth**: planted simulation; the generator records one label per unit, and edge labels are a distance rule. Normalisation: per-unit binary labels, one-versus-rest per class.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Real sections of B1 with flags as clean baseline | [R8], [R9], [R10] | Visium, mouse and human, — | — | The flag only defines the clean set |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recall per planted class | fraction of planted units flagged at the default operating point | higher | primary | — |
| Boundary F1 for edge units | F1 of flagged edge units against units within two lattice steps of the planted boundary | higher | primary | — |
| False flag rate | flagged unplanted units over all unplanted units | lower | guardrail | — |

- **Comparators**: local-variance artefact flags; count band (units outside the band flagged).
- **Protocol** (generator; five seeds; one fold and one tear per section per seed):
  1. Take a real section; the clean set is units with flag 1 and no planted label.
  2. Fold: draw a random line across tissue; copy count vectors from one side to mirror positions on the other, binomially thinned with retention $f\sim\mathrm{Uniform}(0.3,0.7)$; label the overwritten units fold.
  3. Tear: choose a strip two lattice steps wide across tissue; replace its count vectors with draws, with replacement, from off-tissue units of the same section; label tear.
  4. Edge: label in-tissue units within two lattice steps of the flagged boundary.
  5. Report the spread across seeds.
- **Acceptance criterion**: PROPOSED, not from the literature. Recall at least 0.90 for planted folds and tears at a false flag rate of at most 0.05. Real folds are checked separately, because planted folds are easier.
- **Known pitfalls**: planted folds duplicate count vectors exactly, unlike real folds; distance-defined edge labels can be reproduced without any biology.

### B3. Count-only recovery of the image-derived flag (proposed)

- **Goal**: quantify how much in-tissue information total UMI carries alone, and where it fails.
- **Ground truth**: consistency with the Space Ranger flag, an automatic label, so the measure is agreement and not accuracy. Interior units are at least two lattice steps from the flagged boundary. Normalisation: the score is total UMI per unit, unscaled.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Same sections as B2 with Space Ranger flags | [R8], [R9], [R10] | Visium, mouse and human; — | — | Label is automatic, not expert |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC of total UMI | area under the ROC curve of $n_i$ against the flag, interior units only | higher | primary | — |
| Edge error | misclassification rate of the count band, split by distance to the boundary (0, 1, or at least 2 lattice steps) | lower | guardrail | — |

- **Comparators**: count band with count_min 100; and the best single threshold fitted on the other half of sections, as an upper bound for any count threshold.
- **Protocol**: two-fold cross-fitting over sections. Fit the threshold on one half, evaluate on the other, and swap.
- **Acceptance criterion**: PROPOSED, not from the literature. AUROC at least 0.95 on interior units. Edge failure is expected and is reported rather than tuned away.
- **Known pitfalls**: the label is image-derived, so a count rule agrees with it only through correlation between depth and tissue. Low-RNA tissue looks like background to any count rule, and ambient RNA on background units can exceed the band.

### P1. Performance and scaling

Wall time and peak memory per call for each method on hires images at the scale that `auto_max_pixels` produces, and throughput of the unit-level rules at 10k, 100k and 1M units. The benchmark is CPU only, because no GPU method is in the enum. Comparators are the three squidpy methods, count band, the artefact rule and the flag reader. Hold fixed: the image file and scale, `auto_max_pixels`, thread count and seed. Report the median and interquartile range over five repeats. No threshold is set here; one is set after the baseline is measured.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-registration.image_coordinate_registration`: Same-section image and cross-platform coordinate registration
- **Feeds**:
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `spatial-domains.single_slice_domains`: Single-slice spatial domain identification
  - `spatial-deconv-mapping.spot_celltype_proportions`: Reference-based cell type proportion estimation for spots and bins
- **Reads**: `obs/in_tissue`, `obsm/spatial`, `layers/counts`, `obs/pct_counts_mt`, `uns/spatial/<library_id>/images/hires`
- **Writes**: `obs/in_tissue`, `obs/in_tissue_prob`, `obs/artifact_local`, `uns/in_tissue`, `uns/spatial/<library_id>/tissue_mask`, `models/in_tissue_weka`
<!-- CHAINING:AUTO:END -->

Part of the Visium spot preprocessing sequence: registration, in-tissue detection, unit quality filtering and depth normalisation, before domain and deconvolution analyses.

## 10. Risks, pitfalls and open questions

- The Space Ranger detector is not in the cellranger repository, so its heuristic paradigm is assumed from its output. Loupe Browser's manual selection workflow is not covered here.
- The flag's boundary accuracy is not benchmarked against expert masks in any source cited here. Folds, tears and edge spots have no per-spot truth, and whether count evidence adds information once the image is used is unmeasured. Registration error moves the mask against the lattice, and no listed method reports uncertainty from it. Ambient RNA on background units and Visium HD bin-level calling are not covered.
- SpotSweeper's code labels the lower-variance cluster as the artefact (findArtifacts.R:169-174) without stating why; its article text is not covered here, and the example dataset in its repository is the planned check. The forest's predict and refinement steps are covered only at the level of defaults and seeding.
- Licences for the three 10x dataset pages are not stated here, and the squidpy example image used by its tests has no accession in this document. B1 cannot start until masks are created and licences are confirmed.
- First experiment: two annotators outline two sections per dataset in B1 and measure their Dice. Then run the four image defaults on those sections. Build the model-based posterior only if it beats squidpy Otsu on held-out sections.

## 11. References

R1. Otsu N. A threshold selection method from gray-level histograms. *IEEE Transactions on Systems, Man, and Cybernetics* 1979;9(1):62–66. doi:10.1109/TSMC.1979.4310076 — verified (search)
R2. Felzenszwalb PF, Huttenlocher DP. Efficient graph-based image segmentation. *International Journal of Computer Vision* 2004;59(2):167–181. doi:10.1023/B:VISI.0000022288.19776.77 — verified (search)
R3. Arganda-Carreras I, et al. Trainable Weka Segmentation: a machine learning tool for microscopy pixel classification. *Bioinformatics* 2017. — unverified (memory)
R4. Palla G, Spitzer H, Klein M, et al. Squidpy: a scalable framework for spatial omics analysis. *Nature Methods* 2022. doi:10.1038/s41592-021-01358-2 — verified (corpus)
R5. Cable DM, Murray E, Zou LS, et al. Robust decomposition of cell type mixtures in spatial transcriptomics. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00830-w — verified (corpus)
R6. Totty M, Hicks S, Guo B. SpotSweeper: spatially-aware quality control for spatial transcriptomics. *bioRxiv* 2024. doi:10.1101/2024.06.06.597765 — verified (repo)
R7. Dice LR. Measures of the amount of ecologic association between species. *Ecology* 1945;26(3):297–302. — unverified (memory)
R8. 10x Genomics. Visium CytAssist, Mouse Embryo, 11 mm Capture Area (FFPE). Dataset page, 2023. https://www.10xgenomics.com/datasets/visium-cytassist-mouse-embryo-11-mm-capture-area-ffpe-2-standard — verified (corpus)
R9. 10x Genomics. Visium CytAssist Gene Expression Libraries of Post-Xenium Mouse Brain (FF). Dataset page, 2023. https://www.10xgenomics.com/datasets/visium-cytassist-gene-expression-libraries-of-post-xenium-mouse-brain-ff-using-the-mouse-whole-transcriptome-probe-set-2-standard — verified (corpus)
R10. 10x Genomics. Visium CytAssist Gene Expression Libraries of Post-Xenium Human Colon Cancer (FFPE). Dataset page, 2023. https://www.10xgenomics.com/datasets/visium-cytassist-gene-expression-libraries-of-post-xenium-human-colon-cancer-ffpe-using-the-human-whole-transcriptome-probe-set-2-standard — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/10XGenomics/cellranger | 10x Genomics (copyright holder in LICENSE) | 10x Genomics custom licence (LICENSE file): internal use only, tied to 10x Genomics products, no redistribution or sublicensing | Output schema of the flag and image caps; detector not in the code | callout |
| https://github.com/scverse/squidpy | scverse; maintainers Selman Ozleyen, Tim Treis | BSD-3-Clause | Otsu, Felzenszwalb and forest detectors; defaults | port |
| https://github.com/scverse/scanpy | scverse | BSD-3-Clause | Reader stores the in_tissue column in obs | callout |
| https://github.com/edward130603/BayesSpace | Edward Zhao (author); Senbai Kang (author, maintainer); Matt Stone (author); Xing Ren and Raphael Gottardo (contributors) | MIT + file LICENSE | In-tissue row filter; parquet reader for Visium HD | port |
| https://github.com/satijalab/seurat | Rahul Satija (author, maintainer) and contributors listed in DESCRIPTION | MIT + file LICENSE | filter.matrix row filter | port |
| https://github.com/dmcable/spacexr | Dylan Cable (author; maintainer listed in DESCRIPTION) | GPL-3.0 | Count band defaults and keep rule | reimplement |
| https://github.com/MicTott/SpotSweeper | Michael Totty (author, maintainer); Stephanie Hicks and Boyi Guo (authors) | MIT + file LICENSE | Local-variance artefact rule | port |
