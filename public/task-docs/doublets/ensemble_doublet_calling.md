---
id: doublets.ensemble_doublet_calling
title: Ensemble and consensus doublet calling
area: doublets
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [doublets.expression_doublet_scoring, doublets.doublet_call_thresholding, doublets.expected_rate_estimation]
feeds: [doublets.artifact_cluster_detection]
reads: [obs/<tool>_call, obs/scds_cxds_score, obs/scds_bcds_score, obs/<truth_key>]
writes: [obs/doublet_consensus, obs/doublet_score, obs/doublet_votes, obs/doublet_n_tools, uns/doublet_ensemble]
devices: [cpu, cuda]
mcp_tool: singlet_doublets_ensemble_doublet_calling
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Ensemble and consensus doublet calling

> Combines per-barcode doublet calls or scores from several detectors into one consensus call with vote counts, using rules that need no training labels, and benchmarks every rule against the best single detector.

## 1. Question

Given per-barcode doublet calls or scores from two or more detectors on one library, which consensus call should be reported, and does it beat the best single detector? Inputs are the detector outputs in `obs/` and an optional expected doublet rate. Outputs are a boolean call, a per-barcode score and vote counts. A correct answer identifies real multiplets better than the best single detector, on labels independent of every detector [R4]. No single accepted ground truth exists, so each claim is tied to its label source in section 8.

## 2. Why this task matters and where the field stands

Doublet detectors disagree, and none dominates. Xi and Li benchmarked nine detectors on experimentally annotated libraries and report that no method is best in every respect [R4]. Summaries of [R4] and of its protocol companion for eight methods [R5] name different top detectors, so the best single tool depends on the benchmark. Consensus is the usual response, in two families: label-level votes over detector calls, as in the Demuxafy combinations [R2], and score-level combiners, such as the scds sum of cxds and bcds scores [R3] or Chord's boosted meta-classifier [R9].

Status: **contested**. Open problems:

- Correlated errors. Most detectors build artificial or simulated doublets and score neighbourhoods in PCA or kNN space [R1][R6][R7][R8], so their votes are not independent evidence.
- No calibrated consensus. The label vote [R2] returns vote shares and the scds sum [R3] returns min-max scores. Neither is a probability.

## 3. Theory and insight

For barcode $i$, detector $k$ gives a hard call $d_{ik}\in\{0,1\}$ (1 = doublet) and, where available, a score $s_{ik}$. $K_i$ detectors answer for barcode $i$. The latent status is $y_i\in\{0,1\}$ (1 = multiplet), with prior rate $\rho=P(y_i=1)$.

Estimand of each output:

- Doublet votes $v_i=\sum_k d_{ik}$, an integer from 0 to $K_i$. The share $v_i/K_i$ is an ordinal score with $K_i+1$ levels, not a probability.
- Majority rule: a barcode is a singlet iff more than half of the answering detectors say singlet, $\sum_k(1-d_{ik})>K_i/2$, so ties are doublets. At-least-half uses $\ge K_i/2$. Any-singlet calls doublet only if every detector does; any-doublet calls singlet only if every detector does.
- scds hybrid: $h_i=\tilde s^{\mathrm{cxds}}_i+\tilde s^{\mathrm{bcds}}_i$ with $\tilde s^k_i=(s^k_i-\min_j s^k_j)/(\max_j s^k_j-\min_j s^k_j)$ over the library. $h$ lies in $[0,2]$, is invariant to affine changes of either score within a library, and is not comparable across libraries [R3].
- Top-k call: $\mathcal D=\{i:\,s_i\ge s_{(m)}\}$ with $m=\mathrm{round}(rN)$, where $r$ is the expected rate. Ties at the cutoff add calls. A misspecified $r$ moves precision and recall in the same direction for every detector.

Regime of the vote. If $K$ detectors were conditionally independent with common accuracy $p>1/2$, the majority would converge to the truth:

$$P_{\mathrm{maj}}=\sum_{j>K/2}\binom{K}{j}p^j(1-p)^{K-j}\xrightarrow[K\to\infty]{}1.$$

Detectors share count-depth and neighbourhood features, so this bound is optimistic.

Model-based route (proposed). Under conditional independence given $y$, with detector-specific confusion parameters $\theta^{(k)}_{c,d}=P(d_k=d\mid y=c)$, the posterior is

