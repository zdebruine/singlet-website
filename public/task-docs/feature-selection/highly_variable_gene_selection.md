---
id: feature-selection.highly_variable_gene_selection
title: Unsupervised highly variable gene selection for clustering and embedding
area: feature-selection
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [qc.low_quality_cell_detection, harmonization.count_matrix_state_detection, normalization.size_factor_estimation]
feeds: [dim-reduction.normalized_cell_embedding, integration.batch_corrected_embedding, feature-selection.number_of_features, feature-selection.selected_feature_stability]
reads: [layers/counts, layers/log1p_norm, obs/<batch_key>]
writes: [var/highly_variable, var/hvg_score, var/hvg_rank, var/means, var/variances, uns/hvg]
devices: [cpu, cuda]
mcp_tool: singlet_feature_selection_highly_variable_gene_selection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Unsupervised highly variable gene selection for clustering and embedding

> Choose the few thousand genes that feed PCA, neighbour graphs and clustering by scoring each gene against a technical null, with a model-based default and the published selectors kept as comparators.

## 1. Question

Given a cells-by-genes matrix (raw UMI counts for the count-based statistics, log-normalised values for the dispersion and scran flavours) and a target size $N$, which $N$ genes, ranked by a per-gene variability, deviance or residual statistic, best preserve cell-type structure after PCA, neighbour-graph construction and clustering? A correct answer is a gene set whose embedding recovers reference partitions or planted structure and which does not favour genes that vary only with sequencing depth or detection rate. The proxies used in section 8 are planted structure, author annotations, and technical-only counts that test the null [R2].

## 2. Why this task matters and where the field stands

Gene selection converts a count matrix into the input of the PCA, neighbour graph and clustering that define cell types in most workflows, so every downstream representation depends on the genes kept. A selection dominated by depth or detection-rate effects changes which cell types are separable and which genes appear as markers.

The field is **contested**. Selectors differ in the technical null they assume: constant-rate multinomial sampling (binomial deviance [R2, R4]); a fitted trend of variance or dispersion on mean (Seurat v3, scran and the Brennecke-style test [R10, R11, R16]); a negative-binomial offset model with one shared overdispersion (Pearson residuals [R12]) or a regularised per-gene one (sctransform [R13, R14]); a dropout-versus-mean curve (M3Drop [R15]); and binned normalised dispersion without a likelihood (Seurat v1, Cell Ranger [R8, R9]).

Benchmarks disagree on what to reward. Zhao et al. evaluate 21 baseline and 26 hybrid selectors on 7 cell-sorting, 7 CITE-seq and 5 multiome datasets [R1]; Zappia et al. measure how selection affects integration and query mapping on ten datasets [R19]; Sheng and Li review 17 methods under one notation [R3]. Whether any selector dominates across datasets and criteria is open. Named open problems:

- **Mean dependence.** In the best-practices worked example, genes with high mean expression are selected as highly deviant [R5], while dispersion selectors use bins to offset the mean trend. Which correction removes mean bias without removing biology is unsettled.
- **Pseudocount.** Log-scale dispersions depend on the pseudocount and normalisation; count statistics avoid it [R2, R5].
- **Zero inflation.** Droplet UMI data have been argued not to need zero-inflated models [R6]; a correspondence agrees for UMI data and objects to a platform-dependence reading [R7].
- **Label circularity.** A benchmark is circular when its reference labels come from clustering on the same HVG pipeline.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $G$, $n$ | genes; cells in the batch being scored |
| $N$ | genes kept (`n_top_genes`), a count of genes |
| $x_{gc}$, $n_c$ | UMI count of gene $g$ in cell $c$; library size $\sum_g x_{gc}$ |
| $p_g$, $\mu_{gc}$ | gene proportion $\sum_c x_{gc}/\sum_{gc} x_{gc}$; expected count, $\mu_{gc}=n_c p_g$ in the count models |
| $\theta$, $\phi$ | negative-binomial size and dispersion, $\phi=1/\theta$ |
| $\bar x_g$, $\hat\sigma_g$ | batch mean of gene $g$; standard deviation read from a fitted trend |

**Null models.** Each selector scores a gene by its departure from a technical null. For one gene under negative-binomial sampling with constant depth-adjusted mean $\mu$ (first-order regime, moments conditional on depth),

$$\mathrm{Var}(x)=\mu+\phi\mu^{2},\qquad \mathrm{CV}^{2}=\frac{\sigma^{2}}{\mu^{2}}=\frac{1}{\mu}+\phi ,\tag{1}$$

with $\phi=0$ the Poisson limit. A trend method fits $\hat\sigma^2_{\mathrm{tech}}(\bar x_g)$ over all genes and reports $\sigma^2_{\mathrm{bio},g}=\sigma^2_g-\hat\sigma^2_{\mathrm{tech}}(\bar x_g)$ (2). This is identifiable only if most genes carry technical variation alone; otherwise the trend absorbs biology and $\sigma^2_{\mathrm{bio}}$ shrinks for the genes of interest. scran applies it to log-normalised values [R11].

