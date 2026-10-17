---
id: doublets.expected_rate_estimation
title: Expected doublet rate estimation
area: doublets
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [cell-calling.cell_vs_empty_droplet_calling, cell-calling.nucleus_vs_empty_calling, qc.low_quality_cell_detection]
feeds: [doublets.doublet_call_thresholding, doublets.expression_doublet_scoring, doublets.ensemble_doublet_calling]
reads: [uns/<library>/loaded_cells, uns/<library>/recovered_cells, obs/<annotation_column>]
writes: [uns/doublet_rate/<library>/expected_fraction, uns/doublet_rate/<library>/expected_count, uns/doublet_rate/<library>/homotypic_adjusted_fraction, uns/doublet_rate/<library>/bounds, uns/doublet_rate/<library>/basis]
devices: [cpu]
mcp_tool: singlet_doublets_expected_rate_estimation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Expected doublet rate estimation

> Estimates the share of cell-containing partitions that hold two or more cells for one library, from its loaded or recovered cell count, and supplies that share as the prior that doublet detectors and call thresholds use.

## 1. Question

Given the cells entering one library's droplets or wells (loaded, recovered or post-QC) and optionally cell-type labels, what share of cell-containing partitions is expected to hold two or more cells, what count does that imply, and what share of those doublets is heterotypic and therefore detectable? A correct answer states its count basis and agrees with an independent multiplet measurement. No single measurement covers all doublets, so agreement is judged against hashing, species or genotype truth, each of which sees only a subset (section 2).

## 2. Why this task matters and where the field stands

Expression-based detectors score barcodes by how mixed they look, but their call counts and thresholds take an expected rate as a prior, and this task supplies it [R2][R3]. Hashing and genotype multiplexing can check the rate, but they see only part of the doublets: hashing cannot see doublets whose cells come from the same sample [R5], and genotype multiplexing cannot see doublets of identical genotype [R6].

The status is **contested**, for four reasons.

1. **The inputs are ambiguous.** The linear rule of about 0.8 percent per 1,000 captured cells [R3] and the Pegasus constants imply partition counts within about 2 percent of each other (section 3), yet neither states whether its count is loaded, recovered or post-QC. The rate scales in proportion to the count, and loaded and recovered counts differ by about 1.6 in the vendor pairing [R8].
2. **Defaults disagree.** Scrublet's class default is 0.1 and the scanpy wrapper's is 0.05 (section 4), so comparisons across tools can compare different priors.
3. **Truth labels are partial.** Same-sample and identical-genotype doublets stay invisible to these labels, so the rates they yield are lower bounds on the total.
4. **Homotypic doublets look like singlets.** An unadjusted estimate therefore overstates detectable doublets. DoubletFinder scales its expected count by the homotypic proportion [R4], and this document reports the adjusted share as the lower bound.

Open problems: the count basis and partition count for each chemistry are not recorded in one versioned, machine-readable source, and when loading is overdispersed the rate cannot be identified from the cell count alone.

## 3. Theory and insight

**Occupancy.** Assign $N$ cells independently and uniformly to $D$ partitions and write $\lambda=N/D$. Cells per partition are $\mathrm{Binomial}(N,1/D)$, which approaches $\mathrm{Poisson}(\lambda)$ for large $D$ at fixed $\lambda$. The expected doublet share of cell-containing partitions, $m$, then takes three forms.

$$m_{\mathrm{exact}}(N,D)=1-\frac{N\,(1-1/D)^{N-1}}{D\,[1-(1-1/D)^{N}]}$$

This is exact for independent uniform assignment at any $N$ and $D$; the numerator is the expected number of single-cell partitions.

$$m(\lambda)=\frac{1-(1+\lambda)e^{-\lambda}}{1-e^{-\lambda}}=\frac{\lambda}{2}-\frac{\lambda^{2}}{12}+O(\lambda^{3})$$

This is the Poisson limit of the exact form, with error of order $1/D$: at $\lambda=0.1$ the two differ by about 0.005 percentage points at $D=10^4$ and 0.05 points at $D=10^3$ (computed here). The series holds for $\lambda$ of about 0.1 or less and shows that the rate is about half the cells per partition.

**Scaling.** For small $\lambda$ the expected number of two-cell partitions is

$$\mathbb{E}[D_2]=D\,\frac{\lambda^{2}}{2}e^{-\lambda}\approx\frac{N^{2}}{2D},$$

