---
id: perturbation.knockdown_efficacy
title: On-target knockdown efficacy per guide or perturbation
area: perturbation
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [perturbation.guide_assignment, normalization.size_factor_estimation, ambient.profile_estimation, ambient.contamination_fraction]
feeds: [perturbation.perturbation_effect_estimation, perturbation.escaper_classification]
reads: [layers/counts, layers/log1p_norm, obs/assigned_guide, obs/size_factor, obs/<replicate_key>, obs/ambient_frac_<method>, varm/ambient_profile_<sample>, var/<feature_key>, uns/guide_to_target]
writes: [uns/knockdown_efficacy, obs/knockdown_score, models/knockdown_glm]
devices: [cpu, cuda]
mcp_tool: singlet_perturbation_knockdown_efficacy
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# On-target knockdown efficacy per guide or perturbation

> Estimate how far each guide lowers (or raises) its own target gene relative to non-targeting cells, with an interval, and flag guides whose knockdown is not established.

## 1. Question

How far does each guide reduce (CRISPRi, CRISPRko) or raise (CRISPRa) the expression of its own target gene relative to non-targeting (NT) cells, and how uncertain is that estimate? The input is raw target-gene counts, per-cell single-guide assignments, replicate labels and NT cells. The output is a per-guide knockdown fraction $k_g$ with an interval, a per-target summary and a weak-guide flag. A correct answer has an interval that covers the planted or independently measured knockdown at the nominal rate.

## 2. Why this task matters and where the field stands

Per-guide efficacy decides whether a phenotype can be attributed to the target gene. Pooled Perturb-seq links each guide to single-cell transcriptomes [R1], and genome-scale designs apply the same logic [R2]. A guide that does not repress its target gives no informative contrast, and a weak guide inflates the apparent heterogeneity among guides of one target.

The task is **contested**.

- No per-guide ground truth is available in the corpus. The simplest estimator, a pseudocount log ratio against NT cells, gives a point value with no interval (section 3).
- Mixscape converts the question into a class. In the best-practices chapter it calls about three quarters of the cells of five targets perturbed, while most cells of other targets are not [R3]. A class fraction is not a knockdown fraction.
- Mixscale replaces the class with a continuous score, which the rapids-singlecell Mixscale docstring describes for CRISPRi screens with graded perturbation strength [R5] [R6]. Its unit is a standard deviation of NT projections.
- Penalised regression shrinks guide coefficients toward zero, so MIMOSCA-type coefficients are not calibrated efficacies [R7].
- Replicate-aware aggregation addresses pseudoreplication in single-cell differential expression [R8], and the chapter applies a replicate-blocked pseudobulk design [R3].

Open problems are the ambient target transcripts that attenuate every estimate (section 3), whether transcript loss from a CRISPRko allele reflects protein loss, the spread of CRISPRi repression to neighbouring genes, and whether efficacy belongs to each guide or to each target when guides differ in activity. Titrated series of attenuated guides give a graded design [R9].

## 3. Theory and insight

**Notation and estimands.** Each output is defined for guide $g$ with target gene $t$. All means are of size-factor-normalised counts.

| Symbol | Meaning |
|---|---|
| $s_c$, $S_{gr}$ | size factor of cell $c$; sum of size factors in guide group $g$ and replicate $r$ |
| $\lambda_r$ | NT non-ambient mean of the target per unit size factor in replicate $r$ |
| $\bar a_{gr}$ | expected ambient count of the target per unit size factor in that group |
| $\varepsilon$ | ambient share of target counts in NT cells, $\bar a/(\lambda+\bar a)$ |
| $\phi_t$ | negative-binomial dispersion of target $t$ |

