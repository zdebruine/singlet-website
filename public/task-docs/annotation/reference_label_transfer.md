---
id: annotation.reference_label_transfer
title: Reference-based cell label transfer
area: annotation
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [harmonization.gene_identifier_mapping, normalization.variance_stabilizing_transform, feature-selection.reference_mapping_features, annotation.cell_ontology_mapping]
feeds: [annotation.annotation_confidence_calibration, annotation.novel_cell_type_detection, annotation.hierarchical_annotation, annotation.consensus_annotation]
reads: [layers/counts, layers/normalized, obs/<label_key>, obs/<batch_key>, obs/<cluster_key>, var/<gene_id>, var/<feature_key>, models/<name>]
writes: [obs/transfer_label_<method>, obs/transfer_label_<method>_<level>, obs/transfer_score_<method>, obs/transfer_unassigned_<method>, obsm/transfer_latent_<method>, uns/transfer_params_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_annotation_reference_label_transfer
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Reference-based cell label transfer

> Assign each query cell a cell-type label from an annotated reference, with a per-cell score and an unassigned flag, and measure how often the labels are right when the query comes from a study, donor or platform the reference never contained.

## 1. Question

Given a labelled reference (an expression matrix with a cell-type column, or a saved classifier or reference model) and a query matrix on shared gene identifiers, which reference type does each query cell belong to, at one or more label granularities, with what score, and which cells should be left unassigned? A correct answer agrees with expert annotation of the query made independently of the reference, and leaves unassigned the cells the reference cannot explain. Independent truth is rarely available, so the field uses annotations of held-out studies as the proxy [R1][R3].

## 2. Why this task matters and where the field stands

Manual cell-type annotation is slow and hard to reproduce, so new datasets are routinely mapped to an existing reference [R2][R3]; the best-practices chapter treats automated labels as a starting point to be checked [R3].

The catalogue lists this task as routine; here it is **contested**: within one dataset several tools work, but across studies, platforms and donors the field disagrees on method, metric and unknown cell types.

- **Method family.** Abdelaal et al. compared 22 methods on 27 public scRNA-seq datasets; a general-purpose support vector machine ranked best overall and most methods did worse on complex datasets with overlapping classes or deep annotation [R4]. The chapter summarises the benchmarks as showing comparable performance across classifier types [R3].
- **Reference quality.** Atlas-trained classifiers may be more robust than single-dataset ones, for example CellTypist trained on the Human Lung Cell Atlas (14 lung datasets) [R3][R5].
- **Cross-atlas matching.** Hu et al. benchmark seven tools (Azimuth, CellTypist, CellHint, FR-Match, scArches, scPred, SingleR) across ten organ systems; in the lung case study, matching accuracy varied, especially for rare cell types [R6].
- **Granularity.** Automated annotations can disagree between their own coarse and fine levels [R3].

Open problems. Closed-set output carries no novelty flag, so unknown types receive a known label (hence the unassigned output). Softmax and one-vs-rest scores are not calibrated after a change of study, so abstention thresholds need held-out studies. OpenProblems label_projection holds out one batch per draw [R1]; random within-study holdouts do not separate donor, study and platform shift. Methods need counts or log-normalised values, with no consensus preparation protocol. No independent benchmark of single-cell to spatial label transfer at 100 to 1000 genes is known (section 10). singlet's catalogue (about 354 million cells, about 40% annotated, the project's figures) allows study-level holdouts.

## 3. Theory and insight

### 3.1 Problem, outputs and truth

The reference is $\{(x_i,b_i,y_i)\}_{i=1}^{n_r}$ with $y_i\in\{1,\dots,K\}$ at one label level and optional batch $b_i$; the query is $\{x_j\}_{j=1}^{n_q}$ with $x_j\in\mathbb R^{F}$ over the $F$ selected genes. A method yields scores $s_{jk}$, a label and an abstention:

$$\hat y_j=\arg\max_k s_{jk},\qquad u_j=\mathbf 1\!\left[\max_k s_{jk}<\tau\right].$$

The score is method specific (a probability only where section 6 says so) and $u_j=1$ asserts no type. The ground truth $y_j$ is the author or expert annotation of cell $j$ at the stated level, used only in evaluation; accuracy is the fraction of evaluated cells with $\hat y_j=y_j$, unassigned cells counting as errors (section 8). Regime: closed set ($y_j\in\{1,\dots,K\}$), shared label granularity, a shift the feature space absorbs. The argmax rule never abstains under a closed set, so each abstention is an extra decision to be validated on held-out studies.

### 3.2 Heuristic families

**Correlation to type profiles (SingleR).** The legacy implementation scores type $l$ for cell $j$ as a quantile of Spearman correlations to the reference samples $\mathcal M_l$ of that type over genes $G$ selected by differential expression between type means:

$$S_{jl}=Q_{0.8}\bigl\{\rho_S(x_{j,G},\,r_{m,G}):m\in\mathcal M_l\bigr\},\qquad \hat y_j=\arg\max_l S_{jl}.$$

Types within 0.05 of the maximum are re-scored on genes that differ among them, repeating until one type remains [R7]. Rank correlation is unchanged by strictly increasing transformations of the query vector, so library-size scaling and log transformation do not change the labels; it is not invariant to gene-wise detection changes, the typical platform shift. Regime: genes in $G$ detected at similar rates in query and reference, enough reference samples per type. Failures: few detected genes (ties at zero), near-ties between related types.

