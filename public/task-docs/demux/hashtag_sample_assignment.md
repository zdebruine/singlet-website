---
id: demux.hashtag_sample_assignment
title: Hashtag-oligo and lipid-tag sample assignment with multiplet and negative calling
area: demux
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.feature_barcode_counting, cell-calling.cell_vs_empty_droplet_calling]
feeds: [markers-de.replicate_aware_condition_de, demux.sample_swap_detection, doublets.ensemble_doublet_calling]
reads: [layers/counts, obs/total_counts, obs/n_genes_by_counts, uns/tag_features]
writes: [obs/hashtag_sample, obs/hashtag_class, obs/hashtag_prob, obsm/hashtag_posterior, uns/hashtag_params, models/hashtag_mixture]
devices: [cpu, cuda]
mcp_tool: singlet_demux_hashtag_sample_assignment
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Hashtag-oligo and lipid-tag sample assignment with multiplet and negative calling

> Assigns each droplet of a multiplexed pool to one sample, to a cross-sample multiplet, or to no sample (negative), from hashtag, CellPlex or lipid-tag counts, with a probability for each call.

## 1. Question

Given the UMI counts of one droplet across K sample tags (antibody hashtag oligos, CellPlex or MULTI-seq lipid tags), which pooled sample produced its cell, does it carry two samples' tags (a cross-sample multiplet), or does it carry only ambient tag signal (negative)? Inputs are the droplet-by-tag matrix and, optionally, RNA library size and detected genes for the same droplets. Outputs are a class, a sample label and a probability per droplet. A correct answer matches donor labels from genotype demultiplexing of the same pool, or a known pooling design (section 8).

## 2. Why this task matters and where the field stands

Pooling samples before library preparation lowers the cost per sample, but every droplet then needs a sample label, and droplets that hold two samples must be found. Sample tags do this. Each sample's cells receive a unique antibody or lipid barcode before pooling, and the tag counts of a droplet give its sample [R4][R5]. Tags detect only cross-sample multiplets; a same-sample doublet carries one tag and is invisible to them.

Status: **contested**. Howitt et al. compared seven tools against sample labels from RNA variants of the same pool. Tools were similar when tag quality was high, and methods that assume two count peaks degrade on low-quality data [R1]. Mylka et al. report that lipid tags did better on nuclei and mouse brain, and antibody tags on spleen and lung [R2]. Sayed et al. report robust performance of a clustering-based method [R3]. Demuxafy integrates several demultiplexing and doublet tools to improve droplet assignment [R11], and GMM-Demux addresses sample demultiplexing and multiplet detection with Gaussian mixtures [R10].

Open problems: (1) no published rule separates ambient-only droplets from cells with weak tag signal, and this drives most disagreement between callers [R1]; (2) the benchmarks use different truths and metrics, so their results cannot be pooled [R1][R2][R3][R11]; (3) genotype truth from RNA shares reads with the expression data it is compared against [R1][R9]; (4) the benchmarks cited here do not test whether call probabilities are calibrated [R1][R2][R6].

## 3. Theory and insight

Notation. Droplet $d$ has UMI counts $x_{dk}$ for tags $k=1,\dots,K$ and RNA covariates $\mathbf u_d$ (library size and detected genes). Each sample carries one tag. The latent state $T_d$ is the set of tags present: $T_d=\varnothing$ (negative), $T_d=\{k\}$ (singlet of the sample of tag $k$), or $T_d=\{k,l\}$ with $k$ and $l$ from different samples (cross-sample multiplet). A same-sample multiplet has $T_d=\{k\}$ and cannot be separated from a singlet.

Per-tag mixture. Model-based callers fit, for each tag, a two-component count model in which $h_{dk}\in\{0,1\}$ indicates presence of tag $k$:
$$x_{dk}\mid h_{dk}=h\ \sim\ \mathrm{NB}\!\left(\mu^{(h)}_{dk},\,\theta^{(h)}_k\right),\qquad \log\mu^{(h)}_{dk}=\mathbf u_d^{\top}\boldsymbol\beta^{(h)}_k.$$
The posterior that tag $k$ is present is $\gamma_{dk}=\pi_k f_1(x_{dk})/[\pi_k f_1(x_{dk})+(1-\pi_k)f_0(x_{dk})]$, with prior presence $\pi_k$ and component densities $f_h$. deMULTIplex2 fits these components by EM and calls a tag present when $\gamma_{dk}$ exceeds 0.5 [R6]. Regime: the counts are overdispersed; large $\theta$ gives a Poisson limit, and large $\mu$ an approximately Gaussian shape on the log scale. Combining per-tag posteriors into a state assumes that tags are conditionally independent given the state, which cross-talk and ambient carry-over violate.

