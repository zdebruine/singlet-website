---
id: qc.dissociation_stress_detection
title: Dissociation-induced stress detection and removal
area: qc
scope: extended
paradigm: heuristic
literature_status: contested
priority: P1
depends_on: [cell-calling.cell_vs_empty_droplet_calling, qc.low_quality_cell_detection, normalization.size_factor_estimation]
feeds: [dim-reduction.normalized_cell_embedding, feature-selection.highly_variable_gene_selection, clustering.cell_partitioning]
reads: [X, obs/<batch_key>]
writes: [obs/dissociation_score, obs/dissociation_flag, uns/dissociation_panel_used, layers/dissociation_regressed]
devices: [cpu, cuda]
mcp_tool: singlet_qc_dissociation_stress_detection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Dissociation-induced stress detection and removal

> Scores each cell on a fixed panel of ex vivo dissociation stress genes, optionally flags or removes that score before clustering, and records the panel, the scores and every removal.

## 1. Question

Which cells carry an ex vivo dissociation stress program, mainly immediate-early and heat-shock transcription induced during warm enzymatic and mechanical digestion, rather than in vivo biology, and should they be flagged, excluded or regressed? The input is a count or log-normalised matrix with a fixed gene panel; the outputs are a per-cell score, an optional flag, and the genes or residuals used for removal. A correct answer scores warm-digested cells above on-ice-digested cells of the same type and removes little in vivo activation.

## 2. Why this task matters and where the field stands

Warm enzymatic and mechanical digestion induces immediate-early and heat-shock transcription in the cells it leaves intact, and van den Brink et al. document dissociation-induced expression in tissue subpopulations [R1]. Denisenko et al. compare dissociation and storage workflows for single-cell and single-nucleus RNA-seq in mouse kidney [R2]. A stress program that reaches clustering can define artefactual clusters, and removing the score removes in vivo activation along with the artefact.

The task is **contested**.

1. **Ground truth is weak.** Labelling strategies measure the stress response during dissociation directly [R4]; protocol contrasts give sample-level labels only [R2].
2. **Panels are not standardised, and benchmarks are missing.** Section 10 lists the evidence gaps, including the absence of a computational benchmark for stress scoring or removal.
3. **Removal is not neutral.** Immediate-early genes carry activity-dependent in vivo signal, and glial signatures can be artefactual or confounding [R3].

Open problems: a per-cell score with calibrated uncertainty; separating dissociation from activity-dependent induction in neurons and glia; panel transfer across species, tissues and nuclei; and whether removal changes cluster structure or only composition.

## 3. Theory and insight

For a panel $G$ and cell $i$, the working model is additive on the log scale to first order,
$$\mathbb{E}[x_{ig}\mid z_i,h_i]\approx\mu_g+\beta_g z_i+\gamma_g^{\top}h_i ,$$
where $z_i\ge0$ is the dissociation program and $h_i$ the in vivo state. A panel average estimates $\bar\beta_G z_i+\bar\gamma_G^{\top}h_i$, so a score on shared genes cannot separate the two parts without an external contrast. Regime: first order, additive on the log scale, and enough cells per expression bin. The artefact has an external definition: the digestion arm of the protocol contrast in section 8 (B1) is a sample-level truth. A score should be judged by how well it separates arms and by how little activation it removes.

| Symbol | Meaning |
|---|---|
| $x_{ig}$ | log-normalised expression of gene $g$ in cell $i$ |
| $G$, $C_i$ | panel genes; control genes for cell $i$ |
| $r_{ig}$ | rank of gene $g$ in cell $i$ over all genes (1 is highest) |
| $z_i$, $h_i$ | dissociation factor; in vivo covariates |
| $T_i$ | digestion arm of the sample of cell $i$ (1 warm, 0 on ice) |

**Scores.** The module score is
$$S^{\mathrm{mod}}_i=\frac{1}{|G|}\sum_{g\in G}x_{ig}-\frac{1}{|C_i|}\sum_{c\in C_i}x_{ic},$$
where $C_i$ holds genes whose average expression falls in the same bins as the panel. It estimates the excess of the panel over a random gene set of matched average expression. Regime: the additive model above; its scale follows the log base and the size factors of $x$.

