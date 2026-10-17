---
id: genetics.cell_type_cis_eqtl_mapping
title: Cell-type-specific cis-eQTL mapping and cross-cell-type effect sharing
area: genetics
scope: extended
paradigm: model-based
literature_status: contested
priority: P2
depends_on: [demux.donor_assignment_reference_genotypes, annotation.cluster_label_assignment, normalization.size_factor_estimation]
feeds: [genetics.eqtl_gwas_colocalization, genetics.context_dependent_eqtl, deconvolution-bulk.celltype_specific_eqtl_bulk]
reads: [layers/counts, obs/donor_id, obs/cell_type, obs/batch, obs/size_factor, uns/genotype_dosage, uns/genotype_variants, uns/donor_covariates]
writes: [uns/cis_eqtl/<cell_type>, uns/cis_eqtl_shared, models/mashr_<run>, uns/cis_eqtl_qc]
devices: [cpu, cuda]
mcp_tool: singlet_genetics_cell_type_cis_eqtl_mapping
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Cell-type-specific cis-eQTL mapping and cross-cell-type effect sharing

> For each cell type, tests whether common variants near a gene shift its donor-level expression, then shares the estimated effects across cell types by empirical Bayes.

## 1. Question

Which common variants in the cis window of a gene are associated with that gene's donor-level expression within each cell type, and how much of each effect is shared across cell types? Inputs are donor genotype dosages, donor-by-cell-type pseudobulk (or cell-level counts with donor labels) and donor covariates. Outputs are per-cell-type effects, standard errors, p-values and q-values, plus shrunken multi-context effects. A correct answer is an effect that holds in independent donors and matches the truth defined in section 8.

## 2. Why this task matters and where the field stands

Cis-eQTLs connect common variants to gene regulation. In a study of 14 immune cell types, most of 26,597 independent cis-eQTLs showed cell-type-specific allelic effects [R6], so per-cell-type mapping must also say whether an effect is shared.

The task is **contested** for three reasons.

1. **Donors, not cells, are the unit.** Treating cells as replicates inflates false positives [R5]. Donor-level scans with permutation or t-based calibration are the established approach [R1][R2].
2. **Sharing can erase specificity.** mashr shrinks cell-type estimates towards a common value. dreamlet's documentation says this over-shrinks single-cell pseudobulk and suits specificity ranking better than per-cell-type calls [R3][R4].
3. **Power claims are not yet replicated.** A count-based preprint reports 11 to 16 percent more eGenes than existing approaches on OneK1K [R10]. Cell-level mixed models that handle repeated cells per donor exist [R7][R8], but their cis-test calibration is not benchmarked here.

Open problems: a cell-type eQTL can be a cell-state eQTL when cluster composition differs (shared with genetics.context_dependent_eqtl); genotype-dependent proportions create false cell-type eQTLs unless modelled; power depends jointly on donor count and cells per donor; and the sharing prior grid is unsettled.

## 3. Theory and insight

Let $u_{gn}$ be the UMI count of gene $g$ in cell $n$, $s_n$ its size factor, $S_{ci}$ the cells of donor $i$ in cell type $c$, and $g_{vi}\in\{0,1,2\}$ the ALT-allele dosage of variant $v$ in donor $i$. Donor-level expression is log2 counts per million:

$$y_{gci}=\log_2\!\Big(1+\frac{10^{6}}{\sum_{n\in S_{ci}}s_n}\sum_{n\in S_{ci}}u_{gn}\Big).$$

This is the estimand of every expression output, normalised by the donor's size-factor-weighted library in that cell type.

The cis model is an additive dosage regression within each gene and cell type:

$$y_{gci}=\mu_{gc}+\beta_{gcv}\,g_{vi}+\boldsymbol\gamma^{\top}z_i+\varepsilon_{gci},\qquad \varepsilon_{gci}\sim\mathcal N(0,\sigma_{gc}^2),$$

