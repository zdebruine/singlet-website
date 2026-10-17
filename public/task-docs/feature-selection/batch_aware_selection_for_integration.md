---
id: feature-selection.batch_aware_selection_for_integration
title: Batch-aware and lineage-aware feature selection for integration
area: feature-selection
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [harmonization.count_matrix_state_detection, qc.low_quality_cell_detection, integration.batch_effect_diagnosis]
feeds: [integration.batch_corrected_embedding, integration.integration_quality_scoring, reference-mapping.query_embedding_projection, dim-reduction.normalized_cell_embedding]
reads: [layers/counts, layers/log1p_norm, obs/<batch_key>, obs/<lineage_key>]
writes: [var/hvg_batch_selected, var/hvg_batch_nbatches, var/hvg_batch_rank, var/hvg_batch_score, uns/hvg_batch/params]
devices: [cpu, cuda]
mcp_tool: singlet_feature_selection_batch_aware_selection_for_integration
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Batch-aware and lineage-aware feature selection for integration

> Choose one gene set for all batches by scoring each gene inside every batch and combining the per-batch evidence, with a count-model default and the published selectors kept as comparators.

## 1. Question

Given a multi-batch count matrix with batch labels, optionally coarse lineage labels, and a target size $K$, which $K$ genes should every batch share before integration? A correct answer keeps genes whose structure is shared within batches, discounts genes whose variation is only between batches, and keeps markers of populations present in one batch. The answer is judged by the integration it produces: batch removal, biological conservation and query mapping.

## 2. Why this task matters and where the field stands

The shared gene set is the input to PCA, the neighbour graph and every integration method that starts from them. Pooled selection ranks genes by total variance over all cells, so a gene whose mean differs between batches ranks high without any within-batch structure. PCA can then align cells along the batch axis, which integration must undo. For reference-to-query mapping the reference's set is fixed, so it also limits what a query can express.

The status is **contested**. The Zappia et al. benchmark compares more than 20 feature-selection variants on integration and query mapping; its abstract reports that HVG selection works for high-quality integrations and gives guidance on feature number and on batch-aware and lineage-specific selection [R1]. The scIB study reports that HVG selection improved integration [R2]. Neither identifies one rule for all datasets, and frameworks for evaluating whole preprocessing pipelines exist [R5]. The open problems are:

- **Consensus rule.** Strict intersection removes batch-only genes but drops markers of populations present in one batch. Rare-marker recall is not among the published metrics in section 8.
- **Batch definition.** Sample, donor, study and technology give different sets, and the choice fixes how much structure is removed.
- **Lineage labels.** Lineage-restricted selection needs labels before selection; labels derived from the integration under evaluation make the comparison circular.
- **Feature number.** [R1] gives guidance on $K$; its numerical rule is not reproduced here.
- **Query mapping.** Populations absent from the reference may depend on genes that the reference selection dropped.

## 3. Theory and insight

Pooled variance splits exactly into a within-batch part and a between-batch part. For gene $g$, with $\pi_b=n_b/N$ the fraction of the $N$ cells in batch $b$, batch mean $\mu_{gb}$, batch variance $\sigma_{gb}^2$, and pooled mean $\bar\mu_g=\sum_b\pi_b\mu_{gb}$,

$$\mathrm{Var}_{\mathrm{pool}}(x_g)=\underbrace{\sum_b \pi_b\,\sigma_{gb}^2}_{W_g}+\underbrace{\sum_b \pi_b\,(\mu_{gb}-\bar\mu_g)^2}_{B_g}.$$

This identity is exact for the pooled sample when $\sigma_{gb}^2$ are population variances (divisor $n_b$). A pooled variance ranking therefore mixes $W_g$ with the batch shift $B_g$, while a batch-aware statistic removes $B_g$ by computing within each batch. Reading the result as batch removal assumes that batch means and variances carry the batch effect and that batch is the grouping of interest.

