---
id: integration.batch_corrected_embedding
title: Batch-corrected joint embedding
area: integration
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [feature-selection.highly_variable_gene_selection, dim-reduction.normalized_cell_embedding]
feeds: [integration.integration_quality_scoring, evaluation.overcorrection_detection, clustering.cell_partitioning, annotation.reference_label_transfer]
reads: [layers/counts, layers/log1p_norm, var/highly_variable, var/hvg_rank, obs/<batch_key>, obs/<scvi.label_key>, obsm/X_pca]
writes: [obsm/X_integrated_<method>, obsp/bbknn_connectivities, obsp/bbknn_distances, layers/integrated_expr, models/integration_<method>, uns/neighbors_bbknn, uns/integration_<method>_params]
devices: [cpu, cuda]
mcp_tool: singlet_integration_batch_corrected_embedding
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Batch-corrected joint embedding

> Place cells from several batches in one shared embedding or batch-balanced graph in which batch no longer organises the cells while cell-type structure is kept, with the published heuristic corrections as comparators and a conditional generative model as the proposed model-based option.

## 1. Question

Given cells from $B \ge 2$ batches (donors, studies or protocols) with a batch label, and either raw UMI counts or log-normalised expression on a highly variable gene subset, which representation stops batch from deciding a cell's neighbours while cells of the same type from different batches stay together and different types stay apart? The output is a corrected embedding $z_c \in \mathbb{R}^d$ per cell, a batch-balanced neighbour graph, or corrected expression on the gene subset, written for neighbour search, clustering and visualisation. In the benchmark literature a correct answer has high batch mixing and preserved cell-type separation relative to the uncorrected representation, scored with the scIB metric family [R1] against expert cell-type labels and observed batch labels.

## 2. Why this task matters and where the field stands

Pooled analyses of several donors, studies or protocols inherit their technical differences: without correction, clusters, annotations and differential expression partly reflect batch rather than biology. Integration produces the shared representation that clustering, annotation and reference mapping read (section 9); the principles and challenges are reviewed in [R2]. It is needed whenever more than one batch is analysed together, the normal case for atlas-scale data.

The status is **contested**. Methods disagree on what is shared across batches. Linear corrections assume batch is a near-linear shift: Harmony [R3] in PCA space and ComBat [R4] on genes. Mutual-neighbour and anchor methods assume matched cells represent the same state: fastMNN [R5], Seurat CCA anchors [R6, R7] and RPCA [R8], and Scanorama [R9]. BBKNN [R10] balances only the graph. Factor and generative models place batch in a shared factor or covariate: LIGER [R11], scVI [R12] and scANVI [R13].

Evaluation has two families: batch removal (kBET [R14], batch LISI, batch silhouette, principal component regression) and biological conservation (label silhouette, cell-type LISI, isolated-label scores, clustering agreement). The scIB study [R1] scored methods on 13 atlas-level integration tasks with a combined score; its best performers on complex tasks were scANVI, Scanorama, scVI and scGen. Benchmarks on tasks with few batches or low biological complexity found Seurat and Harmony performing well [R15, R16, R17], so the ranking depends on task complexity.

Open problems: where to set the balance between over-correction (distinct types merged) and under-correction (batch-separated clusters remain), since metrics disagree about it; scoring graph-only outputs with embedding metrics; circular scoring of label-aware methods; and the lack of uncertainty from heuristic point embeddings. Correction is not always needed and can mask biological variation [R17].

## 3. Theory and insight

**Working model.** Cell $c$ in batch $b(c)$ has biological state $t(c)$ and library size $\ell_c$. The working model is multiplicative, $\mathbb{E}[x_{gc}]=\ell_c\,\mu_g(t(c))\,\beta_{g,b(c)}$, with $\mu_g(t)$ the profile of state $t$ and $\beta_{g,b}$ the batch effect. It holds when a batch acts as one gene-wise factor on every state it contains, and fails when the effect depends on state. Integration seeks $z_c$ that depends on $t(c)$ and not on $b(c)$.

**Estimands.** Outputs are (i) $z_c \in \mathbb{R}^d$, whose coordinates are arbitrary, so only distances and neighbourhoods carry meaning; (ii) a symmetric connectivity matrix $A \in \mathbb{R}_{\ge 0}^{N\times N}$ on corrected neighbourhoods; (iii) corrected log-normalised expression on the $G$ selected genes. Ground-truth quantities are the observed batch label $b(c)$ and the type label $t(c)$ (expert annotation, or planted in simulation); every metric of section 8 lies in $[0,1]$, higher better.

**Harmony [R3].** On L2-normalised PCs $z_c$ it minimises over soft assignments $R_{ck}$ to $K$ centroids $y_k$

$$
J=\sum_{c,k}R_{ck}\,d_{ck}+\sum_{c,k}\sigma_k R_{ck}\log R_{ck}+\sum_{k}\sigma_k\sum_{b}\theta_b\,O_{bk}\log\frac{O_{bk}+E_{bk}+1}{2E_{bk}+1},\qquad d_{ck}=2(1-y_k^{\top}z_c),
$$

where $O_{bk}=\sum_c\Phi_{bc}R_{ck}$ is the soft count of batch $b$ in cluster $k$, $\Phi$ the batch indicator matrix and $E_{bk}$ its expectation under the global batch proportions; $\theta_b$ is the diversity penalty (not a dispersion). A second step fits, per cluster, a ridge regression of $z$ on $\Phi$ with penalty $\lambda=\alpha E_{bk}$ when unset and subtracts the batch-explained part weighted by $R_{ck}$. The steps alternate by block coordinate descent until the objective change falls below a tolerance or the iteration cap, reaching an initialisation-dependent local optimum. The method is valid when batch is approximately a shift inside each soft cluster and clusters contain cells of several batches; a type present in one batch is pulled toward unrelated clusters.

