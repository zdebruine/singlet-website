---
id: feature-selection.number_of_features
title: Choosing how many features to keep
area: feature-selection
scope: core
paradigm: hybrid
literature_status: open
priority: P1
depends_on: [feature-selection.highly_variable_gene_selection, normalization.size_factor_estimation]
feeds: [dim-reduction.normalized_cell_embedding, integration.batch_corrected_embedding, feature-selection.reference_mapping_features, feature-selection.selected_feature_stability]
reads: [layers/counts, layers/log1p_norm, obs/<batch_key>, obs/<label_key>, obs/<split_key>]
writes: [var/feature_count_selected, var/feature_count_rank, uns/feature_count_curve, uns/feature_count_n]
devices: [cpu, cuda]
mcp_tool: singlet_feature_selection_number_of_features
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Choosing how many features to keep

> Choose how many top-ranked genes feed PCA, neighbour graphs and integration, by a fixed count kept as the published comparator or by a plateau rule over a declared grid scored against author labels.

## 1. Question

Given a gene ranking from any selector, the count matrix and a downstream task (integration, reference mapping, classification or unseen-population detection), how many top-ranked genes $N$ should be kept, and does one rule for $N$ hold across datasets? The output is an integer $N$ or a stopping rule, with the downstream score as a function of $N$. A correct answer is a rule whose chosen $N$ scores within a declared tolerance of the best value on a declared grid, on datasets that did not inform the choice [R1]. The proxies are author labels and simulated planted structure [R2].

## 2. Why this task matters and where the field stands

Every embedding built on the selected genes takes $N$ as an input: PCA, the neighbour graph, clustering and integration all change with it. Too few genes can drop the weak markers of rare and unseen populations, which top-X selection can miss [R3]. Too many admit genes whose variation is technical, which dilutes the leading principal axes. Most pipelines fix $N$ at 2,000 by convention (the default of Seurat's `FindVariableFeatures` and of scib's `hvg_batch`), and the best-practices notebooks set `n_top_genes` between 2,000 and 5,000 [R4]; those values describe practice, not optimality.

The status is **open**. No accepted criterion sets $N$, and the field disagrees about which metric should decide it. The Zappia et al. design scores integration, mapping, classification and unseen-population metrics over one grid of $N$ on ten datasets (nine atlases and one Splatter simulation), so the optimum can be read per metric and per task [R1]. Whether one rule holds across datasets is the question that design can test.

Open problems:

- **Metric weighting.** The composite score gives integration and the query tasks half the weight each, so the apparent optimum depends on that weighting [R1].
- **Rare and unseen populations.** Small $N$ removes weak markers of rare and unseen types; the OSCA chapter on more highly variable genes notes that markers of rare subpopulations seldom show strong overdispersion [R3].
- **Noise at large $N$.** A spiked-covariance result gives a detection threshold that rises with the number of features, but only under isotropic noise and a single spike, so it explains a direction and not a value [R5].
- **Transfer.** Whether one rule transfers across datasets, integrators and tasks is open. The Zappia design uses one integration seed per setting [R1].
- **Label circularity.** A rule that chooses $N$ with the labels that score it is in-sample. The benchmarks in section 8 hold data out.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $n$, $F$ | cells; total features in the dataset, with $N\le F$ |
| $s_g$ | ranking statistic of gene $g$ from the chosen selector; higher is more variable |
| $T_N$ | top-$N$ set |
| $S_t(N)$ | downstream score for task $t$ at $N$, scaled as defined below |
| $\mathcal G$, $K$, $\delta$ | candidate grid (values above $F$ become $F$); seeds; plateau tolerance |
| $\mathrm{DE}$, $R$ | planted differentially expressed gene set; planted rare group |

**Nested sets and the trade-off.** For a fixed ranking the top-$N$ sets are nested, so raising $N$ only adds genes in rank order:

$$T_N=\operatorname{top}_N\{s_g\},\qquad T_N\subset T_{N+1}.\tag{1}$$

A small $N$ discards weakly variable genes that can carry rare-population or minor-program signal (bias). A large $N$ admits genes whose variation is technical or irrelevant to the task, which changes neighbour distances and the leading axes (variance). The score $S_t(N)$ is therefore task-specific and often plateau-shaped. The estimand is $N^\star_t=\arg\max_{N\in\mathcal G}\mathbb E_k[S_{t,k}(N)]$, the grid value that maximises the expected score over datasets or seeds $k$. Nesting holds only for a fixed ranking; resampled cells give different sets, so stability is a separate property.

