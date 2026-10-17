---
id: clustering.model_based_clustering
title: Model-based probabilistic clustering with posterior memberships
area: clustering
scope: core
paradigm: model-based
literature_status: contested
priority: P2
depends_on: [normalization.size_factor_estimation, feature-selection.highly_variable_gene_selection, dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection]
feeds: [clustering.cluster_stability, clustering.cluster_significance_testing, statistics.post_clustering_inference, annotation.cluster_label_assignment]
reads: [layers/counts, obs/size_factor, var/highly_variable, obsm/X_pca]
writes: [obs/mm_cluster, obs/mm_max_posterior, obsm/mm_posterior, uns/mm_fit, uns/mm_calibration, models/mm_model]
devices: [cpu, cuda]
mcp_tool: singlet_clustering_model_based_clustering
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Model-based probabilistic clustering with posterior memberships

> Fits a probabilistic mixture model to raw counts or a latent space and returns per-cell membership probabilities, a hard label and a selected number of components, judged for calibration as well as for recovery of known populations.

## 1. Question

Does a probabilistic mixture model fitted to UMI counts or a latent space recover cell populations, and do its membership probabilities match how often a cell's assigned population is correct? Inputs are raw counts with size factors, optionally with batch and reference-label columns. Outputs are memberships $\tau_{ik}$, a hard label, a selected $\hat K$ and fit metadata. A correct answer recovers reference populations at matched $K$ and has memberships whose stated confidence matches observed accuracy.

## 2. Why this task matters and where the field stands

Marker ranking, annotation and differential abundance all need a grouping of cells, and graph community detection is the usual way to obtain one. The community best-practices clustering chapter recommends Leiden on a single-cell kNN graph and reports Louvain as outperforming other methods in the benchmarks it cites, including [R2]. A graph partition carries no probability, so a cell on a population boundary is labelled as firmly as a central one. Status: **contested**. The open problems are:

- Discrete populations versus continua: mixture components can split a gradient, so memberships may describe density rather than populations [R1].
- The number of groups: estimators disagree, and benchmarks of estimators for cell types exist [R13]; no estimator is standard for scRNA-seq.
- Calibration: soft memberships are rarely measured against reference labels. Section 8 adds that measurement.

## 3. Theory and insight

Cell $i$ has counts $y_{ig}$ and size factor $s_i$. Under a $K$-component mixture,

$$p(\mathbf y_i)=\sum_{k=1}^{K}\pi_k f_k(\mathbf y_i\mid\theta_k),\qquad \tau_{ik}=\frac{\pi_k f_k(\mathbf y_i\mid\hat\theta_k)}{\sum_j \pi_j f_j(\mathbf y_i\mid\hat\theta_j)}.$$

Here $\tau_{ik}$ is the posterior at the maximum-likelihood plug-in $\hat\theta$. It ignores parameter uncertainty, so it is over-confident when $n$ is small or components overlap. The proposed count component is a zero-inflated negative binomial with genes independent given $k$:

$$p(y_{ig}\mid k)=\pi_{0,kg}\mathbb 1[y_{ig}=0]+(1-\pi_{0,kg})\,\mathrm{NB}(y_{ig};\,s_i\rho_{kg},\theta_g),$$

where $\mathrm{NB}(y;\mu,\theta)$ has mean $\mu$ and variance $\mu+\mu^2/\theta$. The latent variant maximises the bound

$$\mathcal L_i=\mathbb E_{q}[\log p(\mathbf x_i\mid z_i,\ell_i)]-\mathrm{KL}\big(q(z_i\mid\mathbf x_i)\,\|\,\textstyle\sum_k\pi_k\mathcal N(\mu_k,\Sigma_k)\big)-\mathrm{KL}\big(q(\ell_i\mid\mathbf x_i)\,\|\,p(\ell_i)\big),$$

