---
id: immune-repertoire.repertoire_diversity_expansion
title: Repertoire diversity and clonal expansion estimation
area: immune-repertoire
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [immune-repertoire.tcr_clonotype_definition, immune-repertoire.bcr_clonal_family_inference]
feeds: [immune-repertoire.differential_clonal_expansion, immune-repertoire.repertoire_sample_classification]
reads: [obs/clone_id, obs/donor_id, uns/clone_definition]
writes: [uns/repertoire_diversity, uns/rarefaction_curves, obs/clonal_expansion]
devices: [cpu, cuda]
mcp_tool: singlet_immune_repertoire_repertoire_diversity_expansion
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Repertoire diversity and clonal expansion estimation

> Estimates how evenly cells spread over clonotypes and how many clonotypes a group holds, standardised for sampling depth, and labels each cell by the size of its clone.

## 1. Question

How diverse is each group's repertoire, and how expanded are its largest clones, when groups were sampled to different numbers of cells? The input is a clonotype label per receptor-bearing cell, a group column and optional copy counts. The output is per-group diversity estimates with intervals and a clone-size class per cell. A correct answer names its target (observed evenness, population richness or a Hill profile) and changes with sampling depth only within its stated error.

## 2. Why this task matters and where the field stands

Clonal expansion records antigen-driven proliferation, and diversity summarises how broadly a response spreads across clonotypes. Both are compared across donors, timepoints and tissues sampled to very different numbers of cells, and the number of observed clonotypes grows with that number. The best-practices chapter on adaptive receptors therefore compares evenness across donors rather than clonotype counts. It attributes to [R1] the statement that normalised Shannon entropy is among the indices least affected by subsampling, and its key takeaway is that evenness varies strongly between donors (section 12). Model-based estimates of T-cell repertoire diversity and completeness exist [R5].

The task is **contested**. Four choices remain open. The estimand: the chapter favours evenness, whereas immunarch's default is Chao1 richness (section 12). Depth stability: [R1] is the source of the subsampling claim, and [R2] discusses pitfalls in comparing diversity between sampled TCR repertoires, including shifting T-cell subset proportions and typical sample sizes. The clonotype definition: the same cells give different diversity under different definitions [R4], and no consensus clonotype definition exists for single-cell data [R3]. The validity of completion: Chao-type extrapolation depends on singleton counts, which error inflates. No benchmark is standard for this question, so section 8 proposes one.

## 3. Theory and insight

Let $\mathbf p=(p_1,\dots,p_S)$ be the clonotype frequencies of one group. A sample of $N$ receptor-bearing cells gives counts $n_i$, the observed number of clonotypes $S_{\mathrm{obs}}$, and the clone-size histogram $f_k$, the number of clonotypes seen exactly $k$ times, so $f_1$ counts singletons and $f_2$ doubletons. Two estimands must not be conflated. (A) The evenness of the observed sample depends on $N$ through $S_{\mathrm{obs}}$ and through plug-in bias. (B) The population richness or Hill numbers of $\mathbf p$ require extrapolation beyond the observed clonotypes, from $f_1$, $f_2$ or a rarefaction curve.

**E1 (Hill number).** For known $\mathbf p$,

$$D_q(\mathbf p)=\Big(\sum_{i=1}^{S}p_i^{\,q}\Big)^{\frac{1}{1-q}}\ (q\neq 1),\qquad D_1(\mathbf p)=\exp\Big(-\sum_{i=1}^{S}p_i\log p_i\Big).$$

$D_0=S$ and $D_2=1/\sum_i p_i^2$. The expression is exact for known $\mathbf p$ and $q\in[0,\infty)$. With $\hat p_i=n_i/N$ it is a plug-in estimate, and comparing it across depths needs completion (E4, E5) or rarefaction (E6) [R6, R7]. At $q=1$ the alakazam implementation replaces $q$ by 0.9999, so values there are approximate and differ between tools.

**E2 (Pielou evenness).** The normalised Shannon entropy of the observed sample [R8, R9] is

$$J=\frac{-\sum_{i\le S_{\mathrm{obs}}}\hat p_i\log\hat p_i}{\log S_{\mathrm{obs}}},\qquad S_{\mathrm{obs}}\ge 2.$$

Its value depends on $N$ through $S_{\mathrm{obs}}$ and through the downward plug-in bias, which to first order is $\mathbb E[\hat H]\approx H-(S-1)/(2N)$ [R10]. That approximation needs $N\hat p_i\gg 1$ for all $i$. The scirpy implementation returns 0 when $S_{\mathrm{obs}}=1$, a convention that makes no information look like full concentration; $J$ should be reported as undefined there.

