---
id: neighbors.batch_aware_knn_graph
title: Batch-aware neighbour graph construction
area: neighbors
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection, feature-selection.highly_variable_gene_selection]
feeds: [clustering.cell_partitioning, integration.integration_quality_scoring, embedding-viz.local_neighborhood_preservation]
reads: [layers/log1p_norm, layers/counts, var/highly_variable, obsm/<use_rep>, obs/<batch_key>]
writes: [obsp/<key>_connectivities, obsp/<key>_distances, obsm/<key>_embedding, uns/<key>_params]
devices: [cpu, cuda]
mcp_tool: singlet_neighbors_batch_aware_knn_graph
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Batch-aware neighbour graph construction

> Build the cell neighbour graph from several batches at once, and measure whether batches mix inside cell-type neighbourhoods without merging distinct cell types.

## 1. Question

Given a matching space $Z\in\mathbb{R}^{n\times d}$ (principal components of log-normalised expression, or a corrected or latent space), batch labels $s_i$ and a neighbour count $k$, which symmetric weighted graph should downstream clustering and embedding use so that its edges join cells of the same type across batches? The output is a sparse connectivity matrix $\tilde W$, the matching distances of its edges, and optionally the corrected space it was built from. Labels never enter construction; they only score it.

## 2. Why this task matters and where the field stands

Status: **contested**. Clustering, embedding and neighbourhood differential abundance read the neighbour graph rather than the expression matrix. A graph that follows batch yields clusters that follow batch, and a graph that over-mixes merges populations. Batch-aware construction is where the integration decision reaches these downstream steps.

Methods disagree on what a batch effect is. Harmony [R5] assumes a shift within soft clusters. MNN [R2] and Seurat anchors [R3, R4] assume that mutual neighbours share a type. Scanorama [R6] aligns approximate mutual matches, and scVI [R7] treats batch as a covariate of a latent model. BBKNN [R1] corrects no data and forces cross-batch edges into the graph, trading label fidelity for mixing.

Benchmarks disagree too. scIB [R9] reports scANVI, Scanorama, scVI and scGen among the best-performing methods on complex tasks. The simple-task rankings of Harmony and Seurat [R10, R11, R15] and the BBKNN rankings attributed to the best-practices book [R15] are not confirmed here (section 10).

Open problems: (i) cross-batch edges between types absent from one batch; (ii) no principled per-type neighbour count, so rare types lose neighbours to abundant ones; (iii) the scIB graph metrics [R9] score mixing and conservation separately, and neither measures the label agreement of the cross-batch edges themselves; (iv) the batch covariate (sample, donor or study) decides which differences are removed, and sample-level batches can remove biology.

## 3. Theory and insight

Notation: cell $i$ has batch $s_i\in\{1,\dots,B\}$, matching coordinates $z_i\in\mathbb{R}^d$ and distance $d_{ij}=\lVert z_i-z_j\rVert_2$; the annotated type $y_i$ only scores. Every method forms a candidate list $N(i)$ and weights it. The ordinary list ignores batch:

$$N_k(i)=\{\text{the }k\text{ smallest }d_{ij}\text{ over }j\neq i\}$$

Regime: $k\ll n$ and $z$ a 30 to 50 dimensional principal-component or latent space. BBKNN [R1] takes one list per batch:

$$N^{\mathrm{BB}}(i)=\bigcup_{b=1}^{B}\{\text{the }k_b\text{ smallest }d_{ij}\text{ over all }j\text{ with }s_j=b\}$$

The package queries every cell against each batch's tree, so a cell is its own neighbour in its own batch's block at distance zero. The list has $k_bB$ entries, $k_bB-1$ of them other cells, and the package raises an error when any batch holds fewer than $k_b$ cells (`bbknn/matrix.py:358-361`). Batch composition of each list is fixed by construction.

Weights follow the smooth membership of UMAP [R13]:

$$w_{ij}=\exp\!\Big(-\frac{\max(0,\,d_{ij}-\rho_i)}{\sigma_i}\Big),\qquad \rho_i=\min_{j\in N(i)}d_{ij},\qquad \sum_{j\in N(i)}w_{ij}=\log_2|N(i)|$$

$\sigma_i$ is solved per cell. These are membership degrees, not calibrated probabilities. Fuzzy union gives $\tilde w_{ij}=w_{ij}+w_{ji}-w_{ij}w_{ji}$, and trimming drops $(i,j)$ when $\tilde w_{ij}$ is below the $m$-th largest weight of row $i$ or of row $j$; $m$ defaults to 10 times the total neighbour count.

