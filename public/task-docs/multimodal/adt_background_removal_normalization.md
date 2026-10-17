---
id: multimodal.adt_background_removal_normalization
title: ADT background removal and normalization
area: multimodal
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [ingest-quant.feature_barcode_counting, cell-calling.cell_vs_empty_droplet_calling, qc.low_quality_cell_detection, clustering.cell_partitioning]
feeds: [dim-reduction.normalized_cell_embedding, multimodal.paired_joint_embedding, multimodal.adt_positivity_calling, multimodal.protein_imputation_from_rna]
reads: [layers/counts, var/is_isotype, uns/empty_droplets_adt, obs/<batch_key>, obs/<cell_type_key>]
writes: [X, obs/adt_background_mean, obs/adt_ambient_fraction, obsm/totalvi_latent, models/totalvi, uns/adt_normalization]
devices: [cpu, cuda]
mcp_tool: singlet_multimodal_adt_background_removal_normalization
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# ADT background removal and normalization

> Convert droplet-based antibody-derived tag (ADT) UMI counts into protein values that are comparable across cells by removing ambient antibody, cell-specific non-specific binding and the per-cell capture scale, and by stating the assumption each correction makes.

## 1. Question

Given the raw ADT UMI matrix of called cells (cells by proteins), and optionally the ADT matrix of empty droplets, isotype-control names, batch labels, cell-type labels and the paired RNA counts, which protein matrix of the same shape best represents surface abundance, with each cell's background estimated where the data allow? Surface abundance is not observed, so correctness is defined through proxies: isotype controls and empty droplets as negative controls, RNA-defined lineages and RNA-protein concordance as cross-modal checks, and a planted simulation (section 8). The output is a normalised or denoised matrix `X` and, depending on the method, per-cell background estimates.

## 2. Why this task matters and where the field stands

In CITE-seq, oligonucleotide-tagged antibodies are counted as UMIs alongside transcripts [R1]. A called cell's ADT profile mixes specific binding, cell-specific non-specific binding, ambient antibody captured by every droplet of the channel, and a per-cell capture scale [R2][R3]. ADT values show a negative peak for non-specific binding and a positive peak for specific binding [R10].

The status is **contested**. CLR, introduced with the assay [R1], is the transform in the Seurat CITE-seq vignettes and in muon [R13]; it uses only the cell's own counts. The Single-cell Best Practices book [R3] recommends dsb [R2] when empty droplets and isotype controls are both available, and CLR otherwise. Model-based alternatives are DecontPro, a Bayesian Poisson ambient and background model [R6]; CellBender, a generative background remover that accepts antibody-capture features [R7]; scAR, which has an ADT feature type [R8]; and totalVI, a joint RNA and protein autoencoder [R4][R5]. ADTnorm aligns per-marker density modes across batches [R9][R10].

Open problems:

- **No accepted ground truth**: every proxy measures part of the problem, none measures surface abundance [R2][R3].
- **Isotype controls as covariates**: dsb assumes they carry no specific signal; a control that binds a lineage-specific population would remove real signal (section 10).
- **Exchangeability**: dsb and DecontPro treat the ambient level in cell droplets as equal to that in empty droplets (section 3).
- **Batch handling**: the book states that no benchmark of batch-correction methods for ADT data exists [R3]; ADTnorm treats alignment as part of the task [R9]; the dsb documentation reports close agreement of pooled and per-batch normalisation in its preprint dataset.
- **Ranking**: the available comparisons were run by the developers of the method under study (dsb on eight datasets [R2]; ADTnorm against 14 methods on 13 datasets [R9]); no independent benchmark on a shared truth is among the cited sources.

## 3. Theory and insight

**Observation model.** For called cell $i$ and protein $t$ the expected count is a capture scale times the sum of specific binding, cell-specific non-specific binding and ambient antibody. No published method fits all terms with one likelihood: each models some terms, estimates others from data outside the cell (empty droplets, isotype controls) and leaves the rest to its transformation.

| Symbol | Meaning |
|---|---|
| $i$, $t$, $T$ | called cell, protein, panel size |
| $y_{it}$, $O_i=\sum_t y_{it}$ | raw ADT UMI count, cell total |
| $e_{mt}$, $m\in\mathcal{E}$, $M=\lvert\mathcal{E}\rvert$ | empty-droplet count, set and number of empty droplets |
| $G_i$ | CLR geometric mean of cell $i$ |
| $c$, $w_{it}$, $b_i$, $u_i$, $\gamma_t$ | dsb pseudocount, step I value, per-cell background mean, covariate, regression slope |
| $\delta_{it}$, $\kappa_{it}$, $a_t$, $r_{k,t}$ | DecontPro ambient fraction, background fraction (in $(0,0.5)$), ambient profile, cell-type-$k$ native profile (each profile sums to one) |
| $\beta_{it}$, $\alpha_{it}\ge 1$, $\pi_{it}$, $\phi_t$, $\mathbf{z}_i$ | totalVI background intensity, foreground scale, background probability, protein dispersion, latent state |

