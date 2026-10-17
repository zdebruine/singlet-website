---
id: multimodal.protein_imputation_from_rna
title: Protein (ADT) imputation from RNA
area: multimodal
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [multimodal.adt_background_removal_normalization, normalization.size_factor_estimation, cell-calling.cell_vs_empty_droplet_calling, qc.low_quality_cell_detection]
feeds: [annotation.marker_based_cell_assignment, annotation.reference_label_transfer]
reads: [layers/counts, layers/normalized, obs/batch, obs/cell_type, obs/is_train, uns/normalization_id, obsm/X_pca]
writes: [obsm/adt_pred, obsm/adt_pred_sd, models/totalvi_adt, uns/adt_pred_metrics]
devices: [cpu, cuda]
mcp_tool: singlet_multimodal_protein_imputation_from_rna
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Protein (ADT) imputation from RNA

> Predict the surface-protein (ADT) profile of RNA-only cells from a paired CITE-seq reference, on a stated normalisation, with 90 percent predictive intervals whose coverage is measured, and score the result against held-out measured ADT.

## 1. Question

Given the RNA counts of query cells and a reference in which the same cells carry RNA and ADT, what is the expected measured ADT vector of each query cell, and how far can its values be trusted? Inputs are RNA counts, batch labels and the reference's ADT counts. Outputs are a cells-by-proteins matrix on the log_cp10k scale (`obsm/adt_pred`) and, optionally, per-value posterior spread. A correct answer matches measured ADT in per-cell pattern and in magnitude, and its intervals contain the measured value at the nominal rate.

## 2. Why this task matters and where the field stands

CITE-seq measures surface proteins with antibody-derived tags in the same cells as RNA [R1]. Most atlases contain RNA only, so their cells lack the protein markers that analysts use for lineage calls, and a predicted protein is useful only if its error is known.

The status is **contested**. Joint probabilistic models (totalVI [R2]), neural networks (sciPENN [R3]) and heuristic anchor transfer (Seurat [R4][R5]) are all in use. The best-practices chapter reports that totalVI predicted proteins from RNA best in independent benchmarks [R6][R7][R8]. That is a secondary statement (section 10).

The limits on use (cross-study transfer, calibration, decoupling, target normalisation and the rescaling used by the top entries) are listed in section 10.

## 3. Theory and insight

### 3.1 Estimands and normalisation

The scored quantity is the log1p of each protein's count per 10,000 of the cell's total ADT,

$$\tilde y_{nt}=\log\Big(1+10^{4}\,\frac{y_{nt}}{\sum_{t'}y_{nt'}}\Big),$$

where $y_{nt}$ is the measured ADT count of protein $t$ in cell $n$, background binding included. Every method estimates $\mu_{nt}=E[\tilde y_{nt}\mid x_n,s_n]$, the conditional mean of this target given RNA counts $x_n$ and batch covariates $s_n$. A method that predicts a count mean $\hat m_{nt}$ is mapped to the same scale by $\hat\mu_{nt}=\log\big(1+10^{4}\hat m_{nt}/\sum_{t'}\hat m_{nt'}\big)$. This approximates $\mu_{nt}$ and is exact only when the conditional distribution of the target is degenerate, so its error is checked in B3. The totalVI outputs are count-scale means, the foreground mean $E[(1-\pi_{nt})\beta_{nt}\alpha_{nt}]$ or that mean plus $E[\pi_{nt}\beta_{nt}]$, and both are mapped by this rule before scoring.

Each score estimates one quantity, stated in one sentence:

- The per-cell correlation is the mean over test cells of the across-protein Pearson correlation between $\tilde y_n$ and $\hat\mu_n$; it is invariant to affine rescaling of each cell's prediction, so it tests ordering and not scale.
- The RMSE is taken over all entries of $\tilde y-\hat\mu$ on the log_cp10k scale and tests magnitude.
- The coverage is the fraction of measured $\tilde y_{nt}$ inside the central 90 percent of predictive draws, and it tests calibration only if the predictive distribution is correctly specified.

### 3.2 Model-based formulation

totalVI [R2] is a variational autoencoder over paired cells. Its RNA likelihood is negative binomial (NB) with library size $l_n$, normalised decoder frequency $\rho_{ng}$ and gene inverse dispersion $\theta_g$, as in scVI [R12]:

$$x_{ng}\sim\mathrm{NB}(l_n\rho_{ng},\theta_g).$$

Each protein has a background level with a covariate-dependent prior and a per-cell foreground ratio $\alpha_{nt}$. A protein is background with probability $\pi_{nt}$ and foreground otherwise, which gives a negative-binomial mixture:

$$\beta_{nt}\sim\mathrm{LogNormal}(c_t^\top s_n,\,d_t^\top s_n),\qquad v_{nt}\sim\mathrm{Bernoulli}(\pi_{nt}),\qquad y_{nt}\sim\mathrm{NB}\big(v_{nt}\beta_{nt}+(1-v_{nt})\beta_{nt}\alpha_{nt},\,\phi_t\big),$$

where $v_{nt}=1$ marks background and $\phi_t$ is protein-specific overdispersion. The denoised outputs are posterior expectations, approximated by Monte Carlo over the variational posterior:

$$\hat\mu^{\mathrm{fg}}_{nt}=\mathbb{E}\big[(1-\pi_{nt})\beta_{nt}\alpha_{nt}\big],\qquad \hat\mu^{\mathrm{bg}}_{nt}=\mathbb{E}\big[(1-\pi_{nt})\beta_{nt}\alpha_{nt}+\pi_{nt}\beta_{nt}\big].$$

Training maximises an evidence lower bound, $\log p(x_n,y_n\mid s_n)\ge\mathbb{E}_q[\log p(x_n,y_n\mid z_n,l_n,\beta_n,s_n)]-\mathrm{KL}(q\|p)$, with $q$ factorised over $\beta$, $z$ and $l$ given $(x,y,s)$. Monte Carlo error falls as $1/\sqrt{n_{\mathrm{samples}}}$, and the expectation inherits the gap of the bound.

The shared latent state $z_n$ makes reference mapping one operation. For a batch with no protein measurements, the protein term is removed and the query is encoded from $q(z_n\mid x_n,s_n)$ [R13]; the decoder then maps that state to a protein profile.

The heuristics have no likelihood. Seurat anchor transfer predicts reference protein values as a weighted sum, $\hat Y_{q,\cdot}=W^\top Y_{\mathrm{ref}}$ [R4][R5], with anchor weights from a PCA-projected space; their normalisation is set in the implementation (section 10). kNN regression averages neighbours with kernel $K$,

$$\hat y_q=\frac{\sum_{j\in\mathcal N_k(q)}K(d_{qj})\,y_j}{\sum_{j\in\mathcal N_k(q)}K(d_{qj})},$$

and reduces to plain averaging when $K\equiv1$. Both assume that cells close in RNA are close in protein, and neither returns an interval.

### 3.3 Assumptions and failure modes

Assumptions:

- Protein given cell state is largely determined by RNA. Residual protein variance is not recoverable from RNA alone, because of post-transcriptional regulation, protein turnover and trafficking.
- Reference and query share the antibody panel and processing, up to the covariates the model represents.
- Evaluation cells are exchangeable with reference cells, or held-out batches represent new donors or sites.

Failure modes:

- Decoupling: PD-L1 (CD274) and a gamma-delta TCR chain are predicted poorly, while lineage markers CD3, CD5 and CD7 are predicted well [R9].
- The default totalVI output excludes the background term, so it is offset from measured ADT, which includes background.
- totalVI treats a protein that is all zero in a batch as missing, with a warning, so a truly unexpressed protein is dropped for that batch unless `override_missing_proteins` is set.
- Rank metrics reward ordering and not magnitude; a method can reach high per-cell correlation with the wrong scale, which RMSE exposes.
- Strong lineage structure inflates per-cell correlation, because between-lineage differences dominate each cell's vector.
- MSE-trained heads weight high-count cells heavily; interval estimates need a distributional head.

### 3.4 What a model adds

