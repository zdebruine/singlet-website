---
id: abundance.celltype_proportion_test
title: Differential abundance of predefined cell types between conditions
area: abundance
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [annotation.cluster_label_assignment, qc.sample_level_qc]
feeds: [abundance.hierarchical_composition_test, statistics.multiple_testing_control]
reads: [obs/<sample_key>, obs/<celltype_key>, obs/<covariate_keys>, uns/<sample_metadata>]
writes: [uns/celltype_proportion/counts, uns/celltype_proportion/effects, uns/celltype_proportion/params, models/celltype_proportion]
devices: [cpu, cuda]
mcp_tool: singlet_abundance_celltype_proportion_test
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Differential abundance of predefined cell types between conditions

> For every predefined cell type, test whether its share of each sample changes between conditions across donors, model all types jointly so that shares sum to one, and report a log-ratio effect with an FDR-controlled call.

## 1. Question

Which predefined cell types change in relative abundance between conditions when cells are nested in donors or libraries and shares sum to one within each sample? The input is a sample-by-type count table built from cell labels and sample IDs, with sample-level covariates. The output is, per type, a log-ratio effect against a reference (or an equivalent constraint), a p-value or posterior inclusion probability, and an FDR-controlled call. A correct answer keeps the false-call rate near its nominal level when donors have no condition effect and recovers planted changes at the stated power when one exists.

## 2. Why this task matters and where the field stands

Cell-type composition reads out disease, infection and treatment, and most multi-donor studies report it beside expression changes. Shares are compositional: a rise in one type lowers the others by construction [R7, R8]. Under multinomial sampling the covariance of two shares in one sample is $-p_jp_k/n_s$, so a univariate test on counts or shares can report decreases in types that did not change. The best-practices chapter states that ignoring this constraint can produce spurious differential abundance signals [R12]. The replicate is the donor or library, not the cell: pooled cell-level tests treat cells as replicates and inflate false positives [R5, R6].

The status is **contested**. Joint compositional models (scCODA [R1], tascCODA [R2]) and a transformed-proportion linear model per type (propeller [R3]) are the main families. They differ in how the reference is fixed, how donor variation enters the uncertainty and how FDR is controlled, and no accepted real dataset carries an abundance ground truth. Open problems:

1. Reference stability: scCODA and tascCODA need a type that is unchanged across conditions [R12].
2. Granularity: calls change when types are split or merged.
3. Calibration with few donors, where dispersion is poorly estimated.
4. Log-linear covariate effects in scCODA (section 3.2).
5. No accepted real dataset carries an abundance ground truth, so benchmarks are mostly simulations.

A 2024 benchmark of six differential abundance methods on synthetic and real single-cell datasets treats batch effects and hyperparameter sensitivity as selection criteria [R15]; its task is finding condition-specific prototypical cells, not predefined types. Neighbourhood methods are covered by `abundance.neighborhood_da_knn_graph`.

## 3. Theory and insight

### 3.1 Estimand and constraint

Let $y_{s,k}$ be the number of cells of type $k$ in sample $s$ after QC and label assignment, $n_s=\sum_k y_{s,k}$, and $p_{s,k}=y_{s,k}/n_s$. Then

$$\sum_{k=1}^{K} p_{s,k}=1, \qquad \mathrm{Cov}(p_{s,j},p_{s,k})=-\frac{p_{s,j}\,p_{s,k}}{n_s}\quad (j\neq k),$$

the sum constraint exact at any $n_s$ and the covariance under multinomial sampling. This is the standard compositional view [R7, R8]. Every share uses the assigned cells of its sample as denominator, so QC that removes cells unevenly between arms moves every share in that arm. A cell-level test treats the $m$ cells of one donor as independent; if they share an intra-donor correlation $\rho$, its variance is too small by about $1+(m-1)\rho$ (the standard design effect). Power therefore depends mainly on the number of donors, not cells.

### 3.2 Joint Dirichlet-multinomial (scCODA)