**Spiked-covariance threshold.** Under a rank-one spike of strength $\ell$ in isotropic, unit-variance noise, the largest sample eigenvalue separates from the noise bulk only when

$$\ell>\ell_{\mathrm{crit}}(\gamma)=1+\sqrt{\gamma},\qquad \gamma=\frac{N}{n},\tag{2}$$

with $N$ features entering PCA and $n$ cells [R5]. Adding noise features at fixed $n$ raises the threshold, and dropping informative genes lowers the effective spike. This gives a formal reason for an interior optimum in $N$, but no value for it. The regime is asymptotic ($N$ and $n$ large with $\gamma$ fixed), with one spike and Gaussian-like isotropic noise. Single-cell data have heavy tails, correlated noise and many populations, so (2) gives direction only.

**Null models.** Count-based statistics compare each gene with a technical null on raw counts, with library size as the depth offset: Pearson residuals under a shared negative-binomial model [R6], sctransform with a regularised per-gene fit [R7], and binomial deviance against a constant-rate multinomial null [R8]. Trend-based statistics fit the mean-variance relation and rank by excess variance over it, as in Seurat's variance-stabilising transform [R9] and the variance-above-trend decomposition [R10]. Binned dispersions (the Seurat v1 and Cell Ranger flavours) normalise within bins and have no likelihood [R11]. Different statistics select different sets at the same $N$, so the statistic and $N$ should be evaluated apart.

**Model-based alternative.** A fitted null gives each gene a posterior probability $P_g$ of being non-null. Under that model the expected number of null genes admitted by the top $N$ is $\sum_{g\in T_N}(1-P_g)$, and $N$ can be chosen to keep it under a fixed limit. This is calibrated only where the null holds, within batch and with probabilities estimated mostly from null genes, so its validity is that of the null. A heuristic cut has no such quantity.

**Scores and normalisation.** Each metric is scaled per dataset as $\tilde v=(v-L)/(U-L)$, where $L$ and $U$ are the minimum and maximum over the baseline methods on that dataset [R1]. Zero is the worst baseline and one the best; values can leave $[0,1]$ when a method beats the baseline range. A type score is the mean of its scaled metrics, and the composite is

$$\mathrm{Overall}=\tfrac14\,\bar S_{\mathrm{IB}}+\tfrac14\,\bar S_{\mathrm{IBio}}+\tfrac16\,(\bar S_{\mathrm M}+\bar S_{\mathrm C}+\bar S_{\mathrm U}),$$

where $\bar S$ is the type mean for integration batch mixing, integration biology, mapping, classification and unseen populations [R1].

**Simulation estimands.** Feature recall is $|T_N\cap\mathrm{DE}|/|\mathrm{DE}|$, normalised by the planted DE count rather than by $N$, so it rises with $N$ by construction. Rare F1 is $\max_C 2|C\cap R|/(|C|+|R|)$ over graph clusters $C$. A recall-only form, $\max_C|C\cap R|/|R|$, is maximised by a cluster that holds every cell, so it is not used. ARI is chance-corrected: 0 is chance and 1 is identical partitions.

**Plateau rule (proposed).** Average the score over $K$ seeds and take the smallest $N$ within tolerance:

$$\bar S_t(N)=\frac1K\sum_{k=1}^{K}S_{t,k}(N),\qquad N_{\mathrm{plat}}=\min\Bigl\{N\in\mathcal G:\ \bar S_t(N)\ge\max_{N'\in\mathcal G}\bar S_t(N')-\delta\Bigr\}.\tag{3}$$

The rule has no statistical model, so it is heuristic; its behaviour depends on how flat $S_t$ is. It is a valid selection procedure only when the grid, $K$ and $\delta$ are fixed before the scores are seen. On flat curves it returns a smaller and cheaper $N$.

**Failure modes.** Count nulls assume that library size tracks technical depth, and they fail when biology correlates with cell size. Trend methods fail when high-abundance, highly variable genes pull the trend. Binned dispersions depend on the bin number and pseudocount. Clipped statistics scale their clip with $\sqrt{n}$, so ranks depend on cells per batch. Inputs differ: `seurat` and `cell_ranger` take log-normalised values, while the count statistics take raw counts, so $N$ is not like-for-like across flavours. Values above the feature count are replaced by all features, and the effective $N$ must be reported.

