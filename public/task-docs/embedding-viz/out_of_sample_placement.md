---
id: embedding-viz.out_of_sample_placement
title: Out-of-sample placement of new cells on a fixed 2D map
area: embedding-viz
scope: core
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection, neighbors.approximate_knn_search, reference-mapping.reference_construction]
feeds: [annotation.novel_cell_type_detection, embedding-viz.local_neighborhood_preservation]
reads: [obsm/X_pca, obsm/<reference_embedding>, obs/<query_key>, obs/<label_key>, models/<method>]
writes: [obsm/<method>_query_2d, obs/<method>_label_knn, obs/<method>_ood_score, uns/<method>_placement_report]
devices: [cpu, cuda]
mcp_tool: singlet_embedding_viz_out_of_sample_placement
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Out-of-sample placement of new cells on a fixed 2D map

> Place new cells on a fixed 2D reference map so that each lands where a joint re-embedding of reference and query would put it, and score each placement against the seed-to-seed spread of that joint target.

## 1. Question

Given a fixed 2D map of reference cells, their PCA coordinates, and query cells in the same PCA space, where should each query cell be drawn, without changing the reference, so that its position matches where a joint re-embedding of reference and query would place it? A correct placement lies within the seed spread of that joint target, and the labels and novelty flags derived from it agree with held-out author annotation.

## 2. Why this task matters and where the field stands

Reference maps are reused. New samples are drawn onto an existing atlas so that clusters can be read by eye and labelled [R2]. A placement in the wrong neighbourhood misleads that reading, and recomputing the whole map changes every coordinate that has already been read.

The status is **contested**. Parametric and projection methods are reported to embed new data and to classify cells well [R3, R5], and the openTSNE library exposes a transform for new points [R4]. This document cites no evaluation of 2D placement against a joint re-embedding, so the comparison that defines correctness here is not established by the cited literature. Open problems:

1. The joint target is not unique. It is fixed only up to a similarity transform and changes with the seed.
2. Placement cannot show novelty. An unseen type is drawn beside its nearest reference population and receives a confident label.
3. Batch shift in PCA space moves query cells toward the wrong region, and the kNN graph inherits the error.
4. Query-query structure is dropped by construction, so a coherent new population is not drawn as its own island.

## 3. Theory and insight

**Frozen-reference placement.** Reference coordinates $Y_R$ are fixed, and a query cell $q$ is placed by minimising the embedding objective restricted to pairs that involve $q$. For UMAP, the objective for $q$ is the cross-entropy over its fuzzy edges $\mu_{qj}$ to reference cells, with output memberships $\nu_{qj}=(1+a\lVert\hat y_q-y_j\rVert^{2b})^{-1}$ from the fitted $a$ and $b$:

$$
C_q(\hat y_q)=\sum_{j\in\mathcal N(q)}\Big[\mu_{qj}\log\frac{\mu_{qj}}{\nu_{qj}}+(1-\mu_{qj})\log\frac{1-\mu_{qj}}{1-\nu_{qj}}\Big]
$$

This is the UMAP term of [R1] with negative sampling omitted. t-SNE placement applies the KL term of [R6] in the same way. Both are conditional on $Y_R$. Query-query terms are dropped, so placement is valid when the neighbourhood of $q$ is mostly covered by reference cells.

**What the joint target adds.** A joint re-embedding also moves reference cells, optimises query-query pairs, and depends on iterations, initialisation and seed. The placement error therefore mixes four sources: dropped query-query terms, the frozen reference, optimiser settings, and the seed variance of the target. The joint target is fixed only up to a similarity map, so it is compared through $\psi_s(z)=sQz+t$ with $s>0$ and $Q^\top Q=I$, fitted on the reference rows of seed $s$ alone.

**Estimands.** Let $\rho$ be the root-mean-square distance of reference cells from their centroid, $z^{J,s}_q$ the joint coordinates of $q$ under seed $s$, and $S$ the number of seeds. The placement error and the seed spread of $q$ are

