---
id: harmonization.sample_metadata_ontology_mapping
title: Sample metadata to ontology term mapping
area: harmonization
scope: extended
paradigm: hybrid
literature_status: open
priority: P2
depends_on: [harmonization.geo_metadata_extraction]
feeds: [harmonization.schema_conformance_validation, annotation.cell_ontology_mapping]
reads: [obs/<field>_raw, uns/ontology_release]
writes: [obs/<field>_term_id, obs/<field>_term_label, obs/<field>_match_type, obs/<field>_confidence, obs/<field>_needs_curation, uns/unmapped_values]
devices: [cpu, cuda]
mcp_tool: singlet_harmonization_sample_metadata_ontology_mapping
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Sample metadata to ontology term mapping

> Assigns each free-text sample field value one term of a pinned ontology release that the target schema allows, using dictionary matching with explicit match types, and sends weak or out-of-range matches to curation.

## 1. Question

Can a free-text value of a sample field (tissue, disease, organism, development stage or assay) be assigned the one controlled term, from a pinned UBERON, MONDO, NCBITaxon, HsapDv or EFO release, that the target schema allows? The input is the raw field values, a schema identifier and the release pins. The output is, per field, a validated term ID with its label, match type, calibrated confidence and curation flag. A correct answer names the term the value denotes within the allowed range, or abstains. Age and sex are excluded (§10).

## 2. Why this task matters and where the field stands

Sample metadata from GEO and SRA is free text, but cross-study analysis and target schemas need one controlled term per field. An unmapped value removes a sample from the schema. A wrong term is worse, because it merges unlike samples without any visible error. MetaSRA normalised human SRA sample metadata to ontology-linked key-value sets with a typed-graph pipeline [R1, R2]. The target ontologies include UBERON [R7] and EFO [R6].

Status: **open**. The sources cited here give no accuracy figure for sample-field mapping, so the benchmarks in §8 are proposed. Open problems: (1) no accepted curated benchmark exists in the cited sources; (2) context values such as "control", "normal" or "untreated" have no single disease term, so abstention may be the correct output; (3) allowed ranges and release migration decide which term is correct, and both change between versions; (4) embedding retrieval and language-model suggestion are plausible for the long tail, but no sample-field evaluation of either is cited.

## 3. Theory and insight

Each (value, field) pair is a candidate-retrieval and selection problem. A raw value is normalised to $\tilde v$ by folding case, punctuation and whitespace. Each candidate term $t$ of the pinned release receives its best score over match types $m$ (exact, synonym, normalised, fuzzy):

$$s(v,t)=\max_{m}\;w_m\,\mathrm{sim}_m(\tilde v,\ell),\qquad \ell\in\mathrm{labels}(t)\cup\mathrm{syn}(t).$$

For the fuzzy type, $\mathrm{sim}_{\mathrm{Lev}}(a,b)=1-d_{\mathrm{Lev}}(a,b)/\max(|a|,|b|)$, and a candidate is kept only when $d_{\mathrm{Lev}}$ is within a radius that shrinks with length. The regime is short strings, where one edit changes a large share of the value and produces acronym false positives. The weights $w_m$ are ordered exact > synonym > fuzzy by design and are not fitted.

A calibrated layer turns the candidate set $\mathcal C(v)$ into a posterior with temperature $\tau$:

$$p(t\mid v)=\frac{\exp(s(v,t)/\tau)}{\sum_{t'\in\mathcal C(v)}\exp(s(v,t')/\tau)}.$$

A call is accepted when $\max_t p(t\mid v)$ reaches the abstention threshold. $\tau$ minimises the negative log-likelihood of curated pairs in the development split. This holds only when scores are comparable across candidates and fields, and it must be rechecked on the held-out split.

For hierarchy-aware scoring, let $A(t)$ be $t$ together with its is_a and part_of ancestors in the pinned release:

$$\mathrm{hP}=\frac{|A(\hat t)\cap A(t^\ast)|}{|A(\hat t)|},\qquad \mathrm{hR}=\frac{|A(\hat t)\cap A(t^\ast)|}{|A(t^\ast)|},\qquad \mathrm{hF}=\frac{2\,\mathrm{hP}\,\mathrm{hR}}{\mathrm{hP}+\mathrm{hR}}.$$

This holds when the same closure is applied to predictions and gold, and it is not comparable across releases. Every emitted ID also passes the logical check $\mathrm{valid}(\hat t)=\mathbb 1[\hat t\in\mathcal T_r]\,\mathbb 1[\hat t\notin\mathcal O_r]\,\mathbb 1[\hat t\in R_f]$, where $\mathcal T_r$ is the term set of release $r$, $\mathcal O_r$ its obsolete terms and $R_f$ the allowed range of field $f$.