**CLR.** The Seurat form is
$$\mathrm{CLR}_{it}=\log\!\Big(1+\frac{y_{it}}{G_i}\Big),\qquad G_i=\exp\Big(\frac1T\sum_{s=1}^{T}\log(1+y_{is})\Big).$$
The Stoeckius form uses $\log\{(y_{it}+1)/(\prod_s(y_{is}+1))^{1/T}\}$ and is dense. Since $\log(1+0)=0$, zeros leave $G_i$ unchanged, so the Seurat form keeps zeros at zero. When counts are well above 1, $\log(1+y)\approx\log y$ and a common multiplicative scale of the cell cancels; near 0 and 1 it cancels only approximately. A dominant antibody raises $\log G_i$ by about $\tfrac1T\log y_{i,\mathrm{dom}}$ and lowers every other value of that cell by the same amount, the compositional effect [R12]. CLR has no input from empty droplets or other cells.

**dsb.** Step I standardises each protein against the empty droplets,
$$w_{it}=\frac{\log(y_{it}+c)-\mu^{e}_{t}}{\sigma^{e}_{t}},\quad \mu^{e}_{t}=\frac1M\sum_{m}\log(e_{mt}+c),\quad \sigma^{e}_{t}=\mathrm{sd}_m\log(e_{mt}+c),$$
with $c=10$ and a sample standard deviation. A droplet containing only ambient antibody has $w_{it}$ of mean 0 and variance 1 across such droplets by construction, provided the ambient level in cell droplets equals that in empty droplets (exchangeability). Step II fits, for each cell, a two-component one-dimensional Gaussian mixture to its $T$ values $w_{i\cdot}$ (tied or full covariance by BIC) and takes the lower component mean as $b_i$. The covariate $u_i$ is the first principal component of the isotype-control values and $b_i$ (centred, not rescaled, in muon), or $b_i$ alone without controls. Each protein is regressed on $u$ with an intercept and the fitted slope part is removed, $x_{it}=w_{it}-\hat\gamma_t u_i$. The mixture is fitted to $T$ scalars, so its variances become unstable for small panels. The regression is linear in one covariate, and there is no likelihood over counts, so no calibrated uncertainty.

**DecontPro.** The expected count is
$$\mathbb{E}[y_{it}]=O_i\Big\{(1-\kappa_{it})\big[\delta_{it}\,a_t+(1-\delta_{it})\,r_{k(i),t}\big]+\kappa_{it}\Big\},$$
with Poisson noise. The ambient profile $a$ is the normalised pooled profile of the empty droplets, or of the called cells if none are given, and is not fitted. The native profile $r_k$ is fitted per cell type. The fractions $\delta_{it}$ and $\kappa_{it}$ have hierarchical priors whose standard deviations have half-normal priors with the two scale parameters of section 6. The Poisson likelihood has no overdispersion term; if ADT counts are overdispersed it is misspecified and the priors alone control the variance of the fitted fractions. The decomposition depends on the cell-type labels, so label quality matters.

**totalVI.** With $v_{it}\sim\mathrm{Bernoulli}(\pi_{it})$ and $\beta_{it}$ log-normal with batch-dependent parameters,
$$y_{it}\mid v_{it}\sim\mathrm{NB}\big(v_{it}\beta_{it}+(1-v_{it})\beta_{it}\alpha_{it},\,\phi_t\big),\qquad \mathbb{E}[y_{it}]=\pi_{it}\beta_{it}+(1-\pi_{it})\beta_{it}\alpha_{it},$$
where the first term is background and the second foreground. $\pi_{it}$ and $\alpha_{it}$ are functions of the latent $\mathbf{z}_i$, which is shared with the RNA model, so paired RNA counts are required. The model holds for a negative-binomial count family with fixed per-protein dispersion; expectations are Monte Carlo averages under an amortised approximate posterior, which can be overconfident. For a unimodal protein the mixture components are weakly identified; the empirical prior on $\beta$ and the shared latent constrain them.

**Estimands of the outputs.** `X` is, for clr, $\log(1+y_{it}/G_i)$, a unitless log-ratio to the cell's geometric-mean count; for dsb, $x_{it}$, in units of the empty-droplet standard deviation above the protein's mean ambient log level, after removal of the cell-level technical component; for totalvi, the posterior mean of $(1-\pi_{it})\beta_{it}\alpha_{it}$, the expected foreground UMI count (with the background term $\pi_{it}\beta_{it}$ added on request); for decontpro, $\log(1+\hat n_{it})$, where $\hat n_{it}$ is the observed count times the posterior-mean share of the expected count that comes from the native term. `obs/adt_background_mean` is $b_i$ (dsb only); `obs/adt_ambient_fraction` is $\sum_t\hat a_{it}/O_i$, the share of the cell's UMIs allocated to the ambient term by the same posterior-mean allocation (decontpro only).

