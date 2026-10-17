---
id: ingest-quant.intron_inclusive_gene_counting
title: Intron-inclusive (gene versus gene-full) counting and pre-mRNA references for nuclei
area: ingest-quant
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.reference_annotation_build, ingest-quant.read_to_gene_mapping]
feeds: [cell-calling.nucleus_vs_empty_calling, qc.single_nucleus_quality_filtering, normalization.size_factor_estimation]
reads: [uns/ingest_geometry, uns/ref_build, var/gene_id]
writes: [layers/exonic, layers/intronic, layers/ambiguous, X, obs/n_counts_exonic, obs/n_counts_intronic, obs/nuclear_fraction, obs/n_genes_detected, obs/usable_read_fraction, uns/intron_counting, models/rho_hierarchical]
devices: [cpu, cuda]
mcp_tool: singlet_ingest_quant_intron_inclusive_gene_counting
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Intron-inclusive (gene versus gene-full) counting and pre-mRNA references for nuclei

> Decide whether intronic (pre-mRNA) reads and UMIs are added to gene totals, and how the counting feature and reference are set, so that each reported total is known to estimate mature mRNA, mature plus pre-mRNA signal, or nuclear identity.

## 1. Question

Should reads and UMIs that map to introns be added to gene counts for single-nucleus and whole-cell libraries, and which feature and reference should produce the totals? Inputs are raw or tagged reads, a genome with annotation, and a reference that includes intron sequence. Outputs are exonic, intronic and total gene matrices, a per-barcode nuclear fraction, and detection summaries. The exon-only total estimates mature mRNA and the intron-inclusive total estimates mature plus pre-mRNA signal, so a correct answer names its estimand (section 3). The literature gives no shared gold standard for choosing between them (section 2).

## 2. Why this task matters and where the field stands

Single-nucleus workflows face this choice, because a spliced-only reference cannot place intronic reads, and the reference and feature together decide what the matrix contains [R1]. The best-practices chapter calls alevin-fry an attractive option for single-nucleus data and summarises Brüning et al. as finding STARsolo faster and lighter in memory than Cell Ranger, with almost identical results [R1, R2]. The 10x technote treats intronic and antisense reads as an interpretation problem in their own right [R3]. Pool et al. describe recovering reads missing from gene expression [R4]. ABACUS is a UMI counter that uses intronic reads for single-nucleus data [R5]. Pre-mRNA counting carries length biases [R6], and preprocessing choices change RNA velocity results [R7]. Comparisons of single-cell and single-nucleus methods [R8] and of matched cortical cell types [R9] frame the nucleus-versus-cell question.

Status: **contested**. The open problems are:

1. Whether intronic reads belong in the headline gene matrix at all. The chapter calls the best use of intronic information an open question [R1].
2. Whether inclusion helps cell-type analysis or only detection. The titles of these preprints concern recovered and intronic reads [R4, R5], and genes per barcode cannot fall when reads are added (section 3), so detection gains alone do not show a benefit for cell-type analysis.
3. Whether pre-mRNA to mature ratios differ between cell types, which sets how far inclusion moves fold changes (section 3).
4. How intronic reads resolve against overlapping genes and antisense transcription. STARsolo's overlap variants answer this in source but not in its documentation (section 10).

## 3. Theory and insight

Let $y^{E}_{gc}$ and $y^{I}_{gc}$ be the exonic and intron-only UMI counts of gene $g$ in barcode $c$, whose cell type is $k(c)$.

| Symbol | Meaning |
|---|---|
| $s_c$ | size factor of barcode $c$, capturing depth and efficiency |
| $\theta_{gk}$ | mature mRNA rate of gene $g$ in type $k$, per unit size factor |
| $\rho^{\mathrm{mol}}_{gk}$ | molecular ratio of pre-mRNA to mature mRNA |
| $\kappa$ | capture efficiency of intronic relative to exonic molecules |
| $\rho_{gk}$ | effective ratio $\mathbb{E}[y^{I}]/\mathbb{E}[y^{E}]=\kappa\,\rho^{\mathrm{mol}}_{gk}$ |
| $I_c$, $E_c$ | barcode totals of intronic and exonic UMIs |

The nuclear fraction of a barcode is

