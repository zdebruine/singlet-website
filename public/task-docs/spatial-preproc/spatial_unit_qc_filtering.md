---
id: spatial-preproc.spatial_unit_qc_filtering
title: Quality filtering of spatial units (spots, bins, cells)
area: spatial-preproc
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [spatial-preproc.in_tissue_detection, spatial-preproc.image_cell_segmentation]
feeds: [spatial-preproc.spatial_depth_normalization, spatial-domains.single_slice_domains, spatial-deconv-mapping.spot_celltype_proportions]
reads: [layers/counts, obs/in_tissue, obsm/spatial, obsp/spatial_connectivities, obs/section_id, obs/cell_area, obs/transcript_count, var/feature_type]
writes: [obs/qc_n_counts, obs/qc_n_genes, obs/qc_pct_mt, obs/qc_neg_probe_rate, obs/qc_area, obs/qc_score, obs/qc_keep, obs/qc_reason, uns/qc_thresholds, uns/qc_params, obsm/qc_metrics]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_preproc_spatial_unit_qc_filtering
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Quality filtering of spatial units (spots, bins, cells)

> Scores each spot, bin or segmented cell for technical quality from library size, detected genes, mitochondrial fraction, negative-control rate and area, and writes a keep flag with the reason for any discard.

## 1. Question

Which spatial units (Visium spots, Visium HD bins or segmented cells) carry a usable measurement, and which thresholds on library size, detected genes, mitochondrial fraction and imaging metrics separate them from technical failure? The input is a unit-by-gene count matrix with coordinates, an optional in-tissue mask and, for imaging, cell area and transcript counts. The output is a keep flag, a continuous score, a discard reason and the thresholds used. No accepted ground truth exists for spatial unit quality, so section 8 defines the truth by planted artefacts and retention limits.

## 2. Why this task matters and where the field stands

**Contested.** Droplet QC metrics (library size, detected genes, mitochondrial fraction) carry over to spatial units, but spots and bins hold fewer molecules and imaging cells lose transcripts at segmentation boundaries. A single cutoff can therefore remove a whole tissue domain in one section and keep artefacts in another. Scanpy computes these metrics without choosing cutoffs [R3], and scater is an early framework for the same per-cell metrics [R4]. The adaptive standard, implemented in the Bioconductor framework [R5], is a median-absolute-deviation rule applied within each batch, because pooled depth differences inflate the MAD [R6]. The same chapter assumes most units in each batch are of high quality and warns that cell types with naturally low RNA or high mitochondrial content can be discarded [R6, R8].

Probabilistic and learned tools were built for droplet data. miQC models mitochondrial fraction against detected genes as a two-component mixture and returns a posterior per unit [R1]. dropkick trains a penalised logistic classifier on heuristic labels [R2]. Neither has been evaluated on spatial units in the cited references. SpotSweeper is the only spatially aware implementation included; it scores each spot against its nearest neighbours [R9, R10], and its vignette states that spatially contiguous dry-edge regions need a region-level method [R10].

Open problems: (a) no ground truth exists for spot, bin or cell quality; (b) artefacts and tissue domains are both spatially coherent, so a neighbourhood rule keeps domain biology only when the artefact is smaller than the neighbourhood; (c) in sparse bins, log-scale MADs degenerate; (d) for imaging cells, a low-count unit can be a segmentation failure or an intact low-expressing cell, and counts alone do not separate the two. A learned classifier for low-quality single-cell RNA-seq cells has also been published [R7].

## 3. Theory and insight

Notation: $i$ indexes units in batch $b$, $x_i$ is one QC metric, $\kappa$ is the MAD multiplier, $k$ is the number of spatial neighbours and $\mathcal N_k(i)$ is the set of the $k$ nearest neighbours of $i$.

Robust location-scale rule, per metric and batch:

$$M_b=\operatorname{median}_{i\in b}x_i,\qquad \mathrm{MAD}_b=1.4826\,\operatorname{median}_{i\in b}\lvert x_i-M_b\rvert,\qquad i \text{ is flagged if } \lvert x_i-M_b\rvert>\kappa\,\mathrm{MAD}_b .$$

