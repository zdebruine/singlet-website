---
id: dim-reduction.scalable_truncated_svd
title: Approximate PCA and truncated SVD at atlas scale
area: dim-reduction
scope: core
paradigm: hybrid
literature_status: routine
priority: P1
depends_on: [normalization.variance_stabilizing_transform, feature-selection.highly_variable_gene_selection, covariate-adjustment.gene_scaling_and_clipping]
feeds: [dim-reduction.pc_number_selection, neighbors.approximate_knn_search, clustering.cell_partitioning, scalability.out_of_core_processing]
reads: [layers/log1p_norm, var/highly_variable]
writes: [obsm/X_pca, varm/PCs, uns/pca]
devices: [cpu, cuda]
mcp_tool: singlet_dim_reduction_scalable_truncated_svd
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Approximate PCA and truncated SVD at atlas scale

> Compute the leading singular subspace of the centred cell-by-gene matrix with exact sparse Krylov, randomized and covariance solvers, and measure how far each approximation departs from the exact decomposition in error, time and memory.

## 1. Question

Given a normalised, highly-variable-gene matrix $X\in\mathbb{R}^{n\times g}$ (sparse, $n$ cells, $g$ genes), centred implicitly, and a target rank $k$, which solver returns the leading $k$ singular triplets within a stated tolerance of the exact decomposition, at acceptable time and memory? The outputs are cell scores $Z=U_k\operatorname{diag}(s_k)$, gene loadings $V_k$ and variance ratios. A correct answer agrees with the exact SVD of the same centred matrix, with subspace error stated relative to the spectral gap.

## 2. Why this task matters and where the field stands

Principal component analysis is the linear compression that most single-cell pipelines apply before neighbour graphs, clustering and embedding. At atlas scale the exact decomposition is costly, so the question is how much accuracy the faster solvers give up for the time and memory they save. The status is **routine**: the mathematics is settled and several libraries ship the solvers. Singlet needs parity with those standard routes and a documented, gap-relative error at scale.

- **Error at scale.** Tsuyuzaki et al. (2020) benchmark PCA implementations on large scRNA-seq matrices and report Krylov-subspace and randomized SVD methods ahead on speed and memory use [R1]. Sun et al. (2019) compare 18 dimensionality reduction methods on 30 public scRNA-seq datasets, including computational cost [R2]; their per-method rankings are not reproduced here. Subspace error relative to the spectral gap is measured directly here (B1, B2), because it determines whether an approximation is usable.
- **Defaults differ across libraries.** scanpy computes centred CPU PCA with ARPACK through scikit-learn, scikit-learn selects its solver by a shape rule, and rapids-singlecell switches between Lanczos and covariance routes by gene count (section 4).
- **Reference scale.** No dense exact SVD is feasible at atlas scale, so every accuracy claim rests on a stated reference computed on a subsample (section 8).

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $X\in\mathbb{R}^{n\times g}$, $\mathbf 1$ | sparse cell-by-gene matrix; all-ones vector |
| $\mu=\tfrac1n X^\top\mathbf 1$, $X_c=X-\mathbf 1\mu^\top$ | column means and the centred matrix (never formed) |
| $s_1\ge\dots\ge s_g$, $U_k$, $V_k$ | singular values of $X_c$ and leading $k$ singular vectors |
| $\rho_k=s_k/s_{k+1}$ | gap ratio at rank $k$ |
| $k$, $p$, $q$ | target rank, oversampling ($p\ge 2$), power iterations |
| $\Omega\in\mathbb{R}^{g\times(k+p)}$ | Gaussian test matrix |

The target is deterministic: the exact top-$k$ SVD of $X_c$. No statistical model of the counts enters the solver, so the question is numerical. Every estimand below is defined against the exact SVD of the same centred matrix in float64.

The optimum and the centred decomposition are

$$X_{c,k}=\operatorname*{arg\,min}_{\operatorname{rank}(Y)\le k}\|X_c-Y\|_F,\qquad \|X_c-X_{c,k}\|_F^2=\sum_{j>k}s_j^2,$$

$$\hat\Sigma=\frac{X_c^\top X_c}{n-1}=V\,\frac{\operatorname{diag}(s)^2}{n-1}\,V^\top,\qquad Z=X_cV_k=U_k\operatorname{diag}(s_k).$$

The first is the Eckart–Young optimum for any real matrix in exact arithmetic [R3]. The second holds for $n>1$; centring is over all rows passed to the solver, and batch-wise or per-cluster centring defines a different target.

Solvers never form $X_c$. They use

$$X_c v=Xv-\mathbf 1\,(\mu^\top v),\qquad X_c^\top u=X^\top u-\mu\,(\mathbf 1^\top u),\qquad \|X_c\|_F^2=\|X\|_F^2-n\|\mu\|^2,$$

