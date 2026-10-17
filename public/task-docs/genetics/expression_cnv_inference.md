---
id: genetics.expression_cnv_inference
title: Copy-number inference from scRNA-seq expression
area: genetics
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.reference_annotation_build, qc.low_quality_cell_detection, normalization.size_factor_estimation, annotation.marker_based_cell_assignment]
feeds: [genetics.clonal_substructure_inference, genetics.dna_clone_assignment]
reads: [layers/counts, var/chrom, var/start, var/end, uns/genome_build, obs/<reference_obs_key>, layers/alt_counts, layers/ref_counts, uns/phasing_panel]
writes: [obsm/cnv_state, obsm/cnv_posterior, obsm/cnv_score, uns/cnv_segments, obs/cnv_aneuploid, obs/cnv_clone]
devices: [cpu, cuda]
mcp_tool: singlet_genetics_expression_cnv_inference
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Copy-number inference from scRNA-seq expression

> Infers, for each cell and genomic segment, whether total copy number is lost, neutral or gained relative to normal reference cells, using expression ordered along the genome, and uses allele counts where supplied to resolve loss of heterozygosity.

## 1. Question

Given gene-by-cell UMI counts with gene coordinates and a normal reference (or an internal baseline), which chromosomal segments are lost or gained in each cell, at arm or segment scale? The output is a cell-by-segment state, a score and, for HMM callers, posterior probabilities; a correct answer matches the total copy number that DNA-based measurements of the same tumour report at the segment scale that expression resolves, and copy-neutral loss of heterozygosity or the haplotype of a gain needs allele counts.

## 2. Why this task matters and where the field stands

Tumour scRNA-seq rarely comes with DNA measurements of the same cells, yet malignant clones can be found from expression alone: reference-subtracted, gene-ordered profiles reveal arm-scale gains and losses [R1], and clonal substructure can be read from the same profiles [R2]. Clone labels, malignant-cell calls and allele-level calls all inherit the caller's errors.

The task is **contested**.

1. **Truth is scarce and rankings shift.** Across six callers on 21 scRNA-seq datasets, results depend on the dataset [R6]. Against copy-number truth from single-cell DNA sequencing of the same cells, Numbat ranks first overall and CopyKAT is recommended when only an expression matrix is available [R7].
2. **Cell state mimics dosage.** Reference-based callers read any expression programme absent from the reference as a gain or loss, so immune-like or stromal-like malignant cells and mismatched normal references produce false segments.
3. **Allele evidence decides what expression cannot.** Copy-neutral loss of heterozygosity and haplotype-specific gains leave totals unchanged. Numbat [R5] and CaSpER with B-allele frequency [R3] address them. The six-caller comparison found allele-using tools steadier on large droplet datasets, but slower [R6].

Open problems: thresholds that transfer across tissues, protocols and depths without per-dataset tuning; calibrated uncertainty per segment and cell; focal events, which expression resolves weakly; the diploid baseline under whole-genome doubling and dosage compensation; and matched truth sets for benchmarking.

## 3. Theory and insight

Let $x_{cg}$ be the UMI count of gene $g$ in cell $c$, $\eta_c$ its size factor, $\tilde x_{cg}=x_{cg}/\eta_c$ the size-normalised count, $\mu_g$ the normal-reference mean of normalised counts and $k_{cg}$ the total (both-haplotype) copy number, with 2 as the diploid baseline. A segment $w$ is a contiguous run of genes in genomic order with gene set $W_w$.

| Symbol | Meaning |
|---|---|
| $k_{cg}$, $k_{cw}$ | total copy number of gene $g$, or of segment $w$, in cell $c$ |
| $Z_{cw}$ | hidden copy state of segment $w$ in an HMM (not the copy number itself) |
| $AD_{cs}$, $DP_{cs}$ | alternate-allele and total reads at heterozygous SNP $s$ in cell $c$ |
| $\theta$, $\gamma$ | haplotype imbalance and Beta concentration of the allele model |

