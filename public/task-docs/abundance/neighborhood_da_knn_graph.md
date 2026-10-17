---
id: abundance.neighborhood_da_knn_graph
title: Cluster-free neighbourhood differential abundance on a kNN graph
area: abundance
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [dim-reduction.normalized_cell_embedding, integration.batch_corrected_embedding, neighbors.approximate_knn_search]
feeds: [markers-de.neighborhood_level_de, abundance.phenotype_associated_cells, statistics.pvalue_null_calibration]
reads: [obsm/<use_rep>, obsp/<graph_key>, obs/<sample_key>, obs/<design_column>, obs/<annotation_key>]
writes: [obsm/<output_key>_nhoods, uns/<output_key>_nhood_counts, uns/<output_key>_nhood_results, obs/<output_key>_nhood_logfc, obs/<output_key>_nhood_annotation, models/<output_key>_nhood_glm]
devices: [cpu, cuda]
mcp_tool: singlet_abundance_neighborhood_da_knn_graph
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Cluster-free neighbourhood differential abundance on a kNN graph

> Tests, for partially overlapping neighbourhoods of a cell kNN graph, whether the number of cells from each replicate sample changes between conditions, using a negative-binomial model per neighbourhood and a graph-weighted FDR, and maps significant neighbourhoods back to cells.

## 1. Question

Which neighbourhoods of a cell kNN graph change in abundance between conditions when the replicate sample is the unit of inference? Inputs are an embedding or kNN graph over cells, a cell-to-sample assignment and a sample-level design. For each sampled neighbourhood $v$ the outputs are a log2 fold change $\hat\beta_v$, a p-value and a graph-spatially corrected FDR (SpatialFDR), which map back to cells. A correct answer controls the FDR over neighbourhoods under between-replicate variation and recovers planted abundance shifts with known truth. The estimand is the condition coefficient of the neighbourhood count model in Section 3.

## 2. Why this task matters and where the field stands

Differential abundance (DA) asks whether a cell population is more or less frequent in one condition than in another. Cluster-level tests answer this only at the resolution of the clustering: a shift inside a cluster is invisible, a shift across a boundary is split, and a continuous trajectory has no natural boundary [R9]. Milo counts the cells of each replicate sample in partially overlapping neighbourhoods of a kNN graph and tests each neighbourhood with a negative-binomial (NB) model [R1]. DA-seq, a per-cell kNN alternative [R4], is covered by abundance.cell_level_da_score. The density-weighted FDR used here comes from cydar, the hypersphere method for mass cytometry [R2]; the miloR code attributes its weighting to cydar (`R/graphSpatialFDR.R:158`).

The task is **contested**. Three problems are specific to neighbourhoods.

1. **Multiplicity under overlap.** Neighbourhoods share cells, so their tests are dependent and ordinary BH counts near-duplicate tests in full. miloR's documentation calls the default correction inappropriate for overlapping neighbourhoods (`R/testNhoods.R:75-77`). The weighted correction is a heuristic extension of the cydar argument to kNN neighbourhoods, and no derivation for kNN neighbourhoods is available in this document's evidence (Section 10).
2. **Replicate-level inference.** The replicate is the sample, but cells are the counted units. Few replicates make dispersion unstable, and a graph confounded with batch removes the within-batch contrast. The chapter recommends enough biological replicates and spreading each condition across batches [R9].
3. **Parameter dependence.** The neighbourhood set depends on the neighbour count, the sampling proportion, the embedding and the index placement. The miloR gastrulation vignette suggests prop 0.1 below about 30k cells and 0.05 above it, and uses a neighbourhood size of 30 on a corrected PCA (miloR `vignettes/milo_gastrulation.Rmd:119`, `:123`). Mixed models for donor-level dependence are a separate extension [R3].

## 3. Theory and insight

### 3.1 Neighbourhoods and counts

Let $\mathrm{kNN}_k(v)$ be the $k$ nearest neighbours of an index cell $v$ and $n_v=\{v\}\cup\mathrm{kNN}_k(v)$. Index cells are drawn at proportion $\mathrm{prop}$, so about $\mathrm{prop}\cdot N$ neighbourhoods are tested. With refined placement the index moves to the cell nearest the median reduced-dimension position of its neighbourhood (`R/makeNhoods.R:65`; `_closest_to_median` in pertpy `_milo.py:140`). Membership and counts are

$$M_{iv}=\mathbf 1[i\in n_v],\qquad C_{vs}=\sum_i M_{iv}\,\mathbf 1[s(i)=s].$$

$C_{vs}$ is the number of cells of sample $s$ in neighbourhood $v$, exact given the graph and sample labels. On average each cell lies in about $\mathrm{prop}\cdot(k+1)$ neighbourhoods, so the tests are dependent. Regime: the graph and $k$ are fixed.

### 3.2 Negative-binomial test

