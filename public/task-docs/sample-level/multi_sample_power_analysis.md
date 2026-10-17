---
id: sample-level.multi_sample_power_analysis
title: Power and sample-number planning for multi-sample designs
area: sample-level
scope: extended
paradigm: model-based
literature_status: open
priority: P1
depends_on: [qc.sample_level_qc, annotation.cluster_label_assignment]
feeds: [markers-de.replicate_aware_condition_de, sample-level.sample_phenotype_prediction, statistics.sequencing_depth_planning]
reads: [layers/counts, obs/<donor_key>, obs/<condition_key>, obs/<cell_type_key>]
writes: [uns/power_planning/design_grid, uns/power_planning/power_curves, uns/power_planning/required_donors, uns/power_planning/cost_optimal_cells, var/donor_variance, var/dispersion]
devices: [cpu, cuda]
mcp_tool: singlet_sample_level_multi_sample_power_analysis
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Power and sample-number planning for multi-sample designs

> Plans how many donors per condition and how many cells per donor a study needs to detect a donor-level effect in one cell type, at a target power and false discovery rate, from a pilot's variance estimates.

## 1. Question

For one cell type and a two-level condition, how many donors per group and how many cells per donor are needed to detect a stated donor-level log2 fold change at a target mean power, with FDR controlled at q across genes? Inputs are pilot raw counts with donor, condition and cell-type labels, plus the effect grid and optional costs. Outputs are power curves over the grid, the smallest donor count per group that reaches the target for each cells-per-donor value, and, given costs, the cell count per donor that minimises cost. A correct answer is a design whose realised power and FDR under the planned pseudobulk test match the prediction within the tolerances of section 8.

## 2. Why this task matters and where the field stands

In a multi-donor study the donor is the replicate. Cells from one donor share genotype, batch and handling, so cell-level tests treat correlated observations as independent and inflate false discoveries [R1, R2]. The donor count therefore sets most of the power, and cells per donor help only until donor-to-donor variation dominates (section 3). A design needs an estimate of that variation before sequencing, which a pilot provides.

Two families of planning tools exist. Analytic tools compute power from a negative-binomial (NB) model of donor pseudobulk and solve the significance threshold numerically; scPower is the published analytic example [R5]. Simulation tools fit a generative model to pilot counts, simulate planted designs and score a chosen DE test; powsimR [R6], POWSC [R7] and the muscat simulator [R8] belong here. Donor-level (pseudobulk) analysis is the standard for the planned test because it keeps nominal FDR [R1, R3, R4]. Mixed models on pseudobulk are a second donor-level route [R9].

Status: open. The central question is whether predicted power matches achieved power; section 8 defines the checks that answer it.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $\nu$ | gene's mean log expression (natural log) |
| $n_0, n_1$ | donors in each condition |
| $m$ | cells per donor |
| $\sigma_b^2$ | between-donor variance of mean log expression (natural log) |
| $\sigma_w^2$ | within-donor variance of single-cell log expression (natural log) |
| $\delta$ | planted contrast, $\ln 2\cdot\log_2\mathrm{FC}$ |
| $\mu_g$, $\phi$ | donor pseudobulk mean (sum over cells) and donor-scale NB dispersion |
| $\alpha^\star$, $q$ | planning per-gene threshold; target FDR |

Donor $i$, in condition $k(i)\in\{0,1\}$, has a mean log expression over its $m$ cells of one gene. With cells exchangeable within a donor, a two-level model describes it:

$$
y_i=\nu+\delta\,k(i)+b_i+\bar\varepsilon_i,\qquad b_i\sim\mathcal N(0,\sigma_b^2),\qquad \bar\varepsilon_i\sim\mathcal N(0,\sigma_w^2/m)
$$

Regime: donors independent, normal approximation on the log scale, one effect shared by all donors (no donor-by-condition interaction). The contrast of donor means then has variance

$$
\operatorname{Var}(\hat\delta)=\Big(\sigma_b^2+\frac{\sigma_w^2}{m}\Big)\Big(\frac1{n_0}+\frac1{n_1}\Big)
$$

