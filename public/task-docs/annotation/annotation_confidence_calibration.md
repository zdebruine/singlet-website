---
id: annotation.annotation_confidence_calibration
title: Annotation and label-transfer confidence calibration and abstention
area: annotation
scope: extended
paradigm: hybrid
literature_status: open
priority: P1
depends_on: [annotation.reference_label_transfer, annotation.cell_ontology_mapping]
feeds: [annotation.novel_cell_type_detection, annotation.consensus_annotation, annotation.mislabelled_cell_detection]
reads: [obsm/<annotator>_probs, uns/<annotator>_logits, obs/<truth_key>, obs/<group_key>]
writes: [obs/<annotator>_conf_calibrated, obs/<annotator>_label_calibrated, obs/<annotator>_abstain, obsm/<annotator>_conformal_sets, uns/<annotator>_calibration, models/<annotator>_calibrator]
devices: [cpu, cuda]
mcp_tool: singlet_annotation_annotation_confidence_calibration
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Annotation and label-transfer confidence calibration and abstention

> Recalibrate an annotator's per-cell confidence on held-out donors or studies, measure how well it matches accuracy, and turn it into a label set or an abstention rule with a stated coverage.

## 1. Question

Given an annotator's per-cell class probabilities or scores, and held-out cells with trusted labels from donors or studies it was not built on, does its top-label confidence match observed accuracy, can it be recalibrated, and which confidence threshold withholds the cells it cannot label reliably? A correct answer gives a confidence that is calibrated on new groups, and a frozen threshold or label set whose coverage and accuracy hold there.

## 2. Why this task matters and where the field stands

Most annotators return a label with a score rather than a calibrated probability, and the cut-offs users apply live on different scales. CellTypist's probability threshold acts on sigmoid one-vs-rest scores [R1], scPred's on SVM class probabilities [R2], and scmap's on cosine similarity [R3]. None of these cut-offs is derived from an accuracy target in the cited code, so a threshold that is sensible on one reference can withhold too many or too few cells on another.

The field is **open**. Four strands bear on it:

- **Cross-study reliability.** Engelmann et al. frame atlas-level cell-type transfer as an uncertainty-quantification problem [R4].
- **Unseen types.** Khatri and Bonn apply inductive conformal prediction to label transfer and report rejection of cell types absent from the reference [R5].
- **Agreement as confidence.** popV reports the number of classifiers that agree with its consensus label as a per-cell certainty. Its README reads the count as a certainty for each cell and says that disagreement among more than two classifiers signifies less reliable results [R6].
- **Conformal sets.** CellConformal, a software repository, describes set-valued output with class-conditional calibration and an abstention signal for cell types the model has never seen [R7].

Generic work sets the baseline: modern neural networks are often overconfident, and post-hoc temperature scaling reduces the miscalibration [R8]. The OpenProblems label_projection task gives a shared held-out-batch design for label transfer [R9]. No accepted benchmark of annotation confidence exists, so most benchmarks in section 8 are proposed designs.

## 3. Theory and insight

### 3.1 Targets and estimands

For query cell $j$ with predicted probabilities $\hat p_{jk}$ over $K$ types, the predicted label is $\hat y_j=\arg\max_k\hat p_{jk}$ and the top-label confidence is $c_j=\max_k\hat p_{jk}$. The trusted label $y_j$ is the reference annotation at the stated label level. Perfect calibration means

$$\Pr\bigl(Y=\hat y(X)\mid c(X)=c\bigr)=c\qquad\text{for all }c\in[0,1].$$

It is estimated on held-out cells and holds only where they follow the deployment distribution. Each output has its own estimand:

- **Expected calibration error.** $\mathrm{ECE}=\sum_{b=1}^{B}\frac{|B_b|}{n}\,\lvert\mathrm{acc}(B_b)-\mathrm{conf}(B_b)\rvert$ over $B$ equal-width confidence bins fixed in advance; 15 is the common choice [R8]. It estimates the cell-weighted gap between accuracy and confidence, a number in $[0,1]$. Empty bins contribute zero. It is unstable where high-confidence bins are sparse, so per-bin counts are reported.
- **Brier score.** $\mathrm{BS}=\frac1n\sum_i\sum_{k=1}^{K}(\hat p_{ik}-\mathbb 1[y_i=k])^2$ is an unnormalised sum over classes, so its range is 0 to 2; halve it for 0 to 1. It is a proper scoring rule that needs no binning. It is sensitive to class imbalance and is reported alongside per-class error.
- **Accuracy.** $\mathrm{Acc}=n^{-1}\sum_j\mathbb 1[\hat y_j=y_j]$ over evaluated cells, with an unassigned cell counted as an error.