With $R_{\max}$ the rank cutoff, UCell uses
$$R_i=\sum_{g\in G}\min(r_{ig},R_{\max}),\qquad S^{U}_i=1-\frac{R_i-R_{\min}(|G|)}{|G|\,R_{\max}-R_{\min}(|G|)},$$
where $R_{\min}(|G|)$ is the smallest attainable $R_i$, the sum of the first $|G|$ integer ranks. $S^U_i$ is an affine rescaling of a capped Mann-Whitney statistic: it equals 1 when the panel occupies the top $|G|$ ranks and 0 when every panel gene lies beyond $R_{\max}$. AUCell uses the discrete area under the truncated recovery curve (ranks below $R$ only), divided by its maximum attainable value, with $|G|$ counting panel genes present in the data,
$$\mathrm{AUC}_i=\frac{\sum_{k=1}^{R-1}\bigl|\{g\in G:\,r_{ig}\le k\}\bigr|}{\sum_{k=1}^{R-1}\min(k,|G|)},\qquad R=\lceil 0.05\,n_{\mathrm{genes}}\rceil .$$
Because UCell and AUCell use only within-cell ranks, they are invariant to per-cell size factors and to any strictly increasing transform of $x$; the module score is not.

**Estimands.** Each output is defined as follows.

- $S^{\mathrm{mod}}_i$ is the panel excess over matched background, in log-normalised units of $x$.
- $S^U_i$ is the capped rank statistic in $[0,1]$.
- $\mathrm{AUC}_i$ is the fraction of the maximum attainable truncated recovery area, in $[0,1]$.
- The flag is a within-batch quantile of the score, with no absolute threshold.
- For the protocol truth, the AUROC of $S_i$ against $T_i$ estimates $P(S_i>S_j\mid T_i=1,T_j=0)$ on held-out samples.
- For a labelling truth, the labelled fraction $f_i$ is labelled reads over total panel reads, between 0 and 1; for a single compartment with first-order degradation rate $k$ and label window $t_d$, a transcript's expected labelled fraction is $1-e^{-kt_d}$.

**Assumptions.** The program is taken to be partly shared across cell types and partly cell-type specific. Panel genes are not dominated by in vivo activity, or the in vivo part is separable with protocol contrasts. Scores are comparable across cells only for a fixed panel and fixed units. The digestion arm is a valid label for a subset of cells, since ordinary data hold no per-cell truth.

**Failure modes.** The module score depends on the log base, the bin population and the seed. UCell and AUCell discard information by capping ranks and, with short panels, produce coarse ties under dropout. For every scorer, cell types with high in vivo immediate-early expression score high without dissociation, the confounding that glial analyses dissect [R3]. Removing the panel deletes activity-dependent signal. Single-nucleus RNA-seq profiles nuclei rather than dissociated whole cells [R12], so the sensitive gene set changes between the two modalities.

**Why heuristics work and what a model adds.** Module scores and rank scores rank cells well when the panel signal is strong relative to dropout and background. They are transparent and cheap, but they carry no cause, no probability and no account of co-expression. A factor model adds per-cell posteriors, separation of shared genes through covariates $h_i$, reuse of fitted loadings on new data and checkable calibration, at the cost of identifiability assumptions that protocol contrasts must test.

**Pitfalls.** A panel derived from the labels being tested is circular and inflates agreement. An evaluation that scores removal only by clustering does not see the loss of activation.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Seurat AddModuleScore | heuristic | Mean panel expression minus the mean over control genes drawn from expression bins, per cell. | [R5][R6] |
| scanpy score_genes | heuristic | The same score, with controls sampled per expression bin from the gene pool. | [R5][R7] |
| UCell | heuristic | Capped Mann-Whitney statistic of panel ranks, scaled to $[0,1]$. | [R8] |
| AUCell | heuristic | Area under the recovery curve of panel genes within the top 5 percent of ranks. | [R9] |
| scanpy regress_out | heuristic | Linear regression of each gene on observation covariates, keeping residuals. | [R7] |

