---
id: communication.differential_communication
title: Donor-aware differential communication between conditions
area: communication
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [communication.lr_resource_curation, annotation.cluster_label_assignment]
feeds: [communication.interaction_significance_calibration, communication.consensus_interaction_ranking, communication.communication_pattern_decomposition]
reads: [layers/counts, obs/<cell_type_key>, obs/<sample_key>, obs/<donor_key>, obs/<condition_key>, obs/<batch_keys>, uns/lr_resource]
writes: [uns/ccc_diff_sample_scores, uns/ccc_diff_results, uns/ccc_diff_prioritization, models/ccc_diff_pb_nb, models/ccc_nncp_factors]
devices: [cpu, cuda]
mcp_tool: singlet_communication_differential_communication
evidence_basis: corpus+repo+memory
last_reviewed: 2026-10-17
---

# Donor-aware differential communication between conditions

> Estimate which sender-to-receiver ligand-receptor interactions change between two conditions when donors or samples, not cells, are the replicates, and report each change with a donor-level p-value and FDR.

## 1. Question

Given raw counts with cell-type, sample, donor and condition labels, and a ligand-receptor (LR) resource, which sender-receiver-LR triplets change between conditions when inference is made over donors? The default route returns, per contrast and triplet, an effect size, a p-value and an FDR, together with per-donor LR scores. A correct answer controls false discoveries when donors, not cells, are the units of replication, and recovers planted effects at their nominal size.

## 2. Why this task matters and where the field stands

Ligand-receptor inference on one set of cells gives a static map of possible signalling. The common question is how that map changes between conditions, such as treated against control or disease against healthy. The unit of replication is the donor. Cells from one donor share genotype, handling and batch, so a cell-level test counts cells rather than donors and inflates significance. This pseudoreplication problem is documented for single-cell differential expression [R1][R2], and a balanced performance measure favours pseudobulk methods [R3]. Benchmarks of multi-subject differential-state methods exist [R4], and muscat implements sample-level multi-condition testing [R5].

Communication tools predate this concern. MultiNicheNet is the replicate-aware route: sample-level differential expression of ligands and receptors, then a weighted prioritisation of pairs [R6]. CellChat tests within each dataset by permuting cell labels [R7][R8] and compares conditions with Wilcoxon tests over cell-type pairs. Tensor-cell2cell factorises donor-resolved scores without p-values [R9]. The LIANA+ multi-sample reference describes comparing per-condition `rank_aggregate` tables as indicative only, with no notion of replicates [R10][R11].

Status: **contested**. Donor-level inference is accepted; the scoring step is not. Open problems:

- **Donor-level LR score.** Products of expression means, with geometric means for complexes as in CellChat, are in use; their robustness to dropout and donor depth is untested.
- **Composition.** A shift in cell-type proportions raises product scores without any per-cell change.
- **Few donors.** Exact permutation floors and unstable empirical nulls limit power and calibration.
- **Resource effects.** LR resources differ in coverage and curation, so differences partly reflect the resource [R12].
- **No accepted ground truth.** Published communication benchmarks use steady-state proxies, not contrasts [R12][R13].

## 3. Theory and insight

Notation: sender cell type $i$, receiver $j$, ligand $L$, receptor $R$, LR pair $\ell=(L,R)$, cell type $k$, sample $s$ (one donor in one condition), donor $d$, condition $c$, and raw count $x_{g,c}$ of gene $g$ in cell $c$.

**Pseudobulk sum.** $Y_{g,k,s}=\sum_{c\in\mathcal C_{k,s}}x_{g,c}$, where $\mathcal C_{k,s}$ holds the cells of type $k$ in sample $s$. Estimand: the donor-level expression total of $g$ in $k$, defined for groups with at least `min_cells` cells.

**Donor-level negative-binomial model.** $Y_{g,k,s}\sim\mathrm{NB}(\mu_{g,k,s},\phi_g)$ with $\log\mu_{g,k,s}=\log N_{k,s}+\mathbf x_s^{\top}\boldsymbol\beta_{g,k}$, where $N_{k,s}$ is the library size and a contrast is a linear combination of $\boldsymbol\beta_{g,k}$. Estimand: the condition effect on log mean expression per unit library. Regime: donors are the independent units, and the test is stable only when the dispersion estimates are, which needs many donors and large libraries. MultiNicheNet fits this family through muscat with the edgeR method [R14][R5].

**Donor-level LR feature (proposed).** $\ell_{ijl,d}=\log_2(\hat\mu_{L,i,d}+1)+\log_2(\hat\mu_{R,j,d}+1)$, with $\hat\mu$ the counts per million of the donor's pseudobulk sums. Estimand: the donor's log2 co-expression of the pair. It approximates $\log_2(\mu_L\mu_R)$ only when $\mu\gg1$; complexes need a subunit rule, which is open (section 2).