which are exact identities that keep sparsity and give the total variance directly. In float32, when $|\mu_j|$ is much larger than the column standard deviation $\sigma_j$, the two terms nearly cancel and rounding of order $\varepsilon|\mu_j|$ dominates the centred result.

The three solver families reach the same subspace by different routes.

- *Krylov.* Lanczos-type methods build a polynomial-filtered subspace from products with $X_c$ and $X_c^\top$. For a leading Ritz vector after $m$ steps, with $\lambda_i=s_i^2$ the eigenvalues of $X_c^\top X_c$,
$$\tan\theta_m\le\frac{\tan\theta_0}{T_{m-1}(1+2\gamma)},\qquad \gamma=\frac{\lambda_1-\lambda_2}{\lambda_2-\lambda_g},$$
where $T_{m-1}$ is a Chebyshev polynomial [R6]. The governing gap is in squared singular values, and the bound holds for one vector whose start has a non-zero component on the target.
- *Randomized range finder.* With Gaussian $\Omega$, $Y=(X_cX_c^\top)^qX_c\,\Omega$, $Q=\operatorname{orth}(Y)$, $Q^\top X_c=\tilde U\Sigma\tilde V^\top$, $\hat U_k=Q\tilde U_{1:k}$ and $\hat V_k=\tilde V_{1:k}$. This costs $2q+2$ sparse products with $k+p$ dense columns. For $q=0$ and $p\ge2$, the expected Frobenius error is bounded as recalled from Halko et al. [R4]:
$$\mathbb{E}\,\|X_c-QQ^\top X_c\|_F\le\Bigl(1+\tfrac{k}{p-1}\Bigr)^{1/2}\Bigl(\sum_{j>k}s_j^2\Bigr)^{1/2}.$$
Power iterations sharpen the range when the spectrum decays slowly [R4].
- *Covariance route.* An eigendecomposition of the $g\times g$ Gram matrix, needing $8g^2$ bytes in float64 (512 MB decimal at $g=8{,}000$). Because $\kappa_2(X_c^\top X_c)=\kappa_2(X_c)^2$ for full-column-rank $X_c$, rounding error of order $\varepsilon s_1^2$ in the eigenvalues becomes a relative error of order $\varepsilon(s_1/s_k)^2$ in $s_k$, so the route is least accurate for the smallest retained components (first order in $\varepsilon$).

The subspace perturbation bound, of Wedin type [R5], controls the sine of the largest principal angle between exact and approximate subspaces,

$$\|\sin\Theta(V_k,\hat V_k)\|_2\lesssim\frac{\|E\|_2}{s_k-s_{k+1}},$$

where $E$ is the perturbation the approximate solver effectively decomposes. It holds when the perturbation is small relative to the gap, so subspace error must be reported against $s_k-s_{k+1}$ and never as a bare number.

Random projections preserve pairwise distances with high probability [R7, R8, R9] but do not bound singular-subspace error, so they are sketches rather than solvers and are not proposed here. Count-likelihood latent factors target a different object (`dim-reduction.count_model_latent_factors`).

Estimands, one sentence each:

- *Singular values.* sv_rel_err is $\max_{i\le k}|\hat s_i-s_i|/s_i$, with $s_i$ from the float64 SVD of $X_c$.
- *Right subspace.* sin_theta_max_V is $\|(I-\hat V_k\hat V_k^\top)V_k\|_2$, unitless in $[0,1]$ and invariant to sign and rotation within the subspace; the left subspace is treated the same way.
- *Reconstruction.* frob_recon_ratio is $\|X_c-\hat U_k\hat U_k^\top X_c\|_F/\|X_c-X_{c,k}\|_F$, equal to 1 for the exact solver.
- *Embedding.* The Procrustes error is $\min_{Q\in O(k)}\|\hat Z-ZQ\|_F/\|Z\|_F$, with $Z=U_k\operatorname{diag}(s_k)$ and $\hat Z=\hat U_k\operatorname{diag}(\hat s_k)$.
- *Variance.* Each variance ratio is $r_j=s_j^2/\|X_c\|_F^2$, normalised by the total centred variance of all $g$ genes rather than of the $k$ retained components.
- *Neighbourhood and partition agreement* are defined in B3.

Approximation error is a property of the spectrum (its decay and the gap at $k$) together with $p$ and $q$; $n$ enters only through the spectrum. Agreement of variance ratios can hold while components inside a near-degenerate group rotate, so subspace metrics are required. Sign and rotation are conventions, so embeddings are compared only after alignment.

The solvers are numerical, so a model enters as a calibrated predictor rather than a replacement. Within a setting, $\log\sin\Theta$ is assumed approximately linear in $\log\rho_k$, and the assumption is tested. A fitted regression with Gaussian residuals then gives a predictive interval for the subspace error of a given spectrum. Against a fixed setting, it chooses $(q,p)$ with a stated confidence that the error is below target, and its calibration can be checked on held-out spectra. It is rejected if nominal 95% intervals cover fewer than 90% of held-out spectra (proposed threshold).