The breakdown point is 50 percent, so the rule is valid only when most units in the batch are intact and the metric is approximately symmetric after its transform. Library size enters on the log2 scale.

Mixture model for mitochondrial percentage $y_i$ given detected genes $d_i$:

$$p(y_i\mid d_i)=\sum_{c=1}^{2}\pi_c\,\mathcal N\!\left(y_i\,\middle|\,\beta_{c0}+\beta_{c1}d_i,\ \sigma_c^2\right),\qquad i \text{ is kept if } \hat r_i\le 0.75,$$

where $\hat r_i$ is the posterior probability of the component with the larger intercept. It is valid when compromised units form a band of high mitochondrial fraction for their gene count. The Gaussian form is an assumption, and the posterior is calibrated only as far as that assumption holds.

Penalised classifier on heuristic labels:

$$\hat\beta=\arg\min_{\beta_0,\beta}\ -\frac1n\sum_{i=1}^{n}\Big[z_i\log\sigma(\eta_i)+(1-z_i)\log\big(1-\sigma(\eta_i)\big)\Big]+\lambda\Big[\tfrac{1-\alpha}{2}\lVert\beta\rVert_2^2+\alpha\lVert\beta\rVert_1\Big],\qquad \eta_i=\beta_0+x_i^\top\beta,$$

where $z_i$ are labels from an automatic threshold and $x_i$ are the highly variable genes. It is valid as a learned extension of the labels only: $\hat\beta$ reproduces the heuristic and cannot correct it.

Neighbourhood robust z-score, with $x_i=\log(1+m_i)$ for a metric $m$:

$$z_i=\Phi^{-1}(0.75)\,\frac{x_i-\operatorname{median}_{j\in\mathcal N_k(i)}x_j}{\operatorname{MAD}^{\mathrm{un}}_{\mathcal N_k(i)}} .$$

The focal unit is excluded from $\mathcal N_k(i)$. Since $\Phi^{-1}(0.75)=0.6745$, $z_i$ is a robust z-score with denominator $1.4826\,\operatorname{MAD}^{\mathrm{un}}$. It is valid when the artefact is spatially smaller than the neighbourhood. On an ideal hexagonal lattice, rings 1 to $r$ together hold $3r(r+1)$ sites, so $k=36$ reaches ring 3.

Estimands, each defined on the units of the input:

- obs/qc_n_counts: total counts per unit, unnormalised.
- obs/qc_n_genes: number of features with a count above zero per unit.
- obs/qc_pct_mt: 100 times the mitochondrial counts divided by the total counts per unit.
- obs/qc_neg_probe_rate: negative-control counts divided by total counts per unit, a definition of this task that does not depend on any vendor normalisation.
- obs/qc_area: segmentation area as supplied, without transformation.
- obs/qc_score: the signed robust z-score for mad, the posterior of the compromised component for miqc and the local z-score for spatial_local, oriented so that higher means more compromised.
- obs/qc_keep: true when no enabled rule flags the unit.
- Planted indicator (section 8): 1 when the generator thins a unit and 0 otherwise, with effect size equal to the ratio of thinned to original total counts.
- Retention: the share of clean units kept, overall or within an annotated domain.

Fixed cutoffs need recalibration at every depth. The MAD rule adapts to each batch without labels, and the neighbourhood z-score adapts to local tissue without a global model. A mixture adds a posterior probability, which allows graded decisions and a refit per section, and a spatial prior can separate a coherent artefact from one noisy unit. Learned classifiers reuse a trained model but inherit the bias of their labels. Posterior calibration on spatial units is not covered by the cited literature.

Failure modes by family:

- Fixed cutoffs depend on depth and remove low-RNA domains when applied globally.
- A near-zero MAD, as for sparse or discrete metrics, flags almost every unit off the median unless a minimum distance is set (scuttle `min.diff`, section 4); off-tissue units inflate the spread; log2 of a zero count is undefined.
- The mixture can become degenerate on homogeneous data, and its EM depends on random starts.
- The neighbourhood z-score over-smooths thin layers and tissue edges, and contiguous dry-edge regions wider than the neighbourhood need a region-level method [R10].
- For imaging units, few transcripts can mean segmentation failure or a low-expressing intact cell.

