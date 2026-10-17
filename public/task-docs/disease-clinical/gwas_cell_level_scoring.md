---
id: disease-clinical.gwas_cell_level_scoring
title: Single-cell disease-relevance scoring from GWAS
area: disease-clinical
scope: core
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [normalization.size_factor_estimation, harmonization.gene_identifier_mapping, qc.low_quality_cell_detection]
feeds: [disease-clinical.gwas_celltype_enrichment, statistics.multiple_testing_control]
reads: [layers/lognorm, obs/<covariate>, obs/<group_key>]
writes: [obs/<trait>_raw_score, obs/<trait>_scdrs_score, obs/<trait>_scdrs_pval, obs/<trait>_scdrs_mc_pval, obs/<trait>_scdrs_zscore, uns/<trait>_scdrs_group]
devices: [cpu, cuda]
mcp_tool: singlet_disease_clinical_gwas_cell_level_scoring
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Single-cell disease-relevance scoring from GWAS

> Scores every cell for one trait from the expression of GWAS-implicated genes and attaches a calibrated per-cell p-value, using random control gene sets matched on expression.

## 1. Question

For one trait, which individual cells express GWAS-implicated genes more than expression-matched random gene sets would predict? Inputs are a trait gene set with per-gene weights (for example MAGMA gene-level z-scores) and a log-normalised scRNA-seq matrix. Outputs are a per-cell score and per-cell p-values. A correct answer is a score whose null is the same statistic computed on gene sets without trait signal, matched on mean and variance.

## 2. Why this task matters and where the field stands

Cell-type-level summaries give every cell of a type the same value, so they cannot localise a trait-relevant subset within a type. Per-cell scoring asks the question directly, and its status is **contested**. scDRS standardises each cell's weighted score against matched controls and reports empirical p-values [R1, R2]. The heuristic family averages expression over a gene list and subtracts control genes drawn from expression bins [R3, R4]. The two families differ in how they null the score, and the sources cited here contain no cross-method benchmark on real data.

Four problems remain open. First, depth, composition and batch confounding may shift scores in ways the null does not absorb. Second, gene weights inherit the annotation window and LD reference of the gene-level GWAS step [R5]. Third, no accepted truth states which cells a real trait affects. Fourth, power depends on the GWAS signal; the repository advises a heritability z-score above 5 or a sample size above 100,000 [R2].

## 3. Theory and insight

The disease score of cell $c$ is a weighted mean of log-normalised expression over the trait gene set $G$. Here $x_{cg}$ is the log1p of size-normalised counts, $w_g$ is 1 for unweighted sets or a trait weight, and $\sigma^2_g$ is the technical variance of gene $g$:

$$S_c=\sum_{g\in G}v_g\,x_{cg},\qquad v_g=\frac{w_g a_g}{\sum_{h\in G}w_h a_h},\qquad a_g=\big(\sigma_g^2+0.01\big)^{-1/2}\tag{1}$$

The weights $a_g$ apply to the `vs` option; with `uniform` they are dropped.

Control set $k$ draws, for each trait gene $g$, one gene uniformly from the same mean-variance bin $B(g)$, and takes the weight of the trait gene it matches. The pool is not restricted to genes outside $G$ (section 10). Control scores are divided by $\sqrt{r_k}$, where

$$r_k=\frac{\sum_{h\in C_k}\mathrm{var}_h\,\tilde w_{k,h}^2}{\sum_{g\in G}\mathrm{var}_g\,v_g^2}\tag{2}$$

is the variance ratio under gene independence. Each cell is standardised against its own $K$ control scores, $Z_c=(S_c-\mu_c)/\sigma_c$, with $\mu_c$ and $\sigma_c$ their mean and standard deviation after centring across cells. The per-cell Monte Carlo p-value and the pooled empirical p-value are

