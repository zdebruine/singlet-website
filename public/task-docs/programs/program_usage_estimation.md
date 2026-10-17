---
id: programs.program_usage_estimation
title: Per-cell usage of fitted gene programs
area: programs
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [programs.denovo_program_decomposition, programs.program_number_selection, feature-selection.highly_variable_gene_selection]
feeds: [programs.identity_activity_program_labeling, programs.cross_dataset_program_reproducibility, programs.program_annotation]
reads: [layers/counts, varm/<loadings>, uns/<loadings>_meta, models/<loadings>]
writes: [obsm/<name>_usage, obsm/<name>_usage_norm, obs/<name>_coverage, obs/<name>_recon_err, uns/<name>_refit]
devices: [cpu, cuda]
mcp_tool: singlet_programs_program_usage_estimation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Per-cell usage of fitted gene programs

> Given gene programs fitted once on discovery cells, estimates how much of each program every cell uses, returns both the raw usages and their composition, and flags cells that the fixed programs explain poorly.

## 1. Question

Given a genes-by-programs loading matrix fitted on discovery cells, how much of each program does each cell use, on the discovery cells or on new cells that share the reference genes? A correct answer is the cell's program composition under the measurement model the loadings were fitted with, reported with its scale and normalisation, together with a residual that flags cells the fixed programs explain poorly. The loadings are not re-learned here; that belongs to programs.denovo_program_decomposition.

## 2. Why this task matters and where the field stands

Programs fitted on one collection are useful only if they can be read out on other cells: the discovery cells after filtering, a later batch, a query dataset or a catalogue-scale collection. The default route is a least-squares refit of cell usages against stored spectra, the final step of consensus NMF [R1]. Probabilistic alternatives hold the program parameters fixed and fit a Gamma-Poisson posterior per cell [R2], or train an amortised encoder whose decoder is masked by gene-set membership [R3, R4]. Reference-mapping methods place query cells on clusters or labels rather than on programs [R5, R6].

Status: **contested**. Methods differ in loss, scaling and output scale, and no normalisation is standard. The open problems are:

- Usage scale is set by the normalisation of the loadings, so usages from different methods are not comparable without row normalisation.
- Cells whose state is absent from the reference are forced onto existing programs, and no residual threshold for flagging them is established.
- Batch or platform shift changes gene-level means and biases usages, while any correction must leave the meaning of a usage unchanged.
- The nearest published evaluation of reference mapping [R7] scores where query cells fall in an embedding; it does not score usages.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $G$, $K$ | number of genes in the fitted gene set, number of programs |
| $x_c \in \mathbb{R}_{\ge 0}^G$ | cell $c$: raw counts for the likelihood methods; depth-normalised, SD-scaled values for the least-squares refit |
| $S \in \mathbb{R}^{K\times G}$ | fixed loadings (spectra), one row per program, in the units of the refit |
| $\beta_k = S_k/\sum_g S_{kg}$ | program $k$ as a distribution over genes |
| $u_c \in \mathbb{R}_{\ge 0}^K$ | usage vector of cell $c$ |
| $\theta_c = u_c/\sum_k u_{ck}$ | composition of cell $c$, on the simplex $\Delta^{K-1}$ |

With $S$ fixed, each cell is an independent estimation problem. The estimators below differ in their loss and in what they return.

**Least-squares refit (cNMF).** The usage is

$$\hat u_c=\arg\min_{u\ge 0}\;\lVert x_c-S^{\top}u\rVert_2^2 .$$

This is a convex quadratic programme with a unique solution when the rows of $S$ are linearly independent. It is the maximum-likelihood estimate under independent Gaussian noise on $x_c$. For counts the noise variance grows with the mean, so an unweighted fit gives high-mean genes the most influence; the fit is first-order valid only where counts per gene are large after scaling. The code also accepts other $\beta$-divergences (cnmf.py:334), which are not least squares; this document uses only the Frobenius case.

**Composition likelihood.** The multinomial log-likelihood of a cell with library size $n_c=\sum_g x_{cg}$ is

$$\ell_c(\theta_c)=\sum_g x_{cg}\log\Big(\sum_k\theta_{ck}\beta_{kg}\Big),\qquad \theta_c\in\Delta^{K-1}.$$