$$P(y_i=1\mid\mathbf d_i)=\frac{\rho\prod_k\theta^{(k)}_{1,d_{ik}}}{\rho\prod_k\theta^{(k)}_{1,d_{ik}}+(1-\rho)\prod_k\theta^{(k)}_{0,d_{ik}}}.$$

It is calibrated only if conditional independence and $\rho$ hold. It also estimates per-detector error rates, which vote rules do not. Identifiability needs three or more detectors under this model [R10].

Estimands of the evaluation quantities:

- Expected calibration error, $\mathrm{ECE}=\sum_b\frac{|B_b|}{N}\,|\bar y_{B_b}-\bar p_{B_b}|$, is the binned mean absolute gap between predicted and observed multiplet frequency over labelled barcodes.
- Average precision, $\sum_n(R_n-R_{n-1})P_n$, is the step-interpolated area under the precision-recall curve of a score over labelled barcodes. Its chance level is the labelled prevalence $\pi$, so it is comparable across libraries only at matched $\pi$.
- A benchmark label is $y_i=1$ when the source study annotates barcode $i$ as carrying two identities, so $\pi$ is the detectable inter-sample fraction, not the total multiplet rate. Homotypic multiplets are unlabelled and are excluded, never counted as singlets.

Failure modes:

- Homotypic doublets, with the same type and different donors or no identity difference, are invisible to transcriptome-only detectors. A consensus cannot recover them, and inter-sample labels cover only the detectable subset.
- A failed detector can act as a doublet vote. The published script maps missing values to "unassigned" (Combine_Results.R:713), which is not "singlet", and the majority denominator still counts that tool (line 784).
- Chord's overkill step labels the top barcodes by bcds, cxds and DoubletFinder as doublets (1overkillDB.R:28-30), and its combiner trains on those labels, so it can learn the shared bias rather than doublet biology. Its gbm fit uses a gaussian response on a factor (5boost.R:70-71), so its output is a regression value, not a probability.
- Per-droplet UMI and gene counts bias singlet and doublet calls [R2].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Label votes (majority, at-least-half, any-singlet, any-doublet) | heuristic | Fixed rules over each detector's hard call | [R2] |
| scds cxds plus bcds hybrid | hybrid | Sum of per-library min-max normalised scores, with a rate-based cut | [R3] |
| Chord | model-based | Boosted classifier on bcds, cxds and DoubletFinder scores, trained on overkill pseudo-labels | [R9] |
| DoubletFinder | heuristic | Fraction of artificial nearest neighbours (pANN), called at an expected count | [R6] |
| scDblFinder | model-based | Classifier separating barcodes from artificial doublets using neighbourhood features | [R1] |
| Scrublet | heuristic | Nearest-neighbour score against simulated doublets, thresholded on their distribution | [R7] |
| Solo | model-based | Semi-supervised neural network separating barcodes from simulated doublets | [R8] |
| DoubletDetection | model-based | Classifier over synthetic doublets | — |

The label vote [R2] and the scds hybrid [R3] are the consensus rules read in code; Chord [R9] is the only boosted combiner read. Detector rows are inputs to consensus here and comparators in section 8. Chord's components overlap with the detectors it combines, so its gains need an independent benchmark.

Defaults as read in source code (commit identifiers are the remote HEAD at check time):

| Method | Parameter | Value | Source |
|---|---|---|---|
| Chord | method | `"gbm"` | R/runrunrun.R:44 @ 00ac9a1 |
| Chord | overkill, overkillrate | `TRUE`, `1` | R/runrunrun.R:45-46 @ 00ac9a1 |
| Chord | k (k-means on first 30 PCs) | 20 | R/runrunrun.R:43; R/1overkillDB.R:38-39 @ 00ac9a1 |
| Chord | gbm trees, shrinkage, CV folds | 1000, 0.01, 5 | R/5boost.R:71 @ 00ac9a1 |
| Chord | gbm distribution | `"gaussian"` on a factor response | R/5boost.R:70-71 @ 00ac9a1 |
| Chord | dbf.PCs, dbf.pN | `1:10`, 0.25 | R/runrunrun.R:57-58 @ 00ac9a1 |
| Chord | cxds.ntop, bcds.ntop when unset | 500, 500 | R/3cxds boosting.R:16-17 @ 00ac9a1 |
| Chord | seed | 1 | R/runrunrun.R:48 @ 00ac9a1 |
| scds | cxds ntop, binThresh | 500, 0 | R/cxds.R:24 @ c9054c2 |
| scds | bcds ntop, srat | 500, 1 | R/bcds.R:38 @ c9054c2 |
| scds | estNdbl (hybrid calls) | FALSE | R/cxds_bcds_hybrid.R:20 @ c9054c2 |
| scds | threshold type | `"balanced"` | R/make_calls.R:38 (documented default) @ c9054c2 |
| DoubletFinder | pN | 0.25 | R/doubletFinder.R:61 @ 1b244d8 |
| Demuxafy | combination method | no numeric default; four options | docs/source/CombineResults.rst:161-163 @ 7369a42 |

