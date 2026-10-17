---
id: ambient.count_removal
title: Ambient count removal
area: ambient
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [cell-calling.cell_vs_empty_droplet_calling]
feeds: [normalization.size_factor_estimation, feature-selection.highly_variable_gene_selection, markers-de.cluster_marker_ranking, ambient.marker_de_artifact_detection]
reads: [raw/counts, layers/counts, obs/is_cell, uns/ambient_profile, obs/ambient_frac_<method>, obs/<cluster_key>, var/<gene_mask_key>]
writes: [layers/decontaminated, layers/decontaminated_int, obs/ambient_removed_counts, obs/ambient_removed_fraction, uns/ambient_count_removal, models/<name>]
devices: [cpu, cuda]
mcp_tool: singlet_ambient_count_removal
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Ambient count removal

> Removes the cell-free (ambient) RNA contribution from each cell's UMI counts, returning a corrected count layer and per-cell removed-count estimates, with CellBender as the model-based default and DecontX, SoupX and scAR as comparators.

## 1. Question

Given a droplet-by-gene UMI matrix that includes empty barcodes, and a cell call per barcode, what are each cell's counts once the ambient contribution is removed, and how many UMIs were removed? A correct answer is a corrected matrix on the same genes and cells whose expectation equals the counts the cell would have produced without foreign molecules, plus the removed count per cell. The methods return expected (or integer-sampled) corrected counts and do not label individual UMIs as ambient. Ground truth exists only where native counts are known: planted simulations, and proxies such as foreign-species counts in single-species cells.

## 2. Why this task matters and where the field stands

Droplet platforms partition cells together with barcoded beads [R1]. Cells lysed during preparation release RNA that every droplet captures, including droplets holding an intact cell, so each cell's counts carry transcripts of the other cell types in the sample. Janssen et al. measure background at 3 to 35 percent of a cell's UMIs on average and find that most of it originates from ambient RNA [R2]. The SoupX documentation gives 2 to 50 percent across experiments, with about 5 percent usual (SoupX README, section 12).

Janssen et al. report that CellBender gives the most precise estimates of background and the largest gain in marker-gene detection [R2]. Cargnelli et al. compare seven methods on simulated, species-mixing and genotype-mixing data and find no method best across datasets and metrics, with CellBender, DecontX and SoupX generally performing well [R3]. Wang et al. report that DecontX and CellBender under-correct highly contaminating genes while SoupX and scAR over-correct genes with little or no contamination [R4].

The status is **contested**. Open problems:

- no method wins across datasets and metrics [R3];
- real-data ground truth covers contamination from other species or genotypes only [R2, R3]; same-cell-type ambient has none;
- gene-specific errors have opposite signs for different methods [R4];
- ambient-only models attribute barcode-swapped molecules to ambient RNA, and among the methods here only CellBender models swapping explicitly;
- per-cell removed counts have no accepted calibration test (B1 provides one);
- every method depends on the cell versus empty partition [R5];
- the deep models need a GPU for practical run times and training can fail to converge.

## 3. Theory and insight

**Estimand.** The output $\hat x_{gc}$ estimates the native count $n_{gc}$, the count cell $c$ would have produced with no foreign molecules in its droplet (ambient and, where modelled, barcode-swapped). The removed count is $r_c=\sum_g(x_{gc}-\hat x_{gc})$, which estimates the number of foreign UMIs $m_c$ in the cell. `ambient_removed_fraction` is $r_c/N_c$ (0 when $N_c=0$): the foreign share of the cell's UMIs, not the share contributed by another species or genotype (B2 and B3 relate the two).

| Symbol | Meaning |
|---|---|
| $x_{gd}$, $N_d=\sum_g x_{gd}$ | UMIs of gene $g$ in droplet $d$, and the droplet total |
| $a_g$ (or $\psi_g$) | ambient (soup) profile, $\sum_g a_g=1$ |
| $s^{\mathrm{emp}}_d$, $s^{\mathrm{cell}}_d$, $\epsilon_d$, $y_d$ | CellBender empty and cell UMI scales, droplet efficiency, cell indicator |
| $\chi_{gd}$, $\bar\chi_g$, $r_d$ | CellBender native profile, its average, and barcode-swap fraction |
| $\rho$, $\rho_c$ | contamination fraction: SoupX (one value per channel), scAR (per-cell noise ratio) |
| $\theta_c$, $\phi_{gk}$, $\eta_{gk}$ | DecontX native proportion of cell $c$, native profile of cluster $k$, contamination profile |

**CellBender: amortised generative model.** The ambient rate and native mean of droplet $d$ are