Matching methods trust a cross-batch pair only when each cell is among the other's neighbours. For MNN pairs [R2] between batches $b$ and $c$ with $k=20$, the condition is $j\in N^{c}_{20}(i)\wedge i\in N^{b}_{20}(j)$. Each pair gives a correction vector, and a Gaussian kernel of bandwidth $\sigma$ averages these over all cells, so unpaired cells also move. Seurat v3 [R3, R4] takes mutual neighbours in canonical-correlation space with $k_a=5$, filters and scores them, and weights corrections by anchor score. Harmony [R5] alternates soft clustering of principal components, with entropy and diversity penalties, and per-cluster ridge corrections. Scanorama [R6] matches approximate mutual neighbours in an SVD space. scVI [R7] maximises a conditional evidence lower bound with batch as covariate:

$$\mathcal L(x_i)=\mathbb E_{q_\phi(z\mid x_i,s_i)}\big[\log p_\theta(x_i\mid z,s_i,\ell_i)\big]-\mathrm{KL}\big(q_\phi(z\mid x_i,s_i)\,\|\,p(z)\big)$$

Its graph uses the posterior mean of $z$; batch enters only as a covariate, so its removal is approximate.

Estimands and normalisation, one sentence each:

- Connectivity $\tilde w_{ij}\in[0,1]$ is the fuzzy membership of $j$ in the neighbourhood of $i$ after union and trim; rows are not normalised, so $\tilde W$ is not a transition matrix.
- Distance $d_{ij}$ is the Euclidean distance in the matching or corrected space, for retained edges only; the corrected space is in the units of its input.
- The type $y_i$ is the unnormalised author annotation; the batch $s_i$ is the covariate chosen for the task (sample, donor or study).
- Graph connectivity averages, over labels $c$, the share of cells in the largest strongly connected component of the label-induced subgraph $G_c$:

$$\mathrm{GC}=\frac{1}{|C|}\sum_{c\in C}\frac{|\mathrm{LCC}(G_c)|}{|N_c|}$$

- LISI is the inverse Simpson index $\big(\sum_g\hat p_{ig}^{\,2}\big)^{-1}$ of group labels among a cell's neighbours [R5], equal to the number of groups under even mixing. Batch iLISI is reported raw and as $(\mathrm{LISI}-1)/(B-1)$, a normalisation chosen here; type cLISI is scaled as $(n_{\mathrm{types}}-\mathrm{cLISI})/(n_{\mathrm{types}}-1)$, so 1 means separated.

Two proposed quantities score cross-batch edges directly. Let $T_b$ be the types present in batch $b$, and let $\mathcal X=\{\{i,j\}:\ s_i\neq s_j,\ y_i\in T_{s_j},\ y_j\in T_{s_i}\}$ over unordered pairs. Then

$$P_{\mathrm{xb}}=\frac{\sum_{\{i,j\}\in\mathcal X}\tilde w_{ij}\,\mathbf 1[y_i=y_j]}{\sum_{\{i,j\}\in\mathcal X}\tilde w_{ij}}$$

is the share of cross-batch weight joining cells of one type, over pairs whose types occur in both batches. For an absent type $a\notin T_b$, with $\mathcal F_a=\{\{i,j\}:\ a\in\{y_i,y_j\},\ s_i\neq s_j\}$,

$$F^{(a)}_{b}=\frac{\sum_{\{i,j\}\in\mathcal F_a,\ b\in\{s_i,s_j\}}\tilde w_{ij}}{\sum_{\{i,j\}\in\mathcal F_a}\tilde w_{ij}}$$

is the share of cross-batch weight touching type-$a$ cells that lands in batch $b$. Every such edge joins different types, so $F$ measures weight forced into a batch that cannot contain a type-$a$ neighbour, not label agreement. Both ratios are undefined without weight.

For a type-$a$ cell with equal weights and candidate lists taken before union and trim, the share of cross-batch candidates lying in batch $b$ is $k_b/(k_b(B-1))=1/(B-1)$. Untrimmed BBKNN therefore predicts $F\approx 0.5$ for three batches.

Regime of validity. The per-batch count and this share hold on candidate lists before union and trim; afterwards row composition is no longer uniform, and only section 8 describes the graph produced. MNN assumes that batch effects are mostly orthogonal to the biological manifold, as stated in the batchelor documentation (`R/mnnCorrect.R:29`). $P_{\mathrm{xb}}$ and $F$ are ratio estimates whose variance shrinks as the number of cross-batch edges grows.

Failure modes. Per-batch fixed-$k$ methods assume every type appears in every batch: a type missing from batch $b$ still receives $k_b$ edges into it, and a large $k_b$ or a high trim lets abundant types dominate the lists of rare cells. Pair and anchor methods assume shared types and orthogonal batch effects, and a false pair spreads a wrong correction to neighbours. Correction-then-kNN methods over-correct when batches differ biologically and under-correct when the batch effect needs more components than they keep. Benchmarks add three pitfalls: iLISI rewards any cross-batch edge; graph connectivity can be high while cross-type edges are common; and graph metrics depend on degree, so degree must be matched before comparing graphs.

