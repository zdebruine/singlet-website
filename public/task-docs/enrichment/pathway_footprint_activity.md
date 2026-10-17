---
id: enrichment.pathway_footprint_activity
title: Pathway activity inference from signaling footprints
area: enrichment
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [harmonization.gene_identifier_mapping, normalization.variance_stabilizing_transform, enrichment.pathway_resource_curation]
feeds: [enrichment.differential_pathway_activity, sample-level.sample_phenotype_prediction, statistics.multiple_testing_control]
reads: [layers/lognorm, uns/footprint_<name>]
writes: [obsm/pathway_activity_<method>, obsm/pathway_pvalue_<method>, uns/pathway_activity_<method>_params]
devices: [cpu, cuda]
mcp_tool: singlet_enrichment_pathway_footprint_activity
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Pathway activity inference from signaling footprints

> Scores each sample or cell for signaling pathway activity by weighting the expression of pathway-responsive genes with signed footprint weights, and checks those scores against known perturbations.

## 1. Question

Given normalised expression (bulk, pseudobulk or per cell) and a signed footprint that assigns each signaling pathway a set of responsive genes with weights, what is each pathway's activity in each sample or cell, and do the scores recover pathway perturbations? Input is log-normalised expression with gene symbols; output is a signed activity matrix, optionally with p-values. A correct answer ranks the perturbed pathway highest in held-out perturbation data at a stated false-positive rate, and is not driven by cell type, proliferation or library size.

## 2. Why this task matters and where the field stands

Signaling pathways are rarely measured directly at single-cell scale, so activity is inferred from transcripts. Footprint methods read a pathway's activity from the expression of its downstream responsive genes; PROGENy derives such footprints from perturbation-response experiments [R1]. Single-cell data add dropout and low library sizes, so it was unclear whether bulk footprint tools transfer. A benchmark on simulated and real scRNA-seq data reports that bulk tools with manually curated footprint gene sets can be applied to single cells and partly outperform dedicated single-cell tools, and that performance is more sensitive to the gene sets than to the statistic used [R2]. A separate benchmark of pathway activity transformation for single-cell data exists [R10].

Status: **contested**. Methods disagree on the scoring statistic, and the sources read do not fix a footprint size, sign convention or treatment of shared targets. Open problems:

- **Footprint choice**: results are more sensitive to the gene-set choice than to the statistic [R2, R9]. Gene sets with fewer than about 10 to 15 members are usually filtered out [R9].
- **Calibration**: gene-level regression p-values assume independent genes (an inference from the decoupleR code, section 3), and none of the methods in section 4 gives calibrated per-cell uncertainty.
- **Shared targets**: pathways with overlapping footprints produce cross-talk that makes joint fits unstable.
- **Circularity**: weights and benchmarks drawn from one perturbation compendium inflate accuracy.

## 3. Theory and insight

Let $X\in\mathbb{R}^{C\times G}$ hold normalised expression for $C$ samples or cells over $G$ genes, and $W\in\mathbb{R}^{G\times P}$ hold signed footprint weights for $P$ pathways, zero for non-members.

Estimands. The PROGENy output is the sample-wise weighted sum of expression, z-scored across samples, so it measures relative activity within the analysed set. ULM and MLM return the t-statistic of the slope of a sample's gene-level profile on each weight column, which is dimensionless and relative to residual spread across genes. The waggr output is a weighted mean of expression, in expression units. VIPER returns a rank-based enrichment score, which is unitless. The consensus is a mean of standardised signed scores and is unitless. GSVA and AUCell return unitless rank-based scores, and the posterior mean estimates $a_c$ on the scale of the prior, in units of $\tau$. Benchmark labels are binary and need no normalisation; planted activities in the proposed generator are in units of the prior standard deviation $\tau$.

PROGENy is a first-order, linear footprint:

$$S_{cp}=\sum_{g} x_{cg}\,W_{gp},\qquad \hat S_{cp}=\frac{S_{cp}-\bar S_{\cdot p}}{\operatorname{sd}(S_{\cdot p})}$$

