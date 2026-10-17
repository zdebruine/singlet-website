---
id: spatial-deconv-mapping.spot_celltype_proportions
title: Reference-based cell type proportion estimation for spots and bins
area: spatial-deconv-mapping
scope: core
paradigm: model-based
literature_status: contested
priority: P0
depends_on: [spatial-preproc.spatial_unit_qc_filtering, harmonization.gene_identifier_mapping, qc.low_quality_cell_detection, annotation.cluster_label_assignment]
feeds: [spatial-domains.cell_niche_identification, spatial-genes.celltype_specific_spatial_variation, spatial-genes.cooccurrence_by_distance, communication.spatial_lr_scoring]
reads: [layers/counts, var/gene_id, obs/<cells_per_spot_key>, var/<feature_key>, reference:layers/counts, reference:var/gene_id, reference:obs/<label_key>, reference:obs/<batch_key>, reference:var/<feature_key>, models/cell2location_encoder]
writes: [obsm/<method>_proportions, obsm/<method>_proportions_q05, obsm/<method>_proportions_q95, obsm/<method>_abundance_q05, obsm/<method>_abundance_q50, uns/<method>_cell_types, uns/<method>_params, uns/<method>_diagnostics, models/<method>_reference]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_deconv_mapping_spot_celltype_proportions
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Reference-based cell type proportion estimation for spots and bins

> For each multi-cell spot or coarse bin of a spatial transcriptomics section, estimate the fraction of its cells belonging to each annotated reference cell type, using a labelled single-cell or single-nucleus reference from the same tissue.

## 1. Question

Given a unit-by-gene UMI matrix from a multi-cell spatial platform (Visium spots or bins of comparable footprint) and an annotated scRNA-seq or snRNA-seq reference of the same tissue, estimate for every unit the fraction of its cells belonging to each reference type, as proportions that sum to one, and for one method the absolute expected cell counts. A correct answer matches the true composition of the unit's footprint: the planted composition in simulation, and for real tissue only an orthogonal proxy such as imaging-based cell typing aggregated to the footprint, because no direct measurement of a spot's composition exists.

## 2. Why this task matters and where the field stands

A Visium spot (55 µm diameter) covers several cells and may hold only part of a cell [R10], so questions about which types sit where and neighbour each other need composition estimates first (consumers in section 9). The task is **contested**: the problem form is agreed, the method ranking is not.

- **Rankings differ across benchmarks.** In the benchmark of Li et al. [R11], as summarised by the best-practices chapter [R10], cell2location was best on simulated data, and SpatialDWLS and RCTD were best on real data by an overall score over four accuracy metrics. Li et al. compared 18 methods on 50 real and simulated datasets and report CARD, cell2location and Tangram as the top performers [R12]. Yan and Sun compared 14 methods on four datasets and report cell2location, RCTD and SpatialDWLS ahead on RMSE, Pearson correlation and Jensen-Shannon distance, and a fall in accuracy as spot size shrinks [R13].
- **Uncertainty is uneven.** cell2location returns posterior quantiles [R1]; DestVI and stereoscope return point estimates (section 3.4); RCTD and Seurat transfer return none.

Open problems:

- **Reference-to-spatial shift** (chemistry, nuclei versus cells, donor): the most likely failure in practice and the least benchmarked (B2).
- **Close subtypes** that differ in a few genes cannot be separated in few-cell units; the prior sets the split.
- **Unmodelled types** leak their mass onto the most similar reference type; no detector is validated.
- **Hyperpriors** (cells per unit, detection) are recommended to be set from histology [R10] but are not validated against orthogonal counts.
- **Metric choice**: scale-sensitive and distribution-shape metrics rank methods differently (section 3.6).
- **Units smaller than a spot** are outside every validated regime.

singlet's catalogue (354 million cells, about 40 percent with author annotations) allows reference-shift evaluation across studies (B2).

## 3. Theory and insight

### 3.1 Estimands and notation

| Symbol | Meaning |
|---|---|
| $s,t,g$ | unit, reference type, gene; $S,T,G$ their numbers |
| $x_{sg}$ | raw UMI count |
| $n_{st}$, $N_s=\sum_t n_{st}$ | cells of type $t$ in the footprint of unit $s$, and their total |
| $p_{st}=n_{st}/N_s$ | true composition |
| $\hat p_{st}$ | estimate; each row sums to one over the kept types |
| $w_{st}$ | cell2location abundance: expected number of cells of type $t$ in unit $s$ |
| $c_{tg}$ | expected UMI count of gene $g$ in a cell of type $t$ (signature) |
| $l_s,\ m_g,\ s_g$ | unit detection scale, gene capture efficiency, additive background |
| $\theta_g$ | NB concentration, $\mathrm{Var}=\mu+\mu^2/\theta_g$ |

The `proportions` output estimates the fraction of cells, $\hat p_{st}\approx n_{st}/N_s$, not of RNA; abundance outputs (cell2location only) estimate $w_{st}$ in cells. The planted truth in B1 and B2 is the simulator's realised $p_{st}=m_{st}/N_s$; real tissue has no direct truth (B3 is a consistency proxy).

### 3.2 The mixture model and its regime

