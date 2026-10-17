---
id: imputation.expression_denoising
title: Expression denoising, posterior expression estimation and dropout imputation of UMI counts
area: imputation
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [qc.low_quality_cell_detection, normalization.size_factor_estimation, normalization.count_noise_model_selection]
feeds: [imputation.heldout_denoiser_scoring, imputation.de_after_imputation, imputation.cluster_recovery_after_imputation, imputation.trajectory_after_imputation]
reads: [layers/counts, obs/size_factor, obs/batch, obsm/X_pca]
writes: [layers/denoised, layers/denoised_sd, obs/size_factor, uns/denoising_params, models/<name>]
devices: [cpu, cuda]
mcp_tool: singlet_imputation_expression_denoising
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Expression denoising, posterior expression estimation and dropout imputation of UMI counts

> Estimates the expected expression of each cell and gene from a UMI count matrix, returns a non-negative matrix at the input depth, and scores it on held-out molecules and references rather than on observed zeros.

## 1. Question

Can the expected expression of each cell-gene pair, the rate $\lambda_{gc}$ behind an observed UMI count, be recovered more accurately than from normalised counts, with optional posterior spread, and without erasing biological zeros? Inputs are the raw UMI matrix, optional size factors, batch labels and a PCA embedding. The output is a non-negative matrix of the same shape at the input depth. A correct answer predicts held-out molecules and down-sampled or mixture references better than the normalised input, and reports its zero handling instead of assuming it.

## 2. Why this task matters and where the field stands

Every UMI matrix is a noisy sample of expression. Clustering, differential expression and trajectory inference read the same values, so bias or over-smoothing at this step changes their answers. Whether zeros beyond sampling noise carry information is contested. Svensson argues that droplet UMI data are not zero-inflated [R1]. Sarkar and Stephens argue that the measurement model, which describes how molecules are sampled, should be separated from the expression model, which describes what a cell expresses [R2].

Three estimator families compete. Diffusion and neighbourhood smoothers, MAGIC [R3] and kNN smoothing [R4], trade bias for variance. ALRA [R5, R6] replaces the matrix by a thresholded rank-$k$ reconstruction. Model-based estimators, SAVER [R7], Sanity [R8] and scVI [R9], return expected rates from explicit likelihoods, and the DCA autoencoder [R10] learns rates by maximum likelihood.

Status: **contested**. Open problems:

- No per-entry ground truth exists. Held-out molecule accuracy is available under molecule independence [R11], but it measures agreement with sampling, not biological accuracy.
- The zero model is unresolved, so any dropout term needs a benchmark with and without it.
- Posterior spread needs a held-out check, which B1 provides for posterior methods.
- The right estimator depends on the next step, so each output must be scored on the quantity that step reads.

## 3. Theory and insight

### 3.1 Sampling model

Counts are molecule samples. For gene $g$ and cell $c$ the observed count is Poisson given the expected count $\lambda_{gc}=s_c\,\rho_{gc}$, where $s_c$ is the size factor and $\rho_{gc}$ is a proportion with $\sum_g\rho_{gc}=1$:

$$y_{gc}\mid\lambda_{gc}\sim\mathrm{Poisson}(\lambda_{gc}).$$

Regime: first order; capture is constant within a cell; PCR duplicates and UMI collisions are absent. Gene-level overdispersion gives

$$y_{gc}\sim\mathrm{NB}(\lambda_{gc},\theta_g),\qquad \operatorname{Var}(y_{gc})=\lambda_{gc}+\lambda_{gc}^2/\theta_g,$$

which tends to the Poisson as $\theta_g\to\infty$. When $\lambda_{gc}$ is of order 1 or below, zero counts are common under either law, so zeros alone do not identify dropout. A dropout component adds

$$p(y_{gc})=\pi_{gc}\,\mathbf 1[y_{gc}=0]+(1-\pi_{gc})\,\mathrm{NB}(y_{gc}\mid\lambda_{gc},\theta_g),$$

and $\pi_{gc}$ is weakly identified against $\theta_g$ when the NB component already explains the zeros.

