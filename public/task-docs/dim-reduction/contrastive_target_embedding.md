---
id: dim-reduction.contrastive_target_embedding
title: Contrastive embedding of target-specific variation against a background
area: dim-reduction
scope: extended
paradigm: hybrid
literature_status: open
priority: P2
depends_on: [normalization.size_factor_estimation, normalization.count_noise_model_selection]
feeds: [clustering.cluster_stability, dim-reduction.pc_gene_association_testing, perturbation.global_phenotype_detection]
reads: [layers/counts, obs/<group_key>, obs/<batch_key>]
writes: [obsm/contrastive_salient, obsm/contrastive_background, varm/contrastive_loadings, models/contrastive, uns/contrastive_setting]
devices: [cpu, cuda]
mcp_tool: singlet_dim_reduction_contrastive_target_embedding
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Contrastive embedding of target-specific variation against a background

> Embeds target cells so that variation shared with a background group measured on the same genes is separated from target-specific variation, and scores that separation against uncontrasted baselines.

## 1. Question

Does a contrastive embedding, which removes variation shared with a background group, recover target-specific structure (perturbation, disease or induction state) better than PCA or a latent model fitted to target cells alone? Inputs are raw counts for target and background cells on one gene set; outputs are a salient embedding of target cells, the contrast setting and, for probabilistic models, a shared-versus-salient latent split. A correct answer gives target-label separation above the uncontrasted baselines without separating background-only structure.

## 2. Why this task matters and where the field stands

Principal components rank directions by total variance, so a large background-shared factor such as cell cycle, sequencing depth or donor identity can hide a smaller target-specific program. Contrastive PCA (cPCA) subtracts background covariance from target covariance [R1]. Its sparse, cross-validated successor scPCA selects contrast and sparsity with label-free criteria [R2]. contrastiveVI is a count variational autoencoder that separates a shared background latent from a target-only salient latent [R3]. Jones et al. give a contrastive latent model for case-control sequencing [R4].

Status: **open**. Several methods exist, but no selection rule for the contrast strength is accepted, and no community benchmark is established. Open problems are identifiability when target and background share programs, confounding by batch or donor that no method adjusts for automatically, and calibrated uncertainty for salient loadings and cell scores.

## 3. Theory and insight

**Estimands.** Let $\hat\Sigma_T$ and $\hat\Sigma_B$ be centred sample covariances of target and background cells on the same $p$ genes. cPCA components are the leading unit eigenvectors $\mathbf v$ of
$$\hat\Sigma_T-\alpha\,\hat\Sigma_B,\qquad \alpha\ge 0,$$
with $\alpha=0$ giving PCA of target cells. Components are ranked by eigenvalue, which can be negative; gene loadings are unit-norm and cell scores are projections of centred log-normalised expression. This is a second-order summary, reliable when both samples are large relative to $p$.

For contrastiveVI, $\mathbf z_i\sim\mathcal N(0,I)$ and $\mathbf s_i\sim\mathcal N(0,I)$ are the shared and salient latents. Background cells are decoded with $\mathbf s_i$ set to zero. Counts follow a zero-inflated negative binomial, $P(x\mid\mu,\theta,\pi)=\pi\,\mathbf 1[x=0]+(1-\pi)\,\mathrm{NB}(x\mid\mu,\theta)$, with mean $\mu_{ig}=l_i\rho_{ig}$ from the decoder, gene inverse dispersion $\theta_g$ and dropout $\pi_{ig}$. The minibatch loss is
$$\mathcal L=\sum_i\Bigl[-\log p(\mathbf x_i\mid\mathbf z_i,\tilde{\mathbf s}_i,b_i,l_i)+\beta\bigl(\mathrm{KL}_{z,i}+\mathbb 1_{i\in T}\,\mathrm{KL}_{s,i}+\lambda\,\mathbb 1_{i\in B}\,W_i\bigr)+\mathrm{KL}_{l,i}\Bigr],$$
where $\beta$ is the warm-up weight, $\lambda$ the penalty weight (default $0$) and $W_i=\|\boldsymbol\mu^s_i\|_2^2+\sum_k v^s_{ik}$ on background cells. $W_i$ is a squared mean plus variance term, not the 2-Wasserstein distance to the prior. Estimands: the salient embedding is the posterior mean $\boldsymbol\mu^s_i$ of target cells, and the background embedding is the posterior mean of $\mathbf z_i$ for all cells; both are in latent units with no normalisation across cells. The observed library size $l_i$ is used by default.

