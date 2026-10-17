---
id: foundation-models.zero_shot_cell_embedding
title: Zero-shot cell embedding for cell-type separation
area: foundation-models
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [qc.low_quality_cell_detection, harmonization.gene_identifier_mapping, feature-selection.highly_variable_gene_selection]
feeds: [reference-mapping.query_embedding_projection, annotation.reference_label_transfer, embedding-viz.local_neighborhood_preservation]
reads: [layers/counts, var/<gene_col>, obs/<labels_key>, obs/<batch_key>]
writes: [obsm/X_zero_shot, obs/zero_shot_cluster, uns/zero_shot_eval]
devices: [cpu, cuda]
mcp_tool: singlet_foundation_models_zero_shot_cell_embedding
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Zero-shot cell embedding for cell-type separation

> Embed a labelled dataset with a frozen foundation model, with no training on the target, and test against HVG-PCA and scVI whether the embedding separates expert cell types at least as well.

## 1. Question

Does a frozen pretrained cell embedding, used with no task-specific training, separate expert-labelled cell types at least as well as a baseline embedding computed on the same cells? The input is raw counts of a labelled dataset that the model did not train on, the frozen checkpoint with its gene vocabulary, and expert labels used only for scoring. The output is one embedding per cell, scored by Leiden clustering and neighbourhood measures against the labels with ARI, NMI, cell-type ASW and cLISI. A correct answer is a paired difference per study with an interval, not a single ranking on one dataset.

## 2. Why this task matters and where the field stands

Cell-type labels are the routine target of single-cell analysis, and the embedding feeds clustering, neighbour search and label transfer, so its quality bounds those steps. Whether a frozen pretrained embedding beats a classical one is **contested**. Pretraining objectives reconstruct or predict gene content rather than cell identity, so separation depends on whether identity dominates the model's latent space. A best-practices source states that careful evaluations show zero-shot foundation-model embeddings often do not beat simple baselines, citing Kedzierska et al. [R3, R12]. On perturbation prediction, deep models did not outperform simple linear baselines [R4]; that is indirect evidence for embeddings.

Open problems:

- Pretraining overlap: public atlases may appear in pretraining corpora and inflate scores; excluding them needs accession lists that are not in hand for these models (section 10).
- No agreed margin: "at least as good as a baseline" has no published threshold.
- Selection effects: resolution optimisation and label granularity change which method ranks first [R8, R9].
- A 2025 Genome Biology benchmark of single-cell foundation models exists; its authors and DOI are not confirmed, and it is not used [R11].

## 3. Theory and insight

A frozen embedding is a fixed map from counts to $d$ dimensions. Its quality is a property of the geometry it induces: whether expert types form dense, separated neighbourhoods that survive clustering. The scores are model-free functionals of partitions and neighbourhoods, and the statistical question is a paired comparison across studies, with leakage controlled.

$$z_i=f_{\hat\theta}(x_i)\in\mathbb R^{d},\qquad \hat\theta\ \text{fixed: no gradient step on the target data.}$$

Only preprocessing, tokenisation, pooling and graph settings may be chosen, and these are shared with the baseline. The baseline is truncated SVD. By the Eckart–Young theorem,

$$\min_{\operatorname{rank}(M)\le k}\lVert X-M\rVert_F^{2}=\sum_{j>k}\sigma_j^{2},$$

so PCA is the best rank-$k$ linear reconstruction of the selected genes, but it does not target cell types, which is why it is a strong comparator. Read as a likelihood it assumes equal Gaussian noise on every entry. That is a fair approximation for log-normalised values with large means ($\mu\gg1$, to first order) and a poor one for sparse counts with small means.

For labels $y$ and a Leiden partition $c$, with contingency counts $n_{ij}$ and marginals $a_i$, $b_j$,

$$\mathrm{ARI}=\frac{\sum_{ij}\binom{n_{ij}}{2}-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}}{\tfrac12\big[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}\big]-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}},\qquad \mathrm{NMI}=\frac{2\,I(c;y)}{H(c)+H(y)}.$$

ARI is zero in expectation for random partitions with fixed marginals and one for identical partitions [R9]. NMI here uses the arithmetic mean of the two entropies, as scIB implements it (`scib/metrics/nmi.py:17`, section 4).