No benchmark of unit-level spatial QC is cited, so these failure modes come from method documentation and code.

The insight is that unit-relative and batch-relative thresholds generalise across depth better than fixed cutoffs, and posteriors give graded keep decisions. The core difficulty is that artefacts and biology are both spatially coherent. A neighbourhood rule preserves a domain only when the artefact is smaller than the neighbourhood.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Fixed cutoffs on counts, genes and mitochondrial fraction | heuristic | Keep units inside hand-set bounds; Scanpy supplies the metrics only | [R3] |
| MAD rule per metric and batch | heuristic | Flag units beyond $\kappa$ scaled MADs from the batch median | [R6] |
| miQC mixture of regressions | model-based | Posterior probability of a compromised component given detected genes | [R1] |
| dropkick penalised logistic classifier | hybrid | Elastic-net logistic model trained on heuristic labels | [R2] |
| SpotSweeper local outliers | heuristic | Neighbourhood robust z-score per spot | [R9, R10] |
| SpotSweeper findArtifacts (callout) | heuristic | k-means on PCA of local mitochondrial variance at several neighbourhood orders | [R10] |

The published standards are fixed cutoffs and per-batch MAD rules [R3, R6]. miQC [R1] and dropkick [R2] are the probabilistic and learned tools included here, and both target droplet data. SpotSweeper [R9, R10] is the only spatial implementation included; its artefact detector is kept as a comparator because it needs mitochondrial genes. Methods without code or paper in the cited sources are omitted.

| Method | Parameter | Value | Source |
|---|---|---|---|
| Fixed cutoffs | `percent_top` | (50, 100, 200, 500) | Scanpy `src/scanpy/preprocessing/_qc.py:213` @ 8ed52d9 |
| Fixed cutoffs | `log1p` | True | `_qc.py:217` @ 8ed52d9 |
| MAD | $\kappa$ (`nmads`) | 3 | scuttle `R/isOutlier.R:91` @ d3476eb; OSCA `inst/book/more-qc.Rmd:30` @ 2f10501 |
| MAD | `type` | both | `R/isOutlier.R:91` |
| MAD | log transform when `log=TRUE` | log2 | `R/isOutlier.R:102` |
| MAD | `min.diff` | NA (off); distance becomes max($\kappa$ MAD, min.diff) when set | `R/isOutlier.R:93`, `:34` |
| MAD | MAD constant | 1.4826 from `formals(mad)$constant` | `R/isOutlier.R:181` |
| MAD | `min.diff` worked example | 0.5 percent mitochondrial (example, not default) | OSCA `inst/book/nuclei-analysis.Rmd:62` @ 2f10501 |
| miQC | `model_type` | "linear" | `R/mixtureModel.R:47` @ a31358e |
| miQC | components `k` | 2 | `R/mixtureModel.R:52-61` |
| miQC | `posterior_cutoff` | 0.75 | `R/filterCells.R:54` @ a31358e |
| miQC | `enforce_left_cutoff` | TRUE | `R/filterCells.R:56` |
| dropkick | `min_genes` | 50; cells below it get label 0 | `dropkick/api.py:463`, `:486` @ bd2647a |
| dropkick | `mito_names` | `^mt-\|^MT-` | `api.py:464` |
| dropkick | `n_hvgs` | 2000 | `api.py:466` |
| dropkick | automatic threshold | multi-Otsu, direction above, on arcsinh gene counts | `api.py:467-469` |
| dropkick | `alphas` | 0.1 | `api.py:470`; LogitNet alpha convention `logistic.py:33` |
| SpotSweeper localOutliers | `metric` | "detected" | `R/localOutliers.R:76` @ 7e6ebf6 |
| localOutliers | `direction` | "lower" | `R/localOutliers.R:76` |
| localOutliers | `n_neighbors` | 36 | `R/localOutliers.R:76` |
| localOutliers | `log` | TRUE (log1p) | `R/localOutliers.R:77`, `:123` |
| localOutliers | `cutoff` | 3 | `R/localOutliers.R:77` |
| findArtifacts | `n_order`, `shape` | 5, "hexagonal" | `R/findArtifacts.R:59-60` |
| findArtifacts | k-means | 2 centres, nstart 25 | `R/findArtifacts.R:160` |