Insight. Graph-level mixing depends on how many cross-batch edges a method creates and how often they join one type. BBKNN fixes the number by construction, so its extra edges are least label-faithful where a type is missing from a batch. Its only control, trimming, is global; lower trim gives more independent populations and more residual batch effect (scanpy documentation). Correction methods move the trade-off into the model, which assumes shared types (pairs, anchors) or a shift (Harmony, Scanorama). No listed method exposes this trade-off as an edge probability. Exact per-batch search costs $\sum_b n_b^2 d\le n^2 d$ distance evaluations, since $\sum_b n_b=n$; this is derived, not measured.

## 4. Methods landscape

The methods compared follow the OpenProblems batch-integration task, which builds on scIB [R9]. BBKNN is the only graph-level method in that set; the others correct the data or an embedding first and then build a kNN graph. Uncorrected kNN [R14] is the reference. scANVI [R8] uses labels, so it is handled by integration.batch_corrected_embedding and is excluded here.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Uncorrected kNN (baseline) | heuristic | Ordinary kNN on the matching space, with no batch information | [R14] |
| BBKNN (per-batch neighbours) | heuristic | Union of the $k_b$ nearest cells in each batch, fuzzy weights, fuzzy union, global trim | [R1] |
| MNN correction then kNN (batchelor) | heuristic | Mutual nearest-neighbour pairs across batches; kernel-smoothed correction vectors | [R2] |
| Seurat v3 CCA anchors then kNN | heuristic | Mutual neighbours in canonical-correlation space, filtered and scored, then weighted correction | [R3], [R4] |
| Harmony-corrected PCs then kNN | hybrid | Soft clustering with entropy and diversity penalties; ridge batch correction per cluster | [R5] |
| Scanorama then kNN | heuristic | Approximate mutual matches in an SVD space; kernel-weighted alignment | [R6] |
| scVI latent then kNN | model-based | Conditional VAE with batch as covariate; graph built on the posterior mean | [R7] |

Defaults of the implemented methods. Sources are corpus clones at the versions shown; paths are relative to each repository root. The Seurat rows use Seurat 5.6.0.9000 code for the CCA anchor method of [R3, R4].

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| BBKNN | neighbors_within_batch | 3 | bbknn/matrix.py:325 @ 95ce34b; src/scanpy/neighbors/_bbknn.py:45 @ 8ed52d9 |
| BBKNN | neighbors_within_batch in the scIB wrapper | 3 if n < 1e5, else 25 | scib/integration.py:349-373 @ cd67913 |
| BBKNN | n_pcs | 50 (bbknn package, scanpy.external); None (scanpy.pp.bbknn) | bbknn/matrix.py:325; src/scanpy/external/pp/_bbknn.py:28; src/scanpy/neighbors/_bbknn.py:46 |
| BBKNN | trim | None, meaning 10 times the total neighbours; 0 disables | bbknn/matrix.py:380-381; src/scanpy/neighbors/_bbknn.py:200-201 |
| BBKNN | annoy_n_trees | 10 | bbknn/matrix.py:326; src/scanpy/external/pp/_bbknn.py:30 |
| BBKNN | approx | True (scanpy.external) | src/scanpy/external/pp/_bbknn.py:23 |
| BBKNN | set_op_mix_ratio; local_connectivity | 1; 1 | bbknn/matrix.py:327-328; src/scanpy/external/pp/_bbknn.py:34-35 |
| BBKNN | OpenProblems method config | neighbors_within_batch 3; annoy_n_trees 10; n_hvg 2000; log_cp10k input | src/methods/bbknn/config.vsh.yaml @ b3da9d6 |
| MNN | k | 20 | R/mnnCorrect.R:125 (batchelor 1.27.1) |
| MNN | sigma | 0.1 | R/mnnCorrect.R:125; documented at R/mnnCorrect.R:35 |
| MNN | cos.norm.in; cos.norm.out | TRUE; TRUE | R/mnnCorrect.R:179 |
| Seurat | reduction | cca | R/integration.R:146 (Seurat 5.6.0.9000) |
| Seurat | dims | 1:30 | R/integration.R:148 |
| Seurat | anchor.features | 2000 | R/integration.R:142 |
| Seurat | k.anchor; k.filter; k.score | 5; 200; 30 | R/integration.R:149; R/integration.R:150; R/integration.R:151 |
| Harmony | theta | 2 when NULL | R/ui.R:197-198 (DESCRIPTION 2.1.0) |
| Harmony | sigma | 0.1 | R/ui.R:96 |
| Harmony | lambda | NULL, estimated with alpha 0.2 | R/ui.R:97; R/harmony_option.R:34 |
| Harmony | nclust | NULL, meaning min(round(N/30), 100) | R/ui.R:98, 193 |
| Scanorama | knn; sigma; alpha | 20; 15; 0.10 | scanorama/scanorama.py:26; scanorama/scanorama.py:29; scanorama/scanorama.py:21 |
| Scanorama | dimred; approx; batch_size | 100; True; 5000 | scanorama/scanorama.py:24; scanorama/scanorama.py:22; scanorama/scanorama.py:23 |
| Scanorama | seed | 0 | scanorama/scanorama.py:36 |
| scVI | n_hidden; n_latent; n_layers; dropout_rate | 128; 10; 1; 0.1 | src/scvi/model/_scvi.py:118-121 @ 5555ecc |

