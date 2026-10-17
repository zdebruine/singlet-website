---
id: integration.batch_effect_diagnosis
title: Batch-effect detection and quantification
area: integration
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [feature-selection.highly_variable_gene_selection, dim-reduction.normalized_cell_embedding]
feeds: [integration.batch_corrected_embedding, integration.unbalanced_batch_integration, covariate-adjustment.batch_covariate_removal_expression]
reads: [layers/log1p_norm, var/highly_variable, var/hvg_rank, obsm/X_pca, obs/<batch_key>, obs/<label_key>, obs/<covariates>]
writes: [uns/batch_diagnosis, obs/batch_lisi, obs/batch_kbet_rejected]
devices: [cpu, cuda]
mcp_tool: singlet_integration_batch_effect_diagnosis
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Batch-effect detection and quantification

> Measure how strongly batch labels structure an unintegrated embedding, and how large that structure is relative to cell type and other covariates, so that the decision to integrate rests on scores read with their scope.

## 1. Question

Given a PCA embedding of unintegrated log-normalised expression, with batch labels and covariates such as cell type, donor, technology and sex, how strong is batch structure, is it local (neighbourhood composition) or global (leading components or gene variance), and which covariates need correction or modelling before integration? The outputs are batch magnitudes with their scope, per-covariate variance fractions and a report-only summary. A correct answer tracks a planted batch effect and has a calibrated null (section 8).

## 2. Why this task matters and where the field stands

Batch can dominate neighbourhoods, clusters and differential expression before any integration is attempted, so a quantitative diagnosis is the first input to the choice of correction. Skipping correction when it is not needed matters as much: correction is not always required and can mask the biological variation of interest [R14].

The status is **contested**. Two families of scores answer whether batch structure is present. Neighbourhood tests (kBET [R2], batch silhouette and LISI [R1, R3]) measure local batch composition. Variance scores (principal component regression [R1], per-gene linear mixed models [R7]) measure global, mostly linear shares. They differ in scope, so one can pass while the other fails. The kBET README recommends pairing it with silhouette and PCA-based measures. No decision threshold for these scores appears in the cited literature or code. Benchmarks of correction methods [R4, R5] score integration outcomes rather than the diagnosis that precedes them.

Open problems: no ground truth for real batch effects exists; composition shifts, batch-specific populations and donor-batch nesting can look like batch and need labels that are not batch-derived [R6]; the cited literature contains no benchmark that tests batch scores against a known batch magnitude or that evaluates an integrate-or-not rule; and residual batch after integration is also unsettled, since correction can erase cell-state signal [R12] and common methods are often poorly calibrated [R13].

## 3. Theory and insight

Two questions must be kept apart. The first is whether batch labels are structured in the representation; the second is whether that structure is a technical nuisance that correction should remove. Scores answer the first. The second needs biological labels or designs that are not themselves batch-confounded, so every diagnosis is read with its scope and covariates.

**Neighbourhood scores.** For cell $i$, let $O_{ib}$ be the number of its $k$ nearest neighbours from batch $b$, and $E_{ib}=k\,n_b/N$ its expectation under the global proportions. The statistic

$$\chi^2_i=\sum_{b=1}^{B}\frac{(O_{ib}-E_{ib})^2}{E_{ib}}$$

is referred to a $\chi^2$ distribution with $B-1$ degrees of freedom. kBET tests $T=\lceil 0.1N\rceil$ sampled cells (at least 25 when $N>25$) in $R=100$ repeats, and the rejection rate is

$$r=\frac{1}{RT}\sum_{\rho=1}^{R}\sum_{t=1}^{T}\mathbf 1\{p_{\rho t}<\alpha\},\qquad \alpha=0.05,$$

with scaled score $1-r$. The $\chi^2$ approximation needs expected counts that are not small; kBET also contains an exact multinomial test. Tests on overlapping neighbourhoods are correlated, so $RT$ tests are not independent trials.

**Silhouette and LISI.** For cell $i$, $s(i)=\dfrac{b(i)-a(i)}{\max\{a(i),b(i)\}}$, where $a(i)$ is the mean distance to cells of its own batch and $b(i)$ the mean distance to the nearest other batch, computed within each cell-type label. The LISI of cell $i$ is $1/\lambda_i$ with $\lambda_i=\sum_b\hat p_{ib}^2$ the Simpson index of perplexity-weighted batch fractions $\hat p_{ib}$, the effective number of batches it sees.

