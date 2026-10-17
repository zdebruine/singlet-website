---
id: spatial-preproc.spatial_contamination_removal
title: Background and neighbour-contamination correction in spatial data
area: spatial-preproc
scope: core
paradigm: model-based
literature_status: open
priority: P1
depends_on: [spatial-preproc.in_tissue_detection, spatial-preproc.spatial_unit_qc_filtering]
feeds: [spatial-preproc.spatial_depth_normalization, spatial-domains.single_slice_domains, spatial-deconv-mapping.spot_celltype_proportions]
reads: [layers/counts, obsm/spatial, obs/in_tissue, obs/is_background, obs/qc_keep, var/is_negative_control]
writes: [layers/decontaminated_counts, obs/contamination_fraction, obsp/bleed_weights, uns/ambient_profile, uns/contamination_params, uns/contamination_diagnostics]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_preproc_spatial_contamination_removal
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Background and neighbour-contamination correction in spatial data

> Estimates, for each spatial unit, the share of observed UMIs that came from ambient background or from neighbouring units, and returns counts with that share removed.

## 1. Question

How much of each spot's or bin's UMI count is ambient background or spillover from neighbouring units, and what are the counts that originated in each unit? Input is a unit-by-gene count matrix with unit coordinates and background units (off-tissue spots, empty regions or negative-control features). Output is expected counts per unit and gene with foreign RNA removed, and a per-unit contamination fraction on the scale of observed counts. A correct answer recovers the counts the unit would show without foreign RNA. This can only be checked on simulated or orthogonally measured data (section 8).

## 2. Why this task matters and where the field stands

Spatial units are not isolated. Visium spots receive mRNA that drifted from neighbouring spots, which the SpotClean authors call spot swapping; they report that more than 30% of UMIs at a tissue spot originated elsewhere on average [R1]. Bleed distorts normalisation, marker-based annotation, differential expression and deconvolution, so correction belongs before those steps. Ambient background, the cell-independent RNA that droplet methods remove, is also present: off-tissue spots and tissue-free regions carry RNA that is added to tissue units.

Droplet methods address ambient RNA without spatial structure. SoupX estimates a global contamination fraction from non-expressing cells and removes soup counts [R2]. DecontX works without empty droplets, using a Bayesian mixture with cluster-derived profiles [R3]. CellBender [R4] and scAR [R5] model the background with deep generative models. None was built for units that have neighbours, and no published spatial adaptation of them is known. Deconvolution models explain mixed spots as mixtures of cell-type profiles [R6], which places neighbour signal in cell-type proportions.

The status is **open**. SpotClean is the published model of spot-level bleed [R1]. No spatial benchmark with ground-truth contamination is known. Four problems are unresolved:

- Identifiability: bleed and true co-localisation of cell types at boundaries and in niches both produce foreign-looking signal; only the kernel shape and radius separate them.
- Background heterogeneity: folds, necrosis and tears give background profiles that differ across a slide.
- Sparse units: bins and bead arrays with near-cellular resolution [R7] carry few counts per unit, where bleed and ambient effects are weakly identifiable.
- Imaging platforms: leakage across segmentation boundaries is handled by transcript-to-cell assignment, not by the unit-level methods here.

## 3. Theory and insight

Two processes add foreign counts to a unit. Ambient background adds a profile that is the same for every unit. Bleed moves counts from neighbouring units through a spatial kernel. Correction inverts this mixture: the self-retained counts are what remains once both are accounted for.

The published bleed model of SpotClean [R1] is a first-order expectation over units $s$ and genes $g$:

$$\mathbb{E}[Y_{sg}] \approx (1-\beta)\,Z_{sg}\,\mathbf{1}[s\in T] + \beta\sum_{s'\in T} Z_{s'g}\,w_{s's}, \qquad w_{s's} = \frac{\delta}{N} + (1-\delta)\,\tilde{k}_r(s',s),$$

where $Y_{sg}$ are observed UMIs, $Z_{sg}$ are origin counts (the expression of unit $s$ before spot swapping), $T$ is the set of tissue units, $N$ all units, $\beta$ the bleed rate, $\delta$ the distal (uniform) rate and $\tilde{k}_r$ a kernel of radius $r$, in spacings of adjacent units, row-normalised over all units for each tissue origin. Each origin's weights sum to one over destinations, so counts are conserved. The regime is a thinned Poisson or multinomial approximation at spot level, with independence across genes and units. For each candidate radius, SpotClean fits $\beta$, $\delta$ and per-unit origin totals by least squares on total UMIs per unit (L-BFGS-B), and keeps the radius with the smallest residual:

$$\min_{\beta,\,\delta,\,\mathbf{x}}\;\lVert \mathbf{y} - W(\beta,\delta,r)\,\mathbf{x}\rVert_2^2 ,$$

where $\mathbf{y}$ holds total UMIs per unit, $\mathbf{x}$ the origin totals of the tissue units and $W$ the bleed operator. Gene-level origin counts then follow from a Poisson EM with $\beta$, $\delta$ and the radius fixed. The fit is global per slide and gives point estimates without calibrated uncertainty.

The proposed joint model adds an ambient term with a shared profile $\pi$ ($\sum_g \pi_g = 1$) and a global ambient fraction $\rho$:

$$\mathbb{E}[Y_{sg}] = (1-\beta)\,Z_{sg}\,\mathbf{1}[s\in T] + \beta\sum_{s'\in T} Z_{s'g}\,w_{s's} + \rho\,N_s\,\pi_g .$$

It is fitted by EM on the same sparse operator. Its falsification criteria are in section 5.

Heuristic background subtraction estimates a per-gene rate from background units $B$ and subtracts its library-size expectation, clipped at zero:

$$\lambda_g = \frac{\sum_{b\in B} x_{bg}}{\sum_{b\in B} N_b}, \qquad \hat{x}_{sg} = \max\bigl(0,\; x_{sg} - \lambda_g N_s\bigr).$$

Its regime is a background sample with no tissue RNA and the same composition as the contamination. It removes only ambient counts, so it ignores bleed. Clipping at zero biases low-count units upward.

The ARC score, as coded in SpotClean [R1], divides the background UMI total by the number of all barcodes, relative to the mean UMI total per tissue barcode. The code documents it as a lower bound, because contamination inside tissue units is not counted:

$$\mathrm{ARC} = \frac{\sum_{b\in B} N_b / N_{\mathrm{all}}}{\sum_{t\in T} N_t / |T|}.$$

**Estimands.** All methods write outputs with the same definitions, so they are comparable:

- `layers/decontaminated_counts` estimates $\mathbb{E}[S_{sg}]$, the UMIs recorded in unit $s$ that originated in $s$, in input UMI units and not rounded. Under the bleed model $S_{sg}=(1-\beta)Z_{sg}$, so gene proportions are unaffected by $\beta$.
- `obs/contamination_fraction` is $c_s = 1 - \sum_g \hat{S}_{sg} / \sum_g Y_{sg}$, the share of observed counts of unit $s$ that did not originate in $s$, on $[0,1]$. Background subtraction estimates only the ambient part of $c_s$.
- `obsp/bleed_weights` holds $w_{s's}$, the probability that a UMI originating in $s'$ is recorded in $s$; each origin's row sums to one.
- `uns/ambient_profile` is $\pi_g$, the share of contamination UMIs from gene $g$, summing to one.

**Why model-based.** The heuristic baseline is cheap and works when background is stationary and tissue-free. The model adds a fitted bleed rate and radius that are interpretable, one kernel reused across genes, and, in the proposed likelihood form, per-unit uncertainty that a least-squares fit does not give. Droplet models separate background from cells using empty droplets. Spatial units have background units but no empty droplets within tissue, so the separation has to come from the kernel.

**Insight.** Ambient background is global and cell-independent, so mutually exclusive markers of unrelated cell types expose it. Bleed is local and separable from co-localisation only through the kernel, which is why spatial models are less identifiable than droplet models. Droplet methods assume empty droplets or clusters; transferring them to spatial data is an adaptation that has not been benchmarked.

**Failure modes** (derived from the model, not from benchmark studies):

- Bleed confounded with true co-localisation at boundaries and niches, so real neighbour signal is removed.
- A misspecified kernel shape or radius, leaving neighbourhood signal or over-smoothing domains.
- Background that differs across regions, so a global subtraction is wrong.
- Off-tissue edge spots that carry tissue RNA, which contaminate the background profile.
- Clustering-based methods that absorb spatial domains into the contamination profile when clusters follow space.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| SpotClean | model-based | Spatial bleed mixture with a kernel radius; bleed and distal rates fitted by least squares; native counts by EM | [R1] |
| DecontX | model-based | Bayesian mixture with a per-cell contamination proportion and a contamination profile estimated from cell clusters, fitted by variational EM | [R3] |
| SoupX | hybrid | Global contamination fraction from marker genes of non-expressing cells, fitted by a Poisson GLM; default subtraction removes expected soup counts, and soupOnly drops genes chosen by Poisson tests | [R2] |
| CellBender | model-based | Variational deep generative model of droplet background that infers native counts per droplet | [R4] |
| scAR | model-based | Variational autoencoder model of ambient noise with a learned denoised profile | [R5] |
| Background subtraction | heuristic | Per-gene rate from background units, scaled by library size, subtracted and clipped at zero | — |

SpotClean [R1] is the published standard for spatial units, and background subtraction is the heuristic standard kept in every benchmark. singlet proposes to implement SpotClean and background subtraction (section 5). The droplet methods assume empty droplets or cell clusters, so they serve only as comparators in section 8. The defaults below come from source code.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| SpotClean | maxit | 30 | R/decontamination.R:247 @ 27c955a |
| SpotClean | tol | 1 | R/decontamination.R:247 @ 27c955a |
| SpotClean | candidate_radius | 5, 10, ..., 30 | R/decontamination.R:248 @ 27c955a |
| SpotClean | kernel | gaussian (linear, laplace, cauchy) | R/decontamination.R:249 @ 27c955a |
| SpotClean | gene_cutoff | 0.1 | R/create_slide.R:51 @ 27c955a |
| DecontX | maxIter | 500 | R/decon.R:128 @ fdb2651 |
| DecontX | delta | c(10, 10) | R/decon.R:129 @ fdb2651 |
| DecontX | convergence | 0.001 | R/decon.R:131 @ fdb2651 |
| DecontX | seed | 12345 | R/decon.R:135 @ fdb2651 |
| SoupX | method | subtraction (soupOnly, multinomial) | R/adjustCounts.R:33 @ 8d89492 |
| CellBender | epochs | 150 | cellbender/remove_background/argparser.py:138 @ f36ae29 |
| CellBender | fpr | 0.01 | cellbender/remove_background/argparser.py:196 @ f36ae29 |
| CellBender | learning rate | 1e-4 | cellbender/remove_background/argparser.py:236 @ f36ae29 |
| scAR | epochs | 400 | scar/main/_scar.py:410 @ df7adef |
| scAR | KL weight | 1e-5 | scar/main/_scar.py:406 @ df7adef |

## 5. Proposed singlet approach

singlet reimplements the SpotClean estimator from section 3 (route: reimplement) with the same forward model and radius search, on a sparse operator. A candidate radius $r$ sets the kernel scale to $r/2$ spacings, so about 95% of bleed lies within $r$ spacings for the Gaussian kernel. The published code builds a dense Euclidean distance matrix over all spots, so its memory grows with the square of the spot count. singlet keeps only kernel entries within a cutoff of the largest candidate radius. Each EM iteration is two sparse products with the bleed operator: the E-step forms expected counts and the M-step redistributes observed UMIs to origins. These are the hot kernels for CUDA or cuSPARSE. The rates and radius come from a least-squares fit on spot totals, one small optimisation per candidate radius. The fitted rates and radius are returned as in the published estimator, and the self-retained counts are the fitted origin counts multiplied by $1-\hat\beta$.

The proposed variant, `spotclean.background_model = joint`, adds the ambient term of section 3 and fits $\pi$ and $\rho$ from tissue as well as background units. The default `off_tissue` takes the profile from background units only, using the background-region expression that the SpotClean README describes [R1]. The joint variant becomes the default only if it exceeds `off_tissue` on the B1 metrics and does not reduce B2 background reproducibility; otherwise it is removed. Background subtraction is implemented directly from its formula, using `background_key` units, or negative-control features when `negative_control_key` is set.

The defaults an agent should use without asking are: method `spotclean`; kernel `gaussian`; candidate radii 5 to 30 in spacings of adjacent units; `maxit` 30; `tol` 1; `gene_cutoff` 0.1; `background_model` `off_tissue`; `background_key` `is_background`, falling back to units outside `obs/in_tissue`; device `auto`. PyTorch is not needed in the first version; amortised encoder models across slides, of the CellBender or scAR kind, are a later option. The CPU and CUDA paths share the sparse operator and must agree within EM tolerance; no benchmark here measures agreement, so it is an implementation requirement. Streaming is not claimed, and slides are processed one at a time. The tool refuses input without background units or coordinates, and refuses segmented-cell input for `spotclean`. The approach fails if corrected counts do not beat raw counts on the B1 log1p correlation at the planted rates, or if B2 background reproducibility falls below that of the published fit.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, unit by gene |
| read | obsm/spatial | float | unit coordinates |
| read | obs/in_tissue | bool | tissue membership; off-tissue units are background by default |
| read | obs/is_background | bool | optional background units (`background_key`) |
| read | obs/qc_keep | bool | optional keep flag from spatial unit QC |
| read | var/is_negative_control | bool | optional negative-control features (`negative_control_key`) |
| write | layers/decontaminated_counts | float32 | expected self-retained counts, unit by gene |
| write | obs/contamination_fraction | float32 | share of observed counts not self-retained, in [0, 1] |
| write | obsp/bleed_weights | sparse float32 | bleed operator $W$, rows are origin units (spotclean only) |
| write | uns/ambient_profile | float64 | per-gene background profile, sums to one |
| write | uns/contamination_params | dict | fitted rates, radius, kernel, convergence, method, background model |
| write | uns/contamination_diagnostics | dict | ARC before and after correction, background unit count |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "counts" | — | Raw UMI count layer to decontaminate, units by genes. |
| `method` | string | "spotclean" | `spotclean`, `background_subtraction` | spotclean fits the spatial bleed model (default for Visium and Visium HD); background_subtraction is the heuristic baseline. |
| `background_key` | string | "is_background" | — | obs column marking background units (off-tissue or empty regions); falls back to not in_tissue when absent. |
| `negative_control_key` | string/null | null | — | var column of negative-control features for imaging panels; background_subtraction only. Null uses background units. |
| `spotclean` | object | — | — | Options for method spotclean; ignored by background_subtraction. |
| `spotclean.candidate_radius` | array | [5, 10, 15, 20, 25, 30] | — | Candidate bleed kernel radii in units of the spacing between adjacent spots; the radius with the smallest residual is kept. |
| `spotclean.kernel` | string | "gaussian" | `gaussian`, `linear`, `laplace`, `cauchy` | Spatial kernel shape for bleed. |
| `spotclean.maxit` | integer | 30 | min 1 | Maximum EM iterations. |
| `spotclean.tol` | number | 1 | > 0 | EM convergence tolerance. |
| `spotclean.gene_cutoff` | number | 0.1 | min 0 | Minimum average expression for a gene to be decontaminated. |
| `spotclean.background_model` | string | "off_tissue" | `off_tissue`, `joint` | off_tissue takes the profile from background units; joint also fits it from tissue units (proposed). |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Method-specific options sit in the `spotclean` object and are ignored by `background_subtraction`. `background_key` selects background units for both methods. `negative_control_key` applies to `background_subtraction` only and is an error for `spotclean`. `overwrite` replaces only the six written members, and `dry_run` reports the estimate without writing.

## 7. MCP tool

Tool name `singlet_spatial_preproc_spatial_contamination_removal` (definition in `tasks/mcp/singlet_spatial_preproc_spatial_contamination_removal.json`). Values in the examples are illustrative only.

```json
{"dataset": "slide_01.singlet", "method": "spotclean",
 "spotclean": {"candidate_radius": [10, 20], "background_model": "off_tissue"}}
```

```json
{"dataset": "slide_01.singlet", "status": "completed",
 "wrote": ["layers/decontaminated_counts", "obs/contamination_fraction", "obsp/bleed_weights", "uns/ambient_profile", "uns/contamination_params", "uns/contamination_diagnostics"],
 "summary": {"method": "spotclean", "radius": 10, "bleed_rate": 0.2, "distal_rate": 0.05, "median_contamination_fraction": 0.3, "arc_before": 0.4, "arc_after": 0.2, "n_background_units": 200},
 "provenance_id": "prov_example"}
```

The tool is not flagged long-running; slides in the P1 range finish inline by design, and the scaling measurements decide whether a queued status is needed. It is not stochastic: it has no seed parameter, and repeated calls on the same input return the same output. The `dry_run` option returns `estimate` with seconds, peak memory (set by the kernel entries) and device, without writing.

## 8. Benchmarks

**Shared protocol.** Units are lattice spots or bins. Counts are not library-normalised before evaluation unless a metric states it. Every method writes the members listed in section 6, and metrics read only those members and the planted or measured reference. Comparators use the default settings in section 4 unless stated. Each simulated setting uses five seeds, reported as mean and standard deviation. Each result records the hardware and the software versions of the methods used.

### B1. Planted bleed recovery on a simulated lattice

- **Goal**: Measure how well each method recovers per-unit contamination and self-retained counts when the bleed rate and kernel radius are planted.
- **Ground truth**: Planted simulation. The generator records the self-retained UMIs $S_{sg}$ and the observed counts $Y_{sg}$, which include ambient UMIs. The per-unit fraction $c_s = 1-\sum_g S_{sg}/\sum_g Y_{sg}$ is the planted share of observed UMIs not originating in $s$; the native truth for each gene is $S_{sg}$ in UMI units.
- **Generator** (proposed):
  1. Build a hexagonal lattice of 2,500 units (50 by 50) with distances and kernel radii in spacings of adjacent units, so that radii 10 and 20 lie in the default candidate grid.
  2. Mark the 200 units furthest from the centre as off-tissue and the rest as tissue.
  3. Assign four spatial domains as the nearest of four random seed units; each domain has one cell type.
  4. For each cell type, take the mean library-normalised profile of 500 annotated cells from the singlet catalogue as $p_k$; $\pi$ is the mean profile over all such cells.
  5. Draw origin counts $Z_s \sim \mathrm{Multinomial}(3000, p_{k(s)})$ for tissue units and zero for off-tissue units.
  6. Relocate each UMI: keep it at its origin with probability $1-\beta$, otherwise move it to unit $s'$ with probability $w_{s's}$ built from an exponential kernel $\exp(-d/r)$, with $d$ and $r$ in spacings, and distal rate $\delta = 0.05$.
  7. Add ambient UMIs equal to 5% of each unit's origin total, distributed by $\pi$.
  8. Use $\beta \in \{0.1, 0.2, 0.4\}$ and $r \in \{10, 20\}$, with five seeds per setting.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted lattice from the recipe above | singlet catalogue annotated cells as source profiles | Simulated Visium-like lattice; 2,500 units per slide, 30 slides | — | Exponential kernel has the Laplace form, but SpotClean's Laplace scale for radius $r$ is $r/2$ spacings, so the generator is not a matched case |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| contamination_fraction_MAE | Mean over tissue units of $\lvert \hat c_s - c_s \rvert$, with $\hat c_s$ from `obs/contamination_fraction` | minimise | primary | — |
| log1p_pearson_recovery | Pearson correlation of $\log(1+\hat S_{sg})$ and $\log(1+S_{sg})$ over tissue units and genes with truth expression in at least 1% of tissue units | maximise | primary | — |
| celltype_marker_auroc | One-vs-rest AUROC per cell type, macro-averaged, of the mean of log1p counts per 10,000 over a fixed marker list; a unit's type is its domain type; computed on decontaminated and raw counts | maximise | primary | — |
| moran_I_bias | Mean over genes of $\lvert I(\hat S_g) - I(S_g)\rvert$ on tissue units, with row-standardised 6-nearest-neighbour lattice weights | minimise | guardrail | — |

- **Comparators**: no correction, background subtraction, SpotClean (default radii and oracle radius equal to the planted radius), and DecontX applied to k-means clusters (k = 4) of the raw counts. Ambient-only methods estimate only the ambient part of $c_s$, so their fraction error is bounded below by the bleed share; this is reported with the results.
- **Protocol**: The six settings and five seeds in the recipe; comparators at default settings unless stated.
- **Acceptance criterion** (proposed, not from the literature): the log1p correlation of corrected counts exceeds raw counts by at least 0.05 at $\beta = 0.2$ and by at least 0.10 at $\beta = 0.4$; $\lvert\hat c_s - c_s\rvert$ averages at most 0.05 at each planted rate; Moran bias is no worse than raw.
- **Known pitfalls**: The generator uses the same thinning view as the forward model in section 3, so B1 tests inversion rather than fit to tissue. Real tissue co-localisation is absent, so B1 overstates identifiability.

### B2. Split-half background recovery on Visium

- **Goal**: Check whether a background profile estimated from off-tissue units is reproducible across halves of the off-tissue set.
- **Ground truth**: Consistency between halves of off-tissue units; no external truth. Gene rates are counts per background UMI.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Visium CytAssist, post-Xenium human colon cancer (FFPE) | [R8]; https://www.10xgenomics.com/datasets/visium-cytassist-gene-expression-libraries-of-post-xenium-human-colon-cancer-ffpe-using-the-human-whole-transcriptome-probe-set-2-standard | Visium CytAssist, FFPE, human; — | — | Requires off-tissue barcodes |
| Visium CytAssist, post-Xenium mouse brain (FF) | [R9]; https://www.10xgenomics.com/datasets/visium-cytassist-gene-expression-libraries-of-post-xenium-mouse-brain-ff-using-the-mouse-whole-transcriptome-probe-set-2-standard | Visium CytAssist, fresh frozen, mouse; — | — | Requires off-tissue barcodes |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| background_split_half_r | Pearson correlation of `uns/ambient_profile` estimated from random half A and from half B of off-tissue units, over the top 500 background genes by mean rate | maximise | primary | — |
| arc_score | ARC (section 3) on raw and corrected matrices, with background units as the empty set | report | guardrail | [R1] |

- **Comparators**: no correction, background subtraction, SoupX with off-tissue units as the empty profile, CellBender and scAR with off-tissue units as empty droplets, and SpotClean.
- **Protocol**: Split off-tissue units at random into halves, with five seeds. Remove one ring of spots adjacent to the tissue mask from both halves. Estimate each method's profile from each half alone, compute the correlation between the two profiles, and in both halves apply the same method to all in-tissue units for the ARC.
- **Acceptance criterion** (proposed, not from the literature): `background_split_half_r` of at least 0.9 on the top 500 background genes.
- **Known pitfalls**: Split-half reliability measures stability, not accuracy, so a stable but wrong background still scores well. Folds and tears can split off-tissue units into regions with different backgrounds, which lowers the correlation without any error in the method.

### P1. Performance and scaling

Wall time and peak memory per slide at 10k, 100k and 1M units, on CPU and CUDA, for SpotClean (sparse operator), background subtraction, DecontX, SoupX, CellBender and scAR, using the B1 generator at each unit count. The published dense-kernel form of SpotClean is measured at 10k units as a reference. Hold fixed: seed, `maxit` 30, `tol` 1, DecontX `maxIter` 500 and `convergence` 0.001, the candidate radius grid, sparse format, thread count and hardware. Report sparse and dense inputs separately. Streaming is not claimed, and 10M units are not measured.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.in_tissue_detection`: In-tissue region detection for sequencing-based spatial data
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
- **Feeds**:
  - `spatial-preproc.spatial_depth_normalization`: Spatially aware library-size normalization
  - `spatial-domains.single_slice_domains`: Single-slice spatial domain identification
  - `spatial-deconv-mapping.spot_celltype_proportions`: Reference-based cell type proportion estimation for spots and bins
- **Reads**: `layers/counts`, `obsm/spatial`, `obs/in_tissue`, `obs/is_background`, `obs/qc_keep`, `var/is_negative_control`
- **Writes**: `layers/decontaminated_counts`, `obs/contamination_fraction`, `obsp/bleed_weights`, `uns/ambient_profile`, `uns/contamination_params`, `uns/contamination_diagnostics`
<!-- CHAINING:AUTO:END -->

Part of the spatial preprocessing recipe for Visium and Visium HD, between unit QC and depth normalisation.

## 10. Risks, pitfalls and open questions

- **Evidence not independently confirmed.** The SpotClean estimator is described from its R code, not from the article's equations. The 30% bleed figure is the authors' README statement. The scAR preprint title differs between the repository citation and a second bibliography; the repository title is used. The SoupX entry cites the 2020 GigaScience article, while the package DESCRIPTION cites a 2018 preprint for the same method.
- **Licences and data.** The terms of the 10x datasets are not stated in any source used here. Whether their released matrices keep off-tissue barcodes is unverified, and B2 cannot proceed without them. The quadratic memory of the published dense weight matrix is derived from the code and not profiled.
- **Unsettled literature.** No published spatial benchmark uses ground-truth contamination. Identifiability of bleed against co-localisation rests on the kernel, and no sensitivity analysis is known. Whether droplet methods transfer to units without empty droplets is untested.
- **Sparse units and imaging.** Visium HD 2 µm bins and bead arrays have few counts per unit, a regime that no benchmark here covers. Leakage across segmentation boundaries is not modelled by unit-level methods. No labelled dataset for marker retention against expert labels is identified, so that check is not benchmarked.
- **Thresholds and first experiment.** All numeric acceptance thresholds in B1 and B2 are design proposals, not literature values. First experiment: implement the B1 generator and check that the oracle fit recovers the planted $\beta$ and $r$ on noise-free counts, then compare SpotClean with background subtraction at $\beta = 0.2$.

## 11. References

R1. Ni Z, Prasad A, Chen S, et al. SpotClean adjusts for spot swapping in spatial transcriptomics data. *Nature Communications* 2022;13:2971. doi:10.1038/s41467-022-30587-y — verified (repo)
R2. Young MD, Behjati S. SoupX removes ambient RNA contamination from droplet-based single-cell RNA sequencing data. *GigaScience* 2020. doi:10.1093/gigascience/giaa151 — verified (corpus)
R3. Yang S, Corbett SE, Koga Y, et al. Decontamination of ambient RNA in single-cell RNA-seq with DecontX. *Genome Biology* 2020. doi:10.1186/s13059-020-1950-6 — verified (corpus)
R4. Fleming SJ, Chaffin MD, Arduini A, et al. Unsupervised removal of systematic background noise from droplet-based single-cell experiments using CellBender. *Nature Methods* 2023. doi:10.1038/s41592-023-01943-7 — verified (repo)
R5. Sheng C, Lopes R, Li G, et al. Probabilistic modeling of ambient noise in single-cell omics data. *bioRxiv* 2022. doi:10.1101/2022.01.14.476312 — verified (repo)
R6. Cable DM, Murray E, Zou LS, et al. Robust decomposition of cell type mixtures in spatial transcriptomics. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00830-w — verified (corpus)
R7. Stickels RR, Murray E, Kumar P, et al. Highly sensitive spatial transcriptomics at near-cellular resolution with Slide-seqV2. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0739-1 — verified (corpus)
R8. 10x Genomics. Visium CytAssist Gene Expression Libraries of Post-Xenium Human Colon Cancer (FFPE). 2023. https://www.10xgenomics.com/datasets/visium-cytassist-gene-expression-libraries-of-post-xenium-human-colon-cancer-ffpe-using-the-human-whole-transcriptome-probe-set-2-standard — verified (corpus)
R9. 10x Genomics. Visium CytAssist Gene Expression Libraries of Post-Xenium Mouse Brain (FF). 2023. https://www.10xgenomics.com/datasets/visium-cytassist-gene-expression-libraries-of-post-xenium-mouse-brain-ff-using-the-mouse-whole-transcriptome-probe-set-2-standard — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/zijianni/SpotClean | Zijian Ni (aut, cre); Christina Kendziorski (ctb) | GPL-3 (DESCRIPTION; no LICENSE file at root) | published spatial bleed model; defaults in section 4 | reimplement |
| https://github.com/campbio/decontX | Yuan Yin (aut), Masanao Yajima (aut), Joshua Campbell (aut, cre) | MIT (DESCRIPTION: MIT + file LICENSE; the LICENSE file gives copyright only) | droplet comparator in B1 and P1 | callout |
| https://github.com/constantAmateur/SoupX | Matthew Daniel Young (aut, cre) | GPL-2 (DESCRIPTION; no LICENSE file at root) | droplet comparator in B2 and P1 | callout |
| https://github.com/broadinstitute/CellBender | Stephen Fleming, Mehrtash Babadi | BSD-3-Clause (pyproject.toml; LICENSE file) | droplet comparator in B2 and P1 | callout |
| https://github.com/Novartis/scAR | Caibin Sheng | MIT (pyproject.toml; no LICENSE file at root) | droplet comparator in B2 and P1 | callout |