- $\beta_g$ is the natural-log ratio of the non-ambient mean in cells with guide $g$ to that in NT cells, conditional on covariates; $\beta_{\mathrm{NT}}=0$.
- $k_g=1-e^{\beta_g}$ is the fraction of that mean removed by $g$; $k_g<0$ means activation. It is a fraction of transcript expression, not of protein.
- $\ell_g=\log_2\frac{\bar x_g+c}{\bar x_{\mathrm{NT}}+c}$ is the pseudocount log ratio with pseudocount $c$. It approximates $\beta_g/\ln 2$ when $c$ is small against the means.
- MIMOSCA coefficients and Mixscape projections are in the units of the supplied matrix, Mixscale scores are in NT standard deviations, and a Mixscape KO fraction is a class fraction. None of these estimates $k_g$ without a further map.
- Ground truth in the benchmarks is zero by construction (B1) or the planted $k$ of the simulator's ambient-free mean (B2).

**Mean model.** For pseudobulk counts $Y_{gr}$ of the target,

$$Y_{gr}\sim\mathrm{NB}(\mu_{gr},\phi_t),\qquad \mu_{gr}=S_{gr}\big(\lambda_r\,e^{\beta_g}+\bar a_{gr}\big),$$

with $\beta_{\mathrm{NT}}=0$. Without the ambient term ($\bar a=0$) this is a log-linear negative-binomial model with offset $\log S_{gr}$ and a replicate term, the form of the chapter's pseudobulk design [R3] [R10]. Regime: cells in one replicate are conditionally independent given $\lambda_r$; $\phi_t$ is stable; Wald intervals are approximate when pseudobulk counts are small; with few replicates the replicate term dominates the uncertainty.

**Ambient attenuation.** If guide identity does not change ambient counts, the expected ratio of guide to NT means under a log-linear fit is

$$\frac{\mathbb E[x\mid g]}{\mathbb E[x\mid \mathrm{NT}]}=\frac{(1-k)\lambda+\bar a}{\lambda+\bar a}=1-k\,(1-\varepsilon),$$

so the uncorrected estimate of $k$ is $k(1-\varepsilon)$. The additive ambient term in the mean model removes this attenuation when $\bar a$ is known. Regime: the guide does not change size factors, and $\varepsilon$ is common across cells of a replicate and known. If $\varepsilon$ varies by cell, the uncorrected fit estimates an average attenuation over cells.

**Heuristic and mixture estimators.**

- The pseudocount ratio has no variance term. When $\bar x_{\mathrm{NT}}$ is near zero its value is set by $c$ and dropout rather than by the target.
- MIMOSCA minimises $\frac{1}{2n}\lVert y_j-X\theta\rVert_2^2+\alpha\rho\lVert\theta\rVert_1+\frac{\alpha(1-\rho)}{2}\lVert\theta\rVert_2^2$ for each gene $j$ [R7], with $\alpha$ the penalty strength and $\rho$ the L1 share. The penalty shrinks weak guide effects toward zero, and the method defines no correction to the $k$ scale.
- Mixscape projects each cell, $p_c=\langle x_c,v_g\rangle/\langle v_g,v_g\rangle$, onto $v_g=\bar x_{g,D}-\bar x_{\mathrm{NT},D}$, where $D$ holds the DE genes after each cell's NT-neighbour mean is removed [R3] [R11]. The Seurat posterior $1/(1+\mathrm{LR})$, with LR a ratio of unweighted normal densities and a fixed NT component, implies equal priors. pertpy uses fitted component probabilities that include mixing weights [R12]. Regime: Gaussian components on $p_c$, which fails for graded knockdown.
- Mixscale standardises guide cells, $w_c=(p_c-\bar p_{\mathrm{NT}})/s_{\mathrm{NT}}$, and NT cells are not scored [R13]. It is unstable when $s_{\mathrm{NT}}$ is near zero or the NT projections are heavy-tailed.

**Why a model adds value.** The heuristic gives a point estimate and the mixtures give classes. The mean model gives a fraction with an interval, obtained by transforming the Wald interval of $\beta$ (a monotone map keeps coverage), replicate-aware standard errors, and a closed-form attenuation that predicts the uncorrected bias. B2 tests that prediction. Section 8 therefore defines planted checks for them.

**Assumptions and failure modes.**

