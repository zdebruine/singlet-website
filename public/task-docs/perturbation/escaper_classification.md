---
id: perturbation.escaper_classification
title: Perturbed versus escaper cell classification
area: perturbation
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [perturbation.guide_assignment, normalization.size_factor_estimation]
feeds: [perturbation.perturbation_effect_estimation, perturbation.knockdown_efficacy]
reads: [layers/log1p, obsm/X_pca, obs/target_gene, obs/replicate]
writes: [obs/mixscape_class, obs/mixscape_class_global, obs/mixscape_p_ko, obs/mixscale_score, layers/X_pert, uns/mixscape_de_genes, uns/mixscape_escape_rate, uns/escaper_diagnostics]
devices: [cpu, cuda]
mcp_tool: singlet_perturbation_escaper_classification
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Perturbed versus escaper cell classification

> Label each guide-carrying cell of a CRISPR screen as perturbed or escaped by projecting its neighbourhood perturbation signature onto a per-target direction and fitting a mixture whose non-targeting component is fixed, then report per-target escape fractions.

## 1. Question

Among cells that carry a guide for target gene $t$, which show a transcriptional response to the perturbation (KO) and which show none (NP), that is, escapers or cells of a target with no phenotype? Inputs are unscaled log-normalised expression, per-cell target labels, non-targeting (NT) cells, replicate labels and a PCA embedding. Outputs are a per-cell class and posterior, a per-target escape fraction and a per-cell perturbation signature. A correct answer is one whose NP calls match cells without a response; that state is not observed, so section 8 uses proxies.

## 2. Why this task matters and where the field stands

A guide-carrying cell can show no perturbation response [R1, R2]. Pooling such cells into the knockout group dilutes downstream effect estimates, so they are separated before effect estimation (see `perturbation.perturbation_effect_estimation`). Mixscape is the published classifier for this step [R1]; Papalexi's screen combined CRISPR perturbation with CITE-seq surface protein [R1, R8]. The best-practices chapter applies Mixscape to the Papalexi screen, notes that the classification cannot distinguish a failed knockout from a target with no transcriptional effect, and uses PD-L1 protein as an independent check for IFN-gamma pathway targets [R10].

The task is **contested**. Three open problems follow. The NP label pools escapers with non-responding targets, so a per-target escape fraction is not an escape rate in the strict sense. The binary call discards graded effects, which Mixscale replaces with a continuous projection score [R3]. The direction and the mixture are estimated from the same cells that are then classified, and cell-level tests can overstate significance when replicate structure is ignored [R9]. Published work offers no independent per-cell truth for escape, so calibration is assessed with proxies (section 8).

## 3. Theory and insight

**Estimands.** The class $z_i\in\{0,1\}$ (1 = KO) is latent, and `obs/mixscape_class` holds its realised call $\mathbb 1[P_i>0.5]$. The posterior $P_i=\Pr(z_i=1\mid\text{data})$ is per guide-carrying cell, under the fitted model, and lies in $[0,1]$. The escape fraction $e_t$ is the share of guide-carrying cells of target $t$ with $z_i=0$; its estimate $\hat e_t=1-\bar P$ averages over cells, not over guides. The signature $\Delta_i$ is per cell and gene, in log1p expression units, with NT minus cell as the sign. The Mixscale score is dimensionless: the projection standardised by the NT mean and SD, computed after each direction gene is z-scored and clipped at 10. Each benchmark defines its own ground truth in section 8.

**Signature.** For cell $i$, let $\mathcal N_k(i)$ be its $k$ nearest NT cells of the same split in the first $d$ principal components ($k=20$, $d=15$ by default). Then

$$\Delta_i=\mathrm{log1p}\Big(\frac1k\sum_{j\in\mathcal N_k(i)}\mathrm{expm1}(x_j)\Big)-x_i .$$

The average is taken in expm1 space, so it is a mean of counts before the log. The input must be unscaled log-normalised data. In the linear approximation a guide cell's signature has coefficient $-1$ on its own profile, while an NT cell that is its own neighbour has $\Delta_i\approx\tfrac1k\sum_{j\ne i}x_j-(1-\tfrac1k)x_i$, a coefficient of $-0.95$ at $k=20$. This self-term shifts the NT null, which is why section 5 excludes it by default.

**Direction and projection.** Let $D_t$ be the genes with $|\log\mathrm{FC}|\ge0.25$ and adjusted $p<0.05$ between all guide cells of $t$ and the NT cells $C$ of the split, selected once before iteration. If $|D_t|<5$, every cell of $t$ is NP. Otherwise

$$v_t=\bar\Delta^{(D_t)}_{G_t}-\bar\Delta^{(D_t)}_{C},\qquad p_i=\frac{\langle\Delta_i^{(D_t)},v_t\rangle}{\langle v_t,v_t\rangle}.$$

