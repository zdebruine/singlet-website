---
id: ingest-quant.multi_gene_read_assignment
title: Gene-ambiguous (multi-gene) read and UMI assignment
area: ingest-quant
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.read_to_gene_mapping, ingest-quant.umi_deduplication, ingest-quant.reference_annotation_build]
feeds: [normalization.size_factor_estimation, qc.low_quality_cell_detection, doublets.expression_doublet_scoring]
reads: [uns/ec_gene_incidence, layers/ec_counts]
writes: [layers/counts_allocated, layers/counts_unique, obs/ambiguous_fraction, var/ambiguity_fraction, uns/em_diagnostics, layers/counts_bootstrap_sd]
devices: [cpu, cuda]
mcp_tool: singlet_ingest_quant_multi_gene_read_assignment
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Gene-ambiguous (multi-gene) read and UMI assignment

> Decides which gene each molecule compatible with several genes is counted for, by discarding it, applying a fixed rule, or fitting a per-cell EM over gene proportions, and reports how much ambiguity remains.

## 1. Question

When a molecule's equivalence class (EC) is compatible with more than one gene, should it be discarded, shared by a fixed rule, or allocated by a fitted model? The input is per-cell collapsed molecule counts per EC, with each EC's compatible gene set, from alignment or pseudoalignment and the annotation. The output is per-cell gene counts in molecules, with ambiguity fractions per cell and per gene. A correct answer recovers each gene's molecule count where gene sets overlap, and states where the data cannot split the molecules.

## 2. Why this task matters and where the field stands

**Status: contested.** Counting pipelines disagree about molecules compatible with several genes. STARsolo and bustools count unique-gene molecules by default [R3][R4], while alevin-fry resolves multi-gene classes with a UMI graph in its parsimony modes and with EM in its `-em` modes [R2]. The choice matters most for paralog families and overlapping genes, because discarding removes the molecules that link them to their partners, so their counts fall [R10][R1]. The best-practices chapter reports, citing Brüning et al., that STARsolo is faster and needs less memory than Cell Ranger while giving almost identical results [R10][R9].

Open problems:

- Genes that always co-occur with no unique molecules cannot be split from counts alone (section 3).
- alevin-fry offers bootstrap replicates (-b) [R2], but none of the tools reviewed here reports the coverage of its uncertainty.
- The rules reviewed here weight compatible genes equally and use no alignment score or mismatch count.
- Per-cell evidence is sparse; inter-cellular sharing [R7] is the closest published pooling across cells.
- In bulk data, mapping strategy alone changes transcript estimates [R8], so allocation comparisons must hold the mapper fixed.

## 3. Theory and insight

| Symbol | Meaning | Unit |
|---|---|---|
| $n_e$ | collapsed molecules in equivalence class (EC) $e$ | molecules |
| $S_e$ | genes compatible with $e$ | gene set |
| $N=\sum_e n_e$ | collapsed molecules in the cell | molecules |
| $x_g$ | expected molecules of gene $g$, with $\sum_g x_g=N$ | molecules |
| $\theta_g=x_g/N$ | gene proportion | dimensionless |
| $u_g$ | molecules in ECs with $S_e=\{g\}$ | molecules |
| $f_g$ | share of molecules compatible with $g$ that lie in multi-gene ECs | fraction |

**Estimand.** For each cell and gene the target is $x_g$, in molecules after UMI collapse. Allocation moves molecules between genes and conserves their total, so allocated counts sum to $N$; discard instead drops the multi-gene share. The cell-level ambiguity fraction is $\sum_{\lvert S_e\rvert>1} n_e/N$, and $f_g$ is taken over the molecules compatible with $g$.

**Model.** A molecule has a latent gene of origin $z$ with $P(z=g)=\theta_g$. Its EC is generated with probability proportional to $\mathbb{1}[z\in S_e]$, up to a factor that depends on $e$ but not on $g$. This is uniform compatibility: compatible genes are equally likely, and sequence evidence such as mismatch count is ignored. The marginal log-likelihood of the cell is