Trusted labels are treated as correct. Label noise lowers observed accuracy, so it appears as overconfidence and biases ECE, coverage and selective accuracy in the same direction.

### 3.2 Recalibration maps

Temperature scaling fits one scalar on logits $z_{ik}$ from calibration cells $\mathcal C$:

$$\hat p_{ik}(T)=\frac{\exp(z_{ik}/T)}{\sum_{j}\exp(z_{ij}/T)},\qquad \hat T=\arg\min_{T>0}\Bigl(-\sum_{i\in\mathcal C}\log\hat p_{iy_i}(T)\Bigr).$$

For $T>0$ the argmax is unchanged, so accuracy does not move and only confidence changes. The regime is miscalibration that is roughly uniform across types. If only softmax probabilities are stored, $z_{ik}=\log\hat p_{ik}$ and temperature becomes a power transform of the probabilities. One-vs-rest sigmoid scores have $z_{ik}=\operatorname{logit}(\hat p_{ik})$ exactly. Their probabilities do not sum to one, so the temperature-scaled vector is renormalised across types. That convention changes ECE and must be stated.

Platt scaling [R10] fits $\sigma(a\,z+b)$, and isotonic regression [R11] fits a monotone step map. Both are fitted to the correctness of the top label as a function of the raw confidence. They are monotone in one score, so they keep the ranking used for abstention. Applied one-vs-rest per type and renormalised, they can change the argmax, so the predicted label is then taken from the calibrated vector and the change is reported.

### 3.3 Conformal sets

With nonconformity score $s_i=1-\hat p_{iy_i}$ on $n$ calibration cells, the split conformal threshold and set are

$$\hat q=\mathrm{Quantile}\Bigl(\{s_i\}_{i\in\mathcal C};\ \tfrac{\lceil (n+1)(1-\alpha)\rceil}{n}\Bigr),\qquad \mathcal C(x)=\{k:\,1-\hat p_k(x)\le\hat q\}.$$

If calibration and test cells are exchangeable and the true label is in the label set, $\Pr(Y\in\mathcal C(X))\ge 1-\alpha$. For continuous scores the coverage is at most $1-\alpha+1/(n+1)$ [R12]. Mondrian thresholds $\hat q_k$ use the $n_k$ calibration cells of type $k$ and give $\Pr(Y\in\mathcal C(X)\mid Y=k)\ge1-\alpha$. The quantile is finite only when $\lceil(n_k+1)(1-\alpha)\rceil\le n_k$, which for $\alpha=0.1$ requires $n_k\ge 9$; below that the set for type $k$ contains every label. The guarantee is averaged over calibration draws and test cells, it does not survive donor or study shift, and it does not cover a true type absent from the label set.

### 3.4 Selective prediction

Let $g(x)$ be the calibrated confidence and $\tau$ an abstention threshold:

$$c(\tau)=\Pr\bigl(g(X)\ge\tau\bigr),\qquad R(\tau)=\Pr\bigl(\hat y(X)\ne Y\mid g(X)\ge\tau\bigr).$$

The coverage-accuracy estimand is $1-R(\tau)$ among retained cells, with $c(\tau)$ the retained fraction of all cells. The AURC is $\int_0^1 R(c)\,dc$ over realised coverage, so it lies in $[0,1]$. The threshold is set on calibration cells to reach a target coverage and then frozen. Estimates are conditional on the retained set [R13].

### 3.5 Heuristic scores and what a model adds

Heuristic scores rank well. A correlation, a similarity or a vote share often puts the right type first even when its scale is arbitrary. A cut-off of 0.7 on cosine similarity and a cut-off of 0.5 on a probability measure different things, and the same number gives different accuracy on different datasets. A model-based layer adds four things: a score-to-probability map whose fit is checked on held-out groups; a set or abstention with a stated error rate; one parameter that transfers to a new query without retraining the annotator; and a route to covariates such as neighbourhood label purity and batch distance. The heuristic cut-off stays in the benchmarks as the comparator.

### 3.6 Failure modes

- Reference-trained classifiers driven to near-zero training loss are overconfident on new cells [R8].
- Under dataset shift accuracy falls while confidence stays high, so ECE grows on new studies [R14].
- A type absent from the reference receives a confident wrong label that calibration on known types cannot see.
- Marginal conformal coverage can look nominal while rare types sit far below it, so class-conditional thresholds are needed.
- In hierarchical labels a fine call can be wrong while its parent is right, so correctness must be defined per level (see annotation.hierarchical_annotation).
- Choosing thresholds on test accuracy is circular and optimistic.

## 4. Methods landscape

