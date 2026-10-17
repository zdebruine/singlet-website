---
id: multimodal.paired_joint_embedding
title: Paired joint embedding of RNA with a second or third modality
area: multimodal
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [qc.low_quality_cell_detection, normalization.size_factor_estimation, feature-selection.highly_variable_gene_selection, multimodal.adt_background_removal_normalization]
feeds: [integration.integration_quality_scoring, clustering.cell_partitioning, evaluation.overcorrection_detection, reference-mapping.query_embedding_projection]
reads: [layers/counts, X, obs/<batch_key>, obs/<cell_type_key>]
writes: [obsm/joint_<method>, obsm/joint_<method>_var, obsm/wnn_modality_weight, obsp/wknn, obsp/wsnn, obs/joint_cluster_<method>_<res>, models/joint_<method>, uns/joint_embedding_metrics_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_multimodal_paired_joint_embedding
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Paired joint embedding of RNA with a second or third modality

> Combine RNA with the paired ADT or ATAC measurement of the same cells into one per-cell representation, either a weighted neighbour graph (WNN) or a fitted latent model (totalVI, MultiVI, MOFA+), and score it against single-modality embeddings on the same cells for cell-type conservation and batch removal.

## 1. Question

Given paired measurements of the same cells (RNA with ADT, RNA with ATAC peaks, or RNA with ATAC and ADT) and recorded batch labels, which single per-cell representation preserves cell-type structure and removes batch effects better than the best single modality? The output is a cells-by-$k$ latent matrix (`obsm/joint_<method>`) or, for the heuristic WNN method, a weighted kNN and SNN graph with per-cell modality weights. No latent state is observed, so correctness is defined through proxies: conservation of author cell-type annotations and removal of the recorded batch, scored with identical definitions for every method (section 8). A representation that mixes batches by erasing cell types is not correct, so both criteria are always reported together.

## 2. Why this task matters and where the field stands

Paired assays measure two molecular layers in one cell: CITE-seq adds surface proteins through antibody-derived tags (ADT), 10x Multiome adds chromatin accessibility, and TEA-seq measures all three [R14]. Analysts need one embedding, graph or clustering that uses all layers.

Two families exist [R1]. Heuristic graph fusion merges per-modality neighbour graphs with per-cell weights: Seurat's weighted nearest neighbours (WNN) [R8], also in muon [R16]. Model-based methods fit an explicit objective: the linear factor model MOFA+ [R9], the variational autoencoders totalVI [R10] and MultiVI [R11], Cobolt [R12] and scMoMaT [R13]. Mosaic designs belong to MIDAS [R18] and `multimodal.mosaic_integration`; unpaired alignment with feature-guidance graphs such as GLUE [R22] to `multimodal.unpaired_cross_modal_alignment`.

The status is **contested**. The best-practices chapter [R1] analyses the NeurIPS 2021 BMMC CITE-seq and Multiome data [R2][R3] once: WNN separates lineages but splits cells of one type by donor when its inputs are not batch-corrected; totalVI mixes donors and scores best overall on CITE-seq, mainly through batch removal; MultiVI mixes batches better than either modality on Multiome, a modest gain because RNA already separates the types. The chapter summarises three 2024 to 2025 benchmarks [R4][R5][R6] as agreeing that no method is best for every dataset, with WNN at or near the top for CITE-seq and Multiome and totalVI among the best for CITE-seq across batches.

Open problems: (1) WNN combines uncorrected graphs and has no principled batch-aware weighting [R1]; (2) it returns a graph, so embedding metrics (silhouette, BRAS) do not apply directly [R19]; (3) silhouette-based batch scores can reward embeddings that do not remove batch effects [R7]; (4) the effect of binarised-peak versus fragment-count ATAC modelling [R15] on joint geometry is unknown; (5) background ADT binding can mimic lineage structure, which totalVI models [R10] and WNN does not.

## 3. Theory and insight

WNN returns a weighted graph from local predictive kernels; the model-based methods return a posterior or point estimate of a shared latent variable.

### 3.1 Heuristic graph fusion: WNN

Notation (Seurat's code): $e_{i,m}$ is the L2-normalised PCA or LSI embedding of cell $i$ in modality $m$, $N_m(i)$ its $k_{\mathrm{nn}}$ nearest neighbours in $m$ (self included), $r_{i,m}$ the distance to its nearest other neighbour, $\epsilon=10^{-4}$, $(u)_+=\max(u,0)$. Let $\hat e^{\mathrm w}_{i,m}$ be the mean of $e_{\cdot,m}$ over $N_m(i)$ and $\hat e^{\mathrm x}_{i,m\leftarrow m'}$ its mean over $N_{m'}(i)$. Then

$$
d^{\mathrm w}_{i,m}=\bigl(\lVert e_{i,m}-\hat e^{\mathrm w}_{i,m}\rVert-r_{i,m}\bigr)_+,\qquad
d^{\mathrm x}_{i,m,m'}=\bigl(\lVert e_{i,m}-\hat e^{\mathrm x}_{i,m\leftarrow m'}\rVert-r_{i,m}\bigr)_+,
$$
$$
S_{i,m,m'}=\min\!\Bigl(200,\frac{e^{-d^{\mathrm w}_{i,m}/\sigma_{i,m}}}{e^{-d^{\mathrm x}_{i,m,m'}/\sigma_{i,m}}+\epsilon}\Bigr),\qquad
w_{i,m}=\frac{\sum_{m'\neq m}e^{S_{i,m,m'}}}{\sum_{a}\sum_{b\neq a}e^{S_{i,a,b}}}.
$$