**Hill pair term (CellChat).** $P^{\mathrm{LR}}_{ij}=\dfrac{x_{ij}^{\,n}}{K_h^{\,n}+x_{ij}^{\,n}}$, where $x_{ij}$ is the LR product for sender $i$ and receiver $j$ summarised by the trimean (default) or a trimmed mean. Estimand: a saturating relative score, neither a frequency nor a calibrated probability.

**Permutation p-value (CellChat).** $p^{\mathrm{LR}}_{ij}=\dfrac1B\sum_{b=1}^{B}\mathbf 1\!\left[P^{(b)}_{ij}-P_{ij}>0\right]$ with $B=100$. Estimand: the fraction of shuffles of cell-group labels, over cells, whose score exceeds the observed one. It is a valid null only if cells are exchangeable, which donor structure breaks. Its resolution is $1/B$.

**Weighted prioritisation (MultiNicheNet).** $S_{\ell ij}=\dfrac{1}{\sum_m w_m}\Big[\tfrac12 w_{dL}(\tilde\Delta_L+\tilde p_L)+\tfrac12 w_{dR}(\tilde\Delta_R+\tilde p_R)+w_a\tilde A+w_{eL}\tilde E_L+w_{eR}\tilde E_R+w_f F_{\ell ij}\Big]$. Here $\Delta$ and $p$ are ligand and receptor log fold change and adapted p-value, $A$ is NicheNet ligand activity [R15], $E$ is pseudobulk expression, $F$ is the fraction of samples expressing the pair, and tildes mark the package's scaling. Estimand: a unitless rank. It is a weighted average, not a product, and it is comparable only within one run.

**Empirical null.** $\tilde z_g=(z_g-\hat\delta_0)/\hat\sigma_0$, with $\hat\delta_0$ and $\hat\sigma_0$ estimated from the central part of the $z$ distribution [R16]. Regime: many tests per cell type; the central estimate is biased when most tests are non-null.

**Non-negative CP factorisation (Tensor-cell2cell).** $\mathcal X_{s\ell ij}\approx\sum_{r=1}^{R}A_{sr}B_{\ell r}C_{ir}D_{jr}$ with $A,B,C,D\ge0$, fitted by masked least squares, $\min\|\mathcal M\odot(\mathcal X-\hat{\mathcal X})\|_F^2$. Estimand: a rank-$R$ approximation of the sample-by-triplet score tensor; $A$ gives donor loadings. Regime: the problem is non-convex, so the minimiser is not unique and factors need stability checks; rank is set by an elbow search [R9].

**Design effect.** $\mathrm{DEFF}=1+(\bar m-1)\rho$ for $\bar m$ cells per donor and intra-donor correlation $\rho$, so a cell-level test has effective size near $n_{\text{cells}}/\mathrm{DEFF}$. Regime: first-order clustered-data approximation; cell-level permutation is anti-conservative when $\rho>0$ and $\bar m$ is large.

**Exact permutation floor.** Relabelling $n_1$ and $n_2$ donors between two groups gives a smallest one-sided exact p-value of $\binom{n_1+n_2}{n_1}^{-1}$. Three donors against three cannot reach below 0.05.

Estimands, one per scale used:

- Donor-level contrast: the difference between conditions in the donor average of $\ell$, on the log2 CPM scale. B2 uses this scale. A gene-level method is compared by summing its ligand and receptor log2 fold changes, which is valid when $\mu\gg1$ and dispersion is small.
- Planted truth: with fold $f$ on ligand and receptor in a fraction $\pi$ of condition-B donors, the contrast is $\tau=2\pi\log_2 f$.

Assumptions and failure modes by method family:

- Donor-level models assume donors are independent replicates and annotations are stable across donors. They fail with few donors or when batch is confounded with condition.
- Cell-level permutation and Wilcoxon tests assume exchangeable cells and inflate significance under donor structure. CellChat's rankNet stops with an error when its paired test is requested for datasets with different cell compositions, so an unpaired test must be used.
- Heuristic scores assume criteria are comparable across pairs; their weights are user-chosen.
- Factorisation assumes a stable low-rank structure; restarts and the rank choice change the factors.
- All methods treat LR transcript products as proxies for protein-level signalling and assume local interactions [R17].