**Pitfalls in benchmarks.** A fixed 2,000 is presented as optimal; labels are used both to choose and to score $N$; a single integration seed is used; a coarse grid leaves optima between points; and $N$ above $F$ is clipped silently.

**Cost.** Count statistics and moments need a single traversal of the non-zero entries. A plateau rule multiplies the cost of the downstream pipeline by $|\mathcal G|K$. Measured costs are in section 8.

**Insight.** $N$ is not a dataset-invariant constant, and the value that maximises an integration score need not maximise a mapping score. The defensible default is a declared, task-specific sweep with a grid, seeds and tolerance, reported as a plateau. The fixed 2,000 is a convention, and the plateau rule can be tested against it.

## 4. Methods landscape

The published standard is a fixed top-$N$ cut at a common value of 2,000 [R4][R12]. Four published procedures set $N$ from data: the SCTransform residual threshold, scib's intersection fill-up, the variance-trend FDR option and the Zappia sweep. The remaining rows are ranking statistics kept as comparators. The Zappia sweep is the design that the plateau rule builds on.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Fixed top-$N$ cut | heuristic | keep the first $N$ genes of any ranking; $N$ by convention | [R4] |
| scanpy `seurat`, `cell_ranger` | heuristic | binned dispersion of log-normalised data; normalised within bins | [R11] |
| scanpy `seurat_v3`; Seurat variance-stabilising transform | model-based | loess trend of log variance on log mean of counts; clipped, standardised variance | [R9] |
| scanpy `pearson_residuals` | model-based | variance of clipped analytic Pearson residuals with fixed $\theta$ (default 100) | [R6] |
| Seurat SCTransform threshold | model-based | regularised negative-binomial fit per gene; top $N$ by residual variance, or residual variance at least 1.3 | [R7] |
| scvi-tools `poisson_gene_selection` | model-based | M3Drop-based zero enrichment against a library-scaled Poisson count model; enrichment is a posterior probability from a binomial model, estimated by sampling | [R13] |
| Binomial deviance | model-based | deviance against a constant-rate multinomial null on raw counts | [R8], [R4] |
| Variance above trend (OSCA) | model-based | excess variance over a mean trend; top $X$ or a false-discovery cut | [R3] |
| scib `hvg_batch`, `hvg_intersect` | heuristic | per-batch HVG selection with fill-up; `hvg_intersect` grows $n$ by a step until a target | [R14] |
| Feature-count sweep | heuristic | downstream metrics scored at each $N$ and selector; choose the plateau | [R1] |

Defaults singlet reproduces or cites, from source at the recorded revisions:

| Method | Parameter | Value | Source |
|---|---|---|---|
| Fixed top-$N$ convention | `target_genes` in scib `hvg_batch`; `hvgs` in OpenProblems | 2000 | `scib/preprocessing.py:466` @cd67913; `src/data_processors/process_dataset/script.py:12` @b3da9d6 |
| Seurat variable-feature selection | `nfeatures` | 2000 | `R/preprocessing.R:4727` @5f67c70 |
| Seurat SCTransform | `variable.features.n`; `variable.features.rv.th` | 3000; 1.3 | `R/preprocessing.R:3890-3891` @5f67c70 |
| scanpy `highly_variable_genes` | `n_top_genes`, which overrides cut-offs; `min_mean`, `max_mean`, `min_disp` | None; 0.0125, 3, 0.5 | `src/scanpy/preprocessing/_highly_variable_genes.py:636-640` @8ed52d9 |
| scib `hvg_intersect` | `target_genes`; `n_stop`, `min_genes`, `step_size` | 2000; 8000, 500, 1000 | `scib/preprocessing.py:392`, `:396-398` @cd67913 |
| scvi-tools `poisson_gene_selection` | `n_top_genes`; `n_samples`; `minibatch_size` | 4000; 10000; 5000 | `src/scvi/data/_preprocessing.py:38`, `:43`, `:46` @5555ecc |
| Variance above trend | `var.threshold`; `fdr.threshold` | 0; 0.05 (values used in the chapter) | `inst/book/more-hvgs.Rmd`:134, :161 (OSCA.advanced) @2f10501 |
| Binomial deviance | top genes stored in the chapter | 4000 | `preprocessing_visualization/feature_selection.ipynb` (`argsort()[-4000:]`) @d581689 |
| Zappia sweep | $N$ grid; integration seeds | 100 to 15000 and all; [1] | `conf/num-features.yml` (scanpy block from line 65; integration block) @b89fc0f |
| Zappia sweep | input scaling; script default $N$ | normalise and log1p for `seurat` and `cell_ranger` only; 1000 | `bin/method-scanpy.py` @b89fc0f |
| Zappia sweep | Overall weights; all-features row | as in section 3; the source's handling of $N$ above $F$ is not confirmed | `analysis/R/summarisation.R:22-31`; `analysis/03-num-features.Rmd:135` @b89fc0f |

