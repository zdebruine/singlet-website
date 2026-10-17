---
id: evaluation.cluster_validity_indices
title: Label-free cluster validity indices
area: evaluation
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [dim-reduction.normalized_cell_embedding, clustering.cell_partitioning]
feeds: [clustering.resolution_selection, clustering.cluster_number_estimation]
reads: [obsm/<embedding>, obs/<cluster_key>, obs/<label_key>, obs/<batch_key>]
writes: [obs/<name>_silhouette, uns/cluster_validity/<name>/scores, uns/cluster_validity/<name>/per_cluster, uns/cluster_validity/<name>/flag]
devices: [cpu, cuda]
mcp_tool: singlet_evaluation_cluster_validity_indices
evidence_basis: corpus+repo+memory
last_reviewed: 2026-10-17
---

# Label-free cluster validity indices

> Scores candidate partitions of one set of cells with geometric indices (silhouette, Davies-Bouldin, Calinski-Harabasz) in one shared embedding, and flags whether the index supports the chosen granularity.

## 1. Question

Given one embedding of a set of cells and candidate partitions of those cells, do internal geometric indices rank the partitions, and the granularities they represent, in the same order as their biological agreement, when no reference labels exist? Inputs are the embedding and one labelling per candidate. Outputs are one score per index per partition, per-cell silhouette, and a flag stating whether the best partition lies inside the swept range and whether silhouette supports it. A correct answer is one that held-out labels or planted structure confirm; a geometric score alone does not establish biological validity.

## 2. Why this task matters and where the field stands

Cluster number and resolution set the downstream cell-type labels, yet no label-free criterion for them is settled; Kiselev et al. review the challenges of unsupervised scRNA-seq clustering [R7]. Internal indices are the usual label-free aid, and their status is **contested**. Silhouette width has been criticised for integration benchmarking: the single-cell best-practices paired-integration notebook states that silhouette can reward embeddings that do not remove batch effects, citing Rautenstrauch and Ohler [R5]. The scIB suite uses silhouette on annotated labels [R4], a label-based comparator rather than a label-free index. The single-cell variants change the statistic rather than validate it: subsampling robustness [R9] measures stability, and the cNMF consensus silhouette [R10] selects the number of expression programmes, not clusters. Open problems are whether any geometric index tracks biological granularity without a reference, which embedding should carry the distances when partitions came from a kNN graph, and the direction and size of the coarse-or-fine bias under unequal cluster sizes, which is unsettled.

## 3. Theory and insight

Let $n$ cells have coordinates $x_i\in\mathbb{R}^p$ in the chosen embedding, and let a partition $\{C_1,\dots,C_k\}$ assign cell $i$ to cluster $c(i)$, with size $n_c$ and centroid $\mu_c$. Distances are Euclidean unless stated. Every score is defined on one cell set in one embedding.

**Silhouette.**

$$s_i=\frac{b_i-a_i}{\max(a_i,b_i)},\qquad a_i=\frac{1}{n_{c(i)}-1}\sum_{j\in C_{c(i)},\,j\neq i}d(i,j),\qquad b_i=\min_{c\neq c(i)}\frac{1}{n_c}\sum_{j\in C_c}d(i,j)$$

The estimand is $\bar s=\frac1n\sum_i s_i\in[-1,1]$, the cell-averaged silhouette; per-cluster values average $s_i$ within $C_c$. Near 1 means a cell is much closer to its own cluster than to the nearest other; near 0 means a boundary cell or no structure. Regime: clusters of at least two cells. Exact computation needs all pairwise distances, costing $O(n^2 d)$ time.

**Calinski-Harabasz.**

$$\mathrm{CH}=\frac{\operatorname{tr}B_k}{\operatorname{tr}W_k}\cdot\frac{n-k}{k-1},\qquad W_k=\sum_c\sum_{i\in C_c}(x_i-\mu_c)(x_i-\mu_c)^\top,\qquad B_k=\sum_c n_c(\mu_c-\bar x)(\mu_c-\bar x)^\top$$

The estimand is the between-to-within dispersion ratio, unbounded above, where larger is better. Regime: Euclidean geometry and roughly convex, equal-variance clusters. Nothing cited here calibrates it against biological labels.

