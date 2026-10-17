---
id: qc.single_nucleus_quality_filtering
title: Nucleus-aware quality filtering for single-nucleus RNA-seq
area: qc
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [cell-calling.nucleus_vs_empty_calling, ingest-quant.intron_inclusive_gene_counting]
feeds: [normalization.size_factor_estimation, doublets.expression_doublet_scoring, qc.sample_level_qc]
reads: [layers/counts, layers/exonic, layers/intronic, var/mito, obs/<sample_key>]
writes: [obs/keep_cell, obs/qc_nuclear_fraction, obs/qc_flag_reason, obs/qc_posterior_compromised, uns/qc_nucleus_thresholds, uns/qc_nucleus_params, models/nucleus_qc]
devices: [cpu, cuda]
mcp_tool: singlet_qc_single_nucleus_quality_filtering
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Nucleus-aware quality filtering for single-nucleus RNA-seq

> Flags nuclei that are incompletely stripped, damaged or technically poor, reads the mitochondrial and intronic signals with their nuclear meaning, and writes a keep flag, the nuclear fraction and the reason for each flag.

## 1. Question

Which nuclei are intact and informative when judged on nucleus-appropriate metrics (UMI and gene counts, mitochondrial fraction, intronic or nuclear fraction), and do thresholds calibrated on cells wrongly flag healthy nuclei? The input is a nucleus-by-gene matrix with exonic and intronic layers from an intron-aware quantification, plus sample labels. The output is a keep flag per nucleus, the nuclear fraction, the flag reason and the thresholds used. Success is defined by the benchmarks in section 8, because no published per-nucleus quality label exists.

## 2. Why this task matters and where the field stands

Single-nucleus RNA-seq reaches cell types that dissociate poorly, and its workflows carry dissociation and storage biases that differ from whole-cell workflows [R9]. In adult kidney it revealed rare cell types and novel cell states in fibrosis [R8], and systematic comparisons quantify the method differences [R6]. Nuclei differ from cells in the signals that QC uses. Cytoplasm is removed, so mitochondrial transcripts should be almost absent, and a mitochondrial count points to incomplete stripping or ambient RNA rather than to stress [R1]. Intronic pre-mRNA reads are the defining signal of nuclei, so the same share means something different in nuclei than in cells [R15]. Empty-droplet calling is upstream [R14]. Best-practice guidance states that the cell-calling models that work for droplets may need additional filters or heuristics for single-nucleus data [R21, R3].

Status: **contested**. Open problems:

- No published benchmark of nuclear-fraction or mitochondrial thresholds on snRNA-seq was identified, and the best-practice rules are derived from cells [R2].
- Mitochondrial content differs between cell types and tissues, so fixed cutoffs are not universal [R2]; their values for nuclei are not quantified.
- Whether nuclear fraction should be a covariate, a regressor or a filter is unsettled.
- The model-based tools miQC [R11], DropletQC [R12] and dropkick [R13] were built for cells or droplets, and no nucleus benchmark of them was identified.
- Stripped nuclei under-represent activation-associated genes [R10], so removing nuclei by profile can bias biology.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $x_i$ | per-nucleus metric: log UMI or log genes, or mito percent |
| $I_i,\ E_i$ | intronic and exonic UMI counts of nucleus $i$ under the stated quantification |
| $N_i$ | total UMI count of nucleus $i$ |
| $y_i,\ d_i$ | mito percent and detected genes in the miQC model |
| $\rho_i,\ \pi_{\text{cyt}},\ \epsilon$ | residual cytoplasmic share, cytoplasmic mito share and ambient mito share (proposed model) |

**Robust MAD rule.** For a per-sample metric, with $c=1.4826$ the normal-consistency constant,

$$\hat M=\operatorname{median}_i x_i,\qquad \hat s=c\,\operatorname{median}_i\lvert x_i-\hat M\rvert,\qquad \text{flag } x_i>\hat M+\max\bigl(n_{\text{mads}}\hat s,\ \delta\bigr).$$

The lower tail is the mirror image. With the floor off, the rule is affine-equivariant, so the log base changes no flag, whereas $\log x$ and $\log(x+1)$ do. Regime: one unimodal bulk per sample, with fewer than half of the values tied with the median. With more ties $\hat s=0$ and the threshold collapses to $\hat M+\delta$. For mito percent with $n_{\text{mads}}=3$, the floor $\delta=0.5$ percentage points is active exactly when $\hat s\le 0.5/3$, which is the regime of nuclei with near-zero mito.

**Nuclear fraction.**

$$\mathrm{NF}_i=\frac{I_i}{I_i+E_i}.$$