Estimands and normalisation:
- **Emitted ID**: the term the value denotes within $R_f$, or none, per (record, field).
- **Confidence**: the posterior $p(\hat t\mid v)$ of the accepted call, an estimate of the probability that the accepted ID equals gold.
- **hF**: computed per (record, field), with abstentions scored as zero recall.
- **Abstention rate**: the share of (record, field) pairs with no accepted ID.
- **Planted recovery**: the share of perturbed strings whose accepted ID equals the source term.

Accuracy averages weight frequent values more; unique-value averages are reported beside them.

Assumptions: each value denotes one concept, compound strings are flagged (§10), the release is pinned, each allowed range is an ontology subtree, and curated pairs use the same release. Failure modes: short acronyms yield confident fuzzy false positives; a wrong exact synonym can outrank the right term when synonym sets are noisy; context values map to no term or to a broad parent; obsolete IDs change silently across releases; language-model output can name IDs outside the release.

A model adds what the cascade lacks: a posterior whose threshold has a meaning as expected precision of accepted calls, a way to reuse a trained encoder across fields, and room for covariates such as the field name. The working insight is inferred from MetaSRA's design, and no coverage figure is cited: a dictionary-first stage with curated synonyms covers the repetitive head, while errors concentrate in the long tail, in acronyms and in compound strings.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| MetaSRA typed-graph pipeline | hybrid | Links key-value nodes to term nodes through typed edges (synonym sets, fuzzy, property-specific synonyms), then filters and ranks the edges | [R1], [R2] |
| Bounded fuzzy matching with exact precedence | heuristic | Edit-distance search over labels and synonyms; a distance-0 match removes weaker fuzzy edges for the same tokens | [R2] |
| Hierarchy propagation (scOntoMatch) | heuristic | Matches cell-type labels by direct and descendant-to-ancestor mapping over an OBO graph with is_a and part_of propagated | §12 |
| CellO | model-based | Hierarchical classifiers over Cell Ontology classes trained on labelled reference profiles | [R4] |
| OnClass | model-based | Scores expression profiles against Cell Ontology terms through the graph, including unseen types | [R5] |

The MetaSRA pipeline is the only published sample-field mapper with public code cited here, and it is the comparator in every benchmark. The two model-based rows are cell-type classifiers. They are included as the closest model-based precedents for ontology-grounded output and are not sample-field mappers.

| Method | Parameter | Value | Source |
|---|---|---|---|
| MetaSRA pipeline | token score | uniform weight `defaultdict(lambda: 1)`, marked in the code as a placeholder | map_sra_to_ontology/pipeline_components.py:34 @ e760072 |
| MetaSRA pipeline | n-gram window | `max_n = min(n_thresh, len(grams))` with `n_thresh = 8` | pipeline_components.py:354, 364 @ e760072 |
| MetaSRA pipeline | fuzzy radius | 2 on `CasePermissiveAlnumWeightedEditDistance(0.2, 0.2)` | run_pipeline.py:273-274 @ e760072 |
| MetaSRA pipeline | exact precedence | a distance-0 edge removes distance-above-0 edges for the same token set | pipeline_components.py:535-575 @ e760072 |
| MetaSRA pipeline | ontology tie-break | exact matches to several terms resolved by semantic closeness | pipeline_components.py:778-782 @ e760072 |
| scOntoMatch | relationship propagation | `c('is_a', 'part_of')` | README.md:34 @ 9379936 |

## 5. Proposed singlet approach

**Routes.** The MetaSRA matcher and graph are ported (permissive licence, §12). CellO, OnClass and scOntoMatch are callouts with no comparator role here, because their scope is cell types.

**Default cascade.** Exact label, exact synonym, normalised and bounded fuzzy matches are tried in that order, and the first accepted match wins. Exact matches suppress fuzzy edges for the same value, as in the MetaSRA priority rule [R2]. Fuzzy distance is plain Levenshtein, with radius 1 for values under 8 characters and 2 otherwise (proposed). The MetaSRA radius of 2 applies to its weighted distance (§4), so the two are not interchangeable. Fuzzy-only matches go to curation until the calibrated layer is fitted. Ancestor acceptance is off by default and flags its output.

