---
id: simulation.reference_matched_counts
title: Reference-matched count simulation and simulator realism / fitness-for-purpose assessment
area: simulation
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [qc.low_quality_cell_detection, annotation.cluster_label_assignment, normalization.count_noise_model_selection]
feeds: [statistics.pvalue_null_calibration, simulation.generative_augmentation, simulation.planted_de_simulation]
reads: [layers/counts, obs/<cell_type_key>, obs/<holdout_key>, var/<gene_id>]
writes: [layers/counts, obs/sim_celltype, models/<name>, uns/<name>_fidelity, uns/<name>_provenance]
devices: [cpu, cuda]
mcp_tool: singlet_simulation_reference_matched_counts
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Reference-matched count simulation and simulator realism / fitness-for-purpose assessment

> Fit a simulator to a real UMI count matrix, sample a synthetic matrix of the requested size from the fitted law, and measure how far it reproduces the reference on distributional summaries, on a classifier test and on the analysis it is meant to support.

## 1. Question

Does a simulator fitted to a real cells-by-genes UMI matrix reproduce its per-gene means and zero fractions, library-size law, gene-gene correlations and cell-type structure, and do method rankings on the synthetic matrix agree with rankings on real data? The input is a raw count matrix with optional cell-type and held-out labels and a target size. The output is a synthetic matrix with planted cell-type labels, the fitted parameters and a fidelity record. A correct answer is the position of the synthetic data within a real-versus-real null on named statistics, not one score.

## 2. Why this task matters and where the field stands

Simulated counts with known structure let normalisation, clustering, differential-expression and trajectory methods be compared when real data have no ground truth. Such comparisons are only as informative as the match between simulator and reference, and that match is usually checked on summaries. Per-gene mean, zero fraction and library size are cheap to match, so a match on them cannot by itself separate simulators. Dependence, zero structure beyond the marginal family and conditional cell-type structure are where simulators differ.

The status is **contested**: no fidelity metric is accepted. A comparison of 12 simulators on 35 experimental datasets (SimBench) organises its criteria into realism of data properties, retention of biological signal, scalability and applicability, and reports performance differences among methods and varying difficulty across data characteristics [R1]. The open problems are:

1. No accepted fidelity metric; summary agreement is necessary but not sufficient.
2. Whether matched cell-type and dependence structure yields the same method rankings on real data has not been measured for most simulators (section 3.4).
3. Gaussian copulas cannot express tail or multimodal co-expression, so rare co-expressed programmes may be lost (section 3.2).
4. Fitting and evaluating on one reference inflates realism, and held-out study or donor evaluation is needed. A simulation with default parameters is not reference-matched, whatever its summaries show.

## 3. Theory and insight

### 3.1 Estimands and normalisation

| Quantity | Estimand | Normalisation |
|---|---|---|
| Per-gene mean and zero fraction | mean of $X_{gc}$ over cells, and share of cells with $X_{gc}=0$, within one matrix | raw UMI counts, no size factors |
| Library size | $L_c=\sum_g X_{gc}$ for each cell | $\log(1+L_c)$ in distributional comparisons |
| Pairwise correlation | Pearson correlation between cell profiles (cell pairs) or gene profiles (gene pairs) | raw counts |
| Scaled moments | per-cell or per-gene mean and variance across the other axis | z-scored over cells or genes |
| Classifier accuracy | $T/N$, the fraction of $N$ held-out cells given their true label | none |
| Clustering recovery | adjusted Rand index between clusters and the per-cell cell-line identity | chance-corrected, in $[-1,1]$ |
| Method-ranking agreement | Spearman correlation of method scores on real and synthetic data | ranks per dataset, average ties |

### 3.2 Model families and their regimes

A per-gene negative binomial (NB) marginal with dispersion $\phi_g$ has

$$X_{gc}\sim \mathrm{NB}(\mu_{gc},\phi_g),\qquad \mathbb{E}[X_{gc}]=\mu_{gc},\qquad \mathrm{Var}(X_{gc})=\mu_{gc}+\phi_g\mu_{gc}^2 .$$

This holds for any $n$, and $\phi_g\to 0$ gives Poisson. It cannot represent excess zeros, for which the zero-inflated form is used,

