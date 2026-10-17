---
id: annotation.novel_cell_type_detection
title: Novel or unseen cell type detection and out-of-distribution scoring for query cells
area: annotation
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [annotation.reference_label_transfer, feature-selection.reference_mapping_features, annotation.cell_ontology_mapping]
feeds: [annotation.annotation_confidence_calibration, annotation.hierarchical_annotation, annotation.cluster_label_assignment]
reads: [layers/counts, layers/normalized, obs/<label_key>, obs/<batch_key>, obs/<calibration_mask>, obsm/<embedding_key>, models/<reference_model>]
writes: [obs/novelty_label, obs/novelty_score, obs/novelty_flag, obs/novelty_uncertainty, obs/novelty_cluster, obsm/novelty_latent, uns/novelty_report]
devices: [cpu, cuda]
mcp_tool: singlet_annotation_novel_cell_type_detection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Novel or unseen cell type detection and out-of-distribution scoring for query cells

> Score each query cell for novelty against a labelled reference, and flag cells outside the reference's known types as Unknown at a stated false-rejection rate on known cells.

## 1. Question

Given a labelled reference and a query on shared features, which query cells come from a type or state the reference does not contain, and should be left Unknown rather than forced into a known label? A correct output flags cells whose curated label is absent from the reference, keeps known cells assigned at a stated false-rejection rate, and ranks cells by novelty in a way that holds for a new study.

## 2. Why this task matters and where the field stands

Reference mapping is routine for new datasets, and the best-practices chapter treats the resulting labels as a starting point to be checked [R1]. A closed-set classifier must give every cell a known label, so an unseen type is labelled, usually with confidence, unless the method can abstain.

