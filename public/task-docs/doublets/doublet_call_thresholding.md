---
id: doublets.doublet_call_thresholding
title: Doublet score-to-call thresholding
area: doublets
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [doublets.expression_doublet_scoring, doublets.expected_rate_estimation]
feeds: [doublets.ensemble_doublet_calling, doublets.artifact_cluster_detection]
reads: [obs/doublet_score_<method>, uns/doublet_sim_scores_<method>, obs/<sample_key>, obs/<celltype_key>, obs/n_cells_loaded]
writes: [obs/doublet_call_<method>, obs/doublet_zscore_scrublet, uns/doublet_threshold_<method>, uns/doublet_diag_<method>]
devices: [cpu]
mcp_tool: singlet_doublets_doublet_call_thresholding
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Doublet score-to-call thresholding

> Turns each barcode's continuous doublet score into a singlet or doublet call by a stated cut, count or probability rule, and reports the implied doublet fraction for each library.

## 1. Question

Given one library's per-barcode doublet scores, the simulated-doublet scores and an expected doublet rate, where should the cut go so that the called barcodes are the true multiplets, in the right number? The output is a label per barcode, the cut or count used and the implied doublet fraction. A correct answer calls barcodes that hold two or more cells, in the number the library implies, and states how sensitive that number is to the rate. Truth is only partly observable: hashing and genotype labels cover inter-sample multiplets, and planted libraries cover what the simulator contains (section 8).

## 2. Why this task matters and where the field stands

A score is not a label. The cut decides how many barcodes are removed and which ones, so it sets the doublet count that clusters and annotations inherit. Published comparisons rank detectors by score quality rather than by the cut. The status is **contested**.

1. **Threshold-free benchmarks do not test the cut.** A 2021 benchmark compared doublet detectors on real datasets with experimentally labelled doublets and on synthetic datasets, using threshold-free metrics [R1]. Its addendum [R2], as quoted in the scDblFinder README, reports precision, recall and true-negative rate at a fixed 10% identification rate, a fixed-fraction cut rather than a tuned one.
2. **Heuristic rates may run low.** A 2025 study that takes cell-hashing multiplets as a floor reports that heuristic multiplet-rate estimates can fall below hashing-observed fractions, and that detectors flag only a small share of hashing-identified multiplets, even when tuned [R3].
3. **Tuning matters.** A tuning study of scDblFinder reports that hyperparameter choice significantly affects detection performance [R4].
4. **The rate is an input.** The scDblFinder documentation takes the expected rate as an explicit input with an uncertainty term, and notes that setting the uncertainty to 1 leaves the thresholding entirely to the misclassification rates (section 12).
5. **Open problems.** Homotypic doublets are nearly indistinguishable from singlets of their type and lower the detectable rate. Scores are not on a common scale across detectors or across libraries of different size. The neighbourhood size chosen by the BCmvn sweep can have several maxima (DoubletFinder README, section 12). No ambiguous class is shared across tools.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $n$, $n_{\mathrm{sim}}$, $r$ | called barcodes in one library, simulated doublets, and $r=n_{\mathrm{sim}}/n$ |
| $s_i$, $s^{\mathrm{sim}}_j$ | score of barcode $i$ and of simulated doublet $j$ |
| $\rho$, $\rho_{\mathrm{het}}$ | expected fraction of called barcodes that are multiplets, and its heterotypic part |
| $f_c$ | annotated frequency of cell type $c$ in the library |
| $\lambda$ | mean cells per droplet under Poisson loading |

**Estimands.** Each call is a binary label per called barcode, one when the barcode holds two or more cells. An implied rate is the number of calls divided by the called barcodes of the same library. The expected rate $\rho$ is the same fraction, and $\rho_{\mathrm{het}}$ its heterotypic part. The planted truth is the number of planted doublet barcodes divided by all barcodes of the simulated library. The hashing truth (section 10) is the number of called barcodes carrying hashes from two samples, divided by called barcodes.

**Mixture view.** Observed scores mix singlet and doublet scores, so the upper tail above a cut $t$ satisfies

$$P_{\mathrm{obs}}(s\ge t)=(1-\pi)\,P_0(s\ge t)+\pi\,P_d(s\ge t),$$