$$y_s\sim \mathrm{DirMult}(n_s,c_s), \qquad c_{s,k}=\exp(\alpha_k+x_s^{\top}\beta_k), \qquad \beta_{\cdot,r}=0,$$

with $r$ the reference type. Because $c_{s,k}/c_{s,r}=\exp(\alpha_k-\alpha_r+x_s^{\top}\beta_k)$, the coefficient $\beta_{d,k}$ is the change in the log ratio of type $k$ to the reference per unit of covariate $d$. Its exponential multiplies that ratio; the change in the share of $k$ also depends on every other type. The Dirichlet concentration gives sample-level overdispersion in the likelihood; with few samples, the concentration and the priors dominate the estimate. The model is log-linear in covariates and needs $r$ unchanged across conditions [R1, R12].

Sparsity uses a spike-and-slab prior, $\beta_{d,k}=s_{d,k}\sigma_d b_{d,k}$, with $s_{d,k}=e^{50z_{d,k}}/(1+e^{50z_{d,k}})$, $z_{d,k},b_{d,k}\sim N(0,1)$ and $\sigma_d\sim\mathrm{HalfCauchy}(1)$. The inclusion probability is $\mathrm{PIP}_{d,k}=E[s_{d,k}\mid y]$; for $|z|$ above about 0.1 the steepness of 50 makes $s$ nearly binary. Calls use a posterior expected FDR,

$$\widehat{\mathrm{FDR}}(c)=\frac{1}{\lvert\{k:\mathrm{PIP}_k\ge c\}\rvert}\sum_{k:\,\mathrm{PIP}_k\ge c}\bigl(1-\mathrm{PIP}_k\bigr),$$

and the threshold $c$ is the smallest value whose estimate falls below the target. It is a posterior quantity under the model, not a frequentist error bound.

### 3.3 Tree-aggregated extension (tascCODA)

tascCODA applies the same likelihood with sparse effects on the internal nodes of a cell-type tree, so a subgroup of types can change even when no single leaf passes the threshold. Effects are reported as log fold changes relative to the reference, for leaves and for subgroups [R2]. The aggregation penalty trades subgroup detection against leaf resolution, and the tree is an input: the answer is given at the resolution the tree defines.

### 3.4 Transformed proportions (propeller)

$$z_{s,k}=\log\frac{\tilde p_{s,k}}{1-\tilde p_{s,k}},\quad \tilde p_{s,k}=\frac{y_{s,k}+0.5}{n_s+0.5K}, \qquad\text{or}\qquad z_{s,k}=\arcsin\sqrt{y_{s,k}/n_s}.$$

For each type a limma linear model on $z_{s,k}$ gives the group coefficient with empirical-Bayes variance shrinkage [R3, R9]. For the arcsine transform, $\mathrm{Var}(\arcsin\sqrt{\hat p})\approx 1/(4n_s)$ by the delta method, valid for large $n_s$ and proportions away from 0 and 1. The estimand is the difference of mean transformed shares: on the logit scale a log-odds difference of shares with a 0.5 pseudo-count. It is not a log ratio to a reference. Types are tested one at a time, so the constraint enters only through the shares.

### 3.5 Univariate comparator

A negative binomial GLM per type, $y_{s,k}\sim\mathrm{NB}(\mu_{s,k},\phi_k)$ with $\log\mu_{s,k}=\log n_s+x_s^{\top}\gamma_k$, estimates the change in the log share of type $k$. Its estimate for $k$ depends on all other types, which is the failure mode of section 2. It is used only as a naive comparator.

### 3.6 Estimands in simulation

For a planted fold change $f_k$ on type $k$, with the reference unchanged ($f_r=1$), the truth is $\theta_k=\log(f_k/f_r)=\log f_k$: the change in the log ratio of type $k$ to the reference between arms, on the scCODA scale. Under cell thinning (B2) the expected treated-to-control ratio of type $k$ to $r$ is exactly $f_k$, so the truth holds in expectation, and realised counts add the sampling noise the test must reflect. The change in share is not used as truth, because it depends on all types.

