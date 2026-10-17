---
id: annotation.mislabelled_cell_detection
title: Detection of mislabelled and ambiguous cells in an existing annotation
area: annotation
scope: extended
paradigm: hybrid
literature_status: open
priority: P2
depends_on: [dim-reduction.normalized_cell_embedding, annotation.cluster_label_assignment, annotation.reference_label_transfer]
feeds: [annotation.consensus_annotation, annotation.cross_dataset_label_reconciliation]
reads: [X, obs/<label_key>, obsm/X_pca]
writes: [obs/mislabel_score, obs/mislabel_class, obs/mislabel_proposed_label, obs/mislabel_proposed_prob, obs/annotatability_conf, obs/annotatability_var, uns/mislabel_purity_per_type, uns/mislabel_params]
devices: [cpu, cuda]
mcp_tool: singlet_annotation_mislabelled_cell_detection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Detection of mislabelled and ambiguous cells in an existing annotation

> Scores each cell's existing label against its expression, flags cells whose label is unsupported or ambiguous, and proposes the label the expression supports.

## 1. Question

Given one existing label per cell and the cell's expression or embedding, which cells carry a label the data do not support, which sit between two types, and which label the data support instead? A correct answer ranks cells so that the top-ranked fraction is enriched for errors (planted in a benchmark, or confirmed by experts), marks cells between types as ambiguous, and proposes a label that recovers the original for planted errors.

## 2. Why this task matters and where the field stands

Existing labels, from clustering, reference transfer or earlier annotation, become ground truth for marker genes, differential expression and cross-dataset comparison, so an unsupported label propagates downstream. Status: **open**. Four families flag such cells. Annotatability fits a network to the given labels and summarises each cell's label probability over epochs as a confidence and a variability; its paper reports application to eight scRNA-seq and spatial datasets with expert re-annotation of flagged cells, and describes easy, hard and ambiguous cells [R1]. Confident learning estimates label noise from out-of-fold probabilities [R2]. scReClassify re-assigns labels post hoc with an ensemble of resampled SVMs [R3]. DSAVE scores cells by divergence from a population profile [R4]. Open problems: no public ground truth exists for real label errors; transitional cells, doublets and low-quality cells look like errors; boundary and batch-shifted errors are instance-dependent, which violates the class-conditional noise assumption of confident learning [R2]; and no common benchmark across these families is cited here.

## 3. Theory and insight

Each cell $i$ has an observed label $\tilde y_i$ and an unobserved label $y_i^{*}$ that its data would support. A detector ranks cells by evidence that $\tilde y_i\neq y_i^{*}$, or flags cells whose support is shared between types. The families differ in the corruption model and in what a model learns from the labels.

**Annotatability.** With $p_e$ the softmax probability of $\tilde y_i$ at epoch $e$,

$$c_i=\frac{1}{E}\sum_{e=1}^{E}p_e,\qquad v_i=\Big(\frac{1}{E}\sum_{e=1}^{E}(c_i-p_e)^2\Big)^{1/2},\qquad a_i=\mathbf 1\{|c_i-\bar c|\le\operatorname{var}(c)\}.$$

The code records $p_e$ at the start of each epoch, so the first value is the untrained network's. The band uses $\bar c$ and $\operatorname{var}(c)$ over cells. Confidence lies in $[0,1]$, so $\operatorname{sd}(c)\le 0.5$ and $\operatorname{var}(c)\le\operatorname{sd}(c)$: the band is narrower than one standard deviation, and its width is set by the data. Values are comparable only at fixed $E$, learning rate and architecture.

**Confident learning.** With out-of-fold probabilities $\hat p_k(x_i)$ and per-class thresholds $t_j$,

$$t_j=\frac{1}{|\{i:\tilde y_i=j\}|}\sum_{i:\tilde y_i=j}\hat p_j(x_i),\qquad C_{jk}=\big|\{i:\tilde y_i=j,\ \kappa_i=k\}\big|,$$

where $\kappa_i$ is the class of largest probability if more than one class clears its threshold, the unique clearing class if exactly one does, and undefined if none does. The joint of given and true labels is estimated by normalising the calibrated $C$. This holds when probabilities are out-of-fold and reasonably calibrated and the noise is class-conditional: the flip rate depends on the true class, not on the cell.