**Seurat v3.** The statistic fits a loess curve $\hat f$ of $\log_{10}$ variance on $\log_{10}$ mean of raw counts, sets $\hat\sigma_g=\sqrt{10^{\hat f(\log_{10}\bar x_g)}}$ and clips counts at $\bar x_g+\sqrt{n}\,\hat\sigma_g$ [R10]:

$$\tilde v_g=\frac{1}{(n-1)\hat\sigma_g^{2}}\sum_{c}\Bigl(\min\bigl(x_{gc},\bar x_g+\sqrt{n}\,\hat\sigma_g\bigr)-\bar x_g\Bigr)^{2}.\tag{3}$$

Every zero entry contributes exactly $\bar x_g^{2}$, so the sum visits only non-zero entries. The clip level grows with $\sqrt{n}$, so ranks depend on the number of cells per batch.

**Analytic Pearson residuals.** With $\mu_{gc}=n_c p_g$ and a shared fixed $\theta$,

$$r_{gc}=\frac{x_{gc}-\mu_{gc}}{\sqrt{\mu_{gc}+\mu_{gc}^{2}/\theta}},\tag{4}$$

clipped to $[-\sqrt{n},\sqrt{n}]$; the score is the variance of the clipped residuals across the cells of a batch [R12]. When $\mu_{gc}\ll\theta$ the denominator reduces to $\sqrt{\mu_{gc}}$ and most genes are scored on a Poisson scale, so strongly overdispersed biological genes can be mis-scored. The residual denominator varies by cell, so the clipped residuals need not average to zero and the mean is subtracted before the variance. The zero-entry term depends on each cell's library size and has no closed sparse form.

**Binomial deviance.** Under a constant-rate multinomial null the fitted mean is $\hat\mu_{gc}=n_c\hat p_g$ and the binomial approximation to the deviance (valid for small $p_g$) is

$$D_g=2\sum_{c}\Bigl[x_{gc}\log\frac{x_{gc}}{\hat\mu_{gc}}+(n_c-x_{gc})\log\frac{n_c-x_{gc}}{n_c-\hat\mu_{gc}}\Bigr],\quad 0\log0=0.\tag{5}$$

A zero entry contributes $-2n_c\log(1-\hat p_g)$, so the zero cells add $-2\log(1-\hat p_g)\sum_{c:x_{gc}=0}n_c$, exact whenever $\hat p_g<1$ [R2]. The Poisson option is documented as faster and often very similar.

**Regularised and dropout models.** sctransform regresses each gene's counts on sequencing depth with negative-binomial errors and regularised parameters [R13]; version 2 fixes the depth slope (a library-size offset) and learns only intercept and $\theta$ [R14]. M3Drop fits a Michaelis-Menten curve of dropout rate on mean expression, with depth-adjusted negative-binomial variants [R15, R16].

**Binned dispersion (heuristic).** Seurat v1 z-scores the log dispersion $\mathrm{var}/\text{mean}$ (computed on the expm1 scale) within 20 equal-width bins of log mean [R8]. Cell Ranger normalises the dispersion of the given layer by the bin median and median absolute deviation within 20 percentile bins [R9]. Both are likelihood-free and rely on bins to remove the mean trend; in scanpy's Seurat v1 flavour a bin holding one gene is post-processed to a normalised dispersion of 1, so $n_{\text{bins}}$ changes the result.

**Proposed singlet model.** An empirical-Bayes negative-binomial model with a fitted technical trend $\tau$ and a point-mass-plus-slab prior on excess dispersion (a proposal, not established in the sources):

$$x_{gc}\sim\mathrm{NB}(n_c\beta_g,\phi_g),\quad \log\phi_g=\tau(\log\beta_g)+\Delta_g,\quad \Delta_g\sim\pi_0\delta_0+(1-\pi_0)h(\Delta).\tag{6}$$

Genes are ranked by the posterior mean of $\Delta_g$; $P_g=\Pr(\Delta_g\neq0\mid\mathbf X)$ saturates near 1 at large $n$ and is used only for the set-level estimate of the false-discovery proportion

$$\widehat{\mathrm{FDP}}(S)=\frac{1}{|S|}\sum_{g\in S}(1-P_g).\tag{7}$$

Equation (7) is calibrated only if $\tau$ and $h$ are estimated from mostly null genes and the negative-binomial form with depth offset holds within each batch (tested by F2, section 5).

**Estimands.** `var/hvg_score` is, per flavour: normalised dispersion (`seurat`, `cell_ranger`), eq. (3) (`seurat_v3`), the variance of clipped residuals (`pearson_residuals`), eq. (5) summed over batches (`binomial_deviance`), or $\sigma^2_{\mathrm{bio}}$ averaged over batches (`scran_model_gene_var`); `var/hvg_rank` is 0 for the highest score; `var/means` and `var/variances` are the mean and sample variance ($n-1$) of the scored layer. The planted truths of section 8 are cluster labels and marker sets, whose effect is a log fold change $\delta$ on composition-normalised means.

**Failure modes.** Count nulls assume that library size is a valid proxy for technical depth and fail when biology correlates with cell size. Trend methods fail when highly variable high-abundance genes pull the trend. Binning depends on the pseudocount and bin number. The multinomial null is tested by negative controls only, which do not test gene-gene correlation or biological overdispersion [R2].

