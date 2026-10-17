---
id: normalization.count_noise_model_selection
title: Count noise-model selection and zero-inflation diagnosis
area: normalization
scope: extended
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [ingest-quant.umi_deduplication, cell-calling.cell_vs_empty_droplet_calling]
feeds: [normalization.variance_stabilizing_transform, normalization.dispersion_estimation, normalization.normalization_pipeline_selection, dim-reduction.count_model_latent_factors]
reads: [layers/counts, obs/total_counts, obs/protocol, uns/negative_control/counts]
writes: [varm/count_family, varm/theta, varm/zi_pi, varm/R0, uns/count_family_selection, uns/count_family_diagnostics, models/count_family_<name>]
devices: [cpu, cuda]
mcp_tool: singlet_normalization_count_noise_model_selection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Count noise-model selection and zero-inflation diagnosis

> For each gene, decides whether raw counts need a Poisson, negative binomial or zero-inflated negative binomial model, using negative controls or a depth-only null, and reports the dispersion and calibration that a normalisation must assume.

## 1. Question

Do the excess zeros in a count matrix need a zero-inflation (dropout) term, or are they explained by Poisson or negative binomial sampling at the observed depth plus biological variation, and which count family should a normalisation assume? Inputs are raw integer counts, optional negative-control counts and protocol metadata. Outputs are a family per gene, its dispersion and zero-inflation estimates, and calibration diagnostics. A correct answer reproduces the zero fraction of technical controls and predicts withheld molecules.

## 2. Why this task matters and where the field stands

Zeros dominate single-cell count matrices, and every normalisation makes an implicit claim about where they come from. One reading treats most zeros as sampling zeros from Poisson or negative binomial (NB) counts at low mean and depth, with biological rate heterogeneity supplying the overdispersion. The other adds a zero-inflation term, a mixture that makes zeros more frequent than any NB predicts [R1]. A third reading separates measurement from expression, so that zeros arise from a Poisson measurement of a flexible expression distribution and need no dropout term [R2].

Status: **contested**. For UMI droplet data, Svensson reports that the zeros are not zero-inflated [R3]. Cao et al. accept that result but dispute its extension to read-based plate data [R4]. Choudhary and Satija report that a Poisson error model suffices for sparse genes and that overdispersion is needed for well-covered genes [R5]. Noise models for single-cell transcriptomics have a validation literature of their own [R9]. The open problems are:

- Plate-based read counts may carry zero inflation beyond sampling, from length, amplification and multi-mapping effects; the cited UMI analyses do not test this [R4].
- No accepted operational test separates measurement zeros from expression zeros in real data [R2].
- Zero inflation and overdispersion trade off at low mean, where the zero fraction carries little information (section 3).

Negative-control datasets calibrate technical overdispersion with a closed-form depth model [R6]. Regularised NB regression pools dispersion across genes [R7]. The shifted logarithm of median-depth counts is the default in common practice and makes no claim about the count family [R8]. Hicks et al. frame zeros within missing data and technical variability [R10]. The task is to decide, gene by gene, which of these readings the data support.

## 3. Theory and insight

Notation: $y_{gc}$ is the count of gene $g$ in cell $c$; $y_{g\cdot}$, $y_{\cdot c}$ and $y_{\cdot\cdot}$ are the gene, cell and grand sums; $n_c=y_{\cdot c}$.

**Families.** The negative binomial, $Y_{gc}\sim\mathrm{NB}(\mu_{gc},\theta_g)$, has

$$\operatorname{Var}[Y_{gc}]=\mu_{gc}+\mu_{gc}^{2}/\theta_g,$$

and $\theta_g\to\infty$ recovers the Poisson. It is a Poisson whose rate is gamma distributed with mean $\mu_{gc}$ and shape $\theta_g$, so its overdispersion is rate heterogeneity rather than a separate zero mechanism. The fixed-$\theta_g$ form holds within a population that is homogeneous given the covariates in the model.

The zero-inflated negative binomial adds a structural zero with probability $\pi_{gc}$:

$$P(Y_{gc}=0)=\pi_{gc}+(1-\pi_{gc})\Big(\tfrac{\theta_g}{\theta_g+\mu_{gc}}\Big)^{\theta_g}.$$