Insight. Replicate-aware differential communication is a donor-level differential-expression problem applied to LR products. Donor-level pseudobulk models are the accepted remedy for the false discoveries of cell-level tests [R1][R2], and MultiNicheNet carries that logic into communication through an edgeR negative-binomial model and an empirical null. Its weak point is the scoring: the final ranking is an uncalibrated weighted average. A calibrated donor-level model of the LR feature would give effect sizes with uncertainty, and donor relabelling can test its calibration directly (B1).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| MultiNicheNet | hybrid | Sample-level pseudobulk NB testing of ligands and receptors per cell type with an empirical null, then a weighted-average prioritisation of sender-receiver pairs | [R6] |
| CellChat comparison (v2 API) | heuristic | Hill-saturated trimean (default) or trimmed-mean probabilities, cell-label permutation p-values per dataset, and Wilcoxon tests over cell-type pairs between datasets | [R7][R8] |
| Tensor-cell2cell | model-based | Non-negative CP factorisation of a sample-by-triplet score tensor; donor loadings and no p-values | [R9] |
| LIANA+ multi-sample routes | hybrid | Per-sample rank aggregation (descriptive); targeted route with pseudobulk DE by decoupler and pydeseq2, converted to an LR table | [R10][R11] |

MultiNicheNet is the replicate-aware published standard, and its sample-level route is the default here. CellChat is kept as the cell-level comparator that donor-aware methods are meant to replace. Tensor-cell2cell and LIANA+ represent a model-based route and a descriptive route. Methods left out are listed in section 10.

Defaults taken from the source code at the commit shown:

| Method | Parameter | Value | Source |
|---|---|---|---|
| MultiNicheNet | fraction_cutoff | 0.05 | R/pipeline.R:109 @f1db92c |
| MultiNicheNet | min_sample_prop | 0.5 | R/pipeline.R:110 @f1db92c |
| MultiNicheNet | scenario | "regular" | R/pipeline.R:111 @f1db92c; weights R/prioritization.R:103-104 |
| MultiNicheNet | ligand_activity_down | FALSE | R/pipeline.R:112 @f1db92c |
| MultiNicheNet | assay_oi_pb, fun_oi_pb | "counts", "sum" | R/pipeline.R:113-114 @f1db92c |
| MultiNicheNet | de_method_oi | "edgeR" | R/pipeline.R:115 @f1db92c; used at R/muscat_de.R:309 |
| MultiNicheNet | min_cells | 10 | R/pipeline.R:116 @f1db92c |
| MultiNicheNet | logFC_threshold | 0.50 (roxygen states 0.25) | R/pipeline.R:117 and :38 @f1db92c |
| MultiNicheNet | p_val_threshold | 0.05 | R/pipeline.R:118 @f1db92c |
| MultiNicheNet | empirical_pval | TRUE | R/pipeline.R:120; R/pipeline_wrappers.R:932 @f1db92c |
| MultiNicheNet | top_n_target, top_n_LR | 250, 2500 | R/pipeline.R:121 @f1db92c |
| CellChat | type, trim | "triMean", 0.1 | R/modeling.R:63; triMean at R/modeling.R:878-880 @75253cd |
| CellChat | interaction.range, k.min | 250, 10 | R/modeling.R:64 @75253cd |
| CellChat | do.symmetric, contact.dependent | TRUE, TRUE | R/modeling.R:64 @75253cd |
| CellChat | nboot, seed.use | 100, 1 | R/modeling.R:65 @75253cd |
| CellChat | Kh, n | 0.5, 1 | R/modeling.R:65 @75253cd |
| CellChat | rankNet do.stat, paired.test, cutoff.pvalue | FALSE, TRUE, 0.05 | R/analysis.R:1027 @75253cd |
| Tensor-cell2cell | tf_type, init, svd | "non_negative_cp", "svd", "truncated_svd" | cell2cell/tensor/factorization.py:14 @5fd275c |
| Tensor-cell2cell | n_iter_max, tol | 100, 10e-7 | cell2cell/tensor/factorization.py:14-15 @5fd275c |
| Tensor-cell2cell | rank | None (elbow search) | cell2cell/analysis/tensor_pipelines.py:10 @5fd275c |
| Tensor-cell2cell | upper_rank, tf_init | 25, "random" | cell2cell/analysis/tensor_pipelines.py:12 @5fd275c |
| Tensor-cell2cell | elbow_metric, tf_svd | "error", "numpy_svd" | cell2cell/analysis/tensor_pipelines.py:12-13 @5fd275c |
| LIANA+ | n_perms, seed | 1000, 1337 | src/liana/_core/_constants.py:20-21 @08590db |

## 5. Proposed singlet approach

- **MultiNicheNet route: reimplement (default, `multinichenet`).** Singlet implements the sample-level route on its own pseudobulk kernels: donor-by-cell-type sums, negative-binomial contrasts, the empirical null and the weighted prioritisation, with the defaults in section 4. The reference code is the specification; none of it is copied.
- **Tensor-cell2cell route: port (`tensor_cell2cell`).** The non-negative CP pipeline, its masking convention and the elbow search are ported. The output records which initialisation was used, because the pipeline and the factorisation default differ.
- **CellChat and LIANA+: callout.** Benchmark comparators only (B1 to B3 and P1). Singlet does not ship their code.