**Working dosage model (E1).** To first order,
$$\mathbb{E}[\tilde x_{cg}]\approx \mu_g\,\frac{k_{cg}}{2}.$$
This holds for unsaturated genes, without dosage compensation and without cell-state programmes absent from the reference. Depth is already divided out by $\eta_c$.

**Window log-ratio (E2).** Callers average reference-normalised log-ratios over gene windows:
$$\bar r_{cw}=\frac{1}{|W_w|}\sum_{g\in W_w}\log_2\frac{\tilde x_{cg}+\epsilon}{\mu_g+\epsilon}.$$
Under E1 with large counts, a segment at total copy number $k_w$ has $\bar r_{cw}\approx\log_2(k_w/2)$. Attenuation is modelled as the hypothesis $\mathbb{E}[\bar r_{cw}]\approx\beta\log_2(k_w/2)$ with $0<\beta\le1$, where $\beta$ absorbs dosage compensation, sampling noise and cell-state confounding; its size is not established for any dataset in this document. *Regime*: each window must hold enough genes for gene noise to average out, and all genes must sit on one genome build, since a mismatch shifts every window. The window lengths of the callers are in section 4.

**HMM forward recursion (E3).** For a first-order Markov chain along the genome with transition matrix $A$,
$$\alpha_w(j)=p(\mathbf y_w\mid Z_{cw}=j)\sum_i\alpha_{w-1}(i)\,A_{ij},$$
and forward-backward yields $P(Z_{cw}=j\mid\text{data})$. The switch probability in $A$ sets how often adjacent segments change state. The posterior is calibrated only where emissions and transitions are correct.

