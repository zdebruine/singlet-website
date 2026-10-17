---
id: abundance.hierarchical_composition_test
title: Resolution-robust composition testing across a cell-type hierarchy
area: abundance
scope: extended
paradigm: model-based
literature_status: open
priority: P2
depends_on: [qc.sample_level_qc, clustering.cell_partitioning, clustering.hierarchical_cluster_tree, annotation.hierarchical_annotation]
feeds: [statistics.multiple_testing_control, sample-level.multi_sample_power_analysis]
reads: [obs/<sample_key>, obs/<condition_key>, obs/<batch_key>, obs/leiden_res_<r>, obs/<annotation_keys>, uns/<tree_key>]
writes: [uns/hierarchical_composition/counts, uns/hierarchical_composition/nodes, uns/hierarchical_composition/stability, models/hierarchical_composition]
devices: [cpu, cuda]
mcp_tool: singlet_abundance_hierarchical_composition_test
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Resolution-robust composition testing across a cell-type hierarchy

> Test which nodes of a cell-type hierarchy change in relative abundance between conditions, using a tree-aggregated Dirichlet-multinomial model whose sparsity prior selects the level of each change, so that calls do not hinge on one clustering resolution.

## 1. Question

At which nodes of a cell-type hierarchy, built from clustering at several resolutions or from ordered author labels, do sample-level cell-type shares change between conditions? The inputs are sample-by-leaf counts and sample covariates. The outputs are node effects on the log-ratio scale to a reference leaf, with inclusion probabilities, FDR-controlled calls and a stability score across resolutions. A correct answer recovers planted node-level changes at the nominal false-call rate and gives the same calls at every resolution where the change is resolvable.

## 2. Why this task matters and where the field stands

Clustering resolution sets the units of a composition test. Splitting a lineage into finer clusters spreads one change over leaves that each fall below threshold, and merging can hide a leaf change inside a large cluster [R7, R8]. Shares are compositional, so a change in one type moves every other share, and ignoring this constraint can produce spurious abundance signals [R10]. Tree-aggregated and flat compositional models address known types [R1, R2, R10]; kNN neighbourhood methods are preferred when clusters are not distinct [R4, R10].

The status is **open**. When partitions from different resolutions are not nested, no single tree is defined; nested stochastic block models are one candidate hierarchy [R9]. No benchmark in the cited literature compares the resolution robustness of these methods [R7, R8]. No accepted measure of stability across call sets exists.

## 3. Theory and insight

### 3.1 Model and estimands

With leaf counts $y_s$ and total $n_s$ for sample $s$, covariates $x_s$ and reference leaf $r$, the tree-aggregated model is

$$y_s\sim\mathrm{DirMult}(n_s,c_s),\qquad c_{s,k}=\exp\Bigl(\alpha_k+\sum_j x_{sj}\beta_{jk}\Bigr),\qquad \beta_{j,r}=0.$$

Leaf effects are inherited from nodes, $\beta_{jk}=\sum_{v\in\mathrm{anc}(k)}b_{jv}$, or $\beta_{j\cdot}=A\,b_{j\cdot}$ with $A$ the leaf-by-node ancestor matrix [R1]. Node effects carry a spike-and-slab LASSO prior, $\tilde b_{jv}=(1-\theta)\sigma^{(0)}_{jv}z^{(0)}_{jv}+\theta\sigma^{(1)}_{jv}z^{(1)}_{jv}$, with $\theta$ fixed in the pertpy port (section 4) [R1]. The Dirichlet concentration gives overdispersion, and the multinomial is its limit. The regime is any $n_s$, an unchanged reference and a fixed tree; a node whose only child is also a candidate effect is non-identifiable, and collapsing removes it.

Each output has one estimand:

- The node effect $b_{jv}$ is the change in the log ratio of the node's leaves to the reference per unit of covariate $j$; its simulated truth is the planted value.
- The leaf effect $\beta_{jk}$ is the same quantity for leaf $k$, including its ancestors' effects.
- The inclusion probability $\mathrm{PIP}_v=E[s_v\mid y]$ is a posterior quantity, and the expected FDR computed from it holds under the model only, not as a frequentist bound [R1].
- Node FDR is $V/\max(R,1)$ per replicate, where $R$ counts called nodes and $V$ counts called nodes whose planted effect is zero.
- Stability is the Jaccard index of the cell sets covered by calls at two resolutions, averaged over resolution pairs; cells are used because they are the only unit shared across resolutions.

### 3.2 Propeller and the flat model

Propeller forms shares $\tilde p_{s,k}=(y_{s,k}+0.5)/(n_s+0.5K)$, takes their logit, and fits a limma moderated linear model per leaf [R3, R5]. Its estimand is the difference in mean logit share between conditions, not a log ratio to a reference, and each leaf is tested alone. Its regime is large $n_s$ with shares away from 0 and 1. scCODA is the leaf-level special case of the same likelihood, without a tree [R2].

### 3.3 Failure modes and insight

A reference leaf whose share moves between conditions shifts every effect [R10]. Partitions from different resolutions define different leaves, so a call can track clustering rather than biology. A tree that does not match the biology can spread a leaf effect over unrelated siblings. Resolutions reuse the same cells, so pooling their calls without correction inflates discoveries. With few replicates, dispersion is poorly estimated and FDR is anti-conservative.

Tree aggregation turns many correlated leaf tests into a sparse set of node effects. In the sparse regime, a lineage-wide shift gains power from pooling its children and is less sensitive to how finely the lineage was clustered, but only if the tree matches the biology. The posterior gives one set of calls over the whole tree, whereas per-level tests need a separate multiplicity correction.

Complexity, derived and not measured: a gradient costs $O(JD(N+T)+ND)$ for $N$ samples, $D$ leaves, $T$ nodes and $J$ covariates, from the products $XB$ and $bA^\top$.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| tascCODA | model-based | Dirichlet-multinomial with covariate effects on tree nodes, spike-and-slab selection and expected-FDR calls | [R1] |
| scCODA | model-based | The same likelihood on leaves only, with a reference type and spike-and-slab sparsity | [R2] |
| propeller | model-based | Logit shares per leaf, limma moderated linear model, BH across leaves | [R3], [R5] |
| Milo | model-based | Negative binomial GLM per kNN neighbourhood with spatial FDR | [R4] |

The published model-based standard is tascCODA for trees and scCODA for leaves; propeller is the standard per-type transformed test [R1–R3]. Milo replaces clusters with neighbourhoods and is a callout comparator [R4]. No cited method controls error across resolutions, so the heuristic baseline is defined in section 8.

| Method | Parameter | Value | Source |
|---|---|---|---|
| tascCODA | reference_cell_type | automatic | `scverse_pertpy/src/pertpy/tools/_coda/_tasccoda.py:132` @ c246f24 |
| tascCODA | automatic reference absence threshold | 0.05 | `_tasccoda.py:133` @ c246f24 |
| tascCODA | lambda_0, lambda_1 | 50, 5 | `_tasccoda.py:274`, `:276` @ c246f24 |
| tascCODA | phi | 0 | `_tasccoda.py:278` @ c246f24 |
| tascCODA | theta, fixed (reference samples Beta(1, d)) | 0.5 | `_tasccoda.py:281` @ c246f24; `bio-datascience_tascCODA/tasccoda/tree_agg_model_sslasso.py:183-184` @ 7deebe9 |
| tascCODA | NUTS draws / warmup | 10000 / 1000 | `_tasccoda.py:552-553` @ c246f24 |
| tascCODA | singular nodes | collapsed before fitting | `_tasccoda.py:207`, `:241` @ c246f24 |
| tascCODA | node-to-leaf mapping | Kronecker product with A | `bio-datascience_tascCODA/tasccoda/tree_results.py:241` @ 7deebe9 |
| scCODA (pertpy) | NUTS draws / warmup | 10000 / 1000 | `scverse_pertpy/src/pertpy/tools/_coda/_base_coda.py:374-375` @ c246f24 |
| tascCODA, scCODA | est_fdr | 0.05 | `_base_coda.py:498` @ c246f24 |
| propeller | transform, robust, trend | logit, TRUE, FALSE | `phipsonlab_speckle/R/propeller.R:116` @ 3fe9cf4 |
| propeller | logit pseudo-count | 0.5 added to each count | `phipsonlab_speckle/R/getTransformedProps.R:84` @ 3fe9cf4 |

