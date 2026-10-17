---
id: grn.tf_target_edge_inference
title: Directed TF-to-target edge inference from scRNA-seq
area: grn
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [normalization.size_factor_estimation, qc.low_quality_cell_detection]
feeds: [grn.consensus_edge_aggregation, grn.regulon_motif_pruning, grn.differential_grn_rewiring, grn.in_silico_tf_perturbation]
reads: [layers/<layer>, var/is_tf]
writes: [uns/grn/<method>/edges, uns/grn/<method>/params]
devices: [cpu, cuda]
mcp_tool: singlet_grn_tf_target_edge_inference
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Directed TF-to-target edge inference from scRNA-seq

> Score every candidate TF-to-target pair from an unperturbed expression matrix with a stated dependence statistic, return a ranked directed edge list without a threshold, and evaluate it against a reference network with ranking metrics.

## 1. Question

For one cell population with a log-normalised matrix $X$ over $n$ cells and a candidate regulator set $\mathcal R$ of annotated TFs, which ordered pairs (TF $i$, target $j$) receive the highest scores, and do those scores rank reference-network edges above non-edges? The output is a weighted directed edge list over all candidate pairs, with no threshold. A correct answer ranks reference edges highly, is reproducible across seeds, and is read as a conditional association, not an intervention.

## 2. Why this task matters and where the field stands

Transcription factors set the expression programme of a cell state. An inferred TF-to-target network links a population to its regulators and to the regulons used for TF activity estimation [R4]. Most atlases carry no perturbation data, so inference from unperturbed profiles is the route available. Status: **contested**. Chen and Mar [R2] reported that most general and single-cell methods they evaluated scored poorly on experimental and simulated data against literature-derived references, and that their networks disagreed considerably, which they attributed to different mathematical assumptions. BEELINE [R1] is the standard framework, scoring ranked edge lists on synthetic Boolean-model networks and curated experimental groups. The field overview is [R3].

Open problems:

- **Association, not regulation.** A high score is a dependence within the candidate set; direction comes from restricting sources to TFs, not from the data [R1].
- **Reference coverage.** Reference networks are incomplete and biased toward well-studied TFs, and regulon coverage is still being extended [R4].
- **Zero inflation.** Dropout distorts dependence on log-normalised counts, and zero-inflated graphical models treat it explicitly [R6].
- **Learned alternatives.** Pretrained models with a gene-network readout are reported [R7]; they are outside this task's evidence.
- **Stability.** BEELINE's median Spearman compares ranked edge weights across the run ids of one dataset group (`BLEval/Spearman.py`); it does not resample cells [R1].

## 3. Theory and insight

Let $X\in\mathbb{R}^{n\times K}$ hold the centred log-normalised expression of the $K$ candidate TFs, $x_j\in\mathbb{R}^n$ a target gene, and $\mathcal R_j=\mathcal R\setminus\{j\}$ the candidate set with the target removed. Every method scores how strongly $x_j$ depends on $X_{\mathcal R_j}$.

**Estimands.** Each output and ground-truth quantity is defined once:

- *GENIE3 weight* $w_{ij}$ is the forest-averaged share of impurity reduction that TF $i$ receives when $x_j$ is regressed on $X_{\mathcal R_j}$ [R8]; it is nonnegative and sums to one over TFs for each target.
- *GRNBoost2 weight* $w_{ij}$ is the same kind of share from gradient-boosted trees [R9], multiplied by the fitted stage count $m_j$; its total per target is $m_j$, so its scale depends on early stopping.
- *PPCOR score* is the partial correlation of $x_i$ and $x_j$ given all other genes [R10], computed on Spearman correlation in BEELINE's runner; *Pearson score* is the marginal correlation. Both lie in $[-1,1]$ and are symmetric in $(i,j)$.
- *Conditioned partial correlation* $r_{ij}$ is the correlation of $x_i$ and $x_j$ given the other candidate TFs, the variant proposed in section 5.
- *Edge label* $g_{ij}=1$ if the ordered pair is in the reference network and $0$ otherwise; absent pairs are negatives by assumption.
- *Universe* $\mathcal U$ is the set of ordered non-self pairs among reference genes, or reference TF sources times genes; $\lvert E\rvert/\lvert\mathcal U\rvert$ is the random precision.
- *AUPRC ratio* is the area under the precision-recall curve over $\mathcal U$, scored by $\lvert w_{ij}\rvert$ with absent pairs at zero, divided by $\lvert E\rvert/\lvert\mathcal U\rvert$, the expected AUPRC of a random ranking (`BLPlot/plotter.py:169-183`).
- *Early precision ratio (EPR)* is the precision among the tie-expanded top $\lvert E\rvert$ predictions divided by $\lvert E\rvert/\lvert\mathcal U\rvert$.