**Variance scores.** Let $\lambda_i$ be the variance of the $i$-th of $G$ leading PCs and $R^2_i$ the clipped $R^2$ of a regression of PC$_i$ on batch indicators. The batch share is

$$f_{\mathrm{PCR}}=\sum_{i=1}^{G}\frac{\lambda_i}{\sum_{j=1}^{G}\lambda_j}\,R^2_i .$$

The scIB score compares this share before and after integration, $s_{\mathrm{PCR}}=\max\{0,(f^{\mathrm{pre}}-f^{\mathrm{post}})/f^{\mathrm{pre}}\}$, so one representation yields $f_{\mathrm{PCR}}$ but no PCR score. Without association, $\mathbb E[R^2]\approx(B-1)/(N-1)$ for each PC. The per-gene model is

$$y_{g}=X\beta_g+\sum_{k=1}^{K}Z_k u_{kg}+\varepsilon_g,\qquad u_{kg}\sim\mathcal N(0,\sigma^2_{kg}I),\quad \varepsilon_g\sim\mathcal N(0,\sigma^2_{\varepsilon g}I),$$

with variance fraction $\varphi_{kg}=\sigma^2_{kg}/\bigl(\sum_{k'}\sigma^2_{k'g}+\sigma^2_{\varepsilon g}\bigr)$ [R7]. It is a Gaussian approximation on the log-normalised scale; each random effect needs several levels to be identified.

**Estimands and normalisation.**
- $1-r$: the fraction of tested neighbourhoods, pooled over repeats, whose batch composition matches the global proportions at level $\alpha$; under a calibrated test and perfect mixing it sits near $1-\alpha$, not at 1.
- Batch magnitude from silhouette: the mean of $\lvert s(i)\rvert$ over cells, averaged over labels; values near zero indicate mixing.
- Batch magnitude from LISI: one minus the median over cells of $(\mathrm{LISI}_i-1)/(B-1)$; 0 is full mixing and 1 is a single batch per neighbourhood.
- $f_{\mathrm{PCR}}$: the batch share of variance of the first $G$ PCs, normalised by their variance and not by the variance of the full matrix.
- $\varphi_{kg}$: the share of gene $g$'s variance attributed to covariate $k$ conditional on the others, summing to one within a gene; reported as the median over variable genes.
- Planted batch strength $\sigma_\beta$ (Splatter batch.facScale): the standard deviation of the natural-log per-gene batch multiplier; $\sigma_\beta=0$ means no batch effect.
- Null pseudo-batch label: drawn uniformly at random within cell-type strata, so the true batch magnitude is zero by construction.

**Regime of validity.** kBET and LISI are local and count-based, so they respond to neighbourhood composition, $k$ and cell number; population structure present in one batch is flagged even when it is biological. The variance scores are linear and global, dominated by leading PCs. Power grows with $N$: at atlas scale a trivial effect can reject every test, so effect sizes with spread are reported, not only pass or fail.

**What a model adds.** The heuristic scores are functions of one fixed embedding and one neighbourhood size; kBET's only uncertainty is the spread over repeats. A probabilistic formulation gives a sampling distribution for each variance fraction and a contrast between models with and without batch, at the cost of distributional assumptions that must be calibrated (section 5).

**Pitfalls seen in the literature.** Batch-label circularity: cell-type labels from batch-affected clustering absorb or inflate batch signal. Ties: identical points, for example a one-hot cell-type embedding, make neighbourhoods and silhouettes ill-defined. Direction: OpenProblems batch metrics are maximised, so a magnitude is $1$ minus the score.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| kBET | heuristic | chi-square tests of neighbourhood batch counts against global proportions; rejection rate over sampled cells | [R2] |
| Batch ASW (scIB) | heuristic | absolute silhouette of batch labels within each cell-type label | [R1] |
| PCR score | heuristic | variance-weighted R² of batch over leading PCs, before and after integration | [R1] |
| LISI | heuristic | inverse Simpson index of batch labels over perplexity-weighted neighbours | [R3] |
| Per-gene LMM (variancePartition form) | model-based | per-gene linear mixed model; variance fraction per covariate | [R7] |
| Batch-coloured PCA or UMAP | heuristic | visual check before and after conditioning on cell type | [R14] |
| scVI batch covariate | model-based | conditional VAE with count likelihood and batch covariate; an integration model, proposed here as a diagnostic | [R8, R9] |