**Why heuristics work and what a model adds.** CLR works where the capture scale dominates and ambient is a small additive offset: it removes the scale and keeps ratios, but cannot separate background from signal in a cell with few counts. dsb adds the two pieces CLR lacks, a channel-level ambient estimate and a per-cell background estimate, but derives each cell's background from that cell alone. A model adds a likelihood with which methods can be compared, a posterior for each value, priors that share background across cells and batches, and joint estimation of background and covariate effects. Its costs are dependence on the count family and priors, and a latent that can absorb signal.

**Pitfalls.** Isotype controls used as covariates cannot also be used for scoring. The muon default `axis=0` makes a value depend on the cohort; the book uses per-cell normalisation. Benchmarks that use RNA-defined labels favour RNA-informed methods.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CLR, Stoeckius form | heuristic | log of count plus one over the cell's geometric mean of counts plus one; dense | [R1][R13] |
| CLR, Seurat form | heuristic | log1p of count over the exponential of the cell's mean log1p; zeros stay zero | [R13] |
| dsb | hybrid | empty-droplet standardisation of log counts, then per-protein regression on a per-cell technical covariate from isotype controls and a two-component per-cell mixture | [R2] |
| DecontPro | model-based | Poisson model with fixed ambient profile, cell-type native profiles and a uniform background term; hierarchical shrinkage priors; variational Bayes in Stan | [R6] |
| totalVI | model-based | joint RNA and protein autoencoder; protein counts follow a two-component negative-binomial mixture of background and foreground | [R4][R5] |
| CellBender | model-based | unsupervised generative removal of ambient and background counts with an autoencoder prior over cell state; accepts antibody-capture features but takes its cell-type prior from gene expression | [R7] |
| scAR | model-based | autoencoder decoding a native frequency profile and a per-cell noise ratio against an ambient profile, with binomial, Poisson or zero-inflated Poisson counts | [R8] |
| ADTnorm | heuristic | per-marker peak and valley landmarks of each sample's density registered to common locations across samples by functional landmark registration | [R9][R10] |

CLR is the long-standing default [R1]; the book [R3] names dsb the standard when empty droplets and isotype controls both exist; totalVI is the established model-based method for paired RNA and protein data [R4]. dsb also ships a variant for data without empty droplets that is not implemented here. Defaults of the methods singlet implements or compares, read from source:

| Method | Parameter | Value | Source |
|---|---|---|---|
| muon `clr` | axis; flavor | 0; `seurat` | `src/muon/prot/pp.py:203-204` @ 7e65510 |
| Seurat `NormalizeData` | margin (CLR) | 1, each protein across cells; CITE-seq vignettes use 2, each cell across proteins | `R/preprocessing.R:5191` @ 5f67c70; `vignettes/multimodal_vignette.Rmd:135` |
| Seurat CLR | formula | `log1p(x / exp(sum(log1p(x[x > 0])) / length(x)))` | `R/preprocessing.R:5221`, `R/preprocessing5.R:285` |
| muon `dsb` | pseudocount; denoise_counts; isotype_controls | 10; True; None | `pp.py:19-21` |
| muon `dsb` | scale_factor; quantile_clipping; quantile_clip; random_state | `standardize`; False; (0.001, 0.9995); 0 | `pp.py:24-28` |
| muon `dsb` | empty set when no range is given | every barcode that is not a called cell | `pp.py:113-115` |
| muon `dsb` | empty and cell matrices | converted to dense, `log(x + pseudocount)` | `pp.py:146-147` |
| muon `dsb` | step II | tied and full two-component mixtures, random initialisation, lower BIC wins; PCA with `whiten=True`; OLS with intercept | `pp.py:158-187` |
| R `dsb` | pseudocount; quantile.clip; fast.km | 10; (0.001, 0.9995); FALSE (`Mclust` with two components; PCA with `scale = TRUE`) | `R/dsb.r:96-100, 188, 235, 243` @ aab2127 |
| DecontPro | delta_sd; background_sd | 2e-5; 2e-6 | `R/decontPro.R:58-59, 81-82, 103-104` @ fdb2651 |
| DecontPro | initial delta; initial background; maximum variational iterations; seed | 1e-4; 1e-2; 50000; 12345 | `R/decontPro.R:173-176`; `R/stan_helpers.R:12-13` |
| DecontPro | decontaminated counts | counts times native share of the fitted rate | `R/stan_helpers.R:76-91` |
| totalVI | n_latent; protein_dispersion; gene_likelihood; latent_distribution | 20; `protein`; `nb`; `normal` | `src/scvi/model/_totalvi.py:138-142` @ 5555ecc |
| totalVI | empirical_protein_background_prior | None, which means True above 10 proteins | `_totalvi.py:98-103, 143` |
| totalVI | include_protein_background | False | `_totalvi.py:415` |
| scAR | feature_type; count_model; sparsity | `mRNA`; `binomial`; 0.9 (its ADT example sets 0.6) | `scar/main/_scar.py:144, 210-212` @ df7adef |