Threshold family. HTODemux fits one NB to the lowest-mean CLARA cluster of each tag, sets the threshold at its 0.99 quantile, and counts positive tags per droplet [R12]:
$$c_k=Q_{0.99}\big(\mathrm{NB}(\hat\mu_k,\hat\theta_k)\big),\qquad n_d=\sum_k\mathbb 1[x_{dk}>c_k],$$
with Negative for $n_d=0$, Singlet for $n_d=1$ and Doublet for $n_d\ge2$. Validity requires one negative cluster large enough to fit an NB. The MULTI-seq classifier replaces the NB with a per-barcode kernel density and local maxima, and a quantile $q$ (default 0.7) sets the cut [R5][R12]; its final cut rule is an open item (section 10).

Ambient-aware log ratios. hashedDrops subtracts a per-droplet scaled ambient profile $s_d a_k$ from the counts, giving $\tilde x_{dk}=\max(0,\,x_{dk}-s_d a_k)$, and adds a pseudo-count $c_d=\max(\bar a_d,\texttt{pseudo.count})$, where $\bar a_d$ is the average scaled ambient count of droplet $d$ [R14]. With $(1)$ and $(2)$ indexing the largest and second-largest tag,
$$\mathrm{LogFC}_1=\log_2\frac{\tilde x_{(1)}+c_d}{\tilde x_{(2)}+c_d},\qquad \mathrm{LogFC}_2=\log_2\frac{\tilde x_{(2)}+c_d}{c_d}.$$
A droplet is a doublet when $\mathrm{LogFC}_2$ exceeds $\max\{\mathrm{med}_2+\texttt{doublet.nmads}\cdot\mathrm{MAD}_2,\ \texttt{doublet.min}\}$, with the median and MAD taken over droplets (hashedDrops.R:258-261). Regime: the ambient estimate assumes that most tags are not driven by cells. With two tags there is no ambient baseline for $\mathrm{LogFC}_2$, so doublet calls are undefined unless the ambient baseline is constant.

HashSolo. Each droplet's counts are log transformed, $y_{dk}=\log(x_{dk}+1)$ [R13], and its two highest barcodes $y_{(1)}$ and $y_{(2)}$ are scored under negative, singlet and doublet hypotheses, with noise and signal Gaussian densities $p_{\mathrm{noise}}$ and $p_{\mathrm{sig}}$ updated from the data:
$$\Pr(h\mid y_d)\propto\pi_h L_h,\quad L_{\mathrm{neg}}=p_{\mathrm{noise}}(y_{(2)})\,p_{\mathrm{noise}}(y_{(1)}),\quad L_{\mathrm{sing}}=p_{\mathrm{noise}}(y_{(2)})\,p_{\mathrm{sig}}(y_{(1)}),\quad L_{\mathrm{dbl}}=p_{\mathrm{sig}}(y_{(2)})\,p_{\mathrm{sig}}(y_{(1)}).$$
The method is attributed to Solo [R8], and the scanpy implementation is a log-normal approximation with fixed priors $\pi=(0.01,\,0.8,\,0.19)$ [R13].

demuxmix. For each HTO, the counts follow a mixture of a negative and a positive NB component, each with a log mean linear in log RNA library size, $\log\mu_{dkc}=a_{kc}+b_{kc}\log\mathrm{rna}_d$, fitted by weighted NB regression [R7][R17]. The RNA covariate must be strictly positive (R/demuxmix.R:179). A naive variant drops the covariate (R/demuxmix.R:45).

Insight. All callers test the contrast between the top tag and the second after background removal. They differ in the background model (per-tag NB, ambient profile, log-normal noise) and in the threshold rule (quantile, fixed prior, MAD). When tag quality is high the tools agree [R1], so the model matters most for weak libraries. Heuristic thresholds work when tags are bimodal, because the quantile fixes the negative tail. A model adds call probabilities, uncertainty per call, RNA-depth covariates, and a background that can be reused across pools.

Proposed model. singlet_mixture uses the state $T$ with $|T|\le2$ and cross-sample pairs only, and an ambient profile $a$ (summing to one) with a per-droplet scale $\lambda_d$:
$$P(x_d\mid T)=\prod_k\mathrm{NB}\!\big(x_{dk}\mid\mu_{dk}(T),\theta_k\big),\qquad \mu_{dk}(T)=\lambda_d a_k+\mathbb 1[k\in T]\,e^{\mathbf u_d^{\top}\beta_k},$$
with $\Pr(T\mid x_d)\propto\pi_T P(x_d\mid T)$ fitted by EM. Regime: the NB approximation and conditional independence given $T$ hold only approximately, so calibration is tested (B4) rather than assumed.