By default $\sigma_{i,m}$ is `sd_scale` times the mean of the $k_{\mathrm{nn}}$ largest offset distances among the cells with the smallest non-zero SNN weights of $i$ (`snn.far.nn`). For $M=2$, $w_{i,1}/w_{i,2}=e^{S_{i,1,2}-S_{i,2,1}}$: one score unit changes the ratio by $e$ and five units by about 148, so weights are nearly winner-take-all when scores differ by several units. Candidates are the union of each modality's `knn_range` neighbours (self excluded), ranked by

$$
\tilde s_{ij}=\sum_{m=1}^{M} w_{i,m}\exp\!\bigl(-(d^{(m)}_{ij}-r_{i,m})_+/\sigma_{i,m}\bigr);
$$

the top $k_{\mathrm{nn}}$ form the kNN graph (symmetrised by union) and their Jaccard-pruned shared-neighbour graph is the SNN graph. Regime: heuristic with no likelihood; it assumes that neighbours in one modality predict a cell in the other and inherits donor structure from uncorrected inputs.

### 3.2 Model-based latent variable models

**MOFA+** is a linear multi-view factor model, $\mathbf Y^{(m)}=\mathbf Z\mathbf W^{(m)\top}+\mathbf E^{(m)}$, with $Z_{nk}\sim\mathcal N(0,1)$ and $W^{(m)}_{gk}\sim\mathcal N(0,1/\alpha^{(m)}_k)$; the automatic-relevance-determination (ARD) precision $\alpha^{(m)}_k$ switches factors off per view. Regime: Gaussian residuals (code default) and linear structure only.

**totalVI** is an amortised VAE: $x_{gn}\sim\mathrm{NB}(\ell_n\rho_g(\mathbf z_n,b_n),\theta_g)$ with library size $\ell_n$, decoder frequency $\rho_g$, batch covariate $b_n$ and $\mathbf z_n\sim\mathcal N(0,I_k)$; protein counts follow a two-component negative-binomial mixture with decoder-given background mean, a larger foreground mean and a mixing probability. The objective is the evidence lower bound

$$
\mathcal L=\mathbb E_{q_\phi(\mathbf z\mid x,y,b)}\bigl[\log p_\theta(x,y\mid\mathbf z,b)\bigr]-\mathrm{KL}\bigl(q_\phi(\mathbf z\mid x,y,b)\,\Vert\,\mathcal N(0,I_k)\bigr)\le\log p_\theta(x,y\mid b).
$$

Regime: the bound holds for any $q_\phi$ and is tight only at the true posterior; under uniform cell subsampling the mini-batch gradient is unbiased.

**MultiVI** has modality-specific encoders and decoders, a shared latent and a Jeffreys alignment penalty; the RNA likelihood defaults to zero-inflated negative binomial. A cell lacks a modality when its count row for it sums to zero; its reconstruction and penalty terms are then masked, so a paired cell with a zero-count profile is treated as unpaired.

### 3.3 Assumptions and failure modes

- **Pairing.** Barcode mispairing and modality-specific states pull cells apart.
- **Batch.** WNN and MOFA+ have no batch term and need corrected inputs or groups; totalVI and MultiVI take batch as a decoder covariate.
- **Likelihood and missingness.** A misspecified likelihood is absorbed by the latent space; totalVI treats proteins zero in a whole batch as missing, and silent zeros elsewhere bias the joint space.
- **Circularity.** Labels used in weighting or resolution inflate label-based metrics.

### 3.4 Why the heuristic works and what a model adds

WNN works where local neighbourhoods are informative in each modality, needs no training and is the standard baseline [R1]. It has no likelihood, so no calibrated uncertainty or reusable generative model, and does not model library size, protein background or batch. A model adds a likelihood per modality, batch removal in the decoder, a per-cell posterior and a fitted model for reference mapping (`reference-mapping.query_embedding_projection`), at the cost of training. Section 8 tests conservation and batch removal, not posterior calibration.

### 3.5 Estimands and metric definitions

The joint latent $\mathbf z_i$ is the posterior mean (VAEs) or factor mean (MOFA+), unit-free with arbitrary scale, so only distances within one embedding are compared; `_var` is its posterior variance per dimension; $w_{i,m}$ is a per-cell modality weight with $\sum_m w_{i,m}=1$, a diagnostic only. Ground truth is the author cell-type label and recorded batch (donor) of each cell, categorical and unnormalised. The metrics below (scib-metrics; higher is better; all in [0, 1]) score an embedding or its kNN graph. The batch silhouette is computed within each label group: $s_i=(b_i-a_i)/\max(a_i,b_i)$ with $a_i$ the mean distance to other cells of the same batch and $b_i$ the mean distance to cells of other batches (`mean_other`, BRAS) or of the nearest other batch (`nearest`, batch ASW); the score $1-\lvert s_i\rvert$ is averaged within groups, then over groups, skipping groups with one batch or one cell per batch. Regime: fixed embedding and distance; BRAS defaults to cosine and batch ASW to Euclidean, which differ on one embedding.

