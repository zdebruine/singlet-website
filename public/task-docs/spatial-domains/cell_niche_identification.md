---
id: spatial-domains.cell_niche_identification
title: Cellular niche identification from neighbourhood composition
area: spatial-domains
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [spatial-preproc.spatial_unit_qc_filtering, annotation.reference_label_transfer, neighbors.neighbor_count_selection]
feeds: [spatial-genes.differential_spatial_colocalization, abundance.neighborhood_da_knn_graph, spatial-domains.multi_slice_domains]
reads: [obsm/spatial, obs/<label_key>, layers/log1p_norm, obsm/<use_rep>]
writes: [obs/niche_label, obsm/niche_prob, obsm/niche_embedding, obsm/niche_composition, uns/niche_enrichment, uns/niche_params]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_domains_cell_niche_identification
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Cellular niche identification from neighbourhood composition

> Assigns each cell to a recurring multicellular niche from the labels or embeddings of its spatial neighbours; the published standard is neighbourhood-composition profiles clustered with Leiden, and singlet proposes a Gaussian mixture over multi-hop features with soft memberships that is not yet validated.

## 1. Question

Given $n$ cells or segmented units with coordinates $S\in\mathbb{R}^{n\times 2}$, a label $c_i$ per cell (a cell type or state) and optionally a normalised expression matrix, assign each cell a niche $\nu_i\in\{1,\dots,K\}$ so that cells in one niche share a recurring neighbourhood context. Outputs are one niche label per cell and resolution, optional soft memberships, a neighbourhood embedding and, for label-based output, cell-type pair enrichment statistics. A correct answer is a niche that recurs across tissue regions and samples and carries information beyond the labels. No accepted ground truth exists; the proxies are planted niches in simulation and annotated tissue structures.

## 2. Why this task matters and where the field stands

Niche labels summarise tissue organisation above the level of single cells, and they feed comparisons of cell abundance and co-localisation between samples. Because they are computed routinely, an unvalidated label propagates into every downstream comparison.

The status is **contested**.

- *Validation.* Validation is mostly by spatial consistency or visual agreement with histology [R2][R1]. Toolkits for niche analysis exist [R6].
- *Niches can restate cell types.* Profiles built from labels inherit the labelling. Whether niches add information beyond cell types is seldom tested; the test needs non-spatial clustering of the same cells as a baseline.
- *Scale and count are set by the user.* Neighbourhood size, Leiden resolution and K are not identified by the data; the same resolution gives different counts on different graphs [R9].
- *Consistency is easy to score.* Smooth labelling scores well on consistency measures, and NicheCompass's consistency metrics were defined by its authors, so comparisons on them favour that design [R2].
- *Uncertainty and matching.* Hard labels hide boundary uncertainty; only the mixture and latent-variable families return soft memberships [R1][R7]. Niches fitted per section are not comparable across sections without a matching step, which the multi-slice task addresses.

## 3. Theory and insight

Every method builds a feature for each cell from its neighbourhood and then partitions the features. The literature has four families: composition profiles with graph clustering [R4]; hop-ring aggregation with a full-covariance Gaussian mixture [R1]; distance-weighted neighbour augmentation with PCA and Leiden [R3]; and latent-variable graph or variational models with count likelihoods [R2][R7]. Cell $i$ has label $c_i\in\{1,\dots,C\}$; $N_d(i)$ is the set of cells at 1 to $d$ hops, self excluded; $R_h(i)$ is the set at exactly $h$ hops; and $x_i\in\mathbb{R}^{p_0}$ is a base embedding (PCA or a supplied latent).

**Composition.** Neighbour-label frequencies and their column standardisation are
$$f_{ik}=\frac{1}{\lvert N_d(i)\rvert}\sum_{j\in N_d(i)}\mathbf 1[c_j=k],\qquad \tilde f_{ik}=\frac{f_{ik}-\bar f_k}{s_k},$$
with $\bar f_k$ and $s_k$ the mean and standard deviation of column $k$ over cells. Estimand: $f_{ik}$ is the fraction of labelled neighbours within $d$ hops that carry label $k$; it sums to one over labels and does not grow with neighbourhood size. Regime: $d=1$ uses direct contacts. The count variant multiplies by $\lvert N_d(i)\rvert$ and mixes density into the profile. The standardisation rescales columns and is not a test. Leiden then maximises the Reichardt-Bornholdt modularity of the kNN graph of the profiles [R9],
$$Q=\frac{1}{2m}\sum_{ij}\Big(A_{ij}-\gamma\frac{k_ik_j}{2m}\Big)\delta(\sigma_i,\sigma_j),$$
so $\gamma$ is a resolution, not a statistical threshold. The number of niches is an output of $\gamma$ and the graph together.

