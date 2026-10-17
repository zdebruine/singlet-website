---
id: perturbation.guide_assignment
title: Per-cell guide and perturbation assignment
area: perturbation
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [ingest-quant.feature_barcode_counting, cell-calling.cell_vs_empty_droplet_calling]
feeds: [perturbation.escaper_classification, perturbation.knockdown_efficacy, perturbation.perturbation_effect_estimation]
reads: [gdo/layers/counts, obs/n_umi_guide, obs/<batch_key>]
writes: [obs/assigned_guide, obs/n_guides_assigned, obs/guide_call_status, gdo/layers/assigned_guides, gdo/var/threshold, gdo/var/poisson_rate, gdo/var/gaussian_mean, gdo/var/gaussian_std, gdo/var/mix_probs_0, gdo/var/mix_probs_1, gdo/var/final_loss, uns/guide_assignment_params]
devices: [cpu, cuda]
mcp_tool: singlet_perturbation_guide_assignment
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Per-cell guide and perturbation assignment

> Decide, for every cell in a pooled perturbation screen, which guide or guides it carries from its guide-capture counts, and report the per-guide count threshold, the multiplet rule and the negative label that the decision implies.

## 1. Question

Given a cell-by-guide UMI count matrix from a pooled CRISPR screen (guides captured as feature barcodes or as guide transcripts in the cell's own RNA), which guide or guides, if any, did each cell receive? The output is one label per cell (a single guide, several guides, or none) together with the per-guide integer count threshold or posterior that produced it. A cell's true perturbation is almost never known, so correctness is judged by proxies: planted simulations with known labels, agreement with a published assignment, and the calibration and power of downstream tests against non-targeting guides (section 8).

## 2. Why this task matters and where the field stands

In a pooled CRISPR screen with a single-cell readout, the guide a cell carries is the grouping variable for every downstream effect estimate. Guide identity is read from a feature barcode or from guide transcripts captured with the cell's mRNA [R1, R2]. Genome-scale designs apply this to thousands of guides [R3], targeted designs to smaller gene sets [R4], and multimodal designs add antibody-derived tags for surface protein [R5, R6]. A false call moves a cell into the wrong group, so assignment is an upstream error source for all of them.

The task is **contested**.

- The crispat authors report that the choice of assignment strategy strongly changes downstream results on low-MOI CRISPRi screens [R7, R11], and no strategy is established as best.
- Published practice is a fixed count threshold or an argmax rule; the best-practices tutorial uses argmax at five UMIs [R10]. Mixtures fitted per guide [R7, R8] estimate a threshold and a posterior, but no comparison against per-cell ground truth shows that they beat a well-chosen fixed threshold.
- crispat and pertpy compare methods through downstream consequences (target-gene knockdown, calibration against non-targeting guides, agreement with a published assignment), not through per-cell truth.

Open problems: ambient guide counts, for which no method has a dedicated model; multi-guide cells in high-multiplicity designs, where per-guide rules ignore joint structure; mutant or defective guides, which count-based callers cannot see; and bias, because assignment noise propagates into the effect estimate computed on the same cells and its size is unquantified. Separating perturbed cells from escapers is a different task (`perturbation.escaper_classification`).

## 3. Theory and insight

**Estimands.** The input is the raw UMI count $x_{ig}$ of guide $g$ in cell $i$, without depth normalisation; $s_i=\sum_g x_{ig}$ is the cell's total guide UMIs. The estimand is the binary call $\hat z_{ig}$, meaning that cell $i$ carries guide $g$, made per cell and guide. The per-cell label is the set of called guides. The per-guide threshold $t_g$ is the smallest called integer count, in UMIs. The posterior $\pi_{ig}=P(z_{ig}=1\mid x_{ig})$ is a posterior under the fitted per-guide mixture and equals a frequency only if B3 shows calibration. Ground truth is the planted indicator in B3, the published per-cell label in B2, and, in B1, differential expression of the target gene, which is a screen-level proxy with no per-cell label.

**Per-guide two-state model.** The count of guide $g$ in a cell comes from a background state (the cell lacks the guide; counts are ambient or misassigned) or a signal state, $p(x)=w_0p_0(x)+w_1p_1(x)$. The posterior is

$$\pi_g(x)=\frac{w_1\,p_1(x)}{w_0\,p_0(x)+w_1\,p_1(x)},\qquad \hat z_{ig}=\mathbb 1[\pi_g(x_{ig})>\tau],\ \tau=\tfrac12 .$$

If $p_0,p_1$ are correctly specified and estimated, two statements hold. The cut $\tau=\tfrac12$ minimises expected misclassifications at equal error cost. The expected false-call fraction among the called set $C$ is $\lvert C\rvert^{-1}\sum_{i\in C}(1-\pi_{ig})$, which is at most $1-\tau=\tfrac12$: the cut does not control the false-call fraction at conventional levels, and only the reported mean does. Misspecification removes both guarantees, and the second can be checked only with ground truth or non-targeting calibration. If the likelihood ratio $p_1/p_0$ is non-decreasing in $x$ (a property of each fit, not of the family), the call set is $\{x\ge t_g\}$ with $t_g=\min\{x:\pi_g(x)>\tau\}$. The reference implementations take the first crossing without checking monotonicity and then call every count $\ge t_g$.

**Poisson-Gaussian mixture (reference).** It is fitted to the non-zero counts on $y=\log_2 x$:

$$p(y)=w_P\,\frac{\lambda^{y}e^{-\lambda}}{\Gamma(y+1)}+w_N\,\mathcal N(y;\mu,\sigma).$$

The first term is the Poisson mass formula at the non-integer argument $y$ through the gamma function. It is neither a mass function in $x$ nor a density in $y$, while the second term is a density in $y$; the components therefore sit on different measures and the posterior depends on the logarithm base. This is an observation from the formula as implemented. The priors are $(w_P,w_N)\sim\mathrm{Dir}(0.9,0.1)$, $\mu\sim\mathcal N(3,2^2)$, $\sigma\sim\mathrm{LogNormal}(2,1)$ (median $e^2\approx7.4$ on the log2 scale, a very wide signal component) and $\lambda\sim\mathrm{LogNormal}(0,1)$. The concentration 0.1 on $w_N$ makes the prior density unbounded as $w_N\to0$, so the MAP can collapse onto the background and the guide then receives no call; pertpy starts $w_N$ at 0.1 because the gradient vanishes at the prior median. A label-switched fit appears as a Gaussian centred on the background mode and must be reported. Both references optimise the best of ten prior-based starts chosen by initial, not final, objective.

**Tied Gaussian mixture.** crispat `ga_gauss` fits two Gaussians with a shared SD to $u=\log_{10}(x+1)$ over all cells, zeros included, and treats the higher-mean component as signal; the shared SD forces equal spread of background and signal. Cell Ranger fits the same tied two-component model on $\log_{10}(1+\text{UMI})$ with scikit-learn and calls cells in the higher-mean component above a minimum UMI count [R14], and the crispat EM option reproduces that call, matching crispat's description of `ga_gauss`. The default variational path is a MAP fit with Dir(0.99, 0.01) weights, $\mathcal N(1,2^2)$ means and a LogNormal(−3, 2) scale from fixed initial values, so its ten seeds do not differ at the start.

**Count and beta mixtures (reference only).** crispat's count models give each guide a latent indicator $z_i\sim\mathrm{Bernoulli}(\pi_g)$, $\pi_g\sim\mathrm{Beta}(1,10)$, and the linear predictor $\eta_i=\beta_0+\beta_1z_i+\gamma_{b(i)}$ with batch effects $\gamma$: Poisson with $\log\mu_i=\eta_i+\log(s_i+1)$; negative binomial with that mean and variance $\mu+\mu^2/\theta$; binomial $x_{ig}\sim\mathrm{Bin}(s_i,\operatorname{sigmoid}(\eta_i))$. The depth term lets the expected count follow library size, which a fixed-rate background cannot, and the dispersion lets overdispersed ambient counts widen the tail. The beta family fits a two- or three-component Beta mixture per batch to the top-guide share $f_i=\max_g x_{ig}/s_i$, which is invariant to multiplicative capture depth but quantised for cells with few guide UMIs.

**Why heuristics work and what models add.** A fixed threshold is the Bayes rule when the posterior crosses one half once; when background is near zero and signal sits well above it, any cut in the gap gives nearly the same calls. Argmax assumes one dominant guide and cannot call two. The share rule removes depth scaling, but its denominator counts every guide, so multi-guide cells and non-targeting counts change the share of a cell whose true guide is unchanged. A mixture adds an explicit posterior, a threshold learned from each guide's own counts, an objective with diagnostics, stored parameters for new batches and a reason to reject a guide without separation; it does not by itself add accuracy.

**Multiplicity.** If a guideless cell is called for a guide with probability $\varepsilon$, independently across $G$ guides, spurious calls per cell are $\mathrm{Binomial}(G,\varepsilon)$ with mean $G\varepsilon$, growing linearly with $G$. Ambient contamination is shared across guides, so calls are correlated and a cap on guides per cell (five in pertpy, a heuristic) is not a complete control.

**Histogram sufficiency.** Each per-guide mixture except the count and beta families depends on a cell only through its count $x_{ig}$, so the per-guide histogram of count values is a sufficient statistic and the fit is exact from histograms of size $O(GX_{\max})$, where $X_{\max}$ is the largest count. Cell Ranger fits its guide mixture on the integer-count histogram for this reason [R14].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Fixed UMI threshold (crispat `ga_umi`; pertpy `assign_by_threshold`) | heuristic | call $x_{ig}\ge t$ for every cell and guide | [R7, R8] |
| Argmax with count floor (`ga_max`; `assign_to_max_guide`) | heuristic | most abundant guide per cell if its count is at least $t$; crispat drops cells whose maximum is shared by several guides, pertpy takes the first maximal guide | [R7, R8] |
| Top-guide share (`ga_ratio`) | heuristic | most abundant guide if its share of the cell's guide UMIs is strictly above $X$ | [R7] |
| Tied Gaussian mixture on $\log_{10}(x+1)$ (`ga_gauss`) | model-based | two Gaussians with a shared SD over all cells; higher-mean component is signal | [R7] |
| Cell Ranger feature-barcode caller | model-based | the same tied model with scikit-learn and a minimum-UMI floor, fitted on the count histogram | [R14] |
| Poisson-Gaussian mixture on $\log_2$ non-zero counts (`ga_poisson_gauss`; pertpy `assign_mixture_model`; rapids-singlecell) | model-based | Poisson background plus Gaussian signal; integer cut at the first count with posterior above 0.5 | [R7, R8, R13] |
| Count mixtures (`ga_poisson`, `ga_negative_binomial`, `ga_binomial`) | model-based | latent-indicator regression with depth and batch terms | [R7] |
| Beta mixtures on top-guide share (`ga_2beta`, `ga_3beta`) | model-based | per-batch Beta mixture; threshold from the fitted components | [R7] |

The published standard is a fixed threshold or argmax with a count floor; the best-practices tutorial uses argmax at five UMIs and reproduces the published labels of its dataset [R10]. crispat collects eleven rules in one package [R7, R11], pertpy reproduces its thresholding and Poisson-Gaussian rules in JAX [R8, R12], and rapids-singlecell executes the latter on GPU [R13].

Exact defaults for the methods singlet implements, and for the reference-only families:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| threshold, max (pertpy) | `assignment_threshold` | required keyword, no default | `src/pertpy/preprocessing/_guide_rna.py:34,102` @c246f24 |
| threshold (crispat) | thresholds | required list; tutorial uses 4, 5, 7 | `crispat/umi_t.py:10`; `tutorials/guide_assignment.ipynb` cell 12 @a9372b9 |
| max (crispat) | post-hoc UMI floor; ties | 0; cells with a tied maximum removed | `crispat/maximum.py:10,45-48` @a9372b9 |
| max (pertpy) | no-call label; ties | `Negative`; first maximal guide | `_guide_rna.py:105,163,180` @c246f24 |
| ratio (crispat) | thresholds; comparison | required list (tutorial 0.3, 0.5, 0.7); share strictly greater | `crispat/ratios.py:14,74`; notebook cell 18 @a9372b9 |
| gauss (crispat) | steps; Adam rate; fit set | 250; 0.01; all cells (`nonzero=False`) | `crispat/gauss.py:295,173,179` @a9372b9 |
| gauss (crispat) | priors | Dir(0.99, 0.01); means $\mathcal N(1,2^2)$; scale LogNormal(−3, 2) | `gauss.py:32-36` |
| gauss (crispat) | call; EM variant | higher-mean component more probable; scikit-learn tied GMM, `n_init=10`, `random_state=0`, posterior above 0.5 | `gauss.py:154,261,269` |
| poisson_gauss (crispat) | priors | Dir(0.9, 0.1) on (Poisson, Normal); $\mu$ $\mathcal N(3,2^2)$; $\sigma$ LogNormal(2, 1); $\lambda$ LogNormal(0, 1) | `crispat/poisson_gauss.py:56-59` @a9372b9 |
| poisson_gauss (crispat) | Adam; starts | rate 0.01, betas (0.8, 0.99); 10 seeds, lowest initial loss | `poisson_gauss.py:204,221` |
| poisson_gauss (crispat) | steps; stopping | 500; stop after 50 steps without 0.001 improvement | `poisson_gauss.py:286,231-238` |
| poisson_gauss (crispat) | cut; fit guard | first integer count with posterior above 0.5; at least 2 non-zero cells and max count at least 2 | `poisson_gauss.py:261,213-218` |
| poisson_gauss (pertpy) | steps; rate; starts; seed | 500; 0.01; 10; 2024 | `_guide_rna.py:219-222` @c246f24 |
| poisson_gauss (pertpy) | labels; cap | `negative`, `multiple`, `+`; 5 per cell | `_guide_rna.py:213-216` |
| poisson_gauss (pertpy) | optimiser; start; cut; guard | Adam betas (0.8, 0.99) with best-loss step kept; lowest initial loss; first count above 0.5; at least 2 non-zero cells and max count at least 2 | `_guide_rna_mixture.py:144,166,138-142,203-205`; `_guide_rna.py:440` |
| poisson_gauss (rapids-singlecell) | iterations; tolerance; posterior | 90; $10^{-4}$; 0.5 | `src/rapids_singlecell/pertpy_gpu/_guide_assignment.py:138-140` @e110792 |
| count mixtures (crispat) | posterior cut; Adam; fit size | 0.8; rate 0.01, betas (0.8, 0.99); 15,000-cell subsamples, 3000 steps (binomial) | `poisson.py:210,129,152`; `neg_binomial.py:212`; `binomial.py:242` |
| beta mixtures (crispat) | Dirichlet prior; steps | (0.6, 0.4) for two components, (0.3, 0.3, 0.4) for three; 500 | `beta2.py:55,207`; `beta3.py:53` |

## 5. Proposed singlet approach

**Routes** (licences in section 12). `threshold`, `max` and `ratio` are reimplemented from the formulas of section 3, with pertpy and crispat outputs as test oracles. `gauss` and `poisson_gauss` port the priors and posterior rules with attribution and reimplement the optimiser. rapids-singlecell is design evidence only and Cell Ranger a comparator callout.

**Default** `poisson_gauss`, the rule other tools reproduce and the model-based option with explicit priors. Version 1 follows the reference: fixed `n_iter`, lowest-initial-objective start, best step kept, no early stopping. It stays the default only while it meets the B1 criterion and the B2 agreement criterion; otherwise the default moves to the passing method with the highest B1 TPR.

**Proposed formulation (not in version 1).** The reference Poisson term is unnormalised (section 3). singlet proposes proper discrete components on counts $k\ge1$: a zero-truncated Poisson background $p_0(k)=\lambda^ke^{-\lambda}/\{k!(1-e^{-\lambda})\}$ and a log-normal signal discretised to integer bins, $p_1(k)=\{\Phi(b_k)-\Phi(b_{k-1})\}/\{1-\Phi(b_0)\}$ with $b_k=\{\log_2(k+\tfrac12)-\mu\}/\sigma$, whose sum telescopes to one. It is fitted by EM on the count histogram, with $t_g=\min\{k:\pi_g(k)>\tfrac12\}$ and monotonicity checked and flagged. Claims, each withdrawn if it fails: C1, on B3 its calibration error averaged over grid cells is at least 0.02 below that of `poisson_gauss` and at most 0.05; C2, its B1 FPR is no higher; C3, its B3 mean F1 is no lower.

**ML stack.** Per-guide mixtures have four to six parameters and per-guide reductions, so they are hard-coded in C++ and CUDA with cuSPARSE column access. No weights are shipped, and the 354M-cell catalogue is not assumed to contain guide counts. PyTorch is reserved for a hierarchical model that shares the ambient rate across guides, uses library size and adds a latent class for multi-guide cells; it needs gains on B1 and B3 first.

**Kernels.** CSR row scan (largest and second-largest count, ties to the lower guide index); CSC column gather and per-guide histograms, per batch level when `batch_key` is set; per-guide EM or MAP on histograms; posterior at counts $1..X_{\max}$; batched Adam for compatibility mode. Fitting needs one streamed scan, and calls are written in a second scan, in chunks. 

## 6. Inputs, outputs and parameters

Guide-modality members are written `gdo/...`, where `gdo` is the default of `guide_modality`; `obs/` and `uns/` members are shared across modalities.

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `gdo/layers/counts` | sparse non-negative int, cell by guide | raw guide UMI counts $x_{ig}$ of the layer named by `layer` |
| read | `obs/n_umi_guide` | int per cell | total guide UMIs $s_i$; computed from the layer when absent; used by `ratio` |
| read | `obs/<batch_key>` | categorical | batch labels, read only when `batch_key` is set |
| write | `obs/assigned_guide` | categorical string | the guide name for one called guide; names sorted bytewise and joined by `multi_guide_separator` for two to `max_assignments_per_cell`; `multiple` above the cap; `no_grna_assigned_key` for none; `unassigned` for zero guide UMIs |
| write | `obs/n_guides_assigned` | int32 | number of guides called, also above the cap |
| write | `obs/guide_call_status` | categorical | `singlet`, `multiple`, `negative` or `unassigned` (zero guide UMIs, or every guide of the cell's batch skipped) |
| write | `gdo/layers/assigned_guides` | sparse boolean, cell by guide | binary call $\hat z_{ig}$ |
| write | `gdo/var/threshold` | float32 per guide | integer count threshold $t_g$ in UMIs: `assignment_threshold` for `threshold`, the fitted $t_g$ for mixtures; NaN when none qualifies or the method defines none |
| write | `gdo/var/poisson_rate` | float32 per guide | $\lambda_g$ for `poisson_gauss`; NaN otherwise |
| write | `gdo/var/gaussian_mean`, `gdo/var/gaussian_std` | float32 per guide | signal mean and SD on the method's scale ($\log_2 x$ for `poisson_gauss`, $\log_{10}(x+1)$ for `gauss`); NaN for rules |
| write | `gdo/var/mix_probs_0`, `gdo/var/mix_probs_1` | float32 per guide | background (or low-mean) and signal (or high-mean) weights |
| write | `gdo/var/final_loss` | float32 per guide | MAP objective (negative log joint) at the returned parameters |
| write | `uns/guide_assignment_params` | dictionary | method, resolved parameters, software versions, device, seed, skipped guides with reasons, guides with NaN thresholds, batch levels |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `guide_modality` | string | "gdo" | — | Modality holding the guide count layer; receives the per-guide gdo/var fields. |
| `layer` | string | "counts" | — | Layer of the guide modality with raw integer guide UMI counts; no normalisation is applied. |
| `method` | string | "poisson_gauss" | `threshold`, `max`, `ratio`, `gauss`, `poisson_gauss` | Assignment rule: threshold (count floor), max (top guide above floor), ratio (top-guide share), gauss (tied Gaussian mixture), poisson_gauss (Poisson plus Gaussian mixture). |
| `batch_key` | string/null | null | — | obs column of batch labels. When set, gauss and poisson_gauss are fitted separately per batch level; ignored by other methods. |
| `calls` | object | — | — | Options shaping the per-cell label, for all methods. |
| `calls.max_assignments_per_cell` | integer | 5 | min 1 | Cells with more called guides than this are labelled multiple. |
| `calls.no_grna_assigned_key` | string | "negative" | — | Label for cells with no called guide; set to Negative to match pertpy threshold and max output. |
| `calls.multi_guide_separator` | string | "+" | — | Separator joining the sorted guide names of multi-guide cells. |
| `rules` | object | — | — | Options of the count rules threshold, max and ratio. |
| `rules.assignment_threshold` | integer | 5 | min 1 | Integer UMI floor, used by threshold and max. The default 5 is a tutorial value, not a published default. |
| `rules.min_guide_fraction` | number | 0.5 | min 0; max 1 | Share of the cell's guide UMIs the top guide must exceed, used by ratio only. |
| `mixture` | object | — | — | Options of the fitted mixtures gauss and poisson_gauss. |
| `mixture.posterior_threshold` | number/null | null | min 0; max 1 | Signal posterior a count must exceed to be called; null uses 0.5. |
| `mixture.n_iter` | integer/null | null | min 1 | Optimiser steps, fixed number; null uses 250 for gauss and 500 for poisson_gauss. |
| `mixture.learning_rate` | number | 0.01 | > 0 | Adam step size of the MAP fit. |
| `mixture.n_init_seeds` | integer | 10 | min 1 | Prior-based starts per guide for poisson_gauss; the start with the lowest initial objective is optimised. No effect on gauss. |
| `mixture.min_nonzero_cells` | integer | 2 | min 1 | Guides with fewer non-zero cells are not fitted, receive no calls and are reported. |
| `mixture.min_max_count` | integer | 2 | min 1 | Guides whose largest count is below this are not fitted, receive no calls and are reported. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 2024 | — | Random seed for mixture starts; threshold, max and ratio are deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, peak memory and device without fitting or writing. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing before anything is written. |
<!-- PARAMS:AUTO:END -->

`rules.assignment_threshold` applies to `threshold` and `max`, `rules.min_guide_fraction` to `ratio`, and the `mixture` options to `gauss` and `poisson_gauss`; options that do not apply are recorded as ignored in `uns/guide_assignment_params`. `mixture.n_iter` null means 250 for `gauss` and 500 for `poisson_gauss`; `n_init_seeds` has no effect on `gauss`, whose start is fixed. With `batch_key`, mixtures are fitted per batch level, per-batch estimates go to `uns`, and the mixture fields of `gdo/var` hold NaN. Guides below `min_nonzero_cells` or `min_max_count` are not fitted, receive no calls and are reported. `calls.no_grna_assigned_key` set to `Negative` reproduces pertpy's `threshold` and `max` labels. `seed` affects only the mixtures.

## 7. MCP tool

Tool name `singlet_perturbation_guide_assignment` (definition in `tasks/mcp/singlet_perturbation_guide_assignment.json`). Example call and compact result (placeholders show the shape and are not measurements):

```json
{"dataset": "/data/screens/example.singlet", "method": "poisson_gauss", "batch_key": "lane", "seed": 2024}
```

```json
{
  "dataset": "/data/screens/example.singlet",
  "status": "completed",
  "wrote": ["obs/assigned_guide", "obs/n_guides_assigned", "obs/guide_call_status", "gdo/layers/assigned_guides", "gdo/var/threshold", "uns/guide_assignment_params"],
  "summary": {"method": "poisson_gauss", "n_cells": "<int>", "n_guides_fitted": "<int>", "n_guides_skipped": "<int>", "fraction_singlet": "<float>", "fraction_negative": "<float>", "fraction_multiple": "<float>", "device_used": "cuda"},
  "provenance_id": "<id>", "job_id": null, "estimate": null
}
```

- **Long-running**: yes for the mixtures on large screens; the status is `queued` when the dry-run estimate exceeds the server's inline limit.
- **Stochastic**: yes for the mixtures, through `seed`; `threshold`, `max` and `ratio` are deterministic.
- **Dry-run estimate**: seconds, `peak_memory_gb`, device, cells, guides and non-zeros, from the matrix shape and non-zero count without fitting.

## 8. Benchmarks

Shared protocol. Every method receives the same raw integer guide matrix with the defaults of section 6 unless stated. The no-call label is normalised to one spelling and multi-guide labels are canonicalised by sorting guide names and joining them with `+`. "Called" means status `singlet` unless stated. Comparator rules use thresholds 4, 5, 7 for `ga_umi` and 0.3, 0.5, 0.7 for `ga_ratio`. Mixtures are fitted with seed 2024 on real data and with 20 seeds on simulations, reporting the spread across seeds. Each result records software versions and commits (section 12), hardware, thread count and seeds, and CPU and CUDA labels must be identical.

### B1. Downstream calibration and power through SCEPTRE

- **Goal**: choose the method whose downstream tests recover target-gene effects without false discoveries among non-targeting controls, as in the crispat analysis [R7, R9, R11]. The pattern is published; the criterion is proposed.
- **Ground truth**: screen-level, with no per-cell label. A targeting guide is expected to lower its own target gene, so a significant SCEPTRE power-check test of that guide on its target gene is a true positive. The calibration check tests cells of one non-targeting guide against all other non-targeting cells: every significant gene there is a false discovery.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Schraivogel et al. TAP-seq screen | `example_data/Schraivogel` in the crispat repository [R11]; original screen [R4] | scRNA-seq with gRNA counts; 21,977 cells, 86 gRNAs (30 non-targeting, 56 targeting, 14 target genes), as stated in the crispat tutorial | — | accession — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| TPR | share of significant pairs among $T$, the (targeting guide, target gene) pairs testable under every compared method; significant means SCEPTRE p-value $<\alpha=0.05$ (proposed) | higher | primary | [R7, R9] |
| FPR | significant (non-targeting guide, gene) calibration pairs divided by tested pairs, at the same $\alpha$ | lower | guardrail | [R7, R9] |

- **Comparators**: all eleven crispat rules [R11], the pertpy mixture and singlet `threshold`, `max`, `ratio`, `gauss`, `poisson_gauss`, passed through crispat's assignment loader.
- **Protocol**: (1) assign with each method on the same matrix; (2) keep cells with exactly one called guide, identically for all methods (proposed); (3) import into SCEPTRE and execute the power and calibration checks; (4) compute TPR and FPR on the common gene set.
- **Acceptance criterion** (proposed): a method passes if FPR $\le\alpha+2\sqrt{\alpha(1-\alpha)/m}$ with $m$ the number of tested calibration pairs (binomial allowance, independent tests assumed); among passing methods the highest TPR is preferred and failing methods are reported as miscalibrated.
- **Known pitfalls**: the calibration check relies on non-targeting assignments that share the ambient problem, so a miscalibrated method can still pass; one TAP-seq screen need not predict genome-scale behaviour.

### B2. Agreement with the published labels of the Papalexi ECCITE-seq screen

- **Goal**: confirm that simple and mixture rules reproduce the authors' per-cell guide labels.
- **Ground truth**: the authors' per-cell `guide_ID` in `obs`, cast to strings with multi-guide labels canonicalised. It tests reproducibility of the authors' calls, not truth.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Papalexi et al. 2021 ECCITE-seq, stimulated THP-1 [R5] | pertpy loader `papalexi_2021`, file `https://exampledata.scverse.org/pertpy/papalexi_2021.h5mu` [R12] | human; RNA, ADT (4 features), HTO (12) and guide (111) modalities, 20,729 cells, as printed in the best-practices chapter [R10] | — | accession — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Exact agreement | $N^{-1}\sum_i\mathbb 1[\hat c_i=c_i]$ over the $N$ barcodes present in both objects, $\hat c_i$ and $c_i$ the assigned and published labels | higher | primary | [R10] |
| Called fraction | fraction of cells with status `singlet`, so that an all-negative result cannot pass | report | guardrail | [R8] |

- **Comparators**: `max` at threshold 5 (the best-practices rule), pertpy `assign_mixture_model`, crispat `ga_poisson_gauss`, singlet `gauss` and `poisson_gauss`.
- **Protocol**: (1) load the object and check the guide count and labels; (2) assign with `max` at 5 on the `counts` layer; (3) compare with `guide_ID` in canonical form; (4) repeat for the mixtures at their defaults; (5) report both metrics.
- **Acceptance criterion** (proposed): `max` at 5 agrees on every cell, as the chapter reports [R10], and any disagreement is a regression; mixture methods reach agreement of at least 0.95.
- **Known pitfalls**: the authors' calling procedure is not described in the sources used here, so agreement is circular; `Negative` and `negative` differ between pertpy functions and must be normalised.

### B3. Planted simulation grid with known per-cell labels (proposed)

- **Goal**: measure recovery of planted labels and the loss against the best fixed threshold across separations and backgrounds.
- **Ground truth**: planted simulation; the generator returns the boolean matrix $z_{ig}$, each guide planted independently.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Synthetic cell-by-guide counts | generator after `_make_synthetic_matrix` (`tests/preprocessing/test_grna_assignment.py:30-46` @c246f24) [R12], extended to a grid | 800 cells by 12 guides per grid cell, 6 grid cells | generated | recipe below |

Recipe: (1) per guide, each cell is positive with probability 0.12; (2) positive count $\max(1,\mathrm{round}(2^{N}))$, $N\sim\mathcal N(\mu,0.6^2)$, $\mu\in\{2,3,5\}$; (3) negative count $\mathrm{Poisson}(\lambda)$, $\lambda\in\{0.8,3\}$; (4) return counts and $z_{ig}$. The pertpy test is the cell $(\mu,\lambda)=(5,0.8)$. Large-sample oracle F1 of the best single integer threshold $t$, computed from the generator's mass functions, and F1 of $t=5$:

| $(\mu,\lambda)$ | (5, 0.8) | (5, 3) | (3, 0.8) | (3, 3) | (2, 0.8) | (2, 3) |
|---|---|---|---|---|---|---|
| oracle F1 ($t$) | 1.000 (7) | 0.997 (11) | 0.956 (4) | 0.714 (7) | 0.785 (3) | 0.297 (4) |
| F1 at $t=5$ | 0.995 | 0.596 | 0.951 | 0.560 | 0.555 | 0.283 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-guide F1 | $2TP_g/(2TP_g+FP_g+FN_g)$ over all cells, 0 without calls; mean over guides, then seeds | higher | primary | [R12] |
| F1 regret | oracle F1 (best fixed integer threshold chosen with the planted truth on the same matrix) minus method F1 | lower | primary | [R12] |
| Calibration error | ten equal-width posterior bins, weighted mean of $\lvert\pi-\text{observed positive fraction}\rvert$ | lower | report | [R8] |

- **Comparators**: fixed thresholds $t=1,\dots,5$, `max`, pertpy `assign_mixture_model`, crispat `ga_gauss`, singlet `gauss` and `poisson_gauss`.
- **Acceptance criterion** (proposed): in the cells with oracle F1 at least 0.95, namely (5, 0.8), (5, 3) and (3, 0.8), `poisson_gauss` has mean F1 regret at most 0.03. The grid discriminates: $t=5$ loses at least 0.05 F1 in three of six cells.
- **Known pitfalls**: the generator belongs to the mixtures' own model family and favours them; it has no depth variation, shared ambient structure or dependence between guides.

### P1. Performance and scaling

Wall time, peak host and device memory, and throughput ($N$ divided by wall time) for assigning every guide, on CPU and CUDA, at $10^4$, $10^5$ and $10^6$ cells with 100 and 1,000 guides (B3 generator with one planted guide per cell, $\mu=5$, $\lambda=0.8$), plus a screen of about 600,000 cells and about 2,200 gRNAs as described in the crispat README [R11]. Comparators: crispat `ga_poisson_gauss` (Pyro, per guide), pertpy `assign_mixture_model` (JAX, all guides in one scan), rapids-singlecell GPU, and pertpy `assign_to_max_guide` and `assign_by_threshold`. Hold fixed 500 steps, rate 0.01, 10 starts, minimum 2 non-zero cells, 90 EM iterations for rapids-singlecell, and record its readout mode; crispat early stopping makes its time comparable only when the stopping step is logged. Acceptance (proposed): per-cell label identity with the pertpy reference of at least 0.99 at every scale in compatibility mode, and singlet CUDA wall time at $10^6$ cells no greater than rapids-singlecell on the same device.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.feature_barcode_counting`: Feature-barcode (ADT, hashtag, lipid-tag and guide) counting from FASTQ
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
- **Feeds**:
  - `perturbation.escaper_classification`: Perturbed versus escaper cell classification
  - `perturbation.knockdown_efficacy`: On-target knockdown efficacy per guide or perturbation
  - `perturbation.perturbation_effect_estimation`: Per-perturbation differential expression and effect-size estimation
- **Reads**: `gdo/layers/counts`, `obs/n_umi_guide`, `obs/<batch_key>`
- **Writes**: `obs/assigned_guide`, `obs/n_guides_assigned`, `obs/guide_call_status`, `gdo/layers/assigned_guides`, `gdo/var/threshold`, `gdo/var/poisson_rate`, `gdo/var/gaussian_mean`, `gdo/var/gaussian_std`, `gdo/var/mix_probs_0`, `gdo/var/mix_probs_1`, `gdo/var/final_loss`, `uns/guide_assignment_params`
<!-- CHAINING:AUTO:END -->

Runs after feature-barcode counting and cell calling; its call layer feeds escaper classification, knockdown efficacy and effect estimation. Ambient removal and sample-hashtag assignment are related but not inputs. No recipe membership is assigned.

## 10. Risks, pitfalls and open questions

- No per-cell ground truth exists for real screens: B1 is a downstream proxy, B2 tests reproducibility, and B3 is simulated within the mixtures' own model family, so the first experiment is to compute `max`, `poisson_gauss` and the crispat and pertpy equivalents on B3 and B2 and fix label-identity and F1 baselines before any singlet code is trusted.
- The threshold of 5 and its association with the crispat authors come from the best-practices chapter only; the Dixit, Datlinger and Replogle guide-calling procedures, and crispat's statement that `poisson_gauss` follows Replogle et al., were not traced to those sources.
- The effect of the unnormalised Poisson term on calls, and the equivalence of crispat's early-stopped fit and pertpy's fixed 500 steps, have not been measured, so per-cell calls are not guaranteed to be identical across the two.
- Data licences and accessions for the Schraivogel and Papalexi screens were not seen; the TAP-seq size comes from the crispat tutorial, and the pertpy docstring says 11 gRNAs for Papalexi while the chapter prints 111, so the object must be checked before B2.
- Sample-hashtag demultiplexers (HTODemux, MULTIseqDemux, GMM-Demux, demuxmix), sequence-level tools and ambient-removal tools are not covered: their code was not read for this document and none is evaluated on guide matrices. Count and beta mixtures are specified but outside version 1.
- Two proposed evaluations lack a fixed truth set: within-gene concordance of perturbation signatures across guides of one gene (Replogle et al. [R3], whose original guide calls cannot be separated from the method under test) and the PD-L1 ADT readout of the Papalexi screen [R5, R6], which needs a fixed list of guides expected to lower PD-L1. SCEPTRE options and the significance level used by crispat are not stated in its README.

## 11. References

R1. Dixit A, Parnas O, Li B, et al. Perturb-Seq: Dissecting Molecular Circuits with Scalable Single-Cell RNA Profiling of Pooled Genetic Screens. *Cell* 2016. doi:10.1016/j.cell.2016.11.038 — verified (corpus)

R2. Datlinger P, Rendeiro AF, Schmidl C, et al. Pooled CRISPR screening with single-cell transcriptome readout. *Nature Methods* 2017. doi:10.1038/nmeth.4177 — verified (corpus)

R3. Replogle JM, Saunders RA, Pogson AN, et al. Mapping information-rich genotype-phenotype landscapes with genome-scale Perturb-seq. *Cell* 2022. doi:10.1016/j.cell.2022.05.013 — verified (corpus)

R4. Schraivogel D, Gschwind AR, Milbank JH, et al. Targeted Perturb-seq enables genome-scale genetic screens in single cells. *Nature Methods* 2020;17(6):629-635. doi:10.1038/s41592-020-0837-5 — verified (search)

R5. Papalexi E, Mimitou EP, Butler AW, et al. Characterizing the molecular regulation of inhibitory immune checkpoints with multimodal single-cell screens. *Nature Genetics* 2021. doi:10.1038/s41588-021-00778-2 — verified (corpus)

R6. Stoeckius M, Hafemeister C, Stephenson W, et al. Simultaneous epitope and transcriptome measurement in single cells. *Nature Methods* 2017. doi:10.1038/nmeth.4380 — verified (corpus)

R7. Braunger JM, Velten B. Guide assignment in single-cell CRISPR screens using crispat. *Bioinformatics* 2024. doi:10.1093/bioinformatics/btae535 — verified (corpus)

R8. Heumos L, Ji Y, May L, et al. Pertpy: an end-to-end framework for perturbation analysis. *Nature Methods* 2025. doi:10.1038/s41592-025-02909-7 — verified (corpus)

R9. Barry T, Wang X, Morris JA, Roeder K, Katsevich E. SCEPTRE improves calibration and sensitivity in single-cell CRISPR screen analysis. *Genome Biology* 2021. doi:10.1186/s13059-021-02545-2 — verified (search)

R10. Theis lab. Single-cell best practices, chapter "Perturbation modelling" (conditions/perturbation_modeling). Jupyter Book. — partial (corpus)

R11. Braunger JM. crispat, commit a9372b9. https://github.com/velten-group/crispat — verified (repo)

R12. Heumos L, et al. pertpy, commit c246f24. https://github.com/scverse/pertpy — verified (repo)

R13. Dicks S, et al. rapids-singlecell, commit e110792. https://github.com/scverse/rapids_singlecell — verified (repo)

R14. 10x Genomics. Cell Ranger, commit 669395e. https://github.com/10XGenomics/cellranger — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/velten-group/crispat | Jana M. Braunger | MIT (LICENSE) | reference implementation of the rules, source of priors and thresholds, downstream analysis scripts | port |
| https://github.com/scverse/pertpy | Lukas Heumos, Lilly May, Stefan Peidli, Johannes Ostner and others (pyproject.toml) | MIT (LICENSE file); pyproject.toml classifiers and CITATION.cff state Apache-2.0 | JAX reimplementation, test oracle and test generator | port |
| https://github.com/scverse/rapids_singlecell | Severin Dicks | MIT (LICENSE) | GPU batched EM reference for design | reimplement |
| https://github.com/10XGenomics/cellranger | 10x Genomics | 10x Genomics custom licence (LICENSE: internal use with 10x products, no redistribution); README: source for information only | tied Gaussian mixture guide caller | callout |

<!--
WRITING RULES (not part of the document)
- BUDGET: about 5,500 words in total by `wc -w` (hard limit 9,000, enforced by lint). Stop at the cap; never pad to it.
- SINGLE HOME: each fact appears once. Licences, authors and routes live in section 12 only; exact defaults with file:line live in the section 4 defaults table only; evidence gaps live in section 10 only; the parameter table and chaining lists are generated. Elsewhere use a short pointer such as "(see B2)".
- NO PROCESS LANGUAGE in the body: never mention searches, budgets, dossiers, passes, runs, sessions, leads. Never write "not confirmed" inside tables or prose; leave the cell as "—" and, if it matters, add one line to section 10.
- DEFINE THE ESTIMAND: for every ground-truth definition and every output, state in one sentence what exactly is measured and its normalisation (total ambient fraction vs foreign-genotype fraction, channel-level vs per-cell, ...).
- ONLY WHAT WAS READ: list a method in the tables or in the MCP enum only if its primary paper or code was actually read; otherwise omit it.
- REGIME OF VALIDITY for every analytic claim (first order, large n, mu >> 1).
- Licences come from the LICENSE file or package metadata, never from paper authors; prefer the maintained upstream default over a fork's.
-->