$$C_{vs}\sim\mathrm{NB}(\mu_{vs},\phi_v),\qquad \log\mu_{vs}=\log L_s+\mathbf x_s^{\top}\boldsymbol\beta_v,\qquad \mathrm{Var}(C_{vs})=\mu_{vs}+\phi_v\mu_{vs}^{2}.$$

Here $L_s=N_s f_s$, with $N_s=\sum_v C_{vs}$ over tested neighbourhoods (`R/testNhoods.R:424`) and $f_s$ the TMM factor over neighbourhoods (`R/testNhoods.R:436-441`, after Robinson and Oshlack [R6]). $\mathbf x_s$ holds the design terms. A contrast $\mathbf c^\top\boldsymbol\beta_v$ estimates the log2 change in $\mu_{vs}/L_s$, the expected neighbourhood count per unit of normalised library, between conditions (log2 scale as in `_milo.py:236`). Regime: cells are exchangeable within a sample given the neighbourhood, and samples are independent units.

- **Quasi-likelihood (`qlf`).** The variance is $\sigma_v^2 V(\mu_{vs})$ with $V(\mu)=\mu+\phi\mu^2$. The scale $\sigma_v^2$ is shrunk toward a trend across neighbourhoods and the contrast is tested by an F-test, as in the edgeR path that miloR calls (`R/testNhoods.R:453`, `:602-611`, with `robust=TRUE` and `legacy=TRUE`). The shrinkage is edgeR's and is not re-derived here. Regime: with few replicates the shrinkage supplies most of the variance estimate.
- **Likelihood ratio (`irls_lrt`).** The pertpy default fits the same NB model by IRLS with dispersions estimated by pydeseq2 and tests $\Lambda_v=2\{\ell_v(\hat\beta)-\ell_v(\hat\beta_0)\}$ against $\chi^2_1$ (`_milo.py:177`, `:236`). The fold change is refit with a prior count of 0.125 and without pydeseq2's floor of 0.5 on fitted means, which would cap fold changes in sparse neighbourhoods (`_milo.py:220`, `:225`). Regime: the $\chi^2$ reference is asymptotic in replicates and counts, so it is optimistic with few samples.
- **Mixed model (`glmm`).** Section 3.4.

### 3.3 Graph-spatial FDR

$$w_v=\frac{1}{d_k(v)},\qquad W=\sum_v w_v,\qquad \tilde q_{(j)}=\min\Bigl\{1,\ \min_{l\ge j}\frac{W\,p_{(l)}}{\sum_{r\le l}w_{(r)}}\Bigr\}.$$

Here $d_k(v)$ is the distance from the index cell to its $k$-th neighbour (miloR `k-distance`, `R/graphSpatialFDR.R:99-111`; pertpy `_milo.py:1302`), and $p_{(1)}\le\dots\le p_{(m)}$ are the sorted neighbourhood p-values with weights $w_{(r)}$ in the same order. Dense regions have small $d_k$ and large weight, so a p-value there counts more. With all weights equal to one the expression reduces to $\min_{l\ge j}m\,p_{(l)}/l$, the plain Benjamini-Hochberg (BH) adjustment over $m=|V|$ tests (derived). Plain BH, reported by pertpy as FDR (`_milo.py:743`), ignores overlap.

The estimand is the expected share of null neighbourhoods among calls at level $\alpha$, where a call is $\tilde q_v\le\alpha$. The cydar argument concerns hyperspheres [R2]; for kNN neighbourhoods the weighting is a heuristic extension, not a proof (Section 10).

### 3.4 Mixed model for dependent samples

$$\log\mu_{vs}=\log L_s+\mathbf x_s^{\top}\boldsymbol\beta_v+\mathbf z_s^{\top}\mathbf u_v,\qquad \mathbf u_v\sim\mathcal N\!\left(\mathbf 0,\,\sigma_v^{2}\mathbf K\right)$$

is the schematic form, with $\mathbf z_s$ random-effect rows (donor, batch) and $\mathbf K$ a kinship matrix when one is supplied. Variance components are estimated by REML with a Fisher, HE or HE-NNLS solver (`R/glmm.R:16-29`); when unset, miloR uses Fisher with a warning (`R/testNhoods.R:479-482`). Regime: at least 60 samples (`R/testNhoods.R:265-270`). The Milo 2.0 preprint describes a count-based mixed model [R3].

### 3.5 Estimands and normalisation

- **Neighbourhood logFC** $\hat\beta_v$: log2 change in expected count per unit of TMM-normalised library between contrast levels.
- **p-value** $p_v$ and **SpatialFDR** $\tilde q_v$: unitless probabilities, with no normalisation beyond Section 3.3.
- **Planted truth** $\tau_v$ (benchmarks): $\log_2(\pi_{vB}/\pi_{vA})$, where $\pi_{vc}$ is the expected share of all condition-$c$ cells that fall in $n_v$. The denominator is each condition's total cell count.
- **Cell-level summary**: the unweighted mean of $\hat\beta_v$ over significant neighbourhoods containing the cell, counting the cell once per neighbourhood.
- **Null false call rate**: among tested neighbourhoods under a permuted labelling, the share with $\tilde q_v\le\alpha$.