A unit's counts sum its cells'. If every cell of type $t$ has expected profile $c_{t\cdot}$, then for raw counts

$$\mathbb E[x_{sg}\mid n]=\sum_{t} n_{st}\,c_{tg},\qquad \mu_{sg}=l_s\Big(m_g\sum_t w_{st}c_{tg}+s_g\Big),$$

where the second adds technology terms. Regime of validity: signatures must describe the same types in the target tissue, since chemistry, nucleus-versus-cell or donor differences enter as gene-specific bias; partly covered cells and ambient RNA are absorbed only by $s_g$; and a unit must hold several cells, because with one or two the composition is a discrete assignment that a type-mean model describes poorly (accuracy fell as spots shrank in [R13]).

### 3.3 Negative-binomial count models

Independent negative-binomial variables with a common success probability sum to a negative binomial with the sizes added. Stereoscope uses this closure with a shared $p_g$, capture efficiency $e_g$, loadings $\beta_{st}$ and a dummy component, $x_{sg}\sim\mathrm{NB}(l_se_g\sum_t\beta_{st}c_{tg}+\kappa_s\epsilon_g,\,p_g)$ [R10]. The dummy absorbs technology shift but competes with a missing type for counts; its column is dropped before normalising (section 4), so absorbed mass leaves the proportions.

cell2location uses $x_{sg}\sim\mathrm{NB}(\mu_{sg},\theta_g)$ with the mean of section 3.2, $l_s=y_s$ and $\theta_g=\phi_g^{-2}$, $\phi_g\sim\mathrm{Exp}$ (section 4). Abundances have a gamma prior with a low-rank mean,

$$w_{st}\sim\mathrm{Gamma}(\mu_{st}v,\;v),\qquad \mu_{st}=\sum_{r=1}^{R}z_{sr}u_{rt},$$

where $z_{sr}$ are unit-group loadings with total mean $n_s\sim\mathrm{Gamma}(N,1)$, $N$ the expected cells per unit, $u_{rt}$ are group-by-type weights and $R=50$. A gamma with shape $\mu v$ and rate $v$ has mean $\mu$ and variance $\mu/v$, so larger $v$ (5 by default) pulls abundances more tightly toward the group-structured mean. The detection scale has prior $y_s\sim\mathrm{Gamma}(\alpha_{\rm det},\alpha_{\rm det}/y_e)$. Inference is stochastic variational. Signatures come from a separate NB regression (or class means) and enter as fixed point estimates, so intervals are conditional on the signatures and the variational family.

### 3.4 Point-estimate models

RCTD models pixel counts as Poisson-lognormal, renormalises reference means by a platform effect from a bulk decomposition, chooses one lognormal scale on a grid and fits per-pixel weights by iteratively reweighted least squares (section 4). In doublet mode pixels are also classified as singlet or doublet, but the all-type weights returned are the full-mode fit, which the openproblems comparator normalises. DestVI trains a conditional VAE on the reference, then fits per-unit proportions and continuous per-type latent states by MAP; its loss combines the NB likelihood, a mixture-of-Gaussians prior on the latent states, an entropy penalty on proportions and an exponential prior on additional-type loadings (section 4). Both return a penalised mode, so uncertainty must come from elsewhere, and penalty settings can rank types differently at equal fit.

### 3.5 Heuristic baselines and what a model adds

NNLS solves $\tilde w_s=\arg\min_{w\ge0}\lVert x_s-Mw\rVert_2^2$ with $M$ the genes-by-types matrix of per-cell mean raw counts, then $\hat p_{st}=\tilde w_{st}/\sum_{t'}\tilde w_{st'}$. It is the maximum-likelihood estimate under constant-variance Gaussian noise with non-negativity, a model with a misspecified noise model: it over-weights highly expressed genes, is not simplex-constrained before normalising, gives no uncertainty, and returns sparse, switching solutions when types are collinear. Regime: if a unit's counts are a depth-scaled copy of the pooled cells, $x_s\approx a_s\sum_t n_{st}c_t$, the normalisation removes the scalar $a_s$ and returns the cell fraction when $M$ holds raw per-cell means and capture is equal across types. SPOTlight and NMFreg replace $M$ by NMF topics aggregated to types; Seurat transfer scores are prediction scores, not mixture fractions. A model adds a count-appropriate noise model, an abundance prior, explicit technology terms and intervals, which pay off only if the model fits the data (B1 to B3).

### 3.6 Metrics

Jensen-Shannon distance in the openproblems form: for type $t$, normalise the true and predicted columns over units to sum one, giving $P$ and $Q$; with $M=\tfrac12(P+Q)$ and natural logarithms

$$\mathrm{JSD}_t=\sqrt{\tfrac12\mathrm{KL}(P\,\Vert\,M)+\tfrac12\mathrm{KL}(Q\,\Vert\,M)},$$

averaged over types. Its maximum is $\sqrt{\ln2}\approx0.833$, not the 1 in the metric configuration; it is invariant to rescaling a column and non-finite if a predicted column is all zero. $R^2$ is scikit-learn's uniform average over types of $1-\sum_s(p_{st}-\hat p_{st})^2/\sum_s(p_{st}-\bar p_t)^2$ (truth first); a column with zero variance scores 1 if its numerator is also zero and 0 otherwise, and types with little variance can score very negatively. JSD asks whether each type's spatial distribution is right, $R^2$ whether each unit's value is right; they can rank methods oppositely, so both are reported.

