---
id: ingest-quant.spliced_unspliced_counting
title: Spliced, unspliced and ambiguous molecule counting
area: ingest-quant
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.reference_annotation_build, ingest-quant.read_to_gene_mapping, ingest-quant.umi_deduplication]
feeds: [velocity.gene_kinetics_velocity_estimation, velocity.latent_time_inference, qc.single_nucleus_quality_filtering]
reads: [uns/ref_build, uns/t2g, uns/ec_incidence]
writes: [layers/spliced, layers/unspliced, layers/ambiguous, uns/spliced_unspliced_provenance]
devices: [cpu]
mcp_tool: singlet_ingest_quant_spliced_unspliced_counting
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Spliced, unspliced and ambiguous molecule counting

> Assign each deduplicated molecule of a single-cell or single-nucleus library to the spliced, unspliced or ambiguous state of its gene, and report per-gene, per-cell counts that splicing-state models can consume.

## 1. Question

For each gene and cell, how many deduplicated molecules derive from spliced (mature, exonic) RNA, how many from unspliced (intron-containing) RNA, and how many are compatible with both states? Outputs are cell-by-gene matrices S, U and A in molecule units; a correct answer assigns each molecule to the state that produced it, or to the ambiguous class when its reads cannot separate the states.

## 2. Why this task matters and where the field stands

**Status: contested.** Splicing-state counts are the observations that RNA velocity and related kinetic models fit [R1, R3, R6]. The counting rule decides which reads count as unspliced, so it sets the kinetic signal before any model is fitted. Intronic reads can be pre-mRNA, retained introns or antisense transcripts [R16]. The open problems are:

- **Rules versus probability.** Rule-based counters and EM over equivalence classes allocate multi-compatible reads differently [R9], and the cited comparisons do not settle which allocation is right.
- **Consistency is not accuracy.** Tool choice and preprocessing change velocity results [R13], and counters can agree because they share biases [R13, R14].
- **Compartment and protocol.** Nuclei carry more intronic signal than whole cells, so the unspliced fraction also reflects the compartment. Whether intronic reads belong in whole-cell totals is contested [R16].
- **Length bias.** Length biases in pre-mRNA sequencing have been reported [R17].

## 3. Theory and insight

The unit is the molecule, a UMI-collapsed group of reads from one cell. Each molecule $m$ carries a compatibility set of (gene, state) pairs with state in $\{S, U\}$; if its compatible states span both, the molecule is ambiguous. For gene $g$ and cell $c$ the counters output non-negative counts $S_{gc}$, $U_{gc}$ and $A_{gc}$ of molecules assigned to each state, unnormalised: integers for rule-based methods, expected counts for EM methods. A molecule enters at most one of the three for one gene. Molecules compatible with several genes follow the method's multi-gene rule (section 4).

The model that motivates the split is first-order linear kinetics for unspliced abundance $u_g$ and spliced abundance $s_g$ [R1, R3]:

$$\frac{du_g}{dt}=\alpha_g-\beta_g u_g,\qquad \frac{ds_g}{dt}=\beta_g u_g-\gamma_g s_g$$

with transcription rate $\alpha_g$, splicing rate $\beta_g$ and degradation rate $\gamma_g$. This holds for constant rates over the observed window, with genes modelled independently. Setting both derivatives to zero gives the steady state that the steady-state velocity model fits:

$$u^\ast_g=\frac{\alpha_g}{\beta_g},\qquad s^\ast_g=\frac{\alpha_g}{\gamma_g},\qquad \frac{u^\ast_g}{s^\ast_g}=\frac{\gamma_g}{\beta_g}$$

This relation needs equilibrium, $t\gg 1/\beta_g$ and $t\gg 1/\gamma_g$, and fails when equilibria are not reached. Velocity is $v_g=\dot s_g=\beta_g u_g-\gamma_g s_g$, so a miscount of $u_g$ or $s_g$ enters $v_g$ directly. Counting does not model kinetics; it supplies the $u$ and $s$ that the kinetic models take as given [R3, R6]. Coupled pre-mRNA and mRNA kinetics were modelled before velocity [R2].