$$\lambda_{gd}=\epsilon_d\big[(1-r_d)\,s^{\mathrm{emp}}_d\,a_g+r_d\,\bar\chi_g\,(y_d s^{\mathrm{cell}}_d+s^{\mathrm{emp}}_d)\big],\qquad \mu_{gd}=(1-r_d)\,y_d\,\epsilon_d\,s^{\mathrm{cell}}_d\,\chi_{gd},$$

and the observed count is $x_{gd}=u_{gd}+v_{gd}$ with $u_{gd}\sim\mathrm{NB}(\mu_{gd},\varphi)$ (mean $\mu$, variance $\mu+\varphi\mu^2$, global $\varphi$ with a Gamma prior) and $v_{gd}\sim\mathrm{Poisson}(\lambda_{gd})$. The `ambient` variant sets $r_d=0$; $\varphi\to0$ gives the Poisson sum. The posterior over $(\mu,\lambda)$ is approximated by stochastic variational inference with an encoder over a latent $\mathbf z$. The default estimator does not return a posterior mean. For each gene it sets a removal target equal to the posterior-mean noise total plus `fpr` times the approximate signal total (raw minus mean noise), then chooses integer noise counts from the posterior by solving a multiple-choice knapsack problem. So `fpr` is a removal-target setting, not a calibrated error rate, and `fpr` = 0 removes the posterior-mean noise. The model holds when empty droplets share one profile and carry no cell material.

**Identification from empty droplets.** With $y_d=0$ and $r_d=0$, $\mathbb E[x_{gd}]=\epsilon_d s^{\mathrm{emp}}_d a_g$, so $a_g$ is proportional to the gene totals of empty droplets, and $\Pr(x_{gd}=0)=e^{-\lambda_{gd}}$ makes low-count droplets informative. Debris or cells left among the empties are absorbed into $a_g$.

**Conditional split.** In the Poisson-sum limit, given $x_{gd}$ the ambient part is $\mathrm{Binomial}(x_{gd},\lambda_{gd}/(\lambda_{gd}+\mu_{gd}))$. A corrector that uses one shared profile therefore errs most for genes whose ambient share is comparable to their native expression, the mechanism behind gene-specific over- and under-correction [R4].

**SoupX: global fraction, capped allocation.** `autoEstCont` estimates one $\rho$ per channel. Marker genes that are cluster-specific and abundant in the soup give, in clusters assumed not to express them, observed counts $\sim\mathrm{Poisson}(\rho N_k\psi_g)$. A Gamma prior (mode 0.05, standard deviation 0.10) gives a posterior per cluster and gene, and the mode of the aggregate is $\hat\rho$. Subtraction allocates the expected soup counts $\rho N_k$ of cluster $k$ over genes in proportion to $\psi_g$ with a cap at the observed count,

$$s_{gk}=\min\!\big(X_{gk},\,\tau_k\psi_g\big),\qquad \tau_k:\ \textstyle\sum_g s_{gk}=\rho N_k,$$

and then expands $s_{gk}$ to the cells of the cluster by the same capped allocation with weights $\rho_cN_c$, so $\hat x_{gc}=x_{gc}-s_{gc}\ge0$ without clipping. Pooling is accurate when the contamination fraction is constant within a cluster and clusters match cell types; without clusters `adjustCounts` warns that results will almost certainly be better with clustering.

**DecontX: per-cell mixture.** Each UMI of gene $g$ in cell $c$ of cluster $k$ is native with probability

$$\frac{\theta_c\phi_{gk}}{\theta_c\phi_{gk}+(1-\theta_c)\eta_{gk}},$$

and the corrected count is the count times this responsibility. The M-step sets $\phi_k$ to the normalised native mass of cluster $k$, $\theta_c=(\text{native mass}_c+\delta_1)/(N_c+\delta_1+\delta_2)$, and re-fits $\delta$ by Dirichlet maximum likelihood. $\eta_k$ is the native mass of the other clusters, or the empirical empty-droplet profile when a background is supplied. Without a background the model cannot represent contamination from the same cluster, and a single-cluster sample has no contamination profile.

**scAR: autoencoder with a fixed ambient profile.** A decoder gives each cell a noise ratio $\rho_c$ and native probabilities $p_{gc}$, and counts follow $x_{gc}\sim\mathrm{Binomial}(N_c,(1-\rho_c)p_{gc}+\rho_c a_g)$ by default (Poisson and zero-inflated Poisson are alternatives). The objective is the reconstruction likelihood plus the Gaussian KL divergence weighted by $10^{-5}$, so it is close to a deterministic autoencoder and its latent posterior should not be assumed calibrated. The corrected count is $N_c(1-\rho_c)p_{gc}$.

**Why heuristics work, and what a model adds.** SoupX's marker-based global estimate is low-dimensional and low-variance; its price is that clusters must match cell types and the fraction is shared by all cells. A model gives a posterior over removed counts, a noise model that can be simulated, an encoder reusable on new samples of the same chemistry, and places for covariates. It does not by itself give better accuracy [R3]; calibration is a hypothesis for B1.

