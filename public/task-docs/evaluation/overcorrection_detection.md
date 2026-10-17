---
id: evaluation.overcorrection_detection
title: Over-correction after batch or covariate removal
area: evaluation
scope: core
paradigm: hybrid
literature_status: open
priority: P1
depends_on: [dim-reduction.normalized_cell_embedding, integration.batch_corrected_embedding, integration.integration_quality_scoring]
feeds: [integration.condition_preserving_correction, clustering.cell_partitioning]
reads: [layers/counts, layers/log1p_norm, layers/integrated_expr, obsm/X_pca, obsm/X_integrated, obs/<batch_key>, obs/<condition_key>, obs/<donor_key>, obs/<cell_type_key>]
writes: [uns/overcorrection/summary, obs/overcorrection_knn_purity, uns/overcorrection/de_reference, uns/overcorrection/de_post_<method>, uns/overcorrection/flag]
devices: [cpu, cuda]
mcp_tool: singlet_evaluation_overcorrection_detection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Over-correction after batch or covariate removal

> Detects whether a batch-correction, integration or covariate-regression step has removed condition-level differential expression, cell-type structure or marker separation that was present before correction, and reports the loss as a retention score checked against planted truth.

## 1. Question

Given raw counts, donor, batch, condition and cell-type labels, an uncorrected embedding, and a corrected embedding or corrected expression matrix, how much of the pre-correction condition biology survives correction? The output is the sets of differential genes before and after correction, a retention fraction $R\in[0,1]$, a sign concordance $\rho$, an over-correction score $O=1-R$, and kNN-purity and marker readouts. A correct answer keeps the pre-correction direction and significance of condition effects while removing the batch effect as far as the batch-only design allows.

## 2. Why this task matters and where the field stands

Corrected outputs feed clustering, annotation and differential expression, so over-correction changes the biology those steps report. Batch-mixing metrics cannot detect it, because removing condition signal also raises mixing. Bio-conservation scores in the scIB suite test cell-type structure against labels [R1]; none tests whether condition-level differential expression survives. Methods that remove batch effects while retaining group differences may lead to exaggerated confidence in downstream analyses [R5], and a 2025 study reports that widely used corrections are often poorly calibrated [R6].

The status is **open**. No published protocol with a stated truth definition measures condition-level retention in the sources checked here. Silhouette widths, used throughout scIB, have been criticised for shortcomings in integration benchmarking [R4], so retention cannot rest on silhouette alone. Donor-level pseudobulk is the recommended route to condition inference [R11, R12] and treats donors, not cells, as replicates [R10]. Open questions are which reference test to use, how to compare count-based and continuous-value tests, and how to tell a real loss from variance reduction.

## 3. Theory and insight

A cell $c$ has batch $b_c$, condition $t_c$, cell-type label $y_c$ and representation $\mathbf z_c$. Correction should make $\mathbf z_c$ independent of $b_c$ given $(t_c,y_c)$ while keeping its dependence on $t_c$ and $y_c$. Batch-only criteria cannot separate these aims, so each readout below is stratified by biology. Notation: $G$ genes; $S$ pseudobulk samples, one per donor and cell type; $N_s$ library size of sample $s$; $\alpha$ the FDR level.

**Estimands.** One sentence each:

- $R_{\rm lin}$ is the fraction of genes in $G_{\rm lin}$ (FDR at most $\alpha$ for the condition term of a linear model with a batch covariate on uncorrected log expression) that stay significant in that model on corrected expression (sign agreement is reported separately as $\rho$); the denominator is $\lvert G_{\rm lin}\rvert$ and effect sizes are not weighted.
- $R_{\rm NB}$ is the same fraction with $G_{\rm NB}$ taken from the negative-binomial pseudobulk model on counts; $R_{\rm NB}-R_{\rm lin}$ measures disagreement between tests, not correction.
- $\rho$ is the fraction of genes in $G_{\rm lin}\cap G_{\rm post}$ whose corrected coefficient has the reference sign; $O=1-R_{\rm lin}\in[0,1]$.
- kSIM mean is the average over cells of the same-label fraction among the cell and its $K-1$ neighbours; the acceptance rate is the fraction of cells whose purity reaches min_rate; both lie in $[0,1]$.
- ciLISI is the average over cells of a batch diversity index (inverse Simpson index of batch labels among neighbours of the same cell type), rescaled to $[0,1]$ as $(\mathrm{LISI}-1)/(B-1)$ with $B$ the number of batch levels.
- Marker retention is $\mathrm{AUROC}_{\rm post}/\mathrm{AUROC}_{\rm pre}$ per population; it is not bounded above by 1, and values above 1 mean that separation increased.
- Planted truth is $\delta_{kg}$, the condition shift of gene $g$ in cell type $k$ on the natural-log mean scale, with $G_{\rm DE}$ the genes whose shift is nonzero; planted recall is the fraction of $G_{\rm DE}$ significant with the planted sign in the post-correction linear test, and the null false-positive rate is the fraction of other genes significant after correction.
- Negative-binomial fold changes (natural log, offset $\log N_s$) and linear fold changes (log1p scale) are not on a common scale, so thresholds apply in each test's own units and only significance and sign enter $R$ and $\rho$.