**Allele emission (E4, Numbat's model [R5]).** Alternate reads at a heterozygous SNP follow
$$AD_{cs}\mid p_{cs}\sim\mathrm{Bin}(DP_{cs},p_{cs}),\qquad p_{cs}\sim\mathrm{Beta}\big((0.5+\theta)\gamma,\,(0.5-\theta)\gamma\big),$$
for a gain-type imbalance $\theta>0$, mirrored for losses. *Regime*: $DP_{cs}$ large enough for the Beta-Binomial to inform $\theta$; $\gamma$ is the overdispersion default in section 4.

**Estimands.** Each output is defined as follows.

- `cnv_state` estimates $y_{cw}=\operatorname{sign}(k_{cw}-2)\in\{-1,0,1\}$, the direction of total copy number of segment $w$ in cell $c$ relative to two copies; the reference mean is the only normalisation.
- `cnv_score` estimates $\bar r_{cw}$ or the caller's own score, a segment log2-ratio of size-normalised counts to the reference mean whose expectation is zero for a diploid segment; scores from different callers are on different scales.
- `cnv_posterior` estimates $P(Z_{cw}=j\mid\text{data})$ under the fitted model; its calibration is an empirical claim.
- The planted truth in B1 is the total copy number $k_{cg}$ of each gene, normalised as $y_{cg}=\operatorname{sign}(k_{cg}-2)$, with the gene span $\ell_g$ in bp as weight.
- The B2 label is one binary value per cell (diploid by origin), not derived from expression.

**Assumptions.** A normal reference exists in the dataset or an internal baseline is acceptable; expression is proportional to copy number after normalisation; gene coordinates match the analysis build; events are at segment scale and cover enough expressed genes; cell-state variation is orthogonal to CNV or modelled by the reference.

**Failure modes by family.** Heuristic callers pass every reference error into every window and give no probability for borderline segments. Hybrid callers depend on segmentation cut-offs and clustering choices, and CopyKAT's automatic cut-off halving changes calls when breakpoints are sparse. Model-based callers are valid where their emission models hold, and allele models need depth. For all families, whole-genome doubling changes the diploid baseline, loss of heterozygosity is invisible without alleles, and low UMI depth reduces genes per window.

**Why heuristics work and what a model adds.** Averaging gene log-ratios is cheap and captures arm-scale signal well, but it gives no probability for a borderline segment and cannot learn the reference distribution. A model adds calibrated posteriors, joint use of count and allele evidence, and a reference model trained once and reused across datasets, at the cost of assumptions (E1, E4) that can fail.

**Pitfalls in evaluation.** Max F1 chooses its threshold with knowledge of the truth and is optimistic, so threshold-free AUROC is reported alongside it (section 8). Dataset and metric choices change rankings, so the protocol in section 8 fixes both before any caller is scored.

Complexity: a first-order HMM with $K$ states over $W$ segments costs $O(WK^2)$ per cell with dense transitions and $O(WK)$ with switch-structured transitions.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| inferCNV | heuristic | Subtracts a normal-cell reference, smooths log-ratios over gene order and optionally calls states with an HMM. | [R1][R9] |
| CopyKAT | hybrid | Smooths expression, segments with MCMC change-points and cut-offs, classifies diploid and aneuploid cells and clusters CNA profiles. | [R2] |
| CaSpER | model-based | Segments the expression copy-number signal with an HMM at several smoothing scales, keeps calls coherent across scales, and calls LOH from B-allele shifts. | [R3] |
| SCEVAN | model-based | Variational Bayesian segmentation of the expression profile, classification of malignant cells and clonal substructure. | [R4] |
| Numbat | model-based | Joint HMM over expression and allele counts with population phasing, giving haplotype-specific copy number, LOH and a clone phylogeny. | [R5] |

inferCNV is the reference-based method of the literature, but its README states that it is no longer supported and points to other tools [R9], so it serves as a baseline only. CopyKAT [R2] and SCEVAN [R4] and CaSpER [R3] cover expression-only use, and Numbat [R5] is the allele-aware reference. The comparisons in section 10 do not establish a single winner.

Defaults used in the benchmarks and the proposed tool, from the code at the commits shown:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| inferCNV | `cutoff`, `min_cells_per_gene` | 1, 3 | R/inferCNV_ops.R:245-246 @ 65e6bf5 |
| inferCNV | `window_length` | 101 genes | R/inferCNV_ops.R:251 @ 65e6bf5 |
| inferCNV | `cluster_by_groups`, `HMM`, `HMM_transition_prob` | TRUE, FALSE, 1e-6 | R/inferCNV_ops.R:258, 268, 270 @ 65e6bf5 |
| inferCNV | `analysis_mode`, `denoise` | subclusters, FALSE | R/inferCNV_ops.R:285, 301 @ 65e6bf5 |
| CopyKAT | `LOW.DR`, `UP.DR`, `win.size` | 0.05, 0.1, 25 | R/copykat.R:31 @ 01924c0 |
| CopyKAT | `KS.cut` | 0.1; halved to 0.05, then 0.025, when fewer than 25 breakpoints | R/copykat.R:31, 221-233 @ 01924c0 |
| CopyKAT | `ngene.chr`, `min.gene.per.cell`, `distance`, `genome`, `n.cores` | 5, 200, euclidean, "hg20" (label for hg38 coordinates), 1 | R/copykat.R:31 @ 01924c0 |
| CaSpER | `method`, `removeCentromere` | iterative, TRUE | R/segmentation.R:42 @ 8aae116 |
| SCEVAN | `beta_vega`, `SUBCLONES`, `ClonalCN` | 0.5, TRUE, TRUE | R/pipelineCNA.R:37 and documentation line 22 @ 5a49b88 |
| SCEVAN | `ngenes_chr`, `perc_genes`, `par_cores`, `FIXED_NORMAL_CELLS` | 5, 10, 20, FALSE | R/pipelineCNA.R:37 @ 5a49b88 |
| Numbat | `genome` | hg38 | R/main.R:69 @ b444f3c |
| Numbat | `max_iter`, `t`, `gamma`, `min_LLR` | 2, 1e-5, 20, 5 | R/main.R:70 @ b444f3c |
| Numbat | `alpha`, `eps`, `max_entropy`, `init_k`, `min_cells`, `tau` | 1e-4, 1e-5, 0.5, 3, 50, 0.3 | R/main.R:71 @ b444f3c |
| Numbat | `min_overlap`, `ncores`, `min_genes`, `p_multi` | 0.45, 1, 10, 1 - alpha | R/main.R:72-75 @ b444f3c |

## 5. Proposed singlet approach

**Routes.** inferCNV is a **callout**, used only as a comparator. Numbat is **ported**, with its allele emission. CopyKAT, CaSpER and SCEVAN are **reimplemented** from their documented algorithms and the defaults in section 4; licences are in section 12.

**Default and rationale.** `copykat` is the default because it needs neither allele data nor a reference; `numbat` takes over when an allele table is supplied. Neither default is final until B1 and B2 are measured.

**Proposed model: a calibrated genome HMM.** For cell $c$ and gene-window segment $w$ (the E2 windows, about 100 genes), a hidden state $Z_{cw}\in\{0,\dots,K-1\}$ with $K$ between 6 and 8 maps to copy numbers $0,\dots,K-1$. Counts are emitted from a negative binomial with mean $\eta_c\mu_g k/2$ (E1), where $\mu_g$ is a reference mean per gene and cell type fitted from catalogue normal cells; allele counts, where present, follow E4; the switch probability is fitted by EM. Forward-backward gives `cnv_posterior` and the MAP state gives `cnv_state`.

**Falsification.** The model is rejected by the B1 and B2 acceptance criteria (section 8), or on calibration if posteriors of at least 0.9 are correct less often than 90 percent of the time on planted segments.

**Cell-level calls.** `cnv_aneuploid` is copykat's own classification when copykat is used. For other methods it is TRUE when the span-weighted non-neutral fraction exceeds 0.1, a threshold fixed before benchmarking and not tuned on B1 or B2.

**ML stack and kernels.** The reference mean is an aggregate per gene and type and needs no network, so PyTorch is used only if a conditional expression model is added. The HMM is sequential along segments and parallel over cells, so forward-backward is a hand-written CUDA kernel in log space, with EM updates on the device and the same recursion on CPU. Window log-ratios use prefix sums along gene order, costing $O(G)$ per cell.

**Streaming.** Cells are processed in blocks, so memory scales with block size times segments times states, not with the full matrix.

**Defaults an agent should use without asking.** `method` copykat; `reference_obs_key` a normal-cell annotation when one exists, otherwise null; `genome_build` from `uns/genome_build`; `seed` 0; `dry_run` first above 100,000 cells (proposed).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Raw UMI counts; non-integer layers are rejected. |
| read | var/chrom, var/start, var/end | str, int | Gene coordinates in the build of `genome_build`; genes without coordinates are dropped. |
| read | uns/genome_build | str | Build recorded at ingest; must equal `genome_build`. |
| read | obs/<reference_obs_key> | bool or categorical | Normal reference cells; required for numbat. |
| read | layers/alt_counts, layers/ref_counts | sparse int | Allele counts at heterozygous SNPs, used only with `numbat.allele_table`. |
| read | uns/phasing_panel | table | Population haplotypes used by numbat. |
| write | obsm/cnv_state | int8 | Relative state per cell and segment: -1 loss, 0 neutral, 1 gain. |
| write | obsm/cnv_score | float32 | Window log2-ratio or the caller's own score; the scale is method-specific. |
| write | obsm/cnv_posterior | float32 | State posteriors (cells by segments by states) where the method provides them. |
| write | uns/cnv_segments | table | Chromosome, start, end, state, integer copy number where reported, and method. |
| write | obs/cnv_aneuploid | bool | Cell-level call: copykat's classification, otherwise the rule in section 5. |
| write | obs/cnv_clone | categorical | Clone label from the method's clustering or phylogeny; null when none. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI, or a workspace handle, with counts and gene coordinates. |
| `method` | string | "copykat" | `copykat`, `numbat`, `scevan`, `casper` | copykat for expression-only data; numbat when numbat.allele_table is set. |
| `reference_obs_key` | string/null | null | — | obs column marking normal reference cells; required for numbat, null runs copykat reference-free. |
| `genome_build` | string | "hg38" | `hg38`, `hg19`, `mm10` | Gene coordinate build; must equal uns/genome_build recorded at ingest. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; wrapped callers use CPU, and CUDA applies to the planned HMM path. |
| `seed` | integer | 0 | min 0 | Seed for copykat MCMC segmentation and numbat initialisation. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `copykat` | object | — | — | Options used only when method is copykat. |
| `copykat.ks_cut` | number | 0.1 | — | Segmentation cut-off for MCMC breakpoints; halved when fewer than 25 breakpoints are found. |
| `copykat.win_size` | integer | 25 | — | Minimal window size in genes for segmentation. |
| `copykat.low_dr` | number | 0.05 | — | Minimal population fraction of genes used in smoothing. |
| `copykat.up_dr` | number | 0.1 | — | Minimum population fraction used in segmentation. |
| `copykat.ngene_chr` | integer | 5 | — | Minimum genes per chromosome, used in cell filtering. |
| `copykat.min_gene_per_cell` | integer | 200 | — | Minimum detected genes for a cell to be analysed. |
| `copykat.n_cores` | integer | 1 | — | Threads used by copykat. |
| `numbat` | object | — | — | Options used only when method is numbat. |
| `numbat.allele_table` | string/null | null | — | Per-cell allele counts at heterozygous SNPs; enables haplotype-aware calls and loss of heterozygosity. |
| `numbat.t` | number | 1e-05 | — | Transition probability of the segment HMM. |
| `numbat.gamma` | number | 20 | — | Beta-Binomial overdispersion of the allele model. |
| `numbat.max_iter` | integer | 2 | — | Maximum number of Numbat iterations. |
| `numbat.init_k` | integer | 3 | — | Number of clusters in the initial clustering. |
| `numbat.min_cells` | integer | 50 | — | Minimum cells per clone. |
| `numbat.tau` | number | 0.3 | — | Factor setting the maximum clone cost from cell number, between 0 and 1. |
| `numbat.ncores` | integer | 1 | — | Threads used by numbat. |
| `scevan` | object | — | — | Options used only when method is scevan. |
| `scevan.beta_vega` | number | 0.5 | — | Segmentation granularity; higher values give coarser segments. |
| `scevan.subclones` | boolean | true | — | Run subclone analysis after segmentation. |
| `scevan.ngenes_chr` | integer | 5 | — | Minimum expressed genes per chromosome. |
| `scevan.perc_genes` | number | 10 | — | Minimum percentage of genes expressed per cell. |
| `scevan.par_cores` | integer | 20 | — | Parallel cores used by SCEVAN. |
| `casper` | object | — | — | Options used only when method is casper. |
| `casper.remove_centromere` | boolean | true | — | Remove centromeric regions before segmentation. |
<!-- PARAMS:AUTO:END -->

Options are nested by method, and an option set for a method that is not selected is refused. The reference key is required for numbat, whose reference-expression argument has no default; for copykat, null selects the reference-free mode. `genome_build` must equal `uns/genome_build` and a mismatch is refused, not corrected. Allele counts are used only by numbat, and an allele table with any other method is refused.

## 7. MCP tool

Tool name `singlet_genetics_expression_cnv_inference` (definition in `tasks/mcp/singlet_genetics_expression_cnv_inference.json`). Example call and compact result:

```json
{"dataset": "data/tumour.singlet", "method": "copykat", "reference_obs_key": "normal_ref",
 "copykat": {"ks_cut": 0.1}}
```

```json
{"dataset": "data/tumour.singlet", "status": "completed",
 "wrote": ["obsm/cnv_state", "obsm/cnv_score", "uns/cnv_segments", "obs/cnv_aneuploid", "obs/cnv_clone"],
 "summary": {"method": "copykat", "cells_in": "<n>", "reference_cells": "<r>", "segments": "<w>",
   "cells_aneuploid": "<k>", "clones": "<c>"},
 "provenance_id": "<id>"}
```

Long-running: jobs above the implementation's size threshold return `queued` with a `job_id`. Stochastic: copykat's MCMC segmentation and numbat's initialisation use `seed`. Dry-run: returns `seconds`, `peak_memory_gb` and `device`, estimated from cell count, stored counts, segment count and method.

## 8. Benchmarks

**Shared protocol.** Each benchmark reports values per dataset and macro-averages across datasets. Every caller is set to its section 4 defaults at the commits listed there, with genome build hg38 and protein-coding genes set explicitly. Reference cells are disjoint from test cells and from the studies they come from. Stochastic callers use seeds 0 to 4, and tables report the mean and range. Callers that report only states are compared on the state scale of section 3.

### B1. Planted-segment recovery in held-out normal cells (proposed)

- **Goal**: how accurately each caller recovers planted gains and losses, and how often it calls unplanted normal cells aneuploid, when the truth is known by construction.
- **Ground truth**: planted by construction (recipe below). For gene $g$ in cell $c$, the planted total copy number $k_{cg}$ gives the relative state $y_{cg}=\operatorname{sign}(k_{cg}-2)$ of section 3, with span $\ell_g$ in bp as weight. Unplanted cells have $y_{cg}=0$ everywhere.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Immune-dominated stratum | Singlet catalogue cells annotated as non-malignant immune types; study identifiers recorded at generation | scRNA-seq, human; 500 reference and 2,000 test cells | section 12 | Blood-like cell-state composition |
| Stromal-dominated stratum | Singlet catalogue cells annotated as non-malignant stromal types; study identifiers recorded at generation | scRNA-seq, human; 500 reference and 2,000 test cells | section 12 | Different cell-state composition |

- **Generator recipe**
  1. For each stratum and seed $s$, draw 500 reference cells and 2,000 test cells from catalogue normal cells, with no study shared between reference and test. Half the test cells (1,000) are planted; the rest stay unplanted and provide the false-positive guardrail.
  2. Draw four profiles by seed. Each profile has two arm-level gains ($k=3$), two arm-level losses ($k=1$) and one 20 Mb focal segment at $k=1$ or $k=3$ on a third arm, all on autosomes. Assign each planted cell one profile at random.
  3. For each planted gene with target $k$ in a segment: if $k<2$, keep each count with probability $k/2$; if $k>2$, add $M=\operatorname{round}\big((k/2-1)N_{cw}\big)$ counts drawn multinomially over the cell's own counts in the segment, where $N_{cw}$ is the cell's count total in the segment.
  4. If a planted cell's total count exceeds its original total, thin all its counts binomially to the original total.
  5. Write the planted count matrix, gene coordinates, reference and test labels, the planted flag, the profile identifier per cell and the four gene-level $k$ vectors. The truth follows from these.
- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Relative-state accuracy | $\sum_{c\in P}\sum_g \ell_g\mathbf 1[\hat y_{cg}=y_{cg}]\big/\sum_{c\in P}\sum_g \ell_g$ over genes the caller reports, $P$ the planted cells; for score-only callers $\hat y$ is the sign at the caller's default threshold | higher | primary | — |
| Per-cell AUROC | Area under the ROC curve of $a_c=\sum_g \ell_g\lvert\hat y_{cg}\rvert/\sum_g \ell_g$ against the planted label; midrank for ties; per dataset | higher | primary | — |
| Normal-cell false-positive rate | Fraction of unplanted cells with `obs/cnv_aneuploid` TRUE at the caller's default | lower | guardrail | — |
| Gene coverage | Fraction of genes receiving a state from the caller | higher | guardrail | — |

- **Comparators**: copykat, scevan, casper and numbat (expression-only input), with inferCNV at its defaults as a callout; commits in section 4.
- **Protocol**: two strata, seeds 0 to 4, 500 reference and 2,000 test cells per stratum; expression only, with no allele table; the same test cells for every caller.
- **Acceptance criterion** (proposed): a new caller is accepted when its relative-state accuracy is at least the best comparator's minus 0.02 and its normal-cell false-positive rate is at most 0.05.
- **Known pitfalls**: thinning and resampling ignore cell-state effects and dosage compensation, and whole arms are easier than focal real events, so accuracy is an upper bound. Reference cells must be disjoint from the planted and unplanted test cells, or the baseline leaks information.

### B2. Diploid negative control (proposed)

- **Goal**: how often each caller calls cells aneuploid when they are diploid by origin.
- **Ground truth**: expert label by tissue origin. Each cell is labelled diploid because it comes from non-malignant tissue of a donor recorded as healthy, not because of its expression. The estimand is the per-cell probability of an aneuploid call given the diploid label, with no normalisation.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Immune cells from non-malignant donors | Singlet catalogue cells annotated as non-malignant immune types, donor status as recorded | scRNA-seq, human; 2,000 cells | section 12 | Immune-dominated |
| Non-malignant tissue cells | Singlet catalogue cells annotated as non-malignant tissue types, donor status as recorded | scRNA-seq, human; 2,000 cells | section 12 | Tissue of origin distinct from the immune set |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Cell false-positive rate | Cells with `obs/cnv_aneuploid` TRUE divided by all cells, at the caller's default | lower | primary | — |
| Genome false-positive fraction | Span-weighted fraction $\sum_g \ell_g\mathbf 1[\hat y_{cg}\neq 0]/\sum_g \ell_g$, averaged over cells | lower | secondary | — |

- **Comparators**: as in B1.
- **Protocol**: reference cells are other donors' cells of the same annotated type; test cells are never reference; defaults; seeds 0 to 4.
- **Acceptance criterion** (proposed): cell false-positive rate at most 0.05 at the caller's default threshold.
- **Known pitfalls**: immune cells differ from the reference by expression programmes, which reference-based callers read as dosage when the reference is not matched by type. Tissue adjacent to a tumour can carry clonal changes, so only donors recorded as healthy count as diploid.

### P1. Performance and scaling

Wall time and peak memory at 1,000, 10,000 and 100,000 cells from the immune stratum of B1, for each caller at 1 and 8 CPU threads, with CUDA reported for the planned HMM path. Hold fixed: hg38, protein-coding genes, 500 reference cells, count sparsity and seed 0. When an allele table is supplied, numbat's preparation time is reported separately. Proposed acceptance: singlet's implementation of each route is no slower than the fastest comparator at equal threads at every scale.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.reference_annotation_build`: Reference genome and annotation preparation for single-cell counting (including custom host-plus-pathogen and transgene references)
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `annotation.marker_based_cell_assignment`: Marker-based cell-level type assignment
- **Feeds**:
  - `genetics.clonal_substructure_inference`: Clonal and subclonal grouping from genotype-derived cell features
  - `genetics.dna_clone_assignment`: Assignment of scRNA-seq cells to DNA-defined tumour clones
- **Reads**: `layers/counts`, `var/chrom`, `var/start`, `var/end`, `uns/genome_build`, `obs/<reference_obs_key>`, `layers/alt_counts`, `layers/ref_counts`, `uns/phasing_panel`
- **Writes**: `obsm/cnv_state`, `obsm/cnv_posterior`, `obsm/cnv_score`, `uns/cnv_segments`, `obs/cnv_aneuploid`, `obs/cnv_clone`
<!-- CHAINING:AUTO:END -->

Workflow: tumour characterisation after cell-level QC and normal-cell annotation; clone-level tasks consume the segment states this task writes.

## 10. Risks, pitfalls and open questions

- **Published benchmarks**: [R6] and [R7] are cited only for the rankings stated in sections 2 and 4. Their dataset lists and metric definitions are not used here, so both statements rest on abstracts and summaries. A 2026 bioRxiv preprint [R8] is unreviewed, and no result from it is used.
- **Code not examined**: XClone, infercnvpy and copyVAE are absent from every table, comparator list and enum. The Numbat expression-only path is unverified: `run_numbat` takes `df_allele` without a default (R/main.R:69), so the B1 numbat comparator may need an empty allele table.
- **Licence and provenance**: the licence statements in section 12 gate any reuse. The Numbat DOI and year come from the repository citation file (`inst/CITATION`); the corpus holds no record for it.
- **Unknown quantities**: the attenuation $\beta$ in E2 is not measured for any dataset here. No matched DNA truth for clone-level consistency has been identified, so that benchmark, scored by the adjusted Rand index [R10], is not defined, and no paired DNA and RNA data in the catalogue are known.
- **Unsettled literature**: published rankings do not settle whether allele-aware callers help on expression-only data [R6][R7]. The planted design cannot test allele-aware modes, because no planted allele recipe is defined.
- **First experiment**: on normal cells of one catalogue tissue, apply the B2 design to copykat, numbat and inferCNV with matched and unmatched references, recording the cell false-positive rate; then check that the B1 generator reproduces planted library sizes and per-segment counts before any caller is scored on it.

## 11. References

R1. Tirosh I, Izar B, Prakadan SM, et al. Dissecting the multicellular ecosystem of metastatic melanoma by single-cell RNA-seq. *Science* 2016. doi:10.1126/science.aad0501 — verified (corpus)
R2. Gao R, Bai S, Henderson YC, et al. Delineating copy number and clonal substructure in human tumors from single-cell transcriptomes. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00795-2 — verified (corpus)
R3. Serin Harmanci A, Harmanci AO, et al. CaSpER identifies and visualizes CNV events by integrative analysis of single-cell or bulk RNA-sequencing data. *Nature Communications* 2020. doi:10.1038/s41467-019-13779-x — partial (corpus)
R4. De Falco A, Caruso F, Su XD, Varone A, Ceccarelli M. A variational algorithm to detect the clonal copy number substructure of tumors from scRNA-seq data. *Nature Communications* 2023;14:1074. doi:10.1038/s41467-023-36790-9 — verified (corpus)
R5. Gao T, Soldatov R, Sarkar H, Kurkiewicz A, Biederstedt E, Loh PR, Kharchenko PV. Haplotype-aware analysis of somatic copy number variations from single-cell transcriptomes. *Nature Biotechnology* 2022. doi:10.1038/s41587-022-01468-y — partial (repo)
R6. Schmid KT, Symeonidi A, Hlushchenko D, Richter ML, Tijhuis AE, Foijer F, Colomé-Tatché M. Benchmarking scRNA-seq copy number variation callers. *Nature Communications* 2025;16:8777. doi:10.1038/s41467-025-62359-9 — partial (search)
R7. Song et al. Benchmarking copy number aberrations inference tools using single-cell multi-omics datasets. *Briefings in Bioinformatics* 2025;26(2):bbaf076. doi:10.1093/bib/bbaf076 — partial (search)
R8. —. Benchmarking scRNA-seq Copy Number Inference: A Comprehensive Evaluation and Practitioner's Guide. bioRxiv, 2026 (preprint). https://www.biorxiv.org/content/10.64898/2026.04.12.718050v1.full — partial (search)
R9. Tickle T, Tirosh I, Georgescu C, Brown M, Haas B. inferCNV: Infer Copy Number Variation from Single-Cell RNA-Seq Data. R package version 1.23.0 (2023-12-01), GitHub software repository, broadinstitute/inferCNV. https://github.com/broadinstitute/inferCNV — verified (repo)
R10. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/broadinstitute/inferCNV | Timothy Tickle, Itay Tirosh, Christophe Georgescu (maintainer), Maxwell Brown, Brian Haas | BSD-3-Clause (DESCRIPTION: BSD_3_clause + file LICENSE; the LICENSE file holds the 2018 copyright header only) | Reference-subtraction baseline and defaults | callout |
| https://github.com/navinlabcode/copykat | Ruli Gao (author and maintainer) | GPL-2 (DESCRIPTION); no LICENSE file; a root `Copyright` file limits use to academic and non-profit research and asks commercial users to inquire with the copyright holder | Default expression-only caller | reimplement |
| https://github.com/akdess/CaSpER | Akdes Serin Harmanci, Arif O. Harmanci (maintainer: Akdes Serin Harmanci) | None stated (no LICENSE file, no License field) | Multi-scale HMM segmentation | reimplement |
| https://github.com/AntonioDeFalco/SCEVAN | A. De Falco and M. Ceccarelli (maintainer: A. De Falco) | Conflict: COPYING file holds GPL-3.0 text; DESCRIPTION says GPL-2 | Variational segmentation and subclones | reimplement |
| https://github.com/kharchenkolab/numbat | Teng Gao (maintainer), Ruslan Soldatov, Hirak Sarkar, Evan Biederstedt, Peter Kharchenko | MIT + file LICENSE (copyright Teng Gao, 2022) | Allele-aware HMM and allele emission | port |