**Pitfalls.**

- Errors in the cell-versus-empty partition propagate to every corrected cell [R5].
- Higher `fpr` removes more background and more signal (CellBender help text).
- Rounding to integers changes count statistics; downstream count models should use the real-valued layer.

Cost: DecontX and SoupX are $O(\mathrm{nnz})$ per iteration or allocation; CellBender and scAR are $O(E\,D\,G\,W)$ for $E$ epochs, $D$ droplets, $G$ genes and hidden width $W$.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CellBender remove-background | model-based | Amortised variational inference (Pyro) of a per-droplet generative model with negative-binomial native counts plus Poisson ambient and swap counts; per-gene removal targets set by `fpr`; integer denoised counts by multiple-choice knapsack | [R6] |
| DecontX | model-based | Per-cell Bayesian mixture of a cluster-native profile and a contamination profile, Dirichlet prior on the mixing proportion, fitted by EM; corrected count is count times native responsibility | [R8] |
| SoupX | heuristic | One contamination fraction per channel from soup-abundant, cluster-specific marker genes with a Gamma prior; capped proportional allocation of expected soup counts to clusters, then to cells | [R7] |
| scAR | model-based | Autoencoder (PyTorch) with per-cell noise ratio and native probabilities against a fixed ambient profile; binomial, Poisson or zero-inflated Poisson likelihood; corrected count is the expected native count | [R9] |

CellBender, DecontX and SoupX are the published standard: the multi-method benchmark reports them as generally performing well [R3], and SoupX is the method demonstrated in the single-cell best-practices book. They are the default comparators; scAR is the additional model-based comparator with a PyTorch code base. Gene-level correctors such as scCDC [R4] are outside the method enum (section 10).

Exact defaults of the methods singlet will implement:

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| CellBender | model | full | cellbender/remove_background/argparser.py:123 @ f36ae29 |
| CellBender | epochs | 150 | argparser.py:138 |
| CellBender | z_dim; encoder hidden layers | 64; [512] | argparser.py:152; :157 |
| CellBender | fpr | 0.01 | argparser.py:196 |
| CellBender | learning rate | 1e-4, OneCycle with maximum ten times the base | argparser.py:236 |
| CellBender | estimator | mckp | argparser.py:338 |
| CellBender | training attempts; ELBO-failure fractions; retry learning-rate multiplier | 1; unset; 0.2 | argparser.py:277; :252, 263; :286 |
| CellBender | low-count threshold | 5 UMIs | consts.py:27 |
| CellBender | cell probability cutoff | 0.5 | consts.py:23 |
| CellBender | overdispersion prior $\varphi$ | Gamma, mean 0.2, standard deviation 0.2 | consts.py:53-54; model.py:189-192 |
| CellBender | observation model | negative binomial plus Poisson convolution; Poisson-sum branch disabled | model.py:253, 324-358 |
| CellBender | per-gene removal target | mean noise + fpr × (raw − mean noise) | posterior.py:1642; run.py:261-281 |
| DecontX | maxIter | 500 (matrix wrapper); internal function 200 | R/decon.R:218; :335 @ fdb2651 |
| DecontX | delta; estimateDelta | c(10, 10); TRUE | R/decon.R:219-220 |
| DecontX | convergence; varGenes; dbscanEps | 0.001; 5000; 1 | R/decon.R:221, 223, 224 |
| DecontX | seed | 12345 | R/decon.R:225 |
| DecontX | background | replaces $\eta$ by empty-droplet totals plus 1e-20 | R/decon.R:726-732 |
| SoupX | tfidfMin; soupQuantile; maxMarkers | 1.0; 0.90; 100 | R/autoEstCont.R:40 @ 8d89492 |
| SoupX | contaminationRange; rhoMaxFDR | c(0.01, 0.8); 0.2 | R/autoEstCont.R:40 |
| SoupX | priorRho; priorRhoStdDev; forceAccept | 0.05; 0.10; FALSE | R/autoEstCont.R:40 |
| SoupX | soup profile range | barcodes with 0 < UMIs < 100 | R/estimateSoup.R:22 |
| SoupX | adjustCounts method; roundToInt | subtraction; FALSE | R/adjustCounts.R:33 |
| SoupX | fraction warning; stop | above 0.3; above 0.5 unless forceAccept | R/setProperties.R:82-86 |
| scAR | hidden layers; latent_dim; dropout; sparsity | 150, 100; 15; 0; 0.9 | scar/main/_scar.py:206-212 @ df7adef |
| scAR | count_model (training) | binomial | _scar.py:211 |
| scAR | batch_size; lr; lr_step_size; lr_gamma | 64; 1e-3; 5; 0.97 | _scar.py:403, 407-409 |
| scAR | kld_weight; epochs | 1e-5; 400 | _scar.py:406, 410 |
| scAR | inference: count_model_inf; adjust; round_to_int | poisson; micro; stochastic_rounding | _scar.py:547-550 |