| Metric | Definition |
|---|---|
| label ASW | $(\bar s+1)/2$, $\bar s$ the mean cell-type silhouette (Euclidean) |
| NMI, ARI | labels $L$ versus Leiden clusters $K$ on the kNN graph at the resolution in $\{0.2,\dots,2.0\}$ maximising NMI; $\mathrm{NMI}=I(L;K)/\tfrac12(H(L)+H(K))$, ARI the adjusted Rand index |
| cLISI | $(C-\mathrm{med}_i\,\mathrm{LISI}^{\mathrm{label}}_i)/(C-1)$, $C$ labels, perplexity $\lfloor k/3\rfloor$ |
| BRAS | batch silhouette above with `mean_other` and cosine distance |
| iLISI | $(\mathrm{med}_i\,\mathrm{LISI}^{\mathrm{batch}}_i-1)/(B-1)$, $B$ batches |
| kBET | per label, $\chi^2$-test acceptance rate (level 0.05) of local batch composition on diffusion neighbours, $k_0=\min(70,\max(10,\lfloor\bar n_{\mathrm{batch}}/4\rfloor))$; a label scores 0 if under 75% of its cells lie in components of at least $3k_0$ cells; labels with one batch or under 10 cells are skipped |
| graph connectivity | mean over labels of the largest connected component's share of the label's kNN subgraph |

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| WNN (Seurat) | heuristic | Per-cell modality weights from within- versus cross-modality neighbour prediction; weighted kernel sum over the union of modality neighbourhoods gives one kNN and one SNN graph | [R8] |
| WNN (muon `pp.neighbors`) | heuristic | The same method on MuData; kernel width from the mean distance to `n_bandwidth_neighbors` neighbours; close to Seurat only for L2-normalised inputs | [R16] |
| MOFA+ (MOFA2) | model-based | Multi-view linear factor model with ARD sparsity; variational inference; Gaussian likelihood by default | [R9] |
| totalVI | model-based | VAE with negative-binomial RNA, background and foreground protein mixture, batch as covariate | [R10] |
| MultiVI | model-based | VAE with modality-specific coders, shared latent and Jeffreys alignment penalty; modalities masked per cell | [R11] |
| Cobolt | model-based | Multimodal VAE with one latent space shared by joint-modality and single-omic cells | [R12] |
| scMoMaT | model-based | Matrix tri-factorisation for mosaic integration with biomarker detection | [R13] |
| Concatenated PCA or LSI | heuristic | Scaled per-modality embeddings concatenated; the cheapest baseline a joint method should beat | — |

WNN is the published heuristic standard; the best-practices chapter calls it a strong baseline for CITE-seq and Multiome data and notes that totalVI and MultiVI additionally model raw counts and batch effects [R1]. MOFA+ is the linear model-based reference. Cobolt and scMoMaT are comparators; reference mapping of query cells to a fitted totalVI model uses architectural surgery [R17].

Exact defaults of the methods singlet implements:

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| WNN (Seurat) | `k.nn`; `l2.norm` | 20; TRUE | R/clustering.R:49-50 @5f67c70 (satijalab/seurat) |
| WNN (Seurat) | `knn.range`; `prune.SNN`; `sd.scale` | 200; 1/15; 1 | R/clustering.R:55-57 @5f67c70 |
| WNN (Seurat) | `cross.contant.list` ($\epsilon$); `smooth` | 1e-4; FALSE | R/clustering.R:64-65, 59 @5f67c70 |
| WNN (Seurat) | `snn.far.nn`; `s.nn` | TRUE; `k.nn` | R/clustering.R:1234-1235 @5f67c70 |
| WNN (Seurat) | `sigma.idx` (used only if `snn.far.nn` is FALSE) | `k.nn` | R/clustering.R:1241 @5f67c70 |
| WNN (Seurat) | kernel width under `snn.far.nn` | mean of the `k.nn` largest offset distances among the cells with smallest non-zero SNN weight (ties kept), times `sd.scale` | src/snn.cpp:198-249 @5f67c70 |
| WNN (Seurat) | score clip; `kernel.power` | [0, 200]; 1 | R/clustering.R:1453; 1591 @5f67c70 |
| WNN (muon) | `n_neighbors`; `n_bandwidth_neighbors`; `n_multineighbors` | None (mean of the per-modality values); 20; 200 | src/muon/pp.py:260-262 @7e65510 (scverse/muon) |
| MOFA+ | `maxiter`; `convergence_mode` | 1000; 'fast' | R/prepare_mofa.R:284-285 @4a102f2 (bioFAM/MOFA2) |
| MOFA+ | `num_factors` | 10, then by total cells N: 5 if N ≤ 25; 15 if N ≤ 1e3; 20 if N ≤ 1e4; 25 above | R/prepare_mofa.R:426, 435-443 @4a102f2 |
| MOFA+ | `ard_weights`; `ard_factors` | TRUE; FALSE, TRUE when more than one group | R/prepare_mofa.R:430, 429, 445-446 @4a102f2 |
| MOFA+ | `spikeslab_weights`; `spikeslab_factors`; likelihood per view | FALSE; FALSE; gaussian | R/prepare_mofa.R:428, 427, 420 @4a102f2 |
| totalVI | `n_latent` | 20 | src/scvi/model/_totalvi.py:138 @5555ecc (scverse/scvi-tools) |
| totalVI | `gene_dispersion`; `protein_dispersion` | 'gene'; 'protein' | src/scvi/model/_totalvi.py:139-140 @5555ecc |
| totalVI | `gene_likelihood`; `latent_distribution` | 'nb'; 'normal' | src/scvi/model/_totalvi.py:141-142 @5555ecc |
| totalVI | `empirical_protein_background_prior`; `override_missing_proteins` | None; False | src/scvi/model/_totalvi.py:143-144 @5555ecc |
| totalVI | proteins all-zero in a batch | treated as missing, adversarial classifier on, unless overridden | src/scvi/model/_totalvi.py:153-164 @5555ecc |
| MultiVI | `modality_weights`; `modality_penalty` | 'equal'; 'Jeffreys' | src/scvi/model/_multivi.py:147-148 @5555ecc |
| MultiVI | `n_layers_encoder`; `n_layers_decoder`; `dropout_rate` | 2; 2; 0.1 | src/scvi/model/_multivi.py:151-153 @5555ecc |
| MultiVI | `gene_likelihood`; `dispersion` | 'zinb'; 'gene' | src/scvi/model/_multivi.py:155-156 @5555ecc |
| MultiVI | `use_batch_norm`; `use_layer_norm` | 'none'; 'both' | src/scvi/model/_multivi.py:157-158 @5555ecc |
| MultiVI | `n_hidden` when None | min(128, int(sqrt(regions))), or genes if there are no regions | src/scvi/module/_multivae.py:313-317 @5555ecc |
| MultiVI | `n_latent` when None | int(sqrt(`n_hidden`)) | src/scvi/module/_multivae.py:325 @5555ecc |
| MultiVI | modality present in a cell | count row sum > 0 | src/scvi/module/_multivae.py:602-604, 817-819 @5555ecc |