$$\mathrm{NF}_c=\frac{I_c}{I_c+E_c},\qquad I_c=\sum_g y^{I}_{gc},\quad E_c=\sum_g y^{E}_{gc}\tag{1}$$

Regime: per barcode, and valid when each read is classified by one fixed rule. DropletQC defines it on reads [R10]. This task uses reads when read-level tags exist and UMIs otherwise, and records the basis.

Intron inclusion is additive only within a partition:

$$y^{\mathrm{GF}}_{gc}=y^{E}_{gc}+y^{I}_{gc}\tag{2}$$

where $y^{\mathrm{GF}}$ counts molecules overlapping the gene and $y^{I}$ counts intron-only molecules. This is exact when no molecule is both exonic and intron-only, and overlap rules decide the rest.

The working model below is our own formulation, not taken from a cited source:

$$y^{E}_{gc}\sim\mathrm{Poisson}(s_c\,\theta_{gk}),\qquad y^{I}_{gc}\sim\mathrm{Poisson}(s_c\,\rho_{gk}\,\theta_{gk})\tag{3}$$

Regime: large-sample means. Poisson ignores over-dispersion, which a negative binomial captures. From (2) and (3):

$$\mathbb{E}[y^{\mathrm{GF}}_{gc}]=(1+\rho_{gk})\,s_c\,\theta_{gk}\tag{4}$$

Regime: first order, within one type, for expectations. It does not hold for a single realisation. For two groups A and B, the inclusive fold change divided by the exonic fold change is

$$\frac{\mathrm{FC}^{\mathrm{GF}}_{AB}}{\mathrm{FC}^{E}_{AB}}=\frac{1+\rho_{gA}}{1+\rho_{gB}}\tag{5}$$

When $\rho\gg1$ in both groups, $\mathrm{FC}^{\mathrm{GF}}_{AB}\approx\mathrm{FC}^{I}_{AB}$, the intronic fold change, so the inclusive value stops reflecting the mature ratio. The factor is 1 when the two groups have equal ratios, including both at zero. Under capture asymmetry, $\rho_{gk}=\kappa\,\rho^{\mathrm{mol}}_{gk}$ and (4) holds unchanged. Regime: $\kappa$ constant across barcodes of a type.

Estimands, one sentence each:

- *X under the exon feature*: the mature rate $\theta_{gk}$ per unit size factor, as integer UMIs after the engine's collapse rule, not normalised.
- *X under a gene-full feature*: $(1+\rho_{gk})\theta_{gk}$ per unit size factor, where $\rho$ is the effective ratio, so the total estimates mature plus intronic signal rather than molecule production unless $\kappa=1$.
- *Intronic and ambiguous layers*: intron-only and ambiguous UMIs per barcode and gene, integer and not normalised; the intron-only class is the nascent, U or derived GeneFull-minus-Gene count, per method.
- *Nuclear fraction*: $\mathrm{NF}_c$ from equation (1), a barcode-level share with no size-factor scaling.
- *Simulation truth (B2)*: the expected count the simulator generates for each class, summed; exact by construction on noise-free means.
- *Pseudobulk metric (B1)*: the mean over barcodes within a type and modality of $\log\!\left(1+10^{4}\,y_{gc}/\sum_{g'}y_{g'c}\right)$.

Insight. The data identify the effective ratio, not the molecular ratio. Separating $\kappa$ needs outside information, such as a length model or a controlled spike-in, so equal capture ($\kappa=1$) is a regime assumption and every reported ratio is labelled effective. Inclusion changes the estimand from mature abundance to mature plus intronic signal, so exon-only counts are not correct by default and inclusion is not better by default; the answer depends on whether the question concerns mature mRNA, nascent production or cell identity. Adding reads cannot lower the number of genes detected per barcode, so detection gains cannot by themselves justify inclusion. Under a union definition, intron-only molecules are those whose reads do not overlap an exon. The GeneFull_ExonOverIntron variant gives exonic priority to reads that also overlap a gene's exons, and GeneFull_Ex50pAS does not count antisense overlaps (alexdobin/STAR, source/Transcriptome_alignExonOverlap.cpp). Heuristic counters fix the intronic class by a rule. A model estimates $\rho$ per gene and type, shrinks it across types and reports uncertainty; that is the addition singlet proposes (section 5).

