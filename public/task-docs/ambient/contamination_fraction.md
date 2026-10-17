---
id: ambient.contamination_fraction
title: Contamination fraction estimation
area: ambient
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [ingest-quant.umi_deduplication, cell-calling.cell_vs_empty_droplet_calling, clustering.cell_partitioning]
feeds: [ambient.count_removal, ambient.contaminated_gene_detection, ambient.marker_de_artifact_detection]
reads: [raw/counts, layers/counts, obs/<cluster_key>, obs/<sample_key>]
writes: [obs/ambient_frac_<method>, obs/ambient_frac_lo_<method>, obs/ambient_frac_hi_<method>, uns/ambient_summary_<method>, models/<name>]
devices: [cpu, cuda]
mcp_tool: singlet_ambient_contamination_fraction
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Contamination fraction estimation

> Estimate, for every cell barcode and every sample, the fraction of UMIs that came from cell-free RNA in the suspension rather than from the cell itself.

## 1. Question

Given the raw droplet-by-gene UMI matrix of a channel (empty barcodes included) and the filtered cell matrix, what fraction $\rho_i \in [0,1]$ of the UMIs of each cell barcode $i$ is ambient, meaning captured from the cell-free pool and normalised by the barcode's total UMIs $N_i$? And what single severity value, the sample median of $\hat\rho_i$, describes each sample? A correct answer equals the planted fraction in simulation and agrees with mixing designs (cross-genotype or cross-species reads) up to the barcode swapping and doublets that those designs also count (section 3). Removing counts is the separate task `ambient.count_removal`, which consumes these fractions.

## 2. Why this task matters and where the field stands

Droplets capture cell-free RNA from the suspension together with each cell's own RNA. The shared background makes unexpressed genes look expressed and pulls cells toward the wrong cluster. The SoupX README states that contamination "can vary hugely between experiments (2% - 50%), although around 10% seems reasonably common", and that estimating the rate is the part of the method that needs the most user input and is prone to errors [R1].

The task is **contested**. Janssen et al. pooled two mouse subspecies in mouse kidney scRNA-seq and snRNA-seq experiments, so that cross-genotype reads measure background. Background averaged 3% to 35% of UMIs per cell, varying across replicates and cells, and was attributed mostly to ambient RNA. Among CellBender, DecontX and SoupX, CellBender gave the most precise background estimates and the largest gain in marker detection; clustering was fairly robust, so correction gave modest gains at some cost to fine structure [R6]. Cargnelli et al. compared seven tools on simulated, species-mixing and genotype-mixing data and found no single best method across datasets and metrics, with CellBender, DecontX and SoupX generally performing well [R7].

Open problems:

- **Truth is a union.** Genotype and species mixing count ambient RNA, barcode swapping and doublets together [R6][R7]; CellBender models swapping as a separate term [R3].
- **One profile per channel.** SoupX, CellBender and scAR use a single ambient profile per channel, so composition that varies with cell type or droplet size is not modelled [R1][R3][R4].
- **Prior dominance at low UMI.** DecontX adds Dirichlet pseudo-counts to each barcode's counts, so sparse barcodes are pulled toward the prior [R2].
- **Outputs differ.** Estimates are per channel, per cell or a removed-count fraction, so comparison needs an explicit common definition (section 3.1).
- **Upstream dependence.** SoupX and DecontX estimates depend on cluster labels, supplied or found internally [R1][R2].

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $i$, $g$, $c$ | barcode, gene, cluster |
| $x_{ig}$, $N_i$ | UMI count of gene $g$ in barcode $i$; barcode total |
| $\rho_i$ | ambient fraction of barcode $i$ (target) |
| $\pi_{cg}$, $\beta_g$ | native profile of cluster $c$; ambient profile of the channel (each sums to 1) |
| $o_{gc}$, $E_{gc}$ | observed counts of gene $g$ in cluster $c$; $\beta_gU_c$ with $U_c=\sum_{i\in c}N_i$ |
| $m$, $s$, $k$, $\tau$ | SoupX prior mode, standard deviation, Gamma shape, scale |
| $\theta_i$, $\delta$ | DecontX native share and Dirichlet pseudo-counts (not SoupX's $\tau$) |

**3.1 Model and estimands.** Each barcode mixes a native pool of its cell type $z_i$ with the channel's cell-free pool, $p_{ig}=(1-\rho_i)\pi_{z_i g}+\rho_i\beta_g$; given the observed total, counts are $\mathrm{Multinomial}(N_i,p_i)$ (the DecontX likelihood). The model has no overdispersion, barcode swapping or doublets, so a foreign-genotype or foreign-species read counts as ambient by construction. Each output and truth is normalised by the barcode's total UMIs:

- planted truth (B2): the realised share of planted ambient UMIs;
- genotype-mixing truth (B1): $f_i/q$, with $f_i$ the share of the barcode's genotyped UMIs carrying the other genotype's allele and $q$ that share in the channel's empty barcodes; it equals $\rho_i$ if informative sites sample ambient and native molecules alike, and otherwise also counts swapping and doublets;
- SoupX: one channel value $\hat\rho$ (posterior mode) broadcast to all cells;
- DecontX: $1-$(EM-assigned native UMIs)$/N_i$ (`src/DecontX.cpp:131-133`);
- CellBender: $b_i=(\text{raw}_i-\text{denoised}_i)/(\text{raw}_i+0.001)$ (`run.py:444`), the removed share, which includes swapped counts under `full` and grows with the target false-positive rate `fpr`;
- scAR: $r_i$, the weight of the fixed ambient profile in the barcode's expectation.

**3.2 Identification.** Under the model, with $\rho$ constant within cluster $c$ and $\beta$ known, $\mathbb E[o_{gc}]/E_{gc}=\rho+(1-\rho)\pi_{cg}/\beta_g$, which equals $\rho$ only where $\pi_{cg}=0$. With $\pi_{cg}=0.01$, $\beta_g=0.001$ and $\rho=0.1$ the ratio is 9.1 (arithmetic, not data). Every estimator therefore rests on genes it treats as natively silent, and the choice of those genes is the main source of disagreement.

**3.3 SoupX.** For the gene–cluster pairs kept, $o_{gc}\sim\mathrm{Poisson}(\rho E_{gc})$ with a $\mathrm{Gamma}(k,\tau)$ prior of mode $m=(k-1)\tau$ and standard deviation $s$. Moment matching gives $s^2/m^2=k/(k-1)^2$, so $k=1+(1+\sqrt{1+4v})/(2v)$ with $v=(s/m)^2$. The posterior is conjugate, $\mathrm{Gamma}\big(k+o,\ \text{scale}=\tau/(1+\tau E)\big)$, with mean $(o+k)/(E+1/\tau)$; the prior adds $k$ pseudo-counts and $1/\tau$ units of exposure and dominates when $E\ll1/\tau$ (exact for fixed $E$). The released code (1.6.2, `R/autoEstCont.R:143`) uses $k=1+(1+\sqrt{1+4v})/(2v^2)$, which keeps the mode but not the standard deviation: at $m=0.05$, $s=0.10$ it gives $k\approx1.16$, $\tau\approx0.31$, a prior standard deviation near 0.34 and $1/\tau\approx3.2$, against $k\approx1.64$, $\tau\approx0.078$ and $1/\tau\approx12.8$ when moment-matched. The code comment ties $k,\tau$ to the mode and standard deviation, suggesting the moment-matched form was intended (an inference).

The channel estimate maximises, on a 0.001 grid over $[0.01,0.8]$, the average posterior $|\mathcal P|^{-1}\sum_{(g,c)\in\mathcal P}p(\rho\mid o_{gc})$. $\mathcal P$ holds the gene–cluster pairs, among soup-abundant tf-idf markers of binarised expression, in which no cell shows expression significantly above that expected at $\rho=0.8$ (Poisson test, Benjamini–Hochberg FDR 0.2); the other filters are commented out (`R/autoEstCont.R:122-125`). The average is a mixture of per-pair posteriors, not a joint posterior: correlated pairs count more than once and the peak is not calibrated. The reported interval is the full width at half maximum of the average (`rhoFWHM`, line 154), not a coverage interval; the per-pair Garwood bounds (lines 132-137) condition on the estimated $E$ and understate uncertainty.

**3.4 DecontX.** Counts of barcode $i$ are a two-component mixture of its cluster's native profile $\phi_{zg}$ and a contamination profile $\eta_{zg}$ built from the native counts of the other clusters, $\ell_i=\sum_g x_{ig}\log(\theta_i\phi_{z_ig}+(1-\theta_i)\eta_{z_ig}+10^{-20})$. The EM update is $\theta_i=(\text{native}_i+\delta_1)/(N_i+\delta_1+\delta_2)$, so $\delta$ acts as pseudo-counts that pull sparse barcodes toward 0.5 when fixed. With `estimateDelta=TRUE` (default) the supplied $\delta$ only initialises $\theta$ and is refitted each iteration by a Dirichlet maximum-likelihood fit (`R/decon.R:46-54`), an empirical-Bayes prior. Clusters are supplied or found by DBSCAN on variable genes; labels derived from the same counts make native and contamination profiles partly circular.

**3.5 CellBender and scAR.** CellBender is an encoder–decoder model trained on an ELBO, with a learned ambient profile, per-barcode cell probabilities and, under `full`, a barcode-swapping fraction (`rho` in the code, Beta prior) that is not an ambient fraction. scAR mixes a decoder output with a fixed ambient profile estimated from cell-free droplets by an EmptyDrops-style multinomial test [R5]: with decoder scale $s_{ig}$ and log size factor $\ell_i$, $\mathbb E[x_{ig}]=e^{\ell_i}\big[(1-r_i)s_{ig}+r_i\beta_g\big]$ and $r_i=\tfrac12\big(1+\tanh(w^\top h_i+b)\big)$ for decoder hidden state $h_i$. Both fit variational posteriors without coverage guarantees, and in scAR $r_i$ trades off against the native mean in cell types resembling the ambient profile.

**3.6 Heuristic and model-based formulations.** Heuristic gene selection encodes the identifying assumption directly and needs no training; the SoupX README recommends gene sets specific to a cell type present at low frequency (hemoglobin genes in erythrocytes, immunoglobulin genes in B cells), and the assumption cannot be checked when none exists. A model-based formulation makes both profiles explicit, returns a posterior per barcode, can be trained once and reused, and can use reference covariates; its costs are prior dominance at low UMI and intervals calibrated only as far as likelihood and approximation hold, so calibration is measured (B2).

**3.7 Pitfalls from benchmarks.** Truth that counts swapping and doublets makes an ambient-only estimator look biased [R6][R7]. Median-only reporting hides instability, so per-sample summaries add the interquartile range and tail shares.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| SoupX `autoEstCont` | hybrid | Selects soup-abundant, cluster-specific markers by tf-idf of binarised expression, keeps gene–cluster pairs with no evidence of native expression, and takes the mode of their averaged Gamma–Poisson posterior as one channel fraction | [R1] |
| DecontX | model-based | Per-barcode two-component multinomial mixture of the cluster's native profile and a contamination profile from the other clusters, fitted by EM with a Dirichlet prior on the native share | [R2] |
| CellBender `remove-background` | model-based | Encoder–decoder model with a learned ambient profile and per-barcode cell probabilities, plus a barcode-swapping term in the `full` model; background fraction summarised from removed counts | [R3] |
| scAR | model-based | Variational autoencoder whose expectation mixes a native decoder output with a fixed ambient profile from cell-free droplets, weighted by a learned per-barcode noise ratio | [R4] |

SoupX, DecontX and CellBender form the published comparator set: [R7] rates them generally well and [R6] compares exactly these three, naming CellBender most precise. SoupX is the only channel-level estimator and the only one that requires cluster labels; DecontX needs only the filtered matrix.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| SoupX | `tfidfMin`, `soupQuantile`, `maxMarkers`, `contaminationRange`, `rhoMaxFDR`, `priorRho`, `priorRhoStdDev`, `forceAccept` | 1.0, 0.90, 100, c(0.01, 0.8), 0.2, 0.05, 0.10, FALSE | `R/autoEstCont.R:40` @ 8d89492 |
| SoupX | posterior grid step; Garwood level | 0.001; 0.95 (fixed) | `R/autoEstCont.R:138`, `:134` |
| SoupX | warning / error on estimate | above 0.3 / above 0.5 unless `forceAccept` | `R/setProperties.R:82-85` |
| SoupX | warning on markers / usable estimates | fewer than 10 / fewer than 10 | `R/autoEstCont.R:80-81`, `:127-128` |
| DecontX | `maxIter`, `delta`, `estimateDelta`, `convergence`, `iterLogLik` | 500, c(10, 10), TRUE, 0.001, 10 | `R/decon.R:128-132` @ fdb2651 |
| DecontX | `varGenes`, `dbscanEps`, `seed` | 5000, 1, 12345 | `R/decon.R:133-135` |
| CellBender | `model`, `epochs` | `full`, 150 | `cellbender/remove_background/argparser.py:123`, `:138` @ f36ae29 |
| CellBender | `low_count_threshold`, `z_dim`, `z_hidden_dims` | 5, 64, [512] | `argparser.py:141-143`, `:152`, `:157`; `consts.py:27` |
| CellBender | `fpr`, `learning_rate`, `expected_cells` | [0.01], 1e-4 (OneCycle, peak ten times), none | `argparser.py:196`, `:236-241`, `:86` |
| CellBender | swapping prior | Beta(1.5, 50) | `consts.py:42-43` |
| CellBender | cell probability cutoff, total droplets, training fraction, batch size, empty fraction per batch | 0.5, 25000, 0.9, 128, 0.2 | `consts.py:23`, `:30`, `:33`, `:36`, `:39` |
| scAR | `n_hidden`, `n_latent`, `n_layers` | 150, 15, 2 | `src/scvi/external/scar/_model.py:92-94` @ 5555ecc |
| scAR | `dropout_rate`, `gene_likelihood`, `latent_distribution`, `scale_activation`, `sparsity` | 0.0, binomial (`b`), `normal`, `softplus_sp`, 0.9 | `_model.py:95-99` |
| scAR | `prob`, `min_raw_counts`, `iterations`, `sample` | 0.995, 2, 3, 50000 | `_model.py:209-213` |
| scAR | minimum cell-free droplets | 50 | `_model.py:319` |

## 5. Proposed singlet approach

**Routes.** SoupX: reimplement from [R1] and section 3, with the moment-matched prior; the upstream constant is kept only as a parity switch in the benchmark harness. DecontX: port, keeping the copyright notice. CellBender: port the model to PyTorch, with the upstream release as parity comparator. scAR: port the scvi-tools module, cross-checked against the original repository.

**Model-based formulation.** Replace SoupX's fixed prior and gene-averaged posterior by a hierarchical model: for sample $s$, $\rho_i\sim\mathrm{Beta}(a_s,b_s)$, native profiles from annotated catalogue cells, ambient profile $\beta_s$ from the empty barcodes (or the sample pseudo-bulk when none exist), and the multinomial likelihood of section 3.1. An amortised PyTorch encoder, trained on planted-ambient augmentations of catalogue cells from studies disjoint from B2, returns a per-barcode Beta posterior (mean and 95% credible interval) in one forward pass; $(a_s,b_s)$ are fitted per sample by marginal likelihood. The model joins the method enum only after it meets the B2 acceptance criterion. It is falsified if it misses the B2 error or coverage criteria, or if on B2 its catalogue-learned prior does not beat the fixed prior (mode 0.05, standard deviation 0.10) in error.

**ML stack and kernels.** The encoder, CellBender and scAR train in PyTorch. Hard-coded CUDA/cuSPARSE is proposed only for small hot kernels: the per-barcode grid posterior with closed-form Gamma terms (1,001 grid points), the sparse products of the DecontX EM, and segmented sums for $N_i$, $U_c$ and $E_{gc}$; the CPU path uses the same formulas. Marker selection and the channel value need full scans of the raw matrix, so estimation is not streaming. Applying a fixed channel value or a trained encoder can be chunked by barcode; DecontX at atlas scale accumulates per-cluster sums across chunks.

**Defaults without asking.** `method=decontx`, `device=auto`, `seed=12345`, `sample_key=sample`. Use `soupx` only with `cluster_key`. Use `cellbender` only after a dry run and with `cellbender.expected_cells` set. Read the per-sample flag before deciding to correct.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | raw/counts | sparse int | droplet-by-gene UMIs with empty barcodes; required for `soupx`, `cellbender`, `scar`, optional empty-droplet profile for `decontx` |
| read | layers/counts | sparse int | filtered cell matrix; its barcodes are a subset of `raw/counts` |
| read | obs/<cluster_key> | string or int | cluster labels of the filtered cells; required for `soupx`, optional for `decontx` |
| read | obs/<sample_key> | string | channel identifier; required when more than one channel is present |
| write | obs/ambient_frac_<method> | float32 in [0,1] | per-cell ambient fraction $\hat\rho_i$, defined per method in section 3.1 |
| write | obs/ambient_frac_lo_<method>, obs/ambient_frac_hi_<method> | float32 | `soupx` only: full width at half maximum of the averaged posterior, broadcast to cells |
| write | uns/ambient_summary_<method> | dict | per sample: cells, median, mean, interquartile range, shares above 0.1 and 0.3, flag |
| write | models/<name> | model artefact | trained weights for `cellbender` and `scar` |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: .singlet path, URI (s3://, r2://, https://) or workspace handle. Needs layers/counts; raw/counts for soupx, cellbender, scar. |
| `method` | string | "decontx" | `decontx`, `soupx`, `cellbender`, `scar` | decontx (default, per cell), soupx (per sample, needs cluster_key), cellbender (deep model, includes barcode swapping), scar (deep model, fixed ambient profile). |
| `cluster_key` | string/null | null | — | obs column with cluster labels. Required for soupx, optional for decontx (otherwise clustered internally), ignored by cellbender and scar. |
| `sample_key` | string | "sample" | — | obs column identifying the channel or sample; estimation and the per-sample summary are grouped by it. |
| `seed` | integer | 12345 | min 0 | Random seed for decontx initialisation, cellbender and scar. Ignored by soupx, which is deterministic. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA for cellbender and scar training when a device with enough memory is available, otherwise CPU. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing ambient_frac and ambient_summary members of the same method instead of failing. |
| `soupx` | object | — | — | Options used only when method is soupx. |
| `soupx.contamination_range` | array | [0.01, 0.8] | — | Lower and upper bound of the channel estimate; the upper bound also sets the non-expression test. |
| `soupx.tfidf_min` | number | 1.0 | min 0 | Minimum tf-idf for a marker gene. |
| `soupx.soup_quantile` | number | 0.9 | > 0; < 1 | Soup abundance quantile above which genes become marker candidates. |
| `soupx.max_markers` | integer | 100 | min 1 | Maximum number of marker genes used. |
| `soupx.non_expression_fdr` | number | 0.2 | > 0; < 1 | False discovery rate of the test that excludes clusters expressing a marker. |
| `soupx.prior_rho` | number | 0.05 | > 0; < 1 | Prior mode of the contamination fraction. |
| `soupx.prior_rho_sd` | number | 0.1 | > 0 | Prior standard deviation of the contamination fraction; the Gamma shape is moment-matched to it. |
| `soupx.force_accept` | boolean | false | — | Accept channel estimates above 0.5 instead of returning an error. |
| `decontx` | object | — | — | Options used only when method is decontx. |
| `decontx.delta` | array | [10, 10] | — | Dirichlet pseudo-counts for native and contamination counts; initial values when estimate_delta is true. |
| `decontx.estimate_delta` | boolean | true | — | Refit the pseudo-counts from the barcodes at every EM iteration. |
| `decontx.max_iter` | integer | 500 | min 1 | Maximum number of EM iterations. |
| `decontx.convergence` | number | 0.001 | > 0 | Stop when the largest change in any barcode's native share falls below this. |
| `decontx.use_empty_droplets` | boolean | false | — | Use the empty-droplet profile from raw/counts as the contamination profile instead of one built from other clusters. |
| `cellbender` | object | — | — | Options used only when method is cellbender. |
| `cellbender.model` | string | "full" | `full`, `ambient` | full models ambient RNA and barcode swapping; ambient models ambient RNA only. |
| `cellbender.epochs` | integer | 150 | min 1 | Training epochs. |
| `cellbender.fpr` | number | 0.01 | min 0; < 1 | Target false positive rate: share of true signal counts removed; the reported fraction grows with it. |
| `cellbender.learning_rate` | number | 0.0001 | > 0 | Base learning rate under a OneCycle schedule whose peak is ten times larger. |
| `cellbender.low_count_threshold` | integer | 5 | min 0 | Barcodes with fewer UMIs are excluded from the analysis. |
| `cellbender.expected_cells` | integer/null | null | min 1 | Expected number of cells, within a factor of 2; null uses CellBender's heuristic prior. Recommended. |
| `scar` | object | — | — | Options used only when method is scar. |
| `scar.n_hidden` | integer | 150 | min 1 | Hidden units per layer. |
| `scar.n_latent` | integer | 15 | min 1 | Latent dimension. |
| `scar.ambient_prob` | number | 0.995 | > 0; < 1 | Probability cut that selects cell-free droplets for the ambient profile; at least 50 droplets must pass. |
<!-- PARAMS:AUTO:END -->

`cluster_key` is required for `soupx`; for `decontx` it supplies the cluster labels (otherwise DecontX clusters internally) and the other methods ignore it. `sample_key` defines the channel: `soupx` and `cellbender` operate per channel and `decontx` receives it as its batch. `seed` seeds the DecontX initialisation, CellBender and scAR; `soupx` is deterministic. The flag marks suspect estimates, not severity: `ok`, `warning` (sample median above 0.3) or `failure` (above 0.5), thresholds taken from the SoupX messages and applied to every method. For severity, the SoupX README calls 2% or less low, 5% usual, 10% moderate and 20% or above very high (fresh-tissue 10x 3′ experiments).

## 7. MCP tool

Tool name `singlet_ambient_contamination_fraction` (definition in `tasks/mcp/singlet_ambient_contamination_fraction.json`).

```json
{"dataset": "/data/kidney_channel_01.singlet", "method": "decontx", "sample_key": "sample", "device": "cpu", "seed": 12345}
```

```json
{
  "dataset": "/data/kidney_channel_01.singlet",
  "status": "completed",
  "wrote": ["obs/ambient_frac_decontx", "uns/ambient_summary_decontx"],
  "summary": {"method": "decontx", "per_sample": [
    {"sample": "<id>", "n_cells": "<int>", "median": "<float>", "mean": "<float>",
     "iqr": ["<float>", "<float>"], "frac_above_0.1": "<float>", "frac_above_0.3": "<float>", "flag": "ok"}]},
  "provenance_id": "<id>",
  "job_id": null
}
```

Angle-bracket fields are placeholders for the shape, not measurements. Long-running: `cellbender` and `scar` may return `queued` with a `job_id`; `soupx` and `decontx` complete inline. Stochastic: `decontx` (initial $\theta$), `cellbender` and `scar`. Dry run: returns `seconds`, `peak_memory_gb` and `device` from a cost model (barcodes, nonzeros and clusters for `soupx` and `decontx`; barcodes, epochs and hidden width for `cellbender` and `scar`).

## 8. Benchmarks

B1 reproduces a published design; B2 is proposed. Shared protocol: every method is executed at the defaults of section 4 on identical raw and filtered matrices, with an uncorrected baseline $\hat\rho_i=0$; SoupX receives the cluster labels of the filtered matrix; per-channel outputs are broadcast to cells; CellBender and scAR use the GPU; seeds are fixed and recorded; versions are the commits of section 12. Metrics use the set $C$ of barcodes with at least 500 UMIs and a finite truth and estimate; the share of cells with a non-finite estimate is reported. Spearman uses average ranks for ties. All numeric thresholds and generator values below are proposed, not literature values.

### B1. Genotype-mixing benchmark (design of Janssen et al.)

- **Goal**: measure the bias and accuracy of contamination estimates against cross-genotype reads in pooled mouse kidney data [R6].
- **Ground truth**: orthogonal measurement (genotype mixing). $\rho^{\text{truth}}_i=f_i/q$ (section 3.1), computed for barcodes with at least 30 genotyped UMIs (proposed) to bound binomial noise in $f_i$; it also counts barcode swapping and cross-genotype doublets.

| Dataset | Source (reference, accession) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Mouse kidney, two subspecies pooled per experiment | Janssen et al. [R6]; accession — | three scRNA-seq and two snRNA-seq replicates; mouse; cell counts — | article open access (CC BY); data — | strains in the preprint figure legend: CAST/EiJ, C57BL/6J, 129S1/SvImJ; background 3% to 35% of UMIs per cell on average |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-replicate bias | $\lvert\overline{\hat\rho}_C-\overline{\rho^{\text{truth}}}_C\rvert$ over $C$, per replicate | lower | primary | proposed |
| Cluster-level MAE | mean over (replicate, cluster) pairs with at least 30 barcodes in $C$ of $\lvert\overline{\hat\rho}-\overline{\rho^{\text{truth}}}\rvert$ within the pair; clusters as given to SoupX | lower | primary | proposed |
| Per-cell Spearman | rank correlation of $\hat\rho_i$ and $\rho^{\text{truth}}_i$ over $C$ | higher | guardrail | proposed |

- **Comparators**: SoupX with clusters, DecontX, CellBender (`full`), scAR, uncorrected. [R6] compared CellBender, DecontX and SoupX.
- **Protocol**: each replicate is analysed separately; scRNA-seq and snRNA-seq are reported separately.
- **Acceptance criterion** (proposed): on every replicate, bias at most 0.02 or 20% of the replicate's mean truth, whichever is larger; pooled cluster-level MAE at most that of the best of SoupX, DecontX and CellBender plus 0.01; Spearman at least that best comparator's minus 0.05.
- **Known pitfalls**: informative sites cover a subset of genes, so $f_i/q$ equals the whole-transcript $\rho_i$ only if ambient and native molecules are sampled alike there; $q$ assumes the genotype share of empty barcodes equals that of the soup in cell-containing droplets, which swapping between cells shifts.

### B2. Planted-ambient simulation from catalogue cells (proposed)

- **Goal**: test accuracy and calibration against an exact truth under matched and mismatched profiles and size-dependent contamination.
- **Ground truth**: planted simulation. $\rho^{\text{truth}}_i=n^{\text{amb}}_i/(N_j+n^{\text{amb}}_i)$, the realised share of planted ambient UMIs, with $N_j$ the UMI total of source cell $j$.

| Dataset | Source (reference, accession) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted-ambient simulation | singlet catalogue (354M cells, about 40% author-annotated), held-out studies; manifest — | scRNA-seq, snRNA-seq; species per study; 1e3, 1e4, 1e5 cells per sample | per source study — | — |

Generator recipe:

1. Source cells: annotated catalogue cells from at least three studies in each of three tissues; $y_j$ is the count vector of cell $j$.
2. Ambient profile $\beta_s=\sum_c w_c\bar\pi_c$, the mean cell-type profiles weighted by their UMI share in the sample. Matched: $\beta_i=\beta_s$. Mismatch: $\beta_i\sim\mathrm{Dirichlet}(\kappa\beta_s)$ per barcode, $\kappa=10^4$.
3. Load: fixed fraction $\rho_i\in\{0.02,0.05,0.10,0.20,0.35\}$, $n^{\text{amb}}_i=\mathrm{round}(\rho_iN_j/(1-\rho_i))$; or constant load $n^{\text{amb}}_i\sim\mathrm{Poisson}(\lambda)$, $\lambda\in\{50,200,800\}$.
4. Counts: $x_i=y_j+a_i$, $a_i\sim\mathrm{Multinomial}(n^{\text{amb}}_i,\beta_i)$. No doublets are planted.
5. Empty barcodes: 10,000 per sample, log-normal totals (median 50 UMIs, log-scale SD 0.7), counts $\mathrm{Multinomial}(N^{\text{e}},\beta_s)$. Five seeds per size.

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-cell MAE | mean over $C$ of $\lvert\hat\rho_i-\rho^{\text{truth}}_i\rvert$, also for $\rho^{\text{truth}}\le0.10$ | lower | primary | proposed |
| Per-sample bias, per-cell Spearman | as B1 | lower, higher | guardrail | proposed |
| 95% interval coverage | share of $C$ with truth inside the method's interval | near 0.95 | guardrail | proposed |

- **Comparators**: SoupX with annotated cell types as clusters (both prior constants, section 3.3), DecontX, CellBender, scAR, uncorrected, and the proposed model once built. Each condition and size is reported separately.
- **Acceptance criterion** (proposed): the proposed model has per-cell MAE at most 0.02 at $\rho^{\text{truth}}\le0.10$ for at least 1e4 cells, at most the best comparator's MAE in every condition, and coverage between 0.90 and 0.98 under matched and mismatched profiles.
- **Known pitfalls**: generator circularity (a method matching the generator looks optimal), hence a different training generator and the mismatch condition; source cells carry their own unmodelled ambient RNA.

### P1. Performance and scaling

Measure wall time, peak CPU and GPU memory, and throughput (barcodes per second) as medians over a fixed number of repetitions, on CPU and CUDA, at 1e4, 1e5 and 1e6 cells with B2-style empty barcodes, against the upstream releases of SoupX, DecontX, CellBender and scAR. Hold fixed the matrices, gene set, hardware, thread count and seed. Report per-cell parity with the upstream outputs at every scale (median absolute difference at most 0.005, proposed; the SoupX difference under the moment-matched prior is reported separately). Acceptance (proposed): each port is no slower than upstream on the same hardware at 1e5 and 1e6 cells and meets the parity bound.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Feeds**:
  - `ambient.count_removal`: Ambient count removal
  - `ambient.contaminated_gene_detection`: Contaminating gene detection
  - `ambient.marker_de_artifact_detection`: Ambient-driven marker and DE artifact detection
- **Reads**: `raw/counts`, `layers/counts`, `obs/<cluster_key>`, `obs/<sample_key>`
- **Writes**: `obs/ambient_frac_<method>`, `obs/ambient_frac_lo_<method>`, `obs/ambient_frac_hi_<method>`, `uns/ambient_summary_<method>`, `models/<name>`
<!-- CHAINING:AUTO:END -->

Named workflow (proposed): cell calling, clustering, this task, a check of `uns/ambient_summary_<method>`, `ambient.count_removal` where contamination is non-negligible, then downstream analysis. `ambient.profile_estimation` can supply a shared ambient profile.

## 10. Risks, pitfalls and open questions

- **SoupX prior constant.** The released constant changes the prior standard deviation from 0.10 to about 0.34 (section 3.3), and its effect on estimates is unmeasured. First experiment: the reimplementation under both constants and the DecontX port on B2 matched data and one B1 replicate, reporting bias and error before the model-based claim of section 5 is tested.
- **Evidence not read.** The accession numbers, cell counts, full author list and truth estimator of Janssen et al.; the datasets, metrics and four other tools of Cargnelli et al.; and the method papers for SoupX, DecontX, CellBender and scAR (method descriptions come from code and READMEs). B1 truth is therefore singlet's operational definition. FastCAR and other published estimators are omitted until their papers and code are read. A Frontiers in Bioinformatics listing (fbinf.2026.1844838) may be the journal version of Cargnelli et al.; its identity with the preprint was not established.
- **Comparability.** SoupX gives a channel value, DecontX a cell value, CellBender a removed-count fraction that includes swapping, and scAR a noise ratio, while mixing truth includes swapping and doublets. B1 rankings mix estimand differences with accuracy; only B2 targets one $\rho$ for all methods. Species-mixing and the multi-design comparison of [R7] are not reproduced because their datasets are not specified in the sources read.
- **Intervals.** SoupX bounds are half-maximum widths and DecontX, CellBender and scAR return point estimates, so credible intervals exist only for the proposed model; coverage is measured on B2 before any interval is called 95%.
- **Catalogue contents.** Whether the catalogue stores raw droplet matrices with empty barcodes is unknown; B2 does not need them, but learning ambient profiles and the sample-level Beta hyperparameters from catalogue samples does.
- **Correction value and profile structure.** [R6] found modest gains from correction, and no severity above which correction changes biological conclusions is established. The single-profile assumption fails when ambient composition depends on cell type, droplet size or time, and B2's mismatch condition perturbs the profile per barcode without tying it to cell type.

## 11. References

R1. Young MD, Behjati S. SoupX removes ambient RNA contamination from droplet-based single-cell RNA sequencing data. *GigaScience* 2020;9(12). doi:10.1093/gigascience/giaa151 — verified (corpus)
R2. Yang S, Corbett SE, Koga Y, Wang Z, Johnson WE, Yajima M, Campbell JD. Decontamination of ambient RNA in single-cell RNA-seq with DecontX. *Genome Biology* 2020;21:57. doi:10.1186/s13059-020-1950-6 — verified (corpus)
R3. Fleming SJ, Chaffin MD, Arduini A, Akkad A-D, Banks E, Marioni JC, Phillipakis AA, Ellinor PT, Babadi M. Unsupervised removal of systematic background noise from droplet-based single-cell experiments using CellBender. *Nature Methods* 2023. doi:10.1038/s41592-023-01943-7 — verified (corpus)
R4. Sheng C, Lopes R, Li G, Schuierer S, Waldt A, Cuttat R, Dimitrieva S, Kauffmann A, Durand E, Galli GG, Roma G, de Weck A. Probabilistic machine learning ensures accurate ambient denoising in droplet-based single-cell omics. *bioRxiv* 2022. doi:10.1101/2022.01.14.476312 — verified (corpus)
R5. Lun ATL, Riesenfeld S, Andrews T, Dao TP, Gomes T, Marioni JC. EmptyDrops: distinguishing cells from empty droplets in droplet-based single-cell RNA sequencing data. *Genome Biology* 2019;20. doi:10.1186/s13059-019-1662-y — verified (corpus)
R6. Janssen P, Kliesmete Z, Vieth B, et al. The effect of background noise and its removal on the analysis of single-cell expression data. *Genome Biology* 2023;24:140. doi:10.1186/s13059-023-02978-x — partial (search)
R7. Cargnelli CB, Nielsen JV, Madsen JGS. Benchmarking computational decontamination of ambient RNA. *bioRxiv* 2026 (preprint). doi:10.64898/2026.01.13.699237 — partial (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/constantAmateur/SoupX | Matthew Daniel Young (Author and Maintainer in DESCRIPTION) | GPL-2 (DESCRIPTION; no LICENSE file at the root) | reference for `autoEstCont`, version 1.6.2 at 8d89492 | reimplement |
| https://github.com/campbio/decontX | Yuan Yin, Masanao Yajima, Joshua Campbell (DESCRIPTION); LICENSE copyright Joshua D. Campbell, Yuan Yin, Masanao Yajima | MIT + file LICENSE | reference for the mixture and EM, version 1.10.0 at fdb2651 | port |
| https://github.com/broadinstitute/CellBender | Stephen Fleming, Mehrtash Babadi (pyproject.toml) | BSD (3-Clause) (pyproject.toml; LICENSE, copyright Broad Institute) | reference deep model and parity comparator, at f36ae29 | port |
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml) | BSD 3-Clause (LICENSE, copyright Yosef Lab, Weizmann Institute of Science) | PyTorch scAR in `src/scvi/external/scar`, at 5555ecc | port |
| https://github.com/Novartis/scAR | Caibin Sheng (pyproject.toml) | MIT (pyproject.toml and `docs/License.rst`, copyright Novartis; no LICENSE file at the root) | original scAR 0.7.0 at df7adef, named as origin in the scvi-tools user guide | callout |
