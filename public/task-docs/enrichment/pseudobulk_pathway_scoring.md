---
id: enrichment.pseudobulk_pathway_scoring
title: Sample-level and pseudobulk pathway activity scoring
area: enrichment
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [qc.sample_level_qc, annotation.cluster_label_assignment, enrichment.pathway_resource_curation]
feeds: [enrichment.differential_pathway_activity, sample-level.sample_phenotype_prediction, sample-level.patient_stratification]
reads: [layers/<layer>, obs/<sample_key>, uns/<gene_set_key>]
writes: [obsm/pathway_score_<method>, uns/pathway_score_<method>_meta]
devices: [cpu, cuda]
mcp_tool: singlet_enrichment_pseudobulk_pathway_scoring
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Sample-level and pseudobulk pathway activity scoring

> Scores each sample, or each cell-type-by-sample pseudobulk group, against each gene set from a normalized sample-by-gene layer, returning one set score per sample together with the member coverage behind it.

## 1. Question

For each sample or pseudobulk group, what is the activity of each gene set, so that samples can be compared on pathway-level variables? Inputs are a normalized sample-by-gene layer and a named gene-set collection with optional signs or weights; the output is a sample-by-set score matrix with per-set coverage. A correct answer orders samples by planted activity, gives a null for random matched sets that is centred and uncorrelated with library size, and, for per-sample methods, does not change when other samples are added.

## 2. Why this task matters and where the field stands

Sample-level pathway scores turn donor or pseudobulk profiles into set-level variables for phenotype association, patient stratification and differential activity testing. Those analyses need the sample, not the cell, as the unit of replication, because treating cells as replicates inflates significance [R1]. The scoring step is contested. Holland et al. report that bulk-based tools with manually curated footprint gene sets can be applied to scRNA-seq data and partly outperform dedicated single-cell tools [R2]. Zhang et al. benchmark pathway activity transformation algorithms for accuracy, stability under dropout and scalability, and report that sctransform and scran normalization performed steadily well across tools [R3]. Status: **contested**.

Open problems:

- **Cohort dependence.** GSVA estimates its density across the input samples [R4], and ssGSEA normalizes its scores by the range of the values computed across the input [R7]. Their values are not comparable across cohorts without a fixed reference.
- **Stable normalization.** The stable-reference variant of singscore removes dependence on global ranks [R6]. Its benefit at sample level is not measured in the literature cited here.
- **Baseline and depth.** No heuristic scorer models gene-level baseline expression, library size and detection jointly.
- **Uncertainty.** Heuristic scores carry no per-sample standard error, and the decoupler GSVA implementation returns no p-values.
- **Benchmarks.** No benchmark in the cited literature targets donor-level pseudobulk scores.

## 3. Theory and insight

Notation. Sample $s$; gene $g$ among the $G$ genes present in the layer; layer value $x_{sg}$; set $S_k$ with $m_k$ members present and weights $w_{gk}$ (1 for unsigned members, 0 otherwise). $r_{sg}$ is the within-sample rank of gene $g$ among $N$ ranked genes, and $\mathrm{sd}_g$ is the standard deviation of gene $g$ across the input samples.

**Rank scores.** Singscore averages the within-sample ranks of members and rescales by the bounds for a set of $|S|$ members among $N$ ranked genes:

$$s_S=\frac{\bar r_S-l_S}{u_S-l_S},\qquad l_S=\frac{|S|+1}{2},\qquad u_S=\frac{2N-|S|+1}{2}.$$

The bounds assume every member is in the ranked background. UCell takes the Mann-Whitney statistic $U_S$ of member ranks among the top maxRank genes:

$$\mathrm{UCell}_S=1-\frac{U_S}{U_{\max}},\qquad U_{\max}=n\,\mathrm{maxRank}-\frac{n(n+1)}{2},\qquad n=m_k.$$