### 3.7 Assumptions and failure modes

- Types are fixed labels across conditions; a change in expression within a type is a different question.
- Donors or libraries are independent replicates; cells are exchangeable given their sample.
- The reference is unchanged; a moving reference moves every call (B3).
- Few donors leave variance poorly estimated, so results depend on priors or shrinkage.
- Rare types create zeros that destabilise Dirichlet-multinomial fits and make the logit pseudo-count matter.
- If batch is confounded with condition, the two effects cannot be separated.

### 3.8 Why model-based

A joint model gives an explicit reference, covariate effects with uncertainty, sparsity control and a fitted object that can be reused. Transformed linear models are simple to fit and transparent, and are a useful check when donors are many and shares are not near 0 or 1. Neither removes the need to treat the donor as the replicate; the difference lies in whether the uncertainty is calibrated, which section 8 tests.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| propeller | hybrid | Logit or arcsine-square-root shares per sample, then a limma linear model per type with empirical-Bayes shrinkage | [R3], [R9] |
| scCODA | model-based | Bayesian Dirichlet-multinomial over all type counts per sample, fixed reference type, spike-and-slab sparsity, expected-FDR calls | [R1] |
| tascCODA | model-based | scCODA extended with sparse effects on internal nodes of a cell-type tree | [R2] |
| Milo, one neighbourhood per type | model-based | Negative binomial GLM with a log library-size offset; here a univariate comparator, its intended use being neighbourhoods | [R4] |

The published standard is scCODA and tascCODA for joint models and propeller for per-type transformed proportions [R1–R3]. The naive negative binomial GLM and a chi-square test on pooled cells are comparators. Bias-corrected and centred log-ratio methods from microbiome work [R13, R14] are excluded from the tables (section 10). Defaults below come from the source code at the commits shown.

| Method | Parameter | Value | Source |
|---|---|---|---|
| scCODA | reference_cell_type | `automatic` | `src/pertpy/tools/_coda/_sccoda.py:106` @ c246f24 |
| scCODA | absence threshold for automatic reference | 0.05 | `_sccoda.py:107` @ c246f24 |
| scCODA | NUTS draws / warmup | 10000 / 1000 | `_sccoda.py:376-377` @ c246f24 |
| scCODA | sigma_d prior | HalfCauchy(1.0) | `_sccoda.py:253` @ c246f24 |
| scCODA | intercept prior | Normal(0, 5) | `_sccoda.py:269` @ c246f24 |
| scCODA | spike-and-slab steepness | 50 | `_sccoda.py:260` @ c246f24 |
| scCODA | est_fdr | 0.05 | `_base_coda.py:498` @ c246f24 |
| scCODA | acceptance-rate warning | above 0.95 | `_base_coda.py:332` @ c246f24 |
| tascCODA | lambda_0 / lambda_1 | 50 / 5 | `_tasccoda.py:274`, `:276` @ c246f24 |
| tascCODA | phi / theta | 0 / 0.5 | `_tasccoda.py:278`, `:281` @ c246f24 |
| propeller | transform / robust / trend | `logit` / TRUE / FALSE | `R/propeller.R:116` @ 3fe9cf4 |
| propeller | logit pseudo-count | 0.5 per type and sample | `R/getTransformedProps.R:84` @ 3fe9cf4 |
| propeller | robust shrinkage off below three types | FALSE | `R/propeller.ttest.R:117` @ 3fe9cf4 |
| Milo (comparator) | make_nhoods prop / seed | 0.1 / 0 | `src/pertpy/tools/_milo.py:273-274` @ c246f24 |
| Milo (comparator) | da_nhoods solver / reml / max_iter / tol | pydeseq2 / True / 50 / 1e-5 | `_milo.py:464-467` @ c246f24 |

## 5. Proposed singlet approach

