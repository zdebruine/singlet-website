---
id: cell-state.cell_cycle_phase_assignment
title: Discrete cell-cycle phase assignment
area: cell-state
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [harmonization.gene_identifier_mapping, normalization.size_factor_estimation, qc.low_quality_cell_detection]
feeds: [covariate-adjustment.cell_cycle_effect_removal]
reads: [layers/counts, layers/lognorm, uns/cc_gene_sets]
writes: [obs/S_score, obs/G2M_score, obs/cyclone_G1, obs/cyclone_G2M, obs/cc_phase]
devices: [cpu, cuda]
mcp_tool: singlet_cell_state_cell_cycle_phase_assignment
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Discrete cell-cycle phase assignment

> Assigns each cell to G1, S or G2M from its own transcriptome, with the scores behind the label and an explicit Undecided value; it does not estimate continuous cycle position or remove the cycle effect.

## 1. Question

Which discrete cell-cycle phase, G1, S or G2M, does each cell occupy, given only its transcriptome? The input is a count or log-normalised matrix plus S-phase and G2M-phase gene lists for the organism. The output is one categorical label per cell, with the scores that produced it. A correct answer agrees with the phase that an orthogonal reporter or sort assigned to the same cell, measured on cells that were not used to build the gene lists or pair tables.

## 2. Why this task matters and where the field stands

Phase labels are used to regress proliferation out of expression, to stratify cells before differential testing and to check whether a population is cycling. The integration benchmark in scIB includes a cell-cycle conservation metric, which asks whether this variation survives batch correction [R10]. The module-score callers use S-phase and G2M lists derived from Tirosh et al. [R1]. Those lists are human, and mouse analyses map symbols by capitalisation.

Two heuristic rules dominate practice. Seurat and scanpy compare each cell's S and G2M module scores with control genes matched on expression [R2][R3], then apply a phase rule; they differ on ties, default phase and control sampling. The reference-pair classifier cyclone compares marker-pair orderings against a permutation null [R4]. ccAFv2 is a neural classifier with a quiescent class [R7]. tricycle [R5] and peco [R6] estimate a continuous angle that can be cut into phases, but neither method defines the cut-points.

The task is **contested**. The rules disagree on ties and defaults. Neither dominant rule has a quiescent state, so G0 cells are forced into G1. The relative accuracy of these callers is unknown, because no benchmark with numerical accuracy against reporter or sorted labels is available to this document. Open problems are listed in section 10.

## 3. Theory and insight

### 3.1 Estimands and normalisation

Each cell $c$ has an unobserved phase $y_c\in\{\mathrm{G1},\mathrm{S},\mathrm{G2M}\}$. The callers compute scores and apply a rule; none fits $y_c$ by likelihood. The quantities and their normalisation are:

- $m^{S}_c$ and $m^{\mathrm{G2M}}_c$: module scores, the mean expression of a phase list minus the mean of matched control genes, in the units of the input layer, with no further scaling.
- $p_{c,k}\in[0,1]$: for phase $k$, the share of informative marker pairs whose first gene is higher; tied pairs are excluded.
- $q_{c,k}\in[0,1]$: the cyclone score, the empirical null probability that a shuffled proportion falls below $p_{c,k}$.
- $\hat y_c$: a categorical label from a fixed rule, with no normalisation.
- $y^{*}_c$ (ground truth): the reporter gate or sort population of the cell in its source study, a categorical value with no normalisation; reporter thresholds define it.
- $\pi_{c,k}$ (proposed model only): the posterior probability of phase $k$, summing to one over $k$.

The module score is

$$m^{S}_c=\frac{1}{|S|}\sum_{g\in S}x_{gc}-\frac{1}{|C_S|}\sum_{g\in C_S}x_{gc},$$

where $C_S$ holds controls drawn from the expression bins of $S$, and $m^{\mathrm{G2M}}_c$ is defined the same way. The scanpy rule assigns G1 if both scores are negative, G2M if $m^{\mathrm{G2M}}_c>m^{S}_c$, and S otherwise. The Seurat rule assigns G1 if both are negative, otherwise the phase of the larger score, and Undecided on an exact tie.