$$P(X_{gc}=0)=\pi_{gc}+(1-\pi_{gc})\,\mathrm{NB}(0;\mu_{gc},\phi_g).$$

scDesign2 chooses the family per gene. It compares the sample mean with the sample variance: when the mean is at least the variance it tests zero inflation against Poisson, otherwise against NB, where zero inflation is tested only when the gene has a zero. The likelihood-ratio statistic is referred to a chi-square with one degree of freedom, although zero inflation sits on the boundary of the parameter space; that reference is conservative because the boundary null is a mixture with an atom at zero. Zero inflation and dispersion trade off, so matching the zero fraction does not establish matched variance.

Splatter is a gamma-Poisson model with a gamma prior on base means and a log-normal library size,

$$\bar\mu_g\sim\mathrm{Gamma}(\alpha,\beta),\qquad L_c\sim\mathrm{LogNormal}(\ell,s),\qquad \mu_{gc}=L_c\,\frac{m_{gc}}{\sum_h m_{hc}},$$

where $m_{gc}$ is the base mean of gene $g$ times its outlier, batch and differential-expression factors for cell $c$, $\alpha$ and $\beta$ are shape and rate, and $\ell$ and $s$ are the log-normal mean and scale. Given a cell-level coefficient of variation $\mathrm{bcv}_{gc}$, the counts are, with the Gamma written as (shape, scale),

$$\lambda_{gc}\sim\mathrm{Gamma}\!\left(\tfrac{1}{\mathrm{bcv}_{gc}^2},\ \mu_{gc}\,\mathrm{bcv}_{gc}^2\right),\qquad X_{gc}\mid\lambda_{gc}\sim\mathrm{Poisson}(\lambda_{gc}),$$

which is NB with $\phi=\mathrm{bcv}_{gc}^2$. Splatter draws $\mathrm{bcv}_{gc}=(\mathrm{bcv}_{\rm common}+1/\sqrt{\mu_{gc}})\sqrt{\mathrm{df}/\chi^2_{\mathrm{df}}}$, with $\mathrm{df}$ the BCV degrees of freedom, so the dispersion is itself random. Its dropout step is off by default; when on, it keeps each count with probability $1-p^{\rm drop}_{gc}$, where $p^{\rm drop}_{gc}=1/(1+e^{-k(\log\mu_{gc}-x_0)})$ is a logistic function of log mean with midpoint $x_0$ and slope $k$.

Gaussian copula. scDesign2 maps each observed count to a randomised probability integral transform $u_{gc}=v\,F_g(x_{gc})+(1-v)\,F_g(x_{gc}-1)$, with $v\sim U(0,1)$ and $F_g(-1)=0$, then to normal scores $z_{gc}=\Phi^{-1}(u_{gc})$, and sets $\Sigma=\mathrm{cor}(z)$ over the copula block. Sampling draws $z\sim\mathcal N(0,\Sigma)$ and inverts the marginals, $x_{gc}=F_g^{-1}(\Phi(z_{gc}))$; for zero-inflated marginals the NB quantile is evaluated at $\max(0,\Phi(z)-\pi_g)/(1-\pi_g)$. Under bivariate normality, a correlation estimated from $n$ cells has $\mathrm{Var}(\operatorname{artanh}\hat\rho)\approx 1/(n-3)$; counts are only approximately normal after the transform, so this is a guide to how many cells resolve one correlation. A sample correlation matrix over $p_c$ genes estimated from $n$ cells has rank at most $n-1$, so for $p_c \ge n$ it is singular and needs shrinkage or a low-rank form.

A Gaussian copula has zero upper-tail dependence, $\lambda_U=\lim_{u\to1^-}\Pr(U_2>u\mid U_1>u)=0$, for every $|\rho|<1$. Co-expression visible only at high counts is therefore not represented by any Gaussian copula with NB or ZINB marginals.

Classifier two-sample test. If real and synthetic held-out cells are exchangeable under $H_0$ and the held-out predictions are independent, the number of correct labels $T$ among $N$ satisfies $T\sim\mathrm{Binomial}(N,\tfrac12)$. Duplicated or dependent cells break the independence.