The published standard is the scIB and OpenProblems metric set (kBET, batch ASW, PCR and iLISI) [R1, R2]. All four are heuristic and none has a published decision threshold. The per-gene model is an established descriptive tool [R7]. Singlet's heuristic scores follow the definitions of the reference code above, and the model-based forms are proposed in section 5.

Exact defaults for the methods singlet implements:

| Method | Parameter | Value | Source (file:line, corpus copy) |
|---|---|---|---|
| kBET (R) | do.pca; dim.pca | TRUE; 50 | theislab_kBET/R/kBET.R:70 |
| kBET (R) | heuristic; n_repeat; alpha | TRUE; 100; 0.05 | kBET.R:71-72 |
| kBET (R) | k0 when heuristic | floor(mean batch count × N × 0.75); stop below 10 | kBET.R:135-141 |
| kBET (R) | test size | ceiling(0.1 N), at least 25 when N > 25 | kBET.R:205-206 |
| kBET (scIB) | graph neighbours | 50 | theislab_scib/scib/metrics/kbet.py:79 |
| kBET (scIB) | labels tested | at least 10 cells and more than one batch | kbet.py:101 |
| kBET (scIB) | per-label k0 | min(70, max(10, floor(mean batch count / 4))) | kbet.py:110-114 |
| kBET (scIB) | neighbour test; score | heuristic FALSE; 1 minus mean rejection | kbet.py:189, 231 |
| Batch ASW (scIB) | distance; scale | Euclidean; 1 minus absolute silhouette per cell | silhouette.py:143-147 |
| Batch ASW (scIB) | skipped labels | one batch, or one cell per batch | silhouette.py:135-136 |
| PCR (scIB) | n_comps; scale | 50; score clipped at 0 when variance rises | pcr.py:14, 17 |
| PCR (scIB) | R² and weights | clipped at 0; weights pca_var / sum(pca_var) | pcr.py:292-294 |
| LISI (scIB) | k0 (iLISI) | 90 | lisi.py:45 |
| LISI (scIB) | perplexity when unset | floor(n_neighbors / 3) | lisi.py:244-246 |
| LISI (scIB) | scaling | (median - 1) / (batches - 1) | lisi.py:108-112 |
| scVI | n_hidden; n_latent; n_layers; dropout | 128; 10; 1; 0.1 | scverse_scvi-tools/src/scvi/model/_scvi.py:118-121 |
| scVI | gene_likelihood; covariate use | zinb; covariates not encoded but deeply injected | _scvi.py:123; scvi/module/_vae.py:162-163 |

## 5. Proposed singlet approach