Pitfalls: divergent UMI collisions occur mainly among intronic sequences, and handling them is an open research area [R1, R3, R6]; pre-mRNA length bias affects unspliced counts [R6]; and cell-type-specific ratios change fold changes through equation (5).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| STARsolo `Gene`, `GeneFull`, `GeneFull_ExonOverIntron`, `GeneFull_Ex50pAS` | heuristic | genome alignment; GeneFull counts reads overlapping a gene's exons or introns; the two overlap variants give exonic overlaps priority | [R11] |
| kb-python `nac` workflow | heuristic | pseudoalignment to cDNA plus flanked intron sequence; returns nascent, mature and ambiguous matrices | [R12, R13] |
| alevin-fry USA mode | heuristic | lightweight mapping to spliced plus unspliced sequence; UMI resolution per splicing state (S, U, A); total is U+S+A | [R14] |
| Cell Ranger pre-mRNA reference | heuristic | STAR-based genome alignment, so intronic reads are placed through a genome-wide index; the intron-inclusive option is not documented in the repository (section 10) | [R1, R3] |
| DropletQC nuclear fraction | heuristic (diagnostic) | per-barcode intronic over intronic plus exonic reads; low values with low UMI counts flag empty droplets, high values with low UMI counts flag damaged cells | [R10] |

Exon-only counting is STARsolo's default feature (table below) and the reference point for the comparisons in section 8. For nuclei the chapter calls alevin-fry an attractive option [R1], and kb-python's nac index is the route that returns nascent, mature and ambiguous matrices directly [R12, R13]. Pool et al. and ABACUS are left out of the table because their method descriptions are not checked here (section 10). DropletQC is a diagnostic, not a counter.

Defaults taken from source and documentation:

| Method | Parameter | Value | Source |
|---|---|---|---|
| STARsolo | `soloFeatures` | `Gene` | docs/STARsolo.md:419 @ b1edc12 |
| STARsolo | `soloCBmatchWLtype` | `1MM_multi` | docs/STARsolo.md:393 @ b1edc12 |
| STARsolo | `soloUMIdedup` | `1MM_All` | docs/STARsolo.md:425 @ b1edc12 |
| STARsolo | `soloCellFilter` | `CellRanger2.2 3000 0.99 10` | docs/STARsolo.md:445 @ b1edc12 |
| STARsolo | `GeneFull_ExonOverIntron`, `GeneFull_Ex50pAS` | option, absent from the docs | CHANGES.md:39; source/SoloFeature.cpp:16-17 @ b1edc12 |
| kb-python | `workflow` for `kb ref` | `standard` | kb_python/main.py:1112 @ 188d9c7 |
| kb-python nac | `nascent` | `True` | kb_python/ref.py:855 @ 188d9c7 |
| kb-python nac | intron flank | k − 1 when k is set, otherwise 30 | kb_python/ref.py:983-984 @ 188d9c7 |
| alevin-fry USA | resolution | `cr-like` or `cr-like-em` only | docs/source/quant.rst:12 @ ad05742 |
| alevin-fry USA | output | C × 3G: spliced, unspliced and ambiguous per gene | docs/source/quant.rst:51 @ ad05742 |
| alevin-fry | `trivial` strategy | unavailable in USA mode | docs/source/quant.rst:26 @ ad05742 |
| DropletQC | nuclear fraction | intronic over intronic plus exonic reads | README.md:12 @ 5d7dadc |

## 5. Proposed singlet approach

**Routes.** Port the STARsolo feature and overlap rules, the kb-python nac intron-flank and nascent partition, and the alevin-fry `cr-like` resolution into singlet's C++ core; each source is permissively licensed (section 12). Cell Ranger is a callout used as a comparator only. DropletQC is a diagnostic, not a counter, so it is not ported. The ported sources are permissively licensed, so nothing is reimplemented from description; every other source is a callout. Nuclear-fraction thresholds belong to the single-nucleus QC task, not this one.

**Heuristic default.** The default method is `alevin_fry_usa` on the splici reference from the build step, the route the chapter describes as attractive for single-nucleus data [R1]. The default `feature` is `auto`: exon for whole cells and gene-full for nuclei. The nuclei default is a proposal that B1 must support before production use.

