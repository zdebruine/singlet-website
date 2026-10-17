---
id: programs.coexpression_module_detection
title: Gene-gene co-expression module detection
area: programs
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [annotation.cluster_label_assignment, normalization.count_noise_model_selection, feature-selection.highly_variable_gene_selection]
feeds: [programs.cross_dataset_program_reproducibility, programs.identity_activity_program_labeling, programs.program_annotation, grn.regulon_motif_pruning]
reads: [layers/counts, layers/log1p_norm, obs/<subset.key>, obs/<input.split_key>, obsp/neighbors]
writes: [varm/coexpr_module, varm/coexpr_kME, obsm/coexpr_eigengene, uns/coexpr/modules, uns/coexpr/preservation, models/coexpr, obsp/coexpr]
devices: [cpu, cuda]
mcp_tool: singlet_programs_coexpression_module_detection
evidence_basis: corpus+repo+memory
last_reviewed: 2026-10-17
---

# Gene-gene co-expression module detection

> Groups genes whose expression covaries across cells and summarises each group by an eigengene score. The default is a depth-adjusted pair model with per-pair tests; WGCNA-style pipelines are kept as heuristic comparators.

## 1. Question

Which sets of genes co-vary across the cells, metacells or samples of one cell type more than depth, dropout and technical structure explain, and what single profile summarises each set? The input is a genes-by-cells count matrix (raw counts for the default route, log-normalised values for the comparators), optionally aggregated to metacells or pseudobulk. The output is a gene-to-module assignment, a module eigengene per analysed unit and a membership score per gene. A correct answer recovers planted or reproducible modules and states how much evidence supports each one.

## 2. Why this task matters and where the field stands

Gene modules are the usual bridge from a gene-by-cell matrix to interpretable programs. The published standard is WGCNA, which builds a soft-thresholded correlation network, adds topological overlap [R2] and cuts a hierarchical tree dynamically [R3] to define modules [R1]. Its single-cell form, hdWGCNA, forms metacells first and then applies WGCNA to their profiles [R5]; the metacell idea comes from MetaCell [R6]. Graph alternatives cluster a gene graph with Leiden [R7] or Louvain [R8]. Regression-based routes take modules from TF-target importances [R9, R10, R11, R12] and leave pruning by motif evidence to the GRN tasks. Model-based pair estimators give per-pair statistics before any clustering [R13].

Status: **contested**. Methods disagree on transform, gene filter and cut height, and no output is accepted as the truth. The open problems are:

- Heuristic pipelines return a partition whether or not structure exists; preservation statistics [R4] measure reproducibility, not whether a module exceeds noise.
- Defaults differ between WGCNA and hdWGCNA (section 4), so module counts are not comparable until the cut settings are matched.
- Co-expression edges are undirected, so modules cannot be read as regulation. The BEELINE benchmark [R15] scores directed inference and is the nearest protocol for the regulatory reading.
- The published comparison of module-detection methods [R14] reports 42 methods and practical guidelines; only its abstract is used here (section 10).

## 3. Theory and insight

Every method starts from a gene-gene similarity, turns it into a weighted graph, partitions the graph and summarises each module. Heuristics place the statistical content in the similarity and the cut; the model-based route places it in a pair test.

**Similarity and network.** WGCNA's soft-threshold adjacency from the Pearson correlation $\rho_{ij}$ is $a_{ij}=|\rho_{ij}|^{\beta}$ (unsigned) or $a_{ij}=\big((1+\rho_{ij})/2\big)^{\beta}$ (signed), with $\beta$ the smallest power whose scale-free fit reaches $R^2\ge 0.85$ [R1]. Topological overlap [R2] gives $\omega_{ij}=(l_{ij}+a_{ij})/(\min(k_i,k_j)+1-a_{ij})$, with $l_{ij}=\sum_{u\ne i,j}a_{iu}a_{uj}$ and $k_i=\sum_{u\ne i}a_{iu}$, so two genes are similar when they share neighbours. The regime needs stable correlations; $\beta$ is unreliable on sparse counts.

**Summaries.** Module $m$ has eigengene $E_m=\mathrm{PC}_1(\tilde X_m)$ on its standardised expression and membership $\mathrm{kME}_{i,m}=\mathrm{cor}(x_i,E_m)$ [R1]. The eigengene is a faithful summary only when the module is close to one factor.

**Graph partitions.** Leiden maximises $Q(\sigma)=\frac{1}{2m}\sum_{i,j}\big(A_{ij}-\gamma\frac{k_ik_j}{2m}\big)\delta(\sigma_i,\sigma_j)$ and guarantees connected communities at convergence [R7]. Modularity has a resolution limit, and $\gamma$ is not calibrated to gene graphs.

**Regression importances.** A tree or boosted model of each target gene on candidate regulators gives importances $w_{t\to g}$, the variance reduction attributed to predictor $t$ [R11, R12]. Importances favour high-variance and high-cardinality predictors; GRNBoost2 stops early with a window of 25 rounds.