**E3 (Simpson).** The plug-in concentration is $\hat\lambda=\sum_i(n_i/N)^2$, and the unbiased form is $\hat\lambda_{\mathrm{unb}}=\sum_i n_i(n_i-1)/\{N(N-1)\}$ [R11]. Gini–Simpson is $1-\hat\lambda$ and inverse Simpson is $1/\hat\lambda$. Since $\hat\lambda$ is biased upward for small $N$, the plug-in forms are biased low and used uncorrected by the comparators.

**E4 (Chao1 with sample-size factor).** With $n=N$,

$$\hat S=S_{\mathrm{obs}}+\frac{n-1}{n}\,\frac{f_1^2}{2f_2}\ (f_2>0),\qquad \hat S=S_{\mathrm{obs}}+\frac{n-1}{n}\,\frac{f_1(f_1-1)}{2}\ (f_2=0).$$

This estimates the number of clonotypes in $\mathbf p$ [R12, R7]. It is valid for large $N$ with informative $f_1$ and $f_2$. It is unstable when $f_2$ is small, and singleton inflation from error raises $f_1$ and therefore $\hat S$. The immunarch form uses a log-scale interval and alakazam a bootstrap over the abundance vector, so the intervals are not comparable.

**E5 (Sample coverage).** With $n=N$,

$$\hat C=1-\frac{f_1}{n}\cdot\frac{(n-1)f_1}{(n-1)f_1+2f_2}\ (f_2>0),\qquad \hat C=1-\frac{f_1}{n}\cdot\frac{(n-1)(f_1-1)}{(n-1)(f_1-1)+2}\ (f_2=0).$$

The estimand is $C=\sum_{i\ \mathrm{observed}}p_i$, the probability mass of $\mathbf p$ on clonotypes already seen, so $1-C$ is the unseen mass [R13]. The estimate is degenerate when $f_1=n$, where every clonotype is a singleton.

**E6 (Hypergeometric rarefaction).** For $m\le N$,

$$\hat{\mathbb E}[S_m]=S_{\mathrm{obs}}-\sum_{k\ge 1}f_k\,\alpha_k(m),\qquad \alpha_k(m)=\frac{\binom{N-k}{m}}{\binom{N}{m}},$$

the expected number of distinct clonotypes in a subsample of $m$ cells drawn without replacement from the $N$ observed cells [R14]. It is exact conditional on the sample and cannot extrapolate beyond $N$.

**E7 (Sampling model).** $\mathbf X\sim\mathrm{Multinomial}(N,\mathbf p)$ with $\hat p_i=X_i/N$. This describes iid cells from one clonal distribution. It fails under donor structure, PCR or UMI bias and sequencing error, and depth normalisation cannot remove those failures.

Two derived facts are used later. First, any subset of $m$ iid cells is an iid sample of size $m$, so its expected number of distinct clonotypes is exactly $\sum_i[1-(1-p_i)^m]$, the truth for E6 in B1. Second, every estimator above depends on a group only through $N$ and its histogram $f_k$, and D50 depends on the sorted histogram. This permits streaming (section 5).

**Estimands and normalisation.**
- Hill profile: the effective number of clonotypes of the group's $\mathbf p$ at a common sample coverage, in clonotype units and not normalised.
- Pielou $J$: evenness of the observed proportions, in $[0,1]$; its truth $J(\mathbf p)$ uses the number of nonzero $p_i$ in place of $S_{\mathrm{obs}}$.
- D50: the percentage of the $S_{\mathrm{obs}}$ observed clonotypes, sorted by size, needed to cover half of the cells; its truth uses $S$.
- Gini–Simpson and inverse Simpson: plug-in concentration of observed proportions; Gini–Simpson lies in $[0,1)$ and inverse Simpson is in clonotype units.
- Chao1 and rarefied richness: unnormalised counts of clonotypes, for $\mathbf p$ and for $m$ cells respectively.
- Coverage: the probability mass of $\mathbf p$ on observed clonotypes, in $[0,1]$.
- Expansion class: a label per cell giving the size class of the number of cells sharing its clonotype within the stated group; it is not a probability.

**Assumptions and failure modes.** Plug-in indices assume observed proportions equal population proportions; they are depth-sensitive through $S_{\mathrm{obs}}$ and biased for small $N$. Completion assumes the unseen tail is described by $f_1$ and $f_2$ alone, which error and expansion violate: error inflates singletons and expansion skews the size distribution. Rarefaction assumes an iid sample and is valid only up to $N$. Every method depends on the clonotype definition, because a different definition changes every count [R4]. Alakazam documents that significance may be inflated when clone sizes are uniformly small. Read counts in place of molecule counts inflate clone sizes unevenly across clones, so frequencies and expansion calls shift.