## 5. Proposed singlet approach

Routes per method are listed in section 12. Label votes and the scds hybrid are ported as small functions. Chord is kept as a comparator because it recomputes its own detectors instead of consuming supplied outputs, and its training labels come from those detectors (section 3). Detectors are inputs here.

Missing calls are abstentions. Barcode $i$ is decided by its $K_i$ answering detectors, written to `obs/doublet_n_tools`. Majority rules need three answering detectors and any-rules need two. Below that count the consensus call is missing.

Model-based proposal. (a) A label-free latent-class consensus (section 3), with $\theta$ fitted by EM on the library's own calls and $\rho$ from `doublets.expected_rate_estimation`. (b) A logistic stacker fitted to planted multiplets from `doublets.synthetic_doublet_simulation`, validated leave-one-library-out. Neither joins the MCP enum until its primary reference is read and the B1 bar is met. Variant (a) is falsified if its B1 mean AUPRC does not beat the best rule by the B1 margin, or if B3 calibration fails.

Stack. The core is dependency-free C++. Vote and hybrid rules are linear scans that stream in chunks; the hybrid needs two scans, one for the per-library minimum and maximum and one for the sum. The EM and stacker are small dense updates over $K$ detectors, hard-coded on CPU with a CUDA kernel rather than PyTorch.

Defaults for agents. `method=majority_vote` with at least three detectors in `tools`; no labels; `expected_doublet_rate` only for `scds_hybrid_topk`; `truth_key` only for reporting.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `obs/<tool>_call` | categorical | Hard call of each detector, `singlet` or `doublet` |
| read | `obs/scds_cxds_score` | float32 | cxds score; `scds_hybrid_topk` only |
| read | `obs/scds_bcds_score` | float32 | bcds score; `scds_hybrid_topk` only |
| read | `obs/<truth_key>` | bool | Optional inter-sample multiplet label; reporting only |
| write | `obs/doublet_consensus` | bool | Consensus call; `True` = doublet; missing when too few detectors answer |
| write | `obs/doublet_score` | float32 | Vote share for vote methods; hybrid sum for `scds_hybrid_topk` (section 3) |
| write | `obs/doublet_votes` | int16 | Doublet votes among answering detectors (vote methods) |
| write | `obs/doublet_n_tools` | int16 | Answering detectors $K_i$ for each barcode |
| write | `uns/doublet_ensemble` | dict | Method, tools, rate and detector versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "majority_vote" | `majority_vote`, `at_least_half_vote`, `any_singlet_vote`, `any_doublet_vote`, `scds_hybrid_topk` | Combination rule. Vote methods read obs/<tool>_call; scds_hybrid_topk sums two scds scores and calls the top expected-rate fraction. |
| `tools` | array | — | — | Detector names whose obs/<tool>_call columns are voted; majority rules need at least three answering tools. |
| `expected_doublet_rate` | number/null | null | min 0; max 0.5 | Required for scds_hybrid_topk: fraction of barcodes to call as doublets. Ignored by vote methods. |
| `truth_key` | string | — | — | Optional obs column of inter-sample labels, used only to report recall and precision; never changes calls. |
| `scds_hybrid` | object | — | — | Score columns for scds_hybrid_topk; defaults match the scds cxds and bcds outputs. |
| `scds_hybrid.cxds_score_key` | string | "scds_cxds_score" | — | obs column holding the cxds score. |
| `scds_hybrid.bcds_score_key` | string | "scds_bcds_score" | — | obs column holding the bcds score. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; the current rules are linear in barcodes times tools and run on CPU, so auto selects cpu. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing obs/doublet_* and uns/doublet_ensemble members instead of failing. |
<!-- PARAMS:AUTO:END -->

