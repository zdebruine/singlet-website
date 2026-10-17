---
id: immune-repertoire.chain_pairing_dual_receptor_calling
title: Chain pairing and dual-receptor calling per cell
area: immune-repertoire
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [immune-repertoire.receptor_contig_assembly, immune-repertoire.vdj_gene_annotation]
feeds: [immune-repertoire.tcr_clonotype_definition, immune-repertoire.repertoire_diversity_expansion, doublets.ensemble_doublet_calling]
reads: [contigs/cell_barcode, contigs/chain, contigs/locus_family, contigs/productive, contigs/junction_aa, contigs/umi_count, contigs/duplicate_count, contigs/consensus_count, contigs/is_cell, contigs/high_confidence, contigs/full_length, contigs/tpm]
writes: [obs/receptor_type, obs/chain_pairing, obs/pairing_class, obs/primary_vj_contig, obs/primary_vdj_contig, obs/secondary_vj_contig, obs/secondary_vdj_contig, obs/keep_receptor, obsm/chain_indices, uns/chain_pairing_params]
devices: [cpu, cuda]
mcp_tool: singlet_immune_repertoire_chain_pairing_dual_receptor_calling
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Chain pairing and dual-receptor calling per cell

> Assigns each cell's receptor contigs to a primary and a secondary chain per locus family, and labels whether a second productive chain is a genuine dual receptor, a doublet suspect or a low-support artefact.

## 1. Question

Which contigs form a cell's receptor pair (alpha with beta, or heavy with light), and does the cell carry a genuine second productive chain of one locus, such as dual alpha, rather than a low-support artefact or a multiplet? The input is the contig table of `receptor_contig_assembly` (locus, productivity, junction, UMI support), with optional chain-locus expression. The output is a per-cell pairing class, primary and secondary contig identifiers, and a keep decision. A correct call matches the chains the cell expressed. Those chains are not observed directly, so section 8 uses full-length reads and planted truth.

## 2. Why this task matters and where the field stands

Pairing sets the receptor input to clonotype definition, clonal expansion and specificity analysis [R1]. A spurious second chain creates a clone that does not exist, and a missed chain hides a clone member. Allelic exclusion is the usual model for one productive chain per locus [R9, R10]. Dual-receptor cells are nonetheless reported as biology: dual-alpha T cells in autoimmune and viral settings [R5, R7], and a high proportion of dual-BCR B cells in single-cell BCR data [R6, R8]. The task is **contested** because the rules disagree on dual and multiplet cells. The scirpy receptor model keeps two chains per family, flags a third as multichain, and labels a cell with two complete pairs as "two full chains" [R2]. Cell Ranger requires the chain-name set to match one of four combinations and ignores counts. Dandelion adds fold-change dominance, with exceptions for TRB with TRD and for IGM with IGD [R4]. TraCeR and BraCeR rank chains by TPM [R1, R3]. Benchmarks of receptor reconstruction exist for BCR [R12] and TCR [R13].

The open problems are these. No per-cell pairing benchmark against an orthogonal full-length reference is cited here (section 10), and simulated recovery is not truth. Chain counts cannot separate doublets from genuine second chains (section 3). Pairing recall cannot exceed the sensitivity of contig assembly, which depends on sequencing depth.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $k$, $n$ | contig $k$ in cell $n$ |
| $g$ | locus family, VJ or VDJ |
| $\ell_k$, $p_k$ | locus of contig $k$, and its productivity flag (1 if productive) |
| $u_k$ | UMI count of contig $k$ |
| $\lambda$, $\mu$ | expected UMI count of a present chain; expected count of a spurious contig |
| $a \ge b$, $N=a+b$ | UMI counts of two productive contigs of one locus, and their total |

A genuine cell has at most two productive chains per family, one per chromosome copy [R9, R10]. The rules in use are deterministic functions of these quantities. The proposed model adds the probabilities in E3, E5 and E6.

**E1 (primary and secondary, rule in use).**

$$\mathcal{P}^{g}_{n}=\operatorname{top}_{2}\{k:\ \ell_k\in g,\ p_k=1,\ \mathrm{CDR3}^{aa}_k\ \text{present}\}$$