The estimand is the intronic share of the UMIs of nucleus $i$ under the stated quantification. DropletQC can also compute the fraction from BAM region tags [R12]; that version uses reads and differs. Count-based values depend on whether introns are counted and on the overlap rule [R15, R18]. Under binomial UMI sampling the variance is approximately $\mathrm{NF}(1-\mathrm{NF})/(I_i+E_i)$, so nuclei with few UMIs have unstable values.

**Mixture of linear regressions (miQC).**

$$p(y_i\mid d_i)=\sum_{k=1}^{2}\pi_k\,\mathcal N\bigl(y_i\mid\beta_{k0}+\beta_{k1}d_i,\ \sigma_k^2\bigr),\qquad q_i=P\bigl(k=\text{compromised}\mid y_i,d_i\bigr),\qquad \text{keep if } q_i\le 0.75.$$

The estimand of $q_i$ is the posterior probability that nucleus $i$ belongs to the compromised component, not a fraction of cells. Regime: $y_i$ is bounded and zero-inflated, so the Gaussian approximation is weakest where most mito values are at or near zero, which is the expected regime for nuclei. The implementation warns when fewer than two components are found [R11].

**Proposed nucleus mito model (proposed; not a published model).**

$$M_i\mid N_i\sim\mathrm{Binomial}\bigl(N_i,\ \rho_i\,\pi_{\text{cyt}}+(1-\rho_i)\,\epsilon\bigr).$$

$M_i$ is the mito UMI count. The estimand of $\rho_i$ is the fraction of the nucleus's mito signal that comes from residual cytoplasm; $\pi_{\text{cyt}}$ and $\epsilon$ are the mito shares of cytoplasmic mRNA and of ambient RNA. Regime: independent UMI draws. Overdispersion from ambient profile variation is absent, and a zero-inflated extension is needed for the excess zeros.

**Estimands.** One sentence each.

- `keep_cell`: whether nucleus $i$ passes the rule, decided from its own metrics and its sample's thresholds only.
- `qc_nuclear_fraction`: $\mathrm{NF}_i$ as above, undefined when $I_i+E_i=0$.
- `qc_flag_reason`: the set of rules that fired for nucleus $i$, joined by semicolons.
- `qc_posterior_compromised`: $q_i$, the miQC posterior.
- Consistency label $\mathrm{conf}_i\in[0,1]$: the maximum class posterior of a label-transfer classifier trained on matched cell profiles from other donors, using no QC covariate.
- False-flag rate $\mathrm{FFR}_c$: the fraction of nuclei with $\mathrm{conf}_i\ge c$ that a filter flags, so the denominator contains confident nuclei only.
- Planted label: 1 if the generator compromised nucleus $i$, else 0; AUROC compares the filter's continuous score with it.
- Activation SMD: the difference in mean activation score between kept and removed nuclei of one type, divided by the pooled standard deviation of the score within that type.

**Assumptions and failure modes by family.** Heuristic MAD rules assume one unimodal bulk per sample; they fail on tied values, on small samples and where the floor sets the threshold. Cell-derived rules assume that cell and nucleus distributions coincide; they fail on the sign of the nuclear-fraction term, because the damaged-cell convention reads high fraction as damage [R12] while intact nuclei have high fraction by construction, and they fail on mito cutoffs that sit above the nucleus baseline [R5]. Model-based mixtures assume two components of roughly Gaussian shape; they fail when mito is mostly zero. Classifiers inherit the bias of their labels: dropkick's default labels use only gene counts [R13], so the classifier can learn a gene-count proxy and remove small-RNA nuclei types.

**Why heuristics work and what a model adds.** Per-sample MAD rules are robust, need no tuning and adapt to each library, which is why they are the nucleus practice [R1]. A rule returns no probability, pools nothing across samples and cannot use nuclear fraction as a prior. The mixture adds $q_i$, which turns the threshold into an explicit posterior decision, and it can share parameters across samples. Its calibration holds only if the component family fits; benchmark B2 measures this.

**Do cell-based thresholds flag healthy nuclei?** By mechanism, yes for any rule that treats high nuclear fraction as damage, because intact nuclei have high intronic share by construction. For mito cutoffs the answer depends on the intact-nucleus baseline. A cell-derived cutoff flags intact nuclei wherever that baseline lies above the cutoff, and the literature does not quantify the baseline for nuclei [R1, R5]. The size of the error is not measured for either term; benchmark B1 addresses it.