## 5. Proposed singlet approach

- **Routes.** CLR (both forms) and dsb: port from muon. DecontPro: port the model definition and priors, with a PyTorch fit in place of Stan variational inference. totalVI: reimplement in PyTorch from the documented equations. CellBender, scAR, ADTnorm, Seurat and the dsb R package: callout.
- **Proposed default.** `method=auto` resolves to dsb when an empty-droplet matrix and at least one isotype control exist, and to CLR (Seurat form, per cell) otherwise, following the book rule [R3].
- **Model-based formulation proposed (not implemented).** An empirical-Bayes background model: $y_{it}\sim\mathrm{NB}(\mu_{it},\phi_t)$ with $\mu_{it}$ the DecontPro mean of section 3. The ambient profile has a prior shared across datasets with the same antibody clone, learned from the catalogue; $\kappa_{it}$ has a prior located by the cell's isotype controls. The output is $\hat x_{it}=\mathbb{E}[O_i(1-\kappa_{it})(1-\delta_{it})r_{k(i),t}]$, the expected native UMI count, with posterior intervals; without empty droplets it falls back to the catalogue prior for $a$. It is rejected if it fails the B1 criterion, if at $\rho\ge0.3$ its B2 median Spearman correlation is not at least 0.05 above dsb, or if its nominal 90 percent intervals cover the planted counts at a rate more than 5 points from 90 percent.
- **Machine learning.** PyTorch for the totalVI and DecontPro models; CLR and dsb are hard-coded because their operations are fixed-shape and hot.
- **Kernels and devices.** CLR: a segmented reduction of $\log(1+y)$ over CSR rows, then an elementwise log1p of $y/G$ on nonzeros; per-protein CLR needs a second pass. dsb: (1) chunked column mean and standard deviation of $\log(e+c)$ over empty droplets, so no dense empty matrix is formed (unlike the muon reference, section 4); (2) a batched per-cell two-component EM over the $T$ values and the covariance of $[w_{\mathrm{iso}},b]$; (3) per-protein regression sums; (4) the output; memory beyond the output is $O(N)+O(T)$. CPU: threads over cells with SIMD in the EM. CUDA: one thread block per batch of cells, cuSPARSE for row sums.
- **Defaults an agent uses without asking.** `method=auto` and the section 6 defaults; the agent sets `empty_droplets`, `dsb.isotype_controls`, `decontpro.cell_type_key` and `totalvi.batch_key`.

## 6. Inputs, outputs and parameters