The published standard is each tool's own score with its own cut-off, which most users apply as delivered, and the best-practices rule that labels a cell unknown when one minus its confidence exceeds 0.2 [R19]. None of these is tied to an accuracy target in the code read. Temperature, Platt and isotonic are the standard recalibrators, and conformal sets are proposed in section 5 and not tabled. Only methods whose code or primary paper was read are listed.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scPred unassigned threshold | hybrid | SVM class probabilities (caret `type = "prob"`) on a projected query; a cell is unassigned when its maximum does not exceed the threshold | [R2] |
| CellTypist best match, probability match and majority voting | hybrid | One-vs-rest logistic scores with sigmoid transform; best type, every type above a cut-off, or a vote over over-clusters | [R1] |
| scANVI posterior | model-based | Semi-supervised variational latent with a label-conditioned term; a classifier head gives class probabilities | [R15][R16] |
| Seurat anchor-weighted prediction score | heuristic | Anchor-weighted vote of reference labels; the score is a vote share, not a probability | [R17] |
| SingleR correlation and score margin | heuristic | Quantile of correlations to reference types; the best-minus-next gap is used here as a confidence proxy | [R18] |
| scmap similarity threshold | heuristic | Nearest centroid or nearest cell by cosine similarity; unassigned below a fixed cut | [R3] |
| popV agreement count | heuristic | Majority label across annotators; certainty is the number of classifiers that agree | [R6] |
| Temperature, Platt and isotonic recalibration | model-based | One scalar, or a monotone map, fitted on held-out groups to the probability that the top label is correct | [R8][R10][R11] |

Values below are those the cited code uses.

| Method | Parameter | Value | Source |
|---|---|---|---|
| scPred | threshold | 0.55 | R/scPredict.R:32 @ af5492e |
| scPred | model | svmRadial | R/trainModel.R:36 @ af5492e |
| scPred | unassigned rule | assign when max > threshold, otherwise unassigned | R/scPredict.R:121 @ af5492e |
| CellTypist | p_thres | 0.5 | celltypist/annotate.py:15; celltypist/classifier.py:334 @ fe35756 |
| CellTypist | probability transform | sigmoid of one-vs-rest decision score, not normalised across types | celltypist/classifier.py:44; celltypist/models.py:150-155 @ fe35756 |
| CellTypist | mode | best_match | celltypist/command_line.py:38 @ fe35756 |
| CellTypist | majority-vote min_prop | 0 | celltypist/classifier.py:465; celltypist/command_line.py:43 @ fe35756 |
| scANVI | classifier output (training) | softmax over logits when classifier.logits is set | src/scvi/module/_scanvae.py:209 @ 5555ecc |
| Seurat | anchor weight normalisation | each query cell's weights divided by their column sum | src/integration.cpp:303-317 @ 5f67c70 |
| Seurat | prediction.score.max | row maximum of the weighted vote matrix | R/integration.R:3599-3641 @ 5f67c70 |
| scmap | threshold (scmapCluster) | 0.7, cosine similarity | R/AllGenerics.R:96-97 @ 88515b5 |
| scmap | unassigned rule | unassigned when maximum < threshold | R/CoreMethods.R:363-364 @ 88515b5 |
| scmap | threshold (scmapCell2Cluster) | 0.5 | R/AllGenerics.R:140 @ 88515b5 |
| popV | reliability rule | disagreement of more than two classifiers signals less reliable calls; no numeric default | README.md:62-70 @ 9c6f0ee |
| scikit-learn | CalibratedClassifierCV method | sigmoid | sklearn/calibration.py:219 @ 85593ca |
| scikit-learn | calibration method options | includes temperature | sklearn/calibration.py:101, 410 @ 85593ca |
| Best-practices chapter | unknown rule | unknown when 1 − confidence exceeds 0.2 | jupyter-book/cellular_structure/annotation.ipynb, cells 186 and 199 (0-based) @ d581689 |

## 5. Proposed singlet approach

The calibrators (temperature, Platt, isotonic, conformal sets) are **reimplemented** in the C++ core, each a small fit over probability arrays. The annotators in section 4 are **callouts**: singlet reads their outputs and does not reimplement them; they are section 8 comparators.

For an annotator with probabilities $\hat p$, singlet holds out whole groups, fits $\hat T$ on calibration groups, and reports $g_j=\max_k\hat p_{jk}(\hat T)$. The abstention threshold $\tau$ is the quantile of $g$ on calibration cells that gives the target coverage, frozen before any held-out group is scored. Cells with $g_j<\tau$ are set to `unassigned`. Otherwise the label is the argmax, which temperature does not change.

With conformal output enabled, the score is $1-\hat p_{iy_i}$ on the calibrated vector. Per-type thresholds apply in class-conditional mode when enough calibration cells exist. A type below `min_class_cells` uses the marginal threshold and is flagged in `uns`.