**Model-based element (proposed).** A hierarchical negative-binomial model of exonic and intronic UMIs per gene,

$$y^{E}_{gc}\sim\mathrm{NB}(s_c\theta_{gk},\alpha_g),\qquad y^{I}_{gc}\sim\mathrm{NB}(s_c\rho_{gk}\theta_{gk},\alpha_g),\qquad \log\rho_{gk}=\mu_g+u_{gk},\quad u_{gk}\sim\mathcal N(0,\tau_g^2),$$

shrinks $\log\rho$ across cell types by empirical Bayes. It reports the effective ratio and the total $(1+\rho_{gk})\theta_{gk}$, each with a posterior interval, and labels $\rho$ as effective (section 3). It is rejected if its totals fail the B2 thresholds or its acceptance criteria in B1 or B3 fail. The reusable parts are $\mu_g$ and $\tau_g$, fitted once on catalogue subsets and applied to new libraries.

**Stack.** PyTorch fits the negative-binomial model with empirical-Bayes priors on catalogue subsets. The Poisson working model (equation 3) is a per-gene log-linear GLM with offsets: small, linear and fitted for many genes at once, so it is hard-coded for CUDA with cuSPARSE products. Per-barcode totals and the intronic-to-exonic split are sparse reductions on the same kernels.

**Execution.** The mapping step is delegated to the engine chosen by `method`, which dominates time and memory; this task's kernels assemble features and reductions. Matrix assembly streams barcodes in chunks. The CPU path is the reference, and CUDA covers the GLM and reductions only.

**Defaults for an agent.** `method` `alevin_fry_usa`, `feature` `auto`, `reference` from the build step, `alevin_fry.resolution` `cr-like`, `rho_model` off, `device` `auto`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/ingest_geometry | dict | barcode and UMI geometry from parsing |
| read | uns/ref_build | string | reference build id and annotation release |
| read | var/gene_id | string | feature identifiers used to match gene rows |
| write | layers/exonic | sparse int32 | exonic UMIs per barcode and gene: `Gene` (starsolo), mature (kb_nac), S (alevin_fry_usa) |
| write | layers/intronic | sparse int32 | intron-only UMIs: GeneFull minus Gene (starsolo, derived), nascent (kb_nac), U (alevin_fry_usa) |
| write | layers/ambiguous | sparse int32 | ambiguous UMIs (kb_nac, alevin_fry_usa); absent for starsolo |
| write | X | sparse int32 | totals for the chosen `feature`, not normalised |
| write | obs/n_counts_exonic | int | sum of exonic UMIs per barcode |
| write | obs/n_counts_intronic | int | sum of intronic UMIs per barcode |
| write | obs/nuclear_fraction | float32 | $\mathrm{NF}_c$, equation (1) |
| write | obs/n_genes_detected | int | genes with at least one UMI in X |
| write | obs/usable_read_fraction | float32 | reads with valid barcode, UMI and gene assignment over all reads of the barcode |
| write | uns/intron_counting | dict | method, feature, reference build, annotation release, engine version, nuclear-fraction basis |
| write | models/rho_hierarchical | dict | effective ratio per gene and type with intervals; only when `rho_model.enabled` |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI with raw or tagged reads, or a workspace handle. |
| `method` | string | "alevin_fry_usa" | `starsolo`, `kb_nac`, `alevin_fry_usa` | Counting engine: starsolo (GeneFull family), kb_nac (nascent, mature, ambiguous) or alevin_fry_usa (splicing states). |
| `feature` | string | "auto" | `auto`, `exon`, `gene_full`, `gene_full_exon_over_intron`, `gene_full_ex50pas` | Counts that populate X. auto gives exon for whole cells and gene_full for nuclei; overlap variants need starsolo. |
| `reference` | string | — | — | Reference bundle handle from the build step; defaults to the dataset's uns/ref_build. |
| `starsolo` | object | — | — | Options used only when method is starsolo. |
| `starsolo.umi_dedup` | string | "1MM_All" | `1MM_All`, `1MM_Directional_UMItools`, `1MM_Directional`, `Exact`, `NoDedup`, `1MM_CR` | UMI collapsing rule; 1MM_All collapses UMIs one mismatch apart. |
| `starsolo.cb_match` | string | "1MM_multi" | `Exact`, `1MM`, `1MM_multi`, `1MM_multi_pseudocounts`, `1MM_multi_Nbase_pseudocounts` | Cell barcode matching to the whitelist, as documented by STARsolo. |
| `starsolo.cell_filter` | string | "CellRanger2.2 3000 0.99 10" | — | STARsolo cell filter string: filter type, then expected cells, percentile and ratio. |
| `kb` | object | — | — | Options used only when method is kb_nac. |
| `kb.nascent_matrices` | boolean | true | — | Return nascent, mature and ambiguous matrices from the nac index. |
| `kb.intron_flank` | integer/null | null | — | Bases of flank added to intron sequence; null applies the kb-python default. |
| `alevin_fry` | object | — | — | Options used only when method is alevin_fry_usa. |
| `alevin_fry.resolution` | string | "cr-like" | `cr-like`, `cr-like-em` | UMI resolution in USA mode; only these two strategies are available there. |
| `rho_model` | object | — | — | Options for the proposed hierarchical pre-mRNA ratio model; requires feature gene_full. |
| `rho_model.enabled` | boolean | false | — | Fit the hierarchical pre-mRNA ratio model and write models/rho_hierarchical. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; counting runs in the engine, and cuda serves the rho model and reductions. |
| `seed` | integer | 0 | — | Random seed for the rho model fit; ignored when rho_model.enabled is false. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`feature: auto` resolves from the dataset assay field, giving exon for whole cells and gene_full for nuclei. Overlap variants apply only to `starsolo`. The `starsolo`, `kb` and `alevin_fry` blocks are rejected for other methods. `gene_full` needs a reference that includes intron sequence, and `rho_model` needs `gene_full` because it models intronic counts. For `starsolo` the intronic layer is GeneFull minus Gene, exact only when both features collapse UMIs identically; otherwise it is an approximation recorded in `uns/intron_counting`.