## 5. Proposed singlet approach

**Routes.** BBKNN, Seurat anchors and Scanorama are **ported**. MNN and Harmony are **reimplemented** from the definitions in section 3 and the defaults in section 4. Routes are set in section 12. The scVI model is **ported** to PyTorch with the objective of section 3. scanpy, the scIB metrics, the OpenProblems task and the best-practices chapter are **callouts** used for comparison. scanpy's BBKNN writes fixed keys, so singlet uses its own under `key`. The baseline is the kNN of neighbors.approximate_knn_search.

**Default.** `bbknn` is the default. It is the graph-level method of section 4, it has no correction step, and it fixes the cross-batch edge count by construction. The choice is provisional: section 8 decides it, and the learned route replaces it only if it wins on B2 and B1 without leakage.

**Learned route (proposed, not in the enum).** A PyTorch projection of the scVI latent is trained contrastively: positives are same-type cells from different studies, negatives are other types. The graph takes BBKNN's per-batch top-$k$ in the projected space, and the global trim is replaced by an edge probability $p_{ij}$, a logistic function of projected distance fitted by maximum likelihood on held-out study pairs. Training uses author-annotated catalogue cells, split by study because study equals batch in most annotated data, and excludes every B1 dataset. The route is rejected if, at matched cross-batch weight, it does not raise $P_{\mathrm{xb}}$ over BBKNN on B2 and held-out studies, or if its B1 iLISI gain at matched degree is below BBKNN's. It enters the enum only once implemented and benchmarked.

**Kernels and stack.** PyTorch trains the projection and the scVI encoder. Hard-coded CUDA kernels cover the small hot steps: segmented per-batch top-$k$, sparse symmetrisation and row-wise trimming. GPU search uses cuVS or rapids-singlecell; CPU search uses blocked matrix products or an NN-descent index. Graph memory is $O(nk_bB)$ entries before trimming, so catalogue-scale graphs need chunked per-batch search; sharded assembly is not specified in this release.

