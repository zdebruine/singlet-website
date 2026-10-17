---
id: communication.spatial_lr_scoring
title: Spatially constrained ligand-receptor communication scoring
area: communication
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [spatial-preproc.spatial_unit_qc_filtering, spatial-preproc.spatial_depth_normalization, communication.lr_resource_curation]
feeds: [communication.interaction_significance_calibration, communication.consensus_interaction_ranking, statistics.multiple_testing_control]
reads: [X, obsm/spatial, uns/lr_resource]
writes: [uns/spatial_lr/pairs, uns/spatial_lr/params, obsm/spatial_lr_score]
devices: [cpu, cuda]
mcp_tool: singlet_communication_spatial_lr_scoring
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Spatially constrained ligand-receptor communication scoring

> For each ligand-receptor pair, scores how strongly ligand-expressing and receptor-expressing spots or cells are spatially linked, reports a significance value, and, for range-constrained methods, the signalling range used.

## 1. Question

Which ligand-receptor (LR) pairs are supported between spatially neighbouring or nearby spots or cells, and how far does each signal plausibly act? The input is an expression layer with coordinates, an LR table and a neighbourhood or range definition. The output is a per-pair table of scores, p-values and q-values, optional per-spot scores, and the range used. A correct answer ranks pairs on a calibrated null and agrees with independent co-localisation evidence; it is compatible with signalling, not proof of it.

## 2. Why this task matters and where the field stands

Spatial transcriptomics records where each ligand and receptor is expressed, so pairs whose partners are close can be separated from pairs co-expressed across distant parts of a tissue [R1]. Dissociated data lose that information, which is why spatial scorers add coordinates and a distance or neighbourhood constraint.

Status: **contested**. Two comparisons of LR tools cover non-spatial data [R2, R3], so spatial performance is not settled by them. Liu et al. evaluated tools against spatial distance information and report that predicted interactions differ considerably between tools [R1]. No accepted gold standard exists for spatial pairs.

Open problems:

- The signalling range is weakly identified from coordinates. Hard cut-offs, kernels and kNN graphs make different range claims, and no accepted comparison separates them.
- Co-localisation is compatible with signalling, but tissue borders and spot-level mixing produce co-localisation without communication.
- Permutation nulls that shuffle spots break spatial autocorrelation, so their calibration differs across tools.

## 3. Theory and insight

Spot or cell $i$ has coordinates $\mathbf p_i$, distance $d_{ij}=\lVert\mathbf p_i-\mathbf p_j\rVert$ in coordinate units, ligand expression $x_{i\ell}$ and receptor expression $y_{ir}$ for pair $k=(\ell,r)$, and spatial weights $w_{ij}\ge 0$.

**(a) Spatial co-variation.** With $\tilde x$ and $\tilde y$ standardised over spots,

$$R_k=\frac{\sum_i\sum_j w_{ij}\,\tilde x_{i\ell}\,\tilde y_{jr}}{\sum_i\sum_j w_{ij}}$$

is the weighted co-variation of the ligand at each spot with the receptor at its neighbours, normalised by total weight. Its permutation p-value

$$p_k=\frac1M\sum_{m=1}^{M}\mathbf 1\{T_k^{(m)}\ge T_k^{\mathrm{obs}}\}$$

estimates the null probability of a statistic at least as large as observed, with floor $1/M$. The q-value is the Benjamini-Hochberg adjustment over the pairs tested in one call. The analytic z-score is valid for many spots and sparse $w$. The permutation is exact only if the permuted field is exchangeable, which under spatial autocorrelation holds only when whole blocks are permuted (B2).

**(b) Range-constrained transport.** For pair $k$, sender mass $\mu^{(k)}$ (ligand) and receiver mass $\nu^{(k)}$ (receptor) are coupled by

$$\min_{\pi\ge 0}\ \sum_{ij}\pi_{ij}M_{ij}+\varepsilon\sum_{ij}\pi_{ij}(\log\pi_{ij}-1)+\rho\big[\mathrm{KL}(\pi\mathbf 1\,\|\,\mu)+\mathrm{KL}(\pi^{\top}\mathbf 1\,\|\,\nu)\big],\qquad \pi_{ij}=0\ \text{if}\ M_{ij}>\tau_k,$$

