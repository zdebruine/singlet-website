---
id: integration.integration_quality_scoring
title: Integration quality scoring
area: integration
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [integration.batch_corrected_embedding, dim-reduction.normalized_cell_embedding]
feeds: [evaluation.overcorrection_detection]
reads: [obsm/X_pca, obsm/X_integrated_<method>, obsp/<graph>_connectivities, obsp/<graph>_distances, layers/integrated_expr, layers/log1p_norm, obs/<batch_key>, obs/<label_key>, obs/S_score, obs/G2M_score, obs/<pseudotime_key>]
writes: [uns/integration_quality/<name>, uns/integration_quality/aggregate, obs/<name>_silhouette_batch, obs/<name>_silhouette_label, obs/<name>_ilisi, obs/<name>_clisi]
devices: [cpu, cuda]
mcp_tool: singlet_integration_integration_quality_scoring
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Integration quality scoring

> Score how well an integrated embedding, neighbour graph or corrected matrix removes batch structure while keeping cell-type, cell-cycle and trajectory structure, using the published scIB metric suite as the reference and a calibrated model-based batch score tested against planted truth.

## 1. Question

Given cells from $B\ge 2$ batches with batch and cell-type labels, an unintegrated baseline embedding, and one or more integrated outputs (an embedding, a kNN graph or a corrected expression matrix): how much batch structure remains in each output, how much biological structure (cell types, cell cycle, trajectory, variable genes) was lost, and how do the outputs rank? The result is a set of scalar scores per metric and output, an aggregate and a ranking; nothing is fitted or modified. In the literature a score is correct when it reproduces the scIB reference implementation [R1]; no external truth exists for over-correction, so singlet adds planted controls (B2, B3).

## 2. Why this task matters and where the field stands

Integration methods are chosen and tuned on these scores, so the definition of the score decides which method a study reports. The scIB study defined 14 metrics in two groups (batch removal, biological conservation), benchmarked 16 methods on 13 integration tasks covering 85 batches, and proposed a weighted aggregate [R1]. Open Problems maintains the family as a living benchmark [R7]; the principles of integration are reviewed in [R2].

The status is **contested**. The groups trade off: an embedding collapsed to a point maximises every batch metric, so a batch score is meaningless without a conservation score. No method is best in every scenario: Harmony and Seurat do well on simple batch-correction tasks, scVI, scGen, scANVI and Scanorama on complex integration tasks [R10]; earlier benchmarks covered few-batch tasks [R5][R6]. Metric validity is disputed: silhouette-based scores are argued to be unreliable for both batch removal and conservation [R8], and a bioRxiv preprint reports that common metrics rank methods inconsistently under imbalanced batch composition and partial cell-type overlap [R9].

Open problems:

- No ground truth exists for over-correction; the batch/biology trade-off is a convention (0.4/0.6, [R10]).
- Label-aware integration (scANVI, scGen) is scored with the labels it used [R1][R10].
- kBET and LISI depend on neighbourhood size and graph construction. scib computes LISI from shortest-path distances on a 15-NN graph, whereas ciLISI [R11] uses Euclidean neighbours, so the two are not interchangeable.
- Min-max aggregation makes scores relative to the compared set; its effect on rankings is not quantified in the sources read.
- Fallbacks (kBET rejection set to 1, trajectory set to 0) enter the means as ordinary values and change rankings when many methods fail.

## 3. Theory and insight

**Estimand.** A representation $\mathbf z_c$ of cell $c$ with batch $b_c$ and label $y_c$ should satisfy $I(b;\mathbf z\mid y)\approx 0$ while $I(y;\mathbf z)$ stays high. No metric estimates these terms; each is a graph, geometric or clustering statistic approximating one side. A constant representation makes both zero, so batch-only criteria reward collapse; the suite stratifies by label. Every score is per output, in $[0,1]$, higher is better (ARI can be negative; it is 0 at chance). Notation: $N$ cells, $B$ batches, $L$ labels, $N_j$, $B_j$ the cells and batches of label $j$, $\mathcal N_c$ the neighbours of $c$.

**kBET [R4].** For a tested cell $c$ of label $j$ with $k_0$ neighbours (itself included) taken inside label $j$, and $\hat\pi_{jb}$ the within-label batch proportion,

$$\chi^2_c=\sum_{b}\frac{(O_{cb}-k_0\hat\pi_{jb})^2}{k_0\hat\pi_{jb}},\qquad O_{cb}=\#\{i\in\mathcal N_c:\ b_i=b\},$$

with p-value from $\chi^2_{B_j-1}$. With $\bar r_j$ the rejection fraction at level $\alpha$ over random test sets, $\mathrm{kBET}=1-\frac{1}{|\mathcal J|}\sum_{j\in\mathcal J}\bar r_j$ over the testable labels $\mathcal J$. Regime: the chi-squared law needs $k_0\hat\pi_{jb}\gtrsim 5$, so rare batches weaken the test; overlapping neighbourhoods make rejections positively dependent, so the standard error of $\bar r_j$ exceeds the binomial one; the rate equals $\alpha$ only when batch labels are exchangeable within the label (permutation check in B4).

**LISI [R3].** With $\mathcal N_c$ the $k=90$ nearest cells by shortest-path distance $d_{cj}$ on the 15-NN graph and $u=\lfloor k/3\rfloor=30$ the target perplexity,

$$P_{cj}\propto e^{-\beta_c d_{cj}}\ \ \text{with}\ H(P_{c\cdot})=\ln u,\qquad p_{cb}=\sum_{j\in\mathcal N_c}P_{cj}\mathbf 1[b_j=b],\qquad \Psi_c=\Bigl(\sum_b p_{cb}^2\Bigr)^{-1}\in[1,\min(B,k)].$$

