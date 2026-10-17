---
id: programs.denovo_program_decomposition
title: De novo gene program decomposition
area: programs
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [feature-selection.highly_variable_gene_selection, programs.program_number_selection]
feeds: [programs.program_usage_estimation, programs.identity_activity_program_labeling]
reads: [layers/counts, var/highly_variable, obs/library_size]
writes: [obsm/program_usage, varm/program_loadings, uns/program_stability, uns/program_params, models/program]
devices: [cpu, cuda]
mcp_tool: singlet_programs_denovo_program_decomposition
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# De novo gene program decomposition

> Factorises a variable-gene count matrix into K non-negative gene programs and per-cell program usages, and reports how reproducible each program is across random starts.

## 1. Question

Given a cells-by-genes matrix restricted to variable genes and a chosen number of programs K, which non-negative gene programs underlie the data, and how strongly does each cell use each program? A correct answer is a genes-by-programs loading matrix $W$ and a cells-by-programs usage matrix $U$ with $UW^{\top}$ explaining the counts under a stated measurement model, together with a stability measure showing that each program recurs across independent starts. K is an input here; choosing it is the subject of `programs.program_number_selection`.

## 2. Why this task matters and where the field stands

Programs are the interpretable unit of transcriptional variation: they summarise co-varying genes such as identity, activity, cell cycle and stress in a form that can be named and reused. Factorisation is the dominant route. Frobenius NMF with consensus over random starts, a device introduced for NMF by Brunet et al. [R4], is the published standard in cNMF [R1]. Count models fit the same structure with explicit likelihoods: Poisson NMF and topic models [R6, R5], and a hierarchical Gamma-Poisson model fitted by variational inference [R2]. Bayesian NMF by MCMC (CoGAPS [R8]) is a further alternative.

Status: **contested**. Every estimator is non-convex and the factorisation is unique only up to permutation and scale, so different starts can return different programs. The open problems are:

- The loss. Frobenius loss assumes constant noise variance, which counts do not have. For count models the optimiser matters as much as the loss [R6].
- Stability. Consensus controls seed dependence, but the density threshold has no principled value: cNMF's default is 0.5 and its README example uses 0.01 (section 4).
- Technical structure. Depth, mitochondrial fraction and dissociation signals are recovered as programs unless they are removed or separated later; separating identity, activity and technical programs is the subject of `programs.identity_activity_program_labeling`.
- Choice of K. Prediction error falls as K grows, and consensus statistics and prediction error can disagree, so K is set in `programs.program_number_selection`, not here.

## 3. Theory and insight

Let $X\in\mathbb{R}_{\ge 0}^{n\times G}$ be the cell-by-gene matrix restricted to variable genes, fitted as $X\approx UW^{\top}$ with $U\in\mathbb{R}_{\ge 0}^{n\times K}$ and $W\in\mathbb{R}_{\ge 0}^{G\times K}$. Let $\beta_k=W_{\cdot k}/\sum_g W_{gk}$ be the L1-normalised loading of program $k$. The models differ in the noise they assume.

