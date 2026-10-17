---
id: immune-repertoire.tcr_clonotype_definition
title: TCR clonotype definition and grouping
area: immune-repertoire
scope: core
paradigm: heuristic
literature_status: contested
priority: P1
depends_on: [immune-repertoire.receptor_contig_assembly, immune-repertoire.vdj_gene_annotation, immune-repertoire.chain_pairing_dual_receptor_calling]
feeds: [immune-repertoire.repertoire_diversity_expansion, immune-repertoire.differential_clonal_expansion, immune-repertoire.repertoire_overlap_public_clones, immune-repertoire.tcr_specificity_group_discovery]
reads: [obs/tcr_alpha_cdr3_nt, obs/tcr_beta_cdr3_nt, obs/tcr_alpha_cdr3_aa, obs/tcr_beta_cdr3_aa, obs/tcr_alpha_v, obs/tcr_alpha_j, obs/tcr_beta_v, obs/tcr_beta_j, obs/tcr_alpha_productive, obs/tcr_beta_productive, obs/tcr_alpha_umis, obs/tcr_beta_umis, obs/donor_id, obsp/tcr_distance]
writes: [obs/clone_id, obs/clone_size, obs/clone_status, obsp/clone_graph, uns/clone_definition]
devices: [cpu, cuda]
mcp_tool: singlet_immune_repertoire_tcr_clonotype_definition
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# TCR clonotype definition and grouping

> Assigns each cell with paired TCR chains to a clonotype by exact CDR3 identity or by a distance threshold, blocking links across donors by default, and records the rule that produced the labels.

## 1. Question

Which cells carry receptors that descend from one ancestral T cell? The input is, per cell, its assembled TCR chains with CDR3 nucleotide and amino-acid sequences, V and J calls and UMI counts, optionally a pairwise distance matrix. The output is a clonotype label per cell, clone sizes and the rule that produced them. A correct answer is a partition whose same-clone pairs share an ancestor. Ancestry is not observed, so each benchmark in section 8 uses a proxy: planted clones, database specificity labels, or agreement with a reference rule.

## 2. Why this task matters and where the field stands

Clonotypes are the unit of clonal expansion, repertoire diversity, public-clone detection and receptor-level specificity grouping. The best-practices chapter defines a T-cell clonotype as cells of one clone whose primary α and β chains have identical CDR3 nucleotide sequences, leaves cells without both chains unassigned and does not merge cells of different donors [R1]. The task is **contested** because the field disagrees on four choices. The sequence level: nucleotide identity is strictest, amino-acid identity coarser and distance cutoffs coarser still. Dual-chain cells: a cell can join more than one clonotype when both pairs count. Donor scope: identical receptors across individuals can arise independently by convergent recombination [R2]. The distance cutoff: no false-match rate is stated for it. Dual-TCR biology and doublets cannot be separated without external labels [R3]. Single-cell transcriptomes support clonality inference from the same question [R4]. Distance-based grouping is also used for specificity: TCRdist uses a BLOSUM-based alignment distance [R6], learned substitution matrices exist [R9], and clustering models and representation learning have been compared for specificity [R7, R8]. A model-based test on single snapshots [R11] and generation probabilities of unselected recombination [R10] give the chance-level reference against which a match can be judged. The open problems are the sequence level, dual-chain cells, donor scope and a cutoff with a stated error rate. No accepted ground truth exists for clonal identity in single-cell data.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $x$, $y$ | cells with at least one productive chain pair |
| $c^{\alpha}_x$, $c^{\beta}_x$ | CDR3 keys of the primary alpha and beta chains of $x$, nucleotide or amino acid |
| $d_{VJ}$, $d_{VDJ}$, $d$ | chain-level and combined distances between two cells |
| $t$ | distance cutoff |
| $p(s)$, $a(s)$ | generation probability of nucleotide CDR3 key $s$; its amino-acid translation |
| $N$, $n$ | number of cells in a repertoire; number of cells sampled |
| $p_i$, $K_n$ | clone frequency; number of distinct clonotypes among $n$ sampled cells |

A definition assigns each cell a label. Identity rules return equivalence classes. Distance rules return connected components of a graph, which are not equivalence classes.

**E1 (identity).** $x \sim y \iff (c^{\alpha}_x, c^{\beta}_x) = (c^{\alpha}_y, c^{\beta}_y)$. Regime: exact match on the primary pair, both chains assembled and productive. The relation is transitive, so it partitions the cells.

**E2 (chain combination).** $d(x,y)=\max\{d_{VJ}(x,y),\,d_{VDJ}(x,y)\}$ when both chains must match, and $d(x,y)=\min\{d_{VJ}(x,y),\,d_{VDJ}(x,y)\}$ when either may. Regime: chain distances are computed first; the combination follows scirpy's documented convention.