**Relations used.** For the precision matrix $Q$ of $(x_j,X_{\mathcal R_j})$, the population regression coefficients of $x_j$ on $X_{\mathcal R_j}$ are $-Q_{j\mathcal R_j}/Q_{jj}$. The partial correlation of two variables given the rest is $-Q_{ij}/\sqrt{Q_{ii}Q_{jj}}$, with $Q$ the precision of the sub-vector being conditioned. For ordinary least squares with $\nu_j=n-\lvert\mathcal R_j\rvert-1$ residual degrees of freedom, the t-statistic $t_{ij}$ of TF $i$ and its conditioned partial correlation $r_{ij}$ satisfy

$$t_{ij}=\frac{r_{ij}\sqrt{\nu_j}}{\sqrt{1-r_{ij}^2}}.$$

Under the null of no partial association and Gaussian residuals, $t_{ij}$ is exactly Student-$t$ with $\nu_j$ degrees of freedom for any fixed design. Within each target, ranking by $\lvert t_{ij}\rvert$ and by $\lvert r_{ij}\rvert$ is identical. Regime: $n>\lvert\mathcal R_j\rvert+1$ with full column rank.

**Failure modes.**

- *Marginal and shared-regulator dependence* (Pearson; GENIE3 and GRNBoost2 when candidate TFs are correlated). Co-regulation, cell-state structure and pooled populations give high scores without a TF edge [R2]. Conditioning on candidate TFs removes a shared regulator only when that regulator is a candidate; a hidden regulator leaves the artefact (B3).
- *Dropout.* Zeros attenuate correlations and inflate dependence for some pairs, so the t-distribution is approximate on log-normalised counts.
- *Dimension.* Partial correlation needs $n>\lvert\mathcal R_j\rvert+1$ (conditioned) or $n>p$ (all genes). Below these bounds a ridge-regularised precision gives scores whose null is not the t-distribution.
- *Direction.* Symmetric statistics cannot express direction; every method here gets direction only from the TF restriction.
- *Scale across targets.* GRNBoost2 totals equal stage counts, so a global ranking favours targets with longer boosting; GENIE3 totals are fixed at one. A ranking must state its scale.

**Why a model adds value.** A statistic with a known null supplies calibrated per-edge p-values, which correlations and importances lack, and one Gram matrix can serve every target. The cost is distributional assumptions that count data violate, so calibration must be checked (section 5). Heuristic scores need no such assumption and remain the comparators.

**Insight.** On unperturbed data every score here estimates a conditional association inside the candidate set. A high score is a claim about that association, not about regulation, and ranking metrics are the appropriate reading [R1].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| GRNBoost2 (arboreto) | model-based | per-target gradient-boosted regression on candidate TFs; importances scaled by stage count | [R9][R1] |
| GENIE3 (arboreto random forest) | model-based | per-target random forest on candidate TFs; normalised impurity reduction | [R8][R1] |
| PPCOR | model-based | partial correlation of each pair given all other genes (`ppcor::pcor`); BEELINE's runner passes Spearman correlation | [R10][R1] |
| Pearson correlation | heuristic | marginal correlation of per-gene maximum-scaled expression | [R1] |

The comparator standard is BEELINE's runners for these four methods [R1]. No comparator's per-edge score has been validated as calibrated on these data, and no default below was chosen by benchmark. Excluded: SINCERITIES and SCODE are time-aware and belong to grn.dynamic_grn_inference [R12][R13]; PIDC (DOI 10.1016/j.cels.2017.08.014) and the prior-constrained regression of Inferelator 3.0 [R11] are outside the method set; SCENIC's motif pruning [R5] is grn.regulon_motif_pruning.