A shared latent space gives RNA-only cells a posterior from the model that fits paired cells, so one trained reference scores new queries without refitting. A posterior also yields predictive draws, and therefore intervals, that heuristics cannot provide. Those draws must include the count noise of the measurement. Draws of the mean alone describe the uncertainty of $\mu$, not of $\tilde y$, and would undercover measured counts. Coverage is nominal only where the protein likelihood is correctly specified; an ambient ADT component outside the mixture would break this, which is why background stays inside the model (section 5). Heuristic transfer is strong when the reference is large and similar and needs no training, so it stays in every benchmark as the comparator.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| totalVI | model-based | Joint VAE with NB RNA likelihood and a protein background and foreground mixture; RNA-only cells are encoded from RNA and decoded to protein | [R2] |
| sciPENN | model-based | Feed-forward input and hidden blocks with an MSE head and a quantile head for GEX-to-ADT prediction | [R3] |
| MultiVI | model-based | Multimodal VAE for RNA with ATAC and optional protein input; not applied to ADT here | [R14] |
| scButterfly | model-based | Dual VAE translating between paired modalities; its task configuration excludes ADT | section 12 |
| Seurat anchor transfer | heuristic | Anchor-weighted average of reference protein values (TransferData) | [R4][R5] |
| kNN regression | heuristic | Uniform-weight mean of reference protein values over the k nearest cells in a truncated-SVD space of RNA | section 12 |
| Kernel ridge (Guanlab-dengkw) | model-based | Truncated SVD of RNA, RBF kernel ridge onto the protein SVD, averaged over batch-reshuffled repeats | section 12 |
| LightGBM and GRU ensemble (senkin_tmp) | model-based | Four LightGBM models on RNA feature representations, refined by two bidirectional-GRU networks (cosine and MSE losses, blended 55/45), with per-cell ridge rescaling | section 12 |
| SS-OPM | model-based | SVD-compressed encoder-decoder on per-cell median-normalised log input, with per-cell scaling and a linear output rescaling | section 12 |

The published standard is a joint probabilistic model, totalVI, with anchor and neighbour transfer as the heuristic standard. The OpenProblems task reports per-cell correlation (mean_pearson_per_cell) and keeps the 2021 and 2022 competition entries as comparators. singlet implements totalvi, sciPENN and knn (section 5); the other methods are comparators only.

Defaults used by the implemented and comparator methods:

| Method | Parameter | Value | Source (repository file:line @ commit) |
|---|---|---|---|
| totalVI | n_latent | 20 | src/scvi/model/_totalvi.py:138 @5555ecc |
| totalVI | protein_dispersion | protein | src/scvi/model/_totalvi.py:140 @5555ecc |
| totalVI | latent_distribution | normal | src/scvi/model/_totalvi.py:142 @5555ecc |
| totalVI | include_protein_background (get_normalized_expression) | False | src/scvi/model/_totalvi.py:415 @5555ecc |
| totalVI | n_hidden | 256 | src/scvi/module/_totalvae.py:122 @5555ecc |
| totalVI | n_layers_encoder | 2 | src/scvi/module/_totalvae.py:124 @5555ecc |
| sciPENN | n_epochs | 10000 (early stopping; test default 1) | src/methods/scipenn/config.vsh.yaml:33 @4d73d31 |
| sciPENN | batch_size | 128 | src/methods/scipenn/config.vsh.yaml:39 @4d73d31 |
| sciPENN | seed | 0 | src/methods/scipenn/config.vsh.yaml:43 @4d73d31 |
| Seurat TransferData | k.weight | 50 | R/integration.R:3436 @5f67c70 |
| Seurat TransferData | sd.weight | 1 | R/integration.R:3437 @5f67c70 |
| Seurat TransferData | n.trees | 50 | R/integration.R:3439 @5f67c70 |
| Seurat TransferData | weight.reduction | pcaproject | R/integration.R:3433 @5f67c70 |
| Seurat TransferData | prediction.assay | FALSE | R/integration.R:3442 @5f67c70 |
| knn (knnr_py) | distance_method | minkowski | src/methods/knnr_py/config.vsh.yaml:16 @4d73d31 |
| knn (knnr_py) | n_pcs | 50 | src/methods/knnr_py/config.vsh.yaml:20 @4d73d31 |
| knn (knnr_py) | n_neighbors | 100 | src/methods/knnr_py/config.vsh.yaml:24 @4d73d31 |
| Guanlab-dengkw | n_repeats | 5 | src/methods/guanlab_dengkw_pm/config.vsh.yaml:23 @4d73d31 |
| Guanlab-dengkw | seed | 1000 | src/methods/guanlab_dengkw_pm/config.vsh.yaml:31 @4d73d31 |