Then $\mathrm{iLISI}=(\operatorname{med}_c\Psi_c-1)/(B-1)$ and $\mathrm{cLISI}=(L-\operatorname{med}_c\Psi^{(y)}_c)/(L-1)$ with labels in place of batches. Regime: iLISI reaches 1 only if every neighbourhood is balanced over all $B$ batches, impossible for $B>k$ and unattainable for a cell type present in few batches, so global iLISI penalises legitimate composition differences. ciLISI [R11] applies the index within each cell-type group, rescaled by its $B_g$ batches as $(\Psi_c-1)/(B_g-1)$, with Euclidean neighbours; `cilisi` averages over cells, `cilisi_means` over groups.

**Silhouette widths.** With $a_c$ the mean distance to the cell's own group and $d_c$ the smallest mean distance to another group, $s_c=(d_c-a_c)/\max(a_c,d_c)$ [R15],

$$\mathrm{ASW}_{\rm label}=\frac{\bar s^{(y)}+1}{2},\qquad \mathrm{ASW}_{\rm batch}=\frac{1}{|\mathcal J_s|}\sum_{j\in\mathcal J_s}\frac{1}{N_j}\sum_{c:\,y_c=j}\bigl(1-\lvert s^{(b)}_c\rvert\bigr),$$

where $s^{(y)}$ uses labels as groups over all cells, $s^{(b)}$ uses batches as groups within label $j$, and $\mathcal J_s$ excludes labels present in one batch. Regime: Euclidean distance and compact groups. Batch ASW forces each label into $B_j$ groups whatever the biology and so rewards collapse of batch-specific states; [R8] argues silhouettes cannot reliably assess batch removal or conservation.

**Principal component regression.** With $R^2_p$ the between-batch share of the variance of component $p$ and $w_p=\sigma^2_p/\sum_{p'}\sigma^2_{p'}$ over the $P$ retained components,

$$\mathrm{Var}_B=\sum_{p=1}^{P}w_pR^2_p,\qquad \mathrm{PCR}=\max\Bigl\{0,\frac{\mathrm{Var}_{B,\rm pre}-\mathrm{Var}_{B,\rm post}}{\mathrm{Var}_{B,\rm pre}}\Bigr\}.$$

Regime: it detects shifts of batch means in leading components, not changes of shape or scale; the clip hides increases of batch variance. **Graph connectivity** is $\mathrm{GC}=\frac1L\sum_j\lvert\mathrm{LCC}(G_j)\rvert/N_j$ with $G_j$ the output graph induced on label $j$; it falls only when a label splits into batch islands.

**Clustering-based scores.** Leiden [R14] partitions $\hat C_r$ of the output graph are computed on a resolution grid, $r^\ast=\arg\max_r\mathrm{NMI}$, and

$$\mathrm{NMI}=\frac{I(Y;\hat C)}{\tfrac12\bigl(H(Y)+H(\hat C)\bigr)},\qquad \mathrm{ARI}=\frac{\mathrm{Index}-E}{\mathrm{MaxIndex}-E}\ [R16],\quad \mathrm{MaxIndex}=\tfrac12\Bigl(\sum_i\tbinom{a_i}{2}+\sum_j\tbinom{b_j}{2}\Bigr),$$

both at $r^\ast$, with $\mathrm{Index}$ the number of cell pairs together in both partitions, $E$ its expectation under random pairing for cluster sizes $a_i$ and label sizes $b_j$; best-of-grid selection biases NMI upward. Isolated labels $I$ (present in the fewest batches): isolated F1 is $\frac1{|I|}\sum_{j\in I}\max_r\max_{\hat c\in\hat C_r}F_1(j,\hat c)$ and isolated ASW is $\frac1{|I|}\sum_{j\in I}(\bar s^{(y)}_j+1)/2$, with $\bar s^{(y)}_j$ the mean all-label silhouette of label $j$. kSIM [R12] is $\frac1K\sum_{i\in\mathcal N_K(c)}\mathbf 1[y_i=y_c]$ with $c$ among its own $K$ neighbours; `ksim_mean` averages over cells, `ksim_accept_rate` is the fraction of cells with value $\ge\rho_{\min}$.

**Annotated structure.** Cell-cycle conservation: within each batch, the PC-regression variance contribution $V$ of the S and G2M scores is computed on the unintegrated expression and on the output, and $\mathrm{CC}=\operatorname{mean}_b\max\{0,1-\lvert V^{\rm post}_b-V^{\rm pre}_b\rvert/V^{\rm pre}_b\}$, penalising loss and gain alike. Trajectory conservation is $(\rho_s(\tau_{\rm pre},\tau_{\rm post})+1)/2$ between diffusion pseudotime [R13] before integration and on the output graph; the root is the cell of the earliest label (lowest mean pre-integration pseudotime) most extreme in the first three diffusion components of the output, so a reversed orientation scores near 0. HVG overlap is $\frac1B\sum_b\lvert X_b\cap Y_b\rvert/\min(\lvert X_b\rvert,\lvert Y_b\rvert)$ for the top variable genes $X_b$, $Y_b$ of batch $b$ before and after integration (feature outputs only).

**Aggregate.** Each metric is min-max scaled across the outputs of one call, so adding an output changes every minimum and maximum. The batch group is kBET, iLISI, graph connectivity, PCR and batch ASW; the biological group is label ASW, cLISI, NMI, ARI, isolated F1, isolated ASW, cell-cycle conservation, HVG overlap and trajectory conservation (scib README). Overall $=0.4\,\bar s_{\rm batch}+0.6\,\bar s_{\rm bio}$ [R10]. A biological metric undefined for some compared outputs enters its group mean only if defined for all of them, otherwise it is reported separately.

