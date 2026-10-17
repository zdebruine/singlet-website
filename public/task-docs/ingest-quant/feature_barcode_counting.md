---
id: ingest-quant.feature_barcode_counting
title: Feature-barcode (ADT, hashtag, lipid-tag and guide) counting from FASTQ
area: ingest-quant
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.barcode_umi_extraction, ingest-quant.barcode_whitelist_correction]
feeds: [multimodal.adt_background_removal_normalization, demux.hashtag_sample_assignment, perturbation.guide_assignment, multimodal.adt_positivity_calling]
reads: [uns/ingest_geometry]
writes: [feature/layers/counts, obs/feature_total_umis, uns/feature_counting_qc]
devices: [cpu, cuda]
mcp_tool: singlet_ingest_quant_feature_barcode_counting
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Feature-barcode (ADT, hashtag, lipid-tag and guide) counting from FASTQ

> Counts the distinct molecules of each antibody, hashtag, lipid-tag or guide feature that each cell barcode carries, by matching feature-read sequences to a reference within a stated mismatch tolerance and collapsing UMIs per cell and feature.

## 1. Question

Given feature-library FASTQ from antibody-derived tags, hashtag oligos, lipid-tagged indices or CRISPR guide capture, how many distinct molecules of each feature does each corrected cell barcode carry when sequencing errors in the feature segment are tolerated? The inputs are the FASTQ pair, a feature reference of tag sequences and the corrected cell barcodes. The outputs are an integer cell-by-feature molecule matrix and the unmapped and ambiguous read fractions. A correct answer assigns each read to at most one tag under a declared error model and counts molecules, not reads.

## 2. Why this task matters and where the field stands

A feature barcode attaches a short sequence to a reagent (an antibody, a lipid-tagged sample index or a guide) so that the reagent is read alongside the transcriptome. Its per-cell count is the measurement. Antibody-derived tags quantify surface protein [R1]. Hashtag oligos identify the sample of origin and flag multiplets [R2], and lipid-tagged indices serve the same purpose [R3]. Demultiplexing, protein normalisation and guide assignment all start from this matrix, so a counting error reaches every downstream step.

Status: **contested**. Exact string matching is routine, but the published counters differ in their tolerance rule, their tie rule and their UMI rule, and no shared benchmark fixes the truth. The open problems are:

- **Tolerance versus separation.** A mismatch tolerance is safe only when tags are farther apart than twice that tolerance (section 3). The kITE index applies no such check; it deletes colliding variants with a warning (section 4). The rule for longer tolerances and short tags is not settled.
- **Tie handling.** A read within tolerance of two tags has no agreed assignment. CITE-seq-Count keeps the first tag in its sorted order (section 4), so its result depends on tag order.
- **UMI collapsing.** The directional rule [R5] is a general UMI-error model. Its thresholds for the low-diversity feature libraries used for hashtags and guides are not characterised.
- **Counting versus assignment.** Hashing doublet detection works on the counts after matching [R2], so agreement between counters is not accuracy.

## 3. Theory and insight

A feature read $r$ has a segment of fixed length $L$ at a known offset. The reference is a set of tags $\mathcal{B}=\{b_1,\dots,b_T\}$. Counting assigns each read to at most one tag, $a(r)\in\mathcal{B}\cup\{\varnothing\}$, then collapses UMIs within each (cell, feature) group.

**Orthogonality.** If two tags are at Hamming distance at least $2k+1$, no read lies within $k$ substitutions of both:

$$d_H(r,b_i)\le k \ \text{and}\ d_H(r,b_j)\le k \;\Rightarrow\; d_H(b_i,b_j)\le 2k$$

The implication is the triangle inequality for $d_H$; for $k=1$ it gives the separation of 3. The regime is equal-length segments with substitution-only errors. An insertion or deletion can move a read out of the Hamming ball, so the bound does not cover indels.

**Index size.** Each tag of length $L$ has $3L$ single-substitution variants, so the index before collision removal holds $T+3LT$ entries. This count is exact and grows linearly in $T$.