which lower-bounds $\log p(\mathbf x_i)$. Its memberships are $\tau_{ik}=\mathbb E_q[p(k\mid z_i)]$. The gap to the evidence is approximation error. Deep clusterers such as [R6] instead use $q_{ik}\propto(1+\lVert z_i-\mu_k\rVert^2/\alpha)^{-(\alpha+1)/2}$, a kernel rather than a likelihood, so $q_{ik}$ is not a posterior and is not calibrated by construction. $K$ is chosen by $\mathrm{BIC}_K=2\hat\ell_K-\nu_K\log n$ (larger is better) or by the ELBO. Calibration arguments hold in the large-$n$ regime with a well-specified likelihood; BIC can over- or under-select when mixture regularity fails.

**Assumptions and failure modes.** Cells are conditionally independent given $k$, which continuous programmes and batch violate. Size factors and the dropout and dispersion model must be right. Continua are split arbitrarily, Gaussian components on PCs misfit skewed expression, ZINB can attribute biology to dropout, EM finds local optima and empties components, and doublets form extra components. The dense zero term of each ZINB component makes the E-step cost $O(nKG)$ per iteration, the scaling bottleneck.

**Estimands.**

- $\tau_{ik}$: posterior probability that cell $i$ belongs to component $k$ under the fitted model; rows sum to one over $k$.
- Hard label: $\arg\max_k\tau_{ik}$, ties to the lowest index.
- $\hat K$: the $K\in[2,k_{\max}]$ with the best criterion; a model-selection output, not a count of cell types.
- ARI and NMI: agreement of hard partitions with reference labels over all cell pairs (ARI, chance-corrected), and $\mathrm{NMI}=I(X;Y)/\tfrac12(H(X)+H(Y))$, in $[0,1]$.
- ECE and Brier: agreement of $\tau$ with one-hot labels $y_{ik}$ after one-to-one alignment of components to labels, defined only at $K$ equal to the number of labels. ECE uses $B=10$ equal-width bins of maximum membership, with accuracy the share of cells whose aligned label matches. Brier is $\frac1n\sum_i\sum_k(\tau_{ik}-y_{ik})^2$, without a one-half factor.

**Insight.** A model-based clusterer earns its place where its likelihood matches the data (count noise, batch covariates) and where its memberships are tested for calibration. A hard-label score tests neither, so graph clustering is the comparator, and gains must be shown against Leiden at matched settings. Benchmark pitfalls: labels produced by graph clustering on the same embedding favour graph methods, and class imbalance dominates ARI differences.

## 4. Methods landscape

The usual standard for unsupervised partitions is graph community detection on a kNN graph, which returns no probabilities. The table lists the published model-based and hybrid methods that singlet ports, reimplements or uses as comparators; routes are in sections 5 and 12.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scVI with Leiden or k-means | hybrid | ZINB or NB variational autoencoder; clusters the posterior-mean latent; no memberships | [R4], [R5] |
| scDeepCluster | model-based | ZINB autoencoder with a Student-t assignment layer, pretrained then refined with a KL-type target | [R6] |
| scDCC | model-based | scDeepCluster with must-link and cannot-link pairwise constraints | [R7] |
| CIDR | heuristic | implicit imputation, PCA, hierarchical clustering; K by Calinski-Harabasz | [R8] |
| ZINB-WaVE then clustering | hybrid | ZINB latent factors with library size and covariates; k-means or hierarchical clustering | [R9] |

**Defaults used.**

| Method | Parameter | Value | Source |
|---|---|---|---|
| scVI | n_latent | 10 | scverse_scvi-tools/src/scvi/model/_scvi.py:119 |
| scVI | n_hidden, n_layers | 128, 1 | _scvi.py:118, :120 |
| scVI | dropout_rate | 0.1 | _scvi.py:121 |
| scVI | gene_likelihood | zinb | _scvi.py:123 |
| scDeepCluster | n_clusters | 10 | ttgump_scDeepCluster/code/scDeepCluster.py:161 @ ff7f29d |
| scDeepCluster | ClusteringLayer alpha | 1.0 | scDeepCluster.py:115 @ ff7f29d |
| scDeepCluster | pretrain batch size, epochs | 256, 200 | scDeepCluster.py:209 @ ff7f29d |
| scDeepCluster | fit batch size, update interval, tol | 256, 140, 1e-3 | scDeepCluster.py:233 @ ff7f29d |
| scDeepCluster | ZINB ridge_lambda | 0.0 | ttgump_scDeepCluster/code/loss.py:116-117 @ ff7f29d |
| Leiden (comparator) | resolution, seed | 1.0, 42 | YosefLab_scib-metrics/src/scib_metrics/metrics/_nmi_ari.py, _compute_nmi_ari_cluster_labels |

