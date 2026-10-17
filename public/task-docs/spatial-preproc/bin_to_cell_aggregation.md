---
id: spatial-preproc.bin_to_cell_aggregation
title: Sub-cellular bin to cell-like unit aggregation
area: spatial-preproc
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [spatial-registration.image_coordinate_registration, spatial-preproc.image_cell_segmentation]
feeds: [spatial-preproc.spatial_unit_qc_filtering, spatial-preproc.spatial_depth_normalization]
reads: [layers/counts, obsm/spatial, obs/array_row, obs/array_col, uns/spatial, images/<name>, labels/<name>, shapes/<name>]
writes: [obs/unit_id, obsm/bin_unit_map, obs/unit_source, uns/bin_to_unit_params, units/layers/counts, units/obs/unit_area_um2, units/obs/n_bins, units/obs/bin_count, units/obsm/spatial]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_preproc_bin_to_cell_aggregation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Sub-cellular bin to cell-like unit aggregation

> Assigns each sub-cellular bin (2 µm Visium HD) to a cell-like or nucleus-like unit and sums bin counts per unit, returning a bin-to-unit map and a unit-by-gene table. The published standards are heuristic (nucleus expansion and polygon containment); singlet ports nucleus expansion as its default and proposes a probabilistic assignment that must beat it on benchmark B1.

## 1. Question

Given bin counts $x_b\in\mathbb{N}^{G}$ at centroids $c_b$ (µm) and a registered prior of nuclei or cell polygons, which unit (a cell or a nucleus) does each bin belong to, if any, and what are the unit-level counts? A correct answer assigns every bin inside one true cell to that cell, leaves background bins unassigned, and gives unit counts equal to the summed counts of their member bins. Membership is not observed on real tissue, so accuracy is measured on simulated tissue (section 8) and consistency is discussed in section 10.

## 2. Why this task matters and where the field stands

Visium HD reports counts in 2 µm square bins, finer than a typical cell diameter, so cell-level analysis needs bins grouped into cell-like units first [R1]. The vendor also publishes fixed 8 µm bins, whose units can contain several cells or parts of cells. The status is **contested**: the two published bin-level tools group bins heuristically, and no head-to-head comparison on Visium HD data is cited here. Open problems:

- **No comparative benchmark.** The OSTA Bioconductor workflow states that a comparative study of Visium HD segmentation methods has yet to be conducted [R7].
- **Nuclei as seeds.** Nucleus-seeded grouping [R1][R4] cannot represent cells without a visible nucleus, and a nucleus missed by the image segmenter leaves its bins unassigned or assigned to neighbours.
- **Prior dependence.** ProSeg [R3] locates cells from a prior and states that it does not add cells the prior missed.
- **Shared bins.** Bins on a boundary are kept in several cells by containment [R2] or assigned by a tie-break, and none of the heuristic tools reports a per-bin confidence.

## 3. Theory and insight

Bins $b=1,\dots,B$ carry counts $x_b$ and centroids $c_b$. Units $u=1,\dots,U$ are cells or nuclei. The assignment matrix $A\in[0,1]^{B\times U}$ holds the weight of bin $b$ in unit $u$. Hard methods use 0/1 entries with at most one 1 per row. The Sopa default keeps a shared bin in every containing cell, so its rows can hold several 1s; that case is counted as over-assignment in section 8.

Aggregation is exact for any $A$:

$$X^{\text{unit}}=A^{\top}X^{\text{bin}}$$

Its cost is $O(\mathrm{nnz}(X^{\text{bin}}))$ because $A$ is sparse. The approximation lies entirely in whether $A$ matches true membership.

Each bin has a candidate set $C_b$: nuclei within a bin-grid distance (bin2cell) or prior polygons containing the centroid (Sopa). The heuristic tools resolve $C_b$ without a likelihood. bin2cell takes the nearest candidate when it is unique. When two or more candidates are equidistant, it picks the one whose profile is nearest in Euclidean distance after PCA, with the PCA fitted to $\log(1+x)$ of the stored count matrix (bin2cell.py:1454–1477; the code keeps the stored matrix raw for cell creation). Sopa's `no_overlap` option chooses

