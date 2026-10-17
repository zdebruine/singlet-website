---
id: annotation.marker_based_cell_assignment
title: Marker-based cell-level type assignment
area: annotation
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [qc.low_quality_cell_detection, normalization.size_factor_estimation]
feeds: [annotation.annotation_confidence_calibration, annotation.novel_cell_type_detection, annotation.hierarchical_annotation]
reads: [layers/counts, layers/lognorm, var, obs/size_factor, obs/<covariate>]
writes: [obs/marker_label_<method>, obs/marker_confidence_<method>, obsm/marker_scores_<method>, uns/marker_assign_<method>, models/cellassign]
devices: [cpu, cuda]
mcp_tool: singlet_annotation_marker_based_cell_assignment
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Marker-based cell-level type assignment

> Assigns each cell to one candidate type or to unknown from a fixed marker table, and reports per-cell scores or posterior probabilities for every type.

## 1. Question

Given per-cell expression and a marker table that lists positive and optional negative marker genes for each candidate type, which type does each cell belong to, or is it unknown? Inputs are a count or log-normalised matrix and the marker table; outputs are one label per cell, a confidence value and one score or posterior per type. A correct answer matches the true identity of cells whose identity is known independently, and its confidence matches the observed accuracy.

## 2. Why this task matters and where the field stands

Marker-based assignment names cell types without a reference atlas, which is why it is widely used for first-pass annotation [R7, R8]. Its status is **contested**, for three reasons.

- Per-cell calls from a few markers are unreliable under dropout, and the best-practices guidance favours cluster-level marker annotation [R9]. Whether per-cell calls with neighbourhood smoothing beat cluster-level calls is open (section 10).
- Unknown calls are uncalibrated. The unknown rules of the published tools (a cluster-size threshold in scType, a 0.95 posterior threshold in CellAssign, a residual state in SCINA) are not tied to held-out accuracy [R1, R2, R4].
- Ground truth is circular. Author labels are often built with the same marker genes, so agreement with them overstates accuracy.

CellAssign [R1] and SCINA [R4] fit a likelihood for every cell and return posteriors, but neither ships a held-out calibration step for its unknown calls. Choosing the marker genes is a separate problem [R12]. Whether any benchmark isolates per-cell marker assignment from cluster-level annotation is an open question (section 10).

## 3. Theory and insight

The marker table is a matrix $M\in\{-1,0,+1\}^{G\times C}$ for $G$ genes and $C$ candidate types, with $+1$ for a positive marker, $-1$ for a negative marker and $0$ otherwise. Cell $n$ has counts $y_{ng}$ and size factor $s_n$. Methods differ in how they turn $M$ and $y_{n\cdot}$ into a decision.

| Symbol | Meaning |
|---|---|
| $z_n$ | latent type of cell $n$: one of the $C$ types, or other |
| $\rho_{gc}$ | $\mathbb{1}[M_{gc}=+1]$, the positive-marker indicator used by CellAssign |
| $\delta_{gc}$ | marker shift on the log-mean scale |
| $\gamma_{nc}$ | posterior probability that $z_n=c$ |
| $\tilde z_{gj}$ | gene-wise z-score of gene $g$ in cell $j$, weighted as in scType |

CellAssign [R1] uses the positive entries only:

$$Y_{ng}\mid z_n=c\sim\mathrm{NB}(\mu_{ngc},\phi_{ngc}),\qquad \log\mu_{ngc}=\log s_n+x_n^{\top}\beta_g+\delta_{gc}\rho_{gc},\qquad \delta_{gc}\ge\delta_{\min}$$

Here $x_n$ are optional covariates and $\beta_g$ baseline coefficients. The dispersion is a fitted function of the log-mean, $\phi_{ngc}=\epsilon+\sum_{b=1}^{B}a_b\exp\{-\kappa_b(\log\mu_{ngc}-m_b)^2\}$, with fitted $a_b$ and fixed centres $m_b$ and widths $\kappa_b$. The regime is counts with $\mu$ of order one or larger, where the variance $\mu+\mu^2/\phi$ tends to Poisson as $\phi$ grows. The bound $\delta_{\min}$ forces every marker shift to a fold change of at least $e^{\delta_{\min}}$, about 7.4 for the published value.

The posterior and label are