**Pitfalls shown by benchmark studies.** Dissociation and storage choices introduce biases in both single-cell and single-nucleus workflows [R9]. Nuclei under-represent activation-associated genes [R10], so a filter that removes nuclei with low gene counts can also remove activation-like profiles and bias the biology that follows.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Per-sample MAD outlier rules on log counts, log genes and mito percent | heuristic | flags values beyond the median by $\max(n\,\mathrm{MAD},\ \delta)$, with a 0.5 percentage-point mito floor for nuclei | [R1] |
| Fixed mito percent cutoff, with a logit-scale MAD in the best-practice rule | heuristic | flags barcodes above a constant chosen by tissue or protocol; the best-practice rule requires a 3-MAD logit outlier and a percent above 8 | [R2], [R4], [R5] |
| DropletQC nuclear fraction and UMI gating | hybrid | one- or two-component mixture per cell type (mclust model EEI) on nuclear fraction and log UMI, flags damaged barcodes | [R12] |
| miQC mito-versus-detected mixture | model-based | two-component linear regression mixture; removes barcodes whose compromised posterior exceeds 0.75 | [R11] |
| dropkick elastic-net classifier | hybrid | logistic elastic net on highly variable genes, trained on labels from thresholds on gene counts | [R13] |

The published standard for nuclei is the per-sample MAD rule with a mito floor [R1]. The best-practice book uses a logit-scale MAD with a fixed 8 percent cutoff and attributes that combined rule to pipeComp [R2, R4]. The model-based and classifier methods were designed for droplets or cells [R11, R12, R13].

| Method | Parameter | Value | Source |
|---|---|---|---|
| MAD (scuttle) | nmads default | 3 | scuttle R/isOutlier.R:91 @ d3476eb |
| MAD (scuttle) | min.diff default | NA (floor off) | scuttle R/isOutlier.R:93 @ d3476eb |
| MAD (scuttle) | threshold distance | max(min.diff, nmads × MAD) | scuttle R/isOutlier.R:188 @ d3476eb |
| MAD (scuttle) | scale constant | formals(mad)$constant, 1.4826 | scuttle R/isOutlier.R:181 @ d3476eb |
| MAD (best practice) | nmads for log counts, log genes, top-20 fraction | 5 | preprocessing_visualization/quality_control.ipynb cell 24 @ d581689 |
| MAD (OSCA nuclei) | mito min.diff | 0.5 percentage points | nuclei-analysis.Rmd:33-58 @ 2f10501 |
| Logit mito (best practice) | pseudocount | (MT + 1) / (total + 2) | quality_control.ipynb cell 22 @ d581689 |
| Logit mito (best practice) | MAD and fixed cutoff | 3 MADs upper tail, and percent above 8 | quality_control.ipynb cell 24 @ d581689 |
| Fixed mito (toolkit) | cutoff for nuclei | 3 percent, unbenchmarked | catalogue entry qc.single_nucleus_quality_filtering |
| DropletQC empty rule | nf_rescue, umi_rescue | 0.05, 1000 (not used here) | R/identify_empty_drops.R:45-46 @ 5d7dadc |
| DropletQC damaged rule | nf_sep, umi_sep_perc | 0.15, 50 | R/identify_damaged_cells.R:258-259 @ 5d7dadc |
| DropletQC damaged rule | mixture | G = 1:2, modelNames EEI | R/identify_damaged_cells.R:332 @ 5d7dadc |
| miQC | model_type | linear, flexmix with k = 2 | R/mixtureModel.R:47, 51-53 @ a31358e |
| miQC | posterior_cutoff | 0.75, keep when at or below | R/filterCells.R:54, 77 @ a31358e |
| miQC | keep_all_below_boundary, enforce_left_cutoff | TRUE, TRUE | R/filterCells.R:54-55 @ a31358e |
| dropkick | min_genes, mito_names, n_hvgs | 50, ^mt- or ^MT-, 2000 | dropkick/api.py:29, 31, 34 @ bd2647a |
| dropkick | training labels | multi-Otsu, above, arcsinh n_genes_by_counts | dropkick/api.py:194-199; dropkick/__main__.py:173 @ bd2647a |
| dropkick | LogitNet | standardize False, log loss, 5 folds, 100 lambdas | dropkick/api.py:560-575 @ bd2647a |
| STARsolo (input) | soloFeatures | Gene; GeneFull variants optional | extras/doc-latex/parametersDefault.tex:993-1001 @ b1edc12 |
| kb_python (input) | workflows with intronic counts | lamanno, nucleus | kb_python/main.py:291, 653 @ 188d9c7 |

## 5. Proposed singlet approach

**Routes.** mad_outlier and fixed_mito_cutoff are reimplemented, because each is a closed formula (see section 12). miqc_mixture and dropletqc_nf are ported (see section 12), so the EM and gating code follows the originals. dropkick is ported as a comparator, not as a default. STARsolo and kb_python are external input steps reached through the ingest-quant tasks [R15, R16, R17] and are not ported. The default is mad_outlier with covariate_mode covariate, the published nucleus standard [R1].