### 3.7 Pitfalls shown by the benchmark designs

- **Output summary changes rankings.** The normalised 5th percentile of abundance, a posterior mean and a point estimate are different estimators; the openproblems wrapper uses the first.
- **Circularity and tuned priors.** Simulated units are built from the cells given to methods as reference, and the cell2location prior of 20 cells matches the simulated mean of 19.5, so methods see exact signatures and a correct prior.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| cell2location | model-based | Hierarchical NB model with gamma abundance prior, expected-cells and detection hyperpriors; signatures from a separate NB regression or class means, held fixed; variational inference | [R1] |
| RCTD (spacexr) | model-based | Poisson-lognormal pixel likelihood, bulk-estimated platform-effect renormalisation of reference means, one grid-chosen noise scale, per-pixel IRWLS weights; doublet, multi and full modes | [R2] |
| stereoscope | model-based | NB model: reference type rates, then per-unit non-negative loadings with gene capture efficiency and a dummy noise component, fitted by MAP (scvi-tools implementation) | [R3] |
| DestVI | model-based | Conditional VAE decoder from the reference; per-unit proportions and continuous per-type latent states fitted by MAP with a mixture prior on the states | [R4] |
| Tangram | model-based (learned mapping) | PyTorch optimisation of a cell-to-unit mapping on the union of top marker genes per type; projected type scores normalised to sum one | [R5] |
| CARD | model-based | Constrained maximum likelihood with a spatial-correlation prior from a Gaussian kernel on coordinates; smoothing weight chosen from a fixed grid by the objective | [R6] |
| SPOTlight | hybrid | Marker-seeded NMF of the reference, then per-unit NNLS onto the topic profiles | [R7] |
| Seurat transfer | heuristic | SCTransform and PCA on both datasets, anchors, transfer prediction scores used as proportions | [R8] |
| NNLS | heuristic | Per-unit non-negative least squares onto raw per-cell class means, then division by the sum | — |
| NMFreg | hybrid | NMF of the normalised reference, components assigned to types by majority vote, per-unit NNLS onto components | [R9] |

cell2location, RCTD, stereoscope and DestVI are the model-based references in the studies of section 2, and cell2location is the method the best-practices chapter demonstrates [R10]. The heuristic and hybrid methods are kept as comparators in every benchmark, because a model must beat a convex fit to class means to justify its cost.

Defaults for the methods singlet implements. Repositories: OP = openproblems-bio/task_spatial_decomposition@892ab48 (config = `src/methods/<method>/config.vsh.yaml`), c2l = BayraktarLab/cell2location@afb07fd, scvi = scverse/scvi-tools@5555ecc, spacexr = dmcable/spacexr@9f5dc33.

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| cell2location | detection_alpha | 20.0 | OP config:34; c2l `cell2location/models/_cell2location_module.py`:84 |
| | n_cells_per_location | 20 (OP); 8.0 (package) | OP config:38, script.py:95; c2l module:86 |
| | hard_coded_reference | true: class means, no batch | OP config:42, script.py:75-81 |
| | amortised; num_samples; sc_batch_size | false; 1000; 2500 | OP config:46, :50, :54 |
| | max_epochs reference; spatial | 250; 30000 (test value 1000) | OP config:61, :65-67; c2l `_cell2location_model.py`:172 |
| | prior strength $v$; groups $R$ | 5.0; 50 | c2l module:97, :82 |
| | likelihood | Gamma-Poisson with concentration $\theta_g=\phi_g^{-2}$ | c2l module:461-475 |
| | abundance prior | Gamma with mean $zu$, rate $v$; $n_s\sim\mathrm{Gamma}(N,1)$ | c2l module:277-280, :355-362 |
| | output | normalised 5th percentile of $w_{st}$ | OP script.py:136-137 |
| stereoscope | max_epochs reference; spatial | 100; 1000 | OP config:19, :23 |
| | scvi training defaults | 400 epochs, lr 0.01, batch 128 | scvi `external/stereoscope/_model.py`:85-92, :319-324 |
| | output | softplus loadings, dummy column dropped, rows normalised | scvi `external/stereoscope/_module.py`:163-172; OP script.py:42 |
| DestVI | max_epochs reference; spatial | 500; 10000 (test value 1000) | OP config:19, :23-25 |
| | spatial batch size; KL weights | min(int(n_obs/20+3), 128); 3.0 | OP script.py:39-40 |
| | reference model | early stopping on validation ELBO, train fraction 0.9 | OP script.py:27-33 |
| | scvi training defaults | 2000 epochs, lr 0.003, batch 128 | scvi `model/_destvi.py`:582-589 |
| | loss weights | reconstruction 3.0, entropy of proportions 2.0, additional-type prior 1.0, global prior 1.0 | scvi `module/_mrdeconv.py`:497-504, :640-652 |
| | output | softplus loadings, additional types dropped, rows normalised | scvi `model/_destvi.py`:214-270; OP script.py:42 |
| | status | FutureWarning: moves to scviva-tools in 1.5, deprecated in 1.6 | scvi `model/_destvi.py`:97-103 |
| RCTD | create.RCTD | max_cores 4; gene_cutoff 0.000125; fc_cutoff 0.5; gene_cutoff_reg 0.0002; fc_cutoff_reg 0.75; UMI_min 100; UMI_max 2e7; counts_MIN 10; UMI_min_sigma 300; CELL_MIN_INSTANCE 25; MAX_MULTI_TYPES 4; CONFIDENCE_THRESHOLD 5; DOUBLET_THRESHOLD 20 | spacexr R/spacexr.R:43-44 |
| | mode; pipeline | doublet; fitBulk, choose_sigma_c, fitPixels | spacexr R/spacexr.R:99, :103-105 |
| | likelihood | Poisson-lognormal | spacexr R/prob_model.R:3 |
| | OP overrides | UMI_min_sigma 100; CELL_MIN_INSTANCE 1; cores = job cpus | OP `rctd/script.R`:55-64 |
| | output | row-normalised all-type weights (full-mode fit; pair weights are separate) | OP script.R:72; spacexr R/RCTD_helper.R:74, R/postProcessing.R:24-25 |
| NNLS | solver | scipy.optimize.nnls per unit on raw per-cell class means | OP `nnls/script.py`:21-38 |
| | output | negatives clipped, divided by row sum | OP script.py:41-42 |

