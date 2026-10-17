---
id: perturbation.unseen_gene_response_prediction
title: Unseen single-gene perturbation response prediction
area: perturbation
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [perturbation.guide_assignment, normalization.size_factor_estimation]
feeds: [perturbation.combinatorial_effect_prediction, perturbation.cross_context_transfer]
reads: [layers/counts, obs/perturbation, obs/replicate, varm/gene_emb, uns/gene_graph_go, uns/gene_graph_coexpr]
writes: [uns/pert_pred_mean, uns/pert_pred_interval, uns/pert_scores, uns/pert_split, models/unseen_response]
devices: [cpu, cuda]
mcp_tool: singlet_perturbation_unseen_gene_response_prediction
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Unseen single-gene perturbation response prediction

> Predict the pseudobulk transcriptional change caused by knocking down a gene that has no perturbation in training, and score it against the measured change.

## 1. Question

Given control-cell expression and a target gene with no training perturbation, what expression change would knocking that gene down produce? The inputs are counts with per-cell perturbation labels, the measured profiles of training perturbations, and optional gene embeddings or gene graphs. The output is a predicted mean log-normalised profile for each held-out gene, with an optional predictive interval. A correct answer matches the measured change beyond the shift shared by all perturbations, and its intervals cover the measured change at their nominal rate.

## 2. Why this task matters and where the field stands

Perturb-seq measures the transcriptome after knockdown of designed gene sets, and genome-scale screens have covered more than a thousand genes in each of two cell lines [R1]. Most genes, cell types and contexts are never perturbed. A model that predicts the response to an unseen gene would let candidate knockdowns be ranked before they are performed, and would supply priors for combinatorial designs.

The task is **contested**. In a comparison of held-out single-gene effects, deep models did not consistently beat a training-mean profile or a ridge bilinear model when scored by Pearson correlation of the change on top expressed genes [R2]. Three further benchmarks study the same question [R3][R4][R5]. The reason is systematic variation: a shift shared by all perturbations, such as stress, proliferation or library size, makes control-referenced scores high for a predictor that never models the specific gene, and a constant predictor can score well [R3][R6]. Re-scoring against a perturbed centroid instead of control lowers scores and separates models of perturbation specificity from models of the shared shift [R6].

Open problems:

- Metric validity: control-referenced scores reward the shared shift, and perturbation-specific metrics are not yet standard [R6].
- Ground truth: weak or null knockdowns leave a change close to measurement noise, which limits the correlation any method can reach for those genes.
- Gene priors: whether GO, co-expression or pretrained gene embeddings improve on training-data embeddings is open [R2].
- Distribution-level prediction: most methods predict means, and distribution metrics are under-tested.
- Uncertainty: calibrated predictive intervals are not part of the standard outputs of the methods in section 4.

## 3. Theory and insight

**Estimand.** For gene $g$ and perturbation $p$ with cell set $\mathcal C_p$, the response is the difference between the mean of per-cell log-normalised values in $p$ and in control cells $\mathcal C_0$:

$$\Delta_{pg}=\bar y_{pg}-\bar b_g,\qquad \bar y_{pg}=\frac{1}{|\mathcal C_p|}\sum_{c\in\mathcal C_p}\ell_{cg},\qquad \bar b_g=\frac{1}{|\mathcal C_0|}\sum_{c\in\mathcal C_0}\ell_{cg},\qquad \ell_{cg}=\log\Big(1+\frac{x_{cg}}{s_c}\Big),$$

where $x_{cg}$ is the UMI count and $s_c$ the size factor of cell $c$ on the common library-size scale of the benchmark object. Every predicted profile is $\hat y_{qg}=\bar b_g+\hat\Delta_{qg}$ on this scale. The mean is a first-order quantity in $|\mathcal C_p|$: its sampling variance is about $\sigma_g^2/|\mathcal C_p|$ for independent cells, so the estimate needs many cells per perturbation.

**Notation.**

| Symbol | Meaning |
|---|---|
| $\bar b$ | control mean profile over genes |
| $\bar x_t$ | mean profile of training condition $t$; control is one member of $T$ |
| $\Delta$, $\tilde\Delta$, $\bar\Delta$ | genes by training conditions matrix of changes; its row-centred form; its row means |
| $G$, $P$, $p_q$ | gene embedding (genes by $d$); training perturbation embedding ($d$ by training conditions); embedding of held-out perturbation $q$ |
| $K$ | $d\times d$ interaction matrix |
| $\lambda_A,\lambda_B$ | ridge penalties on the gene and perturbation sides |