### 3.3 Failure modes by family

- **Marginal family.** Matched means with wrong dispersion or zero inflation is the usual failure. Library-size matching can also hide a wrong relation between library size and zero fraction; the joint statistic in B1 targets it.
- **Gaussian copula.** Forming $\Sigma$ on $p_c$ copula genes costs $O(np_c^2)$, its Cholesky factor $O(p_c^3)$, and dense sampling $O(np_c^2)$. Per-gene IRLS for a fixed design costs $O(np)$ per iteration. These are operation counts, not measured times.
- **Memorisation.** A generator can return near-copies of training cells, which is visible only in a nearest-neighbour check (B2).
- **Summary-level matching.** All B1 summaries are invariant to permutation of gene identities, so they cannot detect gene-identity errors.
- **Cell-type collapse.** Fitting one population removes type-specific structure, which is why the fit is stratified (section 5).

### 3.4 Why a model-based formulation, and what would change it

Parametric simulators expose objects that can be inspected, refit and tested: Splatter's gamma and BCV terms and scDesign2's per-gene marginals and copula [R2, R3]. Learned generators such as scGAN [R7] give samples without inspectable marginal parameters, and their outputs carry no calibrated uncertainty. Heuristic summary panels are cheap and show which statistic fails, but they do not establish fitness. The fitness claim needs downstream method rankings (section 10, item 4), and a parametric model is useful only where its marginal family and copula hold, which B1 and B2 test.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Splatter | model-based | Gamma-Poisson with gamma base means, log-normal library sizes, BCV and optional logistic dropout; Estimate step fits means and BCV from a reference | [R2] |
| scDesign2 | model-based | Per-gene Poisson, NB, ZIP or ZINB marginals chosen by likelihood-ratio tests, with a Gaussian copula on normal scores of randomised quantiles | [R3] |
| scDesign3 (nb family) | model-based | GLM or GAM marginals with covariates such as cell type and pseudotime (smooth terms), and a Gaussian or vine copula | [R4] |
| SymSim | model-based | Per-gene two-state kinetics (kon, koff, s) with extrinsic factors; kinetic parameters matched to a stored reference set (`param_realdata`, default `zeisel.imputed`) | [R5] |
| SPsimSeq | model-based | Exponential-family density per gene with a Gaussian copula; supports groups and batches | [R6] |
| scGAN and cscGAN | learned, implicit | Adversarial generator trained on profiles; cscGAN conditions the generator on cluster labels | [R7] |
| Realism panel | heuristic | 14 two-sample statistics on summary distributions against a reference (OpenProblems definitions) | §12 |
| Classifier two-sample test | model-based | Held-out accuracy of a classifier separating real from synthetic cells | [R8] |

Splatter and scDesign2 are the parametric standards here, and the defaults below are read from their code. scDesign3 contributes covariate-aware marginals. SymSim is a mechanistic comparator. SPsimSeq and scGAN are optional comparators taken from their repositories and are not implemented. The realism panel and the classifier test form the evaluation layer.

Defaults used by the comparators and the realism panel, with the source line in each repository (Splatter at eeb1dfc, realism panel at 8a1466a):

