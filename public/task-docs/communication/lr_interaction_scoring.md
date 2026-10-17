---
id: communication.lr_interaction_scoring
title: Sender-receiver ligand-receptor interaction scoring
area: communication
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [normalization.size_factor_estimation, annotation.cluster_label_assignment, communication.lr_resource_curation]
feeds: [communication.differential_communication, communication.ligand_activity_inference, statistics.multiple_testing_control]
reads: [X, obs/<groupby>, uns/<resource>]
writes: [uns/lr_interactions, uns/lr_interactions_params]
devices: [cpu, cuda]
mcp_tool: singlet_communication_lr_interaction_scoring
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Sender-receiver ligand-receptor interaction scoring

> For every ordered pair of annotated cell groups, scores each ligand-receptor pair from the group-level expression of its ligand in the sender and its receptor in the receiver, and reports a label-permutation p-value and a false-discovery rate for every tuple.

## 1. Question

Which ligand-receptor pairs are plausibly active from each annotated sender group to each receiver group in a steady-state, dissociated single-cell dataset? The input is a normalised expression layer, one group label per cell and a resource that lists ligand-receptor pairs with heteromeric complexes; the output is a ranked table of (sender, receiver, ligand, receptor, complex) tuples with a score, a permutation p-value and a false-discovery rate. A correct answer in the literature is a ranking enriched for interactions that independent evidence supports, because no gold standard exists.

## 2. Why this task matters and where the field stands

Cells in a tissue exchange signals through ligand-receptor (LR) pairs, and a dissociated dataset gives a candidate map of those exchanges without perturbing the tissue. The map rests on a proxy: mRNA levels of a ligand and its receptor stand in for protein abundance and for availability at the receiver [R1]. The published scorers have diversified [R14], and they differ mainly in how they combine two group-level summaries, as the formulas in section 3 show.

Status: **contested**. The best-practices chapter on cell-cell communication summarises comparisons as limited consensus among tools, which depends on the choice of method and resource [R2, R3, R4]. Independent evaluations also find the tools fairly robust to added noise [R2, R3, R4] and largely concordant with spatial information [R2, R4]. The chapter therefore suggests checking a prediction against more than one method and against complementary evidence.

Open problems:

- No accepted gold standard exists. The Open Problems task uses spatial co-localisation of the pair and of the cell types as its proxy [R12, R13]; Liu et al. compare tools with spatial information as an external reference [R4].
- Rankings depend on the choice of resource [R2, R3, R4].
- The Open Problems truth uses non-mirrored cell-type pairs, so a directed prediction can be scored only in part [R13].

## 3. Theory and insight

Let cell $i$ carry group label $g_i$, let $x_{ig}$ be the value of gene $g$ in the input layer, and let $\mu_{kg}$ be the mean of $x_{ig}$ over cells with $g_i=k$. For an ordered pair of groups $(a,b)$ with sender $a$ and receiver $b$, a ligand $\ell$ and a receptor $r$, the sender summary is $\mu_{a\ell}$ and the receiver summary is $\mu_{br}$. The scorers combine them differently. The mean score of CellPhoneDB, implemented in LIANA, is

$$S^{\mathrm{cp}}_{ab\ell r}=\tfrac12\,(\mu_{a\ell}+\mu_{br}),$$

and squidpy reports the same quantity as its means column. Squidpy's test statistic is $T=\mu_{a\ell}+\mu_{br}=2S^{\mathrm{cp}}$, so the two orderings agree wherever both are defined. CellChat takes the trimean $\bar x_{k\ell}$ of each group, forms the product $L_{ab\ell r}=\bar x_{a\ell}\bar x_{br}$, and applies a saturating transform:

$$P_{ab\ell r}=\frac{L_{ab\ell r}^{\,n}}{K_h^{\,n}+L_{ab\ell r}^{\,n}},\qquad K_h=0.5,\ n=1.$$

