---
id: ingest-quant.umi_deduplication
title: UMI deduplication and molecule collapsing
area: ingest-quant
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [ingest-quant.barcode_umi_extraction, ingest-quant.barcode_whitelist_correction, ingest-quant.read_to_gene_mapping]
feeds: [qc.low_quality_cell_detection, cell-calling.cell_vs_empty_droplet_calling, normalization.count_noise_model_selection, ingest-quant.spliced_unspliced_counting]
reads: [uns/ingest_geometry, uns/ec_incidence]
writes: [layers/counts_molecules, obs/umi_distinct_raw, obs/umi_dedup_rate, uns/umi_dedup_run, uns/umi_read_to_molecule]
devices: [cpu, cuda]
mcp_tool: singlet_ingest_quant_umi_deduplication
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# UMI deduplication and molecule collapsing

> Collapses UMI-tagged reads that share a cell, a gene-compatibility class and a sequence-close UMI into one molecule each, so that the count per cell and gene is not inflated by PCR duplicates or UMI sequencing errors.

## 1. Question

Which reads that share a corrected cell barcode and a gene-compatibility class, once sequencing errors in the UMI are allowed for, derive from one pre-amplification molecule? The input is a read table with UMI sequences and read counts; the output is an integer molecule count per cell and feature, optionally with a read-to-molecule map. A correct answer estimates the number of distinct captured molecules, with error-derived UMIs merged into their parent molecule and distinct molecules kept apart.

## 2. Why this task matters and where the field stands

UMIs convert read counts into molecule counts by tagging each molecule before amplification [R18]. Counting distinct UMIs is correct only if each UMI is read without error and no two molecules share one. Neither holds. Sequencing errors create extra UMIs one mismatch away from a true one, and short UMIs collide. Collapsing is therefore a required step, and the rule chosen changes gene-level counts [R1][R2].

The status is **contested**. No single benchmark isolates the UMI step on real data. Indirect end-to-end comparisons find that preprocessing choice matters less for clustering than later analysis steps, while workflows differ in gene detection and quantification [R12]. Cell-line mixtures with known composition [R13] and molecular spike-ins with known counts [R14] are the nearest orthogonal evidence; the spike-in study reports overcounting from inflated UMI counts.

Open problems, each unresolved in the sources reviewed:

- Divergent collisions: one molecule tagged by several UMIs from different priming sites, most visibly in intronic reads [R19][R20].
- Convergent collisions at high depth or with short UMIs (for example 10 bp) under-count, and their rate on real data is not measured.
- Multi-gene classes: discarding, winner-take-all and EM give different gene counts for paralogous families [R5]. Gene allocation itself belongs to ingest-quant.multi_gene_read_assignment; this task reports allocation only where the collapse method couples the two.
- Indel errors in long-read UMIs are invisible to Hamming-based graphs, and no real-data benchmark of edit-distance clustering is established.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $L$, $M=4^{L}$ | UMI length in bases; size of the UMI space |
| $N$, $D$ | Molecules tagged in one cell and feature; distinct observed UMIs |
| $c_u$ | Read count of UMI $u$ within a group |
| $\varepsilon$ | Per-base sequencing error probability |
| $\kappa$, $\delta$ | Parent-to-child count ratio and offset of the directional rule |
| $G_e$, $\theta_g$ | Gene set of compatibility class $e$; molecule count of gene $g$ |

**Occupancy.** If $N$ molecules of one feature in one cell each carry an independent uniform UMI, the expected number of distinct UMIs is

$$\mathbb{E}[D] = M\left(1-\left(1-\tfrac{1}{M}\right)^{N}\right).$$

This holds for uniform, independent UMIs and no error. For $N \ll M$ it gives $\mathbb{E}[D]\approx N-N(N-1)/(2M)$, so the expected number of colliding molecule pairs is $N(N-1)/(2M)$; at $L=10$ and $N=1{,}000$ this is about 0.5. Errors inflate $D$, so uncorrected distinct counts overestimate $N$.

Inverting the relation gives a method-of-moments estimator of the molecule number,

$$\hat N = \frac{\ln(1-D/M)}{\ln(1-1/M)} \approx -M\ln\!\left(1-\tfrac{D}{M}\right),$$

valid only for $D<M$ and only after error-derived UMIs have been merged. It diverges as $D\to M$, so it is usable only when the UMI space is much larger than the molecule count.

**Errors.** Under independent per-base substitutions with probability $\varepsilon$, the probability that a read of UMI $u$ shows exactly one mismatch is

$$P\bigl(d_H(\tilde u,u)=1\bigr)=L\varepsilon(1-\varepsilon)^{L-1}\approx L\varepsilon.$$