- **Routes.** Port: the kBET test, the scIB batch ASW and PCR functions and the scIB per-label rule, each checked against its reference on B4. Reimplement: LISI and the per-gene linear mixed model. Callout: the R packages and the Splatter simulator, as comparators and as the generator for B1 to B3.
- **Model-based formulation (proposed, not in this release).** (i) A hierarchical Gaussian model of PC scores, $y_{ig}=\mu_{t(i)}+u_{b(i)}+\varepsilon_{ig}$, with empirical Bayes priors on the variance components; its posterior for the batch variance fraction gives credible intervals. (ii) A Dirichlet-multinomial posterior of local batch proportions against global proportions, replacing the fixed-$\alpha$ $\chi^2$ test, with a correction for neighbourhood overlap. (iii) A likelihood-ratio contrast of a count VAE with and without the batch covariate, using held-out ELBO differences. Library size is modelled on counts, since count models separate measurement from expression [R10]. Item (iii) is the scVI design [R8, R9] with batch as a decoder covariate.
- **What would falsify it.** A model-based score becomes a default only if on B1 its magnitude has Spearman $\rho\ge0.8$ with $\sigma_\beta$, its null false-positive rate is at most 0.10 at $\alpha=0.05$ (B2), and it does not flag the composition-only arm (B3). Otherwise it stays a comparator.
- **ML stack and kernels.** PyTorch for the count VAE only. Hard-coded CUDA with cuSPARSE for the batched per-gene variance fits, the kBET and iLISI neighbourhood count kernels, and blocked pairwise silhouette distances. CPU uses BLAS and thread-parallel neighbour search. Streaming is not part of this release: PCR and kBET need the full PC matrix, and the per-gene fits need gene blocks in memory.
- **Reporting.** Every score is reported as a batch magnitude, higher meaning more batch: the kBET magnitude is the rejection rate $r$ (the complement of the scIB score), and the others are $1-\mathrm{LISI}_{\mathrm{scaled}}$, mean $\lvert s\rvert$, $f_{\mathrm{PCR}}$ and $\varphi_{kg}$. No threshold is applied.
- **Defaults without asking.** Batch key batch, label key cell_type, covariates cell_type, donor, technology and sex, $n_{\mathrm{pcs}}=50$, kBET graph size 50 with the scIB per-label $k_0$, $\alpha=0.05$ with 100 repeats, iLISI $k_0=90$, variance model gaussian_lmm on 2,000 genes, seed 0, device auto.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/X_pca | float32, N by at least n_pcs | leading principal components, the representation scored |
| read | layers/log1p_norm | sparse float | log-normalised expression for the per-gene variance model |
| read | var/highly_variable, var/hvg_rank | bool, int | gene subset and its rank for the variance fractions |
| read | obs/<batch_key> | categorical | batch label, at least two levels |
| read | obs/<label_key>, obs/<covariates> | categorical | cell-type label and covariates |
| write | uns/batch_diagnosis | record | every magnitude, variance fractions per covariate, per-PC R², settings and seed |
| write | obs/batch_lisi | float32 | per-cell scaled iLISI |
| write | obs/batch_kbet_rejected | bool | true when most of a cell's tests were rejected; false otherwise, including untested cells |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `batch_key` | string | "batch" | — | obs column with the batch label; at least two levels and no missing values. |
| `label_key` | string/null | "cell_type" | — | obs column of cell-type labels for per-label scores and conditioning; null scores globally. |
| `covariates` | array | ["cell_type", "donor", "technology", "sex"] | — | obs columns whose variance fraction is estimated; missing columns are dropped with a warning. |
| `n_pcs` | integer | 50 | min 1 | Leading PCs of obsm/X_pca scored, and the number of components in the PCR regression. |
| `kbet` | object | — | — | Options for the kBET neighbourhood test. |
| `kbet.graph_k` | integer | 50 | min 5 | Neighbours in the kNN graph built on obsm/X_pca for the kBET test. |
| `kbet.k0` | integer/null | null | min 10 | Neighbourhood size per test; null applies the scIB per-label rule (quarter of mean batch size, clamped to 10-70). |
| `kbet.alpha` | number | 0.05 | max 1; > 0 | Significance level of each neighbourhood test. |
| `kbet.n_repeat` | integer | 100 | min 1 | Repeated random test subsets used for the rejection rate. |
| `lisi` | object | — | — | Options for the local inverse Simpson index. |
| `lisi.k0` | integer | 90 | min 3 | Neighbours for iLISI; perplexity is set to one third of k0. |
| `variance` | object | — | — | Options for the variance fractions per covariate. |
| `variance.model` | string | "gaussian_lmm" | `gaussian_lmm` | Variance model: per-gene random effects on log-normalised expression; the only model in this release. |
| `variance.n_genes` | integer | 2000 | min 1 | Highly variable genes (var/hvg_rank order) used by the per-gene variance model. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Random seed for kBET test subsets and LMM initialisation; recorded in uns/batch_diagnosis. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running or writing. |
| `overwrite` | boolean | false | — | Replace existing uns/batch_diagnosis and per-cell flags instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters: the scores are computed on obsm/X_pca with its first n_pcs components, so another representation is scored only after its PCA is written. kbet.* applies to the kBET test, lisi.k0 to iLISI, and variance.* to the variance fractions. A batch label with fewer than two levels is an error and writes nothing. Missing covariates are dropped with a warning in summary.warnings. An existing uns/batch_diagnosis requires overwrite. No decision threshold exists in this release.