The direction is recomputed at each iteration from $G_t$, the cells called KO in the previous one, while $D_t$ stays fixed.

**Mixture and posterior.** The projections of the NT and guide cells of one split are fitted by EM to

$$p_i\sim\lambda\,\mathcal N(\mu_1,\sigma_1^2)+(1-\lambda)\,\mathcal N(\mu_0,\sigma_0^2),\qquad(\mu_0,\sigma_0)=\text{NT sample mean and SD},$$

so only the KO mean and SD, and $\lambda$, are free. The posterior is

$$P_i=\frac{\lambda\,\phi_1(p_i)}{\lambda\,\phi_1(p_i)+(1-\lambda)\,\phi_0(p_i)},$$

and a cell is called KO when $P_i>\tfrac12$. Seurat's rule $\tilde P_i=\phi_1/(\phi_0+\phi_1)$ drops the mixing weights and equals $P_i$ at $\lambda=\tfrac12$. The escape fraction is $\hat e_t=1-|G_t|^{-1}\sum_{i\in G_t}P_i$ with binomial standard error $\sqrt{\hat e_t(1-\hat e_t)/|G_t|}$; at $\hat e_t=0.5$ and 50 guide cells this is about 0.07, before any calibration error. Each class is modelled as Gaussian.

**Idealised behaviour.** Let $f$ be the full KO effect vector, so $\mathbb E\Delta_i=f$ for KO cells and $\mathbb E\Delta_i=0$ for NT cells, and let $e_t$ be the NP share of $G_t$. Then $\mathbb E[v_t]\propto(1-e_t)f$. The direction is therefore $u=f/\lVert f\rVert$ whatever $e_t$ is, and the KO cluster sits at $p=1/(1-e_t)$ rather than at 1. Separability,

$$d'=\frac{\mu_1-\mu_0}{\sigma_0}=\frac{\langle f,u\rangle}{\mathrm{sd}\,\langle\Delta_{NT},u\rangle},$$

is invariant to the scale of $v_t$, so escape moves the KO cluster and the fitted $\lambda$ but not $d'$. Outside this model, escape can bias the direction through DE gene selection and through heterogeneous effect sizes. Under equal variance and equal priors the Bayes error of the midpoint rule is $\Phi(-d'/2)$, about 0.16 at $d'=2$; Mixscape fixes $\sigma_0$ and fits $\sigma_1$ freely, so the formula is an approximation.

**Prior weight.** The 0.5 cut is the likelihood-ratio cut $\phi_1/\phi_0=(1-\lambda)/\lambda$. The fitted $\lambda$ is the share of pooled NT and guide cells assigned to the KO component, so it falls as the NT count grows. At $\lambda=0.1$ the cut needs a KO density nine times the NT density, which biases calls toward NP. The two implementations therefore disagree by an amount that depends on the NT count as well as on the effect.

**Why a model.** A fixed cut on $p_i$ is the Bayes rule for well-separated classes with a single crossing. The mixture adds a per-target threshold learned from the target's own cells, a posterior with an explicit prior and a convergence diagnostic. By the argument above it does not add separability along a direction. Its practical gain is the shared projection and a null estimated within the same split.

**Failure modes.**

- Escaper-rich targets and heterogeneous effects break the Gaussian shape and the direction. A target with fewer than five DE genes is all NP, so non-response and escape become indistinguishable.
- Self-inclusion in the NT null and correlated neighbourhoods distort $\mu_0$ and $\sigma_0$.
- Double dipping: DE genes, direction and mixture use the cells that are then classified, which inflates separation and overstates posteriors.
- Iteration can drift, because each direction depends on the previous calls, and convergence to a fixed point is not guaranteed.
- Cell-cycle, batch or library-size axes that load on $v_t$ can mimic a perturbation.
- Guide misassignment (`perturbation.guide_assignment`) feeds the NP class directly.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Mixscape, pertpy implementation | model-based | per-target DE genes, NT kNN signature, projection, fixed-NT two-component mixture, posterior above 0.5 | [R1], [R5] |
| Mixscape, Seurat implementation | model-based | the same pipeline in R with a constrained `normalmixEM` and a posterior without mixing weights | [R1], [R4] |
| Mixscale, pertpy implementation | heuristic | DE genes capped at 100, standardised projection score, no class | [R3], [R5] |