$$p^{\mathrm{MC}}_c=\frac{1+\sum_{k=1}^{K}\mathbf 1\{Z^{(k)}_c\ge Z_c\}}{1+K},\qquad p_c=\frac{1+\#\{(c',k):Z^{(k)}_{c'}\ge Z_c\}}{1+n_{\mathrm{cell}}K}\tag{3}$$

where $Z^{(k)}_c$ is the same standardisation applied to control set $k$.

Each output has one estimand:

- $S_c$ (`raw_score`): weighted mean log1p expression of the trait genes. It has no null, and it depends on the expression level of the trait genes.
- $Z_c$ (`scdrs_score`): standard deviations of cell $c$ above its own control mean; dimensionless.
- $p^{\mathrm{MC}}_c$ (`scdrs_mc_pval`): tail probability of $Z_c$ among cell $c$'s $K$ controls. Its floor is $1/(1+K)$, about $10^{-3}$ at $K=1000$.
- $p_c$ (`scdrs_pval`): tail probability of $Z_c$ among all $n_{\mathrm{cell}}K$ control values pooled.
- $z_c=\mathrm{clip}(-\Phi^{-1}(p_c),-10,10)$ (`scdrs_zscore`): a presentation transform of $p_c$.

Ground-truth labels are binary per cell (planted or not, or annotated type or not). Power and false discovery rate compare $Z_c$ or $p_c$ with these labels.

Regime of validity. $S_c$ is linear and holds for any gene-set size. The Gaussian approximation $Z_c\approx\mathcal N(0,1)$ under the null is assumed for large $|G|$; the repository reports reasonable performance from ten genes [R2]. Equation (2) is exact only under gene independence, which co-expressed gene sets violate. $p_c$ is valid when cells are exchangeable under the null. $p^{\mathrm{MC}}_c$ is super-uniform for exchangeable controls, the standard $(1+\text{count})/(1+K)$ form [R6].

Insight. The contribution is the null, not the weights. Expression-matched controls approximately cancel the dependence of the raw score on the expression of the trait genes, so a high $Z_c$ means high relative to genes of similar expression. A learned null (section 5) would condition the same construction on covariates.

Complexity: each control set costs one sparse product, so work grows with $n_{\mathrm{cell}}$, $|G|$ and $K$ (derived, not measured).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scDRS | hybrid | Weighted per-cell mean of trait genes, standardised against expression-matched random gene sets, with empirical per-cell p-values | [R1], [R2] |
| Naive weighted mean | heuristic | The scDRS raw score before control normalisation; no null | [R1], [R2] |
| scanpy `score_genes` | heuristic | Mean expression of a gene list minus mean expression of control genes drawn from expression bins | [R3], [R4] |
| AUCell | heuristic | Per-cell area under the recovery curve of the gene set in the cell's gene ranking; no calibrated p-value | [R7] |

scDRS is the published standard for calibrated per-cell scores [R1]; the raw score is its first stage. scanpy `score_genes` and AUCell are common heuristic comparators. scanpy draws controls for the whole list from expression bins, whereas scDRS matches each trait gene to a control in its own mean-variance bin.

Defaults used as the reference:

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| scDRS | `n_ctrl` | 1000 | scdrs/method.py:17 |
| scDRS | `ctrl_match_key` | `mean_var` | scdrs/method.py:16 |
| scDRS | `n_genebin` | 200 | scdrs/method.py:18 |
| scDRS | `weight_opt` | `vs` | scdrs/method.py:19, 377–378 |
| scDRS | `random_seed` | 0 | scdrs/method.py, `score_cell` signature |
| scDRS | z-score clip | ±10 | scdrs/method.py:217 |
| scDRS | `compute_stats` `n_mean_bin` | 20 | scdrs/pp.py:276 |
| scDRS | covariates and `adj_prop` | off | docs/reference_cli.rst |
| Naive weighted mean | gene weights | normalised to sum 1 | scdrs/method.py:377–384 |
| scanpy `score_genes` | `ctrl_size` | 50 | src/scanpy/tools/_score_genes.py:102 |
| scanpy `score_genes` | `n_bins` | 25 | src/scanpy/tools/_score_genes.py:104 |
| AUCell | `aucMaxRank` | ceiling(0.05 × number of genes) | R/02_calcAUC.R:37 |

## 5. Proposed singlet approach

Routes. **Port** the scDRS scoring path (raw score, matched controls, Monte Carlo and pooled p-values, z transform) with the defaults in section 4, using the repository as the numerical reference. **Reimplement** the naive weighted mean as the first stage of the same kernel. **Callout** scanpy `score_genes` and AUCell as benchmark comparators only; they are not singlet methods and are absent from the MCP enum.

Kernels. The raw score is one sparse matrix-vector product $Xv$. The $K$ controls are one sparse-dense product $XW_{\rm ctrl}$ (SpMM on CUDA, CSR on CPU), and standardisation is a row reduction over $K$. The pooled p-value needs one sort of $n_{\rm cell}K$ values, so the proposed implementation is not streaming; memory is $O(n_{\rm cell}K)$, about 4 GB in float32 at one million cells and $K=1000$. `device=auto` selects CUDA when that buffer fits, and CPU otherwise.

Model-based extension (proposed, not in the enum). A learned background replaces matched controls: a small model predicts the mean and variance of a cell's control score from covariates (library size, detected genes, a cell-type embedding), trained on catalogue cells, with its predicted null checked on disjoint datasets. Two falsifiers apply. If the learned null misses the B1 tolerances in any configuration, or its B2 AUROC does not exceed the matched-control score in any configuration, the proposal is dropped. The matched-control score remains the comparator, and the learned null enters the enum only after both pass.

ML stack. PyTorch for the learned null (a small MLP or linear model). The scDRS core is a linear operator with reductions, so it is hard-coded in CUDA and cuSPARSE.

Defaults for agents: `method` = `scdrs`, `n_ctrl` = 1000, `n_genebin` = 200, `weight_opt` = `vs`, `seed` = 0, `layer` = `lognorm`, and no covariates unless depth or batch is confounded with the trait (see covariate-adjustment.covariate_variance_attribution).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/lognorm | float32 sparse | log1p size-normalised counts; the tool does not normalise |
| read | obs/<covariate> | numeric or categorical | optional covariates regressed out before scoring |
| read | obs/<group_key> | categorical | optional groups for FDR proportions and association tests |
| write | obs/<trait>_raw_score | float32 | weighted mean expression $S_c$ |
| write | obs/<trait>_scdrs_score | float32 | normalised score $Z_c$ |
| write | obs/<trait>_scdrs_pval | float64 | pooled empirical p-value $p_c$ |
| write | obs/<trait>_scdrs_mc_pval | float64 | per-cell Monte Carlo p-value $p^{\mathrm{MC}}_c$ |
| write | obs/<trait>_scdrs_zscore | float32 | signed normal transform of $p_c$, clipped at ±10 |
| write | uns/<trait>_scdrs_group | table | group FDR proportions and association tests; only with `group_key` |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `gene_set` | string | required | — | Trait gene-set file (.gs, with a TRAIT line and gene:weight pairs) or a handle to one stored in the dataset. |
| `method` | string | "scdrs" | `scdrs`, `raw_weighted_mean` | scdrs gives calibrated per-cell p-values; raw_weighted_mean gives the uncalibrated comparator score. |
| `layer` | string | "lognorm" | — | Layer of log1p size-normalised counts; the tool does not normalise counts itself. |
| `group_key` | string/null | null | — | Optional categorical obs column; when set, writes group FDR proportions and association tests. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for control gene draws; with the same inputs it fixes the output. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `scdrs` | object | — | — | Options used when method is scdrs. |
| `scdrs.n_ctrl` | integer | 1000 | min 100 | Matched control gene sets; the Monte Carlo p-value cannot fall below 1/(1+n_ctrl). |
| `scdrs.n_genebin` | integer | 200 | min 10 | Quantile bins on mean and variance used to match control genes. |
| `scdrs.weight_opt` | string | "vs" | `vs`, `uniform` | vs weights genes by inverse regularised technical standard deviation; uniform weights all trait genes equally. |
| `scdrs.covariates` | array | [] | — | obs columns regressed out of expression before scoring. |
| `scdrs.return_ctrl_norm_score` | boolean | false | — | Also write normalised control scores to obsm for downstream group tests. |
<!-- PARAMS:AUTO:END -->

The `scdrs` options apply only when `method` is `scdrs`; `raw_weighted_mean` writes only the raw score. `covariates` and `group_key` accept any obs column. The gene set must map to at least ten dataset genes, and the summary reports the mapped fraction. The pooled p-value resolves finer than $1/(1+n_{\rm ctrl})$, so use it when Monte Carlo ties dominate.

## 7. MCP tool

Tool `singlet_disease_clinical_gwas_cell_level_scoring` (definition in `tasks/mcp/singlet_disease_clinical_gwas_cell_level_scoring.json`). Example call:

```json
{"dataset": "atlas.singlet", "gene_set": "traits/example_trait.gs", "method": "scdrs", "layer": "lognorm", "scdrs": {"n_ctrl": 1000}, "seed": 0}
```

Example result:

```json
{
  "dataset": "atlas.singlet",
  "status": "completed",
  "wrote": ["obs/example_trait_raw_score", "obs/example_trait_scdrs_score", "obs/example_trait_scdrs_pval", "obs/example_trait_scdrs_mc_pval", "obs/example_trait_scdrs_zscore"],
  "summary": {"trait": "example_trait", "n_cells": "<int>", "mapped_fraction": "<0 to 1>", "p_floor_mc": "<1/(1+n_ctrl)>", "n_cells_q_below_0_1": "<int>"},
  "provenance_id": "<id>"
}
```

Long-running: above the inline limit, `status` is `queued` with a `job_id`. Stochastic: `seed` fixes the control draws. Dry-run: estimates come from a cost model not yet calibrated against P1.

## 8. Benchmarks

Shared protocol. Inputs are the Tabula Muris Senis FACS mouse atlas, filtered to cells with at least 500 detected genes and to genes detected in at least 200 cells, as in the scDRS simulation notebooks [R2]. Every score uses $n_{\rm ctrl}=1000$, `ctrl_match_key` `mean_var`, `weight_opt` `vs`, and a seed fixed per replicate. The replicate, a gene set or a seed, is the unit of variation unless a benchmark states otherwise. Cells within a replicate are correlated and are not treated as independent. Every estimand is per cell, and every score is compared with per-cell labels. Mapped gene fractions are recorded.

### B1. Null calibration under random gene sets

- **Goal**: check that per-cell p-values are uniform under the null for random gene sets with no trait signal, across set sizes and expression-defined gene pools.
- **Ground truth**: planted null by construction. Gene sets are drawn independently of any trait, so every cell satisfies the null; the estimand is each cell's tail probability under that null.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Tabula Muris Senis FACS, official raw object | scDRS simulation notebook [R2] | scRNA-seq, mouse; 1,000 to 10,000 cells sub-sampled | — | filtering as in the shared protocol |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| FPR calibration error at α = 0.05 and 0.01 | $\mathrm{FPR}_\alpha-\alpha$, where $\mathrm{FPR}_\alpha$ is the fraction of cells with $p\le\alpha$; mean and worst over gene sets; applied to `pval` and `mc_pval` | min absolute error | primary | [R1], [R2] |
| Uniformity KS distance | Kolmogorov–Smirnov distance of all cells' `pval` from Uniform(0,1); median over gene sets | min | guardrail | [R2] |

- **Comparators**: `mc_pval` against `pval`; the naive raw score with no null, expected to fail; scanpy `score_genes` with a normal p-value; AUCell, which has no calibrated p-value and is reported as not applicable.
- **Protocol**: gene-set sizes 100, 500 and 1000; pools of all genes and of the top 25% by mean, by variance and by biological variance (variance minus technical variance), each of size $\lfloor 0.25\,n_{\rm genes}\rfloor$; 100 random gene sets per pool and size.
- **Acceptance criterion**: proposed by singlet, not a published value. $|\mathrm{FPR}_{0.05}-0.05|\le0.01$ and $|\mathrm{FPR}_{0.01}-0.01|\le0.005$ for both p-value types in every pool and size; median KS distance $\le0.05$.
- **Known pitfalls**: pooled p-values assume exchangeable cells, so composition differences stress calibration; expression-defined pools are stress tests, not neutral nulls.

### B2. Planted per-cell signal

- **Goal**: per-cell AUROC and power for recovering cells whose trait-gene expression is perturbed, as a function of effect size and of overlap between planted and trait genes.
- **Ground truth**: planted by the generator below. Each cell has a binary label, causal or not. The estimand for scores is $Z_c$ in control-SD units; for power it is the Benjamini–Hochberg $q$-value of each cell's `pval` over all cells.
- **Generator** (singlet specification):
  1. Trait set $G$: 1000 genes detected in at least 200 cells, weight 1.
  2. Planted set $P$ for overlap $o$: $\lfloor 1000\,o\rfloor$ genes drawn from $G$ and the rest from outside $G$, redrawn per seed.
  3. Causal cells $C$: 500 distinct cells drawn without replacement.
  4. For $g\in P$ and $c\in C$, add $\log(1+e)$ to $x_{cg}$, where $e$ is the effect size.
  5. Configurations $(e,0.25)$ for $e\in\{0.05,\dots,0.50\}$ and $(0.25,o)$ for $o\in\{0.05,\dots,0.50\}$, each with seeds 0 to 9.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Tabula Muris Senis FACS, 10,000-cell subset | scDRS simulation notebook [R2] | scRNA-seq, mouse; 10,000 cells | — | same filtering as B1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-trait AUROC, causal versus non-causal | AUROC of $Z_c$ with midranks for ties; median over the ten seeds | max | primary | [R1], [R2] |
| Power at BH q < 0.1 | fraction of causal cells with $q\le0.1$ | max | primary | [R1], [R2] |
| Empirical FDR at BH q < 0.1 | non-causal cells with $q\le0.1$ divided by all cells with $q\le0.1$ | min (target ≤ 0.1) | guardrail | [R2] |

- **Comparators**: naive raw score; scanpy `score_genes`.
- **Protocol**: $n_{\rm ctrl}=1000$; ten seeds per configuration.
- **Acceptance criterion**: proposed by singlet, not a published value. AUROC and power are non-decreasing in effect size (median over seeds); scDRS AUROC is at least scanpy AUROC minus 0.01 in every configuration; empirical FDR at q < 0.1 is at most 0.15.
- **Known pitfalls**: a constant $\log(1+e)$ shift on 1000 genes is far from real GWAS-expression links, so success does not establish real-data power; overlap is confounded with the number of trait genes present in the matrix, which the summary reports.

### B3. Planted cell-type localisation

- **Goal**: check that per-cell scores and group summaries localise to the planted cell type rather than spreading across the dataset.
- **Ground truth**: planted with the labelled type as the causal set. All cells whose `cell_ontology_class` is "B cell" receive the B2 shift; the per-cell estimand is the same binary label, B cell or not.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Tabula Muris Senis FACS, 10,000-cell subset | scDRS simulation notebook [R2] | scRNA-seq, mouse; 10,000 cells | — | as in B2 |
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Group AUROC, B cells versus others | AUROC of $Z_c$ with midranks for ties | max | primary | [R1], [R2] |
| Specificity at FDR < 0.1 | proportion of B cells with $q<0.1$ minus proportion of other cells with $q<0.1$ | max | primary | [R2] |
| Group MC association p-value | group-level Monte Carlo test for the B-cell group in the repository's downstream analysis | min | guardrail | [R2] |

- **Comparators**: naive raw score; scanpy `score_genes`.
- **Protocol**: the B2 generator with $C$ equal to all B cells and effect sizes 0.05 to 0.50; $n_{\rm ctrl}=1000$; `group_key` set to the cell-type column with FDR thresholds 0.05, 0.1 and 0.2; ten seeds.
- **Acceptance criterion**: proposed by singlet, not a published value. Group AUROC at least 0.8 at effect 0.25; specificity above 0.2 at every effect of 0.25 or more.
- **Known pitfalls**: labels are the truth, so this tests localisation only, and a cell-type-level test can score well trivially; annotation error in `cell_ontology_class` is not modelled.

### P1. Performance and scaling

Wall time, cells per second and peak resident memory for each method on CPU and CUDA, at 1,000, 2,000, 5,000 and 10,000 cells, extended to 100,000 and 1,000,000 cells as a proposal. Vary $K\in\{100,1000\}$ and $|G|\in\{100,500,1000\}$. Comparators: naive raw score ($K=0$), scanpy `score_genes`, and AUCell. Hold fixed: the input file, the gene set, seed 0 and the thread count; record the float precision. Proposed acceptance: wall time grows no faster than linearly in cells at fixed $K$ and $|G|$. The repository states about 3 hours and 60 GB for one million cells on unstated hardware [R2]; this is a reference point, not a measured result.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
- **Feeds**:
  - `disease-clinical.gwas_celltype_enrichment`: Trait-relevant cell-type mapping from GWAS and scRNA-seq
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
- **Reads**: `layers/lognorm`, `obs/<covariate>`, `obs/<group_key>`
- **Writes**: `obs/<trait>_raw_score`, `obs/<trait>_scdrs_score`, `obs/<trait>_scdrs_pval`, `obs/<trait>_scdrs_mc_pval`, `obs/<trait>_scdrs_zscore`, `uns/<trait>_scdrs_group`
<!-- CHAINING:AUTO:END -->

This task follows QC and gene-identifier mapping, and precedes cell-type-level summaries and FDR control across cells.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The full text of the scDRS paper was not read, so its calibration and power figures are not used; benchmark designs come from the repository's notebooks [R2], and the author list of [R1] comes from a preprint excerpt. Line numbers refer to a corpus copy of unknown commit; the remote HEAD is 644a5c79. The repository step that applies $\log(1+e)$ was not read, so B2 and B3 use the section 8 generator. Gene-set size guidance conflicts: more than 50 genes and under 20% of all genes is advised, while 10 or more is reported to work [R2]. The Phipson and Smyth citation [R6] is recalled, not located in the corpus. Tabula Muris accessions are not stated, and the MAGMA entry has no stated source repository.
- **Unsettled literature.** Whether Monte Carlo or pooled p-values calibrate better for small gene sets is open. The cited sources contain no real-data cross-method benchmark of scDRS against scanpy `score_genes` or AUCell. Matched controls are drawn from whole bins that include trait genes; the effect on calibration is untested. The hit@1 benchmark on known trait and cell-type pairs is deferred until the pairs are fixed before scoring.
- **Technical and data risks.** Weights inherit the MAGMA 10 kb annotation window and the g1000 European LD reference with NCBI37.3 gene locations [R2]. As printed, the repository's simulation draws causal cells with replacement and seeds from the last character of trait names, which gives at most ten seeds; singlet copies neither rule. Float32 p-values lose the tail, so p-values are stored as float64. Zero raw scores receive an artificial minimum. Mouse input silently drops unmapped orthologs, so the mapped fraction is reported.
- **First experiment.** Measure B1 on one atlas tissue with the section 4 defaults and both p-value types; make no power claim until B1 meets its tolerances.

## 11. References

R1. Zhang MJ, Hou K, Dey KK, Jagadeesh KA, Price AL, et al. Polygenic enrichment distinguishes disease associations of individual cells in single-cell RNA-seq data. *Nature Genetics* 2022. doi:10.1038/s41588-022-01167-z — verified (corpus)
R2. Zhang MJ, Hou K. scDRS: single-cell disease-relevance score (software repository). 2021. https://github.com/martinjzhang/scDRS — partial (repo)
R3. Tirosh I, Izar B, Prakadan SM, et al. Dissecting the multicellular ecosystem of metastatic melanoma by single-cell RNA-seq. *Science* 2016. doi:10.1126/science.aad0501 — verified (corpus)
R4. Wolf FA, Angerer P, Theis Lab. scanpy (software repository, scverse/scanpy). 2017. https://github.com/scverse/scanpy — partial (repo)
R5. de Leeuw CA, Mooij JM, Heskes T, Posthuma D. MAGMA: generalized gene-set analysis of GWAS data. *PLoS Computational Biology* 2015;11(4):e1004219. doi:10.1371/journal.pcbi.1004219 — partial (search)
R6. Phipson B, Smyth GK. Permutation P-values should never be zero: calculating exact P-values when permutations are randomly drawn. *Statistical Applications in Genetics and Molecular Biology* 2010. — unverified (memory)
R7. Aibar S, González-Blas CB, Moerman T, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/martinjzhang/scDRS | Martin Jinye Zhang, Kangcheng Hou | MIT (LICENSE file; setup.py classifier) | reference implementation of the per-cell score, null and p-values; simulation notebooks | port |
| https://github.com/scverse/scanpy | F. Alexander Wolf, P. Angerer, Theis Lab; scverse | BSD-3-Clause (LICENSE file) | comparator `score_genes` | callout |
| https://github.com/aertslab/AUCell | Sara Aibar, Stein Aerts; maintainer Gert Hulselmans | GPL-3 (DESCRIPTION file); no LICENSE file at the repository root | comparator AUCell | callout |
| https://ctg.cncr.nl/software/magma | de Leeuw CA, Mooij JM, Heskes T, Posthuma D | — | gene-level statistics that become trait weights (input, not implemented) | callout |