## 5. Proposed singlet approach

**Routes.** tascCODA and scCODA are **ported** from pertpy's JAX/NumPyro implementation, which is permissively licensed. propeller is **reimplemented** with the same transform and moderated test. Milo and the TensorFlow tascCODA reference are **callouts**, used as comparators only (section 12).

**Proposed default.** `tasccoda` on a cluster tree, or on the author hierarchy when labels exist, with the defaults of section 4 and no tuning. The singlet step is the hierarchy input. A cluster tree is built per resolution by average linkage on cluster centroids, and stability is computed from the call sets of those resolution-specific fits (B2). One posterior across all resolutions is future work and is not claimed here.

**Falsifiers.** In B1, node FDR above 0.07 at nominal 0.05 rules the default out for node-level calls. In B2, a stability gain under 0.1 over the best per-resolution flat baseline removes the robustness claim. In B3, split-half reproducibility under 0.8 removes the default.

**ML stack and devices.** The default is pertpy's JAX/NumPyro model, for a like-for-like comparison. PyTorch variational fitting is a later option. A CUDA or cuSPARSE ancestor product is worth building only for batched refits across resolutions, bootstraps and replicates; single fits run on CPU.

**Streaming.** Counting cells into the sample-by-leaf table is one streaming pass with memory proportional to samples times leaves, and fits touch only that table.

