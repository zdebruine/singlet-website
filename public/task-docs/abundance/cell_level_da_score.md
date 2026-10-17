---
id: abundance.cell_level_da_score
title: Per-cell condition-enrichment (relative likelihood) scoring on a cell graph
area: abundance
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [dim-reduction.normalized_cell_embedding, integration.batch_corrected_embedding, neighbors.approximate_knn_search]
feeds: [abundance.phenotype_associated_cells, statistics.pvalue_null_calibration]
reads: [obsm/<embedding_key>, obs/<sample_key>, obs/<condition_key>]
writes: [obs/<method>_score, obs/<method>_fdr_flag, uns/<method>_params]
devices: [cpu, cuda]
mcp_tool: singlet_abundance_cell_level_da_score
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Per-cell condition-enrichment (relative likelihood) scoring on a cell graph

> Scores each cell by the local ratio of condition-specific densities in a cell embedding, so an analyst can see which cells lie in regions enriched for one condition, on one stated scale.

## 1. Question

For each cell $i$, how strongly does the condition-specific density around $x_i$ favour condition 2 over condition 1, after smoothing over a cell graph? The inputs are a cell embedding (or a kNN graph built from it) and per-cell sample and condition labels. Each output is a balanced score $s_i \in [-1,1]$ defined in section 3. A correct answer recovers the planted local density ratio, is stable across graph settings, and flags no cells under sample-level nulls.

## 2. Why this task matters and where the field stands

Differential abundance asks whether a cell population is more or less frequent in one condition than in another. Cluster-level tests see such a shift only at the resolution of the clustering: a change inside a cluster is invisible, and a change along a continuum is split across cluster boundaries [R3]. Graph-based methods score cells or neighbourhoods directly, and the best-practices guidance recommends kNN-based methods when populations do not cluster distinctly, such as transitional states [R7]. A per-cell score is the natural read-out when the question is where in state space a perturbation acts [R1, R2].

Status: **contested**. The estimators in use target the same local density ratio (section 3), but they differ in the smoothing operator, in the prior implied by normalising the labels, and in how significance is assessed [R1, R2]. Three problems remain open: per-cell scores have no calibrated uncertainty; the permutation threshold of DA-seq treats cells rather than samples as replicates [R2]; and real data carry no per-cell ground truth, so evaluation depends on planted shifts.

## 3. Theory and insight

**Estimand.** Let $c_i\in\{1,2\}$ be the condition of cell $i$, $x_i$ its embedding, $p_c(x)$ the density of $x$ among cells of condition $c$, $\pi_c=n_c/n$ the class proportions, and $r(x)=p_2(x)/p_1(x)$ the local density ratio. The score reported here is the balanced score

$$s(x)=\frac{r(x)-1}{r(x)+1}=\frac{p_2(x)-p_1(x)}{p_2(x)+p_1(x)}\in[-1,1],$$

which does not depend on $\pi_c$ (our derivation). The uniform-prior relative likelihood is $\ell=r/(1+r)=(1+s)/2$, and the population posterior is $P(c=2\mid x)=\pi_2 r/(\pi_2 r+\pi_1)$. Every output is stated as $s$.

**Estimators.** MELD computes $\hat d_s=h(\mathcal L)\,\tilde y_s$, where $\tilde y_s$ is the indicator of condition $s$ divided by its size and $h(\lambda)=\exp(-\beta\lambda/\lambda_{\max})$ at order 1 and offset 0. Its relative likelihood $\hat\ell_2=\hat d_2/(\hat d_1+\hat d_2)$ estimates $\ell$ (our derivation; regime: the filter acts as a density-normalised smoother and each condition has many cells). Without the column normalisation the same algebra gives the population posterior. DA-seq computes, for ten neighbourhood sizes $k$ with $a_k$ neighbours in condition 2, $s_k=\frac{a_k/n_2-(k-a_k)/n_1}{a_k/n_2+(k-a_k)/n_1}$, which is $s$ with kNN density estimates. A cross-fitted ridge logistic regression on these ten features gives $\hat\pi$; its balanced transform, with the class proportions, estimates $s$ (our derivation). The proposed classifier uses $\hat r(x)=\frac{n_1}{n_2}\frac{\hat\pi(x)}{1-\hat\pi(x)}$ with $\hat\pi(x)=P(c=2\mid x)$, which follows from Bayes' rule and requires $\hat\pi$ to be calibrated. Milo fits a negative-binomial model per neighbourhood of index cells and is replicate-aware at that level [R3, R6].