**Directional UMI rule.** An edge $u_a\to u_b$ is added when $d_H(u_a,u_b)\le\tau$ and $n_a\ge 2n_b-1$, where $n$ is the number of reads per UMI in one (cell, feature) group and $d_H$ is the Hamming distance, as in UMI-tools [R5] (section 4). This is a heuristic that assumes erroneous UMIs carry fewer reads than the molecule they derive from.

**Collision.** For $M$ molecules with uniform random UMIs of length $L_U$, the probability of any collision is approximately

$$P(\text{collision})\approx 1-\exp\!\left(-\frac{M(M-1)}{2\cdot 4^{L_U}}\right)$$

This follows from $\prod_{i<M}(1-i/N)\approx\exp(-M(M-1)/2N)$ with $N=4^{L_U}$, valid for $M\ll N$. For $L_U=10$ and $M=100$ it gives about 0.5 %. It assumes independent, unbiased UMIs.

**Posterior (downstream, for context).** For each cell, hashsolo computes

$$P(H\mid x)\propto P(x\mid H)\,\pi_H,\qquad H\in\{\text{negative},\text{singlet},\text{doublet}\},\quad \pi=(0.01,\,0.8,\,0.19)$$

in that prior order. The estimand is this per-cell posterior over the three hypotheses, which sums to one. It is valid when signal and noise per barcode are separable, and it shifts with $\pi$.

**Multiplets (downstream, implementation formula).** With $N_{\mathrm{obs}}$ called cells, $C=1.54$ and $N_G=95000$, the Cell Ranger assigner sets $\lambda=C\,N_{\mathrm{obs}}/N_G$ and scales the Poisson fractions for $k$ tags by $N_G/C$. The formula is stated in code; no derivation is cited here.

**Why heuristics work, and what a model adds.** For orthogonal sets a tolerance of one makes assignment exact (the orthogonality bound above), so the heuristic is correct inside its regime. It cannot state how likely a read is to belong to each tag. A read likelihood $P(r\mid b)=\prod_i P(r_i\mid b_i,q_i)$ uses the per-base qualities $q_i$, yields a posterior per read and therefore per-cell uncertainty. Its substitution matrices and tag abundances can be fitted by EM on the library itself, without external training data.

**Estimands.** Each output and truth quantity is defined once here.

- $\hat C_{cf}$, the matrix entry: the number of distinct collapsed UMIs assigned to feature $f$ in cell $c$, an integer with no depth normalisation.
- Unmapped and ambiguous fractions: reads with no tag, and reads with two or more tags, within tolerance, each divided by all read pairs whose cell barcode passes whitelist correction.
- $M_{cf}$, the simulation truth: the number of distinct planted molecules of feature $f$ in cell $c$. The count error is $\lvert\hat C_{cf}-M_{cf}\rvert$, averaged over groups.
- Correct assignment rate: reads with at most $k$ substitutions from their planted tag that are assigned to it, divided by all such reads; unmapped reads count as incorrect.
- Cross-tag false-assignment rate: reads assigned to a tag other than the planted one, divided by all simulated reads in the condition.

**Regime.** The exactness claims hold for substitution-only errors on equal-length segments, the UMI claims for uniform and independent UMIs, and the posterior claims under the stated mixture models.

**Pitfalls.** Pearson correlation on raw counts is dominated by the most abundant features and cells, so per-feature rank correlation and per-cell breakdowns are needed. Two tools that share an error model can agree while both are wrong. Discordance concentrates on similar tags and can be mistaken for a tool defect.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Cell Ranger feature assignment (10x Genomics) | hybrid | Assigns features with a Poisson cell-loading model for multiplets and a tied two-component Gaussian mixture for guide calling; the counting stage is outside the assignment modules. | [R7] (platform) |
| kITE (kb-python, kite workflow) | heuristic | Indexes each tag and its single-substitution variants, pseudoaligns reads against the index and collapses UMIs in the kb-python workflow. | [R4], [R6] |
| CITE-seq-Count | heuristic | Returns the first tag whose prefix lies within the Hamming tolerance, in longest-first order, then collapses UMIs directionally. | [R1], [R5] |
| hashedDrops (DropletUtils) | heuristic | Downstream: ambient-adjusted log-fold change between the best and second hashing tag, with MAD-based outlier thresholds. | — |
| hashsolo (scanpy) | model-based | Downstream: Bayesian posterior over negative, singlet and doublet per cell, with per-barcode signal and noise distributions estimated from the data. | [R8] |