The published heuristic standard is the module score with rank-based alternatives, and regression of the score before clustering. The module score and the rank-based scorers are kept as comparators in the benchmarks of section 8, and regression is the removal comparator. Protocol contrasts are the external standard for evaluation rather than methods, and are treated in section 8.

Exact defaults:

| Method | Parameter | Value | Source |
|---|---|---|---|
| Seurat AddModuleScore | nbin | 24 | R/utilities.R:273 @ 5f67c70 |
| Seurat AddModuleScore | ctrl | 100 | R/utilities.R:274 @ 5f67c70 |
| Seurat AddModuleScore | seed | 1 | R/utilities.R:277 @ 5f67c70; set.seed at :190 |
| Seurat AddModuleScore | slot | data | R/utilities.R:279 @ 5f67c70 |
| scanpy score_genes | ctrl_size | 50 | src/scanpy/tools/_score_genes.py:102 @ 8ed52d9 |
| scanpy score_genes | n_bins | 25 | src/scanpy/tools/_score_genes.py:104 @ 8ed52d9 |
| scanpy score_genes | gene_pool | all genes | src/scanpy/tools/_score_genes.py:103, 246-247 @ 8ed52d9 |
| scanpy score_genes | ctrl_as_ref | True for ScanpyV1; False for ScanpyV2Preview | src/scanpy/_settings/presets.py:266-267 @ 8ed52d9 |
| scanpy score_genes | random seed | 0 (legacy decorator) | src/scanpy/tools/_score_genes.py:96 @ 8ed52d9 |
| UCell | maxRank | 1500 | R/AddModuleScore_UCell.R:71 @ f778e09 |
| UCell | chunk.size | 100 | R/AddModuleScore_UCell.R:72 @ f778e09 |
| UCell | ties.method | average | R/AddModuleScore_UCell.R:73 @ f778e09 |
| UCell | w_neg | 1 | R/AddModuleScore_UCell.R:73 @ f778e09 |
| UCell | storeRanks | FALSE | R/AddModuleScore_UCell.R:72 @ f778e09 |
| AUCell | aucMaxRank | ceiling(0.05 × nrow(rankings)) | R/02_calcAUC.R:37 @ 91753b3 |
| AUCell | normAUC | TRUE | R/02_calcAUC.R:36 @ 91753b3 |
| scanpy regress_out | layer, n_jobs, copy | None, None, False | src/scanpy/preprocessing/_simple.py:513-519 @ 8ed52d9 |

## 5. Proposed singlet approach

**Routes** (repositories and licences in section 12). `module_score` is ported with both the Seurat and the scanpy convention, and `regress_out` is ported as a linear regression on the score. `ucell` and `aucell` are reimplemented from the formulas in section 3, not copied. Comparators and the simulator are callouts.

**Default.** `module_score` with the Seurat convention. The panel is required and must be fixed before any test labels are examined; the tool records the genes found and missing in `uns/dissociation_panel_used`.

**Core kernels.** The panel mean is a gather over CSR rows. Control sets are drawn once per dataset from gene-mean bins computed in a first sweep over the matrix, so scoring is a second sweep. Per-cell ranks need only nonzero entries: for non-negative values, all zeros share the average rank $(n_{\mathrm{nz}}+1+n_{\mathrm{genes}})/2$, so one sort of each cell's nonzero values gives the UCell ranks under average ties.

**Devices and streaming.** Scores are row-local, so row blocks stream on CPU threads or CUDA, with memory bounded by the block and the gene-mean vector.

**Proposed model-based route.** The negative-binomial factor model of section 3 is fitted by stochastic variational inference in PyTorch, with a sparse prior on $\beta$ and per-cell inference of $z_i$; the amortised-encoder design of [R10] is the reference. Scoring with fixed loadings is a sparse-dense product, hard-coded in CUDA and cuSPARSE. Supervised programs with gene-set priors [R11] are the nearest published relative. The model enters the enum only after meeting the B2 criterion, and is rejected if its posterior is not monotone in the planted fold change, if its false-positive rate on the null exceeds the module score's at equal recall, or if removing its $z$ component cuts the unplanted program's correlation below the B2 threshold.