**scReClassify.** In member $m$ and round $r$, cells labelled $j$ are redrawn with replacement, with probability proportional to the current $\hat p_{ij}$, $n_j\cdot\text{percent}$ draws per class, and an SVM is refitted. The final label is

$$\hat y_i=\arg\max_k\sum_{m=1}^{L}\hat p^{(m)}_{ik},$$

so the summed score lies in $[0,L]$. The method assumes the representation separates types well enough for resampling to outvote wrong labels.

**DSAVE.** With $N_c$ the UMI total and $x_{gc}$ the counts of cell $c$, the template is $\pi_g\propto\sum_c x_{gc}/N_c$ over all cells, including the scored cell. Each cell is down-sampled without replacement to depth $T=\max(\min_c N_c,\,m)$, where $m$ is the depth parameter, and

$$d_c=-\operatorname{median}_t\,\log\mathrm{Mult}\big(\mathbf x_c^{(t)};\,T,\boldsymbol\pi\big)\quad\text{(nats)}.$$

Cells with $N_c<T$ are missing. The score is valid when the template represents the population and depth is comparable across cells.

**kNN disagreement.** $d_i=\frac{1}{k}\sum_{j\in\mathcal N_k(i)}\mathbf 1[\tilde y_j\neq\tilde y_i]$, a fraction with no fitted objective.

**Estimands.** The score is $1-c_i$ for Annotatability, $1-\hat p_{i\tilde y_i}$ for confident learning (out-of-fold probability of the given label), $1-$(ensemble mean probability of $\tilde y_i$) for scReClassify, and the disagreeing fraction $d_i$ for kNN; for DSAVE it is $d_c$ in nats. Higher is always more suspicious. Confident-joint counts $C_{jk}$ are normalised by their total. The planted indicator $z_i\in\{0,1\}$ is 1 when the label was replaced, and $f$ is the replaced count over all evaluated cells, not per type.

**Insight.** Learned notions of correctness need no reference, but each rests on an assumption about noise or learning. Heuristic scores need thresholds. A fitted model adds calibrated probabilities, covariates (batch, depth, neighbourhood) and reuse of the trained network. Further failure modes: rare types give unstable thresholds and few resampled cases; Annotatability outputs shift with epochs, learning rate and depth; DSAVE depends on depth.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Annotatability | model-based | Epoch-averaged probability of the given label and its spread, from a network fitted to the given labels | [R1] |
| Confident learning | model-based | Per-class thresholds on out-of-fold probabilities define a confident joint; off-diagonal cells are issues | [R2] |
| scReClassify | model-based | Ensemble of SVMs refitted on cells resampled within each label, weighted by current probability | [R3] |
| DSAVE | hybrid | Depth-matched multinomial log-likelihood of each cell under the population profile | [R4] |
| kNN disagreement | heuristic | Fraction of nearest neighbours carrying a different label | — |

The kNN score is the heuristic standard and is kept in every benchmark as the comparator. The three model-based methods are implemented; DSAVE is a comparator only, because its score measures population divergence and depth rather than label support. Benchmarks use the defaults below.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Annotatability | epochs | 100 | models.py:183 @ efec5ad |
| Annotatability | learning rate | 0.001 | models.py:183 @ efec5ad |
| Annotatability | momentum | 0.9 | models.py:183 @ efec5ad |
| Annotatability | batch size | 256 | models.py:184 @ efec5ad |
| Annotatability | hidden layers | 3 (3, 4 or 5 allowed) | models.py:184, 235–239 @ efec5ad |
| Annotatability | weighted sampler | true (inverse class frequency) | models.py:184, 324 @ efec5ad |
| Annotatability | ambiguity band | ±1 × var(confidence) | metrics.py:109–135 @ efec5ad |
| Confident learning | cross-validation folds | 5 | count.py:1185 @ 7506257 |
| Confident learning | joint calibration | true | count.py:450 @ 7506257 |
| Confident learning | pruning rule | prune_by_noise_rate | filter.py:63 @ 7506257 |
| scReClassify | base classifier | svm | multiAdaSampling.R:44 @ 679abbb |
| scReClassify | ensemble size L | 10 | multiAdaSampling.R:44 @ 679abbb |
| scReClassify | adaSampling rounds | 3 | multiAdaSampling.R:45 @ 679abbb |
| scReClassify | draws per class (percent) | 1 | multiAdaSampling.R:44 @ 679abbb |
| scReClassify | balance | TRUE | multiAdaSampling.R:45 @ 679abbb |
| DSAVE | minimum depth (minUMIsPerCell) | 200 | DSAVEGetSingleCellDivergence.R:31 @ f63f8e6 |
| DSAVE | down-sampling iterations | 15 | DSAVEGetSingleCellDivergence.R:31 @ f63f8e6 |
| kNN disagreement | k | 15 | proposed |

