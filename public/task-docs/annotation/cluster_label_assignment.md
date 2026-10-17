---
id: annotation.cluster_label_assignment
title: Cluster-level cell type label assignment
area: annotation
scope: core
paradigm: heuristic
literature_status: contested
priority: P0
depends_on: [clustering.cell_partitioning, markers-de.cluster_marker_ranking]
feeds: [annotation.cell_ontology_mapping, annotation.annotation_confidence_calibration, annotation.cross_dataset_label_reconciliation]
reads: [layers/counts, X, obs/<cluster_key>, uns/<marker_table>]
writes: [obs/cluster_label, obs/cluster_label_score, obs/cluster_label_flag, uns/cluster_label_clusters, uns/cluster_label_params]
devices: [cpu, cuda]
mcp_tool: singlet_annotation_cluster_label_assignment
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Cluster-level cell type label assignment

> Assigns one cell-type label, with a score, ranked alternatives and a called or unknown flag, to each cluster of an existing partition from its marker statistics or pseudobulk profile.

## 1. Question

Given a fixed partition of cells into clusters, which cell type best describes each cluster from its marker statistics or aggregated expression, and when is the evidence too weak to call a type? Inputs are the count and log-normalised matrices, the cluster labels, and a marker table or labelled reference restricted to tissue and species. Outputs are one label per cluster, a method-specific score, ranked alternatives and a called or unknown flag. A correct answer names the type holding most of the cluster's cells in the reference truth; Unknown counts as wrong in the benchmarks.

## 2. Why this task matters and where the field stands

Atlases are usually annotated cluster by cluster, and every cell inherits its cluster's label, so a cluster-level error propagates to all of its cells. Manual annotation from marker dot plots is the reference practice, but its choice of markers is subjective, and guidelines cover both automated and manual annotation [R1]. Automated labellers replace the marker choice with a tissue marker table and a scoring rule. Their status is **contested**: the field disagrees on how marker evidence should be scored, and the label vocabulary depends on the marker source, such as PanglaoDB [R2] or CellMarker [R3].

Open problems:

- **Partition dependence.** A label is only as good as the partition. Doublets, ambient RNA and cell-cycle or activation programmes produce mixed clusters that receive one label, and over-clustering splits one type across several labels.
- **Invalid statistics.** Marker tests that treat cells as independent after the clusters were formed from the same data are anti-conservative [R4]. Pseudobulk tests are a recommended remedy [R5]. A comparison of marker-gene selection methods is available as a preprint [R6].
- **Scoring rules without calibration.** The heuristics convert evidence to a ranking by different rules. None returns a posterior, so none provides a principled abstention threshold.
- **Evaluation.** A cluster-level comparison of label-assignment methods has been published [R7], but its protocol is not stated here (section 10). The comparison by Abdelaal et al. is cell-level and answers a different question [R8].

## 3. Theory and insight

Let $c$ index clusters, with cell sets $\mathcal{C}_c$ and sizes $n_c$; $t$ index types in the marker table; $g$ index genes; and $j$ index cells. None of the heuristics fits a generative model of cluster identity. Each defines a score $S_{t,c}$, calls its arg maximum, and most add a fallback rule. Their scores are not likelihoods, so none yields a posterior.

scType standardises each gene across cells to $z_{gj}$, weights positive markers by specificity $\omega_g=(N-c_g)/(N-1)$, where $c_g$ counts the marker sets containing $g$ and $N$ is the number of sets, and sums per-cell evidence:

$$ES_{t,j}=\frac{\sum_{g\in P_t}\omega_g\,z_{gj}}{\sqrt{|P_t|}}+\frac{\sum_{g\in N_t}(-z_{gj})}{\sqrt{|N_t|}}$$

