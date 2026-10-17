---
id: deconvolution-bulk.celltype_proportions_sc_reference
title: Cell-type proportion estimation from bulk with a single-cell reference
area: deconvolution-bulk
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [harmonization.gene_identifier_mapping, annotation.cross_dataset_label_reconciliation]
feeds: [deconvolution-bulk.celltype_specific_expression, deconvolution-bulk.celltype_specific_de_bulk, deconvolution-bulk.celltype_specific_eqtl_bulk, abundance.celltype_proportion_test]
reads: [bulk/layers/counts, reference/layers/counts, reference/obs/cell_type, reference/obs/subject]
writes: [obsm/proportions, uns/proportions_meta, uns/proportion_var, models/<name>]
devices: [cpu, cuda]
mcp_tool: singlet_deconvolution_bulk_celltype_proportions_sc_reference
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Cell-type proportion estimation from bulk with a single-cell reference

> For each bulk sample, estimate the fraction of each cell type in a labelled multi-donor single-cell or single-nucleus reference, as non-negative proportions that sum to one.

## 1. Question

Given a bulk gene-by-sample count matrix and a labelled, multi-donor single-cell or single-nucleus reference from the same tissue, what fraction of each sample's cells belongs to each reference cell type? The output is a sample-by-type matrix of non-negative fractions summing to one over the modelled types, defined on cell counts (section 3.2). A correct answer equals the simulated cell-count composition in silico, and in real data matches an orthogonal count measure only up to the mismatch stated in B3.

## 2. Why this task matters and where the field stands

Bulk RNA-seq averages over cell types, so composition shifts appear as expression changes unless they are estimated. Deconvolution supplies those composition terms to donor-level and cell-type-specific bulk analyses (section 9). The task is **contested**: benchmarks agree on broad patterns but not on method ranking. The best-practices deconvolution chapter calls benchmark results "overall quite consistent" [R2, R3, R4]. It reports that single-cell-reference methods perform well and semi-supervised methods show higher error, and, citing Cobos et al., that omitting bulk cell types worsens results [R2]. Sutton et al. report that signature choice matters, and that brain region and in vitro culture shape signature quality [R5]. Nadel et al. evaluate methods and references together on thousands of clinical samples [R4].

Open problems:

- **Unmodelled cell types.** Jin and Liu treat unknown content as a testing factor [R3]; the chapter calls missing types a major open challenge.
- **Rare and correlated types.** Methods commonly fail to estimate rare fractions [R8]. Near-identical profiles cannot be separated; the chapter notes that some methods select features to reduce collinearity, citing AutoGeneS [R17].
- **Reference-bulk mismatch.** Cells versus nuclei, platform, donor set and disease state change the profiles, and estimates are conditioned on the chosen reference (chapter).
- **Calibrated uncertainty.** Most estimators return point values. MuSiC returns an analytic variance (section 3.3), and no benchmark cited here checks its coverage.
- **Ground truth.** Few real bulk datasets carry orthogonal fractions, so most evidence is simulated [R2, R3].

## 3. Theory and insight

### 3.1 Mixing model

Bulk expression of gene $g$ in sample $j$ is a non-negative mixture of $K$ reference profiles:

$$y_{gj} = \sum_{k=1}^{K} \beta_{kj}\, x_{gk} + \varepsilon_{gj}, \qquad \beta_{kj} \ge 0, \quad \sum_{k=1}^{K} \beta_{kj} = 1.$$

Here $y_{gj}$ is library-size-normalised bulk expression, $x_{gk}$ is the mean of the library-size-normalised profiles of type $k$ cells, and $\varepsilon_{gj}$ absorbs noise and cell states absent from the reference. The first-order form holds when expression is additive over cells, the reference is fixed and known, and $G \gg K$.

### 3.2 Estimand and normalisation