with $P_d$ approximated by the tail of simulated doublets. Regime: $P_0(s\ge t)$ negligible above the cut, simulated doublets matched in depth and heterogeneity, and large $n$. Each rule below solves this for $\pi$ or for $t$ under a different assumption. Scrublet [R5] sets $P_0$ to zero:

$$\hat\pi(t)=\frac{\hat P_{\mathrm{obs}}(s\ge t)}{\hat P_{\mathrm{sim}}(s\ge t)},$$

which is unstable when the simulated tail is small. Because simulated doublets are heterotypic, $\hat\pi$ estimates the heterotypic share of called barcodes. The scds balanced rule [R8] instead sets $\hat F_{\mathrm{sim}}(t)=1-\hat F_{\mathrm{obs}}(t)$, using the observed distribution in place of a singlet reference, so its balance point depends on the observed scores and not on a supplied rate.

**Rate from loading.** With Poisson loading at mean $\lambda$ cells per droplet, the fraction of occupied droplets holding two or more cells is

$$\rho(\lambda)=\frac{1-(1+\lambda)e^{-\lambda}}{1-e^{-\lambda}}\approx\frac{\lambda}{2},\qquad \lambda=0.00785\,\frac{N}{500},$$

the table used by Pegasus [R11], which cites the 10x Genomics table [R12]. Computed from this formula, $\rho$ is 0.039 at $N=5{,}000$, 0.076 at $N=10{,}000$ and 0.149 at $N=20{,}000$, which is about 0.8% per thousand cells in the linear regime. Regime: independent cells, small $\lambda$, and no artefacts beyond multiplets. The rate counts all multiplets. Under random pairing of types the detectable part is $\rho_{\mathrm{het}}=\rho\,(1-\sum_c f_c^2)$, because two cells of one type look like a singlet. Coarse annotations overstate $\sum_c f_c^2$ and so under-call heterotypic doublets.

**Count rules.** DoubletFinder takes the top $n_{\exp}$ barcodes by pANN [R6], where its homotypic helper sets $n_{\exp}=\mathrm{round}(n\rho_{\mathrm{het}})$, and Solo's top-$k$ does the same on classifier probabilities [R9]. Regime: the rate is right and the classes overlap. The rank cut then places the threshold by the rate rather than by the data. Ties at the cut make the count depend on ordering. Solo's reference sets $k$ to the number of singlets, $n-n_{\exp}$, and calls scores strictly above the $k$-th smallest, so ties at that value give fewer calls than expected. DoubletFinder chooses its neighbourhood fraction $p_K$ by BCmvn, the mean over $p_N$ of the bimodality coefficient divided by its variance over $p_N$. This is a heuristic, not a likelihood.

**Cost rules.** scDblFinder [R7] minimises

$$L(t)=w\,\mathrm{dev}(t)^2+2(1-s)\,\mathrm{FNR}_{\mathrm{art}}(t)+2s\,\mathrm{FPR}_{\mathrm{real}}(t),$$

where $\mathrm{dev}(t)=0$ if $E_-<x(t)<E_+$, and otherwise $\mathrm{dev}(t)=\min_{E\in\{E_-,E_+\}}|x(t)-E|/E$, with $x(t)=1+\#\{i\ \mathrm{real}: s_i\ge t\}$, $E_\pm=1+(\delta\pm\sigma)\,N_{\mathrm{real}}$, weight $w$, stringency $s$, expected rate $\delta$ and spread $\sigma$. $\mathrm{FNR}_{\mathrm{art}}$ is the share of artificial doublets scored below $t$, less the expected count of homotypic misses, and $\mathrm{FPR}_{\mathrm{real}}$ is the share of real barcodes in the training subset scored at or above $t$. The count term penalises calls outside the expected interval, and the misclassification terms use the simulated doublets and the training barcodes. Regime: $\delta$ known within $\sigma$, applied per library. The estimand is the call count relative to $\delta N_{\mathrm{real}}$, with misclassification as a second term.