**Mutual pairs, anchors and kernel-smoothed correction (fastMNN [R5], Seurat [R6, R7, R8], Scanorama [R9]).** Cells $a\in X$ and $b\in Y$ form a mutual pair when $b\in N_k^{Y}(a)$ and $a\in N_k^{X}(b)$. Each cell moves by a weighted average of the pair vectors,

$$
\tilde z_c=z_c+\frac{\sum_{(a,b)}w_{ca}\,(z_b-z_a)}{\sum_{(a,b)}w_{ca}} .
$$

fastMNN works in a joint PCA, removes variation along the average batch vector first, and uses tricube weights on the nearest pair-participating cells. Scanorama matches in a reduced SVD space and uses a Gaussian kernel $w_{ca}=\exp(-\tfrac{\sigma}{2}\lVert z_c-z_a\rVert^2)$, so a larger `sigma` narrows the kernel. Seurat finds anchors in a CCA or reciprocal-PCA space, optionally filters them by neighbourhood in L2-normalised expression, scores them, and weights each cell's nearest anchors by $w_{ja}=1-\exp(-d'_{ja}s_a\,sd^2/4)$ normalised over anchors, with $d'_{ja}=1-d_{ja}/d_{j,(k_{weight})}$ and $s_a$ the anchor score. Seurat v5 `IntegrateLayers` applies the correction to the PCA embedding; v3 and v4 `IntegrateData` apply it to expression. Valid when every shared population contributes pairs in each merged batch pair; a population present in one batch is matched to unrelated cells.

**ComBat [R4].** For gene $g$ and cell $j$ of batch $i$, $Y_{ijg}=\alpha_g+X_{ij}^{\top}\beta_g+\gamma_{ig}+\delta_{ig}\varepsilon_{ijg}$. Empirical-Bayes shrinkage with priors pooled across genes estimates the shift $\gamma_{ig}$ and scale $\delta_{ig}$, and the corrected value is $Y^{*}_{ijg}=(Y_{ijg}-\hat\alpha_g-X_{ij}^{\top}\hat\beta_g-\hat\gamma^{*}_{ig})/\hat\delta^{*}_{ig}+\hat\alpha_g+X_{ij}^{\top}\hat\beta_g$. It is valid for location-scale batch effects with roughly Gaussian residuals and enough cells per batch to estimate the priors. Without covariates in an unbalanced design it removes biology.

**BBKNN [R10].** No coordinates change: each cell takes its $k_b$ nearest neighbours in every batch, $N(c)=\bigcup_{b}\mathrm{kNN}_b(c;k_b)$, and the symmetric connectivity matrix is trimmed per row. It is valid when the input PCs already align shared types.

**LIGER [R11].** Integrative non-negative matrix factorisation splits each gene-by-cell matrix $E_i$ into shared metagenes $W$, dataset-specific $V_i$ and loadings $H_i$ (factors by cells),

$$
\min_{W,V_i,H_i\ge 0}\ \sum_i\lVert E_i-(W+V_i)H_i\rVert_F^2+\lambda\sum_i\lVert V_iH_i\rVert_F^2 ,
$$

by alternating non-negative least squares from a random start. The embedding comes from quantile alignment: cells are clustered in a shared-factor neighbourhood graph and each factor is quantile-normalised per dataset and cluster toward a reference dataset. It is valid when states are non-negative sums of shared and dataset-specific programmes; a weak $\lambda$ lets $V_i$ absorb biology.

**Conditional VAE (scVI [R12, R18], scANVI [R13]).** A latent $z_c\sim\mathcal N(0,I)$ generates counts $x_{gc}\sim\mathrm{ZINB}(\ell_c\rho_{gc},\theta_g,\pi_{gc})$ with $\rho_{c}=\mathrm{softmax}(f_w(z_c,s_c))$ and batch covariate $s_c$ injected in every decoder layer. In scvi-tools defaults $\ell_c$ is the observed total count and the encoder does not receive $s_c$, so batch variation is explained by the decoder instead of being encoded in $z_c$. The bound is $\mathbb{E}_{q_\phi(z\mid x)}[\log p_\theta(x\mid z,s,\ell)]-\mathrm{KL}(q_\phi(z\mid x)\,\Vert\,\mathcal N(0,I))$, plus a library-size KL term when $\ell$ is learned, and the embedding is the posterior mean of $z_c$. Nothing forces $z$ to be independent of batch; invariance holds only when batch variation passes through the decoder covariate path. The likelihood is defined on raw counts, so log-normalised input is outside its regime. scANVI adds a classifier $q(y\mid z)$ trained on labelled cells and a label-conditioned second latent layer, so scores against the same labels are circular.

**Why heuristics work and what a model adds.** A heuristic works where its single structural assumption matches the batch structure; a shift or shared neighbours is cheap to estimate, easy to audit and strongest for small near-linear effects, but has no noise model and returns a point embedding. A likelihood adds count-aware noise handling, posterior uncertainty for $z_c$ and expression, a reusable network with batch declared as a covariate, and an optional label head, at the price of training time, a GPU at scale and dependence on the count model.

**Pitfalls from benchmarks.**