## 5. Proposed singlet approach

- **Routes.** CellBender: port. DecontX: port, as a C++ core with CUDA kernels. SoupX: reimplement from [R7] and the documented defaults. scAR: port. Licences are in section 12.
- **Model-based formulation.** The default is the CellBender full model. singlet proposes one further model, an amortised per-droplet model with a Poisson-sum likelihood whose encoder maps a droplet's counts to a posterior over its native component, trained on droplets simulated from catalogue cells (B1 generator). It joins the method enum only if it passes B1 and B2. It is falsified if its median native recovery on B1 does not exceed the best of CellBender, DecontX and SoupX, or if SoupX or DecontX match its removed-count calibration on B1, because the claim is that per-droplet posterior removal is better calibrated.
- **Cell calls.** CellBender infers its own cell probabilities. The port uses `obs/is_cell` as the expected-cell prior and reports counts for barcodes with `is_cell` true. The other methods take the called cells as given. When `uns/ambient_profile` is absent, DecontX, SoupX and scAR use the normalised sum of non-cell barcodes with fewer than 100 UMIs.
- **ML stack.** Encoders and decoders use PyTorch, through Pyro for the CellBender port. Small hot models are hard-coded for CUDA and cuSPARSE: the DecontX EM (per-entry responsibilities over the non-zeros, column sums, Dirichlet maximum likelihood for $\delta$), the SoupX capped allocation (a segmented sort and scan per gene), and the profile and library-size sums.
- **Devices and streaming.** Sparse kernels are parallel over cells on CPU and use cuSPARSE on CUDA. CellBender's code runs on CPU without `--cuda` but is meant for a GPU (usage documentation). Given fixed profiles and cluster labels, the DecontX and SoupX per-cell updates are independent and can stream over cell chunks with profile sums accumulated across chunks; CellBender and scAR revisit the data every epoch and stream only by mini-batch.
- **Defaults without asking.** `method` cellbender, `cellbender.model` full, `cellbender.fpr` 0.01, `seed` 12345, `device` auto. Call `dry_run` first. Report `fpr` with every result. Set `keys.contamination` when `ambient.contamination_fraction` has been computed, and `keys.cluster` for `soupx`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | raw/counts | sparse int | droplet-by-gene UMI counts including empty barcodes; non-cell barcodes define the ambient profile when `keys.ambient_profile` is absent |
| read | layers/counts (`keys.layer`) | sparse int | cell-level counts to correct; define the output genes and cells |
| read | obs/is_cell (`keys.cell`) | bool | cell calls |
| read | uns/ambient_profile | float vector | ambient profile over genes summing to one; optional |
| read | obs/ambient_frac_<method> (`keys.contamination`) | float in [0,1] | per-cell contamination fraction from `ambient.contamination_fraction`; optional, `soupx` only |
| read | obs/<cluster_key> | string or int | cluster labels; see rules below |
| read | var/<gene_mask_key> | bool | genes to correct; optional |
| write | layers/decontaminated | float32 >= 0 | corrected counts $\hat x_{gc}$ on the genes and cells of the input layer; integer-valued for `cellbender`, real-valued for the others |
| write | layers/decontaminated_int | int32 >= 0 | with `output_integer`: stochastic rounding (floor plus Bernoulli of the fractional part), seeded by `seed` |
| write | obs/ambient_removed_counts | float32 >= 0 | $r_c=\sum_g(x_{gc}-\hat x_{gc})$ |
| write | obs/ambient_removed_fraction | float32 in [0,1] | $r_c/N_c$, 0 where $N_c=0$ |
| write | uns/ambient_count_removal | dict | method, resolved parameters, profile source, implementation commit, input hash |
| write | models/<name> | model artefact | trained weights for `cellbender` and `scar` |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "cellbender" | `cellbender`, `decontx`, `soupx`, `scar` | Correction method; options for the other methods are ignored. |
| `keys` | object | — | — | Names of the dataset members to read. |
| `keys.layer` | string | "counts" | — | Cell-level counts layer to correct; its genes and cells define the output. |
| `keys.cell` | string | "is_cell" | — | obs column of boolean cell calls. |
| `keys.ambient_profile` | string | "ambient_profile" | — | uns key of a precomputed ambient profile summing to one; when absent it is estimated from non-cell barcodes. |
| `keys.cluster` | string/null | null | — | obs column of cluster labels; required for soupx unless contamination is set, optional for decontx. |
| `keys.contamination` | string/null | null | — | obs column of per-cell contamination fractions from ambient.contamination_fraction; replaces the soupx estimate, ignored by other methods. |
| `keys.gene_mask` | string/null | null | — | var boolean column; only true genes are corrected and the others are copied unchanged. |
| `output_integer` | boolean | false | — | Also write layers/decontaminated_int by unbiased stochastic rounding of the corrected counts. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 12345 | min 0 | Random seed for training and rounding; ignored by soupx. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `cellbender` | object | — | — | Options for method cellbender. |
| `cellbender.model` | string | "full" | `full`, `swapping`, `ambient` | Noise model: ambient only, barcode swapping only, or both. |
| `cellbender.fpr` | number | 0.01 | min 0; < 1 | Target false-positive rate for signal removal; 0 for cohorts analysed jointly for differential expression. |
| `cellbender.epochs` | integer | 150 | min 1 | Training epochs. |
| `cellbender.learning_rate` | number | 0.0001 | > 0 | Base learning rate; the OneCycle schedule peaks at ten times this value. |
| `cellbender.z_dim` | integer | 64 | min 1 | Latent dimension of the encoder. |
| `cellbender.low_count_threshold` | integer | 5 | min 0 | Barcodes with fewer UMIs are excluded from training. |
| `decontx` | object | — | — | Options for method decontx. |
| `decontx.max_iter` | integer | 500 | min 1 | Maximum EM iterations. |
| `decontx.delta` | array | [10, 10] | — | Dirichlet pseudocounts for native and contamination counts. |
| `decontx.estimate_delta` | boolean | true | — | Re-fit delta at every iteration by Dirichlet maximum likelihood. |
| `decontx.convergence` | number | 0.001 | > 0 | Stop when the largest change in contamination proportions falls below this value. |
| `decontx.var_genes` | integer | 5000 | min 1 | Variable genes used for internal clustering when keys.cluster is null. |
| `soupx` | object | — | — | Options for method soupx (subtraction adjustment). |
| `soupx.tfidf_min` | number | 1.0 | min 0 | Minimum tf-idf of a marker gene. |
| `soupx.soup_quantile` | number | 0.9 | > 0; < 1 | Only genes at or above this quantile of soup expression are used as markers. |
| `soupx.max_markers` | integer | 100 | min 1 | Maximum number of marker genes kept. |
| `soupx.contamination_range` | array | [0.01, 0.8] | — | Lower and upper bound of the estimated contamination fraction. |
| `scar` | object | — | — | Options for method scar. |
| `scar.latent_dim` | integer | 15 | min 1 | Latent dimension of the autoencoder. |
| `scar.epochs` | integer | 400 | min 1 | Training epochs. |
| `scar.batch_size` | integer | 64 | min 1 | Mini-batch size. |
| `scar.count_model` | string | "binomial" | `binomial`, `poisson`, `zeroinflatedpoisson` | Likelihood of the observed counts. |
<!-- PARAMS:AUTO:END -->

