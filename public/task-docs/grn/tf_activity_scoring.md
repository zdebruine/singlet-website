---
id: grn.tf_activity_scoring
title: Per-cell or per-sample TF activity scoring from a prior regulon network
area: grn
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [normalization.size_factor_estimation, harmonization.gene_identifier_mapping, grn.prior_network_curation]
feeds: [grn.upstream_regulator_inference, perturbation.perturbation_effect_estimation, sample-level.sample_phenotype_prediction]
reads: [layers/lognorm, uns/regulon_<prior>]
writes: [obsm/tf_activity_<method>, obsm/tf_activity_pvalue_<method>, obsm/tf_activity_call_<method>, uns/tf_activity_<method>_params]
devices: [cpu, cuda]
mcp_tool: singlet_grn_tf_activity_scoring
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Per-cell or per-sample TF activity scoring from a prior regulon network

> Score each transcription factor's activity in every cell or pseudobulk sample from a signed prior regulon network, so that a factor perturbed in an experiment shows the expected activity change.

## 1. Question

Given a log-normalised expression matrix (cells or pseudobulk samples by genes) and a prior table of signed TF-target regulons, what is the activity of each TF in each observation? A correct answer gives the expected sign and rank for TFs that were knocked down or overexpressed in matched experiments, and scores that do not track library size or detection rate. Outputs are an observation-by-TF score matrix, optional p-values and binary top-fraction calls [R1][R2].

## 2. Why this task matters and where the field stands

Transcription factor (TF) activity is inferred from the expression of target genes because TF transcript levels are a weak proxy for the protein activity that regulates them [R11][R12]. The task is **contested**. Holland et al. benchmark footprint and gene-set tools, including DoRothEA, PROGENy, AUCell and VIPER, on simulated and CRISPR-perturbed scRNA-seq [R2]. AUCell is the SCENIC standard for set activity in single cells [R5]. The best-practices chapter summarises Holland et al. as finding that bulk-derived methods perform well on simulated scRNA-seq and that the choice of gene sets matters more than the statistical method [R12]. Open problems:

- **Prior dependence.** Regulons differ between cell types and tissues, so one prior can bias scores across a large atlas [R12].
- **Calibration.** ULM and MLM p-values treat genes as independent observations, which co-expression violates [R1].
- **Dropout, depth and set size.** Rank-based scores depend on zeros and library size, and performance falls as the number of genes per set decreases [R10][R12].
- **Expression-only inference.** Expression-only network inference recovers known interactions barely better than random [R11][R12], so this task takes the prior as given.

## 3. Theory and insight

Every method maps an observation's profile $y_c\in\mathbb R^G$ to one score per regulon. Linear methods regress the profile on each regulon's signed weights. Rank and kernel methods use the order of features and discard magnitudes. The prior, more than the scoring statistic, determines what a score means.

| Symbol | Meaning |
|---|---|
| $y_c$, $y_{cg}$ | log-normalised profile of observation $c$ over $G$ features |
| $w_{gk}$, $W$ | signed weight of feature $g$ in regulon $k$ (activation positive, repression negative, zero for non-targets); $K$ regulons |
| $n_k$ | number of targets of regulon $k$ with $w_{gk}\neq0$ |
| $a_{ck}$ | latent activity of TF $k$ in observation $c$ |

**Linear footprint models.** ULM regresses each profile on one regulon at a time, $y_{cg}=\beta_0+\beta_1 w_{gk}+\varepsilon_{g}$, over all $G$ features, so non-targets enter with weight zero. Its t-value is

$$t_{ck}=\frac{r_{ck}\sqrt{G-2}}{\sqrt{1-r_{ck}^{2}}},\qquad r_{ck}=\operatorname{corr}_{g}\!\left(w_{gk},y_{cg}\right),$$