| Symbol | Meaning |
|---|---|
| $x_{gc}$, $n_c$ | count of gene $g$ in cell $c$; total count of cell $c$ |
| $N$, $B$, $\pi_b$ | cells; batches; cell fraction of batch $b$ |
| $p_{gb}$ | batch rate, $\sum_{c\in b}x_{gc}/\sum_{c\in b}n_c$ |
| $r_{gb}$, $N_g$, $R_g$ | rank of $g$ in batch $b$ (1 is most variable); number of batches with $r_{gb}\le K$; median rank over those batches |
| $K$, $G$ | genes kept (`n_features`); genes in the matrix |

Five statistics carry the batch-aware logic.

**Seurat v3 variance.** Within each batch, a loess fit of log variance on log mean gives an expected variance, and $\hat\sigma_g$ is its square root. Counts are standardised and clipped at $\sqrt N$, and the variance of the clipped values is the score [R3]:

$$z_{gc}=\frac{x_{gc}-\mu_g}{\hat\sigma_g},\qquad \nu_g=\mathrm{Var}_c\bigl(\min(z_{gc},\sqrt N)\bigr).$$

Regime: raw counts within one batch. The trend and the per-gene values use the same cells, so they are not independent.

**Rank consensus.** Within each batch the genes are ordered by $\nu_{gb}$, giving $n_{gb}=\mathbf 1[r_{gb}\le K]$, $N_g=\sum_b n_{gb}$ and $R_g=\operatorname{median}\{r_{gb}:n_{gb}=1\}$. The ordering $(R_g\uparrow, N_g\downarrow)$ is the scanpy seurat_v3 flavour and $(N_g\downarrow, R_g\uparrow)$ the seurat_v3_paper flavour (scanpy source, section 12). Seurat's SelectIntegrationFeatures orders by $N_g$ then median rank and requires each gene to be present in every object [R3]. A count rule ranks a marker present in one batch below genes shared by several batches.

**Deviance against batch-specific nulls.** With cell totals $n_c$ as binomial sizes and a batch-specific rate $\hat p_{gb}$,

$$D_g=\sum_b\sum_{c\in b}2\Bigl[x_{gc}\log\frac{x_{gc}}{\hat\mu_{gc}}+(n_c-x_{gc})\log\frac{n_c-x_{gc}}{n_c-\hat\mu_{gc}}\Bigr],\qquad \hat\mu_{gc}=n_c\,\hat p_{gb(c)}.$$

Deviance is additive over disjoint cell sets, so the batch sum is the deviance against the batch-specific null [R4]. A gene whose batch means differ but which is constant within each batch has $D_g\approx 0$ to first order, so the statistic discounts $B_g$ by construction. The chi-squared reference needs counts large enough for the deviance approximation; ranking needs only the order. A Poisson null replaces the binomial.

**Block variance and Fisher combination.** Per-block p-values $p_{gb}$ for the biological component combine by Fisher's method, as in scran's `combineVar`, to $X_g=-2\sum_b\log p_{gb}$, which is $\chi^2_{2B}$ under the null [R12]. This is valid when block tests are independent under the null; dependence between blocks makes the combined p-values anti-conservative.

**Model-based zero enrichment.** Per batch, the zero fraction of each gene is compared with its Poisson expectation, and the posterior probability of zero enrichment is estimated by Binomial sampling. Genes are ordered by how many batches rank them highly and by median rank; the statistic follows M3Drop [R9]. Regime: raw counts; the estimate depends on the number of samples and on the size factors in the Poisson expectation.

**Insight.** Every consensus rule decides which single-batch genes survive. Count rules penalise a gene structured in one batch only. Sum rules, such as summed deviance, keep a gene strongly structured in one batch even when it is flat in the others. Both discount $B_g$, so the trade-off is between keeping single-batch markers and requiring replication across batches. Feature count changes which genes sit at the cut-off. Batch removal and biological conservation are therefore set jointly by the batch definition and the consensus rule, not by the statistic alone.

**Assumptions and failure modes.** The batch is known for every cell and is the nuisance factor; most cell types share structure across batches; count statistics need raw UMIs, dispersion statistics need log-normalised input, and batches share a gene universe after per-batch filtering. Intersection rules drop single-batch markers. Trend and dispersion fits absorb biology when most genes are not technical-only, become unstable in small batches, and change rank with the pseudocount and normalisation.