so doubling loading roughly quadruples doublets and doubles the rate. The published linear rules follow the same first-order law. A rule $m=kN$ matches $m\approx N/(2D)$ when $D=1/(2k)$. The 0.8 percent per 1,000 captured cells rule has $k=8\times10^{-6}$ and so implies $D=62{,}500$ on the captured basis (derived here). The Pegasus form has $\lambda=N\cdot0.00785/500$ and so implies $D=500/0.00785\approx6.4\times10^{4}$ on the basis of its input count (derived here). The same 0.8 percent at 1,600 loaded cells, the vendor pairing [R8], implies $D\approx10^{5}$ (derived here).

**Basis and normalisation.** At fixed $D$ the rate is proportional to $N$ at small $\lambda$, so reading loaded counts where recovered counts apply changes the rate by the ratio of the counts. Dividing doublets by the input cell count $N$ instead of by cell-containing partitions gives $m(1-e^{-\lambda})/\lambda$: a factor of 0.992 at $\lambda=0.016$ and 0.939 at $\lambda=0.128$ (computed here). The difference is negligible at typical loading and about 6 percent at high loading.

**Homotypic adjustment.** For annotated type frequencies $f_k$, $h=1-\sum_k f_k^{2}$ is the probability that two cells drawn independently belong to different types, and $mh$ estimates the detectable fraction. This holds when pairs form uniformly across the population and the number of cells is large relative to the number of types. If capture weight $w_k$ differs by type, the heterotypic share of doublets is $1-\sum_k\pi_k^{2}$ with $\pi_k\propto w_k f_k$ (derived here), so $h$ holds only under uniform capture.

**Species mixing.** With two species at fractions $p$ and $1-p$, a two-cell partition is mixed with probability $2p(1-p)$. At first order $x_{\mathrm{mix}}\approx 2p(1-p)\,m$, so $m\approx x_{\mathrm{mix}}/[2p(1-p)]$ for two-cell partitions with error-free species calls. Three-cell partitions and ambient RNA also add to $x_{\mathrm{mix}}$ and break the factor.

**Insight.** The algebra is settled; the uncertainty lies in $N$, $D$ and the annotation distribution. A model-based formulation adds a stated regime, an explicit count basis and a bound on the detectable share, which fixed tables do not provide.

| Symbol | Meaning |
|---|---|
| $N$, $D$, $\lambda$ | cells entering partitions; partitions; $N/D$ |
| $m$ | expected doublet share of cell-containing partitions |
| $h$, $f_k$, $\pi_k$ | heterotypic factor; annotated type frequencies; capture-weighted type frequencies |
| $x_{\mathrm{mix}}$, $p$ | observed mixed-species fraction; species fraction in a mixing experiment |

**Estimands.** Each output and truth is normalised as follows.

- `expected_fraction`: $m$, the expected doublet partitions over the expected cell-containing partitions.
- `expected_count`: $m$ times the called barcodes in the library, singlets and doublets together.
- `homotypic_adjusted_fraction`: $mh$, the expected share of cell-containing partitions holding two cells of different annotated types.
- `bounds`: lower $mh$, upper $m$, on the same denominator.
- B1 truth: the simulated share of cell-containing partitions with two or more cells, on the same denominator as $m$.
- B3 truth: the simulated heterotypic share among doublet partitions, which is a different denominator from $mh$ and is stated in B3.
- B2 truth: the tabulated percentage, assumed to use cell-containing partitions as denominator (section 10).

**Failure modes.** Overdispersed loading, from variable concentration or clumping, breaks the Poisson form, and the rate is then not identified from $N$ and $D$. Unequal species proportions and three-cell partitions break the species factor. Hashing and species truth cannot see same-sample or identical-genotype doublets. A rate used as an exact count, rather than as a prior with tolerance, can force calls where a detector has no signal.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Exact multinomial occupancy (GMM-Demux) | model-based | One minus the singlet share of non-empty partitions under independent uniform assignment | [R1] |
| Poisson occupancy limit | model-based | Large-$D$ limit of the exact form, closed in $\lambda$ | section 3 |
| Linear per-1,000 rule (scDblFinder) | heuristic | Expected doublet rate rises linearly with cell count, 0.8 percent per 1,000 cells | [R3]; code (section 12) |
| Pegasus closed form | heuristic | Poisson occupancy form with $\lambda$ proportional to cells; the slope is set from a 10x doublet table, per its code comment | code (section 12) |
| Homotypic adjustment (DoubletFinder) | hybrid | Scales the expected count by one minus the sum of squared annotation frequencies | [R4] |
| Expected-rate prior (Scrublet) | hybrid | Prior doublet rate and its standard deviation enter the neighbour-based score; class and wrapper defaults differ | [R2] |

