---
id: annotation.consensus_annotation
title: Consensus annotation across methods or annotators
area: annotation
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [annotation.cell_ontology_mapping, annotation.reference_label_transfer, annotation.llm_cluster_annotation, annotation.annotation_confidence_calibration]
feeds: [annotation.mislabelled_cell_detection, annotation.cross_dataset_label_reconciliation]
reads: [obs/<annotator>, obs/<annotator>_score, obs/<cluster_key>, uns/cl_label_map]
writes: [obs/consensus_label, obs/consensus_agreement, obs/consensus_entropy, obs/consensus_flag, uns/consensus_params]
devices: [cpu, cuda]
mcp_tool: singlet_annotation_consensus_annotation
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Consensus annotation across methods or annotators

> Combines the labels of several annotators into one label per cell or cluster, with an agreement score and a flag that marks disagreement.

## 1. Question

Do aggregated labels from several annotators, or from marker and reference evidence, beat the best single annotator on held-out studies, and does the disagreement flag mark the cells that are wrong? Inputs are $M$ label columns over the same cells, optionally with per-call scores. A correct answer reports accuracy and macro-F1 against expert labels, coverage, and how well the flag ranks errors.

## 2. Why this task matters and where the field stands

**Status: contested.** Automatic annotators disagree. Abdelaal et al. compared 22 methods on 27 public datasets, report that accuracy falls on complex datasets with overlapping or deep labels, and find a general-purpose SVM strongest overall [R1]. Annotator choice therefore changes the answer, which motivates combining annotators. Clarke et al. recommend automated labelling, manual labelling and verification, in that order [R2]; consensus is a candidate for the verification step.

Consensus already appears as a plurality over LLM labels behind an acceptance gate [R7], a plurality over per-cell predictions within over-clusters [R3], and a unanimity rule over reference neighbours [R5]. No benchmark of a cross-method consensus against its best member is cited below.

Three problems remain open. Annotators that share references and markers make correlated errors, so agreement can be confident and wrong. Coarse and fine calls from different annotators are split by plain voting. LLM panels vary across providers and versions, and their calls are not deterministic [R7].

## 3. Theory and insight

Annotator $m\in\{1,\dots,M\}$ labels item $i$ (a cell or a cluster) with $y_{mi}$ from $C$ classes, after mapping to one ontology (annotation.cell_ontology_mapping), or with the unassigned state $\varnothing$. Weights $w_m\ge 0$ default to one. Votes are normalised over assigned calls:

$$p_{ik}=\frac{\sum_m w_m\mathbf 1[y_{mi}=k]}{\sum_m w_m\mathbf 1[y_{mi}\neq\varnothing]}$$

The plurality label is $\hat y_i=\arg\max_k p_{ik}$. A tie, or an item with no assigned call, is unassigned. Agreement and dispersion are $\mathrm{cp}_i=\max_k p_{ik}$ and $H_i=-\sum_k p_{ik}\log_2 p_{ik}$ in bits, with $\mathrm{cp}_i=0$ when no call is assigned. The gate sets the flag: agree when $\mathrm{cp}_i\ge\tau_c$ and $H_i\le\tau_H$, and disagree otherwise; mLLMCelltype also requires a unique majority. Under `count_as_vote` the denominator is $M$ and unassigned is one more class.

Thresholds are set by hand, so the gate is heuristic and tied to no error rate. Under independence, with each annotator correct with probability $p>1/2$ and $M$ odd, a binary majority is correct with probability

$$P_{\mathrm{maj}}(M,p)=\sum_{k>M/2}\binom{M}{k}p^k(1-p)^{M-k},$$

which rises with $M$. With a common pairwise correlation $\rho$ among correctness indicators, the effective number of independent votes is about $M_{\mathrm{eff}}\approx M/(1+(M-1)\rho)$; at $M=10$ and $\rho=0.5$ it is about 1.8. Both claims need exchangeable annotators and binary correctness. With several classes, scattered wrong calls can leave a plurality correct when the majority is not, so $P_{\mathrm{maj}}$ is a reference curve, not a bound.

