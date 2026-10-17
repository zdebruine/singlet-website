---
id: annotation.cell_ontology_mapping
title: Cell type name harmonization to Cell Ontology terms
area: annotation
scope: core
paradigm: hybrid
literature_status: open
priority: P1
depends_on: [annotation.cluster_label_assignment, annotation.llm_cluster_annotation]
feeds: [annotation.cross_dataset_label_reconciliation, annotation.hierarchical_annotation, annotation.reference_label_transfer]
reads: [obs/<label_column>]
writes: [uns/cl_release, uns/cl_label_map, obs/cl_term_id, obs/cl_term_label, obs/cl_match_type, uns/cl_mapping_report]
devices: [cpu]
mcp_tool: singlet_annotation_cell_ontology_mapping
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Cell type name harmonization to Cell Ontology terms

> Maps each unique free-text cell type label to one term of a pinned Cell Ontology release, or to no term, using a deterministic lexical lookup, an optional remote lookup, and a proposed calibrated resolver for residual labels.

## 1. Question

Which Cell Ontology (CL) term, from a pinned release, does a free-text cell type label name, so that equivalent labels from different studies resolve to one identifier? The input is the set of unique label strings in one annotation column; the output is one CL identifier, its label and a match type per unique label, or an explicit unmapped flag. A correct answer names the term the author intended at the granularity the study used, and abstains when no single term fits.

## 2. Why this task matters and where the field stands

Studies name the same population differently, and merging them requires a shared vocabulary. Ontologies of cell types were proposed early [R3], and the Human Cell Atlas has developed its own cell type ontologies [R2]. The Cell Ontology changed its content and modularisation in the 2016 release [R1], and obsolete, merged or split terms change identifiers while labels stay the same. Mapping a label to an identifier is therefore a precondition for cross-dataset reconciliation and hierarchical annotation.

Status: **open**. The cited literature contains no accepted benchmark for name-only mapping, and three problems remain unsettled. First, the level at which a label should be reported (for example T cell or CD8-positive, alpha-beta T cell) is a policy choice that the vocabulary does not make [R2]. Second, compound labels such as B cell/plasma cell have no single term, and no standard output format exists for several terms. Third, large language models are being assessed for cell type annotation [R7][R10], but those assessments target annotation of populations rather than the mapping of a name to an identifier, so they do not settle this question.

## 3. Theory and insight

Let $\mathcal{C}$ be the active terms of a pinned CL release, each with label $\ell(t)$ and exact synonyms $\sigma(t)$. The ancestors $\operatorname{anc}(t)$ and descendants $\operatorname{desc}(t)$ follow is_a and part_of. $V$ is a versioned synonym table.

| Symbol | Meaning |
|---|---|
| $s$ | a unique free-text label |
| $N(\cdot)$ | normalisation with table $V$ (Eq. 1) |
| $\mathcal{T}_{\text{exact}}(s)$ | active terms whose normalised label or exact synonym equals $N(s)$ (Eq. 2) |
| $T_i$, $P_i$ | gold and predicted term sets of item $i$ |
| $f$, $g$, $\tau$, $\theta$ | label encoder, term encoder, temperature and abstention threshold of the proposed resolver |

**Lexical decision.** Normalisation is deterministic:

$$N(s)=\operatorname{syn}_V\big(\operatorname{collapse}(\operatorname{clean}(\operatorname{lower}(s)))\big)\tag{1}$$

where clean replaces characters other than word characters, spaces and hyphens by spaces. The mLLMCelltype code applies the same steps but also restores case on five tokens, so its output is a comparison key only after lower-casing. The exact candidate set is

$$\mathcal{T}_{\text{exact}}(s)=\{\,t\in\mathcal{C}:\ N(s)\in N(\{\ell(t)\}\cup\sigma(t))\,\}\tag{2}$$

and the decision maps $s$ to the unique member, to a collision when $|\mathcal{T}_{\text{exact}}(s)|>1$, and to unmapped when the set is empty. Equation 2 holds when the study uses CL vocabulary. It says nothing about granularity, and a collision needs an explicit tie-break rule.

**Evaluation.** Hierarchical precision and recall use ancestor-augmented sets. An abstained item has $P_i=\varnothing$.