## 5. Proposed singlet approach

**Routes.** Port: cell2location, stereoscope and DestVI (from the scvi-tools commit read) and the openproblems simulator and metrics. Reimplement: RCTD, and NNLS as a new batched solver. Callout: Tangram, CARD, SPOTlight, Seurat transfer, NMFreg.

**Model proposed.** The default is the cell2location-type NB model of section 3.3 with three changes, each testable in section 8.

1. Signatures are fitted once per reference and stored. Gene-level parameters ($m_g$, $\theta_g$, $s_g$) are fitted on a subsample of units and the rest are inferred in batches with those globals fixed, making the spatial step streamable. Units are independent only given the globals, an approximation checked on B1.
2. A per-unit prior mean of cells when `cell2location.cells_per_spot_key` is set, replacing the single global $N$; B1 compares it with the constant prior.
3. An amortised encoder (`cell2location.amortised`) trained in PyTorch on pseudo-spots from catalogue cells of training studies only, with concentrations, cell counts and depth spanning the simulator and platform ranges. Weights live at `models/cell2location_encoder` and are distributed only if B1 and B2 criteria are met.

Proportions default to the normalised 5th percentile of abundance, matching the openproblems comparator; `mean` is the posterior mean of per-draw composition.

**Falsifiers** (proposed thresholds): the default is rejected if on B1 its mean $R^2$ is not above NNLS at two of three concentrations, or interval coverage is outside 0.90 ± 0.10, or the encoder is more than 0.05 below per-unit inference in mean $R^2$; or if on B2 its $\Delta R^2$ exceeds that of NNLS.

**ML stack.** PyTorch (with Pyro for the variational families, as cell2location does) for the reference model, spatial model and encoder. The fixed-signature step is a small hot model and is hard-coded: batched projected-Newton updates of non-negative NB regression over the genes-by-types matrix, using cuSPARSE on CUDA and the C++ core on CPU. RCTD is CPU only; NNLS has a CPU reference and a batched CUDA solver.