## 5. Proposed singlet approach

singlet implements Annotatability as the default, confident learning and scReClassify as alternatives, and the kNN score as a comparator; DSAVE is a comparator only. Routes and licences are in section 12.

**Default path.** Train the network on $X$ for `epochs` epochs at the section 4 defaults. Erroneous cells are the lowest `flag_fraction` of $c_i$ among cells with $a_i=0$; ambiguous cells have $a_i=1$. For these cells the proposed label is the argmax of the final network output, and its softmax value is the probability.

**Alternatives.** Confident learning fits out-of-fold logistic regression on `embedding_key` with `cv_folds` folds and flags off-diagonal cells, proposing the out-of-fold argmax. scReClassify flags cells whose final label differs from the given one. Only annotatability assigns ambiguous cells.

**Model-based formulation to test.** Each cell gets $\pi_i=\Pr(y_i^{*}\neq\tilde y_i\mid \hat q_i,s_i)$, from out-of-fold probabilities $\hat q_i$ and covariates $s_i$ (confidence, neighbour disagreement, batch). The noise model is fitted to cross-study disagreement among author labels, a weak signal. It is falsified if on B1 at $f=0.10$ its AUROC does not exceed the best single score, or its calibration error on held-out flips exceeds 0.05 (proposed). It enters the tool only after passing.

**Stack.** PyTorch for the network and noise model; hard-coded CUDA and cuSPARSE for the sparse linear classifier, batched distances and per-cell epoch reductions. Streaming is not supported: the source needs the full matrix on the device each epoch.

**Defaults for agents.** `method` annotatability, `epochs` 100, `seed` 0, `flag_fraction` 0.05 (proposed), `embedding_key` X_pca.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | X | float | Log-normalised expression, cells by genes; annotatability uses all genes |
| read | obs/<label_key> | categorical | Existing label to audit |
| read | obsm/X_pca | float32 | Embedding for confident learning and scReClassify |
| write | obs/mislabel_score | float32 | Ranking score, higher is more likely wrong (section 3); not a probability |
| write | obs/mislabel_class | categorical | correct, erroneous or ambiguous |
| write | obs/mislabel_proposed_label | categorical | Supported label for erroneous and ambiguous cells; the given label otherwise |
| write | obs/mislabel_proposed_prob | float32 | Probability of the proposed label under the method |
| write | obs/annotatability_conf | float32 | Mean label probability over epochs, $c_i$ (annotatability only) |
| write | obs/annotatability_var | float32 | Spread of label probability over epochs, $v_i$ (annotatability only) |
| write | uns/mislabel_purity_per_type | table | Per type: fractions and counts of correct, erroneous and ambiguous cells |
| write | uns/mislabel_params | dict | Method, version, all parameters and seed |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `label_key` | string | required | — | obs column holding the existing label to audit; required. |
| `method` | string | "annotatability" | `annotatability`, `confident_learning`, `screclassify` | Audit method; annotatability is the default and needs no reference. |
| `embedding_key` | string | "X_pca" | — | obsm key used by confident_learning and screclassify; annotatability uses X. |
| `flag_fraction` | number | 0.05 | min 0; max 1 | Lowest-scoring fraction reported as erroneous for annotatability and screclassify; confident_learning uses its pruning rule. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for training, resampling and fold assignment. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `annotatability` | object | — | — | Options for method annotatability; ignored by other methods. |
| `annotatability.epochs` | integer | 100 | min 1 | Training epochs; confidence and variability depend on this value. |
| `annotatability.learning_rate` | number | 0.001 | > 0 | SGD learning rate. |
| `annotatability.momentum` | number | 0.9 | min 0; max 1 | SGD momentum. |
| `annotatability.batch_size` | integer | 256 | min 1 | Minibatch size for SGD. |
| `annotatability.num_layers` | integer | 3 | `3`, `4`, `5` | Depth of the feedforward network. |
| `annotatability.weighted_sampler` | boolean | true | — | Sample minibatches with inverse-class-frequency weights. |
| `annotatability.ambiguity_band` | number | 1.0 | min 0 | Half-width of the ambiguity band in units of var(confidence); 1.0 reproduces the source rule. |
| `confident_learning` | object | — | — | Options for method confident_learning; ignored by other methods. |
| `confident_learning.cv_folds` | integer | 5 | min 2 | Folds for out-of-fold predicted probabilities. |
| `screclassify` | object | — | — | Options for method screclassify; ignored by other methods. |
| `screclassify.base_classifier` | string | "svm" | `svm`, `rf` | Base classifier of the adaSampling ensemble. |
| `screclassify.L` | integer | 10 | min 1 | Number of ensemble members. |
| `screclassify.iter` | integer | 3 | min 1 | adaSampling rounds per ensemble member. |
| `screclassify.percent` | number | 1 | min 0; max 1 | Draws per class as a fraction of its size, with replacement. |
<!-- PARAMS:AUTO:END -->