**Probability rules.** Solo's probabilities [R9] are shifted in logit space from the training prior $d_s=r/(r+1)$ toward the data, $c^{(k+1)}=\mathrm{logit}(\overline{p'}^{(k)})-\mathrm{logit}(d_s)$ and $p'=\sigma(\mathrm{logit}\,p+c)$, stopping once the mean changes by less than 0.01 after at least five updates. The reference then calls $p>0.5$. Regime: logits approximately calibrated up to a prior shift. DoubletDetection [R10] calls a barcode when at least 0.9 of its iterations give a hypergeometric p-value below $10^{-7}$. It needs per-iteration p-values and is used here as a comparator only.

**Other rules.** Scrublet's standardised score $Z_i=(s_i-t)/\sigma_i$ [R5] defines an ambiguous band. Pegasus [R11] combines a theoretical cutoff from the rate table with a kernel-density curvature cut on simulated scores. Its embedding-based percentile is not documented in the code read (section 10).

**Proposed posterior.** Singlet's own proposal, not in any reference code, models observed scores as a mixture of a flexible singlet density $f_0$ and the simulated-doublet density $f_d$ with a Beta prior on $\pi$. The posterior $p_i=\pi f_d(s_i)/[(1-\pi)f_0(s_i)+\pi f_d(s_i)]$ then gives calls at a target false-discovery rate and an interval for the count. Regime: $f_0$ and $f_d$ differ on the score axis and simulated depth matches. Section 5 gives its falsification test.

**Insight.** Every rule is a rate estimate in disguise. The Scrublet ratio solves the mixture for $\pi$, the balanced cut matches tails, the count rules fix the rate, and the cost trades the rate against misclassification. They differ in which rate they assume and which tail they trust. A model-based rule adds calibration only inside its regime, and the planted benchmark (B1) measures the count error that follows when the regime fails.

**Pitfalls.** Pooled cuts across libraries whose score scales differ can mis-call some libraries. Too many simulated doublets distort the score scale. Scrublet returns no threshold when its histogram has no minimum. Discrete kNN fractions tie, so tie handling changes which barcodes are called.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scdblfinder_auto | model-based | Chooses the cut that minimises a cost combining deviation of the call count from an expected interval with misclassification on simulated doublets and training barcodes. | [R7] |
| scrublet_minimum | hybrid | Cuts at the minimum between the two modes of the simulated-score histogram; the overall rate is the detected over the detectable simulated fraction. | [R5] |
| expected_k | heuristic | Calls the top $n_{\exp}$ scores, with $n_{\exp}$ from an expected rate: DoubletFinder's nExp, and Solo's expected-number option, which cuts above the $(n-n_{\exp})$-th smallest score. | [R6], [R9] |
| scds_balanced | heuristic | Cuts where the simulated-doublet ECDF equals the right tail of the observed scores. | [R8] |
| scds_fraction | heuristic | Cuts so that a fixed fraction of simulated doublets, 0.1 or 0.01, falls below the cut. | [R8] |
| solo_prob | model-based | Calls softmax probabilities above 0.5, after optional logit prior-shift recalibration. | [R9] |
| pegasus_kde | heuristic | Smooths the simulated scores and places a cut from local maxima and curvature, guided by the rate-table threshold. Comparator only. | [R11] |
| doubletdetection_vote | hybrid | Votes over iterations of hypergeometric p-values. Comparator only. | [R10] |