For the embedding neighbourhoods, let $u_i$ be the mean distance to same-label cells, $v_i$ the smallest mean distance to another label, and $p_{il}$ the perplexity-weighted label weights over $k=90$ neighbours. Then

$$\widetilde{\mathrm{ASW}}=\tfrac12\Big(\tfrac1n\textstyle\sum_i\frac{v_i-u_i}{\max(u_i,v_i)}+1\Big),\qquad \widetilde{\mathrm{cLISI}}=\frac{L-\operatorname{median}_i\big(\sum_{l}p_{il}^{2}\big)^{-1}}{L-1}.$$

The paired effect and the verdict model are

$$\Delta_d=S_{\mathrm{FM},d}-S_{\mathrm{HVG},d},\qquad \Delta_d=\mu+b_d+\varepsilon_d,\quad b_d\sim\mathcal N(0,\tau^2),\quad \varepsilon_d\sim\mathcal N(0,s_d^2),$$

where $s_d$ is the within-study bootstrap standard error of $\Delta_d$. The verdict is $P(\mu>-\delta\mid\text{data})$ for a margin $\delta$.

| Symbol | Meaning |
|---|---|
| $n$, $L$ | cells in a study; labelled types in that study |
| $d$, $k$ | embedding dimension; neighbours in the LISI graph |
| $r$ | Leiden resolution, taken over ten values in $[0,2]$ |
| $\Delta_d$, $\mu$ | study-level paired difference; population mean over studies |
| $\tau$, $s_d$ | between-study scatter; within-study standard error |
| $\delta$ | margin for "at least as good", proposed as 0.02 |

Estimands, one sentence each:

- Embedding: $z_i$ is the frozen output for cell $i$ in the model's own units, unstandardised, so Euclidean scores depend on its scale.
- Partition: $c_i(r)$ is the Leiden label of cell $i$ on the kNN graph of the embedding at resolution $r$.
- ARI and NMI: functions of the contingency table of $c(r)$ and $y$, invariant to relabelling; the reported value per study is the maximum over the ten resolutions, a selection rule applied identically to both methods.
- ASW and cLISI: label geometry on the embedding, rescaled so that 1 is optimal; each is a summary over cells, not a total.
- Ground truth: one author label per cell, dropped if missing, and never an input to any step before scoring.
- Target $\mu$: the expected paired difference over the study population, so the unit of inference is the study, not the cell.

Regime of validity. ARI and NMI are exact for discrete labels and depend on the cluster count. ASW and cLISI use Euclidean geometry on the raw embedding; exact silhouette is quadratic in $n$, so it is computed on a stated subsample. The verdict model assumes exchangeable studies, and $\tau$ is poorly determined with few studies. The zero-shot claim requires that the target is absent from pretraining, which is an assumption here (section 10).

Assumptions and failure modes:

- Foundation models: pretraining contamination inflates scores; rank or bin tokenisation discards absolute depth, which can blur low-depth and rare types; a pooled `<cls>` vector can encode depth rather than identity; genes outside the vocabulary are lost; dense attention costs $O(L^2d)$ per layer for $L$ tokens, so inference, not training, dominates the cost.
- Heuristic baseline: depth-dependent variance and zero inflation are not modelled, and PCA targets variance rather than identity.
- Trained comparator (scVI): it sees the target, so it is not zero-shot, and a batch covariate that absorbs biology lowers bio-conservation.

Why the heuristic works, and what the model adds. Dominant variance in log-normalised highly variable genes often aligns with identity, and PCA is fast with no likelihood to misspecify. A model-based formulation adds a verdict with calibrated uncertainty, from the hierarchical model above, which a single bootstrap interval does not give. It also yields a frozen feature map that applies to new cells without retraining.

Pitfalls seen in benchmarks: resolution optimisation favours whichever method's cluster count matches the labels; embedding dimensions differ, for example 1280 for UCE against the 50 principal components used here; and coarse versus fine labels reorder ARI and NMI.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scGPT | model-based | Generative transformer pretrained on a large single-cell corpus; the frozen `<cls>` output is the cell embedding | [R1] |
| UCE | model-based | Species-agnostic model: each gene token combines a protein embedding and a chromosome-position token; a transformer over sampled genes gives a 1280-dimensional cell embedding | [R2] |
| HVG plus PCA | heuristic | Highly variable genes, log normalisation, truncated SVD of the centred matrix | [R5, R6] |
| scVI | model-based | Conditional VAE with a count likelihood; latent mean as embedding; trained on the target | [R7] |