## 5. Proposed singlet approach

Routes per method (sources are listed in section 12):

- **fixed**: port; the rule is a threshold comparison on the metric table.
- **mad**: reimplement from the formulae in section 3; no reference code is copied.
- **miqc**: port the mixture to two-component EM in C++ with the same posterior cutoff.
- **dropkick**: port the heuristic labels; reimplement the penalised classifier in PyTorch without linking the upstream glmnet code.
- **spatial_local**: port the neighbourhood z-score, a direct formula.
- **findArtifacts**: callout only, as a benchmark comparator.

The formulation singlet proposes is a per-section model. Each unit has a latent compromised indicator $z_i\in\{0,1\}$ with a Potts prior on the neighbour graph,

$$p(\mathbf z)\propto\exp\Big\{\gamma\sum_{(i,j)\in E}W_{ij}\,\mathbf 1[z_i=z_j]\Big\},$$

and a two-component Gaussian likelihood on $u_i=(\log(1+n_i),\ \log(1+g_i),\ \operatorname{logit}(p^{\mathrm{mt}}_i+\epsilon),\ \log(1+a_i))$, the log counts, log genes, logit mitochondrial fraction and, when present, log area. EM applies the prior as a mean-field step, $\ell_i\leftarrow\ell_i+\gamma\sum_j W_{ij}(2q_j-1)$, with $\ell_i$ the log-odds from the likelihood, one sparse matrix-vector product per iteration. The output is $P(z_i=1\mid\text{data},\text{neighbours})$ per unit. It is falsified if it does not beat the MAD rule on injected recall at fixed clean retention in section 8, or if its reliability on planted labels is poor.

The core is C++ on CPU: medians by selection, a kd-tree neighbour graph on coordinates, and EM. It needs no GPU. The neighbourhood product is a candidate for a hard-coded CUDA kernel with cuSPARSE at Visium HD scale. PyTorch is used only if the classifier route is kept. Per-metric medians cost O(n) expected, and each neighbourhood statistic costs O(|E|), with |E| = nk. Batches are independent for mad, so inputs can be processed batch by batch in CSR form.