Failure modes:

- *Flat or slowly decaying spectra* raise randomized error unless $q$ grows.
- *Near-degenerate singular values* make single vectors unidentifiable, so projections and subspaces are compared instead.
- *Float32 centring* suffers the cancellation described above.
- *The covariance route* squares the conditioning and costs $8g^2$ bytes.
- *Reproducibility:* threaded and GPU reductions change results at round-off, and seeds fix only the random draws.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Truncated SVD by ARPACK (`svds`), the scanpy CPU default for centred PCA | heuristic | Implicitly restarted Lanczos on the implicitly centred operator returns the $k$ largest singular triplets to a tolerance. | [R11] |
| Randomized SVD with power iterations (scikit-learn `randomized_svd`) | heuristic | Gaussian range finder with $k+p$ columns and $q$ power iterations, then an exact SVD of the projected matrix. | [R4][R10] |
| Block randomized SVD on GPU with CholeskyQR2 (rapids-singlecell) | heuristic | The same range finder with block size $k+p$, CholeskyQR2 orthogonalisation and block power iterations. | [R12] |
| Lanczos bidiagonalisation with CGS2 and implicit restarts (rapids-singlecell `lanczos_svd`) | heuristic | Lanczos bidiagonalisation of the implicitly centred operator, classical Gram–Schmidt twice, and restarts that lock converged triplets. | [R11] |
| Covariance eigendecomposition (scikit-learn `covariance_eigh`; rapids) | heuristic (exact to round-off) | Eigendecomposition of the centred $g\times g$ Gram matrix. | — |

The published standard is the ARPACK route for centred CPU PCA in scanpy, scikit-learn's randomized solver for uncentred input, and the rapids pair on GPU (Lanczos above 8,000 genes, covariance below). Each is kept as a comparator. The defaults below are taken from source at the pinned commit.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| scanpy PCA | solver, centred dense or sparse | `arpack` | `src/scanpy/preprocessing/_pca/__init__.py:438`, `:441` @8ed52d9 |
| scanpy PCA | solver default history | 1.4.5: `'auto'` to `'arpack'`; 1.9.3: `'arpack'` to `None`, resolved to `'arpack'` at `__init__.py:438` and `:441` | `__init__.py:150-152` @8ed52d9 |
| scanpy PCA | n_comps when None | `min_dim - 1` if `min_dim <= N_PCS`, else `N_PCS` | `__init__.py:233-235` @8ed52d9 |
| scanpy PCA | uncentred solver | sklearn `TruncatedSVD`, `randomized` | `__init__.py:93` @8ed52d9 |
| scanpy PCA | sparse `lobpcg` compat path | used only for `lobpcg` with sparse input; `LinearOperator` with mean; random start vector | `__init__.py:272-278`; `_compat.py:43-59` @8ed52d9 |
| scanpy compat | mean accumulation | `x.mean(0)` without an accumulation dtype | `_compat.py:40` @8ed52d9 |
| scikit-learn PCA | sparse arpack path | mean by `mean_variance_axis`; implicit offset operator; `svds` with `tol=self.tol` | `_pca.py:695-708` @85593ca |
| scikit-learn PCA | tol default | `0.0` | `_pca.py:392` @85593ca |
| scikit-learn PCA | solver `auto` policy | covariance_eigh if fewer than 1000 features and more than 10× samples; randomized if above 500×500 and $k<0.8\min$ dimension; else full | `_pca.py:177-186` (docstring), `:510-516` (code) @85593ca |
| scikit-learn PCA | covariance route sign | `svd_flip`, `u_based_decision=False` | `_pca.py:608` @85593ca |
| scikit-learn randomized_svd | n_oversamples, n_iter, flip_sign | `10`, `"auto"`, `True` | `extmath.py:403-407` @85593ca |
| scikit-learn randomized_svd | n_iter when `auto` | 7 if $k<0.1\min(\text{shape})$, else 4 | `extmath.py:577-580` @85593ca |
| scikit-learn TruncatedSVD | algorithm, n_iter, n_oversamples, tol | `randomized`, 5, 10, 0.0 | `_truncated_svd.py:173-178` @85593ca |
| scikit-learn TruncatedSVD | ARPACK constraint | $k$ strictly below the number of features | `_truncated_svd.py:51` @85593ca |
| rapids randomized_svd | n_oversamples, n_iter | 10, 2 | `_block_lanczos.py:114-115` @e110792 |
| rapids randomized_svd | block size | `min(k + n_oversamples, m, n)` | `_block_lanczos.py:164` @e110792 |
| rapids randomized_svd | orthogonalisation | CholeskyQR2; QR if Cholesky fails | `_block_lanczos.py:71-74` @e110792 |
| rapids pca | sparse svd_solver | `lanczos` if n_vars > 8k, else `covariance_eigh` | `_pca.py:66`, `:70` @e110792 |
| rapids pca | legacy random_state | 0 | `_pca.py:34` @e110792 |
| rapids lanczos_svd | k, tol, max_iter, refine_results | 6, 1e-4, 100, True | `_svd_lanczos.py:202-208` @e110792 |
| rapids lanczos_svd | tol meaning | Ritz residual below `tol × top singular value` | `_svd_lanczos.py:309` @e110792 |
| rapids lanczos_svd | ncv | $\min(\max(3k,50),\min(m,n))$ for $m\le10^5$; $2.5k$ (if $k<75$) or $3.9k$ otherwise; capped; at least $k+10$ | `_svd_lanczos.py:247-261` @e110792 |
| rapids mean | accumulation dtype | float64 | `_utils.py:68-69` @e110792 |
| rapids tests | variance-ratio tolerance | rtol 0.05 randomized; rtol 1e-5 exact | `tests/test_pca.py:160`, `:167` @e110792 |
| rapids tests | same-seed reproducibility | rtol 1e-10 | `tests/test_pca.py:192-197` @e110792 |
| scikit-learn random projection | documented JL example | 663 for $n=10^6$, $\varepsilon=0.5$ | `doc/modules/random_projection.rst:61` @85593ca |