**Davies-Bouldin.** With $S_c$ the mean distance of cluster $c$ to $\mu_c$ and $D_{cc'}=\lVert\mu_c-\mu_{c'}\rVert$,

$$\mathrm{DB}=\frac1k\sum_{c=1}^{k}\max_{c'\neq c}\frac{S_c+S_{c'}}{D_{cc'}}.$$

The estimand is the average worst scatter-to-separation ratio; lower is better, so rankings use $-\mathrm{DB}$. Regime: centroid geometry in Euclidean space.

**Adjusted Rand index.** For two partitions of the same $n$ cells with contingency counts $n_{ij}$ and row and column sums $r_i$ and $q_j$,

$$\mathrm{ARI}=\frac{\sum_{ij}\binom{n_{ij}}{2}-\frac{\sum_i\binom{r_i}{2}\sum_j\binom{q_j}{2}}{\binom{n}{2}}}{\tfrac12\bigl[\sum_i\binom{r_i}{2}+\sum_j\binom{q_j}{2}\bigr]-\frac{\sum_i\binom{r_i}{2}\sum_j\binom{q_j}{2}}{\binom{n}{2}}}$$

[R6]. The estimand is chance-corrected pair agreement, 1 for identical partitions and near 0 for random labelling with fixed marginals. Labels are nominal, so a partition at a different granularity counts as disagreement.

**Label and batch silhouette (scIB).** The label term is $\tilde s_C=\tfrac12(\bar s^{(C)}+1)\in[0,1]$ for annotation labels $C$. With batch labels and retained cell types $M$,

$$\mathrm{batchASW}=\frac{1}{|M|}\sum_{j\in M}\frac{1}{\lvert C_j\rvert}\sum_{i\in C_j}\bigl(1-\lvert s_i^{(B)}\rvert\bigr),$$

where $s^{(B)}$ is the silhouette of batch labels within cell type $j$ [R4]. It is batch mixing in $[0,1]$, averaged over cells within each type and then over types. The absolute value scores a zero silhouette as perfect mixing, although zero also arises when no structure exists. Regime: labels must not come from clustering the same embedding.

**Likelihood criterion (proposed).** For a $K$-component Gaussian mixture with $p_K$ free parameters, $\mathrm{BIC}=-2\log\hat L+p_K\log n$. Its estimand is the penalised fit, lower is better, and it is not divided by $n$, so values compare only within one cell set. The held-out mean log-density per cell over $K$-fold splits is a per-cell alternative. Regime: large $n$ and an approximately correct mixture on a continuous embedding.

**Assumptions and failure modes.**

- Geometric indices assume the embedding preserves the distances that define the biological partition; non-convex clusters, typical of graph-based partitions, can score low although correct.
- Silhouette uses Euclidean distance in PCA space while Leiden partitions come from a kNN graph [R12], so disagreement can reflect that mismatch.
- Small clusters give unstable silhouettes, and the mean is dominated by large clusters.
- Label-based comparators are circular when the annotation came from the same clustering. Resampling statistics measure the stability of a procedure, not biological distinctness.

**Insight.** Geometric indices reward compactness and separation within one embedding, which is not the same as biological distinctness. Whether a score validates a clustering therefore reduces to whether the separation it measures tracks the biological partition, which only held-out labels or planted structure can settle. A likelihood per $K$ adds a held-out criterion and a bootstrap interval for the chosen $K$; whether it beats geometric scores is the hypothesis B2 tests.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Silhouette width | heuristic | Mean of $(b_i-a_i)/\max(a_i,b_i)$, with per-cluster means | [R1] |
| Davies-Bouldin index | heuristic | Mean over clusters of the worst scatter-to-separation ratio | [R2] |
| Calinski-Harabasz index | heuristic | Between-to-within dispersion ratio with a degrees-of-freedom factor | [R3] |
| scIB label and batch silhouette | heuristic | Silhouette on annotations rescaled to $[0,1]$; batch mixing within cell types | [R4] |
| Subsampling robustness (chooseR) | hybrid | Co-clustering frequencies over subsamples, scored by silhouette | [R9] |
| cNMF consensus silhouette | hybrid | k-means on consensus spectra, scored by silhouette, to choose the number of programmes | [R10] |
| Adjusted Rand index | heuristic | Chance-corrected pair agreement between two partitions | [R6] |

The three classical geometric indices are the published label-free standard, and the scIB silhouette terms are the standard label-based integration evaluation [R4]; ARI is the standard agreement statistic. The likelihood criterion has no published single-cell counterpart among the works cited here, so it is a proposal and not in the table.

Defaults taken from the repositories in section 12; line numbers refer to corpus snapshots.

| Method | Parameter | Value | Source |
|---|---|---|---|
| Silhouette | metric | `euclidean` | scikit-learn `sklearn/metrics/cluster/_unsupervised.py:59-60` |
| Silhouette | sample_size | `None` (exact) | scikit-learn `sklearn/metrics/cluster/_unsupervised.py:60` |
| Davies-Bouldin | arguments | `(X, labels)`, no tunable parameters | scikit-learn `sklearn/metrics/cluster/_unsupervised.py:413` |
| Calinski-Harabasz | arguments | `(X, labels)`, no tunable parameters | scikit-learn `sklearn/metrics/cluster/_unsupervised.py:333` |
| scIB silhouette | metric, scale | `euclidean`, `True` | scib `scib/metrics/silhouette.py:12` |
| scIB silhouette | rescaling | $(\bar s+1)/2$ | scib `scib/metrics/silhouette.py:52-53` |
| scIB batch silhouette | metric | `euclidean` | scib `scib/metrics/silhouette.py:63` |
| scIB batch silhouette | per-cell term | $1-\lvert s_i^{(B)}\rvert$ | scib `scib/metrics/silhouette.py:138-147` |
| cNMF silhouette | metric | `euclidean` on L2-normalised consensus spectra | cNMF `src/cnmf/cnmf.py:923` |
| cNMF k-means | n_init, random_state | 10, 1 | cNMF `src/cnmf/cnmf.py:908` |

## 5. Proposed singlet approach

**Routes.** Silhouette, Davies-Bouldin, Calinski-Harabasz, the scIB terms and the cNMF silhouette step are **ported** from permissively licensed code (section 12); ARI is **reimplemented** from its contingency form. chooseR and Splatter are **callouts**, a timing comparator and a data generator for B2.

**Primary formulation.** The tool computes each requested index on each candidate partition in one embedding and cell set, writes per-cell silhouette and a per-partition table, and reports `optimum_interior` (the best partition is not at the edge of the swept range) and `supported` (mean silhouette at or above `support_threshold`). The flag is a review signal, not a granularity choice.

**Model-based proposal.** For each candidate $K$, fit a Gaussian mixture in the chosen embedding, record BIC and held-out log-density over $K$-fold splits, and bootstrap cells for an interval on the chosen $K$. Annotation labels are excluded from fitting. The formulation is rejected if, on the convex strong-separation designs of B2, its exact-K recovery is not above the silhouette comparator's. It enters the enum only after B2 calibrates it; until then the default is silhouette, a published method.

**Stack.** Blockwise pairwise distances for exact silhouette are a candidate hard-coded CUDA kernel; mixture EM reduces to matrix products suited to cuBLAS-style kernels. PyTorch serves only batched fitting. These are plans that P1 measures, and every kernel has a CPU path.

**Defaults an agent uses without asking.** `embedding` X_pca; indices silhouette, Davies-Bouldin and Calinski-Harabasz; metric euclidean; exact silhouette, blockwise above the inline budget; `support_threshold` 0.25 (proposed, uncalibrated); seed 0; device auto.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/<embedding> | float32 | Embedding for every distance; default `X_pca` |
| read | obs/<cluster_key> | category | One candidate partition per key, on the same cells |
| read | obs/<label_key> | category | Annotation labels, for `asw_label` and B1 only |
| read | obs/<batch_key> | category | Batch labels, for `asw_batch` only |
| write | obs/<name>_silhouette | float32 | Per-cell silhouette for partition `<name>` |
| write | uns/cluster_validity/<name>/scores | table | Per partition: cluster count and each index, sign-harmonised |
| write | uns/cluster_validity/<name>/per_cluster | table | Per-cluster mean silhouette and size |
| write | uns/cluster_validity/<name>/flag | dict | Chosen partition, `optimum_interior`, `supported` |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (s3://, r2://, https://) or a workspace handle. |
| `embedding` | string | "X_pca" | — | obsm key of the embedding used for every distance; all partitions share it. |
| `cluster_keys` | array | required | — | obs columns holding candidate partitions, one per resolution or k; all scored on the same cells. |
| `indices` | array | ["silhouette", "davies_bouldin", "calinski_harabasz"] | — | Indices to compute. asw_label and asw_batch need scib_asw keys and are label-based comparators. |
| `metric` | string | "euclidean" | — | Distance for silhouette and scIB terms; a scikit-learn metric name. |
| `min_clusters` | integer | 2 | min 2 | Smallest number of clusters in a partition considered for scoring. |
| `silhouette` | object | — | — | Options for the silhouette index and its support flag. |
| `silhouette.sample_size` | integer/null | null | min 2 | Subsample size for approximate silhouette; null computes the exact value. |
| `silhouette.support_threshold` | number | 0.25 | min 0; max 1 | Mean silhouette below which the flag reports unsupported granularity; proposed, uncalibrated. |
| `scib_asw` | object | — | — | Label and batch keys for the scIB terms. |
| `scib_asw.label_key` | string | — | — | obs column of annotation labels; required for asw_label and benchmark B1. |
| `scib_asw.batch_key` | string | — | — | obs column of batch labels; required for asw_batch. |
| `seed` | integer | 0 | — | Seed for subsampling and k-means initialisation. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules: `asw_label` requires `scib_asw.label_key` and `asw_batch` requires `scib_asw.batch_key`; the call is rejected otherwise. All partitions share one cell set and one embedding, and mixed inputs are rejected. Label keys must not hold output of clustering on the same embedding. Davies-Bouldin is sign-reversed in the ranking column, so higher is better for every index.

## 7. MCP tool

Tool name `singlet_evaluation_cluster_validity_indices` (definition in `tasks/mcp/singlet_evaluation_cluster_validity_indices.json`). Example call and result:

```json
{"dataset": "data/example.singlet", "cluster_keys": ["leiden_r0.4", "leiden_r0.8"], "indices": ["silhouette", "davies_bouldin", "calinski_harabasz"], "seed": 0}
```

```json
{
  "dataset": "data/example.singlet",
  "status": "completed",
  "wrote": ["obs/<name>_silhouette", "uns/cluster_validity/<name>/scores"],
  "summary": {
    "partitions": [
      {"name": "leiden_r0.4", "n_clusters": "<int>", "silhouette": "<in [-1, 1]>",
       "davies_bouldin": "<>= 0, lower is better>", "calinski_harabasz": "<>= 0>"}
    ],
    "chosen_partition": "<name>",
    "supported": "<bool>"
  },
  "provenance_id": "<id>",
  "job_id": null
}
```

Long-running: the job is queued when the estimate exceeds the inline budget, and exact silhouette at $10^6$ cells uses the blockwise path. Stochastic: `seed` controls subsampling and k-means initialisation; the other indices are deterministic given the partitions. Dry run: returns estimated seconds, peak memory and device from the $O(n^2 d)$ distance cost in section 3.

## 8. Benchmarks

All benchmarks share one protocol. The cell set, the embedding (PCA with 50 components, identical for every index) and the candidate partitions are fixed before scoring, with seed 0. Each index is scored per dataset or simulation and aggregated by median; rank correlations use average ranks for ties. Thresholds are set on a pilot set of datasets and evaluated only on held-out datasets. Results are reported per embedding, since index orderings change with the embedding. Benchmarks marked proposed have no published counterpart.

### B1. Resolution-sweep agreement with author annotations (proposed)

- **Goal**: whether index orderings over a resolution grid match ARI to author annotations, and whether index optima match the best granularity.
- **Ground truth**: author annotations, excluding any produced by clustering the same embedding. Estimand: ARI of candidate partition to annotation, in $[-1,1]$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Author-annotated subset of the singlet catalogue, chosen by query | singlet catalogue | scRNA-seq; size set by the query | — | Multi-level annotations |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Spearman rho per dataset | Rank correlation of index value with ARI over the grid; Davies-Bouldin sign reversed | higher | primary | [R6] |
| Top-choice agreement | 1 if index and ARI argmax agree (ties to fewer clusters), mean over datasets | higher | primary | — |
| ARI at chosen partition | ARI of the index-selected partition to the annotation | higher | guardrail | [R6] |

- **Comparators**: silhouette, Davies-Bouldin, Calinski-Harabasz; scIB label silhouette as a reference only.
- **Protocol**: Leiden resolution grid fixed in advance [R12].
- **Acceptance criterion** (proposed, not from literature): median rho of at least 0.5 and top-choice agreement of at least 0.6 before an index is described as supporting granularity.
- **Known pitfalls**: cluster-size imbalance weights silhouette and ARI differently; an optimum at the grid edge makes top-choice agreement uninformative.

### B2. Planted-structure simulation (proposed)

- **Goal**: whether each index recovers the planted group number.
- **Ground truth**: planted labels fixed by design; exact-K recovery is the indicator that the argmax over $k\in\{2,\dots,2K\}$ equals $K$.
- **Generator recipe** (proposed):
  1. Splatter [R8] simulations with $K\in\{3,5,8,12\}$, three differential-expression strengths, two cell-count levels and fixed seeds.
  2. Non-convex design: groups along a one-dimensional path, at strong strength.
  3. Log-normalise, compute 50 PCA components, and form candidates: k-means with seed 0 for each $k\in\{2,\dots,2K\}$ and a Leiden sweep [R12].
  4. Score each index; record argmax $k$ and flag.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter simulations (recipe grid) | [R8] | simulated scRNA-seq; size set by recipe | — | Generated |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Exact-K recovery rate | Fraction with argmax equal to planted $K$ | higher | primary | — |
| ARI(planted, chosen) | ARI to planted labels at chosen $k$, mean over simulations | higher | primary | [R6] |
| Flag precision | Precision of flags against planted $K$ | higher | guardrail | — |

- **Comparators**: silhouette, Davies-Bouldin, Calinski-Harabasz, and k-means with true $K$.
- **Acceptance criterion** (proposed): exact-K recovery at least 0.8 on strong-separation convex designs; flag precision at least 0.9; non-convex failure rates unthresholded.
- **Known pitfalls**: compact groups favour k-means-style indices, so success does not transfer to real data.

### P1. Performance and scaling

Scales are $10^4$, $10^5$ and $10^6$ cells at $d=50$, with about ten candidate partitions of up to 50 clusters each. Comparators: scikit-learn exact silhouette and silhouette with `sample_size`; the scIB silhouette; scikit-learn Calinski-Harabasz and Davies-Bouldin; the chooseR subsampling loop, costed per iteration times resolutions; and the cNMF silhouette step. Hold fixed: $d=50$, Euclidean metric, identical partitions, one CPU node, and a GPU run if a CUDA variant is built. Report wall time, peak resident memory, and the absolute error of sampled silhouette against exact at $10^4$ and $10^5$ cells. At $10^6$ cells the full distance matrix is infeasible on typical memory, so blockwise exact is the comparator. Proposed acceptance: sampled silhouette within 0.01 of exact at $10^5$ cells, and exact silhouette completing at $10^5$ cells on one node within a time budget set on a pilot.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Feeds**:
  - `clustering.resolution_selection`: Choosing clustering resolution without reference labels
  - `clustering.cluster_number_estimation`: Estimating the number of cell clusters or types
- **Reads**: `obsm/<embedding>`, `obs/<cluster_key>`, `obs/<label_key>`, `obs/<batch_key>`
- **Writes**: `obs/<name>_silhouette`, `uns/cluster_validity/<name>/scores`, `uns/cluster_validity/<name>/per_cluster`, `uns/cluster_validity/<name>/flag`
<!-- CHAINING:AUTO:END -->

Workflow: the granularity-selection step after partitioning and before annotation; no named recipe yet.

## 10. Risks, pitfalls and open questions

- **Gaps in the literature record**: Rautenstrauch and Ohler (2026) appear in the corpus only as a bibliographic record and a notebook sentence, and the paper body is absent. Luecken et al. carry year 2021 in one corpus record and 2022 in another; this document uses 2022. chooseR parameter defaults were not extracted, and its README (2020, different title) conflicts with the 2021 record. BMC Bioinformatics and eLife venues are inferred from DOI prefixes.
- **Clustering Deviation Index** [R11]: no local source describes its method, so only the R package metadata and README are available and CDI is excluded from comparators. Its paper's author list is absent from the corpus, and its venue is inferred from the DOI prefix.
- **Provenance and undefined benchmarks**: file:line references point to corpus snapshots without commit identifiers and need re-pinning before porting. The ARI form is written from the standard definition and is not checked line by line against [R6]. No batch-confounded or scIB benchmark datasets with accessions were located, and terms of use for the catalogue's author annotations are not established, so B1 cannot be published yet. Splatter parameter names were not extracted.
- **First experiment**: on the convex strong-separation designs of B2, compare silhouette exact-K recovery with the proposed likelihood criterion, then apply B1 to held-out datasets. The thresholds (0.25, 0.5, 0.6, 0.8, 0.9) are proposals without literature support.

## 11. References

R1. Rousseeuw PJ. Silhouettes: a graphical aid to the interpretation and validation of cluster analysis. *Journal of Computational and Applied Mathematics* 1987;20:53–65. doi:10.1016/0377-0427(87)90125-7 — partial (repo)
R2. Davies DL, Bouldin DW. A cluster separation measure. *IEEE Transactions on Pattern Analysis and Machine Intelligence* 1979;PAMI-1(2):224–227. doi:10.1109/TPAMI.1979.4766909 — partial (repo)
R3. Calinski T, Harabasz J. A dendrite method for cluster analysis. *Communications in Statistics - Theory and Methods* 1974;3:1–27. doi:10.1080/03610927408827101 — partial (repo)
R4. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R5. Rautenstrauch P, Ohler U. Shortcomings of silhouette in single-cell integration benchmarking. *Nature Biotechnology* 2026. doi:10.1038/s41587-025-02743-4 — verified (corpus)
R6. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R7. Kiselev VY, Andrews TS, Hemberg M. Challenges in unsupervised clustering of single-cell RNA-seq data. *Nature Reviews Genetics* 2019. doi:10.1038/s41576-018-0088-9 — verified (corpus)
R8. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R9. Patterson-Cross RB, Levin AJ, Menon V. Selecting single cell clustering parameter values using subsampling-based robustness metrics. *BMC Bioinformatics* 2021. doi:10.1186/s12859-021-03957-4 — verified (corpus)
R10. Kotliar D, et al. Identifying gene expression programs of cell-type identity and cellular activity with single-cell RNA-Seq. *eLife* 2019. doi:10.7554/elife.43803 — verified (corpus)
R11. — . Clustering Deviation Index (CDI): a robust and accurate internal measure for evaluating scRNA-seq data clustering. *Genome Biology* 2022. doi:10.1186/s13059-022-02825-5 — verified (corpus)
R12. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scikit-learn/scikit-learn | scikit-learn developers | BSD-3-Clause (COPYING) | reference silhouette, Davies-Bouldin and Calinski-Harabasz | port |
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller and others (pyproject.toml) | MIT (LICENSE.txt) | label and batch silhouette terms | port |
| https://github.com/dylkot/cNMF | Dylan Kotliar (setup.py) | MIT (LICENSE) | consensus silhouette step | port |
| https://github.com/rbpatt2019/chooseR | Patterson-Cross RB, Levin AJ, Menon V (README citation) | GPL-3.0 (LICENSE) | subsampling-robustness timing comparator | callout |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Christina Azodi, Alicia Oshlack (DESCRIPTION) | GPL-3 (LICENSE; DESCRIPTION: GPL-3 + file LICENSE) | data generator for B2 | callout |
| https://github.com/jichunxie/CDI | Jiyuan Fang (DESCRIPTION: cre, aut) | GPL-3 (LICENSE; DESCRIPTION: GPL-3 + file LICENSE) | excluded from comparators (section 10) | — |