| Method | Parameter | Value | Source |
|---|---|---|---|
| Splatter | mean.rate | 0.3 | R/AllClasses.R:248 @ eeb1dfc |
| Splatter | mean.shape | 0.6 | R/AllClasses.R:249 |
| Splatter | lib.loc | 11 | R/AllClasses.R:250 |
| Splatter | lib.scale | 0.2 | R/AllClasses.R:251 |
| Splatter | lib.norm | FALSE (log-normal library sizes) | R/AllClasses.R:252 |
| Splatter | out.prob | 0.05 | R/AllClasses.R:253 |
| Splatter | de.prob | 0.1 | R/AllClasses.R:258 |
| Splatter | de.facLoc, de.facScale | 0.1, 0.4 | R/AllClasses.R:260-261 |
| Splatter | bcv.common (default) | 0.1 | R/AllClasses.R:262 |
| Splatter | bcv.common (Estimate) | 0.1 + 0.25 × edgeR common dispersion | R/splat-estimate.R:248 |
| Splatter | dropout.type | "none" (dropout off) | R/AllClasses.R:264 |
| Splatter | Estimate winsorisation; gamma fit | q = 0.1; method "mge", gof "CvM" | R/splat-estimate.R:90, 95-96 |
| scDesign2 | marginal | auto_choose | R/model_fitting.R:33 |
| scDesign2 | pval_cutoff | 0.05 | R/model_fitting.R:34 |
| scDesign2 | epsilon | 1e-5, clamp of randomised quantiles | R/model_fitting.R:34, 143-146 |
| scDesign2 | jitter | TRUE | R/model_fitting.R:35 |
| scDesign2 | copula-block zero cutoff | 0.8 | R/model_fitting.R:193 |
| scDesign2 | copula correlation | Pearson correlation of normal scores | R/model_fitting.R:211 |
| scDesign3 | copula | "gaussian" | R/fit_copula.R:85 |
| scDesign3 | family_use (README example) | "nb" | README.md:52 |
| SymSim | nevf | 10 | R/simulation_functions.R:578 |
| SymSim | Sigma | 0.4 | R/simulation_functions.R:579 |
| SymSim | gene_effect_prob, gene_effects_sd | 0.3, 1 | R/simulation_functions.R:580 |
| SymSim | param_realdata | "zeisel.imputed" | R/simulation_functions.R:581, 639-641 |
| SymSim | prop_hge, mean_hge | 0.015, 5 | R/simulation_functions.R:582 |
| Realism panel | jitter schedule | 0, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4 | src/metrics/ks_statistic_gene_cell/script.R:115 @ 8a1466a |
| Realism panel | correlation subsample | 10,000 values, seed 1 | script.R:148, 156 |

## 5. Proposed singlet approach

Routes follow the licence terms in section 12. **Port**: scDesign2, the default, and the scDesign3 nb family. **Reimplement**: Splatter and SymSim; the behaviour is rederived from the equations in section 3 and the defaults in section 4, and no code is copied. For SymSim, the reference-matched version replaces `param_realdata` with a kinetic-parameter density fitted to the reference. **Callout**: SPsimSeq and scGAN, usable as optional comparators from their own repositories.

The proposed model fits, for each cell type $c$, per-gene marginals by the scDesign2 rule, estimates a copula correlation on the copula block, and samples by the Gaussian copula. Two changes are proposed. First, $\Sigma_c$ is restricted to low-rank-plus-diagonal form $\Lambda\Lambda^\top+D$, with rank chosen on held-out cells, so that sampling costs $O(npr)$ rather than $O(np^2)$. Second, types with too few cells borrow the pooled copula, the cell-count threshold is proposed and is set on B1. The change is falsified on the benchmarks if, on the same reference, the low-rank copula leaves a primary B1 statistic outside its null that the full copula keeps inside, or if its B2 accuracy is higher than the full copula's for the same classifier.

The ML stack uses PyTorch for the B2 MLP and for any learned generator; logistic regression and gradient-boosted trees come from standard libraries. Small hot kernels are hard-coded in CUDA with cuBLAS: per-gene NB IRLS on a fixed design of an intercept and type indicators, the copula correlation as a GEMM on normal scores, Cholesky sampling, and per-gene quantile inversion by lookup tables. Their size is fixed by the gene set, so a framework adds nothing.

Fitting streams over cell blocks, accumulating IRLS sufficient statistics and the correlation as sums of outer products, which needs $O(p_c^2)$ memory in float32. Sampling streams in cell chunks. The CPU path is the reference for tests and the CUDA path must agree with it within numerical tolerance.