**Model-based layer.** The posterior of §3 is computed over the cascade's candidates, with $\tau$ fitted on curated development pairs and an abstention threshold of 0.8 (proposed). It is falsified on held-out B1 if it does not lower the false-accept rate on unmapped gold relative to the uncalibrated cascade at equal abstention, or if its expected calibration error with equal-width bins exceeds 0.05 (proposed). If either happens, the layer is removed.

**Deferred stages.** Embedding retrieval and language-model suggestion are absent from the enum until a primary source is cited for each. Any candidate they add must be a release member before scoring, and their outputs are checked against the release.

**Stack and devices.** The cascade is dictionary code with no fitted parameters, so it executes on CPU. One temperature needs no deep-learning framework. PyTorch is reserved for an encoder, and a CUDA top-k over a dense term matrix would follow only with an encoder; sparse kernels are not needed.

**Defaults.** Method `exact_then_fuzzy`, `hierarchy_policy` `exact_only`, `allow_obsolete` false and `abstention_threshold` 0.8. Mapping is applied to unique (field, value) pairs and broadcast to records, so the stage is not streamed per cell.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `obs/<field>_raw` | string | raw free-text value for each requested field |
| read | `uns/ontology_release` | dict | pinned release identifier and date per ontology |
| write | `obs/<field>_term_id` | string | accepted term ID, or empty |
| write | `obs/<field>_term_label` | string | label of the accepted ID in the pinned release |
| write | `obs/<field>_match_type` | categorical | exact_label, exact_synonym, normalised, fuzzy, graph or unmapped |
| write | `obs/<field>_confidence` | float32 | calibrated posterior of the accepted call; NaN before calibration |
| write | `obs/<field>_needs_curation` | bool | true when unmapped, fuzzy-only or ancestor-accepted |
| write | `uns/unmapped_values` | dict of lists | distinct unresolved values per field for curator review |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `fields` | array | ["tissue", "disease", "organism", "development_stage", "assay"] | — | Sample fields to map. Each maps to the ontology named in ontology_release. |
| `target_schema` | string | required | — | Schema identifier whose allowed ranges give each field's ontology subtree. Required; no default. |
| `ontology_release` | object | required | — | Pinned release identifier for each ontology used. Required; no default. |
| `ontology_release.UBERON` | string | — | — | Pinned UBERON release identifier and date. |
| `ontology_release.MONDO` | string | — | — | Pinned MONDO release identifier and date. |
| `ontology_release.EFO` | string | — | — | Pinned EFO release identifier and date. |
| `ontology_release.NCBITaxon` | string | — | — | Pinned NCBITaxon release identifier and date. |
| `ontology_release.HsapDv` | string | — | — | Pinned HsapDv release identifier and date. |
| `method` | string | "exact_then_fuzzy" | `exact_then_fuzzy`, `metasra_graph` | exact_then_fuzzy is the default dictionary cascade. metasra_graph is the MetaSRA-style typed-graph comparator. |
| `policy` | object | — | — | Acceptance rules shared by all methods. |
| `policy.abstention_threshold` | number | 0.8 | min 0; max 1 | Minimum calibrated posterior to accept a call; below it the value goes to curation. |
| `policy.hierarchy_policy` | string | "exact_only" | `exact_only`, `allow_ancestor` | allow_ancestor accepts a broader parent when no exact term exists, and flags it. |
| `policy.allow_obsolete` | boolean | false | — | Whether obsolete terms may be emitted. Keep false; obsolete IDs fail validation. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device. Dictionary methods use cpu; cuda has no effect until an embedding stage is added. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing members. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `exact_then_fuzzy` | object | — | — | Options for exact_then_fuzzy: edit limits by value length. |
| `exact_then_fuzzy.short_length` | integer | 8 | min 1 | Values shorter than this many characters use max_edits_short. |
| `exact_then_fuzzy.max_edits_short` | integer | 1 | min 0 | Maximum edit distance for values shorter than short_length. |
| `exact_then_fuzzy.max_edits_long` | integer | 2 | min 0 | Maximum edit distance for values of short_length or more. |
| `metasra_graph` | object | — | — | Options for metasra_graph. reference_dir is required with that method. |
| `metasra_graph.reference_dir` | string | — | — | Directory of MetaSRA-style reference synonym sets. |
<!-- PARAMS:AUTO:END -->

Method options live in nested objects and apply only to their method; `policy` and `device` apply to every method. A value whose best term lies outside the allowed range is never emitted, whatever its score. `ontology_release` and `target_schema` are required, so no release is assumed.

## 7. MCP tool

Tool name `singlet_harmonization_sample_metadata_ontology_mapping` (definition in `tasks/mcp/singlet_harmonization_sample_metadata_ontology_mapping.json`). Example call and result:

```json
{"dataset": "study.singlet", "fields": ["tissue"], "target_schema": "<schema-id>",
 "ontology_release": {"UBERON": "<release-id>"}, "policy": {"abstention_threshold": 0.8}}
```

```json
{"dataset": "study.singlet", "status": "completed",
 "wrote": ["obs/tissue_term_id", "obs/tissue_term_label", "obs/tissue_match_type",
           "obs/tissue_confidence", "obs/tissue_needs_curation", "uns/unmapped_values"],
 "summary": {"tissue": {"accepted": "<count>", "abstained": "<count>"}, "invalid_ids": 0},
 "provenance_id": "<id>", "job_id": null}
```

Not long-running: the stage is a dictionary lookup over unique values. Deterministic: no seed, given the release and the curated pairs. Dry run returns an estimate of seconds, peak memory and device, and writes nothing.

## 8. Benchmarks

All benchmarks fix one pinned release per ontology before scoring, re-map every method's IDs to it, and flag obsolete or absent IDs. Development and held-out splits are by study, never by value; thresholds and temperature are fitted on development only, and the held-out split is reported once. Curators and generators do not see method outputs. Dictionary methods are deterministic, so no seeds are used. Accuracy benchmarks report hF, exact-ID accuracy on accepted calls, abstention and false acceptance per field. The MetaSRA pipeline is a comparator in every benchmark.

### B1. Curator-labelled held-out records (proposed)

- **Goal**: per-field term accuracy, hierarchical F1, abstention and false acceptance on sample records with curator-assigned terms.
- **Ground truth**: expert labels. Two curators assign one term ID per (record, field) from the pinned release, blinded to method outputs; disagreements are adjudicated; unresolvable values are labelled unmapped. The estimand is the gold ID, or unmapped, per (record, field).

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Sample records from the SRA as normalised by MetaSRA | [R1]; database at https://metasra.platformx.wisc.edu/ [R2] | Human RNA-seq sample records; size set by the stratified draw | Stratified by field and value frequency; excludes records used to build synonym sets |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| hF | per field and frequency stratum; abstentions score zero recall | maximize | primary | — |
| Exact-ID accuracy | share of accepted calls whose ID equals gold | maximize | guardrail | — |
| Abstention rate | share of (record, field) pairs with no accepted ID | minimize | guardrail | — |
| False-accept rate | share of unmapped gold pairs that receive an ID | minimize | guardrail | — |

- **Comparators**: exact label and synonym lookup; MetaSRA-style typed graph; the cascade with and without the calibrated layer.
- **Protocol**: frozen curation guidelines; Cohen kappa between curators reported without a threshold; unique-value averages reported alongside per-pair averages.
- **Acceptance criterion** (proposed, not from the literature): hF of at least 0.90 on the head stratum and at least 0.75 on the long tail, with abstention rate reported.
- **Known pitfalls**: synonym sets built from the same curated labels leak into the benchmark; curator bias toward the method under test, reduced by blinding.

### B2. Planted surface-form recovery (proposed)

- **Goal**: recovery of a planted target term under controlled surface variation.
- **Ground truth**: planted simulation. The term each perturbed string started from is known by construction. Recovery is the share of perturbed strings whose accepted ID equals that term, per perturbation class.
- **Generator recipe**:
  1. For each release term, take its label and each synonym as source strings.
  2. Apply one class at a time: case change, plural, hyphenation, abbreviation, one- or two-character edit, synonym substitution.
  3. For each target, add a distractor term whose label lies within two edits of the target label.
  4. Remove the generator's synonyms from the matcher's synonym sets before scoring, and report held-out synonyms separately.
  5. Stratify by label length: under eight characters, and eight or more.

| Dataset | Source | Modality, species, size | Notes |
|---|---|---|---|
| Synthetic perturbations of pinned-release labels and synonyms | generator recipe above | strings only; size set by the recipe | ground truth known by construction |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recovery rate | per class, share of perturbed strings whose accepted term is the source term | maximize | primary | — |
| Distractor false-positive rate | share of perturbed strings whose accepted term is the distractor | minimize | guardrail | — |
| Calibration error | expected calibration error of accepted-call posteriors, equal-width bins | minimize | guardrail | — |

- **Comparators**: exact lookup, bounded fuzzy matching, MetaSRA-style typed graph.
- **Acceptance criterion** (proposed, not from the literature): recovery of at least 0.95 for case and plural changes, and at least 0.80 for single-typo perturbations on labels of eight characters or more.
- **Known pitfalls**: circularity if the matcher's synonyms came from the generator; short labels are ambiguous under one-character edits.