Its moments are $\mathbb E[Y]=(1-\pi)\mu$ and $\operatorname{Var}[Y]=(1-\pi)\,\mu\,(1+\mu/\theta+\pi\mu)$. The term $\pi\mu^2$ has the same form as $\mu^2/\theta$, so variance alone cannot separate $\pi$ from $1/\theta$. The zero fraction at moderate to high mean can, because the NB predicts few zeros there.

**Measurement and expression.** With a Poisson measurement scaled by cell size $s_c$ and a gene-level expression prior $g_g$, the zero probability is

$$P(Y_{gc}=0)=\int e^{-s_c\lambda}\,g_g(d\lambda).$$

A point mass of $g_g$ at zero is biological absence, whereas a dropout term is a per-cell technical event. The argument that the dropout label conflates the two is made by Sarkar and Stephens [R2]. The identity holds for any prior, so the question is which decomposition is identifiable and useful for normalisation.

**Depth-only null.** Under independence of gene and cell margins, the expected count is

$$\hat\mu_{gc}=\frac{y_{g\cdot}\,y_{\cdot c}}{y_{\cdot\cdot}},$$

the exact multinomial expectation without covariates [R11]. Analytic Pearson residuals at fixed $\theta$ are $r_{gc}=(y_{gc}-\hat\mu_{gc})/\sqrt{\hat\mu_{gc}+\hat\mu_{gc}^{2}/\theta}$, clipped to $\pm\sqrt{n}$ [R6]; they are approximate for large $n$ and fixed $\theta$. The binomial deviance of gene $g$ against the multinomial null, with $\hat\mu_{gc}=n_c\,y_{g\cdot}/y_{\cdot\cdot}$, is

$$D_g=2\sum_c\Big[y_{gc}\log\tfrac{y_{gc}}{\hat\mu_{gc}}+(n_c-y_{gc})\log\tfrac{n_c-y_{gc}}{n_c-\hat\mu_{gc}}\Big],$$

with $0\log 0=0$. It uses raw counts, is asymptotically chi-square for large $n_c$ and $\hat\mu$, and is used as a ranking statistic in practice [R11].

**Calibration.** The zero calibration ratio is

$$R_{0,g}=\frac{\sum_c\mathbf 1[y_{gc}=0]}{\sum_c\big(\hat\theta_g/(\hat\theta_g+\hat\mu_{gc})\big)^{\hat\theta_g}}.$$

This is a diagnostic defined in this document, not a published formula. Values near 1 mean no excess zeros; values well above 1 are the signature that a zero-inflation term would address. Its regime of validity is moderate to high mean (roughly $\hat\mu\ge 1$, a proposed bound), where NB zeros are few enough for the ratio to be informative.

**Estimands.** On the count scale unless noted. $\mu_{gc}$ is the expected UMI count of gene $g$ in cell $c$; summed over genes it returns the cell total. $\theta_g$ is the NB dispersion, not its logarithm. $\pi_g$ is a probability on $[0,1]$, and is per cell only under an explicit covariate model. $R_{0,g}$ is a dimensionless ratio of counts. $D_g$ is a deviance on raw counts, without normalisation.

**Assumptions and failure modes.** The depth factor is multiplicative and correctly specified, and UMI deduplication yields sampling-like molecule counts. Control material has no biological variation, so its overdispersion and zeros are technical. A mixture of cell types or states looks like zero inflation in pooled data, so stratify by cell type before claiming technical dropout. Ambient RNA adds non-technical background that differs by barcode. Minimum-detection filters condition $\theta$ and the zero fraction. Very high depth saturates UMIs and changes the mean-variance relation. Plate-based read counts carry variance beyond sampling, so UMI conclusions do not transfer to them [R4].

**Why a model.** The shifted logarithm [R8] has no count model, so it cannot be calibrated, gives no uncertainty for $\theta$ or $\pi$, and cannot say whether its zeros are sampling zeros. A fitted count model gives a calibration ratio with a null, a dispersion with uncertainty, parameters that a normaliser can reuse, covariate adjustment, and a likelihood for held-out molecules. The heuristic stays as the comparator and is displaced only where the benchmarks in section 8 favour the model.