### 3.6 Assumptions and failure modes

Validity needs four things. Replicate samples must carry between-sample variance in each neighbourhood. The graph and embedding must not be defined by the condition or by batch, or neighbourhoods become single-batch and calls are confounded. TMM factors are computed against a reference sample, so a strong shift in one region can move the factors and create apparent changes elsewhere [R6]. Continuous covariates enter linearly on the log scale, so nonlinear abundance trends are misrepresented. Two diagnostics apply: a p-value histogram with a second peak near one suggests neighbourhoods with no variance between replicates, and a left-skewed histogram suggests an unmodelled covariate. The check used here is a median of at least three cells per sample in a neighbourhood, which means a neighbourhood of at least three times as many cells as samples.

### 3.7 Why heuristics work and what a model adds

The cluster-level count test is the heuristic standard, and its result depends on the clustering [R9]. Per-cell kNN scores (abundance.cell_level_da_score) give a relative likelihood per cell; their handling of replicate variance is outside this document. The NB neighbourhood model adds replicate-aware calibration, covariates in the design, a mixed-model route for dependent samples [R3] and a stated estimand. It does not give a per-neighbourhood uncertainty that accounts for overlap, which Section 5 proposes.

The main error source in practice is replicate-level variance together with batch-condition confounding in the graph, not the spatial correction. The spatial correction decides which of many correlated tests are called; the replicate model decides whether a call is credible at all.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Milo, edgeR quasi-likelihood F-test with graph-spatial FDR (miloR) | model-based | NB GLM on neighbourhood counts with TMM offsets; QL F-test; $1/d_k$ weighted BH | [R1], [R2] |
| Milo, pydeseq2-style NB GLM with likelihood-ratio test (pertpy default) | model-based | Same design and FDR in Python; NB IRLS with pydeseq2 dispersions; LRT for the contrast | [R1], [R5], [R10] |
| Milo NB-GLMM with REML (miloR and pertpy) | model-based | Random effects for donor or batch, or a kinship matrix, for dependent samples | [R3] |
| Cluster-level count test (heuristic standard) | heuristic | Graph clusters at a fixed resolution; a count test per cluster across samples (abundance.celltype_proportion_test) | [R9] |
| Unweighted BH over neighbourhoods (pertpy FDR column) | heuristic | Plain BH over $m=\lvert V\rvert$ tests; ignores overlap | `_milo.py:743` |

The published standard is the Milo NB GLM with edgeR's quasi-likelihood test and graph-spatial FDR; the Python port keeps the design and FDR and changes the solver. The heuristic standard is the cluster-level count test, kept as a comparator. Unweighted BH is kept as the reference correction. Methods without a primary source read here are excluded: DA-seq [R4] and cell-attribute community detection.

Defaults, with source locations:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| miloR `buildGraph` | `k`; `d` | 10; 50 | `R/buildGraph.R:63` @4ecad89 |
| miloR `makeNhoods` | `prop`; `k`; `d` | 0.1; 21; 30 | `R/makeNhoods.R:56` @4ecad89 |
| miloR `makeNhoods` | `refined`; `refinement_scheme` | TRUE; `"reduced_dim"` | `R/makeNhoods.R:56`, `:65` @4ecad89 |
| miloR `testNhoods` | `fdr.weighting` | `"k-distance"` (first option) | `R/testNhoods.R:167` @4ecad89 |
| miloR `testNhoods` | `norm.method`; `robust`; `REML` | `"TMM"`; TRUE; TRUE | `R/testNhoods.R:168-169` @4ecad89 |
| miloR `testNhoods` | `max.iters`; `max.tol`; `min.mean` | 50; 1e-5; 0 | `R/testNhoods.R:168`, `:170` @4ecad89 |
| miloR `testNhoods` | library size | `colSums` of neighbourhood counts, then TMM | `R/testNhoods.R:424`, `:436-441` @4ecad89 |
| miloR `testNhoods` | QL fit | `estimateDisp`; `glmQLFit(robust, legacy=TRUE)`; `glmQLFTest` | `R/testNhoods.R:453`, `:602-611` @4ecad89 |
| miloR `testNhoods` | GLMM solver | NULL, set to Fisher with a warning | `R/testNhoods.R:479-482` @4ecad89 |
| miloR `testNhoods` | GLMM sample guard | error if N < 60 unless `force=TRUE` | `R/testNhoods.R:265-270` @4ecad89 |
| miloR `graphSpatialFDR` | k-distance weight | $w=1/d_k$ (`1/t.connect`) | `R/graphSpatialFDR.R:99-111`, `:158-159` @4ecad89 |
| pertpy `make_nhoods` | `prop`; `seed` | 0.1; 0 | `_milo.py:273-274` @c246f24 |
| pertpy `da_nhoods` | `solver` | `"pydeseq2"` | `_milo.py:467` @c246f24 |
| pertpy `da_nhoods` | `reml`; `max_iter`; `tol` | True; 50; 1e-5 | `_milo.py:464-466` @c246f24 |
| pertpy `da_nhoods` | logFC prior count | 0.125 | `_milo.py:220` @c246f24 |
| pertpy `_graph_spatial_fdr` | weights; missing values | $1/\text{kth\_distance}$; missing SpatialFDR set to 1 | `_milo.py:1302`, `:1307` @c246f24 |
| pertpy `da_nhoods` | residual degrees of freedom | error when samples do not exceed design rank | `_milo.py:57-65`, `:592`, `:635` @c246f24 |