- NT guides do not change the target and are labelled correctly.
- A single gene does not move the size factors appreciably.
- The ambient share is known; its estimation error is not propagated in version 1.
- Replicates are the unit of inference. Cell-level tests overstate precision when cells of one replicate share an effect [R8].
- For Mixscape and Mixscale, $D$ must be chosen without the cells being labelled; otherwise separation is inflated.
- Multi-guide or mis-assigned cells blend effects across targets, so upstream assignment comes first (`perturbation.guide_assignment`).
- Low baseline expression makes $\beta$ unstable; such guides are flagged rather than scored.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Pseudocount log ratio against NT cells | heuristic | point ratio of normalised means with no variance; comparator only | — |
| Pseudobulk negative-binomial GLM per target | model-based | replicate-level NB with NT reference and Wald interval; ambient term in the proposed default | [R3] [R10] |
| MIMOSCA elastic net | model-based | penalised regression of each gene on guide indicators and covariates | [R7] |
| Mixscape | model-based | signature projection with NT-neighbour correction and a two-component KO/NP call | [R4] [R11] [R12] [R14] |
| Mixscale | model-based | standardised projection score per perturbed cell | [R5] [R13] [R12] |

The reference points are the pseudocount ratio, used as a comparator, and Mixscape, the class caller used in the chapter [R3]. The chapter combines Mixscape classes with a replicate-blocked pseudobulk test. Each row rests on the chapter, on a repository listed in section 12, or on the formula of section 3. Titration and essential-gene depletion are design checks rather than estimators, so they appear in section 8 only.

Exact defaults for the methods singlet implements, with source locations:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Mixscape (Seurat) | min.de.genes; min.cells | 5; 5 | `R/mixscape.R:690-691` @5f67c70 |
| Mixscape (Seurat) | logfc.threshold; iter.num | 0.25; 10 | `R/mixscape.R:693-694` @5f67c70 |
| Mixscape (Seurat) | prtb.type | KO | `R/mixscape.R:699` @5f67c70 |
| Mixscape (Seurat) | NT component mean and SD | fixed to the NT distribution | `R/mixscape.R:827-828` @5f67c70 |
| Mixscape (Seurat) | KO call | $1/(1+\mathrm{LR})>0.5$ with unweighted densities | `R/mixscape.R:835-836` @5f67c70 |
| Mixscape (pertpy) | min_de_genes; logfc_threshold; iter_num; scale; test_method | 5; 0.25; 10; True; wilcoxon | `src/pertpy/tools/_perturbation_efficacy/_mixscape.py:54-59` @c246f24 |
| Mixscape (pertpy) | KO call | posterior $>0.5$ from fitted component probabilities | `_mixscape.py:246-250` @c246f24 |
| Mixscale (R) | min.de.genes; min.cells; logfc.threshold; max.de.genes | 5; 5; 0.25; 100 | `R/perturbation_scoring.R:60-64` @3d3a2cd |
| Mixscale (R) | NT standardisation | mean and SD of NT projections | `R/perturbation_scoring.R:456-459` @3d3a2cd |
| Mixscale (pertpy) | min_de_genes; max_de_genes; logfc_threshold; scale | 5; 100; 0.25; True | `src/pertpy/tools/_perturbation_efficacy/_mixscale.py:77-82` @c246f24 |
| MIMOSCA | modalpha; l1_ratio; max_iter | 0.0005; 0.5; 10000 | `mimosca.py:657` and `mimosca.py:664` @8966411 |
| Pseudobulk design (chapter) | design; contrast baseline | `~ replicate + mixscape_class`; NT | `perturbation_modeling.ipynb:604,607` @d581689 |

## 5. Proposed singlet approach

**Routes.** `pseudobulk_nb` is reimplemented from the equations of section 3; PyDESeq2 is a callout comparator and its code is not ported [R10]. `mixscape` is ported from Seurat, with pertpy as an oracle [R11] [R12]. `mixscale` is ported from pertpy, which reproduces the Mixscale reference implementation [R12]; the upstream repository is a design reference only [R13]. `mimosca` is a callout comparator [R7]. Licence names are in section 12.