**Heuristics versus models.** Binning works because the mean-dispersion relation of technical noise is smooth, so a bin-wise z-score removes most of it with no distributional assumption and little compute. Its null is implicit, its ranks depend on bins and pseudocount, and it yields no calibrated quantity for choosing $N$. A model makes the null explicit, separates depth from biology by construction, can use batch as a covariate, and a fitted prior can be trained once and reused. Its validity is that of its null, hence the gates of section 5.

**Cost.** Moments, deviance and the clipped variance accumulate over non-zero entries in $O(\mathrm{nnz})$. scanpy's Pearson implementation loops over all cells for each gene, $O(Gn)$ per batch. The proposed model over $k$ dispersion grid values costs $O(Gnk)$, or $O(GBk)$ with $B$ library-size classes at an approximation error to be measured.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Seurat v1 dispersion (scanpy `seurat`) | heuristic | log of var/mean on the expm1 scale, z-scored within 20 equal-width bins of log1p mean | [R8] |
| Cell Ranger dispersion (scanpy `cell_ranger`) | heuristic | var/mean of the given layer, normalised by median and MAD within 20 percentile bins | [R9] |
| Seurat v3 VST (scanpy `seurat_v3`) | model-based | loess trend of log10 variance on log10 mean of raw counts; clipped, trend-standardised variance | [R10] |
| scran `modelGeneVar` | model-based | trend of variance on mean of log-normalised values; biological component is total minus trend; one-sided p-value from a normal approximation around the trend | [R11] |
| scry binomial deviance | model-based | twice the log-likelihood gap between a per-gene saturated model and a constant-rate multinomial (binomial) null with library sizes | [R2], [R4] |
| Analytic Pearson residuals (scanpy experimental) | model-based | variance of clipped Pearson residuals of a negative-binomial offset model with fixed $\theta$ | [R12] |
| sctransform | model-based | per-gene negative-binomial regression on depth with regularised parameters; residual variance per gene | [R13], [R14] |
| M3Drop | model-based | Michaelis-Menten fit of dropout rate on mean; NBumi functions use depth-adjusted negative binomial; includes the Brennecke test | [R15], [R16] |
| DUBStepR | hybrid | filters genes by a correlation range score, then prioritises genes by stepwise regression on the gene-gene correlation matrix | [R17] |
| FEAST | hybrid | initial clusterings, feature-significance estimation, then validation of candidate feature sets | [R18] |
| Random selection | baseline | uniform random subset of $N$ genes | [R19] |

The published standards kept as comparators are the dispersion flavours [R8, R9] and Seurat v3 [R10], implemented in scanpy [R20], whose default flavour depends on a preset. Pearson residuals [R12] and deviance [R2] are the count-based statistics that the best-practices chapter presents as avoiding normalisation bias [R5].

Defaults singlet reproduces (scanpy at `8ed52d9`, paths under `src/scanpy/`):

| Method | Parameter | Value | Source |
|---|---|---|---|
| scanpy | default `flavor` | `seurat` (preset ScanpyV1); `seurat_v3_paper` (ScanpyV2Preview) | `_settings/presets.py:194-195` |
| `seurat` | `n_top_genes`, `min_disp`, `max_disp`, `min_mean`, `max_mean`, `n_bins` | `None`, 0.5, inf, 0.0125, 3, 20; cutoffs are ignored when `n_top_genes` is set | `preprocessing/_highly_variable_genes.py:636-642`, `:346` |
| `seurat` | transform | expm1 of the layer, mean and variance with ddof 1, log of var/mean, log1p of mean | `preprocessing/_highly_variable_genes.py:404-418` |
| `cell_ranger` | bins and statistic | edges at $-\infty$, mean percentiles 10 to 100 in steps of 5, $+\infty$; median and MAD per bin | `preprocessing/_highly_variable_genes.py:461`, `:479-480` |
| `seurat_v3` | `n_top_genes`, `span`, loess degree | 2000 (helper; public default `None`), 0.3, 2 | `preprocessing/_highly_variable_genes.py:123`, `:126`, `:223` |
| `seurat_v3` | clip | mean plus fitted SD times $\sqrt{n}$, $n$ cells in the batch | `preprocessing/_highly_variable_genes.py:230` |
| `seurat_v3` | batch rule | ascending median rank over batches where rank $<N$, then descending batch count; `seurat_v3_paper` swaps the keys | `preprocessing/_highly_variable_genes.py:251-281` |
| `pearson_residuals` | `theta`, `clip` | 100; `None` gives $\sqrt{n}$ per batch | `experimental/pp/_highly_variable_genes.py:132`, `:177-179`, `:301` |
| `pearson_residuals` | `n_top_genes` | helper 1000; public `None` raises an error | `experimental/pp/_highly_variable_genes.py:134`, `:375-378` |
| `pearson_residuals` | score and batch rule | variance with denominator $n$ after mean subtraction; descending batch count, ties by ascending median rank | `experimental/pp/_highly_variable_genes.py:76-86`, `:217-247` |
| `pearson_residuals` (rapids_singlecell `e110792`) | `theta`, `n_top_genes` | 100; 2000 | `src/rapids_singlecell/preprocessing/_hvg/_pearson_residuals.py:26`, `:28`, `:48-52` |
| `binomial_deviance` (scry `1375237`) | `fam`, `assay` | `binomial`, `counts` | `R/featureSelection.R:171-172` |
| `binomial_deviance` | size factors, batches | library sizes are column sums; the Poisson family rescales them to geometric mean 1; per-batch deviances are summed | `R/featureSelection.R:61-65`, `:97-106` |
| `scran_model_gene_var` (scran `569d2f8`) | `min.mean`, `parametric`, `lowess`, `density.weights` | 0.1, TRUE, TRUE, TRUE | `man/fitTrendVar.Rd:10-13` |
| `scran_model_gene_var` | `equiweight`, `method`, batch rule | TRUE, `fisher`; components averaged across batches | `man/modelGeneVar.Rd:17-18`, `:106` |