where $z_i$ holds genotype PCs, batch, sex and optionally cell-type proportions. The regime is an additive model with approximately Gaussian residuals, reasonable for large donor counts and well-expressed genes. Residualising $y$ and $g$ on $z$ gives

$$\hat\beta=\frac{\tilde g^{\top}\tilde y}{\tilde g^{\top}\tilde g},\qquad t=\frac{\hat\beta}{\hat\sigma/\sqrt{\tilde g^{\top}\tilde g}}\sim t_{N-p},$$

exact under Gaussian residuals and approximately normal for large $N$. Variants in a window share the residual projection, so the scan is a matrix product.

Gene-level p-values follow tensorQTL. The maximum $r^2$ over cis variants is recorded for each permutation, a beta distribution with parameters $a_g,b_g$ and effective degrees of freedom $\nu_g$ is fitted to these maxima, and $p^{\beta}_g=F_{\mathrm{Beta}(a_g,b_g)}\big(p_{\nu_g}(r^2_{\mathrm{nom},g})\big)$ [R1][R2]. The fit assumes a shape for the null tail, which B1 tests.

Sharing treats the $C$ estimates of a gene-variant pair as one vector:

$$\hat\beta_j\mid\beta_j\sim\mathcal N_C(\beta_j,\hat S_j),\qquad \beta_j\sim\sum_k\pi_k\,\mathcal N_C(0,\omega_kU_k),$$

where $\hat S_j$ holds the standard errors, $U_k$ are canonical and data-driven covariance patterns and $\pi_k$ are fitted by EM [R3]. The posterior mean is the shrunken effect, and the local false sign rate is $\mathrm{lfsr}_{jc}=\min\{P(\beta_{jc}\le 0\mid\hat\beta),P(\beta_{jc}\ge 0\mid\hat\beta)\}$ [R12]. Both assume correct standard errors, exchangeable tests and a grid that covers the true sharing patterns.

When proportions $\pi_c$ do not depend on genotype, bulk effects are $\beta^{\mathrm{bulk}}_{gv}=\sum_c\pi_c\beta_{gcv}$. This first-order identity for means is derived here, not taken from a source, and genotype-dependent proportions break it.

Estimands, one sentence each:

- $\hat\beta_{gcv}$ is the change in donor log2 CPM per ALT allele, normalised as in the first equation.
- $t$ and $p_{\mathrm{nominal}}$ test $\beta_{gcv}=0$ under the Gaussian model.
- $p^{\beta}_g$ is the gene-level null p-value under donor permutation; $q$ is the FDR across genes within a cell type.
- The posterior mean is the shrunken per-ALT-allele effect in the same units; lfsr is the probability of a wrong sign.
- $\lambda_{\mathrm{GC}}$ (QC output) is the median nominal $\chi^2_1$ over all tested pairs divided by 0.4549; it is a calibration check only where most tests are null.

Failure modes: pseudoreplication [R5]; genotype-dependent proportions; permutations that ignore ancestry, batch or relatedness; low coverage; and LD among cis variants, which needs conditional analysis. mashr over-shrinks, and dreamlet codes genes not evaluated in a cell type as coef 0 and se 1e6 [R4]; that convention's effect on sharing is untested here. Thresholding unshrunken per-cell-type effects is cheap but gives no calibrated probability and shares nothing. The model-based path adds calibrated p-values, posterior sign probabilities and covariate adjustment, at the cost of the assumptions above.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| tensorQTL cis scan | model-based | Per gene and cell type, OLS of residualised donor log2 CPM on each cis dosage, with permutation p-values and beta approximation | [R1][R2] |
| mashr | model-based | Empirical Bayes over effect vectors; learns covariance patterns and returns posterior means and lfsr per condition | [R3] |
| dreamlet | model-based | Donor-by-cell-type pseudobulk with precision-weighted linear mixed models, then pooling across cell types with mashr | [R4] |
| NEBULA | model-based | Cell-level negative binomial mixed model with a subject random effect and a large-sample approximation | [R8] |
| CellRegMap | model-based | Cell-level linear mixed model for genotype-by-context effects, accounting for repeated cells per donor and population structure | [R7] |