## 5. Proposed singlet approach

**Routes.** Port the scanpy `seurat`, `cell_ranger`, `seurat_v3` and `pearson_residuals` statistics, the scib fill-up and the scvi-tools zero-enrichment statistic from the sources marked port in section 12, with attribution. Reimplement the sctransform selection from its paper and documentation, because its code is under a copyleft licence (section 12). Binomial deviance, the variance-above-trend option, Splatter and the Zappia sweep are callouts used as comparators or generators. The plateau rule reimplements the sweep design.

**Default.** `rule` fixed, `n_features` 2000 and `selection_method` pearson_residuals. This is a convention and is reported as one. When author labels and a downstream task are declared, the plateau rule is the recommended route, and the result states its grid, tolerance and seeds.

**Model-based formulation.** Proposed and not built: a predictor of $N^\star_t$ from dataset descriptors (cells, batches, label count and entropy, feature count, sparsity, depth spread), fitted on sweep results with split-conformal intervals over held-out datasets, plus the expected-noise count of section 3. Two gates decide whether it becomes a default. F1: on the held-out datasets of B1, its chosen $N$ meets the B1 acceptance criterion. F2: its 90 percent interval contains the best $N$ on at least 85 percent of held-out datasets (proposed). If either fails, the fixed rule stays the default.

**ML stack.** The predictor is small, a linear model or small MLP fitted in PyTorch. The ranking statistics are closed-form sums and moments, shared with the highly variable gene task and hard-coded in CUDA or cuSPARSE. The sweep calls the downstream pipeline and the integrator, and is not hard-coded.

**Kernels, streaming and devices.** Ranking streams over non-zero entries with $O(F)$ state per batch. The plateau sweep needs all cells in memory for each integration, so it is not streamed. CPU and CUDA ranking must agree up to ties, which break by gene index.

**Defaults an agent uses without asking.** `selection_method` pearson_residuals, `rule` fixed, `n_features` 2000, and `batch_key` null unless the study declares a batch column. Ask when a label column exists and the user wants $N$ chosen from the data, or when batch sizes differ widely, since clipped statistics then depend on batch size.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse integer | raw counts for count statistics and nulls |
| read | `layers/log1p_norm` | sparse float32 | log-normalised values for `seurat` and `cell_ranger` |
| read | `obs/<batch_key>` | categorical | batch labels when set |
| read | `obs/<label_key>` | categorical | author labels, used only to score $N$ |
| read | `obs/<split_key>` | categorical | query marker for mapping and unseen tasks |
| write | `var/feature_count_selected` | bool | the kept set, of size `effective_n` |
| write | `var/feature_count_rank` | int32 | 0 is most variable; -1 for zero-count genes |
| write | `uns/feature_count_curve` | table | columns N, seed, metric, value, scaled_value |
| write | `uns/feature_count_n` | dict | chosen $N$, rule, grid, tolerance, seeds, warnings |