**Default and formulation.** For each target, the mean model of section 3 is maximised over $\log\lambda_r$, $\beta_g$ and $\phi_t$ by Newton iteration. Standard errors come from the observed information, and the interval for $k_g$ is the transform of the interval for $\beta_g$. Guides with too few assigned cells are skipped and reported. A guide is weak when the upper bound of its log2 fold change, $\beta_U/\ln 2$ (sign reversed for activation), exceeds the threshold in section 6. A threshold of $-0.25$ means that a knockdown of at least about 16 percent is not established, since $1-2^{-0.25}\approx0.16$. The per-target summary is the median of $\hat k_g$ over tested guides. Empirical-Bayes pooling across guides of one target is a later extension and no parameter exposes it.

**Falsifiable claims.** C1: on B2 at $\varepsilon=0.3$, the uncorrected bias lies within 0.05 of $-\varepsilon k$ at every planted level, and the corrected bias is at most 0.05 at every level. C2: the pseudobulk false-positive rate on B1 lies between 0.03 and 0.07. C3: 95 percent interval coverage on B2 lies between 0.90 and 0.98. A failed claim is withdrawn, and the default then moves to the best-covering estimator that meets C2.

**Scores and classes.** `mixscape` and `mixscale` write per-cell values to `obs/knockdown_score`, and their per-target summaries are labelled as class fractions or standardised strengths, never as knockdown. Both use unscaled log-normalised input by default, as the rapids-singlecell Perturbation signature docstring specifies [R6].

**ML stack and kernels.** The mean model has one free parameter per guide, one baseline per replicate and one dispersion per target, so it is a small solve repeated over many targets. It is hard-coded in CUDA: pseudobulk sums come from one streaming sparse reduction (cuSPARSE column access), and a batched Newton step per target executes on the GPU. Mixscape and Mixscale are one-dimensional EM fits per target in C++, and per-cell projections are sparse dot products over CSR rows in a second streaming pass. PyTorch is not used in version 1, since a learned guide-activity predictor would need labelled knockdowns that the corpus does not provide.

