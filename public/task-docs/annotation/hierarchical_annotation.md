---
id: annotation.hierarchical_annotation
title: Hierarchical, ontology-aware coarse-to-fine annotation
area: annotation
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [annotation.cell_ontology_mapping, feature-selection.reference_mapping_features, harmonization.gene_identifier_mapping]
feeds: [annotation.annotation_confidence_calibration, annotation.novel_cell_type_detection, annotation.cross_dataset_label_reconciliation, annotation.consensus_annotation]
reads: [layers/counts, obs/<label_key>, uns/<label_graph>, uns/<marker_tree>, models/<hier_model>]
writes: [obs/hier_label_path, obs/hier_depth, obs/hier_label_L<k>, obs/hier_conf_L<k>, obs/hier_abstain, obsm/hier_node_probs, uns/hier_annotation_params, models/<name>]
devices: [cpu, cuda]
mcp_tool: singlet_annotation_hierarchical_annotation
evidence_basis: corpus+repo+memory
last_reviewed: 2026-10-17
---

# Hierarchical, ontology-aware coarse-to-fine annotation

> Assigns each cell a root-to-leaf label path in a cell-type hierarchy, reports the deepest level the data support, and keeps a coarser call when the finer one is uncertain.

## 1. Question

Given query expression on shared gene identifiers and a label hierarchy (a Cell Ontology subgraph, or a marker tree written by a user) with reference labels at one or more levels, which node does each query cell belong to at each level, how deep can the call go, and how confident is each level? A correct answer agrees with expert annotation at every level it reports, is a prefix of the true path when it stops early, and abstains rather than guessing below the level the data support.

## 2. Why this task matters and where the field stands

Flat labels force a choice between a fine call that may be wrong and a coarse call that discards information. Expert annotations are layered (lineage, type, state) and atlases disagree about depth, so a method that returns a correct coarse call where the leaf is uncertain can be more useful than one that must choose a leaf. Methods differ in where the hierarchy comes from: the Cell Ontology [R2] for CellO and OnClass [R3][R4], a marker tree written by the user for Garnett [R1], or a clustering tree annotated by an LLM for mLLMCelltype [R5]. Other hierarchical classifiers are published, including scHPL, scClassify, HieRFIT, Census and CHETAH [R6][R7][R8][R9][R10]; they enter the methods table only after their code is read (section 10).

Status: **contested**. The best-practices chapter reports that different classifier types often perform comparably, and that neural network methods generally did not outperform SVMs or linear models [R11]. The open problems are:

- No shared benchmark scores hierarchical paths against exact truth. The metrics in use are partial-credit heuristics or hierarchical F, and both depend on the label graph [R14][R5].
- Per-level thresholds have no accepted calibration target. Calibration on held-out studies is the defensible option, and atlas-level uncertainty for cell type transfer has been studied [R15].
- Sister leaves with identical programmes have no defined deepest level.
- Ontology incompleteness: tissue-specific and disease states are often absent from the Cell Ontology. OnClass scores unseen types through ontology embeddings [R4], but no benchmark of their placement is known.

The singlet catalogue (354 million cells, about 40% with author annotations) supplies labels across many studies, which allows held-out-study calibration (section 8, B2).

## 3. Theory and insight

### 3.1 Outputs, estimand and truth

Let $\mathcal V$ be the nodes of a rooted label graph, $\mathcal V_k$ the nodes at depth $k$, and $\pi(v)$ the root-to-$v$ path. For a query cell $x$, a method provides node probabilities $P(v\mid x)$; these are calibrated probabilities only where section 5 says so. The outputs are defined as follows.

- **Deepest supported level.** With per-level thresholds $\tau_k$ (non-increasing in $k$ by default),
$$d^*(x)=\max\Bigl\{k:\ \max_{v\in\mathcal V_k}P(v\mid x)\ge\tau_k\Bigr\}.$$
The reported path is the ancestor at depth $d^*(x)$ of the most probable node. If no $k$ qualifies, the path is empty and the cell is abstained.
- **Level confidence.** $c_k(x)=P(\hat v_k\mid x)$ is the calibrated probability that the reported node $\hat v_k$ at level $k$ is the true node. Raw softmax or SVM scores are not reported as confidences.

Ground truth $y_j^{(k)}$ is the expert or author label of cell $j$ at level $k$, mapped to a CL term or to a study label. Cells without a label at level $k$ are excluded from level $k$. Level accuracy is the fraction of cells with a level-$k$ truth whose reported node equals that truth, with abstentions counted as errors. Metrics are cell-weighted unless stated; cluster-weighted values are reported separately. Regime: a closed label set, shared granularity between reference and query, and per-level probabilities calibrated on studies not used for training.