The names `feature_count_*` are singlet's.

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `selection_method` | string | "pearson_residuals" | `pearson_residuals`, `seurat_v3`, `seurat`, `cell_ranger`, `sctransform`, `poisson_zero_enrichment`, `hvg_batch` | Ranking statistic. Count input: pearson_residuals, seurat_v3, sctransform, poisson_zero_enrichment. Log input: seurat, cell_ranger. hvg_batch needs batch_key. |
| `rule` | string | "fixed" | `fixed`, `plateau`, `residual_variance_threshold` | fixed keeps n_features; plateau chooses N from plateau.grid; residual_variance_threshold applies only to sctransform. |
| `n_features` | integer/null | 2000 | min 1 | Genes N for rule fixed, clipped to the feature count. Null is valid only with residual_variance_threshold. |
| `batch_key` | string/null | null | — | obs column with batch labels. Null treats the data as one batch; required by hvg_batch. |
| `plateau` | object | — | — | Options for rule plateau; ignored by other rules. |
| `plateau.task` | string | "integration" | `integration`, `mapping`, `classification`, `unseen` | Metric family scored at each N; integration uses batch-mixing and biology metrics. |
| `plateau.label_key` | string/null | null | — | obs column with author labels; required for plateau. Used only to score N, never to rank genes. |
| `plateau.split_key` | string/null | null | — | obs column marking query cells; required for tasks mapping and unseen. |
| `plateau.grid` | array | [100, 200, 500, 1000, 2000, 5000, 10000, 15000, "all"] | — | Candidate N values; "all" and values above the feature count mean all features. |
| `plateau.tolerance` | number | 0.01 | > 0 | Tolerance delta in scaled-score units; PROPOSED default, not from the literature. |
| `plateau.seeds` | array | [1, 2, 3] | — | Integration seeds averaged at each N; three or more proposed (Zappia et al. used one). |
| `sctransform` | object | — | — | Options for selection_method sctransform; ignored by other methods. |
| `sctransform.residual_variance_threshold` | number | 1.3 | > 0 | Residual-variance cut-off used when n_features is null (Seurat default). |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing any member. |
| `overwrite` | boolean | false | — | Replace existing feature_count members instead of failing. |
<!-- PARAMS:AUTO:END -->

`rule` fixed uses `n_features`; plateau uses the `plateau` object and requires `plateau.label_key`, and tasks mapping and unseen also require `plateau.split_key`. `residual_variance_threshold` requires `selection_method` sctransform and a null `n_features`; `hvg_batch` requires `batch_key`. Grid values above the feature count become all features and the effective count is returned as `effective_n`. `plateau.label_key` scores $N$ and never ranks genes, so the chosen $N$ is in-sample for those labels.

## 7. MCP tool

Tool name `singlet_feature_selection_number_of_features` (definition in `tasks/mcp/singlet_feature_selection_number_of_features.json`). Example call and compact result, with illustrative values:

```json
{"dataset": "/data/example.singlet", "selection_method": "pearson_residuals", "rule": "plateau", "batch_key": "tech", "plateau": {"task": "integration", "label_key": "celltype", "grid": [500, 1000, 2000, 5000, "all"], "seeds": [1, 2, 3]}}
```

```json
{"dataset": "/data/example.singlet", "status": "completed", "wrote": ["var/feature_count_selected", "var/feature_count_rank", "uns/feature_count_curve", "uns/feature_count_n"], "summary": {"selection_method": "pearson_residuals", "rule": "plateau", "chosen_n": 2000, "effective_n": 2000, "score_at_chosen_n": null, "curve_member": "uns/feature_count_curve", "warnings": []}, "provenance_id": "prov_0001"}
```

Long-running: `plateau` queues beyond the inline limit and returns `status` queued with a `job_id`; `fixed` completes inline. Stochastic: only through the integrator, controlled by `plateau.seeds`; no separate seed is exposed. Dry run: `estimate` gives seconds, peak memory and device for the ranking and one sweep point, and nothing is written.

## 8. Benchmarks