**What a model adds.** The heuristics are local, cheap and standardised, but carry no uncertainty, depend on fixed $k$, $\alpha$ and grids, and set the batch/biology trade-off by convention. **M1 (batch predictability)**: for label $j$ with batch proportions $\pi_{jb}$ and $H_j=-\sum_b\pi_{jb}\ln\pi_{jb}$, fit an L2-regularised multinomial logistic model $q(b\mid\mathbf z,y=j)$ on at most $P$ coordinates and take its cross-validated cross-entropy $\mathrm{CE}_j$. Then

$$\Delta_j=H_j-\mathrm{CE}_j\ \le\ I(b;\mathbf z\mid y=j),\qquad \mathrm{Mix}=\operatorname{mean}_{j}\min\{1,\mathrm{CE}_j/H_j\},$$

because $\mathrm{CE}_j\ge H(b\mid\mathbf z,y=j)$ in expectation over held-out cells. The bound is tight for a Bayes-optimal classifier and loose for a linear one under non-linear batch effects. Mix is 1 when batch is unpredictable and 0 when fully predictable, averaged unweighted over labels with at least two batches. Regime: held-out cells per label far exceed the parameters; the plug-in $H_j$ is biased low by about $(B_j-1)/(2N_j)$ nats, which makes $\Delta_j$ conservative.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| kBET | heuristic | per-label chi-squared test of neighbour batch counts against within-label proportions; score is one minus the mean rejection rate | [R4] |
| iLISI, cLISI | heuristic | inverse Simpson index of batch (label) composition in perplexity-weighted neighbourhoods, median over cells, rescaled | [R3] |
| ciLISI | heuristic | iLISI within each cell-type group, rescaled by the batches in the group | [R11] |
| Batch ASW, label ASW | heuristic | silhouette on batch labels within label (one minus absolute value); silhouette on labels, rescaled | [R15] |
| Graph connectivity | heuristic | share of each label's cells in the largest connected component of its induced subgraph | [R1] |
| PCR batch | hybrid | relative reduction of the variance of leading principal components explained by batch | [R1] |
| NMI, ARI | heuristic | agreement of Leiden clusters at the NMI-optimal resolution with labels | [R14][R16] |
| Isolated-label F1, ASW | heuristic | best-cluster F1 and mean silhouette for the labels present in the fewest batches | [R1] |
| Cell-cycle conservation | hybrid | change of the S and G2M score variance explained in principal components, per batch | [R1] |
| Trajectory conservation | heuristic | rescaled Spearman correlation of diffusion pseudotime before and after | [R13] |
| HVG overlap | heuristic | overlap coefficient of per-batch highly variable genes before and after | [R1] |
| kSIM | heuristic | fraction of the K neighbours sharing the cell's label; mean and acceptance rate | [R12] |
| Aggregate | heuristic | min-max scaled metrics, batch and biological group means, weights 0.4 and 0.6 | [R1][R10] |
| Batch predictability (M1) | model-based | held-out cross-entropy of a batch classifier within each label; lower bound on conditional mutual information | section 3 |

The published standard is the 14-metric scIB suite [R1]. Open Problems [R7] wraps the same functions with different grids and subsampling and adds ciLISI, kSIM and others. All are heuristics with fixed neighbourhood sizes, levels and grids; singlet keeps them as default and comparator, and adds M1 as the proposed model-based batch score.

Defaults of the methods singlet implements (scib at cd67913, version 1.1.7):

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| kBET | neighbourhood size $k_0$ | min(70, max(10, floor(mean batch size in the label / 4))) | scib kbet.py:111-114 @ cd67913 |
| kBET | neighbour graph | 50-NN graph; $k_0$ neighbours ranked by accumulated random-walk weights within the label | kbet.py:79; utils.py:96-150 |
| kBET | testable labels | at least 10 cells and more than one batch; others NaN and excluded | kbet.py:101-105 |
| kBET | failure score | rejection 1 if neighbours are not found or under 75% of the label's cells lie in components of at least $3k_0$ | kbet.py:140-177 |
| kBET | test set, level, repeats | 10% of cells (at least 25), alpha 0.05, 100 repeats, mean taken | kBET.R:71-72, 203-208, 436-440 @ afc5f43 |
| iLISI, cLISI | neighbours, perplexity | 90, floor(90/3) = 30; graph from 15-NN, shortest-path distances | scib lisi.py:45, 123, 202, 246 |
| iLISI, cLISI | scaling | (median - 1)/(B - 1); (L - median)/(L - 1) | lisi.py:108-112, 190-194 |
| LISI in `metrics()` | subsample | 0.5 of cells (function default: all cells) | metrics.py:206 |
| ASW | metric, scaling | Euclidean; label (s + 1)/2; batch 1 - abs(s); one-batch labels skipped | silhouette.py:12, 52-53, 135, 145-147 |
| PCR | components, weights, clip | 50; component variance over total; negative score set to 0 | pcr.py:14, 94-100, 294-295 |
| Graph connectivity | components | strongly connected, per label | graph_connectivity.py:51-59 |
| Clustering | algorithm, grid | Leiden; 0.2 to 2.0 in ten steps; ARI at the NMI-optimal resolution | clustering.py:98-99, 110-111; metrics.py:301-329 |
| NMI | normalisation | arithmetic mean of entropies | nmi.py:17 |
| Isolated labels | definition | labels present in at most the minimum number of batches over labels | isolated_labels.py:315, 327 |
| Isolated F1, ASW | scores | best-cluster F1, resolution chosen per label; mean all-label silhouette, (s + 1)/2 | isolated_labels.py:262, 275-277, 284-291 |
| HVG overlap | genes, flavour, denominator | 500 capped at half the genes; cell_ranger; smaller set size | highly_variable_genes.py:12, 28, 33, 87-88 |
| Trajectory | key, components, failure | `dpt_pseudotime`; 3; score 0 if no root | trajectory.py:11, 110, 65-66, 81-82 |
| Cell cycle | per batch, aggregation | 50 PCs on unintegrated expression; mean over batches | cell_cycle.py:109-118, 203-206; metrics.py:368 |
| kSIM | K, minimum rate, cap | 25 (cell included), 0.9, K at most floor(sqrt N) | pegasus nearest_neighbors.py:199-201, 508-513 @ 484617d |
| ciLISI | neighbours, minima, scaling | 30; 10 cells and 2 batches per group; (LISI - 1)/(batches in group - 1) | scIntegrationMetrics utils.R:56, 66, 180-181, 217-220 @ 8d6b436 |
| Open Problems wrappers | resolutions, LISI subsample | 0.2 to 0.8 in steps of 0.1; none | clustering_overlap/config.vsh.yaml:98-102; isolated_label_f1/config.vsh.yaml:41-45; lisi/script.py:31, 44 @ b3da9d6 |
| Aggregate | weights | batch 0.4, biological 0.6 | best-practices integration chapter [R10] |