**Planted truth.** The MELD generator sets $\mathrm{pdf}(x)=P(c=2\mid x)$ and draws $c\sim\mathrm{Bernoulli}(\mathrm{pdf})$ [R1]. With realised fractions $\pi_c$, the truth is $r^\star=\pi_1\,\mathrm{pdf}/\big(\pi_2(1-\mathrm{pdf})\big)$, $\ell^\star=\pi_1\,\mathrm{pdf}/\big(\pi_1\mathrm{pdf}+\pi_2(1-\mathrm{pdf})\big)$ and $s^\star=2\ell^\star-1$ (our derivation). Thus $\ell^\star=\mathrm{pdf}$ only when $\pi_1=\pi_2$, and MSE against pdf mixes normalisation with accuracy otherwise.

**Insight.** The estimators target the same $r$. They differ in the smoother (heat kernel, multi-scale kNN fractions, classifier) and in the prior implied by normalisation. Because $\ell=(1+s)/2$ for any $r$, MELD and DA-seq can disagree only through estimation, not through the estimand. The classifier route adds a proper-scoring-rule target for $\hat\pi$ and sample-level resampling for intervals. Neither MELD nor DA-seq gives calibrated per-cell uncertainty.

**Regime and failure modes.** The identities need overlapping support (both conditions populate every region), exact labels, and a density that is smooth on the graph. With one sample per condition, sample identity can masquerade as condition, and no method in this family separates the two without replicates. Large MELD $\beta$ or large DA-seq neighbourhoods (up to 3.5 percent of cells) oversmooth; small ones are noisy, and when $a_k\in\{0,k\}$ the DA-seq feature saturates at $\pm1$. Ridge shrinkage pulls predicted probabilities toward the base rate and so pulls $s$ toward 0 (our derivation; B1 checks it through the calibration slope). Overlapping neighbourhoods correlate cell scores, which inflates per-cell significance. Composition and dissociation artefacts shift local fractions, and MELD's column normalisation corrects only the total count.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| MELD | hybrid | Heat-kernel filter of column-normalised condition indicators, then per-cell relative likelihood | [R1] |
| DA-seq | hybrid | Multi-scale kNN condition fractions, cross-fitted ridge logistic regression, balanced transform, permutation thresholds | [R2] |
| Milo | model-based | Negative-binomial GLM per neighbourhood with replicate-aware FDR; cell mapping not defined here | [R3, R6] |
| kNN and graph averages | heuristic | Mean condition indicator over kNN or graph neighbours, as in MELD's comparison code | [R1] |

MELD and DA-seq are the published per-cell standards and both stay as comparators, with the kNN and graph averages as the heuristic floor. Milo is the replicate-aware standard at neighbourhood level. MELD's default $\beta$ comes from Splatter simulations [R5]. Lines refer to MELD at commit 1a8701d and DA-seq at commit b1f58e0.

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| MELD | beta | 60 in `__init__`; class attribute 40 | meld/meld.py:96; meld/meld.py:46 |
| MELD | chebyshev_order | 50 in `__init__`; class attribute 30 | meld/meld.py:101; meld/meld.py:78 |
| MELD | order, offset | 1, 0 | meld/meld.py:98, 97 |
| MELD | filter, solver | heat, chebyshev | meld/meld.py:99-100; meld/filter.py:47-50 |
| MELD | lap_type | combinatorial | meld/meld.py:102 |
| MELD | sample_normalize | True | meld/meld.py:103, 229-232 |
| MELD | L1 normalisation across labels | row-sum to one | meld/utils.py:35-47 |
| MELD | benchmark graph | PCA with 100 components, use_pygsp=True | meld/benchmark.py:94-111 |
| MELD | kNN and graph averages | mean indicator over neighbours | comparison/comparison.py:309-344 |
| DA-seq | k.vector | round(seq(0.0035n, 0.035n, length.out = 10)) | R/getDAcells.R:70-71 |
| DA-seq | kNN query | nn2(X, X, k = max), includes the cell itself | R/getDAcells.R:76 |
| DA-seq | alpha, k.folds, n.runs, n.rand | 0, 10, 5, 2 | R/getDAcells.R:44-45 |
| DA-seq | n.runs in updateDAcells and runDAlasso | 10 | R/getDAcells.R:250, 384 |
| DA-seq | prediction | lambda.1se, type response | R/getDAcells.R:393-395 |
| DA-seq | permutation | labels shuffled across all cells | R/getDAcells.R:107-111 |
| DA-seq | balanced transform | balanceP | R/getDAcells.R:407-414 |
| Milo | prop, k, d, refined | 0.1, 21, 30, TRUE | miloR R/makeNhoods.R:56; pertpy src/pertpy/tools/_milo.py:273 (prop) |