**Defaults.** Agents keep the defaults of the section 6 table, set `design.direction` to the perturbation type, and do not call `pseudobulk_nb` without a replicate column.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse int | raw UMI counts of the target genes, in the layer named by `design.count_layer` |
| read | `layers/log1p_norm` | sparse float | unscaled log-normalised values for projections, in `design.log_layer` |
| read | `obs/assigned_guide` | categorical | single-guide assignment from guide assignment; multi-guide cells do not enter the estimates |
| read | `obs/size_factor` | float32 | size factors from size-factor estimation |
| read | `obs/<replicate_key>` | categorical | biological replicate, the unit of inference |
| read | `obs/ambient_frac_<method>` | float32 | per-cell ambient fraction, used when `ambient_correction` is true |
| read | `varm/ambient_profile_<sample>` | float32 | ambient profile of the target gene for each sample |
| read | `var/<feature_key>` | string | gene names used to locate each target |
| read | `uns/guide_to_target` | table | guide, target gene and expected direction, supplied at ingest |
| write | `uns/knockdown_efficacy` | table | per guide: target, cells, replicates, $\hat\beta$, interval, $\hat k$, interval, weak flag, skip reason; per target median $\hat k$ |
| write | `obs/knockdown_score` | float32 | per-cell projection (Mixscape) or standardised score (Mixscale); NaN for the other methods |
| write | `models/knockdown_glm` | dictionary | per-target baselines, dispersion and optimiser status for `pseudobulk_nb` |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "pseudobulk_nb" | `pseudobulk_nb`, `mimosca`, `mixscape`, `mixscale` | Estimator. pseudobulk_nb gives calibrated fractions with intervals; the other three return scores or classes. |
| `design` | object | — | — | Study design: count and log layers, guide and replicate columns, controls, covariates, expected direction. |
| `design.count_layer` | string | "counts" | — | Raw integer UMI layer of the target genes; no normalisation is applied. |
| `design.log_layer` | string | "log1p_norm" | — | Unscaled log-normalised layer used for Mixscape and Mixscale projections. |
| `design.guide_key` | string | "assigned_guide" | — | obs column of single-guide assignments from perturbation.guide_assignment. |
| `design.replicate_key` | string | "replicate" | — | obs column of biological replicates; required because replicates are the unit of inference. |
| `design.nt_label` | string | "non-targeting" | — | Guide label of non-targeting control cells. |
| `design.covariates` | array | [] | — | obs columns added as covariates to the model or elastic net. |
| `design.direction` | string | "repression" | `repression`, `activation` | Expected direction of the target change; sets the sign of the weak-guide flag. |
| `design.min_cells_per_guide` | integer | 5 | min 1 | Guides with fewer assigned cells are skipped and reported. |
| `pseudobulk_nb` | object | — | — | Options of the pseudobulk negative-binomial model. |
| `pseudobulk_nb.ambient_correction` | boolean | true | — | Model ambient target RNA as an additive term from the ambient fraction and profile. |
| `pseudobulk_nb.confidence_level` | number | 0.95 | max 1; > 0 | Coverage of the Wald intervals for beta and k. |
| `pseudobulk_nb.weak_guide_upper_lfc` | number | -0.25 | — | Guide flagged weak when the upper bound of its log2 fold change exceeds this value. |
| `mixscape` | object | — | — | Options of the Mixscape signature and two-component call. |
| `mixscape.min_de_genes` | integer | 5 | min 1 | Minimum DE genes between guide and NT cells to classify a guide. |
| `mixscape.logfc_threshold` | number | 0.25 | min 0 | Log fold-change cutoff for signature genes. |
| `mixscape.iter_num` | integer | 10 | min 1 | Iterations of the two-component mixture fit. |
| `mixscape.scale` | boolean | false | — | Scale the signature input; false keeps unscaled log-normalised input, as the rapids-singlecell implementation specifies. |
| `mixscale` | object | — | — | Options of the Mixscale standardised projection score. |
| `mixscale.min_de_genes` | integer | 5 | min 1 | Minimum DE genes between guide and NT cells to score a guide. |
| `mixscale.max_de_genes` | integer | 100 | min 1 | Maximum DE genes in the signature. |
| `mixscale.logfc_threshold` | number | 0.25 | min 0 | Log fold-change cutoff for signature genes. |
| `mixscale.scale` | boolean | false | — | Scale the signature input; false keeps unscaled log-normalised input, as the rapids-singlecell implementation specifies. |
| `mimosca` | object | — | — | Options of the elastic-net comparator. |
| `mimosca.alpha` | number | 0.0005 | > 0 | Elastic-net penalty strength. |
| `mimosca.l1_ratio` | number | 0.5 | min 0; max 1 | L1 share of the elastic-net penalty. |
| `mimosca.max_iter` | integer | 10000 | min 1 | Maximum coordinate-descent iterations. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for mixture starts in mixscape and mixscale; other methods are deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing before anything is written. |
<!-- PARAMS:AUTO:END -->

`design.direction` sets the sign of the weak-guide flag and does not change the fit. `pseudobulk_nb.ambient_correction` applies only to `pseudobulk_nb`; options of other methods are ignored and recorded in the summary. `design.replicate_key` is required for `pseudobulk_nb` and is the split key for `mixscape` and `mixscale`. `seed` affects only the mixture starts. Guides below `design.min_cells_per_guide` receive no estimate and appear in `uns/knockdown_efficacy` with a reason.

## 7. MCP tool

Tool name `singlet_perturbation_knockdown_efficacy` (definition in `tasks/mcp/singlet_perturbation_knockdown_efficacy.json`). Example call and compact result (placeholders show the shape only):

```json
{"dataset": "/data/screens/example.singlet", "method": "pseudobulk_nb", "design": {"replicate_key": "lane", "covariates": ["batch"]}}
```

```json
{
  "dataset": "/data/screens/example.singlet",
  "status": "completed",
  "wrote": ["uns/knockdown_efficacy", "obs/knockdown_score", "models/knockdown_glm"],
  "summary": {"method": "pseudobulk_nb", "n_guides_tested": "<int>", "n_guides_skipped": "<int>", "n_guides_weak": "<int>", "median_knockdown": "<float>", "device_used": "cuda"},
  "provenance_id": "<id>", "job_id": null, "estimate": null
}
```

