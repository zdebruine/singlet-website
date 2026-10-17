---
id: deconvolution-bulk.celltype_specific_expression
title: Cell-type-specific expression profiles per bulk sample
area: deconvolution-bulk
scope: core
paradigm: model-based
literature_status: contested
priority: P2
depends_on: [harmonization.gene_identifier_mapping, annotation.cross_dataset_label_reconciliation]
feeds: [deconvolution-bulk.celltype_specific_de_bulk, deconvolution-bulk.celltype_specific_eqtl_bulk]
reads: [bulk/layers/counts, reference/layers/counts, reference/obs/cell_type, reference/obs/cell_state]
writes: [uns/<name>/theta_mean, uns/<name>/theta_sd, uns/<name>/expr/<type>, models/<name>]
devices: [cpu, cuda]
mcp_tool: singlet_deconvolution_bulk_celltype_specific_expression
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Cell-type-specific expression profiles per bulk sample

> For each bulk sample, estimate the expression profile of every cell type or cell state as a split of the bulk counts over genes, together with the fraction of the sample that each type contributes.

## 1. Question

Given raw bulk counts (genes by samples) and a labelled single-cell reference, what expression profile does each cell type, or cell state, have in each bulk sample, and what share of the sample's signal does it contribute? The output for sample $n$ and type $k$ is a profile $\hat\mu_{\cdot kn}$ over the shared genes that sums to one, and a fraction $\hat\theta_{nk}$. A correct answer matches the expression of the cells that generated a simulated bulk sample. For real bulk, the literature offers no accepted per-sample, per-type truth (section 2).

## 2. Why this task matters and where the field stands

Bulk RNA-seq averages over cell types, so a shift in composition appears as a shift in expression. Digital cytometry aimed to separate the two by estimating both abundance and per-sample expression from bulk tissue [R1]. Status: **contested**. The best-practices deconvolution chapter reports that the benchmarks it cites are "overall quite consistent" [R2, R3, R4, R5], but those benchmarks evaluate mainly proportions [R3, R4, R5], so per-type profile accuracy is not settled by them.

Open problems:

- **No accepted per-sample, per-type benchmark.** Simulation benchmarks [R11, R12, R13] are listed by the BayesPrism README; their per-type findings are not summarised here (section 10).
- **Missing types.** Omitting a type present in the bulk worsens results [R3], and the chapter calls missing types a major open challenge [R3, R4].
- **Donor-specific expression.** A single reference cannot represent donor variation. bMIND estimates cell-type-specific expression per bulk sample with a prior derived from single-cell data [R10].
- **Uncertainty.** Most estimators return point values. BayesPrism returns posterior draws [R6], but the calibration of its intervals is not established by the sources used here.

## 3. Theory and insight

### 3.1 Model

| Symbol | Meaning |
|---|---|
| $x_{gn}$ | raw bulk count of gene $g$ in sample $n$ |
| $\phi_{kg}$ | reference profile of component $k$ (a cell type, or a cell state when given), summing to one over genes |
| $\theta_{nk}$ | share of sample $n$'s allocated counts assigned to component $k$, summing to one over components |
| $Z_{gnk}$ | latent count of gene $g$ in sample $n$ allocated to component $k$ |
| $\mu_{gkn}$ | expression profile of type $k$ in sample $n$, summing to one over genes |
| $C, B, \tau$ | Gibbs chain length, burn-in and thinning |

First-order mixing:

$$\mathbb{E}[x_{gn}] \propto \sum_{k=1}^{K} \theta_{nk}\,\phi_{kg}.$$

This holds when counts add across cells and the reference matches each type in this bulk, with no donor, platform or state shift. Proportionality absorbs library size.

Allocation, the exact conditional under the count model:

$$Z_{gn\cdot}\mid x_{gn},\theta_n \sim \mathrm{Multinomial}\big(x_{gn},\ p_{gnk}\big), \qquad p_{gnk}=\frac{\theta_{nk}\phi_{kg}}{\sum_{k'}\theta_{nk'}\phi_{k'g}}.$$

Fractions, a conjugate update:

$$\theta_n \mid Z_n \sim \mathrm{Dirichlet}\Big(\alpha+\sum_g Z_{gn\cdot}\Big),$$

with $\alpha=1$ giving a uniform prior on the simplex.

Per-type profile, derived from posterior mean allocations (not a formula in the source code):

$$\hat\mu_{gkn}=\frac{\hat{\mathbb{E}}[Z_{gkn}\mid x]}{\sum_{g'}\hat{\mathbb{E}}[Z_{g'kn}\mid x]}.$$

The expectation is the average over $T$ retained draws. The chain keeps every $\tau$-th draw after burn-in, so $T=\lceil (C-B)/\tau\rceil$, which is 250 at the defaults. The Monte Carlo error shrinks as $1/\sqrt{T}$ only if draws are nearly independent, and thinning does not remove autocorrelation. The profile is unstable when a type's allocated total is near zero.

Posterior variance, valid only for a mixed chain:

$$\widehat{\mathrm{Var}}(\theta_{nk})\approx \frac{1}{T}\sum_{t=1}^{T}\big(\theta^{(t)}_{nk}\big)^2-\bar\theta_{nk}^{\,2}.$$

Reference floor. Each reference row is normalised. Rows that contain zeros are mixed with a floor $p_{\min}$, $\phi_{kg}=\frac{r_{kg}}{\sum_{g'}r_{kg'}}(1-Gp_{\min})+p_{\min}$, and rows without zeros are normalised directly.

Regression methods fit the signature to bulk by constrained least squares and return fractions only, with no per-type profile.

Identifiability. Each gene total $x_{gn}$ fixes one sum over $K$ allocations, leaving $G(K-1)$ free allocation values per sample. The split is set by $\phi$ and the Dirichlet prior rather than by the counts, so per-type profiles depend on the prior more than fractions do.

Two stages. The sampler works over the reference components, which are cell states and default to cell types when no state labels are given. Its initial posterior is summed over states to types. The reference is then updated per type and gene, $\psi_{tg}\propto\phi_{tg}\exp(\gamma_{tg})$, with $\gamma$ fitted by MAP under a log-normal prior or by MLE, and the sampler is repeated with $\psi$. Each sweep draws $G$ multinomials of size $K$, so the cost is $O(CGK)$ per sample (derived).

### 3.2 Estimands and normalisation

- **$\hat\theta_{nk}$ (fraction output):** the posterior mean share of sample $n$'s allocated counts over the shared gene set that is assigned to component $k$. This is an RNA share, not a cell-count fraction. The repository README states that the fraction is inferred over the gene set supplied.
- **$\hat\mu_{gkn}$ (profile output):** the posterior mean of type-$k$ allocated counts in sample $n$, normalised to sum to one over the shared genes. It gives the shape of the profile, not an absolute expression per cell. It is reported as CPM, $10^{6}\hat\mu$, for scoring.
- **Posterior used:** the profile comes from the initial posterior, and the final fraction comes from the updated reference, so the two outputs are not drawn from one posterior.
- **Benchmark truths (section 8):** $\mu_{gkn}$ is the sum of raw counts of sampled type-$k$ cells, normalised over the same genes. $\beta_{nk}$ is the realised UMI share of type $k$. $p_{nk}$ is the sampled cell fraction.

### 3.3 Assumptions and failure modes

- The input is a linear, count-scale mixture. Row scaling, column scaling and quantile normalisation are advised against [R3].
- Every bulk type is present in the reference, because missing types bias the other estimates [R3].
- Reference profiles match each type in the bulk. The README warns that a normal reference resembling the tumour (its example is astrocytes in glioblastoma) makes malignant fractions underestimated.
- Collinear or rare components give unstable splits, wide posteriors and noisy profiles.
- A zero reference floor with a small $\alpha$ can underflow to $\theta=0$, as the option documentation warns.
- The sampler defaults include no MCMC convergence diagnostic.

### 3.4 What a model-based formulation adds

Explicit priors ($\alpha$ and $\phi$) state the assumptions, and posterior draws give intervals on $\theta$ and $\mu$. Profile error cannot be separated from fraction error, so per-type accuracy cannot be inferred from proportion benchmarks alone. Calibration of the intervals is untested here, and a trained amortised model would need the same test.

## 4. Methods landscape

The published standard for fractions is constrained regression on a signature. The best-practices chapter recommends linear-scale input, a comprehensive reference and stringent markers [R3]. MuSiC [R8] and bisque [R9] are proportion-only comparators here. Among the methods read for this document, only BayesPrism [R6, R7] returns per-sample, per-type profiles. bMIND [R10] is excluded from the tables (section 10).

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| BayesPrism | model-based | Dirichlet-multinomial allocation of bulk counts to reference components, Gibbs sampling of allocations and fractions, and a per-type reference update | [R6], [R7] |
| MuSiC | hybrid | Weighted non-negative least squares, with gene weights from cross-donor variance; proportions only | [R8] |
| bisque | hybrid | Reference-based or marker-based decomposition of bulk expression; proportions only | [R9] |

Defaults of the methods singlet implements:

| Method | Parameter | Value | Source |
|---|---|---|---|
| BayesPrism | chain.length (C) | 1000 | R/run_prism.R:37 @ 1905205 |
| BayesPrism | burn.in (B) | 500 | R/run_prism.R:37 @ 1905205 |
| BayesPrism | thinning (τ) | 2 | R/run_prism.R:37 @ 1905205 |
| BayesPrism | alpha (α, Dirichlet prior on fractions) | 1 | R/run_prism.R:37 @ 1905205 |
| BayesPrism | seed | 123 | R/run_prism.R:37 @ 1905205 |
| BayesPrism | n.cores | 1 | R/run_prism.R:72 @ 1905205 |
| BayesPrism | update.gibbs | TRUE | R/run_prism.R:73 @ 1905205 |
| BayesPrism | optimizer | MAP | R/run_prism.R:8 @ 1905205 |
| BayesPrism | sigma (MAP prior hyper-parameter) | 2 | R/run_prism.R:8 @ 1905205 |
| BayesPrism | maxit | 100000 | R/run_prism.R:7 @ 1905205 |
| BayesPrism | pseudo.min (reference floor) | 1E-8 | R/new_prism.R:135 @ 1905205 |

## 5. Proposed singlet approach

Routes (licence and repository details are in section 12):

- **Reimplement** the BayesPrism sampler and reference update from the equations in section 3.
- **Callout** MuSiC and bisque as fraction comparators only. Neither is in the MCP enum.

The proposed model is section 3 with the defaults of section 4, batched over bulk samples. Samples are independent given $\phi$ and $\alpha$, so one kernel performs the allocation step for every sample, and the bulk matrix streams one sample at a time.

The model is rejected as the default if it fails the B1 acceptance criteria. The reference update stays on by default only if it raises per-type profile correlation over the initial posterior in B1.

A fast path is a candidate only: an amortised encoder trained with PyTorch on donor-held-out simulated mixtures, with a fraction head and a profile head. It enters the enum only after passing B1's calibration criterion.

ML stack: PyTorch for the encoder and any variational fits. Hard-coded CUDA for the collapsed sampler, where each sweep is $G$ multinomial draws over $K$ components, a fixed small kernel for which a dense GPU implementation is efficient. cuSPARSE for the sparse count matrix. The dependency-free C++ core carries the CPU path. Per-type sums and library sizes accumulate in one streaming sweep over the reference cells.

Defaults an agent uses without asking are those of section 4 and the MCP definition. The default model uses one reference, so donor labels are not required. `dry_run` is advised before large inputs.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | bulk/layers/counts | int | raw bulk counts, genes by samples; no scaling |
| read | reference/layers/counts | sparse int | raw reference UMI counts, cells by genes |
| read | reference/obs/cell_type | category | cell-type labels; undefined and mixed labels are dropped |
| read | reference/obs/cell_state | category | optional state labels, read only when `reference.cell_state_key` is set |
| write | uns/<name>/theta_mean | float32 | samples by components; posterior mean fraction (section 3.2) |
| write | uns/<name>/theta_sd | float32 | samples by components; posterior standard deviation |
| write | uns/<name>/expr/<type> | float32 | samples by genes; per-type profile normalised over genes |
| write | models/<name> | bytes | reference profile, control parameters, seed, software version and sha |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Bulk dataset handle (.singlet path or URI) with raw counts in bulk/layers/counts, genes by samples. |
| `reference` | object | required | — | Labelled single-cell reference: its dataset handle and label keys. |
| `reference.dataset` | string | — | — | Reference dataset handle with raw counts in layers/counts. |
| `reference.cell_type_key` | string | "cell_type" | — | obs column with cell-type labels; undefined and mixed labels are dropped. |
| `reference.cell_state_key` | string/null | null | — | Optional obs column with cell-state labels; null uses cell types only. |
| `method` | string | "bayesprism" | `bayesprism` | Estimation method. bayesprism is the only value offered, and it is the default. |
| `report_min_fraction` | number | 0.05 | min 0; max 1 | Report per-type profiles only for types whose estimated fraction is at least this value. |
| `bayesprism` | object | — | — | Options for the bayesprism method: Gibbs sampling and reference update. |
| `bayesprism.chain_length` | integer | 1000 | min 2 | Gibbs chain length C; retained draws T = ceil((C - burn_in) / thinning). |
| `bayesprism.burn_in` | integer | 500 | min 0 | Initial Gibbs draws discarded; must be below chain_length. |
| `bayesprism.thinning` | integer | 2 | min 1 | Keep every thinning-th draw after burn-in. |
| `bayesprism.alpha` | number | 1 | > 0 | Dirichlet prior on fractions; raised to at least 1 when pseudo_min is 0. |
| `bayesprism.pseudo_min` | number | 1e-08 | min 0 | Floor added to reference profile probabilities in rows containing zeros. |
| `bayesprism.optimizer` | string | "MAP" | `MAP`, `MLE` | Optimiser for the reference update: MAP with log-normal prior, or MLE. |
| `bayesprism.sigma` | number | 2 | > 0 | Hyper-parameter of the MAP log-normal prior; ignored by MLE. |
| `bayesprism.maxit` | integer | 100000 | min 1 | Maximum optimiser iterations for the reference update. |
| `bayesprism.update_reference` | boolean | true | — | Update the reference and repeat sampling; profiles still come from the initial posterior. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 123 | — | Random seed for Gibbs draws; identical inputs and seed reproduce outputs. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing profiles. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Options apply to the `bayesprism` object only. `chain_length`, `burn_in` and `thinning` set $T$, and `burn_in` must be below `chain_length`. `report_min_fraction` affects reporting only. Negative values in either matrix indicate log-scale input and stop the call. Dropped labels are listed in `summary`.

## 7. MCP tool

Tool name `singlet_deconvolution_bulk_celltype_specific_expression` (definition in `tasks/mcp/singlet_deconvolution_bulk_celltype_specific_expression.json`). Example call:

```json
{
  "dataset": "bulk_cohort.singlet",
  "reference": {"dataset": "atlas_donors.singlet", "cell_type_key": "cell_type"},
  "method": "bayesprism",
  "seed": 123
}
```

Example result (illustrative values):

```json
{
  "dataset": "bulk_cohort.singlet",
  "status": "completed",
  "wrote": ["uns/bulk_cohort/theta_mean", "uns/bulk_cohort/theta_sd", "uns/bulk_cohort/expr/T_cell", "models/bulk_cohort"],
  "summary": {"method": "bayesprism", "n_samples": 12, "n_types": 8, "shared_genes": 9000, "retained_draws": 250, "reference_updated": true, "types_reported": 6, "dropped_labels": 0},
  "provenance_id": "prov_example"
}
```

Long-running: the call returns `queued` with a `job_id` when the dry-run estimate exceeds the inline limit (proposed: 10 minutes). Stochastic: yes, through `seed`. Dry run: returns `seconds`, `peak_memory_gb` and `device`, computed from $C$, $G$, $K$ and the sample count.

## 8. Benchmarks

Shared protocol. All accuracy benchmarks use raw linear-scale counts with no scaling, and the reference, gene set and seeds are identical across methods. Profile metrics compare log1p(CPM) over shared genes expressed in the reference for the type. A pair $(n,k)$ enters a metric when its true share $\beta_{nk}$ is at least 0.05 (proposed), and metrics are averaged uniformly over types. Profiles are scored from the initial posterior and fractions from the final one; the stage-two variant is scored separately. Three seeds, with the spread reported.

### B1. Donor-held-out planted simulation (proposed)

- **Goal**: recover per-sample, per-type profiles and fractions from simulated bulk built from cells of donors that are absent from the reference.
- **Ground truth**: planted simulation. The type and state labels are source annotations, never a method's output, so the benchmark is not circular. $\mu_{gkn}$ is defined in section 3.2, $\beta_{nk}$ is the realised UMI share, and $p_{nk}$ is the sampled cell fraction, used for fraction comparators only.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Donor-split singlet catalogue | singlet internal catalogue | scRNA-seq and snRNA-seq; 354M cells, about 40% with author annotations; species and held-out size fixed before scoring | internal (section 12) | Reference and held-out donors are disjoint; study-level holdout is a further arm |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Profile Pearson r | Pearson correlation of log1p(CPM) between $\hat\mu_{\cdot kn}$ and $\mu_{\cdot kn}$ over shared expressed genes; median over pairs | maximize | primary | — |
| Profile JSD | Jensen-Shannon distance, base 2 (range 0 to 1), between the two normalised profiles; mean over pairs | minimize | primary | — |
| Fraction R² | coefficient of determination of $\hat\theta_{nk}$ against $\beta_{nk}$ over samples, per type (sklearn r2_score convention), averaged over types with mean $\beta_k\ge0.05$ | maximize | primary | [R14] |
| 90% interval coverage | fraction of true $\beta_{nk}$ inside the 5th to 95th percentile interval of retained draws, reported as absolute deviation from 0.90 | minimize | guardrail | — |

- **Comparators**: BayesPrism at the section 4 defaults, with and without the stage-two update; a reference-profile control that returns $\phi_k$ unchanged for every sample (profile metrics only); MuSiC and bisque (fraction metrics only).
- **Protocol**: generator recipe:
  1. Split donors into reference donors and held-out donors, disjoint. Build the reference from reference donors only, dropping undefined and mixed labels.
  2. Draw cell fractions $p_n \sim \mathrm{Dirichlet}(\alpha_{\rm sim})$ over $K$ types, with $\alpha_{\rm sim}\in\{1, 0.3\}$ (proposed).
  3. For each mixture, draw $N=10^4$ held-out cells (proposed) with type counts $\mathrm{round}(Np_{nk})$, and sum their raw UMI counts into $x_{gn}$.
  4. Store $\mu_{gkn}$ (normalised sum of the drawn type-$k$ cells), $\beta_{nk}$ (realised UMI share) and $p_{nk}$.
  5. Stress arms: remove one type from the reference (missing-type test); perturb reference profiles per donor with multiplicative log-normal noise at three design scales (proposed); sweep $\alpha_{\rm sim}$ and sample count.
- **Acceptance criterion** (proposed design targets, not literature values): median profile Pearson r at least 0.80 for pairs with $\beta\ge0.05$; fraction R² at least 0.90 for types with $\beta\ge0.05$; 90% interval coverage within 0.05 of nominal; BayesPrism profile r above the reference-profile control. The stage-two update stays on by default only if it raises profile r.
- **Known pitfalls**: donor or cell overlap between reference and bulk inflates every metric. Planted simulations without ambient RNA, technical noise or gene-length bias overstate accuracy on real data.

### P1. Performance and scaling

Wall time and peak memory per call for BayesPrism on CPU, single-threaded and multi-threaded, and on CUDA. Grid (proposed): reference cells $10^4$, $10^5$, $10^6$ and $10^7$ (the last tests the streaming claim); bulk samples $10^2$, $10^3$ and $10^4$; $K=5$ and $20$; shared genes $10^4$ and $2\times10^4$. Hold fixed: gene set, $K$, $C$, $B$, $\tau$, seed, hardware and thread count. Since the cost is $O(CGK)$ per sample, the sweep should show linear scaling in samples and in $CGK$. Design target, not a literature value: under 10 minutes per 1,000 samples at $K=20$, $2\times10^4$ genes and $10^5$ reference cells.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `annotation.cross_dataset_label_reconciliation`: Cross-dataset cell-type label reconciliation
- **Feeds**:
  - `deconvolution-bulk.celltype_specific_de_bulk`: Cell-type-specific differential expression from bulk case-control data
  - `deconvolution-bulk.celltype_specific_eqtl_bulk`: Cell-type-specific eQTL from bulk cohorts using estimated cell fractions
- **Reads**: `bulk/layers/counts`, `reference/layers/counts`, `reference/obs/cell_type`, `reference/obs/cell_state`
- **Writes**: `uns/<name>/theta_mean`, `uns/<name>/theta_sd`, `uns/<name>/expr/<type>`, `models/<name>`
<!-- CHAINING:AUTO:END -->

Workflows: cell-type-specific analysis of bulk cohorts, feeding bulk differential expression and bulk eQTL analysis.

## 10. Risks, pitfalls and open questions

- **No accepted benchmark.** Per-sample, per-type expression has no accepted benchmark in the sources read. The sorted-population and tumour cell-state designs were dropped because no dataset with a stated truth was identified. The simulation benchmarks [R11, R12, R13] were not read in full, so their per-type findings are not reported.
- **Unread methods.** bMIND [R10] was identified from its title and abstract only, and no code was located. The CIBERSORTx high-resolution mode is web-only, and its paper was not read. SCDC's code was not read. None is in the tables or the enum. bMIND's cross-donor prior is the nearest model-based alternative and should be read first.
- **Licence status.** Licence status is unresolved (section 12) and gates the reimplementation route in section 5.
- **Stage-two posterior.** `get.exp` reads the initial posterior, so the profile and the final fraction come from different posteriors. Whether the reference update improves per-type profiles is untested here. Without state labels the reference is cell types, so the state option needs its own test.
- **Unsettled literature.** Whether profile accuracy tracks fraction accuracy, how to set prior strength through $\alpha$ and $\phi$, and whether posterior intervals are calibrated are all open. B1 measures each.
- **First experiment.** Reimplement the single-reference sampler at the section 4 defaults and check parity with BayesPrism on a small simulated mixture at the same seed. Then score B1 on a donor-held-out split. In parallel, source a donor-matched sorted-population dataset, which is needed for a further benchmark. The CUDA kernel is built only after parity holds.

## 11. References

R1. Newman AM, et al. Determining cell type abundance and expression from bulk tissues with digital cytometry. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0114-2 — verified (corpus)
R2. Shen-Orr SS, Gaujoux R. Computational deconvolution: extracting cell type-specific information from heterogeneous samples. *Current Opinion in Immunology* 2013. doi:10.1016/j.coi.2013.09.015 — verified (corpus)
R3. Avila Cobos F, Alquicira-Hernandez J, Powell JE, Mestdagh P, De Preter K. Benchmarking of cell type deconvolution pipelines for transcriptomics data. *Nature Communications* 2020. doi:10.1038/s41467-020-19015-1 — verified (corpus)
R4. Jin H, Liu Z. A benchmark for RNA-seq deconvolution analysis under dynamic testing environments. *Genome Biology* 2021. doi:10.1186/s13059-021-02290-6 — verified (corpus)
R5. Nadel BB, Oliva M, Shou BL, et al. Systematic evaluation of transcriptomics-based deconvolution methods and references using thousands of clinical samples. *Briefings in Bioinformatics* 2021. doi:10.1093/bib/bbab265 — verified (corpus)
R6. Chu T, et al.; Danko CG. Cell type and gene expression deconvolution with BayesPrism enables Bayesian integrative analysis across bulk and single-cell RNA sequencing in oncology. *Nature Cancer* 2022. doi:10.1038/s43018-022-00356-3 — verified (corpus)
R7. Chu T, et al.; Danko CG. Bayesian Inference of Cell Composition and Gene Expression Reveals Tumor-Microenvironment Interactions. *bioRxiv* (preprint) 2020. doi:10.1101/2020.01.07.897900 — verified (corpus)
R8. Wang X, Park J, Susztak K, Zhang NR, Li M. Bulk tissue cell type deconvolution with multi-subject single-cell expression reference. *Nature Communications* 2019. doi:10.1038/s41467-018-08023-x — verified (corpus)
R9. Jew B, Alvarez M, et al. Accurate estimation of cell composition in bulk expression through robust integration of single-cell information. *Nature Communications* 2020. doi:10.1038/s41467-020-15816-6 — verified (corpus)
R10. Wang J, Roeder K, Devlin B. Bayesian estimation of cell-type-specific gene expression per bulk sample with prior derived from single-cell data. *bioRxiv* (preprint) 2020. doi:10.1101/2020.08.05.238949 — verified (corpus)
R11. Tran KA, Addala V, Johnston RL, et al. Performance of tumour microenvironment deconvolution methods in breast cancer using single-cell simulated bulk mixtures. *Nature Communications* 2023. doi:10.1038/s41467-023-41385-5 — partial (repo)
R12. Hippen AA, Omran DK, Weber LM, et al. Performance of computational algorithms to deconvolve heterogeneous bulk ovarian tumor tissue depends on experimental factors. *Genome Biology* 2023. doi:10.1186/s13059-023-03077-7 — partial (repo)
R13. Hu M, Chikina M. Heterogeneous pseudobulk simulation enables realistic benchmarking of cell-type deconvolution methods. *Genome Biology* 2024. doi:10.1186/s13059-024-03292-w — partial (repo)
R14. Miles J. R-squared, adjusted R-squared. *Encyclopedia of Statistics in Behavioral Science* 2005. doi:10.1002/0470013192.bsa526 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/Danko-Lab/BayesPrism (sha 1905205) | Tinyi Chu (maintainer) and Charles G. Danko (author), per DESCRIPTION | GPL-2 or GPL-3 declared in DESCRIPTION; no LICENSE file at the root or in the package directory; scRNA-tools lists GPL-2.0-or-later for the superseded TED repository | sampler, reference update and defaults | reimplement (pending licence resolution) |
| https://github.com/xuranw/MuSiC (sha f21fe67) | Xuran Wang (author, maintainer) and Jiaxin Fan (author), per DESCRIPTION | GPL-3 (LICENSE file); DESCRIPTION states GPL (>= 3) | fraction comparator | callout |
| https://github.com/cozygene/bisque (sha 8640250) | Brandon Jew (author, maintainer) and Marcus Alvarez (author), per DESCRIPTION | GPL-3 (DESCRIPTION); no LICENSE file at the root | fraction comparator | callout |
| singlet catalogue | singlet | internal | benchmark source for B1 | not applicable |