### 3.2 Path probability and ancestor consistency

Node-wise conditionals compose by the chain rule,
$$P(\pi(v)\mid x)=\prod_{k=1}^{d}P(\ell_k\mid \ell_{k-1},x),\qquad \ell_0=\mathrm{root},$$
which is valid when the children of each parent are exhaustive, as they are under a softmax over children or with an explicit other child. Errors multiply down the tree.

Ancestor monotonicity requires $P(a\mid x)\ge P(c\mid x)$ for every ancestor $a$ of $c$. Independent one-vs-rest classifiers violate it. CellO enforces it per cell by projecting raw scores $p(x)$ onto the monotone cone, $\hat q(x)=\arg\min_q\tfrac12\lVert q-p(x)\rVert_2^2$ subject to ancestor-above-descendant constraints, which is one quadratic programme per query cell [R3]. The projection is exact in the Euclidean sense but costs one solve per cell.

Singlet's proposed alternative, which is not a published method, uses a local softmax over children, $P(\ell\mid p,x)=\exp s_\ell(x)/\sum_{\ell'\in\mathrm{ch}(p)}\exp s_{\ell'}(x)$, trained with a masked cross-entropy. Cells labelled only to a coarser level then train the levels they carry. Consistency holds by construction, and no per-cell projection is needed.

### 3.3 Method families

| Family | Assumption | Failure mode |
|---|---|---|
| Marker tree with pseudo-labels (Garnett [R1]) | Markers define types and parents; marker scores give usable pseudo-labels | Pseudo-label noise is built in; a wrong parent removes the leaf |
| Ontology-consistent classifiers (CellO [R3]) | Reference profiles exist per CL term; the graph is correct and closed under is_a | Missing CL terms; pretrained models need matching gene sets |
| Ontology embedding (OnClass [R4]) | Ontology structure and names carry similarity between types | Placement of novel states depends on embedding quality, which is untested |
| LLM along a clustering tree (mLLMCelltype [R5]) | Sister-cluster markers separate siblings; the parent label is right | Cluster-level only; partial credit can inflate scores |

Garnett fits one multinomial elastic net per node on pseudo-labelled cells,
$$\min_{\{\beta_{0k},\beta_k\}}\ -\frac1N\sum_{i=1}^{N}w_i\log p_{y_i}(x_i)+\lambda\Big[\tfrac{1-\alpha}{2}\sum_k\lVert\beta_k\rVert_2^2+\alpha\sum_k\lVert\beta_k\rVert_1\Big],$$
and assigns cells by thresholding the odds ratio of normalised node probabilities, which is not a calibrated probability [R1]. Heuristics need no training labels and their rules can be inspected, but they cannot report calibrated uncertainty and depend most on the marker tree. A model-based formulation adds a likelihood, so per-level probabilities can be calibrated and reused, and covariates such as batch can enter.

### 3.4 Metrics and decision rules

Hierarchical precision, recall and F use $P_i$, the predicted path set of cell $i$ (empty when abstained), $T_i$ its true node, and $\mathrm{anc}(T_i)$ the true node with all its ancestors, root included. Sums are over cells:
$$hP=\frac{\sum_i|P_i\cap\mathrm{anc}(T_i)|}{\sum_i|P_i|},\qquad hR=\frac{\sum_i|P_i\cap\mathrm{anc}(T_i)|}{\sum_i|\mathrm{anc}(T_i)|},\qquad hF=\frac{2\,hP\,hR}{hP+hR}.$$
This is valid for single-label trees; for a DAG the ancestor sets must be the full CL ancestor closure. Abstained cells add to the recall denominator but not to the precision denominator, so abstention lowers recall only.

Partial credit is $\mathrm{Acc}=(N_\text{full}+0.5\,N_\text{partial})/N_\text{total}$, with $N$ the number of cells in each category [R5]. It is heuristic, since the 0.5 credit depends on the DAG and on name rules. The mLLMCelltype manuscript reports 58.4% full and 32.7% partial matches at cluster level [R5], so partial credit supplies 32.7 of the 91.1 points counted as matched. Strict accuracy must always be reported alongside it.

For a decision under calibrated node posteriors, the rule
$$\hat v(x)=\arg\min_{v\in\mathcal V}\ \sum_{u\in\mathcal V}P(u\mid x)\,d_T(v,u)$$
minimises expected tree distance, where $d_T$ counts edges. It can return an internal node when the children share probability mass, which is the principled form of a coarse call. This is a standard decision-theoretic result, not a cited method.

### 3.5 Insight

A hierarchy changes how errors are distributed more than leaf accuracy does: leaf errors become correct coarse calls, and the reported depth states how far the method is confident. Its value depends on the metric. Flat accuracy penalises the coarse answer, while partial credit rewards it, so a method can look better without improving leaf calls. The defensible comparison reports strict and partial metrics side by side, calibrates per level on held-out studies, and treats consistency as a guardrail. Because classifier types often perform comparably [R11], the main design decisions are the labels, the thresholds and the metric.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Garnett | hybrid | A user marker tree gives pseudo-labels per node; a per-node multinomial elastic net descends the tree | [R1] |
| CellO | model-based | One L2 logistic classifier per CL term, trained on human bulk RNA-seq; scores made ancestor-monotone by isotonic projection (IR, default) or a cascade (CLR) | [R3] |
| OnClass | model-based | Fixed class embeddings built from the Cell Ontology are scored bilinearly against a gene-input network; seen and unseen types both receive scores | [R4] |
| mLLMCelltype hierarchical annotation | heuristic | An LLM labels clusters level by level from global markers, sister-cluster markers and the parent label | [R5] |

Garnett and CellO are the code-level references for marker-tree and ontology-consistent classification, and OnClass is the only one of the four that places types absent from its training labels with a learned model. The LLM method is a comparator rather than a standard, since its scores depend on prompts and name matching. The README states that CellO's pretrained models were trained on human bulk RNA-seq, so single-cell use is outside its stated scope.

Defaults from source code, at the stated commit; parameter names are the code's own.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Garnett | min_observations | 8 | R/train_cell_classifier.R:104 @ ad3e1f7 |
| Garnett | max_training_samples | 500 | R/train_cell_classifier.R:105 @ ad3e1f7 |
| Garnett | propogate_markers | TRUE | R/train_cell_classifier.R:107 @ ad3e1f7 |
| Garnett | cores | 1 | R/train_cell_classifier.R:108 @ ad3e1f7 |
| Garnett | glmnet family, alpha, standardize | multinomial, 0.3, FALSE | R/train_cell_classifier.R:678-684 @ ad3e1f7 |
| Garnett | glmnet folds, lambda count | 3, 20 | R/train_cell_classifier.R:687-688 @ ad3e1f7 |
| Garnett | prediction penalty | lambda.min | R/classify_cells.R:121 @ ad3e1f7 |
| Garnett | rank_prob_ratio | 1.5 | R/classify_cells.R:80 @ ad3e1f7 |
| CellO | algo | IR (CLR alternative) | cello/scanpy_cello.py:27 @ 5a8fe46 |
| CellO | liblinear tolerance | 1e-9 | cello/models/binary_classifier.py:21 @ 5a8fe46 |
| CellO | class weight | balanced when downweighting, else none | cello/models/binary_classifier.py:11-14 @ 5a8fe46 |
| CellO | consistency projection | one quadratic programme per query cell | cello/models/isotonic_regression.py:70-112 @ 5a8fe46 |
| OnClass | hidden layers | [1000] | OnClass/OnClassModel.py:53 @ 8910b07 |
| OnClass | L2 penalty | 0.005 | OnClass/BilinearNN.py:16 @ 8910b07 |
| OnClass | epochs, minibatch | 50, 128 | OnClass/OnClassModel.py:116 @ 8910b07 |
| OnClass | embedding dimension, method | 5, 3 | OnClass/OnClassModel.py:22 @ 8910b07 |
| OnClass | refine, unseen ratio | True, 0.1 | OnClass/OnClassModel.py:142 @ 8910b07 |
| mLLMCelltype metric script | depth ratio of approximate hF | 0.70 | paper/manuscript/scripts/generate_supplementary_data_2.py:27 @ 26bda56 |

## 5. Proposed singlet approach

**Routes.** Garnett, CellO and OnClass carry permissive licences and are ported with attribution kept: the ontology-embedding network is re-expressed in PyTorch and the per-node linear fits in CUDA. mLLMCelltype is a callout comparator and is not ported. The flat leaf classifier with ancestor roll-up is singlet-native and is the required baseline.

**Proposed model.** Per-node conditional softmax heads on a pinned CL subgraph, trained with masked cross-entropy on catalogue cells whose author labels reach the depth they carry (section 3.2). Reported depth follows $d^*(x)$ with thresholds calibrated per level on study-grouped held-out data, and the coarse call can be the Bayes decision of section 3.4 when posterior mass is spread across children. The design is rejected if, on B1 or B2, it shows any consistency violation, coarse retention below 0.9 on unresolvable leaves, level accuracy at 80% coverage more than 0.02 below the flat roll-up at any level, or per-level ECE above the flat roll-up's.

**Default method.** The enum lists the three methods in the section 4 defaults table. The default is onclass: it is model-based, ontology-aware, and the only enum method that places types absent from its training labels with a learned model. The conditional softmax heads enter the enum only once their code exists and meets the B1 and B2 criteria.

**ML stack.** PyTorch for the conditional heads and the ontology-embedding network, which need autograd and masked losses. Hard-coded CUDA or cuSPARSE for the small hot models: per-node linear and elastic-net multinomial fits on sparse CSR features, with SpMM for $XW$ and grouped softmax reductions per parent. The same kernels serve Garnett-style fits. The proposed heads avoid CellO's per-cell projection; CellO's projection is ported only for comparison.

**Devices and streaming.** Query prediction is row-wise, so queries stream in chunks on CPU and CUDA; training holds the reference in memory. Garnett is sequential by default and holds its training matrix in R.

**Defaults used without asking.** `method` onclass; `labels.graph` cl with `labels.cl_release` set; `calibration.tau_per_level` empty, which applies 0.5 uncalibrated and flags the output; `calibration.coarse_fallback` true; `device` auto; `seed` 0.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Raw UMI counts; each method applies its own normalisation internally. |
| read | obs/<label_key> | string | Reference label per level, coarse to fine; empty where a level is absent. |
| read | uns/<label_graph> | edge list | Label graph, source = ancestor, target = descendant, with its CL release. |
| read | uns/<marker_tree> | dict | Garnett marker tree: types, parent types and markers. Optional. |
| read | models/<hier_model> | weights | Pretrained heads. Optional. |
| write | obs/hier_label_path | string | Root-to-leaf path such as "A > B > C"; empty when abstained. |
| write | obs/hier_depth | int | Deepest supported level $d^*(x)$; 0 when abstained. |
| write | obs/hier_label_L<k> | string | Reported node at level k; empty when that level is not reported. |
| write | obs/hier_conf_L<k> | float32 | Calibrated level confidence $c_k(x)$, calibrated on held-out studies. |
| write | obs/hier_abstain | bool | True when the reported path is empty. |
| write | obsm/hier_node_probs | float32 | Cells by nodes node probabilities, dense or sparse; uncalibrated unless the parameters record otherwise. |
| write | uns/hier_annotation_params | dict | Parameters used, the CL release, the thresholds and whether they were calibrated. |
| write | models/<name> | weights | Trained heads, written when training is requested. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Query dataset handle: a .singlet path or URI, or a workspace handle. |
| `reference` | string/null | null | — | Labelled reference handle or models/<name> with pretrained heads; needed to train onclass or cello. |
| `labels` | object | — | — | Reference label keys and the label graph they refer to. |
| `labels.keys` | array | — | — | Reference obs columns with labels, ordered coarse to fine; a cell may lack a level. |
| `labels.graph` | string | "cl" | `cl`, `custom` | cl uses a pinned Cell Ontology release; custom uses the uns/<label_graph> edge list. |
| `labels.cl_release` | string/null | null | — | Pinned Cell Ontology release; required when graph is cl and recorded in outputs. |
| `method` | string | "onclass" | `onclass`, `cello`, `garnett` | onclass is model-based and scores unseen types; garnett needs a marker tree; cello is the isotonic comparator. |
| `calibration` | object | — | — | Per-level thresholds and the reporting rule for the deepest supported level. |
| `calibration.tau_per_level` | array/null | null | — | Thresholds from coarse to fine; null applies 0.5 uncalibrated and flags the output. |
| `calibration.coarse_fallback` | boolean | true | — | true reports each cell at its deepest cleared level; false abstains unless the deepest level clears. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for head initialisation, cross-validation folds and minibatch order. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing hier_* members instead of failing. |
| `onclass` | object | — | — | Options used when method is onclass. |
| `onclass.nhidden` | array | [1000] | — | Hidden layer widths of the bilinear network. |
| `onclass.l2` | number | 0.005 | min 0 | L2 penalty on network weights. |
| `onclass.max_iter` | integer | 50 | min 1 | Training epochs. |
| `onclass.minibatch_size` | integer | 128 | min 1 | Cells per training minibatch. |
| `cello` | object | — | — | Options used when method is cello. |
| `cello.algo` | string | "IR" | `IR`, `CLR` | IR projects scores onto the ancestor-monotone cone; CLR uses the cascaded alternative. |
| `garnett` | object | — | — | Options used when method is garnett. |
| `garnett.marker_tree` | string | — | — | uns key or file path of the marker tree: types, parent types and markers. |
| `garnett.rank_prob_ratio` | number | 1.5 | min 1 | Odds-ratio threshold on normalised node probabilities for assignment. |
| `garnett.min_observations` | integer | 8 | min 1 | Minimum pseudo-labelled cells needed to train a node. |
| `garnett.max_training_samples` | integer | 500 | min 1 | Cap on pseudo-labelled training cells per type. |
| `garnett.elastic_net_alpha` | number | 0.3 | min 0; max 1 | Mixing between L1 and L2 penalties in each node's multinomial fit. |
| `garnett.cv_folds` | integer | 3 | min 2 | Folds for choosing the penalty strength by cross-validation. |
<!-- PARAMS:AUTO:END -->

Rules spanning parameters:

- `method` selects one nested object; supplying a different method's object is an error.
- `labels.cl_release` is required when `labels.graph` is `cl`, the default. It is written to `uns/hier_annotation_params`.
- `reference` is required to train `onclass` or `cello`; `garnett` takes `garnett.marker_tree` instead.
- `calibration.tau_per_level` has one entry per label key. Omitting it applies 0.5 at every level and marks the output uncalibrated.
- With `coarse_fallback` true, a cell is reported at its deepest cleared level. With false, it is reported only if its most probable node at the deepest level clears that threshold, and is abstained otherwise.

## 7. MCP tool

Tool name `singlet_annotation_hierarchical_annotation` (definition in `tasks/mcp/singlet_annotation_hierarchical_annotation.json`). Example call:

```json
{"dataset": "/data/query.singlet",
 "reference": "/data/reference.singlet",
 "labels": {"keys": ["ref_label_L1", "ref_label_L2"], "graph": "cl", "cl_release": "<pinned CL release>"},
 "method": "onclass"}
```

Example compact result:

```json
{"dataset": "/data/query.singlet",
 "status": "completed",
 "wrote": ["obs/hier_label_path", "obs/hier_depth", "obs/hier_label_L1", "obs/hier_conf_L1", "obs/hier_abstain", "uns/hier_annotation_params"],
 "summary": {"levels": 2, "method": "onclass", "cl_release": "<pinned CL release>", "abstain_rate": "<fraction>", "consistency_violations": "<count>"},
 "provenance_id": "<id>",
 "job_id": null,
 "estimate": null}
```

Angle-bracket values are placeholders.

- Long-running: training a head queues a job (`status` queued); query prediction with a pretrained head completes inline.
- Stochastic: head initialisation, cross-validation folds and minibatch order all derive from `seed`.
- Dry-run estimate: `dry_run` returns seconds, peak memory and device without writing members.

## 8. Benchmarks

**Shared protocol.** Freeze the CL release and the name-to-CL table before scoring, and report both with the results. Ambiguous names are resolved through a reviewed table rather than by the first Ontology Lookup Service match [R16]. Score strict accuracy and partial credit side by side. Partial credit uses one rule: 1.0 for the same CL term or normalised name, 0.5 when one term is an ancestor or descendant of the other, and 0 otherwise, with exact-token name matching. Cell-weighted metrics are primary. Splits are grouped by study, and by donor where donor IDs exist. Stochastic methods use seeds 0 to 4, and uncertainty is a 95% bootstrap over studies or datasets.

### B1. Planted-tree simulation with exact path truth

- **Goal**: test consistent paths, stopping at the resolvable depth, and keeping the coarse label for indistinguishable sisters.
- **Ground truth**: planted simulation; each cell carries its generating leaf. Resolvable depth is the deepest ancestor-or-self whose program differs from its sisters' (parent depth for identical pairs).
- **Generator** (proposed):
  1. Rooted tree of depth 3 or 4, branching 2 to 4.
  2. Each node gets a marker program: log2 fold change $\delta$ over background, decaying with depth.
  3. A fraction $\rho$ of sister-leaf pairs get identical programs.
  4. Negative-binomial counts with library-size variation and dropout.
  5. One held-out batch is shifted; the reference uses the other batches.

  Grid: $\delta\in\{0.25,0.5,1.0\}$, $\rho\in\{0,0.25,0.5\}$, 100 or 1000 cells per leaf; 5 seeds; 90 configurations.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted-tree simulator | Recipe above | Simulated; grid sizes | — | None public |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| deepest_correct_level_accuracy | Ancestor-or-equal of the truth, at the resolvable depth | maximize | primary | — |
| coarse_retention | Unresolvable leaves predicted at the parent level or above | maximize | primary | — |
| consistency_violations | Cells breaking ancestor containment or monotonicity | minimize | guardrail | — |
| over_specific_error | Cells predicted deeper than their resolvable depth | minimize | guardrail | — |
| level_ECE | $\sum_b (n_b/N)\,\lvert\mathrm{acc}_b-\bar c_b\rvert$, 10 equal-width bins of $c_k(x)$ | minimize | guardrail | — |

- **Comparators**: Garnett (planted tree, 20% of marker genes removed); CellO IR and CLR retrained; OnClass; flat logistic regression with roll-up.
- **Protocol**: methods get the tree and reference cells only; the query is the shifted batch.
- **Acceptance criterion** (proposed): coarse retention ≥0.9 and zero consistency violations; deepest-correct accuracy within 0.02 of the flat roll-up when $\delta\ge0.5$.
- **Known pitfalls**:
  - Planted programs leak into method priors unless marker sets are noised.
  - Identical-program resolvability makes a threshold fitted with the same classifier circular; B2 gives the real-label check.

### B2. Multi-level held-out-study transfer on HLCA

- **Goal**: train on some HLCA studies, test on held-out ones, and score each level and the coverage-accuracy curve.
- **Ground truth**: expert labels at the two HLCA levels used in the mLLMCelltype manuscript (Levels 3 and 4), mapped to CL terms with that manuscript's mapping [R5]. Cell-weighted.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Human Lung Cell Atlas (HLCA) | Sikkema et al. 2023 [R17] | Human lung scRNA-seq atlas; over 2.4 million cells from 486 individuals [R5] | — | Study and donor identifiers from metadata |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| level_accuracy | Fraction of held-out cells whose reported node equals the truth; abstentions are errors | maximize | primary | — |
| coverage_accuracy_curve | Accuracy at each coverage $c$, cells ranked by $c_k(x)$; area under the curve and at $c=0.8$ | maximize | primary | — |
| hierarchical_F | $hF$ of section 3.4, pooled over cells, on the two HLCA levels | maximize | guardrail | [R14] |
| partial_credit_accuracy | $(N_\text{full}+0.5N_\text{partial})/N_\text{total}$, shared-protocol rule; beside level accuracy only | maximize | guardrail | [R5] |
| parent_child_consistency | Fraction of cells whose coarse label is the ancestor of the fine label | maximize | guardrail | — |

- **Comparators**: flat leaf classifier with ancestor roll-up (singlet baseline); OnClass; CellO IR.
- **Protocol**: grouped 5-fold split by study (and by donor where IDs exist); calibrate $\tau_k$ on one set of held-out studies, evaluate on another; compare at matched coverage; 95% bootstrap over studies.
- **Acceptance criterion** (proposed): at 80% coverage, level-k accuracy is no more than 0.02 below the best flat comparator at every level, and consistency is 1.0.
- **Known pitfalls**:
  - Donors shared across studies leak identity unless splits are made by donor.
  - Level definitions differ between studies; map labels to common levels before pooling.

### B3. OpenProblems label projection, flat guardrail

- **Goal**: check that a hierarchical leaf-level projection does not degrade relative to a flat baseline on the OpenProblems label projection task.
- **Ground truth**: the solution label column of each test cell, supplied with the task's test resource. Metric definitions follow the task's configurations, which cite [R18]. Metrics are cell-weighted; macro $F_1$ averages per-label $F_1$ with equal weight per label.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_immune_cell_atlas (label projection test resource) | Task repository (section 12) | scRNA-seq immune atlas; organism and size — | see section 12 | Task labels are not CL-mapped |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| f1_macro | Unweighted mean of per-label $F_1$ | maximize | primary | [R18] |
| accuracy | Fraction of correctly predicted labels | maximize | guardrail | [R18] |
| f1_weighted | Per-label $F_1$ averaged with support weights | maximize | guardrail | [R18] |

- **Comparators**: the flat baseline in the same task (singlet reference implementation) and the hierarchical method at leaf depth.
- **Protocol**: score the hierarchical method at leaf depth on the test batch with the task metrics, and compare with the flat baseline on the same split.
- **Acceptance criterion** (proposed): f1_macro within 0.01 of the flat baseline.
- **Known pitfalls**:
  - Flat metrics ignore hierarchy, so a coarse-correct, leaf-wrong prediction scores zero; this benchmark measures leaf quality only.
  - Macro $F_1$ is dominated by rare labels, so per-label $F_1$ is reported for the rarest types.

### P1. Performance and scaling

Wall time, peak memory and throughput (query cells per second, prediction only) at $10^4$, $10^5$ and $10^6$ query cells, and at $10^7$ for the streaming claim, on CPU and CUDA for the neural method. Comparators are Garnett (one core), CellO IR and CLR (with its per-cell projection timed separately), OnClass and the flat logistic roll-up. Hold fixed the label graph, gene panel (2,000 highly variable genes and the full panel), thread count, per-node training size and hardware. Training and prediction are timed separately.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.cell_ontology_mapping`: Cell type name harmonization to Cell Ontology terms
  - `feature-selection.reference_mapping_features`: Feature selection for reference mapping and label transfer
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
- **Feeds**:
  - `annotation.annotation_confidence_calibration`: Annotation and label-transfer confidence calibration and abstention
  - `annotation.novel_cell_type_detection`: Novel or unseen cell type detection and out-of-distribution scoring for query cells
  - `annotation.cross_dataset_label_reconciliation`: Cross-dataset cell-type label reconciliation
  - `annotation.consensus_annotation`: Consensus annotation across methods or annotators
- **Reads**: `layers/counts`, `obs/<label_key>`, `uns/<label_graph>`, `uns/<marker_tree>`, `models/<hier_model>`
- **Writes**: `obs/hier_label_path`, `obs/hier_depth`, `obs/hier_label_L<k>`, `obs/hier_conf_L<k>`, `obs/hier_abstain`, `obsm/hier_node_probs`, `uns/hier_annotation_params`, `models/<name>`
<!-- CHAINING:AUTO:END -->

Belongs to annotation workflows that follow clustering or reference construction and precede confidence calibration, novelty detection and cross-dataset reconciliation.

## 10. Risks, pitfalls and open questions

- **Sources read in part.** The CellO and OnClass paper results and Garnett's benchmark numbers have not been read; the OnClass author list comes from its repository. CellO is dated 2021 in the scRNA-tools record and 2020 in its README; this document uses 2021.
- **Methods held out.** CHETAH, scHPL, scClassify, HieRFIT and Census are published, but their code is unread. They enter the methods table and the MCP enum only after review.
- **Benchmark inputs missing.** The mLLMCelltype 49-dataset benchmark is not enumerated, so its CL-scored protocol is not published here. The HLCA licence is unconfirmed, and the OpenProblems test-resource size is unread.
- **Comparator risks.** Garnett's odds-ratio rule divides by the row maximum, so the top normalised probability is always one; the random-guess test in its classification step compares an odds ratio of at least one with $1/K$ and never binds. The mLLMCelltype evaluator tests substrings for partial credit (04_evaluate_annotation_match.py:355) and must not be reused. Its hierarchical metric approximates hF with a fixed depth ratio (section 4).
- **Engineering risks.** CellO's projection solves one quadratic programme per query cell, so its cost is measured separately in P1. OnClass's code uses TensorFlow 1 APIs and needs external ontology files and a pinned CL release. First-match name-to-CL mapping adds label noise to truth and predictions alike.
- **Open literature and first experiment.** No shared benchmark with exact path truth exists, no calibration target is accepted for the per-level thresholds, OnClass's placement of unseen types is unbenchmarked, and whether ontology and clustering hierarchies should be combined is open. First experiment: build the planted-tree generator (B1) and the HLCA study split (B2), then compare the flat roll-up with OnClass before any conditional-softmax head is implemented.

## 11. References

R1. Pliner HA, Shendure J, Trapnell C. Supervised classification enables rapid annotation of cell atlases. *Nature Methods* 2019. doi:10.1038/s41592-019-0535-3 — verified (corpus)

R2. Diehl AD, Meehan TF, Bradford YM, et al. The Cell Ontology 2016: enhanced content, modularization, and ontology interoperability. *Journal of Biomedical Semantics* 2016;7:44. doi:10.1186/s13326-016-0088-7 — verified (search)

R3. Bernstein MN, Ma J, Gleicher M, Dewey CN. CellO: comprehensive and hierarchical cell type classification of human cells with the Cell Ontology. *iScience* 2021;24(1):101913. doi:10.1016/j.isci.2020.101913 — verified (corpus)

R4. Wang S, et al. Leveraging the Cell Ontology to classify unseen cell types. *Nature Communications* 2021. doi:10.1038/s41467-021-25725-x — verified (corpus)

R5. Yang C, Zhang X, Chen J. Large language model consensus substantially improves the cell type annotation accuracy for scRNA-seq data. Preprint doi:10.1101/2025.04.10.647852 (2025); published as *Communications Biology* 2026, doi:10.1038/s42003-026-10420-8 — verified (repo)

R6. Michielsen L, et al. Hierarchical progressive learning of cell identities in single-cell data. *Nature Communications* 2021. doi:10.1038/s41467-021-23196-8 — verified (corpus)

R7. Lin Y, et al. scClassify: sample size estimation and multiscale classification of cells using single and multiple reference. *Molecular Systems Biology* 2020. doi:10.15252/msb.20199389 — verified (corpus)

R8. Kaymaz Y, et al. HieRFIT: a hierarchical cell type classification tool for projections from complex single-cell atlas datasets. *Bioinformatics* 2021. doi:10.1093/bioinformatics/btab499 — verified (corpus)

R9. Ghaddar B, et al. Hierarchical and automated cell-type annotation and inference of cancer cell of origin with Census. *Bioinformatics* 2023. doi:10.1093/bioinformatics/btad714 — verified (corpus)

R10. de Kanter JK, et al. CHETAH: a selective, hierarchical cell type identification method for single-cell RNA sequencing. *Nucleic Acids Research* 2019. doi:10.1093/nar/gkz543 — verified (corpus)

R11. Abdelaal T, Michielsen L, Cats D, et al. A comparison of automatic cell identification methods for single-cell RNA sequencing data. *Genome Biology* 2019;20:194. doi:10.1186/s13059-019-1795-z — verified (corpus)

R12. Huang Y, Zhang P. Evaluation of machine learning approaches for cell-type identification from single-cell transcriptomics data. *Briefings in Bioinformatics* 2021. doi:10.1093/bib/bbab035 — verified (corpus)

R13. Pasquini G, Rojo Arias JE, Schäfer P, Busskamp V. Automated methods for cell type annotation on scRNA-seq data. *Computational and Structural Biotechnology Journal* 2021;19:961-969. doi:10.1016/j.csbj.2021.01.015 — verified (corpus)

R14. Kosmopoulos A, Partalas I, Gaussier E, Paliouras G, Androutsopoulos I. Evaluation measures for hierarchical classification: a unified view and novel approaches. *Data Mining and Knowledge Discovery* 2015;29:820-865. doi:10.1007/s10618-014-0382-x — verified (search)

R15. Engelmann J, Hetzel L, Palla G, Sikkema L, Luecken M, Theis F. Uncertainty Quantification for Atlas-Level Cell Type Transfer. *arXiv* 2022. doi:10.48550/arXiv.2211.03793 — verified (corpus)

R16. Jupp S, Burdett T, Malone J, et al. A new Ontology Lookup Service at EMBL-EBI. *CEUR Workshop Proceedings* 2015;1546:118-119. — unverified (memory)

R17. Sikkema L, Ramírez-Suástegui C, Strobl DC, et al. An integrated cell atlas of the lung in health and disease. *Nature Medicine* 2023. doi:10.1038/s41591-023-02327-2 — verified (corpus)

R18. Grandini M, Bagli E, Visani G. Metrics for Multi-Class Classification: an Overview. *arXiv* 2020. doi:10.48550/arXiv.2008.05756 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/cole-trapnell-lab/garnett | Hannah Pliner and Cole Trapnell (copyright holders in LICENSE) | MIT | Marker-tree reference; defaults in section 4 | port |
| https://github.com/deweylab/CellO | Matthew N. Bernstein (copyright holder in LICENSE) | MIT | Ontology-consistent classifiers and projection; comparator | port |
| https://github.com/wangshenguiuc/OnClass | Sheng Wang (copyright holder in LICENSE) | MIT | Default method; ontology-embedded network | port (in PyTorch) |
| https://github.com/cafferychen777/mLLMCelltype | Chen Yang (copyright holder in LICENSE) | MIT | Heuristic comparator; partial-credit definition | callout |
| https://github.com/openproblems-bio/task_label_projection | Open Problems in Single-Cell Analysis (copyright holder in LICENSE) | MIT | B3 data and metric configurations | callout |