**Pitfalls seen in benchmarks.** A likelihood-ratio test of ZINB against NB is invalid without boundary correction, because $\pi=0$ lies on the boundary and the null distribution is a 50:50 mixture of chi-square distributions with 0 and 1 degrees of freedom. Fitting a family and scoring it on the same molecules is leakage. Calibration on simulated controls drawn from the NB being calibrated is circular.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Analytic depth-only NB with control calibration | model-based | closed-form $\hat\mu$; per-gene $\theta$ by maximum likelihood; calibration on simulated controls | [R6] |
| Analytic Pearson residuals | model-based | NB residuals at fixed $\theta$, clipped to $\pm\sqrt{n}$ | [R6] |
| Binomial deviance against the multinomial null | model-based | per-gene deviance from a constant-rate expectation, on raw counts | [R11] |
| Regularised NB regression | model-based | per-gene NB GLM with log-depth offset; $\theta$ pooled across genes of similar mean | [R7] |
| Deep count autoencoder with NB or ZINB heads | model-based | learned encoder; output layer parameterises an NB or ZINB per gene | [R12] |
| Shifted logarithm of median-depth counts | heuristic | scale each cell to median depth, then $\log(1+x)$ | [R8] |

The published standards for count-based normalisation are the closed-form depth model with control calibration [R6] and regularised NB regression [R7]. The shifted logarithm [R8] is the heuristic standard in practice and is kept as the comparator. Deviance [R11] is a ranking statistic, and the NB and ZINB heads of DCA [R12] are learned comparators. The Poisson and ZINB families under test are specified in section 3 and are not tabulated as methods.

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| Analytic depth-only NB | per-gene $\theta$ maximum-likelihood iterations | 100 | umi-normalization/03_estimate_technical_overdispersion.ipynb:162 |
| Analytic depth-only NB | true dispersions simulated | Inf, 1000, 100, 10 | umi-normalization/03_estimate_technical_overdispersion.ipynb:245 |
| Analytic depth-only NB | simulated controls per dispersion | 1000 | umi-normalization/03_estimate_technical_overdispersion.ipynb:218 |
| Analytic depth-only NB | log-spaced gene means per simulated control | 50 | umi-normalization/03_estimate_technical_overdispersion.ipynb:218 |
| Analytic depth-only NB | simulation seed | 42 | umi-normalization/03_estimate_technical_overdispersion.ipynb:245 |
| Analytic depth-only NB | upper clip for $\theta$ in the plotting code | $10^5$ | umi-normalization/03_estimate_technical_overdispersion.ipynb:364 |
| Analytic depth-only NB | minimum detected cells per gene | 5 | umi-normalization/01_preprocess_PMBC_and_negative_controls.ipynb:65 (also :137, :182, :287) |
| Analytic Pearson residuals | residual clipping at $\pm\sqrt{n}$ | clipping=True | umi-normalization/tools.py:174; clip at :185–188 |
| Binomial deviance | family argument | binomial, then poisson | scry/R/featureSelection.R:89; deviance at :57 |
| Regularised NB | NB variance used for residuals | $\mu+\mu^2/\theta$ | sctransform/R/denoise.R:125 |
| DCA | `ae_type` | nb-conddisp | dca/dca/api.py:61 |
| Shifted logarithm | size-factor target | median raw count depth (scanpy `target_sum=None`) | single-cell-best-practices/jupyter-book/preprocessing_visualization/normalization.ipynb:222, :244 |
| Splatter (simulator option, B3) | `dropout.type`, `dropout.mid`, `dropout.shape` | none, 0, −1 | splatter/R/AllClasses.R:264–266 |

## 5. Proposed singlet approach

**Routes.** The closed-form depth model, the per-gene dispersion maximum likelihood, the control simulation, the analytic residuals and the binomial deviance are reimplemented from their equations, because the licences in section 12 do not permit porting. The sctransform regression, DCA, the shifted logarithm and the Splatter option are callouts used only as comparators.

**Model.** For each gene the fit is a depth-only offset model with $\mu$ from the closed form. Poisson has no free parameter; NB adds $\theta_g$ by maximum likelihood; ZINB adds $\pi_g$ by EM, with $\theta_g$ fitted jointly. The selected family is the simplest in `families` (Poisson, then NB, then ZINB) whose $R_{0,g}$ lies within the B1 bounds and, for ZINB, whose boundary-corrected likelihood-ratio test against NB is significant at `zinb.lrt_alpha`. Deviance, $R_{0,g}$ for every family and the multinomial null are always written.

**Methods.** `auto` uses control calibration when `uns/negative_control/counts` exists and deviance otherwise. Under `negative_control`, dispersion and zero inflation are estimated on the controls, the technical layer is judged against the B1 bounds, and the biological data are assigned families by the same rule. Under `deviance`, the data alone decide.