with cost $M_{ij}$ equal to $d_{ij}$ or $d_{ij}^2$, range $\tau_k$, entropic weight $\varepsilon$ and marginal penalty $\rho$. The output $F_k=\sum_{ij}\pi^{(k)}_{ij}$ is the total coupled mass in the units of the marginals. The range $\tau_k$ is imposed, so it is a constraint rather than an estimate, and mass that cannot reach a receiver within $\tau_k$ is penalised by the marginal terms instead of forced. The entropic and marginal weights are relative to the cost scale, so their meaning changes with coordinate units. The objective is the form implied by the COMMOT parameters and cut-off mask; the coupling across LR pairs is not written here (section 10). COMMOT's optional expression smoothing with exponential or Lorentzian kernels acts on the input and does not impose a range.

**(c) Non-spatial reference.** squidpy's ligrec scores $S^{(k)}_{c_1c_2}=\bar L^{(k)}_{c_1}+\bar R^{(k)}_{c_2}$, the mean ligand in a sender cluster plus the mean receptor in a receiver cluster, against cluster-label permutations in the CellPhoneDB style [R7, R8]. Its p-value counts permuted sums strictly above the observed one, divided by $M$. It has no spatial term, so its null is exact only under exchangeability of cells across clusters.

**Insight.** Co-localisation is necessary and not sufficient for signalling. Family (a) takes its range from $w$ and tests co-variation against a label-free null. Family (b) fixes the range, so it cannot report a fitted range with uncertainty. Family (c) needs no distributional model and is the cheapest baseline, but it ignores space. A model adds calibrated intervals on range and sharing across LR families, which section 5 proposes. Benchmarks that define labels from the same resource or the same spatial data as the scorer are circular.

**Assumptions and failure modes.** Expression stands in for protein and secretion. Naive permutation of spots inflates significance under autocorrelation. Hard cut-offs create edge effects at $\tau_k$. Spot mixing blurs sender and receiver identity. Heteromeric rules change scores. Tissue borders create co-localisation without communication. Well-studied pairs are easier to detect and dominate rankings.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| COMMOT | model-based | Per-pair distance-masked unbalanced entropic transport from ligand-expressing to receptor-expressing spots, with a hard range and coupling across pairs | [R4] |
| SpatialDM | model-based | Bivariate Moran-type statistic on a spatial weight matrix, with analytic z-score or permutation nulls and local per-spot tests | [R6] |
| LIANA+ spatial bivariate | hybrid | Spatial bivariate functions over a connectivity graph with optional permutation p-values; the Moran function is adapted from SpatialDM | [R5] |
| squidpy ligrec | heuristic | Sum of partner cluster means with a cluster-label permutation test and no neighbour term | [R7], [R8] |

COMMOT [R4] and SpatialDM [R6] are the published spatial methods with their own range or null model. LIANA+ [R5] provides spatial bivariate functions under one interface. squidpy's ligrec [R7, R8] is a non-spatial comparator. Methods whose scoring code and primary paper are not characterised here are left out of the tables and the enum (section 10).

| Method | Parameter | Value | Source |
|---|---|---|---|
| COMMOT | dis_thr | None; README example 200 | `commot/tools/_spatial_communication.py:251-268`; README line 49 |
| COMMOT | cost_type | euc | `_spatial_communication.py:251-268` |
| COMMOT | cot_eps_p | 0.1 | `_spatial_communication.py:134-145`, `:251-268` |
| COMMOT | cot_rho | 10.0 | `_spatial_communication.py:134-145`, `:251-268` |
| COMMOT | cot_nitermax | 10000 | `_spatial_communication.py:139`, `:251-268` |
| COMMOT | cot_weights | (0.25, 0.25, 0.25, 0.25) | `_spatial_communication.py:140` |
| COMMOT | heteromeric_rule; delimiter | min; "_" | `_spatial_communication.py:251-268` |
| COMMOT | smooth | False | `_spatial_communication.py:141` |
| SpatialDM | n_perm; method | 1000; z-score | `spatialdm/main.py:133` (global), `:203` (local) |
| SpatialDM | pair calls | threshold 0.1, FDR on | `spatialdm/main.py:183` |
| SpatialDM | spot calls | threshold 0.1, FDR on | `spatialdm/main.py:240` |
| SpatialDM | weight_matrix l; cutoff; n_neighbors | None; 0.1; None | `spatialdm/main.py:14` |
| SpatialDM | permutation p-value | 1 − (observed > permuted).sum()/n_perm, no +1 term | `spatialdm/main.py:178-179` |
| SpatialDM | Moran_R standardise | True | `spatialdm/stats.py:140` |
| LIANA+ spatial | n_perms | None: no permutation p-values | `src/liana/method/sp/_bivariate/_spatial_bivariate.py:60`; branches `_local_functions.py:124-137` |
| squidpy ligrec | n_perms | 1000 | `src/squidpy/gr/_ligrec.py:585` |
| squidpy ligrec | threshold | 0.01; gates the permutation test | `_ligrec.py:578`; docstring `:267-270` |
| squidpy ligrec | complex_policy | min | `_ligrec.py:577` |
| squidpy ligrec | corr_method; alpha | None; 0.05 | `_ligrec.py:579`, `:588` |
| squidpy ligrec | p-value | permuted sums strictly above observed, divided by n_perms | `_ligrec.py:690-692`, `:798` |