**Routes.** scCODA and tascCODA are ported from pertpy (licence in section 12). propeller is reimplemented with the same transforms and limma-style moderation. The naive negative binomial GLM and the pooled chi-square test are callouts, used only as benchmark comparators (section 12).

**Proposed default.** `sccoda`, with `reference_cell_type` set to `automatic`, `fdr` 0.05, NUTS at 10,000 draws after 1,000 warmup, and each sample treated as one donor. The singlet extension is an optional donor random intercept for donors contributing several libraries, off by default:

$$\log c_{s,k}=\alpha_k+x_s^{\top}\beta_k+u_{d(s),k}, \qquad u_{d,k}\sim N(0,\tau_k^2).$$

**What would falsify the default.** (i) In B1, the per-pair call rate of sccoda at four donors per arm exceeds 0.10: the default is not calibrated at this size. (ii) In B2, power at fold change 2 is below 0.6 at empirical FDR 0.10: the default is too conservative for small designs. (iii) In B3, median call-set agreement across references is below 0.8: a reference-free constraint, such as sum-to-zero, becomes the default. (iv) On a multi-library dataset, the random intercept must lower the call rate under donor permutation; otherwise it is dropped.

**ML stack and devices.** The default is a port of pertpy's JAX/NumPyro model. The donor random-intercept extension is written in PyTorch, fitted by variational inference and checked against NUTS. No hand-written CUDA kernel is planned: a Dirichlet-multinomial with up to about 100 types and tens of samples is small and CPU-bound, and permutation fits run on CPU. The device option selects JAX's device for the sccoda and tascCODA fits only.

**Kernels and streaming.** Counting is a single streaming pass that sums cells into the sample-by-type table, using memory proportional to samples times types. The fit touches only that table, so fit time does not depend on the number of cells (P1).

**Defaults without asking.** `method` sccoda, `reference_cell_type` automatic, `fdr` 0.05, `seed` 0, `sccoda.donor_key` unset, and a `dry_run` before every full fit.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obs/`sample_key` | string | Independent replicate (donor or library); the unit of inference |
| read | obs/`celltype_key` | string | Predefined cell-type label; unassigned cells are excluded |
| read | obs/`covariate_keys` | string or number | Sample-level covariates named in the formula |
| read | uns/`sample_metadata` | table, optional | Per-sample covariates not stored per cell |
| write | uns/celltype_proportion/counts | integer matrix | Sample-by-type counts used by the fit |
| write | uns/celltype_proportion/effects | table | Per type: effect, interval or p-value, PIP or adjusted p-value, call |
| write | uns/celltype_proportion/params | object | Method, reference, FDR target, acceptance rate, formula |
| write | models/celltype_proportion | object | Posterior summary; sccoda and tasccoda only |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `design` | object | required | — | Sample, cell-type and covariate keys that define the sample-by-type composition table. |
| `design.sample_key` | string | — | — | obs column of the independent replicate (donor or library). Required. |
| `design.celltype_key` | string | — | — | obs column of predefined cell-type labels. Required. |
| `design.formula` | string | — | — | Sample-level design formula, for example 'condition' or 'condition + batch'. Required. |
| `method` | string | "sccoda" | `sccoda`, `tasccoda`, `propeller` | Test to run. sccoda is the default; tasccoda needs tasccoda.tree_key; propeller is the per-type check. |
| `fdr` | number | 0.05 | max 1; > 0 | Target FDR for calls: posterior expected FDR for sccoda and tasccoda, Benjamini-Hochberg for propeller. |
| `reference_cell_type` | string | "automatic" | — | Cell type with zero effect, or automatic to let the method choose one. Ignored by propeller. |
| `sccoda` | object | — | — | Options for the sccoda method. |
| `sccoda.num_samples` | integer | 10000 | min 1 | NUTS draws after warmup. |
| `sccoda.num_warmup` | integer | 1000 | min 0 | NUTS warmup iterations. |
| `sccoda.absence_threshold` | number | 0.05 | min 0; max 1 | Maximum zero fraction allowed for an automatically chosen reference. |
| `sccoda.donor_key` | string/null | null | — | Optional donor column adding a donor random intercept for donors with several libraries (proposed extension). |
| `tasccoda` | object | — | — | Options for the tasccoda method. |
| `tasccoda.tree_key` | string/null | null | — | Name of the cell-type tree, such as a lineage or clustering hierarchy. Required when method is tasccoda. |
| `tasccoda.lambda_0` | number | 50 | — | Spike-and-slab penalty lambda_0 of the tascCODA prior. |
| `tasccoda.lambda_1` | number | 5 | — | Tree-aggregation penalty of the tascCODA prior. |
| `tasccoda.phi` | number | 0 | — | Aggregation-bias parameter for tree-level effects. |
| `tasccoda.theta` | number | 0.5 | min 0; max 1 | Global spike-and-slab mixing weight, held fixed rather than sampled. |
| `propeller` | object | — | — | Options for the propeller method. |
| `propeller.transform` | string | "logit" | `logit`, `asin` | Variance-stabilising transform of per-sample cell-type proportions. |
| `propeller.robust` | boolean | true | — | Robust empirical-Bayes variance shrinkage in the limma fit. |
| `propeller.trend` | boolean | false | — | Fit a mean-variance trend before empirical-Bayes shrinkage. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Device for the JAX-based sccoda and tasccoda fits; propeller runs on CPU. |
| `seed` | integer | 0 | min 0 | Random seed for NUTS initialisation and draws. |
| `dry_run` | boolean | false | — | Return estimated time, memory, device and model size without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules spanning parameters. `sccoda` and `tasccoda` take sample-level covariates only; `propeller()` fits a single group factor, and covariates need a custom design matrix that this tool does not expose. `tasccoda.tree_key` is required for `tasccoda`. `reference_cell_type` and `sccoda.absence_threshold` do not apply to propeller. `sccoda.donor_key` must map each sample to one donor. Groups with fewer than three samples are reported as low replication, since B1 measures calibration at four per arm.