**Rings and mixture.** Ring features and the mixture are
$$\tilde x_i=\big[x_i;\bar x^{(1)}_i;\dots;\bar x^{(D)}_i\big],\quad \bar x^{(h)}_i=\frac{1}{\lvert R_h(i)\rvert}\sum_{j\in R_h(i)}x_j,\qquad p(\tilde x)=\sum_{k=1}^{K}\pi_k\,\mathcal N(\tilde x\mid\mu_k,\Sigma_k),$$
with responsibilities $\gamma_{ik}=\pi_k\mathcal N(\tilde x_i\mid\mu_k,\Sigma_k)/\sum_l\pi_l\mathcal N(\tilde x_i\mid\mu_l,\Sigma_l)$. The feature width is $p=(D+1)p_0$. Estimand: $\gamma_{ik}$ is the posterior probability of component $k$ under the fitted parameters, conditional on $K$ and not averaged over parameter uncertainty; the label is $\arg\max_k\gamma_{ik}$. Regime: a component has $p(p+1)/2$ covariance parameters, so $K$ components have $Kp(p+1)/2$. With $D=3$ and $p_0=10$, $p=40$, a component has 820 covariance parameters and $K=10$ has 8,200. Each EM iteration costs $O(nKp^2)$ with Cholesky factors, so the ring width dominates; the neighbour-label product costs $O(\lvert E\rvert C)$.

**Neighbour augmentation (comparator).** BANKSY [R3] forms $h_i=\sum_j w_{ij}z_j/\sum_j w_{ij}$ from distance-decay weights and $M_i=[\sqrt{1-\lambda}\,z_i;\ \sqrt{\lambda}\,h_i]$. The two blocks occupy separate coordinates, so exactly
$$\lVert M_i-M_j\rVert^2=(1-\lambda)\lVert z_i-z_j\rVert^2+\lambda\lVert h_i-h_j\rVert^2$$
for every $\lambda\in[0,1]$. Here $\lambda=0$ is non-spatial and $\lambda=1$ uses neighbour averages only, so a small $\lambda$ keeps cell-type identity dominant.

**Latent-variable models (comparators).** NicheCompass [R2] reconstructs counts with a negative-binomial likelihood (mean $\mu$, dispersion $\theta$) through a gene-program decoder, adds edge reconstruction, a KL term and penalties on programs, and labels niches by Leiden clusters of its latent space; its relative loss weights are not reproduced here. scVIVA [R7] conditions its decoders on niche composition and niche activation.

**Permutation enrichment.** Cell-type pair contacts are tested as $z_{ab}=(N_{ab}-\mu^{\rm perm}_{ab})/\sigma^{\rm perm}_{ab}$, where $N_{ab}$ counts contacts between labels $a$ and $b$ and the permutation moments come from 1,000 label shuffles across cells. Estimand: a standardised excess of contacts over the shuffled expectation, computed on existing labels; it is not a niche labelling.

**Estimands.** Each output and truth quantity is defined once:

- niche label $\nu_i=\arg\max_k\gamma_{ik}$: hard and unnormalised;
- soft membership $\gamma_{ik}$: sums to one over $k$ for fixed $K$;
- composition $f_{ik}$: mean over labelled neighbours within $d$ hops, self excluded;
- planted niche $z_i^\ast$: the generator's region index, exact by construction;
- cell-type reproduction: ARI between $\nu$ and the generator's cell types;
- calibration error: defined in B1.

**Assumptions and failure modes.**

| Family | Assumes | Fails when |
|---|---|---|
| Composition and Leiden | labels are correct and contacts carry the niche | one label dominates the neighbourhood, so niches restate cell types; label granularity sets the answer |
| Rings and Gaussian mixture | ring means separate niches; components are Gaussian | $n$ is small relative to $Kp^2$; features are collinear; PCA replaces a latent |
| Neighbour augmentation with Leiden | expression and neighbour averages share a metric | large $\lambda$ merges cell types into domains |
| Graph variational models | the program prior or latent carries the biology | the prior sets the answer, and benchmarks reusing the prior are circular |