The model-based formulation singlet proposes is a donor-level hierarchical negative-binomial model of the LR feature. Per sender, receiver, pair, donor and condition, donor random intercepts sit on the feature, pairs and cell types are partially pooled, and a condition contrast is tested. Uncertainty comes from the posterior and from donor relabelling. The model enters the method enum only when its specification is written and it passes B1 and B2. It is rejected if its B1 upper Monte Carlo bound exceeds 0.10, or if its B2 TPR at $f=2$ with six donors per group falls below that of the default route.

The ML stack is hybrid. Hard-coded CUDA or cuSPARSE covers the small hot models: pseudobulk aggregation as a sparse product of a cell-by-(donor by type) indicator with the counts, batched IRLS for many NB fits, batched donor relabelling, and masked NN-CP multiplicative updates. PyTorch covers the hierarchical donor model, where autodiff and random effects pay off.

The CPU path aggregates chunks of cells into sparse sums and fits genes in parallel. The pseudobulk step streams over cell chunks, so memory scales with donors, types and genes rather than cells. The NB and tensor steps run on pseudobulk and on an expressed-pair tensor restricted by `top_n_LR`. CUDA runs batched IRLS, relabelling and NN-CP updates.

Defaults an agent should use without asking: the default route with the section 4 defaults.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Raw UMI or read counts; required for pseudobulk sums |
| read | obs/<cell_type_key> | categorical | Cell-type labels; each type is tested separately |
| read | obs/<sample_key> | categorical | Sample unit, one donor in one condition |
| read | obs/<donor_key> | categorical | Donor; the unit of inference and of relabelling |
| read | obs/<condition_key> | categorical | Contrast variable; constant within a sample |
| read | obs/<batch_keys> | categorical | Optional covariates in the design |
| read | uns/lr_resource | table | Ligands, receptors, subunits and evidence, from `communication.lr_resource_curation` |
| write | uns/ccc_diff_sample_scores | table | Per donor, sender, receiver and pair: pseudobulk values, fraction expressing, cell counts |
| write | uns/ccc_diff_results | table | Per contrast and triplet: effect size, p-value, FDR, method, donors per group |
| write | uns/ccc_diff_prioritization | table | Per contrast: prioritisation score and its criteria (default route) |
| write | models/ccc_diff_pb_nb | object | Optional per gene and cell type NB fits: dispersion and coefficients |
| write | models/ccc_nncp_factors | object | Optional tensor factors A, B, C, D and the selected rank |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 1 | min 0 | Random seed for tensor initialisation; the multinichenet method ignores it. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing ccc_diff members for the same contrast and method instead of failing. |
| `method` | string | "multinichenet" | `multinichenet`, `tensor_cell2cell` | multinichenet: default sample-level route with empirical null. tensor_cell2cell: donor-resolved factors, no p-values. |
| `contrast` | string | required | — | Condition contrast written test_vs_reference, for example treated_vs_control; both levels must exist. |
| `design` | object | — | — | Column names and donor settings for the design. |
| `design.sample_key` | string | "sample_id" | — | obs column identifying the sample (one donor in one condition). |
| `design.donor_key` | string | "donor_id" | — | obs column identifying the donor; the unit of inference. |
| `design.condition_key` | string | "condition" | — | obs column holding the condition labels. |
| `design.cell_type_key` | string | "cell_type" | — | obs column holding cell-type labels; each type is tested separately. |
| `design.batch_keys` | array | [] | — | Optional batch covariates in the design (multinichenet only). |
| `design.min_donors_per_group` | integer | 3 | min 2 | Minimum donors per condition before a contrast is tested. |
| `lr_resource` | string | "uns/lr_resource" | — | Ligand-receptor table in uns, or a resource name from communication.lr_resource_curation. |
| `p_val_threshold` | number | 0.05 | min 0; max 1 | Significance cut-off used to flag triplets in tables and the summary. |
| `multinichenet` | object | — | — | Options for the multinichenet method. |
| `multinichenet.fraction_cutoff` | number | 0.05 | min 0; max 1 | Minimum fraction of cells in a sample expressing a gene for it to count as expressed. |
| `multinichenet.min_sample_prop` | number | 0.5 | min 0; max 1 | Fraction of samples in the smallest group that must express a gene. |
| `multinichenet.min_cells` | integer | 10 | min 1 | Minimum cells per sample and cell type for a pseudobulk observation. |
| `multinichenet.scenario` | string | "regular" | `regular`, `no_activity`, `lower_DE`, `no_frac_LR_expr` | Prioritisation weight scenario; regular weights all criteria equally. |
| `multinichenet.ligand_activity_down` | boolean | false | — | Include downregulated ligand activity in the prioritisation score. |
| `multinichenet.logFC_threshold` | number | 0.5 | min 0 | Minimum absolute log fold change for the NicheNet target gene set. |
| `multinichenet.empirical_pval` | boolean | true | — | Calibrate p-values with an empirical null estimated from the test statistics. |
| `multinichenet.top_n_target` | integer | 250 | min 1 | Top predicted target genes kept per ligand for NicheNet links. |
| `multinichenet.top_n_LR` | integer | 2500 | min 1 | Number of LR pairs kept in the output table. |
| `multinichenet.n_cores` | integer | 1 | min 1 | Parallel workers for per-cell-type fits. |
| `tensor_cell2cell` | object | — | — | Options for the tensor_cell2cell method. |
| `tensor_cell2cell.rank` | integer/null | null | min 1 | Fixed NN-CP rank; null runs an elbow search up to upper_rank. |
| `tensor_cell2cell.upper_rank` | integer | 25 | min 2 | Largest rank tried by the elbow search. |
| `tensor_cell2cell.tf_init` | string | "random" | `random`, `svd` | Initialisation of the NN-CP factors; the choice is recorded in the output. |
| `tensor_cell2cell.n_iter_max` | integer | 100 | min 1 | Maximum multiplicative-update iterations per rank. |
<!-- PARAMS:AUTO:END -->