Commits: arboreto 2f475dc (version 0.1.6), BEELINE 3746408, scikit-learn main 85593ca.

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| GRNBoost2 | regressor and settings | GradientBoostingRegressor with SGBM_KWARGS | arboreto algo.py:39 |
| GRNBoost2 | learning rate, stage cap, max features, subsample | 0.01, 5000, 0.1, 0.9 | arboreto core.py:49-54 |
| GRNBoost2 | early-stop window | 25 | arboreto core.py:19; algo.py:14 |
| GRNBoost2 | importance scaling | importances times fitted stage count; only when GBM and subsample is below 1 | arboreto core.py:73-83, :165-168 |
| GRNBoost2 | GBM_KWARGS | not used by grnboost2 or genie3 (tests only); no subsample, so no early stop and no scaling | arboreto core.py:42-46; tests/test_core.py:98-99 |
| GRNBoost2 | per-target total before scaling | 1; zeros when no tree has more than one node | scikit-learn ensemble/_gb.py:1027-1038 |
| GENIE3 | regressor and settings | RandomForestRegressor; importances unscaled | arboreto algo.py:71; core.py:22, :165 |
| GENIE3 | n_estimators, max_features, n_jobs | 1000, sqrt, 1 | arboreto core.py:28-32 |
| GENIE3 | per-target total | 1 (mean of per-tree normalised importances) | scikit-learn ensemble/_forest.py:748 |
| Tree methods | seed in wrappers | None (random) | arboreto algo.py:16, :49 |
| Tree methods | seed in diy | signature default None; docstring says 666 | arboreto algo.py:84, :102 |
| Tree methods | seed in fit_model | 666, used only when no seed is passed | arboreto core.py:17, :111 |
| Tree methods | target whose only candidate is itself | cleaned matrix empty; error raised | arboreto core.py:221-246, :316-317 |
| Tree methods | failure handling | max_retries 10, then an empty per-target result, logged as a warning | arboreto core.py:249, :335-339 |
| Pearson (BEELINE) | normalisation | per-gene maximum over cells; zero maximum replaced by 1 | BEELINE pearsonRunner.py:45 |
| Pearson (BEELINE) | correlation and ranking | Pearson over genes; both directions kept; ranked by absolute r | pearsonRunner.py:49, :81 |
| PPCOR (BEELINE) | edge weight | signed correlation when pValue is at most pVal, else 0; pVal from configuration | ppcorRunner.py:59-66 |
| GENIE3, GRNBoost2 (BEELINE) | input and call | matrix transposed to cells by genes; runArboreto called without a seed | genie3Runner.py:25, :38; grnboost2Runner.py:24, :37; ARBORETO/runArboreto.py (both calls omit seed) |
| AUPRC (BEELINE) | universe; out-of-universe predictions | ordered non-self pairs among ground-truth genes; other predictions ignored | AUPRC.py:46-48, :62 |
| EPR (BEELINE) | TF restriction | applied only when tf_edges is set | EarlyPrecision.py:48-54, :129-132 |
| EPR (BEELINE) | tie rule and denominator | cutoff is the larger of the smallest non-zero weight and the weight at rank k; denominator is the selected count | EarlyPrecision.py:138-156 |
| Stability (BEELINE) | missing pairs; constant runs | missing pairs 0; constant runs skipped | Spearman.py:95-96 |
| Signed EPR (BEELINE) | sign source | Type column with + or -; other rows dropped | SignedEarlyPrecision.py:16-24 |

## 5. Proposed singlet approach

**Routes.** `grnboost2` and `genie3` port arboreto's orchestration, default dictionaries and importance rules; the tree learner is scikit-learn through its API, and no tree code is written here. `ppcor` and `pearson` are reimplemented from their statistics; no source is copied from the repositories that section 12 routes to reimplementation. BEELINE runs only as a comparator harness.

