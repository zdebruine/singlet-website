---
id: spatial-genes.svg_detection
title: Spatially variable gene detection
area: spatial-genes
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [spatial-preproc.spatial_unit_qc_filtering, spatial-preproc.spatial_depth_normalization]
feeds: [spatial-genes.expression_pattern_classification, spatial-genes.celltype_specific_spatial_variation, spatial-domains.single_slice_domains]
reads: [layers/counts, layers/normalized, obsm/spatial, obs/total_counts, obsp/spatial_connectivities]
writes: [var/svg_score, var/svg_pvalue, var/svg_qvalue, var/svg_rank, var/svg_lengthscale, obsp/svg_graph, uns/svg_params]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_genes_svg_detection
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Spatially variable gene detection

> Tests each gene for expression that varies more smoothly across tissue coordinates than a spatially shuffled null allows, and returns a score, p-value, FDR q-value and rank per gene. The published standards are Gaussian-process, kernel and autocorrelation tests; the proposed singlet route is a count-likelihood test that must meet a shuffled-null calibration check before it becomes a default.

## 1. Question

Given one spatial section of $n$ units (spots, bins or cells) at coordinates $S\in\mathbb{R}^{n\times 2}$ with counts $X\in\mathbb{Z}_{\ge 0}^{n\times G}$, which genes vary non-randomly across $S$ after library size is accounted for, and with what calibrated p-value and rank? The inputs are `layers/counts` and `obsm/spatial`, with normalised expression and a neighbour graph optional. The outputs are a score, p-value, FDR q-value and rank per gene, plus a lengthscale for kernel methods. A correct answer calls a gene when its expression is a smooth function of location, or of neighbourhood similarity, that a spatially shuffled null would rarely produce, and when p-values are close to uniform under that null.

## 2. Why this task matters and where the field stands

Spatially variable gene (SVG) detection decides which genes are worth following on a tissue section. Its output selects features for spatial domain analysis and supplies gene sets for pattern classification. The status is **contested**. Methods disagree on which genes they call, and gene counts reported for the same tissue differ by one to two orders of magnitude between packages [R15]. Benchmark winners also differ between versions: the 2023 preprint reported SpatialDE2 as best [R13], while the 2025 published benchmark reports SPARK-X as best and Moran's I as competitive in both [R14]. The open problems are:

- **Calibration.** Most methods in the 2025 benchmark are poorly calibrated [R14], and the chi-square reference of the SpatialDE likelihood-ratio test is an approximation [R1].
- **Composition.** A gene that follows cell-type proportions can be called spatially variable without spatial organisation inside a type. No reviewed benchmark measures this for most tools.
- **Scale.** Dense Gaussian-process inference costs $O(n^3)$ per lengthscale, so single-cell and imaging sections need nearest-neighbour or low-rank approximations [R4].
- **Simulation truth.** Planted truth built from a Gaussian-process fit can favour Gaussian-process tests [R16].

## 3. Theory and insight

Symbols: $n$ units, $G$ genes, $x_i$ the value of one gene in unit $i$ after the stated normalisation, $\bar x$ its mean, $s_i$ the coordinates of unit $i$, and $w_{ij}\ge 0$ the spatial weights with $S_0=\sum_{i,j}w_{ij}$.

**Autocorrelation statistics.** With $z_i=x_i-\bar x$,
$$I=\frac{n}{S_0}\,\frac{\sum_{i,j}w_{ij}z_iz_j}{\sum_i z_i^2},\qquad C=\frac{(n-1)\sum_{i,j}w_{ij}(x_i-x_j)^2}{2S_0\sum_i z_i^2}.$$
$I$ is a weighted correlation between a gene and its graph neighbours, and $C$ is a neighbour-difference ratio. Both are invariant to the scale of $x$ but not to the scale of $w$: row standardisation changes them, so values are comparable only on one graph and weight normalisation. Under no spatial structure $E_0[I]=-1/(n-1)$ and $E_0[C]=1$. The analytic variance uses the Cliff and Ord moments [R8],
$$\mathrm{Var}_N(I)=\frac{n^2S_1-nS_2+3S_0^2}{(n-1)(n+1)S_0^2}-\frac{1}{(n-1)^2},$$
with $S_1=\tfrac12\sum_{i,j}(w_{ij}+w_{ji})^2$ and $S_2=\sum_i\big(\sum_j w_{ij}+\sum_j w_{ji}\big)^2$. A p-value follows from the normal distribution. The regime is large $n$ with approximately normal randomisation. For sparse or skewed genes, permutation p-values over the same graph are needed.