Cyclone uses

$$p_{c,k}=\frac{\#\{(i,j)\in P_k:x_{ci}>x_{cj}\}}{\#\{(i,j)\in P_k:x_{ci}\neq x_{cj}\}},\qquad q_{c,k}=\frac{1}{B_c}\sum_{b=1}^{B}\mathbf 1\{p^{(b)}_{c,k}<p_{c,k}\},$$

where $P_k$ is the reference pair set for phase $k$, $p^{(b)}_{c,k}$ is the proportion after shuffling the cell's values, and $B_c$ counts valid shuffles. A cell is S if both $q_{c,\mathrm{G1}}$ and $q_{c,\mathrm{G2M}}$ are below 0.5, G1 if $q_{c,\mathrm{G1}}\geq q_{c,\mathrm{G2M}}$, and G2M otherwise. The proportion is missing when fewer than `min_pairs` informative pairs remain.

The regime is as follows. The sign of $x_{ci}-x_{cj}$ does not change when a cell is multiplied by a positive constant, so $p_{c,k}$ is exactly invariant to per-cell scaling, whereas $m^{S}_c$ is not. The Monte Carlo error of $q_{c,k}$ is $\sqrt{q(1-q)/B}$, at most 0.016 at $B=1000$.

### 3.2 Sparsity

Under Poisson sampling with mean $\lambda_g$ per cell, gene $g$ is zero with probability $e^{-\lambda_g}$. When most phase genes have $\lambda_g\ll1$, module scores are averages dominated by zeros, and both the score and its control matching are noisy. In that regime cyclone's missing-score rule also applies.

### 3.3 Assumptions and failure modes

- Cycle genes are co-regulated and are not markers of cell type. Cyclins and other cycle genes have roles outside proliferation, so G1 and G2M calls can track lineage or treatment.
- Reference lists are human. Mouse mapping by capitalisation is an approximation, and the orthology of phase genes is not validated.
- Quiescent cells have no label of their own. Module-score rules place G0 cells in G1.
- The three labels bin a continuum. There is no M state, so G2 and M cells share the G2M label.
- Reporter gates define the ground truth. A caller that copies a gate threshold scores better than its biological accuracy warrants.

### 3.4 Why heuristics work, and what a model adds

Averaging co-regulated genes gives a stable score, and matching controls on expression removes the level effect. Pair orderings remove scale. Neither returns a probability, and the Seurat Undecided value is a tie rule, not an uncertainty. A fitted categorical model returns posteriors, can abstain above a stated threshold, learns from reference cells across studies and can be checked by calibration error. Its cost is an independence assumption.

### 3.5 Proposed model

PROPOSED:

$$P(y_c=k\mid x_c)\propto\pi_k\prod_g\mathrm{NB}\!\left(x_{gc}\mid s_c\,\mu_{gk},\,\phi_g\right),$$

with phase prior $\pi_k$, per-gene phase means $\mu_{gk}$, size factors $s_c$ from normalisation and gene dispersions $\phi_g$. Parameters are fitted by EM on reference cells whose phase comes from a reporter or a sort, drawn from studies that contain no test set. The regime is conditional independence of genes given phase. Co-regulated gene sets violate it, so posteriors will be overconfident unless calibrated, and calibration is checked on held-out studies (B1).

The pitfalls above come from method code and documentation. No benchmark with numerical results is available to this document.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Seurat CellCycleScoring | heuristic | Module scores against expression-matched controls; sign and argmax rule, Undecided on ties | [R2] |
| scanpy score_genes_cell_cycle | heuristic | Same control scheme; S by default, G2M above S, G1 when both negative | [R3] |
| cyclone (scran) | model-based | Ordered marker pairs with per-cell permutation nulls | [R4] |
| tricycle | model-based | Projection onto a reference cycle embedding; continuous angle | [R5] |
| peco | model-based | Cyclic regression on FUCCI-anchored angles; continuous angle | [R6] |
| ccAFv2 | model-based | Neural classifier with seven states, including Neural G0 | [R7] |

The Seurat and scanpy module-score rules are the defaults of the two dominant toolkits and serve here as the heuristic standard. cyclone is the reference-pair standard, and its permutation loop is the dominant cost. tricycle and peco produce continuous angles and enter only as comparators after binning. ccAFv2 is the only caller with a quiescent class. Revelio is excluded because its phase-assignment rule is not stated in the material read (section 10). Continuous-position tools belong to cell-state.cell_cycle_position_estimation.

| Method | Parameter | Value | Source (file:line, repository @ revision) |
|---|---|---|---|
| Seurat CellCycleScoring | `nbin` | 24 | `R/utilities.R:179` (seurat @ 5f67c701) |
| Seurat CellCycleScoring | `ctrl` | 100 in AddModuleScore; smallest list length when NULL | `R/utilities.R:180`, `:660-661` |
| Seurat CellCycleScoring | `seed` | 1 | `R/utilities.R:184` |
| Seurat CellCycleScoring | tie rule | Undecided | `R/utilities.R:681-682` |
| scanpy score_genes_cell_cycle | `ctrl_size` | smaller list length in the wrapper; 50 in score_genes | `src/scanpy/tools/_score_genes.py:362`, `:102` (scanpy @ 8ed52d9d) |
| scanpy score_genes_cell_cycle | `n_bins` | 25 | `_score_genes.py:104` |
| scanpy score_genes_cell_cycle | `ctrl_as_ref` | True (ScanpyV1), False (ScanpyV2Preview) | `src/scanpy/_settings/presets.py:266-267` |
| scanpy score_genes_cell_cycle | phase rule | S default; G2M above S; G1 when both negative | `_score_genes.py:368-374` |
| cyclone (scran) | `iter`, `min.iter`, `min.pairs` | 1000, 100, 50 | `R/cyclone.R:115` (scran @ 569d2f89) |
| cyclone (scran) | phase calls | G1 if G1 ≥ G2M, else G2M; S if both < 0.5 | `R/cyclone.R:175-176` |
| tricycle | `center.pc1`, `center.pc2` | 0 | `R/estimate_cycle_position.R:83` (tricycle @ 74e8d15f) |
| ccAFv2 | `variable_genes` | 1000 | `README.md` (ccAFv2 @ 1d6a7728) |
| rapids-singlecell | `ctrl_size` | 50 | `src/rapids_singlecell/tools/_score_genes.py:36` |

## 5. Proposed singlet approach

Routes. `score_genes` is ported from scanpy's cell-cycle function and `seurat_score` from Seurat's CellCycleScoring rule, including its tie handling, with their notices kept. `cyclone_pairs` is reimplemented from the section 3 equations and uses pair tables built from reference cells. tricycle, peco and ccAFv2 are callouts used only as comparators.

Candidate model. The NB model of section 3.5 is fitted by EM on reference cells from studies disjoint from every test set, with posteriors temperature-scaled on a held-out study. It abstains (Undecided) when the largest posterior is below 0.5 (PROPOSED). It enters the method enum only if it meets B1 and has an expected calibration error of at most 0.05 on held-out studies (PROPOSED). It is falsified if it does not exceed the best heuristic on macro-F1 on both B1 test sets.

ML stack. The heuristic scores are sparse products over the phase lists followed by per-cell reductions, so they are hard-coded on CPU and use cuSPARSE on CUDA. The NB posterior adds a dense reduction over all genes for zero counts, with a sparse sweep over non-zero entries on the same kernels. EM and temperature scaling use PyTorch. The permutation null stays exact rather than learned, so its Monte Carlo error is known.

Streaming and devices. Module scores need two sweeps over row blocks, first for the gene means used in binning and then for per-cell scores. Cyclone's per-cell permutations are parallel over cells, with random streams derived from `seed`, so results do not depend on thread count. Devices are cpu and cuda.

Catalogue use. Catalogue cells carry no known phase labels, so they serve as unlabelled robustness input, and training uses only reporter- or sort-labelled reference sets.

Defaults for an agent. Use `method` score_genes, set `organism` to the dataset's species, keep `gene_sets` tirosh, `seed` 0 and `device` auto. Use cyclone_pairs only when layers/counts exists and a pair table is supplied. Do not use this tool for continuous position or to regress the cycle out of expression.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts; cyclone_pairs only |
| read | layers/lognorm | sparse float | log-normalised values; score_genes and seurat_score |
| read | uns/cc_gene_sets | list | optional custom S and G2M lists, used when gene_sets names a uns key |
| write | obs/S_score | float32 | S module score in input units; score methods only |
| write | obs/G2M_score | float32 | G2M module score in input units; score methods only |
| write | obs/cyclone_G1 | float32 | cyclone score in [0,1]; cyclone_pairs only |
| write | obs/cyclone_G2M | float32 | cyclone score in [0,1]; cyclone_pairs only |
| write | obs/cc_phase | categorical | G1, S, G2M or Undecided; all methods |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "score_genes" | `score_genes`, `seurat_score`, `cyclone_pairs` | Phase rule. score_genes is the default. seurat_score applies Seurat's tie rule. cyclone_pairs needs raw counts and a pair table. |
| `organism` | string | "human" | `human`, `mouse` | Selects the built-in gene panel. Mouse symbols are mapped by capitalisation, an approximation of orthology. |
| `gene_sets` | string | "tirosh" | — | Built-in Tirosh S and G2M lists (tirosh), or a uns key holding custom S and G2M gene lists. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Seed for control-gene sampling and cyclone permutations. Fix it for reproducible labels. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing cc_phase, score and cyclone members instead of failing. |
| `score_genes` | object | — | — | Options for method score_genes (scanpy rule). Ignored by other methods. |
| `score_genes.ctrl_size` | integer/null | null | min 1 | Control genes per expression bin. Null uses the smaller of the two list lengths. |
| `score_genes.n_bins` | integer | 25 | min 2 | Number of expression bins for control-gene matching. |
| `score_genes.ctrl_as_ref` | boolean | true | — | Draw controls from the full gene pool (ScanpyV1 preset); false follows ScanpyV2Preview. |
| `seurat_score` | object | — | — | Options for method seurat_score (Seurat tie rule). |
| `seurat_score.n_bins` | integer | 24 | min 2 | Expression bins for control matching, as in Seurat AddModuleScore. |
| `seurat_score.ctrl_size` | integer/null | null | min 1 | Control genes per bin. Null uses the smaller of the two list lengths. |
| `cyclone_pairs` | object | — | — | Options for method cyclone_pairs (permutation-null pair classifier). |
| `cyclone_pairs.pairs` | string | — | — | Uns key holding phase pair tables for G1, S and G2M. Required for this method. |
| `cyclone_pairs.iter` | integer | 1000 | min 1 | Permutation shuffles per cell and phase. |
| `cyclone_pairs.min_iter` | integer | 100 | min 1 | Minimum valid shuffles needed for a cell score. |
| `cyclone_pairs.min_pairs` | integer | 50 | min 1 | Minimum informative pairs per phase; below this the score is missing. |
| `cyclone_pairs.s_threshold` | number | 0.5 | min 0; max 1 | Both G1 and G2M scores below this value give phase S. |
<!-- PARAMS:AUTO:END -->

Parameters are scoped by method. The `score_genes`, `seurat_score` and `cyclone_pairs` objects apply only to their own method, and a parameter given for another method is an error. `seed` controls control-gene sampling for the score methods and permutations for cyclone_pairs. `pairs` is required when method is cyclone_pairs. `organism` selects only the built-in panel; a custom `gene_sets` key is used as supplied. Undecided is written when a rule cannot assign a phase: a tie for seurat_score, or a missing cyclone score.

## 7. MCP tool

Tool name `singlet_cell_state_cell_cycle_phase_assignment` (definition in `tasks/mcp/singlet_cell_state_cell_cycle_phase_assignment.json`). Example call and result, with illustrative values rather than data:

```json
{"dataset": "pbmc.singlet", "method": "score_genes", "organism": "human", "seed": 0}
```

```json
{
  "dataset": "pbmc.singlet",
  "status": "completed",
  "wrote": ["obs/S_score", "obs/G2M_score", "obs/cc_phase"],
  "summary": {"method": "score_genes", "organism": "human", "n_cells": 5000, "phase_counts": {"G1": 3000, "S": 1000, "G2M": 800, "Undecided": 0}, "undecided_fraction": 0.0},
  "provenance_id": "example"
}
```

Long-running: cyclone_pairs at atlas scale may queue and return a job_id, while score_genes executes inline. Stochastic: yes, through the seeded control sampling and permutations. Dry-run mode returns time and memory estimates from cell and gene counts, without writing.

## 8. Benchmarks

Shared protocol. All methods read the same cells, the same gene universe and the same symbol mapping; genes missing from the matrix are dropped and their count is reported. Undecided and missing outputs count as incorrect and are reported as a fraction. Scanpy results use the ScanpyV1 preset unless stated, and cyclone uses iter 1000, min_iter 100 and min_pairs 50. Stochastic methods use five seeds. Confidence intervals are bootstrap intervals over cells (1000 resamples), and comparisons are paired against the best comparator on the same cells.

### B1. Phase concordance with reporter-gated or sorted labels

- **Goal**: how well each caller recovers reporter-gated or sorted G1, S and G2M labels.
- **Ground truth**: orthogonal measurement. The label is each cell's reporter-gate or sort membership in its source study, categorical and unnormalised. GSE64016 is excluded, since scran's human pairs were built from its labels.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| GSE121265, FUCCI imaging with scRNA-seq | GEO GSE121265; CNGB PRJNA496506 (https://db.cngb.org/data_resources/project/PRJNA496506) | scRNA-seq, iPSC, species per source | — | FUCCI intensity |
| Buettner phase-sorted mouse ESC | [R8]; BuettnerESCData (OSCA) | scRNA-seq, mouse ESC, — | — | FACS phase populations |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Macro-F1 | Mean over the three labels of 2PR/(P+R); undecided and missing cells count as errors | maximise | primary | — |
| Cohen's kappa | (p_o − p_e)/(1 − p_e); undecided as an extra predicted category | maximise | primary | — |
| Balanced accuracy | Mean per-class recall | maximise | guardrail | — |
| ECE | 10 equal-width bins of the largest posterior; candidate only | minimise | guardrail | — |
| Depth ratio | Macro-F1 after binomial thinning to 25% of UMIs, over full-depth macro-F1; five seeds | maximise | guardrail | — |

- **Comparators**: score_genes (both presets), seurat_score, cyclone_pairs with scran's organism pairs, tricycle and peco cut into three equal arcs at 12 offsets (median reported), and ccAFv2 collapsed to G1 = {Neural G0, G1, Late G1}, S = {S}, G2M = {S/G2, G2/M, M/Early G1} (PROPOSED).
- **Protocol**: no reference or pair table is built from these test sets, as far as their sources show (section 10).
- **Acceptance criterion**: PROPOSED. On each test set the best caller reaches macro-F1 of at least 0.75 and kappa of at least 0.6, and no comparator is more than 0.05 below the best on macro-F1.
- **Known pitfalls**: reporter gates define the labels, and G0 cells sit in the G1 gate, so results should be stratified by reporter intensity.

### B2. Planted-phase simulation

- **Goal**: whether each caller recovers planted phases across sequencing depths with a fixed gene panel.
- **Ground truth**: planted simulation. The generator's phase variable is exact and unnormalised.
- **Generator** (PROPOSED settings):
  1. Genes: the 43 S-phase and 54 G2M-phase human genes of the scib resource lists, plus 2,000 background genes.
  2. Background means log-uniform on [0.05, 5], shared across phases.
  3. Multiply S-list genes by 4 in S cells, and G2M-list genes by 4 in G2M cells.
  4. Phase frequencies 0.5 G1, 0.25 S and 0.25 G2M.
  5. Size factors log-uniform on [0.5, 2]; counts from a negative binomial with mean $s_c\mu_{gk}$ and dispersion 0.1.
  6. Binomial thinning to 1,000, 3,000 and 10,000 UMIs per cell; 5,000 cells; five seeds per depth.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated phase counts | generator above | simulated counts, 2,097 genes, 5,000 cells | — | five seeds, three depths |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Macro-F1 | As in B1, against the planted phase | maximise | primary | — |
| Kappa | As in B1, against the planted phase | maximise | primary | — |
| Depth slope | Absolute slope of macro-F1 against log10 depth; median over seeds | minimise | guardrail | — |

- **Comparators**: score_genes and seurat_score. cyclone_pairs is excluded, because its pairs would be circular here (section 10).
- **Protocol**: identical counts for every caller and seed, with the human panel.
- **Acceptance criterion**: PROPOSED. Macro-F1 is reported at each depth, and any caller below 0.6 at the middle depth is flagged.
- **Known pitfalls**: planted phases are cleaner than real cycle programmes and can inflate scores. Dropout changes with depth in this generator and is not varied separately.

### P1. Performance and scaling

Wall time, peak memory and cells per second at 10^4, 10^5, 10^6 and 10^7 cells, with the 10^7 scale applied to CPU streaming paths only, on CPU and CUDA, with the full transcriptome and with the 97-gene panel. Comparators: scanpy score_genes_cell_cycle (CPU), Seurat CellCycleScoring (CPU, R), scran cyclone at iter 1000 and iter 100, and rapids-singlecell score_genes_cell_cycle (GPU). Hold fixed the gene panel, the control size (set explicitly, because rapids-singlecell's default differs), bins, cyclone iter and min_iter, thread count, sparse CSR format, seed and hardware. Report the log-log slope of time against cells. Acceptance (PROPOSED): singlet's CPU score path has a slope between 0.9 and 1.1 and is at least twice as fast as scanpy at 10^6 cells. GPU results are reported separately.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
- **Feeds**:
  - `covariate-adjustment.cell_cycle_effect_removal`: Cell-cycle effect removal
- **Reads**: `layers/counts`, `layers/lognorm`, `uns/cc_gene_sets`
- **Writes**: `obs/S_score`, `obs/G2M_score`, `obs/cyclone_G1`, `obs/cyclone_G2M`, `obs/cc_phase`
<!-- CHAINING:AUTO:END -->

No named recipe includes this task yet. It follows normalisation and QC, and precedes cell-cycle effect removal.

## 10. Risks, pitfalls and open questions

- **Dataset gaps.** The GSE121265 source article is unread, and its species and cell count (888, from a web result) rest on that single result. A web result attributes a related FUCCI iPSC study to John CR, Blischak JD and Gilad Y, and its link to GSE121265 is unresolved. The BuettnerESCData accession and sort gates are not identified. LengESCData's accession is not identified, and whether it is the GSE64016 data, the human pair source, is unresolved [R9]. The FUCCI U2OS and RPE1 figshare sets from the velocity benchmark README have no checked phase labels, so they are not used.
- **Method gaps.** The peco article's authors come from its README, which names Genome Biology as the venue; the DOI prefix and a web result give Genome Research. The ccAFv2 preprint's authors come from its code headers, and its holdout results and label origin are unread, so ccAFv2 is a comparator only. The scIB cell-cycle metric's OpenProblems datasets are not listed in the configuration read, so it is not a benchmark here. The sandbag() pair rule and the bundled pair tables are unread. The mouse pair source may overlap the Buettner set, so that overlap cannot be excluded. Revelio's phase-assignment rule is not stated in its README or tutorial, so the method is not benchmarked.
- **Unsettled literature.** No caller models quiescence except ccAFv2, whose quiescent class has no reporter validation in the material read. No benchmark with numerical results compares these callers against reporter or sorted labels. Angle-to-phase cut-points have no standard, so every continuous comparator carries a free parameter, which B1 reports across offsets.
- **Technical and licence risks.** Reimplementing cyclone avoids the GPL-3 code, but the bundled pair tables ship with the GPL-3 package and must be rebuilt from reference cells. The revisions in section 4 are live HEAD values, and the corpus copies have no git metadata, so line references refer to the corpus snapshot. The rapids-singlecell phase rule is unread, so only its control default is used, for timing.
- **Thresholds and mappings.** Every acceptance threshold in section 8, the abstention threshold, the calibration limit and the ccAFv2 collapse are PROPOSED values without literature support. Two test sets are a small basis for accepting a method, so any first decision needs replication on a third study.
- **First experiment.** Apply score_genes, seurat_score and cyclone_pairs to the two B1 test sets with pinned presets and seeds, and record the undecided and missing fractions. Only then train the candidate model on study-disjoint splits.

## 11. References

R1. Tirosh I, Izar B, Prakadan SM, et al. Dissecting the multicellular ecosystem of metastatic melanoma by single-cell RNA-seq. *Science* 2016;352(6282):189-196. doi:10.1126/science.aad0501 — partial (corpus)

R2. Satija R, Farrell JA, Gennert D, Schier AF, Regev A. Spatial reconstruction of single-cell gene expression data. *Nature Biotechnology* 2015;33:495-502. doi:10.1038/nbt.3192 — partial (corpus)

R3. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — partial (corpus)

R4. Scialdone A, Natarajan KN, Saraiva LR, et al. Computational assignment of cell-cycle stage from single-cell transcriptome data. *Methods* 2015;85:54-61. doi:10.1016/j.ymeth.2015.06.021 — partial (corpus)

R5. Zheng SC, Stein-O'Brien G, Augustin JJ, et al. Universal prediction of cell-cycle position using transfer learning. *Genome Biology* 2022;23:41. doi:10.1186/s13059-021-02581-y — partial (repo)

R6. Hsiao CJ, Tung P, Blischak JD, Burnett J, Dey KK, Barr AK, Stephens M, Gilad Y. Characterizing and inferring quantitative cell cycle phase in single-cell RNA-seq data analysis. *Genome Research* 2020;30(4):611-621. doi:10.1101/gr.247759.118 — partial (repo)

R7. Plaisier C, O'Connor S. Breaking out of the cycle: Including quiescence in cell cycle classification. Preprint, 2024. doi:10.1101/2024.04.16.589816 — partial (corpus)

R8. Buettner F, Natarajan KN, Casale FP, et al. Computational analysis of cell-to-cell heterogeneity in single-cell RNA-sequencing data reveals hidden subpopulations of cells. *Nature Biotechnology* 2015;33(2):155-160. doi:10.1038/nbt.3102 — partial (corpus)

R9. Leng N, Chu LF, Barry C, et al. Oscope identifies oscillatory genes in unsynchronized single-cell RNA-seq experiments. *Nature Methods* 2015;12(10). doi:10.1038/nmeth.3549 — partial (corpus)

R10. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022;19:41-50. doi:10.1038/s41592-021-01336-8 — partial (repo)

## 12. Code and software cited

Routes: **port** copies code under a permissive licence with its notice; **reimplement** writes the method from the equations in section 3 without copying code; **callout** uses the tool only as a comparator.

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | scverse maintainers (pyproject metadata) | BSD-3-Clause (LICENSE) | score_genes_cell_cycle reference and ScanpyV1 preset | port |
| https://github.com/satijalab/seurat | Seurat authors (LICENSE copyright) | MIT (LICENSE) | CellCycleScoring reference | port |
| https://github.com/MarioniLab/scran | Marioni lab (GitHub organisation) | GPL-3 (DESCRIPTION; no LICENSE file at root) | cyclone reference and bundled pair tables | reimplement |
| https://github.com/hansenlab/tricycle | Shijie Zheng (aut, cre; DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file at root) | continuous-angle comparator | callout |
| https://github.com/jhsiao999/peco | Chiaowen Joyce Hsiao (author), John Blischak (contributor) (DESCRIPTION) | GPL (>= 3) (DESCRIPTION) | continuous-angle comparator | callout |
| https://github.com/plaisier-lab/ccAFv2 | Chris Plaisier and Samantha O'Connor (code headers) | GPL-3 (LICENSE) | seven-state comparator | callout |
| https://github.com/theislab/scib | scIB authors (README citation [R10]) | MIT (LICENSE.txt) | Tirosh-derived S and G2M lists (43 and 54 human genes; 97 mouse rows) | port (lists with attribution) |
| https://github.com/scverse/rapids-singlecell | Severin Dicks (LICENSE copyright) | MIT (LICENSE) | GPU timing comparator | callout |
