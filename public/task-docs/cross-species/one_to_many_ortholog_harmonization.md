---
id: cross-species.one_to_many_ortholog_harmonization
title: Expression harmonization for one-to-many orthologs
area: cross-species
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [cross-species.ortholog_assignment, harmonization.gene_identifier_mapping]
feeds: [cross-species.label_transfer, cross-species.joint_embedding_integration, cross-species.expression_conservation]
reads: [layers/counts, obs/species, uns/ortholog_table]
writes: [layers/harmonized_counts, uns/harmonization_report]
devices: [cpu, cuda]
mcp_tool: singlet_cross_species_one_to_many_ortholog_harmonization
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Expression harmonization for one-to-many orthologs

> Combines or weights the counts of several source genes that map to one shared feature, under a documented rule that reports what it keeps and what it biases.

## 1. Question

When one gene in one species maps to several genes in another, how should their counts be summed, averaged, selected or weighted into shared features so that cross-species comparisons are fair? A correct answer states which signal each rule keeps and which it removes, given gene-by-cell counts from two or more species and an ortholog table labelled one-to-one, one-to-many or many-to-many, and returns cells by shared features with the rule and its coverage recorded.

## 2. Why this task matters and where the field stands

Ortholog tables often contain one-to-many relations. Genome duplication is a trait shared by 22,000 ray-finned fish species [R8], and resources such as HCOP [R7] classify relations as one-to-one, one-to-many or many-to-many. A one-to-one filter removes those gene families from every comparison, while collapsing them changes what a shared feature measures.

Status: **contested**. Methods disagree on whether paralog counts should be summed, averaged, selected or kept as a soft graph, and published comparisons do not settle it. Song et al. compared mapping strategies crossed with integration algorithms [R2]. Open problems:

- No benchmark isolates the collapse rule; downstream scores mix it with the integration algorithm and the embedding [R1].
- Sums match total expression, means match the per-paralog rate and selection matches the specificity of one copy. The field has not chosen a target quantity.
- Reads that multi-map between paralogs are ambiguous before counts exist. simpleaf documentation notes that UMIs from very small barcodes are typically ambiguous between paralogous genes and are removed by QC filtering [R10], so the independence assumption of section 3 fails upstream.

## 3. Theory and insight

Let $X \in \mathbb{Z}_{\ge 0}^{n \times G_A}$ hold UMI counts for $n$ cells and $G_A$ source genes, and let $P(g)$ be the source paralogs of shared feature $g$. A linear rule is a non-negative map

$$X' = X W, \qquad X'_{cg} = \sum_{i} X_{ci} W_{ig}, \qquad W \in \mathbb{R}_{\ge 0}^{G_A \times G_B}.$$

One-to-one, sum and mean are linear, with $W$ a 0/1 or $1/|P|$ pattern. Selection fixes $W$ from the data, and max is a per-cell non-linear reduction that no fixed $W$ reproduces.

**Sum.** If paralog counts are independent Poisson with means $\mu_i$ given cell state and a shared size factor, then

$$\sum_{i \in P(g)} x_i \sim \mathrm{Poisson}\Big(\sum_{i \in P(g)} \mu_i\Big).$$

This is exact under those assumptions. Overdispersion and multi-mapping break the distribution, but $\mathbb{E}[\sum_i x_i] = \sum_i \mu_i$ holds by linearity whatever the dependence.

**Mean.** $\mathbb{E}[\bar x_P] = \frac{1}{|P|}\sum_{i \in P}\mu_i$, and under independent Poisson counts $\mathrm{Var}(\bar x_P) = \frac{1}{|P|^2}\sum_{i \in P}\mu_i$. The mean keeps the scale of one gene; its variance shrinks with $|P|$ only while independence holds.

**Max.** For any random variables, $\mathbb{E}[\max_{i \in P} x_i] \ge \max_{i \in P}\mathbb{E}[x_i]$, since each $x_j$ is at most the maximum. Max is upward-biased and favours genes with many paralogs and sparse, noisy counts.