The standard comparators are the rules each tool ships. No published benchmark ranks them on calls (section 10). Only rules whose reference code was read appear in this table and in the enum. The proposed posterior appears in neither.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| scrublet_minimum | cut: `threshold_minimum` of simulated scores; no cut when it fails | minimum of the score histogram | `src/scanpy/preprocessing/_scrublet/core.py:441-449` (scanpy copy) |
| scrublet_minimum | overall rate: detected over detectable simulated fraction | ratio | `core.py:457-461` (scanpy copy) |
| scrublet_minimum | standardised score | $(s-t)/\sigma$ | `core.py:453` (scanpy copy) |
| scrublet | `sim_doublet_ratio`; `expected_doublet_rate`; `stdev_doublet_rate` | 2.0; 0.1; 0.02 | `src/scrublet/scrublet.py:6` @88d6efe; rate enters the score error at `scrublet.py:377-388` |
| expected_k (DoubletFinder) | rank cut: top $n_{\exp}$ by pANN, ties in barcode order | — | `R/doubletFinder.R:198` @1b244d8 |
| expected_k (DoubletFinder) | `pN`; artificial doublets | 0.25; $\mathrm{round}(n/(1-p_N)-n)$ | `R/doubletFinder.R:61`, `:85` @1b244d8 |
| expected_k (DoubletFinder) | neighbourhood size by BCmvn (scoring stage) | mean over variance of $B$ across $p_N$ | `R/find.pK.R:42-44` @1b244d8 |
| expected_k (DoubletFinder) | homotypic adjustment | $n_{\exp}(1-\sum_c f_c^2)$ | `R/modelHomotypic.R` @1b244d8 |
| expected_k (Solo) | strict cut above the $(n-n_{\exp})$-th smallest score | ties reduce the count | `solo/solo.py:383-394` @d94baa3 |
| scdblfinder_auto | `dbr.per1k`; `stringency`; `p`; `dbr.importance`; `perSample` | 0.008; 0.5; 0.1; 1; TRUE | `R/scDblFinder.R:212`; `R/doubletThresholding.R:45-47` @e66180a |
| scdblfinder_auto | `dbr.sd` when NULL, thresholding function | $\max(0.02,\mathrm{mean}(0.4\,\mathrm{dbr}))$ | `R/doubletThresholding.R:51` @e66180a (section 10) |
| scdblfinder_auto | optimiser | minimise $L(t)$ by `optimize` over $(0,1)$; `auto` uses this path when type and score columns are present | `R/doubletThresholding.R:123-156` @e66180a |
| scds_balanced | balance point | ECDF balance by `uniroot` over the observed range | `R/make_calls.R:46-53` @c9054c2 |
| scds_fraction | fixed miss rates | 0.1 (default), 0.01 | `R/make_calls.R:75-79` @c9054c2 |
| solo_prob | training prior $d_s$ | $r/(r+1)$ | `solo/solo.py:363` @d94baa3 |
| solo_prob | recalibration loop | stop when mean change is below 0.01, after at least 5 updates | `solo/solo.py:354-376` @d94baa3 |
| solo_prob | call | $p>0.5$ | `solo/solo.py:396` @d94baa3 |
| pegasus_kde | `method`; `K`; simulated ratio | improved; 100; 2.0 | `pegasus/tools/doublet_detection.py:453-465` @484617d |
| pegasus_kde | Poisson rate | $\lambda_{500}=0.00785$ | `pegasus/tools/doublet_detection.py:20-30` @484617d |
| doubletdetection_vote | `p_thresh`; `voter_thresh` | $10^{-7}$; 0.9 | `doubletdetection/doubletdetection.py:216` @ce70f4d |

## 5. Proposed singlet approach

**Routes.** The route for each rule, and the licence that sets it, is in section 12. Rules implemented from a reference must reproduce that reference's cut to $10^{-6}$ on identical score vectors, including the Scrublet cut, the scds balance point and the Solo recalibrated probabilities. The rule that depends on a per-iteration p-value matrix is not in the enum. Its inputs come from the detector stage.

**Default.** `scdblfinder_auto` applied to `scrublet` scores, per library when `sample_key` is set, with the Poisson table rate and the section 4 defaults. The cost is defined for every library, so the rule always returns a cut. `scrublet_minimum` returns none when the simulated histogram is unimodal. The pairing of this rule with Scrublet scores is untested, and B1 decides it. If B1 shows that the rule's median F1 at the planted rate is below that of `expected_k`, the default changes to `expected_k`.

**Model-based proposal.** The posterior in section 3 adds a fitted singlet density and a Beta prior on the rate, and reports per-barcode posteriors and an interval for the count. It joins the enum only if it exceeds the default's median F1 at the planted rate by 0.02 in the matched setting of B1, and if its mean posterior is within 0.02 of the planted fraction. Both margins are proposed. Otherwise the proposal is rejected.

**Stack and devices.** The call step has no trained network. Cut searches, ECDF and histogram work and stable top-$k$ selection are CPU loops in the core, so no CUDA kernel is planned. PyTorch is reserved for the scoring models. Candidate cuts are evaluated from sorted arrays. The calls stream across libraries, and memory is linear in the barcodes of one library.