Mixscape is the binary per-cell method applied in the chapter [R1, R10]. Mixscale is the graded alternative [R3]. Its row rests on the pertpy code and on the R package's README and DESCRIPTION, and the method paper is cited for the method's purpose only. A knockdown-threshold classifier is not included as a row.

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| Mixscape (pertpy) | `min_de_genes` | 5 | `src/pertpy/tools/_perturbation_efficacy/_mixscape.py:54` @c246f24 |
| Mixscape (pertpy) | `logfc_threshold` | 0.25 | `_mixscape.py:55` @c246f24 |
| Mixscape (pertpy) | DE test | Wilcoxon | `_mixscape.py:57` @c246f24 |
| Mixscape (pertpy) | `iter_num` | 10 | `_mixscape.py:58` @c246f24 |
| Mixscape (pertpy) | `scale` | true (z-score of direction genes) | `_mixscape.py:59,185` @c246f24 |
| Mixscape (pertpy) | adjusted p cut-off | 0.05 | `_mixscape.py:61`; `_base.py:275` @c246f24 |
| Mixscape (pertpy) | `random_state` | 0 | `_mixscape.py:63` @c246f24 |
| Mixscape (pertpy) | posterior cut | 0.5 on $P_i$ | `_mixscape.py:247,250` @c246f24 |
| Mixscape (pertpy) | GMM tolerance, iterations, covariance floor | 1e-3, 100, 1e-6 | `_mixscape.py:1170-1180` @c246f24 |
| Mixscape (pertpy) | NT null mean and SD | mean and population SD (ddof 0), fixed in the mixture | `_mixscape.py:224,233-234` @c246f24 |
| Mixscape (pertpy) | neighbours, dimensions | 20, 15 | `_base.py:73,75` @c246f24 |
| Mixscape (pertpy) | NNDescent epsilon | 0.1 | `_base.py:166` @c246f24 |
| Mixscape (pertpy) | fewer direction genes; fewer KO cells | all cells NP; KO floor equals `min_de_genes` | `_base.py:276-277`; `_mixscape.py:255` @c246f24 |
| Mixscape (Seurat) | `min.de.genes`; `min.cells` | 5; 5 (fewer KO cells gives all NP) | `R/mixscape.R` RunMixscape signature ~683-700 @5f67c70 |
| Mixscape (Seurat) | `logfc.threshold`; `iter.num`; `prtb.type` | 0.25; 10; KO | RunMixscape signature ~683-700 @5f67c70 |
| Mixscape (Seurat) | signature slot; `ndims`; `num.neighbors` | `data` (unscaled); 15; no default, NULL is an error | CalcPerturbSig ~39-50; `R/mixscape.R:57-59` @5f67c70 |
| Mixscape (Seurat) | mixture fit | `normalmixEM`, k=2, NT mean and SD constrained, maxit 5000, maxrestarts 100 | `R/mixscape.R` ~822-832 @5f67c70 |
| Mixscape (Seurat) | posterior | cut 0.5; likelihood ratio ignores mixing weights | `R/mixscape.R` ~833-837 @5f67c70 |
| Mixscape (Seurat) | NT null moments | mean and SD (ddof 1) of NT projections, fixed in the mixture | `R/mixscape.R` ~827-828, ~1158-1161 @5f67c70 |
| Mixscale (pertpy) | `min_de_genes`; fallback | 5; score fixed at 1 below it | `src/pertpy/tools/_perturbation_efficacy/_mixscale.py:77` @c246f24 |
| Mixscale (pertpy) | `max_de_genes` | 100 | `_mixscale.py:78` @c246f24 |
| Mixscale (pertpy) | `logfc_threshold` | 0.25 | `_mixscale.py:79` @c246f24 |
| Mixscale (pertpy) | standardisation | direction genes z-scored and clipped at 10; score standardised by NT mean and SD (ddof 1) | `_mixscale.py:82,114,252-262`; `_mixscale.py:226-230` @c246f24 |
| Mixscale (pertpy) | `fine_mode`; `de_genes_by_target` | false; none (a fixed set skips the DE test) | `_mixscale.py` docstring and `mixscale` signature @c246f24 |

## 5. Proposed singlet approach

**Routes.** Mixscape (pertpy) is **ported** (routes in section 12): the logic is translated to C++, with pertpy outputs as the oracle. Mixscape (Seurat) is **reimplemented** only for its posterior, selected as `posterior_prior: equal`, from the equations of section 3, with Seurat output as a second oracle. Mixscale is **reimplemented** from its equations (routes in section 12), and no code is copied.

**Default.** `mixscape` with pertpy-compatible settings and two corrections, both on: the self-term is removed from NT signatures (`exclude_self`), and the target gene is removed from direction genes and mixture inputs (`exclude_target`). The second costs power, since the target gene is the most direct readout of a CRISPRi knockdown, but it keeps B2 non-circular. Parity mode switches both off. B1 and P1 decide whether they stay on (section 10).