## 7. MCP tool

Tool name `singlet_ingest_quant_intron_inclusive_gene_counting` (definition in `tasks/mcp/singlet_ingest_quant_intron_inclusive_gene_counting.json`). One call and one compact result:

```json
{
  "dataset": "nuc_example.singlet",
  "method": "alevin_fry_usa",
  "feature": "gene_full",
  "alevin_fry": {"resolution": "cr-like"}
}
```

```json
{
  "dataset": "nuc_example.singlet",
  "status": "completed",
  "wrote": ["layers/exonic", "layers/intronic", "layers/ambiguous", "X", "obs/nuclear_fraction"],
  "summary": {"n_cells": "<int>", "median_genes_per_cell": "<float>", "median_nuclear_fraction": "<float>", "intronic_share": "<float>"},
  "provenance_id": "<id>"
}
```

Long-running: the mapping step over all reads dominates; a large library returns `status: queued` with a `job_id`. Stochastic: the engines are treated as deterministic for a fixed version, and `seed` affects only `rho_model`. Dry run: estimates time and peak memory from read count and reference size, without mapping.

## 8. Benchmarks

Shared protocol: modes use the same reads, reference build, annotation release, cell whitelist and filters for each dataset. Cluster resolutions are frozen on the exonic run. Metrics use labelled barcodes only. Seeds 0 to 2 apply where a stochastic step exists. Engine versions are recorded in `uns/intron_counting`.

### B1. Matched cell-type profiles, nucleus versus whole cell

- **Goal**: test whether intron-inclusive totals bring nuclear profiles closer to matched whole-cell profiles of the same type.
- **Ground truth**: expert labels with an orthogonal reference. Each barcode's type is the matched taxonomy of the source study, assigned without the counting mode under test; the whole-cell pseudobulk is a consistency target, not a mature-RNA truth.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Matched cortical nuclei and whole cells | [R9] | single-nucleus and whole-cell RNA-seq, cortex; species and size — | — | accession —; raw reads required |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Matched-type profile correlation | per matched type, Pearson correlation between nucleus and whole-cell pseudobulk means of log1p(10^4 × proportion) over genes with at least 1 UMI in at least 1% of barcodes in both modalities; averaged over types, weighted by barcode count | higher is better | primary | — |
| Median genes per barcode | median over barcodes of the number of genes with at least 1 UMI | descriptive | guardrail | — |