NATMI's edge weight is $\mu_{a\ell}\mu_{br}$, and its specificity weight multiplies each partner's share of expression over all groups, $\frac{\mu_{a\ell}}{\sum_c\mu_{c\ell}}\cdot\frac{\mu_{br}}{\sum_{c'}\mu_{c'r}}$. The SingleCellSignalR-style score in LIANA is

$$R_{ab\ell r}=\frac{\sqrt{\mu_{a\ell}\,\mu_{br}}}{\sqrt{\mu_{a\ell}\,\mu_{br}}+\bar m},$$

where $\bar m$ is the mean of the whole matrix.

**Null and p-values.** Each permutation method draws $B$ random reassignments of cell labels that keep group sizes fixed, recomputes the statistic as $S^{(k)}$, and reports

$$p_{ab\ell r}=\frac1B\sum_{k=1}^{B}\mathbf 1\!\left[S^{(k)}_{ab\ell r}\ge S_{ab\ell r}\right].$$

LIANA also counts draws within a relative tolerance of $10^{-6}$ as ties, squidpy uses a strict inequality, and CellChat counts $P^{(k)}>P$ over $B=100$ draws. The resolution is $1/B$: with $B=1000$ the smallest nonzero p-value is 0.001, and $p=0$ means $p<1/B$.

**Estimands.** Each output measures the following.

- Score: sender-receiver co-expression of one tuple on the mean, trimean or probability scale of the input layer as supplied; singlet applies no further scaling.
- p-value: the probability, under the label null, that the statistic reaches its observed value.
- FDR: Benjamini-Hochberg over all tuples a method tests in one call.

**Regime of validity.** The label null is exact when cells are exchangeable under no communication. With finite $B$, the Monte Carlo standard error of $p$ is $\sqrt{p(1-p)/B}$. The mean score is defined for groups with at least `min_cells` cells and is set to zero when either partner mean is zero. The trimean averages the 25th, 50th, 50th and 75th percentiles of a group's values, so it is zero when at least about three quarters of those values are zero. For $L\ll K_h$ the Hill probability is approximately $L/K_h$, which is linear, and it saturates near 1 for $L\gg K_h$, so products above about $K_h$ are compressed. The square-root score lies in $(0,1)$ and approaches 1 only when the product dominates the global mean.

**Assumptions and failure modes.** Additive scores rank a highly expressed ligand high in any group, specific or not. Multiplicative scores need expression on both sides and vanish when either side is zero. Specificity weights reward groups that express a partner relatively more, and are uninformative when a single source or target label exists, because every share is then one. Every score averages within groups, so a signal carried by a rare subpopulation is diluted. The label null is valid only when cells are exchangeable under no communication. Cells from one donor or one niche are not exchangeable, so shuffled labels can reproduce the observed co-expression more often than the nominal level; the calibration question is covered by statistics.pvalue_null_calibration.

**Insight.** The heuristics work because each is a monotone function of two interpretable summaries, and the label null needs no distributional model. Because the scorers combine the same two summaries differently, agreement between them cannot by itself serve as an acceptance test. A model adds what the heuristics lack. A fitted count model per group pair gives a posterior probability and credible intervals, borrows strength between groups with few cells, and can include donor effects that a label shuffle cannot represent. Benchmarks that build their truth from the same resource as the method are circular (section 8).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CellPhoneDB (LIANA implementation) | heuristic | Mean of the two partner group means, with complexes represented by subunits, and a label-permutation p-value | [R6] |
| CellChat | hybrid | Trimean product transformed by a Hill saturation, with a permutation of group labels | [R7], [R8] |
| NATMI | heuristic | Product of mean partner expression and product of partner specificities | [R9] |
| SingleCellSignalR (LIANA implementation) | heuristic | Bounded square-root product relative to the global mean | [R10] |
| Squidpy ligrec | heuristic | Sum of partner means, strict permutation test, expression-fraction mask and optional correction | [R11] |

