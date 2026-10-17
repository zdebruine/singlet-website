---
id: velocity.gene_kinetics_velocity_estimation
title: Per-gene kinetics and RNA velocity estimation from spliced and unspliced counts
area: velocity
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.spliced_unspliced_counting, qc.low_quality_cell_detection, neighbors.approximate_knn_search]
feeds: [velocity.latent_time_inference, velocity.velocity_transition_graph, velocity.velocity_uncertainty]
reads: [layers/spliced, layers/unspliced, obsp/connectivities, obsm/X_pca]
writes: [var/alpha, var/beta, var/gamma, var/velocity_genes, layers/velocity, layers/velocity_uncertainty, uns/velocity_params, models/<name>]
devices: [cpu, cuda]
mcp_tool: singlet_velocity_gene_kinetics_velocity_estimation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Per-gene kinetics and RNA velocity estimation from spliced and unspliced counts

> Fits a two-pool kinetic model to each gene's spliced and unspliced counts and returns degradation ratios and per-cell velocity, with the steady-state and dynamical methods of the literature kept as comparators.

## 1. Question

What transcription, splicing and degradation rates per gene, and what per-cell velocity (the instantaneous rate of change of spliced abundance), best explain observed spliced and unspliced UMI counts? The input is a cells-by-genes pair of spliced and unspliced matrices, with a kNN graph for smoothing. The output is a per-gene kinetic table and a cells-by-genes velocity matrix. A correct answer recovers ratios of rates and the direction of velocity; absolute rates and the time origin are not identifiable from counts (section 3).

## 2. Why this task matters and where the field stands

RNA velocity converts unspliced and spliced counts into a predicted direction of change for each cell. Latent time, transition graphs and fate estimates take that direction as evidence about where cells are heading, so errors in the fit propagate downstream. The task is **contested**. Steady-state residuals [R1] assume equilibrium, which fails in erythroid maturation, where kinetics change along differentiation [R3]. The scVelo dynamical model fits a per-gene switch-time ODE and removes the equilibrium assumption for transient states [R2]. Learned models relax constant rates further and return cell-specific or posterior quantities [R4], [R5], [R6], [R7]. Reviews argue that the assumptions are often violated [R8]. A 2022 preprint is devoted to understanding and interpreting velocity estimates [R9]. Length biases in pre-mRNA counts distort the unspliced counts that velocity fits use [R10]. Velocity projected on a two-dimensional embedding depends on the number of included genes and on plotting parameters, so high-dimensional checks are preferred (best-practices key takeaways). A 2022 critical review tests the assumptions of popular velocity implementations and their sensitivity to user-set parameters, using simulations and controlled experiments [R11]. The open problems are the unidentified absolute scale, the lack of an accepted benchmark, and uncalibrated uncertainty (section 10).

## 3. Theory and insight

### Model

Each gene is a two-pool linear system. Unspliced RNA $u$ is produced at rate $\alpha(t)$ and converted to spliced RNA $s$ at rate $\beta$, and spliced RNA degrades at rate $\gamma$.

$$\frac{du}{dt}=\alpha(t)-\beta u,\qquad \frac{ds}{dt}=\beta u-\gamma s.$$

The equations describe mean counts. They are first order in $u$ and $s$ and need stochastic corrections at low counts. Velocity is the time derivative of spliced abundance, $v=\frac{ds}{dt}=\beta u-\gamma s$, in counts per unit time.

With constant $\alpha$ and $u(0)=s(0)=0$, integration gives, for $\beta\neq\gamma$,

$$u(t)=\frac{\alpha}{\beta}\left(1-e^{-\beta t}\right),\qquad s(t)=\frac{\alpha}{\gamma}\left(1-e^{-\gamma t}\right)+\frac{\alpha}{\gamma-\beta}\left(e^{-\gamma t}-e^{-\beta t}\right).$$

The regime is constant $\alpha$, $t\ge 0$ and $\beta\neq\gamma$; the $\beta=\gamma$ limit is a separate expression. Repression and switch-time forms follow by shifting $t$ and changing the initial state. Dynamical methods evaluate these forms per gene on a time grid.

**Steady state.** As $t\to\infty$ with constant $\alpha$, $u_\infty=\alpha/\beta$ and $s_\infty=\alpha/\gamma$, so steady-state cells lie on $u=(\gamma/\beta)s$. A through-origin regression of $u$ on $s$ over steady-state cells gives $\hat q=\sum_c s_c u_c/\sum_c s_c^2$, which estimates $\gamma/\beta$. The residual $u-\hat q s$ equals $v/\beta$, so the residual is velocity up to the factor $\beta$. The regime is equilibrium of the selected cells, which in practice means the upper-right and origin corners of the phase portrait.