HVG-PCA is the published standard and the comparator that every frozen model must beat [R5, R6]. scVI is a trained comparator, not a zero-shot method [R7]. Geneformer, scFoundation, scBERT and CellPLM are omitted from the tables and the tool enum until their primary code is read (section 10). The defaults below are read from source at the stated commits; each is a value the proposed implementation reproduces unless section 5 says otherwise.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| scGPT | `max_length` | 1200 | `scgpt/tasks/cell_emb.py:152` @ cebd6fa |
| scGPT | `batch_size` | 64 | `cell_emb.py:153` @ cebd6fa |
| scGPT | `device` | cuda | `cell_emb.py:155` @ cebd6fa |
| scGPT | `use_fast_transformer` | True | `cell_emb.py:156` @ cebd6fa |
| scGPT | `gene_col` | feature_name | `cell_emb.py:151` @ cebd6fa |
| scGPT | pooling (`cell_embedding_mode`) | cls | `cell_emb.py:24` @ cebd6fa |
| scGPT | checkpoint | scGPT_human (script); scGPT_CP (config) | `src/methods/scgpt_zeroshot/script.py:18-19`, `config.vsh.yaml:25` @ b3da9d6 |
| UCE | `species` | human | `eval_single_anndata.py:99` @ 9c41600; wrapper accepts only human and mouse, `src/methods/uce/script.py:53-58` @ b3da9d6 |
| UCE | `nlayers` | 4 | `eval_single_anndata.py:128` @ 9c41600 |
| UCE | `output_dim` | 1280 | `eval_single_anndata.py:130` @ 9c41600 |
| UCE | `pad_length` | 1536 | `eval_single_anndata.py:112` @ 9c41600 |
| UCE | `sample_size` | 1024 | `eval_single_anndata.py:124` @ 9c41600 |
| UCE | `batch_size` | 25 | `eval_single_anndata.py:110` @ 9c41600; README line 24 gives 100 for the 4-layer model |
| UCE | `CXG` | True | `eval_single_anndata.py:126` @ 9c41600 |
| HVG-PCA | flavour | seurat_v3 (chosen; the public default is preset-dependent) | `scanpy/preprocessing/_highly_variable_genes.py:121`; `scanpy/_settings/presets.py:194-195` @ 8ed52d9 |
| HVG-PCA | `n_top_genes` | 2000 | `_highly_variable_genes.py:123` @ 8ed52d9 |
| scVI | `n_latent` | 10 | `src/scvi/model/_scvi.py:119` @ 5555ecc |
| scVI | `n_hidden`; `n_layers` | 128; 1 | `_scvi.py:118`, `:120` @ 5555ecc |
| scVI | `gene_likelihood` | zinb | `_scvi.py:123` @ 5555ecc |
| scIB | LISI `k` | 90 | `scib/metrics/lisi.py:123` @ cd67913 |
| scIB | LISI perplexity | floor(k/3) | `lisi.py:246` @ cd67913 |
| scIB | kNN graph size | 15 | `lisi.py:202-206` @ cd67913 |
| scIB | silhouette metric; rescaling | euclidean; (ASW+1)/2 | `scib/metrics/silhouette.py:12`, `:52-53` @ cd67913 |
| scIB | resolution grid | ten values in [0, 2] | `scib/metrics/clustering.py:110-111` @ cd67913 |
| scIB | default resolution metric | NMI | `clustering.py:105` @ cd67913 |
| scIB | NMI average | arithmetic | `scib/metrics/nmi.py:17` @ cd67913 |

## 5. Proposed singlet approach