**Defaults without asking.** `method` tasccoda, `reference.cell_type` automatic, `fdr` 0.05, NUTS at 10000 draws after 1000 warmup, `seed` 0, and a `dry_run` before every full fit.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obs/`sample_key` | string | Independent replicate, donor or library |
| read | obs/`condition_key` | string | Sample-level condition tested |
| read | obs/`batch_key` | string, optional | Sample-level batch covariate |
| read | obs/leiden_res_`r` | categorical | Cluster labels at each resolution in the grid |
| read | obs/`annotation_keys` | categorical | Ordered coarse-to-fine author labels |
| read | uns/`tree_key` | tree | Cluster tree with parent array and leaf order |
| write | uns/hierarchical_composition/counts | integer matrix | Sample-by-leaf counts used by the fit |
| write | uns/hierarchical_composition/nodes | table | Per node: effect, 95% interval, PIP, call |
| write | uns/hierarchical_composition/stability | table | Resolution-by-node call matrix and mean Jaccard |
| write | models/hierarchical_composition | object | Posterior draws when requested; tasccoda and sccoda |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `design` | object | required | — | Sample-level keys that define the sample-by-leaf count table. |
| `design.sample_key` | string | — | — | obs column of the independent replicate (donor or library). Required. |
| `design.condition_key` | string | — | — | obs column of the sample-level condition being tested. Required. |
| `design.batch_key` | string/null | null | — | Optional obs column of a sample-level batch covariate. |
| `hierarchy` | object | — | — | Source of the cell-type hierarchy and of the resolutions used for stability. |
| `hierarchy.source` | string | "cluster_tree" | `cluster_tree`, `annotation_levels` | Tree from clustering (tree_key) or from ordered author labels (annotation_keys). |
| `hierarchy.tree_key` | string/null | null | — | uns key of the cluster tree; required when source is cluster_tree. |
| `hierarchy.annotation_keys` | array | [] | — | Coarse-to-fine obs columns, ordered; required when source is annotation_levels. |
| `hierarchy.resolutions` | array | [] | — | Leiden resolutions in obs/leiden_res_<r>; at least two enable the stability output. |
| `method` | string | "tasccoda" | `tasccoda`, `sccoda`, `propeller` | tasccoda on the hierarchy is the default; sccoda and propeller run on leaves as baselines. |
| `fdr` | number | 0.05 | min 0; max 1 | Target FDR: posterior expected FDR for tasccoda and sccoda, Benjamini-Hochberg for propeller. |
| `reference` | object | — | — | Reference cell type with zero effect; used by tasccoda and sccoda only. |
| `reference.cell_type` | string | "automatic" | — | Leaf with zero effect, or automatic to choose one with a low zero fraction. |
| `reference.absence_threshold` | number | 0.05 | min 0; max 1 | Maximum zero fraction allowed for an automatically chosen reference. |
| `tasccoda` | object | — | — | Options for the tasccoda method. |
| `tasccoda.num_samples` | integer | 10000 | min 1 | NUTS draws after warmup. |
| `tasccoda.num_warmup` | integer | 1000 | min 0 | NUTS warmup iterations. |
| `tasccoda.lambda_0` | number | 50 | — | Spike penalty of the spike-and-slab LASSO prior on node effects. |
| `tasccoda.lambda_1` | number | 5 | — | Slab penalty of the spike-and-slab LASSO prior on node effects. |
| `tasccoda.phi` | number | 0 | — | Aggregation-bias parameter for tree-level effects. |
| `tasccoda.theta` | number | 0.5 | min 0; max 1 | Global spike-and-slab mixing weight, held fixed rather than sampled. |
| `tasccoda.collapse_singular_nodes` | boolean | true | — | Collapse nodes with a single child before fitting. |
| `sccoda` | object | — | — | Options for the sccoda leaf-level baseline. |
| `sccoda.num_samples` | integer | 10000 | min 1 | NUTS draws after warmup. |
| `sccoda.num_warmup` | integer | 1000 | min 0 | NUTS warmup iterations. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Random seed for NUTS initialisation and draws. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters. `tasccoda` and `sccoda` need a `design.condition_key` with at least two levels and at least three samples per level. `propeller` ignores `reference` and the method objects. `cluster_tree` requires `hierarchy.tree_key`, and `annotation_levels` requires `hierarchy.annotation_keys`. With two or more `hierarchy.resolutions`, the tool builds one tree per resolution and reports stability.

## 7. MCP tool

Tool name `singlet_abundance_hierarchical_composition_test` (definition in `tasks/mcp/singlet_abundance_hierarchical_composition_test.json`). Example call and compact result (angle brackets are filled at execution):

```json
{"dataset": "/data/donors_hier.singlet", "design": {"sample_key": "donor", "condition_key": "condition", "batch_key": "batch"}, "hierarchy": {"source": "cluster_tree", "tree_key": "cluster_tree", "resolutions": [0.4, 0.8, 1.2]}, "method": "tasccoda", "dry_run": false}
```

```json
{"dataset": "/data/donors_hier.singlet", "status": "completed",
 "wrote": ["uns/hierarchical_composition/counts", "uns/hierarchical_composition/nodes", "uns/hierarchical_composition/stability", "models/hierarchical_composition"],
 "summary": {"method": "tasccoda", "n_leaves": "<count>", "n_nodes": "<count>", "reference": "<leaf>", "n_called": "<count>", "stability_mean": "<measured>", "n_resolutions": "<count>", "warnings": []},
 "provenance_id": "<id>", "job_id": null}
```

Long-running only for large trees, which may return `queued`. Stochastic: NUTS output depends on `seed`. The `dry_run` estimate reports seconds, peak memory, device and model size before any fit.

## 8. Benchmarks