## 5. Proposed singlet approach

Routes:

- **totalvi**: port (permissive licence). The encoder, the NB and mixture likelihoods and the Monte Carlo denoiser are re-implemented in singlet's PyTorch stack, following the scvi-tools model definitions.
- **sciPENN**: port of the network and loss (licence in section 12). Point predictions only.
- **knn**: port as a GPU brute-force kernel; the algorithm is re-implemented, not linked.
- Seurat anchor transfer, the competition entries and the benchmark harness are callouts, used as comparators only.

The proposed formulation is the totalVI-style model of section 3.2 with three changes. First, missing protein is declared per batch from panel metadata, not inferred from all-zero columns, so an unexpressed protein is kept. Second, intervals come from posterior predictive draws that include count noise (section 3.4). Third, if 90 percent coverage on a held-out study falls outside 0.85 to 0.95, a per-protein width factor is fitted on a calibration study; this step is proposed and not yet benchmarked. The formulation is falsified (thresholds proposed) if the B1 criterion fails, if B2 fails its Spearman or coverage criterion, or if the kNN comparator is within 0.01 of the model's per-cell correlation on at least 80 percent of held-out studies, because the model then adds nothing.

The ML stack is PyTorch for the variational autoencoder and the sciPENN-style network, where gradient training is the cost. Hard-coded CUDA through cuBLAS and cuSOLVER covers only small hot operations: brute-force kNN distances, PCA and truncated SVD of RNA, and the ridge rescaling used by the competition entries. Posterior sampling stays in PyTorch. Training uses CUDA when available and CPU otherwise; prediction from a stored model is chunked by cells. The reference is held in memory, so streaming is not claimed.

Defaults an agent should use without asking: method `totalvi`; target `log_cp10k`; reference equal to cells with `obs/is_train` true; `n_latent` 20, `n_hidden` 256, `n_layers_encoder` 2; `max_epochs` 200 and `n_samples` 25, the values the best-practices notebook uses for query training and prediction; `include_protein_background` true, because the measured target includes background and the library default (section 4) does not; `seed` 0; split `is_train` with split seed 1 and a cap of 1000 cells.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | RNA UMI counts (totalvi input); measured ADT counts on the protein modality |
| read | layers/normalized | sparse float | RNA log_cp10k (knn and sciPENN input) |
| read | obs/batch | categorical | batch covariate; defines held-out batches when no split column exists |
| read | obs/cell_type | categorical | optional; subsample weights and stratification |
| read | obs/is_train | bool | reference and query split |
| read | uns/normalization_id | string | names the target normalisation used for scoring |
| read | obsm/X_pca | float32 | RNA PCA embedding for knn distances |
| write | obsm/adt_pred | float32 | predicted protein matrix, cells by proteins, on the target scale, with protein names stored alongside |
| write | obsm/adt_pred_sd | float32 | per-value posterior spread when return_samples is true |
| write | models/totalvi_adt | model | fitted reference model for query mapping |
| write | uns/adt_pred_metrics | dict | scores for the call |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle (.singlet path or URI, or workspace handle) with query RNA counts and, for scoring, held-out ADT. |
| `reference` | string | — | — | Optional handle of a paired RNA and ADT reference. If omitted, cells with obs/is_train true serve as reference. |
| `method` | string | "totalvi" | `totalvi`, `sciPENN`, `knn` | totalvi is the default. sciPENN gives point predictions; knn is the heuristic comparator. |
| `target_normalization` | string | "log_cp10k" | `log_cp10k`, `clr` | Scale of the training target and scoring layer. Scores on different targets are not comparable. |
| `evaluation` | object | — | — | Options for scoring against held-out measured ADT. |
| `evaluation.split_key` | string | "is_train" | — | obs column that marks reference cells; if absent, a quarter of batches is held out. |
| `evaluation.split_seed` | integer | 1 | — | Seed for the batch split and the held-out cell subsample. |
| `evaluation.test_cell_cap` | integer | 1000 | min 1 | Maximum held-out cells scored, sampled with probability proportional to the square root of inverse cell-type frequency. |
| `totalvi` | object | — | — | Options for method totalvi. |
| `totalvi.n_latent` | integer | 20 | min 1 | Dimension of the shared latent space. |
| `totalvi.n_hidden` | integer | 256 | min 1 | Hidden width of the encoder and decoder. |
| `totalvi.n_layers_encoder` | integer | 2 | min 1 | Number of encoder layers. |
| `totalvi.protein_dispersion` | string | "protein" | — | Granularity of protein overdispersion. |
| `totalvi.include_protein_background` | boolean | true | — | Add the background term so predictions match measured ADT; the library default is false. |
| `totalvi.n_samples` | integer | 25 | min 1 | Monte Carlo draws per cell for the predictive mean. |
| `totalvi.return_samples` | boolean | false | — | Also write per-value spread to obsm/adt_pred_sd and report 90 percent interval coverage. |
| `totalvi.max_epochs` | integer | 200 | min 1 | Maximum training epochs for the reference model. |
| `sciPENN` | object | — | — | Options for method sciPENN. |
| `sciPENN.n_epochs` | integer | 10000 | min 1 | Maximum training epochs; early stopping usually ends training sooner. |
| `sciPENN.batch_size` | integer | 128 | min 1 | Training batch size in cells. |
| `knn` | object | — | — | Options for method knn. |
| `knn.n_neighbors` | integer | 100 | min 1 | Reference neighbours averaged per query cell. |
| `knn.n_pcs` | integer | 50 | min 1 | Principal components used as the distance space. |
| `knn.distance_method` | string | "minkowski" | — | Distance metric for the neighbour search. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for training, posterior sampling and the held-out subsample. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without training or predicting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Parameters in the `totalvi`, `sciPENN` and `knn` objects apply only when that method is selected; a value set for another method fails the call. `return_samples` must be true for `obsm/adt_pred_sd` and for `interval_coverage_90`. The reference must have the same protein panel in the same order as the query, and a mismatch fails the call. `evaluation` applies only when held-out ADT is present. `target_normalization` sets both the training target and the scoring layer, so scores obtained on different targets are not comparable.