Estimands. Each output and each ground truth, in one sentence:
- Sample label: the sample whose tag is the only tag present in $T_d$, on raw counts (clr applies only to HTODemux clustering).
- Class: negative when $T_d=\varnothing$, singlet when $|T_d|=1$, and cross-sample multiplet when $|T_d|=2$.
- Probability: the posterior of the reported state under the fitted model; $1-$probability is a per-call error probability only where calibration holds (B4).
- B1 truth: the donor of each droplet from RNA-variant demultiplexing, as a per-droplet label.
- B3 truth: the planted tag set $T_d$ of each droplet; per-tag F-score and AUC are computed over droplets for each tag, without normalisation.
- B4 truth: the sample label the generator assigns to each droplet.

Failure modes. Bimodality assumptions (HashSolo, naive demuxmix) misplace the boundary when tags are unimodal or weakly separated. A saturated dominant tag makes singlets look like doublets under LogFC2. Two-tag designs leave hashedDrops doublets undefined. HTODemux stops when a cluster has zero counts for a tag (R/preprocessing.R:260-261). Low-RNA and empty droplets distort the RNA covariates used by demuxmix. Two pitfalls follow from benchmark design: excluding negatives inflates accuracy, and thresholds tuned on the evaluation pool leak into the result (B1).

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| HTODemux (Seurat) | hybrid | Per-tag NB fitted to the lowest-mean CLARA cluster; 0.99-quantile threshold; call by positive-tag count | [R12] |
| MULTIseqDemux (Seurat) | heuristic | Per-barcode kernel density with local maxima; quantile q sets the cut | [R5][R12] |
| deMULTIplex2 | model-based | Per-tag NB background and foreground fitted by EM; presence when the posterior exceeds 0.5 | [R6][R16] |
| demuxmix | model-based | Per-HTO NB regression mixture on log RNA library size; posteriors and error-rate estimates | [R7][R17] |
| HashSolo (scanpy) | model-based | Log-normal likelihoods over the top two barcodes; fixed priors; Bayes rule | [R8][R13] |
| hashedDrops (DropletUtils) | hybrid | Ambient-subtracted log ratios; MAD-based doublet threshold | [R14] |

The heuristic and hybrid callers, HTODemux, the MULTI-seq quantile rule and hashedDrops, are the methods shipped in the two main toolkits, Seurat and DropletUtils [R12][R14], and they stay in every benchmark. The model-based callers deMULTIplex2, demuxmix and HashSolo are the comparators for calibration and the source of the components of singlet_mixture. The Cell Ranger tag caller is a callout only [R15]. GMM-Demux is cited in section 2 but is not tabulated, since its algorithm is not described here.

Defaults below are taken from the cited source lines. Seurat, scanpy and DropletUtils are read from local copies (section 10).

| Method | Parameter | Value | Source |
|---|---|---|---|
| HTODemux | positive.quantile | 0.99 | satijalab/seurat R/preprocessing.R:206 |
| HTODemux | nstarts (k-means only) | 100 | R/preprocessing.R:208 |
| HTODemux | kfunc | clara | R/preprocessing.R:209 |
| HTODemux | nsamples | 100 | R/preprocessing.R:210, 243 |
| HTODemux | seed | 42 | R/preprocessing.R:211 |
| HTODemux | initial clusters k | number of tags plus 1 | R/preprocessing.R:226 |
| MULTIseqDemux | quantile q | 0.7 | R/preprocessing.R:976 |
| MULTIseqDemux | autoThresh | FALSE | R/preprocessing.R:977 |
| MULTIseqDemux | maxiter | 5 | R/preprocessing.R:978 |
| MULTIseqDemux | qrange | seq(0.1, 0.9, by 0.05) | R/preprocessing.R:979 |
| MULTIseqDemux | per-barcode density bounds | 0.001 and 0.999 quantiles | R/preprocessing.R:6089-6090 (ClassifyCells at 6071) |
| deMULTIplex2 | init.cos.cut (wrapper / fit.em) | 0.5 / 0.9 | Gartner-Lab/deMULTIplex2 R/classify.R:56; R/em.R:9 (de48333) |
| deMULTIplex2 | max.iter (wrapper / fit.em) | 10 / 100 | R/classify.R:57; R/em.R:9 |
| deMULTIplex2 | converge.threshold | 1e-3 | R/classify.R:58 |
| deMULTIplex2 | prob.cut | 0.5 | R/classify.R:59 |
| deMULTIplex2 | min.cell.fit / max.cell.fit | 10 / 1e4 | R/classify.R:60-61 |
| deMULTIplex2 | min.quantile.fit / max.quantile.fit | 0.05 / 0.95 | R/classify.R:62-63 |
| deMULTIplex2 | seed | 1 | R/classify.R:70 |
| simulateTags | n.cell, n.bc, seed, nb.theta | 1000, 10, 1, 10 | R/simulation.R:5-12 |
| simulateTags | cell.staining.meanlog, cell.staining.sdlog, ambient.meanlog, b0 | 6, 1, 4, -3 | R/simulation.R:5-12 |
| demuxmix | k.hto, k.rna | 1.5, 1.5 | huklein/demuxmix R/demuxmix.R:3 (4021e00) |
| demuxmix | alpha, beta | 0.9, 0.9 | R/demuxmix.R:315-316, 378 |
| demuxmix | pAcpt, model | 0.9^(number of HTOs), auto | R/demuxmix.R:377 |
| HashSolo | priors (negative, singlet, doublet) | 0.01, 0.8, 0.19 | scverse/scanpy src/scanpy/preprocessing/_hashsolo.py:239 |
| HashSolo | n_barcodes_noise | n_barcodes minus 2 when None | _hashsolo.py:188-189 |
| HashSolo | variance floor | 1e-8 | _hashsolo.py:56 |
| HashSolo | transform | log(x + 1) | _hashsolo.py:109 |
| hashedDrops | min.prop, pseudo.count | 0.05, 5 | MarioniLab/DropletUtils R/hashedDrops.R:216 (version 1.33.2) |
| hashedDrops | constant.ambient | FALSE | R/hashedDrops.R:216 |
| hashedDrops | doublet.nmads, doublet.min | 3, 2 | R/hashedDrops.R:217 |
| hashedDrops | doublet.mixture | FALSE | R/hashedDrops.R:217 |
| hashedDrops | confident.nmads, confident.min | 3, 2 | R/hashedDrops.R:217 |
| hashedDrops | LogFC base | 2 | R/hashedDrops.R:240-249 |
| hashedDrops | doublet threshold | max of med2 + nmads x MAD2 and doublet.min | R/hashedDrops.R:260-261 |