**Why heuristics work, and what the model adds.** Composition profiles need only labels, are cheap and interpretable, and track the labelling directly, which is also their limit. The mixture adds a fitted likelihood, soft memberships and a choice of $K$ that does not rely on stability. Its costs are a Gaussian per niche with quadratic growth in $p$, sensitivity to initialisation, and the need to show that soft labels are calibrated. It is an improvement only if B1 and B2 show it.

**Pitfalls from benchmark studies.**

- Self-inclusion differs: the composition profile excludes the cell's own label, while CellCharter's embedding keeps the cell's features as its first block. The two definitions are not comparable.
- Edge weights: squidpy's niche functions take `use_weights` (default true), while CellCharter's aggregation binarises the graph before averaging, so weighted graphs give different profiles across the two; mixing graphs changes results silently.
- Circularity: composition-planted niches are recovered by composition methods by construction.
- Label noise propagates into every neighbour profile, and kNN profiles shift with cell density.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Neighbourhood composition and Leiden (squidpy) | heuristic | z-scored label frequencies over 1 to $d$ hops, kNN graph of the profiles, Leiden at fixed resolutions | [R4] |
| UTAG-style neighbour aggregation and Leiden (squidpy port) | heuristic | mean of features over immediate neighbours, PCA, Leiden; the principle comes from multiplexed imaging | [R5] |
| CellCharter | model-based | hop-ring means of an embedding, full-covariance Gaussian mixture, argmax label; its own package selects K by stability | [R1] |
| BANKSY | heuristic | distance-weighted neighbour average scaled by $\sqrt{\lambda}$ beside self expression, PCA, Leiden | [R3] |
| NicheCompass | model-based | gene-program graph autoencoder with a negative-binomial decoder and edge reconstruction; Leiden on the latent | [R2] |
| scVIVA | model-based | scVI-type VAE whose decoders condition on niche composition and activation | [R7] |
| Seurat BuildNicheAssay | heuristic | counts of neighbouring labels among the k nearest cells (k = 20 by default), scaled, then k-means with a fixed number of niches (4 by default, 30 starts) | `R/utilities.R:3185-3230` @ 5f67c70 (section 12) |
| Squidpy neighbourhood enrichment | heuristic | permutation z-scores of cell-type contacts; a statistic on labels, not a niche labelling | [R4] |

Composition with Leiden is the published standard for label-based niches and the default in this design. CellCharter is the model-based reference and the basis of singlet's proposal. UTAG-style aggregation, BANKSY, NicheCompass, scVIVA and Seurat's assay are comparators. Monkeybread [R6] is cited for its scope as a toolkit for niche analysis of single-cell-resolution data.

Defaults that singlet adopts (squidpy and CellCharter rows) and comparator defaults (BANKSY and NicheCompass rows), taken from source at the commits shown:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Squidpy composition | `n_neighbors` (Leiden kNN) | 15 | `squidpy/src/squidpy/gr/_niche.py:342-357` @ f030690 |
| Squidpy composition | `scale`; `abs_nhood` | True; False | `squidpy/src/squidpy/gr/_niche.py:342-357` @ f030690 |
| Squidpy composition | `distance` (hops) | 1; profile counts hops `range(1, distance+1)`, self excluded | `_niche.py:212-213`, `1171` @ f030690 |
| Squidpy composition | `resolutions` | [0.5] | `_niche.py:239-240` @ f030690 |
| Squidpy enrichment | `n_perms`; `normalization`; `min_cell_count`; `handle_nan` | 1000; none; 0; keep | `squidpy/src/squidpy/gr/_nhood.py:314-321` @ f030690 |
| Squidpy CellCharter flavour | `distance`; `aggregation`; `n_clusters` | 3; mean; 10 | `squidpy/src/squidpy/gr/_niche.py:613-626` @ f030690 |
| Squidpy CellCharter flavour | PCA fallback | 10 components; the comment ties 10 to scVI's default latent width | `_niche.py:1248-1270` @ f030690 |
| Squidpy CellCharter flavour | mixture | sklearn `GaussianMixture(n_components=K)` | `_niche.py:731` @ f030690 |
| sklearn mixture defaults as mirrored in rapids | covariance; init; tol; reg_covar; max_iter | full; kmeans; 1e-3; 1e-6; 100 | `scverse_rapids_singlecell/src/rapids_singlecell/squidpy_gpu/_gmm.py:170-184` @ e110792 |
| CellCharter mixture | covariance; init; tolerance; regularisation; seed | full; kmeans; 1e-3; 1e-6; 0 | `CSOgroup_cellcharter/src/cellcharter/tl/_gmm.py:76-88` @ d6dd529 |
| CellCharter ClusterAutoK | max_runs; convergence_tol; similarity | 10; 1e-2; Fowlkes-Mallows | `CSOgroup_cellcharter/src/cellcharter/tl/_autok.py:69-87` @ d6dd529 |
| rapids GPU niche | GMM init | random_from_data | `scverse_rapids_singlecell/src/rapids_singlecell/squidpy_gpu/_niche.py:34` @ e110792 |
| BANKSY (comparator) | `num_neighbours`; `lambda_list`; `resolutions` | 15 in the README example (function default 10); [0.2]; [0.5, 1.0] | `Banksy_py/README.md:142-152` @ 9278996; `src/banksy/main.py:145` @ 9278996 |
| BANKSY (comparator) | `nbr_weight_decay` (README) and `decay_type` (function) | scaled_gaussian (README example); reciprocal (function default) | `Banksy_py/README.md:143` @ 9278996; `src/banksy/main.py:146` @ 9278996 |
| NicheCompass (comparator) | `n_epochs`; `n_epochs_all_gps`; `n_epochs_no_cat_covariates_contrastive`; `lr` | 100; 25; 5; 0.001 | `nichecompass/src/nichecompass/train/trainer.py:218-222` @ 5bf7d2a |