$$
e_q=\frac1S\sum_{s}\frac{\lVert\hat y_q-\psi_s(z^{J,s}_q)\rVert}{\rho},\qquad
d_q=\frac{2}{S(S-1)}\sum_{s<s'}\frac{\lVert\psi_s(z^{J,s}_q)-\psi_{s'}(z^{J,s'}_q)\rVert}{\rho}.
$$

Both are unitless and measured in reference radii. The benchmark ratio is $\operatorname{median}_q e_q/\operatorname{median}_q d_q$. Under isotropic Gaussian seed noise of variance $\sigma^2$ per coordinate in two dimensions, placing $q$ at the centre of the seed cloud gives $\mathbb E\,e_q=\sigma\sqrt{\pi/2}$ and $\mathbb E\,d_q=\sigma\sqrt{\pi}$, so the ratio has an oracle floor of $1/\sqrt2\approx0.71$. A simulation with $2\times10^5$ cells gave $0.713$. A threshold of 1 is therefore loose, and real seed noise is not isotropic, so the floor is a guide only.

**Other estimands.** The label output is a 2D vote over $k=15$ reference neighbours with uniform weights (proposed). Macro-F1 averages $F_{1,c}=2P_cR_c/(P_c+R_c)$ over classes present in the query truth. The out-of-reference score is $s_q=\bar d_{30}(q)/\operatorname{median}_{r\in R}\bar d^{\,\mathrm{LOO}}_{30}(r)$, the mean distance to the 30 nearest reference cells in PCA space divided by the leave-one-out median within the reference. It is dimensionless and valid when query and reference share one PCA basis.

**Model-based insight.** A parametric encoder places each cell with one forward pass, but it has no uncertainty unless an output head is added and checked for coverage on held-out splits. Novelty is not visible in 2D, so an input-space score is needed alongside the map.

**Pitfalls.** The umap-learn epoch count depends on the number of query rows in the query-to-reference graph, so placements can change with batch size (the rule is in §4). The openTSNE docstring advises against `learning_rate='auto'` for transform. Seurat replaces a neighbour count that differs from the stored model's value, with a warning.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| umap-learn `transform` | hybrid | kNN into the fitted graph, mean-of-neighbours start, then cross-entropy steps with reference fixed | [R1][R2] |
| openTSNE `transform` | model-based | optimises the t-SNE KL per new point against the fixed reference; new-new terms ignored | [R4][R6] |
| scanpy `ingest` | hybrid | projects onto reference PCA loadings, applies the reference UMAP, labels by kNN vote over the reference graph | [R9][R1] |
| Seurat ProjectUMAP | hybrid | finds reference neighbours in the reference reduction, then maps them with the stored UMAP model | [R8][R1] |
| Parametric UMAP | model-based | encoder trained on UMAP cross-entropy over kNN edges; a new cell needs one forward pass | [R3][R1] |
| scArches reference mapping | model-based | conditional VAE extended by partial fine-tuning; yields a latent space, not a 2D position | [R7] |
| PCA projection | heuristic | centres with the reference mean and applies fixed loadings; the first two components give the position | [R9] |

The published routes are umap-learn's transform [R1] and openTSNE's transform [R4]. scanpy's ingest and Seurat's ProjectUMAP [R9, R8] wrap similar steps in analysis pipelines. Parametric UMAP [R3] is the model-based route with one forward pass per cell. scArches [R7] is a latent-space comparator, and PCA projection is the floor baseline.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| umap-learn transform | transform seed | 42 | umap/umap_.py:1675, 1778 @33d7e6f |
| umap-learn transform | epochs when unset | 100 if query-graph rows ≤ 10000, else 30 | umap/umap_.py, about line 3295 @33d7e6f |
| umap-learn transform | layout learning rate | initial alpha / 4 | umap/umap_.py, about line 3316 @33d7e6f |
| openTSNE transform | perplexity; k | 5; 25 | openTSNE/tsne.py:697-711 @c2a8b28 |
| openTSNE transform | initialization; learning rate | 'median'; 0.1 | openTSNE/tsne.py:697-711 @c2a8b28 |
| openTSNE transform | iterations; momentum (initial/final) | 250; 0.8/0.8 | openTSNE/tsne.py:697-711 @c2a8b28 |
| scanpy ingest | embedding methods; labelling | ('umap', 'pca'); 'knn' | src/scanpy/tools/_ingest.py:40-47 @8ed52d9 |
| scanpy ingest | neighbours queue size; epsilon; random state | 5; 0.1; 0 | src/scanpy/tools/_ingest.py:444 @8ed52d9 |
| Seurat ProjectUMAP | k.param; method; trees; metric | 30; annoy; 50; cosine | R/dimensional_reduction.R:333-345 @5f67c70 |
| scArches query loading | freeze; freeze_expression | True; True | scarches/models/base/_base.py:204-205 @d35cde6 |
| Parametric UMAP | default encoder | Dense(100, relu) ×3, then Dense(n_components) | umap/parametric_umap.py:823-830 @33d7e6f |
| PCA projection | number of components | reference's stored value | src/scanpy/tools/_ingest.py:306-314, 394-404 @8ed52d9 |

## 5. Proposed singlet approach

Routes per method are in §12. The proposed default is `umap_transform`, ported to the C++ core from umap-learn's transform, with the epoch count fixed at 100 (proposed) so that placement does not change with query batch size. `opentsne_transform`, `seurat_projectumap`, `ingest` and `pca_project` are kept for comparison, and `parametric_umap` is reimplemented in PyTorch.

The model-based formulation singlet proposes is an encoder $f_\theta$ from 50 PCs to 2D with a heteroscedastic scale output. It is trained without labels on reference and query splits from the catalogue, with the seed-aligned joint coordinates as targets. The scale output is calibrated on held-out splits so that nominal coverage of $e_q$ is met. It is falsified if it fails the B1 criterion against `umap_transform`, or if nominal coverage misses on held-out splits.

The stack is PyTorch for encoder training. The PCA projection and the dense forward pass are small, hot matrix products that can be hard-coded in CUDA. The query-to-reference neighbour search is a brute-force CUDA kernel for small references and an NN-descent index on CPU for large ones. Core kernels are the neighbour query, the label vote and the distance score. Query cells stream in fixed-size batches against one reference index, built once per reference.

Defaults an agent uses without asking: `method=umap_transform`, `reference_embedding=X_ref_2d`, `query_key=is_query`, `seed=42`, `scoring.label_k=15`, `scoring.ood_k=30`. The joint re-embedding is not a method of this tool; it is the benchmark target in §8.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/X_pca | float (cells × PCs) | reference and query PCs in one feature space; query rows use reference loadings |
| read | obsm/<reference_embedding> | float (cells × 2) | fixed 2D coordinates of reference cells |
| read | obs/<query_key> | bool | true for query cells |
| read | obs/<label_key> | categorical | reference labels for the vote; used only when set |
| read | models/<method> | model object | fitted umap-learn model, openTSNE embedding or kNN index |
| write | obsm/<method>_query_2d | float32 (query × 2) | query coordinates in the reference frame |
| write | obs/<method>_label_knn | categorical | 2D kNN vote; written only when a label key is set |
| write | obs/<method>_ood_score | float32 | dimensionless out-of-reference score |
| write | uns/<method>_placement_report | dict | parameters, seed and diagnostics of the call |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path, URI or workspace handle. |
| `method` | string | "umap_transform" | `umap_transform`, `opentsne_transform`, `ingest`, `parametric_umap`, `pca_project`, `seurat_projectumap` | Placement method. Use umap_transform unless a comparison requires another. |
| `reference_embedding` | string | "X_ref_2d" | — | obsm member with fixed 2D reference coordinates; query rows ignored. |
| `query_key` | string | "is_query" | — | obs column true for query cells; all other cells are reference. |
| `seed` | integer | 42 | min 0 | Seed for stochastic steps. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto prefers CUDA when memory allows. |
| `dry_run` | boolean | false | — | Return an estimate only; write nothing. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `umap_transform` | object | — | — | Options for umap_transform. |
| `umap_transform.n_epochs` | integer | 100 | min 1 | Fixed epoch count, so placement does not depend on batch size. |
| `opentsne_transform` | object | — | — | Options for opentsne_transform. |
| `opentsne_transform.perplexity` | number | 5 | > 0 | Perplexity of affinities to reference neighbours. |
| `opentsne_transform.k` | integer | 25 | min 1 | Reference neighbours for initial affinities. |
| `opentsne_transform.learning_rate` | number | 0.1 | > 0 | Numeric rate; not auto, which is avoided for transform. |
| `opentsne_transform.n_iter` | integer | 250 | min 1 | Optimisation iterations. |
| `opentsne_transform.initialization` | string | "median" | — | Initial placement of each new point. |
| `seurat_projectumap` | object | — | — | Options for seurat_projectumap. |
| `seurat_projectumap.k` | integer | 30 | min 1 | Reference neighbours per query cell. |
| `scoring` | object | — | — | Label vote and out-of-reference score settings, applied to every method. |
| `scoring.label_key` | string | — | — | Reference label column; omit to skip the label vote. |
| `scoring.label_k` | integer | 15 | min 1 | Reference neighbours in the 2D label vote. |
| `scoring.ood_k` | integer | 30 | min 1 | Neighbours in the PCA-space out-of-reference score. |
<!-- PARAMS:AUTO:END -->

Method options are nested under the method they configure, and `scoring` applies to every method. `seed` is passed to each method's stochastic steps, and `dry_run` returns an estimate only. Query PCs must be computed with the reference loadings, because the tool does not project raw counts. Without `scoring.label_key`, the label vote and its member are skipped.

## 7. MCP tool

Tool name `singlet_embedding_viz_out_of_sample_placement` (definition in `tasks/mcp/singlet_embedding_viz_out_of_sample_placement.json`). Example call and compact result:

```json
{"dataset": "atlas.singlet", "method": "umap_transform", "reference_embedding": "X_ref_2d", "query_key": "is_query", "scoring": {"label_key": "cell_type"}}
```

```json
{"dataset": "atlas.singlet", "status": "completed", "wrote": ["obsm/umap_transform_query_2d", "obs/umap_transform_label_knn", "obs/umap_transform_ood_score", "uns/umap_transform_placement_report"], "summary": {"n_query": "...", "label_k": 15, "ood_k": 30}, "provenance_id": "..."}
```

Long-running: placement is inline, but building a reference index for a large reference may be queued as a job. Stochastic: yes, `seed` controls each method's random steps. Dry run: returns estimated seconds, peak memory and device for the query size, and writes nothing.

## 8. Benchmarks

**Shared protocol.** Splits are held-out batches or donors from the singlet catalogue, at least three per benchmark. Recipe S1: the reference is every other batch or donor, and the query is the held-out one, subsampled to 1%, 10% and 30% of its cells with seed 0. HVGs, scaling and PCA are fitted on reference cells only and reused for the joint target. The reference map is fitted once per seed. The joint map on reference plus query uses identical hyperparameters and seeds 0 to 2 ($S=3$). Every method receives the same 50 PCs. Reference drift, the RMS distance of reference coordinates after $\psi$ alignment divided by $\rho$, is reported apart from placement error.

### B1. Placement fidelity against a joint re-embedding

- **Goal**: Measure placement distance from the seed-aligned joint position, relative to seed spread.
- **Ground truth**: consistency, no labels: the seed-aligned joint re-embedding; $e_q$ and $d_q$ as in §3, in units of $\rho$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue held-out batches or donors (recipe S1) | singlet catalogue | scRNA-seq; catalogue of 354M cells; species and sizes per split | — | see recipe S1 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| placement_error_median | median over query cells of $e_q$ | minimise | primary | — |
| seed_normalised_ratio | $\operatorname{median}_q e_q\,/\,\operatorname{median}_q d_q$ | minimise | primary | — |
| placement_error_p90 | 90th percentile of $e_q$ over query cells | minimise | guardrail | — |
| knn_overlap_k30 | mean over query cells of $\lvert N^{30}_{\rm place}(q)\cap N^{30}_{\rm joint}(q)\rvert/30$, neighbourhoods over reference plus query | maximise | guardrail | — |

- **Comparators**: the six `method` values, plus an init-only baseline (weighted neighbour mean).
- **Protocol**: the shared protocol at each query fraction; unaligned residuals are reported beside aligned errors.
- **Acceptance criterion**: Proposed. seed_normalised_ratio ≤ 1.0 at the 10% query fraction on at least two of three splits; fallback placement_error_median ≤ 0.10. The oracle floor is 0.71 (§3).
- **Known pitfalls**: Procrustes can absorb systematic distortion, and without alignment the error is undefined.

### B2. Held-out label agreement of 2D kNN label transfer

- **Goal**: Test whether a kNN label vote in the placed 2D coordinates recovers held-out author labels.
- **Ground truth**: catalogue author annotations; unknown or missing labels excluded; a query-only class scores F1 = 0.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue annotated subsets, held-out batches (recipe S1) | singlet catalogue; split design of [R11] | scRNA-seq; about 40% of catalogue cells annotated; sizes per split | — | — |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| macro_f1_2d_knn | mean per-class F1 over classes in the query truth; 2D vote over $k=15$ reference cells, ties to the nearest | maximise | primary | [R10] |
| delta_vs_joint_macro_f1 | macro_f1_2d_knn minus the same statistic on the joint 2D embedding, same splits and seeds | maximise | primary | — |
| accuracy_2d_knn | fraction of query cells whose vote equals the author label | maximise | guardrail | — |

- **Comparators**: joint-embedding 2D kNN (upper reference); PCA-space kNN, $k=15$; scArches latent kNN.
- **Protocol**: label kNN fitted on reference cells only; per-class F1 and class support reported.
- **Acceptance criterion**: Proposed. delta_vs_joint_macro_f1 ≥ −0.03 on at least two of three splits.
- **Known pitfalls**: labels derived from clusters on the reference map make the benchmark circular; accuracy rewards majority classes, so macro-F1 is primary.

### B3. Novel-population placement and out-of-reference flagging

- **Goal**: Measure confident absorption of a withheld cell type into a 2D population, and whether the PCA-space score flags it.
- **Ground truth**: held-out author labels; a withheld type is absent from the reference, so any reference label on its cells is wrong.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue annotated subsets with at least three withheld types (recipe S1) | singlet catalogue | scRNA-seq; per-type counts reported | — | marker-defined types; QC applied first |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| confident_absorption_rate | fraction of withheld-type query cells whose most common label holds at least 0.8 of their 15 nearest 2D reference neighbours (threshold proposed) | minimise | primary | — |
| ood_score_auroc | AUROC of $s_q$ (§3) for withheld versus in-reference query cells | maximise | primary | — |
| false_flag_rate | fraction of in-reference query cells with $s_q$ above the 0.95 quantile of leave-one-out $s$ over reference cells | minimise | guardrail | — |

- **Comparators**: the 2D placement methods; PCA-space distance score.
- **Protocol**: withhold each type in turn; report per-type statistics with class counts.
- **Acceptance criterion**: Proposed. ood_score_auroc ≥ 0.9 at false_flag_rate ≤ 0.05.
- **Known pitfalls**: a vote always returns a label, hence the confidence threshold; doublets and damaged cells look novel and must be removed first.

### P1. Performance and scaling

Wall time, peak memory and throughput in query cells per second, for reference sizes $10^5$ and $10^6$ and query sizes $10^3$, $10^4$ and $10^5$ at 50 PCs, with one-off fit or index time reported apart. Devices: CPU on one node and CUDA where available. Comparators: umap_transform, opentsne_transform in Barnes-Hut and FFT modes, ingest, seurat_projectumap, the parametric_umap forward pass, scArches query fine-tuning (training cost) and pca_project. Hold fixed: PCs, neighbour counts, seeds, thread count and hardware. Acceptance is proposed: report the Pareto front of B1 placement error against per-query time, with no absolute time threshold asserted.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `reference-mapping.reference_construction`: Reusable reference construction and compression
- **Feeds**:
  - `annotation.novel_cell_type_detection`: Novel or unseen cell type detection and out-of-distribution scoring for query cells
  - `embedding-viz.local_neighborhood_preservation`: Local neighbourhood preservation of an embedding or reduced representation
- **Reads**: `obsm/X_pca`, `obsm/<reference_embedding>`, `obs/<query_key>`, `obs/<label_key>`, `models/<method>`
- **Writes**: `obsm/<method>_query_2d`, `obs/<method>_label_knn`, `obs/<method>_ood_score`, `uns/<method>_placement_report`
<!-- CHAINING:AUTO:END -->

Placement belongs to the reference-based workflow that follows reference construction, and its label and novelty outputs feed the annotation and local-neighbourhood steps.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The evaluation designs of Sainburg et al. [R3] and Policar et al. [R5] were not read, so their claims are cited as summarised. Parametric t-SNE (2009) and scvis have no located code or full text and are omitted from §4. Commit identifiers in §4 are remote heads at check time, and the local clones lack git metadata, so each default must be re-read at the ported release.
- **Unsettled literature and limits.** This document cites no evaluation of 2D placement against a joint re-embedding, so every acceptance threshold is proposed. The Procrustes step can hide distortion, placement cannot flag novelty by itself, and the cited sources do not show whether an encoder trained on one reference generalises across strong batch effects. Query-row co-ranking continuity is measured by embedding-viz.local_neighborhood_preservation, not here.
- **Data and licences.** The licence terms, species and cell counts of the catalogue subsets are not yet fixed. Public atlases are not used as benchmark sources because their access and licence terms were not checked. The scArches licence statement differs between its files (§12).
- **First experiment.** On one held-out batch at the 10% query fraction, fit the joint map for three seeds and compare umap_transform placements with the seed floor. Then place the same query cells in batches of different sizes under the default epoch rule to measure the batch-size dependence that §3 predicts, and repeat with the fixed epoch count.

## 11. References

R1. McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction. *arXiv* 2018. doi:10.48550/arxiv.1802.03426 — verified (corpus)
R2. Becht E, McInnes L, Healy J, et al. Dimensionality reduction for visualizing single-cell data using UMAP. *Nature Biotechnology* 2019. doi:10.1038/nbt.4314 — verified (corpus)
R3. Sainburg T, McInnes L, Gentner TQ. Parametric UMAP embeddings for representation and semisupervised learning. *Neural Computation* 2021;33(11):2881-2907. doi:10.1162/neco_a_01434 — partial (search)
R4. Policar PG, Strazar M, Zupan B. openTSNE: a modular Python library for t-SNE dimensionality reduction and embedding. *Journal of Statistical Software* 2024;109(3). doi:10.18637/jss.v109.i03 — partial (search)
R5. Policar PG, Strazar M, Zupan B. Embedding to reference t-SNE space addresses batch effects in single-cell classification. *Machine Learning* 2021. doi:10.1007/s10994-021-06043-1 — partial (repo)
R6. van der Maaten L, Hinton G. Visualizing data using t-SNE. *Journal of Machine Learning Research* 2008;9. — verified (corpus)
R7. Lotfollahi M, Naghipourfar M, Luecken MD, et al. Mapping single-cell data to reference atlases by transfer learning. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01001-7 — verified (corpus)
R8. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)
R9. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R10. Grandini M, Bagli E, Visani G. Metrics for multi-class classification: an overview. *arXiv* 2020. doi:10.48550/arxiv.2008.05756 — verified (corpus)
R11. OpenProblems contributors. Label projection task repository, openproblems-bio/task_label_projection. https://github.com/openproblems-bio/task_label_projection — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/lmcinnes/umap | Leland McInnes (copyright holder, LICENSE.txt) | BSD-3-Clause (LICENSE.txt; pyproject.toml agrees) | umap_transform; parametric UMAP module | port (umap_transform); reimplement in PyTorch (parametric_umap) |
| https://github.com/pavlin-policar/openTSNE | Pavlin Policar (setup.py author) | BSD-3-Clause (LICENSE; setup.py agrees) | opentsne_transform | port |
| https://github.com/scverse/scanpy | scverse developers; pyproject.toml lists Adam Gayoso, Alex Wolf, Andres R. Munoz-Rojas first | BSD-3-Clause (LICENSE; pyproject.toml agrees) | ingest; PCA projection | port |
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and further contributors | MIT (DESCRIPTION; LICENSE) | seurat_projectumap | port |
| https://github.com/theislab/scarches | Mohammad Lotfollahi, Theislab (LICENSE copyright line) | BSD-3-Clause in LICENSE; MIT in setup.py | latent-space comparator (B2, P1) | callout |
| https://github.com/openproblems-bio/task_label_projection | OpenProblems contributors | MIT (LICENSE) | split design for B2 | callout |