The model-based alternative is the Dawid–Skene latent-class model [R9]. With class prior $\pi$ and annotator confusions $\theta^{(m)}_{c\ell}=P(y_{mi}=\ell\mid y_i=c)$, the posterior over the true class is

$$P(y_i=c\mid \mathbf L)\propto \pi_c\prod_m \theta^{(m)}_{c\,y_{mi}},$$

fitted by EM. The posterior is calibrated when annotators are conditionally independent given the true class and items are independent. It replaces hand-set weights with estimated reliabilities, gives posteriors that reliability diagrams can check, and lets confusions transfer to new studies of one tissue. Its failure is silent: shared references make correlated errors look like confident agreement. Plurality needs no fitting, which is why it remains the default.

Failure modes: with correlated errors, votes give high cp and low H around a wrong label; coarse-fine splits break votes that are not in conflict (see annotation.hierarchical_annotation); rare types lose plurality to abundant ones; and a cluster majority hides heterogeneity when `min_prop` is zero, as CellTypist's default is (section 4).

Estimands, one sentence each:

- **Consensus label**: the class with the largest weighted share of assigned calls, or unassigned on a tie or with no assigned call.
- **cp and H**: the modal share and the entropy in bits of one item's assigned-call distribution.
- **Accuracy**: the fraction of evaluated cells whose consensus label equals the expert term after mapping, with unassigned counted wrong; **coverage** is the fraction with an assigned label.
- **Paired gain**: per study, consensus accuracy minus the validation-selected best single annotator's accuracy on the same cells, averaged over studies.
- **Error and flag AUROC**: $e_i=1$ when an assigned consensus label differs from the expert term; the AUROC of the disagree flag for $e_i$ is computed per study over assigned cells.

Consensus is most defensible as an uncertainty signal and as a guard against one annotator's idiosyncratic failure. Accuracy gains need near-independent errors, so any accuracy claim must beat the best single annotator chosen on validation studies. Accuracy is dominated by abundant types, so macro-F1 and per-class recall are reported beside it.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CellTypist over-cluster vote | heuristic | Each over-cluster takes its modal per-cell prediction; below a dominant fraction the cluster is Heterogeneous | [R3] |
| mLLMCelltype consensus | heuristic | Plurality of LLM labels per cluster, accepted on consensus proportion and vote entropy, else discussion rounds | [R7] |
| scmap cell-to-cluster | heuristic | Assigns a cluster label only if best similarity exceeds a threshold and the $w$ nearest reference cells all agree | [R5] |
| SingleR | heuristic | Per-cell correlation with reference types, with fine-tuning among close candidates | [R4] |
| scPred | model-based | Per-type probabilistic classifiers; cells below a top-probability threshold are unassigned | [R6] |

Plurality voting is the only aggregation step among these implementations and the published standard for multi-annotator consensus. The other tools classify each cell from one model; the unanimity rule and SingleR's fine-tuning are internal to single tools (section 10).

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| mLLMCelltype consensus | consensus_threshold | 0.7 | python/mllmcelltype/consensus.py:1435 @ 26bda56 |
| mLLMCelltype consensus | entropy_threshold | 1.0 | python/mllmcelltype/consensus.py:1436 @ 26bda56 |
| CellTypist over-cluster vote | min_prop | 0 | celltypist/classifier.py:465 @ fe35756 |
| CellTypist command line | majority-voting | False | celltypist/command_line.py:40 @ fe35756 |
| scmap cell-to-cluster (comparator) | w; threshold | 3; 0.5 | R/AllGenerics.R:140 @ 88515b5 |
| scPred (comparator) | threshold | 0.55 | R/scPredict.R:32 @ af5492e |

## 5. Proposed singlet approach