## 5. Proposed singlet approach

- **Routing.** `auto` resolves to ARPACK-type Lanczos on CPU. On GPU it resolves to Lanczos above 8,000 genes and to the covariance eigendecomposition at or below 8,000. Randomized SVD is used only when requested; a dry-run estimate that the exact route exceeds available memory is reported, not acted on. The defaults an agent should use without asking are $k=50$, layer `log1p_norm`, `use_hvg` true, centring on, `dtype` float64, `seed` 42, $p=10$ and $q=2$.
- **Model-based setting.** On a 1e4-cell pilot from the same matrix, the exact route returns the leading singular values, and the calibrated predictor of section 3 then picks the smallest $(q,p)$ whose upper 95% predictive bound for the top-10 subspace error is at most 0.05. The fit uses the synthetic spectra of B2 and the pilot spectra of B1. It is a log-linear regression with few coefficients per setting, falsified as in section 3.
- **Implicit centring and precision.** Sparse input is never densified, and products use the rank-one corrections of section 3 on both backends. Means are accumulated in float64 even for float32 data. Float32 is opt-in and becomes a default only after B1 and B4 meet their acceptance criteria for the target atlases.
- **Core kernels.** Sparse matrix–vector and matrix–block products; block orthogonalisation by CholeskyQR2 with QR fallback; a small dense SVD of the projected matrix; the Gram matrix for the covariance route. GPU kernels follow the rapids-singlecell design (section 12) with cuSPARSE for sparse products. No deep network is needed: the solver has no learned parameters, and the predictor is a hard-coded regression, not a PyTorch model.
- **Dependency-free core.** The ARPACK-type route is an implicitly restarted Lanczos in C++, so scipy serves only as a comparator.
- **Streaming.** Out-of-core and chunked execution is outside the first release and belongs to `scalability.out_of_core_processing`.
- **Sign convention.** The largest-magnitude loading of each component is made positive, applied to every route before output.
- **Falsification.** If exact-type solvers at float64 miss the B1 thresholds, the implementation is at fault before the method. If the predictor misses the coverage threshold of section 3, the fixed setting $(q,p)=(2,10)$ is kept.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/log1p_norm | float32 or float64, sparse CSR | normalised log-scale values, decomposed after implicit centring |
| read | var/highly_variable | bool | gene mask, read when `use_hvg` is true |
| write | obsm/X_pca | float, $n\times k$ | cell scores $Z$ |
| write | varm/PCs | float, $g\times k$ | gene loadings $V_k$, unit-norm columns |
| write | uns/pca | dict | `variance` $s_k^2/(n-1)$; `variance_ratio` $s_k^2/\lVert X_c\rVert_F^2$; solver, dtype, seed, n_oversamples, n_iter, tol and sign convention |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "log1p_norm" | — | Normalised layer under layers/ to decompose after implicit centring. |
| `use_hvg` | boolean | true | — | Restrict to var/highly_variable; the call fails if the mask is absent. |
| `n_components` | integer | 50 | min 2; max 200 | Number of leading singular triplets k to compute. |
| `svd_solver` | string | "auto" | `auto`, `arpack`, `randomized`, `lanczos`, `covariance_eigh` | auto: arpack on CPU; lanczos or covariance_eigh on GPU by gene count; randomized only on request. |
| `zero_center` | boolean | true | — | Centre genes implicitly before the decomposition; false decomposes the uncentred matrix. |
| `dtype` | string | "float64" | `float32`, `float64` | Working precision; float64 is the reference, float32 is opt-in. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 42 | min 0 | Seed for randomized test matrices and Krylov start vectors. |
| `dry_run` | boolean | false | — | Return estimated time, memory, device and resolved solver without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `options` | object | — | — | Method-specific options; each object applies only to the solver of the same name. |
| `options.randomized` | object | — | — | Options for randomized. |
| `options.randomized.n_oversamples` | integer | 10 | min 0; max 100 | Extra Gaussian test vectors p; the block size is k + p. |
| `options.randomized.n_iter` | integer | 2 | min 0; max 20 | Power iterations q; more iterations sharpen slowly decaying spectra. |
| `options.lanczos` | object | — | — | Options for lanczos. |
| `options.lanczos.tol` | number | 0.0001 | > 0 | Ritz residual tolerance, relative to the top singular value. |
| `options.lanczos.max_iter` | integer | 100 | min 1; max 1000 | Maximum implicit restarts. |
| `options.lanczos.ncv` | integer/null | null | min 10 | Krylov dimension; null uses the size-dependent rule. |
| `options.arpack` | object | — | — | Options for arpack. |
| `options.arpack.tol` | number | 0 | min 0 | Convergence tolerance for the Krylov solver; 0 is the sklearn PCA default. |
<!-- PARAMS:AUTO:END -->