The linear per-1,000 rule is scDblFinder's default and the comparator used throughout section 8. The Pegasus form is the Poisson limit with the same convention built in. The occupancy model is the proposed default because it states its regime and count basis. DoubletFinder's adjustment and Scrublet's prior are kept because they set the homotypic correction and the threshold prior used across tools. The species-mixing estimator, hashing-based calibration and the vendor table as a standalone method are excluded from the tables because their primary documents are available only in part (section 10).

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| GMM-Demux same-sample rate | rate | $1-$ singlets / non-empty partitions | GMM_Demux/estimator.py:77-82 @ 3fa799e |
| scDblFinder linear rule | dbr.per1k | 0.008 | R/misc.R:47-49; R/doubletThresholding.R:44; R/misc.R:400 @ devel e66180a |
| scDblFinder linear rule | only.heterotypic | TRUE | R/misc.R:47-49 @ devel e66180a |
| scDblFinder linear rule | dbr.sd | NULL; documented as 40 percent of dbr, minimum 0.02 | R/scDblFinder.R:48-51 (roxygen); R/doubletThresholding.R:51 (code) @ devel e66180a |
| scDblFinder thresholding | dbr.sd | 0.015 | R/doubletThresholding.R:203 (.getDoubletStats) @ devel e66180a |
| Pegasus closed form | lmd_base | 0.00785 | pegasus/tools/doublet_detection.py:20-30 |
| Pegasus closed form | ncell_base | 500 | pegasus/tools/doublet_detection.py:20-30 |
| Pegasus closed form | expected_doublet_rate | None (table-derived) | pegasus/tools/doublet_detection.py:459; docstring 486-487 |
| DoubletFinder | pN | 0.25 | R/doubletFinder.R:61 @ master 1b244d8 |
| DoubletFinder | nExp | no default (required) | R/doubletFinder.R:63 @ master 1b244d8 |
| DoubletFinder | homotypic-adjusted nExp | round(nExp × (1 − sum of squared frequencies)) | R/doubletFinder.R:52-53 (example code); R/modelHomotypic.R:37-39 @ master 1b244d8 |
| Scrublet | expected_doublet_rate (class) | 0.1 | src/scrublet/scrublet.py:6 and docstring line 28 @ master 88d6efe |
| Scrublet | stdev_doublet_rate | 0.02 | src/scrublet/scrublet.py:6 @ master 88d6efe |
| Scrublet via scanpy | expected_doublet_rate (wrapper) | 0.05 | src/scanpy/preprocessing/_scrublet/__init__.py:33 |
| Scrublet via scanpy | expected_doublet_rate (dataclass) | 0.1 | src/scanpy/preprocessing/_scrublet/core.py:74 |

## 5. Proposed singlet approach

Routes are assigned per repository in section 12: the occupancy and Pegasus formulas are ported, the scDblFinder linear rule is reimplemented from its documented convention, and Scrublet and scanpy supply comparator priors only.

**Model-based formulation.** The output is the exact occupancy share, with $D$ as the one model parameter per count basis. Until calibration libraries exist, $D$ is set by convention and the reported bounds reflect only the basis and the homotypic adjustment; these are labelled prior-only, not measured uncertainty. Once labelled libraries exist, $\log D$ receives a prior fitted to them, and its posterior predictive interval replaces the convention.

**Falsification.** The formulation fails if (i) the exact or Poisson form departs from simulated occupancy by more than three standard errors in its stated regime (B1); (ii) no single $D$ per basis reproduces the vendor table within the B2 tolerance; or (iii) under uniform capture the homotypic factor misses simulated heterotypic shares beyond the B3 tolerance. Failure under type-specific capture is expected and is reported as a limit, not a defect.

**ML stack.** The point estimate needs no training. The closed forms and the one-parameter fit of $D$ are scalar and execute on CPU in C++, so PyTorch and CUDA kernels are not used. A hierarchical model over many labelled libraries would need PyTorch or a sampler and is deferred until labelled data exist.

