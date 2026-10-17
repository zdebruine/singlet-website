---
id: sample-level.sample_phenotype_prediction
title: Sample-level phenotype prediction from single-cell profiles
area: sample-level
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [annotation.cluster_label_assignment, qc.sample_level_qc]
feeds: [sample-level.multi_sample_power_analysis, abundance.phenotype_associated_cells]
reads: [layers/counts, obs/<sample_key>, obs/<donor_key>, obs/<label_key>, obs/<cell_type_key>, obs/<cohort_key>, uns/sample_table]
writes: [uns/phenotype_predictions, uns/phenotype_metrics, uns/phenotype_null, uns/phenotype_celltype_scores, uns/phenotype_provenance, models/phenotype]
devices: [cpu, cuda]
mcp_tool: singlet_sample_level_sample_phenotype_prediction
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Sample-level phenotype prediction from single-cell profiles

> Predicts a binary label for each donor from that donor's cells, validates on donors held out from fitting, and reports which cell types carry the predictive signal.

## 1. Question

Given the cells of each sample (donor) and one sample-level label, such as disease status, exposure or treatment response, can a model predict the label for donors it has not seen, and which cell types drive the prediction? Inputs are raw counts with sample, donor and label keys, plus optional cell-type and cohort keys. Outputs are a predicted probability per held-out donor, cell-type importance scores, and donor-held-out performance with a permutation null. A correct answer gives held-out donor AUROC and calibration that hold for donors and cohorts absent from fitting, and importance scores that recover signal planted in simulation.

## 2. Why this task matters and where the field stands

Many single-cell studies compare individuals, and the practical question is whether a cell profile carries a signal that generalises to new individuals. This differs from differential expression, which tests one contrast, and from unsupervised patient stratification, which uses no labels. The donor is the unit of inference. Treating cells as independent replicates inflates false discoveries [R2, R3]. Aggregating cells to one profile per sample and cell type performs well in benchmarks [R4] and underlies multi-sample frameworks [R5]. The Single-cell Best Practices book, of which [R1] is the review article, makes the same warning.

The published heuristic standard for condition-associated cell types is Augur, which ranks cell types by the cross-validated AUC of a per-type classifier [R6]. Augur answers which cell types respond. It does not predict a donor's label, and its default folds split cells rather than donors. Model-based sample-aware methods exist. MrVI models sample-level heterogeneity with a deep generative model [R7]. GEDI models latent variation attributed to sample covariates [R8]. CellCnn detects phenotype-associated cell subsets from multi-cell inputs [R10, R11]. Published benchmarks cover differential expression and cell-type prioritisation, not sample-level prediction, so the benchmarks in section 8 are proposals.

Status: **contested**. The field disagrees on whether donor-level pseudobulk or cell-level learners should predict phenotype, and on how cell-level attribution should be scored. Open problems:

- Donor number, not cell number, is the effective sample size, and pseudoreplication obscures this [R2, R3]. Power planning is treated in sample-level.multi_sample_power_analysis.
- Disease signal must be separated from cohort, batch and depth, which models can exploit as shortcuts [R1].
- Cell-level importance from multi-cell models, as in CellCnn [R10], has no real-data ground truth.
- Using sample-aware latents for held-out donor prediction is an extension that has not been benchmarked [R7].

## 3. Theory and insight

Donor $s=1,\dots,S$ has a binary label $y_s$, constant within the donor, and cell profiles $x_{sc}$ for $c=1,\dots,m_s$. A sample model maps the cell set to a score $\hat p_s$ that estimates $P(y_s=1\mid\text{cells of }s)$. Pooling forms a donor vector $x_s$ (pseudobulk counts per cell type, composition, or averaged embeddings) and fits a classifier on it. Aggregation fits a cell-level classifier and averages its scores per donor, as Augur does. Only pooling has an explicit donor-level likelihood, which is why it is the model-based route here.

**Pseudobulk logistic model.** With $x_s$ the donor feature vector,

$$
\hat\beta_0,\hat\beta=\arg\min_{\beta_0,\beta}\ -\frac{1}{S}\sum_{s=1}^{S}\Big[y_s\log\sigma(\beta_0+x_s^{\top}\beta)+(1-y_s)\log\big(1-\sigma(\beta_0+x_s^{\top}\beta)\big)\Big]+\lambda\Big[\alpha\lVert\beta\rVert_1+\tfrac{1-\alpha}{2}\lVert\beta\rVert_2^2\Big]
$$

