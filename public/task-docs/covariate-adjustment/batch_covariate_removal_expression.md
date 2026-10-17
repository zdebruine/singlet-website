---
id: covariate-adjustment.batch_covariate_removal_expression
title: Known batch or donor covariate removal on expression
area: covariate-adjustment
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [covariate-adjustment.covariate_variance_attribution, integration.batch_effect_diagnosis, normalization.size_factor_estimation, feature-selection.highly_variable_gene_selection]
feeds: [dim-reduction.normalized_cell_embedding, evaluation.overcorrection_detection, integration.integration_quality_scoring, statistics.pvalue_null_calibration]
reads: [layers/counts, layers/log1p_norm, obs/<batch_key>, obs/<protect>]
writes: [layers/combat_corrected, layers/combat_seq_corrected, uns/batch_correction, models/batch_correction]
devices: [cpu, cuda]
mcp_tool: singlet_covariate_adjustment_batch_covariate_removal_expression
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Known batch or donor covariate removal on expression

> Removes known categorical batch or donor effects from expression with per-gene empirical-Bayes location-scale models (ComBat on log values, ComBat-seq on counts), keeps declared biological terms in the design, and writes the corrected layer with the parameters behind it.

## 1. Question

Can a per-gene model of known batch or donor labels remove those effects from expression while keeping protected biological terms and cell-type structure? The input is a cells-by-genes matrix (log-normalized values, or raw counts for the count variant), a categorical batch label and optional protected terms. The output is a corrected matrix of the same shape. A correct answer removes batch-associated variation that is unrelated to the protected terms and leaves within-batch biology unchanged.

## 2. Why this task matters and where the field stands

Batch labels (study, donor, chemistry, processing date) shift expression in ways that can dominate cell-type structure in atlases [R1]. Correction is not always needed: the best-practices book advises visualising the data first, because correction can mask biological variation of interest [R2]. The model-based routes are ComBat, an empirical-Bayes location-scale model on log values [R3], and ComBat-seq, its negative-binomial counterpart that returns adjusted counts [R4]. The heuristic comparators are Seurat anchors and Scanorama [R5, R6]. Tran et al. benchmark batch-correction methods on scRNA-seq data [R16].

The status is **contested**. Batch mixing and biology conservation trade off, and the batch label enters both the correction and the metric, so scores are partly circular [R1, R7]. For differential expression, the book recommends sample-level pseudobulk analysis over cell-level tests [R2], and cell-level tests inflate false positives under donor pseudoreplication [R8, R9]. A 2023 DE benchmark reports that corrected matrices seldom help on sparse data, while batch as a model covariate helps under strong batch effects [R10]. Cell-state erasure by batch correction is the subject of a 2021 preprint [R11].

Open problems: whether corrected expression should feed differential expression at all; batch effects that differ by cell type, which one shift per gene and batch cannot represent; the choice of batch variable (donor, sample, study); and calibrated uncertainty for corrected values.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $Y_{ijg}$ | input value of gene $g$ in cell $j$ of batch $i$, on the log scale |
| $X_{ij}$ | protected design row with intercept; contains no batch term |
| $\gamma_{ig}$, $\delta_{ig}$ | additive and multiplicative batch effects of gene $g$ in batch $i$ |
| $K_{ijg}$, $N_j$ | raw count and library size of cell $j$ (ComBat-seq) |
| $\phi_{ig}$ | gene-wise negative-binomial dispersion in batch $i$ |

**ComBat.** Each gene follows

$$Y_{ijg}=\alpha_g+X_{ij}^{\top}\beta_g+\gamma_{ig}+\delta_{ig}\,\varepsilon_{ijg},\qquad \varepsilon_{ijg}\sim\mathcal N(0,\sigma_g^2).$$

The batch effect is an additive shift plus a scale, shared by all cells of a batch. Setting $\delta_{ig}=1$ gives the additive-only variant. The Gaussian residual is a first-order approximation on the log scale; sparse, zero-inflated log values violate it, and the shrinkage then acts on distorted moments [R3].

**Empirical Bayes.** Across genes the batch parameters have priors

$$\gamma_{ig}\sim\mathcal N(\bar\gamma_i,\tau_i^2),\qquad \delta_{ig}^2\sim\mathrm{InvGamma}(\lambda_i,\theta_i),$$

where $\lambda_i=(2s_i^2+m_i^2)/s_i^2$ and $\theta_i=(m_is_i^2+m_i^3)/s_i^2$, with $m_i$ and $s_i^2$ the across-gene mean and variance of the batch variance estimates (scanpy `_aprior` and `_bprior`). The update