## 5. Proposed singlet approach

**Routes.** Port `seurat`, `cell_ranger`, `seurat_v3` and `pearson_residuals` from the scanpy implementations, reading rapids_singlecell for GPU kernel structure. Reimplement `binomial_deviance` from equation (5) and [R2], and `scran_model_gene_var` from the scran documentation and [R11]. sctransform, M3Drop, DUBStepR and FEAST are callouts: benchmark comparators outside the enum.

**Default.** `pearson_residuals` with $N=2000$ and $\theta=100$: a closed-form, model-based statistic on raw counts that needs no normalisation or pseudocount. F1: it is falsified if it fails the B3 criterion on the non-negative-binomial generator G3.

**Model-based formulation.** The empirical-Bayes model of equations (6)-(7) stays out of the enum until it passes F2 and F3. F2: on the negative control G1 (B2) the fraction of genes with $P_g\ge0.95$ must not exceed 0.05. F3: it must meet the B3 and B4 criteria, and a prior fitted across studies must improve held-out-study ARI over a study-specific fit. Only $\tau$ and $h$ are fitted, on catalogue cells excluding studies annotated by HVG clustering, with held-out studies for validation; the prior is the only leakage route and F3 covers it.

**Batch handling.** With `batch_key`, each statistic is computed per batch and combined by the rule of its reference implementation (section 4).

**ML stack and kernels.** Closed-form statistics need no autodiff and are hard-coded: sparse sums, per-gene moments with the zero-entry identities of section 3, per-cell residual or deviance accumulation and partial sorting for top $N$, with cuSPARSE on CUDA and gene- or cell-parallel loops on CPU. The empirical-Bayes fit needs gradient-based inference and uses PyTorch. The `seurat_v3` loess is a small per-batch fit over $G$ points and stays on the CPU.

**Streaming.** The count flavours and `seurat_v3` read the cells twice (library sizes and gene totals, then the residual, deviance or clipped sums); `seurat`, `cell_ranger` and `scran_model_gene_var` read once for per-gene mean and variance. State is $O(G)$ per batch; no deep network is planned.

**Defaults an agent uses without asking.** `flavor` `pearson_residuals`, `n_top_genes` 2000, `batch_key` null unless the dataset declares a batch column and integration is next. Ask only when the layer state does not fit the flavour, the batch column is ambiguous, or cutoff-based selection is wanted (not exposed).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse integer | raw UMI counts; input of the count flavours |
| read | `layers/log1p_norm` | sparse float32 | log-normalised values; input of `seurat`, `cell_ranger`, `scran_model_gene_var` |
| read | `obs/<batch_key>` | categorical | batch labels when `batch_key` is set |
| write | `var/highly_variable` | bool | the selected $N$ genes; fewer only when fewer genes have counts |
| write | `var/hvg_score` | float32 | flavour statistic (section 3); higher is more variable; NaN for zero-count genes |
| write | `var/hvg_rank` | int32 | 0 is most variable; -1 for zero-count genes |
| write | `var/means` | float32 | per-gene mean of the scored layer |
| write | `var/variances` | float32 | per-gene sample variance of the scored layer |
| write | `uns/hvg` | dict | flavour, parameters, source layer, batch key, provenance |

The names `var/hvg_score` and `var/hvg_rank` are singlet's.

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string/null | null | — | Layer to score. Null selects layers/counts for count flavors and layers/log1p_norm for log flavors; fails if absent or in the wrong state. |
| `flavor` | string | "pearson_residuals" | `pearson_residuals`, `binomial_deviance`, `seurat_v3`, `seurat`, `cell_ranger`, `scran_model_gene_var` | Selection statistic. Count input: pearson_residuals (default), binomial_deviance, seurat_v3. Log-normalised input: seurat, cell_ranger, scran_model_gene_var. |
| `n_top_genes` | integer | 2000 | min 1 | Number of genes to keep (N). Always returns N genes; cutoff-based selection is not offered. |
| `batch_key` | string/null | null | — | obs column with batch labels. Null treats the dataset as one batch; otherwise statistics are computed per batch and combined by a flavor-specific rule. |
| `seurat_v3` | object | — | — | Options for flavor seurat_v3; ignored by other flavors. |
| `seurat_v3.span` | number | 0.3 | max 1; > 0 | Loess span of the variance trend. |
| `seurat_v3.clip` | number/null | null | > 0 | Fitted standard deviations above the mean at which counts are clipped. Null uses sqrt(n_cells) per batch. |
| `pearson_residuals` | object | — | — | Options for flavor pearson_residuals; ignored by other flavors. |
| `pearson_residuals.theta` | number | 100 | > 0 | Shared negative-binomial size parameter of the residual model. |
| `pearson_residuals.clip` | number/null | null | > 0 | Absolute bound on residuals. Null uses sqrt(n_cells) per batch. |
| `binomial_deviance` | object | — | — | Options for flavor binomial_deviance; ignored by other flavors. |
| `binomial_deviance.family` | string | "binomial" | `binomial`, `poisson` | Approximating family of the multinomial deviance; poisson may be faster and is often very similar. |
| `seurat` | object | — | — | Options for flavor seurat; ignored by other flavors. |
| `seurat.n_bins` | integer | 20 | min 1 | Number of equal-width mean bins for dispersion normalisation. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing any member. |
| `overwrite` | boolean | false | — | Replace existing highly-variable-gene members instead of failing. |
<!-- PARAMS:AUTO:END -->

