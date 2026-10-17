---
id: qc.low_quality_cell_detection
title: Low-quality and damaged cell detection from per-cell QC metrics
area: qc
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [cell-calling.cell_vs_empty_droplet_calling, cell-calling.nucleus_vs_empty_calling, harmonization.gene_identifier_mapping]
feeds: [normalization.size_factor_estimation, doublets.expression_doublet_scoring, qc.sample_level_qc]
reads: [layers/counts, var/mito, var/ribo, obs/<batch_key>, obs/<cell_type_key>]
writes: [obs/qc_total_counts, obs/qc_n_genes, obs/qc_pct_mito, obs/qc_pct_ribo, obs/qc_pct_top20, obs/qc_outlier_lib, obs/qc_outlier_genes, obs/qc_outlier_top20, obs/qc_outlier_mito, obs/keep_cell, obs/lowq_prob, uns/qc_thresholds, uns/qc_method_report, models/miqc, models/dropkick]
devices: [cpu, cuda]
mcp_tool: singlet_qc_low_quality_cell_detection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Low-quality and damaged cell detection from per-cell QC metrics

> Flags barcodes whose library size, number of detected genes and mitochondrial fraction mark them as dying, damaged or technically failed, and writes a per-cell keep flag with the metrics and thresholds behind it, using robust MAD rules, fixed bounds, a per-sample mixture model or a learned classifier.

## 1. Question

Given the raw UMI count matrix after cell calling, which barcodes are dying, damaged or technically failed and should be removed before analysis, without removing viable cell types, small populations or respiratory-active cells? The task writes a keep flag per cell, a low-quality probability for the model-based methods, and the metric values and thresholds behind each removal. A correct answer removes cells whose profile reflects damage or technical failure and retains every viable population. No ground truth exists for this decision; the literature uses microscopy annotation of cell status [R2], cells of known identity whose loss can be counted [R3] and expert judgement [R4]. Section 10 states what each proxy cannot establish.

## 2. Why this task matters and where the field stands

Three per-cell covariates carry most of the signal: library size, detected genes and mitochondrial fraction. A cell with few detected genes, low depth and a high mitochondrial fraction may have a broken membrane and have lost its cytoplasmic mRNA; the best-practices chapter advises reading the three together, and notes that low-quality cells left in may distort downstream analysis [R4]. A viable population removed here is lost from every later result.

The task is **contested**.

1. **Thresholds do not transfer.** The miQC documentation states that mitochondrial thresholds can be arbitrary and detrimentally stringent, especially for archived tumour tissue [R1].
2. **Biology confounds the signal.** Cells with a high mitochondrial fraction may be engaged in respiratory processes, and the chapter advises being permissive to protect small subpopulations [R4]. Cell types with naturally low RNA content or high mitochondrial content are flagged by outlier rules without any technical fault [R8]. The pipeComp documentation warns that stringent filtering can bias strongly against subpopulations [R3].
3. **Batch structure breaks outlier rules.** Pooling batches of different depth inflates the median and MAD, and a batch in which most cells failed is not corrected by batch-wise thresholds [R8].
4. **Ground truth is weak.** The supervised classifier cellity was trained on 960 mouse embryonic stem cells annotated by microscopy [R2], and no benchmark compares MAD rules, fixed bounds and joint-model QC on shared truth (section 10), so the default cannot yet be justified by benchmark results.

Open problems: thresholds that hold across tissues, protocols and depths without per-dataset tuning; separating damaged cells from viable high-mitochondrial cells and small populations; removal sets that are stable under cell resampling; a per-cell score with calibrated uncertainty, which no heuristic provides; and nuclei, where the damaged-cell logic of whole-cell data does not apply (task `qc.single_nucleus_quality_filtering`).

## 3. Theory and insight

For cell $i$: $t_i=\sum_g c_{ig}$ is the library size, $d_i=\#\{g:c_{ig}>0\}$ the detected genes, $p_i=m_i/t_i$ the mitochondrial fraction ($m_i$ the counts in the mitochondrial gene set) and $s_i$ the share of counts in its 20 most-expressed genes. A method maps these covariates (for dropkick, also the expression profile) to a removal flag $o_i\in\{0,1\}$, with `keep_cell` $=1-o_i$, or to a probability.

**Estimands.** `keep_cell` is a binary decision per cell. `lowq_prob` is, for miQC, the posterior probability $\gamma_{i2}$ under the fitted per-sample mixture that cell $i$ belongs to the compromised component (a model quantity, not the probability that the cell is dead), and for dropkick $1-\hat P(y_i=1\mid x_i)$ where $y$ are the heuristic training labels (a classifier of the heuristic, not of damage). Retention of a type $t$ is $\mathrm{ret}(t)$ = kept cells of type $t$ divided by all cells of type $t$ before filtering.