**Identifiability.** Under $(\alpha,\beta,\gamma,t)\mapsto(c\alpha,c\beta,c\gamma,t/c)$, $u(t)$ and $s(t)$ are unchanged. Ratios $\gamma/\beta$ and $\alpha/\gamma$ are therefore identifiable, absolute rates are not, and velocity scales with $c$. Under linear capture with gene-specific scales ($u'=\eta_u u$, $s'=\eta_s s$), the observed splicing term is multiplied by $\rho=\eta_s/\eta_u$ while $\gamma$ is unchanged. The fitted ratio is then $\gamma/(\rho\beta)$. Fitting $\rho$ (the `fit_scaling` option) is required before $\gamma/\beta$ can be read as a biological ratio.

| Symbol | Meaning |
|---|---|
| $u$, $s$ | unspliced and spliced molecule abundance in a cell |
| $\alpha$, $\beta$, $\gamma$ | transcription, splicing and spliced degradation rates |
| $v$ | velocity, $ds/dt$ |
| $\eta_u$, $\eta_s$, $\rho$ | per-gene capture scales and their ratio $\rho=\eta_s/\eta_u$ |
| $t_c$ | latent time of cell $c$ |

### Estimands

Each output and ground-truth quantity, with its normalisation:

- **Degradation rate** $\gamma$ (`var/gamma`): a rate in inverse time on the chosen time scale, identifiable only up to a common scale, so only ranks across genes are compared.
- **Ratio** $\gamma/\beta$ (`var/gamma` over `var/beta`): scale-free and identifiable only with $\rho$ fitted; steady-state methods return it under a shared $\beta$.
- **Velocity** $v_{c,g}$ (`layers/velocity`): in spliced-count units per unit time; its direction is invariant to $c$, and comparisons use cosines, which ignore a global positive scale.
- **Planted velocity**: $\eta_s(\beta u-\gamma s)$ at the planted cell time, which places it on the observed spliced scale.
- **Latent time** $t_c$: identified up to a monotone transform and orientation, so compared by Spearman rank after an oracle root.
- **Smoothed moments** $\tilde u_c$ and $\tilde s_c$: row-normalised kNN averages on the scale of their inputs, valid when neighbours share a state.
- **Labelling-derived rate**: the gene-level degradation rate, or $1/t_{1/2}$, reported by the labelling study and compared by rank only.

### Regimes and failure modes

- **Steady-state family**: needs equilibrium in the selected cells and one splicing rate shared across genes. It is violated in erythroid maturation [R3].
- **Dynamical family**: one trajectory per gene and constant rates within each phase, giving an almond-shaped phase portrait. Genes with several regimes or lineage-specific transitions give averaged portraits, so lineage-level subsetting is needed.
- **Learned family**: amortised posteriors are only as calibrated as their priors and networks. Calibration is the open item in section 10.
- **Smoothing**: neighbours must share a state. Cross-lineage neighbours mix states and inflate coherence scores.
- **Data**: unspliced quantification bias [R10] changes estimates, and the set of genes included changes projected velocity (best-practices key takeaways). Orientation and time scale need a root or a prior.

Benchmark critiques [R8], [R11] examine whether the velocity assumptions hold in practice. The best-practices key takeaways name steady-state systems such as peripheral blood mononuclear cells, and processes whose time scale is not comparable to RNA half-lives, as cases where velocity does not apply.

**Why a model.** Heuristics fit one regression and report no uncertainty. A model with an explicit likelihood gives posterior intervals for $\gamma/\beta$ and velocity, can share rate priors across datasets, and can take covariates. The heuristic standard stays as a comparator, and the model is credible only if it beats that standard on the benchmarks in section 8.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| velocyto steady-state gamma | heuristic | Regress unspliced on spliced counts over extreme-quantile cells; the residual is velocity | [R1], [R12] |
| scVelo steady-state (deterministic) | heuristic | Steady-state regression on kNN-smoothed moments with a shared splicing rate; the residual is velocity | [R2] |
| scVelo stochastic | hybrid | Steady-state-type regression on smoothed first and second moments; the default velocity mode | [R2] |
| scVelo dynamical | model-based | Per-gene switch-time ODE fitted by EM, with per-cell latent time; velocity is $ds/dt$ | [R2], [R8] |
| UniTVelo | model-based | Per-gene kinetics on phase portraits with a unified latent time updated jointly | [R13] |
| VeloVI | model-based | Amortised variational model decoding four-state induction and repression kinetics, with posterior sampling | [R4] |
| DeepVelo | model-based | Deep network assigns cell-specific kinetic rates for multi-lineage systems | [R7] |
| VeloVAE | model-based | Variational mixture of ODEs inferring latent time and velocity jointly from scRNA-seq data | [R5], [R6] |