**Nearest centroid and neighbours (scmap, k-NN).** scmap-cluster takes the centroid with highest cosine, Pearson and Spearman similarity, needs two of three to agree and a maximum above a threshold; scmap-cell searches a product-quantisation index and accepts the nearest cell's type if its similarity exceeds a threshold and the $w$ nearest neighbours share one type [R8]. A k-NN vote on a reference PCA is the general baseline [R1]. Regime: meaningful distances after feature selection, adequate density per type, index error small relative to between-type margins. Dense types win votes; batch shift moves the query away from same-type reference cells.

**Anchors (Seurat).** Mutual nearest neighbours are found between the reference and the query projected onto the reference PCA. The score of type $k$ is the anchor-weighted label fraction

$$s_{jk}=\frac{\sum_{a\in\mathcal A_j} w_{ja}\,\mathbf 1[y_a=k]}{\sum_{a\in\mathcal A_j} w_{ja}},$$

with $w_{ja}$ from the distance to the $k_{\mathrm{weight}}$-th anchor times the anchor score under a Gaussian kernel of bandwidth $\mathrm{sd}_{\mathrm{weight}}$ [R9][R10]. Anchors correct local shift that plain correlation does not; they fail where types overlap in the shared space or cells have few anchors.

### 3.3 Linear classifiers

CellTypist standardises query genes with the reference means and standard deviations (clipped at 10) and fits, for each type, an L2-penalised logistic regression one-vs-rest [R11]:

$$\min_{w_k,b_k}\ \tfrac12\lVert w_k\rVert^2+C\sum_{i=1}^{n_r}\log\!\bigl(1+e^{-s_{ik}(w_k^\top z_i+b_k)}\bigr),\qquad s_{ik}=2\,\mathbf 1[y_i=k]-1,$$

up to the solver's intercept convention, with $z_i$ the standardised vector. The score $\sigma(w_k^\top z_j+b_k)$ is one of $K$ independent logistic outputs: the scores do not sum to one and are not calibrated across studies. Probability match keeps every type above $p_{\mathrm{thres}}$ (zero, one or several per cell); majority voting replaces each label by its over-cluster's dominant label (Heterogeneous below `min_prop`), which can overwrite correct calls in mixed clusters. Regime: reference large relative to $F$, identical feature computation in query and reference, class boundaries still valid in the query.

singlet's **linear_openset** replaces the independent scores by a multinomial softmax with temperature,

$$\hat P(y_j=k\mid x_j)=\frac{\exp(o_{jk}/T)}{\sum_{k'}\exp(o_{jk'}/T)},\qquad o_{jk}=w_k^\top z_j+b_k,$$

with $W,b$ fitted by L2-penalised multinomial cross-entropy ($C$ chosen on study-level folds), $T$ fitted by minimising held-out negative log-likelihood (temperature scaling), and $\tau$ set on held-out studies to reach a target accuracy among retained cells (0.95, proposed). Regime: linear class boundaries; calibration holds only where the held-out shifts resemble deployment.

### 3.4 Latent models and Symphony

scVI models counts with a negative-binomial likelihood given a latent $z_n$ and covariate $s_n$ [R12],

$$x_{ng}\sim\mathrm{NB}\!\bigl(\mu_{ng}=\ell_n\,\rho_g(z_n,s_n),\,\theta_g\bigr),\qquad \operatorname{Var}[x_{ng}]=\mu_{ng}+\mu_{ng}^2/\theta_g,$$

with $\ell_n$ the library size; the scvi-tools default likelihood for scANVI is the zero-inflated variant (section 4). Genes are assumed conditionally independent given $z_n,s_n$ and the decoder able to represent the batch-specific mean. scANVI adds a label classifier $q_\phi(y\mid z)$ and minimises [R13]

$$\sum_{n\in\mathcal L}\!\bigl[-\mathrm{ELBO}_n(x_n,y_n)\bigr]+\sum_{n\in\mathcal U}\!\bigl[-\mathrm{ELBO}_n(x_n)\bigr]+\alpha\sum_{n\in\mathcal L}\bigl[-\log q_\phi(y_n\mid z_n)\bigr],$$

with $\alpha$ the classification ratio (section 4). The query posterior $q_\phi(y_j=k\mid z_j)$ is meaningful only when the query latent lies in the support of the reference latent. scArches adds condition-specific weights fitted on the query while most reference weights stay frozen, then applies the reference classifier head [R14]; it needs raw counts but only close proximity of identical types, not perfect integration [R3]. Symphony builds a Harmony reference of soft cluster centroids, maps the query by soft assignment with linear corrections, and transfers labels by k-NN voting in the corrected embedding [R15]. These models give an explicit posterior, covariates and a reusable trained state at the cost of training.

### 3.5 What decides the outcome

