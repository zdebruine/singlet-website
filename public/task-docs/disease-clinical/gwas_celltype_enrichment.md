---
id: disease-clinical.gwas_celltype_enrichment
title: Trait-relevant cell-type mapping from GWAS and scRNA-seq
area: disease-clinical
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [annotation.cluster_label_assignment, harmonization.gene_identifier_mapping, markers-de.cluster_marker_ranking, disease-clinical.gwas_cell_level_scoring]
feeds: [genetics.eqtl_gwas_colocalization]
reads: [layers/counts, obs/cell_type, var/chromosome, var/start, var/end, uns/gwas/<trait>/sumstats, uns/ld_reference/<panel>]
writes: [uns/celltype_enrichment/<trait>/table, varm/celltype_sets/<name>]
devices: [cpu, cuda]
mcp_tool: singlet_disease_clinical_gwas_celltype_enrichment
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Trait-relevant cell-type mapping from GWAS and scRNA-seq

> Ranks the annotated cell types of a single-cell reference by how much GWAS heritability or polygenic signal their specific genes carry for each trait, reporting a calibrated per-cell-type statistic.

## 1. Question

For a given trait, which annotated cell types carry more GWAS heritability or polygenic signal than expected by chance? Inputs are per-trait summary statistics, a labelled scRNA-seq reference, an LD reference and a SNP-to-gene annotation. Output is, per trait and cell type, an enrichment statistic with its p-value and FDR, ranked as a trait-by-cell-type table. A correct answer is a calibrated test of no excess trait signal in a cell type's specific genes, conditional on a baseline model. Section 3 gives the estimand of each output.

## 2. Why this task matters and where the field stands

Trait-associated variants act through genes whose expression is cell-type specific, so asking which cell types a trait engages is a standard step after GWAS [R3]. The status is **contested**. Partitioned heritability on cell-type specifically expressed genes [R3, R1, R2] fits a regression with a confounding intercept. Gene-level and single-cell approaches summarise GWAS signal differently: EPIC models gene-level statistics with generalised least squares [R5], scPagwas regresses GWAS on pathway-transformed expression [R7], and scDRS scores cells against matched control gene sets [R4]. Because they summarise different quantities against different nulls, agreement between them is not evidence of accuracy.

Four problems remain open. First, confounding by gene size, gene density and LD that the baseline does not absorb can produce enrichment without biology [R3]. Second, cell types that share marker genes give correlated enrichments, so marginal tests over-call related types. Third, the choice of specificity signature (threshold, marker metric, binary or continuous) is a first-order decision, because it defines the input to every method. Fourth, no accepted truth set of trait and cell-type pairs exists, so benchmarks rely on proxies (section 8). Ancestry mismatch between the GWAS and the LD reference also biases the LD scores that every regression method uses [R1].

## 3. Theory and insight

Three families answer the question. Stratified LD score regression (LDSC-SEG, and sc-linker through S-LDSC) regresses GWAS chi-square statistics on stratified LD scores [R1, R2, R3]. The gene-level family (EPIC) first summarises SNP statistics to genes and then models their correlation [R5]. The matched-control family (scDRS) scores each cell and calibrates the score against control gene sets [R4]. The first two are model-based hypothesis tests; the third is hybrid, because its calibration is empirical.

The symbols are:

| Symbol | Meaning |
|---|---|
| $\chi^2_j$ | GWAS chi-square statistic of SNP $j$ |
| $\ell_j(c)$ | stratified LD score of SNP $j$ for annotation $c$ |
| $\tau_c$ | per-SNP heritability of annotation $c$, conditional on the baseline |
| $N$, $a$ | GWAS sample size; confounding intercept |
| $M$, $M_c$ | SNPs in the genome; SNPs in annotation $c$ |

The LDSC expectation for SNP $j$ is

$$\mathbb{E}[\chi^2_j] = 1 + N\sum_c \tau_c\,\ell_j(c) + N a \tag{1}$$