Defaults an agent should use without asking: method mad, $\kappa=3$, log2 on library size, batch_key set to the section column when present and one batch otherwise, and the in-tissue mask applied first. If a batch MAD is zero, the tool requires min_diff and fails otherwise. Set min_genes only from the data, because dropkick's default floor of 50 genes would label every unit below it as label 0 (section 4).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Raw counts, unit by gene |
| read | obs/in_tissue | bool | In-tissue mask, applied before any statistic |
| read | obsm/spatial | float64, n×2 | Coordinates for neighbours |
| read | obsp/spatial_connectivities | sparse float | Neighbour graph, built from coordinates when absent |
| read | obs/section_id | categorical | Batch column for per-section statistics, optional |
| read | obs/cell_area | float32 | Segmentation area, imaging only, optional |
| read | obs/transcript_count | int | Transcripts per cell, imaging only, optional |
| read | var/feature_type | categorical | Marks negative-control probes and codewords, imaging only, optional |
| write | obs/qc_n_counts | int32 | Total counts per unit |
| write | obs/qc_n_genes | int32 | Features with a count above zero |
| write | obs/qc_pct_mt | float32 | Mitochondrial percentage of total counts |
| write | obs/qc_neg_probe_rate | float32 | Negative-control counts over total counts, imaging only |
| write | obs/qc_area | float32 | Area value used by the area rule |
| write | obs/qc_score | float32 | Oriented score; higher is more compromised |
| write | obs/qc_keep | bool | Keep flag |
| write | obs/qc_reason | categorical | Rule that discarded the unit; empty when kept |
| write | uns/qc_thresholds | dict | Thresholds per metric and batch |
| write | uns/qc_params | dict | Method and parameter record |
| write | obsm/qc_metrics | float32, n×p | Metric table, optional |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "mad" | `mad`, `fixed`, `miqc`, `dropkick`, `spatial_local` | Unit rule. Default mad; spatial_local for spatially clustered artefacts; fixed is a comparator only. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA only for the neighbourhood product on large inputs. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing or writing members. |
| `overwrite` | boolean | false | — | Replace existing obs/qc_* and uns/qc_* members instead of failing. |
| `batch_key` | string/null | null | — | Obs column giving the batch for medians, MADs and mixtures; null treats the input as one batch. |
| `mito_prefix` | string | "^MT-\|^mt-" | — | Regular expression for mitochondrial gene names; mitochondrial rules need at least one match. |
| `fixed` | object | — | — | Hand-set bounds for the fixed-cutoff comparator; null disables a bound. |
| `fixed.min_counts` | integer/null | null | min 0 | Minimum total counts per unit. |
| `fixed.min_genes` | integer/null | null | min 0 | Minimum detected genes per unit. |
| `fixed.max_pct_mt` | number/null | null | min 0; max 100 | Maximum mitochondrial percentage of total counts. |
| `mad` | object | — | — | Options for the per-metric, per-batch robust outlier rule. |
| `mad.nmads` | number | 3 | min 0 | Scaled MADs from the batch median that define an outlier. |
| `mad.min_diff` | number/null | null | min 0 | Minimum distance from the median for an outlier; required when a batch MAD is zero. |
| `mad.log_library` | boolean | true | — | Apply log2 to library-size and gene metrics before the MAD rule. |
| `miqc` | object | — | — | Options for the two-component mixture of mitochondrial fraction on detected genes. |
| `miqc.model_type` | string | "linear" | `linear`, `spline`, `polynomial`, `one_dimensional` | Regression form of mitochondrial fraction on detected genes. |
| `miqc.posterior_cutoff` | number | 0.75 | min 0; max 1 | Keep a unit when its compromised-component posterior is at most this value. |
| `miqc.enforce_left_cutoff` | boolean | true | — | Prevent a U-shaped filter boundary, as in miQC's filterCells. |
| `miqc.seed` | integer | 0 | min 0 | Seed for mixture initialisation. |
| `dropkick` | object | — | — | Options for the penalised logistic classifier trained on heuristic labels. |
| `dropkick.n_hvgs` | integer | 2000 | min 1 | Highly variable genes used as classifier features. |
| `dropkick.alpha` | number | 0.1 | min 0; max 1 | Elastic-net mixing: 0 is ridge, 1 is lasso. |
| `dropkick.seed` | integer | 0 | min 0 | Seed for cross-validation folds. |
| `spatial_local` | object | — | — | Options for the neighbourhood robust z-score rule. |
| `spatial_local.n_neighbors` | integer | 36 | min 1 | Nearest spatial neighbours used as the local reference; the focal unit is excluded. |
| `spatial_local.direction` | string | "lower" | `lower`, `higher`, `both` | Which tail of the local robust z-score flags a unit. |
| `spatial_local.cutoff` | number | 3 | min 0 | Absolute robust z-score cutoff for an outlier. |
| `spatial_local.log` | boolean | true | — | Apply log1p to each metric before scoring. |
<!-- PARAMS:AUTO:END -->

Parameters are grouped by method: fixed, mad, miqc, dropkick and spatial_local each apply only to their own method, while batch_key and mito_prefix apply to every metric-based rule. Seeds sit inside miqc and dropkick because only those fits are stochastic. Metrics absent from the input are not scored, and rules needing mitochondrial counts are skipped when mito_prefix matches no gene. The tool writes flags and does not copy the matrix; the filtered matrix is a subset on obs/qc_keep.

## 7. MCP tool

Tool `singlet_spatial_preproc_spatial_unit_qc_filtering`, definition in `tasks/mcp/singlet_spatial_preproc_spatial_unit_qc_filtering.json`. Example call and result:

```json
{"dataset": "section.singlet", "method": "mad", "batch_key": "section_id", "mad": {"nmads": 3, "log_library": true}, "device": "cpu"}
```

```json
{"dataset": "section.singlet", "status": "completed",
 "wrote": ["obs/qc_n_counts", "obs/qc_n_genes", "obs/qc_pct_mt", "obs/qc_score", "obs/qc_keep", "obs/qc_reason", "uns/qc_thresholds", "uns/qc_params"],
 "summary": {"n_units": "<int>", "n_kept": "<int>", "n_discarded": "<int>", "discarded_by_reason": {"<rule>": "<int>"}, "method": "mad"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: the call returns inline, and status queued applies only when the neighbour graph must be built inside the call (see P1). Stochastic: only miqc and dropkick use a seed, and mad, fixed and spatial_local are deterministic. The dry_run flag returns estimated seconds, peak memory and device from unit, feature and edge counts, without writing members.

## 8. Benchmarks

Shared protocol: every accuracy benchmark applies the in-tissue mask first and scores all methods on the same matrix. Recall uses a threshold set on clean units to keep 95 percent of them; retention guardrails use each method's own flags at its section 4 default, or at a tuned setting chosen on clean units only. Each benchmark reports results over seeds 1 to 10 as a mean and a range. Scores are oriented as in obs/qc_score. No published ground truth exists for spatial units, so the accuracy benchmark below is proposed.

### B1. Planted-artefact recovery on a Visium section (proposed)

- **Goal**: Test whether a unit rule recovers injected dryspots, edge hangnails and isolated low-depth spots without discarding clean spots or whole annotated domains.
- **Ground truth**: planted simulation. The indicator is set by the generator (recipe step 5) and stored outside the QC code path; the effect size of an injected spot is the ratio of its thinned to original total counts.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| `DLPFC_artifact` (sample Br2743_ant), SpotSweeper package data | SpotSweeper `R/DLPFC_artifact.R`: single-sample subset of the Hukki-Myers et al. 2023 dataset (doi:10.1101/2023.02.15.528722), distributed by spatialLIBD | Spot-based spatial transcriptomics, human DLPFC, one section; unit count — | §12 | Layer labels for domain retention: see section 10 |

- **Generator recipe** (proposed; numbered, applied to the unit set):
  1. Apply the in-tissue mask; all later steps act on in-tissue spots only.
  2. Dryspots: choose 3 centres uniformly among in-tissue spots; thin every spot within two hexagonal rings (18 neighbours) of a centre by binomial retention $f\sim\mathrm{Uniform}(0.05,0.2)$ applied to each count.
  3. Hangnails: thin every in-tissue spot within two hexagonal steps of an off-tissue spot with $f\sim\mathrm{Uniform}(0.2,0.5)$.
  4. Isolated low-depth spots: choose 1 percent of the remaining in-tissue spots at random, none adjacent to another injected spot, and thin them with $f\sim\mathrm{Uniform}(0.01,0.1)$.
  5. Label as injected any spot from steps 2 to 4; all other in-tissue spots are clean, and off-tissue spots are excluded from every metric.
  6. Repeat for seeds 1 to 10 and report the effect-size distribution of each class before any threshold is fixed.

  Binomial thinning lowers depth and gene detection while leaving the mitochondrial fraction approximately unchanged in expectation, so the injected artefact is a depth artefact.

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Injected recall at fixed clean retention | Threshold $t$ set on clean spots so that 95 percent of clean spots score at or below $t$; recall is the share of injected spots above $t$ | higher | primary | — |
| AUROC of `qc_score` | Area under the ROC curve for injected versus clean units, rank-based with ties averaged | higher | primary | — |
| Minimum per-domain clean retention | Smallest share of clean spots kept by the method's own flags within any annotated domain | higher | guardrail | — |
| Overall clean retention | Share of clean spots kept by the method's own flags | higher | guardrail | — |

- **Comparators**: fixed cutoffs (Scanpy metric table, 8ed52d9) with one bound per metric set on clean units to keep 95 percent of them; MAD rule (scuttle, d3476eb, $\kappa=3$, per section); miQC posterior (a31358e); SpotSweeper localOutliers (7e6ebf6, $k=36$, cutoff 3); findArtifacts as a hangnail callout (7e6ebf6).
- **Protocol**: the shared protocol. The proposed mixture posterior is reported with reliability curves and an expected calibration error, with no limit set until results exist.
- **Acceptance criterion**: proposed, not from the literature: recall at 0.95 clean retention of at least 0.90 for dryspots and hangnails; AUROC of at least 0.95; minimum per-domain clean retention of at least 0.90.
- **Known pitfalls**: injections stronger than natural variation let every method score well, so effect sizes must be reported; a rule that removes a whole domain can win on recall, which the domain guardrail prevents.

### P1. Performance and scaling

Wall time and peak memory per stage (metric computation, median and MAD, neighbour graph build, neighbourhood product, mixture EM, filtering) at 10^4, 10^5 and 10^6 units on CPU and CUDA, against scanpy calculate_qc_metrics, scuttle isOutlier, miQC, dropkick and SpotSweeper localOutliers. Hold fixed the CSR input, $k=36$, thread count, number of batches and hardware. The neighbourhood stage should scale with edges rather than with pairwise distances. No literature threshold exists, so the criterion is the fitted exponent of time against units for each stage.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.in_tissue_detection`: In-tissue region detection for sequencing-based spatial data
  - `spatial-preproc.image_cell_segmentation`: Cell and nucleus segmentation from stain images of spatial transcriptomics sections