$$\min_{U,W\ge 0}\ \tfrac12\lVert X-UW^{\top}\rVert_F^2\qquad\text{(Frobenius NMF, cNMF's default)}$$

This is the maximum-likelihood fit under independent, homoscedastic Gaussian noise. It is a first-order approximation for log-scale data; for counts the noise variance grows with the mean, so high-mean genes dominate.

$$X_{cg}\sim\mathrm{Poisson}(\lambda_{cg}),\qquad \lambda_{cg}=\sum_k U_{ck}W_{gk}\qquad\text{(Poisson NMF)}$$

The Poisson variance equals its mean. The fit is locally close to the Gaussian one where $\lambda_{cg}\gg 1$, and the model has no term for overdispersion or zero inflation.

$$X_c\sim\mathrm{Multinomial}(s_c,\pi_c),\quad \pi_{cg}=\sum_k\theta_{ck}\beta_{kg},\quad \textstyle\sum_k\theta_{ck}=1\qquad\text{(topic model)}$$

Here $s_c=\sum_g X_{cg}$ is the library size and $\theta_c$ is a grade of membership. The topic model and Poisson NMF are related so that one optimiser can fit the other [R6]; the derivation is not reproduced here (section 10).

$$X_{cg}\sim\mathrm{Poisson}\Big(\sum_k\theta_{ck}\beta_{kg}\Big),\quad \theta_{ck}\sim\mathrm{Gamma}(a,\xi_c),\quad \beta_{kg}\sim\mathrm{Gamma}(c,\eta_g)\qquad\text{(Gamma-Poisson, scHPF)}$$

Gamma shape parameters below one put mass near zero, which yields sparse programs. The rate hyperparameters are set from the data's mean-to-variance ratios (scHPF_.py:865–876). Inference is mean-field variational, which tends to understate posterior variance when programs are correlated.

$$d_p=\frac{1}{m}\sum_{q\in\mathcal N_m(p)}\lVert\hat g_p-\hat g_q\rVert_2,\qquad m=\lfloor\alpha R\rfloor\qquad\text{(cNMF local density)}$$

Here $\hat g_p$ is the L2-normalised replicate program $p$ among the $RK$ replicates from $R$ starts, and $\mathcal N_m(p)$ holds its $m$ nearest replicates. Replicates with $d_p\ge\tau$ are discarded before clustering (cnmf.py:903). With $R=100$ and $\alpha=0.30$, $m=30$ (cnmf.py:879). The filter has no likelihood, so $\tau$ is not calibrated.

**Insight.** Each family assumes a different noise model, and none is identifiable without extra structure, so one fit is not evidence for a program. Consensus over starts is a heuristic that keeps programs recurring across seeds. The count models control the same problem through the model and can report a posterior spread for each program. Whether that spread is calibrated is an empirical question (B1).

| Family | Noise assumed | Regime of validity | Typical failure |
|---|---|---|---|
| Frobenius NMF (cNMF) | Homoscedastic Gaussian | Log-scale data, $\mu\gg 1$ | Variance grows with the mean; high-mean genes dominate |
| Poisson NMF | Poisson | $\lambda_{cg}\gg 1$ locally | Overdispersion and dropout unmodelled; programs split or merge |
| Topic model | Multinomial, fixed library size | Counts with known $s_c$ | Composition only; absolute scale lost |
| Gamma-Poisson (scHPF) | Poisson with Gamma priors | Sparse counts | Mean-field variance understated; priors tied to the data |
| Consensus filter | None (heuristic) | Enough starts per program | Threshold uncalibrated; outlier rate data-dependent |

**Estimands.** Each output is defined once here.

- Loadings $\beta_k$: L1-normalised, so a program is a distribution over the variable genes.
- Usages $U_{ck}$: expected molecules of program $k$ in cell $c$, with $W$ column-normalised so that $\sum_k U_{ck}\beta_{kg}$ is the expected count of gene $g$.
- Composition $\pi_{ck}=U_{ck}/\sum_j U_{cj}$: scale-free, and the quantity compared across methods.
- Stability: the Jaccard overlap of top-50 genes between matched programs from independent start batches (B2).
- Planted $\beta^\ast_k$ and $\pi^\ast_{ck}$ (B1) use the same normalisations, so they compare directly with estimates.

One sweep of a multiplicative or coordinate-descent update costs $O(\mathrm{nnz}(X)K)$ time, and the replicate distance matrix costs $O((RK)^2G)$ time and $O((RK)^2)$ memory (derived from cnmf.py:891; not measured).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| cNMF | hybrid | Frobenius NMF over many starts, density filter, K-means consensus, refit usages | [R1] |
| Single-start Frobenius NMF | model-based | One NMF fit per seed without consensus (the replicate solver inside cNMF) | [R3] |
| scHPF | model-based | Gamma-Poisson factorisation with mean-field variational inference | [R2] |
| fastTopics Poisson NMF | model-based | Poisson NMF with SCD, EM, multiplicative and CCD solvers | [R6] |
| fastTopics topic model | model-based | Multinomial grade-of-membership model in the same package | [R5] |
| RcppML | model-based | Fast NMF with IRLS losses and cross-validated rank | [R7] |

cNMF [R1] is the published standard for de novo programs. For counts, the model-based standards are fastTopics [R6] and scHPF [R2]. Single-start NMF and RcppML are comparators. CoGAPS [R8] is excluded from the tables (section 10), and LDA-type models are excluded (section 12).

| Method | Parameter | Value | Source |
|---|---|---|---|
| cNMF | starts per K (`n_iter`) | 100 | cnmf.py:333 @5dbc5baa |
| cNMF | highly variable genes | 2000 | cnmf.py:334 @5dbc5baa |
| cNMF | loss (`beta_loss`) | frobenius | cnmf.py:334, 630–631 @5dbc5baa |
| cNMF | initialisation | random | cnmf.py:335 @5dbc5baa |
| cNMF | L2 penalties on usages and spectra | 0.0, 0.0 | cnmf.py:335 @5dbc5baa |
| cNMF | iteration cap per start | 1000 | cnmf.py:335, 378 @5dbc5baa |
| cNMF | tolerance; Frobenius solver | 1e-4; `cd` | cnmf.py:624, 630–631 @5dbc5baa |
| cNMF | neighbourhood fraction $\alpha$ | 0.30 | cnmf.py:823 @5dbc5baa |
| cNMF | density threshold $\tau$ | 0.5 | cnmf.py:823, 903 @5dbc5baa |
| cNMF | consensus K-means | k = K, n_init 10, random_state 1 | cnmf.py:908 @5dbc5baa |
| cNMF | refit usages | True | cnmf.py:825 @5dbc5baa |
| scHPF | a, c (shapes of $\theta$, $\beta$ priors) | 0.3, 0.3 | schpf/scHPF_.py:228, 231 @df4cb468 |
| scHPF | ap, cp (shapes of $\xi$, $\eta$ hyperpriors) | 1, 1 | scHPF_.py:229, 232 @df4cb468 |
| scHPF | bp, dp (rate hyperpriors) | empirical from data | scHPF_.py:230, 233, 865–876 @df4cb468 |
| scHPF | min_iter, max_iter, check_freq, epsilon | 30, 1000, 10, 0.001 | scHPF_.py:234–237 @df4cb468 |
| fastTopics | Poisson NMF iterations; solver | 100; `scd` | R/fit_poisson_nmf.R:357, 360 @5cf9a448 |
| fastTopics | topic model iterations (main, refine) | 100, 100 | R/fit_topic_model.R:105 @5cf9a448 |
| fastTopics | topic model solvers (main, refine); initialisation | `em`, `scd`; topicscore | R/fit_topic_model.R:105–106 @5cf9a448 |

## 5. Proposed singlet approach

**Routes.** cNMF's consensus logic (MIT) and the scHPF and fastTopics solver updates (BSD-2) are ported. RcppML and scikit-learn's NMF are callouts, used only as comparators (section 12).

**Proposed model.** Fit the Gamma-Poisson model of section 3 to the variable-gene counts by variational inference, from `n_restarts` random starts. Each start yields Gamma posteriors, so every loading has a posterior mean and standard deviation. Starts are matched to a reference start by Hungarian assignment on loading correlation, and a program is reported as stable when it is matched in at least 80% of starts (proposed threshold). The matched frequency replaces the density threshold $\tau$, and the posterior spread gives each program an uncertainty.

**Falsification.** `schpf` stays the default only if, on B1 under simulation (b) at $K=K_{\text{true}}$, its mean matched correlation is at least that of `cnmf` and its 90% interval coverage is at least 0.8 (proposed). If either fails, the default becomes `cnmf` at $\tau=0.5$ and the uncertainty claim is withdrawn. If B2 shows the matched-frequency rule gives lower top-gene Jaccard than the density filter at equal starts, the density filter is used instead.

**Kernels and hardware.** The updates are closed form, so no autodiff is needed and PyTorch is not used. The hot operations are the sparse-dense products $XW$ (cuSPARSE SpMM) and the replicate distance GEMM (cuBLAS). The elementwise Gamma updates are hard-coded CUDA, with the same loops in C++ on CPU. The method is not streaming: programs are fitted on the full variable-gene matrix held as sparse counts. The replicate distance matrix grows as $(RK)^2$, so at atlas scale it needs subsampling or a minibatch variant (section 10).

**Defaults an agent uses without asking.** `method` schpf, `n_restarts` 20, `seed` 0, `device` auto, `layer` counts, `overwrite` false. K is always supplied by the caller.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse integer | raw UMI counts; all methods use the variable-gene subset |
| read | var/highly_variable | boolean per gene | variable-gene mask from the upstream feature selection task |
| read | obs/library_size | float per cell | size factor; computed from layers/counts when absent |
| write | obsm/program_usage | float32, cells × K | expected molecules per program (section 3) |
| write | varm/program_loadings | float32, genes × K | L1-normalised gene distributions |
| write | uns/program_stability | table, K rows | per-program stability and matched frequency; posterior spread for schpf |
| write | uns/program_params | struct | method, parameters, seed, backend, software version |
| write | models/program | model state | fitted Gamma-Poisson or Poisson NMF state; not written for cnmf |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "counts" | — | Count layer to read; the variable-gene mask is read from var/highly_variable. |
| `k` | integer | required | min 2; max 200 | Number of programs K. Required; choose it with programs.program_number_selection. |
| `method` | string | "schpf" | `schpf`, `fasttopics`, `cnmf` | Decomposition method. schpf is the model-based default; cnmf is the consensus comparator. |
| `n_restarts` | integer | 20 | min 2; max 200 | Independent random starts; stability is computed across starts. cNMF calls this n_iter. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for the random starts; reproducible on the same backend. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `cnmf` | object | — | — | Options for method cnmf; the call is refused for other methods. |
| `cnmf.local_density_threshold` | number | 0.5 | max 2; > 0 | Density threshold tau; replicates at or above it are discarded before clustering. |
| `cnmf.local_neighborhood_size` | number | 0.3 | max 1; > 0 | Fraction of starts used as nearest neighbours for local density. |
| `cnmf.max_nmf_iter` | integer | 1000 | min 1 | Maximum iterations per Frobenius NMF start. |
| `schpf` | object | — | — | Options for method schpf; the call is refused for other methods. |
| `schpf.a` | number | 0.3 | > 0 | Shape of the Gamma prior on usages. |
| `schpf.c` | number | 0.3 | > 0 | Shape of the Gamma prior on loadings. |
| `schpf.max_iter` | integer | 1000 | min 1 | Maximum variational iterations per start. |
| `schpf.epsilon` | number | 0.001 | > 0 | Relative change in loss below which a start counts as converged. |
| `fasttopics` | object | — | — | Options for method fasttopics (Poisson NMF); the call is refused for other methods. |
| `fasttopics.solver` | string | "scd" | `scd`, `em`, `mu`, `ccd` | Poisson NMF optimiser. |
| `fasttopics.numiter` | integer | 100 | min 1 | Maximum outer iterations per start. |
<!-- PARAMS:AUTO:END -->

K has no default and must be supplied. The call is refused if var/highly_variable is absent. A method object applies only to its method, and supplying one for another method is an error. `n_restarts` is the number of starts for every method; cNMF calls it `n_iter`. `seed` fixes the starts, so repeated calls on one backend reproduce the same programs. cNMF's internal normalisation is not exposed.

## 7. MCP tool

Tool name `singlet_programs_denovo_program_decomposition` (definition in `tasks/mcp/singlet_programs_denovo_program_decomposition.json`).

```json
{"dataset": "data/pbmc_discovery.singlet", "k": 12, "method": "schpf", "n_restarts": 20, "seed": 0}
```

```json
{"dataset": "data/pbmc_discovery.singlet", "status": "completed",
 "wrote": ["obsm/program_usage", "varm/program_loadings", "uns/program_stability", "uns/program_params", "models/program"],
 "summary": {"method": "schpf", "k": 12, "n_restarts": 20, "n_cells": "<n>", "median_program_stability": "<value>", "programs_stable": "<count>"},
 "provenance_id": "<id>"}
```

Long-running: inputs above the implementation's size threshold return `queued` with a `job_id`. Stochastic: yes, through `seed`, which controls the random starts. Dry run returns `seconds`, `peak_memory_gb` and `device`, estimated from the non-zero count, K and `n_restarts`, and calibrated on P1.

## 8. Benchmarks

**Shared protocol.** Every method receives the same variable-gene mask, K and counts; ground truth is never passed to a method. Each fit uses 20 starts (two batches of 10 for B2). Simulations use $G=2000$ genes and $n=20{,}000$ cells. Seeds 0 to 4 index independent simulations and start sets. Scores are computed per simulation and averaged with equal weight. Matching ties are broken by the solver and reported. Each method keeps its own stopping rule, and hardware, thread count and software versions are recorded with every fit.

### B1. Planted-program recovery on simulated counts

- **Goal**: recover planted programs and planted compositions at a known K.
- **Ground truth**: planted simulation. Per program, $\beta^\ast_k$ is the planted loading, L1-normalised over the 2000 genes. Per cell, $\pi^\ast_{ck}=U^\ast_{ck}/\sum_j U^\ast_{cj}$, where $U^\ast_{ck}$ is the generating expected count.
- **Generator (proposed)**:
  1. $K_{\text{true}}\in\{10,30\}$ programs: half identity programs, each tied to one of five cell types, and half activity programs, the distinction drawn in the title of [R1]. Program $k$ has a random 5% gene set $T_k$ and $\beta^\ast_{kg}\propto b_g(1+4\,\mathbb{1}[g\in T_k])$ with $b_g\sim\mathrm{LogNormal}(0,1)$.
  2. Each cell has one of five types, uniformly. Weights $\gamma_{ck}\sim\mathrm{Gamma}(s_{ck})$ with shape 3 for an identity program of the cell's type, 0.2 for other identity programs and 0.5 for activity programs; $\pi^\ast_{ck}=\gamma_{ck}/\sum_j\gamma_{cj}$.
  3. Library sizes $L_c\sim\mathrm{LogNormal}(\log 5000,\,0.5)$; $U^\ast_{ck}=L_c\pi^\ast_{ck}$ and $\mu_{cg}=\sum_k U^\ast_{ck}\beta^\ast_{kg}$.
  4. Observation (a): $X_{cg}\sim\mathrm{Poisson}(\mu_{cg})$. Observation (b): $X_{cg}\sim\mathrm{NB}(\mu_{cg},\text{size}=2)$, then each entry is set to zero with probability 0.2.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulation (a) | Generator steps 1–4a | Synthetic counts, $G=2000$, $n=20{,}000$ | not applicable | Five seeds per $K_{\text{true}}$ |
| Simulation (b) | Generator steps 1–4b | Synthetic counts, $G=2000$, $n=20{,}000$ | not applicable | Guards against Poisson-only favouritism |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Matched program correlation | Pearson correlation of $\hat\beta_k$ and $\beta^\ast_k$ over all 2000 genes; Hungarian assignment maximising the summed correlation; mean over planted programs | higher | primary | — |
| Program recall | Fraction of planted programs with matched $r\ge 0.7$, threshold fixed before fitting | higher | primary | — |
| Spurious fraction | Fraction of fitted programs with $\max r<0.3$ to every planted program, or $r>0.9$ to an already matched program | lower | primary | — |
| Usage correlation | Pearson correlation over cells of $\hat\pi_{ck}$ and $\pi^\ast_{ck}$ for matched pairs, averaged | higher | guardrail | — |
| Interval coverage | Share of $\pi^\ast_{ck}$ inside nominal 90% posterior intervals (schpf only) | 0.90 target | guardrail | — |

- **Comparators**: `cnmf` at $\tau=0.5$ and $\tau=0.01$; single-start Frobenius NMF; `fasttopics`; `schpf`.
- **Protocol**: fits at $K_{\text{true}}-2$, $K_{\text{true}}$ and $K_{\text{true}}+2$. All 2000 simulated genes are kept, so variable-gene selection cannot remove a planted program.
- **Acceptance criterion** (proposed, not from the literature): under simulation (b) at $K=K_{\text{true}}$, the default method reaches mean matched correlation of at least 0.8, recall of at least 0.9 and spurious fraction of at most 0.1.
- **Known pitfalls**: a Poisson-only simulator favours Poisson fitters, so (b) is required. A fitted program can match two planted programs at moderate correlation; duplicates are reported separately from spurious programs.

### B2. Run-to-run reproducibility at the chosen K

- **Goal**: test whether programs recur across independent starts at the chosen K.
- **Ground truth**: consistency across starts, with no external label. Per program, stability is the Jaccard overlap of its top-50 genes (ranked by $\beta_k$) with the Hungarian-matched program from the other start batch.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulation (b) | B1 generator | Synthetic counts, $G=2000$, $n=20{,}000$ | not applicable | $K_{\text{true}}\in\{10,30\}$, offsets $\pm2$, seeds 0 to 4 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Consensus silhouette | Silhouette (Euclidean) of L2-normalised replicate programs, clustered by K-means with k = K, n_init 10, random_state 1; computed on the replicates each method retains | higher | primary | — |
| Top-50 Jaccard across batches | Starts split into two batches of 10; Hungarian matching on the Jaccard matrix between batches; mean over matched pairs | higher | primary | — |
| Outlier rate | Fraction of replicates with $d_p\ge\tau$ (cnmf only) | reported | guardrail | — |

- **Comparators**: the B1 set, each with the same 20 starts per K.
- **Protocol**: silhouette and Jaccard are reported at every K, so over-splitting shows as falling Jaccard at fixed silhouette.
- **Acceptance criterion** (proposed): at the chosen K, silhouette of at least 0.5 and Jaccard of at least 0.5 for at least 80% of programs.
- **Known pitfalls**: silhouette favours compact clusters and small K, so it must be read with the B1 spurious fraction. A stable program can still be technical; stability is not accuracy.

### B3. Held-out count likelihood

- **Goal**: test whether a fit predicts withheld genes of unseen cells, without labels.
- **Ground truth**: withheld counts $X_{cg}$, $(c,g)\in\mathcal H$. The estimand is the mean Poisson deviance per withheld entry, $D=\frac{1}{|\mathcal H|}\sum_{(c,g)\in\mathcal H}2\big[X_{cg}\log\frac{X_{cg}}{\hat\mu_{cg}}-(X_{cg}-\hat\mu_{cg})\big]$ with $0\log 0=0$, where $\hat\mu_{cg}=\hat L_c\sum_k\hat\pi_{ck}\beta_{kg}$ and $\hat L_c=\sum_{g\in\mathcal O_c}X_{cg}\big/\sum_{g\in\mathcal O_c}\sum_k\hat\pi_{ck}\beta_{kg}$ use observed genes $\mathcal O_c$ only.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulations (a) and (b) | B1 generator | Synthetic counts, $G=2000$ | not applicable | Train 16,000 cells, test 4,000; 20% of genes withheld per test cell, stratified by zero and non-zero counts; five splits |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Held-out deviance per entry | $D$ over all withheld entries of the test cells | lower | primary | — |
| Held-out squared error | Mean squared error of withheld entries against $\hat\mu_{cg}$ | lower | guardrail | — |

- **Comparators**: `cnmf` (consensus programs with NNLS usages on observed genes); `fasttopics`; `schpf`; uniform composition $\hat\pi_{ck}=1/K$ as a floor.
- **Protocol**: variable genes and library estimates use training cells only; methods are compared paired by split.
- **Acceptance criterion** (proposed): a method is preferred only if its deviance is lower than the next-best method on all five splits. Under no difference, the one-sided sign test gives $p=(1/2)^5=0.031<0.05$.
- **Known pitfalls**: simulation (a) favours Poisson fitters, so (b) is required. Random gene splits overstate gains when genes are co-expressed; a split by co-expression module is the check.

### P1. Performance and scaling

Cells $10^4$, $10^5$ and $10^6$ at $G=2000$ and $K\in\{10,50\}$ with 20 starts, on one CPU thread, all CPU threads, and one CUDA device. Metrics: time per iteration and per converged fit, peak host and device memory, and time per million cells, because the catalogue holds 354M cells. Comparators: `cnmf` (scikit-learn NMF, CPU), `fasttopics` (R, CPU), `schpf` (CPU), and RcppML (R, CPU; its README describes a CUDA path that is not measured here). Acceptance criterion (proposed): the CUDA path of the default method is at least 10 times faster per converged fit than CPU `cnmf` at $10^6$ cells, with B1 matched correlation within 0.02. Held fixed: seed, gene set, K, starts and hardware record. Each method keeps its own stopping rule.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `programs.program_number_selection`: Choosing the number of programs K and retaining reproducible programs
- **Feeds**:
  - `programs.program_usage_estimation`: Per-cell usage of fitted gene programs
  - `programs.identity_activity_program_labeling`: Separating identity, activity and technical programs
- **Reads**: `layers/counts`, `var/highly_variable`, `obs/library_size`
- **Writes**: `obsm/program_usage`, `varm/program_loadings`, `uns/program_stability`, `uns/program_params`, `models/program`
<!-- CHAINING:AUTO:END -->

Belongs to the discovery workflow: variable genes, then K, then decomposition. Stored loadings are reused by the reference-query workflow through `programs.program_usage_estimation`.

## 10. Risks, pitfalls and open questions

- **Unverified sources.** The simulation design, planted-component count and numeric results of Kotliar et al. [R1] are unverified; only its title and DOI are used. Lee and Seung (1999) and Brunet et al. (2004) are cited from memory without DOIs. The DeBruine et al. venue is only the bioRxiv preprint, and the topic-model and Poisson NMF equivalence in [R6] is stated without re-derivation.
- **Code facts.** The cNMF `factorize` docstring lists `beta_loss='kullback-leibler'` and `max_iter=200` (cnmf.py:717–720), against code defaults of frobenius and 1000. The local clones are not git checkouts, so the recorded commits are the remote heads at check time.
- **Excluded candidates.** CoGAPS [R8] is absent from the tables because its algorithm and defaults are unverified here. ICA is omitted because its primary paper is cited from memory only. Prior-guided factorisations belong to `programs.prior_guided_program_discovery`, and biological annotation of programs to `programs.program_annotation`. The MSigDB licence and release version remain open [R9].
- **Unsettled science.** No ground-truth benchmark is agreed across NMF and topic-model packages. The default density threshold (0.5) and the README example (0.01) differ by a factor of 50, and no rule selects $\tau$ from data; B2 is the proposed test. Stability is also not accuracy.
- **Data gaps.** B2 and B3 use simulation only. Real-data stability needs a count matrix with stated species, size and licence, not yet chosen. Minibatch support in fastTopics and scHPF remains to be established, and atlas-scale use depends on it.
- **First experiment.** On B1 under simulation (b) at $K=K_{\text{true}}=10$, compare `schpf` and `cnmf` on matched correlation and interval coverage at equal wall time. Keep `cnmf` as the default unless `schpf` gains at least 0.01 in mean matched correlation (proposed threshold).

## 11. References

R1. Kotliar D, Veres A, Nagy MA, Tabrizi S, Hodis E, Melton DA, Sabeti PC. Identifying gene expression programs of cell-type identity and cellular activity with single-cell RNA-Seq. *eLife* 2019. doi:10.7554/eLife.43803 — partial (corpus)
R2. Levitin HM, Yuan J, Cheng YL, et al. De novo gene signature identification from single-cell RNA-seq with hierarchical Poisson factorization. *Molecular Systems Biology* 2019. doi:10.15252/msb.20188557 — partial (repo)
R3. Lee DD, Seung HS. Learning the parts of objects by non-negative matrix factorization. *Nature* 1999. — unverified (memory)
R4. Brunet JP, Tamayo P, Golub TR, Mesirov JP. Metagenes and molecular pattern discovery using matrix factorization. *Proceedings of the National Academy of Sciences* 2004. — unverified (memory)
R5. Dey KK, Hsiao CJ, Stephens M. Visualizing the structure of RNA-seq expression data using grade of membership models. *PLoS Genetics* 2017. doi:10.1371/journal.pgen.1006599 — partial (repo)
R6. Carbonetto P, Sarkar A, Wang Z, Stephens M. Non-negative matrix factorization algorithms greatly improve topic model fits. arXiv:2105.13440, 2021. — partial (repo)
R7. DeBruine ZJ, Melcher K, Triche TJ. Fast and robust non-negative matrix factorization for single-cell experiments. *bioRxiv* 2021. doi:10.1101/2021.09.01.458620 — partial (corpus)
R8. Fertig EJ, et al. CoGAPS: an R/C++ package to identify patterns and biological process activity in transcriptomic data. *Bioinformatics* 2010. doi:10.1093/bioinformatics/btq503 — partial (corpus)
R9. Liberzon A, Subramanian A, Pinchback R, Thorvaldsdóttir H, Tamayo P, Mesirov JP. Molecular signatures database (MSigDB) 3.0. *Bioinformatics* 2011. — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/dylkot/cNMF | Dylan Kotliar (setup.py) | MIT (LICENSE, Copyright 2019 Dylan Kotliar) | consensus and replicate logic; defaults in section 4 | port |
| https://github.com/simslab/scHPF | Hanna Mendes Levitin (setup.py); Sims Lab (LICENSE) | BSD-2-Clause (LICENSE); setup.py states BSD | variational updates and priors for `schpf` | port; kernels re-implemented in CUDA |
| https://github.com/stephenslab/fastTopics | Peter Carbonetto, Matthew Stephens (DESCRIPTION) | BSD-2-Clause (DESCRIPTION; LICENSE) | Poisson NMF solvers for `fasttopics` | port |
| https://github.com/zdebruine/RcppML | Zachary DeBruine (DESCRIPTION) | GPL (>= 3) in DESCRIPTION and README; a secondary record gives GPL-2.0; no LICENSE file at the root | comparator in P1 | callout; no code taken |
| https://github.com/scikit-learn/scikit-learn | The scikit-learn developers (COPYING) | BSD-3-Clause (COPYING) | coordinate-descent NMF called by cNMF; single-start comparator | callout |
| https://github.com/lrjuan/LDA_scRNAseq | — | no licence file in the repository | LDA workflow for scRNA-seq | excluded |