Contigs are ordered by $u_k$, then duplicate and consensus counts, then junction and junction amino-acid sequence, all descending. The estimand is the two contig identifiers per family per cell, normalised per cell. Matches the scirpy defaults [R2].

**E2 (multichain flag, rule in use).**

$$m^{g}_{n}=\mathbb{1}\bigl\{\,|\{k:\ \ell_k\in g,\ p_k=1\}|>2\,\bigr\}$$

Contigs removed by the filter do not count. The basis is the two-copy model behind E1. The scirpy glossary cites [R11] for the view that most multichain cells are multiplets. The flag is valid only after the productivity filter.

**E3 (allelic split, proposed).** If two productive contigs of one locus are expressed with equal allelic weight, then $a\mid N\sim\mathrm{Bin}(N,\tfrac12)$, and the two-sided p-value is

$$p=\min\{1,\;2\Pr(X\ge a)\},\qquad X\sim\mathrm{Bin}(N,\tfrac12),\quad a\ge b,\ N=a+b.$$

The estimand is one p-value per pair of productive contigs of one locus, normalised by $N$. Regime: moderate $N$ and unbiased UMI sampling; allelic expression bias, PCR amplification bias and UMI collisions violate it. The formula gives $p=1.0$ for $(a,b)=(2,1)$ and $p\approx0.30$ for $(10,5)$. At $N=3$ the smallest attainable $p$ is $0.25$, so no three-UMI split is significant at 0.05.

**E4 (fold-change dominance, heuristic).**

$$\frac{a}{b}>c_{\mathrm{fc}},\qquad c_{\mathrm{fc}}=2 \text{ (Dandelion default; consensus fold change 5 is a second criterion)}$$

The estimand is a dominance indicator per productive family per cell. The rule ignores $N$, so low-count pairs can exceed the cutoff by chance.

**E5 (orphan by capture, Poisson).**

$$\Pr(u_\beta=0)=e^{-\lambda_\beta}$$

The estimand is the probability that a present beta chain is missed, per chain. The formula gives $0.607$ for $\lambda=0.5$ and $0.135$ for $\lambda=2$. Regime: independent Poisson capture. Real counts are overdispersed, and at equal mean a negative binomial has more zeros, so the Poisson form understates orphans at low $\lambda$.

**E6 (spurious tail).**

$$\Pr(u\ge m)=1-\sum_{j=0}^{m-1}e^{-\mu}\frac{\mu^{j}}{j!}$$

The estimand is the probability that an ambient or misassigned contig reaches $m$ UMIs, per spurious contig. Regime: small, roughly homogeneous $\mu$ within one sample; $\mu$ is estimated per dataset.

**Doublet confound (derived).** Two single-pair cells with distinct clonotypes give two TRA and two TRB contigs, the count of a cell with two complete pairs, which scirpy labels two full chains [R2]. If one partner's TRB is missed, the pool has two TRA and one TRB, the count of a dual-alpha cell. Chain counts therefore cannot separate doublets from genuine second chains. A gene-expression doublet score or clonal consistency is needed as external evidence.

**Assumptions and failure modes.** The rules assume UMI support proportional to allelic expression, correct barcodes and productivity flags, and one chain per contig. Capture dropout produces orphans whose rate depends on expression. Secondary contigs of one to three UMIs cannot be separated from ambient contigs by fold change (E4, E6). Truncated or error-prone contigs inflate a family's count unless identical sequences are merged, as Dandelion does before dominance [R4]. Non-productive contigs with high counts become primary if not filtered first. TPM rules inherit quantifier bias. Genuine cross-locus co-expression (TRD in TRB cells, IGM with IGD, IGK with IGL plus IGH) must not be removed as an artefact without an explicit rule.

**Why heuristics work, and what a model adds.** The rules agree on the common single pair and differ on dual and multiplet cells. Accuracy is therefore set by the lowest-support chains: the primary pair is usually clear at high UMI counts, while secondary chains and multiplets carry the uncertainty. A calibrated model turns E3, E5 and E6 into a mixture over single-pair, dual, doublet, orphan and artefact states, fitted by EM per dataset. It returns a keep probability per secondary chain, with thresholds set on B2 at a stated false-discovery rate. Without external doublet evidence its dual and doublet states are not separable, and it must report that.