## 5. Proposed singlet approach

**Routes.** `composition` is a port of squidpy's neighbourhood profile, standardisation, Leiden call and enrichment (permissive licence), with the defaults above. `cellcharter` is a port of the ring features and mixture into the dependency-free core, with the same defaults. UTAG-style aggregation, BANKSY, NicheCompass, scVIVA and Seurat's assay are callouts used as benchmark comparators. BANKSY and UTAG are not ported in this version; their licences are in section 12.

**Model-based proposal.** A full-covariance Gaussian mixture over ring features, fitted by maximum likelihood with EM, returns soft memberships $\gamma_{ik}$ per cell. When `n_clusters` is null, $K$ is chosen over 2 to 20 by BIC rather than by stability. The claims are that the soft memberships are calibrated and that BIC recovers planted structure. The proposal is falsified on B1 if the calibration error exceeds 0.05 at zero label noise, if its ARI on the expression-only arm is below 0.60, if BIC recovers the planted $K$ in fewer than 80% of free-$K$ replicates, or if it falls more than 0.05 ARI short of the best comparator on the composition arm.

**Defaults an agent uses without asking.** The defaults are those in section 6. The agent reports the cell-type reproduction score beside every niche result and compares with `cellcharter` on the same cells. The default moves to `cellcharter` only when the B1 and B2 acceptance criteria are met.

