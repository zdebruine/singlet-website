---
id: perturbation.perturbation_effect_estimation
title: Per-perturbation differential expression and effect-size estimation
area: perturbation
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [perturbation.guide_assignment, normalization.size_factor_estimation]
feeds: [perturbation.global_phenotype_detection, perturbation.perturbation_functional_clustering, statistics.multiple_testing_control, statistics.pvalue_null_calibration]
reads: [layers/counts, layers/log1p_norm, obs/<perturbation_key>, obs/<replicate_key>, obs/size_factor, obs/<covariate_key>, obsm/<embedding_key>]
writes: [uns/perturbation_de, uns/perturbation_effects, uns/perturbation_edistance, obs/perturbed_mixscape, models/perturbation_nb]
devices: [cpu, cuda]
mcp_tool: singlet_perturbation_perturbation_effect_estimation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Per-perturbation differential expression and effect-size estimation

> For each perturbation, estimate every gene's change against matched non-targeting cells, with replicate-level inference, an interval, an adjusted p-value and a perturbation-level energy distance.

## 1. Question

For each perturbation $p$ and gene $g$, how much does expression change in cells carrying $p$ relative to matched non-targeting (NT) cells, and how precisely is that change estimated? The input is raw UMI counts, one perturbation label per cell, NT labels, biological replicate labels and covariates. The output is, for every perturbation-gene pair, a log2 fold change, an interval, a test statistic and an adjusted p-value, plus a perturbation-by-gene matrix. A correct answer has calibrated tests when replicates, not cells, are the independent units.

## 2. Why this task matters and where the field stands

Gene-level effects of each perturbation feed hit calling, perturbation similarity and pathway interpretation in pooled screens [R1] [R2]. Those downstream results are only as reliable as the test behind them. Cells from one replicate share donor, lane and batch, so tests that treat cells as independent overstate significance [R5] [R6]. Models with the replicate as the unit are the best-supported choice in multi-subject designs [R7] [R8], although screens often have only about three replicates.

The task is **contested**.

- Cell-level Wilcoxon tests remain the default in common single-cell toolkits, and they have no replicate term.
- The benchmarks that favour pseudobulk mostly evaluate multi-subject disease and stimulus designs, not pooled CRISPR screens, so calibration must be checked on each screen against its own NT cells [R5] [R7].
- Escaper cells without a knockout response dilute effects and reduce power. Mixscape classifies knockout cells [R3]; Mixscale replaces the class with a continuous strength [R4].
- Stress, cell-cycle and library-size programmes shared by many perturbations appear as perturbation-specific effects unless each perturbation is compared with the average perturbed profile [R17].
- Energy distance measures how far a perturbation moves the whole transcriptome [R14] [R15] but gives no gene-level effect.

Open problems are whether fixed replicate effects or donor random effects are better calibrated with two or three replicates [R19]; whether Mixscale weights or Mixscape gating give better-calibrated DE; how to separate trans effects from cis effects of CRISPRi on neighbouring genes [R20]; and how to aggregate multi-guide cells consistently across guides and targets.

## 3. Theory and insight

**Estimands.** Every output and every truth uses one scale. Let $r(c)$ be the replicate of cell $c$, $s_c$ its size factor and $\mathbf u_c$ its covariates. The effect of perturbation $p$ on gene $g$ is

$$\beta_{gp}=\ln\mathbb E\!\left[\tfrac{x_{gc}}{s_c}\,\middle|\,p,r,\mathbf u_c\right]-\ln\mathbb E\!\left[\tfrac{x_{gc}}{s_c}\,\middle|\,\mathrm{NT},r,\mathbf u_c\right],$$

the replicate-adjusted log ratio of expected size-normalised counts per cell. The reported log2 fold change is $\beta_{gp}/\ln 2$; it describes the mean of normalised counts, not library-size proportions. All assigned perturbed cells enter, so escapers dilute $\beta_{gp}$, and gating (section 5) changes the target to responding cells. The energy distance $D_p$ is the population energy distance between perturbed and NT embedding coordinates $\mathbf e_c\in\mathbb R^d$, in embedding units and without standardisation, so it compares only within one embedding. The permutation p-value estimates, with labels exchangeable within replicates, the probability of a distance at least as large as the observed one. Truths are $\beta_{gp}=0$ by construction in B1, planted values on this scale in B2, a direction of change for four named genes in B3, and held-out replicate estimates of $\beta_{gp}$ in B4.

**Models.** Counts are summed to pseudobulks $Y_{gpr}=\sum_{c\in(p,r)}x_{gc}$ with offset $N_{pr}=\sum_{c\in(p,r)}s_c$, and

$$Y_{gpr}\sim\mathrm{NB}(\mu_{gpr},\alpha_g),\qquad \log\mu_{gpr}=\log N_{pr}+\eta_{gr}+\beta_{gp}+\bar{\mathbf u}_{pr}^{\top}\boldsymbol\gamma_g,\qquad \beta_{g,\mathrm{NT}}=0.$$