## 7. MCP tool

Tool name `singlet_multimodal_protein_imputation_from_rna` (definition in `tasks/mcp/singlet_multimodal_protein_imputation_from_rna.json`). Example call and compact result:

```json
{"dataset": "query.singlet", "reference": "reference.singlet", "method": "totalvi", "totalvi": {"n_samples": 25, "return_samples": true}}
```

```json
{"dataset": "query.singlet", "status": "completed", "wrote": ["obsm/adt_pred", "obsm/adt_pred_sd", "models/totalvi_adt", "uns/adt_pred_metrics"], "summary": {"method": "totalvi", "n_proteins": "<int>", "n_test_cells": "<int>", "mean_pearson_per_cell": "<float>", "interval_coverage_90": "<float>"}, "provenance_id": "<id>"}
```

Long-running: training of a reference model is queued as a job, while prediction from a stored model is executed inline. Stochastic: training and sampling depend on `seed`, and GPU reductions can differ in the last digits across devices. Dry-run estimate: seconds, peak memory and device, computed from reference size, panel size and `n_latent` without training.

## 8. Benchmarks

Shared protocol: every method trains on the same reference cells, predicts the same held-out cells, converts its output with the section 3.1 mapping and is scored by the same code on the log_cp10k target. Stochastic methods use seeds 0, 1 and 2 and report the median and range. A per-cell vector with zero variance scores 0 in the correlation metrics. Acceptance criteria name their metrics; other metrics are reported but do not decide acceptance. Hardware is as in P1.

### B1. OpenProblems predict_modality, NeurIPS 2021 BMMC CITE-seq, RNA to ADT (published)

- **Goal**: Test whether a candidate predicts held-out measured ADT better than the mean-per-protein control and the kNN and sciPENN comparators.
- **Ground truth**: Orthogonal measurement. Each held-out cell's label is its measured ADT vector in the normalised layer of the task's Solution file, and its RNA is the only input. The estimand is $\tilde y_{nt}$ of section 3.1, background included.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| openproblems_neurips2021 `bmmc_cite` | [R10], [R11]; section 12 | CITE-seq RNA and ADT; — | — | Test set capped at 1000 cells |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| mean_pearson_per_cell | Mean over test cells of the across-protein Pearson correlation | maximise | primary | section 12 |
| rmse | Root mean squared difference over all matrix entries, zeros included | minimise | guardrail | section 12 |
| mae | Mean absolute difference over the same entries | minimise | guardrail | section 12 |