The field is contested because abstention is not standardised. Published defaults sit on different scales: an uncertainty of 0.2 in the scArches HLCA tutorial, which credits the HLCA work [R12], a probability of 0.55 in scPred [R3], a probability of 0.5 in CellTypist [R4] and a similarity of 0.7 in scmap [R5]. None of these values is calibrated to a stated false-rejection rate on known cells (section 10 covers the tutorial's rate statement), and the chapter notes that uncertainty scores are often imperfect and in some cases fail to highlight new cell types or states [R1].

Open problems:

- **Unseen types, unseen states and technical shift** can raise the same score, so a high score does not say which one applies.
- **Threshold portability.** A threshold tuned on one reference, embedding or platform does not carry over. The cited sources set no calibrated rejection rate.
- **Ground truth.** The OpenProblems label-projection accuracy counts a predicted Unknown as wrong unless the truth carries that label, so it measures closed-set accuracy, not novelty [R6]. Planted held-out types measure label coverage, and held-out study labels measure annotator granularity; neither isolates biological novelty.
- **Atlas-level uncertainty** is treated in an arXiv preprint [R7]; its method is outside this document.

## 3. Theory and insight

### 3.1 Estimand

Let $\mathcal K$ be the $K$ labels of the reference, and let $\ell_j$ be the curated label of query cell $j$ mapped into the reference label space. The novelty truth is $z_j=\mathbf 1[\ell_j\notin\mathcal K]$. Each output has one meaning:

- the score $s_j$ is a ranking value, higher meaning more novel, and is not normalised;
- the flag $f_j=\mathbf 1[s_j>\tau]$ applies at an operating threshold $\tau$ in the method's native scale, and is null when neither a threshold nor a calibration applies;
- the label is the argmax over $\mathcal K$ when $f_j=0$ and Unknown otherwise;
- the uncertainty $u_j$ is one minus the top posterior of equation (1), which lies between 0 and $1-1/L$ for $L$ labels among the neighbours.

For a threshold $\tau$ the operating quantities are

$$\mathrm{FRR}(\tau)=\Pr(s>\tau\mid z=0),\qquad \mathrm{TPR}(\tau)=\Pr(s>\tau\mid z=1),$$

normalised over the evaluated known cells and over the evaluated novel cells respectively. The score is judged by ranking with the tie-corrected AUROC,

$$\mathrm{AUROC}=\Pr(s_{\mathrm{nov}}>s_{\mathrm{kn}})+\tfrac12\Pr(s_{\mathrm{nov}}=s_{\mathrm{kn}}),$$

estimated by ranks over the $n_{\mathrm{nov}}n_{\mathrm{kn}}$ pairs. It is invariant to monotone transforms of $s$ and ignores prevalence, so AUPRC against the chance level $\pi=\Pr(z=1)$ is reported beside it. Regime: a closed set at one label granularity; novelty exists only relative to that granularity.

### 3.2 Scores

**kNN posterior.** Let $d_{ij}$ be the distances from query cell $i$ to its $k$ nearest reference cells, and $\sigma_i$ their standard deviation. Then

$$w_{ij}=\frac{\exp\{-d_{ij}(\sigma_i/2)^2\}}{\sum_{l\le k}\exp\{-d_{il}(\sigma_i/2)^2\}},\qquad p_i(c)=\sum_{j\le k:\,y_j=c}w_{ij},\qquad u_i=1-\max_c p_i(c),\tag{1}$$

as implemented in the scArches weighted kNN utility [R2]. Regime: fixed embedding and fixed $k$. $u_i$ is one minus the top posterior, not a probability of novelty, and it is small for cells inside a dense region of the wrong type.

**Probability rejection.** Assign $\hat c_i=\arg\max_c p_{ic}$ if $\max_c p_{ic}>\tau$, otherwise Unknown. scPred uses this rule [R3], and the prob-match mode of CellTypist applies the same threshold to each label [R4]. Regime: valid only where $p_{ic}$ is approximately calibrated, which is not guaranteed far from the reference, where abstention is needed.

**Mapping distance.** With query memberships $r_{ik}$ over reference soft clusters, and membership-weighted centroids $\mu_k$ and covariances $\Sigma_k$ in the corrected embedding,

$$m_i=\sum_{k=1}^{K}r_{ik}\sqrt{(z_i-\mu_k)^{\top}\Sigma_k^{-1}(z_i-\mu_k)},$$

the per-cell metric of Symphony [R8]. Regime: approximately Gaussian clusters with stable covariance. Under that assumption a squared distance averages the embedding dimension $d$, so the scale of $m_i$ depends on $d$ and a threshold does not transfer across embeddings.

**Likelihood or reconstruction.** $s_i=-\log p_\theta(x_i\mid\mathcal R)$, or the reconstruction error of a reference model. Regime: the tail reflects novelty only if the likelihood is correct; overdispersion or library-size effects make technical outliers look novel.

**Maximum softmax.** $s_i=1-\max_c p_\theta(c\mid x_i)$, the open-set baseline of Hendrycks and Gimpel [R9]. It is the probability rule with $\tau=1-s$.

### 3.3 Thresholds

A threshold turns a ranking into flags. Given calibration known cells with scores $s_1,\dots,s_m$, the split-conformal threshold is the $\lceil (m+1)(1-\alpha)\rceil$-th smallest of them,

$$\tau_\alpha=s_{(\lceil (m+1)(1-\alpha)\rceil)},$$

and if calibration and a new known cell are exchangeable then $\Pr(s_{\mathrm{new}}>\tau_\alpha)\le\alpha$. Regime: exchangeability holds within one donor or study and fails across batches, platforms and disease states, which is the usual deployment setting. $\alpha$ must therefore be re-estimated for each query.

### 3.4 Failure modes and what a model adds

- Rare known types with few reference cells have high $u_i$ and are rejected as novel.
- Technical shift is scored as novelty, and feature selection or PCA fitted on the query can absorb the novel signal.
- A novel type next to a known type in the embedding can keep a high-posterior known label and a low score.
- A novel subtype of a known parent is reported as the parent with normal confidence.

Heuristic scores are cheap and transparent but carry no stated error rate. A model-based formulation adds a likelihood whose tail can be fitted, an unknown class trained on withheld types, and a trained model reused across queries. Its claim is therefore calibration and reuse, not only a better ranking.

### 3.5 Insight

The threshold decides deployment more than the score does: the thresholds in section 4 sit on different scales, and none fixes a false-rejection rate. Benchmarks that plant held-out types reward scores that detect unrepresented regions and penalise scores that flag rare known states (section 8).

## 4. Methods landscape

The deployed standard is a threshold on a classifier probability or a mapping similarity (scPred, CellTypist, scmap). Model-based scores exist in scANVI, scPoli and Symphony, but the code paths cited here set no threshold from a stated error rate, so the heuristic rules stay as comparators.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scmap_cluster | heuristic | Nearest reference cluster by similarity; withheld below a threshold | [R5] |
| scpred | hybrid | Supervised classifier; withheld when the best class probability is at or below the threshold | [R3] |
| celltypist_prob | hybrid | One-vs-rest logistic models; prob-match leaves a cell unlabelled when no type reaches the threshold | [R4] |
| scarches_knn | hybrid | Kernel-weighted kNN posterior on a reference embedding; uncertainty is one minus the best posterior | [R2] |
| scanvi_uncertainty | model-based | scANVI classifier with query cells as unlabelled; singlet read-out is one minus the best class posterior | [R10] |
| symphony_mahalanobis | model-based | Membership-weighted Mahalanobis distance to reference soft clusters | [R8] |
| seurat_mapping_score | heuristic | Per-cell score from the query neighbourhood projected through reference anchors | — |
| scpoli | model-based | Conditional VAE with cell-type prototypes; unknown labels take a reserved encoder value; prototypes can be added | [R11] |
| openset_head | model-based | Singlet design, proposed: encoder with a $K{+}1$ classifier whose extra class is trained on withheld reference types, plus a prototype distance | — |
| max_softmax | heuristic | One minus the maximum class probability of any probabilistic classifier | [R9] |

Exact defaults, taken from the repositories at the stated commits. The scmap cell-to-cluster rule is included because its unassigned call can mix novelty with label noise:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| scmap_cluster | threshold | 0.7 | `R/AllGenerics.R:97` @ 88515b5 |
| scmap_cluster | unassigned rule | unassigned when the maximum is below the threshold; equality is assigned | `R/CoreMethods.R:364` @ 88515b5 |
| scmap_cell2cluster | `w`; threshold | 3; 0.5 | `R/AllGenerics.R:140` @ 88515b5 |
| scmap_cell2cluster | unassigned rule | assigned only if the maximum exceeds the threshold and the $w$ neighbours share one type | `R/CoreMethods.R:460-464` @ 88515b5 |
| scpred | threshold | 0.55 | `R/scPredict.R:32` @ af5492e |
| scpred | unassigned rule | class kept when the maximum probability exceeds the threshold | `R/scPredict.R:121` @ af5492e |
| celltypist_prob | mode; `p_thres` | best match (prob match is opt-in); 0.5 | `celltypist/command_line.py:38-39` @ fe35756 |
| celltypist_prob | zero labels | 0 labels means unassigned | `celltypist/annotate.py:47,49-51` @ fe35756 |
| scarches_knn | `n_neighbors` | 50 | `scarches/utils/knn.py:10` @ d35cde6 |
| scarches_knn | kernel | $\exp\{-d(\sigma/2)^2\}$ with $\sigma$ the standard deviation of the $k$ distances | `scarches/utils/knn.py:96-100` @ d35cde6 |
| scarches_knn | uncertainty | $\max(1-p_{\max},0)$ | `scarches/utils/knn.py:130` @ d35cde6 |
| scarches_knn | `pred_unknown`; threshold | False; 1, applied to the best posterior | `scarches/utils/knn.py:50-51,122-125` @ d35cde6 |
| scarches_knn | tutorial uncertainty threshold | 0.2, cells above set to Unknown | `notebooks/hlca_map_classify.ipynb:1722` @ d35cde6 |
| symphony_mahalanobis | `Z_orig`; metric | TRUE; mahalanobis | `R/confidenceScores.R:14` @ 7c59059 |
| symphony_mahalanobis | per-cell score | membership-weighted sum of square-root Mahalanobis distances | `R/confidenceScores.R:37,41` @ 7c59059 |
| symphony_mahalanobis | per-cluster `u`; `lambda` | 2 (times $d$); 0 | `R/confidenceScores.R:64` @ 7c59059 |
| symphony_mahalanobis | soft clusters `K` | 100 | `R/buildReference.R:35` @ 7c59059 |
| seurat_mapping_score | `mapping.score.k` | NULL; when set, query neighbours are precomputed for the score | `R/integration.R:788, 1194-1196` @ 5f67c70 |
| scanvi_uncertainty | unlabelled category among labels | ignored when it appears among the labels | `src/scvi/model/_scanvi.py:135-136` @ 5555ecc |
| scanvi_uncertainty | unlabelled category in OpenProblems scANVI | "Unknown" | `src/methods/scanvi/script.py:55` @ f37b604 |
| scpoli | unknown labels | encoder value $-1$ for unknown labels | `scarches/models/scpoli/scpoli.py:60-63` @ d35cde6 |
| scpoli | unseen query types | new prototypes initialised for unseen types | `scarches/trainers/scpoli/trainer.py:415` @ d35cde6 |
| openset_head | withheld fraction; latent size | 0.2; 30 | singlet design |

## 5. Proposed singlet approach

- **Routes** are listed per method in section 12.
- **Default method.** scarches_knn: a published rule with a reference implementation and a closed form. It is the default in every case; openset_head replaces it only if it meets the B2 acceptance criterion.
- **Model-based formulation.** openset_head is an encoder with a count likelihood fitted on the reference, a $K{+}1$ softmax head whose last class is trained on withheld reference types, and a distance head to class prototypes. Its score is the Unknown posterior and the prototype distance. The threshold is the split-conformal quantile of calibration known cells from each study (section 3.3). The claim fails if its median per-type AUROC on B2 does not exceed that of scarches_knn, or if fewer than 90% of donors meet the B4 criterion.
- **Calibration when set.** When calibration.mask is set, the threshold is the conformal quantile for target_known_fpr and the observed known rejection is written to the report. Otherwise the native threshold applies.
- **ML stack.** PyTorch for the encoder, classifier and prototype heads, trained with leave-type-out simulation. Hard-coded CUDA and cuSPARSE for the small hot kernels: k-NN search as a dense product plus top-k, batched Mahalanobis as matrix products, kernel-weighted votes, and sparse query projection.
- **Streaming.** Each score depends only on the reference index and the cell, so queries stream in chunks. Calibration needs only the calibration scores. Training is not streamed.
- **Defaults without asking.** method scarches_knn, threshold null, calibration null, keys.label cell_type, seed 0, device auto. The user supplies the reference and, for any flag claim, the calibration mask.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, needed by scanvi_uncertainty and openset_head |
| read | layers/normalized | sparse float | log-normalised values for the methods that score them |
| read | obs/<label_key> | category | reference labels |
| read | obs/<batch_key> | category | batch or donor, for batch-aware neighbours |
| read | obs/<calibration_mask> | bool | known-type cells outside reference training |
| read | obsm/<embedding_key> | float32 | embedding for distances and neighbours |
| read | models/<reference_model> | model | trained scArches, scANVI, scPoli or Symphony reference |
| write | obs/novelty_label | category | label, or Unknown when flagged |
| write | obs/novelty_score | float32 | novelty score; higher is more novel |
| write | obs/novelty_flag | bool | flag at the operating threshold; null when no threshold, default or calibration applies |
| write | obs/novelty_uncertainty | float32 | label-posterior uncertainty where the method has one |
| write | obs/novelty_cluster | category | candidate cluster of flagged cells, when cluster_novel is set |
| write | obsm/novelty_latent | float32 | query embedding when a mapping is computed |
| write | uns/novelty_report | dict | method, threshold, observed known rejection and reference types |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Query dataset handle: a .singlet path or URI, or a workspace handle. |
| `reference` | string | required | — | Reference handle: a labelled .singlet dataset, or a saved reference model under models/ for model-based methods. |
| `method` | string | "scarches_knn" | `scarches_knn`, `scanvi_uncertainty`, `symphony_mahalanobis`, `scpred`, `celltypist_prob`, `scmap_cluster`, `openset_head` | Scoring method. scarches_knn is the published default; openset_head is the proposed model-based option, used only after benchmark B2. |
| `threshold` | number/null | null | — | Flag threshold in the method's native scale; null applies the method default when no calibration is set. |
| `calibration` | object | — | — | Known-cell calibration: mask names known cells outside reference training; target_known_fpr sets their flagged fraction. |
| `calibration.mask` | string/null | null | — | obs column marking known-type cells from donors or studies not used to train the reference. |
| `calibration.target_known_fpr` | number/null | null | min 0; max 0.5 | Target flagged fraction of calibration known cells; the proposed value is 0.05. Overrides threshold. |
| `keys` | object | — | — | Obs columns naming the reference labels and the batch structure of the query. |
| `keys.label` | string | "cell_type" | — | Reference label column in obs. |
| `keys.batch` | string/null | null | — | Batch or donor column, used for batch-aware neighbours where the method supports it. |
| `cluster_novel` | boolean | false | — | Cluster flagged cells into candidate new types; clusters are not validated automatically. |
| `method_options` | object | — | — | Options nested under each method's name; entries for other methods are ignored. |
| `method_options.scarches_knn` | object | — | — | Options for the kernel-weighted kNN posterior. |
| `method_options.scarches_knn.k_neighbors` | integer | 50 | min 1 | Number of reference neighbours for the kernel-weighted posterior. |
| `method_options.scarches_knn.embedding` | string/null | null | — | obsm key of the embedding used for distances; null uses the reference latent. |
| `method_options.scanvi_uncertainty` | object | — | — | Options for the scANVI classifier uncertainty. |
| `method_options.scanvi_uncertainty.unlabelled_category` | string | "Unknown" | — | Label given to query cells during scANVI mapping; ignored if it is among the labels. |
| `method_options.symphony_mahalanobis` | object | — | — | Options for the Symphony per-cell Mahalanobis metric. |
| `method_options.symphony_mahalanobis.u` | number | 2 | min 0 | Minimum cluster size in multiples of the embedding dimension for per-cluster scores. |
| `method_options.symphony_mahalanobis.ridge` | number | 0 | min 0 | Ridge added to covariance diagonals for numerical stability. |
| `method_options.openset_head` | object | — | — | Options for the proposed model-based open-set head (singlet design). |
| `method_options.openset_head.n_latent` | integer | 30 | min 1 | Latent dimension of the encoder. |
| `method_options.openset_head.withheld_fraction` | number | 0.2 | min 0; max 1 | Fraction of reference types withheld as unknown in each training step. |
| `seed` | integer | 0 | — | Random seed for model training and any subsampling. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Each method scores one native quantity, and the threshold lies on that quantity's scale. Uncertainty, flagged when above the threshold, applies to scarches_knn, scanvi_uncertainty and openset_head. For scpred the flag is set when the best probability is at or below the threshold. For celltypist_prob the threshold is p_thres, and a cell is flagged when no label reaches it. Similarity, flagged when below, applies to scmap_cluster, and Mahalanobis distance, flagged when above, to symphony_mahalanobis. target_known_fpr overrides threshold and requires calibration.mask. Method options apply only to their own method, and cluster_novel acts only on flagged cells. scanvi_uncertainty, symphony_mahalanobis and openset_head have no published default, so their flags stay null unless a threshold or calibration is set.

## 7. MCP tool

Tool name `singlet_annotation_novel_cell_type_detection` (definition in `tasks/mcp/singlet_annotation_novel_cell_type_detection.json`). Example call and result, with placeholders in place of measured values:

```json
{"dataset": "query.singlet", "reference": "models/atlas_scarches", "method": "scarches_knn", "calibration": {"mask": "known_held_out", "target_known_fpr": 0.05}}
```

```json
{"dataset": "query.singlet", "status": "completed", "wrote": ["obs/novelty_label", "obs/novelty_score", "obs/novelty_flag", "obs/novelty_uncertainty", "uns/novelty_report"], "summary": {"n_cells": "<int>", "n_flagged": "<int>", "threshold_used": "<float>", "observed_known_fpr": "<float>"}, "provenance_id": "<id>"}
```

Long-running: training a reference or the openset_head queues a job and returns status queued; scoring a stored reference completes inline. Stochastic: training is seeded by seed (default 0), and scoring with a fixed model is deterministic. Dry run: returns seconds, peak memory and device without scoring.

## 8. Benchmarks

**Shared protocol.** Each evaluation set has known cells ($z=0$) and novel cells ($z=1$). Higher score means more novel. Operating flags use the method default, or a threshold calibrated on known cells of other donors or studies, never on novel cells. FRR and novel recall are normalised over their own cell classes. Macro-F1 is computed over the retained types plus Unknown, with Unknown the truth for novel cells, averaged over classes present in the truth. Accuracy counts Unknown as an error unless the truth is Unknown. Intervals are 95% bootstrap intervals over withheld types, studies or donors. Stochastic methods use seeds 0 to 4. Hyperparameters are tuned on types or studies excluded from reporting.

### B1. Known-type parity under rejection (OpenProblems label projection, extended)

- **Goal**: whether enabling rejection leaves accuracy on known-labelled cells unchanged, using the published label-projection metrics [R6].
- **Ground truth**: expert labels, the `label` column of the solution file used by the accuracy metric. Each test cell has one curated label; the normalisation is the fraction of test cells.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_immune_cell_atlas test resource | `resources_test/task_label_projection/cxg_immune_cell_atlas/` in [R6] | scRNA-seq; —; — | — | other common datasets are added once licensed (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| accuracy | fraction of cells whose predicted label equals the truth; Unknown counts as wrong | higher | primary | [R6] |
| F1 weighted | scikit-learn weighted F1 over labels in the truth and predictions | higher | primary | [R6] |
| F1 macro | unweighted mean F1 over the same label set | higher | guardrail | [R6] |
| rejection rate | fraction of cells labelled Unknown | lower | guardrail | — |

- **Comparators**: each OpenProblems method with rejection off, namely knn, logistic_regression, scanvi, scanvi_scarches, singler, seurat_transferdata, scimilarity_knn and cellmapper_linear [R6]; scarches_knn with calibration.
- **Protocol**: the test split of the task. Rejection is off, and for methods that expose scores it is on at the default threshold and at a threshold calibrated on known cells of the training split. F1 over non-rejected cells is a secondary view. Seeds 0 to 4 where a method is stochastic.
- **Acceptance criterion** (proposed): calibrated rejection lowers F1 weighted by at most 0.01 and rejects at most 0.05 of known cells.
- **Known pitfalls**: the benchmark does not reward a correct Unknown, so it measures cost, not benefit. Accuracy falls mechanically with rejection, so coverage is always reported beside it.

### B2. Planted leave-cell-type-out novelty (proposed)

- **Goal**: how well each score, and its default threshold, separates cells of a withheld reference type from cells of retained types.
- **Ground truth**: planted. A withheld type $T$ is removed from the reference and from every fit; a query cell is novel if its curated label is $T$. Normalisation: pairwise for AUROC, over retained cells for FRR and over $T$ cells for novel recall.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| HLCA annotated lung atlas | [R12] | scRNA-seq; human; — | — | study and donor fields are needed by B3 and B4 |
| singlet catalogue, author-annotated subset | singlet catalogue | scRNA-seq; various; — | — | selected by study; cell counts stated after checks |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC per withheld type | pairwise AUROC with $T$ cells as positives; averaged over types, with spread reported | higher | primary | — |
| AUPRC | area under the precision-recall curve, reported against prevalence $\pi$ | higher | primary | — |
| Unknown macro-F1 | macro-F1 over retained types plus Unknown | higher | primary | [R13] |
| FRR at 95% novel recall | fraction of retained cells above the threshold that flags 95% of $T$ cells; an oracle summary, not an operating point | lower | guardrail | — |
| known accuracy at 10% rejection | accuracy among unrejected retained cells when 10% of them are rejected | higher | guardrail | — |

- **Comparators**: scmap_cluster at 0.7; scpred at 0.55; celltypist_prob at 0.5; scarches_knn at 0.2 and calibrated; scanvi_uncertainty, symphony_mahalanobis and seurat_mapping_score calibrated on the score scale; scpoli scored by distance to the nearest labelled prototype (singlet choice); openset_head; max_softmax from the scPred and CellTypist probabilities; random scores.
- **Protocol**: for each atlas and each type with at least 200 cells (proposed minimum), remove the type and fit each method on the retained reference. Map withheld cells and an equal number of retained cells from donors absent from the reference. Stratify types by the median distance from their cells to the nearest retained centroid, in terciles. Tune hyperparameters on a disjoint set of types, and require each withheld type to span at least two studies.
- **Acceptance criterion** (proposed): at least one method reaches a median per-type AUROC of 0.85 or more with an FRR at 95% novel recall of 0.30 or less. Adoption requires the calibrated threshold to keep known-type FRR at or below 0.05 on B4.
- **Known pitfalls**: planted types measure label coverage, not biological novelty, and single-study types let study effects score as novelty.

### B3. Held-out study novelty (proposed)

- **Goal**: detection of populations absent from a reference built from other studies, using whole-study holdout instead of planted types.
- **Ground truth**: the held-out study's curated labels mapped by the harmonisation table frozen before scoring (annotation.cell_ontology_mapping). A cell is novel when its harmonised label has no reference match; normalisation is the fraction of evaluated study cells.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| HLCA study structure | [R12] | scRNA-seq; human; — | — | leave one study out |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC per study | as in B2, computed per held-out study and reported per study | higher | primary | — |
| Unknown macro-F1 | as in B2 with harmonised labels | higher | primary | [R13] |
| adjusted Rand index | clusters of flagged cells against the held-out novel labels | higher | guardrail | — |
| known-type FRR | fraction of the study's harmonised known cells flagged | lower | guardrail | — |

- **Comparators**: the B2 list, plus the no-rejection baseline of each method.
- **Protocol**: build the reference from the remaining studies, project the held-out study with each method's default pipeline, flag, and score against the frozen labels. A QC-only control scores cells selected by quality criteria alone, to show whether technical shift alone drives flags.
- **Acceptance criterion** (proposed): median per-study AUROC of at least 0.75 for the best method, and a known-type macro-F1 drop of at most 0.02 relative to the no-rejection baseline.
- **Known pitfalls**: a harmonisation table written after seeing scores is circular, and annotator granularity decides which populations count as novel; report label-level sensitivity.

### B4. Threshold transfer across donors (proposed)

- **Goal**: whether a threshold calibrated for a target false-rejection rate on known cells holds on other donors.
- **Ground truth**: curated labels of known-type cells from donors not used for calibration. FRR is the fraction of a donor's known cells flagged, normalised over that donor's known cells.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| HLCA donors | [R12] | scRNA-seq; human; — | — | the candidates of B2 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| observed FRR per donor | fraction of known cells above the calibrated threshold on each held-out donor | target 0.05 | primary | — |
| absolute deviation | absolute difference between observed and target FRR, per donor | lower | primary | — |
| known coverage | fraction of known cells not rejected | higher | guardrail | — |

- **Comparators**: each method at its calibrated threshold, and at its default threshold.
- **Protocol**: calibrate on donor A's known cells to $\alpha=0.05$ with the split-conformal rule (section 3.3), apply the threshold unchanged to the other donors, and repeat with each donor as the calibration donor. Calibration cells exclude novel cells.
- **Acceptance criterion** (proposed): absolute deviation from target of at most 0.02 on at least 90% of donors.
- **Known pitfalls**: donor composition shifts the FRR even when the score is stable. The protocol is shared with annotation.annotation_confidence_calibration and the two must stay consistent.

### P1. Performance and scaling

Wall time, peak memory in GB (index and scoring reported separately) and throughput in query cells per second, on CPU and CUDA, for query sizes 1e4, 1e5 and 1e6 and reference sizes 1e5 and 1e6. Comparators are scmap projection, CellTypist prob-match, scArches weighted kNN, Symphony mapping with the per-cell metric, scANVI prediction and Seurat MappingScore. Embedding dimension, $k$, index type, threads, GPUs and reference are fixed. The scArches kNN loops in Python over cells and label columns (`scarches/utils/knn.py:108-130`), so it is expected to be the slowest; this is a code-derived expectation to be measured. Acceptance (proposed): identical CPU and CUDA flags for deterministic methods, and scoring time growing linearly with query size (log-log slope near 1). Pitfall: harnesses count host-device transfer differently, so both are reported.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
  - `feature-selection.reference_mapping_features`: Feature selection for reference mapping and label transfer
  - `annotation.cell_ontology_mapping`: Cell type name harmonization to Cell Ontology terms
- **Feeds**:
  - `annotation.annotation_confidence_calibration`: Annotation and label-transfer confidence calibration and abstention
  - `annotation.hierarchical_annotation`: Hierarchical, ontology-aware coarse-to-fine annotation
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Reads**: `layers/counts`, `layers/normalized`, `obs/<label_key>`, `obs/<batch_key>`, `obs/<calibration_mask>`, `obsm/<embedding_key>`, `models/<reference_model>`
- **Writes**: `obs/novelty_label`, `obs/novelty_score`, `obs/novelty_flag`, `obs/novelty_uncertainty`, `obs/novelty_cluster`, `obsm/novelty_latent`, `uns/novelty_report`
<!-- CHAINING:AUTO:END -->

No named workflow is assigned. Typical order: reference label transfer and its prerequisites, this task, then confidence calibration, hierarchical annotation and cluster naming.

## 10. Risks, pitfalls and open questions

- **Methods omitted or reduced.** SingleR is omitted because no score-gap pruning appears in the local SingleR R sources. The treeArches rejection options appear only in scarches notebooks and documentation, so they are not described here. The scPoli novelty rule and the scANVI novelty read-out lie outside the cited code, so scanvi_uncertainty is a singlet read-out. MARS, Northstar, CaSTLe, scID and SingleCellNet are omitted; their rejection rules are not described here.
- **Claims without a cited source.** The split-conformal result of section 3.3 has no cited source. The HLCA tutorial states that threshold 0.2 limits the false-positive rate to below 0.5 and cites a 2022 bioRxiv preprint; that statement is not reproduced here.
- **Data.** Accessions and cell or donor counts for the HLCA, the OpenProblems common datasets and the author-annotated catalogue subsets are not stated here, so dataset sizes are left as dashes.
- **Unsettled literature.** The cited sources define no novelty truth for reference mapping, and the hierarchy level at which a cell is novel is open (annotation.hierarchical_annotation). The 0.2 uncertainty is a tutorial choice, not a calibrated standard.
- **Technical risks.** kNN index memory grows with the reference, not the query, and label distributions must be checked after each job, because the HLCA tutorial reports a label-transfer bug in some environments with older scvi-tools, scanpy and scarches versions.
- **First experiment.** Compare scarches_knn with calibration and scpred on the B2 leave-one-type-out split for one annotated lung atlas, with five seeds, and report per-type AUROC and the FRR at the calibrated threshold. The result decides whether openset_head is built.

## 11. References

R1. Single-cell best practices consortium. Annotation chapter at theislab/single-cell-best-practices commit d581689, `jupyter-book/cellular_structure/annotation.ipynb`. https://sc-best-practices.org — verified (repo)

R2. Lotfollahi M, Naghipourfar M, Luecken MD, et al. Mapping single-cell data to reference atlases by transfer learning. *Nature Biotechnology* 40, 121–130 (2022; online 2021). doi:10.1038/s41587-021-01001-7 — verified (corpus)

R3. Alquicira-Hernandez J, et al. scPred: accurate supervised method for cell-type classification from single-cell RNA-seq data. *Genome Biology* 2019. doi:10.1186/s13059-019-1862-5 — verified (corpus)

R4. Domínguez Conde C, Xu C, Jarvis LB, et al. Cross-tissue immune cell analysis reveals tissue-specific features in humans. *Science* 2022. doi:10.1126/science.abl5197 — verified (corpus)

R5. Kiselev VY, Yiu A, Hemberg M. scmap: projection of single-cell RNA-seq data across data sets. *Nature Methods* 2018. doi:10.1038/nmeth.4644 — verified (corpus)

R6. Open Problems in Single-Cell Analysis. Label projection task at openproblems-bio/task_label_projection commit f37b604, including `src/metrics/accuracy`, `src/metrics/f1` and `src/methods`. https://openproblems.bio — verified (repo)

R7. Engelmann J, Hetzel L, Palla G, Sikkema L, Luecken M, Theis F. Uncertainty Quantification for Atlas-Level Cell Type Transfer. *arXiv* 2022. doi:10.48550/arXiv.2211.03793 — verified (corpus)

R8. Kang JB, Nathan A, Weinand K, et al. Efficient and precise single-cell reference atlas mapping with Symphony. *Nature Communications* 2021. doi:10.1038/s41467-021-25957-x — verified (corpus)

R9. Hendrycks D, Gimpel K. A baseline for detecting misclassified and out-of-distribution examples in neural networks. *ICLR* 2017; arXiv:1610.02136. — verified (search)

R10. Xu C, Lopez R, Mehlman E, Regier J, Jordan MI, Yosef N. Probabilistic harmonization and annotation of single-cell transcriptomics data with deep generative models. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209620 — verified (corpus)

R11. Donno C, et al. Population-level integration of single-cell datasets enables multi-scale analysis across samples. *Nature Methods* 2023. doi:10.1038/s41592-023-02035-2 — verified (corpus)

R12. Sikkema L, Ramírez-Suástegui C, Strobl DC, et al. An integrated cell atlas of the lung in health and disease. *Nature Medicine* 2023. doi:10.1038/s41591-023-02327-2 — verified (corpus)

R13. Grandini M, Bagli E, Visani G. Metrics for Multi-Class Classification: an Overview. *arXiv* 2020. doi:10.48550/arXiv.2008.05756 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/hemberg-lab/scmap | Vladimir Kiselev (author and maintainer per DESCRIPTION) | GPL-3 (LICENSE file: GNU GPL version 3) | scmap_cluster and scmap_cell2cluster rules | reimplement |
| https://github.com/powellgenomicslab/scPred | Jose Alquicira-Hernandez (author and maintainer per DESCRIPTION) | MIT (LICENSE file) | probability rejection rule | port |
| https://github.com/Teichlab/celltypist | Teichmann Lab (LICENSE copyright) | MIT (LICENSE file) | prob-match rule | port |
| https://github.com/theislab/scarches | Mohammad Lotfollahi, Theislab (LICENSE copyright) | BSD-3-Clause (LICENSE file); setup.py states MIT | scarches_knn kernel and uncertainty; scPoli hooks | port (kernel); scPoli callout |
| https://github.com/scverse/scvi-tools | scvi-tools development team (pyproject.toml); Yosef Lab (LICENSE copyright) | BSD-3-Clause (LICENSE file) | scANVI model and unlabelled-category handling | port (library use) |
| https://github.com/immunogenomics/symphony | Joyce Kang (author and maintainer per DESCRIPTION) | GPL (>= 3) (DESCRIPTION); LICENSE.md is GNU GPL version 3 | symphony_mahalanobis | reimplement |
| https://github.com/satijalab/seurat | Seurat authors (LICENSE copyright holder) | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE.md is the MIT text) | seurat_mapping_score | callout |
| https://github.com/openproblems-bio/task_label_projection | Open Problems in Single-Cell Analysis (LICENSE copyright) | MIT (LICENSE file) | B1 definition and comparators | callout |
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE copyright) | Apache-2.0 (LICENSE file) | annotation chapter cited as R1 | callout |