$$\ell(\theta)=\sum_{e} n_e\log\Big(\sum_{g\in S_e}\theta_g\Big),\qquad \theta\in\Delta^{G-1}.$$

The $e$-specific factors do not depend on $\theta$ and drop out. The function is concave, because the logarithm of a non-negative linear function is concave and the weights $n_e$ are non-negative, so every stationary point is a global maximum; the maximiser need not be unique. Regime: molecule-level counts after UMI collapse, per cell, with no residual UMI error and molecules independent given $\theta$. EM over equivalence classes is the standard in bulk quantification [R6]. ECs come from pseudoalignment compatibility sets [R5] or from alignment [R3].

**EM.** The E-step gives $r_{e,g}=\theta_g\mathbb{1}[g\in S_e]/\sum_{h\in S_e}\theta_h$, with $r_{e,g}=1$ for unique ECs. The M-step in molecules is

$$x_g^{(t+1)}=u_g+\sum_{e:\,g\in S_e,\,\lvert S_e\rvert>1} n_e\,\frac{x_g^{(t)}}{\sum_{h\in S_e}x_h^{(t)}}.$$

Because $r_{e,g}$ is scale-free, this is exact EM for $\theta$ with $x=N\theta$. For any positive start the total after one step is $N$, and the iterates from step one onward do not depend on the scale of the start. The limit can still depend on the start when the maximiser is not unique (below). With $A$ the incidence matrix of multi-gene ECs only, and $n_m$ their counts, the update is $x^{(t+1)}=u+x^{(t)}\odot A^{\top}\big(n_m\oslash(Ax^{(t)})\big)$. Unique rows must be excluded from $A$, or unique molecules are counted twice. Each iteration is two sparse products, costing $O(\mathrm{nnz}(A))$ per cell.

**Positivity and stop rules.** If every compatible component is positive at the start, exact EM keeps it positive, so iterates approach the boundary without reaching it. A stop rule on absolute change can then end the iteration while a component is still falling toward zero. Starting from unique counts alone, as bustools does, gives zero weight to genes without unique molecules, so an EC whose genes all lack unique molecules has a zero normaliser; the uniform term in the STARsolo start avoids this. Floors that zero small components, as STARsolo does, break exact EM, so monotone ascent is then not guaranteed.

**Identifiability.** If every EC containing $g$ contains $h$ and the converse holds, then $\ell$ depends on $(\theta_g,\theta_h)$ only through $\theta_g+\theta_h$. Only the group total is identified, and the split is set by the start or a prior. This is exact in the noise-free EC model and near-degenerate when unique molecules are few.

**Discard bias.** If the ambiguous share is independent of molecule identity, discarding keeps only the unique fraction, so $\mathbb{E}[\hat u_g]\approx(1-f_g)\lambda_g$, where $\lambda_g$ is the expected molecule count of $g$. This is a first-order derivation made here, valid when $f_g$ is small or roughly constant across cells. It is not a quoted result.

**Insight.** Discarding is not neutral: it removes the molecules that connect a paralog or overlapping gene to its partner, so counts fall by about the ambiguous share. Fixed rules recover part of that mass without a likelihood. EM is the likelihood refinement, and it helps only where the EC graph links a gene to unique evidence. For groups without unique evidence no method identifies the split, so the defensible output is the group total. Benchmarks in bulk show that the mapper alone moves estimates [R8]; the discard prediction above is what B2 tests. Pooling across cells is the natural model-based extension [R7]. A Dirichlet prior with $\alpha_g>1$ gives the MAP update $\hat\theta_g\propto\sum_e n_e r_{e,g}+\alpha_g-1$, which reduces to maximum likelihood at $\alpha_g=1$.

**Complexity.** Each iteration costs $O(\sum_{\lvert S_e\rvert>1}\lvert S_e\rvert)$ per cell. The iteration count is an output (section 5), not a constant.