This follows from the substitution-only model and is not a published result. At $L=12$ and $\varepsilon=0.01$ it is about 0.11. A molecule read ten times therefore yields about one extra distinct UMI on average, and raw distinct counts can roughly double. Indels, base-specific error and quality dependence lie outside this model.

**Direction.** The directional rule admits child $j$ into parent $i$ when

$$i\to j \iff d(u_i,u_j)\le\tau \ \wedge\ c_i\ge\kappa\,c_j-\delta,\qquad (\tau,\kappa,\delta)=(1,2,1)\ \text{for UMI-tools},\quad \delta=0\ \text{for STAR's 1MM\_Directional mode}.$$

This is a heuristic threshold, not a fitted likelihood. The UMI-tools adjacency builder applies it in both directions (defaults table, section 4), so two distance-one UMIs with one read each satisfy it both ways when $\delta=1$ and neither way when $\delta=0$. This drives the rules' difference at low depth.

The motivation in [R1] is empirical. An idealised reconstruction shows where the rule sits. With every copy doubling per cycle, an error in cycle $t$ creates a lineage holding a share $2^{-t}$ of the reads, so the child-to-parent ratio is $\eta_t = 2^{-t}/(1-2^{-t})$. The rule admits the merge when $\eta \le \tfrac12+\delta/(2c_i)$, about $\eta\le 1/2$ for large counts. This holds for $t\ge 2$ ($\eta_2=1/3$) and fails for $t=1$ ($\eta_1=1$) at counts above one, so first-cycle errors remain distinct molecules. Regime: deterministic doubling without loss; sampling noise spreads the ratios around these values.

**Multi-gene allocation.** For a compatibility class $e$ with gene set $G_e$, EM over molecule counts is

$$P(z_e=g\mid\theta)=\frac{\theta_g\,\mathbb 1[g\in G_e]}{\sum_{h\in G_e}\theta_h},\qquad \theta_g^{(t+1)}=\sum_e P\bigl(z_e=g\mid\theta^{(t)}\bigr).$$

Each class is one molecule and classes are independent. Fixed points are stationary points of the likelihood of class-to-gene allocations with proportions $\theta_g/\sum_h\theta_h$, reached from the starting values, and $\sum_g\theta_g$ equals the number of classes. Genes with unique classes are identifiable; length, fragment and error likelihoods are ignored; starting values matter on sparse cells.

**Estimands.** Each output and ground truth is defined as follows.

- `layers/counts_molecules` for cell $c$ and gene $g$ estimates the number of distinct captured molecules of $g$ in $c$; it is an unnormalised integer from the collapse, and the EM modes return expected counts $\theta_g$ per cell.
- $\hat N$ estimates the number of molecules tagged within one cell and feature before amplification, with no normalisation.
- In planted simulations $N_{cg}$ is the number of simulated molecules in $c$ whose true gene is $g$; errors are reported as $|\hat N_{cg}-N_{cg}|/N_{cg}$.
- In spike-ins the target is the known molecule number of spike $s$; the ratio of deduplicated count to that number is dimensionless.
- In mixtures the target is the partition of cells into cell lines, scored by adjusted Rand index without normalisation.

**Failure modes by method family.**

- Hamming-adjacency heuristics (UMI-tools, STAR 1MM modes, alevin-fry cr-like) cannot represent indel errors, and the STAR modes without a count condition (1MM_All and 1MM_CR) merge distinct molecules whose UMIs happen to lie one mismatch apart.
- Count-rule heuristics fail on first-cycle errors (ratio near 1) and on equal-count neighbours, as derived above.
- Winner-take-all resolution is sensitive to multi-gene ties, and parsimony switches strategy above a graph-size threshold, so gene-level counts depend on those choices.
- EM modes assume independence across classes and are sensitive to starting values on sparse cells.
- Discarding multi-gene UMIs biases sequence-similar families toward genes with unique reads.

**Why heuristics work, and what a model adds.** The count-ratio threshold works because, by the idealised argument above, error children from the second PCR cycle onward carry at least three times fewer reads than their parents; the rule is cheap and interpretable. A model-based formulation adds calibrated merge probabilities with uncertainty, reuse of an error profile across libraries with the same chemistry, and covariates such as base composition and base quality, which the reviewed tools largely ignore. Cross-cell Bayesian sharing [R7] applies a model-based correction to a neighbouring quantification problem. Its cost is an error model that a single library cannot identify without external calibration.

**Pitfalls shown by benchmarks.** Pipeline comparisons confound UMI resolution with mapping and barcode correction, so they cannot attribute differences to the collapse [R12][R13]. Consistency measures such as replicate correlation can rise when distinct molecules are merged, so they cannot reward accuracy by themselves. Spike-ins expose overcounting that workflow comparisons do not isolate [R14].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| UMI-tools directional | heuristic | Directed graph over UMIs in one cell and gene group; an edge at distance at most 1 when the parent count is at least 2c−1; children absorbed into parents | [R1] |
| STARsolo Exact | heuristic | Only exactly matching UMIs collapsed within a cell and gene | [R2] |
| STARsolo 1MM_All (default) | heuristic | All UMIs at distance 1 from each other collapsed within a cell and gene | [R2][R3] |
| STARsolo 1MM_Directional_UMItools | heuristic | UMI-tools directional rule, parent count at least 2c−1 | [R2] |
| STARsolo 1MM_Directional | heuristic | Same as the UMI-tools mode with the stricter parent count at least 2c | [R2] |
| STARsolo 1MM_CR | heuristic | Each UMI redirected to a distance-1 neighbour found by scanning the sorted UMI list from its end, with no count condition; documented as the CellRanger 2–4 algorithm | [R2] |
| STARsolo NoDedup | heuristic | No UMI collapse; every read counted | [R2] |
| alevin-fry cr-like | heuristic | Winner-take-all resolution over zero-distance UMIs per cell | [R5][R6] |
| alevin-fry parsimony | hybrid | Resolves partially unique graphs at edit distance 1; switches strategy above a node threshold | [R6] |
| alevin-fry cr-like-em, parsimony-em | hybrid | The collapse of the parent mode, with EM allocation of ambiguous molecules | [R6] |
| bustools count --umi-gene | heuristic | Gene-aware UMI collapse on BUS records; comparator | [R8][R9] |
| bustools umicorrect | heuristic | Directed UMI graph with collapse of subgraphs; comparator | [R8] |
| UMICollapse | heuristic | Rule-based collapse with n-gram and BK-tree neighbour search; comparator | [R10] |

The standard for gene-level collapse is the directional rule of [R1] and the STAR modes built from it. The STARsolo documentation states that its UMI deduplication follows CellRanger logic, and the Cell Ranger collapse is documented here only through 1MM_CR [R2]; [R4] describes the 10x Chromium platform. STARsolo is built on the STAR aligner [R3]. The alevin-fry modes are the graph and EM alternatives, and bustools and UMICollapse serve as comparators. Edit-distance clustering and amplification models are outside this table (section 10). The defaults below are the values that singlet ports or mirrors.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| UMI-tools directional | `--method` default | directional | umi_tools/Utilities.py:786 @ 79d8b81 |
| UMI-tools directional | `--edit-distance-threshold` default | 1 | umi_tools/Utilities.py:789-791 @ 79d8b81 |
| UMI-tools directional | edge inequality, both directions | parent ≥ 2·child − 1 | umi_tools/network.py:207,209 @ 79d8b81 |
| UMI-tools directional | substring index used above this group size | 25 UMIs | umi_tools/network.py:199 @ 79d8b81 |
| STARsolo | `--soloUMIdedup` default | 1MM_All | docs/STARsolo.md:425 @ b1edc12 |
| STARsolo 1MM_Directional | directional offset dirCountAdd | 0 (parent ≥ 2·child) | source/SoloFeature_collapseUMIall.cpp:165 @ b1edc12 |
| STARsolo 1MM_Directional_UMItools | directional offset dirCountAdd | −1 (parent ≥ 2·child − 1) | source/SoloFeature_collapseUMIall.cpp:169 @ b1edc12 |
| STARsolo 1MM_CR | redirect rule | distance-1 neighbour found by scanning the sorted list from its end; no count condition | source/SoloFeature_collapseUMIall.cpp:580-600 @ b1edc12 |
| alevin-fry | `--resolution` | required; no CLI default; enum default cr-like | src/main.rs:312-313 @ ad05742; src/quant.rs:85-86 @ ad05742 |
| alevin-fry cr-like, cr-like-em | `--umi-edit-dist` | 0 | src/main.rs:321-331 @ ad05742 |
| alevin-fry parsimony, parsimony-em | `--umi-edit-dist` | 1 | src/main.rs:321-331 @ ad05742 |
| alevin-fry parsimony, parsimony-em | `--large-graph-thresh` | 1000 nodes (0 for other modes) | src/main.rs:333-341 @ ad05742 |
| alevin-fry | `--small-thresh` | 100 reads; smaller cells use cr-like semantics | src/main.rs:343-345 @ ad05742 |

## 5. Proposed singlet approach

- **Routes.** Port the UMI-tools directional rule, the STAR 1MM and directional routines, and the alevin-fry resolution modes, keeping their notices. Callout only for Cell Ranger (its behaviour is taken from 1MM_CR, with no code reuse), bustools and UMICollapse, which serve as comparators; kb_python is cited for context only.
- **Method enum.** `nodedup`, `cr_1mm`, `directional_strict`, `directional_umitools`, `cr_like`, `cr_like_em`, `parsimony`, `parsimony_em`. The default `directional_umitools` applies to single-gene groups. Directional methods refuse multi-gene classes rather than discarding them silently, because discarding biases paralogue families. Ambiguous classes go to `cr_like_em` or `parsimony_em`.
- **Model-based formulation (proposed).** For a distance-one pair of parent $p$ and child $c$, the read share $s=c_c/(c_p+c_c)$ is a two-component mixture: sequencing errors give small shares by binomial thinning, and PCR errors give shares set by the error cycle $t$ (section 3). The posterior that $c$ is a child of $p$ replaces the hard inequality, and molecule counts are posterior-weighted. It enters the enum only after two falsifiers: it must beat the default on B1 V-measure and per-gene error at comparable runtime, and its merge probabilities must match planted merge frequencies within calibration bins.
- **Machine learning.** No deep network is needed. The mixture fit and a logistic merge model are small, so both are hard-coded CPU and CUDA kernels; PyTorch is reserved for a neural extension that a benchmark must justify.
- **Kernels.** UMIs are packed as 2-bit integers and sorted within each cell and feature group. The distance-one test is an XOR and a count-trailing-zeros check, as in STAR's 1MM routine; naive pairwise adjacency costs O(n²) for n distinct UMIs, and the packed test is constant time per pair. A substring index replacing all-pairs comparison must return identical edges. EM uses sparse class-by-gene products on the device with cuSPARSE.
- **Streaming and devices.** Cells are processed in batches, so memory is bounded by the largest group in a batch. CUDA must agree with the CPU reference on every enum method.
- **Defaults for an agent.** Method `directional_umitools`; `umi_length` and `umi_edit_distance` null; `count_ratio_factor` 2.0; `write_read_to_molecule` false. Call `dry_run` first on atlas-scale inputs. Use the -em modes only when `uns/ec_incidence` contains multi-gene classes.
- **Catalogue use.** Gene-level molecule priors for B1, and UMI pairs for the error model if raw reads are kept (section 10).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/ingest_geometry | dict | UMI length and position from ingest-quant.barcode_umi_extraction; used when `umi_length` is null. |
| read | uns/ec_incidence | sparse bool | Class-by-gene incidence from ingest-quant.read_to_gene_mapping; needed by the -em modes and for the multi-gene check. |
| read (parameter `parse_stream`) | none (sidecar) | per-read rows | Corrected cell barcode, UMI as 2-bit integer, class id and read count, one row per read. Not a `.singlet` member. |
| write | layers/counts_molecules | sparse int32 | Cell-by-feature molecule counts after collapse; expected counts for the EM modes; unnormalised. Sits beside `layers/counts` from the mapping task and never overwrites it. |
| write | obs/umi_distinct_raw | int32 | Distinct (feature, UMI) pairs per cell before collapse. |
| write | obs/umi_dedup_rate | float32 | Reads per molecule per cell: total reads divided by total molecules. |
| write | uns/umi_dedup_run | dict | Method, version, parameters, offsets, input digest, wall time and peak memory. |
| write | uns/umi_read_to_molecule | sparse int32 table | Per-read molecule id; written only when `write_read_to_molecule` is true. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `parse_stream` | string | required | — | Read table path or URI with one row per read: corrected cell barcode, packed UMI, class id and read count. |
| `method` | string | "directional_umitools" | `nodedup`, `cr_1mm`, `directional_strict`, `directional_umitools`, `cr_like`, `cr_like_em`, `parsimony`, `parsimony_em` | Collapse rule. directional_umitools is the default for single-gene groups; the -em modes resolve multi-gene classes. |
| `umi_length` | integer/null | null | min 4; max 32 | UMI length in bases; null reads it from uns/ingest_geometry. |
| `umi_edit_distance` | integer/null | null | min 0; max 2 | Maximum UMI Hamming distance; null uses the method default (0 for cr_like modes, 1 otherwise). Ignored by nodedup. |
| `write_read_to_molecule` | boolean | false | — | Also write per-read molecule assignments to uns/umi_read_to_molecule; large, so off by default. |
| `directional` | object | — | — | Options for directional_umitools and directional_strict. |
| `directional.count_ratio_factor` | number | 2.0 | min 1; max 4 | Parent-to-child count ratio kappa; the offset is fixed by method (1 for UMI-tools, 0 for strict). |
| `alevin_fry` | object | — | — | Options for the alevin-fry modes cr_like, cr_like_em, parsimony and parsimony_em. |
| `alevin_fry.large_graph_threshold` | integer/null | null | min 0 | Node count above which parsimony modes switch strategy; null uses 1000 for parsimony modes. |
| `alevin_fry.em_max_iter` | integer | 1000 | min 1 | Maximum EM iterations for the -em modes (singlet-proposed default). |
| `alevin_fry.em_tolerance` | number | 1e-06 | > 0 | EM convergence tolerance on the change in molecule counts (singlet-proposed default). |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`umi_length` and `umi_edit_distance` default to null, which reads the length from uns/ingest_geometry and applies the method default. `count_ratio_factor` applies only to the directional methods; the offset is fixed by the method (0 for strict, 1 for UMI-tools). The `alevin_fry` options apply to the alevin-fry modes: `large_graph_threshold` only to the parsimony modes, and the `em_*` options only to the -em modes. The `em_*` defaults are singlet's proposals. Validation refuses a read table whose UMI length disagrees with uns/ingest_geometry, and refuses multi-gene classes for the directional methods.

## 7. MCP tool

Tool name `singlet_ingest_quant_umi_deduplication` (definition in `tasks/mcp/singlet_ingest_quant_umi_deduplication.json`). Example call:

```json
{"dataset": "/data/example/library.singlet", "parse_stream": "/data/example/read_table", "method": "directional_umitools", "device": "auto"}
```

Example compact result (angle-bracket values are filled in by the tool):

```json
{
  "dataset": "/data/example/library.singlet",
  "status": "completed",
  "wrote": ["layers/counts_molecules", "obs/umi_distinct_raw", "obs/umi_dedup_rate", "uns/umi_dedup_run"],
  "summary": {"method": "directional_umitools", "umi_length": "<int>", "n_cells": "<int>", "n_molecules": "<int>", "reads_per_molecule_median": "<float>"},
  "provenance_id": "<id>",
  "job_id": null,
  "estimate": null
}
```

- **Long-running.** Atlas-scale read tables are queued, and the result then has `status` queued with a `job_id`.
- **Stochastic.** No. The EM starts from uniform $\theta$, so reruns are identical.
- **Dry run.** Returns `seconds`, `peak_memory_gb` and `device` from the read-table size, with no writes.

## 8. Benchmarks

Shared protocol. Each comparator receives identical read groups for a given setting, in its native input: BAM with UMI tags for UMI-tools, BUS records for bustools [R9], RAD for alevin-fry, and a full STARsolo run for STARsolo. Each method is applied with its default parameters, and sensitivity settings named in each benchmark are reported beside the default. Accuracy is computed per replicate over ten seeded replicates and reported as median and interquartile range. Thresholds are singlet's proposals; literature values are reported but not used as thresholds.

### B1. Planted-molecule simulation (proposed)

- **Goal**: recover founder molecules and per-gene molecule counts from simulated reads with substitution errors, PCR-like read multiplicity and multi-gene overlap.
- **Ground truth**: planted simulation. The simulator records founder ids, true genes and $N_{cg}$; the estimand is $N_{cg}$ (section 3), normalised as $|\hat N_{cg}-N_{cg}|/N_{cg}$ for $N_{cg}\ge 1$ and summarised by the median over pairs.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted-molecule simulations, 36 settings × 10 replicates | Recipe below; founder-based design related to UMI-nea [R16] (section 10) | Simulated UMI reads, no species; 360 simulated datasets | — | Grid: L ∈ {10, 12, 16}; ε ∈ {0.001, 0.005, 0.01, 0.02}; overlap ∈ {0, 0.05, 0.2} |

Recipe, proposed:

1. Draw $N_{cg}$ per cell and gene from a negative binomial with mean $\mu_{cg}$ (catalogue-derived) and dispersion $\phi$ fitted in the pilot.
2. Amplify each molecule into $k$ reads, $k$ geometric with mean 2 or 8.
3. Draw UMIs uniformly from $4^{L}$, and apply independent substitutions at rate $\varepsilon$ to each read.
4. Give the overlap fraction of molecules a random two-gene set that includes the true gene; write reads at gene loci for BAM input and record class ids for BUS and RAD input.
5. Keep founder ids, true genes and $N_{cg}$ as labels, and repeat with seeds 0 to 9.

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| V-measure against founder ids | Harmonic mean of homogeneity and completeness against founder labels, pooled over reads of a replicate | higher | primary | [R21] |
| Per-gene molecule error | Median over (cell, gene) pairs with $N_{cg}\ge1$ of $\lvert\hat N_{cg}-N_{cg}\rvert/N_{cg}$ | lower | primary | — |
| Founder count error | $\lvert\hat F-F\rvert/F$ for predicted molecule groups $\hat F$ and simulated founders $F$ | lower | guardrail | — |
| Runtime and peak memory | Wall time and peak RSS per million read groups | lower | guardrail | — |

- **Comparators**: alevin-fry at commit ad05742 (cr-like and parsimony-em); bustools at commit d4d7a28 (count --umi-gene and umicorrect, callout); UMI-tools at commit 79d8b81 (directional, overlap 0 only, because it collapses by position and performs no multi-gene allocation). Sensitivity: directional_umitools with κ ∈ {1.5, 3}. STARsolo is compared only in B2, because it needs FASTQ-level input.
- **Protocol**: the shared protocol over 36 settings and ten replicates.
- **Acceptance criterion** (proposed): at ε = 0.01 and L = 12, the default reaches V-measure ≥ 0.95 and per-gene error ≤ 0.05; on every grid cell it is at most 1% below the best comparator in V-measure.
- **Known pitfalls**:
  - Uniform UMIs, independent errors and geometric read multiplicity flatter occupancy- and Hamming-based rules; a held-out simulator family with base-biased UMIs is needed before claims of generality.
  - Founder labels exist only in simulation, and V-measure alone hides the direction of error, so founder count error is a required guardrail.

### B2. Molecular spike-ins (published design, proposed protocol)

- **Goal**: test whether a collapse recovers the known molecule numbers of synthetic barcoded spike RNAs, which exposes overcounting from UMI errors.
- **Ground truth**: orthogonal measurement. The known molecule number of each spike construct comes from the spike design. The estimand is the number of molecules of spike $s$ in a library; the normalisation is $r_s$, the deduplicated count of $s$ divided by its known molecule number, which is dimensionless. Spikes have no cell context, so all spikes of a library form one pseudo-cell.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Molecular spike pool | [R14] | Synthetic RNA constructs, no species; size as reported in the publication | — | The spiking protocol below is singlet's proposal |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Per-spike ratio | $r_s$; median, interquartile range and the fraction with $r_s\in[0.8,1.2]$ | closer to 1 | primary | [R14] |
| Length and GC dependence | Spearman correlation of $r_s$ with spike length and with GC content | absolute value closer to 0 | guardrail | — |

- **Comparators**: UMI-tools directional; STARsolo 1MM_All, 1MM_Directional_UMItools and 1MM_CR at commit b1edc12, each as a full run; alevin-fry cr-like and parsimony; bustools count --umi-gene (callout); Cell Ranger where its terms permit use (callout).
- **Protocol**: spike the pool into a cell-sized background at the designed molecule numbers and sequence with 3′ chemistry. Each comparator is applied to the same reads, with STARsolo through its own run and the others through the read table. Depth is fixed across comparators.
- **Acceptance criterion** (proposed): at least 0.9 of spikes have $r_s\in[0.8,1.2]$, and $|\rho|<0.3$ for both length and GC.
- **Known pitfalls**:
  - Spike UMIs may differ in base composition from endogenous UMIs, which changes collision and error rates; report endogenous UMI composition alongside.
  - Per-spike counts depend on depth and on 3′ versus full-length chemistry, so depth must be held fixed.

### B3. Cell-line mixture controls (indirect, end-to-end)

- **Goal**: test whether a workflow with a given collapse preserves the known cell-line structure of the mixtures.
- **Ground truth**: orthogonal measurement. Each cell carries the cell-line label of the mixture design. The estimand is the partition of cells into cell lines, with no normalisation; agreement is the adjusted Rand index.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Cell-line mixture controls | [R13] | scRNA-seq of cell-line mixtures; size as reported in the publication | — | Indirect: the collapse is confounded with mapping and barcode correction |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Adjusted Rand index | Clusters from one fixed downstream pipeline against the cell-line labels | higher | primary | [R13] |
| Per-gene agreement | Spearman correlation of per-gene totals between two workflows on the same cells | higher | guardrail | — |

- **Comparators**: the workflows of [R13] with the collapse replaced by UMI-tools directional, alevin-fry cr-like or parsimony-em, or STARsolo 1MM_CR. The collapse step varies while mapping and clustering are held fixed where the workflow allows.
- **Protocol**: one fixed clustering and downstream analysis across comparators; cell labels are unchanged.
- **Acceptance criterion** (proposed): ARI at or above the best comparator minus 0.02.
- **Known pitfalls**:
  - Composition is confounded with cell-line expression programmes, so an ARI gap can reflect mapping rather than collapse.
  - Batch and platform differences in the mixture data can dominate the comparison.

### P1. Performance and scaling

Wall time, throughput in read groups per second and peak memory for 10⁴, 10⁵, 10⁶ and 10⁷ cells (the last because streaming is claimed), at 10³ and 10⁴ distinct UMIs per cell and UMI lengths 10, 12 and 16 (proposed). Comparators: UMI-tools directional, alevin-fry cr-like and parsimony, bustools count and umicorrect, and UMICollapse. Hold fixed the thread count, memory limit, input format, whitelist, UMI length and feature set. Report peak RSS in GB, output size, and one setting with multi-gene ambiguity enabled, since EM and parsimony cost more. No numeric baseline is claimed. Speed statements in the UMICollapse README are self-reported and are checked under these conditions before use.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.barcode_umi_extraction`: Cell barcode and UMI extraction from raw reads
  - `ingest-quant.barcode_whitelist_correction`: Cell barcode correction (whitelist-based or inferred barcode set)
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
- **Feeds**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `normalization.count_noise_model_selection`: Count noise-model selection and zero-inflation diagnosis
  - `ingest-quant.spliced_unspliced_counting`: Spliced, unspliced and ambiguous molecule counting
- **Reads**: `uns/ingest_geometry`, `uns/ec_incidence`
- **Writes**: `layers/counts_molecules`, `obs/umi_distinct_raw`, `obs/umi_dedup_rate`, `uns/umi_dedup_run`, `uns/umi_read_to_molecule`
<!-- CHAINING:AUTO:END -->

Used in the gene-level counting stage of droplet 3′ and single-nucleus libraries; the same rule applies to feature-barcode counting.

## 10. Risks, pitfalls and open questions

- **Unread primary sources.** UMI-nea [R16] is a founder-based deduplication method that uses Levenshtein distance to handle indel errors; its evaluation is not characterised here and must be checked against the paper before any quantitative use. UMIche [R15] is a bioRxiv preprint whose platform bundles twelve deduplication methods and is not characterised here; Calib [R17], UMIc [R22] and UMI-nea [R16] have no located repository. None of these methods enters the enum. TRUmiCount [R11]'s paper and code are not characterised here, and it is excluded from the comparators.
- **Interface gap.** The mapping task's outputs contain no per-read UMI and class rows, so `parse_stream` needs an export that the mapping adapter does not yet provide. Whether the catalogue retains raw UMI and barcode reads is not established, which limits training of the error model to simulation and spike-ins.
- **Spike-in design.** The pool design, its size and its access terms come from secondary summaries [R14]. B2's protocol and pool details must be checked against the paper before B2 is used.
- **Unsettled literature.** Divergent collisions in intronic reads [R19][R20], convergent collisions at 10–12 bp, saturation correction and multi-gene allocation have no accepted solution. No real-data benchmark isolates the collapse step [R12][R13].
- **Technical and modelling risks.** The B1 simulator uses uniform UMIs, independent errors and geometric read multiplicity, which may favour the default's assumptions. Its μ and φ depend on catalogue fits not yet made. The PCR error cycle distribution in the model-based formulation needs planted or spike-in data to fit. Base qualities, which the reviewed tools largely ignore, have no validated error model.
- **First experiment.** Build the B1 simulator at L = 12 and ε = 0.01, and apply directional_umitools, cr_like and the model-based posterior to identical read tables, comparing V-measure and per-gene error. Fit μ and φ from catalogue data in the same step.

## 11. References

R1. Smith T, Heger A, Sudbery I. UMI-tools: modeling sequencing errors in Unique Molecular Identifiers to improve quantification accuracy. *Genome Research* 2017. doi:10.1101/gr.209601.116 — partial (corpus)
R2. Kaminow B, Yunusov D, Dobin A. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021. doi:10.1101/2021.05.05.442755 — partial (corpus)
R3. Dobin A, Davis CA, Schlesinger F, et al. STAR: ultrafast universal RNA-seq aligner. *Bioinformatics* 2013. doi:10.1093/bioinformatics/bts635 — partial (corpus)
R4. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — partial (corpus)
R5. Srivastava A, Malik L, Smith T, Sudbery I, Patro R. Alevin efficiently estimates accurate gene abundances from dscRNA-seq data. *Genome Biology* 2019. doi:10.1186/s13059-019-1670-y — partial (corpus)
R6. He D, Zakeri M, Sarkar H, Soneson C, Srivastava A, Patro R. Alevin-fry unlocks rapid, accurate and memory-frugal quantification of single-cell RNA-seq data. *Nature Methods* 2022. doi:10.1038/s41592-022-01408-3 — partial (corpus)
R7. Srivastava A, Malik L, Sarkar H, Patro R. A Bayesian framework for inter-cellular information sharing improves dscRNA-seq quantification. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa450 — partial (corpus)
R8. Melsted P, Booeshaghi AS, Liu L, et al. Modular, efficient and constant-memory single-cell RNA-seq preprocessing. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00870-2 — partial (corpus)
R9. Melsted P, Ntranos V, Pachter L. The barcode, UMI, set format and BUStools. *Bioinformatics* 2019. doi:10.1093/bioinformatics/btz279 — partial (corpus)
R10. Liu D. Algorithms for efficiently collapsing reads with Unique Molecular Identifiers. *PeerJ* 2019. doi:10.7717/peerj.8275 — partial (corpus)
R11. TRUmiCount: correctly counting absolute numbers of molecules using unique molecular identifiers. *Bioinformatics* 2018. Authors not captured. doi:10.1093/bioinformatics/bty283 — partial (corpus)
R12. You Y, Tian L, Su S, Dong X, Jabbari JS, Hickey PF, Ritchie ME. Benchmarking UMI-based single-cell RNA-seq preprocessing workflows. *Genome Biology* 2021. doi:10.1186/s13059-021-02552-3 — partial (corpus)
R13. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — partial (corpus)
R14. Ziegenhain C, Hendriks GJ, Hagemann-Jensen M, Sandberg R. Molecular spikes: a gold standard for single-cell RNA counting. *Nature Methods* 2022. doi:10.1038/s41592-022-01446-x — partial (search)
R15. UMIche: a platform for robust UMI-centric simulation and analysis in bulk and single-cell sequencing. *bioRxiv* 2025 (preprint). Authors not captured. doi:10.1101/2025.03.15.643072 — partial (search)
R16. UMI-nea: a fast, robust tool for reference-free UMI deduplication and accurate quantification. *Bioinformatics* 2025; 41(9): btaf514. Authors not captured. doi:10.1093/bioinformatics/btaf514 — partial (search)
R17. Orabi B, Erhan E, McConeghy B, et al. Alignment-free clustering of UMI tagged DNA molecules. *Bioinformatics* 2018. doi:10.1093/bioinformatics/bty888 — partial (corpus)
R18. Islam S, Zeisel A, Joost S, et al. Quantitative single-cell RNA-seq with unique molecular identifiers. *Nature Methods* 2014. doi:10.1038/nmeth.2772 — partial (corpus)
R19. Gorin G, Pachter L. Length biases in single-cell RNA sequencing of pre-mRNA. *bioRxiv* 2021. doi:10.1101/2021.07.30.454514 — partial (corpus)
R20. 10x Genomics. Technical note: interpreting intronic and antisense reads in 10x Genomics single cell gene expression data. 2021. — partial (corpus)
R21. Rosenberg A, Hirschberg J. V-measure: a conditional entropy-based external cluster evaluation measure. *EMNLP* 2007. — unverified (memory)
R22. Tsagiopoulou M, Maniou MC, Pechlivanis N, et al. UMIc: a preprocessing method for UMI deduplication and reads correction. *Frontiers in Genetics* 2021. doi:10.3389/fgene.2021.660366 — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/CGATOxford/UMI-tools | Smith T, Heger A, Sudbery I (paper); Sudbery I (package metadata) | MIT (LICENSE, copyright 2015 CGAT) | directional rule and default method | port |
| https://github.com/alexdobin/STAR | Alexander Dobin | MIT (LICENSE, copyright 2019 Alexander Dobin) | 1MM, directional and 1MM_CR routines | port |
| https://github.com/COMBINE-lab/alevin-fry | Srivastava A, Sarkar H, He D, Singh NP, Patro R (package metadata) | BSD-3-Clause (LICENSE, copyright 2020– University of Maryland) | cr-like and parsimony resolution, EM variants | port |
| https://github.com/10XGenomics/cellranger | 10x Genomics | 10x Genomics licence (LICENSE, copyright 2026 10x Genomics): MIT-style grant restricted to internal use with 10x Genomics products | reference for Cell Ranger behaviour, as documented for 1MM_CR in [R2]; no code reuse | callout |
| https://github.com/BUStools/bustools | Melsted P, Booeshaghi AS and co-authors (README citation) | BSD-2-Clause (LICENSE, copyright 2018 BUStools) | gene-level collapse and umicorrect comparators | callout |
| https://github.com/pachterlab/kb_python | Min KH; Booeshaghi AS (README credits) | BSD-2-Clause (LICENSE, copyright 2019 Pachter Lab) | EM option, mentioned for context | callout |
| https://github.com/Daniel-Liu-c0deb0t/UMICollapse | Liu D | MIT (LICENSE, copyright 2019 Daniel Liu) | collapse comparator for P1 | callout |
| https://github.com/Cibiv/trumicount | — | GNU AGPL-3.0 (COPYING) | excluded from comparators (section 10) | reimplement from the paper, if ever adopted |