The donor-level linear scan with permutation calibration is the published standard for cis-QTL mapping [R1]. Cross-cell-type sharing of pseudobulk effects uses mashr [R3][R4]. Cell-level mixed models are the alternative for cell-level data [R7][R8]. dreamlet's linear-model fit, NEBULA and CellRegMap are comparators here.

| Method | Parameter | Value | Source |
|---|---|---|---|
| tensorQTL cis scan | cis window (bases, around TSS) | 1,000,000 | tensorqtl/tensorqtl.py:33 @ 0c4db65; function defaults cis.py:72, 132, 629 |
| tensorQTL cis scan | permutations | 10,000 | tensorqtl/tensorqtl.py:29 @ 0c4db65 |
| tensorQTL cis scan | MAF threshold | 0 (no filter) | tensorqtl/tensorqtl.py:36 @ 0c4db65 |
| tensorQTL cis scan | FDR | 0.05 | tensorqtl/tensorqtl.py:49 @ 0c4db65 |
| tensorQTL cis scan | beta approximation | on (`--disable_beta_approx` turns it off) | tensorqtl/tensorqtl.py:46 @ 0c4db65 |
| mashr (worked example in dreamlet) | lfsr threshold in example | 0.05 | dreamlet R/mash.R:121 (remote HEAD 6ddcb83) |
| dreamlet | genes not evaluated in a cell type | coef 0, se 1e6 before mashr | dreamlet R/mash.R:76, 209 (remote HEAD 6ddcb83) |
| splatPop (B2 simulator) | eQTL count; distance; minimum MAF; effect shape and rate; group-specific share | 0.5; 1e6 bp; 0.05; 3.6 and 12; 0.2 | Oshlack/splatter R/AllClasses.R:589–596 (remote HEAD eeb1dfc) |

## 5. Proposed singlet approach

**Routes.** The donor-level scan follows tensorQTL's model, window, permutation and beta approximation and is **ported**; its residualised kernel is a CUDA matrix product over genotype and phenotype blocks. mashr is **ported** on donor-level betas and standard errors. dreamlet, NEBULA and CellRegMap are **callouts**, used only as comparators (section 8).

**Model.** Fit the section 3 model per gene, cell type and window variant; calibrate gene-level p-values by permutation with the beta approximation; compute q-values per cell type; then share each pair's per-cell-type betas with mashr. Cell-state interaction effects are out of scope (genetics.context_dependent_eqtl).

**Falsification.** The default is rejected if any B1 or B2 acceptance criterion fails, or if on planted triples the mashr posterior mean is not closer to the planted effect than the unshrunken estimate.

**Stack.** No deep model is needed in v1, so PyTorch is not a dependency; it is the planned route for a negative-binomial count model (section 10). Hand-written CUDA covers the residualised cis kernel, where per-test matrices are small (cell types in the tens) and batches are very large, so launch overhead dominates. cuSPARSE covers pseudobulk aggregation as a sparse membership matrix times counts. The mashr EM stays on CPU in v1.