The inner sum is affine in $\theta_c$ with non-negative coefficients, so $\ell_c$ is concave and every local maximum is global. The maximiser is unique when the program profiles over the observed genes span $\mathbb{R}^K$. A Poisson model with its own library-size term has the same maximiser on the simplex, because its total mean equals the library size for every $\theta$ there. The estimand is the composition $\theta_c$, which carries no scale.

**Gamma-Poisson posterior (scHPF).** The model is $x_{cg}\sim\mathrm{Poisson}(\sum_k\theta_{ck}\beta_{kg})$ with $\theta_{ck}\sim\mathrm{Gamma}(a,\xi_c)$, where $\xi_c$ is a cell-level capacity and the gene-level parameters carry their own capacities. Projection freezes the gene-level parameters and refits $\xi_c$ and $\theta_c$ for new cells (scHPF_.py:448-493). The regime is the mean-field factorisation, which tends to understate posterior variance when programs are correlated.

**Amortised encoder (expiMap).** The decoder is $\hat x_c=f\big((M\odot W)\,z_c\big)$, where $M\in\{0,1\}^{G\times K}$ is the gene-set mask. It is trained on the reference by maximising $\mathbb{E}_{q(z\mid x)}[\log p(x\mid z)]-\mathrm{KL}\big(q(z\mid x)\,\Vert\,\mathcal{N}(0,I)\big)$, with a group-lasso penalty on the decoder's gene-set terms (expimap_model.py:193). The regime is the amortisation gap: the encoder is accurate only where the query resembles the reference.

**Assignments are not usages.** Symphony's soft assignment $R_{kq}\propto\exp\{-2(1-c_k^{\top}\tilde z_q)/\sigma\}$ is normalised over reference clusters for each query cell, and scmap returns labels or thresholded similarities. Both are cell-to-cluster quantities and cannot be read as program usages.

**Estimands.** Each output is one quantity, defined once here.

- `usage`: $\hat u_{ck}$ in the units of $x_c$ and $S$, not normalised; its scale follows the loading normalisation.
- `usage_norm`: $\hat\theta_{ck}=\hat u_{ck}/\sum_{k'}\hat u_{ck'}$; cells with zero total usage keep a zero row and are counted in the summary.
- scHPF: the posterior mean of $\theta_{ck}$ in the units of the gene-level parameters, normalised to a composition for `usage_norm`.
- expiMap: the signed encoder mean $z_{ck}$ in units of the $\mathcal{N}(0,I)$ prior, rectified at zero only when `rectify` is set.
- `coverage`: per cell, $\sum_{g\in G_{\mathrm{ref}}}x_{cg}/\sum_g x_{cg}$, the share of the cell's counts on reference genes.
- `recon_err`: for the refit, $\lVert x_c-S^{\top}\hat u_c\rVert_2/\lVert x_c\rVert_2$; for likelihood methods, the Poisson deviance per gene.

| Family | Assumptions | Failure modes |
|---|---|---|
| Least-squares refit | Query programs are among the fitted programs; same genes and scaling | Zero-filled genes shift usage; SDs taken from the query rather than the reference; collinear programs make splits unstable; novel states forced onto programs |
| Gamma-Poisson projection | Discovery count model holds for the query | Shrinkage toward the prior for cells with few counts; understated intervals under correlated programs |
| Amortised encoder | Query cells lie near the reference distribution | Amortisation gap for states absent from the reference; signed latent values |
| Assignment (Symphony, scmap) | Clusters or labels exist in the reference | Not usages; misread as usages |