Vote methods use `tools`. `scds_hybrid_topk` uses `scds_hybrid` and `expected_doublet_rate` and ignores `tools`. `expected_doublet_rate` must lie between 0 and 0.5. `truth_key` changes reporting only, never a call. Existing `obs/doublet_*` members are replaced only with `overwrite`.

## 7. MCP tool

Tool name `singlet_doublets_ensemble_doublet_calling` (definition in `tasks/mcp/singlet_doublets_ensemble_doublet_calling.json`). Example call and result (values illustrative):

```json
{"dataset": "/data/example.singlet", "method": "majority_vote", "tools": ["scds_cxds", "scds_bcds", "doubletfinder", "scdblfinder"]}
{"dataset": "/data/example.singlet", "status": "completed", "wrote": ["obs/doublet_consensus", "obs/doublet_score", "obs/doublet_votes", "obs/doublet_n_tools", "uns/doublet_ensemble"], "summary": {"method": "majority_vote", "n_barcodes": 1000, "n_doublet_calls": 60, "doublet_call_rate": 0.06, "n_partial_barcodes": 0}, "provenance_id": "prov_example", "job_id": null}
```

Long-running: no; the rules are linear and complete inline. Stochastic: no; no seed is exposed. Dry run: `dry_run` returns `estimate` (seconds, peak_memory_gb, device) and writes nothing.

## 8. Benchmarks

Every accuracy benchmark scores a consensus call or score against a per-barcode label $y$ that is independent of all detector outputs. Barcodes without a label are excluded from every metric and are never counted as singlets. Detectors run with the defaults in section 4 on identical count matrices, with seed 1. Rules see only detector outputs. Any fitted model is trained on other libraries, leave-one-library-out. Call metrics use the rule's own binary calls. AUPRC uses the continuous score, with tied scores grouped. The top-k rate $r$ is the labelled multiplet fraction of each library, so comparisons are at matched call counts. Thresholds marked proposed are design choices, not literature values.

### B1. Experimentally annotated real libraries (published reference)

- **Goal**: test whether a consensus beats the best single detector on real, orthogonally annotated libraries.
- **Ground truth**: orthogonal measurement. $y_i=1$ when the source study annotates barcode $i$ as carrying two identities [R4], $0$ when it carries one. $\pi$ is the labelled multiplet fraction per library; unlabelled barcodes are excluded.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Real libraries with experimental multiplet annotations | [R4] | scRNA-seq; species and sizes per library in [R4] | — | Annotation per library as in [R4] |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC, mean over libraries | Average precision of the continuous score over labelled barcodes, tied scores grouped; score is the vote share for label votes and $h$ for the hybrid; chance is $\pi$ | maximize | primary | [R4] |
| Call F1 | F1 of the rule's own binary calls over labelled barcodes | maximize | guardrail | — |

- **Comparators**: each single detector (DoubletFinder [R6], scDblFinder [R1], scds cxds and bcds [R3], Scrublet [R7], Solo [R8], DoubletDetection); the four label votes and the scds hybrid top-k; Chord as a callout [R9]; the latent-class variant when it exists.
- **Protocol**: report the best single detector of each library beside the mean.
- **Acceptance criterion** (proposed): mean AUPRC exceeds the best single detector's mean by at least 0.02 absolute, and matches or exceeds that library's best single detector on at least two thirds of libraries. The bar is recomputed locally, not taken from the literature.
- **Known pitfalls**: AUPRC depends on $\pi$, so each library is compared with its own chance level, not across libraries.

### B2. Planted multiplets in validation libraries (proposed)

- **Goal**: compare rules on identical planted multiplets with known origin, in base libraries of a published multiplexing study.
- **Ground truth**: planted simulation. A planted barcode is the sum of two barcodes drawn uniformly from the same library, so $y=1$ by construction; real barcodes have $y=0$. Planted barcodes are a fraction $f=0.1$ of the augmented library (proposed).
- **Generator recipe**: (1) take each base library's raw counts; (2) draw $M=fN/(1-f)$ distinct random pairs and add their summed counts as planted barcodes; (3) run each detector on the augmented matrix with section 4 defaults; (4) score every rule on the augmented barcodes.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| PBMC and fibroblast validation libraries | [R2] | scRNA-seq; sizes per [R2] | — | Base libraries for step 1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC | Average precision over augmented barcodes; chance is $f$ | maximize | primary | — |
| Call F1; singlet recall | F1 of calls on planted barcodes; fraction of real barcodes called singlet | maximize | guardrail | — |