Assignment is a mixture problem. Let $n_e$ be the number of molecules in equivalence class $e$ (molecules with the same compatibility set), $C_e$ the (gene, state) pairs compatible with $e$, and $\theta_k$ the proportion of pair $k$ within one cell, with $\sum_k\theta_k=1$. The log-likelihood of a per-cell mixture of multinomials is

$$\mathcal{L}(\theta)=\sum_e n_e\log\Big(\sum_{k\in C_e}\theta_k\,p(e\mid k)\Big),$$

where $p(e\mid k)$ is the probability that a molecule from pair $k$ falls in class $e$, taken as known from the alignment model. The EM iteration is

$$\theta_k^{(t+1)}=\frac{1}{N}\sum_{e:\,k\in C_e} n_e\,\frac{\theta_k^{(t)}\,p(e\mid k)}{\sum_{k'\in C_e}\theta_{k'}^{(t)}\,p(e\mid k')},\qquad N=\sum_e n_e.$$

When $p(e\mid k)$ takes the same value for every $k\in C_e$, as under the uniform weighting $1/|C_e|$, the factor cancels and the update is $\theta_k^{(t+1)}=\frac{1}{N}\sum_{e:\,k\in C_e} n_e\,\theta_k^{(t)}/\sum_{k'\in C_e}\theta_{k'}^{(t)}$. This is singlet's derivation of the mixture; alevin-fry's weighting is a separate question (section 10). EM reaches a local maximum and assumes that ambiguity is resolvable from compatibility alone. Any prior over states, such as neighbour smoothing, changes the output and must be reported.

Three assumptions carry the split. One UMI is one molecule, which fails when unspliced molecules have several priming sites. The annotation gives correct exon and intron structure, so compatibility is meaningful. Intronic reads represent pre-mRNA, which fails for antisense reads and retained introns [R16].

Failure modes follow the method family. The velocyto rule counts intron-only reads as unspliced, so retained introns and unannotated mature isoforms inflate $U$; it also discards multi-gene reads, while the alevin-fry EM mode resolves them, so totals differ in overlapping genes. STARsolo does not mark alignments as intronic when the intron exceeds a fixed cap (section 4). Divergent UMI collisions concentrate among intronic reads [R16], and constant-rate assumptions fail in erythroid maturation [R5]. Velocity estimates can mislead when projected or when assumptions fail [R18]. Single-cell analysis artefacts can be mistaken for biological signal [R14], and velocity results depend on preprocessing [R13].

Rule-based counters encode the read geometry exactly, so they are auditable and cheap, but they give no confidence for an individual molecule. A mixture posterior supplies that confidence and a gene-level ambiguity estimate, and the rule-based counters remain comparators. The model changes the counts, not the kinetic model.

Estimands. Each layer entry $S_{gc}$, $U_{gc}$ or $A_{gc}$ is an unnormalised molecule count for one gene and cell. The summary reports the per-cell intronic fraction $\sum_g U_{gc}/\sum_g (S_{gc}+U_{gc})$, which excludes ambiguous molecules and is undefined when the denominator is zero. It is UMI based and differs from the read-based nuclear fraction $\mathrm{NF}_c=\sum_g I_{gc}/\sum_g (I_{gc}+E_{gc})$ used for droplet QC [R15], so the two must not be compared directly. The benchmark ground truth is the planted state of each molecule, with per-gene, per-cell planted $S$ and $U$ counts (section 8).

Regime of validity: the molecule model needs one priming site per molecule; the EM is per cell with $p(e\mid k)$ fixed; the steady-state relation needs equilibrium.

| Symbol | Meaning |
|---|---|
| $u_g$, $s_g$ | unspliced and spliced abundance of gene $g$ |
| $\alpha_g$, $\beta_g$, $\gamma_g$ | transcription, splicing and degradation rates |
| $C_e$, $n_e$ | (gene, state) pairs compatible with class $e$; molecules in $e$ |
| $\theta_k$ | proportion of pair $k$ in one cell |
| $S_{gc}$, $U_{gc}$, $A_{gc}$ | molecule counts assigned to spliced, unspliced and ambiguous |

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| velocyto Permissive10X | heuristic | each read's overlap with exons and introns classifies its molecule; intron-only and spanning reads are unspliced; multi-gene reads are not counted | [R1] |
| kb-python lamanno | heuristic | cDNA and intron targets indexed separately; spliced and unspliced records split by target set | [R7], [R8] |
| kb-python nac | heuristic | nascent (intron) target list with a flank; mature, nascent and ambiguous matrices | [R7] |
| alevin-fry USA cr-like | heuristic | gene-level resolution of UMI equivalence classes that mirrors Cell Ranger logic without the 1-edit-distance UMI collapse, against a splici reference | [R9], [R10] |
| alevin-fry USA cr-like-em | hybrid | equal-compatibility classes resolved by EM; a splicing-ambiguity model then assigns states | [R9] |
| STARsolo Velocyto | heuristic | velocyto-style classifier inside STAR's alignment step, with an overlap test and an intron span cap | [R11], [R12] |
| Cell Ranger include-introns | heuristic | intronic reads added to one gene total; used as a total-only comparator | [R16] |

The velocyto rule [R1] is the published standard, as the counting rule that accompanied RNA velocity. The kb, alevin-fry and STARsolo methods are alternatives that differ in mapper and in how compatible reads are allocated. Singlet ports the six counters in the MCP enum (section 5); Cell Ranger is a comparator only.

Exact defaults of the methods above:

| Method | Parameter | Value | Source |
|---|---|---|---|
| velocyto | logic | Permissive10X, the default | velocyto/logic.py:1145; velocyto/commands/run10x.py:47-49 @ 56efe89 |
| velocyto | MIN_FLANK | 5 | velocyto/constants.py:5 @ 56efe89 |
| velocyto | intron-only reads | counted as unspliced | velocyto/logic.py ~168-186 @ 56efe89 |
| velocyto | multi-gene compatible reads | not counted | velocyto/logic.py, multi-gene branch @ 56efe89 |
| kb-python | workflows | lamanno and nac; nucleus uses the same reference path | kb_python/main.py:269, 291, 653 @ 188d9c7 |
| kb-python | BUS prefixes | spliced from the cDNA index, unspliced from the intron index, with a prefix-to-target swap | kb_python/count.py:2632-2633, 2715-2722 @ 188d9c7 |
| kb-python | intron flank | k-1 when k is given, otherwise 30 | kb_python/ref.py:983-985 @ 188d9c7 |
| kb-python | nac outputs | mature, nascent and ambiguous matrices | kb_python/count.py:500-501, 528-547 @ 188d9c7 |
| alevin-fry | --sa-model | winner-take-all; alternative prefer-ambig | src/main.rs:316-319; src/quant.rs:64-68 @ ad05742 |
| alevin-fry | USA resolutions | cr-like and cr-like-em; trivial not available in USA mode | docs/source/quant.rst:12, 26; src/quant.rs:1085 @ ad05742 |
| alevin-fry | USA output | 3G columns | docs/source/quant.rst:51 @ ad05742 |
| alevin-fry | USA EM state | three times the gene count; 78,899 genes give 236,697 alpha values | src/em.rs:347 @ ad05742 |
| STARsolo | Velocyto feature | off unless requested; requires the Gene feature | docs/STARsolo.md:228-233; source/SoloFeatureTypes.h:8 @ b1edc12 |
| STARsolo | intron span cap | 1,000,000 bases, hard-coded | source/Transcriptome_classifyAlign.cpp:141 @ b1edc12 |
| STARsolo | overlap test | 6 bases (velocyto MIN_FLANK plus 1) | source/Transcriptome_classifyAlign.cpp:229 @ b1edc12 |
| Cell Ranger | include-introns | true, recommended to maximise sensitivity | lib/rust/cr_wrap/src/bin/parameter-descriptions.txt:54-57 @ 669395e |

## 5. Proposed singlet approach

Each counter is ported from its published rule, so no upstream program is a runtime dependency; the licence class of each source is in section 12. Port means reimplementation in the C++ core from permissively licensed code. The alevin-fry cr-like-em splicing-ambiguity model is ported only after its semantics are traced in source (section 10). Upstream programs are benchmark comparators.

An agent should default to `alevin_fry_usa_cr_like` on CPU with all cores, and to the STARsolo and velocyto constants of section 4 when those methods are chosen. This default is proposed because it gives three state outputs per gene and follows Cell Ranger's resolution logic, so its totals are comparable with that pipeline. It is replaced only if B1 shows another counter with lower misassignment on the baseline regime.

The model-based variant treats each molecule's state as a latent variable in {S, U, A}, with a per-gene prior and the likelihood of section 3. It is fitted per cell by EM and outputs posterior-weighted S and U counts with a per-gene-cell posterior variance. A neighbour-smoothed prior is an option and is reported when used. It is accepted only if B1 meets its misassignment threshold and its posterior intervals reach nominal coverage on the same simulation (proposed: within 2 percentage points); otherwise it is dropped. Until then it is not in the MCP enum, because its source is this document rather than a published method.

The EM is a sparse, memory-bound loop over classes and (gene, state) pairs, the same structure as alevin-fry's EM. Because it is small and hot, it is a candidate for hard-coded CUDA with cuSPARSE. PyTorch is considered only for a learned read-compatibility model that B1 justifies. CPU kernels are the interval-overlap test for the rule ports and the per-cell EM. The EM operates per cell, so batches of cells bound memory. The alevin-fry USA state size sets a floor that does not depend on cell number (section 4). A conservation check, that S+U+A equals the non-split total for each gene and cell within a floating-point tolerance, applies only where a counter states that identity (section 10).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/ref_build | dict | release, flank and intron-augmentation settings of the reference |
| read | uns/t2g | table | transcript or target, its gene, and a spliced or unspliced label per target |
| read | uns/ec_incidence | sparse bool | class-by-target incidence and class counts $n_e$ per cell |
| write | layers/spliced | sparse float32 | cell-by-gene spliced molecule counts; unnormalised |
| write | layers/unspliced | sparse float32 | cell-by-gene unspliced molecule counts; unnormalised |
| write | layers/ambiguous | sparse float32 | cell-by-gene ambiguous counts; written only when the method emits that class |
| write | uns/spliced_unspliced_provenance | dict | method, counter version and commit, reference checksum, sa model, thresholds |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI, or a workspace handle; it must hold the outputs of the feeding tasks. |
| `method` | string | "alevin_fry_usa_cr_like" | `velocyto_permissive10x`, `kb_lamanno`, `kb_nac`, `alevin_fry_usa_cr_like`, `alevin_fry_usa_cr_like_em`, `starsolo_velocyto` | Counting logic, ported from the named published counter. Default alevin_fry_usa_cr_like is the proposed standard. |
| `device` | string | "cpu" | `cpu` | All counters run on CPU; this tool exposes no CUDA path. |
| `threads` | integer | — | min 1 | CPU threads for read and molecule processing; omit to use all available cores. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing. |
| `overwrite` | boolean | false | — | Replace existing spliced, unspliced and ambiguous layers instead of failing. |
| `alevin_fry` | object | — | — | Options for the alevin_fry_usa methods. |
| `alevin_fry.sa_model` | string | "winner-take-all" | `winner-take-all`, `prefer-ambig` | Splicing-ambiguity model; applies only to alevin_fry_usa_cr_like_em. |
| `starsolo` | object | — | — | Options for starsolo_velocyto. |
| `starsolo.max_intron_span` | integer | 1000000 | min 1 | Introns longer than this do not mark an alignment intronic. |
| `starsolo.min_overlap` | integer | 6 | min 0 | Bases an alignment must overlap an exon or intron to be classified. |
| `velocyto` | object | — | — | Options for velocyto_permissive10x. |
| `velocyto.min_flank` | integer | 5 | min 0 | Bases a read must overlap an exon or intron to be classified. |
<!-- PARAMS:AUTO:END -->

Each method needs a compatible mapper from ingest-quant.read_to_gene_mapping: `alevin_fry_*` methods need the `alevin_fry` mapper with a splici reference, `kb_*` methods need `kb_kallisto_bustools` with its intron index, and `starsolo_velocyto` needs `starsolo` alignments. `velocyto_permissive10x` reads alignments as files. `alevin_fry.sa_model` applies only to `alevin_fry_usa_cr_like_em`, and the `starsolo` and `velocyto` options only to their methods; other combinations are errors. A reference without intron targets is refused, because unspliced counts would be zero by construction. `threads` applies to all methods.

## 7. MCP tool

Tool name `singlet_ingest_quant_spliced_unspliced_counting` (definition in `tasks/mcp/singlet_ingest_quant_spliced_unspliced_counting.json`). Example call and result:

```json
{"dataset": "lib1.singlet", "method": "alevin_fry_usa_cr_like", "threads": 16}
```

```json
{"dataset": "lib1.singlet", "status": "completed",
 "wrote": ["layers/spliced", "layers/unspliced", "layers/ambiguous", "uns/spliced_unspliced_provenance"],
 "summary": {"method": "alevin_fry_usa_cr_like", "reference_release": "<string>", "n_cells": "<int>", "n_features": "<int>", "spliced_molecules": "<float>", "unspliced_molecules": "<float>", "ambiguous_molecules": "<float>", "intronic_fraction_median": "<float>"},
 "provenance_id": "<id>"}
```

- **Long-running:** yes; atlas-scale inputs return `status` queued with a `job_id`.
- **Stochastic:** no; the EM starts from uniform proportions, so repeated calls return the same assignments.
- **Dry run:** returns the estimated seconds, peak memory in GB and device (`cpu`) from the incidence size and thread count, without writing.

## 8. Benchmarks

Shared protocol. Each evaluation uses one reference built by ingest-quant.reference_annotation_build in the splici design, with flank equal to read length minus one, so every counter sees the same targets. Every counter receives the same reads, reference and collapse rule, through the mapper that method needs. Metrics are computed over molecules, or per gene and cell, in molecule units. Simulated evaluations use three seeds, reported as mean and range. Thresholds marked proposed are design choices, not literature values.

### B1. Planted-truth simulation of spliced and unspliced molecules (proposed)

- **Goal:** measure how often each counter's state matches the planted state, per gene and cell.
- **Ground truth:** planted simulation; each molecule has one planted S or U state, and A is never a truth state. Estimand: planted S and U molecule counts per gene and cell, unnormalised.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated 3' library over one genome and annotation release | recipe below | scRNA-seq; species from the genome FASTA | — | four regimes (intron-heavy, exon-heavy, overlapping, long introns) |

Generator recipe:
1. Define exonic, intronic and overlapping intervals from the annotation.
2. Draw rates $\alpha_g$, $\beta_g$ and $\gamma_g$ per gene from a table fitted to one real library.
3. Draw spliced and unspliced counts per gene and cell from negative binomials with the section 3 steady-state means.
4. Generate reads per molecule, with a fixed intronic fragment model.
5. Apply fixed error models; repeat for seeds 1 to 3 and each regime.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| misassignment_rate | among counted mass on S or U, the fraction in the wrong state | lower | primary | — |
| ambiguous_mass | fraction of planted S or U mass assigned to A | lower | primary | — |
| gene_cell_abs_error | per gene and cell, summed absolute S and U error; median and 90th percentile | lower | guardrail | — |
| unspliced_fraction_r | Pearson correlation over gene-cells with at least 10 molecules, against planted U/(S+U) | higher | guardrail | — |

- **Comparators:** the six MCP counters and section 4's upstream programs.
- **Protocol:** identical reads and reference; two read models (the recipe and a second simulator); scores pooled per regime.
- **Acceptance criterion:** proposed, not from the literature: misassignment rate at most 0.02 for the default on the baseline regime, in all seeds; ambiguous mass reported only.
- **Known pitfalls:** a read model matching one counter's rule favours it; clean intronic fragments flatter all counters.

### B2. Lineage-direction diagnostic on pancreatic endocrinogenesis (extended)

- **Goal:** test whether velocity-level conclusions from each counter agree with a known lineage direction, and whether they survive counting perturbations.
- **Ground truth:** expert biology. The label is the known direction of each pre-specified progenitor-to-endocrine cell-type pair, taken from the dataset annotation and fixed before scoring. The estimand is the fraction of pairs whose predicted direction matches.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pancreatic endocrinogenesis scRNA-seq | [R21]; accession — | scRNA-seq; —; — | — | one reference shared by all counters |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| lineage_direction_agreement | fraction of the pre-specified pairs whose scVelo-predicted direction matches the known one | higher | primary | — |
| cross_counter_velocity_cosine | median over cells of the cosine between singlet's velocity vector and the reference counter's vector in a shared embedding | higher | guardrail | — |

- **Comparators:** alevin-fry USA cr-like with scVelo; kb nac with scVelo; velocyto with scVelo (upstream programs).
- **Protocol:** each counter's output enters scVelo steady-state and dynamical models with identical filters. Perturbations are cell subsampling, a change of annotation release and a change of intron flank in the reference build. Per-gene fit quality is reported with the summary.
- **Acceptance criterion:** proposed, not from the literature: median cosine at least 0.80 between singlet and the reference counter. Direction agreement is reported without a fixed threshold.
- **Known pitfalls:** direction agreement mixes count error with scVelo model misfit, in particular the constant-rate assumption [R4, R5]; one dataset is not evidence of general performance.

### P1. Performance and scaling

Wall time, peak resident memory and throughput in molecules per second for each counter in the MCP enum, on CPU, at 10k, 100k, 1M and 10M cells, against the upstream programs of section 4 on the same reads. Hold fixed the reference, reads per cell, thread count, memory cap, storage and cache state. The 10M tier applies because streaming is claimed. Acceptance (proposed, not from the literature): at 100k cells the default method completes within twice the time of the fastest upstream program on the same hardware, or the gap is reported with its cause.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.reference_annotation_build`: Reference genome and annotation preparation for single-cell counting (including custom host-plus-pathogen and transgene references)
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
- **Feeds**:
  - `velocity.gene_kinetics_velocity_estimation`: Per-gene kinetics and RNA velocity estimation from spliced and unspliced counts
  - `velocity.latent_time_inference`: Latent time and temporal ordering from splicing dynamics
  - `qc.single_nucleus_quality_filtering`: Nucleus-aware quality filtering for single-nucleus RNA-seq
- **Reads**: `uns/ref_build`, `uns/t2g`, `uns/ec_incidence`
- **Writes**: `layers/spliced`, `layers/unspliced`, `layers/ambiguous`, `uns/spliced_unspliced_provenance`
<!-- CHAINING:AUTO:END -->

This task is the splicing-state step after reference build, read mapping and UMI deduplication, and before kinetic fitting and velocity estimation.

## 10. Risks, pitfalls and open questions

- **Evidence basis.** Soneson et al. [R13] is cited from its record and abstract, not the full text, so its benchmark design is not reused here. Its abstract reports that spliced and unspliced estimates disagree across quantification tools and change velocity results. The length-bias claim [R17] rests on its title.
- **Folded benchmarks.** Metabolic labelling as truth for new RNA [R19] and the nucleus-versus-cell intronic contrast in the design of Ding et al. [R20] are not benchmarks here: no dataset identity or accession is established, and the T>C conversion chemistry is unverified. The nuclear enrichment of intronic reads rests on a secondary source. Cross-quantifier concordance is folded for the same reason.
- **Tool-level unknowns.** kb lamanno's ambiguous output was not traced, so `layers/ambiguous` may be absent for that method. The alevin-fry splicing-ambiguity semantics are inferred from option names, defaults and the changelog. Cell Ranger reports one gene total under include-introns, so it is a total-only comparator. No cited source states the conservation identity for any counter, so that check stays a build test. The alevin-fry `--sa-model` option is hidden from its CLI help (see the section 4 defaults).
- **Reference and member gaps.** The counters need a spliced or unspliced label per target, which `uns/t2g` must carry, but the reference build does not list one. The mapping task writes `obs/frac_intronic_reads` from a second quantification with ambiguous molecules in the denominator, which overlaps this task and differs from the summary fraction of section 3; the two should share one definition and one owner. The velocyto and STARsolo ports need alignments, which are passed as files rather than members.
- **Technical risks.** STARsolo's intron span cap and overlap test are hard-coded in the callout program, so the port exposes them (section 6) and parity holds only with matching values. Upstream velocyto is unmaintained, as its README states. Alevin-fry memory scales with three times the gene count, so the reference, not only the cell count, sets peak memory.
- **First experiment.** Evaluate B1 at the baseline regime, comparing `alevin_fry_usa_cr_like` with `velocyto_permissive10x` and `starsolo_velocyto` on identical planted molecules, and apply the 0.02 misassignment threshold before any model-based variant is built. Resolve the label gap in the previous bullet first, because B1 cannot score the counters without it.

## 11. References

R1. La Manno G, Soldatov R, Zeisel A, et al. RNA velocity of single cells. *Nature* 2018. doi:10.1038/s41586-018-0414-6 — verified (corpus)
R2. Zeisel A, Köstler WJ, Molotski N, et al. Coupled pre-mRNA and mRNA dynamics unveil operational strategies underlying transcriptional responses to stimuli. *Molecular Systems Biology* 2011. doi:10.1038/msb.2011.62 — verified (corpus)
R3. Bergen V, Lange M, Peidli S, Wolf FA, Theis FJ. Generalizing RNA velocity to transient cell states through dynamical modeling. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0591-3 — verified (corpus)
R4. Bergen V, Soldatov RA, Kharchenko PV, Theis FJ. RNA velocity: current challenges and future perspectives. *Molecular Systems Biology* 2021. doi:10.15252/msb.202110282 — verified (corpus)
R5. Barile M, Imaz-Rosshandler I, Inzani I, Ghazanfar S, et al. Coordinated changes in gene expression kinetics underlie both mouse and human erythroid maturation. *Genome Biology* 2021. doi:10.1186/s13059-021-02414-y — verified (corpus)
R6. Gayoso A, Weiler P, Lotfollahi M, et al. Deep generative modeling of transcriptional dynamics for RNA velocity analysis in single cells. *Nature Methods* 2024. doi:10.1038/s41592-023-01994-w — verified (corpus)
R7. Melsted P, Booeshaghi AS, Liu L, et al. Modular, efficient and constant-memory single-cell RNA-seq preprocessing. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00870-2 — verified (corpus)
R8. Bray NL, Pimentel H, Melsted P, Pachter L. Near-optimal probabilistic RNA-seq quantification. *Nature Biotechnology* 2016. doi:10.1038/nbt.3519 — verified (corpus)
R9. He D, Zakeri M, Sarkar H, Soneson C, Srivastava A, Patro R. Alevin-fry unlocks rapid, accurate and memory-frugal quantification of single-cell RNA-seq data. *Nature Methods* 2022. doi:10.1038/s41592-022-01408-3 — verified (corpus)
R10. Srivastava A, Malik L, Smith T, Sudbery I, Patro R. Alevin efficiently estimates accurate gene abundances from dscRNA-seq data. *Genome Biology* 2019. doi:10.1186/s13059-019-1670-y — verified (corpus)
R11. Kaminow B, Yunusov D, Dobin A. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021 (preprint). doi:10.1101/2021.05.05.442755 — verified (corpus)
R12. Dobin A, Davis CA, Schlesinger F, et al. STAR: ultrafast universal RNA-seq aligner. *Bioinformatics* 2013. doi:10.1093/bioinformatics/bts635 — verified (corpus)
R13. Soneson C, Srivastava A, Patro R, Stadler MB. Preprocessing choices affect RNA velocity results for droplet scRNA-seq data. *PLoS Computational Biology* 2021;17(1):e1008585. doi:10.1371/journal.pcbi.1008585 — verified (search)
R14. Chari T, Pachter L. The specious art of single-cell genomics. *PLoS Computational Biology* 2023. doi:10.1371/journal.pcbi.1011288 — verified (corpus)
R15. Muskovic W, Powell JE. DropletQC: improved identification of empty droplets and damaged cells in single-cell RNA-seq data. *Genome Biology* 2021. doi:10.1186/s13059-021-02547-0 — verified (corpus)
R16. 10x Genomics. Technical Note: Interpreting intronic and antisense reads in 10x Genomics Single Cell Gene Expression data. 2021. https://www.10xgenomics.com/support/single-cell-gene-expression/documentation/steps/sequencing/interpreting-intronic-and-antisense-reads-in-10-x-genomics-single-cell-gene-expression-data — verified (corpus)
R17. Gorin G, Pachter L. Length biases in single-cell RNA sequencing of pre-mRNA. *bioRxiv* 2021 (preprint). doi:10.1101/2021.07.30.454514 — verified (corpus)
R18. Zheng SC, Stein-O'Brien G, Boukas L, Goff LA, Hansen KD. Pumping the brakes on RNA velocity: understanding and interpreting RNA velocity estimates. *bioRxiv* 2022. doi:10.1101/2022.06.19.494717 — verified (corpus)
R19. Erhard F, Baptista MAP, Krammer T, et al. scSLAM-seq reveals core features of transcription dynamics in single cells. *Nature* 2019. doi:10.1038/s41586-019-1369-y — verified (corpus)
R20. Ding J, Adiconis X, Simmons SK, et al. Systematic comparison of single-cell and single-nucleus RNA-sequencing methods. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0465-8 — verified (corpus)
R21. Bastidas-Ponce A, Tritschler S, Dony L, et al. Massive single-cell mRNA profiling reveals a detailed roadmap for pancreatic endocrinogenesis. *Development* 2019. doi:10.1242/dev.173849 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/velocyto-team/velocyto.py | Linnarsson Lab (setup.py author); copyright Kharchenko, Linnarsson and La Manno (LICENSE) | BSD 2-Clause (LICENSE; setup.py) | Permissive10X rule; upstream no longer maintained per its README (revision 56efe89) | port (rule); upstream as comparator |
| https://github.com/pachterlab/kb_python | Kyung Hoi (Joseph) Min and A. Sina Booeshaghi (README) | BSD 2-Clause (copyright 2019 Pachter Lab) | lamanno and nac target split and BUS prefixes (revision 188d9c7) | port |
| https://github.com/alexdobin/STAR | Alexander Dobin | MIT (copyright 2019 Alexander Dobin) | Velocyto classifier rule; the Velocyto option is documented in its STARsolo guide (revision b1edc12) | port (rule); callout for the upstream feature |
| https://github.com/COMBINE-lab/alevin-fry | University of Maryland (copyright holder in LICENSE) | BSD 3-Clause (copyright 2020- University of Maryland) | USA cr-like and cr-like-em resolution (revision ad05742) | port; cr-like-em after source trace |
| https://github.com/10XGenomics/cellranger | 10x Genomics (copyright holder in LICENSE) | Custom 10x Genomics licence (copyright 2026): internal use with 10x products; not an OSI licence | include-introns total comparator (revision 669395e) | callout (comparator only) |
| https://github.com/powellgenomicslab/DropletQC | Walter Muskovic (maintainer per DESCRIPTION) | MIT (LICENSE file) | nuclear-fraction definition (revision 5d7dadc) | callout (definition only) |
| https://github.com/theislab/scvelo | Theis Lab (copyright holder in LICENSE) | BSD 3-Clause | consumer of the spliced and unspliced layers | callout (consumer) |
| https://github.com/scverse/scvi-tools | Yosef Lab, Weizmann Institute of Science (copyright holder in LICENSE) | BSD 3-Clause | velovi consumer of the spliced and unspliced layers | callout (consumer) |