**Shared protocol.** Each simulated benchmark draws its trees, references and effects from its own recipe, and every method receives the same draws. Methods use the defaults of section 4, `seed` 0 and no tuning. Calls follow each method's rule: tasccoda and sccoda by posterior expected FDR at 0.05; propeller by Benjamini-Hochberg [R6] at $q=0.05$. The heuristic baseline is top-down BH among the children of each rejected node, on Welch p-values of logit node shares (B1), or a majority vote over the resolution grid of per-resolution propeller calls (B2); both are singlet constructions. All thresholds are proposed unless stated.

### B1. Planted tree-structured composition (node FDR and power)

- **Goal**: measure node-level false calls and power when planted changes sit at inner nodes or at leaves.
- **Ground truth**: planted. The estimand is $b_v$, the node effect on the log ratio to the reference leaf, whose aggregate effect is zero; leaf comparators are scored on $\beta_k=\sum_{v\in\mathrm{anc}(k)}b_v$.
- **Recipe** (proposed):
  1. Draw trees with $D\in\{8,16\}$ leaves and no single-child nodes; vary the shape.
  2. Choose a reference leaf; no node on its root path carries an effect.
  3. Plant $m\in\{1,2\}$ off-path nodes, signs $\pm1$, effect $\delta\in\{0.5,1.0\}$ (natural log).
  4. Two arms of $N\in\{8,16\}$ samples with 2000 cells each: $y_s\sim\mathrm{DirMult}(n_s,\,50\,\mathrm{softmax}(\alpha+X\beta))$, $\beta=bA^\top$, $\alpha=\log\pi$, $\pi\sim\mathrm{Dirichlet}(\mathbf{1})$.
  5. Misspecified variant: multinomial shares with lognormal noise, $\sigma=0.3$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated count tables, recipe steps 1-5 | Generated | Count tables only | — | Correct and misspecified |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| node_fdr | Mean of $V/\max(R,1)$ over replicates | Minimise | primary | [R1], [R6] |
| node_power | Mean over replicates of called non-zero nodes divided by non-zero nodes | Maximise | primary | — |
| leaf_sign_accuracy | Leaves with non-zero $\beta_k$ whose estimate has the true sign | Maximise | guardrail | — |

- **Comparators**: tasccoda; sccoda and propeller (BH) on leaves; the top-down BH baseline on the same tree.
- **Protocol**: every $D$, $N$, $m$, $\delta$ cell, at least 100 replicates, both variants.
- **Acceptance criterion** (proposed): node_fdr at most 0.07 in every cell for tasccoda; node_power at least 0.8 at $\delta=1.0$ with $m=1$.
- **Known pitfalls**: a generator using the fitted likelihood overstates performance; leaf comparators produce no node calls.

### B2. Resolution-robust call stability on a planted hierarchy

- **Goal**: measure whether calls for one planted change stay stable across a clustering-resolution grid.
- **Ground truth**: planted. $P$ is the set of cells under the planted node in treated samples; $S_r$ is the cell set covered by calls at resolution $r$. Stability is the mean pairwise Jaccard index of $S_r$; recall is $|S_r\cap P|/|P|$.
- **Recipe** (proposed):
  1. Balanced binary tree over 8 leaves; each node shifts 2000 gene means by $N(0,0.5^2)$.
  2. Negative binomial counts with dispersion 0.1 and per-cell size factors.
  3. $N=8$ samples, 4 per arm; the planted node (depth 1 or 2) carries $\log 2$ in the treated arm.
  4. Embed by 30 principal components; Leiden at $\{0.2,0.4,\dots,1.2\}$, never seeing leaf labels.
  5. A planted node is resolvable at $r$ if some cluster has purity at least 0.9.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated scRNA-like counts, recipe steps 1-5 | Generated | Counts only | — | Known leaves and planted node |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| resolution_stability | Mean pairwise Jaccard index of $S_r$ over the grid | Maximise | primary | — |
| planted_recall | $|S_r\cap P|/|P|$, over resolvable resolutions | Maximise | primary | — |
| cell_precision | $|S_r\cap P|/|S_r|$ | Maximise | guardrail | — |