- **Long-running**: yes for the mixtures on large screens; the status is `queued` when the dry-run estimate exceeds the inline limit.
- **Stochastic**: yes, through `seed`, for `mixscape` and `mixscale` only.
- **Dry-run estimate**: seconds, peak memory, device, cells, guides and targets, from the matrix shape without fitting.

## 8. Benchmarks

**Shared protocol.** All methods receive the same raw counts, size factors, replicate and NT labels, and covariates. Guides below the minimum cell count are skipped identically. Intervals are 95 percent Wald intervals unless stated. Each result records software versions and commits (section 12), device, thread count and seeds.

### B1. Null calibration with replicate-blocked pseudo-guides

- **Goal**: check that the pseudobulk test has its nominal false-positive rate when no knockdown exists, and that a cell-level test does not.
- **Ground truth**: consistency (zero by construction). Pseudo-guides are random splits of NT cells, so their true contrast is zero.
- **Generator recipe (proposed)**: (1) six replicates with 1,000 NT cells each; target counts are $\mathrm{NB}(s_c\lambda_r,\phi)$ with $\phi=0.3$, $\lambda_r=\exp(z_r)$, $z_r\sim\mathcal N(0,0.3^2)$ and $\log s_c\sim\mathcal N(0,0.25^2)$. (2) For each of 1,000 splits, draw $\pi_r\sim\mathrm{Beta}(2,2)$ and send each cell of replicate $r$ to pseudo-guide P with probability $\pi_r$, otherwise to Q. (3) Test P against Q, treating P as the guide and Q as NT.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated null (recipe above) | generated | one target gene, 6,000 cells, six replicates per split | — | regenerated for each seed |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| False-positive rate | share of 1,000 splits with two-sided Wald $p<0.05$, uncorrected | toward 0.05 | primary | [R8] |

- **Comparators**: pseudobulk NB with the default options; cell-level NB with the same covariates and no replicate term (pseudoreplication control).
- **Protocol**: seeds 0 to 999 for the splits, one fit per split and estimator. The binomial standard error of the rate is about 0.007.
- **Acceptance criterion** (proposed): pseudobulk rate between 0.03 and 0.07; the cell-level rate is reported and must exceed the pseudobulk rate.
- **Known pitfalls**: the splits share cells, so the binomial error understates the true error; the only batch structure simulated is the replicate shift.

### B2. Planted knockdown recovery under ambient contamination

- **Goal**: check that the ambient-corrected estimate recovers planted knockdown, and that the uncorrected estimate shows the attenuation of section 3. The planted ladder is analogous to titration designs [R9].
- **Ground truth**: planted (simulation). Each guide has a planted $k\in\{0,0.25,0.5,0.75,0.95\}$ on the non-ambient mean, which is the estimand of section 3.
- **Generator recipe (proposed)**: (1) four replicates, each with 1,000 NT cells and 300 cells per planted level; size factors and replicate shifts as in B1. (2) Non-ambient target mean $\lambda\in\{0.5,2\}$ per unit size factor, multiplied by the replicate shift to give $\lambda_r$; ambient share $\varepsilon\in\{0,0.3\}$, so that $\bar a_r=\varepsilon\lambda_r/(1-\varepsilon)$ is common to all cells of a replicate. (3) Guide cells have mean $s_c[(1-k)\lambda_r+\bar a_r]$ and NT cells $s_c[\lambda_r+\bar a_r]$, with NB counts of dispersion 0.3.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated knockdown ladder (recipe above) | generated | one target gene, about 10,000 cells per seed, 4 grid cells, 20 seeds | — | planted values are the truth |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Bias in $k$ | $\hat k-k$ at each planted level, averaged over seeds; summarised by its maximum absolute value | toward 0 | primary | — |
| Interval coverage | share of 95 percent intervals for $k$ containing the planted value | 0.90 to 0.98 | guardrail | — |
| Rank recovery | Spearman correlation between $\hat k$ and $k$ across guides of one grid cell | higher | report | — |

