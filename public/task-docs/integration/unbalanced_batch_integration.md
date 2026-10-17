---
id: integration.unbalanced_batch_integration
title: Integration of unbalanced and nested batches
area: integration
scope: core
paradigm: hybrid
literature_status: open
priority: P1
depends_on: [integration.batch_effect_diagnosis, feature-selection.batch_aware_selection_for_integration, dim-reduction.normalized_cell_embedding]
feeds: [integration.integration_quality_scoring, abundance.neighborhood_da_knn_graph, clustering.cell_partitioning]
reads: [layers/counts, var/highly_variable, obsm/X_pca, obs/<batch_key>, obs/<label_key>]
writes: [obsm/X_integrated_<method>, layers/corrected_<method>, obsp/connectivities_<method>, obsp/distances_<method>, obs/presence_prob_<batch>, obs/over_correction_flag, uns/batch_composition_table, uns/integration_diagnostics_<method>, models/integration_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_integration_unbalanced_batch_integration
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Integration of unbalanced and nested batches

> Align each cell population across batches only where that population has cells, using a presence-gated batch correction, and report over- and under-correction stratified by population against published heuristic and conditional-model comparators.

## 1. Question

Given raw counts from $B \ge 2$ batches whose cell-type composition differs, with batch labels and optional cell-type labels, which representation aligns each population only where it is present in other batches and keeps batch-specific populations apart? The output is a corrected embedding $z_n\in\mathbb{R}^d$, a neighbour graph or corrected expression, with per-cell presence probabilities and over-correction flags; a correct answer aligns a population only with cells of the same population in other batches.

## 2. Why this task matters and where the field stands

Batch correction is needed whenever cells from several donors, studies or protocols are analysed together, and its errors propagate into clustering, annotation and differential expression. Integration benchmarks such as scIB [R1] score batch mixing and label conservation over all cells, which does not measure whether a population is present in each batch. Atlases and disease cohorts are rarely balanced: a population may occur in one donor, study or condition only, and nested designs (sub-batches within batches, or batches within conditions) let a condition effect be read as a batch effect or the reverse. A method that forces matches between populations without counterparts over-corrects; one that refuses matches under-corrects.

The status is **open**. Mixing metrics such as kBET [R13] and batch LISI [R3] reward over-correction, so high mixing does not show correct integration. Label-stratified scores penalise merging but depend on the labels they score [R1]. The open problems, none with an accepted solution, are:

- no metric penalises over-correction without also rewarding under-correction;
- a population absent from a batch cannot be separated from one that is under-sampled there;
- the batch covariate for nested designs has no consensus rule [R2];
- unbalanced optimal transport relaxes marginal constraints [R16], and sample-level hierarchical models represent per-sample variation explicitly [R19], but neither has been applied to this question here.

Neighbourhood differential abundance [R20] can flag populations concentrated in one batch after integration, but it tests abundance and does not correct.

## 3. Theory and insight

**Working model.** Cell $n$ belongs to batch $b_n$ and population $c_n$. For gene $g$ and log-normalised expression $x_{gn}$, the first-order additive model is

$$
x_{gn}=\mu_{g,c_n}+\beta_{g,b_n}+\varepsilon_{gn},
$$

valid for effects that are additive in log space, with enough cells per population and batch to estimate the means. The batch offset $\beta_{g,b}$ is identified only through populations observed in at least two batches. A population seen in one batch identifies $\mu_{g,c}+\beta_{g,b}$ but not the split between the two, so the correction applied to it is set by the model and not by the data. This identifiability gap is the formal core of the task.

**Estimands.** Each output and ground-truth quantity is defined as follows.

- $z_n$ is defined up to rotation and scale; only distances and neighbour sets carry meaning.
- $\mathcal N_k(n)$ is the set of $k$ nearest neighbours of $n$ in the output; a neighbourhood fraction is $|\mathcal N_k(n)\cap S|/k$ for a cell set $S$.
- $\rho_{nb}\in[0,1]$ is the posterior probability that the population of cell $n$ has at least one cell in batch $b$; it is a population-level quantity attached to a cell.
- The planted presence $p_{kb}\in\{0,1\}$ equals one when simulated group $k$ has at least one cell in batch $b$.
- Expert labels $c_n$ and batch labels $b_n$ are per cell. All metrics in section 8 except the Spearman correlation of B4 lie in $[0,1]$, higher is better.

**Metrics.** For kBET, let $o_{nb}$ count the neighbours of $n$ from batch $b$ and let $p_b$ be the global batch proportion. The statistic

$$
\chi^2_n=\sum_{b=1}^{B}\frac{(o_{nb}-k\,p_b)^2}{k\,p_b}
$$

has $B-1$ degrees of freedom under matching composition, and approximates the test only when the expected counts $k\,p_b$ are not small. The per-label score is the rejection rate over tested neighbourhoods; the reported value is one minus its mean over labels.

For iLISI with neighbour fractions $p_{nb}$, $\mathrm{iLISI}_n=(\sum_b p_{nb}^2)^{-1}$ is the inverse Simpson index of batch labels. Its normalised form $(\mathrm{iLISI}_n-1)/(B-1)$ is zero when all neighbours share one batch and one under perfect mixing; the reported score is its median over cells. CiLISI computes the same statistic within each type $c$, normalises it with the number of batches $B_c$ present in that type, and averages over all cells:

$$
\mathrm{CiLISI}=\frac{1}{N}\sum_{c}\sum_{n\in c}\frac{\mathrm{iLISI}^{(c)}_n-1}{B_c-1}.
$$

Batch ASW takes the silhouette $s(i)=(b(i)-a(i))/\max(a(i),b(i))$ on batch labels within each type, where $a(i)$ is the mean distance to cells of the same batch and $b(i)$ the smallest mean distance to another batch, and scores $1-|s(i)|$. Graph connectivity is the mean over labels of the fraction of a label's cells in its largest connected component of the label-restricted kNN graph. It penalises fragmentation of a label but not merging of two labels.

**Integration models.** Mutual-neighbour correctors pair cells across batches and move each cell by smoothed pair vectors. Schematically,

$$
\tilde z_n=z_n+\frac{\sum_{(a,b)}K(z_n,z_a)\,(z_b-z_a)}{\sum_{(a,b)}K(z_n,z_a)},
$$

where the sum runs over mutual pairs $(a,b)$ and $K$ is a kernel. This is the mutual-nearest-neighbour family [R4], not the exact kernel of any one implementation. A population with no counterpart yields no pairs and moves only by kernel leakage from neighbouring populations, the main over-correction route here. Harmony [R3] alternates soft clustering with a diversity penalty and a per-cluster linear correction; a population present in one batch is pulled toward clusters dominated by other batches when the penalty is strong. LIGER [R8] factors each dataset $E_i$ into shared factors $W$, dataset-specific factors $V_i$ and loadings $H_i$,

$$
\min_{W,V_i,H_i}\ \sum_i\lVert E_i-(W+V_i)H_i\rVert_F^2+\lambda\sum_i\lVert V_iH_i\rVert_F^2,
$$

so a program present in one batch must sit in $V_i$ and is penalised. The conditional VAE scVI [R11] maximises

$$
\mathcal L(x_n)=\mathbb E_{q(z_n\mid x_n,s_n)}\big[\log p(x_n\mid z_n,s_n)\big]-\mathrm{KL}\big(q(z_n\mid x_n,s_n)\,\|\,\mathcal N(0,I)\big),
$$

where $s_n$ is the batch covariate given to encoder and decoder. Nothing guarantees that populations seen in one batch are represented in $z_n$.

**Proposed gated objective.** Let $q(k\mid x_n)$ be the posterior over $K$ latent populations for cell $n$, and let $\pi_{bk}\in[0,1]$ be the presence of population $k$ in batch $b$, with Beta priors. The presence posterior and the alignment term are

$$
\rho_{nb}=\sum_k q(k\mid x_n)\,\pi_{bk},\qquad
\mathcal L_{\mathrm{align}}=\sum_{(n,m)}w_{nm}\lVert z_n-z_m\rVert^2,\quad w_{nm}=\rho_{n,b_m}\,\rho_{m,b_n},
$$

summed over mutual pairs across batches. With $\rho\equiv 1$ every mutual pair is pulled, which is the ungated over-correction route. Regime of validity: $\rho_{nb}$ is informative only when the expected count $N_b f_{bk}$ of population $k$ in batch $b$ is well above one, where $N_b$ is the batch size and $f_{bk}$ the population fraction; below that, $\pi_{bk}$ returns its prior.

**Assumptions and failure modes.** Shared populations must exist in at least two batches. The batch covariate must be the nuisance level: a finer covariate removes biology and a coarser one leaves structure [R2]. Labels used for training (scANVI, STACAS) must not score the same cells. Silhouette-based batch scores can misfire under nested effects (section 10). Neighbourhood metrics depend on $k$ and on the embedding.

**Insight.** For unbalanced designs the target is evidence-gated alignment: a population should be pulled toward another batch only where cells of that population exist there. Global mixing scores cannot separate a correct merge from an over-correction, so label-stratified scores must accompany them. Published comparisons disagree on the best corrector, and the ranking shifts with task complexity [R1, R14, R15]; the benchmarks cited here do not score population-level presence directly.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| fastMNN | heuristic | mutual-neighbour pairs in a shared PCA space, smoothed correction vectors | [R4] |
| Scanorama | heuristic | mutual-neighbour matching in a reduced space, kernel-weighted correction | [R7] |
| Harmony | heuristic | soft clustering with a batch-diversity penalty, per-cluster linear correction | [R3] |
| Seurat CCA and RPCA | heuristic | anchors in a canonical-correlation or reciprocal-PCA space, weighted correction | [R5], [R6] |
| BBKNN | heuristic | batch-balanced kNN graph; no embedding or corrected matrix | [R9] |
| STACAS | hybrid | Seurat-style anchors filtered with cell-type labels | [R10] |
| LIGER | model-based | integrative non-negative matrix factorisation with dataset-specific factors | [R8] |
| scVI | model-based | conditional VAE with a zero-inflated negative binomial decoder | [R11] |
| scANVI | model-based | scVI with a label classifier; unlabelled cells carry a placeholder | [R12] |

The heuristic correctors are the published standard for balanced designs and remain comparators here. scVI and scANVI are the standard conditional models, and STACAS is the anchor method built for cell-type imbalance. LIGER is kept as a factor-model comparator. MrVI [R19] is not listed; section 10 gives its status. Values below are library defaults unless the row says otherwise.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| fastMNN | k; cos.norm; ndist | 20; TRUE; 3 | batchelor R/fastMNN.R:283 @ a9c93ec |
| Scanorama | KNN; SIGMA; ALPHA; DIMRED | 20; 15; 0.10; 100 | scanorama.py:26, :29, :21, :24 @ 4b4ea07 |
| Harmony | theta; sigma; lambda | 2 (documented; NULL in signature); 0.1; NULL (estimated) | R/ui.R:17, :95–97 @ 7e21bd6 |
| Harmony | block.size; epsilon.harmony | 0.05; 1e-2 | R/harmony_option.R:36, :39 |
| Seurat | dims; k.anchor; k.filter; k.score | 1:30; 5; 200; 30 | integration.R:148–151 @ 5f67c70 |
| Seurat | k.weight; sd.weight | 100; 1 | integration.R:1496, :1498 |
| STACAS | dims; k.anchor | 30; 5 | R/main.R:73–74 @ ea34e82 |
| LIGER | k; lambda | 20; 5.0 | R/cINMF.R:92–93 @ afecff1 |
| BBKNN | neighbors_within_batch; n_pcs | 3; 50 | bbknn/matrix.py:325 @ 95ce34b |
| scVI | n_hidden; n_latent; n_layers; gene_likelihood | 128; 10; 1; zinb | _scvi.py:118–120, :123 @ 5555ecc |
| scVI (OpenProblems config) | n_latent; n_layers | 30; 2 | task_batch_integration src/methods/scvi/config.vsh.yaml:24, :32 |
| scANVI | n_hidden; n_latent | 128; 10 | _scanvi.py:119–120 @ 5555ecc |
| scANVI | unlabeled_category | required, no default | _scanvi.py:215 |
| scIB aggregation | batch weight (bio = 1 − batch) | 0.4 | scib-reproducibility visualization/plotSingleTaskRNA.R:31 |
| kBET | neighbourhood size | mean batch size / 4, clipped to 10–70 | scib/metrics/kbet.py:114 |
| iLISI, cLISI | k0 | 90 | scib/metrics/lisi.py:45 |
| kNN metrics | n_neighbors | 15 | scib/metrics/lisi.py:202–206 |
| isolated-label F1 | Louvain resolutions | ten values, 0.2 to 2.0 | scib/metrics/clustering.py:111 |
| ASW label | scaling | (s + 1) / 2 | scib/metrics/silhouette.py:52–54 |
| PCR | score | (pre − post) / pre, floored at 0 | scib/metrics/pcr.py:76–80 |
| CiLISI | minimum cells; minimum batches | 10; 2 | carmonalab scIntegrationMetrics README.md:105 |

## 5. Proposed singlet approach

**Routes.** Port (permissive licence): scVI, scANVI, Scanorama, BBKNN, Seurat CCA and RPCA, and the scIB metric definitions. Reimplement (copyleft licence): fastMNN, Harmony, LIGER, STACAS and the CiLISI definition. Callout (benchmark comparator only): the OpenProblems configurations and the scIB benchmark recipes. Licence names are in section 12.

**Proposed model.** The presence-gated conditional VAE of section 3: a batch-specific ZINB decoder as in scVI, $K$ latent populations with presence probabilities $\pi_{bk}$ under Beta priors, and the gated alignment term. Its outputs are the batch-free embedding $z_n$, the presence probabilities $\rho_{nb}$, and an over-correction flag set when more than half of a cell's embedding neighbours come from batches in which its presence probability is below one half. It is falsified on the benchmarks if, on simulation 1 (B2), its CBP does not exceed that of ungated scVI, or if its presence calibration against planted presence (Brier score and expected calibration error, both proposed) is no better than a constant prior at the average presence rate.

**ML stack.** PyTorch carries the encoder, the ZINB decoder, the Beta presence priors and autodiff, since the model is deep. Hard-coded CUDA or cuSPARSE kernels cover the small, iteration-heavy parts: Harmony-style soft clustering with per-cluster ridge correction, LIGER-style multiplicative NMF updates, sparse kNN graph construction, and the sparse aggregation that forms $\rho_{nb}$. These are matrix products with few parameters, so a custom path is practical. Exact kNN is used on small inputs and approximate search otherwise; streaming is not claimed.

**Defaults for agents.** Use the MCP defaults, which are scvi with presence gates on. `batch_key` must come from the user and is never defaulted for nested data. Set `label_key` only when labels are curated. If the presence-gated model fails the B2 acceptance criterion, the default becomes ungated scVI.

**Training data.** Simulations 1 and 2, whose planted presence is known and regenerable from the recipes, calibrate the gates. Catalogue subsets with author annotations may train the model only under study-level holdout, so no study appears in both training and scoring, and catalogue labels never score a model trained on them.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts; the input to every method, with log-normalised values derived from it |
| read | var/highly_variable | bool | genes eligible for the first `n_hvg` |
| read | obsm/X_pca | float | principal components for PCA-based methods |
| read | obs/<batch_key> | category | batch labels, at least two levels |
| read | obs/<label_key> | category | cell-type labels; optional |
| write | obsm/X_integrated_<method> | float32 | embedding (absent for bbknn) |
| write | layers/corrected_<method> | float32 | corrected expression (fastmnn, seurat, scanorama) |
| write | obsp/connectivities_<method> | sparse float32 | neighbour weights of the output |
| write | obsp/distances_<method> | sparse float32 | neighbour distances of the output |
| write | obs/presence_prob_<batch> | float32 | $\rho_{nb}$ toward each batch (scvi with gates) |
| write | obs/over_correction_flag | bool | flag defined in section 5 |
| write | uns/batch_composition_table | table | counts per type and batch |
| write | uns/integration_diagnostics_<method> | dict | B1 metric values; planted-truth metrics are not written |
| write | models/integration_<method> | model | trained weights (scvi, scanvi) |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "scvi" | `scvi`, `scanvi`, `stacas`, `seurat_cca`, `seurat_rpca`, `harmony`, `fastmnn`, `scanorama`, `liger`, `bbknn` | Integration method. scvi (default, with presence gates) is the proposed model; the others are comparators. |
| `batch_key` | string | "batch" | — | obs column with the batch label; at least two levels. For nested designs, name the covariate to remove explicitly. |
| `label_key` | string/null | null | — | obs column with cell-type labels; required for scanvi and stacas, otherwise used for stratified diagnostics. |
| `n_hvg` | integer | 2000 | min 1 | Number of var/highly_variable genes used as input. |
| `n_pcs` | integer | 30 | min 1 | PCs read from obsm/X_pca for PCA-based methods; ignored by scvi and scanvi. |
| `scvi` | object | — | — | Options for scvi and scanvi; presence_gates switches on the proposed gated objective. |
| `scvi.n_latent` | integer | 10 | min 1 | Latent dimension of the batch-free embedding. |
| `scvi.n_hidden` | integer | 128 | min 1 | Hidden units per layer of encoder and decoder. |
| `scvi.n_layers` | integer | 1 | min 1 | Hidden layers in encoder and decoder. |
| `scvi.gene_likelihood` | string | "zinb" | `zinb`, `nb` | Decoder count likelihood. |
| `scvi.max_epochs` | integer/null | null | min 1 | Training epochs; null lets the library choose from the cell count. |
| `scvi.presence_gates` | boolean | true | — | Apply presence gates to the alignment term; false gives the ungated baseline. |
| `scvi.n_populations` | integer/null | null | min 1 | Latent populations for the gates; null uses label levels, or Leiden clusters of the embedding. |
| `diagnostics` | object | — | — | Neighbourhood and label options for the metrics written to uns. |
| `diagnostics.k_neighbors` | integer | 15 | min 1 | Neighbours for kNN-based metrics such as graph connectivity and kSIM. |
| `diagnostics.lisi_k0` | integer | 90 | min 1 | Neighbourhood size for iLISI and cLISI. |
| `diagnostics.cilisi_min_cells` | integer | 10 | min 1 | Smallest cell type included in CiLISI. |
| `diagnostics.kbet_k_max` | integer | 70 | min 10 | Upper clip of the kBET neighbourhood size; the lower clip is 10. |
| `seed` | integer | 0 | min 0 | Random seed for initialisation, minibatches and neighbour search; recorded with the output. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running or writing. |
| `overwrite` | boolean | false | — | Replace existing output members of this method instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules that span parameters: options under `scvi` apply to scvi and scanvi, and `presence_gates` set to false gives the ungated baseline used in B2 and B3. `n_pcs` is ignored by scvi and scanvi. `label_key` is required for scanvi and stacas. For scvi, labels set only the number of populations; scanvi and stacas train on them, so their scores on the same labels are optimistic. For nested designs, state whether `batch_key` is the sub-batch or the top-level batch, because that choice decides which structure is removed.

## 7. MCP tool

Tool name `singlet_integration_unbalanced_batch_integration` (definition in `tasks/mcp/singlet_integration_unbalanced_batch_integration.json`).

```json
{"dataset": "atlas.singlet", "batch_key": "study", "label_key": "cell_type",
 "scvi": {"presence_gates": true}, "diagnostics": {"k_neighbors": 15}}
```

```json
{"dataset": "atlas.singlet", "status": "completed",
 "wrote": ["obsm/X_integrated_scvi", "obs/presence_prob_study", "obs/over_correction_flag",
           "uns/batch_composition_table", "uns/integration_diagnostics_scvi", "models/integration_scvi"],
 "summary": {"method": "scvi", "presence_gates": true, "n_batches": "<int>", "n_populations": "<int>",
             "device": "cuda", "seed": 0, "warnings": []},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: scvi and scanvi training on large inputs returns `status` queued with a `job_id`. Stochastic: `seed` fixes initialisation, minibatch order and neighbour search, but GPU kernels can still differ between runs. Dry run: `dry_run` true returns `estimate` with seconds, peak memory and device, and writes nothing.

## 8. Benchmarks

**Shared protocol.** Inputs are raw counts and batch-aware selection of 2,000 genes with `scib.pp.reduce_data` [R1], with PCA width 30 for every PCA-based method; BBKNN is also applied at its section 4 default. Each method is applied at its defaults, and scVI and scANVI are also applied at the OpenProblems values, reported separately. Metrics are computed on the output each method writes, with kBET on embeddings only. The batch score is the mean of scaled batch metrics, the biological score the mean of scaled biological metrics, and the total is 0.4 batch plus 0.6 biological (section 4). CBP and IGR need planted labels and are computed by the benchmark harness only. Scaling across methods is unspecified (section 10).

### B1. Real-data integration with expert labels

- **Goal**: rank methods on batch removal and label conservation across five RNA datasets with many batches.
- **Ground truth**: expert cell-type labels; kBET weights labels equally, iLISI weights cells equally.
- **Datasets**

| Dataset | Source | Modality, species, cells, batches, labels |
|---|---|---|
| pancreas | [R1]; figshare 12420968 | RNA, human, 16,382 cells, 9 batches, 14 labels |
| lung_atlas | [R1]; datasets_meta.tsv | RNA, human, 32,472 cells, 16 batches, 17 labels |
| immune_cell_hum | [R1]; figshare 12420968 | RNA, human, 33,506 cells, 10 batches, 16 labels |
| immune_cell_hum_mou | [R1]; datasets_meta.tsv | RNA, human and mouse, 97,952 cells, 23 batches, 19 labels |
| mouse_brain | [R1]; datasets_meta.tsv | RNA, mouse, 978,734 cells, 5 batches, 10 labels |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| kBET | 1 minus the mean over labels of the per-cell rejection rate | maximize | primary | [R13] |
| iLISI | median over cells of normalised batch inverse Simpson index | maximize | primary | [R3] |
| CiLISI | iLISI within types, normalised, averaged over cells | maximize | primary | section 12 |
| batch ASW | mean over types of $1-\lvert s\rvert$ on batch labels | maximize | primary | [R1] |
| PCR | batch variance share of PCs, $(\mathrm{pre}-\mathrm{post})/\mathrm{pre}$, floored at 0 | maximize | primary | [R1] |
| cLISI | median over cells of normalised label inverse Simpson index | maximize | primary | [R1] |
| ASW label | label silhouette scaled to $[0,1]$ | maximize | primary | [R1] |
| isolated-label F1 | mean over isolated labels of best Louvain F1 | maximize | primary | [R1] |
| isolated-label ASW | isolated versus other labels silhouette, averaged | maximize | primary | [R1] |
| kSIM | mean fraction of $K$ neighbours sharing the label | maximize | primary | section 12 |
| graph connectivity | mean over labels of largest-component fraction | maximize | guardrail | [R1] |

- **Comparators**: section 4 methods at defaults, unintegrated PCA, scVI and scANVI at OpenProblems values, presence-gated scVI (proposed).
- **Protocol**: three seeds for stochastic methods (proposed); CPU and CUDA reported separately.
- **Acceptance criterion**: PROPOSED. Total within 0.05 of the best per dataset; kSIM and graph connectivity within 0.05 of unintegrated.

### B2. Simulation 1: unequal proportions and absent groups

- **Goal**: test whether shared groups align while groups absent from some batches stay separate.
- **Ground truth**: planted presence $p_{kb}$ and planted group identity per cell, as defined in section 3.
- **Datasets**

| Dataset | Source | Modality, size | Notes |
|---|---|---|---|
| simulations_1_1 | scib-reproducibility simulation recipe (sim1.R, sample.R) | simulated RNA, 12,097 cells after QC, 9,799 genes, 6 batches, 7 groups | Splatter-based [R17]; exact zero proportions: group 3 in batch 3; group 5 in batches 2 and 6; group 6 in batches 4 and 6; group 7 in batches 1, 3, 4 and 6 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| all B1 metrics | as in B1, on the same outputs | as in B1 | primary | [R1] |
| cross-batch purity (CBP) | for cells whose group occurs in at least two batches, the fraction of the 15 nearest cells from other batches sharing the planted group, averaged | maximize | primary | proposed |
| isolated-group retention (IGR) | for cells of groups in the fewest batches, the fraction of their 15 nearest neighbours in any batch sharing the planted group, averaged | maximize | guardrail | proposed |

- **Comparators**: as B1, with scANVI trained on planted labels.
- **Protocol**: regenerate the dataset from the recipe with per-batch quality control and removal of genes in under 1 percent of cells; report post-QC counts (12,500 cells before QC). Three seeds for stochastic methods (proposed).
- **Acceptance criterion**: PROPOSED. CBP improves over unintegrated by at least 0.10; IGR is no more than 0.05 below unintegrated; a method failing the IGR condition is flagged as over-correcting whatever its batch scores.
- **Known pitfalls**: planted groups lack real biological complexity, so passing here does not guarantee performance on real data. Training scANVI on planted labels and then scoring with them is circular.

### B3. Simulation 2: nested sub-batches

- **Goal**: test whether sub-batch structure is removed while four planted groups stay separate, and whether a top-level covariate leaves sub-batch structure.
- **Ground truth**: planted groups per cell and sub-batch identity from the noise construction, with presence as in B2.
- **Datasets**

| Dataset | Source | Modality, size | Notes |
|---|---|---|---|
| simulations_2 | scib-reproducibility simulation recipe (sim2.R, sample.R) | simulated RNA, 19,318 cells after QC, 10,000 genes, 16 sub-batches in 4 batches, 4 groups | a second Splatter [R17] matrix with lower library size is added to each sub-batch; QC at sub-batch level |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| all B1 metrics | with batch set to sub-batch | as in B1 | primary | [R1] |
| CBP and IGR | as in B2, with batch set to sub-batch | as in B2 | primary | proposed |
| top-level iLISI | normalised iLISI over the four top-level batches after sub-batch integration, compared with direct top-level integration | maximize | guardrail | proposed |

- **Comparators**: as B2.
- **Protocol**: each method is applied twice, with batch set to sub-batch (primary) and to top-level batch (diagnostic). Seeds as in B2.
- **Acceptance criterion**: PROPOSED. With batch set to sub-batch, normalised iLISI improves over unintegrated by at least 0.10 and IGR is no more than 0.05 below unintegrated; top-level iLISI does not exceed the value from direct top-level integration.
- **Known pitfalls**: groups are present in all four batches and composition differs between them, so this test probes nested structure under composition shifts, not absence. Sub-batch noise lowers library size, which can drive several methods independently of nesting.

### B4. Validity of label-free metrics under planted truth

- **Goal**: test which label-free metrics track the planted ranking on B2 and B3, including whether silhouette-based batch scores misfire under nested batches, as reported in the repository record (section 10).
- **Ground truth**: the method ranking from CBP and IGR, pooled over both simulations and seeds. The estimand is rank order, not absolute values.
- **Datasets**

| Dataset | Source | Modality, size | Notes |
|---|---|---|---|
| simulations_1_1 and simulations_2 | outputs of B2 and B3 | simulated RNA, 12,097 and 19,318 cells | candidates are scored separately per simulation |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Spearman correlation | per simulation, correlation of each candidate (kBET, iLISI, CiLISI, batch ASW, graph connectivity, kSIM, cLISI) with the truth ranking | maximize | primary | proposed |

- **Comparators**: the methods of B2 and B3.
- **Protocol**: pool outputs over both simulations and seeds, compute the truth ranking from CBP and IGR, and report intervals over seeds.
- **Acceptance criterion**: PROPOSED. A metric is valid if its Spearman correlation with the truth ranking is at least 0.8 on both simulations.
- **Known pitfalls**: CBP and IGR are truth-based, so agreement with them shows agreement with planted structure only. Few methods give a rank spread on simulations, so correlations are unstable.

### P1. Performance and scaling

Wall time, peak memory and throughput in cells per second at 10k, 100k and 1M cells, on CPU and CUDA, for every comparator and for presence-gated scVI. Inputs are subsamples of the catalogue at these sizes, plus the five datasets of B1 as real-data points; 10M cells are not claimed because streaming is not claimed. Hold fixed the 2,000 genes, PCA width 30, $k=15$, thread count and hardware. Report scVI-family methods at default and fixed epoch counts.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `integration.batch_effect_diagnosis`: Batch-effect detection and quantification
  - `feature-selection.batch_aware_selection_for_integration`: Batch-aware and lineage-aware feature selection for integration
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
- **Feeds**:
  - `integration.integration_quality_scoring`: Integration quality scoring
  - `abundance.neighborhood_da_knn_graph`: Cluster-free neighbourhood differential abundance on a kNN graph
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Reads**: `layers/counts`, `var/highly_variable`, `obsm/X_pca`, `obs/<batch_key>`, `obs/<label_key>`
- **Writes**: `obsm/X_integrated_<method>`, `layers/corrected_<method>`, `obsp/connectivities_<method>`, `obsp/distances_<method>`, `obs/presence_prob_<batch>`, `obs/over_correction_flag`, `uns/batch_composition_table`, `uns/integration_diagnostics_<method>`, `models/integration_<method>`
<!-- CHAINING:AUTO:END -->

Recipe: atlas integration with an unbalanced-design check, after batch diagnosis and feature selection, before quality scoring.

## 10. Risks, pitfalls and open questions

- **Silhouette claim.** The statement that silhouette-based batch metrics misfire under nested batch effects is recorded in a repository README that cites [R18]. The preprint text is not in the local corpus. The corpus also holds a journal record under a different title and DOI, and the link between the two is not established.
- **Rankings and mapping.** The rankings in section 2 come from secondary summaries of [R1], [R14] and [R15], and the original tables were not checked. The mapping of scIB datasets to complex tasks is not established, so B1 uses all five. The status of MrVI [R19] is that its output was not evaluated, and whether it is batch-free is unknown.
- **Data access and licences.** Only pancreas and immune_cell_hum are linked to figshare 12420968, and the file mapping is not established. Accessions for lung_atlas, immune_cell_hum_mou and mouse_brain are absent. Licence terms of the benchmark datasets were not reviewed. The simulations have no static download and must be regenerated from the recipes.
- **Versions and records.** The Harmony v2 preprint linked from the Harmony README is not in the corpus, so Harmony defaults may differ in that version. The best-practices text pins scvi-tools 1.4.1, while the local repository is version 1.5.1. Commit identifiers in section 4 are HEAD values at check time. The batchelor and Harmony clones lack a LICENSE file, so their licences come from DESCRIPTION. Local bibliographies disagree on the years of scIB, kBET and BBKNN; reference lines use the year of the corpus record.
- **Metric gaps.** The kSIM neighbourhood size is not established, and its reference has no title or DOI in the corpus. The scaling used to combine metrics across methods is unspecified, so the total in B1 depends on a convention. No complexity figures are claimed.
- **First experiment.** Implement ungated and presence-gated scVI on simulation 1 with three seeds, and measure CBP, IGR and gate calibration before any catalogue training. Risks: presence posteriors fall back to the prior when expected counts are small, and scale beyond 978,734 cells is untested.

## 11. References

R1. Luecken MD, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2021. doi:10.1038/s41592-021-01336-8 — partial (corpus)
R2. Argelaguet R, et al. Computational principles and challenges in single-cell data integration. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00895-7 — partial (corpus)
R3. Korsunsky I, et al. Fast, sensitive and accurate integration of single-cell data with Harmony. *Nature Methods* 2019. doi:10.1038/s41592-019-0619-0 — partial (corpus)
R4. Haghverdi L, et al. Batch effects in single-cell RNA-sequencing data are corrected by matching mutual nearest neighbors. *Nature Biotechnology* 2018. doi:10.1038/nbt.4091 — partial (corpus)
R5. Stuart T, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — partial (corpus)
R6. Hao Y, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — partial (repo)
R7. Hie B, Bryson B, Berger B. Efficient integration of heterogeneous single-cell transcriptomes using Scanorama. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0113-3 — partial (corpus)
R8. Welch JD, et al. Single-cell multi-omic integration compares and contrasts features of brain cell identity. *Cell* 2019. doi:10.1016/j.cell.2019.05.006 — partial (corpus)
R9. Polański K, et al. BBKNN: fast batch alignment of single cell transcriptomes. *Bioinformatics* 2019. doi:10.1093/bioinformatics/btz625 — partial (corpus)
R10. Andreatta M, et al. Semi-supervised integration of single-cell transcriptomics data. *Nature Communications* 2024. doi:10.1038/s41467-024-45240-z — partial (repo)
R11. Lopez R, et al. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — partial (corpus)
R12. Xu C, et al. Probabilistic harmonization and annotation of single-cell transcriptomics data with deep generative models. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209620 — partial (corpus)
R13. Büttner M, et al. A test metric for assessing single-cell RNA-seq batch correction. *Nature Methods* 2019. doi:10.1038/s41592-018-0254-1 — partial (corpus)
R14. Tran HTN, et al. A benchmark of batch-effect correction methods for single-cell RNA sequencing data. *Genome Biology* 2020. doi:10.1186/s13059-019-1850-9 — partial (corpus)
R15. Chazarra-Gil R, et al. Flexible comparison of batch correction methods for single-cell RNA-seq using BatchBench. *Nucleic Acids Research* 2021. doi:10.1093/nar/gkab004 — partial (corpus)
R16. Chizat L, Peyré G, Schmitzer B, Vialard FX. Scaling algorithms for unbalanced optimal transport problems. *Mathematics of Computation* 2018. — partial (corpus)
R17. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — partial (corpus)
R18. Rautenstrauch P, Ohler U. Metrics Matter: Why We Need to Stop Using Silhouette in Single-Cell Benchmarking. *bioRxiv* 2025. doi:10.1101/2025.01.21.634098 — partial (repo)
R19. Boyeau P, et al. Deep generative modeling of sample-level heterogeneity in single-cell genomics. *Nature Methods* 2025. doi:10.1038/s41592-025-02808-x — partial (corpus)
R20. Dann E, et al. Differential abundance testing on single-cell data using k-nearest neighbor graphs. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01033-z — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/LTLA/batchelor | Aaron Lun (aut, cre); Laleh Haghverdi (ctb) (DESCRIPTION) | GPL-3 (DESCRIPTION) | fastMNN comparator | reimplement |
| https://github.com/brianhie/scanorama | Brian Hie (setup.py) | MIT (LICENSE) | Scanorama comparator | port |
| https://github.com/immunogenomics/harmony | Ilya Korsunsky (cre, aut), Nikolaos Patikas, Hongcheng Yao and others (DESCRIPTION) | GPL-3 (DESCRIPTION) | Harmony comparator and soft clustering | reimplement |
| https://github.com/satijalab/seurat | Satija Lab, NYGC (README) | MIT (LICENSE) | Seurat CCA and RPCA comparators | port |
| https://github.com/scverse/scvi-tools | Yosef Lab, Weizmann Institute (LICENSE) | BSD-3-Clause (LICENSE) | scVI and scANVI basis | port |
| https://github.com/welch-lab/liger | Joshua Welch (aut); Yichen Wang (cre) (DESCRIPTION) | GPL-3 (LICENSE) | LIGER comparator | reimplement |
| https://github.com/Teichlab/bbknn | Krzysztof Polanski, Jongeun Park (pyproject.toml) | MIT (LICENSE) | BBKNN comparator | port |
| https://github.com/carmonalab/STACAS | Massimo Andreatta, Ariel Berenstein, Josep Garnica and others (DESCRIPTION) | GPL-3 (DESCRIPTION, LICENSE) | STACAS comparator | reimplement |
| https://github.com/carmonalab/scIntegrationMetrics | Massimo Andreatta, Josep Garnica, Santiago Carmona (DESCRIPTION) | GPL-3 (LICENSE) | CiLISI definition | reimplement |
| https://github.com/theislab/scib | scIB authors [R1] | MIT (LICENSE) | metric definitions and reference code | port |
| https://github.com/theislab/scib-reproducibility | Theis Lab (LICENSE) | MIT (LICENSE) | simulation recipes and aggregation weight | callout |
| https://github.com/openproblems-bio/task_batch_integration | Open Problems in Single-Cell Analysis (LICENSE) | MIT (LICENSE) | method configurations and kSIM configuration | callout |