$$\gamma^{*}_{ig}=\frac{\tau_i^2 n_i\hat\gamma_{ig}+\delta^{(t)}_{ig}\bar\gamma_i}{\tau_i^2 n_i+\delta^{(t)}_{ig}},\qquad \delta^{2\,(t+1)}_{ig}=\frac{\tfrac12\sum_{j\in B_i}(s_{ijg}-\gamma^{*}_{ig})^2+\theta_i}{n_i/2+\lambda_i-1}$$

iterates until the maximum relative change falls below the tolerance `conv` (scanpy `_it_sol`). Here $\hat\gamma_{ig}$ is the batch mean of the standardized values $s_{ijg}$ and $n_i$ is the batch size. Shrinkage toward $\bar\gamma_i$ is weak when $n_i$ is large and strong when $n_i$ is small. The moment-matched priors need $s_i^2>0$ and many genes to be stable.

**Standardization and back-transform.** Fit the full design $[B\;X]$ by least squares, where $B$ holds batch indicators. The pooled residual variance divides by the number of cells $N$, not by $N$ minus the number of columns. The standardized values are $s_{ijg}=(Y_{ijg}-\hat\alpha_g-X_{ij}^{\top}\hat\beta_g)/\hat\sigma_g$. After estimation the corrected values are

$$Y^{*}_{ijg}=\hat\sigma_g\,\frac{s_{ijg}-\gamma^{*}_{ig}}{\sqrt{\delta^{*2}_{ig}}}+\hat\alpha_g+X_{ij}^{\top}\hat\beta_g,$$

which is the scanpy back-transform. The fitted protected term is restored in full and only the batch terms are removed.

**ComBat-seq.** Counts follow

$$K_{ijg}\sim\mathrm{NB}(\mu_{ijg},\phi_{ig}),\qquad \log\mu_{ijg}=\log N_j+\alpha_g+X_{ij}^{\top}\beta_g+\gamma_{ig}.$$

Each gene is fitted by a GLM with $\log N_j$ as offset. A count from batch $i$ is mapped to a batch-free target $\mathrm{NB}(\mu^*,\phi^*)$, with $\mu^*=\exp(\log\hat\mu-\hat\gamma_{ig})$ and $\phi^*$ the average of the batch-wise dispersions:

$$K^*=1+F^{-1}_{\mathrm{NB}}\bigl(F_{\mathrm{NB}}(K-1;\hat\mu,\hat\phi);\mu^*,\phi^*\bigr)\quad(K>1),\qquad K^*=K\quad(K\le 1).$$

The output is integer valued. In the inmoose version read, `shrink=True` raises an error, so only the GLM estimates are used.

**Estimands.** Each output is defined on its own scale, with no re-normalisation.

- ComBat output $Y^*$: the value the cell would have in a batch-free reference under the fitted model, on the scale of the input layer.
- ComBat-seq output $K^*$: the batch-free count on the raw count scale; library sizes are not renormalised.
- Planted batch effects: $\gamma_{ig}$ and $\delta_{ig}$ as generated, on the standardized scale of the ComBat form.
- Planted condition effect: $\beta_g$, additive on the natural-log scale of the input layer.
- Corrected DE statistic: the t-statistic of the protected term in an ordinary least-squares fit of corrected values; unitless.

**Identification and regime.** Batch is identified only through contrasts within strata of $X$. If batch is confounded with a protected term, the batch coefficient absorbs biology and the fit removes it. The model also assumes one shift and one scale per batch and gene, shared by all cell types. A cell-type-specific batch effect therefore remains within each type, and the shared shift can erase real cell-state differences [R11]. Scanpy ComBat is dense only, so memory grows with cells times genes.

**Insight.** Pooling across genes stabilises the batch parameters when batches are small, which is the reason ComBat is stable for small batches. The price is a single shift and scale per gene and batch: the correction cannot represent batch effects that depend on cell type, and it removes whatever the protected design fails to name. Three pitfalls recur in benchmarks. (i) Circular evaluation: kBET uses the batch label the method consumed, and its stratification uses the cell-type labels that the biology metrics also use [R1, R7]. (ii) Over-correction, which can raise batch scores while erasing cell states [R11]. (iii) The OpenProblems wrapper stores log-scale ComBat output under `corrected_counts`, so count-based code will misread it.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| ComBat (scanpy) | model-based | per-gene hierarchical location-scale model on log values, with batch parameters shrunk across genes | [R3] |
| ComBat-seq (inmoose) | model-based | per-gene negative-binomial GLM with a batch term; counts mapped to a batch-free target by quantile matching | [R4] |
| Seurat anchors (CCA; OpenProblems `seurat_cca` runs the Seurat v5 workflow) | heuristic | mutual anchors between datasets in a shared space and weighted correction; returns an integrated assay | [R5] |
| Scanorama | heuristic | mutual nearest neighbours across datasets on a low-dimensional manifold and weighted alignment; returns corrected expression | [R6] |