Because the offset is a sum of size factors, $\exp\beta_{gp}$ is the ratio of expected normalised counts per cell. The replicate baseline $\eta_{gr}$ makes $\beta_{gp}$ a within-replicate contrast, so differences in replicate composition cannot create an effect by themselves. Regime: the NB family fits the sums; both groups are present in each replicate; $\alpha_g$ is stable after shrinkage across genes; Wald tests are approximate when pseudobulk counts are small.

**Why cell-level tests overstate significance.** For a mean difference between groups with $\bar m$ cells per replicate and within-replicate correlation $\rho$, the true variance exceeds the independent-cell variance by a first-order design effect:

$$\operatorname{Var}_{\mathrm{true}}(\hat\beta)\approx\operatorname{Var}_{\mathrm{naive}}(\hat\beta)\,\bigl[1+(\bar m-1)\rho\bigr].$$

With 500 cells per replicate and $\rho=0.01$, the naive variance is about six times too small. The approximation assumes balanced clusters and equal correlations. The Wilcoxon statistic $U_P=R_P-n_P(n_P+1)/2$ has $\mathbb E_0U_P=n_Pn_{\mathrm{NT}}/2$ and the same problem when cells are the observations; it needs a tie correction for sparse counts.

**Energy distance and permutation test.**

$$D_p=2\,\mathbb E\lVert\mathbf e_P-\mathbf e_{\mathrm{NT}}\rVert-\mathbb E\lVert\mathbf e_P-\mathbf e_P'\rVert-\mathbb E\lVert\mathbf e_{\mathrm{NT}}-\mathbf e_{\mathrm{NT}}'\rVert,$$

estimated by mean pairwise Euclidean distances, with finite first moments and samples large enough for stable means. With $B$ label permutations,

$$\hat p_p=\frac{1+\sum_{b=1}^{B}\mathbf 1\{D_p^{(b)}\ge D_p^{\mathrm{obs}}\}}{B+1}$$

is valid under exchangeability within strata and never zero; its resolution is $1/(B+1)$. The pertpy form counts exceedances without the +1 and reports at least $1/B$ (section 4), so for nonzero counts it understates the exact value by about one permutation.

**Comparator model.** MAST's hurdle model is $\operatorname{logit}\Pr(Y_{cg}>0)=\mathbf x_c^{\top}\boldsymbol\gamma_g$ and $\log Y_{cg}\mid Y_{cg}>0\sim\mathcal N(\mathbf x_c^{\top}\boldsymbol\theta_g,\sigma_g^2)$, with the centred cellular detection rate in $\mathbf x_c$ as in its vignette. Its observations are cells, so it is cell-level unless subject random effects are added, which this document does not use.

**Assumptions and failure modes.**

- NT cells are exchangeable with perturbed cells after covariate adjustment; NT cells processed in other wells or lanes produce spurious effects.
- Replicates are the units of inference. Cells within a replicate are not replicates, and cell-level tests inflate false discoveries under pseudoreplication [R5] [R6].
- With two or three replicates per group, dispersion and variance rest on very few degrees of freedom even after shrinkage.
- Low counts make log fold changes unstable, so ranking unshrunk estimates favours noisy genes.
- Energy distance depends on embedding dimension and cell caps, and small perturbation groups give unstable mean distances.
- Systematic programmes shared across perturbations appear as effects unless compared with the average perturbation [R17].

**Why a model adds value.** The NB model gives standard errors, covariate adjustment and tests in the replicate unit, and one fit yields the perturbation-by-gene matrix. Heuristics give ranks; the model gives intervals whose coverage B2 can check. Energy distance supplies one strength per perturbation that no gene-level test provides. The pitfalls above are shown by benchmark studies, chiefly pseudoreplication when replicate composition varies [R5] [R6], which is the null that B1 reproduces.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Wilcoxon rank-sum per perturbation (Seurat FindAllMarkers) | heuristic | cell-level rank test with a log fold-change prefilter; no replicate term | [R12] [R5] |
| Pseudobulk negative-binomial GLM (DESeq2 family; PyDESeq2) | model-based | replicate-level sums, size-factor offset, Wald test | [R9] [R10] [R7] |
| Pseudobulk linear mixed model (dreamlet) | model-based | precision-weighted linear model on pseudobulk with donor random effects | [R19] |
| MAST hurdle model | model-based | logistic detection plus Gaussian log-expression with cellular detection rate | [R11] |
| MIMOSCA elastic net | model-based | penalised regression of each gene on guide indicators and covariates, with a shuffled-guide null | [R1] |
| Mixscape | hybrid | signature projection with nearest-control correction and a two-component knockout call | [R3] |
| Mixscale | hybrid | continuous standardised perturbation score used to weight DE | [R4] |
| Energy distance with permutation test (pertpy) | heuristic | distance between perturbed and control embeddings, calibrated by label permutation | [R14] [R15] [R16] |