## 5. Proposed singlet approach

Routes for each method are given in section 12.

Comparators use the defaults of section 4. Two settings are fixed by the tool rather than exposed: deMULTIplex2 is called with init.cos.cut 0.5 and max.iter 10 set explicitly, because fit.em uses other defaults.

singlet_mixture is the state model of section 3, fitted by EM with an estimated ambient profile, a per-droplet ambient scale, RNA covariates and a probability per call. Its components come from read sources: the per-tag NB structure from deMULTIplex2, the ambient decomposition from hashedDrops and the RNA covariate from demuxmix. Four changes are proposed, each kept only if it meets the named test:

1. Calibrated probabilities. A monotone map is fitted on the fit half of simulated pools. It is kept only if B4 meets its acceptance criterion and B1 singlet concordance at matched coverage does not fall.
2. The ambient term. It is removed if it lowers singlet F-score on the B3 default grid.
3. RNA covariates. They are removed if they do not improve B3 singlet F-score.
4. Cross-sample pair states. They are kept only if B3 doublet recall exceeds that of the better threshold comparator, hashedDrops or HTODemux.

ML stack. The EM core is C++ on CPU, with per-tag iteratively reweighted least squares for the NB fits and an E-step over droplets and states. There are at most $1+K+K(K-1)/2$ states, which is 79 at $K=12$. The E-step has a fixed shape and is a reduction, so it is hard-coded in CUDA, with cuSPARSE for the sparse tag matrix. PyTorch is not needed for version one; an amortised classifier trained on simulated pools is a later option.

Streaming. The E-step is computed in blocks of droplets, the M-step sums are exact within an iteration, and per-tag fits use at most 1e4 droplets, the deMULTIplex2 cap (R/classify.R:61).