**Why heuristics work and what a model adds.** Plug-in indices are transparent and need only E7, but they are depth-sensitive. Completion (E4, E5) and rarefaction (E6) put samples on a common footing, by completeness or by size, and give intervals under E7. The Hill profile across $q$ shows the whole trade-off between rare and common clonotypes, so no single index has to be chosen in advance. A model-based formulation adds calibrated uncertainty, shrinkage of small donors towards a pooled estimate and an explicit regime, at the cost of assumptions that section 8 tests.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Normalised Shannon (Pielou evenness) over observed clonotypes | heuristic | Entropy of observed proportions divided by the log of the observed clonotype count (E2) | [R8], [R9], [R15] |
| D50 dominance | heuristic | Percentage of observed clonotypes needed to cover half of the cells | [R15] |
| Gini–Simpson and inverse Simpson, plug-in | heuristic | One minus, and reciprocal of, the sum of squared observed proportions (E3) | [R11] |
| Chao1 richness, immunarch form | model-based | Asymptotic unseen-richness estimator from $f_1$ and $f_2$ with a sample-size factor (E4) | [R12], [R7] |
| Sample coverage, Good–Turing type | model-based | Probability mass of observed clonotypes from $f_1$ and $f_2$ (E5) | [R13], [R7] |
| Hypergeometric rarefaction of richness | model-based | Expected distinct clonotypes in $m$ cells from the histogram (E6) | [R14] |
| Hill profile with coverage completion | hybrid | Completed abundance distribution, $D_q$ over a $q$ grid, bootstrap intervals | [R6], [R7] |
| Expansion size classes | heuristic | Per-cell class from clone-size breakpoints, counted within a group | [R15] |

The published heuristic standard is per-donor normalised Shannon evenness and dominance indices, as implemented in scirpy, together with immunarch's Simpson indices and Chao1 richness (the default of its deprecated repDiversity) and cellranger's rarefaction curve. Completion and rarefaction are model-based. singlet's proposed default is the Hill profile with coverage completion, which is hybrid. The plug-in indices, Chao1 and rarefaction stay as comparators, and each row is traced to source at the pinned commit in section 12, and the Hill profile and rarefaction are reimplemented from their formulas.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| scirpy alpha_diversity | metric; target_col | normalized_shannon_entropy; clone_id | src/scirpy/tl/_diversity.py:52, :51 @998c66a |
| scirpy Shannon | single clonotype | returns 0 | src/scirpy/tl/_diversity.py:17-19 @998c66a |
| scirpy D50 | percentage; computation | 50; cumulative proportion, returns i / S_obs × 100 | src/scirpy/tl/_diversity.py:122, :24-43 @998c66a |
| scirpy clonal_expansion | breakpoints; expanded_in; key_added | (1, 2); None (pooled); clonal_expansion | src/scirpy/tl/_clonal_expansion.py:76, :75, :78 @998c66a |
| scirpy pooled counting | documented meaning | a clonotype counts as expanded if any cell of the same clonotype exists across the entire dataset | src/scirpy/tl/_clonal_expansion.py:95-96 @998c66a |
| scirpy summarize_clonal_expansion | summarize_by | cell | src/scirpy/tl/_clonal_expansion.py:137 @998c66a |
| alakazam alphaDiversity | min_q; max_q; step_q; ci | 0; 4; 0.1; 0.95 | R/Diversity.R:915 @bbc35ba |
| alakazam estimateAbundance | min_n; uniform; ci; nboot | 30; TRUE; 0.95; 200 | R/Diversity.R:406-407 @bbc35ba |
| alakazam calcDiversity | q = 1 handling | q replaced by 0.9999 | R/Diversity.R:586-598 @bbc35ba |
| alakazam calcChao1Coverage | coverage forms | closed forms for f2 > 0 and f2 = 0 | R/Diversity.R:69-80 @bbc35ba |
| alakazam inferUnseenCount | unseen count | ceiling of the E4 correction, both branches | R/Diversity.R:124-136 @bbc35ba |
| alakazam rarefyDiversity | clone column | "CLONE", which differs from clone_id | docs/topics/rarefyDiversity.md:17 @bbc35ba |
| immunarch repDiversity | method; status | chao1; deprecated since 0.10.3 | R/v0_diversity.R:158, :161 @274afb2 |
| immunarch chao1 | branches | f2 = 0 at :261; f2 > 0 at :270-271, log-scale interval | R/v0_diversity.R:240-281 @274afb2 |
| immunarch gini_simpson; inverse_simpson | .do.norm; .laplace | NA; 0 | R/v0_diversity.R:320, :326 @274afb2 |
| cellranger main() | num_steps | 50 | mro/rna/stages/vdj/clonotype_diversity/__init__.py:109 @669395e |
| cellranger calc_rarefaction_curve | num_steps default | 40 | mro/rna/stages/vdj/clonotype_diversity/__init__.py:261 @669395e |
| cellranger _alpha; _rarefaction | forms | log-scale alpha_k(m); expectation and standard deviation | mro/rna/stages/vdj/clonotype_diversity/__init__.py:215-233, :239-259 @669395e |