**Equations and regimes.**

For one gene with $y=c\beta+B\gamma+\varepsilon$, regressing out the batch indicators $B$ (with intercept) from $y$ and fitting $c$ without a batch term multiplies the condition coefficient by the fraction of condition signal that batch does not explain, with $\hat\beta^{\rm pre}$ the coefficient of the uncorrected fit that includes $B$:

$$\frac{\hat\beta^{\rm post}}{\hat\beta^{\rm pre}}=1-\frac{\lVert P_B\,c\rVert^2}{\lVert c\rVert^2}=1-R^2_{c\sim B}.$$

Regime: additive batch effects, one condition column, centred variables; the ratio holds in expectation for fixed design. This is the only closed form in the task. For nonlinear or neighbourhood-based methods no such form exists.

$$\mathrm{kSIM}_i=\frac1K\sum_{j\in\mathcal N_i}\mathbf 1[\ell_j=\ell_i],$$

with $\mathcal N_i$ the cell and its first $K-1$ neighbours. Regime: labelled cells and a kNN graph on the chosen embedding; the score saturates near 0 or 1 for poorly or well separated data.

$$s_i=\frac{b_i-a_i}{\max\{a_i,b_i\}},\qquad \tilde s_i=\frac{s_i+1}{2},$$

with $a_i$ the mean distance to the cell's own group and $b_i$ the smallest mean distance to another group [R19]. Regime: exact computation is quadratic in cells, so large data are subsampled.

$$y_{gs}\sim\mathrm{NB}(\mu_{gs},\phi_g),\qquad \log\mu_{gs}=\log N_s+\mathbf x_s^\top\beta_g,\qquad \mathrm{Var}(y_{gs})=\mu_{gs}+\phi_g\mu_{gs}^2.$$

Regime: integer counts, donor-level replication, dispersion estimates unstable with few donors. It cannot take continuous corrected values.

$$R=\frac{\lvert G_{\rm ref}\cap G_{\rm post}\rvert}{\lvert G_{\rm ref}\rvert},\qquad \rho=\frac{1}{\lvert G_{\rm ref}\cap G_{\rm post}\rvert}\sum_{g\in G_{\rm ref}\cap G_{\rm post}}\mathbf 1\!\left[\operatorname{sgn}\hat\beta^{\rm post}_g=\operatorname{sgn}\hat\beta^{\rm ref}_g\right].$$

This is a proposed definition, not a literature one; $G_{\rm ref}$ is $G_{\rm lin}$ or $G_{\rm NB}$. Regime: a set-level count that ignores effect size.

**Insight.**

- Batch-mixing metrics reward over-correction, and label-based scores detect only cell-type erasure. Detecting condition erasure needs an external reference of biology fixed before correction.
- Linear batch-only correction removes condition signal in closed form, so its loss can be predicted before fitting. Nonlinear and neighbourhood methods have no such form, so their retention must be measured against the reference.
- Identifiability: as $R^2_{c\sim B}\to 1$, no correction separates batch from condition without an external reference. That regime is reported, not averaged away.
- Circularity: labels defined by clustering the corrected embedding make kSIM and label silhouette rise after correction; labels must come from the uncorrected data.
- Test-type mismatch: a count model cannot take corrected values, so the post-correction test is linear. Comparing it with a count reference would confuse test type with correction. The linear model on uncorrected log expression is therefore the matched reference, and the count-based retention is a second view.
- Variance reduction: correction can shrink residual variance so that real effects fall below FDR without signal loss. Retention is read as bias only after the planted check in section 8.
- Model-based gain: a fitted model gives standard errors, so retention can carry an interval. kSIM and silhouette have no sampling model, so their uncertainty is unknown.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scIB bio-conservation suite | heuristic | label- and feature-based conservation scores of the integrated output | [R1] |
| kSIM | heuristic | per-cell kNN label purity, summarised as mean and acceptance rate | [R2] |
| CiLISI | heuristic | batch diversity within each cell type, averaged over cells | [R3] |
| DESeq2 pseudobulk | model-based | negative-binomial GLM on donor-level pseudobulk with dispersion shrinkage | [R7] |
| dreamlet | model-based | precision-weighted linear models on donor-by-cell-type pseudobulk | [R8] |
| muscat | model-based | multi-sample differential state within cell subpopulations | [R9] |