The steady-state residual [R1], [R12] is the cheapest standard and the comparator every model-based method must beat. The scVelo dynamical mode [R2] is the published extension to transient states and the reference for the acceptance criteria in section 8. The learned methods are described in their own papers [R4], [R5], [R6], [R7], [R13]. The CBDir and ICVCoh metrics are implemented in the VeloVAE repository. The VeloAE line of work [R14] is cited as the nearest published context; its treatment of these metrics was not read (section 10).

Defaults for the methods singlet will implement, and for the scVelo comparator, taken from source code:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| velocyto steady-state | `fit_gammas.maxmin_perc` | [2, 98] | velocyto/analysis.py:1122 @56efe89 |
| velocyto steady-state | `fit_gammas.fit_offset` | True | velocyto/analysis.py:1121 @56efe89 |
| velocyto steady-state | `fit_gammas.weights` | maxmin_diag | velocyto/analysis.py:1121 @56efe89 |
| velocyto steady-state | `knn_imputation.k` | int(N*0.025) | velocyto/analysis.py:983-984 @56efe89 |
| scVelo | `velocity.mode` | stochastic (default); `deterministic` must be passed explicitly | scvelo/tools/velocity.py:237 @f63c0e7 |
| scVelo | `velocity.fit_offset` | False | scvelo/tools/velocity.py:238 @f63c0e7 |
| scVelo | `velocity.fit_offset2` | False | scvelo/tools/velocity.py:239 @f63c0e7 |
| scVelo steady-state | `compute_deterministic.perc` | None in the method; `velocity()` sets [5, 95] when None; the EM gene selection passes [5, 95] | scvelo/tools/velocity.py:62, 322-323; scvelo/tools/_em_model_core.py:521 @f63c0e7 |
| scVelo | `moments.n_neighbors` | 30 | scvelo/preprocessing/moments.py:14 @f63c0e7 |
| scVelo | percentile filter of `fit_scaling` in velocity() | [10, 90] | scvelo/tools/velocity.py:389 @f63c0e7 |
| scVelo dynamical | `recover_dynamics.max_iter` | 10 | scvelo/tools/_em_model_core.py:405 @f63c0e7 |
| scVelo dynamical | `recover_dynamics.assignment_mode` | projection | scvelo/tools/_em_model_core.py:406 @f63c0e7 |
| scVelo dynamical | `recover_dynamics.fit_time` | True | scvelo/tools/_em_model_core.py:408 @f63c0e7 |
| scVelo dynamical | `recover_dynamics.fit_scaling` | True | scvelo/tools/_em_model_core.py:409 @f63c0e7 |
| scVelo dynamical | `recover_dynamics.fit_steady_states` | True | scvelo/tools/_em_model_core.py:410 @f63c0e7 |
| scVelo dynamical | `recover_dynamics.var_names` | velocity_genes | scvelo/tools/_em_model_core.py:403 @f63c0e7 |
| scVelo test fixtures | `min_shared_counts` | 20 (fixture value; the function default is None) | tests/conftest.py:54; preprocessing/utils.py:42 @f63c0e7 |

## 5. Proposed singlet approach

**Ports and default.** The default method is `scvelo_dynamical`. The three scVelo modes are ported from permissive source, and VeloVI is ported to PyTorch from its permissive source. Methods whose source is copyleft, unknown or in conflict are reimplemented, and methods used only for comparison are callouts. Section 12 gives the route for each method.

**Proposed model.** singlet proposes a hierarchical kinetic model. Each gene has rates $(\alpha,\beta,\gamma)$ and a count-scale ratio $\rho$, with priors shared across genes. Each cell has a latent time $t_c$ and a posterior over its position on each gene's switch-time curve. Velocity is the posterior mean of $ds/dt$, with a posterior standard deviation per cell and gene, and $\gamma/\beta$ is reported with a 90% interval. The model is falsified if, on planted condition (a) of B2, its rank correlation for $\log(\gamma/\beta)$ falls more than 0.05 below scVelo dynamical, or if its 90% intervals cover the planted $\log(\gamma/\beta)$ for fewer than 85% or more than 95% of genes (proposed limits). Shared priors are fitted on catalogue cells that carry spliced and unspliced layers; whether enough such cells exist is an open item (section 10).

**ML stack.** PyTorch for the encoder, decoder and priors of the learned methods, following VeloVI and VeloVAE. Hard-coded CUDA or cuSPARSE kernels are used only for three small, hot, linear pieces: sparse moment smoothing as sparse matrix products over the kNN graph, closed-form evaluation of the induction solution on a cell-by-gene-by-time grid, and batched per-gene steady-state regression. Each has a CPU implementation with the same numerics.

**Streaming.** Per-gene regression and closed-form evaluation stream over gene blocks. The EM latent-time update streams over cell blocks given gene parameters. Streaming is a design target and is not declared in the metadata until it is measured.