It holds to first order in $\tau_c$ (small per-SNP effects), for large $N$, under a polygenic architecture, and with LD scores estimated on a reference that matches the GWAS population. The coefficients $\tau_c$ are estimated by weighted regression, with block-jackknife standard errors.

The enrichment of annotation $c$ is

$$\mathrm{Enrichment}_c = \frac{h^2_c/h^2_g}{M_c/M} = \frac{M\,\tau_c}{h^2_g}, \qquad h^2_c = M_c\,\tau_c \tag{2}$$

where $h^2_g$ is total SNP heritability. It is valid when $\tau_c$ is well determined and conditional on the baseline annotations of the model. A value of 1 means the annotation carries heritability in proportion to its size.

For scDRS, each cell $i$ receives a weighted average of the trait gene set,

$$s_i = \frac{\sum_{g} w_g\,x_{ig}}{\sum_{g} w_g}$$

with weights set by technical variance (defaults in section 4). The score is then standardised against the $n_{\rm ctrl}$ matched control sets, giving $\tilde s_i$, and centred over cells. Control sets matched on mean and variance estimate the background mean and variance of each cell's score. The Monte Carlo p-value of a cell is

$$p_i = \frac{1 + \sum_{k=1}^{n_{\rm ctrl}} \mathbf{1}\big[\tilde s^{(k)}_i \ge \tilde s_i\big]}{1 + n_{\rm ctrl}}$$

which cannot fall below $1/(n_{\rm ctrl}+1)$; with 1000 controls the floor is about 0.001. The per-type statistic uses the 95th percentile of standardised cell scores within type $c$:

$$q_c = Q_{0.95}\{\tilde s_i : i \in c\}, \qquad p_c = \frac{1 + \sum_{k} \mathbf{1}\big[q^{(k)}_c \ge q_c\big]}{1 + n_{\rm ctrl}}, \qquad z_c = \frac{q_c - \overline{q^{(\cdot)}_c}}{\mathrm{sd}\big(q^{(\cdot)}_c\big)}$$

where $q^{(k)}_c$ is the same statistic on control set $k$. This is valid when the controls are exchangeable with the disease set. It treats cells as independent, although donors cluster cells.

Each output has one estimand:

- **LDSC-SEG enrichment**: $\mathrm{Enrichment}_c$ in equation (2), a ratio where 1 means no enrichment, conditional on the baseline; its $p$-value tests $\tau_c = 0$ with a block-jackknife standard error.
- **scDRS per-type statistic**: $z_c$ and $p_c$ measure the upper-tail level of standardised cell scores in type $c$ relative to the same statistic for matched controls. They are not mean enrichments.
- **FDR (both methods)**: Benjamini-Hochberg across cell types within each trait, applied to that method's $p$-values.
- **Planted truth (B1)**: $M\tau_c/h^2_g$ computed from the planted coefficients on the simulated annotation partition, exact by construction.
- **Null truth (B2)**: the indicator that a test has no true cell-type signal.

Assumptions and failure modes by family. The regression family assumes a polygenic architecture, a baseline that absorbs confounding and an LD reference matched to the GWAS. It fails under gene-size or density confounding, under small $N$ or low polygenicity (non-significance is then uninformative), and under a mismatched LD panel. The gene-level family assumes that gene statistics summarise cis SNPs adequately and that gene-gene correlation is modelled; its failure modes are not benchmarked here (section 10). The matched-control family assumes that mean- and variance-matched controls are a valid null. The scDRS FAQ gives more than 50 genes and under 20% of all genes as an example of a moderate size, and reports reasonable performance from 10 genes (section 4). Batch effects shift control and disease scores differently, and cell-level p-values ignore donor clustering. All families share two failure modes: correlated signatures inflate related types unless conditioned, and a wrong label or a signature that varies across donors propagates into every output.