**Proposed latent-class model.** Each guide cell has latent $z_i\in\{0,1\}$ with a per-target escape prior $\pi_t$ (Beta). Direction genes follow negative binomial counts with mean $\mu_{ig}=s_i\,\bar p_g(i)\,e^{\beta_{tg}z_i}$, where $\bar p_g(i)$ is the NT-neighbourhood mean proportion; an optional knockdown term carries a learned depth, and a random effect per replicate absorbs batch. EM or variational Bayes gives calibrated $P_i$ and a posterior over $e_t$. The model is kept only if B1 ECE is at most 0.05, B4 false-KO is at most 0.05 under protocol (a), and B1 AUROC for $\delta\ge1$ is at least that of `mixscape`.

**ML stack and kernels.** PyTorch serves the prototype, with batched EM across targets. Because the model has few parameters per target, the hot path is hard-coded: the neighbour average $W\,\mathrm{expm1}(X_C)$ as a cuSPARSE SpMM, per-target rank sums on CPU, and the one-dimensional EM on CPU or as a batched CUDA kernel. A CUDA E-step is added only if profiling requires it. Neighbour indices are built per split; streaming holds one split's NT reference.

**Defaults.** Section 6 gives the values; `method` is `mixscape`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/log1p` | float32, sparse | unscaled log-normalised expression; signature and DE input |
| read | `obsm/X_pca` | float32, cells by at least `n_dims` | neighbour space; computed from `layers/log1p` when absent |
| read | `obs/target_gene` | categorical | target per cell; control label for NT cells |
| read | `obs/replicate` | categorical | split key; neighbours and mixture fits stay within one level |
| write | `obs/mixscape_class` | categorical | `<target> KO`, `<target> NP` or `NT` |
| write | `obs/mixscape_class_global` | categorical | `KO`, `NP` or `NT` |
| write | `obs/mixscape_p_ko` | float32 in [0,1] | posterior $P_i$; NaN for NT cells and for targets with no class |
| write | `obs/mixscale_score` | float32 | standardised projection; written by `mixscale` only |
| write | `layers/X_pert` | float32, cells by genes | signature $\Delta_i$ for guide and NT cells, in log1p units |
| write | `uns/mixscape_de_genes` | dictionary | direction genes per target with log fold change and adjusted p |
| write | `uns/mixscape_escape_rate` | table | per target: guide cells, KO-called cells, $\hat e_t$, binomial standard error |
| write | `uns/escaper_diagnostics` | dictionary | per target: $\lambda$, $\mu_1$, $\sigma_1$, $\mu_0$, $\sigma_0$, iterations, convergence, changed calls per iteration, self-excluded flag, split key |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "mixscape" | `mixscape`, `mixscale` | mixscape gives KO/NP calls and posteriors; mixscale returns a graded score and no class. |
| `targets` | array | [] | — | Target genes to classify; an empty list classifies every target with guide cells. |
| `design` | object | — | — | Column names, control label, split key, layer and embedding of the input. |
| `design.target_key` | string | "target_gene" | — | obs column with each cell's target gene. |
| `design.control_label` | string | "NT" | — | Target value of non-targeting control cells. |
| `design.split_by` | string | "replicate" | — | obs column; non-targeting neighbours and mixture fits stay within one level. |
| `design.layer` | string | "log1p" | — | Unscaled log-normalised layer used for signatures and DE tests. |
| `design.embedding_key` | string | "X_pca" | — | obsm key of the embedding for neighbour search; computed from the layer when absent. |
| `neighbourhood` | object | — | — | Non-targeting neighbours used to build perturbation signatures. |
| `neighbourhood.n_neighbors` | integer | 20 | min 1 | Non-targeting neighbours averaged per cell for the signature. |
| `neighbourhood.n_dims` | integer | 15 | min 1 | Embedding dimensions used for the neighbour search. |
| `neighbourhood.exclude_self` | boolean | true | — | Remove each non-targeting cell from its own neighbour set. |
| `neighbourhood.epsilon` | number | 0.1 | min 0 | Approximate neighbour search tolerance. |
| `de` | object | — | — | Direction-gene selection. |
| `de.min_de_genes` | integer | 5 | min 1 | Fewer direction genes than this labels all cells of the target NP. |
| `de.logfc_threshold` | number | 0.25 | min 0 | Minimum absolute log fold change of direction genes. |
| `de.pval_cutoff` | number | 0.05 | max 1; > 0 | Adjusted p-value cut-off of direction genes. |
| `de.exclude_target` | boolean | true | — | Drop the target gene from direction genes and mixture inputs. |
| `de.split_fraction` | number | 0 | min 0; max 0.9 | Share of cells used to select direction genes; 0 disables cross-fitting. |
| `mixscape` | object | — | — | Options of the two-component mixture call. |
| `mixscape.iter_num` | integer | 10 | min 1 | Maximum relabelling iterations of direction and mixture. |
| `mixscape.posterior_prior` | string | "pooled_lambda" | `pooled_lambda`, `equal` | pooled_lambda uses the fitted mixing weight; equal reproduces the Seurat posterior. |
| `mixscape.posterior_threshold` | number | 0.5 | > 0; < 1 | Posterior above which a guide cell is called KO. |
| `mixscape.min_cells` | integer | 5 | min 1 | Targets with fewer KO cells in an iteration are labelled all NP. |
| `mixscape.scale` | boolean | true | — | Z-score direction genes before the mixture fit. |
| `mixscale` | object | — | — | Options of the standardised projection score. |
| `mixscale.max_de_genes` | integer | 100 | min 1 | Largest number of direction genes used for the score. |
| `mixscale.clip` | number | 10 | min 0 | Absolute clip of each direction gene's z-score before projection. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for mixture starts; the mixscale path is deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`method: mixscape` writes class, posterior and signature; `mixscale` writes only the score, and the `mixscape_*` class members stay unwritten. `targets` restricts classification, and skipped targets are listed in diagnostics. `neighbourhood.exclude_self`, `de.exclude_target` and `mixscape.posterior_prior: equal` change calls and are recorded in `uns/escaper_diagnostics`. A target is labelled all NP when it has fewer direction genes than `de.min_de_genes` or fewer KO cells than `mixscape.min_cells` in an iteration. A `de.split_fraction` above 0 selects direction genes on one part of the cells and classifies the rest.

## 7. MCP tool

Tool name `singlet_perturbation_escaper_classification` (definition in `tasks/mcp/singlet_perturbation_escaper_classification.json`). Example call and compact result; placeholders show the shape and are not measurements:

```json
{"dataset": "/data/screens/example.singlet", "method": "mixscape", "design": {"target_key": "target_gene", "split_by": "replicate"}, "seed": 0}
```

```json
{
  "dataset": "/data/screens/example.singlet",
  "status": "completed",
  "wrote": ["obs/mixscape_class", "obs/mixscape_class_global", "obs/mixscape_p_ko", "layers/X_pert", "uns/mixscape_de_genes", "uns/mixscape_escape_rate", "uns/escaper_diagnostics"],
  "summary": {"method": "mixscape", "n_targets": "<int>", "n_targets_all_np": "<int>", "n_guide_cells": "<int>", "fraction_ko": "<float>", "targets_not_converged": "<int>"},
  "provenance_id": "<id>", "job_id": null, "estimate": null
}
```

- **Long-running**: yes when the estimate exceeds the inline limit; the status is then `queued`.
- **Stochastic**: yes, through `seed` (mixture starts); the `mixscale` path is deterministic.
- **Dry-run estimate**: seconds, peak memory and device, from target count, guide cells and neighbour count, without fitting.

## 8. Benchmarks

Shared protocol. Every method receives the same `layers/log1p` layer, the same embedding (15 dimensions unless stated), the same target labels and NT control, with the defaults of section 6. The NT reference of a split is drawn only from that split, and guide cells are never used as reference. Methods see expression, labels and NT cells, never the planted or pseudo-target labels. Simulated results are averaged over seeds 0 to 19 with the spread reported. Each result records software versions and commits (section 12), hardware, and whether direction genes were selected on the classified cells.

### B1. Planted escapers on a real non-targeting background (proposed)

- **Goal**: accuracy, calibration and escape-rate error with planted labels.
- **Ground truth**: planted simulation; per-cell estimand $z_i$ (1 = KO); per-target estimand $e_t$, the cell-weighted planted NP share.

| Dataset | Source (reference, accession or URL) | Modality, species, size | Notes |
|---|---|---|---|
| Papalexi et al. 2021 [R1, R8] | pertpy `papalexi_2021` [R5]; `https://exampledata.scverse.org/pertpy/papalexi_2021.h5mu` | RNA, ADT, guide; human | background |