**Defaults without asking.** `expected_rate` null; `celltype_key` set whenever annotations exist; `sample_key` set whenever the dataset holds more than one library; `stringency` 0.5; `dbr_importance` 1; `expected_rate_sd` null; `ambiguous_z` 0.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obs/doublet_score_<method> | float32 | Per-barcode score from the scoring step; the cut is applied to this vector. |
| read | uns/doublet_sim_scores_<method> | float array | Simulated-doublet scores; required by every rule except `expected_k`. |
| read | obs/<sample_key> | categorical | Library label; read when `sample_key` is set. |
| read | obs/<celltype_key> | categorical | Cell-type labels for the homotypic proportion; read when `celltype_key` is set. |
| read | obs/n_cells_loaded | integer | Cells loaded per library, a per-barcode copy, for the Poisson rate; the barcode count is used when absent. |
| write | obs/doublet_call_<method> | categorical | `singlet` or `doublet`; `ambiguous` only for `scrublet` with `ambiguous_z` above 0. |
| write | obs/doublet_zscore_scrublet | float32 | Standardised score $(s-t)/\sigma$; written for `scrublet` only. |
| write | uns/doublet_threshold_<method> | dictionary | Rule, cut or $k$, calls per library, implied rate, rate used, and options recorded as ignored. |
| write | uns/doublet_diag_<method> | dictionary | Histogram of simulated scores and the objective or ECDF over candidate cuts. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle (.singlet path or URI, or workspace handle) holding the scored barcodes. |
| `threshold_rule` | string | "scdblfinder_auto" | `scdblfinder_auto`, `scrublet_minimum`, `expected_k`, `scds_balanced`, `scds_fraction`, `solo_prob` | Cut rule. expected_k and scdblfinder_auto need a rate; solo_prob applies to solo scores only. |
| `score_method` | string | "scrublet" | `scrublet`, `doubletfinder`, `scdblfinder`, `solo` | Scoring output to read: obs/doublet_score_<method> and its simulated scores. |
| `sample_key` | string/null | null | — | obs column naming libraries; cuts are applied per library when set. |
| `expected_rate` | number/null | null | > 0; < 1 | Expected multiplet fraction of called barcodes; null uses the Poisson table rate for the library size. |
| `celltype_key` | string/null | null | — | obs column of cell-type labels; when set, rate-based cuts use the heterotypic rate. |
| `device` | string | "auto" | `auto`, `cpu` | Execution device; the call step runs on CPU, so auto and cpu are equivalent. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace calls and diagnostics written by an earlier call with the same method. |
| `scdblfinder` | object | — | — | Options used only by scdblfinder_auto. |
| `scdblfinder.stringency` | number | 0.5 | > 0; < 1 | Weight between false-negative and false-positive terms in the cut cost. |
| `scdblfinder.dbr_importance` | number | 1 | min 0 | Weight of the count-deviation term relative to misclassification. |
| `scdblfinder.expected_rate_sd` | number/null | null | > 0 | Spread of the expected rate; null uses max(0.02, 0.4 times the rate). |
| `scrublet` | object | — | — | Options used only by scrublet_minimum. |
| `scrublet.ambiguous_z` | number | 0 | min 0 | Calls with absolute z below this are labelled ambiguous; 0 disables the class. |
| `scds` | object | — | — | Options used only by scds_fraction. |
| `scds.miss_rate` | number | 0.1 | `0.1`, `0.01` | Fraction of simulated doublets allowed below the cut. |
<!-- PARAMS:AUTO:END -->

Rules that take a rate use `expected_rate`, or the table rate, as the total multiplet fraction. With `celltype_key` set, it is reduced to the heterotypic share before use. Rules without a rate (`scrublet_minimum`, `scds_balanced`, `scds_fraction`) record `expected_rate` as unused. Options for a method other than `threshold_rule` are recorded as ignored. Without `sample_key`, every barcode forms one library and a multi-library dataset is cut once, which the call records as a warning. The call is deterministic, and ties at the cut are ordered by barcode position.

## 7. MCP tool

Tool name `singlet_doublets_doublet_call_thresholding` (definition in `tasks/mcp/singlet_doublets_doublet_call_thresholding.json`).

```json
{"dataset": "data/lib1.singlet", "threshold_rule": "scdblfinder_auto", "score_method": "scrublet",
 "sample_key": "sample_id", "expected_rate": null}
```