- **Routes.** Port the mLLMCelltype gate and plurality, applied per cell instead of per cluster, and CellTypist's dominant-fraction rule; the LLM calls are not ported, because they send cell-level context to external providers. Reimplement the latent-class model from its equations. Callout: SingleR, scmap, scPred and mLLMCelltype as inputs and comparators (B1).
- **Method set.** `majority` is the default: the published standard, with no fitted parameter. `cluster_majority` adds CellTypist's cluster step. Both are deterministic. The latent-class model enters the method set only after its primary source is verified (section 10). It is falsified if it does not beat plurality on B3 at matched $M$ and $\rho$, or if its posterior confidence disagrees with held-out accuracy in reliability diagrams on B1; then plurality stays the default.
- **Stack and kernels.** The EM count and posterior steps are small, fixed-shape reductions over $N\times M\times C$ tensors with no gradients, so they are hard-coded in C++ for CPU and as a CUDA kernel. PyTorch is reserved for a learned stacking model, which is not proposed for the first version. cuSPARSE applies only if label matrices are stored sparse.
- **Streaming and defaults.** Both methods stream in cell chunks; `cluster_majority` accumulates cluster counts in a second scan over the cluster column. Defaults are in the section 6 table. The thresholds are published mLLMCelltype and CellTypist values and have not been calibrated.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obs/<annotator> | categorical | One label column per annotator; unassigned allowed |
| read | obs/<annotator>_score | float32 | Optional per-call probability for `score_threshold` |
| read | obs/<cluster_key> | categorical | Cluster labels, required by `cluster_majority` |
| read | uns/cl_label_map | dict | Label-to-Cell-Ontology map, applied before voting |
| write | obs/consensus_label | categorical | Consensus label; includes unassigned |
| write | obs/consensus_agreement | float32 | cp in [0, 1]; 0 when no call is assigned |
| write | obs/consensus_entropy | float32 | Vote entropy H in bits |
| write | obs/consensus_flag | categorical | agree, disagree or unassigned |
| write | uns/consensus_params | dict | Method, thresholds, annotator list, software versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "majority" | `majority`, `cluster_majority` | majority: per-cell plurality with acceptance gate. cluster_majority: also gives each cluster its modal label. |
| `annotators` | array | — | — | Two or more annotator label columns in obs to combine, as named in the dataset. |
| `unassigned_policy` | string | "abstain" | `abstain`, `count_as_vote` | abstain drops unassigned calls from the vote; count_as_vote makes unassigned a vote class. |
| `score_threshold` | number | 0.55 | min 0; max 1 | Per-annotator probability below which a call is unassigned, for annotators with a _score column. |
| `majority` | object | — | — | Options for method majority. |
| `majority.min_agreement` | number | 0.7 | min 0; max 1 | Minimum consensus proportion to accept a label; below it the flag is disagree. |
| `majority.max_entropy` | number | 1.0 | min 0 | Maximum vote entropy in bits to accept a label. |
| `majority.weights` | object | — | — | Per-annotator vote weights keyed by annotator name; uniform when absent. |
| `cluster_majority` | object | — | — | Options for method cluster_majority. |
| `cluster_majority.cluster_key` | string | — | — | obs column with cluster labels; the modal label is broadcast to its cells. |
| `cluster_majority.min_prop` | number | 0 | min 0; max 1 | Dominant-fraction threshold; clusters below it are Heterogeneous. Zero matches CellTypist. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Options under `majority` and `cluster_majority` apply only to their method, and `cluster_majority` needs `cluster_key`. `score_threshold` applies to annotators with a `_score` column, and `weights` must name annotators in `annotators`. Cell-level flags remain defined under `cluster_majority`.

## 7. MCP tool

Tool name `singlet_annotation_consensus_annotation` (definition in `tasks/mcp/singlet_annotation_consensus_annotation.json`).