Benchmark studies favour the pseudobulk model with the replicate as the unit [R7] [R8]. Seurat's Wilcoxon test is the cell-level comparator used here [R12]. Mixscape supplies the gating step for screens [R3], and energy distance is the perturbation-strength summary implemented in pertpy [R15]. The defaults singlet relies on are listed below with their source locations; the best-practices guidelines are from [R21].

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Wilcoxon (Seurat FindAllMarkers) | logfc.threshold; test.use | 0.1; 'wilcox' | `R/differential_expression.R:50-51` @5f67c70 |
| Wilcoxon (Seurat FindAllMarkers) | min.pct | 0.01 | `R/differential_expression.R:53` @5f67c70 |
| Signature (Seurat CalcPerturbSig) | slot; num.neighbors; ndims | 'data'; NULL (function stops); 15 | `R/mixscape.R:43, 47, 49` @5f67c70 |
| Mixscape (Seurat RunMixscape) | min.de.genes; min.cells; logfc.threshold; iter.num | 5; 5; 0.25; 10 | `R/mixscape.R:690-694` @5f67c70 |
| Mixscape (Seurat RunMixscape) | slot; new.class.name; prtb.type | 'scale.data'; 'mixscape_class'; 'KO' | `R/mixscape.R:686, 689, 699` @5f67c70 |
| Mixscape (pertpy) | min_de_genes; logfc_threshold; iter_num; test_method | 5; 0.25; 10; 'wilcoxon' | pertpy `src/pertpy/tools/_perturbation_efficacy/_mixscape.py:54-58` @c246f24 |
| Mixscape (pertpy) | scale; pval_cutoff | True; 0.05 | pertpy `_mixscape.py:59, 61` @c246f24 |
| Energy distance (pertpy Distance) | metric; cell_wise_metric | 'edistance'; 'euclidean' | pertpy `src/pertpy/tools/_distances/_distances.py:397, 401` @c246f24 |
| Permutation test (pertpy DistanceTest) | n_perms; padj_threshold; correction | 1000; 0.05; 'holm-sidak' | pertpy `src/pertpy/tools/_distances/_distance_tests.py:64, 67-68` @c246f24 |
| Permutation p-value (pertpy) | formula | exceedances / B, floored at 1/B; no +1 | pertpy `_distance_tests.py:20-25` @c246f24 |
| Permutation RNG (pertpy) | seeding | unseeded `default_rng()` inside the loop | pertpy `_distance_tests.py:182` @c246f24 |
| MIMOSCA run_model | modalpha; l1_ratio; max_iter | 0.0005; 0.5; 10000 | `mimosca.py:657, 664` @8966411 |
| MIMOSCA run_model_bycol | modalpha | 0.005 | `mimosca.py:757` @8966411 |
| MAST vignette | covariate; significance | centred ngeneson; FDR below 0.05 with a fold-change cutoff | `vignettes/MAITAnalysis.Rmd:186, 227` @d46c1d1 |
| Pseudobulk guideline | min cells; min counts per pseudobulk | 10; 1000 | best-practices `conditions/differential_gene_expression.ipynb`, filter cell @d581689 |
| Cell cap | cells per perturbation for energy distance | at most 50 | best-practices `conditions/perturbation_modeling.ipynb`, text cell @d581689 |

## 5. Proposed singlet approach

**Routes.** The route of each comparator (port, reimplement or callout) is given in section 12. Edistance permutations are stratified by replicate and seeded.

**Default and formulation.** Each perturbation is fitted gene by gene against NT with batched iteratively reweighted least squares: the model of section 3, with replicate baselines, covariates as columns, the sum of size factors as offset, and dispersion shrunk toward a mean-dispersion trend. Pseudobulks below 10 cells or 1,000 counts are dropped and counted. Wald p-values are Benjamini-Hochberg adjusted within perturbation. Unshrunk estimates and intervals are always stored; shrunk log fold changes serve only for ranking, with the estimator chosen on B2 before release.

**Falsifiable claims.** C1: on B1, the pseudobulk rejection rate lies in [0.03, 0.07] and the Wilcoxon rate exceeds 0.07. C2: on B2, the realised false discovery proportion is at most 0.07 and coverage lies in [0.90, 0.98]. If C1 fails, the default moves to the pseudobulk variant that passes.

**Gating and multi-guide cells.** Gating estimates the responder effect, a different target, so both are stored when it is on. A perturbation with fewer signature genes than `min_de_genes` is reported as ungated. Multi-guide cells are excluded by default; the combined-label rule gives them their own group.

**Energy distance.** Distances use `embedding_key`. Per perturbation, at most `cells_per_perturbation_cap` cells are drawn with the seed; control cells are drawn once per screen up to `control_cells_cap` (a proposed default), and the within-control term is computed once.

**ML stack.** Per-gene NB fits are many small solves and are hard-coded in CUDA: pseudobulk sums come from one streaming cuSPARSE reduction, and batched IRLS steps are applied per gene. Energy-distance pairwise sums are CUDA kernels. PyTorch is not used in version 1; donor random effects would need autodiff and would use it. CPU builds share the algorithms and stream control cells in chunks.