The randomized solver reads `n_oversamples`, `n_iter` and `seed`. The Lanczos solver reads `tol`, `max_iter` and `ncv`, and the ARPACK route reads `tol` and the seed for its start vector; the covariance route has no options. `n_components` at or above $\min(n,g)$ is rejected, and the randomized block $k+p$ must not exceed $\min(n,g)$. With `zero_center` false the decomposition is of $X$ itself and the variance-ratio denominator is $\lVert X\rVert_F^2$.

## 7. MCP tool

Tool name `singlet_dim_reduction_scalable_truncated_svd` (definition in `tasks/mcp/singlet_dim_reduction_scalable_truncated_svd.json`).

```json
{"dataset": "atlas.singlet", "layer": "log1p_norm", "n_components": 50, "svd_solver": "auto", "dtype": "float64", "seed": 42}
```

```json
{"dataset": "atlas.singlet", "status": "completed", "wrote": ["obsm/X_pca", "varm/PCs", "uns/pca"],
 "summary": {"k": 50, "solver": "arpack", "device": "cpu", "dtype": "float64",
             "variance_ratio_sum": "<value in (0, 1)>", "relative_gap_at_k": "<value>"},
 "provenance_id": "<provenance id>", "job_id": null, "estimate": null}
```

Long-running: calls above the inline limit are queued and return a `job_id`. Stochastic: yes, randomized and Lanczos use `seed`, and the ARPACK start vector is seeded too. Dry run: returns seconds, peak memory, device and resolved solver without computing.

## 8. Benchmarks

All accuracy benchmarks share this protocol unless a block states otherwise. The reference is the exact top-$k$ SVD of the centred matrix in float64: LAPACK on 1e4-cell subsamples and covariance eigendecomposition on 1e5-cell subsamples, cross-checked against LAPACK on 1e4 cells. Matrices are highly-variable-gene restrictions with $g\in\{2{,}000, 8{,}000\}$. Ranks are $k\in\{10,20,50\}$, with seeds 0–4 and float32 and float64 candidates. Exact-type solvers (ARPACK and Lanczos) iterate to tolerance $10^{-8}$, so that acceptance tests convergence; default tolerances are tested in B2. Sign alignment precedes any embedding comparison. Report medians and interquartile ranges over seeds, the gap ratio $\rho_k$ for every $k$, and the hardware for each execution.

### B1. Exact-reference singular-subspace accuracy on catalogue subsamples

- **Goal**: Measure how closely each solver's leading singular triplets match the exact SVD on real uniformly processed matrices, by solver, rank, precision and gap.
- **Ground truth**: consistency with the exact float64 decomposition of the same centred matrix; no biological label. Each metric's estimand is defined in section 3.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Stratified subsamples of the singlet catalogue | singlet catalogue of 354M uniformly processed cells | —; 1e4 and 1e5 cells; $g$ = 2,000 and 8,000 | — | Stratified by technology and tissue, sampled uniformly within strata; indices fixed before measurement |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| sv_rel_err | $\max_{i\le k}\lvert\hat s_i-s_i\rvert/s_i$ | lower | primary | — |
| sin_theta_max_V | $\lVert(I-\hat V_k\hat V_k^\top)V_k\rVert_2$, reported with $s_k-s_{k+1}$ | lower | primary | — |
| frob_recon_ratio | $\lVert X_c-\hat U_k\hat U_k^\top X_c\rVert_F/\lVert X_c-X_{c,k}\rVert_F$; 1 is optimal | lower | guardrail | [R3] |
| embedding_procrustes_rel_err | $\min_{Q\in O(k)}\lVert\hat Z-ZQ\rVert_F/\lVert Z\rVert_F$ | lower | guardrail | — |