**Model-based track.** The proposed statistic is `ppcor` with `conditioning: tfs`, the partial correlation of each candidate TF with the target given the other candidate TFs, tested with the Student-$t$ law of section 3. All targets share one design: a centred Gram matrix $G=X^\top X$, one Cholesky factorisation, and one product $X^\top Y$ for every target, with residual sums from the same products. A target that is itself a candidate TF uses a rank-one (Sherman–Morrison) downdate of $G^{-1}$. The route refuses when $n\le\max_j\lvert\mathcal R_j\rvert+1$.

**Falsification.** The track is rejected if (i) under a within-gene permutation, which destroys all dependence, the p-values are not uniform within sampling error (this tests calibration, not confounding), or (ii) the default-change criterion of B1 fails. Confounding is tested by B3.

**Defaults.** `grnboost2` with the settings of section 4, layer `log1p_norm`, candidates from `var/is_tf`, seed 666, device `auto` (trees on CPU). It stays the default until criterion (ii) holds, and a change is recorded as a revision of this document.

**Kernels and stack.** Gram, product and Cholesky solve are hard-coded CUDA kernels on cuBLAS for the dense log-normalised block, a small hot model for which PyTorch is not needed. Trees run on CPU through scikit-learn. The Gram route holds $X$ in memory and streams target blocks, so out-of-core operation is not claimed.

**Reporting.** Each run counts failed targets and fails above 1 percent; there are no silent retries, because a deterministic failure repeats under a fixed seed. Edges carry the raw score and the per-target share, so cross-target rankings state their scale. No threshold is applied; false-discovery control is `statistics.multiple_testing_control`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/`layer` | float, cells by genes | log-normalised expression; default `log1p_norm` |
| read | var/is_tf | boolean, genes | candidate TF mask, used when `tf_list` is absent |
| write | uns/grn/`method`/edges | table | TF, target, raw score, per-target share, sign (pearson, ppcor), p_value (ppcor) |
| write | uns/grn/`method`/params | record | method, all parameter values, seed, universe size, failed targets, library versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "grnboost2" | `grnboost2`, `genie3`, `ppcor`, `pearson` | Edge scoring method. grnboost2 is the default; ppcor with conditioning tfs gives per-edge Student-t statistics whose calibration is unvalidated (section 10 of the task document). |
| `layer` | string | "log1p_norm" | — | Log-normalised expression layer used for inference. |
| `tf_list` | array | — | — | Candidate regulators. Defaults to genes flagged in var/is_tf; restricts edge direction by construction. |
| `grnboost2` | object | — | — | Options for method grnboost2; defaults are the arboreto stochastic gradient boosting settings. |
| `grnboost2.learning_rate` | number | 0.01 | > 0 | Boosting shrinkage per stage. |
| `grnboost2.max_estimators` | integer | 5000 | min 1 | Cap on boosting stages; early stopping usually ends earlier. |
| `grnboost2.max_features` | number | 0.1 | max 1; > 0 | Fraction of candidate TFs considered at each split. |
| `grnboost2.subsample` | number | 0.9 | > 0; < 1 | Row subsampling per stage; must be below 1 for early stopping and scaling. |
| `grnboost2.early_stop_window` | integer | 25 | min 2 | Early-stopping window length in stages. |
| `genie3` | object | — | — | Options for method genie3, a random forest per target. |
| `genie3.n_estimators` | integer | 1000 | min 1 | Number of random-forest trees per target. |
| `genie3.max_features` | string/number | "sqrt" | — | Candidate TFs per split: sqrt or a fraction. |
| `genie3.n_jobs` | integer | 1 | min 1 | Parallel workers per forest (arboreto default 1). |
| `ppcor` | object | — | — | Options for method ppcor, a Gaussian partial correlation per pair. |
| `ppcor.conditioning` | string | "all_genes" | `all_genes`, `tfs` | all_genes conditions on every other gene; tfs conditions only on other candidate TFs (proposed). |
| `ppcor.p_value_cutoff` | number/null | null | min 0; max 1 | If set, pairs above this p-value get weight 0 (BEELINE-compatible output). |
| `pearson` | object | — | — | Options for method pearson, a marginal correlation per pair. |
| `pearson.normalise_per_gene_max` | boolean | true | — | Divide each gene by its maximum first (BEELINE behaviour; leaves r unchanged). |
| `seed` | integer | 666 | min 0 | Random seed for tree methods; pass explicitly for reproducibility. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | auto uses CUDA for pearson and ppcor when memory suffices; tree methods run on CPU. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Exactly one method block is read; the others are ignored and recorded in `params`. `grnboost2.subsample` must stay below 1, because at 1 arboreto skips both early stopping and importance scaling (section 4). Self-pairs are removed, so no TF is scored against itself; a target whose only candidate is itself is skipped and counted. `seed` affects the tree methods only, and `ppcor` and `pearson` are deterministic. `ppcor.p_value_cutoff` zeroes non-significant weights for BEELINE-compatible output; the null default keeps signed scores for every pair.

