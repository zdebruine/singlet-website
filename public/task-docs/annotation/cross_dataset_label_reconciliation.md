---
id: annotation.cross_dataset_label_reconciliation
title: Cross-dataset cell-type label reconciliation
area: annotation
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [annotation.cell_ontology_mapping, harmonization.gene_identifier_mapping, normalization.variance_stabilizing_transform]
feeds: [annotation.reference_label_transfer, annotation.hierarchical_annotation, integration.partial_label_integration]
reads: [layers/normalized, layers/counts, obs/<dataset_key>, obs/<label_key>, obsm/<use_rep>, var/<gene_id>, uns/cell_ontology]
writes: [uns/harmonisation/relations, uns/harmonisation/dataset_order, obs/harmonised_label, obs/harmonised_parent, obs/harmonised_relation_confidence, models/cellhint_pct_<dataset>]
devices: [cpu, cuda]
mcp_tool: singlet_annotation_cross_dataset_label_reconciliation
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Cross-dataset cell-type label reconciliation

> Given the author cell-type labels of two or more studies, decide which labels denote the same population, a broader or narrower one, or a study-specific one, and give every cell one harmonised label and parent.

## 1. Question

Given cells from two or more studies, each with its own author labels (free text, at different granularities), which label pairs denote the same population, a broader or narrower one, or a population specific to one study, and which harmonised label and parent does each cell receive? A correct answer matches the relations an expert would draw from the populations and gives the cells of one population the same harmonised label in every study. Expert relation tables are rare, so accuracy is measured against planted or ontology-based truth (section 8).

## 2. Why this task matters and where the field stands

Multi-study atlases need one vocabulary, but author labels differ in wording, granularity and scope, so cell-type queries across studies are unreliable until the labels are reconciled [R1]. The catalogue lists the task as **contested**: published methods disagree on what the output is. They include replicability scores that yield no relation [R2], thresholded relations between cell-to-type distance profiles [R1], hierarchies learned from cross-study relations [R3], ontology-scored classifiers [R4] and consensus votes with ontology ancestors [R5].

Open problems:

- **Few relation benchmarks.** Benchmarks of automatic cell identification score cell-level labels, not relations between vocabularies [R13][R14]. The CellHint paper reports that its immune-dataset results recapitulate expert-curated annotations [R1], but its expert relation table is not available to this document (section 10).
- **Crossing partitions.** Two studies may split one population along different axes. A tree or a parent-child list cannot represent this, and no method in section 4 represents it explicitly.
- **Order dependence.** Greedy pairwise alignment depends on the order in which studies are added [R1].
- **No shared populations.** When studies share no populations, the Cell Ontology is the main extra source of identifiability [R4][R5]. Labels without a CL term need an explicit policy.

## 3. Theory and insight

Study $e$ has label set $V_e$. Cell $i$ has study $s(i)$ and author label $\ell_i\in V_{s(i)}$. A relation links label $a$ of one study to label $b$ of another as one-to-one, one-to-many, many-to-one or novel. Outputs are a relation table, a harmonised label $h_i$ and a parent $p_i$ per cell.

**Neighbour voting (MetaNeighbor).** For study $e$ and candidate type $c$ from other studies,

$$s^{(e)}_{i,c}=\frac{\sum_j W_{ij}\,\tilde Y^{(e)}_{jc}}{\sum_j W_{ij}},$$

where $W$ holds rank-transformed Spearman correlations between cells (ranks divided by their maximum), $\tilde Y^{(e)}$ zeroes votes from study $e$, and the denominator is the full degree of $i$ [R2]. The replicability score is the Mann–Whitney AUROC,

$$\mathrm{AUROC}_{e,c}=\frac{1}{n^-_{e,c}}\Big(\frac{R^+_{e,c}}{n^+_{e,c}}-\frac{n^+_{e,c}+1}{2}\Big),$$

with $R^+$ the rank sum of the $n^+$ type-$c$ cells of study $e$ among all its cells and $n^-$ the rest. Its estimand is the probability that a random type-$c$ cell outscores a random other cell; 0.5 is chance. The identity is exact with average ranks and needs both classes populated.

**Distance profiles and thresholded relations (CellHint).** For study $k$, cell $i$ and type $c$, $d_{ic}$ is the correlation distance to the type mean on log-normalised expression (Euclidean on an embedding), rank-transformed and scaled to its maximum [R1]. Per-cell assignments to the nearest type of the other study give row-normalised confusion fractions,

$$P^{12}_{cc'}=\frac{N^{12}_{cc'}}{\sum_{c''}N^{12}_{cc''}},$$