- **Comparators**: scipy `svds` (ARPACK) [R11]; scikit-learn `randomized_svd` and `TruncatedSVD`; rapids-singlecell randomized and Lanczos (GPU); `covariance_eigh`. Commits as in section 4; the scipy version is recorded per execution.
- **Protocol**: the shared protocol above, with exact-type tolerance $10^{-8}$. Randomized solvers use $q=2$ and $p=10$ for acceptance, and the grid of B2 otherwise.
- **Acceptance criterion**: Proposed design thresholds, calibrated against the repository test tolerances of section 4 and not taken from a published benchmark. Exact-type solvers at float64 have sv_rel_err ≤ 1e-5 and sin_theta_max_V ≤ 1e-4 for $k\le50$. Randomized solvers with $q\ge2$ and $p=10$ have sv_rel_err ≤ 5e-2 and sin_theta_max_V ≤ 0.05 for the top 10 components whenever $(s_{10}-s_{11})/s_{10}\ge0.1$.
- **Known pitfalls**:
  1. Matching variance ratios alone, as the repository tests do, can hold while components inside a near-degenerate group rotate, so subspace metrics are required.
  2. A float32 or approximate reference inflates every error, so the reference is float64 and cross-checked as stated above.

### B2. Planted-spectrum benchmark with a known gap (proposed)

- **Goal**: Relate subspace error to the gap ratio per solver setting, on matrices with constructed spectra.
- **Ground truth**: exact float64 SVD of the realised matrix, from which the realised gap $\hat\rho_{k^\ast}=s_{k^\ast}/s_{k^\ast+1}$ is measured; planted factors are not the reference.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Poisson factor generator | generated by singlet | sparse CSR; $n=10^5$, $g=8{,}000$ | — | Gap recorded per matrix |

Recipe:

1. Draw $n=10^5$ cells and $g=8{,}000$ genes. Draw lognormal cell factors $d_i$ whose log-scale is the standard deviation of log library sizes in the 1e5-cell B1 subsample; set gene baselines $a_j$ to log gene means of that subsample.
2. Draw Gaussian $U_0\in\mathbb{R}^{n\times100}$ and $V_0\in\mathbb{R}^{g\times100}$ and orthonormalise their columns.
3. Set $s_j=0.97^{\,j}$ for $j\le k^\ast$ and $s_j=0.97^{\,k^\ast}\rho^{-1}0.95^{\,j-k^\ast-1}$ for $j>k^\ast$; $k^\ast\in\{10,20,50\}$, $\rho\in\{1.05,1.2,1.5,2.0\}$.
4. Set log-rates $L=a\mathbf 1^\top+\beta U_0\operatorname{diag}(s)V_0^\top$, with $\beta$ matching the subsample mean count, evaluated only at the mask entries of step 5.
5. Sample $y_{ij}\sim\operatorname{Poisson}(d_i e^{L_{ij}})$ on a fixed random mask of density 0.05 (CSR, zeros elsewhere), apply the B1 normalisation, and record $\hat\rho_{k^\ast}$.

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| sin_theta_max_V | as in B1, for the top 10 components | lower | primary | — |
| sv_rel_err | as in B1 | lower | primary | — |
| time_to_target | wall time to first reach sin_theta_max_V ≤ 0.05 (top 10); infinite if never | lower | guardrail | — |

- **Comparators**: ARPACK; randomized with $q\in\{0,1,2,3\}$ and $p\in\{5,10,20\}$; rapids-singlecell randomized and Lanczos.
- **Protocol**: grid over $k^\ast$ and $\rho$, five seeds; per solver setting, fit $\log\sin\Theta_{\max}$ on $\log\hat\rho_{k^\ast}$ and report the smallest $q$ and $p$ reaching the target for each $\rho$.
- **Acceptance criterion**: Proposed design criterion. Randomized with $q=2$ and $p=10$ reaches sin_theta_max_V ≤ 0.05 for the top 10 components whenever $\hat\rho_{10}\ge1.2$ on the realised matrix.
- **Known pitfalls**:
  1. Planted spectra are not scRNA-seq spectra; the fitted curve is checked against B1 before setting any default.
  2. Poisson noise sets a floor on the observable gap, reported as the smallest realised $\hat\rho$.

### B3. Neighbourhood preservation of approximate embeddings (proposed)