## 5. Proposed singlet approach

Routes follow Section 12. The count and test kernel is **reimplemented** from the equations of Section 3, because singlet does not copy miloR's code (Section 12). Permissive pertpy code is **ported**: the residual-degree check, the SpatialFDR weighting, the IRLS and likelihood-ratio logic, and the GLMM once it matches miloR on shared cases. The miloR quasi-likelihood path is a **callout** for comparison until a reimplementation meets the B1 and B2 criteria.

The defaults are `solver` `irls_lrt`, `fdr_weighting` `k_distance`, prop 0.1, graph $k=10$, neighbourhood $k=21$, $d=30$, TMM, $\alpha=0.1$ and seed 0. These follow miloR's defaults, and `irls_lrt` matches pertpy's default solver (`solver="pydeseq2"`), so comparators run on identical graphs. Neighbourhood $k=30$ on a corrected PCA is the miloR gastrulation vignette's choice (Section 2); it is the first sensitivity arm in B1 and B3, not the default.

**Model-based challenger.** A graph-smoothed posterior over neighbourhood effects: a Markov random field on the overlap graph of neighbourhoods, where two neighbourhoods are linked when they share cells. Its posterior probability of a non-zero effect would replace the heuristic $1/d_k$ weight. It is falsified if the B2 median false call rate exceeds 0.10, if its maximum exceeds 0.12, or if its B1 power at FDP at most 0.10 is below that of the default.

**Stack and devices.** The per-neighbourhood fit is a batched small-matrix problem: $p$ coefficients (typically fewer than ten) for $|V|$ neighbourhoods. It maps to batched Newton/IRLS with cuBLAS batched solves. Counting is the sparse-dense product $C=M^{\top}G$, where $G$ is the cell-by-sample indicator, implemented with cuSPARSE. The CPU C++ implementation computes the same kernels and serves as the reference. Counting streams over cell chunks, since the fit needs only the $V\times S$ matrix. Graph construction is shared with neighbors.approximate_knn_search. PyTorch is not needed for the first version.