$$u^{*}=\operatorname*{arg\,min}_{u\in C_b}\big\lVert \mathrm{PCA}(\ell^{\text{uniq}}_u)-\mathrm{PCA}(\ell_b)\big\rVert_2^2,\qquad \ell_x=\log\!\Big(1+\frac{10^{6}\,x}{\sum_g x_g+10^{-8}}\Big),$$

where $\ell^{\text{uniq}}_u$ is the profile of bins that belong to $u$ alone. The PCA is fitted to these per-cell profiles, so its component count is capped by the number of cells, shared bins and genes (bins.py:79–113).

Model-based formulation (proposed). Let $\lambda_{ug}$ be the expected UMIs of gene $g$ in a nominal bin covered by unit $u$, $s_b$ a bin size factor (nominal 1), and $\pi_{bu}$ a spatial prior. A Poisson first-order likelihood and the posterior over $C_b\cup\{0\}$ are

$$p(x_b\mid z_b=u)=\prod_g \mathrm{Pois}\big(x_{bg};\,s_b\lambda_{ug}\big),\qquad P(z_b=u\mid x_b)=\frac{\pi_{bu}\,p(x_b\mid u)}{\pi_{b0}\,p_0(x_b)+\sum_{v\in C_b}\pi_{bv}\,p(x_b\mid v)},$$

where $\pi_{bu}\propto\exp(-d_{bu}/\ell)$ with $d_{bu}$ the bin-to-nucleus distance and $\ell$ fitted, $\pi_{b0}$ is the prior of the unassigned state and $p_0$ its profile. EM alternates this E-step with $\hat\lambda_{ug}=\sum_b P(z_b=u\mid x_b)\,x_{bg}\big/\sum_b P(z_b=u\mid x_b)\,s_b$. The Poisson form is first order: it fits when gene means per bin are small, and overdispersion needs a negative-binomial term. The candidate count is fixed by B1 (section 5), so each E-step is a fixed-degree sparse computation.

Estimands. Each output and truth quantity is defined as follows.

- **Membership** $z_b$ (truth): the planted cell covering the largest area of bin $b$, the lower ID on ties, and 0 if no cell covers it. The prediction $\hat z_b$ is the argmax of $A_{bu}$ over units, or 0 when unassigned.
- **Unit counts** $C_{ug}=\sum_b A_{bu}x_{bg}$: unnormalised UMIs; depth normalisation is downstream.
- **Unit area** $a_u=4\,\mu\text{m}^2\sum_b A_{bu}$: nominal and not measured: bin2cell's destripe step adjusts counts per bin by a stored factor (bin2cell.py:775, :798), and no bin-area measurement is used here.
- **Confidence** $\max_u P(z_b=u\mid x_b)$: a posterior whose calibration is a claim to test on B1.
- **bin_ARI**: the adjusted Rand index [R6] between $z_b$ and $\hat z_b$ over scored bins, with $n_{ij}$ the contingency counts, $p_i$ and $q_j$ their marginals and $n$ the number of bins:

$$\mathrm{ARI}=\frac{\sum_{ij}\binom{n_{ij}}{2}-\frac{\sum_i\binom{p_i}{2}\sum_j\binom{q_j}{2}}{\binom{n}{2}}}{\tfrac12\Big[\sum_i\binom{p_i}{2}+\sum_j\binom{q_j}{2}\Big]-\frac{\sum_i\binom{p_i}{2}\sum_j\binom{q_j}{2}}{\binom{n}{2}}}$$

ARI is exact for two partitions of the same bins and invariant to label permutation. Its expectation under random labelling is 0. Pair counting weights large units quadratically, so bin_ARI is dominated by the largest units; matched_unit_F1 is reported beside it.

Regime of validity. The expansion rule holds when nuclei are detected, registration is accurate to well below one bin, and cells are roughly round around their nuclei. The containment rule holds only when prior polygons are accurate at bin scale. The Poisson likelihood holds in the sparse-count regime.

Failure modes by family.

