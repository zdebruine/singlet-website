---
id: covariate-adjustment.covariate_variance_attribution
title: Covariate variance attribution and confounding check before removal
area: covariate-adjustment
scope: core
paradigm: hybrid
literature_status: open
priority: P2
depends_on: [qc.low_quality_cell_detection, normalization.size_factor_estimation, annotation.cluster_label_assignment]
feeds: [covariate-adjustment.technical_covariate_regression, covariate-adjustment.batch_covariate_removal_expression, covariate-adjustment.cell_cycle_effect_removal, evaluation.overcorrection_detection]
reads: [layers/counts, obs/<covariate>, obs/<design>, obsm/X_pca]
writes: [uns/covariate_variance_attribution, varm/<covariate>_vf, uns/confounding_flags]
devices: [cpu, cuda]
mcp_tool: singlet_covariate_adjustment_covariate_variance_attribution
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Covariate variance attribution and confounding check before removal

> Estimates how much gene-level and principal-component variance each covariate explains beyond the protected design, and flags covariates whose effect cannot be separated from that design, so that removal does not delete biology.

## 1. Question

Before a covariate (sequencing depth, mitochondrial fraction, cell-cycle score, batch, donor) is regressed out, how much variance does it explain for each gene and each principal component, and is it associated with the protected design (condition, cell type) strongly enough that removal would also delete real signal? Inputs are a count matrix, a covariate table and a design formula. Outputs are a variance share per covariate and per gene or component, plus a confounding flag. A correct answer gives each covariate a donor-level share and marks those entangled with the design.

## 2. Why this task matters and where the field stands

Covariate removal is usually applied without checking whether the covariate is technical. Linear residualisation of log-normalised expression, as in scanpy's `regress_out`, removes each covariate's effect from every gene, and its docstring states that it tends to overcorrect (section 12). Per-gene linear mixed models split variance among donor, cell type and covariate terms while treating the donor as the replicate, and dreamlet applies this model to donor-by-cell-type pseudobulk at large scale [R1, R2]. Treating cells as replicates inflates apparent effects, a documented problem in single-cell differential expression [R5, R6]. Principal component regression gives a PC-level share; its scIB form scores batch removal, not confounding [R3, R4].

Status: **open**. No accepted method or threshold decides whether a covariate with a large share is technical or biological, and no published benchmark scores a removal decision against planted biology. Open problems: PCR shares change with the number of PCs and with gene scaling; measurement noise and expression variation are conflated unless the two models are separated [R7]; and donor counts per design level are often too small for stable donor variance components.

## 3. Theory and insight

Let $y_{gs}$ be the response of gene $g$ in pseudobulk sample $s$ (a donor-by-cell-type sum on the log-CPM scale), $\mathbf{x}_s$ the protected design row, and $z_{sk}$ the value of covariate $k$. The per-gene model is

$$y_{gs}=\mathbf{x}_s^\top\boldsymbol\beta_g+\sum_{k}z_{sk}\gamma_{gk}+\sum_{j}\mathbf{w}_{sj}^\top\mathbf{u}_{gj}+\varepsilon_{gs},\quad \mathbf{u}_{gj}\sim N(0,\sigma^2_{gj}\mathbf{I}),\quad \varepsilon_{gs}\sim N(0,\sigma^2_{ge}),$$

where $\mathbf{w}_{sj}$ indicates the level of random grouping $j$ (donor, cell type). Each output is one of the estimands below; each is a share of the variance of the modelled response with residual included, except the drop-one share, which is an $R^2$ difference.

- **Random-term share:** $\varphi_{gj}=\sigma^2_{gj}/(\sum_i\sigma^2_{gi}+\sigma^2_{ge})$. Random shares and the residual sum to one.
- **Partial covariate share (the decision quantity):** with the design in the model and $\tilde z_k$ the residual of $z_k$ after regression on the design,
$$\varphi_{gk\mid d}=\frac{\gamma_{gk}^2\,\mathrm{Var}(\tilde z_k)}{\gamma_{gk}^2\,\mathrm{Var}(\tilde z_k)+\sum_{j}\sigma^2_{gj}+\sigma^2_{ge}}.$$
Other covariates are treated as uncorrelated with $z_k$ (first order).
- **PC share:** with $v_i$ the variance of component $i$ and $R^2(\mathrm{PC}_i\mid z_k)$ its linear $R^2$ on the covariate (dummy-coded if categorical), $S_k=\sum_{i=1}^{G}v_i\,R^2(\mathrm{PC}_i\mid z_k)\big/\sum_{i=1}^{G}v_i$ is the share of variance in the leading $G$ components. This is the PCR quantity of [R3], normalised by total component variance so that it lies in $[0,1]$.
- **Design association:** $\eta^2_k=\mathrm{SS}_{\text{between}}/\mathrm{SS}_{\text{total}}$ of donor-mean covariate values across design levels, with an F-test; for categorical covariates, Cramér's V from a chi-square test. These are standard statistics with no source specific to this use.
- **Drop-one OLS share (comparator):** $\varphi^{\mathrm{OLS}}_{gk}=R^2_g-R^2_{g,-k}$, the variance of gene $g$ uniquely explained by covariate $k$ in a per-gene OLS on the pseudobulk samples. These shares do not sum to $R^2_g$.