| Symbol | Meaning |
|---|---|
| $y_{gc}$ | observed UMI count (layer `counts`) |
| $s_c$ | size factor |
| $\lambda_{gc}$ | expected count at the input depth (the estimand) |
| $\rho_{gc}$ | expression proportion within cell $c$ |
| $t_{gc}$ | held-out test count in the molecular cross-validation split (not time) |
| $x_{gc}$ | log expression rate per unit size factor |

### 3.2 Estimands and normalisation

- `layers/denoised` at `expected_counts` estimates $\lambda_{gc}$ at the depth of the input, so a thinned input returns values at the thinned depth.
- At `cp10k` it estimates $10^4\,\lambda_{gc}/\sum_{g'}\lambda_{g'c}$, a per-cell proportion scale from which depth is removed.
- `layers/denoised_sd` is the posterior standard deviation of $\lambda_{gc}$ on the scale of `layers/denoised`.
- The molecular cross-validation target is the held-out count $t_{gc}$, with $\mathbb E[t_{gc}\mid\lambda]=0.1\,\lambda_{gc}$ for a 90/10 split; per-cell CP10k normalisation removes the factor 0.1.
- The down-sampling target is the full-depth count of the same entries, normalised per cell to CP10k and log1p transformed.
- The mixture target is the proportion-weighted average of pure-line CP10k profiles for each library, log1p transformed.

### 3.3 Estimators

Singlet's default is a Poisson posterior with a log-normal gene prior:

$$y_{gc}\sim\mathrm{Poisson}(s_c\,e^{x_{gc}}),\qquad x_{gc}\sim\mathcal N(\mu_g,v_g),\qquad \hat\lambda_{gc}=s_c\,\mathbb E\!\left[e^{x_{gc}}\mid y_{gc}\right].$$

Regime: the posterior mean is exact given $(\mu_g,v_g)$; estimating these per gene makes the estimate approximate, and prior error dominates when cells are few.

Diffusion smoothing (MAGIC) applies $\hat X=P^{t}X$ with $P=D^{-1}K$ and $K_{ij}=\exp\!\big(-(d_{ij}/\varepsilon_i)^{\alpha}\big)\,\mathbf 1[j\in\mathcal N_k(i)]$, where $\varepsilon_i$ is an adaptive bandwidth. Regime: $t$ is the bias–variance control; large $t$ moves each profile toward a component-wide average, which erases small populations.

ALRA takes a rank-$k$ reconstruction and keeps the entries that exceed the magnitude of the $0.001$ quantile of their gene, then rescales each gene to the input's nonzero mean and standard deviation. The thresholding step is:

$$\hat X_k=U_k\Sigma_kV_k^{\top},\qquad \tilde X_{gc}=\hat X_{k,gc}\,\mathbf 1\!\left[\hat X_{k,gc}>\lvert q_{0.001}(\hat X_{k,\cdot g})\rvert\right].$$

Regime: entries that are zero in the input can be imputed, so exact zeros are not preserved in general.

The scVI decoder draws a latent state $z_c\sim\mathcal N(0,I)$, sets $\rho_c=\mathrm{softmax}(f_\theta(z_c))$ and $x_{gc}\sim\mathrm{ZINB}(\ell_c\rho_{gc},\theta_g,\pi_{gc})$, and its denoised output is $\ell_c$ times the decoded $\rho$. Regime: with the observed library size, $\ell_c$ is known and only $\rho$ is learned. DCA outputs the mean of a negative binomial or ZINB decoder trained by maximum likelihood; the ZINB dropout probability is a separate output, and DCA has no posterior and gives no per-entry spread by default.

Every estimator obeys $\mathrm{MSE}(\hat\lambda_{gc})=\mathrm{Bias}^2+\mathrm{Var}$ at finite $n$. Neighbourhood and diffusion smoothing lower variance and add bias toward neighbourhood means; empirical-Bayes shrinkage does the same toward gene means.

### 3.4 Scoring identities

For any transform $\phi$, suppose the held-out target $T$ is independent of the training counts given $\lambda$, and the score $D=f(Y^{\mathrm{tr}})$ is a function of the training counts alone. Then