**Scores.** ARI is the chance-corrected agreement between a partition and the labels, about 0 for random partitions and 1 for identical ones [R6]. Scaled silhouette $(\mathrm{ASW}+1)/2$ maps label silhouettes from $[-1,1]$ to $[0,1]$ [R7]. Ground-truth labels are used whole, one categorical value per cell.

**Assumptions and failure modes.** For cPCA, covariance estimates must be stable, and large contrasts favour low-background-variance directions that are often sampling noise when the background is small. Over-subtraction removes target biology that background cells also carry, such as bystander effects or shifted composition. Silhouette-based selection can prefer cluster-like noise. For contrastiveVI, the split is enforced only by the zero-salient decoder input and the KL trade-off while $\lambda=0$, so background variation can enter the salient latent when its capacity is large. The ZINB must describe dropout, and donor, batch or depth differences that are not modelled appear as contrast.

**What a model adds.** A likelihood lets held-out ELBO choose the salient dimension and training length without labels, gives posterior variance for salient coordinates, and embeds new target cells with a trained encoder. The cost is identifiability: shared and salient latents can absorb each other's variation, which the leakage test in section 8 probes.

**Insight.** The mechanism is removal of a dominant background factor, which exposes target-specific variation that PCA ranks low. The OSCA cell-cycle example uses wild-type 416B cells as background and oncogene-induced cells as target [R8]; its evaluation is a visual check, not a quantitative test.

## 4. Methods landscape

The published standards are cPCA [R1] and its sparse variant scPCA [R2] for linear contrasts, and contrastiveVI [R3] for counts. Jones et al. [R4] are cited for context. The uncontrasted baselines are PCA of target cells and scVI [R5] fitted to target cells alone. singlet implements contrastiveVI and cPCA; scPCA and scVI serve as comparators.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Contrastive PCA (cPCA) | heuristic | Leading eigenvectors of target covariance minus alpha times background covariance | [R1] |
| Sparse contrastive PCA (scPCA) | heuristic | Penalised cPCA over contrast and penalty grids, selected by silhouette or cross-validation | [R2] |
| contrastiveVI | model-based | Count VAE with shared background and target-only salient latents, ZINB likelihood | [R3] |

| Method | Parameter | Value | Source |
|---|---|---|---|
| contrastiveVI | n_hidden | 128 | scvi-tools src/scvi/external/contrastivevi/_model.py:89 |
| contrastiveVI | n_background_latent | 10 | _model.py:90 |
| contrastiveVI | n_salient_latent | 10 | _model.py:91 |
| contrastiveVI | n_layers | 1 | _model.py:92 |
| contrastiveVI | dropout_rate | 0.1 | _model.py:93 |
| contrastiveVI | use_observed_lib_size | True | _model.py:94 |
| contrastiveVI | wasserstein_penalty | 0 | _model.py:95 |
| contrastiveVI | train batch_size | 128 | _model.py:144 |
| contrastiveVI | gene dispersion | px_r = exp(learned parameter) | _module.py:75-76, 338 |
| contrastiveVI | background salient before decoding | set to zero | _module.py:320 |
| cPCA | definition | contrastive covariance eigendecomposition, stated as the cPCA of Abid et al. | R/fitCPCA.R:1-7 @ 4329b9a (scPCA) |
| scPCA | n_eigen | 2 | R/scPCA.R:157 @ 4329b9a |
| scPCA | cv | NULL | R/scPCA.R:157 |
| scPCA | alg | iterative | R/scPCA.R:158 |
| scPCA | contrasts | 40 log-spaced values from 0.1 to 1000 | R/scPCA.R:159 |
| scPCA | penalties | 20 linearly spaced values from 0.05 to 1 | R/scPCA.R:160 |
| scPCA | max_iter | 10 | R/scPCA.R:162 |
| scPCA | eigdecomp_tol | 1e-10 | R/scPCA.R:164 |
| scPCA | selection | maximum average silhouette width when n_centers > 1 (grid fits); cross-validated selection | R/scPCA.R:227-228; 292 |

## 5. Proposed singlet approach

**Routes.** contrastiveVI is ported: singlet implements its generative structure and minibatch objective in a PyTorch reference model, so results compare directly with the maintained version. cPCA is ported as a closed-form dense eigendecomposition on the HVG set. scPCA and scVI are callouts, used only as benchmark comparators.

**Model-based proposal.** singlet proposes a shared-plus-salient factor model on raw counts with NB or ZINB likelihood and observed library sizes, fitted by variational inference, with background cells decoded with the salient block set to zero. It adds a held-out likelihood for choosing the salient dimension and contrast strength without labels, and posterior variance for salient coordinates. It is falsified if the salient embedding fails to beat the best uncontrasted baseline in B1, or if background-only structure appears in the salient space in B2.