**Shared protocol.** Each dataset is scored at every $N$ in $\mathcal G=\{100,200,500,1000,2000,5000,10000,15000,F\}$ with $N\le F$. Downstream steps are identical across selectors and values: PCA with 50 components and a $k=15$ neighbour graph (the source's batchPCR metric also uses 50 components; these settings are proposed here), and Leiden clustering where a clustering score is used. Seeded steps are reported as mean and range. ARI is chance-corrected. B1 and B2 evaluate rules by holding data out (leave-one-dataset-out and leave-one-seed-out), so no rule is scored on the data that chose it. Reference hardware is the CPU path, and the CUDA path is reported separately.

### B1. Feature-count sweep on ten datasets (published design, Zappia et al. 2025)

- **Goal**: Test whether a rule for $N$ chosen on nine datasets keeps the tenth dataset's Overall score within tolerance of its best $N$, and whether it beats $N=2000$ [R1].
- **Ground truth**: Author cell-type labels and batch labels per cell. The per-dataset quantity is the scaled metric of section 3 for one selector, integrator and $N$; the Overall score is the composite defined there.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| scIB pancreas | [R1] | scRNA-seq, human; 18,319 features; 12,731 reference cells (7 batches), 3,243 query (2) | — | 1 unseen label |
| NeurIPS | [R1] | scRNA-seq, human; 13,953 features; 70,061 reference (9), 16,715 query (3) | — | 2 unseen |
| Fetal liver | [R1] | scRNA-seq, human; 26,686 features; 62,384 reference (11), 26,449 query (3) | — | 4 unseen |
| Human endoderm | [R1] | scRNA-seq, human; 27,855 features; 100,580 reference (10), 44,784 query (4) | — | 5 unseen |
| Reed breast | [R1] | scRNA-seq, human; 33,691 features; 337,339 reference (24), 197,649 query (17) | — | 7 unseen |
| scEiaD | [R1] | scRNA-seq, human; 19,560 features; 360,270 reference (69), 48,496 query (18) | — | 6 unseen |
| HLCA | [R1] | scRNA-seq, human lung; 27,987 features; 314,573 reference (9), 251,400 query (5) | — | 14 unseen |
| HLCA immune | [R1] | scRNA-seq, human lung immune subset; 26,618 features; 155,385 reference (7), 52,795 query (2) | — | 4 unseen |
| HLCA epithelial | [R1] | scRNA-seq, human lung epithelial subset; 27,673 features; 118,374 reference (8), 162,875 query (5) | — | 6 unseen |
| splat | [R1] | simulated scRNA-seq; 9,984 features; 30,041 reference (4), 69,936 query (2) | — | 3 unseen |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Overall | composite of section 3, scaled per dataset | higher | primary | [R1] |
| IntegrationBatch | mean of scaled batchPCR, iLISI, graphConnectivity, CMS | higher | primary | [R1] |
| IntegrationBio | mean of scaled cLISI, bNMI, isolated-label F1, isolated-label ASW, ldfDiff | higher | primary | [R1] |
| Mapping | mean of scaled mLISI, qLISI, cellDist, labelDist | higher | primary | [R1] |
| Classification | mean of scaled f1Micro, f1Macro, f1Rarity | higher | primary | [R1] |
| Unseen | mean of scaled unseenCellDist, unseenLabelDist, MILO | higher | primary | [R1] |

The 19 metrics are the included set of the source; each metric's formula is in its repository script (section 10).

- **Comparators**: scanpy `seurat`, `seurat_v3`, `cell_ranger` and `pearson_residuals` at each $N$; all features; the source's baseline methods, which set $L$ and $U$; and $N=2000$ as the fixed comparator.
- **Protocol**: Select on reference cells only, a design choice for this benchmark. For each dataset, selector and $N\le F$, integrate reference cells with scVI (two layers, seed 1), then map query cells with the source's scVI mapping. Values above $F$ become $F$; for splat, 10,000 and 15,000 both become 9,984. Leave one dataset out: $N^\star_{-d}$ is the plateau value of (3), with the nine other datasets in place of seeds, applied to their mean Overall, with $\delta=0.01$ (proposed). Score dataset $d$ at $N^\star_{-d}$.
- **Acceptance criterion**: Proposed. On at least 8 of 10 held-out datasets, the Overall at $N^\star_{-d}$ is within 0.02 of the best value in $\mathcal G$; on at least 6 of 10 it exceeds the Overall at $N=2000$.
- **Known pitfalls**: The grid is coarse above 5,000 (steps of 1.5 to 2 times), so optima between grid points are unresolved. A single integration seed gives no estimate of between-seed variance.

### B2. Planted subpopulations under a Splatter recipe (proposed)

- **Goal**: Test whether a rule for $N$ keeps planted markers and a rare group, with ground truth fixed by the simulator [R2].
- **Ground truth**: Planted simulation. Group labels, rare-group membership and the DE gene set come from the simulator; the three metrics are defined in section 3.
- **Generator** (Splatter, other parameters at defaults):
  1. For seed $s\in\{0,\dots,10\}$, draw $G_s$ uniformly from the integers 10,000 to 20,000. Seed 0 tunes the Leiden resolution and is not scored.
  2. Simulate one batch of 3,000 cells in four groups with proportions $(0.3275,0.3275,0.3275,0.0175)$; the last group is the rare group $R$.
  3. For each group $k$, draw an integer $n_k$ uniformly from 50 to 500, and set the DE probability so that about $n_k$ genes are DE in group $k$.
  4. Record every parameter per seed.
  5. Output raw counts, group labels, rare membership and the DE set, which is the set of genes with a non-unit fold factor in any group.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted-group simulation, seeds 1 to 10 | generator above; [R2] | simulated scRNA-seq; 3,000 cells; $G_s$ genes | — | seed 0 tunes resolution only |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Feature recall at $N$ | $\lvert T_N\cap\mathrm{DE}\rvert/\lvert\mathrm{DE}\rvert$ | higher | primary | [R2] |
| Rare F1 | $\max_C 2\lvert C\cap R\rvert/(\lvert C\rvert+\lvert R\rvert)$ over Leiden clusters | higher | primary | proposed |
| ARI | adjusted Rand index of clusters against the four planted groups | higher | primary | proposed |
| Runtime, peak memory | selection, PCA and neighbours | lower | guardrail | proposed |

- **Comparators**: scanpy `seurat`, `seurat_v3`, `cell_ranger` and `pearson_residuals`; all features; $N=2000$.
- **Protocol**: For $N\in\{100,200,500,1000,2000,5000,F\}$, select genes, compute 50 principal components and a $k=15$ neighbour graph, and cluster with Leiden at the resolution fixed on seed 0. The rule under test is leave-one-seed-out: for each scored seed $s$, $P(s)$ is the plateau value (3) of the mean ARI over the other nine scored seeds with $\delta=0.01$ (proposed). Report all metrics at $P(s)$ and at $F$.
- **Acceptance criterion**: Proposed. ARI at $P(s)$ is within 0.02 of the best grid ARI on at least 9 of 10 seeds, and rare F1 at $P(s)$ is within 0.05 of its value at all features on at least 8 of 10 seeds.
- **Known pitfalls**: Planted DE genes are strong by construction, so feature recall is a sanity check that rewards any selector ranking strong effects. Leiden resolution can dominate ARI; it is fixed on seed 0 and not varied.

### P1. Performance and scaling

Wall time and peak memory of (a) the ranking step for each `selection_method` and (b) one sweep point (PCA, neighbours and the integrator), at $10^4$, $10^5$ and $10^6$ cells with 10,000 and 30,000 features, on sparse CSR input, CPU and CUDA reported separately (design choices). Held fixed: non-zero entries per cell, $N\in\{2000,5000\}$, float32, batch count, thread count and hardware. Comparators: scanpy flavours, Seurat variance-stabilising transform and SCTransform (R), scvi-tools `poisson_gene_selection` and scib `hvg_batch`. Acceptance: proposed. At each scale the ranking time is within 1.1 times that of the comparator for the same statistic, and the selected sets agree with it up to ties.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
- **Feeds**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `integration.batch_corrected_embedding`: Batch-corrected joint embedding
  - `feature-selection.reference_mapping_features`: Feature selection for reference mapping and label transfer
  - `feature-selection.selected_feature_stability`: Robustness and reproducibility of selected feature sets
- **Reads**: `layers/counts`, `layers/log1p_norm`, `obs/<batch_key>`, `obs/<label_key>`, `obs/<split_key>`
- **Writes**: `var/feature_count_selected`, `var/feature_count_rank`, `uns/feature_count_curve`, `uns/feature_count_n`
<!-- CHAINING:AUTO:END -->

Workflow: single-dataset and integration recipes, after highly variable gene selection and before PCA; the reference-mapping recipe uses the same rule with a query split.

## 10. Risks, pitfalls and open questions

- **Zappia et al. full text.** The article was not accessible. The per-$N$ numbers, the direction of each metric, the per-metric formulas in the repository scripts, whether the workflow selects on reference cells only, the figshare metric files, and the dataset accessions and licences are therefore not stated in this document. Trends from secondary summaries are unverified and are not used.
- **Unsettled literature.** No accepted rule for $N$ exists. Whether any rule transfers across datasets, integrators (the source also uses Symphony and scANVI, whose results are not in this document) and tasks is open, and the sensitivity of the best $N$ to the Overall weights is unreported.
- **Method sources.** Binomial deviance and the variance-above-trend option are described from the best-practices and OSCA chapters, not from their primary papers. Equation (2) is stated from the standard result; only the abstract and bibliographic records of the paper were checked.
- **Unassessed scale and data.** The feasibility of sweeps over the 354 million-cell catalogue, the number of annotated studies usable for the predictor, and the provenance of its annotations are unassessed.
- **First experiment.** Obtain the ten Zappia datasets, rank them with `pearson_residuals` and `seurat`, evaluate the grid with three integration seeds, and compare the leave-one-dataset-out rule with $N=2000$ on B1; in parallel, evaluate B2 over ten seeds.

## 11. References

R1. Zappia L, Richter S, Ramírez-Suástegui C, Kfuri-Rubens R, Vornholz L, Wang W, Dietrich O, Frishberg A, Luecken MD, Theis FJ. Feature selection methods affect the performance of scRNA-seq data integration and querying. *Nature Methods* 2025. doi:10.1038/s41592-025-02624-3 — verified (repo)

R2. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)