- **Comparators**: as in B1.
- **Protocol**: pair-draw seed 1, plus three further seeds (proposed), reporting the spread.
- **Acceptance criterion** (proposed): on every base library, the best label vote's call F1 is at least that of the best single detector, and its singlet recall is at least 0.95.
- **Known pitfalls**: planted pools are random pairs whose depth and homotypic mix differ from real multiplets. Real multiplets among the $y=0$ barcodes add equal false positives to every rule.

### B3. Calibration on held-out libraries (proposed)

- **Goal**: check whether a proposed probability matches observed multiplet frequencies on libraries it was not fitted to. Vote shares and hybrid sums are not probabilities and are excluded.
- **Ground truth**: orthogonal measurement, as in B1. Normalisation: each held-out library is binned into 10 equal-count bins over its labelled barcodes.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Held-out libraries of B1 | [R4] | As in B1 | — | Fitted on the other libraries only |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Expected calibration error | ECE over the 10 equal-count bins, as in section 3 | minimize | primary | — |
| Brier score | Mean of $(p_i-y_i)^2$ over labelled barcodes | minimize | guardrail | — |

- **Comparators**: logistic recalibration of each single detector's score, fitted on the training libraries only.
- **Protocol**: fit on training libraries, predict held-out libraries, and report each library separately.
- **Acceptance criterion** (proposed): ECE at most 0.05 on each held-out library, and a Brier score no worse than that of the best recalibrated single detector.
- **Known pitfalls**: ECE depends on the bin count and is unstable where bins are sparse at low prevalence. Calibration holds only when the labels are independent of the training labels.

### P1. Performance and scaling

Measure wall time and peak resident memory of (i) each detector alone, (ii) the consensus step alone, and (iii) the full pipeline, on CPU at 10k, 100k and 1M barcodes, with the consensus step also at 10M to test the streaming claim. Hold fixed the count layout, `ntop` 500 for scds, DoubletFinder PCs 1:10 with pN 0.25, seed 1 and the thread count. Report time per $10^5$ barcodes and the log-log slope of time against $N$. Acceptance criterion (proposed): at 100k barcodes the consensus step adds under 5% of the cheapest detector's wall time, and the slope lies between 0.9 and 1.1. CUDA is measured once the latent-class variant exists.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `doublets.expression_doublet_scoring`: Expression-based per-cell doublet scoring
  - `doublets.doublet_call_thresholding`: Doublet score-to-call thresholding
  - `doublets.expected_rate_estimation`: Expected doublet rate estimation
- **Feeds**:
  - `doublets.artifact_cluster_detection`: Doublet-driven artifact clusters and doublet-versus-transitional-state discrimination
- **Reads**: `obs/<tool>_call`, `obs/scds_cxds_score`, `obs/scds_bcds_score`, `obs/<truth_key>`
- **Writes**: `obs/doublet_consensus`, `obs/doublet_score`, `obs/doublet_votes`, `obs/doublet_n_tools`, `uns/doublet_ensemble`
<!-- CHAINING:AUTO:END -->

This is the consensus stage of doublet calling. It follows per-detector scoring and call thresholding and precedes cluster-level artifact checks.

## 10. Risks, pitfalls and open questions

- Evidence not independently verified: the library count, the DoubletFinder mean AUPRC of 0.537 and the no-dominance ranking come from a secondary description of [R4], and the count-bias finding and 14-tool scope come from a secondary description of [R2]. The scds year differs between records (2019 and 2020). The Chord paper was not read, so its accuracy claims rest on its own simulation design, whose labels overlap with its inputs (section 3). The Dawid-Skene model and its identifiability condition are cited from memory [R10]. The scDblFinder classifier details come from its README only, and the Scrublet threshold procedure was not read in code.
- Unsettled: whether latent-class identifiability holds when detectors share features, whether a learned consensus transfers across chemistries and tissues, and whether the rate prior helps when the expected rate is wrong.
- Technical and data risks: the Chord gbm call (5boost.R:70-71) was read but not executed. Benchmark annotations may carry hashing or genotype errors. The base-library licences in B2 are not stated here.
- First experiment: compute B1 for the four label votes and the scds hybrid from existing detector outputs, to fix the bar the latent-class variant must beat.