Why a model adds value over a heuristic. A model-based output carries a fitted coefficient, a standard error and an explicit null, so it can be reused across traits, combined with other evidence and checked against planted truth. The LDSC intercept separates confounding from polygenicity [R1]. Marker-overlap heuristics give a ranking without a null for the overlap. scDRS, the hybrid method, is the calibrated heuristic standard and stays as a comparator. Pitfalls reported by benchmark studies are not used as established facts here (section 10).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| LDSC-SEG | model-based | Stratified LD score regression on cell-type specifically expressed gene annotations, conditional on a baseline | [R3, R1, R2] |
| sc-linker | model-based | SNP-to-gene linking of single-cell gene programs, then S-LDSC tests of each program | [R6] |
| EPIC | model-based | Gene-level tests for common and rare variants, with generalised least squares for within- and between-gene correlation | [R5] |
| scPagwas | model-based | Polygenic regression of GWAS on pathway-activity-transformed scRNA-seq | [R7] |
| scDRS per-type aggregation | hybrid | Matched-control calibrated cell scores, summarised per type by the 95th percentile | [R4] |

The published standards are LDSC-SEG for partitioned heritability and scDRS for calibrated cell scores. LDSC-SEG and scDRS are the two methods whose code was examined to the level of defaults, and they are the proposed implementations. EPIC, sc-linker and scPagwas are described from repository documentation and serve as comparators. Gene-level MAGMA analysis and the other methods named in the catalogue are not tabulated (section 10).

Parameter values of the tabulated methods, with their sources:

| Method | Parameter | Value | Source |
|---|---|---|---|
| LDSC-SEG | --h2-cts inputs | requires --ref-ld-chr, --w-ld and --ref-ld-chr-cts | bulik/ldsc ldsc.py:494-496 (help text) @ 2fdeeb3 |
| LDSC-SEG | SEG annotation window | 100 kb | EPIC script setting (`--windowsize`): rujinwang/EPIC scripts/LDSC-SEG/s2_LDSC_anno.sh:28 @ b45c418 |
| LDSC-SEG | LD-score window | 1 cM | EPIC script setting (`--ld-wind-cm 1`): rujinwang/EPIC scripts/LDSC-SEG/s3_LDSC_ldscore.sh:24 @ b45c418; ldsc.py has no default and requires one `--ld-wind` option (ldsc.py:280-282) |
| scDRS | n_ctrl | 1000 | martinjzhang/scDRS scdrs/method.py:17 @ 644a5c7 |
| scDRS | ctrl_match_key | mean_var | scdrs/method.py:16 @ 644a5c7 |
| scDRS | n_genebin | 200 | scdrs/method.py:18 @ 644a5c7 |
| scDRS | weight_opt | vs | scdrs/method.py:19 @ 644a5c7 |
| scDRS | vs weight | inverse root of technical variance plus 0.01, normalised to sum 1 | scdrs/method.py:378, 384 @ 644a5c7 |
| scDRS | cell-wise standardisation | against control scores, then centred over cells | scdrs/method.py:556, 573 @ 644a5c7 |
| scDRS | Monte Carlo p-value | (1 + count of controls at or above observed) / (1 + n_ctrl) | scdrs/method.py:214 @ 644a5c7 |
| scDRS | per-type statistic | 0.95 quantile; p and z against controls | scdrs/method.py:809-814 @ 644a5c7 |
| scDRS | gene-set size guidance | example of a moderate size: more than 50 genes and under 20% of genes; reasonable performance from 10 genes | docs/faq.rst:54 @ 644a5c7 |

## 5. Proposed singlet approach

**Routes.** The scDRS per-type aggregation is ported, since the aggregation is short and its terms allow porting (section 12). LDSC-SEG is reimplemented from the published equations, and no code is copied (section 12). EPIC, sc-linker and scPagwas are callouts: benchmark comparators only.

**Proposed model.** For each trait, the enrichment is the coefficient of a weighted least-squares regression of chi-square statistics on stratified LD scores, conditional on the baseline, with block-jackknife standard errors. On B1 it is falsified if null false-positive rates leave the 0.03 to 0.07 band or if the jackknife standard error does not match the replicate spread. On B2 the same band applies to both methods. A hierarchical prior that shrinks $\tau_c$ across traits is a proposed extension, not a default. It is accepted only if a multi-trait variant of B1 shows lower error without raising B2 false positives.