## 7. MCP tool

Tool name `singlet_grn_tf_target_edge_inference` (definition in `tasks/mcp/singlet_grn_tf_target_edge_inference.json`). One example call and one example result:

```json
{"dataset": "atlas_subset.singlet", "method": "ppcor", "layer": "log1p_norm",
 "ppcor": {"conditioning": "tfs"}, "seed": 666}
```

```json
{"dataset": "atlas_subset.singlet", "status": "completed",
 "wrote": ["uns/grn/ppcor/edges", "uns/grn/ppcor/params"],
 "summary": {"method": "ppcor", "conditioning": "tfs", "n_targets": "<int>", "n_tfs": "<int>",
  "n_edges": "<int>", "failed_targets": 0, "device": "cuda", "seconds": "<float>"},
 "provenance_id": "<id>", "job_id": null}
```

- **Long-running**: yes for the tree methods, which fit one model per target and may return `queued`; the Gram route completes inline when $X$ fits in memory.
- **Stochastic**: tree methods only; `seed` fixes the forest and boosting draws, reproducible on the same library versions, hardware and thread count.
- **Dry run**: returns `seconds`, `peak_memory_gb`, `device`, `planned_targets` and, for `ppcor`, the Gram size.

## 8. Benchmarks

Shared protocol. Inputs are the BEELINE expression tables, TF lists and gene subsets of each group (500 non-TF genes plus TFs by default). Tree methods take an explicit seed per run; ppcor and pearson are deterministic. One thread setting is used throughout. Evaluation uses singlet's implementation of the metric definitions in each table, and each metric is reported as the median over runs with the number of groups. Comparators are GENIE3 and GRNBoost2 through arboreto, PPCOR with `all_genes`, Pearson, and the proposed `ppcor` with `tfs`. Bulk gold standards (DREAM, [R14]) are not used because they measure bulk data, so transfer to single cells is indirect.

### B1. BEELINE synthetic BoolODE networks

- **Goal**: rank directed edges of simulated networks from simulated expression.
- **Ground truth**: planted simulation; each ordered pair in the group's ground-truth file is a positive.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| BEELINE synthetic groups, simulated with BoolODE | Zenodo doi:10.5281/zenodo.3378975; generator in section 12 | synthetic single-cell counts; species —; size — | — | all groups and runs |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC | trapezoidal area under the precision-recall curve over $\mathcal U$; scores are $\lvert w_{ij}\rvert$, duplicate pairs keep the largest; undefined without positives | maximise | primary | [R1] |
| AUPRC ratio | AUPRC divided by $\lvert E\rvert/\lvert\mathcal U\rvert$; BEELINE reports the median over runs (`BLPlot/PlotSummaryHeatmap.py:60-68`) | maximise | primary | BEELINE plotter code |
| EPR | $S$ is the tie-expanded top $\lvert E\rvert$; $\mathrm{EPR}=\frac{\lvert S\cap E\rvert/\lvert S\rvert}{\lvert E\rvert/\lvert\mathcal U\rvert}$; predictions outside $\mathcal U$ removed | maximise | guardrail | [R1] |
| Signed EPR | EPR for `+` and `-` ground-truth edges separately; opposite-sign edges removed from candidates; requires a Type column | maximise | guardrail where signs exist | [R1] |
| Median Spearman | median pairwise Spearman of weights across BEELINE run ids over $\mathcal U$, missing pairs at 0, constant runs skipped | maximise | guardrail | [R1] |