- **Routes.** scGPT and UCE: **port** the frozen inference path (section 12); checkpoints are referenced by path and never bundled. HVG-PCA: **port** the seurat_v3 selection and PCA definition, with CUDA kernels. scVI: **callout** only, implemented in `dim-reduction.deep_generative_latent_embedding`.
- **Default.** `method = hvg_pca`, `n_top_genes = 2000`, `n_comps = 50` (proposed, not from a source), `n_neighbors = 15`, `embedding_metric = euclidean`, `resolution = null` (ARI-optimised), `seed = 0`. The default is the comparator, so no foundation-model score is reported without its baseline, and the tool does not assume that a foundation model wins.
- **Model.** The frozen model is a fixed feature map, so the statistical model sits on top: the hierarchical verdict of section 3, fitted per primary metric across studies. Falsifiers: **F1**, if the posterior probability on the clean subset is below 0.95 for any primary metric, the foundation model is not reported as at least as good for that class of data. **F2**, a sign change between the full and clean subsets marks leakage, and the result is reported as contaminated. **F3**, if the ASW or cLISI ranking reverses under cosine distance, the Euclidean result is not adopted.
- **ML stack.** PyTorch runs the frozen inference, since scGPT and UCE are torch models. Hard-coded CUDA and cuSPARSE cover the hot small kernels: seurat_v3 gene statistics, randomised PCA as sparse-dense products, brute-force GPU kNN, ARI and NMI from the contingency table, and the silhouette and LISI reductions.
- **Devices and scale.** CPU is the reference, and CUDA matches it within float32 tolerance. Inference runs in batches of `batch_size`, so peak GPU memory depends on batch size and token length rather than on $n$. Silhouette is computed exactly on at most 20,000 cells (proposed); the subsample size is written to `uns/zero_shot_eval`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse int | raw UMI counts; required by every method |
| read | `var/<gene_col>` | string | gene identifiers mapped to the model vocabulary |
| read | `obs/<labels_key>` | categorical | expert labels, used for scoring only |
| read | `obs/<batch_key>` | categorical | optional stratification |
| write | `obsm/X_zero_shot` | float32, n × d | embedding of the selected method |
| write | `obs/zero_shot_cluster` | categorical | Leiden labels at the selected resolution |
| write | `uns/zero_shot_eval` | dict | per-method scores, resolution, cell count, subsample size, leakage flag |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "hvg_pca" | `hvg_pca`, `scvi`, `scgpt`, `uce` | Embedding method. hvg_pca is the baseline and default; scgpt and uce are frozen; scvi trains on the dataset. |
| `scoring` | object | — | — | Label, neighbourhood and resolution settings for the separation scores; applies to every method. |
| `scoring.labels_key` | string | "cell_type" | — | obs column of expert labels; used for scoring only, never as an input. |
| `scoring.batch_key` | string/null | null | — | Optional obs column for stratified reporting; null for none. |
| `scoring.embedding_metric` | string | "euclidean" | `euclidean`, `cosine` | Distance for silhouette and cLISI; cosine is a sensitivity check. |
| `scoring.n_neighbors` | integer | 15 | min 2 | Neighbours in the kNN graph used for Leiden clustering. |
| `scoring.resolution` | number/null | null | min 0; max 2 | Fixed Leiden resolution; null optimises ARI over ten values in [0, 2]. |
| `scoring.pretraining_accessions` | array | [] | — | Study accessions in the method's pretraining corpus; matching studies are flagged. |
| `scgpt` | object | — | — | Options for method scgpt; rejected for other methods. |
| `scgpt.model_dir` | string/null | null | — | Directory of the frozen scGPT checkpoint; required for method scgpt. |
| `scgpt.gene_col` | string | "feature_name" | — | var column matching the scGPT gene vocabulary. |
| `scgpt.max_length` | integer | 1200 | min 1 | Maximum gene tokens per cell. |
| `scgpt.batch_size` | integer | 64 | min 1 | Inference batch size. |
| `uce` | object | — | — | Options for method uce; rejected for other methods. |
| `uce.model_dir` | string/null | null | — | Directory of the frozen UCE model files; required for method uce. |
| `uce.species` | string | "human" | `human`, `mouse` | Species of the input; the OpenProblems wrapper accepts only human and mouse. |
| `uce.nlayers` | integer | 4 | `4`, `33` | Pretrained model depth; 4-layer and 33-layer embeddings are not interchangeable. |
| `uce.pad_length` | integer | 1536 | min 1 | Padded token length per cell. |
| `uce.sample_size` | integer | 1024 | min 1 | Genes sampled per cell. |
| `uce.batch_size` | integer | 25 | min 1 | Per-GPU batch size; 25 suits the 33-layer model on an 80 GB GPU. |
| `hvg_pca` | object | — | — | Options for method hvg_pca; rejected for other methods. |
| `hvg_pca.n_top_genes` | integer | 2000 | min 1 | Highly variable genes kept, selected by the seurat_v3 flavour on raw counts. |
| `hvg_pca.n_comps` | integer | 50 | min 1 | Principal components retained for the baseline embedding. |
| `scvi` | object | — | — | Options for method scvi; rejected for other methods. |
| `scvi.n_latent` | integer | 10 | min 2 | Latent dimensionality of the scVI embedding. |
| `scvi.gene_likelihood` | string | "zinb" | `zinb`, `nb` | Count likelihood of the scVI decoder. |
| `scvi.max_epochs` | integer/null | null | min 1 | Training epochs; null uses the library rule. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for Leiden clustering and scVI initialisation. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Nested objects apply only to their method, and a non-matching object is rejected. The `scoring` object applies to every method. Labels are read only for scoring and must be present; cells without a label are dropped and the count is reported. A model directory is required for `scgpt` and `uce`. Genes are mapped to the model vocabulary before selection, and the same mapped gene set is used for every method. A null `resolution` selects by ARI over the grid; a fixed value skips optimisation and is reported alongside it.