**Agent defaults.** `method` cell2location, `proportion_summary` q05, `num_samples` 1000, `n_cells_per_location` 20 unless a per-unit count exists, `detection_alpha` 20, `batch_key` only for multi-donor references. Request `dry_run` above 10,000 units. Ask for `reference` and `label_key`; build no catalogue reference unless asked.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts per unit |
| read | var/gene_id | string | feature ids, matched exactly to the reference |
| read | obs/`<cells_per_spot_key>` | numeric | per-unit cell count from histology or nuclei, when set |
| read | var/`<feature_key>`, reference:var/`<feature_key>` | bool | gene mask in both datasets, when set |
| read | reference:layers/counts, reference:var/gene_id | sparse int, string | reference counts and ids |
| read | reference:obs/`<label_key>` | categorical | cell-type labels, defining the output columns |
| read | reference:obs/`<batch_key>` | categorical | donor or study, when set |
| read | models/cell2location_encoder | model | trained encoder, only when `amortised` |
| write | obsm/`<method>`_proportions | float32 | units by kept types; rows sum to one (fraction of cells) |
| write | obsm/`<method>`_proportions_q05, `_q95` | float32 | 5th and 95th percentile of per-draw composition; cell2location with `write_posterior` |
| write | obsm/`<method>`_abundance_q05, `_q50` | float32 | abundance quantiles in expected cells; same condition |
| write | uns/`<method>`_cell_types | string array | type names in column order |
| write | uns/`<method>`_params | record | method, reference handle, parameters, seed, device, library versions |
| write | uns/`<method>`_diagnostics | record | ELBO history or optimiser status, reference cells per type, dropped types; RCTD spot classes |
| write | models/`<method>`_reference | float32 or model | genes by types signature matrix (cell2location, rctd, nnls) or fitted reference model (stereoscope, destvi) |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `reference` | string | required | — | Labelled reference dataset (path, URI or workspace handle); read only. Needs layers/counts and var/gene_id. |
| `label_key` | string | required | — | Reference obs column with cell-type labels; at least two types with enough cells are required. |
| `method` | string | "cell2location" | `cell2location`, `stereoscope`, `destvi`, `rctd`, `nnls` | Estimator. cell2location is the default; rctd and nnls are deterministic and need no GPU. |
| `feature_key` | string/null | null | — | Boolean var column present in both datasets selecting genes; null uses all genes shared after filtering. |
| `min_cells_per_type` | integer | 25 | min 1 | Reference types with fewer cells are dropped and listed in types_dropped. |
| `max_epochs` | object | — | — | Training epochs for the reference and spatial models; null keeps method defaults. Ignored by rctd and nnls. |
| `max_epochs.reference` | integer/null | null | min 1 | Reference-model epochs; defaults 250 (cell2location), 100 (stereoscope), 500 (destvi). |
| `max_epochs.spatial` | integer/null | null | min 1 | Spatial-model epochs; defaults 30000 (cell2location), 1000 (stereoscope), 10000 (destvi). |
| `cell2location` | object | — | — | Options used only when method is cell2location. |
| `cell2location.batch_key` | string/null | null | — | Reference obs column naming donor or study; set it to estimate signatures by NB regression with batch, otherwise class means. |
| `cell2location.cells_per_spot_key` | string/null | null | — | Spatial obs column with a per-unit cell count from histology or nuclei; replaces n_cells_per_location. |
| `cell2location.n_cells_per_location` | number | 20 | > 0 | Expected cells per unit when cells_per_spot_key is null; a histology-derived value is preferred. |
| `cell2location.detection_alpha` | number | 20.0 | > 0 | Detection-efficiency hyperprior; larger values constrain its variation across units more tightly. |
| `cell2location.amortised` | boolean | false | — | Infer abundances with the trained encoder at models/cell2location_encoder; fails if the encoder is absent. |
| `cell2location.num_samples` | integer | 1000 | min 1 | Posterior draws per unit used for the summaries. |
| `cell2location.proportion_summary` | string | "q05" | `q05`, `q50`, `mean` | Posterior summary written as proportions: q05 or q50 of abundance, normalised per unit, or mean of per-draw composition. |
| `cell2location.write_posterior` | boolean | false | — | Also write abundance q05 and q50 and the 5th and 95th percentiles of per-draw composition. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. rctd always uses cpu. |
| `seed` | integer | 0 | — | Random seed for training and posterior sampling; rctd and nnls are deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`cell2location.*` options apply only to method cell2location and are ignored with a warning otherwise. `cell2location.batch_key` switches signatures from class means to NB regression with batch; `cells_per_spot_key` takes precedence over `n_cells_per_location`; `amortised` needs the stored encoder; `write_posterior` is available for cell2location only. `max_epochs` applies to cell2location, stereoscope and destvi. Every method writes the same core members, and the proportion rule of each is in section 4. Types with fewer than `min_cells_per_type` reference cells are dropped before fitting. Gene identifiers must match exactly; the unmatched fraction is reported in `warnings`.

## 7. MCP tool

Tool name `singlet_spatial_deconv_mapping_spot_celltype_proportions` (definition in `tasks/mcp/singlet_spatial_deconv_mapping_spot_celltype_proportions.json`).

```json
{"dataset": "section1.singlet", "reference": "ref_snrna.singlet", "label_key": "cell_type",
 "method": "cell2location", "cell2location": {"batch_key": "donor", "cells_per_spot_key": "n_nuclei"}}
```

