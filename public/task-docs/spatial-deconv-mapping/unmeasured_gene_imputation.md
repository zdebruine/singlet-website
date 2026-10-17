---
id: spatial-deconv-mapping.unmeasured_gene_imputation
title: Imputation of unmeasured genes in targeted or partial spatial panels
area: spatial-deconv-mapping
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [harmonization.gene_identifier_mapping, spatial-preproc.spatial_unit_qc_filtering, integration.alignability_test]
feeds: [imputation.de_after_imputation, imputation.cluster_recovery_after_imputation]
reads: [layers/counts, var/gene_id, obsm/spatial, reference:layers/counts, reference:var/gene_id, reference:obs/<label_key>]
writes: [obsm/imputed_unmeasured, obsm/imputed_unmeasured_sd, uns/imputed_unmeasured_genes, uns/unmeasured_imputation_loo, models/<method>_mapper]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_deconv_mapping_unmeasured_gene_imputation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Imputation of unmeasured genes in targeted or partial spatial panels

> Predict the expression of genes absent from a targeted or partial spatial panel by transferring values from a full-transcriptome scRNA-seq reference through a coupling fitted on the shared genes.

## 1. Question

For each cell or spot measured with a targeted or partial gene panel, what is the expression of each gene outside that panel? The inputs are the panel count matrix, optional coordinates and a full-transcriptome reference with cell-type labels. The output is a cells-or-spots by unmeasured-genes matrix, optionally with per-value uncertainty. A correct answer estimates the conditional mean of each unmeasured gene on the scale defined in section 3. Accuracy can be checked directly only for measured genes (section 2).

## 2. Why this task matters and where the field stands

Status: **contested**. Targeted imaging panels measure tens to hundreds of genes, while cell-state questions need genes outside the panel. Transfer from a scRNA-seq reference is the common answer, and the methods differ in how the coupling is fitted: an optimised cell-to-spot mapping [R1], kNN weights after principal-vector alignment [R2], a joint variational model [R3] and optimal transport with structural priors [R5, R6]. Seurat's anchor-based transfer of reference features is a further heuristic route [R7, R8].

The open problems are these.

- Validation is indirect. The standard test withholds a measured gene, fits without it and scores the prediction [R2, R3]. Measured genes are not a random sample of unmeasured ones: panels are enriched for markers and high-variance genes, so correlation on them is an optimistic proxy.
- Correlation can hide compression. Kernel averaging and transport both shrink variance, so per-gene correlation can stay high while values are flattened. A variance ratio must be reported beside it.
- Uncertainty is rare. Among the methods read here, only gimVI returns a predictive distribution from which an interval can be formed [R3]. No benchmark read measures interval calibration.
- Li et al. 2022 benchmarks integration methods for transcript distribution prediction [R9]. Its protocol and metric are not used in this document (section 10).
- Dropout imputation of measured genes is evaluated separately [R13]. It is a different task, covered by `imputation.expression_denoising`.

## 3. Theory and insight

Each method estimates the conditional mean of an unmeasured gene $u$ by transferring reference values through a coupling fitted on the shared genes $S$:

$$\hat{x}_{i,u}=\sum_{j} W_{ij}\, z_{j,u}$$

Here $x_i$ restricted to $S$ is the target profile, $z_j$ is the reference profile and $W$ is the coupling. The families differ in how $W$ is fitted and whether a likelihood is attached. The form is valid when $S$ carries the state information that determines $u$ and the reference covers the target's states and composition. If the reference misses a state, no coupling recovers $u$ for that state.

| Symbol | Meaning |
|---|---|
| $i$, $j$ | target cell or spot; reference cell |
| $u$, $g$ | unmeasured gene; held-out measured gene |
| $P$, $S$ | measured panel; shared genes, $S=(P\cap\text{reference genes})\setminus\{g\}$ for a held-out $g$ |
| $c_{i,u}$, $L_i^{P}$ | UMI count of $u$ in $i$; total count over the panel $P$ in $i$ |

**Estimand.** Every ground truth and every output in this document targets

$$y_{i,u}=10^{4}\,\frac{c_{i,u}}{L_i^{P}},$$