**Estimands.** The selection indicator $s_g\in\{0,1\}$ marks the $K$ highest genes in the final order, so the selected fraction is $K/G$. $N_g$ is an integer from 0 to $B$. $R_g$ is a median rank in genes, with rank 1 the most variable. Batch PCR is the relative drop in the share of variance of the top 50 principal components explained by batch, clipped at zero, and lies in $[0,1]$. The batch-only selection rate is the fraction of planted batch-only genes that are selected, and rare-marker recall the fraction of planted rare markers selected; both denominators are the planted counts (B2). Label F1 is computed on query cells against their held-out labels (B1).

## 4. Methods landscape

The published standard for batch-aware selection is the heuristic consensus of per-batch variable genes in scanpy, Seurat and scib, and it is the comparator in every benchmark here. The model-based statistics are the batch-specific deviance in scry, the zero-enrichment selector in scvi-tools and the block variance model in OSCA; each accepts a batch key and combines per-batch results. Pooled selection, which ignores the batch key, is the baseline for every comparison.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Seurat SelectIntegrationFeatures | heuristic | Counts datasets listing a gene among their top variable features; orders by count, then median rank | [R3] |
| Seurat v3 `vst` per dataset | hybrid | Loess trend of log variance on log mean; variance of clipped standardised counts | [R3] |
| scanpy `highly_variable_genes` with `batch_key` | hybrid | Per-batch flavour; batches counted per gene; ties broken by normalised dispersion (seurat [R7], cell_ranger [R8]) or by median rank (seurat_v3 [R3]) | [R3, R6, R7, R8] |
| scib `hvg_batch` | heuristic | Genes variable in all batches, filled from genes variable in fewer batches | [R2] |
| scvi-tools `poisson_gene_selection` | model-based | Posterior probability of zero enrichment against a Poisson expectation, per batch | [R9] |
| scry deviance with `batch` | model-based | Binomial or Poisson deviance against per-batch constant-rate nulls, summed over batches | [R4] |
| scran `modelGeneVar` with `block` (OSCA) | model-based | Mean-variance trend within each block; biological parts combined by Fisher's method | [R12] |
| scanpy Pearson residuals with `batch_key` | model-based | Analytic Pearson residual variance per batch; genes counted within the top $n$ | [R10] |
| Lineage-restricted selection | heuristic | Any selector applied inside coarse lineage subsets, compared with full-atlas selection | [R1] |

Exact defaults, taken from source code at the stated commits:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Seurat SelectIntegrationFeatures | `nfeatures` | 2000 | R/integration.R:3086 @ 5f67c70 |
| Seurat SelectIntegrationFeatures | `fvf.nfeatures` | 2000 | R/integration.R:3089 @ 5f67c70 |
| Seurat `vst` | `nfeatures` | 2000 | R/preprocessing.R:4645 @ 5f67c70 |
| Seurat `vst` | `clip.max` | auto, $\sqrt{\text{cells}}$ | R/preprocessing5.R:543 @ 5f67c70 |
| scanpy ScanpyV1 preset | `flavor` | seurat | src/scanpy/_settings/presets.py:194 @ 8ed52d9 |
| scanpy ScanpyV2Preview preset | `flavor` | seurat_v3_paper | src/scanpy/_settings/presets.py:195 @ 8ed52d9 |
| scanpy dispersion flavours | `min_disp`, `min_mean`, `max_mean`, `n_bins` | 0.5, 0.0125, 3, 20 | src/scanpy/preprocessing/_highly_variable_genes.py:637-642 @ 8ed52d9 |
| scanpy batched mode | `filter_unexpressed_genes` | True, per batch | src/scanpy/preprocessing/_highly_variable_genes.py:588 @ 8ed52d9 |
| scib `hvg_batch` | `target_genes`, `flavor`, `n_bins` | 2000, cell_ranger, 20 | scib/preprocessing.py:463-470 @ cd67913 |
| scvi `poisson_gene_selection` | `n_top_genes` | 4000 | src/scvi/data/_preprocessing.py:35-41 @ 5555ecc |
| scvi `poisson_gene_selection` | `n_samples`, `minibatch_size` | 10000, 5000 | src/scvi/data/_preprocessing.py:43-46 @ 5555ecc |
| scry `devianceFeatureSelection` | `fam`, `batch` | binomial (first of binomial, poisson), NULL | R/featureSelection.R:170-172 @ 1375237 |
| scran `modelGeneVar` | `method`, `equiweight` | fisher, TRUE | R/modelGeneVar.R:149 @ 569d2f8 |
| scanpy Pearson residuals | `n_top_genes`, `batch_key` | 1000, None | src/scanpy/experimental/pp/_highly_variable_genes.py:134-135 @ 8ed52d9 |