```json
{"dataset": "data/lib1.singlet", "status": "completed",
 "wrote": ["obs/doublet_call_scrublet", "obs/doublet_zscore_scrublet",
           "uns/doublet_threshold_scrublet", "uns/doublet_diag_scrublet"],
 "summary": {"rule": "scdblfinder_auto", "libraries": "<libraries>", "n_barcodes": "<n>",
             "n_called": "<n_called>", "implied_rate": "<rate>", "homotypic_adjusted": false},
 "provenance_id": "<provenance id>"}
```

Long-running: no; the call is a sort and a search over sorted arrays and returns inline. Stochastic: no. Dry run: estimated seconds and peak memory from the number of barcodes, with device `cpu`.

## 8. Benchmarks

**Shared protocol.** Every rule receives the same score vector and simulated-score vector from one detector at default settings, with seed 0 wherever a detector is stochastic. Each rule keeps its reference tie convention: Scrublet and Solo call strictly above the cut, scds calls at or above it, and `expected_k` calls exactly $k$ in barcode order. Metrics are computed per library and the table value is the median across libraries. The oracle cut is the maximum F1 over all distinct score values. Paired comparisons use a one-sided Wilcoxon signed-rank test across libraries at $\alpha=0.05$. Comparator versions are the commits in section 12.

### B1. Planted-label call benchmark (proposed)

- **Goal**: Measure each rule's count and label error against planted doublets, at the planted rate and at the Poisson rate.
- **Ground truth**: Planted simulation. Estimand: planted doublet barcodes over all library barcodes, per library; each carries parent types and a homotypic flag. Recipe:
  1. Split the catalogue by study into a singlet pool $S$ and a parent pool $P$ with no study in common; draw parents only from annotated cells in $P$.
  2. Per library, draw $N\in\{5000, 20000\}$ barcodes from $S$ with replacement.
  3. For $f\in\{0.01, 0.04, 0.08\}$, replace $M=\mathrm{round}(fN)$ random barcodes with the sum of two cells drawn with replacement from $P$.
  4. Record flags, parent types and homotypic flags; seeds 0–2.
  5. Stress: binomially thin parent UMIs to 50% before summing.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted libraries, matched and stress | singlet catalogue (internal) | scRNA-seq; species —; 5,000 or 20,000 barcodes; 18 per setting | see section 12 | Poisson rate 0.039 and 0.149 at the two sizes |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Relative count error | $\lvert N_{\mathrm{called}}-M\rvert/M$; $M$ includes homotypic doublets | minimise | primary | — |
| Call F1 | $2\,TP/(2\,TP+FP+FN)$ against planted flags | maximise | primary | — |
| Regret | oracle F1 minus rule F1 | minimise | guardrail | — |
| Homotypic recall | planted homotypic doublets called (detectability ceiling) | maximise | guardrail | — |

- **Comparators**: the six enum rules on each singlet detector's scores, and the oracle cut.
- **Protocol**: Matched and stress settings; rate supplied as the planted fraction and as the Poisson rate.
- **Acceptance criterion** (proposed, not from the literature): median relative count error at most 0.20 at the planted rate in the matched setting, and at most 0.40 at the Poisson rate in the stress setting.
- **Known pitfalls**: Parents must come from a pool disjoint from the singlets. Planted doublets use the summing construction detectors simulate, so matched results favour simulation-based detectors.

### B2. Rate sensitivity (proposed)

- **Goal**: Measure how much each rate-using rule's accuracy changes when the supplied rate is off by a known factor.
- **Ground truth**: Planted simulation with the estimand of B1, using the matched libraries of B1 only.
- **Datasets**: The matched libraries of B1, with the supplied rate set to $m f$ for $m\in\{0.5, 1, 2\}$, where $f$ is the planted fraction. The supplied rate is never taken from a detector's own estimate.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Matched libraries of B1 | as B1 | as B1 | see section 12 | Rate multipliers 0.5, 1 and 2 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Rate sensitivity | $F1(1)-\min\{F1(0.5),F1(2)\}$, median across libraries | minimise | primary | — |
| Relative count error at $m=2$ | as B1, with the supplied rate doubled | minimise | guardrail | — |