$$\hat P_i=P_i\cup\operatorname{anc}(P_i),\quad \hat T_i=T_i\cup\operatorname{anc}(T_i),\quad hP=\frac{\sum_i|\hat P_i\cap\hat T_i|}{\sum_i|\hat P_i|},\quad hR=\frac{\sum_i|\hat P_i\cap\hat T_i|}{\sum_i|\hat T_i|},\quad hF=\frac{2\,hP\,hR}{hP+hR}\tag{3}$$

This is the ancestor-augmented hierarchical form [R6]; the mLLMCelltype variant uses ancestors of the true term only (compute_hierarchical_metrics.py:7-10). Regime: anc is taken on the pinned release. For single-term predictions the intersection is the set of common terms among each item's self-and-ancestors. An abstention leaves hP unchanged but lowers hR.

**Model-based proposal.** The proposed resolver scores a label against the top-k lexical candidates $\mathcal{C}(s)$ from a character n-gram index with a softmax over encoder similarities:

$$P(t\mid s)=\frac{\exp\big(f(s)^{\top}g(t)/\tau\big)}{\sum_{t'\in\mathcal{C}(s)}\exp\big(f(s)^{\top}g(t')/\tau\big)}\tag{4}$$

The term encoder $g$ embeds the label, synonyms and parent names, and $\tau$ is fitted on held-out pairs. The ancestor posterior $P(a\mid s)=\sum_{t\in\operatorname{desc}(a)}P(t\mid s)$ sums over terms, so each term counts once on the DAG; the decoded node is the deepest $a$ with $P(a\mid s)\ge\theta$. Training uses an InfoNCE objective over in-batch terms, with positives from CL synonym pairs and from labels that curators give the same identifier:

$$\mathcal{L}=-\sum_{(s,t^{+})}\log\frac{\exp\big(f(s)^{\top}g(t^{+})/\tau\big)}{\sum_{t'\in B}\exp\big(f(s)^{\top}g(t')/\tau\big)}\tag{5}$$

This objective is a standard contrastive form for biomedical entity linking [R5]. No published cell type name model with this objective was identified. Regime: the posterior is calibrated only on held-out studies absent from training, and only over $\mathcal{C}(s)$; mass outside the candidate set is lost.

**Estimands.** Each output is a term for a unique label; per-cell values copy that term and are not independent measurements. In B1, exact-ID accuracy is the fraction of generated strings in a perturbation class whose mapped identifier equals the source term, collisions excluded and abstentions counted as errors. In B2, it is the fraction of a study's unique labels matching the curator identifier, averaged over studies with equal weight, so cell counts do not enter. Equation 3 is computed over the same items. Ancestor compatibility is the indicator that the mapped identifier equals the gold term or lies one edge from it in the ancestor or descendant direction, averaged over items. Coverage is the fraction of items mapped.

**Regime of validity.** The lexical decision is deterministic given the release and $V$, so changing either changes the estimand. While the remote fuzzy path is off, equation 2 implies that a string with no normalised match cannot be mapped, so the false-mapping rate of the lexical method is zero by construction on such strings. The negative controls therefore test collisions and the remote path rather than the lexical decision.

**Why heuristics work and what the model adds.** Exact normalised lookup is precise when the label uses CL vocabulary, needs no fitting, and is reproducible, which is why it is the default. A learned resolver adds calibrated abstention, tolerance to surface variation, and a way to use curator decisions as weak positives. It does not settle granularity by itself: granularity comes from the training pairs, and calibration shifts across studies.

**Failure modes.** Lexical: granularity mismatch ('T cell' against 'CD8-positive, alpha-beta T cell' scores zero although an ancestor relation holds); acronym ambiguity, since 'dc', 'tec', 'dp' and 'sp' map without context (evaluate_ontology_matches.py:24-44); state versus type; compound labels; release drift. Remote first hit: ranking dependence (evaluate_ontology_matches.py:126 and :148) and a cache keyed by raw label without service version (:104). Learned: calibration shift across studies, and surface variants learned without granularity.