COMMOT is at commit d117445 and SpatialDM at 9b0f559. The LIANA+ and squidpy lines come from unversioned copies.

## 5. Proposed singlet approach

COMMOT and SpatialDM are ported, as is the LIANA+ Moran function (permissive licences; section 12). squidpy's ligrec and the CUDA ligrec in rapids-singlecell are callouts for comparison only.

**Default.** `method = spatialdm_z`, `resource = lr_resource`, `layer = X`, `weights.weight_cutoff = 0.1`, `fdr_threshold = 0.1`, `seed = 0`. Its null is analytic and costs no permutations; it is the standard to beat, not a claim of best accuracy.

**Model-based proposal.** Each LR pair gets a fitted range rather than a fixed one. For receiver spot $j$ the expected receptor count is

$$\log\mathbb E[y_{jr}]=\log s_j+\alpha_k+\beta_k\log\Big(\textstyle\sum_i\kappa_k(d_{ij})\,x_{i\ell}+\delta\Big),\qquad \kappa_k(d)=\exp\!\big(-(d/\eta_k)^{\nu_k}\big),$$

with size factor $s_j$, range $\eta_k$, shape $\nu_k$ and small constant $\delta$. A hierarchical prior shares $(\eta_k,\nu_k)$ across ligand families (diffusible versus contact). Variational inference with a negative-binomial likelihood gives a posterior median, written as `range_hat`. The variant joins the enum only after passing the test below.

**Falsification.** Adopted only if, on B1, median relative range error is at most 0.3 and AUPRC is not below `spatialdm_z`, and, on B2, rejection rate at 0.05 lies in [0.03, 0.07]. Failing either falsifies the proposal.