## 5. Proposed singlet approach

**Routes.** Port the plug-in evenness, D50 and expansion classes from scirpy and the Simpson and Chao1 forms from immunarch (see section 12). Reimplement coverage completion and rarefaction from section 3; their sources serve as comparators only.

**Default.** `method` hill_coverage with `depth.policy` coverage, $q\in[0,4]$ in steps of 0.1, 200 bootstrap replicates, a 95% level, groups of at least 30 cells and seed 0. Each group's abundance vector is completed with the unseen count from E4 and then evaluated at one target coverage $C^{\ast}$, set to the smallest group coverage from E5 (proposed; B1 and B2 test it).

**Model-based formulation.** The completion is a count model: cells are multinomial (E7), and the unseen count and mass come from E4 and E5. The proposed extension is a hierarchical Bayesian count model across donors, with a Dirichlet-process or Pitman–Yor prior on clonotype frequencies. It would give posterior intervals for $D_q$ and $S$ at any depth and shrink small donors towards the pooled estimate. A selection-aware generative model of receptor frequencies [R16] could supply the prior. The extension is not in the enum; it enters only if B2 shows nominal interval coverage that the bootstrap lacks.

**Falsification.** If B1 or B2 misses its acceptance criterion, the default falls back to the plug-in indices and the failure is reported.

**ML stack.** Nothing in the default needs training. PyTorch is needed only if the hierarchical prior is fitted by variational inference or MCMC. CUDA is justified only for batched bootstrap across groups, depths and replicates, and only if P1 shows that the bootstrap dominates. cuSPARSE is unnecessary for the dense per-group histogram.

**Kernels and streaming.** All estimators depend on a group only through $N$ and its histogram $f_k$ (section 3). A single sweep therefore accumulates histograms per group, with memory set by the largest clone size rather than by the cell count. Rarefaction evaluates the log-scale $\alpha_k(m)$ at each depth, and the bootstrap resamples the histogram multinomially.

**Defaults without asking.** Use the section 6 defaults, except that `grouping.copy_key` should name a UMI column when one exists.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obs/clone_id | categorical | Clonotype label per cell; missing means unassigned. Renamed by `grouping.clone_key`. |
| read | obs/donor_id | categorical | Default group column, set by `grouping.group_key`. |
| read | uns/clone_definition | dict | Clonotype rule, copied into the output provenance. |
| write | uns/repertoire_diversity | table | Group, index, q, estimate, sd, ci_lo, ci_hi, coverage and the depth unit (cells, UMIs or reads). |
| write | uns/rarefaction_curves | table | Group, depth m, expected richness, sd and depth unit. |
| write | obs/clonal_expansion | categorical | Size-class label from the breakpoints (for example "<= 1"), "nan" for unassigned cells. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "hill_coverage" | `hill_coverage`, `plugin_indices`, `chao1`, `rarefaction`, `expansion_classes` | Estimator. hill_coverage is the default; plugin_indices and chao1 are comparators; expansion_classes labels cells by clone size. |
| `grouping` | object | — | — | Column names and minimum group size. group_key may be composite, such as donor crossed with cell type. |
| `grouping.clone_key` | string | "clone_id" | — | Column with the clonotype label; missing values mean unassigned and are excluded. |
| `grouping.group_key` | string | "donor_id" | — | Column defining the groups compared. |
| `grouping.copy_key` | string/null | null | — | Optional integer UMI or copy count per cell used as clone-size weight; null counts each cell once. |
| `grouping.min_cells` | integer | 30 | min 2 | Groups with fewer cells are reported as excluded, not dropped silently. |
| `depth` | object | — | — | Depth standardisation for hill_coverage and plugin_indices. |
| `depth.policy` | string | "coverage" | `coverage`, `uniform`, `none` | coverage aligns sample coverage; uniform resamples groups to one size; none keeps raw values. |
| `depth.size` | integer/null | null | min 1 | Common resampling size for uniform; null uses the smallest group. |
| `hill_coverage` | object | — | — | Options for the Hill profile: q grid, bootstrap replicates and confidence level. |
| `hill_coverage.q_min` | number | 0 | min 0 | Lowest Hill order q. |
| `hill_coverage.q_max` | number | 4 | min 0 | Highest Hill order q. |
| `hill_coverage.q_step` | number | 0.1 | > 0 | Spacing of the q grid; the default gives 41 orders. |
| `hill_coverage.nboot` | integer | 200 | min 10 | Bootstrap replicates for intervals; resampling uses the seed. |
| `hill_coverage.ci` | number | 0.95 | max 1; > 0 | Confidence level for intervals. |
| `plugin_indices` | object | — | — | Options for plug-in indices computed on observed clone sizes. |
| `plugin_indices.indices` | array | ["normalized_shannon", "d50", "gini_simpson", "inverse_simpson"] | — | Plug-in indices to report, chosen from the four listed values. |
| `rarefaction` | object | — | — | Options for the expected-richness curve. |
| `rarefaction.steps` | integer | 50 | min 2 | Number of sampling depths between 1 and the group size. |
| `expansion_classes` | object | — | — | Options for clone-size classes per cell. |
| `expansion_classes.breakpoints` | array | [1, 2] | — | Ascending clone-size class boundaries. |
| `expansion_classes.count_within_group` | boolean | true | — | Count clone sizes within each group; false pools the dataset, as scirpy does by default. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for bootstrap resampling and uniform subsampling. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`method` selects the estimator, and only its own nested object applies. `depth` applies to hill_coverage and plugin_indices; chao1 uses its own sample-size factor and closed-form interval, rarefaction uses its own depth grid, and expansion_classes labels cells directly. `depth.size` is used only with policy uniform. `seed` and `hill_coverage.nboot` do not affect chao1 or rarefaction, whose intervals and variances are closed form. Validation refuses q_min at or above q_max, non-positive q_step, non-integer copy_key values and breakpoints that are not ascending.