## 5. Proposed singlet approach

**Routes.** `scvi_mixture` is built on scvi-tools (port); `scdeepcluster` ports the section 4 source (port). scDCC, CIDR, ZINB-WaVE and scib-metrics are comparator callouts; Splatter and CellBench are data callouts.

**Default: `zinb_mixture_em`.** Fits the count mixture of section 3 by EM on the genes in `var/highly_variable`, with size factors and an optional batch offset in the NB mean. It starts from k-means on PCs with several random starts and selects $K$ by BIC over $[2,k_{\max}]$. Its memberships are the converged plug-in posteriors.

**Latent variant: `scvi_mixture`.** A PyTorch variational autoencoder with a Gaussian-mixture latent prior and $K$ chosen by ELBO. Its memberships are $\mathbb E_q[p(k\mid z)]$, and a fitted model labels new cells without refitting.

**Port: `scdeepcluster`.** Uses the section 4 source defaults and requires an integer `n_components`, because the source has no automatic K. Its output is a kernel soft assignment and is flagged as such in `uns/mm_fit`.

**Falsification.** The default is rejected if it fails the B1 or B2 acceptance criteria (section 8).

**Stack and scale.** PyTorch trains the `scvi_mixture` encoder and decoder. Hard-coded CUDA and cuSPARSE cover only the small, fixed-shape loops of `zinb_mixture_em`: batched ZINB log-likelihoods over the $K$ components (fused tiles for the dense zero term, cuSPARSE for non-zero counts), the E-step softmax and the M-step weighted sums. CPU uses the same loops, threaded. Chunked sufficient statistics give streaming for the EM path. All of this is proposed.

**Agent defaults.** `method` = `zinb_mixture_em`, `n_components` = `auto`, `k_max` = 20, `seed` = 42, `batch_key` = null.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, cells by genes |
| read | obs/size_factor | float32 | per-cell size factor from normalisation |
| read | var/highly_variable | bool | genes used for fitting, when present |
| read | obsm/X_pca | float32 | leading PCs for initialisation |
| read | obs/<batch_key> | categorical | optional batch covariate |
| read | obs/<label_key> | categorical | optional reference labels, evaluation only |
| write | obs/mm_cluster | categorical | hard label, argmax of membership |
| write | obs/mm_max_posterior | float32 | maximum membership per cell |
| write | obsm/mm_posterior | float32 | cells by K memberships, rows sum to one |
| write | uns/mm_fit | dict | K, criterion per K, membership type, seed, convergence |
| write | uns/mm_calibration | dict | ECE and Brier with bin count; only when label_key is set |
| write | models/mm_model | blob | fitted parameters or network weights |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "zinb_mixture_em" | `zinb_mixture_em`, `scvi_mixture`, `scdeepcluster` | Model; zinb_mixture_em is the default. scdeepcluster needs an integer n_components. |
| `n_components` | integer/string | "auto" | — | Fixed K, or 'auto' to select K in [2, k_max] by BIC or ELBO. |
| `k_max` | integer | 20 | min 2 | Upper bound for automatic K selection. |
| `batch_key` | string/null | null | — | obs column of batch labels, used as a log offset or a decoder covariate. |
| `label_key` | string/null | null | — | obs column of reference labels, used for evaluation only. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 42 | — | Random seed for initialisation and minibatches. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without fitting. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `zinb_mixture_em` | object | — | — | Options for zinb_mixture_em only. |
| `zinb_mixture_em.n_init` | integer | 5 | min 1 | Random k-means starts on PCs for EM initialisation. |
| `zinb_mixture_em.max_iter` | integer | 200 | min 1 | Maximum EM iterations for each K. |
| `scvi_mixture` | object | — | — | Options for scvi_mixture only. |
| `scvi_mixture.n_latent` | integer | 10 | min 1 | Latent dimension of the variational autoencoder. |
| `scvi_mixture.n_hidden` | integer | 128 | min 1 | Hidden width of encoder and decoder. |
| `scvi_mixture.n_layers` | integer | 1 | min 1 | Hidden layers in encoder and decoder. |
| `scvi_mixture.dropout_rate` | number | 0.1 | min 0; max 1 | Dropout rate in encoder and decoder. |
| `scvi_mixture.gene_likelihood` | string | "zinb" | `zinb`, `nb` | Count likelihood of the decoder. |
<!-- PARAMS:AUTO:END -->