The two counters in the table, CITE-seq-Count and the kITE workflow, are heuristic and serve as the published comparators. The Cell Ranger assigner and the two demultiplexers act after counting and are listed for context. None of the counters in this set fits a probabilistic read model.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| kITE | k-mer length | largest odd value not above the barcode length | pachterlab_kb_python kb_python/ref.py:751 @ 188d9c7 |
| kITE | variants per tag | $3L$ single substitutions; generation on by default | ref.py:26–29, 54–95 @ 188d9c7 |
| kITE | colliding entries | a variant equal to an original tag or to another tag's variant is deleted as that entry, with a warning | ref.py:119–141 @ 188d9c7 |
| kITE | 10x feature workflow | only with technology 10XV3 | main.py:717–719 @ 188d9c7 |
| CITE-seq-Count | UMI collapsing distance | 2 | cite_seq_count/__main__.py:126 @ 95aff19; processing.py:256–258 |
| CITE-seq-Count | cell barcode collapsing distance | 1 | __main__.py:142 @ 95aff19 |
| CITE-seq-Count | max errors | 2; help text says Levenshtein, matcher uses Hamming | __main__.py:183; processing.py:44 @ 95aff19 |
| CITE-seq-Count | tag order and match rule | longest tag first; first tag within tolerance returned | preprocessing.py:170; processing.py:25–52 @ 95aff19 |
| CITE-seq-Count | start trim | 0 | __main__.py:193 @ 95aff19 |
| UMI-tools | directional count condition | $n_a\ge 2n_b-1$; docstring states $>$ | umi_tools/network.py:207, 209 @ 79d8b81 |
| UMI-tools | default clustering method | directional | network.py:325 @ 79d8b81 |
| UMI-tools | default distance of the rule | 1 | network.py:194 @ 79d8b81 |
| UMI-tools | distance function | Hamming for equal-length UMIs; infinite for unequal lengths | umi_tools/_dedup_umi.pyx:2–19 @ 79d8b81 |
| Cell Ranger | gem count (MT) and correction factor | 95000 and 1.54 | lib/python/cellranger/feature/throughputs.py:14–17 @ 669395e |
| Cell Ranger | guide-calling mixture | 2 components, tied covariance, 10 initialisations, seed 0 | feature_assigner.py:231 @ 669395e |
| Cell Ranger | multiplet scaling | Poisson fractions times $N_G$ divided by $C$ | feature_assigner.py:116–118 @ 669395e |
| hashedDrops | min.prop (ambient profile inference); pseudo-count | 0.05; 5 | R/hashedDrops.R:216 @ ba4152d |
| hashedDrops | doublet and confident-call thresholds | 3 MADs, minimum 2; mixture off | R/hashedDrops.R:217 @ ba4152d |
| hashsolo | priors (negative, singlet, doublet) | $(0.01, 0.8, 0.19)$ | src/scanpy/preprocessing/_hashsolo.py:239; order 161–162; posterior 172 @ 8ed52d9 |
| hashsolo | noise barcode count | len(hashes) - 2 when unset | _hashsolo.py:188–189, 241 @ 8ed52d9 |

## 5. Proposed singlet approach

**Default: `mismatch_index`.** A deterministic index holds every tag and its single-substitution variants, built once per reference, following the kITE generator rule (route in section 12). A read with one hit is assigned to that tag. A read with several hits follows `tie_policy`, which defaults to `unmapped`, so no assignment depends on tag order. Two changes to the published generator are proposed. Colliding variants are flagged and kept, so a read that hits one follows the tie policy instead of losing tolerance silently. Pairs closer than $2k+1$ are reported at reference build. For orthogonal sets nothing is flagged (the orthogonality bound in section 3), so the change matters only for contrast sets.