- *Nucleus expansion*: a nucleus missed by the image segmenter leaves its cytoplasm unlabelled or assigned to neighbours; nucleus-less cells are absent; a large distance limit over-expands into neighbours in dense tissue.
- *Containment*: centroid-only rules decide straddling bins by a single point, which is arbitrary near a boundary.
- *Tie-breaks*: low-count bins give unstable profiles, and a PCA fitted on few cells is noisy.
- *Registration*: a shift of the image relative to the bin grid moves whole regions of units together.
- *All methods*: unit size and depth differences confound normalisation across units.

A model adds value through an explicit likelihood, which allows comparison of hypotheses, and through posteriors with an explicit unassigned state; profiles and the spatial prior can be reused across datasets. None of the heuristic tools reports a per-bin confidence. The heuristics remain comparators because no published bin-level benchmark ranks them.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| bin2cell | hybrid | StarDist nuclei are expanded into unlabelled bins up to a bin-grid distance; equidistant bins are resolved by PCA expression distance | [R1][R4] |
| Sopa `aggregate_bins` | heuristic | Bin centroids go to every prior polygon containing them; shared bins are kept, or assigned to the nearest unique-profile centroid | [R2] |
| ProSeg, Visium HD mode | model-based | Cells are latent objects with a negative-binomial expression mixture and transcript diffusion, initialised from a prior; it cannot add cells absent from the prior | [R3] |
| Fixed 8 µm grid | heuristic | The vendor `square_008um` bin is the unit, with no grouping | section 12 |

bin2cell and Sopa are the published bin-level standards; both group bins heuristically on top of a nucleus or cell prior. ProSeg is the only model-based option with Visium HD input among those covered; its Visium HD mode takes Space Ranger barcode mappings or Cellpose masks as the prior (README.md:310–328). The fixed grid is the vendor baseline. Learned and per-bin decomposition models solve other problems and are not listed.

Exact defaults (line references point to local clones of bin2cell, Sopa and ProSeg; the upstream heads checked are bin2cell a92ebfd, Sopa eae5842, ProSeg 4caa6f3):

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| bin2cell | max_bin_distance | 2 | bin2cell/bin2cell.py:1355 |
| bin2cell | algorithm | max_bin_distance (alternative volume_ratio, ratio 4) | bin2cell/bin2cell.py:1355 |
| bin2cell | k (candidate hits per bin) | 4 | bin2cell/bin2cell.py:1355 |
| bin2cell | subset_pca | True | bin2cell/bin2cell.py:1355, :1454 |
| bin2cell | PCA components (tie-break) | not set in bin2cell (scanpy default) | bin2cell/bin2cell.py:1454–1477 |
| bin2cell | StarDist model | 2D_versatile_he | bin2cell/bin2cell.py:85 |
| bin2cell | bin–image overlap threshold | 0.9 | bin2cell/bin2cell.py:967 |
| bin2cell | diameter_scale_factor | None, resolved to sqrt of mean bin count | bin2cell/bin2cell.py:1537, :1603–1604 |
| bin2cell | array coordinate limits (defaults) | 3349 | bin2cell/bin2cell.py:838 |
| Sopa | expand_radius_ratio | 0 | sopa/aggregation/bins.py:21 |
| Sopa | expand_radius_ratio at aggregation level | 1 for bins when None | sopa/aggregation/aggregation.py:198 |
| Sopa | no_overlap | False | sopa/aggregation/bins.py:22 |
| Sopa | PCA components (shared-bin rule) | 50 | sopa/aggregation/bins.py:66 |
| ProSeg | ncomponents | 10 | README.md:203; src/main.rs:235 |
| ProSeg | diffusion_probability | 0.2 | README.md:205; src/main.rs:315 |
| ProSeg | cell_compactness | 0.04 in code, 0.03 in README | src/main.rs:272; README.md:209 |
| Fixed grid | canonical bin name | square_008um | cellranger repository (section 12), lib/python/cellranger/websummary/analysis_tab_aux.py:66 |

## 5. Proposed singlet approach