Cell-level summaries and annotation are conventions, not tested rules: the 75 percent majority label with a Mixed class is a singlet choice, and miloR's `annotateNhoods` uses 0.6 as its example fraction (`R/annotateNhoods.R:27`).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/`<use_rep>` (default X_pca) | float32, n × d | embedding for the graph and index placement |
| read | obsp/`<graph_key>` | sparse float32, n × n | optional existing kNN graph |
| read | obs/`<sample_key>` | categorical | biological replicate identifier |
| read | obs/`<design_column>` | categorical or numeric | design terms, including condition and batch |
| read | obs/`<annotation_key>` | categorical | optional labels for neighbourhood annotation |
| write | obsm/`<key>`_nhoods | sparse, n × V | membership matrix $M$ |
| write | uns/`<key>`_nhood_counts | sparse int, V × S | neighbourhood-by-sample counts $C$ |
| write | uns/`<key>`_nhood_results | table, V rows | logFC, PValue, FDR, SpatialFDR, index cell, k-distance |
| write | obs/`<key>`_nhood_logfc | float32 | mean logFC of significant neighbourhoods containing the cell |
| write | obs/`<key>`_nhood_annotation | categorical | majority label or Mixed (optional) |
| write | models/`<key>`_nhood_glm | coefficients and dispersions, V rows | fitted model |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `design` | object | required | — | Sample-level design of the neighbourhood count model. |
| `design.formula` | string | — | — | Design formula over obs columns, for example '~ batch + condition'; residual degrees of freedom must be positive. |
| `design.sample_key` | string | "sample" | — | obs column with the biological replicate identifier; it must not be the condition column. |
| `design.contrast` | string/null | null | — | Coefficient to test; null tests the last term of the formula. |
| `embedding` | object | — | — | Embedding and graph used to define neighbourhoods. |
| `embedding.use_rep` | string | "X_pca" | — | obsm key of the embedding; it must contain no missing values. |
| `embedding.n_dims` | integer | 30 | min 2 | Leading embedding dimensions used for the graph and index placement. |
| `embedding.graph_key` | string/null | null | — | Existing obsp connectivity key to reuse; null builds a kNN graph from use_rep. |
| `embedding.k_graph` | integer | 10 | min 3 | Neighbours per cell when building the graph; 10 matches miloR's buildGraph default. |
| `nhoods` | object | — | — | Neighbourhood sampling. |
| `nhoods.prop` | number | 0.1 | max 1; > 0 | Fraction of cells sampled as index cells; 0.05 is suggested above about 30k cells. |
| `nhoods.k` | integer | 21 | min 3 | Neighbourhood size used by refined index placement. |
| `nhoods.refined` | boolean | true | — | Move each index cell to the cell nearest the median position of its neighbourhood. |
| `nhoods.min_median_cells_per_sample` | number | 3 | min 0 | Warning threshold for the median neighbourhood cell count per sample; not a filter. |
| `test` | object | — | — | Test statistic and multiplicity correction. |
| `test.solver` | string | "irls_lrt" | `irls_lrt`, `qlf`, `glmm` | irls_lrt: NB GLM with likelihood-ratio test; qlf: edgeR quasi-likelihood F-test; glmm: NB GLMM. |
| `test.fdr_weighting` | string | "k_distance" | `k_distance`, `none` | k_distance: weight 1/k-distance; none: plain Benjamini-Hochberg over neighbourhoods. |
| `test.alpha` | number | 0.1 | max 1; > 0 | Significance level for SpatialFDR calls and summaries. |
| `test.min_mean` | number | 0 | min 0 | Minimum mean neighbourhood count across samples before testing. |
| `glmm` | object | — | — | Options for test.solver glmm (dependent samples). |
| `glmm.reml` | boolean | true | — | Estimate variance components by REML. |
| `glmm.variance_solver` | string | "Fisher" | `Fisher`, `HE`, `HE-NNLS` | Variance-component solver; Fisher falls back to non-negative HE on negative estimates. |
| `glmm.max_iter` | integer | 50 | min 1 | Maximum iterations of the mixed-model fit. |
| `glmm.tol` | number | 1e-05 | > 0 | Convergence tolerance of the mixed-model fit. |
| `glmm.force` | boolean | false | — | Allow fewer than 60 samples, where estimates may be unreliable. |
| `output` | object | — | — | Names and optional annotation of the written members. |
| `output.key` | string | "nhood_da" | — | Stem of the output members under obsm, uns, obs and models. |
| `output.annotation_key` | string/null | null | — | obs labels summarised per significant neighbourhood: majority label at 75 percent, otherwise Mixed. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Seed for index-cell sampling and mixed-model starting values. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`design.formula` is required and must leave residual degrees of freedom; the tested term is the last coefficient unless `design.contrast` is given. `test.solver` `glmm` requires dependent samples and at least 60 samples unless `glmm.force` is set. `test.fdr_weighting` `none` gives plain BH and is the reference against which the overlap correction is judged. `nhoods.prop` of 0.05 is advised above about 30k cells (Section 2). The graph dimension must equal `embedding.n_dims`. A block that the selected solver does not use is refused.

## 7. MCP tool

Tool name `singlet_abundance_neighborhood_da_knn_graph` (definition in `tasks/mcp/singlet_abundance_neighborhood_da_knn_graph.json`).

```json
{"dataset": "/data/atlas.singlet", "design": {"formula": "~ batch + condition", "sample_key": "donor", "contrast": "conditionTreated"},
 "embedding": {"use_rep": "X_pca", "n_dims": 30}, "test": {"solver": "irls_lrt", "fdr_weighting": "k_distance"},
 "output": {"key": "nhood_da", "annotation_key": "cell_type"}, "seed": 0}
```

```json
{"dataset": "/data/atlas.singlet", "status": "completed",
 "wrote": ["obsm/nhood_da_nhoods", "uns/nhood_da_nhood_results", "obs/nhood_da_nhood_logfc"],
 "summary": {"n_neighbourhoods": "<int>", "n_samples": "<int>", "n_spatial_fdr_le_alpha": "<int>",
   "solver": "irls_lrt", "fdr_weighting": "k_distance", "rule_met": "<bool>"},
 "provenance_id": "<id>", "job_id": null}
```

- **Long-running**: yes for large graphs and for `glmm`; the call may return `queued` with a `job_id`.
- **Stochastic**: yes, through index-cell sampling (`seed`); the fits are deterministic given the index set.
- **Dry-run**: estimated seconds and memory from $|V|=\mathrm{prop}\cdot N$, the sample count and the design rank, calibrated in P1.

## 8. Benchmarks