with $P_t$ and $N_t$ the positive and negative markers of $t$. The cluster score $S_{t,c}=\sum_{j\in\mathcal{C}_c}ES_{t,j}$ is a sum over cells and therefore grows with $n_c$. The Unknown rule $\max_t S_{t,c}<n_c/4$ is equivalent to a threshold on the mean per-cell score. The weight multiplies the gene's whole row, so it also scales a negative term where that gene is a negative marker of another type. The $\sqrt{|P_t|}$ normalisation is a heuristic, not a likelihood ratio. Regime: the input must be standardised per gene, and the summed rule is not comparable across cluster sizes unless it is written as a mean.

scCATCH tests each gene in each cluster with a one-sided rank-sum test on cell-level values. With $n_1$ and $n_2$ cells in the two groups, $R_1$ the rank sum of the first group and $t_k$ the tie-group sizes,

$$z=\frac{R_1-\frac{n_1(n_1+1)}{2}-\frac{n_1n_2}{2}}{\sqrt{\frac{n_1n_2}{12}\Bigl(n_1+n_2+1-\frac{\sum_k(t_k^3-t_k)}{(n_1+n_2)(n_1+n_2-1)}\Bigr)}}$$

The surviving genes are matched to a marker database, and each candidate type is scored by $s_t=\sqrt{a_tb_t}$, where $a_t=n_t/(n_t+1)$ smooths the number of matched marker rows and $b_t=m_t/(m_t+1)$ smooths the number of distinct supporting references. The geometric mean rewards well-studied types, and the smoothing has no probabilistic meaning. Regime: the normal approximation needs large $n_1$ and $n_2$. Cell-level p-values computed after clustering are not valid frequentist p-values [R4].

Marker genes are often thresholded at a false discovery rate $q$ with the step-up adjustment $q_{(i)}=\min_{k\ge i}\min\bigl(1,\,m\,p_{(k)}/k\bigr)$ [R9]. This controls the false discovery rate under independence or positive dependence of the tests. It does not correct cell-level tests whose clusters were chosen from the same data.

SingleR in cluster mode sums counts within each cluster, correlates the profile with reference profiles, aggregates the correlations by a quantile, and re-scores the leading labels in a fine-tuning round. Summing rather than averaging makes the profile depend on cluster size and depth, so it is comparable with reference profiles only when both share one normalisation. scmap-cluster matches each query cluster to the most similar reference cluster in a feature-selected index and leaves the cluster unassigned when the similarity is low.

Two evaluation quantities are used. The adjusted Rand index compares two partitions of the same $n$ cells, with $n_{ij}$ the contingency counts and $a_i$, $b_j$ the margins [R10]:

$$\mathrm{ARI}=\frac{\sum_{ij}\binom{n_{ij}}{2}-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}}{\frac{1}{2}\bigl[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}\bigr]-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}}$$

It guards partition agreement and is not a score for a cluster-to-label mapping. The support-weighted F1 is $F_{1,w}=\sum_\ell \frac{s_\ell}{\sum_{\ell'}s_{\ell'}}\,\frac{2P_\ell R_\ell}{P_\ell+R_\ell}$, where $s_\ell$ is the support of label $\ell$, counted in clusters or in cells; the unit is stated with every value [R11].

A likelihood-based formulation adds what the heuristics lack: a posterior over types, a margin between the top two types, and an abstention rule whose threshold can be calibrated on held-out studies. It also lets the marker table enter as a prior rather than a hard set, and it accepts covariates such as study and donor. The closest published probabilistic assigner, CellAssign, works on cells rather than clusters [R12]. No cluster-level probabilistic label model is established in the literature cited here.

The approach assumes that each cluster approximates one type or state, that the marker table contains the present types with correct signs, that markers are detectable in aggregated profiles, and that the label vocabularies can be mapped. Failure modes are these. Mixed clusters take one label for cells of several types. Over-clustering splits a type across several labels or Unknown, and under-clustering lets the dominant marker win. Scale dependence favours large clusters and well-studied types. scType down-weights markers shared across types. Fixed thresholds return Unknown for clean clusters with modest marker signal. No benchmark cited here establishes a ranking among these heuristics. The scType cost is a marker-entry sum for each cell followed by per-cluster sums, linear in the marker entries times the cell count.