With the basis fixed, each cell is a small convex problem, so the loss, the scaling and the gene set matter more than the optimiser. Usages can be compared across methods only on the composition, and a claim of calibration needs planted or held-out truth (section 8). Pitfalls shown by benchmark studies are reported for the mapping benchmark: its reconstruction metric was dropped for limited effective range and inconsistency with other mapping metrics (analysis/01-metric-selection.Rmd:1750 of [R7]), so no single score should decide the default.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| cNMF refit (NNLS with fixed spectra) | model-based | Per-cell non-negative least squares on SD-scaled TPM against stored spectra | [R1] |
| scHPF projection | model-based | Frozen gene parameters; variational refit of cell capacities and usages | [R2] |
| expiMap encoder | model-based | Amortised encoder with a gene-set-masked linear decoder; encoder mean as usage | [R3, R4] |
| Symphony projection | heuristic | PCA loading projection, soft cluster assignment, ridge batch correction | [R5] |
| scmap projection | heuristic | Nearest-neighbour similarity to reference cells (scmapCell) or to cluster centroids (scmapCluster) | [R6] |

The published standard for usages is the cNMF refit [R1], the default here because this task assumes loadings from the cNMF discovery fit. Symphony [R5] and scmap [R6] are the standards for mapping query cells, but they assign clusters or labels, so they are kept as comparators only. A joint method that refits the spectra on the query is excluded because it does not hold the basis fixed.

| Method | Parameter | Value | Source |
|---|---|---|---|
| cNMF refit | beta_loss | `frobenius` | cnmf.py:334 @5dbc5ba |
| cNMF refit | alpha_usage | 0.0 | cnmf.py:335 @5dbc5ba |
| cNMF refit | solver | `cd` when beta_loss is frobenius; `mu` otherwise | cnmf.py:629-631 @5dbc5ba |
| cNMF refit | tol, l1_ratio | 1e-4, 0.0 | cnmf.py:624, 621 @5dbc5ba |
| cNMF refit | iteration cap | 1000 (max_NMF_iter) | cnmf.py:335 @5dbc5ba |
| cNMF refit | H fixed | `update_H=False` | cnmf.py:794-796 @5dbc5ba |
| cNMF refit | spectra and input scaling | median spectra normalised to distributions; the final refit scales HVG TPM by its own SD and divides spectra by the stored SD | cnmf.py:915-916, 961-975 @5dbc5ba |
| cNMF discovery | num_highvar_genes | 2000 | cnmf.py:334 @5dbc5ba |
| scHPF projection | min_iter, max_iter, check_freq | 2, 50, 2 | scHPF_.py:448-449 @df4cb46 |
| scHPF projection | max_iter in docstring | 10; the signature governs | scHPF_.py:467 @df4cb46 |
| scHPF projection | gene parameters | frozen (`freeze_genes=True`) | scHPF_.py:493 @df4cb46 |
| expiMap encoder | mask_key, soft_mask | `I`, `False` | expimap_model.py:86, 88 @d35cde6 |
| expiMap encoder | n_ext, n_ext_m | 0, 0 | expimap_model.py:89-90 @d35cde6 |
| expiMap encoder | latent read-out | encoder mean, optionally active terms only | expimap_model.py:251 @d35cde6 |
| Symphony (comparator) | sigma | 0.1 | mapQuery.R:28 @7c59059 |
| Symphony (comparator) | missing reference genes | zero-filled | mapQuery.R:48-52 @7c59059 |

## 5. Proposed singlet approach

Routes follow licence class (names in section 12). **Port**: `nnls_frobenius` from cNMF, `schpf_project` from scHPF, `expimap_encode` from scArches. **Callout**: Symphony and scmap, used only as comparators in B1 and P1.

The principle is to project with the measurement model the loadings were fitted with: the Frobenius refit for cNMF loadings, the Gamma-Poisson projection for scHPF state, and the encoder for an expiMap model. The default is `nnls_frobenius`, which is deterministic, matches the discovery fit and solves a convex problem exactly. `schpf_project` returns posterior means and their spread and is the candidate default for composition-level questions. The default moves to it only if B2 and B4 both favour it. The proposal is falsified in two ways: if its B2 matched correlation or B4 deviance is not better than the NNLS refit at comparable cost, the default stays; if nominal 90% intervals cover the planted composition in fewer than 80% of cases, the uncertainty claim is withdrawn and the method is reported as a point estimator.