**Shared protocol.** Every benchmark uses the same pipeline: PCA of log-normalised counts without labels (30 components), a kNN graph with $k=10$, prop 0.1, index placement refined with $k=21$ (and neighbourhood $k=30$ as a sensitivity arm), TMM factors, design `~ condition` with replicate samples per condition, and $\alpha=0.1$. The pipeline never sees truth. Each setting is evaluated on replicate datasets. Per-replicate metrics are averaged with a 95 percent Monte Carlo interval, and the number of replicates is set so that the interval half-width of the primary FDP is at most 0.02. Stochastic steps use seeds 0 to 2.

### B1. Planted abundance in the miloR discrete simulator (proposed)

- **Goal**: estimate FDP and power for planted abundance shifts with known truth.
- **Ground truth**: planted simulation. Block 1 is documented as over-represented in condition A and block 4 in condition B. Index-cell truth is 1 for blocks 1 and 4; a sensitivity rule uses majority membership. The logFC truth is $\tau_v$ (Section 3.5), computed from simulation labels. Blocks 2 and 3 are not truth.
- **Replicate recipe (proposed)**: split each condition into $S_c\in\{2,3,5,10\}$ equal samples. Draw each sample's block shares from a Dirichlet with concentration 100 times the condition's shares, then draw cells by block without replacement from the condition pool, with replacement when a pool runs out. The documentation has no replicate samples, so the recipe supplies the replicate variance.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| `sim_discrete` simulated single-cell data | miloR `R/sim_discrete.R` (Section 12) | simulated scRNA-seq; 4 blocks, 2 conditions; cell count — | Section 12 | recipe above |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Neighbourhood FDP | among neighbourhoods with $\tilde q_v\le0.1$, the fraction with truth 0 (0 with no calls) | lower | primary | [R2] |
| Neighbourhood power | among truth-1 neighbourhoods, the fraction with $\tilde q_v\le0.1$ | higher | primary | [R1] |
| AUPRC | over all neighbourhoods, scored by $-\log_{10}p_v$ and by $-\log_{10}\tilde q_v$; ties averaged | higher | guardrail | — |
| logFC error | mean absolute difference between $\hat\beta_v$ and $\tau_v$ over truth-1 neighbourhoods, log2 | lower | guardrail | [R1] |

- **Comparators**: miloR QL path (`qlf`); pertpy `solver="pydeseq2"`; the default test with `fdr_weighting` `none`; cluster baseline at resolutions 0.5, 1 and 2, per abundance.celltype_proportion_test.
- **Protocol**: $S_c$ over the grid above, 20 replicate datasets per setting (proposed), seeds 0 to 2.
- **Acceptance criterion**: proposed. In planted settings, the default's power is at least the cluster baseline's power at matched FDP at most 0.10.
- **Known pitfalls**: a planted cell lies in about $\mathrm{prop}\cdot(k+1)$ neighbourhoods on average, so power is counted on index cells.

### B2. Null calibration by within-batch permutation on real data (proposed)

- **Goal**: check false-call control on real graphs when no abundance effect is planted and the batch structure is kept.
- **Ground truth**: consistency. Condition labels are permuted among samples within each batch, which makes the null hold by construction; the estimand is the call rate under the permuted labels, not a biological truth.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue studies with at least 10 samples, a batch column and at least two condition levels per batch | singlet catalogue; study list set in the benchmark registry | scRNA-seq; per study | per study | selection rule only; no study is named here |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Empirical false call rate | across permutations, the fraction of neighbourhoods with $\tilde q_v\le0.1$; report median and maximum | lower | primary | [R2] |
| Uniformity of p-values | Kolmogorov-Smirnov distance between uncorrected $p_v$ and Uniform(0,1), per permutation | lower | guardrail | [R1] |

- **Comparators**: miloR QL path; pertpy `solver="pydeseq2"`; `fdr_weighting` `none`; cluster baseline under the same permutation.
- **Protocol**: all distinct admissible within-batch permutations when there are at most 200; otherwise 200 random permutations (proposed). Batch stays in the formula. Report the number of distinct permutations.
- **Acceptance criterion**: proposed. Median empirical false call rate at most 0.10, and no setting above 0.12.
- **Known pitfalls**: permutation calibrates against the replicate variance that remains after the within-batch shuffle, not against all biological variance; few samples give a coarse grid of rates; large differences in sample cell totals can create artefactual counts, so library sizes are inspected.

### B3. Batch-confounded planted abundance (proposed)

- **Goal**: measure how FDP and power change with batch-condition overlap, batch in the design, and integration before graph construction.
- **Ground truth**: planted simulation on the B1 recipe, with a batch effect. Each batch multiplies every block's expected share by a gene-wise log-normal factor with standard deviation 0.5 on the log2 scale (proposed). The truth is $\tau_v$ as in B1. Overlap $q$ is the share of condition-B cells in batch 1, with the share $1-q$ of condition-A cells in batch 1; $q=0.5$ is balanced, and $q=1.0$ is full confounding, reported as not testable.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| `sim_discrete` recipe with a batch effect | miloR `R/sim_discrete.R` (Section 12) | simulated scRNA-seq; cell count — | Section 12 | overlap levels are design choices |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Neighbourhood FDP | as in B1 | lower | primary | [R2] |
| Neighbourhood power | as in B1 | higher | primary | [R1] |
| Batch-dominated call rate | among calls, the share with more than 80 percent of member cells from one batch; sensitivity at 70 and 90 percent | lower | guardrail | — |