**Kernels and stack.** This version has no PyTorch dependency: both methods reduce to sparse products and EM. Hard-coded CUDA with cuSPARSE covers the label product $A\mathbf Z$ with one-hot labels, the ring incidence products that give hop means, and the mixture E-step and M-step with per-component Cholesky factors and batched cuBLAS. Leiden and the kNN graph are computed on CPU in the core. Covariance memory is $Kp^2$ float32 values, which the dry run reports. A gene-program variational model (NicheCompass-type, in PyTorch) needs a program prior and is a later option. Streaming is not claimed: each library is processed in memory, and `library_key` fits libraries one at a time.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsm/spatial | float | cell coordinates |
| read | obs/<label_key> | categorical | cell-type or state label for composition |
| read | layers/log1p_norm | float | normalised expression; PCA input when `use_rep` is null |
| read | obsm/<use_rep> | float | optional precomputed embedding, such as an scVI latent |
| write | obs/niche_label | categorical | niche per cell, suffixed `_res<r>` per resolution; `not_a_niche` below `min_niche_size` |
| write | obsm/niche_prob | float32 | soft memberships for cellcharter; rows sum to one |
| write | obsm/niche_embedding | float32 | ring-aggregated features for cellcharter |
| write | obsm/niche_composition | float32 | n × C neighbour-label profile for composition |
| write | uns/niche_enrichment | float64 | label-pair permutation z-scores and counts for composition |
| write | uns/niche_params | json | effective parameters and versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "composition" | `composition`, `cellcharter` | composition: neighbour-label profiles and Leiden (published standard, default). cellcharter: ring features and Gaussian mixture with soft memberships. |
| `graph` | object | — | — | Spatial graph and neighbourhood size shared by all methods. |
| `graph.graph_type` | string | "knn" | `knn`, `delaunay` | knn: k nearest neighbours; delaunay: triangulation of the coordinates. |
| `graph.n_neighbors` | integer | 15 | min 1 | Neighbours k for the spatial graph and the Leiden kNN; 15 is the squidpy default. |
| `resolutions` | array | [0.5] | — | Leiden resolutions for composition; one label column per value. cellcharter ignores it. |
| `library_key` | string/null | null | — | obs column naming each section or sample; niches are then fitted per library and are not comparable across libraries. |
| `min_niche_size` | integer/null | null | min 1 | Niches with fewer cells are relabelled not_a_niche; null keeps every niche. |
| `composition` | object | — | — | Options for method composition. |
| `composition.label_key` | string | "cell_type" | — | obs column with the cell-type or state label used for neighbour counts. |
| `composition.hops` | integer | 1 | min 1 | Neighbour hops d aggregated into the profile; 1 uses direct contacts. |
| `composition.scale` | boolean | true | — | Z-score each label column before clustering. |
| `composition.abs_nhood` | boolean | false | — | Use neighbour counts instead of frequencies; mixes local density into the profile. |
| `composition.n_perms` | integer | 1000 | min 1 | Label permutations for the neighbourhood enrichment z-score. |
| `cellcharter` | object | — | — | Options for method cellcharter. |
| `cellcharter.hops` | integer | 3 | min 1 | Maximum graph hop D; the embedding has D+1 blocks, each of width n_pca_components or the latent width. |
| `cellcharter.n_clusters` | integer/null | 10 | min 2 | Mixture components K; null selects K by BIC over 2 to 20 (proposed rule, tested in B1). |
| `cellcharter.n_pca_components` | integer | 10 | min 1 | PCA components of layers/log1p_norm when use_rep is null. |
| `cellcharter.use_rep` | string/null | null | — | obsm key of a precomputed embedding such as an scVI latent; preferred over PCA. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for mixture initialisation and Leiden; the same seed, inputs and parameters give the same labels. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

## 7. MCP tool

Tool name `singlet_spatial_domains_cell_niche_identification` (definition in `tasks/mcp/singlet_spatial_domains_cell_niche_identification.json`). Example call, then a compact result (values are illustrative and not measurements):

```json
{"dataset": "/data/crc_section.singlet", "method": "composition", "composition": {"label_key": "cell_type"}, "resolutions": [0.5], "seed": 0}
```

```json
{
  "dataset": "/data/crc_section.singlet",
  "status": "completed",
  "wrote": ["obs/niche_label_res0.5", "obsm/niche_composition", "uns/niche_enrichment", "uns/niche_params"],
  "summary": {"method": "composition", "n_niches": {"0.5": 9}, "graph": {"n_nodes": 50000, "n_edges": 750000}},
  "provenance_id": "prov_0001", "job_id": null, "estimate": null
}
```

- **Long-running**: `cellcharter` may return `queued` with a `job_id` above an implementation-set size.
- **Stochastic**: `seed` fixes the mixture initialisation and Leiden; the same seed, inputs and parameters give the same labels on the same device class.
- **Dry run**: `estimate` gives seconds, peak memory and device, including the feature width $p$ and covariance memory $Kp^2$ for `cellcharter`.

## 8. Benchmarks

**Shared protocol.** Every benchmark scores hard niche labels on cells that carry a reference label; ARI and NMI are the scikit-learn implementations [R11]. Each method is first evaluated at its section 4 defaults; a second arm changes only the number of niches to the true value (oracle $K$), and the two arms are reported separately. Stochastic methods use three seeds, or five for seed stability, and report the seed mean and range. Comparators are used at the commits in the section 4 table. Where a planted or annotated reference exists, non-spatial clustering of the same cells is the baseline. No hyperparameter is tuned on reference labels.

### B1. Planted-niche simulation (proposed)