The model-based claim is falsified if a held-out group gives calibrated ECE above 0.05 (B1), if the calibrated rule does not beat the best raw cut-off at matched coverage by 0.01 (B2), or if donor-split marginal coverage falls more than 0.05 below nominal (B3). A failed claim makes the tool report the raw cut-off and mark the calibrated output not recommended.

The learned correctness predictor is a research arm only. A small PyTorch MLP, trained with log-loss on held-out groups, takes the top-two score gap, entropy, neighbourhood label purity and batch distance. It is promoted only if it lowers held-out Brier and ECE relative to temperature and meets B4.

PyTorch is used only for the MLP. Temperature is one scalar found by a bounded one-dimensional optimiser on $\log T$; each evaluation is a log-sum-exp over the calibration matrix, computed as a C++ reduction on CPU or a CUDA reduction on GPU. Isotonic uses a sort followed by pool-adjacent-violators. Quantiles use selection in $O(n)$, and the reliability curve is a histogram reduction. The calibration logits for $10^6$ cells and $K=20$ take about 80 MB as float32, so the fit does not stream, while diagnostics are chunked. cuSPARSE serves only the MLP's sparse neighbour products.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/<annotator>_probs | float32, cells × types | class probabilities or one-vs-rest scores from the annotator |
| read | uns/<annotator>_logits | float32, cells × types | optional logits; used by temperature when present |
| read | obs/<truth_key> | string | trusted labels at the stated level; the estimand is correctness against them |
| read | obs/<group_key> | string | groups held out together (donor or study) |
| write | obs/<annotator>_conf_calibrated | float32 | calibrated top-label confidence, estimating P(correct given the score) |
| write | obs/<annotator>_label_calibrated | string | argmax label, or `unassigned` where abstained |
| write | obs/<annotator>_abstain | bool | 1 where the calibrated confidence is below the frozen threshold |
| write | obsm/<annotator>_conformal_sets | bool, cells × types | conformal label sets; estimand is coverage at level 1 minus alpha |
| write | uns/<annotator>_calibration | dict | ECE, Brier, bin counts, reliability curve, coverage-accuracy curve, T, quantiles, threshold |
| write | models/<annotator>_calibrator | object | serialised temperature, isotonic or Mondrian quantiles |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `annotator` | string | required | — | Annotator whose probabilities are calibrated; reads obsm/<annotator>_probs and optional uns/<annotator>_logits. |
| `truth_key` | string | required | — | obs column with trusted labels at the stated level; unlabelled cells are excluded and counted. |
| `split` | object | — | — | How cells are held out: whole groups only, so no group appears in both calibration and evaluation. |
| `split.group_key` | string | "donor" | — | obs column defining held-out groups, usually donor or study. |
| `split.cal_fraction` | number | 0.5 | min 0.1; max 0.9 | Fraction of groups used for calibration; the remaining groups are used for evaluation. |
| `method` | string | "temperature" | `temperature`, `platt`, `isotonic`, `raw` | Recalibration family; raw reports diagnostics on uncalibrated scores without writing a calibrated column. |
| `abstain_coverage` | number | 0.9 | max 1; > 0 | Target realised coverage used to fit the abstention threshold on calibration groups; the threshold is then frozen. |
| `conformal` | object | — | — | Conformal label sets with finite-sample coverage under exchangeability; written only when enabled. |
| `conformal.enabled` | boolean | false | — | Write conformal label sets to obsm/<annotator>_conformal_sets. |
| `conformal.alpha` | number | 0.1 | max 0.5; > 0 | Miscoverage level; coverage is at least 1 minus alpha under exchangeability of calibration and test cells. |
| `conformal.class_conditional` | boolean | false | — | Use per-type (Mondrian) thresholds so coverage holds within each type, when enough calibration cells exist. |
| `conformal.min_class_cells` | integer | 50 | min 1 | Minimum calibration cells for a type's own threshold; below it the marginal threshold is used and the type is flagged. |
| `diagnostics` | object | — | — | Binning for the calibration error and the reliability curve. |
| `diagnostics.n_bins` | integer | 15 | min 2; max 100 | Equal-width confidence bins for expected calibration error and the reliability curve. |
| `diagnostics.min_bin_count` | integer | 20 | min 1 | Bins with fewer cells are reported and flagged, and stay in the error sum. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for the group split and any stochastic fit; repeated calls with the same seed are identical. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting or writing anything. |
| `overwrite` | boolean | false | — | Replace calibration members (obs, obsm, uns, models) written by an earlier call instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules that span parameters: `split` holds out whole groups, so no group is in both calibration and evaluation. `abstain_coverage` sets the abstention threshold only, and `method` raw writes no calibrated column. `conformal` works with any method and is independent of abstention. Probabilities that are one-vs-rest scores are transformed to logits before fitting, and the renormalisation convention is recorded in `uns`.