**Defaults an agent should use without asking.** `method` module_score; `flag.rule` none, so scores only; `pre_clustering.mode` none; `protect_genes` set to the tissue's in vivo activation genes whenever a removal mode is chosen; `batch_key` set to the library column when the dataset holds several libraries. Report scores rather than flags unless a threshold has been validated on a protocol contrast.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | X | float32 sparse | Log-normalised expression, cells by genes; panel genes matched to `var_names`. |
| read | obs/`batch_key` | categorical | Library or batch label, read when `flag.batch_key` is set. |
| write | obs/dissociation_score | float32 | Per-cell score: log units for module_score, $[0,1]$ for ucell and aucell. |
| write | obs/dissociation_flag | bool | Flag from `flag.rule`; all false when the rule is none. |
| write | uns/dissociation_panel_used | dict | Panel genes found in the data and missing from it. |
| write | layers/dissociation_regressed | float32 | Residuals after regressing the score out; written only in `regress_out` mode. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `panel` | array | required | — | Gene symbols of the stress program, fixed before inspecting test labels; matched to var names. |
| `method` | string | "module_score" | `module_score`, `ucell`, `aucell` | Scorer: module_score (expression-matched controls, default), ucell (rank-based) or aucell (recovery curve). |
| `flag` | object | — | — | Flagging rule applied to the score; off by default. |
| `flag.rule` | string | "none" | `none`, `within_batch_quantile` | none keeps scores only; within_batch_quantile flags cells above a quantile within each batch. |
| `flag.batch_key` | string/null | null | — | obs column of batches for within_batch_quantile; null treats the dataset as one batch. |
| `flag.quantile` | number | 0.95 | > 0; < 1 | Score quantile above which cells are flagged within each batch. |
| `pre_clustering` | object | — | — | Treatment of the stress program before clustering. |
| `pre_clustering.mode` | string | "none" | `none`, `exclude_panel`, `regress_out` | none keeps the matrix; exclude_panel drops panel genes from clustering features; regress_out removes the score from other genes. |
| `pre_clustering.protect_genes` | array | [] | — | In vivo activation genes never excluded or regressed in any mode. |
| `module_score` | object | — | — | Options for module_score only. |
| `module_score.convention` | string | "seurat" | `seurat`, `scanpy` | Control-gene convention: seurat draws controls per panel gene, scanpy per expression bin. |
| `module_score.n_bins` | integer/null | null | min 1 | Expression bins; null uses the convention's standard value. |
| `module_score.n_control` | integer/null | null | min 1 | Controls per panel gene (seurat) or per bin (scanpy); null uses the convention's standard value. |
| `ucell` | object | — | — | Options for ucell only. |
| `ucell.max_rank` | integer | 1500 | min 1 | Rank cutoff for the capped rank statistic. |
| `aucell` | object | — | — | Options for aucell only. |
| `aucell.max_rank_frac` | number | 0.05 | max 1; > 0 | Fraction of all genes used to truncate the recovery curve. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for module_score control sampling; the other methods are deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Options are nested by method: `module_score`, `ucell` and `aucell` options apply only to their own method, and other options are ignored. `flag.rule` `within_batch_quantile` ranks each cell within `flag.batch_key`, which is one batch when null. `pre_clustering.protect_genes` are never excluded or regressed in any mode. `exclude_panel` removes panel genes from the clustering features, and `regress_out` removes the score from every other gene. `seed` affects only `module_score` control sampling. Scores are always written, and flags are off by default.

## 7. MCP tool

Tool name `singlet_qc_dissociation_stress_detection` (definition in `tasks/mcp/singlet_qc_dissociation_stress_detection.json`). Example call and compact result:

```json
{"dataset": "data/tissue.singlet", "panel": ["Fos", "Jun", "Junb"], "method": "module_score",
 "pre_clustering": {"mode": "exclude_panel", "protect_genes": ["Arc"]}}
```

