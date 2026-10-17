---
id: spatial-registration.pairwise_slice_correspondence
title: Pairwise spot or cell correspondence between adjacent sections
area: spatial-registration
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [spatial-preproc.spatial_unit_qc_filtering, spatial-preproc.spatial_depth_normalization]
feeds: [spatial-registration.multislice_3d_reconstruction, spatial-registration.nonrigid_section_registration, spatial-domains.multi_slice_domains]
reads: [layers/counts, obsm/spatial, obsm/<use_rep>, obs/<marginals_key>]
writes: [models/<output_key>/coupling, obs/<output_key>_match_index, obs/<output_key>_match_mass, uns/<output_key>/overlap_fraction, uns/<output_key>/objective, obsm/<output_key>_aligned]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_registration_pairwise_slice_correspondence
evidence_basis: corpus+repo+memory
last_reviewed: 2026-10-17
---

# Pairwise spot or cell correspondence between adjacent sections

> Finds, for each unit of one section, a soft correspondence to units of an adjacent section by weighing expression similarity against preserved spatial neighbourhoods with fused Gromov-Wasserstein optimal transport; PASTE is the published standard, and singlet proposes an entropic unbalanced variant with fitted parameters and calibrated couplings, not yet validated.

## 1. Question

Given two sections of one tissue, adjacent in a stack, with $n$ source and $m$ target units (spots or cells), coordinates $S\in\mathbb R^{n\times2}$, $S'\in\mathbb R^{m\times2}$ and expression $X$, $X'$ on a common gene set, find a nonnegative coupling $\Pi\in\mathbb R^{n\times m}$ whose entry $\pi_{ij}$ is the mass linking source unit $i$ to target unit $j$. Outputs are $\Pi$, the per-unit best match and mass, and the objective. A correct answer places its mass on the true correspondence, planted or annotated, while preserving local spatial structure.

## 2. Why this task matters and where the field stands

Multi-section analyses (3D reconstruction, joint domains, label transfer) assume that each unit on one section has a counterpart on the next, and a wrong match propagates into every downstream comparison. The status is **contested**: the field disagrees on the objective and on how to score it.

- *Objective.* Fused Gromov-Wasserstein (FGW) is the common formulation [R1][R5]. Its linear term rewards expression similarity and its quadratic term rewards preserved distances [R4]. The problem is non-convex, so the answer depends on initialisation.
- *Partial overlap.* Adjacent sections rarely share all their tissue, and balanced marginals force mass onto units without a partner. Partial and unbalanced variants exist [R2][R3][R8][R10].
- *Ground truth.* No benchmark with real, non-simulated correspondence truth was identified for this task. The protocols in use are planted simulations and label-agreement proxies [R1][R13].
- *Cross-technology alignment.* Claims for graph-learning methods exist without a benchmark here (section 10).
- *Scale.* Dense solvers need $O(nm)$ memory for the coupling and $O(n^2+m^2)$ for distance matrices [R7].

## 3. Theory and insight