Where the MOFA2 documentation and code disagree, the code values are the specification; the chapter fitted 20 factors with batches as groups [R1].

## 5. Proposed singlet approach

- **Routes** (licences in section 12). Port WNN (`FindModalityWeights`, `MultiModalNN`) as sparse kernels in the C++ core; port totalVI and MultiVI as PyTorch modules, with the protein mixture and masking taken from the code; reimplement MOFA+ from the papers [R9]. Cobolt, scMoMaT and muon are comparators only. The concatenated baseline is new.
- **Model-based formulation.** One shared probabilistic encoder $q_\phi(\mathbf z\mid x,y,a,b)$ over RNA counts $x$, protein counts $y$ and ATAC counts $a$, with a decoder per modality (negative binomial, protein mixture, ATAC likelihood fixed by B2) and random modality masking during training so that one network embeds cells with one, two or three modalities. Outputs are the posterior mean and variance. WNN weights are reported as a diagnostic only. The formulation is proposed and untested; it is falsified if (1) it misses the B1 or B2 criteria against the best single modality, (2) its batch composite does not exceed that of the batch-corrected RNA-only embedding from `integration.batch_corrected_embedding`, or (3) masked pretraining does not beat training from scratch on the same paired subset.
- **Trained resources.** The shared encoder is pretrained self-supervised on paired catalogue cells; annotated cells are held out for scoring.
- **ML stack.** PyTorch for the amortised VAEs. Hard-coded CUDA and cuSPARSE for the small hot operations: per-modality approximate kNN (shared with `neighbors.approximate_knn_search`), WNN kernels, scores and top-$k$ on fixed candidate lists, and the MOFA+ matrix updates.
- **Devices and streaming.** VAEs train on mini-batches on CPU or CUDA. The WNN graph is built in cell chunks and keeps $k_{\mathrm{nn}}$ edges per cell, so memory is $O(n\,k_{\mathrm{nn}})$; an embedding costs $4nk$ bytes (80 MB at $n=10^6$, $k=20$). MOFA+ is full-batch for small $n$.
- **Defaults an agent uses without asking.** `method` `auto` (totalVI for RNA with ADT, MultiVI for RNA with ATAC with or without ADT, WNN when raw counts of the second modality are absent), `n_latent` 20 (also the MOFA+ factor count), WNN options at the section 4 values, `seed` 0, `device` `auto`. Use `dry_run` first on atlas-scale inputs. Without `batch_key` the VAEs fit one batch and batch metrics are skipped.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts (RNA) | sparse int | raw UMI counts of the highly variable genes chosen upstream |
| read | layers/counts (protein) | sparse int | raw ADT counts; required by `totalvi` and `multivi` |
| read | X (protein) | float32 | normalised ADT matrix from the upstream ADT task; used by WNN and the ADT comparator when `uns/adt_normalization` records CLR, otherwise CLR is computed here |
| read | layers/counts (ATAC) | sparse int | peak or fragment counts; TF-IDF and LSI (first component dropped) are computed here |
| read | obs/`batch_key` | categorical | batch or donor per cell; covariate for `totalvi` and `multivi`, groups for `mofa`, required for batch metrics |
| read | obs/`cell_type_key` | categorical | author annotation; scoring only, never fitting |
| write | obsm/joint_`method` | float32, cells by $k$ | joint latent ($k$ = `n_latent`); not written for `wnn` |
| write | obsm/joint_`method`_var | float32, cells by $k$ | posterior variance per latent dimension; `totalvi` and `multivi` only |
| write | obsm/wnn_modality_weight | float32, cells by $M$ | weights $w_{i,m}$, rows sum to one; `wnn` only |
| write | obsp/wknn, obsp/wsnn | sparse, cells by cells | WNN kNN graph ($k_{\mathrm{nn}}$ edges per cell before symmetrisation) and Jaccard-pruned SNN graph; `wnn` only |
| write | obs/joint_cluster_`method`_`res` | categorical | Leiden clusters at the resolution that maximised NMI (B1); written when scoring is on |
| write | models/joint_`method` | model file | fitted VAE weights or MOFA+ parameters; not written for `wnn` |
| write | uns/joint_embedding_metrics_`method` | dict | metric values, composites, kBET labels scored zero, chosen resolution, seeds, parameters, software versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle holding the paired modalities. |
| `method` | string | "auto" | `auto`, `wnn`, `mofa`, `totalvi`, `multivi` | Joint method. auto picks totalvi for RNA with ADT, multivi for RNA with ATAC, wnn without raw second-modality counts; resolved name returned. |
| `modalities` | string | "auto" | `auto`, `rna+adt`, `rna+atac`, `rna+atac+adt` | Paired modalities to use; auto infers them from the layers present. totalvi accepts rna+adt only. |
| `batch_key` | string/null | null | — | obs column with batch labels; covariate for totalvi and multivi, groups for mofa, required for batch metrics. |
| `cell_type_key` | string/null | null | — | obs column with author annotations; used only for scoring, never for fitting; required for conservation metrics. |
| `n_latent` | integer | 20 | min 1 | Latent dimension for totalvi and multivi, factor count for mofa, spectral embedding size when scoring wnn. |
| `wnn` | object | — | — | Options for method wnn only. |
| `wnn.k_nn` | integer | 20 | min 2 | Neighbours per cell in the WNN graph. |
| `wnn.knn_range` | integer | 200 | min 2 | Candidate neighbours per modality before top-k selection; at least k_nn. |
| `wnn.prune_snn` | number | 0.0666666667 | min 0; max 1 | Jaccard cutoff for pruning SNN edges (1/15). |
| `wnn.sd_scale` | number | 1.0 | > 0 | Scale of the per-cell kernel bandwidth. |
| `wnn.modality_weights_out` | boolean | true | — | Write per-cell modality weights to obsm/wnn_modality_weight. |
| `totalvi` | object | — | — | Options for method totalvi only. |
| `totalvi.override_missing_proteins` | boolean | false | — | If true, proteins zero in every cell of a batch are observed zeros; if false they are treated as missing. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | min 0 | Random seed for initialisation, sampling and Leiden clustering. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Cross-parameter rules. `totalvi` accepts `rna+adt` only; `multivi` accepts `rna+atac` and `rna+atac+adt`; `wnn` and `mofa` accept every modality present. `n_latent` is the latent dimension for `totalvi` and `multivi`, the factor count for `mofa`, and the spectral-embedding size used for scoring `wnn`. The `wnn` object applies to `wnn` only and `totalvi.override_missing_proteins` to `totalvi` only; `knn_range` must be at least `k_nn`. Metrics are skipped for a null `batch_key` (batch metrics) or `cell_type_key` (conservation metrics) and the summary says so. A `modalities` value that does not match the layers present is refused before any computation.