- **RNA share $\beta_{kj}$**: the share of sample $j$'s normalised signal from type $k$, summing to one over the modelled types. The sum-to-one model estimates this quantity directly.
- **Cell-count fraction $p_{kj}$** (the default output): if a type-$k$ cell contributes $\bar L_k$ UMIs on average, where $\bar L_k$ is its mean library size in the reference, then $\beta_{kj} \propto n_{kj}\bar L_k$. Hence $p_{kj} = (\beta_{kj}/\bar L_k) \big/ \sum_l (\beta_{lj}/\bar L_l)$. This conversion assumes the reference library sizes represent the bulk cells.
- **Simulation truth**: the cell-count fraction of the sampled cells (B2), and the sampled UMI share for the RNA-share arm of B2.
- **Orthogonal truth (B3)**: measured neutrophil count per mm³, an absolute quantity. Pearson r is invariant to a global scale but not to sample-specific variation in total leukocytes, so it tests linear association only.
- **Published simulation truth (B1)**: the released component proportions, whose normalisation is set in section 10.

### 3.3 Estimators

*Simplex least squares* solves $\hat\beta_j = \arg\min_{\beta \in \Delta_K} \lVert y_j - X\beta \rVert_2^2$ with $\Delta_K = \{\beta \ge 0,\ \mathbf{1}^\top\beta = 1\}$, unweighted, as in the bisque solver [R10]. It needs $X$ of full column rank and is sensitive to gene scaling.

*Donor-weighted NNLS (MuSiC)* [R1] iterates non-negative least squares with gene weights. Initial weights come from the unweighted NNLS fit, and each later iteration recomputes them from the current fit.

$$w_g^{(t)} = \Big(\nu + \big(r_g^{(t)}\big)^2 + \sum_{k} \big(\hat q^{(t)}_k \hat S_k\big)^2\, \Sigma_{g,k}\Big)^{-1},$$

where $r_g^{(t)}$ is the residual at iteration $t$, $\hat q^{(t)}$ the NNLS coefficients at iteration $t$, $\hat S$ the per-type size factors, and $\Sigma_{g,k}$ the cross-donor variance of type $k$ in the reference. This is the default path (`ct.cov = FALSE`); with `ct.cov = TRUE` the sum runs over type pairs $k,l$ with a cross-type covariance. The estimate $\hat p = \hat q / \sum_l \hat q_l$ is iterated until the L1 change falls below $\epsilon$. The weighting needs several donors per type to estimate $\Sigma$. The analytic variance, with $\tilde X = W^{1/2}X$ and $\bar r^{\,2}$ the mean squared residual, is

$$\widehat{\mathrm{Var}}(\hat p_k) \approx \frac{\bar r^{\,2}}{\big(\sum_l \hat q_l\big)^2}\,\big[(\tilde X^{\top}\tilde X)^{-1}\big]_{kk}.$$

This is a first-order result for interior solutions with large $G$; it does not apply to zero fractions on the simplex boundary.

*Learned mapping (Scaden)* [R7] trains a multilayer perceptron with softmax output on simulated mixtures with known fractions. Its loss is mean squared error, although a comment in the code says L1. It returns point estimates only.

*Hybrid transform (bisque)* [R10] learns a per-gene linear map from pseudo-bulk of reference donors, then applies simplex least squares. It requires donor labels.

*Ensemble (SCDC)* [R11] fits each reference separately and combines the results with weights (`SCDC_ENSEMBLE`).

### 3.4 Assumptions and failure modes

- **All families**: every bulk type is in the reference; inputs are linear; reference profiles match the bulk tissue state; library-size differences are handled as in section 3.2.
- **Fixed-signature regression**: collinear types give unidentifiable splits. Row scaling, column scaling and quantile normalisation are advised against [R2].
- **Donor-weighted NNLS**: fails with a single reference sample or with missing types (chapter).
- **Learned mapping**: predictions outside the simulated distribution are unchecked, and no uncertainty is returned.
- **Within-type state**: malignant or activation programmes change the profile and are absorbed into the type fraction.

### 3.5 What a model-based formulation adds

A likelihood with priors yields posterior intervals. Reference donor variance can enter the bulk likelihood, as MuSiC's weights do, and a trained network amortises inference. Probabilistic spatial models return posterior quantities for spots [R15, R16]. A bulk analogue is proposed in section 5.

### 3.6 Pitfalls shown by benchmarks