**Falsifiers.** The proposal fails if NB $R_{0,g}$ on pure-RNA controls lies outside the B1 bounds for more than 10 percent of genes, which would support a technical zero term, or if the selected family is beaten on held-out molecules by the margins in B2.

**Stack.** The closed-form $\hat\mu$, the deviance and $R_{0,g}$ need only gene and cell sums and become sparse kernels in CUDA and cuSPARSE. The per-gene dispersion (Newton or golden-section search) and the per-gene ZINB EM are small, memory-bound loops over genes and are hard-coded in CUDA. PyTorch serves two roles: an amortised dispersion predictor across studies (a small MLP over log mean, log depth and a protocol embedding, trained with the NB negative log-likelihood) and the DCA comparator.

**Scale.** The sums need one pass over nonzeros, so gene-chunked streaming bounds memory. Calibration simulations dominate run time and apply to controls only. GPU is the proposed default above $10^5$ cells.

**Defaults.** Agents use the generated defaults in section 6 without asking, and estimate with `dry_run` first when controls are present.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI or read counts; not normalised |
| read | obs/total_counts | float | per-cell depth; computed from layers/counts when absent |
| read | obs/protocol | categorical | droplet_umi, plate_read or other; separates the UMI and read conclusions |
| read | uns/negative_control/counts | sparse int | pure-RNA or cell-free barcode counts on the same genes |
| write | varm/count_family | categorical | selected family per gene |
| write | varm/theta | float32 | NB dispersion per gene; NaN where the fit diverged |
| write | varm/zi_pi | float32 | zero-inflation probability; NaN unless ZINB is selected |
| write | varm/R0 | float32 | observed over expected zeros for the selected family |
| write | uns/count_family_selection | table | per family and mean stratum: selected fraction and rule |
| write | uns/count_family_diagnostics | table | LRT statistics, deviance, $R_{0,g}$ and control dispersion summaries |
| write | `models/count_family_<name>` | model | fitted parameters per family, for reuse by a normaliser |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "counts" | — | Raw integer count layer to model; normalised or log-transformed values are rejected. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 42 | — | Seed for negative-control simulation; 42 matches the repository setting. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `families` | array | ["poisson", "nb", "zinb"] | — | Candidate families, simplest first. The depth-only multinomial null is always reported. |
| `method` | string | "auto" | `auto`, `negative_control`, `deviance` | auto uses negative_control when uns/negative_control/counts exists, otherwise deviance. |
| `stratify_by` | string/null | null | — | Optional obs column, such as cell type; families are selected within each level. |
| `min_detected_cells` | integer | 5 | min 1 | Genes detected in fewer cells are skipped before any fit, in controls and data alike. |
| `negative_control` | object | — | — | Options for control calibration; used only when negative_control or auto finds control counts. |
| `negative_control.max_iter` | integer | 100 | min 1 | Iterations for per-gene dispersion maximum likelihood. |
| `negative_control.theta_clip` | number | 100000 | min 1 | Dispersion estimates above this value are reported as diverged. |
| `negative_control.n_simulations` | integer | 1000 | min 1 | Simulated control datasets per true dispersion. |
| `negative_control.n_means_simulated` | integer | 50 | min 2 | Log-spaced gene means in each simulated control. |
| `negative_control.sim_thetas` | array | [1000, 100, 10] | — | Finite true dispersions to simulate; the Poisson case is always added. |
| `zinb` | object | — | — | Options for the zero-inflation test; used only when zinb is in families. |
| `zinb.lrt_alpha` | number | 0.05 | min 0; max 1 | Significance level of the boundary-corrected likelihood-ratio test of ZINB against NB. |
<!-- PARAMS:AUTO:END -->

The `negative_control` options apply only when control counts exist and the method is `negative_control` or `auto` selects it; otherwise the simulation options are ignored. `zinb.lrt_alpha` applies only when `zinb` is in `families`. `stratify_by` fits each family within levels of the chosen column and writes one selection row per level. `min_detected_cells` filters before every fit, for controls and data alike. A `layer` holding negative or non-integer values, or values that look normalised, is rejected rather than reinterpreted.

## 7. MCP tool

Tool name `singlet_normalization_count_noise_model_selection` (definition in `tasks/mcp/singlet_normalization_count_noise_model_selection.json`).