`n_components="auto"` selects $K$ by BIC for `zinb_mixture_em` and by ELBO for `scvi_mixture`. `scdeepcluster` requires an integer. `batch_key` enters as a log offset in the NB mean (`zinb_mixture_em`) or as a decoder covariate (`scvi_mixture`). `label_key` is evaluation only: it adds `uns/mm_calibration` and never changes the fit. Nested options apply only to their method, and the `scvi_mixture` defaults are those of section 4.

## 7. MCP tool

Tool name `singlet_clustering_model_based_clustering` (definition in `tasks/mcp/singlet_clustering_model_based_clustering.json`). Example call and compact result:

```json
{"dataset": "atlas.singlet", "method": "zinb_mixture_em", "n_components": "auto", "k_max": 20, "seed": 42}
{"dataset": "atlas.singlet", "status": "completed",
 "wrote": ["obs/mm_cluster", "obs/mm_max_posterior", "obsm/mm_posterior", "uns/mm_fit", "models/mm_model"],
 "summary": {"K_selected": "int", "criterion": "BIC", "membership_type": "posterior_plugin", "converged": "bool"},
 "provenance_id": "string", "job_id": null}
```

- **Long-running:** above a size threshold (proposed), the call returns `status: "queued"` with a `job_id`.
- **Stochastic:** initialisation and minibatches are fixed by `seed`; fits under other seeds are reported as medians.
- **Estimate:** `dry_run: true` returns estimated seconds, peak memory and device without writing members.

## 8. Benchmarks

**Shared protocol.** Every method uses the same genes (`var/highly_variable`, 2,000 genes, proposed) and, unless it needs raw counts, the same 30 leading PCs of log-normalised data. Fixed-$K$ fits use the reference number of labels; free-$K$ fits select $K$ in $[2,20]$ by BIC or ELBO. Seeds 42, 43 and 44 (proposed) are reported per dataset and as medians. Hard labels are argmax memberships, and calibration is computed only for methods that output memberships.

### B1. Cell-line mixture control (sc_mixology)

- **Goal**: Does each method recover three known cell lines, within each protocol and pooled, and are its memberships calibrated against them?
- **Ground truth**: orthogonal measurement. Estimand: the one-hot cell-line identity $y_{ik}$ from the `cell_line_demuxlet` column, $K=3$. Mixture-combination labels are excluded. Components are aligned to lines by the one-to-one assignment that maximises total membership (proposed).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CellBench sc_mixology: HCC827, H1975, H2228 | [R14]; design [R3] | scRNA-seq, human cell lines; cells — | §12 | CEL-seq2, Drop-seq, 10x Chromium; protocol as batch |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | chance-corrected pair agreement with $y$ | max | primary | [R12] |
| NMI | $I(X;Y)/\tfrac12(H(X)+H(Y))$ against $y$ | max | primary | — |
| ECE, Brier | as in section 3 | min | guardrail (proposed) | — |

- **Comparators**: `zinb_mixture_em` (default), `scvi_mixture`, `scdeepcluster` [R6], scVI with Leiden [R4][R5], Leiden on a kNN graph [R11], CIDR [R8] and ZINB-WaVE with k-means [R9] (hard labels only for these last two).
- **Protocol**: each protocol and pooled; fixed $K=3$ is the main comparison, free $K$ secondary.
- **Acceptance criterion**: proposed. Median ARI at $K=3$ within 0.02 of the best Leiden comparator, ECE at most 0.10, and per-protocol ARI at least 0.9 in every protocol.
- **Known pitfalls**: a ceiling effect from three well-separated lines; protocol-as-batch confounding in pooled scores.

### B2. Planted-group simulation with known labels