**Proposed model.** The model-based candidate is a per-sample mixture over log UMI, log genes, mito percent with a zero-inflated component, and nuclear fraction, fitted by EM. Nuclear fraction has a cell-type-conditioned prior, so high fraction in a cell type with long pre-mRNA is not read as damage. The posterior replaces the hard thresholds. It enters the MCP enum only after implementation and benchmarking. It is falsified if, on held-out donors in B1, it does not lower FFR at 0.9 below the mad_outlier value at per-type retention of at least 0.95, or if its calibration on planted labels in B2 is worse than the MAD rule's.

**ML stack.** The mixture has few parameters and sits on the hot path, so EM and the per-nucleus sparse aggregation are hard-coded in CUDA with cuSPARSE. PyTorch is reserved for a variational variant with a learned cell-type prior, which is not planned for the first release. The dropkick port uses coordinate descent on sparse features.

**Core kernels and devices.** Per-sample median and MAD use selection, linear on average per metric. Two-component EM with diagonal covariance costs O(nKd) per iteration. Exonic and intronic totals are sparse row sums. The CPU path vectorises over nuclei; the CUDA path assigns one block per sample. Streaming is not claimed, because per-sample medians need all values, although a sketch could approximate them.

**Defaults an agent should use without asking.** method mad_outlier; nmads_counts 5, nmads_genes 5, nmads_mito 3; mito_min_diff 0.5 percentage points; sample_key set to the donor or library column; covariate_mode covariate; quantification recorded. The 5-MAD count and gene thresholds follow the best-practice notebook [R2]; the 3-MAD mito default matches scuttle's default and the OSCA nuclei call [R1]. Nuclei are never removed by nuclear fraction unless remove_flagged is set deliberately.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | total UMI counts per nucleus, exonic plus intronic |
| read | layers/exonic | sparse int | exonic UMI counts under the stated quantification |
| read | layers/intronic | sparse int | intronic UMI counts; the name is set by nucleus_inputs.intronic_layer |
| read | var/mito | bool | mitochondrial genes matched by nucleus_inputs.mito_regex |
| read | obs/sample (named by nucleus_inputs.sample_key) | category | sample of each nucleus; thresholds are computed within each sample |
| write | obs/keep_cell | bool | keep flag, shared with cell-level QC so downstream tasks need no branch |
| write | obs/qc_nuclear_fraction | float32 | intronic share of UMIs; undefined when a nucleus has no exonic or intronic UMIs |
| write | obs/qc_flag_reason | category | rules that flagged the nucleus, joined by semicolons; empty when kept |
| write | obs/qc_posterior_compromised | float32 | miQC posterior of the compromised component; miqc_mixture only |
| write | uns/qc_nucleus_thresholds | dict | per-sample thresholds and fixed cutoffs applied |
| write | uns/qc_nucleus_params | dict | parameters used, quantification label and covariate mode |
| write | models/nucleus_qc | dict | fitted miQC or dropkick parameters, when those methods are used |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "mad_outlier" | `mad_outlier`, `fixed_mito_cutoff`, `miqc_mixture`, `dropletqc_nf`, `dropkick` | Filter rule. mad_outlier is the default and published nucleus standard; the others are comparators. |
| `nucleus_inputs` | object | — | — | Column and layer mapping for nucleus inputs; applies to every method. |
| `nucleus_inputs.intronic_layer` | string | "intronic" | — | Layer holding intronic (pre-mRNA) UMI counts per nucleus. |
| `nucleus_inputs.sample_key` | string | "sample" | — | obs column naming samples; thresholds are computed within each sample. |
| `nucleus_inputs.mito_regex` | string | "^mt-\|^MT-" | — | Gene-name pattern identifying mitochondrial genes. |
| `nucleus_inputs.quantification` | string | "unspecified" | — | Pipeline and feature set that produced the intronic counts, such as STARsolo GeneFull; recorded in uns. |
| `nucleus_inputs.covariate_mode` | string | "covariate" | `covariate`, `none` | covariate stores nuclear fraction and never flags on it; none skips computing it. |
| `mad_outlier` | object | — | — | Per-sample MAD rules; a nucleus is flagged beyond the median by max(nmads times MAD, min diff). |
| `mad_outlier.nmads_counts` | number | 5 | min 0 | MADs from the median for log total counts, both tails. |
| `mad_outlier.nmads_genes` | number | 5 | min 0 | MADs from the median for log genes detected, both tails. |
| `mad_outlier.nmads_mito` | number | 3 | min 0 | MADs above the median for mito percent, upper tail only. |
| `mad_outlier.mito_min_diff` | number | 0.5 | min 0 | Minimum distance above the median for mito outliers, in percentage points. |
| `fixed_mito_cutoff` | object | — | — | Single mito percent cutoff, used when method is fixed_mito_cutoff. |
| `fixed_mito_cutoff.cutoff_percent` | number | 3 | min 0; max 100 | Mito percent cutoff; the default is an unbenchmarked toolkit value for nuclei. |
| `miqc_mixture` | object | — | — | Two-component mixture of mito percent on detected genes, used when method is miqc_mixture. |
| `miqc_mixture.posterior_cutoff` | number | 0.75 | min 0; max 1 | Largest posterior probability of the compromised component that is kept. |
| `dropletqc_nf` | object | — | — | DropletQC damaged-cell gating on nuclear fraction and UMI, cell convention; used when method is dropletqc_nf. |
| `dropletqc_nf.nf_sep` | number | 0.15 | min 0; max 1 | Nuclear fraction separation for damaged calls, cell convention. |
| `dropletqc_nf.umi_sep_perc` | number | 50 | min 0; max 100 | UMI percentile separating damaged from intact calls, cell convention. |
| `dropletqc_nf.remove_flagged` | boolean | false | — | Remove nuclei flagged as damaged; off by default because the convention inverts for nuclei. |
| `dropkick` | object | — | — | Elastic-net logistic classifier trained on heuristic labels; kept for comparison. |
| `dropkick.min_genes` | integer | 50 | min 0 | Minimum genes per barcode before classification. |
| `dropkick.n_hvgs` | integer | 2000 | min 1 | Highly variable genes used as classifier features. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for miqc_mixture and dropkick fits; mad_outlier and fixed_mito_cutoff are deterministic. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