- Pseudo-bulk built from the reference's own cells is expected to be optimistic, so section 8 holds donors or studies out.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| MuSiC | model-based | Reweighted NNLS; genes downweighted by residuals and by the cross-donor variance of each reference type | [R1] |
| bisque | hybrid | Per-gene transform of bulk learned from reference donors, then simplex least squares | [R10] |
| SCDC | model-based | Separate fits to several references, combined as an ensemble | [R11] |
| Scaden | model-based | Multilayer perceptron trained on simulated mixtures with a softmax output | [R7] |
| Simplex least squares | heuristic | Unweighted simplex-constrained least squares on the signature; the solver step of bisque | [R10] |

The published standard is the regression family. Cobos et al., as the chapter reports, recommend linear-scale input, no row, column or quantile scaling, stringent markers, a comprehensive reference, and regression tools such as CIBERSORTx [R6], FARDEEP [R9] or DWLS [R8], with DWLS, MuSiC or SCDC applied for comparison. The chapter describes CIBERSORTx as a web tool, so it is not run here as a local comparator. The simplex baseline above is the heuristic comparator here, and the chapter-named heuristic standards remain open (section 10).

| Method | Parameter | Value | Source |
|---|---|---|---|
| MuSiC | iter.max | 1000 | R/utils.R:123 @ f21fe67 |
| MuSiC | nu | 0.0001 | R/utils.R:123 @ f21fe67 |
| MuSiC | eps | 0.01 | R/utils.R:123 @ f21fe67 |
| MuSiC | centered, normalize | FALSE, FALSE | R/utils.R:123 @ f21fe67 |
| MuSiC | cell_size | NULL | R/utils.R:122; applied at R/construct.R:437-447 @ f21fe67 |
| MuSiC | markers | NULL: all bulk genes with nonzero row mean | R/utils.R:124-127 @ f21fe67 |
| MuSiC | minimum shared genes | 0.2 x min(bulk genes, reference genes), else stop | R/utils.R:134-135 @ f21fe67 |
| bisque | use.overlap | TRUE | R/reference_based.R:277 @ 8640250 |
| bisque | old.cpm | TRUE | R/reference_based.R:279 @ 8640250 |
| bisque | markers | NULL: all features | R/reference_based.R:316-317 @ 8640250 |
| bisque | solver | limSolve::lsei with E = 1, f = 1, G = I, h = 0 | R/reference_based.R:430-437 @ 8640250 |
| Scaden | batch_size | 128 | scaden/model/scaden.py:28 @ f394f71 |
| Scaden | learning_rate | 0.0001 | scaden/model/scaden.py:29 @ f394f71 |
| Scaden | num_steps | 1000 | scaden/model/scaden.py:30 @ f394f71 |
| Scaden | seed | 0 | scaden/model/scaden.py:31 @ f394f71 |
| Scaden | hidden_units | 256, 128, 64, 32 | scaden/model/scaden.py:32 @ f394f71 |
| Scaden | output | softmax | scaden/model/scaden.py:71 @ f394f71 |
| Scaden | loss | mean squared error (comment states L1) | scaden/model/scaden.py:77-82 @ f394f71 |
| Scaden | simulated samples | 1000 in total (`num_samples // 2` normal and as many sparse) | scaden/simulation/bulk_simulator.py:45, 56 @ f394f71 |
| Scaden | cells per sample | 100 | scaden/__main__.py:172 @ f394f71 |

## 5. Proposed singlet approach

Routes (licence names are given in section 12 only):

- **Reimplement** MuSiC's weighting and bisque's simplex solver, written from the equations in section 3.3 and checked for parity in B1.
- **Port** Scaden, re-expressed in PyTorch because the source is TensorFlow.
- **Port** SCDC's ensemble. It is deferred from the MCP enum because it needs several reference datasets.
- **Callout** CIBERSORTx as a web comparator only, if its terms allow.

The proposed model is not yet implemented. Donor-level reference profiles are $\theta_{kgd} = \exp(\mu_{kg} + \delta_{kgd})$, with $\delta_{kgd} \sim \mathcal N(0, \sigma^2_{kg})$ shrunk across catalogue donors. Bulk counts follow

$$x_{jg} \sim \mathrm{NB}\Big(\ell_j \sum_k \beta_{jk}\, \bar\theta_{kg},\ \phi_g\Big), \qquad \beta_j \sim \mathrm{Dirichlet}(\alpha),$$

