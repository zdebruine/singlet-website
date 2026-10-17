---
id: trajectory.pseudotime_de
title: Pseudotime-associated and lineage-specific differential expression
area: trajectory
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [trajectory.pseudotime_ordering, trajectory.branch_point_assignment]
feeds: [statistics.multiple_testing_control, statistics.pvalue_null_calibration, trajectory.gene_switch_timing]
reads: [layers/counts, obs/pseudotime, obsm/lineage_weights]
writes: [var/<test>_pvalue, var/<test>_pvalue_fixed, var/<test>_fdr, var/<test>_statistic, varm/<test>_coefficients, uns/<test>_smoothers, uns/<test>_run]
devices: [cpu, cuda]
mcp_tool: singlet_trajectory_pseudotime_de
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Pseudotime-associated and lineage-specific differential expression

> Tests, for each gene, whether its expression changes along pseudotime, differs between lineages or branches, or changes from lineage start to end, using negative-binomial models with false discovery control.

## 1. Question

Which genes change along pseudotime, differ between lineages at matched progression, or differ between the start and end of a lineage? Inputs are raw counts, one pseudotime per cell, optional lineage weights and optional labels. Outputs are a statistic, p-value and FDR per gene, and fitted expression curves. A correct answer calls a gene only when its trend departs from the null trend beyond chance, with FDR controlled, and with pseudotime treated as estimated rather than exact.

## 2. Why this task matters and where the field stands

Trajectory analyses end with genes that change along the trajectory, and those genes carry the biology: programmes that switch on before a fate decision and genes that separate two fates after a fork. Pseudotime is itself estimated by trajectory methods such as Slingshot [R5], and trajectory methods differ in accuracy and robustness across datasets [R14]. Per-gene tests along a trajectory build on pseudotemporal ordering [R4]. The common model is a negative-binomial GAM. tradeSeq fits one smoother per lineage and tests association, start-versus-end, pattern and early-difference contrasts [R1]. Monocle 2 tests a spline trend against a constant, and branch dependence of the trend, by likelihood ratio [R3].

Status: **contested**. The NB-GAM test family is routine. Calibration under estimated pseudotime, and comparison of lineages at matched progression, are contested.

The first open problem is conditioning. These tests treat pseudotime as known, but it is estimated. PseudotimeDE builds the spread of the ordering into the null to obtain calibrated p-values [R2]. Probabilistic models for pseudotime were proposed earlier for the same problem [R6]. The second problem is lineage scale. Pseudotime magnitudes are not comparable across lineages, so raw differences can call genes that only stretch [R13]. The third is design. Cells from one donor are not independent replicates, and cell-level tests produce false discoveries [R8]. Sample-aware differential pseudotime exists [R7], and pseudobulk over samples is a common alternative [R9].

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $Y_{gc}$, $s_c$ | count of gene $g$ in cell $c$; size factor of cell $c$ |
| $t_c$, $\tau_c$ | estimated pseudotime; true progression |
| $w_{cl}$ | lineage weight of cell $c$ for lineage $l$ |
| $\theta_g$, $\mu_{gc}$ | dispersion of gene $g$; expected count |
| $f_{gl}$, $\beta$, $V_p$ | smooth of gene $g$ on lineage $l$; spline coefficients and their covariance |

**Model.** Counts are negative binomial, $Y_{gc}\sim\mathrm{NB}(\mu_{gc},\theta_g)$, with $\mathrm{Var}(Y_{gc})=\mu_{gc}+\mu_{gc}^{2}/\theta_g$, which tends to Poisson as $\theta_g\to\infty$. The log mean is additive in one penalised spline per lineage:

$$\log\mu_{gc}=\log s_c+\sum_{l}w_{cl}\,f_{gl}(t_c),\qquad f_{gl}(t)=\sum_{k=1}^{K}\beta_{glk}B_k(t),$$

where $B_k$ are cubic regression spline bases with knots at pseudotime quantiles. The fit assumes integer counts and large $n$ relative to $K$. In tradeSeq, $w_{cl}$ is one multinomial draw per cell from normalised weights, so the fit conditions on that draw. The offset is the library size scaled by the TMM factor, which assumes that most genes do not change with pseudotime. Under that assumption $f_{gl}$ is on the scale of normalised mean counts.