This is a penalised logistic likelihood with donors as independent units [R15]. Regime: $p$ can exceed $S$, so the penalty is required. The statement is a GLM result with no distributional claim beyond logit linearity. $\lambda$ and $\alpha$ come from inner donor-grouped cross-validation.

**Donor variance.** Under $x_{sc}=\mu+b_s+\varepsilon_{sc}$ with $b_s\sim\mathcal N(0,\sigma_b^2)$ and $\varepsilon_{sc}\sim\mathcal N(0,\sigma_w^2)$,

$$
\operatorname{Var}(\bar x_s)=\sigma_b^2+\frac{\sigma_w^2}{m_s}.
$$

Adding cells reduces only the within-donor term, so beyond $m_s\gg\sigma_w^2/\sigma_b^2$ extra cells carry almost no donor-level information. Regime: Gaussian first and second moments, a balanced design, and cell noise independent given the donor effect. Shared processing batches break the last condition.

**Donor AUROC.** The Mann-Whitney identity, exact for the empirical sample, with $n_1$ case and $n_0$ control donors:

$$
\widehat{\mathrm{AUC}}=\frac{1}{n_1 n_0}\sum_{i:\,y_i=1}\ \sum_{j:\,y_j=0}\Big(\mathbf 1[\hat p_i>\hat p_j]+\tfrac12\mathbf 1[\hat p_i=\hat p_j]\Big).
$$

Units must be donors. Pseudoreplicates inflate $n_1$ and $n_0$.

**Permutation null.** With $T_b$ the statistic after $B$ label permutations,