$$\mathbb E\big[(\phi(T)-D)^2\big]=\mathbb E\big[\mathrm{Var}\big(\phi(T)\mid\lambda\big)\big]+\mathbb E\big[(\mathbb E[\phi(T)\mid\lambda]-D)^2\big].$$

Regime: per-cell normalisation of $T$ is ignored. The first term does not depend on the method, so ranking by MSE is ranking by squared distance to the target. The Poisson score is a proper scoring rule, since $\mathbb E[d'-t\log d']$ is minimised at $d'=\mathbb E[t\mid\lambda]$, but it is not invariant to the scale of $d$.

### 3.5 Assumptions, failure modes and insight

Assumptions: independent molecule sampling; size factors not confounded with cell state; neighbours share expression, for smoothers; correct sampling and prior families, for model-based methods. Failure modes: over-smoothing blurs rare populations and creates gene–gene correlation that is not biological; low-rank thresholds can keep technical structure or remove small true signal; empirical priors fitted to the same cells mislead when cells are few; neural denoisers can hallucinate values in sparsely observed genes, and their output depends on the training loss.

The log-scale MSE is dominated by zeros, so a smoother can reduce it while flattening biological zeros. Heuristics need no fitted model and remain comparators. Explicit likelihoods add posterior spread, let a trained model be reused on new cells, and accept covariates in the rate. Their advantage holds only where the sampling model is right.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| MAGIC | heuristic | diffuses cell profiles over a kNN affinity graph, $\hat X=P^{t}X$ | [R3] |
| kNN smoothing | heuristic | shares expression among each cell's nearest neighbours in PCA space, growing the neighbourhood size k to a maximum (repository version 2.1) | [R4] |
| ALRA | heuristic | rank-$k$ randomised SVD, zeroing of small reconstructed values, per-gene rescaling | [R5], [R6] |
| SAVER | model-based | prior mean for each gene and cell from a Poisson LASSO regression on the other genes (glmnet), prior variance by maximum likelihood, posterior mean reported | [R7] |
| Sanity | model-based | filters Poisson sampling noise from log expression, with a grid prior on gene variance | [R8] |
| DCA | model-based | autoencoder with NB or ZINB decoder trained by maximum likelihood; decoder mean is the output | [R10] |
| scVI | model-based | variational autoencoder with ZINB decoder; decoded expression scaled by library size | [R9] |

MAGIC [R3] is the heuristic comparator here because the OpenProblems denoising benchmark includes it and it reduces to one operator with few parameters. kNN smoothing [R4] and ALRA [R5, R6] are the other heuristics. SAVER [R7], Sanity [R8], scVI [R9] and DCA [R10] are model-based. Following the singlet preference for explicit models where benchmarks allow, the default is model-based, and every heuristic stays in the benchmarks of section 8.

| Method | Parameter | Value | Source (file:line @ sha, or section) |
|---|---|---|---|
| MAGIC | `knn` | 5 | python/magic/magic.py:136 @3a4ffdb |
| MAGIC | `decay` | 1 | python/magic/magic.py:138 @3a4ffdb |
| MAGIC | `t` | 3 | python/magic/magic.py:139 @3a4ffdb |
| MAGIC | `n_pca` | 100 | python/magic/magic.py:140 @3a4ffdb |
| MAGIC | `solver` | exact | python/magic/magic.py:141 @3a4ffdb |
| MAGIC | input transform (OpenProblems wrapper) | log | src/methods/magic/config.vsh.yaml:40-43 @6233222 (task_denoising) |
| ALRA | `k` | 0, chosen by `choose_k` | R/alra.R:111 @f34d465 |
| ALRA | `q` | 10 | R/alra.R:111 @f34d465 |
| ALRA | `quantile.prob` | 0.001 | R/alra.R:111 @f34d465 |
| ALRA | `choose_k` threshold, noise_start, q | 6, 80, 2 | R/alra.R:61 @f34d465 |
| SAVER | `do.fast` | TRUE | R/saver.R:98 @f28d719 |
| Sanity | `v_method` | MAP | README.md:55 @e1b2835 |
| Sanity | `variance_min`, `variance_max` | 0.001, 50 | README.md:59 @e1b2835 |
| Sanity | `number_of_variance_bins` | 160 | README.md:60 @e1b2835 |
| DCA | `ae_type` | nb-conddisp | dca/api.py:21 @6abd124 |
| DCA | `epochs` | 300 | dca/api.py:31 @6abd124 |
| DCA | `batch_size` | 32 | dca/api.py:34 @6abd124 |
| DCA | `early_stop` | 15 | dca/api.py:33 @6abd124 |
| scVI | `gene_likelihood` | zinb | src/scvi/model/_scvi.py:123 @5555ecc |
| scVI | `use_observed_lib_size` | True | src/scvi/model/_scvi.py:124 @5555ecc |
| scVI | `n_samples` (get_normalized_expression) | 1 | src/scvi/model/base/_rnamixin.py:170 @5555ecc |