**Defaults.** Agents use `method` bbknn, set `batch_key` to the sample or donor column, and keep `matching.n_pcs` 50, `matching.n_hvg` 2000, `key` batch_knn, `seed` 0 and `device` auto.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/<use_rep> | float32, N by d | matching space; bbknn, harmony_knn and uncorrected_knn |
| read | layers/log1p_norm | sparse float | log-normalised expression; mnn, seurat_anchors, scanorama_knn |
| read | layers/counts | sparse int | raw UMI counts; scvi_knn |
| read | var/highly_variable | boolean | genes for expression-based methods |
| read | obs/<batch_key> | categorical | batch label, at least two levels |
| write | obsp/<key>_connectivities | sparse float32, N by N | symmetric fuzzy weights in [0,1] (section 3) |
| write | obsp/<key>_distances | sparse float32, N by N | Euclidean distance of each retained edge |
| write | obsm/<key>_embedding | float32, N by d | corrected space the graph was built from: corrected PCA for mnn and seurat_anchors, integrated embedding for scanorama_knn, latent for scvi_knn, corrected PCs for harmony_knn; absent for bbknn and uncorrected_knn |
| write | uns/<key>_params | record | method, options, degree statistics, device, seed |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "bbknn" | `bbknn`, `mnn`, `seurat_anchors`, `harmony_knn`, `scanorama_knn`, `scvi_knn`, `uncorrected_knn` | Graph method. bbknn (default) draws neighbours from each batch; uncorrected_knn is the baseline with no batch information. |
| `batch_key` | string | "batch" | — | obs column with the batch covariate; at least two levels and no missing values. |
| `key` | string | "batch_knn" | — | Stem of the output members obsp/<key>_connectivities, obsp/<key>_distances, obsm/<key>_embedding and uns/<key>_params. |
| `n_neighbors` | integer | 15 | min 1 | Neighbours per cell for kNN-type methods, self excluded. Ignored by bbknn, which uses options.bbknn.neighbors_within_batch. |
| `matching` | object | — | — | Matching space and features shared by all methods. |
| `matching.use_rep` | string | "X_pca" | — | obsm embedding to match on (cells by dimensions); no missing values. |
| `matching.n_pcs` | integer | 50 | min 1 | Leading dimensions of use_rep used by bbknn, harmony_knn and uncorrected_knn. |
| `matching.n_hvg` | integer | 2000 | min 1 | Highly variable genes used by mnn, seurat_anchors and scanorama_knn. |
| `options` | object | — | — | Method options, one nested object per method family. Only the chosen method's object is read. |
| `options.bbknn` | object | — | — | Options for method bbknn. |
| `options.bbknn.neighbors_within_batch` | integer | 3 | min 1 | Neighbours taken from each batch; 25 is the scIB choice for atlases of at least 1e5 cells. |
| `options.bbknn.trim` | integer/null | null | min 0 | Edges kept per cell by weight; null uses 10 times the total neighbours; 0 disables trimming. |
| `options.bbknn.annoy_n_trees` | integer | 10 | min 1 | Trees in the annoy forest used for per-batch search. |
| `options.bbknn.approx` | boolean | true | — | true uses annoy approximate search; false uses exact brute-force search. |
| `options.mnn` | object | — | — | Options for method mnn (mutual nearest neighbours, expression space). |
| `options.mnn.k` | integer | 20 | min 1 | Neighbours used to find mutual nearest-neighbour pairs between batches. |
| `options.mnn.sigma` | number | 0.1 | > 0 | Gaussian bandwidth smoothing correction vectors, as a fraction of the cosine-normalised radius. |
| `options.mnn.cos_norm` | boolean | true | — | Cosine-normalise expression before pair search and correction. |
| `options.seurat` | object | — | — | Options for method seurat_anchors (CCA reduction only). |
| `options.seurat.dims` | integer | 30 | min 1 | CCA dimensions 1 to dims used to find anchors. |
| `options.seurat.k_anchor` | integer | 5 | min 1 | Neighbours used to pick anchors. |
| `options.seurat.k_filter` | integer/null | 200 | min 1 | Neighbours for anchor filtering; null disables filtering. |
| `options.seurat.k_score` | integer | 30 | min 1 | Neighbours used to score anchors. |
| `options.harmony` | object | — | — | Options for method harmony_knn. |
| `options.harmony.theta` | number | 2 | min 0 | Diversity penalty favouring clusters that contain several batches; 0 disables it. |
| `options.harmony.sigma` | number | 0.1 | > 0 | Entropy penalty on soft cluster assignments. |
| `options.harmony.nclust` | integer/null | null | min 1 | Number of soft clusters; null uses min(round(N/30), 100). |
| `options.harmony.alpha` | number | 0.2 | > 0 | Ridge scale used to estimate lambda when lambda is unset. |
| `options.scanorama` | object | — | — | Options for method scanorama_knn. |
| `options.scanorama.knn` | integer | 20 | min 1 | Neighbours used for approximate mutual matching between batches. |
| `options.scanorama.sigma` | number | 15 | > 0 | Kernel bandwidth of the alignment weights. |
| `options.scanorama.alpha` | number | 0.1 | min 0 | Alignment penalty of the Scanorama matching. |
| `options.scanorama.dimred` | integer | 100 | min 1 | SVD dimensions used by the matching step. |
| `options.scanorama.approx` | boolean | true | — | Use approximate neighbour search in the matching step. |
| `options.scanorama.batch_size` | integer | 5000 | min 1 | Cells per block in the alignment step. |
| `options.scvi` | object | — | — | Options for method scvi_knn (trains a model on counts). |
| `options.scvi.n_latent` | integer | 10 | min 1 | Latent dimension of the posterior mean used for the graph. |
| `options.scvi.n_hidden` | integer | 128 | min 1 | Hidden units per layer. |
| `options.scvi.n_layers` | integer | 1 | min 1 | Hidden layers in encoder and decoder. |
| `options.scvi.dropout_rate` | number | 0.1 | min 0; max 1 | Dropout rate in encoder and decoder. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Random seed for stochastic methods (harmony_knn, scanorama_knn, scvi_knn) and subsampling. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters. The `options` object holds one nested object per method family, and only the object for the chosen method is read; a populated object for any other method is an error. `n_neighbors` applies to kNN-type methods and is ignored by bbknn. `matching.n_pcs` applies to bbknn, harmony_knn and uncorrected_knn; seurat_anchors uses its own CCA dimensions, and scvi_knn uses counts. `matching.n_hvg` applies only to expression-based methods. A missing or single-level batch column, `n_pcs` above the stored width, or an existing output without `overwrite` is an error, and nothing is written.

## 7. MCP tool

Tool name `singlet_neighbors_batch_aware_knn_graph` (definition in `tasks/mcp/singlet_neighbors_batch_aware_knn_graph.json`).

```json
{"dataset": "/data/atlas.singlet", "method": "bbknn", "batch_key": "study", "options": {"bbknn": {"neighbors_within_batch": 3}}}
```

