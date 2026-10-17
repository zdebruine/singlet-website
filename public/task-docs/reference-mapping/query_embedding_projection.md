---
id: reference-mapping.query_embedding_projection
title: Query embedding into a frozen reference
area: reference-mapping
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [reference-mapping.reference_construction, feature-selection.reference_mapping_features, dim-reduction.normalized_cell_embedding, dim-reduction.deep_generative_latent_embedding]
feeds: [annotation.reference_label_transfer, annotation.novel_cell_type_detection, annotation.annotation_confidence_calibration, embedding-viz.out_of_sample_placement]
reads: [layers/counts, var/<gene_id>, obs/<batch_key>, models/<ref_name>, uns/<ref_name>_symphony, obsm/X_<ref_name>, obs/<ref_label_key>]
writes: [obsm/X_query_<ref_name>, obsm/<ref_name>_label_prob, obsp/query_to_ref_connectivities, obs/<ref_name>_label_pred, obs/<ref_name>_label_conf, obs/<ref_name>_novelty, uns/<ref_name>_mapping]
devices: [cpu, cuda]
mcp_tool: singlet_reference_mapping_query_embedding_projection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Query embedding into a frozen reference

> Place new query cells into a fixed reference embedding by linear projection or probabilistic encoding, and report their coordinates, label predictions and novelty scores without rebuilding the reference.

## 1. Question

Given a frozen reference (gene statistics, a reference embedding, a neighbour index and labels, or a trained model) and the raw counts of a query, where do the query cells fall in the reference space, so that each query cell's nearest reference cells match those found when reference and query are analysed together? Inputs are query counts and reference artefacts; outputs are query coordinates, a query-to-reference neighbour graph, label predictions with a confidence and a novelty score. A correct answer gives neighbourhoods that agree with joint re-analysis and labels that match expert annotation on held-out studies.

## 2. Why this task matters and where the field stands

Status: **contested**. Atlas reuse needs new studies mapped onto a fixed reference without rebuilding it. Two families exist. Linear methods project query cells onto reference loadings and apply a fitted batch correction; they are fast and deterministic [R1][R2]. Probabilistic methods freeze a trained reference model and fit new batch parameters on the query [R3][R5][R6]. Both transfer labels. Each method paper evaluates on its own design, and no shared query-only benchmark for this task exists in the cited literature, so there is no accepted measure of placement quality.

Open problems:

- Cell types absent from the reference are forced onto the nearest reference state and receive confident labels; neither family gives calibrated placement or label uncertainty [R3][R6].
- Batch effects missing from the correction covariates persist, and linear correction can remove biology that is confounded with batch [R1].
- Placement is judged against a joint re-analysis, which is itself a method output, so the target is circular unless several integrators are used [R2][R4].
- Queries with little reference overlap can be placed spuriously [R3]. Cross-technology mapping, such as snRNA-seq queries into an scRNA-seq reference, has no evaluation among the cited works.

## 3. Theory and insight

A frozen reference $\mathcal R$ holds gene means $m_g$ and standard deviations $\sigma_g$, loadings $V$ ($d=20$ components by default), reference coordinates $Z_R$, $K=100$ centroids $\mu_k$, correction terms $W_k$, a neighbour index, labels and, for deep methods, trained weights $\theta_{\rm ref}$. A query is raw counts $c_{gi}$ with batch design $b_i$.

**Linear family.** Counts are normalised, scaled against the reference, projected and unit-normalised:

$$\tilde x_{gi}=\log\!\Bigl(1+10^{4}\frac{c_{gi}}{\sum_{g'}c_{g'i}}\Bigr),\qquad s_{gi}=\frac{\tilde x_{gi}-m_g}{\sigma_g},\qquad z_i=V^{\top}s_i,\qquad \hat z_i=\frac{z_i}{\lVert z_i\rVert_2}$$

Reference genes absent from the query are matched through `idx_shared_genes` (`R/mapQuery.R:39`); their handling in the scaling step was not read (section 10).

Soft cluster assignment follows the Harmony form [R2], on unit-normalised query coordinates and centroids (`soft_cluster`, src/utils.cpp:20-28):

$$R_{ik}=\frac{\exp(-\lVert\hat z_i-\mu_k\rVert_2^2/\sigma)}{\sum_{k'}\exp(-\lVert\hat z_i-\mu_{k'}\rVert_2^2/\sigma)},$$