## 5. Proposed singlet approach

**Routes.** Repository routes and licences are in section 12. SAVER, kNN smoothing and the OpenProblems wrappers are comparators only.

**Default.** `sanity` implements the log-normal posterior of section 3.3 for each gene, with the 160-point variance grid. Gene parameters $(\mu_g,v_g)$ are fitted by maximising the marginal likelihood. Cells are conditionally independent given the gene parameters, so this likelihood is an exact sum over cell chunks. The output is the posterior mean of $\lambda_{gc}$ and its posterior standard deviation, both by fixed Gauss–Hermite quadrature. `variance_estimator` selects the mode (MAP) or mean (EAP) of the variance grid under a uniform prior.

**Falsification.** The default stays only while, on B1, its median MSE over datasets is below that of `magic`, and on B2 it meets its acceptance criterion. Otherwise `magic` becomes the default and the model stays a comparator. Its 90% predictive intervals must cover 0.85 to 0.95 of held-out molecules (proposed); outside that band, `layers/denoised_sd` is withheld and the summary records why.

**Stack.** PyTorch trains the DCA and scVI networks and their optimisers, and trained weights go to `models/<name>`. Hand-written CUDA covers the small hot kernels: the elementwise quadrature posterior, the chunked gene-wise likelihood reduction, MAGIC diffusion as sparse products with the kNN operator applied $t$ times through cuSPARSE, and ALRA's randomised SVD through cuSOLVER. Sanity's gene-wise fit can stream over cell chunks, but the MCP streaming flag stays false until P1 measures it.

