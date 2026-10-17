---
id: dim-reduction.normalized_cell_embedding
title: Cell embedding from normalized expression (PCA and alternatives)
area: dim-reduction
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [normalization.size_factor_estimation, normalization.variance_stabilizing_transform, feature-selection.highly_variable_gene_selection, covariate-adjustment.gene_scaling_and_clipping]
feeds: [dim-reduction.pc_number_selection, neighbors.approximate_knn_search, clustering.cell_partitioning, embedding-viz.local_neighborhood_preservation]
reads: [layers/log1p_norm, var/highly_variable, layers/counts]
writes: [obsm/X_pca, varm/PCs, uns/pca, obsm/X_ica, varm/ica_loadings, obsm/X_sparse_pca, varm/sparse_pca_loadings, obsm/X_fa, varm/fa_loadings, var/fa_noise_variance, obsm/X_rp, obsm/X_diffmap, uns/dr_diffusion_map/eigenvalues, obsm/X_umap, uns/dr_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_dim_reduction_normalized_cell_embedding
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Cell embedding from normalized expression (PCA and alternatives)

> Build a $k$-dimensional cell embedding from a normalised, highly-variable-gene matrix, with PCA as the default and the published alternatives as comparators.

## 1. Question

Given a normalised cell-by-gene matrix with $n$ cells and $p$ highly variable genes, which method and setting give a $k$-dimensional embedding $Y\in\mathbb{R}^{n\times k}$ that best preserves input neighbourhoods and supports clustering and lineage recovery? The input is a normalised layer (log-normalised by default), the HVG mask and, for one method, raw counts. The output is $Y$ per cell and gene loadings where the method defines them. No ground truth defines a correct embedding. The literature scores neighbourhood preservation against the input and agreement of clusters with expert labels, and the two can disagree (section 3). Section 8 scores both, planted structure in a simulation, and numerical agreement with an exact decomposition.

## 2. Why this task matters and where the field stands

Almost every workflow compresses the expression matrix before building a neighbour graph, clustering or drawing a map: normalisation, HVG selection, PCA, neighbour graph, then clustering or visualisation [R1]. The embedding fixes the space in which every later neighbourhood is measured, so its errors are inherited downstream.

The status is **contested**.

- **Default PCA is hard to beat at default settings.** Raimundo et al. benchmarked five pipelines (scran and Seurat PCA, ZINB-WaVE, DCA, scVI) with systematic parameter variation: the PCA-based pipelines were competitive at defaults and gained little from tuning, while ZINB-WaVE, DCA and scVI reached better performance only after tuning, and two automatic tuning strategies were proposed [R2]. Rankings therefore depend on the tuning budget.
- **Large comparisons exist but differ in design.** Sun et al. compared 18 methods on 30 public scRNA-seq datasets (GEO and the 10x Genomics website) and two simulated datasets, scoring neighbourhood preservation, clustering and lineage accuracy and robustness, and computational cost [R3].
- **Two-dimensional maps distort global structure.** Cluster sizes and between-cluster distances in t-SNE and UMAP carry little meaning [R4, R5]; the global layout depends on initialisation [R6]; the attraction-repulsion balance sets how much local structure is kept [R7].

Four questions are open. Whether PCA on log-normalised HVGs is near optimal once tuning budgets are matched, and whether count-likelihood models beat it [R1, R2]. The log-transform pseudocount and whether genes should be scaled to unit variance before PCA [R1]. Circularity: a clustering computed on an embedding and scored against labels favours that embedding, and the OpenProblems NMI keeps the clustering resolution that maximises NMI against the labels (section 8). The OpenProblems dimensionality-reduction task scores only two-dimensional embeddings, so $k$-dimensional scoring needs an extension (B1).

## 3. Theory and insight

**PCA.** With the thin SVD $X=U\Sigma V^\top$ of the column-centred masked layer $X\in\mathbb{R}^{n\times p}$, singular values $d_j$ and $\lambda_j=d_j^2/(n-1)$ the eigenvalues of $S=X^\top X/(n-1)$, the matrix $\hat X_k=U_k\Sigma_kV_k^\top$ minimises $\lVert X-Y\rVert_F^2$ over $\operatorname{rank}(Y)\le k$ [R8]. This holds for any $n$ and $p$ once $X$ is centred; without centring the first component encodes the mean. Estimands: cell scores $Y=U_k\Sigma_k$ (uncorrelated columns with variance $\lambda_j$, in units of the normalised layer); loadings $V_k$ (unit-norm columns); explained-variance ratio $\lambda_j/\sum_l\lambda_l$ over all eigenvalues of the masked layer. Signs are arbitrary and axes are not identifiable when eigenvalues tie. The log transform $\log(x/s+1)$ limits the dominance of highly expressed genes [R1] but leaves a mean-dependent variance at low counts, so the Gaussian reading of PCA on counts is approximate.

**Probabilistic PCA** adds a generative model, $x_i=Wz_i+\mu+\varepsilon_i$, $z_i\sim\mathcal N(0,I_k)$, $\varepsilon_i\sim\mathcal N(0,\sigma^2I_p)$, with maximum-likelihood noise variance $\hat\sigma^2=\frac1{p-k}\sum_{j>k}\lambda_j$ [R9]. The likelihood allows held-out log-likelihood to choose $k$. The regime is homoscedastic Gaussian residuals, which log-normalised counts violate (mean-dependent variance, excess zeros).

**Spiked covariance.** For a population covariance with one top eigenvalue $\ell$, all others equal to 1, and $p/n\to\gamma$, the leading sample eigenvector is asymptotically correlated with the true direction only if $\ell>1+\sqrt\gamma$ [R10]. The result is stated for complex Gaussian data with $n,p\to\infty$; here it is a guide to $k$ for real, heteroscedastic data, not a test.

**Factor analysis** has $\operatorname{Cov}(x)=WW^\top+\Psi$ with $\Psi$ diagonal, fitted in scikit-learn by an SVD-based EM-like iteration [R11]. Estimands: scores are the posterior mean $\mathbb E[z\mid x]$; loadings $W$; per-gene noise variance $\Psi_{jj}$ in squared units of the layer. Gene-specific noise is allowed; cell-specific depth effects are not.

**FastICA** maximises the negentropy approximation $J(w)\propto[\mathbb E\,G(w^\top x)-\mathbb E\,G(\nu)]^2$ with $G(u)=\log\cosh u$ and $\nu\sim\mathcal N(0,1)$, on whitened data [R12]. Sources are identifiable up to order, sign and scale when at most one is Gaussian; the fixed-point iteration finds a local optimum, so results depend on the seed. **Sparse PCA** adds an L1 penalty $\alpha$ on loadings [R13]; scikit-learn solves an L1-penalised low-rank factorisation by dictionary learning. No benchmark of it for cell embedding is cited here.

**Random projection** with $R_{ij}\sim\mathcal N(0,1/k)$ gives $(1-\varepsilon)\lVert u-v\rVert^2\le\lVert Ru-Rv\rVert^2\le(1+\varepsilon)\lVert u-v\rVert^2$ for all pairs among $n$ points with high probability once $k\ge4\ln n/(\varepsilon^2/2-\varepsilon^3/3)$ (the lemma [R14]; this form of the bound is the one implemented in scikit-learn). It preserves pairwise distances only; coordinates have no axis meaning.

**t-SNE** matches Gaussian input affinities to Student-t output affinities,
$$p_{j\mid i}=\frac{\exp(-\lVert x_i-x_j\rVert^2/2\sigma_i^2)}{\sum_{l\ne i}\exp(-\lVert x_i-x_l\rVert^2/2\sigma_i^2)},\quad p_{ij}=\frac{p_{j\mid i}+p_{i\mid j}}{2n},\quad q_{ij}=\frac{(1+\lVert y_i-y_j\rVert^2)^{-1}}{\sum_{l\ne m}(1+\lVert y_l-y_m\rVert^2)^{-1}},$$
minimising $\mathrm{KL}(P\Vert Q)$ [R15, R4]; $\sigma_i$ is set so that the perplexity of row $i$ equals the chosen value. The objective is non-convex, so the result depends on initialisation [R6].

**UMAP** forms directed memberships $w_{j\mid i}=\exp(-\max(0,d(x_i,x_j)-\rho_i)/\tau_i)$, with $\rho_i$ the nearest-neighbour distance and $\tau_i$ set by a local entropy condition, symmetrises them as $w_{ij}=w_{j\mid i}+w_{i\mid j}-w_{j\mid i}w_{i\mid j}$, and minimises the fuzzy cross-entropy against $q_{ij}=(1+a\lVert y_i-y_j\rVert^{2b})^{-1}$ by stochastic gradient descent with negative sampling [R16]. The parameters $a,b$ are fitted from `min_dist` (and `spread`). The regime is a fixed neighbour count and local structure.

**Diffusion maps** [R17] use a Gaussian kernel $K$, density normalisation $\tilde K=D^{-1}KD^{-1}$, the Markov matrix $P=\tilde D^{-1}\tilde K$ and coordinates $\Psi_t(x_i)=(\lambda_1^t\psi_1(x_i),\dots,\lambda_k^t\psi_k(x_i))$ with $\psi_j$ the right eigenvectors of $P$; the stationary eigenvector (eigenvalue 1) is constant. Haghverdi et al. applied them to single-cell differentiation data [R18]. scanpy builds the kernel from the kNN connectivity graph and returns the eigenvectors of the symmetric conjugate of $P$ without the factor $\lambda_j^t$ (source lines in section 4); the tool's `time` $=t$ reproduces this at $t=0$.

**Count-likelihood models.** With size factor $s_i$ and raw count $y_{ij}$ of mean $\mu_{ij}$, GLM-PCA fits $y_{ij}\sim\mathrm{Poisson}(\mu_{ij})$, $\log\mu_{ij}=\log s_i+\sum_{l=1}^{K}U_{il}V_{jl}$ by minimising the Poisson deviance $2\sum_{ij}[y_{ij}\log(y_{ij}/\mu_{ij})-(y_{ij}-\mu_{ij})]$; the Poisson form has no overdispersion parameter [R19]. scVI is an amortised variational autoencoder with a zero-inflated negative-binomial decoder, maximising $\mathbb E_{q(z\mid x)}[\log p(x\mid z)]-\mathrm{KL}(q(z\mid x)\Vert\mathcal N(0,I))$ [R20].

**Why heuristics work and what a model adds.** PCA on log-normalised HVGs follows the dominant programmes, the log transform limits depth-driven variance in the leading axes, and the computation is cheap, deterministic up to the solver and stable, which explains its use as the default [R1]. A likelihood-based model adds a common scale for choosing $k$ and comparing methods (held-out likelihood), a per-gene noise variance, library size as an explicit offset, and uncertainty by bootstrap or posterior; it costs tuning, rotational non-identifiability and sensitivity to the count distribution.

**Pitfalls shown by benchmarks.**

- Two-dimensional maps are not neighbourhood-faithful. On the best-practice chapter's example dataset, the fraction of input kNN-graph edges (15 neighbours) also present in the embedding's graph was 0.25 for t-SNE, 0.11 for UMAP and 0.03 for the first two PCs [R1]. A two-dimensional map is a visualisation, not a neighbourhood-preserving embedding.
- Tuning changes rankings, so tuned and default results must be reported separately [R2].
- Scaling each gene to unit variance gives low-expression genes the weight of high-expression genes; the literature has no consensus [R1].
- Methods that use the metric's own normalisation score higher; the OpenProblems task therefore fixes the input normalisation (section 8).

Cost: a full SVD is $O(np\min(n,p))$; a randomised truncated SVD [R21] with implicit centring costs $O(\mathrm{nnz}\cdot(k+r))$ per pass for $r$ oversampling columns.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| PCA (scanpy `pca`, Seurat `RunPCA`) | heuristic | Orthogonal projection onto the top-variance directions by truncated SVD of the centred matrix | [R8, R11] |
| denoisePCA (scran) | hybrid | Smallest $d$ such that the variance in the discarded PCs is below the technical variance from a fitted mean-variance trend, clamped to a rank range | — |
| FastICA (scikit-learn) | heuristic | Fixed-point search for directions of maximal non-Gaussianity (log-cosh negentropy) in whitened data | [R12] |
| Sparse PCA (scikit-learn) | heuristic | L1-penalised low-rank factorisation by dictionary learning | [R13] |
| Factor analysis (scikit-learn) | model-based | Gaussian latent-variable model with diagonal noise, SVD-based iteration | [R11] |
| Random projection (scikit-learn) | heuristic | Gaussian random matrix that preserves pairwise distances | [R14] |
| Diffusion map (scanpy `diffmap`) | heuristic | Eigenvectors of the density-normalised, symmetric transition matrix of the kNN connectivity graph | [R17, R18] |
| t-SNE (scanpy wrapper; OpenProblems `tsne`) | hybrid | KL divergence between Gaussian input and Student-t output affinities | [R15, R4] |
| UMAP (umap-learn) | hybrid | Fuzzy kNN graph and cross-entropy layout by stochastic gradient descent | [R16] |
| GLM-PCA | model-based | Low-rank log-linear predictor for counts fitted by deviance | [R19] |
| scVI (scvi-tools) | model-based | Variational autoencoder with a zero-inflated negative-binomial decoder (default `gene_likelihood="zinb"`), fitted by the ELBO | [R20] |

The published standard is PCA on log-normalised HVGs in scanpy and Seurat; for two-dimensional visualisation it is t-SNE or UMAP with the caveats of section 3. Count-likelihood models (GLM-PCA, scVI) are the model-based route for counts and are developed in sibling tasks (section 9); here they are comparators. Inputs for the methods singlet implements are the normalised matrix restricted to the HVG mask, centred per gene for PCA-type methods, with raw counts read only by denoisePCA.

Exact defaults, library settings and not claims about the best value (shas as in section 12):

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| PCA, scanpy | `n_comps` | 50, or min dimension − 1 if smaller | `src/scanpy/preprocessing/_pca/__init__.py:111,235` @ 8ed52d9 |
| PCA, scanpy | `zero_center`; `svd_solver` | True; None, i.e. `arpack` for centred numpy and scipy-sparse input | `_pca/__init__.py:64-65,89` @ 8ed52d9 |
| PCA, Seurat | `npcs`; `approx`; `seed.use` | 50; TRUE; 42 | `R/dimensional_reduction.R:951,959,958` @ 5f67c70 |
| ICA, Seurat | `nics`; `ica.function` | 50; `icafast` (ica package, not scikit-learn) | `R/dimensional_reduction.R:744,746` @ 5f67c70 |
| denoisePCA | `min.rank`; `max.rank` | 5; 50 (deprecated upstream in favour of `scrapper::runPca.se`) | `R/denoisePCA.R:157,160` @ 569d2f8 |
| FastICA | `algorithm`; `whiten`; `fun` | `parallel`; `unit-variance`; `logcosh` | `sklearn/decomposition/_fastica.py:184-186` @ 85593ca |
| FastICA | `max_iter`; `tol` | 200; 1e-4 | `_fastica.py:188-189` @ 85593ca |
| Sparse PCA | `alpha`; `ridge_alpha`; `max_iter`; `tol`; `method` | 1; 0.01; 1000; 1e-8; `lars` | `sklearn/decomposition/_sparse_pca.py:46-50` @ 85593ca |
| Factor analysis | `tol`; `max_iter` | 1e-2; 1000 | `sklearn/decomposition/_factor_analysis.py:176,178` @ 85593ca |
| Factor analysis | `svd_method`; `iterated_power` | `randomized`; 3 | `_factor_analysis.py:180-181` @ 85593ca |
| Random projection | `n_components`; `eps` | `auto`; 0.1 (minimum dimension from `johnson_lindenstrauss_min_dim`) | `sklearn/random_projection.py:63,145,330,332` @ 85593ca |
| Diffusion map, scanpy | `n_comps`; kernel | 15 (column 0 is the steady state; eigenvectors unscaled); `density_normalize=True` | `src/scanpy/tools/_diffmap.py:27,128`; `src/scanpy/neighbors/__init__.py:713` @ 8ed52d9 |
| kNN graph, scanpy | `n_neighbors` | 15 | `src/scanpy/neighbors/__init__.py:65` @ 8ed52d9 |
| UMAP, scanpy | `min_dist`; `init_pos` | 0.5; `spectral` | `src/scanpy/tools/_umap.py:37,44` @ 8ed52d9 |
| UMAP, umap-learn | `n_neighbors`; `init`; `min_dist` | 15; `spectral`; 0.1 | `umap/umap_.py:1752,1760,1761` @ 33d7e6f |
| UMAP, OpenProblems | estimator; `n_hvg` | `UMAP(densmap=False, random_state=42)`; 1000 | `src/methods/umap/script.py:34`; `config.vsh.yaml:36` @ 360499d |
| t-SNE, OpenProblems | `n_pca_dims` | 50 | `src/methods/tsne/config.vsh.yaml:46` @ 360499d |

## 5. Proposed singlet approach

- **Routes.** Port from scanpy and scikit-learn: PCA, FastICA, sparse PCA, factor analysis, random projection and the diffusion-map construction. Port the UMAP algorithm from umap-learn. Reimplement denoisePCA from its documented rule. t-SNE, GLM-PCA and scVI are callouts for the benchmarks; their model-based forms are developed in `dim-reduction.count_model_latent_factors` and `dim-reduction.deep_generative_latent_embedding`. Licences are in section 12.
- **Default.** `method = pca`, `n_components = 50`, `svd_solver = arpack`, `zero_center = true`, `layer = log1p_norm`, `use_hvg = true`, `seed = 42`. PCA is the default because it is the published standard and competitive at default settings [R2]; an alternative replaces it only by meeting the acceptance criteria of B1 and B2. The enum exposes `pca`, `denoise_pca`, `ica`, `sparse_pca`, `factor_analysis`, `random_projection`, `diffusion_map` and `umap`.
- **Model-based formulation.** Factor analysis is the in-tool model: an explicit Gaussian likelihood with per-gene noise variance and a held-out log-likelihood for choosing $k$. Falsifiers: **F1** on B2 (planted dimension $m=10$), the $k$ that maximises held-out log-likelihood on a 20% cell split falls between 5 and 20 in at least 4 of 5 seeds in every condition (proposed); **F2** on B1, factor analysis is not adopted over PCA unless it meets the B1 acceptance criterion. The count-likelihood model is the model-based comparator from its sibling task.
- **ML stack.** No deep network is used here. Sparse matrix products, the randomised range finder, the factor-analysis iterations and the UMAP optimiser are small, hot kernels hard-coded in CUDA and cuSPARSE; PyTorch is reserved for the autoencoder in `dim-reduction.deep_generative_latent_embedding`.
- **Kernels and devices.** Centring is applied as a rank-one correction inside the sparse product, so the matrix is never densified. The CPU path is the reference and CUDA must match it within floating-point tolerance. Float32 storage, float64 accumulation in reductions, seeded randomised solvers. UMAP and diffusion maps build their kNN graph in the core, exactly at small size and with `neighbors.approximate_knn_search` at larger sizes.
- **Streaming and training.** Version 1 is non-streaming; chunked covariance PCA belongs to `dim-reduction.scalable_truncated_svd`. Every method is fitted per dataset; no pre-trained resource is used.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/log1p_norm` (or the layer named by `layer`) | float32, sparse | normalised expression on the log scale |
| read | `var/highly_variable` | bool | HVG mask; required when `use_hvg` is true |
| read | `layers/counts` | integer, sparse | raw UMI counts; read only by `denoise_pca` |
| write | `obsm/X_pca`, `varm/PCs`, `uns/pca` | float32 $n\times k$, $g\times k$, dict | scores $U_k\Sigma_k$, unit-norm loadings (zero outside the mask), variance ratios; `denoise_pca` writes its first `d_selected` columns |
| write | `obsm/X_ica`, `varm/ica_loadings` | float32 | independent sources and gene-space unmixing matrix |
| write | `obsm/X_sparse_pca`, `varm/sparse_pca_loadings` | float32 | sparse scores and loadings |
| write | `obsm/X_fa`, `varm/fa_loadings`, `var/fa_noise_variance` | float32 | factor scores, loadings, per-gene noise variance (NaN outside the mask) |
| write | `obsm/X_rp` | float32 $n\times k$ | random projection $XR$ |
| write | `obsm/X_diffmap`, `uns/dr_diffusion_map/eigenvalues` | float32 | diffusion coordinates (column 0 is the steady state) and retained eigenvalues |
| write | `obsm/X_umap` | float32 $n\times k$ | UMAP layout; axes carry no scale |
| write | `uns/dr_<method>` | dict | settings, seed, convergence, runtime, `jl_min_dim` for random projection |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "log1p_norm" | — | Normalised layer under layers/ to embed. |
| `method` | string | "pca" | `pca`, `denoise_pca`, `ica`, `sparse_pca`, `factor_analysis`, `random_projection`, `diffusion_map`, `umap` | Embedding method; each value writes the members listed in the task document. |
| `n_components` | integer | 50 | min 2; max 200 | Embedding dimension k; ignored by denoise_pca, which uses options.denoise_pca.max_rank. |
| `use_hvg` | boolean | true | — | Restrict to var/highly_variable; the call fails if the mask is absent. |
| `options` | object | — | — | Method-specific options; each object applies only when method has the same name. |
| `options.pca` | object | — | — | Options for pca. |
| `options.pca.svd_solver` | string | "arpack" | `arpack`, `randomized`, `covariance_eigh` | SVD solver; arpack is exact, randomized is the scalable option. |
| `options.pca.zero_center` | boolean | true | — | Centre each gene before the decomposition. |
| `options.denoise_pca` | object | — | — | Options for denoise_pca. |
| `options.denoise_pca.count_layer` | string | "counts" | — | Raw-count layer used to fit the technical variance trend. |
| `options.denoise_pca.min_rank` | integer | 5 | min 1; max 200 | Lower bound on the number of PCs kept. |
| `options.denoise_pca.max_rank` | integer | 50 | min 1; max 200 | Upper bound on the PCs computed and considered. |
| `options.ica` | object | — | — | Options for ica (FastICA). |
| `options.ica.fun` | string | "logcosh" | `logcosh`, `exp`, `cube` | Non-quadratic contrast function. |
| `options.ica.max_iter` | integer | 200 | min 1; max 10000 | Maximum fixed-point iterations. |
| `options.sparse_pca` | object | — | — | Options for sparse_pca. |
| `options.sparse_pca.alpha` | number | 1 | > 0 | L1 penalty on loadings; larger gives sparser loadings. |
| `options.sparse_pca.ridge_alpha` | number | 0.01 | min 0 | Ridge shrinkage applied when projecting cells onto the components. |
| `options.factor_analysis` | object | — | — | Options for factor_analysis. |
| `options.factor_analysis.max_iter` | integer | 1000 | min 1; max 100000 | Maximum iterations. |
| `options.factor_analysis.tol` | number | 0.01 | > 0 | Convergence tolerance on the log-likelihood. |
| `options.random_projection` | object | — | — | Options for random_projection. |
| `options.random_projection.eps` | number | 0.1 | > 0; < 1 | Distortion tolerance used only to report the Johnson-Lindenstrauss minimum dimension. |
| `options.diffusion_map` | object | — | — | Options for diffusion_map. |
| `options.diffusion_map.n_neighbors` | integer | 15 | min 2; max 500 | Neighbours of the kNN connectivity graph. |
| `options.diffusion_map.time` | number | 0 | min 0 | Diffusion time t scaling coordinate j by its eigenvalue to the power t; 0 gives unscaled eigenvectors as in scanpy. |
| `options.umap` | object | — | — | Options for umap. |
| `options.umap.n_neighbors` | integer | 15 | min 2; max 500 | Neighbours of the kNN graph. |
| `options.umap.min_dist` | number | 0.5 | min 0; max 1 | Minimum distance in the layout; sets the kernel parameters a and b. |
| `options.umap.init` | string | "spectral" | `spectral`, `random`, `pca` | Initial layout; pca uses the first n_components PCA scores. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 42 | min 0 | Random seed for randomised solvers, ICA and factor-analysis starts, random projection and UMAP. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters. `options.<method>` applies only when `method` has that name. `n_components` is ignored by `denoise_pca`, which keeps between `min_rank` and `max_rank` PCs. The call fails, naming the parameter, if `use_hvg` is true and the mask is absent, if `min_rank` exceeds `max_rank`, or if `n_components` exceeds the available components. `umap` and `diffusion_map` use the masked matrix, not PCA scores (section 10). `options.random_projection.eps` only sets the reported `jl_min_dim`; the projected dimension is `n_components`. t-SNE, GLM-PCA and scVI are not accepted as `method`.

## 7. MCP tool

Tool name `singlet_dim_reduction_normalized_cell_embedding` (definition in `tasks/mcp/singlet_dim_reduction_normalized_cell_embedding.json`). Example call and compact result (format only; values are placeholders):

```json
{"dataset": "/data/example.singlet", "method": "pca", "n_components": 50, "options": {"pca": {"svd_solver": "arpack"}}, "seed": 42}
```

```json
{
  "dataset": "/data/example.singlet", "status": "completed",
  "wrote": ["obsm/X_pca", "varm/PCs", "uns/pca", "uns/dr_pca"],
  "summary": {"method": "pca", "embedding_key": "obsm/X_pca", "n_components": 50,
              "explained_variance_ratio_head": [0.12, 0.06, 0.04], "device_used": "cpu"},
  "provenance_id": "prov_0001"
}
```

Long-running: returns `queued` with a `job_id` when the dry-run estimate exceeds the runtime's inline limit. Stochastic: `seed` fixes the randomised solvers, ICA and factor-analysis starts, random projection and UMAP; the same seed on the same device gives the same members. Dry-run: `seconds`, `peak_memory_gb` and `device` from $n$, $p$, $k$ and the method, reading only the shape and nonzero count.

## 8. Benchmarks

**Shared protocol.** Input is the log-10k normalised matrix (`layers/log1p_norm`), as the OpenProblems contract requires, restricted to the HVG mask where a method uses it. Dimensions are $k\in\{2,10,20,30,50\}$; t-SNE is scored at $k=2$ only. Stochastic methods use seeds 1 to 5 (mean reported); single-seed steps use 42. Paired intervals are the 2.5th and 97.5th percentiles over 50 random 80% subsamples of cells (proposed). Defaults and tuned settings are reported separately, with equal numbers of configurations per method. NMI and ARI follow OpenProblems: Leiden clustering of the 15-nearest-neighbour graph of the embedding at resolutions 0.1 to 2.0 in steps of 0.1, keeping the resolution with the highest NMI against the labels and reporting ARI there. Thresholds marked proposed are singlet design choices. Hardware is recorded.

### B1. OpenProblems dimensionality-reduction metrics extended to $k$ dimensions

- **Goal**: score the embeddings of section 4 on neighbourhood preservation, density preservation, distance correlation and cluster agreement with cell types at several $k$, extending the two-dimensional OpenProblems task (section 12).
- **Ground truth**: expert `cell_type` labels for NMI and ARI; for every other metric the reference is the input geometry, the log-10k normalised matrix (`layers["normalized"]`). Distances are Euclidean among waypoint cells (all cells, or 50,000 random cells when there are more), in the input and in the embedding.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| `cxg_mouse_pancreas_atlas` (OpenProblems test resource) | OpenProblems task repository (section 12), `resources_test/common/cxg_mouse_pancreas_atlas/dataset.h5ad` | scRNA-seq; the name indicates a CELLxGENE mouse pancreas atlas | — | layers `counts` and `normalized`; labels in `obs["cell_type"]` |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| NMI | $I(C;L)/\tfrac12\big(H(C)+H(L)\big)$ between the Leiden clusters $C$ of the embedding and the labels $L$; arithmetic-mean normalisation; range 0 to 1 | higher | primary | — |
| ARI | chance-corrected pair-counting agreement of $C$ and $L$ at the same resolution; 0 at chance, 1 if identical | higher | primary | — |
| Trustworthiness and continuity at $K=30$ | $T(K)=1-\frac{2}{nK(2n-3K-1)}\sum_i\sum_{j\in U_K(i)}(r(i,j)-K)$, with $U_K(i)$ the embedding's $K$ nearest neighbours of $i$ absent from the input's and $r(i,j)$ the input rank; $C(K)$ swaps the spaces; on the co-ranking matrix of waypoint distances; $K<n/2$; range 0 to 1 | higher | primary | [R22] |
| QNX and LCMC at $K=30$; mean of the QNX curve | $Q_{NX}(K)$ is the mean overlap of the $K$-neighbourhoods in input and embedding; $\mathrm{LCMC}(K)=Q_{NX}(K)-K/(n-1)$ is zero at chance; the curve mean averages $Q_{NX}(K)$ over all $K$ | higher | primary | [R23, R24] |
| Density preservation | Pearson correlation between input and embedding of $\rho_i=\log\big(10^{-8}+\sum_j\mu_{ij}d_{ij}/\sum_j\mu_{ij}\big)$, with $\mu_{ij}$ UMAP fuzzy-set memberships for 30 neighbours and $d_{ij}$ Euclidean distances; seed 42; range −1 to 1 | higher | primary | [R25] |
| Distance correlations (waypoint, centroid, label) | Spearman correlation between input and embedding of waypoint-waypoint, waypoint-centroid and centroid-centroid distances; range −1 to 1 | higher | guardrail | — |

- **Comparators**: singlet `pca`, `ica`, `sparse_pca`, `factor_analysis`, `random_projection`, `diffusion_map` and `umap` at every $k$; the OpenProblems `pca`, `umap` (umap-learn defaults) and `tsne` (50 PCs) methods at $k=2$, run from their repository.
- **Acceptance criterion** (proposed): at each $k\in\{10,20,30,50\}$ a candidate is accepted as an alternative to the PCA default only if the lower end of the paired interval of (candidate − PCA) is at least −0.02 for NMI, for ARI and for the mean of trustworthiness, continuity and QNX at $K=30$. A superiority claim needs a lower end above 0.
- **Known pitfalls**: NMI and ARI use the best of 20 resolutions chosen with the labels, so they are optimistic and only comparable across methods. One dataset gives no between-dataset variance (section 10).

### B2. Proposed: planted branching lineage with known truth

- **Goal**: measure recovery of a planted lineage and of input neighbourhoods across noise and dropout levels, and test F1 (section 5); no published benchmark defines this test.
- **Ground truth**: planted by construction and never recomputed from an embedding: the segment label of each cell (five segments), its pseudotime $t_i\in[0,1]$ (distance from the root along the tree divided by the root-to-tip length) and the latent dimension $m=10$.
- **Generator G1** (all constants proposed):
  1. Sample a rooted tree: the root segment splits into A and B, and B into C and D (five segments, three tips); $t_i\sim\mathrm U(0,1)$ along each cell's path.
  2. Latent $z_i\in\mathbb{R}^{10}$: each segment is a straight line with a random unit direction, joined at branch points, plus Gaussian jitter of standard deviation $\tau\in\{0.1,0.4\}$ (low, high noise).
  3. $\mu_{ig}=s_i\exp(a_g+\sum_lW_{gl}z_{il})$ for 2,000 genes, $a_g\sim\mathcal N(-1,1)$, three random latent dimensions per gene with $W_{gl}\sim0.5\,\mathcal N(0,1)$, $\log s_i\sim\mathcal N(0,0.5^2)$.
  4. $y_{ig}\sim\mathrm{ZINB}(\mu_{ig},\theta=5,\pi_{ig})$ with $\pi_{ig}=\operatorname{logistic}(\beta_0-\log\mu_{ig})$, $\beta_0\in\{-1,1\}$ (low, high dropout).
  5. 5,000 cells, four conditions ($\tau\times\beta_0$), seeds 1 to 5; log-10k normalisation, all genes kept.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G1 simulation, 4 conditions × 5 seeds | generated by singlet from G1; no accession | simulated scRNA-seq counts, 5,000 cells, 2,000 genes (proposed) | not applicable | no compared method is the generating model |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| kNN preservation $R_K$, $K\in\{15,30\}$ | $R_K=\frac1n\sum_i\lvert\mathcal N^{\mathrm{in}}_K(i)\cap\mathcal N^{\mathrm{emb}}_K(i)\rvert/K$, neighbours by Euclidean distance in the normalised matrix and in the embedding; range 0 to 1 | higher | primary | [R23] |
| ARI against planted segments | ARI between $k$-means ($k=5$, seed 42) clusters of the embedding and the planted segment labels; 0 at chance | higher | primary | — |
| Pseudotime Spearman | Spearman correlation between planted $t_i$ and the max-normalised geodesic distance from the planted root (smallest $t_i$) on the 15-nearest-neighbour graph of the embedding; range −1 to 1 | higher | guardrail | — |
| Selected dimension $\hat k$ | the $k\in\{2,5,10,20,30,50\}$ that maximises the Gaussian log-likelihood of factor analysis on 20% held-out cells | — | primary for F1 | — |

- **Comparators**: singlet `pca`, `factor_analysis`, `ica`, `diffusion_map` and `umap` at every $k$; OpenProblems `tsne` at $k=2$.
- **Acceptance criterion** (proposed): F1 holds (section 5); and a method is recommended for lineage use only if, at $\tau=0.4$ averaged over seeds and dropout levels, its planted ARI exceeds that of PCA by at least 0.05 and its $R_{30}$ is not more than 0.02 below PCA's.
- **Known pitfalls**: a simulation favours the family that resembles its generator, so count-aware methods may gain; the pseudotime score depends on the graph built on the embedding.

### P1. Performance and scaling

- **Metrics**

| Metric | Definition | Direction |
|---|---|---|
| Wall-clock time | time to produce the embedding, excluding I/O | lower |
| Peak resident memory | maximum resident set size during the call | lower |
| Maximum principal angle | $\theta_{\max}=\arccos\sigma_{\min}(V_1^\top V_2)$ for orthonormal bases $V_1,V_2$ of the approximate and exact $k$-dimensional loading subspaces, in radians | lower |
| Explained-variance gap | $\Delta_k=\rho_k^{\mathrm{exact}}-\rho_k^{\mathrm{approx}}$, $\rho_k=\operatorname{tr}(V_k^\top SV_k)/\operatorname{tr}(S)$ for orthonormal loadings $V_k$ and the sample covariance $S$ of the masked layer | lower |

- **Scales**: $n\in\{10^4,10^5,10^6\}$ cells from the G1 generator, $p=2{,}000$ genes, $k\in\{10,50\}$, CPU and CUDA. The exact reference is the eigendecomposition of the $p\times p$ covariance accumulated in float64, which is feasible at every $n$ because $p\le2{,}000$.
- **Comparators**: scanpy `pca` with `arpack`, `covariance_eigh` and `randomized` (scanpy documents efficient sparse PCA only for the first two), scikit-learn `TruncatedSVD` (uncentred), Seurat `RunPCA` with `approx = TRUE`, umap-learn, and singlet on CPU and CUDA.
- **Held fixed**: HVG set, log-10k normalisation, float32, $k$, seed 42, thread count and hardware.
- **Acceptance criterion** (proposed): the randomised solver reaches $\Delta_{50}\le0.01$ against the exact reference; singlet CPU and CUDA loading subspaces agree within $\theta_{\max}\le10^{-3}$ rad; the CUDA path is adopted only where it is faster than the CPU path on the same inputs. The principal angle of other solvers is reported without a threshold.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `covariate-adjustment.gene_scaling_and_clipping`: Gene scaling, centering and clipping before PCA
- **Feeds**:
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `embedding-viz.local_neighborhood_preservation`: Local neighbourhood preservation of an embedding or reduced representation
- **Reads**: `layers/log1p_norm`, `var/highly_variable`, `layers/counts`
- **Writes**: `obsm/X_pca`, `varm/PCs`, `uns/pca`, `obsm/X_ica`, `varm/ica_loadings`, `obsm/X_sparse_pca`, `varm/sparse_pca_loadings`, `obsm/X_fa`, `varm/fa_loadings`, `var/fa_noise_variance`, `obsm/X_rp`, `obsm/X_diffmap`, `uns/dr_diffusion_map/eigenvalues`, `obsm/X_umap`, `uns/dr_<method>`
<!-- CHAINING:AUTO:END -->

Named workflow: normalisation, HVG selection, this embedding, neighbour graph, clustering and visualisation [R1]. Related: `dim-reduction.count_model_latent_factors`, `dim-reduction.deep_generative_latent_embedding`, `dim-reduction.scalable_truncated_svd`.

## 10. Risks, pitfalls and open questions

- **Published benchmarks not reproduced.** Sun et al. [R3] (30 public datasets, two simulated datasets, lineage and robustness definitions) and Raimundo et al. [R2] (five pipelines, two tuning strategies, the dataset list) define the established protocols. Their dataset lists, accessions and truth definitions are not recorded here, so neither is a numbered benchmark; their findings enter as context only.
- **Theory sources.** Probabilistic PCA, the spiked-covariance threshold, sparse PCA and Johnson-Lindenstrauss are cited from memory (R9, R10, R13, R14) and FastICA from the scikit-learn source (R12); none has a verified DOI. The constants in section 3 should be checked against the sources before they appear in code comments. The spiked threshold is proved for complex Gaussian data; its use on real data is a guide.
- **B1 data and first experiment.** Size, accession and licence of `cxg_mouse_pancreas_atlas` are not recorded, and one dataset cannot show between-dataset variance. First experiment: add annotated catalogue studies split by study, run B1 for `pca`, `factor_analysis` and `ica` at all $k$ to test F2, and run G1 to test F1 and to calibrate its constants against the library size and dropout rate of 10x-type data.
- **Unsettled choices.** Whether `umap` and `diffusion_map` should run on the masked matrix (as the OpenProblems UMAP method does) or on PCA scores; whether to scale genes before PCA (left to `covariate-adjustment.gene_scaling_and_clipping`, default none); the pseudocount of the log transform.
- **Reference status.** OpenProblems cites Emmons et al. 2016 (doi:10.1371/journal.pone.0159161), a network-clustering paper, for NMI; it is not an NMI definition, so NMI is defined by the formula in B1. The distance-correlation metrics have no reference that resolves in the local corpus. The original publication of the scran denoising rule was not found, and `denoisePCA` is deprecated upstream.
- **Thresholds.** Every acceptance threshold marked proposed and every G1 constant is a singlet design choice without a published source.

## 11. References

R1. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)

R2. Raimundo F, Vallot C, Vert JP. Tuning parameters of dimensionality reduction methods for single-cell RNA-seq analysis. *Genome Biology* 2020;21:212. doi:10.1186/s13059-020-02128-7 — verified (search)

R3. Sun S, Zhu J, Ma Y, Zhou X. Accuracy, robustness and scalability of dimensionality reduction methods for single-cell RNA-seq analysis. *Genome Biology* 2019;20:269. doi:10.1186/s13059-019-1898-6 — verified (search)

R4. Kobak D, Berens P. The art of using t-SNE for single-cell transcriptomics. *Nature Communications* 2019. doi:10.1038/s41467-019-13056-x — verified (corpus)

R5. Chari T, Pachter L. The specious art of single-cell genomics. *PLOS Computational Biology* 2023. doi:10.1371/journal.pcbi.1011288 — verified (corpus)

R6. Kobak D, Linderman GC. Initialization is critical for preserving global data structure in both t-SNE and UMAP. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00809-z — verified (corpus)

R7. Böhm JN, Berens P, Kobak D. Attraction-Repulsion Spectrum in Neighbor Embeddings. *Journal of Machine Learning Research* 2022. — verified (corpus)

R8. Pearson K. On lines and planes of closest fit to systems of points in space. *The London, Edinburgh, and Dublin Philosophical Magazine and Journal of Science* 1901. doi:10.1080/14786440109462720 — verified (corpus)

R9. Tipping ME, Bishop CM. Probabilistic principal component analysis. *Journal of the Royal Statistical Society: Series B* 1999. — unverified (memory)

R10. Baik J, Ben Arous G, Péché S. Phase transition of the largest eigenvalue for nonnull complex sample covariance matrices. *Annals of Probability* 2005. — unverified (memory)

R11. Pedregosa F, Varoquaux G, Gramfort A, et al. Scikit-learn: Machine Learning in Python. *Journal of Machine Learning Research* 2011. — verified (corpus)

R12. Hyvärinen A, Oja E. Independent component analysis: algorithms and applications. *Neural Networks* 2000;13(4-5):411-430. — partial (repo)

R13. Zou H, Hastie T, Tibshirani R. Sparse principal component analysis. *Journal of Computational and Graphical Statistics* 2006. — unverified (memory)

R14. Johnson WB, Lindenstrauss J. Extensions of Lipschitz mappings into a Hilbert space. *Contemporary Mathematics* 1984;26. — unverified (memory)

R15. van der Maaten L, Hinton G. Visualizing Data using t-SNE. *Journal of Machine Learning Research* 2008. — verified (corpus)

R16. McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction. *arXiv* 2018. doi:10.48550/arxiv.1802.03426 — verified (corpus)

R17. Coifman RR, Lafon S. Diffusion maps. *Applied and Computational Harmonic Analysis* 2006. doi:10.1016/j.acha.2006.04.006 — verified (corpus)

R18. Haghverdi L, Buettner F, Theis FJ. Diffusion maps for high-dimensional single-cell analysis of differentiation data. *Bioinformatics* 2015. doi:10.1093/bioinformatics/btv325 — verified (corpus)

R19. Townes FW, Hicks SC, Aryee MJ, et al. Feature selection and dimension reduction for single-cell RNA-Seq based on a multinomial model. *Genome Biology* 2019. doi:10.1186/s13059-019-1861-6 — verified (corpus)

R20. Lopez R, Regier J, Cole MB, et al. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)

R21. Halko N, Martinsson PG, Tropp JA. Finding structure with randomness: Probabilistic algorithms for constructing approximate matrix decompositions. *arXiv* 2009. doi:10.48550/arxiv.0909.4061 — verified (corpus)

R22. Venna J, Kaski S. Local multidimensional scaling. *Neural Networks* 2006. doi:10.1016/j.neunet.2006.05.014 — verified (corpus)

R23. Lee JA, Verleysen M. Quality assessment of dimensionality reduction: Rank-based criteria. *Neurocomputing* 2009. doi:10.1016/j.neucom.2008.12.017 — verified (corpus)

R24. Chen L, Buja A. Local Multidimensional Scaling for Nonlinear Dimension Reduction, Graph Drawing, and Proximity Analysis. *Journal of the American Statistical Association* 2009. doi:10.1198/jasa.2009.0111 — verified (corpus)

R25. Narayan A, Berger B, Cho H. Assessing single-cell transcriptomic variability through density-preserving data visualization. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00801-7 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | scverse (copyright 2025); F. Alexander Wolf, P. Angerer, Theis Lab (copyright 2017); maintainers in pyproject.toml | BSD-3-Clause (LICENSE; pyproject) | PCA, diffusion map, t-SNE and UMAP wrappers; defaults at 8ed52d9 | port (PCA, diffusion map); callout (t-SNE) |
| https://github.com/satijalab/seurat | Seurat authors (LICENSE copyright holder); DESCRIPTION Authors@R | MIT + file LICENSE (DESCRIPTION) | `RunPCA` and `RunICA` defaults at 5f67c70; comparator | callout |
| https://github.com/MarioniLab/scran | Aaron Lun (aut, cre), Karsten Bach (aut), Jong Kyoung Kim (ctb), Antonio Scialdone (ctb) (DESCRIPTION) | GPL-3 (DESCRIPTION) | `denoisePCA` rule and rank defaults at 569d2f8 | reimplement from the documented rule |
| https://github.com/scikit-learn/scikit-learn | The scikit-learn developers (COPYING) | BSD-3-Clause (COPYING; pyproject) | FastICA, sparse PCA, factor analysis, random projection; defaults at 85593ca | port |
| https://github.com/lmcinnes/umap | Leland McInnes (LICENSE.txt copyright) | BSD 3-Clause (LICENSE.txt) | UMAP algorithm and defaults at 33d7e6f (version 0.5.12) | port; comparator |
| https://github.com/willtownes/glmpca | F. William Townes (DESCRIPTION Authors@R) | LGPL (>= 3) (DESCRIPTION) | GLM-PCA comparator | callout; reimplement the model in `dim-reduction.count_model_latent_factors` |
| https://github.com/scverse/scvi-tools | Yosef Lab, Weizmann Institute of Science (LICENSE copyright) | BSD-3-Clause (LICENSE; pyproject) | scVI comparator | callout |
| https://github.com/openproblems-bio/task_dimensionality_reduction | Open Problems in Single-Cell Analysis (LICENSE copyright 2024); README lists Luke Zappia (maintainer, author) and other authors | MIT (LICENSE) | B1 metric definitions, example dataset, comparators at 360499d | port (metric definitions); callout (comparators) |