**Kernels and streaming.** Closed forms use `log1p` and `expm1`, with a series below a small cutoff, to avoid cancellation at small $\lambda$. The homotypic sum is one streaming scan over categorical codes, with memory proportional to the number of annotation groups. No count matrix is read.

**Defaults for agents.** Method `exact_multinomial`; `count_basis` must be given; `partitions` is 62,500 for recovered or post-QC counts and must be given for loaded counts; leave `annotation_column` null unless labels exist.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/<library>/loaded_cells | int | cells loaded, when the dataset records them |
| read | uns/<library>/recovered_cells | int | barcodes called as cells before quality filtering |
| read | obs/<annotation_column> | categorical | cell-type labels for the homotypic adjustment (optional) |
| write | uns/doublet_rate/<library>/expected_fraction | float | expected doublet share $m$ |
| write | uns/doublet_rate/<library>/expected_count | float | $m$ times the called barcodes |
| write | uns/doublet_rate/<library>/homotypic_adjusted_fraction | float or null | $mh$; null without labels |
| write | uns/doublet_rate/<library>/bounds | float pair | lower $mh$, upper $m$ |
| write | uns/doublet_rate/<library>/basis | string | loaded, recovered or post_qc |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `count_basis` | string | required | `loaded`, `recovered`, `post_qc` | Which cell count enters the model. Required because loaded and recovered counts give different rates; there is no default. |
| `method` | string | "exact_multinomial" | `exact_multinomial`, `scdblfinder_linear`, `pegasus_linear` | exact_multinomial is the occupancy model (default). The linear methods are published comparators. |
| `library` | string/null | null | — | Library key under uns/ for multi-library datasets. Null treats the dataset as one library. |
| `cell_counts` | object | — | — | Cell count overrides; a null field is read from uns/<library>/loaded_cells or recovered_cells. |
| `cell_counts.loaded` | integer/null | null | min 1 | Cells loaded into the instrument. |
| `cell_counts.recovered` | integer/null | null | min 1 | Barcodes called as cells before quality filtering. |
| `annotation_column` | string/null | null | — | obs column of cell-type labels for the homotypic adjustment. Null reports the unadjusted rate only. |
| `exact_multinomial` | object | — | — | Options used only when method is exact_multinomial. |
| `exact_multinomial.partitions` | number/null | null | > 0 | Partitions D. Null uses 62500 for recovered or post_qc counts; loaded counts require a value. |
| `scdblfinder_linear` | object | — | — | Options used only when method is scdblfinder_linear. |
| `scdblfinder_linear.dbr_per_1k` | number | 0.008 | > 0 | Expected doublet fraction per 1,000 cells. |
| `pegasus_linear` | object | — | — | Options used only when method is pegasus_linear. |
| `pegasus_linear.lmd_base` | number | 0.00785 | > 0 | Loading constant per ncell_base cells. |
| `pegasus_linear.ncell_base` | number | 500 | > 0 | Reference cell count for lmd_base. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | auto and cpu run on CPU; cuda is accepted and unused because the closed forms need no accelerator. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing. |
| `overwrite` | boolean | false | — | Replace existing uns/doublet_rate members for this library instead of failing. |
<!-- PARAMS:AUTO:END -->

Only `exact_multinomial` reads `partitions`; the linear methods ignore it, as they ignore the annotation column. Loaded counts without a `partitions` value fail before any write. `annotation_column` changes only `homotypic_adjusted_fraction` and the lower bound, and without labels both bounds equal $m$. `cell_counts` fields override stored counts one at a time, and a missing count for the requested basis fails the call. Nested options for an unselected method are ignored.

## 7. MCP tool

Tool `singlet_doublets_expected_rate_estimation` (definition in `tasks/mcp/singlet_doublets_expected_rate_estimation.json`). Example call for a library with 1,000 recovered cells, and its compact result:

```json
{"dataset": "lib_03.singlet", "count_basis": "recovered", "library": "lib_03"}
```

```json
{
  "dataset": "lib_03.singlet",
  "status": "completed",
  "wrote": ["uns/doublet_rate/lib_03/expected_fraction", "uns/doublet_rate/lib_03/expected_count", "uns/doublet_rate/lib_03/homotypic_adjusted_fraction", "uns/doublet_rate/lib_03/bounds", "uns/doublet_rate/lib_03/basis"],
  "summary": {"expected_fraction": 0.00797, "expected_count": 7.97, "homotypic_adjusted_fraction": null, "bounds": [0.00797, 0.00797], "poisson_fraction": 0.00798, "lambda": 0.016, "partitions": 62500, "denominator_barcodes": 1000, "method": "exact_multinomial", "count_basis": "recovered"},
  "provenance_id": "prov_example"
}
```