ComBat and ComBat-seq are the model-based routes in the scanpy and OpenProblems pipelines [R3, R4]. The heuristic comparators in those pipelines are Seurat anchors and Scanorama [R5, R6]. Harmony, fastMNN, scVI and scGen are owned by the integration task and are not tabulated here (Section 10).

Defaults taken from source code at the stated commit:

| Method | Parameter | Value | Source |
|---|---|---|---|
| ComBat | `key` | `"batch"` | `scverse_scanpy/src/scanpy/preprocessing/_combat.py:136` @8ed52d9 |
| ComBat | `covariates` | `None` | `_combat.py:138` @8ed52d9 |
| ComBat | `inplace` | `True` | `_combat.py:139` @8ed52d9 |
| ComBat | minimum cells per batch | 2; an error below this | `_combat.py:209–214` @8ed52d9 |
| ComBat | input type | dense only; sparse input is densified | `_combat.py:197` @8ed52d9 |
| ComBat | EB tolerance `conv` (`_it_sol` default; not a `sc.pp.combat` argument) | `1e-4` | `_combat.py:301` @8ed52d9 |
| ComBat | batch variance estimate | pooled over all cells, divided by N | `_combat.py:111–113` @8ed52d9 |
| OpenProblems ComBat | call | `sc.pp.combat(key='batch', inplace=False)` on `layers/normalized`; no covariates; stored as `corrected_counts` | `openproblems-bio_task_batch_integration/src/methods/combat/script.py:22–41` |
| ComBat-seq | `covar_mod` | `None` | `epigenelabs_inmoose/inmoose/pycombat/pycombat_seq.py:33` @4c14ed5 |
| ComBat-seq | `shrink` | `False`; `True` raises `NotImplementedError` | `pycombat_seq.py:34`, `184–186` @4c14ed5 |
| ComBat-seq | `shrink_disp` | `False` | `pycombat_seq.py:35` @4c14ed5 |
| ComBat-seq | `ref_batch` | `None` | `pycombat_seq.py:37` @4c14ed5 |
| ComBat-seq | `na_cov_action` | `'raise'` | `pycombat_seq.py:38` @4c14ed5 |
| ComBat-seq | GLM `prior_count` | `1e-4` | `pycombat_seq.py:159`, `174` @4c14ed5 |
| ComBat-seq | target dispersion | mean of batch-wise gene dispersions | `pycombat_seq.py:200` @4c14ed5 |
| ComBat-seq | quantile map | counts of 1 or less, and counts whose lower-tail probability is within 1e-4 of 1, unchanged; otherwise as in Section 3 | `epigenelabs_inmoose/inmoose/pycombat/helper_seq.py:61–72` @4c14ed5 |
| OpenProblems ComBat-seq | call | `pycombat_seq(counts, batch)` on `layers/counts` (genes by cells); no covariates | `openproblems-bio_task_batch_integration/src/methods/combat_seq/script.py:19–36` |
| Seurat `FindIntegrationAnchors` | `dims`, `k.anchor`, `k.filter` | `1:30`, `5`, `200` | `satijalab_seurat/R/integration.R:148–150` @5f67c70 |
| Seurat `IntegrateData` | `k.weight`, `sd.weight` | `100`, `1` | `satijalab_seurat/R/integration.R:1496`, `1498` @5f67c70 |
| Scanorama | `knn`, `sigma`, `alpha`, `approx` | `20`, `15`, `0.10`, `True` | `brianhie_scanorama/scanorama/scanorama.py:21–29` @4b4ea07 |
| Scanorama | return value | corrected datasets when `return_dimred=False` | `scanorama.py:33`, `76–82` @4b4ea07 |
| OpenProblems Scanorama | call | `correct_scanpy(return_dimred=True)` on `layers/normalized` | `openproblems-bio_task_batch_integration/src/methods/scanorama/script.py:32` |
| OpenProblems data processor | `--hvgs` | `2000` | `openproblems-bio_task_batch_integration/README.md:163` |
| OpenProblems kNN graphs for kBET and corrected feature outputs | `k` | `50` | `openproblems-bio_task_batch_integration/src/metrics/kbet/config.vsh.yaml:18` |
| scib kBET | `k0` | `min(70, max(10, floor(mean batch size within label / 4)))` | `theislab_scib/scib/metrics/kbet.py:111–114` @cd67913 |