## 5. Proposed singlet approach

**Routes.** Repository routes are listed in section 12. The scanpy batch-key flavours and Pearson selector, scib `hvg_batch`, the scvi zero-enrichment selector and the Seurat v3 variance and SelectIntegrationFeatures rule are ported. The scry deviance and the scran block model are reimplemented. SCTransform [R11] and the label-based Wilcoxon selector are callouts used only as comparators; the Wilcoxon selector is supervised.

**Default.** `scry_deviance_binomial` with `per_batch_consensus` and `consensus_rule=auto`, which sums the batch deviances. It is model-based, needs raw counts and no pseudocount, and its batch sum discounts $B_g$ (section 3). The heuristic consensus stays as the comparator in every benchmark.

**Per-lineage scope.** `per_lineage` applies `per_batch_consensus` inside each of the $L$ lineages, keeps the top $\lceil K/L\rceil$ genes of each lineage, and fills the rest by overall rank. This union rule is singlet's own proposal (see section 10).

**Proposed extension, not yet in the method list.** The plug-in batch rates of $D_g$ are replaced by a hierarchical negative-binomial model with a shared gene-level prior,

$$y_{gc}\sim\mathrm{NB}\bigl(n_c\,e^{\alpha_g+\beta_{gb(c)}},\ \phi_g\bigr),\qquad \beta_{gb}\sim\mathcal N(0,\tau_g^2),$$

and each gene scores by the posterior probability that its within-batch excess deviance over the null exceeds a fixed threshold. Posterior intervals on ranks give calibrated uncertainty for the selected set. The formulation is falsified if, on B2 over at least five seeds, it does not lower batch-only selection relative to the scry default at equal rare-marker recall, or if it does not match the B1 batch-PCR gain at equal conservation.

**ML stack.** PyTorch for the hierarchical fit (minibatch MAP with automatic differentiation), since the model is small. The per-batch sparse reductions (count sums, log-factorials and zero counts) are small and hot, so they are hard-coded CUDA or cuSPARSE kernels with no framework dependency. The consensus is a per-gene sort.

**Cost, devices and streaming.** Per-batch sparse sums cost $O(\mathrm{nnz})$ on CPU and GPU. Batches stream one at a time, so memory is $O(G)$ for accumulators plus one batch slice. The zero-enrichment sampler costs $O(G\,n_{\mathrm{samples}})$ per batch and executes on the device in minibatches of 5000 cells.