**Estimands.** Each quantity is defined as follows.

- Cluster label $\hat t_c$: the type with the largest method score for cluster $c$. It estimates the type holding most of the cells of $c$ in the reference, with no probability attached.
- Score and margin: the method's own statistic for $\hat t_c$ and its gap to the second type, in the method's units (for scType, singlet reports the mean per-cell score).
- Cluster accuracy: the unweighted fraction of non-mixed clusters for which $\hat t_c$ equals the reference majority type; Unknown is wrong.
- Cell-weighted accuracy: the same indicator weighted by $n_c/\sum_{c'} n_{c'}$ over non-mixed clusters.
- Truth purity: the share of a cluster's cells in its majority reference type. A cluster is mixed when purity is below the threshold given in B1 and B2.
- Abstention rate: the fraction of all clusters returned Unknown, mixed clusters included.

## 4. Methods landscape

The published standard for automated cluster labelling is a family of marker-scoring heuristics. The four below are listed with their defaults read from source at the commits in the defaults table. Manual expert annotation is the reference practice for section 8 but has no code, so it is not listed as a method. No probabilistic cluster-level method is listed because none is established (section 3).

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scType | heuristic | Weights positive tissue markers by specificity, penalises negative markers, sums standardised per-cell evidence over each cluster, and calls the top type or Unknown. | [R13] |
| scCATCH | heuristic | Finds cluster markers with cell-level one-sided rank tests and scores candidate types by smoothed marker and reference counts. | [R14] |
| SingleR, cluster mode (legacy) | heuristic | Sums counts per cluster, correlates the profile with reference profiles, aggregates correlations by quantile, and refines the leading labels. | [R15] |
| scmap-cluster | heuristic | Matches each query cluster to the most similar reference cluster in a feature-selected index and leaves it unassigned below a similarity threshold. | [R16] |

Defaults, taken from the source at the commit shown:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| scType | `scaled`, default of `sctype_score` | TRUE (written `!0`) | R/sctype_score_.R:12 @ 630e15c |
| scType | `scaled` passed by `run_sctype` in both branches | TRUE whatever `data_type` is, so `sctype_score` never standardises; `scaled = FALSE` passes raw counts | R/sctype_wrapper.R:80, :94 @ 630e15c |
| scType | Unknown call | cluster sum below n/4 (mean per cell below 0.25) | R/sctype_wrapper.R:105 @ 630e15c |
| scType | marker specificity weight | rescale of marker-set counts to [0,1] from c(length(gs), 1) | R/sctype_score_.R:25 @ 630e15c |
| scCATCH | `cell_min_pct`, `logfc` | 0.25, 0.25 | R/methods.R:53 @ 06c6ffb |
| scCATCH | `pvalue` (raw, not adjusted) | 0.05 | R/methods.R:54 @ 06c6ffb |
| scCATCH | marker test | one-sided Wilcoxon rank-sum test on cell-level values; genes kept when the raw p-value is below `pvalue` (R/utils.R:151) | R/utils.R:131 @ 06c6ffb |
| SingleR (cluster) | `quantile.use` | 0.8 (signature; the roxygen text at R/SingleR.R:184 says 0.9) | R/SingleR.R:194 @ 0ad570e |
| SingleR (cluster) | `fine.tune`, `fine.tune.thres` | TRUE, 0.05 | R/SingleR.R:193-197 @ 0ad570e |
| SingleR (cluster) | cluster aggregation | `rowSums` of counts (sum, not mean) | R/SingleR.R:251 @ 0ad570e |
| scmap-cluster | `threshold` | 0.7 | R/AllGenerics.R:96-97 @ 88515b5 |