- **Goal**: test recovery of planted niches when the truth is exact, separating composition-driven niches from expression-driven ones.
- **Ground truth**: planted simulation. The truth $z_i^\ast$ is the generator's niche index. Calibration uses $\hat p_i=\max_k\gamma_{ik}$ in ten equal-width bins $B_m$: $\mathrm{ECE}=\sum_m\frac{\lvert B_m\rvert}{n}\lvert\mathrm{acc}(B_m)-\mathrm{conf}(B_m)\rvert$, where acc is the fraction of cells with $\nu_i=z_i^\ast$ after Hungarian matching and conf is the mean $\hat p_i$.
- **Generator recipe**:
  1. $n=10^4$ cells as a Poisson process on $[0,1]^2$ (proposed sizes).
  2. $z^\ast$ from $K$ quantile cuts of a Gaussian random field with squared-exponential length scale 0.1, $K\in\{5,10,20\}$.
  3. Composition arm: $\pi_k\sim\mathrm{Dirichlet}(\mathbf 1)$ over $C=8$ types; $c_i\sim\pi_{z_i^\ast}$.
  4. $G=2000$ genes; $\mu_{cg}=\exp(\eta_{cg})$ with $\eta_{cg}\sim\mathcal N(0,1)$; $x_{ig}\sim\mathrm{NB}(s_i\mu_{c_ig},\phi_g)$ with $\log s_i\sim\mathcal N(0,0.3^2)$.
  5. Expression-only arm: one shared composition for all niches, and $\mu_{z_i^\ast g}=\mu_{c_ig}\exp(m_{z_i^\ast g})$ with programmes $m_{kg}\sim\mathcal N(0,1)$ on 10% of genes.
  6. Label noise: a fraction $\epsilon\in\{0,0.05,0.1,0.2\}$ of the $c_i$ given to methods is replaced at random; $z^\ast$ is unchanged.
  7. Symmetrised kNN graphs with $k\in\{10,15,30\}$; one generator seed is held out for final numbers.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated sections, recipe steps 1 to 7 | generated; seeds recorded | counts; $n=10^4$, $K\in\{5,10,20\}$, $G=2000$ | — | labels known by construction; two arms |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | chance-corrected agreement of $\nu$ with $z^\ast$ over all cells | higher | primary | [R11] |
| NMI | mutual information of $\nu$ and $z^\ast$ over the arithmetic mean of their entropies | higher | primary | [R11] |
| ECE | equation above, for `cellcharter` soft memberships | lower | primary | — |
| Cell-type reproduction | ARI between $\nu$ and the generator's cell types | lower | guardrail | — |
| Seed stability | mean pairwise ARI over five seeds, same graph and resolution | higher | guardrail | — |

- **Comparators**: `composition` at $d=1$ and $d=3$ (squidpy at f030690 and the singlet port), `cellcharter` at $D=3$ with $K=10$ and oracle $K$, BANKSY at $\lambda=0.2$ and $0.8$, NicheCompass at 5bf7d2a, and non-spatial clustering of expression as the lower bound for cell-type reproduction.
- **Protocol**: all settings above, each method at its defaults and then oracle $K$, with boundary cells (those with a neighbour in another niche) reported separately.
- **Acceptance criterion** (proposed design targets): at $\epsilon=0$ and $K=10$ on the composition arm, at least one method reaches ARI $\ge 0.80$ and the best singlet method is within 0.05 ARI of the best comparator. On the expression-only arm, no composition-based method exceeds ARI 0.30 while expression-based methods reach ARI $\ge 0.60$. BIC recovers the planted $K$ in at least 80% of free-$K$ replicates, and ECE is at most 0.05 for `cellcharter` at $\epsilon=0$. A method whose cell-type reproduction exceeds its planted ARI is rejected.
- **Known pitfalls**: composition-planted niches are recovered by composition methods by construction, so the expression-only arm is required; tuning resolution or $\lambda$ on planted labels leaks the truth.

### B2. Spatial-consistency benchmark on two Visium datasets (extended)

- **Goal**: test whether niche representations and labels agree with the spatial graph when no niche truth exists. This is consistency, not accuracy.
- **Ground truth**: consistency. Each metric compares the cell graph of a niche representation with the spatial kNN graph of the same spots. Cell-type labels for CLISIS and CAS are the argmax of reference-based spot deconvolution (task `spatial-deconv-mapping.spot_celltype_proportions`), fixed before scoring.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 10x Visium human breast cancer, FFPE | [R12]; https://www.10xgenomics.com/datasets/human-breast-cancer-ductal-carcinoma-in-situ-invasive-carcinoma-ffpe-1-standard-1-3-0 | Visium, human; size — | — | labels as above |
| 10x Visium human colorectal cancer, 11 mm, FFPE | [R13]; https://www.10xgenomics.com/datasets/human-colorectal-cancer-11-mm-capture-area-ffpe-2-standard | Visium, human; size — | — | labels as above |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| NASW | mean silhouette width over Leiden clusterings of the latent kNN graph on ten log-spaced resolutions from 0.1 to 2 (proposed grid) | higher | primary | [R2] |
| MLAMI | maximum adjusted mutual information over pairs of Leiden clusterings, one on the spatial graph and one on the latent graph | higher | primary | [R2][R11] |
| GCS | similarity of edge and non-edge structure of the latent and spatial kNN graphs, averaged over batches when present | higher | primary | [R2] |
| CLISIS | similarity of the local cell-type inverse Simpson index (CLISI) between latent and spatial graphs | higher | guardrail | [R8] |
| CAS | similarity of cell-type-pair edge frequencies between the two graphs; a variant of the cell-type affinity distance | higher | guardrail | [R10] |