## 11. References

R1. Germain PL, Lun A, Garcia Meixide C, Macnair W, Robinson MD. Doublet identification in single-cell sequencing data using scDblFinder. *F1000Research* 2022. doi:10.12688/f1000research.73600.2 — verified (corpus)
R2. Neavin D, et al. Demuxafy: improvement in droplet assignment by integrating multiple single-cell demultiplexing and doublet detection methods. *Genome Biology* 25:94, 2024. doi:10.1186/s13059-024-03224-8 — verified (corpus)
R3. Bais AS, Kostka D. scds: computational annotation of doublets in single-cell RNA sequencing data. *Bioinformatics* 36(4):1150–1158, 2020. doi:10.1093/bioinformatics/btz698 — verified (corpus)
R4. Xi NM, Li JJ. Benchmarking computational doublet-detection methods for single-cell RNA sequencing data. *Cell Systems* 12(2):176–194, 2021. doi:10.1016/j.cels.2020.11.008 — verified (corpus)
R5. Xi NM, Li JJ. Protocol for executing and benchmarking eight computational doublet-detection methods in single-cell RNA sequencing data analysis. *STAR Protocols* 2021. doi:10.1016/j.xpro.2021.100699 — verified (corpus)
R6. McGinnis CS, Murrow LM, Gartner ZJ. DoubletFinder: doublet detection in single-cell RNA sequencing data using artificial nearest neighbors. *Cell Systems* 2019. doi:10.1016/j.cels.2019.03.003 — verified (corpus)
R7. Wolock SL, Lopez R, Klein AM. Scrublet: computational identification of cell doublets in single-cell transcriptomic data. *Cell Systems* 2019. doi:10.1016/j.cels.2018.11.005 — verified (corpus)
R8. Bernstein NJ, Fong NL, Lam I, Roy MA, Hendrickson DG, Kelley DR. Solo: doublet identification in single-cell RNA-seq via semi-supervised deep learning. *Cell Systems* 11(1):95–101, 2020. doi:10.1016/j.cels.2020.05.010 — verified (corpus)
R9. Xiong K-X, Zhou H-L, et al. Chord: an ensemble machine learning algorithm to identify doublets in single-cell RNA sequencing data. *Communications Biology* 2022. doi:10.1038/s42003-022-03476-9 — verified (corpus)
R10. Dawid AP, Skene AM. Maximum likelihood estimation of observer error-rates using the EM algorithm. *Applied Statistics* 28(1), 1979. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/13308204545/Chord | Kexu Xiong and Hanlin Zhou (DESCRIPTION) | MIT (DESCRIPTION); no LICENSE file at the root | Comparator with defaults; source of the defaults in section 4 | callout |
| https://github.com/drneavin/Demultiplexing_Doublet_Detecting_Docs | Repository owner drneavin; paper authors per [R2] | MIT (LICENSE, 2024) | Label-vote rules | port |
| https://github.com/kostkalab/scds | Dennis Kostka (DESCRIPTION) | MIT + file LICENSE (2019) | cxds and bcds scores; hybrid formula | port (formula only) |
| https://github.com/chris-mcginnis-ucsf/DoubletFinder | Christopher S. McGinnis (DESCRIPTION) | CC0 (DESCRIPTION); no LICENSE file at the root | Comparator | callout |
| https://github.com/plger/scDblFinder | Repository handle plger; paper authors per [R1] | GPL-3 + file LICENSE | Comparator | callout; copyleft, not ported |
| https://github.com/AllonKleinLab/scrublet | Samuel L. Wolock | MIT (LICENSE) | Comparator | callout |
| https://github.com/calico/Solo | David Kelley, Nick Bernstein (solo/__init__.py) | MIT (LICENSE); setup.py states Apache | Comparator | callout |
| https://github.com/JonathanShor/DoubletDetection | Adam Gayoso and Jonathan Shor | MIT (LICENSE.txt) | Comparator | callout |