where $\bar\theta_{kg}$ is the mean reference profile. To first order the donor covariance adds $\ell_j^2 \sum_{k,l} \beta_{jk}\beta_{jl}\Sigma_{kl,g}$ to the bulk variance, the cross-type form of MuSiC's weights (`ct.cov = TRUE`). Variational inference on the GPU gives posterior intervals on $\beta_j$, reported as 5th and 95th quantiles. A PyTorch amortised encoder trained on catalogue-derived mixtures, with a Dirichlet output head, provides the fast path.

The model is rejected as a default if, on the donor-held-out split of B2, nominal 90% intervals cover the true $p$ in fewer than 80% of cases, or its per-type RMSE exceeds music's by more than 0.02 absolute (proposed thresholds). It enters the MCP enum only after passing them.

ML stack: PyTorch for the encoder and variational fitting. Hard-coded CUDA with cuSPARSE for the small hot kernels, namely batched simplex NNLS with K from 5 to 50 and G from 10^4 to 2x10^4, and MuSiC's iterated weighted solves, which reduce to products $X^\top W Y$ and K-by-K solves. The dependency-free C++ core carries a CPU path. Reference statistics (per-type sums, per-donor sums and library sizes) accumulate in a single streaming sweep over the cells; the bulk matrix stays in memory.

Defaults an agent uses without asking: method `music`, `normalisation` cpm, `size_correction` true, `min_cells_per_type` 1, MuSiC `iter_max` 1000, `nu` 1e-4, `eps` 0.01, bisque `use_overlap` true, and the Scaden defaults in section 4.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | bulk/layers/counts | int | raw bulk counts, genes by samples |
| read | reference/layers/counts | sparse int | reference UMI counts, cells by genes |
| read | reference/obs/cell_type | category | cell-type labels; undefined and mixed labels removed first |
| read | reference/obs/subject | category | donor IDs; required by music and bisque |
| write | obsm/proportions | float32 | samples by types; non-negative; rows sum to one |
| write | uns/proportions_meta | dict | method, estimand, normalisation, shared genes, per-sample convergence, reference hash |
| write | uns/proportion_var | float32 | analytic variance, music only (section 3.3) |
| write | `models/<name>` | bytes | trained network, scaden only |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Bulk dataset handle (.singlet path or URI) holding raw counts in layers/counts, genes by samples. |
| `reference` | object | required | — | Single-cell reference: dataset handle and label keys. |
| `reference.dataset` | string | — | — | Reference dataset handle with raw counts and cell-type labels. |
| `reference.cell_type_key` | string | "cell_type" | — | obs column with cell-type labels; undefined and mixed labels must be removed first. |
| `reference.subject_key` | string | "subject" | — | obs column with donor IDs; required by music and bisque. |
| `reference.min_cells_per_type` | integer | 1 | min 1 | Drop types with fewer reference cells; 1 keeps every type. |
| `reference.size_correction` | boolean | true | — | Convert RNA shares to cell-count fractions using per-type mean library sizes. |
| `method` | string | "music" | `music`, `bisque`, `simplex_ls`, `scaden` | music is the default; simplex_ls is the unweighted heuristic baseline; scaden trains a network. |
| `normalisation` | string | "cpm" | `cpm`, `none` | cpm library-size normalises bulk and reference; none assumes linear, already normalised input. |
| `marker_genes` | array/null | null | — | Optional gene list restricting the regression; null uses all shared genes. |
| `music` | object | — | — | Options for method music. |
| `music.iter_max` | integer | 1000 | min 1 | Maximum reweighting iterations. |
| `music.nu` | number | 0.0001 | min 0 | Regulariser added to the gene-weight denominator. |
| `music.eps` | number | 0.01 | min 0 | Convergence threshold on the L1 change in proportions. |
| `bisque` | object | — | — | Options for method bisque. |
| `bisque.use_overlap` | boolean | true | — | Learn the bulk transform from donors present in both reference and bulk. |
| `scaden` | object | — | — | Options for method scaden (training on simulated mixtures). |
| `scaden.simulated_samples` | integer | 1000 | min 2 | In-silico bulk samples generated for training. |
| `scaden.cells_per_sample` | integer | 100 | min 1 | Cells drawn per simulated sample. |
| `scaden.batch_size` | integer | 128 | min 1 | Training batch size. |
| `scaden.learning_rate` | number | 0.0001 | > 0 | Adam learning rate. |
| `scaden.num_steps` | integer | 1000 | min 1 | Number of training steps. |
| `seed` | integer | 0 | — | Random seed for scaden training and simulation; other methods are deterministic. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing proportions. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Method options apply only to their method: `music.*` to music, `bisque.*` to bisque and `scaden.*` to scaden. An option supplied for another method is an error. `reference.size_correction` sets the estimand: true gives cell-count fractions (section 3.2), false gives RNA shares, and `uns/proportions_meta` records which was written. Negative values in either matrix indicate log-scale input and stop the call. Types below `min_cells_per_type` are dropped and listed in `summary`. `marker_genes` restricts the regression genes; a stringent marker set follows the chapter's recommendation, and the default uses all shared genes.