**Selection.** Choosing the paralog with the highest expression on the cells that are also scored makes the choice depend on the scored counts, which inflates agreement. Choosing on disjoint cells removes this leak.

**Soft methods.** SAMap's gene-gene graph [R3] and SATURN's macrogene assignment [R5] defer the choice to a graph or a fitted model. They avoid a hard collapse but make the rule harder to interpret and its uncertainty harder to state.

**Model-based form.** Learning $W$ with a softmax over the paralogs of each target, $W_{ig} = \exp(\theta_i) / \sum_{j \in P(g)} \exp(\theta_j)$, makes each target a convex combination of its paralogs. The target then keeps the scale of one gene while the split among paralogs is fitted. Section 5 gives the objective.

Estimands, one sentence each:

- $X'_{cg}$ is the total UMI count of the source genes mapped to shared feature $g$ in cell $c$, before size-factor normalisation.
- Retained gene fraction is the number of source genes with a non-zero row of $W$, divided by the number of source genes of that species.
- Balanced accuracy is the unweighted mean over cell types of the recall of species-2 labels within each type.
- Graph connectivity is the mean over labels of the largest connected component of each label's kNN subgraph, divided by that label's cell count, so every label counts equally.
- Species mixing is the mean over cells of the fraction of their nearest neighbours that come from another species.

The moment and closure statements assume the stated count model, and benchmark conclusions hold only for the species pairs and correspondence tables tested. The collapse is a choice of $W$, and that choice trades bias against coverage, so every score must be reported with its coverage.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| One-to-one only | heuristic | Keep source genes with at most `max_orthologs` target matches | [R9] |
| Sum | heuristic | Add paralog counts within each cell | — |
| Mean | heuristic | Average paralog counts within each cell | — |
| Max | heuristic | Per-cell maximum over paralogs | — |
| Select by expression | heuristic | Keep the paralog with the highest mean expression, chosen on held-out cells | [R2] |
| SAMap homology graph | hybrid | Reciprocal-BLAST gene graph, reweighted and filtered, used as soft weights | [R3], [R4] |
| SATURN macrogenes | model-based | Protein-embedding macrogene assignment with an L1 penalty, trained with a VAE and metric learning | [R5] |
| CellHint 1:N weighting | heuristic | Divides a one-to-many cell-type weight across its matches; cell-type level | [R6] |

Keeping one-to-one orthologs, with a threshold of one, is liana-py's default [R9], and defaults differ across tools. Sum, mean and max are elementary operators from section 3 with no published implementation cited. Selection follows the expression-based strategy Song et al. compared [R2]. SAMap [R3] and SATURN [R5] are the soft standards; SAMap's graph-level maximum is an edge-weight rule, not a count rule. CellHint [R6] weights cell types, not genes, and is a callout only.

Defaults for the methods singlet implements:

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| One-to-one only | `max_orthologs` | 1 | liana-py `src/liana/resource/_orthology.py:87` (corpus copy) |
| One-to-one only (decoupler translate) | one-to-many threshold | 5 | decoupler `src/decoupler/op/_translate.py:117` (corpus copy) |
| One-to-one only (OmniPathR) | threshold when NULL | no filter | OmniPathR `R/orthology.R:341-345` (corpus copy) |
| SAMap homology graph | BLAST e-value threshold | 1e-6 | SAMap `src/samap/_constants.py:6` @ 8ffeaec |
| SAMap homology graph | edge filter, fraction of row maximum | 0.25 | `src/samap/_constants.py:7`, `src/samap/core/homology.py:236` @ 8ffeaec |
| SAMap homology graph | reciprocal BLAST | True | `src/samap/core/mapping.py:182` @ 8ffeaec |
| SAMap homology graph | tanh scale; centre | 10; 0.5 | `src/samap/core/homology.py:27` @ 8ffeaec |
| SAMap homology graph | tanh centre at other call sites | 0.7 | `src/samap/core/projection.py:113`, `src/samap/core/coarsening.py:93` @ 8ffeaec |
| SAMap alignment (callout) | genes; principal components | 3000; 150 | `src/samap/sam/core.py:683`, `:682` @ 8ffeaec |
| SATURN macrogenes | `hv_genes` | 8000 | SATURN README line 62; `train-saturn.py:1014` @ 6906abf |
| SATURN macrogenes | `num_macrogenes` | none, required | `train-saturn.py:921-922` @ 6906abf |
| SATURN macrogenes | embedding model | none; choices ESM1b, MSA1b, protXL, ESM1b_protref, ESM2 | `train-saturn.py:925` @ 6906abf |
| Select by expression | selection split | heldout_cells | singlet design, section 5 |