**ML stack.** The default needs weighted and generalised least squares and sparse matrix products, so no deep-learning framework is required. Hard-coded CUDA covers batched weighted regression across traits and sparse weighted scoring over $n_{\rm ctrl}+1$ gene sets (cuSPARSE). PyTorch is reserved for a learned component that a benchmark shows to be necessary; none of the methods examined uses one.

**Kernels and devices.** Annotation build (window overlap), stratified LD-score sums, batched weighted regression with block jackknife, sparse weighted scoring with control draws, per-type quantiles and Benjamini-Hochberg. The CPU path is the reference. CUDA accelerates regression and scoring. For scDRS, cells are scored in chunks, and per-type 95th percentiles are computed from stored cell scores (one value per cell).

**Defaults an agent should use without asking.** Method `ldsc_seg`; annotation window 100 kb and LD window 1 cM (EPIC script settings); for `scdrs`, n_ctrl 1000, mean_var, n_genebin 200 and vs; minimum gene set size 50 (proposed); Benjamini-Hochberg within trait.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts; scDRS technical variance is computed from them |
| read | obs/cell_type | categorical | cell-type labels (the key is set by `cell_type_key`) |
| read | var/chromosome, var/start, var/end | string, int, int | gene coordinates for window annotation |
| read | uns/gwas/<trait>/sumstats | table | SNP, A1, A2, BETA or Z, SE or P, N |
| read | uns/ld_reference/<panel> | table or PLINK set | LD scores or genotypes for the matched population |
| write | uns/celltype_enrichment/<trait>/table | table | cell_type, enrichment, se, p, fdr, method |
| write | varm/celltype_sets/<name> | sparse bool | gene by cell-type membership used for annotations |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `traits` | array | required | — | GWAS summary-statistic handles, one per trait, such as uns/gwas/<trait>/sumstats. |
| `method` | string | "ldsc_seg" | `ldsc_seg`, `scdrs` | ldsc_seg: stratified LD score regression (default). scdrs: per-cell-type aggregation of matched-control disease scores. |
| `cell_type_key` | string | "cell_type" | — | obs column with cell-type labels used to build annotations and group cells. |
| `ld_reference` | string | — | — | LD reference panel handle, such as uns/ld_reference/<panel>; its population must match the GWAS. |
| `ldsc_seg` | object | — | — | Options for stratified LD score regression; ignored when method is scdrs. |
| `ldsc_seg.annotation_window_kb` | number | 100 | min 0 | Cis window added around each specifically expressed gene when building annotations. |
| `ldsc_seg.ld_window_cm` | number | 1 | min 0 | LD-score window in centimorgans. |
| `scdrs` | object | — | — | Options for matched-control scoring; ignored when method is ldsc_seg. |
| `scdrs.n_ctrl` | integer | 1000 | min 1 | Matched control gene sets per trait; sets the smallest resolvable Monte Carlo p-value. |
| `scdrs.ctrl_match_key` | string | "mean_var" | `mean_var` | Gene statistic for matching controls; mean_var matches on mean and variance. |
| `scdrs.n_genebin` | integer | 200 | min 1 | Number of bins for matching when the matching statistic is continuous. |
| `scdrs.weight_opt` | string | "vs" | `uniform`, `vs`, `inv_std`, `od` | Gene weighting for the raw score; vs weights by inverse root technical variance. |
| `calibration` | object | — | — | Statistics options shared by both methods. |
| `calibration.min_gene_set_size` | integer | 50 | min 10 | Smallest cell-type gene set kept; scDRS documentation reports reasonable behaviour from 10 genes. |
| `calibration.fdr_method` | string | "bh" | `bh` | Multiple-testing adjustment across cell types within each trait. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for scDRS control draws; ignored by ldsc_seg. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Option groups follow the method. `ldsc_seg.*` applies only when `method` is `ldsc_seg`, and `scdrs.*` only when it is `scdrs`; `calibration.*` applies to both. The cost of `scdrs` grows linearly with `n_ctrl`, and `n_ctrl` also sets the smallest resolvable Monte Carlo p-value, so the two cannot be tuned separately. `seed` affects only control draws, since `ldsc_seg` is deterministic given its inputs. Each trait needs at least two cell types that meet `min_gene_set_size`. An LD reference whose declared population differs from the GWAS population is refused.