with $\mu_k$ also unit-normalised. Query correction (`moe_correct_ref`, src/utils.cpp:56-88) starts from the unnormalised PCA coordinate $z_i$. For each cluster $k$ it fits a coefficient matrix $\beta_k$ on the query cells, using the design columns $x_i$ (intercept first), $D_k=\mathrm{diag}(R_{\cdot k})$ over query cells, and the cached reference terms $N_{r,k}$ and $c_k$ (row $k$ of `RrZtr`, from `compute_ref_cache`, src/utils.cpp:37-46):

$$\beta_k=\bigl(X_qD_kX_q^{\top}+\Lambda_k\bigr)^{-1}\bigl(X_qD_kZ_q^{\top}+e_1c_k^{\top}\bigr),\qquad \Lambda_k=\mathrm{diag}(N_{r,k},1,\dots,1),$$

$$z_i^{\rm corr}=z_i-\sum_{k=1}^{K}R_{ik}\,\beta_k^{\top}x_i,$$

where $Z_q$ is the $d\times m$ matrix of query PCA coordinates, $e_1$ is the first unit vector, and the intercept row of each $\beta_k$ is set to zero. The identity penalty on non-intercept coefficients is fixed in the reference code (src/utils.cpp:76-78) and takes no argument. Regime: linear within each soft cluster and fitted on the query batch; $\sigma\to 0$ gives hard assignment.

**Deep family.** The reference model has latent $z_n$, library size $\ell_n$ and batch $s_n$:

$$z_n\sim\mathcal N(0,I_d),\qquad x_{gn}\mid z_n,\ell_n,s_n\sim\mathrm{NB}(\mu_{gn},\theta_g),\qquad \mu_{gn}=\ell_n\,\rho_g(z_n,s_n),$$

with $\rho_g$ a softmax-normalised decoder output. Reference training maximises $\mathcal L(x_n)=\mathbb E_{q_\phi(z_n\mid x_n,s_n)}[\log p_\theta(x_n\mid z_n,s_n)]-\mathrm{KL}(q_\phi\|\mathcal N(0,I_d))$ (library term omitted). Query surgery freezes $\theta_{\rm ref}$ and fits only the new batch parameters $\theta_b$ on the query set $\mathcal Q$:

$$\hat\theta_b=\arg\max_{\theta_b}\sum_{n\in\mathcal Q}\mathcal L\bigl(x_n;\theta_{\rm ref}^{\rm frozen},\theta_b\bigr).$$

Regime: raw counts on a fixed gene set; small queries overfit, so placements depend on epoch count and weight decay.

**Trust.** Neighbourhood preservation is scored by trustworthiness

$$T(k)=1-\frac{2}{nk(2n-3k-1)}\sum_{i}\sum_{j\in U_k(i)}\bigl(r(i,j)-k\bigr),$$

where $U_k(i)$ holds cells among the $k$ nearest neighbours of $i$ in the embedding but not in the original space, and $r(i,j)$ is the rank of $j$ in the original space [R10]. Regime: rank-based, so invariant to monotone rescaling of distances.

**Estimands of the outputs.**

- Query coordinate $q_i$: for symphony, the corrected PCA coordinate $z_i^{\rm corr}$ from `moe_correct_ref` (`R/mapQuery.R:88-98`), not unit-normalised (the unit-normalised $\hat z_i$ serves only the soft assignment); for deep methods, the unnormalised encoder mean $\mathbb E_{q_\phi}[z_i]$.
- Label probability $p_i(c)$: the fraction of the $k_{\rm label}$ nearest reference cells carrying label $c$, in $[0,1]$; for scanvi_query, the classifier probability $q_\psi(c\mid z_i)$.
- Label confidence $\max_c p_i(c)$, in $[0,1]$.
- Novelty $\nu_i=d_k(q_i)/\operatorname{median}_{r\in\mathcal R}d_k(z_r)$, where $q_i$ is the query coordinate above and $d_k$ is the distance to the $k$-th nearest reference cell (the cell itself excluded); a value near 1 is typical of the reference.
- Query-to-reference graph: unweighted directed edges from each query cell to its $k$ nearest reference cells.