Routes are listed in section 12. bin2cell's expansion rule and tie-break are ported as `nucleus_expansion`, the proposed default; `bin2cell` wraps the published package for comparison. Sopa's containment and shared-bin rules are ported as `sopa_bins`. ProSeg is called as a comparator and not ported. `fixed_grid` is reimplemented as sums over blocks of bins, with no vendor code.

The proposed model-based variant is the EM of section 3, with candidate sets of the nearest nuclei within $R$ bins; $R$ and the candidate count are fixed by B1. It is not an enum value until implemented and benchmarked. It is adopted only if three falsifiable claims hold on B1:

1. Its bin_ARI at miss rate 0 and offset 0 exceeds the best heuristic by at least 0.02 (proposed margin).
2. The expected calibration error of its posterior is at most 0.05 (proposed). Above that, the value is exposed as a ranking score, not a probability.
3. Its bin_ARI falls by less from miss rate 0 to 0.3 than nucleus expansion's does.

ML stack. The model is small: $U\times G$ profiles and a fixed-degree candidate graph. It is hard-coded in C++, with CUDA for the E-step and cuSPARSE for $A^{\top}X$. PyTorch is not needed for the first version and is reserved for an offline learned prior.

Kernels and devices. Nucleus spatial hashing, bounded-distance expansion on the bin grid, truncated-SVD PCA over ambiguous bins, sparse aggregation and the EM E-step. The CPU path uses the same algorithms with threads. Streaming is not claimed; sections are processed in memory.

Defaults for agents: `method` nucleus_expansion, `prior_source` nucleus_labels, `bin_size_um` 2.0, and `nucleus_expansion.max_bin_distance` 2 with `tie_k` 4 and `tie_pca_components` 50. Call `dry_run` first on large sections.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Raw UMI counts, bins by genes |
| read | obsm/spatial | float | Bin centroids in microns |
| read | obs/array_row, obs/array_col | int | Grid indices of each bin |
| read | uns/spatial | record | Scale factors and spot diameter |
| read | labels/<name> | int raster | Nucleus labels from image segmentation |
| read | shapes/<name> | geometry | Prior cell polygons |
| read | images/<name> | image | Registered H&E or DAPI, used for the overlap check |
| write | obs/unit_id | int32 | Unit per bin; 0 is unassigned (hard label) |
| write | obsm/bin_unit_map | sparse float | Bins by units, weights in [0,1] |
| write | obs/unit_source | category | nucleus, expansion, containment, proseg or grid |
| write | uns/bin_to_unit_params | record | Method, version or commit, and all parameters |
| write | units/layers/counts | sparse int | Unit by gene summed UMIs |
| write | units/obs/unit_area_um2, units/obs/n_bins, units/obs/bin_count | float, int, int | Nominal area, member bins and total UMIs |
| write | units/obsm/spatial | float | Mean of member-bin centroids |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI with bin counts, bin centroids and a registered prior. |
| `method` | string | "nucleus_expansion" | `nucleus_expansion`, `bin2cell`, `sopa_bins`, `proseg`, `fixed_grid` | Grouping method; nucleus_expansion is the proposed default, and bin2cell wraps the published tool. |
| `prior_source` | string | "nucleus_labels" | `nucleus_labels`, `cell_polygons` | Prior from labels/ (nuclei) or shapes/ (cell polygons). |
| `bin_size_um` | number | 2.0 | > 0 | Nominal bin side in microns; sets unit area and must match the bin grid. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing units. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `nucleus_expansion` | object | — | — | Options for nucleus_expansion and bin2cell; other methods ignore them. |
| `nucleus_expansion.max_bin_distance` | integer | 2 | min 1 | Maximum bin-grid distance an expanded label may travel from its nucleus. |
| `nucleus_expansion.tie_k` | integer | 4 | min 1 | Candidate hits queried per bin; ambiguous bins are resolved among them. |
| `nucleus_expansion.tie_pca_components` | integer | 50 | min 1 | PCA components for the expression distance used to break ties. |
| `sopa_bins` | object | — | — | Options for sopa_bins; other methods ignore them. |
| `sopa_bins.expand_radius_ratio` | number | 0 | min 0 | Fraction of mean cell radius by which prior polygons are expanded before containment. |
| `sopa_bins.no_overlap` | boolean | false | — | If true, shared bins go to one cell by nearest unique-profile centroid. |
| `sopa_bins.pca_components` | integer | 50 | min 1 | PCA components for the shared-bin distance. |
| `proseg` | object | — | — | Options for proseg, a comparator; other methods ignore them. |
| `proseg.ncomponents` | integer | 10 | min 1 | Negative-binomial mixture components for cell expression. |
| `proseg.diffusion_probability` | number | 0.2 | min 0; max 1 | Prior probability that a transcript is diffused and repositioned. |
| `fixed_grid` | object | — | — | Options for fixed_grid; other methods ignore them. |
| `fixed_grid.block_um` | number | 8.0 | > 0 | Side of each grid unit in microns; must be a multiple of bin_size_um. Units are not cells. |
<!-- PARAMS:AUTO:END -->