**Defaults.** An agent uses the MCP defaults (section 7) without asking: `scvelo_dynamical`, 20 minimum shared counts, 2,000 genes, 30 neighbours and `fit_scaling` on. The source values behind these are in section 4, except the 2,000-gene default, which is a singlet choice with no scVelo source default.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/spliced | sparse int | spliced UMI counts, cells by genes |
| read | layers/unspliced | sparse int | unspliced UMI counts, same shape |
| read | obsp/connectivities | sparse float | kNN graph for moment smoothing; not read by `velovae` |
| read | obsm/X_pca | float32 | optional; used only when the graph is rebuilt |
| write | var/alpha | float32 | transcription rate; dynamical and learned methods only |
| write | var/beta | float32 | splicing rate; dynamical and learned methods only |
| write | var/gamma | float32 | degradation rate; steady-state methods write the ratio to a shared $\beta$ |
| write | var/velocity_genes | bool | genes passing `min_shared_counts` with a fitted model |
| write | layers/velocity | float32 | per-cell, per-gene velocity, cells by genes |
| write | layers/velocity_uncertainty | float32 | posterior standard deviation per cell and gene; learned methods only |
| write | uns/velocity_params | dict | method, parameters, upstream defaults and fit diagnostics |
| write | `models/<name>` | weights | learned methods only, named by method |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "scvelo_dynamical" | `scvelo_dynamical`, `scvelo_stochastic`, `scvelo_steady_state`, `velovi`, `velovae` | Kinetic method; scvelo_dynamical is the default and the reference. |
| `min_shared_counts` | integer | 20 | min 1 | Minimum shared spliced plus unspliced counts per gene before fitting. |
| `n_top_genes` | integer | 2000 | min 1 | Highly variable genes passed to the kinetic fit. |
| `n_neighbors` | integer | 30 | min 1 | kNN size for first and second moment smoothing. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed; used by velovi and velovae only. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `scvelo` | object | — | — | Options for the three scvelo_* methods; ignored by the learned methods. |
| `scvelo.max_iter` | integer | 10 | min 1 | EM iterations for the dynamical method. |
| `scvelo.fit_scaling` | boolean | true | — | Fit the per-gene unspliced and spliced scale ratio rho. |
| `scvelo.fit_steady_states` | boolean | true | — | Allow steady-state states in the dynamical model. |
| `scvelo.fit_time` | boolean | true | — | Fit per-cell time inside the dynamical model. |
| `scvelo.fit_offset` | boolean | false | — | Fit an intercept in the steady-state regression. |
| `scvelo.quantiles` | array | [5, 95] | — | Percentile pair selecting extreme cells for steady-state initialisation. |
| `velovi` | object | — | — | Options for velovi; ignored by other methods. |
| `velovi.n_samples` | integer | 25 | min 1 | Posterior samples for velocity uncertainty; other training settings use library defaults. |
| `velovae` | object | — | — | Options for velovae; ignored by other methods. |
| `velovae.n_samples` | integer | 25 | min 1 | Posterior samples for velocity uncertainty; other training settings use library defaults. |
<!-- PARAMS:AUTO:END -->

The `scvelo` object applies only to the three `scvelo_*` methods, `velovi` only to `velovi`, and `velovae` only to `velovae`. A block that does not match the chosen method is an error. `min_shared_counts` and `n_top_genes` apply to every method. `n_neighbors` sets moment smoothing for the scVelo methods and for `velovi` input. `seed` affects only the learned methods, and `fit_time` and `fit_steady_states` affect only the dynamical method. `dry_run` returns an estimate without fitting. Latent time is not written here; its task reads the fitted rates.

## 7. MCP tool

Tool name `singlet_velocity_gene_kinetics_velocity_estimation` (definition in `tasks/mcp/singlet_velocity_gene_kinetics_velocity_estimation.json`). Example call and compact result:

```json
{"dataset": "pancreas_endocrine.singlet", "method": "scvelo_dynamical", "scvelo": {"max_iter": 10, "fit_scaling": true}}
```

```json
{"dataset": "pancreas_endocrine.singlet", "status": "completed", "wrote": ["var/alpha", "var/beta", "var/gamma", "var/velocity_genes", "layers/velocity", "uns/velocity_params"], "summary": {"n_genes_fit": "<int>", "n_velocity_genes": "<int>", "fit_iterations": "<int>"}, "provenance_id": "<id>", "job_id": null}
```

Long-running: the dynamical and learned methods on large inputs may return `queued` with a `job_id`; poll the job rather than repeating the call. Stochastic: only `velovi` and `velovae` use `seed`; the scVelo methods have no random step in this design. Dry-run: `dry_run` returns seconds, peak memory and device without fitting, and the estimate stays uncalibrated until P1 is measured.

## 8. Benchmarks