**Defaults.** Use `sanity`, `output_scale` `expected_counts`, `device` `auto`, `seed` 0 and `overwrite` false. Use `dca` or `scvi` only when a trained model is wanted; only `scvi` takes a batch covariate. Denoised values are not counts: never pass them to count-based tests, and do not apply the tool to protein counts.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts; the only expression input |
| read | obs/size_factor | float | size factor $s_c$; when absent, library size divided by its mean |
| read | obs/batch | categorical | scVI covariate, used only when `batch_key` is set |
| read | obsm/X_pca | float32 | PCA for magic; computed with `n_pca` components when absent |
| write | layers/denoised | float32 | non-negative estimate; scale set by `output_scale` |
| write | layers/denoised_sd | float32 | posterior standard deviation; sanity, and scvi with `n_samples` above 1 |
| write | obs/size_factor | float32 | written only when the tool estimated it |
| write | uns/denoising_params | dict | method, options, seed, device, version |
| write | models/<name> | weights | dca and scvi trained weights |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "sanity" | `sanity`, `magic`, `alra`, `dca`, `scvi` | Denoiser. sanity is the default model-based posterior; magic and alra are heuristic comparators; dca and scvi are neural. |
| `output_scale` | string | "expected_counts" | `expected_counts`, `cp10k` | expected_counts: molecules at the input depth; cp10k: per-cell proportions times 1e4, depth removed. |
| `sanity` | object | — | — | Options for method sanity (Poisson posterior with a per-gene variance grid). |
| `sanity.variance_estimator` | string | "MAP" | `MAP`, `EAP` | MAP: mode of the variance-grid likelihood; EAP: its mean under a uniform grid prior. |
| `sanity.variance_min` | number | 0.001 | > 0 | Lower bound of the variance grid. |
| `sanity.variance_max` | number | 50 | > 0 | Upper bound of the variance grid; must exceed variance_min. |
| `sanity.n_bins` | integer | 160 | min 2 | Number of grid points for the gene variance. |
| `magic` | object | — | — | Options for method magic (diffusion over a kNN graph in PCA space). |
| `magic.knn` | integer | 5 | min 1 | Neighbours for the affinity kernel. |
| `magic.t` | integer | 3 | min 1 | Diffusion power; the main smoothing control. |
| `magic.n_pca` | integer | 100 | min 2 | Principal components used before the kNN graph. |
| `magic.solver` | string | "exact" | `exact`, `approximate` | Diffusion solver; approximate trades accuracy for speed. |
| `alra` | object | — | — | Options for method alra (rank-k SVD with zero-preserving thresholding). |
| `alra.k` | integer | 0 | min 0 | Rank; 0 selects k automatically by the singular-value noise threshold. |
| `alra.q` | integer | 10 | min 0 | Power iterations in the randomised SVD. |
| `alra.quantile_prob` | number | 0.001 | > 0; < 0.5 | Per-gene quantile setting the zeroing threshold. |
| `dca` | object | — | — | Options for method dca (autoencoder with NB or ZINB decoder). |
| `dca.ae_type` | string | "nb-conddisp" | `nb-conddisp`, `nb`, `zinb` | Likelihood head; the API default is nb-conddisp, not zinb. |
| `dca.epochs` | integer | 300 | min 1 | Maximum training epochs. |
| `dca.batch_size` | integer | 32 | min 1 | Mini-batch size. |
| `dca.early_stop` | integer | 15 | min 1 | Epochs without improvement before early stopping. |
| `scvi` | object | — | — | Options for method scvi (variational autoencoder; decoded normalised expression). |
| `scvi.gene_likelihood` | string | "zinb" | `zinb`, `nb` | Decoder likelihood. |
| `scvi.use_observed_library_size` | boolean | true | — | Use the observed library size instead of inferring it. |
| `scvi.n_samples` | integer | 1 | min 1 | Posterior draws averaged; above 1 writes layers/denoised_sd. |
| `scvi.batch_key` | string/null | null | — | obs column of batch labels used as a model covariate; null for none. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for neural training and the randomised SVD of alra. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing the result. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Options are nested by method, and `method` chooses which object applies; a non-default value in an object for an unselected method is rejected. `output_scale` changes only `layers/denoised` and its standard deviation, never the stored counts. `sanity` requires `variance_min` below `variance_max`. `scvi` is the only method that reads `obs/batch`, and a posterior standard deviation needs `n_samples` above 1. `seed` fixes neural training and ALRA's randomised SVD; the Poisson posterior has no random element.

## 7. MCP tool

Tool name `singlet_imputation_expression_denoising` (definition in `tasks/mcp/singlet_imputation_expression_denoising.json`). Example call and compact result:

```json
{"dataset": "/data/example.singlet", "method": "sanity", "sanity": {"variance_estimator": "MAP", "n_bins": 160}}
```

```json
{"dataset": "/data/example.singlet", "status": "completed",
 "wrote": ["layers/denoised", "layers/denoised_sd", "uns/denoising_params"],
 "summary": {"method": "sanity", "output_scale": "expected_counts", "n_cells": "<int>", "n_genes": "<int>", "zero_fraction_before": "<float>", "zero_fraction_after": "<float>"},
 "provenance_id": "<string>"}
```

Long-running: `dca` and `scvi` can return status `queued` (MCP output schema). Stochastic: yes, through neural training and ALRA's randomised SVD; `seed` fixes both. Dry run: returns estimated seconds, peak memory in GB and device for the selected method before any computation.

## 8. Benchmarks

**Shared protocol.** All methods receive the same count matrix, cell set and gene set, with the default options of section 4 unless a benchmark says otherwise, and the same seed. Outputs are normalised per cell to CP10k and log1p before scoring, which removes depth, except where a benchmark states a depth-sensitive score. No option is tuned on the scored entries; tuning uses separate held-out data (see imputation.heldout_denoiser_scoring). Comparators are magic, alra, dca, scvi, saver, kNN smoothing and the default sanity, with a raw-input baseline and a perfect-output control.

