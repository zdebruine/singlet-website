---
id: cross-species.cell_type_correspondence
title: Cross-species cell-type correspondence and homology scoring
area: cross-species
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [cross-species.ortholog_assignment, cross-species.one_to_many_ortholog_harmonization, harmonization.gene_identifier_mapping]
feeds: [cross-species.label_transfer, cross-species.expression_conservation, annotation.cross_dataset_label_reconciliation]
reads: [layers/counts, layers/normalized, obs/<label_key>, var/<gene_id>, uns/ortholog_pairs, obsm/X_pca]
writes: [uns/cross_species_matrix_<method>, obs/best_match_<method>, uns/conserved_flags_<method>, uns/correspondence_params_<method>, models/<name>]
devices: [cpu, cuda]
mcp_tool: singlet_cross_species_cell_type_correspondence
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Cross-species cell-type correspondence and homology scoring

> Score every cell type of one species against every cell type of another over one-to-one orthologs, report each type's best partner and whether the match is conserved or species-specific, and state the normalisation of every score.

## 1. Question

Given two annotated atlases from different species and an ortholog table, which cell type of species A corresponds to which cell type of species B, how replicable is each match, and which types have no partner? A correct answer agrees with expert homology calls made from marker and layer evidence that the scorers do not use, and it flags unmatched types rather than forcing them onto a partner.

## 2. Why this task matters and where the field stands

Matching cell types across species separates conserved from lineage-specific identity and lets one atlas inform the annotation of another [R5][R6]. Status: **contested**. The scorers measure different things, none returns a calibrated match probability, and none has a null model for a type with no homologous partner [R1][R2].

- **Forced matches.** Anchor-based mapping always finds anchors, so an absent type is matched by force [R3].
- **Divergent features.** Matched types can differ in other features, so a correct match can score low [R5].
- **Qualitative validation.** SAMap's check against known metazoan homology is qualitative in the published claim [R2].
- **Granularity.** How a type split in one species maps onto types of the other is not solved by any listed method.

## 3. Theory and insight

A scorer returns $S\in\mathbb R^{|\mathcal A|\times|\mathcal B|}$ over the types $\mathcal A$ of species A and $\mathcal B$ of species B. The best partner is $\hat b(a)=\arg\max_b S_{ab}$. A reciprocal top hit is a pair with $\hat b(a)=b$ and $\hat a(b)=a$. A conserved flag is $c_a=\mathbf 1[\max_b S_{ab}\ge\tau]$, with $\tau$ set by the user.

**Estimands and normalisation.** Each matrix has its own scale, so values compare only within one method and configuration.

- MetaNeighbor: $S_{ab}$ is the mean leave-one-dataset-out AUROC of type $a$ against $b$, in $[0,1]$, with 0.5 at chance. Neighbour voting is $\hat y_{i,c}=\sum_j W_{ij}\mathbf 1[y_j=c]/\sum_j W_{ij}$ on a rank-correlation network $W$ that includes the cell itself [R1].
- SAMap: $S_{ab}=\max(C_{ab},C_{ba})/K$ with $C_{ab}=|a|^{-1}\sum_{i\in a}\sum_{j\in b}w^{\times}_{ij}$, where $w^{\times}$ are cross-species edge weights and $K$ is a mapping constant. It is not a probability [R2].
- Seurat anchors: $S_{ab}$ is the share of type-$a$ mutual anchors whose partner lies in $b$, so rows sum to at most one [R3]. This is singlet's definition of the matrix, not a Seurat output.
- scANVI: $S_{ab}$ is the mean posterior $q(y=a\mid z_j)$ over species-B cells $j$ of type $b$; for each $b$ it sums to one over $a$ [R4].

**Ground truth.** $E$ is the set of expert partner pairs of the source studies, $Y_{ab}=\mathbf 1[(a,b)\in E]$. Top-1 concordance is the share of expert-matched types whose $\hat b(a)$ is the expert partner. Mean reciprocal rank averages $1/\mathrm{rank}$ of that partner in row $a$. Both are per type, not per cell. In planted simulation the correspondence $\pi$ and absent set $\mathcal N$ are exact.