- Stronger correction is not better: batch metrics reward collapsing batches, so batch ASW is read with label ASW and the biology scores [R1]. HVG selection improves integration, while scaling pushes methods toward batch removal at the cost of biology [R1].
- kBET and LISI depend on neighbourhood size, subsampling and the kNN graph built on the output [R14].
- Author labels are noisy, so a correct integration can look wrong; any method that forces full mixing erases batch-specific populations (section 9).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Harmony | hybrid | soft k-means on normalised PCs with a batch-diversity penalty, then per-cluster ridge removal of the batch-explained part | [R3] |
| Seurat CCA | heuristic | mutual-neighbour anchors in a CCA space, scored and weighted; anchor-pair vectors correct each cell | [R6, R7] |
| Seurat RPCA | heuristic | each dataset projected onto the other's PCA loadings; anchors and correction as for CCA | [R8] |
| fastMNN | heuristic | mutual pairs in a joint PCA, correction vectors from the nearest pair-participating cells, batches merged sequentially | [R5] |
| Scanorama | heuristic | mutual-neighbour matching between datasets in a reduced SVD space, Gaussian-kernel smoothed bias correction | [R9] |
| BBKNN | heuristic | neighbour graph built from the nearest neighbours within each batch; no coordinate change | [R10] |
| LIGER | model-based | integrative NMF with shared and dataset-specific factors, then quantile alignment of the loadings | [R11] |
| scVI | model-based | conditional VAE with batch covariate and ZINB decoder; posterior mean as embedding | [R12, R18] |
| scANVI | model-based | scVI with a classifier and label-conditioned latent layer trained on partial labels | [R13, R18] |
| ComBat | model-based | empirical-Bayes location-scale correction per gene on the log-normalised matrix | [R4, R21] |

The published standard is the method set of the OpenProblems batch-integration task, which builds on scIB [R1]: Harmony, Seurat CCA and RPCA, fastMNN, Scanorama, BBKNN, LIGER, scVI, scANVI and ComBat. Harmony and Seurat lead on simple tasks, scVI, scANVI and Scanorama on complex ones [R1, R17]. scIB and OpenProblems apply ComBat to the gene matrix; OpenProblems scores Seurat, fastMNN, Harmony and LIGER as embeddings.