- **Generator**:
  1. Take the NT cells of one source replicate: counts $C_{ig}$, library sizes $L_i$, mean proportions $\bar p_g$; three simulated replicates use the three Papalexi biological replicates [R10].
  2. Per simulated target (20 per screen), choose $m$ genes among those detected in 5% of NT cells, with random signs $s_g$.
  3. Set $f_g=\exp(s_g\,\delta\,\sigma_g)$, with $\sigma_g$ the NT SD of log1p expression, so $\delta$ is in NT SD units.
  4. Draw $z_i\sim\mathrm{Bernoulli}(1-e)$; for $z_i=1$ draw the $m$ genes from $\mathrm{NB}(L_i\bar p_g f_g,\theta_g)$; for $z_i=0$ use $\mathrm{NB}(L_i\bar p_g,\theta_g)$; $\theta_g$ by moments on NT cells. NT references exclude simulated cells.

  Grid: $\delta\in\{0.5,1,2\}$, $m\in\{5,20,100\}$, $e\in\{0,0.25,0.5\}$, guide cells per target $\in\{50,200,1000\}$.

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC over guide cells | ROC-AUC of $P_i$ against $z_i$, pooled over targets | maximise | primary | — |
| Brier score | mean of $(P_i-z_i)^2$ over guide cells | minimise | primary | — |
| Expected calibration error | 10 equal-width bins on $P_i$; weighted $\lvert\bar z_b-\bar P_b\rvert$ | minimise | guardrail | — |
| Escape-rate error | $\lvert\hat e_t-e_t\rvert$, with $\hat e_t=1-\bar P$ over guide cells of $t$ | minimise | primary | — |