**Model-based formulation.** The heuristics give no probability that $a$ has partner $b$, or that $a$ has none. singlet's proposal is a latent-type model: each cell has a latent type in $\mathcal T\cup\{\varnothing\}$ shared by both species, with species-specific ZINB likelihoods over one-to-one orthologs and a per-type divergence term. Its posterior $P(t=b\mid a)$ gives match probabilities, and $P(t=\varnothing\mid a)$ gives the absence probability. Calibration holds only where the simulated divergence resembles the data.

**Insight and regimes.** Replicability AUROC and reciprocal top hits screen candidates. MetaNeighbor's documentation (section 12) limits the >0.9 and reciprocal-top-hit rule to datasets with similar cell types, and says it fails for very unbalanced datasets. Its correlations are rank-based, so a per-cell scaling of counts leaves within-cell gene ranks unchanged, while gene-wise detection differences between species do not. Anchor and mapping scores assume shared low-dimensional structure. Failure modes: species-specific genes dominate a score and a conserved type scores low [R5]; one-to-many orthologs change the feature space; labels produced by the same scorer make agreement circular. A dense cell-by-cell network needs $O(n^2)$ memory.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| MetaNeighbor replicability AUROC | heuristic | Rank-correlation network over a gene set; neighbour voting; leave-one-dataset-out AUROC per type pair | [R1] |
| SAMap mapping score | heuristic | Per-species manifolds stitched by BLAST-derived homology edges, iterated; cluster-level score divided by $K$ | [R2] |
| Seurat anchor mapping | heuristic | Mutual nearest-neighbour anchors in a CCA space, filtered and scored; row-normalised anchor shares | [R3] |
| scANVI label posterior | model-based | Semi-supervised ZINB variational autoencoder with a label classifier on joint ortholog-restricted counts | [R4] |

MetaNeighbor and SAMap are the heuristic standards with published type-by-type outputs, and both stay as comparators. Seurat anchors and scANVI are the general mapping and probabilistic alternatives [R3][R4]. A correlation of pseudobulk profiles over orthologs is not listed; its procedure is not in the sources used here (section 10).

Exact defaults of the implemented methods:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| MetaNeighbor | candidate rule | AUROC above 0.9 and reciprocal top hits (within-study heuristic) | `Documentation.md` ~296-302 @ a0aad62 |
| MetaNeighbor | validation | leave-one-dataset-out, mean AUROC over folds | `Documentation.md` ~144-147 @ a0aad62 |
| SAMap | `n_iterations`; `cross_species_k` | 3; 20 | `src/samap/_constants.py:16-17` @ 8ffeaec |
| SAMap | `k`; `distance`; `preprocessing`; `npcs`; `n_genes` | 20; cosine; StandardScaler; 150; 3000 | `src/samap/sam/core.py:679-683` @ 8ffeaec |
| SAMap | `weight_mode`; `seed` | rms; 0 | `src/samap/sam/core.py:687-688` @ 8ffeaec |
| SAMap | `hom_edge_mode`; `scale_edges_by_corr`; `backend` | pearson; True; auto | `src/samap/core/mapping.py` (`SAMAP.run` signature; `:111-120`) @ 8ffeaec |
| Seurat | `FindIntegrationAnchors` `dims`; `k.anchor`; `k.filter`; `k.score`; `max.features` | 1:30; 5; 200; 30; 200 | `R/integration.R:148-152` (local copy) |
| Seurat | `FindTransferAnchors` `k.filter`; `k.anchor`, `k.score`, `max.features` | NA; 5, 30, 200 | `R/integration.R:780-783` (local copy) |
| scANVI | `n_hidden`; `n_latent`; `n_layers`; `dropout_rate` | 128; 10; 1; 0.1 | `src/scvi/model/_scanvi.py:119-122` (local copy; remote HEAD 5555ecc) |
| scANVI | `dispersion`; `gene_likelihood`; `linear_classifier` | gene; zinb; False | `src/scvi/model/_scanvi.py:123-126` (local copy) |