Regime of validity: the mixed model needs at least two levels per random factor and enough donors for variance components to leave the zero boundary, and residuals must be approximately Gaussian on the transformed scale. The PC share assumes linear association. The association test assumes independent donors.

A large marginal share does not show that removal is safe. A covariate correlated with the design can explain much variance while carrying biology, so $\varphi_{gk\mid d}$ and $\eta^2_k$ must be read together. Heuristic shares have no design term: PCR and unadjusted regression assign design-driven covariate variance to the covariate. Depth and mitochondrial effects act through count noise that a Gaussian model on log-CPM does not represent, so Gaussian shares for these covariates are approximations [R7]. Cell-level replicates inflate both shares and flags [R5, R6].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Per-gene linear mixed model on pseudobulk (dreamlet fitVarPart) | model-based | Splits each gene's variance among design, donor and cell-type terms plus residual, fitted one cell type at a time | [R1], [R2] |
| Latent-variable correction for known and hidden confounders (scLVM) | model-based | Probabilistic latent factors separate known factors such as cell cycle from the remaining signal | [R8] |
| Principal component regression share | heuristic | Variance-weighted $R^2$ of the leading components on the covariate | [R3], [R4] |
| Per-gene OLS residualisation with drop-one $R^2$ share | heuristic | Gaussian linear regression of each gene on covariates; the drop-one $R^2$ gives the share | section 12 |

The published standard for variance shares that respect donor structure is the per-gene mixed model on donor-level pseudobulk [R1, R2]. PCR is the established score for batch removal [R3, R4]. Linear residualisation is the routine removal step in scanpy, and its docstring warns of overcorrection (section 12). The latent-variable route models hidden factors probabilistically [R8] and is kept here as a landscape reference only.

Defaults taken from source code:

| Method | Parameter | Value | Source |
|---|---|---|---|
| dreamlet fitVarPart | processOneAssay min.cells | 5 | R/processAssays.R:37 (dreamlet 1.9.3) |
| dreamlet fitVarPart | processOneAssay min.samples | 4 | R/processAssays.R:37 |
| dreamlet fitVarPart | processOneAssay min.count | 2 | R/processAssays.R:37 |
| dreamlet fitVarPart | processOneAssay min.prop | 0.4 | R/processAssays.R:37 |
| dreamlet fitVarPart | processOneAssay min.total.count | 15 | R/processAssays.R:37 |
| dreamlet fitVarPart | processOneAssay normalize.method | TMM | R/processAssays.R:37 |
| dreamlet fitVarPart | quiet; BPPARAM | FALSE; SerialParam() | R/fitVarPart.R:47 |
| dreamlet fitVarPart | term pruning and fit guard | removeConstantTerms and dropRedundantTerms; fit only if isFullRank | R/fitVarPart.R:111-121 |
| dreamlet variance summary | FUN; last | sum; Residuals last | R/vpDF.R:93 |
| scanpy regress_out | signature | keys required; layer None; n_jobs None; copy False | src/scanpy/preprocessing/_simple.py:513 |
| scanpy regress_out | per-gene model | Gaussian GLM (statsmodels); residuals kept | src/scanpy/preprocessing/_simple.py:649-690 |

## 5. Proposed singlet approach

Default method `pseudobulk_lmm` reimplements the dreamlet model; dreamlet is the callout comparator (section 12). The OLS share ports the chunked logic of `regress_out`; PCR is reimplemented from section 3.

Each dreamlet cell-type assay holds one sample per donor, so within one fit the donor term cannot be separated from residual variance. singlet therefore pools cell types within each gene, with cell type as a term, and reads $\varphi_{gk\mid d}$ from the same fit. Boundary variance estimates are kept and marked.

The proposed model is a hierarchical negative-binomial version of the same fit, estimated by variational inference, with 90% credible intervals on the shares. It enters the MCP enum only if B1 supports it, and is falsified if at 20 or more donors its intervals cover the planted share in fewer than 80% of gene-by-covariate cases. Thresholds are proposed.