**Tests.** Each test is a Wald statistic on a contrast $L$ of the coefficients,

$$W=(L\hat\beta)^\top\,(L\,V_p\,L^\top)^{-1}(L\hat\beta)\;\approx\;\chi^{2}_{\operatorname{rank}(L)},$$

where $V_p$ is mgcv's Bayesian covariance, which conditions on the estimated smoothing parameter. Association sets every smoother coefficient to zero, so the curve is flat. Start-versus-end approximates $f_g(t_{\mathrm{end}})-f_g(t_{\mathrm{start}})$. Pattern and early-difference tests contrast two lineage curves over a grid of points. The reference is asymptotic, so the regime is large $n$ and means well above zero. Accuracy for sparse genes is not shown here.

**Estimated pseudotime.** Let $\hat\tau$ be the inferred ordering. A p-value conditional on one ordering treats it as fixed, so the spread that the ordering would show across resamples of cells is missing from the reference. PseudotimeDE adds that spread to the null. It draws subsamples of 80% of cells, re-infers pseudotime on each, permutes it within the subsample, refits, and records a statistic $T_b$. $T_{\mathrm{obs}}$ comes from the original ordering, and the p-value is

$$p_{\mathrm{emp}}=\frac{1+\#\{b\le B:\;T_b\ge T_{\mathrm{obs}}\}}{B+1}.$$

The $+1$ form is a valid Monte Carlo p-value when $T_{\mathrm{obs}}$ and the $T_b$ are exchangeable under the null. Subsampling breaks that exchangeability, so the size of the test is an empirical question (B2). The resolution is $1/(B+1)$. The fixed-ordering p-value from the same GAM is reported beside it as a baseline.

**Lineage comparisons.** Monocle 2's differentialGeneTest compares a natural spline with three degrees of freedom against an intercept-only model, $\Lambda_g=2(\ell_g^{\mathrm{full}}-\ell_g^{\mathrm{red}})\sim\chi^{2}_{3}$, with pseudotime fixed. BEAM applies the same likelihood-ratio logic to a spline-by-branch model against a spline alone, so it tests branch dependence, including branch offsets, not only the interaction. Both test nested models on the given ordering.

**Multiplicity and calibration.** Benjamini–Hochberg q-values are $q_{(i)}=\min_{j\ge i}\frac{m}{j}\,p_{(j)}$ over the $m$ genes with a valid fit [R10]. They control FDR for independent statistics and under positive dependence; correlated genes make the realised FDR vary between replicates. Calibration on known null genes is summarised by $\lambda_{\mathrm{GC}}=\operatorname{median}(z^{2})/0.455$ with $z=\Phi^{-1}(1-p/2)$, where 0.455 is the median of $\chi^2_1$. Values near 1 indicate calibration.

**Estimands.** Each output has one definition here.
- Smoother $f_{gl}(t)$: log expected count per TMM-scaled library at pseudotime $t$. It is identified only up to a constant, so contrasts are the estimands.
- Start-versus-end: natural-log fold change between the end and the start of a lineage.
- Statistics and coefficients: $W$ and $\Lambda_g$ are referred to $\chi^2$ with the stated degrees of freedom and have no units. Spline coefficients are in a knot-specific basis, so they are comparable only between fits with the same knots.
- p-values and q-values: dimensionless tail probabilities under the stated null; q-values adjust over the valid genes.
- Benchmark truth: per gene, null or non-null. The planted effect is the natural-log difference between two curves at matched progression. Oracle pseudotime is the simulated path position min–max scaled to $[0,1]$ per path, the range on which PseudotimeDE's default knots are placed.

**Lineage scale.** Pseudotime has units set by the trajectory method, so the same biology can span different ranges on two lineages. Matched progression means evaluating both curves at the same pseudotime on a shared trunk, or at the same fraction of progression on lineages without one. The second choice is a modelling assumption, and early-difference tests inherit it.

**Heuristics against models.** The pseudotime-binned Wilcoxon rank-sum test needs no fit and makes no distributional assumption within a bin. Its answer depends on the bin count, ignores order within bins and returns no curve. The NB model gives p-values calibrated under its own assumptions, a fitted curve reusable for switch timing and covariate adjustment, and a count likelihood.

**Insight.** The count model is not the main threat. Calibration under a stated model is only as good as the conditioning on one ordering, which the estimated-pseudotime null targets (see B2).

**Assumptions.** Expression depends on a cell only through progression, lineage membership and size factor. Pseudotime is oriented from the root and reflects progress in every lineage used. Dispersion does not depend on pseudotime. Lineage assignment is fixed within a fit. A spline with $K$ functions approximates $f$.

**Failure modes.** Fixed-ordering tests are anti-conservative when the ordering varies across resamples (claimed by PseudotimeDE; B2). Failed tradeSeq fits return NA rows, which must be counted. End-point contrasts depend on extrapolation at the ends, and sparse lineages make quantile knots degenerate. Zero inflation beyond NB is not modelled by tradeSeq or Monocle 2. Donor pseudoreplication inflates cell-level tests [R8].

**Complexity.** Per gene and iteration, forming the normal equations costs $O(nK^2)$ and solving them costs $O(K^3)$. A scan of $G$ genes over $I$ iterations therefore costs $O(GnK^2I)$ for a dense design. The subsampling null multiplies this by $B$ and adds $B$ pseudotime inferences.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| tradeSeq | model-based | Per-gene NB GAM with one penalised spline per lineage; Wald tests on spline contrasts with Bayesian covariance | [R1] |
| PseudotimeDE | model-based | NB GAM with a fixed-ordering p-value and a null from subsamples with re-inferred, permuted pseudotime | [R2] |
| Monocle 2 differentialGeneTest | model-based | NB natural-spline trend against an intercept, likelihood-ratio test, pseudotime fixed | [R3] |
| Monocle 2 BEAM | model-based | Likelihood-ratio test of a spline-by-branch model against a spline alone | [R3] |

tradeSeq is the standard for per-gene tests along lineages, and PseudotimeDE is the reference when pseudotime is estimated. Monocle 2 is kept as the comparator with fixed pseudotime, with and without a branch term. Pseudotime-binned Wilcoxon testing is the heuristic comparator and appears only in section 8.

Source versions (DESCRIPTION version, HEAD sha): tradeSeq 1.13.12 (02a9050), PseudotimeDE 0.99.0 (c278a48), Monocle 2.9.0 (7df1050).

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| tradeSeq | nknots | 6 | R/fitGAM.R:186 |
| tradeSeq | family | nb | R/fitGAM.R:189 |
| tradeSeq | gcv | FALSE | R/fitGAM.R:189, 450 |
| tradeSeq | offset | log library size times TMM factor; unnormalised fallback | R/fitGAM.R:82–97 |
| tradeSeq | knot placement | pseudotime quantiles per lineage; longest-lineage fallback | R/fitGAM.R:104–125 |
| tradeSeq | points per test | 2 × nknots | R/associationTest.R:8; R/patternTest.R:39 |
| PseudotimeDE | model | nb (first of nb, zinb, gaussian, auto, qgam) | R/PseudotimeDE.R:52 |
| PseudotimeDE | k | 6 | R/PseudotimeDE.R:53 |
| PseudotimeDE | knots | c(0:5/5) on pseudotime rescaled to [0, 1] | R/PseudotimeDE.R:54 |
| PseudotimeDE | aicdiff | 10 (model auto only) | R/PseudotimeDE.R:56 |
| PseudotimeDE | seed | 123 | R/PseudotimeDE.R:57 |
| PseudotimeDE | usebam | FALSE | R/PseudotimeDE.R:59; R/runPseudotimeDE.R:52 |
| PseudotimeDE | subsamples B; fraction | 1000; 0.8 | vignettes/quickstart.Rmd:69 |
| Monocle 2 | full and reduced models | ~sm.ns(Pseudotime, df=3) against ~1 | R/differential_expression.R:133–137 |
| Monocle 2 | expression family | VGAM::negbinomial.size() | R/utils.R:27, 520 |
| Monocle 2 | q-values | p.adjust, method BH | R/differential_expression.R:110 |
| Monocle 2 BEAM | full model | ~sm.ns(Pseudotime, df = 3)*Branch | R/BEAM.R:318 |
| Monocle 2 BEAM | reduced model | ~sm.ns(Pseudotime, df = 3) | R/BEAM.R:319 |

## 5. Proposed singlet approach

Source routes are set out in section 12.

The default method is `tradeseq`. It is model-based, has an explicit likelihood with Wald inference, and covers the contrasts singlet needs. Agents should use `test: association` on `obs/pseudotime` with `nknots` 6 and `alpha` 0.05, and supply `lineage_key` for lineage tests. `pseudotimede` is the choice when pseudotime was estimated from the same cells and calibration matters more than cost. Its gamma-mixture parametric tail is not exposed.

The proposed kernel fits all genes on one shared spline basis. Because the design is shared, each iteration needs only per-gene weights, so the normal equations for a batch of genes are batched $K\times K$ solves. The per-gene dispersion comes from a profile likelihood. The estimator is falsified if its type I error at $\alpha=0.05$ exceeds 0.065 in B2, or if its power at FDR 0.05 falls more than 0.05 below tradeSeq's in B1 with oracle pseudotime.

The ML stack needs no PyTorch for the test. The batched fit is small, hot and has a fixed family, so it is hard-coded in CUDA with batched cuBLAS solves. cuSPARSE is not used because the design is dense and narrow. PyTorch enters only if pseudotime is a learned posterior, which belongs to trajectory.pseudotime_uncertainty.

CPU is the reference implementation, and CUDA batches the per-gene solves. Streaming is not claimed for this version, because the subsample re-inference needs all cells. Defaults an agent should use without asking are `alpha` 0.05, `seed` 0, `tradeseq.nknots` 6, `tradeseq.min_cells_per_lineage` 20, `pseudotimede.n_subsamples` 1000 and `pseudotimede.subsample_fraction` 0.8. Monocle 2 uses a fixed three-degree spline.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw counts; not log-normalised |
| read | obs/pseudotime | float32 | per-cell pseudotime; column set by `pseudotime` |
| read | obsm/lineage_weights | float32, n × L | cell-by-lineage weights in [0, 1]; key set by `lineage_key`; absent for one lineage |
| write | var/<test>_pvalue | float32 | per-gene p-value; permutation p-value for pseudotimede |
| write | var/<test>_pvalue_fixed | float32 | pseudotimede only: fixed-ordering p-value |
| write | var/<test>_fdr | float32 | Benjamini–Hochberg q-value over genes with a valid fit |
| write | var/<test>_statistic | float32 | Wald or likelihood-ratio statistic |
| write | varm/<test>_coefficients | float32, G × (L·K) | spline coefficients per lineage |
| write | uns/<test>_smoothers | table | fitted curves on the prediction grid, per gene and lineage |
| write | uns/<test>_run | table | method, seed, B, failed-fit count |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `pseudotime` | string | "pseudotime" | — | obs column with per-cell pseudotime, oriented from the root cell. |
| `lineage_key` | string/null | null | — | obsm key of cell-by-lineage weights in [0, 1]; null tests a single lineage. |
| `test` | string | "association" | `association`, `start_vs_end`, `pattern`, `early_de`, `branch_beam` | association: trend along pseudotime; start_vs_end: end minus start; pattern, early_de: lineage differences; branch_beam: monocle_beam only. |
| `method` | string | "tradeseq" | `tradeseq`, `pseudotimede`, `monocle_dgt`, `monocle_beam` | tradeseq: NB GAM Wald tests; pseudotimede: estimated-pseudotime null; monocle_dgt, monocle_beam: NB likelihood-ratio tests. |
| `alpha` | number | 0.05 | min 0; max 1 | FDR level for summary counts and calls; does not change the FDR values written. |
| `seed` | integer | 0 | — | Seed for lineage-weight draws, subsamples and permutations. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `tradeseq` | object | — | — | Options used when method is tradeseq. |
| `tradeseq.nknots` | integer | 6 | min 3 | Spline basis functions per lineage; knots sit at pseudotime quantiles. |
| `tradeseq.min_cells_per_lineage` | integer | 20 | min 1 | Cells a lineage needs before its smoother is fitted; a singlet guard, not a tradeSeq default. |
| `pseudotimede` | object | — | — | Options used when method is pseudotimede. |
| `pseudotimede.n_subsamples` | integer | 1000 | min 1 | Pseudotime subsamples B for the permutation null; p-values have resolution 1/(B+1). |
| `pseudotimede.subsample_fraction` | number | 0.8 | min 0.1; max 1 | Fraction of cells in each subsample. |
| `pseudotimede.reinference` | string | "pseudotime_ordering" | — | Ordering method re-run on each subsample; the trajectory.pseudotime_ordering method by default. |
| `pseudotimede.model` | string | "nb" | `nb`, `zinb`, `auto` | Count model; auto chooses zinb over nb when the AIC gain exceeds aicdiff. |
| `pseudotimede.k` | integer | 6 | min 3 | Spline basis dimension for each smooth. |
| `pseudotimede.aicdiff` | number | 10 | min 0 | AIC margin for choosing zinb over nb when model is auto. |
<!-- PARAMS:AUTO:END -->

Each method reads only its own options: `tradeseq.*` for tradeseq and `pseudotimede.*` for pseudotimede. The Monocle methods take no options. `start_vs_end`, `pattern` and `early_de` need `method: tradeseq`, and `pattern` and `early_de` also need `lineage_key`. `branch_beam` needs `method: monocle_beam` and `lineage_key`. `pseudotimede` and `monocle_dgt` accept only `association`. `alpha` changes summary counts and calls, not the values written. A failed fit writes NaN, is counted in `uns/<test>_run`, and is never dropped silently. The tool does not check pseudotime orientation.

## 7. MCP tool

Tool `singlet_trajectory_pseudotime_de` (definition in `tasks/mcp/singlet_trajectory_pseudotime_de.json`). Example call and result:

```json
{"dataset": "data/trajectory.singlet", "pseudotime": "pseudotime", "test": "association", "method": "tradeseq"}
```

```json
{"dataset": "data/trajectory.singlet", "status": "completed",
 "wrote": ["var/association_pvalue", "var/association_fdr", "var/association_statistic", "varm/association_coefficients", "uns/association_smoothers", "uns/association_run"],
 "summary": {"method": "tradeseq", "test": "association", "n_genes_tested": "<int>", "n_failed_fits": "<int>", "n_fdr_below_alpha": "<int>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: `pseudotimede` may return `queued` with a `job_id`, because it re-infers pseudotime B times. Stochastic: `seed` controls lineage-weight draws, subsamples and permutations. Dry run: returns `seconds`, `peak_memory_gb` and `device` and writes nothing.

## 8. Benchmarks

**Shared protocol.** Each replicate receives the same counts, pseudotime and lineage weights, with each method at its section 4 defaults unless the benchmark says otherwise. Ground truth is binary per gene. A call is a gene with BH q at most 0.05 within the replicate. Observed FDR is false calls divided by max(1, calls), averaged over seeds, and power is the fraction of non-null genes called. Failed fits count as not called and are reported separately. Replicates use at least 20 seeds (proposed), and results are reported per trajectory type and per scale.

### B1. Planted association recovery on Splatter path simulations (proposed)

- **Goal**: measure FDR and power of the association test with oracle pseudotime and with estimated pseudotime, when the truth is known.
- **Ground truth**: planted simulation. A gene is non-null when protocol step 2 plants a non-linear trend in it, along the path [R11]; the simulator's own `nonlinearProb` setting is not used. Oracle pseudotime is the simulated path position min–max scaled to $[0,1]$ per path (section 3). Effect size is the peak-to-trough natural-log difference of the planted trend.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter path simulation, 10% planted genes | simulator [R11]; recipe below | simulated scRNA-seq counts; 1,000, 5,000 and 20,000 cells; 2,000 genes (proposed grid) | §12 | Path parameters at simulator defaults |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Observed FDR | false calls divided by max(1, calls), BH q at most 0.05, averaged over seeds | minimise | primary | [R10] |
| Power at nominal FDR | non-null genes called divided by planted non-null count; 95% interval over seeds | maximise | primary | — |
| Null p-value uniformity | Kolmogorov distance between the empirical null p-value CDF and the uniform; permutation ties reported as a fraction | minimise | guardrail | — |
| AUC of p-value ranking | area under the ROC curve separating non-null from null genes; ties by trapezoid rule | maximise | guardrail | — |

- **Comparators**: tradeSeq association (oracle and estimated pseudotime); PseudotimeDE with model nb, k 6 and B 100 (oracle and estimated); Monocle 2 differentialGeneTest with fixed pseudotime; pseudotime-binned Wilcoxon rank-sum with BH, bin count fixed in advance [R12].
- **Protocol**: generator recipe per seed and scale. (1) Simulate one path at each scale with simulator path defaults. (2) Plant a non-linear trend in 10% of genes. (3) Split genes at random into halves A and B. The estimated arm infers pseudotime from A with trajectory.pseudotime_ordering, and both arms test B. (4) Apply BH within each replicate to B. (5) Record hardware and thread counts.
- **Acceptance criterion** (proposed): with oracle pseudotime, observed FDR at most 0.06 at nominal 0.05 for tradeSeq and PseudotimeDE in every setting. With estimated pseudotime, PseudotimeDE FDR is at most 0.06 in every setting. An FDR above 0.10 for tradeSeq or Monocle 2 with estimated pseudotime is reported as inflation.
- **Known pitfalls**: the simulator is gamma-Poisson [R11], which matches the NB model and favours NB methods, so a ZINB or real-data-derived simulation must be added before ranking methods. Planted trends must be on the scale that the test uses (log mean against pseudotime), or power is not comparable across methods.

### B2. Null calibration with estimated pseudotime (proposed)

- **Goal**: check that p-values are uniform for genes that do not depend on the latent process when pseudotime is inferred from the data.
- **Ground truth**: consistency. Every gene is null by construction, so each gene's p-value should be uniform. Per cell, pseudotime is inferred from one gene half and tested on the other, so tested genes do not define the ordering.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter null simulation | simulator [R11]; recipe steps 1–5 | simulated; sizes as in B1 | §12 | No planted trend |
| No-latent control | PseudotimeDE README [R2]; recipe step 6 | simulated; structureless points | §12 | Boundary case |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Type I error at α | fraction of null genes with p at most α, for α in {0.05, 0.01, 0.001}; deviation from α reported | minimise deviation | primary | — |
| Genomic inflation | $\lambda_{\mathrm{GC}}$ over null genes, as in section 3 | target 1 | primary | — |

- **Comparators**: PseudotimeDE fixed-ordering p-value; PseudotimeDE permutation p-value at B = 100; tradeSeq association with oracle and with estimated pseudotime; Monocle 2 differentialGeneTest with estimated pseudotime.
- **Protocol**: generator recipe. (1) Simulate single-path datasets as in B1 with no planted trend. (2) Split genes at random into halves A and B. (3) Infer pseudotime from A with trajectory.pseudotime_ordering. (4) Test B with each method. (5) Repeat over 20 splits and seeds (proposed). (6) For the no-latent control, use independent points with pseudotime from their first principal component. Report type I error and $\lambda_{\mathrm{GC}}$ per method and per pseudotime source, and by co-expression module as well as by gene.
- **Acceptance criterion** (proposed): type I error at α = 0.05 between 0.035 and 0.065, and $\lambda_{\mathrm{GC}}$ between 0.95 and 1.05, for every method under the held-out split.
- **Known pitfalls**: pseudotime inferred from the tested genes inflates p-values even for a valid test. Permutation p-values cannot fall below $1/(B+1)$, so the 0.001 row needs $B \ge 999$.

### B3. Lineage-difference recovery on Splatter branching simulations (proposed)

- **Goal**: measure whether lineage-difference tests (early difference, pattern, BEAM branch test) recover genes whose curves differ between branches at matched progression, and whether they call genes that only stretch.
- **Ground truth**: planted simulation. A branch gene has a planted curve difference between the two branches after the fork, and its estimand is the natural-log difference between branch curves at matched progression. A stretching-only gene has identical curves against true progression, and its true difference is zero. Branch membership per cell is the simulated path.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter two-path simulation from a shared trunk | simulator [R11]; recipe steps 1–4 | simulated; sizes as in B1 | §12 | Branch structure set by the path-from parameter |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-lineage TPR and FDR | as in B1, computed per lineage contrast | maximise TPR; minimise FDR | primary | [R10] |
| Stretching call rate | fraction of stretching-only genes with BH q at most 0.05 | minimise | primary | — |
| Direction accuracy | fraction of called genes whose estimated sign matches the planted sign at matched progression | maximise | guardrail | — |

- **Comparators**: tradeSeq early-difference and pattern tests, with window and knots fixed before the analysis; Monocle 2 BEAM branch test; pseudotime-binned Wilcoxon rank-sum per branch [R12].
- **Protocol**: generator recipe. (1) Simulate two paths from a shared trunk. (2) Plant branch-only effects in 10% of genes and stretching-only effects in another 10%. (3) Give methods a pseudotime in which branch 2 is multiplied by $c=2$ (proposed), which creates the stretch. (4) Apply each method with true branches and with branches from trajectory.branch_point_assignment. Results are reported per scale.
- **Acceptance criterion** (proposed): the stretching call rate at FDR 0.05 is at most 0.05 for each method. Methods above that rate are reported as stretch-sensitive.
- **Known pitfalls**: branch assignment errors near the fork give branch-specific calls for shared-trunk cells. Early-window results depend on the window and knots, so both are fixed before the test.

### P1. Performance and scaling

Measure seconds per gene per fit and peak resident memory for tradeseq (fit and association test, single and multi-core), pseudotimede at B = 100 and B = 1000 (PseudotimeDE's README recommends at least 10 cores), and Monocle 2 differentialGeneTest (one core and multi-core). Hold fixed K = 6, the NB family, 10,000 genes, the same pseudotime, the seed and the hardware. Scales are 1,000, 10,000 and 100,000 cells (proposed grid). Report CPU and CUDA, where CUDA applies to the batched fit only. Time pseudotime re-inference separately from the test, because it dominates for slow ordering methods. No numeric acceptance is set.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `trajectory.pseudotime_ordering`: Pseudotime ordering along a lineage
  - `trajectory.branch_point_assignment`: Branch point localisation and cell-to-branch assignment
- **Feeds**:
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
  - `trajectory.gene_switch_timing`: Gene expression shape classes and switch timing along pseudotime
- **Reads**: `layers/counts`, `obs/pseudotime`, `obsm/lineage_weights`
- **Writes**: `var/<test>_pvalue`, `var/<test>_pvalue_fixed`, `var/<test>_fdr`, `var/<test>_statistic`, `varm/<test>_coefficients`, `uns/<test>_smoothers`, `uns/<test>_run`
<!-- CHAINING:AUTO:END -->

Tier P1: a widely used extension of the trajectory workflow, placed after ordering and branch assignment. No named recipe is assigned in the catalogue.

## 10. Risks, pitfalls and open questions

- **Source gaps.** Figures of the tradeSeq and PseudotimeDE papers are not used, so simulation designs and error rates from them are not cited. The PseudotimeDE calibration claim rests on its README, which also states that the no-latent-structure case is under active work; no follow-up is used here. Code-level detail for the sample-aware comparators (Lamian and condiments) is absent, so no comparator is defined.
- **Attribution and parameter gaps.** The attribution of BEAM to [R3] is from memory and unverified. mgcv's default smoothing criterion is assumed. No accession is given for the Nestorowa HSC dataset in the OSCA chapter [R13], so the planned real-data marker check has no fixed dataset.
- **Unsettled science.** Whether NB-GAM tests keep calibration without a latent ordering is open, and PseudotimeDE's README says type I error control may fail there. No benchmark cited here measures calibration of lineage-difference tests on raw pseudotime.
- **Technical risks.** tradeSeq draws one lineage assignment per cell per fit, so assignment uncertainty is not propagated. tradeSeq returns unadjusted p-values (associationTest.R:461), so singlet applies BH itself.
- **Scope not covered.** Multi-sample pseudoreplication is not benchmarked. Zero-inflation beyond the zinb option is outside this version.
- **First experiment.** Apply the B2 recipe at the smallest scale for PseudotimeDE fixed-ordering and permutation p-values at B = 100 and B = 1000, and measure the gap between them before any port.

## 11. References

R1. Van den Berge K, Roux de Bézieux H, Street K, Saelens W, Cannoodt R, Saeys Y, Dudoit S, Clement L. Trajectory-based differential expression analysis for single-cell sequencing data. *Nature Communications* 2020;11:1201. doi:10.1038/s41467-020-14766-3 — verified (repo)
R2. Song D, Li JJ. PseudotimeDE: inference of differential gene expression along cell pseudotime with well-calibrated p-values from single-cell RNA sequencing data. *Genome Biology* 2021;22:124. doi:10.1186/s13059-021-02341-y — verified (corpus)
R3. Qiu X, Mao Q, Tang Y, Wang L, Chawla R, Pliner HA, Trapnell C. Reversed graph embedding resolves complex single-cell trajectories. *Nature Methods* 2017. doi:10.1038/nmeth.4402 — verified (corpus)
R4. Trapnell C, Cacchiarelli D, Grimsby J, Pokharel P, Li S, Morse M, Lennon NJ, Livak KJ, Mikkelsen TS, Rinn JL. The dynamics and regulators of cell fate decisions are revealed by pseudotemporal ordering of single cells. *Nature Biotechnology* 2014. doi:10.1038/nbt.2859 — verified (corpus)
R5. Street K, Risso D, Fletcher RB, Das D, Ngai J, Yosef N, Purdom E, Dudoit S. Slingshot: cell lineage and pseudotime inference for single-cell transcriptomics. *BMC Genomics* 2018. doi:10.1186/s12864-018-4772-0 — verified (corpus)
R6. Campbell KR, Yau C. Order under uncertainty: robust differential expression analysis using probabilistic models for pseudotime inference. *PLOS Computational Biology* 2016. doi:10.1371/journal.pcbi.1005212 — verified (corpus)
R7. Hou W, Ji Z, Chen Z, Wherry EJ, Hicks SC, Ji H. A statistical framework for differential pseudotime analysis with multiple single-cell RNA-seq samples. *Nature Communications* 2023. doi:10.1038/s41467-023-42841-y — verified (corpus)
R8. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R9. Crowell HL, Soneson C, Germain PL, et al. muscat detects subpopulation-specific state transitions from multi-sample multi-condition single-cell transcriptomics data. *Nature Communications* 2020. doi:10.1038/s41467-020-19894-4 — verified (corpus)
R10. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)
R11. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R12. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R13. Amezquita R, Lun A, Hicks S, Gottardo R, Geistlinger L, Hickey P. Trajectory Analysis, in *Orchestrating Single-Cell Analysis with Bioconductor*, advanced chapters (OSCA.advanced 1.21.2). Bioconductor; 2026. — verified (repo)
R14. Saelens W, Cannoodt R, Todorov H, Saeys Y. A comparison of single-cell trajectory inference methods. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0071-9 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/statOmics/tradeSeq | Koen Van den Berge (aut); Hector Roux de Bezieux (aut, cre); Kelly Street (aut, ctb); Lieven Clement (aut, ctb); Sandrine Dudoit (ctb) | MIT + file LICENSE (DESCRIPTION); LICENSE file: copyright Koen Van den Berge and Hector Roux de Bezieux, 2019 | NB GAM tests, contrasts and defaults | port |
| https://github.com/SONGDONGYUAN1994/PseudotimeDE | Dongyuan Song (aut, cre); Tianyang Liu, Huy Nguyen, Shiyu Ma, Yuheng Lai (ctb) | MIT + file LICENSE (DESCRIPTION); LICENSE file: MIT, copyright 2021 Dongyuan Song | Estimated-pseudotime null and permutation p-values | port |
| https://github.com/cole-trapnell-lab/monocle-release | Cole Trapnell (Author and Maintainer) | Artistic-2.0 (DESCRIPTION); no LICENSE file at the repository root | Fixed-pseudotime likelihood-ratio test and BEAM branch test | reimplement |
| https://github.com/Oshlack/splatter | Luke Zappia (aut, cre); Belinda Phipson (aut); further authors in DESCRIPTION | GPL-3 (DESCRIPTION; LICENSE file) | Path simulator for B1 to B3 | callout |
| https://github.com/scverse/scanpy | scverse (authors and maintainers in pyproject.toml) | BSD-3-Clause (LICENSE; pyproject.toml); LICENSE copyright (c) 2025 scverse® | Rank-sum comparator on pseudotime bins | callout |