**Shared protocol.** Genes are the highly variable genes passed to the fit (`n_top_genes` = 2,000), restricted to genes with at least 20 shared counts. Cells are the same set for every method. Smoothing uses one kNN graph of 30 neighbours on PCA coordinates; B3 scores with a separate graph on the 2D embedding. Learned methods use 3 seeds in B1 and 10 seeds per condition in B2. Benchmarks report medians with bootstrap intervals over genes. No labelling information enters any fit. Cross-method agreement, meaning pairwise per-cell cosine and per-gene rate Spearman matrices, is reported descriptively in every benchmark. It measures agreement, not accuracy, and has no threshold.

### B1. Gene-level degradation rates against labelling-derived rates

- **Goal**: test whether per-gene degradation rates fitted on unlabelled counts rank genes as labelling-derived degradation rates do, in the same biological system.
- **Ground truth**: orthogonal measurement. For each gene, the degradation rate (or $1/t_{1/2}$, converted to a rate) published by the labelling study, used only as a rank. The method estimand is `var/gamma`, compared by rank with no scale. For steady-state methods, `gamma` is the ratio under a shared splicing rate, so the comparison also tests that assumption.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| scSLAM-seq | [R15] | single-cell 4sU labelling, — | — | labelling design of the source study |
| scEU-seq | [R16] | labelled transcripts in single cells, — | — | — |
| scNT-seq | [R17] | time-resolved nascent RNA in single cells, — | — | — |
| sci-fate | [R18] | cultured cells, combinatorial indexing with 4sU labelling, — | — | profiles whole and newly synthesised transcriptomes |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Gene-level rank agreement | Spearman rho over genes passing `min_shared_counts` and the velocity-gene filter, between fitted `gamma` and the labelled rate; ties averaged, NaN genes dropped; undefined below 200 genes | maximize | primary | — |

- **Comparators**: scVelo steady-state, stochastic and dynamical; VeloVI and VeloVAE where a per-gene degradation output exists; velocyto steady-state gamma, UniTVelo and DeepVelo as callouts. Commits are in section 12.
- **Protocol**: apply each method to the spliced and unspliced layers only, with the same genes, cells and graph. Never train any method on labelled reads, or the comparison is circular.
- **Acceptance criterion** (proposed, not from the literature): the best method reaches rho of at least 0.5; no method is more than 0.05 below scVelo dynamical; seed-to-seed standard deviation of rho for learned methods is at most 0.02.
- **Known pitfalls**: labelled rates depend on the labelling model, and new RNA is not unspliced RNA, so intronic and nascent signals differ. Labelling time scales can also differ from the developmental time scale that velocity targets.

### B2. Planted kinetics with known velocity

- **Goal**: recover planted gene ratios and per-cell velocity under violated rate and trajectory assumptions.
- **Ground truth**: planted simulation (proposed; design choices, not literature values).
  1. For 2,000 genes, draw $\alpha$, $\beta$ and $\gamma$ log-uniformly on $[0.5, 5]$ per unit time; time span $T=1$.
  2. Draw 2,000 cell times $t_c$ uniformly on $[0,T]$.
  3. Condition (a): constant $\alpha$, closed form of section 3. Condition (b): $\alpha$ multiplied by 0.1 after a per-gene switch time uniform on $[0.25T,0.75T]$. Condition (c): a second rate set, drawn as in step 1, replaces the first from $0.5T$. Condition (d): condition (a) at 1,000 UMI per cell (5,000 otherwise).
  4. Integrate on a fine grid; planted velocity is $\beta(t_c)u-\gamma(t_c)s$ with the rates active at $t_c$.
  5. Capture: per-cell depth factors and per-gene lognormal scales $\eta_u$, $\eta_s$ (sigma 0.5), so $\rho=\eta_s/\eta_u$. Counts: negative binomial, dispersion 0.2.
  6. Stored truth: per gene, $\log(\gamma/\beta)$ of the final rate set; per cell, $t_c$ and $\eta_s v_c$.
- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Scale-free rate recovery | Spearman rho across genes, $\log(\hat\gamma/\hat\beta)$ against planted $\log(\gamma/\beta)$ | maximize | primary | — |
| Per-cell velocity cosine | $\cos(\hat v_c, v_c)$ over velocity genes; median and 10th percentile | maximize | primary | — |
| Latent time accuracy | Spearman with planted $t_c$, oriented by the earliest planted cell | maximize | guardrail | — |
| Relative rate error | Median absolute $\log_2$ error of $\hat\alpha$ after one global scale (median of $\alpha/\hat\alpha$) | minimize | guardrail | — |
| Interval coverage | Fraction of genes whose 90% interval contains planted $\log(\gamma/\beta)$ (interval methods only) | target 0.90 | guardrail | — |