Exact defaults for the methods singlet implements:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| Harmony (2.1.0) | theta; sigma | 2 per batch variable; 0.1 | R/ui.R:197-198; R/ui.R:96 @7e21bd6 |
| Harmony | nclust | min(round(N/30), 100) | R/ui.R:193 |
| Harmony | max_iter; early_stop; epsilon.harmony | 10; TRUE; 1e-2 | R/ui.R:99-100; R/harmony_option.R:39 |
| Harmony | alpha (ridge = alpha x expected count); tau | 0.2; 0 | R/harmony_option.R:34-35 |
| Harmony | block.size; max.iter.cluster; epsilon.cluster | 0.05; 4; 1e-3 | R/harmony_option.R:36-38 |
| Harmony | cluster distance (unit-norm z and y); diversity term | 2(1 - y'z); log((O+E+1)/(2E+1)) | src/harmony.cpp:42,136,141; :162 |
| Seurat 5.6.0.9000 | anchor.features; dims; k.anchor; k.score; max.features | 2000; 1:30; 5; 30; 200 | R/integration.R:142,148,149,151,152 @5f67c70 |
| Seurat | k.filter | 200 in FindIntegrationAnchors; NA (no filtering) in CCAIntegration and RPCAIntegration | R/integration.R:150; R/integration5.R:218,386 |
| Seurat | k.weight; sd.weight (IntegrateLayers path) | 100; 1 | R/integration5.R:221,223,389 |
| Seurat | anchor weight kernel | 1 - exp(-d' s sd^2/4), normalised per cell | src/integration.cpp:211,222,275 |
| Seurat | RPCA availability | added in Seurat 3.1.0 (2019-08-20) | NEWS.md:637-641; R/integration.R:518 |
| Scanorama | alpha; approx; batch_size; dimred; hvg | 0.10; True; 5000; 100; None | scanorama/scanorama.py:21-25 @4b4ea07 |
| Scanorama | knn; sigma | 20; 15 | scanorama/scanorama.py:26,29 |
| Scanorama | kernel | exp(-0.5 sigma d^2), rows L1-normalised | scanorama/scanorama.py:723-724 |
| fastMNN (batchelor 1.27.1) | k; cos.norm; ndist; d | 20; TRUE; 3; 50 | R/fastMNN.R:283-284 @a9c93ec |
| fastMNN | weights | tricube, bandwidth = median distance x ndist | R/fastMNN.R:80-82 |
| BBKNN | neighbors_within_batch; n_pcs; trim | 3; 50; None = 10 x neighbors_within_batch x batches | bbknn/__init__.py:31,38,40-45 @95ce34b |
| LIGER (rliger 2.2.1.9005) | k; lambda; method; seed | 20; 5.0; iNMF; 1 | R/integration.R:46-48,62 @afecff1 |
| LIGER | quantiles; minCells; nNeighbors | 50; 20; 20 | R/integration.R:1514-1517 |
| scVI | n_hidden; n_latent; n_layers; dropout_rate | 128; 10; 1; 0.1 | src/scvi/model/_scvi.py:118-121 @5555ecc |
| scVI | dispersion; gene_likelihood; use_observed_lib_size | gene; zinb; True | src/scvi/model/_scvi.py:122-124 |
| scVI | encode_covariates; deeply_inject_covariates | False; True | src/scvi/module/_vae.py:162-163 |
| scVI | epochs | min(round(400 x 20000/N), 400), at least 1 | src/scvi/model/_utils.py:38,61-62; _training_mixin.py:146 |
| scANVI | n_hidden; n_latent; n_layers; gene_likelihood; linear_classifier | 128; 10; 1; zinb; False | src/scvi/model/_scanvi.py:119-126 |
| scANVI | epochs | scVI heuristic; from a pretrained scVI min(10, max(2, round(heuristic/3))) | src/scvi/model/base/_training_mixin.py:485-488 |
| ComBat (scanpy) | key; covariates; input | batch; None; adata.X (genes) | src/scanpy/preprocessing/_combat.py:134-139 @8ed52d9 |
| ComBat | scIB call; OpenProblems input | sc.pp.combat(adata, key=batch); log_cp10k | scib/integration.py:419 @cd67913; src/methods/combat/config.vsh.yaml:20 @b3da9d6 |

## 5. Proposed singlet approach

- **Routes.** Port: Seurat anchor finding and correction (matrices in, no R object model), Scanorama, BBKNN, ComBat (scanpy routine), the scIB metric functions, and the scVI and scANVI design and objective in PyTorch without trained weights. Reimplement: Harmony (the default), fastMNN, LIGER and ciLISI, from published descriptions and a reading of the source. Callout: the R packages, rliger, the OpenProblems configurations and rapids_singlecell, as comparators and timing references.
- **Model-based formulation.** A conditional VAE in the scVI form [R12, R18] with ZINB decoder and batch covariate, an optional scANVI label head [R13] trained only on annotated cells and excluded from held-out studies, and the posterior mean of $z_c$ as embedding. It also yields a posterior predictive distribution for counts, which no heuristic offers. Harmony stays the default and the comparator for every model-based claim.
- **What would falsify it.** The model-based option replaces Harmony as default only if it meets all of: B1 pooled overall score above Harmony's; B2 strong-effect designs with ciLISI at least 0.10 above baseline, ARI within 0.05 of baseline and posterior predictive coverage within 0.03 of 0.95; B3 macro-F1 at least 0.05 above baseline (all proposed thresholds). Otherwise it stays opt-in.
- **Trained resources.** The VAE is pretrained once, self-supervised, on study-level batches of the singlet catalogue (354M uniformly processed cells); the label head uses the annotated portion (about 40%). Held-out studies of B3 and studies shared with public benchmarks are excluded, after checking for duplicate donors.
- **ML stack and kernels.** PyTorch for the VAE (ZINB likelihood, minibatch gradient steps, KL warm-up). Hard-coded CUDA/cuSPARSE only for small hot operations: Harmony's soft assignment and per-cluster ridge solves, nearest-neighbour and mutual-pair search, kernel-weighted pair averages, and sparse graph assembly for BBKNN. CPU uses BLAS and multi-threaded neighbour search. Streaming is not part of this release: embedding methods need the $N\times d$ PCA in memory and combat the $N\times G$ matrix; the VAE trains on minibatches and can read chunks later.
- **Defaults without asking.** `method` harmony, `batch_key` batch, `n_hvg` 2000, `n_pcs` 30, `seed` 0, `device` auto. Expose `method`, `batch_key`, `n_hvg`, `n_pcs` and, for scanvi, `scvi.label_key` with `scvi.unlabeled_category`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts; scvi and scanvi |
| read | layers/log1p_norm | sparse float | log-normalised expression (log_cp10k in OpenProblems); all other methods |
| read | var/highly_variable, var/hvg_rank | bool, int | gene subset and its rank, which orders the first `n_hvg` genes |
| read | obs/<batch_key> | categorical | batch label, at least two levels |
| read | obs/<scvi.label_key> | categorical | partial labels, scanvi only |
| read | obsm/X_pca | float32, N by d | PCA of the gene subset from the dimensionality-reduction task |
| write | obsm/X_integrated_<method> | float32, N by d | corrected embedding; for combat the PCA of the corrected matrix |
| write | obsp/bbknn_connectivities, obsp/bbknn_distances, uns/neighbors_bbknn | sparse float, record | batch-balanced graph and its parameters (bbknn only) |
| write | layers/integrated_expr | float32, N by G | corrected log-normalised expression (combat only) |
| write | models/integration_<method> | model state | trained scVI or scANVI model |
| write | uns/integration_<method>_params | record | parameters, seed, input layer and device |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "harmony" | `harmony`, `scanorama`, `seurat_cca`, `seurat_rpca`, `fastmnn`, `bbknn`, `liger`, `scvi`, `scanvi`, `combat` | Integration method. harmony (default) corrects the PCA embedding; scvi and scanvi train on raw counts; bbknn writes a graph only; combat corrects expression. |
| `batch_key` | string | "batch" | — | obs column holding the batch label; at least two levels and no missing values. |
| `n_hvg` | integer | 2000 | min 1 | Number of highly variable genes kept, taken in var/hvg_rank order among genes flagged in var/highly_variable. |
| `n_pcs` | integer | 30 | min 1 | Embedding width d: PCs read from obsm/X_pca (harmony, bbknn, seurat_*) or PCA width for fastmnn, scanorama, combat. Ignored by liger, scvi, scanvi. |
| `harmony` | object | — | — | Options for method harmony. |
| `harmony.theta` | number | 2 | min 0 | Diversity penalty per batch variable; 0 disables the diversity term. |
| `harmony.sigma` | number | 0.1 | > 0 | Width of the soft k-means clusters (entropy scale). |
| `harmony.nclust` | integer/null | null | min 1 | Number of soft clusters K; null uses min(round(N/30), 100). |
| `harmony.max_iter` | integer | 10 | min 1 | Maximum outer iterations; stops earlier when the objective converges. |
| `harmony.alpha` | number | 0.2 | > 0 | Ridge scale: lambda is alpha times the expected cluster-batch count. |
| `seurat` | object | — | — | Options for methods seurat_cca and seurat_rpca. |
| `seurat.k_anchor` | integer | 5 | min 1 | Neighbours used to pick anchors. |
| `seurat.k_filter` | integer/null | null | min 1 | Neighbours for anchor filtering; null applies no filtering. |
| `seurat.k_score` | integer | 30 | min 1 | Neighbours used to score anchors. |
| `seurat.k_weight` | integer | 100 | min 1 | Anchors that weight each cell's correction vector. |
| `scvi` | object | — | — | Options for methods scvi and scanvi. |
| `scvi.n_latent` | integer | 10 | min 1 | Latent dimension of the embedding. |
| `scvi.n_hidden` | integer | 128 | min 1 | Hidden units per layer. |
| `scvi.n_layers` | integer | 1 | min 1 | Hidden layers in encoder and decoder. |
| `scvi.gene_likelihood` | string | "zinb" | `zinb`, `nb` | Count likelihood of the decoder. |
| `scvi.max_epochs` | integer/null | null | min 1 | Training epochs; null uses min(round(400*20000/N), 400), at least 1. |
| `scvi.label_key` | string/null | null | — | obs column with partial cell-type labels; required for scanvi. |
| `scvi.unlabeled_category` | string/null | null | — | Value in label_key that marks unlabelled cells; required for scanvi. |
| `seed` | integer | 0 | min 0 | Random seed for initialisation, minibatches and approximate neighbour search; recorded with the output. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running or writing. |
| `overwrite` | boolean | false | — | Replace existing output members of this method instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters: the input layer follows the method (`counts` for scvi and scanvi, `log1p_norm` otherwise) and cannot be overridden. `harmony` applies to harmony, `seurat` to seurat_cca and seurat_rpca, `scvi` to scvi and scanvi; `scvi.label_key` and `scvi.unlabeled_category` are required for scanvi. Scanorama, BBKNN, fastMNN, LIGER and ComBat run at the section 4 defaults. A missing batch label, a single-level batch column, `n_pcs` above the stored PCA width, or an existing output without `overwrite` is a tool error and nothing is written.

## 7. MCP tool

Tool name `singlet_integration_batch_corrected_embedding` (definition in `tasks/mcp/singlet_integration_batch_corrected_embedding.json`).

```json
{"dataset": "/data/atlas.singlet", "method": "harmony", "batch_key": "study", "n_pcs": 30}
```

```json
{
  "dataset": "/data/atlas.singlet",
  "status": "completed",
  "wrote": ["obsm/X_integrated_harmony", "uns/integration_harmony_params"],
  "summary": {"method": "harmony", "input_layer": "log1p_norm", "n_batches": 4, "n_cells": 50000, "n_pcs": 30, "device": "cpu", "seed": 0, "warnings": []},
  "provenance_id": "prov_0002"
}
```

Long-running: scvi and scanvi train a model and may return `queued` with a `job_id`. Stochastic: yes; `seed` is recorded in `uns/integration_<method>_params`. Dry run: `estimate` holds `seconds`, `peak_memory_gb` and `device`, and nothing is written.

## 8. Benchmarks

Shared protocol. Every benchmark uses the same gene subset (`n_hvg` 2000) and the same $d$ (`n_pcs` 30) for all methods, each method on its own input layer, with hyperparameters fixed to the section 4 defaults before any score is inspected and never tuned on labels. Stochastic methods run with seeds 0, 1 and 2; the mean and range are reported. The baseline is the unintegrated PCA of the same subset. Label-aware methods never see held-out labels. Graph-only outputs are scored with graph metrics only (kBET, iLISI, cLISI, graph connectivity, ARI, NMI). Hardware and thread count are recorded, and metric code is pinned (scib cd67913, OpenProblems task b3da9d6).

### B1. Atlas integration with the scIB and OpenProblems metric suite (published)

- **Goal**: rank outputs on batch removal and biological conservation on real multi-batch data with one combined score, and check that singlet reproduces its reference implementations.
- **Ground truth**: expert cell-type labels $t(c)$ and observed batch labels $b(c)$ as stored in the dataset; metrics lie in $[0,1]$, higher better.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| OpenProblems `cxg_immune_cell_atlas` test resource | https://github.com/openproblems-bio/task_batch_integration (resources_test) | scRNA-seq; —; — | — | example input of the task |
| scIB integration tasks [R1] | https://theislab.github.io/scib-reproducibility; code https://github.com/theislab/scib | 13 atlas-level tasks (RNA, ATAC, simulation); 85 batches from 23 publications; over 1.2 million cells | — | task list on the reproducibility site |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| kBET | per cell type, 1 minus the rejection rate of the $\chi^2$ test of batch counts in a $k$-neighbourhood against global proportions; OpenProblems: 50-neighbour graph, $k$ = median batch size per type within 10 to 100, rate 1 if over 25% of cells are in components below $3k$ | higher | batch | [R14] |
| iLISI | $(\operatorname{median}_c \mathrm{LISI}_c-1)/(B-1)$, LISI the inverse Simpson index of batch labels on a kNN graph, $k_0=90$, perplexity 30 | higher | batch | [R1] |
| batch ASW | mean over cell types $j$ of the mean of $1-\lvert\mathrm{sil}_c\rvert$, silhouette on batch labels within type $j$ | higher | batch | [R1] |
| graph connectivity | mean over types of the fraction of cells in the largest connected component of the type's kNN subgraph | higher | batch | [R1] |
| label ASW | mean over cells of $(\mathrm{sil}_c+1)/2$, silhouette on type labels | higher | bio | [R1] |
| cLISI | $(n_{\text{labels}}-\operatorname{median}_c\mathrm{cLISI}_c)/(n_{\text{labels}}-1)$ on the same graph | higher | bio | [R1] |
| isolated-label F1 | labels present in the fewest batches; best cluster F1 per label, averaged | higher | bio | [R1] |
| ARI | agreement of type labels with the Louvain clustering (10 resolutions up to 2) that maximises NMI | higher | bio | [R1] |

  The overall score is $0.4\times$ the mean of the batch-role metrics $+\,0.6\times$ the mean of the bio-role metrics, each min-max scaled over the compared methods; the weights come from the best-practices chapter code [R17], the role assignment is singlet's.
- **Comparators**: baseline, every method of section 4, the model-based option, and the reference implementations as callouts.
- **Protocol**: as shared; tasks pooled for the overall score, per-task scores reported.
- **Acceptance criterion** (proposed): (i) singlet metric functions match the scib and OpenProblems code within 0.02 per metric on identical outputs; (ii) each singlet method's overall score is within 0.03 of its reference implementation's; (iii) the model-based option's overall score is at least Harmony's (section 5).
- **Known pitfalls**: min-max scaling makes the overall score depend on the compared set; kBET differs between scIB (neighbourhood a quarter of the mean batch size, bounded 10 to 70) and OpenProblems, so scores are comparable only within one configuration.

### B2. Planted batch-effect simulation (proposed)

- **Goal**: test whether a method removes a known batch effect while keeping known types apart, and whether the model-based option is calibrated.
- **Ground truth**: planted type $t(c)$ and batch $b(c)$ per cell, and the planted mean $\mu_{gc}$ of every count; a second count draw $X'$ from the same means is held out.
- **Generator**
  1. From the annotated catalogue subset of B3 keep the 8 most abundant author types, 2,000 cells each. Per type $t$ compute the profile $\pi_g(t)$ (mean library-normalised expression on 2,000 HVGs, summing to 1) and per-gene NB dispersion $\theta_g$ by method of moments.
  2. Use $B=4$ batches. Balanced design: every type split equally. Unbalanced design: types 1 and 2 only in batches 1 and 2, type 8 only in batch 4.
  3. Draw $\ell_c\sim\mathrm{LogNormal}(\log 4000+\delta_{b},\,0.3^2)$, $\delta_b\sim\mathcal N(0,0.2^2)$, and log-normal batch factors $\beta_{gb}=\exp(\sigma_\beta\varepsilon_{gb})$, $\varepsilon\sim\mathcal N(0,1)$, $\sigma_\beta\in\{0.5,1.0\}$ (weak, strong), as in Splatter [R20].
  4. Set $\mu_{gc}=\ell_c\,\pi_g(t)\beta_{gb}/\sum_{g'}\pi_{g'}(t)\beta_{g'b}$; draw independent $X$ (method input) and $X'$ (held out) from $\mathrm{NB}(\mu_{gc},\theta_g)$.
  5. Repeat for seeds 0, 1, 2: 12 datasets of 16,000 cells.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| planted simulation from the B3 catalogue subset | generator above | scRNA-seq counts; —; 16,000 cells, 2,000 genes, 12 datasets | — | tissue and species follow the B3 subset |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ciLISI | iLISI computed within each planted type (groups of at least 10 cells and 2 batches) and scaled to $[0,1]$ | higher | primary | [R19] |
| ARI | planted type against the Louvain clustering, as in B1 | higher | primary | [R1] |
| isolated-label F1 | as in B1, on planted types 1, 2 and 8 in the unbalanced design | higher | guardrail | [R1] |
| coverage | fraction of entries of $X'$ with $\mu_{gc}\ge 5$ inside the central 95% posterior predictive interval | 0.95 | calibration | — |

- **Comparators**: baseline, Harmony, Seurat RPCA, Scanorama, scVI, BBKNN (graph metrics only); coverage for scVI only.
- **Protocol**: as shared; designs and strengths reported separately.
- **Acceptance criterion** (proposed): in the strong-effect designs a method has ciLISI at least 0.10 above the baseline and ARI at least baseline minus 0.05; in the unbalanced design isolated-label F1 is at least baseline minus 0.05; scVI coverage lies within 0.03 of 0.95 (the regime $\mu\ge 5$ avoids the over-coverage of discrete intervals at low means).
- **Known pitfalls**: the multiplicative generator matches the assumption of Harmony and ComBat, so success is weaker evidence for them; passing is necessary, not sufficient.

### B3. Held-out study label transfer (proposed)

- **Goal**: test whether an integrated space places a held-out study's cells with the same types as the rest of the atlas.
- **Ground truth**: author annotations harmonised to a coarse label set shared by at least 3 studies (mapping table stored with the results); labels are noisy and scored as given.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| annotated studies of one tissue in the singlet catalogue | singlet catalogue; study identifiers in the benchmark manifest | scRNA-seq; —; at least 5 studies with at least 1,000 annotated cells each | — | duplicate donors across studies removed |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| macro F1 | unweighted mean over the labels present in the held-out study of the per-label F1 of kNN predictions | higher | primary | — |
| accuracy | fraction of held-out cells whose predicted label equals the harmonised author label | higher | primary | — |
| held-out batch ASW | batch ASW as in B1 with the held-out study as one batch against the rest | higher | guardrail | [R1] |

- **Comparators**: baseline, Harmony, Scanorama, scVI, scANVI, and the model-based option.
- **Protocol**: leave one study out. All studies are integrated together; a kNN classifier ($k=15$, identical for every method) is fitted on the other studies in the integrated space and predicts the held-out cells; scANVI is trained without the held-out labels.
- **Acceptance criterion** (proposed): macro F1 at least 0.05 above the baseline.
- **Known pitfalls**: a study is not a batch (a study can hold several batches and a batch can span studies); any use of held-out labels in model fitting, including the scANVI label head, is leakage.

### P1. Performance and scaling

Wall time, peak memory and throughput in cells per second on CPU and CUDA at $10^4$ cells with 2 batches, $10^5$ with 10 and $10^6$ with 20, plus the slope of log time against log $N$. Comparators: R harmony 2.1.0, Seurat RPCA, batchelor fastMNN, Scanorama, BBKNN, scvi-tools on GPU, scanpy ComBat, and the rapids_singlecell Harmony and BBKNN paths. Hold fixed the gene subset, $d$, neighbour counts, seed, threads and hardware. Acceptance (proposed): singlet Harmony on CPU is no slower than R harmony at the same thread count at $10^5$ cells, and its CUDA path is at least 3 times faster than its CPU path at $10^6$ cells. The cost of mutual-pair methods grows with the number of batch pairs; no $10^7$ scale is claimed.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
- **Feeds**:
  - `integration.integration_quality_scoring`: Integration quality scoring
  - `evaluation.overcorrection_detection`: Over-correction after batch or covariate removal
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
- **Reads**: `layers/counts`, `layers/log1p_norm`, `var/highly_variable`, `var/hvg_rank`, `obs/<batch_key>`, `obs/<scvi.label_key>`, `obsm/X_pca`
- **Writes**: `obsm/X_integrated_<method>`, `obsp/bbknn_connectivities`, `obsp/bbknn_distances`, `layers/integrated_expr`, `models/integration_<method>`, `uns/neighbors_bbknn`, `uns/integration_<method>_params`
<!-- CHAINING:AUTO:END -->

Recipe: atlas integration runs highly variable genes, PCA, this task, quality scoring, over-correction check, clustering and annotation. Unbalanced, partially labelled and condition-preserving designs belong to separate tasks.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The identities, sizes and licences of the 13 scIB tasks, and the OpenProblems datasets beyond the `cxg_immune_cell_atlas` test resource, are not listed in the local sources. The numerical results of [R15] and [R16] are known only through the best-practices chapter [R17]. The Harmony v2.1.0 DESCRIPTION cites a 2026 preprint (doi:10.64898/2026.03.16.711825) that was not read, so Harmony is described from its source and [R3]. The Scanorama assembly order and the fastMNN merge order were not read in detail.
- **Metric definitions.** kBET differs between scIB and OpenProblems (B1). The 0.4 and 0.6 weights appear in the best-practices chapter code and not in the scib package; other weightings can reorder methods.
- **Unsettled literature.** Rankings depend on task complexity; the over- versus under-correction balance has no agreed metric; methods that force full mixing erase batch-specific populations, which belongs to the unbalanced-batch task.
- **Data risks.** Licence terms of the catalogue studies and their overlap with public benchmark data have not been audited; B3 and B2 depend on duplicate-donor removal and on the label harmonisation table.
- **Numerical risks.** CPU and CUDA results differ in floating point, so reproducibility is stated per device; the agreement of the rapids_singlecell CUDA Harmony and BBKNN paths with the reference implementations is untested; the thresholds 0.02, 0.03, 0.05 and 0.10 are design choices.
- **First experiment.** Run the Harmony reimplementation and R harmony 2.1.0 on the B2 strong-effect balanced design and on `cxg_immune_cell_atlas`, comparing the objective trace and the per-cell embedding, before any model-based claim.

## 11. References

R1. Malte D. Luecken, M. Büttner, K. Chaichoompu, A. Danese, M. Interlandi, M. F. Mueller, D. C. Strobl, L. Zappia, M. Dugas, M. Colomé-Tatché, Fabian J. Theis. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2021. doi:10.1038/s41592-021-01336-8 — verified (corpus)

R2. Ricard Argelaguet, Anna S E Cuomo, Oliver Stegle, John C Marioni. Computational principles and challenges in single-cell data integration. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00895-7 — verified (corpus)

R3. Ilya Korsunsky, Nghia Millard, Jean Fan, Kamil Slowikowski, Fan Zhang, Kevin Wei, Yuriy Baglaenko, Michael Brenner, Po-ru Loh, Soumya Raychaudhuri. Fast, sensitive and accurate integration of single-cell data with Harmony. *Nature Methods* 2019. doi:10.1038/s41592-019-0619-0 — verified (corpus)

R4. W. Evan Johnson, Cheng Li, Ariel Rabinovic. Adjusting batch effects in microarray expression data using empirical Bayes methods. *Biostatistics* 2006. doi:10.1093/biostatistics/kxj037 — verified (corpus)

R5. Laleh Haghverdi, Aaron T L Lun, Michael D Morgan, John C Marioni. Batch effects in single-cell RNA-sequencing data are corrected by matching mutual nearest neighbors. *Nature Biotechnology* 2018. doi:10.1038/nbt.4091 — verified (corpus)

R6. T. Stuart, A. Butler, P. Hoffman, C. Hafemeister, E. Papalexi, W.M. Mauck, Y. Hao, M. Stoeckius, P. Smibert, R. Satija. Comprehensive Integration of Single-Cell Data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)

R7. Andrew Butler, Paul Hoffman, Peter Smibert, Efthymia Papalexi, Rahul Satija. Integrating single-cell transcriptomic data across different conditions, technologies, and species. *Nature Biotechnology* 2018. doi:10.1038/nbt.4096 — verified (corpus)

R8. Yuhan Hao, Stephanie Hao, Erica Andersen-Nissen, William M. Mauck, Shiwei Zheng, et al., Rahul Satija. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)

R9. Brian Hie, Bryan Bryson, Bonnie Berger. Efficient integration of heterogeneous single-cell transcriptomes using Scanorama. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0113-3 — verified (corpus)

R10. Krzysztof Polański, Matthew D Young, Zhichao Miao, Kerstin B Meyer, Sarah A Teichmann, Jong-Eun Park. BBKNN: fast batch alignment of single cell transcriptomes. *Bioinformatics* 2019. doi:10.1093/bioinformatics/btz625 — verified (corpus)

R11. Joshua D. Welch, Velina Kozareva, Ashley Ferreira, Charles Vanderburg, Carly Martin, Evan Z. Macosko. Single-Cell Multi-omic Integration Compares and Contrasts Features of Brain Cell Identity. *Cell* 2019. doi:10.1016/j.cell.2019.05.006 — verified (corpus)

R12. Romain Lopez, Jeffrey Regier, Michael B. Cole, Michael I. Jordan, Nir Yosef. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)