**Gaussian-process variance decomposition (SpatialDE).** After stabilisation and regression on log library size, a gene is modelled as
$$y\sim\mathcal{N}\!\big(\mu\mathbf{1},\,\sigma_t^2(G_\ell K_\ell+\delta I)\big),\qquad K_\ell(i,j)=\exp\!\Big(-\frac{\lVert s_i-s_j\rVert^2}{2\ell^2}\Big),$$
where $G_\ell$ is the Gower normalising factor of $K_\ell$ and $\delta$ is the noise-to-spatial ratio. The effect size is the fraction of spatial variance,
$$\mathrm{FSV}=\frac{G_\ell}{G_\ell+\delta}\in[0,1],$$
evaluated at the maximum-likelihood $\ell$ and $\delta$. Because $\sigma_t^2$ cancels, FSV is a share of the modelled variance, not of raw counts. The test compares the best lengthscale with a constant mean,
$$\mathrm{LLR}=\max_{\ell}\,\ell_\ell(\hat\theta)-\ell_{\mathrm{const}}(\hat\theta_0),\qquad p=1-F_{\chi^2_1}(\mathrm{LLR}),$$
and q-values follow Storey and Tibshirani [R9]. The null sets $\sigma_s^2=0$, which is a boundary of the parameter space. For one boundary-constrained variance component the null law is $\tfrac12\chi^2_0+\tfrac12\chi^2_1$, which makes the $\chi^2_1$ reference conservative. The maximum over lengthscales works the other way, so the net direction of miscalibration is an empirical question for B3. The regime is asymptotic in $n$.

**Kernel and mixed-model tests (SPARK, SPARK-X).** SPARK models counts with a Poisson or negative-binomial mixed model, $\log\mu_i=\log\mathrm{lib}_i+x_i^\top\beta+b_i$ with $b\sim\mathcal{N}(0,\tau K)$, and tests $\tau=0$ for each kernel $K$ [R2]. The per-kernel p-values $p_k$ are combined by the Cauchy rule,
$$T=\frac1K\sum_{k=1}^K\tan\!\big((\tfrac12-p_k)\pi\big),\qquad p=1-F_{\mathrm{Cauchy}}(T),$$
which is valid under arbitrary dependence [R10]. The rule is a tail approximation designed for small p-values, and the code's floor and cap (Section 4) create ties at the extremes. The combined p-values are then BY-adjusted,
$$q_{(i)}=\min_{j\ge i}\frac{m\,c(m)}{j}\,p_{(j)},\qquad c(m)=\sum_{k=1}^m\frac1k,$$
which controls FDR under arbitrary dependence [R11] at a cost in power relative to BH [R12].

**Calibration references.** Each statistic has its own null: normal moments for Moran's I, a $\chi^2_1$ law for SpatialDE, a Cauchy law for combined kernel tests, and permutations of values over the fixed graph otherwise. A permutation p-value cannot be smaller than $1/(n_{\mathrm{perm}}+1)$.

**Estimands.** Each quantity is defined once here.

- Score: the oriented statistic, with larger meaning more spatial. It is $I$, $C$, FSV, the LR statistic or $-\log_{10}$ of the adjusted p-value, depending on the method. Scales differ, so only ranks are compared across methods.
- p-value and q-value: a per-gene tail probability under the method's null, and its FDR-adjusted value across genes.
- Lengthscale: $\ell$ in the units of `obsm/spatial`.
- Planted $\alpha_g\in[0,1]$ (B1, B2): the weight of the spatial component in the simulated mean of gene $g$. The evaluated quantity is the rank order of $\alpha$ within each gene family.
- Kendall tau-b (B1, B2) [R17]: $\tau_b=(C-D)/\sqrt{(n_0-n_1)(n_0-n_2)}$, where $C$ and $D$ count concordant and discordant pairs, $n_0$ is the number of pairs, and $n_1$, $n_2$ count ties in each variable.
- Average precision (B2): $\mathrm{AP}=\sum_k (R_k-R_{k-1})P_k$ over the ranked genes, with label $\alpha>0$. Its chance level is the prevalence.
- Null calibration (B3): $\lambda_{\mathrm{GC}}=\mathrm{median}\big(F^{-1}_{\chi^2_1}(1-p)\big)/0.4549$, where $0.4549$ is the median of $\chi^2_1$. The rejection rate is the fraction of genes with $p<0.05$.
- Expert labels (B4): the adjusted Rand index between clusters and manual domains, which is invariant to relabelling.

**Assumptions and failure modes.** Coordinates are accurate and sections share one frame, or section effects are modelled. Spatial signal is a smooth field or neighbourhood similarity, and squared-exponential kernels blur sharp layer boundaries. After library-size handling the test's likelihood describes the counts, with library size entering as an offset, a regressor or a size factor. Under spatial shuffling, units are exchangeable. The failure modes are:

- Composition confounding: genes that track cell-type proportions are called spatially variable.
- Technical gradients: edge effects, capture gradients and tissue folds produce variance that is not biological.
- Miscalibration: boundary and maximum effects in the Gaussian-process tests, and penalised quasi-likelihood accuracy at low counts in the mixed-model tests.
- Sparse genes: the normal approximation fails for Moran's I, and ties and floors dominate ranks.
- Graph choice: kNN, Delaunay and radius graphs change Moran and Geary scores, and sometimes their order.
- Pooled sections without section effects inflate or mask variance.
- Single-cell resolution: sparse neighbourhoods and dropout dominate counts per unit.