- **Comparators**: `mixscape` in parity mode, with `posterior_prior: equal`, and with defaults; `mixscale` with a Youden-J cut fitted on half the cells of each target.
- **Protocol**: 81 grid cells, 20 seeds.
- **Acceptance criterion** (proposed): at $e=0$, at most 5% of NT cells called KO; at $\delta\ge1$, $m\ge20$ and $\ge200$ guide cells per target, median $\lvert\hat e_t-e_t\rvert\le0.05$ and AUROC $\ge0.9$; ECE at most 0.05 for the parity posterior.
- **Known pitfalls**: a Gaussian generator would favour the classifier's own model.

### B2. Target-mRNA knockdown concordance (proposed, orthogonal)

- **Goal**: check that KO-called cells show lower target-gene expression than NP-called cells, with the target gene kept out of the classifier.
- **Ground truth**: orthogonal measurement. Per cell, the target gene's `layers/log1p` value; the estimand is the within-target KO-versus-NP separation. AUROC and medians are invariant to monotone normalisation.

| Dataset | Source (reference, accession or URL) | Modality, species, size | Notes |
|---|---|---|---|
| Papalexi et al. 2021 [R1, R5] | pertpy loader `papalexi_2021` | RNA and ADT; human, stimulated THP-1 | primary knockout set |
| Dixit et al. 2016 [R2] | pertpy loader `dixit_2016`; `https://exampledata.scverse.org/pertpy/dixit_2016.h5ad` | RNA; size — | — |
| Frangieh et al. 2021 [R7] | pertpy loader `frangieh_2021`; `https://exampledata.scverse.org/pertpy/frangieh_2021.h5ad` | RNA and 20 surface proteins; over 218,000 cells | large-scale check |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Within-target AUROC | per target with at least 20 cells per class, ROC-AUC with KO as the low class; median over targets, bootstrap over targets | maximise | primary | — |
| Knockdown depth | (median NT minus median KO) divided by the NT SD of target expression | maximise | primary | — |
| KO share below NT 5th percentile | share of KO-called cells below the NT 5th percentile of target expression | maximise | guardrail | — |

- **Comparators**: `mixscape` with the target excluded (default); `mixscale` score with its top share matched to the `mixscape` KO rate per target; random calls at each target's KO rate (null).
- **Protocol**: the target gene is removed from direction genes and signature inputs for every method; results are reported per dataset. CRISPRa data (Norman 2019 [R6]) are excluded, because the expected direction reverses.
- **Acceptance criterion** (proposed): median within-target AUROC at least 0.6 across strongly knocked-down targets; random-call null near 0.5.
- **Known pitfalls**: CRISPRko may leave a transcript (nonsense-mediated decay, in-frame deletions), so target mRNA is a weak proxy. Guide-specific depth differs.

### B3. PD-L1 protein for IFN-gamma pathway targets (proposed, orthogonal)

- **Goal**: check KO calls against PD-L1 surface protein in the direction the best-practices chapter reports for IFNGR2, JAK2 and STAT1 [R10].
- **Ground truth**: orthogonal protein measurement. The per-cell quantity is PD-L1 ADT as stored in the dataset; the estimand is the per-target KO-minus-NP difference in protein. AUROC and medians are monotone-invariant, so the ADT normalisation does not affect them.

| Dataset | Source (reference, accession or URL) | Modality, species, size | Notes |
|---|---|---|---|
| Papalexi et al. 2021, ADT modality [R1, R5] | pertpy loader `papalexi_2021` | ADT panel including PDL1 (chapter lists four surface proteins); human, THP-1 | NT cells as reference, as in the chapter |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Per-target AUROC, PD-L1 ADT | ROC-AUC with KO as the low-protein class; 95% interval from a bootstrap over cells | maximise | primary | — |
| Direction agreement | KO median below NP median, for each of IFNGR2, JAK2 and STAT1 | maximise | primary | [R10] |
| Spearman correlation, Mixscale score and ADT | per target, across guide cells | maximise | guardrail | [R3] |