**Model-based pairs.** With library size $s_i$ and gene mean $\mu_j$, CS-CORE takes covariances from moment regressions [R13]:

$$\mathbb E[x_{ij}]=s_i\mu_j,\qquad \mathbb E\big[(x_{ij}-s_i\mu_j)(x_{ij'}-s_i\mu_{j'})\big]=s_i^{2}\,\sigma_{jj'}.$$

These are fitted by iteratively reweighted least squares, and the pair correlation is $\rho_{jj'}=\sigma_{jj'}/\sqrt{\sigma_{jj}\sigma_{j'j'}}$. A per-pair test of $\sigma_{jj'}=0$ yields p-values before clustering. Only first and second moments are modelled, within one cell type, and the test is approximate for small cell counts or very sparse genes.

**Depth-adjusted dropout.** Under a negative binomial marginal with gene total $t_s$, cell library size $t_i$, grand total $T$ and size $\theta_s$, the expected zero probability is $p_{is}=(1+\mu_{is}/\theta_s)^{-\theta_s}$ with $\mu_{is}=t_st_i/T$ [R20]. It is valid when the NB marginal fits and depth is the main nuisance, and it is the baseline for the NB-based alternative.

**Transforms and sparse precision.** Analytic Pearson residuals [R16] make correlation less dependent on depth; log-normalised values are the comparators' input. A sparse precision model gives partial correlations that remove indirect association [R23]. It is not a comparator here because its code was not read.

**Simulation.** A Gaussian copula, $x_{ij}=F_j^{-1}(\Phi(z_{ij}))$ with $z_i\sim\mathcal N(0,\Sigma)$, plants block structure in $\Sigma$ on fitted marginals $F_j$ [R19]. The Pearson correlation of discrete counts differs from the latent correlation, so the realised strength is measured after simulation.

| Family | Assumptions | Failure modes |
|---|---|---|
| WGCNA, hdWGCNA | Linear association on the transformed scale; one factor per module; one soft power for all genes | Technical modules from depth, mitochondrial fraction and batch, as argued for missingness and technical variability [R17]; power instability on sparse counts; hub dominance; over-merging at the merge cut; metacells built from the same genes make modules circular |
| Leiden gene graph | Similarity is valid and graph density matches the module scale | Graph construction dominates results; resolution limit; $\gamma$ not calibrated |
| Regression importances | Predictors include the true regulators; squared-error loss is adequate | Bias toward high-variance predictors; motif pruning depends on the prior |
| CS-CORE pairs | Moment model holds within one cell type; cells are exchangeable | Mixed cell states inflate covariance; pair p-values fail after modules are chosen from the same cells |

**Estimands.** Each output is defined once here.

- Module assignment $m(g)\in\{0,\dots,M\}$, with 0 unassigned. Each gene has at most one module, and the estimand is the partition of the tested genes.
- Eigengene $E_{cm}$: the first principal-component score of the z-scored module expression across analysed units, with sign fixed so the mean kME is positive. Units are standard deviations.
- kME: the correlation in $[-1,1]$ between a gene and an eigengene.
- $\hat\sigma_{jj'}$: covariance in squared depth-scaled count units; $\hat\rho_{jj'}$ is its dimensionless correlation.
- Planted truth (B1): the planted module id of each gene, 0 for null genes, fixed at generation. ARI is computed over all genes with no per-cell normalisation.
- Preservation (B2): the Zsummary.pres of a discovery module in the held-out split, a unitless composite z-score [R4].
- Regulatory truth (B3): the 0/1 label of an ordered TF-target pair in the BEELINE truth network [R15].

**Why heuristics work, and what models add.** Heuristic pipelines give a readable partition from few parameters, and they are the reference users expect, so they remain comparators. They have no null: WGCNA returns modules for any input. A pair model adds an explicit null for each pair, a p-value and effect size before clustering, and a fitted object that can be reused. The singlet catalogue (354M cells, about 40% with author annotations) can supply the missing module null by shuffling genes within mean and depth strata (section 5).

**Pitfalls shown by benchmarks.** Studies of missingness and technical variability [R17] show how depth and quality can create apparent gene-gene structure, so covariates are checked before any module is read. The module-detection comparison [R14] is the defining reference, but only its abstract is used here.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| WGCNA | heuristic | Soft-threshold adjacency, topological overlap, average-linkage tree with dynamic cut, eigengenes and kME | [R1, R2, R3] |
| hdWGCNA | heuristic | kNN metacells, then WGCNA on metacell profiles with signed networks and hub scores | [R5] |
| MetaCell | heuristic | Partition of a kNN cell graph into homogeneous metacells before correlation | [R6] |
| Leiden or Louvain gene graph | heuristic | kNN or thresholded correlation graph over genes, modularity optimised | [R7, R8] |
| GRNBoost2 and GENIE3 (arboreto) | hybrid | Per-target boosted or forest regression; importances as edges, grouped into modules | [R11, R12] |
| Hotspot | hybrid | Informative genes by cell-graph autocorrelation, then local-correlation clustering (comparator) | [R21] |
| CS-CORE | model-based | Depth-adjusted moment model for within-type covariance with per-pair tests | [R13] |

The published standards are WGCNA [R1] for module construction and hdWGCNA [R5] for single-cell use; both are kept as comparators. CS-CORE [R13] models per-pair covariance with moment regressions and is the basis of the proposed default. Leiden and arboreto are building blocks. SCENIC and pySCENIC [R9, R10] define regulons rather than co-expression modules and belong to the GRN tasks.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| WGCNA | networkType | unsigned | cran_WGCNA/R/blockwiseModulesC.R:211 @61a2a7d |
| WGCNA | TOMType | signed | cran_WGCNA/R/blockwiseModulesC.R:216 @61a2a7d |
| WGCNA | maxBlockSize | 5000 | cran_WGCNA/R/blockwiseModulesC.R:191 @61a2a7d |
| WGCNA | deepSplit, minModuleSize | 2, min(20, ncol(datExpr)/2) | cran_WGCNA/R/blockwiseModulesC.R:229, 231 @61a2a7d |
| WGCNA | pamStage, pamRespectsDendro | TRUE, TRUE | cran_WGCNA/R/blockwiseModulesC.R:244 @61a2a7d |
| WGCNA | reassignThreshold, minKMEtoStay | 1e-6, 0.3 | cran_WGCNA/R/blockwiseModulesC.R:248, 251 @61a2a7d |
| WGCNA | mergeCutHeight | 0.15 | cran_WGCNA/R/blockwiseModulesC.R:255 @61a2a7d |
| WGCNA | RsquaredCut (pickSoftThreshold) | 0.85 | cran_WGCNA/R/Functions.R:1814 @61a2a7d |
| WGCNA | powerVector | 1:10, 12, 14, ..., 20 | cran_WGCNA/R/Functions.R:1815 @61a2a7d |
| hdWGCNA | networkType, TOMType | signed, signed | smorabit_hdWGCNA/R/ConstructNetwork.R:48 @e3344d1 |
| hdWGCNA | consensusQuantile | 0.3 | smorabit_hdWGCNA/R/ConstructNetwork.R:48 @e3344d1 |
| hdWGCNA | deepSplit, pamStage, detectCutHeight, minModuleSize | 4, FALSE, 0.995, 50 | smorabit_hdWGCNA/R/ConstructNetwork.R:52 @e3344d1 |
| hdWGCNA | mergeCutHeight | 0.2 | smorabit_hdWGCNA/R/ConstructNetwork.R:53 @e3344d1 |
| hdWGCNA | powers (signed) | 1:10, 12, 14, ..., 30 | smorabit_hdWGCNA/R/SoftPowers.R:21-22 @e3344d1 |
| hdWGCNA | metacell k, max_shared, target_metacells | 25, 15, 1000 | smorabit_hdWGCNA/R/metacells.R:24, 32-33 @e3344d1 |
| hdWGCNA | gene_select, fraction | variable, 0.05 | smorabit_hdWGCNA/R/SelectNetworkGenes.R:25-26 @e3344d1 |
| MetaCell | target_metacell_size | 48 | tanaylab_metacells/metacells/parameters.py:128 @c5bd77a |
| leidenalg | resolution_parameter | 1.0 | vtraag_leidenalg/src/leidenalg/VertexPartition.py:706, 809, 893 @9890a99 |
| CS-CORE | IRLS n_iter, eps | 10, 0.05 | ChangSuBiostats_CS-CORE/R/RcppExports.R:4 @1008716 |
| CS-CORE | seq_depth | NULL (total UMI per cell) | ChangSuBiostats_CS-CORE/R/CSCORE.R roxygen @1008716 |
| arboreto | GRNBoost2 learning_rate, n_estimators, max_features, subsample | 0.01, 5000 (early-stopped), 0.1, 0.9 | tmoerman_arboreto/arboreto/core.py:49-54 @2f475dc |
| arboreto | early_stop_window_length | 25 | tmoerman_arboreto/arboreto/algo.py:32 (docstring) @2f475dc |

Singlet defaults equal these values except where section 5 states otherwise. The proposed WGCNA comparator uses Pearson correlation; the biweight alternative is an option in the WGCNA package [R24].

## 5. Proposed singlet approach

Routes follow licence class (section 12). **Port**: `model_pairs`, from the CS-CORE moment regression and pair test. **Reimplement**: the WGCNA network and tree steps, the hdWGCNA network construction and leidenalg's optimiser, from the published methods and the defaults above. **Callout**: MetaCell and Hotspot, used as comparators only. Metacell construction is a separate task (`scalability.metacell_construction`) and enters here only through `hdwgcna`.

**Proposed model.** For one cell type, estimate $\hat\mu_j$ and $\hat\sigma_{jj'}$ from raw counts with the moment model of section 3, test every pair, control the pair false discovery rate by Benjamini–Hochberg at level `fdr`, and cluster the significant-pair graph, weighted by $\hat\rho_{jj'}$, with Leiden at `resolution`. Eigengenes are first principal components of z-scored log-normalised module expression; kME is each gene's correlation with its eigengene. The proposal is falsified in two ways. If B1 shows `model_pairs` with a lower ARI than `wgcna` at matched module count, the default changes. If empirical nulls show a pair false discovery rate above the nominal `fdr`, the calibration claim is withdrawn and the output is reported as a ranking.

**Empirical null (proposed, not built).** Shuffling gene labels within mean and depth strata across catalogue datasets gives a null for pair statistics that the heuristic pipelines lack.

**Machine-learning stack.** The moment model is a small hot kernel: per-gene weighted least squares plus one dense standardised cross-product. A hard-coded CUDA path with cuBLAS for the product and cuSPARSE for count normalisation is proposed, with a dependency-free C++ CPU path. A learned sparse covariance with a negative-binomial likelihood would use PyTorch on GPU and is a candidate only if B1 shows gain. At 20,000 genes one double-precision matrix is 3.2 GB, so pairs are tested in gene blocks and only significant edges are stored. Cell-additive sums can stream in chunks; the IRLS weights need a second sweep, so streaming is proposed rather than claimed.

**Defaults an agent uses without asking.** `method` model_pairs; `input.layer` counts; `input.gene_select` variable with `min_expressed_fraction` 0.05; `subset.key` with one `subset.value`; `fdr` 0.05; `resolution` 1.0; `seed` 0; `device` auto. Other methods serve only as comparators. Changing the default requires the B1 and B2 results.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts for model_pairs |
| read | layers/log1p_norm | sparse float | log-normalised expression for the comparators |
| read | obs/<subset.key> | categorical | labels selecting the analysed cells |
| read | obs/<input.split_key> | categorical | donor or study labels for preservation splits |
| read | obsp/neighbors | sparse | kNN graph used to build metacells in hdwgcna |
| write | varm/coexpr_module | categorical | gene-to-module id; 0 is unassigned |
| write | varm/coexpr_kME | float32, genes by modules | membership correlation of each gene with each eigengene |
| write | obsm/coexpr_eigengene | float32, cells by modules | eigengene score per analysed cell; per metacell for hdwgcna |
| write | uns/coexpr/modules | table | module id, size, method, parameters, significant-pair count |
| write | uns/coexpr/preservation | table | Zsummary.pres and matched Jaccard per module, when split_key is set |
| write | models/coexpr | state | fitted moments and soft power, for model_pairs and wgcna |
| write | obsp/coexpr | sparse float | optional module-graph edge weights; large |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "model_pairs" | `model_pairs`, `wgcna`, `hdwgcna`, `leiden_gene_graph` | model_pairs is the default; the other three are heuristic comparators. |
| `subset` | object | — | — | Cells to analyse, selected by an obs key. model_pairs needs exactly one cell type. |
| `subset.key` | string | "cell_type" | — | obs column that labels cell types or groups. |
| `subset.value` | string/null | null | — | Level of the key to analyse; required for model_pairs. |
| `input` | object | — | — | Expression layer, gene filter and optional split key for preservation. |
| `input.layer` | string | "counts" | — | Layer to read; model_pairs needs counts, other methods a log-normalised layer. |
| `input.gene_select` | string | "variable" | `variable`, `expressed` | Gene filter: variable genes, or genes passing the expressed-fraction threshold. |
| `input.min_expressed_fraction` | number | 0.05 | min 0; max 1 | Minimum share of cells expressing a gene, applied before the gene filter. |
| `input.split_key` | string/null | null | — | obs key of donors or studies for preservation splits; null skips preservation. |
| `model_pairs` | object | — | — | Options for the default pair-covariance method. |
| `model_pairs.irls_n_iter` | integer | 10 | min 1 | Maximum IRLS iterations per moment regression (CS-CORE default). |
| `model_pairs.irls_eps` | number | 0.05 | min 0 | IRLS convergence threshold (CS-CORE default). |
| `model_pairs.fdr` | number | 0.05 | min 0; max 1 | Benjamini-Hochberg level for keeping gene pairs before clustering (proposed). |
| `model_pairs.resolution` | number | 1.0 | min 0 | Leiden modularity resolution on the significant-pair graph. |
| `wgcna` | object | — | — | Options for the WGCNA comparator (heuristic). |
| `wgcna.network_type` | string | "unsigned" | `unsigned`, `signed` | Sign handling in the soft-threshold adjacency. |
| `wgcna.soft_power` | integer/string | "auto" | — | Soft power, or auto for the smallest power reaching rsquared_cut. |
| `wgcna.rsquared_cut` | number | 0.85 | min 0; max 1 | Scale-free fit threshold used by automatic soft-power selection. |
| `wgcna.deep_split` | integer | 2 | min 0; max 4 | Dynamic tree cut sensitivity; higher gives more, smaller modules. |
| `wgcna.min_module_size` | integer | 20 | min 1 | Smallest module kept; capped at half the gene count, as in WGCNA. |
| `wgcna.merge_cut_height` | number | 0.15 | min 0 | Height below which similar modules are merged. |
| `hdwgcna` | object | — | — | Options for the hdWGCNA comparator (metacell-based, signed networks, heuristic). |
| `hdwgcna.metacell_k` | integer | 25 | min 1 | Neighbours used to aggregate metacells. |
| `hdwgcna.target_metacells` | integer | 1000 | min 1 | Target number of metacells. |
| `hdwgcna.soft_power` | integer/string | "auto" | — | Soft power, or auto over the hdWGCNA power grid. |
| `hdwgcna.deep_split` | integer | 4 | min 0; max 4 | Dynamic tree cut sensitivity; the hdWGCNA default is 4. |
| `hdwgcna.min_module_size` | integer | 50 | min 1 | Smallest module kept, as in hdWGCNA. |
| `hdwgcna.merge_cut_height` | number | 0.2 | min 0 | Merge height below which modules are combined, as in hdWGCNA. |
| `leiden_gene_graph` | object | — | — | Options for the Leiden gene-graph comparator (heuristic). |
| `leiden_gene_graph.k` | integer | 15 | min 1 | Neighbours per gene in the kNN graph (proposed default). |
| `leiden_gene_graph.similarity` | string | "pearson" | `pearson`, `spearman` | Gene-gene similarity used for graph edges. |
| `leiden_gene_graph.resolution` | number | 1.0 | min 0 | Leiden modularity resolution; the leidenalg default is 1.0. |
| `seed` | integer | 0 | — | Random seed for Leiden clustering and metacell sampling. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Method options apply only to their own object: `model_pairs` for the default, and `wgcna`, `hdwgcna` and `leiden_gene_graph` for comparators. `subset.value` is required for `model_pairs`, which assumes one cell type, and the call is refused otherwise. Setting `input.split_key` to null skips preservation, and `uns/coexpr/preservation` is then not written. `seed` controls only the Leiden and metacell sampling steps. A `wgcna.soft_power` of auto picks the smallest power reaching `rsquared_cut`; an integer skips the scale-free fit. The proposed values are `fdr` and the kNN size `k`, which have no literature default.

## 7. MCP tool

Tool name `singlet_programs_coexpression_module_detection` (definition in `tasks/mcp/singlet_programs_coexpression_module_detection.json`).

```json
{"dataset": "data/example_type.singlet", "subset": {"key": "cell_type", "value": "beta"}, "method": "model_pairs", "model_pairs": {"fdr": 0.05}}
```

```json
{"dataset": "data/example_type.singlet", "status": "completed",
 "wrote": ["varm/coexpr_module", "varm/coexpr_kME", "obsm/coexpr_eigengene", "uns/coexpr/modules", "models/coexpr"],
 "summary": {"method": "model_pairs", "n_genes_tested": "<n>", "n_modules": "<M>", "n_unassigned": "<count>", "n_significant_pairs": "<count>", "median_module_size": "<value>"},
 "provenance_id": "<id>"}
```

Long-running: pair tests above the gene-block threshold return `queued` with a `job_id`. Stochastic: only through Leiden and metacell sampling, controlled by `seed`. A dry run returns `seconds`, `peak_memory_gb` and `device`, estimated from the gene count, the cell count and the method.

## 8. Benchmarks

**Shared protocol.** Every method receives the same cells, gene universe and seeds, and the gene filter is fixed before clustering without using labels. Each benchmark has ten replicates with seeds 0 to 9; scores are averaged over replicates with equal weight, and medians with interquartile ranges are reported. Ranking statistics use average ranks for ties. Comparators are applied to identical inputs, with thread count, BLAS backend and hardware recorded. Versions are WGCNA 1.74 (61a2a7d) and hdWGCNA 0.4.12 (e3344d1).

### B1. Planted co-expression module recovery (proposed)

- **Goal**: recover planted modules and reject matched nulls across correlation strength and sample size.
- **Ground truth**: planted simulation; each gene carries its module id (1 to K) or 0 for null, fixed at generation. Scores use all genes.
- **Datasets**

| Dataset | Source | Modality, species, size | License |
|---|---|---|---|
| Gaussian-copula counts from one catalogue cell type | recipe below; copula design as in [R19] | synthetic scRNA-seq; 2,000 genes; n in {500, 2,000, 10,000} | not applicable |

Recipe (proposed settings):

1. Fit per-gene negative binomial marginals $F_j$ to one catalogue cell type's raw counts, with library size as offset.
2. Draw 2,000 genes stratified by fitted mean: K ∈ {5, 10} modules of 50 genes, and null genes from the same strata.
3. Set $\Sigma$ with within-module correlation $\rho\in\{0.2,0.4,0.6\}$ and zero elsewhere.
4. Draw $z_i\sim\mathcal N(0,\Sigma)$ and $x_{ij}=F_j^{-1}(\Phi(z_{ij}))$ with resampled library sizes; record realised count correlations.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Adjusted Rand index | Planted labels (module ids plus null 0) against predicted labels (module ids plus unassigned), all genes | higher | primary | [R18] |
| Planted-gene recall | Share of planted genes in the one-to-one Jaccard-matched predicted module | higher | primary | — |
| Null false-positive rate | Share of null genes assigned to any predicted module | lower | guardrail | — |
| Eigengene recovery | Per planted factor (mean latent $z$ of its module), maximum absolute correlation with a predicted eigengene | higher | primary | — |
| Module count error | Predicted minus planted module count | closer to 0 | guardrail | — |

- **Comparators**: model_pairs; wgcna; hdwgcna; leiden_gene_graph at three resolutions (proposed); Hotspot; hierarchical-clustering ablation.
- **Protocol**: the grid above; K is hidden from methods.
- **Acceptance criterion** (proposed): at $\rho\ge 0.4$ and $n\ge 2{,}000$, ARI ≥ 0.7, planted-gene recall ≥ 0.8, null false-positive rate ≤ 0.05, and $|\hat K-K|\le 1$ on at least 8 of 10 seeds.
- **Known pitfalls**: copula correlation is on the latent scale, so realised count correlation is reported; the copula omits dropout, so recovery is optimistic.

### B2. Module preservation across donors and studies (proposed)

- **Goal**: test whether discovery modules re-appear in held-out donors or studies.
- **Ground truth**: consistency; no independent truth. Splits are made at donor level, then at study level. The estimand per discovery module is its Zsummary.pres and its Jaccard overlap with the best held-out module, both defined in section 3 and below.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue cell types with at least five donors (proposed rule) | singlet catalogue, 354M cells, about 40% author-annotated | scRNA-seq; species and sizes as catalogued | — | Donor splits first, then study splits |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Zsummary.pres | Composite preservation z-score from density and connectivity of module genes in the held-out network | higher | primary | [R4] |
| Matched-module Jaccard | $\lvert A\cap B\rvert/\lvert A\cup B\rvert$ between a discovery module $A$ and its best held-out match $B$ | higher | primary | — |

- **Comparators**: wgcna preservation on the same splits; hdwgcna with metacells built per split; leiden_gene_graph; model_pairs.
- **Protocol**: hold out 20% of donors per split (proposed), ten seeds, and compute both metrics on the held-out split only.
- **Acceptance criterion** (proposed): median Jaccard ≥ 0.5 for modules of at least 30 genes, and Zsummary.pres ≥ 2 for at least 80% of modules. The cut-off of 2 is a common convention, not a threshold validated for single-cell gene graphs.
- **Known pitfalls**: donor structure leaking across splits inflates preservation; technical modules persist across batches and score as preserved.

### B3. TF-target edge recovery against BEELINE truth (extended)

- **Goal**: test whether co-expression evidence ranks true TF-target pairs above chance.
- **Ground truth**: curated and synthetic networks from BEELINE [R15]. The label is 1 for an ordered TF-target pair listed in the truth network and 0 otherwise. The estimand is the ranking of ordered pairs by method score, summarised by the median over datasets.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| BEELINE curated and synthetic input sets | https://github.com/murali-group/Beeline [R15] | scRNA-seq; per-dataset sizes as published in the repository | see §12 | Truth is directed; module scores are symmetric |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC ratio | Area under the precision-recall curve of ranked pairs, divided by the positive fraction | higher | primary | [R15] |
| AUROC | Area under the ROC curve of the same ranking | higher | guardrail | [R15] |
| Early precision ratio | Precision among the top-k ranked pairs divided by the positive fraction, with k the number of truth edges; formula from the README wording | higher | guardrail | [R15] |

- **Comparators**: GENIE3 and GRNBoost2 edge scores (arboreto); model_pairs correlation estimates.
- **Protocol**: rank TF-target pairs among BEELINE genes, average ties, and take medians over datasets.
- **Acceptance criterion** (proposed): median AUPRC ratio ≥ 1.5 on at least half of the curated datasets.
- **Known pitfalls**: symmetric scores cannot express direction, so the test is partial by design; truth networks are incomplete, so false positives are underestimated.

### P1. Performance and scaling

Grid of $p\in\{2{,}000, 5{,}000, 10{,}000, 20{,}000\}$ genes and $n\in\{10^3, 10^4, 10^5\}$ cells or metacells (design grid; larger cell counts use metacells). Hardware: CPU with all threads and one CUDA device. Metrics: wall seconds, peak host and device memory, and pairs per second. Comparators: WGCNA blockwiseModules (1.74), hdWGCNA ConstructNetwork (0.4.12), leidenalg on a kNN gene graph, arboreto GRNBoost2 and GENIE3, and CS-CORE's Rcpp IRLS (1.1.0). Held fixed: gene set, metacell count, soft power or its equivalent, threads, seeds and BLAS. At $p=20{,}000$ one double-precision $p\times p$ matrix needs 3.2 GB, so block size sets the design. Acceptance criterion (proposed): CUDA model_pairs at $p=20{,}000$ and $n=10^4$ takes at most twice the CPU wall time of WGCNA blockwise on the same input, within device memory.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `normalization.count_noise_model_selection`: Count noise-model selection and zero-inflation diagnosis
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
- **Feeds**:
  - `programs.cross_dataset_program_reproducibility`: Cross-dataset program reproducibility and meta-programs
  - `programs.identity_activity_program_labeling`: Separating identity, activity and technical programs
  - `programs.program_annotation`: Biological annotation of gene programs
  - `grn.regulon_motif_pruning`: Motif-supported regulon pruning of co-expression modules
- **Reads**: `layers/counts`, `layers/log1p_norm`, `obs/<subset.key>`, `obs/<input.split_key>`, `obsp/neighbors`
- **Writes**: `varm/coexpr_module`, `varm/coexpr_kME`, `obsm/coexpr_eigengene`, `uns/coexpr/modules`, `uns/coexpr/preservation`, `models/coexpr`, `obsp/coexpr`
<!-- CHAINING:AUTO:END -->

Belongs to the programs workflow after cell-type labelling and a count noise-model check, and before program reproducibility and labelling. It feeds the GRN workflow for motif pruning of modules.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The TOM formula was not read line by line in the code, and the Zsummary cut-off of 2 is a convention. The title and author order of [R2] are from memory, and only its DOI and year come from the repository. The GRNBoost2 method paper has no DOI in the local records. SCENIC module-building thresholds, the scLink method and its paradigm were not read. The module-detection benchmark [R14] was read as an abstract only, so no benchmark is taken from it. The BEELINE early-precision formula is taken from README wording.
- **Unsettled science.** No calibrated null exists for module significance beyond the proposed empirical null. The best transform for module recovery (log1p, Pearson residuals, depth-adjusted NB) is not settled. Whether modules should be cell-type-specific or pooled is a question for programs.multicellular_programs. Whether a module is technical is decided by covariate checks, not by the clustering.
- **Technical and statistical risks.** Pair p-values are invalid after modules are chosen from the same cells, so preservation uses donor-level holdout (B2). Donors and studies make cells non-independent. Storing $p\times p$ matrices limits the gene count per block. The copula benchmark omits dropout structure (B1).
- **Data-licence risks.** Catalogue datasets carry their own terms, which apply before any derived module is shared. Each reimplementation or port needs the licence review in section 12 before code is taken.
- **Candidates left out.** scLink [R22], SCENIC module construction, the module-detection benchmark protocol [R14] and a GO-enrichment proxy are left out. The GO proxy is report-only, its GO version was not recorded, and it is not a truth benchmark. The sparse precision model [R23] is background only.
- **First experiment.** On B1 at K = 5, ρ = 0.4 and n = 2,000, compare model_pairs with wgcna and hdwgcna on ARI and null false-positive rate across ten seeds. The default stays model_pairs only if its ARI exceeds the best heuristic by at least 0.05 (proposed threshold) with null false-positive rate at most 0.05.

## 11. References

R1. Langfelder P, Horvath S. WGCNA: an R package for weighted correlation network analysis. *BMC Bioinformatics* 2008;9:559. doi:10.1186/1471-2105-9-559 — partial (repo)
R2. Zhang B, Horvath S. A general framework for weighted gene co-expression network analysis. *Statistical Applications in Genetics and Molecular Biology* 2005. doi:10.2202/1544-6115.1128 — partial (repo)
R3. Langfelder P, Zhang B, Horvath S. Defining clusters from a hierarchical cluster tree: the Dynamic Tree Cut package for R. *Bioinformatics* 2008;24:719-720. doi:10.1093/bioinformatics/btm563 — partial (repo)
R4. Langfelder P, Luo R, Oldham MC, Horvath S. Is my network module preserved and reproducible? *PLoS Computational Biology* 2011. doi:10.1371/journal.pcbi.1001057 — partial (repo)
R5. Morabito S, et al. hdWGCNA identifies co-expression networks in high-dimensional transcriptomics data. *Cell Reports Methods* 2023. — partial (repo)
R6. Baran Y, et al. MetaCell: analysis of single-cell RNA-seq data using K-nn graph partitions. *Genome Biology* 2019. doi:10.1186/s13059-019-1812-2 — partial (corpus)
R7. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — partial (corpus)
R8. Blondel VD, Guillaume JL, Lambiotte R, Lefebvre E. Fast unfolding of communities in large networks. *Journal of Statistical Mechanics: Theory and Experiment* 2008. doi:10.1088/1742-5468/2008/10/p10008 — partial (corpus)
R9. Aibar S, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — partial (corpus)
R10. Van de Sande B, et al. A scalable SCENIC workflow for single-cell gene regulatory network analysis. *Nature Protocols* 2020. doi:10.1038/s41596-020-0336-2 — partial (corpus)
R11. Huynh-Thu VA, Irrthum A, Wehenkel L, Geurts P. Inferring regulatory networks from expression data using tree-based methods. *PLoS ONE* 2010. — partial (repo)
R12. Friedman JH. Stochastic gradient boosting. *Computational Statistics and Data Analysis* 2002;38(4):367-378. — partial (repo)
R13. Su C, Xu Z, Shan X, et al. Cell-type-specific co-expression inference from single cell RNA-sequencing data. *Nature Communications* 2023;14:4846. doi:10.1038/s41467-023-40503-7 — partial (repo)
R14. Saelens W, Cannoodt R, Saeys Y. A comprehensive evaluation of module detection methods for gene expression data. *Nature Communications* 2018;9:1090. doi:10.1038/s41467-018-03424-4 — partial (corpus)
R15. Pratapa A, et al. Benchmarking algorithms for gene regulatory network inference from single-cell transcriptomic data. *Nature Methods* 2020. doi:10.1038/s41592-019-0690-6 — partial (corpus)
R16. Lause J, Berens P, Kobak D. Analytic Pearson residuals for normalization of single-cell RNA-seq UMI data. *Genome Biology* 2021. doi:10.1186/s13059-021-02451-7 — partial (corpus)
R17. Hicks SC, Townes FW, Teng M, Irizarry RA. Missing data and technical variability in single-cell RNA-sequencing experiments. *Biostatistics* 2017. doi:10.1093/biostatistics/kxx053 — partial (corpus)
R18. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — partial (corpus)
R19. Sun T, et al. scDesign2: a transparent simulator that generates high-fidelity single-cell gene expression count data with gene correlations captured. *Genome Biology* 2021. doi:10.1186/s13059-021-02367-2 — partial (corpus)
R20. Andrews TS, Hemberg M. M3Drop: dropout-based feature selection for scRNASeq. *Bioinformatics* 2019. doi:10.1093/bioinformatics/bty1044 — partial (corpus)
R21. DeTomaso D, et al. Hotspot identifies informative gene modules across modalities of single-cell genomics. *Cell Systems* 2021. doi:10.1016/j.cels.2021.04.005 — partial (corpus)
R22. Li WV, et al. scLink: inferring sparse gene co-expression networks from single-cell expression data. *Genomics, Proteomics and Bioinformatics* 2021. doi:10.1016/j.gpb.2020.11.006 — partial (corpus)
R23. Friedman J, Hastie T, Tibshirani R. Sparse inverse covariance estimation with the graphical lasso. *Biostatistics* 2008. — unverified (memory)
R24. Langfelder P, Horvath S. Fast R functions for robust correlations and hierarchical clustering. *Journal of Statistical Software* 2012;46(11):1-17. — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/cran/WGCNA | Peter Langfelder (aut, cre); Steve Horvath; Chaochao Cai; Jun Dong; Jeremy Miller; Lin Song; Andy Yip; Bin Zhang | GPL (>= 2) (DESCRIPTION; version 1.74) | defaults and preservation statistic (B2, P1) | reimplement |
| https://github.com/smorabit/hdWGCNA | Sam Morabito (aut, cre); Zechuan Shi (ctb); Swarup Lab (fnd) | GNU GPLv3 (DESCRIPTION; the LICENSE file is a stub) | metacell-based comparator (hdwgcna) | reimplement |
| https://github.com/tanaylab/metacells | Oren Ben-Kiki (setup.py) | MIT (LICENSE.rst) | metacell reference | callout |
| https://github.com/ChangSuBiostats/CS-CORE | Chang Su (aut, cre); Zichun Xu (aut); Xinning Shan (aut) | MIT (LICENSE; DESCRIPTION 'MIT + file LICENSE') | pair covariance and test for model_pairs | port |
| https://github.com/vtraag/leidenalg | V.A. Traag | GPL-3.0-or-later (pyproject.toml; LICENSE is the GPL v3 text) | Leiden clustering in model_pairs and leiden_gene_graph | reimplement |
| https://github.com/tmoerman/arboreto | Thomas Moerman | BSD 3-Clause (LICENSE.txt; setup.py) | GRNBoost2 and GENIE3 defaults; B3 comparators | callout |
| https://github.com/Yoseflab/Hotspot | David DeTomaso | MIT (LICENSE; pyproject.toml) | comparator in B1 and P1 | callout |
| https://github.com/tallulandrews/M3Drop | Tallulah Andrews (DESCRIPTION) | GPL (>= 2) (DESCRIPTION; no LICENSE file at repository root) | expected-dropout code (section 3) | callout |
| https://github.com/JSB-UCLA/scDesign2 | Tianyi Sun (DESCRIPTION) | MIT (LICENSE; DESCRIPTION) | copula design reference (B1) | callout |
| https://github.com/murali-group/Beeline | — | GPL-3 (LICENSE in repository) | benchmark input sets and truth networks (B3) | callout |