**Insight.** Exact-ID accuracy alone hides the dominant errors, which are granularity and compound labels rather than exact-string misses. Report exact-ID accuracy, ancestor compatibility and coverage side by side. A pitfall visible in the evaluation code: partial credit of 0.5 comes from an ancestor relation or a shared specific ancestor among OLS-reported ancestors (04_evaluate_annotation_match.py:416-439) or from a fixed relation list (:442-458), and the hierarchical script infers partial direction from token counts (compute_hierarchical_metrics.py:58-80) with a fixed depth ratio of 0.70 (:51). The fixed list, the token rule and the depth ratio are not measurements on the CL graph and are not comparable with equation 3.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Normalised exact and synonym lookup | heuristic | Clean the label, apply a versioned synonym table, match exactly on CL labels and exact synonyms. | — |
| OLS exact-then-fuzzy first hit | heuristic | Query the OLS4 API for CL terms, exact first, then fuzzy; keep the first CL document. | [R4] (2015 description of the original service; the queried API is OLS4, section 12) |
| Name-embedding classifier (OnClass) | model-based | Scores expression profiles against Cell Ontology terms, including terms without training cells. | [R9] |
| Hierarchical CL classifier (CellO) | model-based | Trains hierarchical classifiers over CL terms on human bulk RNA-seq; takes expression, not names. | [R8] |
| Identifier-level ancestor matching (scOntoMatch) | heuristic | Matches ontology identifiers across datasets by identity or ancestor-descendant relation; names translate by exact match only. | — |

The name-only mapping in the mLLMCelltype code is the lexical route: a normalised match against CL labels and synonyms, with the OLS service as a remote version of the same lookup. The two model-based methods take expression and serve as comparators for annotation rather than name mapping. scOntoMatch works on identifiers and is not a mapper. Singlet implements the first two and treats the others as callouts (section 12).

Source defaults for the methods above:

| Method | Parameter | Value | Source |
|---|---|---|---|
| Normalised lookup | synonym table | 19 entries, for example `dc` to dendritic cell, `tec` to thymic epithelial cell, `dp` to double-positive | paper/scripts/ontology/evaluate_ontology_matches.py:24-44 @26bda56 |
| Normalised lookup | cleaning | lower-case; characters other than word, space and hyphen to space; whitespace collapsed | evaluate_ontology_matches.py:77, :80-81 @26bda56 |
| Normalised lookup | synonym substitution | word-bounded, applied in table order | evaluate_ontology_matches.py:84-85 @26bda56 |
| Normalised lookup | case restoration | `t`, `b`, `nk`, `cd4`, `cd8` upper-cased | evaluate_ontology_matches.py:88-90 @26bda56 |
| OLS lookup | endpoint | https://www.ebi.ac.uk/ols4/api/search | evaluate_ontology_matches.py:119, :141 @26bda56 |
| OLS lookup | first query | ontology `cl`; exact `true`; queryFields `label,synonym` | evaluate_ontology_matches.py:113-115 @26bda56 |
| OLS lookup | fallback query | exact `false` | evaluate_ontology_matches.py:140 @26bda56 |
| OLS lookup | selection | first document with ontology_prefix `CL` | evaluate_ontology_matches.py:125-128, :147-150 @26bda56 |
| OLS lookup | cache key | raw label; stored result carries no service version | evaluate_ontology_matches.py:104, :136, :158 @26bda56 |
| Evaluation | exact relation score | 1.0 for equal normalised names | reference_comparison/2_evaluation/04_evaluate_annotation_match.py:352 @26bda56 |
| Evaluation | partial relation score | 0.5 for an ancestor relation or shared specific ancestor (OLS-reported ancestors); 0.5 for a fixed list: dendritic–antigen-presenting; T, B, NK–lymphocyte; endothelial–vascular | 04_evaluate_annotation_match.py:416-458 @26bda56 |
| Evaluation | hierarchical formula | ancestors of the true term only | compute_hierarchical_metrics.py:7-10 @26bda56 |
| Evaluation | depth ratio | 0.70 | compute_hierarchical_metrics.py:51 @26bda56 |
| Evaluation | partial direction | from informative token counts | compute_hierarchical_metrics.py:58-80 @26bda56 |
| Cell Ontology | download URL | http://purl.obolibrary.org/obo/cl.obo, unversioned | paper/scripts/ontology/download_cell_ontology.py:24 @26bda56 |
| scOntoMatch | name translation | exact match on ontology name; unmatched names only print a message | R/helper_functions.R:54-57, :78-79 @9379936 |

## 5. Proposed singlet approach

**Routes.** The cleaning function and the OLS query construction are ported from mLLMCelltype, with its selection and scoring replaced. OLS is called through its public REST interface. OnClass, CellO and scOntoMatch are callouts. ROBOT [R12] is a callout used in release checks to confirm that every target is an active term.