$$
p=\frac{1+\#\{b:\,T_b\ge T_{\mathrm{obs}}\}}{B+1}.
$$

This is valid only when labels are exchangeable across donors within cohort strata. Permuting cell labels is invalid, because the cells of one donor share a label.

**Calibration.** Over $M$ equal-width bins of predicted probability on $S$ held-out donors, with $\bar y(B_b)$ the observed case fraction and $\bar{\hat p}(B_b)$ the mean prediction in bin $B_b$,

$$
\mathrm{ECE}=\sum_{b=1}^{M}\frac{|B_b|}{S}\,\bigl|\bar y(B_b)-\bar{\hat p}(B_b)\bigr|.
$$

It is unstable when bins hold few donors, so bin counts and bootstrap intervals are reported.

**Estimands.** Each quantity is defined as follows.

- Donor score $\hat p_s$: the fitted GLM probability for donor $s$, from log(1+CPM) of its pseudobulk over retained genes, calibrated on held-out donors only.
- Donor AUROC: the probability that a random case donor scores above a random control donor, with ties counted one half.
- Cell-type importance $I_k$: the sum over retained genes of $|\hat\beta_{kg}|$ times the across-donor standard deviation of $x_{skg}$, normalised to sum to one over cell types. Defined for the linear predictor only.
- Augur score: the cross-validated cell-level AUC of a per-type classifier for the donor label broadcast to cells. It measures cell-level separability, which includes donor identity.
- Planted truth: a cell is a member if its type is in the responsive set. The per-type effect is the log2 fold change of case over control donors on that type's planted genes.
- ECE: the expected gap between predicted and observed case fraction over held-out donors.

**Regime of validity.** The variance and GLM statements are first- or second-order approximations. AUROC is exact for the empirical sample. The permutation test is exact under donor exchangeability within strata.

**Insight.** The effective sample size is the number of donors. Cell-level models can reach high accuracy within a dataset by recognising donors, so donor-grouped and cohort-held-out validation is the correctness criterion. Attention-based pooling [R17] weights cells by a convex combination, so a rare responsive subset is diluted unless the weights concentrate on it. Concentration is a property of the fitted model, not evidence of a causal cell effect. A pseudobulk model gives probabilities, regularised coefficients, donor-bootstrap intervals and a reusable predictor with stored preprocessing. Heuristic rankings give none of these.

**Assumptions.**

- Donors are independent draws from the population of interest, and the label is constant within a donor.
- Cell-type annotations are accurate and were not derived from the label or from test donors.
- Cohort, batch and depth are absent, modelled, or not confounded with the label.
- Importance measures dependence of the fitted model on a feature, not a causal effect of the phenotype.

**Failure modes.**

- Donor leakage: Augur's default folds split cells, so donors straddle training and test folds (defaults in section 4).
- Shortcut learning through cohort, batch, ambient RNA or depth when these correlate with the label [R1].
- Feature, HVG or normalisation fits on all donors before splitting leak test labels.
- Few donors give wide intervals and optimistic selection when choices are made outside cross-validation.
- Compositional closure: proportions sum to one, so one shift changes all others, and coefficients on proportions are not identifiable without a reference [R12].
- AUROC ignores calibration, so a model can rank donors well and still give unusable probabilities.
- Cell-level importance (attention, filters, Augur AUC) varies across seeds and is unvalidated for phenotype on real data.
- Pseudoreplication inflates significance in cell-level tests [R2, R3].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Augur cell-type prioritisation | hybrid | per-type random forest on subsampled cells, scored by cross-validated AUC | [R6] |
| Donor pseudobulk elastic-net logistic | model-based | penalised logistic regression on donor-by-gene pseudobulk | [R4], [R15] |
| Donor cell-type composition forest | hybrid | random forest on donor cell-type fractions | [R16] |
| MrVI sample-aware latents | model-based | deep generative model with sample-aware latent variables; donor summaries of these latents are fed to a classifier here (extension) | [R7] |
| scPoli conditional embedding | model-based | conditional VAE with learned condition embeddings, summarised per donor | [R18], [R9] |
| CellCnn multi-cell convolution | model-based | convolutional filters over cell sets detect subsets tied to a phenotype | [R10], [R11] |

Augur is the published heuristic standard for cell-type prioritisation with condition labels, and it stays as a comparator for cell-type importance. No published standard exists for donor-level prediction. Pseudobulk with donor-level inference is the best-supported design in differential-expression benchmarks [R2, R4], so it is the proposed default. The composition forest is the simplest donor baseline. MrVI, scPoli and CellCnn are comparators executed through their own packages.

Defaults of the published methods, from source code at the stated commit:

| Method | Parameter | Value | Source |
|---|---|---|---|
| Augur | `n_subsamples` | 50 | R/calculate_auc.R:134 @ b252b84 |
| Augur | subsample size | 20 cells per cell type and condition | R/calculate_auc.R:135 @ b252b84 |
| Augur | folds | 3, stratified by label, split over cells | R/calculate_auc.R:136; split at 564-566 @ b252b84 |
| Augur | `var_quantile` | 0.5 | R/calculate_auc.R:138 @ b252b84 |
| Augur | `feature_perc` | 0.5 | R/calculate_auc.R:139 @ b252b84 |
| Augur | `n_threads` | 4 | R/calculate_auc.R:140 @ b252b84 |
| Augur | random forest | 100 trees, mtry 2 | R/calculate_auc.R:146-147 @ b252b84 |
| Augur | permute mode | labels shuffled across cells; fewer than 100 subsamples raised to 500 | R/calculate_auc.R:334-338, 478 @ b252b84 |
| augurpy | permute mode | labels shuffled across obs rows (cells) | src/pertpy/tools/_augur.py:342 @ c246f24 |
| decoupler | `min_cells` per donor pseudobulk | 10 | src/decoupler/pp/anndata.py:442 @ 3132edc |
| decoupler | `min_counts` per donor pseudobulk | 1000 | src/decoupler/pp/anndata.py:443 @ 3132edc |
| MrVI | `n_latent_sample` | 16 | src/scvi/external/mrvi/_module.py:79 @ 5555ecc |

## 5. Proposed singlet approach

**Routes.** `pseudobulk_enet` (default): reimplement. Aggregation and the penalised logistic solver are written in singlet from the formulation in section 3, with the donor filters starting from the section 4 values. `celltype_proportion_rf`: port. Composition features and donor splitting are singlet code, and the forest is delegated to a permissively licensed library [R16]. Augur, augurpy, MrVI, scPoli and CellCnn are callouts, executed from their own packages only as benchmark comparators.

**Model.** For donor $s$, cell type $k$ and retained gene $g$, the feature is $\log(1+\mathrm{CPM})$ of the donor pseudobulk. Features are concatenated over cell types, or pooled when `cell_type_key` is absent. The fit is the section 3 model, with $\lambda$ and $\alpha$ chosen by inner donor-grouped cross-validation over a proposed grid. Probabilities are recalibrated by Platt scaling fitted only inside training folds (proposed). Uncertainty comes from donor-level bootstrap (2000 resamples) and the permutation null.

**Falsification.** The default is revised if, at 40 or more donors in B1, its held-out AUROC is not above 0.5 with a bootstrap interval excluding 0.5, if its B3 false-positive rate leaves the band, or if its B4 top-k recall stays below 0.8 at matched accuracy. A donor-level hierarchical extension with cell-type random effects is the next candidate. It enters the MCP enum after its primary paper has been read and B1 and B3 are met.

**Stack and kernels.** The two enum methods need no deep-learning framework. Pseudobulk aggregation is a sparse product of a donor-by-cell indicator and the cell-by-gene count matrix. It is computed in streamed cell chunks, with cuSPARSE on CUDA and a sparse CPU kernel otherwise, so memory scales with donors times retained genes. The solver is accelerated proximal gradient on the dense donor-by-feature matrix, hard-coded for CUDA. PyTorch is reserved for future deep sample models, which are outside the enum. CPU and CUDA paths must agree on coefficients to a relative tolerance of $10^{-5}$ (proposed).

**Defaults used without asking.** `method` pseudobulk_enet; `cv` grouped_kfold with 5 folds; `n_hvg` 2000, selected inside training folds; `n_perm` 1000; `donor_key` falls back to `sample_key`; `cohort_key`, when present, enables leave-cohort-out; `seed` 0.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts; required for pseudobulk sums |
| read | obs/`sample_key` | string | sample ID per cell; required |
| read | obs/`donor_key` | string | donor ID for all splits and permutations |
| read | obs/`label_key` | binary | sample label broadcast to cells, or read from uns/sample_table |
| read | obs/`cell_type_key` | category | cell-type labels; optional |
| read | obs/`cohort_key` | category | cohort IDs for leave-cohort-out and stratified permutation; optional |
| read | uns/sample_table | table | one row per donor: label and covariates |
| write | uns/phenotype_predictions | table | donor_id, cohort, fold, y_true, prob |
| write | uns/phenotype_metrics | table | donor AUROC with interval, balanced accuracy, Brier, ECE |
| write | uns/phenotype_null | table | permutation distribution and p-value |
| write | uns/phenotype_celltype_scores | table | cell-type importance, interval and rank |
| write | uns/phenotype_provenance | record | seed, split IDs, HVG list, package versions |
| write | models/phenotype | model | fitted weights and preprocessing |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "pseudobulk_enet" | `pseudobulk_enet`, `celltype_proportion_rf` | Donor model: pseudobulk_enet (default) or a forest on donor cell-type composition only. |
| `sample_key` | string | required | — | obs column with the sample ID of each cell. |
| `label_key` | string | required | — | obs column or uns/sample_table column with a binary label (0 or 1), constant within each donor. |
| `design` | object | — | — | Donor identity, cohort, cell-type and validation settings shared by all methods. |
| `design.donor_key` | string | — | — | obs column with the donor ID; defaults to sample_key. |
| `design.cohort_key` | string | — | — | obs column with cohort or study ID; enables leave-cohort-out and stratified permutation. |
| `design.cell_type_key` | string | — | — | obs column with cell-type labels for per-type pseudobulk and composition features. |
| `design.cv` | string | "grouped_kfold" | `grouped_kfold`, `leave_one_donor_out`, `leave_one_cohort_out` | Outer validation scheme; all splits are grouped by donor. |
| `design.n_folds` | integer | 5 | min 2 | Outer folds for grouped cross-validation. |
| `design.n_perm` | integer | 1000 | min 0 | Donor-level label permutations within cohort strata for the null. |
| `design.n_hvg` | integer | 2000 | min 1 | Highly variable genes, selected inside training folds only. |
| `pseudobulk_enet` | object | — | — | Options for the penalised logistic model on donor pseudobulk. |
| `pseudobulk_enet.min_cells` | integer | 10 | min 0 | Minimum cells per donor pseudobulk (decoupler default). |
| `pseudobulk_enet.min_counts` | integer | 1000 | min 0 | Minimum total counts per donor pseudobulk (decoupler default). |
| `pseudobulk_enet.alpha` | number | 0.5 | min 0; max 1 | Starting elastic-net mixing (1 is lasso); inner grouped CV also searches alpha. |
| `celltype_proportion_rf` | object | — | — | Options for the forest on donor cell-type composition. |
| `celltype_proportion_rf.n_trees` | integer | 500 | min 1 | Trees in the forest (proposed default). |
| `celltype_proportion_rf.pseudocount` | number | 0.5 | min 0 | Pseudocount added before the centred log-ratio of proportions. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `seed` | integer | 0 | — | Random seed for donor splits, permutations and model initialisation. |
<!-- PARAMS:AUTO:END -->

Parameters under `design` apply to every method. `pseudobulk_enet` options apply only to that method, and `celltype_proportion_rf` options only to the forest. `donor_key` must nest `sample_key`, and a label that varies within a donor is an error. When `cohort_key` is set, permutations stay within cohort strata. `n_hvg` is applied inside training folds only.

## 7. MCP tool

Tool `singlet_sample_level_sample_phenotype_prediction`, definition in `tasks/mcp/singlet_sample_level_sample_phenotype_prediction.json`. Example dry-run call and result (estimate values are null in this example):

```json
{"dataset": "atlas.singlet", "method": "pseudobulk_enet", "sample_key": "sample", "label_key": "disease", "design": {"donor_key": "donor", "cohort_key": "study", "cell_type_key": "cell_type"}, "dry_run": true}
{"dataset": "atlas.singlet", "status": "dry_run", "wrote": [], "summary": {}, "provenance_id": null, "job_id": null, "estimate": {"seconds": null, "peak_memory_gb": null, "device": "cpu"}}
```

Long-running: permutation nulls make completed fits long, and above the server's inline limit the call returns `queued` with a `job_id`. Stochastic: `seed` controls donor splits, permutations and model initialisation. Dry run: returns the time, memory and device estimate without fitting.

## 8. Benchmarks

**Shared protocol.** Donors are the unit throughout. Outer splits are donor-grouped (leave-one-donor-out below 20 donors), and hyperparameters are tuned in inner donor-grouped cross-validation. Feature selection, normalisation and any integration are fitted inside training folds or on unlabelled data only. Each benchmark uses 10 seeds (proposed), and intervals come from donor-level bootstrap with 2000 resamples. All comparators share splits. Hardware and thread counts are recorded in `uns/phenotype_provenance`.

### Generator G (shared by B1 to B4)

1. Base expression: splatter [R14] with parameters estimated from Kang et al. [R13], as in Augur's `sc_sim` toy dataset.
2. Cell types $K$ and genes $p$ are design settings (proposed $K=10$, $p=5000$).
3. Donor effects: multiply each gene in each donor by $\exp(b_{dg})$, with $b_{dg}\sim\mathcal N(0,\sigma_b^2)$ and $\sigma_b=0.2$ (proposed).
4. Labels: $y_d\sim\mathrm{Bernoulli}(0.5)$ within cohort strata. Donor counts are a proposed grid from 20 to 160.
5. Planted signal: choose $K_r$ responsive types (proposed 1 to 3). For case donors, multiply 50 planted genes per responsive type by $2^{\delta_k}$, where $\delta_k$ is the planted log2 fold change on proposed grid 0.25, 0.5, 1. $\delta=0$ gives the null.
6. Cohort structure (B2 only): cohorts differ in library size and ambient mixture. In the shortcut design, case prevalence is 0.8, 0.5 and 0.2 across three cohorts (proposed).
7. Outputs: counts, donor, cohort, cell type, label, a per-cell membership flag (type in the responsive set), and the planted $\delta_k$ per type.

### B1. Donor-held-out prediction on generated cohorts

- **Goal**: Measure held-out donor AUROC and calibration of the default and comparators under known planted signal, and the donor-count curve.
- **Ground truth**: planted simulation. The donor label is known by construction, and the estimand is donor-level AUROC on donors held out from fitting.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G, planted design, $\delta$ grid | Generator G; [R13], [R14] | simulated scRNA-seq, human-like parameters; 20 to 160 donors (proposed) | generated | donor-count curve by subsampling training donors to 10 to 100 percent at fixed test donors |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Donor AUROC | Mann-Whitney on pooled held-out probabilities, ties counted one half; per-fold mean also reported | maximise | primary | — |
| Balanced accuracy | mean of sensitivity and specificity at 0.5, or at a threshold set inside training folds | maximise | guardrail | — |
| Brier score | mean squared difference between predicted probability and 0/1 label | minimise | guardrail | — |
| ECE | 10 equal-width bins over held-out donors (section 3) | minimise | guardrail | — |

- **Comparators**: label-prior floor (constant training prevalence); `pseudobulk_enet`; `celltype_proportion_rf`; Augur's per-type forest applied to cells and averaged per donor, with default cell-level folds and with donor-grouped folds (callout).
- **Protocol**: outer donor-grouped 5-fold cross-validation. The donor-count curve is a two-parameter saturating exponential in log donors, fitted descriptively.
- **Acceptance criterion** (proposed): at 40 or more donors, `pseudobulk_enet` mean held-out AUROC is above 0.5 with a donor-bootstrap 95 percent interval excluding 0.5, and held-out ECE is at most 0.10. The donor-count curve has no decision threshold and is reported with intervals.
- **Known pitfalls**: AUROC is comparable only at matched donor numbers. Augur's default cell-level folds leak donors, and this benchmark measures that inflation rather than assuming it.

### B2. Cohort-held-out transfer under a planted shortcut

- **Goal**: Test whether donor-level signal survives withholding a whole cohort when cohort identity is correlated with the label.
- **Ground truth**: planted simulation with cohort-level prevalence set by design. The estimand is donor AUROC on the held-out cohort, with prevalence reported.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G, shortcut design | Generator G, step 6 | simulated scRNA-seq; 3 cohorts of at least 20 donors (proposed) | generated | case prevalence 0.8, 0.5 and 0.2 by cohort (proposed) |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cohort-held-out donor AUROC | as B1, with each fold a whole cohort; pooled and per cohort | maximise | primary | — |
| Within-to-across drop | within-cohort donor AUROC minus cross-cohort donor AUROC | minimise | guardrail | — |

- **Comparators**: `pseudobulk_enet` uncorrected; `pseudobulk_enet` with cohort-centred features (each gene centred on its cohort's donor mean, computed from unlabelled donors); `celltype_proportion_rf`.
- **Protocol**: leave-one-cohort-out over the three cohorts; per-cohort and pooled AUROC; otherwise the shared protocol.
- **Acceptance criterion** (proposed): cross-cohort AUROC at least 0.60 in at least two of three held-out cohorts, and a within-to-across drop at most 0.10 for `pseudobulk_enet`.
- **Known pitfalls**: Cohort-centring removes the label shift when prevalence differs across cohorts, so it is scored with prevalence reported. Brier score and ECE depend on prevalence and are compared only at matched prevalence.

### B3. Donor-level label-permutation null

- **Goal**: Check that the donor-level permutation test has its nominal false-positive rate, and that cell-level label shuffling does not.
- **Ground truth**: consistency. With $\delta=0$ every rejection is false, so the null holds by construction.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G null design, $\delta=0$ | Generator G, step 5 with $\delta=0$ | simulated scRNA-seq; 40 donors per replicate (proposed); 200 replicates | generated | labels permuted within cohort strata |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Empirical false-positive rate | fraction of replicates with $p\le0.05$ (section 3) | target band 0.02 to 0.08 | primary | — |
| Null AUROC mean | mean donor AUROC over permuted labels | target 0.5 within 0.05 | guardrail | — |

- **Comparators**: Augur permute mode with labels shuffled across cells (callout), reported as a demonstration of anti-conservative behaviour.
- **Protocol**: each replicate uses 199 donor-level permutations within cohort strata (proposed; smallest attainable $p$ is 0.005), recomputing the full pipeline and inner cross-validation for each permutation. 200 replicates.
- **Acceptance criterion** (proposed): for `pseudobulk_enet`, false-positive rate within [0.02, 0.08] and null AUROC mean within 0.05 of 0.5.
- **Known pitfalls**: Reusing the outer fit without refitting inner cross-validation under each permutation understates the null variance. A null that permutes labels across cohorts mixes cohort effects into the null.

### B4. Planted-signal attribution recovery

- **Goal**: Test whether cell-type importance recovers responsive types at matched accuracy when the planted effect lies in expression, not composition.
- **Ground truth**: planted simulation. Membership is per cell by type, and the per-type effect is the planted log2 fold change. Both are known by construction.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G planted design | Generator G, steps 1 to 5 | simulated scRNA-seq; $K=10$, $K_r$ of 1 to 3 (proposed); 10 seeds | generated | $\delta$ grid 0.25, 0.5, 1 (proposed) |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cell-type top-k recall | $k$ = number of planted types; fraction of planted types among the top $k$ ranked | maximise | primary | [R6] |
| Cell-level AUPRC | each cell scored by its type's importance on held-out donors; prevalence baseline is the planted-cell fraction | maximise | primary | — |
| Effect-size rank correlation | Spearman correlation between importance and planted $\delta_k$ across types | maximise | guardrail | — |

- **Comparators**: `pseudobulk_enet` importance $I_k$ (section 3); `celltype_proportion_rf` permutation importance, a negative control because the planted effect is expression-only; Augur default cell-type AUC ranking (callout).
- **Protocol**: attribution is scored on held-out donors and reported in held-out AUROC bands (0.6 to 0.7, 0.7 to 0.8, 0.8 and above; proposed) to compare at matched accuracy.
- **Acceptance criterion** (proposed): top-k recall at least 0.8 at effect sizes where held-out donor AUROC is at least 0.8. Any attribution method reports the matched-accuracy band.
- **Known pitfalls**: At low accuracy recall is near chance, so recall without the accuracy band misleads. Failure of the composition control is expected and is not a defect.

### P1. Performance and scaling

Wall time and peak memory for fitting and for scoring held-out donors, on CPU and CUDA, at 10k, 100k and 1M cells, and 10M cells for the streamed path, with 40 and 400 donors (proposed). Inference-only tests extend to the 354M-cell catalogue. Comparators: the Augur default (R package), augurpy, and a decoupler plus scikit-learn pseudobulk pipeline. Fixed: 2,000 HVGs, 4 threads (Augur default), 5 folds, seed, and hardware. Training and inference per donor are reported separately. Augur's default costs 150 classifier fits per cell type (50 subsamples times 3 folds), so its time scales with the number of cell types.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
- **Feeds**:
  - `sample-level.multi_sample_power_analysis`: Power and sample-number planning for multi-sample designs
  - `abundance.phenotype_associated_cells`: Cell neighbourhoods whose abundance covaries with a sample-level phenotype
- **Reads**: `layers/counts`, `obs/<sample_key>`, `obs/<donor_key>`, `obs/<label_key>`, `obs/<cell_type_key>`, `obs/<cohort_key>`, `uns/sample_table`
- **Writes**: `uns/phenotype_predictions`, `uns/phenotype_metrics`, `uns/phenotype_null`, `uns/phenotype_celltype_scores`, `uns/phenotype_provenance`, `models/phenotype`
<!-- CHAINING:AUTO:END -->

Sits in the sample-level workflow after donor-level QC and cell-type annotation.

## 10. Risks, pitfalls and open questions

- **First experiment.** Establish B1 and B3 for `pseudobulk_enet` on generated donors before any claim about real cohorts. Then inventory donor, cohort and label coverage in the catalogue, which decides whether real-data versions of B1 and B2 can be defined.
- **Real-data truth.** No published benchmark of held-out donor prediction on single-cell data was located, and attribution has no real-data truth. Real-data results will therefore compare predictive accuracy only.
- **Method evidence.** Attention-based multiple instance learning [R17] and set-function networks were not read against their primary papers, so they are excluded from the tables and enum. CellCnn is read only through the PriCell Go implementation in the ldsec repository, so its defaults are unrecorded. scikit-learn was checked at repository level, not for its forest or solver source.
- **Licences and scope.** Licence conflicts for the Augur, pertpy and scarches repositories are recorded in section 12 and must be resolved before any code is reused. The CellCnn repository's example data (a CMV-infection NK dataset) is not used here.
- **Unsettled literature.** Whether donor-level pseudobulk or cell-level learners predict phenotype better is unsettled. Most methods do not separate composition from expression signal, so a positive B1 result does not identify its source without B4. Continuous donor labels are unbenchmarked and outside the binary input of the tool.

## 11. References

R1. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nat Rev Genet* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R2. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nat Commun* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R3. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nat Commun* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)
R4. Murphy AE, Skene NG. A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nat Commun* 2022. doi:10.1038/s41467-022-35519-4 — verified (corpus)
R5. Crowell HL, Soneson C, Germain PL, et al. muscat detects subpopulation-specific state transitions from multi-sample multi-condition single-cell transcriptomics data. *Nat Commun* 2020. doi:10.1038/s41467-020-19894-4 — verified (corpus)
R6. Skinnider MA, Squair JW, Kathe C, et al. Cell type prioritization in single-cell data. *Nat Biotechnol* 2021. doi:10.1038/s41587-020-0605-1 — verified (corpus)
R7. Boyeau P, Hong J, Gayoso A, et al. Deep generative modeling of sample-level heterogeneity in single-cell genomics. *Nat Methods* 2025. doi:10.1038/s41592-025-02808-x — verified (corpus)
R8. Madrigal A, Lu T, Soto LM, Najafabadi HS. A unified model for interpretable latent embedding of multi-sample, multi-condition single-cell data. *Nat Commun* 2024. doi:10.1038/s41467-024-50963-0 — verified (search)
R9. Lotfollahi M, Naghipourfar M, Luecken MD, et al. Mapping single-cell data to reference atlases by transfer learning. *Nat Biotechnol* 2022. doi:10.1038/s41587-021-01001-7 — verified (corpus)
R10. Arvaniti E, Claassen M. Sensitive detection of rare disease-associated cell subsets via representation learning. *Nat Commun* 2017. doi:10.1038/ncomms14825 — verified (search)
R11. Sav S, Bossuat JP, Troncoso-Pastoriza JR, Claassen M, Hubaux JP. Privacy-preserving federated neural network learning for disease-associated cell classification. *Patterns* 2022. doi:10.1016/j.patter.2022.100487 — verified (repo)
R12. Büttner M, Ostner J, Müller CL, Theis FJ, Schubert B. scCODA is a Bayesian model for compositional single-cell data analysis. *Nat Commun* 2021. doi:10.1038/s41467-021-27150-6 — verified (corpus)
R13. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nat Biotechnol* 2018. doi:10.1038/nbt.4042 — verified (corpus)
R14. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biol* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R15. Zou H, Hastie T. Regularization and variable selection via the elastic net. *J R Stat Soc Series B* 2005. — unverified (memory)
R16. Pedregosa F, Varoquaux G, Gramfort A, et al. Scikit-learn: machine learning in Python. *J Mach Learn Res* 2011. — verified (corpus)
R17. Ilse M, Tomczak JM, Welling M. Attention-based deep multiple instance learning. *Proc ICML* 2018. — unverified (memory)
R18. Population-level integration of single-cell datasets enables multi-scale analysis across samples. *Nat Methods* 2023. doi:10.1038/s41592-023-02035-2 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/neurorestore/Augur | Michael Skinnider (copyright line in LICENSE) | Conflict: LICENSE contains MIT text; DESCRIPTION states GPL-3 | default settings of the published heuristic comparator | callout |
| https://github.com/scverse/pertpy | Lukas Heumos (2021 copyright line in LICENSE); scverse® | Conflict: LICENSE is MIT; CITATION.cff and README state Apache-2.0 | augurpy permute mode (comparator) | callout |
| https://github.com/scverse/decoupler | scverse®; Pau Badia i Mompel and Saez lab (LICENSE copyright lines) | BSD-3-Clause (LICENSE) | pseudobulk filter defaults | reimplement |
| https://github.com/scikit-learn/scikit-learn | scikit-learn developers (CITATION.cff lists Pedregosa F et al.) | BSD-3-Clause (COPYING) | forest for celltype_proportion_rf | port |
| https://github.com/scverse/scvi-tools | scvi-tools development team (pyproject authors); LICENSE copyright names Yosef Lab, Weizmann Institute of Science | BSD-3-Clause (LICENSE) | MrVI comparator | callout |
| https://github.com/theislab/scarches | Mohammad Lotfollahi and Theislab (LICENSE copyright line) | Conflict: LICENSE is BSD-3-Clause; setup.py states MIT | scPoli code comparator | callout |
| https://github.com/ldsec/cellCNN | ldsec (EPFL) group; README cites Sav S, Bossuat JP, Troncoso-Pastoriza JR, Claassen M, Hubaux JP | EPFL non-commercial academic licence (custom LICENSE) | CellCnn comparator (PriCell Go implementation) | callout |