CellPhoneDB [R6] and CellChat [R7, R8] are the original published scorers, and the comparison studies evaluate them [R2, R3]. [R6] describes CellPhoneDB version 2, as the best-practices chapter does. The CellChat parameters come from the pinned code (version 2.2.0.9001), so [R7] is cited for the formulas and [R8] for the protocol. LIANA reimplements CellPhoneDB, CellChat, NATMI and SingleCellSignalR behind one interface with a shared resource and shared filters [R5], so its code is the parity reference here. Squidpy's ligrec test [R11] is the published sum-statistic alternative. Rank aggregation across methods [R5] is a consensus layer rather than a scorer, and sits outside the method list.

| Method | Parameter | Value | Source |
|---|---|---|---|
| LIANA family (CellPhoneDB, NATMI, SingleCellSignalR) | expr_prop | 0.05 | liana-py@08590db `src/liana/_core/_constants.py:18` |
| LIANA family | min_cells | 5 | `_constants.py:17` |
| LIANA family | n_perms | 1000 | `_constants.py:20` |
| LIANA family | seed | 1337 | `_constants.py:21` |
| LIANA family | resource_name | consensus | `_constants.py:23` |
| CellPhoneDB | score | mean of partner means, zero if either is zero | `src/liana/method/sc/_cellphonedb.py:35-36` |
| LIANA permutations | tie tolerance (relative) | 1e-6 | `src/liana/_core/_pipe_utils/_get_mean_perms.py:38`; p-value rule at `:367-397` |
| LIANA permutations | permutation block cap | 2^24 index elements | `_get_mean_perms.py:44` |
| LIANA rank aggregation | aggregate_method; n_perms | rra; 1000 (None skips p-values) | `src/liana/method/sc/_rank_aggregate.py:95`, `:102` |
| NATMI | edge weight | product of mean ligand and receptor | forrest-lab/NATMI@c7ad5a9 `ExtractEdges.py:247` |
| NATMI | detection threshold (plotting only) | 0.2, example value | `README.md:321` |
| SingleCellSignalR (LIANA) | score | square-root product over (square-root product plus mean matrix) | liana-py@08590db `src/liana/method/sc/_singlecellsignalr.py:22-24` |
| CellChat | type; trim | triMean; 0.1 (trim is read only by truncatedMean and thresholdedMean) | jinworks/CellChat@75253cd `R/modeling.R:63`, `:70-71` |
| CellChat | nboot; seed.use | 100; 1 | `R/modeling.R:65` |
| CellChat | Kh; n | 0.5; 1 | `R/modeling.R:65` |
| CellChat | p-value | nReject divided by nboot, strict comparison | `R/modeling.R:303-304` |
| CellChat | min.cells in filterCommunication | 10 | `R/modeling.R:908` |
| Squidpy ligrec | n_perms | 1000 | scverse/squidpy@f030690 `src/squidpy/gr/_ligrec.py:585` |
| Squidpy ligrec | threshold | 0.01 | `_ligrec.py:578` |
| Squidpy ligrec | complex_policy | min | `_ligrec.py:577` |
| Squidpy ligrec | corr_method; alpha | None; 0.05 | `_ligrec.py:579`, `:588` |
| Squidpy ligrec | threshold in private helper | 0.1, overridden by the public call | `_ligrec.py:707`, call at `:349` |
| Squidpy ligrec | statistic and p-value | sum of means; permuted sums above observed, divided by n_perms | `_ligrec.py:690-692`, `:798` |

## 5. Proposed singlet approach

Permissive-licence implementations are ported, and copyleft ones are reimplemented from their published formulas; the route for each method is given in section 12. The original CellPhoneDB is used as a comparator only. Context-aware extensions such as Tensor-cell2cell [R15] belong to the differential task.