## 5. Proposed singlet approach

- **Routes.** Port all four methods; licences are in section 12, and scANVI's networks are PyTorch.
- **Default.** `metaneighbor` is published, needs no training and has a documented candidate rule. Its cross-species use extends a within-study design [R1], so B1 decides whether the default holds.
- **Model-based proposal.** The latent-type model of section 3 is fitted by variational inference on pseudo-species pairs (B2), with expert pairs (B1) held out from fitting. It enters the enum only when its code exists. It becomes the default only if it meets the B1 and B2 criteria and has a B2 expected calibration error of at most 0.05. It is falsified if the best heuristic beats its B1 top-1 concordance by at least 0.05 (both thresholds proposed).
- **ML stack.** PyTorch for the variational model and scANVI. Hand-written CUDA or cuSPARSE for MetaNeighbor voting, a sparse-by-dense product of the rank-weighted neighbour graph and the label indicator matrix.
- **Kernels and devices.** Per-cell rank transforms, neighbour voting and approximate mutual-nearest-neighbour search with the seed fixed. CPU and CUDA; scANVI training needs CUDA at atlas scale. The dense MetaNeighbor network does not stream; the other methods process the ortholog-restricted matrix whole.
- **Defaults without asking.** `method` metaneighbor; `min_cells_per_type` 10 (singlet design); `conserved_threshold` null; `seed` 0; `device` auto. Ask for `label_key`, `partner.source` and `conserved_threshold`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts of both atlases (scanvi) |
| read | layers/normalized | sparse float32 | log-normalised values of both atlases (other methods) |
| read | obs/<label_key> | categorical | labels in both atlases; species-B key is `partner.label_key` |
| read | var/<gene_id> | string | gene identifiers, matched through the ortholog table |
| read | uns/ortholog_pairs | table | one-to-one orthologs from cross-species ortholog assignment |
| read | obsm/X_pca | float32 | optional embedding for samap and seurat_anchors |
| write | uns/cross_species_matrix_<method> | float32 matrix | type-by-type scores; species-A rows, species-B columns |
| write | obs/best_match_<method> | categorical | best species-B type of each cell's species-A type |
| write | uns/conserved_flags_<method> | record | per-type best match, reciprocal top hit, flag, threshold |
| write | uns/correspondence_params_<method> | record | method, partner handle, ortholog count, threshold, seed |
| write | models/<name> | model | scANVI model, written only for scanvi |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Species-A dataset handle: a .singlet path or URI, or a workspace handle. Outputs are written here only. |
| `label_key` | string | required | — | Species-A obs column with cell-type labels. |
| `partner` | object | required | — | Species-B atlas, read-only. |
| `partner.source` | string | — | — | Species-B .singlet path, URI or workspace handle. |
| `partner.label_key` | string | — | — | Species-B obs column with cell-type labels. |
| `method` | string | "metaneighbor" | `metaneighbor`, `samap`, `seurat_anchors`, `scanvi` | Scorer. metaneighbor is the default heuristic; scanvi gives posterior probabilities. |
| `conserved_threshold` | number/null | null | — | Score at or above which a best match is flagged conserved; null writes no flags. Reciprocal top hits are always reported. |
| `min_cells_per_type` | integer | 10 | min 1 | Types with fewer cells in either atlas are excluded from scoring. |
| `method_options` | object | — | — | Options for the chosen method; each nested object applies only to the method it is named after. |
| `method_options.metaneighbor` | object | — | — |  |
| `method_options.metaneighbor.auroc_candidate_threshold` | number | 0.9 | — | AUROC above which a pair is a candidate; a documented within-study heuristic. |
| `method_options.metaneighbor.reciprocal_top_hit` | boolean | true | — | Report reciprocal best matches as candidate conserved pairs. |
| `method_options.samap` | object | — | — |  |
| `method_options.samap.k` | integer | 20 | — | Neighbours in each species manifold. |
| `method_options.samap.cross_species_k` | integer | 20 | — | Cross-species edges kept per cell. |
| `method_options.samap.n_iterations` | integer | 3 | — | SAMap alignment iterations. |
| `method_options.samap.npcs` | integer | 150 | — | Principal components per species. |
| `method_options.samap.n_genes` | integer | 3000 | — | Highly variable genes per species. |
| `method_options.seurat_anchors` | object | — | — |  |
| `method_options.seurat_anchors.dims` | integer | 30 | — | CCA dimensions 1 to dims used to find anchors. |
| `method_options.seurat_anchors.k_anchor` | integer | 5 | — | Neighbours used to find anchors. |
| `method_options.seurat_anchors.k_filter` | integer | 200 | — | Neighbours used to filter anchors. |
| `method_options.seurat_anchors.k_score` | integer | 30 | — | Neighbours used to score anchors. |
| `method_options.seurat_anchors.max_features` | integer | 200 | — | Maximum features used for anchor scoring. |
| `method_options.scanvi` | object | — | — |  |
| `method_options.scanvi.n_hidden` | integer | 128 | — | Hidden units per encoder and decoder layer. |
| `method_options.scanvi.n_latent` | integer | 10 | — | Latent dimension of the variational model. |
| `method_options.scanvi.n_layers` | integer | 1 | — | Hidden layers. |
| `method_options.scanvi.dropout_rate` | number | 0.1 | — | Dropout rate in the networks. |
| `seed` | integer | 0 | — | Random seed for scanvi and samap. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members for the same method instead of failing. |
<!-- PARAMS:AUTO:END -->