- **Comparators**: control mean_per_gene (floor), control zeros, control solution (ceiling), knnr_py, sciPENN, and the other entries the task lists, including the 2021 and 2022 competition entries.
- **Protocol**: Train on `train_mod1` and `train_mod2`, predict `test_mod1`, and score against `test_mod2`. The split is `is_train` when present, otherwise a quarter of batches with split seed 1. Test cells are subsampled to 1000 with probability proportional to the square root of inverse cell-type frequency, with one fixed seed for all methods.
- **Acceptance criterion** (proposed; to calibrate after the first evaluation): mean_pearson_per_cell is at least 0.9 times the best of sciPENN, knnr_py and CellMapper with scVI, is at least 0.10 above the mean_per_gene control, and rmse is no higher than the control's.
- **Known pitfalls**: guanlab_dengkw_pm and senkin_tmp are 2021 and 2022 competition submissions, so their scores on this data may overstate performance on a new study. Per-cell means depend on the subsample, so methods are compared only on identical cells.

### B2. Leave-one-study-out protein recovery with interval coverage (proposed)

- **Goal**: Measure how well RNA-only cells from an unseen study recover measured protein, and whether 90 percent intervals cover measured values at the nominal rate.
- **Ground truth**: Orthogonal measurement: each held-out study's measured ADT, normalised as in section 3.1. Annotations only stratify scores.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CITE-seq studies in the singlet catalogue, from the recipe below | singlet catalogue; accessions from catalogue metadata | CITE-seq RNA and ADT; size from step 1 | — | About 40 percent of catalogue cells are annotated |

Recipe:

1. Enumerate studies with RNA and ADT in the same cells, and record each study's protein panel.
2. Hold out whole studies, train on the rest, and predict the held-out study from RNA alone.
3. Remove donors that occur in more than one study, by sample identity where available.
4. Keep only proteins present in every training study; never treat a missing protein as zero.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| mean_pearson_per_cell | As in B1 | maximise | primary | section 12 |
| median_protein_spearman | Median over proteins of the Spearman correlation across held-out cells | maximise | guardrail | — |
| interval_coverage_90 | Fraction of measured $\tilde y_{nt}$ inside the 5th to 95th percentile of posterior predictive draws | 0.85 to 0.95 (proposed) | guardrail | section 3.1 |

- **Comparators**: totalvi with reference mapping, sciPENN, knn and the mean-per-protein control.
- **Protocol**: For each held-out study, seeds 0, 1 and 2; scores are stratified by annotated cell type where annotations exist.
- **Acceptance criterion** (proposed): median_protein_spearman is no lower than the best comparator minus 0.02 on the same study, and interval_coverage_90 lies between 0.85 and 0.95 for at least 80 percent of held-out studies.
- **Known pitfalls**: Coverage from studies with few cells is noisy, so the cell count is reported beside each value. Per-protein Spearman depends on which proteins a study shares, so the protein count is reported with each score.

### B3. Planted-truth calibration (proposed)

- **Goal**: Test whether posterior predictive intervals and the mean recover a known generator, which isolates inference from model specification.
- **Ground truth**: Planted simulation. The label is the simulated measured count transformed as in section 3.1; the planted conditional mean $E[\tilde y_{nt}\mid z_n,s_n]$ is the bias reference.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated RNA and ADT from the recipe below | singlet generator, seeds 0, 1, 2 | simulated; 2,000 genes, 50 proteins | — | Design choices, not literature values |

Recipe:

1. Draw $z_n\sim N(0,I_{20})$: 20,000 training cells in two batches and 5,000 test cells in a third batch with shifted $s_n$.
2. Draw $x_{ng}\sim\mathrm{NB}(l_n\rho_{ng}(z_n,s_n),\theta_g)$ from a fixed random softplus decoder.
3. Draw $\pi_{nt}$, $\beta_{nt}$ and $\alpha_{nt}$ from the section 3.2 priors with fixed coefficients, then $y_{nt}$ from the mixture with fixed $\phi_t$.
4. Compute the planted expectation by Monte Carlo over 1,000 repetitions of step 3; train on the first two batches and score the third.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| interval_coverage_90 | Fraction of measured $\tilde y_{nt}$ inside the 5th to 95th percentile of posterior predictive draws | 0.85 to 0.95 (proposed) | primary | section 3.4 |
| bias_to_planted_mean | Mean of $\hat\mu_{nt}$ minus the planted expectation | within ±0.05 (proposed) | guardrail | — |

