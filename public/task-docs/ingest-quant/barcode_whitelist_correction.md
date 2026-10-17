---
id: ingest-quant.barcode_whitelist_correction
title: Cell barcode correction (whitelist-based or inferred barcode set)
area: ingest-quant
scope: core
paradigm: heuristic
literature_status: contested
priority: P1
depends_on: [ingest-quant.barcode_umi_extraction, ingest-quant.chemistry_detection]
feeds: [ingest-quant.read_to_gene_mapping, ingest-quant.umi_deduplication, cell-calling.cell_vs_empty_droplet_calling]
reads: [uns/ingest_geometry]
writes: [uns/barcode_correction_run, uns/barcode_correction_observed, uns/barcode_correction_counts, obs/barcode_correction_reads]
devices: [cpu, cuda]
mcp_tool: singlet_ingest_quant_barcode_whitelist_correction
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Cell barcode correction (whitelist-based or inferred barcode set)

> Assigns each observed cell barcode that is not on the list to one listed origin under an explicit rule, or leaves it unassigned, and records every decision so that correction can be audited.

## 1. Question

For each distinct observed cell barcode and its reads, given a candidate set $W$ (a vendor or user whitelist, or a set inferred from counts) and a mismatch tolerance, which member of $W$ is the origin, if any, and how are rival candidates resolved? Inputs are the parsed barcodes with base qualities where recorded. Outputs are a decision per distinct barcode, a corrected barcode per read, and a cell-barcode by read-count table. A correct answer keeps exact matches unchanged, maps a one-substitution barcode to its origin only when the evidence is unambiguous, and leaves ambiguous or possibly foreign barcodes unassigned instead of absorbing them.

## 2. Why this task matters and where the field stands

Each uncorrected sequencing error in a cell barcode splits one cell across false barcodes or merges foreign reads into a real cell. Whitelist chemistries such as 10x Chromium [R1] draw barcodes from a known pool, so the standard approach treats each off-list barcode as an error to map to a listed neighbour [R2]. Protocols with random cell barcodes, such as Drop-seq beads [R3], have no list and rely on an inferred set. Tools implement correction with different neighbourhoods, ambiguity rules and count weights: bustools [R4], STARsolo [R5], alevin and alevin-fry [R6][R7] and UMI-tools [R8]. Cell Ranger's correction code is in its source distribution [R9]; singlet treats it as a reference rule only (section 12).

The status is **contested**. Four points remain open.

1. **Acceptance rule.** Tools either accept only unambiguous one-substitution barcodes, or accept the leading candidate when its count share is high (0.975 in STARsolo and alevin-fry). None of them models a foreign origin or fits the candidate weights by maximum likelihood, and UMI-tools discards above-knee indel near misses without modelling them.
2. **Ambiguity from list density.** The best-practices chapter states that a one-substitution barcode from the 10x v3 list has about an 81% chance of lying at distance one from two or more listed barcodes, and that reads with ambiguous corrections are most often discarded [R2]. Section 3 shows that equation (5) gives far less ambiguity than this figure for a uniform list of the official size.
3. **Foreign origins.** A real, non-retained barcode with exactly one listed neighbour is absorbed by the unique rule [R4][R8].
4. **Benchmarks.** The cited benchmarks do not isolate correction. End-to-end comparisons evaluate whole preprocessing workflows [R10], and mixture-control designs test whole pipelines [R11].

## 3. Theory and insight

Let $b$ be an observed barcode of length $L$ with $n_b$ reads, $W_1(b)=\{w\in W: d_H(b,w)=1\}$ its one-substitution candidates, and $e_i=10^{-Q_i/10}$ the error probability of base $i$. The kernel assumes independent substitutions at calibrated $Q_i$, each replaced by one of the other three bases with equal probability, and no indels. It is first order: at most one error per barcode.

$$P(b\mid w)=\prod_{i=1}^{L}\Big[(1-e_i)\,\mathbb 1[b_i=w_i]+\tfrac{e_i}{3}\,\mathbb 1[b_i\neq w_i]\Big]\qquad(1)$$

If $w$ differs from $b$ only at position $j$ and $w'$ only at $k$, the likelihood ratio is