**Failure modes.** Linear methods fail when query genes are missing from the reference set, when batch effects lie outside the correction covariates, and when a new type lands on the nearest centroid and receives a confident wrong label. Deep methods fail when counts are log-normalised (the NB likelihood is then wrong), when a small query overfits surgery, and when the gene set changes between reference and query. The probabilistic formulation adds a likelihood that scores query fit, posterior variance for placement uncertainty, and reuse of one trained model across queries through surgery, instead of per-cluster refits.

**Insight.** Mapping does not need perfect integration; it needs cells of the same type to land near each other, so neighbourhood purity in the reference decides labels. The linear path is deterministic because the reference is compressed once, and surgery trades training time for absorbing new batch structure with few parameters. Both break on new biology and on technical variation that the reference was never fitted to.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Symphony | hybrid | Reference-scaled PCA projection, cosine soft clusters on reference centroids, and a per-cluster linear batch correction fitted on the query with cached reference sums; the reference is never refitted | [R1], [R2] |
| scArches surgery on scVI | model-based | Frozen reference VAE; new batch parameters fitted by maximising the reference bound on query cells | [R3], [R4] |
| scANVI query training | model-based | Semi-supervised VAE with a label head; query cells enter through the unlabelled bound | [R5] |
| scPoli | model-based | Conditional VAE with study embeddings added for new studies, and latent cell-type prototypes | [R6] |
| kNN in reference PCA | heuristic | k-nearest-neighbour label vote in the reference embedding | Symphony `knnPredict`, R/utils.R:138 @ 7c59059 |
| Seurat anchor transfer (comparator) | heuristic | Mutual-nearest-neighbour anchors and an anchor-weighted label vote | [R8], [R9] |
| scmap-cell (comparator) | heuristic | Signature index over selected features (size M) and a vote over the w nearest indexed cells | [R7] |

Symphony [R1] and scArches [R3] are the published references for the linear and the probabilistic family, and scANVI [R5] and scPoli [R6] extend the probabilistic one. Seurat anchor transfer and scmap are kept as heuristic comparators, since each is a published projection method with released code. kNN in reference PCA is the baseline in every benchmark. CellMapper and ProjecTILs are not listed because their code was not read.

Exact defaults for the methods singlet implements, and for the comparators whose settings the benchmarks reproduce:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Symphony | soft-cluster fuzziness sigma | 0.1 | immunogenomics/symphony R/mapQuery.R:28 @ 7c59059 |
| Symphony | soft clusters K | 100 | R/buildReference.R:35 @ 7c59059 |
| Symphony | principal components d | 20 | R/buildReference.R:45 @ 7c59059 |
| Symphony | variable genes | 2000 | R/buildReference.R:41 @ 7c59059 |
| Symphony | label vote k | 5 | R/utils.R:140 @ 7c59059 |
| Symphony | query correction penalty on non-intercept coefficients | 1 (fixed, no argument) | src/utils.cpp:76-78 @ 7c59059 |
| scVI / scArches | freeze expression; freeze batch-norm encoder, decoder; unfrozen | True; True, False; False | scverse/scvi-tools src/scvi/model/base/_archesmixin.py:48-61 @ 5555ecc |
| scArches (reproduction) | latent / hidden / layers / dropout | 30 / 128 / 2 / 0.2 | openproblems-bio/task_label_projection src/methods/scanvi_scarches/script.py @ f37b604 |
| scArches (reproduction) | max epochs / train size / query weight decay | 200 / 0.9, early stopping / 0.0 | same file; query weight decay at :53 |
| scPoli | training batch size / weight decay | 128 / 0.04 | theislab/scarches scarches/trainers/scpoli/trainer.py:88, :125 @ d35cde6 |
| Seurat (comparator) | anchor dims / k.anchor / k.score | 1:30 / 5 / 30 | satijalab/seurat R/integration.R:764-783 @ 5f67c70 |
| Seurat (comparator) | k.weight / sd.weight | 50 / 1 | R/integration.R:3427-3437 @ 5f67c70 |
| Seurat (reproduction) | anchor dims | all training PCs | openproblems-bio/task_label_projection src/methods/seurat_transferdata/script.R:63-68 @ f37b604 |
| scmap (comparator) | selected features | 500 | hemberg-lab/scmap R/AllGenerics.R:16 @ 88515b5 |
| scmap (comparator) | hyperplanes M; index neighbours k | n_features/10 if at most 1000, else 100; floor(sqrt(cells)) | R/CoreMethods.R:192-197, :201-202 @ 88515b5 |
| scmap (comparator) | vote neighbours w (scmapCell) | 10 | R/AllGenerics.R:118 @ 88515b5 |