The NNLS refit is a K-variable quadratic programme per cell with a fixed Gram matrix $SS^{\top}$ of size $K\times K$. The linear term $Sx_c$ is one sparse-dense product for all cells, so the work is $O(\mathrm{nnz}\cdot K)$ plus a small solve per cell. This is a small, hot kernel: a hard-coded CUDA batched solver with cuSPARSE for the product is proposed, with a dependency-free C++ active-set solver as the CPU path. The expiMap encoder evaluation uses PyTorch; the scHPF update is a short fixed-point loop that stays in C++ or CUDA if P1 shows framework overhead. Cells are independent, so every path streams over chunks.

Scaling uses the stored discovery SDs (`reference_stats`), never the query's own SDs. cNMF scales each matrix by its own SD (cnmf.py:967), which equals the reference SD only on the discovery cells. Defaults an agent uses without asking: `method` nnls_frobenius, `missing_gene_policy` error, `device` auto, `name` program, both usage forms written, and `rectify` true for expiMap. Changing the default method requires the B2 and B4 result.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int or float | raw UMI counts; scaled internally with stored SDs |
| read | varm/<loadings> | float, genes × K | stored spectra for nnls_frobenius |
| read | uns/<loadings>_meta | struct | gene order, stored SDs, normalisation, fit version and commit |
| read | models/<loadings> | model state | scHPF or expiMap state for schpf_project and expimap_encode |
| write | obsm/<name>_usage | float32, cells × K | raw usage in the units of section 3 |
| write | obsm/<name>_usage_norm | float32, cells × K | composition; each row sums to one or is zero |
| write | obs/<name>_coverage | float32 | share of the cell's counts on reference genes |
| write | obs/<name>_recon_err | float32 | relative residual or per-gene deviance |
| write | uns/<name>_refit | struct | method, parameters, convergence flags, missing-gene count |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `loadings` | string | required | — | Stored loading set: varm/<name> for nnls_frobenius; models/<name> for schpf_project and expimap_encode. |
| `method` | string | "nnls_frobenius" | `nnls_frobenius`, `schpf_project`, `expimap_encode` | Usage estimator. nnls_frobenius is the cNMF-compatible default; schpf_project returns posterior means with spread. |
| `name` | string | "program" | — | Prefix for written members, for example obsm/program_usage and obsm/program_usage_norm. |
| `missing_gene_policy` | string | "error" | `error`, `restrict` | error refuses when reference genes are absent; restrict refits on shared genes only and reports coverage. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for the random initialisation of the scHPF projection; other methods are deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing anything. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `nnls_frobenius` | object | — | — | Options for the least-squares refit; ignored by other methods. |
| `nnls_frobenius.alpha_usage` | number | 0 | min 0 | L2 penalty on usages; 0 gives plain non-negative least squares. |
| `nnls_frobenius.tol` | number | 0.0001 | min 0 | Solver tolerance for the coordinate-descent refit. |
| `nnls_frobenius.max_iter` | integer | 1000 | min 1 | Maximum solver iterations per cell batch. |
| `schpf_project` | object | — | — | Options for the Gamma-Poisson projection; ignored by other methods. |
| `schpf_project.min_iter` | integer | 2 | min 1 | Minimum variational iterations before convergence checks. |
| `schpf_project.max_iter` | integer | 50 | min 1 | Maximum variational iterations. |
| `schpf_project.check_freq` | integer | 2 | min 1 | Iterations between convergence checks. |
| `expimap_encode` | object | — | — | Options for the expiMap encoder; ignored by other methods. |
| `expimap_encode.rectify` | boolean | true | — | Clip negative latent means at zero to give non-negative usages. |
| `expimap_encode.only_active` | boolean | true | — | Return only program terms not deactivated by the group lasso. |
<!-- PARAMS:AUTO:END -->

Method options apply only to their method: the `nnls_frobenius` object to the least-squares refit, the `schpf_project` object to the Gamma-Poisson projection, and `rectify` and `only_active` to expiMap. `seed` controls only the random initialisation of the scHPF projection. `missing_gene_policy=restrict` refits on the shared genes only and reports the coverage; zero-filling is not offered because it biases usages toward programs that do not depend on the absent genes. The `loadings` name must match the storage type of the chosen method, and the call is refused otherwise.

## 7. MCP tool

Tool name `singlet_programs_program_usage_estimation` (definition in `tasks/mcp/singlet_programs_program_usage_estimation.json`).