## 7. MCP tool

Tool name `singlet_integration_batch_effect_diagnosis` (definition in `tasks/mcp/singlet_integration_batch_effect_diagnosis.json`). Example call and result; the values in the result are placeholders, not measurements.

```json
{"dataset": "/data/atlas.singlet", "batch_key": "study", "label_key": "cell_type", "covariates": ["cell_type", "donor", "technology"], "n_pcs": 30}
```

```json
{"dataset": "/data/atlas.singlet", "status": "completed",
 "wrote": ["uns/batch_diagnosis", "obs/batch_lisi", "obs/batch_kbet_rejected"],
 "summary": {"kbet_rejection_rate": "<0-1>", "batch_asw_magnitude": "<0-1>", "ilisi_magnitude": "<0-1>", "f_pcr_pre": "<0-1>", "variance_fraction_median": {"cell_type": "<0-1>", "donor": "<0-1>", "technology": "<0-1>"}, "n_cells": "<int>", "n_batches": "<int>", "device": "cpu", "seed": 0, "warnings": []},
 "provenance_id": "<id>"}
```

Long-running: yes for large N, where kBET repeats dominate; the job returns queued with a job_id. Stochastic: yes; kBET subsets use seed, which is recorded in uns/batch_diagnosis. Dry run: estimate gives seconds, peak_memory_gb and device, and nothing is written.

## 8. Benchmarks

Shared protocol. Every benchmark uses the first 50 PCs of log(1 + counts per 10,000) on 2,000 highly variable genes, kBET graph size 50 with the scIB per-label rule, $\alpha=0.05$ and $R=100$ repeats. Parameters are fixed before scores are inspected and never tuned on benchmark labels. Simulations use seeds 0 to 9 and report the mean and range. Diagnostics read unintegrated data only. Metric code is the scIB and kBET code in section 12. Hardware and thread count are recorded.

### B1. Planted batch-effect dose-response and detection (proposed)

- **Goal**: check that each magnitude rises with planted batch strength, separates presence from absence, and does not declare the null.
- **Ground truth**: planted $\sigma_\beta$ on the natural-log scale, with presence $\sigma_\beta>0$. Each diagnostic is compared through its magnitude: $r$ for kBET, mean $\lvert s\rvert$, $1-\mathrm{LISI}_{\mathrm{scaled}}$, $f_{\mathrm{PCR}}$ and the median batch variance fraction.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter simulation with planted batch effects | generator [R11]; code in section 12 | simulated counts; not applicable; 2 or 4 batches of 500 cells, 200 datasets | see section 12 | grid below |

  Grid: $\sigma_\beta\in\{0,0.05,0.1,0.2,0.4\}$, batch location $\in\{0,0.1\}$, $B\in\{2,4\}$, 10 seeds. The 500 cells per batch is a design choice (Splatter default: 100).
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Dose-response rho | Spearman correlation over the grid between each magnitude and $\sigma_\beta$, averaged over seeds | higher | primary | — |
| Presence AUROC | separation of $\sigma_\beta>0$ from $\sigma_\beta=0$ at $\sigma_\beta=0.4$ | higher | primary | — |
| Null false-positive rate | fraction of $\sigma_\beta=0$ datasets declared batch-affected by the kBET rule and the posterior rule | lower | guardrail | [R2] |

- **Comparators**: kBET, batch ASW, $f_{\mathrm{PCR}}$, iLISI and the per-gene model.
- **Protocol**: as shared. The kBET rule tests pooled rejections over the $R$ repeats against $\alpha$ with a one-sided binomial test; the null false-positive rate checks the error from correlated tests. The posterior rule declares a batch effect when the lower 95 percent bound of the batch variance fraction exceeds zero. Scores without a rule are compared by rank.
- **Acceptance criterion** (proposed): rho at least 0.8 for the kBET-derived and $f_{\mathrm{PCR}}$ magnitudes; AUROC at least 0.9 at $\sigma_\beta=0.4$; null false-positive rate at most 0.10 for both rules.
- **Known pitfalls**: the generator is gene-wise multiplicative, which matches the linear assumption of PCR and the per-gene model; real donor and technology effects can be nonlinear, so passing is necessary, not sufficient. The simulator and the metrics share the log-normalised representation.