## 5. Proposed singlet approach

**Routes.** DA-seq is ported (permissive licence), with its kNN fractions, logistic fit and balanced transform re-implemented in the singlet core. MELD is reimplemented from section 3, with a Chebyshev heat filter on a sparse graph; no code is copied. Milo stays with the neighbourhood task, and PHATE is used only to build benchmark truth. Licence terms are in section 12.

**Proposed default: sample-grouped logistic density ratio.** Fit ridge logistic regression of $c_i$ on the embedding coordinates, with folds grouped by sample and averaged over repeated splits. Convert the out-of-fold $\hat\pi_i$ to $\hat r_i$ and $\hat s_i$ as in section 3. The model is low-dimensional and dense, so it is hard-coded: IRLS or Newton steps with batched Cholesky solves on CUDA, and a CPU path. No PyTorch model is proposed for this task.

**Thresholds.** The flag is an empirical FDR. Permute condition across samples within batch, count the cells above each threshold under the permutations, and call the cells at the smallest threshold whose estimated FDR is at most `fdr_level`. DA-seq's cell-level permutation is kept as a comparator only.

**Output contract and falsification.** Every method writes $s$ on $[-1,1]$. Uns records the estimand, the effective parameters and the permutation summary. The proposal is falsified if it fails the B1 accuracy criterion or the B3 null check.

**Defaults for agents.** Use the logistic default with ten folds, five repeats, a ridge penalty and 100 permutations. Use MELD with sample normalisation only when a uniform-prior relative likelihood is the stated goal. Do not compute inferential flags with one sample per condition.

**Kernels.** Sparse matrix-vector products (kNN fractions and Chebyshev filter steps) execute on CUDA with cuSPARSE and on CPU. No streaming is claimed (see the MCP metadata).

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/<embedding_key> | float32, cells by dimensions | Features for the default estimator; kNN graph source for MELD and DA-seq |
| read | obs/<sample_key> | categorical | Sample or donor of each cell; nested within condition |
| read | obs/<condition_key> | categorical, two levels | Sample-level condition, constant within sample |
| write | obs/<method>_score | float32 in [-1, 1] | Balanced score $s$ from section 3, on the same scale for all methods |
| write | obs/<method>_fdr_flag | bool | Calls at the method's threshold, where one is defined |
| write | uns/<method>_params | dict | Effective parameters, class sizes, permutation summary, method version and source commit |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "logistic_density_ratio" | `logistic_density_ratio`, `meld`, `daseq` | Estimator. The default is the proposed sample-grouped logistic density ratio; meld and daseq are published comparators. |
| `condition_key` | string | required | — | obs column with two condition levels, constant within each sample. |
| `sample_key` | string | required | — | obs column with the sample or donor of each cell; defines grouped folds and permutations. |
| `embedding_key` | string | "X_pca" | — | obsm key of the embedding: features for the logistic estimator, kNN graph for MELD and DA-seq. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for cross-fitting fold splits and label permutations. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `logistic_density_ratio` | object | — | — | Options for the default estimator. |
| `logistic_density_ratio.alpha` | number | 0 | min 0; max 1 | Elastic-net mixing: 0 is ridge. |
| `logistic_density_ratio.k_folds` | integer | 10 | min 2 | Cross-fitting folds, grouped by sample. |
| `logistic_density_ratio.n_runs` | integer | 5 | min 1 | Repeats of the fold split; out-of-fold predictions are averaged. |
| `logistic_density_ratio.fdr_level` | number | 0.05 | min 0; max 1 | Nominal empirical FDR for the flag, from sample-level permutations. |
| `logistic_density_ratio.n_perm` | integer | 100 | min 0 | Sample-level label permutations for the FDR threshold; 0 disables the flag. |
| `meld` | object | — | — | Options for the MELD heat-filter comparator. |
| `meld.beta` | number | 60 | > 0 | Heat-kernel smoothing relative to the largest graph eigenvalue. |
| `meld.order` | number | 1 | > 0 | Falloff exponent of the filter; 1 gives the exponential heat kernel. |
| `meld.chebyshev_order` | integer | 50 | min 1 | Order of the Chebyshev approximation of the filter. |
| `meld.sample_normalize` | boolean | true | — | True gives a uniform-prior relative likelihood; false gives the population posterior. |
| `daseq` | object | — | — | Options for the DA-seq comparator. |
| `daseq.k_fraction_min` | number | 0.0035 | max 1; > 0 | Smallest neighbourhood size as a fraction of cells. |
| `daseq.k_fraction_max` | number | 0.035 | max 1; > 0 | Largest neighbourhood size as a fraction of cells; index memory grows with it. |
| `daseq.k_folds` | integer | 10 | min 2 | Cross-fitting folds. |
| `daseq.n_runs` | integer | 5 | min 1 | Repeats of the fold split. |
| `daseq.n_perm` | integer | 2 | min 0 | Cell-level label permutations for the threshold; 2 is the shipped default. |
<!-- PARAMS:AUTO:END -->