## 7. MCP tool

Tool name `singlet_foundation_models_zero_shot_cell_embedding` (definition in `tasks/mcp/singlet_foundation_models_zero_shot_cell_embedding.json`). Example call and compact result (angle-bracket values are placeholders):

```json
{"dataset": "/data/study.singlet", "method": "scgpt", "scgpt": {"model_dir": "/models/scGPT_human"}, "scoring": {"labels_key": "cell_type"}, "device": "cuda", "seed": 0}
```

```json
{"dataset": "/data/study.singlet", "status": "completed",
 "wrote": ["obsm/X_zero_shot", "obs/zero_shot_cluster", "uns/zero_shot_eval"],
 "summary": {"method": "scgpt", "n_cells": "<int>", "resolution": "<float>", "ari": "<0-1>", "nmi": "<0-1>", "cell_type_asw": "<0-1>", "clisi": "<0-1>", "leakage_flag": "<unknown|clean|overlap>"},
 "provenance_id": "prov_<id>"}
```

Long-running: the call returns `queued` with a `job_id` when the dry-run estimate exceeds the inline limit. Stochastic: `seed` fixes Leiden clustering and scVI initialisation; the frozen inference uses no seed, and GPU kernels can differ within float tolerance. Dry run: estimated seconds, peak GPU memory and device, computed from cell count, token length and batch size.

## 8. Benchmarks

**Shared protocol.** Every study is embedded from the same QC-passed counts, mapped to each model's vocabulary, with unmapped genes dropped for all methods. HVG selection applies only to HVG-PCA. Each method uses its defaults in section 4. Scores are computed per study and paired against HVG-PCA. Stochastic methods use seeds 1 to 5. Each score is reported at the ARI-selected resolution and at a fixed resolution, and the comparison is repeated after projecting every embedding onto 50 principal components (proposed).

### B1. Held-out study separation on annotated catalogue studies (proposed)

- **Goal**: estimate, across studies absent from pretraining, whether frozen foundation-model embeddings separate expert cell types better than HVG-PCA.
- **Ground truth**: expert labels from each original study annotation, one label per cell, used for scoring only. Partition scores are invariant to relabelling, and no transformation is applied to the labels.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Human studies with author cell-type labels | singlet catalogue, annotated subset (project specification: 354 million cells, about 40 percent annotated) | scRNA-seq and snRNA-seq; human; per-study size from recipe step 1 | — | pretraining overlap filter applied before scoring |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | Maximum over ten Leiden resolutions in [0, 2] of ARI between clusters and labels, per study | higher | primary | [R9, R8] |
| NMI | Arithmetic-mean NMI on the same partition | higher | primary | [R8] |
| Cell-type ASW | (silhouette + 1)/2 on the embedding, Euclidean; cosine as sensitivity | higher | primary | [R8] |
| cLISI | (L − median LISI)/(L − 1) with k = 90 and perplexity floor(k/3) | higher | primary | [R8] |