Long-running: no; the cost is one scan of the annotation column when labels are given. Stochastic: no; the output is a function of the inputs. Dry run: returns `status` dry_run with an `estimate` block (seconds, peak memory, device cpu) and writes nothing.

## 8. Benchmarks

**Shared protocol.** Every benchmark states its denominator, which is cell-containing partitions unless its truth defines another. Methods receive identical counts and labels. Replicates use seeds 0 to $R-1$, with $R$ stated per benchmark. Thresholds are fixed before scoring, and no threshold is tuned on the scored libraries. Wall time and peak memory are recorded for each comparator on the same CPU node after one warm-up call. Acceptance criteria are numeric and proposed unless a benchmark names its source.

### B1. Occupancy closed forms against planted partitions

- **Goal**: test whether the exact and Poisson forms match simulated multiplet shares across the loading range where they are used.
- **Ground truth**: planted simulation. For each simulated library the truth is the number of partitions with at least two cells divided by the number with at least one, counted from the assignment; this is the normalisation of `expected_fraction`.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Uniform occupancy grid | generator recipe below | simulated cells only | — | $\lambda\in\{0.01,0.05,0.1,0.3,1\}$; $D\in\{10^3,10^4,10^5\}$ |

Generator recipe: (1) for each $(\lambda,D)$ set $N=\mathrm{round}(\lambda D)$; (2) assign $N$ cells to $D$ partitions uniformly and independently with a seeded generator; (3) count partitions with at least one and with at least two cells; (4) repeat for $R=200$ replicates.

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| abs_error_exact | absolute difference between $m_{\mathrm{exact}}(N,D)$ and the replicate mean, in percentage points | minimise | primary | [R1] |
| abs_error_poisson | absolute difference between $m(\lambda)$ and the replicate mean, reported by $\lambda$ | minimise | secondary | [R1] |
| z_score | difference between the exact form and the replicate mean, divided by the standard error of that mean | report | guardrail | — |

- **Comparators**: the Poisson form and its series $\lambda/2-\lambda^2/12$.
- **Protocol**: the recipe above only; one row per grid cell; the standard error is the replicate standard deviation divided by $\sqrt{R}$.
- **Acceptance criterion** (proposed): in every grid cell the exact form lies within three standard errors of the replicate mean, and the Poisson form does likewise wherever $D\ge10^4$.
- **Known pitfalls**: the simulation implements the model, so the test checks algebra and the Poisson approximation, not biology. At $D=10^3$ the Monte Carlo error is about three times the Poisson gap, so the Poisson check is uninformative there.

### B2. Vendor multiplet table consistency

- **Goal**: test whether one partition count per basis reproduces the vendor's standard 3-prime v3.1 multiplet table.
- **Ground truth**: consistency with a published table, not an independent measurement. Each row gives a cell count and a percentage; the percentage is assumed to be a share of cell-containing partitions (section 10).

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Standard 3-prime v3.1 multiplet table | [R8]; https://assets.ctfassets.net/an68im79xiti/1eX2FPdpeCgnCJtw4fj9Hx/7cb84edaa9eca04b607f9193162994de/CG000204_ChromiumNextGEMSingleCell3_v3.1_Rev_D.pdf | table of loaded and recovered counts against percentage; droplet 3-prime v3.1 | — | undated document |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| max_abs_deviation_pp | largest absolute difference, in percentage points, between predicted and tabulated values after fitting $D$ to the anchor row | minimise | primary | [R8] |
| anchor_D | $D$ solved from the anchor row | report | guardrail | — |

- **Comparators**: the Poisson form with fitted $D$; the linear rule and the Pegasus form with their own constants.
- **Protocol**: fix the anchor at the tabulated 0.8 percent at 1,600 loaded cells and fit $D$ on the loaded basis; predict the other loaded rows; repeat with the 1,000-recovered anchor on the recovered basis; report which basis fits better.
- **Acceptance criterion** (proposed): every predicted row lies within 0.3 percentage points of its tabulated value. The fitted $D\approx10^{5}$ predicts 6.3 percent at 12,800 loaded cells (computed here), so the high-load rows bind the criterion.
- **Known pitfalls**: the table may itself be fitted with a similar model, so agreement can be circular; mixing loaded and recovered anchors moves $D$ by the count ratio.