to first order, for balanced groups. The two-sided Wald power is $\pi(\delta)\approx\Phi(|\delta|/\mathrm{SE}-z_{1-\alpha/2})$, with the opposite tail ignored. For balanced groups of $n$ donors the required size is

$$
n\approx\frac{2\,(z_{1-\alpha/2}+z_{1-\beta})^2\,(\sigma_b^2+\sigma_w^2/m)}{\delta^2}
$$

Regime: large $n$, and $\delta$ small relative to SE. As $m\to\infty$ the size approaches a floor, $2(z_{1-\alpha/2}+z_{1-\beta})^2\sigma_b^2/\delta^2$, which no number of cells can lower. Cells help only while $\sigma_w^2/m$ is comparable to $\sigma_b^2$, so donor number is the binding design variable.

Pseudoreplication. With $\rho=\sigma_b^2/(\sigma_b^2+\sigma_w^2)$, the design effect of cells within a donor is $\mathrm{DEFF}(m)=1+(m-1)\rho$. A cell-level test that treats all $nm$ cells as independent has variance smaller by exactly this factor, so it overstates information by $\mathrm{DEFF}(m)$ [R1, R2]. Regime: equal cells per donor, with $\rho$ estimated on the pilot.

Allocation. With a fixed target variance and cost $C=n(c_d+mc_c)$, cost is minimised at

$$
m^\star=\sqrt{\frac{c_d\,\sigma_w^2}{c_c\,\sigma_b^2}}
$$

Regime: interior optimum ($m^\star\ge1$), linear cost, known variance components. The unit costs cannot be identified from the pilot and must be supplied.

NB form. For donor sums, a log-link NB GLM [R10, R11] gives each donor the Fisher weight $\mu/(1+\mu\phi)$, so the log fold change has variance

$$
\operatorname{Var}(\hat\beta_1)\approx\frac1{n_0}\Big(\frac1{\mu_0}+\phi\Big)+\frac1{n_1}\Big(\frac1{\mu_1}+\phi\Big)
$$

where $\mu_g$ is the donor sum mean and $\phi$ the donor-scale dispersion, which contains $\sigma_b^2$. Regime: about 5 or more donors per group, large $\mu_g$ so the Poisson term is not dominant, constant $\phi$ across donors. The donor-level design matrix follows [R12].

FDR threshold. For a per-gene threshold $\alpha^\star$, with $m_0$ null genes and planted set $D$,

$$
\mathrm{E}[\mathrm{FDP}(\alpha^\star)]\approx\frac{m_0\,\alpha^\star}{m_0\,\alpha^\star+\sum_{g\in D}\pi_g(\alpha^\star)}
$$

and the planning threshold is the $\alpha^\star$ at which this equals $q$. Regime: independent tests and a fixed per-gene threshold. It is the expected-FDP approximation for one fixed per-gene threshold under independence; the same root equation appears in scPower's `fdr.optimization`. BY control of the planned design is checked in section 8.

Estimands, one sentence each:

- Per-gene power $\pi_g$ is the probability that gene $g$ is called at $\alpha^\star$ with the correct sign; it lies in $[0,1]$ and is defined per gene.
- Design power is the unweighted mean of $\pi_g$ over the planted set $D$, or over its testable subset $D_K$ in section 8.
- Required donors $n$ are donors per group, not total donors, and are the smallest integer whose design power reaches the target.
- $m^\star$ is cells per donor on the continuous scale; the planner reports the integer nearest to it, and at least 1.
- Realised FDR is the mean over replicates of $\mathrm{FP}_r/\max(1,R_r)$, where $R_r$ counts all rejections, not null genes.
- Empirical power is, per replicate, the number of true positives divided by $|D_K|$, averaged over replicates.
- $\sigma_b^2$, $\sigma_w^2$ and $\phi$ are per gene on the natural-log scale; $\delta$ is $\ln 2$ times the log2 fold change.