**E3 (threshold graph).** $E_t=\{(x,y): d(x,y)\le t\}$, and the clusters are the connected components of $(V,E_t)$. The relation is not transitive: $d(x,y)\le t$ and $d(y,z)\le t$ do not imply $d(x,z)\le t$, so unrelated receptors join through intermediates. Leiden or fastgreedy partitions can split a component again.

**E4 (chance collision).** $\Pr[s_x=s_y]=\sum_s p(s)^2$ for independent draws from the unselected V(D)J distribution $p$, the generation probability of [R10]. Regime: first order, with no selection, no clonal structure, no sequencing error and small $p(s)$.

**E5 (expected chance pairs).** $\mathbb{E}\bigl[\#\{\text{identical pairs among } N \text{ independent cells}\}\bigr] \approx \binom{N}{2}\sum_s p(s)^2$. Regime: large $N$ and small $p(s)$. Within one donor this counts chance matches only, so true clonal pairs are the excess over this expectation.

**E6 (amino-acid coarsening).** $\sum_a\bigl(\sum_{s:\,a(s)=a} p(s)\bigr)^2 \ge \sum_s p(s)^2$. For masses $p_i\ge 0$ in one group, $(\sum_i p_i)^2=\sum_i p_i^2+\sum_{i\ne j}p_ip_j\ge\sum_i p_i^2$; summing over groups gives the inequality. The amino-acid chance rate is therefore never below the nucleotide rate, for any $p$. Deterministically, nucleotide-identical keys are amino-acid-identical, so for the same chains the nucleotide partition refines the amino-acid partition. This step is derived here.

**E7 (distance null).** $\Pr[d(s_x,s_y)\le t]=\sum_{s,s'}p(s)\,p(s')\,\mathbb{1}[d(s,s')\le t]$. This is E4 with the threshold indicator in place of the identity indicator, and it is derived here. It has no closed form for the thresholded graph of E3, because chaining makes component sizes depend on the whole graph, but it can be estimated by sampling from $p$. A cutoff can therefore be set to a stated pairwise false-match rate. The cutoffs in use (20 and 15 for TCRdist) are not derived this way.

**E8 (rarefaction).** $\mathbb{E}[K_n]=\sum_i\bigl[1-(1-p_i)^n\bigr]$, a multinomial approximation for $n$ draws with replacement, valid when $n$ is small relative to the repertoire. Counts grow with $n$, so counts from donors sampled to different depths are not comparable.

**Estimands.** Each output and ground-truth quantity is defined as follows.
- Clonotype label: per cell; the estimand is the partition of assigned cells, and clone counts are unnormalised and depend on sampling depth (E8).
- Same-clone pair indicator: per unordered pair of cells with both chains; pairwise F1 and the chance rate are normalised by the number of such pairs.
- Chance collision rate: per pair of independent unselected keys, at first order, reported for nucleotide and amino-acid keys.
- Group purity and coverage: per labelled record of an epitope database, with groups formed from sequences alone; purity is normalised by the labelled records in groups of size at least two.
- Cross-clone merge rate: per predicted clonotype of size at least two.
- Change fraction: per cell with at least one productive chain pair.

**Assumptions and failure modes.** Identity rules assume complete, productive chains; sequencing errors split true clones, partial capture yields singletons, and dual-chain cells can join two clonotypes. Distance graphs assume that a distance below $t$ means common ancestry or shared specificity; chaining merges unrelated receptors, and a fixed $t$ is stricter for common CDR3 keys and looser for rare ones. Linking across donors merges convergent receptors unless donors are blocked. TCR chains do not undergo somatic hypermutation, so clone members are expected to be identical [R1]; the B-cell case has different truth and is a separate task (immune-repertoire.bcr_clonal_family_inference).

**Why heuristics work and what a model adds.** Within a donor, identity matches are informative when E5 is small compared with the observed matches. Distance rules recover receptors that differ by error or by conservative substitutions, which identity misses, at the cost of chaining and an uncalibrated cutoff. A model-based definition estimates $\Pr[\text{same clone}\mid x,y]$ with E4 and E7 as its null. That turns the cutoff into a chosen false-match rate and gives per-pair uncertainty. Its identity limit is the heuristic default, so the two can be compared directly.

**Derived pitfalls.** Because E4 and E5 are first order, counts shaped by selection or expansion are not chance-corrected. E6 means amino-acid grouping cannot be more specific than nucleotide grouping. E8 means counts from different sample sizes are not comparable. No accepted benchmark of clonotype calling exists, so these pitfalls are derived from the equations, and section 8 proposes tests for them.

**Complexity.** Identity grouping is one hash pass over the cells, expected $O(n)$. Thresholded graphs need pairwise comparisons, $O(n^2)$ per chain when naive, reduced by length buckets and donor blocks.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Exact CDR3 nucleotide identity (scirpy `define_clonotypes`) | heuristic | Connected components of cells whose primary chains have identical CDR3 nucleotide sequences under the chosen receptor and dual-chain rules | [R5] |
| Exact CDR3 amino-acid identity (scirpy `define_clonotype_clusters`, `sequence="aa"`) | heuristic | The same rule on amino-acid CDR3 | [R5] |
| Hamming and Levenshtein distance graphs (scirpy) | heuristic | A CDR3 distance at or below a cutoff links cells; chains combined by maximum or minimum; partitioned into connected components, Leiden or fastgreedy modules | [R5] |
| TCRdist (scirpy implementation) | heuristic | BLOSUM62-based CDR3 alignment distance with capped mismatch cost, gap penalties and terminal trimming; a cutoff defines neighbourhoods | [R6] |
| Cell Ranger clonotype key | heuristic | Sorted set of chain-prefixed CDR3 nucleotide sequences from productive, full-length, high-confidence single-chain contigs; V and J are not in the key | repository, section 12 |
| immunarch public-clone key | heuristic | CDR3 amino acid plus V gene (`pubRep` default `aa+v`) | repository, section 12 |

The published standard is the best-practices rule [R1]: primary α and β CDR3 nucleotide identity, unassigned without both chains, and no merging across donors. scirpy implements the identity and distance rules [R5], and its documentation states that the default weight, gap penalty, ntrim and ctrim reproduce the original TCRdist distance [R6]. Cell Ranger and immunarch are comparators for their own keys.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| scirpy chain combination | `receptor_arms` | max for all, min for any | `src/scirpy/tl/_clonotypes.py:28-29` @998c66a (docstring) |
| scirpy `define_clonotypes` | `sequence`, `metric` | nt, identity (set by the call) | `src/scirpy/tl/_clonotypes.py:416-417` @998c66a |
| scirpy `define_clonotype_clusters` | `sequence`, `metric` | aa, identity | `src/scirpy/tl/_clonotypes.py:196-197` @998c66a |
| scirpy `define_clonotype_clusters` | `receptor_arms`, `dual_ir` | all, any | `src/scirpy/tl/_clonotypes.py:198-199` @998c66a |
| scirpy `define_clonotype_clusters` | `same_v_gene`, `same_j_gene` | False, False | `src/scirpy/tl/_clonotypes.py:200-201` @998c66a |
| scirpy `define_clonotype_clusters` | `within_group` | receptor_type (no donor constraint) | `src/scirpy/tl/_clonotypes.py:202` @998c66a |
| scirpy `define_clonotype_clusters` | `partitions`, `resolution`, `n_iterations` | connected, 1, 5 | `src/scirpy/tl/_clonotypes.py:204-206` @998c66a |
| scirpy `define_clonotype_clusters` | `chunksize` | 2000 | `src/scirpy/tl/_clonotypes.py:210` @998c66a |
| scirpy identity distance | cutoff | 0 (argument ignored) | `src/scirpy/ir_dist/metrics.py:285-287` @998c66a |
| scirpy Hamming | `cutoff`, `normalize` | 2, False | `src/scirpy/ir_dist/metrics.py:607`, `:609` @998c66a |
| scirpy Levenshtein | `cutoff` | 2 | `src/scirpy/ir_dist/metrics.py:338` @998c66a |
| scirpy GPU Hamming (`gpu_hamming`) | `cutoff` | 2 | `src/scirpy/ir_dist/metrics.py:828` @998c66a (class at `:774`) |
| scirpy TCRdist | `cutoff` | 20 | `src/scirpy/ir_dist/metrics.py:1331` @998c66a |
| scirpy TCRdist | `dist_weight`, `gap_penalty`, `ntrim`, `ctrim` | 3, 4, 3, 2 | `src/scirpy/ir_dist/metrics.py:1333-1336` @998c66a |
| scirpy TCRdist | `fixed_gappos`, `base_matrix` | True, blosum62 | `src/scirpy/ir_dist/metrics.py:1337`, `:1341` @998c66a |
| scirpy TCRdist | `distance_cap` | 4 with blosum62; none with tcrblosum | `src/scirpy/ir_dist/metrics.py:1357-1359`, `:1381` @998c66a |
| Cell Ranger | clonotype key | sorted unique `<chain>_<CDR3 nt>` over productive, full-length, high-confidence single-chain contigs | `lib/python/cellranger/vdj/annotations.py:1390-1412`; `:560-563` and `:580-584` @669395e |
| immunarch | `pubRep` `.col` | aa+v | `R/v0_public.R:57` @274afb2 |
| immunarch | `repOverlap` `.col` | aa | `R/v0_overlap.R:104-107` @274afb2 |

## 5. Proposed singlet approach

**Routes.** Port: `identity_nt`, `identity_aa`, `hamming`, `levenshtein` and `tcrdist`, reimplemented from the scirpy rules and defaults in section 4 under the licences in section 12. Callout: the Cell Ranger key and the immunarch key are comparators only and are not enum values.

**Default.** `identity_nt` with `receptor_arms` all, `dual_ir` primary_only and `within_group` donor_id. The primary pair is the most abundant pair by UMI, matching scirpy's documented `primary_only` option. Cells without a productive pair of both types are unassigned, as in [R1]. These defaults differ from scirpy's `define_clonotypes` on `dual_ir` and donor scope, so every output records its rule in `uns/clone_definition`. The MCP defaults are in section 6.

**Proposed model-based method (not in the enum).** A same-clone posterior $\Pr[\text{same clone}\mid x,y]$ combines an exact-match likelihood over CDR3 keys, with E4 and E7 as the null, V/J concordance and pairing status. It reduces to identity at zero sequencing error and zero dropout. It joins the enum only if, on B1, its false-match rate at each stated level stays within 0.01 of that level and its pairwise F1 at zero error is no lower than identity's (proposed). It is falsified if either condition fails.

**ML stack.** Identity rules need no training. A learned CDR3 encoder for the posterior would use PyTorch with a classification or contrastive objective on the planted labels of B1. Hard-coded CUDA is limited to the block-wise pairwise distance kernel with a cutoff, following the design of scirpy's GPU Hamming calculator (section 4). Hashing of CDR3 keys stays on the CPU.

**Core kernels and devices.** Chunked key hashing, in which the table holds distinct keys across chunks; length bucketing; donor-blocked distance computation; a sparse thresholded graph in CSR form; union-find for connected components; seeded Leiden partitions. Identity executes on CPU, and distance blocks execute on CPU or CUDA. Identity memory is linear in distinct keys; distance-graph memory is set by the largest donor block and its neighbour count.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obs/tcr_alpha_cdr3_nt, obs/tcr_beta_cdr3_nt | string | CDR3 nucleotide of the primary chains; the primary pair is keyed |
| read | obs/tcr_alpha_cdr3_aa, obs/tcr_beta_cdr3_aa | string | CDR3 amino acid, used by amino-acid and distance methods |
| read | obs/tcr_alpha_v, obs/tcr_alpha_j, obs/tcr_beta_v, obs/tcr_beta_j | categorical | V and J calls, used by `gene_match` |
| read | obs/tcr_alpha_productive, obs/tcr_beta_productive | bool | only productive chains are keyed |
| read | obs/tcr_alpha_umis, obs/tcr_beta_umis | int | rank chains to choose the primary pair |
| read | obs/donor_id | categorical | blocking column for `within_group` |
| read | obsp/tcr_distance | sparse float | optional precomputed distance, used when present and matching the method |
| write | obs/clone_id | categorical | clonotype label; missing when unassigned |
| write | obs/clone_size | int | number of cells carrying the label |
| write | obs/clone_status | categorical | paired, single_chain or multichain |
| write | obsp/clone_graph | sparse bool | thresholded cell graph, written for distance methods |
| write | uns/clone_definition | dict | method, sequence, cutoff, receptor_arms, dual_ir, gene_match, within_group, partitions, seed, filters, singlet version, input hash |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "identity_nt" | `identity_nt`, `identity_aa`, `hamming`, `levenshtein`, `tcrdist` | identity_nt is the default; hamming, levenshtein and tcrdist are amino-acid distance graphs and need cutoff. |
| `receptor_arms` | string | "all" | `VJ`, `VDJ`, `all`, `any` | Chains that must match; all combines chain distances by maximum, any by minimum. |
| `dual_ir` | string | "primary_only" | `primary_only`, `all`, `any` | Chain pairs considered per cell; primary_only uses the most abundant pair by UMI count. |
| `gene_match` | object | — | — | Gene constraints on links. |
| `gene_match.same_v_gene` | boolean | false | — | Require identical V genes for linked cells. |
| `gene_match.same_j_gene` | boolean | false | — | Require identical J genes for linked cells. |
| `within_group` | array | ["donor_id"] | — | Columns that must match for two cells to be linked; donor_id blocks cross-donor merging. |
| `cutoff` | integer/null | null | min 0; max 255 | Maximum distance counted as a match; null uses 2 for hamming and levenshtein, 20 for tcrdist; refused for identity methods. |
| `graph` | object | — | — | Graph partitioning options for distance methods. |
| `graph.partitions` | string | "connected" | `connected`, `leiden`, `fastgreedy` | Partition of the thresholded graph; connected is the default and does not use seed. |
| `graph.resolution` | number | 1 | — | Leiden resolution; ignored unless partitions is leiden. |
| `graph.n_iterations` | integer | 5 | min 1 | Leiden iterations; ignored unless partitions is leiden. |
| `seed` | integer | 0 | — | Random seed for Leiden partitions; no effect otherwise. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Parameters apply as follows. `method` selects the rule; `receptor_arms`, `dual_ir`, `gene_match` and `within_group` apply to all methods. `cutoff` applies only to hamming, levenshtein and tcrdist, and a non-null value with an identity method is refused. `graph` applies only to distance methods, and `seed` matters only when `graph.partitions` is leiden. `cutoff` is an integer from 0 to 255, the limit of scirpy's uint8 distance storage. `clone_status` is multichain when more than one productive chain of a type is present, otherwise paired when both primary chains are present and single_chain when one is; the label is keyed on the primary pair in every case.

## 7. MCP tool

Tool name `singlet_immune_repertoire_tcr_clonotype_definition` (definition in `tasks/mcp/singlet_immune_repertoire_tcr_clonotype_definition.json`). Example call and compact result:

```json
{"dataset": "tcr_cohort.singlet", "method": "identity_nt", "receptor_arms": "all", "dual_ir": "primary_only", "within_group": ["donor_id"]}
{"dataset": "tcr_cohort.singlet", "status": "completed", "wrote": ["obs/clone_id", "obs/clone_size", "obs/clone_status", "uns/clone_definition"],
 "summary": {"n_cells": "<int>", "n_assigned": "<int>", "n_clonotypes": "<int>", "n_multichain": "<int>", "rule": "identity_nt; all; primary_only; donor_id"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: identity methods finish inline, and distance graphs above a cell count set by P1 return `queued`. Stochastic: only `graph.partitions` leiden uses `seed`. Dry run: returns estimated seconds, peak memory and device from the cell count, the CDR3 length distribution and the cutoff.

## 8. Benchmarks

**Shared protocol.** Cells enter a comparison only if they pass the same QC filter, which requires productive chains and is part of the reported rule. Each rule uses its documented defaults and seed 0 unless a benchmark states otherwise. Pairwise metrics use unordered pairs of included cells, and cells with a missing chain are reported separately rather than dropped silently. Tied distances are kept, not broken at random. Acceptance thresholds marked proposed are design choices for this document; none is taken from the literature.

### B1. Planted-clone recovery in simulated repertoires

- **Goal**: recover clone membership of planted expansions under controlled sequencing error and chain dropout.
- **Ground truth**: planted simulation. Each planted cell carries its clone's generation label, and background cells carry unique labels. The estimand is the same-clone indicator over unordered pairs of cells with both chains, normalised by the number of pairs.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated alpha-beta repertoires from the recipe below | generator recipe, immuneSIM family [R12] | simulated TCR pairs; species —; size set by the grid | not applicable | parameters archived with each result |

- **Generator recipe**
  1. Draw $N$ unselected alpha-beta pairs from a V(D)J generation model of the immuneSIM family [R12]; archive its parameters, which set the background collisions of E4.
  2. Plant clones: draw sizes $k_c$ from a fixed distribution and copy one receptor pair to $k_c$ cells.
  3. Apply independent substitutions to CDR3 nucleotides at per-base rate $e$, then translate.
  4. Remove each chain independently with probability $d$.
  5. Use a fixed grid of $e$ and $d$, 20 seeds per setting, and the same V/J background for all comparators.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pairwise F1 | Harmonic mean of precision $\mathrm{TP}/(\mathrm{TP}+\mathrm{FP})$ and recall $\mathrm{TP}/(\mathrm{TP}+\mathrm{FN})$ over unordered pairs with both chains | higher | primary | — |
| Adjusted Rand index | Predicted against planted labels; unassigned cells counted as singletons | higher | guardrail | — |
| Cross-clone merge rate | Fraction of predicted clonotypes of size at least 2 with cells from more than one planted clone | lower | guardrail | — |

- **Comparators**: `identity_nt` and `identity_aa`; `hamming` and `levenshtein` at cutoff 2; `tcrdist` at cutoffs 20 and 15 (the best-practices specificity cutoff [R1]); scirpy at 998c66a.
- **Protocol**: mean and spread over seeds; report $e$, $d$, the planted sizes and the background collision rate of E4.
- **Acceptance criterion** (proposed): (a) at $e=0$ and $d=0$, every identity setting has pairwise precision of at least 0.99; (b) at the highest grid error, `identity_nt` recall is below 0.9 while a distance setting keeps recall at least 0.95 with a cross-clone merge rate of at most 0.01.
- **Known pitfalls**: a simulator error model that matches TCRdist's substitution matrix favours the distance comparators. Without step 1's background collisions, precision is overstated.

### B2. Parity with the reference rule on the same cells (proposed)

- **Goal**: show that `identity_nt` reproduces the partition of scirpy's `define_clonotypes` on identical input.
- **Ground truth**: consistency. The label is the reference rule's clone label for each cell. The estimand is the co-membership of each pair of cells, compared one to one with the reference and normalised by the number of pairs.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Paired TCR and gene-expression data of Stephenson et al., as QC-filtered for the best-practices chapter | [R15]; ArrayExpress E-MTAB-10026; chapter artifact `stephenson2021_tcr_qc` [R1] | human scRNA-seq with TCR; COVID-19 patients of several severity groups and healthy donors; size — | — | see section 10 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Discordant pairs | Pairs co-clustered in one partition and not in the other | 0 | primary | — |
| Adjusted Rand index | Between the singlet and reference partitions | 1.0 | primary | — |

- **Comparators**: scirpy `define_clonotypes` at 998c66a with `receptor_arms` all, `dual_ir` any and `within_group` receptor_type, which are its defaults; singlet `identity_nt` with the same three settings.
- **Protocol**: one cell table and one QC filter for both tools; comparison cell by cell; no other setting differs.
- **Acceptance criterion** (proposed): zero discordant pairs and an adjusted Rand index of 1.0 against the reference under matched settings. Any discordant pair is a defect in the port.
- **Known pitfalls**: `dual_ir` and the grouping column change membership even when the rule is identical, so both are fixed in the comparison. A QC filter that differs between tools changes membership.

### B3. Epitope-label purity of receptor groups (proposed)

- **Goal**: test whether a definition groups receptors that share antigen specificity.
- **Ground truth**: expert labels. Each database record carries a curated epitope, and groups are formed from sequences alone, so the label is independent of the grouping. The estimand per record is epitope membership; purity is the majority-epitope count summed over groups of size at least two, divided by the labelled records in those groups.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| VDJdb human TCR records, release pinned as in the chapter | [R13], [R14]; harmonised through IggyTop [R1] | human TCR alpha and beta amino-acid CDR3 with epitope and MHC class; size — | — | release fixed before the benchmark |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Group purity | Summed majority-epitope count over groups of size at least 2, divided by single-epitope labelled records in those groups | higher | primary | — |
| Coverage | Single-epitope labelled records in groups of size at least 2, divided by all single-epitope labelled records | higher | primary | — |
| Cross-MHC-class group fraction | Fraction of groups with epitopes annotated to both MHC class I and class II | lower | guardrail | — |

- **Comparators**: `identity_aa`; `hamming` at cutoffs 1 and 2; `levenshtein` at cutoff 2; `tcrdist` at cutoffs 15 (chapter value [R1]) and 20 (scirpy default) with `same_v_gene` true.
- **Protocol**: each definition applied to the same records with the same settings; no threshold tuned on labels; results reported per antigen (for example CMV, EBV and influenza, where present), with multi-epitope records reported as a count.
- **Acceptance criterion** (proposed): a distance definition is preferred over `identity_aa` only if its purity is at least 0.9, its coverage is at least 20% above identity's, and its purity is no lower than identity's.
- **Known pitfalls**: a few antigens dominate the database, so purity can reflect the antigen mix. Gene names must agree between database and data, or matches fail silently.

### B4. Membership change between dual-chain rules (descriptive)

- **Goal**: measure how much clonotype membership changes between dual-chain rules on real paired data.
- **Ground truth**: consistency only, with no truth assumed. The estimand is the fraction of cells whose label differs between two rules, normalised by cells with at least one productive chain pair. The multichain fraction is the fraction of cells with more than one productive chain of a type.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Paired TCR and gene-expression data of Stephenson et al. (as in B2) | [R15]; chapter artifact `stephenson2021_tcr_qc` [R1] | human scRNA-seq with TCR; size — | — | as in B2 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Change fraction | Cells whose label differs between `primary_only` and `any`, over cells with at least one productive pair | reported descriptively | primary | — |
| Multichain fraction | Cells with more than one productive chain of a type, over all cells | reported descriptively | guardrail | — |

- **Comparators**: `dual_ir` set to primary_only, any and all, each with `identity_nt`, `receptor_arms` all and donor blocking.
- **Protocol**: all three rules applied to one QC-filtered table. Report both fractions for each rule and the number of multichain cells.
- **Acceptance criterion**: descriptive, with no threshold. The result must state the multichain fraction and the change fraction for each rule.
- **Known pitfalls**: dual-TCR biology and doublets cannot be separated without external labels [R3]. The primary pair depends on UMI counts, so changes in counting shift membership.

### P1. Performance and scaling

Wall time, peak resident memory and throughput in cells per second at $10^4$, $10^5$ and $10^6$ cells on CPU and, for distance blocks, on CUDA. Comparators: scirpy `define_clonotypes`; scirpy `define_clonotype_clusters` with hamming, levenshtein and tcrdist; scirpy's GPU Hamming calculator where a GPU is available (section 4); and the singlet implementation. Hold fixed: the CDR3 length distribution, cutoff, thread count, hardware, QC filter and seed 0. Repeat each setting and report the spread. Use $10^7$ cells only for identity methods. Identity time is expected to grow near-linearly in cells, and distance time depends on bucket size and cutoff, so both are recorded.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `immune-repertoire.receptor_contig_assembly`: Full-length TCR/BCR contig assembly from scRNA-seq reads
  - `immune-repertoire.vdj_gene_annotation`: V(D)J gene assignment and CDR3 annotation of receptor sequences
  - `immune-repertoire.chain_pairing_dual_receptor_calling`: Chain pairing and dual-receptor calling per cell
- **Feeds**:
  - `immune-repertoire.repertoire_diversity_expansion`: Repertoire diversity and clonal expansion estimation
  - `immune-repertoire.differential_clonal_expansion`: Differential clonal expansion and responding-clone detection
  - `immune-repertoire.repertoire_overlap_public_clones`: Repertoire overlap and public clonotype detection
  - `immune-repertoire.tcr_specificity_group_discovery`: TCR specificity-group discovery
- **Reads**: `obs/tcr_alpha_cdr3_nt`, `obs/tcr_beta_cdr3_nt`, `obs/tcr_alpha_cdr3_aa`, `obs/tcr_beta_cdr3_aa`, `obs/tcr_alpha_v`, `obs/tcr_alpha_j`, `obs/tcr_beta_v`, `obs/tcr_beta_j`, `obs/tcr_alpha_productive`, `obs/tcr_beta_productive`, `obs/tcr_alpha_umis`, `obs/tcr_beta_umis`, `obs/donor_id`, `obsp/tcr_distance`
- **Writes**: `obs/clone_id`, `obs/clone_size`, `obs/clone_status`, `obsp/clone_graph`, `uns/clone_definition`
<!-- CHAINING:AUTO:END -->

Follows chain pairing and contig annotation in the receptor workflow, and precedes clonal expansion, repertoire overlap and specificity grouping.

## 10. Risks, pitfalls and open questions

- **Indirect sources.** The TCRdist definition here is scirpy's implementation, whose documentation states that the default weight, gap penalty, ntrim and ctrim reproduce the original distance [R6]. ALICE [R11] is not benchmarked. No public-clone or HLA-association benchmark is defined here.
- **Claims from secondary text.** The statement that TCRdist grouped receptors by epitope at least as well as other clustering methods and protein language models [R7, R8] is the chapter's summary [R1]. The convergent-recombination statement of [R2] rests on its title.
- **Missing identifiers.** The sample size and licence of the Stephenson et al. data [R15] are not given; the accession E-MTAB-10026 is the one used by the chapter's data preparation [R1]. No size is given for the VDJdb release [R13, R14].
- **Dropped comparators.** Cell Ranger parity is not benchmarked because no contig table with Cell Ranger annotations is available here; its key is defined by its code. enclone, MiXCR and the ALICE rule are not compared. The tcrBLOSUM matrix is available through scirpy but is not in the enum.
- **Benchmark design risks.** A per-base substitution rate of 0.5 is far above typical sequencing error, and at that level every rule fails, so the error grid must come from measured platform error rates. Generator parameters, including the generation model of B1, must be fixed and archived before any result is reported. B4 has no known multichain truth, so doublet effects need external labels.
- **Unsettled literature and first experiment.** No benchmark compares nucleotide and amino-acid calling, and no published cutoff is calibrated to a false-match rate. First experiment: (1) implement `identity_nt` and reproduce B2 on the Stephenson table; (2) check E5 and E7 by sampling from the generator at B1 sizes; (3) evaluate the B1 grid at error rates measured on the platform.

## 11. References

R1. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R2. Venturi V, Kedzierska K, Price DA, et al. Sharing of T cell receptors in antigen-specific responses is driven by convergent recombination. *Proceedings of the National Academy of Sciences* 2006. doi:10.1073/pnas.0608907103 — verified (corpus)
R3. Schuldt NJ, Binstadt BA. Dual TCR T cells: identity crisis or multitaskers? *The Journal of Immunology* 2019. doi:10.4049/jimmunol.1800904 — verified (corpus)
R4. Stubbington MJT, Lönnberg T, Proserpio V, et al. T cell fate and clonality inference from single-cell transcriptomes. *Nature Methods* 2016. doi:10.1038/nmeth.3800 — verified (corpus)
R5. Sturm G, Szabo T, Fotakis G, et al. Scirpy: a Scanpy extension for analyzing single-cell T-cell receptor-sequencing data. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa611 — verified (corpus)
R6. Dash P, Fiore-Gartland AJ, Hertz T, et al. Quantifiable predictive features define epitope-specific T cell receptor repertoires. *Nature* 2017. doi:10.1038/nature22383 — verified (corpus)
R7. Hudson D, Lubbock A, Basham M, Koohy H. A comparison of clustering models for inference of T cell receptor antigen specificity. *ImmunoInformatics* 2024. doi:10.1016/j.immuno.2024.100033 — verified (corpus)
R8. Nagano Y, Pyo AGT, Milighetti M, et al. Contrastive learning of T cell receptor representations. *Cell Systems* 2025. doi:10.1016/j.cels.2024.12.006 — verified (corpus)
R9. Postovskaya A, Vercauteren K, Meysman P, Laukens K. tcrBLOSUM: an amino acid substitution matrix for sensitive alignment of distant epitope-specific TCRs. *Briefings in Bioinformatics* 2024. doi:10.1093/bib/bbae602 — verified (corpus)
R10. Elhanati Y, Murugan A, Callan CG Jr, Mora T, Walczak AM. Quantifying selection in immune receptor repertoires. *Proceedings of the National Academy of Sciences* 2014. — verified (corpus)
R11. Pogorelyy MV, Minervina AA, Shugay M, et al. Detecting T cell receptors involved in immune responses from single repertoire snapshots. *PLoS Biology* 2019;17(6):e3000314. doi:10.1371/journal.pbio.3000314 — verified (search)
R12. Weber CR, Akbar R, Yermanos A, et al. immuneSIM: tunable multi-feature simulation of B- and T-cell receptor repertoires for immunoinformatics benchmarking. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa158 — verified (corpus)
R13. Shugay M, Bagaev DV, Zvyagin IV, et al. VDJdb: a curated database of T-cell receptor sequences with known antigen specificity. *Nucleic Acids Research* 2018. — verified (corpus)
R14. Bagaev DV, Vroomans RMA, Samir J, et al. VDJdb in 2019: database extension, new analysis infrastructure and a T-cell receptor motif compendium. *Nucleic Acids Research* 2020. doi:10.1093/nar/gkz874 — verified (corpus)
R15. Stephenson E, Reynolds G, Botting RA, et al. Single-cell multi-omics analysis of the immune response in COVID-19. *Nature Medicine* 2021. doi:10.1038/s41591-021-01329-2 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scirpy | Gregor Sturm and Tamas Szabo (authors); Gregor Sturm (maintainer); LICENSE also names Francesca Finotello | BSD 3-Clause (LICENSE; pyproject.toml) | reference rules for identity, distance and TCRdist; B2 comparator | port |
| https://github.com/agartland/pwseqdist | Andrew Fiore-Gartland | MIT (LICENSE; setup.py) | origin of the TCRdist code reused in scirpy | port, MIT notice retained |
| https://github.com/10XGenomics/cellranger | 10x Genomics (copyright holder) | Custom 10x Genomics licence (LICENSE): MIT-like grant limited to internal use with 10x Genomics products or data generated with them; no redistribution or sublicensing | Cell Ranger clonotype key; comparator only | callout (no code reused) |
| https://github.com/immunomind/immunarch | Vadim I. Nazarov (maintainer); Vasily O. Tsvetkov, Aleksandr A. Popov, Ivan Balashov (authors) | Apache-2.0 (LICENSE; DESCRIPTION) | aa+V public-clone key; comparator only | callout |
| https://github.com/theislab/single-cell-best-practices | Heumos et al. (book authors); Theislab (copyright 2021) | Apache-2.0 (LICENSE) | source of the clonotype rule and the benchmark cutoffs and data artifact keys | callout (rule used as the standard for B1 and B3 comparators) |