`contrast` is required, and each design key must name an existing `obs` column. `method` selects which nested object applies. `tensor_cell2cell` writes factors and no p-values, so FDR-based summaries are absent for it. A set `rank` replaces the elbow search and ignores `upper_rank`. A contrast with fewer than `design.min_donors_per_group` donors in either group is skipped with a logged reason, and cell types with too few cells per donor are dropped before testing. `batch_keys` enter the design of the default route only. Validation runs before any computation, so a bad key fails in a dry run.

## 7. MCP tool

Tool `singlet_communication_differential_communication` (definition in `tasks/mcp/singlet_communication_differential_communication.json`). One example call and one compact result:

```json
{"dataset": "/data/study.singlet", "contrast": "treated_vs_control",
 "design": {"sample_key": "sample_id", "donor_key": "donor_id", "condition_key": "condition", "cell_type_key": "cell_type", "batch_keys": ["batch"]}}
```

```json
{"dataset": "/data/study.singlet", "status": "completed",
 "wrote": ["uns/ccc_diff_sample_scores", "uns/ccc_diff_results", "uns/ccc_diff_prioritization"],
 "summary": {"method": "multinichenet", "contrast": "treated_vs_control", "donors_per_group": {"treated": "<int>", "control": "<int>"}, "triplets_tested": "<int>", "triplets_flagged": "<int>", "null_scale": "<float>", "device": "cpu", "seed": 1},
 "provenance_id": "<string>", "job_id": null}
```

- **Long-running**: a job above the server's inline limit returns `status` queued with a `job_id`; a dry run gives the estimate first.
- **Stochastic**: only `tensor_cell2cell` is stochastic; `seed` fixes its initialisation and the default route is deterministic.
- **Dry run**: returns `seconds`, `peak_memory_gb` and `device` without writing any member.

## 8. Benchmarks

**Shared protocol.** All accuracy benchmarks use the LR resource passed as `lr_resource`, the same donor and gene filters (section 4 defaults and `min_donors_per_group`), identical settings for every method, and the seeds stated per benchmark. The denominator of every metric is the set of testable triplets, those with a valid statistic; untestable triplets are excluded, not counted as negatives. Monte Carlo 95% intervals are taken over seeds or relabellings. Hardware and device are recorded for each run.

### B1. Donor-level null calibration by donor relabelling

- **Goal**: measure whether a method controls false positives when donors are the replicates and no true condition effect exists.
- **Ground truth**: null by construction. Condition labels are reassigned among donors within batch, so every testable triplet is a null (label 0). Estimand: the fraction of testable triplets with adjusted p ≤ 0.05 in one relabelling, averaged over relabellings.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Multi-donor scRNA-seq with donor and batch labels, at least 8 donors per condition | Vignette subsets of [R6] at https://zenodo.org/record/8010790 (SCC, breast cancer, MIS-C) | scRNA-seq, human; size — | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Empirical FDR | Mean over R ≥ 100 relabellings of the fraction of testable triplets with adjusted p ≤ 0.05 | minimise; target ≤ 0.05 | primary | [R1] |
| Testable triplets per run | Mean count of triplets with a valid statistic per relabelling | maximise | guardrail | — |