- **Comparators**: HVG-PCA, scVI, scGPT and UCE, each at its section 4 defaults; HVG-PCA uses 50 components (proposed).
- **Protocol**: a numbered recipe.
  1. List human studies with author cell-type labels and at least two labelled types (proposed).
  2. Exclude studies whose accession appears in a model's published pretraining list. Studies without such a list are labelled unknown-status and reported separately.
  3. Stratify by tissue and sample at most 500 cells per type (proposed).
  4. Map genes to each vocabulary; select highly variable genes for HVG-PCA only.
  5. Embed each study with each method; build a kNN graph with 15 neighbours.
  6. Run Leiden at ten resolutions and keep the ARI maximiser; also score at a fixed resolution of 1.0 (proposed).
  7. Compute the four metrics, with cosine ASW and cLISI as sensitivity checks.
  8. Form paired differences per study, fit the verdict model of section 3 for each metric, and report clean and unknown-status subsets separately.
- **Acceptance criterion** (proposed): on the clean subset, $P(\mu>-0.02\mid\text{data})\ge0.95$ for each primary metric, with the sign of the posterior mean equal to the full-set sign. The 95% bootstrap interval over studies is reported as a check.
- **Known pitfalls**: maximising over resolutions favours whichever partition count matches the labels, so fixed-resolution scores are reported beside it. Label granularity reorders ARI and NMI, so the level is fixed per study before scoring.

### P1. Performance and scaling

Wall time, throughput in cells per second, peak GPU and host memory, and time to scores for $10^4$, $10^5$ and $10^6$ cells (proposed scales), with scGPT, UCE, HVG-PCA and scVI on CPU and CUDA. Hold fixed: GPU model, precision, batch sizes and token lengths, HVG count, kNN size, Leiden grid and silhouette subsample. Time the embedding and the scoring separately, because exact silhouette is quadratic in $n$. Version 1 makes no streaming claim.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
- **Feeds**:
  - `reference-mapping.query_embedding_projection`: Query embedding into a frozen reference
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
  - `embedding-viz.local_neighborhood_preservation`: Local neighbourhood preservation of an embedding or reduced representation
- **Reads**: `layers/counts`, `var/<gene_col>`, `obs/<labels_key>`, `obs/<batch_key>`
- **Writes**: `obsm/X_zero_shot`, `obs/zero_shot_cluster`, `uns/zero_shot_eval`
<!-- CHAINING:AUTO:END -->

Used as an alternative to the PCA step before clustering and before reference mapping.

## 10. Risks, pitfalls and open questions