```json
{"dataset": "/data/atlas.singlet", "status": "completed", "wrote": ["obsp/batch_knn_connectivities", "obsp/batch_knn_distances", "uns/batch_knn_params"], "summary": {"method": "bbknn", "n_cells": "<n_cells>", "n_batches": "<n_batches>", "mean_degree": "<mean_degree>", "cross_batch_weight_share": "<share>", "device": "cpu", "seed": 0}, "provenance_id": "prov_0001", "job_id": null}
```

Values in angle brackets are placeholders, not measurements. Long-running: scvi_knn trains a model and may return `queued` with a `job_id`. Stochastic: yes for harmony_knn, scanorama_knn and scvi_knn; the seed is recorded in `uns/<key>_params`. Dry run: `estimate` holds `seconds`, `peak_memory_gb` and `device`, and nothing is written.

## 8. Benchmarks

**Shared protocol.** All methods receive the same cells, the same highly variable genes (in B2, all simulated genes) and, for methods that match on principal components, the same 50 components. Each method uses the defaults of section 4, fixed before any score is read. Each graph is scored as produced. Because degree differs by method, each graph is also compared with uncorrected kNN at the same mean degree. Stochastic methods use seeds 0 to 4 (B1) or 0 to 9 (B2), and results are medians with ranges. Hardware, thread count, precision and the scIB commit (cd67913) are recorded. B1 uses published metric definitions; B2 is proposed.

### B1. Graph mixing and conservation on atlas integration tasks (published metrics)

- **Goal**: score each method's graph for batch mixing and label conservation on the integration tasks defined by scIB [R9].
- **Ground truth**: for conservation, expert cell-type labels from the author annotations, never derived from the graph; for mixing, the batch covariate at the sample or donor level chosen per task from each dataset's metadata. Estimands are as in section 3.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| scIB RNA integration tasks | [R9]; task definitions in the scib repository (section 12) | RNA, atlas scale, per-task sizes — | — | Count, names and accessions not confirmed (section 10) |
| scIB simulated datasets | [R9] | simulated RNA, — | — | Labels are simulated types; count not confirmed (section 10) |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Graph connectivity | GC of section 3 on the directed connectivities, largest strongly connected component per label | maximise | primary | [R9] |
| Graph iLISI | Section 3 LISI over batch labels, neighbourhoods of $k_0=90$ cells by shortest path on the graph; raw and $(\mathrm{LISI}-1)/(B-1)$ | maximise | primary | [R5], [R9] |
| Graph cLISI | Section 3 scaled cLISI over type labels | maximise | guardrail | [R5], [R9] |

- **Comparators**: uncorrected_knn at matched degree; bbknn with neighbors_within_batch 3 and 25; mnn; seurat_anchors; harmony_knn; scanorama_knn; scvi_knn at defaults.
- **Protocol**: the shared protocol; kNN-type methods at `n_neighbors` 15; batch and label columns as given by each dataset.
- **Acceptance criterion** (proposed): across datasets, the median change against uncorrected_knn at matched degree is at least +0.10 in normalised graph iLISI, and no method loses more than 0.02 in graph connectivity or in graph cLISI.
- **Known pitfalls**: iLISI rewards over-mixing, so it is read only with cLISI and connectivity; degree differs by method, so every graph is also scored at matched degree.

### B2. Planted partial-overlap simulation (proposed)

- **Goal**: test whether a graph keeps types apart when one type is absent from one batch, a case annotated atlases cannot isolate.
- **Ground truth**: planted by the generator, so no annotation is needed; labels are used as in section 3.
- **Generator recipe** (design values):
  1. $G=2000$ genes, $K=8$ types, $B=3$ batches, $n_0=400$ cells per present type–batch pair. Type $K$ is absent from batch $B$; types $1$ to $7$ are shared.
  2. $\mu_g\sim\mathcal N(-2,1)$; for each type $k$, a random 10% of genes shift by $\delta_{gk}\sim\mathcal N(0,1)$, giving $\eta_{gk}=\mu_g+\delta_{gk}$.
  3. For each batch, $\beta_{gb}\sim\mathcal N(0,\sigma_\beta^2)$ with $\sigma_\beta\in\{0.2,0.5\}$.
  4. Cell $i$ of type $y_i$ in batch $s_i$ has profile $\pi_{gi}\propto\exp(\eta_{g,y_i}+\beta_{g,s_i})$ over genes, and library size $\ell_i\sim\mathrm{LogNormal}(\log 2000,\,0.3^2)$ drawn independently of batch and type.
  5. $x_{gi}\sim\mathrm{NB}(\mathrm{mean}=\ell_i\pi_{gi},\ \mathrm{dispersion}=0.2)$.
  6. Normalise to $10^4$ counts per cell, apply log1p, and take 50 principal components of scaled genes as the matching space.
  7. Repeat for 10 seeds, redrawing steps 2 to 5.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated RNA from the recipe | generated here | simulated counts; $G=2000$, $K=8$, $B=3$, $n_0=400$ | — | Design values, not literature values |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| $P_{\mathrm{xb}}$ | Section 3 over shared-type cross-batch pairs | maximise | primary | — |