```json
{"dataset": "section1.singlet", "status": "completed",
 "wrote": ["obsm/cell2location_proportions", "uns/cell2location_cell_types", "uns/cell2location_params",
           "uns/cell2location_diagnostics", "models/cell2location_reference"],
 "summary": {"method": "cell2location", "proportion_summary": "q05", "n_units": "<int>", "n_types": "<int>",
             "types_dropped": [], "converged": "<bool>", "warnings": []},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Angle-bracket values are filled at execution time. Long-running: yes for cell2location, stereoscope and destvi, which return `queued` with a `job_id` when the estimate exceeds the inline limit; rctd and nnls are inline. Stochastic: yes through `seed` for the three trained methods; rctd and nnls are deterministic. Dry run: seconds, peak memory and device for the chosen method, unit count, reference size and epoch counts.

## 8. Benchmarks

Shared protocol. Metrics $R^2$ and JSD (section 3.6) are computed on the units-by-types matrix of kept types, with truth and prediction aligned on type names. Each configuration uses seeds 0, 1 and 2 for training and posterior sampling, reporting mean and range; the simulator seed is stated per benchmark. Every method receives the same reference labels and gene set and the section 4 defaults unless a benchmark varies them. Timings record the GPU and CPU model. Acceptance thresholds marked proposed are singlet design criteria, not literature values.

### B1. Planted-proportion benchmark (openproblems design)

- **Goal**: score per-unit proportions against exactly planted composition, with a ceiling and a floor control.
- **Ground truth**: planted simulation. Per unit, $\beta_s\sim\mathrm{Dir}(\alpha\mathbf 1_T)$, $N_s\sim\mathrm{Unif}\{10,\dots,29\}$ (mean 19.5), $m_s\sim\mathrm{Mult}(N_s,\beta_s)$, truth $p_{st}=m_{st}/N_s$ (the realised cell fraction, not $\beta_s$). Counts pool $m_{st}$ source cells per type (drawn with replacement); $n_{\rm UMI}\sim\mathrm{Unif}\{1000,\dots,4999\}$ UMIs are then drawn multinomially from the pool, independent of $N_s$. Coordinates are uniform random (simulator `script.py`:101-149 at the OP commit).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_mouse_pancreas_atlas | OP@892ab48, `resources_test/common`; accession — | scRNA-seq, mouse pancreas; size — | — | types with fewer than 25 cells removed (script.py:25) |
| Simulated units | OP simulator, seed 42 | 1000 units per $\alpha\in\{0.5,1,5\}$ (config variants) | derived | split into masked spatial data, reference and solution with counts floored |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| jensen_shannon_distance | section 3.6, mean over types | lower | primary | [R15] |
| r2 | section 3.6, mean over types | higher | primary | [R16] |
| Interval coverage | fraction of $(s,t)$ with $p_{st}$ inside the 5th to 95th percentile of per-draw composition; cell2location only | target 0.90 | guardrail | — |

- **Comparators**: true_proportions (JSD 0, $R^2$ 1), random_proportions (Dirichlet with reference label counts as concentration), cell2location, DestVI, stereoscope, RCTD, Seurat transfer, Tangram, NNLS, NMFreg.
- **Protocol**: the seed of the UMI draw is set explicitly (the published script uses numpy's unseeded global state, `script.py`:139). Score each $\alpha$, then average. A secondary arm gives cell2location the planted $N_s$ with log-normal noise (log-scale sd 0.3, proposed) as `cells_per_spot_key`.
- **Acceptance** (proposed): a method qualifies if its $R^2$ exceeds the random_proportions floor by at least 0.2 at every $\alpha$ and its mean $R^2$ is not below NNLS; cell2location coverage lies within 0.90 ± 0.10.
- **Known pitfalls**: random coordinates mean spatial priors cannot help; the floor follows reference label frequencies, so it is not an uninformative baseline.

### B2. Study-held-out reference (proposed)

- **Goal**: measure how much scores depend on reference cells from the units' own source, and robustness to a reference from another batch or study.
- **Ground truth**: planted simulation as B1 (seed 42), with units built from the cells of a held-out batch or study H.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_mouse_pancreas_atlas split by `obs["batch"]` | as B1; batch identifier per the common-dataset format | scRNA-seq, mouse; batch count read from the file | — | needs at least two batches |
| singlet catalogue, one annotated tissue with at least two studies | internal | scRNA-seq or snRNA-seq; tissue chosen by the recipe | per study | study terms checked before use |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| $\Delta R^2$ | $R^2$ with reference A minus $R^2$ with reference B, same seeds | lower | primary | [R16] |
| $\Delta$JSD | JSD with B minus JSD with A | lower | guardrail | [R15] |

- **Comparators**: cell2location, RCTD, stereoscope, DestVI, Seurat transfer, NNLS.
- **Protocol** (generator recipe): (1) harmonise labels of all batches to one set and record the mapping; (2) choose held-out H; (3) simulate units from H with the B1 generator at $\alpha=0.5,1,5$; (4) reference A: all cells of H, including the generating cells (circular); (5) reference B: cells of other batches with the same labels and no shared donors; (6) fit every method with A and with B and score; (7) repeat for each H and report the distribution of $\Delta R^2$.
- **Acceptance** (proposed): $\Delta R^2>0.1$ flags reference overfit for that method; the default must not exceed NNLS in $\Delta R^2$.
- **Known pitfalls**: label harmonisation can itself cause a drop, so it is fixed before scoring; reference A is circular by design, so $\Delta R^2$ measures the optimism of the benchmark, not accuracy on new data.

### B3. Marker consistency on paired Visium and snRNA-seq (proposed)

- **Goal**: a weak check on real tissue, where no composition truth exists.
- **Ground truth**: none for composition. The consistency target for type $t$ in unit $s$ is the mean log-normalised expression of its 10 top markers (one-versus-rest ranking on the reference, fixed before the spatial data are used).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Myocardial infarction, control samples | Kuppe et al. [R14], as used in [R10]; accession — | human heart; four Visium control sections; snRNA-seq reference of 41,663 nuclei from four control patients, 11 labelled types | — | gene symbols converted to Ensembl ids as in [R10] |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Marker consistency | Spearman correlation across units between $\hat p_{st}$ and the marker score, for types with mean $\hat p_{st}>0.05$ | higher | guardrail | — |

- **Comparators**: cell2location (chapter tutorial settings), RCTD, stereoscope, DestVI, Seurat transfer, NNLS.
- **Protocol**: fit each method on the four sections with the snRNA-seq reference and score per type.
- **Acceptance** (proposed): a method with correlation below 0.3 for any such type is flagged for inspection; no ranking is taken from this check.
- **Known pitfalls**: markers and deconvolution use the same counts, so the check is partly circular; four sections are not a population estimate.

### P1. Performance and scaling

Measure wall time, peak host and GPU memory and throughput (units per second) separately for the reference fit and the unit mapping, on CPU and CUDA, at 1k, 10k and 100k units and reference sizes of 10k, 100k and 1M cells with 20 types (1k is the B1 size; typical Visium sections have 3 to 5k units [R10]). Comparators: cell2location, DestVI and stereoscope on GPU with the section 4 epoch counts, Tangram (1000 epochs), RCTD and Seurat transfer on CPU, NNLS per unit with scipy and the batched CUDA solver. Hold the gene set, labels, epoch counts, batch sizes and thread count fixed, and record epochs executed and early stopping, because epoch counts differ by two orders of magnitude (250 to 30000). Report the median of three repeats. The NB models cost $O(SGT)$ per epoch because $\mu_{sg}$ is evaluated for every entry including zeros, so time should grow linearly in $S$ at fixed $G$ and $T$; a departure is a finding. Proposed criteria: the batched NNLS solver at least 10 times faster than the per-unit loop at 100k units; the default no slower than cell2location at equal epochs; peak memory linear in units when streaming.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Feeds**:
  - `spatial-domains.cell_niche_identification`: Cellular niche identification from neighbourhood composition
  - `spatial-genes.celltype_specific_spatial_variation`: Cell-type-specific spatial expression variation (spatial DE within a cell type)
  - `spatial-genes.cooccurrence_by_distance`: Cell-type co-occurrence across distance scales
  - `communication.spatial_lr_scoring`: Spatially constrained ligand-receptor communication scoring
- **Reads**: `layers/counts`, `var/gene_id`, `obs/<cells_per_spot_key>`, `var/<feature_key>`, `reference:layers/counts`, `reference:var/gene_id`, `reference:obs/<label_key>`, `reference:obs/<batch_key>`, `reference:var/<feature_key>`, `models/cell2location_encoder`
- **Writes**: `obsm/<method>_proportions`, `obsm/<method>_proportions_q05`, `obsm/<method>_proportions_q95`, `obsm/<method>_abundance_q05`, `obsm/<method>_abundance_q50`, `uns/<method>_cell_types`, `uns/<method>_params`, `uns/<method>_diagnostics`, `models/<method>_reference`
<!-- CHAINING:AUTO:END -->

Workflows (proposed): Visium composition (`spatial-preproc.spatial_unit_qc_filtering`, this task, `spatial-domains.cell_niche_identification`); reference preparation (`qc.low_quality_cell_detection`, `annotation.cluster_label_assignment`, `harmonization.gene_identifier_mapping` on both datasets, then this task).

## 10. Risks, pitfalls and open questions

- **Published benchmark details.** For [R11], [R12] and [R13] only abstract-level findings are available, so their datasets and accessions, truth definitions, the four-metric combination rule of [R11] and per-method scores are unread; they appear in section 2 as reported rankings and supply no benchmark or threshold here. SpatialDWLS was not read and is not implemented.
- **Reference and data gaps.** The openproblems NNLS configuration cites an unrelated paper (AutoGeneS, doi:10.1016/j.cels.2021.05.006), so NNLS has no primary reference here, and the NMFreg wrapper cites Slide-seq [R9] without a separate NMFreg source. The Lin entry [R15] takes its DOI from the openproblems metric configuration; its title and venue come from general knowledge. The size and licence of cxg_mouse_pancreas_atlas and the Kuppe et al. accession are absent from the repositories read.
- **Software status.** stereoscope and DestVI in scvi-tools 1.5.1 warn of a move to scviva-tools and removal in 1.6 (section 4); the licence and release of scviva-tools are unread, and ports use the commit read.
- **Proxy truth for real tissue.** No matched imaging and Visium or Visium HD dataset is selected, so footprint-level accuracy at 55 µm and finer bins has no benchmark here. Recipe once chosen: register sections and record the residual in µm; type cells with the imaging panel's own annotation; take the overlap-area-weighted type fraction per footprint as truth, excluding zero-weight units; use an independent reference; score $R^2$ and JSD per resolution; proposed criterion $R^2$ at least 0.1 above NNLS.
- **Technical risks.** Reference shift is the likeliest failure (B2 measures it). Unmodelled types and close subtypes have no validated detector. Hyperprior effects are measured on simulation only. The amortised encoder may not generalise beyond its training studies, and unit independence given subsample-fitted globals is an approximation. Catalogue studies carry their own data terms, which apply to encoder weights and signatures trained on them.
- **First experiment.** B1 for cell2location and NNLS at $\alpha=1$, seed 42, varying `n_cells_per_location` over 10, 20 and 30 and comparing the q05, q50 and mean summaries, with interval coverage.

## 11. References

R1. Vitalii Kleshchevnikov, Artem Shmatko, Emma Dann et al. Cell2location maps fine-grained cell types in spatial transcriptomics. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01139-4 — verified (corpus)
R2. Dylan M. Cable, Evan Murray, Luli S. Zou et al. Robust decomposition of cell type mixtures in spatial transcriptomics. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-00830-w — verified (corpus)
R3. Alma Andersson, Joseph Bergenstråhle, Michaela Asp et al. Single-cell and spatial transcriptomics enables probabilistic inference of cell type topography. *Communications Biology* 2020. doi:10.1038/s42003-020-01247-y — verified (corpus)
R4. Romain Lopez, Baoguo Li, Hadas Keren-Shaul et al. DestVI identifies continuums of cell types in spatial transcriptomics data. *Nature Biotechnology* 2022. doi:10.1038/s41587-022-01272-8 — verified (corpus)
R5. Tommaso Biancalani, Gabriele Scalia, Lorenzo Buffoni et al. Deep learning and alignment of spatially resolved single-cell transcriptomes with Tangram. *Nature Methods* 2021. doi:10.1038/s41592-021-01264-7 — verified (corpus)
R6. Ma Y, Zhou X. Spatially informed cell-type deconvolution for spatial transcriptomics. *Nature Biotechnology* 2022;40:1349–1359. doi:10.1038/s41587-022-01273-7 — verified (repo)
R7. Marc Elosua-Bayes, Paula Nieto, Elisabetta Mereu, Ivo Gut, Holger Heyn. SPOTlight: seeded NMF regression to deconvolute spatial transcriptomics spots with single-cell transcriptomes. *Nucleic Acids Research* 2021. doi:10.1093/nar/gkab043 — verified (corpus)
R8. Tim Stuart, Andrew Butler, Paul Hoffman et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R9. Samuel G. Rodriques, Robert R. Stickels, Aleksandrina Goeva et al. Slide-seq: a scalable technology for measuring genome-wide expression at high spatial resolution. *Science* 2019. doi:10.1126/science.aaw1219 — verified (corpus)
R10. Leon Hetzel, Anna Schaar, Lukas Heumos. Spatial deconvolution. In: Single-cell best practices (online book chapter; year not recorded). — partial (repo)
R11. Bin Li, Wen Zhang, Chuang Guo et al. Benchmarking spatial and single-cell transcriptomics integration methods for transcript distribution prediction and cell type deconvolution. *Nature Methods* 2022. doi:10.1038/s41592-022-01480-9 — verified (corpus)
R12. Haoyang Li, Juexiao Zhou, Zhongxiao Li et al. A comprehensive benchmarking with practical guidelines for cellular deconvolution of spatial transcriptomics. *Nature Communications* 2023. doi:10.1038/s41467-023-37168-7 — verified (search)
R13. Lulu Yan, Xiaoqiang Sun. Benchmarking and integration of methods for deconvoluting spatial transcriptomic data. *Bioinformatics* 2023;39(1):btac805. doi:10.1093/bioinformatics/btac805 — verified (search)
R14. Christoph Kuppe, Ricardo O. Ramirez Flores, Zhijian Li et al. Spatial multi-omic map of human myocardial infarction. *Nature* 2022. doi:10.1038/s41586-022-05060-x — verified (corpus)
R15. Lin J. Divergence measures based on the Shannon entropy. *IEEE Transactions on Information Theory*. doi:10.1109/18.61115 — partial (repo)
R16. Jeremy Miles. R-squared, adjusted R-squared. *Encyclopedia of Statistics in Behavioral Science* 2005. doi:10.1002/0470013192.bsa526 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/BayraktarLab/cell2location | Vitalii Kleshchevnikov, Artem Shmatko, Emma Dann, Artem Lomakin, Alexander Aivazidis (setup.cfg) | Apache-2.0 (LICENSE; setup.cfg) | reference model and spatial model, version 0.1.5 | port |
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml) | BSD-3-Clause (LICENSE; Yosef Lab copyright) | stereoscope and DestVI implementations at 5555ecc | port |
| https://github.com/dmcable/spacexr | Dylan Cable (DESCRIPTION) | GNU General Public License v3.0 (LICENSE; DESCRIPTION) | RCTD reference implementation, version 2.2.1 | reimplement |
| https://github.com/openproblems-bio/task_spatial_decomposition | openproblems-bio (organization in `_viash.yaml`) | MIT (declared in `_viash.yaml`; no LICENSE file at the root) | planted simulator, metrics and method wrappers at 892ab48 | port (simulator, metrics) |
| https://github.com/broadinstitute/Tangram | Tommaso Biancalani, Gabriele Scalia (setup.py) | BSD-3-Clause (LICENSE.md) | comparator, run through the openproblems wrapper | callout |
| https://github.com/YMa-lab/CARD | Ying Ma (DESCRIPTION) | GPL (>= 3) (DESCRIPTION; LICENSE.md) | comparator with spatial prior | callout |
| https://github.com/MarcElosua/SPOTlight | Marc Elosua-Bayes, Zachary DeBruine, Helena L. Crowell (DESCRIPTION) | GPL-3 (DESCRIPTION; LICENSE.md) | comparator | callout |
| https://github.com/satijalab/seurat | Rahul Satija and contributors (DESCRIPTION) | MIT + file LICENSE (DESCRIPTION) | heuristic comparator, anchor transfer | callout |
| https://github.com/scipy/scipy | SciPy developers (LICENSE.txt) | BSD-style (LICENSE.txt) | `scipy.optimize.nnls`, CPU oracle for NNLS | callout |