Only the block named by `method` is read; other blocks are recorded as unused in uns. The condition column must have two levels, constant within each sample, or the call fails. MELD's effective `beta` and `chebyshev_order` are recorded because source defaults disagree (section 4). DA-seq neighbourhood sizes are recorded as absolute counts, since they scale with the number of cells.

## 7. MCP tool

Tool `singlet_abundance_cell_level_da_score`, defined in `tasks/mcp/singlet_abundance_cell_level_da_score.json`. Example call:

```json
{
  "dataset": "/data/example.singlet",
  "condition_key": "condition",
  "sample_key": "donor",
  "logistic_density_ratio": {"n_perm": 100, "fdr_level": 0.05}
}
```

Example result, with values left as placeholders:

```json
{
  "dataset": "/data/example.singlet",
  "status": "completed",
  "wrote": ["obs/logistic_density_ratio_score", "obs/logistic_density_ratio_fdr_flag", "uns/logistic_density_ratio_params"],
  "summary": {"method": "logistic_density_ratio", "n_cells": "<int>", "n_flagged": "<int>", "threshold": "<float>"},
  "provenance_id": "<id>"
}
```

Long-running: yes when permutations are requested (`n_perm` above zero). Stochastic: yes, through fold splits and permutations, both fixed by `seed`. Dry run: returns the estimate object with device, seconds and peak memory, without fitting.

## 8. Benchmarks

Shared protocol: every method is applied to the same embedding and the same kNN graph within each benchmark. Seeds 0 to 19 are the minimum, and results are reported as medians with interquartile ranges across seeds. Each estimator output is converted to $\ell=(1+s)/2$ before comparison with $\ell^\star$ from section 3. MSE against pdf is reported only where the realised class proportions are equal. Thresholds are each method's own.

### B1. Planted per-cell relative likelihood (MELD generator)