## 5. Proposed singlet approach

**Routes** (licences in section 12). Port the scib metric functions (kBET statistic, LISI, silhouettes, PCR, graph connectivity, isolated labels, HVG overlap, cell cycle, trajectory, aggregate) and kSIM from pegasus. Reimplement ciLISI from [R11] and the definition in scIntegrationMetrics. The R LISI package, the Open Problems wrappers and scib-metrics are callouts. Leiden comes from the shared clustering core (`clustering.cell_partitioning`).

**Model-based formulation.** `batch_predictability` (M1, section 3) is added beside the heuristics and never replaces them; it stays outside the default metric set until B2 and B4 are met. M1 is falsified if its bound-violation rate in B4 exceeds 5% or if Mix fails to fall with planted strength in B2 ($\rho>-0.9$). Further candidates are listed in section 10.

**ML stack.** M1 is a small convex GLM (multinomial logistic regression with L2 on at most 50 coordinates, regularisation chosen by inner cross-validation), fitted by Newton iterations in the C++ core and by batched small Hessian solves on CUDA; no PyTorch is needed. A neural classifier would tighten the bound at higher cost and would use PyTorch.

**Kernels.** Neighbourhood composition counts are an SpMM of the graph with a one-hot batch or label matrix (cuSPARSE). LISI needs a bounded shortest-path search to 90 neighbours per cell on the 15-NN graph, parallel over cells. kBET's neighbour ranking needs accumulated random-walk weights within each label; scib materialises a dense $N_j\times N_j$ matrix (utils.py:124-127), so singlet uses sparse top-k pruned powers, whose agreement with the dense version is tested in B1. Silhouettes use blocked GEMM distances and, above a size threshold, a label-stratified subsample marked as sampled in the record. PCR needs only per-batch means of each component (one-way ANOVA, no solve). Graph connectivity uses union-find. Leiden stays on the CPU. Out-of-core processing is not claimed.

**Defaults an agent uses without asking.** Score every named output with the 14 scIB metrics, report batch and biological scores together, use `minmax` scaling with weights 0.4 and 0.6 and seed 0, and never compare aggregates from different calls.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `obsm/X_pca` (or `baseline_key`) | float, N x P | unintegrated baseline embedding; the before state of PCR |
| read | `obsm/X_integrated_<method>` | float, N x d | integrated embedding |
| read | `obsp/<graph>_connectivities`, `obsp/<graph>_distances` | sparse float, N x N | integrated kNN graph used as given; both required |
| read | `layers/integrated_expr` | float, N x G | corrected expression matrix |
| read | `layers/log1p_norm` | float, N x G | unintegrated log-normalised expression: before state of HVG overlap and cell cycle |
| read | `obs/<batch_key>`, `obs/<label_key>` | categorical | at least two levels, no missing values |
| read | `obs/S_score`, `obs/G2M_score` | float | cell-cycle scores on the unintegrated data |
| read | `obs/<pseudotime_key>` | float | pre-integration diffusion pseudotime |
| write | `uns/integration_quality/<name>` | dict | raw scores, output kind, `not_applicable`, `fallbacks`, parameters used |
| write | `uns/integration_quality/aggregate` | table | group means, overall score per output, scaling |
| write | `obs/<name>_silhouette_batch`, `obs/<name>_silhouette_label`, `obs/<name>_ilisi`, `obs/<name>_clisi` | float32 | per-cell values, only with `per_cell` |

