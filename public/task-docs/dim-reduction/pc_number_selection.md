---
id: dim-reduction.pc_number_selection
title: Number of principal components to retain
area: dim-reduction
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [feature-selection.highly_variable_gene_selection, normalization.size_factor_estimation, dim-reduction.normalized_cell_embedding]
feeds: [neighbors.approximate_knn_search, clustering.cell_partitioning, dim-reduction.pc_gene_association_testing]
reads: [obsm/X_pca, uns/pca, layers/counts, layers/log1p_norm, var/highly_variable, varm/PCs]
writes: [uns/pc_selection/summary, uns/pc_selection/<method>/k, uns/pc_selection/<method>/per_pc_stat, uns/pc_selection/<method>/per_pc_flags, uns/pc_selection/<method>/limit, varm/jackstraw_pvalues]
devices: [cpu, cuda]
mcp_tool: singlet_dim_reduction_pc_number_selection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Number of principal components to retain

> Choose how many leading principal components to keep by testing the PCA spectrum of the highly-variable-gene matrix against an explicit null, with the published rules kept as comparators, a technical-variance rule as the provisional default and a count-aware simulated noise edge as the proposed model-based alternative.

## 1. Question

Given the log-normalised cell-by-gene matrix restricted to highly variable genes (HVGs), its principal-component (PC) spectrum and the raw UMI counts, which integer $k$ of leading components carries signal worth keeping for neighbour graphs, clustering and embeddings? The output is $k$ with an optional per-component statistic and retain flag. No shared ground truth defines a correct $k$; section 8 scores rules by recovery of a planted rank (B1), false-positive behaviour when the rank is zero (B2) and downstream recovery of author-provided cell-type labels (B3).

## 2. Why this task matters and where the field stands

Almost every single-cell workflow reduces expression to PCs before building a neighbour graph, clustering or embedding [R9]. The number kept fixes the dimension in which neighbourhoods are measured. Too few components discard cell-state structure; too many let technical noise, dropout and depth effects define neighbourhoods; every downstream graph, clustering and embedding inherits the integer.

The status is **contested**.

- **No ground truth for biological dimensionality.** Every rule is judged against a proxy, and the proxies disagree (section 1).
- **Rules disagree on the same data.** In the OSCA workflow denoisePCA usually keeps more PCs than an elbow point; with a mean-variance trend fitted to total variance, secondary factors of variation inflate the trend and denoisePCA returns its lower limit of 5 PCs on the PBMC example [R9]. The findPC package offers six curvature rules and defaults to the perpendicular line on 30 scanned standard deviations [R1]. Scanpy and Seurat use fixed counts (section 4).
- **Is the noise i.i.d.?** Count noise depends on gene abundance and depth, so random-matrix edges that assume i.i.d. entries are not expected to be calibrated for log-normalised counts (a design argument, not a cited finding).
- **Is a permutation null valid?** Permuting genes keeps marginal distributions but destroys the correlation that defines expression programmes; whether the resulting null is too wide or too narrow on real data is open.
- **Sensitivity to the scanned range.** The chord endpoints of the perpendicular-line rule depend on the number $N$ of standard deviations scanned, so its answer depends on $N$ by construction [R1].
- **Cost of simulation nulls.** JackStraw recomputes the PCA $M$ times and Horn's analysis $B$ times, which is expensive at atlas scale.

## 3. Theory and insight

### 3.1 Notation

| Symbol | Meaning |
|---|---|
| $n$, $p$ | cells and HVGs in the matrix $X$ (column-centred, unscaled log-normalised values) |
| $K$ | `max_pcs`, the number of components considered |
| $\lambda_k$ | $s_k^2/(n-1)$ for the $k$-th singular value $s_k$ of $X$ |
| $V$ | total variance $\sum_{k=1}^{p}\lambda_k$ |
| $\sigma^2$ | per-entry noise variance of $X$ |
| $r$ | number of signal components (planted in simulations) |
| $k_{\text{raw}}$, $\hat k$ | unclamped rule output and emitted value $\min(\max(k_{\text{raw}},\texttt{min\_pcs}),K)$ |

### 3.2 Model and rules

The signal-plus-noise model is $X=L+E$ with $\operatorname{rank}(L)=r$, $\mathbb{E}E_{ij}=0$ and $\operatorname{Var}(E_{ij})=\sigma^2$. The spectrum splits into a noise bulk and $r$ spikes. Every rule estimates $r$ by comparing the observed spectrum with a null; the rules differ in how the null is built.

**Analytic i.i.d. nulls.** The Marchenko-Pastur upper edge [R4] and the Gavish-Donoho threshold [R3] assume i.i.d. noise of variance $\sigma^2$:

$$\lambda_{+}=\sigma^2\Bigl(1+\sqrt{\tfrac{p}{n-1}}\Bigr)^2,\qquad \lambda^\star=\omega(\beta)^2\sigma^2\frac{n_{\max}}{n-1},\qquad \omega(\beta)=\sqrt{2(\beta+1)+\tfrac{8\beta}{\beta+1+\sqrt{\beta^{2}+14\beta+1}}},$$