The decoupler AUCell form reports the normalized area under the recovery curve of member ranks up to $n_{\mathrm{up}}=\lceil 0.05\,G\rceil$, a fixed fraction of the layer's genes, so the window changes with the gene universe.

**Walk scores with a cohort step.** GSVA first replaces each value by a Gaussian kernel CDF estimated across all input samples, with bandwidth $h_g=\mathrm{sd}_g/4$:

$$\hat F_g(x)=\frac1S\sum_{s'=1}^{S}\Phi\!\left(\frac{x-x_{s'g}}{h_g}\right).$$

It then accumulates a signed walk over the genes ordered within the sample, weighted by the transformed rank statistic. With maxdiff the score is $\mathrm{ES}=\max_i RW_i+\min_i RW_i$. The density step costs $O(S^2G)$.

**Standardized mean.** The RoKAI-style z-mean is

$$\mathrm{ES}_{s,S}=\frac{(\mu_{s,S}-c_s)\sqrt{m}}{\sigma_s},\qquad \mu_{s,S}=\frac{\sum_{g}w_{gS}\,x_{sg}}{\sum_{g}|w_{gS}|},$$

where $w_{gS}$ is the set weight (zero for non-members; the sign is kept for signed sets), $\sigma_s$ is the sample's standard deviation over all genes and $c_s$ is either the sample mean over all genes or zero, depending on flavour (sections 4 and 10).

**Regression.** ULM regresses one sample's profile across genes on the set weights. Its slope t-value is

$$\mathrm{ES}_{s,S}=\frac{r\sqrt{G-2}}{\sqrt{1-r^2}},\qquad r=\mathrm{corr}_g\!\left(x_{sg},\,w_{gS}\right).$$

For an unsigned set the slope equals the mean of members minus the mean of non-members, and the t-value divides that slope by its standard error. The t reference assumes independent genes. Co-expression makes it anti-conservative, so the statistic is used for ranking and not as a calibrated p-value.

**Estimands.** One sentence each.

- singscore: the rescaled mean rank of members, in $[0,1]$, against global within-sample ranks.
- UCell: one minus the normalized U statistic, in $[0,1]$, high when members sit near the top of the sample's ranking.
- AUCell: the normalized area under the recovery curve up to $n_{\mathrm{up}}$, in $[0,1]$.
- GSVA: the extreme of the density-transformed walk, relative to the input cohort and unbounded.
- RoKAI z-mean: the member mean minus the centre $c_s$, in units of the sample's gene SD times $\sqrt m$, per sample and unbounded.
- ULM: the sample's regression slope t-value on the set weights, per sample and unbounded.
- Planted indicator (B1): one for samples whose member counts were multiplied by $f$ before normalization.
- Perturbation label (B2): the control or perturbed status of the parent bulk sample, inherited by every simulated pseudobulk drawn from it.
- Null quantity (B3): the Spearman correlation between a set's sample scores and log library size, dimensionless.

Regime of validity. Rank bounds need every member in the background. ULM and RoKAI need many genes and a residual spread that is stable across samples. GSVA needs enough samples to estimate the density.

**Why heuristics work and what a model adds.** Gene-set scores are informative when members are regulated together [R8]. Scores that do not centre each gene by its cohort mean (ULM, RoKAI z-mean, and singscore on raw ranks) read a set whose members sit higher in baseline expression than the rest of the genome as activity, even when the state is unchanged. A model with a gene-mean term removes that term by construction, below, and attaches an uncertainty to each sample's score, which the heuristics do not provide.

**Model-based proposal.** Let $y_{sg}$ be pseudobulk log-expression. The proposed model is

$$y_{sg}=\mu_g+\sum_k a_{sk}\,w_{gk}+u_{sg}+\varepsilon_{sg},\qquad a_{sk}\sim\mathcal N(0,\tau_k^2),\qquad \varepsilon_{sg}\sim\mathcal N(0,\sigma_g^2),$$