**Why heuristics work, and what a model adds.** Moran's I and Geary's C need one sparse product per gene and have closed-form moments, and they are competitive in both benchmark versions [R13, R14]. A likelihood model adds an effect size with a scale (FSV, lengthscale), a test whose null can be checked by simulation, and a fitted per-gene model that other tasks can reuse. Calibration, not power, is the least solved axis [R14].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| SpatialDE | model-based | Per-gene squared-exponential Gaussian process over a lengthscale grid, with the FSV effect size and a likelihood-ratio test against a constant mean. | [R1] |
| SPARK | model-based | Per-gene Poisson or negative-binomial mixed model with a library offset and kernel random effects; per-kernel tests combined by the Cauchy rule. | [R2] |
| SPARK-X | model-based | Eleven kernel covariance tests on coordinate transforms, combined by the ACAT rule and BY-adjusted. | [R3] |
| nnSVG | model-based | Per-gene nearest-neighbour Gaussian process fitted with BRISC, ranked by a likelihood-ratio statistic with a gene-specific spatial decay parameter. | [R4], [R18] |
| Moran's I | heuristic | Global weighted correlation of a gene with its graph neighbours, with an analytic normal or permutation p-value. | [R5], [R6] |
| Geary's C | heuristic | Neighbour-difference ratio computed by the same squidpy function as Moran's I. | [R5], [R7] |

The published standards are SpatialDE [R1] and the SPARK family [R2, R3] for model-based tests, and Moran's I [R5] for the heuristic baseline with a closed-form null. nnSVG [R4] is the scalable Gaussian-process option. Methods outside this table appear only as benchmark comparators in Section 8.

Exact defaults of the reference implementations, with their source locations:

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| SpatialDE | Expression preprocessing | Stabilise with NaiveDE, then regress out log total counts | openproblems-bio task_spatially_variable_genes src/methods/spatialde/script.py @0d69e53; pinellolab SVG_Benchmarking snakemake_simulate_data/methods/run_SpatialDE.py @3157900 |
| SpatialDE | Score returned | FSV | openproblems src/methods/spatialde/script.py:44-46 @0d69e53 |
| SpatialDE | Lengthscale grid | 10 log-spaced squared-exponential lengthscales between the get_l_limits bounds, plus a constant null | Python-module/SpatialDE/base.py L412-426 @77f9fa5 |
| SpatialDE | P-value | 1 minus the chi-square(1) CDF of the LLR | Python-module/SpatialDE/base.py L433 @77f9fa5 |
| SpatialDE | Q-value | Storey–Tibshirani; pi0 set to 1 for fewer than 100 tests | Python-module/SpatialDE/util.py:23-25 qvalue @77f9fa5 |
| SPARK | Object construction | percentage 0; min_total_counts 0 | pinellolab SVG_Benchmarking run_SPARK.R:27 @3157900; openproblems src/methods/spark/script.R @0d69e53 |
| SPARK | Library size, cores, covariates | Library size is the column sum of counts; 4 cores in OpenProblems; no covariates | openproblems src/methods/spark/script.R @0d69e53; xzhoulab SPARK R/vcestimating.R @a8b4bf2 |
| SPARK | Combination bounds | p set to 5.55e-17 when zero; set to 0.99 when above 0.999 | xzhoulab SPARK R/utilties.R CombinePValues L75-99 @a8b4bf2 |
| SPARK | Adjustment and score | BY-adjusted; score is −log10 of the adjusted p-value | xzhoulab SPARK R/vctesting.R L78-79 @a8b4bf2; openproblems src/methods/spark/script.R:57-62 @0d69e53 |
| SPARK-X | Kernel set | Mixture: projection plus five Gaussian and five cosine kernels, eleven tests | xzhoulab SPARK R/sparkx.R L14, L59-82 @a8b4bf2 |
| SPARK-X | Combination | ACAT over per-kernel p-values, then BY | xzhoulab SPARK R/sparkx.R L100-102 @a8b4bf2 |
| SPARK-X | Cores | 10 in the Pinello script; 4 in OpenProblems | pinellolab SVG_Benchmarking run_SPARK-X.R:27 @3157900; openproblems src/methods/spark_x/script.R @0d69e53 |
| SPARK-X | Missing p-values | Set to 1 in the Pinello script | pinellolab SVG_Benchmarking run_SPARK-X.R @3157900 |
| SPARK-X | Score returned | −log10 of the adjusted p-value | openproblems src/methods/spark_x/script.R:38-44 @0d69e53 |
| nnSVG | Preprocessing | scran computeLibraryFactors, then logNormCounts | openproblems src/methods/nnsvg/script.R @0d69e53 |
| nnSVG | Threads | 4 in OpenProblems; 10 in the Pinello script | openproblems src/methods/nnsvg/script.R:14 @0d69e53; pinellolab SVG_Benchmarking run_nnSVG.R:46 @3157900 |
| nnSVG | Score returned | LR_stat | openproblems src/methods/nnsvg/script.R:58-60 @0d69e53 |
| Moran's I | Function signature | mode moran; transformation True; n_perms None; two_tailed False; corr_method fdr_bh; attr X | squidpy src/squidpy/gr/_ppatterns.py:77-96 @f030690 |
| Moran's I | OpenProblems graph and permutations | Delaunay neighbours with generic coordinates; 100 permutations on the normalized layer | openproblems src/methods/moran_i/script.py @0d69e53; config.vsh.yaml (coord_type_moran_i) |
| Moran's I | Pinello script | Delaunay, generic coordinates; 100 permutations; 10 jobs | pinellolab SVG_Benchmarking run_MoranI.py:31-35 @3157900 |
| Moran's I | Score returned | I | openproblems src/methods/moran_i/script.py:35-37 @0d69e53 |
| Geary's C | Variance | Same function with mode geary; an earlier version reused Moran's variance, corrected per the code comment citing squidpy issue 1183 | squidpy src/squidpy/gr/_ppatterns.py:103-107 @f030690 |