Rules across parameters: `keys.cluster` is required for `soupx` unless `keys.contamination` is set (the supplied fractions then replace $\hat\rho$) and optional for `decontx` (otherwise internal UMAP and DBSCAN clustering on `decontx.var_genes` variable genes). Options of methods that are not selected are ignored. `seed` is ignored by `soupx`. `cellbender.fpr` takes one value per call; 0 is intended for cohorts analysed jointly for differential expression. `soupx` runs the subtraction adjustment only. Genes outside `keys.gene_mask` are copied unchanged.

## 7. MCP tool

Tool name `singlet_ambient_count_removal` (definition in `tasks/mcp/singlet_ambient_count_removal.json`). Example call and compact result (angle-bracket fields are placeholders for the shape):

```json
{"dataset": "/data/pbmc_channel_03.singlet", "method": "decontx",
 "keys": {"cluster": "cluster"}, "device": "cpu", "seed": 12345}
```

```json
{"dataset": "/data/pbmc_channel_03.singlet", "status": "completed",
 "wrote": ["layers/decontaminated", "obs/ambient_removed_counts", "obs/ambient_removed_fraction", "uns/ambient_count_removal"],
 "summary": {"method": "decontx", "device": "cpu", "profile_source": "non_cell_barcodes", "n_cells": "<int>",
   "removed_fraction_median": "<float>", "removed_fraction_p90": "<float>", "warnings": []},
 "provenance_id": "<id>", "job_id": null}
```

- **Long-running**: `cellbender` and `scar` return `queued` with a `job_id` when the dry-run estimate exceeds the inline limit; `decontx` and `soupx` complete inline at moderate sizes.
- **Stochastic**: yes for `cellbender`, `decontx` and `scar` through `seed`, and for `output_integer`; `soupx` is deterministic.
- **Dry-run estimate**: `seconds`, `peak_memory_gb` and `device` from a cost model over droplets, non-zeros and clusters (`soupx`, `decontx`) or droplets, epochs and width (`cellbender`, `scar`).