with $u_{sg}$ a donor-level random effect. The posterior of $a_{s\cdot}$ is Gaussian with closed-form mean and covariance, so every score carries a standard error. With flat priors, no random effect, equal residual variances and the centred profile $y_{sg}-\mu_g$, the posterior mean is the joint least-squares fit of all sets, which ULM approximates by fitting each set separately. The diagonal residual covariance assumes independent genes, which co-expression violates. The model is therefore accepted only if its intervals are close to nominal on null sets (B3).

## 4. Methods landscape

Only methods with a primary paper or implementation source behind them appear here.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| GSVA | heuristic | cohort-level Gaussian density transform, then a signed random walk over ranked genes | [R4] |
| singscore | heuristic | mean within-sample rank of members, rescaled by theoretical bounds; optional stable reference | [R5], [R6] |
| AUCell | heuristic | normalized area under the recovery curve of member ranks within the top fraction of genes | [R11] |
| UCell | heuristic | Mann-Whitney U of member ranks capped at maxRank, scaled to $[0,1]$ | [R12], [R13] |
| RoKAI z-mean | heuristic | set mean in one sample, centred by a flavour-dependent term, scaled by gene SD and $\sqrt m$ | [R10] |
| ULM | model-based | per-sample least-squares slope of the profile on set weights, reported as a t-value | [R9] |

The published standards are GSVA [R4] for cohort-level scores, and singscore [R5] and UCell [R12] for single-sample rank scores. Because the gene-set choice is central to the scRNA-seq comparison in Holland et al. [R2], set provenance is recorded in every output. ULM is the only model-based member and is the default because it scores each sample without reference to the cohort. ssGSEA is a further published standard; it is omitted until its running-sum loop has been read (section 10).

Defaults of the methods that singlet implements.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| GSVA | kernel for the density transform | gaussian | decoupler `src/decoupler/mt/_gsva.py:296` @3132edc |
| GSVA | density bandwidth | sd/4 | decoupler `src/decoupler/mt/_gsva.py:86` @3132edc |
| GSVA | maxdiff, absrnk, tau | true, false, 1 | decoupler `src/decoupler/mt/_gsva.py:297-299` @3132edc |
| GSVA (R reference) | kcdf, sample count for the switch | auto, kcdfNoneMinSampleSize 200 | GSVA `R/gsva.R:407-408` @428c367 |
| GSVA (R reference) | minSize, maxSize | 1, Inf | GSVA `R/gsva.R:405` @428c367 |
| singscore | ties | min | singscore `R/rankAndScoring.R:4` @7a45243 |
| singscore | bounds for a known direction | (S+1)/2 and (2N-S+1)/2, with S the set size | singscore `R/rankAndScoring.R:75-76` @7a45243 |
| AUCell (R reference) | aucMaxRank | ceiling(0.05 x genes) | AUCell `R/02_calcAUC.R:37` @91753b3 |
| AUCell (R reference) | normAUC | TRUE | AUCell `R/02_calcAUC.R:36` @91753b3 |
| AUCell | n_up | ceil(0.05 x G), clipped to [2, G] | decoupler `src/decoupler/mt/_aucell.py:48-49` @3132edc |
| UCell | maxRank | 1500 | UCell `README.md:77` @f778e09 |
| UCell | U_max | n x maxRank - n(n+1)/2 | UCell `README.md:75` @f778e09 |
| RoKAI z-mean | flavour | RoKAI | decoupler `src/decoupler/mt/_zscore.py:13` @3132edc |
| RoKAI z-mean | centre subtracted in code | RoKAI: sample mean over genes; KSEA: zero | decoupler `src/decoupler/mt/_zscore.py:75-78` @3132edc |
| RoKAI z-mean | SD degrees of freedom | ddof 1 | decoupler `src/decoupler/mt/_zscore.py:74` @3132edc |
| ULM | return value | t-value | decoupler `src/decoupler/mt/_ulm.py:27` @3132edc |
| ULM | degrees of freedom | G - 2 | decoupler `src/decoupler/mt/_ulm.py:97` @3132edc |