with a two-sided p-value from a Student t on $G-2$ degrees of freedom. MLM fits all regulons jointly with an intercept column, $X=[\mathbf 1\;W]$, so that $\hat\beta_c=(X^\top X)^{-1}X^\top y_c$, $\hat\sigma_c^2=\lVert y_c-X\hat\beta_c\rVert^2/(G-K-1)$ and $t_{ck}=\hat\beta_{c,k}/\bigl(\hat\sigma_c\sqrt{[(X^\top X)^{-1}]_{kk}}\bigr)$. Because $X$ is shared by all observations, MLM is one projection applied to every profile. Both statistics are exact regression quantities, and their p-values are exact only under Gaussian errors. Collinear regulons inflate standard errors, and the independence assumption makes the p-values anti-conservative.

**Analytic enrichment (VIPER, aREA).** Features are ranked within each observation, $q_{cg}=\operatorname{rank}_c(y_{cg})/(G+1)$, and converted to normal scores $z_{cg}=\Phi^{-1}(q_{cg})$. A tail term $\tilde z_{cg}$ is the normal score of a rescaled $\lvert q_{cg}-\tfrac12\rvert$. Then

$$S_1=\sum_g z_{cg}\,w_{gk}\,\lambda_{gk},\qquad S_2=\sum_g \tilde z_{cg}\,(1-\lvert w_{gk}\rvert)\,\lambda_{gk},\qquad \mathrm{NES}_{ck}=\bigl(\lvert S_1\rvert+S_2\mathbf 1\{S_2>0\}\bigr)\operatorname{sign}(S_1)\sqrt{n_k},$$

with $\lambda_{gk}=\mathbf 1\{w_{gk}\neq0\}/n_k$ and P-values from decoupler's VIPER implementation. The pleiotropy step recomputes a regulator's score with its targets that are shared with stronger regulators down-weighted. The normal approximation is coarse at large $G$, and ties at zero enter through the ranks.

**Rank and kernel set statistics.** AUCell ranks features in each observation (ordinal ranks of $-y_{cg}$ after a random feature shuffle) and takes the normalised area under the recovery curve of regulon members in the top $n_{\mathrm{up}}$ ranks:

$$\mathrm{AUC}_{ck}=\frac{\int_0^{n_{\mathrm{up}}}\mathrm{RC}_{ck}(r)\,dr}{A^{\max}(n_k,n_{\mathrm{up}})},\qquad \mathrm{RC}_{ck}(r)=\frac{\#\{g:\ w_{gk}\neq0,\ \operatorname{rank}_c(g)\le r\}}{n_k},$$

where $A^{\max}$ is the area when all members occupy the top ranks. AUCell uses membership only, so its scores lie in $[0,1]$ and are invariant to monotone per-observation transforms. GSVA estimates a kernel density of each feature across observations and scores a regulon with a random-walk deviation over the ranked features.

**Weighted aggregation.** waggr returns the weighted sum $\sum_g w_{gk}y_{cg}$ or the weighted mean $\sum_g w_{gk}y_{cg}/\sum_g\lvert w_{gk}\rvert$. Permutation p-values come from random reassignment of the weights to features. The mean stays in the units of the input layer and is comparable across regulons of different size; the sum grows with $n_k$.

**Estimands.** Each output is defined here; ground truths are defined with their benchmarks in section 8.

- ULM and MLM: a dimensionless standardised slope of the whole profile on the regulon's weights; MLM gives the same quantity partial to the other regulons.
- VIPER: a dimensionless, signed, weight-aware enrichment on normal scores.
- AUCell: a fraction in $[0,1]$ of the ideal top-rank area.
- waggr: the weighted mean in input-layer units, or the weighted sum.
- GSVA: a signed random-walk deviation per observation.

**Assumptions and failure modes.** Linear methods assume that target expression responds roughly additively to activity. Rank methods assume that the order of regulon members is informative. Signs must encode activation and repression. A target shared by two regulators inflates both, and pleiotropy correction addresses this only partly. Identifiers must match between data and prior, because the minimum-target filter removes regulons silently. Dropout and library size shift ranks. Generic programmes with large regulons, such as proliferation or interferon response, can dominate scores through prior structure. Collinear regulons destabilise MLM.

**Why heuristics work and what a model adds.** Rank and kernel statistics make no distributional assumption, tolerate sparsity and cost little, which is why they remain standard. They have no likelihood or model-based standard error. A Gaussian linear footprint model gives a posterior, a shared covariance and a reusable operator (section 5). A Bayesian noisy logic model has also been proposed for this task [R13]; its method is not described here.

**Complexity (derived, not benchmarked).** For $N$ observations, ULM and MLM cost $O(NGK)$, with one $(K+1)\times(K+1)$ inversion for MLM. AUCell and VIPER rank each observation at $O(G\log G)$.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| ULM | model-based | univariate regression of each profile on each regulon's signed weights; slope t-value | [R1] |
| MLM | model-based | joint regression on all regulons with an intercept; partial t-values | [R1] |
| VIPER (aREA with pleiotropy correction) | heuristic | rank-normal, weight-aware enrichment with down-weighting of shared targets | [R6] |
| AUCell | heuristic | area under the recovery curve of regulon members among top-ranked features | [R5] |
| GSVA | heuristic | kernel-density feature statistics with a random-walk deviation per observation | [R7] |
| waggr (weighted sum and mean) | heuristic | weight-aggregated expression with permutation p-values | [R1] |

ULM is the reference method in every benchmark here. MLM is its joint counterpart, and one projection serves all observations. AUCell is the SCENIC standard for set activity and uses membership only. VIPER's analytic aREA with pleiotropy correction is the analytic option that handles shared targets. Each row is implemented in decoupler (section 12).

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| all | `tmin` | 5 | src/decoupler/mt/_run.py:48 @3132edc |
| ULM | `tval` | True (t-value rather than slope) | src/decoupler/mt/_ulm.py:27 @3132edc |
| ULM | p-value degrees of freedom | $G-2$, two-sided | src/decoupler/mt/_ulm.py:97, 105 @3132edc |
| MLM | `tval` | True | src/decoupler/mt/_mlm.py:39 @3132edc |
| MLM | p-value degrees of freedom | $G-K-1$, intercept included | src/decoupler/mt/_mlm.py:112 @3132edc |
| VIPER | `pleiotropy` | True | src/decoupler/mt/_viper.py:172 @3132edc |
| VIPER | `reg_sign` | 0.05, converted to $z=1.96$ | src/decoupler/mt/_viper.py:173, 305 @3132edc |
| VIPER | `n_targets` | 10 | src/decoupler/mt/_viper.py:174 @3132edc |
| VIPER | `penalty` | 20 | src/decoupler/mt/_viper.py:175 @3132edc |
| AUCell | `n_up` | $\lceil 0.05G\rceil$ clipped to $[2,G]$ when None | src/decoupler/mt/_aucell.py:47-49 @3132edc |
| AUCell | ranking | ordinal rank of $-y$ after a feature shuffle | src/decoupler/mt/_aucell.py:110; src/decoupler/mt/_run.py:58 @3132edc |
| GSVA | `kcdf`, `maxdiff`, `absrnk`, `tau` | gaussian, True, False, 1 | src/decoupler/mt/_gsva.py:296-299 @3132edc |
| waggr | `fun`, `times`, `seed` | wmean, 1000, 42 | src/decoupler/mt/_waggr.py:144-146 @3132edc |

## 5. Proposed singlet approach

**Routes.** Each source's route is in section 12. The GPU kernels for AUCell, VIPER and GSVA follow the layout of the rapids-singlecell CUDA sources.

**Defaults.** The defaults are in the section 6 parameter table. A species-matched prior is required, because a mismatched prior loses regulons silently through `tmin`.

**Model-based formulation (proposed).** Activities are latent, and the prior is a fixed design matrix. With $W$ augmented by an intercept column,

$$y_c=W a_c+\varepsilon_c,\qquad \varepsilon_c\sim\mathcal N(0,\Lambda^{-1}),\qquad a_c\sim\mathcal N(0,\Psi),$$

with $\Lambda$ diagonal over features and $\Psi$ diagonal over TFs; the intercept has a flat prior. The posterior mean and covariance are

$$\hat a_c=M\,y_c,\qquad M=(W^\top\Lambda W+\Psi^{-1})^{-1}W^\top\Lambda,\qquad \operatorname{Cov}(a_c\mid y_c)=(W^\top\Lambda W+\Psi^{-1})^{-1}.$$

Neither $M$ nor the covariance depends on $c$. Every observation is therefore scored by one dense product, and the posterior covariance is shared across observations. MLM is the limit $\Psi^{-1}\to0$ with $\Lambda=\sigma^{-2}I$. ULM slopes equal MLM coefficients when the regulon columns are orthogonal to each other and to the intercept. The formulation is falsified if, on B1 and B3, its pooled AUROC is not higher than ULM with the same prior by at least 0.01 (paired bootstrap, 95% interval excluding zero; thresholds proposed). In that case ULM stays the default. A zero-inflated likelihood is deferred because it would make $M$ observation-specific.

**Stack and kernels.** PyTorch is not needed in the first version, because $M$ is a small dense matrix fixed per dataset; learned refinements of $W$ are out of scope. Hard-coded CUDA with cuBLAS applies $M$ and the sparse prior to observation batches, and per-row ranking kernels serve AUCell and VIPER. The CPU path uses sparse CSR products by observation chunk. AUCell and VIPER need all features of one observation at once, so their chunks are whole rows. Random tie-breaks use the seeded shuffle, so results are reproducible for a fixed seed.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/lognorm | float, cells or pseudobulk samples by genes | log-normalised expression (parameter `layer`); raw counts are not accepted |
| read | `uns/regulon_<prior>` | table with source, target, signed weight | regulon table from the prior step (parameter `prior`) |
| write | `obsm/tf_activity_<method>` | float32, observations by TFs | activity scores; estimands in section 3 |
| write | `obsm/tf_activity_pvalue_<method>` | float32, observations by TFs | raw p-values for ulm, mlm, viper and waggr; not multiplicity-corrected |
| write | `obsm/tf_activity_call_<method>` | bool, observations by TFs | top `call_frac` TFs per observation, written when `call_frac` is above zero |
| write | `uns/tf_activity_<method>_params` | mapping | method, prior name, `tmin`, seed, library versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "lognorm" | — | Log-normalised layer, cells or pseudobulk samples by genes; raw counts must not be passed. |
| `prior` | string | "collectri_human" | — | Name of a regulon table stored as uns/regulon_<prior>, such as collectri_human or dorothea_human. |
| `method` | string | "ulm" | `ulm`, `mlm`, `viper`, `aucell`, `gsva`, `waggr_wmean`, `waggr_wsum` | Scoring method. ulm is the default for signed weighted priors; aucell uses set membership only. |
| `tmin` | integer | 5 | min 1 | Minimum prior targets present in the layer for a regulon to be scored. |
| `call_frac` | number | 0.1 | min 0; max 0.5 | Top fraction of TFs per observation written as binary calls; 0 writes no calls. |
| `viper` | object | — | — | Options for method viper (aREA with pleiotropy correction). |
| `viper.pleiotropy` | boolean | true | — | Apply the shadow-regulon correction for targets shared with stronger regulators. |
| `viper.reg_sign` | number | 0.05 | max 1; > 0 | Two-sided significance threshold for regulators in the pleiotropy correction. |
| `viper.n_targets` | integer | 10 | min 1 | Minimum shared targets before a regulator pair enters the pleiotropy correction. |
| `viper.penalty` | number | 20 | min 1 | Penalty applied to shared targets in the pleiotropy correction. |
| `aucell` | object | — | — | Options for method aucell. |
| `aucell.n_up` | integer/null | null | min 2 | Top-ranked features used by the recovery curve; null uses ceil(0.05 G) clipped to [2, G]. |
| `seed` | integer | 42 | — | Seed for AUCell tie-break shuffles and waggr permutations; fixed for reproducibility. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Parameters under `viper` apply only to `method = viper`, and `aucell.n_up` only to `method = aucell`. `call_frac` applies to every method. `seed` affects AUCell tie-breaks and waggr permutations; ULM, MLM and VIPER are deterministic. The waggr permutation count and the GSVA options stay at the decoupler defaults in section 4. `tmin` removes regulons with too few targets present in the layer, and the number removed is returned in the summary. A repeat call on an existing output fails unless `overwrite` is set.

## 7. MCP tool

Tool name `singlet_grn_tf_activity_scoring` (definition in `tasks/mcp/singlet_grn_tf_activity_scoring.json`).

```json
{"dataset": "/data/example.singlet", "prior": "collectri_human", "method": "ulm", "call_frac": 0.1}
```

```json
{"dataset": "/data/example.singlet", "status": "completed",
 "wrote": ["obsm/tf_activity_ulm", "obsm/tf_activity_pvalue_ulm", "obsm/tf_activity_call_ulm", "uns/tf_activity_ulm_params"],
 "summary": {"method": "ulm", "prior": "collectri_human", "n_observations": "<int>",
   "n_regulons_scored": "<int>", "n_regulons_dropped_tmin": "<int>", "median_targets_matched": "<int>", "warnings": []},
 "provenance_id": "<string>"}
```

Long-running: no for in-memory inputs; large inputs may queue as a job with a `job_id`. Stochastic: yes, through `seed`, for AUCell tie-breaks and waggr permutations. Dry run: returns seconds, peak memory in GB and the device for the chosen method.

## 8. Benchmarks

**Shared protocol.** All methods receive the same log-normalised matrix, gene set and prior, and each comparison names its prior. Scores from different methods have different scales, so thresholds are never transferred between methods. Comparisons pair units (experiments, observations or guides) across methods. Accuracy is reported with paired bootstrap intervals over benchmark units, using 1000 resamples (proposed). The implementation check (proposed) requires singlet's ULM and MLM outputs to match decoupler's within $10^{-6}$ on identical inputs before any accuracy claim.

### B1. Holland in silico TF perturbation (simulated single cells)

- **Goal**: rank the TF perturbed in each source bulk experiment highest among candidate TFs, using simulated single cells.
- **Ground truth**: held-out bulk perturbation experiments transferred to simulated cells. Each source experiment has label 1 for its perturbed TF and 0 for every other TF. The direction (knockdown $-1$, overexpression $+1$) comes from the experiment metadata. The predictor is the direction times the limma log fold change of cell-level scores between perturbed and control simulated cells of that experiment.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Perturbation experiment metadata (ChEA3) | https://amp.pharm.mssm.edu/ChEA3, parsed in the Holland repository [R2] | human bulk RNA-seq, TF knockdown and overexpression; experiment count — | knockdown aliases map to inhibition, overexpression to activation |
| Bulk counts (ARCHS4) | https://amp.pharm.mssm.edu/archs4/, manual download per the repository [R2] | human bulk counts, converted to TPM; sample count — | TPM vector is the sampling distribution |
| Benchmark archive | Zenodo 10.5281/zenodo.3564179 [R2] | simulated and processed data; subset only | the full simulation exceeds the archive limit |

- **Simulation** (published protocol of the repository): library-size grid $L\in\{1000,2000,5000,10000,20000\}$, cells per sample $\in\{1,10,20,30,50,100\}$, 10 replicates. Each simulated cell draws $\lvert\operatorname{round}(\mathcal N(L,L/2))\rvert+1$ genes with replacement, weighted by TPM. Cells with fewer than 100 counts are dropped. The rest are scran size-factor normalised and log-transformed. Scores are contrasted with limma (perturbed minus control).
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ROC AUC over (experiment, TF) pairs | pooled within each replicate and grid cell; pairs with a TF absent from the prior are excluded; chance 0.5 | higher | primary | [R2] |
| PR AUC over the same pairs | chance equals the prevalence of positive pairs | higher | guardrail | [R2] |

- **Comparators**: ULM, MLM, VIPER and AUCell with DoRothEA regulons (human v1) at confidence sets A, AB, ABC, ABCD and ABCDE [R3], and ULM with CollecTRI [R4].
- **Protocol**: each grid cell and replicate is one unit. The shared protocol applies without change.
- **Acceptance criterion**: proposed. The candidate's ROC AUC is not below DoRothEA-ULM by more than 0.01 in at least 80% of grid cells, and the 95% paired-bootstrap interval of the difference over experiments excludes a loss larger than 0.02.
- **Known pitfalls**: pooling pairs across experiments assumes comparable score scales, so per-experiment normalisation changes the pooled AUC; simulation from bulk TPM understates cell-to-cell heterogeneity and dropout.

### B2. Holland in vitro CRISPR perturbation (Perturb-seq day 7 and day 13; CRISPRi)

- **Goal**: recover the TF targeted by each guide from single-cell activity contrasts.
- **Ground truth**: orthogonal measurement of guide identity, with knockdown quality control on the targeted TF. Only cells with exactly one guide are kept. The label is 1 for the targeted TF of each guide. The predictor is the sign times the limma contrast of guide cells against control cells (non-targeting or scramble guides) on single-cell activity scores, with sign $-1$ for CRISPRi knockdown.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Perturb-seq TF perturbations, day 7 and day 13 | Holland repository; archive Zenodo 10.5281/zenodo.3564179 [R2] | scRNA-seq with guide matrices; scored with human DoRothEA v1 regulons; cell count — | single-guide cells; intergenic guides as controls |
| CRISPRi TF perturbations | Holland repository, `data/in_vitro_benchmark/crispri` [R2] | scRNA-seq with CRISPRi guide matrix; cell count — | Scramble guides as controls |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ROC AUC pooled over guides | (guide, TF) pairs pooled over the three series; chance 0.5 | higher | primary | [R2] |
| PR AUC pooled over guides | same pairs | higher | guardrail | [R2] |
| QC pass rate | fraction of guides whose targeted TF passes the knockdown check | higher | reported | [R2] |

- **Comparators**: VIPER and AUCell with the same regulons, as in the repository [R2], and ULM and MLM with the same regulons (proposed).
- **Protocol**: for each guide and series, a limma design compares guide cells with controls. The knockdown check, applied to CRISPRi contrasts, requires the limma log fold change of the targeted TF to be negative. Guides that fail are counted in the pass rate and excluded from the primary metric.
- **Acceptance criterion**: proposed. The candidate's pooled ROC AUC is not below DoRothEA-ULM by more than 0.02 on any of the three series, and the QC pass rate is reported beside it.
- **Known pitfalls**: the zero threshold of the check is a choice, and results depend on it; contrasts depend on control composition and on cell-type balance between guides.

### B3. decoupler KnockTF bulk benchmark

- **Goal**: for each KnockTF observation, rank the perturbed source TF above all other sources.
- **Ground truth**: held-out orthogonal measurement of TF knockdown or knockout expression. Each observation is a gene-level log2 fold change profile, so methods run on contrasts rather than on cells. Its label is its perturbed source TF (exploded for several sources; presence-based). Only observations with logFC below $-1$ are kept.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| KnockTF human TF knockdown and knockout contrasts | Feng et al. 2019 [R8]; Zenodo 7035528 (`knockTF_expr.csv`, `knockTF_meta.csv`) via decoupler's `ds.knocktf` loader | human bulk log2 fold changes; observation count after filter — | filter threshold $-1$ |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC | over flattened (observation, source) pairs after dividing each observation's scores by its largest absolute score; ties averaged | higher | primary | [R1] |
| Precision of top-fraction calls | for methods without p-values, calls are the top 10% of sources per observation; for methods with p-values, a call needs decoupler's BH-adjusted $p\le0.10$ and a positive score; precision is $TP/(TP+FP)$, zero when $TP=0$ | higher | primary | [R1] |
| AUPRC, $\pi_0=0.5$ | prevalence-calibrated AUPRC of Siblini et al. [R9] | higher | guardrail | [R9] |
| $1-\mathrm{qrank}$ and $-\log_{10}p$ | mean normalised ascending rank of perturbed sources; one-sided rank-sum test | higher | guardrail | [R1] |

- **Comparators**: ULM, MLM, VIPER, AUCell, GSVA and waggr with CollecTRI and DoRothEA priors, through decoupler's benchmark module with call threshold 0.10 [R1].
- **Protocol**: observations are the unit, pooled across sources within each method. The shared protocol applies.
- **Acceptance criterion**: proposed reporting rule. Report AUROC, AUPRC and call precision for each method and prior, with bootstrap intervals over observations. The implementation check in the shared protocol precedes any performance claim.
- **Known pitfalls**: KnockTF, CollecTRI and DoRothEA draw on overlapping literature and databases, and the overlap is not quantified, so accuracy can be inflated. The logFC filter keeps strong knockdowns only, so overexpression and weak perturbations are untested.

### B4. Depth and dropout stability (proposed)

- **Goal**: measure how stable each TF's activity is when UMI depth is reduced, and how many per-cell calls survive.
- **Ground truth**: consistency. The full-depth score of each cell is the reference, and no biological truth is used. The estimands are the same cell's score at lower depth, the per-TF Spearman correlation across cells, and the Jaccard overlap of each cell's top-10% TF set.
- **Datasets**

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| COVID-19 PBMC data (`covid5k`) | decoupler `ds.covid5k` loader | human single-cell PBMC; cell count — | raw counts are required for thinning |
| singlet catalogue subsets with cell-type labels | singlet catalogue | raw counts; size — | annotations are partly author-supplied |

- **Procedure**: for each depth $D\in\{1000,2000,5000,10000,20000\}$ UMIs, keep cells with $L_c>D$ and binomially thin each kept cell with probability $D/L_c$ (fixed seed). Normalise as at full depth, score with each method and prior, compute per-TF Spearman correlation and call Jaccard, and repeat over five seeds, reporting median and IQR.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-TF Spearman | correlation across kept cells of full and thinned scores for each TF, then median over TFs | higher | primary | — |
| Call Jaccard | overlap of the top-10% TF sets per cell, full versus thinned | higher | guardrail | — |

- **Comparators**: ULM, MLM, AUCell, VIPER and GSVA with the same prior.
- **Protocol**: five seeds; the shared protocol applies.
- **Acceptance criterion**: proposed. The median per-TF Spearman correlation is at least 0.8 at 5,000 UMIs per cell for `ulm`, the default.
- **Known pitfalls**: binomial thinning changes detection rates, which moves rank methods more than linear ones; a high per-TF correlation can coexist with changed cell-level calls, so both metrics are reported.

### P1. Performance and scaling

Wall time, peak device and host memory, and throughput for 10^4, 10^5 and 10^6 observations, and 10^7 for the streaming ULM and AUCell paths. Arms are the decoupler CPU implementations of ULM, MLM, AUCell, VIPER, GSVA and waggr, and the GPU implementations of the same methods in rapids-singlecell. Hold fixed: float32 values, CSR input, decoupler's default batch size, `tmin` 5, the CollecTRI-human regulon table after pruning, one GPU and one CPU socket. Report the median and IQR of five repetitions. Targets are proposed, not literature values.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `grn.prior_network_curation`: Curated TF-target prior network (regulon resource) construction
- **Feeds**:
  - `grn.upstream_regulator_inference`: Upstream TF (master regulator) inference from a differential signature
  - `perturbation.perturbation_effect_estimation`: Per-perturbation differential expression and effect-size estimation
  - `sample-level.sample_phenotype_prediction`: Sample-level phenotype prediction from single-cell profiles
- **Reads**: `layers/lognorm`, `uns/regulon_<prior>`
- **Writes**: `obsm/tf_activity_<method>`, `obsm/tf_activity_pvalue_<method>`, `obsm/tf_activity_call_<method>`, `uns/tf_activity_<method>_params`
<!-- CHAINING:AUTO:END -->

Sits between prior curation and regulator discovery. Its p-values are raw, so thresholds need statistics.multiple_testing_control first.

## 10. Risks, pitfalls and open questions

- **Sources summarised, not examined.** The numeric results of Holland et al. [R2] and of the decoupleR benchmark [R1] were not examined; the ranking statements in section 2 rest on the best-practices chapter [R12]. UCell, decoupler's GSEA, zscore and consensus methods, metaVIPER and the original R VIPER code are not in the tables or the MCP enum.
- **Calibration of the proposed model.** No benchmark measures posterior calibration. The promotion rule uses accuracy only (section 5), so calibrated uncertainty is untested. The implementation check (section 8) comes first; the first accuracy experiment is B1 with ULM, MLM, VIPER and AUCell.
- **Terms and sizes.** Licence terms are not stated in the local sources for the Holland archive, the ARCHS4 and ChEA3 downloads, the KnockTF archive, the CollecTRI and DoRothEA tables, or the `covid5k` data. Observation, experiment and cell counts for B1, B2 and B4 are left blank.
- **Bibliographic gaps.** The Bayesian noisy logic model [R13] has no authors or venue in the local record. The Zhang et al. record [R10] has no DOI.
- **GPU correctness.** The CUDA kernels will be checked against the decoupler outputs on identical inputs; the rapids-singlecell sources are used for layout only, and no timing from them is claimed.

## 11. References

R1. Badia-i-Mompel P, Vélez Santiago J, Braunger J, et al. decoupleR: ensemble of computational methods to infer biological activities from omics data. *Bioinformatics Advances* 2022. doi:10.1093/bioadv/vbac016 — verified (corpus)

R2. Holland CH, Tanevski J, Perales-Patón J, et al. Robustness and applicability of transcription factor and pathway analysis tools on single-cell RNA-seq data. *Genome Biology* 2020. doi:10.1186/s13059-020-1949-z — verified (repo)

R3. García-Alonso L, Holland CH, Ibrahim MM, Turei D, Saez-Rodriguez J. Benchmark and integration of resources for the estimation of human transcription factor activities. *Genome Research* 2019. doi:10.1101/gr.240663.118 — verified (corpus)

R4. Müller-Dott S, Tsirvouli E, Vazquez M, et al. Expanding the coverage of regulons from high-confidence prior knowledge for accurate estimation of transcription factor activities. *Nucleic Acids Research* 2023. doi:10.1093/nar/gkad841 — verified (corpus)

R5. Aibar S, González-Blas CB, Moerman T, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — verified (corpus)

R6. Alvarez MJ, Shen Y, Giorgi FM, et al. Functional characterization of somatic mutations in cancer using network-based inference of protein activity. *Nature Genetics* 2016. doi:10.1038/ng.3593 — verified (corpus)

R7. Hänzelmann S, Castelo R, Guinney J. GSVA: gene set variation analysis for microarray and RNA-Seq data. *BMC Bioinformatics* 2013. doi:10.1186/1471-2105-14-7 — verified (corpus)

R8. Feng C, Song C, Liu Y, et al. KnockTF: a comprehensive human gene expression profile database with knockdown/knockout of transcription factors. *Nucleic Acids Research* 2019. doi:10.1093/nar/gkz881 — verified (corpus)

R9. Siblini W, Fréry J, He-Guelton L, Oblé F, Wang YQ. Master your metrics with calibration. *Advances in Intelligent Data Analysis XVIII (IDA 2020)*. doi:10.1007/978-3-030-44584-3_36 — verified (corpus)

R10. Zhang Y, Ma Y, Huang Y, et al. Benchmarking algorithms for pathway activity transformation of single-cell RNA-seq data. *Computational and Structural Biotechnology Journal* 2020. — verified (corpus)

R11. Pratapa A, Jalihal AP, Law JN, Bharadwaj A, Murali TM. Benchmarking algorithms for gene regulatory network inference from single-cell transcriptomic data. *Nature Methods* 2020. doi:10.1038/s41592-019-0690-6 — verified (corpus)

R12. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)

R13. A Bayesian noisy logic model for inference of transcription factor activity from single cell and bulk transcriptomic data. 2023. doi:10.1093/nargab/lqad106 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/decoupler | Pau Badia i Mompel (maintainer, pyproject.toml); copyright scverse and Pau Badia i Mompel, Saez lab (LICENSE) | BSD-3-Clause (LICENSE); prior loaders default to license argument `academic` | ULM, MLM, VIPER, AUCell, GSVA, waggr; benchmark module; KnockTF and covid5k loaders; method reference | port |
| https://github.com/saezlab/FootprintMethods_on_scRNAseq | Holland CH et al., as cited in the repository README [R2] | GPL-3.0 (LICENSE) | benchmark definitions and archive for B1 and B2; no code ported | reimplement |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (copyright 2022); scverse (copyright 2025) (LICENSE) | MIT (LICENSE) | GPU decoupler ports of ULM, MLM, waggr, AUCell, VIPER and GSVA; CUDA kernels for AUCell, VIPER and GSVA; P1 comparator | port |