**Default.** `method = cellphonedb` with `resource = consensus`, `min_cells = 5`, `expr_prop = 0.05`, `n_perms = 1000` and `seed = 1337`, all taken from section 4. It is the default because its statistic is the simplest of the permutation scorers and the LIANA implementation documents these values. It is a standard to beat, not a claim that it is the best scorer.

**Model-based proposal.** For each tuple, a hierarchical negative-binomial model of ligand counts in sender cells and receptor counts in receiver cells, with donor random effects, is fitted:

$$\log \mathbb E[y_{ij\ell}] = \log s_i + \eta_{a(i)\ell} + \gamma_{j\ell},\qquad \Delta_{ab\ell r}=\eta_{a\ell}+\eta'_{br},$$

where $s_i$ is the size factor, $\gamma_{j\ell}$ the donor effect, and $\eta'$ the receptor analogue fitted on receiver cells. The output is $\Pr(\Delta_{ab\ell r}>\tau\mid\text{data})$ for a background level $\tau$ learned from the catalogue, with credible intervals.

**Falsification.** The model is adopted only if, on B2, its AUPRC under the held-out resource exceeds that of the default with non-overlapping 95 percent bootstrap intervals, and if on the label null the rate at which null tuples exceed posterior 0.95 lies within a binomial interval around 0.05. Failing either check falsifies the proposal.

**Stack and devices.** PyTorch fits the model by MAP or stochastic variational inference with a negative-binomial likelihood. Group sums, group means and the permutation nulls are small, fixed-form and repeated many times, so they are hard-coded in CUDA with cuSPARSE reductions, with a compiled CPU path. Permutations are drawn in blocks so that peak memory does not grow with `n_perms`, following LIANA's chunking. Streaming is not claimed.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | X | float, sparse or dense | normalised expression used for group means and trimeans |
| read | obs/<groupby> | categorical | sender and receiver group labels |
| read | uns/<resource> | table | ligand-receptor pairs with subunits, directionality and evidence tags |
| write | uns/lr_interactions | table | ranked tuples: method, sender, receiver, ligand, receptor, complex, score, pvalue, fdr, rank |
| write | uns/lr_interactions_params | dict | groupby, resource, filters, n_perms, seed, method and library versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `groupby` | string | required | — | obs column holding the sender and receiver group labels, for example cell_type or leiden. |
| `method` | string | "cellphonedb" | `cellphonedb`, `natmi`, `singlecellsignalr`, `cellchat`, `squidpy_ligrec` | Scoring method; cellphonedb is the default mean-score standard, the others are published alternatives. |
| `resource` | string | "consensus" | — | Ligand-receptor resource: a name in uns or a built-in name; consensus is the LIANA default. |
| `filters` | object | — | — | Group and expression filters for the LIANA-implemented methods. |
| `filters.min_cells` | integer | 5 | min 1 | Minimum cells per group; smaller groups are dropped. |
| `filters.expr_prop` | number | 0.05 | min 0; max 1 | Minimum fraction of a group's cells expressing a partner for the tuple to be scored. |
| `n_perms` | integer | 1000 | min 1 | Label permutations for cellphonedb and squidpy_ligrec; cellchat uses cellchat.nboot. |
| `seed` | integer | 1337 | — | Random seed for label permutations; fixes the null draws. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without executing. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `cellchat` | object | — | — | CellChat options, used only when method is cellchat. |
| `cellchat.nboot` | integer | 100 | min 1 | Label permutations for the CellChat null. |
| `cellchat.trim` | number | 0.1 | min 0; max 0.25 | Trim fraction, used only by truncatedMean and thresholdedMean; ignored for triMean. |
| `cellchat.Kh` | number | 0.5 | > 0 | Hill half-saturation constant applied to the product. |
| `cellchat.n` | integer | 1 | min 1 | Hill exponent. |
| `squidpy_ligrec` | object | — | — | squidpy ligrec options, used only when method is squidpy_ligrec. |
| `squidpy_ligrec.threshold` | number | 0.01 | min 0; max 1 | Minimum fraction of cells expressing each partner in a cluster for the pair to be tested. |
| `squidpy_ligrec.complex_policy` | string | "min" | `min`, `all` | How complex subunits are combined, following squidpy's policy. |
| `squidpy_ligrec.corr_method` | string/null | null | — | Multiple-testing correction name; null returns raw permutation p-values. |
| `squidpy_ligrec.alpha` | number | 0.05 | min 0; max 1 | Significance level for the significant flag. |
<!-- PARAMS:AUTO:END -->