**Streaming.** Pseudobulk aggregation streams cells in chunks, so memory scales with donor-by-cell-type blocks, not with cells. The CPU and CUDA paths must agree within floating-point tolerance, which is a test rather than a claim. Agents use the defaults in the section 6 table; MAF 0.05 is the proposed analysis value, not tensorQTL's 0.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, cells by genes |
| read | obs/donor_id | string | donor key for pseudobulk |
| read | obs/cell_type | category | cell-type label per cell |
| read | obs/batch | category | technical batch, optional |
| read | obs/size_factor | float32 | per-cell size factor |
| read | uns/genotype_dosage | sparse float | donor by variant ALT dosage, 0 to 2 |
| read | uns/genotype_variants | table | chr, pos, ref, alt, MAF, variant_id |
| read | uns/donor_covariates | table | genotype PCs, sex, age, batch, optional proportions |
| write | uns/cis_eqtl/<cell_type> | table | variant_id, gene_id, beta, se, t, p_nominal, p_beta, q_value, n_donors |
| write | uns/cis_eqtl_shared | table | gene, variant, posterior mean and lfsr per cell type |
| write | models/mashr_<run> | object | covariance grid and fitted weights |
| write | uns/cis_eqtl_qc | table | per cell type: lambda_GC, donors, cells, genes tested |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI with donor genotypes in uns/genotype_dosage. |
| `model` | string | "pseudobulk_linear" | `pseudobulk_linear` | Test family; the donor-level linear model is the only model in this version. |
| `cis_scan` | object | — | — | Cis window and variant filter shared by all models. |
| `cis_scan.window` | integer | 1000000 | min 1 | Cis window half-width around the TSS, in bases. |
| `cis_scan.maf_threshold` | number | 0.05 | min 0; max 0.5 | Minimum minor allele frequency of tested variants. |
| `covariates` | array | ["genotype_pcs", "batch"] | — | Donor covariates from uns/donor_covariates; add cell_type_proportions if composition may depend on genotype. |
| `obs_keys` | object | — | — | Names of the obs columns for donor, cell type and batch. |
| `obs_keys.donor` | string | "donor_id" | — | obs column holding donor identifiers. |
| `obs_keys.cell_type` | string | "cell_type" | — | obs column holding cell-type labels. |
| `obs_keys.batch` | string | "batch" | — | obs column holding technical batch. |
| `min_donors_per_celltype` | integer/null | null | min 2 | Skip cell types with fewer donors; null disables the gate. Set from a power analysis. |
| `pseudobulk_linear` | object | — | — | Options for the donor-level linear model. |
| `pseudobulk_linear.permutations` | integer | 10000 | min 1 | Phenotype permutations for gene-level p-values. |
| `pseudobulk_linear.beta_approx` | boolean | true | — | Fit the beta approximation to the permutation maxima. |
| `pseudobulk_linear.fdr` | number | 0.05 | min 0; max 1 | FDR target for gene-level q-values, per cell type. |
| `pseudobulk_linear.min_cells_per_donor_celltype` | integer | 10 | min 1 | Minimum cells needed to form a donor-by-cell-type pseudobulk. |
| `mashr` | object | — | — | Cross-cell-type sharing with mashr. |
| `mashr.enabled` | boolean | true | — | Apply sharing when at least two cell types have results. |
| `mashr.lfsr_threshold` | number | 0.05 | min 0; max 1 | Local false sign rate cut-off for sharing calls. |
| `mashr.covariances` | string | "both" | `canonical`, `data_driven`, `both` | Covariance grid for the mashr prior. |
| `seed` | integer | 0 | — | Random seed for permutation draws. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing results. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules that span parameters. `cis_scan` applies to every model and `pseudobulk_linear` only to that model. `mashr` is skipped unless at least two cell types have results. Dosages are coded on the ALT allele in `uns/genotype_variants`; donors missing from genotypes are dropped and listed in QC. Cell types below `min_donors_per_celltype` are skipped and reported. The `uns/genotype_*` names are proposed.

## 7. MCP tool

Tool name `singlet_genetics_cell_type_cis_eqtl_mapping` (definition in `tasks/mcp/singlet_genetics_cell_type_cis_eqtl_mapping.json`). Example call:

```json
{"dataset": "onek1k.singlet", "cis_scan": {"window": 1000000, "maf_threshold": 0.05},
 "pseudobulk_linear": {"permutations": 10000}, "mashr": {"covariances": "both"}, "seed": 0}
```

Example result (placeholders, not outputs):

```json
{"dataset": "onek1k.singlet", "status": "completed",
 "wrote": ["uns/cis_eqtl/<cell_type>", "uns/cis_eqtl_shared", "models/mashr_<run>", "uns/cis_eqtl_qc"],
 "summary": {"per_cell_type": "<n_donors, n_pairs_tested, n_egenes_q05, lambda_gc>"},
 "provenance_id": "<id>"}
```