the share of $u$ in the panel total of cell or spot $i$, in counts per 10,000. The panel total $L_i^{P}$ is computed before any gene is held out. Predictions estimate $\mathbb{E}[y_{i,u}\mid\text{panel},\text{reference}]$. The truth for a held-out measured gene is $y_{i,g}$ on the same cells. The truth for a simulated spot $s$ built from member cells $c\in s$ is $y_{s,u}=10^{4}\sum_{c\in s}c_{c,u}\big/\sum_{c\in s}L_c^{P}$. Interval coverage is the fraction of truths inside the nominal 90% interval $[\ell_{i,u},h_{i,u}]$.

**Scale.** Spearman is invariant to a positive per-gene scale, so $\rho_g$ does not depend on a method's native output scale. Cosine and variance ratio do, so each native output is mapped to the counts-per-10,000 scale with one scalar per method and reference, fitted on shared genes only.

**Diagnostics.** For a held-out gene $g$, $\rho_g=\mathrm{Spearman}(x_{\cdot g},\hat{x}_{\cdot g})$ with ties averaged, $\mathrm{cos}_g=x_{\cdot g}^{\top}\hat{x}_{\cdot g}/(\|x_{\cdot g}\|\,\|\hat{x}_{\cdot g}\|)$ and $\mathrm{VR}_g=\mathrm{var}(\hat{x}_{\cdot g})/\mathrm{var}(x_{\cdot g})$. $\rho_g$ and $\mathrm{cos}_g$ are undefined when a vector is constant.

**Tangram** (cells mode) fits a row-stochastic map $M=\mathrm{softmax}_{\text{spots}}(\Theta)$ and projects $\hat{X}^{sp}=M^{\top}X^{sc}$. The fit maximises the mean gene-wise cosine over shared genes, minus density, entropy and norm regularisers:

$$\max_{\Theta}\ \lambda_{g1}\frac{1}{|S|}\sum_{g\in S}\cos\!\big(\hat{X}^{sp}_{:,g},\,X^{sp}_{:,g}\big)\;-\;\text{regularisers}$$

It has no posterior, and $M$ is dense with size $n_{sc}\times n_{sp}$.

**SpaGE** aligns reference and spatial cells in a principal-vector space and weights the $k'_i$ reference neighbours with cosine distance $d_{ij}<1$:

$$w_{ij}=\frac{1-d_{ij}/\sum_{l}d_{il}}{k'_i-1},\qquad \sum_{j}w_{ij}=1\ \text{ when } k'_i\ge 2.$$

The denominator uses the retained count $k'_i$ (at most 50), not the nominal $k$. The weights are linear in $d$ over the retained set and undefined when $k'_i\le 1$.

**gimVI** uses a shared latent $z_n\sim\mathcal{N}(0,I)$ and counts $x_{ng}\sim\mathrm{Obs}_m\big(\ell_n\rho_{ng}(z_n,s_n),\theta_{s_ng}\big)$ for the genes observed in modality $m$, with one decoder $\rho$ over the full gene set. An unmeasured value is the decoder mean at the posterior mean of $z_n$. Training maximises the per-modality evidence lower bounds plus an adversarial modality term weighted by $\kappa$. The regime is exactly two datasets, large $n$ and a variational approximation.

**Seurat** transfer has the same form, with $W$ supported on mutual nearest-neighbour anchors in a shared low-dimensional space [R7, R8]. **novoSpaRc** couples cells to template locations $\ell$ by entropic Gromov-Wasserstein-type transport with expression and structure costs; expression at a location is proportional to $\sum_i T_{i\ell}\,x_i$ [R5, R6]. Its output lives on template locations, not on measured spatial cells.

**Why a model.** Heuristic couplings return point values without a likelihood, so they give no calibrated interval. A fitted count model provides one, can be pretrained on a large reference and reused across panels, and makes the count noise explicit. The cost is an assumption about that noise, zero-inflated or negative binomial, which must be checked (section 5).

**Assumptions.** Conditional transfer: given the shared genes and state, $u$ in target cells is distributed as in matched reference cells. Reference support: every target state appears in the reference in comparable proportion. Platform effects are small after each method's normalisation. Shared genes are informative: SpaGE keeps principal-vector pairs with cosine above 0.3.

**Failure modes.** Smoothing: averaging shrinks variance, so $\mathrm{VR}_g$ falls while $\rho_g$ can stay high. Zero inflation: $\rho_g$ on mostly zero genes is dominated by ties and is undefined for constant predictions. Panel-selection bias: test genes are markers and high-variance genes. Reference mismatch: a held-out test with the same bias cannot reveal it. Scale: the dense Tangram map and the transport coupling need subsampling or sparsification at atlas size. Hyper-parameters: $k$, the principal-vector cutoff, epochs and $\lambda$ chosen on held-out genes inflate scores. Identifier mismatch: a case or alias change silently mis-aligns genes.

**Insight.** Accuracy on $u$ is bounded by how much of $u$'s state-dependent variation the shared genes explain after the coupling, and by how well the reference covers the target's states and composition. Held-out correlation measures the first term only for measured genes, which is why it is a proxy for unmeasured genes.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Tangram (cells mode) | model-based | Learns a row-stochastic cell-to-spot map by maximising gene-wise cosine agreement on shared genes, then projects unmeasured genes. | [R1] |
| gimVI | model-based | Joint variational autoencoder over sequencing and spatial data, with a shared latent code and an adversarial modality term. | [R3, R4] |
| SpaGE | heuristic | Aligns reference and spatial cells in a principal-vector space and averages the nearest reference cells. | [R2] |
| Seurat anchor transfer | heuristic | Mutual-nearest-neighbour anchors between reference and query; reference features transferred as anchor-weighted averages. | [R7, R8] |
| novoSpaRc | hybrid | Entropic optimal transport couples cells to template locations using expression and structure costs. | [R5, R6] |

The reference standards are the leave-one-gene-out protocol of the SpaGE benchmark, its gimVI and Seurat comparators, and the cross-validation helper in Tangram. Tangram and gimVI are the model-based methods here; SpaGE and Seurat are the heuristics. The heuristics stay as comparators in every benchmark (section 8), so a model-based method must beat the reference standard, not only the nulls. novoSpaRc is a callout, because its output is defined on template locations. The defaults below are those in the code read.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Tangram | `mode` | cells | `tangram/mapping_utils.py:146` @ 4c68995 |
| Tangram | `learning_rate` | 0.1 | `tangram/mapping_utils.py:148` |
| Tangram | `num_epochs` | 1000 | `tangram/mapping_utils.py:149` |
| Tangram | `lambda_g1` | 1 | `tangram/mapping_utils.py:152` |
| Tangram | `lambda_d` | 0; set to 1 when a density prior is given | `tangram/mapping_utils.py:151`, `:214–215` |
| Tangram | `density_prior` | rna_count_based | `tangram/mapping_utils.py:167` |
| Tangram | `lambda_count`, `lambda_f_reg` | 1 and 1 (constrained mode only) | `tangram/mapping_utils.py:157–158` |
| Tangram | `cv_mode` | loo | `tangram/utils.py:519` |
| gimVI | `n_latent` | 10 | `src/scvi/external/gimvi/_model.py:90` @ 5555ecc |
| gimVI | `generative_distributions` | zinb, nb | `src/scvi/external/gimvi/_model.py:108` |
| gimVI | `model_library_size` | True, False | `src/scvi/external/gimvi/_model.py:107` |
| gimVI | `max_epochs` | 200 | `src/scvi/external/gimvi/_model.py:178` |
| gimVI | `kappa` | 5 | `src/scvi/external/gimvi/_model.py:181` |
| SpaGE | `n_pv` | no default in the function; benchmark value 30 | `SpaGE/main.py:23` @ edd0fb7; `benchmark/osmFISH_Ziesel/SpaGE/Integration.py:36` |
| SpaGE | principal-vector cutoff | cosine similarity above 0.3 | `SpaGE/main.py:78` |
| SpaGE | `k` | 50, cosine metric | `SpaGE/main.py:84` |
| SpaGE | weight normalisation | divide by retained count minus 1; drop $d\ge 1$ | `SpaGE/main.py:90–92` |
| SpaGE | scaling | z-score per gene, both datasets | `SpaGE/main.py:56–58` |
| Seurat | anchor `dims` | 1:30 (vignette example, not a package default) | `vignettes/integration_mapping.Rmd:99` @ 5f67c701 |

## 5. Proposed singlet approach

**Routes.** Tangram cells-mode mapping and SpaGE are **ported**: both are small, and their kernels are dense products and top-k selections that map onto cuBLAS and cuSPARSE. gimVI, Seurat anchor transfer and novoSpaRc are **callouts**, used only as comparators. gimVI is not ported, because its code depends on an scvi-tools stack whose maintenance is moving (section 10). Placing dissociated cells on template locations belongs to `spatial-deconv-mapping.cell_to_location_mapping`.

**Proposed model.** A conditional count model. An encoder reads the panel vector and an optional cell-type prior and produces a latent code; a decoder over the full reference transcriptome emits zero-inflated or negative binomial parameters for every gene. The noise family is chosen per dataset by the diagnostic in `normalization.count_noise_model_selection`. Training has two stages. Pretraining masks random gene subsets of genome-wide catalogue cells, so the kept genes mimic a panel and the masked genes are the truth; it needs no spatial data. Fine-tuning uses paired spatial-reference data. Intervals come from split-conformal calibration on held-out genes, so calibration is measured in B3 rather than assumed.

**Falsification.** The formulation is rejected if it does not beat the better of Tangram and SpaGE on B1 (paired test, p < 0.05), fails the nulls in B3, or leaves the coverage band in B3.

**ML stack.** PyTorch for the encoder, decoder, masked pretraining and minibatch training. Hard-coded CUDA only for small hot kernels: a cuBLAS GEMM with top-k selection for SpaGE-style cosine kNN, and a cuSPARSE SpMM for a sparsified Tangram-style coupling that keeps the top-k nonzeros per reference cell. The dense mapping is kept only at small $n_{sc}\times n_{sp}$. Sparsification is a singlet change and is compared with the dense default in P1.

**Devices.** `device` auto selects CUDA when memory suffices. The kNN path processes the reference in blocks; the Tangram path is not streamed.

**Defaults.** The default method is `tangram`. The defaults an agent uses without asking are the MCP defaults in section 6, and a default changes only when a benchmark in section 8 requires it.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | UMI counts of the panel genes only, cells or spots by panel genes |
| read | var/gene_id | string | panel gene symbols, matched to the reference |
| read | obsm/spatial | float | optional coordinates, used by the density prior and the neighbourhood checks |
| read | reference:layers/counts | sparse int | full-transcriptome reference counts |
| read | reference:var/gene_id | string | reference gene symbols |
| read | reference:obs/<label_key> | category | reference cell-type labels |
| write | obsm/imputed_unmeasured | float32 | cells or spots by unmeasured genes, counts-per-10,000 scale |
| write | obsm/imputed_unmeasured_sd | float32 | predictive SD; probabilistic methods only |
| write | uns/imputed_unmeasured_genes | string list | gene symbols, in the column order of the matrix |
| write | uns/unmeasured_imputation_loo | table | per-gene $\rho_g$, $\mathrm{cos}_g$, $\mathrm{VR}_g$ and null gaps |
| write | models/<method>_mapper | sparse matrix or model | fitted coupling (Tangram) or fitted model |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Spatial dataset handle. layers/counts holds panel genes only; obsm/spatial holds optional coordinates. |
| `reference` | string | required | — | Reference scRNA-seq handle with full-transcriptome layers/counts and the cell-type column named by evaluation.label_key. |
| `method` | string | "tangram" | `tangram`, `gimvi`, `spage`, `seurat` | Imputation method. tangram is the default; spage is the heuristic comparator; gimvi returns predictive SDs. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for initialisation, minibatch order and held-out fold order. |
| `dry_run` | boolean | false | — | Return estimated time, peak memory, device and, for tangram, the dense mapping size, without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `evaluation` | object | — | — | Held-out gene scoring and null baselines; scores are written to uns/unmeasured_imputation_loo. |
| `evaluation.cv_mode` | string | "loo" | `loo`, `10fold` | Held-out scheme: leave-one-gene-out or 10-fold over panel genes. |
| `evaluation.label_key` | string | "cell_type" | — | Reference obs column with cell-type labels, used by the cell-type-mean null. |
| `evaluation.null_k` | integer | 50 | min 1 | Random reference cells averaged by the random-coupling null. |
| `spage` | object | — | — | Options for method spage (principal-vector alignment and kNN weights). |
| `spage.n_pv` | integer | 30 | min 1 | Principal vectors for alignment; 30 is the benchmark value, the SpaGE function has no default. |
| `spage.pv_cosine_cutoff` | number | 0.3 | min 0; max 1 | Keep principal-vector pairs whose cosine similarity exceeds this value. |
| `spage.k_neighbors` | integer | 50 | min 2 | Reference neighbours for kernel weights; neighbours with cosine distance of at least 1 are dropped. |
| `tangram` | object | — | — | Options for method tangram (cells-to-spots mapping). |
| `tangram.mode` | string | "cells" | `cells`, `clusters`, `constrained` | Mapping mode; cells is the default and the mode used in the benchmarks. |
| `tangram.learning_rate` | number | 0.1 | > 0 | Adam learning rate for the mapping optimiser. |
| `tangram.num_epochs` | integer | 1000 | min 1 | Optimiser epochs for the mapping. |
| `tangram.density_prior` | string | "rna_count_based" | `rna_count_based`, `uniform`, `none` | Spatial density prior; none disables the density term. |
| `gimvi` | object | — | — | Options for method gimvi (joint variational model over two datasets). |
| `gimvi.max_epochs` | integer | 200 | min 1 | Training epochs. |
| `gimvi.n_latent` | integer | 10 | min 1 | Dimension of the shared latent space. |
| `gimvi.kappa` | number | 5 | min 0 | Weight of the adversarial modality-classifier loss. |
| `seurat` | object | — | — | Options for method seurat (reference anchor transfer). |
| `seurat.dims` | integer | 30 | min 2 | Dimensions 1 to dims used for anchors; the vignette value, not a package default. |
<!-- PARAMS:AUTO:END -->

The parameters `spage.*`, `tangram.*`, `gimvi.*` and `seurat.*` apply only when `method` names that method, and `evaluation.*` and `seed` apply to every fitted method. Panel and reference genes are matched by harmonised symbol: a case or alias mismatch is an error that lists the unmatched genes, never an upper-cased match. Unmeasured genes are reference genes absent from the panel, and a panel gene is never imputed. `dry_run` reports the dense Tangram mapping size before any fit. Only methods that return a predictive distribution write `obsm/imputed_unmeasured_sd`.

## 7. MCP tool

Tool name `singlet_spatial_deconv_mapping_unmeasured_gene_imputation` (definition in `tasks/mcp/singlet_spatial_deconv_mapping_unmeasured_gene_imputation.json`). An example call and a compact result follow; placeholders stand for computed values.

```json
{"dataset": "/data/osmfish_cortex.singlet", "reference": "/data/zeisel_cortex.singlet",
 "method": "tangram", "evaluation": {"cv_mode": "loo", "null_k": 50}, "seed": 0}
```

```json
{"dataset": "/data/osmfish_cortex.singlet", "status": "completed",
 "wrote": ["obsm/imputed_unmeasured", "uns/imputed_unmeasured_genes", "uns/unmeasured_imputation_loo", "models/tangram_mapper"],
 "summary": {"method": "tangram", "n_spatial": "<int>", "n_unmeasured": "<int>", "median_rho": "<float>", "undefined_genes": "<int>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: yes. Tangram optimises for `num_epochs` and the held-out evaluation refits per gene or fold, so the tool queues such jobs and returns `queued` with a `job_id`.
Stochastic: yes. `seed` fixes initialisation, minibatch order and fold order.
Dry run: returns `dry_run` with seconds, peak memory and device, including the dense mapping size for Tangram.

## 8. Benchmarks

**Shared protocol.** All methods receive the same panel, reference, gene-symbol mapping and seed. Each held-out gene $g$ is removed from the spatial data and the reference before fitting; each method is fitted on the shared genes $S$ and predicts $g$ for every spatial cell or spot. Scores use the counts-per-10,000 truth and predictions of section 3, with $L_i^{P}$ computed before any holdout. A gene whose truth or prediction is constant is undefined; it is excluded from every method's paired summary under one rule, and the count is reported. Comparators are pinned to the commits in section 12. novoSpaRc is excluded.

### B1. Held-out measured-gene consistency on osmFISH with a Zeisel reference

- **Goal**: Score prediction of a measured spatial gene after removing it from both the panel and the reference before fitting.
- **Ground truth**: consistency. The label for held-out gene $g$ is $y_{i,g}$ of the same osmFISH cell, measured by FISH and normalised as in section 3.

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| osmFISH mouse cortex panel | SpaGE benchmark folder `osmFISH_Ziesel` (section 12) | FISH panel, mouse cortex; — | — | Per-gene leave-one-out |
| Zeisel 2015 mouse cortex reference | [R10] | scRNA-seq, mouse cortex; — | — | Full transcriptome with labels |

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Per-gene Spearman $\rho_g$ | Spearman over cells, ties averaged; mean and median over genes | maximise | primary | — |
| Uncentred cosine $\mathrm{cos}_g$ | On the counts-per-10,000 scale; inflated by shared zeros | maximise | guardrail | — |
| Variance ratio $\mathrm{VR}_g$ | Median over genes; fraction of genes with $\mathrm{VR}_g<0.5$ | near 1 | guardrail | — |
| Random-coupling null gap | Mean $\rho_g$ minus that of the mean-of-50-random-cells null | maximise | guardrail | — |

- **Comparators**: Tangram (cells mode), gimVI, SpaGE, Seurat TransferData, the random-coupling null and the cell-type-mean null (reference mean of each cell's annotated type).
- **Protocol**: Leave-one-gene-out over panel genes present in the Zeisel reference; Tangram also on 10-fold held-out genes. Settings as in section 4.
- **Acceptance criterion**: Proposed, not a literature value. Mean and median $\rho_g$ exceed both nulls and the better of SpaGE and Seurat (paired Wilcoxon across genes, p < 0.05), and median $\mathrm{VR}_g$ lies between 0.5 and 1.5.
- **Known pitfalls**: The repository benchmark sets NaN correlations to zero for gimVI and Liger only (`Performance_evaluation_osmFISH.py:40`, `:59`), not for SpaGE or Seurat (`:28–30`, `:47–49`); one rule must apply. The gimVI comparator uses a legacy scvi API (`osmFISH_Ziesel/gimVI/gimVI.py:4–6`) that does not work unchanged.

### B2. Reference-shift consistency on osmFISH and STARmap

- **Goal**: Measure how far B1 accuracy changes when only the reference changes, separating method error from reference mismatch.
- **Ground truth**: consistency, as in B1; the label is the spatial measurement of the held-out gene on the same cells or spots (section 3).

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| osmFISH cells, Zeisel reference | As B1 | As B1 | — | B1 condition |
| osmFISH cells, Allen VISp reference | SpaGE benchmark folder `osmFISH_AllenVISp` (section 12) | FISH panel; — | — | Atlas reference |
| osmFISH cells, Allen SSp reference | SpaGE benchmark folder `osmFISH_AllenSSp` (section 12) | FISH panel; — | — | Atlas reference |
| STARmap cells, Allen VISp reference | SpaGE benchmark folder `STARmap_AllenVISp` (section 12); assay [R11] | targeted in situ panel; — | — | Different assay, reported separately |

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Per-gene Spearman $\rho_g$ | As B1, per method and reference | maximise | primary | — |
| Reference-shift loss | Mean $\rho_g$ with Zeisel minus mean with the alternative, paired by gene; osmFISH pairs | minimise | guardrail | — |
| Paired difference to SpaGE | Per-gene $\rho_g$ of the method minus SpaGE, with a Wilcoxon test | maximise | guardrail | — |

- **Comparators**: As B1, with the same nulls.
- **Protocol**: As B1 with only the reference varied; one shared gene-symbol mapping table replaces case conversion.
- **Acceptance criterion**: Proposed. A method meets it if its reference-shift loss is no greater than SpaGE's on both osmFISH pairs and it beats the random-coupling null under every reference.
- **Known pitfalls**: Reference mismatch (different animals and regions) is confounded with method quality, so the loss is a joint quantity. The osmFISH comparison script upper-cases gene names before indexing (`osmFISH_Ziesel/Performance_evaluation.py:86–90`), which can mis-align symbols that differ only in case.

### B3. Planted simulation on catalogue subsets with stratified nulls

- **Goal**: Measure accuracy against known truth on genome-wide data, free of panel-selection bias, and check interval calibration.
- **Ground truth**: planted simulation; spot truth $y_{s,u}$ from held-out donors' member cells (section 3), known by construction.

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue cells from held-out donors or studies | singlet internal catalogue (354M cells, about 40% author-annotated) | scRNA-seq; subset size recorded per score table | — | — |

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Per-gene Spearman $\rho_u$ | Within expression-decile and Moran's I tertile strata | maximise | primary | — |
| 90% interval coverage | Share of truths inside nominal intervals (probabilistic methods) | 0.9 | guardrail | — |
| Null-baseline gaps | Mean $\rho_u$ minus each null | maximise | guardrail | — |

- **Generator recipe**:
  1. Hold out donors or studies $D_{\text{test}}$; the reference excludes them.
  2. Draw $N$ spots of $m$ member cells (fixed per experiment) from $D_{\text{test}}$, stratified by cell type and library size.
  3. Place spots on a grid or tissue geometry; compute each gene's Moran's I.
  4. Choose disjoint $P$ and $U$; sample $U$ independent of marker status, stratified by expression decile and Moran's I tercile.
  5. Panel input: member sums over $P$, normalised by $L^{P}$; truth: member sums over $U$.
  6. Nulls: random-coupling (50 random reference cells) and cell-type mean.
  7. Fit each method on $P$ and the reference; score per stratum; fix seeds; tune nothing on $U$.
- **Comparators**: As B1, with the same nulls.
- **Protocol**: $U$ is drawn once per simulation seed and held fixed across methods.
- **Acceptance criterion**: Proposed. A method beats both nulls in every expression-decile stratum (paired test, p < 0.05); coverage lies in 0.85–0.95.
- **Known pitfalls**: Simulated mixing may be easier than tissue; B1 and B2 provide the real-tissue check. Shared donors make truth circular; step 1 prevents it.

### P1. Performance and scaling

Measure wall time, peak memory and throughput (spatial cells per second) for SpaGE, Seurat, gimVI and Tangram at 10,000, 100,000 and 1,000,000 spatial cells, on CPU and CUDA. The repository timing script covers SpaGE, gimVI and Seurat but not Tangram. Report memory against spatial cells and reference cells separately: Tangram's dense map and SpaGE's brute-force kNN both grow with their product, and gimVI grows with epochs times minibatches. Ten million cells is reported only for the singlet streamed kernels, once implemented. Hold fixed the section 4 settings, one thread count, one seed and one reference. Proposed acceptance: at 100,000 spatial cells the singlet CUDA path uses no more peak memory than the SpaGE comparator.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `integration.alignability_test`: Pre-integration alignability testing
- **Feeds**:
  - `imputation.de_after_imputation`: Differential expression after imputation
  - `imputation.cluster_recovery_after_imputation`: Cell-type cluster recovery after imputation
- **Reads**: `layers/counts`, `var/gene_id`, `obsm/spatial`, `reference:layers/counts`, `reference:var/gene_id`, `reference:obs/<label_key>`
- **Writes**: `obsm/imputed_unmeasured`, `obsm/imputed_unmeasured_sd`, `uns/imputed_unmeasured_genes`, `uns/unmeasured_imputation_loo`, `models/<method>_mapper`
<!-- CHAINING:AUTO:END -->

Spatial-to-reference workflow: panel QC, gene-identifier harmonisation and integration alignability checks come first; the imputed matrix feeds downstream expression and cluster-recovery checks.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** Li et al. 2022 [R9] is cited for its topic only; its metric and protocol are unread. SpatialScope [R12] was not evaluated, and its method and benchmarks are unread. The novoSpaRc BDTNP data files were not located in the clone. The contents of the Allen references and of the STARmap, seqFISH and MERFISH benchmark folders were not inspected. Dataset sizes and accession numbers for osmFISH, the Zeisel 2015 reference and the Allen references are not stated in the sources read. The scviva-tools repository was not read, the best-practices imputation chapter is absent from the clone, and the tuple labels in `Timing_Evaluation.py` are undocumented.
- **Unsettled literature.** The claim that Tangram, gimVI and SpaGE rank highest for transcript distribution prediction rests on a secondary summary and is not used as evidence here. No benchmark read measures interval calibration, and whether held-out correlation on measured genes predicts accuracy on unmeasured genes is untested.
- **Maintenance and licence.** gimVI moves to scviva-tools from scvi-tools v1.5 and is scheduled for deprecation in v1.6 (`docs/user_guide/models/gimvi.md:30`). The scvi-tools Tangram model page is deprecated from v1.5 (`docs/user_guide/models/tangram.md:4`). One candidate repository has conflicting licence metadata (section 12).
- **Scale.** The dense Tangram map, the transport coupling and brute-force kNN all grow with products of cell counts, so atlas-size analyses need subsampling or sparsification. The sparsified singlet variant is untested until P1 reports it.
- **Data.** Whether the catalogue holds paired spatial and reference data for fine-tuning is an open question; without it, real-tissue checks rest on the osmFISH and STARmap datasets of B1 and B2. The donor and study labels needed for the B3 held-out split must be complete.
- **First experiment.** Fit Tangram, SpaGE, Seurat and both nulls on osmFISH under the B1 protocol with one NaN rule, report variance ratios and undefined-gene counts, and decide from those numbers whether the model in section 5 justifies the B3 effort.

## 11. References

R1. Biancalani T, Scalia G, Buffoni L, et al. Deep learning and alignment of spatially resolved single-cell transcriptomes with Tangram. *Nature Methods* 2021. doi:10.1038/s41592-021-01264-7 — partial (corpus)
R2. Abdelaal T, Mourragui S, Mahfouz A, Reinders MJT. SpaGE: Spatial Gene Enhancement using scRNA-seq. *Nucleic Acids Research* 2020. doi:10.1093/nar/gkaa740 — partial (corpus)
R3. Lopez R, Nazaret A, Langevin M, Samaran J, Regier J, Jordan MI, Yosef N. A joint model of unpaired data from scRNA-seq and spatial transcriptomics for imputing missing gene expression measurements. *ICML Workshop on Computational Biology* 2019 (arXiv:1905.02269). doi:10.48550/arxiv.1905.02269 — partial (corpus)
R4. Gayoso A, Lopez R, Xing G, et al. A Python library for probabilistic analysis of single-cell omics data. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01206-w — partial (corpus)
R5. Nitzan M, Karaiskos N, Friedman N, Rajewsky N. Gene expression cartography. *Nature* 2019. doi:10.1038/s41586-019-1773-3 — partial (corpus)
R6. NovoSpaRc: flexible spatial reconstruction of single-cell gene expression with optimal transport. *Nature Protocols* 2021. doi:10.1038/s41596-021-00573-7 — partial (corpus)
R7. Stuart T, Butler A, Hoffman P, Hafemeister C, Papalexi E, Mauck WM, Hao Y, Stoeckius M, Smibert P, Satija R. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — partial (corpus)
R8. Butler A, Hoffman P, Smibert P, Papalexi E, Satija R. Integrating single-cell transcriptomic data across different conditions, technologies, and species. *Nature Biotechnology* 2018. doi:10.1038/nbt.4096 — partial (corpus)
R9. Li B, Zhang W, Guo C, et al. Benchmarking spatial and single-cell transcriptomics integration methods for transcript distribution prediction and cell type deconvolution. *Nature Methods* 2022;19:662-670. doi:10.1038/s41592-022-01480-9 — partial (corpus)
R10. Zeisel A, et al. Cell types in the mouse cortex and hippocampus revealed by single-cell RNA-seq. *Science* 2015. doi:10.1126/science.aaa1934 — partial (corpus)
R11. Wang X, Allen WE, Wright MA, et al. Three-dimensional intact-tissue sequencing of single-cell transcriptional states. *Science* 2018. doi:10.1126/science.aat5691 — partial (corpus)
R12. Wan X, Xiao J, et al. Integrating spatial and single-cell transcriptomics data using deep generative models with SpatialScope. *Nature Communications* 2023. doi:10.1038/s41467-023-43629-w — partial (corpus)
R13. Hou W, Ji Z, Ji H, Hicks SC. A systematic evaluation of single-cell RNA-sequencing imputation methods. *Genome Biology* 2020. doi:10.1186/s13059-020-02132-x — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/broadinstitute/Tangram (HEAD 4c68995) | Tommaso Biancalani, Gabriele Scalia (setup.py) | BSD-3-Clause (LICENSE.md) | Cells-mode mapping and held-out cross-validation | port |
| https://github.com/scverse/scvi-tools (HEAD 5555ecc, version 1.5.1) | scvi-tools developers; copyright Yosef Lab, Weizmann Institute of Science (LICENSE) | BSD-3-Clause (LICENSE) | gimVI module (`src/scvi/external/gimvi`) | callout |
| https://github.com/tabdelaal/SpaGE (HEAD edd0fb7) | Tamim Abdelaal (author tag in SpaGE/main.py); repository owner tabdelaal | MIT (LICENSE) | Principal-vector kNN; held-out benchmark folder | port |
| https://github.com/satijalab/seurat (HEAD 5f67c701, version 5.6.0.9000) | Satija Lab, NYGC (README) | MIT with file LICENSE (DESCRIPTION) | TransferData with a reference matrix | callout |
| https://github.com/rajewsky-lab/novosparc (HEAD a3c9f3d7) | Nikos Karaiskos, Mor Nitzan, Nir Friedman, Nikolaus Rajewsky (LICENSE copyright) | BSD-3-Clause (LICENSE); MIT (setup.py) | Optimal-transport placement | callout (see `spatial-deconv-mapping.cell_to_location_mapping`) |