- **Comparators**: as in the shared protocol.
- **Protocol**: every group and run id.
- **Acceptance criterion**: PROPOSED. (i) Parity: singlet's arboreto path reproduces arboreto's weights to a relative $10^{-6}$ on the same matrix and seed when both use the same scikit-learn version; otherwise median AUPRC within 0.02 and Spearman at least 0.9 on shared pairs. (ii) Default change: a non-default method replaces `grnboost2` only if its median AUPRC ratio exceeds GRNBoost2's in most groups without lowering median Spearman.
- **Known pitfalls**:
  1. Out-of-universe handling differs between metrics: BEELINE's AUPRC ignores predictions outside $\mathcal U$, while its all-pairs EPR keeps them. Singlet removes them in both.
  2. Symmetric scores (Pearson, PPCOR) give both directions one weight, which creates tie blocks.

### B2. BEELINE experimental groups with reference networks

- **Goal**: rank TF-to-target edges from experimental scRNA-seq against reference networks.
- **Ground truth**: orthogonal measurement. Label 1 for TF-to-target pairs in the group's reference network, and 0 for absent pairs by assumption. AUPRC uses the all-pairs universe; EPR uses the TF-restricted universe, whose sources are the reference TFs.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| BEELINE experimental groups: VSC (named in the BEELINE README) and mHSC (example in its configuration) | BEELINE inputs, Zenodo doi:10.5281/zenodo.3378975 | scRNA-seq; species —; size — | — | 500 non-TF genes plus TFs by default |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC | as in B1 | maximise | primary | [R1] |
| AUPRC ratio | as in B1 | maximise | primary | BEELINE plotter code |
| TF-restricted EPR | EPR as in B1 with $\mathcal U$ equal to reference TF sources times genes; predictions restricted to $\mathcal U$ | maximise | primary | [R1] |

- **Comparators**: as in B1.
- **Protocol**: as in B1; candidate TFs are the BEELINE TF list of each group.
- **Acceptance criterion**: PROPOSED. Median Spearman across run ids at least 0.7 for GENIE3 and GRNBoost2; singlet's GRNBoost2 AUPRC ratio within 0.05 of the arboreto run on the same input.
- **Known pitfalls**:
  1. Reference networks are incomplete, so an absent edge is not a negative and recall is capped by coverage. If the prior network that selects genes is also the reference, the benchmark is circular.
  2. Random precision differs between the two universes, so TF-restricted and all-pairs EPR values must not be compared.

### B3. Shared-regulator confounding with planted decoys (proposed)

- **Goal**: test whether conditioning on candidate TFs removes shared-regulator artefacts, with the regulator visible (arm A) or hidden (arm B).
- **Ground truth**: planted simulation. Positives are simulated TF-to-target edges with a candidate source. Decoys are pairs (T, D) that share a driver U and have no edge between them.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated decoy networks | generator recipe below | synthetic; species —; $n\in\{10^3,10^4\}$ cells | — | three seeds per cell count |