### B3. Heterotypic factor under planted cell-type structure

- **Goal**: test whether $h=1-\sum_k f_k^{2}$ predicts the heterotypic share of doublets under uniform capture, and measure its bias when capture differs by type.
- **Ground truth**: planted simulation. For each library the truth is the share of doublet partitions (two or more cells) whose two-cell members carry different simulated types; the prediction uses the same denominator.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated type labels | generator recipe; $f_k$ from the author-annotated part of the singlet catalogue | simulated; $K\in\{2,10,50\}$ types | — | frequency settings: equal, geometric ($f_k\propto2^{-k}$), empirical |
| Type capture weights | generator recipe; $w_k$ drawn once per type | simulated | — | used only in the weighted scenario |

Generator recipe: (1) draw $N$ cell types independently from $f$; (2) in the weighted scenario keep a cell of type $k$ with probability $w_k/\max_j w_j$, and in the uniform scenario keep all cells; (3) with $\lambda=0.1$ and $D=10^5$ (proposed), assign kept cells to partitions uniformly; (4) among two-cell partitions record whether the types differ, and compute $1-\sum_k f_k^{2}$ and $1-\sum_k\pi_k^{2}$; (5) repeat for $R=200$ replicates.

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| heterotypic_share_bias | absolute difference between $h$ and the simulated heterotypic share, uniform scenario | minimise | primary | [R4] |
| weighted_bias | absolute difference between $1-\sum_k\pi_k^{2}$ and the simulated share, weighted scenario | minimise (checks the derivation) | secondary | — |

- **Comparators**: no adjustment ($h=1$) and the DoubletFinder homotypic proportion, which is the same sum.
- **Protocol**: the recipe above over three frequency settings, three values of $K$ and two scenarios.
- **Acceptance criterion** (proposed): in the uniform scenario the bias is at most 0.1 in every setting; in the weighted scenario the derived prediction is within 0.1 of the simulated share, with unadjusted $h=1$ reported beside it.
- **Known pitfalls**: under uniform capture agreement holds by construction, so the weighted scenario carries the test; finer annotation raises $h$, so results depend on label granularity.

### P1. Performance and scaling

Wall time and peak memory of the closed forms and of the homotypic sum on CPU, at 500, 10,000 and 100,000 recovered cells and with 2, 10 and 100 annotation groups. Comparators are the linear rule, the Pegasus form and an exact occupancy evaluated as in the GMM-Demux estimator. Hold chemistry, basis and output precision fixed, and record the annotation scan separately from the closed forms. Acceptance criterion (proposed): closed-form wall time does not grow with cell count beyond timer noise, and the annotation scan grows linearly with cells, with memory linear in groups.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `cell-calling.nucleus_vs_empty_calling`: Nucleus versus empty-droplet calling in single-nucleus RNA-seq
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
- **Feeds**:
  - `doublets.doublet_call_thresholding`: Doublet score-to-call thresholding
  - `doublets.expression_doublet_scoring`: Expression-based per-cell doublet scoring
  - `doublets.ensemble_doublet_calling`: Ensemble and consensus doublet calling
- **Reads**: `uns/<library>/loaded_cells`, `uns/<library>/recovered_cells`, `obs/<annotation_column>`
- **Writes**: `uns/doublet_rate/<library>/expected_fraction`, `uns/doublet_rate/<library>/expected_count`, `uns/doublet_rate/<library>/homotypic_adjusted_fraction`, `uns/doublet_rate/<library>/bounds`, `uns/doublet_rate/<library>/basis`
<!-- CHAINING:AUTO:END -->

Upstream of doublet scoring and call thresholding. Cell counts come from cell calling, and the scoring steps read the output as their prior.

## 10. Risks, pitfalls and open questions

