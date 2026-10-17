---
id: statistics.multiple_testing_control
title: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
area: statistics
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [markers-de.replicate_aware_condition_de, statistics.pvalue_null_calibration, statistics.post_clustering_inference]
feeds: [markers-de.cluster_marker_ranking, markers-de.celltype_response_prioritization]
reads: [varm/<test>_pvalues, uns/<test>/groups, varm/<test>_mean_expr, varm/<test>_detect_rate]
writes: [varm/<test>_qvalues, varm/<test>_reject, uns/<test>_fdr, models/<test>_ihw_weights]
devices: [cpu, cuda]
mcp_tool: singlet_statistics_multiple_testing_control
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Multiple-testing (FDR) control across genes, clusters, cell types and contrasts

> Adjust the p-values of many gene-by-group tests so that the false discovery rate of a declared family stays at the nominal level, and report q-values and reject flags that name the family they refer to.

## 1. Question

Which test family and FDR procedure keeps the false discovery rate at the stated level when the same genes are tested in many clusters, cell types or contrasts whose test statistics are correlated? The input is a genes-by-groups matrix of valid per-test p-values, optional per-test covariates (mean expression, detection rate) and the family, declared before the results are interpreted. The output is a q-value for every test and a reject flag at level $\alpha$. A correct answer names the family, controls the false discovery rate of that family at $\alpha$ under the stated dependence, and says what the same calls do not guarantee for the other family.

## 2. Why this task matters and where the field stands

A marker or condition screen tests every gene in every cluster, cell type or contrast, so the call list is a union over many families, and the family determines what a discovery means. A pooled threshold and a per-group threshold answer different questions, and the call list can change completely when the family changes. Practice is split. scanpy applies Benjamini-Hochberg (BH) within each group over all genes. muscat reports a within-cluster adjusted value (`p_adj.loc`) next to a global value (`p_adj.glb`), and the pooling behind the global value differs between its pseudobulk and mixed-model routes [R5]. Seurat's `p_val_adj` is a Bonferroni correction over all features, a family-wise bound rather than an FDR.

The status is **contested**, and the disagreement concerns the family rather than the BH step. Per-test validity comes first: cell-level tests on pseudoreplicated data give non-uniform null p-values, and no multiplicity procedure repairs them [R1, R2, R3, R4]. Given valid p-values, BH controls the FDR under independence and positive regression dependence [R6, R7], BY controls it under arbitrary dependence at a logarithmic price [R7], and adaptive procedures gain power only by estimating the null proportion [R8] or by using covariates that predict non-null status [R9].

Open problems:

1. Family choice. Per-group, pooled and hierarchical families answer different questions, and no consensus says which one a cluster analysis should report.
2. Dependence. Co-expression between genes and shared cells between groups correlate the statistics, and no calibrated procedure exists beyond BY's penalty.
3. Post-clustering families. Clusters defined from the same counts make per-cluster p-values non-uniform unless corrected (statistics.post_clustering_inference).
4. Benchmarks of multiplicity procedures on gene-by-cluster families are few; section 8 proposes three.

## 3. Theory and insight

### 3.1 Notation

| Symbol | Meaning |
|---|---|
| $g$, $k$ | gene and group (cluster, cell type or contrast) |
| $\mathcal F$, $m=\lvert\mathcal F\rvert$ | family of tests over which FDR is controlled, and its size |
| $p_{(i)}$, $q_i$ | $i$-th smallest p-value; adjusted value (q-value) of test $i$ |
| $V$, $R$ | false and total rejections within $\mathcal F$ |
| $\pi_0$, $w_i$ | null proportion of $\mathcal F$; IHW weight with mean one over $\mathcal F$ |
| $\theta_f$ | posterior probability that feature $f$ is differential |

### 3.2 Families and the estimand

A family is a set of tests whose false discoveries are jointly bounded, and the family is part of the estimand. The pooled family is $\mathcal F=\{(g,k)\}$ over all $GK$ pairs; a per-group family is $\mathcal F_k=\{(g,k)\}_g$. For a family,

$$\mathrm{FDR}_{\mathcal F}=\mathbb E\!\left[\frac{V}{\max(R,1)}\right].$$

The denominator counts rejections in the same family, so the quantity is the fraction of calls that are false and is zero when nothing is called. When every test in $\mathcal F$ is null, $\mathrm{FDR}_{\mathcal F}=P(R\ge 1)$. Each output has its own estimand:

- $q_i$ is the smallest $\alpha$ at which test $i$ is rejected within $\mathcal F$; it is a level, not a probability.
- $\hat\pi_0$ estimates the null fraction of $\mathcal F$, normalised by $m$, not by the number of groups.
- $\theta_f$ is a posterior probability for one feature; the posterior FDR of a set is the mean of $1-\theta_f$ over the set.
- $w_i$ averages one over $\mathcal F$, so weighting redistributes the rejection allowance without enlarging it.

