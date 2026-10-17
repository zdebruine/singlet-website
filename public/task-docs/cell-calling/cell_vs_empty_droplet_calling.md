---
id: cell-calling.cell_vs_empty_droplet_calling
title: Cell versus empty-droplet calling (barcode level)
area: cell-calling
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [harmonization.count_matrix_state_detection, ingest-quant.umi_deduplication]
feeds: [cell-calling.cell_count_cutoff_selection, cell-calling.residual_empty_droplet_removal, ambient.contamination_fraction, qc.low_quality_cell_detection, doublets.expression_doublet_scoring, normalization.size_factor_estimation]
reads: [raw/counts, obs/<sample_key>]
writes: [obs/cell_call_is_cell_<method>, obs/cell_call_prob_<method>, obs/cell_call_pvalue_<method>, obs/cell_call_fdr_<method>, obs/cell_call_limited_<method>, uns/cell_call_ambient_profile_<method>, uns/cell_call_params_<method>, uns/cell_call_summary_<method>, models/cell_call_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_cell_calling_cell_vs_empty_droplet_calling
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Cell versus empty-droplet calling (barcode level)

> Decide, for every barcode of one unfiltered droplet channel, whether it holds a cell or only cell-free RNA, and state the false-call rate and the sensitivity for low-RNA cells that the decision implies.

## 1. Question

Given the unfiltered droplet-by-gene UMI matrix of one channel, which barcodes contain a cell and which contain only cell-free (ambient) RNA, and what error rate attaches to the calls, including sensitivity for low-RNA cell types near the boundary? Droplet data have no complete ground truth, so correctness is judged against a planted simulation (label known by construction), a species-mixing design whose label does not depend on the caller, or an orthogonal measurement such as the nuclear fraction. The output is a per-barcode call and, where the method has one, a score. Choosing the final score or FDR cut is a separate task, `cell-calling.cell_count_cutoff_selection`.

## 2. Why this task matters and where the field stands

Every droplet workflow begins by deciding which barcodes to keep. A droplet without a cell still captures cell-free RNA and produces UMI counts, so normalisation, clustering, doublet scoring and ambient correction inherit errors made here; the background is shared by all droplets of a channel, which couples calling to ambient estimation [R1]. A total-count threshold unnecessarily discards libraries from cell types with low RNA content, which motivates testing composition instead [R3, R4]. Cell Ranger version 3 replaced a total-count rule by an algorithm similar to EmptyDrops [R3, R11].

The task is **contested**. The methods rest on different principles, and the comparisons cited here are developer-run [R4, R7]: EmptyDrops tests each barcode against an ambient null with Monte Carlo p-values [R4]; dropkick fits an elastic-net logistic model to automatically labelled barcodes [R5]; EmptyNN trains a positive-unlabelled network [R6]; CellBender is a generative model that returns a cell probability per droplet [R8]; Cell Ranger combines an order-of-magnitude rule with an EmptyDrops-like test [R13]. Open problems:

- **Low-RNA recall.** Real-data evidence for recovering low-RNA cell types is qualitative [R4]; no independent ground truth for this recall exists.
- **The ambient definition.** `lower` or a rank window sets the null. OSCA adjusts `lower` by inspecting the ambient p-value histogram [R3]; no data-driven rule is validated.
- **High-total cell-free droplets.** After EmptyDrops filtering, a nuclear-fraction rule labelled a further 0.4% (PBMC), 4.0% (glioblastoma), 6.0% (Hodgkin's lymphoma) and 9.5% (mouse brain) of barcodes as empty [R7].
- **Non-stationary ambient composition** across plates, chips or lanes is modelled by none of the callers in section 4.
- **Versioned vendor behaviour.** Cell Ranger version 2 used a total-count rule [R11]; the current source uses chemistry-dependent rank windows and FDR levels [R13]; emptyDropsCellRanger approximates version 3 [R11].

## 3. Theory and insight

**Notation.** Barcode $j$, gene $g$; $y_{jg}$ is the UMI count and $n_j=\sum_g y_{jg}$ the barcode total. $\boldsymbol\pi$ is the ambient composition (sums to 1) estimated from barcodes with $n_j\le L$ (`lower`); $\mathbf c$ is a cell composition; $N$ is `niters`; $m$ the number of tested barcodes; $R$ the retention total.

| Symbol | Meaning |
|---|---|
| $\alpha$ | Dirichlet-multinomial overdispersion; never a significance level |
| $\gamma$ | elastic-net mixing weight of dropkick (its glmnet `alpha`) |
| $p_j$ | Monte Carlo p-value; not the probability that $j$ is empty |
| $\omega_j$ | posterior probability that $j$ holds a cell (`eb_mixture` only) |

**3.1 Mixture view.** A barcode holding a cell has expected composition $\mathbb E[y_{jg}\mid n_j]=n_j[(1-\rho_j)c_{jg}+\rho_j\pi_g]$ with ambient fraction $\rho_j$; an empty barcode has $\rho_j=1$. Composition tests (EmptyDrops) compare likelihoods under the two compositions, classifiers (dropkick, EmptyNN, CellBender) learn a rule, and total-count rules ignore composition, which is why they fail for small cells whose composition is distinct but whose totals are small.

**3.2 Multinomial null and detection power.** Under the null, $\mathbf y_j\sim\mathrm{Mult}(n_j,\boldsymbol\pi)$. Against a multinomial alternative $\mathbf c$ the log-likelihood ratio is $\Lambda_j=\sum_g y_{jg}\log(c_g/\pi_g)$, a sum of $n_j$ independent terms. Exactly, at any $n_j$ and under $\mathbf c$, $\mathbb E\Lambda_j=n_j\,\mathrm{KL}(\mathbf c\Vert\boldsymbol\pi)$ and $\mathrm{Var}\,\Lambda_j=n_j\sigma_{\mathbf c}^2$ with $\sigma_{\mathbf c}^2=\mathrm{Var}_{g\sim\mathbf c}\log(c_g/\pi_g)$. The standardised signal $\sqrt{n_j}\,\mathrm{KL}/\sigma_{\mathbf c}$ is a normal approximation that needs large $n_j$; at the small totals near the boundary the distribution is discrete and skewed. Power falls with $\sqrt{n_j}$ and with small divergence, so a low-RNA type close to ambient is the hardest case. This concerns the likelihood-ratio test for a known $\mathbf c$; EmptyDrops uses the null probability as statistic, so the scaling is indicative.

**3.3 Monte Carlo p-value and its floor.** With $\lambda_j=\log P(\mathbf y_j\mid\boldsymbol\pi)$ and $N$ count vectors drawn from the null at total $n_j$, $p_j=\bigl(1+\#\{s:\lambda_j^{(s)}\le\lambda_j\}\bigr)/(N+1)$ [R11]. The smallest value is $1/(N+1)$ [R10], flagged `Limited`. After Benjamini-Hochberg correction over $m$ tested barcodes (retained barcodes included, with $p=0$), $r$ retained barcodes and $K$ floor barcodes make every floor barcode significant at level $q$ whenever $m/((r+K)(N+1))\le q$ (sufficient, not necessary); with $N=10^4$ and $q=10^{-3}$ this needs $r+K\ge m/10$.

**3.4 Overdispersed null.** $P(\mathbf y_j\mid\alpha,\boldsymbol\pi)=\dfrac{n_j!\,\Gamma(\alpha)}{\Gamma(n_j+\alpha)}\prod_g\dfrac{\Gamma(y_{jg}+\alpha\pi_g)}{\Gamma(\alpha\pi_g)\,y_{jg}!}$ reduces to the multinomial as $\alpha\to\infty$ (the default). Maximum-likelihood $\alpha$ fitted on barcodes at or below `lower` is valid only if those barcodes are cell-free; otherwise it describes the contaminated mixture. With `test.ambient` on, the p-values of barcodes at or below `lower` should be near uniform; a peak near zero shows that they are not all ambient and `lower` should be reduced [R3].

**3.5 FDR with knee retention.** $\mathrm{FDR}_{(i)}=\min_{k\ge i}\min\bigl(1,\,m\,p_{(k)}/k\bigr)$ with $p_j\leftarrow0$ when $n_j\ge R$. The default $R$ is the knee total of the barcode-rank curve; it may be set manually when the knee is misidentified in complex curves [R11]. The FDR estimand is the expected fraction of called barcodes of one channel that are empty, assuming every barcode at or below $L$ is empty, the ambient composition is common and retained barcodes are cells [R3, R11]. It is controlled when the null p-values are valid and the usual dependence conditions of the procedure hold; the reported FDR cannot be recovered by `p.adjust` on the reported p-values [R11].

**3.6 Heuristic rules.** defaultDrops keeps barcodes above 0.1 times the 0.99 quantile of the totals of the top expected barcodes (Cell Ranger version 2) [R11]. The knee traces a window along the log-log rank curve [R11]. Cell Ranger's current rule is an order-of-magnitude stage followed by an EmptyDrops-like test [R13]. Rules work when cell and ambient totals separate on the rank curve, and are cheap and reproducible. They fail systematically: a totals-only rule cannot tell a small cell from a large ambient droplet, and knee methods can be overly conservative and unstable where no clear knee exists [R2].

**3.7 Learned models.** dropkick [R5] minimises $-\frac1T\sum_i[y_i\eta_i-\log(1+e^{\eta_i})]+\lambda\bigl[\tfrac{1-\gamma}{2}\lVert\boldsymbol\beta\rVert_2^2+\gamma\lVert\boldsymbol\beta\rVert_1\bigr]$ with $\eta_i=\beta_0+\mathbf x_i^\top\boldsymbol\beta$ over $T$ training barcodes. Features $\mathbf x_i$ are arcsinh-transformed, gene-scaled highly variable genes; by default, labels $y_i$ come from a multi-Otsu threshold on arcsinh genes detected; $\lambda$ is chosen by five-fold cross-validated log-loss with the one-standard-error rule, and a barcode is a cell when its probability is the larger of the two classes (section 4). The probability is only as calibrated as the labels, which come from a quality-control feature, so the classifier can reproduce the labelling rule. EmptyNN [R6] labels barcodes with totals from 10 to a threshold as negatives (set P), a fold of the rest as positives, predicts the other folds, and calls a cell when the mean prediction exceeds 0.5; it is valid only if P is pure, yet low-RNA cells below the threshold enter P as negatives. CellBender [R8] infers a latent cell probability per droplet together with the ambient profile and denoised counts; its probability is calibrated only to its own generative model.

**3.8 What a model-based formulation adds.** A p-value is $\Pr(\text{statistic}\ge\text{observed}\mid\text{empty})$, not $\Pr(\text{empty}\mid\text{data})$. A posterior $\omega_j=\Pr(z_j=1\mid\mathbf y_j)$ needs an explicit alternative and prior and gives an expected false-call rate $\sum_{j\in S}(1-\omega_j)/\lvert S\rvert$ for any set $S$. Both are only as good as the model; section 5 tests this.

**3.9 Failure modes.** One ambient composition per channel is assumed. A `lower` that is too high puts cells into the ambient profile; one that is too low leaves few barcodes for the null. Debris, doublets and fragments among ambient barcodes make multinomial p-values anti-conservative. A low FDR among calls says nothing about uncalled cells, so sensitivity needs a truth with low-RNA cells.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| EmptyDrops (`emptyDrops`) | model-based | Good-Turing ambient profile from pooled barcodes at or below `lower`; per-barcode Monte Carlo multinomial test; BH FDR; barcodes at or above the knee total retained | [R4, R11] |
| emptyDropsCellRanger, STARsolo EmptyDrops_CR | hybrid | Simple filtering keeps barcodes above a fraction of a high quantile of the top expected cells; a rank window gives the ambient pool; candidates between the thresholds go through the EmptyDrops test | [R9, R11] |
| defaultDrops, STARsolo CellRanger2.2 | heuristic | Keeps barcodes above `lower.prop` times the `upper.quant` quantile of the totals of the top `expected` barcodes | [R9, R11] |
| barcodeRanks knee and inflection | heuristic | Window traced along the log-log rank curve; the knee is the window midpoint above its end-connecting line with the shortest such line | [R11] |
| Total-count cut-off | heuristic | Fixed threshold on totals; discards low-RNA libraries | [R3] |
| Cell Ranger cell calling | hybrid | Bootstrapped order-of-magnitude rule on totals, then an EmptyDrops-like test with a Simple Good-Turing ambient profile from a rank window, 100,000 simulations and BH | [R13] |
| dropkick | model-based | Elastic-net logistic regression on scaled highly variable genes, trained on labels from an automatic threshold of genes detected | [R5] |
| EmptyNN | model-based | Positive-unlabelled feed-forward network (256 and 128 units) with cross-validated predictions averaged over iterations | [R6] |
| CellBender remove-background | model-based | Unsupervised deep generative model with a latent per-droplet cell probability and denoised counts | [R8] |
| DropletQC | hybrid | Nuclear fraction per barcode (intronic over intronic plus exonic reads); cut at the first minimum of its kernel density estimate, with rescue of barcodes of high fraction and total | [R7, R12] |

The statistical standard is EmptyDrops with its documented defaults; its FDR level of 0.001 is the OSCA example choice, not a benchmark-derived optimum [R3]. The reference behaviour pipelines reproduce is Cell Ranger's [R13], approximated by emptyDropsCellRanger and STARsolo [R9, R11]. singlet keeps EmptyDrops as default and the rule-based, Cell Ranger, dropkick, EmptyNN, CellBender and DropletQC calls as comparators until section 8 decides.

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| emptyDrops | `lower`, `niters`, `alpha`, `test.ambient`, `ignore` | 100, 10000, Inf (multinomial), FALSE, NULL | R/emptyDrops.R:188 @ ba4152d |
| emptyDrops | `retain` | NULL: knee total of `barcodeRanks`; barcodes with total at or above it get p = 0 before correction | R/emptyDrops.R:399-404 @ ba4152d |
| emptyDrops | p-value, correction | (1 + simulated log-probabilities at most the observed) / (`niters` + 1), `Limited` when none; BH via `p.adjust` | R/emptyDrops.R:253,412; src/montecarlo_pval.cpp @ ba4152d |
| emptyDrops | ambient profile | Good-Turing proportions of the summed low-count barcodes, with a pseudo-feature for zero counts | R/ambientProfileEmpty.R:132,179 @ ba4152d |
| emptyDrops | `alpha = NULL` | maximum likelihood on the interval 0.01 to 10000 | R/emptyDrops.R:355 @ ba4152d |
| barcodeRanks | `lower`, `exclude.from`, `window` (log10), `gradient.threshold` | 100, 50, 1, -1; `fit.bounds` and `df` are deprecated and ignored | R/barcodeRanks.R:14,86 @ ba4152d |
| emptyDropsCellRanger | `n.expected.cells`, `max.percentile`, `max.min.ratio`, `umi.min`, `umi.min.frac.median`, `cand.max.n`, `ind.min`, `ind.max`, `niters` | 3000, 0.99, 10, 500, 0.01, 20000, 45000, 90000, 10000 | R/emptyDropsCellRanger.R:103-116 @ ba4152d |
| STARsolo EmptyDrops_CR | same values plus FDR and `simN` | FDR 0.01, 10000 | source/parametersDefault:906-907 @ b1edc12 |
| STARsolo CellRanger2.2 | expected cells, percentile, ratio | 3000, 0.99, 10 | source/parametersDefault:898 @ b1edc12 |
| defaultDrops | `expected`, `upper.quant`, `lower.prop` | 3000, 0.99, 0.1 | R/defaultDrops.R:58 @ ba4152d |
| Cell Ranger | minimum UMI of candidates, simulations | 500, 100000 | lib/python/cellranger/cell_calling.py:41,43 @ 669395e |
| Cell Ranger | FDR | 0.001 for the 3' v3, v4, 5' and HT chemistries listed, else 0.01 | cell_calling.py:105-110 @ 669395e |
| Cell Ranger | ambient rank window | (n_partitions/2, n_partitions), n_partitions 90000 or 160000 by chemistry, other values for multiplexed ones | cell_calling.py:113-141 @ 669395e |
| Cell Ranger | order-of-magnitude stage | 100 bootstraps, 0.99 quantile, 0.1 factor | lib/python/cellranger/cell_calling_helpers.py:53-54,902 @ 669395e |
| dropkick | `min_genes`, `mito_names`, `n_ambient`, `n_hvgs`, `metrics`, `thresh_methods`, `directions` | 50, `^mt-\|^MT-`, 10, 2000, arcsinh genes detected, multiotsu, above | dropkick/api.py:463-469 @ bd2647a |
| dropkick | `alphas`, `max_iter`, `n_jobs`, `seed` | [0.1], 2000, 2, 18 | dropkick/api.py:470-473 @ bd2647a |
| dropkick | `n_lambda`, `scoring`, `cut_point`, `n_splits`; HVG flavour | 100, log_loss, 1.0, 5; Seurat, 20 bins | dropkick/api.py:600-606,159 @ bd2647a |
| dropkick | label rule | class with the larger predicted probability | dropkick/logistic.py:578-581 @ bd2647a |
| EmptyNN | `threshold`, `k`, `iteration`, `batch_size`, `epoch` | 100, 5, 5, 16, 10 | R/emptynn.R:2-3 @ e1e6226 |
| EmptyNN | set P, genes, call | totals 10 to `threshold`, at most 10000 sampled; 2000 genes of highest summed count in P; mean prediction above 0.5 | R/emptynn.R:13-34,91 @ e1e6226 |
| CellBender | `epochs`, `fpr`, `model`, `z-dim` | 150, 0.01, full, 64 | cellbender/remove_background/argparser.py:138,194,120,152 @ f36ae29 |
| CellBender | cell probability cut, minimum UMI, droplets analysed | 0.5, 5, 25000 | cellbender/remove_background/consts.py:23,27,30 @ f36ae29 |
| DropletQC | `nf_rescue`, `umi_rescue` | 0.05, 1000 | R/identify_empty_drops.R:45-46 @ 5d7dadc |
| DropletQC | nuclear fraction, tags | intronic over intronic plus exonic reads; tags CB, RE, E, N | R/nuclear_fraction_tags.R:83,172-175 @ 5d7dadc |

## 5. Proposed singlet approach

**Default.** `emptydrops`, the default of the MCP `method` enum: an explicit null, calibrated tail probabilities and an FDR statement, at FDR 0.001 with knee retention. `emptydrops_cr` and `defaultdrops` reproduce Cell Ranger rules, `dropkick` is a learned comparator and `eb_mixture` has no upstream code; EmptyNN, CellBender, DropletQC and Cell Ranger are external comparators, not enum values.

**Proposed model, `eb_mixture`.** Per channel, with latent cell indicator $z_j$:

$$\mathbf y_j\mid z_j=0\sim\mathrm{DM}(n_j;\alpha,\boldsymbol\pi),\qquad \mathbf y_j\mid z_j=1\sim\sum_{k=1}^{K}w_k\,\mathrm{Mult}(n_j;\boldsymbol\theta_k),\qquad \Pr(z_j=1)=\varpi.$$

$\boldsymbol\pi$ and $\alpha$ come from barcodes at or below `lower` as in EmptyDrops; the profiles $\boldsymbol\theta_k$ are fitted by EM on barcodes with $n_j\ge R$, then $w_k$ and $\varpi$ on all barcodes above `lower`. The posterior is $\omega_j=\varpi L_j^{(1)}/(\varpi L_j^{(1)}+(1-\varpi)L_j^{(0)})$ for the mixture and null likelihoods; the call set is the largest set ranked by $\omega_j$ whose mean $1-\omega_j$ is at most $q$. Risk: profiles fitted on high-total barcodes may miss low-RNA types or absorb ambient-like composition.

**Falsifiers** (proposed thresholds, on B1 and B2).
- *Null calibration*: observed `emptydrops` FDR at $q=10^{-3}$ above $2q$, or over 10% of non-limited ambient p-values at or below 0.05 (flat gives 5%), which rejects the multinomial null.
- *Posterior calibration*: gap between posterior-expected and observed FDR above 0.01 for cuts between $10^{-3}$ and $5\times10^{-2}$ in more than one B2 design.
- *Low-RNA gain*: at matched observed FDR of at most 0.01, no higher recall than `emptydrops` in the lowest B2 quintile or on G2 of B1, or observed FDR above $2q$.

**Stack and kernels.** dropkick (a GLM) and the `eb_mixture` EM (a sparse product and a log-sum-exp) are hard-coded in CUDA/cuSPARSE; no pretrained weights. The 354M-cell catalogue holds filtered cells: it can inform a profile prior, not supply empties. The Monte Carlo null draws one cumulative sequence per iteration from a counter-based generator keyed on (seed, iteration) and reads the running log-probability at each distinct barcode total, as DropletUtils and STARsolo do, so calls do not depend on threads or device. Memory grows with $m$ (BH needs every p-value) and the nonzeros; CPU and CUDA calls agree within numerical tolerance.

**Agent defaults.** The schema defaults; do not change the method to obtain more calls.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | raw/counts | sparse int | droplet-by-gene UMI counts of one channel, unfiltered, including low-total barcodes |
| read | obs/<sample_key> | string | channel label; the tool runs once per level |
| write | obs/cell_call_is_cell_<method> | bool | call per barcode |
| write | obs/cell_call_prob_<method> | float32 in [0,1] | `dropkick` predicted probability; `eb_mixture` posterior $\omega_j$; NaN otherwise |
| write | obs/cell_call_pvalue_<method> | float32 | Monte Carlo p-value (`emptydrops`, `emptydrops_cr`); NaN where untested |
| write | obs/cell_call_fdr_<method> | float32 | BH FDR, zero for retained or simple-filter barcodes; for `eb_mixture` the smallest posterior-expected false-call rate of a ranked set containing the barcode; NaN where untested |
| write | obs/cell_call_limited_<method> | bool | p-value at the floor $1/(N+1)$ |
| write | uns/cell_call_ambient_profile_<method> | float64 over genes | ambient composition $\boldsymbol\pi$, sums to 1 |
| write | uns/cell_call_params_<method> | dict | every resolved parameter, including the retain total, rank window and `alpha` |
| write | uns/cell_call_summary_<method> | dict | per-channel counts and warnings (section 7) |
| write | models/cell_call_<method> | model artefact | fitted weights of `dropkick` and `eb_mixture` |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `sample_key` | string | "sample" | — | Obs column naming the channel; the tool runs once per level because ambient composition differs between channels. |
| `method` | string | "emptydrops" | `emptydrops`, `emptydrops_cr`, `defaultdrops`, `dropkick`, `eb_mixture` | Calling method. emptydrops is the default; emptydrops_cr and defaultdrops reproduce Cell Ranger rules; dropkick is a learned comparator; eb_mixture is the proposed posterior model. |
| `fdr` | number/null | null | > 0; < 1 | FDR (emptydrops, emptydrops_cr) or posterior-expected FDR (eb_mixture) cut for calls. Null selects 0.001, or 0.01 for emptydrops_cr. |
| `expected_cells` | integer/null | null | min 1 | Expected cell count for the rank rule (emptydrops_cr, defaultdrops). Null uses 3000. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Seed for Monte Carlo draws, cross-validation folds and initialisation; unused by defaultdrops. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members of the same method suffix instead of failing. |
| `emptydrops` | object | — | — | Options for emptydrops; eb_mixture also reads lower and alpha. |
| `emptydrops.lower` | integer | 100 | min 1 | Total at or below which barcodes define the ambient profile and are not tested. |
| `emptydrops.niters` | integer | 10000 | min 1000 | Monte Carlo draws per tested barcode; the smallest p-value is 1/(niters+1). |
| `emptydrops.alpha` | number/string | "inf" | — | Dirichlet-multinomial overdispersion: a positive number, 'estimate' (fit on barcodes at or below lower) or 'inf' (multinomial). |
| `emptydrops.retain` | integer/string/null | null | — | Total at or above which barcodes are always called; null uses the knee total; 'disabled' turns retention off. |
| `emptydrops.test_ambient` | boolean | false | — | Also test barcodes at or below lower for the p-value histogram diagnostic; their FDR stays NaN. |
| `emptydrops_cr` | object | — | — | Options for emptydrops_cr; other constants follow STARsolo (section 4 of the task document). |
| `emptydrops_cr.ambient_rank_window` | array | [45000, 90000] | — | Rank window of barcodes forming the ambient pool; Cell Ranger 10.1.0 uses larger windows for some chemistries. |
| `emptydrops_cr.umi_min` | integer | 500 | min 0 | Minimum total for a barcode to enter the candidate pool. |
| `dropkick` | object | — | — | Options for dropkick. |
| `dropkick.min_genes` | integer | 50 | min 0 | Minimum genes detected for a barcode to be modelled; others are labelled empty. |
| `dropkick.n_hvgs` | integer | 2000 | min 1 | Number of highly variable genes used as classifier features. |
| `dropkick.enet_alpha` | number | 0.1 | min 0; max 1 | Elastic-net mixing weight; 1 is lasso and 0 is ridge. |
| `dropkick.mito_pattern` | string | "^mt-\|^MT-" | — | Regular expression identifying mitochondrial genes. |
<!-- PARAMS:AUTO:END -->

Cross-parameter rules. `fdr` applies to `emptydrops`, `emptydrops_cr` and `eb_mixture`; `expected_cells` to `emptydrops_cr` and `defaultdrops`; a nested object applies only to its own method and a mismatch is rejected. `eb_mixture` takes `lower` and `alpha` from the `emptydrops` object. `seed` is used by every method except `defaultdrops`. Pooled channels are rejected: the tool runs once per `sample_key` level because ambient composition differs between channels. The matrix must be unfiltered.

## 7. MCP tool

Tool name `singlet_cell_calling_cell_vs_empty_droplet_calling` (definition in `tasks/mcp/singlet_cell_calling_cell_vs_empty_droplet_calling.json`).

```json
{"dataset": "/data/channel_01.singlet", "sample_key": "sample", "method": "emptydrops",
 "fdr": 0.001, "emptydrops": {"lower": 100, "niters": 10000}, "device": "cpu", "seed": 0}
```

```json
{"dataset": "/data/channel_01.singlet", "status": "completed",
 "wrote": ["obs/cell_call_is_cell_emptydrops", "obs/cell_call_pvalue_emptydrops",
           "obs/cell_call_fdr_emptydrops", "uns/cell_call_params_emptydrops"],
 "summary": {"method": "emptydrops", "per_sample": [{"sample": "<id>", "n_barcodes": "<int>",
   "n_tested": "<int>", "n_called": "<int>", "retain_total": "<int>", "n_limited": "<int>",
   "warnings": []}]}, "provenance_id": "<id>"}
```

Long-running: may return `queued` with a `job_id` for large matrices or `dropkick` fits. Stochastic through `seed` for every method except `defaultdrops`. Dry-run: `seconds`, `peak_memory_gb` and `device` from a cost model, not a measurement. Warnings are a closed set: `limited_pvalues`, `few_ambient_barcodes`, `no_knee`, `ambient_histogram_peaked`.

## 8. Benchmarks

**Shared protocol.** Every caller receives the unfiltered matrix of one channel and is scored per channel, never pooled. FDR-based methods use $q=10^{-3}$ and the defaults of section 4; `dropkick` uses its probability rule and `defaultdrops` its fixed rule; the total-count comparator thresholds at the knee total reported by `emptydrops`. Barcodes without a label are excluded from numerators and denominators, and their number is reported. No parameter is tuned on benchmark labels, and generator seeds are fixed before analysis. External comparators (DropletUtils, STARsolo, dropkick, EmptyNN, CellBender, and Cell Ranger where its output exists) are taken at the commits of section 12.

### B1. Planted low-RNA cells and empties (proposed)

- **Goal**: test whether a caller keeps low-RNA cells that a total-count threshold removes at near-nominal observed FDR; cf. the simulations of [R4].
- **Ground truth**: planted simulation from a real unfiltered channel with known labels G1 (cell), G2 (low-RNA cell) and E (empty).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Parent_NGSC3_DI_PBMC | 10x Genomics, URL in [R12] | scRNA-seq, human PBMC, about 10k cells | — | template |
| Parent_SC3v3_Human_Glioblastoma | 10x Genomics, URL in [R12] | 3' v3 scRNA-seq, human tumour, about 5k cells | — | template |

- **Generator recipe**: (1) take the template's unfiltered matrix and knee total $R$; (2) split barcodes with $n_j\ge R$ at random into G1 (unchanged) and G2 (UMI kept with probability 0.1; barcodes thinned to at most `lower` dropped); (3) form E by summing random template barcodes with $n_j\le100$ to a target total drawn log-uniformly from 101 to $R/2$; (4) replace template barcodes above `lower` by G1, G2 and E; `expected_cells` $=\lvert G1\rvert+\lvert G2\rvert$.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recall of G2 | called G2 over all G2 | higher | primary | proposed |
| Recall of G1 | called G1 over all G1 | higher | guardrail | proposed |
| Observed FDR | called E over called labelled; 0 if none called | lower | primary | [R4] |
| G2 recall at FDR 0.001 | best G2 recall over score thresholds with observed FDR at most 0.001 | higher | primary | proposed |

- **Comparators and protocol**: total-count threshold, `defaultdrops`, `emptydrops_cr`, `emptydrops`, `dropkick`, `eb_mixture`; 2 templates by 3 seeds; $q\in\{10^{-4},10^{-3},10^{-2}\}$.
- **Acceptance criterion** (proposed): `emptydrops` observed FDR at most 0.002 in every planted dataset, G2 recall at least 0.5 at $q=10^{-3}$, and G2 recall above the total-count threshold's at matched observed FDR.
- **Known pitfalls**: thinning preserves composition whereas real low-RNA types differ, so G2 recall is optimistic; summed E approaches the multinomial null at large totals, so B2 and B3 are non-circular checks.

### B2. Species mixture with a caller-independent label (proposed)

- **Goal**: measure false calls among mixed-composition empties and recall of low-total cells against a label independent of the caller's null.
- **Ground truth**: orthogonal measurement. $h_j$ is the fraction of barcode $j$'s UMI on species A genes of a combined reference. Cell-containing: $n_j\ge L_c$, a single-species cell if $\max(h_j,1-h_j)\ge0.9$ and a cross-species doublet if $\min(h_j,1-h_j)\ge0.1$. Empty: $n_j<L_c$ and $\min(h_j,1-h_j)\ge0.1$. Others are unlabelled. The empty label is informative only when ambient RNA of both species is balanced.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 10x HGMM 12k | CellBender benchmark list (benchmarking/README.md) | scRNA-seq, human and mouse | — | unfiltered matrix required |
| Generated mixtures, two or more proportions | generator below | scRNA-seq, human and mouse | set by the generator | sizes set by the generator |

- **Generator recipe**: (1) mix two single-species suspensions at known proportions, one channel each; (2) export the unfiltered matrix on a combined reference before calling; (3) compute $h_j$ from gene species; (4) fix $L_c=500$ beforehand and report it; (5) freeze labels and proportions, apply the callers and report the unlabelled fraction.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Observed FDR | called empty-labelled over called labelled barcodes | lower | primary | proposed |
| Low-total recall | called over all cells in the lowest total-UMI quintile of labelled cells | higher | primary | proposed |
| Calibration gap | `eb_mixture` mean absolute gap between posterior-expected and observed FDR for cuts with expected FDR in $[10^{-3},5\times10^{-2}]$ | lower | guardrail | proposed |

- **Comparators and protocol**: `emptydrops`, `emptydrops_cr`, `dropkick`, `eb_mixture`, total-count threshold, CellBender with expected cells supplied; all proportions at two depths.
- **Acceptance criterion** (proposed): `emptydrops` observed FDR at most 0.001 and low-total recall at least 0.8; `eb_mixture` calibration gap at most 0.01 with low-total recall at least that of `emptydrops`.
- **Known pitfalls**: the empty label covers only mixed-composition empties, so observed FDR is a lower bound; recall is measured above $L_c$ only.

### B3. Nuclear-fraction audit of called barcodes (Muskovic and Powell 2021)

- **Goal**: estimate the fraction of called barcodes that are still cell-free, from the nuclear fraction in the alignments [R7].
- **Ground truth**: orthogonal measurement. Nuclear fraction is intronic over intronic plus exonic reads of the barcode; `identify_empty_drops` at defaults labels a barcode empty below the first density minimum unless the fraction exceeds 0.05 with more than 1000 UMI [R12]. A proxy, valid for single-cell libraries with a separate low-fraction peak; barcodes above 15% mitochondrial content are excluded, as in the published set [R12].
- **Datasets** (10x Genomics pages listed in [R12]; unfiltered matrix and BAM required)

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Parent_NGSC3_DI_PBMC | 10x Genomics | scRNA-seq, human, about 10k cells | — | reported residual 0.4% [R7] |
| Parent_SC3v3_Human_Glioblastoma | 10x Genomics | 3' v3 scRNA-seq, human, about 5k cells | — | reported residual 4.0% [R7] |
| Parent_NGSC3_DI_HodgkinsLymphoma | 10x Genomics | scRNA-seq, human, about 5k cells | — | reported residual 6.0% [R7] |
| SC3_v3_NextGem_DI_Neuron_10K | 10x Genomics | 3' v3 scRNA-seq, mouse E18 brain, about 10k cells | — | reported residual 9.5% [R7] |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Residual empty fraction | called barcodes labelled empty divided by called barcodes | lower | primary | [R7] |
| Interval | 95% bootstrap interval over called barcodes (1000 resamples) | report | guardrail | proposed |
| Retained cells | called barcodes not labelled empty, relative to `emptydrops` | higher | guardrail | proposed |

- **Comparators**: `emptydrops` (primary), `emptydrops_cr`, `dropkick`, `eb_mixture`.
- **Protocol**: call, compute the fraction from BAM tags CB and RE, apply the rule at defaults and report per dataset beside the published values.
- **Acceptance criterion** (proposed): a new caller has residual fraction at most that of `emptydrops` on every dataset, with retained cells at least 0.98.
- **Known pitfalls**: nuclear fraction and UMI count depend on cell biology, so the rule can label genuine cells empty [R12]; fewer calls lower the residual, hence the guardrail.

### P1. Performance and scaling

Scales of 10,000, 100,000 and 1,000,000 barcodes by about 30,000 genes, built by resampling a template channel; no streaming claim, so no 10 million scale. Report median wall time of three repeats, barcodes per second and peak resident memory, on CPU and CUDA, for `emptydrops` at `niters` 10,000, `emptydrops_cr`, `defaultdrops`, `dropkick` and `eb_mixture`, against DropletUtils `emptyDrops` and CellBender. Hold fixed `lower`, `niters`, threads, CSR input, gene set and hardware. Acceptance (proposed): 100,000 barcodes in under 60 s on one CPU core with peak memory under 4 GB at defaults, and CPU/CUDA calls agreeing as in the shared protocol.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.count_matrix_state_detection`: Count-matrix processing-state detection
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
- **Feeds**:
  - `cell-calling.cell_count_cutoff_selection`: Cell/empty cutoff and expected cell-count selection
  - `cell-calling.residual_empty_droplet_removal`: Residual empty-droplet detection among called cells
  - `ambient.contamination_fraction`: Contamination fraction estimation
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `doublets.expression_doublet_scoring`: Expression-based per-cell doublet scoring
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Reads**: `raw/counts`, `obs/<sample_key>`
- **Writes**: `obs/cell_call_is_cell_<method>`, `obs/cell_call_prob_<method>`, `obs/cell_call_pvalue_<method>`, `obs/cell_call_fdr_<method>`, `obs/cell_call_limited_<method>`, `uns/cell_call_ambient_profile_<method>`, `uns/cell_call_params_<method>`, `uns/cell_call_summary_<method>`, `models/cell_call_<method>`
<!-- CHAINING:AUTO:END -->

This is the raw-to-filtered step of droplet preprocessing, ahead of every droplet workflow. Nuclei and multiome libraries use `cell-calling.nucleus_vs_empty_calling` and `cell-calling.multiome_cell_calling`; this document does not apply to nuclei.

## 10. Risks, pitfalls and open questions

- **No independent truth for the lowest-RNA cells, and no neutral benchmark.** B1 thinning preserves composition and B2 measures recall only above $L_c$, so no benchmark measures the lowest-RNA cells directly. No head-to-head comparison of these callers on a shared truth appears in the sources cited here, and the datasets of the EmptyDrops and dropkick evaluations [R4, R5] were not available locally.
- **Source versions and conflicts.** Defaults were read at development heads (DropletUtils 1.33.2, Cell Ranger 10.1.0); release branches were not compared. DropletUtils documents `retain` as "above" while the code uses at-or-above. The EmptyNN README states 10 iterations, the code 5. The DropletQC residual percentages [R7] come from a text excerpt with the denominators defined in the paper, and the package data description states the EmptyDrops FDR threshold of the published set ambiguously [R12].
- **Data availability.** The unfiltered matrices, BAMs and usage terms of the 10x datasets in B1 and B3 and of HGMM 12k in B2 were not inspected. The 354M-cell catalogue holds filtered cells; whether raw matrices exist there is unknown. EmptyNN has no licence.
- **`alpha` and `lower`.** The sensitivity of call counts to `alpha` (multinomial against estimated) and to `lower` is unmeasured, and no data-driven rule for either exists.
- **`eb_mixture` identifiability and parity.** Low-RNA types may be missed or absorbed by profiles fitted above the knee; CPU/CUDA agreement of Monte Carlo tails near the cut and the P1 target are untested.
- **First experiment.** Apply `emptydrops` with `test_ambient` on to the B2 mixtures: check the ambient p-value histogram against the falsifier of section 5, the `Limited` count against `niters` and observed FDR against nominal, then compare low-total recall with `defaultdrops` and the knee total while varying `lower`.

## 11. References

R1. Matthew D Young, Sam Behjati. SoupX removes ambient RNA contamination from droplet-based single-cell RNA sequencing data. *GigaScience* 2020. doi:10.1093/gigascience/giaa151 — verified (corpus)
R2. Dongze He, Avi Srivastava, Hirak Sarkar, Rob Patro, Seo H. Kim, Lukas Heumos. Raw data processing. Chapter of the online book Best practices for single-cell analysis (theislab). — verified (repo)
R3. Robert Amezquita, Aaron Lun, Stephanie Hicks, Raphael Gottardo. Orchestrating Single-Cell Analysis with Bioconductor, advanced book, chapter "Droplet processing". 2022. https://bioconductor.org/books/release/OSCA/ — verified (corpus)
R4. Aaron T. L. Lun, Samantha Riesenfeld, Tallulah Andrews, The Phuong Dao, Tomas Gomes, participants in the 1st Human Cell Atlas Jamboree, John C. Marioni. EmptyDrops: distinguishing cells from empty droplets in droplet-based single-cell RNA sequencing data. *Genome Biology* 2019;20:63. doi:10.1186/s13059-019-1662-y — verified (corpus)
R5. Cody N. Heiser, Victoria M. Wang, Bob Chen, Jacob J. Hughey, Ken S. Lau. Automated quality control and cell identification of droplet-based single-cell data using dropkick. *Genome Research* 2021;31(10):1742-1752. doi:10.1101/gr.271908.120 — verified (corpus)
R6. Fangfang Yan, Zhongming Zhao, Lukas M. Simon. EmptyNN: a neural network based on positive and unlabeled learning to remove cell-free droplets and recover lost cells in scRNA-seq data. *Patterns* 2021;2(8):100311. doi:10.1016/j.patter.2021.100311 — verified (search)
R7. Walter Muskovic, Joseph E Powell. DropletQC: improved identification of empty droplets and damaged cells in single-cell RNA-seq data. *Genome Biology* 2021;22:329. doi:10.1186/s13059-021-02547-0 — verified (corpus)
R8. Stephen J Fleming, Mark D Chaffin, Alessandro Arduini, Amer-Denis Akkad, Eric Banks, John C Marioni, Anthony A Philippakis, Patrick T Ellinor, Mehrtash Babadi. Unsupervised removal of systematic background noise from droplet-based single-cell experiments using CellBender. *Nature Methods* 2023. doi:10.1038/s41592-023-01943-7 — verified (repo)
R9. Benjamin Kaminow, Dinar Yunusov, Alexander Dobin. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021. doi:10.1101/2021.05.05.442755 — verified (corpus)
R10. B. Phipson, G. K. Smyth. Permutation P-values should never be zero: calculating exact P-values when permutations are randomly drawn. *Statistical Applications in Genetics and Molecular Biology* 2010;9: Article 39. — verified (repo)
R11. Lun A, Griffiths J, McCarthy D, He D, Patro R. DropletUtils: Utilities for Handling Single-Cell Droplet Data. R package 1.33.2, commit ba4152d. https://github.com/MarioniLab/DropletUtils — verified (repo)
R12. Muskovic W. DropletQC: Calculate Nuclear Fraction Score. R package and vignette dropletQC.Rmd, commit 5d7dadc. https://github.com/powellgenomicslab/DropletQC — verified (repo)
R13. 10x Genomics. Cell Ranger 10.1.0 source, cell_calling.py and cell_calling_helpers.py, commit 669395e. https://github.com/10XGenomics/cellranger — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/MarioniLab/DropletUtils | Aaron Lun (aut); Jonathan Griffiths (ctb, cre); Davis McCarthy, Dongze He, Rob Patro (ctb), per DESCRIPTION | GPL-3 (DESCRIPTION; no LICENSE file at the root) | emptyDrops, emptyDropsCellRanger, defaultDrops, barcodeRanks | reimplement |
| https://github.com/alexdobin/STAR | Alexander Dobin (LICENSE copyright holder) | MIT (LICENSE) | STARsolo EmptyDrops_CR and CellRanger2.2 filtering | port |
| https://github.com/KenLauLab/dropkick | Cody Heiser (setup.py author; LICENSE copyright holder) | MIT (LICENSE) | dropkick | port |
| https://github.com/lkmklsmn/empty_nn | Fangfang Yan, Lukas M. Simon (DESCRIPTION) | no LICENSE file; the DESCRIPTION licence field holds placeholder text | EmptyNN | callout |
| https://github.com/broadinstitute/CellBender | Stephen Fleming, Mehrtash Babadi (pyproject.toml) | BSD-3-Clause (LICENSE; pyproject.toml "BSD (3-Clause)") | CellBender comparator | callout |
| https://github.com/powellgenomicslab/DropletQC | Walter Muskovic (DESCRIPTION) | MIT (DESCRIPTION "MIT + file LICENSE") | B3 label; belongs to `cell-calling.residual_empty_droplet_removal` | callout |
| https://github.com/10XGenomics/cellranger | 10x Genomics | LICENSE opens with MIT-style permission wording and adds conditions: use only with 10x Genomics products, internal use, no redistribution; README: source made available for informational purposes | Cell Ranger comparator | callout |