R13. Chenling Xu, Romain Lopez, Edouard Mehlman, Jeffrey Regier, Michael I Jordan, Nir Yosef. Probabilistic harmonization and annotation of single-cell transcriptomics data with deep generative models. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209620 — verified (corpus)

R14. Maren Büttner, Zhichao Miao, F. Alexander Wolf, Sarah A. Teichmann, Fabian J. Theis. A test metric for assessing single-cell RNA-seq batch correction. *Nature Methods* 2018. doi:10.1038/s41592-018-0254-1 — verified (corpus)

R15. Hoa Thi Nhu Tran, Kok Siong Ang, Marion Chevrier, Xiaomeng Zhang, Nicole Yee Shin Lee, Michelle Goh, Jinmiao Chen. A benchmark of batch-effect correction methods for single-cell RNA sequencing data. *Genome Biology* 2020. doi:10.1186/s13059-019-1850-9 — verified (corpus)

R16. Ruben Chazarra-Gil, Stijn van Dongen, Vladimir Yu Kiselev, Martin Hemberg. Flexible comparison of batch correction methods for single-cell RNA-seq using BatchBench. *Nucleic Acids Research* 2021. doi:10.1093/nar/gkab004 — verified (corpus)

R17. Lukas Heumos, Anna C. Schaar, Christopher Lance, et al., Fabian J. Theis, Single-cell Best Practices Consortium. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w. The integration chapter and its code are read from https://github.com/theislab/single-cell-best-practices (cellular_structure/integration.ipynb). — verified (corpus)