The established label-level conservation readout is the scIB suite [R1], and the kNN purity and mixing readouts are kSIM and CiLISI [R2, R3]; none of these tests condition effects. For condition-level biology the standard is donor-level pseudobulk differential expression, with negative-binomial GLMs or linear mixed models and multi-sample frameworks [R7–R9]. Heuristic scores are kept as comparators; the proposed primary readout is a model-based retention test.

Defaults taken from source code or the best-practices notebook:

| Method | Parameter | Value | Source |
|---|---|---|---|
| scIB HVG overlap | n_hvg | 500, capped at floor(0.5 × genes) per batch; flavour cell_ranger | `scib/metrics/highly_variable_genes.py:28` (cap in `precompute_hvg_batch`), `:44` (default), theislab/scib @ cd67913 |
| scIB silhouette | scaling | $(\mathrm{asw}+1)/2$ | `scib/metrics/silhouette.py:52-53` @ cd67913 |
| scIB PCR | n_comps / scale / linreg_method | 50 / True / numpy | `scib/metrics/pcr.py:9` @ cd67913 |
| scIB summary | group weights | 40% batch, 60% bio | [R1] |
| kSIM | K | 25 | `pegasus/tools/nearest_neighbors.py:508` (`calc_kSIM`) @ 484617d |
| kSIM | min_rate | 0.9 | same as above |
| kSIM | random_state / full_speed | 0 / False (single thread) | same as above |
| CiLISI | min.cells.split | 10 | `R/utils.R:167` and `:180` @ 8d6b436 (scIntegrationMetrics) |

## 5. Proposed singlet approach

**Routes.** The scIB metric functions and kSIM are **ported** (permissive licences, section 12). CiLISI is **reimplemented** (copyleft), and so are the negative-binomial reference and the linear model, both written from their published forms. DESeq2, dreamlet and muscat are **callouts**, used only as comparators in section 8.

**Primary formulation** (model-based, with heuristic readouts). For each cell type $k$ and donor $d$:

1. Form pseudobulk count sums $y_{gkd}$ and library sizes $N_{kd}$ as a sparse indicator product.
2. Fit the reference negative-binomial GLM with condition and batch terms, offset $\log N_{kd}$ and dispersion shrinkage. It defines $G_{\rm NB}$ and $R_{\rm NB}$.
3. Fit the matched linear model with the same design on donor-level mean log expression, separately on uncorrected and corrected values. It defines $G_{\rm lin}$, $G_{\rm post}$, $R_{\rm lin}$, $\rho$ and $O$.
4. Raise a flag when $O$ exceeds the flag threshold, reported beside the batch readouts. The flag is a review signal, not a correction decision.

**Falsification** (proposed). The formulation is rejected if (a) at $q=0$ in B2, $R_{\rm lin}$ differs from planted recall by more than 0.1 on average over methods; (b) $O$ does not rise with confounding $q$ in B2, which would mean the simulator does not test over-correction; or (c) on B1 the kSIM mean ranks methods with Spearman correlation below 0.8 against the scIB bio group, in which case kSIM is dropped as a conservation proxy.

**Learned variant.** A conditional latent-variable model in PyTorch, scored by the condition-attributable latent variance retained after correction with held-out donors, is deferred and is not in the enum.

**Kernels and stack.** A batched per-gene negative-binomial IRLS in CUDA is hard-coded, because it is many small, identical fits. Pseudobulk aggregation uses cuSPARSE. kNN uses an approximate index on the embedding with an exact CPU reference. PyTorch is needed only for the deferred variant. Every kernel has a CPU path, and version one makes no streaming claim.