A covariate is flagged when $\eta^2_k$ is significant at `confounding_alpha` on donor means; marginal and partial shares sit beside the flag. No materiality threshold is set here.

ML stack: PyTorch for the batched negative-binomial model; hard-coded CUDA and cuBLAS for batched OLS (the fixed design's hat matrix applied as one dense product), PCR cross-products over cell chunks, and small solves when the random structure is fixed. Pseudobulk aggregation and PCR stream over cells; the mixed model runs on CPU.

Defaults an agent should use without asking: `method` pseudobulk_lmm; `pseudobulk_by` donor and cell_type; `min_cells` 5; `min_samples` 4; `confounding_alpha` 0.05; `n_pcs` 50 (proposed).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, summed to pseudobulk |
| read | obs/<covariate> | float or category | covariate per cell, for example pct_counts_mt, cc_score, batch |
| read | obs/<design> | category | protected design columns, for example condition and cell_type |
| read | obsm/X_pca | float32 | leading components for the PC share, same scaling as the attributed data |
| write | uns/covariate_variance_attribution | table | gene by covariate: share per term, residual and fit status |
| write | varm/<covariate>_vf | float32 | per-gene variance share of each covariate |
| write | uns/confounding_flags | table | covariate by design: statistic, p-value and flag |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `design` | string | required | — | Protected biological design as a formula, for example ~ condition + cell_type. Always conditioned on. |
| `covariates` | array | required | — | obs columns to attribute, for example pct_counts_mt, cc_score, batch, donor. |
| `layer` | string | "counts" | — | Count layer summed to pseudobulk for the mixed-model and association steps. |
| `pseudobulk_by` | array | ["donor", "cell_type"] | — | obs columns defining one pseudobulk sample, the replicate unit for variance shares. |
| `method` | string | "pseudobulk_lmm" | `pseudobulk_lmm`, `pcr`, `ols` | pseudobulk_lmm: per-gene mixed model (default); pcr: PC-level share; ols: per-gene regression share. |
| `confounding_alpha` | number | 0.05 | min 0; max 1 | Nominal level of the donor-level covariate-design association test used for flags. |
| `pseudobulk_lmm` | object | — | — | Options for method pseudobulk_lmm. |
| `pseudobulk_lmm.min_cells` | integer | 5 | min 1 | Minimum cells per donor-by-cell-type sample. |
| `pseudobulk_lmm.min_samples` | integer | 4 | min 1 | Minimum samples per gene after filtering. |
| `pseudobulk_lmm.min_levels_per_random_effect` | integer | 2 | min 2 | Minimum levels a random grouping needs before its variance is estimated. |
| `pcr` | object | — | — | Options for method pcr. |
| `pcr.n_pcs` | integer | 50 | min 2 | Number of leading principal components used for the PC share. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Options in `pseudobulk_lmm` apply only to that method, and `pcr.n_pcs` only to PCR; `ols` has no options. `pseudobulk_by` defines the replicate for every method that fits donors. `confounding_alpha` changes flags only, never shares. A random grouping with fewer levels than `min_levels_per_random_effect` is reported as not estimable, not dropped.

## 7. MCP tool

Tool name `singlet_covariate_adjustment_covariate_variance_attribution` (definition in `tasks/mcp/singlet_covariate_adjustment_covariate_variance_attribution.json`). Example call:

```json
{"dataset": "my_study.singlet", "design": "~ condition + cell_type",
 "covariates": ["pct_counts_mt", "cc_score", "batch"]}
```

Example compact result (placeholders, not values):

```json
{"dataset": "my_study.singlet", "status": "completed",
 "wrote": ["uns/covariate_variance_attribution", "varm/pct_counts_mt_vf", "uns/confounding_flags"],
 "summary": {"method": "pseudobulk_lmm", "n_samples": "<int>", "n_genes_tested": "<int>",
   "median_partial_share": {"pct_counts_mt": "<0-1>"}, "flagged_covariates": ["<name>"],
   "n_singular_fits": "<int>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: pseudobulk fits complete inline; large cell-level PCR input returns `queued` with a `job_id`. Stochastic: no; identical inputs give identical outputs. Dry run: returns `estimate` (seconds, peak memory, device) and writes nothing.

## 8. Benchmarks

No published benchmark scores covariate variance attribution, so both accuracy benchmarks use simulators defined here, and both are proposals. Every comparator receives the same samples, design matrix, covariates, gene filter and seed. Truth is set by construction; real data enter neither B1 nor B2.

Simulator (shared):

1. Draw $D\in\{10,20,50\}$ donors with a balanced binary design $\delta_d$ and $T=10$ cell types; a pseudobulk sample $s$ is a donor-by-cell-type pair.
2. Draw covariate $z_s=\rho\,\delta_d+\sqrt{1-\rho^2}\,\xi_s$ with $\xi_s\sim N(0,1)$ and $\rho\in\{0,0.5,0.9\}$ for no, partial and full association.
3. Per gene, $\eta_{gs}=\mu_g+\beta_g\delta_d+u_{gd}+b_{gt}+\gamma_g z_s+e_{gs}$ with independent normal $u$, $b$ and $e$. The configuration sets the variances and $\gamma_g$ so that the partial share of section 3 equals a planted $\varphi^{*}\in\{0,0.05,0.2,0.5\}$.
4. Counts $y_{gs}\sim\mathrm{NB}(L_s e^{\eta_{gs}},\theta_g)$, with $L_s$ log-normal and $\theta_g$ log-uniform over a configured range.

### B1. Planted partial-share recovery and confounding detection

- **Goal**: recover the planted partial covariate share per gene, and rank covariate-design pairs by confounding.
- **Ground truth**: planted simulation. Per gene and covariate, $\varphi^{*}$ is the partial share of section 3 on the latent log-mean, planted exactly. Per covariate-design pair the label is positive for $\rho=0.9$ and negative for $\rho=0$; $\rho=0.5$ pairs are excluded. Residual shares are not scored.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated pseudobulk | Simulator steps 1 to 4 | pseudobulk counts, no species; $D\times T$ samples | — | No external data |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| median_abs_error_phi | per covariate, median over genes of the absolute difference between $\hat\varphi$ and $\varphi^{*}$ | minimise | primary | — |
| spearman_phi | per covariate, Spearman correlation over genes with $\varphi^{*}>0$ | maximise | primary | — |
| auroc_confounding | AUROC of donor-level $\eta^2$ on labelled pairs, pooled over seeds and $D$ | maximise | primary | — |

- **Comparators**: `pseudobulk_lmm`; the dreamlet package on the same samples; the OLS drop-one share.
- **Protocol**: a $\rho\times\varphi^{*}\times D$ grid (3 by 4 by 3), ten seeds each, one gene filter (the `pseudobulk_lmm` default). PCR is not scored because it has no gene-level truth.
- **Acceptance criterion**: proposed, not from the literature. At $D\ge20$ and $\rho=0$, `pseudobulk_lmm` reaches median_abs_error_phi of at most 0.05 and spearman_phi of at least 0.90; auroc_confounding is at least 0.90.
- **Known pitfalls**: with 10 donors, variance components sit at the zero boundary and stay in the metrics. Depth and count noise are not planted, so observed-scale error contains transform bias.

### B2. Null false-flag rate for covariate-design association

- **Goal**: keep the false flag rate near nominal when no covariate-design association exists, and show that the cell-level test does not.
- **Ground truth**: known null by construction; donor covariates are independent of design. Normalisation: the flag rate is the fraction of null datasets flagged at alpha.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated null covariate table | Null recipe below | cell-level covariate table, no counts | — | No external data |

  Null recipe: $D\in\{10,20,50\}$ donors with balanced design $\delta_d$; donor covariate $\xi_d\sim N(0,1)$ independent of $\delta_d$; 200 cells per donor with $z_c=\xi_d+\varepsilon_c$, $\varepsilon_c\sim N(0,1)$; 500 datasets per $D$.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| fpr_at_alpha | fraction of null datasets flagged at alpha 0.05, for the donor-level and cell-level tests, with a Wilson 95% interval | minimise | guardrail | — |

- **Comparators**: cell-level $\eta^2$ test, which treats cells as replicates (contrast).
- **Protocol**: alpha 0.05, each $D$ separately. The Wilson interval over 500 datasets is about $\pm0.02$ at a rate of 0.05.
- **Acceptance criterion**: proposed. Donor-level fpr_at_alpha is at most 0.10 at every $D$; the design is supported if the cell-level rate exceeds it at every $D$.
- **Known pitfalls**: with 10 donors the F-test has few degrees of freedom, so rates are reported per $D$. Each flag is one Bernoulli draw, so compare the interval, not the point rate, with 0.10.

### P1. Performance and scaling

Wall time and peak memory at 10k, 100k and 1M cells (10M for the streaming aggregation step only), with 10 to 200 donors, 5 to 30 cell types and about $2\times10^4$ genes (proposed). Comparators: `pseudobulk_lmm` on CPU; the dreamlet package on CPU, single-thread and parallel reported separately; OLS and PCR on CPU and CUDA. Held fixed: design formula, `n_pcs` 50, gene filter and seed. No acceptance threshold; the result is a scaling curve.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Feeds**:
  - `covariate-adjustment.technical_covariate_regression`: Regression of technical covariates from expression
  - `covariate-adjustment.batch_covariate_removal_expression`: Known batch or donor covariate removal on expression
  - `covariate-adjustment.cell_cycle_effect_removal`: Cell-cycle effect removal
  - `evaluation.overcorrection_detection`: Over-correction after batch or covariate removal
- **Reads**: `layers/counts`, `obs/<covariate>`, `obs/<design>`, `obsm/X_pca`
- **Writes**: `uns/covariate_variance_attribution`, `varm/<covariate>_vf`, `uns/confounding_flags`
<!-- CHAINING:AUTO:END -->

Sits at the start of covariate-removal workflows; its flags are meant to select the covariates that the feeding removal steps take.

## 10. Risks, pitfalls and open questions

- **Evidence not examined directly.** The variancePartition source and the Hoffman 2016 article page were not examined, so its REML default and fixed-effect share convention are unverified. Dreamlet and variancePartition have no LICENSE file at the repository root; their licences are the DESCRIPTION fields. Dreamlet line numbers come from dreamlet 1.9.3 in a local copy and may differ from GitHub HEAD 6ddcb83. The scLVM claims rest on its README, the Sarkar and Stephens claim on the paper title, and the scanpy overcorrection statement on its docstring; scanpy issue 526 was not examined.
- **Unsettled literature.** No threshold separates a material share or a confounded covariate, so the flag is a significance test and materiality is left to the caller. PCR shares depend on the number of components and on scaling, and have no gene-level truth, so PCR is not scored for accuracy here. Whether cell-type composition should be a covariate or part of the design is unresolved.
- **Data and external evidence not benchmarked.** Real multi-donor null data (the Squair 2021 and Zimmerman 2021 datasets), cis-eQTL or heritability concordance, and cross-cohort replicate consistency are not benchmarked, because no dataset with donor labels and an independent truth has been chosen. The catalogue size (354M cells, about 40% annotated) comes from the task brief, not a manifest, so donor-field coverage is unknown.
- **Technical risk and first experiment.** The pooled-cell-type model (section 5) and the Bayesian extension are untested. The first experiment is B1 at 20 donors with $\rho=0$ and $\rho=0.9$, which checks whether the pooled model recovers planted partial shares before any real data are used.

## 11. References

R1. Hoffman GE, Schadt EE. variancePartition: interpreting drivers of variation in complex gene expression studies. *BMC Bioinformatics* 2016. doi:10.1186/s12859-016-1323-z — partial (search)
R2. Hoffman GE, et al. Efficient differential expression analysis of large-scale single-cell transcriptomics data using dreamlet. *Nature Communications* 2026. doi:10.1101/2023.03.17.533005 — verified (corpus)
R3. Büttner M, Miao Z, Wolf FA, Teichmann SA, Theis FJ. A test metric for assessing single-cell RNA-seq batch correction. *Nature Methods* 2019. doi:10.1038/s41592-018-0254-1 — verified (corpus)
R4. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R5. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)
R6. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R7. Sarkar A, Stephens M. Separating measurement and expression models clarifies confusion in single-cell RNA sequencing analysis. *Nature Genetics* 2021. doi:10.1038/s41588-021-00873-4 — verified (corpus)
R8. Buettner F, et al. Computational analysis of cell-to-cell heterogeneity in single-cell RNA-sequencing data reveals hidden subpopulations of cells. *Nature Biotechnology* 2015. doi:10.1038/nbt.3102 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/DiseaseNeurogenomics/dreamlet | Gabriel Hoffman (author, maintainer; DESCRIPTION) | Artistic-2.0 (DESCRIPTION) | pseudobulk LMM comparator and source of the defaults in section 4, HEAD 6ddcb83 | callout |
| https://github.com/GabrielHoffman/variancePartition | Gabriel Hoffman (author, maintainer; DESCRIPTION) | GPL-2 (DESCRIPTION) | mixed-model engine that dreamlet calls | callout |
| https://github.com/scverse/scanpy | — | BSD-3-Clause (LICENSE) | per-gene OLS logic of `regress_out`, HEAD 8ed52d9 | port |
| https://github.com/YosefLab/scib-metrics | Adam Gayoso (pyproject.toml) | BSD-3-Clause (LICENSE) | PCR definition in `pcr_comparison`, HEAD 00c4ec0 | reimplement |