- **Comparators**: tasccoda on a cluster tree per resolution; propeller and sccoda on leaves per resolution; the majority-vote baseline; Milo over $k\in\{15,21,31\}$ (callout).
- **Protocol**: 100 replicates per depth and fold change $\{1.5,2\}$, with identical draws across methods.
- **Acceptance criterion** (proposed): tasccoda resolution_stability at least 0.1 above the best per-resolution flat baseline; planted_recall at least 0.8 where resolvable.
- **Known pitfalls**: overclustering creates splits that look like effects, so purity is reported with each call; stability depends on the grid.

### B3. Split-half sign reproducibility on an annotated hierarchy

- **Goal**: test whether node calls on a real author hierarchy reproduce across independent halves of the samples.
- **Ground truth**: consistency, not truth. The estimand is the sign of the node effect on the log ratio to a reference leaf fixed before splitting.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue studies with coarse and fine author labels, at least 12 samples, at least 3 per arm | singlet catalogue (internal) | Single-cell or single-nucleus RNA-seq | — | Study list fixed before fitting |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| split_half_sign_reproducibility | For each node called in one half, fraction with the same sign in the other; mean over at least 100 stratified splits | Maximise | primary | — |
| coarse_fine_agreement | Called coarse nodes whose sign equals that of the summed called fine children | Maximise | guardrail | — |

- **Comparators**: tasccoda on the annotation tree; sccoda on the finest level; propeller per annotated level with BH.
- **Protocol**: all methods at defaults; splits stratified by condition and batch; unannotated cells reported separately.
- **Acceptance criterion** (proposed): mean split_half_sign_reproducibility at least 0.8 for tasccoda; coarse_fine_agreement reported only with its caveat.
- **Known pitfalls**: author labels often come from clustering the same data, so agreement is partly circular; tree aggregation makes coarse and fine calls agree by construction, so coarse_fine_agreement is not validation.

### P1. Performance and scaling

- **Measures**: wall time, peak memory and sampler diagnostics (R-hat, effective sample size) at 8, 32 and 128 samples, 8, 32 and 128 leaves, and 1, 6 and 12 resolutions, with 2000 cells per sample (proposed grid).
- **Comparators**: pertpy tascCODA; the TensorFlow tascCODA reference, which samples theta; pertpy scCODA; propeller in R; miloR.
- **Hold fixed**: NUTS draws and warmup, tree, reference, chain count and hardware. Diagnostics are reported with every timing, since a fast fit that does not converge is not comparable.
- **Acceptance criterion** (proposed): node posterior means agree with the pertpy port within 0.05 absolute on the B1 pilot; wall time and memory are reported at every scale; no speed target is set before the pilot.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `clustering.hierarchical_cluster_tree`: Hierarchical tree of cell clusters
  - `annotation.hierarchical_annotation`: Hierarchical, ontology-aware coarse-to-fine annotation
- **Feeds**:
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
  - `sample-level.multi_sample_power_analysis`: Power and sample-number planning for multi-sample designs
- **Reads**: `obs/<sample_key>`, `obs/<condition_key>`, `obs/<batch_key>`, `obs/leiden_res_<r>`, `obs/<annotation_keys>`, `uns/<tree_key>`
- **Writes**: `uns/hierarchical_composition/counts`, `uns/hierarchical_composition/nodes`, `uns/hierarchical_composition/stability`, `models/hierarchical_composition`
<!-- CHAINING:AUTO:END -->

Workflow: composition testing after annotation and sample QC, with the hierarchy from clustering or from author labels; node calls feed multiple-testing control and power planning.

## 10. Risks, pitfalls and open questions