**Tie policies.** `first_match` reproduces the list-order rule of CITE-seq-Count, for comparison only. `best_match` assigns the minimum-distance tag and leaves equal-distance ties unmapped.

**Quality-aware option.** `read_model: quality_em` replaces the Hamming indicator with the read likelihood of section 3, fitted by EM. Reads whose tag posterior exceeds a proposed 0.9 are assigned; the rest are unmapped. The option is kept only if, on the B1 contrast set, it lowers the cross-tag false-assignment rate relative to `unmapped` at a comparable unmapped fraction.

**UMI collapsing.** Collapsing follows assignment and is done per (cell, feature). The default is the directional rule of UMI-tools with `umi_threshold` 1. UMI-tools measures Hamming distance (section 4), so the default merges single substitutions only. A threshold of 2 adds double substitutions and merges more UMIs when diversity is low; no threshold admits insertion-deletion pairs. It is available but not the default.

**Stack and kernels.** Counting needs no PyTorch. The EM model has per-position $4\times4$ substitution matrices and $T$ abundances, a small, dense and hot model, so it is hard-coded in the C++ core with an optional CUDA batch kernel for large $T$ and $L$. Reads stream in chunks, and the index uses $O(LT)$ memory. UMI groups above 25 UMIs use the substring neighbour lookup of UMI-tools.

**Model status.** The hybrid claim rests on the deterministic index plus an optional calibrated read model. The index claim is falsified if the zero cross-tag result for orthogonal sets in B1 fails. The read-model claim is falsified by the B1 contrast-set test above.

**Defaults an agent should use without asking.** `method: mismatch_index`, `max_mismatch: 1`, `tie_policy: unmapped`, `read_model: hamming`, `umi_method: directional`, `umi_threshold: 1`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/ingest_geometry | dict | Cell barcode and UMI segment offsets from barcode and UMI extraction |
| read | external: feature FASTQ | FASTQ pair | R1 holds the cell barcode and UMI; R2 holds the feature segment |
| read | external: feature reference | TSV | Tag sequence, feature name and feature type; one length per library |
| read | external: barcode whitelist | list | Corrected cell barcodes; defaults to the RNA cell index |
| write | feature/layers/counts | int32 sparse | Molecule counts per cell (rows) and feature (columns) in a feature modality aligned to RNA cells |
| write | obs/feature_total_umis | int32 | Sum of feature molecules per cell over all features |
| write | uns/feature_counting_qc | dict | Unmapped and ambiguous fractions, tie-policy counts, flagged variants, separation violations |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle (.singlet path, URI or workspace handle) whose RNA cell index receives the feature modality. |
| `feature_reference` | string | required | — | Feature reference TSV: tag sequence, feature name and feature type. Sequences must share one length. |
| `fastq` | string | required | — | Feature-library FASTQ: R1 and R2 paths, or a directory containing them. |
| `whitelist` | string | — | — | Corrected cell barcode list from barcode whitelist correction; default is the RNA cell index. |
| `method` | string | "mismatch_index" | `mismatch_index`, `kite`, `citeseq_count` | Counting method. mismatch_index is the default; kite and citeseq_count are comparators. |
| `mismatch_index` | object | — | — | Options used only when method is mismatch_index. |
| `mismatch_index.max_mismatch` | integer | 1 | min 0; max 3 | Substitutions tolerated between a read's feature segment and a tag. |
| `mismatch_index.tie_policy` | string | "unmapped" | `unmapped`, `first_match`, `best_match` | Handling of reads matching two or more tags: unmapped, first in list order, or minimum distance. |
| `mismatch_index.read_model` | string | "hamming" | `hamming`, `quality_em` | hamming uses the index alone; quality_em adds a quality-aware likelihood with EM over tags. |
| `citeseq_count` | object | — | — | Options used only when method is citeseq_count. |
| `citeseq_count.max_errors` | integer | 2 | min 0; max 3 | Hamming error tolerance applied to each tag prefix. |
| `citeseq_count.start_trim` | integer | 0 | min 0 | Bases trimmed from the start of the feature read before matching. |
| `citeseq_count.bc_collapsing_dist` | integer | 1 | min 0 | Maximum Hamming distance for merging a cell barcode into a whitelist entry. |
| `umi_method` | string | "directional" | `directional`, `adjacency`, `cluster`, `unique` | UMI graph rule used to collapse reads into molecules per cell and feature. |
| `umi_threshold` | integer | 1 | min 0; max 3 | Maximum Hamming distance between UMIs merged by umi_method; 2 matches the CITE-seq-Count default. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto uses CUDA only for batched tag lookup on large libraries. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without counting. |
| `overwrite` | boolean | false | — | Replace existing feature members instead of failing. |
<!-- PARAMS:AUTO:END -->