Comparable performance across families [R3][R4], matching accuracy that varies across lung matches, especially for rare types [R6], and dependence on reference-query similarity and label granularity [R3] together suggest that the split and the shift matter more than the family. singlet therefore selects and tunes on study-level holdouts, reports the unassigned rate next to accuracy, and treats abstention as part of the model rather than a post-hoc filter.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| celltypist_best, celltypist_probmatch | model-based | Standardises genes with the reference scaler and fits one L2 logistic regression per type; best match takes the highest decision score, probability match keeps every type above `p_thres`; optional majority voting over over-clusters | [R11] |
| linear_openset | model-based | singlet design: multinomial logistic regression whose temperature and abstention threshold are fitted on held-out studies (section 3.3) | — |
| knn_pca | heuristic | singlet baseline: majority vote of the nearest reference cells in a PCA fitted on the reference; the OpenProblems k-NN method votes in PCA space | [R1] |
| singler | heuristic | Quantile of Spearman correlations to the reference samples of each type over pairwise-difference genes, then repeated re-scoring of near-tied types | [R7] |
| scmap_cluster | heuristic | Nearest reference-cluster centroid under cosine, Pearson and Spearman similarity; two of three must agree and the maximum must exceed a threshold | [R8] |
| scmap_cell | heuristic | Product-quantisation index; nearest cell's type accepted if its similarity exceeds a threshold and the $w$ nearest neighbours agree | [R8] |
| seurat_transfer | heuristic | Mutual-neighbour anchors between the reference and the query projected onto the reference PCA; anchor-weighted label scores | [R9][R10] |
| scanvi | model-based | scVI variational autoencoder with a categorical label; labelled reference and unlabelled query in one model; classifier head gives the posterior | [R12][R13] |
| scarches | model-based | Trained scVI/scANVI reference extended by query-specific weights fitted on the query; reference classifier head predicts | [R14] |
| symphony | hybrid | Harmony reference of soft cluster centroids; query mapped without re-integration; labels by k-NN voting (k=5) in the corrected embedding | [R15] |