- **Evidence not read**: the tascCODA paper's simulation design and results were not read, and the reference repository has no simulation code. The hierarchical-FDR paper (Yekutieli, 2008) could not be opened, so the top-down BH baseline is defined from BH alone. The scCODA benchmark numbers, sccomp and DA-seq were not read and are absent from the tables and the MCP enum.
- **Unsettled literature**: no cited benchmark compares resolution robustness, so B2 is a construction; the cell-set Jaccard and planted recall are singlet definitions without an established threshold; choosing a nested hierarchy from non-nested partitions changes the result [R7, R8, R9]; cluster-membership uncertainty is not propagated by tascCODA, propeller or Milo.
- **Technical and data risks**: the pertpy port fixes theta at 0.5 where the reference samples it, so inclusion probabilities are not directly comparable across implementations. The pertpy and speckle commits in section 4 come from the remote check, not local checkouts; only the tascCODA commit was confirmed locally. The catalogue licence is unchecked, and B3 fixes its study list by rule rather than naming studies. Milo is excluded from B1 and B3 because neighbourhoods do not map to tree nodes.
- **First experiment**: execute B1 for tasccoda defaults, leaf-level sccoda and propeller with 8 leaves, 8 samples and 100 replicates; confirm node_fdr calibration before B2, and record the `dry_run` estimate.

## 11. References

R1. Ostner J, Carcy S, Müller CL. tascCODA: Bayesian tree-aggregated analysis of compositional amplicon and single-cell data. *Frontiers in Genetics* 2021. doi:10.3389/fgene.2021.766405 — verified (corpus)
R2. Büttner M, Ostner J, Müller CL, Theis FJ, Schubert B. scCODA is a Bayesian model for compositional single-cell data analysis. *Nature Communications* 2021. doi:10.1038/s41467-021-27150-6 — verified (corpus)
R3. Phipson B, Sim CB, Porrello ER, Hewitt AW, Powell J, Oshlack A. propeller: testing for differences in cell type proportions in single cell data. *Bioinformatics* 2022. doi:10.1093/bioinformatics/btac582 — verified (corpus)
R4. Dann E, Henderson NC, Teichmann SA, Morgan MD, Marioni JC. Differential abundance testing on single-cell data using k-nearest neighbor graphs. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01033-z — verified (corpus)
R5. Ritchie ME, Phipson B, Wu D, et al. limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 2015. doi:10.1093/nar/gkv007 — verified (corpus)
R6. Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society: Series B* 1995. doi:10.1111/j.2517-6161.1995.tb02031.x — verified (corpus)
R7. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R8. Lähnemann D, Köster J, Szczurek E, et al. Eleven grand challenges in single-cell data science. *Genome Biology* 2020. doi:10.1186/s13059-020-1926-6 — verified (corpus)
R9. Morelli L, Giansanti V, Cittaro D. Nested stochastic block models applied to the analysis of single cell data. *BMC Bioinformatics* 2021. doi:10.1186/s12859-021-04489-7 — verified (corpus)
R10. Single-cell best practices, chapter "Compositional analysis", takeaways 1-3. https://github.com/theislab/single-cell-best-practices — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/pertpy | Heumos L, May L, Peidli S, Ostner J, et al. (CITATION.cff) | MIT (LICENSE, Copyright 2021 Lukas Heumos); Apache-2.0 (CITATION.cff) | JAX/NumPyro tascCODA and scCODA | port |
| https://github.com/bio-datascience/tascCODA | Johannes Ostner, Christian L. Müller (setup.py) | BSD-3-Clause (LICENSE, Copyright 2021) | TensorFlow reference with sampled theta | callout (comparator) |
| https://github.com/theislab/scCODA | Johannes Ostner, Benjamin Schubert (setup.py) | BSD-3-Clause (LICENSE, Copyright 2020); no longer maintained (README) | Original leaf-level scCODA | callout (pertpy is the maintained route) |
| https://github.com/phipsonlab/speckle | Belinda Phipson (aut, cre) (DESCRIPTION) | GPL-3 (DESCRIPTION) | propeller transform and moderated test | reimplement |
| https://github.com/MarioniLab/miloR | Mike Morgan (aut, cre), Emma Dann (aut, ctb) (DESCRIPTION) | GPL-3 + file LICENSE (DESCRIPTION) | Neighbourhood comparator, NB GLM with spatial FDR | callout |