- **Feeds**:
  - `spatial-preproc.spatial_depth_normalization`: Spatially aware library-size normalization
  - `spatial-domains.single_slice_domains`: Single-slice spatial domain identification
  - `spatial-deconv-mapping.spot_celltype_proportions`: Reference-based cell type proportion estimation for spots and bins
- **Reads**: `layers/counts`, `obs/in_tissue`, `obsm/spatial`, `obsp/spatial_connectivities`, `obs/section_id`, `obs/cell_area`, `obs/transcript_count`, `var/feature_type`
- **Writes**: `obs/qc_n_counts`, `obs/qc_n_genes`, `obs/qc_pct_mt`, `obs/qc_neg_probe_rate`, `obs/qc_area`, `obs/qc_score`, `obs/qc_keep`, `obs/qc_reason`, `uns/qc_thresholds`, `uns/qc_params`, `obsm/qc_metrics`
<!-- CHAINING:AUTO:END -->

Spatial preprocessing, after in-tissue detection and before depth normalisation, domain identification and spot deconvolution.

## 10. Risks, pitfalls and open questions

- **Vendor imaging thresholds.** The Xenium negative-control warning and error levels (0.02 and 0.05 per control per cell) and vendor bounds for cell area and transcripts per cell are not checked against vendor documentation, so no imaging rule carries a vendor default.
- **Missing benchmark ingredients.** No dataset with expert damage labels, no registered replicate-section pair and no imaging dataset with negative-control features is cited here. The corresponding benchmarks are withheld until a dataset and truth definition exist.
- **SpotSweeper details.** The package code contains no dryspot-specific function, and its vignette states that contiguous dry-edge regions require a region-level method. The 2024 preprint text was not used here, so any dryspot method beyond the package code is unverified. No later journal version was confirmed. The spot count and layer labels of `DLPFC_artifact` are not determined here (no R installation), and the terms of the underlying raw data are not checked.
- **Dependency and model assumptions.** dropkick bundles a Fortran copy of glmnet 2.0-5 (section 12), so its classifier is reimplemented and no glmnet code is ported. miQC calls `flexmix` without a family argument (`R/mixtureModel.R:52-61`), so the component family is flexmix's default for a numeric response; the flexmix manual was not checked.
- **Unsettled literature.** Whether spatial rules keep thin layers and tissue edges, whether QC should precede or follow in-tissue detection and ambient correction, and how MAD and log-scale rules behave on Visium HD bins with mostly zero counts are unresolved in the cited sources.
- **Risks and first experiment.** findArtifacts needs mitochondrial genes, so it cannot be applied to panels without them. MAD and log transforms need a rule for zero counts. The first experiment is B1 on the packaged section with seeds 1 to 10, reporting the injected effect-size distribution before any acceptance threshold is fixed.