## 7. MCP tool

Tool name `singlet_abundance_celltype_proportion_test` (definition in `tasks/mcp/singlet_abundance_celltype_proportion_test.json`). Example call and compact result (angle brackets are filled at execution):

```json
{"dataset": "/data/pbmc_donors.singlet", "design": {"sample_key": "donor", "celltype_key": "cell_type", "formula": "condition"}, "method": "sccoda", "dry_run": false}
```

```json
{"dataset": "/data/pbmc_donors.singlet", "status": "completed",
 "wrote": ["uns/celltype_proportion/counts", "uns/celltype_proportion/effects", "uns/celltype_proportion/params", "models/celltype_proportion"],
 "summary": {"method": "sccoda", "reference_cell_type": "<type>", "n_samples": "<count>", "n_cell_types": "<count>",
  "n_calls": "<count>", "expected_fdr": "<measured>", "acceptance_rate": "<measured>", "warnings": []},
 "provenance_id": "<id>", "job_id": null}
```

Long-running only for large tables: a sccoda fit on a big composition table may return `queued`. Stochastic: NUTS output depends on `seed`; propeller is deterministic. The `dry_run` estimate reports seconds, peak memory, device and model size before any fit.

## 8. Benchmarks

**Shared protocol.** Donors are the eight control aliquots of the Kang PBMC study (see B1), one sample per donor, with cell-type labels fixed before analysis and no batch correction. The main design splits them into two arms of four (35 unordered splits, $\binom{8}{4}/2$); the sensitivity design uses three per arm from six of the eight donors (280 splits, $\binom{8}{6}\binom{6}{3}/2$). Each method runs with its defaults (section 4), `seed` 0 and no tuning. Calls follow each method's rule: sccoda by expected FDR 0.05 on PIP; propeller and the naive comparator by Benjamini-Hochberg across types at $q=0.05$; the pooled test by Benjamini-Hochberg on its per-type p-values. Thresholds are proposed unless a reference is given.