Members are addressed per modality; the protein modality unless marked. `layers/counts` is never changed.

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int, cells by proteins | raw ADT UMI counts of called cells |
| read | layers/counts (RNA) | sparse int, cells by genes | paired RNA counts of the same cells; totalvi only |
| read | var/is_isotype | bool per protein | isotype-control flag; default source of `dsb.isotype_controls` |
| read | uns/empty_droplets_adt | sparse int, barcodes by proteins | empty-droplet ADT counts in the same protein order; required by dsb, optional for decontpro |
| read | obs/`batch_key` | categorical | batch labels; totalvi only |
| read | obs/`cell_type_key` | categorical | cell-type labels; decontpro only |
| write | X | float32, cells by proteins | normalised or denoised matrix; the scale of each method is defined in section 3 |
| write | obs/adt_background_mean | float32 | $b_i$; dsb only |
| write | obs/adt_ambient_fraction | float32 | $\sum_t\hat a_{it}/O_i$; decontpro only |
| write | obsm/totalvi_latent | float32, cells by `n_latent` | posterior mean of $\mathbf{z}_i$; totalvi only |
| write | models/totalvi | model file | fitted model; totalvi only |
| write | uns/adt_normalization | dict | requested and resolved method, parameters, seed, isotype names used, software versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle with the protein modality. |
| `layer` | string | "counts" | — | Layer holding raw integer ADT UMI counts of called cells (cells by proteins) on the protein modality. |
| `method` | string | "auto" | `auto`, `clr`, `dsb`, `totalvi`, `decontpro` | auto uses dsb when empty-droplet counts and an isotype control exist, otherwise clr. totalvi needs paired RNA counts; decontpro needs cell-type labels. |
| `empty_droplets` | string | "uns/empty_droplets_adt" | — | Member holding the empty-droplet ADT matrix (barcodes by proteins, same protein order). Required by dsb; optional for decontpro; unused by clr and totalvi. |
| `clr` | object | — | — | Options for method clr. |
| `clr.flavor` | string | "seurat" | `seurat`, `stoeckius` | seurat: log1p over the cell geometric mean, zeros stay zero. stoeckius: pseudocount 1, dense output. |
| `clr.axis` | integer | 1 | `0`, `1` | 1 normalises each cell across proteins. 0 normalises each protein across cells, so values depend on the cohort. |
| `dsb` | object | — | — | Options for method dsb. |
| `dsb.pseudocount` | number | 10 | > 0 | Pseudocount added inside the logarithms of step I. |
| `dsb.denoise_counts` | boolean | true | — | true applies step II (per-cell background and regression); false stops after step I. |
| `dsb.isotype_controls` | array/null | null | — | Isotype control names used as covariates. null uses var/is_isotype flags; an empty list disables the covariate. Unmatched names are skipped and reported. |
| `dsb.scale_factor` | string | "standardize" | `standardize`, `mean_subtract` | standardize divides step I by the empty-droplet standard deviation; mean_subtract only centres. |
| `dsb.quantile_clip` | array/null | null | — | Lower and upper output quantiles for clipping, lower below upper. null disables clipping; (0.001, 0.9995) is the muon setting. |
| `totalvi` | object | — | — | Options for method totalvi. |
| `totalvi.n_latent` | integer | 20 | min 1 | Latent dimension of the joint RNA and protein model. |
| `totalvi.batch_key` | string/null | null | — | obs column with batch labels used as the batch covariate. null fits one batch. |
| `totalvi.empirical_background_prior` | boolean/null | null | — | null initialises the protein background prior empirically when more than 10 proteins exist; false uses random initialisation. |
| `totalvi.include_protein_background` | boolean | false | — | false writes the foreground expectation; true adds the background term pi times beta. |
| `decontpro` | object | — | — | Options for method decontpro. |
| `decontpro.cell_type_key` | string/null | null | — | obs column with cell-type labels defining the native profiles. Required for decontpro. |
| `decontpro.delta_sd` | number | 2e-05 | > 0 | Scale of the half-normal prior on the standard deviation of the ambient fractions. |
| `decontpro.background_sd` | number | 2e-06 | > 0 | Scale of the half-normal prior on the standard deviation of the background fractions. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Random seed for dsb mixture initialisation and the totalvi and decontpro fits. Ignored by clr. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing the normalisation. |
| `overwrite` | boolean | false | — | Replace existing X and other output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`auto` resolves to dsb when `empty_droplets` exists and at least one isotype control is available (`dsb.isotype_controls` or `var/is_isotype`), otherwise to clr. Options of a method are used only when that method runs. dsb pools all cells and all empty droplets and has no batch option. `decontpro` needs `decontpro.cell_type_key`; without an empty-droplet matrix it uses the pooled profile of the called cells. `totalvi` needs paired RNA counts. `dsb.quantile_clip` takes two numbers with the lower below the upper, or null for no clipping. `seed` governs the dsb mixture initialisation and the totalvi and decontpro fits and is ignored by clr.

## 7. MCP tool

Tool name `singlet_multimodal_adt_background_removal_normalization` (definition in `tasks/mcp/singlet_multimodal_adt_background_removal_normalization.json`). Example call and compact result; angle-bracket values show the shape, not measurements.

```json
{
  "dataset": "/data/example_cite.singlet",
  "method": "dsb",
  "dsb": {"isotype_controls": ["Mouse-IgG1", "Mouse-IgG2a"]},
  "seed": 0
}
```

```json
{
  "dataset": "/data/example_cite.singlet",
  "status": "completed",
  "wrote": ["X", "obs/adt_background_mean", "uns/adt_normalization"],
  "summary": {
    "method_used": "dsb",
    "n_cells": "<int>",
    "n_proteins": "<int>",
    "n_empty_droplets": "<int>",
    "isotype_background_rho": "<float or null>",
    "flags": []
  },
  "provenance_id": "<id>"
}
```

- **Long-running**: clr and dsb complete inline; totalvi and decontpro may return `queued` with a `job_id` when the dry-run estimate exceeds the inline limit, a runtime setting.
- **Stochastic**: dsb (mixture initialisation), totalvi and decontpro. With the same seed, device and thread count, clr and dsb reproduce their output; totalvi and GPU reductions may differ in the last digits across devices.
- **Dry-run estimate**: `seconds`, `peak_memory_gb` and `device` from cost models (not measurements) over $N$, $M$, $T$ and nonzeros for the streaming dsb path, over dense $N\times T$ for decontpro, and over $N$, $T$, epochs and $d$ for totalvi.
- **Summary keys**: `isotype_background_rho` is the mean absolute Spearman correlation between the isotype controls not used as covariates and $b_i$ (dsb only; null when none remain); `flags` lists events such as a degenerate mixture fit or an unmatched isotype name.

## 8. Benchmarks

**Shared protocol.** Every method receives the same filtered cell set, empty-droplet matrix and protein order. Stochastic methods use seeds 0 to 4; report the median over seeds and the range. Spearman correlations average ties. Methods that use RNA or RNA-derived labels (totalvi, CellBender, decontpro in B1) are marked RNA-informed and reported separately wherever RNA defines the truth or the metric. Acceptance thresholds are proposed design choices unless a paper is named. Hardware and thread counts are recorded.