Rules spanning parameters: `filters` applies to cellphonedb, natmi and singlecellsignalr, while squidpy_ligrec uses its own `threshold`. `n_perms` applies to cellphonedb and squidpy_ligrec, and cellchat uses `cellchat.nboot`. A method object is read only when its method is selected. Validation: `groupby` must exist in `obs`; groups below `min_cells` are dropped and counted; ligand and receptor symbols absent from `var` remove their tuples; a complex with a missing subunit is dropped and counted. `dry_run` returns the estimate without writing.

## 7. MCP tool

Tool name `singlet_communication_lr_interaction_scoring` (definition in `tasks/mcp/singlet_communication_lr_interaction_scoring.json`). Example call:

```json
{"dataset": "/data/pbmc_donors.singlet", "groupby": "cell_type", "method": "cellphonedb", "filters": {"min_cells": 5, "expr_prop": 0.05}, "n_perms": 1000, "seed": 1337}
```

Example result (values are illustrative, not a benchmark result):

```json
{
  "dataset": "/data/pbmc_donors.singlet",
  "status": "completed",
  "wrote": ["uns/lr_interactions", "uns/lr_interactions_params"],
  "summary": {"method": "cellphonedb", "n_tuples_tested": 12480, "n_fdr_below_alpha": 310,
    "top": [{"sender": "CD14 monocyte", "receiver": "CD4 T", "ligand": "TNF", "receptor": "TNFRSF1A", "score": 0.82, "pvalue": 0.001, "fdr": 0.04}]},
  "provenance_id": "prov_0001",
  "job_id": null,
  "estimate": null
}
```

Long-running: at large sizes the permutation stage can exceed the inline limit, and the call then returns `queued` with a `job_id`. Stochastic: the label permutations depend only on `seed`, so repeated calls with the same seed return the same table. Dry run: `dry_run` returns `seconds`, `peak_memory_gb` and the chosen device from the numbers of cells, groups and nonzero entries, without writing.

## 8. Benchmarks

**Shared protocol.** Every method receives the same normalised layer, group labels and resource, and uses the same seed (1337) and the section 4 defaults unless a benchmark states otherwise. Each method ranks its tuples by its primary score. Metrics are computed over the union of tuples, and a tuple a method does not score is ranked last. Intervals are 95 percent percentile bootstraps over tuples with 1000 resamples (proposed). Timings report hardware and are paired across methods on identical inputs.

### B1. Open Problems spatial co-localisation truth (published)

- **Goal**: rank tuples so that colocalised tuples come first, from expression and labels only, with no coordinates given to the method.
- **Ground truth**: orthogonal measurement (spatial co-localisation). A tuple $(a,b,\ell,r)$ is positive when $(\ell,r)$ and the non-mirrored cell-type pair $(a,b)$, with $a\le b$ and $a\ne b$, are each significant at Benjamini-Hochberg 0.05 within their own family. Each test is a global bivariate Moran's R on the normalised layer, with spatial weights from at most 10 neighbours within bandwidth 1000 and 1000 permutations [R13]. Moran's R is a dimensionless association coefficient; the label is per tuple, not per cell.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlecell_broadinstitute_scp2167_human_brain | Broad Single Cell Portal SCP2167 [R13] | scRNA-seq with spatial coordinates in obsm, human brain, — | — | test resource of the task repository |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC | area under the precision-recall curve of method scores against the colocalised label over the shared tuple universe | maximize | primary | [R12, R13] |
| Odds ratio at top_prop | odds of positives among the top top_prop fraction of ranked tuples, relative to the remaining tuples | maximize | guardrail | [R13] |