## 7. MCP tool

Tool name `singlet_immune_repertoire_repertoire_diversity_expansion` (definition in `tasks/mcp/singlet_immune_repertoire_repertoire_diversity_expansion.json`). One example call and one compact result:

```json
{"dataset": "bcells_donors.singlet", "grouping": {"clone_key": "clone_id", "group_key": "donor_id", "min_cells": 30}, "hill_coverage": {"q_max": 4, "q_step": 0.1, "nboot": 200}}
{"dataset": "bcells_donors.singlet", "status": "completed", "wrote": ["uns/repertoire_diversity"], "summary": {"method": "hill_coverage", "n_groups": "<int>", "n_excluded_groups": "<int>", "n_undefined": "<int>", "target_coverage": "<float>", "q_levels": 41}, "provenance_id": "<id>", "job_id": null}
```

Long-running: calls finish inline up to the size set by P1, and larger inputs return `queued`. Stochastic: bootstrap resampling uses `seed`; chao1 and rarefaction are closed form. Dry run: returns estimated seconds and peak memory from the group count, the histogram size and `nboot`.

## 8. Benchmarks

**Shared protocol.** Every method is applied to the same clone-size histograms, with the same clonotype rule and the minimum group size of 30 cells; groups below it are counted as excluded. Hill settings are 41 orders from 0 to 4, 200 bootstrap replicates and seed 0 unless a benchmark states otherwise. Metrics are medians and interquartile ranges over replicates. Undefined values ($S_{\mathrm{obs}}=1$, $f_2=0$, $f_1=N$) are counted in `undefined_rate` and never dropped. The depth unit is stated with each result. Thresholds marked proposed are design choices, not literature values.

### B1. Depth stability and recovery in planted power-law repertoires (proposed)

- **Goal**: identify depth-stable estimators that recover true evenness, richness and Hill numbers.
- **Ground truth**: planted simulation; truth from the generator's $\mathbf p$: $D_q(\mathbf p)$ (E1), $J(\mathbf p)$ with $S$ the number of nonzero $p_i$, the richness $S$, and $\sum_i[1-(1-p_i)^m]$ for E6 (section 3).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated histograms from the recipe below | generator recipe (proposed) | clonotype counts; grid below | — | parameters archived |

- **Generator recipe**: (1) For $S\in\{10^2,10^3,10^4\}$ and exponent $\theta\in\{1.05,2,3,5\}$, set $p_i\propto i^{-\theta}$ for $i=1,\dots,S$; larger $\theta$ is less even. (2) Draw $N\in\{10^4,10^5\}$ cells iid from $\mathbf p$. (3) Subsample $m\in\{0.1N,0.25N,0.5N,N\}$ cells without replacement. (4) Use 100 replicates per cell. An immuneSIM-family generator [R17] is a sensitivity check.
- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| depth_relative_change | Mean over replicates of $\lvert I(m)-I(N)\rvert/\lvert I(N)\rvert$ at $m=0.5N$ and $m=0.1N$; $I(m)$ is the index on the $m$-cell subsample | lower | primary | — |
| rank_discrimination | Spearman correlation of $I(N)$ with $J(\mathbf p)$ within each $(S,N)$ cell, across $\theta$ | higher | primary | — |
| bias_to_truth | Mean of $(I(N)-I^{\ast})/I^{\ast}$ against the truth | closer to 0 | primary | — |
| undefined_rate | Fraction of replicates with $S_{\mathrm{obs}}=1$, $f_2=0$ or $f_1=N$ | lower | guardrail | — |