### B1. Negative controls and lineage separation on real CITE-seq (proposed)

- **Goal**: measure residual non-specific signal and RNA-defined lineage separation without a planted truth.
- **Ground truth**: proxies. (i) An isotype control carries no specific signal, so its normalised value should not track the technical background $b^{\mathrm{ref}}_i$, the dsb step II mean from raw counts (pseudocount 10), computed once for all methods. (ii) Lineages T, B, NK, CD14 monocyte, erythroid come from RNA only (Leiden at one fixed resolution, labelled by CD3E, MS4A1, NCAM1, CD14, HBB); a marker protein is positive in its lineage, negative in the other four.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| NeurIPS 2021 bone-marrow CITE-seq | [R14], [R3]; `surface-protein/cite_quality_control.h5mu`, `surface-protein/cite_raw.h5mu` (book lamindb); GEO GSE194122 | human bone marrow, 12 donors; 106,515 cells, 140 proteins; 24,807,643 unfiltered droplets | — | four isotype controls; markers CD3, CD19-1, CD14-1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| M1 held-out isotype residual | mean absolute Spearman correlation between held-out isotype values and $b^{\mathrm{ref}}_i$ | lower | primary | design |
| M2 separation $d'$ | CD3 (T), CD19 (B), CD14 (monocyte) against the other four lineages: $(\mu_{\mathrm{pos}}-\mu_{\mathrm{neg}})/\sqrt{(\sigma^2_{\mathrm{pos}}+\sigma^2_{\mathrm{neg}})/2}$ (affine-invariant); median | higher | primary | design |
| M3 RNA-protein Spearman | normalised protein against log-normalised RNA (CD3E, CD19, CD14) within lineages of at least 100 cells; median | higher | guardrail; circular for RNA-informed methods | [R11] |

- **Comparators**: raw log1p; CLR; dsb (muon; R package as cross-check); scAR (sparsity 0.6); ADTnorm (donor as sample); totalVI, CellBender and DecontPro with the RNA-cluster labels (all RNA-informed).
- **Protocol**: dsb takes each of the six two-isotype subsets as covariates; every method is scored on the other two (mean reported).
- **Acceptance criterion** (proposed): M1 at most 0.10 and 50 percent below raw log1p; M2 at least 90 percent of CLR; M3 within 0.02 of CLR (methods without RNA).
- **Known pitfalls**: isotype controls may bind receptors in a biology-dependent way, so a low M1 can mean over-correction; M2 checks this.

### B2. Planted ambient and background simulation (proposed)

- **Goal**: recover known native protein counts after a known ambient profile and per-cell background are added.
- **Ground truth**: planted simulation; the truth is the native count $n_{it}$ before ambient and background are added.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated ADT counts | recipe below; ambient profile $a$ is the mean empty-droplet profile of the B1 dataset | synthetic: 8 cell types, 140 proteins, 5,000 or 20,000 cells, 50,000 empty droplets | — | 18 settings, 5 seeds each |

Recipe: (1) native mean $m_{kt}=0$ with probability 0.5, else log-normal with median 40 UMIs and $\sigma=0.8$; four isotype-like proteins are 0 in every type. (2) Cell $i$: uniform type $k(i)$, scale $c_i\sim\mathrm{LogNormal}(0,0.3)$, $n_{it}\sim\mathrm{NB}(c_i m_{k(i)t},\text{size }5)$. (3) Ambient $e_{it}\sim\mathrm{Poisson}(\rho\bar N a_t)$, $\bar N$ the mean native total, $\rho\in\{0.1,0.3,1.0\}$; empty droplets follow the same law. (4) Background $b_{it}\sim\mathrm{Poisson}(s_i\nu_t)$, $s_i\sim\mathrm{LogNormal}(\ln\beta,0.5)$, $\nu_t\sim U(0.5,1.5)$, $\beta\in\{0,2,10\}$. (5) $y=n+e+b$.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| M1 per-protein Spearman | Spearman correlation across cells between $X$ and $n_{it}$ for each protein with varying planted counts; median | higher | primary | design |
| M2 on/off AUC | per protein, AUC of $X$ separating cells of types with $m_{kt}>0$ from types with $m_{kt}=0$; median | higher | primary | design |
| M3 interval coverage | for methods returning posterior intervals, fraction of $(i,t)$ with $n_{it}$ inside the nominal 90 percent interval | target 0.90 | guardrail | design |