The permutation step can return `queued` with a `job_id` for large inputs. The method is stochastic only through the permutation draws, which `seed` fixes. `dry_run` returns estimated seconds, peak memory and device without computing results.

## 8. Benchmarks

**Shared protocol.** Every accuracy benchmark analyses each cell type separately with the same window, covariates and MAF filter, and scores all methods on the same (variant, gene, cell type) triples. Seeds are 0 to 4 unless stated, and the spread across seeds is reported. Calls use gene-level q-values at FDR 0.05 unless stated. Each comparator is pinned to a named commit or version.

### B1. Null calibration under donor-level permutation

- **Goal**: Check that per-cell-type p-values are uniform under the null, so reported FDR and $\lambda_{\mathrm{GC}}$ are trustworthy.
- **Ground truth**: Planted null by permutation. Donor phenotypes are permuted within batch strata with genotypes and covariates fixed, so every test has a null label. Estimand: the null distribution of the nominal p-value; no normalisation.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| OneK1K discovery study | [R6]; onek1k.org | human PBMC; 1.27 million cells; 982 donors; 14 cell types | — | genotypes and phenotypes observed |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| $\lambda_{\mathrm{GC}}$ | median null $\chi^2_1$ over 0.4549 | toward 1 | primary | — |
| Type I error | null tests with $p<\alpha$, $\alpha=0.05$ and $0.01$; at least $10^5$ tests per cell type | toward $\alpha$ | primary | — |
| QQ deviation | maximum gap in $-\log_{10}p$, lower 99 percent | smaller | guardrail | — |

- **Comparators**: donor-level scan (section 5); dreamlet at 6ddcb83 [R4]; NEBULA 1.5.8 at 70593f9 [R8]; cells as replicates (negative control).
- **Protocol**: Permute within batch strata until at least $10^5$ null tests per cell type are pooled (proposed).
- **Acceptance criterion**: Proposed, not from the literature: donor-level $\lambda_{\mathrm{GC}}$ in [0.95, 1.05] and Type I error in [0.045, 0.055]; the cell-level control must fail one.
- **Known pitfalls**: Permuting genotypes breaks LD. Strata ignoring ancestry or relatedness miscalibrate the null.

### B2. Planted cis-eQTL recovery with shared and specific effects

- **Goal**: Measure power, sign accuracy and posterior error against planted shared and specific effects.
- **Ground truth**: Planted simulation: each selected gene has one eSNP with a signed, global or group-specific effect (R/splatPop-simulate.R:745–827, 847–864). Estimand: per-ALT-allele log2 fold change $\log_2(1+s\,\mathrm{ES})$, with ES the simulator effect and $s=\pm1$ its sign; a triple is planted if its eSNP matches and its effect covers its cell type.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| splatPop simulated counts | [R9]; Oshlack/splatter | scRNA-seq; 50, 200, 800 donors; 500 cells per donor (proposed) | see section 12 | section 4 defaults |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| TPR at $q<0.05$ | planted triples called | higher | primary | — |
| Empirical FDR | non-planted share of calls | at most 0.05 | primary | — |
| Sign accuracy | calls with the planted sign | higher | primary | — |
| Posterior MSE | mashr mean versus planted effect; compare unshrunken | lower | primary | — |
| lfsr calibration | wrong-sign share among lfsr < 0.05 calls | at most 0.05 | guardrail | — |

- **Comparators**: donor-level scan (q < 0.05); unshrunken $\hat\beta$; mashr mean.
- **Protocol**: Simulate at the defaults over donors, cells per donor and seeds; two settings fix the group share at 0 and 1.
- **Acceptance criterion**: Proposed, not from the literature: empirical FDR at most 0.07; lfsr calibration at most 0.05; posterior MSE below unshrunken.
- **Known pitfalls**: The simulator's multiplicative dosage favours the proposal; one eSNP per gene and no LD hide tag confounding.

### B3. Concordance with bulk GTEx cis-eQTL, by sharing class