## 8. Benchmarks

**Shared protocol.** Every method runs with the section 4 defaults on the same raw droplet matrix, cell calls and ambient-profile source, at the commits in section 4 (CellBender f36ae29, DecontX fdb2651, SoupX 8d89492, scAR df7adef). `soupx` and `decontx` receive the same clusters from `clustering.cell_partitioning`. Stochastic methods use seeds 12345, 12346 and 12347 and report the median with the range. Comparators in every benchmark are raw counts (baseline), CellBender (full model, `fpr` 0.01), DecontX, SoupX and scAR, and every metric is computed on `layers/decontaminated`. Per-cell metrics are medians over cells. Record device, GPU type, CPU threads and commit. "Proposed" marks generators and thresholds that singlet defines; they are design choices, not literature values.

### B1. Planted-truth recovery and removed-count calibration

- **Goal**: whether corrected counts approach the native counts and removed counts match the planted ambient counts.
- **Ground truth**: planted simulation; the truth is the native count $n_{gc}$ and, for the catalogue simulation, the planted ambient count $m_c=\sum_g m_{gc}$ per cell.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| s7 | CellBender benchmarking workflow: `gs://broad-dsde-methods-sfleming/cellbender_test/s7.h5`, `s7_truth.h5` | simulated scRNA-seq, hgmm-like; size — | — | truth is layer `truth` in the CellBender report |
| Catalogue simulation | recipe below, from the singlet catalogue | scRNA-seq; 10,000 cells and 50,000 empty droplets per draw | — | — |

  Recipe (proposed): (1) annotated cells of one tissue with at least 2,000 UMIs and under 10 percent mitochondrial UMIs; (2) UMI-normalised mean profile $\bar p_{tg}$ per annotated type $t$; (3) draw 10,000 source cells with replacement and take their observed counts as $n_{gc}$; (4) $a_g=\sum_t w_t\bar p_{tg}$, $w_t\propto$ abundance times mean UMIs; (5) per droplet, $s_d\sim\mathrm{LogNormal}(\log s_{\mathrm{med}},0.3)$ with $s_{\mathrm{med}}\in\{50,150,500,1500\}$, $M_d\sim\mathrm{Poisson}(s_d)$ and $m_{\cdot d}\sim\mathrm{Multinomial}(M_d,a)$; (6) $x_{\cdot c}=n_{\cdot c}+m_{\cdot c}$ for cells and $x_{\cdot d}=m_{\cdot d}$ for empties. Three replicates per setting; report realised ambient share.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Native recovery | median over cells of the Pearson correlation of $\log(1+\hat x_{gc})$ with $\log(1+n_{gc})$ over genes with $x_{gc}>0$ | higher | primary | singlet |
| Absolute-error ratio | $\sum_{g,c}\lvert\hat x_{gc}-n_{gc}\rvert\,/\sum_{g,c}\lvert x_{gc}-n_{gc}\rvert$ | lower | guardrail | singlet |
| Removed-count calibration | median of $r_c/m_c$ and correlation of $r_c$ with $m_c$ across cells; catalogue only | ratio near 1; correlation higher | guardrail | proposed |

- **Acceptance criterion** (proposed): for the default on s7 and on catalogue settings with realised ambient share at least 0.03, absolute-error ratio at most 0.8, native recovery at least 0.05 above raw, calibration ratio within [0.8, 1.25] and correlation at least 0.8.
- **Known pitfalls**: simulators from the CellBender family favour that model, hence the catalogue simulation resamples real cells; its truth is native counts plus their source background.

### B2. Species mixing on hgmm12k

- **Goal**: how much cross-species signal remains in single-species cells after correction, and how much same-species signal is lost.
- **Ground truth**: orthogonal measurement. A gene's species is its gene-id prefix (`hg19_` for human, otherwise mouse). A cell is a mouse (human) cell when its raw Cell Ranger UMIs from mouse (human) genes exceed 750, and a multiplet when both exceed 750 (CellBender benchmarking notebook). In a single-species cell every UMI of the other species is foreign (ambient, swapped or cross-mapped). The estimand is the cross-species fraction $f_c=\sum_{g\in\bar s(c)}\hat x_{gc}/\sum_g\hat x_{gc}$ over cells with a non-zero total. On raw counts it is the foreign-species share of the ambient pool times the total ambient fraction, so it lower-bounds the total fraction, since same-species ambient is invisible.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| hgmm12k | 10x Genomics public dataset "12k 1:1 Mixture of Fresh Frozen Human (HEK293T) and Mouse (NIH3T3) Cells", v2 chemistry, Cell Ranger 2.1.0; raw matrix `hgmm_12k_raw_gene_bc_matrices.h5` listed in `benchmarking/submit_benchmarks.py` | scRNA-seq, human and mouse; size — | — | called cells are the filtered Cell Ranger set |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cross-species fraction | median of $f_c$ over single-species cells, as a ratio to the raw median; the notebook plots the per-cell distribution | lower | primary | CellBender notebook |
| Same-species retention | $\sum_c\sum_{g\in s(c)}\hat x_{gc}\,/\sum_c\sum_{g\in s(c)}x_{gc}$ | higher | guardrail | proposed |
| Removed-fraction agreement | Spearman correlation across single-species cells of `ambient_removed_fraction` with the raw $f_c$; reported for methods whose removed fraction varies across cells | higher | guardrail | proposed |