## 7. MCP tool

Tool name `singlet_disease_clinical_gwas_celltype_enrichment` (definition in `tasks/mcp/singlet_disease_clinical_gwas_celltype_enrichment.json`). Example call and result:

```json
{"dataset": "atlas.singlet", "traits": ["uns/gwas/trait_a/sumstats"], "ld_reference": "uns/ld_reference/eur_panel", "method": "ldsc_seg", "dry_run": true}
```

```json
{
  "dataset": "atlas.singlet",
  "status": "dry_run",
  "wrote": [],
  "estimate": {"seconds": "<float>", "peak_memory_gb": "<float>", "device": "cpu"}
}
```

Long-running: a single trait with `ldsc_seg` completes inline; many traits, or `scdrs` on very large references, return `queued` with a job id. Stochastic: only the `scdrs` control draws, fixed by `seed`. Dry-run mode: returns estimated seconds, peak memory and device, and writes no members.

## 8. Benchmarks

Shared protocol. Every accuracy benchmark uses the same LD reference (1000 Genomes Phase 3 European genotypes, as laid out in the EPIC scripts), the 100 kb annotation window, scDRS settings n_ctrl 1000, mean_var matching and vs weighting, and Benjamini-Hochberg within trait. Scenarios, seeds and replicate counts are written to a manifest before any method is applied, and the manifest is stored with the results. Thresholds marked proposed are design targets, not published values.

### B1. Planted-signal simulation under the LDSC model (proposed)

- **Goal**: LDSC-SEG false-positive rate on null cell types, power on a planted type, and standard-error calibration.
- **Ground truth**: planted simulation. $\tau_c$ is zero for null types and one fixed value for the planted type. The true enrichment $M\tau_c/h^2_g$ is computed exactly from the planted coefficients.
- **Generator recipe**:
  1. Per reference cell type, the top 10% of expressed genes by specificity (proposed), each with a 100 kb window, form one annotation.
  2. Compute $\ell_j(c)$ on the European reference, with baseline annotations at manifest-fixed coefficients.
  3. Fix the planted type and its $\tau$ in the manifest.
  4. Draw $z \sim \mathcal{N}(\mu, R)$ per LD block, with $\mu_j = \sqrt{N\sum_c \tau_c \ell_j(c)}$, $R$ the block LD correlation and $a = 0$.
  5. Draw at least 1000 replicates per scenario; $N$ and seeds are fixed in the manifest.

| Dataset | Source | Modality, species, size | License |
|---|---|---|---|
| 1000 Genomes Phase 3 European reference | EPIC scripts (section 12) | human genotypes, European | — |
| Reference scRNA-seq with author labels | singlet catalogue | human; about 40% of 354M cells annotated | — |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| False-positive rate | null tests with p below 0.05 (Wald, block-jackknife SE) | lower; near 0.05 | guardrail | [R1] |
| Power | planted-type tests with p below 0.05 | higher | primary | [R1] |
| SE ratio | mean jackknife SE over SD of estimates across replicates | near 1 | guardrail | [R1] |

- **Comparators**: LDSC-SEG reimplementation against `ldsc.py --h2-cts` on identical inputs.
- **Protocol**: shared protocol; one planted type per scenario.
- **Acceptance criterion**: null false-positive rate within 0.03 to 0.07 at alpha 0.05; SE ratio within 0.9 to 1.1; parity with `ldsc.py` within a manifest tolerance; planted power with a binomial 95% CI. All thresholds are proposed.
- **Known pitfalls**: (i) the simulator is the LDSC model, so it cannot reveal misspecified LD scores or real confounding; (ii) overlapping annotations make marginal tests of neighbours non-null, so only joint estimates count.