- **Comparators**: CLR (both forms); dsb with and without isotype controls; DecontPro with planted labels; scAR (ambient profile supplied, sparsity 0.9 and 0.6). totalVI and CellBender need paired RNA, which is not simulated.
- **Acceptance criterion** (proposed): at $\rho\ge0.3$ the best method has median M1 at least 0.05 above CLR, and methods returning intervals have M3 within 0.05 of 0.90.
- **Known pitfalls**: the additive generator matches no compared model exactly, so rankings may differ on real data; at $\beta=0$ and $\rho=0.1$ the task barely discriminates.

### P1. Performance and scaling

Scales: 10,000, 100,000 and 1,000,000 cells (and 10,000,000 for the streaming claim of clr and dsb) with 140 proteins, generated by the B2 recipe, and the B1 dataset with its 24,807,643 unfiltered droplets. Empty-droplet counts of $10^5$, $10^6$ and 24,807,643 give a scaling curve for dsb. Measure wall time, peak resident memory and cells per second on CPU and CUDA against muon CLR and dsb, the R dsb package, totalVI, DecontPro, scAR and CellBender. Hold fixed protein count, seeds, hardware, threads, totalVI epochs and latent size, scAR epochs and sparsity, DecontPro prior scales. The dense conversion of the unfiltered B1 matrix is $24{,}807{,}643\times140\times8$ bytes, about 27.8 GB (arithmetic, not a measurement). Acceptance (proposed): peak memory of the streaming dsb path does not grow with $M$ beyond per-protein moments and never exceeds that of muon dsb; wall time is at most that of muon dsb at 100,000 cells and above.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.feature_barcode_counting`: Feature-barcode (ADT, hashtag, lipid-tag and guide) counting from FASTQ
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Feeds**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `multimodal.paired_joint_embedding`: Paired joint embedding of RNA with a second or third modality
  - `multimodal.adt_positivity_calling`: Protein positivity calling (gating) for CITE-seq surface markers
  - `multimodal.protein_imputation_from_rna`: Protein (ADT) imputation from RNA
- **Reads**: `layers/counts`, `var/is_isotype`, `uns/empty_droplets_adt`, `obs/<batch_key>`, `obs/<cell_type_key>`
- **Writes**: `X`, `obs/adt_background_mean`, `obs/adt_ambient_fraction`, `obsm/totalvi_latent`, `models/totalvi`, `uns/adt_normalization`
<!-- CHAINING:AUTO:END -->

No named workflow is assigned. The task sits in CITE-seq preprocessing: counting, cell calling, quality control, ADT normalisation, joint embedding. The RNA ambient profile (`ambient.profile_estimation`) is a different quantity and is not an input.

## 10. Risks, pitfalls and open questions

- **Exchangeability and the empty set.** dsb and DecontPro assume the ambient level in cell droplets equals that in empty droplets, yet cell droplets also contain protein from lysed cells; muon treats every non-cell barcode as empty. First experiment: on the B1 dataset compare empty-droplet protein distributions with those of the lowest-UMI called cells, then score dsb with and without the isotype covariate on held-out isotypes, and fix the B1 thresholds before comparing other methods.
- **Isotype controls.** Whether the isotype controls of the B1 dataset bind in a biology-dependent way was not measured, so over-correction by dsb step II is untested.
- **Sensitivity not characterised.** The panel size below which the per-cell mixture is unreliable (muon needs random initialisation because a fitted variance collapsed to zero, `pp.py:158-159`); DecontPro's response to prior scales and label quality; scAR's sparsity (default 0.9, its ADT example 0.6); whether totalVI's foreground output or the background-inclusive output serves downstream tasks better.
- **Evidence not read.** The per-dataset comparisons of [R2] and [R9]; the DecontPro, scAR and CellBender papers beyond their repositories; totalVI benchmark numbers; the author list of [R6]; and ThresholdR, a 2025 ADT denoiser reported to be compared with dsb and CellBender.
- **Data gaps.** No matched CITE-seq and flow-cytometry dataset, and no expert labels independent of ADT (the book's annotation labels come from ADT clusters), were identified, so flow concordance and ADT-only label separation are not benchmarks here. The ADTnorm package bundles 422,682 cells from 13 studies with 9 markers and manual-gating labels, but no empty droplets or isotype controls. The licence and access path of the unfiltered B1 matrix are unestablished. Whether the singlet catalogue stores empty-droplet ADT matrices, isotype names and antibody clone identifiers, and its ADT coverage, are unknown.
- **Unmeasured cost and transfer.** No timing or memory was measured for any method. The proposed model's catalogue prior must be tested by transfer: when one protein name denotes different clones in different studies, B2 performance must not fall below that of a dataset-only prior, or the catalogue prior is removed.

## 11. References

R1. Marlon Stoeckius, Christoph Hafemeister, William Stephenson, et al. Simultaneous epitope and transcriptome measurement in single cells. *Nature Methods* 2017. doi:10.1038/nmeth.4380 — verified (corpus)
R2. Matthew P. Mulè, Andrew J. Martins, John S. Tsang. Normalizing and denoising protein expression data from droplet-based single cell profiling. *Nature Communications* 2022. doi:10.1038/s41467-022-29356-8 — verified (corpus)
R3. Lukas Heumos, Anna C. Schaar, Christopher Lance, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R4. Adam Gayoso, Zoë Steier, Romain Lopez, et al. Joint probabilistic modeling of single-cell multi-omic data with totalVI. *Nature Methods* 2021. doi:10.1038/s41592-020-01050-x — verified (corpus)
R5. Romain Lopez, Jeffrey Regier, Michael B. Cole, Michael I. Jordan, Nir Yosef. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R6. Yin Y, et al. Characterization and decontamination of background noise in droplet-based single-cell protein expression data with DecontPro. *Nucleic Acids Research* 2023. doi:10.1093/nar/gkad1032 — partial (corpus)
R7. Stephen J Fleming, Mark D Chaffin, Alessandro Arduini, et al. Unsupervised removal of systematic background noise from droplet-based single-cell experiments using CellBender. *Nature Methods* 2023. doi:10.1038/s41592-023-01943-7 — verified (repo)
R8. Caibin Sheng, Rui Lopes, Gang Li, et al. Probabilistic machine learning ensures accurate ambient denoising in droplet-based single-cell omics. *bioRxiv* 2022 (preprint). doi:10.1101/2022.01.14.476312 — verified (corpus)
R9. Ye Zheng, Daniel P Caron, Ju Yeong Kim, et al. ADTnorm: robust integration of single-cell protein measurement across CITE-seq datasets. *Nature Communications* 2025. doi:10.1038/s41467-025-61023-6 — partial (corpus)
R10. Ye Zheng, Seong-Hwan Jun, Yuan Tian, Florian Mair, Raphael Gottardo. Robust normalization and integration of single-cell protein expression across CITE-seq datasets. *bioRxiv* 2022 (preprint). doi:10.1101/2022.04.29.489989 — verified (corpus)
R11. Yansheng Liu, Andreas Beyer, Ruedi Aebersold. On the dependency of cellular protein levels on mRNA abundance. *Cell* 2016. doi:10.1016/j.cell.2016.03.014 — verified (corpus)
R12. Thomas P Quinn, Ionas Erb, Mark F Richardson, Tamsyn M Crowley. Understanding sequencing data as compositions: an outlook and review. *Bioinformatics* 2018. doi:10.1093/bioinformatics/bty175 — verified (corpus)
R13. Danila Bredikhin, Ilia Kats, Oliver Stegle. MUON: multimodal omics analysis framework. *Genome Biology* 2022. doi:10.1186/s13059-021-02577-8 — verified (corpus)
R14. Malte Luecken, Daniel Burkhardt, Robrecht Cannoodt, et al. A sandbox for prediction and integration of DNA, RNA, and proteins in single cells. *Proceedings of the Neural Information Processing Systems Track on Datasets and Benchmarks* 2021 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/muon | Danila Bredikhin, Ilia Kats (pyproject.toml) | BSD 3-Clause (LICENSE file) | reference implementation of CLR (both forms) and dsb | port |
| https://github.com/satijalab/seurat | Rahul Satija (maintainer) and contributors named in DESCRIPTION | MIT + file LICENSE (DESCRIPTION) | CLR formula and CITE-seq vignette usage | callout |
| https://github.com/niaid/dsb | Matthew Mulè, Andrew Martins, John Tsang (DESCRIPTION) | CC0 \| file LICENSE (DESCRIPTION); LICENSE carries a custom NIAID notice including a clause against use in treatment or diagnosis of human subjects; LICENSE.md is the CC0 1.0 text | numerical cross-check of dsb | callout |
| https://github.com/campbio/decontX | Yuan Yin, Masanao Yajima, Joshua Campbell (DESCRIPTION) | MIT + file LICENSE (DESCRIPTION) | DecontPro model, priors and defaults | port (model and priors; inference reimplemented) |
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml) | BSD 3-Clause (LICENSE file) | totalVI equations and defaults; comparator | reimplement |
| https://github.com/broadinstitute/CellBender | Stephen Fleming, Mehrtash Babadi (pyproject.toml) | BSD (3-Clause) (pyproject.toml); LICENSE file is a Broad Institute BSD-style notice | comparator with antibody-capture features | callout |
| https://github.com/Novartis/scAR | Caibin Sheng (pyproject.toml) | MIT License (pyproject.toml, docs/License.rst) | comparator with ADT feature type | callout |
| https://github.com/yezhengSTAT/ADTnorm | Ye Zheng (DESCRIPTION) | GPL (>= 3) (DESCRIPTION; LICENSE.md) | comparator for cross-sample alignment; source of the 13-study demo data | callout |
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE); chapter authors Javier Marchena-Hurtado, Daniel Strobl, Ciro Ramírez-Suástegui | Apache License 2.0 (LICENSE file) | dsb-or-CLR recommendation; tutorial dataset | callout (data source) |