Method objects are read only by their own method. `flag_fraction` applies to annotatability and screclassify; confident_learning uses its pruning rule. Only annotatability sets ambiguous cells. Outputs from different epoch counts, learning rates or depths are not comparable, so these settings are recorded in `uns/mislabel_params` with each result.

## 7. MCP tool

Tool name `singlet_annotation_mislabelled_cell_detection` (definition in `tasks/mcp/singlet_annotation_mislabelled_cell_detection.json`).

```json
{"name": "singlet_annotation_mislabelled_cell_detection",
 "arguments": {"dataset": "atlas.singlet", "label_key": "cell_type", "method": "annotatability", "seed": 0}}
```

```json
{"dataset": "atlas.singlet", "status": "completed",
 "wrote": ["obs/mislabel_score", "obs/mislabel_class", "obs/mislabel_proposed_label", "obs/mislabel_proposed_prob", "obs/annotatability_conf", "obs/annotatability_var", "uns/mislabel_purity_per_type", "uns/mislabel_params"],
 "summary": {"method": "annotatability", "n_cells": "<int>", "n_correct": "<int>", "n_erroneous": "<int>", "n_ambiguous": "<int>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: annotatability training is queued as a job for inputs above the inline size limit. Stochastic: annotatability and screclassify depend on `seed`, and confident learning depends on it through fold assignment. Dry run returns estimated seconds and peak memory from cell count, gene count and `epochs`.

## 8. Benchmarks

All benchmarks follow one rule set. Methods receive only the existing or noisy labels, expression and embedding, never the planted or expert truth. Hyperparameters are the section 4 defaults unless a benchmark says otherwise, and any tuning uses a separate seed and tissue. Metrics are computed over all evaluated cells and reported per seed and as the mean over seeds, with counts per type.

### B1. Planted label flips (proposed)

- **Goal**: rank flipped cells above the rest and recover pre-flip labels; metrics are maximised.
- **Ground truth**: planted simulation; $z_i=1$ if cell $i$'s label was replaced; $f$ is the replaced share of cells.
- **Datasets**

| Dataset | Source | Size |
|---|---|---|
| Author-labelled cells, two tissues, two chemistries, types of at least 200 cells (proposed) | singlet catalogue | recorded at build |

- **Generator**: (1) $y^{*}$ = author labels; (2) for $f\in\{0.05,0.10,0.20\}$, replace $\lfloor fN\rfloor$ seeded-random labels; (3) uniform: a uniformly drawn other type; (4) confusable: a type among the $k\in\{1,2,3\}$ nearest centroids, from a gene split the methods do not use.
- **Metrics**

| Metric | Definition | Role |
|---|---|---|
| AUROC | ROC area against $z$; ties averaged | primary |
| AUPRC | Precision-recall area | primary |
| Precision at top-$f$ | Flip share of the top $\lfloor fN\rfloor$ scores; ties seeded | primary |
| Recovery | Top-set cells whose proposed label is $y^{*}$ | primary |
| Per-type recall | Top-set share of each type's flips | guardrail |

- **Comparators**: kNN disagreement, Annotatability, confident learning, scReClassify, DSAVE (per-label template).
- **Protocol**: seeds fix flips, folds and draws.
- **Acceptance criterion** (proposed): at uniform $f=0.10$, best AUROC ≥ 0.90 and AUPRC ≥ 0.50; every method beats kNN AUROC by ≥ 0.05; confusable recovery ≥ 0.70 at $f=0.10$.
- **Known pitfalls**: uniform flips are easier than structured errors; kNN is circular on labels clustered on the evaluation graph.

### P1. Performance and scaling

Wall time, peak memory and cells per second at $10^4$, $10^5$ and $10^6$ cells, on CPU and CUDA, for each method and comparator at its defaults. Hold fixed the type count, PC count, `epochs` 100, five folds, L 10, iter 3, DSAVE iterations 15 and kNN k 15. Report GPU utilisation for the PyTorch and CUDA paths. An exact kNN comparator grows with $n^2$; its failure point is reported rather than hidden. The top scale is used only where memory allows, and the limit is recorded.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
- **Feeds**:
  - `annotation.consensus_annotation`: Consensus annotation across methods or annotators
  - `annotation.cross_dataset_label_reconciliation`: Cross-dataset cell-type label reconciliation
- **Reads**: `X`, `obs/<label_key>`, `obsm/X_pca`
- **Writes**: `obs/mislabel_score`, `obs/mislabel_class`, `obs/mislabel_proposed_label`, `obs/mislabel_proposed_prob`, `obs/annotatability_conf`, `obs/annotatability_var`, `uns/mislabel_purity_per_type`, `uns/mislabel_params`
<!-- CHAINING:AUTO:END -->

Belongs to the annotation audit that follows clustering or reference transfer and feeds consensus annotation and cross-dataset reconciliation.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The full text of [R1] is absent from the local sources, so its eight dataset names and accessions, its expert re-annotation protocol and its exact easy, hard and ambiguous rule are not stated here; the code rule in section 3 may differ. The DSAVE paper's author list is absent, so its reference line gives title, venue and DOI only.
- **Unsettled literature and deferred benchmarks.** No common benchmark ranking these detectors on scRNA-seq labels is cited, and B1 has no planted truth for ambiguous cells. The expert re-annotation benchmark and a CITE-seq protein-truth benchmark are deferred until their dataset lists and thresholds are fixed.
- **Technical and data risks.** Annotatability's outputs depend on the training schedule (section 3), and the ambiguous fraction depends on the confidence distribution. The subset's counts, species, chemistry mix and licences are unset, and the default assumes log-normalised $X$.
- **First experiment.** Evaluate B1 at uniform and confusable flips, $f\in\{0.05,0.10,0.20\}$, seed 0, on one tissue, with the five comparators at defaults; check whether Annotatability's epoch-averaged confidence separates planted flips before the posterior model in section 5 is built.

## 11. References

R1. Karin J, Mintz R, Raveh B, et al. Interpreting single-cell and spatial omics data using deep neural network training dynamics. *Nature Computational Science* 2024. doi:10.1038/s43588-024-00721-5 — verified (corpus)

R2. Northcutt CG, Jiang L, Chuang IL. Confident learning: estimating uncertainty in dataset labels. *Journal of Artificial Intelligence Research* 2021;70:1373–1411. doi:10.1613/JAIR.1.12125 — partial (repo)

R3. Kim T, Lo K, Geddes TA, Kim HJ, Yang JYH, Yang P. scReClassify: post hoc cell type classification of single-cell RNA-seq data. *BMC Genomics* 2019;20:913. doi:10.1186/s12864-019-6305-x — verified (corpus)

R4. — DSAVE: Detection of misclassified cells in single-cell RNA-Seq data. *PLOS ONE* 2020. doi:10.1371/journal.pone.0243360 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/nitzanlab/Annotatability | Nitzan Lab (LICENSE); setup.py author jonathankarin | MIT | Training-dynamics confidence and variability | port |
| https://github.com/cleanlab/cleanlab | Cleanlab Inc. (pyproject.toml) | Apache-2.0 | Confident learning reference | port |
| https://github.com/SydneyBioX/scReClassify | Pengyi Yang, Taiyun Kim (DESCRIPTION) | GPL-3 | Resampling SVM ensemble | reimplement |
| https://github.com/SysBioChalmers/DSAVE-R | Johan Gustafsson, Juan Salvador Inda Diaz (DESCRIPTION) | MIT | Divergence comparator | callout |