### B2. Matched random gene-set null (proposed)

- **Goal**: false-positive rate of per-cell-type calls when a gene set has no relation to the trait, for both methods.
- **Ground truth**: null by construction; the estimand per test is the rejection indicator at level $\alpha$.
- **Generator recipe**:
  1. Take the labelled reference and signature sizes $n_c$ from B1 step 1.
  2. For LDSC-SEG, draw per type a random gene set of size $n_c$, matched on mean and variance bins, and build its annotation with the same window.
  3. For scDRS, draw a random trait gene set of the manifest size (at least the minimum gene set size), matched on mean and variance, and score the reference cells.
  4. Draw at least 1000 sets per method; no planted signal.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Reference scRNA-seq with true labels | singlet catalogue | human; about 40% of 354M cells annotated | — | truth labels |
| 1000 Genomes Phase 3 European reference | EPIC scripts (section 12) | human genotypes, European | — | LD scores |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| FPR at alpha 0.05 | null tests with p below 0.05 | lower; near 0.05 | guardrail | — |
| FPR at alpha 0.01 | null tests with p below 0.01 | lower; near 0.01 | guardrail | — |

- **Comparators**: LDSC-SEG and scDRS per-type aggregation.
- **Protocol**: shared protocol; true labels; CPU.
- **Acceptance criterion**: for each method, FPR at 0.05 within 0.03 to 0.07 and FPR at 0.01 within 0.005 to 0.015. Both bands are proposed.
- **Known pitfalls**: (i) mean and variance matching does not match gene size or density, which LDSC relies on the baseline to absorb, so size-matched sets are reported separately; (ii) cell types share cells, so tests are correlated and intervals use replicates as the unit.

### P1. Performance and scaling

Measure wall time, peak memory and throughput in cells per second for LDSC-SEG and scDRS at 10k, 100k and 1M cells, and at 10M cells if the streaming claim is kept, on CPU and CUDA. Comparators are `ldsc.py --h2-cts`, scDRS at its default n_ctrl, and EPIC and sc-linker as documented pipelines. Hold fixed the GWAS, the LD reference, the 100 kb window, n_ctrl 1000, mean_var, vs and the seed. Report log-log scaling exponents with confidence intervals. No timing claim is made before these measurements exist.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `disease-clinical.gwas_cell_level_scoring`: Single-cell disease-relevance scoring from GWAS
- **Feeds**:
  - `genetics.eqtl_gwas_colocalization`: Colocalization of cell-type eQTL with GWAS loci
- **Reads**: `layers/counts`, `obs/cell_type`, `var/chromosome`, `var/start`, `var/end`, `uns/gwas/<trait>/sumstats`, `uns/ld_reference/<panel>`
- **Writes**: `uns/celltype_enrichment/<trait>/table`, `varm/celltype_sets/<name>`
<!-- CHAINING:AUTO:END -->

This task belongs to the GWAS-to-cell-type mapping workflow. It starts from labels and specificity sets and ends at locus-level colocalisation with cell-type eQTLs.

## 10. Risks, pitfalls and open questions