| $F^{(K)}_{B}$ | Section 3 with type $K$ absent from batch $B$ | minimise | primary | — |
| Graph connectivity and iLISI on shared types | GC over types 1 to 7; normalised iLISI over their cells | maximise | guardrail | [R9] |

- **Comparators**: uncorrected_knn at matched degree; bbknn with neighbors_within_batch 3 and 25, each with trim None and 0; harmony_knn; scvi_knn.
- **Protocol**: 10 seeds; identical counts for all methods within a seed.
- **Acceptance criterion** (proposed design choice): the median over seeds satisfies $P_{\mathrm{xb}}\ge 0.9$ on shared types and $F^{(K)}_{B}\le 0.1$. Untrimmed BBKNN with three batches is expected near 0.5 on the second measure (section 3), so the threshold needs trimming or a method that places little weight in the absent batch.
- **Known pitfalls**: simulated batches and types are cleaner than atlases, so results do not transfer directly; step 4 keeps absence from coinciding with depth.

### P1. Performance and scaling

Wall time, peak memory and throughput at $10^4$, $10^5$ and $10^6$ cells, with 2, 5, 10 and 20 batches, on CPU and CUDA, for uncorrected_knn and every method. Data: the B2 generator at each size, with $K=8$ types. Hold fixed: `matching.n_pcs` 50, `matching.n_hvg` 2000, `n_neighbors` 15, seed, threads and hardware. Report search, correction, weighting and trimming time separately. Measured as the median and interquartile range of three repeats after one discarded warm-up call, with build and query stages timed separately. The growth of MNN and anchor cost with batch pairs is tested here.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
- **Feeds**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `integration.integration_quality_scoring`: Integration quality scoring
  - `embedding-viz.local_neighborhood_preservation`: Local neighbourhood preservation of an embedding or reduced representation
- **Reads**: `layers/log1p_norm`, `layers/counts`, `var/highly_variable`, `obsm/<use_rep>`, `obs/<batch_key>`
- **Writes**: `obsp/<key>_connectivities`, `obsp/<key>_distances`, `obsm/<key>_embedding`, `uns/<key>_params`
<!-- CHAINING:AUTO:END -->

This task is the batch-aware branch of the graph workflow: normalisation, highly variable genes, PCA, then this graph, then clustering, embedding and quality scoring. Related but not chained: neighbors.approximate_knn_search and integration.batch_corrected_embedding.

## 10. Risks, pitfalls and open questions

- **Conflicting BBKNN evidence.** The best-practices integration chapter [R15] is reported to rank BBKNN last on a three-sample demonstration, and a secondary summary (not identified) ranks it strong on harder tasks. The local clone of the book (d581689) holds only the chapter metadata and key takeaways, so neither claim is confirmed. A web search snippet confirmed the complex-task ranking of scANVI, Scanorama, scVI and scGen in scIB [R9], but not the simple-task rankings of Harmony and Seurat [R10, R11, R15]. The default therefore rests on B1 and B2, which are not yet measured.
- **Dataset, licence and metric gaps.** scIB task names, accessions and dataset licences were not read, nor were the OpenProblems task datasets or the method lists of Tran et al. [R10] and BatchBench [R11]; those are cited for context, not as benchmarks. The scIB iLISI rescaling and the aggregation of Leiden NMI and ARI were not read, so this document uses the normalisation of section 3 and omits NMI and ARI, whose clusters on the scored graph are circular. The kBET neighbourhood rule differs between the OpenProblems task text and scIB's implementation of the metric of [R12], and kBET is not applied to graphs here.
- **Unverified derivations and missing pins.** The UMAP weight formula [R13] and the Seurat anchor algorithm are stated as in their sources and were not re-derived; the MNN correction kernel and the Harmony objective are described in words only. The Harmony2 preprint could not be identified and is not cited. Defaults for batchelor, Harmony, Seurat and Scanorama are cited by file at clone SHAs a9c93ec, 7e21bd6, 5f67c70 and 4b4ea07. The 40% annotated fraction of the 354M-cell catalogue is a catalogue figure that was not checked against its manifest.
- **Learned route and training data.** The contrastive projection and the edge calibration are proposals and have not been trained. Annotation noise and class imbalance in the catalogue are unquantified, and the study split must be verified to exclude every B1 dataset. scANVI [R8] is not evaluated here.
- **Measured cost and scale.** Complexity beyond the derivation in section 3 is unmeasured. Sharded catalogue-scale construction and its boundary effects are not specified, and the cost of approximate per-batch search is measured only in P1.
- **First experiment.** Before any real data, score B2 with BBKNN at neighbors_within_batch 3 and 25 and trim None and 0. This tests the share $F\approx 1/(B-1)$ and shows how far trimming moves $F$ and $P_{\mathrm{xb}}$. If untrimmed $F$ is near 0.5, trimming becomes the only tuned quantity and the default is revisited.