1. **Multiplet truth data.** Species-mixing, hashing and genotype benchmarks are not published here, because their datasets lack stable accessions, loaded counts and fixed threshold definitions. The Bloom 2018 article is not available to this document beyond its citing descriptions, so its unequal-mixing equations are not used and the species factor in section 3 is a first-order derivation [R7]. Other 10x species-mixing notes are not used as calibration sources. The first experiment is a species-mixing library with recorded loaded counts.
2. **Vendor table provenance.** The 1,000-recovered to 1,600-loaded pairing at about 0.8 percent is taken from the CG000204 Rev D guide [R8]; its full multiplet table is not available to this document, and a later revision of the dual-index Gene Expression guide (CG000315 Rev E) lists about 1,650 loaded cells for the same recovered count. The denominator of the tabulated percentage is assumed. No Chromium X or LT table is used, and chemistry tables must not be mixed.
3. **Count basis and partition count.** The Pegasus code does not state whether its count is loaded or recovered, and the 10x knowledge-base article it cites is not available to this document. The 62,500 default is derived from the captured-cell rule and has no chemistry-specific calibration.
4. **Code facts.** The GMM-Demux estimator file also holds asymptotic-rate, cell-number and cluster-level multiplet estimators; only the same-sample formula is used here. The scDblFinder `dbr.sd` default is documented in roxygen and implemented in code (section 4).
5. **Detector prior sensitivity.** Scrublet's class default and the scanpy wrapper default differ, and nothing in this document measures how call counts move with the prior or with `dbr.sd`.
6. **Unread literature.** A PLOS ONE comparison of multiplet removal methods (doi:10.1371/journal.pone.0333687) was not read in full, so no result from it is used. Independent cross-chemistry validation of the expected rate is absent from the sources cited.

## 11. References

R1. Xin H, Yan Q, Jiang Y, et al. GMM-Demux: sample demultiplexing, multiplet detection, experiment planning, and novel cell-type verification in single cell sequencing. *Genome Biology* 2020. doi:10.1186/s13059-020-02084-2 — verified (corpus)
R2. Wolock SL, Lopez R, Klein AM. Scrublet: computational identification of cell doublets in single-cell transcriptomic data. *Cell Systems* 2019. doi:10.1016/j.cels.2018.11.005 — verified (corpus)
R3. Germain PL, Lun A, Garcia Meixide C, Macnair W, Robinson MD. Doublet identification in single-cell sequencing data using scDblFinder. *F1000Research* 2022. doi:10.12688/f1000research.73600.2 — verified (corpus)
R4. McGinnis CS, Murrow LM, Gartner ZJ. DoubletFinder: doublet detection in single-cell RNA sequencing data using artificial nearest neighbors. *Cell Systems* 2019. doi:10.1016/j.cels.2019.03.003 — verified (corpus)
R5. Stoeckius M, Zheng S, Houck-Loomis B, et al. Cell Hashing with barcoded antibodies enables multiplexing and doublet detection for single cell genomics. *Genome Biology* 2018. doi:10.1186/s13059-018-1603-1 — partial (corpus)
R6. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018. doi:10.1038/nbt.4042 — verified (corpus)
R7. Bloom JD. Estimating the frequency of multiplets in single-cell RNA sequencing from cell-mixing experiments. *PeerJ* 2018;6:e5578. doi:10.7717/peerj.5578 — partial (search)
R8. 10x Genomics. Chromium Next GEM Single Cell 3-prime v3.1 user guide, CG000204 Rev D. n.d. — partial (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/CHPGenetics/GMM-demux | Hongyi Xin (package author); README also lists Qi Yan, Yale Jiang, Jiadi Luo, Carla Erb, Richard Duerr, Kong Chen, Wei Chen | MIT (LICENSE; copyright 2019 Hongyi Xin) | exact multinomial occupancy formula (estimator.py) | port |
| https://github.com/lilab-bcb/pegasus | Yiming Yang, Joshua Gould, Bo Li (package author); Broad Institute and Genentech copyright | BSD-3-Clause (LICENSE; Broad Institute 2018-2020, Genentech from 2021) | Pegasus closed form and table lookup | port |
| https://github.com/plger/scDblFinder | Pierre-Luc Germain (author, maintainer); Aaron Lun (contributor) | GPL-3 (DESCRIPTION; LICENSE file is GPL v3 text) | linear rule and heterotypic restriction | reimplement |
| https://github.com/chris-mcginnis-ucsf/DoubletFinder | Chris McGinnis (DESCRIPTION author) | CC0 (DESCRIPTION; no LICENSE file at repository root) | homotypic proportion | port |
| https://github.com/AllonKleinLab/scrublet | Samuel L. Wolock (package author) | MIT (LICENSE; copyright 2018 Samuel Wolock) | prior defaults | callout |
| https://github.com/scverse/scanpy | Author list in pyproject.toml | BSD-3-Clause (LICENSE) | wrapper default for the Scrublet prior | callout |