- **Comparators**: the control methods of the Open Problems task; LIANA, CellPhoneDB, NATMI and SingleCellSignalR as the framework includes them [R13]; and squidpy_ligrec and cellchat, which the framework CHANGELOG does not list.
- **Protocol**: the truth is built once per dataset from the normalised layer; each method scores the processed dataset; both orientations of each directed tuple are reported.
- **Acceptance criterion**: proposed. A method is credible when its AUPRC exceeds the random-events control with non-overlapping 95 percent bootstrap intervals over tuples.
- **Known pitfalls**: the truth uses the consensus resource, which favours methods built on the same resource [R13]; and it lists one orientation per cell-type pair, so the directed tuple $(b,a)$ cannot be matched.

### B2. Planted-signal simulation (proposed)

- **Goal**: recover planted sender-receiver tuples from a simulated dataset with known truth.
- **Ground truth**: planted simulation. A tuple is labelled 1 when its ligand's sender-group mean and its receptor's receiver-group mean were multiplied by sampled fold changes at generation; the estimand is group-level, not per cell.
- **Generator recipe**:
  1. Simulate $K$ groups and $G$ genes with base means from a count simulator, candidate Splatter [R16]; proposed $K=10$, $G=2000$, 500 cells per group.
  2. Choose $M$ planted tuples from $R_{\text{sim}}$, some as complexes sharing one group effect; proposed $M=50$.
  3. Multiply the base mean of $\ell$ in $a$ and of $r$ in $b$ by a fold change from a range fixed in the release (proposed 1.5 to 3).
  4. Label planted tuples 1, and all other tuples of $R_{\text{sim}}$ including matched-marginal decoys 0.
  5. Score each method with $R_{\text{sim}}$ and with held-out $R_{\text{test}}$; report both AUPRC values and their difference.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated dataset from steps 1 to 4 | generator recipe above; base simulator [R16] | simulated scRNA-seq; sizes as in steps 1 and 2 | — | $R_{\text{test}}$ is disjoint from $R_{\text{sim}}$ |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC on planted tuples | area under the precision-recall curve, label 1 versus 0, over all ordered tuples | maximize | primary | [R12] |
| Circular-to-held-out drop | AUPRC on $R_{\text{sim}}$ minus AUPRC on $R_{\text{test}}$ | minimize | guardrail | — |

- **Comparators**: the five methods of section 4.
- **Protocol**: replicate simulations with distinct seeds (count set by the benchmark owner); bootstrap over planted tuples.
- **Acceptance criterion**: proposed. Credible only when AUPRC on $R_{\text{test}}$ exceeds the planted fraction, with non-overlapping 95 percent bootstrap intervals; circular AUPRC is reported, not used.
- **Known pitfalls**: fold changes act on means that every method uses, so B2 checks sanity rather than generalisation; the simulator's count model may not match real overdispersion.

### P1. Performance and scaling

Wall time and peak memory for each method in the enum, on CPU and CUDA, at 10k, 100k and 1M cells (proposed; streaming is not claimed, so 10M cells are not measured), with 10 and 50 groups and the default LR table. Hold fixed: seed 1337, resource consensus, section 4 defaults and the same hardware. Comparators are the LIANA implementations, squidpy ligrec and the CellChat R implementation with nboot 100. Report time per tuple beside totals.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `communication.lr_resource_curation`: Ligand-receptor resource curation and harmonisation
- **Feeds**:
  - `communication.differential_communication`: Donor-aware differential communication between conditions
  - `communication.ligand_activity_inference`: Upstream ligand activity and target-gene prediction for a receiver response
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
- **Reads**: `X`, `obs/<groupby>`, `uns/<resource>`
- **Writes**: `uns/lr_interactions`, `uns/lr_interactions_params`
<!-- CHAINING:AUTO:END -->