- **Comparators**: STARsolo `Gene`; STARsolo `GeneFull`, `GeneFull_ExonOverIntron` and `GeneFull_Ex50pAS`; kb-python nac total (nascent, mature and ambiguous summed); alevin-fry USA total (U+S+A); Cell Ranger in its exon-only configuration.
- **Protocol**: apply each mode to the raw reads of every matched pair with identical reference and filters; score only when at least two matched pairs are available.
- **Acceptance criterion**: PROPOSED, not from the literature. An intron-inclusive mode is accepted for nuclei if matched-type correlation is at least the exonic value and median genes per barcode is at least 1.10 times the exonic value, in every matched pair.
- **Known pitfalls**: whole-cell profiles carry their own mature-RNA bias, so correlation rewards agreement with that reference; nucleus and whole-cell pairs also differ in cell calling, which single-nucleus data handle with extra heuristics [R1].

### B2. Planted pre-mRNA ratio simulation (proposed)

- **Goal**: verify the ratio identity and fold-change formula against known truth.
- **Ground truth**: planted simulation; the oracle is the expected count per class, set at generation.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Synthetic generator (recipe below) | this section; means from the B1 nucleus dataset | simulated barcode-by-gene counts | — | 10 replicates per setting (proposed) |

Recipe:

1. Draw $\theta_g$ from a gamma distribution fitted by moments to the per-gene means of the exonic matrix of the B1 nucleus dataset; set $\theta_{gk}=\theta_g$ for all types, so fold changes isolate $\rho$.
2. Per type draw $\mu_k\sim\mathcal N(0,0.5^2)$; per gene draw $z_{gk}\sim\mathcal N(\mu_k,1)$ and set $\rho_{gk}=\max(0,e^{z_{gk}}-1)$, which gives mass at zero and values above 3 (proposed).
3. Per barcode draw $s_c=e^{\epsilon_c}$ with $\epsilon_c\sim\mathcal N(0,0.3^2)$ (proposed); set means $s_c\theta_g$ and $s_c\rho_{gk}\theta_g$, keeping noise-free means and Poisson draws.
4. Length-bias variant: multiply intronic means by $\kappa\in\{0.5,1,2\}$ (proposed). Report by $\rho$ bins $[0,0.5)$, $[0.5,1)$, $[1,3)$, $[3,\infty)$ (proposed).

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Relative bias of the inclusive total | median absolute relative error of the inclusive count against the expected total, over gene-barcode pairs with expected total at least 1 | lower is better | primary | — |
| Fold-change agreement | median absolute log2 difference between the observed inclusive-over-exonic fold change and $(1+\rho_A)/(1+\rho_B)$, per gene and type pair | lower is better | primary | — |

- **Comparators**: exonic counts; additive gene-full counts $y^{E}+y^{I}$; the oracle.
- **Protocol**: apply the recipe at each $\kappa$; compute both metrics per $\rho$ bin, for noise-free and Poisson data.
- **Acceptance criterion**: PROPOSED, not from the literature. For $\kappa=1$ on noise-free means, median relative bias at most 0.05 and median absolute log2 difference at most 0.05.
- **Known pitfalls**: the simulator and estimator share the working model, and noise-free totals are exact by construction, so only the $\kappa$ variant probes misspecification; the count simulator cannot produce reads overlapping two genes, so overlap variants go untested.

### B3. Cell-type consistency across counting modes (proposed)

- **Goal**: test whether intron-inclusive totals keep cell-type structure relative to exonic counts on annotated barcodes.
- **Ground truth**: expert labels. Each annotated barcode carries its author annotation, which is held out from the embedding and does not depend on the counting mode; unannotated barcodes are excluded.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue, annotated barcodes from nucleus and whole-cell samples | internal catalogue | 354M barcodes, about 40 percent annotated; subset composition — | internal | subset rule fixed before scoring |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Adjusted Rand index | ARI between Leiden clusters, at a resolution frozen on the exonic run, and author labels over annotated barcodes | higher is better | primary | section 12 |
| kNN label-transfer macro F1 | k = 15 classifier trained on a stratified 50 percent of annotated barcodes, macro F1 on the remaining 50 percent | higher is better | guardrail | — |

