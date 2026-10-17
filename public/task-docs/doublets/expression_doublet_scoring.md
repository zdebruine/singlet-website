---
id: doublets.expression_doublet_scoring
title: Expression-based per-cell doublet scoring
area: doublets
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [ingest-quant.umi_deduplication, cell-calling.cell_vs_empty_droplet_calling, cell-calling.nucleus_vs_empty_calling]
feeds: [doublets.doublet_call_thresholding, doublets.ensemble_doublet_calling, doublets.artifact_cluster_detection]
reads: [layers/counts, obs/<sample_key>, models/<scvi_model_key>]
writes: [obs/doublet_score_<method>, obs/doublet_score_se_scrublet, uns/doublet_sim_scores_<method>, uns/doublet_params_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_doublets_expression_doublet_scoring
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Expression-based per-cell doublet scoring

> Scores each barcode of one library's raw UMI count matrix by how much its expression resembles a mixture of two cells, using simulated doublets as the reference, and returns a continuous per-cell score that a later step converts into calls.

## 1. Question

Given the raw UMI count matrix of one library with barcodes already called as cells, how strongly does each barcode's expression resemble a mixture of two or more cells? The output is one continuous score per barcode (higher is more doublet-like) and the simulated-doublet score distribution it was derived from; turning scores into labels belongs to doublets.doublet_call_thresholding. A correct answer ranks true multiplets above singlets. The field has no single ground truth. The proxies are experimental multiplex labels (cell hashing, donor genotype), doublets planted by simulation from singlets with known parents, and multi-omic discordance, each with a blind spot (sections 2 and 8).

## 2. Why this task matters and where the field stands

A droplet or well that captures two cells yields one barcode with a mixed profile that can pass for an intermediate state or a new population [R1]. Expression-based scoring needs no extra assay, so it is the only option without hashing or genotype labels. Every detector in use assumes that multiplets are random co-encapsulations, so pairs of singlets from the same library stand in for real doublets. The Scrublet README therefore advises running it per sample, because merged data can break the cell-type-proportion assumption; the best-practices book gives the same advice [R2].

The status is **contested**.

1. **Benchmarks do not settle the choice.** Xi and Li compared nine detectors on 16 real datasets with experimentally annotated doublets and 112 realistic synthetic datasets. DoubletFinder had the best detection accuracy, cxds the best computational efficiency, and no method dominated [R3]. Their follow-up protocol added scDblFinder [R4]; the scDblFinder README quotes it as reporting the highest mean AUPRC and AUROC and the top precision, recall and TNR at a 10% identification rate [R5].
2. **Truth labels are incomplete and skewed.** Hashing and genotype labels flag only doublets whose parents come from different samples or donors. Doublets within one sample stay unlabelled even when heterotypic, while labelled inter-sample homotypic doublets are nearly undistinguishable from real cells transcriptionally [R5]. A 2025 study that takes hashing-identified multiplets as reference reports that computational detectors recover only a small subset of them [R6]. Multi-omic discordance [R7], a third proxy, belongs to doublets.multiomic_multiplet_detection.
3. **Open problems.** Homotypic doublets are nearly indistinguishable from real cells transcriptionally, so neighbourhood and classifier scores both struggle [R2][R5]. The expected-rate prior enters every method and implementation defaults differ (section 4). DoubletFinder chooses its neighbourhood fraction by a bimodality sweep, not a likelihood (section 3). Scores from different families are not on one scale.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $n$, $r$ | barcodes in the scored library; simulated-to-observed ratio $r=n_{\mathrm{sim}}/n$ |
| $\rho$ | expected doublet rate, the prior fraction of observed barcodes that are doublets |
| $q_i$, $k_{\mathrm{adj}}$ | smoothed simulated-neighbour fraction of barcode $i$; the neighbour count it is taken over |
| $p_N$, $p_K$, $m$ | DoubletFinder artificial fraction, neighbourhood fraction and neighbour count |
| $f_D$, $f_S$, $f_O$ | densities of doublets, singlets and observed barcodes in the embedding $z$, with $f_O=\rho f_D+(1-\rho)f_S$ |
| $g(z)$ | classifier probability that an embedded barcode is simulated rather than observed |

**Shared construction.** Pairs of observed barcodes are drawn with replacement and combined into artificial doublets by summing raw counts $d=x_a+x_b$ (Scrublet, DoubletDetection, Solo, bcds, Vaeda, scDblFinder) or by averaging $d=\tfrac12(x_a+x_b)$ (DoubletFinder). Observed and artificial barcodes are embedded together and each observed barcode is scored by how artificial its neighbourhood or classifier output is. A sum carries the library size of both parents and a mean that of one, so scores from the two conventions are not comparable. cxds needs no simulation.

**Scrublet** [R1]. With $k_0=\mathrm{round}(0.5\sqrt n)$ and $k_{\mathrm{adj}}=\mathrm{round}(k_0(1+r))$, let $n^{\mathrm{sim}}_i$ count the artificial barcodes among the $k_{\mathrm{adj}}$ nearest neighbours of observed barcode $i$ in the merged principal-component space. Then

$$
q_i=\frac{n^{\mathrm{sim}}_i+1}{k_{\mathrm{adj}}+2},\qquad L_i=\frac{q_i\rho/r}{(1-\rho)(1-q_i)+q_i\rho/r}.
$$

The denominator equals the reference code's $1-\rho-q_i(1-\rho-\rho/r)$. Read as a Bayes rule, $L_i$ is $\rho f_D/(\rho f_D+(1-\rho)f_S)$ with $q_i/r$ standing in for $f_D$ and $1-q_i$ for $f_S$. This is an approximation, because observed neighbours include real doublets. *Regime:* $0<\rho<1$ and $r>0$. The denominator is linear in $q_i$ and positive on $[0,1]$ (it equals $1-\rho$ at $q_i=0$ and $\rho/r$ at $q_i=1$), so $L_i$ increases strictly with $q_i$ and lies in $(0,1)$ because $q_i<1$ and $L=1$ at $q_i=1$. For fixed $\rho$ and $r$ the ranking by $L_i$ is therefore the ranking by $n^{\mathrm{sim}}_i$, with ties at equal counts; $\rho$ and $r$ rescale the score and never reorder barcodes within a library. The standard error `obs/doublet_score_se_scrublet` is the reference's delta-method error of $L_i$, built from $\mathrm{se}(q_i)=\sqrt{q_i(1-q_i)/(k_{\mathrm{adj}}+3)}$ and a fixed $\sigma_\rho=0.02$; it is meaningful when $k_{\mathrm{adj}}$ is large, and $L_i$ is coarse when it is small.

**DoubletFinder** [R8]. It creates $n_a=\mathrm{round}(n/(1-p_N)-n)$ artificial doublets, reduces the merged normalised data to principal components and scores each real barcode by $\mathrm{pANN}_i=\tfrac1m\#\{\text{artificial barcodes among its } m \text{ nearest neighbours, itself excluded}\}$, with $m=\mathrm{round}((n+n_a)\,p_K)$. The score takes at most $m+1$ values. $p_K$ is chosen by maximising BCmvn, the mean over $p_N$ of the bimodality coefficient of the pANN distribution divided by its variance; this is a heuristic, not a likelihood. The reference holds the dense $(n+n_a)\times(n+n_a)$ distance matrix, so memory is quadratic.

**Solo** [R9]. A fitted scVI model encodes observed and summed-pair barcodes; an MLP on the latent vector concatenated with log library size is trained to separate them, and its probability is the score. That score is $g(z)$, the probability of being simulated under class sizes $n$ and $rn$, not a doublet probability. The original command line optionally shifts the logits (`-recalibrate_scores`) until the mean score stabilises.

**scDblFinder** [R5]. Artificial doublets are summed counts, cluster-based when clusters are supplied and random otherwise. Neighbourhood-enrichment and cell-level features feed an xgboost classifier refit `iter` times, each time without the real barcodes already called doublets. The score is the classifier output; its thresholding belongs to the call task.

**Cluster- and co-expression-based scores.** DoubletDetection [R10] tests each cluster of the augmented data for synthetic-doublet enrichment with an upper-tail hypergeometric test and averages over $T$ fits, $\bar s_i=-\tfrac1T\sum_t\log p^{(t)}_i$, so barcodes of one cluster share a score and the score is unbounded. cxds [R11] scores a barcode by the summed $-\log$ binomial p-values of the gene pairs it co-expresses, under a null of independent genes; bcds is a classifier of summed-pair versus observed barcodes, as in Solo. Vaeda [R12] adds positive-unlabelled learning on a VAE embedding.

**Estimands.** Each output is on its own scale: $L_i\in(0,1)$ depends on $\rho$ and $r$; pANN$\in[0,1]$ depends on $p_N$ and $p_K$; $g\in(0,1)$ depends on $r$; DoubletDetection and cxds scores are unbounded. The benchmark truth is a binary per-barcode flag (1 = the barcode holds at least two cells); its prevalence is the flagged fraction, which is the chance level of average precision.

**Assumptions and failure modes.** The simulation must match real doublets in depth and capture. Heterotypic doublets are separable only if the embedding keeps the programmes that distinguish their parents. Homotypic doublets look like singlets of their type. Merged samples give a pool that matches no sample. Classifiers can learn simulation artefacts such as library size (section 10).

**What a model-based formulation adds.** Neighbour scores work because a doublet lies between its parents' clusters, but they are not calibrated probabilities: the scale depends on $r$, $k_{\mathrm{adj}}$, $p_N$, $p_K$ and the number of components, and uncertainty is limited to Scrublet's binomial error. If artificial doublets follow $f_D$ and observed barcodes the mixture $f_O$, a classifier trained on $n$ observed and $rn$ artificial barcodes has $g/(1-g)=r f_D/f_O$, so

$$
P(\delta_i=1\mid z_i)=\frac{\rho f_D(z_i)}{f_O(z_i)}=\min\!\Big(1,\ \frac{\rho}{r}\,\frac{g(z_i)}{1-g(z_i)}\Big).
$$

*Regime:* the artificial law equals the real doublet law, $g$ is Bayes-optimal and $\rho$ is correct; violations appear as miscalibration, which B2 measures.

**Pitfalls from benchmarks.** Planted benchmarks favour detectors that simulate the same way (B2). Scrublet counts and pANN are tied for small $n$ or $m$, so the tie convention changes AUPRC. Means of AUPRC across datasets mix prevalence with accuracy.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Scrublet | model-based | Sums of random cell pairs are embedded with the observed barcodes (PCA of variability-filtered, z-scored counts), and the simulated-neighbour fraction becomes the closed-form score $L_i$, which depends on $\rho$ and $r$. | [R1] |
| DoubletFinder | heuristic | Means of random real-cell pairs are the artificial doublets; each real barcode is scored by pANN, the artificial fraction among its nearest neighbours in PCA space, with $p_K$ chosen by a BCmvn sweep. | [R8] |
| scDblFinder | hybrid | Cluster-based (or random) artificial doublets, neighbourhood-enrichment and cell-level features, and an xgboost classifier refit `iter` times without real barcodes already called doublets. | [R5] |
| DoubletDetection | hybrid | Per fit, synthetic doublets are added, the augmented data are clustered (PhenoGraph by default) and each cluster gets a hypergeometric enrichment p-value; the score is the negative mean log p over fits. | [R10] |
| scds (cxds, bcds, hybrid) | hybrid | cxds: binomial test of gene-pair co-expression on binarised counts; bcds: xgboost on observed versus summed-pair barcodes; hybrid: sum of the min-max-scaled scores. | [R11] |
| Solo | model-based | A fitted scVI model encodes observed and summed-pair barcodes, and an MLP on latent plus log library size separates them; its probability is the score. | [R9] |
| Vaeda | model-based | Rescaled simulated doublets (same-cluster parents dropped), a VAE embedding with a cluster-classifier loss, and a bagged positive-unlabelled classifier. | [R12] |

The published standard is the nine-detector set of Xi and Li [R3], extended by scDblFinder in their follow-up [R4]; the Solo article compares against Scrublet and DoubletFinder [R9]. Scrublet and DoubletFinder stay comparators in every benchmark. Other detectors exist, for example DoubletDecon [R13], and are outside this document. The defaults below are those the benchmarks run; singlet's own defaults are in section 6.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| Scrublet | `sim_doublet_ratio`, `expected_doublet_rate`, `stdev_doublet_rate`, `random_state` | 2.0, 0.1, 0.02, 0 | `src/scrublet/scrublet.py:6` @88d6efe |
| Scrublet | `n_neighbors` | None, then round(0.5 sqrt(n_obs)) | `scrublet.py:125-126` @88d6efe |
| Scrublet | `min_counts`, `min_cells`, `min_gene_variability_pctl` | 3, 3, 85 | `scrublet.py:130` @88d6efe |
| Scrublet | `log_transform`, `mean_center`, `normalize_variance`, `n_prin_comps` | False, True, True, 30 | `scrublet.py:130` @88d6efe |
| Scrublet | `use_approx_neighbors`, `distance_metric`, Annoy trees | True, euclidean, 10 | `scrublet.py:130`; `helper_functions.py:406` @88d6efe |
| Scrublet | total counts after simulation | 1e6 | `scrublet.py:220` @88d6efe |
| Scrublet (scanpy, rapids-singlecell) | `expected_doublet_rate` | 0.05 | `src/scanpy/preprocessing/_scrublet/__init__.py:33` @8ed52d9; `src/rapids_singlecell/preprocessing/_scrublet/__init__.py:35` @e110792 |
| DoubletFinder | `pN` | 0.25 | `R/doubletFinder.R:61` @1b244d8 |
| DoubletFinder | `PCs`, `pK`, `nExp` | no default | `R/doubletFinder.R:60-63` @1b244d8 |
| DoubletFinder | artificial doublet; `sct` | mean of two real cells drawn with replacement; FALSE | `R/doubletFinder.R:85-89`, `:65` @1b244d8 |
| DoubletFinder | BCmvn | mean(BC) / var(BC) over the sweep | `R/find.pK.R:44` @1b244d8 |
| scDblFinder | `dbr.per1k`, `nfeatures`, `dims` | 0.008, 1352, 20 | `R/scDblFinder.R:212` @e66180a |
| scDblFinder | `includePCs`, `propRandom`, `clusters` | 19, 0, NULL | `R/scDblFinder.R:210`, `:213` @e66180a |
| scDblFinder | `score`, `nrounds`, `max_depth`, `iter` | xgb, 0.25, 4, 3 | `R/scDblFinder.R:215-216` @e66180a |
| scDblFinder | `multiSampleMode`, `threshold` | split, TRUE | `R/scDblFinder.R:217-218` @e66180a |
| scDblFinder | `dbr.sd` | documented 40% of `dbr`, minimum 0.02; coded `0.5*gdbr+0.025` | `R/scDblFinder.R:48-51`, `:631` @e66180a |
| Solo | `doublet_ratio` | 2 | `src/scvi/external/solo/_model.py:112` @5555ecc |
| Solo | simulated doublet; classifier input | sum of two parents drawn with replacement; latent plus log library size | `_model.py:275-276`, `:220` @5555ecc |
| DoubletDetection | `boost_rate`, `n_components`, `n_top_var_genes`, `replace` | 0.25, 30, 10000, False | `doubletdetection/doubletdetection.py:75-78` @ce70f4d |
| DoubletDetection | `clustering_algorithm`, `n_iters`, `pseudocount` | phenograph, 10 (docstring says 25), 0.1 | `doubletdetection.py:79`, `:81`, `:83`; docstring `:39` @ce70f4d |
| scds | cxds `ntop`, `binThresh`; bcds `ntop`, `srat`, `nmax` | 500, 0; 500, 1, tune | `R/cxds.R:24`; `R/bcds.R:38-39` @c9054c2 |
| Vaeda | `num_hvgs`, `pca_comp`, `enc_sze`, `remove_homos` | 2000, 30, 5, True | `vaeda/vaeda.py:25-32` @7b4979c |

## 5. Proposed singlet approach

**Routes** (licences in section 12). Port: `scrublet` (default), `doubletfinder`, `solo`. Reimplement from the article and documentation, copying no code: `scdblfinder`. DoubletDetection, scds and Vaeda are benchmark comparators run by the harness from their own packages; they are not values of the MCP `method` parameter.

**Default method.** `scrublet`: a closed-form score with explicit rate prior, simulation ratio and standard error, no training and a permissive licence. Its defaults are the reference defaults of section 4 except `expected_doublet_rate`, 0.05 as in scanpy and rapids-singlecell. The DoubletFinder port keeps the averaging and pANN, replaces the dense distance matrix with approximate neighbours and runs the BCmvn sweep when `pK` is null. The Solo port takes a fitted scVI model from `models/<scvi_model_key>` and trains the MLP head in PyTorch.

**Proposed model-based method.** A `posterior` method would train the classifier $g$ of section 3 on the merged embedding and report $\min(1,(\rho/r)\,g/(1-g))$, with $\rho$ from doublets.expected_rate_estimation or the user. It joins the enum only after passing B2, and is falsified if on planted libraries its planted-fraction or calibration error exceeds the B2 limits or it misses the B2 margin over `scrublet` on the heterotypic stratum.

**What would falsify the default.** The port is rejected if, fed the reference's merged embedding with exact neighbours, it misses $L_i$ and its standard error by more than 1e-6 relative error, or if B1 fails. With approximate neighbours identity is not expected, because singlet's neighbour search is not Annoy.

**ML stack.** PyTorch for minibatch-trained networks (the Solo head and the posterior classifier). Hard-coded CUDA/cuSPARSE only for small parameter-free kernels: CSR row-pair gather-sum, projection of simulated rows onto principal-component loadings, $L_i$ and pANN from neighbour indices, and BCmvn. Truncated SVD and neighbour search come from dim-reduction.scalable_truncated_svd and neighbors.approximate_knn_search.

**Devices and scale.** Scoring needs the whole merged embedding of one library, so streaming works across libraries, not cells; device memory bounds $n+n_{\mathrm{sim}}$.

**Training data.** The singlet catalogue (354 million uniformly processed cells, about 40% with author annotations) supplies the B2 pools, split by donor or study.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse integer | Raw UMI counts of the barcodes to score; non-integer layers are rejected. |
| read | obs/<sample_key> | categorical | Library label; read only when `sample_key` is set. |
| read | models/<scvi_model_key> | model object | Fitted scVI model; read only by `solo`. |
| write | obs/doublet_score_<method> | float32 | Per-barcode score on the method's own scale (section 3). |
| write | obs/doublet_score_se_scrublet | float32 | Standard error of $L_i$; written by `scrublet` only. |
| write | uns/doublet_sim_scores_<method> | float array | Scores of the simulated doublets, for the call step, where the method produces them. |
| write | uns/doublet_params_<method> | dictionary | Every value used, the route, the software identifier and the seed. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "scrublet" | `scrublet`, `doubletfinder`, `scdblfinder`, `solo` | Detector. scrublet (default, closed-form), doubletfinder, scdblfinder, solo (needs solo.scvi_model_key). Scores are on method-specific scales. |
| `sample_key` | string/null | null | — | obs column naming each library; each is scored separately. Set it whenever the dataset merges libraries. Null treats the dataset as one library. |
| `expected_doublet_rate` | number | 0.05 | > 0; < 1 | Expected doublet rate rho: the prior for scrublet; recorded for every method and passed to doublets.doublet_call_thresholding. |
| `scrublet` | object | — | — | Options used only when method is scrublet. |
| `scrublet.sim_doublet_ratio` | number | 2.0 | > 0 | Simulated doublets per observed barcode, r. |
| `scrublet.n_neighbors` | integer/null | null | min 2 | Base neighbour count k0. Null uses round(0.5 * sqrt(n)). |
| `scrublet.n_prin_comps` | integer | 30 | min 2 | Principal components of the merged embedding; must be below the number of barcodes and genes. |
| `scrublet.min_gene_variability_pctl` | number | 85.0 | min 0; max 100 | Genes below this variability percentile are dropped before simulation. |
| `scrublet.use_approx_neighbors` | boolean | true | — | Approximate neighbour lookup (true) or exact (false); exact scales quadratically with barcodes. |
| `doubletfinder` | object | — | — | Options used only when method is doubletfinder. |
| `doubletfinder.pN` | number | 0.25 | > 0; < 1 | Artificial doublets as a fraction of the merged real plus artificial data. |
| `doubletfinder.pK` | number/null | null | > 0; < 1 | Neighbourhood fraction. Null runs the BCmvn sweep and records the chosen value. |
| `doubletfinder.n_prin_comps` | integer | 30 | min 2 | Principal components used for pANN. The reference has no default; singlet uses 30. |
| `doubletfinder.use_approx_neighbors` | boolean | true | — | Approximate neighbour lookup (true) or the exact dense distance matrix (false). |
| `scdblfinder` | object | — | — | Options used only when method is scdblfinder. |
| `scdblfinder.dbr_per_1k` | number | 0.008 | > 0 | Expected doublet rate per thousand cells; halve it for high-throughput 10x chips. |
| `solo` | object | — | — | Options used only when method is solo. |
| `solo.scvi_model_key` | string/null | null | — | Key of a fitted scVI model at models/<key>. Required when method is solo. |
| `solo.doublet_ratio` | integer | 2 | min 1 | Simulated doublets per observed barcode used to train the classifier. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for pair sampling, neighbour lookup and classifier training; recorded in uns/doublet_params_<method>. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace the obs and uns members written by a previous run of this tool instead of failing. |
<!-- PARAMS:AUTO:END -->

`sample_key` must be set whenever the dataset holds more than one library. `expected_doublet_rate` is $\rho$ for `scrublet` and a recorded prior passed to the call step for every method; `scdblfinder` takes its rate from `scdblfinder.dbr_per_1k`, and DoubletFinder's `nExp` belongs to the call step. A method-specific block applies only to its method and is ignored, and recorded as ignored, otherwise. `solo.scvi_model_key` is required for `solo`. The same `seed` reproduces pair sampling and the neighbour index on one device.

## 7. MCP tool

Tool name `singlet_doublets_expression_doublet_scoring` (definition in `tasks/mcp/singlet_doublets_expression_doublet_scoring.json`).

```json
{"dataset": "data/lib1.singlet", "method": "scrublet", "sample_key": "sample_id",
 "expected_doublet_rate": 0.05, "seed": 0}
```

```json
{"dataset": "data/lib1.singlet", "status": "completed",
 "wrote": ["obs/doublet_score_scrublet", "obs/doublet_score_se_scrublet",
           "uns/doublet_sim_scores_scrublet", "uns/doublet_params_scrublet"],
 "summary": {"method": "scrublet", "route": "port", "libraries_scored": "<libraries>",
             "barcodes_scored": "<n>", "simulated_doublets": "<n_sim>", "score_median": "<median>"},
 "provenance_id": "<provenance id>"}
```

Long-running: large inputs return `queued` with a `job_id`; the size threshold is set by the implementation. Stochastic: yes, through `seed`. Dry run: `seconds`, `peak_memory_gb` and `device`, computed from $n$, the gene count and the method, and calibrated on the P1 measurements once they exist.

## 8. Benchmarks

**Shared protocol.** Every tool receives the same raw counts and the same $\rho$, runs per library at its default parameters with seed 0, and tuned runs are reported separately. Metrics are computed per dataset on per-barcode scores and then aggregated. Average precision (AP) is $\sum_k (R_k-R_{k-1})P_k$ over distinct score thresholds with tied scores grouped (the definition of scikit-learn's `average_precision_score`); its chance level is the prevalence. AUROC is the Mann-Whitney probability with ties counted as one half. Top-$k$ calls break ties by a random order seeded with 0. "Significantly worse" means a paired one-sided Wilcoxon signed-rank test over datasets or libraries rejects at $\alpha=0.05$. Comparator versions are the commits in section 12.

### B1. Published benchmark collection of Xi and Li

- **Goal**: rank true doublets above singlets on real libraries with experimental annotation and on synthetic libraries.
- **Ground truth**: for real data, the per-barcode flag released with each dataset (1 = the barcode holds at least two cells according to the multiplexing experiment); for synthetic data, the flag recorded when each doublet was generated. No normalisation; prevalence differs by dataset.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Xi and Li real datasets | [R3][R4]; Zenodo record 4562782 (v3), https://zenodo.org/records/4562782 | scRNA-seq, 16 datasets with experimentally annotated doublets; species and sizes — | — | Labels as released |
| Xi and Li synthetic datasets | same record | scRNA-seq counts, 112 realistic synthetic datasets [R3]; sizes — | — | Flags recorded at generation |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AP | Shared protocol; positives are flagged doublets; mean over datasets | higher | primary | [R4] |
| AUROC | Shared protocol; mean over datasets | higher | primary | [R4] |
| Recall at $k=\lfloor 0.10\,n\rfloor$ | $\mathrm{TP}/D$ for the $k$ top-scoring barcodes, $D$ = flagged doublets. Precision and TNR at fixed $k$ are affine in TP and rank methods identically within a dataset, so they are omitted | higher | guardrail | [R4] |

- **Comparators**: reference Scrublet, DoubletFinder, scDblFinder, DoubletDetection, scds (cxds, bcds, hybrid), Solo and, where its pinned environment installs, Vaeda.
- **Acceptance criterion** (proposed): (a) each singlet port or reimplementation has a mean AP over the 16 real datasets within 0.01 of its reference implementation; (b) singlet `scrublet` has a mean AP within 0.01 of the best comparator and is not significantly worse across datasets. If (b) fails, the default method is revisited.
- **Known pitfalls**: real labels cover inter-sample doublets only, so transcriptome-only detectors are structurally penalised by an unmeasured amount; a synthetic generator that sums random singlets favours detectors that simulate the same way.

### B2. Stratified planted-doublet benchmark with calibration (proposed)

- **Goal**: sensitivity by doublet type and calibration of probability outputs, with known truth.
- **Ground truth**: planted. Each barcode carries a flag, a pair type (heterotypic if the parents' cell types differ) and its parents; the planted fraction is $n_d/(n+n_d)$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted libraries | singlet catalogue annotated cells (internal, no accession) | scRNA-seq counts; 10,000 singlets per library; species per source | per source | Pools split by donor or study |

- **Generator recipe**
  1. Split annotated cells by donor or study into training and test pools; libraries use the test pool.
  2. Draw 10,000 cells from one cell type (homogeneous) or many (heterogeneous), thinning counts to the UMI totals of a real library of comparable chemistry.
  3. For $\rho\in\{0.01,0.05,0.10\}$ add $n_d=\mathrm{round}(\rho n/(1-\rho))$ doublets, each the summed counts of two random library cells; shuffle barcodes and store flag, pair type and parents. Make 20 libraries per library type and $\rho$.
  4. Give every tool the same $\rho$ and counts; fit Solo's scVI model on the pool without doublet labels.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AP per stratum | Positives: planted doublets of one pair type; negatives: all singlets. Strata: heterogeneous-heterotypic, heterogeneous-homotypic, homogeneous-homotypic | higher | primary | — |
| Top-$n_d$ precision | Planted doublets among the $n_d$ top-scoring barcodes (= recall at $k=n_d$) | higher | guardrail | — |
| Calibration | For probability outputs: $\lvert$mean score $-$ planted fraction$\rvert$, and expected calibration error over 10 equal-width bins | lower | primary for `posterior` | — |

- **Comparators**: reference and singlet Scrublet; DoubletFinder with BCmvn $p_K$ and $n_{\mathrm{Exp}}=n_d$; scDblFinder; scds cxds and bcds; Solo; `posterior`.
- **Acceptance criterion** (proposed): (a) `scrublet` is not significantly worse than the best comparator on any stratum; (b) `posterior` becomes the default only if its heterogeneous-heterotypic AP exceeds `scrublet`'s by at least 0.01 (95% bootstrap interval over libraries excluding 0), with planted-fraction error at most 0.005 and calibration error at most 0.02 at $\rho=0.05$.
- **Known pitfalls**: the generator sums counts like Scrublet, DoubletFinder and Solo, so B1's real data check circularity; catalogue cells contain native doublets counted as singlets, which bounds AP.

### P1. Performance and scaling

Libraries of $10^4$, $10^5$ and $10^6$ barcodes from the B2 recipe (the last is a merged-library stress test), on CPU with 1 thread and all threads and on CUDA. Metrics: wall seconds, peak host and device memory, throughput $n/t_{\mathrm{wall}}$. Comparators: reference Scrublet, `scanpy.pp.scrublet`, rapids-singlecell GPU Scrublet, DoubletFinder, scDblFinder, scds cxds, Solo. Hold fixed: seed 0, $\rho=0.05$ and each tool's default component count (Scrublet 30, scDblFinder 20; DoubletFinder has none, so singlet's 30), with the same variable-gene input where a tool accepts one; record hardware and report failures. DoubletFinder's dense double-precision distance matrix needs about $8(n/0.75)^2$ bytes, roughly 140 GB at $10^5$ barcodes, so it is expected to fail there. **Acceptance criterion** (proposed): singlet `scrublet` wall time at $10^5$ barcodes on CPU is at most that of the reference Scrublet at the same thread count; on CUDA every scale completes when device memory suffices, with peak memory reported.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `cell-calling.nucleus_vs_empty_calling`: Nucleus versus empty-droplet calling in single-nucleus RNA-seq
- **Feeds**:
  - `doublets.doublet_call_thresholding`: Doublet score-to-call thresholding
  - `doublets.ensemble_doublet_calling`: Ensemble and consensus doublet calling
  - `doublets.artifact_cluster_detection`: Doublet-driven artifact clusters and doublet-versus-transitional-state discrimination
- **Reads**: `layers/counts`, `obs/<sample_key>`, `models/<scvi_model_key>`
- **Writes**: `obs/doublet_score_<method>`, `obs/doublet_score_se_scrublet`, `uns/doublet_sim_scores_<method>`, `uns/doublet_params_<method>`
<!-- CHAINING:AUTO:END -->

First scoring step of the doublet workflow. doublets.expected_rate_estimation supplies $\rho$; doublets.synthetic_doublet_simulation shares the B2 simulator; dim-reduction.deep_generative_latent_embedding supplies the scVI model for `solo`.

## 10. Risks, pitfalls and open questions

- **Reference parity.** Approximate neighbour sets depend on the index algorithm (the reference uses Annoy with 10 trees) and PCA solvers differ across implementations, so parity is tested with exact neighbours on a shared embedding. Replacing DoubletFinder's dense distance matrix with approximate neighbours changes pANN; B1 criterion (a) measures the effect.
- **Primary-source gaps.** The full texts of the Xi and Li articles, the Solo article and the 2025 study were not available. B1's AP, AUROC and top-$k$ definitions are singlet's, not the articles'. The synthetic generator recipe, the annotation method, species, sizes and licences of the 16 real datasets, and the Zenodo record's terms are not stated. The Solo article's datasets and the 2025 study's datasets and tool list are unknown, so neither is a benchmark here. The STAR Protocols record [R4] is the follow-up in the best-practices book; the scDblFinder README links a preprint of it (arXiv:2101.08860). The top ranking of scDblFinder is the scDblFinder authors' quotation.
- **Source inconsistencies.** DoubletDetection's docstring gives `n_iters` 25 but its signature 10; it has no peer-reviewed methods article, and [R10] is a Zenodo software record. scDblFinder's `dbr.sd` is documented as 40% of `dbr` but coded as `0.5*gdbr+0.025`; which path applies in a given call is not traced.
- **Licence and data.** calico/Solo declares MIT in LICENSE and Apache in setup.py (both permissive); DoubletFinder states CC0 only in DESCRIPTION; the licence of the Xi and Li data and of catalogue sources is not stated. Whether the catalogue carries hashing or genotype labels is unknown, which defers a real-data check on catalogue libraries.
- **Unsettled science.** Whether homotypic doublets are recoverable from transcriptomes, whether learned classifiers exploit simulation artefacts or library size, and how a calibrated $\rho$ should be estimated are open. No snRNA-seq-specific doublet benchmark and no independent comparison after 2022 other than [R6] is cited here.
- **First experiment.** (1) Reproduce $L_i$ and its standard error against the reference on a shared embedding; (2) check that within-library ranking is invariant to $\rho$ and $r$; (3) generate B2 libraries and check that calls at the planted count recover it; then run B1 on the 16 real datasets.

## 11. References

R1. Wolock SL, Lopez R, Klein AM. Scrublet: computational identification of cell doublets in single-cell transcriptomic data. *Cell Systems* 2019. doi:10.1016/j.cels.2018.11.005 — verified (corpus)
R2. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)
R3. Xi NM, Li JJ. Benchmarking computational doublet-detection methods for single-cell RNA sequencing data. *Cell Systems* 2021. doi:10.1016/j.cels.2020.11.008 — verified (corpus)
R4. Xi NM, Li JJ. Protocol for executing and benchmarking eight computational doublet-detection methods in single-cell RNA sequencing data analysis. *STAR Protocols* 2021. doi:10.1016/j.xpro.2021.100699 — verified (corpus)
R5. Germain PL, Lun A, Garcia Meixide C, Macnair W, Robinson MD. Doublet identification in single-cell sequencing data using scDblFinder. *F1000Research* 2021. doi:10.12688/f1000research.73600.1 — verified (corpus)
R6. Multiplets in scRNA-seq data: extent of the problem and efficacy of methods for removal (authors omitted). *bioRxiv* 2025, doi:10.1101/2025.06.09.658708; published in *PLoS ONE* 2025, doi:10.1371/journal.pone.0333687. — partial (search)
R7. Sun B, Bugarin-Estrada E, Overend LE, Walker CE, Tucci FA, Bashford-Rogers RJM. Double-jeopardy: scRNA-seq doublet/multiplet detection using multi-omic profiling. *Cell Reports Methods* 2021. doi:10.1016/j.crmeth.2021.100008 — verified (corpus)
R8. McGinnis CS, Murrow LM, Gartner ZJ. DoubletFinder: doublet detection in single-cell RNA sequencing data using artificial nearest neighbors. *Cell Systems* 2019. doi:10.1016/j.cels.2019.03.003 — verified (corpus)
R9. Bernstein NJ, Fong NL, Lam I, Roy MA, Hendrickson DG, Kelley DR. Solo: doublet identification in single-cell RNA-seq via semi-supervised deep learning. *Cell Systems* 2020. doi:10.1016/j.cels.2020.05.010 — verified (corpus)
R10. Gayoso A, Shor J, Carr AJ, Sharma R, Pe'er D. DoubletDetection (version 3.0). *Zenodo* 2020. doi:10.5281/zenodo.2678041 — verified (repo)
R11. Bais AS, Kostka D. scds: computational annotation of doublets in single-cell RNA sequencing data. *Bioinformatics* 2019. doi:10.1093/bioinformatics/btz698 — verified (corpus)
R12. Vaeda computationally annotates doublets in single-cell RNA sequencing data (authors omitted). *Bioinformatics* 2022. doi:10.1093/bioinformatics/btac720 — partial (corpus)
R13. DePasquale EAK, Schnell DJ, Van Camp PJ, Valiente-Alandí I, Blaxall BC, Grimes HL, Singh H, Salomonis N. DoubletDecon: deconvoluting doublets from single-cell RNA-sequencing data. *Cell Reports* 2019. doi:10.1016/j.celrep.2019.09.082 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/AllonKleinLab/scrublet | Samuel L. Wolock (setup.py author; LICENSE copyright holder) | MIT (LICENSE) | Reference Scrublet at 88d6efe; a mirror, swolock/scrublet (67f8ecb, MIT), exists | port (default) |
| https://github.com/chris-mcginnis-ucsf/DoubletFinder | Chris McGinnis (aut, cre), Haibo Liu (cre) per DESCRIPTION, version 2.0.6 | CC0 (DESCRIPTION; no LICENSE file) | Reference DoubletFinder at 1b244d8 | port |
| https://github.com/plger/scDblFinder | Pierre-Luc Germain (cre, aut), Aaron Lun (ctb) per DESCRIPTION | GPL-3 + file LICENSE (GNU GPL version 3 text) | Reference scDblFinder at e66180a; comparator | reimplement |
| https://github.com/scverse/scvi-tools | Yosef Lab, Weizmann Institute of Science (LICENSE copyright holder) | BSD-3-Clause (LICENSE) | `scvi.external.SOLO` and scVI at 5555ecc | port (Solo) |
| https://github.com/calico/Solo | Calico (LICENSE copyright holder); a command-line wrapper around scvi-tools SOLO | MIT (LICENSE); setup.py says Apache | Original Solo command line at d94baa3; comparator | callout |
| https://github.com/JonathanShor/DoubletDetection | Adam Gayoso and Jonathan Shor (LICENSE.txt copyright holders) | MIT (LICENSE.txt, pyproject.toml) | Comparator at ce70f4d | callout |
| https://github.com/kostkalab/scds | Dennis Kostka (aut, cre), Abha Bais (aut) per DESCRIPTION | MIT + file LICENSE (copyright holder Dennis Kostka) | Comparator (cxds, bcds, hybrid) at c9054c2 | callout |
| https://github.com/kostkalab/vaeda | Hannah Schriever (setup.py author), Dennis Kostka (LICENSE copyright holders) | MIT (LICENSE, setup.py) | Comparator at 7b4979c | callout |
| https://github.com/scverse/scanpy | scverse (LICENSE copyright holders: scverse, F. Alexander Wolf, P. Angerer, Theis Lab) | BSD-3-Clause (LICENSE) | `scanpy.pp.scrublet`, P1 comparator at 8ed52d9 | callout |
| https://github.com/scverse/rapids_singlecell | Severin Dicks, scverse (LICENSE copyright holders) | MIT (LICENSE) | GPU Scrublet, P1 comparator at e110792 | callout |