```json
{"dataset": "data/query_batch2.singlet", "loadings": "cnmf_k30", "method": "nnls_frobenius", "missing_gene_policy": "error"}
```

```json
{"dataset": "data/query_batch2.singlet", "status": "completed",
 "wrote": ["obsm/program_usage", "obsm/program_usage_norm", "obs/program_coverage", "obs/program_recon_err", "uns/program_refit"],
 "summary": {"method": "nnls_frobenius", "n_cells": "<n>", "n_programs": "<K>", "missing_reference_genes": "<count>", "zero_usage_rows": "<count>", "median_relative_residual": "<value>"},
 "provenance_id": "<id>"}
```

Long-running: inputs above the implementation's size threshold return `queued` with a `job_id`. Stochastic: only `schpf_project`, through `seed`; the other methods are deterministic given their inputs. Dry estimate mode returns `seconds`, `peak_memory_gb` and `device`, estimated from the non-zero count, K and the method, and calibrated on the P1 measurements.

## 8. Benchmarks

**Shared protocol.** All methods receive the same counts, gene set and stored spectra. Spectra are fitted on reference cells only, with the same K and seeds, and query cells never influence K, the gene set or the spectra. Usages are compared as compositions after row normalisation. Scores are computed per dataset and averaged over datasets with equal weight. Rank statistics use average ranks for ties. Stochastic methods use seeds 0, 1 and 2.

### B1. Mapping distance in the usage embedding (adapted from the mapping benchmark)

- **Goal**: test whether query cells, placed by their usage, fall inside the envelopes of their reference labels as well as under joint recomputation.
- **Ground truth**: expert or author labels. Each query cell carries the atlas annotation, in the same scheme as the reference. The estimand is the fraction of labelled query cells, among those whose label occurs in the reference, whose Mahalanobis distance to the reference centroid of their label does not exceed the 90th percentile of reference distances for that label. Under exchangeability this fraction is about 0.90, so thresholds are set relative to 0.90, not to 1. The embedding is the first $K-1$ coordinates of the row-normalised usage, because the full composition lies on a $(K-1)$-dimensional simplex and its covariance is singular.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| HLCA | `dataset-HLCA.py` [R7]; benchmark collection https://doi.org/10.6084/m9.figshare.c.7521966 | — | — | Reference atlas |
| scIB pancreas | `dataset-scIBPancreas.py` [R7]; https://figshare.com/ndownloader/files/24539828 | — | — | Atlas |
| scEiaD | `dataset-scEiaD.R` [R7]; http://hpc.nih.gov/~mcgaugheyd/scEiaD/2022_03_22/scEiaD_all_seurat_v3.Rdata | — | — | Atlas |
| Fetal liver | `dataset-fetalLiver.py` [R7]; https://app.cellatlas.io/fetal-liver/dataset/1/download | — | — | Atlas |
| Reed breast | `dataset-reedBreast.py` [R7] | — | — | Atlas |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cell mapping score | $1-$ mean of the indicator $d_c > q_\ell$ over labelled query cells, where $d_c$ is the Mahalanobis distance of cell $c$ to the reference centroid $\mu_\ell$ of its label $\ell$, with the reference covariance, and $q_\ell$ is the 90th percentile of reference distances for $\ell$ | higher | primary | [R7]; `metric-cellDist.py` |
| In-sample reference coverage | Share of reference cells inside their own label envelope | 0.90 expected | check | — |

- **Comparators**: joint recomputation on reference plus query (oracle embedding); cNMF refit; scHPF projection; expiMap encoder where a trained model exists; the Symphony mapQuery embedding.
- **Protocol**: reference factorised alone at fixed K; query usage from each method; joint recomputation factorises reference and query together; envelopes come from reference cells only; the same gene set and labels for all methods. Reference and query partitions are set per dataset, and their columns are listed in section 10.
- **Acceptance criterion** (proposed): each usage method's cell mapping score is at most 0.05 below the joint recomputation score on the same split. The 0.05 is a placeholder to set after a pilot.
- **Known pitfalls**: the benchmark code falls back to a pseudo-inverse, with only a printed warning, when a covariance is singular (bin/functions/distances.py), so degenerate envelopes can pass unnoticed; choosing K or the gene set with the same labels makes the score circular.