## 5. Proposed singlet approach

**Routes.** The four heuristics are reimplemented from their documented rules, not ported from upstream source (section 12); upstream packages serve only as benchmark comparators. The model below is new work.

**Default.** scType is the default: its scoring maps onto one sparse product, and its decision rule is explicit. singlet changes three things: standardisation is always per gene, never a hard-coded flag; the Unknown rule uses the mean per-cell score, which removes the dependence on cluster size; and the marker table is checked for signs and tissue before scoring.

**Model-based candidate (not in the enum until it passes B1).** For cluster $c$ with pseudobulk counts $y_c$, library size $s_c$, and type $t$ with marker sign $M_{tg}\in\{-1,0,1\}$, the proposed model is

$$y_{cg}\mid t\sim\mathrm{NB}\bigl(\mu_{cgt},\phi_g\bigr),\qquad \log\mu_{cgt}=\log s_c+\beta_g+\lambda M_{tg}+\delta_{tg},\qquad p(t\mid y_c)\propto\pi_t\prod_g p(y_{cg}\mid t),$$

with $\delta_{tg}$ a learned type signature shrunk towards zero, $\lambda$ the strength of the marker prior, $\pi_t$ the type prior, and $\beta_g,\phi_g$ per-gene terms. It is fitted by EM or amortised variational inference on pseudobulks grouped by study, donor and annotated cluster. Its output is the posterior, the margin, and an abstention rule that flags a cluster when its maximum posterior falls below a threshold chosen on held-out studies to a stated coverage.

**What would falsify it.** The model replaces scType as the default only if, on B1, its cluster accuracy beats the best heuristic by the B1 acceptance margin at matched abstention, and its posteriors are calibrated on held-out studies. If either fails, the heuristic default stays.

**Stack and kernels.** PyTorch for the EM-with-gradients fit and any amortised encoder. Hard-coded CUDA with cuSPARSE for the scoring path, which is a sparse marker-by-gene product and a softmax over the gene-by-type matrix; both are small, hot kernels. CPU kernels are sparse group-by aggregation, per-gene standardisation and the marker product. Standardisation (per-gene means and variances) and pseudobulk sums both stream over cell chunks, so the cell matrix need not be resident.

**Agent defaults.** Method scType, tissue set to the organ, marker_table left null, and the parameter defaults in section 6.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts for pseudobulk sums and library sizes |
| read | X | float32 | log-normalised values for marker detection and per-gene standardisation |
| read | obs/<cluster_key> | category | the partition; one label per distinct value |
| read | uns/<marker_table> | table | marker rows with type, gene, sign (positive or negative), tissue and species |
| write | obs/cluster_label | category | the cluster's label broadcast to its cells; Unknown when not called |
| write | obs/cluster_label_score | float32 | the top-type score of the cluster, broadcast to its cells, in the method's units |
| write | obs/cluster_label_flag | category | called or unknown |
| write | uns/cluster_label_clusters | table | one row per cluster: n_cells, top1_label, top1_score, margin, ranked alternatives, flag |
| write | uns/cluster_label_params | dict | method, parameter values and marker-table version |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `cluster_key` | string | "leiden" | — | obs column holding the cluster partition to label; each cluster receives one label. |
| `method` | string | "scType" | `scType`, `scCATCH`, `singler_cluster`, `scmap_cluster` | Labelling method; scType is the default, the others are comparators for benchmarking. |
| `tissue` | string/null | null | — | Tissue matched against the marker table; required for scType and scCATCH with the shipped table. |
| `marker_table` | string/null | null | — | uns key of the marker table with type, gene, sign, tissue and species columns; null uses the method's shipped table. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `scType` | object | — | — | Options for method scType. |
| `scType.unknown_mean_score` | number | 0.25 | min 0 | Mean per-cell score below which a cluster is Unknown; scale-free form of the n/4 rule. |
| `scCATCH` | object | — | — | Options for method scCATCH. |
| `scCATCH.cell_min_pct` | number | 0.25 | min 0; max 1 | Minimum fraction of cluster cells expressing a marker. |
| `scCATCH.logfc` | number | 0.25 | min 0 | Minimum cluster-versus-rest log fold change. |
| `scCATCH.pvalue` | number | 0.05 | min 0; max 1 | Marker p-value cutoff. |
| `scCATCH.pvalue_adjust` | string | "none" | `none`, `bh` | none reproduces scCATCH; bh applies Benjamini-Hochberg across genes. |
| `singler_cluster` | object | — | — | Options for method singler_cluster. |
| `singler_cluster.reference` | string | — | — | Reference handle with labelled profiles; required for this method. |
| `singler_cluster.quantile_use` | number | 0.8 | min 0; max 1 | Quantile used to aggregate reference correlations for each cluster. |
| `singler_cluster.fine_tune_thres` | number | 0.05 | min 0 | Score gap for keeping labels in the fine-tuning round. |
| `singler_cluster.aggregation` | string | "mean_normalised" | `mean_normalised`, `sum_counts` | sum_counts reproduces legacy SingleR cluster mode; mean_normalised is the singlet default. |
| `scmap_cluster` | object | — | — | Options for method scmap_cluster. |
| `scmap_cluster.reference` | string | — | — | Reference handle with an scmap cluster index; required for this method. |
| `scmap_cluster.threshold` | number | 0.7 | min 0; max 1 | Similarity below which a cluster is unassigned. |
<!-- PARAMS:AUTO:END -->