## 5. Proposed singlet approach

Routes. **Port** from the permissive decoupler implementations: ULM, RoKAI z-mean, GSVA (Gaussian and empirical-CDF transforms) and AUCell. **Reimplement** from the formulas in section 3: singscore and UCell. **Callout** only: the R GSVA, singscore and AUCell packages, pyUCell, and the GPU decoupler implementations, used for agreement checks and comparisons. Licence names are in section 12.

The model-based formulation in section 3 is implemented as batched weighted least squares per sample, with $K$ small. It is a hot small linear model, so it is hard-coded in CUDA with cuBLAS batched products and cuSPARSE for sparse weights, with a CPU path for checking. PyTorch is not needed for this release. A learned sparse-weight variant would use it and is out of scope here.

Falsification. The model is kept only if its B1 AUROC at $f=2$ exceeds ULM's by at least 0.02 and its B3 interval coverage on null sets lies between 0.93 and 0.97; both thresholds are proposed. Otherwise ULM remains the default.

Kernels and memory. Per-sample ranking uses a segmented sort on the GPU. ULM and RoKAI use sparse-dense products, and the walk is parallel across sets and samples. A float32 matrix of 1000 samples by 2x10^4 genes is 80 MB, so the layer is held in memory and streaming is not claimed. GSVA is the most expensive method as the sample count grows, because of the $O(S^2G)$ density step, and P1 reports its scaling explicitly.

Defaults an agent should use without asking: method `ulm`; layer `log1p_cpm`; sample_key `sample`; min_set_size 10; max_set_size 500; device `auto`; for gsva, kcdf `gaussian`, tau 1 and maxdiff true; for singscore, stable_reference null. Integer-valued layers are refused, set coverage is reported for every set, and no ULM p-value is reported as calibrated.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/<layer> | float32, samples by genes | normalized per-sample expression; default `log1p_cpm` |
| read | obs/<sample_key> | string | one sample or pseudobulk identifier per row |
| read | uns/<gene_set_key> | mapping from set name to members, with optional signs or weights | gene-set collection |
| write | obsm/pathway_score_<method> | float32, samples by sets | per-sample set score |
| write | uns/pathway_score_<method>_meta | dictionary | method, parameters, set sizes, per-set coverage, package versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle (.singlet path, URI or workspace handle) holding the normalized sample-by-gene layer. |
| `method` | string | "ulm" | `ulm`, `gsva`, `singscore`, `aucell`, `ucell`, `zscore_rokai` | Scoring method. ulm is the default and is cohort-independent; gsva is cohort-relative. |
| `gene_set_key` | string | required | — | Name of the gene-set collection under uns; members may carry signs or weights. |
| `layer` | string | "log1p_cpm" | — | Normalized layer to score. Layers whose values are all non-negative integers are refused. |
| `sample_key` | string | "sample" | — | obs column that identifies each sample or pseudobulk group. |
| `min_set_size` | integer | 10 | min 2 | Smallest number of set members present in the layer; smaller sets are dropped and listed in metadata. |
| `max_set_size` | integer | 500 | min 2 | Largest number of set members present in the layer; larger sets are dropped and listed in metadata. |
| `gsva` | object | — | — | GSVA options, used only when method is gsva. |
| `gsva.kcdf` | string | "gaussian" | `gaussian`, `none` | Density transform: gaussian kernel across samples, or none for the empirical CDF. |
| `gsva.tau` | number | 1 | — | Exponent on the rank statistic in the random walk. |
| `gsva.maxdiff` | boolean | true | — | Use the sum of the largest positive and negative deviations. |
| `singscore` | object | — | — | singscore options, used only when method is singscore. |
| `singscore.stable_reference` | array/null | null | — | Stable reference genes for the normalisation-robust variant; null uses global ranks. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