**Label-free selection.** cPCA's contrast is proposed to be chosen by the average-silhouette criterion that scPCA uses on the same grid, so comparisons isolate the penalty from the selection rule. contrastiveVI is chosen by validation ELBO. The Wasserstein-named penalty stays at 0 unless B2 fails.

**Stack.** PyTorch for the variational model, which mirrors contrastiveVI's small networks. A hard-coded CUDA path for the linear NB factor model, whose cost is sparse-dense products of counts with 2 to 20 latent columns, and a dense CUDA kernel for cPCA covariance and eigendecomposition on the HVG set. Minibatches of 128 cells bound memory on CPU and CUDA. Streaming is not claimed.

**Agent defaults.** `method` contrastivevi, `n_hvg` 2000 (proposed), contrastivevi defaults from section 4, `seed` 0, `device` auto.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts (contrastivevi); log-normalised values (cpca) |
| read | obs/<group_key> | categorical | target and background group labels |
| read | obs/<batch_key> | categorical | optional covariate for contrastivevi |
| write | obsm/contrastive_salient | float32 | salient embedding of target cells |
| write | obsm/contrastive_background | float32 | shared latent, contrastivevi only |
| write | varm/contrastive_loadings | float32 | gene loadings, cpca only |
| write | models/contrastive | model | contrastivevi weights |
| write | uns/contrastive_setting | dict | selected contrast or latent sizes, criterion, seed |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "contrastivevi" | `contrastivevi`, `cpca` | Embedding method; contrastivevi is the default, cpca is the closed-form linear contrast. |
| `groups` | object | required | — | Obs column and values that mark target and background cells. |
| `groups.group_key` | string | — | — | Obs column holding each cell's group label. |
| `groups.target` | string | — | — | Value of group_key for target cells. |
| `groups.background` | string | — | — | Value of group_key for background cells. |
| `n_hvg` | integer | 2000 | min 1 | Highly variable genes shared by all methods; 2000 is a proposed default. |
| `contrastivevi` | object | — | — | Options used when method is contrastivevi. |
| `contrastivevi.n_salient` | integer | 10 | min 1 | Dimension of the target-only salient latent. |
| `contrastivevi.n_background` | integer | 10 | min 1 | Dimension of the shared background latent. |
| `contrastivevi.n_hidden` | integer | 128 | min 1 | Hidden width of the encoders and decoder. |
| `contrastivevi.wasserstein_penalty` | number | 0 | min 0 | Weight of the background salient penalty; 0 leaves the split to the KL terms. |
| `contrastivevi.batch_key` | string | — | — | Optional obs column used as a covariate. |
| `contrastivevi.max_epochs` | integer | — | min 1 | Training epochs, fixed in advance rather than set by convergence. |
| `cpca` | object | — | — | Options used when method is cpca. |
| `cpca.n_eigen` | integer | 2 | min 1 | Number of contrastive components returned. |
| `cpca.contrast_min` | number | 0.1 | min 0 | Smallest contrast value on the log grid. |
| `cpca.contrast_max` | number | 1000 | min 0 | Largest contrast value on the log grid. |
| `cpca.contrast_count` | integer | 40 | min 1 | Number of log-spaced contrast values scanned; the silhouette-best is kept. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for training and for k-means in contrast selection. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Groups must be disjoint and each must contain cells. contrastivevi options are ignored by cpca and the reverse. Outcome labels are never used for fitting; scoring is a separate step (section 8).

## 7. MCP tool

Tool name `singlet_dim_reduction_contrastive_target_embedding` (definition in `tasks/mcp/singlet_dim_reduction_contrastive_target_embedding.json`). Example call and compact result:

```json
{"dataset": "study.singlet", "method": "contrastivevi",
 "groups": {"group_key": "condition", "target": "IFN", "background": "control"},
 "contrastivevi": {"n_salient": 10, "batch_key": "donor"}, "seed": 0}
```

```json
{"dataset": "study.singlet", "status": "completed",
 "wrote": ["obsm/contrastive_salient", "obsm/contrastive_background", "models/contrastive", "uns/contrastive_setting"],
 "summary": {"method": "contrastivevi", "n_target": "<int>", "n_background": "<int>", "n_hvg": 2000, "setting": {"n_salient": 10, "n_background": 10}, "selection_criterion": "validation_elbo"}}
```

Long-running: training scales with cell count and can return status queued with a job_id. Stochastic: contrastivevi depends on seed, and cpca's silhouette selection uses k-means. Dry run returns seconds, peak_memory_gb and device without fitting.