### B2. Null calibration by random pseudo-batch split (proposed)

- **Goal**: check that magnitudes and tests take their expected null values when the data contain no batch effect.
- **Ground truth**: no batch by construction. Pseudo-batches ($B\in\{2,4\}$) are drawn uniformly at random within cell-type strata, 20 splits per dataset; the expected kBET rejection rate is $\alpha$ and the expected $f_{\mathrm{PCR}}$ is $(B-1)/(N-1)$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue studies with one donor and one sequencing run | singlet catalogue, selected by obs/donor and a run identifier | scRNA-seq; as recorded; as recorded | see section 10 | the number that qualify is set at selection |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| kBET rejection rate | mean $r$ across splits | near $\alpha=0.05$ | primary | [R2] |
| PCR share | mean $f_{\mathrm{PCR}}$ across splits | at most $2(B-1)/(N-1)$ | primary | [R1] |
| Batch ASW and iLISI magnitudes | as in B1 on pseudo-batch labels | near mixed value | guardrail | [R1, R3] |

- **Comparators**: the diagnostics of B1.
- **Protocol**: as shared; $B$ varies; the distribution of each score across the 20 splits is reported per dataset.
- **Acceptance criterion** (proposed): mean $r$ between 0.025 and 0.075 across splits; mean $f_{\mathrm{PCR}}$ at most twice its expected null value.
- **Known pitfalls**: donor or run structure inside a nominally single dataset breaks the null, so the donor and run checks are part of dataset selection. Random splits match composition exactly, so this benchmark cannot detect composition effects (B3).

### B3. Composition versus batch identifiability (proposed)

- **Goal**: check that unconditional scores flag a batch-specific composition shift, while scores conditioned on the true cell-type label do not.
- **Ground truth**: planted cell-type labels $t(c)$ with batch-specific proportions $p_{t\mid b}$. The composition difference $\Delta=\tfrac12\sum_t\lvert p_{t\mid 1}-p_{t\mid 2}\rvert\in[0,1]$ is the total-variation distance between batch compositions. In the composition-only arm $\sigma_\beta=0$, so the true batch magnitude is zero within each label.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter with batch-specific group proportions | generator [R11]; each batch simulated from one shared parameter set with its own proportions, then combined | simulated scRNA-seq counts; not applicable; 2 batches of 500 cells | see section 12 | $\Delta\in\{0,0.2,0.4\}$, 10 seeds |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Conditional magnitude | each magnitude computed within planted labels, compared with the B2 null interval | inside the interval | primary | [R1] |
| Unconditional sensitivity | Spearman correlation between the unconditional kBET magnitude and $\Delta$ | higher | guardrail | [R2] |

- **Comparators**: kBET, iLISI, batch ASW, $f_{\mathrm{PCR}}$, and the per-gene model with the cell-type term included.
- **Protocol**: as shared. A second arm conditions on labels from clustering the same embedding, which measures leakage from clustering into the conditional score.
- **Acceptance criterion** (proposed): at least 90 percent of composition-only datasets have conditional magnitudes inside the B2 null interval; the unconditional kBET magnitude rises with $\Delta$ with rho at least 0.8, which is the expected failure mode.
- **Known pitfalls**: labels from clustering the same embedding absorb composition shifts and bias the conditional score, so the clustering arm is the realistic one. Conditioning on labels that are themselves batch-driven removes genuine batch signal.

### B4. Control-representation consistency

- **Goal**: check that the diagnostics are finite and behave as expected on the batch-integration control representations, and that a degenerate representation is flagged rather than scored.
- **Ground truth**: constructed by the task. no_integration uses log-normalised features; no_integration_batch computes PCA separately within each batch; shuffle_integration_by_batch permutes features within each batch; embed_cell_types is a one-hot cell-type embedding with identical points within each type. Only the last is degenerate by construction. The expected ordering is an ordering check, not a null, because shuffling also removes cell-type structure.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_immune_cell_atlas, the batch-integration test resource | OpenProblems task repository, resources_test path; code in section 12 | scRNA-seq, immune cells; — ; — | see section 10 | used as given |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Finite magnitudes | every diagnostic returns a finite value on every control | all finite | primary | — |
| Tie fraction | fraction of cells whose nearest neighbour is at zero distance in the representation | high flags ties | primary | — |
| Magnitude ordering | kBET-derived magnitude on no_integration minus the same on shuffle_integration_by_batch | positive | guardrail | [R2] |