- **Comparators**: exonic (`Gene`); STARsolo `GeneFull`; STARsolo `GeneFull_ExonOverIntron`.
- **Protocol**: per mode, the same embedding (2000 highly variable genes and 50 principal components, proposed); results stratified by assay metadata.
- **Acceptance criterion**: PROPOSED, not from the literature. Non-inferior on nuclei if the ARI difference is at least −0.01 and the macro-F1 difference is at least −0.01; superiority is not required.
- **Known pitfalls**: author labels may derive from one counting mode; ARI depends on the number of clusters, so an apparent change can reflect cluster count.

### P1. Performance and scaling

Wall time, peak resident memory, index size and disk footprint for each mode at 10k, 100k and 1M nuclei (proposed scales), with index construction and quantification timed separately and with warm and cold caches. Comparators: STARsolo Gene and GeneFull, kb-python nac, alevin-fry USA, and Cell Ranger in its exon-only configuration. Fixed: threads, genome build, annotation release, reads and storage. CPU and CUDA are compared only for the GLM and reduction steps.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.reference_annotation_build`: Reference genome and annotation preparation for single-cell counting (including custom host-plus-pathogen and transgene references)
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
- **Feeds**:
  - `cell-calling.nucleus_vs_empty_calling`: Nucleus versus empty-droplet calling in single-nucleus RNA-seq
  - `qc.single_nucleus_quality_filtering`: Nucleus-aware quality filtering for single-nucleus RNA-seq
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Reads**: `uns/ingest_geometry`, `uns/ref_build`, `var/gene_id`
- **Writes**: `layers/exonic`, `layers/intronic`, `layers/ambiguous`, `X`, `obs/n_counts_exonic`, `obs/n_counts_intronic`, `obs/nuclear_fraction`, `obs/n_genes_detected`, `obs/usable_read_fraction`, `uns/intron_counting`, `models/rho_hierarchical`
<!-- CHAINING:AUTO:END -->

Workflow: gene-level counting for single-nucleus libraries; no named recipe yet.

## 10. Risks, pitfalls and open questions

- **Cell Ranger.** The repository in the corpus does not document pre-mRNA counting or an intron-inclusive option, so its semantics and default in each release are unknown here. Cell Ranger therefore appears only as an exon-only comparator.
- **Preprint claims.** The ABACUS preprint reports nearly twice the nuclei of the Cell Ranger workflow on one pilot human brain dataset [R5]. The quantitative results of the Pool et al. and ABACUS preprints [R4, R5] are not verified against full texts, and neither method has an identified code repository or licence.
- **Datasets.** No second matched nucleus and whole-cell pair is identified, so B1 cannot be scored yet. The species, size and accession of the B1 dataset from [R9] were not checked. The nucleus and whole-cell composition of the 354M-barcode catalogue is not established, which blocks B3. No multiplexed nucleus dataset with hashing or genotype labels is identified, so a nuclear-fraction benchmark is not defined. B2 depends on the exonic matrix of the B1 nucleus dataset.
- **Engine details and licences.** GeneFull_ExonOverIntron and GeneFull_Ex50pAS are documented only in CHANGES.md:15 and :39 and in source. alevin-fry's docs do not state a default resolution strategy. zUMIs is excluded because its intronic-counting behaviour is not stated in the sources used. The licences of third-party code bundled with STAR, kb-python and alevin-fry were not checked. Gorin and Pachter (2021) and the 10x technote are cited for the claims in their titles only.
- **Magnitudes.** UMI collision rates for intronic reads and the size of length bias on nuclear data are not measured in the sources used, so the size of the distortion in equation (5) on real data is unknown.
- **First experiment.** Compute the B1 metrics for one matched nucleus pair under exonic and STARsolo gene-full counting, and use the result to decide whether the length-bias variant of B2 is needed.

## 11. References

R1. theislab/single-cell-best-practices, Jupyter Book chapter "Raw data processing" (`jupyter-book/introduction/raw_data_processing.md`, repository commit d581689). The book builds on Heumos L, Schaar AC, Lance C, et al. *Nature Reviews Genetics* 2023, doi:10.1038/s41576-023-00586-w. — verified (repo)
R2. Brüning RS, Tombor L, Schulz MH, Dimmeler S, John D. Comparative analysis of common alignment tools for single-cell RNA sequencing. *GigaScience* 2022. doi:10.1093/gigascience/giac001 — verified (corpus)
R3. 10x Genomics. Technical note: interpreting intronic and antisense reads in 10x Genomics single cell gene expression data. 2021. — verified (corpus)
R4. Pool AH, Poldsam H, Chen S, Thomson M, Oka Y. Enhanced recovery of single-cell RNA-sequencing reads for missing gene expression data. *bioRxiv* 2022. doi:10.1101/2022.04.26.489449 — verified (corpus)
R5. Xi S, Gibilisco L, Kummer M, Biber K, Wachter A, Woodbury M. ABACUS: a flexible UMI counter that leverages intronic reads for single-nucleus RNAseq analysis. *bioRxiv* 2020. doi:10.1101/2020.11.13.381624 — partial (search)
R6. Gorin G, Pachter L. Length biases in single-cell RNA sequencing of pre-mRNA. *bioRxiv* 2021. doi:10.1101/2021.07.30.454514 — verified (corpus)
R7. Soneson C, Srivastava A, Patro R, Stadler MB. Preprocessing choices affect RNA velocity results for droplet scRNA-seq data. *PLoS Computational Biology* 2021. — verified (corpus)
R8. Ding J, Adiconis X, Simmons SK, et al. Systematic comparison of single-cell and single-nucleus RNA-sequencing methods. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0465-8 — verified (corpus)
R9. Bakken TE, Hodge RD, Miller JA, et al. Single-nucleus and single-cell transcriptomes compared in matched cortical cell types. *PLoS ONE* 2018. doi:10.1371/journal.pone.0209648 — verified (corpus)
R10. Muskovic W, Powell JE. DropletQC: improved identification of empty droplets and damaged cells in single-cell RNA-seq data. *Genome Biology* 2021. doi:10.1186/s13059-021-02547-0 — verified (corpus)
R11. Kaminow B, Yunusov D, Dobin A. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021. doi:10.1101/2021.05.05.442755 — verified (corpus)
R12. Melsted P, Booeshaghi AS, Liu L, et al. Modular, efficient and constant-memory single-cell RNA-seq preprocessing. *Nature Biotechnology* 39:813–818 (2021). doi:10.1038/s41587-021-00870-2 — verified (corpus)
R13. kallisto, bustools and kb-python for quantifying bulk, single-cell and single-nucleus RNA-seq. *Nature Protocols* 2024. doi:10.1038/s41596-024-01057-0 — partial (corpus)
R14. He D, Zakeri M, Sarkar H, Soneson C, Srivastava A, Patro R. Alevin-fry unlocks rapid, accurate and memory-frugal quantification of single-cell RNA-seq data. *Nature Methods* 2022. doi:10.1038/s41592-022-01408-3 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/alexdobin/STAR | Alexander Dobin | MIT (LICENSE file) | STARsolo features and overlap variants (docs and source) | port |
| https://github.com/pachterlab/kb_python | Kyung Hoi (Joseph) Min (author); Pachter Lab (maintainer), per setup.py | BSD 2-Clause (LICENSE file) | nac index, intron flank and nascent partition | port |
| https://github.com/COMBINE-lab/alevin-fry | COMBINE lab, University of Maryland | BSD 3-Clause (LICENSE file) | USA mode and cr-like resolution | port |
| https://github.com/powellgenomicslab/DropletQC | Walter Muskovic | MIT (DESCRIPTION: 'MIT + file LICENSE'; LICENSE file names copyright holder Walter Muskovic, 2021) | nuclear fraction definition | callout |
| https://github.com/10XGenomics/cellranger | 10x Genomics | custom 10x Genomics licence (LICENSE file; use with 10x products and internal use only, no redistribution) | pre-mRNA reference; comparator | callout |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller and others (pyproject.toml) | MIT (LICENSE.txt and pyproject.toml) | ARI implementation for B3 (scib/metrics/ari.py) | callout |