- **Comparators**: totalvi with posterior predictive draws; totalvi with parameter draws only, the ablation of section 3.4; knn for the point comparison.
- **Protocol**: Three seeds. Coverage per protein is reported as median and range, with mean interval width.
- **Acceptance criterion** (proposed): coverage lies between 0.85 and 0.95 for every seed, and the parameter-only ablation falls below 0.85. If the ablation does not undercover, the claim of section 3.4 is wrong and must be removed.
- **Known pitfalls**: The generator belongs to the fitted model's family, so B3 tests inference and calibration but not specification, which is B2's role. A wide posterior can reach nominal coverage by accident, so interval width is always reported.

### P1. Performance and scaling

Wall time and peak memory for training and prediction of totalvi (PyTorch on CUDA and on CPU), sciPENN (PyTorch, epoch cap fixed for timing), knn (scikit-learn) and Seurat TransferData (R), at 10^4, 10^5 and 10^6 query cells and at 100 and 200 proteins, on one recorded GPU and CPU configuration. Hold fixed: reference size, `n_latent` 20, `n_hidden` 256, sciPENN batch size 128, the early-stopping rule and `n_samples` 25. Each configuration is repeated with seeds 0, 1 and 2, and median and spread are reported. This document asserts no timings.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `multimodal.adt_background_removal_normalization`: ADT background removal and normalization
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
- **Feeds**:
  - `annotation.marker_based_cell_assignment`: Marker-based cell-level type assignment
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
- **Reads**: `layers/counts`, `layers/normalized`, `obs/batch`, `obs/cell_type`, `obs/is_train`, `uns/normalization_id`, `obsm/X_pca`
- **Writes**: `obsm/adt_pred`, `obsm/adt_pred_sd`, `models/totalvi_adt`, `uns/adt_pred_metrics`
<!-- CHAINING:AUTO:END -->

Follows ADT normalisation and cell calling in the paired CITE-seq sequence and precedes marker-based annotation. Related: `multimodal.paired_joint_embedding`, `multimodal.adt_positivity_calling`.

## 10. Risks, pitfalls and open questions

- **Dataset record.** The accession, licence, species and cell count of the BMMC dataset are not stated in the sources used here, so B1 leaves those cells as dashes. Only the test cap, its sampling rule and the split rule are fixed by the protocol.
- **Secondary claims.** The chapter's statement that totalVI predicts proteins best cites three benchmark papers [R6][R7][R8] and is not used as a threshold. Its median per-protein Spearman of 0.34 comes from one notebook example: a totalVI reference trained on three sites of the bone marrow CITE-seq data, applied to the fourth site as RNA only. It is not used as a threshold either.
- **Route.** sciPENN supplies point predictions only; its quantile head is outside this document's scope.
- **Citation metadata.** The correlation metric configuration attaches a Biometrika DOI (10.1093/biomet/30.1-2.81) to its Spearman metrics. That DOI and the Pearson DOI in the same file are not cited here, and the metrics are defined by their configuration text.
- **Interval validity.** The variational approximation can distort the posterior spread. B3 is the first test of the interval machinery, and its thresholds are untested.
- **Open questions.** Transfer across studies, panels and sites is untested, because the standard task uses one dataset [R10][R11]. Calibration is unmeasured: rank and correlation scores do not test whether intervals contain the measured value, and the benchmarks cited here report no interval coverage. Proteins that RNA reflects weakly are predicted poorly (section 3.3), and the chapter advises using imputed values only for validated proteins [R9]. Target normalisation can reorder methods, and no benchmark here quantifies this effect. The top-scoring entries predict z-scored values and recover level and spread with a per-cell regression; whether this generalises beyond correlation scoring is untested.
- **First experiment.** Fit totalvi and knn on B1 with seed 0, check that lineage markers score above CD274 as section 3.3 predicts, and then evaluate the B3 ablation before B2, because B3 is the cheapest test of the interval machinery.

## 11. References