- **Comparators**: the four controls, with no_integration as baseline.
- **Protocol**: as shared. Feature-space controls are passed through PCA with 50 components; embedding controls are scored in their own dimension.
- **Acceptance criterion** (proposed): all magnitudes finite; the one-hot control has a tie fraction above 0.5 and is reported as degenerate instead of a magnitude; the ordering is positive.
- **Known pitfalls**: shuffling removes cell-type structure as well as batch structure, so it is not a clean null. The OpenProblems kBET wrapper returns one minus the mean rejection, so the ordering must be read on the same scale.

### P1. Performance and scaling

Wall time, peak memory and throughput in cells per second on CPU and CUDA at $10^4$, $10^5$ and $10^6$ cells, with kBET repeat count, graph size and PC count held fixed, and the slope of log time against log N. Comparators: the scIB batch ASW, PCR and iLISI functions, the kBET R package and the per-gene model. Acceptance (proposed): the port of the kBET test and the batch ASW is no slower than the reference at $10^5$ cells at the same thread count, and the CUDA path is at least 3 times faster than CPU at $10^6$ cells. Exact silhouette is subsampled at $10^6$ cells, and exact and subsampled values are reported separately. No $10^7$ scale is claimed.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
- **Feeds**:
  - `integration.batch_corrected_embedding`: Batch-corrected joint embedding
  - `integration.unbalanced_batch_integration`: Integration of unbalanced and nested batches
  - `covariate-adjustment.batch_covariate_removal_expression`: Known batch or donor covariate removal on expression
- **Reads**: `layers/log1p_norm`, `var/highly_variable`, `var/hvg_rank`, `obsm/X_pca`, `obs/<batch_key>`, `obs/<label_key>`, `obs/<covariates>`
- **Writes**: `uns/batch_diagnosis`, `obs/batch_lisi`, `obs/batch_kbet_rejected`
<!-- CHAINING:AUTO:END -->

Recipe: integration diagnosis follows highly variable gene selection and PCA, and informs the choice of corrected embedding; it is report-only and writes no corrected data.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** PVCA is left out of the tables, the MCP enum and the benchmarks because its primary paper was read only as an abstract. The per-gene model [R7] and its defaults were not read from source, so section 3 states the standard Gaussian mixed-model form. The authors of the calibration preprint [R13] are not listed in the sources used, the authors of the PMD preprint [R12] are those of version 1, and the upstream URL of the Splatter code was not read.
- **Conflicting source rules.** The OpenProblems kBET description gives a per-label k equal to the median batch size clamped to 10 to 100, while the scIB code it calls uses a quarter of the mean batch size clamped to 10 to 70 on a 50-neighbour graph (kbet.py:79, 110-114). This document follows the code. The scIB code also assigns a score of one when too many cells lie in small connected components (kbet.py:147-177).
- **Unsettled literature.** No decision threshold for kBET acceptance, PCR, batch ASW or iLISI is published in the cited literature or code. The combined rule across scores is untested, the over- versus under-correction balance has no agreed metric, and the calibration and cell-state erasure results [R12, R13] are preprints.
- **Data and licence risks.** B2 depends on donor and run metadata that the catalogue may not hold for every study, and the number of qualifying studies is not yet known. Licence terms of the catalogue studies have not been audited. OpenProblems datasets beyond cxg_immune_cell_atlas, and their sizes and licences, are not in the local sources. The integrate-or-not outcome benchmark is therefore folded in here: it needs multi-batch datasets with cell-type labels, outcome labels from metrics disjoint from the diagnostic, and thresholds of 0.05 and 0.02 that are design choices.
- **Numerical risks.** kBET tests overlap, so the pooled rule can be anti-conservative; B2 is its check. CUDA and CPU kernels differ in floating point, so results are reported per device. Ties in the embedding change neighbour sets, and kBET and iLISI depend on $k$ and on the graph built on the output.
- **First experiment.** Run B2 and B1 on the singlet ports and on the scIB reference implementations with the same inputs, and check the kBET-derived null false-positive rate before any decision rule is exposed; then add the B4 controls on cxg_immune_cell_atlas.