- **Goal**: Check that shared-class calls agree in sign with bulk eQTL, and that specific calls are less often bulk-supported, as dilution predicts.
- **Ground truth**: Orthogonal measurement. Estimand: the sign of the bulk slope on the ALT allele (hg38); magnitudes are not compared because units differ. Bulk-supported means nominal p < 0.05 in Whole Blood with that sign. Shared means lfsr < 0.05 in at least two cell types with one sign; specific means exactly one.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| GTEx v8 cis-eQTL, Whole Blood | [R11] | human bulk, hg38 | — | tissue match is a judgement |
| OneK1K discovery calls | [R6] | as B1 | — | FDR 0.05 calls |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Sign concordance, shared | shared calls with bulk p < 0.05 whose bulk sign matches | higher | primary | [R11] |
| Specific bulk support | specific calls with bulk support | reported only | guardrail | — |
| Random-variant control | same concordance for MAF-matched cis variants | about 0.5 | control | — |

- **Comparators**: donor-level scan; mashr and unshrunken $\hat\beta$; the random-variant control.
- **Protocol**: Match hg38 identifiers and ALT alleles; metrics per cell type and sharing class.
- **Acceptance criterion**: Proposed, not from the literature: shared-class concordance at least 0.80; control about 0.5.
- **Known pitfalls**: Bulk dilutes specific effects, so low specific support is expected. Tissue choice changes which bulk effects exist.

### P1. Performance and scaling

Scales: 10⁴, 10⁵, 10⁶ and 10⁷ cells at 1,000 donors; the 10⁷ point tests the streaming claim. Measure wall time by stage (pseudobulk, cis scan, permutations, mashr), peak device memory and tests per second on CPU and CUDA, and report the scaling exponent in tests and in donors. Comparators: tensorQTL's GPU and CPU modes [R1], whose README reports about 200 to 300 fold GPU speed-up (not measured here); CellRegMap on CPU [R7]; NEBULA per gene [R8]. Hold fixed the 1 Mb window, MAF filter, 10,000 permutations, covariates and FDR procedure. Report pseudobulk time separately from test time.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `demux.donor_assignment_reference_genotypes`: Reference-based genotype donor assignment with doublet calling and cluster-to-individual mapping
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Feeds**:
  - `genetics.eqtl_gwas_colocalization`: Colocalization of cell-type eQTL with GWAS loci
  - `genetics.context_dependent_eqtl`: Context-dependent (cell-state interaction) eQTL mapping
  - `deconvolution-bulk.celltype_specific_eqtl_bulk`: Cell-type-specific eQTL from bulk cohorts using estimated cell fractions
- **Reads**: `layers/counts`, `obs/donor_id`, `obs/cell_type`, `obs/batch`, `obs/size_factor`, `uns/genotype_dosage`, `uns/genotype_variants`, `uns/donor_covariates`
- **Writes**: `uns/cis_eqtl/<cell_type>`, `uns/cis_eqtl_shared`, `models/mashr_<run>`, `uns/cis_eqtl_qc`
<!-- CHAINING:AUTO:END -->

No named recipe includes this task yet; it follows donor assignment, cell typing and size-factor estimation.

## 10. Risks, pitfalls and open questions

- **Evidence limits.** The OneK1K analysis code and model were not located, so OneK1K is cited for its counts only [R6]. The count-based preprint's figures come from its summary rather than its full text, and no repository was found for it [R10]. The titles of the tensorQTL and Ongen references are not in the repository and are omitted; Stephens 2017 is cited from memory [R12].
- **Unsettled science.** mashr over-shrinks single-cell pseudobulk towards a common value [R4]; the prior grid for specific effects is open; and the coef 0, se 1e6 convention for unevaluated entries is untested here. Genotype-dependent proportions create false cell-type eQTLs unless modelled, and the covariate set that captures them is not established.
- **Data rights and replication.** No independent cohort with genotypes and matched cell types was identified, so replication is not a benchmark here; a donor-disjoint OneK1K split would be weaker because study and processing are shared. Licences for OneK1K and GTEx summary statistics are not stated in the corpus. About 40 percent of the 354 million catalogue cells carry author annotations, with labels that differ by study, so labels need harmonising first.
- **Simulator and first experiment.** splatPop plants one eSNP per gene without LD, so B2 cannot test tag confounding [R9]. The first experiment fits B1 on OneK1K with donor permutation within batch strata and checks $\lambda_{\mathrm{GC}}$ per cell type before any sharing step.