- **Comparators**: `mixscape` KO versus NP calls; `mixscale` score; random calls matched to each target's rate.
- **Protocol**: the three named targets first, then any other target whose protein expectation is recorded before classification. Intervals are bootstrapped over cells.
- **Acceptance criterion** (proposed, not from the literature): direction matches for all three targets, and the lower bound of each AUROC interval exceeds 0.5.
- **Known pitfalls**: the protein reflects the pathway rather than the guide, so the check is indirect. With three named targets the power is low.

### B4. Pseudo-target null calibration on non-targeting cells (proposed)

- **Goal**: check that KO calls on cells with no perturbation occur at the nominal rate.
- **Ground truth**: planted null. NT cells are assigned to pseudo-targets by random partition within a replicate, so every pseudo-target cell has $z_i=0$. The estimand is the cell-weighted share of pseudo-target cells with $P_i>0.5$.

| Dataset | Source (reference, accession or URL) | Modality, species, size | Notes |
|---|---|---|---|
| Papalexi et al. 2021 NT cells [R1, R5] | pertpy loader `papalexi_2021`; URL as in B1 | RNA; NT subset size — | — |
| Frangieh et al. 2021 NT cells [R7] | pertpy loader `frangieh_2021`; `https://exampledata.scverse.org/pertpy/frangieh_2021.h5ad` | RNA; NT subset size — | — |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| False-KO rate | share of pseudo-target cells with $P_i>0.5$; nominal value 0.05 | minimise | primary | — |
| Degenerate fraction | share of pseudo-targets with fewer than `min_de_genes` direction genes under protocol (b) | minimise | guardrail | — |
| Mean posterior on pseudo-target cells | mean of $P_i$ over pseudo-target cells | minimise | guardrail | — |

- **Protocol**: 200 pseudo-targets per dataset, guide-cell counts matched to real targets; pseudo-target cells are removed from their split's NT reference. (a) Direction genes borrowed from a real strong target; report the false-KO rate. (b) Own direction genes; report the degenerate fraction and the false-KO rate among non-degenerate pseudo-targets. Comparators: `mixscale` with `de_genes_by_target` borrowed from a real target; `mixscape` with its own set; `mixscape` with a forced set (a singlet option, not in pertpy).
- **Acceptance criterion** (proposed, not from the literature): under (a), false-KO rate at most 0.05; under (b), the degenerate fraction is reported and does not count toward meeting the criterion.
- **Known pitfalls**: with own DE sets, pseudo-targets are expected to be degenerate and meet the criterion trivially, so only (a) is informative. Pseudo-targets drawn from another replicate would mismatch the NT reference.

### P1. Performance and scaling

Wall time, peak host and device memory, and throughput in cells per second for classifying all targets, on CPU and CUDA, at $10^4$ cells with 50 targets, $10^5$ cells with 500 targets, $2.18\times10^5$ cells with about 750 perturbations (the scale of the Frangieh loader), and $10^6$ cells as a stress test. Comparators: pertpy Mixscape on CPU, Seurat `RunMixscape` in R, and singlet in parity and default modes. Hold the section 6 defaults fixed. Acceptance criterion (proposed): KO-call agreement with pertpy on identical inputs in parity mode of at least 99%, to be validated.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `perturbation.guide_assignment`: Per-cell guide and perturbation assignment
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Feeds**:
  - `perturbation.perturbation_effect_estimation`: Per-perturbation differential expression and effect-size estimation
  - `perturbation.knockdown_efficacy`: On-target knockdown efficacy per guide or perturbation
- **Reads**: `layers/log1p`, `obsm/X_pca`, `obs/target_gene`, `obs/replicate`
- **Writes**: `obs/mixscape_class`, `obs/mixscape_class_global`, `obs/mixscape_p_ko`, `obs/mixscale_score`, `layers/X_pert`, `uns/mixscape_de_genes`, `uns/mixscape_escape_rate`, `uns/escaper_diagnostics`
<!-- CHAINING:AUTO:END -->

No recipe is assigned yet. The task sits between guide assignment and effect estimation.

## 10. Risks, pitfalls and open questions