## 7. MCP tool

Tool `singlet_annotation_annotation_confidence_calibration` (definition in `tasks/mcp/singlet_annotation_annotation_confidence_calibration.json`). The result values below are placeholders, not measurements.

```json
{"dataset": "/data/atlas.singlet", "annotator": "celltypist_best", "truth_key": "cell_type",
 "split": {"group_key": "batch", "cal_fraction": 0.5}, "method": "temperature", "seed": 0}
```

```json
{"dataset": "/data/atlas.singlet", "status": "completed",
 "wrote": ["obs/celltypist_best_conf_calibrated", "obs/celltypist_best_label_calibrated", "obs/celltypist_best_abstain", "uns/celltypist_best_calibration"],
 "summary": {"method": "temperature", "temperature": "<float>", "ece_raw": "<float>", "ece_calibrated": "<float>", "abstain_threshold": "<float>", "coverage_realised": "<float>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: no; calls are designed to finish inline, with the timing target in P1. Stochastic: yes, the group split and any fit are fixed by `seed`. Dry run: returns estimated seconds, peak memory and device from the cell and type counts, without fitting.

## 8. Benchmarks

**Shared protocol.** Each evaluated cell has a trusted label $y_j$ at one stated level. Accuracy, coverage, selective accuracy, ECE and Brier are as defined in section 3, with ECE on 15 bins. Splits are by group, repeated with seeds 0 to 4; intervals are 95% bootstrap intervals over repeats. Coverage is reported as realised, never only as the target. Hardware, thread count and seeds are fixed across comparators.

### B1. Held-out-group reliability

- **Goal**: whether an annotator's top-label confidence matches accuracy on groups it was not fitted on, and whether a recalibrator fitted on other groups closes the gap.
- **Ground truth**: expert `cell_type` labels of the example dataset, as trusted labels of held-out cells; the correctness target is $\mathbb 1[\hat y_j=y_j]$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_immune_cell_atlas (example common dataset) | openproblems-bio task_label_projection test resource [R9] | scRNA-seq; species —; size — | — | one batch held out per draw; `obs` carries `cell_type` and `batch` |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ECE, 15 bins | section 3 definition; bins with fewer than 20 cells flagged | lower | primary | [R8] |
| Brier score | unnormalised sum over classes, range 0 to 2 | lower | primary | — |
| Accuracy | correct fraction of held-out cells, unassigned counted wrong | higher | guardrail | [R9] |
| Reliability curve | per-bin accuracy against mean confidence, one curve per held-out batch | descriptive | guardrail | — |

- **Comparators**: raw scores of scPred, CellTypist best match, scANVI and Seurat prediction.score.max; temperature, Platt and isotonic fitted on the other batches; the task's own methods as raw accuracy context.
- **Protocol**: leave one batch out. Each annotator is trained on the other batches and its probabilities are scored on the held-out batch. Each recalibrator is fitted on a disjoint calibration split of the remaining batches. Report ECE, Brier and accuracy per held-out batch, then the mean and the worst batch.
- **Acceptance criterion**: proposed design target, not a literature value. Recalibrated ECE is at most 0.05 on every held-out batch, and it is at least 50% below raw ECE wherever raw ECE exceeds 0.05.
- **Known pitfalls**: calibrating and testing on the same donors inflates apparent calibration. Reference labels are themselves uncertain, so ECE measures agreement with those labels and not with biology.

### B2. Selective accuracy versus coverage

- **Goal**: whether a threshold fitted on calibration groups delivers the target coverage with higher selective accuracy on held-out groups than each tool's own cut-off.
- **Ground truth**: expert labels as in B1. A retained cell is correct when its predicted label equals the trusted label. Rejected cells leave the selective-accuracy denominator and reduce coverage.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_immune_cell_atlas (example common dataset) | as in B1 | as in B1 | — | same batch split as B1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Selective accuracy at coverage 0.8, 0.9, 0.95 | accuracy of cells with calibrated confidence at least $\tau$; $\tau$ set on calibration batches to reach the target and frozen; ties kept together | higher | primary | [R13] |
| AURC | trapezoid over confidences sorted in decreasing order, ties grouped, normalised to $[0,1]$ | lower | primary | — |
| Rare-type retention | fraction of each type with fewer than 50 cells retained at $\tau$; minimum over types | higher | guardrail | — |

- **Comparators**: CellTypist p_thres, the scPred threshold, the scmap threshold, and the best-practices rule [R19]; calibrated thresholds for each recalibrator; Mondrian sets from B3. Raw cut-offs are interpolated to matched realised coverage.
- **Protocol**: sweep $\tau$ on calibration batches, freeze it, apply it to held-out batches, and report realised coverage for each batch. Seeds 0 to 4.
- **Acceptance criterion**: proposed design target. At target coverage 0.9, the mean selective accuracy of the calibrated rule over held-out batches exceeds that of the best raw cut-off at matched coverage by at least 0.01.
- **Known pitfalls**: choosing $\tau$ on test batches leaks information. Selective accuracy cannot see confident wrong labels for unseen types, which B4 addresses.

### B3. Conformal coverage on exchangeable and shifted splits

- **Goal**: whether conformal sets reach nominal coverage, how far batch shift lowers it, and whether a planted calibration error is recovered.
- **Ground truth**: expert labels (example dataset). In arm 3 labels are drawn from known posteriors, so true calibration error and coverage are exact.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_immune_cell_atlas | as in B1 | as in B1 | — | arms 1 and 2 |
| Planted simulation | Splatter-type simulator [R20] | simulated scRNA-seq; sizes by recipe | — | arm 3 only |

- **Generator recipe (arm 3)**: (1) simulate $K\in\{5,10,20\}$ types with group structure; (2) add a batch factor at five strengths $s$; (3) record true posteriors $p_i$; (4) set the annotator output to $\operatorname{softmax}(\log p_i/T_s)$ for a known $T_s$ on a grid, so true ECE follows from $p_i$; (5) 50 replicates per $(s,K)$.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Marginal coverage | fraction of test cells whose true label is in $\mathcal C(x)$; target 0.9 | target 0.9 | primary | [R12] |
| Class-conditional coverage | minimum over types with at least 50 test cells | higher | primary | [R12] |
| Set size, singleton fraction | mean $\lvert\mathcal C(x)\rvert$; singleton fraction | lower | guardrail | — |
| ECE estimator bias (arm 3) | estimated minus true ECE, mean over replicates | 0 | primary | [R8] |

- **Comparators**: fixed top-k sets; marginal split sets; Mondrian sets.
- **Protocol**: arm 1 uses random cell splits over 10 seeds; arm 2 holds out whole batches and reports the shortfall $(1-\alpha)-$coverage; arm 3 uses the recipe with at least $10^4$ calibration cells.
- **Acceptance criterion**: arm 1 marginal coverage within $[0.89,\,0.91+1/(n_{\mathrm{cal}}+1)]$ (proposed sanity bound); arm 2 reports shortfall (falsifier 0.05, section 5); arm 3 (proposed) absolute ECE estimator bias below 0.02 in at least 90% of replicates.
- **Known pitfalls**: batch splits break exchangeability, so arm 2 has no guarantee. Nominal marginal coverage can hide rare-type shortfalls.

### B4. Unseen-type rejection

- **Goal**: whether an uncertainty or reject score flags query cells of a type removed from the reference, which calibration on known types cannot detect.
- **Ground truth**: leave one type out by construction. For each eligible type $t$, the reference omits $t$. Query cells labelled $t$ are positives and seen-type query cells are negatives. The score is evaluated per removed type.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_immune_cell_atlas, one type removed from the reference | as in B1 | as in B1 | — | eligible types have at least 200 cells (proposed) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| FPR at 95% TPR | seen-type cells flagged at the threshold that flags 95% of unseen-type cells | lower | primary | [R21] |
| AUROC | area under the ROC curve of the score, averaged over removed types | higher | primary | — |
| Seen-type rejection rate | seen-type cells flagged at the same threshold | lower | guardrail | — |

- **Comparators**: maximum softmax probability [R21]; predictive entropy; kNN distance in the reference PCA space; the scANVI class posterior.
- **Protocol**: leave one type out over eligible types. Compute metrics per removed type and report the mean and spread across types. Seeds 0 to 4 for the learned score.
- **Acceptance criterion**: proposed design target. FPR at 95% TPR of the learned correctness score is at least 0.05 lower than that of maximum softmax, averaged over removed types.
- **Known pitfalls**: a removed type can have near-identical neighbours in the reference, so "unseen" is ambiguous and flagged types need expert adjudication. Disease or perturbed states can be flagged although their type is in the reference.

### P1. Performance and scaling

Wall time, peak memory and throughput in cells per second for fitting temperature, Platt, isotonic and Mondrian thresholds, and for producing calibrated labels and sets. Sizes are 10^4, 10^5 and 10^6 query cells with 10% calibration cells and K = 20 types (proposed grid), timed on CPU and CUDA. Comparators are scikit-learn CalibratedClassifierCV with temperature, sigmoid and isotonic, and a NumPy/SciPy reference of the same estimators. K, the calibration fraction, the thread count and the seed are held fixed. Annotator inference is reported separately, and data loading is excluded unless stated. Acceptance (proposed, to be confirmed by a pilot): calibrating $10^6$ cells with K = 20 takes under 60 s on CPU, and CPU and CUDA give identical labels and abstention flags at a fixed seed. A naive sort-based quantile is $O(n\log n)$, so selection is used.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
  - `annotation.cell_ontology_mapping`: Cell type name harmonization to Cell Ontology terms
- **Feeds**:
  - `annotation.novel_cell_type_detection`: Novel or unseen cell type detection and out-of-distribution scoring for query cells
  - `annotation.consensus_annotation`: Consensus annotation across methods or annotators
  - `annotation.mislabelled_cell_detection`: Detection of mislabelled and ambiguous cells in an existing annotation
- **Reads**: `obsm/<annotator>_probs`, `uns/<annotator>_logits`, `obs/<truth_key>`, `obs/<group_key>`
- **Writes**: `obs/<annotator>_conf_calibrated`, `obs/<annotator>_label_calibrated`, `obs/<annotator>_abstain`, `obsm/<annotator>_conformal_sets`, `uns/<annotator>_calibration`, `models/<annotator>_calibrator`
<!-- CHAINING:AUTO:END -->

Workflow: annotation, after reference-based label transfer and before consensus or novelty steps.

## 10. Risks, pitfalls and open questions

- **Summary-only or unread sources.** Engelmann et al. [R4] is cited from its record and title only. Khatri and Bonn [R5] is cited from its proceedings record and summary, not the full text. No public code was identified for Khatri and Bonn, so that method is not implemented. The popV paper's own calibration analysis, the Azimuth scoring code, the SingleR Bioconductor pruning defaults, the Splatter source and the CellConformal source code were not read; the CellConformal README was read, and the Bioinformatics article it cites was checked by title only.
- **Dataset and licence.** The example dataset's accession, species, size and licence were not read from its metadata. The catalogue figures of 354 million cells and about 40% annotated are project figures. A study inventory and licence review are required before a catalogue size is quoted in a benchmark.
- **Unsettled literature.** No annotation-specific calibration benchmark exists to adopt. Whether class-conditional sets stay informative for rare types at 50 cells is open, and nonconformity scores other than $1-\hat p_y$, such as adaptive or entropy-based scores, are untested here.
- **Label noise and granularity.** Trusted labels are uncertain, which bounds the achievable ECE, and no benchmark quantifies label noise in scRNA-seq annotation. The choice of hierarchy level changes what counts as correct.
- **Technical risks.** One-vs-rest renormalisation changes ECE and must be stated. The 15-bin ECE is unstable where high-confidence bins are sparse. The best-practices 0.2 rule and the tools' cut-offs are illustrative, not tuned to accuracy.
- **First experiment.** B1 with CellTypist best-match probabilities and temperature scaling over five seeds on the example dataset, followed by the random-split arm of B3. Catalogue studies enter only after the inventory and licence review.

## 11. References

R1. Domínguez Conde C, Xu C, Jarvis LB, et al. Cross-tissue immune cell analysis reveals tissue-specific features in humans. *Science* 2022. doi:10.1126/science.abl5197 — verified (corpus)

R2. Alquicira-Hernandez J, et al. scPred: accurate supervised method for cell-type classification from single-cell RNA-seq data. *Genome Biology* 2019. doi:10.1186/s13059-019-1862-5 — verified (corpus)

R3. Kiselev VY, et al. scmap: projection of single-cell RNA-seq data across data sets. *Nature Methods* 2018. doi:10.1038/nmeth.4644 — verified (corpus)

R4. Engelmann J, Hetzel L, Palla G, Sikkema L, Luecken M, Theis F. Uncertainty quantification for atlas-level cell type transfer. arXiv 2022. doi:10.48550/arXiv.2211.03793 — verified (corpus)

R5. Khatri R, Bonn S. Uncertainty Estimation for Single-cell Label Transfer. *Proceedings of Machine Learning Research* 179 (COPA 2022), pp. 109-128. https://proceedings.mlr.press/v179/khatri22a.html — verified (search)

R6. Ergen C, et al. Consensus prediction of cell type labels in single-cell data with popV. *Nature Genetics* 2024. doi:10.1038/s41588-024-01993-3 — verified (corpus)

R7. CellConformal: conformal prediction for single-cell RNA-seq annotation. Software repository Vroon1703/cellconformal, 2026; not a peer-reviewed article. Its README cites a 2025 Bioinformatics article with the same subject, *Conformal inference for reliable single cell RNA-seq annotation* (article btaf521), which was checked by title only; no DOI is given here. https://github.com/Vroon1703/cellconformal — partial (repo)

R8. Guo C, Pleiss G, Sun Y, Weinberger KQ. On calibration of modern neural networks. *Proceedings of the 34th International Conference on Machine Learning (ICML)*, PMLR 70; 2017. — unverified (memory)

R9. Open Problems consortium. task_label_projection: label projection task, repository README and test resources. https://github.com/openproblems-bio/task_label_projection — verified (repo)

R10. Platt J. Probabilistic outputs for support vector machines and comparisons to regularized likelihood methods. In: *Advances in Large Margin Classifiers*. MIT Press; 1999. — unverified (memory)

R11. Zadrozny B, Elkan C. Transforming classifier scores into accurate multiclass probability estimates. *Proceedings of the 8th ACM SIGKDD International Conference on Knowledge Discovery and Data Mining*; 2002. — unverified (memory)

R12. Vovk V, Gammerman A, Shafer G. *Algorithmic Learning in a Random World*. Springer; 2005. — unverified (memory)

R13. Geifman Y, El-Yaniv R. Selective classification for deep neural networks. *Advances in Neural Information Processing Systems*; 2017. — unverified (memory)

R14. Ovadia Y, Fertig E, Ren J, et al. Can you trust your model's uncertainty? Evaluating predictive uncertainty under dataset shift. *Advances in Neural Information Processing Systems*; 2019. — unverified (memory)

R15. Xu C, Lopez R, Mehlman E, Regier J, Jordan MI, Yosef N. Probabilistic harmonization and annotation of single-cell transcriptomics data with deep generative models. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209620 — verified (corpus)

R16. Gayoso A, Lopez R, Xing G, et al. A Python library for probabilistic analysis of single-cell omics data. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01206-w — verified (corpus)

R17. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)

R18. Aran D, et al. Reference-based analysis of lung single-cell sequencing reveals a transitional profibrotic macrophage. *Nature Immunology* 2019. doi:10.1038/s41590-018-0276-y — verified (corpus)

R19. Theislab. Single-cell best practices, annotation chapter (jupyter-book/cellular_structure/annotation.ipynb), repository theislab/single-cell-best-practices. https://github.com/theislab/single-cell-best-practices — verified (repo)

R20. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)

R21. Hendrycks D, Gimpel K. A baseline for detecting misclassified and out-of-distribution examples in neural networks. *International Conference on Learning Representations* 2017. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/powellgenomicslab/scPred | Jose Alquicira-Hernandez (author and maintainer, DESCRIPTION) | MIT (LICENSE, copyright 2019 powellgenomicslab) | annotator and unassigned rule; B2 comparator | callout |
| https://github.com/Teichlab/celltypist | Chuan Xu (setup.py author); Teichmann Lab (LICENSE copyright) | MIT (LICENSE) | probability and majority-vote annotator; B1 and B2 comparator | callout |
| https://github.com/scverse/scvi-tools | scvi-tools developers; Yosef Lab (LICENSE copyright) | BSD-3-Clause (LICENSE) | scANVI posterior; B1 comparator | callout |
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and other Seurat authors (Authors@R, DESCRIPTION) | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE file: 2021, Seurat authors) | prediction.score; B1 comparator | callout |
| https://github.com/dviraran/SingleR | Dvir Aran (author and maintainer, DESCRIPTION) | GPL-3.0 (DESCRIPTION and LICENSE) | correlation and margin; comparator only, copyleft so no code reuse | callout |
| https://github.com/hemberg-lab/scmap | Vladimir Kiselev (author and maintainer, DESCRIPTION) | GPL-3 (DESCRIPTION and LICENSE) | similarity threshold; B2 comparator | callout |
| https://github.com/YosefLab/popV | Can Ergen (LICENSE copyright) | MIT (LICENSE) | agreement count and README rule | callout |
| https://github.com/Vroon1703/cellconformal | Varun Srikakulam (LICENSE copyright) | MIT (LICENSE) | third-party conformal sets; B3 comparator | callout |
| https://github.com/scikit-learn/scikit-learn | The scikit-learn developers | BSD-3-Clause (COPYING) | CalibratedClassifierCV; B3 and P1 comparator | callout |
| https://github.com/openproblems-bio/task_label_projection | Open Problems consortium (task repository) | MIT (LICENSE; copyright 2024 Open Problems in Single-Cell Analysis) | held-out batch design and example dataset for B1 to B4 | callout |
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE copyright 2021) | Apache-2.0 (LICENSE) | best-practices unknown rule; B2 comparator | callout |