**Default.** The normalised lookup with exact matches only. Ties abstain. A label without an exact match stays unmapped, because a forced parent silently loses specificity. Obsolete targets follow replaced_by, and no tissue or species parameter changes the decision. Remote OLS is opt-in, and its cache is keyed by normalised label and service version.

**Proposed model.** A learned resolver for residual labels, defined by equations 4 and 5. Its encoders train on CL synonym pairs from the pinned file and, where the catalogue stores CL identifiers, on curator-consistent label pairs. The threshold $\theta$ is set on held-out studies for a target precision. The resolver enters the enum only if, on held-out studies (B2), it raises exact-ID accuracy over the lexical default at equal coverage while keeping ancestor compatibility at the B2 target. Otherwise the lexical lookup stays the default, and no benchmark claim is made for the resolver.

**ML stack.** PyTorch trains the string encoder and fits $\tau$ and $\theta$. Inference is one dense product between label embeddings and the CL embedding matrix followed by top-k; that is the only step where a CUDA kernel could matter, and only after adoption. Candidate generation and ancestor aggregation are sparse products suited to cuSPARSE. The lexical lookup is a hash table.

**Core kernels.** A hash index over normalised labels and exact synonyms, and an Euler-tour index for the lowest-common-ancestor tie-break. Unique labels stream in chunks. Agents should supply `cl_release`; the other defaults are in section 6.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obs/<label_column> | categorical string | free-text labels; one mapping per unique string |
| write | uns/cl_release | string | pinned release identifier, as given by `cl_release` |
| write | uns/cl_label_map | dictionary | per unique label: identifier, label, match type, candidate list |
| write | obs/cl_term_id | string | mapped identifier, empty when unmapped |
| write | obs/cl_term_label | string | label of the mapped term |
| write | obs/cl_match_type | categorical | exact, synonym, fuzzy, replaced, lca, collision, unmapped |
| write | uns/cl_mapping_report | dictionary | counts per match type, release, parameters, service version, cache hit rate |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `label_column` | string | "cell_type" | — | obs column of free-text cell type labels; mapped once per unique label. |
| `cl_release` | string | required | — | Pinned Cell Ontology release identifier; required, because mappings are not reproducible without it. |
| `candidate_root` | string | "CL:0000548" | — | Restrict candidates to descendants of this term; the default is the animal cell root. |
| `method` | string | "normalised_index" | `normalised_index`, `ols` | normalised_index is deterministic and offline; ols calls the EBI Ontology Lookup Service. |
| `obsolete_policy` | string | "replace_by" | `replace_by`, `abstain` | replace_by follows replaced_by of an obsolete target; abstain leaves the label unmapped. |
| `device` | string | "auto" | `auto`, `cpu` | Execution device; the current methods run on CPU, so auto selects CPU. |
| `dry_run` | boolean | false | — | Return unique label count, uncached lookup count and estimated seconds without mapping. |
| `overwrite` | boolean | false | — | Replace existing cl_* members instead of failing. |
| `normalised_index` | object | — | — | Options for method normalised_index; ignored by ols. |
| `normalised_index.use_synonyms` | boolean | true | — | Match CL exact synonyms as well as labels; related synonyms are not used. |
| `normalised_index.synonym_table` | string/null | null | — | Path to a versioned abbreviation table; its checksum is written to the report. |
| `normalised_index.tie_break` | string | "abstain" | `abstain`, `lca` | When several active terms share a normalised label: abstain, or report their lowest common ancestor. |
| `ols` | object | — | — | Options for method ols; ignored by normalised_index. |
| `ols.cache_remote` | boolean | true | — | Cache responses keyed by normalised label and service version. |
| `ols.top_k` | integer | 5 | min 1 | Candidate terms kept per label for review. |
| `ols.fuzzy_fallback` | boolean | false | — | Repeat a failed exact query as a fuzzy query; the first CL hit depends on ranking. |
<!-- PARAMS:AUTO:END -->

Parameter rules: `normalised_index` options apply only when `method` is `normalised_index`, and `ols` options only when it is `ols`; `obsolete_policy` and `candidate_root` apply to both. A call without `cl_release` is refused. A synonym table is versioned and its checksum goes into the report. `fuzzy_fallback` is off by default because a first fuzzy hit depends on service ranking.

## 7. MCP tool

Tool name `singlet_annotation_cell_ontology_mapping` (definition in `tasks/mcp/singlet_annotation_cell_ontology_mapping.json`). Example call:

```json
{"dataset": "study.singlet", "label_column": "cell_type", "cl_release": "<pinned-release>", "method": "normalised_index"}
```

Example result:

```json
{"dataset": "study.singlet", "status": "completed",
 "wrote": ["uns/cl_label_map", "obs/cl_term_id", "obs/cl_term_label", "obs/cl_match_type", "uns/cl_mapping_report"],
 "summary": {"unique_labels": "<int>", "n_mapped": "<int>", "n_unmapped": "<int>", "n_collisions": "<int>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: no for `normalised_index`; `ols` makes one request per uncached label, so its time grows with the number of uncached labels. Stochastic: no. Dry run returns the unique label count, the uncached lookup count and an estimate of seconds from P1.

## 8. Benchmarks

**Shared protocol.** Every benchmark pins one `cl.obo` download and records its release identifier and file checksum. Each comparator uses the same normalisation and synonym-table version. Ancestors come from is_a and part_of on that release. Obsolete terms are excluded as sources and mapped through replaced_by when they are targets. Abstentions count as errors in accuracy and as unmapped in coverage. Bootstrap intervals resample source terms (B1) or studies (B2) with a fixed seed. The service version and hardware are recorded for each invocation.

### B1. Surface-form recovery on a pinned release

- **Goal**: measure whether the mapping recovers the source term under label perturbation, and rejects strings that are not CL vocabulary.
- **Ground truth**: planted simulation; generated strings carry their source term and negative controls carry gold = unmapped. Estimand: per class, the fraction of generated strings (collisions excluded) mapped to the source.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Cell Ontology `cl.obo`, pinned | [R1]; download_cell_ontology.py:24 | ontology file; term count — | see section 12 | pinned by checksum |

- **Generator recipe**
  1. Take active terms with labels and exact synonyms; drop obsolete terms.
  2. Split exact synonyms into tuning and test halves; for the synonym and abbreviation classes, remove test-half strings from the index and synonym tables.
  3. Generate case and separator changes, plurals, test-half synonyms, test-half abbreviations (four characters or fewer), one-character edits of labels longer than six characters, and the prefixes "human " and "adult ".
  4. Add negative controls ("unknown", "low quality cells", "doublet", "ambiguous", "unassigned") that match no active label or synonym after normalisation.
  5. Count strings matching two or more active terms as collisions and exclude them.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| exact-ID accuracy | per class; abstentions are errors | higher | primary | — |
| precision and coverage | correct over mapped; mapped over all | precision higher | guardrail | — |
| false-mapping rate | negative controls mapped, over negative controls | lower | guardrail | — |
| ancestor compatibility (qualifier class) | as defined in section 3 | higher | guardrail | [R6] |

- **Comparators**: normalised lookup without and with the source synonym table (section 4); OLS first hit; the proposed resolver (not implemented).
- **Protocol**: score classes separately; intervals resample source terms.
- **Acceptance criterion**: design target, not from the literature: exact-ID accuracy at least 0.98 for case, separator and plural classes, at least 0.90 for held-out synonyms, and a false-mapping rate of at most 0.02.
- **Known pitfalls**: a hand-written table built from test-half strings makes the held-out classes circular; live service responses drift with version.

### B2. Held-out-study recovery of curator CL assignments

- **Goal**: measure how often the mapping reproduces the CL identifier curators assigned to study-level labels, for studies absent from the index and synonym table.
- **Ground truth**: expert labels, the identifier recorded per (study, label) pair in source metadata (majority where annotators disagree). Estimand: per study, the fraction of unique labels whose mapped identifier equals the curator identifier; studies weighted equally, cells not counted. Equation 3 uses the same items.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Tabula Sapiens label-to-identifier pairs | [R11] | scRNA-seq, human, multiple organs; cell count — | — | identifier pairs only |
| singlet catalogue, author-annotated subset | internal | single-cell, multiple species; 354M cells, about 40% annotated | internal | usable only if identifiers are stored (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| exact-ID accuracy | per study, then averaged; abstentions are errors | higher | primary | — |
| hierarchical F | hP, hR and hF of equation 3, per study, then averaged | higher | primary | [R6] |
| ancestor compatibility | as in B1, over all scored items | higher | guardrail | [R6] |
| unmapped fraction | abstained items over scored items, reported with coverage | lower at fixed accuracy | guardrail | — |

- **Comparators**: normalised lookup with and without the synonym table; OLS first hit; scOntoMatch exact name translation (section 12); the proposed resolver (not implemented).
- **Protocol**: hold out whole studies; report per tissue and species; estimate the ceiling from doubly annotated labels where they exist.
- **Acceptance criterion**: design target, not from the literature: exact-ID accuracy at least 0.85 and hF at least 0.93 at a stated coverage, with ancestor compatibility at least 0.97. Results below the measured agreement ceiling are flagged, not failed.
- **Known pitfalls**: identifiers produced by string matching to CL make the benchmark measure the matcher; identifiers obsolete in the pinned release must go through replaced_by first.

### P1. Performance and scaling

Measure wall time, peak memory and throughput in unique labels per second for U = 10^3, 10^4, 10^5 and 10^6 unique strings. Cover the normalised lookup on one CPU core and the OLS method with cold and warm caches; report p95 latency of remote calls and the cache hit rate. Scale is counted in labels, not cells, because the lookup is applied once per label; cell-level output is a join on the label and scales linearly with cells. Costs: the lexical lookup is O(|s|) per label through a hash index; OLS makes one network request per uncached label. CUDA does not apply to the current methods. Hold fixed: the release, normalisation, synonym table, batch size and hardware. The throughput target is set from the first measurement. Comparators are those in B1.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `annotation.llm_cluster_annotation`: LLM-based cluster annotation from marker gene lists
- **Feeds**:
  - `annotation.cross_dataset_label_reconciliation`: Cross-dataset cell-type label reconciliation
  - `annotation.hierarchical_annotation`: Hierarchical, ontology-aware coarse-to-fine annotation
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
- **Reads**: `obs/<label_column>`
- **Writes**: `uns/cl_release`, `uns/cl_label_map`, `obs/cl_term_id`, `obs/cl_term_label`, `obs/cl_match_type`, `uns/cl_mapping_report`
<!-- CHAINING:AUTO:END -->

Belongs to the cross-dataset annotation workflow: labels from cluster or transfer annotation are mapped here before reconciliation and hierarchical calling.

## 10. Risks, pitfalls and open questions

- **Catalogue coverage and counts**: whether the singlet catalogue stores CL identifiers for its annotated cells is unknown, and so is whether the Tabula Sapiens metadata gives an identifier per label; the counts of active CL classes, unique labels and label-to-identifier pairs are also unknown. These decide whether B2 and the resolver are feasible, and they must be recorded at the first measurement.
- **Source checks**: equation 3 is the ancestor-augmented form attributed to [R6]; the paper text was not read, so that definition is from memory. The Osumi-Sutherland author list is abbreviated, and the author list of [R9] is from memory. CellO's README gives 2020 and scRNA-tools gives 2021; the reference uses 2021. The CELLxGENE schema label rule is not documented here.
- **Repository state**: four corpus copies carry no version-control metadata, so their commit identifiers in section 4 cannot be checked against history. The B1 release is not yet pinned.
- **Unsettled literature**: no accepted name-only standard exists; curator agreement on identifiers is unquantified, so the B2 ceiling is unknown; the granularity policy is undecided; abstention thresholds have not been characterised across releases or studies; the mLLMCelltype partial-credit rule is heuristic.
- **Technical and data risks**: live OLS responses drift with service version. Whether historical CL releases can be obtained is unknown. Release stability (labels that keep their identifier between two releases, or change only through replaced_by) and parent-child consistency are proposed measures, deferred until two releases are available. The output for compound labels has no defined format.
- **First experiment**: pin `cl.obo`, build the normalised lookup, score the B1 classes and negative controls, and record collisions. Then count the catalogue's label-to-identifier pairs to decide whether B2 and the resolver proceed.

## 11. References

R1. Diehl AD, Meehan TF, Bradford YM, Brush MH, Dahdul WM, Dougall DS, He Y, Osumi-Sutherland D, Ruttenberg A, Sarntivijai S, et al. The Cell Ontology 2016: enhanced content, modularization, and ontology interoperability. *J Biomed Semantics* 2016;7:44. doi:10.1186/s13326-016-0088-7 — verified (repo)
R2. Osumi-Sutherland D, et al. Cell type ontologies of the Human Cell Atlas. *Nat Cell Biol* 2021;23:1129-1135. doi:10.1038/s41556-021-00787-7 — verified (search)
R3. Bard J, Rhee SY, Ashburner M. An ontology for cell types. *Genome Biol* 2005;6:R21. doi:10.1186/gb-2005-6-2-r21 — verified (search)
R4. Jupp S, Burdett T, Malone J, Leroy C, Pearce M, McMurry J, Parkinson HE. A new Ontology Lookup Service at EMBL-EBI. *CEUR Workshop Proc* 2015;1546:118-119. — verified (repo)
R5. Liu F, Shareghi E, Meng Z, Basaldella M, Collier N. Self-alignment pretraining for biomedical entity representations. *NAACL* 2021. — unverified (memory)
R6. Kosmopoulos A, Partalas I, Gaussier E, Paliouras G, Androutsopoulos I. Evaluation measures for hierarchical classification: a unified view and novel approaches. *Data Min Knowl Discov* 2015;29:820-865. doi:10.1007/s10618-014-0382-x — verified (repo)
R7. Hou W, Ji Z. Assessing GPT-4 for cell type annotation in single-cell RNA-seq analysis. *Nat Methods* 2024;21:1462-1465. doi:10.1038/s41592-024-02235-4 — verified (corpus)
R8. Bernstein MN, Ma J, Gleicher M, Dewey CN. CellO: comprehensive and hierarchical cell type classification of human cells with the Cell Ontology. *iScience* 2021;24(1):101913. doi:10.1016/j.isci.2020.101913 — verified (corpus)
R9. Wang S, Pisco AO, Karkanias J, Altman RB. Leveraging the Cell Ontology to classify unseen cell types. *Nat Commun* 2021. doi:10.1038/s41467-021-25725-x — verified (corpus)
R10. Crowley G, et al. Benchmarking cell type and gene set annotation by large language models with AnnDictionary. *Nat Commun* 2025. doi:10.1038/s41467-025-64511-x — verified (corpus)
R11. Jones RC, et al. (Tabula Sapiens Consortium). The Tabula Sapiens: a multiple-organ, single-cell transcriptomic atlas of humans. *Science* 2022. doi:10.1126/science.abl4896 — verified (corpus)
R12. Jackson RC, Balhoff JP, Douglass E, Harris NL, Mungall CJ, Overton JA. ROBOT: a tool for automating ontology workflows. *BMC Bioinformatics* 2019. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/cafferychen777/mLLMCelltype | Chen Yang, Xianyang Zhang, Jun Chen (CITATION.cff; version 2.0.8) | MIT (LICENSE, copyright 2025 Chen Yang) | source of normalisation, synonym table and OLS evaluation code (HEAD 26bda56) | port (normalisation and query construction); its selection and scoring are replaced |
| https://github.com/EBISPOT/ols4 | EMBL-EBI OLS team (README) | Apache-2.0 (LICENSE; HEAD 493545801ca8f5c86f7d15650eed1f2a4cd765ef) | Ontology Lookup Service and REST API | callout (public REST interface; no code ported) |
| https://github.com/obophenotype/cell-ontology | obophenotype project (repository owner) | CC BY 4.0 (LICENSE; master HEAD 8a551dd52325bb087a654389f9e17630c74750d2) | source of the `cl.obo` release | data input (pinned release) |
| https://github.com/ontodev/robot | The authors (LICENSE.txt; OBO Foundry tool per README) | BSD-style (LICENSE.txt; master HEAD 37d514d2ac8970b6ce7b9f5cfe83ba08dc97e9d8) | release merge and checks | callout |
| https://github.com/deweylab/CellO | Matthew N. Bernstein (setup.py); Dewey lab | MIT (LICENSE, copyright 2021 Matthew N. Bernstein) | human expression classifier | callout |
| https://github.com/wangshenguiuc/OnClass | Sheng Wang (setup.py) | MIT (LICENSE, copyright 2021 sheng wang) | CL name embedding for expression classification | callout |
| https://github.com/Papatheodorou-Group/scOntoMatch | Yuyao Song (maintainer); Irene Papatheodorou (DESCRIPTION) | MIT (LICENSE, copyright 2022 scOntoMatch authors; DESCRIPTION "MIT + file LICENSE"; HEAD 9379936) | identifier-level ancestor matching; exact name translation | callout |
| https://github.com/YosefLab/popV | Can Ergen (copyright holder, LICENSE) | MIT (LICENSE, copyright 2023 Can Ergen) | context: cell-ontology annotation requirements | callout |