### B1. Donor-permutation null on control donors

- **Goal**: measure the false-call rate per type when no condition effect exists and donors are the replicate.
- **Ground truth**: planted null by construction. The eight control donors are randomly assigned to two arms of four in each of the 35 splits; no condition effect exists among them, so every (split, type) pair is a true null. Shares as in section 3.1.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Kang et al. PBMC, control aliquots | GEO GSE96583 [R11] | 10x scRNA-seq, human PBMC, 8 donors with control and interferon-beta aliquots (16 samples) | — | Stimulated aliquots excluded from the null |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Per-pair call rate | Fraction of (split, type) pairs called by the method's rule, pooled over splits | At most 0.05 nominal; accept at most 0.10 | primary | [R10] |
| Complete-null call rate | Fraction of splits with at least one call | At most 0.10 | primary | — |
| Donor-count sensitivity | Per-pair call rate for the three-per-arm design | Report as a curve | guardrail | — |

- **Comparators**: sccoda; propeller with logit and arcsine transforms; the naive negative binomial GLM; the pooled chi-square test, a standard negative control rather than a published method. tascCODA is not compared because these data supply no tree.
- **Protocol**: all 35 four-versus-four and all 280 three-versus-three splits, one fit per split and method.
- **Acceptance criterion** (proposed): per-pair call rate of at most 0.10 for sccoda and propeller at four per arm; the pooled chi-square baseline above 0.20, which shows the benchmark detects pseudoreplication. Otherwise B1 is reported as underpowered and makes no calibration claim.
- **Known pitfalls**: the splits share eight donors, so their spread is descriptive; the per-pair rate resolves only in steps of $1/(35K)$.

### B2. Planted composition shifts by cell thinning

- **Goal**: measure power, false calls, log-ratio error and interval coverage for planted fold changes against an unchanged reference.
- **Ground truth**: planted. In each treated donor, a cell of type $k$ is kept with probability $f_k/\max_j f_j$, with $f_r=1$ for the reference and $f_k\in\{1/3,1/2,2/3,3/2,2,3\}$ for one or two other types; control donors are unchanged. The truth is $\theta_k=\log f_k$ (section 3.6), exact in expectation.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Kang control donors (as B1) | GEO GSE96583 [R11] | As in B1 | — | Arms taken from the same 35 splits |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Power | Fraction of planted (split, type) pairs called by the method's rule | Maximise | primary | — |
| Empirical FDR | Fraction of calls among unplanted non-reference types, averaged over splits | At most 0.05; accept at most 0.10 | primary | [R10] |
| Log-ratio error | Median absolute error in $\log f_k$ over planted pairs (sccoda only) | Minimise | guardrail | — |
| Interval coverage | Fraction of 95% credible intervals for $\log f_k$ containing the truth (sccoda only) | Close to 0.95 | guardrail | — |

- **Comparators**: sccoda; propeller with both transforms (power and FDR only, since its scale is not a log ratio); the naive GLM; the pooled chi-square test.
- **Protocol**: each of the 35 splits receives one thinning draw per planted configuration: one type (each non-reference type and fold change) or two types drawn with `seed` 0 from the same grid.
- **Acceptance criterion** (proposed): at four per arm and fold change 2, sccoda power of at least 0.6 at empirical FDR of at most 0.10, and interval coverage between 0.90 and 0.98. Failure revisits the default (section 5).
- **Known pitfalls**: thinning keeps donor-specific expression but makes the planted change identical across the arm; splits reuse cells, so power estimates are dependent.

### B3. Reference sensitivity on B2 draws