- **No per-cell truth, and the first experiment.** No independent per-cell label for escape is available in the sources used here, so B1 and B4 are the only controls with known labels. The first experiment reproduces pertpy Mixscape calls on identical inputs in parity mode and measures B1 and B4 for the reference settings, before any singlet default is trusted. The pertpy changelog (v1.4.0) reports that holding the control variance fixed changes about 0.4% of KO/NP calls on Papalexi 2021; this figure is quoted, not reproduced here.
- **Code-read differences not measured.** The effects of the self-term, of the posterior difference (pooled $\lambda$ in pertpy, equal weights in Seurat) and of target-gene exclusion on calls follow from the code and have not been measured. Seurat's DE step is not analysed here, and no GPU port of Mixscape is a method or comparator.
- **Dataset facts that conflict or are missing.** The pertpy loader describes the Papalexi screen as 11 gRNAs, while the best-practices chapter [R10] reports 111 guide RNAs for 26 targeted genes; the object must be checked before B1 and B4 use it. Replicate column names for Papalexi and Frangieh are not given here. Whether Frangieh's protein panel includes PD-L1 is unknown, so no second protein check is defined.
- **Chapter and literature claims.** The PD-L1 direction and the chapter's "about three quarters" KO figure for Papalexi are quoted from the chapter and not recomputed, and the chapter gives no effect size. Frangieh's handling of escape is not described here. Replicate agreement of escape fractions (Spearman, ICC(2,1); proposed criterion median Spearman at least 0.7 for targets with at least 50 guide cells per replicate) is a consistency check with no truth. It is reported as a consistency check and not counted as accuracy, because high agreement can arise from a shared technical axis.
- **Literature unsettled.** The binary call of Mixscape and the graded score of Mixscale answer different questions, and the field has not chosen one for escape. The chapter states that the classification cannot separate failed knockouts from non-responders [R10]. The pertpy test suite is a smoke test: it uses 10 cells per group and an 80% accuracy threshold on a small test fixture, and says nothing about calibration on real screens.
- **Technical risks.** The Gaussian posterior can be overconfident on zero-inflated or heavy-tailed projections, so probabilities are reported only after B1 calibration. Cross-fitting through `split_fraction` addresses double dipping, but its effect on calls is untested. Iteration drift is reported as changed calls per iteration, because pertpy's only signal of a non-converged mixture is a ConvergenceWarning (`_mixscape.py:1191-1195`).

## 11. References

R1. Papalexi E, Mimitou EP, Butler AW, et al. Characterizing the molecular regulation of inhibitory immune checkpoints with multimodal single-cell screens. *Nature Genetics* 2021. doi:10.1038/s41588-021-00778-2 — verified (corpus)

R2. Dixit A, Parnas O, Li B, et al. Perturb-Seq: dissecting molecular circuits with scalable single-cell RNA profiling of pooled genetic screens. *Cell* 2016. doi:10.1016/j.cell.2016.11.038 — verified (corpus)

R3. Jiang L, Dalgarno C, Papalexi E, et al. Systematic reconstruction of molecular pathway signatures using scalable single-cell perturbation screens. *Nature Cell Biology* 2025. doi:10.1038/s41556-025-01622-z — verified (corpus)

R4. Hao Y, Stuart T, Kowalski MH, et al. Dictionary learning for integrative, multimodal and scalable single-cell analysis. *Nature Biotechnology* 2024. doi:10.1038/s41587-023-01767-y — verified (corpus)

R5. Heumos L, Ji Y, May L, et al. Pertpy: an end-to-end framework for perturbation analysis. *Nature Methods* 2025. doi:10.1038/s41592-025-02909-7 — verified (corpus)

R6. Norman TM, et al. Exploring genetic interaction manifolds constructed from rich single-cell phenotypes. *Science* 2019. doi:10.1126/science.aax4438 — verified (repo)

R7. Frangieh CJ, Melms JC, Thakore PI, et al. Multimodal pooled Perturb-CITE-seq screens in patient models define mechanisms of cancer immune evasion. *Nature Genetics* 2021. doi:10.1038/s41588-021-00779-1 — verified (repo)

R8. Stoeckius M, Hafemeister C, Stephenson W, et al. Simultaneous epitope and transcriptome measurement in single cells. *Nature Methods* 2017. doi:10.1038/nmeth.4380 — verified (corpus)

R9. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)

R10. Theis lab. Single-cell best practices, chapter "Perturbation modelling" (Jupyter Book). — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/pertpy | Lukas Heumos, Lilly May, Stefan Peidli, Johannes Ostner and others (pyproject.toml) | MIT (LICENSE file); CITATION.cff and README badge state Apache-2.0; pyproject classifier states Apache Software License | reference Mixscape and Mixscale implementation; test oracle; dataset loaders | port |
| https://github.com/satijalab/seurat | Authors listed in DESCRIPTION Authors@R (version 5.6.0.9000) | MIT (DESCRIPTION: MIT + file LICENSE) | Mixscape R implementation; posterior variant; second oracle | reimplement |
| https://github.com/satijalab/Mixscale | — | none (no LICENSE file; no License field in DESCRIPTION) | R package for Mixscale; scoring code and DESCRIPTION | reimplement from equations |

Dataset licences are not stated in this document.