- **Comparators**: pseudocount ratio converted to $k=1-2^{\ell}$; pseudobulk NB without the ambient term; default pseudobulk NB; MIMOSCA and Mixscale, scored by rank correlation only because their scales are not $k$.
- **Protocol**: 20 seeds per grid cell, with the spread across seeds reported. The ambient share and profile are the planted values, so estimated ambient terms are assessed by the ambient tasks.
- **Acceptance criterion** (proposed): with $\varepsilon=0.3$, the uncorrected bias lies within 0.05 of $-\varepsilon k$ at every level, the corrected maximum absolute bias is at most 0.05, and coverage lies between 0.90 and 0.98.
- **Known pitfalls**: the simulator has the model's own mean, so it favours the model; $\varepsilon$ is common across cells, whereas real ambient shares vary by cell.

### P1. Performance and scaling

Wall time, peak host and device memory, and throughput for estimating every guide, on CPU and CUDA, at $10^4$, $10^5$ and $10^6$ cells with $10^2$, $10^3$ and $10^4$ guides (proposed grid; one target per guide, simulated with the B2 recipe at $\varepsilon=0$). Comparators: the per-target pseudobulk NB of PyDESeq2 [R10]; pertpy Mixscape and Mixscale, both with `scale=False` [R12]; MIMOSCA [R7]; and the pseudocount ratio as the cost floor. Hold fixed the count layer, unscaled log layer, NT label, covariates, seeds and replicate structure. Stability is the Spearman correlation between estimates from two disjoint halves of the cells. Acceptance (proposed): CUDA wall time at $10^6$ cells no greater than the pertpy Mixscape time on the same device, and stability at least 0.95 for `pseudobulk_nb`.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `perturbation.guide_assignment`: Per-cell guide and perturbation assignment
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `ambient.profile_estimation`: Ambient profile estimation
  - `ambient.contamination_fraction`: Contamination fraction estimation
- **Feeds**:
  - `perturbation.perturbation_effect_estimation`: Per-perturbation differential expression and effect-size estimation
  - `perturbation.escaper_classification`: Perturbed versus escaper cell classification
- **Reads**: `layers/counts`, `layers/log1p_norm`, `obs/assigned_guide`, `obs/size_factor`, `obs/<replicate_key>`, `obs/ambient_frac_<method>`, `varm/ambient_profile_<sample>`, `var/<feature_key>`, `uns/guide_to_target`
- **Writes**: `uns/knockdown_efficacy`, `obs/knockdown_score`, `models/knockdown_glm`
<!-- CHAINING:AUTO:END -->

Follows guide assignment, size-factor estimation and ambient estimation; its estimates feed effect estimation and escaper classification. No recipe membership is assigned.

## 10. Risks, pitfalls and open questions

- **No per-guide truth.** Orthogonal knockdown on the same guides (qPCR, western blot or protein CITE-seq) and a titration ladder in single-cell data are the most informative missing checks, and neither has a dataset that can be stated here. The first experiment is to measure the target by qRT-PCR for guides already profiled in a single-cell screen and compare with the estimates of `pseudobulk_nb`, `mimosca`, `mixscape` and `mixscale`.
- **Essential-gene depletion.** The pertpy K562 and RPE1 CRISPRi loaders target 20Q1 common-essential genes [R12]. Their docstrings give no per-guide endpoint abundance, so depletion is not used as an on-target check.
- **Scaling of projections.** The rapids-singlecell perturbation signature docstring specifies unscaled input [R6], while pertpy defaults to scaling [R12]. Which setting gives better KO separation has not been measured on any benchmark here. Mixscale is used only through its pertpy port.
- **Reference gaps.** The Jost 2020 entry [R9] has its DOI, venue, volume and pages from a web search, but its author list was not checked. The MIMOSCA README's 'Our paper' link is a 2016 Cell article given only as a ScienceDirect PII (S0092867416316105); its DOI was not checked, so MIMOSCA is cited through its repository [R7].
- **Ambient and CRISPRko.** The mean model assumes a known ambient mean, and propagation of its estimation error is absent from version 1, so intervals are too narrow when ambient is poorly estimated. Whether transcript loss from CRISPRko reflects protein loss is unsettled in the corpus, and no benchmark here addresses it.
- **Spread, multi-guide cells and summaries.** CRISPRi repression of neighbouring genes is not separated from on-target repression, and blended multi-guide calls inherit assignment errors. Whether efficacy should be reported per guide or per target when guides differ in activity is unresolved; the per-target median of section 5 is a convention, not an accepted estimand.