Named recipe: cell-cell communication from annotated single-cell data, after normalisation, cluster labelling and resource curation. Its table feeds donor-aware differential communication and ligand activity inference.

## 10. Risks, pitfalls and open questions

- **Unknowns in the sources**: the metric code for AUPRC and the odds ratio is absent from the local source files, so the tie rule, the negative set, the default `top_prop` and the exact odds-ratio contrast are unknown. The full dataset list and licence of the Open Problems benchmark are unknown beyond the SCP2167 test resource. The Liu et al. 2022 dataset names and metric formula are unknown, so that evaluation is not a benchmark here. The cytokine-activity proxy would need a signature resource such as CytoSig [R17], whose scoring model is not described here, and method concordance is a diagnostic with no fixed dataset.
- **Evidence scope**: the summaries of [R2, R3, R4] in section 2 rest on the best-practices chapter, and their full texts are not checked. ICELLNET and CellCall are omitted from section 4 and from the enum, and their scoring code is not checked. The SingleCellSignalR score is the LIANA version; the original R code is not checked.
- **Default conflicts**: the best-practices chapter gives a 10 percent expression filter for CellPhoneDB, whereas the LIANA code default is 0.05; `min_cells` is 5 in LIANA but 10 in CellChat's filter; and a squidpy helper default of 0.1 is overridden by the public function. singlet fixes these values only after the first experiment.
- **Unsettled literature**: whether sum or mean statistics, and which tie rule, give better rankings; the discrete p-value grids (0.001 at $B=1000$, 0.01 at nboot 100) limit FDR control across many tuples; donor pseudo-replication is not addressed by any listed method and is left to statistics.pvalue_null_calibration.
- **Technical and licence risks**: the reimplementation routes in section 12 need a clean-room check against the published formulas before release. The point at which LIANA applies `expr_prop` has not been traced, so its effect on tuple counts is unknown. The Open Problems truth needs its test-resource licence checked before redistribution.
- **First experiment**: on the SCP2167 test resource, reproduce the Open Problems truth and the LIANA cellphonedb score with the section 4 defaults; check AUPRC against the random-events control; then compare squidpy_ligrec and cellchat on the same tuples. This fixes parity before any model is fitted.

## 11. References