## 4. Methods landscape

Discard, which counts only unique-gene molecules, is the default of bustools count and of STARsolo's Unique mode, and it is the baseline every model-based rule must beat. The STARsolo fixed rules and EM, and bustools' optional EM, are the alternatives compared here. alevin-fry's graph-based resolution is specified in `ingest-quant.umi_deduplication`, which builds the UMI graph; this task consumes its output. Each row is backed by code or documentation cited in section 12. Cell Ranger's multi-gene policy is treated in section 10.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Discard (unique-gene molecules only) | heuristic | Counts only molecules whose EC names one gene; the bustools count default and STARsolo Unique | [R4], [R3] |
| Uniform (STARsolo) | heuristic | Each compatible gene receives $n_e/\lvert S_e\rvert$ of each multi-gene EC | [R3] |
| PropUnique and Rescue (STARsolo) | heuristic | Non-iterative fixed weightings of multi-gene molecules built from unique counts | [R3] |
| EM (STARsolo) | model-based | Fixed-point EM on molecule counts with a zero floor and an absolute stop rule | [R3] |
| EM (bustools `--em`, via kb_python) | model-based | EM over gene sets, initialised from unique counts; off unless the flag is given | [R4] |
| cr-like and parsimony-EM (alevin-fry) | hybrid | cr-like keeps, for each UMI, the gene with the highest read count (a tie leaves a multi-gene class); parsimony takes a greedy cover of each UMI-graph component, taking the largest candidate set first, and counts gene-unique classes only; parsimony-EM runs EM over the resulting gene classes; all run in `quant` | [R2], [R1] |

Defaults taken from source code and documentation:

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| STARsolo | soloMultiMappers | Unique | source/parametersDefault:869 @ b1edc12 |
| STARsolo | soloUMIdedup | 1MM_All | source/parametersDefault:877 @ b1edc12 |
| STARsolo | soloFeatures | Gene | source/parametersDefault:857 @ b1edc12 |
| STARsolo EM | start | unique plus uniform counts | source/SoloFeature_collapseUMIall.cpp:450-452 @ b1edc12 |
| STARsolo EM | zero floor | 0.01 (hard-coded), applied before each step | source/SoloFeature_collapseUMIall.cpp:469-472 @ b1edc12 |
| STARsolo EM | stop rule | max absolute change < 0.01, or more than 100 iterations (hard-coded) | source/SoloFeature_collapseUMIall.cpp:486-497 @ b1edc12 |
| STARsolo Uniform | weight | $1/\lvert S_e\rvert$ per multi-gene UMI | source/SoloFeature_collapseUMIall.cpp:362-368 @ b1edc12 |
| alevin-fry | umi-edit-dist for cr-like, cr-like-em, trivial | 0 | src/main.rs:324-326 @ ad05742 |
| alevin-fry | umi-edit-dist for parsimony modes | 1 | src/main.rs:327-330 @ ad05742; docs/source/quant.rst:42 |
| alevin-fry EM | MIN_ITER / MAX_ITER | 2 / 100 | src/em.rs:32-33 @ ad05742 |
| alevin-fry EM | REL_DIFF_TOLERANCE | 1e-2 on the absolute change in alpha, for components with alpha above 1e-2 | src/em.rs:34, 413 @ ad05742 |
| alevin-fry EM | MIN_OUTPUT_ALPHA / ALPHA_CHECK_CUTOFF / _MIN_ALPHA | 0.01 / 1e-2 / 1e-8 | src/em.rs:28-30 @ ad05742 |
| alevin-fry | large-graph-thresh | 1000 vertices | docs/source/quant.rst:44 @ ad05742 |
| alevin-fry | num-bootstraps (-b) | 0 (off); the code accepts cr-like-em, parsimony-em and parsimony-gene-em (the docs name cr-like-em and full) | src/main.rs:306, 725 @ ad05742; docs/source/quant.rst:32 |
| kb_python | kb count --em | off (False); flag hidden from help | kb_python/count.py:479 and kb_python/main.py:1355 @ 188d9c7 |
| bustools | count --em | off unless the flag is given; with -s it is rejected | src/bustools_main.cpp:362, 411-412, 1869 @ d4d7a28 |
| bustools | multi-gene UMIs without --em | not added to the gene matrix | src/bustools_count.cpp:392-395 @ d4d7a28 |