## 11. References

R1. Dixit A, Parnas O, Li B, et al. Perturb-Seq: Dissecting Molecular Circuits with Scalable Single-Cell RNA Profiling of Pooled Genetic Screens. *Cell* 2016. doi:10.1016/j.cell.2016.11.038 — verified (corpus)

R2. Replogle JM, Saunders RA, Pogson AN, et al. Mapping information-rich genotype-phenotype landscapes with genome-scale Perturb-seq. *Cell* 2022. doi:10.1016/j.cell.2022.05.013 — verified (corpus)

R3. Theis lab. Single-cell best practices, Jupyter Book chapter 'Perturbation modelling' (jupyter-book/conditions/perturbation_modeling.ipynb, commit d581689). — verified (repo)

R4. Papalexi E, Mimitou EP, Butler AW, et al. Characterizing the molecular regulation of inhibitory immune checkpoints with multimodal single-cell screens. *Nature Genetics* 2021. doi:10.1038/s41588-021-00778-2 — verified (corpus)

R5. Jiang L, Dalgarno C, Papalexi E, et al. Systematic reconstruction of molecular pathway signatures using scalable single-cell perturbation screens. *Nature Cell Biology* 2025. doi:10.1038/s41556-025-01622-z — verified (corpus)

R6. scverse. rapids-singlecell, commit e110792 (src/rapids_singlecell/pertpy_gpu/_base.py:56; src/rapids_singlecell/pertpy_gpu/_mixscale.py:55). https://github.com/scverse/rapids_singlecell — verified (repo)

R7. asncd. MIMOSCA, commit 8966411. https://github.com/asncd/MIMOSCA — verified (repo)

R8. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)

R9. Jost M, et al. Titrating gene expression using libraries of systematically attenuated CRISPR guide RNAs. *Nature Biotechnology* 2020;38(3):355-364. doi:10.1038/s41587-019-0387-5 — partial (search)

R10. owkin. PyDESeq2, commit 2ca3b74. https://github.com/owkin/PyDESeq2 — verified (repo)

R11. Seurat authors. Seurat, commit 5f67c70 (R/mixscape.R). https://github.com/satijalab/seurat — verified (repo)

R12. scverse. pertpy, commit c246f24 (src/pertpy/tools/_perturbation_efficacy). https://github.com/scverse/pertpy — verified (repo)

R13. satijalab. Mixscale, commit 3d3a2cd (R/perturbation_scoring.R). https://github.com/satijalab/Mixscale — verified (repo)

R14. Heumos L, Ji Y, May L, et al. Pertpy: an end-to-end framework for perturbation analysis. *Nature Methods* 2025. doi:10.1038/s41592-025-02909-7 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/asncd/MIMOSCA | asncd (LICENSE, copyright 2016) | MIT (LICENSE) | elastic-net comparator | callout |
| https://github.com/satijalab/seurat | Seurat authors (Authors@R in DESCRIPTION) | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE: copyright 2021, Seurat authors) | Mixscape projection and NT-anchored mixture | port |
| https://github.com/satijalab/Mixscale | not listed in DESCRIPTION | none stated (no LICENSE file, no License field) | design reference for the standardised score | callout |
| https://github.com/scverse/pertpy | Lukas Heumos (copyright 2021) and scverse (copyright 2025), LICENSE | MIT (LICENSE) | Mixscape and Mixscale reimplementation; test oracle | port |
| https://github.com/owkin/PyDESeq2 | Owkin (copyright 2022, LICENSE) | MIT (LICENSE) | pseudobulk NB comparator | callout |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (copyright 2022, LICENSE) | MIT (LICENSE) | design notes on unscaled input and Mixscale preference | callout |