The options `max_mismatch`, `tie_policy` and `read_model` apply only to `mismatch_index`, and the `citeseq_count` options apply only when `method` is `citeseq_count`. `umi_threshold` applies to every method, so reproducing CITE-seq-Count needs `umi_threshold` 2 together with `max_errors` 2. The reference is checked before counting: a tag pair closer than $2\,\mathrm{max\_mismatch}+1$ is reported, not dropped. Feature segments shorter than the reference length are counted as unmapped.

## 7. MCP tool

Tool name `singlet_ingest_quant_feature_barcode_counting` (definition in `tasks/mcp/singlet_ingest_quant_feature_barcode_counting.json`). Example call and result, with placeholder paths and values in angle brackets:

```json
{"dataset": "/data/library.singlet",
 "feature_reference": "/data/feature_reference.tsv",
 "fastq": "/data/fastq/feature/",
 "mismatch_index": {"max_mismatch": 1, "tie_policy": "unmapped"},
 "umi_threshold": 1}
```

```json
{"dataset": "/data/library.singlet",
 "status": "completed",
 "wrote": ["feature/layers/counts", "obs/feature_total_umis", "uns/feature_counting_qc"],
 "summary": {"n_reads": "<int>", "unmapped_fraction": "<float>", "ambiguous_fraction": "<float>",
             "tag_pairs_below_separation": "<int>", "flagged_variants": "<int>", "umi_collapsed_fraction": "<float>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: yes; the FASTQ is streamed, and large libraries return `queued` with a `job_id`. Stochastic: no; EM starts from fixed initial values, so identical inputs give identical output. Dry run: returns estimated time, peak memory and device from file sizes and tag count, without counting.

## 8. Benchmarks

Shared protocol. All counters receive the same FASTQ, reference and whitelist from the B1 generator, and cells outside the whitelist are excluded for every tool. Each condition uses seeds 0 to 4. Comparators run with the defaults in section 4 unless a benchmark sets a parameter. Metrics use the planted tag and molecule count as truth and are computed per condition and seed. Cell Ranger is excluded from the accuracy benchmark (section 12).

### B1. Planted-substitution simulation (proposed)

- **Goal**: measure per-read assignment, cross-tag false assignment and molecule-count error as functions of planted substitutions, tag separation, UMI length, indels and read model, with known truth.
- **Ground truth**: planted simulation. Each read carries its planted cell, tag and molecule; $M_{cf}$ is the truth for the count error, as defined in section 3.
- **Generator (proposed; every value is a benchmark setting)**:
  1. Draw $T\in\{10,50\}$ tags of length $L\in\{8,12,16\}$ uniformly, by rejection, as an orthogonal set (pairwise distance at least 3) or a contrast set (one pair at distance exactly 2).
  2. For each of $N$ cells drawn from a random whitelist and each tag, draw $M_{cf}\sim\mathrm{Poisson}(\mu)$ with $\mu\in\{1,5\}$, and draw its UMIs of length $L_U\in\{10,12\}$ without replacement within the group.
  3. Each molecule gives $1+\mathrm{Poisson}(\rho)$ reads, $\rho\in\{0,2\}$.
  4. Each read receives exactly $k\in\{0,1,2,3\}$ substitutions at uniform positions, each to a different base.
  5. Qualities are uninformative (Phred 30) or informative (Phred 12 at substituted positions, 35 elsewhere, a bounding case).
  6. With probability $p\in\{0,0.02\}$ one base is deleted from the feature segment; these reads are reported separately.
  7. R1 holds the cell barcode and UMI, R2 the feature segment; planted labels go to a side table.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Synthetic feature-library read pairs | Generator steps 1–7 | Feature reads; no species; $N$, $T$ and $\mu$ set the size | — | Planted labels in a side table |

| Metric | Estimand | Direction | Role | Reference |
|---|---|---|---|---|
| Correct assignment rate | Section 3 estimand | maximise | primary | — |
| Cross-tag false-assignment rate | Section 3 estimand; orthogonal and contrast sets reported separately | minimise | primary | — |
| Unmapped and ambiguous fractions | Section 3 estimands | minimise | guardrail | — |
| Molecule-count error | Section 3 estimands: mean over groups and exact-agreement fraction | minimise; exact fraction maximise | guardrail | — |

- **Comparators**: `mismatch_index` with each tie policy and each read model; `kite` at its default $k$; `citeseq_count` with `max_errors` 1 and 2. The UMI threshold is 1, and the molecule-count metric is also reported at 2.
- **Protocol**: vary one factor at a time from a base condition (orthogonal set, $L=12$, $T=10$, $\mu=5$, $L_U=12$, $\rho=2$, $p=0$, uninformative quality), plus the full sweep over $k$.
- **Acceptance criterion**: a proposed correctness check, not a literature threshold. For the orthogonal set with $k\le1$ and tolerance one, cross-tag false assignments are exactly zero for `mismatch_index` under every tie policy and for `citeseq_count` with `max_errors` 1. This follows from the orthogonality bound in section 3. The contrast set has no acceptance threshold; its rates are reported with the spread over seeds.
- **Known pitfalls**: the simulator's uniform substitutions match the Hamming model exactly, so `hamming` is favoured by construction and `quality_em` is judged only on the informative profile. Indel reads fall outside the orthogonality bound and are reported as a limitation.

### P1. Performance and scaling

Wall time, peak memory and throughput at 10k, 100k, 1M and 10M cells (streaming is claimed), on CPU and CUDA, for `mismatch_index`, `kite` and `citeseq_count`. Tag panels of 10, 100 and 1,000 tags are swept at 100k cells. Hold fixed: FASTQ, reference, whitelist, thread count, hardware and storage. Report index build time and query time separately, because the index grows as $3LT$ (the index-size count in section 3). Derived, not measured: naive per-read matching costs $O(TL)$, a hash lookup costs $O(L)$ independent of $T$ up to hashing, and the UMI graph in a group is quadratic in its distinct UMIs. Proposed target: wall time no higher than `citeseq_count` at every scale.

## 9. Chaining

No named recipe is set for this task; the generated lists give its upstream and downstream tasks.

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.barcode_umi_extraction`: Cell barcode and UMI extraction from raw reads
  - `ingest-quant.barcode_whitelist_correction`: Cell barcode correction (whitelist-based or inferred barcode set)