**Defaults.** Agents use `pseudobulk_nb` with gating off and `alpha` 0.05, and must supply `design.control_label`. `edistance` never substitutes for gene-level tests.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse int | raw UMI counts for pseudobulk sums and NB models |
| read | `layers/log1p_norm` | sparse float | unscaled log-normalised values for Wilcoxon and Mixscape signatures |
| read | `obs/<perturbation_key>` | categorical | perturbation label; single-guide cells only by default |
| read | `obs/<replicate_key>` | categorical | biological replicate; the unit of inference |
| read | `obs/size_factor` | float32 | size factors from size-factor estimation |
| read | `obs/<covariate_key>` | numeric or categorical | design covariates such as batch or cell-cycle score |
| read | `obsm/<embedding_key>` | float32 | embedding for energy distance, default `X_pca` |
| write | `uns/perturbation_de` | table | per perturbation and gene: log2 fold change, standard error, statistic, p, adjusted p, shrunk log2 fold change, cells, replicates |
| write | `uns/perturbation_effects` | float32 matrix | perturbation by gene log2 fold change; NaN where untested |
| write | `uns/perturbation_edistance` | table | per perturbation: energy distance, permutation p, adjusted p, cells used |
| write | `obs/perturbed_mixscape` | bool | Mixscape class when gating is on; null otherwise |
| write | `models/perturbation_nb` | dictionary | per-gene dispersions, replicate baselines and optimiser status |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "pseudobulk_nb" | `pseudobulk_nb`, `wilcoxon`, `edistance` | Test or strength measure. pseudobulk_nb gives calibrated gene-level tests; edistance gives perturbation-level strength only. |
| `design` | object | required | — | Study design: layers, labels, replicate and control keys, covariates and the multi-guide rule. |
| `design.layer` | string | "counts" | — | Raw integer UMI layer used by pseudobulk_nb. |
| `design.log_layer` | string | "log1p_norm" | — | Unscaled log-normalised layer used by wilcoxon and by gating. |
| `design.perturbation_key` | string | "perturbation" | — | obs column holding the perturbation label. |
| `design.control_label` | string | — | — | Label of non-targeting control cells; required, with no universal default. |
| `design.replicate_key` | string | "replicate" | — | obs column of biological replicates; the unit of inference. |
| `design.covariates` | array | [] | — | obs columns added to the pseudobulk design or used as covariates. |
| `design.multi_guide_rule` | string | "exclude" | `exclude`, `combined_label` | Cells with two or more guides are excluded, or form their own group; never counted for each guide. |
| `gating` | object | — | — | Optional Mixscape gating before testing; changes the target to responding cells. |
| `gating.method` | string | "none" | `none`, `mixscape` | none tests all assigned cells; mixscape tests Mixscape knockout cells only. |
| `gating.min_de_genes` | integer | 5 | min 1 | Minimum signature genes before a perturbation is gated. |
| `gating.logfc_threshold` | number | 0.25 | min 0 | Log fold-change cutoff for signature genes. |
| `gating.iter_num` | integer | 10 | min 1 | Iterations of the two-component mixture fit. |
| `pseudobulk_nb` | object | — | — | Options of the replicate-level negative-binomial model, the default method. |
| `pseudobulk_nb.min_cells` | integer | 10 | min 1 | Minimum cells per pseudobulk; best-practices guideline. |
| `pseudobulk_nb.min_counts` | integer | 1000 | min 1 | Minimum total UMI counts per pseudobulk; best-practices guideline. |
| `pseudobulk_nb.lfc_shrinkage` | boolean | true | — | Store shrunk log2 fold changes for ranking; unshrunk estimates are always kept. |
| `wilcoxon` | object | — | — | Options of the cell-level Wilcoxon rank-sum comparator, which is not replicate-aware. |
| `wilcoxon.logfc_threshold` | number | 0.1 | min 0 | Minimum average log2 fold change for a gene to be tested, as in Seurat. |
| `wilcoxon.min_pct` | number | 0.01 | min 0; max 1 | Minimum fraction of cells detecting the gene in either group. |
| `edistance` | object | — | — | Options of the energy-distance strength and stratified permutation test. |
| `edistance.embedding_key` | string | "X_pca" | — | obsm key of the embedding in which distances are computed. |
| `edistance.cells_per_perturbation_cap` | integer | 50 | min 1 | Maximum perturbed cells sampled per perturbation; the best-practices chapter uses 50. |
| `edistance.control_cells_cap` | integer | 5000 | min 1 | Maximum control cells sampled once per screen; a proposed default. |
| `edistance.n_perms` | integer | 1000 | min 1 | Label permutations per perturbation, stratified by replicate; resolution is 1/(n+1). |
| `edistance.padj_method` | string | "holm-sidak" | — | Multiple-testing correction across perturbations. |
| `alpha` | number | 0.05 | max 1; > 0 | Significance threshold for adjusted p-values of the selected method. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for edistance permutations and control subsampling; other methods are deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

The method selects the outputs. `pseudobulk_nb` and `wilcoxon` write `uns/perturbation_de` and `uns/perturbation_effects`; `pseudobulk_nb` also writes `models/perturbation_nb`. `edistance` writes only `uns/perturbation_edistance` and no gene-level output. `design.control_label` is required and must match a level of the perturbation key. A perturbation is skipped with a reason when any replicate lacks perturbed or control cells. `gating` applies to every method and writes `obs/perturbed_mixscape`.