**Model families.** Every method predicts the control baseline plus a perturbation-specific change, and differs in how it obtains that change for an unseen gene.

*Training-mean profile.* The prediction is the same for every held-out gene,

$$\hat y_{qg}=\frac{1}{|T|}\sum_{t\in T}\bar x_{tg},$$

so its change from control is one systematic shift for all $q$. Its $r_\Delta$ measures how well that shift matches the measured change, not any gene-specific effect.

*Ridge bilinear model.* The separable closed-form estimate is

$$\hat K=(G^\top G+\lambda_A I)^{-1}\,G^\top\tilde\Delta P^\top\,(PP^\top+\lambda_B I)^{-1},\qquad \hat y_{qg}=\bar b_g+\bar\Delta_g+(G\hat K p_q)_g .$$

It solves the two sides separately rather than the joint Kronecker problem. The fit has $d^2$ parameters whatever the number of genes, which limits overfitting and limits capacity. It holds when the embeddings are fixed in advance, from training-data PCA or an external table, and $d$ is far below the number of genes.

*GEARS.* Gene and perturbation embeddings are propagated over gene graphs by graph layers, and a decoder returns a change per gene. The loss as implemented is a fourth-power error with a sign-agreement term:

$$\mathcal L=\frac{1}{|P|}\sum_p\frac{1}{N_p|\mathcal R_p|}\sum_{g\in\mathcal R_p}(\hat y_{pg}-y_{pg})^4+\frac{\lambda_{\rm dir}}{|P|}\sum_p\frac{1}{N_p|\mathcal R_p|}\sum_{g\in\mathcal R_p}\big(\operatorname{sign}(y_{pg}-c_g)-\operatorname{sign}(\hat y_{pg}-c_g)\big)^2,$$

where $|P|$ is the number of distinct perturbations in the batch, $N_p$ the number of cells of $p$, $\mathcal R_p$ the retained genes and $c_g$ the control expression. A fourth-power term weights large residuals more heavily than squared error, so a few outlier genes may dominate the fit; this is untested here.

*Latent-space models.* scGen predicts a cell type's response by adding the stimulated-minus-control mean latent difference to the control latent and decoding:

$$\hat z_{q,c}=\bar z_{c,\mathrm{ctrl}}+\big(\bar z_{\mathrm{stim}}-\bar z_{\mathrm{ctrl}}\big),\qquad \hat x_{q,c}=\mathrm{Dec}(\hat z_{q,c}).$$

It needs the stimulated condition observed in some cell type, so it does not predict an unseen gene. CPA composes a basal latent with additive perturbation and dose embeddings, and penalises perturbation information in the basal latent with adversarial classifiers. Its design targets compounds and doses, and a gene-level encoder is needed for knockouts [R9].

*Foundation-model arms.* The scGPT arm uses the scGPT perturbation generator, a transformer that takes a perturbation flag beside gene tokens [R10]. Geneformer is applied zero-shot: the control profile is rank-value tokenised, the target gene token is deleted or moved to the front of the ranking (overexpression), the perturbed cell embedding is extracted, and a ridge regression maps embeddings to expression [R11]. It applies only to genes in the model vocabulary.

**Why a model-based formulation.** The bilinear prediction is linear in $\mathrm{vec}(K)$, so a Gaussian prior $\mathrm{vec}(K)\sim\mathcal N(0,\tau^2 I)$ gives a Gaussian posterior in closed form. With $a_{qg}=p_q^\top\otimes G_g$, the predictive variance of gene $g$ for held-out $q$ is $a_{qg}\Sigma_K a_{qg}^\top+\sigma_g^2/|\mathcal C_q|$: the posterior variance of the prediction plus the sampling variance of the measured change. This follows from the linear form and is a derivation, not a published result. The same posterior gives intervals that heuristic baselines do not provide, and a fitted $K$ is reused for any gene whose embedding is known. The regime is Gaussian errors on the log scale and large $|\mathcal C_q|$.

**Metrics.** For each held-out $q$:

- $r_\Delta(q)$ is the Pearson correlation, over the top 1000 control-expressed genes, of $\hat y_q-\bar b$ against $y_q-\bar b$. It is unchanged by a shift or positive scaling of either vector.
- $\mathrm{L2}(q)=\big(\sum_{g\in\mathcal R_q}(\hat y_{qg}-y_{qg})^2\big)^{1/2}$ over retained genes, in log units. It is sensitive to the shared shift.
- Energy distance between predicted and observed cell distributions, in a PCA space fitted on control cells, is $D_E=2\,\mathbb E\|X-Y\|-\mathbb E\|X-X'\|-\mathbb E\|Y-Y'\|$. It is zero when the distributions are equal, and its sample estimate costs $O(n^2)$ pair distances [R12].

**Pitfalls the benchmarks identify.** Systematic variation rewards the training-mean profile [R3][R6]. The top-1000 control-expressed filter selects housekeeping and ribosomal variation rather than specific effects, so $r_\Delta$ on it is not a differential-expression score. Ridge shrinks effects toward the mean for genes poorly represented in the embedding, by construction. Leakage from gene priors or pretraining data could inflate scores, and its size is unassessed.

**What the benchmarks imply.** Any new model must be reported against the training-mean profile and the linear model, under control-referenced and centroid-referenced metrics [R2][R6].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Training-mean profile | heuristic | one averaged profile over training conditions, given to every held-out gene | [R2] |
| Ridge bilinear model | model-based | separable closed-form ridge on gene and perturbation embeddings | [R2] |
| GEARS | model-based | learned gene and perturbation embeddings propagated over GO and co-expression graphs | [R7] |
| scGen | model-based | VAE latent arithmetic on the stimulated-minus-control mean; needs the condition observed | [R8] |
| CPA | model-based | conditional autoencoder with additive perturbation latents and adversarial penalties | [R9] |
| scGPT perturbation generator | model-based | pretrained transformer generator with a perturbation-flag encoder | [R10] |
| Geneformer in silico deletion or overexpression | hybrid | zero-shot perturbation of the rank-value input, embedding read out by ridge | [R11] |

The training-mean profile and the ridge bilinear model are the published standard against which deep models were measured [R2]. GEARS, CPA, scGen and scGPT are the model-based arms, and Geneformer is the zero-shot arm. The training-mean profile is kept as the mandatory comparator in every benchmark. scGen is not implemented here.

Defaults for the implemented methods and comparators, from the source code of the benchmark repository and the arm repositories (section 12). Paths are relative to the benchmark repository unless a repository is named.

| Method | Parameter | Value | Source |
|---|---|---|---|
| Training mean | training set | all training conditions, control included | benchmark/src/run_mean_prediction.R @ bfa6eee |
| Ridge bilinear | pca_dim | 10 | benchmark/src/run_linear_pretrained_model.R:8 @ bfa6eee |
| Ridge bilinear | ridge penalty, both sides | 0.1 | run_linear_pretrained_model.R:9 and :151 @ bfa6eee |
| Ridge bilinear | solver default, overridden by the script | 0.01 | run_linear_pretrained_model.R:33 @ bfa6eee |
| Ridge bilinear | gene and perturbation embeddings | training data (PCA) | run_linear_pretrained_model.R:12-13 @ bfa6eee |
| GEARS | hidden size | 64 | gears/gears.py:122 @ f374e43; benchmark passes 64 at benchmark/src/run_gears.py:65 @ bfa6eee |
| GEARS | decoder hidden size | 16 | gears/gears.py:125 @ f374e43 |
| GEARS | neighbours per gene, GO and co-expression graphs | 20 and 20 | gears/gears.py:126-127 @ f374e43 |
| GEARS | co-expression threshold | 0.4 | gears/gears.py:128 @ f374e43 |
| GEARS | direction loss weight | 0.1 | gears/gears.py:131 @ f374e43; the docstring at :119 gives 1 |
| GEARS | epochs, learning rate, weight decay | 20, 1e-3, 5e-4 | gears/gears.py:478-480 @ f374e43; epochs at run_gears.py:13 |
| CPA | loss_ae | gauss (negative binomial optional) | CPA predecessor, cpa/model.py:141 @ 50e283a |
| CPA | adversarial regularisation and penalty | 60 and 60 | cpa/model.py:302-303 @ 50e283a |
| CPA | autoencoder, adversary and step-size learning rates | 3e-4, 3e-4, 45 | cpa/model.py:304-310 @ 50e283a |
| scGPT | maximum input length | 1536 | benchmark/src/run_scgpt.py:92 @ bfa6eee |
| Geneformer | perturbation type; readout | delete or overexpress; ridge with intercept | run_geneformer.py:17; :283-290 @ bfa6eee |