- **Goal**: Check that the 30-component approximate embedding preserves the cell neighbourhoods and Leiden partitions of the exact PCA embedding.
- **Ground truth**: consistency with exact float64 PCA (`covariance_eigh`) on the same matrix. Each cell's 15 nearest neighbours in the exact embedding define the reference neighbourhood, and the Leiden partition of the exact embedding defines the reference clustering; no author label is used.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 1e5-cell subsamples from B1 | singlet catalogue | —; 1e5 cells; $g$ = 8,000 | — | Same indices as B1 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| knn_overlap_15 | mean over cells of $\lvert N_{\mathrm{exact}}(i)\cap N_{\mathrm{approx}}(i)\rvert/15$, Euclidean in the first 30 scores, self excluded | higher | primary | — |
| ARI_leiden | adjusted Rand index between Leiden partitions of the two embeddings, at fixed resolution and seed | higher | guardrail | — |

- **Comparators**: ARPACK; randomized with $q=2$ and $p=10$.
- **Protocol**: 30 components; 15 neighbours; fixed Leiden resolution and seed for both embeddings; neighbour-distance ties broken by cell index; five seeds; medians and IQR.
- **Acceptance criterion**: Proposed. knn_overlap_15 ≥ 0.95 and ARI_leiden ≥ 0.98 for randomized with $q\ge2$ and $p=10$ against exact PCA.
- **Known pitfalls**:
  1. Leiden clustering is stochastic, so both embeddings receive the same seed.
  2. Neighbourhood agreement is an engineering check and does not show better biology.

### B4. Implicit-centring operator correctness (proposed)

- **Goal**: Check that products with the implicitly centred operator equal explicit centred products across sparsity and mean-to-deviation regimes.
- **Ground truth**: explicit centring in float64 on subsets of at most $10^4$ cells and 2,000 genes, which fit in memory as dense matrices.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Random sparse CSR matrices (recipe below) | generated by singlet | $n\le10^5$; $g\le2\times10^4$ | — | Dense checks on subsets only |

Recipe:

1. Draw nonzero entries uniformly from the integers 1 to 10 at densities $10^{-3}$, $10^{-2}$ and $10^{-1}$.
2. Add a column-specific shift to the nonzero entries so that the realised ratio $\mu_j/\sigma_j$ falls into the bands $\{0\}$, $(0,1]$, $(1,10]$ and $(10,100]$, and record the realised distribution of the ratio.

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| matvec_rel_err | $\lVert(X-\mathbf 1\mu^\top)v-X_cv\rVert/\lVert X_cv\rVert$ for random $v$ | lower | primary | — |
| rmatvec_rel_err | $\lVert(X-\mathbf 1\mu^\top)^\top u-X_c^\top u\rVert/\lVert X_c^\top u\rVert$ for random $u$ | lower | primary | — |

- **Comparators**: explicit dense centring on subsets; the scanpy compat operator (`mat_op` and `rmat_op`, section 4).
- **Protocol**: float64 and float32 candidates, with the mean accumulated in float64 in both; ten random vectors and five random matrices per input matrix; peak memory recorded to confirm that no dense $n\times g$ array is allocated.
- **Acceptance criterion**: Proposed. float64 relative error ≤ 1e-12; float32 relative error ≤ 1e-5 where $\mu_j/\sigma_j\le10$.
- **Known pitfalls**:
  1. Float32 cancellation when $|\mu_j|$ dominates $\sigma_j$ (section 3), and the scanpy compat path computes its mean without an accumulation dtype (section 4).
  2. Sparse centring must not densify $X$, so memory is checked alongside the numerical error.

### P1. Performance and scaling

- **Scales**: $n\in\{10^4,10^5,3\times10^5,10^6,3\times10^6\}$ cells at $g=2\times10^4$ genes, and $n=10^6$ at $g=8{,}000$ for the covariance branch.
- **Metrics**: time to target (sin_theta_max_V ≤ 0.05 for the top 10 components), total time, throughput in cells per second, peak resident memory (CPU) and device memory (GPU).
- **Comparators**: ARPACK; randomized with $q=2$ and $p=10$; scikit-learn `randomized_svd` (CPU); rapids randomized, Lanczos and `covariance_eigh` (GPU).
- **Hold fixed**: CSR input, seed, tolerances, $n_{\mathrm{iter}}$, $k\in\{20,50\}$ and centring on. Dtypes are reported separately. CPU timing is given with one thread and with all cores; GPU timing discards warm-up and synchronises before reading the clock. Timings are comparable only within one environment.
- **Acceptance**: Proposed, not from the literature. At the largest scale, randomized and Lanczos reach the target no slower than ARPACK.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `covariate-adjustment.gene_scaling_and_clipping`: Gene scaling, centering and clipping before PCA
- **Feeds**:
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `scalability.out_of_core_processing`: Atlas-scale execution fidelity: out-of-core, chunked and GPU computation versus in-memory CPU reference
- **Reads**: `layers/log1p_norm`, `var/highly_variable`
- **Writes**: `obsm/X_pca`, `varm/PCs`, `uns/pca`
<!-- CHAINING:AUTO:END -->