Defaults an agent should use without asking: `simulator` scdesign2; `cell_type_key` cell_type when the column exists; `target` sizes at the reference size; `holdout` set whenever a study or donor column exists; `splatter.estimate` true; and the fitter options at the values in section 4.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | int | raw UMI counts, cells by genes |
| read | `obs/<cell_type_key>` | categorical | optional labels; the fit is stratified by type |
| read | `obs/<holdout_key>` | categorical | optional study or donor labels; the held-out level is the realism reference |
| read | `var/<gene_id>` | string | identifiers for gene matching |
| write | `layers/counts` (output dataset) | int | synthetic counts, target cells by target genes |
| write | `obs/sim_celltype` | categorical | cell-type labels copied to synthetic cells |
| write | `models/<name>` | object | fitted marginal parameters and copula correlation |
| write | `uns/<name>_fidelity` | object | statistics, null positions, classifier accuracy |
| write | `uns/<name>_provenance` | object | simulator, version, seed, drawn gene identifiers, parameters |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Reference dataset handle: a .singlet path or URI with raw UMI counts in layers/counts. |
| `output` | string | required | — | Destination handle for the synthetic .singlet dataset; the input dataset is never modified. |
| `simulator` | string | "scdesign2" | `scdesign2`, `scdesign3_nb`, `splatter`, `symsim` | Fitter and sampler; scdesign2 is the proposed default, the others are comparators. |
| `target` | object | — | — | Size of the synthetic matrix. |
| `target.n_cells` | integer/null | null | min 1 | Synthetic cells; null uses the reference size. |
| `target.n_genes` | integer/null | null | min 1 | Genes drawn at random, seeded, among those with nonzero total count; null keeps all. |
| `cell_type_key` | string/null | "cell_type" | — | obs column with cell-type labels; the fit is stratified by it. Null fits one population. |
| `holdout` | object/null | null | — | Held-out level excluded from the fit and used as the realism reference. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | required | — | Random seed for gene draws, fitting and sampling; required for reproducibility. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting or writing. |
| `overwrite` | boolean | false | — | Replace existing output members in the output dataset instead of failing. |
| `scdesign2` | object | — | — | Options for the scdesign2 fitter; rejected unless simulator is scdesign2. |
| `scdesign2.marginal` | string | "auto_choose" | `auto_choose`, `zinb`, `nb`, `poisson` | Per-gene marginal family; auto_choose selects by likelihood-ratio tests. |
| `scdesign2.pval_cutoff` | number | 0.05 | max 1; > 0 | Significance level for choosing zero inflation over the non-inflated family. |
| `scdesign2.epsilon` | number | 1e-05 | > 0 | Clamp keeping randomised quantiles away from 0 and 1. |
| `scdesign2.jitter` | boolean | true | — | Randomise discrete counts before the probability integral transform. |
| `splatter` | object | — | — | Options for the splatter comparator; rejected unless simulator is splatter. |
| `splatter.estimate` | boolean | true | — | Estimate means, library sizes and BCV from the reference; false uses package defaults, which are not reference-matched. |
<!-- PARAMS:AUTO:END -->

Parameter rules. `scdesign2` options are rejected unless `simulator` is scdesign2, and `splatter.estimate` applies only to splatter. `target.n_genes` draws genes at random among those with nonzero total count, seeded, and records the draw in provenance. `holdout` excludes the named level from the fit and makes it the realism reference; without it, fidelity is in-sample and the record says so. Synthetic cells come from the fitted law, so `target.n_cells` may exceed the reference size. No option modifies the input dataset.

## 7. MCP tool

Tool name `singlet_simulation_reference_matched_counts` (definition in `tasks/mcp/singlet_simulation_reference_matched_counts.json`).

```json
{"dataset": "r2://atlas/study_a.singlet", "output": "r2://sims/study_a_sim.singlet",
 "simulator": "scdesign2", "target": {"n_cells": 5000}, "cell_type_key": "cell_type",
 "holdout": {"key": "study", "level": "study_b"}, "seed": 1, "dry_run": false}
```

```json
{"dataset": "r2://atlas/study_a.singlet", "status": "completed",
 "synthetic_dataset": "r2://sims/study_a_sim.singlet",
 "wrote": ["layers/counts", "obs/sim_celltype", "models/scdesign2", "uns/scdesign2_fidelity", "uns/scdesign2_provenance"],
 "summary": {"simulator": "scdesign2", "n_cells": 5000, "copula_genes": "<count>",
             "ks_statistics": "<T per statistic>", "null_position": "<quantile per statistic>",
             "c2st_accuracy": "<0 to 1 per classifier>"},
 "provenance_id": "<id>"}
```