### P1. Performance and scaling

Throughput in unique (field, value) pairs per second at 10^3, 10^4 and 10^5 unique values (proposed scales), on CPU, for the cascade, the MetaSRA-style pipeline, an in-memory exact dictionary and bounded fuzzy search. Index build time is reported separately and excluded from throughput; peak memory is recorded at each scale. Hold fixed the release, hardware, batch size and thread count. Network services are excluded. Embedding timing is out of scope until that stage is adopted.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.geo_metadata_extraction`: Automated metadata extraction from GEO and SRA records
- **Feeds**:
  - `harmonization.schema_conformance_validation`: Metadata conformance to a community schema
  - `annotation.cell_ontology_mapping`: Cell type name harmonization to Cell Ontology terms
- **Reads**: `obs/<field>_raw`, `uns/ontology_release`
- **Writes**: `obs/<field>_term_id`, `obs/<field>_term_label`, `obs/<field>_match_type`, `obs/<field>_confidence`, `obs/<field>_needs_curation`, `uns/unmapped_values`
<!-- CHAINING:AUTO:END -->

Used in metadata harmonisation after sample fields are extracted and before schema conformance is checked.

## 10. Risks, pitfalls and open questions

- **Methods without a cited source**: OLS, OxO, the NCBO Annotator, sentence-encoder retrieval, LLM candidate selection and cellxgene-schema validation have no primary source cited here, so they are absent from the tables and the enum. The cellxgene-schema repository could not be accessed, so its per-field allowed ranges are unknown here.
- **Unsettled rules**: age has no direct HsapDv term and sex is outside the listed ontologies, so neither is mapped. Compound strings need a splitting rule before mapping, and context values such as "control" have no disease term.
- **Risks and data**: ontology licences (UBERON, MONDO, EFO, NCBITaxon, HsapDv) and the MetaSRA record licence were not checked. CRAFT [R3] covers Cell Ontology and NCBITaxon in its 2012 release, so its span metric would test only the organism field and is not used. Catalogue-based recovery of curated IDs is dropped because raw-text coverage is unknown and curated IDs may come from string matching.
- **First experiment**: draw a stratified set of MetaSRA-normalised records, label it with two blinded curators under frozen guidelines, fit $\tau$ and the threshold on the development split, and compare the cascade with the MetaSRA-style graph on the held-out split (B1).

## 11. References

R1. Bernstein MN, Doan A, Dewey CN. MetaSRA: normalized human sample-specific metadata for the Sequence Read Archive. *Bioinformatics* 2017;33(18):2914–2923. doi:10.1093/bioinformatics/btx334 — partial (search)
R2. MetaSRA developers. MetaSRA pipeline, source at commit e760072. GitHub deweylab/metasra-pipeline; licence copyright 2023. — partial (repo)
R3. Bada M, et al. Concept annotation in the CRAFT corpus. *BMC Bioinformatics* 2012;13:161. doi:10.1186/1471-2105-13-161 — partial (search)
R4. Bernstein MN, Ma J, Gleicher M, Dewey CN. CellO: comprehensive and hierarchical cell type classification of human cells with the Cell Ontology. *iScience* 2021;24(1):101913. doi:10.1016/j.isci.2020.101913 — verified (corpus)
R5. Wang S, et al. Leveraging the Cell Ontology to classify unseen cell types. *Nature Communications* 2021. doi:10.1038/s41467-021-25725-x — verified (corpus)
R6. Malone J, Holloway E, Adamusiak T, et al. Modeling sample variables with an Experimental Factor Ontology. *Bioinformatics* 2010. — unverified (memory)
R7. Mungall CJ, Torniai C, Gkoutos GV, Lewis SE, Haendel MA. Uberon, an integrative multi-species anatomy ontology. *Genome Biology* 2012. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/deweylab/metasra-pipeline | MetaSRA developers (LICENSE copyright 2023) | BSD-3-Clause | matcher, graph and exact-precedence reference | port |
| https://github.com/deweylab/CellO | Matthew N. Bernstein (setup.py, LICENSE) | MIT License | cell-type precedent | callout |
| https://github.com/wangshenguiuc/OnClass | Sheng Wang (setup.py) | MIT License | cell-type precedent | callout |
| https://github.com/Papatheodorou-Group/scOntoMatch | Yuyao Song; Irene Papatheodorou (DESCRIPTION) | MIT + file LICENSE | hierarchy propagation precedent | callout |