## 5. Proposed singlet approach

Routes. **Port** under the permissive licences in section 12: the one-to-one filter, the SAMap homology graph (construction, reweighting and row filter), and the SATURN macrogene model, kept in PyTorch. **Reimplement** sum, mean, max and select_expression from the section 3 definitions. **Callout** only: CellHint weighting and SAMap's manifold alignment, used as comparators.

Default. `one_to_one` with `max_orthologs` 1. It makes no paralog assumption, and the report exposes the coverage it loses. A model-based route becomes the default only if it meets the B1 acceptance rule against `one_to_one`.

Proposed model-based route. Learn $W$ with the per-target softmax of section 3, fitted by a cross-species label-transfer loss on matched cell-type means, with an L1 penalty on $W$ for sparsity. Uncertainty comes from a Dirichlet posterior over each target's weights or from an ensemble of seeds. The route enters the MCP enum only once it is implemented and benchmarked. It is falsified if its B1 gain over `one_to_one` is smaller than its spread across seeds, or if the top paralog of most targets changes between seeds.

ML stack. PyTorch fits $W$ (autograd, mini-batches over cells). Hard-coded CUDA or cuSPARSE kernels cover the fixed forms: the sparse-dense product $XW$ and segment sum, mean and max over paralog groups.

Devices. Fixed-form rules stream over cell chunks on CPU and CUDA. `saturn_macrogene` trains on GPU, and `samap_graph` needs BLAST on the PATH.

Defaults an agent should use without asking: `collapse` one_to_one, `max_orthologs` 1, `device` auto, `seed` 0.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse integer | Raw UMI counts, one matrix per species over its source genes |
| read | obs/species | categorical | Species of each cell; two or more levels |
| read | uns/ortholog_table | table | `source_species`, `source_gene`, `target_gene`, `relation`; HCOP is the corpus resource [R7] |
| write | layers/harmonized_counts | sparse float32 | Cells by shared features; feature names are recorded in the report |
| write | uns/harmonization_report | dict | Rule, retained gene fraction, shared feature count, paralog group sizes |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI, or a workspace handle; must hold per-species counts and obs/species. |
| `layer` | string | "counts" | — | Count layer to harmonize; raw UMI counts over each species' source genes. |
| `ortholog_table` | string | "uns/ortholog_table" | — | Member holding the ortholog table with relation labels one_to_one, one_to_many, many_to_one or many_to_many. |
| `collapse` | string | "one_to_one" | `one_to_one`, `sum`, `mean`, `max`, `select_expression`, `samap_graph`, `saturn_macrogene` | Harmonization rule. one_to_one is the default baseline; prefer samap_graph or saturn_macrogene when coverage matters. |
| `max_orthologs` | integer | 1 | min 1 | Maximum paralogs per source gene before the gene is dropped; applies to one_to_one, sum, mean and max. |
| `select_expression` | object | — | — | Options for select_expression: the paralog is chosen on cells outside the evaluated set. |
| `select_expression.selection_split` | string | "heldout_cells" | `heldout_cells` | Cells used to choose the paralog; must be disjoint from the cells that are evaluated. |
| `samap` | object | — | — | Options for samap_graph: reciprocal-BLAST homology graph, reweighting and row filter. |
| `samap.eval_threshold` | number | 1e-06 | min 0 | BLAST e-value threshold for homology edges. |
| `samap.filter_threshold` | number | 0.25 | min 0; max 1 | Keep an edge only if it is at least this fraction of its gene's strongest edge. |
| `samap.tanh_centre` | number | 0.5 | `0.5`, `0.7` | Centre of the tanh edge reweighting; SAMap uses 0.7 at two other call sites. |
| `saturn` | object | — | — | Options for saturn_macrogene; num_macrogenes has no default and must be set. |
| `saturn.hv_genes` | integer | 8000 | min 1 | Highly variable genes kept per species before embedding. |
| `saturn.num_macrogenes` | integer | — | min 1 | Number of macrogenes, the shared features; required, no default. |
| `saturn.embedding_model` | string | — | `ESM1b`, `MSA1b`, `protXL`, `ESM1b_protref`, `ESM2` | Protein language model that embeds each gene's protein; no default. |
| `seed` | integer | 0 | — | Random seed for saturn_macrogene training and the select_expression split. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`collapse` selects the rule, and `max_orthologs` applies only to one_to_one, sum, mean and max. `select_expression.selection_split` must be disjoint from the evaluated cells. The `saturn` options are required when `collapse` is `saturn_macrogene`, and `num_macrogenes` has no default. The `samap` options apply only to `samap_graph`. Gene symbols absent from the ortholog table are dropped and counted in the report.