the share of study-1 cells of type $c$ assigned to $c'$ in study 2. Thresholds $\tau_u$ (unique), $\tau_d$ (divide) and $\nu$ (novel) define the relations: one-to-one if $P^{12}_{cc'}>\tau_u$, $P^{21}_{c'c}>\tau_u$ and the match is unique; one-to-many if $P^{12}_{cc'}>\tau_d$, $P^{21}_{c'c}>\tau_u$ and at least two $c''$ meet both conditions for $c$; novel if $\max_{c''}P^{21}_{c''c}<\nu$; many-to-one is symmetric. Thresholds come from a grid that minimises alignments per iteration. The output is discrete and uncalibrated, and it is informative only where populations separate in the representation.

**Hierarchical factorisation (scHPL).** The leaf probability factorises along its path $\pi(\ell)$ in the learned tree,

$$P(\ell\mid x)=\prod_{(p\to q)\in\pi(\ell)}P(q\mid x,\,p),$$

with one node classifier per node, a linear SVM, kNN or one-class SVM [R3]. Local errors are assumed independent. They compound along deep paths, and a wrong edge propagates to every descendant.

**Votes and ontology votes (popV).** The consensus label is a majority vote over $M$ classifiers, with the agreement count as score,

$$\hat y_i=\arg\max_a\sum_{m=1}^{M}\mathbb 1[\hat y^{(m)}_i=a],\qquad \mathrm{score}_i=\max_a\sum_{m=1}^{M}\mathbb 1[\hat y^{(m)}_i=a].$$

Ties go to the alphabetically first label, because the code applies `np.unique` and `argmax` (`popv/_utils.py:260-262`) [R5]. The ontology vote adds Cell Ontology ancestors to each candidate's score,

$$\hat a_i=\arg\max_{a\in\mathcal A_i}\big(s_i(a),\ \mathrm{depth}(a),\ \tau(a)\big),\qquad s_i(a)=\sum_m\mathbb 1[\hat y^{(m)}_i=a]+\sum_{m\in\mathcal O}\mathbb 1[a\in\mathrm{anc}(\hat y^{(m)}_i)],$$

where $\mathcal O$ is the OnClass classifier, whose prediction votes for ancestors. The intended $\tau(a)$ is an alphabetical tie-break on $a$. The code evaluates it on the loop variable, the label of the last classifier. The term is then identical for every candidate of a cell and never breaks a tie, so ties fall to dictionary insertion order. The same expression raises `ValueError` when that label's first character is not an ASCII letter and `TypeError` when the label is missing. It occurs in the ontology vote (`popv/annotation.py:250`) and in the parent vote (`popv/annotation.py:343`). $s_i(a)$ is an unnormalised count, not a probability.

**Predictive clustering trees (CellHint, `use_pct` only).** Splits maximise the reduction of multi-output variance of the distance profile, $\Delta(t)=V(t)-\sum_{s\in\{L,R\}}\frac{n_s}{n_t}V(s)$ with $V(t)=\sum_c\mathrm{Var}_{i\in t}(D_{ic})$, followed by F-test pruning. The code uses scikit-learn's multi-output squared-error tree criterion, which has this form (`cellhint/pct.py:63-64`).

**Proposed latent-population relation (singlet; not a published method).** Cells belong to latent populations $z_i\in\{1,\dots,K\}$ shared across studies, with prior $\pi_k$ and study-specific emissions $\Theta^{(s)}_{ka}=P(\ell=a\mid z=k,s)$. The probability that a cell labelled $a$ in study $s$ carries label $b$ in study $s'$ is

$$P(\ell'=b\mid\ell=a)=\sum_k\frac{\pi_k\,\Theta^{(s)}_{ka}}{\sum_{k'}\pi_{k'}\Theta^{(s)}_{k'a}}\;\Theta^{(s')}_{kb},$$

normalised over $b$. It needs labels conditionally independent of study given $z$, overlapping populations and enough cells per label. Identifiability is the main risk. Dawid–Skene-type models [R17] estimate emissions from several labels per item. A catalogue cell carries one author label from one study, so identification must come from the shared expression model and the ontology prior.

**Insight.** A discrete relation is a thresholded shadow of a continuous population overlap. CellHint keeps the discrete step short and auditable. MetaNeighbor and popV give scores rather than relations, and model-based methods need calibration checks. Ontology structure helps only for labels with a CL term.

**Assumptions and failure modes.** Vocabularies are nested or one-to-one at the populations they name. Populations overlap in the shared representation, and batch effects are small relative to type separation (scHPL advises aligning studies first [R3]). Labels denote cell types, not states or conditions. Rare types give unstable centroids and small confusion counts. Greedy alignment is order dependent. High replicability can hold for parent–child pairs. Harmonised labels built from the same author labels as the truth are circular.

**Estimands.** Relation calls are the discrete overlap class of two labels, scored per study pair and relation type. The harmonised label $h_i$ is the vocabulary term of cell $i$; cells without a term are counted as unassigned, not dropped. Per-cell confidence is the CellHint row fraction $P^{12}$ or, for popV, the agreement count divided by $M$. Planted truth is the set of triples fixed by leaf-set overlaps. Cell Ontology truth is the is-a closure over CL terms. Order consistency is the Jaccard index of relation triples across orders. Pooled scores reward coarse links, so relation scores are reported per type.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CellHint | hybrid | Cell-to-type distances per study, rank-transformed; row-normalised confusion between studies thresholded into one-to-one, one-to-many, many-to-one and novel relations | [R1] |
| MetaNeighbor | heuristic | Degree-normalised neighbour vote from other studies; the per-type AUROC scores replicability and learns no relation | [R2] |
| scHPL | model-based | Hierarchical tree built from cross-study relations, with node classifiers that can flag unknown populations | [R3] |
| OnClass | model-based | Classifies cells to Cell Ontology terms, including terms without training cells | [R4] |
| CellO | model-based | Hierarchical classifier over Cell Ontology terms for human RNA-seq | [R6] |
| popV | hybrid | Ensemble of classifiers (among them k-NN on scVI [R12], scANVI [R11] and CellTypist [R10]) with majority vote and an optional Cell Ontology vote | [R5] |

The published standard for relations is the CellHint rule set, the only method here with explicit relation types and thresholds, so it is the default. MetaNeighbor and popV score replicability or consensus and remain comparators. scHPL is a comparator in B1; OnClass and CellO are described but not compared. The bidirectional projection of Seurat, scmap and SingleR is absent from the table (section 10).

Exact defaults of the methods singlet implements (file:line at the commit shown):

| Method | Parameter | Value | Source |
|---|---|---|---|
| CellHint | `use_pct` | False | `cellhint/harmonize.py:15` @ f1a9453 |
| CellHint | `random_state`, `F_test_prune`, `p_thres` | 2, True, 0.05 | `cellhint/harmonize.py:19`; pruning `cellhint/distances.py:148` |
| CellHint | `min_samples_split`, `min_samples_leaf` | 20, 10 | `cellhint/distances.py:142-143` |
| CellHint | `reorder_dataset`, `dataset_order` | True, None | `cellhint/harmonize.py:21` |
| CellHint | similarity weights for the default order | (2, 1, -1, -2) | `cellhint/align.py:189` |
| CellHint | `minimum_unique_percents` | (0.4, 0.5, 0.6, 0.7, 0.8), grid keeps the fewest alignments | `cellhint/harmonize.py:23`; `cellhint/align.py:413-427` |
| CellHint | `minimum_divide_percents` | (0.1, 0.15, 0.2) | `cellhint/harmonize.py:24`; `cellhint/align.py:413-427` |
| CellHint | `maximum_novel_percent` | 0.05 | `cellhint/harmonize.py:25`; novel rule `cellhint/align.py:42-49` |
| CellHint | `use_rep` | `X_pca` if in `obsm`, else `X` | `cellhint/distances.py:57-63` |
| CellHint | distance metric | correlation on `X` (log1p applied, `cellhint/distance.py:156`); Euclidean on embeddings | `cellhint/distances.py:70` |
| CellHint | rank, normalize, Gaussian kernel | True, True, False | `cellhint/distance.py:167` |
| CellHint | feature warning | warns above 15,000 features on `X`; does not stop | `cellhint/distances.py:67-68` |
| MetaNeighbor | `fast_version`; `detailed_results` | FALSE; FALSE | `R/MetaNeighbor.R:59`, `:61` @ a0aad62 |
| MetaNeighbor | `node_degree_normalization`; `batch_size` | TRUE; 10 | `R/MetaNeighbor.R:60` |
| MetaNeighbor | cell-cell similarity | Spearman; ranks divided by maximum | `R/MetaNeighbor.R:150`, `:155` |
| popV | methods when `"all"` | all algorithms | `popv/annotation.py:78-82` @ 9c6f0ee |
| popV | ONCLASS | removed when no Cell Ontology file | `popv/annotation.py:100-101` |
| popV | scVI k-NN `n_neighbors`; weights | 15; uniform | `popv/algorithms/_scvi.py:100` |
| popV | scVI `n_layers`; `n_latent` | 3; 20 | `popv/algorithms/_scvi.py:89-90` |
| popV | scVI `max_epochs`; `batch_size` | 20; 512 | `popv/algorithms/_scvi.py:105-106` |
| popV | consensus tie-break | alphabetically first label | `popv/_utils.py:260-262` |

## 5. Proposed singlet approach

Routes follow the licences in section 12. **Port**: CellHint harmonisation (distances, rank transform, confusion and threshold rules, with the predictive clustering tree as an option), MetaNeighbor scoring, and popV's consensus and ontology votes with the tie-break corrected (section 3). The popV classifier ensemble is not ported in v1, because two of its members (k-NN on scVI and scANVI) depend on scvi-tools. **Callout**: scHPL, as the hierarchical comparator in B1. OnClass and CellO are described but neither implemented nor compared in v1. **New**: the latent-population model below.

The defaults an agent uses without asking are method `cellhint` with the section 4 values, `use_rep` auto, `dataset_key` dataset, `label_key` cell_type and seed 0.

Model-based formulation. Fit the latent-population model of section 3 by EM on author-labelled cells. A shared encoder maps expression to population posteriors, study-specific emission heads give $\Theta^{(s)}$ with ontology-smoothed priors whose strength is to be set on B1, and the objective is the marginal likelihood of the labels. Validation is leave-one-study-out on planted views. The model turns thresholds into probabilities whose calibration can be checked.

Falsification. The model is set aside if its relation F1 on B1 at $p_m=0.3$ does not exceed the CellHint default, or if its link probabilities are not calibrated on held-out planted views (reliability curve in equal-width bins against planted truth). CellHint then remains the default, and the model is not exposed through the tool.

ML stack. PyTorch holds the encoder, the emission heads and the EM or variational objective, since these change often. Hard-coded CUDA or cuSPARSE covers two small, hot kernels: the neighbour vote (a sparse kNN graph times a one-hot label matrix) and the per-pair confusion counts (a scatter-add). The CPU path uses blocked dense products for correlation distances.

Core kernels are correlation and Euclidean distance blocks, the rank transform, confusion accumulation, the threshold rules, the sparse neighbour vote and the AUROC by rank sums.

CPU, CUDA and streaming. CellHint holds one $n\times C$ distance matrix per study in memory. MetaNeighbor's dense cell network scales as $n^2$ and is not streamed. popV's scVI classifiers use the GPU when present. Streaming is not claimed (P1).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/normalized | float32, sparse | log-normalised expression for correlation distances and the Spearman network |
| read | layers/counts | sparse int | raw UMI counts for popV's scVI classifiers |
| read | obs/`<dataset_key>` | categorical | study of each cell; at least two values |
| read | obs/`<label_key>` | categorical | author label; missing values are left unassigned |
| read | obsm/`<use_rep>` | float32 | embedding for distances (default `X_pca`) |
| read | var/`<gene_id>` | string | gene identifier used to match features across studies |
| read | uns/cell_ontology | graph | optional Cell Ontology graph for ontology votes |
| write | uns/harmonisation/relations | table | dataset_a, label_a, relation, dataset_b, label_b, method, support |
| write | uns/harmonisation/dataset_order | list | study order used by pairwise alignment |
| write | obs/harmonised_label | categorical | harmonised label; empty when unassigned |
| write | obs/harmonised_parent | categorical | ancestor label |
| write | obs/harmonised_relation_confidence | float32 | CellHint row fraction; popV agreement count divided by $M$ |
| write | models/cellhint_pct_`<dataset>` | model | written only when `use_pct` is true |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `dataset_key` | string | "dataset" | — | obs column giving the study of each cell; needs at least two distinct values. |
| `label_key` | string | "cell_type" | — | obs column holding each cell's author label; missing labels stay unassigned. |
| `method` | string | "cellhint" | `cellhint`, `metaneighbor`, `popv` | Reconciliation method; cellhint gives relation types with thresholds. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for the popv classifiers; the cellhint tree option uses cellhint.random_state. Default cellhint is deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `cellhint` | object | — | — | Options for method cellhint; ignored by the other methods. |
| `cellhint.use_rep` | string | "auto" | — | Representation for distances: auto uses X_pca when present, otherwise X. |
| `cellhint.distance_metric` | string/null | null | — | Cell-to-type distance; null uses correlation on X and euclidean on embeddings. |
| `cellhint.use_pct` | boolean | false | — | Use predictive clustering trees instead of direct distances. |
| `cellhint.reorder_dataset` | boolean | true | — | Order studies by similarity before alignment; ignored when dataset_order is set. |
| `cellhint.dataset_order` | array/null | null | — | Explicit study order; must list every study value. |
| `cellhint.minimum_unique_percents` | array | [0.4, 0.5, 0.6, 0.7, 0.8] | — | Grid for the one-to-one threshold; the setting with fewest alignments is kept. |
| `cellhint.minimum_divide_percents` | array | [0.1, 0.15, 0.2] | — | Grid for one-to-many and many-to-one thresholds. |
| `cellhint.maximum_novel_percent` | number | 0.05 | min 0; max 1 | Fraction below which a type is called novel. |
| `cellhint.random_state` | integer | 2 | — | Seed for the predictive clustering tree when use_pct is true. |
| `cellhint.p_thres` | number | 0.05 | min 0; max 1 | F-test p-value threshold for pruning predictive clustering trees. |
| `metaneighbor` | object | — | — | Options for method metaneighbor; ignored by the other methods. |
| `metaneighbor.fast_version` | boolean | false | — | Use the alternative AUROC computation path of the reference implementation. |
| `metaneighbor.node_degree_normalization` | boolean | true | — | Divide neighbour votes by node degree. |
| `popv` | object | — | — | Options for method popv; ignored by the other methods. |
| `popv.methods` | array/null | null | — | Classifier names; null uses all algorithms of the reference implementation. |
| `popv.cl_obo_file` | string/null | null | — | Cell Ontology OBO file for ontology votes; null skips the ontology step. |
| `popv.knn_scvi_n_neighbors` | integer | 15 | min 1 | Neighbours in the k-NN classifier on the scVI latent space. |
<!-- PARAMS:AUTO:END -->

Parameters under `cellhint` apply only when `method` is `cellhint`, and the `metaneighbor` and `popv` objects apply only to their methods. A given `dataset_order` must list every study value and overrides `reorder_dataset`. Setting `use_pct` also writes the tree model. The call rejects datasets with fewer than two study values and thresholds outside $(0,1]$. Methods are not combined in one call; consensus across methods belongs to annotation.consensus_annotation.

## 7. MCP tool

Tool `singlet_annotation_cross_dataset_label_reconciliation` (definition in `tasks/mcp/singlet_annotation_cross_dataset_label_reconciliation.json`). Example call and compact result, with placeholders in place of values:

```json
{"dataset": "/data/example_atlas.singlet", "dataset_key": "study", "label_key": "author_label", "method": "cellhint", "cellhint": {"use_pct": false}}
{"dataset": "/data/example_atlas.singlet", "status": "completed",
 "wrote": ["uns/harmonisation/relations", "uns/harmonisation/dataset_order", "obs/harmonised_label", "obs/harmonised_parent", "obs/harmonised_relation_confidence"],
 "summary": {"method": "cellhint", "dataset_order": "<study values>", "n_relations": {"one2one": "<int>", "one2many": "<int>", "many2one": "<int>", "novel": "<int>"}, "unassigned_cells": "<int>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: popV training is queued as a long job; cellhint and metaneighbor are expected to finish inline, to be confirmed by P1. Stochastic: popV's scVI classifiers depend on the seed; cellhint without `use_pct` is deterministic for a given dataset order. Dry-run estimate: returns seconds, peak memory (the $n\times C$ matrices or the $n^2$ network) and device without writing members.

## 8. Benchmarks

Shared protocol. Methods are applied with the section 4 defaults unless a benchmark says otherwise. A predicted relation is correct only if both labels and the relation type match a truth entry, with label pairs unordered within a study pair. Stochastic methods use seeds 0 to 4 and report mean and range. No label of a held-out study enters training. Hardware is recorded in P1. Thresholds marked proposed are design targets, not literature values.

### B1. Relation recovery on planted views (proposed)

- **Goal**: recover planted relations among $K$ views of the same cells.
- **Ground truth**: planted simulation. From the finest-label leaf sets $L(x)$, $L(y)$ of labels $x$, $y$ in two views: one-to-one if equal; one-to-many if $L(x)$ is a disjoint union of at least two leaf sets of the other view (many-to-one symmetric); novel if disjoint from all. Estimand: triples per study pair.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellHint_Immune (base) | [R1]; `datasets.md` at f1a9453; `https://cog.sanger.ac.uk/celltypist/Resources/CellHint_manuscript/CellHint_Immune.h5ad` | immune; — | see section 10 | CellHint Figure 2 |

- **Generator recipe**
  1. Map finest labels to Cell Ontology terms (`annotation.cell_ontology_mapping`); drop and count unmapped labels.
  2. Use the is-a tree of the mapped terms as the planted tree $T$.
  3. Cut each branch of $T$ at a random depth per view; merge sibling leaves with probability $p_m$.
  4. Split leaves with probability $p_s$ by the median of their top one-vs-rest gene, never by clustering.
  5. Withhold a leaf from one view with probability $p_w$ (novel truth).
  6. Rename labels with a fixed synonym table that no method uses.
  - Grid: $p_m$ values including 0.3; small grids for $p_s$, $p_w$ (proposed).
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| relation F1 per type | harmonic mean of precision and recall of predicted triples, per relation type | higher | primary | [R16] |
| hierarchy consistency rate | fraction of cells whose predicted parent is an ancestor of, or equal to, the predicted child in $T$ | higher | primary | — |
| novel-type AUROC | AUROC of the novelty score for cells whose leaf was withheld | higher | guardrail | [R16] |

- **Comparators**: CellHint default and `use_pct`; MetaNeighbor top-1; popV ontology vote; scHPL tree edges; exact-string matching; latent proposal.
- **Acceptance criterion** (proposed): relation F1 at least 0.85 at $p_m=0.3$; hierarchy consistency at least 0.98 for the default method.
- **Known pitfalls**: clustering-based splits make the truth data dependent (step 4); a shared synonym table leaks the answer (step 6).

### B2. Cell Ontology ancestor agreement (proposed)

- **Goal**: check that predicted equivalences and parent-child links agree with the Cell Ontology, independently of the method.
- **Ground truth**: consistency with an external ontology. Each author label maps to a CL term with `annotation.cell_ontology_mapping` before harmonisation is applied. For a predicted link $(a,b)$ the outcome is 1 if $\mathrm{CL}(a)=\mathrm{CL}(b)$ or one term is an ancestor of the other in the is-a closure, and 0 otherwise. The metric averages the outcome over predicted links with both labels mapped.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| author-labelled studies with CL mapping | singlet catalogue (about 354 million cells, about 40% annotated, project figures); CL vocabulary [R15] | multi-tissue; — | see section 10 | labels only; no expression needed |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ancestor match rate | fraction of predicted links whose CL terms are equal or ancestor-related; overall and per CL depth stratum | higher | primary | [R15] |
| LCA depth ratio | depth of the deepest common ancestor of $\mathrm{CL}(a)$ and $\mathrm{CL}(b)$ divided by the larger of the two depths; median over links; depth is the path length to the root | higher | primary | [R15] |

- **Comparators**: CellHint default links; MetaNeighbor mutual top-1 links; popV ontology vote; exact-string matching.
- **Protocol**: the mapping is frozen before any method is applied. Unmapped labels are reported as label count and cell fraction, not dropped. Results are stratified by the CL depth of the labels, because coarse labels inflate matches.
- **Acceptance criterion** (proposed): ancestor match rate of at least 0.95 over all predicted links, and median LCA depth ratio of at least 0.80.
- **Known pitfalls**: a mapping made by an ontology-based or language-model method makes the metric circular; coarse labels inflate matches, hence the stratification.

### B3. Held-out projection with harmonised versus raw training labels (extended protocol)

- **Goal**: test whether training on harmonised labels improves projection onto held-out studies over raw author labels.
- **Ground truth**: held-out studies. For each held-out batch, the truth is the CL term of each cell's author label, mapped before harmonisation and never used in training. Predictions from either label set are mapped to CL terms, so raw and harmonised vocabularies are scored on one scale. The estimand is per-cell agreement of CL terms over held-out cells with a defined truth term.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| cxg_immune_cell_atlas, process input (batch `batch`, label `cell_type`) | openproblems-bio/task_label_projection at f37b604, `src/data_processors/process_dataset/script.py` | immune; — | see section 10 | test batches are drawn at random (script line 48) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| F1 macro | unweighted mean over truth labels of per-label F1 | higher | primary | [R16] |
| F1 weighted | per-label F1 averaged with weights equal to label support | higher | primary | [R16] |
| accuracy | proportion of held-out cells whose predicted CL term equals the truth | higher | guardrail | [R16] |

- **Comparators**: k-nearest-neighbour and logistic-regression classifiers with fixed hyperparameters, trained once on raw labels and once on harmonised labels.
- **Protocol**: five random splits (seeds 0 to 4), each drawing the test batch by the repository rule. Train on the reference batches; predict the held-out batch. Feature set and hyperparameters are fixed across label sets and never tuned on the held-out batch.
- **Acceptance criterion** (proposed): harmonised labels raise macro-F1 by at least 0.02 over raw labels in at least 60% of splits, for both k-NN and logistic regression.
- **Known pitfalls**: harmonised labels built with the held-out batch leak the truth; a coarse harmonised vocabulary raises accuracy trivially, so macro-F1 is reported with the label count.

### B4. Order invariance of pairwise alignment (proposed)

- **Goal**: measure how relation calls and per-cell labels depend on the study order used by pairwise alignment.
- **Ground truth**: consistency across orders; no external truth. Estimands are the mean pairwise Jaccard index of relation triples across orders, and the fraction of co-labelled cells whose harmonised label differs between two orders.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellHint_Lung | [R1]; `datasets.md` at f1a9453; `https://cog.sanger.ac.uk/celltypist/Resources/CellHint_manuscript/CellHint_Lung.h5ad` | lung; — | see section 10 | Figures 3 and 4 |
| CellHint_Immune | [R1]; `datasets.md` at f1a9453; `https://cog.sanger.ac.uk/celltypist/Resources/CellHint_manuscript/CellHint_Immune.h5ad` | immune; — | see section 10 | Figure 2; orders differ only with three or more study values (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| relation Jaccard across orders | mean pairwise Jaccard index of relation sets over all pairs of orders | higher | primary | — |
| per-cell label change rate | fraction of co-labelled cells whose harmonised label differs, averaged over pairs of orders | lower | primary | — |

- **Comparators**: CellHint default similarity order; CellHint with `use_pct` true. MetaNeighbor and popV have no order and agree by construction, so they are not compared here.
- **Protocol**: ten random study orders plus the default weighted order, repeated with `use_pct` true; all pairs of orders are compared.
- **Acceptance criterion** (proposed): mean relation Jaccard of at least 0.90 and per-cell change rate of at most 0.02.
- **Known pitfalls**: the default order follows similarity and can look stable for biologically close studies; an order-free method can score perfectly while being less accurate, so B1 must accompany it.

### P1. Performance and scaling

Measure wall-clock time, peak host memory and, for popV, peak GPU memory. Proposed scales are $10^5$ cells with 2 studies and 20 to 50 labels per study; $10^6$ cells with 5 studies and 50 to 200 labels; and $10^7$ cells with 10 studies and 200 to 500 labels. Hold fixed the feature count (at most 15,000 on `X`, section 4), 30 or 50 principal components for embeddings, the thread count, the seed, a minimum of 10 cells per label and the reference preprocessing. Comparators: CellHint default; CellHint with `use_pct` true; MetaNeighbor with `fast_version` FALSE and TRUE; popV with and without the ontology step; exact-name matching as the floor. MetaNeighbor is expected to exceed memory first, since its cell-by-cell network scales as $n^2$ (`R/MetaNeighbor.R:150`; `R/neighborVoting.R:67-72`). CellHint memory scales with $n$ times the number of types $C$.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.cell_ontology_mapping`: Cell type name harmonization to Cell Ontology terms
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
- **Feeds**:
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
  - `annotation.hierarchical_annotation`: Hierarchical, ontology-aware coarse-to-fine annotation
  - `integration.partial_label_integration`: Label-aware integration with partially labelled cells
- **Reads**: `layers/normalized`, `layers/counts`, `obs/<dataset_key>`, `obs/<label_key>`, `obsm/<use_rep>`, `var/<gene_id>`, `uns/cell_ontology`
- **Writes**: `uns/harmonisation/relations`, `uns/harmonisation/dataset_order`, `obs/harmonised_label`, `obs/harmonised_parent`, `obs/harmonised_relation_confidence`, `models/cellhint_pct_<dataset>`
<!-- CHAINING:AUTO:END -->

Belongs to the cross-study annotation recipe: Cell Ontology mapping, then reconciliation, then label transfer or hierarchy construction.

## 10. Risks, pitfalls and open questions

- **Expert relation table.** The expert-curated relation table of the CellHint paper and its metric definition are not in the repository files behind this document or in the local corpus. The catalogue's expert benchmark is therefore not specified here, and B1 is the only test that scores relation calls against a known relation set; B2 scores them against the Cell Ontology. The first step is to locate the table, for example in the paper's supplement.
- **Unsettled literature.** No published benchmark of relation discovery with a stated truth is known. Every threshold in section 8 is a proposal, and no sensitivity analysis of study order in greedy alignment is known.
- **Citation gaps.** Author lists are abbreviated with "et al." where no local record gives the full list. Volumes and pages are given only where a local record gives them. The Dawid–Skene reference (R17) rests on memory and has no DOI in any local record.
- **Projection methods not covered.** The bidirectional projections of Seurat anchors, scmap and SingleR [R7][R8][R9] are not tabulated. Their mechanisms and defaults are not established by the sources behind this document, so they are not comparators here and their licences are not recorded.
- **Identifiability and data.** Each catalogue cell has one author label from one study, so repeated-annotation identifiability does not apply (section 3). The latent-population model must first recover planted truth on two studies (B1 at $p_m=0$ and at $p_m=0.3$) before any catalogue-wide application. No study inventory exists yet, so benchmark sizes are not given. The number of study values in each CellHint file is not stated in the repository.
- **Port test.** Any port of the popV ontology votes must replace the tie-break with a candidate-dependent key and test the missing-label and non-letter paths before reuse (section 3).
- **Dataset licences.** The licences of the B1 to B4 datasets are not confirmed; the licences in section 12 cover code only.

## 11. References

R1. Xu C, et al. Automatic cell-type harmonization and integration across Human Cell Atlas datasets. *Cell* 2023;186(26):5876–5891.e20. doi:10.1016/j.cell.2023.11.026 — verified (corpus)

R2. Crow M, et al. Characterizing the replicability of cell types defined by single cell RNA-sequencing data using MetaNeighbor. *Nature Communications* 2018. doi:10.1038/s41467-018-03282-0 — verified (corpus)

R3. Michielsen L, et al. Hierarchical progressive learning of cell identities in single-cell data. *Nature Communications* 2021. doi:10.1038/s41467-021-23196-8 — verified (corpus)

R4. Wang S, et al. Leveraging the Cell Ontology to classify unseen cell types. *Nature Communications* 2021. doi:10.1038/s41467-021-25725-x — verified (corpus)

R5. Ergen C, et al. Consensus prediction of cell type labels in single-cell data with popV. *Nature Genetics* 2024. doi:10.1038/s41588-024-01993-3 — verified (corpus)

R6. Bernstein MN, Ma J, Gleicher M, Dewey CN. CellO: comprehensive and hierarchical cell type classification of human cells with the Cell Ontology. *iScience* 2021;24(1):101913. doi:10.1016/j.isci.2020.101913 — verified (corpus)

R7. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)

R8. Kiselev VY, et al. scmap: projection of single-cell RNA-seq data across data sets. *Nature Methods* 2018. doi:10.1038/nmeth.4644 — verified (corpus)

R9. Aran D, Looney AP, Liu L, et al. Reference-based analysis of lung single-cell sequencing reveals a transitional profibrotic macrophage. *Nature Immunology* 2019. doi:10.1038/s41590-018-0276-y — verified (corpus)

R10. Domínguez Conde C, Xu C, Jarvis LB, et al. Cross-tissue immune cell analysis reveals tissue-specific features in humans. *Science* 2022. doi:10.1126/science.abl5197 — verified (corpus)

R11. Xu C, Lopez R, Mehlman E, et al. Probabilistic harmonization and annotation of single-cell transcriptomics data with deep generative models. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209620 — verified (corpus)

R12. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)

R13. Abdelaal T, Michielsen L, Cats D, et al. A comparison of automatic cell identification methods for single-cell RNA sequencing data. *Genome Biology* 2019. doi:10.1186/s13059-019-1795-z — verified (corpus)

R14. Pasquini G, Rojo Arias JE, Schäfer P, Busskamp V. Automated methods for cell type annotation on scRNA-seq data. *Computational and Structural Biotechnology Journal* 2021. doi:10.1016/j.csbj.2021.01.015 — verified (corpus)

R15. Diehl AD, et al. The Cell Ontology 2016: enhanced content, modularization, and ontology interoperability. *Journal of Biomedical Semantics* 2016;7:44. doi:10.1186/s13326-016-0088-7 — verified (search)

R16. Grandini M, Bagli E, Visani G. Metrics for multi-class classification: an overview. *arXiv* 2020. doi:10.48550/arxiv.2008.05756 — verified (corpus)

R17. Dawid AP, Skene AM. Maximum likelihood estimation of observer error-rates using the EM algorithm. *Applied Statistics* 1979. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/Teichlab/cellhint | Chuan Xu (setup.py author); Teichmann Lab (LICENSE copyright) | MIT (LICENSE text) | harmonisation, distances, thresholds, optional tree | port |
| https://github.com/gillislab/MetaNeighbor | Megan Crow and Jesse Gillis (DESCRIPTION Authors@R; Crow also role cre); Stephan Fischer (DESCRIPTION Maintainer field) | MIT (LICENSE and DESCRIPTION agree) | neighbour-vote replicability scores | port |
| https://github.com/YosefLab/popV | Can Ergen (pyproject.toml authors and maintainers) | MIT (LICENSE) | consensus and ontology votes | port (votes); classifiers not ported in v1 |
| https://github.com/lcmmichielsen/scHPL | Lieke Michielsen (setup.py author) | MIT (LICENSE) | hierarchical comparator | callout |
| https://github.com/wangshenguiuc/OnClass | Sheng Wang (setup.py author) | MIT (LICENSE) | described in section 4 only | not used in v1 |
| https://github.com/deweylab/CellO | Matthew N. Bernstein (setup.py author) | MIT (LICENSE) | described in section 4 only | not used in v1 |
| https://github.com/openproblems-bio/task_label_projection | Open Problems in Single-Cell Analysis (LICENSE copyright) | MIT (LICENSE) | B3 dataset and split rule | callout |