Defaults an agent should use without asking: method singlet_mixture, normalisation raw, posterior_cut 0.5, seed 42 and device auto. Comparators take the defaults in section 4 and execute on CPU. The CUDA path applies to singlet_mixture only.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | UMI counts, droplets by tags |
| read | obs/total_counts | float | RNA library size; demuxmix and singlet covariate |
| read | obs/n_genes_by_counts | int | Detected genes; optional covariate |
| read | uns/tag_features | string list | Tag names and chemistry |
| write | obs/hashtag_sample | categorical | Sample identifier, or Negative |
| write | obs/hashtag_class | categorical | singlet, multiplet or negative |
| write | obs/hashtag_prob | float32 | Probability of the call; one minus it is the per-call error probability where calibrated |
| write | obsm/hashtag_posterior | float32 | Droplets by samples posterior; absent for callers without posteriors |
| write | uns/hashtag_params | dict | Thresholds, priors, ambient profile and convergence |
| write | models/hashtag_mixture | dict | Fitted per-tag mixture parameters |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "singlet_mixture" | `singlet_mixture`, `htodemux`, `multiseq_quantile`, `hashedDrops`, `hashsolo`, `demuxmix`, `demultiplex2` | Caller. singlet_mixture is the proposed model; the other values are published comparators. |
| `tags` | array | — | — | Tag feature names; default is every feature listed in uns/tag_features. At least two are needed. |
| `normalisation` | string | "raw" | `raw`, `clr` | Input transform. clr applies only to HTODemux clustering. |
| `posterior_cut` | number | 0.5 | min 0; max 1 | Posterior threshold for calling a tag present; used by singlet_mixture and demultiplex2. |
| `singlet_mixture` | object | — | — | Options for method singlet_mixture. |
| `singlet_mixture.em_max_iter` | integer | 100 | min 1 | Maximum EM iterations. |
| `singlet_mixture.ambient_term` | boolean | true | — | Include the per-droplet ambient profile in the tag means. |
| `singlet_mixture.rna_covariates` | boolean | true | — | Regress tag means on log RNA library size. |
| `singlet_mixture.calibration_fraction` | number | 0.5 | max 1; > 0 | Droplet fraction used to fit the probability calibration map. |
| `htodemux` | object | — | — | Options for method htodemux. |
| `htodemux.positive_quantile` | number | 0.99 | min 0; max 1 | Quantile of the fitted negative distribution that sets each tag threshold. |
| `htodemux.init_k` | integer/null | null | min 1 | CLARA cluster count; null uses the number of tags plus one. |
| `htodemux.nsamples` | integer | 100 | min 1 | Sample count passed to CLARA. |
| `hashedDrops` | object | — | — | Options for method hashedDrops. |
| `hashedDrops.min_prop` | number | 0.05 | min 0; max 1 | Minimum proportion used when inferring the ambient profile. |
| `hashedDrops.pseudo_count` | number | 5 | min 0 | Floor on the per-droplet pseudo-count used in log ratios. |
| `hashedDrops.doublet_nmads` | number | 3 | min 0 | MAD multiplier for the doublet threshold on the second log ratio. |
| `hashedDrops.doublet_min` | number | 2 | min 0 | Lower bound on the doublet threshold, in log2 units. |
| `hashedDrops.constant_ambient` | boolean | false | — | Use one ambient baseline; required for doublet calls with two tags. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA for singlet_mixture when memory suffices. |
| `seed` | integer | 42 | — | Random seed for EM initialisation and calibration splits. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing members. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Method options apply only to their own method: singlet_mixture to its object, htodemux and hashedDrops to theirs. Other comparators take the section 4 defaults. posterior_cut applies to singlet_mixture and demultiplex2 only. normalisation clr applies to HTODemux clustering only. singlet_mixture needs two or more tags, and hashedDrops reports doublets with two tags only when constant_ambient is true. Outputs a caller cannot produce are written as missing values, never as zeros.

## 7. MCP tool

Tool name `singlet_demux_hashtag_sample_assignment` (definition in `tasks/mcp/singlet_demux_hashtag_sample_assignment.json`). Example call and example result:

```json
{
  "dataset": "pool1.singlet",
  "method": "singlet_mixture",
  "tags": ["HTO-1", "HTO-2", "HTO-3"]
}
```

```json
{
  "dataset": "pool1.singlet",
  "status": "completed",
  "wrote": ["obs/hashtag_sample", "obs/hashtag_class", "obs/hashtag_prob", "obsm/hashtag_posterior", "uns/hashtag_params", "models/hashtag_mixture"],
  "summary": {"class_counts": "<int per class>", "negative_fraction": "<float>"},
  "provenance_id": "<id>"
}
```

Long-running: large pools may return status queued with a job_id. Stochastic: seed fixes the EM initialisation, so repeated calls with one seed agree. Dry-run mode returns seconds, peak memory and device without writing members.

## 8. Benchmarks

Shared protocol. Every caller receives the same droplets after one cell pre-filter, from upstream cell calls or from the tag matrix alone. Each caller uses the defaults of section 4 and its source seed. Thresholds tuned on a split are set on one half of each pool and scored on the other half. Genotype labels come from RNA variants and are never caller inputs. Accuracy is always reported with the negative fraction and the retained singlet fraction, because excluding negatives inflates accuracy. Comparators use the method values of section 7.

### B1. Genotype concordance on real pooled hashtag data

- **Goal**: assign droplets of a multiplexed pool to donors from tags alone, scored against donors from RNA variants.
- **Ground truth**: a per-droplet donor label from RNA-variant demultiplexing of the same droplets, the genotype-based pooling design [R9] also used by the donor task demux.donor_assignment_reference_genotypes. It is a consistency proxy, because the labels and the expression data share RNA reads. Each droplet is a genotype singlet, a genotype doublet or unassigned.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Real pooled hashtag datasets analysed by Howitt et al. | [R1] | Antibody hashtags; accessions and sizes not stated | — | Each pool has donor labels from RNA variants |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Singlet concordance | Among droplets called singlet with one genotype donor, the fraction whose sample equals that donor | maximize | primary | [R1] |
| Retained singlet fraction | Droplets called singlet divided by all droplets after the pre-filter | maximize | primary | [R1] |
| Doublet recall | Genotype cross-donor doublets called multiplet, divided by genotype cross-donor doublets | maximize | guardrail | [R1] |
| Negative rate on genotype singlets | Genotype singlets called negative, divided by genotype singlets | minimize | guardrail | [R1] |