**Stack and devices.** PyTorch fits the variational model. Three small hot kernels are hard-coded in CUDA with cuSPARSE: batched co-variation products $\tilde X^{\top}W\tilde Y$ over pairs, block-permutation loops, and masked Sinkhorn sweeps for the COMMOT-style transport. CPU and CUDA paths must agree to floating-point tolerance. Permutation storage is per block, not pairs × n_perm × spots as SpatialDM allocates it.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | X | float, sparse or dense | expression layer scored as supplied |
| read | obsm/spatial | float, n_obs × 2 | coordinates; unit recorded in uns/spatial_lr/params |
| read | uns/lr_resource | table | ligand, receptor, complex subunits and pathway |
| write | uns/spatial_lr/pairs | table | per-pair score, pvalue, qvalue and range_hat (the hard range for COMMOT; posterior median for the model variant) |
| write | obsm/spatial_lr_score | sparse float, n_obs × pairs | per-spot values for selected pairs, where the method provides them |
| write | uns/spatial_lr/params | dict | method, n_perm, fdr_threshold, coordinate unit, seed and library versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI with obsm/spatial coordinates and an LR table in uns/. |
| `method` | string | "spatialdm_z" | `spatialdm_z`, `spatialdm_perm`, `commot`, `liana_morans`, `squidpy_ligrec` | Scoring backend. spatialdm_z is the default; commot requires commot.dis_thr; squidpy_ligrec is a non-spatial comparator. |
| `resource` | string | "lr_resource" | — | Name of the ligand-receptor table in uns/ (ligand, receptor and complex subunits). |
| `layer` | string | "X" | — | Expression layer scored as supplied; singlet applies no further normalisation. |
| `n_perm` | integer | 1000 | min 1 | Permutations for permutation p-values; the smallest reportable p-value is 1/n_perm. |
| `fdr_threshold` | number | 0.1 | min 0; max 1 | Benjamini-Hochberg q-value cut-off for calling significant pairs. |
| `weights` | object | — | — | Spatial weights for spatialdm and liana_morans. |
| `weights.n_neighbors` | integer/null | null | min 1 | Restrict to this many nearest neighbours per spot; null keeps the weight-based graph. |
| `weights.rbf_length_scale` | number/null | null | > 0 | Radial basis length scale in coordinate units; SpatialDM only. |
| `weights.weight_cutoff` | number | 0.1 | min 0 | Zero radial basis weights below this value; SpatialDM only. |
| `commot` | object | — | — | COMMOT options, used only when method is commot. |
| `commot.dis_thr` | number | — | > 0 | Hard signalling range in coordinate units; required with commot. |
| `commot.cost_type` | string | "euc" | `euc`, `euc_square` | Distance cost: Euclidean or squared Euclidean. |
| `commot.eps_p` | number | 0.1 | > 0 | Entropic regularisation of the transport coupling, in cost units. |
| `commot.rho` | number | 10.0 | > 0 | Marginal penalty of the unbalanced transport problem. |
| `commot.nitermax` | integer | 10000 | min 1 | Maximum solver iterations per LR pair. |
| `commot.heteromeric_rule` | string | "min" | `min`, `ave` | Complex subunit aggregation rule; it changes scores materially. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for permutation nulls (spatialdm_perm, liana_morans, squidpy_ligrec). |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`commot` is read only when method is commot and then requires `commot.dis_thr`. `n_perm` and `seed` apply only to permutation variants; `weights.rbf_length_scale` and `weights.weight_cutoff` to SpatialDM only; `weights.n_neighbors` is the alternative restriction to the cut-off. `fdr_threshold` applies to every method that returns p-values. Coordinates must be finite and in one recorded unit, and `dis_thr` must be positive in it.

## 7. MCP tool

Tool name `singlet_communication_spatial_lr_scoring` (definition in `tasks/mcp/singlet_communication_spatial_lr_scoring.json`). Example call and compact result; values in angle brackets are placeholders.

```json
{"dataset": "/data/visium_section.singlet", "method": "spatialdm_z", "weights": {"n_neighbors": 6}}
```