### B1. Molecular cross-validation on held-out molecules

- **Goal**: estimate denoising accuracy on molecules the method did not see, without a biological truth.
- **Ground truth**: held-out molecules. Each count is split binomially into 90% train and 10% test with seed 0. Given $\lambda_{gc}$, the test count is Poisson with mean $0.1\lambda_{gc}$ and independent of the training counts; CP10k normalisation removes the factor 0.1.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| OpenProblems v1 denoising collection, largest batch per dataset when a batch column is set (example: pancreas, log CP10k) | [R11] for the split; collection defined by the task repository (section 12) | scRNA-seq UMI; species —; size — | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| MSE | mean over all cells and genes of $(\log(1+\tilde t_{gc})-\log(1+\tilde d_{gc}))^2$; $\tilde t$ and $\tilde d$ are the test counts and the output, each normalised to $10^4$ per cell separately; zeros included | minimise | primary | [R11] |
| Poisson | mean over all cells and genes of $d'_{gc}-t_{gc}\log(d'_{gc}+10^{-6})$, with $d'=d\,\sum_{g,c}t_{gc}/\mathrm{train\_sum}$, the matrix-wide test total over the training total | minimise | primary | [R11] |
| Predictive coverage | share of test counts inside the 90% posterior predictive interval, with test rate one ninth of the expected training count | nominal 0.9 | guardrail | proposed |

- **Comparators**: sanity (default), magic, alra, dca, scvi, saver, kNN smoothing; no_denoising (training counts as output, negative control); perfect_denoising (test counts, MSE 0 by construction). Predictive coverage applies to posterior methods only.
- **Protocol**: per dataset, training fraction 0.9 and seed 0; each method on the training counts; per-dataset scores and their median across datasets (proposed).
- **Acceptance criterion**: proposed. MSE and Poisson both below no_denoising on at least 80% of datasets; a method that wins MSE and loses Poisson is flagged. Predictive coverage between 0.85 and 0.95.
- **Known pitfalls**: log-scale MSE is dominated by zeros, so a smoother can win while flattening biological zeros; the criterion assumes independent molecules, which PCR duplicates and UMI collisions break.

### B2. Down-sampling recovery of full-depth values (proposed)

- **Goal**: whether denoised values from thinned counts recover the full-depth expression of the same cells.
- **Ground truth**: full-depth counts of the same entries, normalised per cell to CP10k and log1p. The thinned input is a subset of these molecules, which favours the raw baseline, so beating it is a conservative test.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Deepest 10% of cells per held-out study (generator step 1) | singlet catalogue; no accession | UMI scRNA-seq; species —; size — | — | studies excluded from all model training |

- **Generator**:
  1. For each held-out study, keep the 10% of cells with the largest total UMI count.
  2. Thin each count binomially, $y^{(p)}_{gc}\sim\mathrm{Binomial}(y_{gc},p)$, with $p\in\{0.1,0.5\}$ and seeds 0 to 2 (proposed).
  3. Keep genes with at least 10 expressing full-depth cells; methods receive only the thinned matrix.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-gene correlation | median over genes of the Pearson correlation across cells between log1p CP10k of output and of full-depth counts | maximise | primary | proposed |
| Per-cell correlation | median over cells of the Pearson correlation across genes, on the same scales | maximise | primary | proposed |
| Zero preservation | fraction of full-depth zeros that stay exactly zero in the output | report alongside | guardrail | proposed |

- **Comparators**: raw thinned counts (log1p CP10k), magic, alra, sanity, dca, scvi.
- **Protocol**: default options; all comparators receive identical thinned inputs for each $p$ and seed.
- **Acceptance criterion**: proposed. Median per-gene correlation exceeds the raw-thinned value by at least 0.02 at both values of $p$.
- **Known pitfalls**: full-depth data carry their own technical noise and are not truth; per-gene correlations weight highly expressed genes, which the gene filter only partly controls.

### B3. Known-composition mixtures (published data)