## 5. Proposed singlet approach

**Routes.** The training-mean profile is reimplemented, since it is an average and no code is taken. The ridge bilinear model and GEARS are ported. CPA, scGPT and Geneformer are callouts, used as comparators in section 8 only. scGen is not implemented.

**Proposed model.** The bilinear model of section 3, with the Gaussian prior $\mathrm{vec}(K)\sim\mathcal N(0,\tau^2 I)$. The prior scale $\tau$ is set by maximising the marginal likelihood on training perturbations. The posterior is closed form and gives per-gene intervals at the level `interval_level`. Two proposed falsifiers apply on B1. If the posterior mean does not beat the training-mean profile on $r_\Delta$ on at least three of four datasets, the linear-embedding premise fails. If nominal 90% intervals do not cover measured held-out changes at a pooled rate between 0.85 and 0.95, the noise model is wrong.

**Embeddings.** The default $G$ is training-data PCA with $d=10$. Training perturbation embeddings are the projection of the centred change matrix onto $G$, which differs from the benchmark's PCA of training profiles (section 10). For a held-out gene, $p_q$ is the target gene's row of $G$, so its effect is read in the same space as the gene's own response pattern. An external embedding replaces $G$ and must cover every gene of the dataset.

**GEARS.** Ported with the loss of section 3 as implemented and the defaults of section 4. Its training cells are held in memory, so streaming applies to pseudobulk accumulation and to the two linear methods only.

**Kernels and stack.** Pseudobulk sums are accumulated over cells in one streamed pass with sparse-dense products. Truncated PCA gives the embeddings. The linear model needs two $d\times d$ solves, two products of genes by perturbations, and the posterior covariance, which is $d^2\times d^2$ (100 by 100 at $d=10$). On CUDA these are hard-coded kernels using cuSPARSE and cuBLAS; on CPU they are Cholesky solves in double precision. GEARS stays in PyTorch. Device `auto` selects CUDA when the pseudobulk matrix fits in device memory.

**Defaults used without asking.** `method` bilinear_ridge, `pca_dim` 10, `ridge_penalty` 0.1, `interval_level` 0.9, `layer` counts, `control_label` ctrl, `seed` 0. Scored calls also report the training-mean profile on the same targets.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, size-factor normalised per cell |
| read | obs/perturbation | string | target gene per cell; `control_label` marks controls |
| read | obs/replicate | string (optional) | replicate key for pseudobulk; cells pooled when absent |
| read | varm/gene_emb | float32, genes by d (optional) | external gene embedding |
| read | uns/gene_graph_go | sparse (optional) | GO similarity prior for GEARS |
| read | uns/gene_graph_coexpr | sparse (optional) | co-expression prior from training cells only |
| write | uns/pert_pred_mean | float32, genes by targets | predicted mean log-normalised profile |
| write | uns/pert_pred_interval | float32, genes by targets by 2 | lower and upper bounds; bilinear_ridge only |
| write | uns/pert_scores | table | per target: $r_\Delta$, Pearson $r$ and L2 when measured profiles exist |
| write | uns/pert_split | table | training or target label per perturbation, with seed |
| write | models/unseen_response | object | fitted $K$ and embedding identifiers, or GEARS checkpoint |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "counts" | — | Layer to pseudobulk; cells are size-factor normalised and log1p transformed before averaging. |
| `method` | string | "bilinear_ridge" | `bilinear_ridge`, `training_mean`, `gears` | Prediction method; training_mean is the perturbation-agnostic comparator. |
| `targets` | array | required | — | Held-out perturbation labels to predict; excluded from training. Labels with measured profiles are also scored. |
| `control_label` | string | "ctrl" | — | Value of obs/perturbation that marks control cells. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for gears training; the linear methods are deterministic given their inputs. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `bilinear_ridge` | object | — | — | Options for method bilinear_ridge. |
| `bilinear_ridge.pca_dim` | integer | 10 | min 1 | Dimension of training-data PCA gene and perturbation embeddings. |
| `bilinear_ridge.ridge_penalty` | number | 0.1 | min 0 | Ridge penalty applied on both sides of the bilinear solve. |
| `bilinear_ridge.gene_embedding` | string | "training_data" | — | training_data, or a path to an external gene embedding table. |
| `bilinear_ridge.interval_level` | number | 0.9 | min 0; max 1 | Posterior predictive interval level; 0 disables intervals. |
| `gears` | object | — | — | Options for method gears. |
| `gears.hidden_size` | integer | 64 | min 1 | Hidden dimension of gene and perturbation embeddings. |
| `gears.epochs` | integer | 20 | min 1 | Training epochs. |
| `gears.lr` | number | 0.001 | > 0 | Adam learning rate. |
| `gears.direction_lambda` | number | 0.1 | min 0 | Weight of the sign-agreement (direction) loss. |
| `gears.coexpress_threshold` | number | 0.4 | min 0; max 1 | Correlation threshold for the co-expression graph. |
<!-- PARAMS:AUTO:END -->