- **Generator recipe** (proposed; numbers are this recipe's settings):
  1. Draw 100 TFs and 1,000 non-TF genes. Each target has 1 to 3 TF parents with signed weights drawn from $\pm U(0.5,1.5)$.
  2. Pick 20 parent-free drivers $U$. For each, pick one TF $T$ and one non-TF gene $D$, make $U$ a parent of both, and make $T$ not a parent of $D$.
  3. Arm A keeps all TFs as candidates. Arm B removes the 20 drivers from the candidates and drops their edges from the truth.
  4. Gaussian arm: linear predictors plus $N(0,1)$ noise, log-normalised. Count arm: negative binomial with dispersion 0.5 and dropout probability $e^{-0.1\mu}$.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Decoy rate | fraction of the top $\lvert E\rvert$ TF-restricted predictions by $\lvert w_{ij}\rvert$ that are decoy pairs | minimise | primary | proposed |
| TF-restricted EPR | as in B2 | maximise | guardrail | [R1] |

- **Comparators**: GENIE3, GRNBoost2, PPCOR with `all_genes`, Pearson, and `ppcor` with `tfs`.
- **Protocol**: the recipe on both arms and both cell counts, three seeds.
- **Acceptance criterion**: PROPOSED. In arm A at $n=10^4$, the decoy rate of `ppcor` with `tfs` is at most half that of GRNBoost2. In arm B no decoy rate may fall below its arm-A value; a fall indicates a generator leak.
- **Known pitfalls**: exact ties are rare in the Gaussian arm and common in the count arm, where the B1 tie rule must be applied.

### P1. Performance and scaling

Wall time, peak resident memory and edges per second at $10^3$, $10^4$ and $10^5$ cells (and $10^6$ for the Gram route only), with 500 and 5,000 genes, on CPU for trees and CUDA for Gram routes, against arboreto on CPU and the BEELINE Pearson runner. Hold fixed: candidate TF list, seed 666, arboreto settings for trees (section 4), thread and BLAS counts, and hardware. Exclude data loading and repeat three times. PROPOSED acceptance: the singlet GRNBoost2 path has a log-log slope of time against cells of at most 1.2 over $10^3$ to $10^5$ cells, and peak memory no more than 1.5 times arboreto's at each scale.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
- **Feeds**:
  - `grn.consensus_edge_aggregation`: Consensus and stability-based aggregation of GRN edge predictions
  - `grn.regulon_motif_pruning`: Motif-supported regulon pruning of co-expression modules
  - `grn.differential_grn_rewiring`: Differential GRN, regulon and co-expression rewiring between conditions or cell types
  - `grn.in_silico_tf_perturbation`: In silico TF knockout or overexpression effect prediction from a GRN
- **Reads**: `layers/<layer>`, `var/is_tf`
- **Writes**: `uns/grn/<method>/edges`, `uns/grn/<method>/params`
<!-- CHAINING:AUTO:END -->

Sits in the regulatory-network chain after normalisation and quality control. Its ranked edges feed consensus aggregation, motif pruning, differential rewiring and in silico perturbation. Prior-based TF activity is the sibling branch, grn.tf_activity_scoring.

## 10. Risks, pitfalls and open questions

- **Unverified evidence.** The BEELINE result tables are unverified, so this document asserts no ranking of methods. The Chen and Mar datasets and metrics are unverified and no benchmark uses them. BEELINE's AUROC and motif metrics are unverified and unused. The AUPRC ratio is computed in BEELINE's plotter (`BLPlot/PlotSummaryHeatmap.py:60-68`) from the random baseline in `BLPlot/plotter.py:169-183`; that code was read, not run. BEELINE's gene-subsetting step and input-generation script are unverified at code level.
- **Seeds in BEELINE.** `Algorithms/ARBORETO/runArboreto.py` calls `grnboost2` and `genie3` without a seed, so BEELINE outputs cannot be reproduced by fixing a seed. Parity tests use arboreto runs made here with seed 666.
- **Literature.** Chen and Mar [R2] and BEELINE [R1] do not settle which family wins on real data, and this document makes no such claim. No benchmark cited here establishes a threshold that yields calibrated edges, and the calibrated track of section 5 is unvalidated.
- **Outside the method set.** PIDC's paper is in the scRNA-tools index (DOI 10.1016/j.cels.2017.08.014), and its code was not checked; it stays out until the code is checked. SINCERITIES and SCODE belong to the dynamic task. Bulk gold standards are excluded as described in section 8.
- **Data licences.** Dataset terms for the Zenodo BEELINE inputs are unverified, so B1 and B2 data cannot be redistributed until checked.
- **First experiment.** On one BEELINE synthetic group with three seeds, run arboreto GRNBoost2 and GENIE3 and the `ppcor` with `tfs` route. Check the within-gene permutation null of the `tfs` statistic against Uniform(0,1) on at least $10^4$ pairs, and report GRNBoost2 rankings under both raw and per-target-share scales before any benchmark run.

## 11. References

R1. Pratapa A, Jalihal AP, Law JN, Bharadwaj A, Murali TM. Benchmarking algorithms for gene regulatory network inference from single-cell transcriptomic data. *Nature Methods* 2020. doi:10.1038/s41592-019-0690-6 — verified (corpus)

R2. Chen S, Mar JC. Evaluating methods of inferring gene regulatory networks highlights their lack of performance for single cell gene expression data. *BMC Bioinformatics* 2018;19. doi:10.1186/s12859-018-2217-z — verified (search)

R3. Badia-i-Mompel P, Wessels L, Müller-Dott S, Trimbour R, Ramirez Flores RO, Argelaguet R, Saez-Rodriguez J. Gene regulatory network inference in the era of single-cell multi-omics. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00618-5 — verified (corpus)

R4. Müller-Dott S, Tsirvouli E, Vazquez M, Ramirez Flores RO, Badia-i-Mompel P, Fallegger R, Türei D, Lægreid A, Saez-Rodriguez J. Expanding the coverage of regulons from high-confidence prior knowledge for accurate estimation of transcription factor activities. *Nucleic Acids Research* 2023. doi:10.1093/nar/gkad841 — verified (corpus)

R5. Aibar S, González-Blas CB, Moerman T, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — verified (corpus)

R6. Authors not confirmed locally. Graphical models for zero-inflated single cell gene expression. *Annals of Applied Statistics* 2019. doi:10.1214/18-aoas1213 — verified (corpus)

R7. Authors not confirmed locally. scPRINT: pre-training on 50 million cells allows robust gene network predictions. *Nature Communications* 2025. doi:10.1038/s41467-025-58699-1 — verified (corpus)

R8. Huynh-Thu VA, Irrthum A, Wehenkel L, Geurts P. Inferring regulatory networks from expression data using tree-based methods. *PLoS ONE* 2010, e12776. doi:10.1371/journal.pone.0012776 — verified (repo)

R9. Moerman T, et al. GRNBoost2 and Arboreto: efficient and scalable inference of gene regulatory networks. *Bioinformatics*. Title, author list and year not confirmed locally. doi:10.1093/bioinformatics/bty916 — partial (repo)

R10. Kim S. PPCOR: An R Package for a Fast Calculation to Semi-partial Correlation Coefficients. Venue not confirmed locally. doi:10.5351/csam.2015.22.6.665 — verified (repo)

R11. Authors not confirmed locally. High performance single-cell gene regulatory network inference at scale: the Inferelator 3.0. *Bioinformatics* 2022. doi:10.1093/bioinformatics/btac117 — verified (corpus)

R12. Authors not confirmed locally. SINCERITIES: inferring gene regulatory networks from time-stamped single cell transcriptional expression profiles. *Bioinformatics* 2017. doi:10.1093/bioinformatics/btx575 — verified (corpus)

R13. Authors not confirmed locally. SCODE: an efficient regulatory network inference algorithm from single-cell RNA-Seq during differentiation. *Bioinformatics* 2017. doi:10.1093/bioinformatics/btx194 — verified (corpus)

R14. Marbach D, Costello JC, Küffner R, Vega NM, Prill RJ, Camacho DM, Allison KR, Kellis M, Collins JJ, Stolovitzky G. Wisdom of crowds for robust gene network inference. *Nature Methods* 2012. doi:10.1038/nmeth.2016 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/tmoerman/arboreto (commit 2f475dc) | Thomas Moerman (setup.py author) | BSD 3-Clause (LICENSE.txt) | GRNBoost2 and GENIE3 orchestration, default dictionaries, importance rules | port |
| https://github.com/aertslab/GENIE3 | Authors not confirmed locally | GPL (>= 2) per DESCRIPTION; no LICENSE file at root | method reference only | callout |
| https://github.com/cran/ppcor (version 1.1) | Seongho Kim (author and maintainer) | GPL-2 (DESCRIPTION) | partial-correlation statistic and significance reference | reimplement |
| https://github.com/Murali-group/Beeline (commit 3746408) | Murali group; Algorithms READMEs carry maintainer label Aditya Pratapa | GPL-3.0 (LICENSE) | runners, evaluator definitions and benchmark inputs | callout for the harness; metrics reimplemented from definitions |
| https://github.com/Murali-group/BoolODE | Murali group (repository owner) | GPL-3.0 (LICENSE) | synthetic-network generator for B1 | callout |
| https://github.com/scikit-learn/scikit-learn (main, commit 85593ca) | scikit-learn developers | BSD 3-Clause (COPYING) | tree learners and importance normalisation, used through their API | callout |