Options in a nested object apply only to the flavour of the same name; for other flavours they are ignored and recorded as ignored in `uns/hvg`. A null `layer` selects `layers/counts` for the count flavours and `layers/log1p_norm` for the others; the call fails with a reason when the layer is absent or its state does not fit the flavour (integer-valued for count flavours, non-negative for log flavours), never as a completed status with partial members. A null `clip` means $\sqrt{n}$ per batch (scanpy fixes it for `seurat_v3`). There is no seed: every flavour is deterministic and ties break by gene index.

## 7. MCP tool

Tool name `singlet_feature_selection_highly_variable_gene_selection` (definition in `tasks/mcp/singlet_feature_selection_highly_variable_gene_selection.json`). Example call and result (values illustrative):

```json
{"dataset": "/data/pbmc_multi_donor.singlet", "flavor": "pearson_residuals", "n_top_genes": 2000, "batch_key": "donor"}
```

```json
{
  "dataset": "/data/pbmc_multi_donor.singlet",
  "status": "completed",
  "wrote": ["var/highly_variable", "var/hvg_score", "var/hvg_rank", "var/means", "var/variances", "uns/hvg"],
  "summary": {"flavor": "pearson_residuals", "layer": "counts", "n_genes_selected": 2000, "n_batches": 4, "score_at_N": 0.41, "top_genes": ["PPBP", "PF4", "S100A8"]},
  "provenance_id": "prov_0001"
}
```

Long-running: no for inputs within the inline limit; the runtime returns `queued` with a `job_id` beyond it. Stochastic: no. Dry run: `estimate` holds `seconds`, `peak_memory_gb` and `device`, and nothing is written.

## 8. Benchmarks

**Shared protocol** (design choices unless a benchmark says otherwise). Each selector keeps $N=2000$ genes (sweep 500, 1000, 4000). Downstream settings are identical for all selectors: PCA with 50 components, a $k=15$ neighbour graph, Leiden clustering at a fixed resolution. Stochastic steps use 10 seeds and results are reported as mean and range. Comparators for B2 to B4 are the reference implementations of section 4, run with their defaults, and random selection. The chance-corrected adjusted Rand index (ARI) has contingency counts $n_{ij}$, row sums $a_i$, column sums $b_j$ and $n$ cells: $\mathrm{ARI}=\bigl(\sum_{ij}\binom{n_{ij}}{2}-t\bigr)/\bigl(\tfrac12[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}]-t\bigr)$ with $t=\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}/\binom{n}{2}$; 0 is chance and 1 identical. Reference hardware is the CPU path.

### B1. Feature selection for integration and query mapping (published, Zappia et al. 2025)

- **Goal**: Compare singlet and published selectors on integration, reference mapping and label transfer after selection [R19].
- **Ground truth**: Author cell-type labels of each dataset; query batches and unseen labels are held out as in `conf/benchmark.yml`; each metric is scaled per dataset to the baseline range.
- **Datasets** (source [R19], `data/datasets-metadata.tsv`; scRNA-seq; licences —)

| Dataset | Reference cells; batches; labels | Query batches; unseen labels |
|---|---|---|
| scIB pancreas | 12,731; 7; 12 | 2; 1 |
| NeurIPS | 70,061; 9; 42 | 3; 2 |
| Fetal liver | 62,384; 11; 23 | 3; 4 |
| Human endoderm | 100,580; 10; 21 | 4; 5 |
| HLCA, HLCA epithelial, HLCA immune | 314,573; 9; 47 / 118,374; 8; 17 / 155,385; 7; 16 | 5; 14 / 5; 6 / 2; 4 |
| Reed breast | 337,339; 24; 32 | 17; 7 |
| scEiaD | 360,270; 69; 41 | 18; 6 |
| splat | 30,041; 4; 7 | 2; 3 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Scaled metric | for each of the 19 metrics flagged Included in `data/metrics-metadata.tsv`: (value $-$ Lower)/(Upper $-$ Lower), Lower and Upper being the minimum and maximum over the baseline methods of the mean value | higher | primary | [R19] |
| Overall score | $0.5\,(0.5\,\mathrm{IntegrationBatch}+0.5\,\mathrm{IntegrationBio})+0.5\,(\tfrac13\mathrm{Mapping}+\tfrac13\mathrm{Classification}+\tfrac13\mathrm{Unseen})$, each type score being the mean of its scaled metrics | higher | primary | [R19] |