## 5. Proposed singlet approach

**Routes.** The STARsolo allocation block of the STAR aligner [R11] (Uniform, PropUnique, Rescue and EM) is ported as an oracle for the fixed rules and the EM, with attribution. alevin-fry, bustools through kb_python and Salmon are comparators only: their defaults are taken from source where tabulated, but their code is not used. Cell Ranger is not run or tabulated (section 10). singlet's EM is reimplemented from the equations in section 3, because it runs on the EC table singlet writes.

**Proposed model.** Per cell, a latent gene of origin under uniform compatibility (section 3), fitted by exact EM (zero floor 0) to the concave likelihood. The output is the maximum-likelihood proportion scaled to molecules. Intervals come from molecule-resampling bootstrap refits within each cell. Groups of always-co-occurring genes are reported as one total in `uns/em_diagnostics`. The model is rejected as a default if B1 does not show the predicted tier-2 advantage over discard, if B2 does not show lower paralog error than discard at every divergence above zero, or if B2 interval coverage falls outside 0.85 to 0.95.

**Learned extension (not the default).** Sequence-informed weights $P(e\mid z=g)$ from mismatch count and alignment score would replace uniform compatibility. That weight model is a learned component, so it would be trained in PyTorch on the simulated truth of B2, and it is not exposed until B2 supports it. The per-cell EM stays in hard-coded CUDA and cuSPARSE, because it is small and hot. The Dirichlet MAP variant (section 3) is reserved for a pooling study and is not in the tool.

**Stack and kernels.** The core solver is a dependency-free C++ loop over CSR rows. The CUDA path batches cells as a block-diagonal sparse system, with two cuSPARSE products and elementwise operations per iteration. Cells are independent, so the solver streams over chunks of cells on either device.

**Defaults.** Use `multi_gene_policy` em, `em.max_iter` 1000, `em.tol` 1e-6, `em.zero_floor` 0, `em.n_bootstrap` 0, `ec_granularity` gene and `report_tiers` true. The iteration and tolerance defaults are singlet choices shared with the collapse step; alevin-fry caps its EM at 100 iterations (section 4). Set `em.max_iter` 100, `em.tol` 0.01 and `em.zero_floor` 0.01 only to reproduce STARsolo's stop rule and floor. UMI collision handling happens upstream, so no UMI distance is set here.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/ec_gene_incidence | sparse bool | EC-by-gene incidence over unique and multi-gene ECs |
| read | layers/ec_counts | sparse int | collapsed molecules $n_e$ per cell and EC |
| write | layers/counts_allocated | sparse float32 | allocated molecules per cell and gene; sums to $N$ per cell |
| write | layers/counts_unique | sparse int | molecules in unique ECs only (the discard output) |
| write | obs/ambiguous_fraction | float32 | share of a cell's molecules in multi-gene ECs |
| write | var/ambiguity_fraction | float32 | $f_g$ for each gene |
| write | uns/em_diagnostics | dict | iterations, converged flag, final change per cell, group totals |
| write | layers/counts_bootstrap_sd | sparse float32 | bootstrap standard deviation; written only when `em.n_bootstrap` > 0 |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `multi_gene_policy` | string | "em" | `discard`, `uniform`, `prop_unique`, `rescue`, `em` | Allocation rule for molecules compatible with several genes; em is the maximum-likelihood fit, discard keeps unique-gene molecules only. |
| `em` | object | — | — | Options for the em policy; ignored by the fixed rules. |
| `em.max_iter` | integer | 1000 | min 1; max 10000 | Maximum EM iterations per cell (singlet default; the alevin-fry EM caps at 100). |
| `em.tol` | number | 1e-06 | > 0 | Stop when the largest absolute change in molecule counts between iterations falls below this. |
| `em.zero_floor` | number | 0 | min 0 | Components below this are set to zero before each iteration; 0 gives exact EM, 0.01 reproduces STARsolo. |
| `em.n_bootstrap` | integer | 0 | min 0; max 1000 | Molecule-resampling bootstrap refits per cell for intervals; 0 disables them. |
| `ec_granularity` | string | "gene" | `gene`, `transcript` | Equivalence classes over genes (default) or transcripts; must match the upstream table. |
| `report_tiers` | boolean | true | — | Write per-gene tier statistics (tiers 1 to 3) used by the split-half benchmark. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for bootstrap replicates; ignored when em.n_bootstrap is 0. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Parameter rules: the `em` block applies only when `multi_gene_policy` is em. `em.n_bootstrap` above zero adds `layers/counts_bootstrap_sd` and makes the output stochastic, so `seed` applies only then. Fractional values go to `layers/counts_allocated` because `layers/counts` holds integer UMI counts. `ec_granularity` must match the granularity of the upstream table. A cell with no molecules gets an undefined ambiguity fraction.