Long-running: fits scale with reference cells and copula genes, and a queued job returns `job_id`. Stochastic: the seed fixes gene draws, fitting and sampling, so results reproduce on the same device and thread count. Dry run: `dry_run` returns seconds, peak memory and device from a cost model, without fitting; the P1 benchmark is what calibrates that model and it has not been run.

## 8. Benchmarks

Shared protocol. Each benchmark splits a labelled raw-count reference into fit cells (A) and evaluation cells (B) by held-out unit (study where available, otherwise donor), stratified by cell type. Simulators are fitted on A only and every statistic is computed against B. Synthetic matrices have the size of B, and genes are matched by identifier. Each simulator is replicated over five seeds (proposed). Statistics use raw counts unless stated, and KS statistics are the `ks::kde.test` T values defined by the OpenProblems task (section 12); they are compared only within one reference. Each report records CPU model, thread count, GPU and the fitted parameters.

### B1. Realism panel against a real-versus-real null

- **Goal**: place each simulator's six statistic families inside the distribution produced by splitting real data.
- **Ground truth**: held-out real data. The null is 200 random splits of the reference; in each, one real half is compared with the other using the same statistics, so the null estimand is the statistic on real data.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellBench 10x three-cell-line mixture (`sce10x_qc`) | CellBench data repository, GEO GSE118767 | scRNA-seq, 10x Chromium, three human lung adenocarcinoma cell lines | see §12 | `cell_line_demuxlet` labels; no tissue structure |
| Catalogue studies with author cell-type labels | singlet catalogue; three studies chosen by a seeded rule | scRNA-seq; species and sizes per study | — | rule: at least two donors and two shared cell types (proposed) |

- **Metrics**

| Statistic family (KS T) | Summary compared | Direction | Role | Reference |
|---|---|---|---|---|
| Zero fraction | per-gene and per-cell zero fraction | lower | primary | — |
| Depth | per-cell log(1+library size), effective size (library size × TMM factor), TMM factors | lower | primary (first two); guardrail (TMM) | — |
| Scaled moments | z-scored per-cell and per-gene mean and variance | lower | guardrail | — |
| Joint depth and zero | 2-D (log library size, zero fraction) | lower | primary | — |
| Correlation | pairwise cell and gene Pearson correlations on raw counts, 10,000 values each, seed 1 | lower | primary | — |
| Joint gene moments | 2-D (mean, variance) and (mean, zero fraction) per gene | lower | primary | — |

- **Comparators**: scDesign2 (default), scDesign3 nb, Splatter with `estimate` true, SymSim refitted, and Splatter with package defaults as a non-matched control.
- **Protocol**: the shared protocol; the 14 statistics are computed with the OpenProblems definitions (section 12). The jitter level that succeeded is recorded.
- **Acceptance criterion**: proposed. Each primary statistic lies within the central 95 percent of its 200-split null. Guardrails are reported, not gated. NA counts as failure.
- **Known pitfalls**:
  1. The statistics ignore gene identity, so a simulator that permutes gene means can score well; B2 covers gene-level features.
  2. The OpenProblems configuration describes scaled variance on log2(CPM), but the script computes it on raw counts. The script is authoritative, the description must be corrected before reuse, and constant inputs return NA, which counts as failure.

### B2. Classifier two-sample test

- **Goal**: test whether a classifier separates held-out real cells from synthetic cells of the same size.
- **Ground truth**: consistency by construction; real cells are labelled 1 and synthetic cells 0.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Real and synthetic pairs from B1 | the B1 references and simulators | as in B1 | — | held-out cells only |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Held-out accuracy | $T/N$; balanced accuracy when class sizes differ | closer to 0.5 | guardrail | — |
| Two-sided binomial p-value | test of $T$ against Binomial($N$, 1/2) | higher means consistent with indistinguishable | primary | — |