**Agent defaults.** `method=scry_deviance_binomial`, `selection_scope=per_batch_consensus`, `consensus_rule=auto`, `n_features=2000`, `batch_key=batch`, `device=auto`, `seed=0`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts for count methods |
| read | layers/log1p_norm | sparse float | log-normalised values for dispersion methods |
| read | obs/`batch_key` | categorical | batch label per cell |
| read | obs/`lineage_key` | categorical | coarse lineage label, used for `per_lineage` only |
| write | var/hvg_batch_selected | bool | gene is in the shared set of $K$ genes |
| write | var/hvg_batch_nbatches | int32 | number of batches in which the gene ranks within the top $K$ |
| write | var/hvg_batch_rank | float32 | consensus rank; 1 is the most selected |
| write | var/hvg_batch_score | float32 | method score: summed deviance, Fisher statistic or median per-batch rank |
| write | uns/hvg_batch/params | dict | method, consensus rule, $K$, keys and seed, for provenance |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "scry_deviance_binomial" | `scry_deviance_binomial`, `scry_deviance_poisson`, `scvi_poisson_zeros`, `scanpy_seurat_v3`, `scanpy_seurat`, `scanpy_cell_ranger`, `scanpy_pearson_residuals`, `scib_hvg_batch`, `seurat_vst`, `osca_block_variance` | Per-batch statistic. The default is the model-based deviance; other values are published implementations kept as comparators. |
| `batch_key` | string | "batch" | — | obs column defining batches; must have at least two levels. |
| `selection_scope` | string | "per_batch_consensus" | `pooled`, `per_batch_consensus`, `per_lineage` | pooled ranks all cells together as a baseline; per_batch_consensus combines batches; per_lineage repeats that within each lineage. |
| `consensus_rule` | string | "auto" | `auto`, `nbatches_then_median_rank`, `median_rank_then_nbatches`, `nbatches_then_score`, `sum_of_batch_scores`, `intersect_fill`, `fisher_combine` | How batch results combine; auto applies the rule published for the chosen method. |
| `n_features` | integer | 2000 | min 1 | Number of genes in the shared set after consensus. |
| `lineage_key` | string/null | null | — | obs column of coarse lineage labels; required when selection_scope is per_lineage. |
| `scvi` | object | — | — | Options for scvi_poisson_zeros only: Binomial samples per gene and cells per minibatch. |
| `scvi.n_samples` | integer | 10000 | min 1 | Binomial samples per gene for the zero-enrichment posterior. |
| `scvi.minibatch_size` | integer | 5000 | min 1 | Cells per minibatch for the zero-enrichment statistics. |
| `seed` | integer | 0 | — | Random seed for sampling in scvi_poisson_zeros; other methods are deterministic. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`n_features` applies to every method and must not exceed the number of genes present in every batch. `pooled` ignores the batch key and gives the baseline; `scib_hvg_batch` and `osca_block_variance` reject it. `consensus_rule=auto` maps each method to the rule its source code uses: summed batch scores for the scry methods, intersect-and-fill for scib, Fisher combination for OSCA, median-rank-then-count for the scanpy seurat_v3 flavour, count-then-median-rank for seurat_vst, scvi and the scanpy Pearson selector, and count-then-score for the scanpy dispersion flavours. `lineage_key` is required only for `per_lineage`, and each lineage needs at least two batches. The `scvi` object applies only to `scvi_poisson_zeros`. Count methods require raw counts and fail on log-normalised input.

## 7. MCP tool

Tool `singlet_feature_selection_batch_aware_selection_for_integration`; definition in `tasks/mcp/singlet_feature_selection_batch_aware_selection_for_integration.json`.

```json
{"dataset": "atlas.singlet", "method": "scry_deviance_binomial", "batch_key": "study", "n_features": 2000}
```

```json
{"dataset": "atlas.singlet", "status": "completed", "wrote": ["var/hvg_batch_selected", "var/hvg_batch_nbatches", "var/hvg_batch_rank", "var/hvg_batch_score", "uns/hvg_batch/params"], "summary": {"method": "scry_deviance_binomial", "consensus_rule": "sum_of_batch_scores", "n_genes_selected": 2000, "n_batches": 12, "top_genes": ["GENE_A", "GENE_B"]}, "provenance_id": "prov_example", "job_id": null, "estimate": null}
```

- **Long-running**: no; a job is queued only when the dry-run estimate exceeds the inline limit.
- **Stochastic**: only `scvi_poisson_zeros` samples, and `seed` controls it.
- **Dry run**: returns seconds, peak memory and device from the cell, batch and gene counts, without reading values.

## 8. Benchmarks

Unless stated otherwise, every accuracy benchmark uses $K=2000$ genes, the same integration method, seed and preprocessing for every selector, and the batch column named in each dataset's configuration. Count-based selectors receive raw counts and dispersion selectors receive log-normalised values. Pooled selection (the same method without a batch key) is the reference for every comparison, and each acceptance criterion is a paired difference against it. Scores are on the 0 to 1 scale where the source documents it.

### B1. Atlas feature-selection benchmark of Zappia et al. (published)