$$\gamma_{nc}=P(z_n=c\mid Y)\propto\theta_c\prod_g p(y_{ng}\mid z_n=c),\qquad \theta\sim\mathrm{Dir}(\alpha\mathbf 1_C).$$

EM alternates this E-step with a gradient M-step on the expected complete-data log-likelihood. The label is the argmax, called only when its posterior reaches a threshold $\tau$.

scType [R2] scores cell $j$ for type $k$ from positive sets $P_k$ and negative sets $N_k$. Let $L$ be the number of positive sets and $m_g$ the number of positive sets that contain gene $g$. The weight $w_g=(L-m_g)/(L-1)$, defined for $L\ge 2$, applies to every gene in some positive set, so a gene shared by all sets gets weight zero:

$$S_{kj}=\frac{\sum_{g\in P_k}\tilde z_{gj}}{\sqrt{|P_k|}}-\frac{\sum_{g\in N_k}\tilde z_{gj}}{\sqrt{|N_k|}},\qquad \tilde z_{gj}=\begin{cases}w_g\,z_{gj}, & g\in\bigcup_{k'}P_{k'},\\ z_{gj}, & \text{otherwise}.\end{cases}$$

The label is the argmax over types. The regime is approximately standardised $z$, and the $\sqrt{|P_k|}$ term is a size correction, not a probability.

AUCell-style scoring [R5] ranks the $G$ measured genes by expression within each cell. The score of a gene set $S$ is the normalised area under its recovery curve within the top $n_{\mathrm{up}}$ ranks:

$$\mathrm{ES}_j=\frac{1}{A^{*}}\int_0^{n_{\mathrm{up}}}R_j(r)\,dr,\qquad R_j(r)=\#\{g\in S:\mathrm{rank}_j(g)\le r\},$$

where $A^{*}$ is the maximal attainable area, so $\mathrm{ES}_j\in[0,1]$. The regime is rank-based and invariant to monotone transforms, but sensitive to the number of detected genes per cell.

AddModuleScore [R6] subtracts a control mean from the set mean:

$$s_j=\frac{1}{|S|}\sum_{g\in S}x_{gj}-\frac{1}{|C_j|}\sum_{g\in C_j}x_{gj},$$

where $C_j$ collects control genes drawn from the same expression bins as the genes of $S$. It has no variance or probability model, and the control draw depends on the seed.

SCINA [R4] models each signature $k$ with on and off Gaussian states over its genes and mixing proportions $\tau_k$. Its posterior is