The sum runs over genes present in both the data and the footprint, with $W$ holding the top $N$ genes per pathway by model p-value. Without scaling, the raw sum depends on expression units and library size; with scaling, the score depends on the analysed sample set. The regime is log-normalised or TPM-like $x$.

ULM fits one regression per sample $c$, with $y_c\in\mathbb{R}^{G}$ its feature vector and $w_p$ the weight column:

$$r=\operatorname{corr}(y_c,w_p),\qquad t=\frac{r\sqrt{G-2}}{\sqrt{1-r^{2}}},\qquad p=2\,\operatorname{sf}_{t,\,G-2}(|t|)$$

Here $G$ counts the features in the matrix, with non-members weighted zero. The p-value treats genes as independent observations. Co-expressed genes violate this, so the p-values are anti-conservative; this is an inference from the code and not a benchmarked result.

MLM regresses the profile jointly on all pathway columns, $\hat\beta=(X_d^\top X_d)^{-1}X_d^\top y_c$ with $X_d=[\mathbf 1\;W]$, and $t_p=\hat\beta_p/(\hat\sigma\sqrt{[(X_d^\top X_d)^{-1}]_{pp}})$ with $\mathrm{df}=G-P-1$. Joint fitting adjusts each pathway for overlapping ones, but collinearity inflates variance, and the decoupleR MLM function applies no multiplicity correction.

The consensus averages sign-split z-scores, $\mathrm{ES}_c=\tfrac1M\sum_m z^{(m)}_c$, and uses $p_c=2\,\mathrm{sf}_{\mathcal N}(|\mathrm{ES}_c|)$. The normal reference is exact only when the methods are perfectly correlated, and the error depends on correlations that are not characterised.

The proposed model-based estimator is a Gaussian footprint posterior:

$$y_c=b+Wa_c+\varepsilon_c,\quad \varepsilon_c\sim\mathcal N(0,\Sigma),\quad a_c\sim\mathcal N(0,T)$$

$$\Sigma_{a\mid y}=(W^\top\Sigma^{-1}W+T^{-1})^{-1},\qquad \mathbb E[a_c\mid y_c]=\Sigma_{a\mid y}\,W^\top\Sigma^{-1}(y_c-b)$$

The posterior covariance does not depend on $y_c$, so its standard deviation is the same for every cell: this gives per-pathway uncertainty only. Cell-specific uncertainty needs a noise covariance that varies with library size or detection, which dropout makes necessary. The regime is a Gaussian approximation to log-normalised expression with fixed $W$; a diagonal $\Sigma$ ignores co-expression.

AUROC is $\Pr(s_{\mathrm{pos}}>s_{\mathrm{neg}})+\tfrac12\Pr(s_{\mathrm{pos}}=s_{\mathrm{neg}})$, computed with unique thresholds for ties. It is invariant to monotone rescaling per pathway, so z-scoring changes it only when results are pooled across pathways or experiments.

Assumptions and failure modes. The footprint must respond to pathway activity alone, not to cell type, proliferation or library size. Weights must transfer from the fitting compendium to the target data type, with matching organism and symbols, because mismatched genes drop out silently. Shared targets cause cross-talk, most damaging for MLM. Dropout attenuates scores and ties them to detection rate. Scaling ties scores to the analysed set, and truncating to top-N genes changes the footprint (defaults in section 4). Permutation methods are stochastic and need fixed seeds.