- **Comparators**: htodemux, multiseq_quantile, hashedDrops, demuxmix, hashsolo and demultiplex2.
- **Protocol**: stratify pools by tag quality, using tertiles of the median log ratio of the top to second tag per pool; report each dataset separately and the lowest tertile in full.
- **Acceptance criterion** (proposed): on every dataset, singlet concordance is at least the best comparator minus 0.005; on the lowest tertile it is at least the best comparator plus 0.01 on at least half the datasets; at equal concordance the retained singlet fraction is not lower by more than 0.02.
- **Known pitfalls**: tuning thresholds on the scored half inflates concordance; RNA-derived features inside a caller make the truth non-independent.

### B2. Antibody versus lipid tags against genotype calls

- **Goal**: compare antibody and lipid tag chemistries, and their callers, on cells, nuclei and mouse tissues against genotype-based donors.
- **Ground truth**: a per-droplet donor label from genotype-based demultiplexing of the same droplets [R2]; the estimand is the donor of each droplet, with the consistency caveat of B1.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Four cell lines with TotalSeq-A and -C antibodies, custom lipids and MULTI-seq lipid tags | [R2] | Cells and nuclei; species and sizes not stated | — | Design from the source |
| Mouse brain, spleen and lung | [R2] | Mouse tissues; sizes not stated | — | Tissue strata |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Accuracy against genotype calls | Droplets whose sample call equals the genotype donor, divided by all droplets in the stratum; multiplets and negatives count as errors | maximize | primary | [R2] |
| Recovery | Droplets called singlet, divided by all droplets in the stratum | maximize | guardrail | [R2] |

- **Comparators**: multiseq_quantile, htodemux, hashedDrops and demuxmix.
- **Protocol**: stratify by modality and tissue; keep one tag chemistry within each comparison; report the lipid-minus-antibody gap per stratum. The accuracy definition is this document's operationalisation, and droplet counts are reported beside each value.
- **Acceptance criterion** (proposed): singlet_mixture is within 0.01 of the best comparator in every stratum, and the lipid-minus-antibody gap is reported for each stratum.
- **Known pitfalls**: chemistry and tissue are confounded in the design, so the gap cannot be attributed to chemistry alone; strata with few droplets give unstable accuracy.

### B3. Planted simulation with the deMULTIplex2 generator

- **Goal**: measure per-tag and doublet classification on simulated tag matrices whose true states are known.
- **Ground truth**: the planted state of each droplet, namely its true singlet tag, a cross-sample pair, or none, returned by the simulator [R6][R16].
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated tag matrices, default grid of section 4 | simulator in [R16] | Simulated tag counts; size as set in section 4 | — | Generated, not a file |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-tag precision, recall and F-score | For tag t: tp is the droplets called t with t planted; fp is the calls of t minus tp; fn is the planted t droplets without a call of t; F = tp / (tp + (fp + fn)/2); the singlet average is the mean over tags | maximize | primary | [R6] |
| Doublet recall | Planted cross-sample doublets called multiplet, divided by planted doublets | maximize | primary | [R6] |
| Doublets called to one tag or none | Planted doublets called to a single tag or to no tag, divided by planted doublets | minimize | guardrail | [R6] |
| Per-tag ROC AUC | TPR and FPR at posterior cut-offs 0 to 1 in steps of 0.01, integrated by compute_auc (R/benchmarking.R:299) | maximize | guardrail | [R6] |

- **Comparators**: benchmark_demultiplex1 (the classifier wrapped in the deMULTIplex2 benchmarks), benchmark_HTODemux, benchmark_demuxmix_full, benchmark_demuxmix_naive and benchmark_demultiplex2, at R/benchmarking.R:117, 180, 212, 238 and 56.
- **Protocol**: score the default grid first, then vary the seed and the cell count for perturbed grids; the RNA side is held fixed.
- **Acceptance criterion** (proposed): AUC of singlet_mixture is at least the best comparator minus 0.01 on the default grid and on at least two of three perturbed grids; mean singlet F-score is not below the best comparator's on the default grid.
- **Known pitfalls**: the simulator and deMULTIplex2 share the NB family, which flatters NB-based callers; staining and ambient parameters must be matched to real pools before the grid informs a choice.

### B4. Calibration on proposed synthetic pools

- **Goal**: test whether the call probabilities of singlet_mixture and the model-based comparators are calibrated, and whether the demuxmix error-rate estimate matches the simulated rate under tag-quality perturbations.
- **Ground truth**: the sample label the generator assigns to each droplet, planted by design.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Proposed synthetic pools | generator recipe below | Simulated tag counts with RNA covariates; size set by the protocol | — | No accession; simulated |