```json
{"dataset": "/data/study.singlet", "method": "majority", "annotators": ["ann_celltypist", "ann_singler", "ann_llm"], "majority": {"min_agreement": 0.7, "max_entropy": 1.0}}
{"dataset": "/data/study.singlet", "status": "completed", "wrote": ["obs/consensus_label", "obs/consensus_agreement", "obs/consensus_entropy", "obs/consensus_flag", "uns/consensus_params"], "summary": {"n_annotators": 3, "coverage": "<fraction>", "flag_fraction": "<fraction>"}, "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: no, since the call is one scan over the label columns. Stochastic: no, since both methods are deterministic for fixed inputs and vocabulary. Dry run: returns estimated seconds, peak memory and device from the scaling measurements in P1.

## 8. Benchmarks

**Shared protocol.** Splits are at study level, with at least three studies per tissue. Thresholds and the best single annotator are chosen on validation studies only. Every annotator is applied to the same cells, with the same gene universe and one vocabulary mapped to Cell Ontology terms (annotation.cell_ontology_mapping). Accuracy counts unassigned calls as wrong, and coverage is always reported beside it. Bootstrap intervals are study-level with 2000 resamples (proposed). Hardware is stated with every timing.

### B1. Consensus versus best single annotator on held-out studies

- **Goal**: test whether consensus beats the validation-selected best single annotator on held-out studies with expert labels.
- **Ground truth**: expert labels mapped to Cell Ontology terms. The estimand is one expert term per cell after mapping; cluster labels are broadcast only where the source does so.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Abdelaal et al. 2019 collection | [R1] | scRNA-seq; 27 datasets; sizes — | — | Enumerated from the source |
| Held-out catalogue studies | singlet catalogue | scRNA-seq; sizes — | — | Author label quality unverified (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Accuracy | Fraction of cells whose consensus equals the expert term; unassigned counts wrong | maximize | primary | — |
| Macro-F1 | Mean over classes in truth of $2PR/(P+R)$; unpredicted classes score 0 | maximize | primary | — |
| Paired gain | Per-study consensus minus best single annotator accuracy; bootstrap over studies | maximize | primary | — |
| Coverage | Fraction of cells with an assigned label | maximize | guardrail | — |
| Pairwise agreement | Adjusted Rand index and Cohen's kappa between annotator pairs | report | guardrail | [R8] |

- **Comparators**: CellTypist, SingleR, scmap, scPred, mLLMCelltype consensus, the validation-selected best annotator, and the latent-class consensus of section 5.
- **Acceptance criterion (proposed)**: consensus macro-F1 exceeds the validation-selected annotator by at least 0.01 on average, with a 95% bootstrap interval above zero and no study worse by more than 0.05.
- **Known pitfalls**: correlated annotators make consensus look like one annotator, so read pairwise agreement beside accuracy; selecting the best annotator on test labels is leakage.

### B2. Disagreement flag as an error detector (proposed)

- **Goal**: test whether flagged cells have a much higher error rate than unflagged cells, so the flag can direct review.
- **Ground truth**: expert labels on the B1 held-out studies. $e_i=1$ when an assigned consensus label differs from the expert term after mapping.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Held-out studies of B1 | as B1 | as B1 | — | Thresholds fixed on validation studies |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC of the flag | Per study, AUROC of the disagree flag for $e_i$ over assigned cells, midrank ties; mean over studies | maximize | primary | — |
| Error-rate ratio | Flagged over unflagged error rate among assigned cells, averaged over studies | maximize | primary | — |
| Accuracy–coverage area | Area under accuracy versus coverage at 10 levels from 0.5 to 1.0, most disagreeing cells abstained first | maximize | guardrail | — |

- **Comparators**: entropy alone, cp alone, single-annotator probability, and random flags at the same rate.
- **Protocol**: fix thresholds on validation studies; compare at matched $M$ and flag rate.
- **Acceptance criterion (proposed)**: mean AUROC at least 0.7 and error-rate ratio at least 2. If it fails, labels are reported without a reliability claim.
- **Known pitfalls**: thresholds tuned on test labels; expert-label errors inflate the error rate of correct calls.

### B3. Planted correlated-annotator simulation (proposed)

- **Goal**: measure how consensus accuracy depends on error correlation when truth is planted, against the Condorcet and effective-size predictions of section 3.
- **Ground truth**: planted $y_i$; estimand is consensus accuracy against $y_i$, and the gain is accuracy minus $p$.
- **Generator recipe**
  1. Draw $N=10^4$ items with $y_i$ uniform over $C=10$ classes.
  2. Draw $u_i=y_i$ with probability $p$, otherwise uniform over the other $C-1$ classes.
  3. For each annotator $m\le M$: with probability $\sqrt{\rho}$ set $\ell_{mi}=u_i$; otherwise set $\ell_{mi}=y_i$ with probability $p$, else uniform over the other $C-1$ classes.
  4. Output the $M$ label vectors and $y$; the correctness correlation is then $\rho$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Generator recipe above | proposed | synthetic labels; $N=10^4$, $C=10$ | — | Design choice, not a literature value |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Consensus accuracy | Fraction of items with consensus equal to $y_i$; mean over 50 replicates for each $M\in\{3,5,9\}$, $p\in\{0.6,0.75,0.9\}$, $\rho\in\{0,0.3,0.6,0.9\}$ | maximize | primary | — |
| Gap to size prediction | Absolute difference between empirical gain and $P_{\mathrm{maj}}(\hat M,p)-p$, with $\hat M$ rounded to the nearest odd integer | minimize | guardrail | [R10] |

- **Comparators**: a single annotator (accuracy $p$), unweighted plurality, and the latent-class consensus.
- **Protocol**: one recipe instance per setting and replicate, shared by all comparators. A binary variant maps every wrong label to one class.
- **Acceptance criterion (proposed)**: at $\rho=0$, $M=9$, $p=0.75$, plurality exceeds the single annotator by at least 0.05; at $\rho=0.9$ the gain lies within 0.01 of zero; the latent-class consensus is within 0.01 of plurality or above it in every setting.
- **Known pitfalls**: the simulation favours the model it is built around; estimate $\rho$ from data before using it to set expectations.

### P1. Performance and scaling

- **Quantities**: wall time, peak memory and throughput in cells per second for aggregating $M$ label columns over $N$ cells. Only aggregation is timed, not the annotators or over-clustering.
- **Scales**: $N\in\{10^4,10^5,10^6,10^7\}$ (10M because streaming is claimed), $M\in\{2,5,10\}$, $C\in\{10,50,200\}$, and 0 to 5% unassigned calls.
- **Comparators**: pandas and polars group-by plurality, the R base table vote, CellTypist's over-cluster voting step, and the singlet CPU and CUDA count steps.
- **Hold fixed**: integer label encoding after the shared vocabulary, the unassigned policy, and the thread count. Report CPU cores, RAM and GPU model.
- **Acceptance criterion (proposed)**: log–log scaling exponent in $N$ between 0.9 and 1.1 for each implementation at fixed $M$ and $C$. Extrapolation to the 354-million-cell catalogue uses only measured sizes.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.cell_ontology_mapping`: Cell type name harmonization to Cell Ontology terms
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
  - `annotation.llm_cluster_annotation`: LLM-based cluster annotation from marker gene lists
  - `annotation.annotation_confidence_calibration`: Annotation and label-transfer confidence calibration and abstention