- **Goal**: measure how batch-aware and lineage-restricted selection affects integration, query mapping and unseen-type detection.
- **Ground truth**: expert cell-type and batch labels; held-out types are the unseen truth (section 3).
- **Datasets**

| Dataset | Source | Batch column | License | Notes |
|---|---|---|---|---|
| HLCA | cellxgene Census [R1] | `dataset` | — | — |
| neurips | GEO GSE194122 [R1] | `batch` | — | CITE-seq RNA side |
| scIBPancreas | figshare [R1] | `tech` | — | — |
| fetalLiver | cellatlas.io [R1] | `fetal.ids` | — | — |
| reedBreast | cellxgene Census [R1] | `donor_id` | — | — |
| scEiaD | NIH-hosted Seurat object [R1] | `batch` | — | — |
| humanEndoderm | repository download [R1] | `Individual` | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Batch PCR (scaled) | $\max\bigl(0,(\mathrm{PCR}_{\mathrm{pre}}-\mathrm{PCR}_{\mathrm{post}})/\mathrm{PCR}_{\mathrm{pre}}\bigr)$ on 50 components | maximise | primary | [R2] |
| iLISI, graph connectivity | integration LISI (0 to 1); same-label connectivity | maximise | primary | [R2] |
| CMS | CellMixS `cms`, $k=200$, batch as group | — | primary | — |
| cLISI, bNMI, isolated-label F1, ASW | biological conservation | maximise | primary | [R2] |
| Label F1 (macro, micro, rarity) | query cells against held-out labels | maximise | primary | — |
| Unseen distances | distances to cell types absent from the reference | — | guardrail | — |

- **Comparators**: all features; random subsets; scanpy `seurat`, `cell_ranger`, `seurat_v3` and Pearson residuals, with and without batch key; OSCA with its `vst` method; scry deviance; supervised label-based Wilcoxon (comparator only).
- **Protocol**: reference and query split by batch; scVI, scANVI and Symphony at seed 1; lineage variants use the HLCA Immune and Epithelial subsets.
- **Acceptance criterion**: no numeric threshold in the source; its qualitative claim that HVG selection works for high-quality integrations is the reference [R1]. Proposed, not from the literature: median Batch PCR gain over pooled selection of at least 0.02, with mean conservation down by at most 0.01 absolute.
- **Known pitfalls**: batch PCR on selected genes rewards HVG-like subsets by construction, so include an all-features reference; label-based comparators use the labels the conservation metrics score.

### B2. Planted batch-only and rare-marker selection (proposed)

- **Goal**: test whether a selector drops batch-only genes and keeps markers of a rare type present in one batch.
- **Ground truth**: planted simulation; each gene's class is set by the generator (estimands in section 3).
- **Generator recipe**; every value is a proposed design setting:
  1. Draw $G=10{,}000$ genes with base means and dispersions $\phi_g$ from gamma distributions.
  2. Define $T$ cell types and one rare type with frequency $f\in\{0.5\%,2\%,5\%\}$.
  3. Split cells into $B\in\{2,10,50\}$ batches; put all rare-type cells in batch $b^{*}$.
  4. Give each non-rare type $m$ markers with fold change $\lambda$, shared across batches.
  5. Plant $P$ batch-only genes with factors $e^{\eta_{gb}}$, $\eta_{gb}\sim\mathcal N(0,\sigma^2)$; vary $\sigma$.
  6. Plant $R$ rare markers expressed only in the rare type and batch $b^{*}$.
  7. Draw $x_{gc}\sim\mathrm{NB}(\ell_c\,\mu_{g,k(c)}\,e^{\eta_{g,b(c)}},\phi_g)$, with log-normal $\ell_c$.
  8. Store the planted sets and labels as truth.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated counts | recipe above | single-modality counts; size set by $G$, $B$, cell count | — | no literature sizes |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Batch-only selection rate | fraction of the $P$ batch-only genes in the selected set of $K$ | minimise | primary | — |
| Rare-marker recall | fraction of the $R$ rare markers in the selected set | maximise | primary | — |
| Batch PCR | as in B1, on the output of one integration | maximise | guardrail | [R2] |