- **Comparators**: `composition`, `cellcharter`, the reference CellCharter at d6dd529 (a port check), BANKSY at $\lambda=0.2$, and NicheCompass at 5bf7d2a.
- **Protocol**: each method's latent or augmented representation is scored on the same spatial kNN graph with $k\in\{10,30,50,90\}$; all five metrics are reported as the mean over $k$.
- **Acceptance criterion** (proposed): GCS and CAS are at least the best comparator minus 0.02 on both datasets. A consistency win alone is not evidence of a correct niche.
- **Known pitfalls**: smooth labelling that merges cells into one niche can score well on GCS and NASW; the spatial graph is both the reference and an input for several methods, which inflates self-agreement.

### P1. Performance and scaling

Wall time, peak host and GPU memory, and throughput (cells per second) on CPU and CUDA for $n\in\{10^4,10^5,10^6\}$ cells from the B1 generator, with $10^7$ for the rapids-singlecell and NicheCompass comparators only. Comparators: squidpy composition and CellCharter flavours (CPU), rapids-singlecell GPU equivalents, NicheCompass (GPU, default epochs), and the singlet methods. Hold fixed: $k=15$, hops 1 for composition and 3 for cellcharter, 10 PCA components, $K=10$, Leiden resolution 0.5, seed 0. Exclude warm-up and file input; report host-to-device transfer separately.

- **Acceptance criterion** (proposed): peak memory per cell for each method varies by less than 1.5 times between $10^5$ and $10^6$ cells.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `annotation.reference_label_transfer`: Reference-based cell label transfer
  - `neighbors.neighbor_count_selection`: Choice of neighbour count k and graph stability
- **Feeds**:
  - `spatial-genes.differential_spatial_colocalization`: Differential cell-type colocalization and niche abundance between conditions
  - `abundance.neighborhood_da_knn_graph`: Cluster-free neighbourhood differential abundance on a kNN graph
  - `spatial-domains.multi_slice_domains`: Multi-slice joint domain identification
- **Reads**: `obsm/spatial`, `obs/<label_key>`, `layers/log1p_norm`, `obsm/<use_rep>`
- **Writes**: `obs/niche_label`, `obsm/niche_prob`, `obsm/niche_embedding`, `obsm/niche_composition`, `uns/niche_enrichment`, `uns/niche_params`
<!-- CHAINING:AUTO:END -->

The task needs a quality-filtered section with cell-type labels and a neighbour count. Its labels feed colocalisation and neighbourhood abundance analyses, and multi-slice domains match niches across sections.

## 10. Risks, pitfalls and open questions

- **Unsettled literature.** In the sources read, no niche method is validated against ground truth, and no published study compares niches with non-spatial clustering of the same cells. B1 is designed to test this, and no threshold in this document comes from the literature.
- **Facts from secondary listings.** GraphST and STACI are excluded because their sources were not read. The Birk et al. author list is partial. Giotto's cell-cell enrichment is omitted because its repository and algorithm were not read.
- **Code read in part.** scVIVA is represented by its code defaults only, and its preprint was not read. BANKSY's neighbour weighting differs between the README example and the function default (section 4). The Seurat version is not captured, and whether its kNN count includes the cell itself is not confirmed. The sklearn mixture defaults in section 4 come from the rapids mirror. Monkeybread [R6] is cited for its scope only.
- **Licences and data terms.** squidpy's UTAG port cites the UTAG code (`squidpy/src/squidpy/gr/_niche.py:510`), so its provenance is checked before any port. The licence and size of the two 10x Visium datasets are not confirmed.
- **Technical risks.** The full-covariance mixture is unstable when $n$ is small relative to $Kp^2$, and singular covariances are regularised only by `reg_covar`. Ring and profile statistics depend on neighbourhood size, so a fixed-scale graph fails at other densities, and per-library fits are not comparable.
- **First experiment.** On B1 at zero label noise and $K=10$, compare `composition` at $d=1$ and $d=3$ with non-spatial clustering of the same cells, and report the cell-type reproduction score before any other comparison.