- **Comparators**: the scanpy, scry, NBumi, Brennecke, DUBStepR, random and all-feature methods of `data/methods-metadata.tsv`; its baseline set (all features, random N=500, scanpy Cell Ranger N=2000 batch-aware, scSEGIndex) defines the scaling range.
- **Protocol**: The source's integration and mapping workflow replaces the PCA-clustering step; selection uses reference batches only; singlet flavours run with and without `batch_key`.
- **Acceptance criterion**: Proposed. The default's Overall score, averaged over the ten datasets, is at least that of the best scanpy flavour minus 0.02 and above random N=2000 on every dataset.
- **Known pitfalls**: Scaled scores depend on the baseline set.

### B2. Multinomial negative control (proposed, after Townes et al. [R2])

- **Goal**: Test whether a score depends on mean expression, or selects genes, when no gene is biologically variable.
- **Ground truth**: Planted simulation with an empty variable set: every gene is null by construction, so no normalisation is needed.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G1 multinomial negative control | generated by singlet (recipe below) | simulated UMI counts; $n$ and $G$ set in the registry | — | gene proportions and library sizes from a registry catalogue dataset |

Recipe G1: (1) take $\mathbf p$ (gene proportions) and the empirical library-size distribution of a registry dataset; (2) draw $n_c$ from that distribution; (3) draw each cell as $\mathbf x_{\cdot c}\sim\mathrm{Multinomial}(n_c,\mathbf p)$; (4) repeat for 10 replicates.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Mean bias | Spearman correlation between `var/hvg_score` and log gene mean over genes with mean at least 0.01 UMI per cell (a design choice), averaged over replicates; reported as $\lvert\rho\rvert$ | lower | primary | proposed |
| Null rejection rate | for selectors with p-values (`scran_model_gene_var`, the proposed model), the fraction of genes with Benjamini-Hochberg $q\le0.05$ over all $G$ genes | lower | guardrail | [R2] |

- **Comparators**: the six flavours; random selection has $\rho=0$ by construction.
- **Protocol**: $N=2000$; the shared PCA-clustering step is not used.
- **Acceptance criterion**: Proposed. The default's $\lvert\rho\rvert$ is no larger than the median over the six flavours, and each p-value selector's rejection rate is at most $0.05+2\sqrt{0.05\cdot0.95/G}$ (an independence approximation).
- **Known pitfalls**: A top-$N$ selector selects $N$ genes by construction, so only the correlation is informative for it. Negative controls test the multinomial null only, not gene-gene correlation or biological overdispersion [R2].

### B3. Planted-structure simulation (proposed)

- **Goal**: Measure recovery of planted cell types and marker genes under controlled depth spread, dispersion and effect size, with one generator outside the negative-binomial family.
- **Ground truth**: Planted simulation: each cell's cluster $k(c)$ and the disjoint marker sets $M_k$ are known; a marker has log fold change $\delta$ on composition-normalised means $\tilde\mu_{gk}$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G2 negative-binomial planted generator | generated by singlet (recipe below) | simulated; $n$, $G$, $K$, $m$ markers per cluster set in the registry | — | NB family |
| G3 Poisson-lognormal planted generator | generated by singlet (recipe below) | simulated; same settings | — | outside the NB family, avoiding circularity with G2 |

Recipe G2: (1) draw base means $\beta_g$ log-normally; (2) for cluster $k$ draw markers $M_k$ and set $\mu_{gk}=\beta_g\exp(\delta\,\mathbf 1[g\in M_k])$, $\tilde\mu_{gk}=\mu_{gk}/\sum_{g'}\mu_{g'k}$; (3) draw $s_c$ log-normally with spread $\sigma_s$ and assign clusters uniformly; (4) draw $x_{gc}\sim\mathrm{NB}(s_c\tilde\mu_{g,k(c)},\theta_g)$. Recipe G3: steps (1) to (3), then $\eta_{gc}\sim\mathcal N(\log\tilde\mu_{g,k(c)},\sigma_g^2)$ and $x_{gc}\sim\mathrm{Poisson}(s_c e^{\eta_{gc}})$; the mean factor $e^{\sigma_g^2/2}$ is common to all cells of a gene, so marker fold changes are unchanged.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI to planted clusters | ARI between graph clusters (shared protocol) and $k(c)$ | higher | primary | proposed |
| Marker recall at $N$ | $\lvert M\cap S_N\rvert/\lvert M\rvert$ with $M=\bigcup_k M_k$ and $S_N$ the selected set | higher | primary | proposed |
| Selection stability | mean pairwise Jaccard index of selected sets over cell subsamples | higher | guardrail | proposed |

- **Comparators**: as in the shared protocol.
- **Protocol**: A grid over cell number, library-size spread, dispersion and effect (small effects included).
- **Acceptance criterion**: Proposed. The default's ARI is within 0.02 of the best comparator in at least 90% of grid settings and its marker recall is never more than 0.05 below the best comparator.
- **Known pitfalls**: Large effects make every selector look good; ARI depends on the clustering resolution.

### B4. Catalogue author-annotation benchmark (proposed)