- **Comparators**: as in B1.
- **Protocol**: 10 seeds per condition. Condition (a) is also fitted with `fit_scaling` off, to test the section 3 bias.
- **Acceptance criterion** (proposed, not from the literature): on (a), the best method reaches rho of at least 0.7 and median per-cell cosine of at least 0.5; on (b) and (c), rho drops by at most 0.1 from (a).
- **Known pitfalls**: simulating from the ODE that the dynamical and learned models fit is circular; only (b) and (c) test violated rates. Constant-rate data favour steady-state and dynamical models. All metrics are scale-free.

### B3. Expert-defined transition direction and in-cluster coherence

- **Goal**: check that velocity points from prior-known source clusters toward prior-known targets (CBDir), and that it is coherent within each cell type (ICVCoh).
- **Ground truth**: expert labels. Cluster labels come from the source study [R19]. Transition pairs (Pre-endocrine to Alpha, Beta, Delta and Epsilon) are fixed from the lineage order before scoring. With $x$ the 2D embedding, both metrics are cosines in $[-1,1]$:

$$\mathrm{CBDir}(A\to B)=\operatorname{mean}_{i\in C_A}\ \operatorname{nanmean}_{j\in N_B(i)}\cos(x_j-x_i,\,v_i),\qquad \mathrm{ICVCoh}(c)=\operatorname{mean}_{i\in C_c}\ \operatorname{mean}_{j\in N_c(i)}\cos(v_i,\,v_j),$$

where $N_B(i)$ and $N_c(i)$ are the kNN neighbours of $i$ in cluster $B$ or $c$. Cells without neighbours in $B$ are skipped. The overall CBDir is the mean over pairs. The overall ICVCoh is the cell-weighted mean over clusters, a choice of this document.

- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pancreatic endocrinogenesis | [R19]; best-practices velocity chapter | single-cell mRNA, mouse pancreas, — | — | cluster labels and lineage order; spliced and unspliced layers required |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| CBDir | Formula above, per pair, then the mean over pairs; pairs without target links are skipped and counted | maximize | primary | — |
| ICVCoh | Formula above; median velocity norm per cluster reported to expose near-zero vectors | maximize | guardrail | — |

- **Comparators**: as in B1.
- **Protocol**: smoothing uses the PCA graph of section 8; scoring uses a separate kNN graph on the 2D embedding. The cluster column and transition pairs are fixed before scoring. The scores are repeated on PCA coordinates (velocity projected by the PCA loadings) as a sensitivity check. The null shuffles velocity vectors within clusters 1,000 times and reports z-scores.
- **Acceptance criterion** (proposed, not from the literature): the CBDir of the best method is at least 3 standard deviations above its shuffled null; under scVelo dynamical, CBDir is greater than 0 for at least 3 of the 4 endocrine types; no method is more than 0.02 below scVelo dynamical on CBDir.
- **Known pitfalls**: scoring on the smoothing graph is circular, since smoothing already aligns neighbours. ICVCoh rewards smoothing and near-zero vectors, so it is read only together with the norms.

### P1. Performance and scaling