Generator recipe:
1. For each pool, choose the proportions of negatives, singlets and cross-sample pairs; record them.
2. Per tag, draw background and foreground NB counts; draw per-droplet staining from a log-normal whose spread is set per perturbation level.
3. Add ambient counts from a drawn ambient profile, scaled per droplet.
4. Move a recorded fraction of foreground counts to other tags (cross-talk), at a rate set per level.
5. Add cross-sample pairs at the step 1 proportion; same-sample multiplets are not generated.
6. Draw RNA library sizes and detected genes from fits to the B1 pools; record the fits.
7. Generate at least 20 pools per level, with recorded seeds.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Expected calibration error | Ten equal-width bins of the reported-state probability; ECE is the sum over bins of (n_b / N) times the absolute difference between bin accuracy and mean probability | minimize | primary | — |
| Error-rate estimate error | Absolute difference between the estimated and simulated rate of wrong-sample singlet calls; the estimate is one minus the mean probability for singlet_mixture, and demuxmix's own estimate for demuxmix | minimize | primary | [R7] |
| Negative and doublet recall | As in B3 | maximize | guardrail | [R6] |

- **Comparators**: demuxmix (own error estimate), demultiplex2 and hashsolo (their posteriors). hashedDrops and htodemux have no posterior, so only the guardrail applies to them.
- **Protocol**: for each pool, fit on half of the droplets and evaluate on the other half; the fit half also sets the recalibration map; seeds are fixed.
- **Acceptance criterion** (proposed): ECE at most 0.05 on held-out simulated pools, and the error-rate estimate within 0.02 of the simulated rate.
- **Known pitfalls**: calibration is tested only against the error modes the generator contains, so other errors are not certified; the fit half is never scored.

### P1. Performance and scaling