## 5. Proposed singlet approach

**Routes.** Symphony is reimplemented from the published equations [R1][R2], because its source is copyleft and is not copied. The scvi-tools surgery and query training [R13], and the scArches scPoli training code, are ported into singlet's PyTorch path, subject to the licence check in section 12. The kNN baseline is reimplemented as a GEMM and partial sort. Seurat and scmap are callouts, used only as benchmark comparators.

**Proposed model.** singlet trains one conditional VAE on the annotated catalogue with batch or study embeddings. A query is mapped by (a) amortised encoding through the frozen encoder, (b) optional surgery that fits only new batch embeddings with the decoder frozen, and (c) placement uncertainty from the posterior variance. The model is falsified if it does not meet the B2 acceptance criterion, or if its nominal 90% placement intervals differ from 0.90 coverage by more than 0.05 on the B2 held-out studies (proposed threshold).

**Stack.** PyTorch for the conditional VAE and surgery, where training is real. Hard-coded CUDA or cuSPARSE kernels for the small, hot operations: sparse normalisation and gene-by-component projection (SpMM with dense loadings), soft assignment (GEMM and row softmax), the per-cluster ridge correction (K small GEMMs), and brute-force top-k search in latent space (GEMM and partial sort). The linear path costs about $G_{\rm var}d+Kd+KBd$ multiply-adds per query cell, with $B$ the number of batch covariates; this is derived from the operations listed here and not measured.

**Execution.** The reference is loaded once. Query cells are processed in chunks, so the linear path's memory scales with chunk size rather than query size. Deep surgery trains on minibatches of the query, so its memory follows batch size and model width.

**Defaults for agents.** Method symphony, sigma 0.1, lambda_ridge 1, k_label 5, correct true, k_neighbors 15, device auto. Use a deep method only with a saved reference model; scanvi_query also needs a labelled reference. knn_baseline is the fallback when the symphony artefacts are absent.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Query raw counts; required by every method |
| read | var/<gene_id> | string | Gene identifiers matched to the reference gene set |
| read | obs/<batch_key> | category | Query batch covariate for correction and surgery |
| read | models/<ref_name> | model | Frozen reference weights for deep methods |
| read | uns/<ref_name>_symphony | dict | Loadings, gene means and SDs, centroids, correction terms |
| read | obsm/X_<ref_name> | float32 | Reference coordinates used for neighbour search |
| read | obs/<ref_label_key> | category | Reference labels; the key is recorded in the reference artefact |
| write | obsm/X_query_<ref_name> | float32 | Query coordinates in the reference space |
| write | obsm/<ref_name>_label_prob | float32 | Label probabilities, cells by labels |
| write | obsp/query_to_ref_connectivities | sparse bool | Unweighted query-to-reference kNN edges |
| write | obs/<ref_name>_label_pred | category | Predicted label |
| write | obs/<ref_name>_label_conf | float32 | Label confidence, in [0, 1] |
| write | obs/<ref_name>_novelty | float32 | Novelty ratio; 1 for a typical reference cell |
| write | uns/<ref_name>_mapping | dict | Method, parameters, model hash, gene overlap fraction |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Query dataset handle: a .singlet path or URI, or a workspace handle. Outputs are written here only. |
| `ref_name` | string | required | — | Name of the frozen reference artefacts to use (models, uns and obsm members). Required; no default. |
| `method` | string | "symphony" | `symphony`, `scarches_scvi`, `scanvi_query`, `scpoli`, `knn_baseline` | Mapping method. symphony is the default; deep methods need a saved reference model. |
| `batch_key` | string/null | null | — | Query obs column naming batch or study; used by symphony correction and deep-model query training. |
| `k_neighbors` | integer | 15 | min 2 | Reference neighbours per query cell for the query-to-reference graph and the novelty score. |
| `symphony` | object | — | — | Options used only when method is symphony. |
| `symphony.sigma` | number | 0.1 | > 0 | Soft-assignment fuzziness; smaller values approach hard cluster assignment. |
| `symphony.lambda_ridge` | number | 1 | min 0 | Ridge penalty on the non-intercept coefficients of the query batch correction. The reference code fixes it at 1 (src/utils.cpp:76-78) and takes no argument. |
| `symphony.k_label` | integer | 5 | min 1 | Reference neighbours in the label vote. |
| `symphony.correct` | boolean | true | — | Apply the per-cluster batch correction; false returns the linear PCA projection. |
| `scvi` | object | — | — | Options used only by scarches_scvi and scanvi_query. |
| `scvi.freeze_expression` | boolean | true | — | Keep reference expression weights frozen during query training. |
| `scvi.max_epochs` | integer | 200 | min 1 | Maximum query training epochs. |
| `scvi.query_weight_decay` | number | 0 | min 0 | Weight decay during query training. |
| `scpoli` | object | — | — | Options used only by scpoli query training. |
| `scpoli.batch_size` | integer | 128 | min 1 | Training minibatch size. |
| `scpoli.weight_decay` | number | 0.04 | min 0 | Weight decay during query training. |
| `seed` | integer | 0 | min 0 | Random seed for deep-model query training; symphony mapping is deterministic. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Parameters are grouped by method. `symphony.*` applies only to method symphony, and `correct` set to false gives the linear PCA projection used as a comparator in B2. `scvi.*` applies to scarches_scvi and scanvi_query, and `scpoli.*` to scpoli. Reference construction settings (K, d, variable genes, Harmony diversity) belong to reference-mapping.reference_construction and are fixed in the artefact. Raw counts are required for every method; a low `gene_overlap_fraction` in the summary signals a gene-set mismatch.