## 7. MCP tool

Tool name `singlet_multimodal_paired_joint_embedding` (definition in `tasks/mcp/singlet_multimodal_paired_joint_embedding.json`).

```json
{"dataset": "/path/to/bmmc_cite.singlet", "method": "totalvi", "batch_key": "batch", "cell_type_key": "cell_type", "seed": 0}
```

```json
{
  "dataset": "/path/to/bmmc_cite.singlet", "status": "completed",
  "wrote": ["obsm/joint_totalvi", "obsm/joint_totalvi_var", "models/joint_totalvi", "obs/joint_cluster_totalvi_<res>", "uns/joint_embedding_metrics_totalvi"],
  "summary": {"method": "totalvi", "modalities": "rna+adt", "n_cells": "<int>", "n_latent": 20, "bio_composite": "<0..1>", "batch_composite": "<0..1>"},
  "provenance_id": "<id>", "job_id": null, "estimate": null
}
```

- **Long-running**: yes; VAE fits on large inputs return `queued` with a `job_id`.
- **Stochastic**: yes (VAE and MOFA+ initialisation, Leiden); controlled by `seed`.
- **Dry run**: returns seconds, peak memory in GB and device from $n$, feature counts, $k$ and the hidden width, without fitting.

## 8. Benchmarks

Shared protocol. Scoring follows scIB [R19] as implemented in scib-metrics (section 3.5). Graph outputs (WNN) are converted to the first 20 non-trivial eigenvectors of the normalised Laplacian of the SNN graph's largest connected component, with the fraction of cells outside it reported. Neighbour-graph metrics use $k=90$ on the embedding (the largest of the Benchmarker sizes 15, 50, 90). Bio composite = mean of label ASW, NMI, ARI and cLISI; batch composite = mean of BRAS, iLISI, kBET and graph connectivity; total = 0.6 bio + 0.4 batch (the scIB weighting). Composites are fixed before scoring and labels never enter fitting. Stochastic methods use seeds 0, 1, 2; report the median and the seed standard deviation.