## 7. MCP tool

Tool name `singlet_ingest_quant_multi_gene_read_assignment` (definition in `tasks/mcp/singlet_ingest_quant_multi_gene_read_assignment.json`). Example call and compact result:

```json
{"dataset": "<path>.singlet", "multi_gene_policy": "em", "em": {"max_iter": 1000, "tol": 1e-6, "zero_floor": 0, "n_bootstrap": 0}, "device": "auto"}
```

```json
{"dataset": "<path>.singlet", "status": "completed",
 "wrote": ["layers/counts_allocated", "layers/counts_unique", "obs/ambiguous_fraction", "var/ambiguity_fraction", "uns/em_diagnostics"],
 "summary": {"policy": "em", "n_cells": "<int>", "ambiguous_fraction_median": "<fraction>", "em_converged_fraction": "<fraction>", "em_iterations_median": "<int>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: a large dataset may return `queued` with a `job_id`; otherwise the call returns inline. Stochastic: only when `em.n_bootstrap` is above zero, and then `seed` fixes the replicates. Dry run: returns seconds, peak memory and device from the EC table size, without fitting.

## 8. Benchmarks

**Shared protocol.** Comparators read the same reference, annotation and whitelist. Allocation-only comparisons use one collapsed molecule table (the mapper-fixed arm); native comparisons use each tool's own equivalence classes and form a separate arm. Software is pinned to a commit or release, and thread counts are recorded. Each bustools comparison states its `--em` flag explicitly, because kb count hides it. Metrics are per cell, summarised by the median across cells unless stated; no statistic is pooled across tiers.

### B1. Tier-stratified split-half reproducibility (proposed reconstruction of Srivastava et al. 2019)

- **Goal**: Test whether allocating multi-gene molecules gives reproducible counts for weakly supported genes, using the tier design of [R1].
- **Ground truth**: Consistency. Each cell's molecules are split at random into halves A and B with a fixed seed; each rule is applied to each half, and the other half is the reference. The estimand is $x_{c,g}$ in molecules, so the measure is reproducibility, not accuracy. Tiers use the full data: tier 1 has $u_g>0$ and no multi-gene EC containing $g$; tier 2 has $u_g>0$ and at least one such EC; tier 3 has $u_g=0$ and at least one such EC.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Mouse retina Drop-seq comparison | [R1]; accession — | Drop-seq, mouse; cell count — | — | Tier design as described for [R1] |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Tier split-half Spearman $\rho_T$ | For each tier $T$, median over genes $g\in T$ of the Spearman correlation across cells between $x^A_{\cdot,g}$ and $x^B_{\cdot,g}$, using cells with a molecule of $g$ in either half | maximise | primary | — (reconstruction; see section 10) |
| Total-mass error | $\lvert\sum_g x_{c,g}-N_c\rvert/N_c$, median over cells; discard is expected to lose the multi-gene share | minimise | guardrail | — |

- **Comparators**: Discard; Uniform, PropUnique, Rescue and EM (zero floor 0 and 0.01) on the shared table; native STARsolo outputs; alevin-fry parsimony-EM (native); bustools count without and with `--em`.
- **Protocol**: Three split seeds; molecules subsampled to 25%, 50% and 100% to match depth.
- **Acceptance criterion**: Proposed design threshold (not from the literature): at full depth, the median tier-2 $\rho_2$ of exact EM exceeds that of discard by at least 0.02.
- **Known pitfalls**: Agreement with unique-only counts would be circular, because discard is itself the unique-only count, so it is not used. Tier 3 is reported but excluded from accuracy claims, because its split is set by the start (section 3).

### B2. Simulated paralog and overlap truth (proposed)

- **Goal**: Score allocation rules against planted molecule counts for paralog pairs, overlaps and unique genes, and test bootstrap interval coverage.
- **Ground truth**: Planted simulation: the label is the molecule count $m_{c,g}$ drawn before reads are generated; the estimand is $m_{c,g}$ in molecules.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated reads with planted molecules | Recipe below | Any annotated species; size by design | Not applicable | Means fitted to a real count matrix |

Generator recipe:

1. Fix an annotated reference; simulate and quantify with the same annotation.
2. Duplicate chosen genes at sequence divergence $d\in\{0,1,5\}\%$ (design values), giving paralog and overlap pairs.
3. Set $\lambda_{c,g}=s_c\mu_g$, with cell factor $s_c$ and $\mu_g$ from a negative-binomial fit to a real count matrix (singlet catalogue or public data; source recorded).
4. For a fixed subset of pairs, set one partner's mean to zero, to measure false mass.
5. Draw $m_{c,g}\sim\mathrm{Poisson}(\lambda_{c,g})$ and assign UMIs from a stated error model.
6. Simulate reads from each molecule's source copy with a separate read simulator, under two base-error profiles.
7. Map with STARsolo, collapse with `ingest-quant.umi_deduplication`, and score each rule against $m_{c,g}$.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Paralog-family relative error | Per family $F$: $\sum_c\sum_{g\in F}\lvert\hat x_{c,g}-m_{c,g}\rvert\big/\sum_c\sum_{g\in F}m_{c,g}$; median over families | minimise | primary | — |
| 90% interval coverage | Share of gene-cell pairs whose 90% bootstrap interval (5th to 95th percentile of refits) contains $m_{c,g}$ | target 0.90 | guardrail | — |
| False mass to partner | $\sum_c\hat x_{c,h}\big/\sum_c(\hat x_{c,g}+\hat x_{c,h})$ for pairs where $h$ has zero mean | minimise | guardrail | — |

- **Comparators**: Discard; Uniform, PropUnique and Rescue; EM with zero floor 0 and 0.01; alevin-fry parsimony-EM (native).
- **Protocol**: Three divergence levels, three depths (25%, 50%, 100% of molecules) and three seeds; cell count by design; bootstrap count fixed in advance.
- **Acceptance criterion**: Proposed design thresholds (not from the literature): exact-EM $RE_F$ below discard at every $d>0$; 90% interval coverage between 0.85 and 0.95 for exact EM.
- **Known pitfalls**: A simulator whose error model matches one mapper favours that mapper, so two profiles are used. Identical sequences ($d=0$) are not identifiable; report them as a separate group, not as errors.

### P1. Performance and scaling

- **Measures**: Wall time, peak resident memory and throughput (cells per second) for the allocation stage. Mapping and index-build time and size are timed separately, because EM adds cost after mapping.
- **Scales**: 10,000, 100,000 and 1,000,000 cells, and 10,000,000 when streaming is claimed.
- **Devices**: CPU at a fixed thread count, and CUDA; both recorded.
- **Comparators**: STARsolo with Unique and with EM (the difference in total time is the EM overhead); bustools count without and with `--em`; alevin-fry parsimony-EM (native).
- **Hold fixed**: Reference build, whitelist, thread count, read depth, storage and software version.
- **Acceptance criterion**: Proposed design threshold (not from the literature): EM overhead below the mapping-stage time at 10,000 cells. Per-iteration cost is $O(\mathrm{nnz}(A))$ per cell (section 3).

## 9. Chaining

Sits between UMI collapse and the cell-level count matrix. It is the only step that resolves gene-ambiguous molecules, so every count workflow must state the rule it uses.

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `ingest-quant.reference_annotation_build`: Reference genome and annotation preparation for single-cell counting (including custom host-plus-pathogen and transgene references)
- **Feeds**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `doublets.expression_doublet_scoring`: Expression-based per-cell doublet scoring
- **Reads**: `uns/ec_gene_incidence`, `layers/ec_counts`
- **Writes**: `layers/counts_allocated`, `layers/counts_unique`, `obs/ambiguous_fraction`, `var/ambiguity_fraction`, `uns/em_diagnostics`, `layers/counts_bootstrap_sd`
<!-- CHAINING:AUTO:END -->

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The full text of [R1] is not in the source set. B1 reconstructs its tier design; the dataset accession, cell count and per-tier metric are not defined here. The terms of use of the retina data are not stated in the source set.
- **Unpublished or missing protocols.** The full text of Kaminow et al. 2021 [R3] is not in the source set, so no STARsolo-versus-pseudoalignment benchmark is defined from it. Cell Ranger, the pipeline for the platform described in [R12], is not tabulated because its multi-gene rule was not read from source. The STARsolo parameter text (`source/parametersDefault:891` @ b1edc12) says that `MultiGeneUMI_CR` matches Cell Ranger above 3.0.0 in removing lower-count UMIs that map to more than one gene; this is the only description of that rule used here.
- **Benchmarks not defined.** Brüning et al. [R9] is cited only through the best-practices chapter; its datasets and metrics are not reproduced here.
- **Technical risks.** The mapper-fixed arm needs STARsolo's per-UMI gene sets, and this document defines no export for them. The STAR EM loop has no guard against a zero normaliser: once every gene of a UMI falls below the floor, the update divides by zero (`source/SoloFeature_collapseUMIall.cpp:474-482` @ b1edc12), and how often this occurs is not measured. bustools skips an ambiguous set whose current total is zero (`src/bustools_count.cpp:495` @ d4d7a28), so its molecules drop out of that iteration.
- **Unsettled literature.** Benchmark evidence does not settle whether discard or EM is better for paralog families, and the first-order discard bias (section 3) is derived here, not measured. Stop rules and floors differ between tools, so the same reads give different numbers.
- **First experiment.** Build B2 at $d=0$ and $d>0$ with discard and exact EM. Check that the total-mass guardrail holds and that bootstrap coverage lies between 0.85 and 0.95 before any real-data benchmark is defined.

## 11. References

R1. Srivastava A, Malik L, Smith T, Sudbery I, Patro R. Alevin efficiently estimates accurate gene abundances from dscRNA-seq data. *Genome Biology* 2019;20(1). doi:10.1186/s13059-019-1670-y — verified (corpus)
R2. He D, Zakeri M, Sarkar H, Soneson C, Srivastava A, Patro R. Alevin-fry unlocks rapid, accurate and memory-frugal quantification of single-cell RNA-seq data. *Nature Methods* 2022. doi:10.1038/s41592-022-01408-3 — verified (corpus)
R3. Kaminow B, Yunusov D, Dobin A. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021 (preprint). doi:10.1101/2021.05.05.442755 — verified (corpus)
R4. Melsted P, Booeshaghi AS, Liu L, Gao F, Lu L, Min KH, da Veiga Beltrame E, Hjorleifsson KE, Gehring J, Pachter L. Modular, efficient and constant-memory single-cell RNA-seq preprocessing. *Nature Biotechnology* 2021;39(7):813–818. doi:10.1038/s41587-021-00870-2 — verified (corpus)
R5. Bray NL, Pimentel H, Melsted P, Pachter L. Near-optimal probabilistic RNA-seq quantification. *Nature Biotechnology* 2016. doi:10.1038/nbt.3519 — verified (corpus)
R6. Patro R, Duggal G, Love MI, Irizarry RA, Kingsford C. Salmon provides fast and bias-aware quantification of transcript expression. *Nature Methods* 2017. doi:10.1038/nmeth.4197 — verified (corpus)
R7. Srivastava A, Malik L, Sarkar H, Patro R. A Bayesian framework for inter-cellular information sharing improves dscRNA-seq quantification. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa450 — verified (corpus)
R8. Srivastava A, Malik L, Sarkar H, Zakeri M, Almodaresi F, Soneson C, Love MI, Kingsford C, Patro R. Alignment and mapping methodology influence transcript abundance estimation. *Genome Biology* 2020. — verified (corpus)
R9. Schulze Brüning R, Tombor L, Schulz MH, Dimmeler S, John D. Comparative analysis of common alignment tools for single-cell RNA sequencing. *GigaScience* 2022. doi:10.1093/gigascience/giac001 — verified (corpus)
R10. He D, Srivastava A, Sarkar H, Patro R, Kim SH, Heumos L. Raw data processing. In: *Single-cell best practices*, online book, theislab. — verified (corpus)
R11. Dobin A, Davis CA, Schlesinger F, Drenkow J, Zaleski C, Jha S, Batut P, Chaisson M, Gingeras TR. STAR: ultrafast universal RNA-seq aligner. *Bioinformatics* 2013;29(1):15–21. doi:10.1093/bioinformatics/bts635 — verified (corpus)
R12. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/alexdobin/STAR | Alexander Dobin | MIT (LICENSE; copyright 2019 Alexander Dobin) | STARsolo allocation rules, EM and defaults | port (allocation block, with attribution) |
| https://github.com/COMBINE-lab/alevin-fry | Avi Srivastava, Hirak Sarkar, Dongze He, Noor Pratap Singh, Rob Patro (Cargo.toml) | BSD-3-Clause (LICENSE; copyright 2020– University of Maryland) | Resolution modes and EM constants | callout (comparator; constants read, EM reimplemented) |
| https://github.com/BUStools/bustools | BUStools | BSD-2-Clause (LICENSE; copyright 2018 BUStools) | Default discard and optional EM | callout (comparator) |
| https://github.com/pachterlab/kb_python | Kyung Hoi (Joseph) Min (setup.py); README credits A. Sina Booeshaghi | BSD 2-Clause (LICENSE; copyright 2019 Pachter Lab) | kb count wrapper and hidden `--em` flag | callout (comparator) |
| https://github.com/pachterlab/kallisto | Nicolas Bray, Harold Pimentel, Páll Melsted, Lior Pachter (license.txt) | BSD-2-Clause (license.txt in the repository root; no file named LICENSE; copyright 2017, same four authors) | Source of compatibility sets (input only) | callout (input producer) |
| https://github.com/COMBINE-lab/salmon | COMBINE lab | BSD-3-Clause (LICENSE; copyright 2026 COMBINE lab) | alevin lineage; `salmon alevin` moved to alevin-fry (README) | callout (historical reference) |
| https://github.com/10XGenomics/cellranger | 10x Genomics | Custom: MIT-style grant for internal use, exercisable only with 10x Genomics products or data generated with them; no redistribution or sublicensing (LICENSE clauses 2 and 3) | Baseline pipeline; multi-gene rule not tabulated (section 10) | callout (not run) |