with $n_{\max}=\max(n,p)$, $\beta=\min(n,p)/n_{\max}$ and $\omega(1)=4/\sqrt3$. A component is signal if $\lambda_k>\lambda_+$ (respectively $\lambda^\star$). When $\sigma^2$ is unknown, the probabilistic-PCA maximum-likelihood noise [R5] is the mean of the discarded eigenvalues, $\hat\sigma^2(q)=(V-\sum_{j\le q}\lambda_j)/(p-q)$, used with $q=K$.

**Technical-variance null (denoisePCA).** Let $R_d=\sum_{k=d+1}^{K}\lambda_k+(V-\sum_{k\le K}\lambda_k)$ be the discarded variance plus the unexplained residual after keeping $d$ components. The rule keeps the fewest components whose $R_d$ does not exceed the technical total $T=\sum_g\mathrm{tech}_g$ [R9, R10]:

$$k_{\text{raw}}=\min\bigl(\{d\in\{1,\dots,K\}:R_d\le T\}\cup\{K\}\bigr).$$

Genes whose total variance does not exceed their technical variance are dropped before $V$ and $T$ are computed.

**Curvature (findPC).** For the first $N$ standard deviations $s_1\ge\dots\ge s_N$, the perpendicular-line rule selects the interior point farthest from the chord joining the first and last points [R1] (the denominator of the distance is constant in $i$ and dropped):

$$k_{\text{raw}}=\arg\max_{1<i<N}\ \bigl|(N-1)(s_i-s_1)-(i-1)(s_N-s_1)\bigr| .$$

**Permutation nulls.** Horn's parallel analysis [R7] permutes each gene independently across cells $B$ times; $\tau$ is the exceedance fraction:

$$\pi_k=\frac1B\sum_{b=1}^{B}\mathbf 1\{\lambda^{(b)}_k\ge\lambda_k\},\qquad k_{\text{raw}}=\min\{k:\pi_k>\tau\}-1\quad(k_{\text{raw}}=K\text{ if no }k\text{ qualifies}).$$

Seurat's JackStraw, inspired by [R2], permutes a fraction of features in the scaled data, recomputes the PCA and pools the loadings of the permuted features $S_m$ over $M$ replicates. The empirical p-value of feature $g$ on component $k$ is

$$p_{g,k}=\frac{1}{\sum_m|S_m|}\sum_{m=1}^{M}\sum_{g'\in S_m}\mathbf 1\{|\ell^{(m)}_{g',k}|>|\ell_{g,k}|\},$$

and component $k$ is scored by a two-proportion test of the number of features with $p_{g,k}\le\alpha_g$ against the expected $\lfloor p\alpha_g\rfloor$, with gene-level threshold $\alpha_g$.

**Count-aware simulated edge (proposed).** Model each HVG as $Y_{ig}\sim\mathrm{NB}(\mu_{ig},\phi_g)$ with $\mu_{ig}=s_i\rho_g$ and $\operatorname{Var}(Y_{ig})=\mu_{ig}+\phi_g\mu_{ig}^2$, with library-size factor $s_i$ and base rate $\rho_g$. Simulate $B$ null matrices with the observed $s_i$, transform and centre them as the observed matrix, and take the leading eigenvalue $\lambda^{(b)}_1$ of each:

$$p_k=\frac{1+\#\{b:\lambda^{(b)}_1\ge\lambda_k\}}{B+1},\qquad k_{\text{raw}}=\#\{k:p_k\le\alpha\},$$

with nominal level $\alpha$. Because $\lambda_k$ decreases, $p_k$ increases and the retained set is contiguous. The limit $\lambda_\alpha$ is the matching quantile of the null leading eigenvalues, a finite-size, count-aware analogue of the Marchenko-Pastur edge.

**Outputs.** $k_{\text{raw}}$ is the number of components a rule declares signal; limits and statistics are on the variance scale $\lambda_k$ of the centred, unscaled matrix (section 6). Ground truth is the planted $r$ in B1 and the adjusted Rand index against author labels in B3.

### 3.3 Regimes of validity and failure modes

- **Marchenko-Pastur and Gavish-Donoho.** Asymptotic ($p/(n-1)\to\gamma$, respectively $\beta$ fixed) with i.i.d. noise of known variance; Gavish-Donoho is optimal for squared-error loss in that model, not for counts. Log-normalised counts are neither i.i.d. nor homoscedastic, which widens the bulk beyond the edge (a design argument).
- **Probabilistic-PCA noise.** Exact for the isotropic Gaussian model [R5]; signal beyond $q$ biases $\hat\sigma^2$ upward, and removing the top $q$ bulk eigenvalues biases it downward by their share of the trace.
- **denoisePCA.** Correct only if $\mathrm{tech}_g$ models technical variance alone; a trend fitted to total variance inflates $T$ and returns the floor. The output is a lower bound on the components needed to keep all biological variation [R9].
- **findPC.** Valid for one convex knee in the first $N$ values; it returns an interior index for any spectrum, so it has no null. A common positive scale of $s$ leaves it unchanged; switching from standard deviations to variances does not.
- **Horn and JackStraw.** The null keeps marginals and destroys correlation: biology in marginal dispersion widens it, biology in correlation counts as signal. The pooled JackStraw null assumes one loading distribution across features; with the defaults and $p=2000$ the pool holds 2000 values, so a threshold of $10^{-5}$ admits only features whose $|\ell|$ exceeds every pooled value.
- **Count-aware edge.** Valid when independent negative-binomial draws given the library size describe technical variation; a dispersion fitted to data containing biology absorbs it and widens the null (conservative). Comparing $\lambda_k$ with the leading null eigenvalue is an exact test of $k=1$ under a correctly specified null. Comparing it with the $k$-th null eigenvalue is calibrated only at $r=0$: in a Gaussian Monte Carlo check ($n=1000$, $p=200$, three spikes with excess variance 1.8 to 2.7, $B=60$, 80 replicates, $\alpha=0.05$) it rejected components 4 to 8 in 94 to 99 percent of replicates, and the leading-eigenvalue comparison rejected none.

### 3.4 Why heuristics work, and what a model adds

Curvature and fixed-count rules need no noise model and cost nothing once the spectrum exists, which made them tutorial defaults. They fail silently: the integer changes with $N$, the HVG set and the normalisation, and carries no error rate. A model-based null attaches a probability to each component, reuses the fitted count model of technical variance (per-gene dispersions as in `normalization.dispersion_estimation`), and can absorb covariates, for example by simulating within each batch so that batch structure is not read as signal.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Fixed component count | heuristic | PCA computes a fixed number of components (50) and graph construction uses a fixed prefix (10 in Seurat's FindNeighbors) | — |
| findPC (six rules) | heuristic | rules on the first $N$ standard deviations: piecewise linear model, first derivative, second derivative, preceding residual, perpendicular line (default) and two-cluster k-means (size of the smaller cluster plus one) | [R1] |
| JackStraw | model-based | permute a fraction of features in the scaled data, recompute the PCA, pool the permuted features' loadings as the null and score each PC by a proportion test | [R2] |
| denoisePCA | hybrid | keep the fewest PCs whose discarded variance plus residual does not exceed the summed technical variance | [R9], [R10] |
| Gavish-Donoho threshold | model-based | MSE-optimal hard threshold for rank-$r$ signal plus i.i.d. noise of known variance | [R3] |
| Marchenko-Pastur edge | model-based | count components whose variance exceeds the upper edge of the Marchenko-Pastur law for i.i.d. noise | [R4] |
| Horn parallel analysis | model-based | keep components whose variance is rarely matched by matrices with each gene permuted across cells | [R7] |
| Probabilistic-PCA noise and Minka's evidence | model-based | noise variance as the mean of discarded eigenvalues; scikit-learn's `n_components='mle'` maximises Minka's likelihood over the rank | [R5], [R6] |
| getClusteredPCs | heuristic | cluster the first $d$ PCs for each $d$; among $d$ giving at most $d+1$ clusters keep the $d$ with the most clusters (deprecated in scran) | [R9] |
| Count-aware simulated edge (proposed) | model-based | negative-binomial parametric bootstrap of the leading null eigenvalue; keep components above its $1-\alpha$ quantile | — |

The published standards are the fixed default with visual inspection in tutorials, denoisePCA in the OSCA workflow and the perpendicular-line rule in findPC [R1, R9]. No benchmark compares them on shared ground truth (section 10).

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| findPC | `number` ($N$); `method` | 30; `perpendicular line` | R/findPC.R:35 @ 0e85c94 |
| findPC | distance rule | distances for interior points 2 to $N-1$; `which.max` index returned unchanged | R/findPC.R:161-166 @ 0e85c94 |
| scran denoisePCA | `min.rank`; `max.rank` | 5; 50 | R/denoisePCA.R:157 @ 569d2f8 |
| scran denoisePCA | gene filter; clamp; fallback | `all.var > tech.var`; `max(npcs, min(min.rank, length(var.exp)))`; 1 if no tail exceeds $T$ | R/denoisePCA.R:193, 208, 270 @ 569d2f8 |
| scran denoisePCA | deprecation | the PCA routine is deprecated in favour of `scrapper::runPca.se` plus `denoisePCANumber` | R/denoisePCA.R:160 @ 569d2f8 |
| scran modelGeneVarByPoisson | `npts`; `dispersion`; `pseudo.count` | 1000; 0; 1 | R/modelGeneVarByPoisson.R:111 @ 569d2f8 |
| PCAtools parallelPCA | `max.rank`; `niters`; `threshold` | 100; 50; 0.1 | R/parallelPCA.R:58 @ 6da9b68 |
| PCAtools parallelPCA | permutation; no-exceedance result | each column of `t(mat)` (a gene) shuffled across cells; $K$ | R/parallelPCA.R:62, 78-79; src/shuffle_matrix.cpp:34, 71 @ 6da9b68 |
| PCAtools chooseGavishDonoho | $\omega(\beta)$; limit; floor | formula of section 3; `lambda^2 * noise * n/(.dim[2]-1)`; `max(1L, count)` | R/randomMethods.R:95, 99, 102 @ 6da9b68 |
| PCAtools chooseMarchenkoPastur | limit; floor | `RMTstat::qmp(1, ndf=.dim[2]-1, pdim=.dim[1], var=noise)`; `max(1L, count)` | R/randomMethods.R:48, 51 @ 6da9b68 |
| Seurat JackStraw | `dims`; `num.replicate`; `prop.freq`; `maxit` | 20; 100; 0.01; 1000 | R/dimensional_reduction.R:53-57 @ 5f67c70 |
| Seurat JackStraw | input layer; permuted features per replicate | `scale.data`; `max(3, size = nrow * prop.use)` | R/dimensional_reduction.R:95, 2518-2524 @ 5f67c70 |
| Seurat JackStraw | empirical p-value | pooled, strict inequality | R/dimensional_reduction.R:2243-2244 @ 5f67c70 |
| Seurat ScoreJackStraw | `dims`; `score.thresh`; test | 1:5; 1e-5; `prop.test` of observed count vs `floor(nrow * score.thresh)`, score 1 if count is 0 | R/dimensional_reduction.R:2092-2093, 2103-2112 @ 5f67c70 |
| Seurat RunPCA; FindNeighbors | `npcs`; `dims` | 50; 1:10 | R/dimensional_reduction.R:951; R/clustering.R:792 @ 5f67c70 |
| Scanpy | `N_PCS`; default `n_comps` | 50; `min_dim - 1` if `min_dim <= N_PCS` else `N_PCS` | src/scanpy/_settings/__init__.py:83; src/scanpy/preprocessing/_pca/__init__.py:233-235 @ 8ed52d9 |
| scikit-learn PCA | `noise_variance_`; `'mle'` | mean of eigenvalues beyond `n_components` (full solver), `(total_var - sum)/(min(n,p) - n_components)` (randomized); `'mle'` needs `n_samples >= n_features` | sklearn/decomposition/_pca.py:639, 751-752, 537 @ 85593ca |

## 5. Proposed singlet approach

**Routes** (licences in section 12). `denoise_tech`, `gavish_donoho`, `marchenko_pastur`, `horn`: reimplement from section 3. `findpc` (perpendicular line only): port. `jackstraw`: reimplement on centred, unscaled values, which differ from Seurat's `scale.data`. The probabilistic-PCA noise estimate is a one-line reimplementation. Minka's evidence, getClusteredPCs and the Scanpy and Seurat constants are callout comparators outside the enum. `fixed` returns `max_pcs`. `count_null` is a new design.

**Technical variance for `denoise_tech`.** $\mathrm{tech}_g$ is the value, at the gene's mean, of a smooth trend of the log-normalised variance of simulated Poisson counts, the construction of scran's modelGeneVarByPoisson (deprecated there) with the observed size factors; the smoother is a design choice fixed on the tuning seeds of B1.

**Model-based formulation (`count_null`).** Fit each HVG as negative binomial with mean $s_i\rho_g$ and a method-of-moments dispersion $\phi_g$ (floored at zero) from size-factor-normalised counts. Simulate $B$ matrices with the same $s_i$ and gene set, recompute the log transform from raw counts for observed and simulated data alike, centre, and take only the leading eigenvalue of each by Lanczos iteration. The gene set stays fixed at the observed selection. The claims are falsified by the acceptance criteria of B1 to B3; if B2 fails, the default stays `denoise_tech`.

**Machine learning.** No network is trained and PyTorch is not used. The moment fit and the negative-binomial sampler are small closed-form kernels hard-coded in CUDA; spectrum rules are scalar closed forms in the C++ core.

**Kernels, devices and scale.** Gram-matrix accumulation (BLAS or cuBLAS), symmetric eigendecomposition (LAPACK or cuSOLVER) and sparse-dense products for Lanczos (cuSPARSE). One streaming pass over cell blocks accumulates the exact $p\times p$ Gram matrix and $V$ in $O(p^2)$ memory and $O(np^2)$ operations, about $4\times10^{12}$ multiply-adds for $n=10^6$, $p=2000$. Horn and `count_null` need a pass per replicate and are not streamed, so `streaming` is false. `device=auto` selects CUDA only when the buffers fit.

**Defaults an agent should use without asking.** `method=denoise_tech`, `max_pcs=50`, `min_pcs=5`, `device=auto`, `seed=42`. Run `dry_run` first for `jackstraw` or `count_null` above about $10^5$ cells. Do not change the method to obtain a preferred integer; report `k_raw`, the emitted `k`, the method and one second method.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `obsm/X_pca` | float32, cells by components | PCA scores; read only to check the stored component count against `max_pcs` |
| read | `uns/pca` | float64 vector | variances or singular values of the PCA of the HVG matrix; the spectrum source when present |
| read | `layers/counts` | sparse int | raw UMI counts; required by `denoise_tech` and `count_null` |
| read | `layers/log1p_norm` | sparse float32 | log-normalised values the PCA was computed on; used when the spectrum is recomputed |
| read | `var/highly_variable` | bool | HVG mask defining the matrix; $p$ is its number of true values |
| read | `varm/PCs` | float32, genes by components | gene loadings; required by `jackstraw` |
| write | `uns/pc_selection/summary` | dict | method, parameters, `k`, `k_raw`, `min_pcs`, `max_pcs`, `n_cells`, `n_genes`, `spectrum_source`, `noise_var_used`, `clamped` and `warnings` |
| write | `uns/pc_selection/<method>/k` | int | emitted number of components $\hat k$ |
| write | `uns/pc_selection/<method>/per_pc_stat` | float32 vector | method statistic per component (table below) |
| write | `uns/pc_selection/<method>/per_pc_flags` | bool vector | `True` for index $k\le k_{\text{raw}}$ before clamping |
| write | `uns/pc_selection/<method>/limit` | float | variance-scale limit; written by `gavish_donoho` ($\lambda^\star$), `marchenko_pastur` ($\lambda_+$) and `count_null` ($\lambda_\alpha$) |
| write | `varm/jackstraw_pvalues` | float32, genes by components | empirical loading p-values; written by `jackstraw` only |

| Method | `k_raw` | `per_pc_stat` | Extra summary keys |
|---|---|---|---|
| `denoise_tech` | $\min(\{d\ge1:R_d\le T\}\cup\{K\})$ | $R_k$, $k=1..K$ | `technical_total_T`, `total_variance_V` |
| `findpc` | $\arg\max$ of the section 3 distance | distance for $i=1..N$ | `elbow_statistic` |
| `gavish_donoho` | $\#\{k:\lambda_k>\lambda^\star\}$ | $\lambda_k/\lambda^\star$ | `beta`, `omega`, `noise_source` |
| `marchenko_pastur` | $\#\{k:\lambda_k>\lambda_+\}$ | $\lambda_k/\lambda_+$ | `noise_source` |
| `horn` | $\min\{k:\pi_k>\tau\}-1$ | $\pi_k$ | `pi_at_k` |
| `jackstraw` | leading run with score p-value below `jackstraw.pc_alpha` | score p-value per tested PC | `significant_features_per_pc` |
| `count_null` | $\#\{k:p_k\le\alpha\}$ | $p_k$ | `limit` |
| `fixed` | `max_pcs` | empty | none |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "denoise_tech" | `denoise_tech`, `findpc`, `gavish_donoho`, `marchenko_pastur`, `horn`, `jackstraw`, `count_null`, `fixed` | Rule that chooses k. denoise_tech is the provisional default; fixed returns max_pcs. |
| `max_pcs` | integer | 50 | min 2; max 200 | K: components considered and ceiling on k. findpc scans this many standard deviations. Recomputes the spectrum if uns/pca holds fewer values. |
| `min_pcs` | integer | 5 | min 1 | Floor on the emitted k; must not exceed max_pcs. k_raw is reported unclamped. |
| `noise_var` | any | "estimate" | — | Noise variance for gavish_donoho and marchenko_pastur, in variance units of the centred log values; 'estimate' uses the discarded-eigenvalue mean. |
| `horn` | object | — | — | Options for method=horn. |
| `horn.niters` | integer | 50 | min 1; max 1000 | B: number of gene-wise permutations. |
| `horn.threshold` | number | 0.1 | max 1; > 0 | tau: a component is kept while the fraction of permuted eigenvalues at least as large is at most tau. |
| `jackstraw` | object | — | — | Options for method=jackstraw; requires varm/PCs. |
| `jackstraw.dims` | integer | 20 | min 1 | Number of components tested. |
| `jackstraw.replicates` | integer | 100 | min 1; max 10000 | M: number of permutation replicates. |
| `jackstraw.prop_freq` | number | 0.01 | max 1; > 0 | Fraction of features permuted in each replicate. |
| `jackstraw.score_thresh` | number | 1e-05 | max 1; > 0 | Gene-level empirical p-value threshold for counting significant features per component. |
| `jackstraw.pc_alpha` | number | 0.05 | max 1; > 0 | Level of the component-level proportion test (a design choice). |
| `count_null` | object | — | — | Options for method=count_null; requires layers/counts. |
| `count_null.replicates` | integer | 99 | min 1; max 1000 | B: simulated null matrices; alpha*(B+1) integer gives an exact test level. |
| `count_null.model` | string | "negative_binomial" | `negative_binomial`, `poisson` | Count model of the null; poisson sets the dispersion to zero. |
| `count_null.alpha` | number | 0.05 | max 1; > 0 | Nominal level of the per-component test against the leading null eigenvalue. |
| `seed` | integer | 42 | min 0 | Random seed for horn, jackstraw, count_null and randomised decompositions; other methods are deterministic. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing members under uns/pc_selection/<method>/ instead of failing. |
<!-- PARAMS:AUTO:END -->

Method-specific options sit in nested objects named after the method and are ignored by other methods. The spectrum is read from `uns/pca`; if it holds fewer than `max_pcs` values it is recomputed from `layers/log1p_norm` restricted to `var/highly_variable`. Size factors are library sizes from `layers/counts` divided by their mean. `findpc` scans $N=$ `max_pcs` values (use `max_pcs=30` for the findPC default). `noise_var` is $\sigma^2$ in variance units of the centred log values; `"estimate"` uses $\hat\sigma^2(K)$. Clamping to `min_pcs` and `max_pcs` is recorded in the summary. An existing `uns/pc_selection/<method>/k` makes the call fail unless `overwrite` is true.

## 7. MCP tool

Tool name `singlet_dim_reduction_pc_number_selection` (definition in `tasks/mcp/singlet_dim_reduction_pc_number_selection.json`). Illustrative call and result (values are not measurements):

```json
{"dataset": "study_042.singlet", "method": "denoise_tech", "max_pcs": 50, "min_pcs": 5}
```

```json
{
  "dataset": "study_042.singlet",
  "status": "completed",
  "wrote": ["uns/pc_selection/denoise_tech/k", "uns/pc_selection/denoise_tech/per_pc_stat",
            "uns/pc_selection/denoise_tech/per_pc_flags", "uns/pc_selection/summary"],
  "summary": {"method": "denoise_tech", "k": 14, "k_raw": 14, "n_cells": 48213, "n_genes": 2000,
              "spectrum_source": "uns/pca", "warnings": []},
  "provenance_id": "prov_example"
}
```

- **Long-running**: `jackstraw` and `count_null` are slow and Horn is slow at large $n$; a dry-run estimate above 300 seconds (a design choice) returns `status` `queued` with a `job_id`; spectrum-only methods complete inline.
- **Stochastic**: `horn`, `jackstraw`, `count_null` and any randomised decomposition use `seed`; other methods are deterministic given the spectrum.
- **Dry run**: the `estimate` object reports `seconds`, `peak_memory_gb` and `device`, scaling with the replicate count for simulation nulls.

## 8. Benchmarks

**Shared protocol.** B1 and B2 use two simulation generators defined in B1: G1 (negative-binomial counts) and G2 (i.i.d. Gaussian). All grid values, replicate counts and tolerances are proposals of this document, not literature values. Every rule runs with the section 6 defaults on the same matrix and seed; primary metrics use the unclamped $k_{\text{raw}}$, and the emitted $\hat k$ (floor 5, ceiling 50) is reported as secondary. Seeds 0 to 49 give reported results; seeds 1000 to 1049 are reserved for tuning (`count_null` settings, the denoise_tech smoother). Methods that need counts (`denoise_tech`, `count_null`) run on G1 only. CPU model, GPU model, BLAS and thread count are recorded.

### B1. Planted-rank recovery

- **Goal**: test whether each rule recovers the planted rank $r$ under count noise (G1) and in the analytic case (G2).
- **Ground truth**: planted simulation; $r$ is the number of latent factors planted in the log-mean (G1) or mean (G2). SNR is $\theta/\theta_c$ in G1, where $\theta_c$ is the smallest strength at which the first planted component exceeds the 95th percentile of the null first eigenvalue in a pilot, and $\theta^2/\sqrt{p/n}$ in G2, where SNR 1 is the spiked-covariance transition proved for complex Gaussian data [R8] and assumed equal for real data.
- **Generator G1**: (1) draw base rates $\rho_g$, dispersions $\phi_g$ and library sizes $L_i$ log-normally (design values: median $L=5000$, median $\phi=0.2$, log-sd 1.5 for $\rho_g$ and 0.5 otherwise) and set $s_i=L_i/\bar L$; (2) draw $U\in\mathbb{R}^{p\times r}$ with orthonormal columns supported on half the genes; (3) draw $z_i\sim N(0,I_r)$ and set $\eta_{ig}=\log(s_i\rho_g)+\sum_k\theta z_{ik}U_{gk}$; (4) draw $Y_{ig}\sim\mathrm{NB}(e^{\eta_{ig}},\phi_g)$. **G2**: $X_{ig}=\sum_k\theta z_{ik}u_{gk}+\varepsilon_{ig}$ with orthonormal $u_k$ and $\varepsilon_{ig}\sim N(0,1)$.

| Dataset | Source | Modality, size | License | Notes |
|---|---|---|---|---|
| G1 | generator above | simulated counts; $n\in\{5000,20000\}$, $p\in\{1000,2000\}$, $r\in\{2,5,10\}$, SNR $\in\{1.0,1.5,2.0\}$, 50 replicates per cell | — | primary; $p$ is the matrix width |
| G2 | generator above | simulated values; same grid | — | reported separately |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Exact recovery rate | fraction of replicates per cell with $k_{\text{raw}}=r$ | higher | primary | — |
| Absolute error | median of $\lvert k_{\text{raw}}-r\rvert$; median and IQR of $k_{\text{raw}}-r$ | lower | primary | — |

- **Comparators**: `gavish_donoho` (oracle noise on G2 only, otherwise estimated); `marchenko_pastur`; `denoise_tech`; `findpc` (`max_pcs=30`); `jackstraw` (10 of 50 replicates, for cost); `horn`; `count_null`; `fixed` (`max_pcs=50`). The spectrum is that of the centred matrix over all $p$ genes.
- **Acceptance criterion** (proposed): a rule is eligible as default only if exact recovery is at least 0.90 in every G1 cell with SNR at least 1.5; `count_null` becomes the default only if it also exceeds `denoise_tech` on G1 with non-overlapping 95 percent Wilson intervals and passes B2.
- **Known pitfalls**: G2 favours the analytic rules by construction, so G1 is primary.

### B2. Null behaviour at rank zero

- **Goal**: measure how often each rule declares signal when none exists, and check that `count_null` is calibrated.
- **Ground truth**: planted simulation with $r=0$; no latent factor is planted, so any retained component reflects technical structure (depth, sparsity) or chance.
- **Datasets**: G1 and G2 with $r=0$ on the B1 grid of $n$ and $p$, $R=1000$ replicates per cell.

| Dataset | Source | Modality, size | License | Notes |
|---|---|---|---|---|
| G1, $r=0$ | B1 generator | simulated counts; four $(n,p)$ cells, 1000 replicates each | — | primary calibration data |
| G2, $r=0$ | B1 generator | simulated values; same grid | — | negative-binomial null misspecified here |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| False-positive rate | $P(k_{\text{raw}}\ge1)$ | close to nominal level | primary | — |
| Per-component rejection | $P(p_k\le\alpha)$ for $k=1..5$ (Horn: $P(\pi_k\le\tau)$; other rules: $P(k_{\text{raw}}\ge k)$) | at most nominal | primary | — |
| Mean null fraction | mean of $k_{\text{raw}}/K$ with $K=50$ | lower | guardrail | — |

- **Comparators**: `marchenko_pastur` and `gavish_donoho` (estimated noise), `horn`, `jackstraw` (100 replicates, for cost), `denoise_tech`, `count_null`. `findpc` returns an interior index for any spectrum and `fixed` returns `max_pcs`, so neither has a null.
- **Acceptance criterion** (proposed): with $\mathrm{SE}=\sqrt{\alpha(1-\alpha)/R}$ ($2\,\mathrm{SE}\approx0.014$ at $\alpha=0.05$), `count_null` has $P(k_{\text{raw}}\ge1)$ within $\alpha\pm2\,\mathrm{SE}$ and $P(p_k\le\alpha)\le\alpha+2\,\mathrm{SE}$ for $k=2..5$ in every G1 cell; any rule proposed as default has mean null fraction at most 0.05 in every G1 cell. G2 is reported without pass or fail.
- **Known pitfalls**: per-component rates are marginal and give no family-wise guarantee beyond $k=1$; calibration on simulated data does not establish calibration on real data, where the fitted null inherits any departure from the model.

### B3. Downstream label recovery against author annotations (proposed)

- **Goal**: measure how well clustering on the first $\hat k$ components recovers author annotations, and each rule's regret against the best $k$ on a grid.
- **Ground truth**: expert labels. The author cell-type column of each study is used only for scoring, never to fit $k$ or a null; scores are the adjusted Rand index (ARI, 1 for identical partitions, about 0 for random ones).

| Dataset | Source | Modality, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue, author-annotated subset | internal catalogue of 354 million uniformly processed cells, about 40 percent annotated; study id in `obs` | multi-study single-cell RNA-seq; study count and sizes — | inherited from each study | eligible: at least 5,000 cells and 5 labels (design choice); studies split into calibration and held-out halves by a fixed seed |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI at fixed resolution | ARI between Leiden clusters of the kNN graph on the first $\hat k$ components and author labels, one resolution fixed in advance | higher | primary | — |
| Regret | $\max_{k\in\{5,10,\dots,50\}}\mathrm{ARI}(k)-\mathrm{ARI}(\hat k)$, averaged over held-out studies; ties to the smallest $k$ | lower, at least 0 | primary | — |
| Label transfer accuracy | kNN classifier accuracy on the first $\hat k$ components, five-fold stratified cross-validation within each study | higher | guardrail | — |

- **Comparators**: `fixed` at 10 and 50, `gavish_donoho` (estimated noise), `denoise_tech`, `findpc` (`max_pcs=30`), `jackstraw` on a subset of studies if cost requires, `count_null`.
- **Protocol**: each rule picks $\hat k$ within each study alone; three seeds; tuned constants are chosen on the calibration half and scored on the held-out half.
- **Acceptance criterion** (proposed): the recommended rule has mean regret at most 0.02 ARI on held-out studies and beats `fixed` at 50 on at least 60 percent of them; `count_null` must also have lower regret than `denoise_tech`.
- **Known pitfalls**: author labels often derive from clusters on components chosen by similar rules (circularity); coarse and fine labels have different best $k$.

### P1. Performance and scaling

Wall time and peak memory to produce $\hat k$ at $10^4$, $10^5$ and $10^6$ cells (sparse input at $10^6$), 2000 HVGs, $K=50$, CPU and CUDA, with the spectrum computation reported apart from the rule.

- **Dataset**: G1 at the three scales with $r=0$ and $r=5$.
- **Metrics**: median wall-clock time of five executions, peak resident memory, and spectrum throughput in cells per second.
- **Comparators**: spectrum-only rules, `denoise_tech`, `horn` ($B=50$, maximum rank 100), `jackstraw` ($M=100$, 20 dims), `count_null` ($B=99$).
- **Hold fixed**: HVG count, $K$, decomposition solver, thread count, BLAS, seed and storage format.
- **Acceptance criterion** (proposed): spectrum-only rules finish in under one second once the spectrum exists; JackStraw time is reported as a multiple of `denoise_tech` and `count_null` time as a multiple of `horn` at comparable replicate counts.
- **Known pitfalls**: spectrum-only times are not comparable with full-pipeline times, and JackStraw time depends strongly on `jackstraw.replicates`.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
- **Feeds**:
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `dim-reduction.pc_gene_association_testing`: Testing which genes drive each principal component
- **Reads**: `obsm/X_pca`, `uns/pca`, `layers/counts`, `layers/log1p_norm`, `var/highly_variable`, `varm/PCs`
- **Writes**: `uns/pc_selection/summary`, `uns/pc_selection/<method>/k`, `uns/pc_selection/<method>/per_pc_stat`, `uns/pc_selection/<method>/per_pc_flags`, `uns/pc_selection/<method>/limit`, `varm/jackstraw_pvalues`
<!-- CHAINING:AUTO:END -->

The task follows feature selection and PCA and precedes the neighbour graph, clustering and embedding in the standard preprocessing sequence [R9]; the raw counts layer must be kept for count-based methods.

## 10. Risks, pitfalls and open questions

- **No elbow-agreement benchmark.** The findPC paper's comparison with manual elbow calls (datasets, number of annotators, per-rule results) has not been read, so no such benchmark is defined. The port is checked instead by exact equality of the returned index with the R package on `sdev` from `prcomp(t(procdata), scale. = T)$sdev[1:50]`, the package vignette example.
- **No shared benchmark of rules.** No published benchmark compares the candidate rules on shared planted structure. The OpenProblems dimensionality-reduction task defines clustering_performance, coranking, density_preservation, distance_correlation, spectral_distance_correlation and trustworthiness; none scores a component count.
- **Methods left out.** Minka's evidence and getClusteredPCs are comparators outside the enum. The Gavish-Donoho variant for unknown noise (about 2.858 times the median singular value) is not implemented. PCQC (a bioRxiv preprint listed in the scRNA-tools database) is omitted because neither its paper nor its code was read.
- **Unvalidated estimators.** The method-of-moments dispersion for library-size-dependent means has not been compared with maximum likelihood; the denoise_tech smoother is a design choice; the sensitivity of $\hat\sigma^2(q)$ to $q=K$ is open (B1, B2); behaviour of `count_null` under count models other than the negative binomial (for example zero inflation) is untested, and G2 cannot test it because it has no counts.
- **JackStraw at defaults.** With the pooled-null size in section 3 it is untested whether Seurat's defaults give informative scores on real matrices.
- **First experiment.** Run the B2 calibration of `count_null` (G1, $r=0$) before any real-data comparison; if $P(k_{\text{raw}}\ge1)$ leaves $\alpha\pm2\,\mathrm{SE}$, the model-based claim is withdrawn and the default stays `denoise_tech`. A component passing a null test is not thereby biological, so $k$ is read together with B3.

## 11. References

R1. Zhuang H, Ji Z. findPC: An R package to automatically select the number of principal components in single-cell analysis. *Bioinformatics* 2022;38(10):2949–2951. doi:10.1093/bioinformatics/btac235 — verified (corpus)
R2. Chung NC, Storey JD. Statistical significance of variables driving systematic variation in high-dimensional data. *Bioinformatics* 2014. doi:10.1093/bioinformatics/btu674 — partial (corpus)
R3. Gavish M, Donoho DL. The optimal hard threshold for singular values is 4/√3. *IEEE Transactions on Information Theory* 2014;60(8):5040–5053. doi:10.1109/TIT.2014.2323359 — verified (search)
R4. Marchenko VA, Pastur LA. Distribution of eigenvalues for some sets of random matrices. *Matematicheskii Sbornik* 1967;72(114):507–536; English translation *Mathematics of the USSR-Sbornik* 1967;1(4):457–483. doi:10.1070/SM1967v001n04ABEH001994 — verified (search)
R5. Tipping ME, Bishop CM. Probabilistic principal component analysis. *Journal of the Royal Statistical Society: Series B* 1999;61(3):611–622. — verified (repo)
R6. Minka TP. Automatic choice of dimensionality for PCA. *Advances in Neural Information Processing Systems* (NIPS 2000), pp. 598–604. — verified (repo)
R7. Horn JL. A rationale and test for the number of factors in factor analysis. *Psychometrika* 1965;30(2):179–185. — verified (repo)
R8. Baik J, Ben Arous G, Péché S. Phase transition of the largest eigenvalue for nonnull complex sample covariance matrices. *Annals of Probability* 2005;33(5):1643–1697. doi:10.1214/009117905000000233 — verified (search)
R9. Amezquita RA, Lun ATL, Becht E, et al. Orchestrating single-cell analysis with Bioconductor. *Nature Methods* 2020. doi:10.1038/s41592-019-0654-x — verified (corpus)
R10. Lun ATL. Discussion of PC selection methods for scRNA-seq data. 2018. https://github.com/LTLA/PCSelection2018 (cited in the scran denoisePCA documentation) — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/haotian-zhuang/findPC | Haotian Zhuang (aut, cre); Zhicheng Ji (aut) | MIT (LICENSE.md; DESCRIPTION "MIT + file LICENSE") | six curvature rules; default $N=30$; example data | port the perpendicular line; other rules not exposed |
| https://github.com/kevinblighe/PCAtools | Kevin Blighe (aut); Jared Andrews (aut, cre); Anna-Leigh Brown, Vincent Carey, Guido Hooiveld (ctb); Aaron Lun (aut, ctb) | GPL-3 (DESCRIPTION) | Gavish-Donoho, Marchenko-Pastur and Horn rules | reimplement; callout comparator |
| https://github.com/MarioniLab/scran | Aaron Lun (aut, cre); Karsten Bach (aut); Jong Kyoung Kim, Antonio Scialdone (ctb) | GPL-3 (DESCRIPTION) | denoisePCA number rule, Poisson technical trend, getClusteredPCs | reimplement; callout comparator |
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and contributors listed in DESCRIPTION; Satija Lab and Collaborators (fnd) | MIT (LICENSE; DESCRIPTION "MIT + file LICENSE") | JackStraw, default dimensions | reimplement (a port would be permitted); callout comparator |
| https://github.com/theislab/scanpy | maintainers in pyproject.toml: Ilan Gold, Philipp Angerer, Severin Dicks | BSD 3-Clause (LICENSE; pyproject "BSD-3-clause") | default of 50 components | callout (constant only) |
| https://github.com/scikit-learn/scikit-learn | scikit-learn developers | BSD 3-Clause (COPYING; pyproject "BSD-3-Clause") | probabilistic-PCA noise, Minka's `'mle'` | reimplement the noise estimate; callout for Minka |