- **Comparators**: design with and without batch; graph from PCA versus graph from an scVI embedding [R8].
- **Protocol**: three overlap levels, 20 replicate datasets per level (proposed), seeds 0 to 2.
- **Acceptance criterion**: proposed. With batch in the design and an integrated graph, FDP at most 0.10 at every identifiable overlap level. Failures are reported, not gated.
- **Known pitfalls**: full confounding leaves no within-batch condition contrast and is reported as not testable, not as a method failure. scVI can remove biology along with batch, and this benchmark does not measure that cost.

### B4. Few-replicate false-call and power curve (proposed)

- **Goal**: quantify FDP and power against the number of replicate samples per condition, and test the rule that the median neighbourhood holds at least three cells per sample.
- **Ground truth**: planted simulation on the B1 recipe, with $S_c\in\{2,3,5,10\}$ and neighbourhood size set by $k\in\{10,21,30\}$ (proposed). The planted effect is fixed.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| `sim_discrete` with the B1 recipe | miloR `R/sim_discrete.R` (Section 12) | simulated scRNA-seq; cell count — | Section 12 | replicate counts per condition are design choices |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Neighbourhood FDP against replicate count | as in B1, stratified by whether the median cells per sample is at least 3 | lower | primary | [R2] |
| Neighbourhood power against replicate count | as in B1, stratified the same way | higher | primary | [R1] |

- **Comparators**: miloR QL path; pertpy `solver="pydeseq2"`.
- **Protocol**: vary $S_c$ and $k$ independently with the planted effect fixed; record the rule for each neighbourhood set; 20 replicate datasets per cell (proposed).
- **Acceptance criterion**: proposed. FDP at most 0.10 when the rule holds; FDP and power are reported where it does not. The threshold of three is tested here, not assumed.
- **Known pitfalls**: few replicates make dispersions unstable, so the shrinkage behaviour is reported with the final FDP. Every setting has fewer than 60 samples, so the GLMM guard blocks the mixed path and GLMM rows are absent.

### P1. Performance and scaling

- **Scales**: $N=10^4$, $10^5$, $10^6$ and $10^7$ cells (proposed; $10^7$ because streaming is claimed); 20 samples; prop 0.1, and additionally 0.02 at $10^6$ cells.
- **Hold fixed**: graph $k=10$, neighbourhood $k=21$, $d=30$, the `irls_lrt` solver, seed 0.
- **Metrics**: wall-clock seconds per stage (graph, index sampling, counting, fits, SpatialFDR), peak memory in GB, and the neighbourhood count with mean neighbourhood size for each timing.
- **Comparators**: miloR QL path; pertpy `solver="pydeseq2"`, and its `edger` solver where R is available; singlet CPU and CUDA.
- **Acceptance criterion**: proposed. Fit time grows at most linearly in $|V|$ for fixed samples and rank; singlet CUDA is at least five times faster than singlet CPU for the fit stage at $10^6$ cells; identical neighbourhood tables for the same seed on one device.
- **Known pitfalls**: graph construction dominates at scale and is timed separately. Counting cost follows the non-zero count, about $\mathrm{prop}\cdot N\cdot(k+1)$.

## 9. Chaining

Used in the condition-comparison step after integration and graph construction.

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `integration.batch_corrected_embedding`: Batch-corrected joint embedding
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
- **Feeds**:
  - `markers-de.neighborhood_level_de`: Cluster-free neighbourhood-level differential expression between conditions
  - `abundance.phenotype_associated_cells`: Cell neighbourhoods whose abundance covaries with a sample-level phenotype
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
- **Reads**: `obsm/<use_rep>`, `obsp/<graph_key>`, `obs/<sample_key>`, `obs/<design_column>`, `obs/<annotation_key>`
- **Writes**: `obsm/<output_key>_nhoods`, `uns/<output_key>_nhood_counts`, `uns/<output_key>_nhood_results`, `obs/<output_key>_nhood_logfc`, `obs/<output_key>_nhood_annotation`, `models/<output_key>_nhood_glm`
<!-- CHAINING:AUTO:END -->

## 10. Risks, pitfalls and open questions