**Defaults an agent uses without asking:** method condition_de_retention; K 25; min_rate 0.9; n_hvg 500; n_comps 50; fdr 0.05 with Benjamini–Hochberg within cell type (proposed); min_donors_per_condition 4 (proposed); flag_threshold 0.2 (uncalibrated); seed 0; device auto.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts for the pseudobulk and count reference |
| read | obs/<batch_key> | category | batch covariate, at least two levels |
| read | obs/<condition_key> | category | protected condition, at least two levels |
| read | obs/<donor_key> | category | biological replicate (donor or sample) |
| read | obs/<cell_type_key> | category | cell-type labels fixed before correction |
| read | obsm/X_pca | float32 | uncorrected embedding for the pre-correction graph |
| read | obsm/X_integrated | float32 | corrected embedding under test |
| read | layers/integrated_expr | float32 | corrected log expression under test |
| read | layers/log1p_norm | float32 | uncorrected log expression for the matched baseline |
| write | uns/overcorrection/summary | dict | per-method readouts |
| write | obs/overcorrection_knn_purity | float32 | per-cell kSIM |
| write | uns/overcorrection/de_reference | table | pre-correction NB and linear tables |
| write | uns/overcorrection/de_post_<method> | table | post-correction linear table per output |
| write | uns/overcorrection/flag | bool | flag per method |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (s3://, r2://, https://) or a workspace handle. |
| `method` | string | "condition_de_retention" | `condition_de_retention`, `knn_purity`, `cilisi`, `scib_bio_conservation` | Readout to compute. Use knn_purity, cilisi or scib_bio_conservation for cell-type structure only. |
| `keys` | object | — | — | obs columns for batch, condition, donor and cell type, and an optional uns key of marker sets. |
| `keys.batch` | string | "batch" | — | obs column of batch labels (at least two levels). |
| `keys.condition` | string | "condition" | — | obs column of the protected condition (at least two levels). |
| `keys.donor` | string | "donor" | — | obs column of biological replicates (donor or sample). |
| `keys.cell_type` | string | "cell_type" | — | obs column of cell-type labels fixed before correction. |
| `keys.marker_sets` | string | — | — | uns key of marker gene sets for AUROC retention; optional. |
| `representations` | object | — | — | Storage keys of the uncorrected and corrected representations under test. |
| `representations.counts` | string | "layers/counts" | — | Raw count layer for the pre-correction negative-binomial reference. |
| `representations.uncorrected_expression` | string | "layers/log1p_norm" | — | Uncorrected log-scale layer for the matched linear baseline. |
| `representations.corrected_expression` | string | "layers/integrated_expr" | — | Corrected log-scale expression under test; required for retention. |
| `representations.uncorrected_embedding` | string | "obsm/X_pca" | — | Uncorrected embedding for the pre-correction neighbour graph. |
| `representations.corrected_embedding` | string | "obsm/X_integrated" | — | Corrected embedding under test for kSIM, CiLISI and silhouette. |
| `condition_de_retention` | object | — | — | Settings for the default retention readout. |
| `condition_de_retention.fdr` | number | 0.05 | min 0; max 1 | FDR threshold defining the reference and post-correction gene sets. |
| `condition_de_retention.min_abs_log_fc` | number | 0 | min 0 | Minimum absolute effect in each test's own units; 0 applies no filter. |
| `condition_de_retention.min_donors_per_condition` | integer | 4 | min 2 | Donors needed per condition within a cell type; below this the type is not evaluable. |
| `condition_de_retention.flag_threshold` | number | 0.2 | min 0; max 1 | Flag when the over-correction score exceeds this; uncalibrated, for review. |
| `knn_purity` | object | — | — | Settings for the kSIM readout. |
| `knn_purity.K` | integer | 25 | min 2 | Neighbours per cell, including the query cell. |
| `knn_purity.min_rate` | number | 0.9 | min 0; max 1 | Per-cell purity threshold for the acceptance rate. |
| `cilisi` | object | — | — | Settings for the cell-type-aware LISI readout. |
| `cilisi.min_cells_split` | integer | 10 | min 1 | Minimum cells per cell-type group for CiLISI. |
| `cilisi.min_batches_per_group` | integer | 2 | min 2 | Minimum distinct batches per group; CiLISI needs at least two batch labels per group. |
| `scib_bio_conservation` | object | — | — | Settings for the scIB bio-conservation group. |
| `scib_bio_conservation.n_hvg` | integer | 500 | min 1 | Per-batch highly variable genes for HVG overlap, capped at half the genes. |
| `scib_bio_conservation.n_comps` | integer | 50 | min 2 | Principal components for PCR and isolated-label silhouette. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for approximate kNN construction and any subsampling. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules that span parameters: the condition_de_retention readout needs counts, a donor key and a corrected expression layer, while kSIM and CiLISI accept embeddings or graphs. A cell type is evaluated only when every condition has at least min_donors_per_condition donors; otherwise it is reported as not evaluable and excluded from $R$. CiLISI groups need at least two batch labels and min_cells_split cells, as the metric requires. Effect-size thresholds are in each test's own units. The flag is uncalibrated.

## 7. MCP tool

Tool name `singlet_evaluation_overcorrection_detection` (definition in `tasks/mcp/singlet_evaluation_overcorrection_detection.json`). Example call and result, with values left as placeholders:

```json
{"dataset": "/data/example.singlet", "method": "condition_de_retention",
 "keys": {"batch": "batch", "condition": "condition", "donor": "donor", "cell_type": "cell_type"},
 "representations": {"corrected_expression": "layers/integrated_expr", "corrected_embedding": "obsm/X_integrated"}}
```

```json
{"dataset": "/data/example.singlet", "status": "completed",
 "wrote": ["uns/overcorrection/summary", "uns/overcorrection/de_reference", "uns/overcorrection/de_post_integrated", "uns/overcorrection/flag"],
 "summary": {"method": "condition_de_retention", "n_reference_genes": "<int>", "retention_matched": "<0-1>",
   "retention_nb": "<0-1>", "sign_concordance": "<0-1>", "over_correction_score": "<0-1>", "flag": "<bool>"},
 "provenance_id": "<id>", "job_id": null}
```

Not long-running; the dry-run estimate reports time and memory from the cell, donor, gene and representation sizes without fitting. Stochastic through approximate kNN and any subsampling, both fixed by `seed`.

## 8. Benchmarks

All accuracy benchmarks use the readouts of section 3 on the same embeddings and graphs, with log-normalised expression, 500 HVGs, 50 principal components, K 25, min_rate 0.9 and random_state 0. Each correction uses the default settings of its own package. A method enters a benchmark only in the output form it returns (embedding, graph or corrected expression). Thresholds in this section are design choices, not literature values, and are labelled proposed where they set acceptance.

### B1. scIB bio-conservation ranking (published)

- **Goal**: check that the label-based readouts (kSIM, CiLISI and the scIB bio group) order integration outputs as the scIB bio-conservation suite does.
- **Ground truth**: expert cell-type labels, orthogonal to batch and fixed before correction. Each metric is min-max scaled across all method and preprocessing combinations, so 1 is best and 0 is worst. The collection carries batch and cell-type labels but no condition, so condition retention is not computed here.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| scIB benchmark collection | [R1], [R12] | RNA and ATAC; 85 batches; species — | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cell-type ASW | mean over all cells of $\tilde s_i$, with the cell-type label as group | maximize | primary | [R1] |
| Isolated-label F1 | best clustering F1 over the equally spaced resolution grid between 0 and 2 used by scib's `cluster_optimal_resolution`, mean over isolated labels | maximize | primary | [R1] |
| Isolated-label ASW | silhouette of isolated versus other labels on PCA, scaled to $[0,1]$, mean over isolated labels | maximize | primary | [R1] |
| NMI and ARI | clustering of the integrated graph against labels, resolution optimised per method | maximize | primary | [R1] |
| HVG overlap | mean over batches of $\lvert X_b\cap Y_b\rvert/\min(\lvert X_b\rvert,\lvert Y_b\rvert)$ with the per-batch HVG sets | maximize | guardrail | [R1] |
| Cell-cycle conservation | $1-\lvert\mathrm{Var}_{\rm after}-\mathrm{Var}_{\rm before}\rvert/\mathrm{Var}_{\rm before}$ per batch | maximize | guardrail | [R1] |

- **Comparators**: unintegrated data as reference; Harmony [R13]; MNN [R14]; ComBat [R15]; Seurat CCA [R17, R18] and RPCA [R20]; all other methods in the scIB release used.
- **Protocol**: scIB metric functions applied to each output against the unintegrated object. The bio group is the mean of the bio-conservation metrics. The 40/60 batch-to-bio weighting is a convention used only for reporting.
- **Acceptance criterion** (proposed): Spearman correlation of at least 0.8 between the kSIM-mean ranking and the scIB bio-group ranking across method and preprocessing combinations.
- **Known pitfalls**: min-max scaling depends on the method set, so absolute values do not carry across studies. Labels taken from clustering of corrected outputs make the kSIM comparison circular.

### B2. Planted-biology simulation with known condition-DE genes (proposed)

- **Goal**: measure how much planted condition effects survive correction, and how many non-planted genes become significant, at controlled confounding.
- **Ground truth**: planted simulation. The generator fixes the DE gene set, cell types, conditions, donors and batches exactly; per-gene truth is $\delta_{kg}$ for $g\in G_{\rm DE}$.
- **Generator recipe.** Values not given here are set in the benchmark configuration and reported with the results.
  1. Draw baseline log means $\alpha_g$ and cell-type offsets $\epsilon_{kg}$, giving $\mu_{kg}=\exp(\alpha_g+\epsilon_{kg})$, and fix cell-type proportions.
  2. Choose $G_{\rm DE}$ as 5% of genes. For each cell type $k$ and $g\in G_{\rm DE}$, draw a sign and magnitude $\delta_{kg}$ at each of two effect sizes.
  3. Assign at least four donors per condition to two batches with confounding level $q\in\{0,0.5,0.9\}$: a condition-1 donor enters batch 1 with probability $0.5+q/2$, and a condition-0 donor with probability $0.5-q/2$. With equal donor numbers per condition, this rule gives a population $R^2_{c\sim B}$ of $q^2$.
  4. Apply a batch distortion to each batch: a batch-specific, gene-wise, monotone nonlinear transform of the mean, not additive on the log scale, from a family fixed in the configuration.
  5. Draw donor effects $u_d\sim N(0,\sigma_d^2)$ on the log scale and library sizes $N_s$ from a fixed distribution.
  6. Draw counts $y_{cg}\sim\mathrm{NB}(\mu_{cg},\phi_g)$, where $\mu_{cg}$ combines steps 1 to 5 and the planted shift for the cell's condition.
  7. Repeat over 10 seeds (proposed).

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Two-batch simulated design | generated by recipe steps 1 to 7 | simulated RNA counts; cells per donor set in configuration | — | Three confounding levels, two effect sizes |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Planted recall $R_{\rm sim}$ | fraction of $G_{\rm DE}$ significant at FDR 0.05 in the post-correction linear test with the planted sign | maximize | primary | proposed |
| Sign concordance $\rho_{\rm sim}$ | fraction of retained planted genes with the planted sign | maximize | primary | proposed |
| Null false-positive rate | fraction of non-planted genes significant at FDR 0.05 after correction | minimize | guardrail | [R10] |
| kSIM mean and ciLISI | section 3 definitions, with the simulator's exact cell-type labels | maximize | guardrail | [R2], [R3] |

- **Comparators**: no correction; limma removeBatchEffect [R16]; ComBat [R15]; Harmony [R13]; Seurat CCA [R17, R18] and RPCA [R20]; MNN [R14].
- **Protocol**: three confounding levels, two effect sizes and 10 seeds. For each output compute $R_{\rm sim}$, $\rho_{\rm sim}$, the null false-positive rate, kSIM and ciLISI. Report $R_{\rm sim}$ as a function of $q$ and never average over $q$. Embedding-only outputs receive label readouts only.
- **Acceptance criterion** (proposed): at $q=0$, $R_{\rm sim}\ge 0.9$ and null false-positive rate at most 0.05 for every method that returns corrected expression. $R_{\rm sim}$ must fall as $q$ rises, otherwise the simulator is not testing over-correction. For an additive-batch variant of the recipe, a linear batch-only correction must return $\hat\beta^{\rm post}/\hat\beta^{\rm pre}$ within Monte Carlo error of $1-q^2$.
- **Known pitfalls**: if the distortion has the additive form of ComBat or removeBatchEffect, linear correction looks perfect, which is why step 4 excludes that form. At $q=0.9$ no method is identifiable without an external reference; that regime is reported rather than hidden.

### P1. Performance and scaling

Wall time, peak memory and throughput at $10^4$, $10^5$ and $10^6$ cells and 10 and 50 donors, on CPU and CUDA, for pseudobulk aggregation, the negative-binomial reference, the linear fits, kSIM and CiLISI. Comparators: scIB metric components, pegasus `calc_kSIM` in single-thread mode, scIntegrationMetrics ciLISI in R, and DESeq2 and dreamlet on the same pseudobulk. Hold fixed: embedding dimension 50, K 25, min_rate 0.9, n_hvg 500, seed 0, single-thread kSIM, identical hardware and BLAS, and the silhouette subsampling size from the configuration. No streaming claim is made.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `integration.batch_corrected_embedding`: Batch-corrected joint embedding
  - `integration.integration_quality_scoring`: Integration quality scoring
- **Feeds**:
  - `integration.condition_preserving_correction`: Condition-preserving batch correction
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Reads**: `layers/counts`, `layers/log1p_norm`, `layers/integrated_expr`, `obsm/X_pca`, `obsm/X_integrated`, `obs/<batch_key>`, `obs/<condition_key>`, `obs/<donor_key>`, `obs/<cell_type_key>`
- **Writes**: `uns/overcorrection/summary`, `obs/overcorrection_knn_purity`, `uns/overcorrection/de_reference`, `uns/overcorrection/de_post_<method>`, `uns/overcorrection/flag`
<!-- CHAINING:AUTO:END -->

It sits between correction and downstream analysis: it checks an integrated output before clustering or condition testing use it. No named recipe includes it yet.

## 10. Risks, pitfalls and open questions

- **Partly read sources.** Antonsson and Melsted 2025 and Nygaard et al. 2016 are cited from their title and publication record only. The main text of Rautenstrauch and Ohler and the BRAS implementation were not checked, so BRAS appears in no table, enum or benchmark.
- **Provisional enum.** The negative-binomial and linear reference models are specified from the DESeq2 and dreamlet package metadata, and neither model's code has been checked against the reimplementation. edgeR is absent from the tables and enum because neither its code nor its primary text was checked.
- **Datasets and licences missing.** Dataset names, accessions and licences for the scIB collection are not established, so B1 states only its scale. The OpenProblems batch-integration datasets, the metrics-matter datasets and a CITE-seq protein-separation test (no ADT-defined populations identified) are folded here. The 2021 cell-state erasure preprint (doi:10.1101/2021.11.15.468733) and a kernel-density matching method stated to avoid over-correction (doi:10.1101/gr.261115.120) have unverified authors and protocols and are not evaluated.
- **Unsettled evidence.** It is unclear whether silhouette rewards compactness over separation in these settings. Calibration of pseudobulk tests with few donors is a separate question (statistics.pvalue_null_calibration). The thresholds 0.1, 0.8, 0.9, 0.05, 0.2 and the four-donor minimum are design choices, not literature values.
- **Technical risks.** Retention falls when correction shrinks residual variance and real effects drop below FDR. No method is identifiable at full confounding. Count models cannot take corrected values. Cell types with too few donors per condition remain unscored.
- **First experiment.** Fix the gene count, cells per donor and number of cell types. Then generate the additive-batch variant at $q$ of 0, 0.5 and 0.9 with one cell type and 10 seeds, and confirm that the linear batch-only coefficient ratio matches $1-q^2$ and that $O$ rises with $q$. Only then apply the nonlinear recipe.

## 11. References

R1. Luecken MD, Büttner M, Chaichoompu K, Danese A, Interlandi M, Mueller MF, Strobl DC, Zappia L, Dugas M, Colomé-Tatché M, Theis FJ. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022;19:41-50. doi:10.1038/s41592-021-01336-8 — partial (corpus)
R2. Li B, Gould J, Yang Y, et al. Cumulus provides cloud-based data analysis for large-scale single-cell and single-nucleus RNA-seq. *Nature Methods* 2020. doi:10.1038/s41592-020-0905-x — partial (repo)
R3. Andreatta M, Herault L, Gueguen P, Gfeller D, Berenstein AJ, Carmona SJ. Semi-supervised integration of single-cell transcriptomics data. *Nature Communications* 2024. doi:10.1038/s41467-024-45240-z — partial (corpus)
R4. Rautenstrauch P, Ohler U. Shortcomings of silhouette in single-cell integration benchmarking. *Nature Biotechnology* 2026. doi:10.1038/s41587-025-02743-4 — partial (repo)
R5. Nygaard V, Rødland EA, Hovig E. Methods that remove batch effects while retaining group differences may lead to exaggerated confidence in downstream analyses. *Biostatistics* 2016;17:29-39. doi:10.1093/biostatistics/kxv027 — partial (search)
R6. Antonsson SE, Melsted P. Batch correction methods used in single-cell RNA sequencing analyses are often poorly calibrated. *Genome Research* 2025;35:1832-1841 — partial (search)
R7. Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. *Genome Biology* 2014. doi:10.1186/s13059-014-0550-8 — partial (corpus)
R8. Hoffman GE, et al. Efficient differential expression analysis of large-scale single cell transcriptomics data using dreamlet. *Nature Communications* 17:9597 (2026). doi:10.1038/s41467-026-75680-8 (preprint doi:10.1101/2023.03.17.533005) — partial (repo)
R9. Crowell HL, Soneson C, Germain PL, Calini D, Collin L, Raposo C, Malhotra D, Robinson MD. muscat detects subpopulation-specific state transitions from multi-sample multi-condition single-cell transcriptomics data. *Nature Communications* 2020. doi:10.1038/s41467-020-19894-4 — partial (corpus)
R10. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — partial (corpus)
R11. Murphy AE, Skene NG. A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nature Communications* 2022. doi:10.1038/s41467-022-35519-4 — partial (corpus)
R12. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — partial (corpus)
R13. Korsunsky I, Millard N, Fan J, et al. Fast, sensitive and accurate integration of single-cell data with Harmony. *Nature Methods* 2019. doi:10.1038/s41592-019-0619-0 — partial (corpus)
R14. Haghverdi L, Lun ATL, Morgan MD, Marioni JC. Batch effects in single-cell RNA-sequencing data are corrected by matching mutual nearest neighbors. *Nature Biotechnology* 2018. doi:10.1038/nbt.4091 — partial (corpus)
R15. Johnson WE, Li C, Rabinovic A. Adjusting batch effects in microarray expression data using empirical Bayes methods. *Biostatistics* 2007;8:118-127. doi:10.1093/biostatistics/kxj037 — partial (corpus)
R16. Ritchie ME, Phipson B, Wu D, Hu Y, Law CW, Shi W, Smyth GK. limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 2015. doi:10.1093/nar/gkv007 — partial (corpus)
R17. Butler A, Hoffman P, Smibert P, Papalexi E, Satija R. Integrating single-cell transcriptomic data across different conditions, technologies, and species. *Nature Biotechnology* 2018. doi:10.1038/nbt.4096 — partial (corpus)
R18. Stuart T, Butler A, Hoffman P, Hafemeister C, Papalexi E, Mauck WM, Hao Y, Stoeckius M, Smibert P, Satija R. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — partial (corpus)
R19. Rousseeuw PJ. Silhouettes: a graphical aid to the interpretation and validation of cluster analysis. *Journal of Computational and Applied Mathematics* 1987;20:53-65. — unverified (memory)
R20. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt) | metric reference: silhouette, HVG overlap, PCR, cell cycle | port |
| https://github.com/lilab-bcb/pegasus | Yiming Yang, Joshua Gould, Bo Li (setup.py) | BSD-3-Clause (LICENSE) | kSIM reference | port |
| https://github.com/carmonalab/scIntegrationMetrics | Massimo Andreatta, Josep Garnica, Santiago Carmona (DESCRIPTION) | GPL-3 (LICENSE, DESCRIPTION) | CiLISI reference | reimplement |
| https://github.com/mikelove/DESeq2 | Michael I. Love (maintainer, DESCRIPTION) | LGPL (>= 3) (DESCRIPTION; no LICENSE file at root) | reference model form; comparator | reimplement (model); callout (comparator) |
| https://github.com/DiseaseNeurogenomics/dreamlet | Gabriel Hoffman (DESCRIPTION) | Artistic-2.0 (DESCRIPTION; no LICENSE file at root) | comparator | callout |
| https://github.com/HelenaLC/muscat | Helena L. Crowell, Pierre-Luc Germain, Charlotte Soneson, et al. (DESCRIPTION) | GPL-3 (DESCRIPTION) | comparator for subpopulation designs | callout |
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE copyright line) | Apache-2.0 (LICENSE) | DE chapter on aggregation before testing; 40/60 notebook | callout (text only) |
| https://github.com/ohlerlab/metrics_matter_manuscript_reproducibility | Pia Rautenstrauch (copyright holder, LICENSE) | BSD-3-Clause (LICENSE) | silhouette critique | callout |