### B2. Planted-composition simulation (proposed)

- **Goal**: recover planted program composition from counts generated with known loadings, including a query whose loadings are distorted.
- **Ground truth**: planted. The estimand per cell is the planted composition $\theta^{\ast}_c$, normalised to sum to one over programs; it is not the planted raw usage.
- **Generator recipe** (settings are proposed):
  1. Planted programs: $G=2000$ genes and $K\in\{10,30\}$. Program $k$ has base weights $b_g\sim\mathrm{LogNormal}(0,1)$ and a random 5% gene set $T_k$; set $\beta_{kg}\propto b_g(1+4\,\mathbb{1}[g\in T_k])$ and normalise over genes.
  2. Composition: $\theta^{\ast}_c\sim\mathrm{Dirichlet}(0.3\cdot\mathbf{1}_K)$ for $20{,}000$ reference cells and $20{,}000$ query cells; the query raises the concentration to 0.6 for half of the programs.
  3. Depth: library sizes $s_c\sim\mathrm{LogNormal}(\log 5000,\,0.5)$ and counts $x_{cg}\sim\mathrm{Poisson}\big(s_c\sum_k\theta^{\ast}_{ck}\beta_{kg}\big)$.
  4. Misspecification: query loadings are $\beta^{q}_{kg}\propto\beta_{kg}\exp(0.2\,\xi_g)$ with $\xi_g\sim N(0,1)$ shared by all programs, normalised over genes.
  5. Fitted conditions: (O) the true reference $\beta$; (E) reference loadings from the discovery method at the same K.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated reference and query | recipe steps 1 to 4 | synthetic counts, $G=2000$ | not applicable | Seeds 0 to 4 per K |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Matched composition correlation | Pearson correlation of each program's estimated and planted composition column, after Hungarian matching on the correlation matrix; mean over programs | higher | primary | — |
| Composition RMSE | Root mean squared error between matched estimated and planted compositions | lower | guardrail | — |
| Interval coverage | Share of planted compositions inside nominal 90% intervals (probabilistic methods only) | 0.90 target | primary for schpf_project | — |

- **Comparators**: `nnls_frobenius` and `schpf_project`, each under conditions O and E.
- **Protocol**: five seeds per K; matched correlation is reported per program and as its mean.
- **Acceptance criterion** (proposed): matched composition correlation of at least 0.9 for every planted program under condition O at matched K. The 0.9 is a placeholder.
- **Known pitfalls**: a query drawn from the same loadings and noise model as the fit makes the test too easy, so step 4 is required; without the depth variation of step 3 the depth confound cannot be seen.

### B3. Joint-fit concordance on named collections (proxy truth)

- **Goal**: check that query compositions agree with a joint fit that refits the programs on reference plus query.
- **Ground truth**: consistency with a joint fit, a proxy rather than an independent truth. The estimand per program is the row-normalised joint-fit composition on query cells.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| HLCA, scIB pancreas, scEiaD, fetal liver, Reed breast | as in B1 [R7] | — | — | Same partitions as B1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-program Spearman correlation | For each program, Spearman correlation between the refit composition and the joint-fit composition over query cells; median over programs | higher | primary | — |

- **Comparators**: `nnls_frobenius`; `schpf_project`; expiMap encoder where a trained model exists.
- **Protocol**: joint factorisation of reference plus query at the same K and seeds, with consensus across seeds; refit with reference-only loadings; programs matched by loading correlation before per-program correlations; evaluation on query cells only.
- **Acceptance criterion** (proposed): median per-program Spearman correlation of at least 0.8. The 0.8 is a placeholder.
- **Known pitfalls**: one joint factorisation is a single local optimum, so consensus across seeds is required; shared gene scaling between joint fit and refit inflates agreement, which the reference-SD rule of section 5 prevents.

### B4. Held-out deviance without labels (proposed)