### B1. Paired RNA with ADT on the NeurIPS 2021 BMMC CITE-seq data

- **Goal**: does a joint representation conserve cell types and remove donor effects better than the best single-modality embedding?
- **Ground truth**: expert labels, the per-cell `cell_type` annotation and `batch` (donor) of the dataset; categorical, no normalisation.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| NeurIPS 2021 BMMC CITE-seq, site 1 | [R3]; subset as in [R1] | bone marrow mononuclear cells; 16,311 cells (donors 5,227, 4,978, 6,106), 13,953 genes, 134 proteins; species — | — | three batches |

| Metric | Definition (exact form in section 3.5) | Direction | Role | Reference |
|---|---|---|---|---|
| label ASW | rescaled cell-type silhouette | higher | bio | [R19] |
| NMI, ARI | label versus Leiden-cluster agreement | higher | bio | [R19] |
| cLISI | rescaled label mixing in kNN neighbourhoods | higher | bio | [R21][R19] |
| BRAS | batch silhouette within labels, cosine | higher | batch | [R7] |
| iLISI | rescaled batch mixing in kNN neighbourhoods | higher | batch | [R21][R19] |
| kBET | per-label batch-composition test | higher | batch | [R20][R19] |
| graph connectivity | connectedness of label subgraphs | higher | batch | [R19] |

- **Comparators**: RNA PCA (shifted logarithm, 4,000 batch-aware highly variable genes); ADT PCA (CLR, 30 components); concatenated PCA; WNN (Seurat, muon); MOFA+ (20 factors, batch as groups); totalVI (defaults); the batch-corrected RNA-only embedding of `integration.batch_corrected_embedding`. One Leiden resolution grid for all methods; the selected resolution is recorded.
- **Acceptance criterion** (proposed, not from the literature): on the median of three seeds with seed standard deviation at most 0.01, the best joint method has batch composite at least that of RNA PCA plus 0.05 and bio composite at least the best single-modality bio composite minus 0.01. Differences to WNN and totalVI are reported alongside.
- **Known pitfalls**: the uncorrected RNA baseline is a low bar (the batch-corrected RNA-only comparator is stronger); three donors of one site say nothing about site mixing.

### B2. Paired RNA with ATAC on the NeurIPS 2021 BMMC Multiome data

- **Goal**: as B1 for RNA with chromatin accessibility, which also fixes the ATAC likelihood of the proposed model.
- **Ground truth**: expert labels, as B1 (`cell_type`, `batch`).

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| NeurIPS 2021 BMMC Multiome, site 1 | [R3]; subset as in the chapter [R1] | RNA with ATAC peaks; cells —, genes —, peaks —; species — | — | ATAC: TF-IDF then LSI with the first component dropped |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| bio composite | mean of label ASW, NMI, ARI, cLISI as in B1 | higher | primary | [R19] |
| batch composite | mean of BRAS, iLISI, kBET, graph connectivity as in B1 | higher | primary | [R19][R7] |

- **Comparators**: RNA PCA; ATAC LSI; concatenated PCA and LSI; WNN (Seurat, muon); MOFA+; MultiVI (defaults, batch key); the batch-corrected RNA-only embedding. Binarised and fragment-count ATAC inputs [R15] are compared for MultiVI.
- **Acceptance criterion** (proposed): the B1 criterion on the Multiome subset.
- **Known pitfalls**: cell types are already well separated in the RNA of this dataset, so the gain from ATAC is expected to be modest [R1]; compare batch composites before concluding.

### B3. Batch-metric validity under planted shifts (proposed)

- **Goal**: check that BRAS falls monotonically with a known batch offset and that batch ASW does or does not, following the critique of silhouette [R7].
- **Ground truth**: planted simulation. A known offset of size $\delta$ is added to an already mixed embedding, so the true degree of batch effect is known by construction; labels come from B1.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted shifts of the B1 totalVI latent | generator below | 16,311 cells, $k=20$, 3 batches | — | proposed |

1. Take $E\in\mathbb R^{n\times 20}$ (totalVI latent of B1), labels $c_i$, batches $b_i$.
2. Form the between-label scatter $S_B=\sum_c n_c(\mu_c-\bar\mu)(\mu_c-\bar\mu)^\top$ and let $U$ be the span of its 5 eigenvectors with smallest eigenvalues (the directions of least cell-type signal; exactly orthogonal to the label means only if the number of labels minus one is at most 15).
3. For each batch $\beta$ draw $g_\beta\sim\mathcal N(0,I)$, project onto $U$, normalise to unit length to give $v_\beta$.
4. Let $\sigma_w$ be the root-mean-square distance of cells to their label centroid.
5. For $\delta\in\{0,0.5,1,2\}$ set $E^{(\delta)}_i=E_i+\delta\,\sigma_w\,v_{b_i}$; repeat with seeds 0 to 9.

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| BRAS response | BRAS (section 3.5) at each $\delta$; strict monotone fall; drop $\mathrm{BRAS}(0)-\mathrm{BRAS}(2)$ | falls with $\delta$ | primary | [R7] |
| batch ASW, iLISI, kBET response | same summaries, B1 definitions | falls with $\delta$ | reported | [R19] |