$$p_{kj}=\frac{\tau_k L_{kj}}{1-\sum_{k'}\tau_{k'}+\sum_{k'}\tau_{k'}L_{k'j}},\qquad L_{kj}=\frac{\mathcal N(x_{S_kj}\mid\mu^{\mathrm{on}}_k,\Sigma^{\mathrm{on}}_k)}{\mathcal N(x_{S_kj}\mid\mu^{\mathrm{off}}_k,\Sigma^{\mathrm{off}}_k)},$$

so the residual mass $1-\sum_k\tau_k$ is the implicit unknown state. The regime is a Gaussian approximation on the input scale with conditionally independent signature genes.

**Estimands.** CellAssign reports $\gamma_{nc}$, normalised to sum to one over the candidate types and the other column when present. SCINA reports $p_{kj}$, normalised over the signatures and the unknown state. scType reports $S_{kj}$, an unnormalised and approximately standardised enrichment, and AddModuleScore reports a difference of means in the units of its input; neither is a probability. AUCell reports $\mathrm{ES}_j\in[0,1]$. Planted truth $t_n$ is the generating type or other; expert truth is the mapped author label; both are one categorical label per cell, and unmapped author labels are excluded, not treated as other.

**Assumptions and failure modes.** Heuristic scores assume a specific marker table: a gene listed for one type is absent from the others. Shared markers dilute or bias rank and score methods; scType down-weights them, while AUCell and AddModuleScore do not. Depth confounds rank scores through the number of detected genes, and z-scores depend on the population used for scaling. Model-based methods return probabilities, one effect size per marker and an explicit residual state, but the probabilities are only as good as the model: the dispersion spline (CellAssign) and the Gaussian on and off states (SCINA) can be misspecified for sparse or log-normalised data. A single EM restart, the published default, can end in a local optimum. Dropout gives false negatives for low-abundance markers, so a cell can be called wrongly even when its cluster is clear [R9].

**Why a model adds value.** Heuristic scores are fast, need no fitting and tolerate misspecification, but they cannot say how sure a call is. A likelihood adds calibration when the model holds, one fitted effect size per marker, covariate adjustment and a reusable fitted model. Calibrated uncertainty for reference-based transfer has been treated separately [R10]. The unknown class is explicit in the likelihood methods and in the scType cluster rule; AUCell and AddModuleScore have none.

**Insight.** The marker table is the prior. The method decides whether that prior acts as a hard rule (scType, AUCell, AddModuleScore), a soft likelihood with fitted effect sizes (CellAssign, SCINA) or a learned boundary (scSorter). Only the likelihood methods return probabilities, calibrated only if the model is right; held-out calibration is the missing check.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scType | heuristic | Weighted, size-corrected z-score sums over positive minus negative markers; argmax over types | [R2] |
| AUCell (decoupler implementation; AUCell R) | heuristic | Area under the recovery curve of a gene set within the top-ranked genes | [R5] |
| AddModuleScore (Seurat) | heuristic | Mean of the gene set minus the mean of expression-matched control genes | [R6] |
| CellAssign | model-based | Marker-constrained negative-binomial mixture fitted by EM, with posteriors | [R1] |
| SCINA | model-based | Two-state Gaussian mixture per signature, with an explicit residual unknown state | [R4] |
| scSorter | cost-based | Iterative linear model fitted by cost minimisation with random restarts | [R3] |

The heuristic family (scType, AUCell, AddModuleScore) is the published standard for per-cell marker scores and is kept as comparator. CellAssign is the only method here that models counts directly, so it is the base of the proposal. SCINA and scSorter are comparators.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| scType | scaled | TRUE | R/sctype_score_.R:12 @630e15c |
| scType | gene_names_to_uppercase | TRUE | R/sctype_score_.R:12 @630e15c |
| scType | marker weight | $(L-m_g)/(L-1)$ for genes in positive sets | R/sctype_score_.R:24-26 @630e15c |
| scType | cluster Unknown rule | cluster score below ncells/4 | R/sctype_wrapper.R:105 @630e15c |
| AUCell (decoupler) | n_up | ceil(0.05 G), clipped to [2, G] | src/decoupler/mt/_aucell.py:42-53 @3132edc |
| AUCell (R) | aucMaxRank | ceiling(0.05 × genes) | R/02_calcAUC.R:37 @91753b3 |
| AddModuleScore | nbin | 24 | R/utilities.R:179, 314 @5f67c70 |
| AddModuleScore | ctrl | 100 | R/utilities.R:180, 315 @5f67c70 |
| AddModuleScore | seed | 1 | R/utilities.R:184, 318 @5f67c70 |
| AddModuleScore | search | FALSE | R/utilities.R:319 @5f67c70 |
| CellAssign | min_delta | 2 | R/cellassign.R:122 @be66325 |
| CellAssign | B | 10 | R/cellassign.R:124 @be66325 |
| CellAssign | shrinkage | TRUE | R/cellassign.R:125 @be66325 |
| CellAssign | dirichlet_concentration | 1e-2 | R/cellassign.R:127 @be66325 |
| CellAssign | rel_tol_adam, rel_tol_em | 1e-4, 1e-4 | R/cellassign.R:128-129 @be66325 |
| CellAssign | max_iter_adam, max_iter_em | 1e5, 20 | R/cellassign.R:130-131 @be66325 |
| CellAssign | learning_rate | 0.1 | R/cellassign.R:132 @be66325 |
| CellAssign | num_runs | 1 | R/cellassign.R:136 @be66325 |
| CellAssign | include_other (list input) | FALSE | R/cellassign.R:144 @be66325 |
| CellAssign | assign_prob | 0.95 | R/cellassign.R:309, 342 @be66325 |
| CellAssign | size factors when s is NULL | scran::computeSumFactors | R/cellassign.R:218 @be66325 |
| SCINA | max_iter, convergence_n, convergence_rate | 100, 10, 0.99 (NA max_iter uses 1000) | R/EM_model.R:34, R/EM_functions.R:26 @a789563 |
| SCINA | sensitivity_cutoff, rm_overlap, allow_unknown | 1, 1, 1 | R/EM_model.R:35 @a789563 |
| SCINA | sigma floor | smallest initial variance / 100 | R/EM_model.R:88 @a789563 |
| SCINA | initial on and off means | 0.7 and 0.3 quantiles | R/EM_model.R:78 @a789563 |
| scSorter | default_weight, n_start, alpha, u | 2, 10, 0, 0.05 | R/scSorter.R:29 @7b1940f |
| scSorter | max_iter, setseed | 100, 0 | R/scSorter.R:29 @7b1940f |

## 5. Proposed singlet approach

Routes for each implementation are in section 12. The CellAssign model, the decoupler AUCell-style scorer and AddModuleScore are **ported**; scType and SCINA are **reimplemented**; scSorter and the AUCell R implementation are **callouts**, used as benchmark comparators only. The AUCell R default is taken from its source.

The proposed model is a marker-constrained negative-binomial mixture with an explicit background component for cells of no listed type. Marker shifts are estimated from data rather than fixed by a floor, and their prior and the dispersion function are fitted in PyTorch on author-annotated catalogue cells with a study-level split. Posteriors are recalibrated on leave-study-out data with temperature scaling or isotonic regression. The formulation is falsified if, on the planted benchmark, the unknown rate fails to track the planted other fraction, or if the calibration error or per-study macro F1 misses its acceptance criterion on the held-out benchmark (section 8).

ML stack: PyTorch with Adam over mini-batches fits the global priors and the calibration map, because these are small and suited to gradient fitting. Per-cell inference is a hard-coded CUDA kernel that evaluates the NB log-likelihood over the marker block, with log-sum-exp over types and marker columns extracted from CSR with cuSPARSE. The marker block is small, so dense evaluation of those columns is feasible. The scoring methods are CUDA kernels too: AUCell-style ranking by radix sort, and weighted column sums for scType and AddModuleScore.

CPU, CUDA and streaming: the scoring methods process cells in chunks. CellAssign holds the marker block and the EM state in memory and is not streamed in this version. The auto device picks CUDA when memory allows.

Defaults an agent should use: method `cellassign`, layer null (counts for cellassign), seed 1, and size factors from `obs/size_factor` when present. Two CellAssign options differ from the published values in section 4: `include_other` is true, so unassigned cells have an explicit background, and `num_runs` is 3 (proposed). All other options keep their section 4 values.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse int | raw UMI counts; required by cellassign |
| read | `layers/lognorm` | sparse float32 | log-normalised expression; used by the other methods |
| read | `var` | string | gene symbols matched to the marker table |
| read | `obs/size_factor` | float32, optional | full-transcriptome size factors for cellassign |
| read | `obs/<covariate>` | categorical, optional | model covariates named in `cellassign.covariates` |
| write | `obs/marker_label_<method>` | categorical | per-cell label; includes `unknown` |
| write | `obs/marker_confidence_<method>` | float32 | maximum posterior for probabilistic methods; top score otherwise |
| write | `obsm/marker_scores_<method>` | float32, cells × types | posteriors (cellassign, scina) or scores |
| write | `uns/marker_assign_<method>` | record | parameters, marker-table hash and package version |
| write | `models/cellassign` | record | fitted shifts, coefficients, dispersion spline and type proportions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `marker_table` | object | required | — | Candidate type to marker map: each type lists positive genes and optional negative genes. |
| `method` | string | "cellassign" | `cellassign`, `sctype`, `aucell`, `module_score`, `scina` | Assignment method. cellassign is the proposed default; the others are published comparators. |
| `layer` | string/null | null | — | Layer to read. Null selects counts for cellassign and lognorm for other methods. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 1 | min 0 | Seed for the AddModuleScore control draw and CellAssign initialisation. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `cellassign` | object | — | — | Options read only when method is cellassign. |
| `cellassign.min_delta` | number | 2 | min 0 | Lower bound on the natural-log marker shift; 2 is the published value. |
| `cellassign.basis_count` | integer | 10 | min 1 | Number of dispersion spline basis functions. |
| `cellassign.shrinkage` | boolean | true | — | Shrink marker shifts towards a shared mean on the log scale. |
| `cellassign.dirichlet_concentration` | number | 0.01 | min 0 | Symmetric Dirichlet concentration on type proportions. |
| `cellassign.num_runs` | integer | 3 | min 1 | Independent EM restarts; the best log-likelihood is kept. Published default is 1. |
| `cellassign.include_other` | boolean | true | — | Add an all-zero marker column for cells of no listed type. Published list default is false. |
| `cellassign.assign_prob` | number | 0.95 | min 0; max 1 | Minimum maximum posterior for a called label; otherwise unknown. |
| `cellassign.covariates` | array | [] | — | obs columns used as model covariates, such as batch. |
| `sctype` | object | — | — | Options read only when method is sctype. |
| `sctype.scaled` | boolean | true | — | True means expression is already gene-wise z-scored; false z-scores it first. |
| `sctype.uppercase_genes` | boolean | true | — | Uppercase gene symbols before matching the marker table. |
| `sctype.cluster_key` | string/null | null | — | obs column of clusters; when set, clusters below the threshold become unknown. |
| `sctype.unknown_fraction` | number | 0.25 | min 0 | Cluster Unknown threshold as a fraction of cluster size, applied to the summed score. |
| `aucell` | object | — | — | Options read only when method is aucell. |
| `aucell.n_up` | integer/null | null | min 2 | Recovery-curve cutoff in ranked genes; null uses ceil(0.05 G), clipped to [2, G]. |
| `scina` | object | — | — | Options read only when method is scina. |
| `scina.max_iter` | integer | 100 | min 1 | Maximum EM iterations. |
| `scina.convergence_n` | integer | 10 | min 1 | Number of recent label vectors compared for stability. |
| `scina.convergence_rate` | number | 0.99 | min 0; max 1 | Fraction of cells whose labels must stay stable. |
| `scina.allow_unknown` | boolean | true | — | Include the residual unknown state. |
| `scina.rm_overlap` | boolean | true | — | Remove genes shared between signatures before fitting. |
<!-- PARAMS:AUTO:END -->

Nested objects apply only to their method, and an option for another method is an error. Only `sctype` reads negative markers; other methods ignore them with a warning. Marker genes absent from `var` are dropped with a warning. `cellassign` warns above 100 input genes, since only markers should be passed. With `include_other`, the other column is all-zero, and cells whose posterior is highest there are labelled unknown. `module_score` uses the fixed bin and control counts from section 4, and its seed is the top-level `seed`. `sctype` applies its unknown rule only when `cluster_key` is set.

## 7. MCP tool

Tool name `singlet_annotation_marker_based_cell_assignment` (definition in `tasks/mcp/singlet_annotation_marker_based_cell_assignment.json`). Example call:

```json
{"dataset": "/data/pbmc.singlet", "marker_table": {"T cell": {"positive": ["CD3D", "CD3E"]}, "B cell": {"positive": ["MS4A1"]}}, "method": "cellassign", "cellassign": {"num_runs": 3}}
```

Example result (illustrative values):

```json
{"dataset": "/data/pbmc.singlet", "status": "completed", "wrote": ["obs/marker_label_cellassign", "obs/marker_confidence_cellassign", "obsm/marker_scores_cellassign", "uns/marker_assign_cellassign", "models/cellassign"], "summary": {"n_cells": 2700, "unknown_fraction": 0.04, "per_type_counts": {"T cell": 1800, "B cell": 792}, "converged": true}, "provenance_id": "prov-0001", "job_id": null, "estimate": null}
```

Long-running: `cellassign` can take a long time on large inputs and then returns `queued` with a `job_id`; the scoring methods finish inline.

Stochastic: `seed` fixes the AddModuleScore control draw and CellAssign initialisation, so repeated calls with the same seed return the same labels.

Dry run: `dry_run` returns `seconds`, `peak_memory_gb` and `device` from the cell and marker counts, without writing members.

## 8. Benchmarks

Shared protocol. Every method receives the same cells, counts and marker table; scoring methods and SCINA receive $\log(1+\text{counts per }10^4)$. A call $c_n$ is a candidate type or unknown, and the truth $t_n$ is a candidate type or other. Unknown rate is the fraction of all cells with $c_n$ unknown. Accuracy on called cells is the fraction of called cells with $c_n=t_n$, so a called cell of true type other is wrong. Macro F1 is the unweighted mean over candidate types of per-type F1, following scikit-learn, so an unknown call lowers recall of its true type. Expected calibration error (ECE) uses 10 equal-width bins on the maximum posterior over called cells and is reported only for posterior methods. Score methods have no unknown class and are labelled by argmax.

### B1. Abdelaal et al. 2019 comparison of automated classifiers (published)

- **Goal**: compare marker-based classifiers with other automated classifiers on public scRNA-seq data with known labels, within and across datasets [R7].
- **Ground truth**: sorted-population labels for the FACS-sorted dataset, and the labels supplied with each other dataset, as reported in [R7]. One categorical label per cell, with no weighting.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Zheng FACS-sorted dataset | [R7] | scRNA-seq; —; — | — | sorted populations as truth |
| Other public datasets of the comparison | [R7] | scRNA-seq; —; — | — | within- and cross-protocol pairs |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Accuracy | fraction of all cells whose label equals the truth; unknown counts as wrong here | higher | primary | [R7] |
| Median F1 | median over types of per-type F1, per dataset | higher | primary | [R7] |
| Unknown fraction | fraction of cells with an unknown label | lower | guardrail | [R7] |
| Computation time | wall time per method | lower | guardrail | — |

- **Comparators**: the singlet methods of section 4 on the same datasets; published values for other classifiers are cited, not rerun.
- **Protocol**: intra-dataset and cross-protocol prediction as defined in [R7], with marker sets as defined there and the shared definitions of section 8.
- **Acceptance criterion**: proposed design target: median F1 within 0.02 of the best marker comparator on the sorted dataset, and unknown fraction at most 0.10 at default settings.
- **Known pitfalls**: marker sets and sorting logic can share biology and favour marker methods; accuracy depends on the unknown convention, which differs between methods.

### B2. Planted simulation with known marker truth (proposed)

- **Goal**: measure accuracy, unknown calls and calibration when truth is known by construction.
- **Ground truth**: the planted type or other per cell; $\omega$ is the target unknown rate.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Generated counts (recipe below) | this benchmark | simulated scRNA-seq; —; 20,000 cells, 2,000 genes | — | 60 datasets |

Recipe:

1. Fix $C=8$ types, each with 10 disjoint positive markers, forming $M$.
2. Draw $p_g\propto\exp(u_g)$ with $u_g\sim\mathcal N(0,1)$, and library sizes $L_n\sim\mathrm{LogNormal}(\log 3000,\,0.3)$.
3. For a cell of type $c$ with marker fold change $f$, set $\mu_{ngc}=L_n\pi_{gc}$ with $\pi_{gc}\propto p_g f^{\mathbb 1[g\in M_c]}$; other cells use $\pi_g\propto p_g$.
4. Draw $\theta\sim\mathrm{Dir}(\mathbf 1_C)$, assign cells to types from $\theta$, then relabel a fraction $\omega$ as other.
5. Draw $Y_{ng}\sim\mathrm{NB}(\mu_{ngc},\phi=2)$, then zero each entry independently with probability $d$.
6. Grid: $f\in\{2,4,8\}$, $\omega\in\{0,0.3\}$, $d\in\{0,0.3\}$, seeds 1 to 5, giving 60 datasets.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Accuracy on called cells | correct calls over called cells; called other cells are wrong | higher | primary | — |
| Macro F1 | per section 8 | higher | primary | [R11] |
| Unknown rate | per section 8; compare with $\omega$ | target-matched | guardrail | — |
| ECE | per section 8; posterior methods only | lower | guardrail | — |

- **Comparators**: scType, AddModuleScore and AUCell (argmax); CellAssign at published and singlet settings; SCINA; scSorter (callout).
- **Protocol**: section 8 protocol; section 4 defaults plus one setting per method tuned by macro F1 on seeds 6 to 8 over $\delta_{\min}\in\{0.5,1,2\}$, $n_{\mathrm{up}}\in\{0.05G,0.1G\}$ and SCINA's allow-unknown; report seeds 1 to 5.
- **Acceptance criterion**: proposed design target: ECE at most 0.05 for posterior methods, and unknown rate within 0.05 of $\omega$.
- **Known pitfalls**: the generator must not reuse the fitted shift prior or spline, or the test is circular; $f\in\{2,4\}$ lies below the 7.4-fold floor on purpose and is reported separately.

### B3. Held-out-study expert labels from the singlet catalogue (proposed)

- **Goal**: measure how well a marker table generalises to studies that were not used to write it or to fit the model.
- **Ground truth**: author annotations mapped to candidate types by one fixed dictionary; one categorical label per cell. Cells whose author label has no mapping are excluded, not counted as other.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Annotated studies in the singlet catalogue | singlet catalogue (354M cells; about 40% with author annotations) | scRNA-seq; —; — | — | split by study |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-study macro F1 | macro F1 within each held-out study; median and interquartile range across studies | higher | primary | [R11] |
| Per-study unknown rate | fraction of cells with an unknown label, per study | target-matched | guardrail | — |

- **Comparators**: as in B2.
- **Protocol**: leave-one-study-out over annotated studies. A study is kept only if its annotation did not use the marker table under test (provenance check or exclusion). Each method uses its section 4 defaults. The marker table for a held-out study is fixed before its labels are read.
- **Acceptance criterion**: proposed design target: median per-study macro F1 within 0.05 of the best comparator, and standard deviation of per-study unknown rate at most 0.10.
- **Known pitfalls**: author labels were often built with the same markers, so agreement is partly circular; granularity and batch differ by study, so the label dictionary must be fixed before any scoring.

### P1. Performance and scaling

Wall time and peak memory versus cell count at $10^4$, $10^5$ and $10^6$ cells (proposed scales), with CPU and CUDA reported separately, against scType, AddModuleScore, AUCell (decoupler), the published CellAssign implementation and SCINA. Hold fixed the marker table, thread count, sparse CSR input, seed and defaults; report CellAssign with `num_runs` 1 and 3. The model cost is $O(NG_mCB)$ per gradient step, derived from the model and not measured. Acceptance (proposed design target): singlet CellAssign at least 10 times faster than the published CellAssign at $10^5$ cells, with macro F1 on B2 at least as high.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Feeds**:
  - `annotation.annotation_confidence_calibration`: Annotation and label-transfer confidence calibration and abstention
  - `annotation.novel_cell_type_detection`: Novel or unseen cell type detection and out-of-distribution scoring for query cells
  - `annotation.hierarchical_annotation`: Hierarchical, ontology-aware coarse-to-fine annotation
- **Reads**: `layers/counts`, `layers/lognorm`, `var`, `obs/size_factor`, `obs/<covariate>`
- **Writes**: `obs/marker_label_<method>`, `obs/marker_confidence_<method>`, `obsm/marker_scores_<method>`, `uns/marker_assign_<method>`, `models/cellassign`
<!-- CHAINING:AUTO:END -->

Tier P1: a widely used extension of the standard end-to-end workflow, after quality control and normalisation (`tasks/README.md`).

## 10. Risks, pitfalls and open questions

- **Unconfirmed sources.** The Abdelaal et al. [R7] dataset collection, comparator list, marker set sizes, protocol and statements on marker methods and unknown-call accounting are not checked against the paper text, so B1 is provisional. Garnett [R13] is cited for context only and is not in the tables or the enum. scSorter's unknown handling is not characterised, so it is a comparator only.
- **Bibliographic conflicts.** The SCINA README gives the title used in R4 and dates it 2018; the bibliography record has a different title and the year 2019 (Genes), and R4 follows that record for the year.
- **Data and licences.** No benchmark dataset has an accession in this document. The licences of the studies behind the catalogue annotations are not recorded, so B3 results should not be released until they are checked. The CITE-seq protein-gated check is not defined because no candidate dataset has been identified; it is the planned orthogonal test for per-cell calls.
- **Open questions and missing measurements.** Whether per-cell calls with smoothing beat cluster-level calls is unsettled. No timing or memory figure has been measured for any method, so P1 is a design. The CellAssign simulator (R/simulate.R) is not used; B2 uses its own recipe.
- **Technical risks.** The published CellAssign is a TensorFlow implementation called through reticulate, so the port must reproduce its likelihood, dispersion spline and EM steps before B1 to B3 are used. The marker-shift floor binds for markers below about 7.4-fold, `num_runs` of 3 triples the restart cost, and SCINA's overlap removal can drop informative markers.
- **First experiment.** Apply B2 to the published CellAssign settings and to the singlet defaults (`include_other` true, `num_runs` 3), reporting unknown rate against $\omega$ and ECE on seeds 1 to 5. This tests the two proposed changes before any catalogue fitting.

## 11. References

R1. Zhang AW, O'Flanagan C, Chavez EA, et al. Probabilistic cell-type assignment of single-cell RNA-seq for tumor microenvironment profiling. *Nature Methods* 2019. doi:10.1038/s41592-019-0529-1 — verified (corpus)

R2. Ianevski A, et al. Fully-automated and ultra-fast cell-type identification using specific marker combinations from single-cell transcriptomic data. *Nature Communications* 2022. doi:10.1038/s41467-022-28803-w — verified (repo)

R3. Guo H, Li J. scSorter: assigning cells to known cell types according to marker genes. *Genome Biology* 2021. doi:10.1186/s13059-021-02281-7 — verified (corpus)

R4. Zhang Z, Luo D, et al. SCINA: A Semi-Supervised Subtyping Algorithm of Single Cells and Bulk Samples. *Genes* 2019. doi:10.3390/genes10070531 — verified (repo)

R5. Aibar S, Gonzalez-Blas CB, Moerman T, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — verified (corpus)

R6. Tirosh I, Izar B, Prakadan SM, et al. Dissecting the multicellular ecosystem of metastatic melanoma by single-cell RNA-seq. *Science* 2016. doi:10.1126/science.aad0501 — verified (corpus)

R7. Abdelaal T, Michielsen L, Cats D, et al. A comparison of automatic cell identification methods for single-cell RNA sequencing data. *Genome Biology* 2019. doi:10.1186/s13059-019-1795-z — verified (corpus)

R8. Pasquini G, Rojo Arias JE, Schäfer P, Busskamp V. Automated methods for cell type annotation on scRNA-seq data. *Computational and Structural Biotechnology Journal* 2021. doi:10.1016/j.csbj.2021.01.015 — verified (corpus)

R9. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)

R10. Engelmann J, Hetzel L, Palla G, et al. Uncertainty quantification for atlas-level cell type transfer. *arXiv* 2022. doi:10.48550/arXiv.2211.03793 — verified (corpus)

R11. Grandini M, Bagli E, Visani G. Metrics for multi-class classification: an overview. *arXiv* 2020. doi:10.48550/arXiv.2008.05756 — verified (corpus)

R12. Pullin JM, McCarthy DJ. A comparison of marker gene selection methods for single-cell RNA sequencing data. *bioRxiv* 2022. doi:10.1101/2022.05.09.490241 — verified (corpus)

R13. Pliner HA, Shendure J, Trapnell C. Supervised classification enables rapid annotation of cell atlases. *Nature Methods* 2019. doi:10.1038/s41592-019-0535-3 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/IanevskiAleksandr/sc-type | Aleksandr Ianevski (source headers) | GPL-3.0 (LICENSE file) | scType reference implementation and defaults | reimplement |
| https://github.com/aertslab/AUCell | Sara Aibar and Stein Aerts (authors); Gert Hulselmans (maintainer) | GPL-3 (DESCRIPTION; no LICENSE file at root) | AUCell default for aucMaxRank | callout (benchmark comparator only) |
| https://github.com/scverse/decoupler | scverse and Pau Badia i Mompel, Saez lab (copyright lines in LICENSE) | BSD-3-Clause (LICENSE) | Python AUCell-style scorer | port |
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and contributors listed in DESCRIPTION | MIT + file LICENSE (DESCRIPTION) | AddModuleScore algorithm and defaults | port |
| https://github.com/irrationone/cellassign | Allen Zhang (aut); Kieran Campbell (aut, cre) | Apache-2.0 (LICENSE.md) | CellAssign model, default method | port |
| https://github.com/jcao89757/SCINA | Ze Zhang (author and maintainer, per DESCRIPTION) | GPL-2 (DESCRIPTION; no LICENSE file at root) | SCINA model | reimplement |
| https://github.com/hyguo2/scSorter | Hongyu Guo and Jun Li (per DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file at root) | comparator | callout |