- **Comparators**: the default route; CellChat cell-label permutation (callout), expected anti-conservative with donor replicates [R1]; LIANA+ by_sample and Tensor-cell2cell, reported descriptively and excluded from FDR because neither gives a donor-level test.
- **Protocol**:
  1. Keep donors with batch labels and at least eight donors per condition.
  2. Draw a relabelling: within each batch, permute condition labels across donors, keeping class sizes and cell-type composition.
  3. Apply each method with shared settings; record testable triplets and adjusted p-values.
  4. Repeat for R ≥ 100 relabellings and report the mean FDR with its Monte Carlo 95% interval.
- **Acceptance criterion**: proposed, not from the literature. Primary method: empirical FDR at most 0.05 with upper Monte Carlo bound at most 0.10. Above 0.10 it is reported as not calibrated for donor-level inference.
- **Known pitfalls**:
  - Relabelling is invalid if donors differ systematically in composition or batch is confounded with condition; a real difference then survives the shuffle.
  - LR pairs are correlated, so per-relabelling FDR is noisier than the interval suggests.

### B2. Planted differential interactions with negative controls

- **Goal**: measure power, effect-size accuracy and null control.
- **Ground truth**: planted simulation. Planted triplets (label 1) have contrast $\tau=2\pi\log_2 f$ (section 3), with $\pi$ the affected donor fraction (step 5); other triplets (label 0) are null.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated counts on a multi-donor background | Vignette subsets of [R6]; generator recipe as below | scRNA-seq, simulated; size — | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC, planted | Precision-recall area, planted triplets positive | maximise | primary | — |
| TPR at adjusted p ≤ 0.05 | Fraction of tested planted triplets called, over seeds | maximise | primary | — |
| Effect-size bias | Absolute median of estimated minus τ (estimate: summed ligand and receptor log2 fold change) | minimise | guardrail | — |
| Null rejection rate | Fraction of tested non-planted triplets with adjusted p ≤ 0.05 | minimise; target ≤ 0.05 | guardrail | [R1] |

- **Comparators**: the default route; CellChat and the LIANA+ targeted pseudobulk route (callouts).
- **Protocol** (generator recipe):
  1. Fit per-gene NB means and dispersions per cell type on the background, after the section 4 filter.
  2. Draw donor means as background means times a fitted lognormal donor effect.
  3. Assign donors to two conditions, $n\in\{3,6,12\}$ per condition, keeping library sizes.
  4. Plant $K=10$ triplets with ligand and receptor expressed in their sender and receiver types, none shared.
  5. In a random half of condition-B donors ($\pi=0.5$), multiply the sender ligand and receiver receptor NB means by $f\in\{1.5,2,4\}$.
  6. Simulate and apply each method with shared settings over seeds 1 to 50.
- **Acceptance criterion**: proposed. At $f=2$ with six donors per group, default-route TPR at adjusted p ≤ 0.05 is at least 0.5 and the null rejection rate is at most 0.05.
- **Known pitfalls**:
  - Planting without donor effects overstates power (step 2).
  - Planted effects are sharper than biological ones, so TPR overstates real-data power.

### B3. Donor-half replication stability

- **Goal**: measure how reproducible differential LR calls are across random donor halves within each condition.
- **Ground truth**: consistency; no labels. Estimand: between two halves, the Jaccard overlap of the top K = 50 triplets ranked by adjusted p (K fixed in advance), and the Spearman correlation of effect sizes over triplets testable in both halves.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Squamous cell carcinoma subset | sce_subset_scc.rds at zenodo 8010790 [R6] | scRNA-seq, human; size — | — | Paired design; halves keep pairs together |
| Breast cancer subset | sce_subset_breastcancer.rds at zenodo 8010790 [R6] | scRNA-seq, human; size — | — | Multifactorial design |
| MIS-C subset | sce_subset_misc.rds at zenodo 8010790 [R6] | scRNA-seq, human; size — | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Jaccard overlap of top K | Jaccard index of the top K triplets from the two halves of one contrast, K = 50 | maximise | primary | — |
| Rank correlation | Spearman correlation of effect sizes over triplets testable in both halves | maximise | guardrail | — |

- **Comparators**: the default route; CellChat (callout); LIANA+ targeted pseudobulk route (callout).
- **Protocol**:
  1. Within each condition, split donors into two halves stratified by batch and pair membership, keeping at least three donors per condition in each half.
  2. Apply each method to each half with identical settings.
  3. Compute the Jaccard overlap and the rank correlation.
  4. Repeat for 1000 splits and report medians and distributions.
- **Acceptance criterion**: proposed. On the B2 planted simulation with $f=2$ and six donors per group, the median Jaccard overlap at K = 50 is at least 0.3. On real subsets, distributions are reported without a threshold.
- **Known pitfalls**:
  - Consistency rewards stable but biased methods, such as those that favour highly expressed pairs; it does not measure correctness.
  - Halves share cell-type composition, so overlap overstates reproducibility.