**Estimands.** The pairing class, primary and secondary identifiers and keep decision are one value per cell, with proportions over all cells. The secondary keep score is one value per secondary contig. Section 8 uses pair accuracy per evaluable cell, dual recall per reference dual cell, orphan false rate per reference single-pair cell, AUROC per secondary-chain instance, AUPRC per synthetic cell at a stated prevalence, and calibration error over probability bins.

**Complexity.** Sorting $k$ contigs per family in each cell costs $O(k\log k)$, so the rule is linear in cells for fixed $k$.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Cell Ranger contig gates and paired chain-set rule | heuristic | Gates contigs on `is_cell`, `high_confidence`, productivity and full length; a cell is paired when its chain-name set equals TRA_TRB, TRG_TRD, IGK_IGH or IGL_IGH, and counts are ignored | section 12 |
| scirpy receptor model (`index_chains`, `chain_qc`) | heuristic | Filters contigs, ranks chains per family, flags more than two as multichain, and assigns pairing classes | [R2] |
| TraCeR top-two rule | heuristic | Keeps the two recombinants per locus with the highest TPM, after kallisto or salmon quantification | [R1] |
| BraCeR top-two rule | heuristic | Applies the TraCeR rule to BCR loci and counts productive, full-length recombinants | [R3] |
| Dandelion `check_contigs` dominance | heuristic | Merges identical sequences, then keeps a dominant productive contig per family by UMI and consensus fold change, with exceptions | [R4] |

The published standard is the scirpy receptor model [R2], which keeps the two highest-ranked chains per family, flags more than two as multichain, and defines the pairing classes used here. The Cell Ranger rule is the native comparator for 10x-only pipelines. The TraCeR and BraCeR top-two rule [R1, R3] and the Dandelion dominance rule [R4] are comparators and are also enum values (`top2_tpm`, `dandelion_dominance`). No probabilistic per-cell pairing model appears among the sources cited here.

| Method | Parameter | Value | Source |
|---|---|---|---|
| scirpy `index_chains` | filter | `productive` and `require_junction_aa`, combined with and; filtered chains do not count toward multichain | `src/scirpy/pp/_index_chains.py:22-33`, `:86-88` @998c66a |
| scirpy `index_chains` | ranking keys | `umi_count`, `duplicate_count`, `consensus_count`, `junction`, `junction_aa`, all descending | `src/scirpy/pp/_index_chains.py:29-32` @998c66a |
| scirpy `index_chains` | multichain threshold | more than 2 chains per family after filtering | `src/scirpy/pp/_index_chains.py:136`, `:140` @998c66a |
| scirpy `chain_qc` | pairing labels | single pair, orphan VJ, orphan VDJ, extra VJ, extra VDJ, two full chains, ambiguous, multichain, no IR | `src/scirpy/tl/_chain_qc.py:193-198` @998c66a |
| scirpy `read_10x_vdj` | `filtered` | true keeps only contigs with `is_cell` and `high_confidence` | `src/scirpy/io/_io.py:63`, `:211` @998c66a |
| Cell Ranger | contig load filter | keep if `is_cell` is not false and `high_confidence` is true | `lib/python/cellranger/vdj/annotations.py:1471`, `:1495-1497` @669395e |
| Cell Ranger | clonotype gates | productive, full length and high confidence required; CDR3 present; single chain | `lib/python/cellranger/vdj/annotations.py:1390-1411` @669395e |
| Cell Ranger | paired chain-set rule | TRA_TRB, TRG_TRD, IGK_IGH or IGL_IGH; counts not compared | `lib/python/cellranger/vdj/annotations.py:1376-1388`; `lib/python/cellranger/vdj/constants.py:27-32` @669395e |
| TraCeR | recombinants kept per locus | 2, ranked by TPM | `tracerlib/core.py:249-261` @3df208f |
| BraCeR | recombinants kept per locus | 2, ranked by TPM | `bracerlib/core.py:309-322` @4c3a1a7 |
| BraCeR | productive full-length count | `full_length` and `productive` | `bracerlib/core.py:352-364` @4c3a1a7 |
| Dandelion | `productive_only`, `min_umi` | True, 1 | `src/dandelion/base/preprocessing/_preprocessing.py:2867`, `:2869` @320fd13 |
| Dandelion | `umi_foldchange_cutoff`, `consensus_foldchange_cutoff` | 2, 5 | `_preprocessing.py:2870`, `:2871` @320fd13 |
| Dandelion | `ntop_vdj`, `ntop_vj` | 1, 2 | `_preprocessing.py:2872-2873` @320fd13 |
| Dandelion | `allow_exceptions` | True: TRB with TRD and IGM with IGD | `_preprocessing.py:2874`, `:2889-2897` @320fd13 |
| Dandelion | `filter_extra`, `filter_ambiguous` | True, False | `_preprocessing.py:2876-2877` @320fd13 |