## 11. References

R1. Hippen AA, Falco MM, Weber LM, Erkan EP, Zhang K, Doherty JA, Vähärautio A, Greene CS, Hicks SC. miQC: an adaptive probabilistic framework for quality control of single-cell RNA-sequencing data. *PLoS Computational Biology* 2021. doi:10.1371/journal.pcbi.1009290 — verified (corpus)

R2. Heiser CN, Wang VM, Chen B, Hughey JJ, Lau KS. Automated quality control and cell identification of droplet-based single-cell data using dropkick. *Genome Research* 2021. doi:10.1101/gr.271908.120 — verified (corpus)

R3. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)

R4. McCarthy DJ, Campbell KR, Lun ATL, Wills QF. Scater: pre-processing, quality control, normalization and visualization of single-cell RNA-seq data in R. *Bioinformatics* 2017. doi:10.1093/bioinformatics/btw777 — verified (corpus)

R5. Amezquita RA, Lun ATL, Becht E, et al. Orchestrating single-cell analysis with Bioconductor. *Nature Methods* 2020. doi:10.1038/s41592-019-0654-x — verified (corpus)

R6. Amezquita R, Lun A, Hicks S, Gottardo R. Orchestrating single-cell analysis with Bioconductor (OSCA), advanced chapters: more-qc. Bioconductor book, 2022. https://bioconductor.org/books/release/OSCA/ — verified (corpus)

R7. Ilicic T, Kim JK, Kolodziejczyk AA, Bagger FO, McCarthy DJ, Marioni JC, Teichmann SA. Classification of low quality cells from single-cell RNA-seq data. *Genome Biology* 2016. doi:10.1186/s13059-016-0888-1 — verified (corpus)

R8. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)

R9. Totty M, Hicks S, Guo B. SpotSweeper: spatially-aware quality control for spatial transcriptomics. *bioRxiv* 2024. doi:10.1101/2024.06.06.597765 — verified (repo)

R10. Totty M, Hicks S, Guo B. SpotSweeper: spatially-aware quality control for spatial transcriptomics, R package version 1.9.3, commit 7e6ebf6. https://github.com/MicTott/SpotSweeper — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | Maintainers Ilan Gold, Philipp Angerer, Severin Dicks; authors include Alex Wolf and Adam Gayoso (pyproject.toml) | BSD 3-Clause (LICENSE) | Fixed-cutoff metrics | port |
| https://github.com/LTLA/scuttle | Aaron Lun (aut, cre); Davis McCarthy (aut) (DESCRIPTION) | GPL-3 (DESCRIPTION); no LICENSE file at repository root | MAD outlier rule and comparator | reimplement |
| https://github.com/greenelab/miQC | Ariel Hippen (aut, cre); Stephanie Hicks (aut) (DESCRIPTION) | BSD-3-Clause (LICENSE) | Mixture model | port |
| https://github.com/KenLauLab/dropkick | Cody Heiser (setup.py) | MIT (LICENSE); bundled glmnet 2.0-5 Fortran source under GPL-2 (`dropkick/src/glmnet/DESCRIPTION`) | Heuristic labels and classifier | port (labels); reimplement (classifier) |
| https://github.com/MicTott/SpotSweeper | Michael Totty (aut, cre); Stephanie Hicks (aut); Boyi Guo (aut) (DESCRIPTION) | MIT + file LICENSE (copyright holder "SpotSweeper authors") | Local outliers; artefact callout; packaged DLPFC section | port (localOutliers); callout (findArtifacts) |
| https://github.com/LieberInstitute/spatialDLPFC | — | LICENSE file present; licence type not confirmed | Stated source of the packaged DLPFC section (`R/DLPFC_artifact.R`) | callout |