`method_options` applies only to the method it names; other options are ignored and recorded in `uns/correspondence_params_<method>`. Types with fewer than `min_cells_per_type` cells in either atlas are excluded. `conserved_threshold` is on the scale of the chosen method, so flags are written only when it is set; reciprocal top hits are always written. Genes outside the ortholog table are dropped and counted. `seed` matters for scanvi and samap only.

## 7. MCP tool

Tool name `singlet_cross_species_cell_type_correspondence` (definition in `tasks/mcp/singlet_cross_species_cell_type_correspondence.json`).

```json
{"dataset": "/data/mouse_cortex.singlet", "label_key": "cell_type",
 "partner": {"source": "/data/human_cortex.singlet", "label_key": "cell_type"},
 "method": "metaneighbor", "conserved_threshold": 0.9}
```

```json
{"dataset": "/data/mouse_cortex.singlet", "status": "completed",
 "wrote": ["uns/cross_species_matrix_metaneighbor", "obs/best_match_metaneighbor",
           "uns/conserved_flags_metaneighbor", "uns/correspondence_params_metaneighbor"],
 "summary": {"method": "metaneighbor", "n_types_a": "<int>", "n_types_b": "<int>",
             "n_one_to_one_orthologs": "<int>", "n_reciprocal_top_hits": "<int>",
             "conserved_threshold": 0.9, "n_conserved": "<int>", "n_species_specific": "<int>", "warnings": []},
 "provenance_id": "<id>", "job_id": null}
```

Angle-bracket fields are placeholders. Long-running: the SAMap BLAST step (up to about four hours per the README) and scanvi training queue as jobs. Stochastic: scanvi and samap, through `seed`. Dry run returns seconds, peak memory and device for the chosen method and both atlas sizes.

## 8. Benchmarks

**Shared protocol.** Every method receives the same ortholog table, genes and types and returns a species-A-by-species-B matrix. Argmax ties go to the lexicographically smaller type name. Intervals are 95% bootstrap intervals over the cells of each type, or over planted types in B2. Stochastic methods use seeds 0 to 4. Each benchmark states only its differences from this protocol.

### B1. Expert homology agreement (published pairs)