- **Comparators**: pooled `scanpy_seurat_v3` (no batch key), `scanpy_seurat_v3` with batch key, `scib_hvg_batch`, `scvi_poisson_zeros`, `scry_deviance_binomial`, `osca_block_variance`.
- **Protocol**: $K=2000$ for each method; at least five simulation seeds; one scVI integration at a fixed seed for the guardrail.
- **Acceptance criterion (proposed)**: batch-only selection rate at most 50% of pooled selection's, and rare-marker recall at least 90% of pooled selection's, each averaged over at least five seeds.
- **Known pitfalls**: batch-only genes can be unrealistically separable, so vary $\sigma$ over a realistic range; rare-marker recall depends on $f$, so report it for each value.

### P1. Performance and scaling

Measure wall time, peak memory and cells per second at $10^4$, $10^5$ and $10^6$ cells, and at $10^7$ cells if streaming is tested, with $B\in\{2,10,50\}$ batches and $G=30{,}000$ genes. These scales are proposed; no published timings are used. Compare CPU and CUDA builds of the proposed implementation with scanpy `seurat_v3` and `seurat` with a batch key, scib `hvg_batch` (a Python loop over batches), scvi `poisson_zeros` (CPU, GPU, minibatch 5000), scry deviance in R, Seurat per-batch `vst` with SelectIntegrationFeatures, and scran `modelGeneVar` with a block. Hold normalisation, filtering and $K=2000$ fixed. Record the nonzero count per batch, because sparse sums dominate the deviance and zero-enrichment cost, and the zero-enrichment sampler also scales with $G\times B\times n_{\mathrm{samples}}$.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.count_matrix_state_detection`: Count-matrix processing-state detection
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `integration.batch_effect_diagnosis`: Batch-effect detection and quantification
- **Feeds**:
  - `integration.batch_corrected_embedding`: Batch-corrected joint embedding
  - `integration.integration_quality_scoring`: Integration quality scoring
  - `reference-mapping.query_embedding_projection`: Query embedding into a frozen reference
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
- **Reads**: `layers/counts`, `layers/log1p_norm`, `obs/<batch_key>`, `obs/<lineage_key>`
- **Writes**: `var/hvg_batch_selected`, `var/hvg_batch_nbatches`, `var/hvg_batch_rank`, `var/hvg_batch_score`, `uns/hvg_batch/params`
<!-- CHAINING:AUTO:END -->

The shared set precedes PCA and neighbour-graph construction in integration workflows. In reference mapping the reference's selected set is fixed for query projection.

## 10. Risks, pitfalls and open questions

- **Zappia et al. 2025 evidence.** This document uses the abstract-level findings, the repository code and its metadata. The repository gives pages 1–11 and no volume, so the reference gives neither. The repository's BibTeX and its citation sentence list different authors, so the reference gives the first author. Full-text numeric results, the lineage merge rule and whether query-mapping selection uses reference cells only are not available here. The ranking direction of CMS in the pipeline and whether batch PCR input is restricted to the selected genes are unknown from the repository code.
- **scIB and OpenProblems.** The scIB repository states 16 methods, 68 method and preprocessing combinations and 85 batches; its atlas-task count and cell total are not stated there and are omitted. Its aggregate score weighting is unknown. The HVG-improvement statement in section 2 and the claim that scaling pushes methods toward batch removal come from abstract-level paraphrases. Neither the scIB collection nor the OpenProblems batch-integration datasets (section 12) is enumerated here, so both serve as evidence, not as benchmarks.
- **Derivation checks.** The Stuart et al. variance equations were taken from Seurat and scanpy code and documentation, not from the paper's Methods text, and the page numbers are unknown. The Seurat assay branch at R/integration.R:3096 is not exercised here. The scran `modelGeneVar` function is marked deprecated in favour of scrapper at the pinned commit; the reimplementation follows its documented block behaviour. Licence statements for scran and scry rest on package metadata (section 12). The full author lists of scanpy and scvi-tools are not given.
- **Dataset terms.** The licence of each B1 dataset is unknown from the sources, so the licence column shows dashes. Gene and cell counts for B1 are not stated in the repository and are omitted here. The accession strings come from the repository configuration rather than from the data providers, and the cellxgene Census datasets have no accession string there.
- **Thresholds and scales.** The B2 thresholds, the P1 scales and the gains expected from the proposed model are proposals with no literature support. The sources report no runtimes for any comparator, and no published threshold exists for a batch-aware gain. Stability of the selected set across batches is not characterised here.
- **Method questions and first experiment.** The lineage union rule (section 5) is singlet's own; the published rule is known only from the abstract. The trade-off between batch removal and rare-type recall is unmeasured for each consensus rule and batch definition. First experiment: compute B2 at five seeds for pooled selection, `scanpy_seurat_v3` with a batch key, the scry binomial default and the consensus variants, then B1 on the smallest dataset, before any port.

## 11. References

R1. Zappia L, et al. Feature selection methods affect the performance of scRNA-seq data integration and querying. *Nature Methods* 2025. doi:10.1038/s41592-025-02624-3 — partial (repo)

R2. Luecken MD, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 19(1):41–50, 2022 (online 2021). doi:10.1038/s41592-021-01336-8 — verified (corpus)

R3. Stuart T, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)

R4. Townes FW, Hicks SC, Aryee MJ, Irizarry RA. Feature selection and dimension reduction for single-cell RNA-seq based on a multinomial model. *Genome Biology* 2019. doi:10.1186/s13059-019-1861-6 — verified (corpus)

R5. Germain PL, Sonrel A, Robinson MD. pipeComp, a general framework for the evaluation of computational pipelines, reveals performant single cell RNA-seq preprocessing tools. *Genome Biology* 2020. doi:10.1186/s13059-020-02136-7 — verified (corpus)

R6. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)

R7. Satija R, Farrell JA, Gennert D, Schier AF, Regev A. Spatial reconstruction of single-cell gene expression data. *Nature Biotechnology* 2015. doi:10.1038/nbt.3192 — verified (corpus)

R8. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — verified (corpus)

R9. Andrews TS, Hemberg M. M3Drop: dropout-based feature selection for scRNASeq. *Bioinformatics* 2019. doi:10.1093/bioinformatics/bty1044 — verified (corpus)

R10. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — verified (corpus)

R11. Hafemeister C, Satija R. Normalization and variance stabilization of single-cell RNA-seq data using regularized negative binomial regression. *Genome Biology* 2019. doi:10.1186/s13059-019-1874-1 — verified (corpus)

R12. Amezquita RA, Lun ATL, Becht E, et al. Orchestrating single-cell analysis with Bioconductor. *Nature Methods* 2020. doi:10.1038/s41592-019-0654-x — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and further authors in DESCRIPTION | MIT | SelectIntegrationFeatures; vst | port |
| https://github.com/scverse/scanpy | Ilan Gold, Philipp Angerer, Severin Dicks (maintainers) | BSD 3-Clause | batch-key flavours; Pearson residuals | port |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller | MIT | hvg_batch; metric conventions | port |
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml) | BSD 3-Clause | poisson_gene_selection | port |
| https://github.com/kstreet13/scry | Kelly Street (aut, cre); F. William Townes (aut, cph); Davide Risso (aut) | Artistic-2.0 | deviance with batch | reimplement |
| https://github.com/MarioniLab/scran | Aaron Lun (aut, cre) and other authors | GPL-3 (DESCRIPTION) | modelGeneVar with block | reimplement |
| https://github.com/theislab/atlas-feature-selection-benchmark | Zappia, Richter, Ramírez-Suástegui, Kfuri-Rubens, Vornholz, Wang, Dietrich, Frishberg, Luecken, Theis | MIT | B1 protocol and comparators | callout |
| https://github.com/openproblems-bio/task_batch_integration | Open Problems in Single-Cell Analysis (copyright holder) | MIT | batch-HVG and PCR conventions | callout |
| https://github.com/ChristophH/sctransform | Christoph Hafemeister (aut); Saket Choudhary (aut, cre); Rahul Satija (ctb) | GPL-3 | SCTransform comparator | callout |