## 7. MCP tool

Tool name `singlet_perturbation_perturbation_effect_estimation` (definition in `tasks/mcp/singlet_perturbation_perturbation_effect_estimation.json`). Example call and compact result:

```json
{"dataset": "/data/screens/example.singlet", "method": "pseudobulk_nb", "design": {"control_label": "non-targeting", "perturbation_key": "guide_target", "replicate_key": "lane", "covariates": ["batch"]}}
```

```json
{
  "dataset": "/data/screens/example.singlet",
  "status": "completed",
  "wrote": ["uns/perturbation_de", "uns/perturbation_effects", "models/perturbation_nb"],
  "summary": {"method": "pseudobulk_nb", "n_perturbations_tested": "<int>", "n_pseudobulks_dropped": "<int>", "n_significant_pairs": "<int>", "device_used": "cuda"},
  "provenance_id": "<id>", "job_id": null, "estimate": null
}
```

- **Long-running**: yes for `edistance` permutations on large screens; status is `queued` when the dry-run estimate exceeds the inline limit.
- **Stochastic**: yes, through `seed`, for `edistance` permutations and control subsampling only.
- **Dry-run estimate**: seconds, peak memory and device, from cell, replicate, perturbation and gene counts without fitting.

## 8. Benchmarks

**Shared protocol.** All methods receive the same counts, size factors, replicate and NT labels, covariates and gene filter (genes detected in at least 5 percent of NT cells). Gene-level p-values are adjusted by Benjamini-Hochberg within perturbation unless stated. Intervals are 95 percent Wald intervals on the log scale. Each result records software commits (section 12), device, thread count and seed.

### B1. Replicate-varying null on non-targeting cells

- **Goal**: measure rejection rates when no perturbation exists but replicates differ in composition, which exposes pseudoreplication.
- **Ground truth**: consistency under the null: both pseudo-groups are NT cells, so every $\beta=0$.
- **Generator recipe (proposed)**: (1) take the NT cells of the Papalexi PD-L1 screen [R3] and keep genes passing the shared filter. (2) For seed $s$, draw $\pi_r\sim\mathrm{Beta}(2,2)$ for each replicate $r$, and assign each NT cell of replicate $r$ to pseudo-perturbation P with probability $\pi_r$, otherwise to Q. (3) Test P against Q with each method, at the replicate level for pseudobulk and the cell level otherwise. (4) Repeat for seeds 0 to 199.

| Dataset | Source | Modality, species, size | Terms | Notes |
|---|---|---|---|---|
| Papalexi PD-L1 screen, NT cells | [R3]; accession — | CITE-seq with guide capture, human THP-1, three replicates | — | only NT cells are used |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-gene rejection rate | share of genes with raw $p<0.05$, averaged over seeds | toward 0.05; band 0.03 to 0.07 | primary | — |
| Genomic inflation | median observed Wald $z^2$ divided by 0.4549, per split, then median over splits | toward 1 | primary | — |
| Mean false discovery proportion | mean over splits of $V/\max(R,1)$ at BH 0.05, with $R$ the calls per split and $V=R$ under the null | at most 0.10 | guardrail | [R13] |

- **Comparators**: pseudobulk NB (singlet default); PyDESeq2 pseudobulk NB; Wilcoxon rank-sum on cells; MAST hurdle on cells without random effects (versions in section 12).
- **Protocol**: seeds 0 to 199, one fit per split and method; report means and spreads over seeds.
- **Acceptance criterion**: proposed. Pseudobulk rejection rate between 0.03 and 0.07 and genomic inflation between 0.9 and 1.1 (claim C1); the Wilcoxon rate is reported and must exceed 0.07.
- **Known pitfalls**: an even split of every replicate hides pseudoreplication, which is why composition varies. Three replicates make inflation noisy, so its spread is reported.

### B2. Planted effects in a simulated screen

- **Goal**: measure power, realised false discovery and interval coverage when the true effect of every perturbation-gene pair is known.
- **Ground truth**: planted. The truth is $\beta_{gp}$ as defined in section 3, so a planted fold change $F$ corresponds to $\beta_{gp}=\ln F$.
- **Generator recipe (proposed)**: (1) three replicates; per replicate 1,500 NT cells and 150 cells for each of 10 perturbations; 2,000 genes. (2) Baselines $\log\mu_g\sim\mathcal N(-2,1)$; $\log s_c\sim\mathcal N(0,0.25^2)$; replicate shifts $z_r\sim\mathcal N(0,0.3^2)$ on the log scale. (3) For each perturbation, 50 random genes receive $\beta_{gp}=\pm\ln 1.5$ or $\pm\ln 2$ with equal probability; the others receive zero. (4) Counts $x_{gc}\sim\mathrm{NB}\bigl(s_c\exp(\log\mu_g+z_{r(c)}+\beta_{gp}\mathbf 1\{c\in p\}),\phi_g\bigr)$ with $\phi_g=0.2$. (5) Seeds 0 to 19.