**Rules that span parameters.** mad_outlier, fixed_mito_cutoff, miqc_mixture, dropletqc_nf and dropkick each read only their own object. The others are ignored and listed as unused in uns/qc_nucleus_params. nucleus_inputs applies to every method. A quantification of unspecified makes nuclear fraction non-comparable across datasets, so it should always be set. Thresholds are dataset-specific and are never transferred. remove_flagged is the only setting that removes nuclei on the basis of nuclear fraction. The call fails when the intronic layer is missing and covariate_mode is covariate.

## 7. MCP tool

Tool name `singlet_qc_single_nucleus_quality_filtering` (definition in `tasks/mcp/singlet_qc_single_nucleus_quality_filtering.json`). Example call:

```json
{
  "dataset": "/data/kidney_snrna.singlet",
  "method": "mad_outlier",
  "nucleus_inputs": {"sample_key": "donor", "quantification": "STARsolo GeneFull"}
}
```

Example result:

```json
{
  "dataset": "/data/kidney_snrna.singlet",
  "status": "completed",
  "wrote": ["obs/keep_cell", "obs/qc_nuclear_fraction", "obs/qc_flag_reason", "uns/qc_nucleus_thresholds", "uns/qc_nucleus_params"],
  "summary": {"method": "mad_outlier", "n_nuclei": "<int>", "n_kept": "<int>", "flags_by_reason": {"counts": "<int>", "genes": "<int>", "mito": "<int>"}},
  "provenance_id": "<id>",
  "job_id": null
}
```

Long-running: mad_outlier and fixed_mito_cutoff finish inline; miqc_mixture and dropkick may return queued on large inputs. Stochastic: only miqc_mixture and dropkick, which take the seed; the other methods are deterministic. Dry run: returns estimated seconds, peak memory and device from the nucleus count and method, without writing.

## 8. Benchmarks

**Shared protocol.** All benchmarks split by donor or sample. Any threshold, mixture or classifier is fitted on training donors only and applied unchanged to held-out donors. Normalisation, feature selection, PCA, neighbours and Leiden clustering at a fixed resolution are identical for every filter, with fixed seeds. Results are reported per donor with the spread across donors. Filters are not tuned per cell type. Targets labelled proposed are set before any filter is evaluated and are not literature values.

### B1. Matched cell-nucleus consistency and per-type retention

- **Goal**: choose a nucleus filter that removes compromised nuclei without removing whole cell types or intact nuclei.
- **Ground truth**: consistency. $\mathrm{conf}_i$ is the maximum class posterior of a label-transfer classifier trained on matched cell profiles from other donors, with no QC covariate. A nucleus with $\mathrm{conf}_i\ge 0.9$ is treated as intact; this is a proxy, not a quality label.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Bakken et al. 2018, matched cortical cell and nucleus profiles | [R7]; accession — | cortex, single-nucleus and single-cell, matched by cell type; species and size — | — | donor labels define the split |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| FFR_0.9 | flagged share of nuclei with conf at least 0.9, per held-out donor | lower | guardrail | — |
| per_type_retention_min | minimum over types with at least 50 nuclei of kept divided by total | higher | primary | — |
| residual_mito_kept | median pct_mito over kept nuclei, in percent | lower | guardrail | [R1] |
| cluster_ARI_vs_reference | adjusted Rand index, on kept nuclei with a matched profile, between Leiden labels and the profile's reference cluster | higher | primary | — |