### P1. Performance and scaling

Measure wall-clock time, peak memory and throughput (cells per second) on CPU and CUDA at 10^4, 10^5 and 10^6 cells, and at 10^7 cells for the streaming path, with 10, 50 and 200 donors per condition (proposed grid). Comparators: the default route, CellChat `computeCommunProb` at its default permutation count, LIANA+ by_sample at its default permutation count, and Tensor-cell2cell with elbow search. Hold fixed: the LR resource, the cell-type count, a single core for the default route and the `top_n_LR` restriction; record whether a GPU was used. Use subsets of the singlet catalogue (354M cells, about 40% author-annotated) so labels are comparable. Report scaling exponents only after measuring.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `communication.lr_resource_curation`: Ligand-receptor resource curation and harmonisation
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Feeds**:
  - `communication.interaction_significance_calibration`: Calibration of interaction significance against a no-communication null
  - `communication.consensus_interaction_ranking`: Consensus ranking of interactions across communication methods
  - `communication.communication_pattern_decomposition`: Communication pattern and multi-pathway network decomposition
- **Reads**: `layers/counts`, `obs/<cell_type_key>`, `obs/<sample_key>`, `obs/<donor_key>`, `obs/<condition_key>`, `obs/<batch_keys>`, `uns/lr_resource`
- **Writes**: `uns/ccc_diff_sample_scores`, `uns/ccc_diff_results`, `uns/ccc_diff_prioritization`, `models/ccc_diff_pb_nb`, `models/ccc_nncp_factors`
<!-- CHAINING:AUTO:END -->

Sits in the multi-sample condition-comparison chain after cell-type annotation. No named recipe covers it yet.

## 10. Risks, pitfalls and open questions

- **Unconfirmed details of the replicate-aware route.** The MultiNicheNet journal version was not found, and only Robin Browaeys is confirmed as an author, from repository files. The scaling transforms in the prioritisation, the edgeR fitting path inside muscat's pbDS, and CellChat's ligand-receptor matrix construction with its distance and contact factors were not checked.
- **Methods left out of the tables.** The differential framework of Cesaro et al. [R18] is cited from its bibliographic record only; its repository, donor handling and validation details are not checked. CrossTalkeR [R19] is not checked. None appears in the methods table or the enum.
- **Statements from memory or summaries.** The empirical-null estimator [R16] is from memory. The B1 relabelling design is adapted from donor-level null tests [R1] as summarised elsewhere, not from the paper's text. The Tensor-cell2cell model specification (mode order, mask convention) comes from the repository code and LIANA's multi-sample reference [R11] rather than from its paper [R9].
- **Spatial and steady-state truth.** The OpenProblems spatial co-localisation truth [R13] (bivariate Moran's I with Benjamini-Hochberg control, `src/data_processors/infer_truth/funs.py:25` in the task repository) is steady-state. Its example resource, SCP2167, is referenced only in the loader directory, no differential contrast is defined in the local clone, and no metric configuration files exist under `src/metrics`. Spatial proximity is only a proxy for signalling [R20]. This benchmark is folded here and not run.
- **Dataset licences and sizes.** Licences and sizes of the zenodo 8010790 subsets are not confirmed, so the B1 to B3 datasets must be cleared before redistribution. No accession is known for a true differential-communication benchmark.
- **Technical and design risks.** Composition-aware scoring is unsolved, the donor-level LR score definition is untested, and tensor rank and factor stability across initialisations are unknown. Any reuse of code from the MultiNicheNet or CellChat repositories must wait for the route decision in section 5.
- **First experiment.** Apply B1 to the default route on a catalogue subset with donor and batch labels and at least eight donors per condition, using 100 relabellings. If the upper bound exceeds 0.10, fix the donor-level feature or the empirical null first. Otherwise measure B2 power at $f=2$ with six donors per group as the baseline for the hierarchical model.

## 11. References

R1. Squair JW, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)

R2. Zimmerman KD, Espeland MA, Langefeld CD. A practical solution to pseudoreplication bias in single-cell studies. *Nature Communications* 2021. doi:10.1038/s41467-021-21038-1 — verified (corpus)

R3. Murphy AE, Skene NG. A balanced measure shows superior performance of pseudobulk methods in single-cell RNA-sequencing analysis. *Nature Communications* 2022. doi:10.1038/s41467-022-35519-4 — verified (corpus)

R4. Junttila S, Smolander J, Elo LL. Benchmarking methods for detecting differential states between conditions from multi-subject single-cell RNA-seq data. *bioRxiv* 2022 (preprint). doi:10.1101/2022.02.16.480662 — verified (corpus)