```json
{"dataset": "/data/example.singlet", "method": "auto", "families": ["poisson", "nb", "zinb"]}
```

```json
{
  "dataset": "/data/example.singlet",
  "status": "completed",
  "wrote": ["varm/count_family", "varm/theta", "varm/zi_pi", "varm/R0", "uns/count_family_selection", "uns/count_family_diagnostics"],
  "summary": {"method": "deviance", "n_genes": "<int>", "n_cells": "<int>", "family_counts": {"poisson": "<int>", "nb": "<int>", "zinb": "<int>"}, "median_R0": "<float>"},
  "provenance_id": "<id>",
  "job_id": null
}
```

Long-running: yes when the `negative_control` method is used, because control simulation dominates; `dry_run` returns seconds, peak memory and device. Stochastic: yes, `seed` drives control simulation only; fits are deterministic. A dry run is the recommended first call.

## 8. Benchmarks

**Shared protocol.** Genes are kept when detected in at least 5 cells (repository setting). Depth is the total UMI count per cell from `layers/counts`. Strata by gene mean are 0.05 to 0.5, 0.5 to 5 and above 5 (proposed). Stochastic steps use seed 42, and results are medians with interquartile ranges across replicates. Accuracy benchmarks report per dataset and are never pooled across studies. Hardware is recorded with every timing.

### B1. Negative-control calibration

