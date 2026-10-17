---
id: harmonization.geo_metadata_extraction
title: Automated metadata extraction from GEO and SRA records
area: harmonization
scope: extended
paradigm: hybrid
literature_status: open
priority: P2
depends_on: []
feeds: [harmonization.sample_metadata_ontology_mapping, harmonization.schema_conformance_validation]
reads: [uns/geo_records, uns/sra_attributes, uns/publication_text]
writes: [uns/geo_sample_metadata, uns/geo_extraction_evidence, uns/geo_extraction_provenance, obs/geo_sample_id]
devices: [cpu]
mcp_tool: singlet_harmonization_geo_metadata_extraction
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Automated metadata extraction from GEO and SRA records

> Turns each sample's free-text GEO and SRA record into normalised organism, tissue, disease, cell line, perturbation, platform, technology and cell-count fields, each with a verbatim evidence span and, where one exists, a pinned ontology ID.

## 1. Question

Can the organism, tissue, disease, cell line, perturbation, platform, technology and cell count of each GEO or SRA sample be extracted from its free-text record, with a verbatim source span for every value? A correct answer matches blind expert curation on the value and its span, and returns null rather than a guess when the record does not state the field. Input: characteristics fields, titles, descriptions and file names. Output: one normalised row per sample.

## 2. Why this task matters and where the field stands

Submitters write GEO and SRA records as free text, and samples in one series share boilerplate. The same concept appears under different keys, so a collection cannot be filtered by disease or tissue until its values are comparable. MetaSRA normalises SRA sample descriptions for human samples with ontology terms [R1][R2]. A GPT-4 assessment [R7] and an LLM benchmark for cell-type and gene-set annotation [R8] address cell annotation, not GEO fields. No GEO-wide accuracy benchmark is identified here, so §8 proposes one.

Status: **open**. GEOparse keys each value by its position and joins non-characteristic values with commas [R3]. Samples whose keys are ordered differently are misaligned, and compound values lose their structure. The open problems are whether a value is specific to its sample or inherited from its series, which changes recall; how negation and control states ("healthy control", "untreated") reverse a disease or perturbation value; what a cell count measures; and how ontology terms drift across releases.

## 3. Theory and insight

Let $x_s$ be the text of sample $s$: key-value strings from its characteristics fields, plus title, description, source name and file names. Let $z_{g(s)}$ be the text of its series. For each field $f$ the output is a value $y_{s,f}\in\mathcal O_f\cup\{\varnothing\}$ and a span $e_{s,f}$ taken from $x_s$ or $z_{g(s)}$. MetaSRA links a mention $m$ from a key-value pair to every ontology term within edit distance 2:

$$T_m=\{\,t\in\mathcal O:\;d_{\mathrm L}(m,t)\le 2\,\},\qquad d_{\mathrm L}(a,b)=\min\bigl(\#\mathrm{ins}+\#\mathrm{del}+\#\mathrm{sub}\bigr).$$

Each distance costs $O(|a||b|)$ time, and $d_{\mathrm L}$ is a metric, so a BK-tree can prune the range query. The radius is absolute, not scaled by length. The rule is sound for long, distinctive mentions. For mentions of four characters or fewer the radius covers most of the string, and "CD4" and "CD8" are at distance 1, so a fixed radius links distinct markers.

Sample-type decisions use one-vs-rest L1 logistic regression on sparse term features:

$$\hat w=\arg\min_{w}\;\|w\|_{1}+C\sum_{i=1}^{n}\log\bigl(1+e^{-y_i\,w^{\top}x_i}\bigr),$$

fitted once per class. The regime is $n$ sample records with sparse features, and the L1 term leaves a short list of informative terms per class. Its scores are uncalibrated until checked against curated labels.

**Estimands.** Each output and ground-truth quantity is defined as follows.

- $y_{s,f}$ is the value a curator assigns to sample $s$ for field $f$ from $x_s$ and $z_{g(s)}$ under the codebook, written as the pinned ontology ID or, for free-text fields, as the string after lower-casing, Unicode NFKC normalisation and whitespace collapse.
- $e_{s,f}$ is the substring from which the value is taken, with character offsets and no other normalisation.
- The `geo_sample_id` of a cell is the GSM identifier of the sample it was measured in.
- $F1_f$ is computed over instances $(s,f)$. A true positive has an equal normalised value, and null-null instances are excluded:

$$P_f=\frac{TP_f}{TP_f+FP_f},\quad R_f=\frac{TP_f}{TP_f+FN_f},\quad F1_f=\frac{2P_fR_f}{P_f+R_f},\quad \text{macro-F1}=\frac{1}{|\mathcal F|}\sum_{f\in\mathcal F}F1_f.$$

- Coverage is the fraction of gold non-null instances with a non-null prediction. Abstention is never an error.
- $G=\frac1N\sum_{i}\mathbf 1[\operatorname{norm}(e_i)\subseteq\operatorname{norm}(x_{s_i})]$ is the fraction of predicted spans that occur verbatim after normalisation. It confirms that a span exists in the text, not that it supports the value.
- $n_{\text{text}}$ is the count as written, with its unit and before QC. $n_{\text{object}}$ is the number of barcodes retained after QC. Their log ratio measures the reporting gap, not extraction error.
- Organism concordance is the fraction of datasets whose text organism equals the organism implied by feature-identifier namespace.

Key-value splitting is mechanical [R3], and most values are short noun phrases that a lexicon covers exactly, which is why rules work. Errors concentrate in context: negation and control states, series inheritance, compound values, and cell lines that imply a disease. Heuristic failures follow from the design. A fixed radius links distinct short tokens, negation is missed unless encoded, and comma joins lose compound values. Two consequences follow for evaluation. Scores must be stratified by field and evidence type, because a macro-average hides a failing rare field. A learned extractor must be judged by the same stratification and by span grounding.

A model-based formulation adds what deterministic linking cannot: a probability that can be thresholded and calibrated, refitting when new series arrive, and series text as context. Its risk is leakage, because samples from one series share text, so only grouped evaluation (B3) tests it.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| GEOparse characteristics parsing | heuristic | splits each characteristics string at its first colon-space into type and value, one column per position and type | [R3] |
| MetaSRA mention linking and path disambiguation | heuristic | synonyms, n-grams, delimiters and camel-case splits make mentions; exact and fuzzy lookup in ontology lexicons; a scored graph path picks terms | [R1][R2] |
| MetaSRA sample-type classifier | model-based | one-vs-rest L1 logistic regression on term features | [R2] |

The published heuristic standard is the MetaSRA linking design, with GEOparse as its structural step. The sample-type classifier is the only learned component in the MetaSRA code. GEOmetadb compiles GEO metadata for search [R4], and ARCHS4 reprocesses GEO and SRA RNA-seq with kallisto [R5][R6]. Both index samples without extracting fields, so neither is in the table.

| Method | Parameter | Value | Source |
|---|---|---|---|
| GEOparse | entry point | `phenotype_data` property | src/GEOparse/GEOTypes.py:746 @ a3cf214 |
| GEOparse | characteristic split | first colon-plus-whitespace; type is the first part; value is the rest joined by `: ` | GEOTypes.py:757-758 @ a3cf214 |
| GEOparse | non-characteristic values | joined with `,` | GEOTypes.py:761 @ a3cf214 |
| GEOparse | empty field | NaN | GEOTypes.py:753-754 @ a3cf214 |
| MetaSRA | fuzzy edit-distance radius | 2 | map_sra_to_ontology/pipeline_components.py:956 @ e760072 |
| MetaSRA | match_numeric | False | pipeline_components.py:937 @ e760072 |
| MetaSRA | query_len_thresh | None; stored at :946 | pipeline_components.py:937, 946 @ e760072 |
| MetaSRA | sample-type penalty | `l1` | map_sra_to_ontology/predict_sample_type/one_vs_rest_classifier_same_features.py:81 @ e760072 |
| MetaSRA | sample-type C | 1.0 (library default; not passed) | same file, line 81 |
| MetaSRA | sample-type solver | not passed | same file, line 81 |

## 5. Proposed singlet approach

**Routes.** The GEOparse split is **ported**: it is a few lines under a permissive licence. The MetaSRA design is **reimplemented** in C++ with no code copied, because its cell-line stages have not been analysed for this document. The MetaSRA pipeline is a **callout**, the comparator in B1 and P1. A language-model tier is out of scope.

**Methods.** `rules` applies the GEOparse split with exact synonym and lexicon lookup, and no fuzzy matching or path scoring. It is the heuristic standard that every other method must beat. `metasra_style` (default) adds fuzzy lookup, n-gram and delimiter mentions, path scoring and negation handling.

**Proposed model-based tier.** A PyTorch token tagger emits spans that must pass the verbatim check; a value is kept when its score exceeds `min_confidence`. The tier is falsified if, on B3, its held-out macro-F1 does not exceed `metasra_style`, or if span grounding falls below the B1 target. The sparse classifier for disease versus control and sample type is a second candidate. Neither enters the enum until B1 and B3 exist and the method has a primary source.

**Stack and kernels.** PyTorch for the tagger, which is too large to hard-code. Sparse logistic regression stays on CPU unless profiling at catalogue scale shows it is the bottleneck. The C++ core owns the parser, lexicon trie and BK-tree search, which are deterministic and CPU-bound. CPU only in this version.

**Defaults.** Agents use the generated defaults in §6 without asking; `dataset` and `ontology_release` are required.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/geo_records | table | per-sample text keyed by GSM ID: title, description, source name, characteristics, platform and series IDs, file names |
| read | uns/sra_attributes | table | run or sample attributes keyed by SRA or ENA identifier |
| read | uns/publication_text | text, optional | linked paper text keyed by series ID |
| write | uns/geo_sample_metadata | table | one row per GSM: value and ontology ID for each target field, null where unstated |
| write | uns/geo_extraction_evidence | table | per field and sample: source field, character offsets, verbatim span, evidence type |
| write | uns/geo_extraction_provenance | record | method, ontology release, run date and options |
| write | obs/geo_sample_id | str | GSM identifier for each cell, when a cell-level object is linked |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle holding uns/geo_records; a .singlet path or URI, or a workspace handle. |
| `ontology_release` | string | required | — | Pinned release identifier for each ontology used to resolve IDs. Required; there is no default. |
| `method` | string | "metasra_style" | `metasra_style`, `rules` | metasra_style links values to ontology IDs with fuzzy lookup and path scoring; rules uses exact lookup only. |
| `fields` | array | ["organism", "tissue", "disease", "cell_line", "perturbation", "platform", "technology", "cell_count"] | — | Target fields to extract; the default is all eight. |
| `series_inheritance` | string | "series_fallback" | `series_fallback`, `sample_only` | series_fallback fills sample gaps with series-level text, marked as series-inherited; sample_only uses sample-level text. |
| `negation_handling` | boolean | true | — | Detect control, negated and untreated phrases before assigning disease or perturbation values. |
| `min_confidence` | number | 0.8 | min 0; max 1 | Values scoring below this become null. Proposed threshold, tuned on the development split only. |
| `cell_count_policy` | string | "report_as_stated" | `report_as_stated`, `flag_unclear` | report_as_stated keeps counts as written; flag_unclear marks counts whose unit or stage is unclear. |
| `metasra_style` | object | — | — | Options for metasra_style; ignored by rules. |
| `metasra_style.fuzzy_max_edit` | integer | 2 | min 0; max 2 | Maximum edit distance for fuzzy lexicon lookup; 2 is the MetaSRA radius. |
| `metasra_style.fuzzy_min_token_length` | integer | 5 | min 1 | Tokens shorter than this are matched exactly, never fuzzily, which blocks links such as CD4 to CD8. |
| `metasra_style.match_numeric` | boolean | false | — | Whether numeric tokens are fuzzy-matched. |
| `metasra_style.cell_line_implies_disease` | boolean | false | — | Whether a cell line name may fill the disease field. |
| `device` | string | "auto" | `auto`, `cpu` | Execution device; auto resolves to cpu because this task has no CUDA path. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`metasra_style` options are ignored by `rules`. `ontology_release` is required because IDs are release-specific. `negation_handling` and `cell_count_policy` change whether a value is assigned, nulled or flagged, not the lexicon. `series_fallback` values carry evidence type series-inherited and are never scored as sample-level evidence.

## 7. MCP tool

Tool name `singlet_harmonization_geo_metadata_extraction` (definition in `tasks/mcp/singlet_harmonization_geo_metadata_extraction.json`). Example call and compact result:

```json
{"dataset": "/data/geo_atlas.singlet", "ontology_release": "<pinned-release-id>", "method": "metasra_style", "fields": ["tissue", "disease"]}
{"dataset": "/data/geo_atlas.singlet", "status": "completed",
 "wrote": ["uns/geo_sample_metadata", "uns/geo_extraction_evidence", "uns/geo_extraction_provenance"],
 "summary": {"n_samples": "<int>", "n_values_by_field": {"tissue": "<int>", "disease": "<int>"}, "grounding_rate": "<float>", "flagged": "<int>", "method": "metasra_style"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: no. The lookup and tagging run inline at the scales in P1, and larger collections return `queued`. Stochastic: no. The default path has no random step, so reruns on the same release give the same records. Dry run: returns seconds, peak memory and device `cpu`, estimated from record count and lexicon size.

## 8. Benchmarks

**Shared protocol.** The evaluation unit is one (sample, field) instance. A prediction is correct when its normalised ontology ID equals the gold ID, or its normalised string equals the gold string for free-text fields. Normalisation is lower case, Unicode NFKC and collapsed whitespace. Null-null instances are excluded from F1. Every method uses the same sample set, one pinned ontology release and one frozen snapshot with recorded date and checksum. Curators code blind to any method output, using a codebook that records evidence type: structured key, free text or series-inherited. The sealed test set is scored once per method version.

### B1. Expert-labelled extraction set (proposed)

- **Goal**: per-field correctness and span grounding on blind-coded, stratified GEO samples.
- **Ground truth**: adjudicated expert labels with spans (§3).
- **Recipe**: (1) freeze a dated, checksummed GEO snapshot; (2) stratify by organism, platform and characteristics format; (3) seeded draw of series; (4) split by series; (5) blind coding and adjudication.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Stratified GEO draw | NCBI GEO snapshot, or GEOmetadb [R4] | series across organisms; size set at drawing | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| macro-F1 | mean per-field F1 (§3) | maximise | primary | — |
| coverage | gold non-null instances predicted non-null | maximise | guardrail | — |
| null-gold false positive rate | gold-null instances predicted non-null | minimise | guardrail | — |
| span grounding | predicted spans verbatim after normalisation | maximise | guardrail | — |
| kappa | Cohen's kappa on double-coded items; human ceiling | reported | guardrail | — |

- **Comparators**: `rules`, `metasra_style` and the MetaSRA pipeline.
- **Protocol**: thresholds fixed on the development split; reported by field and evidence type.
- **Acceptance criterion**: proposed, not literature: macro-F1 ≥0.85 (≥0.90 for organism and platform); span grounding ≥0.98; null-gold false positive rate ≤0.05; kappa ≥0.8 before sealed use.
- **Known pitfalls**: series-inherited text inflates recall; a codebook written after reading MetaSRA output favours its rules.

### B2. Orthogonal consistency with catalogue objects (proposed)

- **Goal**: check text-derived organism and cell count against catalogue objects the text did not produce.
- **Ground truth**: orthogonal measurement: organism from feature-identifier namespace (ENSG or ENSMUSG); cell count is the post-QC barcode count per sample, where a barcode map exists.
- **Recipe**: (1) select objects with GEO series provenance; (2) derive namespace organism and barcode counts; (3) extract blind; (4) triage mismatches.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| GEO-linked catalogue objects | singlet catalogue (internal) | single-cell; catalogue of 354M cells; GEO-linked subset: — | — | GEO provenance required |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| organism concordance | single-namespace datasets whose text organism equals namespace organism | maximise | primary | — |
| median absolute log ratio | median over datasets of abs(log(n_text / n_object)) | minimise | guardrail | — |
| cell count within tolerance | datasets with abs(n_text − n_object) ≤ 0.10 × n_object | maximise | guardrail | — |

- **Comparators**: `rules`, `metasra_style`.
- **Protocol**: a curator triages each mismatch as text (pre-QC) or object (post-QC). QC removes barcodes, so cell-count metrics triage rather than score.
- **Acceptance criterion**: organism concordance at least 0.98 on single-namespace datasets (proposed); every mismatch reviewed; 10% tolerance proposed.
- **Known pitfalls**: catalogue annotations derived from GEO text make the check circular; mixed-species and xenograft datasets break namespace inference.

### B3. Series-held-out generalisation (proposed)

- **Goal**: measure whether extractor performance survives unseen series, the deployment condition, because samples from one series share boilerplate.
- **Ground truth**: B1 expert labels, grouped by series.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B1 development and sealed sets, grouped by GSE | B1 | as B1 | — | also split by platform family where possible |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| macro-F1 on held-out series | macro-F1 computed only on samples from held-out series | maximise | primary | — |
| random-minus-series gap | macro-F1 on a random split minus macro-F1 on the series split | minimise | guardrail | — |

- **Comparators**: `metasra_style`, and any learned extractor added later.
- **Protocol**: GroupKFold by GSE with at least five folds. Training and tuning use training folds only, and the gap is computed on identical data.
- **Acceptance criterion**: a gap at most 0.05 for any learned method promoted to default (proposed). Rule-based methods report the gap without a gate.
- **Known pitfalls**: random splits leak near-duplicate text; series with few samples give unstable per-fold estimates.

### P1. Performance and scaling

Measure wall time, records per second and peak resident memory for `rules` and `metasra_style` at 1e3, 1e4 and 1e5 sample records, on one core and on all cores, and on the full GEO sample set when the catalogue can supply it. Report one-off setup (ontology and lexicon load, BK-tree build) apart from per-record time. Comparators: GEOparse phenotype parsing and the MetaSRA pipeline on the same JSON input. Hold fixed the input, ontology release, hardware, thread count and batch size. Proposed target, to be re-set after a pilot: at least 10,000 records per minute on one core for `rules`.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - none
- **Feeds**:
  - `harmonization.sample_metadata_ontology_mapping`: Sample metadata to ontology term mapping
  - `harmonization.schema_conformance_validation`: Metadata conformance to a community schema
- **Reads**: `uns/geo_records`, `uns/sra_attributes`, `uns/publication_text`
- **Writes**: `uns/geo_sample_metadata`, `uns/geo_extraction_evidence`, `uns/geo_extraction_provenance`, `obs/geo_sample_id`
<!-- CHAINING:AUTO:END -->

Belongs to sample-metadata harmonisation, upstream of ontology mapping and schema conformance.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** MetaSRA's accuracy figures and method details beyond its abstract are not reported. The cell-line and blocking stage bodies (`pipeline_components.py:450` and `:1299` @ e760072) and the use of `query_len_thresh` are not described. The MetaSRA website address differs between the pipeline README and the site's About page, and the bulk download format is not described. The GEOmetadb and ARCHS4 papers are not cited, so both are described from their repositories only. The licences of the ontologies used by MetaSRA (Disease Ontology, EFO, Uberon, Cell Ontology, ChEBI, Unit Ontology, Cellosaurus, SPECIALIST Lexicon) and the processed-data licence of ARCHS4 are not stated.
- **Unsettled literature.** There is no agreed scoring rule for series-inherited versus sample-level evidence. What a cell count measures cannot be recovered from text without a unit and stage rule. Negation scope in short characteristics values is unsettled.
- **Technical and licence risks.** The MetaSRA classifier call sets an L1 penalty without a solver, and the current scikit-learn default solver does not support L1, so the reimplementation must set a solver explicitly. ARCHS4 code carries a non-commercial share-alike licence (§12) and names GRCm38 for mouse, which needs the reconciliation in harmonization.annotation_release_reconciliation. GEO records change after submission, so benchmark snapshots need dates and checksums. Catalogue author annotations may derive from GEO text and then cannot serve as truth.
- **First experiment.** Draw and freeze the B1 stratified sample, write the codebook before any method runs on it, and code the development split blind. No method is tuned until that is done.

## 11. References

R1. Bernstein MN, Doan A, Dewey CN. MetaSRA: normalized human sample-specific metadata for the Sequence Read Archive. *Bioinformatics* 2017;33(18):2914-2923. doi:10.1093/bioinformatics/btx334 — partial (search)
R2. MetaSRA developers. MetaSRA pipeline: source code. GitHub deweylab/metasra-pipeline, commit e760072. — partial (repo)
R3. Gumienny R. GEOparse: Python library to access Gene Expression Omnibus database. GitHub guma44/GEOparse, commit a3cf214. — partial (repo)
R4. Zhu J, Davis S. GEOmetadb: a compilation of metadata from NCBI GEO. R package 1.47.1, GitHub seandavi/GEOmetadb, commit 5d1f379. — partial (repo)
R5. MaayanLab. ARCHS4: processing scripts and documentation. GitHub MaayanLab/archs4, commit f33d213. — partial (repo)
R6. Bray NL, Pimentel H, Melsted P, Pachter L. Near-optimal probabilistic RNA-seq quantification. *Nature Biotechnology* 2016. doi:10.1038/nbt.3519 — verified (corpus)
R7. Hou W, Ji Z. Assessing GPT-4 for cell type annotation in single-cell RNA-seq analysis. *Nature Methods* 2024. doi:10.1038/s41592-024-02235-4 — verified (corpus)
R8. Crowley G, Quake SR, et al. Benchmarking cell type and gene set annotation by large language models with AnnDictionary. *Nature Communications* 2025. doi:10.1038/s41467-025-64511-x — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/guma44/GEOparse | Rafal Gumienny | BSD 3-Clause (LICENSE; setup.py states BSD) | structural split of characteristics fields | port |
| https://github.com/deweylab/metasra-pipeline | MetaSRA developers (LICENSE copyright line); paper authors in [R1] | BSD 3-Clause (LICENSE) | linking design and sample-type classifier; comparator | reimplement design; callout for the pipeline |
| https://github.com/seandavi/GEOmetadb | Jack Zhu and Sean Davis (DESCRIPTION authors; maintainer Jack Zhu) | Artistic-2.0 (DESCRIPTION; no LICENSE file at the root) | GEO metadata index, not an extractor | — |
| https://github.com/MaayanLab/archs4 | MaayanLab (repository owner) | CC BY-NC-SA 4.0 (LICENSE) | uniform reprocessing, not an extractor | — |