- **Goal**: whether scorers recover expert homology partners in mouse-human cortex and reptile-mouse pallium.
- **Ground truth**: expert labels, one partner pair per matched type from the source studies; per type, not per cell.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Mouse and human cortex taxonomy | [R5] | snRNA-seq; mouse, human; — | — | matched types are the truth |
| Reptile and turtle pallium | [R6], [R8] | scRNA-seq; reptile; — | — | different species group |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Top-1 concordance | share of expert-matched types whose $\hat b(a)$ is the expert partner | higher, 0 to 1 | primary | [R5][R6] |
| Mean reciprocal rank | mean of $1/\mathrm{rank}$ of the expert partner in row $a$ | higher, 0 to 1 | primary | [R5] |
| Expert-match AUROC | AUROC over all type pairs, expert pairs positive | higher | guardrail | [R5] |

- **Comparators**: section 4 methods, defaults.
- **Protocol**: labels stay per atlas; the ortholog table is the only feature link; no expert pair enters training, tuning or thresholds.
- **Acceptance** (proposed): top-1 concordance at least 0.75 for mouse-human and 0.6 for reptile-mouse, with bootstrap intervals.
- **Known pitfalls**: expert calls use marker evidence the scorers never see, so a disagreement can reflect either side.

### B2. Planted correspondence (proposed)

- **Goal**: planted correspondence and absent types under controlled divergence.
- **Ground truth**: planted simulation; the generator fixes $\pi$ and $\mathcal N$.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue atlas, tissue fixed in advance | singlet catalogue | scRNA-seq; —; — | per source study | two pseudo-species |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Top-1 planted-match accuracy | share of planted-matched types with $\hat b(a)=\pi(a)$ | higher | primary | — |
| Absent-type AUROC | AUROC of $u_a=-\max_b S_{ab}$, absent types positive | higher | primary | — |
| Calibration error | expected calibration error of the best posterior; scanvi only | lower | guardrail | — |

- **Comparators**: as in B1.
- **Protocol** (generator recipe): (1) split the atlas into pseudo-species A and B; (2) rename B genes via the ortholog table and add per-type log-fold perturbations $\delta_{tg}\sim\mathcal N(0,\sigma^2)$ to a fraction $p$ of genes; (3) remove a fraction $q$ of B types; (4) thin library sizes at rate $r$ and change dropout; (5) score against $\pi$ and $\mathcal N$. Sweep $\sigma,p,q,r$ on a pre-set grid, all reported; five seeds per point.
- **Acceptance** (proposed): top-1 planted-match accuracy at least 0.9 at the mildest grid point; absent-type AUROC at least 0.85.
- **Known pitfalls**: small divergence is easy; shared generator and scorer assumptions inflate scores.

### P1. Performance and scaling

Wall time, peak resident memory and throughput (cells per second) at 1e4, 1e5 and 1e6 total cells across both atlases (proposed ladder), on CPU and CUDA where available, against the four comparators. Hold fixed the 3000-gene ortholog set, number of types, threads, seed and input. Report SAMap's BLAST step separately from its mapping step, and fit scaling exponents of time and memory against cell count on a log-log scale. MetaNeighbor's dense network is expected to grow faster than linear in memory (section 3).

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `cross-species.ortholog_assignment`: Gene orthology assignment across species
  - `cross-species.one_to_many_ortholog_harmonization`: Expression harmonization for one-to-many orthologs
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
- **Feeds**:
  - `cross-species.label_transfer`: Cross-species cell-type label transfer and reference mapping
  - `cross-species.expression_conservation`: Conserved versus divergent expression of orthologs within matched cell types
  - `annotation.cross_dataset_label_reconciliation`: Cross-dataset cell-type label reconciliation
- **Reads**: `layers/counts`, `layers/normalized`, `obs/<label_key>`, `var/<gene_id>`, `uns/ortholog_pairs`, `obsm/X_pca`
- **Writes**: `uns/cross_species_matrix_<method>`, `obs/best_match_<method>`, `uns/conserved_flags_<method>`, `uns/correspondence_params_<method>`, `models/<name>`
<!-- CHAINING:AUTO:END -->