## 5. Proposed singlet approach

- **`combat`: port.** Port the scanpy algorithm (BSD-3-Clause, Section 12) with its defaults, then add the protected design, estimation of batch parameters on `hvg_subset` genes, and cell-chunked streaming. The per-gene least-squares solves and the EB updates are small batched operations, hard-coded in CUDA with cuBLAS batched GEMM.
- **`combat_seq`: reimplement.** Reimplement the model of Section 3 from the inmoose code read (GPL-3, Section 12); no code is copied. The per-gene negative-binomial fit is a batched Newton or IRLS solve in CUDA. The NB CDF and its inverse, needed by the quantile map, are written into the kernel; the CPU reference calls `scipy.stats.nbinom`, as inmoose does.
- **Seurat anchors and Scanorama: callout** as benchmark comparators only.

The proposed formulation keeps the ComBat form and places the protected design $X$ in the expected value, so protected terms are restored rather than removed. Two additions are singlet's proposals and not published methods: batch parameters are estimated on the HVG subset and applied to all genes, and the posterior means $\gamma^*$ and $\delta^*$ are stored in `models/batch_correction`, so that new cells can be adjusted without refitting. Scanpy ComBat gives no uncertainty; a variational variant over $(\gamma,\delta)$ is a candidate extension outside the first version. The formulation is falsified if the protected fit misses the retention target in B2 or the null false-positive target in B3. Because the ComBat-form generator favours ComBat by construction, the misspecified counts in B2 (item 7) decide whether the claim survives.

No PyTorch is needed for this task. The per-gene designs have few columns (batches plus protected terms), so the solves are small and regular, and they are better as hand-written CUDA kernels with cuSPARSE for sparse sufficient statistics. PyTorch is reserved for the conditional deep models owned by the integration task. Core kernels are gene-wise sums, batched normal equations, EB updates, the back-transform, NB IRLS and the quantile map.

On CPU the computation proceeds in gene blocks with float32 output. The normal equations are accumulated in one sweep over cell chunks; a second sweep accumulates the pooled and per-batch residual sums of squares; a third applies the correction. This follows from the algebra and is not benchmarked yet (P1 measures it).

Defaults an agent uses without asking: `method` combat; `batch_key` batch; `protect` set to the condition or cell-type column when one exists (an empty `protect` is allowed and reported); `layer` null; `combat.hvg_subset` 2000; `combat.conv` 1e-4; `device` auto.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, required by `combat_seq` |
| read | layers/log1p_norm | sparse float32 | log-normalized values, required by `combat` |
| read | obs/<batch_key> | categorical | batch or donor label; at least two cells per batch |
| read | obs/<protect> | categorical or numeric | biological terms kept in the design |
| write | layers/combat_corrected | float32 dense | corrected log values, same shape (`combat`) |
| write | layers/combat_seq_corrected | float32 dense | adjusted integer-valued counts (`combat_seq`) |
| write | uns/batch_correction | dict | method, protected terms, batch sizes, EB iterations, `conv` |
| write | models/batch_correction | table | per-gene $\hat\alpha$, $\hat\beta$, $\hat\sigma$, $\gamma^*$ and $\delta^*$ for reuse |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "combat" | `combat`, `combat_seq` | combat: log-scale empirical Bayes. combat_seq: negative-binomial counts; needs raw counts. |
| `batch_key` | string | "batch" | — | obs column with the categorical batch or donor label; each batch needs at least two cells. |
| `protect` | array | [] | — | obs columns of biological variables kept in the design. Set the condition or cell-type column when present. |
| `layer` | string/null | null | — | Input layer. Null selects layers/log1p_norm for combat and layers/counts for combat_seq. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `combat` | object | — | — |  |
| `combat.conv` | number | 0.0001 | > 0 | Relative-change tolerance of the empirical-Bayes iteration. |
| `combat.hvg_subset` | integer/null | 2000 | min 1 | Estimate batch parameters on this many highly variable genes, then apply to all genes; null uses all genes. |
| `combat.chunk_cells` | integer | 100000 | min 1000 | Cells per chunk in the streaming sweeps; bounds dense memory. |
| `combat_seq` | object | — | — |  |
| `combat_seq.ref_batch` | string/null | null | — | Batch kept unchanged, to which others are adjusted; null maps every batch to the batch-free target. |
<!-- PARAMS:AUTO:END -->