- **Goal**: Test whether unsupervised selection on one study preserves author-annotated structure and transfers across studies.
- **Ground truth**: Author annotations of the singlet catalogue, at the coarsest granularity shared by the studies compared; ARI and macro-F1 are chance- or class-averaged, so no further normalisation applies.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue author-annotated studies | singlet catalogue (354M cells, about 40% annotated; project figures) | scRNA-seq and snRNA-seq; studies listed in the registry | — | studies whose annotation was made by HVG clustering are excluded |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI to annotations | per study, ARI between graph clusters (shared protocol) and the annotation | higher | primary | proposed |
| kNN macro-F1, leave-one-study-out | a kNN classifier ($k$ fixed in the registry) trained on all studies but one, applied to the held-out study; F1 averaged over annotated types | higher | primary | proposed |

- **Comparators**: as in the shared protocol.
- **Protocol**: Selection without labels per study; the kNN metric is evaluated leave-one-study-out.
- **Acceptance criterion**: Proposed. The default's ARI is not below the best comparator minus 0.02 on at least 70% of studies.
- **Known pitfalls**: Annotation granularity differs between studies, so the harmonised level is fixed before scoring.

### P1. Performance and scaling

Wall time, peak memory and throughput of the selection step (statistic plus top-$N$ ranking) on sparse CSR input at $10^4$, $10^5$ and $10^6$ cells (design choices) with about $3\times10^4$ genes, for CPU and CUDA separately. Held fixed: non-zero entries per cell, $N=2000$, float32, batch count, threads and hardware. Comparators: scanpy `seurat_v3`, `seurat`, `cell_ranger` and experimental Pearson residuals (CPU, numba); rapids-singlecell Pearson residuals and `seurat_v3` (GPU); scry binomial deviance and scran `modelGeneVar` (R, sparse).

- **Acceptance criterion**: Proposed. On the same hardware the singlet CPU path is no slower than the scanpy reference of the same flavour at each scale, the selected set agrees with the reference up to ties, and the CUDA path is reported with its overlap with the CPU path and against rapids-singlecell on the same device.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `harmonization.count_matrix_state_detection`: Count-matrix processing-state detection
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Feeds**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `integration.batch_corrected_embedding`: Batch-corrected joint embedding
  - `feature-selection.number_of_features`: Choosing how many features to keep
  - `feature-selection.selected_feature_stability`: Robustness and reproducibility of selected feature sets
- **Reads**: `layers/counts`, `layers/log1p_norm`, `obs/<batch_key>`
- **Writes**: `var/highly_variable`, `var/hvg_score`, `var/hvg_rank`, `var/means`, `var/variances`, `uns/hvg`
<!-- CHAINING:AUTO:END -->

Workflow: single-dataset clustering recipe (QC, state check, size factors, selection, PCA, neighbours, clustering). Batch-aware and reference-mapping variants are separate tasks: `feature-selection.batch_aware_selection_for_integration`, `feature-selection.reference_mapping_features`.

## 10. Risks, pitfalls and open questions

- **Zhao et al. panel [R1].** Known only at the level of its design (7 cell-sorting, 7 CITE-seq and 5 multiome datasets, 21 baseline and 26 hybrid selectors): its criteria, dataset accessions and hybrid-method code are unavailable here, so it is not a numbered benchmark; reading it is the first literature task.
- **Method sources.** Definitions come from implementation source and documentation, not from re-reading the original evaluations. [R11] describes the earlier scran functions `trendVar` and `decomposeVar`; `modelGeneVar` was read from its manual page, which marks it deprecated. sctransform, M3Drop, DUBStepR and FEAST are described from package metadata and READMEs only. The Cell Ranger source is not public here, and the agreement of scanpy's flavours with the original Seurat and Cell Ranger code is unmeasured.
- **Benchmark B1 gaps.** Dataset licences and the orientation of individual distance metrics were not recorded; the scIB/OpenProblems `hvg_overlap` metric (mean over batches of the overlap of 500-gene `cell_ranger` sets before and after integration [R21]) scores integration outputs, not selectors, and is not used.
- **Unsettled literature.** The correction for mean dependence, the relative effect of statistic, normalisation and $N$, and the value of fixed $\theta=100$ for overdispersed biological genes (tested by B3) are open; negative controls validate only the multinomial null.
- **Technical and data risks.** Clipping makes ranks depend on cells per batch. The catalogue totals (354M cells, 40% annotated) are project figures and the provenance of each annotation must be recorded before B4.
- **First experiment.** Check that singlet reproduces the scanpy selected sets for `seurat`, `seurat_v3` and `pearson_residuals` on one shared dataset, then compare `pearson_residuals`, `seurat_v3` and `binomial_deviance` on G1, G2 and G3 at $N=2000$.

## 11. References

