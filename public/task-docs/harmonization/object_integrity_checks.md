---
id: harmonization.object_integrity_checks
title: Matrix and metadata integrity checks
area: harmonization
scope: core
paradigm: hybrid
literature_status: routine
priority: P2
depends_on: [ingest-quant.reference_annotation_build]
feeds: [harmonization.count_matrix_state_detection, harmonization.schema_conformance_validation]
reads: [X or layers/<layer>, obs_names, var_names, obsm/*, varm/*, obs/total_counts, obs/n_genes_by_counts, var/gene_symbols, uns/species]
writes: [uns/integrity/report, obs/integrity_duplicate, var/integrity_duplicate, var/integrity_symbol_flag, obs/integrity_qc_mismatch, uns/integrity/species_call]
devices: [cpu, cuda]
mcp_tool: singlet_harmonization_object_integrity_checks
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Matrix and metadata integrity checks

> Checks that an annotated single-cell object has unique, non-missing indices, a matrix whose shape and row-aligned annotations agree, and stored QC and declared species that match its contents, and reports each failing check with its offending keys.

## 1. Question

Are the observation and feature indices unique and non-missing, do the matrix dimensions and row-aligned annotations agree, and are the stored QC columns and declared species consistent with the matrix and its feature symbols? The input is an AnnData-like object (X, obs, var, obsm, varm, uns); the output is pass, fail, warn or abstain per check, with offending keys listed. A correct answer flags every planted corruption of a class the check covers and nothing in a clean object.

## 2. Why this task matters and where the field stands

Status: **routine** for the structural checks (duplicate names, dimension and length errors), which anndata already enforces in part; **open** for the silent errors that structural checks cannot see.

Structural errors fail loudly and are cheap to detect. anndata reports duplicate names with a UserWarning rather than an error, and reports dimension and length mismatches with ValueError [R1][R4]. The uniqueness check is on by default, but the experimental backed reader turns the construction-time check off unless the annotation index is loaded (section 4), so the suite cannot assume anndata has checked uniqueness for backed objects.

Silent errors are the open problem. A square transposed matrix passes every shape check, and a row permutation of X against obs passes every structural check. Gene-name errors are reported to be widespread in the scientific literature [R2]. No detector or planted-corruption benchmark for silent row misalignment or square transposition is documented in the sources cited here (section 10).

## 3. Theory and insight

Let X have $n$ observations and $p$ features. An index is a sequence of labels $\mathcal{I}_1,\dots,\mathcal{I}_n$, each a string or missing (NA).

**Duplicate count.** $$d(\mathcal{I})=\sum_{i=1}^{n}\mathbb{1}[\mathcal{I}_i\neq\mathrm{NA}]\,\mathbb{1}[\mathcal{I}_i\in\{\mathcal{I}_1,\dots,\mathcal{I}_{i-1}\}]$$ The estimand is the number of non-missing labels that repeat an earlier label; the index passes at $d=0$, and $d/n$ is the repeated fraction. Exact for any $n$. NA entries are excluded, as in anndata's check (section 4).

**Alignment.** $$\mathrm{PASS}_{\mathrm{align}}=\mathbb{1}[\mathrm{shape}(X)=(n,p)]\prod_k\mathbb{1}[r(\mathrm{obsm}_k)=n]\prod_l\mathbb{1}[r(\mathrm{varm}_l)=p]$$ with $r(\cdot)$ the row count. The estimand is a Boolean with no normalisation. The test is exact for any $n$, but a pass does not show that row $i$ of X describes the cell in row $i$ of obs, and a square transposition passes. anndata's per-entry row check sits in the aligned-mapping setter, and its constructor guard is written as a conjunction that fires only when both conditions hold (section 4).

**Name de-duplication.** $$\mathrm{name}(v,j)=v\,\Vert\,\mathrm{join}\,\Vert\,c_j,\qquad c_j=\min\{c>c_{j-1}:v\,\Vert\,\mathrm{join}\,\Vert\,c\notin S\},\qquad c_0=0$$ where $S$ is the set of all names. The estimand is the new label of the $j$-th occurrence of $v$; the first occurrence keeps $v$. The counter is kept per value and never reset. The renaming is exact, but a new name can equal a genuine name, and anndata warns only when such a collision occurs (section 4).

**Stored-QC consistency (proposed).** $$\left|\sum_g x_{ig}-t_i\right|\le\epsilon_{\mathrm{rel}}\max(1,t_i)\quad\forall i$$ The estimand is the per-cell deviation $|\sum_g x_{ig}-t_i|/\max(1,t_i)$ between recomputed and stored totals. It requires X and $t$ to share one layer and feature set. It detects a row permutation only where totals differ between cells; if all totals were equal, the test is blind to it.

**Orientation (proposed).** $P(\text{transposed}\mid s)=\sigma(\mathbf{w}^\top s+b)$, where $s$ holds row and column sum quantiles, zero fractions by row and column, and the count of rows with identical nonzero patterns. The estimand is the probability that the stored matrix is transposed relative to its declared orientation. The summaries are stable only for large $n$ and $p$; the minimum size is set by B1.

**Species vocabulary (heuristic).** $\hat s=\arg\max_s |F\cap V_s|/|F|$, accepted when the margin to the second species exceeds $\delta$. The estimand is the fraction of observed feature symbols found in each species vocabulary, a value in $[0,1]$. It is informative only when $|F|$ is large and vocabularies overlap little.

Complexity: hashing gives $O(n+p)$ for the uniqueness and alignment tests, and the QC and orientation statistics take one $O(\mathrm{nnz})$ traversal of CSR or CSC storage.

**Insight.** Structural invariants are exact and cheap, and they catch the errors that break downstream code. Silent errors need a second witness, and the design question is which witness to add. Content checks are heuristics until they are calibrated on planted labels; a calibrated probability with abstention is the model-based form, and the rule-based form is kept as the comparator.

**Pitfalls.** Two reference behaviours change what a check sees. The uniqueness warning depends on settings. scanpy's read_10x_mtx renames duplicated gene symbols by default [R5] (section 4), and does so silently unless a collision occurs.

## 4. Methods landscape

The published standard is rule-based: anndata's construction and mutation checks, its make_index_unique renaming, and the renaming that scanpy's read_10x_mtx applies by default. Content-level witnesses (QC recomputation, orientation statistics, species vocabulary scores) have no published method in the sources cited here, so section 5 defines them as proposals.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| anndata construction and mutation checks | heuristic | Warns on duplicate observation or variable names; raises on aligned-mapping shape and names-length mismatches | [R1], [R4] |
| AnnData make_index_unique (var_names_make_unique, obs_names_make_unique) | heuristic | Appends join and an increasing integer to each later occurrence, skipping names already present | [R4] |
| scanpy read_10x_mtx gene-symbol renaming | heuristic | Applies make_index_unique to gene symbols when make_unique is true | [R3], [R5] |

The var_names_make_unique and obs_names_make_unique methods are methods of the AnnData object (anndata.py:1600-1610), not scanpy functions.

Defaults of the methods above and of the proposed checks:

| Method | Parameter | Value | Source |
|---|---|---|---|
| anndata construction checks | check_uniqueness | True | src/anndata/_settings.py:13 @ e90df01 |
| anndata uniqueness warning | restrict_index_types | True | src/anndata/_settings.py:34 @ e90df01 |
| anndata uniqueness warning | NA labels | excluded from the test | src/anndata/_core/anndata.py:1612-1622 @ e90df01 |
| anndata constructor dimension guard | obsm and varm row counts | raises only when both conditions hold | src/anndata/_core/anndata.py:1651-1668 @ e90df01 |
| anndata experimental backed reader | check_uniqueness during backed read | False unless the annotation index is loaded | src/anndata/experimental/backed/_io.py:177-181 @ e90df01 |
| anndata aligned mapping | entry shape | ValueError when rows differ | src/anndata/_core/aligned_mapping.py:139-156 @ e90df01 |
| anndata names setter | length | ValueError when length differs | src/anndata/_core/anndata.py:802-803 @ e90df01 |
| make_index_unique | join | "-" | src/anndata/utils.py:291 @ e90df01 |
| make_index_unique | first occurrence | unchanged | src/anndata/utils.py:321 @ e90df01 |
| make_index_unique | warning | only on a name collision | src/anndata/utils.py:335-347 @ e90df01 |
| read_10x_mtx | make_unique | True | src/scanpy/io/_read.py:517 @ 8ed52d9 |
| stored-QC check | qc_rel_tol | 1e-6 | singlet design (proposed) |
| species check | symbol_margin_delta | 0.2 | singlet design (proposed) |
| species and QC checks | mito_prefixes | "MT-", "mt-", matched case-insensitively | singlet design (proposed) |

## 5. Proposed singlet approach

Routes: the structural checks and make_index_unique are **ported** to the C++ core with identical outputs, so that B2 measures parity. The read_10x_mtx renaming is a **callout** comparator only. The stored-QC, orientation and species checks are **reimplemented** from section 3, since no source exists to copy.

Model-based formulation: structural checks stay deterministic. Orientation is a logistic regression over the summary vector $s$, trained on catalogue objects with synthetic transposition labels. Species and symbol validity is a linear model over feature-symbol character n-grams. Temperature scaling on held-out objects calibrates both, and the output is a probability with an abstain state. Falsification: if the calibrated orientation scorer does not meet the B1 transposition criterion on held-out objects, orientation stays rule-based. A learned mode enters the MCP enum only after it meets that criterion.

ML stack: PyTorch trains any MLP. The default scorer is a logistic regression hard-coded in C++ for CPU and in CUDA for batches, because it is a dot product over tens of summary features. Row and column sums, nonzeros per row and column, and zero fractions use cuSPARSE reductions on CUDA and one traversal on CPU.

Storage: backed objects are read in streamed chunks; in-memory objects use one resident matrix.

Defaults an agent uses without asking: duplicate policy report; strict false; orientation_mode shape_then_content; max_examples 5. If no species is declared and uns/species is absent, the species check abstains.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | X or layers/<layer> | sparse or dense numeric | shape, sparsity and content statistics |
| read | obs_names, var_names | string or NA | uniqueness and missing-label checks |
| read | obsm/*, varm/* | array | row-count checks |
| read | obs/total_counts, obs/n_genes_by_counts | numeric | stored QC recomputation, when present |
| read | var/gene_symbols, uns/species | string | feature namespace and declared species |
| write | uns/integrity/report | dictionary | per-check status, flagged count, first max_examples keys |
| write | obs/integrity_duplicate | bool | observation name repeats an earlier name |
| write | var/integrity_duplicate | bool | feature name repeats an earlier name |
| write | var/integrity_symbol_flag | bool | feature symbol fails the vocabulary test |
| write | obs/integrity_qc_mismatch | bool | stored QC disagrees with the recomputed total |
| write | uns/integrity/species_call | dictionary | declared, predicted and margin |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "counts" | — | Layer read for shape, sparsity and QC recomputation; X is used when the layer is absent. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA for the row and column reductions when memory allows. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing anything. |
| `overwrite` | boolean | false | — | Replace existing uns/integrity and integrity flag members instead of failing. |
| `declared_species` | string | — | — | Species of the feature-symbol namespace, for example human or mouse. Falls back to uns/species; the species check abstains when neither is set. |
| `strict` | boolean | false | — | Treat anndata UserWarnings, such as duplicate names, as failures instead of warnings. |
| `max_examples` | integer | 5 | min 1 | Number of offending keys listed per failing check in the report. |
| `make_index_unique` | object | — | — | Options for duplicate observation and feature names. |
| `make_index_unique.policy` | string | "report" | `report`, `make_unique`, `fail` | report lists duplicates; make_unique renames them and lists each renamed key; fail stops the check. |
| `make_index_unique.join` | string | "-" | — | Delimiter between a duplicated name and its integer suffix. |
| `content_checks` | object | — | — | Options for the orientation, stored-QC and species checks. |
| `content_checks.orientation_mode` | string | "shape_then_content" | `shape_only`, `shape_then_content` | shape_only uses dimensions and sparsity; shape_then_content adds row and column statistics. |
| `content_checks.qc_rel_tol` | number | 1e-06 | min 0 | Relative tolerance when recomputing stored per-cell totals from X. |
| `content_checks.symbol_margin_delta` | number | 0.2 | min 0; max 1 | Vocabulary-overlap margin below which the species check abstains. |
| `content_checks.mito_prefixes` | array | ["MT-", "mt-"] | — | Mitochondrial gene prefixes, matched case-insensitively by the species and QC checks. |
<!-- PARAMS:AUTO:END -->

Parameters are top-level except `make_index_unique` and `content_checks`. `make_index_unique.policy` acts only when duplicate names exist, and `make_unique` lists each renamed key with its original name in the report. `orientation_mode` selects the orientation test only; the stored-QC and species checks apply whenever their inputs are present. `declared_species` falls back to `uns/species`. `strict` affects warnings, not shape rules.

## 7. MCP tool

Tool `singlet_harmonization_object_integrity_checks` (definition in `tasks/mcp/singlet_harmonization_object_integrity_checks.json`). It is deterministic, so it has no seed. It is not long running for in-memory objects; backed objects are streamed, and their cost is unmeasured (section 10). A dry run returns the estimated seconds, peak memory and device without writing.

Example call:

```json
{"dataset": "example.singlet", "declared_species": "human", "make_index_unique": {"policy": "report"}}
```

Example result:

```json
{"dataset": "example.singlet", "status": "completed",
 "wrote": ["uns/integrity/report", "obs/integrity_duplicate", "var/integrity_duplicate", "var/integrity_symbol_flag", "obs/integrity_qc_mismatch", "uns/integrity/species_call"],
 "summary": {"checks": {"obs_names_unique": "pass", "var_names_unique": "pass", "dimensions": "pass", "orientation": "pass", "stored_qc": "pass", "species": "pass"}, "n_flagged": 0}}
```

## 8. Benchmarks

Shared protocol. Base objects are catalogue objects that pass every structural check, drawn with fixed seeds. A generator, implemented separately from the detectors, injects each corruption class and writes an injection log (indices, field and class); clean objects are labelled "no corruption". Each class is injected alone at 0.1%, 1% and 10% of rows or fields, with five seeds (proposed). Warnings and failures are scored separately. Thresholds are set on one split of base objects and reported on a held-out split.

### B1. Planted-corruption detection

- **Goal**: Measure whether each check flags each injected class, localises it, and stays silent on clean objects.
- **Ground truth**: Planted simulation. The label is the index set in the injection log; recall is normalised per class over injected instances.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Clean base objects | singlet catalogue (354M cells), passing all structural checks | — | — | Fixed seeds |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-class recall | TP/(TP+FN); detected when the check fails and its offending set meets the injected set | maximise | primary | — |
| Localisation Jaccard | \|F∩T\|/\|F∪T\| for offending set F and injected set T | maximise | primary | — |
| False-alarm rate | fraction of clean base objects with a failure | minimise | guardrail | — |

- **Comparators**: anndata construction-time checks (exceptions and warnings) at e90df01; make_index_unique reporting; a shape-only check.
- **Protocol**: Classes are duplicated observation names, duplicated feature names, observation truncation, X transposed (non-square and square separately), date-like or float-like symbols, species case-convention mix, row permutation of X against obs, and a perturbed stored QC column. Square transposition and row permutation are known misses for `shape_only`.
- **Acceptance criterion** (proposed, not from the literature): structural classes have recall of at least 0.99 and false-alarm rate of at most 0.01; symbol corruption has recall of at least 0.95 at false-alarm rate of at most 0.01, with localisation Jaccard of at least 0.9.
- **Known pitfalls**: A generator sharing a rule with a detector inflates recall. Repository fixtures such as krumsiek11 violate uniqueness and must not be base objects.

### B2. Agreement with anndata native behaviour

- **Goal**: Check that the structural checks agree with anndata's construction-time and mutation-time behaviour on the same corruptions.
- **Ground truth**: Consistency; anndata is the oracle for structural classes only. An outcome is an exception (type and message), a UserWarning (text) or none, reduced to pass or fail per class and object.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| scanpy docstring fixture | scanpy src/scanpy/preprocessing/_simple.py:106-111 @ 8ed52d9 [R5] | toy object; 640 observations after deduplication (docstring) | §12 | Warning path only |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Cohen kappa per class | agreement between singlet and anndata on the binary outcome | maximise | primary | — |
| Disagreement list | objects where outcomes differ, with cause | minimise | guardrail | — |

- **Comparators**: anndata at e90df01; scanpy at 8ed52d9 for read-time renaming.
- **Protocol**: Set check_uniqueness and restrict_index_types explicitly and record warnings past any caller filter. Apply each corruption in memory and after a backed round trip, where the backed reader disables the construction-time check (section 4).
- **Acceptance criterion** (proposed): kappa of at least 0.95 for each structural class; every disagreement traces to a documented anndata behaviour, such as silent acceptance of a square transposition.
- **Known pitfalls**: anndata is not ground truth for symbol or species problems; a disagreement can come from configuration.

### B3. Species-declaration mismatch detection

- **Goal**: Measure how often the species check recovers the true species and abstains on correct declarations.
- **Ground truth**: Planted label. The true species is the source record, and the declared species is the injected field. Accuracy is normalised over non-abstaining objects; abstention over objects with a correct declaration.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue objects with recorded species | singlet catalogue, source record as truth | — | — | Reliable source species only |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Species-call accuracy | share of non-abstaining objects whose predicted species equals the source species | maximise | primary | — |
| Abstention on correct declarations | share of correct declarations whose margin does not exceed delta | minimise | guardrail | — |

- **Comparators**: symbol-case rule alone; mitochondrial-prefix rule alone; vocabulary overlap with the margin (section 5).
- **Protocol**: Declare a wrong species for a subset, mimic other namespaces by converting symbol case, sweep delta and report the accuracy-abstention curve. Vocabularies come from the reference build (ingest-quant.reference_annotation_build).
- **Acceptance criterion** (proposed): accuracy of at least 0.99 on objects with at least 80% of symbols matched to the declared vocabulary, and abstention of at most 0.02 on correct declarations.
- **Known pitfalls**: Symbols shared across species and ortholog-only names weaken the evidence. Ensembl identifiers carry no case signal.

### P1. Performance and scaling

Wall time and peak memory of the full suite on in-memory CSR and CSC objects and on backed h5ad and zarr objects, at $10^4$, $10^5$, $10^6$ and $10^7$ cells (decade spacing; proposed grid). Hold fixed: 3e4 features, 2e3 nonzeros per cell, float32 counts, duplicate fraction 0 and 0.01, thread count and hardware. Report warm and cold cache separately. Comparators: anndata construction-time checks; anndata var_names_make_unique and obs_names_make_unique, timed separately because the duplicate loop is Python-level (section 4); the C++ CPU backend; the CUDA backend for QC and orientation statistics. Target (proposed): the suite adds at most one full traversal of the matrix to load time. The grid is a design parameter, not a dataset size.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.reference_annotation_build`: Reference genome and annotation preparation for single-cell counting (including custom host-plus-pathogen and transgene references)
- **Feeds**:
  - `harmonization.count_matrix_state_detection`: Count-matrix processing-state detection
  - `harmonization.schema_conformance_validation`: Metadata conformance to a community schema
- **Reads**: `X or layers/<layer>`, `obs_names`, `var_names`, `obsm/*`, `varm/*`, `obs/total_counts`, `obs/n_genes_by_counts`, `var/gene_symbols`, `uns/species`
- **Writes**: `uns/integrity/report`, `obs/integrity_duplicate`, `var/integrity_duplicate`, `var/integrity_symbol_flag`, `obs/integrity_qc_mismatch`, `uns/integrity/species_call`
<!-- CHAINING:AUTO:END -->

Used as the first gate on any newly built or imported object, before count-state detection and schema conformance.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The corpus copies carry no git metadata, so the commit labels (sections 4 and 8) are remote HEAD values at check time and were not matched to the copies. The CELLxGENE validator's integrity checks were not read and are not a comparator here; schema conformance is covered by harmonization.schema_conformance_validation. Ziemann et al. is cited through its title and bibliographic record only. The licence and terms of the catalogue subset are not stated, so B1 and B3 cannot be published until they are.
- **Unsettled literature.** No published detector or planted-corruption benchmark for silent row misalignment or square transposition was located. The content checks and all their thresholds are proposals until B1 is carried out.
- **Technical risks.** The cost of backed objects, and of the duplicate loop on heavily duplicated labels, is unmeasured (P1). Because the backed reader turns off the construction-time uniqueness check, the suite must test uniqueness itself for backed objects.
- **First experiment.** Build the B1 generator with injection logs at the 1% level and measure per-class recall for square transposition and row permutation under both orientation modes. That result decides whether the learned orientation scorer in section 5 is worth training.

## 11. References

R1. Virshup I, Rybakov S, Theis FJ, Angerer P, Wolf FA. anndata: Access and store annotated data matrices. *Journal of Open Source Software* 2024. doi:10.21105/joss.04371 — verified (corpus)

R2. Ziemann M, Eren Y, El-Osta A. Gene name errors are widespread in the scientific literature. *Genome Biology* 2016. doi:10.1186/s13059-016-1044-7 — partial (search)

R3. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)

R4. scverse. anndata, software repository. https://github.com/scverse/anndata — partial (repo)

R5. scverse. scanpy, software repository. https://github.com/scverse/scanpy — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/anndata | maintainers Philipp Angerer and Ilan Gold; authors as listed in pyproject.toml | BSD-3-Clause (LICENSE file; pyproject.toml) | structural checks and make_index_unique | port |
| https://github.com/scverse/scanpy | maintainers Ilan Gold, Philipp Angerer and Severin Dicks; authors as listed in pyproject.toml | BSD 3-Clause (LICENSE file; pyproject.toml) | read_10x_mtx renaming and docstring fixture | callout |
| singlet content checks | singlet | — | stored-QC, orientation and species checks | reimplement |