R1. Armingol E, Officer A, Harismendy O, Lewis NE. Deciphering cell-cell interactions and communication from gene expression. *Nature Reviews Genetics* 2021. doi:10.1038/s41576-020-00292-x — verified (corpus)
R2. Dimitrov D, Türei D, Garrido-Rodriguez M, et al. Comparison of methods and resources for cell-cell communication inference from single-cell RNA-Seq data. *Nature Communications* 2022. doi:10.1038/s41467-022-30755-0 — verified (corpus)
R3. Wang S, Zheng H, Choi JS, Lee JK, Li X, Hu H. A systematic evaluation of the computational tools for ligand-receptor-based cell-cell interaction inference. *Briefings in Functional Genomics* 2022. doi:10.1093/bfgp/elac019 — verified (corpus)
R4. Liu Z, Sun D, Wang C. Evaluation of cell-cell interaction methods by integrating single-cell RNA sequencing data with spatial information. *Genome Biology* 2022. doi:10.1186/s13059-022-02783-y — verified (corpus)
R5. Dimitrov D, Schäfer PSL, Farr E, et al. LIANA+ provides an all-in-one framework for cell-cell communication inference. *Nature Cell Biology* 2024. doi:10.1038/s41556-024-01469-w — verified (corpus)
R6. Efremova M, Vento-Tormo M, Teichmann SA, Vento-Tormo R. CellPhoneDB: inferring cell-cell communication from combined expression of multi-subunit ligand-receptor complexes. *Nature Protocols* 2020. doi:10.1038/s41596-020-0292-x — verified (corpus)
R7. Jin S, Guerrero-Juarez CF, Zhang L, et al. Inference and analysis of cell-cell communication using CellChat. *Nature Communications* 2021. doi:10.1038/s41467-021-21246-9 — verified (corpus)
R8. Jin S, Plikus MV, Nie Q. CellChat for systematic analysis of cell-cell communication from single-cell transcriptomics. *Nature Protocols* 2025. doi:10.1038/s41596-024-01045-4 — verified (corpus)
R9. Hou R, Denisenko E, Ong HT, Ramilowski JA, Forrest ARR. Predicting cell-to-cell communication networks using NATMI. *Nature Communications* 2020. doi:10.1038/s41467-020-18873-z — verified (corpus)
R10. Cabello-Aguilar S, Alame M, Kon-Sun-Tack F, Fau C, Lacroix M, Colinge J. SingleCellSignalR: inference of intercellular networks from single-cell transcriptomics. *Nucleic Acids Research* 2020. doi:10.1093/nar/gkaa183 — verified (corpus)
R11. Palla G, Spitzer H, Klein M, et al. Squidpy: a scalable framework for spatial omics analysis. *Nature Methods* 2022. doi:10.1038/s41592-021-01358-2 — verified (corpus)
R12. Luecken MD, Gigante S, Burkhardt DB, et al. Defining and Benchmarking Open Problems in Single-Cell Analysis. *Nature Biotechnology* 2025. doi:10.1038/s41587-025-02694-w — verified (corpus)
R13. Open Problems in Single-Cell Analysis. Cell-cell communication task repository at commit b800f11, with the framework CHANGELOG.md. https://github.com/openproblems-bio/task_cell_cell_communication — verified (repo)
R14. Armingol E, Baghdassarian HM, Lewis NE. The diversification of methods for studying cell-cell interactions and communication. *Nature Reviews Genetics* 2024. — verified (corpus)
R15. Armingol E, Baghdassarian HM, Martino C, et al. Context-aware deconvolution of cell-cell communication with Tensor-cell2cell. *Nature Communications* 2022. doi:10.1038/s41467-022-31369-2 — verified (corpus)
R16. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R17. Jiang P, Zhang Y, Ru B, et al. Systematic investigation of cytokine signaling activity at the tissue and single-cell levels. *Nature Methods* 2021. — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/saezlab/liana-py | Daniel Dimitrov (LICENSE copyright holder) | BSD-3-Clause | parity reference for the CellPhoneDB, NATMI and SingleCellSignalR scores and for rank aggregation | port |
| https://github.com/ventolab/CellphoneDB | The CellPhoneDB development team (pyproject.toml); Wellcome Sanger Institute (LICENSE copyright holder) | MIT | original CellPhoneDB at repository version 5.0.1 (R6 describes version 2), comparator only | callout |
| https://github.com/forrest-lab/NATMI | Rui Hou (LICENSE copyright holder) | MIT | product and specificity edge weights | port |
| https://github.com/jinworks/CellChat | Suoqin Jin (DESCRIPTION author and maintainer) | GPL-3 (DESCRIPTION and LICENSE file) | trimean, Hill probability and label-permutation null | reimplement |
| https://github.com/SCA-IRCM/SingleCellSignalR | Simon Cabello-Aguilar; Jacques Colinge (DESCRIPTION) | GPL-3 (DESCRIPTION); no LICENSE file at the repository root | original score; LIANA version used for parity | reimplement |
| https://github.com/scverse/squidpy | Theis Lab and scverse (LICENSE copyright holders) | BSD-3-Clause | ligrec permutation test | port |
| https://github.com/openproblems-bio/task_cell_cell_communication | Open Problems in Single-Cell Analysis (LICENSE copyright holder) | MIT | spatial co-localisation truth for B1 and metric names | port |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Alicia Oshlack (DESCRIPTION) | GPL-3 (DESCRIPTION and LICENSE file) | base count simulator candidate for B2, used at generation time only | callout |