- **Comparators**: batch ASW (Euclidean, `nearest`), iLISI and kBET on the same planted embeddings.
- **Acceptance criterion** (proposed): BRAS falls strictly across the four levels in at least 9 of 10 draws and the mean drop $\mathrm{BRAS}(0)-\mathrm{BRAS}(2)$ is at least 0.2; other metrics are reported without threshold.
- **Known pitfalls**: fix the distance before comparing metrics; the sign convention (higher BRAS means better mixing) is that of scib-metrics 0.6.1 and must be rechecked against the pinned version.

### P1. Performance and scaling

Wall time, peak memory and cells per second for each paired method at $10^4$, $10^5$ and $10^6$ cells (design scales; $10^6$ only where it fits in memory), RNA with ADT and RNA with ATAC, on CPU and CUDA reported separately. Hold fixed: latent dimension 20, feature counts, batches, seed, thread count; report VAE epochs and MOFA+ iterations separately. Comparators: Seurat WNN (R), muon WNN, MOFA2, totalVI and MultiVI (scvi-tools). Acceptance (proposed): singlet WNN at $10^5$ cells takes at most half the Seurat WNN time on the same CPU, and CUDA totalVI-style training is at least 5 times faster than CPU at $10^5$ cells. Log `knn_range` and thread counts; memory peaks depend on both.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `multimodal.adt_background_removal_normalization`: ADT background removal and normalization
- **Feeds**:
  - `integration.integration_quality_scoring`: Integration quality scoring
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `evaluation.overcorrection_detection`: Over-correction after batch or covariate removal
  - `reference-mapping.query_embedding_projection`: Query embedding into a frozen reference
- **Reads**: `layers/counts`, `X`, `obs/<batch_key>`, `obs/<cell_type_key>`
- **Writes**: `obsm/joint_<method>`, `obsm/joint_<method>_var`, `obsm/wnn_modality_weight`, `obsp/wknn`, `obsp/wsnn`, `obs/joint_cluster_<method>_<res>`, `models/joint_<method>`, `uns/joint_embedding_metrics_<method>`
<!-- CHAINING:AUTO:END -->

The task follows counting, cell calling, quality control and ADT normalisation in the CITE-seq and Multiome sequence; ATAC TF-IDF and LSI have no separate task and are done here. Related: `multimodal.mosaic_integration`, `multimodal.unpaired_cross_modal_alignment`.

## 10. Risks, pitfalls and open questions

- **Dataset records.** The licence of the BMMC challenge data, its species, the Multiome cell, gene and peak counts, and the number of `cell_type` categories are not in the local record; the annotation column used must be logged because NMI and ARI depend on its granularity. The challenge's own joint-embedding metric formulas were not read, so B1 uses scib-metrics definitions (OpenProblems pins scib-metrics 0.5.5, this document reads 0.6.1).
- **Published rankings.** The datasets and per-method scores of the three 2024 to 2025 benchmarks [R4][R5][R6] are known only through the chapter's summary [R1]; a rank-agreement check of singlet's re-implementations (Kendall $\tau_b$ per metric and modality pair) is deferred until those papers are read.
- **WNN parity.** Seurat and muon use different kernel widths, so parity of singlet WNN with either, on identical L2-normalised inputs, is untested. Cobolt and scMoMaT were read only at README level, and their records lack authors and venue.
- **Untested model claims.** Posterior-variance calibration, the effect of MultiVI's zero-row masking on truly paired zero-depth cells, and binarised versus fragment-count ATAC are not benchmarked; the B3 thresholds are untested. Protein imputation is out of scope (`multimodal.protein_imputation_from_rna`).
- **Paired catalogue cells.** The number of paired multimodal cells among singlet's 354M cells, and their data licences, are unknown; the pretraining corpus cannot be fixed before they are counted.
- **First experiment.** Fit totalVI and WNN on the B1 subset with one seed and check that the chapter's qualitative result (WNN splits donors, totalVI mixes them) holds under the B1 metrics before running the full seed set.

## 11. References