- **Comparators**: scirpy's Pielou and D50; immunarch's Gini–Simpson and inverse Simpson; Hill $D_q$ at $q\in\{0,1,2,4\}$ with coverage completion (reimplemented); immunarch Chao1; and the rarefaction expectation at $m$.
- **Protocol**: the grid above, with medians and interquartile ranges per grid cell, identical seeds and cells as the depth unit.
- **Acceptance criterion** (proposed): an index is depth-stable if its median depth_relative_change at $m=0.5N$ is at most 0.05, and discriminating if its median rank_discrimination is at least 0.8. The default is the index meeting both, with the smallest interquartile range across grid cells; others are still reported.
- **Known pitfalls**: a power-law generator does not favour completion by construction. Undefined values are counted, not dropped.

### B2. Richness and coverage calibration under singleton error (proposed)

- **Goal**: test whether the Chao1 variants and the coverage estimate are calibrated when expansion and singleton inflation are present.
- **Ground truth**: planted simulation. Truth richness $S$ is the number of nonzero $p_i$ of the error-free generator, in clonotype counts. Truth coverage is $C=\sum_{i\ \mathrm{observed}}p_i$ on error-free labels, a probability in $[0,1]$ (E5).
- **Error model**: each cell's label is replaced by a fresh unique label with probability $e$; truth stays error-free.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated clone-size histograms with the error model | generator recipe (proposed) | clonotype counts; $N\in\{10^3,10^4,10^5\}$, $S\in\{10^2,10^3,10^4\}$, $\theta\in\{1.05,2,3\}$, $e\in\{0,0.01,0.05\}$ | — | the error grid is a design choice (proposed) |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| richness_relative_bias | Mean of $(\hat S-S)/S$ over replicates | closer to 0 | primary | — |
| coverage_abs_error | Mean of $\lvert\hat C-C\rvert$ over replicates | lower | primary | — |
| ci_coverage | Fraction of replicates whose 95% interval contains the truth | closest to 0.95 | primary | — |
| undefined_rate | Fraction of replicates with $f_2=0$, $f_1=0$ or $f_1=N$ | lower | guardrail | — |

- **Comparators**: immunarch Chao1 with its log-scale interval; the alakazam-form unseen count and coverage (reimplemented), with bootstrap intervals from 200 resamples of the histogram.
- **Protocol**: $R=200$ replicates per grid cell, the same error realisations for every comparator, and calibration reported against $N/S$.
- **Acceptance criterion** (proposed): for $N\ge 10S$ and $f_2\ge 10$, the absolute relative richness bias is at most 0.10 and ci_coverage lies between 0.90 and 0.98.
- **Known pitfalls**: without $e>0$ the benchmark does not test singleton inflation; intervals are not evaluated for groups below the minimum size of 30.

### B3. Donor-level consistency on a public COVID-19 cohort (proposed)

- **Goal**: test whether indices rank donors stably under subsampling and separate severity groups fixed before analysis.
- **Ground truth**: consistency; there is no planted truth. The instance is a donor, and the estimand is its index on CD8 T cells in the index's own units. Replicate CV is, per donor, the standard deviation over 100 subsamples at $m=0.5N$ divided by their mean. Group separation is the between-to-within variance ratio of donor-level values, with a Kruskal–Wallis p-value reported alongside. Severity labels are used only for separation.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Stephenson et al. 2021 TCR table and scirpy subset | [R18]; ArrayExpress E-MTAB-10026, as cited by the scirpy docstring | human PBMC; 143 samples and 1,141,860 cells in the study (scirpy docstring) | — | the best-practices notebook keeps 46 donors (11 healthy, 35 patients) from this cohort |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| replicate_cv | Median over donors of the coefficient of variation over 100 subsamples at $m=0.5N$ | lower | primary | — |
| group_separation | Between-to-within variance ratio of donor-level values; Kruskal–Wallis p reported | higher | primary | — |

- **Comparators**: the B1 comparators.
- **Protocol**: CD8 T cells; donors with at least 30 cells; clonotypes defined once across the dataset and once within donor, with both reported. The donor is the unit of analysis, and cells are not treated as independent samples.
- **Acceptance criterion** (proposed): median replicate_cv at most 0.05 for the evenness indices at $m=0.5N$. Separation p-values are reported without a threshold chosen after seeing the data.
- **Known pitfalls**: evenness varies strongly between donors in the best-practices analysis, so group claims need many donors; global versus within-donor clonotype scope changes the counts.

### B4. Expansion-class labelling against planted clone sizes (proposed)