Wall time, peak memory and throughput at 1e4, 1e5 and 1e6 droplets and K = 2, 4, 8 and 12 tags, on CPU and CUDA, with time per stage (ambient estimation, fits, posterior). For singlet_mixture only, add 1e7 droplets to test the streaming claim. Inputs come from the B3 generator, with three seeds, reporting the median and interquartile range. Comparators: htodemux, multiseq_quantile, hashedDrops, hashsolo, demuxmix (naive and regression) and demultiplex2. Hold fixed: thread count (reported), normalisation, pre-filter, seed and software environment. HashSolo's pair loop over barcodes and demuxmix's per-tag GLM fits are expected to be slowest at large K.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.feature_barcode_counting`: Feature-barcode (ADT, hashtag, lipid-tag and guide) counting from FASTQ
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
- **Feeds**:
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
  - `demux.sample_swap_detection`: Sample identity verification and swap detection
  - `doublets.ensemble_doublet_calling`: Ensemble and consensus doublet calling
- **Reads**: `layers/counts`, `obs/total_counts`, `obs/n_genes_by_counts`, `uns/tag_features`
- **Writes**: `obs/hashtag_sample`, `obs/hashtag_class`, `obs/hashtag_prob`, `obsm/hashtag_posterior`, `uns/hashtag_params`, `models/hashtag_mixture`
<!-- CHAINING:AUTO:END -->

This task belongs to no named recipe. It follows cell calling and feeds sample-level analysis.

## 10. Risks, pitfalls and open questions

- **Real-pool data.** The accessions, sizes and data licences of the Howitt et al. pools, and of the Mylka et al. cell-line and tissue data, are not identified here, so B1 and B2 cannot be built yet. Mylka et al. comparisons beyond the designs in B2 are not stated.
- **Unread or untabulated sources.** Sayed et al. (datasets and separability statistic), the Demuxafy benchmark, GMM-Demux (algorithm and benchmarks), BFF, scDemultiplex, HTOreader and the original deMULTIplex code are not tabulated, so no comparison with them is claimed. The multiplet-flag benchmark is attributed to doublets.hashtag_multiplet_calling, an identifier absent from the current task list; doublet recall stays a guardrail here.
- **Source gaps.** The MULTI-seq cut rule after R/preprocessing.R:6096 was not read. Whether simulateTags emits RNA covariates for the demuxmix variants is not stated. Whether the singlet catalogue holds tag counts or only RNA is not known.
- **Reproducibility.** The Seurat, scanpy and DropletUtils defaults were read from local copies that have no commit record; the remote default-branch heads recorded for them are 5f67c70, 8ed52d9 and ba4152d. The standalone HashSolo method paper is not identified; scanpy attributes the method to Solo [R8].
- **Licence and route.** The Cell Ranger caller is used only as a callout and is excluded from the MCP method enum, for the reason in section 12.
- **First experiment.** Apply all six callers at their defaults to the B3 default grid, and report negative fraction, AUC and the calibration of their posteriors. Build the B4 generator only after this, and do not tune singlet_mixture on B1 pools.

## 11. References

R1. Howitt G, Feng Y, Tobar L, et al. Benchmarking single-cell hashtag oligo demultiplexing methods. *NAR Genomics and Bioinformatics* 2023. doi:10.1093/nargab/lqad086 — partial (search)
R2. Mylka V, et al. Comparative analysis of antibody- and lipid-based multiplexing methods for single-cell RNA-seq. *Genome Biology* 2022. doi:10.1186/s13059-022-02628-8 — partial (search)
R3. Sayed M, Wang YJ, Lim HW. Systematic benchmark of single-cell hashtag demultiplexing approaches reveals robust performance of a clustering-based method. *Briefings in Functional Genomics* 2024. doi:10.1093/bfgp/elae039 — partial (search)
R4. Stoeckius M, Zheng S, et al. Cell Hashing with barcoded antibodies enables multiplexing and doublet detection for single cell genomics. *Genome Biology* 2018;19:224. — partial (repo)
R5. McGinnis CS, Patterson DM, Winkler J, et al. MULTI-seq: sample multiplexing for single-cell RNA sequencing using lipid-tagged indices. *Nature Methods* 2019. doi:10.1038/s41592-019-0433-8 — partial (search)
R6. Zhu Q, Conrad DN, Gartner ZJ. deMULTIplex2: robust sample demultiplexing for scRNA-seq. *Genome Biology* 2024. doi:10.1186/s13059-024-03177-y — partial (corpus)
R7. Klein HU, et al. demuxmix: demultiplexing oligonucleotide-barcoded single-cell RNA sequencing data with regression mixture models. *Bioinformatics* 2023. doi:10.1093/bioinformatics/btad481 — partial (corpus)
R8. Bernstein NJ, Fong NL, Lam I, Roy MA, Hendrickson DG, Kelley DR. Solo: doublet identification in single-cell RNA-seq via semi-supervised deep learning. *Cell Systems* 2020. doi:10.1016/j.cels.2020.05.010 — partial (corpus)
R9. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018. doi:10.1038/nbt.4042 — partial (corpus)
R10. Xin H, Yan Q, Jiang Y, et al. GMM-Demux: sample demultiplexing, multiplet detection, experiment planning, and novel cell-type verification in single cell sequencing. *Genome Biology* 2020. doi:10.1186/s13059-020-02084-2 — partial (corpus)
R11. Neavin D, et al. Demuxafy: improvement in droplet assignment by integrating multiple single-cell demultiplexing and doublet detection methods. *Genome Biology* 2024. doi:10.1186/s13059-024-03224-8 — partial (corpus)
R12. satijalab/seurat, R/preprocessing.R (HTODemux, MULTIseqDemux, ClassifyCells). https://github.com/satijalab/seurat — partial (repo)
R13. scverse/scanpy, src/scanpy/preprocessing/_hashsolo.py. https://github.com/scverse/scanpy — partial (repo)
R14. MarioniLab/DropletUtils, R/hashedDrops.R, version 1.33.2. https://github.com/MarioniLab/DropletUtils — partial (repo)
R15. 10XGenomics/cellranger, lib/python/cellranger/analysis/jibes.py. https://github.com/10XGenomics/cellranger — partial (repo)
R16. Gartner-Lab/deMULTIplex2, R/classify.R, R/em.R, R/simulation.R and R/benchmarking.R, commit de48333. https://github.com/Gartner-Lab/deMULTIplex2 — partial (repo)
R17. huklein/demuxmix, R/demuxmix.R, commit 4021e00. https://github.com/huklein/demuxmix — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/satijalab/seurat | Seurat authors (LICENSE); Satija Lab, NYGC (README) | MIT, with a LICENSE file | HTODemux and MULTIseqDemux reference | port |
| https://github.com/scverse/scanpy | scverse; F. Alexander Wolf, P. Angerer, Theis Lab (LICENSE copyright) | BSD 3-Clause | HashSolo reference implementation | port |
| https://github.com/MarioniLab/DropletUtils | Aaron Lun (aut); Jonathan Griffiths (ctb, cre); Davis McCarthy, Dongze He, Rob Patro (ctb) | GPL-3 (DESCRIPTION); no LICENSE file at the repository root | hashedDrops reference | reimplement |
| https://github.com/Gartner-Lab/deMULTIplex2 | Qin Zhu (maintainer), Daniel N. Conrad, Zev J. Gartner (DESCRIPTION) | CC BY 4.0 (DESCRIPTION and LICENSE.md) | deMULTIplex2 reference and benchmark generator | reimplement |
| https://github.com/huklein/demuxmix | Hans-Ulrich Klein (aut, cre) (DESCRIPTION) | Artistic-2.0 (DESCRIPTION); no LICENSE file at the repository root | demuxmix reference | reimplement |
| https://github.com/10XGenomics/cellranger | 10x Genomics (LICENSE) | 10x Genomics licence: permission only in connection with 10x Genomics products; source for information | Cell Ranger tag caller, source only | callout |