**Objective.** Write $p_i=(x_i+0.01)/\sum_g(x_{ig}+0.01)$ for the proportion profile of unit $i$ and $c(x_i,x'_j)=\mathrm{KL}(p_i\,\|\,q_j)$ for the expression cost used by PASTE, where $q_j$ is the analogous profile of target unit $j$. Normalisation sits inside the divergence, so library size cancels except through the pseudocount. The PASTE objective is

$$F(\Pi)=(1-\alpha)\sum_{i,j}c(x_i,x'_j)\,\pi_{ij}+\alpha\sum_{i,j,k,l}\big(d_{ik}-d'_{jl}\big)^2\pi_{ij}\pi_{kl},\qquad \Pi\in\Gamma(a,b),\tag{1}$$

where $d$ and $d'$ are Euclidean distances between coordinates and $\Gamma(a,b)$ is the set of couplings with marginals $a$ and $b$ (uniform by default). Here $\alpha=0$ uses expression only and $\alpha=1$ spatial distances only, the convention of moscot's `alpha` parameter. *Regime:* balanced marginals, $0\le\alpha\le1$, and nonnegative expression input.

**Partial overlap.** PASTE2 restricts the coupling to

$$\Pi\in\mathcal P(a,b,s)=\{\Pi\ge0:\ \mathbf 1^\top\Pi\mathbf 1=s,\ \Pi\mathbf 1\le a,\ \Pi^\top\mathbf 1\le b\},\qquad 0\le s\le\min(\textstyle\sum a,\sum b),\tag{2}$$

where $s$ is the overlap fraction. The code states the mass constraint; the marginal inequalities are the usual partial-transport form, which the dummy-point construction in section 4 implements. *Regime:* the objective is unchanged, only the feasible set changes.

**Square-loss gradient.** For square loss the tensor-matrix product in the objective reduces to

$$\mathcal L(D,D')\otimes\Pi=D^{\circ2}\,a\,\mathbf 1_m^\top+\mathbf 1_n\,b^\top(D'^{\circ2})^\top-2\,D\,\Pi\,D'^\top,\tag{3}$$

with $D$ and $D'$ the spatial distance matrices [R6]. Forming it costs $O(n^2m+nm^2)$ per dense gradient, read directly from the order of the matrix products; each entropic Sinkhorn iteration [R9][R11] costs $O(nm)$, and the dense coupling needs $O(nm)$ memory. These counts hold for dense matrices only. The low-rank formulation [R7] is reported to reduce the gradient cost to roughly linear in $n+m$ (section 10).

**Unbalanced entropic form.** The moscot problem is a schematic of the form

$$(1-\alpha)\langle M,P\rangle+\alpha\,\mathcal E_{D,D'}(P)+\varepsilon\,\mathrm{KL}(P\,\|\,a\otimes b)+\tau_a\,\mathrm{KL}(P\mathbf 1\,\|\,a)+\tau_b\,\mathrm{KL}(P^\top\mathbf 1\,\|\,b),\tag{4}$$

with $M$ the expression cost, $\mathcal E_{D,D'}$ the GW term, and $\tau=1$ the balanced case [R3][R8]. *Regime:* $\alpha\in(0,1]$, $\varepsilon>0$, $\tau\in(0,1]$. The exact regulariser convention of the solver is outside this schematic (section 10).

**Simulation law.** The simulator draws total counts $n_i\sim\mathrm{NB}(r,\theta)$ with

$$r=\frac{\mu^2}{v-\mu},\qquad \theta=\frac{\mu}{v},\qquad \frac{r(1-\theta)}{\theta}=\mu,\qquad \frac{r(1-\theta)}{\theta^2}=v,\tag{5}$$

where $\mu$ and $v$ are the mean and variance of the original spot totals. *Regime:* $v>\mu$ (overdispersion), which the code assumes.

**Estimands.** Every output and ground truth is in mass units unless labelled normalised.

- $\Pi$ carries total mass 1 under uniform marginals and mass $s$ under partial overlap; for balanced problems each row sums to its source weight, and for partial problems rows are bounded by it.
- The per-unit match is the argmax over target units. The match mass is the row maximum, at most $1/n$ under uniform marginals; it is a mass, not a probability (B4).
- Planted correct mass is $A=\sum_{i=1}^m\pi_{\sigma(i),i}$, where $\sigma$ maps each simulated target unit to its source unit. Its ceiling is $m/n$ for $m\le n$, because each correct pair carries at most $\min(1/n,1/m)=1/n$. The normalised form $A/(m/n)$ is the mean over target units of $n\,\pi_{\sigma(i),i}$, which lies in $[0,1]$.
- Label-consistent mass is $A_{\rm lab}=\sum_{i,j}\pi_{ij}\mathbf 1[\ell_i=\ell_j]$. Its ceiling is $\sum_c\min\big(N^{(1)}_c/n_1,\,N^{(2)}_c/n_2\big)$, where $N^{(s)}_c$ counts units with label $c$ in section $s$, and $n_1,n_2$ are the section sizes. This is the largest label-consistent mass the marginals allow.

**Assumptions and failure modes.**

| Family | Assumes | Fails when |
|---|---|---|
| PASTE, PASTE2 | adjacent sections share tissue; distances comparable after normalisation; expression informative after proportion normalisation | balanced marginals with partial overlap; sparse, noisy counts; symmetric tissue admits many near-optimal couplings |
| moscot | the same, with $\varepsilon$ large enough to converge | small $\varepsilon$ converges slowly; large $\varepsilon$ blurs the coupling; per-section standardisation removes physical size differences |
| Coordinate initialiser | corresponding units are close in centred, scaled coordinates | rotation or shear, which it has no term to undo; it ignores expression |

**Insight.** Fused GW is the simplest model that uses both signals, and $\alpha$ sets their balance. The heuristic is a special case: the coordinate initialiser is linear OT on coordinates only, and PASTE with $\alpha=1$ is GW alone. GW depends only on distance matrices, so it is invariant to rigid motion of either section, and a spatial-only solution cannot prefer the planted correspondence over another isometry of a near-symmetric tissue. The saved Stahl simulations agree (per-slice means over the 10 saved pairs; $\delta$ is the pseudocount perturbation of B1): at $\delta=5$ the normalised correct mass is 0.00–0.04 for $\alpha=1$, 0.46–0.57 for $\alpha=0$, 0.73–0.78 for $\alpha=0.01$ and 0.77–0.78 for $\alpha=0.1$. On these four slices the useful regime is a small spatial weight under expression noise; whether it transfers to other tissue is untested.

**Why a model adds value.** The model states both signals in one objective whose parameters ($\alpha$, $\varepsilon$, $\tau$) can be fitted to planted pairs rather than hand-set, returns partial mass through $\tau$ instead of a dummy construction, and yields a coupling whose calibration can be tested. Its costs are the solver approximation and the fitting step, and neither is validated yet.

## 4. Methods landscape

The published standard is balanced fused GW (PASTE), with its partial extension (PASTE2, shipped in the paste3 package) and an entropic unbalanced formulation (moscot). PASTE's coordinate initialiser is the heuristic reference, and PASTE's $\alpha=0$ and $\alpha=1$ settings are one-term controls. Methods without a primary source in hand are omitted (section 10).

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| PASTE `pairwise_align` | hybrid | balanced FGW: KL expression cost and square-loss spatial GW term, mixed by $\alpha$, solved by conditional gradient with uniform marginals | [R1][R4][R5] |
| PASTE2 (paste3, `overlap_fraction`) | hybrid | FGW with total mass constrained to $s$, using one dummy unit per side to absorb unmatched mass | [R2] |
| moscot `AlignmentProblem` | model-based | entropic, optionally unbalanced FGW between sections with per-section standardised coordinates, solved with OTT-JAX | [R3][R7][R8][R9] |
| Coordinate initialiser (`match_spots_using_spatial_heuristic`) | heuristic | uniform-marginal OT with Euclidean cost between centred, scaled coordinate sets; ignores expression | [R1] |

Defaults, taken from the source at the commits shown:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| PASTE | $\alpha$ | 0.1 | `src/paste/PASTE.py:11` @ 5f0d58c |
| PASTE | dissimilarity | `'kl'` | `src/paste/PASTE.py:12` |
| PASTE | use_rep | None (uses X) | `src/paste/PASTE.py:13` |
| PASTE | norm | False; when True, each distance matrix is divided by its smallest nonzero entry | `src/paste/PASTE.py:17, 138-140` |
| PASTE | numItermax | 200 | `src/paste/PASTE.py:18` |
| PASTE | KL input | X + 0.01; rows normalised to proportions inside the divergence | `src/paste/PASTE.py:115-116`; `src/paste/helper.py:90-91` |
| PASTE | gene set | intersection of variable names | `src/paste/PASTE.py:76` |
| Coordinate initialiser | use_ot | True (exact OT; False uses bipartite matching) | `src/paste/helper.py:27` |
| PASTE2 | overlap_fraction | None (balanced) | `src/paste3/paste.py:33` @ b1f3f84 |
| PASTE2 | $\alpha$; exp_dissim_metric | 0.1; `'kl'` | `src/paste3/paste.py:35-36` |
| PASTE2 | norm; numItermax; use_gpu | False; 200 (balanced); True, with CPU fallback | `src/paste3/paste.py:40-42, 136-138` |
| PASTE2 | maxIter | 1000, the iteration cap when overlap_fraction is set | `src/paste3/paste.py:43, 219` |
| PASTE2 | dummy points | 1 per side (`dummy` = 1), each with mass $\sum b - s$ as coded for both sides; zero cost to real units, $100\times$ the maximum cost between dummies | `src/paste3/paste.py:610, 681-689, 759` |
| moscot | normalize_spatial | True; per section $(X-\bar X)/\mathrm{sd}(X)$ with one scalar mean and standard deviation over all coordinates, applied to the two quadratic terms only | `src/moscot/problems/space/_alignment.py:45, 139-141`; `src/moscot/base/problems/problem.py:724` @ d6e1bb1 |
| moscot | policy; cost | `'sequential'`; `'sq_euclidean'` | `src/moscot/problems/space/_alignment.py:43, 46` |
| moscot | $\alpha$; $\varepsilon$ | 0.5; 1e-2 | `src/moscot/problems/space/_alignment.py:193-194` |
| moscot | $\tau_a$; $\tau_b$ | 1.0; 1.0 (balanced) | `src/moscot/problems/space/_alignment.py:195-196` |
| moscot | rank | -1 (full-rank solver) | `src/moscot/problems/space/_alignment.py:197` |
| moscot | max_iterations; threshold | None; 1e-3 | `src/moscot/problems/space/_alignment.py:205-206` |

## 5. Proposed singlet approach

**Routes.** `paste` and `paste2`: port of the solver, the dummy-unit construction and the defaults (permissive licence, section 12), reimplemented in the C++ core with a CUDA path. `moscot`: port of the formulation and the per-section standardisation; the OTT-JAX solver is a callout comparator only. The expression cost is reimplemented from equation (1) in section 3 and no code is copied. `paste` at its published commit is a callout comparator.

**Model-based proposal.** The moscot formulation with three additions: (i) $\varepsilon$ and the marginal penalties $\tau$ fitted by maximum likelihood on planted pairs, instead of hand-set values; (ii) an optional encoder-learned expression cost, trained so that same-type units across datasets lie close, with author annotations as positives (planned, and not in the enum until it meets B1); (iii) a per-unit confidence scaled by one temperature fitted on separate pairs (B4). The proposal is falsified if, on B1, normalised correct mass at $\delta=0$ falls below 0.90 with the default $\alpha$, if B2 non-inferiority fails on any pair, or if B4 ECE stays above 0.05 after scaling. Until it meets these criteria, `paste` remains the default.

**Inputs.** Expression must be nonnegative. Use the depth-normalised counts from the upstream task, not log values: the divergence takes logarithms of proportions computed after adding the pseudocount, so log-transformed input is invalid, and the pseudocount's effect depends on the input scale. The scale is recorded in `uns`.

**Defaults an agent uses without asking.** `method` = `paste`, every other parameter at its method default (section 4), `device` = `auto`, and `common.normalize_spatial` unset. The summary reports the method, any parameter changed from its default, and the total mass.

**ML stack and kernels.** PyTorch is used only for the optional learned expression encoder and the temperature fit. Hard-coded CUDA covers the two small hot operations: cuBLAS for the square-loss products in equation (3), and custom kernels for the log-domain Sinkhorn row and column updates, which are fixed and repeated. cuSPARSE handles sparse spatial-neighbourhood products when a sparse graph replaces dense distance matrices. Large $n$ uses the low-rank GW path. CPU is the reference implementation against which the CUDA path is tested.

**Memory.** Both sections and the coupling are held in memory; streaming is not claimed. A dense float64 coupling takes $8nm$ bytes. The dense path is used only when the device holds both distance matrices and the coupling; otherwise the low-rank path is required.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse, nonnegative | expression of each section, depth-normalised upstream (section 5) |
| read | `obsm/spatial` | float, $n\times2$ and $m\times2$ | coordinates of each section |
| read | `obsm/<use_rep>` | float | optional expression representation that replaces counts |
| read | `obs/<marginals_key>` | float | optional non-negative weights; uniform when absent |
| write | `models/<output_key>/coupling` | sparse CSR (top-k per row) or dense float32 when small | rows index the source section, columns the target |
| write | `obs/<output_key>_match_index` | int | best target unit for each source unit |
| write | `obs/<output_key>_match_mass` | float | row maximum of the coupling, in mass units (section 3) |
| write | `obsm/<output_key>_aligned` | float, $n\times2$ | source coordinates placed in the target frame as the coupling-weighted mean of target coordinates |
| write | `uns/<output_key>/overlap_fraction` | float | total mass of the coupling |
| write | `uns/<output_key>/objective` | object | final objective, iteration count, method and parameters |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Source section handle: a .singlet path or URI, or a workspace handle. Rows of the coupling index this section. |
| `target_dataset` | string | required | — | Target section handle. Columns of the coupling index this section; its coordinates come from obsm/spatial. |
| `method` | string | "paste" | `paste`, `paste2`, `moscot` | paste: balanced fused GW, the published standard. paste2: partial overlap. moscot: entropic unbalanced fused GW. |
| `common` | object | — | — | Options shared by all methods. |
| `common.alpha` | number/null | null | min 0; max 1 | Spatial weight: 0 uses expression only, 1 spatial distances only; moscot accepts (0, 1]; null uses the method default. |
| `common.use_rep` | string/null | null | — | obsm key used as the expression representation instead of layers/counts. |
| `common.normalize_spatial` | boolean/null | null | — | Scale spatial distances per section; null uses the method default. |
| `common.marginals_key` | string/null | null | — | obs column of non-negative weights for both sections; null means uniform marginals. |
| `common.max_iterations` | integer/null | null | min 1 | Cap on outer iterations; null uses the method default. |
| `paste` | object | — | — | Options for method paste. |
| `paste.dissimilarity` | string | "kl" | `kl`, `euclidean` | Expression cost: KL between proportion profiles with a pseudocount, or Euclidean. |
| `paste2` | object | — | — | Options for method paste2 (partial overlap). |
| `paste2.overlap_fraction` | number/null | null | min 0 | Fraction s of mass to transport, at most the smaller total mass of the two sections; null means balanced transport, as in paste. |
| `moscot` | object | — | — | Options for method moscot (entropic unbalanced fused GW). |
| `moscot.epsilon` | number | 0.01 | > 0 | Entropic regularisation; the cost is rescaled by its mean. |
| `moscot.tau_a` | number | 1.0 | max 1; > 0 | Unbalanced penalty on the source marginal; 1 is balanced. |
| `moscot.tau_b` | number | 1.0 | max 1; > 0 | Unbalanced penalty on the target marginal; 1 is balanced. |
| `moscot.rank` | integer | -1 | — | -1 selects the full-rank solver; a positive value selects low-rank GW. |
| `output_key` | string | "pairwise" | — | Prefix of every written member, for example models/<output_key>/coupling. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when the method has a CUDA path and memory allows. |
| `dry_run` | boolean | false | — | Return estimated time, peak memory and device without computing the coupling. |
| `overwrite` | boolean | false | — | Replace existing members with the same output_key instead of failing. |
<!-- PARAMS:AUTO:END -->

Nested objects apply only to their method and are echoed as unused otherwise in `uns/<output_key>/objective`. A null `common.alpha` takes the method default (section 4). `paste2.overlap_fraction` must not exceed the smaller total mass of the two sections; the call fails otherwise. For `moscot`, a `tau_a` or `tau_b` below 1 relaxes that marginal, so total mass is no longer fixed, and a positive `rank` selects the low-rank solver and records the rank. Both sections are restricted to their common gene set.

## 7. MCP tool

Tool name `singlet_spatial_registration_pairwise_slice_correspondence` (definition in `tasks/mcp/singlet_spatial_registration_pairwise_slice_correspondence.json`). One example call and one compact result follow; the values illustrate the schema and are not measurements.

```json
{"dataset": "/data/sec2.singlet", "target_dataset": "/data/sec3.singlet", "method": "paste", "common": {"alpha": 0.1}, "output_key": "s2_s3"}
```

```json
{"dataset": "/data/sec2.singlet", "status": "completed",
 "wrote": ["models/s2_s3/coupling", "obs/s2_s3_match_index", "obs/s2_s3_match_mass", "uns/s2_s3/overlap_fraction", "uns/s2_s3/objective", "obsm/s2_s3_aligned"],
 "summary": {"method": "paste", "n_source": 1200, "n_target": 1150, "total_mass": 1.0, "objective": 0.31, "iterations": 37, "overlap_fraction": 1.0},
 "provenance_id": "prov_0001", "job_id": null, "estimate": null}
```

- **Long-running**: `moscot`, and dense `paste` above the device memory limit, may return `queued` with a `job_id`.
- **Stochastic**: no. The method is deterministic given inputs and parameters, and no seed is exposed.
- **Dry run**: `estimate` gives `seconds`, `peak_memory_gb` (distance matrices plus coupling) and `device`.

## 8. Benchmarks

**Shared protocol.** Metrics are in mass units unless labelled normalised; their definitions are in section 3. All methods use the same common gene set and identical preprocessing, uniform marginals, and the $\alpha$ values of the saved Stahl simulations, $\{0,0.01,0.1,0.2,0.5,0.9,1\}$, where $\alpha$ is varied. Each configuration is evaluated on the 10 simulated pairs per section, and reported as mean and standard deviation over pairs. No parameter is chosen on the sections that are reported; choices use held-out sections. Comparators use the commits in section 12. Acceptance margins are proposals unless attributed.

### B1. Planted correspondence on breast cancer sections (repository protocol)

- **Goal**: measure how much mass each setting places on the planted correspondence as expression perturbation $\delta$ grows.
- **Ground truth**: planted simulation. Each simulated target unit $i$ comes from source unit $\sigma(i)$, which is exact by construction. The metric is correct mass (estimands, section 3).
- **Generator recipe**: (1) rotate coordinates by $\pi/3$ about the point $(15,15)$ (a shift of $-15$, the rotation, and the shift back) and snap them to a $40\times40$ integer grid, keeping the first unit in each occupied cell, so $m\le n$; (2) carry the mapping list through every subset; (3) draw spot totals from the NB law of equation (5); (4) for $\delta\in\{0,\dots,5\}$ draw counts as Multinomial(total, normalised $(X_i+\delta)$), including $\delta=0$.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Stahl et al. breast cancer sections, layers 1–4 (four sections) | [R12]; preprocessed matrices [R14] | spatial transcriptomics (array), breast cancer; spot counts — | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Correct mass $A$ | $\sum_i\pi_{\sigma(i),i}$; mass units; ceiling $m/n$ | higher | primary | [R1] |
| Normalised correct mass | $A\big/(m/n)$, in $[0,1]$ | higher | primary | — |

- **Comparators**: PASTE at each $\alpha$ in the grid, the coordinate initialiser, and singlet candidates. The spatial-only control ($\alpha=1$) stays in every table.
- **Protocol**: the four sections are the sources of their own simulated pairs; results are reported per section and as the mean. Reference values are in section 3.
- **Acceptance criterion** (proposed): at $\delta=0$ with $\alpha=0.1$, normalised correct mass is at least 0.90 on every section; for $\delta=1$ to $5$ the singlet candidate is within 0.02 of the best PASTE-family setting on the same pairs.
- **Known pitfalls**: (1) circularity: the perturbation resamples the same normalised profile that the expression cost compares, which favours the expression term; (2) the saved $\delta=0$ values for expression settings are identical across the 10 pairs of each slice and no notebook in the clone writes them, so they are not measurements here.

### B2. Cortical layer agreement on adjacent DLPFC sections (repository protocol)

- **Goal**: test whether mass between adjacent sections joins units that carry the same manually annotated cortical layer or white-matter label.
- **Ground truth**: expert labels. Each unit's label is `layer_guess_reordered` (Layer1–6 and WM) from the preprocessed AnnData files; the metric is label-consistent mass normalised by its exact ceiling (estimands, section 3).

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Human dorsolateral prefrontal cortex sections, three samples of four sections | [R13]; preprocessed AnnData [R14] | spatial transcriptomics; human; 12 sections, nine adjacent pairs | — | pair indices as in the notebook |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Label-consistent mass $A_{\rm lab}$ | $\sum_{i,j}\pi_{ij}\mathbf 1[\ell_i=\ell_j]$; mass units | higher | primary | — |
| Normalised label mass | $A_{\rm lab}$ divided by the exact label ceiling | higher | primary | — |
| Label ceiling | estimands, section 3; mass units | reference | guardrail | — |

- **Comparators**: PASTE with $\alpha=0.1$, norm = True and $G_{\rm init}$ from the coordinate initialiser (`use_ot` = True), as in `compare-normalizations.ipynb`; singlet candidates.
- **Protocol**: report per pair (AB, BC and CD within each of the three samples).
- **Acceptance criterion** (proposed): singlet's normalised label mass is at least 0.90 on each pair, and no pair falls more than 0.02 below PASTE's.
- **Known pitfalls**: label agreement is a proxy: it rewards same-layer mass, not the same unit.

### B3. Partial overlap on cropped planted pairs (proposed)

- **Goal**: test whether the aligner recovers the correspondence on the shared region and estimates the overlap fraction $s$.
- **Ground truth**: planted crop. A unit is shared when it lies inside the crop mask, which is known by construction; correct mass is as in B1.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Crops of the B1 simulated pairs | generated by the B1 recipe | simulated; sizes by design | not applicable | same seeds as B1 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Overlap error | $\lvert\hat s-s\rvert$, with $\hat s$ the total mass of the coupling | lower | primary | [R2] |
| Correct mass on shared units | correct mass restricted to shared units, divided by $m_{\rm shared}/n_{\rm shared}$ | higher | primary | [R2] |

- **Comparators**: PASTE2 with `overlap_fraction` = $s$; moscot with $\tau_a,\tau_b<1$; PASTE in balanced mode.
- **Protocol**: crop the target to a contiguous window keeping $s\in\{0.5,0.7,0.9\}$ of its units. The estimated-$s$ arm does not supply $s$ and uses the total mass of the unbalanced fit or a stated rule. Report mean and standard deviation over 10 pairs.
- **Acceptance criterion** (proposed): overlap error at most 0.05 for $s\in\{0.7,0.9\}$ in the estimated-$s$ arm, and normalised correct mass on shared units at least 0.85.
- **Known pitfalls**: (1) with $s$ supplied to PASTE2 the total mass equals $s$ by constraint, so overlap error measures nothing; it is informative only in the estimated arm; (2) crop boundaries change local neighbourhoods and inflate error for every method, so methods are compared at equal boundary treatment.

### B4. Calibration of coupling confidence (proposed)

- **Goal**: test whether a per-unit confidence from the coupling, after one temperature, matches the frequency of correct best matches.
- **Ground truth**: planted simulation from the B1 generator. For target unit $i$, the best match is correct when $\arg\max_k\pi_{ki}=\sigma(i)$.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated pairs from the B1 generator; fitting and test pairs drawn separately | generated from B1 sections [R12] | simulated | not applicable | fitting and test pairs are disjoint |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ECE | 10 equal-width bins on $\hat p_i=\max_k\pi_{ki}/\sum_k\pi_{ki}$: $\sum_b\frac{\lvert B_b\rvert}{m}\lvert\mathrm{acc}(B_b)-\mathrm{conf}(B_b)\rvert$ | lower | primary | — |
| Top-1 accuracy | fraction of target units whose argmax is correct | higher | primary | — |

- **Comparators**: raw PASTE coupling; raw moscot coupling; temperature-scaled coupling, $\hat\pi_{ki}\propto\pi_{ki}^{1/T}$, with $T$ fitted by minimising the negative log-likelihood of planted sources on fitting pairs.
- **Protocol**: fit $T$ on fitting pairs; report ECE before and after scaling, the reliability diagram and the bin counts, on test pairs.
- **Acceptance criterion** (proposed): ECE at most 0.05 after scaling.
- **Known pitfalls**: (1) a temperature fitted on one tissue may not transfer, so test on the other sections; (2) if most confidences fall in one bin, ECE reduces to that bin's gap, so bin counts must be reported.

### P1. Performance and scaling

Wall time, peak memory and iterations for one coupling as $n=m$ grows over $\{2\times10^3,\,2\times10^4,\,10^5\}$ units, with $\alpha$, $\varepsilon$, tolerance, gene count and iteration cap fixed. Comparators: PASTE on CPU and on the torch GPU path (`use_gpu`); paste3 partial mode with `use_gpu` True and False; moscot with rank $-1$ and a positive rank. A dense float64 coupling takes $8nm$ bytes, and each dense distance matrix takes $8n^2$ bytes, which is 80 GB per matrix at $10^5$ units. Dense solves that exceed device memory are reported as infeasible. No acceptance threshold is set. Hold fixed: threads, hardware and numerical precision, as shipped by each method.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `spatial-preproc.spatial_depth_normalization`: Spatially aware library-size normalization
- **Feeds**:
  - `spatial-registration.multislice_3d_reconstruction`: Multi-slice stacking and 3D reconstruction
  - `spatial-registration.nonrigid_section_registration`: Smooth non-rigid registration of sections within and across technologies
  - `spatial-domains.multi_slice_domains`: Multi-slice joint domain identification
- **Reads**: `layers/counts`, `obsm/spatial`, `obsm/<use_rep>`, `obs/<marginals_key>`
- **Writes**: `models/<output_key>/coupling`, `obs/<output_key>_match_index`, `obs/<output_key>_match_mass`, `uns/<output_key>/overlap_fraction`, `uns/<output_key>/objective`, `obsm/<output_key>_aligned`
<!-- CHAINING:AUTO:END -->

Follows unit quality control and depth normalisation; couplings feed multi-section stacking, non-rigid registration and joint domain identification.

## 10. Risks, pitfalls and open questions

- *Sources.* Benchmark numbers from the PASTE, PASTE2 and moscot papers are not reported here; protocols, defaults and reference values come from the repositories. The paste2 repository linked from paste3 is not used. The moscot solver's regulariser convention and its handling of `joint_attr` = None are not stated here. The cost of PASTE's exact linear step is not given, and the low-rank cost claim [R7] is unverified against the paper.
- *Unassessed methods.* SLAT and CAST are known only from secondary summaries: their authors, code and benchmark numbers are unverified and no repository is given, so their cross-technology claim has no benchmark here. Tangram, Seurat anchors, STUtility and Scanorama are not comparators because their methods were not read; the clone holds saved outputs or scripts for some of them.
- *Data.* The Stahl count matrices and the DLPFC preprocessed AnnData files are absent from the repository clone and must come from [R14]. The species, spot counts and licence of both section sets are unverified, as are the terms of the Zenodo record. The derivation of the DLPFC label column `layer_guess_reordered` is not in the clone.
- *Saved values.* The DLPFC accuracies for pairs 0-0 and 0-1 (0.816 and 0.220, PASTE with $\alpha=0.1$ and the initialiser) are read from the saved results table and were not recomputed. The $\delta=0$ values for expression settings in the saved Stahl files (0.86–0.88 at $\alpha=0.1$) are identical across the 10 pairs of each slice, so they are not measurements (B1). The $\alpha$ labels of those files (baseline, mixed and spatial) come from their names; no notebook in the clone writes them.
- *Unsettled.* No benchmark with real correspondence truth exists; $\alpha$, $\varepsilon$ and $\tau$ are hand-set; couplings are not calibrated; the partial-overlap estimator is unspecified; dense scaling beyond about $10^5$ units is untested.
- *First experiment.* Measure the $\delta=0$ row for $\alpha\in\{0,0.01,0.1,0.9\}$ on the four Stahl sections and compare it with the saved $\delta=0$ values; then fit the B4 temperature on separate simulated pairs and report ECE on fresh pairs.

## 11. References

R1. Zeira R, Land M, Strzalkowski A, Raphael BJ. Alignment and integration of spatial transcriptomics data. *Nature Methods* 2022;19(5):567–575. doi:10.1038/s41592-022-01459-6 — verified (repo)
R2. Liu X, Zeira R, Raphael BJ. Partial alignment of multislice spatially resolved transcriptomics data. *Genome Research* 2023;33(7):1124–1132. doi:10.1101/gr.277670.123 — verified (repo)
R3. Klein D, Palla G, Lange M, et al. Mapping cells through time and space with moscot. *Nature* 2025. doi:10.1038/s41586-024-08453-2 — verified (corpus)
R4. Mémoli F. Gromov–Wasserstein distances and the metric approach to object matching. *Foundations of Computational Mathematics* 2011;11(4):417–487. doi:10.1007/s10208-011-9093-5 — verified (repo)
R5. Vayer T, Chapel L, Flamary R, Tavenard R, Courty N. Fused Gromov-Wasserstein distance for structured objects. *Algorithms* 2020;13(9):212. doi:10.3390/a13090212 — verified (repo)
R6. Peyré G, Cuturi M, Solomon J. Gromov-Wasserstein averaging of kernel and distance matrices. *Proceedings of the 33rd International Conference on Machine Learning* (PMLR 48) 2016:2664–2672. — verified (repo)
R7. Scetbon M, Peyré G, Cuturi M. Linear-time Gromov Wasserstein distances using low rank couplings and costs. arXiv 2021. doi:10.48550/ARXIV.2106.01128 — verified (repo)
R8. Séjourné T, Vialard FX, Peyré G. The unbalanced Gromov Wasserstein distance: conic formulation and relaxation. *Advances in Neural Information Processing Systems* 34, 2021:8766–8779. — verified (repo)
R9. Cuturi M. Sinkhorn distances: lightspeed computation of optimal transport. *Advances in Neural Information Processing Systems* 26, 2013. — verified (corpus)
R10. Chizat L, Peyré G, Schmitzer B, Vialard FX. Scaling algorithms for unbalanced optimal transport problems. *Mathematics of Computation* 2018;87(314):2563–2609. — verified (corpus)
R11. Peyré G, Cuturi M. Computational optimal transport. *Foundations and Trends in Machine Learning* 2019;11(5–6):355–607. doi:10.1561/2200000073 — verified (corpus)
R12. Ståhl P, Salmén F, Vickovic S, et al. Visualization and analysis of gene expression in tissue sections by spatial transcriptomics. *Science* 2016;353:78–82. doi:10.1126/science.aaf2403 — verified (repo)
R13. Maynard KR, et al. Transcriptome-scale spatial gene expression in the human dorsolateral prefrontal cortex. *Nature Neuroscience* 2021;24(3):425–436. — verified (repo)
R14. Preprocessed datasets for the paste_reproducibility analyses. Zenodo record. doi:10.5281/zenodo.6334774 — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/raphael-group/paste3 | Max Land (pyproject.toml) | BSD-3-Clause (LICENSE, Copyright 2020 Princeton University) | solver, partial-overlap construction and defaults of PASTE and PASTE2 | port (permissive licence), with attribution |
| https://github.com/raphael-group/paste | Max Land (setup.cfg) | BSD-3-Clause (LICENSE, Copyright 2020 Princeton University) | published PASTE code at 5f0d58c; source of the PASTE and initialiser defaults; its README points to paste3 | callout (comparator) |
| https://github.com/theislab/moscot | Dominik Klein, Giovanni Palla, Michal Klein, Zoe Piran, Marius Lange (authors); maintainers Klein, Palla, M. Klein (pyproject.toml) | BSD-3-Clause (LICENSE, Copyright 2022 Theis Lab) | entropic unbalanced FGW formulation and spatial standardisation at d6e1bb1 | port of formulation and defaults; OTT-JAX solver as callout |
| https://github.com/raphael-group/paste_reproducibility | — | — (no LICENSE file in the clone) | source of the B1 and B2 protocols and of saved reference outputs | reimplement protocols; callout for saved outputs; no code copied |