Parameter rules: the `combat` object applies only when `method` is combat and `combat_seq` only when it is combat_seq; `protect` applies to both. The layer must match the method, a log-normalized layer for combat and a counts layer for combat_seq; a mismatch is refused, and the tool never converts one layer into the other. Batch sizes are reported because empirical-Bayes estimates are unstable for small batches. Batch and protected columns must not duplicate each other; a rank-deficient design fails and reports its rank. `overwrite` replaces existing output members.

## 7. MCP tool

Tool name `singlet_covariate_adjustment_batch_covariate_removal_expression` (definition in `tasks/mcp/singlet_covariate_adjustment_batch_covariate_removal_expression.json`). Example call, with illustrative inputs:

```json
{"dataset": "/data/example.singlet", "method": "combat", "batch_key": "donor",
 "protect": ["cell_type"], "combat": {"hvg_subset": 2000}}
```

Example result, with placeholders for computed values:

```json
{"dataset": "/data/example.singlet", "status": "completed",
 "wrote": ["layers/combat_corrected", "uns/batch_correction", "models/batch_correction"],
 "summary": {"method": "combat", "protect": ["cell_type"], "n_batches": "<int>",
   "min_batch_cells": "<int>", "eb_iterations": "<int>", "max_relative_change": "<float>",
   "hvg_subset": 2000},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: calls above the inline size limit return `queued` with a `job_id`. Stochastic: no; the output is a deterministic function of the input and parameters. Dry run: returns estimated seconds and peak memory, from the output size of $4nG$ bytes and the device, without fitting.

## 8. Benchmarks

Shared protocol. All accuracy benchmarks compare the same methods on the same input layer (`layers/log1p_norm`, or `layers/counts` for ComBat-seq). Graph-based metrics are computed on a PCA and a kNN graph built with scanpy preprocessing, with k = 50 for corrected feature outputs, as in the OpenProblems pipeline (Section 4). Metric definitions follow the OpenProblems batch-integration metric directories and the scIB definitions [R1, R7]. Simulated designs use five seeds (PROPOSED). Accuracy is reported per dataset and as a mean over datasets; no weighted total is defined.

### B1. Batch integration on the OpenProblems common dataset

- **Goal**: measure batch mixing and biology conservation of ComBat, ComBat-seq and the heuristic corrections on one real dataset with known batch labels and curated cell types.
- **Ground truth**: the batch label is known by design (`obs/batch`), and curated cell-type labels (`obs/cell_type`) are the biology reference. Batch metrics measure mixing of batch labels in neighbourhoods; biology metrics compare clusters or neighbourhoods with cell-type labels. Every score lies in [0, 1], higher is better, and kBET is reported as one minus its mean rejection rate.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_immune_cell_atlas (OpenProblems batch-integration test resource) | OpenProblems task repository (Section 12) | — | — | Input `layers/normalized` (ComBat, Scanorama) or `layers/counts` (ComBat-seq); keys `batch` and `cell_type` |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| kBET | per cell-type label with at least 10 cells and more than one batch (other labels are skipped); k0 is the mean batch size within the label divided by 4, floored and clipped to [10, 70]; the test runs on connected components of at least 3·k0 cells, and the label scores 1 when fewer than 75% of cells lie in such components; score is 1 minus the mean rejection rate over labels | maximise | primary (batch) | [R7] |
| iLISI | local inverse Simpson index on batch over kNN neighbourhoods, rescaled as (LISI − 1)/(number of batches − 1) | maximise | primary (batch) | [R1] |
| PCR | fraction of batch variance removed, (before − after)/before, clamped at 0 | maximise | primary (batch) | [R1] |
| Graph connectivity | connectivity of the kNN graph restricted to each cell-type label | maximise | primary (batch) | [R1] |
| Batch ASW | 1 minus absolute silhouette on batch, averaged within each cell-type label | maximise | primary (batch) | [R1] |
| ARI | adjusted Rand index of clusters against `cell_type`, over clustering resolutions 0.2 to 0.8, with the maximum taken (PROPOSED) | maximise | primary (biology) | [R1] |
| Cell-type ASW | silhouette on `cell_type`, rescaled as (silhouette + 1)/2 | maximise | primary (biology) | [R1] |
| cLISI | LISI on `cell_type`, rescaled as (number of labels − LISI)/(number of labels − 1) | maximise | primary (biology) | [R1] |

- **Comparators**: unintegrated log-normalized input; ComBat and ComBat-seq, each with `protect` empty and with `protect` set to `cell_type`; Seurat anchors (CCA reduction); Scanorama corrected expression.
- **Protocol**: fit each method with its OpenProblems settings (2000 HVGs, no protected term) and, for both ComBat variants, also with `protect = cell_type`. Only the protected variants differ from the shared protocol.
- **Acceptance criterion** (PROPOSED, not from the literature): (a) the mean batch score over kBET, iLISI, PCR and graph connectivity is at least 0.10 above the unintegrated input; (b) the mean biology score over ARI, cell-type ASW and cLISI falls by no more than 0.02 absolute.
- **Known pitfalls**: circularity between the batch label the method consumes and the kBET stratification that the biology metrics also use; the OpenProblems comparators supply no protected design, so biology preservation under confounding is not tested here (see B2).

### B2. Planted batch and protected-signal recovery (proposed simulation)

- **Goal**: test whether a method removes known batch effects while keeping a planted condition effect, with exact truth.
- **Ground truth**: planted simulation. Per gene, the condition effect $\beta_g$ (natural log, additive; Section 3). Per batch and gene, $\gamma_{ig}$ and $\delta_{ig}$ from the recipe. The positive class is the planted gene set. Each method's statistic is the absolute t-statistic of the condition term in an ordinary least-squares fit of corrected values on condition. The retention ratio is the condition R² on corrected values divided by the condition R² on uncorrected values, computed per gene and summarised by the median.
- **Generator recipe** (design values are PROPOSED):
  1. Base means $b_g$: per-gene mean of `layers/log1p_norm` over the 2000 HVGs of the B1 dataset, with the batch label ignored.
  2. Design: five batches of 2000 cells, two cell types split equally within each batch. Balanced design: condition fraction 0.5 in every batch and type. Confounded design: condition fraction 0.8 in batch 1 and 0.2 in the others.
  3. Cell-type offsets $c_{gk}\sim\mathcal N(0,1)$, fixed per gene and type.
  4. Planted condition effect: 200 random genes with $\beta_g=0.5$; all others 0.
  5. Batch effects: $\gamma_{ig}\sim\mathcal N(0,\tau^2)$ with $\tau\in\{0.25,0.5\}$; $\delta_{ig}=\exp(\eta_{ig})$ with $\eta_{ig}\sim\mathcal N(0,s^2)$ and $s\in\{0.1,0.3\}$.
  6. ComBat-form log values, with $z_j\in\{0,1\}$ the condition of cell $j$: $y_{gj}=b_g+c_{gk(j)}+\beta_g z_j+\gamma_{i(j)g}+\delta_{i(j)g}\varepsilon_{gj}$ with $\varepsilon_{gj}\sim\mathcal N(0,1)$.
  7. Misspecified counts: $K_{gj}\sim\mathrm{NB}(\mu_{gj},\phi=0.1)$ with $\mu_{gj}=N_j\exp(b_g+c_{gk(j)}+\beta_g z_j+\gamma_{i(j)g}+\nu_{i(j)k(j)g})$, where $\nu_{ikg}\sim\mathcal N(0,0.5^2)$ is a cell-type-specific batch term and library sizes $N_j$ are lognormal with log-sd 0.5. No ComBat-form model holds here.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated log values (items 1–6) | recipe above | simulated; — ; 10,000 cells by 2000 genes | not applicable | 8 settings (2 τ, 2 s, 2 designs), 5 seeds each |
| Simulated counts (item 7) | recipe above | simulated; — ; 10,000 cells by 2000 genes | not applicable | balanced design, 5 seeds; ComBat-seq input |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC of planted genes | ranking by absolute corrected-data t-statistic | maximise | primary | — |
| Average precision | same ranking, precision-recall | maximise | primary | — |
| Retention ratio | median over genes of condition R² on corrected values divided by R² on uncorrected values | maximise, target 0.9 or more (PROPOSED) | guardrail | — |
| iLISI on the generator batch | as in B1 | maximise | primary (batch) | [R1] |

- **Comparators**: uncorrected input; ComBat with `protect` set to the condition; ComBat with `protect` empty; ComBat-seq on the counts of item 7 only.
- **Protocol**: items 1–6 for the eight settings with five seeds each, in both designs; item 7 in the balanced design with five seeds. Genes: 2000.
- **Acceptance criterion** (PROPOSED): in the balanced design, the protected method keeps retention at 0.9 or more and loses at most 0.02 AUROC against the uncorrected input. The confounded design is reported as a limit, not as a pass or fail.
- **Known pitfalls**: items 1–6 favour ComBat by construction, so item 7 is the check; in the confounded design recovery is impossible by construction, so its failure is a property of the design.

### B3. Null calibration of DE on corrected matrices (proposed simulation)

- **Goal**: measure whether differential expression on a corrected matrix inflates false positives when no condition effect exists.
- **Ground truth**: planted null. Every $\beta_g=0$, so the true DE set is empty. Batch is the donor, and the condition label is permuted within donor, which makes it independent of donor and of biology. The estimand is the per-gene rejection rate at nominal $\alpha=0.05$; $\lambda_{\mathrm{GC}}$ is the median of the $\chi^2_1$ statistic divided by 0.456, which equals 1 under calibration.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated log values and counts with $\beta=0$ | recipe items 1–7 of B2 | simulated; — ; 20 donors of 400 cells (PROPOSED) | not applicable | 5 seeds; donor is the batch; cell types as in item 2 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| FPR at 0.05, donor-level test | two-sided t-test on per-donor, per-condition means of corrected values, n equal to the number of donors | minimise | primary | [R9] |
| FPR at 0.05, cell-level test | Welch t-test on cells of the corrected matrix | minimise | control | [R8] |
| $\lambda_{\mathrm{GC}}$ | median $\chi^2_1$ of the donor-level statistics divided by 0.456 | target 1 | guardrail | [R8] |

- **Comparators**: uncorrected matrix with the donor-level test; ComBat with `protect` set to the condition; ComBat with `protect` empty; ComBat-seq on the counts.
- **Protocol**: permute the condition within donor for each seed, and apply every comparator to the same permutations.
- **Acceptance criterion** (PROPOSED): the donor-level FPR is at most 0.07 and $\lambda_{\mathrm{GC}}$ lies in [0.9, 1.1] for the corrected-matrix method.
- **Known pitfalls**: the cell-level test is a control rather than a candidate, because pseudoreplication inflates it by design [R8, R9]; data generated under the ComBat form can only show failure through the counts of B2 item 7.

### P1. Performance and scaling

- **Scales**: 10^4, 10^5 and 10^6 cells with 2000 HVGs; a full-gene setting at 10^4 cells only; 5 and 50 batches (PROPOSED).
- **Comparators**: scanpy dense ComBat on CPU; inmoose `pycombat_seq` on CPU; the proposed CUDA linear ComBat and CUDA negative-binomial ComBat-seq.
- **Measures**: wall-clock time, peak host RAM, peak device memory and maximum relative difference from the scanpy output. Held fixed: the input normalisation, HVG set, CPU and GPU models, thread count and seed.
- **Acceptance criterion** (PROPOSED): CUDA linear ComBat is at least 10 times faster than scanpy at 10^6 cells and 2000 HVGs, with a maximum relative difference of at most $10^{-5}$.
- **Notes**: a dense float64 matrix of 10^6 by 2000 needs 16 GB, so scanpy at that size must be chunked. End-to-end streaming is claimed only for the proposed implementation.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `covariate-adjustment.covariate_variance_attribution`: Covariate variance attribution and confounding check before removal
  - `integration.batch_effect_diagnosis`: Batch-effect detection and quantification
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
- **Feeds**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `evaluation.overcorrection_detection`: Over-correction after batch or covariate removal
  - `integration.integration_quality_scoring`: Integration quality scoring
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
- **Reads**: `layers/counts`, `layers/log1p_norm`, `obs/<batch_key>`, `obs/<protect>`
- **Writes**: `layers/combat_corrected`, `layers/combat_seq_corrected`, `uns/batch_correction`, `models/batch_correction`
<!-- CHAINING:AUTO:END -->

Feeds the atlas-integration and pre-differential-expression batch-handling workflows.

## 10. Risks, pitfalls and open questions

- **limma removeBatchEffect** [R12]: the function's source has not been read, so it is excluded from the method table, the MCP enum and the benchmarks. Its OpenProblems wrapper (`limma_removebatcheffect`) fits an intercept-only design, so no biological term is protected. It is added once its code is read.
- **Integration-owned comparators**: Harmony [R13], fastMNN [R14] and scVI [R15] are owned by the integration task, together with scGen and LIGER. Their corrected-expression outputs enter B1 only after their code is read.
- **Literature not checked in full**: Tran et al. [R16] are cited for context only; their scenarios and DE evaluation are not used. The DE benchmark [R10] was checked against its published summary, so its figures and simulation design are unchecked.
- **Dataset identity**: the accession, licence, species and size of the B1 dataset are not confirmed, and the scIB collection's per-batch datasets are not enumerated.
- **Calibration evidence**: the 2021 preprint [R11] is cited by title alone, with no authors recorded. The ComBat-seq quantile-map target is taken from the inmoose implementation, not from the original paper.
- **First experiment**: apply B2 and B3 to the generator before B1, since they isolate protected-signal retention and the null, which the scIB suite cannot test.

## 11. References

R1. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R2. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R3. Johnson WE, Li C, Rabinovic A. Adjusting batch effects in microarray expression data using empirical Bayes methods. *Biostatistics* 2007;8(1):118. doi:10.1093/biostatistics/kxj037 — verified (corpus)
R4. Zhang Y, Parmigiani G, Johnson WE. ComBat-seq: batch effect adjustment for RNA-seq count data. *NAR Genomics and Bioinformatics* 2020;2(3):lqaa078. doi:10.1093/nargab/lqaa078 — verified (repo)
R5. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R6. Hie B, Bryson B, Berger B. Efficient integration of heterogeneous single-cell transcriptomes using Scanorama. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0113-3 — verified (corpus)
R7. Büttner M, Miao Z, Wolf FA, Teichmann SA, Theis FJ. A test metric for assessing single-cell RNA-seq batch correction. *Nature Methods* 2019. doi:10.1038/s41592-018-0254-1 — verified (corpus)
R8. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R9. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)
R10. Nguyen HCT, Baik B, Yoon S, Park T, Nam D. Benchmarking integration of single-cell differential expression. *Nature Communications* 2023. doi:10.1038/s41467-023-37126-3 — verified (search)
R11. PMD Uncovers Widespread Cell-State Erasure by scRNAseq Batch Correction Methods. *bioRxiv* 2021. doi:10.1101/2021.11.15.468733 — verified (corpus)
R12. Ritchie ME, Phipson B, Wu D, Hu Y, Law CW, Shi W, Smyth GK. limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 2015;43(7):e47. doi:10.1093/nar/gkv007 — verified (corpus)
R13. Korsunsky I, Millard N, Fan J, et al. Fast, sensitive and accurate integration of single-cell data with Harmony. *Nature Methods* 2019. doi:10.1038/s41592-019-0619-0 — verified (corpus)
R14. Haghverdi L, Lun ATL, Morgan MD, Marioni JC. Batch effects in single-cell RNA-sequencing data are corrected by matching mutual nearest neighbors. *Nature Biotechnology* 2018. doi:10.1038/nbt.4091 — verified (corpus)
R15. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R16. Tran HTN, Ang KS, Chevrier M, et al. A benchmark of batch-effect correction methods for single-cell RNA sequencing data. *Genome Biology* 2020. doi:10.1186/s13059-019-1850-9 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | Ilan Gold, Philipp Angerer, Severin Dicks (maintainers, pyproject.toml); scverse authors | BSD-3-Clause (LICENSE; pyproject.toml agrees) | ComBat reference implementation | port |
| https://github.com/epigenelabs/inmoose | Guillaume Appé, Maximilien Colange and others (pyproject.toml) | GPL-3.0 text in LICENSE; pyproject.toml declares GPL-3.0-or-later | ComBat-seq reference implementation | reimplement |
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and others (DESCRIPTION) | MIT (LICENSE, copyright Seurat authors) | comparator; anchor defaults | callout |
| https://github.com/brianhie/scanorama | Brian Hie (setup.py) | MIT (LICENSE) | comparator; corrected expression | callout |
| https://github.com/openproblems-bio/task_batch_integration | — | MIT (LICENSE) | method wrappers, metric definitions, HVG default, test dataset path | reimplement (metric definitions only) |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt; pyproject.toml agrees) | metric implementations used by the OpenProblems pipeline | callout |
| https://github.com/theislab/kBET | Maren Büttner (cre, aut; DESCRIPTION) | Apache-2.0 (LICENSE) | kBET test used by the batch metric | callout |