## 5. Proposed singlet approach

- **Port**: SpatialDE, nnSVG, Moran's I and Geary's C, keeping the published statistics and changing only the implementation.
- **Reimplement**: SPARK and SPARK-X, from the equations in Section 3 and the defaults in Section 4, without copied source.
- **Callout** (benchmark comparator only): every method outside the Section 4 table. Routes for each code base are in Section 12.

The proposed model-based formulation is a count-likelihood test. For each gene, a negative-binomial log-link model has a library offset and a spatial random effect whose covariance comes from the kernel or nearest-neighbour sets used by the graph statistics. The variance component is tested with a score statistic. Calibration uses a spatial-shuffle null: for a sample of genes in each batch, shuffled statistics give an empirical reference that is compared with the analytic p-values and used to rescale them where they disagree. Every call reports $\lambda_{\mathrm{GC}}$ and the rejection rate. The formulation enters the MCP enum only after B3 is met.

It is falsified, and the default stays with a published test, if its shuffled-null rejection rate or $\lambda_{\mathrm{GC}}$ misses the B3 range after correction, if its mean Kendall tau-b on B1 does not exceed Moran's I on the same split, or if its B2 correlations fall outside the stated margin in too many technology groups.

PyTorch is not needed for the baseline and is considered only for a learned calibration model. The hot paths suit hard-coded CUDA: cuSPARSE products with the weight matrix for Moran's I and Geary's C, with batched GPU permutations; and cuBLAS and cuSOLVER for the kernel eigendecomposition shared across genes and for batched Cholesky factors of nearest-neighbour conditionals.

The graph is built once and shared by all genes. Genes stream in blocks from the `.singlet` file, so memory scales with units times block size plus edges. Dense kernel methods also hold an $n\times n$ kernel and suit moderate $n$ only.

The provisional default is `sparkx`, the top method in the 2025 benchmark [R14]; its speed is tested in P1. Agents should keep `inference.calibrate_null` on and should not disable calibration to obtain a faster ranked list. Other defaults are in the generated table in Section 6.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Raw counts for the mixed-model, Gaussian-process and kernel methods |
| read | layers/normalized | sparse float32 | Normalised expression used by Moran's I and Geary's C |
| read | obsm/spatial | float64, n by 2 | Coordinates in the units of the lengthscale output; required |
| read | obs/total_counts | float32 | Library size for the offset, regression or size factor |
| read | obsp/spatial_connectivities | sparse float32 | Optional neighbour graph; built if absent |
| write | var/svg_score | float32 | Oriented score, larger meaning more spatial; method-specific scale |
| write | var/svg_pvalue | float64 | Per-gene tail probability under the method's null, where returned |
| write | var/svg_qvalue | float64 | FDR across genes, BH or BY as the method returns |
| write | var/svg_rank | int32 | Rank by score; 1 is the most spatial gene |
| write | var/svg_lengthscale | float32 | Fitted lengthscale in coordinate units; SpatialDE only |
| write | obsp/svg_graph | sparse float32 | Graph built by this call; absent when a graph was supplied |
| write | uns/svg_params | dict | Method, graph, grid, seed and package versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI, or a workspace handle, with obsm/spatial present. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting any gene. |
| `overwrite` | boolean | false | — | Replace existing svg_* members instead of failing. |
| `seed` | integer | 0 | — | Seed for shuffled nulls and permutations; the same seed reproduces the same p-values. |
| `method` | string | "sparkx" | `sparkx`, `spark`, `spatialde`, `nnsvg`, `morani`, `gearyc` | SVG test; sparkx is the provisional default, chosen for its rank in the 2025 benchmark. |
| `layer` | string | "auto" | `auto`, `counts`, `normalized` | Expression layer; auto uses counts for model methods and normalized for morani and gearyc. |
| `graph` | object | — | — | Spatial graph options for morani and gearyc; other methods ignore them. |
| `graph.type` | string | "delaunay" | `delaunay`, `knn`, `radius` | Spatial graph used by the autocorrelation statistics. |
| `graph.k_neighbors` | integer | 6 | min 1 | Neighbours per unit for knn graphs; 6 suits hexagonal Visium spots. |
| `graph.radius` | number/null | null | — | Distance cut-off in coordinate units for radius graphs. |
| `library_adjust` | string | "auto" | `auto`, `regress_log_total`, `offset`, `none` | How library size enters parametric models; auto matches each method's benchmark script. |
| `inference` | object | — | — | Calling threshold and calibration check. |
| `inference.alpha` | number | 0.05 | max 1; > 0 | Nominal FDR threshold used to count calls in the summary. |
| `inference.calibrate_null` | boolean | true | — | Shuffled-null calibration on a gene sample; reports lambda_GC and rejection rate. |
| `morani` | object | — | — | Options for Moran's I and Geary's C (methods morani and gearyc). |
| `morani.n_perms` | integer/null | null | min 1 | Permutations for permutation p-values; null uses analytic normal moments. |
| `morani.two_tailed` | boolean | false | — | Two-tailed p-values for Moran's I and Geary's C. |
| `spatialde` | object | — | — | Options for the SpatialDE Gaussian-process test (method spatialde). |
| `spatialde.lengthscale_grid` | integer | 10 | min 2 | Number of log-spaced squared-exponential lengthscales between the geometric limits. |
<!-- PARAMS:AUTO:END -->