**MAD rule.** For a metric $x$ in batch $b$ with median $\tilde x_b$ and unscaled $\mathrm{MAD}_b=\operatorname{median}_{i\in b}|x_i-\tilde x_b|$, a cell is flagged when $|x_i-\tilde x_b|>\kappa\,\mathrm{MAD}_b$ (two-sided) or $x_i>\tilde x_b+\kappa\,\mathrm{MAD}_b$ (upper). scuttle uses the scaled MAD $1.4826\,\mathrm{MAD}_b$ and the notebook the unscaled one, so scuttle's `nmads = 3` equals $3\times1.4826\approx4.45$ unscaled MADs and the notebook's 5 unscaled MADs equal $5/1.4826\approx3.37$ scaled MADs. Median and MAD are equivariant under $x\mapsto ax+b$ with $a>0$, so flags do not depend on the logarithm base, whereas $\log(1+x)$ versus $\log x$ is not affine and changes flags. *Regime of validity*: the median and MAD break down when half of a batch is damaged, and the scaled MAD estimates $\sigma$ only for a roughly normal bulk, so the rule needs a majority of intact cells and a roughly symmetric, unimodal transformed metric. Counts are therefore used on the log scale, and the bounded mitochondrial fraction on the logit scale with a pseudocount, $\ell_i=\operatorname{logit}\frac{m_i+1}{t_i+2}$. The notebook flags a cell as mitochondrial-high when both conditions hold:

$$\ell_i>\tilde\ell_b+3\,\mathrm{MAD}_b(\ell)\quad\wedge\quad 100\,p_i>8 .$$

As the logit is monotone, this is, up to the pseudocount, the single cutoff $\max\bigl(\operatorname{expit}(\tilde\ell_b+3\,\mathrm{MAD}_b(\ell)),\,0.08\bigr)$: when the MAD threshold lies below 8 percent the fixed bound decides [R4], and the rule flags no more cells than either component alone.

**Fixed bounds** keep a cell if $d_{\min}<d_i<d_{\max}$ and $p_i<c$. The constants are valid only for the population on which they were chosen (the PBMC tutorials) and do not adapt to a batch.

**miQC** [R1]. Per sample, with $v_i=100p_i$,
$$p(v_i\mid d_i)=\sum_{k=1}^{2}\pi_k\,\mathcal N\bigl(v_i\mid\beta_{k0}+\beta_{k1}d_i,\sigma_k^2\bigr),\qquad \gamma_{i2}=\frac{\pi_2\,\mathcal N(v_i\mid\beta_{20}+\beta_{21}d_i,\sigma_2^2)}{\sum_k\pi_k\,\mathcal N(v_i\mid\beta_{k0}+\beta_{k1}d_i,\sigma_k^2)},$$
the component with the larger intercept is compromised, and a cell is kept when $\gamma_{i2}\le\tau$. Two boundary options follow: cells below the fitted intact line are kept, then cells with no more detected genes and no lower mitochondrial percentage than the least-mitochondrial removed cell are removed. *Regime*: two identifiable linear Gaussian components per sample; $\gamma_{i2}$ is calibrated only if the model holds. EM depends on its starting values, and the reference stops with an error when every cell passes; its vignette recommends one common $\tau$ for samples of the same experiment.

**dropkick** [R6]. With $a_i=\operatorname{arcsinh}(d_i)$, multi-Otsu gives thresholds $\theta_1<\theta_2$: cells with $a_i\le\theta_1$ are excluded from training, $\theta_1<a_i\le\theta_2$ get label 0, $a_i>\theta_2$ label 1. An elastic-net logistic regression is then fitted on the arcsinh-transformed, gene-scaled expression $x_i$ of the 2,000 most variable genes,
$$\min_{\beta_0,\beta}\ -\tfrac1n\sum_i\bigl[y_i\log p_i+(1-y_i)\log(1-p_i)\bigr]+\lambda\bigl[\tfrac{1-\alpha}{2}\lVert\beta\rVert_2^2+\alpha\lVert\beta\rVert_1\bigr],\quad p_i=\operatorname{expit}(\beta_0+x_i^\top\beta),$$
with $\lambda$ chosen by 5-fold cross-validation. *Regime*: the heuristic labels are approximately right; a misplaced threshold is learned as truth, and excluded cells receive score 0.

**Comparators.** DropletQC [R7] defines the nuclear fraction $\mathrm{NF}_i=I_i/(I_i+E_i)$ (intronic over intronic plus exonic reads) and, per cell type, fits a Gaussian mixture with $G\in\{1,2\}$ and shared diagonal covariance (`EEI`, chosen by BIC) to $(\log_{10}U_i,\mathrm{NF}_i)$ with $U_i$ the UMI count; it flags the high-NF, low-UMI component as damaged only if two separation checks pass (section 4), and never removes cells. It is defined for whole-cell data; in nuclei intact cells already have a high NF, so the rule cannot transfer unchanged (an inference, not a benchmarked result). cellity [R2] classifies more than 20 features by a majority vote of radial-kernel SVMs trained on microscopy labels and returns hard labels only.

**Why heuristics work and what a model adds.** The damaged tail usually lies far from the bulk of intact cells, and median and MAD describe the bulk without being pulled toward the tail; the rules are cheap, transparent and reproducible. Their threshold summarises the bulk and does not model damage, gives no probability for borderline cells, and ignores the joint distribution of the covariates. A joint model judges mitochondrial fraction in light of gene count [R4], adapts to each sample, and returns a posterior that can be checked for calibration on planted cells (B3) and used as a score with uncertainty, at the price of assumptions that can fail.

**Pitfalls shown by reports.**