```json
{"dataset": "/data/visium_section.singlet", "status": "completed",
 "wrote": ["uns/spatial_lr/pairs", "obsm/spatial_lr_score", "uns/spatial_lr/params"],
 "summary": {"method": "spatialdm_z", "n_pairs_tested": "<int>", "n_significant": "<int>",
             "fdr_threshold": 0.1, "top_pairs": ["<up to 10 rows>"]},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: large inputs, mainly with the permutation variants, can return `status` queued with a `job_id`. Stochastic: permutation variants depend on `seed`; `spatialdm_z` is deterministic given its inputs. Dry run: `dry_run` returns estimated seconds, peak memory and device without writing members.

## 8. Benchmarks

Shared protocol: every benchmark uses one LR table and one coordinate unit within a comparison. Each method is applied with its section 4 defaults. Range-constrained methods are also swept over their range parameter (COMMOT `dis_thr`, SpatialDM `rbf_length_scale`); the sweep is reported and is not used to choose a range per dataset. Stochastic methods use 10 seeds (proposed). Metrics are computed per replicate and summarised as medians with bootstrap intervals over replicates. Every method that accepts a neighbour definition uses the same one within a comparison.

### B1. Planted spatial-range simulation

- **Goal**: recover planted pairs and their range when the truth is known.
- **Ground truth**: planted simulation. Planted pairs have label 1 and range $r_k$, the distance where the kernel halves; null pairs have label 0. The label is coupling presence; range error is $\lvert\hat r_k-r_k\rvert/r_k$.
- **Generator recipe** (proposed): $n$ spots uniformly in a square; gene counts from negative binomials fitted to the dissociated catalogue; a sender subset with ligand levels $L_{ik}$. Planted pairs have receptor means $m_{jk}=b_k+a_k\sum_i L_{ik}\max(0,1-d_{ij}/(2r_k))$ over senders, a linear taper matching no detector kernel. Null pairs have independent Gaussian random fields and $m_{jk}=b_k$. Dropout is swept.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Generator recipe | singlet (proposed) | simulated; $n$, $K$, $p_s$, fold change | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC, planted versus null | average precision over score-ranked pairs | maximise | primary | — |
| Median relative range error | median $\lvert\hat r_k-r_k\rvert/r_k$; $\hat r_k$ is the oracle AUPRC maximiser, or the posterior median for the model | minimise | guardrail | — |
| Null false-positive rate | fraction of null pairs with q below 0.05 | minimise | guardrail | — |

- **Comparators**: SpatialDM z-score and permutation; COMMOT over a `dis_thr` grid; LIANA+ Moran.
- **Acceptance criterion**: proposed. AUPRC at least 0.8 at middle dropout; range error at most 0.3; null false-positive rate at most 0.10 at 0.05.
- **Known pitfalls**: a kernel shared by generator and detector creates circularity.

### B2. Spatial null calibration by block permutation

- **Goal**: verify that p-values and q-values hold nominal rates when no pair communicates and autocorrelation is kept.
- **Ground truth**: consistency; every pair is null by construction. The estimand is the rejection rate at $\alpha$, the fraction of null pairs in a replicate with $q<\alpha$, averaged over replicates.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated null | singlet generator, step 5 for every pair | simulated; sizes as in B1 | — | block sizes are fractions of the tissue side |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Rejection rate at $\alpha$ | fraction of null pairs with q below $\alpha$, for $\alpha\in\{0.05, 0.01\}$ | calibrated when equal to $\alpha$ | primary | — |
| Kolmogorov distance of null p-values | $\max_u\lvert\hat F(u)-u\rvert$ over null p-values, with $\hat F$ their empirical CDF | minimise | guardrail | — |

- **Comparators**: SpatialDM z-score (analytic); SpatialDM permutation with block and with full shuffling; LIANA+ Moran with permutation; squidpy ligrec as a non-spatial reference.
- **Protocol**: block sizes of 1/10, 1/5 and 1/3 of the side (proposed); full shuffling as a contrast; 10 seeds.
- **Acceptance criterion**: proposed, not from the literature. Rejection rate at 0.05 within [0.03, 0.07] for the chosen null scheme across block sizes.
- **Known pitfalls**: full shuffling destroys autocorrelation and underestimates null variance; the block size drives the result and must be reported.

### P1. Performance and scaling

Wall time, peak memory and pairs scored per second at $10^4$, $10^5$ and $10^6$ spots, on CPU and CUDA, for SpatialDM z-score and permutation (1000 permutations), LIANA+ Moran, COMMOT (CPU), squidpy ligrec (CPU) and the CUDA ligrec in rapids-singlecell as a GPU reference for the permutation test. Hold fixed the LR table, the neighbour count, $n_{\mathrm{perm}}=1000$, dtype, threads and host. Report preprocessing and scoring time separately, and CUDA host-device transfer separately. Acceptance (proposed): the log-log slope of analytic-path wall time against spots, between $10^4$ and $10^6$, is at most 1.5. SpatialDM's local permutation arrays grow as pairs × n_perm × spots (`spatialdm/main.py:229-230`), so memory is the first limit reached.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `spatial-preproc.spatial_depth_normalization`: Spatially aware library-size normalization
  - `communication.lr_resource_curation`: Ligand-receptor resource curation and harmonisation
- **Feeds**:
  - `communication.interaction_significance_calibration`: Calibration of interaction significance against a no-communication null
  - `communication.consensus_interaction_ranking`: Consensus ranking of interactions across communication methods
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
- **Reads**: `X`, `obsm/spatial`, `uns/lr_resource`
- **Writes**: `uns/spatial_lr/pairs`, `uns/spatial_lr/params`, `obsm/spatial_lr_score`
<!-- CHAINING:AUTO:END -->

Named recipe: spatial cell-cell communication, after spot quality control, depth normalisation and LR resource curation. Its scores feed significance calibration and cross-method consensus ranking.

## 10. Risks, pitfalls and open questions

- **Unconfirmed sources and gaps**: the score formula, distance cut-offs, tool list and dataset identifiers of the Liu et al. benchmark [R1] are not stated here, and no dataset is identified for a co-localisation benchmark. stLearn, NICHES and SpaTalk have no scoring code or primary method characterised here, and neither does the CellChat v2 spatial mode; SpaOTsc [R9] is related to COMMOT and is not characterised. The catalogue's squidpy entry 'with spatial neighbours' does not match the shipped ligrec. COMMOT's collective objective, the role of `cot_weights`, its output normalisation, and SpatialDM's Moran_R normalisation are not characterised.
- **Unsettled literature**: the range is a modelling choice. Whether the heteromeric rules `min` and `ave` change rankings, and which range separates diffusible from contact ligands, are open. Sensitivity sweeps are the only evidence here.
- **Technical and licence risks**: SpatialDM's local permutation storage is the memory limit (`spatialdm/main.py:229-230`). Ported code keeps each licence notice (section 12). The identifiability of the variational range model is untested.
- **First experiment**: on B1 at the lowest dropout level, check that `spatialdm_z`, COMMOT over a `dis_thr` grid and `liana_morans` reach AUPRC above chance, and that the null false-positive rate matches 0.05 under block permutation (B2), before any tissue data are used.

## 11. References

R1. Liu Z, Sun D, Wang C. Evaluation of cell-cell interaction methods by integrating single-cell RNA sequencing data with spatial information. *Genome Biology* 2022. doi:10.1186/s13059-022-02783-y — verified (corpus)
R2. Dimitrov D, Türei D, Garrido-Rodriguez M, et al. Comparison of methods and resources for cell-cell communication inference from single-cell RNA-Seq data. *Nature Communications* 2022. doi:10.1038/s41467-022-30755-0 — verified (corpus)
R3. Wang S, Zheng H, Choi JS, Lee JK, Li X, Hu H. A systematic evaluation of the computational tools for ligand-receptor-based cell-cell interaction inference. *Briefings in Functional Genomics* 2022. doi:10.1093/bfgp/elac019 — verified (corpus)
R4. Cang Z, Zhao Y, Almet AA, et al. Screening cell-cell communication in spatial transcriptomics via collective optimal transport. *Nature Methods* 2023;20:218–228. doi:10.1038/s41592-022-01728-4 — partial (repo)
R5. Dimitrov D, et al. LIANA+ provides an all-in-one framework for cell–cell communication inference. *Nature Cell Biology* 2024;26:1613–1622. doi:10.1038/s41556-024-01469-w — verified (corpus)
R6. Li Z, Wang T, Liu P, Huang Y. SpatialDM: rapid identification of spatially co-expressed ligand-receptor reveals cell-cell communication patterns. *bioRxiv* 2022. — partial (repo)
R7. Palla G, Spitzer H, Klein M, et al. Squidpy: a scalable framework for spatial omics analysis. *Nature Methods* 2022. doi:10.1038/s41592-021-01358-2 — verified (corpus)
R8. Efremova M, Vento-Tormo M, Teichmann SA, Vento-Tormo R. CellPhoneDB: inferring cell-cell communication from combined expression of multi-subunit ligand-receptor complexes. *Nature Protocols* 2020. doi:10.1038/s41596-020-0292-x — verified (corpus)
R9. Cang Z, Nie Q. Inferring spatial and signaling relationships between cells from single cell transcriptomic data. *Nature Communications* 2020. doi:10.1038/s41467-020-15968-5 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/zcang/COMMOT | Zixuan Cang (copyright holder) | MIT License | range-constrained transport; defaults in section 4 | port |
| https://github.com/StatBiomed/SpatialDM | Zhouxuan Li, Tianjie Wang, Yuanhua Huang | Apache-2.0 | co-variation statistics and nulls | port |
| https://github.com/saezlab/liana-py | Daniel Dimitrov (copyright holder) | BSD-3-Clause | spatial bivariate functions; Moran function | port (Moran function only) |
| https://github.com/scverse/squidpy | Theis Lab (copyright holder) | BSD-3-Clause | cluster-permutation comparator | callout |
| https://github.com/scverse/rapids-singlecell | — | MIT License | CUDA ligrec GPU reference | callout |