## 7. MCP tool

Tool name `singlet_deconvolution_bulk_celltype_proportions_sc_reference` (definition in `tasks/mcp/singlet_deconvolution_bulk_celltype_proportions_sc_reference.json`). Example call:

```json
{
  "dataset": "bulk_cohort.singlet",
  "reference": {"dataset": "atlas_donors.singlet", "cell_type_key": "cell_type", "subject_key": "donor"},
  "method": "music"
}
```

Example result (illustrative values):

```json
{
  "dataset": "bulk_cohort.singlet",
  "status": "completed",
  "wrote": ["obsm/proportions", "uns/proportions_meta", "uns/proportion_var"],
  "summary": {"method": "music", "estimand": "cell_fraction", "n_samples": 12, "n_cell_types": 8, "shared_genes": 9000, "non_converged_samples": 0},
  "provenance_id": "prov_example"
}
```

Long-running: music and simplex_ls return inline; scaden training returns a `job_id` with status `queued`. Stochastic: only scaden, through `seed`. Dry-run estimate: returns seconds, peak memory and device from the input sizes.

## 8. Benchmarks

All accuracy benchmarks use CPM input on a linear scale, with no row, column or quantile scaling. Within a benchmark the reference, gene set and marker list are identical across methods. Accuracy is scored per sample and per type, then averaged uniformly over types. The estimand is the cell-count fraction $p$ (section 3.2), and RNA-share results are reported separately. The coefficient of determination R² is averaged over types; a type with constant true fraction has undefined R², which is reported and not imputed. Seeds, mixture counts and replicate numbers are to be fixed by a power calculation before scoring.

### B1. Jin and Liu framework benchmark (published)

- **Goal**: compare estimators across three in-silico frameworks that vary the simulation model, quantification unit, number of components, weight matrix and unknown content.
- **Ground truth**: planted simulation. Each mixture's component proportions are the simulated weights released with the framework, with normalisation as set in section 10.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Sim1, Sim2, Sim3 in-silico mixtures | [R3]; data description and figshare link in the authors' repository (section 12) | bulk RNA-seq mixtures; condition count not confirmed (section 10) | — | Source series: GSE113590, GSE51984, GSE60424, GSE64655, GSE115736, GSE118490 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pearson correlation | Pearson correlation between estimated and simulated proportions over all type and sample entries together (`calc.cor`, `cor` evaluation) | maximize | primary | [R3] |
| Mean absolute deviation | mean absolute difference between estimated and simulated proportions over all entries (`calc.mad`, `mad` evaluation) | minimize | primary | [R3] |

- **Comparators**: music, bisque, simplex_ls and scaden, applied to the released mixtures. The other methods of the source are not applied in this benchmark.
- **Protocol**: released reference profiles and gene sets as given; each framework scored separately; no further filtering.
- **Acceptance criterion** (proposed, parity test rather than a literature value): singlet's music and bisque reproduce the reference implementations' proportions on the released mixtures within 0.02 absolute per proportion.
- **Known pitfalls**: a method that ranks well in one framework can rank poorly in another [R3], so each framework is reported separately. Truth normalisation must match the estimand (section 3.2) before scores are compared.

### B2. Held-out pseudo-bulk on the singlet catalogue (proposed)