Method and prior must agree. `nucleus_expansion` and `bin2cell` take `nucleus_labels` (`labels/<name>`); `sopa_bins` takes `cell_polygons` (`shapes/<name>`); `proseg` takes either prior, rasterised by singlet into the Cellpose-mask form that ProSeg reads (README.md:333–343); `fixed_grid` takes neither. `proseg` requires a prior because it does not create cells. The `nucleus_expansion` options also apply to `bin2cell` and to no other method. `bin_size_um` sets unit area and must match the grid, and `fixed_grid.block_um` must be a multiple of it. The heuristic methods and `fixed_grid` are deterministic given their inputs; the seed behaviour of `proseg` is in section 10.

## 7. MCP tool

Tool `singlet_spatial_preproc_bin_to_cell_aggregation` (definition in `tasks/mcp/singlet_spatial_preproc_bin_to_cell_aggregation.json`). Example call and compact result:

```json
{"dataset": "/data/visium_hd_s1.singlet", "method": "nucleus_expansion", "nucleus_expansion": {"max_bin_distance": 2}}
```

```json
{"dataset": "/data/visium_hd_s1.singlet", "status": "completed", "wrote": ["obs/unit_id", "obsm/bin_unit_map", "obs/unit_source", "uns/bin_to_unit_params", "units/layers/counts", "units/obs/unit_area_um2", "units/obs/n_bins", "units/obs/bin_count", "units/obsm/spatial"], "summary": {"method": "nucleus_expansion", "n_bins": "<int>", "n_units": "<int>", "unassigned_bin_fraction": "<fraction>", "multi_assigned_bin_fraction": "<fraction>", "median_unit_area_um2": "<float>"}, "provenance_id": "<id>", "job_id": null, "estimate": null}
```

- Long-running: sections of 1e7 bins may return status queued with a job_id.
- Deterministic: the heuristic methods and `fixed_grid` are deterministic given their inputs; `proseg` seed behaviour is in section 10.
- Dry run: returns estimated seconds, peak memory and device without computing units.

## 8. Benchmarks

All accuracy comparisons use one bin grid and fix the prior, the nucleus miss rate and the registration offset for each comparator. Each method is applied with shipped defaults and with one tuned setting chosen on a separate simulation split. Bin-level truth follows the maximal-overlap rule of B1. Unit-level metrics are computed only within one unit definition and against that definition's own truth: cells for nucleus expansion, Sopa and ProSeg, and bins for the fixed grid, whose units are not cells. Results are reported per condition as mean and spread across seeds, not pooled.

### B1. Planted-truth bin simulation (proposed)

- **Goal**: Recover the true bin-to-cell partition under controlled nucleus miss rate, registration offset and leakage.
- **Ground truth**: Planted. $z_b$ is the cell covering the largest area of bin $b$; bin_ARI is the adjusted Rand index [R6] between $z_b$ and $\hat z_b$ over scored bins.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Simulated bin tissue | singlet generator; no accession | Visium HD-style bins, 1 mm field | 6 conditions, 20 seeds |

Recipe (proposed):