- **Goal**: measure how well a fixed basis explains withheld genes of new cells, with no labels.
- **Ground truth**: consistency with withheld counts. Per cell, the observed genes $\mathrm{obs}$ give the composition $\hat\theta_c$ and the scale $c_c=\sum_{g\in\mathrm{obs}}x_{cg}\big/\sum_{g\in\mathrm{obs}}\sum_k\hat\theta_{ck}\beta_{kg}$, so the predicted mean for a withheld gene is $\hat\mu_{cg}=c_c\sum_k\hat\theta_{ck}\beta_{kg}$. Withheld counts enter neither $\hat\theta_c$ nor $c_c$. The estimand is the mean over withheld genes of the Poisson deviance $D_c/|W_c|$, with $D_c=2\sum_{g\in W_c}[x_{cg}\log(x_{cg}/\hat\mu_{cg})-(x_{cg}-\hat\mu_{cg})]$ and $0\log 0=0$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| HLCA, scIB pancreas, scEiaD, fetal liver, Reed breast | as in B1 [R7] | — | — | Per-cell gene split, 80% observed and 20% withheld, seeds 0 to 2 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Held-out deviance per gene | Mean over cells of $D_c/\lvert W_c\rvert$ | lower | primary | — |
| Gain over uniform composition | $1-\bar D_{\mathrm{method}}/\bar D_{\mathrm{uniform}}$, with uniform $\hat\theta_{ck}=1/K$ | higher | guardrail | — |

- **Comparators**: `nnls_frobenius`; `schpf_project`; uniform composition.
- **Protocol**: spectra from reference genes only; estimates from observed genes only; deviance reported separately for withheld genes with positive counts and for zero-count withheld genes.
- **Acceptance criterion** (proposed): every usage method at least 20% lower than the uniform deviance, and `nnls_frobenius` and `schpf_project` within 5% of each other on the same split. Both thresholds are placeholders.
- **Known pitfalls**: correlated genes let the loadings predict withheld genes from observed ones, so a random gene split overstates the held-out gain and a split by co-expression module is needed as a check; zero counts dominate deviance under dropout, which is why they are reported separately.

### P1. Performance and scaling

Query sizes of $10^4$, $10^5$ and $10^6$ cells at $G=2000$ with $K\in\{10,50,100\}$, using the non-zero count per cell of the B2 recipe. Hardware: CPU with one thread and with all threads, and one CUDA device. Metrics: wall seconds, peak host and device memory, and cells per second, reported per million cells because catalogue queries reach 354M cells. Comparators: the cNMF refit (scikit-learn, CPU), the scHPF projection, the expiMap encoder evaluation (PyTorch, CPU and CUDA), the Symphony mapQuery and the scmap cell projection (R), and the proposed batched CUDA NNLS, which is not yet built. Acceptance criterion (proposed): the batched CUDA NNLS is at least ten times faster than the CPU cNMF refit at $10^6$ cells, with usages within solver tolerance. Held fixed: seed 0, loadings, gene set and the hardware record.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `programs.denovo_program_decomposition`: De novo gene program decomposition
  - `programs.program_number_selection`: Choosing the number of programs K and retaining reproducible programs
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
- **Feeds**:
  - `programs.identity_activity_program_labeling`: Separating identity, activity and technical programs
  - `programs.cross_dataset_program_reproducibility`: Cross-dataset program reproducibility and meta-programs
  - `programs.program_annotation`: Biological annotation of gene programs
- **Reads**: `layers/counts`, `varm/<loadings>`, `uns/<loadings>_meta`, `models/<loadings>`
- **Writes**: `obsm/<name>_usage`, `obsm/<name>_usage_norm`, `obs/<name>_coverage`, `obs/<name>_recon_err`, `uns/<name>_refit`
<!-- CHAINING:AUTO:END -->

Belongs to the discovery workflow (fit programs on discovery cells, then estimate usage on the same cells) and to the reference-query workflow (estimate usage on new cells against stored programs).

## 10. Risks, pitfalls and open questions