R1. Zhao R, Lu J, Li Y, Zhou W, Zhao N, Ji H. A systematic evaluation of highly variable gene selection methods for single-cell RNA-sequencing. *Genome Biology* 2025. doi:10.1186/s13059-025-03887-x — verified (search)
R2. Townes FW, Hicks SC, Aryee MJ, Irizarry RA. Feature selection and dimension reduction for single-cell RNA-Seq based on a multinomial model. *Genome Biology* 2019. doi:10.1186/s13059-019-1861-6 — verified (corpus)
R3. Sheng J, Li WV. Selecting gene features for unsupervised analysis of single cell gene expression data. *Briefings in Bioinformatics* 2021;22(6):bbab295. doi:10.1093/bib/bbab295 — verified (search)
R4. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)
R5. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R6. Svensson V. Droplet scRNA-seq is not zero-inflated. *Nature Biotechnology* 2020. doi:10.1038/s41587-019-0379-5 — verified (search)
R7. Cao, Kitanovski, Küppers, Hoffmann. UMI or not UMI, that is the question for scRNA-seq zero-inflation. *Nature Biotechnology* 2021 (correspondence). — partial (search)
R8. Satija R, Farrell JA, Gennert D, Schier AF, Regev A. Spatial reconstruction of single-cell gene expression data. *Nature Biotechnology* 2015. doi:10.1038/nbt.3192 — verified (corpus)
R9. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — verified (corpus)
R10. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R11. Lun ATL, McCarthy DJ, Marioni JC. A step-by-step workflow for low-level analysis of single-cell RNA-seq data with Bioconductor. *F1000Research* 2016. doi:10.12688/f1000research.9501.2 — verified (corpus)
R12. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)
R13. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019. doi:10.1186/s13059-019-1874-1 — verified (corpus)
R14. Choudhary S, Satija R. Comparison and evaluation of statistical error models for scRNA-seq. *Genome Biology* 2022;23:20. doi:10.1186/s13059-021-02584-9 — verified (repo)
R15. Andrews TS, Hemberg M. M3Drop: dropout-based feature selection for scRNASeq. *Bioinformatics* 2019. doi:10.1093/bioinformatics/bty1044 — verified (corpus)
R16. Brennecke et al. Accounting for technical noise in single-cell RNA-seq experiments. *Nature Methods* 2013;10:1093-1095. doi:10.1038/nmeth.2645 — verified (repo)
R17. Ranjan B, Sun W, Park J, et al. DUBStepR is a scalable correlation-based feature selection method for accurately clustering single-cell data. *Nature Communications* 2021;12:5849. doi:10.1038/s41467-021-26085-2 — verified (corpus)
R18. Su K, et al. Accurate feature selection improves single-cell RNA-seq cell clustering. 2021. doi:10.1093/bib/bbab034 — partial (corpus)
R19. Zappia L, Richter S, Ramírez-Suástegui C, et al. Feature selection methods affect the performance of scRNA-seq data integration and querying. *Nature Methods* 2025. doi:10.1038/s41592-025-02624-3 — verified (repo)
R20. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R21. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2021. doi:10.1038/s41592-021-01336-8 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | scverse; LICENSE copyright lines name F. Alexander Wolf, P. Angerer and Theis Lab (2017) and scverse (2025) | BSD-3-Clause (LICENSE file and pyproject.toml) | reference implementations of `seurat`, `cell_ranger`, `seurat_v3` and experimental Pearson residuals; parity target | port, with attribution |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (pyproject.toml) | MIT (LICENSE file) | GPU Pearson residuals and `seurat_v3` | port; kernel structure read, singlet writes its own CUDA kernels |
| https://github.com/kstreet13/scry | Kelly Street (aut, cre), F. William Townes (aut, cph), Davide Risso (aut), Stephanie Hicks (aut) | Artistic-2.0 (DESCRIPTION; no LICENSE file at repository root) | binomial deviance reference implementation | reimplement |
| https://github.com/MarioniLab/scran | Aaron Lun (aut, cre), Karsten Bach (aut), Jong Kyoung Kim (ctb), Antonio Scialdone (ctb) | GPL-3 (DESCRIPTION; no LICENSE file at repository root) | `modelGeneVar` | reimplement |
| https://github.com/ChristophH/sctransform | Christoph Hafemeister (aut), Saket Choudhary (aut, cre), Rahul Satija (ctb) | GPL-3 \| file LICENSE (DESCRIPTION); the LICENSE file is the GNU GPL v3 text | comparator | callout |
| https://github.com/tallulandrews/M3Drop | Tallulah Andrews (DESCRIPTION Author field) | GPL (>= 2) (DESCRIPTION; no LICENSE file at repository root) | dropout comparator | callout |
| https://github.com/prabhakarlab/DUBStepR | Bobby Ranjan (aut, cre); Kunal Mishra, Bryan Hanson, Damian Coventry, Brandon Crosby, Gregoire Thomas (ctb); Shyam Lab (cph) | LICENSE file is a custom user licence; DESCRIPTION says MIT + file LICENSE | hybrid comparator | callout |
| https://github.com/suke18/FEAST | Kenong Su (aut, cre), Hao Wu (aut) | GPL-2 (DESCRIPTION; no LICENSE file at repository root) | hybrid comparator | callout |
| https://github.com/theislab/atlas-feature-selection-benchmark | Theis Lab (LICENSE copyright line); paper authors in the README citation | MIT (LICENSE file) | B1 datasets, methods, metrics and scoring | callout; benchmark definition only |
| https://github.com/openproblems-bio/task_batch_integration | OpenProblems project | MIT (LICENSE file) | `hvg_overlap` metric configuration | callout; metric definition only |