`<name>` is the member name without its namespace (`obsm/X_integrated_harmony` gives `X_integrated_harmony`, `obsp/bbknn_connectivities` gives `bbknn`); duplicates in one call are an error.

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: .singlet path, URI (s3://, r2://, https://) or workspace handle. |
| `integrated_keys` | array | required | — | Outputs to score: obsm/<key> embedding, obsp/<prefix>_connectivities graph (needs _distances), layers/<key> features. |
| `baseline_key` | string | "obsm/X_pca" | — | Unintegrated embedding; the before state of pcr. |
| `batch_key` | string | "batch" | — | obs column of batch labels (at least two levels). |
| `label_key` | string | "cell_type" | — | obs column of cell-type labels (at least two levels). |
| `metrics` | array | ["kbet", "ilisi", "graph_connectivity", "pcr", "asw_batch", "clisi", "asw_label", "isolated_label_f1", "isolated_label_asw", "nmi", "ari", "hvg_overlap", "trajectory", "cell_cycle"] | — | Metrics to compute; default is the 14 scIB metrics. batch_predictability is experimental. |
| `per_cell` | boolean | false | — | Also write per-cell silhouettes and iLISI/cLISI as obs columns. |
| `options` | object | — | — | Metric-specific settings; omitted objects take their defaults. |
| `options.graph` | object | — | — | kNN graph for embedding and feature outputs. |
| `options.graph.k` | integer | 15 | min 2 | Neighbours; ignored for supplied graphs. |
| `options.kbet` | object | — | — | kBET settings. |
| `options.kbet.k` | integer/null | null | min 2 | Neighbourhood size; null uses the scIB rule per label. |
| `options.kbet.test_fraction` | number | 0.1 | max 1; > 0 | Fraction of cells per test set (at least 25 cells). |
| `options.kbet.alpha` | number | 0.05 | > 0; < 1 | Significance level of the chi-squared test. |
| `options.lisi` | object | — | — | iLISI and cLISI settings. |
| `options.lisi.k` | integer | 90 | min 3 | Neighbours; perplexity is floor(k / 3). |
| `options.lisi.subsample` | number | 1.0 | max 1; > 0 | Fraction of cells scored. |
| `options.cilisi` | object | — | — | ciLISI settings. |
| `options.cilisi.k` | integer | 30 | min 2 | Euclidean neighbours. |
| `options.ksim` | object | — | — | kSIM settings. |
| `options.ksim.k` | integer | 25 | min 2 | Neighbours including the cell; capped at floor(sqrt(N)). |
| `options.ksim.min_rate` | number | 0.9 | max 1; > 0 | Purity threshold of the acceptance rate. |
| `options.pcr` | object | — | — | PCR settings. |
| `options.pcr.n_comps` | integer | 50 | min 2 | Principal components; also used to reduce feature outputs. |
| `options.hvg_overlap` | object | — | — | HVG overlap settings. |
| `options.hvg_overlap.n_hvg` | integer | 500 | min 50 | Highly variable genes per batch, capped at half the genes. |
| `options.clustering` | object | — | — | Leiden settings. |
| `options.clustering.resolutions` | array | [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0] | — | Resolution grid for nmi, ari and isolated_label_f1. |
| `options.isolated_label` | object | — | — | Isolated-label settings. |
| `options.isolated_label.n_isolated` | integer/null | null | min 1 | Maximum batches per isolated label; null uses the minimum over labels. |
| `options.trajectory` | object | — | — | Trajectory settings. |
| `options.trajectory.pseudotime_key` | string | "dpt_pseudotime" | — | obs column of pre-integration pseudotime. |
| `options.batch_predictability` | object | — | — | M1 settings. |
| `options.batch_predictability.folds` | integer | 5 | min 2 | Cross-validation folds. |
| `options.aggregate` | object | — | — | Aggregate settings. |
| `options.aggregate.weights` | object | {"batch": 0.4, "bio": 0.6} | — | Batch and bio weights; must sum to 1. |
| `options.aggregate.weights.batch` | number | — | min 0 | Weight of the batch group. |
| `options.aggregate.weights.bio` | number | — | min 0 | Weight of the biological group. |
| `options.aggregate.scaling` | string | "minmax" | `minmax`, `raw` | minmax scales across outputs; raw averages unscaled values. |
| `seed` | integer | 0 | min 0 | Seed for kBET test sets, Leiden and cross-validation folds. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto prefers CUDA when memory suffices. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing. |
| `overwrite` | boolean | false | — | Replace existing records instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules. Embedding and feature outputs support every metric except `hvg_overlap`, which needs a feature output; graph outputs support `kbet`, `ilisi`, `clisi`, `graph_connectivity`, `nmi`, `ari`, `isolated_label_f1` and `trajectory`. Feature outputs are reduced to 50 principal components first. A metric that does not apply, or lacks its input (cell-cycle scores, pseudotime, `layers/log1p_norm`), is listed under `not_applicable` with the reason and never scored 0. Fallbacks follow scib and are listed in `fallbacks`: kBET labels with under 10 cells or one batch are NaN and excluded, kBET failures score rejection 1, trajectory without a root scores 0, PCR and cell cycle clip at 0. `options.aggregate.weights` must sum to 1; `minmax` needs at least two outputs.

## 7. MCP tool

Tool name `singlet_integration_integration_quality_scoring` (definition in `tasks/mcp/singlet_integration_integration_quality_scoring.json`). Example call and compact result:

```json
{"dataset": "pancreas.singlet", "batch_key": "batch", "label_key": "cell_type", "seed": 0,
 "integrated_keys": ["obsm/X_integrated_harmony", "obsm/X_integrated_scvi", "obsp/bbknn_connectivities"]}
```

```json
{"dataset": "pancreas.singlet", "status": "completed",
 "wrote": ["uns/integration_quality/X_integrated_harmony", "uns/integration_quality/X_integrated_scvi",
           "uns/integration_quality/bbknn", "uns/integration_quality/aggregate"],
 "summary": {"n_cells": "<int>", "n_batches": "<int>", "n_labels": "<int>",
  "outputs": [{"name": "bbknn", "kind": "graph", "fallbacks": [],
    "scores": {"kbet": "<0..1>", "ilisi": "<0..1>", "clisi": "<0..1>", "graph_connectivity": "<0..1>", "nmi": "<0..1>", "ari": "<-1..1>"},
    "not_applicable": ["asw_batch", "asw_label", "pcr", "cell_cycle", "hvg_overlap", "isolated_label_asw"]}],
  "aggregate": {"scaling": "minmax", "overall": {"X_integrated_harmony": "<0..1>", "X_integrated_scvi": "<0..1>", "bbknn": "<0..1>"},
                "batch_mean": "<per output>", "bio_mean": "<per output>"}},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: at atlas scale the call returns `queued` with a `job_id` when the dry-run estimate exceeds the server's inline limit (the kBET neighbour ranking and the Leiden grid dominate). Stochastic: the kBET test sets, Leiden and the M1 folds use `seed`. Dry run: seconds, `peak_memory_gb` and device from the number of cells, outputs, metric set and graph sizes; nothing is computed or written.

## 8. Benchmarks

Shared protocol. Each benchmark scores every output with the section 4 defaults and five seeds (0 to 4, a singlet choice; mean and range are reported), applies `minmax` scaling within one dataset, and reports raw values, scaled values and fallbacks separately. No parameter is tuned on labels. Hardware and thread count are recorded with every timing. B1 uses public data; B2 to B4 are proposed benchmarks built from the singlet catalogue (354 million uniformly processed cells, about 40% with author annotations) or from simulation, and thresholds marked proposed are design choices. The generator recipe of B2 produces every input of B2 and B3.

### B1. Fidelity to the reference implementations (published)

- **Goal**: show that singlet reproduces the values and method ranking of scib at cd67913 [R1] and of the Open Problems wrappers at b3da9d6 [R7] on identical inputs.
- **Ground truth**: consistency with a reference: the value the reference function returns on the same inputs, on the metric's own scale ($[0,1]$; ARI in $[-1,1]$), and the order of the min-max-scaled overall score within each dataset.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| scIB integration tasks (immune cells, pancreas) | distributed with [R1]; pipeline in theislab/scib-pipeline (scib README) | scRNA-seq; species and sizes — | — | the study spans 13 tasks, 85 batches |
| Open Problems `cxg_immune_cell_atlas` | `resources_test/task_batch_integration/cxg_immune_cell_atlas` @ b3da9d6 | immune atlas, scRNA-seq; species and size — | — | smallest set |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Value difference | absolute difference between singlet and reference value per metric and output; stochastic metrics also divided by the reference's standard deviation over 5 seeds | lower | primary | [R1] |
| Ranking agreement | Spearman correlation between singlet and reference overall scores across outputs, per dataset | higher | primary | [R1][R10] |

- **Comparators**: outputs of at least 8 methods per dataset from `src/methods` of the Open Problems repository (for example bbknn, combat, harmony, scanorama, scanvi, scvi) spanning embedding, graph and feature kinds, plus the unintegrated baseline. References: scib `metrics()` with LISI subsampling disabled, and the wrappers with singlet given their arguments (resolutions 0.2 to 0.8, no LISI subsampling; LISI version in section 10).
- **Acceptance criterion** (proposed): deterministic metrics (ASW, PCR, graph connectivity, HVG overlap, cell cycle, kSIM, LISI) differ by at most $10^{-3}$ on every output; stochastic metrics (kBET, NMI, ARI, isolated F1, trajectory) differ by at most $\max(10^{-3},2\,\mathrm{SD}_{\rm ref})$; the ranking correlation is at least 0.95 on each dataset.
- **Known pitfalls**: the reference needs R kBET through rpy2 and a compiled LISI binary, so values depend on the build; Leiden partitions agree only in distribution.

### B2. Planted batch strength (proposed)

- **Goal**: show that batch scores fall monotonically with planted batch strength at every label count and that label-stratified scores ignore batch composition.
- **Ground truth**: planted. The strength $s$ is the standard deviation of a log-scale multiplicative shift per gene and batch; labels are the author annotations; $s=0$ keeps the studies' own batch effects.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue studies (3, seed 0) | singlet catalogue, author-annotated part; no public URL | scRNA-seq; rule: at least 3 batches, 12 labels with at least 100 cells in 2 or more batches, 20,000 to 100,000 cells | per source study | disjoint from B3 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Strength tracking | Spearman correlation between score and $s\in\{0,0.1,\dots,0.9\}$ at 3, 6 and 12 labels for `kbet`, `ilisi`, `pcr` (unclipped, relative to $s=0$), `asw_batch`, `batch_predictability` | at most $-0.9$ | primary | [R8][R9] |
| Composition shift | largest change of `kbet` and `asw_batch` after subsampling the two most frequent batches of every label to ratio 1:3, at $s=0.5$ | at most 0.05 | primary | [R1] |

- **Comparators**: the unintegrated PCA.
- **Protocol (generator recipe)**: (1) select studies by the rule, normalise, log-transform, keep 2,000 highly variable genes (proposed); (2) for each $s$ multiply the normalised expression of gene $g$ in batch $b$ by $\exp(s\,\eta_{gb})$, $\eta_{gb}\sim N(0,1)$ drawn once per seed, then recompute the 50-component PCA (the shift is planted in expression, never in the scored embedding); (3) restrict to 3, 6 and 12 labels chosen by seed and score every $s$; (4) rescore at $s=0.5$ after subsampling batches within labels.
- **Acceptance criterion** (proposed): `kbet`, `ilisi` and `pcr` reach correlation at most $-0.9$ at every label count and the `kbet` composition shift is at most 0.05; any other score above $-0.9$ at a label count is flagged unreliable, and M1 leaves experimental status only if unflagged.
- **Known pitfalls**: planted shifts are easier to detect than real batch effects, so passing is necessary, not sufficient.

### B3. Planted over-correction (proposed)

- **Goal**: show that biological scores fall, and batch scores do not, when a cell type is collapsed onto another in a good integration.
- **Ground truth**: planted. For each of 100 random label pairs $(j_1,j_2)$ the embedding of $j_2$ is moved toward the mean $\boldsymbol\mu_{j_1}$ of $j_1$: $\mathbf z_c\leftarrow\mathbf z_c+\lambda(\boldsymbol\mu_{j_1}-\mathbf z_c)$ for $y_c=j_2$, $\lambda=0.5$. Labels are not merged in the scoring: the collapse is the damage and the original labels are the truth.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue studies (3, seed 1) | singlet catalogue, author-annotated part; no public URL | scRNA-seq; same selection rule as B2 | per source study | embeddings of harmony, scvi and scanvi from `integration.batch_corrected_embedding` |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Detection rate | fraction of the 100 pairs for which the biological composite (mean of cLISI, label ASW, isolated F1, isolated ASW, NMI, ARI) falls by more than twice its standard deviation over seeds | at least 0.95 | primary | [R1] |
| Batch response | change of `kbet`, `ilisi` and `asw_batch` after the collapse; non-negative values show that batch scores reward collapse | reported | secondary | [R8] |

- **Comparators**: the three embeddings before collapse.
- **Protocol**: prepare the studies as in step 1 of the B2 recipe, integrate, collapse each label pair, rescore and compare with the pre-collapse scores.
- **Acceptance criterion** (proposed): the detection rate is at least 0.95 for each of the three embeddings.
- **Known pitfalls**: a collapse planted in the representation is not what real over-correction looks like, which removes batch-specific biology; labels with few cells give noisy detection.

### B4. Calibration of the model-based batch score (proposed)

- **Goal**: check that the M1 bound holds and is tight, and that tests have their nominal level under an exact null.
- **Ground truth**: analytic. Cells of label $j$ have $\mathbf z\mid b\sim N(\pm\boldsymbol\delta/2,\mathbf I_{10})$ with $\lVert\boldsymbol\delta\rVert=\Delta\in\{0,0.5,1,2\}$ and equal batch priors; then $I(b;\mathbf z\mid y=j)=\ln 2-\mathbb E\,h(\sigma(\Delta\zeta))$ in nats, with $\zeta\sim\tfrac12N(\Delta/2,1)+\tfrac12N(-\Delta/2,1)$, $h$ the binary entropy and $\sigma$ the logistic function, evaluated by one-dimensional quadrature.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Gaussian mixtures (simulated) | singlet generator described above | 3 labels of 2,000 cells, label means 10 apart on the first axis, 200 replicates per $\Delta$ | not applicable | the null permutes batch labels within label |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Bound violation | fraction of replicates with $\hat\Delta_j$ above the analytic information by more than twice its bootstrap standard error | at most 0.05 | primary | section 3 |
| Tightness | $\hat\Delta_j/I(b;\mathbf z\mid y=j)$ for $\Delta\ge 1$ | at least 0.8 | primary | section 3 |
| Null level | kBET rejection rate at $\alpha=0.05$ and mean $\hat\Delta_j$ under permuted batch labels | rate in $[0.03,0.07]$; mean within $\pm 0.01$ nats of 0 | primary | [R4] |

- **Comparators**: `kbet` for the null level.
- **Protocol**: M1 with five-fold cross-validation per replicate; the kBET null uses a 50-NN graph per replicate.
- **Acceptance criterion** (proposed): all three rows meet the stated bounds.
- **Known pitfalls**: Gaussian shifts favour the linear classifier, so tightness here does not transfer to non-linear batch effects.

### P1. Performance and scaling

Wall time, peak memory and throughput (cells per second) per metric family (neighbourhood: kBET, LISI, graph connectivity, kSIM; geometric: silhouettes, PCR, cell cycle, HVG overlap; clustering: NMI, ARI, isolated F1) at $10^4$, $10^5$ and $10^6$ cells on CPU, and on CUDA where built, with $k$, components, genes, grid, seed and thread count held fixed. Comparators: scib at cd67913 (CPU), pegasus `calc_kBET` and `calc_kSIM` (their kBET differs: global proportions, no label stratification, so timings are not pooled with scib's), and scib-metrics 0.6.1 as a speed reference only. Acceptance (proposed): B1 is met first; singlet's CPU time per family at $10^5$ cells does not exceed scib's on the same hardware and threads; the CUDA neighbourhood family at $10^6$ cells is at least twice as fast as singlet's CPU time. Pitfall: timings depend on graph density and the number of outputs, so both are recorded.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `integration.batch_corrected_embedding`: Batch-corrected joint embedding
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
- **Feeds**:
  - `evaluation.overcorrection_detection`: Over-correction after batch or covariate removal
- **Reads**: `obsm/X_pca`, `obsm/X_integrated_<method>`, `obsp/<graph>_connectivities`, `obsp/<graph>_distances`, `layers/integrated_expr`, `layers/log1p_norm`, `obs/<batch_key>`, `obs/<label_key>`, `obs/S_score`, `obs/G2M_score`, `obs/<pseudotime_key>`
- **Writes**: `uns/integration_quality/<name>`, `uns/integration_quality/aggregate`, `obs/<name>_silhouette_batch`, `obs/<name>_silhouette_label`, `obs/<name>_ilisi`, `obs/<name>_clisi`
<!-- CHAINING:AUTO:END -->

Recipe: batch-corrected embedding, then this scoring, then clustering and annotation on the chosen output. Cell-cycle scores come from cell-cycle scoring and pseudotime from `trajectory.pseudotime_ordering`; both are optional.

## 10. Risks, pitfalls and open questions

- **Aggregate and task set.** The 0.4/0.6 weighting comes from the best-practices integration chapter [R10], not from the scIB paper text. The task count differs by source: 13 tasks and 85 batches [R1], five RNA tasks and two simulations [R10]. Sizes, licences and accessions of the scIB task datasets are not recorded, so B1 shows em dashes.
- **Reference versions.** Open Problems descriptions differ from the code they call: the kBET text gives a median-based $k$ bounded to 10-100 while the script calls `scib.metrics.kBET` (bound 10-70, kbet.py:111-114); the isolated-F1 text gives Louvain resolutions 0.1 to 2 while the default is 0.2 to 0.8. scib at cd67913 clusters with Leiden (clustering.py:98-99); its deprecated `opt_louvain` used Louvain on 0.1 to 2.0 (clustering.py:221-237). Open Problems pins scib 1.1.7 (the version cd67913 reports) and LISI at tag v1.1.5, whose code was not read.
- **Not read.** `bras` (described in the Open Problems configuration, code in scib-metrics 0.5.5), the sBEE implementation [R9] and the metric code of scib-metrics 0.6.1 are not in the tool. The kSIM attribution to Cumulus [R12] follows the pegasus documentation; the ciLISI attribution to [R11] follows the Open Problems configuration and the scIntegrationMetrics README.
- **Design choices without a source.** Feature outputs are reduced to 50 components; PCR takes component variances from the `baseline_key` scores instead of recomputing a PCA of the unintegrated matrix; kBET neighbours use sparse pruned diffusion, whose agreement with scib's dense version B1 tests first.
- **Model-based scope.** M1 is untested and linear. A Dirichlet-multinomial neighbourhood test, hierarchical rank intervals across datasets and a supervised over-correction detector trained on planted catalogue collapses are not specified and have no benchmark. Catalogue-derived benchmarks inherit the licences of their source studies.
- **First experiment.** B1 on `cxg_immune_cell_atlas`, then the B4 bound check, then the B2 monotonicity.

## 11. References

R1. Luecken MD, Büttner M, Chaichoompu K, Danese A, Interlandi M, Mueller MF, Strobl DC, Zappia L, Dugas M, Colomé-Tatché M, Theis FJ. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022;19:41-50. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R2. Argelaguet R, Cuomo ASE, Stegle O, Marioni JC. Computational principles and challenges in single-cell data integration. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-00895-7 — verified (corpus)
R3. Korsunsky I, Millard N, Fan J, Slowikowski K, Zhang F, Wei K, et al. Fast, sensitive and accurate integration of single-cell data with Harmony. *Nature Methods* 2019. doi:10.1038/s41592-019-0619-0 — verified (corpus)
R4. Büttner M, Miao Z, Wolf FA, Teichmann SA, Theis FJ. A test metric for assessing single-cell RNA-seq batch correction. *Nature Methods* 2019. doi:10.1038/s41592-018-0254-1 — verified (corpus)
R5. Tran HTN, Ang KS, Chevrier M, Zhang X, Lee NYS, et al. A benchmark of batch-effect correction methods for single-cell RNA sequencing data. *Genome Biology* 2020. doi:10.1186/s13059-019-1850-9 — verified (corpus)
R6. Chazarra-Gil R, van Dongen S, Kiselev VY, Hemberg M. Flexible comparison of batch correction methods for single-cell RNA-seq using BatchBench. *Nucleic Acids Research* 2021. doi:10.1093/nar/gkab004 — verified (corpus)
R7. Luecken MD, Gigante S, Burkhardt DB, Cannoodt R, Strobl DC, et al. Defining and benchmarking open problems in single-cell analysis. *Nature Biotechnology* 2025. doi:10.1038/s41587-025-02694-w — verified (corpus)
R8. Rautenstrauch P, Ohler U. Shortcomings of silhouette in single-cell integration benchmarking. *Nature Biotechnology* 2026. doi:10.1038/s41587-025-02743-4 — verified (corpus)
R9. Myradov M, Houdjedj A, Taştan Ö, Kazan H. A systematic evaluation of single-cell batch integration metrics and sBEE: a robust new metric. *bioRxiv* 2026 (preprint, ID 2026.04.22.720135). — partial (search)
R10. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities (integration chapter of the accompanying book). *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R11. Andreatta M, Herault L, Gueguen P, Gfeller D, Berenstein AJ, Carmona SJ. Semi-supervised integration of single-cell transcriptomics data. *Nature Communications* 2024. doi:10.1038/s41467-024-45240-z — verified (repo)
R12. Li B, Gould J, Yang Y, et al. Cumulus provides cloud-based data analysis for large-scale single-cell and single-nucleus RNA-seq. *Nature Methods* 2020. doi:10.1038/s41592-020-0905-x — partial (repo)
R13. Haghverdi L, Büttner M, Wolf FA, Buettner F, Theis FJ. Diffusion pseudotime robustly reconstructs lineage branching. *Nature Methods* 2016. doi:10.1038/nmeth.3971 — verified (corpus)
R14. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)
R15. Rousseeuw PJ. Silhouettes: a graphical aid to the interpretation and validation of cluster analysis. *Journal of Computational and Applied Mathematics* 1987;20:53-65. — partial (repo)
R16. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985;2:193-218. doi:10.1007/bf01908075 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/scib | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt; pyproject.toml); cd67913 | reference implementation of the scIB metrics and aggregate; defaults in section 4; B1 reference | port |
| https://github.com/theislab/kBET | Maren Büttner (creator, author), Alex Wolf and Fabian Theis (contributors), per DESCRIPTION | Apache License 2.0 (DESCRIPTION, LICENSE); version 0.99.6, afc5f43 | kBET statistic and test-set defaults | port |
| https://github.com/immunogenomics/LISI | Ilya Korsunsky (DESCRIPTION) | GPL-3 (LICENSE; DESCRIPTION: GPL-3 + file LICENSE) | R implementation of LISI; copyleft, so scib's MIT reimplementation is ported instead | callout |
| https://github.com/carmonalab/scIntegrationMetrics | Massimo Andreatta, Josep Garnica, Santiago Carmona (DESCRIPTION) | GPL-3 (LICENSE; DESCRIPTION); version 1.2.0, 8d6b436 | ciLISI definition and defaults | reimplement |
| https://github.com/lilab-bcb/pegasus | Yiming Yang, Joshua Gould, Bo Li (setup.py) | BSD 3-Clause (LICENSE); 484617d | kSIM; kBET variant used as a P1 comparator | port |
| https://github.com/openproblems-bio/task_batch_integration | Michaela Mueller (maintainer), Malte Luecken, Daniel Strobl, Robrecht Cannoodt, Luke Zappia, Jeremie Kalfon, Seo Hyon Kim, Josep Garnica, Daniel Schaffer and contributors (_viash.yaml) | MIT (LICENSE); b3da9d6 | metric wrappers, resources and B1 comparator | callout |
| https://github.com/yoseflab/scib-metrics | Adam Gayoso (pyproject.toml) | BSD 3-Clause (LICENSE); version 0.6.1, 00c4ec0 | accelerated implementation; P1 speed reference | callout |