## 5. Proposed singlet approach

**Routes.** The scirpy receptor model is ported as `scirpy_chain_qc`, the TraCeR and BraCeR top-two rule as `top2_tpm`, and the Dandelion dominance criterion is reimplemented from its documented rule as `dandelion_dominance`. Cell Ranger's gates are a callout and stay outside the enum. Licences are in section 12.

**Default.** `scirpy_chain_qc` with the filters in section 6, two chains per family and `min_umi_secondary` 1. This implements the published rule and remains the default until the model meets B2. `pairing_class` maps scirpy labels: single pair to `single`; extra VJ and extra VDJ to `dual_vj` and `dual_vdj`; orphan VJ and orphan VDJ to `orphan`; two full chains and multichain to `doublet_suspect`; ambiguous to `ambiguous`; no IR to null. `keep_receptor` is true for `single`, `dual_vj` and `dual_vdj`. Two full chains are excluded, since counts cannot rule out a doublet.

**Proposed model (not in the enum).** Replace E4 with a two-state mixture per secondary contig: a genuine chain whose count follows the allelic split of E3, and an artefact whose count follows E6 with $\mu$ estimated per dataset. E5 enters the single-pair likelihood, and EM fits the mixture on a catalogue sample. On joining the enum it would add `obs/keep_probability`. It is adopted only if its B2 AUROC exceeds that of `scirpy_chain_qc` and its calibration error is at most 0.05 (proposed).

**ML stack.** No deep network is needed. Closed-form tests and the EM are hard-coded in C++ on the CPU. PyTorch is used only if a learned calibrator on per-contig features beats the EM on B2; its final scorer is then exported as a logistic function hard-coded in C++. CUDA is considered only for batch scans of very large contig tables.

**Kernels and devices.** Contigs are stored grouped by cell, and top-two selection is a small sort within each family. Cells are independent, so the rules stream in chunks. The EM needs one fitting pass over a cell sample and one scoring pass.