- **Comparators**: no filter; mad_outlier (nmads 3 and 5); fixed_mito_cutoff (3, 5 and 8 percent); dropletqc_nf (remove_flagged off and on); miqc_mixture (0.75); dropkick (default labels); mad_outlier defaults with covariate_mode covariate (the proposed rule).
- **Protocol**: shared protocol above; one embedding for all filters.
- **Acceptance criterion**: proposed design targets, not literature values. FFR_0.9 at most 0.02; per_type_retention_min at least 0.95; residual_mito_kept median at most 0.5 percent; cluster_ARI at least the no-filter value minus 0.01.
- **Known pitfalls**: confidence must not use QC covariates or the filter's thresholds, or FFR is circular. Reference cells carry dissociation bias [R9].

### B2. Planted damage and ambient simulation

- **Goal**: check that each filter recovers planted compromised nuclei as severity changes.
- **Ground truth**: planted simulation; the label is 1 when the generator compromises a nucleus. Severity is $\rho$ (residual cytoplasmic share) and $\epsilon$ (ambient mito share), on fixed grids.
- **Generator recipe** (proposed):
  1. Take UMI totals and cluster profiles from the seed matrix.
  2. Draw nuclear fraction from a cluster-specific Beta distribution with fixed concentration.
  3. Draw exonic and intronic UMIs multinomially from the total and that fraction.
  4. Plant compromised nuclei (fixed prevalence) by moving a fraction $\rho$ of exonic UMIs to mito genes.
  5. Add ambient UMIs with mito share $\epsilon$; keep the planted label.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| WuKidney sNuc-10x subset (Bioconductor scRNAseq) | loading code [R1]; origin [R8] | snRNA-seq, mouse kidney, healthy and fibrotic; cells — | — | seed of profiles and depths |
| Generator output | simulated; accession not applicable | design parameters | not applicable | labels exact by construction |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| auroc_planted | AUROC against the planted label of $q_i$ (miqc_mixture) or MAD distance (mad_outlier) | higher | primary | — |
| fdr_planted | planted share of flagged nuclei at the default threshold | lower | primary | — |
| threshold_stability | standard deviation of the chosen threshold across 10 seeds | lower | guardrail | — |

- **Comparators**: mad_outlier; miqc_mixture; dropletqc_nf; dropkick.
- **Protocol**: grids for $\rho$, $\epsilon$ and prevalence fixed before any filter is applied; 10 seeds; fixed seed matrix; same simulated sets for all filters.
- **Acceptance criterion**: proposed design target, not literature. auroc_planted at least 0.9 at every severity where compromised and intact nuclei differ by at least 2 MADs of intact nuclei.
- **Known pitfalls**: the generator defines the labels, so a filter that mirrors it wins by construction. Simulated nuclei lack real correlations between fraction, cell type and gene length.

### B3. Activation-program bias guardrail

- **Goal**: test whether a filter removes nuclei preferentially by activation-like composition within a cell type, which would bias the biology.
- **Ground truth**: orthogonal measurement used as an expected bias direction. The score for nucleus $i$ is the mean of z-scored log-normalised expression over the depleted gene set reported for nuclei in [R10], computed before filtering.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Human microglia, single-cell and single-nucleus comparison | [R10]; accession — | single cells and nuclei, human microglia, four donors; size — | — | source of the depleted gene set |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| activation_score_smd | standardised mean difference of the score between kept and removed nuclei within each type, absolute value averaged over types with at least 50 nuclei | closer to zero | primary | [R10] |

- **Comparators**: each filter in B1.
- **Protocol**: score on normalised data before filtering; comparison within annotated types; average over types with at least 50 nuclei.
- **Acceptance criterion**: proposed design target, not literature. Absolute SMD at most 0.2 for every filter.
- **Known pitfalls**: the depleted set is a bias direction, not a truth label, and real activation states can also be low in nuclei. Gene-count thresholds correlate with the score, so this guardrail is confounded with B1.

### P1. Performance and scaling