Standard chain from normalisation and gene selection to PCA, then neighbour graphs, clustering and embedding; the pc-number step consumes these scores.

## 10. Risks, pitfalls and open questions

- Tsuyuzaki et al. (2020) and Sun et al. (2019) are used only at abstract level. Their datasets, metrics and numerical results are not reproduced here, and the summaries above are limited to what the abstracts state [R1, R2].
- The Frobenius bound and the power-iteration statement of section 3 are recalled from Halko et al. (2011) and must be checked against the text before publication. The Wedin, Eckart–Young and Krylov statements are standard results cited from memory [R3, R5, R6]; no numerical claim in this document depends on their constants.
- The gap measured on a 1e4-cell pilot may differ from the full-matrix gap, because the spectrum changes with sample size. The transfer rule is untested. The first experiment compares pilot and full-matrix $\rho_k$ on the 1e5-cell subsamples of B1.
- The float32 error budget for implicit centring with large column means, and the accuracy of the covariance route for small trailing components, are not characterised in the sources used here.
- Redistribution terms for catalogue subsamples must be set before benchmark data or derived spectra are published. Out-of-core PCA frameworks and the IRLBA package were not read and are not proposed.
- Exact references are limited to $g\le8{,}000$ and $10^5$ cells. Errors at $3\times10^6$ cells are extrapolated from those results unless a larger reference is added. The $10^5$-cell reference is the covariance route, whose error on trailing components is not characterised, and its cross-check against LAPACK covers $10^4$ cells only.

## 11. References

R1. Tsuyuzaki K, Sato H, Sato K, Nikaido I. Benchmarking principal component analysis for large-scale single-cell RNA-sequencing. *Genome Biology* 2020;21:9. doi:10.1186/s13059-019-1900-3 — verified (search)

R2. Sun S, Zhu J, Ma Y, Zhou X. Accuracy, robustness and scalability of dimensionality reduction methods for single-cell RNA-seq analysis. *Genome Biology* 2019;20:269. doi:10.1186/s13059-019-1898-6 — verified (search)

R3. Eckart C, Young G. The approximation of one matrix by another of lower rank. *Psychometrika* 1936;1(3). — unverified (memory)

R4. Halko N, Martinsson PG, Tropp JA. Finding structure with randomness: probabilistic algorithms for constructing approximate matrix decompositions. *SIAM Review* 2011;53(2):217–288. doi:10.1137/090771806 — verified (repo)

R5. Wedin PA. Perturbation bounds in connection with singular value decomposition. *BIT Numerical Mathematics* 1972;12. — unverified (memory)

R6. Parlett BN. *The Symmetric Eigenvalue Problem*. SIAM; reprint of the 1980 edition, 1998. — unverified (memory)

R7. Dasgupta S, Gupta A. An elementary proof of the Johnson–Lindenstrauss lemma. 1999. — verified (repo)

R8. Achlioptas D. Database-friendly random projections: Johnson–Lindenstrauss with binary coins. *Journal of Computer and System Sciences* 2003;66:671–687. — verified (repo)

R9. Li P, Hastie TJ, Church KW. Very sparse random projections. *Proceedings of the ACM SIGKDD International Conference on Knowledge Discovery and Data Mining (KDD '06)* 2006. — verified (repo)

R10. Martinsson PG, Rokhlin V, Tygert M. A randomized algorithm for the decomposition of matrices. *Applied and Computational Harmonic Analysis* 2011;30(1):47–68. doi:10.1016/j.acha.2010.02.003 — verified (repo)

R11. Lehoucq RB, Sorensen DC, Yang C. *ARPACK Users' Guide*. SIAM; 1998. — partial (repo)

R12. Tomás AE, Quintana-Ortí ES, Anzt H. Fast truncated SVD of sparse and dense matrices on graphics processors. *The International Journal of High Performance Computing Applications* 2024. doi:10.1177/10943420231179699 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | scverse contributors; LICENSE copyright F. Alexander Wolf, P. Angerer, Theis Lab | BSD-3-Clause | CPU default dispatch, compat path and defaults (section 4) | callout |
| https://github.com/scikit-learn/scikit-learn | The scikit-learn developers | BSD-3-Clause | randomized SVD, PCA solver policy, sparse implicit centring | port |
| https://github.com/scverse/rapids-singlecell | Severin Dicks (2022); scverse (2025) | MIT | GPU block randomized SVD, Lanczos driver, centred operator | port |
| https://github.com/scipy/scipy | SciPy developers | BSD-style (LICENSE.txt) | ARPACK through `svds`; benchmark comparator | port (core Krylov route); callout (comparator) |