Assumptions and failure modes by method family. The analytic family (nb_analytic) is asymptotic. It overstates power when pilot effect sizes are reused as planted effects (winner's curse), when donor-by-condition heterogeneity dilutes the mean effect, and at 3 or fewer donors per group, where p-values are discrete and BY is conservative. The simulation family reproduces only the donors in the pilot, so it cannot generate donor structure beyond them, and validating it on the same pilot is circular. Both families share three risks: $\sigma_b^2$ and $\phi$ from few donors are noisy; composition shifts make cell counts per donor random; batch confounded with condition inflates $\sigma_b^2$.

Why model-based. An explicit likelihood gives per-gene uncertainty, reuse across cell types and cohorts, and an explicit cost trade-off. Donor-first heuristics agree with the floor above but give no number without $\sigma_b^2$. Pitfalls shown by benchmarks: cell-level analyses inflate FDR in donor-structured data [R1, R2]. Pseudobulk and mixed-model methods outperformed naive cell-level tests [R4], and pseudobulk methods performed best in a re-analysis of the Zimmerman benchmark [R3].

## 4. Methods landscape

Pseudobulk donor-level analysis is the published standard for the planned test [R1, R2], so the planned test is a donor-level NB GLM. The published analytic tool is scPower [R5]; the published simulation tool is powsimR [R6]. POWSC [R7] and muscat [R8] are simulation alternatives. Rule-of-thumb donor counts are a practical fallback. The rule-of-thumb form has no number that accounts for the pilot's donor variance.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scPower analytic NB power | model-based | analytic NB-based two-group power per gene; significance threshold solved numerically (`uniroot` on `fdr.optimization`) so expected FDR meets the target | [R5] |
| powsimR | model-based | mean, dispersion and dropout distributions fitted to pilot counts, counts simulated from their empirical relations; simulated designs scored by TPR and FDR of a chosen DE method | [R6] |
| POWSC | model-based | parameter estimation, simulation and power assessment from pilot data | [R7] |
| muscat simData | model-based | per-gene NB dispersions from edgeR `estimateDisp` and sample-specific means from a reference (`prepSim`); NB counts with planted differential states | [R8] |
| Pseudobulk NB GLM (DESeq2) | model-based | donor sums per cell type, NB GLM with donor-level design, Wald test | [R10] |
| dreamlet | model-based | precision-weighted linear mixed models on pseudobulk with random effects for repeated measures | [R9] |
| Rule-of-thumb donor counts | heuristic | prefer donors over cells per donor; extra cells per donor add little power across individuals | [R2, R13] |

Defaults taken from source, for values this task adopts:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| Donor-sample filter | min cells per donor sample | 10 | src/decoupler/pp/anndata.py:442 @ 3132edc |
| Donor-sample filter | min counts per donor sample | 1000 | src/decoupler/pp/anndata.py:443 @ 3132edc |
| Evaluation | multiple-testing correction | BY | R/Evaluate.R:445 @ d9e49ac (powsimR) |
| scPower | donor ratio between groups | 1 (balanced) | R/power.R:1881 @ 82039da |
| Pilot filtering | min_count, min_cells, min_genes, min_size | 1, 10, 100, 100 | R/prepSim.R:80-83 (muscat 1.26.0) |

## 5. Proposed singlet approach

Routes. nb_analytic is **reimplemented** from the equations of section 3; scPower's code is not ported. The simulation method is **reimplemented** from the muscat-style pilot fit. The planned pseudobulk NB GLM is implemented in singlet. DESeq2, dreamlet, powsimR, POWSC and the muscat simulator are **callouts**, used only as benchmark comparators or generators. The donor-sample filter constants are **ported** as values (port, constants only). Licences are in section 12.

Model. For each gene, the pilot gives $\hat\sigma_b^2$ (method of moments on donor means, truncated at zero) and $\hat\phi$ (NB dispersion of donor sums). Design power is evaluated in closed form over a grid of donors per group, cells per donor and fold change. $\alpha^\star$ is found by bisection so that the planning FDR equals $q$. The reported design is the smallest $n$ whose mean power over $D$ reaches the target.

Falsification. nb_analytic is rejected for a regime if B2's mean absolute calibration error exceeds 0.05 at designs with at least 6 donors per group, or if B1's realised FDR exceeds 0.07 at 5 or more donors per group. The simulation method then becomes the default for that regime. Shrinkage of $\hat\sigma_b^2$ and $\hat\phi$ across genes (empirical Bayes) is the planned remedy for noisy pilots and is outside v1.

ML stack. v1 has no deep network. Power over genes times design points is elementwise and the threshold solve is batched bisection; both are small hot kernels for CUDA, hard-coded in CUDA. Pseudobulk aggregation is a sparse product of a cell-to-donor indicator with the counts, mapped to cuSPARSE. Batched IRLS for the simulation method is a CUDA candidate. A PyTorch surrogate that predicts power from design features, trained on simulated labels, is optional for a later version.

Devices and streaming. CPU and CUDA paths share one specification; the CUDA path is the default when memory allows. Aggregation can be chunked over cells, but streaming is not claimed for v1.

Defaults an agent should use without asking: method nb_analytic, target power 0.8, FDR 0.05 under BY, the grid in section 6, and the filters of section 4.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, one row per cell |
| read | obs/<donor_key> | string | donor identifier per cell |
| read | obs/<condition_key> | string | two-level condition, constant within donor |
| read | obs/<cell_type_key> | string | cell-type label of the planned cell type |
| write | uns/power_planning/design_grid | table | design points with donors, cells per donor, fold change and prop_de |
| write | uns/power_planning/power_curves | table | design power by design point (analytic, or simulated for method simulation) |
| write | uns/power_planning/required_donors | table | smallest donors per group at the target, per cells per donor |
| write | uns/power_planning/cost_optimal_cells | float | cells per donor minimising cost, when costs are given |
| write | var/donor_variance | float32 per gene | $\hat\sigma_b^2$ on the natural-log scale |
| write | var/dispersion | float32 per gene | donor-scale NB dispersion $\hat\phi$ |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Pilot dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `design` | object | — | — | Donor, condition and cell-type keys of the pilot, and the cell type to plan for. |
| `design.donor_key` | string | "donor" | — | obs column giving the donor identifier of each cell. |
| `design.condition_key` | string | "condition" | — | obs column with two condition levels, constant within donor. |
| `design.cell_type_key` | string | "cell_type" | — | obs column with cell-type labels. |
| `design.cell_type` | string | — | — | Cell type to plan for; must occur in at least two donors per condition. |
| `method` | string | "nb_analytic" | `nb_analytic`, `simulation` | nb_analytic: closed-form power (default). simulation: planted-effect simulation from the pilot; slower. |
| `target_power` | number | 0.8 | > 0; < 1 | Mean per-gene power over planted DE genes that the design must reach. |
| `fdr` | number | 0.05 | max 0.5; > 0 | Target FDR under BY control; the planning threshold is solved to meet it. |
| `scenario` | object | — | — | Planned effects and grids. |
| `scenario.effect_log2fc` | array | [0.5, 1, 2] | — | Absolute donor-level log2 fold changes to evaluate. |
| `scenario.prop_de` | number | 0.1 | max 1; > 0 | Fraction of filtered genes assumed differentially expressed. |
| `scenario.donors_per_group` | array | [3, 5, 8, 12, 16, 20] | — | Donor counts per condition to evaluate. |
| `scenario.cells_per_donor` | array | [50, 200, 1000, 5000] | — | Cells per donor to evaluate. |
| `nb_analytic` | object | — | — | Options for method nb_analytic. |
| `nb_analytic.cost_donor` | number | — | min 0 | Cost per donor; with cost_cell gives the cost-optimal cells per donor. |
| `nb_analytic.cost_cell` | number | — | min 0 | Cost per cell; with cost_donor gives the cost-optimal cells per donor. |
| `simulation` | object | — | — | Options for method simulation. |
| `simulation.n_replicates` | integer | 50 | min 1 | Simulated replicates per design point; cost scales linearly. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `seed` | integer | 0 | — | Random seed for simulation replicates; nb_analytic is deterministic. |
<!-- PARAMS:AUTO:END -->

Rules across parameters. The design object applies to both methods. The nb_analytic object is read only by that method, and the simulation object only by method simulation. scenario.prop_de sets the planted or assumed DE fraction for both methods. cost_donor and cost_cell must be given together; alone, neither yields an allocation optimum. Effects are absolute and converted to the natural-log scale. Donor counts below 3 per group are accepted but flagged as outside the asymptotic regime.

## 7. MCP tool

Tool name `singlet_sample_level_multi_sample_power_analysis` (definition in `tasks/mcp/singlet_sample_level_multi_sample_power_analysis.json`). Example call and compact result:

```json
{"dataset": "pilot.singlet", "design": {"cell_type": "CD14 Monocytes"},
 "scenario": {"effect_log2fc": [1.0], "donors_per_group": [3, 5, 8, 12], "cells_per_donor": [200, 1000]}}
```

```json
{"dataset": "pilot.singlet", "status": "completed",
 "wrote": ["uns/power_planning/design_grid", "uns/power_planning/required_donors"],
 "summary": {"cell_type": "CD14 Monocytes", "alpha_star": "<float>",
   "required_donors_per_group": {"200": "<int>", "1000": "<int>"},
   "cost_optimal_cells": null},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: method simulation returns status queued with a job_id when the replicate-by-grid cost exceeds the inline limit; nb_analytic completes inline. Stochastic: only simulation uses the seed. Dry run: returns an estimate of seconds, peak memory and device, and writes nothing.

## 8. Benchmarks

**Shared protocol.** Every benchmark uses the planned pseudobulk NB GLM on donor sums per cell type, a donor-level design and a Wald test, with Benjamini-Yekutieli (BY) control at q = 0.05. Genes are filtered by the donor-sample rules of section 4. Replicates draw fresh donors with seeds 1 to R. muscat simData caps the donor count at the reference (`floor(n/2)` per group when `dd = TRUE`, `paired = FALSE`) unless `force = TRUE` (simData.R:22-23). Effects are log2 fold changes; the models use natural logs. Hardware and library versions are reported with each result.

### B1. Null calibration of the planned pseudobulk test

- **Goal**: check that the planned test controls realised FDR at q across donor and cell counts, extending the donor-level null designs of [R1, R2] to planning grids.
- **Ground truth**: consistency under the null, by construction; no effect is planted, and every gene is null. Realised FDR is defined per replicate and averaged (below).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Null simulation from one reference | recipe 1 to 3 below; reference with at least 24 donors | scRNA-seq; species of the reference; 2n donors per design | see section 12 | Null by construction |

Recipe. (1) Fit the muscat prepSim model to the reference, per gene. (2) For each replicate, simulate with dd = FALSE, keep 2n donors at random and assign n to each condition at random. (3) Run the planned test on the chosen cell type and record rejections at BY q = 0.05 and raw p-values.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| realised FDR | mean over replicates of FP_r / max(1, R_r); FP_r is null genes rejected, R_r all rejections | at or below q | primary | [R1, R2] |
| null type I rate | fraction of null genes with raw p at or below 0.05, averaged over replicates; p = 1 is no rejection | toward 0.05 or below | guardrail | [R1] |

- **Comparators**: the planned NB GLM (singlet); DESeq2 Wald on the same donor sums [R10] (callout); dreamlet on the same pseudobulk [R9] (callout); the cell-level two-group test of markers-de.cell_level_two_group_de on the same cells, as the negative control expected to exceed q.
- **Protocol**: donors per group n in {3, 5, 8, 12}; cells per donor m in {50, 200, 1000}; R = 100 replicates per design.
- **Acceptance criterion** (singlet-set; section 10). Mean realised FDR at most 0.07 for designs with at least 5 donors per group and at least 50 cells per donor; the cell-level comparator is expected to exceed 0.07 in those designs.
- **Known pitfalls**: at 3 donors per group p-values are discrete and BY is conservative, so the nominal level is an upper bound rather than an estimate. Simulated donors reuse reference profiles, so realised FDR may look better than in a real cohort.

### B2. Planted-effect calibration of predicted power

- **Goal**: test whether predicted power from nb_analytic and from the simulation method matches the empirical power of the planned test across fold changes and designs.
- **Ground truth**: planted simulation. The planted set $D$ is a random fraction prop_de of the filtered genes, fixed before testing and never defined from test results. Each gene in $D$ gets one fold change from the grid. Empirical power is the per-replicate ratio $\mathrm{TP}/|D_K|$, averaged, where $K$ holds genes with mean count of at least 1 in one group.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pilot donors (planner input) | a donor-annotated catalogue subset with at least 8 donors per condition | scRNA-seq; species of the subset | — | Supplies $\hat\sigma_b^2$, $\hat\phi$ and mean counts |
| Test counts (generator) | a second, disjoint donor-annotated subset with at least 40 donors, fitted with muscat simData | scRNA-seq; species of the subset; 20 donors per group | see section 12 | Disjoint from the pilot |

Recipe. (1) From the pilot, compute planner inputs for the cell type, for both methods. (2) Fit muscat simData to the generator subset with dd = TRUE, and plant fold changes 2^x for x in {0.5, 1, 2} on the set $D$. (3) For each design, sample n donors per group, run the planned test and record the TP count on $D_K$.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| empirical power | TP divided by $\lvert D_K\rvert$, per replicate, averaged | maximise | primary | [R5, R6] |
| predicted power | mean over $D_K$ of $\pi_g$ at the design, with $\alpha^\star$ from the section 3 FDR approximation | reference value | primary | [R5, R6] |
| calibration error | absolute difference of predicted and empirical power, reported as mean and maximum over the design grid | minimise | primary | — |
| realised FDR | as in B1, on the same replicates | at or below q | guardrail | [R1] |

- **Comparators**: nb_analytic and the simulation method (singlet); scPower analytic power [R5] (callout); powsimR simulation with edgeR-QL and DESeq2 as the analysis [R6] (callout); POWSC with default settings [R7] (callout).
- **Protocol**: donors per group in {3, 5, 8, 12, 20}; cells per donor in {50, 200, 1000}; log2 fold change in {0.5, 1, 2}; prop_de = 0.1; 50 replicates.
- **Acceptance criterion** (singlet-set; section 10). Mean absolute calibration error at most 0.05 over design points with at least 6 donors per group, and maximum error at most 0.10.
- **Known pitfalls**: pilot and test donors must be disjoint or agreement is inflated. The simulator's fold-change base must be checked against a planted value before the grid is simulated, because natural-log and log2 scales differ by $\ln 2$. Low-expressed genes have discrete power; restricting to $K$ keeps the comparison where the approximations hold.

### B3. Allocation recovery against known variance components

- **Goal**: check that the planner recovers the cost-optimal cells per donor and the donor count when variance components and costs are known.
- **Ground truth**: planted simulation. $\sigma_b^2$, $\sigma_w^2$, $c_d$, $c_c$ and $\delta$ are set by construction. $m^\star$ is the continuous value from the section 3 formula at true parameters. $n_{\text{oracle}}$ is the smallest $n$ per group whose empirical power at $m=\mathrm{round}(m^\star)$ is at least 0.8, estimated from 1000 simulated tests per $n$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Gaussian donor-level simulation | recipe 1 to 4 below | synthetic; $n$ per group from the grid | — | Tests the variance algebra, not the NB approximation |

Recipe. (1) Set $\sigma_w^2=1$, $\sigma_b^2/\sigma_w^2\in\{0.1,1,10\}$, $c_c=1$, $c_d\in\{1,10\}$, $\delta=0.5$. (2) For each replicate, draw $P\in\{3,8\}$ donors per group, each with 100 cells, and set $y_{ic}=\delta\,k(i)+b_i+e_{ic}$ with $b_i\sim\mathcal N(0,\sigma_b^2)$ and $e_{ic}\sim\mathcal N(0,\sigma_w^2)$. (3) Estimate $\hat\sigma_w^2$ as the pooled within-donor variance and $\hat\sigma_b^2$ as the within-condition variance of donor means minus $\hat\sigma_w^2/100$, truncated at zero. The planner sets $\hat m=\mathrm{round}(m^\star(\hat\sigma))$ and $\hat n=\lceil n_{\text{required}}(\hat m,\hat\sigma,\delta)\rceil$. (4) Compute $n_{\text{oracle}}$ with a Wald test on donor means at alpha 0.05.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| relative error in m | $\lvert\hat m-m^\star\rvert/m^\star$ | minimise | primary | — |
| relative error in n | $\lvert\hat n-n_{\text{oracle}}\rvert/n_{\text{oracle}}$ | minimise | primary | — |

- **Comparators**: analytic planning from section 3 at pilot estimates (singlet); $n_{\text{oracle}}$ as the reference for the donor count.
- **Protocol**: 12 settings (three variance ratios, two cost ratios, two pilot sizes) with 100 replicates each; seeds 1 to 100.
- **Acceptance criterion** (singlet-set; section 10). Relative error in $n$ at most 0.25, and $\hat m$ within a factor of 2 of $m^\star$, when the pilot has at least 8 donors per group.
- **Known pitfalls**: cost constants are inputs, so error in them passes directly into $m^\star$. Variance estimates from 3 donors are biased, and $\sigma_w^2$ includes depth-dependent technical noise, so the sequencing depth must be fixed and stated.

### P1. Performance and scaling

Wall time and peak memory for three workloads, on CPU and CUDA: (a) the closed-form grid over $G\in\{10^3,10^4,3\times10^4\}$ genes and $D\in\{10^2,10^4\}$ design points, including the threshold solve; (b) the simulation method with $R\in\{20,100\}$ replicates; (c) donor-by-cell-type aggregation of 10k, 100k and 1M cells followed by donor-level NB fits on the planning grid. Comparators: scPower [R5], powsimR [R6] and POWSC [R7] as R tools, and the singlet CPU and CUDA closed-form paths. Hold fixed: $\alpha$ and $q$, the design grid, the DE test used by the simulation method, $R$, and BY. Report hardware and library versions, and whether the threshold solve is included. Runtime targets are set after the first measurements.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Feeds**:
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
  - `sample-level.sample_phenotype_prediction`: Sample-level phenotype prediction from single-cell profiles
  - `statistics.sequencing_depth_planning`: Sequencing depth and cell-number sufficiency for cell-type and marker recovery
- **Reads**: `layers/counts`, `obs/<donor_key>`, `obs/<condition_key>`, `obs/<cell_type_key>`
- **Writes**: `uns/power_planning/design_grid`, `uns/power_planning/power_curves`, `uns/power_planning/required_donors`, `uns/power_planning/cost_optimal_cells`, `var/donor_variance`, `var/dispersion`
<!-- CHAINING:AUTO:END -->

Sits in the design stage of a multi-sample study: after donor-level QC and cell-type labelling, and before the planned condition test and donor-level phenotype prediction.

## 10. Risks, pitfalls and open questions

- **Evidence gaps**: the FDR approximation in section 3 has the same root equation as scPower's `fdr.optimization` (R/power.R:1928, DE branch), but the donor-level model inside `power.de` was not re-derived. muscat's donor-mean inheritance from the reference was read in its documentation only. The decoupler filter lines were read in a local copy without git metadata (repository HEAD 3132edc at check time). The corpus record for dreamlet is the 2023 preprint; the article DOI comes from the repository README. The author lists of the dreamlet article and of the best-practices chapter (R13) are not in the sources used; POWSC authors are from its DESCRIPTION.
- **Unsettled literature**: no published benchmark compares planned with achieved power or realised FDR for donor-level planning across tools. Sum versus mean pseudobulk aggregation is unsettled [R3]. Donor-by-condition heterogeneity is absent from every formula above, and the rule-of-thumb donor count has no validated numeric form.
- **Technical risks**: the shared risks of section 3 apply, and composition makes $m$ random in practice. Transfer of pilot parameters across tissues, protocols and depths is untested.
- **Data and reuse risks**: the reference subsets for B1 to B3 are not yet chosen. Sources with copyleft or conflicting terms (section 12) are reimplemented or used as comparators, never ported; powsimR stays a callout until its terms are resolved.
- **Deferred benchmark and generator**: the donor-subsampling check (predicted recall for n donors against consensus DE from disjoint donors) has no dataset selected; it needs a donor-rich catalogue subset with about 40 donors and two conditions. A second, independent generator family is unspecified, and its parameter estimator has not been read.
- **Defaults**: target power 0.8 and FDR 0.05 are conventional choices, not literature values.
- **First experiment**: on one donor-annotated pilot with at least 8 donors per condition, compare nb_analytic predictions with muscat-simulated empirical power for one cell type over the B2 grid, before any CUDA work. This tests the variance-estimate link on which every other result depends.

## 11. References

R1. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)

R2. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)

R3. Murphy AE, Skene NG. A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nature Communications* 2022. doi:10.1038/s41467-022-35519-4 — verified (corpus)

R4. Junttila S, Smolander J, Elo LL. Benchmarking methods for detecting differential states between conditions from multi-subject single-cell RNA-seq data. *bioRxiv* 2022 (preprint). doi:10.1101/2022.02.16.480662 — verified (corpus)

R5. Schmid KT, et al. scPower accelerates and optimizes the design of multi-sample single cell transcriptomic studies. *Nature Communications* 2021. doi:10.1038/s41467-021-26779-7 — verified (corpus)

R6. Vieth B, et al. powsimR: power analysis for bulk and single cell RNA-seq experiments. *Bioinformatics* 2017. doi:10.1093/bioinformatics/btx435 — verified (repo)

R7. Su K, et al. Simulation, power evaluation, and sample size recommendation for single cell RNA-seq. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa607 — verified (corpus)

R8. Crowell HL, Soneson C, Germain PL, et al. muscat detects subpopulation-specific state transitions from multi-sample multi-condition single-cell transcriptomics data. *Nature Communications* 2020. doi:10.1038/s41467-020-19894-4 — verified (corpus)

R9. Hoffman G, et al. Efficient differential expression analysis of large-scale single-cell transcriptomics data using dreamlet. *Nature Communications* 2026. doi:10.1038/s41467-026-75680-8 (preprint doi:10.1101/2023.03.17.533005) — verified (repo)

R10. Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. *Genome Biology* 2014. doi:10.1186/s13059-014-0550-8 — verified (corpus)

R11. Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. *Bioinformatics* 2010. doi:10.1093/bioinformatics/btp616 — verified (corpus)

R12. Law CW, Zeglinski K, Dong X, et al. A guide to creating design matrices for gene expression experiments. *F1000Research* 2020. — verified (corpus)

R13. Single-cell best practices (Jupyter Book), differential gene expression analysis, conditions chapter. https://github.com/theislab/single-cell-best-practices — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/heiniglab/scPower | Katharina Schmid, Barbara Hoellbacher (aut); Matthias Heinig (cre, aut) | GPL-3 (DESCRIPTION; no LICENSE file at root) | analytic NB power and FDR threshold | reimplement (equations of section 3) |
| https://github.com/bvieth/powsimR | Beate Vieth (Author field) | Artistic-2.0 (LICENSE.md); DESCRIPTION states GPL | simulation comparator; BY default | callout |
| https://github.com/suke18/POWSC | Kenong Su (aut, cre); Hao Wu (aut) | GPL-2 (DESCRIPTION; no LICENSE file at root) | simulation comparator | callout |
| https://github.com/HelenaLC/muscat | Helena L. Crowell (aut, cre) and 7 further authors | GPL-3 (DESCRIPTION; no LICENSE file at root) | pilot-fitted generator; prepSim filters | reimplement (simulation method); callout (benchmark generator) |
| https://github.com/mikelove/DESeq2 | Michael Love (aut, cre); Simon Anders, Wolfgang Huber (aut, ctb) and others | LGPL (>= 3) (DESCRIPTION; no LICENSE file at root) | Wald comparator on donor sums | callout |
| https://github.com/DiseaseNeurogenomics/dreamlet | Gabriel Hoffman (aut, cre) | Artistic-2.0 (DESCRIPTION; no LICENSE file at root) | mixed-model comparator | callout |
| https://github.com/scverse/decoupler | Pau Badia i Mompel (author, maintainer) | BSD-3-Clause (LICENSE) | donor-sample filter constants | port (constants only) |