CellTypist (the chapter's worked example [R3]) and SingleR (the long-standing correlation heuristic [R7]) are the comparators of the acceptance criteria. The live OpenProblems task lists SingleR but not CellTypist, which singlet adds [R1]. Seurat anchors, scArches and Symphony are the query-to-reference mappers the chapter names [R3]. The other OpenProblems methods are comparators in B1 only.

Exact defaults of the methods singlet implements (OpenProblems rows are the task's own calls):

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| CellTypist | `mode`, `p_thres`, `majority_voting`, `min_prop` | best match, 0.5, False, 0 | `celltypist/annotate.py:14-16,19` @ fe35756 |
| CellTypist | query input | AnnData `.X` must be log1p of counts per 10,000 (error on negative values or values above 9.22 in the first 1,000 rows; warning if the expm1 row sum differs from 10,000 by more than 1); count files are normalised internally | `celltypist/classifier.py:302-303,310-313,326` @ fe35756 |
| CellTypist | query scaling | reference scaler mean and SD, clipped at 10 | `celltypist/classifier.py:371-374` @ fe35756 |
| CellTypist | score, best-match label | expit of the decision function; argmax of the decision function | `celltypist/models.py:155-157` @ fe35756 |
| CellTypist | `C`, `use_SGD`, `feature_selection`, `top_genes`, classifier | 1.0, False, False, 300, one-vs-rest `LogisticRegression` | `celltypist/train.py:126,197,199,205` @ fe35756 |
| CellTypist | Heterogeneous rule | dominant fraction below `min_prop` | `celltypist/classifier.py:492-494` @ fe35756 |
| SingleR (legacy) | `genes`, `quantile.use`, `fine.tune`, `fine.tune.thres`, `sd.thres` | "de", 0.8, TRUE, 0.05, 1 | `R/SingleR.R:193-197` @ 0ad570e |
| SingleR (legacy) | correlation; minimum genes in a fine-tuning round | Spearman; 20 (fewer returns the top label) | `R/SingleR.R:92-96` @ 0ad570e |
| SingleR (OpenProblems) | call | Bioconductor `SingleR::SingleR(test, ref, labels)`, no further arguments, log-CP10k input | `src/methods/singler/script.R:32-36`, `config.vsh.yaml:16` @ f37b604 |
| Seurat | `FindTransferAnchors`: `reduction`, `npcs`, `dims`, `l2.norm`, `k.anchor`, `k.filter`, `k.score`, `max.features` | pcaproject, 30, 1:30, TRUE, 5, NA, 30, 200 | `R/integration.R:772-783` @ 5f67c70 |
| Seurat | `TransferData`: `weight.reduction`, `k.weight`, `sd.weight` | pcaproject, 50, 1 | `R/integration.R:3433-3437` @ 5f67c70 |
| Seurat (OpenProblems) | `npcs`, `dims` | number of reference PCA components, 1 to `npcs`; other arguments default | `src/methods/seurat_transferdata/script.R:63-76` @ f37b604 |
| scANVI | `n_hidden`, `n_latent`, `n_layers`, `dropout_rate`, `gene_likelihood`, `use_observed_lib_size` | 128, 10, 1, 0.1, zinb, True | `src/scvi/model/_scanvi.py:119-125` @ 5555ecc (scvi-tools) |
| scANVI | `classification_ratio` ($\alpha$) | 50 | `src/scvi/train/_trainingplans.py:884` @ 5555ecc |
| scANVI | default epochs | $\max(1,\min(400,\mathrm{round}(400\cdot 20000/n_{\mathrm{obs}})))$ | `src/scvi/model/_utils.py:61-62` @ 5555ecc |
| scANVI (OpenProblems) | genes, `n_layers`, query label | 2,000 genes ranked by `hvg_score`, 2, "Unknown" | `src/methods/scanvi/script.py:13,24-28,33,47,55` @ f37b604 |
| scArches (OpenProblems) | `n_latent`, `n_layers`, `n_hidden`, `dropout_rate`, `max_epochs` | 30, 2, 128, 0.2, 200 | `src/methods/scanvi_scarches/script.py:10-14` @ f37b604 |
| scArches (OpenProblems) | reference training; query training | `train_size=0.9` with early stopping; `weight_decay=0.0`, `max_epochs`, early stopping | `src/methods/scanvi_scarches/script.py:41-53` @ f37b604 |
| Symphony | soft clusters `K`; `knnPredict` `k`, `seed` | 100; 5, 0 | `R/buildReference.R:35`, `R/utils.R:138-143` @ 7c59059 |
| scmap | `n_features`; `scmapCluster` `threshold` | 500; 0.7 | `R/AllGenerics.R:16,96-97` @ 88515b5 |
| scmap | `scmapCell` `w`; `scmapCell2Cluster` `w`, `threshold` | 10; 3, 0.5 | `R/AllGenerics.R:118,140` @ 88515b5 |
| scmap | index `M`, `k` | $n_{\mathrm{features}}/10$ ($100$ above 1,000 features); $\lfloor\sqrt{n_{\mathrm{cells}}}\rfloor$ | `R/CoreMethods.R:190-203` @ 88515b5 |
| knn_pca (proposed) | `k` | 15 | singlet design |
| linear_openset (proposed) | `C`, target retained accuracy | chosen on study-level folds; 0.95 | singlet design |

## 5. Proposed singlet approach

- **Routes** (licences in section 12). Port CellTypist, Seurat anchor transfer, scANVI and scArches; reimplement SingleR, scmap and Symphony; linear_openset and knn_pca are new. The OpenProblems task is the harness and comparator only. Ported code is the numerical oracle for parity tests.
- **Default method.** celltypist_best: model-based, permissive licence, published defaults, no training with a pretrained model. It changes to linear_openset only if that meets the B2 acceptance criterion.
- **Model-based formulation.** linear_openset (section 3.3): a multinomial linear classifier whose temperature and threshold are fitted on held-out studies, so abstention is part of the model. Where batch shift is strong the reference is used through scanvi or scarches; study-level evaluation chooses between them.
- **What would falsify it.** Preferring linear_openset fails if its mean paired macro-F1 difference against the better of CellTypist and SingleR is below -0.01 or its lower 95% bootstrap bound below -0.02 (B2). The calibration claim fails if retained accuracy on held-out studies does not exceed overall accuracy (B2). The open-set claim fails if under 0.80 of planted novel-type cells are unassigned at the default threshold (B3). The batch-conditioning claim fails if `batch_key` does not improve macro-F1 on leave-one-platform-out (B2).
- **ML stack.** PyTorch for the scVI-family networks (mini-batch GPU training). Hand-written CUDA and cuSPARSE for the small hot models: sparse-by-dense scoring and training of linear classifiers, k-NN as a dense product plus top-k, batched rank correlation for singler, softmax and logistic-loss kernels. CPU and CUDA labels are identical for deterministic methods and agree on at least 0.99 of labels for stochastic methods at fixed seed (proposed).
- **Trained resources.** Fitted classifiers and scANVI or scArches reference models live at `models/<name>`, trained on the annotated catalogue subset split by study and platform. External CellTypist model files are user-supplied; nothing is downloaded.
- **Streaming.** Query inference runs in chunks because each label depends only on the reference model and that cell; majority voting accumulates cluster counts across chunks. scArches adaptation needs several passes over the query.
- **Defaults without asking.** `method` celltypist_best, `unassigned_threshold` null, `seed` 0, `device` auto; ask only for `reference`, `method`, `batch_key` and `unassigned_threshold`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts of query and reference; scanvi and scarches |
| read | layers/normalized | sparse float32 | log1p of counts per 10,000, query and reference; all other methods |
| read | obs/<label_key> | categorical | reference labels, finest first |
| read | obs/<batch_key> | categorical | study, donor or platform, reference and query |
| read | obs/<cluster_key> | categorical | query over-clusters for majority voting |
| read | var/<gene_id> | string | feature identifiers, matched exactly after harmonisation |
| read | var/<feature_key> | bool | feature mask, reference and query |
| read | models/<name> | model | saved scANVI or scArches reference, or CellTypist model |
| write | obs/transfer_label_<method> | categorical | label at the first level of `reference.label_keys` |
| write | obs/transfer_label_<method>_<level> | categorical | one column per further level |
| write | obs/transfer_score_<method> | float32 | score; range per method below |
| write | obs/transfer_unassigned_<method> | bool | true when the cell is unassigned |
| write | obsm/transfer_latent_<method> | float32 | mapped embedding (scanvi, scarches, symphony) |
| write | uns/transfer_params_<method> | record | resolved method, reference handle, feature-list hash, thresholds, library versions, seed |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Query dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. Outputs are written here only. |
| `reference` | object | required | — | Labelled reference. Read-only; nothing is downloaded. |
| `reference.source` | string | — | — | Reference dataset handle, saved reference model models/<name>, or CellTypist model file. |
| `reference.label_keys` | array | — | — | Reference obs columns to predict, finest first; the first is the main label. Required when source is a dataset. |
| `method` | string | "celltypist_best" | `celltypist_best`, `celltypist_probmatch`, `linear_openset`, `knn_pca`, `singler`, `seurat_transfer`, `scmap_cluster`, `scmap_cell`, `scanvi`, `scarches`, `symphony` | Transfer method. celltypist_best is the default; linear_openset is the singlet multinomial classifier with a threshold calibrated on held-out studies. |
| `batch_key` | string/null | null | — | Obs column naming study, donor or platform in reference and query. Used by scanvi, scarches, symphony and linear_openset; ignored by the others. |
| `unassigned_threshold` | number/null | null | min 0; max 1 | Score below which a cell is unassigned. Null keeps the method default: calibrated for linear_openset, none for argmax-only methods. |
| `features` | object | — | — | Gene selection for feature-based methods; celltypist methods and singler use all shared genes. |
| `features.key` | string/null | null | — | Boolean var column present in reference and query that selects genes; overrides n_top. |
| `features.n_top` | integer | 2000 | min 50 | Number of highly variable genes ranked on the reference only. |
| `celltypist` | object | — | — | Options used only when method is celltypist_best or celltypist_probmatch. |
| `celltypist.majority_voting` | boolean | false | — | Replace each label by the dominant label of its over-cluster in cluster_key. |
| `celltypist.cluster_key` | string/null | null | — | Query obs column of over-clusters; required when majority_voting is true. |
| `celltypist.min_prop` | number | 0 | min 0; max 1 | Minimum dominant fraction of a cluster; below it the cluster label is Heterogeneous. |
| `scvi` | object | — | — | Options used only when method is scanvi or scarches. Null takes the per-method default. |
| `scvi.n_latent` | integer/null | null | min 2 | Latent dimension; null gives 10 for scanvi and 30 for scarches. |
| `scvi.n_hidden` | integer | 128 | min 8 | Hidden units per layer. |
| `scvi.n_layers` | integer/null | null | min 1 | Hidden layers; null gives 1 for scanvi and 2 for scarches. |
| `scvi.dropout_rate` | number/null | null | min 0; < 1 | Dropout rate; null gives 0.1 for scanvi and 0.2 for scarches. |
| `scvi.max_epochs` | integer/null | null | min 1 | Maximum epochs; null gives the scvi-tools epoch heuristic for scanvi and 200 with early stopping for scarches. |
| `seed` | integer | 0 | — | Random seed for scanvi, scarches, symphony and the linear_openset folds and initialisation; recorded in uns/transfer_params_<method>. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. scanvi and scarches training needs CUDA at atlas scale. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing members of the same method instead of failing. |
<!-- PARAMS:AUTO:END -->

Each method writes the same members:

| Method | Label rule | Score written | Unassigned by default |
|---|---|---|---|
| celltypist_best | argmax decision score | maximum sigmoid score, $[0,1]$, not normalised | never |
| celltypist_probmatch | highest score among types at or above `p_thres` (0.5) | maximum sigmoid score | no type at or above `p_thres`; cells with several types counted as `n_multi_label_cells` in `summary` |
| linear_openset | argmax of the softmax | maximum calibrated probability, $[0,1]$ | probability below calibrated $\tau$ |
| knn_pca | majority of the 15 nearest cells | fraction of neighbours with the winning label | never |
| singler | final type after re-scoring | first-round score of that type, $[-1,1]$ | never |
| scmap_cluster | centroid type with at least two agreeing similarities | maximum similarity | similarity below 0.7 or no agreement |
| scmap_cell | type of the nearest cell | maximum similarity | similarity below 0.5 or the 3 nearest cells differ |
| seurat_transfer | argmax anchor-weighted score | maximum score, $[0,1]$ | never |
| scanvi, scarches | argmax of the classifier head | maximum posterior, $[0,1]$ | never |
| symphony | k-NN vote in the corrected embedding | winning-vote proportion | never |

`features.n_top` applies to linear_openset, knn_pca, seurat_transfer, scmap_cluster, scmap_cell, scanvi, scarches and symphony; the CellTypist methods and singler use all shared genes, and `features.key` overrides `n_top`. A non-null `unassigned_threshold` replaces the method's own threshold and is applied to the score above. The layer follows the method; a missing layer is an error. `celltypist.cluster_key` is required with majority voting. `scvi.*` applies to scanvi and scarches. A saved model supplies labels and genes, so `label_keys` is then ignored.

## 7. MCP tool

Tool name `singlet_annotation_reference_label_transfer` (definition in `tasks/mcp/singlet_annotation_reference_label_transfer.json`).

```json
{"dataset": "/data/query.singlet", "method": "celltypist_best",
 "reference": {"source": "/data/reference.singlet", "label_keys": ["cell_type", "cell_type_coarse"]}}
```

```json
{
  "dataset": "/data/query.singlet", "status": "completed",
  "wrote": ["obs/transfer_label_celltypist_best", "obs/transfer_label_celltypist_best_cell_type_coarse",
            "obs/transfer_score_celltypist_best", "obs/transfer_unassigned_celltypist_best",
            "uns/transfer_params_celltypist_best"],
  "summary": {"method": "celltypist_best", "layer_used": "normalized", "n_query_cells": "<int>",
              "n_types": "<int>", "n_shared_genes": "<int>", "n_genes_missing": "<int>",
              "unassigned_fraction": "<float>", "top_labels": [{"label": "<string>", "fraction": "<float>"}],
              "warnings": []},
  "provenance_id": "<id>", "job_id": null
}
```

Angle-bracket fields are placeholders for the shape, not measurements. Long-running: scanvi and scarches queue a job when the reference model must be trained; the other methods complete inline. Stochastic: scanvi, scarches, symphony and the linear_openset folds, through `seed`. Dry run: returns `seconds`, `peak_memory_gb` and `device` for the chosen method and sizes.

## 8. Benchmarks

**Shared protocol.** For $N$ evaluated cells with truth $y_j$ and prediction $\hat y_j$, an unassigned cell is a prediction matching no type. $\mathrm{Acc}=N^{-1}\sum_j\mathbf 1[\hat y_j=y_j]$; $\mathrm{F1}_{\mathrm{macro}}=|\mathcal C|^{-1}\sum_{k\in\mathcal C}2P_kR_k/(P_k+R_k)$ over the types $\mathcal C$ present in the truth, so unassigned adds no class (the OpenProblems metric averages over the union of true and predicted labels, so a predicted type absent from the truth adds an F1 of 0 [R1]); undefined precision or recall counts as 0; F1 arguments are (truth, prediction). $\mathrm{F1}_{\mathrm{weighted}}=\sum_k (n_k/N)\mathrm{F1}_k$. Without abstention micro-F1 equals accuracy. Resampling units are held-out studies (B2) or draws (B1); intervals are 95% bootstrap intervals; stochastic methods use seeds 0 to 4; methods that accept a feature set all receive the same one.

### B1. OpenProblems label_projection (published, held-out batch)

- **Goal**: whether a method predicts the cell types of a held-out batch as accurately as the live comparators of the task [R1].
- **Ground truth**: expert labels, the original-study `cell_type` annotation of the common dataset, written to `obs['label']` of the solution (`src/data_processors/process_dataset/script.py:12,54-58` @ f37b604); per-cell truth at the finest level, scored as the fraction of test-batch cells.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_immune_cell_atlas | test resource of the task repository, `scripts/create_datasets/test_resources.sh` [R1] | scRNA-seq; species and size — | — | the full collection is built from the path in `scripts/create_datasets/resources.sh` |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| accuracy | $\mathrm{Acc}$ on the held-out batch | higher, 0 to 1 | primary | [R1] |
| f1_macro | $\mathrm{F1}_{\mathrm{macro}}$ computed as the OpenProblems metric does | higher, 0 to 1 | primary | [R1] |
| f1_weighted | $\mathrm{F1}_{\mathrm{weighted}}$ | higher, 0 to 1 | guardrail | [R1] |
| unassigned fraction | share of test cells with $u_j=1$; reported for methods with an abstention | report | guardrail | — |

- **Comparators**: controls majority_vote, random_labels, true_labels; the 18 methods in `src/methods` @ f37b604 (knn, logistic_regression, mlp, naive_bayes, xgboost, singler, seurat_transferdata, scanvi, scanvi_scarches, cellmapper_linear, cellmapper_scvi, scimilarity, scimilarity_knn, scgpt_zeroshot, scgpt_finetuned, geneformer, uce, scprint); CellTypist best match is added by singlet.
- **Protocol**: the processor holds out `num_test_batches` batches (default 1) drawn with `random.sample` on the batch column, seed default `None` (`script.py:10,28-30,45-48`). singlet fixes seeds 0 to 4 for five draws and reports the mean and bootstrap interval over draws.
- **Acceptance criterion** (proposed): over the five draws, the mean accuracy and the mean macro-F1 of linear_openset are each at least the mean of the better of celltypist_best and singler minus 0.01.
- **Known pitfalls**: one held-out batch per draw gives high variance, and the batch column mixes donor, study and laboratory effects.

### B2. Leave-one-study-out and leave-one-platform-out transfer (proposed)

- **Goal**: label transfer when the query study or platform is absent from the reference.
- **Ground truth**: held-out author annotation of the query study, mapped to Cell Ontology terms by `annotation.cell_ontology_mapping`; unmapped cells are excluded and counted. Metrics are computed per held-out study, then averaged.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Human Lung Cell Atlas | [R5]; 14 constituent datasets [R3] | scRNA-seq, human lung; size — | — | leave-one-dataset-out |
| singlet catalogue, annotated subset | project resource | scRNA-seq, snRNA-seq, several tissues; size — | per source study | tissues with 3 or more studies of 5,000 or more annotated cells (proposed) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| accuracy, macro-F1 | $\mathrm{Acc}$, $\mathrm{F1}_{\mathrm{macro}}$ per held-out study | higher | primary | — |
| retained accuracy | $\mathrm{Acc}$ among cells with $u_j=0$ at the default threshold, minus overall $\mathrm{Acc}$ | higher | guardrail | — |
| unassigned fraction | share of cells with $u_j=1$ | report | guardrail | — |
| per-type recall | $\mathrm{TP}_k/(\mathrm{TP}_k+\mathrm{FN}_k)$ with support $n_k$ | higher | guardrail | — |

- **Comparators**: celltypist_best, celltypist_probmatch, singler, seurat_transfer, scmap_cell, scanvi, scarches, symphony, knn_pca.
- **Protocol** (generator recipe): (1) map study labels to Cell Ontology terms; (2) per study $s$, reference = other studies of the same tissue, query = $s$ with labels hidden; (3) rank highly variable genes on the reference only; (4) fit the linear_openset temperature and $\tau$ by inner leave-one-study-out inside the reference; (5) repeat leaving out one platform at a time; (6) hold out each atlas dataset in turn.
- **Acceptance criterion** (proposed): mean paired macro-F1 difference of linear_openset against the better of celltypist_best and singler at least -0.01 with lower 95% bound at least -0.02; unassigned fraction at the default threshold at most 0.10; retained accuracy above 0.
- **Known pitfalls**: author labels may come from CellTypist-like tools, making agreement partly circular (hypothesis); large studies dominate pooled accuracy.

### B3. Planted types with held-out novel types (proposed)

- **Goal**: closed-set accuracy and abstention under controlled reference-query shift when the query contains types absent from the reference.
- **Ground truth**: planted simulation; truth is the generator's type; cells of held-out types $N$ have truth "novel" and the correct output is unassigned. Accuracy is normalised over cells of the known types $T$; the novel-cell rate over cells of $N$.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| negative-binomial counts fitted per type to the Human Lung Cell Atlas | generator recipe below; fit source [R5] | scRNA-seq-like counts; size set by the generator grid | — | a simulator that normalises by library size is circular for methods that normalise the same way |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| accuracy on $T$ | $\mathrm{Acc}$ restricted to cells with truth in $T$ | higher | primary | — |
| macro-F1 on $T$ | $\mathrm{F1}_{\mathrm{macro}}$ over types in $T$ | higher | primary | — |
| novel unassigned rate | share of cells of $N$ with $u_j=1$ at the default threshold | higher | guardrail | — |

- **Comparators**: those of B2.
- **Protocol** (generator recipe): (1) fit a negative-binomial mean and dispersion per type; (2) per seed, draw $N$ as 20% of the types, $T$ the rest; (3) simulate the reference from $T$ and the query from $T$ and $N$ at equal numbers per type; (4) shift the query by per-gene multiplicative factors and a dropout level from a grid fixed beforehand; (5) five seeds per grid point; (6) the default threshold comes from B2, never from $N$.
- **Acceptance criterion** (proposed): on $T$, accuracy within 0.01 of the best comparator at every shift level; on $N$, at least 0.80 of cells unassigned at the default threshold.
- **Known pitfalls**: simulated structure is easier than real structure, so B3 cannot rank methods alone; the shift grid is not tuned on the acceptance simulations.

### P1. Performance and scaling

Wall time, peak memory (GB) and throughput (query cells per second) for reference/query sizes of 1e5/1e4, 1e6/1e5 and 1e6/1e6, plus 1e6/1e7 for the pretrained-model path to test streaming, on CPU and CUDA, with 2,000 features, thread count, normalisation and label set fixed; training and mapping time are reported separately. Comparators: SingleR, Seurat anchor transfer, scmap-cell and CellTypist on CPU; scANVI and scArches on GPU; Symphony; knn_pca. Acceptance (proposed): CPU peak memory of linear_openset and celltypist_best grows linearly in query size at fixed reference size (log-log slope reported) and stays flat under streaming; CUDA and CPU labels are identical for deterministic methods and agree on at least 0.99 of labels for stochastic methods at fixed seed. Pitfalls: host-device transfer is included or excluded depending on the harness, so both are reported; scmap index memory grows with the reference, not the query.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
  - `feature-selection.reference_mapping_features`: Feature selection for reference mapping and label transfer
  - `annotation.cell_ontology_mapping`: Cell type name harmonization to Cell Ontology terms
- **Feeds**:
  - `annotation.annotation_confidence_calibration`: Annotation and label-transfer confidence calibration and abstention
  - `annotation.novel_cell_type_detection`: Novel or unseen cell type detection and out-of-distribution scoring for query cells
  - `annotation.hierarchical_annotation`: Hierarchical, ontology-aware coarse-to-fine annotation
  - `annotation.consensus_annotation`: Consensus annotation across methods or annotators
- **Reads**: `layers/counts`, `layers/normalized`, `obs/<label_key>`, `obs/<batch_key>`, `obs/<cluster_key>`, `var/<gene_id>`, `var/<feature_key>`, `models/<name>`
- **Writes**: `obs/transfer_label_<method>`, `obs/transfer_label_<method>_<level>`, `obs/transfer_score_<method>`, `obs/transfer_unassigned_<method>`, `obsm/transfer_latent_<method>`, `uns/transfer_params_<method>`
<!-- CHAINING:AUTO:END -->

No named workflow is assigned. Typical order: gene identifier mapping, normalisation and reference-mapping feature selection, this task, then confidence calibration, novelty detection, hierarchical and consensus annotation. Cluster naming from markers is a separate task.

## 10. Risks, pitfalls and open questions

- **SingleR version.** The repository read is the 2019 legacy implementation, which its README says is no longer maintained; the OpenProblems comparator calls the Bioconductor release, whose defaults were not read. Agreement between singler and the Bioconductor release is untested; B1 treats the release as an external comparator.
- **Evidence not read.** Per-tool accuracies and dataset lists of Hu et al. [R6] and the dataset names and sizes of Abdelaal et al. [R4] (only abstract-level facts are used); the OpenProblems dataset collection beyond the test resource; the methods sections of the primary papers for the implemented methods (descriptions follow repository code, READMEs and the best-practices chapter [R3]); dataset licences. The corresponding table cells show —.
- **Calibration and circularity.** Softmax and one-vs-rest scores are not calibrated across studies, so $\tau$ is fitted on held-out studies and re-checked when the reference changes. Catalogue author annotations may derive from CellTypist-like tools (hypothesis), and random holdouts within one study are expected to overstate cross-study accuracy.
- **Preprocessing and gene overlap.** A query prepared with the wrong normalisation gives systematically different scores without an error; the tool selects the layer by method, rejects a mismatch, and records the layer and the number of reference genes missing from the query in `summary`. Majority voting is off by default because it can overwrite correct per-cell calls.
- **Targeted-panel and spatial queries.** No independent benchmark of single-cell to spatial label transfer at 100 to 1000 genes is known. A proposed first design is a panel-subset simulation from a dissociated reference with a segmentation-spillover grid, compared against deconvolution tools used at cell level.
- **Catalogue facts and first experiment.** The 354 million cells and 40% annotated are the project's own figures; B2 needs a study inventory and data-licence review before any size is reported. First experiment: linear_openset against celltypist_best on the B2 leave-one-study-out split with five seeds, reporting unassigned fraction and per-type recall with macro-F1.

## 11. References

R1. Open Problems for Single Cell Analysis Consortium. Open Problems: label_projection task. https://openproblems.bio; task repository openproblems-bio/task_label_projection at commit f37b604 (README authors Markov N, Gigante S, Cannoodt R). — verified (repo)

R2. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023;24:550-572. doi:10.1038/s41576-023-00586-w — verified (corpus)

R3. Heumos L, Schaar A, single-cell best practices consortium. Single-cell best practices, annotation chapter (theislab/single-cell-best-practices at commit d581689, `jupyter-book/cellular_structure/annotation.ipynb`). https://sc-best-practices.org — partial (repo)

R4. Abdelaal T, Michielsen L, Cats D, Hoogduin D, Mei H, Reinders MJT, Mahfouz A. A comparison of automatic cell identification methods for single-cell RNA sequencing data. *Genome Biology* 2019;20:194. doi:10.1186/s13059-019-1795-z — verified (corpus)

R5. Sikkema L, Ramírez-Suástegui C, Strobl DC, et al. An integrated cell atlas of the lung in health and disease. *Nature Medicine* 2023. doi:10.1038/s41591-023-02327-2 — verified (corpus)

R6. Hu J, Peng B, Pankajam AV, et al. Benchmarking single cell transcriptome matching methods for incremental growth of reference atlases. *bioRxiv* 2025. doi:10.1101/2025.04.10.648034 — partial (search)

R7. Aran D, Looney AP, Liu L, et al. Reference-based analysis of lung single-cell sequencing reveals a transitional profibrotic macrophage. *Nature Immunology* 2019. doi:10.1038/s41590-018-0276-y — partial (repo)

R8. Kiselev VY, Yiu A, Hemberg M. scmap: projection of single-cell RNA-seq data across data sets. *Nature Methods* 2018. doi:10.1038/nmeth.4644 — partial (repo)

R9. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)

R10. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)