- **Comparators**: logistic regression, gradient-boosted trees and a small MLP in PyTorch, each reported separately.
- **Protocol**: stratified two-fold cross-fitting over real and synthetic cells, with predictions on each held-out cell. Features are log(1+counts per 10,000) on all genes with nonzero total count and on the 2,000 most variable genes (proposed). Classes are balanced by subsampling the larger class.
- **Acceptance criterion**: proposed. For the strongest classifier, the two-sided binomial test does not reject indistinguishability at $\alpha=0.05$ on either feature set.
- **Known pitfalls**:
  1. Near-duplicate synthetic cells inflate accuracy and break the independence the binomial null assumes. Compare the nearest-neighbour distance from each synthetic cell to the training cells with the same distance between real halves.
  2. A weak classifier can fail to separate a simulation that a stronger one separates, so the claim is limited to the classifiers reported.

### B3. Cell-line mixture fitness check

- **Goal**: test whether simulated three-cell-line mixtures give the same clustering recovery as the real mixture; the design follows the mixture-control benchmark [R9].
- **Ground truth**: orthogonal measurement. Each cell has one of three cell-line labels from the `cell_line_demuxlet` column (demuxlet is a genotype-based demultiplexer), and the estimand is the adjusted Rand index between k-means labels (k = 3) and these labels, chance-corrected in $[-1,1]$.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellBench 10x three-cell-line mixture | as in B1 | as in B1 | see §12 | unlabelled cells are excluded; equal mixing proportions |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI on real data | adjusted Rand index on split B | higher | primary | — |
| ARI on synthetic data | adjusted Rand index on a synthetic mixture of the same size | higher | primary | — |
| Difference | ARI real minus ARI synthetic, with 1,000 bootstrap resamples of cells | closer to 0 | primary | — |

- **Comparators**: Splatter with `estimate` true, scDesign2 (default), scDesign3 nb and SymSim, each fitted per cell line on split A.
- **Protocol**: the shared protocol. Synthetic cells are generated per line in the per-line counts of split B. Features are log(1+counts per 10,000) reduced to 30 principal components; k-means uses k = 3 with a fixed seed and 10 initialisations.
- **Acceptance criterion**: proposed. The 95 percent bootstrap interval of ARI real minus ARI synthetic contains 0.
- **Known pitfalls**:
  1. Cell lines differ strongly from primary tissue, so agreement here says nothing about tissue realism.
  2. A fixed k = 3 measures separability of three well-defined populations; it does not test rare types or continuous states.

### P1. Performance and scaling

Wall time, peak memory and throughput (synthetic cells per second) for fitting and sampling at 10,000, 100,000 and 1,000,000 synthetic cells, on CPU and CUDA, against the enum comparators. Hold fixed: reference cells, gene count, sparsity, seed, thread count and hardware. Report the log-log slope of time against cells and against copula genes. The 10-million-cell streaming case is not claimed.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `normalization.count_noise_model_selection`: Count noise-model selection and zero-inflation diagnosis
- **Feeds**:
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
  - `simulation.generative_augmentation`: Synthetic cell generation for augmentation of rare populations
  - `simulation.planted_de_simulation`: Simulation with planted differential expression and known DE truth
- **Reads**: `layers/counts`, `obs/<cell_type_key>`, `obs/<holdout_key>`, `var/<gene_id>`
- **Writes**: `layers/counts`, `obs/sim_celltype`, `models/<name>`, `uns/<name>_fidelity`, `uns/<name>_provenance`
<!-- CHAINING:AUTO:END -->

This task is the fitting and sampling step of the reference-matched simulation area; its outputs feed null calibration and planted-truth tasks.

## 10. Risks, pitfalls and open questions

1. **Evidence depth.** [R1] was checked against its publisher-indexed record and a search summary (12 methods, 35 datasets, criteria families, no per-method ranking). Its metric definitions and results were not read, so no per-method claim rests on it.
2. **Performance.** No published runtime or memory figure for any listed simulator was identified, so P1 has no literature anchor and its own results form the baseline.
3. **Method coverage.** The Splatter, scDesign2, scDesign3 and SymSim code was read at the lines cited in section 4. SPsimSeq and scGAN were read at README level, with their copula file (`genCopula.R`) and conditional generator (`cscGAN.py`) checked, and are comparators. SPARSim, ZINB-WaVE, scVI decoders and diffusion generators are omitted because no primary source was read.
4. **Downstream concordance.** The Spearman comparison of K analysis-method rankings on real and synthetic data has no dataset. The real-data truth must come from a source independent of the ranked methods. Until a dataset is chosen this is not a benchmark, and the fitness claim in section 1 is untested.
5. **Thresholds.** Every acceptance threshold here is a design proposal, and no literature threshold was identified. The 95 percent band from 200 splits, the 0.05 level and the 2,000-gene feature set are not calibrated.
6. **Data and first experiment.** The annotated fraction of the catalogue (about 40 percent of 354M cells) is not broken down by study, so the number of held-out study levels is unknown. First experiment: fit scDesign2 per cell type on split A of the CellBench 10x data and compute B1 to B3 on split B, to show the pipeline end to end before any catalogue-scale fit.