Insight. A model-based estimator gains calibrated uncertainty only if its noise model holds, and a Gaussian diagonal model does not describe co-expression. Its case therefore rests on calibration, which the planted benchmark tests and the in silico benchmark checks in more realistic settings (section 8). Pooled AUROC can rise or fall with unequal positive counts, so results are reported per experiment as well as pooled.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| PROGENy footprint (R `progeny`) | hybrid | Fixed signed weights on top-N responsive genes; weighted sum, z-scored across samples | [R1] |
| decoupleR ULM | model-based | Per-sample t-statistic of the Pearson correlation between the gene profile and each weight column (equal to the slope t-statistic of a univariate fit) | [R3] |
| decoupleR MLM | model-based | Joint regression on all weight columns; partial t-statistics | [R3] |
| decoupleR waggr | heuristic | Signed weighted mean or sum of expression with permutation p-values | [R3] |
| decoupleR consensus | heuristic | Mean of sign-split z-scores across methods | [R3] |
| VIPER (decoupleR port) | heuristic | Rank-based enrichment with an analytic null and pleiotropy correction | [R4] |
| GSVA (decoupleR wrapper) | heuristic | Per-sample rank-based kernel score; ignores weights and signs | [R5] |
| AUCell (decoupleR port) | heuristic | Per-cell area under the recovery curve of top-ranked genes; unsigned | [R6] |
| Spectra | model-based | Factor model with gene-set priors; a program model, not a footprint scorer | [R8] |

PROGENy is the published standard footprint and was benchmarked on single-cell data [R2]. The decoupleR methods reuse the same net and are the comparators for estimator choice. GSVA and AUCell ignore weights, so they test whether signs and weights matter. Spectra is the closest model-based precedent for gene-set priors. ssGSEA is excluded (section 10).

Defaults used by the implementation. Each row gives the value and its exact location in the cited source.

| Method | Parameter | Value | Source |
|---|---|---|---|
| PROGENy | `top` | 100 | progeny `R/progeny.r:79` @ cad6be0 |
| PROGENy | `perm` | 1 (no permutation) | progeny `R/progeny.r:79` @ cad6be0 |
| PROGENy | `scale` | TRUE | progeny `R/progeny.r:79` @ cad6be0 |
| PROGENy | footprint ranking | lowest model p-value | progeny `R/progenySuppFunc.r:206` @ cad6be0 |
| PROGENy | permutations when `perm > 1` | the `perm` value, passed as `k` | progeny `R/progeny.r:196` @ cad6be0 |
| PROGENy | default `k` of `progenyPerm` | 10000 (not used by `progeny`) | progeny `R/progenyPermutations.r:40` @ cad6be0 |
| PROGENy | pathways; human genes | 14; 22,479 | progeny `R/progeny.r:16`; `R/data.r:6` @ cad6be0 |
| decoupleR ULM | `tval`; df | True; n − 2 | decoupler `src/decoupler/mt/_ulm.py:27`, `:97`, `:105` @ 3132edc |
| decoupleR MLM | `tval`; df | True; n_features − n_fsets − 1 | decoupler `src/decoupler/mt/_mlm.py:39`, `:112` @ 3132edc |
| decoupleR waggr | `fun`; `times`; `seed` | wmean (or wsum); 1000; 42 | decoupler `src/decoupler/mt/_waggr.py:144`–`146` @ 3132edc |
| decoupleR consensus | `cons`; `methods` | False; all | decoupler `src/decoupler/mt/_decouple.py:15` (cons), `:13` (methods) @ 3132edc |
| VIPER | `pleiotropy`, `reg_sign`, `n_targets`, `penalty` | True, 0.05, 10, 20 | decoupler `src/decoupler/mt/_viper.py:172`–`175` @ 3132edc |
| GSVA | `kcdf` | gaussian | decoupler `src/decoupler/mt/_gsva.py:296` @ 3132edc |
| AUCell | `n_up` | ceil(0.05 × features), clipped to [2, features] | decoupler `src/decoupler/mt/_aucell.py:47`–`49` @ 3132edc |
| decoupleR PROGENy net | `top`; `thr_padj` | inf; 0.05 | decoupler `src/decoupler/op/_progeny.py:12`–`13` @ 3132edc |

## 5. Proposed singlet approach

**Routes.** Port: PROGENy scoring with its packaged human model and the mouse model that accompanies the mouse extension [R7], and the decoupleR ULM, MLM, waggr, consensus, VIPER, GSVA and AUCell code. Callout: the R GSVA and R AUCell packages and the Holland benchmark protocol, used as comparators (no code copied), and Spectra, used as a design reference. Licences are in section 12.