Method options sit in nested objects and apply only to their method; tissue and marker_table apply to scType and scCATCH. singler_cluster and scmap_cluster need a reference handle and are rejected without one. For scType, unknown_mean_score is a mean over cells, so the same value gives the same call for clusters of any size. The marker table is validated before scoring: required columns must be present, and genes absent from the dataset are dropped with a count recorded in uns/cluster_label_params. Any change of method or parameter changes the labels, so existing members are replaced only with overwrite set.

## 7. MCP tool

Tool name `singlet_annotation_cluster_label_assignment` (definition in `tasks/mcp/singlet_annotation_cluster_label_assignment.json`). Example call and compact result; values in angle brackets are placeholders.

```json
{"dataset": "/data/example.singlet", "cluster_key": "leiden", "method": "scType", "tissue": "Lung", "device": "auto", "dry_run": false}
```

```json
{"dataset": "/data/example.singlet", "status": "completed",
 "wrote": ["obs/cluster_label", "obs/cluster_label_score", "obs/cluster_label_flag", "uns/cluster_label_clusters", "uns/cluster_label_params"],
 "summary": {"method": "scType", "n_clusters": "<n>", "n_called": "<n>", "n_unknown": "<n>", "median_margin": "<float>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: runs inline for typical inputs; a large input returns status queued with a job_id. Stochastic: no; the same partition, marker table and parameters give the same labels. Dry run: returns status dry_run with estimated seconds, peak memory and device, and writes nothing.

## 8. Benchmarks

**Shared protocol.** Reference and predicted labels are mapped to Cell Ontology terms before scoring, with the mapping fixed beforehand (see annotation.cell_ontology_mapping). Each method runs with its section 4 defaults and tissue set to the organ, on the dataset's own partition, the same log-normalised gene set and one marker-table version. Unknown calls count as wrong in accuracy and are reported as abstention. The unit for every summary is an organ within an atlas, and intervals are bootstraps over those units.

### B1. Expert-label cluster benchmark on expert-annotated atlases (proposed)

- **Goal**: measure subtype-level agreement of cluster labels with expert cluster types.
- **Ground truth**: expert labels. The reference type of a cluster is its majority expert cell label; the cluster is mixed when that majority covers less than 0.8 of its cells (threshold proposed). The mixed share is reported with every result.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Tabula Sapiens | [R17]; — | scRNA-seq, human, multiple organs; size — | — | expert cell labels; check per-organ availability |
| Tabula Muris | [R18]; — | scRNA-seq, mouse, 20 organs; size — | — | mouse side; study-level holdout |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| cluster_accuracy | Fraction of non-mixed clusters whose label matches the reference type after Cell Ontology mapping; Unknown is wrong | maximise | primary | [R11] |
| cell_weighted_accuracy | cluster_accuracy weighted by cell count | maximise | primary | [R11] |
| weighted_f1 | Support-weighted F1 over types, support in clusters; repeated with cells | maximise | guardrail | [R11] |
| abstention_rate | Fraction of all clusters, mixed included, returned Unknown | report | guardrail | — |
| cell_level_ARI | ARI of broadcast predicted labels against expert cell labels, all cells | maximise | guardrail | [R10] |

- **Comparators**: scType, scCATCH, singler_cluster, scmap_cluster, and a majority-label baseline.
- **Protocol**: the atlas's own partition; resolution is studied only in B2. Pseudobulks use raw counts. Summaries are means over organ-atlas units with bootstrap 95% intervals; trained comparators are evaluated leave-one-study-out.
- **Acceptance criterion** (proposed): a new method beats the best heuristic comparator on cluster_accuracy by at least 0.02 averaged over units, with the bootstrap interval excluding zero, and an abstention rate below 0.20.
- **Known pitfalls**: (1) Expert labels built from the same markers the scoring methods use would inflate agreement. (2) A majority truth hides two-type clusters, so the mixed count is reported, not dropped.

### B2. Planted-type simulation with clustering-resolution sweep (proposed)

- **Goal**: measure how cluster accuracy depends on clustering resolution when true types are known.
- **Ground truth**: planted simulation. A cluster's truth is its majority group; clusters below 0.8 purity are mixed and excluded (threshold proposed).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated groups (recipe below) | [R19] (Splatter) | simulated counts; size per recipe | — | generated; no accession |

- **Recipe** (proposed):
  1. Draw $K\in\{5,10,20\}$ groups of 1,000 cells each, with seeds 1 to 5.
  2. Fit Splatter's library-size and dropout parameters to one B1 organ chosen before scoring; simulate group-specific differential expression on 5% of genes.
  3. Take each group's 20 most up-regulated genes as positive markers, giving $M_{\mathrm{true}}$.
  4. Corrupt $M_{\mathrm{true}}$: replace 20% of each type's markers with random non-marker genes, and give 20% of types one shared marker, yielding $M_c$.
  5. Draw an independent same-group reference for scmap_cluster and singler_cluster.
  6. Convert $M_c$ to each comparator's format; set tissue to the simulated label.
  7. Cluster the test cells with Leiden [R20] on a PCA of highly variable log-normalised genes at resolutions 0.2, 0.5, 1.0, 1.5 and 2.0 (default 1.0).
  8. Score every partition with each method. Noise-free variant: skip step 4.
- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| cluster_accuracy_at_resolution | Per resolution on the grid, non-mixed clusters matching the planted majority group; at 1.0 and best-to-default gap | maximise | primary | [R11] |
| partition_ARI | ARI of cell-level clusters against planted groups | maximise | guardrail | [R10] |

- **Comparators**: scType, scCATCH, singler_cluster, scmap_cluster.
- **Protocol**: five seeds per K; medians with ranges, and the full resolution curve.
- **Acceptance criterion** (proposed): accuracy at resolution 1.0 of at least 0.90 on the noise-free simulation; best-to-default gap below 0.05.
- **Known pitfalls**: (1) Simulated markers are cleaner than real ones; the corruption step is required before reporting. (2) Library size can separate groups without biology; inspect per-group marker specificity.

### P1. Performance and scaling

Wall time and peak memory of the labelling step alone, excluding clustering, normalisation and reference building, at $10^4$, $10^5$ and $10^6$ cells with 10, 50 and 200 clusters (proposed grid), on CPU and on CUDA where implemented. Comparators are scType, scCATCH with its DE stage reported separately (its per-gene tests scale with genes times cluster pairs, derived from the code and not measured), singler_cluster, scmap_cluster and the proposed implementation. Hold fixed the input representation, thread count, marker-table version and partition, and report the median and interquartile range over five repeats.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
- **Feeds**:
  - `annotation.cell_ontology_mapping`: Cell type name harmonization to Cell Ontology terms
  - `annotation.annotation_confidence_calibration`: Annotation and label-transfer confidence calibration and abstention
  - `annotation.cross_dataset_label_reconciliation`: Cross-dataset cell-type label reconciliation
- **Reads**: `layers/counts`, `X`, `obs/<cluster_key>`, `uns/<marker_table>`
- **Writes**: `obs/cluster_label`, `obs/cluster_label_score`, `obs/cluster_label_flag`, `uns/cluster_label_clusters`, `uns/cluster_label_params`
<!-- CHAINING:AUTO:END -->

The catalogue entry assigns this task to no named workflow.

## 10. Risks, pitfalls and open questions

- **Diaz-Mejia et al.** ([R7]) is the only published cluster-level comparison identified for this task. Its datasets, metrics and results are not stated here, and it does not appear as a benchmark in section 8. The DOI given is that of version 3 of the F1000Research article; an earlier version covered a narrower method set, so the version read must be named. Its protocol must be read in full before any reuse.
- **Methods known only from their READMEs.** CellAssign, Garnett, SCINA and SCSA are excluded from section 4 and from the MCP enum, because only their READMEs and package metadata have been examined, not their code. CellAssign [R12] is the closest published probabilistic comparator and is cell-level, so the model-based benchmark cannot yet use it.
- **Legacy and unread parameter sources.** The SingleR values come from its legacy repository, whose README says it is no longer maintained; the maintained Bioconductor release, whose licence is not stated here, may differ. The scmap-cluster threshold semantics are read from R/CoreMethods.R:364. Splatter default parameters are not used, because B2 fits its own.
- **Data gaps.** No CITE-seq dataset has been identified, so the surface-protein benchmark, with gating rules fixed before scoring, is not defined here. Licences, accessions and sizes for Tabula Sapiens and Tabula Muris are not stated here and must be checked before reuse. Subtype-level inter-annotator agreement for these atlases is unknown, so B1 has no human ceiling.
- **Technical and literature risks.** scType's source hard-codes `scaled = TRUE` on both calls (section 4), so the reimplementation must standardise per gene itself, and comparator runs must use the upstream defaults. The heuristics depend on the marker source, and this document does not quantify how far CellMarker and PanglaoDB disagree. The guideline content attributed to Clarke et al. ([R1]) is taken from its title and index records, not the full text. Cost statements for scType and scCATCH are derived from code and not timed.
- **First experiment.** Run the four heuristics with the section 4 defaults on the uncorrupted B2 simulation and on the B1 organs of one atlas, and confirm that the reimplementation reproduces the upstream labels on identical inputs. Begin the model only if this check passes.

## 11. References

R1. Clarke ZA, Andrews TS, Atif J, et al. Tutorial: guidelines for annotating single-cell transcriptomic maps using automated and manual methods. *Nature Protocols* 2021;16:2749–2764. doi:10.1038/s41596-021-00534-0 — partial (search)

R2. Franzén O, Gan LM, Björkegren JLM. PanglaoDB: a web server for exploration of mouse and human single-cell RNA sequencing data. *Database* 2019. doi:10.1093/database/baz046 — verified (corpus)

R3. Zhang X, Lan Y, Xu J, et al. CellMarker: a manually curated resource of cell markers in human and mouse. *Nucleic Acids Research* 2019. — verified (corpus)

R4. Zhang JM, Kamath GM, Tse DN. Valid post-clustering differential analysis for single-cell RNA-seq. *Cell Systems* 2019. doi:10.1016/j.cels.2019.07.012 — verified (corpus)

R5. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)

R6. Pullin JM, McCarthy DJ. A comparison of marker gene selection methods for single-cell RNA sequencing data. *bioRxiv* 2022 (preprint). doi:10.1101/2022.05.09.490241 — verified (corpus)

R7. Diaz-Mejia JJ, Meng EC, Pico AR, et al. Evaluation of methods to assign cell type labels to cell clusters from single-cell RNA-sequencing data. *F1000Research* 2019;8:296. doi:10.12688/f1000research.18490.3 — partial (search)

R8. Abdelaal T, Michielsen L, Cats D, et al. A comparison of automatic cell identification methods for single-cell RNA sequencing data. *Genome Biology* 2019. doi:10.1186/s13059-019-1795-z — verified (corpus)

R9. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)

R10. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)

R11. Grandini M, Bagli E, Visani G. Metrics for multi-class classification: an overview. *arXiv* 2020. doi:10.48550/arxiv.2008.05756 — verified (corpus)

R12. Zhang AW, O'Flanagan C, Chavez EA, et al. Probabilistic cell-type assignment of single-cell RNA-seq for tumor microenvironment profiling. *Nature Methods* 2019. doi:10.1038/s41592-019-0529-1 — verified (corpus)

R13. Ianevski A, et al. Fully-automated and ultra-fast cell-type identification using specific marker combinations from single-cell transcriptomic data. *Nature Communications* 2022. doi:10.1038/s41467-022-28803-w — verified (corpus)

R14. Shao X, et al. scCATCH: automatic annotation on cell types of clusters from single-cell RNA sequencing data. *iScience* 2020. doi:10.1016/j.isci.2020.100882 — verified (corpus)

R15. Aran D, et al. Reference-based analysis of lung single-cell sequencing reveals a transitional profibrotic macrophage. *Nature Immunology* 2019. doi:10.1038/s41590-018-0276-y — verified (corpus)

R16. Kiselev VY, et al. scmap: projection of single-cell RNA-seq data across data sets. *Nature Methods* 2018. doi:10.1038/nmeth.4644 — verified (corpus)

R17. Jones RC, Karkanias J, Krasnow MA, et al. The Tabula Sapiens: a multiple-organ, single-cell transcriptomic atlas of humans. *Science* 2022. doi:10.1126/science.abl4896 — verified (corpus)

R18. Schaum N, Karkanias J, Neff NF, et al. Single-cell transcriptomics of 20 mouse organs creates a Tabula Muris. *Nature* 2018. doi:10.1038/s41586-018-0590-4 — verified (corpus)

R19. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)

R20. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/IanevskiAleksandr/sc-type | Aleksandr Ianevski (author line in the R/sctype_score_.R header; no package metadata) | GPL-3.0 (LICENSE file) | scType reference implementation | reimplement; callout for comparator runs |
| https://github.com/ZJUFanLab/scCATCH | Xin Shao (Author and Maintainer, DESCRIPTION) | GPL (>= 3) per DESCRIPTION; GPL-3.0 (LICENSE.md) | scCATCH reference implementation | reimplement; callout for comparator runs |
| https://github.com/dviraran/SingleR | Dvir Aran (Author and Maintainer, DESCRIPTION) | GPL-3.0 (LICENSE file and DESCRIPTION) | legacy cluster-mode implementation | reimplement; callout for comparator runs (legacy code) |
| https://github.com/hemberg-lab/scmap | Vladimir Kiselev (Author and Maintainer, DESCRIPTION) | GPL-3 (LICENSE file and DESCRIPTION) | scmap-cluster reference implementation | reimplement; callout for comparator runs |