- **Goal**: measure proportion accuracy under donor and study holdout, at major-type and subtype resolution.
- **Ground truth**: planted simulation. Sampled cell counts per type from held-out cells give $p$, the sampled count share; the UMI share gives $\beta$. Normalisation: cell-count fraction for $p$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue | singlet internal catalogue | scRNA-seq and snRNA-seq; 354M cells, about 40% with author annotations; species — | internal (section 12) | donor-ID coverage across studies is open (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-type Pearson r | correlation across held-out mixtures per type, averaged uniformly over types | maximize | primary | — |
| Per-type RMSE | root mean squared error per type across held-out mixtures, averaged uniformly over types | minimize | primary | — |
| R² | coefficient of determination averaged uniformly over types, undefined types reported | maximize | guardrail | [R14] |

- **Comparators**: music, bisque, simplex_ls and scaden. SCDC is added once a multi-reference arm exists.
- **Protocol**: generator recipe:
  1. Select studies that carry donor IDs and author annotations, and map their labels to one hierarchy with annotation.cross_dataset_label_reconciliation before building types.
  2. Split by study and by donor. Hold out whole studies for the bulk side (study split) and whole donors within studies (donor split). Build the reference from the remaining cells.
  3. Draw proportion vectors $p \sim \mathrm{Dirichlet}(\alpha)$ over types, with $\alpha = 1$ (dense) and $\alpha = 0.3$ (sparse), both proposed.
  4. For each mixture, draw $N = 10^4$ held-out cells per mixture (proposed), with type counts $\mathrm{round}(N p_k)$.
  5. Sum UMI counts over the drawn cells and normalise the sum to CPM on a linear scale.
  6. Store the true $p$ and the true $\beta$ for each sample as separate arrays.
- **Acceptance criterion** (proposed): on the donor-held-out split, mean per-type Pearson r is at least 0.80 for types with mean true fraction at least 0.05, and overall RMSE is no worse than the better of music and bisque by more than 0.02 absolute.
- **Known pitfalls**: reference and pseudo-bulk sharing donors or studies inflate scores, which the two holdout splits prevent. Dirichlet proportions are not tissue compositions, so a biologically structured arm is proposed as a second design.

### B3. Orthogonal neutrophil counts in COVID-19 whole blood (published worked example)

- **Goal**: test whether the estimated neutrophil fraction tracks measured neutrophil counts in whole-blood bulk RNA-seq.
- **Ground truth**: orthogonal measurement, the total neutrophil count per mm³ in the cohort metadata. The estimand is relative and the count is absolute, so the test is one of linear association (section 3.2).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| COVID-19 whole-blood bulk RNA-seq | [R12] | bulk RNA-seq, human whole blood; 49 samples from 39 patients and 10 healthy controls | — | Samples with missing counts are excluded from r |
| COVID-19 whole-blood single-cell reference | [R13] | scRNA-seq, human whole blood; size — | — | Different cohort from the bulk |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pearson r per type | correlation across samples with measured counts, between estimated fraction and count | maximize | primary | [R12, R13] |
| Patient versus control p-value | Student t-test per type on estimated fractions, with Benjamini-Hochberg control across types (proposed addition) | minimize | secondary | [R12] |

- **Comparators**: music (the chapter's worked example), bisque and simplex_ls.
- **Protocol**: remove undefined and mixed reference labels, restrict to shared genes, and use linear CPM, as in the chapter's worked example, with the multiplicity control added.
- **Acceptance criterion** (proposed): Pearson r of at least 0.70 for the neutrophil type between estimated fraction and measured count, on samples with measured counts.
- **Known pitfalls**: the reference and the bulk come from different cohorts, so reference-bulk mismatch is built in. The chapter does not describe multiplicity correction for its per-type t-tests.

### P1. Performance and scaling

Wall time and peak memory for reference preprocessing plus estimation, for music, bisque, simplex_ls and scaden (training and inference reported separately), on CPU and CUDA. Grid (proposed; the sources give no runtime figures for bulk deconvolution): reference cells 10^4, 10^5, 10^6 and 10^7 (the last to test the streaming claim); bulk samples 10^2, 10^3 and 10^4; K = 5, 20 and 50; shared genes 10k and 20k. Hold fixed: gene set, K, threads and normalisation. Record R, Python, CUDA and container versions. Design target, not a literature value: peak memory at most 16 GB and wall time at most 10 minutes per 1,000 bulk samples at 10^5 reference cells, K = 20 and 2x10^4 genes.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `annotation.cross_dataset_label_reconciliation`: Cross-dataset cell-type label reconciliation
- **Feeds**:
  - `deconvolution-bulk.celltype_specific_expression`: Cell-type-specific expression profiles per bulk sample
  - `deconvolution-bulk.celltype_specific_de_bulk`: Cell-type-specific differential expression from bulk case-control data
  - `deconvolution-bulk.celltype_specific_eqtl_bulk`: Cell-type-specific eQTL from bulk cohorts using estimated cell fractions
  - `abundance.celltype_proportion_test`: Differential abundance of predefined cell types between conditions
- **Reads**: `bulk/layers/counts`, `reference/layers/counts`, `reference/obs/cell_type`, `reference/obs/subject`
- **Writes**: `obsm/proportions`, `uns/proportions_meta`, `uns/proportion_var`, `models/<name>`
<!-- CHAINING:AUTO:END -->

Workflows: bulk composition estimation for donor-level association analyses and cell-type-specific bulk analysis.

## 10. Risks, pitfalls and open questions

- **Benchmarks not promoted.** Sutton et al. 2022 and Nadel et al. 2021 are cited for their stated scope. Their metric definitions, dataset sizes and truth definitions are not stated here, so neither is a benchmark in section 8.
- **Source conflicts.** The corpus record dates Cobos et al. to 2021, while volume 11 and the DOI indicate 2020; 2020 is used. The Sutton et al. record (volume 13, article 1358, DOI, 15 March 2022) was confirmed by web search and is absent from the local literature index.
- **Jin and Liu details.** The repository's `cor` and `mad` evaluations pool all type and sample entries (`calc.cor`, `calc.mad`); its per-type variants are separate evaluations. The condition count is not stated in the repository files read. The normalisation of the released component proportions (cell count or RNA share) fixes the estimand of B1, so this check comes before B1 is scored.
- **Missing accessions.** No accession was confirmed for the COVID-19 bulk or single-cell data, and the size of the single-cell reference is unknown. Donor-ID coverage across the singlet catalogue is unknown. B2 and B3 depend on these.
- **Heuristic standards and unread methods.** CIBERSORTx, FARDEEP and DWLS, the chapter-named regression standards, have no parameters or code transcribed here, and neither do BayesPrism, RNA-Sieve, dtangle, MuSiC2 or TAPE. They are excluded from tables and from the MCP enum. Scaden's loss comment conflicts with its computed loss; the code is followed.
- **First experiment.** Reimplement MuSiC's weights and the simplex solver, check parity on B1 once the normalisation is confirmed, then score B3 when accessions are found. The Bayesian arm proceeds only if it passes the thresholds in section 5 on B2.

## 11. References

R1. Wang X, Park J, Susztak K, Zhang NR, Li M. Bulk tissue cell type deconvolution with multi-subject single-cell expression reference. *Nature Communications* 10:380 (2019). doi:10.1038/s41467-018-08023-x — verified (corpus)
R2. Avila Cobos F, Alquicira-Hernandez J, Powell JE, Mestdagh P, De Preter K. Benchmarking of cell type deconvolution pipelines for transcriptomics data. *Nature Communications* 11:5650 (2020). doi:10.1038/s41467-020-19015-1 — verified (corpus)
R3. Jin H, Liu Z. A benchmark for RNA-seq deconvolution analysis under dynamic testing environments. *Genome Biology* 22:102 (2021). doi:10.1186/s13059-021-02290-6 — verified (corpus)
R4. Nadel BB, Oliva M, Shou BL, et al. Systematic evaluation of transcriptomics-based deconvolution methods and references using thousands of clinical samples. *Briefings in Bioinformatics* 22(6):bbab265 (2021). doi:10.1093/bib/bbab265 — verified (corpus)
R5. Sutton GJ, Poppe D, Simmons RK, et al. Comprehensive evaluation of deconvolution methods for human brain gene expression. *Nature Communications* 13:1358 (2022). doi:10.1038/s41467-022-28655-4 — verified (search)
R6. Newman AM, Steen CB, Liu CL, et al. Determining cell type abundance and expression from bulk tissues with digital cytometry. *Nature Biotechnology* 37:773-782 (2019). doi:10.1038/s41587-019-0114-2 — verified (corpus)
R7. Menden K, Marouf M, Oller S, et al. Deep learning-based cell composition analysis from tissue expression profiles. *Science Advances* 6:eaba2619 (2020). doi:10.1126/sciadv.aba2619 — verified (corpus)
R8. Tsoucas D, Dong R, Bahlo M, et al. Accurate estimation of cell-type composition from gene expression data. *Nature Communications* 10:2975 (2019). doi:10.1038/s41467-019-10802-z — verified (corpus)
R9. Hao Y, Yan M, Heath BR, Lei YL, Xie Y. Fast and robust deconvolution of tumor infiltrating lymphocyte from expression profiles using least trimmed squares. *PLOS Computational Biology* 15(5) (2019). doi:10.1371/journal.pcbi.1006976 — verified (corpus)
R10. Jew B, Alvarez M, et al. Accurate estimation of cell composition in bulk expression through robust integration of single-cell information. *Nature Communications* (2020). doi:10.1038/s41467-020-15816-6 — verified (corpus)
R11. Dong M, Thennavan A, Urrutia E, et al. SCDC: bulk gene expression deconvolution by multiple single-cell RNA sequencing references. *Briefings in Bioinformatics* 22(1):416-427 (2020). doi:10.1093/bib/bbz166 — verified (corpus)
R12. Aschenbrenner AC, Mouktaroudi M, Krämer B, et al. Disease severity-specific neutrophil signatures in blood transcriptomes stratify COVID-19 patients. *Genome Medicine* 13:7 (2020). doi:10.1186/s13073-020-00823-5 — verified (corpus)
R13. Schulte-Schrepping J, Reusch N, Paclik D, et al. Severe COVID-19 is marked by a dysregulated myeloid cell compartment. *Cell* (2020). doi:10.1016/j.cell.2020.08.001 — verified (corpus)
R14. Miles J. R-squared, adjusted R-squared. *Encyclopedia of Statistics in Behavioral Science* (Wiley) (2005). doi:10.1002/0470013192.bsa526 — verified (corpus)
R15. Kleshchevnikov V, Shmatko A, Dann E, et al. Cell2location maps fine-grained cell types in spatial transcriptomics. *Nature Biotechnology* (2022). doi:10.1038/s41587-021-01139-4 — verified (corpus)
R16. Lopez R, Li B, Keren-Shaul H, et al. DestVI identifies continuums of cell types in spatial transcriptomics data. *Nature Biotechnology* (2022). doi:10.1038/s41587-022-01272-8 — verified (corpus)
R17. Aliee H, Theis FJ. AutoGeneS: automatic gene selection using multi-objective optimization for RNA-seq deconvolution. *Cell Systems* 12(7):706-715 (2021). doi:10.1016/j.cels.2021.05.006 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/xuranw/MuSiC | Xuran Wang (author and maintainer, DESCRIPTION) | GPL-3 (LICENSE file; DESCRIPTION GPL (>= 3)) | weighted NNLS and analytic variance | reimplement |
| https://github.com/cozygene/bisque | Brandon Jew, Marcus Alvarez (DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file at repository root) | simplex solver and donor-based bulk transform | reimplement |
| https://github.com/meichendong/SCDC | Meichen Dong (LICENSE; copyright 2025) | MIT (LICENSE); DESCRIPTION licence field is a placeholder, so the LICENSE file is taken | multi-reference ensemble | port (deferred from enum) |
| https://github.com/KevinMenden/scaden | Kevin Menden (setup.py, LICENSE) | MIT (LICENSE; setup.py) | learned mapping on simulated mixtures (TensorFlow) | port to PyTorch |
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE; copyright 2021) | Apache-2.0 (LICENSE) | deconvolution chapter: recommendations and worked example | callout (text only) |
| https://github.com/LiuzLab/paper_deconvBenchmark | LiuzLab (repository); Jin H, Liu Z (paper authors) | MIT (LICENSE; copyright 2020 LiuzLab) | data description and figshare link for B1 | callout (data use) |
| singlet catalogue | singlet | internal | pseudo-bulk source for B2 | not applicable (internal data) |