## 7. MCP tool

Tool name `singlet_reference_mapping_query_embedding_projection` (definition in `tasks/mcp/singlet_reference_mapping_query_embedding_projection.json`).

Example call:

```json
{"dataset": "my_query.singlet", "ref_name": "my_reference", "method": "symphony", "batch_key": "study"}
```

Example result:

```json
{"dataset": "my_query.singlet", "status": "completed", "wrote": ["obsm/X_query_my_reference", "obsm/my_reference_label_prob", "obsp/query_to_ref_connectivities", "obs/my_reference_label_pred", "obs/my_reference_label_conf", "obs/my_reference_novelty", "uns/my_reference_mapping"], "summary": {"method": "symphony", "n_query_cells": "<int>", "gene_overlap_fraction": "<0-1>", "novelty_median": "<float>"}, "provenance_id": "<id>"}
```

Long-running: deep methods may return status queued with a job_id; symphony normally completes inline. Stochastic: deep methods depend on seed, while symphony is deterministic for a fixed reference. Dry run: returns an estimate with seconds, peak_memory_gb and device, and writes nothing.

## 8. Benchmarks

**Shared protocol.** Each split holds out one study from the singlet catalogue as the query and builds the reference from all other studies. The reference is built once with seed 0 and then frozen. Methods receive only the query's raw counts and batch covariate. Deep methods are fitted with at least three seeds; results give the median and range over seeds, and bootstrap intervals over query cells. Metrics use query cells only unless stated. Study lists and minimum sizes are fixed in the benchmark registry before any comparison; hardware and thread counts are reported with each result. Leave-one-type-out novelty scoring is specified in annotation.novel_cell_type_detection and is not repeated here.

### B1. Held-out-study label projection

- **Goal**: Measure how often a query cell's predicted label equals its author label when its study is absent from the reference.
- **Ground truth**: Expert labels, meaning the author annotations of the held-out study collapsed to the label set shared with the reference. The estimand is the fraction of evaluated query cells whose predicted label equals this collapsed label; unassigned predictions count as errors (proposed convention).
- **Datasets**