**Defaults an agent should use.** `method` `scirpy_chain_qc`, `productive_only` true, `require_high_confidence` true, `max_chains_per_family` 2, `min_umi_secondary` 1, `device` auto. `top2_tpm` is refused unless `contigs/tpm` is present.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | contigs/cell_barcode | string | barcode of each contig row |
| read | contigs/chain | categorical | TRA, TRB, TRG, TRD, IGH, IGK or IGL |
| read | contigs/locus_family | categorical | VJ or VDJ, derived from the chain |
| read | contigs/productive | bool | assembler productivity flag |
| read | contigs/junction_aa | string | CDR3 amino-acid sequence |
| read | contigs/umi_count, contigs/duplicate_count, contigs/consensus_count | int | support used for ranking |
| read | contigs/is_cell, contigs/high_confidence, contigs/full_length | bool | optional 10x flags |
| read | contigs/tpm | float | optional; read by `top2_tpm` only |
| write | obs/receptor_type | categorical | TCR, BCR, ambiguous, multichain or no IR |
| write | obs/chain_pairing | categorical | scirpy pairing label |
| write | obs/pairing_class | categorical | single, dual_vj, dual_vdj, orphan, doublet_suspect or ambiguous; null for no IR |
| write | obs/primary_vj_contig, obs/primary_vdj_contig, obs/secondary_vj_contig, obs/secondary_vdj_contig | string | contig identifiers; null when absent |
| write | obs/keep_receptor | bool | true for single, dual_vj and dual_vdj |
| write | obsm/chain_indices | int | row indices of primary and secondary contigs per family |
| write | uns/chain_pairing_params | dict | method, options, rule version and input hash |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: .singlet path or URI, or a workspace handle. Needs the contigs table from receptor_contig_assembly. |
| `method` | string | "scirpy_chain_qc" | `scirpy_chain_qc`, `dandelion_dominance`, `top2_tpm` | scirpy_chain_qc is the default published rule; dandelion_dominance applies fold-change dominance; top2_tpm needs contigs/tpm. |
| `productive_only` | boolean | true | — | Drop non-productive contigs before ranking and multichain counting. Keep true unless the assembler already filters. |
| `require_high_confidence` | boolean | true | — | Keep only contigs with is_cell and high_confidence when those flags exist, as in 10x-derived tables. |
| `max_chains_per_family` | integer | 2 | min 1; max 4 | Chains kept per locus family as primary and secondary; a cell with more is flagged multichain. |
| `min_umi_secondary` | integer | 1 | min 1 | Minimum UMI count for a secondary contig to be kept; 1 disables it. The value 2 is proposed and needs benchmark B2. |
| `scirpy` | object | — | — | Options used only when method is scirpy_chain_qc. |
| `scirpy.require_junction_aa` | boolean | true | — | Drop contigs without a CDR3 amino-acid sequence before ranking and counting. |
| `dandelion` | object | — | — | Options used only when method is dandelion_dominance. |
| `dandelion.umi_foldchange_cutoff` | number | 2 | min 1 | Fold change over the second contig that makes the top UMI contig dominant. |
| `dandelion.consensus_foldchange_cutoff` | number | 5 | min 1 | Consensus-count fold change used as the second dominance criterion. |
| `dandelion.allow_exceptions` | boolean | true | — | Allow TRB with TRD and IGM with IGD to co-occur without marking ambiguity. |
| `dandelion.ntop_vdj` | integer | 1 | min 1 | Number of productive VDJ contigs considered for dominance. |
| `dandelion.ntop_vj` | integer | 2 | min 1 | Number of productive VJ contigs considered for dominance. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto uses CPU except for batch scans of very large contig tables. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing obs and uns members written by a previous call instead of failing. |
<!-- PARAMS:AUTO:END -->

`method` selects the rule. `productive_only`, `require_high_confidence` and `max_chains_per_family` apply to every rule. The `scirpy` options apply only to `scirpy_chain_qc`, and the `dandelion` options only to `dandelion_dominance`. `top2_tpm` ranks by `contigs/tpm`. `min_umi_secondary` applies after ranking, to secondary contigs only; its value 2 is proposed and changes only after B2. Existing output members are replaced only when `overwrite` is true.

## 7. MCP tool

Tool name `singlet_immune_repertoire_chain_pairing_dual_receptor_calling` (definition in `tasks/mcp/singlet_immune_repertoire_chain_pairing_dual_receptor_calling.json`). Example call and compact result:

```json
{"dataset": "tcr_cohort.singlet", "method": "scirpy_chain_qc", "max_chains_per_family": 2}
{"dataset": "tcr_cohort.singlet", "status": "completed",
 "wrote": ["obs/receptor_type", "obs/chain_pairing", "obs/pairing_class", "obs/keep_receptor", "uns/chain_pairing_params"],
 "summary": {"n_cells": "<int>", "n_single": "<int>", "n_orphan": "<int>", "n_dual_vj": "<int>", "n_dual_vdj": "<int>", "n_doublet_suspect": "<int>", "n_ambiguous": "<int>", "rule": "scirpy_chain_qc; productive; max 2"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: the call finishes inline; very large contig tables may return `queued`. Stochastic: no, every rule is deterministic. Dry run: returns estimated seconds, peak memory and device from the contig count.

## 8. Benchmarks

**Shared protocol.** All rules are applied to one identical contig table, so differences reflect the rule and not the assembler. Cells enter scoring after the productivity and CDR3 filters of the rule under test; cells without a call are reported as coverage rather than dropped. Results are stratified by UMI depth of the primary pair. Intervals are 95% cell-level bootstrap intervals with donor blocks. Expression doublet calls are applied to reference cells before scoring. Seeds are fixed at 0 for rules and 20 for simulations. Thresholds marked proposed are design choices, not literature values.

### B1. Per-cell pairing accuracy against a full-length reference (proposed)

- **Goal**: test whether a rule assigns the true partner chain to each cell and detects genuine second chains.
- **Ground truth**: orthogonal measurement. Each reference cell carries chains supported by at least $k=2$ full-length reads per chain, measured in the same cell and joined by barcode or plate well. Estimands are in section 3.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| — | — | — | — | See section 10 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| pair_accuracy | Evaluable cells (productive alpha and beta in the reference, primary pair called) whose primary VJ and VDJ CDR3 amino acids both match the reference | higher | primary | — |
| dual_alpha_recall | Reference cells with two productive TRA CDR3s, each with at least $k$ reads, whose second TRA is kept as secondary | higher | primary | — |
| orphan_false_rate | Reference single-pair cells labelled orphan VJ or orphan VDJ | lower | guardrail | — |
| coverage | Cells with a call other than no IR or ambiguous | higher | guardrail | — |

- **Comparators**: `scirpy_chain_qc` at 998c66a; `dandelion_dominance` at 320fd13 with defaults; the TraCeR and BraCeR tools on their own outputs; Cell Ranger's paired flag at 669395e.
- **Protocol**: apply every rule to one contig table per assembler, then repeat with each tool's own assembly; stratify by UMI depth.
- **Acceptance criterion** (proposed design targets, not literature values): pair_accuracy at least 0.90 on evaluable cells with at least 5 UMIs per reference chain; dual_alpha_recall at least 0.5 at orphan_false_rate at most 0.05.
- **Known pitfalls**: a low $k$ inflates false dual references.

### B2. Synthetic multiplet and dual-chain benchmark with planted truth (proposed)

- **Goal**: separate genuine second chains from doublets and artefacts, with labels fixed by construction.
- **Ground truth**: planted simulation on real cells; labels set by the recipe.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue, single-pair T and B cells | singlet internal catalogue | single-cell; 354M cells, about 40% author-annotated | internal | contig content in section 10 |

- **Generator recipe**
  1. Select single-pair cells with one productive pair and at least 5 UMIs per chain.
  2. Genuine dual: add a second productive TRA or light chain from another clone, with allelic ratio 1:1, 2:1 or 4:1 (design choice).
  3. Doublet: pool two single-pair cells with non-matching CDR3s, within and across donors.
  4. Artefact: add one contig of 1 or 2 UMIs carrying one CDR3 amino-acid substitution.
  5. Dropout orphan: remove the beta contig with probability 0.2 or 0.5.
  6. Hold out clonotypes; fit UMI distributions to real cells; add a negative-binomial dropout variant.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC, dual versus artefact | Probability a genuine second chain outranks an artefact by keep score | higher | primary | — |
| Doublet AUPRC | Precision-recall area for simulated doublets, reported per prevalence | higher | primary | — |
| Dual recall at 5% FDR | Genuine dual cells kept where 5% of flagged cells are false | higher | primary | — |
| Calibration error | Binned keep-probability error; model outputs only | lower | guardrail | — |

- **Comparators**: `scirpy_chain_qc`; `dandelion_dominance`; the proposed mixture (section 5).
- **Protocol**: four classes plus single pair, several prevalences, 20 seeds.
- **Acceptance criterion** (proposed): AUROC at least 0.9; at most 5% of simulated single-pair cells flagged multichain; doublets separable from genuine duals by a feature beyond chain counts, or the benchmark fails by design.
- **Known pitfalls**: cross-donor pooling and constant UMI counts both inflate separability, and precision depends on prevalence.

### P1. Performance and scaling

Wall time, peak resident memory and cells per second at $10^3$, $10^4$, $10^5$ and $10^6$ cells, with 2 to 6 contigs per cell, on identical input tables with a single thread and a warm cache. Comparators: `index_chains` and `chain_qc` at 998c66a, and Dandelion `check_contigs` at 320fd13. Labels must agree with the reference rule on every cell before timings count. Proposed acceptance: at least 10 times faster than scirpy at $10^5$ cells, with 100% per-cell label agreement.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `immune-repertoire.receptor_contig_assembly`: Full-length TCR/BCR contig assembly from scRNA-seq reads
  - `immune-repertoire.vdj_gene_annotation`: V(D)J gene assignment and CDR3 annotation of receptor sequences
- **Feeds**:
  - `immune-repertoire.tcr_clonotype_definition`: TCR clonotype definition and grouping
  - `immune-repertoire.repertoire_diversity_expansion`: Repertoire diversity and clonal expansion estimation
  - `doublets.ensemble_doublet_calling`: Ensemble and consensus doublet calling
- **Reads**: `contigs/cell_barcode`, `contigs/chain`, `contigs/locus_family`, `contigs/productive`, `contigs/junction_aa`, `contigs/umi_count`, `contigs/duplicate_count`, `contigs/consensus_count`, `contigs/is_cell`, `contigs/high_confidence`, `contigs/full_length`, `contigs/tpm`
- **Writes**: `obs/receptor_type`, `obs/chain_pairing`, `obs/pairing_class`, `obs/primary_vj_contig`, `obs/primary_vdj_contig`, `obs/secondary_vj_contig`, `obs/secondary_vdj_contig`, `obs/keep_receptor`, `obsm/chain_indices`, `uns/chain_pairing_params`
<!-- CHAINING:AUTO:END -->

Follows contig assembly and V(D)J annotation. Its labels feed clonotype definition, repertoire diversity and doublet calling.

## 10. Risks, pitfalls and open questions

- **Evidence not independently confirmed.** Full texts of [R12] and [R13] are not used, so no assembly figure from them appears as a threshold. Dandelion dominance rests on its docstring and the code at lines 3140 to 3300 of `_preprocessing.py`.
- **Missing ground truth.** No primary human T-cell dataset with same-cell full-length reads and 10x libraries is cited here, so B1 cannot run yet. Simulated recovery is not orthogonal truth.
- **Upstream filters.** Cell Ranger's `high_confidence` flag appears in Rust code under `lib/rust/` (for example `vdj_filter_barcodes` and `vdj_asm_asm`) at 669395e, and that upstream step is taken as given. TRUST4 and MiXCR pairing rules are outside the methods.
- **Unsettled biology.** Dual-alpha and dual-BCR frequencies are reported [R5, R6], but no reference rate applies across tissues or assays. Alpha and beta detection rates are not quantified here.
- **Catalogue content.** The UMI distributions, multichain fraction and contig content of the singlet catalogue are not yet characterised. The B2 generator recipe depends on them. The catalogue has no public accession and an internal licence.
- **Confound and first experiment.** Chain counts alone cannot separate doublets from genuine second chains. The first experiment ports `scirpy_chain_qc`, reproduces its labels on one catalogue contig table, and then measures on B2 whether a gene-expression doublet score adds separation beyond chain counts, and whether negative-binomial dropout changes the orphan rates.

## 11. References

R1. Stubbington MJT, Lönnberg T, Proserpio V, Clare S, Speak AO, Dougan G, Teichmann SA. T cell fate and clonality inference from single-cell transcriptomes. *Nature Methods* 2016. doi:10.1038/nmeth.3800 — verified (corpus)

R2. Sturm G, Szabo T, Fotakis G, Haider M, Rieder D, Trajanoski Z, Finotello F. Scirpy: a Scanpy extension for analyzing single-cell T-cell receptor-sequencing data. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa611 — verified (corpus)

R3. Lindeman I, Emerton G, Mamanova L, Snir O, Polanski K, Qiao SW, Sollid LM, Teichmann SA, Stubbington MJT. BraCeR: B-cell-receptor reconstruction and clonality inference from single-cell RNA-seq. *Nature Methods* 2018. doi:10.1038/s41592-018-0082-3 — verified (corpus)

R4. Suo C, Polanski K, Dann E, Lindeboom RGH, Vilarrasa-Blasi R, et al. Dandelion uses the single-cell adaptive immune receptor repertoire to explore lymphocyte developmental origins. *Nature Biotechnology* 2023. doi:10.1038/s41587-023-01734-7 — verified (corpus)

R5. Schuldt NJ, Binstadt BA. Dual TCR T cells: identity crisis or multitaskers? *The Journal of Immunology* 2019. doi:10.4049/jimmunol.1800904 — verified (corpus)

R6. Zhu L, Peng Q, Wu Y, Yao X. scBCR-seq revealed a special and novel IG H&L V(D)J allelic inclusion rearrangement and the high proportion dual BCR expressing B cells. *Cellular and Molecular Life Sciences* 2023. doi:10.1007/s00018-023-04973-8 — verified (corpus)

R7. Ji Q, Perchellet A, Goverman JM. Viral infection triggers central nervous system autoimmunity via activation of CD8+ T cells expressing dual TCRs. *Nature Immunology* 2010. — verified (corpus)

R8. Shi Z, Zhang Q, Yan H, Yang Y, Wang P, et al. More than one antibody of individual B cells revealed by single-cell immune profiling. *Cell Discovery* 2019. doi:10.1038/s41421-019-0137-3 — verified (corpus)

R9. Brady BL, Steinel NC, Bassing CH. Antigen receptor allelic exclusion: an update and reappraisal. *The Journal of Immunology* 2010. — verified (corpus)

R10. Vettermann C, Schlissel MS. Allelic exclusion of immunoglobulin genes: models and mechanisms. *Immunological Reviews* 2010. doi:10.1111/j.1600-065x.2010.00935.x — verified (corpus)

R11. Ilicic T, Kim JK, Kolodziejczyk AA, Bagger FO, McCarthy DJ, Marioni JC, Teichmann SA. Classification of low quality cells from single-cell RNA-seq data. *Genome Biology* 2016. doi:10.1186/s13059-016-0888-1 — verified (corpus)

R12. Andreani T, Slot LM, Gabillard S, et al. Benchmarking computational methods for B-cell receptor reconstruction from single-cell RNA-seq data. *NAR Genomics and Bioinformatics* 2022. doi:10.1093/nargab/lqac049 — verified (corpus)

R13. Tian R, Yu Z, Xue Z, et al. Evaluation of T Cell Receptor Construction Methods from scRNA-Seq Data. *Genomics, Proteomics & Bioinformatics* 2025. doi:10.1093/gpbjnl/qzae086 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scirpy | Gregor Sturm (pyproject.toml author and maintainer); Tamas Szabo (pyproject.toml author); LICENSE copyright (2020) also names Francesca Finotello and the Institute of Bioinformatics, Medical University of Innsbruck | BSD 3-Clause (LICENSE; pyproject.toml) | receptor model, pairing classes and multichain flag; default rule; B1 and B2 comparator | port (`scirpy_chain_qc`) |
| https://github.com/10XGenomics/cellranger | 10x Genomics (copyright holder in LICENSE) | 10x Genomics terms (LICENSE, 2026): use, copy, modify and merge rights apply only with a 10x Genomics Product (clause 2); redistribution and sublicensing are forbidden (clause 3); no licence metadata in the repository | contig gates and paired chain-set rule; B1 comparator | callout (comparator only) |
| https://github.com/teichlab/tracer | Mike Stubbington (setup.py author) | Apache License 2.0 (LICENSE; copyright 2015 EMBL-EBI) | top-two TPM rule | port (`top2_tpm`) |
| https://github.com/teichlab/bracer | Mike Stubbington, Ida Lindeman, Guy Emerton, Nick England (setup.py author field) | Apache License 2.0 (LICENSE; copyright 2015 EMBL-EBI) | same top-two rule applied to BCR loci | port (`top2_tpm`) |
| https://github.com/tuonglab/dandelion (also at https://github.com/zktuong/dandelion) | zktuong (pyproject.toml authors); repository under the tuonglab organisation | GNU Affero General Public License v3 (LICENSE); pyproject.toml states v3 or later | dominance rule and exceptions; B1 comparator | reimplement (`dandelion_dominance`) |