**Default.** `method = progeny`, `organism = human`, `top_n = 100`, `tmin = 3`, `layer = lognorm`, `progeny.scale = true`, `progeny.perm = 1`. PROGENy is the established footprint with a published single-cell benchmark [R2], and it returns scores without p-values that could be over-read. Because scaling ties scores to the analysed set, scores are comparable only within one dataset (section 3).

**Model-based candidate.** The Gaussian posterior of section 3 is the proposed model-based estimator. Its weights start from the PROGENy footprint and its noise covariance is diagonal, which the benchmarks must test. It joins the method enum only when its code exists. It is rejected if its planted-benchmark coverage (B3) falls outside 0.85–0.95, or if its in silico AUROC (B1) falls more than 0.02 below PROGENy in any library-size stratum. A negative-binomial variant (counts with size factors; 14 parameters per cell fitted by Newton iterations with Fisher information) follows the same tests.

**Stack.** PyTorch fits the prior, the noise covariance and any learned weights, with autograd through the closed-form posterior; the PyTorch code is the correctness reference. Scoring is hard-coded. The gain matrix $K=\Sigma_{a\mid y}W^\top\Sigma^{-1}$ ($P\times G$) is computed once, and $\mathbb E[a_c\mid y_c]=K(y_c-b)$ is one dense-by-sparse product per block of cells (cuBLAS or cuSPARSE). The posterior standard deviation is a constant vector.

**Complexity.** PROGENy and the linear methods cost $O(C\cdot\mathrm{nnz}(W))$ with $\mathrm{nnz}(W)=P\cdot\mathrm{top\_n}$, which is 1,400 for 14 pathways at top 100. ULM costs $O(C(G+\mathrm{nnz}(W)))$ with precomputed column moments.

**Devices and streaming.** CPU and CUDA for all methods. PROGENy scaling needs per-pathway means and variances over all samples, so streaming uses two passes or running moments over float32 CSR blocks. Permutation nulls multiply cost by the permutation count.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/lognorm | float32 sparse | normalised expression; gene symbols in var names |
| read | uns/footprint_<name> | long table | signed net (source, target, weight), used when the footprint is not the packaged PROGENy model |
| write | obsm/pathway_activity_<method> | float32, cells × pathways | signed activity; pathways below `tmin` are missing |
| write | obsm/pathway_pvalue_<method> | float32, cells × pathways | p-values for ulm, mlm, viper and waggr; absent otherwise |
| write | uns/pathway_activity_<method>_params | dictionary | resolved method, organism, top_n, tmin, seed and options |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "lognorm" | — | Normalised expression layer. Raw counts are rejected for linear methods. |
| `organism` | string | "human" | `human`, `mouse` | Must match the gene symbols; mouse uses the PROGENy mouse model. |
| `method` | string | "progeny" | `progeny`, `ulm`, `mlm`, `waggr_wmean`, `waggr_wsum`, `viper`, `gsva`, `aucell`, `consensus` | Scoring method. Keep progeny unless a comparison is requested; p-values come only from ulm, mlm, viper and waggr. |
| `top_n` | integer | 100 | min 1 | Footprint genes per pathway, ranked by lowest PROGENy model p-value. |
| `tmin` | integer | 3 | min 1 | Minimum footprint genes present per pathway; smaller pathways are returned as missing. |
| `progeny` | object | — | — | Options for method progeny. |
| `progeny.scale` | boolean | true | — | Z-score each pathway across samples; comparable only within one analysed set. |
| `progeny.perm` | integer | 1 | min 1 | 1 disables the permutation null; above 1 is the number of permutations. |
| `viper` | object | — | — | Options for method viper. |
| `viper.pleiotropy` | boolean | true | — | Apply the pleiotropy correction for regulators that share targets. |
| `viper.reg_sign` | number | 0.05 | max 1; > 0 | p-value threshold for significant regulators under pleiotropy. |
| `viper.n_targets` | integer | 10 | min 1 | Minimum shared targets for a pleiotropy comparison. |
| `viper.penalty` | number | 20 | min 1 | Pleiotropy penalty; 1 applies no penalty. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 42 | — | Seed for waggr and permutation runs. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Options are scoped. `top_n` and `tmin` apply to every method, `progeny` options only to `progeny`, and `viper` options only to `viper`. The two waggr aggregations are separate method values, so no option selects them. Consensus always combines ULM, MLM, waggr_wmean and VIPER; GSVA and AUCell are excluded because they ignore weights or signs. `seed` affects waggr and permutation runs only. Raw counts are rejected for linear methods; use `layer` to select a normalised layer.