- **Comparators**: `scdblfinder_auto` and `expected_k`. Rules without a rate (`scrublet_minimum`, `scds_balanced`, `scds_fraction`) are constant by construction and are reported once.
- **Protocol**: As B1, matched setting only.
- **Acceptance criterion** (proposed): median rate sensitivity at most 0.05.
- **Known pitfalls**: This tests a multiplicative error in the planted rate. The misspecification from the Poisson table is a different error and is covered by B1.

### P1. Performance and scaling

Call-step wall time and peak resident memory for score vectors of $10^4$, $10^5$ and $10^6$ barcodes, with a simulated vector of twice that length, resampled from B1 outputs. Measured on one CPU thread, median of five repeats, for the six enum rules and the two callouts. Detector time and the DoubletFinder pN–pK sweep are excluded. Held fixed: thread count, hardware and data. Each candidate cut is evaluated from sorted arrays in $O(\log n)$, so the search costs $O(n\log n)$ overall. Acceptance (proposed): the default rule takes at most one second at $10^6$ barcodes.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `doublets.expression_doublet_scoring`: Expression-based per-cell doublet scoring
  - `doublets.expected_rate_estimation`: Expected doublet rate estimation
- **Feeds**:
  - `doublets.ensemble_doublet_calling`: Ensemble and consensus doublet calling
  - `doublets.artifact_cluster_detection`: Doublet-driven artifact clusters and doublet-versus-transitional-state discrimination
- **Reads**: `obs/doublet_score_<method>`, `uns/doublet_sim_scores_<method>`, `obs/<sample_key>`, `obs/<celltype_key>`, `obs/n_cells_loaded`
- **Writes**: `obs/doublet_call_<method>`, `obs/doublet_zscore_scrublet`, `uns/doublet_threshold_<method>`, `uns/doublet_diag_<method>`
<!-- CHAINING:AUTO:END -->

The call step follows scoring and precedes ensembling and cluster checks in the per-library doublet workflow.

## 10. Risks, pitfalls and open questions

- **Evidence not fully checked.** [R1] and [R2] are cited from abstracts and from a repository quotation of the addendum, not full texts. [R3] is cited from its abstract only, and its author list is not established. [R4] is cited from its abstract only, and its detection-accuracy formula was not read.
- **Unresolved defaults.** scDblFinder's `dbr.sd` default is $\max(0.02,\mathrm{mean}(0.4\,\mathrm{dbr}))$ in the thresholding function (`R/doubletThresholding.R:51`), but the internal training step sets $0.5\,\mathrm{gdbr}+0.025$ (`R/scDblFinder.R:631`) and uses stringency 0.7 (`R/scDblFinder.R:686`). The code read does not establish which applies to the public call. The embedding percentile of Pegasus is undocumented in the code read, so `pegasus_kde` stays a comparator.
- **No call-level benchmark exists.** Two candidates await fixed data: the identification-rate protocol of [R2] needs dataset names and per-barcode labels, and a hashing-anchored benchmark on the datasets of [R3] needs accessions and multiplet calls. For the latter, the estimand is the called barcodes carrying hashes from two samples divided by called barcodes, a lower bound because same-sample and homotypic multiplets are unlabelled. Its data licence terms are not fixed.
- **Literature unsettled.** Heuristic rates may fall below hashing observations [R3]. BCmvn can have several maxima, which are resolved by inspection rather than by a rule. The downstream handling of ambiguous barcodes is undefined, because each tool signals ambiguity differently.
- **Technical risks.** The scDblFinder objective in section 3 was written from the reference code, so a clean reimplementation needs independent review before use. Solo's recalibration fixed point has not been checked against the mean-probability target on the benchmark data.
- **First experiment.** On the matched setting at 5,000 barcodes and planted fraction 0.04, with three seeds, apply the six enum rules to `scrublet` and `scdblfinder` scores, check each implementation against its reference cut to $10^{-6}$ on identical vectors, and fix the default before B2 is applied.

## 11. References