1. Hard-core cell centres with 8 µm minimum spacing; lognormal radius (median 5 µm, 25% spread); concentric nucleus of half radius.
2. Negative-binomial molecule count per cell (mean 100, dispersion 10), over $K=8$ profiles (section 10).
3. Leakage on: 20% of intensity moves by an exponential distance of mean 2 µm.
4. 2 µm bins rotated 0.5°, offset by 0 or 1 bin, area factor $s_b\sim U(0.9,1.1)$; counts Poisson with mean $s_b\mu_b$, $\mu_b$ overlap-weighted.
5. Prior keeps each nucleus and cell with probability $1-m$, $m\in\{0,0.1,0.3\}$; prior vertices jittered by N(0, 1 µm).

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| bin_ARI | Adjusted Rand index over bins with non-zero truth and prediction | maximise | primary | [R6] |
| matched_unit_F1 | Cells matched at bin-set IoU of at least 0.5 (proposed) | maximise | primary | — |
| over_assignment_rate | Bins in several units | minimise | guardrail | — |
| unit_count_error | $\lvert N_{\text{pred}}-N_{\text{true}}\rvert/N_{\text{true}}$ | minimise | guardrail | — |
| unassigned_bin_fraction | Bins of true cells left unassigned | minimise | guardrail | — |

- **Comparators**: bin2cell; Sopa containment with and without `no_overlap`; ProSeg with the nucleus prior; the 8 µm grid, scored on bins; nucleus expansion at 1, 2 and 3 bins.
- **Protocol**: 6 conditions (three miss rates by two offsets), 20 seeds each.
- **Acceptance criterion** (proposed, not from the literature): bin_ARI of at least 0.6 and matched_unit_F1 of at least 0.7 at miss rate 0 and offset 0; bin_ARI falls by at most 0.1 at miss rate 0.3. Thresholds are fixed on a calibration split with disjoint seeds.
- **Known pitfalls**: (1) Circularity: generator-derived priors and profiles favour prior-based methods and profile tie-breaks. (2) Score the 8 µm grid on bins only, with one fixed boundary rule, or ARI is artefactually low.

### P1. Performance and scaling