- **Protocol**: repeat with multiplet cut-offs of 500 and 1,000 UMIs.
- **Acceptance criterion** (proposed): for the default method, median cross-species fraction at most 0.5 of raw, retention at least 0.90, and agreement at least 0.5 for CellBender, DecontX and scAR.
- **Known pitfalls**: homologous sequence makes some cross-mapped counts look foreign; swapped molecules count as foreign, and only CellBender's full model targets them.

### B3. Cross-genotype contamination in pooled mouse kidney

- **Goal**: whether the removed fraction tracks an independent measurement of contamination from other genotypes [R2].
- **Ground truth**: orthogonal measurement. Each channel pools kidney cells from three mice (CAST/EiJ, C57BL/6J, 129S1/SvImJ) and cells are assigned to mice by known homozygous SNPs [R2]. For cell $c$ of genotype $s$, $g_c$ is the fraction of SNP-informative UMIs carrying another genotype; the total ambient fraction is estimated as $\rho_c=g_c/(1-\omega_s)$, where $\omega_s$ is genotype $s$'s share of informative UMIs in empty droplets. This is singlet's operationalisation of the design in [R2]; swapped molecules count as foreign.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pooled mouse kidney channels | Janssen et al. [R2]; accession — | 10x scRNA-seq, mouse; replicates and cell counts — | — | one channel per replicate |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Channel-level error | per replicate, $\lvert\bar r-\bar\rho\rvert/\bar\rho$ with $\bar r$ the mean `ambient_removed_fraction` and $\bar\rho$ the mean $\rho_c$ | lower | primary | proposed |
| Cell-level agreement | Pearson correlation across cells of `ambient_removed_fraction` with $\rho_c$; undefined for methods with a constant removed fraction | higher | guardrail | proposed |

- **Acceptance criterion** (proposed): channel-level error at most 0.25 for the default in every replicate; cell-level agreement at least 0.5 for CellBender, DecontX and scAR.
- **Known pitfalls**: informative-UMI sampling noise makes $g_c$ noisy in shallow cells and attenuates the cell-level correlation; genotype calls depend on SNP coverage.

### P1. Performance and scaling

Wall time for profile estimation and for correction separately, peak host and GPU memory, and throughput in droplets per second, on CPU and CUDA, at 10^4, 10^5 and 10^6 cells with 200,000 empty droplets (design scales, built with the B1 generator). Comparators: CellBender on GPU with 150 epochs and on CPU, DecontX with `max_iter` 500, SoupX subtraction, scAR with 400 epochs; the CellBender benchmarking workflow of five parallel GPU jobs takes 1 to 2 hours on T4 GPUs (`benchmarking/README.md`). Hold fixed the matrix, cell calls, seed, CPU threads, GPU type and defaults. Acceptance criterion (proposed): DecontX and SoupX wall time grows at most 1.5 times faster than the non-zero count between consecutive scales on CPU and CUDA, and the singlet CellBender port matches the reference wall time within a factor of 1.2 on the same GPU at 10^5 cells.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
- **Feeds**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `ambient.marker_de_artifact_detection`: Ambient-driven marker and DE artifact detection
- **Reads**: `raw/counts`, `layers/counts`, `obs/is_cell`, `uns/ambient_profile`, `obs/ambient_frac_<method>`, `obs/<cluster_key>`, `var/<gene_mask_key>`
- **Writes**: `layers/decontaminated`, `layers/decontaminated_int`, `obs/ambient_removed_counts`, `obs/ambient_removed_fraction`, `uns/ambient_count_removal`, `models/<name>`
<!-- CHAINING:AUTO:END -->

Named workflow (proposed): cell calling, optional ambient-profile and contamination-fraction estimation, this task, then size factors and feature selection. Count removal precedes normalisation when ambient RNA is present.

## 10. Risks, pitfalls and open questions