R1. Stoeckius M, Hafemeister C, Stephenson W, et al. Simultaneous epitope and transcriptome measurement in single cells. *Nature Methods* 2017. doi:10.1038/nmeth.4380 — verified (corpus)
R2. Gayoso A, Steier Z, Lopez R, et al. Joint probabilistic modeling of single-cell multi-omic data with totalVI. *Nature Methods* 2021. doi:10.1038/s41592-020-01050-x — verified (corpus)
R3. Lakkis J, Schroeder A, Su K, et al. A multi-use deep learning method for CITE-seq and single-cell RNA-seq data integration with cell surface protein prediction and imputation. *Nature Machine Intelligence* 2022;4(11):940–952. doi:10.1038/s42256-022-00545-w — verified (corpus)
R4. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R5. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)
R6. Hu Y, Wan S, Luo Y, et al. Benchmarking algorithms for single-cell multi-omics prediction and integration. *Nature Methods* 2024. doi:10.1038/s41592-024-02429-w — verified (corpus)
R7. Fu S, Wang S, Si D, et al. Benchmarking single-cell multi-modal data integrations. *Nature Methods* 2025. doi:10.1038/s41592-025-02737-9 — verified (corpus)
R8. Liu C, Ding S, Kim HJ, et al. Multitask benchmarking of single-cell multimodal omics integration methods. *Nature Methods* 2025. doi:10.1038/s41592-025-02856-3 — verified (corpus)
R9. Single-cell best practices, multimodal integration chapter (`advanced_integration.ipynb`), theislab Jupyter Book, local repository copy. — verified (repo)
R10. Lance C, Luecken MD, Burkhardt DB, et al. Multimodal single cell data integration challenge: results and lessons learned. *bioRxiv* 2022. doi:10.1101/2022.04.11.487796 — verified (corpus)
R11. Luecken MD, Burkhardt DB, Cannoodt R, et al. A sandbox for prediction and integration of DNA, RNA, and proteins in single cells. *NeurIPS 2021 Datasets and Benchmarks Track*, round 2. https://datasets-benchmarks-proceedings.neurips.cc/paper_files/paper/2021/file/158f3069a435b314a80bdcb024f8e422-Paper-round2.pdf — verified (corpus)
R12. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R13. Lotfollahi M, Naghipourfar M, Luecken MD, et al. Mapping single-cell data to reference atlases by transfer learning. *Nature Biotechnology* 2022;40(1):121–130. doi:10.1038/s41587-021-01001-7 — verified (corpus)
R14. Ashuach T, Gabitto MI, Koodli RV, et al. MultiVI: deep generative model for the integration of multimodal data. *Nature Methods* 2023. doi:10.1038/s41592-023-01909-9 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml) | BSD-3-Clause (LICENSE) | totalVI and MultiVI model definitions, commit 5555ecc | port |
| https://github.com/jlakkis/sciPENN | Justin Lakkis (setup.py author; LICENSE.rtf) | MIT (LICENSE.rtf and setup.py; no LICENSE file at the root) | sciPENN network and loss; version 0.9.6 (setup.py) | port |
| https://github.com/satijalab/seurat | Seurat authors (DESCRIPTION) | MIT (DESCRIPTION: MIT + file LICENSE) | TransferData anchor transfer, commit 5f67c70 | callout |
| https://github.com/openproblems-bio/task_predict_modality | Open Problems in Single-Cell Analysis (LICENSE) | MIT | Benchmark definition, metrics, splits and comparators, commit 4d73d31 | callout |
| https://github.com/scikit-learn/scikit-learn | The scikit-learn developers (COPYING) | BSD-3-Clause | kNN regression algorithm used by knnr_py | port |
| https://github.com/openproblems-bio/neurips2021_multimodal_topmethods | Open Problems in Single-Cell Analysis (LICENSE) | MIT | Guanlab-dengkw kernel ridge comparator | callout |
| https://github.com/lueckenlab/senkin-tmp-cite-pred | Vladimir Shitov (pyproject.toml) | MIT | LightGBM and GRU comparator | callout |
| https://github.com/shu65/open-problems-multimodal | Shuji Suzuki (setup.py; LICENSE) | MIT | SS-OPM comparator | callout |
| https://github.com/BioX-NKU/scButterfly | BioX-NKU (setup.py) | MIT | Not applicable to ADT (section 4) | excluded |