Measure wall time, peak resident memory and throughput (nuclei per second) at 10,000, 100,000 and 1,000,000 nuclei on CPU and CUDA, for each comparator in B1 and for singlet's CPU and CUDA code paths. Hold fixed the sparse CSR input, the gene set, the seeds and the thread counts: one thread for single-threaded tools and eight for multi-threaded tools. Repeat each measurement three times and report the median next to the B1 agreement with the reference flags. DropletQC's BAM-based nuclear fraction is I/O-bound and is reported separately. These scales are design choices, not dataset sizes.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `cell-calling.nucleus_vs_empty_calling`: Nucleus versus empty-droplet calling in single-nucleus RNA-seq
  - `ingest-quant.intron_inclusive_gene_counting`: Intron-inclusive (gene versus gene-full) counting and pre-mRNA references for nuclei
- **Feeds**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `doublets.expression_doublet_scoring`: Expression-based per-cell doublet scoring
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
- **Reads**: `layers/counts`, `layers/exonic`, `layers/intronic`, `var/mito`, `obs/<sample_key>`
- **Writes**: `obs/keep_cell`, `obs/qc_nuclear_fraction`, `obs/qc_flag_reason`, `obs/qc_posterior_compromised`, `uns/qc_nucleus_thresholds`, `uns/qc_nucleus_params`, `models/nucleus_qc`
<!-- CHAINING:AUTO:END -->

Nucleus preprocessing: intron-aware counting, nucleus-versus-empty calling, then this QC step, before normalisation and doublet scoring.

## 10. Risks, pitfalls and open questions

- **Unchecked details.** The Osorio and Cai record [R5] was not found in the local index or by search, so its volume, pages and DOI are omitted and its tissue claims are unconfirmed. Thrupp et al. [R10] was checked through a search summary only, which reports about 1 percent of genes depleted in nuclei; the gene list was not checked. The Wu et al. record [R8] could not be found locally or by search and is cited without DOI. The Denisenko et al. record [R9] was confirmed by search for its DOI and venue, and its findings were checked only through the abstract summary. The best-practice review [R3] was checked for its bibliographic record only. pipeComp's support for the combined mito rule [R4] was not checked; the best-practice notebook [R2] attributes the rule to pipeComp and is the only source for it. The Bakken et al. platform, species, size, accession and UMI basis, the WuKidney cell count, and the donor labels used for the split are unknown.
- **Unsettled literature.** Whether nuclear fraction is a covariate, a regressor or a filter; whether intact nuclei carry near-zero mito across tissues, which OSCA states as reasoning [R1]; and how the fraction depends on Gene versus GeneFull counting and on the overlap rule [R15, R18].
- **Technical risks.** Zero-inflated mito collapses the MAD and leaves the 0.5-point floor in charge. miQC's Gaussian components are assumed to be the flexmix default, and the code warns when fewer than two components appear [R11]. Per-sample MADs are unstable in small samples; scuttle's share.mads option is the batch-aware alternative (scuttle R/isOutlier.R:93). Ambient contamination adds exonic and intronic reads and shifts both fraction and mito [R1], and its ordering against ambient correction [R19, R20] and cell calling [R14] is unresolved.
- **Benchmark validity.** Consistency labels depend on dissociation bias [R9], on matched profiles from different donors, and on the label-transfer model. B3's gene list reflects one study and may be partly biology rather than bias.
- **First experiment.** On the Bakken et al. matched design, compute nuclear fraction under Gene and GeneFull counting, the mito and fraction distributions per cell type, and FFR and retention for mad_outlier and dropletqc_nf with remove_flagged off and on. Decide the fraction's role from that result before B2 and B3.

## 11. References