| Dataset | Source | Modality, species, size | Terms | Notes |
|---|---|---|---|---|
| Simulated screen (recipe above) | generated | 2,000 genes, 10 perturbations, about 9,000 cells per seed | — | planted values are the truth |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Power | share of planted pairs with BH-adjusted $p<0.05$ within perturbation, by fold change | toward 1 | primary | — |
| Realised false discovery proportion | mean over perturbations and seeds of false calls divided by $\max(1,\text{calls})$ | at most 0.07 | primary | [R13] |
| Interval coverage | share of 95 percent Wald intervals containing $\beta_{gp}$, over all tested pairs | 0.90 to 0.98 | guardrail | — |

- **Comparators**: pseudobulk NB (singlet default); PyDESeq2 pseudobulk NB; Wilcoxon (versions in section 12).
- **Protocol**: 20 seeds; power is reported separately for fold changes 1.5 and 2, at matched realised false discovery proportion.
- **Acceptance criterion**: proposed. Pseudobulk realised proportion at most 0.07 and coverage between 0.90 and 0.98 (claim C2).
- **Known pitfalls**: the simulator uses the same NB family as the model, so B2 checks estimation within the model rather than robustness to misspecification. Replicate shifts are the only batch structure simulated.

### B3. Positive controls on the PD-L1 screen

- **Goal**: test whether PD-L1, the chapter's interferon-gamma readout, falls after knockout of IFNGR2, JAK2 and STAT1, and whether independent guides against one target agree.
- **Ground truth**: chapter readout. The chapter reports that PD-L1 is lower in IFNGR2, JAK2 and STAT1 knockout cells than in NT cells, and that THP-1 cells induce PD-L1 in response to interferon-gamma [R3] [R21]. Concordance uses only observed data, so its truth is consistency between guides.

| Dataset | Source | Modality, species, size | Terms | Notes |
|---|---|---|---|---|
| Papalexi PD-L1 screen, THP-1 | [R3]; accession — | CITE-seq with guide capture, human; 26 targets, 111 guides, three replicates | — | knockout set and counts as in the chapter |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Positive-control recall | share of the three knockouts (IFNGR2, JAK2, STAT1) whose PD-L1 readout is lower than in NT cells, as the chapter reports | toward 1 | primary | [R21] |
| Guide concordance | Pearson correlation of the log2 fold change vectors of two guides of one target, over genes with mean normalised count at least 0.1 in NT cells | above NT-versus-NT | primary | — |

- **Comparators**: pseudobulk NB per guide; Wilcoxon per guide; Mixscape-gated pseudobulk NB (`gating.method = mixscape`).
- **Protocol**: for each target with at least two guides, estimate each guide against NT and compute concordance. The baseline is concordance between two pseudo-guides formed from random halves of NT cells, matched in size to the guides, over seeds 0 to 199; report the median and a permutation p-value.
- **Acceptance criterion**: proposed. Median concordance is above zero and exceeds the NT-versus-NT median at permutation $p<0.05$.
- **Known pitfalls**: three knockouts give recall in steps of one third, and the knockout set must not be selected from the same DE results. Guides sharing an off-target effect inflate concordance, so the NT baseline is required.

### B4. Replicate-split agreement of effect vectors

- **Goal**: measure how well a perturbation's estimated effect vector agrees with the vector estimated from held-out replicates, relative to simple baselines.
- **Ground truth**: consistency. The truth for a perturbation is its effect vector estimated by the same method from held-out replicates.
- **Split recipe (proposed)**: (1) for each perturbation present in every replicate, take each nonempty proper subset $E$ of replicates as the estimation set and its complement $H$ as held out; (2) estimate $\beta_{\cdot p}$ from $E$ with its NT cells and the truth from $H$; (3) compare over genes passing the shared filter; (4) average. Three replicates give six splits per perturbation.

| Dataset | Source | Modality, species, size | Terms | Notes |
|---|---|---|---|---|
| Papalexi PD-L1 screen, THP-1 | [R3]; accession — | as B3 | — | three replicates |
| Replogle essential-gene CRISPRi screen, K562 | [R2]; accession — | Perturb-seq, human; replicate structure as in the dataset | — | essential-gene perturbations |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Mean rowwise RMSE | mean over perturbations of the RMSE between estimated and held-out vectors (OpenProblems `mean_rowwise_error` definition) | toward 0 | primary | — |
| Mean rowwise Pearson | mean over perturbations of the Pearson correlation of the same vectors (OpenProblems `mean_rowwise_correlation` definition) | toward 1 | primary | — |
| Centred variants | both metrics after subtracting the across-perturbation mean vector from estimated and held-out vectors | report | guardrail | [R17] |

- **Comparators**: mean effect vector of the other perturbations, a simple baseline of the kind hard to beat [R18]; zero vector; cell-level mean log2 fold change.
- **Protocol**: metrics are computed per perturbation and then averaged; report the spread over splits.
- **Acceptance criterion**: proposed. On uncentred Pearson, the method beats the mean-perturbation baseline for at least 60 percent of perturbations; centred metrics are reported alongside.
- **Known pitfalls**: systematic programmes inflate uncentred correlation [R17]. The OpenProblems definitions were written for predicted profiles; their use for estimated vectors is an adaptation.