$$\frac{P(b\mid w)}{P(b\mid w')}=\frac{e_j/(1-e_j)}{e_k/(1-e_k)}\approx\frac{e_j}{e_k}\qquad(2)$$

The main rules in use are special cases of the posterior over $W_1(b)$ with a none class $\varnothing$ for an origin outside the retained set. The leader $\hat w$ is accepted iff $P(\hat w\mid b)\ge\tau$.

$$P(w\mid b)=\frac{\pi_w P(b\mid w)}{\pi_\varnothing P(b\mid\varnothing)+\sum_{w'\in W_1(b)}\pi_{w'}P(b\mid w')}\qquad(3)$$

- **Unique rule.** With uniform $\pi$, equal kernel terms and no none class, $P(w\mid b)=1/|W_1(b)|$. For any $\tau>1/2$ this accepts exactly when $|W_1(b)|=1$.
- **STARsolo weights.** 1MM_multi takes $\pi_k\propto N_k$, the total read count of candidate $k$, drops the $(1-e_i)$ factors and has no none class. It accepts the leader iff its share of $\sum_k N_k10^{-Q_k/10}$ is at least $0.975$ [R5]. Two candidates of equal quality need $N_1\ge39N_2$, since $0.975/0.025=39$.
- **alevin-fry frequency.** Each retained source $s$ contributes $N_s+1$, where $N_s$ is its frozen exact count. The leading target $t^*$ is accepted when

$$\frac{\sum_{s\in S(t^*)}(N_s+1)}{\sum_{t}\sum_{s\in S(t)}(N_s+1)}\ge c,\qquad c=0.975\ \text{(RNA)}\qquad(4)$$

  where $S(t)$ is the set of sources with canonical target $t$. The denominator is inferred from the documentation's prose (section 10). Two targets again give $N_1+1\ge39(N_2+1)$.
- **Cell Ranger share.** Its one-mismatch rule weights each listed candidate by its prior count plus one, times the error probability of the mismatched base, and accepts the leader at posterior 0.975 [R9]. This is the form of equation (4) with a pseudocount on counts and quality weights. A missing quality is replaced by a constant, which cancels between candidates.

For uniform random $W$ and $b\notin W$ one substitution from a listed barcode, the chance of more than one listed neighbour is

$$P\big(|W_1(b)|\ge2\big)\approx1-\exp\!\Big(-(3L-1)\tfrac{|W|}{4^{L}}\Big)\qquad(5)$$

The Poisson approximation requires $|W|/4^L\ll1$. At $L=16$ the chapter's 81% needs $|W|\approx1.5\times10^8$, about 3.5% of $4^{16}$ and 22 times the official v3 list (section 8, B2), which equation (5) places at about 7%. The figure therefore implies a non-uniform list or another quantity. Equation (5) also gives the regime in which correction works: unique neighbours dominate while $|W|\ll4^L/(3L)$.

**The none class needs a count model.** The uniform term $P(b\mid\varnothing)=4^{-L}$ is about $1.4\times10^6$ times smaller than the error term $e/3$ at Phred 30 and $L=16$, so a non-retained origin would need prior odds near $10^6$ to win. Per-read terms also treat each read as an independent origin, although the reads of one barcode share one origin. A count model fits better. An error-derived neighbour $w$ contributes an expected $\lambda_{wb}=\sum_{\text{reads of }w}e_j/3$ reads to $b$, so at Phred 30 a parent of 3,000 reads yields about one. A real non-retained cell has many exact reads. dropEst's merge step uses a Poisson target estimator [R12].

**Estimands.** The decision unit is a distinct observed barcode, and each read inherits its barcode's decision, so read-level metrics are read-weighted. In simulation the truth for each read is its planted origin, an index in $W$ or $\varnothing$. The corrected barcode per read estimates that origin. The per-barcode status is categorical. The top share is the leader's weight divided by the sum over candidates, after the pseudocount. The cell-barcode count table sums reads by corrected barcode and is not normalised.

**Assumptions.** Errors are independent across positions and reads. The origin lies in $W$ or $\varnothing$, and $W$ contains every retained barcode. Qualities are calibrated; STARsolo uses them, and bustools and UMI-tools do not. Errors made before the read, in PCR or on the bead, are shared by a molecule's reads and cannot be separated by a read-level kernel.

**Failure modes.** The unique rule absorbs a foreign origin that has one listed neighbour, and it discards reads from dense regions of the list in a sequence-dependent way [R2]. Share rules reject an observation whose leader has less than 39 times the runner-up's evidence, so off-list reads between a low-count and a dense barcode are lost. Conversely, an observation that is an error of a dominant candidate, with the other candidate under one thirty-ninth of its count, is recovered by share rules and discarded by unique rules. Quality-weighted rules inherit any miscalibration. Shift-aware neighbourhoods admit indels, which equation (1) excludes.

**Why a model adds value.** A posterior gives calibrated probabilities, an explicit threshold and a none class, and EM can estimate the list prior from counts without labels:

$$\pi_w^{(t+1)}=\frac1N\sum_b n_b\,\frac{\pi_w^{(t)}P(b\mid w)}{\sum_{w'\in W_1(b)\cup\{\varnothing\}}\pi_{w'}^{(t)}P(b\mid w')},\qquad N=\sum_b n_b\qquad(6)$$

Equation (6) is per-read and inherits the objection above. It is the standard mixture-weight update under a fixed kernel, with local optima, and its none mass is identified only through the kernel.

**Insight.** Correction works when $W$ is sparse relative to sequence space (equation 5) and true barcodes dominate their neighbours in count. Under calibrated errors the decisive quantity is the count ratio. A 0.975 share demands 39-fold evidence, which a dominant parent meets and comparable neighbours do not. The main risk is the none class, not the error model.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| bustools correct | heuristic | Corrects an off-list barcode only if exactly one on-list barcode lies at Hamming distance 1; otherwise leaves it uncorrected | [R4][R13] |
| STARsolo 1MM | heuristic | Accepts a read only if exactly one listed barcode matches at distance 0 or 1 and that barcode has at least one exact read; rejects multi-matches | [R5][R14] |
| STARsolo 1MM_multi | hybrid | Weights each distance-1 candidate by total reads times the Phred error of its mismatched base; accepts the leader at share 0.975 | [R5][R14] |
| STARsolo 1MM_multi_pseudocounts | hybrid | As 1MM_multi with a unit pseudocount on exact counts; the N-base variant also multi-matches barcodes containing N | [R14] |
| alevin-fry unique | heuristic | Accepts a non-exact observation only if all neighbouring retained sources identify one canonical target; an exact source always wins | [R7][R15] |
| alevin-fry frequency | hybrid | Adds one to each source count, sums by canonical target and accepts the leader when its confidence reaches 0.975 (RNA) or 0.90 (ATAC) | [R7][R15] |
| UMI-tools error-correct mapping | heuristic | Maps off-list barcodes within a Hamming threshold to listed barcodes; a barcode within threshold of two or more listed barcodes is excluded | [R8][R16] |
| UMI-tools distance knee | heuristic | Ranks barcodes by count and takes the point of maximum distance from the cumulative chord; repeats on a prefix of three times the knee index until stable | [R8][R16] |
| Cell Ranger one-mismatch posterior | hybrid | Weights each listed one-mismatch candidate by its prior count plus one, times the error probability of the mismatched base; accepts the leader at posterior 0.975 | [R9] |
| UMI-tools above-knee detection | heuristic | Above the knee, a barcode with a higher-count near miss (edit distance one, indels included) is removed; correct mode also maps one with a single substitution near miss to that neighbour | [R16] |

The unique-neighbour rule is the common standard: bustools, the UMI-tools mapping and the alevin-fry unique policy exclude ambiguous observations, and STARsolo's 1MM rejects them. The closest weighted alternatives are STARsolo's 1MM_multi, which its documentation says matches CellRanger 2.2.0 best [R14], the alevin-fry frequency policy, and the Cell Ranger posterior, which has the same share form. Each method in the table is backed by its code or documentation. dropEst's merge falls outside the tables (section 10).

Defaults taken from source, with file, line and commit:

| Method | Parameter | Value | Source |
|---|---|---|---|
| bustools correct | candidates needed to correct | exactly 1 | bustools_correct.cpp:883 @ d4d7a28 |
| bustools correct | off-list barcodes dropped | `no_correct` option | bustools_correct.cpp:869 @ d4d7a28 |
| bustools correct | on-list file | `-w/--onlist`, required | bustools_main.cpp:1718 @ d4d7a28 (usage: README.md:96-109) |
| STARsolo 1MM | oneExact | true | ParametersSolo.cpp:701 @ b1edc12 |
| STARsolo 1MM | exact-read requirement for a single match | enforced | SoloReadFeature_inputRecords.cpp:38 @ b1edc12 |
| STARsolo 1MM | multi-match without multi option | rejected (cbMatch = -3) | SoloReadBarcode_getCBandUMI.cpp:87 @ b1edc12 |
| STARsolo 1MM | N position with several matches | rejected unless the N-base option is set | SoloReadBarcode_getCBandUMI.cpp:56-58 @ b1edc12 |
| STARsolo 1MM_multi | default type | 1MM_multi | STARsolo.md:393 @ b1edc12 |
| STARsolo 1MM_multi | cbMinP | 0.975 | ParametersSolo.cpp:289 @ b1edc12 |
| STARsolo 1MM_multi | oneExact | true | ParametersSolo.cpp:705 @ b1edc12 |
| STARsolo 1MM_multi | candidates with zero total reads | skipped | SoloReadFeature_inputRecords.cpp:79 @ b1edc12 |
| STARsolo pseudocount variants | pseudocount on exact counts | +1 per listed barcode | Solo.cpp:66-70 @ b1edc12 |
| STARsolo N-base variant | multi-match for N-containing barcodes | enabled | ParametersSolo.cpp:714 @ b1edc12 |
| alevin-fry | confidence, RNA | 0.975 | barcode_correction.rst:29 @ ad05742 |
| alevin-fry | confidence, ATAC | 0.90 | barcode_correction.rst:29-30 @ ad05742 |
| alevin-fry frequency | pseudocount | 1 per candidate source | barcode_correction.rst:24-25 @ ad05742 |
| alevin-fry | neighbourhood, filtered RNA | substitution-or-shift-1 | barcode_correction.rst:62 @ ad05742 |
| alevin-fry | neighbourhood, unfiltered RNA | hamming-1 | barcode_correction.rst:63 @ ad05742 |
| UMI-tools whitelist | error-correct threshold | 1 | whitelist.py:311 @ 79d8b81 |
| UMI-tools getCellWhitelist | error-correct threshold | 0 (no mapping) | whitelist_methods.py:473 @ 79d8b81 |
| UMI-tools whitelist | knee method | distance | whitelist.py:307 @ 79d8b81 |
| UMI-tools whitelist | above-knee detection | off (None) | whitelist.py:320 @ 79d8b81 |
| UMI-tools extract | error-correct cell barcode | off | extract.py:289 @ 79d8b81 |
| UMI-tools mapping | ambiguity exclusion | excluded when within threshold of two or more entries | whitelist_methods.py:462-465 @ 79d8b81 |
| Cell Ranger posterior | confidence threshold | 0.975 | corrector.rs:87 @ 669395e |
| Cell Ranger posterior | pseudocount on prior counts | +1 | corrector.rs:142 @ 669395e |
| Cell Ranger posterior | likelihood per candidate | error probability of the mismatched base, Phred offset 33 | corrector.rs:143, 170-173 @ 669395e |
| Cell Ranger posterior | expected-error limit in the struct default | unbounded (f64::MAX) | corrector.rs:109 @ 669395e |
| Cell Ranger posterior | quality when none is supplied | Phred 66, constant across candidates | corrector.rs:8, 130 @ 669395e |

## 5. Proposed singlet approach

- **Default and exposed policies.** `unique` with `hamming-1` is the default. bustools, UMI-tools and the alevin-fry unique policy use this rule; it needs no qualities and is deterministic. `frequency` exposes count-share correction with pseudocount, confidence and optional Phred weighting, and `exact` is the no-correction baseline. The posterior and count model of section 3 stay out of the interface until they meet the falsifier below, since no benchmark yet favours them.
- **Inferred sets.** `whitelist: inferred` applies the distance knee, bounded by `expect_cells` when given. Above-knee detection is off by default, because UMI-tools documents that its relaxed mode can merge distinct cells into an in-silico doublet.
- **Model-based extension (proposed).** Replace the per-read terms of equation (3) with a barcode-level count model: each listed candidate contributes an expected error count $\lambda_{wb}$ to $b$, and $b$ may be its own origin with a count distribution fitted by EM. Kernel parameters and $\tau$ are calibrated on B1. Falsifier: relative to `unique`, the model must lower non_retained_absorption_rate at no greater unassigned_rate cost on the calibrated arm, and must not raise wrongful_assignment_rate on the offset-quality arm. Failing either removes it.
- **Machine learning.** Fitting needs no PyTorch: EM is a sparse matrix-vector product over a neighbour graph of about $3L$ edges per distinct barcode, implemented in hard-coded CPU code and, on CUDA, with cuSPARSE. PyTorch is justified only for a learned quality recalibration trained on planted reads.
- **Kernels and streaming.** The whitelist is a 2-bit packed sorted array or hash table, and neighbours come from substituting each position with each other base ($3L$ probes per distinct barcode). The parse stream is read twice: first to count distinct barcodes, then to decide and write per-read output. Memory is $O(|W|)$ plus $O(\text{distinct barcodes})$, independent of read count. CPU parallelises over distinct barcodes; CUDA batches probes and EM sweeps for large sets.
- **N bases.** A barcode containing N is not corrected, and an N position never matches a candidate.

Routes for each source are in section 12; parameter defaults are generated in section 6.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member or artefact | Type | Description |
|---|---|---|---|
| read | uns/ingest_geometry | dict (JSON) | Resolved barcode span, read index and parse policy flags, so that correction matches the parse. |
| read (sidecar) | parse stream at `parse_stream` | one record per read | Barcode sequence and qualities, read identifier, parse status, from barcode extraction. Not a member. |
| write | uns/barcode_correction_run | dict (JSON) | Method, neighbourhood, options, whitelist identity (path or catalogue name with checksum), counts per status, corrected read fraction. |
| write | uns/barcode_correction_observed | table | One row per distinct observed barcode: status (exact, corrected, ambiguous, no_candidate, below_threshold), corrected barcode, reads, number of candidates, top share. |
| write | uns/barcode_correction_counts | table | Corrected cell barcode by read count. |
| write | obs/barcode_correction_reads | integer | Reads corrected into each cell barcode in the obs index. |
| write (sidecar) | correction stream at `correction_out` | one record per read | Read identifier, corrected barcode, status. Not a member. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI, or a workspace handle. |
| `parse_stream` | string/null | null | — | Parse stream from barcode extraction; null uses the stream recorded for this dataset. |
| `whitelist` | string | required | — | Whitelist path or catalogue name, or 'inferred' to derive the set from observed counts. |
| `method` | string | "unique" | `exact`, `unique`, `frequency` | unique is the default and corrects only unambiguous one-substitution barcodes; exact disables correction. |
| `neighbourhood` | string | "hamming-1" | `hamming-1`, `substitution-or-shift-1` | Neighbourhood for non-exact barcodes; shift-aware neighbourhoods are abundance heuristics, not indel models. |
| `frequency` | object | — | — | Options for method frequency: share threshold, pseudocount and optional Phred weighting. |
| `frequency.confidence` | number | 0.975 | min 0.5; max 1 | Share the leader must reach; 0.975 matches STARsolo cbMinP and alevin-fry RNA. |
| `frequency.pseudocount` | number | 1 | min 0 | Added to each candidate's exact count before the share is computed. |
| `frequency.use_quality` | boolean | false | — | Weight candidates by the Phred error at the mismatched base; requires base qualities. |
| `inferred` | object | — | — | Options when whitelist is inferred: knee rule, expected-cell bound and above-knee handling. |
| `inferred.knee_method` | string | "distance" | `distance`, `density` | Knee rule applied to ranked barcode counts. |
| `inferred.expect_cells` | integer/null | null | min 1 | Expected cell number bounding the inferred set; null applies the knee alone. |
| `inferred.above_knee` | string | "none" | `none`, `discard`, `correct` | Handling of above-knee barcodes with a higher-count near miss; none disables it. |
| `correction_out` | string/null | null | — | Path of the per-read correction sidecar; null writes a file beside the dataset. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without reading the stream. |
| `overwrite` | boolean | false | — | Replace existing output members and the sidecar instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters: `whitelist` is required; the value `inferred` derives the set from counts and activates the `inferred` options. The `frequency` options apply only to `method: frequency`, and `neighbourhood` applies to `unique` and `frequency`; `exact` ignores both. A null `parse_stream` resolves to the stream written by barcode extraction for this dataset, and a missing stream is an error, never an empty result. `use_quality` requires base qualities in the parse stream and fails without them. Every parameter is recorded in `uns/barcode_correction_run`.

## 7. MCP tool

Tool name `singlet_ingest_quant_barcode_whitelist_correction` (definition in `tasks/mcp/singlet_ingest_quant_barcode_whitelist_correction.json`). Example call and compact result:

```json
{"dataset": "lib1.singlet", "whitelist": "10x_v3_permit_list", "method": "frequency", "frequency": {"confidence": 0.975}}
{"dataset": "lib1.singlet", "status": "completed",
 "wrote": ["uns/barcode_correction_run", "uns/barcode_correction_observed", "uns/barcode_correction_counts", "obs/barcode_correction_reads"],
 "summary": {"method": "frequency", "neighbourhood": "hamming-1", "whitelist_size": "<int>", "n_corrected": "<int>", "n_ambiguous": "<int>", "corrected_read_fraction": "<float>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: yes; streams above the in-memory table limit return `queued` with a job identifier. Stochastic: no; output is fixed for a given list and parse stream, independent of thread count. The `dry_run` option returns estimated seconds, peak memory from a sample of the stream, and the device, without writing.

## 8. Benchmarks

**Shared protocol.** Every comparator reads the same parse stream and list file, and writes to the same observed table. UMI collapse, mapping and cell calling are held fixed in accuracy arms, and thread count is fixed. Metrics are per read; ties and unassigned observations count as unassigned, never as wrong. Simulations use seeds 0 to 4, reported as median and range. Comparators are exact, unique, frequency, STARsolo 1MM and 1MM_multi, alevin-fry unique and frequency, and UMI-tools mapping at threshold 1 on a knee-inferred list, each at its section 4 commit. The proposed posterior joins once implemented.

### B1. Planted-origin synthetic barcode-error benchmark (proposed)

- **Goal**: how often a one-substitution read returns to its planted origin, is misassigned, or is absorbed from a non-retained origin.
- **Ground truth**: planted simulation; each read records its origin (in $W$, or $\varnothing$).
- **Generator recipe**:
  1. Fix before simulating: list $W$; retained $R\subset W$; non-retained $N\subset W\setminus R$ of equal size; off-list $O$.
  2. Abundances: a recorded heavy-tailed law for $R$; a fixed low multiple of the median for $N\cup O$; multinomial read counts.
  3. Per-base Phred from a recorded declining profile.
  4. Substitute base $i$ with probability $10^{-Q_i/10}$ (uniform other base); record origin and single-substitution status.
  5. Arms: (a) error scale 0.5, 1 and 2; (b) calibrated versus offset qualities; (c) list density at one quarter, one half and all of the official list; (d) an error ramp along the barcode.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Official 10x v3 list | [R2]; https://teichlab.github.io/scg_lib_structs/data/10X-Genomics/3M-february-2018.txt.gz | 16 nt | — | Arm (c) |
| Simulated reads | recipe | 16 nt; no species | — | Seeds 0 to 4 |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| wrongful_assignment_rate | Planted-origin mismatches among assigned reads | minimise | primary | — |
| correct_recovery_rate | One-substitution reads from $R$ assigned to origin, of all such reads | maximise | primary | — |
| non_retained_absorption_rate | One-substitution reads from $N\cup O$ assigned to a retained target | minimise | primary | — |
| unassigned_rate | One-substitution reads from $R$ left unassigned | against wrongful | guardrail | — |
| composition_bias | Mean absolute GC difference over positions, in points, $R$ versus recovered reads | minimise | guardrail | — |

- **Comparators and protocol**: shared protocol; five replicate simulations per arm.
- **Acceptance**: design targets (not literature): on the calibrated arm at 0.975, wrongful_assignment_rate at or below 0.001; a policy lowering non_retained_absorption_rate below `unique` reports unassigned_rate.
- **Known pitfalls**: a shared kernel favours the posterior by construction; arm (d) guards this.

### B2. Ambiguity against list density (proposed, consistency)

- **Goal**: test equation (5) on uniform random lists, and measure the ambiguity of the official list.
- **Ground truth**: consistency with the analytic expectation of equation (5) on uniform lists. On the official list the value is observed only, with no expectation claimed.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Uniform random 16 nt lists | generated; sizes span $\lvert W\rvert/4^{L}$ from $10^{-5}$ to $10^{-1}$ | 16 nt | — | Five seeds per size. |
| Official 10x v3 barcode list | [R2] | 16 nt droplet barcodes; 6,794,880 barcodes | — | Same list as B1. |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ambiguous_fraction | Among observations $b\notin W$ one substitution from a listed barcode, the fraction with $\lvert W_1(b)\rvert\ge2$ | compare with equation (5) | primary | proposed |
| ambiguous_fraction_official | The same definition on the official list | report | primary | proposed |

- **Comparators**: the prediction of equation (5).
- **Protocol**: generate observations by applying one substitution to members of each list, and count $\lvert W_1(b)\rvert$ exactly by enumerating the $3L$ neighbours of each observation.
- **Acceptance**: design target: on uniform lists with $\lvert W\rvert/4^L\le10^{-2}$ the observed fraction is within 10% relative of equation (5). The official-list value has no target.
- **Known pitfalls**: equation (5) is a Poisson approximation, so the target applies only at small density. A uniform list understates ambiguity for structured lists, so the official-list value is not a check of the formula.

### P1. Performance and scaling (proposed)

Wall time and peak memory at 10k, 100k, 1M and 10M cells, with the same reads per cell at every scale, on CPU and CUDA, for each comparator at equal thread counts. Report throughput in distinct barcodes per second. Hold fixed the thread count, list file, parse stream and memory limit, and check that repeated executions give identical outputs.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.barcode_umi_extraction`: Cell barcode and UMI extraction from raw reads
  - `ingest-quant.chemistry_detection`: Protocol and chemistry detection from unlabelled reads
- **Feeds**:
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
- **Reads**: `uns/ingest_geometry`
- **Writes**: `uns/barcode_correction_run`, `uns/barcode_correction_observed`, `uns/barcode_correction_counts`, `obs/barcode_correction_reads`
<!-- CHAINING:AUTO:END -->

The droplet count workflow executes this step after barcode extraction and before mapping; cell calling consumes its counts.

## 10. Risks, pitfalls and open questions

- **Unverified details.** The alevin-fry frequency denominator (equation 4) and its tie order come from the documentation, not from source, and the documentation says confidence is compared as an exact rational value. The alevin (salmon) C++ rules are absent from the alevin-fry source tree, which is the Rust rewrite, so the original alevin rule is not stated here. STARsolo adds its pseudocount to exact counts while the weights use total counts, and the effect of that split on acceptance is not stated. The Cell Ranger caller's setting for the expected-error limit and the source of the prior counts are not stated; the struct default is unbounded.
- **Excluded methods.** dropEst's Poisson merge is described here only through its class names and flags, so its acceptance rule and default maximum edit distance are not stated.
- **Literature.** Whether the chapter's 81% reflects list structure or another quantity is decided by the official-list value in B2 (section 3).
- **Data.** The cited material states no terms for the official whitelist file; confirm them before redistribution and record its checksum. Cell Ranger's code is cited only for its decision rule (section 12). The 354M-cell catalogue may not keep read-level barcodes and qualities; if it does not, the count-model extension cannot be fitted on it, and only abundance priors and downstream checks remain. Alevin-fry's measurement note (`docs/barcode-correction-measurements.md`, Full Flex v2, Frequency at 97.5%) reports 55,188 distinct observations and 196,478 reads that change target; its inputs are local paths, so the figures cannot be reproduced from the repository.
- **Technical risk.** Equation (1) excludes indels, so shift-aware neighbourhoods are heuristics that change assignments on real data and are reported separately. Correction must precede UMI collapse, or one molecule is counted under two barcodes. The list and the correction are coupled: the list decides which barcodes can absorb errors, so a changed list changes both wrongful assignment and ambiguity, and no reviewed source treats them jointly.
- **First experiment.** Build the B1 generator and the B2 check first. Evaluate exact, unique and frequency on arms (a) and (c), and compare the uniform-list ambiguity with equation (5). Only then implement the count-model extension, judged by the falsifier in section 5.

## 11. References

R1. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — verified (corpus)
R2. He D, Srivastava A, Sarkar H, Patro R, Kim SH, Heumos L. Single-cell best practices, chapter Raw data processing (theislab/single-cell-best-practices, commit d581689). *GitHub* 2026. — verified (repo)
R3. Macosko EZ, Basu A, Satija R, et al. Highly parallel genome-wide expression profiling of individual cells using nanoliter droplets. *Cell* 2015. doi:10.1016/j.cell.2015.05.002 — verified (corpus)
R4. Melsted P, Booeshaghi AS, Liu L, et al. Modular, efficient and constant-memory single-cell RNA-seq preprocessing. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00870-2 — verified (corpus)
R5. Kaminow B, Yunusov D, Dobin A. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021 (preprint). doi:10.1101/2021.05.05.442755 — verified (corpus)
R6. Srivastava A, Malik L, Smith T, Sudbery I, Patro R. Alevin efficiently estimates accurate gene abundances from dscRNA-seq data. *Genome Biology* 2019. doi:10.1186/s13059-019-1670-y — verified (corpus)
R7. He D, Zakeri M, Sarkar H, et al. Alevin-fry unlocks rapid, accurate and memory-frugal quantification of single-cell RNA-seq data. *Nature Methods* 2022. doi:10.1038/s41592-022-01408-3 — verified (corpus)
R8. Smith T, Heger A, Sudbery I. UMI-tools: modeling sequencing errors in Unique Molecular Identifiers to improve quantification accuracy. *Genome Research* 2017. doi:10.1101/gr.209601.116 — verified (corpus)
R9. 10x Genomics. Cell Ranger source distribution, barcode crate (repository commit 669395e). *GitHub* 2026. — verified (repo)
R10. You Y, Tian L, Su S, et al. Benchmarking UMI-based single-cell RNA-seq preprocessing workflows. *Genome Biology* 2021. doi:10.1186/s13059-021-02552-3 — verified (corpus)
R11. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R12. Petukhov V, Guo J, Baryawno N, et al. dropEst: pipeline for accurate estimation of molecular counts in droplet-based single-cell RNA-seq experiments. *Genome Biology* 2018. doi:10.1186/s13059-018-1449-6 — verified (corpus)
R13. BUStools. bustools source, README and LICENSE (repository commit d4d7a28). *GitHub* 2025. — verified (repo)
R14. Dobin A. STARsolo documentation and parameter source (repository commit b1edc12). *GitHub* 2024. — verified (repo)
R15. COMBINE-lab alevin-fry maintainers. Barcode-correction documentation (docs/source/barcode_correction.rst, repository commit ad05742). *GitHub* 2026. — verified (repo)
R16. Sudbery I, CGAT. UMI-tools source: whitelist, whitelist_methods and extract modules (repository commit 79d8b81). *GitHub* 2026. — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/BUStools/bustools | BUStools (LICENSE); README cites Melsted P et al. | BSD-2-Clause (LICENSE, Copyright (c) 2018 BUStools) | Reference for on-list Hamming-1 correction and the no-correct option | callout (comparator); the unique rule is reimplemented |
| https://github.com/alexdobin/STAR | Alexander Dobin | MIT (LICENSE, Copyright (c) 2019 Alexander Dobin) | Reference for 1MM and 1MM_multi weights and cbMinP | reimplement from the stated rules; callout (comparator) |
| https://github.com/COMBINE-lab/alevin-fry | Avi Srivastava, Hirak Sarkar, Dongze He, Noor Pratap Singh, Rob Patro (Cargo.toml) | BSD-3-Clause (LICENSE, Copyright (c) 2020- University of Maryland) | Reference for unique and frequency policies and their defaults | reimplement from the documentation; callout (comparator) |
| https://github.com/CGATOxford/UMI-tools | Ian Sudbery (pyproject.toml); CGAT (LICENSE) | MIT (LICENSE, Copyright (c) 2015 CGAT) | Reference for error-correct mapping, distance knee and above-knee detection | reimplement; callout (comparator) |
| https://github.com/hms-dbmi/dropEst | Petukhov V, Guo J, Baryawno N, Severe N, Scadden DT, Samsonova MG, Kharchenko PV (README citation) | GPL-3.0 (LICENSE.md) | Poisson merge strategies (class names and flags only) | callout (no code) |
| https://github.com/10XGenomics/cellranger | 10x Genomics | Custom 10x licence (LICENSE, Copyright (c) 2026 10x Genomics): an MIT-style grant limited to use with 10x Genomics products or data generated with them; no redistribution or sublicensing | Reference for the one-mismatch posterior (barcode crate, corrector.rs) | callout only: not run, not copied |