R3. Amezquita RA, Lun ATL, Becht E, et al. Orchestrating single-cell analysis with Bioconductor. *Nature Methods* 2020. doi:10.1038/s41592-019-0654-x — verified (corpus)

R4. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)

R5. Baik J, Ben Arous G, Péché S. Phase transition of the largest eigenvalue for nonnull complex sample covariance matrices. *Annals of Probability* 2005;33(5):1643–1697. doi:10.1214/009117905000000233 — verified (search)

R6. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)

R7. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019. doi:10.1186/s13059-019-1874-1 — verified (corpus)

R8. Townes FW, Hicks SC, Aryee MJ, Irizarry RA. Feature selection and dimension reduction for single-cell RNA-Seq based on a multinomial model. *Genome Biology* 2019. doi:10.1186/s13059-019-1861-6 — verified (corpus)

R9. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)

R10. Lun ATL, McCarthy DJ, Marioni JC. A step-by-step workflow for low-level analysis of single-cell RNA-seq data with Bioconductor. *F1000Research* 2016. doi:10.12688/f1000research.9501.2 — verified (corpus)

R11. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)

R12. Luecken MD, Theis FJ. Current best practices in single-cell RNA-seq analysis: a tutorial. *Molecular Systems Biology* 2019. doi:10.15252/msb.20188746 — verified (corpus)