## 11. References

R1. Polański K, Young MD, Miao Z, et al. BBKNN: fast batch alignment of single cell transcriptomes. *Bioinformatics* 2019. doi:10.1093/bioinformatics/btz625 — verified (corpus)
R2. Haghverdi L, Lun ATL, Morgan MD, Marioni JC. Batch effects in single-cell RNA-sequencing data are corrected by matching mutual nearest neighbors. *Nature Biotechnology* 2018. doi:10.1038/nbt.4091 — verified (corpus)
R3. Stuart T, Butler A, Hoffman P, et al. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R4. Butler A, Hoffman P, Smibert P, et al. Integrating single-cell transcriptomic data across different conditions, technologies, and species. *Nature Biotechnology* 2018. doi:10.1038/nbt.4096 — verified (corpus)
R5. Korsunsky I, Millard N, Fan J, et al. Fast, sensitive and accurate integration of single-cell data with Harmony. *Nature Methods* 2019. doi:10.1038/s41592-019-0619-0 — verified (corpus)
R6. Hie B, Bryson B, Berger B. Efficient integration of heterogeneous single-cell transcriptomes using Scanorama. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0113-3 — verified (corpus)
R7. Lopez R, Regier J, Cole MB, et al. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R8. Xu C, Lopez R, Mehlman E, et al. Probabilistic harmonization and annotation of single-cell transcriptomics data with deep generative models. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209620 — verified (corpus)
R9. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022;19:41-50. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R10. Tran HTN, Ang KS, Chevrier M, et al. A benchmark of batch-effect correction methods for single-cell RNA sequencing data. *Genome Biology* 2020. doi:10.1186/s13059-019-1850-9 — verified (corpus)
R11. Chazarra-Gil R, van Dongen S, Kiselev VY, Hemberg M. Flexible comparison of batch correction methods for single-cell RNA-seq using BatchBench. *Nucleic Acids Research* 2021. doi:10.1093/nar/gkab004 — verified (corpus)
R12. Büttner M, Miao Z, Wolf FA, et al. A test metric for assessing single-cell RNA-seq batch correction. *Nature Methods* 2018. doi:10.1038/s41592-018-0254-1 — verified (corpus)
R13. McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction. *arXiv* 2018. doi:10.48550/arXiv.1802.03426 — verified (corpus)
R14. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R15. Single-cell best-practices book (theislab), integration chapter. Repository theislab/single-cell-best-practices. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/Teichlab/bbknn | Krzysztof Polański, Jongeun Park (pyproject.toml) | MIT (LICENSE; copyright line 2018 The Python Packaging Authority) | Reference implementation and defaults of BBKNN | port |
| https://github.com/scverse/scanpy | scverse; LICENSE copyright holders include F. Alexander Wolf, P. Angerer, Theis Lab | BSD-3-Clause (LICENSE; pyproject.toml) | scanpy.pp.bbknn wrappers (section 4 defaults); uncorrected baseline | callout |
| https://github.com/LTLA/batchelor | Aaron Lun (maintainer), Laleh Haghverdi (DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file at the root) | mnnCorrect defaults and orthogonality assumption | reimplement |
| https://github.com/satijalab/seurat | Rahul Satija (aut, cre) and further contributors (DESCRIPTION) | MIT (DESCRIPTION: MIT + file LICENSE; LICENSE.md, copyright Seurat authors 2021) | CCA anchor defaults | port |
| https://github.com/immunogenomics/harmony | Nikolaos Patikas, Hongcheng Yao, Ilya Korsunsky (maintainer), Martin Hemberg, Nghia Millard, Jean Fan, Kamil Slowikowski, Miles Smith, Soumya Raychaudhuri (DESCRIPTION) | GPL-3 (DESCRIPTION; no LICENSE file at the root) | Harmony defaults | reimplement |
| https://github.com/brianhie/scanorama | Brian Hie (LICENSE copyright 2018) | MIT (LICENSE) | Scanorama defaults | port |
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml) | BSD-3-Clause (LICENSE; copyright Yosef Lab, Weizmann Institute of Science) | scVI architecture and defaults | port |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt; pyproject.toml) | Metric definitions (graph connectivity, LISI variant) and scIB batch-split defaults | callout |
| https://github.com/openproblems-bio/task_batch_integration | OpenProblems project | MIT (LICENSE) | BBKNN method configuration; comparator list | callout |
| https://github.com/theislab/single-cell-best-practices | Chapter authors as listed in the book | Apache-2.0 (LICENSE; copyright 2021 Theislab) | Context for batch covariate guidance and the chapter's key takeaways | callout |