- **Goal**: whether denoised values recover the known composition of cell-line RNA mixtures.
- **Ground truth**: known mixing proportions per library. The expected expression of gene $g$ in library $m$ is the proportion-weighted average of pure-line CP10k profiles, log1p transformed; the estimand is the composition-expected CP10k value per library.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Tian et al. 2019 mixture control libraries | [R12]; CellBench data repository (contents not described here) | cell-line RNA mixtures; species —; size — | — | pure-line libraries from the same experiment |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-gene correlation | median over genes of the Pearson correlation across libraries between output and expected log1p CP10k | maximise | primary | proposed |
| Mean squared error | mean over genes and libraries of the squared difference of the same two log1p CP10k values | minimise | primary | proposed |

- **Comparators**: raw normalised counts, magic, alra, sanity, dca, scvi.
- **Protocol**: default options; pure-line profiles averaged over pure-line libraries of the same experiment (proposed); scores per dataset.
- **Acceptance criterion**: proposed. Median per-gene correlation improves on raw normalised counts by at least 0.02.
- **Known pitfalls**: pooled-RNA libraries do not follow Poisson thinning, so expected values are approximate; pure-line profiles are noisy, which caps the attainable correlation.

### P1. Performance and scaling

Wall time, peak host and device memory, and throughput for $10^4$, $10^5$ and $10^6$ cells at 2,000 highly variable genes (proposed), on CPU and CUDA where available. Comparators: magic (exact and approximate solvers), alra, saver (`do.fast` TRUE), dca, scvi (GPU), sanity and kNN smoothing. Hold fixed: gene count, threads (Sanity default 4), hardware, seed, batch size (32 for dca) and precomputed PCA. Acceptance criterion (proposed): the default sanity completes $10^6$ cells on one CUDA device within its memory and is faster than the CPU magic comparator at $10^5$ cells.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `normalization.count_noise_model_selection`: Count noise-model selection and zero-inflation diagnosis
- **Feeds**:
  - `imputation.heldout_denoiser_scoring`: Held-out scoring and parameter selection for denoisers
  - `imputation.de_after_imputation`: Differential expression after imputation
  - `imputation.cluster_recovery_after_imputation`: Cell-type cluster recovery after imputation
  - `imputation.trajectory_after_imputation`: Trajectory and pseudotime preservation after imputation
- **Reads**: `layers/counts`, `obs/size_factor`, `obs/batch`, `obsm/X_pca`
- **Writes**: `layers/denoised`, `layers/denoised_sd`, `obs/size_factor`, `uns/denoising_params`, `models/<name>`
<!-- CHAINING:AUTO:END -->

Part of the imputation recipe: quality filtering, size factors and noise-model diagnosis come first; denoising feeds held-out scoring and expression-level downstream tasks.

## 10. Risks, pitfalls and open questions

- **Methods without a reviewed source.** DrImpute, scImpute, DeepImpute, bayNorm, totalVI, TRANSLATE, SAVER-X and foundation-model reconstruction are omitted because their primary papers and code were not read for this task.
- **Published comparisons not used.** Hou et al. [R13] is cited for its bibliographic record only; its reported results and metrics are not used. The neighbour-recovery and subtype results of Breda et al. [R8] come without a reviewed simulation design or dataset list, so they are not used as benchmarks.
- **Sanity internals.** The defaults come from its README rather than its source. The prior family, the expression estimator that Sanity itself reports, and its MLE and MARG variance options are not reimplemented; the posterior-mean estimator of section 3.3 is a singlet choice.
- **kNN smoothing version.** R4 is cited for the iterative method. The preprint text was not read, so the row follows the repository's version 2.1 code, which adds dither and counts the cell itself in k.
- **MAGIC kernel.** The kernel in section 3.3 was not checked against the graphtools affinity code that MAGIC calls, so its symmetrisation and bandwidth rule remain unverified.
- **Metadata gaps.** Repository maintainers for MAGIC, kNN smoothing and scvi-tools, the ALRA author list beyond its first author, the full OpenProblems dataset list with sizes, and the CellBench repository contents are not recorded. The Svensson record is absent from the local corpus; its DOI was taken from a web search result that cites it, and its volume and pages are omitted.
- **Technical risks.** The OpenProblems API declares the denoised layer integer while methods return floats, so singlet stores float32 and records it. The Poisson score reads `train_sum` from the test object's `uns`, which the OpenProblems pipeline sets to the total of the training counts. Denoised values must not enter count-based tests.
- **First experiment.** Score sanity, magic and no_denoising on the B1 collection, check predictive coverage, then score B2 at $p=0.1$ and $p=0.5$ before changing the default.