R18. Adam Gayoso, Romain Lopez, Galen Xing, Pierre Boyeau, Valeh Valiollah Pour Amiri, Justin Hong, et al., Nir Yosef. A Python library for probabilistic analysis of single-cell omics data. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01206-w — verified (corpus)

R19. Semi-supervised integration of single-cell transcriptomics data. 2024. doi:10.1038/s41467-024-45240-z (the DOI cited for ciLISI by the OpenProblems metric configuration; the paper introduces the STACAS method) — partial (corpus)

R20. Luke Zappia, Belinda Phipson, Alicia Oshlack. Splatter: Simulation of Single-Cell RNA Sequencing Data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)

R21. F. Alexander Wolf, Philipp Angerer, Fabian J. Theis. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt; pyproject.toml) | metric code and benchmark reference (B1) | port (metric functions) |
| https://github.com/openproblems-bio/task_batch_integration | Open Problems in Single-Cell Analysis (LICENSE copyright 2024); maintainer Michaela Mueller (README) | MIT (LICENSE) | metric configurations and dataset format (B1) | callout |
| https://github.com/immunogenomics/harmony | Nikolaos Patikas, Hongcheng Yao, Ilya Korsunsky (maintainer), Martin Hemberg, Nghia Millard, Jean Fan, Kamil Slowikowski, Miles Smith, Soumya Raychaudhuri (DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file at the root) | default method | reimplement; R package as callout |
| https://github.com/satijalab/seurat | Rahul Satija (maintainer) and others (DESCRIPTION); LICENSE copyright "Seurat authors" 2021 | MIT (DESCRIPTION "MIT + file LICENSE"; LICENSE) | CCA and RPCA anchors | port |
| https://github.com/LTLA/batchelor | Aaron Lun (maintainer), Laleh Haghverdi (DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file at the root) | fastMNN | reimplement; callout |
| https://github.com/brianhie/scanorama | Brian Hie (LICENSE copyright 2018) | MIT (LICENSE) | Scanorama | port |
| https://github.com/Teichlab/bbknn | Krzysztof Polanski, Jongeun Park (pyproject.toml) | MIT (LICENSE; copyright line 2018 The Python Packaging Authority) | BBKNN | port; licence text and copyright line kept unchanged |
| https://github.com/welch-lab/liger | Joshua Welch, Yichen Wang (maintainer), Chao Gao, Jialin Liu, Joshua Sodicoff, Velina Kozareva, Evan Macosko and contributors (DESCRIPTION) | GPL-3 (LICENSE is the GPL-3 text; DESCRIPTION GPL-3) | iNMF reference | reimplement; callout |
| https://github.com/scverse/scvi-tools | Yosef Lab, Weizmann Institute of Science (LICENSE copyright 2026) | BSD-3-Clause (LICENSE; pyproject.toml) | scVI and scANVI reference | port (design and objective to PyTorch, attribution) |
| https://github.com/scverse/scanpy | scverse (LICENSE copyright 2025); F. Alexander Wolf, P. Angerer, Theis Lab (copyright 2017) | BSD-3-Clause (LICENSE; pyproject.toml) | ComBat routine | port (attribution) |
| https://github.com/carmonalab/scIntegrationMetrics | Massimo Andreatta (maintainer), Josep Garnica, Santiago Carmona (DESCRIPTION) | GPL-3 (LICENSE; DESCRIPTION) | ciLISI definition (B2) | reimplement |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (copyright 2022); scverse (copyright 2025) | MIT (LICENSE) | CUDA Harmony and BBKNN timing references (P1) | callout |