- **Feeds**:
  - `multimodal.adt_background_removal_normalization`: ADT background removal and normalization
  - `demux.hashtag_sample_assignment`: Hashtag-oligo and lipid-tag sample assignment with multiplet and negative calling
  - `perturbation.guide_assignment`: Per-cell guide and perturbation assignment
  - `multimodal.adt_positivity_calling`: Protein positivity calling (gating) for CITE-seq surface markers
- **Reads**: `uns/ingest_geometry`
- **Writes**: `feature/layers/counts`, `obs/feature_total_umis`, `uns/feature_counting_qc`
<!-- CHAINING:AUTO:END -->

## 10. Risks, pitfalls and open questions

- **Published concordance not reproduced.** The kITE paper [R4] was not read; its repository citation gives the bibliographic record only, so no concordance, speed or memory figures for kITE are given here. The kITE comparison is set out in section 8. [R4] is cited without a DOI because the repository citation gives none.
- **Cell Ranger counting stage.** The assignment modules contain no counting stage, so the tolerance and UMI rules of Cell Ranger counting are unknown and no Cell Ranger counting defaults are recorded. No Cell Ranger accuracy comparison is given.
- **Short tags.** No minimum separation for short tags is established. The records for [R2] and [R3] were confirmed from bibliographic sources; their methods were not read, and no statement here depends on tag length or discordance patterns in those papers.
- **Downstream evidence.** The hashsolo docstring cites Bernstein et al. 2020 [R8], the Solo doublet paper; a separate hashsolo paper was not identified. No genotype-labelled hashing benchmark is given here; it belongs to the demultiplexing document.
- **Citation details.** The UMI-tools record [R5] is given without volume and pages, which no source here confirmed.
- **First experiment.** Implement `mismatch_index` with its three tie policies and generate the B1 base condition. The zero cross-tag check must hold before any comparison on real libraries. The `quality_em` falsifier then decides whether that option stays in the tool. The directional rule and its threshold of 1 are tested in the same grid through the molecule-count metric.