R13. Andrews TS, Hemberg M. M3Drop: dropout-based feature selection for scRNASeq. *Bioinformatics* 2019. doi:10.1093/bioinformatics/bty1044 — verified (corpus)

R14. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2021. doi:10.1038/s41592-021-01336-8 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scanpy | scverse; LICENSE copyright lines name F. Alexander Wolf, P. Angerer and Theis Lab (2017) and scverse (2025) | BSD-3-Clause (LICENSE file; pyproject.toml) | reference for `seurat`, `cell_ranger`, `seurat_v3` and `pearson_residuals`; parity target | port |
| https://github.com/scverse/scvi-tools | scvi-tools developers; LICENSE copyright line names Yosef Lab, Weizmann Institute of Science | BSD-3-Clause (LICENSE file; copyright 2026) | `poisson_gene_selection`; scVI integrator in B1 | port |
| https://github.com/theislab/scib | Luecken et al. (README citation) and the Theis Lab | MIT (LICENSE.txt) | `hvg_batch` and `hvg_intersect` rules | port |
| https://github.com/satijalab/seurat | Satija lab and Seurat authors (LICENSE copyright holder) | MIT (DESCRIPTION; LICENSE.md) | SCTransform threshold and default values | callout |
| https://github.com/ChristophH/sctransform | Christoph Hafemeister (author) and the Satija lab | GPL-3 (LICENSE file, GPL-3.0 text; DESCRIPTION) | sctransform selection | reimplement |
| https://github.com/MarioniLab/scran | Aaron Lun and co-authors (DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file) | variance-above-trend landscape | callout |
| https://github.com/kstreet13/scry | Kelly Street (DESCRIPTION) | Artistic-2.0 (DESCRIPTION; no LICENSE file) | binomial deviance landscape | callout |
| https://github.com/tallulandrews/M3Drop | Tallulah Andrews (DESCRIPTION) | GPL (>= 2) (DESCRIPTION; no LICENSE file) | origin of zero enrichment | callout |
| https://github.com/Oshlack/splatter | Zappia, Phipson and Oshlack (paper authors) | GPL-3 (DESCRIPTION; LICENSE file contains the GPL-3.0 text) | simulator for B2 | callout |
| https://github.com/theislab/atlas-feature-selection-benchmark | Theis Lab (LICENSE copyright 2022); study authors in the README citation | MIT (LICENSE file) | B1 datasets, metrics and scaling | callout |
| https://github.com/openproblems-bio/task_batch_integration | Open Problems in Single-Cell Analysis | MIT (LICENSE file) | fixed 2000 default in process_dataset | callout |