### P1. Performance and scaling

Wall time and peak host and device memory of a full per-screen fit for each method at $10^4$, $10^5$ and $10^6$ cells, with 100 perturbations, 2,000 genes, three replicates and the same caps, on CPU and CUDA. Comparators: Seurat Wilcoxon (CPU), PyDESeq2 pseudobulk NB (CPU), MAST hurdle (CPU), pertpy energy distance (CPU) and the rapids-singlecell pertpy_gpu energy distance (CUDA). Hold fixed the gene, perturbation and replicate counts, the edistance caps and the seeds. The scales are proposals. Acceptance (proposed): CUDA `pseudobulk_nb` at $10^6$ cells finishes faster than PyDESeq2 on CPU at $10^5$ cells, and CUDA energy distance is at least ten times faster than pertpy on CPU at $10^5$ cells.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `perturbation.guide_assignment`: Per-cell guide and perturbation assignment
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Feeds**:
  - `perturbation.global_phenotype_detection`: Perturbation-level transcriptional phenotype (hit) calling
  - `perturbation.perturbation_functional_clustering`: Perturbation relationship mapping and functional annotation
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
- **Reads**: `layers/counts`, `layers/log1p_norm`, `obs/<perturbation_key>`, `obs/<replicate_key>`, `obs/size_factor`, `obs/<covariate_key>`, `obsm/<embedding_key>`
- **Writes**: `uns/perturbation_de`, `uns/perturbation_effects`, `uns/perturbation_edistance`, `obs/perturbed_mixscape`, `models/perturbation_nb`
<!-- CHAINING:AUTO:END -->

Follows guide assignment and size-factor estimation. Its effect matrix and energy-distance table feed hit calling, functional clustering and both calibration checks. It belongs to no named workflow yet.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The B1 null construction is specified here, not taken from the full text of Squair et al., which was not read. The Szekely and Rizzo and Wilcoxon records carry no DOI here; the Wilcoxon volume and pages rest on one search listing.
- **Comparator sources.** MAST, PyDESeq2 and dreamlet are described from repository metadata, vignettes and READMEs; their source code and primary papers were not read. DESeq2 was read only through its metadata. The MAST equations in section 3 follow its vignette. edgeR and limma-voom are not compared.
- **Data access.** Accessions for the Papalexi and Replogle screens are absent from the corpus, and the terms of use of these datasets and of the catalogue have not been checked. No benchmark uses a dataset before its terms are recorded.
- **Unsettled methods.** Fixed replicate effects versus donor random effects, Mixscale weights versus Mixscape gating, and the scaling convention all lack a DE benchmark. The Seurat and pertpy slot and scaling defaults in section 4 differ; the effect of this choice on DE has not been measured.
- **Implementation hazards.** pertpy's permutation loop draws an unseeded generator inside the loop (line 182) and permutes labels across all cells of each comparison without replicate strata (around lines 170 to 186). Its p-values are therefore not reproducible and do not respect replicates. singlet seeds and stratifies the permutations.
- **Cis effects and first experiment.** Cis effects of CRISPRi on neighbouring genes are not separated from trans effects here. An enhancer-silencing truth set [R20] would be the orthogonal check and has no benchmark in this document. The first experiment is B1 on the Papalexi NT cells, comparing pseudobulk NB with Wilcoxon, before any perturbation result is interpreted.

## 11. References

R1. Dixit A, Parnas O, Li B, et al. Perturb-Seq: Dissecting Molecular Circuits with Scalable Single-Cell RNA Profiling of Pooled Genetic Screens. *Cell* 2016. doi:10.1016/j.cell.2016.11.038 — verified (corpus)

R2. Replogle JM, Saunders RA, Pogson AN, et al. Mapping information-rich genotype-phenotype landscapes with genome-scale Perturb-seq. *Cell* 2022. doi:10.1016/j.cell.2022.05.013 — verified (corpus)

R3. Papalexi E, Mimitou EP, Butler AW, et al. Characterizing the molecular regulation of inhibitory immune checkpoints with multimodal single-cell screens. *Nature Genetics* 2021. doi:10.1038/s41588-021-00778-2 — verified (corpus)

R4. Jiang L, Dalgarno C, Papalexi E, et al. Systematic reconstruction of molecular pathway signatures using scalable single-cell perturbation screens. *Nature Cell Biology* 2025. doi:10.1038/s41556-025-01622-z — verified (corpus)

R5. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)

R6. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)

R7. Murphy AE, Skene NG. A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nature Communications* 2022. doi:10.1038/s41467-022-35519-4 — verified (corpus)

R8. Junttila S, Smolander J, Elo LL. Benchmarking methods for detecting differential states between conditions from multi-subject single-cell RNA-seq data. *bioRxiv* 2022. (preprint) doi:10.1101/2022.02.16.480662 — verified (corpus)