The `gsva` options apply only when `method` is `gsva`, and `singscore.stable_reference` only to `singscore`. The size limits apply to every method, and dropped sets are listed in the metadata. Signs and weights in the gene-set collection are used by `ulm` and `zscore_rokai`; `gsva` uses set membership only (decoupler registers it with weight=False, `src/decoupler/mt/_gsva.py:400-401`). singscore and AUCell score membership only, and UCell scores membership only in this version. The output depends on the layer, the sets and the options. Only `gsva` also depends on which other samples are present, and its output is flagged cohort-relative.

## 7. MCP tool

Tool name `singlet_enrichment_pseudobulk_pathway_scoring` (definition in `tasks/mcp/singlet_enrichment_pseudobulk_pathway_scoring.json`). Example call and result. The values are placeholders that show the schema, not measured results.

```json
{"dataset": "study.singlet", "gene_set_key": "hallmark", "sample_key": "donor_id", "method": "ulm"}
```

```json
{"dataset": "study.singlet", "status": "completed", "wrote": ["obsm/pathway_score_ulm", "uns/pathway_score_ulm_meta"],
 "summary": {"n_samples": "<int>", "n_sets_scored": "<int>", "n_sets_dropped": "<int>", "set_coverage_median": "<0-1>", "cohort_relative": false, "method": "ulm"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: no. The call computes one score per sample and set, and its cost is reported by the dry run. Stochastic: no. The result depends only on the layer, the sets and the options. Dry run: returns estimated seconds, peak memory and device from the $O(GK)$ scoring terms and the $O(S^2G)$ GSVA density term, and writes nothing.

## 8. Benchmarks

Shared protocol. Every benchmark uses the section 4 defaults unless a method option is stated. Gene sets are restricted to 10 to 500 members present in the layer, and coverage is recorded. Cohort-relative methods (gsva) are scored on the whole cohort of each replicate. Replicates use fixed seeds recorded with each result. Comparators are the enum methods. Agreement with the reference implementations in section 12 is measured on identical inputs as per-set Pearson and Spearman correlation before any timing. Each benchmark summarizes replicates by median and interquartile range.

### B1. Planted gene-set activity in pseudobulk (proposed)

- **Goal**: Power and AUROC for recovering planted per-sample activity of a known set across fold change, set size, sample number and depth.
- **Ground truth**: planted simulation. The label is the planted indicator of section 3, on the layer scale.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Donor-by-cell-type pseudobulk, one cell-type stratum per design | singlet catalogue (internal, author-annotated subset) | human scRNA-seq pseudobulk; S of 40 or 80 samples; depth of 10^5 or 10^6 counts | — | normalized after planting |

Generator recipe. (1) Draw S samples, keeping genes detected in at least 10% of them. (2) Choose a planted set F of size m in {10, 15, 50, 200, 500} from genes in matched mean-expression bins. (3) For a random half of samples, Poisson-resample F counts scaled by f in {1.25, 1.5, 2}, and binomially thin the other genes to keep library size fixed; exclude draws with f p > 1, where p is the F share. (4) Normalize, then draw 20 replicates per condition with fixed seeds.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC | area under the ROC curve of the set score for planted versus unplanted samples | maximize | primary | — |
| Power at 5% FDR | per replicate, the planted set and 1,000 matched random sets are tested by label permutation; Benjamini-Hochberg at q = 0.05 over all 1,001 sets; power is the rejection rate of the planted set | maximize | primary | — |

- **Comparators**: all enum methods; singscore with and without the stable reference.
- **Protocol**: full factorial over f, m, S and depth.
- **Acceptance criterion**: AUROC at least 0.9 at f = 2, with at least 20 samples per group and sets of at least 15 members (proposed).
- **Known pitfalls**: multiplying counts changes detection, so thinning holds library size fixed. The planted signal has no composition shift; a separate composition arm is needed.

### B2. In-silico pathway perturbation benchmark, pseudobulk form (published)

- **Goal**: Does simulated pseudobulk activity recover the perturbation status of the parent bulk experiment? This is the pseudobulk form of the single-cell design in [R2].
- **Ground truth**: planted simulation. The estimand is the binary control or perturbed status of the parent bulk sample, with inhibition and activation pooled, inherited by each simulated pseudobulk.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pathway-perturbation experiments (single_pw_perturbations.csv) | Zenodo 10.5281/zenodo.3564179 [R2] | bulk RNA-seq; experiment count — | — | PROGENy evaluation in source |

- **Simulation**: each pseudobulk sums num_cells cells, each drawn with replacement from the bulk TPM distribution with library size abs(round(N(libsize, libsize/2))) + 1 [R2]. Grid: libsize in {1000, 2000, 5000, 10000, 20000} by cells per pseudobulk in {10, 20, 30, 50, 100}, 30 replicates each; the one-cell setting is excluded.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ROC AUC | area under the ROC curve of the score for the perturbed label over simulated pseudobulk samples, per condition | maximize | primary | [R2] |
| PR AUC | area under the precision-recall curve with the perturbed label as positive; random baseline equals class prevalence | maximize | primary | [R2] |

- **Comparators**: each enum method on the PROGENy weight sets [R14], with AUCell as the single-cell comparator named in [R2].
- **Protocol**: simulate, score every simulated pseudobulk, and compute ROC AUC and PR AUC per condition; the summary is the median over the 25 conditions.
- **Acceptance criterion**: the default's median ROC AUC is at least the best comparator's median minus 0.02, and no condition with at least 20 cells per pseudobulk falls below 0.6 (both proposed).
- **Known pitfalls**: the label is bulk-level, so replicates from one bulk sample are not independent and the effective sample size is the number of bulk experiments. PROGENy footprints share biology with the labels, so footprint methods may score well for reasons that do not transfer.

### B3. Matched-null calibration against depth and detection (proposed)

- **Goal**: Are sample-level scores independent of library size and detected-gene fraction when no biological signal is present?
- **Ground truth**: consistency under a null. Random sets matched on size and mean expression have no activity by construction. The reported quantities are the Spearman correlation between a set's sample scores and log library size across samples, and, for the proposed model, the share of (set, sample) pairs whose 95% interval excludes zero.
- **Datasets**: the B1 subset, stratified by cell type, with pseudobulk per donor and cell type and S of 80 samples per stratum (proposed).
- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Median absolute depth correlation | median over 1,000 random size-matched sets of the absolute Spearman correlation between set score and log library size; threshold 0.05 for stable singscore and UCell, and the default method must meet the same bar (proposed) | minimize | guardrail | — |
| Share of deep-correlated null sets | fraction of random sets with absolute correlation above 0.2 (proposed cut) | minimize | guardrail | — |
| Detection R-squared | median over sets of the R-squared from regressing set scores on the detected-gene fraction | minimize | guardrail | — |
| Interval coverage | share of null (set, sample) pairs whose nominal 95% interval contains zero; applies to the proposed model only | within 0.93 to 0.97 | guardrail | — |

- **Comparators**: all enum methods.
- **Protocol**: random sets of size 10, 15, 50, 200 and 500, drawn to match the expression bins of B1, with 1,000 sets per size and stratum.
- **Acceptance criterion**: as in the depth-correlation row above. Both thresholds are proposed, and the default method is chosen from the results of this benchmark.
- **Known pitfalls**: depth can correlate with real biology in activated or tumour samples, so a correlation is evidence only within cell types and conditions. Matched nulls must match expression bins, or detection effects leak into the null.

### P1. Performance and scaling

Wall time and peak memory for sample-level scoring as functions of samples S in {10, 100, 1000}, about 2x10^4 genes and sets K in {50, 500, 5000} (proposed scales; the cited sources report no timings). A per-cell arm for UCell and AUCell only uses 10^4, 10^5 and 10^6 cells (proposed). Hold fixed: float32 precision, thread count, layer sparsity and the gene-set collection. Comparators are the decoupler CPU implementations @3132edc (ulm, zscore, gsva, aucell); the rapids-singlecell GPU implementations @e110792 (gsva, aucell, ulm, zscore, mlm); the R references for GSVA @428c367 and singscore @7a45243; and UCell @f778e09 with pyUCell @c1dc301 for the per-cell arm. Report GPU and CPU separately, and report numerical agreement before timing. GSVA's density step is $O(S^2G)$, so the S axis is reported explicitly.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `enrichment.pathway_resource_curation`: Curated pathway gene-set and signed footprint resource construction
- **Feeds**:
  - `enrichment.differential_pathway_activity`: Replicate-aware differential activity of pathways, regulons and programs between conditions
  - `sample-level.sample_phenotype_prediction`: Sample-level phenotype prediction from single-cell profiles
  - `sample-level.patient_stratification`: Unsupervised patient stratification from single-cell profiles
- **Reads**: `layers/<layer>`, `obs/<sample_key>`, `uns/<gene_set_key>`
- **Writes**: `obsm/pathway_score_<method>`, `uns/pathway_score_<method>_meta`
<!-- CHAINING:AUTO:END -->

Used in the donor-level workflow after pseudobulk aggregation and sample QC. Its sample-by-set output feeds differential activity testing and sample-level phenotype or patient models.

## 10. Risks, pitfalls and open questions

- **Sources read in part.** The ssGSEA running sum was not read, so ssGSEA is excluded from the methods table and the tool. The UCell formula comes from the repository README; its R source and the 2021 paper were not read. Zhang et al. [R3] are cited only for their abstract-level findings. A per-gene combined z-score from the literature is excluded because its paper was not read.
- **Decoupler z-score flavour.** In decoupler at 3132edc, flavour RoKAI subtracts the sample mean over all genes (`src/decoupler/mt/_zscore.py:75-76`), and KSEA subtracts nothing (`:77-78`). The docstring (lines 24-42) assigns the subtraction to KSEA. singlet follows the code, and the flavour is not exposed until the discrepancy is resolved against the upstream paper.
- **Unsettled literature.** No cited benchmark uses donor-level pseudobulk, and no timings are reported. A preprint titled PathwayBench, a benchmark of pseudobulk pathway activity scoring, surfaced in search but was not read, and it should be read before B1 and B3 are fixed.
- **Data and licence risks.** Dataset sizes and licences for the Zenodo deposit are shown as a dash. The real scRNA-seq CRISPR knockout data of Holland et al. [R2] are not used; B2 keeps only the in-silico design. GSVA output from R and from decoupler differ in defaults, so comparisons must name the implementation.
- **Provisional default.** ULM is the default before any benchmark is run. Its t-values are not calibrated, and it does not centre gene baselines (section 3). B3 tests depth, and its matched nulls cannot reveal the baseline effect in real collections. Whether that effect matters for real gene-set collections is untested.
- **First experiment.** Compute B3 for all enum methods on the catalogue subset at 80 samples per stratum, with depth stratification, and fix the default from the result. The model-based proposal enters only if it passes the B1 and B3 thresholds.

## 11. References

R1. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021;12:5692. doi:10.1038/s41467-021-25960-2 — verified (corpus)
R2. Holland CH, Tanevski J, Perales-Patón J, et al. Robustness and applicability of transcription factor and pathway analysis tools on single-cell RNA-seq data. *Genome Biology* 2020;21:36. doi:10.1186/s13059-020-1949-z — verified (repo)
R3. Zhang Y, Ma Y, Huang Y, et al. Benchmarking algorithms for pathway activity transformation of single-cell RNA-seq data. *Computational and Structural Biotechnology Journal* 2020;18:2953-2961. doi:10.1016/j.csbj.2020.10.007 — partial (search)
R4. Hänzelmann S, Castelo R, Guinney J. GSVA: gene set variation analysis for microarray and RNA-seq data. *BMC Bioinformatics* 2013;14:7. doi:10.1186/1471-2105-14-7 — verified (corpus)
R5. Foroutan M, Bhuva D, Lyu R, Horan K, Cursons J, Davis M. Single sample scoring of molecular phenotypes. *BMC Bioinformatics* 2018;19(1):404. doi:10.1186/s12859-018-2435-4 — verified (repo)
R6. Bhuva D, Cursons J, Davis M. Stable gene expression for normalisation and single-sample scoring. *Nucleic Acids Research* 2020;48(19):e113. doi:10.1093/nar/gkaa802 — verified (repo)
R7. Barbie DA, Tamayo P, Boehm JS, et al. Systematic RNA interference reveals that oncogenic KRAS-driven cancers require TBK1. *Nature* 2009;462(7269):108-112. doi:10.1038/nature08460 — verified (repo)
R8. Szalai B, Saez-Rodriguez J. Why do pathway methods work better than they should? *FEBS Letters* 2020;594(24):4189-4200. — partial (corpus)
R9. Badia-i-Mompel P, Vélez Santiago J, Braunger J, et al. decoupleR: ensemble of computational methods to infer biological activities from omics data. *Bioinformatics Advances* 2022;2(1):vbac016. doi:10.1093/bioadv/vbac016 — verified (corpus)
R10. Yılmaz S, Ayati M, Schlatzer D, et al. Robust inference of kinase activity using functional networks. *Nature Communications* 2021;12. doi:10.1038/s41467-021-21211-6 — verified (corpus)
R11. Aibar S, González-Blas CB, Moerman T, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017;14(11):1083-1086. doi:10.1038/nmeth.4463 — verified (corpus)
R12. Andreatta M, Carmona SJ. UCell: robust and scalable single-cell gene signature scoring. *Computational and Structural Biotechnology Journal* 2021. doi:10.1016/j.csbj.2021.06.043 — verified (repo)
R13. Andreatta M, Carmona SJ. UCell and pyUCell: single-cell gene signature scoring for R and Python. *Bioinformatics* 2026. doi:10.1093/bioinformatics/btag055 — verified (repo)
R14. Schubert M, Klinger B, Klünemann M, et al. Perturbation-response genes reveal signaling footprints in cancer gene expression. *Nature Communications* 2018. doi:10.1038/s41467-017-02391-6 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/decoupler (3132edc) | Pau Badia i Mompel; scverse | BSD-3-Clause (LICENSE) | GSVA, AUCell, ULM and RoKAI z-mean implementations | port |
| https://github.com/rcastelo/GSVA (428c367) | Robert Castelo (aut, cre) per DESCRIPTION | Artistic-2.0 (DESCRIPTION; no LICENSE file at root) | R reference for GSVA defaults | callout |
| https://github.com/DavisLaboratory/singscore (7a45243) | Dharmesh D. Bhuva and co-authors per DESCRIPTION | GPL-3 (DESCRIPTION; no LICENSE file at root) | singscore bounds and stable reference | reimplement |
| https://github.com/aertslab/AUCell (91753b3) | Sara Aibar, Stein Aerts (aut); Gert Hulselmans (maintainer) | GPL-3 (DESCRIPTION; no LICENSE file at root) | AUCell R defaults | callout |
| https://github.com/carmonalab/UCell (f778e09) | Massimo Andreatta, Santiago J. Carmona | GPL-3 (LICENSE file; DESCRIPTION agrees) | UCell formula and maxRank default | reimplement |
| https://github.com/carmonalab/pyucell (c1dc301) | Massimo Andreatta, Santiago J. Carmona (authors of the UCell and pyUCell citation) | MIT (LICENSE) | Python UCell, per-cell arm comparator | callout |
| https://github.com/saezlab/FootprintMethods_on_scRNAseq (d8e7707) | saezlab organisation; authors as in [R2] | GPL-3 (LICENSE file) | benchmark data and scripts for B2 | callout |
| https://github.com/scverse/rapids_singlecell (e110792) | Severin Dicks; scverse | MIT (LICENSE) | GPU decoupler-style comparators | callout |