## 11. References

R1. Taylor-Weiner A, Aguet F, et al. Genome Biology 2019. doi:10.1186/s13059-019-1836-7 — partial (repo)
R2. Ongen H, et al. Bioinformatics 2016;32(10):1479. https://academic.oup.com/bioinformatics/article/32/10/1479/1742545 — partial (repo)
R3. Urbut SM, Wang G, Carbonetto P, Stephens M. Flexible statistical methods for estimating and testing effects in genomic studies with multiple conditions. Nature Genetics 2019;51(1):187–195. doi:10.1038/s41588-018-0268-8 — partial (repo)
R4. Hoffman G, et al. Efficient differential expression analysis of large-scale single-cell transcriptomics data using dreamlet. Nature Communications 2026. doi:10.1101/2023.03.17.533005 — verified (corpus)
R5. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. Nature Communications 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R6. Yazar S, Alquicira-Hernandez J, Wing K, et al. Single-cell eQTL mapping identifies cell type-specific genetic control of autoimmune disease. Science 2022;376(6589). doi:10.1126/science.abf3041 — partial (search)
R7. Cuomo A, et al. CellRegMap: a statistical framework for mapping context-specific regulatory variants using scRNA-seq. Molecular Systems Biology 2022. doi:10.15252/msb.202110663 — verified (corpus)
R8. He L, et al. NEBULA is a fast negative binomial mixed model for differential or co-expression analysis of large-scale multi-subject single-cell data. Communications Biology 2021. doi:10.1038/s42003-021-02146-6 — verified (corpus)
R9. Azodi CB, Zappia L, Oshlack A, McCarthy DJ. splatPop: simulating population scale single-cell RNA sequencing data. Genome Biology 2021. doi:10.1186/s13059-021-02546-1 — verified (corpus)
R10. Efficient count-based models improve power and robustness for large-scale single-cell eQTL mapping. medRxiv preprint 2025. doi:10.1101/2025.01.18.25320755 — partial (search)
R11. GTEx Consortium. GTEx Analysis v8 single-tissue cis-eQTL summary statistics (dataset, hg38; accessed May 19, 2021). https://storage.googleapis.com/gtex_analysis_v8/single_tissue_qtl_data/GTEx_Analysis_v8_eQTL.tar — partial (repo)
R12. Stephens M. False discovery rates: a new deal. Biostatistics 2017. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/broadinstitute/tensorqtl | Francois Aguet (authors and maintainers) | BSD-3-Clause (LICENSE file; Broad Institute, 2018–2019) | cis-scan model, defaults, beta approximation | port |
| https://github.com/stephenslab/mashr | Matthew Stephens (listed first); copyright Gao Wang, Sarah Urbut, Peter Carbonetto, Matthew Stephens | BSD-3-Clause (DESCRIPTION and LICENSE file) | cross-cell-type sharing | port |
| https://github.com/DiseaseNeurogenomics/dreamlet | Gabriel Hoffman (aut, cre) | Artistic-2.0 (DESCRIPTION; no LICENSE file in the repository) | comparator; mash usage and NA convention | callout |
| https://github.com/lhe17/nebula | Liang He (maintainer) | MIT (DESCRIPTION; LICENSE file) | cell-level comparator | callout |
| https://github.com/limix/CellRegMap | Anna Cuomo, Danilo Horta | MIT (LICENSE file; setup.cfg) | cell-level comparator | callout |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Alicia Oshlack; Christina Azodi (contributor) | GPL-3 (DESCRIPTION) | planted-truth simulator for B2 | callout (used as a generator, not ported) |