Wall time, peak memory and bins per second at 1e5, 1e6 and 1e7 bins, on generated sections from the B1 recipe with miss rate 0. Comparators: bin2cell (CPU, Python), Sopa `aggregate_bins` (CPU, geopandas and scipy) and ProSeg Visium HD mode (CPU, Rust). singlet is measured on CPU, and on CUDA once the E-step exists. Hold fixed: thread count, hardware, nucleus labels and the bin matrix. Report each stage (prior, expansion or containment, tie-break, aggregation) and the log-log scaling exponent per method. No speed is claimed in this document.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-registration.image_coordinate_registration`: Same-section image and cross-platform coordinate registration
  - `spatial-preproc.image_cell_segmentation`: Cell and nucleus segmentation from stain images of spatial transcriptomics sections
- **Feeds**:
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `spatial-preproc.spatial_depth_normalization`: Spatially aware library-size normalization
- **Reads**: `layers/counts`, `obsm/spatial`, `obs/array_row`, `obs/array_col`, `uns/spatial`, `images/<name>`, `labels/<name>`, `shapes/<name>`
- **Writes**: `obs/unit_id`, `obsm/bin_unit_map`, `obs/unit_source`, `uns/bin_to_unit_params`, `units/layers/counts`, `units/obs/unit_area_um2`, `units/obs/n_bins`, `units/obs/bin_count`, `units/obsm/spatial`
<!-- CHAINING:AUTO:END -->

Part of the Visium HD preprocessing recipe: it follows registration and nucleus or cell segmentation, and precedes unit-level quality filtering and depth normalisation.

## 10. Risks, pitfalls and open questions

- **Missing evidence for other benchmarks.** No Visium HD dataset with bin-level or manual cell labels, no matched H&E section on the bin grid and no matched single-cell reference is cited here. The transcript-level ARI extension, the matched-section consistency check and the nucleus-coverage check are therefore not stated as benchmarks here. The reference profile set for B1 is not yet chosen. The OpenProblems spatial segmentation task README references a 10x Xenium mouse-brain dataset (README.md:77), a transcript analogue only.
- **Secondary-source claims.** Known only from a secondary summary of the OSTA workflow [R7]: Space Ranger v4 outputs H&E-segmented cell-level data, which would supersede nucleus-seeded reconstruction and would then need its own comparator. bin2cell's README demonstrates mouse brain and human colorectal cancer data (README.md:28–29); no gain over 8 µm bins on either is cited here. Neither claim is used for a default.
- **Source conflicts.** ProSeg's README gives cell compactness 0.03 and its source 0.04 at the same commit (section 4). The sampler and its seed are not reviewed here, so inference behaviour is taken from its documentation.
- **Geometry and registration.** The size of the H&E-to-bin shift is not sourced here. bin2cell's array check defaults to row and column limits of 3349 (bin2cell.py:838), so other capture areas need the limits passed explicitly. The spatialdata docstring notes that the Visium HD grid is slightly rotated (scverse_spatialdata/src/spatialdata/_core/operations/rasterize_bins.py:80).
- **Scope.** Baysor takes molecule positions as input [R5] (kharchenkolab_Baysor/README.md:4), so it is not a comparator for bin counts. No Stereo-seq bin-to-cell tool is cited here, so Stereo-seq is outside this document. The 8 µm naming is taken from the cellranger repository in section 12.
- **First experiment.** Apply the comparators of section 8 to B1 at miss rate 0 and offset 0 with identical priors, and report bin_ARI, over-assignment and unassigned fraction. Then add the mixture with its posterior calibration check.

## 11. References

R1. Polański K, Bartolomé-Casado R, Sarropoulos I, Xu C, England N, Jahnsen FL, Teichmann SA, Yayon N. Bin2cell reconstructs cells from high resolution Visium HD data. *Bioinformatics* 2024;40(9):btae546. doi:10.1093/bioinformatics/btae546 — verified (repo)

R2. Blampey Q, Mulder K, Gardet M, et al. Sopa: a technology-invariant pipeline for analyses of image-based spatial omics. *Nature Communications* 2024;15:4981. doi:10.1038/s41467-024-48981-z — verified (repo)

R3. Jones DC, Elz AE, Hadadianpour A, et al. Cell simulation as cell segmentation. *Nature Methods* 2025. doi:10.1038/s41592-025-02697-0 — verified (repo)

R4. Schmidt U, Weigert M, Broaddus C, Myers G. Cell detection with star-convex polygons. *Medical Image Computing and Computer Assisted Intervention (MICCAI)* 2018. doi:10.1007/978-3-030-00934-2_30 — verified (corpus)

R5. Petukhov V, Xu RJ, Soldatov RA, Cadinu P, Khodosevich K, Moffitt JR, Kharchenko PV. Cell segmentation in imaging-based spatial transcriptomics. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-01044-w — verified (repo)

R6. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/BF01908075 — verified (corpus)

R7. Workflow: Visium HD (segmented). *Bioconductor OSTA online book*. https://bioconductor.org/books/release/OSTA/pages/seq-workflow-visium-hd-seg.html — verified (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/Teichlab/bin2cell | Krzysztof Polanski, Nadav Yayon (pyproject.toml) | MIT (LICENSE) | Nucleus expansion, tie-break and defaults in section 4 | port (`nucleus_expansion`); callout (`bin2cell`) |
| https://github.com/gustaveroussy/sopa | Quentin Blampey (pyproject.toml) | BSD-3-Clause (LICENSE) | Containment and shared-bin rules | port (`sopa_bins`) |
| https://github.com/dcjones/proseg | Daniel C. Jones (LICENSE.md) | GPL-3.0 (LICENSE.md) | Comparator for Visium HD bins | callout |
| https://github.com/10XGenomics/cellranger | 10x Genomics (LICENSE) | 10x Genomics licence, which limits use to 10x Genomics products (LICENSE) | Canonical name of the 8 µm grid | callout (naming only) |
| https://github.com/stardist/stardist | Uwe Schmidt, Martin Weigert (setup.py) | BSD-3-Clause (LICENSE.txt) | Nucleus model used by bin2cell | callout (dependency of the prior task) |