```json
{"dataset": "data/tissue.singlet", "status": "completed",
 "wrote": ["obs/dissociation_score", "obs/dissociation_flag", "uns/dissociation_panel_used"],
 "summary": {"method": "module_score", "n_cells": "<n>", "panel_genes_found": "<k>", "panel_genes_missing": "<m>", "n_flagged": 0, "mode": "exclude_panel"},
 "provenance_id": "<id>"}
```

Long-running: inputs above a size set by the implementation return `queued` with a `job_id`. Stochastic: only `module_score` control sampling, through `seed`. Dry-run: estimated seconds, peak memory and device from cell count, stored entries and method.

## 8. Benchmarks

**Shared protocol.** Every comparator scores the same cells with the section 4 defaults unless stated, and hardware, versions and commits are recorded. Folds are split by sample, and no test-fold cell is used to choose the panel. Scorers fit no parameters, so folds average sampling variation only. Stochastic comparators use seeds 0 to 19 and report the mean and bootstrap 95 percent interval across seeds.

### B1. Digestion-temperature contrast in mouse kidney (Denisenko et al. 2020 design)

- **Goal**: whether each scorer separates cells of warm-digested samples from cells of on-ice-digested samples, with the panel fixed before any label is examined.
- **Ground truth**: sample-level protocol contrast. Each cell inherits its sample's arm, $T_i=1$ for 37 °C and $T_i=0$ for on-ice digestion; no per-cell truth exists. The estimand is $P(S_i>S_j\mid T_i=1,T_j=0)$ on held-out samples, with midrank ties.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| GSE141115 | GEO series named in [R2] | Mouse kidney; 77,656 scRNA-seq and 98,303 snRNA-seq profiles and 15 bulk libraries, as stated in the bioRxiv preprint 10.1101/832444 | — | Arm labels from GEO sample metadata; each modality analysed separately. |

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Cell-level AUROC | AUROC of $S_i$ against $T_i$ on held-out samples; midrank ties; mean over folds | higher | primary | proposed |
| Composition shift | Total variation distance between cell-type proportions of cells in the top 5 percent of $S_i$ per sample and of the other cells; mean over samples | lower | guardrail | proposed |

- **Comparators**: Seurat AddModuleScore, scanpy score_genes, UCell, AUCell, the mitochondrial fraction (naive proxy), and a random gene set of matched size (null).
- **Protocol**: the panel is Fos, Jun and Junb (mouse symbols), frozen before scoring. Folds are split by sample, each modality is scored separately, and cell types come from the study annotation.
- **Acceptance criterion**: proposed, not from the literature. Best method median held-out AUROC at least 0.80; random-gene-set AUROC between 0.45 and 0.55.
- **Known pitfalls**: arms may differ in batch or donor, and the AUROC does not separate that from dissociation. The panel may track cell type, so composition differences leak into the score; the composition guardrail detects this.

### B2. Planted dissociation program in simulated counts (proposed)

- **Goal**: detection power, false positives and preservation of an unplanted program.
- **Ground truth**: planted at generation; $y_i=1$ for planted cells; estimand: AUROC of $S_i$ against $y_i$.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter counts | Splatter [R14] fitted to one on-ice GSE141115 library | Simulated; 10,000 cells per replicate | — | — |

- **Generator recipe**
  1. Fit Splatter to one on-ice GSE141115 library; simulate 10,000 cells with its annotated groups.
  2. Draw planted genes $G_s$: 50 uniformly from genes detected in at least 5 percent of cells.
  3. Draw panel $P$: 25 genes from $G_s$ and 25 other detected genes, an imperfect list.
  4. Mark a uniform fraction $\pi\in\{0.05,0.20\}$ of cells as planted.
  5. In planted cells, replace counts of $G_s$ by $\operatorname{round}(f\,c_{ig})$, $f\in\{2,4\}$, then thin other counts binomially to keep totals.
  6. Draw unplanted program $U$: 50 genes disjoint from $G_s$ and $P$, fold change 2 in 20 percent of cells.
  7. Null simulations repeat steps 1 to 3 and 6 with $\pi=0$, seeds offset by 10.

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cell-level AUROC | Midrank AUROC of $S_i$ against $y_i$ | higher | primary | proposed |
| Precision and recall at 5 percent | Top 5 percent of cells by $S_i$ against $y_i$ | higher | primary | proposed |
| False positive rate, null | 95th percentile of $S$ on null seed $s$, tested on seed $s+10$ | lower | guardrail | proposed |
| Unplanted-program preservation | Correlation of $U$'s score before and after regressing $S$ out | higher | guardrail | proposed |