- **Feeds**:
  - `annotation.mislabelled_cell_detection`: Detection of mislabelled and ambiguous cells in an existing annotation
  - `annotation.cross_dataset_label_reconciliation`: Cross-dataset cell-type label reconciliation
- **Reads**: `obs/<annotator>`, `obs/<annotator>_score`, `obs/<cluster_key>`, `uns/cl_label_map`
- **Writes**: `obs/consensus_label`, `obs/consensus_agreement`, `obs/consensus_entropy`, `obs/consensus_flag`, `uns/consensus_params`
<!-- CHAINING:AUTO:END -->

Workflow: annotation, after cell-level labelling, label calibration and ontology mapping, before mislabelled-cell detection and cross-study reconciliation.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The Dawid–Skene (1979) and Condorcet (1785) citations are from memory, so the latent-class model stays out of the method set until its source is checked. The Clarke et al. (2021) author list comes from a bibliographic record, and some author lists in R4 and R5 are from memory. The Abdelaal dataset names, sizes and accessions, and the OpenProblems label-projection datasets, were not enumerated. The mLLMCelltype entropy log base was not read; its benchmark figures are repository claims. Local clones carry no commit metadata, so the section 4 shas are GitHub HEAD at check time.
- **Unsettled literature.** Whether annotators that share references and markers err independently is unmeasured, and that decides whether aggregation helps. The thresholds 0.7 and 1.0 (mLLMCelltype), 0.55 (scPred) and 0.5 (scmap) are code defaults, not fitted to error rates. The catalogue lists SingleR, scmap and scPred as majority voters, but none aggregates labels across annotators. Abstention and tie handling for hierarchical calls have no benchmark.
- **Technical and data risks.** LLM panels send cell-level context to external providers and are not deterministic. Expert labels from public datasets were often made by marker-based clustering, so truth shares annotator biases. Catalogue author labels are of unverified quality, and whether the catalogue holds several annotations per cell, which the latent-class model needs, is also unverified.
- **First experiment.** Begin with B3, which needs no external data and tests whether plurality gains follow the Condorcet and effective-size predictions as $\rho$ rises. Then apply B1 and B2 to held-out studies.