- **Goal**: check that size classes are assigned correctly, and measure how much pooling across samples inflates the expanded fraction.
- **Ground truth**: planted simulation. A cell's true class is the class, under breakpoints (1, 2), of its planted clone size counted within its sample (within-sample truth) or across the dataset (pooled truth). The estimand is the class fraction over cells with a clone label, in $[0,1]$; a cell is expanded when its class is not "<= 1".
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated multi-sample clonotype table | generator recipe (proposed) | 10 samples of 1,000 cells; a shared pool of 500 clonotypes with power-law weights $\theta=2$ | — | sizes are design choices |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| class_accuracy | Fraction of cells whose predicted class equals the planted class under the same counting rule | higher | primary | — |
| pooled_inflation | Fraction expanded under pooled counting minus fraction expanded under within-sample counting | reported as a number | guardrail | — |

- **Comparators**: scirpy clonal_expansion with pooled counting (its default) and with within-sample counting.
- **Protocol**: deterministic labelling; 10 simulation replicates per setting; seeds fixed.
- **Acceptance criterion** (proposed): class_accuracy equals 1.0 for within-sample counting. pooled_inflation is reported without a threshold.
- **Known pitfalls**: pooled counting marks clonotypes shared across donors as expanded; the benchmark tests labelling only, not biological expansion.

### P1. Performance and scaling

Wall time, peak resident memory and time per bootstrap replicate for the full index set at $10^3$, $10^5$ and $10^6$ cells per group, with 10 groups, on CPU and, if a batched bootstrap exists, on CUDA. Comparators are timed on the same histograms: scirpy alpha_diversity and clonal_expansion, immunarch's chao1 and Simpson forms, and the cellranger rarefaction formula. Hold fixed the 41-order q grid, 200 replicates, 50 rarefaction depths, the thread count and seed 0, and repeat each setting to report spread. The Stephenson-scale input from B3 is an extra case. Rarefaction cost grows with the number of distinct clone sizes times the number of depths; the remaining steps grow with cells, and both are recorded.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `immune-repertoire.tcr_clonotype_definition`: TCR clonotype definition and grouping
  - `immune-repertoire.bcr_clonal_family_inference`: BCR clonal family inference
- **Feeds**:
  - `immune-repertoire.differential_clonal_expansion`: Differential clonal expansion and responding-clone detection
  - `immune-repertoire.repertoire_sample_classification`: Sample-level repertoire classification of exposure or disease
- **Reads**: `obs/clone_id`, `obs/donor_id`, `uns/clone_definition`
- **Writes**: `uns/repertoire_diversity`, `uns/rarefaction_curves`, `obs/clonal_expansion`
<!-- CHAINING:AUTO:END -->

Belongs to the receptor-repertoire workflow, after clonotype definition and before differential clonal expansion and sample classification.

## 10. Risks, pitfalls and open questions

- **Unverified claims.** The subsampling ranking attributed to [R1] comes from a one-sentence summary in the best-practices chapter, and the simulation design of [R1] was not read, so its grid values are not used as settings. Whether Chao1 is biased under strong clonal expansion is unresolved in the sources used here; B2 varies power-law skew and singleton error and does not test expansion directly.
- **Unsettled literature.** The estimand (evenness, richness or Hill profile) and the depth-stable index are not settled. The chapter favours evenness while immunarch defaults to Chao1, and the full text of [R2] was not read for its specific comparisons.
- **Code provenance risks.** Coverage completion and rarefaction are re-derived from section 3 rather than taken from source code (section 12). The maintainers must decide whether that re-derivation needs review.
- **Data gaps.** Dataset licences for E-MTAB-10026 and the scirpy subset were not identified. The Stephenson study counts come from the scirpy docstring and were not checked against the paper. Whether singlet's own corpus carries receptor calls is not established, so no benchmark uses it as data.
- **Omitted comparators and costs.** VDJtools and tcR are not comparators because no code for them was read. The D50 definition cites patent WO2012097374A1, which was not read. No timings were measured, so P1 costs are inferred from code structure. The Bayesian and Pitman–Yor richness literature has not been reviewed.
- **First experiment.** Implement E2, E4, E5 and E6 from section 3 and check E6 against the iid truth on simulated data at $N=10^4$. Then evaluate B1 and B2 over their grids. If B2 fails, keep the plug-in indices as the default and report the completion as a comparator.

## 11. References