## 11. References

R1. Luecken MD, Büttner M, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — partial (corpus)

R2. Büttner M, Miao Z, Wolf FA, Teichmann SA, Theis FJ. A test metric for assessing single-cell RNA-seq batch correction. *Nature Methods* 2019;16:43–49. doi:10.1038/s41592-018-0254-1 — partial (corpus)

R3. Korsunsky I, Millard N, Fan J, et al. Fast, sensitive and accurate integration of single-cell data with Harmony. *Nature Methods* 2019. doi:10.1038/s41592-019-0619-0 — partial (corpus)

R4. Tran HTN, Ang KS, Chevrier M, et al. A benchmark of batch-effect correction methods for single-cell RNA sequencing data. *Genome Biology* 2020. doi:10.1186/s13059-019-1850-9 — partial (corpus)

R5. Chazarra-Gil R, van Dongen S, Kiselev VY, Hemberg M. Flexible comparison of batch correction methods for single-cell RNA-seq using BatchBench. *Nucleic Acids Research* 2021. doi:10.1093/nar/gkab004 — partial (corpus)

R6. Argelaguet R, Cuomo ASE, Stegle O, Marioni JC. Computational principles and challenges in single-cell data integration. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00895-7 — partial (corpus)

R7. Hoffman GE, Schadt EE. variancePartition: interpreting drivers of variation in complex gene expression studies. *BMC Bioinformatics* 2016;17:483. doi:10.1186/s12859-016-1323-z — partial (search)

R8. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — partial (corpus)

R9. Gayoso A, Lopez R, Xing G, et al. A Python library for probabilistic analysis of single-cell omics data. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01206-w — partial (corpus)

R10. Sarkar A, Stephens M. Separating measurement and expression models clarifies confusion in single-cell RNA sequencing analysis. *Nature Genetics* 2021. doi:10.1038/s41588-021-00873-4 — partial (corpus)

R11. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — partial (corpus)

R12. Tyler SR, Bunyavanich S, Schadt EE. PMD uncovers widespread cell-state erasure by scRNAseq batch correction methods. *bioRxiv* 2021 (version 1). doi:10.1101/2021.11.15.468733 — partial (corpus)

R13. Batch correction methods used in single-cell RNA sequencing analyses are often poorly calibrated. *bioRxiv* 2024. doi:10.1101/2024.03.19.585562 — partial (search)

R14. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/kBET (HEAD afc5f43 at check) | Maren Büttner (cre, aut; DESCRIPTION) | Apache-2.0 (LICENSE; DESCRIPTION) | kBET test; B1 comparator and B2 null | port |
| https://github.com/theislab/scib (HEAD cd67913 at check) | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt; pyproject.toml) | batch ASW, PCR, iLISI and the per-label kBET rule | port |
| https://github.com/immunogenomics/LISI (HEAD a917556 at check) | Ilya Korsunsky (DESCRIPTION) | GPL-3 (DESCRIPTION; LICENSE file) | LISI definition | reimplement |
| https://github.com/GabrielHoffman/variancePartition (HEAD 63e9f05 at check) | Gabriel E. Hoffman (DESCRIPTION) | GPL-2 (DESCRIPTION; no LICENSE file at the repository root) | per-gene model; comparator | reimplement |
| https://github.com/scverse/scvi-tools (HEAD 5555ecc at check) | Yosef Lab, Weizmann Institute of Science (LICENSE) | BSD-3-Clause (LICENSE; pyproject.toml) | scVI defaults; count model proposal | port (design to PyTorch, with attribution) |
| Splatter (Bioconductor; corpus copy, version 1.37.1) | — (paper authors in R11) | GPL-3 + file LICENSE (DESCRIPTION) | benchmark generator, B1 to B3 | callout |
| https://github.com/openproblems-bio/task_batch_integration | Open Problems in Single-Cell Analysis (LICENSE) | MIT (LICENSE) | control definitions, metric configurations, test resource (B4) | callout |