- **Goal**: decide whether zeros in control material are consistent with NB sampling at the observed depth, and whether any excess is technical zero inflation.
- **Ground truth**: planted technical controls. Pure-RNA material has constant expression by design, so its true layer is technical only; the MicrowellSeq sample is biological and serves as a near-technical check. The label is per gene and needs no cell annotation. Mixture-control experiments with known composition are the pipeline-benchmark precedent for planted truth [R13]. The estimands are $R_{0,g}$ and $\hat\theta_g$ per gene on the count scale, with $\mu$ from the depth-only closed form computed on the control itself.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 10x v2 technical control (`svensson_chromium_control.h5ad`) | umi-normalization README; figshare 7860092 (https://figshare.com/articles/svensson_chromium_control_h5ad/7860092) | UMI droplet control; 18.82 MB file; species — | — | Single file |
| inDrop K562 pure-RNA control | GEO GSE65525, sample GSM1599501 | inDrop; human K562 pure RNA; 5.1 MB file | — | Pure RNA by design |
| MicrowellSeq E14 embryonic stem cell sample | GEO GSE108097, sample GSM2906413 | Microwell-seq; E14 embryonic stem cells; 7.9 MB file | — | Cells at depth 500 or below removed; treated as near-technical |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Zero calibration $R_{0,g}$ | $O_{0,g}/E_{0,g}$ with $E_{0,g}$ from the fitted NB; genes with $E_{0,g}<5$ excluded; report median and fraction outside [0.8, 1.25] | close to 1 | primary | — |
| Dispersion recovery | $\lvert\log_{10}\hat\theta_g-\log_{10}\theta\rvert$ per gene over 1,000 simulated controls per true $\theta\in\{\infty,1000,100,10\}$; median per true $\theta$; fits above $10^5$ counted as diverged | lower | primary | [R6] |
| Zero-inflation guardrail | fraction of genes with $\hat\pi_g>0.01$ under ZINB fitted by EM to the control | lower | guardrail | — |

- **Comparators**: Poisson; NB with one shared $\theta$; NB with per-gene $\theta$ (closed-form $\mu$, repository code); ZINB with per-gene $\pi$ by EM.
- **Protocol**: keep genes detected in at least 5 cells; closed-form $\mu$; per-gene $\theta$ by maximum likelihood with 100 iterations; $R_{0,g}$ and $\pi_g$ per gene; for each true $\theta$, simulate 1,000 controls over 50 log-spaced means with seed 42, refit and compute recovery; report per control dataset and per mean stratum.
- **Acceptance criterion** (proposed, not from the literature): for NB on each control, median $R_{0,g}$ in [0.9, 1.1] over genes with mean above 0.05 and at least 20 expected zeros; ZINB $\hat\pi_g<0.01$ for at least 90 percent of genes; median $|\Delta\log_{10}\hat\theta|\le 0.1$ for true $\theta$ of 100 or less; diverged fraction at most 1 percent. A violation of NB calibration is evidence of technical zero inflation.
- **Known pitfalls**: simulated controls drawn from the NB being calibrated are circular, so the verdict rests on the real controls; control chemistry and ambient background differ from cells, so calibration does not transfer to cells without a cell-level check.

### B2. Held-out molecular likelihood on catalogue studies

- **Goal**: rank Poisson, NB and ZINB by predictive likelihood for molecules withheld from the same cells and from unseen studies, and score each selection rule by how often it picks the better family.
- **Ground truth**: consistency. Molecules of each cell are partitioned before fitting, each assigned to the test partition with probability 0.5 (proposed) independently. Molecule-level partitioning follows molecular cross-validation [R14]. The estimand is the expected test negative log-likelihood per gene and family on the count scale. The training-fitted mean is used unchanged for the test partition, because both partitions are thinned by the same fraction.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue UMI studies (protocol annotation droplet UMI) | singlet catalogue of uniformly processed cells, selected by protocol annotation | UMI droplet data; species and size fixed by the query at run time | — | Split by study for unseen-study tests |
| Catalogue read-count studies | singlet catalogue, selected by protocol annotation | read-based or plate data; set by the query | — | Reported alone, never pooled with UMI studies [R4] |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Held-out NLL per gene and family | mean negative log-likelihood of test molecules under each family fitted on the training partition; ties go to the family with fewer parameters | lower | primary | [R14] |
| Selection agreement | fraction of genes whose selected family has the lower paired test NLL than the alternative | higher | primary | — |
| Paired family difference | NB minus Poisson, and ZINB minus NB, per gene, with a paired test across split repetitions | reported with acceptance | guardrail | — |

- **Comparators**: always-Poisson, always-NB and always-ZINB; the `deviance` rule; the `negative_control` rule where controls exist.
- **Protocol**: draw 20 percent of studies with a seed (proposed) as held-out studies; fit on the remaining studies and score the held-out studies. For within-study tests, fit on the training partition of every study and score its test partition. Repeat over five seeds starting at 42 (proposed). Report per mean stratum and per cell type where labels exist.
- **Acceptance criterion** (proposed, not from the literature): NB or ZINB reduces total held-out NLL by at least 1 percent relative to Poisson where overdispersion is present; ZINB improves over NB by at least 0.5 percent under a paired test across repetitions before ZINB is selected.
- **Known pitfalls**: cell-level splits leak cell state, and fitting before splitting leaks molecules; mixtures of cell types can favour ZINB, so stratify by cell type where labels exist.

### B3. Planted zero-inflation simulation

- **Goal**: estimate how often the ZINB rule selects ZINB under NB truth (false positives) and under ZINB truth (power), across means, dispersions and cell numbers.
- **Ground truth**: a planted simulation with known $\mu$, $\theta$ and $\pi$. The label of each gene is its generating family. The estimands are the selection rate per family and the bias of $\hat\pi$ and $\log_{10}\hat\theta$, with $\mu_{gc}$ a count per cell.
- **Generator recipe**:
  1. Draw the gene mean $\lambda_g$ from a gamma distribution with means on a log grid from 0.01 to 10 (proposed).
  2. Draw cell depth $s_c$ log-normal with log-standard deviation 0.3, rescaled to mean 1 (proposed).
  3. Set $\mu_{gc}=s_c\lambda_g$.
  4. Set $\theta_g\in\{10,100\}$ for NB genes, and $\theta_g=\infty$ (Poisson) for Poisson genes (proposed).
  5. NB truth: $Y_{gc}\sim\mathrm{NB}(\mu_{gc},\theta_g)$. ZINB truth: set $Y_{gc}=0$ with probability $\pi_g\in\{0.1,0.3,0.5\}$, otherwise draw from the NB.
  6. Cell numbers $\{500, 2000, 10000\}$, with 100 replicate datasets per setting (proposed).
  7. Mean-dependent alternative: $\pi_{gc}=\mathrm{expit}(\alpha+\beta\log\mu_{gc})$, with $(\alpha,\beta)$ giving mean $\pi$ of 0.1 and 0.3 (proposed). Splatter exposes a `dropout.type` option for the same concept, with default none [R15].

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted NB and ZINB generator (recipe above, proposed) | generated; no external source | simulated; no biology | — | Exact truth for every gene |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| False-positive rate under NB truth | fraction of genes with ZINB selected when $\pi=0$, using the boundary-corrected LRT at 0.05; BIC as a secondary rule | close to 0.05 | primary | — |
| Power under ZINB truth | fraction of genes with true $\pi\ge 0.3$ selected as ZINB at mean at least 1 and $n\ge 1000$ | higher | primary | — |
| Bias of $\hat\pi$ and $\log_{10}\hat\theta$ | median bias per mean stratum | lower in absolute value | guardrail | — |

- **Comparators**: NB; Poisson; ZINB by EM; DCA with `ae_type` zinb versus nb-conddisp [R12] (optional, GPU).
- **Protocol**: the recipe above with seed 42; mean strata as in the shared protocol; report per cell number; LRT with the 50:50 chi-square mixture at the boundary.
- **Acceptance criterion** (proposed, not from the literature): under NB truth, false-positive rate at most 0.05 plus a tolerance of 0.02 for means of at least 0.1; power of at least 0.8 for $\pi\ge 0.3$ at mean at least 1 and $n\ge 1000$.
- **Known pitfalls**: the planted ZINB is the fitted model, so power is optimistic and the misspecified alternative is needed for robustness; $\pi$ and $\theta$ are confounded at low mean, so power is low there whatever the method.

### P1. Performance and scaling

Measure wall time and peak memory for family selection per dataset at $10^4$, $10^5$, $10^6$ and $2\times10^6$ cells, with the gene set fixed after the detection filter, `max_iter` 100, default simulation settings on a control, sparse input, one CPU node and one GPU. Report the share of time in fitting versus calibration. Comparators are the analytic depth-only model in Python (repository code), sctransform in R, and DCA in Python on GPU where available.

Anchors from repository comments and README (hardware not stated; not normalised to hardware): notebook 03 records 25, 35 and 80 minutes, and 2 hours 45 minutes, 1 hour 45 minutes and 14 hours, per control dataset; the README recommends at least 250 GB RAM; the 2-million-cell organogenesis `gene_count.txt` is 18 GB. Acceptance (proposed): at $10^6$ cells without controls, GPU selection takes less wall time than the sctransform fit at $10^5$ cells on CPU.

## 9. Chaining

The task belongs to the normalisation workflow that precedes variance modelling and dispersion estimation; its upstream and downstream tasks are listed below.

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
- **Feeds**:
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
  - `normalization.dispersion_estimation`: Per-gene overdispersion estimation with shrinkage
  - `normalization.normalization_pipeline_selection`: Data-driven normalization pipeline selection
  - `dim-reduction.count_model_latent_factors`: Count-likelihood latent factors versus log-transformed PCA
- **Reads**: `layers/counts`, `obs/total_counts`, `obs/protocol`, `uns/negative_control/counts`
- **Writes**: `varm/count_family`, `varm/theta`, `varm/zi_pi`, `varm/R0`, `uns/count_family_selection`, `uns/count_family_diagnostics`, `models/count_family_<name>`
<!-- CHAINING:AUTO:END -->

## 10. Risks, pitfalls and open questions

- **Control provenance.** The licences of the three control datasets and the species of the 10x control are not given in the repository, and the figshare and GEO records were not opened, so the license entries are left as dashes.
- **Source reading gaps.** The Sarkar and Stephens paper was not read, and its companion code was read only as a readme. ZINB-WaVE, zingeR, MAST and Sanity were not read beyond package metadata, so none appears in the methods table or the MCP enum. The Poisson and ZINB likelihoods are specified from section 3 alone, and the Splatter dropout function was not traced beyond its option defaults.
- **Literature gaps.** The Lause et al. paper text was not read; its claims come from the repository. The 59-dataset comparison of Choudhary and Satija is cited only for its published pattern, because its dataset list and accessions were not obtained. Cao et al. and Choudhary and Satija are cited from their abstract pages only.
- **Unsettled questions.** Zero inflation in plate-based counts is untested in the cited material. No operational test separates measurement zeros from expression zeros. $\pi$ and $\theta$ are weakly identified at low mean. A donor-permuted false-discovery benchmark for differential expression is not specified, because no multi-donor dataset with a licence and accession was identified.
- **Data risks.** Whether the catalogue holds negative controls, and how its protocol annotation separates UMI from read counts, is not yet established; B2 depends on both. Control counts must share gene identifiers and filtering with the data.
- **First experiment.** Reproduce $R_{0,g}$ and $\theta$ recovery on the 10x and inDrop controls with the repository code, and check the closed-form $\mu$ against the repository fit, before any catalogue-wide analysis.

## 11. References

R1. Risso D, et al. A general and flexible method for signal extraction from single-cell RNA-seq data. *Nature Communications* 2018. doi:10.1038/s41467-017-02554-5 — partial (corpus)
R2. Sarkar A, Stephens M. Separating measurement and expression models clarifies confusion in single-cell RNA sequencing analysis. *Nature Genetics* 2021. doi:10.1038/s41588-021-00873-4 — partial (corpus)
R3. Svensson V. Droplet scRNA-seq is not zero-inflated. *bioRxiv* 2019. doi:10.1101/582064 — partial (repo)
R4. Cao Y, Kitanovski S, Küppers R, Hoffmann D. UMI or not UMI, that is the question for scRNA-seq zero-inflation. *Nature Biotechnology* 2021;39:158–159. doi:10.1038/s41587-020-00810-6 — partial (search)
R5. Choudhary S, Satija R. Comparison and evaluation of statistical error models for scRNA-seq. *Genome Biology* 2022;23:27. doi:10.1186/s13059-021-02584-9 — partial (search)
R6. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021;22:258. doi:10.1186/s13059-021-02451-7 — partial (corpus)
R7. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019;20. doi:10.1186/s13059-019-1874-1 — partial (corpus)
R8. Theis Lab single-cell best practices contributors. Normalization. *Single-cell best practices* (jupyter-book), theislab/single-cell-best-practices. — partial (repo)
R9. Grün D, Kester L, van Oudenaarden A. Validation of noise models for single-cell transcriptomics. *Nature Methods* 2014. doi:10.1038/nmeth.2930 — partial (corpus)
R10. Hicks SC, Townes FW, Teng M, Irizarry RA. Missing data and technical variability in single-cell RNA-sequencing experiments. *Biostatistics* 2017. doi:10.1093/biostatistics/kxx053 — partial (corpus)
R11. Townes FW, Hicks SC, Aryee MJ, Irizarry RA. Feature selection and dimension reduction for single-cell RNA-Seq based on a multinomial model. *Genome Biology* 2019. doi:10.1186/s13059-019-1861-6 — partial (corpus)
R12. Eraslan G, Simon LM, Mircea M, Mueller NS, Theis FJ. Single-cell RNA-seq denoising using a deep count autoencoder. *Nature Communications* 2019. doi:10.1038/s41467-018-07931-2 — partial (corpus)
R13. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — partial (corpus)
R14. Batson J, Royer L, Webber J. Molecular cross-validation for single-cell RNA-seq. *bioRxiv* 2019. doi:10.1101/786269 — partial (corpus)
R15. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/berenslab/umi-normalization (HEAD 696086c) | Jan Lause, Philipp Berens, Dmitry Kobak (README) | GNU Affero GPL-3.0 (LICENSE) | analytic depth model, dispersion calibration, residuals | reimplement |
| https://github.com/ChristophH/sctransform (HEAD 49e35b5) | Christoph Hafemeister, Saket Choudhary, Rahul Satija (DESCRIPTION) | GPL-3 (DESCRIPTION, LICENSE) | NB variance comparator | callout |
| https://github.com/kstreet13/scry (HEAD 1375237) | Kelly Street (DESCRIPTION) | Artistic-2.0 (DESCRIPTION; no LICENSE file at root) | binomial deviance | reimplement |
| https://github.com/theislab/dca (HEAD 6abd124) | Gokcen Eraslan (setup.py) | Apache-2.0 (LICENSE.txt) | NB and ZINB heads, comparator | callout |
| https://github.com/scverse/scanpy (HEAD 8ed52d9) | scverse; F. Alexander Wolf, P. Angerer, Theis Lab (LICENSE) | BSD-3-Clause (LICENSE) | shifted-logarithm comparator | callout |
| https://github.com/Oshlack/splatter (HEAD eeb1dfc) | Luke Zappia, Belinda Phipson, Christina Azodi, Alicia Oshlack (DESCRIPTION) | GPL-3 with file LICENSE (DESCRIPTION) | dropout-option defaults | callout |
| https://github.com/theislab/single-cell-best-practices (HEAD d581689) | Theis Lab (LICENSE copyright line) | Apache-2.0 (LICENSE) | source text of the shifted-logarithm baseline | callout |