- **Secondary evidence.** The reported direction for Kedzierska et al. [R3] comes from one sentence in a best-practices summary [R12]. The full text is not used, so its datasets, metrics and numbers are not transcribed. The UCE README now cites a 2026 Nature article (https://www.nature.com/articles/s41586-026-10689-z) that was not read, so UCE details come from the code at 9c41600 and the preprint. The attribution of the seurat_v3 flavour to Stuart et al. [R6] rests on scanpy's own citation, not on the paper's text.
- **Omitted methods and tasks.** Geneformer, scFoundation, scBERT and CellPLM are excluded until their primary code is read. The first reads needed are the Geneformer embedding extraction and the scFoundation weight licence. The OpenProblems label-projection task scores scGPT and UCE wrappers with accuracy, f1_weighted, f1_macro and f1_micro (names from the task repository in section 12; definitions in [R10]). Those metrics measure a classifier's projection rather than separation, so the task's datasets are not used here.
- **Leakage status unknown.** The pretraining accession lists for scGPT and UCE were not read, so no candidate study has a verified leakage status. The scGPT README describes the whole-human checkpoint as pretrained on 33 million normal human cells, and the OpenProblems wrapper says over 33 million; the paper was not read to confirm either.
- **Resolution rule.** The scIB default resolution metric is NMI, and this protocol optimises ARI. The choice changes which partition is scored, so both are reported.
- **Counter-evidence.** A 2025 Genome Biology article on the power of single-cell foundation models [R11] may bear on this question; its authors and DOI are not confirmed, and its full text is not used. No 2026 zero-shot benchmark could be confirmed. The catalogue figures of 354 million cells and about 40 percent annotation come from the project specification and were not checked against a catalogue file.
- **First experiment.** On one human study with expert labels that the accession lists exclude from every model's pretraining, embed with scGPT, UCE, HVG-PCA and scVI, project each to 50 components, and compare ARI and cell-type ASW at a fixed resolution before running the full recipe.

## 11. References

R1. Cui H, et al. scGPT: toward building a foundation model for single-cell multi-omics using generative AI. *Nature Methods* 2024. doi:10.1038/s41592-024-02201-0 — verified (corpus)
R2. Rosen Y, Roohani Y, Leskovec J, et al. Universal Cell Embeddings: A Foundation Model for Cell Biology. *bioRxiv* 2023 (preprint). doi:10.1101/2023.11.28.568918 — verified (corpus)
R3. Kedzierska KZ, Crawford L, Amini AP, Lu AX. Zero-shot evaluation reveals limitations of single-cell foundation models. *Genome Biology* 2025. doi:10.1186/s13059-025-03574-x — verified (corpus)
R4. Ahlmann-Eltze C, Huber W, Anders S. Deep-learning-based gene perturbation effect prediction does not yet outperform simple linear baselines. *Nature Methods* 2025. doi:10.1038/s41592-025-02772-6 — verified (corpus)
R5. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R6. Stuart T, Butler A, Hoffman P, Hafemeister C, Papalexi E, Mauck WM, Hao Y, Stoeckius M, Smibert P, Satija R. Comprehensive integration of single-cell data. *Cell* 2019. doi:10.1016/j.cell.2019.05.031 — verified (corpus)
R7. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R8. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2021 (online). doi:10.1038/s41592-021-01336-8 — verified (corpus)
R9. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R10. Grandini M, Bagli E, Visani G. Metrics for multi-class classification: an overview. *arXiv* 2020. doi:10.48550/arxiv.2008.05756 — verified (corpus)
R11. Authors not confirmed. Biology-driven insights into the power of single-cell foundation models. *Genome Biology* 2025. DOI not confirmed. — partial (search)
R12. Single-cell best practices (online book), outlook chapter. theislab/single-cell-best-practices at commit d581689. https://github.com/theislab/single-cell-best-practices — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/bowang-lab/scGPT (commit cebd6fa) | Haotian (pyproject.toml author); LICENSE copyright holder suber; repository owner bowang-lab | MIT (LICENSE; pyproject.toml) | scGPT frozen embedding, `cls` pooling, defaults | port |
| https://github.com/snap-stanford/UCE (commit 9c41600) | Yanay Rosen, Yusuf Roohani, Jure Leskovec (LICENSE copyright 2023) | MIT (LICENSE) | UCE forward pass and defaults | port |
| https://github.com/scverse/scanpy (commit 8ed52d9) | scverse; F. Alexander Wolf, P. Angerer, Theis Lab (LICENSE) | BSD-3-Clause (LICENSE; pyproject.toml) | seurat_v3 HVG selection and PCA baseline | port |
| https://github.com/scverse/scvi-tools (commit 5555ecc) | scvi-tools development team (pyproject.toml); Yosef Lab (LICENSE) | BSD-3-Clause (LICENSE) | scVI baseline defaults | callout |
| https://github.com/theislab/scib (commit cd67913) | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt) | metric definitions and resolution protocol | port (NMI and ARI definitions, with attribution) |
| https://github.com/openproblems-bio/task_batch_integration (commit b3da9d6) | Open Problems in Single-Cell Analysis (LICENSE copyright 2024) | MIT (LICENSE) | scGPT and UCE wrapper settings and species limits | callout |
| https://github.com/openproblems-bio/task_label_projection (commit f37b604) | Nikolay Markov, Scott Gigante, Robrecht Cannoodt (README) | MIT (LICENSE) | label-projection metric names | callout |
| https://github.com/theislab/single-cell-best-practices (commit d581689) | Theislab (LICENSE copyright 2021) | Apache-2.0 (LICENSE) | secondary summary of [R3] | callout (text reference only) |