- **Goal**: measure how often calls change when the reference changes, and whether a sum-to-zero constraint reduces that.
- **Ground truth**: planted from B2. For each unplanted candidate reference $r'$, the truth for type $k$ is $\log(f_k/f_{r'})$, so each reference has its own truth.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B2 thinning draws | Derived from the Kang control donors [R11] | As in B2 | — | Reused; no new data |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Call-set agreement | Median over draws of the Jaccard index between call sets for every pair of references | Maximise; accept at least 0.8 | primary | — |
| Sign agreement | Fraction of types called under two references whose effect signs agree | Maximise | guardrail | — |
| Reference-specific error | Median absolute difference from $\log(f_k/f_{r'})$ | Minimise | guardrail | — |

- **Comparators**: sccoda with each unplanted type as a fixed reference; sccoda with `automatic`; a sum-to-zero constraint (singlet variant, to be implemented).
- **Protocol**: reuse the B2 draws; fix the reference set before fitting; compare all fixed references pairwise within each draw.
- **Acceptance criterion** (proposed): median call-set agreement of at least 0.8 for sccoda. The sum-to-zero variant replaces `automatic` as the default only if it raises median agreement by at least 0.1 without losing B1 calibration.
- **Known pitfalls**: choosing the reference after seeing results inflates false calls, so the set is fixed in advance. With eight donors, the reference's own sampling noise is large, and agreement is conditional on each draw.

### P1. Performance and scaling

- **Measures**: wall time of the fit and of counting, peak memory, and time to first result for NUTS fits.
- **Scales**: 10^4, 10^5 and 10^6 cells; 10, 50 and 200 samples; 10, 30 and 100 types (proposed; synthetic composition tables drawn from the B2 design).
- **Comparators**: pertpy sccoda and tasccoda; propeller in R (speckle) and the singlet reimplementation; the naive negative binomial GLM.
- **Hold fixed**: NUTS settings, seed, number of types and samples, thread count and hardware. CPU and GPU runs are reported separately, and data loading is excluded.
- **Acceptance criterion** (proposed): the reimplemented propeller runs at least five times faster than R speckle at 200 samples and 30 types on identical hardware; the sccoda fit time is unchanged, within 10%, across tenfold increases in cell number at fixed table size.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
- **Feeds**:
  - `abundance.hierarchical_composition_test`: Resolution-robust composition testing across a cell-type hierarchy
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
- **Reads**: `obs/<sample_key>`, `obs/<celltype_key>`, `obs/<covariate_keys>`, `uns/<sample_metadata>`
- **Writes**: `uns/celltype_proportion/counts`, `uns/celltype_proportion/effects`, `uns/celltype_proportion/params`, `models/celltype_proportion`
<!-- CHAINING:AUTO:END -->

Workflow: composition testing after annotation and sample QC, followed by FDR control; the composition table also feeds hierarchical composition testing.

## 10. Risks, pitfalls and open questions

- Donor scarcity: the eight control donors of Kang limit B1 and B2 to three or four per arm. The donor counts of 10 and 20 need a donor-rich dataset that has not been selected. Orthogonal-assay and cross-study checks have no dataset yet. Licences of GEO GSE96583 and of catalogue datasets are not stated in the sources used here.
- Unverified sources: the claim that propeller prefers arcsine at 10 and 20 samples per group and logit at 3 and 5 comes from a secondary summary and has not been checked against the full paper. The 2024 prototypical-cell benchmark [R15] was checked only through its abstract and a search-index summary, not the full text. scCODA's and tascCODA's own simulation designs were not checked. ANCOM-BC and ALDEx2 implementations were not reviewed, and sccomp is not in the tables.
- Propeller documentation conflicts: the help text of `getTransformedProps` says the default is `asin`, while its code and `propeller()` default to `logit`. B2 uses the code default.
- Unsettled literature: no accepted rule picks a reference when no type is known to be stable; no agreed rule sets the granularity of types; posterior expected FDR and Benjamini-Hochberg across types are not directly comparable.
- The acceptance thresholds (0.10 call rate, 0.6 power, 0.8 agreement, 0.1 gain) are not from the literature and must be set against B1 on the Kang donors before any method comparison is reported.
- First experiment: run B1 for sccoda, propeller (both transforms) and the naive comparator on the eight control donors; confirm that the pooled chi-square baseline exceeds 0.20; time the sccoda fit with `dry_run`.

## 11. References

R1. Büttner M, Ostner J, Müller CL, Theis FJ, Schubert B. scCODA is a Bayesian model for compositional single-cell data analysis. *Nature Communications* 2021. doi:10.1038/s41467-021-27150-6 — verified (corpus)
R2. Ostner J, Carcy S, Müller CL. tascCODA: Bayesian tree-aggregated analysis of compositional amplicon and single-cell data. *Frontiers in Genetics* 2021. doi:10.3389/fgene.2021.766405 — verified (corpus)
R3. Phipson B, Sim CB, Porrello ER, Hewitt AW, Powell J, Oshlack A. propeller: testing for differences in cell type proportions in single cell data. *Bioinformatics* 2022. doi:10.1093/bioinformatics/btac582 — verified (corpus)
R4. Dann E, Henderson NC, Teichmann SA, Morgan MD, Marioni JC. Differential abundance testing on single-cell data using k-nearest neighbor graphs. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01033-z — verified (corpus)
R5. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)
R6. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R7. Aitchison J. The statistical analysis of compositional data. *Journal of the Royal Statistical Society: Series B (Methodological)* 1982. doi:10.1111/j.2517-6161.1982.tb01195.x — verified (corpus)
R8. Gloor GB, Macklaim JM, Pawlowsky-Glahn V, Egozcue JJ. Microbiome datasets are compositional: and this is not optional. *Frontiers in Microbiology* 2017. doi:10.3389/fmicb.2017.02224 — verified (corpus)
R9. Ritchie ME, Phipson B, Wu D, et al. limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 2015. doi:10.1093/nar/gkv007 — verified (corpus)
R10. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B (Methodological)* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)
R11. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018. doi:10.1038/nbt.4042 — verified (corpus)
R12. Single-cell best practices, chapter "Compositional analysis" (online book), repository commit d581689, https://github.com/theislab/single-cell-best-practices. — verified (repo)
R13. Lin H, Peddada SD. Analysis of compositions of microbiomes with bias correction. *Nature Communications* 2020. doi:10.1038/s41467-020-17041-7 — verified (corpus)
R14. Fernandes AD, Reid JN, Macklaim JM, McMurrough TA, Edgell DR, Gloor GB. Unifying the analysis of high-throughput sequencing datasets: characterizing RNA-seq, 16S rRNA gene sequencing and selective growth experiments by compositional data analysis. *Microbiome* 2014. doi:10.1186/2049-2618-2-15 — verified (corpus)
R15. Yi H, Plotkin A, Stanley N. Benchmarking differential abundance methods for finding condition-specific prototypical cells in multi-sample single-cell datasets. *Genome Biology* 2024, 25:9. doi:10.1186/s13059-023-03143-0 — verified (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/pertpy | Heumos L, May L, Peidli S, Ostner J, Sturm G, Dann E, et al. (CITATION.cff) | MIT (LICENSE file); Apache Software License (pyproject.toml classifier); Apache-2.0 (CITATION.cff and README) | scCODA and tascCODA implementations (JAX/NumPyro); Milo model as comparator | port (scCODA, tascCODA); callout (Milo) |
| https://github.com/bio-datascience/tascCODA | Johannes Ostner, Christian L. Müller (setup.py) | BSD-3-Clause (LICENSE file) | Reference tascCODA code, version 0.1.3; pertpy is the maintained route | port via pertpy |
| https://github.com/phipsonlab/speckle | Belinda Phipson (aut, cre) (DESCRIPTION) | GPL-3 (LICENSE file and DESCRIPTION) | propeller transforms, limma test and defaults | reimplement; callout comparator |
| https://github.com/MarioniLab/miloR | Mike Morgan (aut, cre), Emma Dann (aut, ctb) (DESCRIPTION) | GPL-3 + file LICENSE (DESCRIPTION) | Reference Milo implementation in R; the comparator uses pertpy's port | callout only |