No named workflow is assigned. Typical order: ortholog assignment and harmonisation, then this task, then label transfer or expression conservation.

## 10. Risks, pitfalls and open questions

- **Evidence not extracted.** The expert partner table of the Hodge et al. [R5] and Tosches et al. [R6] studies, the Hodge accession, and the sizes and licences of both datasets are not in the sources used here. The metazoan atlases and their curated homology relations are absent, so no SAMap benchmark is proposed. The species composition of the catalogue is unknown.
- **Unsettled literature.** Whether MetaNeighbor AUROC measures cross-species homology or within-study replicability is not established. The granularity mismatch is unsolved (section 2). The 2023 cross-species integration benchmark [R7] has no extracted results. Pseudobulk correlation is not a listed comparator because its procedure is not in the sources used here.
- **Source-state risks.** Seurat defaults come from a local copy at a commit that is not recorded; the recorded remote HEAD is 5f67c70. The label-classifier weighting of scANVI was not checked against [R4].
- **First experiment.** Score MetaNeighbor and SAMap on B1 with the ortholog table of section 6, then the B2 sweep at its mildest grid point. The default changes only if a model-based option meets the B1 criteria.

## 11. References

R1. Crow M, et al. Characterizing the replicability of cell types defined by single cell RNA-sequencing data using MetaNeighbor. *Nature Communications* 2018. doi:10.1038/s41467-018-03282-0 — verified (corpus)
R2. Tarashansky AJ, Xue Y, Zhou P, et al. Mapping single-cell atlases throughout Metazoa unravels cell type evolution. *eLife* 2021;10:e66747. doi:10.7554/elife.66747 — verified (corpus)
R3. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R4. Xu C, Lopez R, Mehlman E, Regier J, Jordan MI, Yosef N. Probabilistic harmonization and annotation of single-cell transcriptomics data with deep generative models. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209620 — verified (corpus)
R5. Hodge RD, et al. Conserved cell types with divergent features in human versus mouse cortex. *Nature* 2019;573:61-68. doi:10.1038/s41586-019-1506-7 — partial (search)
R6. Tosches MA, Yamawaki TM, Naumann RK, Jacobi A, Tushev G, Laurent G. Evolution of pallium, hippocampus, and cortical cell types revealed by single-cell transcriptomics in reptiles. *Science* 2018;360(6391):881-888. — partial (search)
R7. Benchmarking strategies for cross-species integration of single-cell RNA sequencing data. *Nature Communications* 2023. doi:10.1038/s41467-023-41855-w — verified (corpus)
R8. Reptile and turtle pallium single-cell RNA-seq datasets, Edmond repository. doi:10.17617/3.OODZLY — partial (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/gillislab/MetaNeighbor | Megan Crow (author, creator); Stephan Fischer (maintainer), per DESCRIPTION | MIT. LICENSE reads "Copyright (c) 2017 mm-shah"; DESCRIPTION reads "MIT + file LICENSE" | MetaNeighbor scorer, version 1.25.0 | port |
| https://github.com/atarashansky/SAMap | Repository owner atarashansky; paper first author Alexander J. Tarashansky (README citation) | MIT (LICENSE, copyright 2020 atarashansky; pyproject.toml) | SAMap mapping score; version 3.0.1 in pyproject.toml, 3.0.0 in the README header | port |
| https://github.com/satijalab/seurat | Satija Lab, NYGC (README); Authors@R in DESCRIPTION | MIT + file LICENSE (DESCRIPTION); LICENSE copyright 2021 Seurat authors | anchor mapping (FindIntegrationAnchors, FindTransferAnchors) | port |
| https://github.com/scverse/scvi-tools | Yosef Lab, Weizmann Institute of Science (LICENSE copyright line) | BSD 3-Clause (LICENSE); version 1.5.1 in pyproject.toml | scANVI model | port |