R9. Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. *Genome Biology* 2014. doi:10.1186/s13059-014-0550-8 — verified (corpus)

R10. Muzellec B, Telenczuk M, Cabeli V, Andreux M. PyDESeq2: a python package for bulk RNA-seq differential expression analysis. *Bioinformatics* 2023. doi:10.1093/bioinformatics/btad547 — verified (corpus)

R11. Finak G, McDavid A, Yajima M, et al. MAST: a flexible statistical framework for assessing transcriptional changes and characterizing heterogeneity in single-cell RNA sequencing data. *Genome Biology* 2015. doi:10.1186/s13059-015-0844-5 — verified (corpus)

R12. Wilcoxon F. Individual comparisons by ranking methods. *Biometrics Bulletin* 1(6):80–83, 1945. — verified (search)

R13. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society, Series B* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)

R14. Peidli S, Green TD, Shen C, et al. scPerturb: harmonized single-cell perturbation data. *Nature Methods* 2024. doi:10.1038/s41592-023-02144-y — verified (corpus)

R15. Heumos L, Ji Y, May L, et al. Pertpy: an end-to-end framework for perturbation analysis. *Nature Methods* 2025. doi:10.1038/s41592-025-02909-7 — verified (corpus)

R16. Székely GJ, Rizzo ML. Energy statistics: a class of statistics based on distances. *Journal of Statistical Planning and Inference* 2013;143(8):1249-1272. — verified (repo)

R17. Viñas Torné R, Wiatrak M, Piran Z, et al. Systema: a framework for evaluating genetic perturbation response prediction beyond systematic variation. *Nature Biotechnology* 2026. doi:10.1038/s41587-025-02777-8 — verified (corpus)

R18. Ahlmann-Eltze C, Huber W, Anders S. Deep-learning-based gene perturbation effect prediction does not yet outperform simple linear baselines. *Nature Methods* 2025. doi:10.1038/s41592-025-02772-6 — verified (corpus)

R19. Hoffman G, et al. Efficient differential expression analysis of large-scale single-cell transcriptomics data using dreamlet. *Nature Communications* 2026. doi:10.1038/s41467-026-75680-8 (preprint doi:10.1101/2023.03.17.533005) — verified (repo)

R20. Gasperini M, et al. A genome-wide framework for mapping gene regulation via cellular genetic screens. *Cell* 176(1-2):377–390, 2019. doi:10.1016/j.cell.2018.11.029 — verified (search)

R21. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w. Guideline values are taken from the chapters "Differential gene expression" and "Perturbation modelling" of the Jupyter Book at github.com/theislab/single-cell-best-practices. — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/satijalab/seurat | Seurat authors (LICENSE copyright holder) | MIT + file LICENSE (DESCRIPTION; LICENSE file present) | Wilcoxon defaults; Mixscape signature and mixture (5f67c70) | port |
| https://github.com/scverse/pertpy | Heumos L and co-authors (CITATION.cff); Lukas Heumos (LICENSE copyright) | MIT (LICENSE file; pyproject points to it); Apache-2.0 (CITATION.cff licence field and pyproject classifier) | energy distance and permutation test; Mixscape; Mixscale reference (c246f24) | port |
| https://github.com/thelovelab/DESeq2 | Michael Love (DESCRIPTION) | LGPL (>= 3) (DESCRIPTION; no LICENSE file at root) | statistical reference for pseudobulk_nb (76c5f85) | reimplement |
| https://github.com/owkin/PyDESeq2 | Owkin (LICENSE copyright 2022) | MIT (LICENSE) | pseudobulk NB comparator (2ca3b74) | callout |
| https://github.com/RGLab/MAST | Andrew McDavid, Greg Finak, Masanao Yajima (DESCRIPTION) | GPL (>= 2) (DESCRIPTION; no LICENSE file at root) | hurdle comparator (d46c1d1) | callout |
| https://github.com/asncd/MIMOSCA | asncd (LICENSE copyright 2016) | MIT (LICENSE) | elastic-net comparator (8966411) | callout |
| https://github.com/satijalab/Mixscale | satijalab GitHub organisation (README install line); no author field in DESCRIPTION | none stated (no LICENSE file; no licence field in DESCRIPTION) | design reference for the continuous score (3d3a2cd) | callout |
| https://github.com/DiseaseNeurogenomics/dreamlet | Gabriel Hoffman (DESCRIPTION) | Artistic-2.0 (DESCRIPTION) | pseudobulk mixed-model reference (6ddcb83) | callout |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (LICENSE copyright 2022) | MIT (LICENSE) | GPU energy-distance comparator, pertpy_gpu (e110792) | callout |
| https://github.com/theislab/single-cell-best-practices | Theis lab (LICENSE copyright 2021) | Apache-2.0 (LICENSE) | pseudobulk guideline values and 50-cell cap (d581689) | reimplement (values only) |
| https://github.com/openproblems-bio/task_perturbation_prediction | Open Problems in Single-Cell Analysis (LICENSE copyright 2024) | MIT (LICENSE) | metric definitions for B4 (626f945) | callout |