- **Benchmark literature not adopted.** The thresholds in section 8 are design targets, not values taken from published benchmarks. No published cross-method comparison of GWAS-to-cell-type mapping is relied on here.
- **No truth set.** No accepted labelled set of trait and cell-type pairs exists. The expert-lineage pairs in the catalogue (immune types for autoimmune traits, neuronal types for psychiatric traits) have no cited source. First experiment: fix the trait list, the pairs and their citations in a manifest; then compute the top-3 hit rate with a binomial CI against the proposed threshold of 0.8, separately from the calibration gate of B1 and B2.
- **Methods not tabulated.** Gene-level MAGMA analysis is named in the catalogue, but neither its paper nor its software was examined; the EPIC MAGMA scripts do not substitute for it. scGWAS [R8] is cited from its reference record only, so its model is not described. seismic and CELLECT are not referenced here.
- **Code depth and access.** EPIC's R package code was not examined (only its README, package description and LDSC-SEG and MAGMA scripts [R5]). The sc-linker pipeline code was not examined beyond its README (section 12). The scPagwas repository cites the paper as "Ma et al.", so its full author list is not stated [R7].
- **Real-data calibration.** Calibration on real traits is not shown. B1 and B2 omit real polygenicity, LD-reference mismatch and population stratification. Ancestry-matched calibration on real GWAS needs its own experiment and reference population.
- **Dependence and reporting.** Enrichments are correlated across traits and across cell types, and no cross-trait FDR standard appears in the cited sources. singlet reports Benjamini-Hochberg within trait and treats cross-trait q-values as an open choice. The LDSC 2015, Finucane 2015 and Finucane 2018 statements [R1-R3] rest on citation records, not full texts.

## 11. References

R1. Bulik-Sullivan B, et al. LD Score regression distinguishes confounding from polygenicity in genome-wide association studies. *Nature Genetics* 2015. doi:10.1038/ng.3211 — verified (repo)
R2. Finucane HK, et al. Partitioning heritability by functional annotation using genome-wide association summary statistics. *Nature Genetics* 2015. doi:10.1038/ng.3404 — verified (repo)
R3. Finucane HK, et al. Heritability enrichment of specifically expressed genes identifies disease-relevant tissues and cell types. *Nature Genetics* 2018;50:621-629. doi:10.1038/s41588-018-0081-4 — verified (search)
R4. Zhang MJ, Hou K, et al. Polygenic enrichment distinguishes disease associations of individual cells in single-cell RNA-seq data. *Nature Genetics* 2022. doi:10.1038/s41588-022-01167-z — verified (corpus)
R5. Wang R, Lin D, Jiang Y. EPIC: Inferring relevant cell types for complex traits by integrating genome-wide association studies and single-cell RNA sequencing. *PLoS Genetics* 2022. doi:10.1371/journal.pgen.1010251 — verified (corpus)
R6. Jagadeesh KA, Dey KK, et al. Identifying disease-critical cell types and cellular processes by integrating single-cell RNA-sequencing and human genetics. *Nature Genetics* 2022;54(10):1479-1492. doi:10.1038/s41588-022-01187-9 — verified (search)
R7. Ma, et al. Polygenic regression uncovers trait-relevant cellular contexts through pathway activation transformation of single-cell RNA sequencing data. *Cell Genomics* 2023. doi:10.1016/j.xgen.2023.100383 — verified (corpus)
R8. scGWAS: landscape of trait-cell type associations by integrating single-cell transcriptomics-wide and genome-wide association studies. *Genome Biology* 2022. doi:10.1186/s13059-022-02785-w — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/bulik/ldsc | Brendan Bulik-Sullivan and Hilary Finucane (setup.py) | GPL-3.0 (LICENSE file; setup.py states GPLv3) | LDSC-SEG reference implementation | reimplement |
| https://github.com/martinjzhang/scDRS | Martin Jinye Zhang, Kangcheng Hou (setup.py) | MIT (LICENSE, copyright 2021) | matched-control scoring and per-type aggregation | port |
| https://github.com/rujinwang/EPIC | Rujin Wang, Danyu Lin, Yuchao Jiang (DESCRIPTION Author field) | GPL-2 (package DESCRIPTION; no LICENSE file at the root) | EPIC comparator; LDSC-SEG and MAGMA scripts | callout |
| https://github.com/dengchunyu/scPagwas | Authors field empty; cited as Ma et al. | MIT with file LICENSE (DESCRIPTION) | scPagwas comparator | callout |
| https://github.com/kkdey/GSSG | Repository owner kkdey; sc-linker authors as in [R6] | no LICENSE file at the repository root | sc-linker comparator | callout |