- **Goal**: Are memberships calibrated, and is $K$ recovered, when generating groups are known exactly?
- **Ground truth**: planted simulation. Estimand: the one-hot generating group $y_{ik}$. Calibration acceptance uses Recipe A only, since Recipe B shares the ZINB family of `zinb_mixture_em`.
- **Generators**: (1) Recipe A: Splatter [R10], uniform `group.prob` over $K\in\{3,5,10\}$, `de.prob` and `de.facLoc` on a grid, $n\in\{1{,}000;\,10{,}000\}$ (proposed). (2) Recipe B (proposed): draw $k_i$ uniformly; lognormal base rates $\rho_g$, with a random 10% of genes per group scaled by $e^{\delta_{kg}}$, $\delta_{kg}\sim\mathcal N(0,1)$; lognormal $s_i$; ZINB counts with mean $s_i\rho_{kg}$, $\theta_g=1$, dropout uniform on $[0.1,0.5]$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Recipes A and B | [R10] for Splatter; B generated here | simulated scRNA-seq counts; $n$, $K$ as above | §12 | Recipe B is a same-family control |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI, NMI | as in B1, against generator labels | max | primary | — |
| ECE, Brier | as in B1, against one-hot generator labels | min | primary | — |
| $\lvert\hat K-K\rvert$; ARI at $\hat K\neq K$ | error of $\hat K$ by BIC or ELBO; ARI when they differ | min; max | guardrail | — |

- **Comparators**: `zinb_mixture_em`, `scvi_mixture`, scVI with Leiden, ZINB-WaVE with k-means and CIDR (hard labels only for the last three).
- **Protocol**: vary DE strength and dropout; 20 replicates per setting (proposed); reliability in 10 bins, reporting bins with at least 100 cells.
- **Acceptance criterion**: proposed. On Recipe A, ECE at most 0.05 and reliability within 0.05 of the diagonal in bins with at least 100 cells. Recipe B does not count.
- **Known pitfalls**: simulated groups are not cell types, and DE strength sets overlap. Simulated calibration does not transfer to droplet noise, which B1 checks.

### P1. Performance and scaling

Wall time, throughput and peak memory (RAM and GPU) at $10^4$, $10^5$ and $10^6$ cells on CPU and CUDA; $10^7$ cells for `scvi_mixture` on GPU only (proposed). Comparators: `zinb_mixture_em`, `scvi_mixture`, `scdeepcluster`, scDCC [R7], CIDR [R8] and scVI [R4]. Hold fixed: 2,000 genes, 30 PCs, $K=10$, the batch size of section 4, seed 42, thread count, hardware and storage. Repeat three times with different seeds and report medians. Acceptance (proposed): `zinb_mixture_em` at $10^6$ cells takes no more than twice the wall time of `scdeepcluster` on the same device.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
- **Feeds**:
  - `clustering.cluster_stability`: Cluster stability under resampling and perturbation
  - `clustering.cluster_significance_testing`: Testing whether clusters or splits are statistically real, and merging over-split clusters
  - `statistics.post_clustering_inference`: Post-clustering inference with valid p-values (double-dipping correction)
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Reads**: `layers/counts`, `obs/size_factor`, `var/highly_variable`, `obsm/X_pca`
- **Writes**: `obs/mm_cluster`, `obs/mm_max_posterior`, `obsm/mm_posterior`, `uns/mm_fit`, `uns/mm_calibration`, `models/mm_model`
<!-- CHAINING:AUTO:END -->

Named recipes: none is assigned yet. The membership partition feeds the stability and annotation steps listed above.

## 10. Risks, pitfalls and open questions