- **Dataset details.** Per-dataset sizes, species, modalities, licences and partition columns of the B1 collection are not stated here, and the label-distance metric (`metric-labelDist.py`) is not described here. Some of these datasets may carry licence limits that apply before any redistribution.
- **Single-record facts.** The year of [R4] differs between corpus records (2021 and 2022); 2022 is used. The scHPF priors are inferred from parameter names in the code; [R2] is cited for the model family only.
- **Code facts.** The scHPF projection docstring gives a default `max_iter` of 10 while the signature gives 50 (scHPF_.py:467 and 448). Symphony does not expose its ridge penalty (a code comment at mapQuery.R:92 marks it as unfinished), so its batch correction cannot be reproduced from the code. The expiMap latent mean is real-valued, so the rectification in section 5 is a design choice, not a property of the model.
- **Candidates left out.** A fixed-basis multinomial refit from topic-model software is absent from the enum and the tables, since no code path for it is linked. The projectR and Stein-O'Brien transfer approaches are omitted because no code repository or citable paper is linked to them. A cell-cycle check with orthogonal phase labels is not in section 8 because no named dataset with phase labels has been fixed.
- **Unsettled science.** Whether usages should be compared on composition or on raw scale is not agreed. No residual threshold for out-of-program cells exists. Batch correction of loadings changes usage semantics, and no benchmark measures that change.
- **First experiment.** On the B2 recipe at K = 10, compare `nnls_frobenius` with `schpf_project` on matched composition correlation and on B4 deviance at equal wall time. Keep the NNLS default unless the probabilistic method gains at least 0.01 in correlation (proposed threshold).

## 11. References

R1. Kotliar D, Veres A, Nagy MA, et al. Identifying gene expression programs of cell-type identity and cellular activity with single-cell RNA-Seq. *eLife* 2019. doi:10.7554/eLife.43803 — verified (corpus)
R2. Levitin HM, Yuan J, Cheng YL, et al. De novo gene signature identification from single-cell RNA-seq with hierarchical Poisson factorization. *Molecular Systems Biology* 2019. doi:10.15252/msb.20188557 — verified (corpus)
R3. Lotfollahi M, Rybakov S, Hrovatin K, et al. Biologically informed deep learning to query gene programs in single-cell atlases. *Nature Cell Biology* 2023. doi:10.1038/s41556-022-01072-x — verified (search)
R4. Lotfollahi M, Naghipourfar M, Luecken MD, et al. Mapping single-cell data to reference atlases by transfer learning. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01001-7 — verified (corpus)
R5. Kang JB, Nathan A, Weinand K, et al. Efficient and precise single-cell reference atlas mapping with Symphony. *Nature Communications* 2021. doi:10.1038/s41467-021-25957-x — verified (corpus)
R6. Kiselev VY, et al. scmap: projection of single-cell RNA-seq data across data sets. *Nature Methods* 2018. doi:10.1038/nmeth.4644 — verified (corpus)
R7. Zappia L, Richter S, Ramírez-Suástegui C, et al. Feature selection methods affect the performance of scRNA-seq data integration and querying. *Nature Methods* 2025. doi:10.1038/s41592-025-02624-3 — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/dylkot/cNMF | Dylan Kotliar | MIT (LICENSE, Copyright 2019 Dylan Kotliar) | refit reference for nnls_frobenius | port |
| https://github.com/simslab/scHPF | Hanna Mendes Levitin (setup.py); Sims Lab (LICENSE) | BSD-2-Clause (LICENSE); setup.py states BSD | projection reference for schpf_project | port |
| https://github.com/theislab/scarches | Mohammad Lotfollahi; Theislab (LICENSE) | BSD-3-Clause (LICENSE); setup.py states MIT | expiMap encoder for expimap_encode | port |
| https://github.com/immunogenomics/symphony | Joyce Kang (author and maintainer, DESCRIPTION) | GPL-3 (LICENSE; DESCRIPTION GPL (>= 3)) | mapping comparator in B1 and P1 | callout; no code taken |
| https://github.com/hemberg-lab/scmap | Vladimir Kiselev (DESCRIPTION) | GPL-3 (LICENSE; DESCRIPTION) | projection comparator in P1 | callout; no code taken |
| https://github.com/theislab/atlas-feature-selection-benchmark | Benchmark authors as in [R7] | MIT (LICENSE, Copyright 2022 Theis Lab) | dataset scripts and metric code for B1, B3 and B4 | port |