- Scale conventions differ (above); thresholds without the convention are not comparable.
- A batch in which most cells failed carries its own failure in its median and MAD; estimating the thresholds from the other batches repairs it (`reference_batches`, scuttle's `subset` with `share.missing`) [R8].
- Stringent filtering costs subpopulations; pipeComp's lenient filter removes a cell only when two criteria flag it [R3].
- Lost cell types show as marker genes enriched in the discarded pool relative to the retained pool [R8].
- Evaluating a method against labels derived from its own thresholds is circular.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| MAD outlier rule (scuttle `isOutlier`) | heuristic | Flags values more than `nmads` scaled MADs from the batch median, one- or two-sided, optionally on the log2 scale, with per-batch medians and MADs that can be shared across batches. | [R5][R8] |
| Best-practices notebook rule | heuristic | Unscaled MADs: 5 on log1p counts, log1p genes and top-20 share (two-sided), and 3 above the median on the logit mitochondrial fraction combined by AND with a fixed 8 percent bound. | [R4] |
| pipeComp lenient and stringent filters | heuristic | MAD criteria on counts, features, top-20 share, the residual of log10 features on log10 counts, and mitochondrial fraction; a cell is removed when flagged by at least two criteria (lenient) or one (stringent, tighter bounds). | [R3] |
| Fixed bounds (scanpy and Seurat tutorials) | heuristic | Keeps cells with 200 < genes < 2,500 and mitochondrial percentage below 5. | — |
| miQC | model-based | Per sample, a two-component mixture of linear regressions of mitochondrial percentage on detected genes; removes cells by posterior probability of the compromised component, with two boundary corrections. | [R1] |
| dropkick | hybrid | Multi-Otsu thresholds on arcsinh detected genes give training labels; an elastic-net logistic regression on scaled expression of 2,000 variable genes outputs a probability. | [R6] |
| DropletQC damaged-cell rule | model-based | Per cell type, a Gaussian mixture on log10 UMI and nuclear fraction; the low-UMI, high-nuclear-fraction component is flagged, never removed. | [R7] |
| cellity | model-based (supervised) | Features from expression and read statistics classified by a majority vote of radial-kernel SVMs trained on labelled cells. | [R2] |

The routine standard is MAD outlier detection with a fixed mitochondrial bound, as in scuttle and the best-practices notebook [R4][R5]; tutorial bounds persist in practice but are conventions, not validated rules. miQC [R1], dropkick [R6] and DropletQC [R7] are the joint or learned alternatives, and cellity [R2] is the supervised reference with microscopy ground truth. Per-batch thresholds are a configuration of the MAD rule, not a separate method.

Exact defaults (the singlet defaults are in section 6):

| Method | Parameter | Value | Source (file:line @ sha, or notebook cell index from 0) |
|---|---|---|---|
| Notebook | MAD scale | unscaled (`scipy.stats.median_abs_deviation`, scale 1) | quality_control.ipynb cell 20 @ d581689 |
| Notebook | MADs, log1p counts, log1p genes, top-20 share | 5, two-sided | cell 24 @ d581689 |
| Notebook | MADs, logit mitochondrial fraction | 3, upper only, and `pct_counts_mt` > 8 | cell 24 @ d581689 |
| Notebook | mitochondrial transform | logit of (m+1)/(t+2) | cell 22 @ d581689 |
| Notebook | QC metrics call | `calculate_qc_metrics(percent_top=[20], log1p=True)` | cell 16 @ d581689 |
| scuttle | nmads, type, log | 3, "both", FALSE | R/isOutlier.R:91-93 @ d3476eb |
| scuttle | share.medians, share.mads, share.missing | FALSE, FALSE, TRUE | R/isOutlier.R:91-93 @ d3476eb |
| scuttle | MAD constant | `stats::mad` default 1.4826 (scaled); shared fallback multiplies by `formals(mad)$constant` | R/isOutlier.R:181 @ d3476eb |
| scuttle | perCellQCFilters | log = TRUE, type "lower" for library size and detected features; deprecated for `scrapper::suggestRnaQcThresholds` | R/perCellQCFilters.R:58-61 @ d3476eb |
| pipeComp | filt.lenient | 5 MADs two-sided on log10 counts, log10 features, top-20 share and the log10 feature-count residual; mitochondrial: 3 MADs lower, or 3 MADs higher and > 0.08; remove if flagged by at least 2 criteria | inst/extdata/scrna_alternatives.R:250-269 @ a3fd419 |
| pipeComp | filt.stringent | counts and features 2.5 MADs upper and 5 lower, top-20 share and residual 5 two-sided, mitochondrial 2.5 MADs higher and > 0.08; remove if flagged by at least 1 criterion | scrna_alternatives.R:271-296 @ a3fd419 |
| scanpy tutorial | bounds | 200 < `n_genes_by_counts` < 2500, `pct_counts_mt` < 5 | docs/tutorials/basics/clustering-2017.ipynb:707-709 @ 8ed52d9 |
| Seurat tutorial | bounds | `nFeature_RNA` > 200 and < 2500, `percent.mt` < 5 | vignettes/pbmc3k_tutorial.Rmd:122 @ 5f67c70 |
| miQC | model_type, mixture | "linear"; flexmix k = 2 on `subsets_mito_percent ~ detected` | R/mixtureModel.R:47,52-53 @ a31358e |
| miQC | other model types | `bs(detected)`, `poly(detected, degree = 2)`, intercept only | R/mixtureModel.R:54-61 @ a31358e |
| miQC | posterior_cutoff, keep_all_below_boundary, enforce_left_cutoff | 0.75, TRUE, TRUE | R/filterCells.R:54-56 @ a31358e |
| miQC | compromised component, keep rule | larger intercept; keep if `prob_compromised <= posterior_cutoff`; error if all cells pass | R/filterCells.R:66-84 @ a31358e |
| dropkick | recipe | `min_genes` 50, `mito_names` "^mt-\|^MT-", `n_ambient` 10, `n_hvgs` 2000 | dropkick/api.py:26-35 @ bd2647a |
| dropkick | `dropkick()` | metrics `arcsinh_n_genes_by_counts`, `multiotsu`, direction `above`, alphas [0.1], `max_iter` 2000, `n_jobs` 2, seed 18 | dropkick/api.py:461-475 @ bd2647a |
| dropkick | solver | 100 lambdas, `standardize` False, `log_loss`, `cut_point` 1.0 (one standard error), 5 folds | dropkick/api.py:601-606, dropkick/logistic.py:140-142 @ bd2647a |
| dropkick | training labels | first threshold excludes, second splits 0 and 1; excluded cells get score 0 and label false | dropkick/api.py:353-362, 389-400, 622-630 @ bd2647a |
| DropletQC | nf_sep, umi_sep_perc | 0.15, 50 | R/identify_damaged_cells.R:258-259 @ 5d7dadc |
| DropletQC | mixture | `Mclust` G = 1:2, "EEI", on barcodes not called empty | R/identify_damaged_cells.R:325,332 @ 5d7dadc |
| DropletQC | damaged component accepted if | higher NF and lower mean UMI than the other, NF gap > nf_sep, UMI mean < (1 - umi_sep_perc/100) times the other | R/identify_damaged_cells.R:33-62 @ 5d7dadc |
| cellity | classifier | `e1071::svm`, radial kernel, gamma, cost and class weight from each row of the ensemble table; majority vote | R/filter_low_qual_cells.R:166-186, 749-757 @ 36307ee |

## 5. Proposed singlet approach

**Routes** (licences in section 12). `mad`: port the notebook rule; reimplement scuttle's per-batch and sharing semantics from its documented arguments. `fixed`: new design. `miqc`: port. `dropkick`: port the recipe and labels in `api.py`; reimplement the elastic-net solver. DropletQC, cellity, pipeComp, scanpy and Seurat are **callouts** (comparators, not in the enum); the nuclear-fraction rule belongs to `qc.single_nucleus_quality_filtering`.

**Default `mad`**, with the notebook values, the permissive choice recommended in [R4]. No model-based method has yet met the section 8 criteria; `miqc` becomes the default if it meets the B3 criteria with B2 retention no lower than `mad`.

**Proposed model: partially pooled miQC.** Across samples $s$ of one tissue and protocol, $\beta_k^{(s)}=\bar\beta_k+\delta_k^{(s)}$ with $\delta_k^{(s)}\sim\mathcal N(0,\Omega_k)$, and a Dirichlet prior on the weights centred on the pooled weights. Hyperparameters are fitted by empirical Bayes on unlabelled covariates from the singlet catalogue (354 million uniformly processed cells, about 40 percent author-annotated), stratified by tissue and protocol; removal is miQC's. This is a proposal, not a published method. B3 falsifies it if (i) failed fits are not fewer than for per-sample `miqc` on small samples, (ii) $\gamma$ in equal-width bins leaves the planted fraction outside bootstrap intervals over libraries, (iii) recall at false-positive rate 0.05 does not beat per-sample `miqc` by a margin fixed beforehand, or (iv) minimum per-type retention is below 0.95.

**ML stack and kernels.** No deep network is needed: the $K=2$ EM and the elastic-net regression are small models, hard-coded in C++ and as CUDA kernels (one sample per thread block); PyTorch is not used. The metric pass is a CSR row reduction (cuSPARSE masked row sums for gene sets) and median and MAD use selection. Metrics are row-local, so the matrix streams in row blocks and MAD memory is bounded by the largest batch. `dropkick` fits on a stratified subsample at atlas scale and scores all cells in blocks.

**Defaults an agent should use without asking**: `method` mad; `batch_key` set to the library column whenever the dataset holds more than one library; `cell_type_key` set when an annotation exists; `dry_run` first above $10^6$ cells; for `fixed`, `mito_cutoff` set for the tissue.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Raw UMI counts, cells by genes; non-integer layers are rejected. |
| read | var/mito | bool | Mitochondrial gene flag; when absent it is derived from symbols matching `^MT-\|^mt-`. |
| read | var/ribo | bool | Ribosomal gene flag; used only for `obs/qc_pct_ribo`, which never removes a cell. |
| read | obs/`batch_key` | categorical | Batch or sample label, read when `batch_key` is set. |
| read | obs/`cell_type_key` | categorical | Cell-type label, read when `cell_type_key` is set; used only for retention. |
| write | obs/qc_total_counts, obs/qc_n_genes | float32, int32 | Library size $t_i$ and detected genes $d_i$. |
| write | obs/qc_pct_mito, obs/qc_pct_ribo, obs/qc_pct_top20 | float32 | $100\,p_i$, ribosomal percentage (only when `var/ribo` exists) and percentage of counts in the 20 most-expressed genes. |
| write | obs/qc_outlier_lib, obs/qc_outlier_genes, obs/qc_outlier_top20, obs/qc_outlier_mito | bool | Per-rule flags from `mad` and `fixed`; the top-20 flag exists for `mad` only. |
| write | obs/keep_cell | bool | Keep (true) or discard (false); written by every method. |
| write | obs/lowq_prob | float32 in [0, 1] | `miqc`: $\gamma_{i2}$; `dropkick`: one minus the score. Higher means lower quality. |
| write | uns/qc_thresholds | dict | Per batch: medians, MADs and thresholds of each rule, the `fixed` bounds, or the `miqc` cutoff. |
| write | uns/qc_method_report | dict | Method, software version, all parameter values and ignored options, removals by rule, pairwise overlaps of rules, seed, per-sample `miqc` fit diagnostics. |
| write | models/miqc, models/dropkick | model object | Per-sample mixture parameters (`miqc`); elastic-net coefficients, $\lambda$ and $\alpha$ (`dropkick`). |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "mad" | `mad`, `fixed`, `miqc`, `dropkick` | Decision rule: mad (robust MAD rules, default), fixed (hand-set bounds), miqc (per-sample mixture, gives lowq_prob), dropkick (classifier on heuristic labels, gives lowq_prob). |
| `batch_key` | string/null | null | — | obs column naming batches or samples. MAD thresholds and miqc fits are computed per batch; null treats the dataset as one batch. |
| `cell_type_key` | string/null | null | — | obs column with cell-type labels; used only to report the retention of each type after filtering. |
| `mad` | object | — | — | Options for method mad. |
| `mad.nmads_counts` | number/null | 5 | > 0 | MADs from the batch median on log1p total counts and log1p detected genes, both sides; null disables both rules. |
| `mad.nmads_top_genes` | number/null | 5 | > 0 | MADs from the batch median on the percentage of counts in the top 20 genes, both sides; null disables the rule. |
| `mad.nmads_mito` | number/null | 3 | > 0 | MADs above the batch median of the logit mitochondrial fraction; null leaves only mito_cutoff. |
| `mad.mito_cutoff` | number/null | 0.08 | min 0; max 1 | Mitochondrial fraction a cell must also exceed to be flagged (logical AND with nmads_mito); 0 disables. |
| `mad.min_flags` | integer | 1 | min 1; max 4 | Number of the four rules (counts, genes, top-20 share, mitochondrial) that must flag a cell for removal; 2 mimics pipeComp lenient. |
| `mad.scale_mad` | boolean | false | — | Multiply each MAD by 1.4826 (scuttle convention) before applying the nmads multiples. |
| `mad.share_mads` | boolean | false | — | Use one MAD pooled over batches while keeping per-batch medians. |
| `mad.reference_batches` | array/null | null | — | Estimate medians and MADs from these batches only; other batches borrow the pooled estimate. Null estimates every batch from its own cells. |
| `fixed` | object | — | — | Options for method fixed. A null bound is disabled. |
| `fixed.min_genes` | integer/null | 200 | min 0 | Keep a cell only if it has more detected genes than this. |
| `fixed.max_genes` | integer/null | 2500 | min 0 | Keep a cell only if it has fewer detected genes than this. |
| `fixed.min_counts` | integer/null | null | min 0 | Keep a cell only if its total UMIs exceed this. |
| `fixed.max_counts` | integer/null | null | min 0 | Keep a cell only if its total UMIs are below this. |
| `fixed.mito_cutoff` | number/null | 0.05 | min 0; max 1 | Keep a cell only if its mitochondrial fraction is below this; the default is a PBMC convention. |
| `miqc` | object | — | — | Options for method miqc. |
| `miqc.posterior_cutoff` | number | 0.75 | min 0; max 1 | Cells with posterior probability of the compromised component above this are removed before the boundary rules. |
| `miqc.model_type` | string | "linear" | `linear`, `spline`, `polynomial`, `one_dimensional` | Regression of mitochondrial percentage on detected genes in each component; one_dimensional models mitochondrial percentage alone. |
| `miqc.keep_all_below_boundary` | boolean | true | — | Keep cells whose mitochondrial percentage lies below the fitted intact line. |
| `miqc.enforce_left_cutoff` | boolean | true | — | Also remove cells with no more genes and no lower mitochondrial percentage than the least-mitochondrial removed cell. |
| `dropkick` | object | — | — | Options for method dropkick. |
| `dropkick.min_genes` | integer | 50 | min 1 | Barcodes with fewer detected genes are excluded from training and receive score 0 and label false. |
| `dropkick.alpha` | number | 0.1 | min 0; max 1 | Elastic-net mixing parameter: 1 is the lasso, 0 the ridge. |
| `dropkick.n_hvgs` | integer | 2000 | min 1 | Number of highly variable genes used as classifier features. |
| `seed` | integer | 0 | — | Random seed for miqc EM starting values and dropkick cross-validation folds; other methods are deterministic. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

A method ignores the nested options of the others and the ignored options are recorded in `uns/qc_method_report`. `mad` removes a cell flagged by at least `min_flags` of its four rules (the mitochondrial rule is the AND of section 3); `fixed` removes cells outside the strict bounds, and a null bound is disabled; `miqc` removes cells whose `keep` is false after the posterior cutoff and boundary options; `dropkick` removes cells with label false, which includes every cell excluded from training. `seed` acts on `miqc` and `dropkick` only. `miqc` fails when every cell passes. Null `batch_key` treats the dataset as one batch.

## 7. MCP tool

Tool name `singlet_qc_low_quality_cell_detection` (definition in `tasks/mcp/singlet_qc_low_quality_cell_detection.json`). Example call and compact result:

```json
{"dataset": "data/lib.singlet", "method": "mad", "batch_key": "sample_id",
 "cell_type_key": "cell_type", "mad": {"nmads_mito": 3, "mito_cutoff": 0.08}}
```

```json
{"dataset": "data/lib.singlet", "status": "completed",
 "wrote": ["obs/keep_cell", "obs/qc_outlier_mito", "uns/qc_thresholds"],
 "summary": {"method": "mad", "cells_in": "<n>", "cells_removed": "<k>",
   "removed_by_rule": {"lib": "<k>", "genes": "<k>", "top20": "<k>", "mito": "<k>"},
   "batches": "<b>", "min_type_retention": "<r>"},
 "provenance_id": "<id>"}
```

Long-running: large inputs return `queued` with a `job_id`; the size threshold is set by the implementation. Stochastic: `miqc` and `dropkick` through `seed`. Dry-run: `seconds`, `peak_memory_gb` and `device`, estimated from cell count, stored counts, batch count and method.

## 8. Benchmarks

**Shared protocol.** Each metric is computed per dataset and macro-averaged across datasets. A removal decision is `keep_cell`. Retention of a type $t$ is $\mathrm{ret}(t)$ (section 3) and the guardrail is $\min_t\mathrm{ret}(t)$ over types with at least 100 cells. Learned methods are fitted on the dataset under evaluation without its labels. Stochastic methods use seeds 0 to 4 and tables report the mean and range. Comparators run at the section 6 defaults unless stated, and hardware, versions and commits are recorded. B1 and B2 reuse published designs; B3 is constructed by singlet and proposed.

### B1. Accuracy against microscopy-annotated cell status (Ilicic et al. 2016)

- **Goal**: whether a supervised classifier over expression and read-statistic features finds microscopy-annotated low-quality cells more accurately than conventional single-metric filtering [R2].
- **Ground truth**: orthogonal measurement. Each mouse embryonic stem cell carries a binary microscopy quality label (low 0, high 1) recorded by the authors and shipped in the cellity repository, independent of every QC metric.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Training set (`training_mES_features`, `training_mES_labels`) | `data/` of teichlab/cellity [R2]; count accession — | scRNA-seq, mouse ES cells; 960 cells in the article (Figure 1 legend) | section 12 | Precomputed cellity features and labels; no counts. |
| Test set `mES1` (`mES1_features`, `mES1_labels`) | `data/` of teichlab/cellity [R2] | scRNA-seq, mouse ES cells; size — | section 12 | Test set of the package examples. |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Accuracy | Fraction of test cells whose predicted status equals the microscopy label | higher | primary | [R2] |
| Balanced accuracy | Mean of sensitivity and specificity for the low-quality class | higher | primary | [R2] |
| Gain over the conventional rule | $\mathrm{acc}_m/\mathrm{acc}_{\mathrm{conv}}-1$ (relative); the absolute difference is also reported | higher | guardrail | [R2] |

- **Comparators**: cellity as shipped (`assess_cell_quality_SVM` with the bundled parameter tables; callout); the conventional single-metric filter, which singlet reproduces as `fixed` with one bound and records; `mad`, `miqc` and `dropkick` wherever count matrices are available, which the repository does not hold.
- **Protocol**: fit on the training set and evaluate on `mES1`; score outputs are cut at 0.5.
- **Acceptance criterion** (literature): the abstract reports a gain of more than 30 percent in accuracy over traditional methods without stating whether it is relative or absolute; the criterion is a relative gain of at least 0.30 on `mES1`, which requires $\mathrm{acc}_{\mathrm{conv}}\le0.77$, and the absolute gain is reported alongside.
- **Known pitfalls**: the gain is self-reported on mouse ES cells, and microscopy labels are coarse.

### B2. Filtering inside a pipeline with known cell identities (Germain et al. 2020)

- **Goal**: how the filtering step changes the recovery of known subpopulations and the loss of cells from each, with every other step held fixed [R3].
- **Ground truth**: known subpopulation identity per cell in the pipeComp benchmark datasets (the identity vector `phenoid`). Loss of a population is $N_{\mathrm{lost}}/N_{\mathrm{before}}$ for that population, as in pipeComp's `pc.lost`.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| `mixology10x5cl`, `simMix2`, `Zhengmix8eq` | figshare 10.6084/m9.figshare.11787210.v1, as listed in the pipeComp repository [R3] | scRNA-seq with known subpopulations; species and sizes — | — | The three datasets of the pipeComp scRNA vignette. |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Minimum retention | $\min_t\mathrm{ret}(t)=1-\max_t\texttt{pc.lost}/100$ | higher | guardrail | [R3] |
| Mean matched F1 | Clusters are matched one-to-one to populations by the Hungarian algorithm on the F1 matrix (rectangular: populations without a cluster score 0); F1 is averaged over populations | higher | primary | [R3] |
| Adjusted Rand index | Between clusters of the retained cells and their identities | higher | secondary | [R3] |

- **Comparators**: `mad` (`min_flags` 1 and 2), `fixed`, `miqc`, `dropkick`, no filtering, and pipeComp's `filt.lenient` and `filt.stringent` (callouts).
- **Protocol**: the pipeComp scRNA pipeline with Seurat normalisation, 2,000 variable genes, PCA and Seurat clustering; only the filter varies. Clustering metrics are taken at the resolution whose cluster count equals the true number of populations, as in the pipeComp vignette.
- **Acceptance criterion** (proposed): a comparator is acceptable only if its minimum retention is at least 0.95 on every dataset; among acceptable comparators one is preferred over `mad` only if its mean matched F1 exceeds that of `mad` by more than the range over seeds.
- **Known pitfalls**: clusters and identities defined after filtering make the evaluation circular; pipeline-level scores mix filtering with normalisation and feature choices, so only the filter varies.

### B3. Planted low-quality cells in annotated libraries (proposed)

- **Goal**: recall of planted low-quality cells at a fixed false-positive rate, retention of annotated types, and stability of the removal set.
- **Ground truth**: planted at generation; the indicator $z_i$ is exact and hidden from the methods. Recall is normalised by planted cells, the false-positive rate by unplanted cells (an upper bound, since they may contain natural damage).

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Annotated catalogue libraries, at least 12 libraries from 3 tissues and 2 protocols (proposed) | singlet catalogue (354 million cells, about 40 percent author-annotated); accession — | scRNA-seq counts; sizes recorded at selection | per source | Pools split by donor or study. |

- **Generator recipe**
  1. Split libraries by donor or study into calibration and evaluation pools.
  2. For seeds $s=0,\dots,4$ plant a uniform 5 percent of the cells of each library.
  3. For each planted cell draw $f_i\sim U[0.20,0.40]$, thin every non-mitochondrial count binomially with retention 0.30 (leaving $u'_i$), and draw $\operatorname{round}\bigl(f_iu'_i/(1-f_i)\bigr)$ mitochondrial counts multinomially from its mitochondrial profile (the library profile if empty), giving mitochondrial fraction $f_i$.
  4. On the calibration pool set each score threshold so that 5 percent of unplanted cells are flagged; binary rules use their own flags.

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recall at false-positive rate 0.05 | Planted evaluation cells flagged; admissible only if at most 0.05 of unplanted cells are flagged, else the false-positive rate is reported; ties are flagged together | higher | primary | proposed |
| Minimum per-type retention | $\min_t\mathrm{ret}(t)$ on unplanted cells | higher | guardrail | [R8] |
| Removal-set stability | Mean Jaccard index of removed sets from two independent 80 percent subsamples (20 draws), on common cells | higher | guardrail | proposed |

- **Comparators**: `mad` (`scale_mad` false and true), `fixed`, `miqc`, `dropkick`, pipeComp `filt.lenient` (callout); thresholds come from the calibration pool only.
- **Acceptance criterion** (proposed): for the chosen comparator, mean recall at admissible false-positive rate at least 0.90, minimum per-type retention at least 0.95, stability at least 0.90.
- **Known pitfalls**: the planted change is the mitochondrial statistic itself and favours mitochondrial rules; compare planted covariates with real damaged cells before trusting recall.

### P1. Performance and scaling

Wall time, peak host and device memory, and throughput (cells per second and stored counts per second) at $10^4$, $10^5$, $10^6$ and $10^7$ cells (subsamples of the B3 libraries), on one CPU thread, all threads and CUDA, with the number of batches reported. Comparators: scuttle `isOutlier` with a batch argument and scanpy `calculate_qc_metrics` plus the same thresholds for `mad`; the R miQC package for `miqc`; dropkick for `dropkick`. Hold fixed the seed, the CSR input, the mitochondrial gene set and the hardware; time excludes file reading for in-memory inputs. Acceptance (proposed): at $10^6$ cells and equal thread counts, `mad` is no slower than the scanpy path; `miqc` completes every sample or reports each failure; the time ratio between successive decades is at most 1.5 times the ratio of stored counts; on CUDA every scale up to $10^7$ cells completes when device memory suffices. Timings depend on thread count, input/output and device cache state, and `dropkick` subsampling at atlas scale changes the fit, so its speed is compared only with the accuracy of the same configuration.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `cell-calling.nucleus_vs_empty_calling`: Nucleus versus empty-droplet calling in single-nucleus RNA-seq
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
- **Feeds**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `doublets.expression_doublet_scoring`: Expression-based per-cell doublet scoring
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
- **Reads**: `layers/counts`, `var/mito`, `var/ribo`, `obs/<batch_key>`, `obs/<cell_type_key>`
- **Writes**: `obs/qc_total_counts`, `obs/qc_n_genes`, `obs/qc_pct_mito`, `obs/qc_pct_ribo`, `obs/qc_pct_top20`, `obs/qc_outlier_lib`, `obs/qc_outlier_genes`, `obs/qc_outlier_top20`, `obs/qc_outlier_mito`, `obs/keep_cell`, `obs/lowq_prob`, `uns/qc_thresholds`, `uns/qc_method_report`, `models/miqc`, `models/dropkick`
<!-- CHAINING:AUTO:END -->

Related, not chained: `qc.mito_fraction_cutoff_by_tissue` (tissue bounds), `qc.single_nucleus_quality_filtering` (nuclear-fraction rules), `qc.dissociation_stress_detection` (stress signatures). Workflow: the first cell-level QC step after cell calling; no named recipe yet.

## 10. Risks, pitfalls and open questions

- **Ilicic data (B1)**: the count-level accession, the train/test split of the original study, the class balance and the conventional rule behind the reported gain are not stated in the sources used; only cellity's precomputed features and labels are available, so B1 can score cellity alone until counts are located.
- **pipeComp (B2)**: sizes and species of the three datasets and the filter-level results of the article were not examined; only the code, vignette and repository are used. The notebook cites pipeComp for its 5 MADs and the 3 MADs plus 8 percent rule but removes a cell on any single flag, whereas pipeComp's lenient filter requires two.
- **Missing evidence**: no published head-to-head compares MAD rules, fixed bounds, miQC and dropkick on shared truth, and the evaluations in the miQC and dropkick articles were not examined. The miQC example sample (HGSOC, GEO GSM4816047) has no ground truth, and no catalogue subset with curated low-quality labels is known, so neither defines a benchmark. The values 5, 3 and 8 percent are conventions, not data-derived. valiDrops, QClus and COPILOT (listed in scRNA-tools) were not read.
- **Technical risks**: the MAD scale convention and the log pseudocount must follow the reference exactly; miQC fits depend on starting values, so results are repeated over seeds; dropkick removes every cell excluded from training by construction (fewer than `min_genes` genes, or at or below the first Otsu threshold) and the effect of fitting on a catalogue subsample is unmeasured.
- **Scope**: no catalogue task is known to write `obs/nuclear_fraction`, so the nuclear-fraction rule stays outside the enum; the OSCA basic quality-control chapter is absent from the local corpus, so OSCA statements come from the advanced volume [R8]; licences and terms of the B3 catalogue sources are per source.
- **First experiment**: reproduce the notebook thresholds and scuttle's flags to floating-point tolerance, confirm invariance to the logarithm base, check that `miqc` gives a stable removal set over seeds 0 to 4 on one sample, and measure per-type retention of the `mad` default on one annotated library.

## 11. References

R1. Hippen AA, Falco MM, Weber LM, Erkan EP, Zhang K, Doherty JA, Vähärautio A, Greene CS, Hicks SC. miQC: An adaptive probabilistic framework for quality control of single-cell RNA-sequencing data. *PLoS Computational Biology* 2021. doi:10.1371/journal.pcbi.1009290 — verified (corpus)
R2. Ilicic T, Kim JK, Kolodziejczyk AA, Bagger FO, McCarthy DJ, Marioni JC, Teichmann SA. Classification of low quality cells from single-cell RNA-seq data. *Genome Biology* 2016. doi:10.1186/s13059-016-0888-1 — verified (corpus)
R3. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)
R4. Heumos L, Schaar AC, Lance C, Litinetskaya A, Drost F, Zappia L, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w (statements cite the online book chapter Quality Control, quality_control.ipynb) — verified (corpus)
R5. McCarthy DJ, Campbell KR, Lun ATL, Wills QF. Scater: pre-processing, quality control, normalization and visualization of single-cell RNA-seq data in R. *Bioinformatics* 2017. doi:10.1093/bioinformatics/btw777 (the citation given by scuttle) — verified (corpus)
R6. Heiser CN, Wang VM, Chen B, Hughey JJ, Lau KS. Automated quality control and cell identification of droplet-based single-cell data using dropkick. *Genome Research* 2021. doi:10.1101/gr.271908.120 — verified (corpus)
R7. Muskovic W, Powell JE. DropletQC: improved identification of empty droplets and damaged cells in single-cell RNA-seq data. *Genome Biology* 2021. doi:10.1186/s13059-021-02547-0 — verified (corpus)
R8. Amezquita RA, Lun ATL, Hicks SC, Gottardo R. Orchestrating Single-Cell Analysis with Bioconductor, advanced volume, chapter 'Quality control, redux' (source inst/book/more-qc.Rmd in OSCA-source/OSCA.advanced). Bioconductor online book 2022, https://bioconductor.org/books/release/OSCA/. — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/LTLA/scuttle | Aaron Lun (aut, cre), Davis McCarthy (aut), per DESCRIPTION | GPL-3 (DESCRIPTION); no LICENSE file | `isOutlier` semantics and MAD convention | reimplement |
| https://github.com/theislab/single-cell-best-practices | Notebook authors Anna Schaar and Seo H. Kim; reviewers Lukas Heumos and Luke Zappia | Apache License 2.0 (LICENSE, copyright 2021 Theislab) | Notebook MAD and 8 percent rule | port |
| https://github.com/scverse/scanpy | Maintainers Ilan Gold, Philipp Angerer, Severin Dicks, per pyproject.toml | BSD-3-Clause (LICENSE) | `calculate_qc_metrics`, tutorial bounds, P1 comparator | callout |
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and further contributors, per DESCRIPTION | MIT + file LICENSE (DESCRIPTION; copyright holder Seurat authors) | Tutorial bounds | callout |
| https://github.com/greenelab/miQC | Ariel Hippen (aut, cre), Stephanie Hicks (aut), per DESCRIPTION | BSD-3-Clause (LICENSE, copyright 2021 Greene Laboratory) | Reference mixture and boundary options | port |
| https://github.com/KenLauLab/dropkick | Cody Heiser (setup.py) | MIT (LICENSE, copyright Cody N Heiser); vendored python-glmnet and glmnet under GNU GPL version 2 (LICENSES/) | Reference labels, recipe and elastic-net defaults | port `api.py`; reimplement solver |
| https://github.com/powellgenomicslab/DropletQC | Walter Muskovic (aut, cre), per DESCRIPTION | MIT + file LICENSE (DESCRIPTION) | Nuclear-fraction damaged-cell rule | callout |
| https://github.com/teichlab/cellity | Tomislav Illicic (aut, cre), Davis McCarthy (aut), per DESCRIPTION | GPL (>= 2) (DESCRIPTION); no LICENSE file | Supervised comparator and B1 data | callout |
| https://github.com/plger/pipeComp | Pierre-Luc Germain (cre, aut), Anthony Sonrel (aut), Mark D. Robinson (aut, fnd), per DESCRIPTION | GPL (DESCRIPTION); LICENSE file is GNU GPL version 3 | B2 framework, lenient and stringent filters | callout |
