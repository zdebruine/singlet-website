---
id: grn.multiome_egrn_inference
title: Enhancer-driven eGRN inference from paired scRNA and scATAC (multiome)
area: grn
scope: core
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [qc.low_quality_cell_detection, normalization.size_factor_estimation, annotation.cluster_label_assignment]
feeds: [grn.tf_activity_scoring, grn.differential_grn_rewiring, grn.consensus_edge_aggregation, grn.in_silico_tf_perturbation]
reads: [layers/<layer>, layers/<atac_layer>, uns/peaks, uns/motif_db, obs/<cell_type_key>]
writes: [uns/egrn/<method>/region_gene_links, uns/egrn/<method>/tf_region_motifs, uns/egrn/<method>/eregulons, obsm/egrn_activity, models/egrn_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_grn_multiome_egrn_inference
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Enhancer-driven eGRN inference from paired scRNA and scATAC (multiome)

> Link accessible enhancers, their TF motifs and their target genes from paired RNA and ATAC data, and return signed eRegulons with per-cell activity; the default method reports FDR-adjusted interaction p-values.

## 1. Question

Given RNA counts and a peak-by-cell ATAC matrix measured on the same cells, a peak set, gene annotations and a versioned motif database, which accessible regions carrying which TF motifs link each TF to which target genes, and what is each eRegulon's activity in each cell? The outputs are region-gene links, TF-region motif assignments, signed eRegulons (TF, region set, target genes) and a cells-by-eRegulons activity matrix. A correct answer is a set of hypotheses that predicts held-out region-level or perturbation-level evidence, not a single network.

## 2. Why this task matters and where the field stands

Paired multiome data measure accessibility and expression in the same cells, so regions can be linked to genes and TFs to regions within one dataset [R10, R7]. The resulting networks are hypotheses, and they differ between methods [R7]. Status: **contested**. Methods differ in how they score region-gene links, by boosted importance times correlation in SCENIC+ [R1] or by a per-gene regression in Pando [R4], and in how they require motif support [R1, R4]. A 2024 comparison reports that networks change with random seeds, preprocessing and paired versus unpaired input, and that they predict perturbation responses poorly [R5]. Open problems:

- A motif shows that a TF could bind a region, not that it does, and no method here measures binding in the same cells [R7].
- Observational data do not identify causal direction, so perturbation predictions are weak [R5].
- Region-gene links are limited to a fixed genomic window, so distal enhancers outside it are missed.
- No accepted benchmark with region-level truth exists; the comparison in [R5] is the closest published one.

## 3. Theory and insight

A multiome eGRN is the chain TF to motif-bearing accessible region to target gene, and three links are estimated separately: motif presence (potential binding only), region-gene association within a window, and TF-region-gene coupling from a regression or enrichment statistic. Region-gene links combine proximity with correlation, and TF-region links require a motif [R7]. In the chapter's PBMC example, only 4 of 115 inferred links are in CollecTRI, a prior-knowledge network, so unvalidated links are weak evidence [R7].

Region-gene score in SCENIC+ [R1]:

$$s_{g,r}=I_{g,r}\,\rho_{g,r}$$

$I_{g,r}$ is the boosted-tree importance of region $r$ for gene $g$, and $\rho_{g,r}$ is the Spearman correlation across cells; the method also outputs $I_{g,r}\,|\rho_{g,r}|$. Regime: many cells, with regions inside the search window. The sign of $\rho$ gives activating or repressive direction.

Motif enrichment in SCENIC+ [R1, R2]:

$$\mathrm{NES}_{t,m}=\frac{\mathrm{AUC}_{t,m}-\mu_{\mathrm{null}}}{\sigma_{\mathrm{null}}}$$

The recovery AUC of motif $m$ for TF $t$ in the top-ranked regions, standardised against random region sets. Regime: rank-based, so invariant to monotone rescaling of accessibility, but dependent on the rank cut-off and background.

Ridge regression in CellOracle [R3]:

$$\hat\beta_g=\arg\min_{\beta}\ \lVert y_g-X_{\mathrm{TF}}\beta\rVert_2^2+\alpha\lVert\beta\rVert_2^2$$

Fitted per cluster with bagging, where $X_{\mathrm{TF}}$ holds expression of motif-supported TFs. Regime: linear within a cluster; sparsity comes mainly from the ATAC-derived base network, not from the penalty.

Interaction GLM in Pando [R4]:

$$\phi\big(\mathbb{E}[y_{gc}]\big)=\beta_{g0}+\sum_{(t,r)\in\mathcal{S}_g}\beta_{g,tr}\,x_{tc}\,a_{rc}$$

$x_{tc}$ is TF expression and $a_{rc}$ peak accessibility in cell $c$; $\mathcal{S}_g$ holds the TF-region pairs that pass the correlation filters, and $\phi$ is the link. The interaction term and scaling follow the source arguments (section 10). With a zero correlation threshold, every peak with nonzero correlation enters, so fit size is set by the motif map.

Estimands, one sentence each:

- Region-gene score $s_{g,r}$: an importance-weighted correlation across cells between region accessibility and gene expression, unitless, compared within a gene.
- Motif assignment: a binary TF-region indicator at the motif p-value cut-off in section 4.
- eRegulon weight and sign: the signed edge weight, with sign from $\rho$ for SCENIC+ and from $\beta_{g,tr}$ for Pando.
- eRegulon activity: per cell, the recovery AUC in $[0,1]$ of the eRegulon's targets among that cell's top-ranked genes, as in the AUCell design [R2].
- Pando coefficient $\beta_{g,tr}$: change in the linear predictor of gene $g$ per unit of the standardised product $x_{tc}a_{rc}$, with a p-value adjusted by FDR across the gene's terms.

Regime of validity: the correlation and regression statements are first order, holding for monotone association and many cells mixed across types. Sparse counts produce ties, which make Spearman coarse. The Gaussian GLM approximates count data; the AUC is a rank statistic and tolerates scale differences.

Failure modes:

- Cell-type confounding: pooled correlations create links that vanish within a type; fit within type or on pseudo-cells.
- Sparse ATAC: per-cell accessibility is noisy, so aggregation changes the link set.
- Window bias: long windows add false positives; short windows miss distal enhancers.
- Motif ambiguity: TFs with similar motifs share regions, so eRegulon membership is not unique.
- Seed and preprocessing dependence [R5]: a single fit overstates confidence.

A model-based formulation adds a fitted likelihood per gene, giving per-edge p-values and FDR control; the fitted model can be reused on new cells, and batch or cell type enter as explicit terms. Stable output is not correct output, so stability needs a truth-based benchmark (section 8).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| SCENIC+ | hybrid | Region-to-gene scores from boosted importance and Spearman correlation within a window, combined with cisTarget motif enrichment into eRegulons with activity scores. | [R1], [R2] |
| CellOracle | hybrid | A motif-scanned base network from accessible peaks, refined by per-cluster bagged ridge regression and used for in silico gene perturbation. | [R3] |
| Pando | model-based | A per-gene GLM over TF-region interaction terms, with modules selected by an R-squared threshold and FDR-adjusted interaction p-values. | [R4] |

SCENIC+ and Pando are the published standards for enhancer-driven eRegulons and for an explicit per-gene model. CellOracle contributes the ATAC-informed base network and the regression that refines it. [R6] reviews the family. The defaults below are those in the source at the stated commits.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| SCENIC+ | search_space_upstream, search_space_downstream | "1000 150000" (both) | src/scenicplus/snakemake/config.yaml:59-60 @840dab8 |
| SCENIC+ | search_space_extend_tss | "10 10" | config.yaml:61 @840dab8 |
| SCENIC+ | importance_scoring_method | GBM | src/scenicplus/enhancer_to_gene.py:244 @840dab8 |
| SCENIC+ | correlation_scoring_method | SR (Spearman) | enhancer_to_gene.py:246 @840dab8 |
| SCENIC+ | GBM_KWARGS | learning_rate 0.01; n_estimators 500; max_features 0.1 | enhancer_to_gene.py:60-63 @840dab8 |
| SCENIC+ | region-gene score columns | importance × rho; importance × abs(rho) | enhancer_to_gene.py:295-298 @840dab8 |
| SCENIC+ | ctx_auc_threshold / ctx_nes_threshold / ctx_rank_threshold | 0.005 / 3.0 / 0.05 | src/scenicplus/wrappers/run_pycistarget.py:29-31 @840dab8 |
| SCENIC+ | auc_threshold (eRegulon enrichment) | 0.05 | src/scenicplus/eregulon_enrichment.py:86 @840dab8 |
| SCENIC+ | top_n_regionTogenes_per_gene | (5, 10, 15) | src/scenicplus/grn_builder/modules.py:503 @840dab8 |
| SCENIC+ | rho_threshold (RHO_THRESHOLD) | 0.03 | src/scenicplus/grn_builder/modules.py:18 @840dab8 |
| CellOracle | alpha (ridge penalty) | 10 | celloracle/network_analysis/network_construction.py:39 @7948870 |
| CellOracle | bagging_number; model_method | 20; bagging_ridge | network_construction.py:39 @7948870 |
| CellOracle | filter_links p | 0.001 | celloracle/network_analysis/links_object.py:119 @7948870 |
| CellOracle | threshold_number | 10000 | links_object.py:121 @7948870 |
| Pando | extend | 1000000 | R/grn.R:56 @25702c0 |
| Pando | tf_cor; peak_cor | 0.1; 0 | R/grn.R:59-60 @25702c0 |
| Pando | method | glm (first listed choice) | R/grn.R:63 @25702c0 |
| Pando | alpha; family; interaction_term; adjust_method | 0.5; gaussian; ":"; fdr | R/grn.R:64-67 @25702c0 |
| Pando | p_thresh; rsq_thresh; min_genes_per_module | 0.05; 0.1; 5 | R/grn.R:608-611 @25702c0 |
| Pando | motif p.cutoff | 5e-05 | R/motifmatchr_patched.R:146 @25702c0 |

## 5. Proposed singlet approach

- **Pando: port** under its permissive licence (section 12). The port keeps the per-gene interaction model, the module filter and the FDR control. Hard-coded CUDA or cuSPARSE kernels cover the sparse TF-by-peak products and least-squares solves.
- **SCENIC+: reimplement** from the documented behaviour, because its licence restricts reuse. Clean-room versions cover the region-to-gene scores, motif enrichment with NES, and eRegulon assembly.
- **CellOracle: callout**, as a benchmark comparator only.

The model-based formulation singlet proposes places a sparse horseshoe prior on the TF-region coefficients, so most $\beta_{g,tr}$ shrink towards zero, with motif support widening the prior for a pair. Each gene gets a negative-binomial GLM over counts, fitted by variational inference in PyTorch over minibatches of genes, and its outputs are per-edge posterior intervals that the heuristic scores do not give. Activity is scored the same way for both methods, from each eRegulon's targets.

Falsification: the variant replaces the port as default only if, on B1, its AUPRC exceeds the port's with non-overlapping intervals and its empirical false discovery proportion among null triples stays at or below 0.10 at nominal 0.05. Otherwise the port stays the default.

The stack is PyTorch for the variational model and hard-coded CUDA or cuSPARSE for the port's sparse products and solves. Core kernels are the sparse design products, per-gene least squares, Spearman ranks over cells, and motif-to-peak matching. Fits are independent across genes and parallelise on CPU and in GPU batches. The region-gene step needs all cells of a stratum, so the task is not streaming; pseudo-cell aggregation (scalability.metacell_construction) reduces cells before fitting.

Defaults an agent uses without asking: `method` pando, `cell_type_key` set so that fits run within type, and `motif_db` supplied explicitly because it is required. Use `dry_run` before any large input.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/<layer> | sparse int | RNA counts for the same cells as the ATAC layer |
| read | layers/<atac_layer> | sparse int | peak-by-cell accessibility counts |
| read | uns/peaks | table | peak coordinates and annotation |
| read | uns/motif_db | table | motif-to-TF map of the named, versioned collection |
| read | obs/<cell_type_key> | categorical | cell-type labels; optional, and fits are within type when set |
| write | uns/egrn/<method>/region_gene_links | table | region, gene, importance, rho, score |
| write | uns/egrn/<method>/tf_region_motifs | table | TF, region, motif match and p-value |
| write | uns/egrn/<method>/eregulons | table | TF, region set, target genes, weight, sign |
| write | obsm/egrn_activity | dense float32 | cells by eRegulons, per-cell activity in $[0,1]$ |
| write | models/egrn_<method> | model | per-gene fitted terms and adjusted p-values |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "pando" | `pando`, `scenic_plus` | eRegulon method: pando (interaction GLM, default) or scenic_plus (boosted importance with motif enrichment). |
| `layer` | string | "counts" | — | RNA count layer for expression; the method applies its own normalisation. |
| `atac_layer` | string | "atac_counts" | — | Peak-by-cell accessibility layer over the same cells as the RNA layer. |
| `cell_type_key` | string | "celltype" | — | obs key for cell-type labels; when present, fits run within each type. |
| `motif_db` | string | required | — | Versioned TF motif collection, for example a CIS-BP release. Required; sets the candidate TF-region pairs. |
| `pando` | object | — | — | Options used when method is pando. |
| `pando.extend_bp` | integer | 1000000 | — | Genomic window around each gene, in bp, within which candidate peaks are considered. |
| `pando.peak_cor` | number | 0 | — | Minimum absolute peak-gene correlation to keep a peak; zero keeps every nonzero correlation. |
| `pando.tf_cor` | number | 0.1 | — | Minimum absolute TF-gene correlation to keep a TF as a candidate regulator. |
| `pando.rsq_thresh` | number | 0.1 | — | R-squared threshold for keeping a gene module. |
| `pando.min_genes_per_module` | integer | 5 | — | Minimum number of genes per module. |
| `pando.p_adjust` | string | "fdr" | — | Multiple-testing adjustment for interaction p-values (p.adjust method). |
| `scenic_plus` | object | — | — | Options used when method is scenic_plus. |
| `scenic_plus.upstream_bp` | integer | 1000 | — | Upstream bound of the region search space, in bp. |
| `scenic_plus.downstream_bp` | integer | 150000 | — | Downstream bound of the region search space, in bp. |
| `scenic_plus.gbm_learning_rate` | number | 0.01 | — | Learning rate of the boosted importance model. |
| `scenic_plus.gbm_n_estimators` | integer | 500 | — | Number of boosting stages in the importance model. |
| `scenic_plus.gbm_max_features` | number | 0.1 | — | Fraction of features considered per split in the importance model. |
| `scenic_plus.ctx_auc_threshold` | number | 0.005 | — | AUC threshold for motif enrichment. |
| `scenic_plus.ctx_nes_threshold` | number | 3.0 | — | NES threshold for keeping an enriched motif. |
| `scenic_plus.ctx_rank_threshold` | number | 0.05 | — | Top fraction of regions used in the recovery AUC. |
| `scenic_plus.top_n_per_gene` | array | [5, 10, 15] | — | Number of top region-gene links kept per gene for eRegulon building. |
| `seed` | integer | 0 | — | Seed for the boosted importance model (scenic_plus only; the pando path is deterministic). |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

The `pando` object applies when `method` is `pando`, and `scenic_plus` applies when it is `scenic_plus`; the other is ignored. `seed` changes only the boosted importance model, so the default Pando path is deterministic. `motif_db` must name a versioned collection, for example CIS-BP [R8], because the motif-to-TF map sets the candidate pairs. `layer` and `atac_layer` must hold the same cells in the same order; mismatched identifiers are rejected. Window fields are method-specific and not comparable across methods.

## 7. MCP tool

Tool name `singlet_grn_multiome_egrn_inference` (definition in `tasks/mcp/singlet_grn_multiome_egrn_inference.json`). One example call and one compact result:

```json
{"dataset": "s3://example-bucket/multiome.singlet", "method": "pando", "cell_type_key": "celltype", "motif_db": "cis-bp:<release>"}
```

```json
{"dataset": "s3://example-bucket/multiome.singlet", "status": "completed",
 "wrote": ["uns/egrn/pando/region_gene_links", "uns/egrn/pando/tf_region_motifs", "uns/egrn/pando/eregulons", "obsm/egrn_activity", "models/egrn_pando"],
 "summary": {"method": "pando", "n_cell_types": "<int>", "n_region_gene_links": "<int>", "n_eregulons": "<int>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: full multiome inputs can exceed the inline limit, and the result is then `queued` with a `job_id`. Stochastic: only the `scenic_plus` path, through `seed`. Dry run: returns estimated seconds, peak memory and device without writing members.

## 8. Benchmarks

Every accuracy benchmark gives each method the same cells, peak set, motif collection version, cell-type labels and gene set (2,000 highly variable genes, as in the chapter [R7]), and one 150 kb window around the TSS (a design choice). Fits are stratified by cell type. Scores come from each method's own outputs, and a triple or edge absent from a method's output is ranked last. Ties are broken by a stable sort on the identifier. Area under the precision-recall curve uses the trapezoidal rule. Confidence intervals are 95% bootstrap intervals over the replicate unit named in each benchmark. Thresholds are design choices unless stated otherwise.

### B1. Planted-truth recovery on simulated paired multiome (proposed)

- **Goal**: recover planted TF-region-gene triples with calibrated false discoveries.
- **Ground truth**: planted simulation (generator G1). A triple's label is 1 if planted and 0 otherwise; the estimand is this indicator, unnormalised.
- **G1 generator** (proposed): (1) 5,000 cells in four types, Dirichlet(1, 1, 1, 1) proportions; (2) 1,000 peaks with type-specific accessibility, and 30 TFs whose motifs cover 5% of peaks each, fixed before simulation; (3) TF expression log-normal by type; (4) 60 planted triples, each adding $\beta\,x_{tc}a_{rc}$ to its gene's log-mean, $\beta\sim N(0,1)$; (5) negative-binomial counts with fixed dispersion. Negatives are other triples whose region carries the motif and lies within 150 kb of the gene.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G1 simulated multiome | simulation (design) | paired RNA and ATAC; 5,000 cells; 1,000 peaks; 30 TFs; 60 planted triples | — | 20 replicates |

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC against planted labels | Triples ranked by Pando adjusted p-value (ascending) or SCENIC+ $s_{g,r}$ in the TF's enriched set (descending) | max | primary | [R4], [R1] |
| Empirical false discovery proportion | Unplanted fraction among triples called at FDR 0.05, averaged over replicates | min | guardrail | — |

- **Comparators**: Pando port; SCENIC+ restricted to the TF's enriched regions; motif-window baseline (motif-bearing triples in the window, ranked by distance to the TSS).
- **Protocol**: the same object per replicate for every method; 1,000 bootstrap resamples over the 20 replicates.
- **Acceptance criterion** (proposed): the port's AUPRC is above the baseline with non-overlapping 95% intervals, and its false discovery proportion is at most 0.10 at nominal 0.05.
- **Known pitfalls**:
  1. G1 shares the port's model class, so passing shows consistency with that class, not biology; a second generator is needed.
  2. Triples sharing a motif are indistinguishable by construction; report AUPRC per motif family.

### B2. Perturb-seq consistency of eRegulon signs (proposed)

- **Goal**: test whether eRegulon signs predict the direction of target change under TF knockdown.
- **Ground truth**: interventional. For TF $t$ knocked down by CRISPRi, the observed log fold change of target $g$ (knockdown versus control, screen normalisation). The expected direction is $-\mathrm{sign}(w_{t,g})$ for signed eRegulon weight $w_{t,g}$.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Genome-scale CRISPRi Perturb-seq | [R9] | RNA readout; human; K562 | — | knockdown and control cells |
| Paired K562 multiome | — | paired RNA and ATAC; human; K562 | — | builds eRegulons in the same cell line (section 10) |

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Sign concordance | Fraction of pairs (significantly knocked-down TF, target in its eRegulon) with observed sign $-\mathrm{sign}(w_{t,g})$; significance from the screen's DE test at FDR 0.05 | max | primary | — |
| Spearman of $w_{t,g}$ with observed log fold change | Over the same pairs | max | guardrail | — |

- **Comparators**: Pando port; SCENIC+ eRegulon signs; random eRegulon of matched size (null).
- **Protocol**: significantly knocked-down TFs only; same cells and normalisation for all methods; 1,000 bootstrap resamples over TFs.
- **Acceptance criterion** (proposed): sign concordance exceeds the random-eRegulon null, one-sided permutation p below 0.05 across TFs.
- **Known pitfalls**:
  1. A TF can be downstream of its own targets, so the sign can reflect feedback.
  2. Low concordance is expected for observational networks [R5]; the null comparison matters more than the level.

### B3. Stability across seeds and cell subsamples (proposed)

- **Goal**: measure how reproducible eRegulon target sets and region-gene links are for the same input.
- **Ground truth**: consistency only. The estimand is the Jaccard overlap between two fits, on the top 10 targets per TF (10 for all methods) and on region-gene links above each method's default threshold.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G1 (B1) | simulation (design) | as in B1 | — | 5 seeds per method; 5 half-cell subsamples per seed |

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Mean pairwise Jaccard of top-10 target sets | Averaged over TFs and fit pairs; ties by gene id | max | primary | — |
| Region-link Jaccard across half-cell subsamples | Links above the default threshold | max | guardrail | — |

- **Comparators**: Pando port; SCENIC+.
- **Protocol**: Pando is deterministic, so its seed Jaccard is 1 by construction and subsample overlap carries the signal. Medians and interquartile ranges over the 20 B1 replicates.
- **Acceptance criterion** (proposed): median pairwise Jaccard above 0.5.
- **Known pitfalls**:
  1. A consistently wrong method is stable; pair this benchmark with B1.
  2. Half-cell subsamples lose power, so compare with full-data results as well as between subsamples.

### P1. Performance and scaling

Wall time and peak memory per stage (region-gene scoring, motif enrichment, TF-region assignment, fitting) at 5,000, 50,000 and 500,000 cells, and at 100,000 and 500,000 peaks (design choices, not from a published benchmark). Hold fixed: gene set, motif collection, window, one seed and CPU count. Comparators: SCENIC+ (CPU, fixed threads); Pando (R, parallel off and on); CellOracle get_links with bagging (callout); singlet CPU; singlet CUDA for the GLM and solve steps only. No timings are reported here.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Feeds**:
  - `grn.tf_activity_scoring`: Per-cell or per-sample TF activity scoring from a prior regulon network
  - `grn.differential_grn_rewiring`: Differential GRN, regulon and co-expression rewiring between conditions or cell types
  - `grn.consensus_edge_aggregation`: Consensus and stability-based aggregation of GRN edge predictions
  - `grn.in_silico_tf_perturbation`: In silico TF knockout or overexpression effect prediction from a GRN
- **Reads**: `layers/<layer>`, `layers/<atac_layer>`, `uns/peaks`, `uns/motif_db`, `obs/<cell_type_key>`
- **Writes**: `uns/egrn/<method>/region_gene_links`, `uns/egrn/<method>/tf_region_motifs`, `uns/egrn/<method>/eregulons`, `obsm/egrn_activity`, `models/egrn_<method>`
<!-- CHAINING:AUTO:END -->

Peak-to-gene linking (multimodal.peak_gene_linking) overlaps the region-gene step; this task is the eRegulon construction that consumes such links.

## 10. Risks, pitfalls and open questions

- **Evidence taken from summaries or unread sources**: the Pando equation (section 3) is the generic form; its interaction term and scaling come from the function arguments, not the function body. The NES formula follows the SCENIC design, not the cisTarget source. The GRETA findings come from its summary. FigR, GRaNIE, Cicero co-accessibility, Signac LinkPeaks, ArchR addPeak2GeneLinks, scMEGA and RNA-only SCENIC are absent from all tables and the enum, because their source was not read. The meaning of the SCENIC+ search-space pair has not been checked against the code.
- **Unsettled literature and missing truth sets**: no accepted benchmark with region-level truth exists, so B1 uses a proposed simulator. ChIP-seq and enhancer-CRISPRi truth sets are excluded because no dataset was identified for either; enhancer screens belong to perturbation.enhancer_gene_linking. B2 waits for a paired K562 multiome. The 4-of-115 figure comes from one PBMC example.
- **Technical and licence risks**: the SCENIC+ and CellOracle licences restrict reuse (section 12), which fixes their routes. The G1 simulator is not implemented, and dataset licences for B2 were not read. Window semantics differ by method (section 4), so comparisons need one shared window.
- **First experiment**: on G1 with zero planted triples, measure the port's false discovery proportion at nominal 0.05; then the B1 recovery curves; then B2 once a paired K562 multiome is chosen.

## 11. References

R1. Bravo González-Blas C, De Winter S, Hulselmans G, et al. SCENIC+: single-cell multiomic inference of enhancers and gene regulatory networks. *Nature Methods* 2023;20:1355–1367. doi:10.1038/s41592-023-01938-4 — verified (corpus)
R2. Aibar S, González-Blas CB, Moerman T, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — verified (corpus)
R3. Kamimoto K et al. Dissecting cell identity via network inference and in silico gene perturbation. *Nature* 2023. doi:10.1038/s41586-022-05688-9 — verified (corpus)
R4. Fleck JS, Jansen SMJ, Wollny D, et al. Inferring and perturbing cell fate regulomes in human brain organoids. *Nature* 2023;621:365–372. doi:10.1038/s41586-022-05279-8 — partial (repo)
R5. Badia-i-Mompel P, Casals-Franch R, Wessels L, et al. Comparison and evaluation of methods to infer gene regulatory networks from multimodal single-cell data. *bioRxiv* 2024. doi:10.1101/2024.12.20.629764 — verified (corpus)
R6. Badia-i-Mompel P, Wessels L, Müller-Dott S, et al. Gene regulatory network inference in the era of single-cell multi-omics. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00618-5 — verified (corpus)
R7. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R8. Weirauch MT, Yang A, Albu M, et al. Determination and inference of eukaryotic transcription factor sequence specificity. *Cell* 2014. doi:10.1016/j.cell.2014.08.009 — verified (corpus)
R9. Replogle JM, Saunders RA, Pogson AN, et al. Mapping information-rich genotype-phenotype landscapes with genome-scale Perturb-seq. *Cell* 2022. doi:10.1016/j.cell.2022.05.013 — verified (corpus)
R10. Cao J, Cusanovich DA, Ramani V, et al. Joint profiling of chromatin accessibility and gene expression in thousands of single cells. *Science* 2018. doi:10.1126/science.aau0730 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/aertslab/scenicplus | Seppe De Winter, Carmen Bravo (pyproject.toml) | Academic Non-commercial Software License Agreement (LICENCE.txt, VIB vzw) | eRegulon reference method: region-gene scores, motif enrichment, eRegulons | reimplement |
| https://github.com/morris-lab/CellOracle | Kenji Kamimoto (package __author__); copyright Kenji Kamimoto, Christy Hoffmann, Samantha Morris | modified Apache License 2.0 for non-commercial academic use only; commercial use requires contacting the Morris lab (LICENSE) | ATAC-informed base network and bagged ridge regression | callout |
| https://github.com/quadbiolab/Pando | Jonas Simon Fleck (author and maintainer, DESCRIPTION) | MIT (LICENSE and DESCRIPTION) | per-gene interaction GLM, modules and FDR control | port |