## 11. References

R1. Svensson V. Droplet scRNA-seq is not zero-inflated. *Nature Biotechnology* 2020. doi:10.1038/s41587-019-0379-5; preprint doi:10.1101/582064 (bioRxiv 2019) — partial (search)

R2. Sarkar A, Stephens M. Separating measurement and expression models clarifies confusion in single-cell RNA sequencing analysis. *Nature Genetics* 2021. doi:10.1038/s41588-021-00873-4 — verified (corpus)

R3. van Dijk D, Sharma R, Nainys J, et al. Recovering Gene Interactions from Single-Cell Data Using Data Diffusion. *Cell* 2018. doi:10.1016/j.cell.2018.05.061 — verified (corpus)

R4. Wagner F, Yan Y, Yanai I. K-nearest neighbor smoothing for high-throughput single-cell RNA-Seq data. *bioRxiv* 2018. doi:10.1101/217737 — verified (corpus)

R5. Linderman GC, Zhao J, Kluger Y. Zero-preserving imputation of scRNA-seq data using low-rank approximation. *bioRxiv* 2018. doi:10.1101/397588 — verified (corpus)

R6. Linderman GC, et al. Zero-preserving imputation of single-cell RNA-seq data. *Nature Communications* 2022. doi:10.1038/s41467-021-27729-z — verified (corpus)

R7. Huang M, et al. SAVER: gene expression recovery for single-cell RNA sequencing. *Nature Methods* 2018. doi:10.1038/s41592-018-0033-z — verified (corpus)

R8. Breda J, Zavolan M, van Nimwegen E. Bayesian inference of gene expression states from single-cell RNA-seq data. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00875-x — verified (corpus)

R9. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)

R10. Eraslan G, Simon LM, Mircea M, Mueller NS, Theis FJ. Single-cell RNA-seq denoising using a deep count autoencoder. *Nature Communications* 2019. doi:10.1038/s41467-018-07931-2 — verified (corpus)

R11. Batson J, Royer L, Webber J. Molecular Cross-Validation for Single-Cell RNA-seq. *bioRxiv* 2019. doi:10.1101/786269 — verified (corpus)

R12. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)

R13. Hou W, Ji Z, Ji H, Hicks SC. A systematic evaluation of single-cell RNA-sequencing imputation methods. *Genome Biology* 2020. doi:10.1186/s13059-020-02132-x — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/KrishnaswamyLab/MAGIC | — | GPL-2.0 (LICENSE file, GNU GPL v2 text) | heuristic method and comparator | reimplement |
| https://github.com/KlugerLab/ALRA | George C. Linderman (copyright holder, LICENSE.txt) | MIT (LICENSE.txt) | low-rank method | port |
| https://github.com/yanailab/knn-smoothing | — | none (no LICENSE file at repository root) | smoothing comparator | callout |
| https://github.com/mohuangx/SAVER | Mo Huang (maintainer, DESCRIPTION) | MIT (LICENSE and LICENSE.md, copyright 2024 SAVER authors; DESCRIPTION: MIT + file LICENSE); the scRNA-tools record lists GPL-2.0, which the repository does not state | posterior comparator | callout |
| https://github.com/jmbreda/Sanity | Jérémie Breda, Mihaela Zavolan, Erik van Nimwegen (CITATION.cff) | GPL-3.0 (LICENSE, GNU GPL v3 text) | default method | reimplement |
| https://github.com/theislab/dca | Gokcen Eraslan (setup.py author) | Apache-2.0 (LICENSE.txt) | neural method | port |
| https://github.com/YosefLab/scvi-tools | — | BSD-3-Clause (LICENSE) | neural method and decoder | port |
| https://github.com/openproblems-bio/task_denoising | — | MIT (LICENSE; copyright 2024 Open Problems in Single-Cell Analysis) | benchmark collection, split and metric scripts | callout |