| Dataset | Source (reference [R#], accession or URL if known) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Author-annotated studies of the singlet catalogue, each held out in turn | singlet catalogue (354M cells, about 40% author-annotated) | scRNA-seq and snRNA-seq; species as catalogued | — | Study list and minimum size fixed in the registry; stratified by cell-type composition |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Accuracy | Fraction of evaluated query cells whose predicted label equals the truth | higher, 0 to 1 | primary | [R12] |
| Macro F1 | Mean over labels present in the truth of 2PR/(P+R) per label; predicted-only labels count as false positives | higher, 0 to 1 | primary | [R12] |
| Weighted F1 | Per-label F1 weighted by label support in the truth | higher, 0 to 1 | guardrail | [R12] |

- **Comparators**: Symphony (correct true and false), scarches_scvi, scanvi_query, scpoli, knn_baseline, and the Seurat and scmap callouts; versions are listed in section 12.
- **Protocol**: Shared protocol; the label set is collapsed before scoring, and no query labels are used to fit anything.
- **Acceptance criterion**: Proposed: accuracy within 0.02 of the best query-only comparator on the same split, and macro F1 at least that of knn_baseline.
- **Known pitfalls**: Concatenating train and test cells, as the OpenProblems scanvi method does (`src/methods/scanvi/script.py:34`), is transductive and must not be reported as query-only mapping. Accuracy rewards majority types, so report macro F1 and per-label F1 for rare types.

### B2. Joint re-analysis neighbourhood agreement

- **Goal**: Test whether a query cell's reference neighbours in the mapped space match its reference neighbours when reference and query are embedded together.
- **Ground truth**: Consistency. For query cell $i$, $N^{\rm joint}_k(i)$ is its $k$ nearest reference cells in a joint embedding built by Harmony [R2] and, separately, by scVI retrained on reference plus query [R4]. The estimand is $O_k=\frac{1}{n_q}\sum_i |N^{\rm map}_k(i)\cap N^{\rm joint}_k(i)|/k$, in $[0,1]$, with $k=15$.
- **Datasets**

| Dataset | Source (reference [R#], accession or URL if known) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Held-out catalogue studies, split as in B1 | singlet catalogue | as in B1 | — | A joint embedding is built per split and integrator |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Overlap $O_{15}$ | As defined above; ties broken by reference index; if fewer than k reference cells exist, all are used | higher, 0 to 1 | primary | — |
| Trustworthiness $T(15)$ | Trustworthiness of mapped coordinates over query and reference cells, with the joint embedding as the original space and Euclidean ranks | higher, 0 to 1 | guardrail | [R10] |
| Graph connectivity | $\frac{1}{\lvert C\rvert}\sum_c \lvert\mathrm{LCC}(G(N_c))\rvert/\lvert N_c\rvert$ on the reference-plus-query kNN graph | higher, 0 to 1 | guardrail | [R11] |
| iLISI | Local inverse Simpson index over batch, rescaled to 0 to 1 | higher, 0 to 1 | guardrail | [R2], [R11] |

- **Comparators**: As in B1; versions are listed in section 12.
- **Protocol**: Overlap is computed in the latent or corrected PCA space, never in UMAP. Results are reported by query size and by the fraction of query types present in the reference. Reference-only neighbourhoods are recomputed in the joint embedding as a control, because joint re-analysis moves reference cells.
- **Acceptance criterion**: Proposed: median $O_{15}$ of at least 0.70 over splits where at least 80% of query types are in the reference, and at least 0.05 above the linear PCA projection, for both integrators. Guardrails are reported without a threshold.
- **Known pitfalls**: The integrator defines the target, so Harmony and scVI disagreement is reported as a result rather than averaged away. UMAP coordinates discard neighbourhood information for this metric.

### B3. Planted batch shift and novelty recovery (proposed)

- **Goal**: Test label recovery, novelty detection and placement under a planted query batch shift of known size.
- **Ground truth**: Planted by construction: each cell's state, its novelty flag (the withheld state) and its batch. The estimand for placement error is $\mathbb E_i\lVert\hat z_i-\bar z_{s_i}\rVert_2/\rho_R$, where $\bar z_s$ is the mean reference position of planted state $s$ and $\rho_R$ is the root-mean-square distance of reference cells from their centroid.
- **Generator recipe** (design values chosen for this benchmark, not literature values):
  1. Draw $G=2000$ genes and $S=8$ state profiles with log-means $\eta_{sg}\sim\mathcal N(0,1)$.
  2. Reference: $B=3$ batches with batch effects $\beta_{bg}\sim\mathcal N(0,\sigma_\beta^2)$, $\sigma_\beta=0.1$.
  3. Library sizes $\ell_n$ are log-normal with log-SD 0.3; counts are $x_{gn}\sim\mathrm{NB}(\ell_n\exp(\eta_{s_ng}+\beta_{b_ng}),\phi)$ with dispersion $\phi=0.5$.
  4. Withhold one state $s^*$ from the reference, chosen by seed.
  5. Query: one batch with additive shift $m\,\sigma_\beta\gamma_g$, $\gamma_g\sim\mathcal N(0,1)$, for $m\in\{0,1,2,3\}$, containing all $S$ states.
  6. Output: reference and query counts, states, novelty flags, batch labels and planted state centroids.
- **Datasets**

| Dataset | Source (reference [R#], accession or URL if known) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated reference and query, recipe steps 1 to 6 | singlet generator (this document) | simulated counts; — | — | Seeds fixed in the registry |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Label recovery | Fraction of query cells from the $S-1$ shared states whose predicted label equals the planted label | higher, 0 to 1 | primary | [R12] |
| Novelty AUROC | Area under the ROC curve of $\nu_i$ for withheld-state cells against shared-state cells | higher, 0 to 1 | primary | — |
| Placement error | Estimand above, over shared-state query cells | lower | guardrail | — |

- **Comparators**: As in B1.
- **Protocol**: For each $m$, map the query and score the three metrics. A second count model, with a different family from the NB generator, serves as a control.
- **Acceptance criterion**: Proposed: novelty AUROC of at least 0.90 and label recovery of at least 0.90 on shared states at $m=2$.
- **Known pitfalls**: Planted structure is easier than real batch effects, and the withheld state must be separable for novelty to be detectable. The NB generator matches the scVI likelihood, which favours the deep methods; the second count model is the control for this.

### P1. Performance and scaling

Measure wall time, peak memory and throughput (query cells per second) for reference load and index build, per-query mapping, and training in scarches_scvi, scanvi_query and scpoli. Query sizes are $10^4$, $10^5$ and $10^6$ cells, plus $10^7$ for symphony, which carries the streaming claim. Reference sizes are $10^5$ and $10^6$ cells, plus one larger catalogue reference fixed in the registry. Report CPU core count and CUDA GPU model. Hold fixed the reference gene set (2000 variable genes and 20 components for linear methods; latent size 30 for VAE methods), batch size and thread count. Comparators are symphony and knn_baseline on CPU, scarches_scvi, scanvi_query and scpoli on CUDA, and the Seurat and scmap callouts on CPU. Report scaling curves rather than single numbers. Linear per-cell cost is expected to stay near constant after the reference load, while surgery cost grows with query size through training epochs.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `reference-mapping.reference_construction`: Reusable reference construction and compression
  - `feature-selection.reference_mapping_features`: Feature selection for reference mapping and label transfer
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.deep_generative_latent_embedding`: Deep generative latent embedding of cells from counts
- **Feeds**:
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
  - `annotation.novel_cell_type_detection`: Novel or unseen cell type detection and out-of-distribution scoring for query cells
  - `annotation.annotation_confidence_calibration`: Annotation and label-transfer confidence calibration and abstention
  - `embedding-viz.out_of_sample_placement`: Out-of-sample placement of new cells on a fixed 2D map
- **Reads**: `layers/counts`, `var/<gene_id>`, `obs/<batch_key>`, `models/<ref_name>`, `uns/<ref_name>_symphony`, `obsm/X_<ref_name>`, `obs/<ref_label_key>`
- **Writes**: `obsm/X_query_<ref_name>`, `obsm/<ref_name>_label_prob`, `obsp/query_to_ref_connectivities`, `obs/<ref_name>_label_pred`, `obs/<ref_name>_label_conf`, `obs/<ref_name>_novelty`, `uns/<ref_name>_mapping`
<!-- CHAINING:AUTO:END -->

Part of the reference-mapping workflow: build a frozen reference, map queries into it, then label or flag novel cells.

## 10. Risks, pitfalls and open questions

- The scmap-cell hashing scheme is not in the clone's R or C++ code, so its table row names only the signature size and the vote. Handling of reference genes absent from the query, beyond the match at `R/mapQuery.R:39`, was not read.
- The scANVI soft-probability output was not located in the repository, and the cited sources contain no calibration study for scANVI or scPoli probabilities. For this reason scPoli labels here use a kNN vote in its latent space, the scPoli prototype classifier was not read, and scANVI confidence is an uncalibrated classifier maximum.
- The Symphony reference-scale and speed claims are unverified against the paper text, so no published figure is used here.
- Catalogue species, modality mix, licence terms and the study list are not fixed in this document. The OpenProblems label_projection dataset list was not enumerated, so its public splits are not used.
- Line references point to the commits listed in section 12 as checked, not to tagged releases.
- First experiment: on one held-out catalogue study, compare symphony with correct true and false, and scarches_scvi, on $O_{15}$ and label accuracy. This decides whether the linear correction adds value before any new model is built.

## 11. References

R1. Kang JB, Nathan A, Weinand K, et al. Efficient and precise single-cell reference atlas mapping with Symphony. *Nat Commun* 2021. doi:10.1038/s41467-021-25957-x — verified (corpus)

R2. Korsunsky I, Millard N, Fan J, et al. Fast, sensitive and accurate integration of single-cell data with Harmony. *Nat Methods* 2019. doi:10.1038/s41592-019-0619-0 — verified (corpus)

R3. Lotfollahi M, Naghipourfar M, Luecken MD, et al. Mapping single-cell data to reference atlases by transfer learning. *Nat Biotechnol* 2021. doi:10.1038/s41587-021-01001-7 — verified (corpus)

R4. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nat Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)

R5. Xu C, Lopez R, Mehlman E, Regier J, Jordan MI, Yosef N. Probabilistic harmonization and annotation of single-cell transcriptomics data with deep generative models. *Mol Syst Biol* 2021. doi:10.15252/msb.20209620 — verified (corpus)

R6. De Donno C, et al. Population-level integration of single-cell datasets enables multi-scale analysis across samples. *Nat Methods* 2023. doi:10.1038/s41592-023-02035-2 (author list beyond the first author, volume and pages not confirmed) — verified (corpus)

R7. Kiselev VY, et al. scmap: projection of single-cell RNA-seq data across data sets. *Nat Methods* 2018. doi:10.1038/nmeth.4644 — verified (corpus)

R8. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)

R9. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)

R10. Venna J, Kaski S. Neighborhood preservation in nonlinear projection methods: an experimental study. In: *Artificial Neural Networks (ICANN 2001)*. 2001. doi:10.1007/3-540-44668-0_68 — verified (corpus)

R11. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nat Methods* 2021. doi:10.1038/s41592-021-01336-8 — verified (corpus)

R12. Grandini M, Bagli E, Visani G. Metrics for multi-class classification: an overview. *arXiv* 2020. doi:10.48550/arxiv.2008.05756 — verified (corpus)

R13. Gayoso A, et al. A Python library for probabilistic analysis of single-cell omics data. *Nat Biotechnol* 2022. doi:10.1038/s41587-021-01206-w — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/immunogenomics/symphony (commit 7c59059) | Joyce Kang (aut, cre); Ilya Korsunsky and Soumya Raychaudhuri (aut); per DESCRIPTION | GPL (>= 3) per DESCRIPTION; GPL-3.0 in LICENSE.md | Linear mapping reference; defaults in section 4 | reimplement |
| https://github.com/theislab/scarches (commit d35cde6) | Mohammad Lotfollahi, Theislab (LICENSE) | BSD-3-Clause in LICENSE; MIT in setup.py (conflict) | scPoli training code and surgery reference | port; both declared licences are permissive, and the BSD-3-Clause notice from LICENSE is kept |
| https://github.com/scverse/scvi-tools (commit 5555ecc) | Yosef Lab, Weizmann Institute of Science (LICENSE) | BSD-3-Clause | Query surgery and scANVI query training | port |
| https://github.com/satijalab/seurat (commit 5f67c70) | Satija Lab, NYGC (README); Seurat authors (LICENSE) | MIT + file LICENSE | Anchor-transfer comparator | callout |
| https://github.com/hemberg-lab/scmap (commit 88515b5) | Vladimir Kiselev (maintainer) | GPL-3 | scmap-cell comparator | callout |
| https://github.com/openproblems-bio/task_label_projection (commit f37b604) | Open Problems in Single-Cell Analysis (LICENSE) | MIT | Reproduction settings for the scArches, scANVI and Seurat rows | callout (settings only) |