R1. Xi NM, Li JJ. Benchmarking computational doublet-detection methods for single-cell RNA sequencing data. *Cell Systems* 2021;12(2). doi:10.1016/j.cels.2020.11.008 — verified (corpus)
R2. Xi NM, Li JJ. Protocol for executing and benchmarking eight computational doublet-detection methods in single-cell RNA sequencing data analysis. *STAR Protocols* 2021. doi:10.1016/j.xpro.2021.100699 — verified (corpus)
R3. — . Multiplets in scRNA-seq data: extent of the problem and efficacy of methods for removal. *PLoS One* 2025. doi:10.1371/journal.pone.0333687 — partial (search)
R4. Xi NM, Vasilopoulos A. Tuning hyperparameters of doublet-detection methods for single-cell RNA sequencing data. *Quantitative Biology* 2023;11(3):297–305. — partial (search)
R5. Wolock SL, Lopez R, Klein AM. Scrublet: computational identification of cell doublets in single-cell transcriptomic data. *Cell Systems* 2019;8(4):281–291. doi:10.1016/j.cels.2018.11.005 — verified (corpus)
R6. McGinnis CS, Murrow LM, Gartner ZJ. DoubletFinder: doublet detection in single-cell RNA sequencing data using artificial nearest neighbors. *Cell Systems* 2019. doi:10.1016/j.cels.2019.03.003 — verified (corpus)
R7. Germain PL, Lun A, Garcia Meixide C, Macnair W, Robinson MD. Doublet identification in single-cell sequencing data using scDblFinder. *F1000Research* 2021;10:979. doi:10.12688/f1000research.73600.1 — partial (corpus)
R8. Bais AS, Kostka D. scds: computational annotation of doublets in single-cell RNA sequencing data. *Bioinformatics* 2019. doi:10.1093/bioinformatics/btz698 — verified (corpus)
R9. Bernstein NJ, Fong NL, Lam I, Roy MA, Hendrickson DG, Kelley DR. Solo: doublet identification in single-cell RNA-seq via semi-supervised deep learning. *Cell Systems* 2020. doi:10.1016/j.cels.2020.05.010 — verified (corpus)
R10. Gayoso A, Shor J, Carr A. DoubletDetection (software). https://github.com/JonathanShor/DoubletDetection — verified (repo)
R11. Yang Y, Gould J, Li B. Pegasus (software), doublet_detection module. https://github.com/lilab-bcb/pegasus — verified (repo)
R12. 10x Genomics. What is the maximum number of cells that can be profiled? Knowledge base article. https://kb.10xgenomics.com/hc/en-us/articles/360001378811-What-is-the-maximum-number-of-cells-that-can-be-profiled- — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/AllonKleinLab/scrublet (@88d6efe; scanpy copy from the scverse/scanpy repository, local copy) | Samuel Wolock (LICENSE copyright holder) | MIT (LICENSE, copyright 2018 Samuel Wolock) | scrublet_minimum cut, rate ratio and defaults | port |
| https://github.com/kostkalab/scds (@c9054c2) | Dennis Kostka; Abha Bais | MIT with file LICENSE (copyright 2019 Dennis Kostka) | scds_balanced and scds_fraction | port |
| https://github.com/plger/scDblFinder (@e66180a) | Pierre-Luc Germain (cre, aut); Aaron Lun (ctb) | GPL-3 (LICENSE is the GPL-3 text) | scdblfinder_auto cost; package vignette and README cited for documentation | reimplement |
| https://github.com/chris-mcginnis-ucsf/DoubletFinder (@1b244d8) | Chris McGinnis (aut, cre); Haibo Liu (cre) | CC0 per DESCRIPTION; no LICENSE file at repository root | expected_k rank cut and BCmvn sweep (scoring stage) | reimplement |
| https://github.com/calico/Solo (@d94baa3) | David Kelley; Nick Bernstein | MIT (LICENSE); setup.py states Apache | solo_prob recalibration and call | port |
| https://github.com/JonathanShor/DoubletDetection (@ce70f4d) | Adam Gayoso; Jonathan Shor; Ambrose Carr | MIT (LICENSE.txt) | doubletdetection_vote, comparator | callout |
| https://github.com/lilab-bcb/pegasus (@484617d) | Yiming Yang; Joshua Gould; Bo Li | BSD-3-Clause (LICENSE) | pegasus_kde, comparator; Poisson rate formula | callout |