## 11. References

R1. Cao Y, Yang P, Yang JYH. A benchmark study of simulation methods for single-cell RNA sequencing data. *Nature Communications* 2021. doi:10.1038/s41467-021-27130-w — verified (search)
R2. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R3. Sun T, Song D, Li WV, Li JJ. scDesign2: a transparent simulator that generates high-fidelity single-cell gene expression count data with gene correlations captured. *Genome Biology* 2021. doi:10.1186/s13059-021-02367-2 — partial (corpus)
R4. Song D, et al. scDesign3 generates realistic in silico data for multimodal single-cell and spatial omics. *Nature Biotechnology* 2023. doi:10.1038/s41587-023-01772-1 — partial (corpus)
R5. Zhang X, Xu C, Yosef N. Simulating multiple faceted variability in single cell RNA sequencing. *Nature Communications* 2019. doi:10.1038/s41467-019-10500-w — partial (corpus)
R6. Assefa AT, Thas O, Meys J, Hawinkel S. SPsimSeq: semi-parametric simulation of bulk and single-cell RNA-sequencing data. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa105 — partial (corpus)
R7. Marouf M, Machart P, et al. Realistic in silico generation and augmentation of single-cell RNA-seq data using generative adversarial networks. *Nature Communications* 2020. doi:10.1038/s41467-019-14018-z — partial (corpus)
R8. Lopez-Paz D, Oquab M. Revisiting classifier two-sample tests. *ICLR* 2017; arXiv:1610.06545. — verified (search)
R9. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/Oshlack/splatter | Zappia L (aut, cre); Phipson B (aut); Azodi C (ctb); Oshlack A (aut), per DESCRIPTION | GPL-3 (DESCRIPTION "GPL-3 + file LICENSE"; LICENSE file present) | Estimate and Simulate comparator | reimplement |
| https://github.com/JSB-UCLA/scDesign2 | Sun T (author and maintainer), per DESCRIPTION | MIT (LICENSE, copyright 2020 JSB-UCLA) | default fitter and sampler | port |
| https://github.com/SONGDONGYUAN1994/scDesign3 | Song D (aut, cre); Wang Q (aut); Jiang C (aut), per DESCRIPTION | MIT + file LICENSE (LICENSE, copyright 2024 Dongyuan Song) | covariate-aware nb fitter | port |
| https://github.com/YosefLab/SymSim | Xu C (aut); Zhang X (aut, cre), per DESCRIPTION | Artistic-2.0 (DESCRIPTION); no LICENSE file at repository root | mechanistic comparator | reimplement |
| https://github.com/CenterForStatistics-UGent/SPsimSeq | Assefa AT (aut); Thas O (ths); Meys J (cre); Hawinkel S (aut), per DESCRIPTION | GPL-2 (DESCRIPTION); no LICENSE file at repository root | comparator, README read | callout |
| https://github.com/imsb-uke/scGAN | Marouf M and Machart P, copyright holders in LICENSE | MIT (LICENSE, copyright 2018 Mohamed Marouf and Pierre Machart) | learned comparator, README read | callout |
| https://github.com/openproblems-bio/task_spatial_simulators | Liang X (aut); Cao Y (aut, maintainer); Yang J (aut); others per README | MIT (LICENSE, copyright 2024 Open Problems in Single-Cell Analysis) | source of realism-panel definitions | port |
| https://github.com/LuyiTian/CellBench_data | Tian L, copyright holder in LICENSE | MIT (LICENSE, copyright 2018 Luyi Tian) | mixture data for B1 and B3 | callout |