R5. Crowell HL, et al. muscat detects subpopulation-specific state transitions from multi-sample multi-condition single-cell transcriptomics data. *Nature Communications* 2020. doi:10.1038/s41467-020-19894-4 — verified (corpus)

R6. Browaeys R, et al. MultiNicheNet: a flexible framework for differential cell-cell communication analysis from multi-sample multi-condition single-cell transcriptomics data. *bioRxiv* 2023 (preprint). doi:10.1101/2023.06.13.544751 — verified (corpus)

R7. Jin S, et al. Inference and analysis of cell-cell communication using CellChat. *Nature Communications* 2021. doi:10.1038/s41467-021-21246-9 — verified (corpus)

R8. Jin S, Plikus MV, Nie Q. CellChat for systematic analysis of cell-cell communication from single-cell transcriptomics. *Nature Protocols* 2025. doi:10.1038/s41596-024-01045-4 — verified (corpus)

R9. Armingol E, et al. Context-aware deconvolution of cell-cell communication with Tensor-cell2cell. *Nature Communications* 2022. doi:10.1038/s41467-022-31369-2 — verified (corpus)

R10. Dimitrov D, et al. LIANA+ provides an all-in-one framework for cell-cell communication inference. *Nature Cell Biology* 2024. doi:10.1038/s41556-024-01469-w — verified (corpus)

R11. Dimitrov D, et al. liana-py repository, multi-sample reference file src/liana/_skills/data/references/multisample.md at commit 08590db. https://github.com/saezlab/liana-py — verified (repo)

R12. Dimitrov D, et al. Comparison of methods and resources for cell-cell communication inference from single-cell RNA-Seq data. *Nature Communications* 2022. doi:10.1038/s41467-022-30755-0 — verified (corpus)

R13. Luecken MD, et al. Defining and benchmarking open problems in single-cell analysis. *Nature Biotechnology* 2025. doi:10.1038/s41587-025-02694-w — verified (corpus)

R14. Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. *Bioinformatics* 2009. doi:10.1093/bioinformatics/btp616 — verified (corpus)

R15. Browaeys R, Saelens W, Saeys Y. NicheNet: modeling intercellular communication by linking ligands to target genes. *Nature Methods* 2020. doi:10.1038/s41592-019-0667-5 — verified (corpus)

R16. Efron B. Large-scale simultaneous hypothesis testing: the choice of a null hypothesis. *Journal of the American Statistical Association* 2004. — unverified (memory)

R17. Armingol E, Officer A, Harismendy O, Lewis NE. Deciphering cell-cell interactions and communication from gene expression. *Nature Reviews Genetics* 2021. doi:10.1038/s41576-020-00292-x — verified (corpus)

R18. Cesaro G, Baruzzo G, Tussardi G, Di Camillo B. Differential cellular communication inference framework for large-scale single-cell RNA-sequencing data. *NAR Genomics and Bioinformatics* 2025. doi:10.1093/nargab/lqaf084 — verified (corpus)

R19. Nagai JS, et al. CrossTalkeR: analysis and visualization of ligand-receptor networks. *Bioinformatics* 2021. doi:10.1093/bioinformatics/btab370 — verified (corpus)

R20. Liu Z, Sun D, Wang C. Evaluation of cell-cell interaction methods by integrating single-cell RNA sequencing data with spatial information. *Genome Biology* 2022. doi:10.1186/s13059-022-02783-y — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task |
|---|---|---|---|
| https://github.com/saeyslab/multinichenetr (f1db92c; DESCRIPTION names https://github.com/browaeysrobin/multinichenetr) | Robin Browaeys (maintainer and author in DESCRIPTION) | GPL-3 (LICENSE file is GPL v3; DESCRIPTION "GPL-3 + file LICENSE") | Default route; defaults in section 4 |
| https://github.com/jinworks/CellChat (75253cd) | Suoqin Jin (author and maintainer in DESCRIPTION) | GPL-3 (DESCRIPTION and LICENSE) | Cell-level comparator |
| https://github.com/earmingol/cell2cell (5fd275c) | Erick Armingol (LICENSE copyright holder); setup.py author "cell2cell development team" | BSD-3-Clause (LICENSE.txt) | Tensor-cell2cell route |
| https://github.com/saezlab/liana-py (08590db) | Daniel Dimitrov (maintainer in pyproject.toml); further authors listed there | BSD-3-Clause (LICENSE file, copyright 2025); a catalogue record lists GPL-3.0 | Descriptive and targeted comparators |
| https://github.com/openproblems-bio/task_cell_cell_communication | Open Problems in Single-Cell Analysis (copyright holder in LICENSE) | MIT (LICENSE file) | Spatial truth definition, folded benchmark (section 10) |