## 7. MCP tool

Tool name `singlet_cross_species_one_to_many_ortholog_harmonization` (definition in `tasks/mcp/singlet_cross_species_one_to_many_ortholog_harmonization.json`). Example call and result:

```json
{"dataset": "/data/ah_atlas.singlet", "collapse": "sum", "max_orthologs": 3}
```

```json
{"dataset": "/data/ah_atlas.singlet", "status": "completed",
 "wrote": ["layers/harmonized_counts", "uns/harmonization_report"],
 "summary": {"rule": "sum", "retained_gene_fraction": "<float>", "n_shared_features": "<int>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: `samap_graph` (BLAST) and `saturn_macrogene` (GPU training) may return `queued` with a `job_id`. Stochastic: `seed` controls `saturn_macrogene` and the `select_expression` split; the other rules are deterministic. Dry run: `dry_run` returns time, peak memory and device in `estimate` without writing.

## 8. Benchmarks

Shared protocol. All rules start from the same source counts, ortholog table and gene set, on fixed hardware and seed. Each score is reported with `retained_gene_fraction`, so no score is read without its coverage. Feature counts are fixed or reported per rule. Stochastic rules use three seeds and report mean and spread. No rule is tuned on the test species. Acceptance thresholds in B1 and B2 are design proposals, not literature values.

### B1. Cross-species cell-type label transfer after harmonization

- **Goal**: test whether harmonized features keep cross-species cell-type identity, measured by label transfer between species.
- **Ground truth**: expert labels. Each cell's label is the author annotation of the held-out species, mapped through a fixed, user-supplied correspondence table that the SATURN repository's scoring section describes.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 5 Species Alignment of Aqueous Humor Outflow (AH) Atlas | SATURN repository download list (section 12) | five species; cells — | — | `http://snap.stanford.edu/saturn/data/ah_atlas_export.tar.gz` |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| `balanced_accuracy` | Unweighted mean over cell types of per-type recall, for a logistic-regression classifier trained on species-1 harmonized features and tested on species-2 labels | maximize | primary | — |
| `accuracy` | Fraction of species-2 cells whose predicted label equals the mapped reference label | maximize | guardrail | — |
| `retained_gene_fraction` | Source genes entering the harmonized feature set divided by all source genes of the species | maximize | guardrail | — |