R1. Mika J, Polanska A, Blenman KRM, Pusztai L, Polanska J, Candeias S, Marczyk M. A comprehensive evaluation of diversity measures for TCR repertoire profiling. *BMC Biology* 2025;23:133. doi:10.1186/s12915-025-02236-5 — verified (corpus)
R2. de Greef PC, de Boer RJ. Towards a robust comparison of diversity between sampled TCR repertoires. *bioRxiv* 2023. doi:10.1101/2023.02.10.528010 — verified (search)
R3. Mhanna V, Bashour H, Le Quy K, Barennes P, Rawat P, Greiff V, Mariotti-Ferrandiz E. Adaptive immune receptor repertoire analysis. *Nature Reviews Methods Primers* 2024. doi:10.1038/s43586-023-00284-1 — verified (corpus)
R4. Pelissier A, Luo S, Stratigopoulou M, Guikema JEJ, Rodriguez Martinez M. Exploring the impact of clonal definition on B-cell diversity: implications for the analysis of immune repertoires. *Frontiers in Immunology* 2023;14. doi:10.3389/fimmu.2023.1123968 — verified (corpus)
R5. Zarnitsyna V, Evavold B, Schoettle L, Blattman J, Antia R. Estimating the diversity, completeness, and cross-reactivity of the T cell repertoire. *Frontiers in Immunology* 2013;4:485. — verified (corpus)
R6. Hill MO. Diversity and evenness: a unifying notation and its consequences. *Ecology* 1973;54:427-432. — verified (repo)
R7. Chao A, Gotelli NJ, Hsieh TC, Sander EL, Ma KH, Colwell RK, Ellison AM. Rarefaction and extrapolation with Hill numbers: a framework for sampling and estimation in species diversity studies. *Ecological Monographs* 2014;84:45-67. doi:10.1890/13-0133.1 — verified (corpus)
R8. Jost L. The relation between evenness and diversity. *Diversity* 2010;2. doi:10.3390/d2020207 — verified (corpus)
R9. Shannon CE. A mathematical theory of communication. *Bell System Technical Journal* 1948;27:379-423, 623-656. — unverified (memory)
R10. Miller GA. Note on the bias of information estimates. In: *Information Theory in Psychology*. 1955. — unverified (memory)
R11. Simpson EH. Measurement of diversity. *Nature* 1949;163:688. — unverified (memory)
R12. Chao A. Nonparametric estimation of the number of classes in a population. *Scandinavian Journal of Statistics* 1984;11:265-270. — verified (repo)
R13. Chao A, et al. Unveiling the species-rank abundance distribution by generalizing the Good-Turing sample coverage theory. *Ecology* 2015;96:1189-1201. — verified (repo)
R14. Colwell RK, et al. Models and estimators linking individual-based and sample-based rarefaction, extrapolation and comparison of assemblages. *Journal of Plant Ecology* 2012. — partial (repo)
R15. Sturm G, Szabo T, Fotakis G, Haider M, Rieder D, Trajanoski Z, Finotello F. Scirpy: a Scanpy extension for analyzing single-cell T-cell receptor-sequencing data. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa611 — verified (corpus)
R16. Elhanati Y, Murugan A, Callan CG Jr, Mora T, Walczak AM. Quantifying selection in immune receptor repertoires. *Proceedings of the National Academy of Sciences* 2014. — verified (corpus)
R17. Weber CR, Akbar R, Yermanos A, Pavlovic M, Snapkov I, Sandve GK, Reddy ST, Greiff V. immuneSIM: tunable multi-feature simulation of B- and T-cell receptor repertoires for immunoinformatics benchmarking. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa158 — verified (corpus)
R18. Stephenson E, Reynolds G, Botting RA, et al. Single-cell multi-omics analysis of the immune response in COVID-19. *Nature Medicine* 2021. doi:10.1038/s41591-021-01329-2 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scirpy @998c66a | Gregor Sturm (maintainer) and Tamas Szabo (author), per pyproject.toml | BSD 3-Clause (LICENSE; pyproject.toml) | plug-in evenness, D50 and expansion-class rules | port |
| https://github.com/immunomind/immunarch @274afb2 | Vadim I. Nazarov (maintainer); Vasily O. Tsvetkov, Aleksandr A. Popov, Ivan Balashov (authors), per DESCRIPTION | Apache-2.0 (LICENSE); DESCRIPTION states Apache License (>= 2.0) | Chao1 form and plug-in Simpson indices; default-richness comparator | port |
| https://github.com/immcantation/alakazam @bbc35ba | Susanna Marquez (maintainer and author); Namita Gupta, Nima Nouri, Ruoyi Jiang, Julian Zhou, Kenneth Hoehn, Cole Jensen (authors); Daniel Gadala-Maria and others (contributors), per DESCRIPTION | AGPL-3 (LICENSE; DESCRIPTION) | Hill profile, coverage completion and unseen count; formulas re-derived | reimplement |
| https://github.com/10XGenomics/cellranger @669395e | 10x Genomics (copyright holder, LICENSE) | LICENSE text: custom 10x Genomics terms, an MIT-style grant limited to internal use with 10x Genomics products and no redistribution; automated detection reported MIT, and no package metadata was found | hypergeometric rarefaction; comparator | reimplement from the formula; callout for B1 and P1 |
| https://github.com/theislab/single-cell-best-practices | Theislab (copyright holder, LICENSE) | Apache-2.0 (LICENSE); automated detection returned none | source of the evenness recommendation and the per-donor analysis | callout |