## 11. References

R1. Varrone M, Tavernari D, Santamaria-Martínez A, Walsh LA, Ciriello G. CellCharter reveals spatial cell niches associated with tissue remodeling and cell plasticity. *Nature Genetics* 2024. doi:10.1038/s41588-023-01588-4 — verified (corpus)

R2. Birk S, et al. Quantitative characterization of cell niches in spatially resolved omics data. *Nature Genetics* 2025. doi:10.1038/s41588-025-02120-6 — verified (repo)

R3. Singhal V, Chou N, Lee J, et al. BANKSY unifies cell typing and tissue domain segmentation for scalable spatial omics data analysis. *Nature Genetics* 2024. doi:10.1038/s41588-024-01664-3 — verified (repo)

R4. Palla G, et al. Squidpy: a scalable framework for spatial omics analysis. *Nature Methods* 2022. doi:10.1038/s41592-021-01358-2 — verified (corpus)

R5. Kim J, et al. Unsupervised discovery of tissue architecture in multiplexed imaging. *Nature Methods* 2022. doi:10.1038/s41592-022-01657-2 — verified (corpus)

R6. Bernstein MN, et al. Monkeybread: a Python toolkit for the analysis of cellular niches in single-cell resolution spatial transcriptomics data. *bioRxiv* 2023. doi:10.1101/2023.09.14.557736 — verified (corpus)


R7. Levy N, Ingelfinger F, Bakulin A, Cinnirella G, Boyeau P, Nadler B, Ergen C, Yosef N. scVIVA: a probabilistic framework for representation of cells and their environments in spatial transcriptomics. *bioRxiv* 2025. doi:10.1101/2025.06.01.657182 — verified (corpus)


R8. Luecken MD, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)

R9. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)

R10. Lohoff T, et al. Integration of spatial and single-cell transcriptomic data elucidates mouse organogenesis. *Nature Biotechnology* 2021. doi:10.1038/s41587-021-01006-2 — verified (corpus)

R11. scikit-learn developers. Metrics: adjusted_rand_score, normalized_mutual_info_score, adjusted_mutual_info_score. *scikit-learn documentation*, version not recorded. — unverified (memory)

R12. 10x Genomics. Human Breast Cancer: Ductal Carcinoma In Situ, Invasive Carcinoma (FFPE). Dataset page 2021. — verified (corpus)

R13. 10x Genomics. Human Colorectal Cancer, 11 mm Capture Area (FFPE). Dataset page 2023. — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/squidpy | scverse; maintainers Selman Ozleyen and Tim Treis | BSD-3-Clause (LICENSE; pyproject) | composition, enrichment and CellCharter-flavour defaults | port |
| https://github.com/CSOgroup/cellcharter | CSO group; maintainer Marco Varrone | BSD-3-Clause (LICENSE, copyright 2022 Marco Varrone) | ring features, mixture and ClusterAutoK defaults | port |
| https://github.com/scverse/rapids_singlecell | Severin Dicks; scverse | MIT (LICENSE; copyright 2022 Severin Dicks, 2025 scverse) | GPU niche paths and GMM defaults | callout (P1 comparator) |
| https://github.com/prabhakarlab/Banksy_py | Nigel Chou, Yifei Yue, Vipul Singhal; maintainer Vipul Singhal | GPL-3.0 (LICENSE.md; pyproject) | comparator with lambda and PCA defaults | callout |
| https://github.com/ElementoLab/utag | — | GPL-3.0 text in LICENSE; GPL-3.0-or-later in pyproject | origin of UTAG-style aggregation | callout |
| https://github.com/Lotfollahi-lab/nichecompass | Sebastian Birk (author and maintainer) | BSD-3-Clause (LICENSE, copyright 2024 Sebastian Birk, Carlos Talavera-López, Mohammad Lotfollahi) | comparator; consistency metrics and training defaults | callout |
| https://github.com/scverse/scvi-tools | scvi-tools development team | BSD-3-Clause (LICENSE, copyright Yosef Lab, Weizmann Institute of Science) | scVIVA niche keys and docstring defaults | callout |
| https://github.com/satijalab/seurat | Rahul Satija and further contributors | MIT (DESCRIPTION; LICENSE) | BuildNicheAssay comparator | callout |