Per-group and pooled control are different guarantees. Controlling each $\mathcal F_k$ at $\alpha$ does not control the FDR of the union of calls: for $K$ independent groups under a global null, the union FDR is $1-(1-\alpha)^K$. The pooled procedure can instead let strong groups absorb most rejections, so a null-heavy group can exceed $\alpha$ on its own family. All statements below hold for a fixed family chosen before the data are interpreted.

### 3.3 Procedures and the regime in which each holds

BH rejects the largest $k$ with $p_{(k)}\le k\alpha/m$, and its adjusted values are a reverse cumulative minimum,

$$\tilde p_{(i)}=\min_{j\ge i}\min\!\left(1,\tfrac{m}{j}\,p_{(j)}\right).$$

It is exact for a global null under independence and holds under positive regression dependence [R6, R7]. Tied p-values receive equal adjusted values.

BY divides $\alpha$ by $c(m)=\sum_{i=1}^m 1/i\approx\log m+\gamma$ and holds under arbitrary dependence [R7]; for $m=2\times10^5$, $c(m)\approx 12.8$.

Storey's null proportion and q-values are

$$\hat\pi_0(\lambda)=\frac{\#\{i:\,p_i>\lambda\}}{m(1-\lambda)},\qquad \hat q_{(i)}=\min_{j\ge i}\ \hat\pi_0\,\frac{m\,p_{(j)}}{j},$$

where $\hat\pi_0$ is smoothed over a grid of $\lambda$ and capped at one [R8]. The estimate assumes null p-values are uniform on $(\lambda,1]$ and that non-null p-values concentrate near zero, and it is stable only for large $m$. In a two-groups model the local false discovery rate is $\mathrm{lfdr}(p)=\pi_0 f_0(p)/f(p)$, with $f_0\equiv1$ when null p-values are exactly uniform.

IHW assigns covariate-based weights with mean one and applies weighted BH to $p_i/w_i$ [R9]. Its guarantee needs the covariates to be independent of the p-values of null tests.

For a Bayesian differential-expression model with posterior probabilities $\theta_f$, sort features by decreasing $\theta$ and take the largest prefix $k$ for which $\tfrac1k\sum_{i\le k}(1-\theta_{(i)})\le\alpha$. This is a posterior statement, valid when the posteriors are calibrated, and it is not a frequentist guarantee.

### 3.4 Failure modes

- Pseudoreplication makes the per-test p-values wrong, so every procedure is miscalibrated whatever the family [R2, R3, R1].
- Double dipping: clusters defined from the same counts make a per-cluster null non-uniform.
- Storey's $\hat\pi_0$ is biased upward when non-null signal is dense across groups, such as a shared response in many cell types, and is unstable for small $m$.
- Discrete statistics with ties, such as exact Wilcoxon p-values, make BH conservative.
- IHW loses validity when a covariate is associated with null p-values, for example when detection rate tracks variance.
- Shared cells and co-expression do not obviously satisfy the positive dependence that the BH argument needs (section 10).

### 3.5 Why heuristics work, and what a model-based formulation adds

BH is a robust default when the family and the per-test null are right: it needs one sort and no tuning. The FDR step is rarely the binding constraint; the null and the family decide validity. Adaptive methods help only when their extra information is real: pooling $\pi_0$ across groups helps when groups share null structure, and IHW helps when covariates predict non-null status. A model-based formulation adds claims that can fail on the benchmarks of section 8: a covariate-dependent non-null probability per test, a null proportion partly pooled across groups by empirical Bayes, and a calibrated posterior when a DE model supplies one. Each yields calibrated quantities only when its model is right, which is why BH stays as the comparator.

## 4. Methods landscape

BH applied within groups, or pooled, to valid per-test p-values is scanpy's default correction. BY is the fallback under arbitrary dependence and Bonferroni the conservative baseline. Storey's q-value and IHW are the adaptive procedures, and the posterior rule is the model-based analogue. The Simes and Berger rules are listed because they collapse a family of contrasts before any FDR step. Hierarchical FDR is absent (section 10).

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Benjamini-Hochberg step-up, pooled or per group | heuristic | Reject the largest $k$ with $p_{(k)}\le k\alpha/m$; adjusted values are a reverse cumulative minimum | [R6] |
| Benjamini-Yekutieli | heuristic | BH with $\alpha$ divided by $c(m)$; valid under arbitrary dependence | [R7] |
| Bonferroni over all features | heuristic | $\min(1,mp)$; a family-wise baseline | — |
| Storey q-value with smoothed $\hat\pi_0$ | model-based | Estimate $\pi_0$ above $\lambda$ and convert p-values to monotone q-values; local FDR gives a per-test posterior null probability | [R8] |
| Independent hypothesis weighting | model-based | Covariate-stratified weights with mean one, then weighted BH | [R9] |
| Posterior expected FDR from DE posteriors | model-based | Sort posterior DE probabilities and take the largest set whose mean $1-\theta$ is at most $\alpha$ (scvi-tools `_fdr_de_prediction`) | DE posterior model [R18]; rule from scvi-tools code |
| Per-cluster BH with a global BH (muscat) | heuristic | Within-cluster BH (`p_adj.loc`) and a global `p_adj.glb` reported together | [R5], [R12], [R13] |
| Per-group BH over all genes (scanpy) | heuristic | BH within each group over all genes (`corr_method`); Bonferroni is the alternative | — |
| Cauchy combination, then BY across genes (SPARK, SPARK-X) | heuristic | Per-kernel p-values combined by the Cauchy rule, then BY across genes | [R14], [R15] |
| Simes (any) and Berger (all) contrast combination (scran) | heuristic | Per gene, Simes across contrasts for `any`, or Berger's intersection-union test for `all`, before any FDR step | [R16], [R17] |

Defaults taken from source (commit shorthand after `@`):

| Method | Parameter | Value | Source |
|---|---|---|---|
| scanpy `rank_genes_groups` | `corr_method` | `benjamini-hochberg` (other option `bonferroni`) | `scverse_scanpy/src/scanpy/tools/_rank_genes_groups.py:767` @ 8ed52d9 |
| scanpy | `tie_correct` | `False` | `_rank_genes_groups.py:768` @ 8ed52d9 |
| scanpy | NaN p-values | replaced by 1 before correction | `_rank_genes_groups.py:507`, `:718` @ 8ed52d9 |
| scanpy | `alpha` | 0.05 passed to `multipletests`, whose reject output is discarded, so adjusted values do not depend on it | `_rank_genes_groups.py:720` @ 8ed52d9 |
| scanpy | Bonferroni option | `min(p * n_genes_total, 1)` | `_rank_genes_groups.py:722-723` @ 8ed52d9 |
| Seurat differential expression | `p_val_adj` | Bonferroni over all features, method hard-coded, `n = nrow(object)` | `satijalab_seurat/R/differential_expression.R:762-764`, `:1050-1052` @ 5f67c70 |
| Seurat | adjustment | `pmin(1, p * nrow(data.use))` | `differential_expression.R:1767` @ 5f67c70 |
| SPARK | adjustment of combined p-values | `p.adjust(method = "BY")` | `xzhoulab_SPARK/R/vctesting.R:79`, `R/sparkx.R:101` @ a8b4bf2 |
| muscat | global adjustment, pseudobulk | `.p_adj_global`: BH over tests pooled across comparisons, per cluster; called after pbDS | `HelenaLC_muscat/R/utils.R:141-165`, `R/pbDS.R:183` @ 8616831 |
| muscat | global adjustment, mixed model | BH over all cluster rows of the bound result table | `R/mmDS.R:163` @ 8616831 |
| muscat | local adjustment | BH per cluster, stored as `p_adj.loc` | `R/utils-mmDS.R:188, 309, 412` @ 8616831 |
| muscat | local adjustment, pseudobulk | edgeR or limma FDR column renamed `p_adj.loc` | `R/utils-pbDS.R:84, 118` @ 8616831 |
| qvalue | lambda grid | `seq(0.05, 0.95, 0.05)` | `jdstorey_qvalue/R/pi0est.R:79` @ e861423 |
| qvalue | pi0 smoothing | smoother with `smooth.df` 3; `smooth.log.pi0` FALSE | `pi0est.R:79-84` @ e861423 |
| qvalue | pi0 cap | `min(pi0, 1)` | `pi0est.R:107, 120, 124` @ e861423 |
| qvalue | q-value | `pi0 * pmin(1, cummin(p * m / i))`; positive-FDR variant at line 116 | `qvalue.R:116, 118` @ e861423 |
| SpatialDE | pi0 when $m<100$ | `pi0 = 1` when pi0 is `None` | `Teichlab_SpatialDE/Python-module/SpatialDE/util.py:24-25` @ 77f9fa5 |
| scvi-tools DE | `fdr_target` | 0.05 | `src/scvi/model/base/_rnamixin.py:385` @ 5555ecc |
| scvi-tools `_fdr_de_prediction` | fdr and selection | 0.05; largest prefix with cumulative mean of $1-p$ at most fdr | `src/scvi/model/base/_de_core.py:208-220` @ 5555ecc |
| scran `combineMarkers` | method mapping | `any` to Simes; `all` to Berger | `MarioniLab_scran/R/combineMarkers.R:196` @ 569d2f8 |

## 5. Proposed singlet approach

Routes per repository are in section 12. BH and Bonferroni are closed-form and are ported from their formulas. BY, the q-value, the scran rules, the muscat layout, the SPARK adjustment and IHW are reimplemented from their formulas without copying code. The posterior rule is ported in a later version.

**Model-based formulation.** Two additions are proposed. (i) Null proportions are partly pooled across groups: $\operatorname{logit}\pi_{0,k}\sim N(\mu_\pi,\tau_\pi^2)$, fitted by empirical Bayes, with each group estimate shrunk to the pooled mean. (ii) IHW weights are built from observed covariates only (mean expression, detection rate). Empirical nulls come from statistics.pvalue_null_calibration and are not re-estimated here. Falsifiers, on the benchmarks:

1. in B1, the calibration error of the Storey q-value with partially pooled $\hat\pi_0$ is not closer to zero than with per-group smoothing by at least 0.005 (proposed); then pooling is dropped;
2. IHW does not gain at least 0.02 in power over BH in the strong-covariate scenarios of B3 at observed FDR within 0.01 of $\alpha$; then BH stays the default;
3. observed FDR of pooled or per-group BH exceeds $\alpha+0.01$ in an independent-group scenario of B1.

**Stack.** PyTorch enters only through the empirical-null model of statistics.pvalue_null_calibration. The hot kernels are hard-coded CUDA: a radix sort with an index, an inclusive scan for the reverse cumulative minimum, a reduction for the $\hat\pi_0$ counts, and elementwise IHW weights followed by a second sort. No cuSPARSE is used. The CPU reference defines the output, and CUDA must match it to $10^{-12}$ absolute. Memory is about 24 bytes per test (float64 p-value, int64 index, float64 q-value), so $m=10^8$ needs about 2.4 GB on the device for the sort.

**Defaults without asking.** The caller must state `test` and `family`, since `family` has no default. Otherwise `method` is `bh`, `alpha` is 0.05, `missing` is `exclude` (proposed: a test not performed is not part of the family; scanpy's `set_to_one` keeps such tests in $m$), the `qvalue` and `ihw` options take their defaults, and `device` is `auto`. The upstream `fdr_scope` of markers-de maps to `family`: `global` to `pooled`, and `within_cell_type` to `per_cluster`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | varm/`test`_pvalues | float64, genes by groups | Per-test p-values assembled from each group's result table; NaN where untested |
| read | uns/`test`/groups | string list | Group names, one per column of the p-value matrix |
| read | varm/`test`_mean_expr | float64, genes by groups | IHW covariate: mean expression of the gene in the group; required for method ihw |
| read | varm/`test`_detect_rate | float64, genes by groups | IHW covariate: fraction of cells with nonzero counts; required for method ihw |
| write | varm/`test`_qvalues | float64, genes by groups | Adjusted values for the declared family |
| write | varm/`test`_reject | boolean, genes by groups | Reject flags at `alpha` |
| write | uns/`test`_fdr | object | Family, method, alpha, $m$, NaN count, $\hat\pi_0$ per family, rejection counts |
| write | models/`test`_ihw_weights | float64, genes by groups | IHW weights, written only for method ihw |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `test` | string | required | — | Name of the test whose genes-by-groups p-values sit in varm/<test>_pvalues. |
| `family` | string | required | `pooled`, `per_cluster` | FDR family: all gene-group tests together, or each group separately. Required; there is no default. |
| `method` | string | "bh" | `bh`, `by`, `bonferroni`, `qvalue`, `ihw` | Adjustment procedure. Use bh unless dependence or informative covariates justify by or ihw. |
| `alpha` | number | 0.05 | max 1; > 0 | Nominal FDR level for reject flags. Adjusted values do not depend on it. |
| `missing` | string | "exclude" | `exclude`, `set_to_one` | NaN tests: exclude removes them from family size m; set_to_one keeps them as p = 1. |
| `qvalue` | object | — | — | Options for method qvalue: Storey pi0 estimation and q-values. |
| `qvalue.lambda_min` | number | 0.05 | max 1; > 0 | Lowest lambda in the pi0 grid. |
| `qvalue.lambda_max` | number | 0.95 | max 1; > 0 | Highest lambda in the pi0 grid; must exceed lambda_min. |
| `qvalue.lambda_step` | number | 0.05 | max 0.5; > 0 | Spacing of the pi0 lambda grid. |
| `qvalue.smooth_df` | integer | 3 | min 1 | Degrees of freedom of the smoothing spline for pi0 over lambda. |
| `qvalue.pi0_small_m` | integer | 100 | min 1 | Below this many tests pi0 is fixed at 1, following SpatialDE. |
| `qvalue.pfdr` | boolean | false | — | Use the positive-FDR variant with finite-m correction. |
| `ihw` | object | — | — | Options for method ihw: covariates must be independent of null p-values. |
| `ihw.covariates` | array | ["mean_expr", "detect_rate"] | — | Per-test covariates; each must exist as varm/<test>_<covariate>. |
| `ihw.nfolds` | integer | 5 | min 2 | Cross-fitting folds for weight estimation, assigned deterministically by test index. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Covariate matrices must share the shape of the p-value matrix. The `qvalue` options apply only to method `qvalue`, and the `ihw` options only to method `ihw`; setting them with another method fails. `alpha` changes only the reject flags, since q-values do not depend on it. The `missing` option decides whether NaN tests count toward $m$.

## 7. MCP tool

Tool name `singlet_statistics_multiple_testing_control` (definition in `tasks/mcp/singlet_statistics_multiple_testing_control.json`). Example call and compact result:

```json
{"dataset": "/data/pbmc_study.singlet", "test": "replicate_aware_condition_de", "family": "per_cluster", "method": "bh", "alpha": 0.05}
```

```json
{"dataset": "/data/pbmc_study.singlet", "status": "completed",
 "wrote": ["varm/replicate_aware_condition_de_qvalues", "varm/replicate_aware_condition_de_reject", "uns/replicate_aware_condition_de_fdr"],
 "summary": {"family": "per_cluster", "method": "bh", "alpha": 0.05, "m_tests": "<count>", "n_nan": "<count>",
  "rejections": {"total": "<count>", "by_group": {"<group>": "<count>"}}},
 "provenance_id": "<id>", "job_id": null}
```

The tool is not long-running: families up to about $10^8$ tests complete inline, and `queued` is used only when the family exceeds device memory. It is not stochastic: every procedure is deterministic given the p-values, and IHW folds are assigned by test index. The `dry_run` estimate returns seconds, peak memory in gigabytes (about 24 bytes per test) and the device, without writing.

## 8. Benchmarks

Shared protocol. All benchmarks use float64 p-values and the families of section 3.2. Observed FDR and power are computed per replicate and averaged over replicates, because FDR is an expectation; the Monte Carlo interval is the t-interval over replicates. Thresholds are proposed unless a reference is given. Every procedure in a replicate receives the same p-values, and $\alpha\in\{0.01,0.05,0.10\}$ unless stated. Comparators execute on CPU with fixed seeds.

### B1. Planted gene-by-group FDR calibration under dependence

- **Goal**: measure observed FDR and power of each family and procedure when every gene-group null status is known, with independent statistics and with dependence from shared cells and co-expression.
- **Ground truth**: planted simulation. The non-null status of a pair ($\delta_{gk}\neq0$) is fixed before any statistic is formed. The planted-truth logic follows the single-cell differential-expression evaluation of Soneson and Robinson [R10]; the generator below is new. Gaussian working model (proposed):
  1. Draw $K=10$ group sizes $n_k$ from annotated catalogue cluster sizes. Shared cells with fraction $\omega\in\{0,0.3\}$ give $\Gamma_{kl}=\lvert S_k\cap S_l\rvert$; $R=D^{-1/2}\Gamma D^{-1/2}$, $D=\operatorname{diag}(\Gamma)$, is the correlation of group means.
  2. For a fraction $\pi_1\in\{0.01,0.05,0.2\}$ of pairs draw $\delta_{gk}\in\{\pm0.5,\pm1\}$; otherwise $\delta_{gk}=0$.
  3. Genes form modules of 1 or 50; each module draws factors $f_j\sim N(0,R)$ across groups, and each gene adds $e_g\sim N(0,I_K)$.
  4. With $\rho\in\{0,0.5\}$, $z_{gk}=\kappa\,\delta_{gk}\sqrt{n_k}+\sqrt{\rho}\,f_{j(g),k}+\sqrt{1-\rho}\,e_{gk}$, with $\kappa$ set in a pilot so that power at $\alpha=0.05$ spans 0.2 to 0.9; $p_{gk}=2\{1-\Phi(\lvert z_{gk}\rvert)\}$.
  The regime is Gaussian statistics from large cell counts; discreteness is tested in B2.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated gene-by-group statistics | recipe above; group sizes from the catalogue | Gaussian working model; $G=2\times10^4$, $K=10$, $m=2\times10^5$ | — | Factorial over $\pi_1$, $\omega$, $\rho$ and module size |
| Catalogue cluster sizes | singlet catalogue, 354M cells, about 40% author-annotated | annotated cell counts only | — | Used only for $n_k$ |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Observed FDR, pooled | $V/\max(R,1)$ over all $GK$ pairs at $q\le\alpha$ | at most $\alpha$ | primary | [R6] |
| Observed FDR, per group | $V_k/\max(R_k,1)$ per group, averaged with equal weight over groups; the maximum is also reported | at most $\alpha$ | primary | [R6] |
| Power | $\sum_k \mathrm{TP}_k/\sum_k N_{1,k}$ at the same rejection set | higher | primary | — |
| Calibration error | mean observed FDR minus $\alpha$ over 50 replicates, with a Monte Carlo 95% interval | close to 0 or below | guardrail | — |

- **Comparators**: BH pooled and per group; BY pooled; Bonferroni pooled; Storey q-value with per-group $\hat\pi_0$, partially pooled $\hat\pi_0$ (section 5) and $\pi_0=1$; IHW with mean expression, which is uninformative here, checking that weighting does no harm.
- **Protocol**: 50 seeded replicates per scenario, factorial over $\pi_1$, $\omega$, $\rho$ and module size, in float64 on CPU.
- **Acceptance criterion** (proposed): with $\omega=0$ and $\rho=0$, mean observed FDR of pooled and per-group BH is at most $\alpha+0.01$ in at least 95% of scenarios, and BY is at most $\alpha+0.01$ in every scenario; a procedure above $\alpha+0.02$ is flagged. Under dependence BH is reported without a gate, which is the test of the positive-dependence argument.
- **Known pitfalls**: independent simulated tests make BH look calibrated, so dependence must enter through $R$ and the modules; reporting pooled power beside per-group FDR mixes two estimands.

### B2. Global-null donor permutation with a family-level check

- **Goal**: test whether $P(R\ge1)\le\alpha$ holds when no gene is non-null, for pooled and per-group families, with donors rather than cells as the permuted unit.
- **Ground truth**: null by construction. Pseudo-condition labels are permuted among donors within a study, so every gene is null in every group and the truth set is empty. $R$ and $R_k$ count rejections in the family; the metrics are fractions of permutations.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Kang et al. 2018 PBMC, unstimulated condition | GEO GSE96583 [R11]; cell types as groups | 10x scRNA-seq, human PBMC, 8 donors (lupus patients) | — | Descriptive only: 35 balanced splits, $\binom{8}{4}/2$, used exhaustively |
| Catalogue studies with at least 12 control donors | singlet catalogue, 354M cells | scRNA-seq with donor identifiers | — | Selection rule; these studies carry the acceptance criterion |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| $P(R\ge1)$ | fraction of permutations with at least one rejection at $\alpha=0.05$; the maximum over groups for per-group families | at most $0.07$ | primary | — |
| Mean rejections | average of $R$ over permutations, per family | at most $\alpha m$ | primary | — |
| Per-group rejections | average $R_k$ over permutations | lower | guardrail | — |

- **Comparators**: per-cell Wilcoxon test run through scanpy `rank_genes_groups`; pseudobulk tests per group with per-group BH and with global BH, as in markers-de.replicate_aware_condition_de.
- **Protocol**: keep studies with at least 12 control donors, which gives at least 462 balanced splits ($\binom{12}{6}/2$). Draw $B=200$ splits uniformly, with replacement across draws; the Monte Carlo standard error of $P(R\ge1)$ near 0.05 is $\sqrt{0.05\cdot0.95/200}\approx0.015$. The mean-rejection bound follows from $P(R\ge1)\le\alpha$ because $R\le m\,\mathbf 1\{R\ge1\}$, and it is kept as an implementation check.
- **Acceptance criterion** (proposed): pseudobulk procedures on the catalogue studies have $P(R\ge1)\le0.07$ and mean rejections at most $\alpha m$; a cell-level procedure with $P(R\ge1)>0.10$ is reported as failing.
- **Known pitfalls**: permuting cells instead of donors breaks the donor structure and gives an invalid null; if groups are defined with the permuted label, the test is circular.

### B3. Covariate-informed power for weighted procedures

- **Goal**: compare power at the same nominal level when the probability of non-null status depends on a covariate independent of null p-values, and check the failure mode when that independence breaks.
- **Ground truth**: planted simulation from the B1 recipe with $\omega=0$ and $\rho=0$. The non-null indicator is drawn before the statistics, with $\operatorname{logit}P(\delta_{gk}\neq0)=a+b\,x_{gk}$, where $x_{gk}$ is the standardised log mean expression of the pair. Power is the non-null pairs rejected divided by all non-null pairs in the family.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated covariate-informed tests | B1 recipe with covariate | Gaussian working model; $G=2\times10^4$, $K=10$, $m=2\times10^5$; covariate in 10 bins | — | Strong ($b$ gives a 10-fold odds spread) and null ($b=0$) scenarios |
| Violated-covariate scenario | same generator, with $0.3\,x_{gk}$ added to null statistics | Gaussian working model | — | Tests the independence assumption |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Power (TPR) | $\mathrm{TP}/N_1$ at each procedure's rejection set | higher | primary | — |
| Power gain | TPR of IHW minus TPR of BH at the same nominal $\alpha$, when both have observed FDR at most $\alpha+0.01$ | higher | primary | [R9] |
| Observed FDR | $V/\max(R,1)$ averaged over 50 replicates | at most $\alpha+0.01$ | guardrail | [R6] |

- **Comparators**: BH; Storey q-value; BY; Bonferroni.
- **Protocol**: 50 seeded replicates per scenario; $b$ is set for the strong and null scenarios as above; IHW uses `covariates = [mean_expr]` with the fold rule of section 6.
- **Acceptance criterion** (proposed): in strong scenarios IHW has observed FDR at most $\alpha+0.01$ and a power gain of at least 0.02; in null-covariate scenarios the power gain is at least $-0.01$. In the violated scenario, observed FDR above $\alpha+0.02$ is reported as failure of the covariate assumption, not of the procedure.
- **Known pitfalls**: using the latent indicator as a weight is circular, since weights come only from observed covariates; covariates correlated with null p-values, such as detection rate tied to variance, break validity, and the violated scenario tests exactly this.

### P1. Performance and scaling

- **Measures**: wall time and peak memory of the adjustment alone (sort, reverse cumulative minimum and $\hat\pi_0$ counts) on float64 p-values, excluding the DE test.
- **Scales**: $m=2\times10^5$, $2\times10^6$, $2\times10^7$, and $10^8$ as a design target only.
- **Comparators**: statsmodels `fdrcorrection` (BH); the scanpy BH call path; qvalue's `pi0est` and `qvalue` in R; SpatialDE's `qvalue` in Python; IHW in R for weighting; the proposed CUDA sort and scan.
- **Hold fixed**: $\alpha$, the float64 p-values, the tie handling, the $\lambda$ grid, and the thread count (one CPU thread against one GPU); hardware is recorded.
- **Acceptance criterion** (proposed): CUDA and CPU adjusted values agree to $10^{-12}$ absolute; wall time grows with a log-log slope between 1.0 and 1.2 from $2\times10^5$ to $2\times10^7$ tests; the GPU path is kept only above the crossover where it beats the single-thread CPU reference, and the crossover is reported.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
  - `statistics.post_clustering_inference`: Post-clustering inference with valid p-values (double-dipping correction)
- **Feeds**:
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `markers-de.celltype_response_prioritization`: Cell-type prioritisation of response to a perturbation or condition
- **Reads**: `varm/<test>_pvalues`, `uns/<test>/groups`, `varm/<test>_mean_expr`, `varm/<test>_detect_rate`
- **Writes**: `varm/<test>_qvalues`, `varm/<test>_reject`, `uns/<test>_fdr`, `models/<test>_ihw_weights`
<!-- CHAINING:AUTO:END -->

Workflows: marker discovery (`markers-de.replicate_aware_condition_de`, then this task, then `markers-de.cluster_marker_ranking`); cell-type response prioritisation uses the same family choice.

## 10. Risks, pitfalls and open questions

- **Unverified sources.** Simes (1986) and Berger and Hsu (1996) are cited from memory: neither was found in the local corpus, and neither was checked by search, so their titles and venues are not confirmed. Holm's and Hochberg's procedures and the original Bonferroni paper are not cited, so scran's `some` rule (a Holm-based minimum, `combineMarkers.R:196`) is outside the tool. The IHW package source was not examined, so its weight-fitting details follow the paper. The local FDR formula is standard and is not taken from the qvalue code.
- **Unsettled literature.** The family question has no consensus. No calibrated FDR procedure exists for co-expression or shared-cell dependence beyond BY, and whether PRDS holds for statistics from shared cells is not established. Hierarchical or group FDR across clusters is named in the entry but has no method, source or benchmark here. The neighbourhood spatial FDR of Milo [R19] is not included, because its weighting step was not confirmed in the code examined, and its weights depend on $k$ and the graph.
- **Code-only steps.** The Cauchy-then-BY step for SPARK is read from the SPARK repository (section 4), not from the text of [R14]. The pooling behind muscat's pseudobulk `p_adj.glb` is read from code, not from the method text of [R5].
- **Technical risks.** The Gaussian generator of B1 covers only large cell counts, so discreteness is tested only in B2.
- **Data risks.** The terms of use for GSE96583 and for the catalogue-derived datasets are not stated in the sources used. B2's catalogue selection depends on donor identifiers, whose presence is to be verified before the acceptance criterion is applied.
- **First experiment.** Start with B1 at $\omega=0$ and $\rho=0$ for pooled and per-group BH at $K=10$, $G=2\times10^4$, 50 replicates, to check the estimand code. Then check the q-value formula on a ten-value worked example and time the step with `dry_run`.

## 11. References

R1. Single-cell best practices (online book), chapter "Differential gene expression analysis" (repository path `jupyter-book/conditions/differential_gene_expression`). — verified (corpus)
R2. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021;12:5692. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R3. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021;12:738. doi:10.1038/s41467-021-21038-1 — verified (corpus)
R4. Junttila S, Smolander J, Elo LL. Benchmarking methods for detecting differential states between conditions from multi-subject single-cell RNA-seq data. *bioRxiv* 2022 (preprint). doi:10.1101/2022.02.16.480662 — verified (corpus)
R5. Crowell HL, Soneson C, Germain PL, et al. muscat detects subpopulation-specific state transitions from multi-sample multi-condition single-cell transcriptomics data. *Nature Communications* 2020;11:6077. doi:10.1038/s41467-020-19894-4 — verified (corpus)
R6. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)
R7. Benjamini Y, Yekutieli D. The control of the false discovery rate in multiple testing under dependency. *Annals of Statistics* 2001;29(4):1165-1188. doi:10.1214/aos/1013699998 — verified (search)
R8. Storey JD, Tibshirani R. Statistical significance for genomewide studies. *Proceedings of the National Academy of Sciences* 2003;100(16):9440-9445. doi:10.1073/pnas.1530509100 — verified (search)
R9. Ignatiadis N, Klaus B, Zaugg JB, Huber W. Data-driven hypothesis weighting increases detection power in genome-scale multiple testing. *Nature Methods* 2016;13(7):577-580. doi:10.1038/nmeth.3885 — verified (search)
R10. Soneson C, Robinson MD. Bias, robustness and scalability in single-cell differential expression analysis. *Nature Methods* 2018. doi:10.1038/nmeth.4612 — verified (corpus)
R11. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018;36:89-94. doi:10.1038/nbt.4042 — verified (corpus)
R12. Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. *Bioinformatics* 2010;26(1):139-140. doi:10.1093/bioinformatics/btp616 — verified (corpus)
R13. Ritchie ME, Phipson B, Wu D, et al. limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 2015. doi:10.1093/nar/gkv007 — verified (corpus)
R14. Sun S, Zhu J, Zhou X. Statistical analysis of spatial expression patterns for spatially resolved transcriptomic studies. *Nature Methods* 2020. doi:10.1038/s41592-019-0701-7 — verified (corpus)
R15. Zhu J, Sun S, Zhou X. SPARK-X: non-parametric modeling enables scalable and robust detection of spatial expression patterns for large spatial transcriptomic studies. *Genome Biology* 2021. doi:10.1186/s13059-021-02404-0 — verified (corpus)
R16. Simes RJ. An improved Bonferroni procedure for multiple tests of significance. *Biometrika* 1986. — unverified (memory)
R17. Berger RL, Hsu JC. Bioequivalence trials, intersection-union tests and equivalence confidence sets. *Statistical Science* 1996. — unverified (memory)
R18. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R19. Dann E, Henderson NC, Teichmann SA, Morgan MD, Marioni JC. Differential abundance testing on single-cell data using k-nearest neighbor graphs. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01033-z — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | scverse developers (pyproject.toml); LICENSE copyright 2017 F. Alexander Wolf, P. Angerer, Theis Lab and 2025 scverse | BSD-3-Clause (LICENSE; pyproject.toml) | Per-group BH and Bonferroni in `rank_genes_groups`; BH and Bonferroni formulas; comparator | port (formulas); callout |
| https://github.com/statsmodels/statsmodels | statsmodels developers (LICENSE.txt: Jonathan E. Taylor 2006; SciPy developers 2006-2008; statsmodels developers 2009-2018) | BSD-3-Clause (LICENSE.txt; pyproject.toml) | `fdrcorrection` BH; comparator | callout |
| https://github.com/satijalab/seurat | Seurat authors (Authors@R in DESCRIPTION, including Andrew Butler, Saket Choudhary and David Collins) | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE: MIT License, copyright holder Seurat authors, 2021) | Bonferroni `p_val_adj`; comparator | callout |
| https://github.com/jdstorey/qvalue | John D. Storey (aut, cre), Andrew J. Bass (aut), Alan Dabney, David Robinson (Authors@R) | LGPL (DESCRIPTION; no version stated; no LICENSE file at root) | Storey pi0 and q-value | reimplement |
| https://github.com/xzhoulab/SPARK | Shiquan Sun, Jiaqiang Zhu, Xiang Zhou (aut); maintainer Jiaqiang Zhu | GPL-3 (DESCRIPTION; LICENSE.md is the GPL version 3 text) | BY on Cauchy-combined spatial p-values | reimplement |
| https://github.com/MarioniLab/scran | Aaron Lun (aut, cre), Karsten Bach (aut), Jong Kyoung Kim (ctb), Antonio Scialdone (ctb) | GPL-3 (DESCRIPTION; no LICENSE file at root) | Simes and Berger contrast combination | reimplement |
| https://github.com/HelenaLC/muscat | Helena L. Crowell (aut, cre) and further authors listed in DESCRIPTION | GPL-3 (DESCRIPTION); GPL-2.0-or-later in the scRNA-tools registry; no LICENSE file at root | Per-cluster and global BH layout | reimplement |
| https://github.com/scverse/scvi-tools | scvi-tools development team (pyproject.toml); LICENSE copyright 2026 Yosef Lab, Weizmann Institute of Science | BSD-3-Clause (LICENSE) | Posterior expected FDR rule | port (later version) |
| https://github.com/Teichlab/SpatialDE | Teichmann Group (LICENSE copyright 2018) | MIT (LICENSE) | pi0 conventions for small $m$; comparator | callout |
| https://github.com/nignatiadis/IHW | Nikos Ignatiadis (aut, cre) and further authors listed in DESCRIPTION | Artistic-2.0 (DESCRIPTION; no LICENSE file at root) | IHW weighting; comparator | reimplement from the paper; callout |