## 11. References

R1. Abdelaal T, Michielsen L, Cats D, Hoogduin D, Mei H, Reinders MJT, Mahfouz A. A comparison of automatic cell identification methods for single-cell RNA sequencing data. *Genome Biology* 2019. doi:10.1186/s13059-019-1795-z — verified (corpus)
R2. Clarke ZA, Andrews TS, Atif J, Pouyabahar D, Innes BT, MacParland SA, Bader GD. Tutorial: guidelines for annotating single-cell transcriptomic maps using automated and manual methods. *Nature Protocols* 2021;16:2749-2764. doi:10.1038/s41596-021-00534-0 — partial (search)
R3. Domínguez Conde C, Xu C, Jarvis LB, et al. Cross-tissue immune cell analysis reveals tissue-specific features in humans. *Science* 2022. doi:10.1126/science.abl5197 — verified (corpus)
R4. Aran D, Looney AP, Liu L, et al. Reference-based analysis of lung single-cell sequencing reveals a transitional profibrotic macrophage. *Nature Immunology* 2019. doi:10.1038/s41590-018-0276-y — verified (corpus)
R5. Kiselev VY, Yiu A, Hemberg M. scmap: projection of single-cell RNA-seq data across data sets. *Nature Methods* 2018. doi:10.1038/nmeth.4644 — verified (corpus)
R6. Alquicira-Hernandez J, Sathe A, Ji HP, Nguyen Q, Powell JE. scPred: accurate supervised method for cell-type classification from single-cell RNA-seq data. *Genome Biology* 2019. doi:10.1186/s13059-019-1862-5 — verified (corpus)
R7. Yang C, Zhang X, Chen J. Large language model consensus substantially improves the cell type annotation accuracy for scRNA-seq data. *Communications Biology* 2026. doi:10.1101/2025.04.10.647852 — verified (corpus)
R8. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R9. Dawid AP, Skene AM. Maximum likelihood estimation of observer error-rates using the EM algorithm. *Applied Statistics* 1979. — unverified (memory)
R10. Condorcet MJA de. Essai sur l'application de l'analyse à la probabilité des décisions rendues à la pluralité des voix. Paris: Imprimerie royale; 1785. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/Teichlab/celltypist | Chuan Xu (setup.py author); CITATION.cff also lists Domínguez Conde C and Xu C | MIT | Dominant-fraction cluster vote | port (cluster step); callout (comparator) |
| https://github.com/cafferychen777/mLLMCelltype | Chen Yang, Xianyang Zhang, Jun Chen (CITATION.cff) | MIT | Acceptance gate and plurality | port (gate only); callout (comparator) |
| https://github.com/hemberg-lab/scmap | Vladimir Kiselev (DESCRIPTION author and maintainer) | GPL-3 | Unanimity rule | callout (comparator) |
| https://github.com/dviraran/SingleR | Dvir Aran (DESCRIPTION author and maintainer) | GPL-3 | Single-annotator input | callout (comparator) |
| https://github.com/powellgenomicslab/scPred | Jose Alquicira-Hernandez (DESCRIPTION author and maintainer) | MIT | Single-annotator input | callout (comparator) |