R1. Amezquita RA, Lun ATL, Hicks SC, Gottardo R, Geistlinger L, et al. Orchestrating single-cell analysis with Bioconductor, nuclei analysis chapter (OSCA.advanced repository, commit 2f10501). — verified (corpus)
R2. Single-cell best-practices authors. Quality control chapter, preprocessing_visualization/quality_control.ipynb (theislab/single-cell-best-practices, commit d581689). — verified (repo)
R3. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R4. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)
R5. Osorio D, Cai JJ. Systematic determination of the mitochondrial proportion in human and mice tissues for single-cell RNA-sequencing data quality control. *Bioinformatics* 2021. — unverified (memory)
R6. Ding J, Adiconis X, Simmons SK, et al. Systematic comparison of single-cell and single-nucleus RNA-sequencing methods. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0465-8 — verified (corpus)
R7. Bakken TE, Hodge RD, Miller JA, et al. Single-nucleus and single-cell transcriptomes compared in matched cortical cell types. *PLoS ONE* 2018. doi:10.1371/journal.pone.0209648 — verified (corpus)
R8. Wu H, Kirita Y, Donnelly EL, Humphreys BD. Advantages of single-nucleus over single-cell RNA sequencing of adult kidney: rare cell types and novel cell states revealed in fibrosis. *Journal of the American Society of Nephrology* 2019;30(1):23-32. — unverified (memory)
R9. Denisenko E, et al. Systematic assessment of tissue dissociation and storage biases in single-cell and single-nucleus RNA-seq workflows. *Genome Biology* 2020;21:130. doi:10.1186/s13059-020-02048-6 — verified (search)
R10. Thrupp N, et al. Single-nucleus RNA-seq is not suitable for detection of microglial activation genes in humans. *Cell Reports* 2020;32(13):108189. doi:10.1016/j.celrep.2020.108189 — verified (search)
R11. Hippen AA, Falco MM, Weber LM, et al. miQC: an adaptive probabilistic framework for quality control of single-cell RNA-sequencing data. *PLoS Computational Biology* 2021. doi:10.1371/journal.pcbi.1009290 — verified (corpus)
R12. Muskovic W, Powell JE. DropletQC: improved identification of empty droplets and damaged cells in single-cell RNA-seq data. *Genome Biology* 2021. doi:10.1186/s13059-021-02547-0 — verified (corpus)
R13. Heiser CN, Wang VM, Chen B, Hughey JJ, Lau KS. Automated quality control and cell identification of droplet-based single-cell data using dropkick. *Genome Research* 2021. doi:10.1101/gr.271908.120 — verified (corpus)
R14. Lun ATL, Riesenfeld S, Andrews T, Dao TP, Gomes T, Marioni JC. EmptyDrops: distinguishing cells from empty droplets in droplet-based single-cell RNA sequencing data. *Genome Biology* 2019. doi:10.1186/s13059-019-1662-y — verified (corpus)
R15. Kaminow B, Yunusov D, Dobin A. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021. doi:10.1101/2021.05.05.442755 — verified (corpus)
R16. Melsted P, Booeshaghi AS, Liu L, et al. Modular, efficient and constant-memory single-cell RNA-seq preprocessing. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00870-2 — verified (corpus)
R17. La Manno G, Soldatov R, Zeisel A, et al. RNA velocity of single cells. *Nature* 2018. doi:10.1038/s41586-018-0414-6 — verified (corpus)
R18. Soneson C, Srivastava A, Patro R, Stadler MB. Preprocessing choices affect RNA velocity results for droplet scRNA-seq data. *PLoS Computational Biology* 2021;17(1):e1008585. — verified (corpus)
R19. Fleming SJ, et al. Unsupervised removal of systematic background noise from droplet-based single-cell experiments using CellBender. *Nature Methods* 2023. doi:10.1038/s41592-023-01943-7 — verified (corpus)
R20. Young MD, Behjati S. SoupX removes ambient RNA contamination from droplet-based single-cell RNA sequencing data. *GigaScience* 2020. doi:10.1093/gigascience/giaa151 — verified (corpus)
R21. Single-cell best-practices authors. Raw data processing chapter, introduction/raw_data_processing.md (theislab/single-cell-best-practices, commit d581689). — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/LTLA/scuttle | Aaron Lun (aut, cre); Davis McCarthy (aut) | GPL-3 (DESCRIPTION; no LICENSE file at the root) | per-sample MAD rule (isOutlier) | reimplement |
| https://github.com/greenelab/miQC | Ariel Hippen (aut, cre); Stephanie Hicks (aut) | BSD 3-Clause (LICENSE) | mito-versus-detected mixture | port |
| https://github.com/powellgenomicslab/DropletQC | Walter Muskovic (aut, cre) | MIT (DESCRIPTION; LICENSE and LICENSE.md) | nuclear-fraction damaged-cell gating | port |
| https://github.com/KenLauLab/dropkick | Cody Heiser (setup.py author) | MIT (LICENSE) | elastic-net classifier, comparator | port |
| https://github.com/OSCA-source/OSCA.advanced | Robert Amezquita, Aaron Lun, Stephanie Hicks, Raphael Gottardo, Ludwig Geistlinger (cre), Peter Hickey (ctb) | CC BY 4.0 (DESCRIPTION) | nuclei chapter, mito rule and seed data source | callout |
| https://github.com/theislab/single-cell-best-practices | Theislab (LICENSE copyright 2021) | Apache-2.0 (LICENSE) | notebook rules and QC text | callout |
| https://github.com/alexdobin/STAR | Alexander Dobin | MIT (LICENSE) | STARsolo GeneFull intronic counts, external input | callout |
| https://github.com/pachterlab/kb_python | Kyung Hoi (Joseph) Min (setup.py author) | BSD 2-Clause (LICENSE) | nucleus and lamanno intronic counts, external input | callout |

No benchmark dataset licence is confirmed, so derived benchmark files are not redistributed. The OSCA text is CC BY 4.0 and is not copied.