Measure wall time, peak memory and throughput (cells times genes per second) on the B2 condition (a) generator at 10,000, 100,000 and 1,000,000 cells, with 2,000 genes, 30 neighbours and `max_iter` 10. Time the kNN build separately, and report the EM iterations or training epochs reached. Use CPU for the scVelo methods and CUDA for `velovi` and `velovae`, recording the GPU model. Comparators are the methods of B2. Report the hardware for every measurement. Streaming is not claimed, so cell counts above $10^6$ are out of scope.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.spliced_unspliced_counting`: Spliced, unspliced and ambiguous molecule counting
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
- **Feeds**:
  - `velocity.latent_time_inference`: Latent time and temporal ordering from splicing dynamics
  - `velocity.velocity_transition_graph`: Velocity-based cell-to-cell transition graph and embedding projection
  - `velocity.velocity_uncertainty`: Per-cell velocity uncertainty and robustness
- **Reads**: `layers/spliced`, `layers/unspliced`, `obsp/connectivities`, `obsm/X_pca`
- **Writes**: `var/alpha`, `var/beta`, `var/gamma`, `var/velocity_genes`, `layers/velocity`, `layers/velocity_uncertainty`, `uns/velocity_params`, `models/<name>`
<!-- CHAINING:AUTO:END -->

The velocity chain: counts and a kNN graph in; latent time, transition graph and velocity uncertainty downstream.

## 10. Risks, pitfalls and open questions

- **Methods without a characterised source.** cellDancer, Dynamo and Velvet are excluded from the tables, the enum and the comparators. cellDancer has no licence file on its default branch. Dynamo's splicing-only path was not read, and its published estimator is labelling-based [R20]. Velvet is described for time-resolved data, so its use on a single snapshot is unestablished.
- **Code and literature not read.** The defaults of UniTVelo, DeepVelo, VeloVI and VeloVAE were not read, so the learned-method defaults in the MCP file are proposals. The purpose of the [10, 90] percentile filter in `velocity()` and the ICVCoh cluster aggregation were not read. The VeloVAE code gives no citation for CBDir and ICVCoh (`velovae/analysis/evaluation_util.py` at lines 1148 and 1707), and the VeloAE paper [R14] was not checked against the formulas in section 8, so the formulas are cited to the implementation. The quantitative results of Gorin 2022 [R11] were not read beyond its abstract, and the benchmark content of Bergen 2020 [R2] and Zheng 2022 [R9] was not read; only their stated claims are used.
- **Data and bibliography.** Accessions, licences, sizes and spliced and unspliced availability are unknown for every labelling dataset and for the pancreas dataset. The labelling-rate fitting procedure of each source study was not read, so B1 truth is a published rate used as a rank. Catalogue cells are excluded as a benchmark dataset until their layers and transition pairs are specified. Sci-fate [R18] is cited without a DOI because the DOI was not confirmed; its authors were confirmed by web search. The B3 cluster names are taken from the source study and were not checked against a data file. R5 and R6 appear to be two postings of the VeloVAE work, and the repository README carries the R6 title. Gayoso 2024 [R4] is dated 2023 in one bibliography and 2024 in another; 2024 is used. DeepVelo [R7] is cited without authors because none were found in the sources read.
- **Unsettled literature.** Absolute rates, the capture ratio and time orientation are not identified without an external scale or a root. No per-cell truth is defined for B1: a per-cell direction of new-RNA change would need a per-cell time axis that the labelling designs do not specify, so B1 is gene-level only. No velocity-versus-labelling protocol was found in the sources read, and no timing or memory numbers exist for any method in them, so P1 is measured, not quoted.
- **Technical risks.** Without `fit_scaling`, $\log(\hat\gamma/\hat\beta)$ is biased by $-\log\rho$ (section 3). EM convergence at $10^6$ cells and GPU reproducibility of the learned methods are unmeasured. A small cluster such as Epsilon may give unreliable fits, so B3 pair reports carry cell counts. The VeloVAE licence conflict is described in section 12.
- **First experiment.** Apply `scvelo_dynamical` to planted condition (a) of B2 at 2,000 cells with `fit_scaling` on and off. The off-minus-on difference in $\log(\hat\gamma/\hat\beta)$ should equal $-\log\rho$ per gene, using the simulated capture scales. If it does not, the count-scale model is wrong and the approach in section 5 changes first.

## 11. References

R1. La Manno G, Soldatov R, Zeisel A, et al. RNA velocity of single cells. *Nature* 2018;560(7719):494-498. doi:10.1038/s41586-018-0414-6 — verified (corpus)
R2. Bergen V, Lange M, Peidli S, Wolf FA, Theis FJ. Generalizing RNA velocity to transient cell states through dynamical modeling. *Nature Biotechnology* 2020;38(12):1408-1414. doi:10.1038/s41587-020-0591-3 — verified (corpus)
R3. Barile M, Imaz-Rosshandler I, Inzani I, Ghazanfar S, Nichols J, Marioni JC, Guibentif C, Göttgens B. Coordinated changes in gene expression kinetics underlie both mouse and human erythroid maturation. *Genome Biology* 2021;22. doi:10.1186/s13059-021-02414-y — verified (corpus)
R4. Gayoso A, Weiler P, Lotfollahi M, Klein D, Hong J, Streets A, Theis FJ, Yosef N. Deep generative modeling of transcriptional dynamics for RNA velocity analysis in single cells. *Nature Methods* 2024. doi:10.1038/s41592-023-01994-w — verified (corpus)
R5. Gu Y, Blaauw D, Welch JD. Bayesian Inference of RNA Velocity from Multi-Lineage Single-Cell Data. *bioRxiv* 2022. doi:10.1101/2022.07.08.499381 — verified (corpus)
R6. Gu Y, Blaauw D, Welch JD. Variational Mixtures of ODEs for Inferring Cellular Gene Expression Dynamics. *arXiv* 2022. doi:10.48550/ARXIV.2207.04166 — verified (corpus)
R7. DeepVelo: deep learning extends RNA velocity to multi-lineage systems with cell-specific kinetics. *Genome Biology* 2024. doi:10.1186/s13059-023-03148-9 — verified (corpus)
R8. Bergen V, Soldatov RA, Kharchenko PV, Theis FJ. RNA velocity: current challenges and future perspectives. *Molecular Systems Biology* 2021;17(8). doi:10.15252/msb.202110282 — verified (corpus)
R9. Zheng SC, Stein-O'Brien G, Boukas L, Goff LA, Hansen KD. Pumping the brakes on RNA velocity: understanding and interpreting RNA velocity estimates. *bioRxiv* 2022. doi:10.1101/2022.06.19.494717 — verified (corpus)
R10. Gorin G, Pachter L. Length Biases in Single-Cell RNA Sequencing of pre-mRNA. *bioRxiv* 2021. doi:10.1101/2021.07.30.454514 — verified (corpus)
R11. Gorin G, Fang M, Chari T, Pachter L. RNA velocity unraveled. *PLoS Computational Biology* 2022;18(9):e1010492. doi:10.1371/journal.pcbi.1010492. Abstract read via web search. — partial (search)
R12. Zeisel A, Köstler WJ, Molotski N, et al. Coupled pre-mRNA and mRNA dynamics unveil operational strategies underlying transcriptional responses to stimuli. *Molecular Systems Biology* 2011;7:529. doi:10.1038/msb.2011.62 — verified (corpus)
R13. Gao M, et al. UniTVelo: temporally unified RNA velocity reinforces single-cell trajectory inference. *Nature Communications* 2022. doi:10.1038/s41467-022-34188-7 — verified (corpus)
R14. Qiao C, Huang Y. Representation learning of RNA velocity reveals robust cell transitions. *Proceedings of the National Academy of Sciences* 2021;118(49). doi:10.1073/pnas.2105859118 — verified (corpus)
R15. Erhard F, Baptista MAP, Krammer T, Hennig T, Lange M, Arampatzi P, Jürges CS, Theis FJ, Saliba AE, Dölken L. scSLAM-seq reveals core features of transcription dynamics in single cells. *Nature* 2019. doi:10.1038/s41586-019-1369-y — verified (corpus)
R16. Battich N, Beumer J, de Barbanson B, Krenning L, Baron CS, Tanenbaum ME, Clevers H, van Oudenaarden A. Sequencing metabolically labeled transcripts in single cells reveals mRNA turnover strategies. *Science* 2020. doi:10.1126/science.aax3072 — verified (corpus)
R17. Qiu Q, Hu P, Qiu X, Govek KW, Cámara PG, Wu H. Massively parallel and time-resolved RNA sequencing in single cells with scNT-seq. *Nature Methods* 2020. doi:10.1038/s41592-020-0935-4 — verified (corpus)
R18. Cao J, Zhou W, Steemers F, Trapnell C, Shendure J. Sci-fate characterizes the dynamics of gene expression in single cells. *Nature Biotechnology* 2020. Authors confirmed by web search; DOI and pages not confirmed. — unverified (memory)
R19. Bastidas-Ponce A, Tritschler S, Dony L, Scheibner K, Tarquis-Medina M, Salinno C, Schirge S, Burtscher I, Boettcher A, Theis F, Lickert H, Bakhti M. Comprehensive single cell mRNA profiling reveals a detailed roadmap for pancreatic endocrinogenesis. *Development* 2019. doi:10.1242/dev.173849 — verified (corpus)
R20. Qiu X, Zhang Y, Martin-Rufino JD, Weng C, Hosseinzadeh S, Yang D, Pogson AN, Hein MY, Min KHJ, Wang L, et al. Mapping transcriptomic vector fields of single cells. *Cell* 2022. doi:10.1016/j.cell.2021.12.045 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/scvelo | Volker Bergen, Philipp Weiler (authors); Philipp Weiler (maintainer) | BSD 3-Clause (LICENSE; Copyright (c) 2018, Theis Lab) | steady-state, stochastic and dynamical modes; read at f63c0e7 | port |
| https://github.com/velocyto-team/velocyto.py | Peter Kharchenko, Sten Linnarsson, Gioele La Manno (LICENSE, 2017); Linnarsson Lab (setup.py) | BSD 2-Clause | steady-state gamma baseline; read at 56efe89; the README states the repository is no longer maintained | callout |
| https://github.com/scverse/scvi-tools | Yosef Lab (scvi-tools maintainers) | BSD 3-Clause (LICENSE; Copyright (c) 2026, Yosef Lab, Weizmann Institute of Science) | VeloVI model (scvi.external.VELOVI); read at 5555ecc | port |
| https://github.com/welch-lab/VeloVAE | Yichen Gu (setup.cfg, setup.py) | BSD 3-Clause (setup.cfg); the LICENSE header names Theis Lab, 2018, a conflicting holder | VeloVAE model and CBDir/ICVCoh code; read at 834f9f2 | reimplement: the licence type agrees, but the LICENSE file names a different copyright holder |
| https://github.com/StatBiomed/UniTVelo | Mingze Gao (setup.py, CITATION.cff) | BSD 3-Clause (LICENSE; Copyright (c) 2022, michaelgmz) | comparator; read at c7e9419 | callout |
| https://github.com/bowang-lab/DeepVelo | subercui (pyproject.toml) | MIT (LICENSE; Copyright (c) 2018 Victor Huang) | comparator; read at 4cfd3ba | callout |