## 7. MCP tool

Tool name `singlet_enrichment_pathway_footprint_activity` (definition in `tasks/mcp/singlet_enrichment_pathway_footprint_activity.json`).

```json
{"dataset": "path/to/dataset.singlet", "method": "progeny", "organism": "human", "top_n": 100, "progeny": {"scale": true, "perm": 1}}
```

```json
{"dataset": "path/to/dataset.singlet", "status": "completed", "wrote": ["obsm/pathway_activity_progeny", "uns/pathway_activity_progeny_params"], "summary": {"method": "progeny", "organism": "human", "pathways": "<int>", "pathways_dropped": "<list>"}, "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: queued only when `progeny.perm` exceeds 1; everything else runs inline. Stochastic: the waggr methods and `progeny` with `perm > 1` draw permutations, fixed by `seed`. Dry run: returns estimated seconds, peak memory and device from cell count, gene count and nnz(W), with no writes.

## 8. Benchmarks

Shared protocol. Every benchmark scores with the defaults of section 6 unless stated. Scores are computed per cell or per pseudobulk sample, and pathways with fewer than `tmin` footprint genes are excluded. AUROC uses direction '<' with the tie handling of section 3, and is reported per experiment and pooled. The predictor is the activity for activating perturbations and its negative for inhibiting ones. Seeds are fixed at 42. Weight fitting excludes every experiment used for testing, and all comparators receive identical inputs, footprint and gene symbols.

### B1. Holland et al. 2020 in silico benchmark (pathway arm)

- **Goal**: recover the perturbed pathway from simulated single cells drawn from bulk pathway-perturbation experiments, stratified by library size, cell number and coverage [R2].
- **Ground truth**: planted simulation. Each simulated cell carries the perturbation label of its source bulk sample. The response for pathway $p$ is 1 when that perturbation is $p$ and 0 otherwise, and the predictor is the signed activity of $p$. Labels are binary; cells are normalised with scran size factors after removing cells with library size below 100 (`src/simulation.R:55`, `:59`).

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Bulk pathway-perturbation experiments with PROGENy labels | Zenodo 10.5281/zenodo.3564179, `data/in_silico_benchmark/meta_data/single_pw_perturbations.csv` [R2] | bulk RNA-seq, human; mouse restricted to pathways perturbed in both species; experiments — | — | Cell library size is drawn as abs(round(N(ℓ, ℓ/2))) + 1 and cells are sampled with replacement (`src/simulation.R:9`, `:13`) |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC of sign-corrected activity | ROC AUC over simulated cells (direction '<', `analyses/in_silico_benchmark.Rmd:887`, `:915`), per experiment and pooled, stratified by coverage, library size and cell number | maximise | primary | [R2] |
| Stratum drop | AUROC at each stratum minus AUROC at full coverage | minimise | guardrail | [R2] |

- **Comparators**: PROGENy R (top 100, scale TRUE) as the reference; decoupleR ULM, MLM, waggr_wmean, waggr_wsum, VIPER, GSVA and AUCell on the same net.
- **Protocol**: the repository grid is library sizes 1,000, 2,000, 5,000, 10,000 and 20,000, cell numbers 1, 10, 20, 30, 50 and 100, and 30 replicates (`analyses/in_silico_benchmark.Rmd`, simulation parameters chunk). Only the pathway arm is used; the transcription-factor arm is out of scope.
- **Acceptance criterion** (proposed by singlet, not from the literature): pooled AUROC of the default at least 0.70 over the full grid, and no library-size stratum more than 0.02 below PROGENy R.
- **Known pitfalls**: cells are drawn from bulk profiles, so dropout structure and cell-type heterogeneity are absent and results are optimistic for real cells. Experiments that overlap the weight compendium inflate AUROC (see B2).

### B2. Leave-one-study-out pathway perturbation recovery (proposed)

- **Goal**: test whether footprints fitted without a held-out study still recover that study's pathway perturbations, which removes the circularity of in-sample benchmarks.
- **Ground truth**: held-out studies, held out by study and by accession. A sample is positive for pathway $p$ when it carries perturbation $p$ and negative when it is a control. Per-pathway AUROC is invariant to rescaling, so the normalisation affects only the pooled mean across pathways.
- **Refit recipe** (singlet's own, not Schubert et al.'s derivation): for each held-out study, the footprint of each pathway is the top $N$ genes by p-value from limma differential statistics on the remaining studies, signed by the direction of change, with $N\in\{50,100,200\}$. The limma-based model is described in the PROGENy data documentation (`R/data.r`).

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pathway-perturbation experiments with labels | Zenodo 10.5281/zenodo.3564179, `data/in_silico_benchmark/meta_data/single_pw_perturbations.csv` [R2]; PROGENy compendium [R1] | bulk RNA-seq, human and mouse; studies —; samples — | — | Accessions are read from the metadata at run time |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Held-out AUROC | Per pathway, AUROC separating perturbed from control held-out samples, averaged over pathways perturbed in that study | maximise | primary | [R1] |
| In-sample minus held-out gap | Mean AUROC with weights from all studies minus the held-out mean | minimise | guardrail | [R1] |

- **Comparators**: PROGENy as published; ULM on the decoupleR PROGENy net (top inf, padj 0.05); GSVA and AUCell on the same footprint sets, unweighted.
- **Protocol**: leave-one-study-out over all studies at each $N$. Report the number of positive samples per held-out study, because small sets make AUROC unstable.
- **Acceptance criterion** (proposed): mean held-out AUROC at least 0.75 and in-sample minus held-out gap at most 0.05.
- **Known pitfalls**: experiments from one study share batch and design, so a study-level hold-out is required, not only an accession-level one. Inconsistent pathway labels across experiments lower AUROC for reasons unrelated to footprints.

### B3. Planted footprint recovery and posterior calibration (proposed)

- **Goal**: test whether the posterior recovers planted pathway activities and whether its 90% intervals cover them, which the section 4 methods do not report.
- **Ground truth**: planted simulation from the model itself. The estimand is the planted $a_{cp}$ in units of the prior standard deviation $\tau$; correlation is invariant to that scale, and coverage uses the same units.
- **Generator**: (1) load the packaged PROGENy human footprint $W$ (top 100 per pathway, section 4); (2) draw $a_c\sim\mathcal N(0,\tau^2 I)$ per cell with $\tau=1$; (3) set $y_c=b+Wa_c+\varepsilon_c$ with $\Sigma=\sigma^2 I$, $\sigma$ on a grid in the configuration; (4) a second scenario draws negative-binomial counts with size factors and a dispersion grid, so the Gaussian model is misspecified; (5) ten replicate datasets per setting, seeds 42 plus replicate index.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Synthetic cells from the generator | Generated; footprint from the PROGENy package [R1] | simulated; human footprint; cells per setting set in the configuration | see section 12 | Scenario 2 adds overdispersion and size factors |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Correlation with planted activity | Per pathway, correlation across cells between posterior mean and $a_{cp}$; median over replicates | maximise | primary | [R1] |
| Empirical 90% coverage | Fraction of planted $a_{cp}$ within the posterior mean ± 1.645 posterior standard deviation | nominal 0.90 | guardrail | — |

- **Comparators**: PROGENy z-score, decoupleR ULM t and decoupleR MLM t, on the same simulated cells.
- **Protocol**: report per-pathway values and their median for both scenarios.
- **Acceptance criterion** (proposed): per-pathway coverage between 0.85 and 0.95, and correlation at least that of the PROGENy z-score in every setting.
- **Known pitfalls**: the generator matches the posterior, so this tests internal consistency only. Planted activities are independent across pathways, whereas real pathways share targets, so coverage can hold here and fail on B1.

### P1. Performance and scaling

Wall time, peak memory and throughput (cells per second) at 10k, 100k and 1M cells, and at 10M cells in streaming mode, on CPU and CUDA. Comparators: decoupleR ULM, MLM and VIPER (Python, CPU); PROGENy R with `perm` 1 and with a permutation count fixed in the run configuration; AUCell and GSVA (R). Hold fixed: the packaged human PROGENy footprint at top 100 (14 pathways), float32 sparse input, one thread per method unless stated, and a fixed seed. No timings are reported here; they are to be measured.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
  - `enrichment.pathway_resource_curation`: Curated pathway gene-set and signed footprint resource construction
- **Feeds**:
  - `enrichment.differential_pathway_activity`: Replicate-aware differential activity of pathways, regulons and programs between conditions
  - `sample-level.sample_phenotype_prediction`: Sample-level phenotype prediction from single-cell profiles
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
- **Reads**: `layers/lognorm`, `uns/footprint_<name>`
- **Writes**: `obsm/pathway_activity_<method>`, `obsm/pathway_pvalue_<method>`, `uns/pathway_activity_<method>_params`
<!-- CHAINING:AUTO:END -->

Recipes: per-cell-type condition comparisons on pathway activity and sample-level phenotype prediction both consume these activities.

## 10. Risks, pitfalls and open questions

- **Unstated sources**: the experiment count, study list and accession list for the in silico and compendium benchmarks (B1, B2) are not stated in the repository files. The Zenodo data licence is not stated in the source. The Holland 2020 result tables were not read, so the comparative statements in section 2 come from the repository README abstract.
- **Schubert 2018 details**: the number of perturbation experiments, the exact model-building procedure and any held-out validation of the weights are not stated in the PROGENy repository, so B2 uses its own refit recipe and does not reproduce the original derivation.
- **Excluded methods and benchmarks**: ssGSEA appears in the catalogue entry, but it is not a decoupleR method and its primary text was not read, so it is excluded. The in vitro CRISPR knockdown benchmark of Holland 2020 tests transcription factors and its data identifiers are not stated in the repository, so it is not used. KnockTF [R11] tests regulons rather than footprints and is not used here. No dataset is stated for gene-subsampling robustness, so coverage is tested only through the B1 strata.
- **Score conventions**: the VIPER docstring gives $p=\Phi(\mathrm{ES})$ (`_viper.py` docstring, line 233), but the code returns $2\,\mathrm{sf}(|\mathrm{NES}|)$ (`_viper.py:320`), so p-values must be checked before comparison. decoupleR's PROGENy wrapper renames the model p-value to padj without correction (`op/_progeny.py:70`), and decoupleR's MLM p-values are not multiplicity-corrected. AUCell scores depend on feature count through the `n_up` default.
- **Unresolved literature**: whether footprints transfer to current large single-cell atlases at the accuracy reported by Holland et al. has not been tested in the sources read, and no footprint size is established. B1 is the first test.
- **First experiment**: run B3 on planted data and B1 on the simulation grid for PROGENy, ULM and the posterior with diagonal noise before any single-cell claim. The results decide whether the posterior is worth porting to CUDA.

## 11. References

R1. Schubert M, Klinger B, Klünemann M, Sieber A, Uhlitz F, Sauer S, Garnett MJ, Blüthgen N, Saez-Rodriguez J. Perturbation-response genes reveal signaling footprints in cancer gene expression. *Nature Communications* 2018. doi:10.1038/s41467-017-02391-6 — verified (corpus)

R2. Holland CH, Tanevski J, Perales-Patón J, Gleixner J, Kumar MP, Mereu E, Joughin BA, Stegle O, Lauffenburger DA, Heyn H, Szalai B, Saez-Rodriguez J. Robustness and applicability of transcription factor and pathway analysis tools on single-cell RNA-seq data. *Genome Biology* 2020. doi:10.1186/s13059-020-1949-z — verified (repo)

R3. Badia-i-Mompel P, Vélez Santiago J, Braunger J, Geiss C, Dimitrov D, Müller-Dott S, Taus P, Dugourd A, Holland CH, Ramirez Flores RO, Saez-Rodriguez J. decoupleR: ensemble of computational methods to infer biological activities from omics data. *Bioinformatics Advances* 2022. doi:10.1093/bioadv/vbac016 — verified (corpus)

R4. Alvarez MJ, Shen Y, Giorgi FM, Lachmann A, Ding BB, Ye BH, Califano A. Functional characterization of somatic mutations in cancer using network-based inference of protein activity. *Nature Genetics* 2016. doi:10.1038/ng.3593 — verified (corpus)

R5. Hänzelmann S, Castelo R, Guinney J. GSVA: gene set variation analysis for microarray and RNA-seq data. *BMC Bioinformatics* 2013. doi:10.1186/1471-2105-14-7 — verified (corpus)

R6. Aibar S, González-Blas CB, Moerman T, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — verified (corpus)

R7. Holland CH, Szalai B, Saez-Rodriguez J. Transfer of regulatory knowledge from human to mouse for functional genomics analysis. *Biochimica et Biophysica Acta – Gene Regulatory Mechanisms* 1863(6), 2020 (online 2019). doi:10.1016/j.bbagrm.2019.194431 — verified (search)

R8. Kunes RZ, Walle T, et al. Supervised discovery of interpretable gene programs from single-cell data. *Nature Biotechnology* 2023. doi:10.1038/s41587-023-01940-3 — verified (corpus)

R9. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)

R10. Zhang Y, Ma Y, Huang Y, Zhang Y, Jiang Q, Zhou M, Su J. Benchmarking algorithms for pathway activity transformation of single-cell RNA-seq data. *Computational and Structural Biotechnology Journal* 2020. — verified (corpus)

R11. Feng C, Song C, Liu Y, et al. KnockTF: a comprehensive human gene expression profile database with knockdown/knockout of transcription factors. *Nucleic Acids Research* 2019. doi:10.1093/nar/gkz881 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/saezlab/progeny | Michael Schubert (aut); Aurélien Dugourd (cre, ctb); further contributors (DESCRIPTION) | Apache-2.0 (LICENSE file; DESCRIPTION); version 1.17.3 at cad6be0 | PROGENy weights, mouse and human models, and scoring | port |
| https://github.com/scverse/decoupler | Pau Badia i Mompel (authors, pyproject.toml) | BSD-3-Clause (LICENSE file); version 2.2.1 at 3132edc | ULM, MLM, waggr, consensus, VIPER, GSVA, AUCell and the PROGENy net | port |
| https://github.com/saezlab/FootprintMethods_on_scRNAseq | Holland CH and co-authors (README citation) | GPL-3.0 (LICENSE file) | Benchmark code and Zenodo data record for B1 and B2 | reimplement the protocol; no code copied |
| https://github.com/rcastelo/GSVA | Robert Castelo (aut, cre); further authors (DESCRIPTION) | Artistic-2.0 (DESCRIPTION; no LICENSE file at repository root); version 2.7.25 at 428c367 | GSVA comparator | callout (no code copied) |
| https://github.com/aertslab/AUCell | Sara Aibar, Stein Aerts (authors); Gert Hulselmans (maintainer) | GPL-3 (DESCRIPTION; no LICENSE file at repository root); scRNA-tools records Custom; version 1.25.2 at 91753b3 | AUCell comparator | callout (no code copied) |
| https://github.com/dpeerlab/spectra | Russel Z. Kunes, Thomas Walle (authors, pyproject.toml) | MIT (LICENSE.md); version 0.2.0 at 9c079a5 | Model-based gene-program precedent | callout |