- **Comparators**: one-to-one only; sum; mean; max; select by expression; SAMap homology graph; SATURN macrogenes; no harmonization (shared gene-symbol intersection).
- **Protocol**: fit on species 1 and test on species 2, then swap. Use the fixed correspondence table and score as the SATURN scoring script does (`score_adata.py:869`). Use three seeds, reporting mean and spread, and fix or report the feature count.
- **Acceptance criterion** (proposed): balanced accuracy is not lower than the one-to-one baseline by more than 0.01 absolute, and `retained_gene_fraction` is at least 0.9 of the baseline's.
- **Known pitfalls**: class imbalance, which is why balanced accuracy is primary; and SATURN with `use_ref_labels` (`train-saturn.py:968`) trains on reference labels, so it cannot be scored on them as if unsupervised.

### B2. Species mixing and biology conservation after integration

- **Goal**: test whether the harmonized space mixes species without erasing cell-type structure, using one embedding recipe for every rule.
- **Ground truth**: orthogonal measurement for batch (species label) and author cell-type labels for biology. Graph connectivity is computed per cell-type label on its kNN subgraph.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| AH atlas, as in B1 | SATURN repository download list (section 12) | five species; cells — | — | Same cells and labels as B1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| `graph_connectivity` | Mean over labels of the largest connected component of the kNN subgraph restricted to that label, divided by the label's cell count; range (0,1] | maximize | primary | [R1] |
| `species_mixing` | Mean over cells of the fraction of their k nearest neighbours from the other species, with k fixed for all rules | maximize | primary | — |

- **Comparators**: as in B1.
- **Protocol**: embed each harmonized matrix with identical PCA and neighbour settings, fixed before any rule is compared. Do not tune per rule. Report both metrics and `retained_gene_fraction`.
- **Acceptance criterion** (proposed): no rule loses more than 0.02 in `graph_connectivity` relative to `one_to_one` while raising `species_mixing` above the `one_to_one` value.
- **Known pitfalls**: species is confounded with cell-type composition, so high mixing can be spurious; and graph connectivity depends on the neighbour count.

### P1. Performance and scaling

Measure wall time and peak memory to build the harmonized matrix at 10k, 100k and 1M cells, on CPU and CUDA, for each collapse rule, for the SAMap alignment callout at its defaults (section 4), and for SATURN training at `hv_genes` 8000. The fixed-form rules are a sparse product or segment reductions, so cost should scale with nnz(X) times mean paralog degree (section 3). Hold the gene set, ortholog table, hardware and seed fixed. Report memory and time separately.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `cross-species.ortholog_assignment`: Gene orthology assignment across species
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
- **Feeds**:
  - `cross-species.label_transfer`: Cross-species cell-type label transfer and reference mapping
  - `cross-species.joint_embedding_integration`: Cross-species integration into a shared embedding
  - `cross-species.expression_conservation`: Conserved versus divergent expression of orthologs within matched cell types
- **Reads**: `layers/counts`, `obs/species`, `uns/ortholog_table`
- **Writes**: `layers/harmonized_counts`, `uns/harmonization_report`
<!-- CHAINING:AUTO:END -->

Workflow: ortholog assignment, then this harmonization, then label transfer or joint embedding. No named recipe is assigned in the catalogue index.

## 10. Risks, pitfalls and open questions