R11. Domínguez Conde C, Xu C, Jarvis LB, et al. Cross-tissue immune cell analysis reveals tissue-specific features in humans. *Science* 2022. doi:10.1126/science.abl5197 — verified (corpus)

R12. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)

R13. Xu C, Lopez R, Mehlman E, Regier J, Jordan MI, Yosef N. Probabilistic harmonization and annotation of single-cell transcriptomics data with deep generative models. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209620 — verified (corpus)

R14. Lotfollahi M, Naghipourfar M, Luecken MD, et al. Mapping single-cell data to reference atlases by transfer learning. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-01001-7 — verified (corpus)

R15. Kang JB, Nathan A, Weinand K, et al. Efficient and precise single-cell reference atlas mapping with Symphony. *Nature Communications* 2021. doi:10.1038/s41467-021-25957-x — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/dviraran/SingleR | Dvir Aran (author and maintainer in DESCRIPTION) | GPL 3.0 (DESCRIPTION); LICENSE file is GNU GPL version 3 | legacy SingleR implementation read for singler; the README directs users to the Bioconductor release | reimplement |
| https://github.com/hemberg-lab/scmap | Vladimir Kiselev (author, maintainer), Andrew Yiu (contributor), Martin Hemberg (author) per DESCRIPTION | GPL-3 (DESCRIPTION); LICENSE file is GNU GPL version 3 | scmap_cluster, scmap_cell | reimplement |
| https://github.com/satijalab/seurat | Seurat authors (LICENSE copyright holder); contributors in DESCRIPTION | MIT (DESCRIPTION and LICENSE) | seurat_transfer | port |
| https://github.com/Teichlab/celltypist | Chuan Xu (setup.py author); Teichmann Lab (LICENSE copyright) | MIT (LICENSE) | celltypist_best, celltypist_probmatch | port |
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml); Yosef Lab (LICENSE copyright) | BSD-3-Clause (LICENSE) | scanvi and the scVI machinery of scarches | port |
| https://github.com/theislab/scarches | Mohammad Lotfollahi, Theislab (LICENSE copyright) | BSD-3-Clause (LICENSE); setup.py declares MIT | original scArches package, reference for scarches | port under the BSD-3-Clause text |
| https://github.com/immunogenomics/symphony | Joyce Kang (author, maintainer), Ilya Korsunsky, Soumya Raychaudhuri (DESCRIPTION) | GPL (>= 3) (DESCRIPTION); LICENSE.md is GNU GPL version 3 | symphony | reimplement |
| https://github.com/openproblems-bio/task_label_projection | Nikolay Markov, Scott Gigante, Robrecht Cannoodt (README) | MIT (LICENSE) | B1 benchmark definition and comparators | callout |