- **Primary sources outside the evidence**: the simulation design, comparators and numerical results of Dann et al. [R1] and of cydar [R2] are not in this document's evidence, so no published numerical benchmark is cited. The edgeR quasi-likelihood references are not in the local index, so the QL description rests on the miloR call sites. DA-seq's paper, supplement and code are not examined [R4].
- **Spatial weighting sign**: no derivation for kNN neighbourhoods is available. miloR weights by $1/t$ where $t$ is a distance for k-distance but an overlap count for graph-overlap (`R/graphSpatialFDR.R:111`, `:149`, `:159`), which reverses the density direction. The MCP enum therefore lists only k-distance and none until the sign is confirmed.
- **GLMM guard and simulators**: the code guard is N < 60 (`R/testNhoods.R:265-270`), while the roxygen says N < 50 (`R/testNhoods.R:66`). The Milo 2.0 preprint [R3] has no authors in the local record, and its model is not re-derived here. miloR's `sim_nbglmm` (50 samples, two random effects) is a candidate generator for a GLMM check, but its documentation does not define a neighbourhood-level truth.
- **Data gaps**: the cell count and replicate structure of `sim_discrete` are not in the documentation read here. `sim_trajectory` does not state which groups are abundance-shifted, so it is not used as truth. The Haber 2017 intestinal data [R7] used in the chapter workflow load through pertpy's `haber_2017_regions` loader and a lamindb artifact key rather than an accession (`scripts/conditions/compositional_dataset.ipynb`), and the local chapter material gives no reference direction of abundance change, so a direction check on them is not a benchmark [R9].
- **Proposals without a local source**: the p-value readings in Section 3.6, the three-cell rule in Section 6, the 75 percent annotation threshold, and the cluster-level comparator, which is described from the chapter's takeaways and the singlet task definition rather than a primary implementation.
- **First experiment**: perform B2 on one catalogue study with batch and at least 10 samples before any default is changed, then B1 with the replicate recipe to measure the default's FDP and power.

## 11. References

R1. Dann E, Henderson NC, Teichmann SA, Morgan MD, Marioni JC. Differential abundance testing on single-cell data using k-nearest neighbor graphs. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01033-z — verified (corpus)
R2. Lun ATL, Richard AC, Marioni JC. Testing for differential abundance in mass cytometry data. *Nature Methods* 2017. doi:10.1038/nmeth.4295 — verified (corpus)
R3. Milo2.0 unlocks population genetic analyses of cell state abundance using a count-based mixed model. *bioRxiv* 2023. doi:10.1101/2023.11.08.566176 — verified (corpus)
R4. Zhao J, Jaffe A, Li H, Lindenbaum O, Sefik E, Jackson R, Cheng X, Flavell RA, Kluger Y. Detection of differentially abundant cell subpopulations in scRNA-seq data. *Proceedings of the National Academy of Sciences* 2021. doi:10.1073/pnas.2100293118 — verified (corpus)
R5. Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. *Genome Biology* 2014. doi:10.1186/s13059-014-0550-8 — verified (corpus)
R6. Robinson MD, Oshlack A. A scaling normalization method for differential expression analysis of RNA-seq data. *Genome Biology* 2010. doi:10.1186/gb-2010-11-3-r25 — verified (corpus)
R7. Haber AL, Biton M, Rogel N, Herbst RH, et al. A single-cell survey of the small intestinal epithelium. *Nature* 2017. doi:10.1038/nature24489 — verified (corpus)
R8. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R9. Single-cell best practices, conditions chapter on compositional analysis (theislab/single-cell-best-practices; `jupyter-book/conditions/compositional_keytakeaways.txt`). GitHub repository. — verified (repo)
R10. Muzellec B, Teleńczuk M, Cabeli V, Andreux M. PyDESeq2: a python package for bulk RNA-seq differential expression analysis. *Bioinformatics* 2023. doi:10.1093/bioinformatics/btad547 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/MarioniLab/miloR | Mike Morgan (author, maintainer); Emma Dann (author, contributor) | GPL-3 (LICENSE file; DESCRIPTION: GPL-3 + file LICENSE) | Reference for the NB GLM, QL test, graph-spatial FDR, GLMM and the `sim_discrete` and `sim_nbglmm` data | reimplement (copyleft); QL path as callout |
| https://github.com/scverse/pertpy | Lukas Heumos (maintainer); Lilly May, Stefan Peidli, Johannes Ostner, Gregor Sturm, Emma Dann and others | MIT (LICENSE file, copyright 2021 Lukas Heumos); pyproject.toml points to the LICENSE file but carries an Apache Software License classifier; CITATION.cff states Apache-2.0 | Python Milo port: NB IRLS, likelihood-ratio test, SpatialFDR, GLMM | port |
| https://github.com/emdann/milopy | Emma Dann | MIT (LICENSE, setup.py) | Legacy Python interface; the README points to scverse/pertpy as the actively maintained implementation | callout (history only) |
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE copyright line) | Apache-2.0 (LICENSE) | Source of the compositional takeaways (replicate number and batch spread; methods for data that do not cluster) | callout (guidance only; no code reused) |