`inference.calibrate_null` applies to every method that returns p-values. Each method's library handling follows its Section 4 defaults.

## 7. MCP tool

Tool name `singlet_spatial_genes_svg_detection` (definition in `tasks/mcp/singlet_spatial_genes_svg_detection.json`). Example call:

```json
{"dataset": "/data/visium/section1.singlet", "method": "sparkx", "inference": {"alpha": 0.05, "calibrate_null": true}}
```

Example result (values elided):

```json
{"dataset": "/data/visium/section1.singlet", "status": "completed",
 "wrote": ["var/svg_score", "var/svg_pvalue", "var/svg_qvalue", "var/svg_rank", "uns/svg_params"],
 "summary": {"method": "sparkx", "n_genes_tested": "<int>", "n_significant_at_alpha": "<int>", "lambda_gc": "<float or null>", "null_rejection_rate": "<float or null>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: large sections can return `queued` with a `job_id`. Stochastic: shuffled nulls and permutations depend on `seed`, which defaults to 0.

## 8. Benchmarks

All accuracy benchmarks score the gene-level outputs of the method settings in Section 4, on the same input object, with the random-ranking and true-ranking controls where a benchmark defines them. Simulations use the seeds in their generators (2024 for the OpenProblems simulation; `default_rng(0)` for the Pinello shuffles). Thread counts follow Section 4 and are reported with every result. A missing output is reported as missing and counted separately; it is never filled with zero. Per-dataset values are summarised with a median and interquartile range unless a block says otherwise.

### B1. OpenProblems correlation on scDesign3 mixtures (published)

- **Goal**: rank features by how closely their score tracks the simulated spatial strength of each gene.
- **Ground truth**: planted simulation [R16]. Each gene is simulated at 21 levels of $\alpha\in\{0,0.05,\dots,1\}$, mixing a Gaussian-process spatial mean with a shuffled non-spatial mean. The estimand is $\alpha$ itself on $[0,1]$. The generator keeps the 50 genes with the largest deviance explained, so each reference yields $21\times 50=1{,}050$ features.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| mouse_brain_coronal (reference section) | openproblems-bio task_spatially_variable_genes, src/data_processors/simulate_svg @0d69e53 | Spatial mouse brain coronal section; size — | — | Simulation seed 2024 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Kendall tau-b per gene family | For each gene, tau-b between score and alpha over its 21 levels; mean over families, with NaN values skipped. | maximise, from −1 to 1 | primary | [R17] |

- **Comparators**: random-ranking and true-ranking controls (the latter is the ceiling); SpatialDE, SpatialDE2 [R19], SPARK, SPARK-X, nnSVG, Moran's I, SOMDE, SpaGCN, Spanve, scGCO, BOOST-GP, GPcounts, SpaGFT and Sepal, as listed by the benchmark task.
- **Protocol**: each method reads counts and `obsm/spatial`, writes the predicted score, and that score is scored against the truth file with the metric above. Method settings are the Section 4 defaults.
- **Acceptance criterion** (proposed): the singlet method matches or beats Moran's I on the same split, ranks in the top quartile of the comparator set, and reproduces its own score within 0.01 across three seeds.
- **Known pitfalls**: (1) Truth comes from a Gaussian-process fit (an mgcv smoother, default k = 500, inside scDesign3), which favours GP methods (Section 2).

### B2. Pinello-lab SVG benchmark over 50 simulated datasets (extended)

- **Goal**: compare methods across nine spatial technologies on the simulated design of B1.
- **Ground truth**: planted simulation as in B1 [R16]. The estimand is $\alpha\in[0,1]$ per gene, with the binary label $\alpha>0$ for AUPR. Datasets are listed in the benchmark's evaluation notebooks; the archive is at https://zenodo.org/records/18193366.
- **Datasets**

| Technology | Datasets | Tissues or organisms |
|---|---|---|
| 10x Visium | 20 (01–20) | Mouse and human tissues |
| Slide-seq v2 | 5 (21–25) | Mouse brain regions |
| DBiT-seq | 6 (26–31) | Mouse embryo sections |
| 10x Xenium | 2 (32–33) | Human colon cancer; mouse brain |
| MERFISH | 5 (34–38) | Human and mouse cortex |
| seqFISH | 1 (39) | Mouse organogenesis |
| Slide-tags | 4 (40–43) | Mouse embryo; human cortex, melanoma, tonsil |
| Stereo-seq | 5 (44–48) | Drosophila embryo, several stages |
| STARmap | 2 (49–50) | Mouse (Wang 2018 data, z-steps 10 and 15) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Kendall tau-b per gene family | As in B1, summarised per dataset (Section 10). | maximise | primary | [R17], [R13] |
| AUPR | Average precision with label $\alpha>0$, over the oriented score. | maximise; chance level is prevalence | primary | [R13] |
| Per-gene prop_sv correlation | Kendall correlation of score with the simulated proportion of spatial variance (prop_sv), per gene. | maximise | guardrail | [R13] |

- **Comparators**: nnSVG, Spanve, SPARK-X, SPARK, SpatialDE2 [R19], SpatialDE, SOMDE, Moran's I, scGCO, SpaGCN, SpaGFT, GPcounts, Sepal and BOOST-GP.
- **Protocol**: one table per method and dataset, then evaluation notebooks for correlation, AUPR, per-gene correlation and sparsity, with method-specific environments. Missing outputs are reported separately.
- **Acceptance criterion** (proposed): report median and interquartile range per technology. A method is competitive if its median correlation is within 0.05 of the best method in at least 7 of the 9 technology groups.
- **Known pitfalls**: (1) With all 21 levels, 20 of 21 features are positive, so the AUPR chance level is 0.952 and differences compress; use balanced labels or report prevalence. (2) Sign conventions differ by method, and a sign error inverts both correlation and AUPR.

### B3. Null calibration under spatial shuffling (extended)

- **Goal**: test whether p-values are uniform when expression is independent of location.
- **Ground truth**: planted null. The counts rows are shuffled with a fixed generator and the coordinates are kept, so every gene is null. The estimand is the per-gene p-value distribution, summarised by the rejection rate and the $\lambda_{\mathrm{GC}}$ defined in Section 3.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 06_10x_Visium_Mouse_Olfactory_Bulb, rows shuffled | pinellolab SVG_Benchmarking statistical_calibration/01_prepare_data.ipynb | Visium, mouse olfactory bulb; spots — | — | Shuffle with numpy default_rng(0); genes detected in at least 500 spots kept |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Rejection rate at 0.05 | Fraction of genes with p below 0.05, or q below 0.05 for q-based methods. | target 0.05 | primary | [R13], [R14] |
| lambda_GC and QQ plot | $\lambda_{\mathrm{GC}}$ as in Section 3, with observed against uniform quantiles. | target 1 | primary | [R13] |
| Tail rejection at 0.001 | Fraction of genes with p below 0.001. | minimise | guardrail | [R13] |

- **Comparators**: Moran's I (analytic p-value), nnSVG, SOMDE, SPARK-X (combined p-value), SpaGFT, Spanve and SpatialDE.
- **Protocol**: shuffle, apply each method's p-value output, and plot QQ against uniform quantiles with the benchmark helper.
- **Acceptance criterion** (proposed): rejection rate within 0.04 to 0.06 and $\lambda_{\mathrm{GC}}$ within 0.9 to 1.1. Methods outside this range are reported as uncalibrated and are not ranked.
- **Known pitfalls**: (1) Row shuffling removes all spatial dependence, so it is a best-case null; meeting it does not guarantee calibration on tissue with domain structure. (2) One dataset is used, and calibration depends on sparsity and library size.

### B4. Downstream domain clustering with selected genes (extended)

- **Goal**: test whether gene sets selected by SVG methods improve agreement with expert spatial domains, relative to highly variable genes.
- **Ground truth**: expert labels. Each spot carries a manual domain label. The estimand is the adjusted Rand index between clusters from the selected genes and these labels.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Human dorsolateral prefrontal cortex sections (spatialLIBD) | pinellolab SVG_Benchmarking snakemake_clustering/01_prepare_data.ipynb | Visium, human DLPFC; several sections | — | Genes detected in at least 200 cells and cells with at least 200 genes kept |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Adjusted Rand index | Clusters from the top-k genes against manual labels, for k of 500, 1000, 1500 and 2000. | maximise | primary | [R13] |

- **Comparators**: the highly variable gene baseline and the top-k sets of each method in B2.
- **Protocol**: filter genes and cells, take the top k genes per method, cluster, and compute the adjusted Rand index against the manual labels.
- **Acceptance criterion** (proposed): the singlet top-k set gives a median adjusted Rand index at least equal to the highly variable gene baseline across sections.
- **Known pitfalls**: (1) Manual labels partly follow expression, so genes that define the labels inflate the index; keep label-defining genes separate from held-out genes. (2) The clustering method contributes variance to the index.

### P1. Performance and scaling

Wall time and peak memory on CPU and CUDA at 10,000, 100,000 and 1,000,000 units, for this method and for spatialde, spark, spark_x, nnsvg, moran_i and somde. A gene-count sweep at fixed units extends from the 50-gene reference to the full transcriptome. The 10,000,000-unit point applies only to morani and gearyc, the methods for which streaming is claimed. Hold fixed the thread counts from Section 4 (4 and 10), a Delaunay graph, 100 permutations, each method's default layer and seed 0. Report wall time, peak memory and throughput in genes per second from the benchmark logs.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `spatial-preproc.spatial_depth_normalization`: Spatially aware library-size normalization
- **Feeds**:
  - `spatial-genes.expression_pattern_classification`: Spatial expression pattern classification and trend detection
  - `spatial-genes.celltype_specific_spatial_variation`: Cell-type-specific spatial expression variation (spatial DE within a cell type)
  - `spatial-domains.single_slice_domains`: Single-slice spatial domain identification
- **Reads**: `layers/counts`, `layers/normalized`, `obsm/spatial`, `obs/total_counts`, `obsp/spatial_connectivities`
- **Writes**: `var/svg_score`, `var/svg_pvalue`, `var/svg_qvalue`, `var/svg_rank`, `var/svg_lengthscale`, `obsp/svg_graph`, `uns/svg_params`
<!-- CHAINING:AUTO:END -->

In the single-section path this task follows quality control and spatial depth normalisation, and it precedes pattern classification and domain analysis. No named recipe is assigned here.

## 10. Risks, pitfalls and open questions

- **Components outside the tables.** scGCO, Spanve, SOMDE, SpatialDE2 [R19] and SpaGCN appear only as benchmark comparators, not in Section 4 or the MCP enum. The OpenProblems SpaGCN script fills scores with random values when no domain test succeeds, so its comparator scores need a failure check. The SPARK variance-component score test and the SPARK-X kernel statistic are taken from the papers, not from code.
- **Unresolved dataset facts.** Spot counts and source studies are not established for mouse_brain_coronal, the Visium olfactory bulb reference and the spatialLIBD sections. The 2023 preprint used 60 simulated datasets, 12 real transcriptomic datasets and 3 spatial ATAC datasets [R13]; the 2025 paper reports 96 spatial datasets [R14]; B2 uses the 50-dataset repository set. The B2 notebooks do not fix whether gene aggregation uses the median or the mean. The clustering method behind the B4 index is not fixed, because the repository contains both k-means and Leiden clustering.
- **Data terms.** The terms of use for the Zenodo simulation archive and the spatialLIBD data are not established, so no reuse of these data is assumed.
- **Unsettled literature.** The 2023 preprint and the 2025 paper name different best methods and have different titles. It is not established whether the 2025 paper revises the preprint, so no ranking transfers between them. The Charitakis study [R15] compares six packages on 9 public and 5 simulated datasets; its central result is disagreement in gene counts, and tools without p-values tended to report fewer genes. Its argument is for standardised benchmarking, not a ranking.
- **Verification checks.** These are internal checks, not published benchmarks. Before B1 is used, Moran's I on $\alpha=0$ features should be spatially flat, which tests the shuffle orientation; whether the rows of `ref_para$mean_mat` are genes or cells is not established. Other checks: marker concordance on Visium mouse brain (curated layer markers are not yet defined; target at least 80 percent of markers in the top 200 for at least three of five methods); graph sensitivity (Spearman at least 0.9 between Delaunay and k = 6 kNN graphs on Visium); and Moran parity with squidpy (relative difference in I at most $10^{-8}$ on identical weights, and Spearman at least 0.99 between analytic and 10,000-permutation p-values for genes with analytic p below 0.05).
- **First experiment.** Apply the shuffled-null calibration (B3) to Moran's I, SpatialDE and SPARK-X on the olfactory bulb data first, because every other benchmark depends on that calibration reference. The speed of SPARK-X and the scaling of nnSVG are tested in P1 and are not assumed.

## 11. References

R1. Svensson V, Teichmann SA, Stegle O. SpatialDE: identification of spatially variable genes. *Nature Methods* 2018. doi:10.1038/nmeth.4636 — verified (corpus)
R2. Sun S, Zhu J, Zhou X. Statistical analysis of spatial expression patterns for spatially resolved transcriptomic studies. *Nature Methods* 2020. doi:10.1038/s41592-019-0701-7 — verified (corpus)
R3. Zhu J, Sun S, Zhou X. SPARK-X: non-parametric modeling enables scalable and robust detection of spatial expression patterns for large spatial transcriptomic studies. *Genome Biology* 2021. doi:10.1186/s13059-021-02404-0 — verified (corpus)
R4. Weber LM, Saha A, Datta A, Hansen KD, Hicks SC. nnSVG for the scalable identification of spatially variable genes using nearest-neighbor Gaussian processes. *Nature Communications* 2023. doi:10.1038/s41467-023-39748-z — verified (corpus)
R5. Palla G, Spitzer H, Klein M, et al. Squidpy: a scalable framework for spatial omics analysis. *Nature Methods* 2022. doi:10.1038/s41592-021-01358-2 — verified (corpus)
R6. Moran PAP. Notes on continuous stochastic phenomena. *Biometrika* 1950. — unverified (memory)
R7. Geary RC. The contiguity ratio and statistical mapping. *The Incorporated Statistician* 1954. — unverified (memory)
R8. Cliff AD, Ord JK. *Spatial Processes: Models and Applications*. Pion, London 1981. — unverified (memory)
R9. Storey JD, Tibshirani R. Statistical significance for genome-wide studies. *Proceedings of the National Academy of Sciences* 2003;100:9440–9445. — partial (repo)
R10. Liu Y, Xie J. Cauchy combination test: a powerful test with analytic p-value calculation under arbitrary dependency structures. *Journal of the American Statistical Association* 2020. — unverified (memory)
R11. Benjamini Y, Yekutieli D. The control of the false discovery rate in multiple testing under dependency. *Annals of Statistics* 2001. — unverified (memory)
R12. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)
R13. Li Z, Patel ZM, Song D, Yan G, Li JJ, Pinello L. Benchmarking computational methods to identify spatially variable genes and peaks. *bioRxiv* 2023. doi:10.1101/2023.12.02.569717 — partial (search)
R14. Li, Patel, Song, Yasa, Cannoodt, Yan, Li, Pinello. Systematic benchmarking of computational methods to identify spatially variable genes. *Genome Biology* 2025;26:285. doi:10.1186/s13059-025-03731-2 — partial (search)
R15. Charitakis N, et al. Disparities in spatially variable gene calling highlight the need for benchmarking spatial transcriptomics methods. *Genome Biology* 2023;24:209. doi:10.1186/s13059-023-03045-1 — partial (search)
R16. Song D, et al. scDesign3 generates realistic in silico data for multimodal single-cell and spatial omics. *Nature Biotechnology* 2023. doi:10.1038/s41587-023-01772-1 — partial (corpus)
R17. Kendall M. G. A new measure of rank correlation. *Biometrika* 1938. doi:10.1093/biomet/30.1-2.81 — verified (corpus)
R18. Datta A, Banerjee S, Finley AO, Gelfand AE. Hierarchical nearest-neighbor Gaussian process models for large geostatistical datasets. *Journal of the American Statistical Association* 2016. doi:10.1080/01621459.2015.1044091 — partial (repo)
R19. Kats I, Vento-Tormo R, Stegle O. SpatialDE2: fast and localized variance component analysis of spatial transcriptomics. *bioRxiv* 2021. doi:10.1101/2021.10.27.466045 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/Teichlab/SpatialDE | Teichmann Group (copyright line); paper authors Svensson V, Teichmann SA, Stegle O | MIT (LICENSE, Copyright 2018 Teichmann Group) | SpatialDE model, FSV and likelihood-ratio test | port |
| https://github.com/xzhoulab/SPARK | Shiquan Sun, Jiaqiang Zhu, Xiang Zhou (DESCRIPTION); maintainer Jiaqiang Zhu | GPL-3 (LICENSE.md is the GPL-3 text; DESCRIPTION: GPL-3) | SPARK and SPARK-X tests and combination rules | reimplement |
| https://github.com/lmweber/nnSVG | Lukas M. Weber (copyright holder) | MIT (LICENSE; DESCRIPTION: MIT + file LICENSE) | Nearest-neighbour Gaussian process and LR_stat | port |
| https://github.com/scverse/squidpy | scverse | BSD-3-Clause | Moran's I and Geary's C with analytic moments | port |
| https://github.com/openproblems-bio/task_spatially_variable_genes | Open Problems in Single-Cell Analysis (LICENSE copyright holder) | MIT (LICENSE, Copyright 2024) | Simulation design, method scripts and metrics for B1 | callout |
| https://github.com/pinellolab/SVG_Benchmarking | Pinello Lab (LICENSE copyright holder) | MIT (LICENSE, Copyright 2023) | Simulation, evaluation, calibration and clustering for B2 to B4 | callout |