## 8. Benchmarks

Shared protocol: all benchmarks use the same HVG set (2000 genes, proposed) and observed library sizes. Labels are used only for scoring. Each method is fitted to target and background cells together. contrastiveVI is selected by held-out ELBO on a validation split; cPCA and scPCA use their own label-free rules. Every result is repeated over at least five seeds and reported as the median, with paired differences against the best uncontrasted baseline per dataset.

### B1. Planted target subgroup in simulation (proposed)

- **Goal**: recover a planted target-only program across effect sizes.
- **Ground truth**: planted simulation; the subgroup indicator is fixed at generation.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Recipe-generated counts | proposed generator | scRNA-seq-like; —; set by recipe | — | Values open (section 10) |

Recipe: (1) draw shared background programs; (2) add a target-only program of effect $\delta$ in a subgroup of proportion $\pi$; (3) add per-gene NB dispersion and lognormal library sizes; (4) vary $\delta$, $\pi$ and the cell ratio, including weak effects.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI with planted subgroup | k-means (k = 2) on target cells in the salient space | maximize | primary | [R6] |
| Area under ARI versus $\delta$ | Trapezoid over the $\delta$ grid | maximize | guardrail | — |

- **Comparators**: PCA on target cells; scVI [R5]; cPCA; scPCA [R2]; contrastiveVI salient embedding.
- **Protocol**: shared protocol, one fit per $(\delta, \pi, \text{ratio})$ setting.
- **Acceptance criterion** (proposed design threshold): at a pre-stated effect size, contrastive ARI is at least 0.8 while PCA stays below 0.5; the crossover effect size is reported per method.
- **Known pitfalls**: simulating from the NB model that contrastiveVI fits favours it, so use a different dispersion or dropout; background variance near the target effect makes PCA and cPCA look alike.

### B2. Background leakage in the same simulation (proposed)

- **Goal**: check that the salient space carries no structure specific to background-only subgroups.
- **Ground truth**: planted; the B1 generator adds a background-only subgroup whose indicator is fixed at generation, scored on background cells.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B1 generator with a background subgroup | proposed generator | as B1 | — | Same seeds as B1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI of the background subgroup | k-means (k = 2) on background cells in the salient space, against the indicator | minimize | primary | [R6] |
| Scaled silhouette of the background subgroup | $(\mathrm{ASW}+1)/2$ on background cells in the salient space | minimize | guardrail | [R7] |

- **Comparators**: contrastiveVI salient encoder output for background cells; cPCA salient projection; the same ARI in the background latent as the scale reference.
- **Protocol**: project background cells with each fitted model; a salient score close to the background-latent score indicates leakage.
- **Acceptance criterion** (proposed): ARI in the salient space at or below 0.05, and at least 0.1 absolute lower than in the background latent.
- **Known pitfalls**: contrastiveVI never decodes background cells with salient information, so leakage is controlled only by the KL and penalty terms; subgroups that co-vary with depth appear in both spaces.

### B3. Cell-cycle removal with preserved induction contrast (extended)

- **Goal**: remove a background-dominant cell-cycle effect while keeping the oncogene-induction contrast, starting from the OSCA example.
- **Ground truth**: cell-cycle phase is a score-based label from the OSCA chapter, inferred from expression and so partly circular; induction status is recorded. Both are categorical per cell.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 416B, loaded through OSCA.workflows (lun-416b) | [R8], OSCA cell-cycle chapter | single-cell RNA-seq; —; — | — | Induced cells as target, wild-type as background |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cell-cycle ARI | k-means on the embedding against inferred phase | minimize | primary | [R6] [R8] |
| Induction ARI | Same clusters against recorded induction status | maximize | guardrail | [R6] |

- **Comparators**: PCA of all cells; cPCA with wild-type background at OSCA settings (n_eigen 10, contrast 100, penalty 0) [R8]; contrastiveVI with wild-type background.
- **Protocol**: both ARIs are reported across embedding dimensions and contrast or salient settings, as a trade-off curve.
- **Acceptance criterion** (proposed): cell-cycle ARI falls by at least 50% relative to PCA of all cells, while induction ARI stays at or above 0.8 times the PCA value.
- **Known pitfalls**: the wild-type background differs from induced cells in more than cell cycle, so removal may also remove signal; one dataset gives little evidence of generality.

### P1. Performance and scaling