R1. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R2. Lance C, Luecken MD, Burkhardt DB, et al. Multimodal single cell data integration challenge: results and lessons learned. *Proceedings of the NeurIPS 2021 Competitions and Demonstrations Track* 2022. (preprint) doi:10.1101/2022.04.11.487796 — verified (corpus)
R3. Luecken MD, Burkhardt DB, Cannoodt R, et al. A sandbox for prediction and integration of DNA, RNA, and proteins in single cells. *NeurIPS 2021 Datasets and Benchmarks Track* 2021. https://openreview.net/forum?id=gN35BGa1Rt — verified (corpus)
R4. Hu Y, Wan S, Luo Y, et al. Benchmarking algorithms for single-cell multi-omics prediction and integration. *Nature Methods* 2024. doi:10.1038/s41592-024-02429-w — verified (corpus)
R5. Fu S, Wang S, Si D, Li G, Gao Y, Liu Q. Benchmarking single-cell multi-modal data integrations. *Nature Methods* 2025. doi:10.1038/s41592-025-02737-9 — verified (corpus)
R6. Liu C, Ding S, Kim HJ, et al. Multitask benchmarking of single-cell multimodal omics integration methods. *Nature Methods* 2025. doi:10.1038/s41592-025-02856-3 — verified (corpus)
R7. Rautenstrauch P, Ohler U. Shortcomings of silhouette in single-cell integration benchmarking. *Nature Biotechnology* 2026. doi:10.1038/s41587-025-02743-4 — verified (corpus)
R8. Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. *Cell* 2021. doi:10.1016/j.cell.2021.04.048 — verified (corpus)
R9. Argelaguet R, Arnol D, Bredikhin D, et al. MOFA+: a statistical framework for comprehensive integration of multi-modal single-cell data. *Genome Biology* 2020. doi:10.1186/s13059-020-02015-1 — verified (corpus)
R10. Gayoso A, Steier Z, Lopez R, et al. Joint probabilistic modeling of single-cell multi-omic data with totalVI. *Nature Methods* 2021. doi:10.1038/s41592-020-01050-x — verified (corpus)
R11. Ashuach T, Gabitto MI, Koodli RV, et al. MultiVI: deep generative model for the integration of multimodal data. *Nature Methods* 2023. doi:10.1038/s41592-023-01909-9 — verified (corpus)
R12. Cobolt: integrative analysis of multimodal single-cell sequencing data. 2021. doi:10.1186/s13059-021-02556-z — partial (corpus)
R13. scMoMaT jointly performs single cell mosaic integration and multi-modal bio-marker detection. 2023. doi:10.1038/s41467-023-36066-2 — partial (corpus)
R14. Swanson E, Lord C, Reading J, et al. Simultaneous trimodal single-cell measurement of transcripts, epitopes, and chromatin accessibility using TEA-seq. *eLife* 2021. doi:10.7554/elife.63632 — verified (corpus)
R15. Martens LD, Fischer DS, Yepez VA, Theis FJ, Gagneur J. Modeling fragment counts improves single-cell ATAC-seq analysis. *Nature Methods* 2024. doi:10.1038/s41592-023-02112-6 — verified (corpus)
R16. Bredikhin D, Kats I, Stegle O. MUON: multimodal omics analysis framework. *Genome Biology* 2022. doi:10.1186/s13059-021-02577-8 — verified (corpus)
R17. Lotfollahi M, Naghipourfar M, Luecken MD, et al. Mapping single-cell data to reference atlases by transfer learning. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01001-7 — verified (corpus)
R18. He Z, Hu S, Chen Y, et al. Mosaic integration and knowledge transfer of single-cell multimodal data with MIDAS. *Nature Biotechnology* 2024. doi:10.1038/s41587-023-02040-y — verified (corpus)
R19. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R20. Büttner M, Miao Z, Wolf FA, Teichmann SA, Theis FJ. A test metric for assessing single-cell RNA-seq batch correction. *Nature Methods* 2019. doi:10.1038/s41592-018-0254-1 — verified (corpus)
R21. Korsunsky I, Millard N, Fan J, et al. Fast, sensitive and accurate integration of single-cell data with Harmony. *Nature Methods* 2019. doi:10.1038/s41592-019-0619-0 — verified (corpus)
R22. Cao ZJ, Gao G. Multi-omics single-cell data integration and regulatory inference with graph-linked embedding. *Nature Biotechnology* 2022. doi:10.1038/s41587-022-01284-4 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/satijalab/seurat | Authors@R in DESCRIPTION: Rahul Satija (author, maintainer) with contributors including Andrew Butler, Yuhan Hao and Isabella Grabski | MIT + file LICENSE (copyright holder Seurat authors) | WNN reference implementation (`FindModalityWeights`, `MultiModalNN`), version 5.6.0.9000, commit 5f67c70 | port |
| https://github.com/scverse/muon | Danila Bredikhin, Ilia Kats (pyproject) | BSD-3-Clause | WNN in Python (`muon.pp.neighbors`), commit 7e65510 | callout |
| https://github.com/bioFAM/MOFA2 | Ricard Argelaguet (maintainer), Damien Arnol, Danila Bredikhin, Britta Velten (DESCRIPTION) | LGPL-3.0 | MOFA+ comparator and specification, commit 4a102f2 | reimplement |
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject) | BSD-3-Clause (copyright Yosef Lab, Weizmann Institute of Science) | totalVI and MultiVI model definitions, version 1.5.1, commit 5555ecc | port |
| https://github.com/epurdom/cobolt | boyinggong (setup.py author field) | GPL-3.0 (LICENSE file) | Cobolt comparator, commit cea9a5c | callout |
| https://github.com/PeterZZQ/scMoMaT | Ziqi Zhang (setup.py) | MIT | scMoMaT comparator, commit dbd954d | callout |
| https://github.com/YosefLab/scib-metrics | Adam Gayoso (pyproject author and maintainer) | BSD-3-Clause | label and batch silhouette, BRAS, LISI, kBET, graph connectivity and NMI/ARI definitions, version 0.6.1, commit 00c4ec0 | port |
| https://github.com/openproblems-bio/task_batch_integration | Open Problems in Single-Cell Analysis (LICENSE) | MIT | metric specifications (`bras`, `cilisi`; scib-metrics 0.5.5 pinned), commit b3da9d6 | callout |