- **Goal**: recover the per-cell uniform-prior relative likelihood of condition 2 from a planted smooth probability.
- **Ground truth**: planted simulation. $\mathrm{pdf}_i=\mathrm{expit}(\mathbf z_i^\top\mathbf w)$, with $\mathbf z_i$ three-dimensional PHATE coordinates [R4] and $\mathbf w$ drawn per seed as in the MELD generator [R1]; labels $c_i\sim\mathrm{Bernoulli}(\mathrm{pdf}_i)$. The estimand is $\ell^\star$ (section 3), which gives each condition equal prior weight.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue count matrix with 100 PCA components and a 3-D PHATE truth embedding | singlet catalogue; generator [R1, R4] | scRNA-seq; per dataset | — | One dataset per tissue; choice open (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| MSE to $\ell^\star$ | Mean of $(\hat\ell_i-\ell^\star_i)^2$ over cells | minimise | primary | [R1] |
| Pearson r with $\ell^\star$ | Correlation over cells | maximise | guardrail | — |
| AUROC for label | Rank-based, average ranks for ties, against $c_i$ | maximise | guardrail | — |
| Calibration slope | OLS slope of $\ell^\star$ on $\hat\ell$ | closer to 1 | guardrail | — |

- **Comparators**: MELD at $\beta=60$ and on a log-spaced grid (best value reported as an oracle); kNN and graph averages; DA-seq; logistic default. Protocol: 100 PCA components as in the MELD generator; at least 20 seeds.
- **Acceptance criterion** (proposed, not from the literature): median MSE over at least 20 seeds at most 1.1 times the best default comparator's median MSE, and median Pearson r at least 0.8. The slope is reported without a criterion.
- **Known pitfalls**: pdf is smooth in the PHATE coordinates, which favours graph smoothing by construction; repeat with a second embedding. Each cell's single Bernoulli draw adds Monte-Carlo variance that the seeds must carry.

### B2. Planted subpopulation abundance shift (proposed)

- **Goal**: recover the cells of a non-cluster-aligned region whose abundance differs between conditions, and test whether the threshold controls empirical FDR.
- **Ground truth**: planted simulation; membership in $R$ is known by construction, and the planted ratio (condition 2 over 1) is $f$ inside $R$ and 1 outside, in expectation.
- **Generator recipe** (proposed): on a catalogue dataset with sample identifiers, compute 50 PCA dimensions and a kNN graph ($k=15$); let $R$ be the union of the nearest 1 percent of cells to each of three random seeds. Per sample $j$, set $f_j=f\,e^{\varepsilon_j}$ with $\varepsilon_j\sim N(0,0.25^2)$. If $f\ge1$, keep each $R$ cell of a condition-1 sample with probability $\min(1,1/f_j)$; if $f<1$, keep each $R$ cell of a condition-2 sample with probability $\min(1,f_j)$. Set $y_i=\mathbf 1[i\in R]$ and draw at least 20 replicates over $f\in\{0.5,2,4\}$, $S\in\{2,3,6\}$ samples per condition, 30 or 50 PCA dimensions and $k\in\{15,30\}$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue dataset with sample identifiers | singlet catalogue; recipe above | scRNA-seq; per dataset | — | Identifiers unverified (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC and AUPRC for $R$ | Rank-based, against $y_i$ | maximise | primary | — |
| Empirical FDR at 0.05 | Fraction of called cells outside $R$, using each method's threshold | minimise | primary | — |
| Power at 0.05 | Fraction of cells in $R$ called | maximise | guardrail | — |
| Calibration error | Bin-weighted gap between mean $\hat\ell$ and fraction in $R$, 10 bins | minimise | guardrail | — |

- **Comparators**: MELD (no threshold); DA-seq as shipped (two permutations) and with at least 20; kNN average; logistic default; results stratified by $S$.
- **Acceptance criterion** (proposed, not from the literature): at nominal 0.05, power at least 0.5 when $f\ge2$ and $S\ge3$; empirical FDR at most 0.10 in at least 90 percent of settings.
- **Known pitfalls**: subsampling favours density methods in the graph's own embedding, so vary the embedding; at $S=2$ sample variance dominates.

### B3. Sample-level null calibration (proposed)

- **Goal**: check that thresholded calls are not produced when condition is exchangeable across samples.
- **Ground truth**: null by construction. Take a dataset with at least four samples from one condition and a batch column, and assign pseudo-conditions to samples at random within batch. Every flagged cell is a false call.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue dataset with at least four samples of one condition and a batch column | singlet catalogue | scRNA-seq; per dataset | — | Depends on the identifiers in section 10 |

- **Permutations**: enumerate every batch-consistent labelling when there are at most 200 (six for two plus two samples); otherwise draw 200 at random.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Empirical FDR of calls | Mean over labellings of the fraction of cells flagged | minimise | primary | — |
| Family-wise error | Fraction of labellings with at least one cell flagged | minimise | guardrail | — |

- **Comparators**: DA-seq as shipped (cell-level permutation); DA-seq with sample-level permutation; logistic default; MELD with a sample-level permutation threshold on its ranking.
- **Acceptance criterion** (proposed, not from the literature): empirical FDR at most 0.05, or at most 0.10 where exact enumeration is coarse. Cell-level permutation is expected to exceed this bound and serves as the diagnostic.
- **Known pitfalls**: DA-seq shuffles labels across cells, so its null treats cells as replicates and is anti-conservative under donor structure. Permute within batch, because batch confounded with sample assignment inflates null calls.

### P1. Performance and scaling

Wall time and peak memory of the scoring step on a fixed kNN graph, with graph construction measured separately and shared by all methods. Scales: $10^4$, $10^5$ and $10^6$ cells; $10^7$ is not claimed because streaming is off. Devices: CPU and CUDA, recorded per measurement. Comparators: MELD (Chebyshev order 50), DA-seq with its index at $k_{\max}=0.035n$, the kNN average, and the logistic default with and without its permutation threshold. Hold fixed: 50 embedding dimensions, $k=15$, eight samples (four per condition), thread count and Chebyshev order. Report log-log slopes for time and memory. Derived, not measured: at $n=10^6$ the DA-seq index has $k_{\max}=35{,}000$ columns, that is $3.5\times10^{10}$ integer entries, about 140 GB at four bytes each. No numeric acceptance is set.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `integration.batch_corrected_embedding`: Batch-corrected joint embedding
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
- **Feeds**:
  - `abundance.phenotype_associated_cells`: Cell neighbourhoods whose abundance covaries with a sample-level phenotype
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
- **Reads**: `obsm/<embedding_key>`, `obs/<sample_key>`, `obs/<condition_key>`
- **Writes**: `obs/<method>_score`, `obs/<method>_fdr_flag`, `uns/<method>_params`
<!-- CHAINING:AUTO:END -->

Composition workflows run this score after embedding and batch correction. No named recipe is assigned in this document.

## 10. Risks, pitfalls and open questions

- **Evidence not located**: head-to-head per-cell results for MELD, DA-seq and Milo on real data; the vertex-frequency-clustering comparison and its datasets in the MELD paper; the DA-seq simulation design; the Splatter setup behind $\beta=60$; the Milo2.0 authors; and sample or donor identifiers in catalogue cells, on which B2 and B3 depend. The local miloR copy has no commit identifier, so its defaults are tied to the file rather than to a revision.
- **Unsettled literature**: the estimand (uniform or population prior) changes the reported probability whenever class sizes differ; no per-cell method gives calibrated uncertainty; the validity of permutation thresholds under donor structure is open. Milo's neighbourhood-to-cell mapping is our construction and is not benchmarked here.
- **Technical and licence risks**: DA-seq's index holds $n\times0.035n$ entries, so a port needs a sparse or landmark alternative at large $n$ (P1). MELD's landmark option may change the estimand. The licence terms in section 12 need review before derived code ships.
- **First experiment**: apply B1 to one catalogue dataset with all comparators and at least 20 seeds, then the B3 null on a single-condition dataset, then the stability check (proposed: median pairwise Spearman correlation of at least 0.8 across $k\in\{10,15,30\}$ and PCA dimensions $\{30,50\}$).

## 11. References

R1. Burkhardt DB et al. Quantifying the effect of experimental perturbations at single-cell resolution. *Nat Biotechnol* 2021. doi:10.1038/s41587-020-00803-5 — verified (corpus)
R2. Zhao J et al. Detection of differentially abundant cell subpopulations in scRNA-seq data. *Proc Natl Acad Sci U S A* 2021. doi:10.1073/pnas.2100293118 — verified (corpus)
R3. Dann E et al. Differential abundance testing on single-cell data using k-nearest neighbor graphs. *Nat Biotechnol* 2022. doi:10.1038/s41587-021-01033-z — verified (corpus)
R4. Moon KR et al. Visualizing structure and transitions in high-dimensional biological data. *Nat Biotechnol* 2019. doi:10.1038/s41587-019-0336-3 — verified (corpus)
R5. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biol* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R6. Milo2.0: unlocks population genetic analyses of cell state abundance using a count-based mixed model. bioRxiv preprint 2023. doi:10.1101/2023.11.08.566176 — verified (corpus)
R7. theislab/single-cell-best-practices, conditions chapter, key takeaway 3 (repository file conditions/compositional_keytakeaways.txt). — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/KrishnaswamyLab/MELD | Daniel Burkhardt (setup.py author); Krishnaswamy Lab, Yale University (LICENSE) | Dual: GPL-3.0 open-source (LICENSE-GPL3.txt) or commercial (LICENSE) | Heat filter, relative likelihood, comparison and generator code | reimplement |
| https://github.com/KlugerLab/DAseq | Jun Zhao (DESCRIPTION author and maintainer) | MIT (LICENSE, copyright 2020 Jun Zhao); DESCRIPTION licence field empty | Multi-scale kNN fractions, cross-fitted logistic fit, balanced transform | port |
| https://github.com/MarioniLab/miloR | Mike Morgan (author, maintainer); Emma Dann (author, contributor) (DESCRIPTION) | GPL-3 (DESCRIPTION: GPL-3 + file LICENSE) | Neighbourhood design defaults | callout (not benchmarked here) |
| https://github.com/scverse/pertpy | Lukas Heumos (maintainer, pyproject.toml) | MIT (LICENSE) | Milo port defaults | callout (not benchmarked here) |
| https://github.com/KrishnaswamyLab/PHATE | Daniel Burkhardt (author); João Felipe Rocha and Matthew Scicluna (maintainers), pyproject.toml | Non-commercial licence file (LICENSE.md); pyproject.toml declares GPL-2.0 (conflict) | Truth embedding in B1 only | callout |