Parameter rules. `bilinear_ridge` options apply only when `method` is bilinear_ridge, `gears` options only when it is gears, and `interval_level` only to bilinear_ridge. `seed` affects only gears; the linear methods are deterministic given their inputs. Targets are removed from the training set before any fit, and a target absent from `obs/perturbation` is an error. An external `gene_embedding` must cover the dataset's genes, or the call fails rather than falling back to training-data PCA. With `dry_run`, the estimate uses the cell, gene and target counts and the chosen method.

## 7. MCP tool

Tool name `singlet_perturbation_unseen_gene_response_prediction` (definition in `tasks/mcp/singlet_perturbation_unseen_gene_response_prediction.json`).

```json
{"dataset": "example.singlet", "targets": ["GENE_X"], "control_label": "non-targeting", "method": "bilinear_ridge"}
```

```json
{"dataset": "example.singlet", "status": "completed",
 "wrote": ["uns/pert_pred_mean", "uns/pert_pred_interval", "uns/pert_scores", "uns/pert_split", "models/unseen_response"],
 "summary": {"method": "bilinear_ridge", "n_targets": 1, "n_scored": 0},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: `gears` may return `queued` with a `job_id`; the linear methods complete inline. Stochastic: only `gears` depends on `seed`. Dry run: returns `estimate` with seconds, peak memory and device for the chosen method.

## 8. Benchmarks

**Shared protocol.** All benchmarks score pseudobulk means on the log-normalised scale of the same processed object, with one gene set shared by all methods; genes that are missing for any method are dropped before scoring. Training includes control cells. Held-out perturbations are single-gene targets, and metrics are averaged over held-out perturbations within each seed. Paired per-perturbation values are compared with the training-mean profile and with the best linear comparator.

### B1. Held-out single-gene mean-profile prediction

- **Goal**: rank methods by how well they predict the measured change of held-out single-gene perturbations, under GEARS-style simulation splits.
- **Ground truth**: orthogonal measurement. For held-out $q$ the label is $y_q-\bar b$, where $y_{qg}$ is the mean of $\ell_{cg}$ over the cells of $q$ and $\bar b$ is the control mean (section 3); both use the log-normalised scale of the processed object.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Adamson 2016, UPR screen (CRISPRi Perturb-seq) | [R13]; Harvard Dataverse file 6154417, https://dataverse.harvard.edu/api/access/datafile/6154417 | scRNA-seq, human K562; — genes, — cells, — perturbations | single-gene perturbations only |
| Replogle 2022, essential genes, K562 (CRISPRi) | [R1]; file 7458695, https://dataverse.harvard.edu/api/access/datafile/7458695 | scRNA-seq, human K562; — genes, — cells, — perturbations | filtered release file (per the GEARS data loader) |
| Replogle 2022, essential genes, RPE1 (CRISPRi) | [R1]; file 7458694, https://dataverse.harvard.edu/api/access/datafile/7458694 | scRNA-seq, human RPE1; — genes, — cells, — perturbations | filtered release file (per the GEARS data loader); same protocol in a second cell line |
| Norman 2019 (combinatorial CRISPRa) | [R14]; file 6154020, https://dataverse.harvard.edu/api/access/datafile/6154020 | scRNA-seq, human K562; 19,264 genes, — cells, — perturbations | double perturbations removed from training when singles are tested |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pearson delta $r_\Delta$ | correlation over the top 1000 genes by control mean (ties by gene order) of $\hat y_q-\bar b$ against $y_q-\bar b$ | maximise, −1 to 1 | primary | [R2] |
| Pearson $r$ | correlation over the same genes of $\hat y_q$ against $y_q$ | maximise, −1 to 1 | guardrail | [R2] |
| L2 | $\big(\sum_g(\hat y_{qg}-y_{qg})^2\big)^{1/2}$ over retained genes, log units | minimise, 0 or more | guardrail | [R2] |

- **Comparators**: training-mean profile; ridge bilinear model with training-data PCA (pca_dim 10, ridge penalty 0.1); GEARS (hidden size 64, 20 epochs); scGPT; CPA. Versions are the commits in section 4.
- **Protocol**: simulation splits from the benchmark's split routine; seeds 1 and 2 for the single-gene datasets; 20 training epochs and hidden size 64 for the deep methods.
- **Acceptance criterion** (proposed, not from the literature): a method is competitive if its mean $r_\Delta$ is within 0.02 of the best linear comparator on at least three of four datasets. It outperforms only if it exceeds that comparator by at least 0.05 mean $r_\Delta$, with a one-sided paired Wilcoxon test over held-out perturbations at $p<0.05$ on at least three of four datasets. A method that does not exceed the training-mean profile on $r_\Delta$ is reported as such.
- **Known pitfalls**: (1) the training-mean profile can score high on $r_\Delta$ by recovering the shared shift, so it is always reported; (2) dropping missing genes per method changes the gene set, so the common set is fixed before scoring.

### B2. Perturbed-centroid re-scoring of B1 predictions (proposed)

- **Goal**: test whether a predicted profile is closer to its own measured response than to other held-out responses, and whether it captures effects beyond the shared shift. The centroid reference follows the perturbed-centroid framework [R6].
- **Ground truth**: orthogonal measurement, the same measured profiles as B1. The reference centroid is $\bar c=\frac{1}{|\mathcal P_T|}\sum_{p\in\mathcal P_T}\bar y_p$, the mean of the mean profiles of the training perturbations (control excluded), so no held-out data enter it. All quantities use the log scale of section 3.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| The four B1 datasets | as in B1 | as in B1 | no new data; predictions from B1 are reused |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Centroid accuracy | fraction of held-out $q$ whose $\hat y_q$ is nearest, by Euclidean distance over the top 1000 genes, to $y_q$ among all held-out measured profiles (ties by index) | maximise, 0 to 1 | primary | [R6] |
| PDelta20 | Pearson correlation of $\hat y_q-\bar b$ against $y_q-\bar b$ over the 20 genes with largest $\lvert y_q-\bar b\rvert$, selected on observed data and shared by all methods | maximise, −1 to 1 | primary | [R6] |
| Shift cosine | cosine between $y_q-\bar b$ and the mean training shift $\bar c-\bar b$; high values indicate systematic variation | minimise, diagnostic | guardrail | [R6] |

- **Comparators**: as in B1.
- **Protocol**: no new fits. Control-referenced and centroid-referenced $r_\Delta$ are reported side by side. The candidate set for centroid accuracy is the held-out profiles of the same dataset and seed, and is stated with each score.
- **Acceptance criterion** (proposed): a model shows perturbation-specific skill if its centroid accuracy exceeds that of the training-mean profile by at least 0.10 on at least two of four datasets, and its PDelta20 is positive on the same datasets. The thresholds are proposed, not from the literature.
- **Known pitfalls**: (1) a centroid set that changes with the split changes the score, so it is fixed per dataset and seed; (2) centroid accuracy depends on the distance, which is fixed here as Euclidean over 1000 genes.

### B3. Planted-effect simulation (proposed)

- **Goal**: test whether a method recovers a planted knockdown effect when the truth is known exactly and measurement noise, escapers and batch effects are absent.
- **Ground truth**: planted simulation. A generator recipe produces, for each target $t$, a planted mean vector $\mu^{(t)}$ on the log1p scale of size-normalised counts with size factor one.
  1. Fit a negative-binomial model, with per-gene mean and dispersion, to the control cells of one B1 dataset [R15].
  2. Sample a sparse directed weight matrix $W$ over the genes, recording its density and seed.
  3. For each target $t$, plant the log-mean change $\alpha\,W e_t$ on the control means, where $\alpha$ is a planted scale, and multiply the target's own mean by $1-k_t$.
  4. Set $\mu^{(t)}$ to the resulting means (noise-free variant), or draw counts from the negative-binomial with those means (noisy variant).
  5. Hold out a set of targets, train on the other targets' planted profiles, and score the held-out targets against $\mu^{(t)}$.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Simulated control population and planted network | generator recipe, steps 1 to 5 | simulated; gene and cell counts matched to the B1 dataset of the fit | generator seed and density recorded |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pearson delta on planted profile | $r_\Delta$ as in B1, with $\mu^{(t)}-\bar b$ as truth, over all planted-responsive genes | maximise, −1 to 1 | primary | [R2] |
| AUROC of downstream genes | area under the ROC curve ranking genes by $\lvert\hat y_{tg}-\bar b_g\rvert$, with downstream genes defined as those with a nonzero planted change | maximise, 0 to 1 | guardrail | — |

- **Comparators**: training-mean profile; ridge bilinear model; GEARS.
- **Protocol**: generator seeds and network densities as factors. The same held-out targets are used for every method, and results are reported per seed.
- **Acceptance criterion** (proposed): in the noise-free setting a method must reach a mean planted Pearson delta of at least 0.8 before use on real data, and it must beat the training-mean profile by at least 0.2.
- **Known pitfalls**: (1) circularity: if gene embeddings are derived from $W$, the task is trivially solvable, so embeddings must come from a separate draw; (2) planted effects are easier than real data, so this is a sanity check only.

### P1. Performance and scaling

- **Measures**: wall time, peak memory and targets per second for each method at 10k, 100k and 1M cells, and at 10M cells for the linear methods, on CPU and CUDA.
- **Inputs**: catalogue subsamples with gene sets matched to the B1 datasets. The split, seed, 20 epochs and hidden size 64 are held fixed.
- **Comparators**: training-mean profile, ridge bilinear model, GEARS.
- **Expectation**: after pseudobulk accumulation, the linear methods' memory should scale with genes times perturbations rather than with cells. The figures test this.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `perturbation.guide_assignment`: Per-cell guide and perturbation assignment
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Feeds**:
  - `perturbation.combinatorial_effect_prediction`: Unseen double-perturbation transcriptome prediction
  - `perturbation.cross_context_transfer`: Perturbation response transfer to unseen cell types or contexts
- **Reads**: `layers/counts`, `obs/perturbation`, `obs/replicate`, `varm/gene_emb`, `uns/gene_graph_go`, `uns/gene_graph_coexpr`
- **Writes**: `uns/pert_pred_mean`, `uns/pert_pred_interval`, `uns/pert_scores`, `uns/pert_split`, `models/unseen_response`
<!-- CHAINING:AUTO:END -->

Belongs to the single-gene perturbation workflow, after guide assignment and before combinatorial and cross-context prediction.

## 10. Risks, pitfalls and open questions

- Systema's ten datasets and the distance used for its centroid accuracy were not identified, so B2 applies the reference to the B1 datasets with the definitions given there.
- The benchmark's `training_data` setting computes the training perturbation embedding by PCA of the training profiles (run_linear_pretrained_model.R:115-118), while extract_pert_embedding_pca.R computes one over all conditions of the dataset. The code does not settle which source gives a held-out target its embedding. The embedding in section 5 is singlet's own and must be checked against the comparator on B1.
- The GEARS year is recorded as 2023 here, the online year; the print issue year was not checked.
- The GEARS loss stated in the paper was not checked, so section 3 gives the implemented loss. The code's direction-loss default (0.1) differs from its docstring (1).
- The Geneformer package and model repository were not identified. The benchmark imports the `geneformer` package (run_geneformer.py:95).
- The maintained CPA successor's defaults were not checked, so the CPA values in section 4 come from its predecessor.
- The benchmark's resource supplement and the UCE, scBERT and scFoundation arms were not checked, so they are not comparators here.
- Benchmark studies [R3][R4][R5] enter only through secondary summaries.
- The catalogue's inventory of perturbational datasets with gene-level labels has not been checked against training needs.
- The energy-distance formula is the standard one; its attribution to scPerturb [R12] was not checked against that paper's text.
- The B1 cell and perturbation counts were not checked against the processed objects, so they are left as —.
- First experiment: B1 on the Adamson dataset (single perturbations), comparing the training-mean profile with the bilinear ridge model and checking the coverage of the Gaussian intervals in section 5, before GEARS is trained on any dataset.

## 11. References

R1. Replogle JM, Saunders RA, Pogson AN, et al. Mapping information-rich genotype-phenotype landscapes with genome-scale Perturb-seq. *Cell* 2022. doi:10.1016/j.cell.2022.05.013 — verified (corpus)
R2. Ahlmann-Eltze C, Huber W, Anders S. Deep-learning-based gene perturbation effect prediction does not yet outperform simple linear baselines. *Nature Methods* 2025. doi:10.1038/s41592-025-02772-6 — verified (corpus)
R3. Csendes G, Sanz G, Szalay KZ, Szalai B. Benchmarking foundation cell models for post-perturbation RNA-seq prediction. *BMC Genomics* 2025. doi:10.1186/s12864-025-11600-2 — verified (corpus)
R4. Kernfeld E, Yang Y, Weinstock JS, Battle A, Cahan P. A comparison of computational methods for expression forecasting. *Genome Biology* 2025. doi:10.1186/s13059-025-03840-y — verified (corpus)
R5. Wei Z, Wang Y, Gao Y, et al. Benchmarking algorithms for generalizable single-cell perturbation response prediction. *Nature Methods* 2026. doi:10.1038/s41592-025-02980-0 — verified (corpus)
R6. Viñas Torné R, Wiatrak M, Piran Z, et al. Systema: a framework for evaluating genetic perturbation response prediction beyond systematic variation. *Nature Biotechnology* 2026. doi:10.1038/s41587-025-02777-8 — verified (corpus)
R7. Roohani Y, Huang K, Leskovec J. Predicting transcriptional outcomes of novel multigene perturbations with GEARS. *Nature Biotechnology* 2023. doi:10.1038/s41587-023-01905-6 — verified (corpus)
R8. Lotfollahi M, Wolf FA, Theis FJ. scGen predicts single-cell perturbation responses. *Nature Methods* 2019. doi:10.1038/s41592-019-0494-8 — verified (corpus)
R9. Lotfollahi M, et al. Predicting cellular responses to complex perturbations in high-throughput screens. *Molecular Systems Biology* 2023. doi:10.15252/msb.202211517 — verified (corpus)
R10. Cui H, et al. scGPT: toward building a foundation model for single-cell multi-omics using generative AI. *Nature Methods* 2024. doi:10.1038/s41592-024-02201-0 — verified (corpus)
R11. Theodoris CV, Xiao L, Chopra A, et al. Transfer learning enables predictions in network biology. *Nature* 618:616–624 (2023). doi:10.1038/s41586-023-06139-9 — verified (search)
R12. Peidli S, Green TD, Shen C, et al. scPerturb: harmonized single-cell perturbation data. *Nature Methods* 2024. doi:10.1038/s41592-023-02144-y — verified (corpus)
R13. Adamson B, Norman TM, Jost M, et al. A multiplexed single-cell CRISPR screening platform enables systematic dissection of the unfolded protein response. *Cell* 2016. doi:10.1016/j.cell.2016.11.048 — verified (corpus)
R14. Norman TM, et al. Exploring genetic interaction manifolds constructed from rich single-cell phenotypes. *Science* 365:786–793 (2019). doi:10.1126/science.aax4438 — verified (search)
R15. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/const-ae/linear_perturbation_prediction-Paper | Constantin Ahlmann-Eltze (README, LICENSE) | MIT (LICENSE.md) | benchmark scripts: training mean, ridge bilinear model, scGPT and Geneformer arms | port (ridge); reimplement (mean); callout (scGPT, Geneformer) |
| https://github.com/snap-stanford/GEARS | Yusuf Roohani, Kexin Huang, Jure Leskovec (setup.py, LICENSE) | MIT (LICENSE; setup.py) | graph neural network arm and comparator | port |
| https://github.com/theislab/scgen | Mohammad Lotfollahi (pyproject.toml) | GPL-3.0 (LICENSE file); MIT (pyproject.toml) | latent arithmetic; not implemented | reimplement (deferred) |
| https://github.com/theislab/cpa | Mohammad Lotfollahi (LICENSE copyright); Mohsen Naghipourfar (pyproject.toml author) | BSD-3-Clause (LICENSE); MIT (pyproject.toml) | CPA comparator | callout |
| https://github.com/facebookresearch/CPA | — | MIT | predecessor source of the CPA defaults in section 4; no longer maintained | callout (defaults only) |
| https://github.com/bowang-lab/scGPT | pyproject.toml author field "Haotian"; LICENSE copyright holder "suber" | MIT (LICENSE; pyproject.toml) | fine-tuning comparator | callout |