- **Benchmark papers.** [R2], [R3] and [R4] were matched at the level of title, authors, venue and abstract findings; their accessions, sizes, replicate counts and metric definitions were not read. The metric definitions of B1 and B3 and the guardrails of B2 are singlet's, and the accession of the pooled mouse-kidney data of [R2] is unknown, so B3 cannot be executed until it is located.
- **Methods outside the enum.** FastCAR and scCDC [R4] are omitted because their code was not read. The gene-level truth benchmark of [R4] and a null-comparison false-positive differential-expression benchmark are therefore not reproduced.
- **s7 provenance.** The repository does not describe how s7 was generated; its truth content is inferred from how the CellBender report loads it.
- **Port risks.** CellBender training can fail to converge; the reference retries (learning rate times 0.2) only when an ELBO-failure fraction is set, and none is set by default. DecontX's M-step calls the R package MCMCprecision for the Dirichlet maximum likelihood (`src/DecontX.cpp`), which a port must reimplement. CellBender's default estimator returns integer counts from a knapsack rather than a posterior mean, so its layer is a sample-like estimate while the other layers are expected values.
- **Data licences.** Licences of hgmm12k, s7 and the data of [R2] are not recorded.
- **First experiment.** B1 on s7 and the four catalogue settings with CellBender, DecontX and SoupX, then B2.

## 11. References

R1. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — verified (corpus)
R2. Janssen P, Hellmann I, et al. The effect of background noise and its removal on the analysis of single-cell expression data. *Genome Biology* 2023;24:140. doi:10.1186/s13059-023-02978-x — partial (search)
R3. Cargnelli CB, Nielsen JV, Madsen JGS. Benchmarking computational decontamination of ambient RNA. *bioRxiv* 2026. doi:10.64898/2026.01.13.699237; journal version *Frontiers in Bioinformatics* 2026, doi:10.3389/fbinf.2026.1844838 — verified (search)
R4. Wang W, Cen Y, Lu Z, Xu Y, Sun T, Xiao Y, Liu W, Li JJ, Wang C. scCDC: a computational method for gene-specific contamination detection and correction in single-cell and single-nucleus RNA-seq data. *Genome Biology* 2024;25. doi:10.1186/s13059-024-03284-w — verified (search)
R5. Lun ATL, Riesenfeld S, Andrews T, Dao TP, Gomes T, Marioni JC. EmptyDrops: distinguishing cells from empty droplets in droplet-based single-cell RNA sequencing data. *Genome Biology* 2019. doi:10.1186/s13059-019-1662-y — verified (corpus)
R6. Fleming SJ, Chaffin MD, Arduini A, Akkad AD, Banks E, Marioni JC, Philippakis AA, Ellinor PT, Babadi M. Unsupervised removal of systematic background noise from droplet-based single-cell experiments using CellBender. *Nature Methods* 2023. doi:10.1038/s41592-023-01943-7 — verified (repo)
R7. Young MD, Behjati S. SoupX removes ambient RNA contamination from droplet-based single-cell RNA sequencing data. *GigaScience* 2020. doi:10.1093/gigascience/giaa151 — verified (corpus)
R8. Yang S, Corbett SE, Koga Y, Wang Z, Johnson WE, Yajima M, Campbell JD. Decontamination of ambient RNA in single-cell RNA-seq with DecontX. *Genome Biology* 2020. doi:10.1186/s13059-020-1950-6 — verified (corpus)
R9. Sheng C, Lopes R, Li G, Schuierer S, Waldt A, Cuttat R, Dimitrieva S, Kauffmann A, Durand E, Galli GG, Roma G, de Weck A. Probabilistic machine learning ensures accurate ambient denoising in droplet-based single-cell omics. *bioRxiv* 2022. doi:10.1101/2022.01.14.476312 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/broadinstitute/CellBender | Stephen Fleming, Mehrtash Babadi (pyproject.toml) | BSD-3-Clause (LICENSE file; pyproject.toml "BSD (3-Clause)"); commit f36ae29 | reference implementation of the default model and of the benchmarking workflow | port |
| https://github.com/campbio/decontX | Yuan Yin, Masanao Yajima, Joshua Campbell (DESCRIPTION; maintainer Campbell); version 1.10.0, commit fdb2651 | MIT (DESCRIPTION and LICENSE file) | reference implementation of the mixture and EM | port |
| https://github.com/constantAmateur/SoupX | Matthew Daniel Young (DESCRIPTION; author and maintainer); version 1.6.2, commit 8d89492 | GPL-2 (DESCRIPTION; no LICENSE file) | reference for `autoEstCont`, `adjustCounts` and the contamination range quoted in section 2 | reimplement |
| https://github.com/Novartis/scAR | Caibin Sheng (pyproject.toml); version 0.7.0, commit df7adef | MIT (docs/License.rst, copyright 2022 Novartis; pyproject.toml "MIT License"; no LICENSE file at the root) | reference implementation of scAR and its defaults | port |