- **Unverified details.** The ranking of mapping strategies in Song et al. [R2] is not confirmed; only the design is (28 combinations of three mapping strategies with nine integration algorithms). The BENGAL pipeline was not checked. SATURN's resolution of one gene symbol mapping to several proteins is not documented here, and the sign of its gene-to-macrogene weights is unverified, so the adapter must enforce a non-negative $W$. Line references for liana-py, decoupler, OmniPathR and CellHint point to corpus copies with no recorded commit.
- **Data.** The AH atlas licence and cell counts are unknown. Whether the catalogue's annotated cells overlap these species is unverified. Conserved-marker concordance is not published here because it has no marker source or numeric threshold. Metric definitions for asw_batch, lisi, kbet, asw_label and isolated_label_f1 are not given here, so those scores are not used.
- **Unsettled science and risks.** No benchmark isolates the rule, and the target quantity (total expression, per-paralog rate or copy specificity) is open. Duplicates can subfunctionalise, so summing can erase real divergence. Selection leaks when choice and scoring share cells. Ortholog table versions change mappings silently, and HCOP is the only ortholog resource confirmed in the corpus [R7].
- **First experiment.** On the AH atlas, compare `one_to_one`, sum, mean, `select_expression` on held-out cells, `samap_graph` and `saturn_macrogene` on B1 and B2, reporting `retained_gene_fraction` with each score. Set the default only if the acceptance criteria hold.

## 11. References

R1. Luecken MD, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)

R2. Song Y, Miao Z, Brazma A, Papatheodorou I. Benchmarking strategies for cross-species integration of single-cell RNA sequencing data. *Nature Communications* 2023. doi:10.1038/s41467-023-41855-w — verified (corpus)

R3. Tarashansky AJ, et al. Mapping single-cell atlases throughout Metazoa unravels cell type evolution. *eLife* 2021. doi:10.7554/elife.66747 — verified (corpus)

R4. Tarashansky AJ, Xue Y, Li P, Quake SR, Wang B. Self-assembling manifolds in single-cell RNA sequencing data. *eLife* 2019. doi:10.7554/elife.48994 — verified (corpus)

R5. Rosen Y, et al. Toward universal cell embeddings: integrating single-cell RNA-seq datasets across species with SATURN. *Nature Methods* 2024. doi:10.1038/s41592-024-02191-z — verified (corpus)

R6. Xu C, et al. Automatic cell-type harmonization and integration across Human Cell Atlas datasets. 2023. doi:10.1016/j.cell.2023.11.026 — verified (corpus)

R7. Yates B, Gray KA, Jones TEM, Bruford EA. Updates to HCOP: the HGNC comparison of orthology predictions tool. *Briefings in Bioinformatics* 2021. doi:10.1093/bib/bbab155 — verified (corpus)

R8. Taylor JS, Braasch I, Frickey T, Meyer A, Van de Peer Y. Genome duplication, a trait shared by 22,000 species of ray-finned fish. *Genome Research* 2003. doi:10.1101/gr.640303 — partial (search)

R9. Dimitrov D, et al. LIANA+: cell-cell communication framework. liana-py repository, github.com/saezlab/liana-py. 2025. — partial (repo)

R10. COMBINE-lab. simpleaf documentation, quantification command (docs-site, quant-command.md), github.com/COMBINE-lab/simpleaf. — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/saezlab/liana-py | Daniel Dimitrov and co-authors (pyproject.toml); copyright line in LICENSE | BSD-3-Clause | One-to-many threshold default | port |
| https://github.com/atarashansky/SAMap | Alexander J. Tarashansky (pyproject.toml) | MIT | Homology graph, reweighting and filter; alignment as callout | port (graph); callout (alignment) |
| https://github.com/snap-stanford/saturn | Yanay Rosen (LICENSE) | MIT | Macrogene model, training defaults, scoring script | port |
| https://github.com/Teichlab/cellhint | Teichmann Lab (LICENSE); Chuan Xu (setup.py) | MIT | Cell-type 1:N weighting reference | callout |
| https://github.com/scverse/decoupler | scverse (LICENSE, pyproject.toml) | BSD-3-Clause | Translate default for the one-to-many threshold | callout |
| https://github.com/saezlab/OmniPathR | Saez Lab (copyright holder in LICENSE) | MIT (DESCRIPTION) | Behaviour when the threshold is NULL | callout |
| https://github.com/COMBINE-lab/simpleaf | COMBINE-lab | BSD-3-Clause (LICENSE) | Note on ambiguous UMIs in very small barcodes | callout |