- **Evidence not read.** The Gaussian-on-PCs baseline (mclust), DIMM-SC and BISCUIT are excluded from tables, enum and comparators because their primary papers or code were not read. The scDeepCluster author list is from memory. The clustering-number benchmark in [R13] is known from its title and DOI only. The scVI defaults come from a source snapshot whose commit is not recorded. The licences of scib-metrics and the Splatter repository's authors are not stated. CellBench cell counts are not stated. CIDR's speed claim is the authors' own and is not benchmarked here.
- **Benchmarks not specified.** An expert-label concordance benchmark on the datasets of [R2] and a K-recovery benchmark on the datasets of [R13] are omitted because their dataset identities and truth definitions were not read. The scDeepCluster figshare dataset has no stated licence or labels. K-recovery is the first benchmark to add, since it tests BIC and ELBO directly.
- **Unsettled literature.** Whether mixture memberships describe populations or density on continua is open [R1]. No accepted calibration protocol for clustering exists. Few benchmarks compare BIC and ELBO for K on real scRNA-seq data. The Louvain claim in section 2 is the chapter's own and was not compared with the cited papers.
- **Technical risk and first experiment.** The dense zero term makes the E-step $O(nKG)$, the main scaling risk; data licence terms are in section 12. First experiment: fit `zinb_mixture_em` and `scvi_mixture` on B1 at $K=3$ in each protocol and compare ECE and ARI with Leiden on the same PCs before any B2 work.

## 11. References

R1. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R2. Du A, Robinson MD, Soneson C. A systematic performance evaluation of clustering methods for single-cell RNA-seq data. *F1000Research* 2018. doi:10.12688/f1000research.15666.1 — verified (corpus)
R3. Tian L, Dong X, Freytag S, et al. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R4. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R5. Gayoso A, Lopez R, Xing G, et al. A Python library for probabilistic analysis of single-cell omics data. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01206-w — verified (corpus)
R6. Tian T, Wan J, Song Q, Wei Z. Clustering single-cell RNA-seq data with a model-based deep learning approach. *Nature Machine Intelligence* 2019. doi:10.1038/s42256-019-0037-0 — verified (corpus)
R7. Tian T, Zhang J, Lin X, Wei Z, Hakonarson H. Model-based deep embedding for constrained clustering analysis of single cell RNA-seq data. *Nature Communications* 2021;12:1873. doi:10.1038/s41467-021-22008-3 — verified (corpus)
R8. Lin P, Troup M, Ho JWK. CIDR: ultrafast and accurate clustering through imputation for single-cell RNA-seq data. *Genome Biology* 2017;18:59. doi:10.1186/s13059-017-1188-0 — verified (corpus)
R9. Risso D, et al. A general and flexible method for signal extraction from single-cell RNA-seq data. *Nature Communications* 2018. doi:10.1038/s41467-017-02554-5 — verified (corpus)
R10. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R11. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)
R12. Santos JM, Embrechts M. On the use of the adjusted Rand index as a metric for evaluating supervised classification. *Artificial Neural Networks – ICANN 2009*, Springer, pp. 175–184. doi:10.1007/978-3-642-04277-5_18 — verified (corpus)
R13. Yu L, Cao Y, Yang JY, Yang P. Benchmarking clustering algorithms on estimating the number of cell types from single-cell RNA-sequencing data. *Genome Biology* 2022;23:49. doi:10.1186/s13059-022-02622-0 — partial (search)
R14. Tian L. CellBench_data: single-cell mixology benchmark data. GitHub repository, 2018. https://github.com/LuyiTian/CellBench_data — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml) | BSD-3-Clause (LICENSE) | base of `scvi_mixture`; defaults in section 4 | port |
| https://github.com/ttgump/scDeepCluster | Tian Tian (README contact) | Apache-2.0 (LICENSE.md) | source of `scdeepcluster` | port |
| https://github.com/ttgump/scDCC | Tian Tian (README contact) | Apache-2.0 (LICENSE.md) | comparator | callout |
| https://github.com/VCCRI/CIDR | Peijie Lin (maintainer); Michael Troup | GPL-2 (LICENSE) | comparator | callout |
| https://github.com/drisso/zinbwave | Davide Risso; Svetlana Gribkova; Fanny Perraudeau; Jean-Philippe Vert; Clara Bagatin | Artistic-2.0 (DESCRIPTION) | comparator | callout |
| https://github.com/YosefLab/scib-metrics | — | BSD (LICENSE) | Leiden defaults and metric convention | callout |
| https://github.com/LuyiTian/CellBench_data | Luyi Tian | MIT (LICENSE) | benchmark data, B1 | callout |
| https://github.com/Oshlack/splatter | — | GPL-3 (DESCRIPTION) | simulator, B2 Recipe A | callout |