- **Comparators**: scanpy, Seurat, UCell, AUCell and a regression baseline.
- **Protocol**: mean and bootstrap 95 percent interval across seeds 0 to 19, per $(f,\pi)$.
- **Acceptance criterion (proposed)**: AUROC at least 0.95 at $f=4$, $\pi=0.20$; null false positive rate at most 0.05.
- **Known pitfalls**: planted programs ignore cell type, unlike real stress; the test measures power only.

### P1. Performance and scaling

Wall time, peak host and device memory, and throughput in cells per second at $10^4$, $10^5$, $10^6$ and $10^7$ cells, on cell subsamples of catalogue libraries. Comparators: scanpy score_genes, Seurat AddModuleScore, UCell and AUCell. Hold fixed the panel of 50 genes, the all-gene pool, the thread count, the CPU model, CSR input and the control count per bin. Report the median of five timed repetitions after one discarded warm-up. Acceptance criterion (proposed): at $10^6$ cells on the same CPU, singlet takes at most 0.2 times the wall time of the fastest comparator.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Feeds**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Reads**: `X`, `obs/<batch_key>`
- **Writes**: `obs/dissociation_score`, `obs/dissociation_flag`, `uns/dissociation_panel_used`, `layers/dissociation_regressed`
<!-- CHAINING:AUTO:END -->

Workflow: the quality-control stage after cell calling, quality filtering and normalisation, before clustering. No named recipe yet.

## 10. Risks, pitfalls and open questions

- **Protocol evidence.** The gene list and design of van den Brink et al. 2017 are not stated in the cited sources, so no benchmark uses them and the panel is a design choice. The labelling chemistry, pulse length, labelled-cell threshold, datasets and accessions of Neuschulz et al. 2023 are not stated in the cited sources, so a labelled-transcript benchmark is deferred. The paired design of Ding et al. 2020 is not stated either, so the single-nucleus comparison is deferred [R1][R4][R13].
- **Denisenko data.** B1 assumes the arm design (digestion at 37 °C against digestion on ice) of Denisenko et al. 2020; the paper's methods and the GEO sample metadata were not checked for it. The lymphocyte result of that paper is not used. Arm labels must be read from GEO sample metadata before B1 is computed. The profile counts for GSE141115 come from the preprint, and the GEO series counts experiments. Heat-shock members of the stress program are not stated in the cited sources, so B1 uses only Fos, Jun and Junb.
- **Literature gaps.** No computational benchmark of stress scoring or removal is cited, and no flag threshold is validated. Separating dissociation-induced from activity-dependent immediate-early genes in neurons and glia is unresolved. Marsh et al. 2022 is cited at title level only [R3].
- **Licence and route risks.** AUCell is reimplemented from its documented formula; its licence and repository status are in section 12. Dataset terms for GSE141115 and for the catalogue subsamples used in P1 are not stated in the cited sources.
- **Technical gaps.** Section 4 covers control-set construction, the regress_out solve and the AUCell normalisation as read in the code. The final averaging step of Seurat's AddModuleScore is not reproduced here.
- **First experiment.** On one on-ice library from GSE141115, compute the module score under both conventions, check seed stability over seeds 0 to 19, and confirm that UCell and AUCell ranks are unchanged by per-cell size-factor scaling. Then compute B1 for the three immediate-early genes once the arm labels are read.

## 11. References