Wall time to fit and to embed, peak host and GPU memory, and throughput at 10k, 100k and 1M cells (target plus background) on CPU and CUDA. Comparators: PCA of target cells, scVI, contrastiveVI, closed-form cPCA on the same HVG set, and scPCA with its default grid of 40 by 20 pairs (800 fits per call). Hold fixed: 2000 HVGs, latent sizes 10 and 10, batch size 128, a fixed epoch count, thread count and hardware. Report time per epoch separately from total time.


## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `normalization.count_noise_model_selection`: Count noise-model selection and zero-inflation diagnosis
- **Feeds**:
  - `clustering.cluster_stability`: Cluster stability under resampling and perturbation
  - `dim-reduction.pc_gene_association_testing`: Testing which genes drive each principal component
  - `perturbation.global_phenotype_detection`: Perturbation-level transcriptional phenotype (hit) calling
- **Reads**: `layers/counts`, `obs/<group_key>`, `obs/<batch_key>`
- **Writes**: `obsm/contrastive_salient`, `obsm/contrastive_background`, `varm/contrastive_loadings`, `models/contrastive`, `uns/contrastive_setting`
<!-- CHAINING:AUTO:END -->

Workflow: the step after cell-level quality control and normalisation, used for case-control and perturbation contrasts; no named recipe is assigned yet.

## 10. Risks, pitfalls and open questions

- **Unverified evidence.** The benchmark datasets and numbers of the contrastiveVI paper and the model of Jones et al. [R4] are outside this document, so the claim that contrastiveVI beats cPCA or scVI on label separation is unestablished. The contrastiveVI tutorial dataset is unidentified locally. A Norman et al. 2019 Perturb-seq dataset recalled in the catalogue entry is absent from the local index and needs an accession before use.
- **Unsettled literature.** No community benchmark is established. The target-label benchmark on case-control or perturbation datasets is omitted because no dataset can be named, so B1 to B3 carry the accuracy evidence. Confounding by donor and batch remains open, and the choice of salient dimension is unsettled.
- **Technical and data risks.** The code does not show whether qs_v in the contrastiveVI penalty is a variance or a scale. scPCA's selection when n_centers is NULL, its default, is not described here. Luecken et al. appear as 2021 in one local record and 2022 in another. The scvi-tools author list is partial, the OpenProblems NMI normalisation variant is unknown, and the 416B citation and accession are not captured.
- **First experiment.** Fix the B1 simulator sizes and grids, fit contrastiveVI and cPCA under the shared protocol, and check B2 before any real dataset is used. If the salient gain over PCA does not appear on B1, the model-based route is not justified over cPCA.

## 11. References

R1. Abid A, Zhang MJ, Bagaria VK, Zou J. Exploring patterns enriched in a dataset with contrastive principal component analysis. *Nature Communications* 2018;9:2134. doi:10.1038/s41467-018-04608-8 — partial (repo)
R2. Boileau P, Hejazi NS, Dudoit S. Exploring high-dimensional biological data with sparse contrastive principal component analysis. *Bioinformatics* 2020;36(11):3422-3430. doi:10.1093/bioinformatics/btaa176 — verified (corpus)
R3. Weinberger E, Lin C, Lee SI. Isolating salient variations of interest in single-cell data with contrastiveVI. *Nature Methods* 2023. doi:10.1038/s41592-023-01955-3 — verified (corpus)
R4. Jones A, Townes FW, Li D, Engelhardt BE. Contrastive latent variable modeling with application to case-control sequencing experiments. *Annals of Applied Statistics* 2022;16(3):1268-1291. doi:10.1214/21-AOAS1534 — verified (corpus)
R5. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R6. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R7. Luecken MD, Büttner M, Chaichoompu K, Danese A, Interlandi M, Mueller MF, Strobl DC, Zappia L, Dugas M, Colomé-Tatché M, Theis FJ. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R8. Amezquita RA, et al. Orchestrating single-cell analysis with Bioconductor, cell-cycle chapter. Online book, 2020. — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/suinleelab/contrastiveVI | Ethan Weinberger, Chris Lin, AIMS Lab (LICENSE copyright line) | BSD-3-Clause (LICENSE file) | original contrastiveVI code, version 0.2.0; design reference | port |
| https://github.com/scverse/scvi-tools | Yosef Lab, Weizmann Institute of Science (LICENSE copyright line) | BSD-3-Clause (LICENSE file) | maintained scvi.external ContrastiveVI; SCVI comparator | port (contrastiveVI); callout (scVI) |
| https://github.com/PhilBoileau/scPCA | Philippe Boileau (author, maintainer, copyright holder); Nima Hejazi (author) | MIT with file LICENSE (DESCRIPTION) | cPCA source (fitCPCA) and scPCA comparator | port (cPCA); callout (scPCA) |