## 11. References

R1. Stoeckius M, Hafemeister C, Stephenson W, Houck-Loomis B, Chattopadhyay PK, Swerdlow H, Satija R, Smibert P. Simultaneous epitope and transcriptome measurement in single cells. *Nature Methods* 2017. doi:10.1038/nmeth.4380 — verified (corpus)
R2. Stoeckius M, Zheng S, Houck-Loomis B, et al. Cell Hashing with barcoded antibodies enables multiplexing and doublet detection for single cell genomics. *Genome Biology* 2018;19:224. doi:10.1186/s13059-018-1603-1 — verified (search)
R3. McGinnis CS, et al. MULTI-seq: sample multiplexing for single-cell RNA sequencing using lipid-tagged indices. *Nature Methods* 2019;16(7):619-626. doi:10.1038/s41592-019-0433-8 — verified (search)
R4. Booeshaghi AS, Min KH, Gehring J, Pachter L. Quantifying orthogonal barcodes for sequence census assays. *Bioinformatics Advances* 2024;4(1):vbad181. — verified (repo)
R5. Smith T, Heger A, Sudbery I. UMI-tools: modeling sequencing errors in Unique Molecular Identifiers to improve quantification accuracy. *Genome Research* 2017. doi:10.1101/gr.209601.116 — verified (corpus)
R6. Melsted P, Booeshaghi AS, Liu L, et al. Modular, efficient and constant-memory single-cell RNA-seq preprocessing. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00870-2 — verified (corpus)
R7. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — verified (corpus)
R8. Bernstein NJ, Fong NL, Lam I, Roy MA, Hendrickson DG, Kelley DR. Solo: doublet identification in single-cell RNA-seq via semi-supervised deep learning. *Cell Systems* 2020;11(1). doi:10.1016/j.cels.2020.05.010 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/10XGenomics/cellranger | 10x Genomics (copyright holder in LICENSE) | Custom 10x Genomics licence (LICENSE, copyright 2026): internal use only, tied to 10x Genomics products or data; not open source | Assignment modules (feature_assigner.py, throughputs.py) | callout |
| https://github.com/pachterlab/kb_python | Kyung Hoi (Joseph) Min and A. Sina Booeshaghi (developers per README); Pachter Lab (copyright holder) | BSD 2-Clause (LICENSE; setup.py) | kITE index generation and colliding-entry rule (ref.py) | port |
| https://github.com/Hoohm/CITE-seq-Count | Roelli Patrick (LICENSE, setup.py) | MIT (LICENSE.txt) | First-match matcher and UMI call (processing.py) | callout |
| https://github.com/CGATOxford/UMI-tools | CGAT (copyright holder in LICENSE) | MIT (LICENSE) | Directional rule (umi_tools/network.py) | port |
| https://github.com/MarioniLab/DropletUtils | Aaron Lun (author); Jonathan Griffiths (maintainer); Davis McCarthy, Dongze He, Rob Patro (contributors) | GPL-3 (DESCRIPTION; no root LICENSE file) | hashedDrops, downstream comparator | callout |
| https://github.com/scverse/scanpy | scverse; F. Alexander Wolf, P. Angerer, Theis Lab (copyright holders in LICENSE) | BSD 3-Clause (LICENSE) | hashsolo implementation, downstream comparator | callout |