R1. van den Brink SC, Sage F, Vértesy Á, Spanjaard B, Peterson-Maduro J, Baron CS, Robin C, van Oudenaarden A. Single-cell sequencing reveals dissociation-induced gene expression in tissue subpopulations. *Nature Methods* 2017. doi:10.1038/nmeth.4437 — verified (corpus)
R2. Denisenko E, et al. Systematic assessment of tissue dissociation and storage biases in single-cell and single-nucleus RNA-seq workflows. *Genome Biology* 2020;21:130. doi:10.1186/s13059-020-02048-6 — verified (search)
R3. Marsh SE, Walker AJ, Kamath T, et al. Dissection of artifactual and confounding glial signatures by single-cell sequencing of mouse and human brain. *Nature Neuroscience* 2022. — unverified (memory)
R4. Neuschulz A, et al. A single-cell RNA labeling strategy for measuring stress response upon tissue dissociation. *Molecular Systems Biology* 2023;19(2):e11147. doi:10.15252/msb.202211147 — verified (search)
R5. Tirosh I, Izar B, Prakadan SM, Wadsworth MH, et al. Dissecting the multicellular ecosystem of metastatic melanoma by single-cell RNA-seq. *Science* 2016. doi:10.1126/science.aad0501 — verified (corpus)
R6. Satija R, Farrell JA, Gennert D, Schier AF, Regev A. Spatial reconstruction of single-cell gene expression data. *Nature Biotechnology* 2015. doi:10.1038/nbt.3192 — verified (corpus)
R7. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R8. Andreatta M, Carmona S. UCell: robust and scalable single-cell gene signature scoring. *Computational and Structural Biotechnology Journal* 2021. doi:10.1016/j.csbj.2021.06.043 — verified (corpus)
R9. Aibar S, González-Blas CB, Moerman T, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — verified (corpus)
R10. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R11. Kunes RZ, Walle T, Pe'er D, et al. Supervised discovery of interpretable gene programs from single-cell data. *Nature Biotechnology* 2023. doi:10.1038/s41587-023-01940-3 — verified (corpus)
R12. Krishnaswami SR, Grindberg RV, Novotny M, et al. Using single nuclei for RNA-seq to capture the transcriptome of postmortem neurons. *Nature Protocols* 2016. doi:10.1038/nprot.2016.015 — verified (corpus)
R13. Ding J, Adiconis X, Simmons SK, et al. Systematic comparison of single-cell and single-nucleus RNA-sequencing methods. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0465-8 — verified (corpus)
R14. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/satijalab/seurat | Seurat authors (LICENSE copyright 2021); further contributors in DESCRIPTION | MIT + file LICENSE | AddModuleScore conventions and control sampling | port |
| https://github.com/scverse/scanpy | scverse (LICENSE copyright 2025); copyright 2017 F. Alexander Wolf, P. Angerer, Theis Lab (LICENSE) | BSD-3-Clause (LICENSE; pyproject) | score_genes conventions; regress_out | port |
| https://github.com/carmonalab/UCell | Massimo Andreatta and Santiago Carmona (DESCRIPTION) | GPL-3 (LICENSE file is the GPL v3 text; DESCRIPTION: GPL-3 + file LICENSE) | UCell ranks, maxRank and tie conventions | reimplement |
| https://github.com/aertslab/AUCell | Sara Aibar and Stein Aerts (DESCRIPTION); Gert Hulselmans (maintainer, DESCRIPTION) | GPL-3 in DESCRIPTION; no LICENSE file at the root; scRNA-tools lists "Custom"; the README calls the GitHub repository development code and names Bioconductor as the stable release | AUCell recovery curve and truncation | reimplement |
| https://github.com/dpeerlab/spectra | Russell Z. Kunes, Thomas Walle, Dana Pe'er laboratory (LICENSE.md) | MIT (LICENSE.md; pyproject) | Supervised gene-program comparator for section 5 | callout |
| https://github.com/Oshlack/splatter | Zappia L, Phipson B, Oshlack A (README citation) | GPL-3 + file LICENSE (DESCRIPTION; LICENSE file GPL v3) | Simulator for B2 | callout |
