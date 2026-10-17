---
id: spatial-domains.single_slice_domains
title: Single-slice spatial domain identification
area: spatial-domains
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [spatial-preproc.spatial_unit_qc_filtering, feature-selection.highly_variable_gene_selection, dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection]
feeds: [spatial-domains.domain_number_selection, spatial-domains.label_free_domain_quality, spatial-domains.multi_slice_domains, markers-de.cluster_marker_ranking]
reads: [layers/counts, obsm/spatial, obsm/X_pca, obsp/spatial_connectivities, uns/spatial/<library>/images, obs/array_row, obs/array_col]
writes: [obs/<output_key>, obsm/<output_key>_prob, obsm/<output_key>_embedding, obsp/<output_key>_graph, uns/<output_key>/params]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_domains_single_slice_domains
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Single-slice spatial domain identification

> Assigns each spot or cell on one tissue section to a spatially coherent domain from its expression, its coordinates and, optionally, an H&E image; the published standard is Leiden clustering on a joint expression and spatial graph, and singlet proposes a Potts-prior mixture with posterior label probabilities that is not yet validated.

## 1. Question

Given one section with $n$ units (spots, cells or nuclei), counts $X\in\mathbb{Z}_{\ge 0}^{n\times G}$, coordinates $S\in\mathbb{R}^{n\times 2}$ and optionally a registered H&E image, assign each unit a label $z_i\in\{1,\dots,K\}$ so that units in one domain are molecularly similar and spatially contiguous. The outputs are one label per unit, optional per-unit label probabilities, the graph used and the effective parameters. A domain is a region of shared molecular identity, such as a cortical layer, not a cell type. There is no label-free ground truth; the accepted proxies are expert anatomical annotation and planted domains in simulation.

## 2. Why this task matters and where the field stands

Domain labels feed spatially variable gene tests, region comparisons and niche interpretation, so an error made on each section propagates into every downstream comparison, and the labels are hard to validate.

The status is **contested**.

- *Ground truth.* Manual anatomical annotation is the usual reference, for example the cortical layers of Maynard et al. [R1]. Sun et al. argue that treating manual annotation as ground truth and concentrating on Visium and brain data weakens current benchmarks, and propose consensus representations in place of method rankings [R2]. Multi-dataset benchmarks exist [R3][R4].
- *Scale is not identified by the data.* The domain number $K$, the smoothing strength and the neighbourhood size are hyperparameters (Leiden resolution, Potts $\gamma$, SpaGCN length scale, joint-graph weight), and they can outweigh differences between methods.
- *Histology.* No source read here isolates the benefit of the H&E image.
- *Cell resolution and sparse panels.* The six-neighbour default is a hexagonal Visium assumption [R11], and PCA on a few hundred genes is noisy.
- *Calibrated uncertainty.* BayesSpace reports the modal label over MCMC iterations [R5], graph-learning methods return embeddings [R6][R7], and calibration of per-unit label probabilities is untested in the sources read.
- *Scaling.* SpaGCN builds dense $n\times n$ matrices [R6].

## 3. Theory and insight

All methods condition expression on a spatial neighbourhood and then partition. They differ in where: a joint graph built before clustering (Leiden), a prior on the label field fitted with the emission model (Potts), a learned neighbour aggregation followed by a clustering objective (SpaGCN, STAGATE), or neighbour-augmented features clustered afterwards (BANKSY). The data do not fix $K$ or the spatial scale, and most disagreement between methods traces to them.

**Graph.** Units are nodes of $G=(V,E)$ with edges to their $k$ nearest neighbours (symmetrised) or Delaunay neighbours; on a Visium lattice $k=6$ is the first shell, and $N(i)$ denotes the neighbours of $i$. Spatial dependence enters only through $E$. Throughout, $y_i\in\mathbb{R}^D$ are the principal components of unit $i$ (log-normalised, highly variable genes) and $q_{ik}$ is an approximate posterior probability of label $k$.

**Potts-$t$ mixture (singlet's model-based proposal, following BayesSpace [R5]).** Given label $k$, $y_i$ has a Student-$t$ density $t_\nu(\mu_k,\Sigma)$ with $\Sigma$ shared across domains and $\nu=4$, written as a Gaussian with a latent precision weight $w_i\sim\mathrm{Gamma}(\nu/2,\nu/2)$; the Gaussian is the limit $\nu\to\infty$. The label field is specified through its conditionals,
$$P(z_i=k\mid\mathbf z_{-i},\mathbf y)\;\propto\;\phi_{ik}\exp\Big(\tfrac{2\gamma}{\lvert N(i)\rvert}\,n_{ik}\Big),\qquad \phi_{ik}=t_\nu(y_i;\mu_k,\Sigma),\quad n_{ik}=\sum_{j\in N(i)}\mathbf 1[z_j=k].$$
The degree-normalised coupling $2\gamma/\lvert N(i)\rvert$ is the one in BayesSpace's sampler (section 4), so $\gamma$ keeps its meaning across graphs of different degree; in a six-neighbour interior it equals a Potts coupling of $\gamma/3$ per edge. *Regime.* Where degrees differ the conditionals need not derive from one joint distribution, so the result is a pseudo-posterior; it is meaningful when the emission family holds given the labels and $K$ is fixed or chosen by a stated rule.

**Inference.** Mean field (`potts_mean_field`) is variational EM: $q_{ik}\propto\phi_{ik}\exp\big(\tfrac{2\gamma}{\lvert N(i)\rvert}\sum_{j\in N(i)}q_{jk}\big)$, followed by $q$-weighted updates of $\mu_k$, $\Sigma$ and $w_i$. On constant-degree graphs sequential or damped updates are coordinate ascent on the evidence lower bound; synchronous updates can oscillate. The fixed point is local, and mean field ignores correlations between neighbours, so its marginals need not be calibrated (tested in B2). Gibbs sampling (`potts_gibbs`) draws each $z_i$ from the conditional above; with one-hot labels $\mathbf Z$ the neighbour counts are the sparse product $A\mathbf Z$, so a sweep costs $O(\lvert E\rvert K+nD^2+nKD)$ with a shared covariance. Labels are exchangeable, so chains are relabelled by Hungarian matching to a reference sweep before summarising. The output $q_{ik}$ (or the post-burn-in label frequency) is the model's probability that unit $i$ has label $k$, and is a calibrated probability only if the model is correct.

**Choosing $K$.** Marginal likelihoods are intractable. An ICL-type criterion, the lower bound minus $\tfrac{m_K}{2}\log n$ and the assignment entropy ($m_K$ free parameters), is a proposal tested in B2, not a validated rule.

**SpaGCN as implemented [R6].** A colour coordinate is added to the position: mean RGB over a $\beta\times\beta$ pixel patch is combined with channel variances as weights, standardised and scaled to $z_i=c_i\max(\mathrm{sd}(x),\mathrm{sd}(y))\,\alpha_{\rm hist}$. With Euclidean distances $d_{ij}$ in $(x,y,z)$ the dense kernel is $A_{ij}=\exp(-d_{ij}^2/2\ell^2)$, and $\ell$ is found by bisection so that $\frac1n\sum_{ij}A_{ij}-1=p$ within 0.01. The embedding is one linear graph convolution without normalisation or nonlinearity, $H=A\,YW+b$. The clustering layer is a Student-$t$ soft assignment with $\alpha=0.2$; the code writes `q**(alpha+1.0)/2.0`, which raises to $\alpha+1$ and halves, and the halving cancels on row normalisation, so $q_{ik}\propto(1+\lVert h_i-\mu_k\rVert^2/\alpha)^{-(\alpha+1)}$, not the Student-$t$ exponent $-(\alpha+1)/2$. Training minimises the mean Kullback-Leibler divergence to the sharpened target $p_{ik}=q_{ik}^2/f_k\big/\sum_{k'}q_{ik'}^2/f_{k'}$, $f_k=\sum_iq_{ik}$, recomputed every 3 epochs, from centres given by Louvain [R10] on a 10-neighbour graph of the untrained convolved features. *Regime.* The target sharpens the current assignment, so the result depends on initialisation, epochs and seed; $p$ depends on coordinate units and density and must be re-calibrated across platforms.

**Leiden on a joint graph [R9].** $W=(1-\lambda)W^{\rm expr}+\lambda W^{\rm sp}$, with $W^{\rm expr}$ the expression-neighbour connectivities and $W^{\rm sp}$ the spatial connectivities; Leiden maximises $Q=\frac1{2m}\sum_{ij}\big(W_{ij}-r\,w_iw_j/2m\big)\delta(c_i,c_j)$, with weighted degree $w_i$ and $2m=\sum_{ij}W_{ij}$. *Regime.* Communities are guaranteed connected for this objective [R9]. The two matrices need not share a weight scale, so $\lambda=0.2$ is tied to the Scanpy and Squidpy constructions, and one $r$ gives different granularity on graphs of different total weight.

**Assumptions and failure modes.**

| Family | Assumes | Fails when |
|---|---|---|
| Joint-graph Leiden | expression and space point to the same neighbourhoods | small $r$ merges thin layers; large $r$ splits a domain; small $\lambda$ lets expression groups cross space |
| Potts-$t$ | Markov labels on $E$; conditionally independent $t$ emissions | large $\gamma$ over-smooths thin layers; mean field is overconfident; Gibbs switches labels |
| SpaGCN | convolved PCs separate domains; self-training sharpens true structure | collapse onto few clusters, seed dependence, mis-registered or stain-dependent image, quadratic memory |
| Embedding methods (STAGATE, BANKSY) | the embedding keeps domain signal; $K$ or resolution is supplied | technical variation stays in the embedding; the neighbourhood weight trades own expression against neighbourhood signal |

**Why heuristics work, and what the model adds.** Averaging over a neighbourhood lowers the variance of each profile, and Leiden is fast; this works when spatial and molecular structure agree, as for large separated layers. The smoothing strength is then a graph-construction choice. The Potts model states it as one parameter $\gamma$, states the heavy-tailed emission, returns per-unit probabilities (a basis for abstention), and the fitted $(\mu_k,\Sigma)$ can place a new section in the same labelling. Its costs are approximate marginals, slow Gibbs mixing and an unvalidated $K$ rule, so it is an improvement only if B1 and B2 show it.

**Metrics.** For partitions $U,V$ with contingency counts $n_{ij}$ and margins $a_i,b_j$,
$$\mathrm{ARI}=\frac{\sum_{ij}\binom{n_{ij}}{2}-\binom n2^{-1}\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\tfrac12\big[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}\big]-\binom n2^{-1}\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}\ [R13],\qquad \mathrm{NMI}=\frac{I(U;V)}{\tfrac12\big(H(U)+H(V)\big)}.$$
Both are symmetric and invariant to label names, and require the same units in the same order. ARI is chance-corrected (expected value 0 for independent labellings with fixed margins). NMI is not, so it tends to rise with the number of domains; with arithmetic normalisation it equals the V-measure, so only one of the two is reported.

**Pitfalls from benchmark studies.**

- *Circular truth.* A reference drafted by a clustering method scores agreement with that method.
- *$K$ confounds.* A method given the annotated $K$ and one that chooses $K$ are not comparable on one axis, so the two arms are reported separately.
- *Hyperparameter leakage.* Tuning $\ell$, $r$, $\gamma$ or $\lambda$ on the annotation makes the benchmark measure the tuning.
- *Class imbalance.* A thin layer or white matter can be wrong almost everywhere while ARI barely moves; per-class F1 is reported.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Leiden on a joint expression and spatial graph (Scanpy, Squidpy) | heuristic | convex mix of an expression neighbour graph and a spatial neighbour graph, then Leiden at a fixed resolution; the recipe of the best-practices spatial-domains chapter | [R9][R11][R12] |
| BayesSpace | model-based | Student-$t$ emission on PCs with a degree-normalised Potts-type label prior, sampled by MCMC with single-label Metropolis updates and latent weights; also sub-spot enhancement | [R5] |
| SpaGCN | hybrid | dense Gaussian kernel on coordinates plus an optional colour coordinate, one linear graph convolution, soft-assignment clustering layer trained by KL self-training from a Louvain start | [R6] |
| STAGATE | hybrid | graph attention autoencoder whose middle-layer attention learns edge weights of the spatial graph; the latent embedding is clustered downstream | [R7] |
| BANKSY | heuristic | concatenates a unit's expression with neighbourhood-mean and azimuthal Gabor filter features weighted by $\lambda$, then clusters with Leiden (default) or mclust | [R8] |

The published standard is the joint-graph Leiden recipe, the worked example of the best-practices chapter, and every model-based route must meet it. BayesSpace [R5] and SpaGCN [R6] are the model-based and graph-learning references. STAGATE and BANKSY are comparators only. Methods whose paper and code were not read are not listed (section 10).

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| Scanpy Leiden | resolution; n_iterations; use_weights; key_added | 1; −1; True; `leiden` | `src/scanpy/tools/_leiden.py:57, 65, 64, 61` @ 8ed52d9 |
| Scanpy neighbors | n_neighbors; n_pcs | 15; None (all columns of the representation) | `src/scanpy/neighbors/__init__.py:65, 66` @ 8ed52d9 |
| Squidpy spatial_neighbors | n_neighs; delaunay; coord_type | 6; False; grid if `uns['spatial']` exists, else generic | `src/squidpy/gr/_build.py:78, 79, 93` @ f030690 |
| Best-practices chapter | spatial weight in $(1-\alpha)W^{\rm expr}+\alpha W^{\rm sp}$ | 0.2 | `jupyter-book/spatial/domains.ipynb`, code cell 10 @ d581689 |
| SpaGCN calculate_adj_matrix | beta; alpha; histology | 49; 1; True. The active definition is line 44; a second definition at lines 81-126 sits inside a triple-quoted string | `SpaGCN_package/SpaGCN/calculate_adj.py:44, 80, 127` @ dc7a1c2 |
| SpaGCN search_l | start; end; tol; max_run | 0.01; 1000; 0.01; 100 | `util.py:59` @ dc7a1c2 |
| SpaGCN train | num_pcs; lr; max_epochs; weight_decay; opt | 50; 0.005; 2000; 0; `admin` (Adam, `models.py:47-48`) | `SpaGCN.py:24-35` @ dc7a1c2 |
| SpaGCN train | init; n_neighbors; res; tol | louvain; 10; 0.4; 1e-3 | `SpaGCN.py:24-35` @ dc7a1c2 |
| SpaGCN model | alpha; update_interval | 0.2; 3 | `models.py:16, 43` @ dc7a1c2 |
| SpaGCN search_res | start; step; tol; lr; max_epochs; max_run | 0.4; 0.1; 5e-3; 0.05; 10; 10 | `util.py:345` @ dc7a1c2 |
| SpaGCN refine | neighbours; rule | hexagon 6, square 4; the unit and its nearest neighbours by `dis` are counted, and the unit is relabelled when its own label count is below half the neighbour number and the top count is above it | `util.py:390-411` @ dc7a1c2 |
| SpaGCN ez_mode driver | b; s; p; search_res start, max_epochs; train lr, max_epochs | 49; 1; 0.5; 0.7, 20; 0.05, 200 | `ez_mode.py:6, 13, 19` @ dc7a1c2 |
| Best-practices SpaGCN cells | beta; target_num; p | 55; 15; 0.5 | `domains.ipynb`, code cells 24, 30, 28 @ d581689 |
| BayesSpace spatialPreprocess | n.PCs; n.HVGs | 15; 2000 | `R/spatialPreprocess.R:44` @ ba8b422 |
| BayesSpace spatialCluster | d; model; precision | 15; `t`; `equal` | `R/spatialCluster.R:122, 125` @ ba8b422 |
| BayesSpace spatialCluster | nrep; burn.in; thin | 50000; 1000; 100 | `R/spatialCluster.R:126` @ ba8b422 |
| BayesSpace spatialCluster | gamma | Visium 3; ST and VisiumHD 2 | `R/spatialCluster.R:172-176` @ ba8b422 |
| BayesSpace spatialCluster | init.method; alpha; beta; lambda0 | `mclust`; 1; 0.01; 0.01 I | `R/spatialCluster.R:124, 127, 170` @ ba8b422 |
| BayesSpace iterate_t | coupling in the label update; weight-gamma shape | $2\gamma/\lvert N(j)\rvert$ times the same-label neighbour count; $(d+4)/2$ in integer arithmetic | `src/cluster.cpp:528, 532, 508` @ ba8b422 |

## 5. Proposed singlet approach

**Routes** (licences and authors in section 12). `leiden_joint`: reimplement Leiden from [R9] in the C++ core, because the leidenalg backend is copyleft; adopt the Scanpy and Squidpy graph conventions and the best-practices joint-graph recipe. `potts_gibbs`: port of BayesSpace's conditional update and defaults into a categorical Gibbs sweep without the R and Armadillo stack. `potts_mean_field`: new design on the same model. `spagcn`: port of the adjacency, length-scale search, refinement and clustering layer, with the training loop in PyTorch in the Python binding. Callouts (comparators only): BayesSpace, BANKSY, STAGATE and Scanpy Leiden.

**Model-based proposal.** A Potts-$t$ mixture on $D=15$ PCs (the BayesSpace default) fitted by variational EM, with Gibbs sampling as reference; $K$ is given by `n_domains` or chosen by ICL up to `potts.k_max`. The proposal is falsified if, on B2, the mean-field path is miscalibrated, less accurate than `leiden_joint`, disagrees with Gibbs, or its ICL rule misses the planted $K$, or if it fails non-inferiority on B1; thresholds are the acceptance criteria there. `leiden_joint` stays the agent default until `potts_mean_field` passes them.

**ML stack and kernels.** PyTorch is used only for the SpaGCN training loop (a small network with autograd). The Potts path is hard-coded in CUDA with cuSPARSE and cuBLAS for its two small hot operations, the neighbour counts $A\mathbf Z$ and the $n\times K$ emission log-likelihoods, with the update computed in log space. Spatial graph construction (spatial index, or lattice lookup for grids) and graph mixing run on CPU and CUDA. Leiden local moving is CPU-only in the first version. Gibbs sweeps are sequential; a graph-colouring parallel sweep changes the sampler and is off by default. The SpaGCN dense kernel runs on CUDA while it fits in memory; beyond that a sparse kernel is used and validated against the dense reference. A section is processed in memory; streaming is not claimed. There are no pretrained weights: each section is fitted alone.

**Defaults an agent uses without asking.** `method` = `leiden_joint`, `n_domains` null, `leiden_joint.spatial_weight` 0.2, `leiden_joint.resolution` 1.0. It exposes `method`, `n_domains`, `leiden_joint.spatial_weight`, `leiden_joint.resolution` and `potts.gamma` to the user and reports which it changed.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse int | raw counts; used only when `obsm/X_pca` is absent (normalised, then PCA) |
| read | `obsm/spatial` | float, $n\times 2$ | unit coordinates |
| read | `obsm/X_pca` | float, $n\times D$ | principal components of log-normalised expression |
| read | `obsp/spatial_connectivities` | sparse float | optional spatial graph; rebuilt when absent |
| read | `uns/spatial/<library>/images` | image and scale factors | optional H&E; required when `spagcn.image_key` is set |
| read | `obs/array_row`, `obs/array_col` | int | optional Visium lattice positions, used to detect a hexagonal grid |
| write | `obs/<output_key>` | categorical int | domain label; label names are arbitrary |
| write | `obsm/<output_key>_prob` | float, $n\times K$ | $q_{ik}$ (mean field) or post-burn-in label frequency (Gibbs); Potts methods only |
| write | `obsm/<output_key>_embedding` | float, $n\times D$ | convolved embedding $H$; `spagcn` only |
| write | `obsp/<output_key>_graph` | sparse float | graph on which the labels were computed (the joint graph for `leiden_joint`) |
| write | `uns/<output_key>/params` | object | effective parameters, seed, $K$-selection record, package versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "leiden_joint" | `leiden_joint`, `potts_mean_field`, `potts_gibbs`, `spagcn` | leiden_joint: Leiden on a mixed expression and spatial graph. potts_mean_field and potts_gibbs: Potts-t mixture with probabilities. spagcn: graph convolution with clustering layer. |
| `n_domains` | integer/null | null | min 2 | Target number of domains. Resolution search for leiden_joint and spagcn; fixes K for Potts methods. Null: default resolution, or ICL selection of K. |
| `output_key` | string | "spatial_domain" | — | Prefix of all written members, for example obs/<output_key> and obsp/<output_key>_graph. |
| `common` | object | — | — | Options shared by all methods. |
| `common.n_pcs` | integer/null | null | min 1; max 200 | Principal components used. Null: all of obsm/X_pca for leiden_joint, 50 for spagcn, 15 for Potts methods. |
| `common.n_hvgs` | integer | 2000 | min 1 | Highly variable genes for PCA; used only when obsm/X_pca is absent. |
| `common.graph_type` | string | "knn" | `knn`, `delaunay` | Spatial graph: k nearest neighbours, or Delaunay for generic positions. |
| `common.n_neighbors` | integer | 6 | min 1 | Spatial neighbours k; 6 is the Squidpy grid default. Ignored for delaunay. |
| `leiden_joint` | object | — | — | Options for method leiden_joint. |
| `leiden_joint.expr_n_neighbors` | integer | 15 | min 1 | Neighbours in the expression graph (Scanpy default). |
| `leiden_joint.spatial_weight` | number | 0.2 | min 0; max 1 | Weight lambda of the spatial graph in the joint graph. |
| `leiden_joint.resolution` | number | 1.0 | > 0 | Leiden resolution; used when n_domains is null. |
| `leiden_joint.refine_labels` | boolean | false | — | Apply the SpaGCN refinement rule to the final labels. |
| `potts` | object | — | — | Options for methods potts_mean_field and potts_gibbs. |
| `potts.gamma` | number/null | null | min 0 | Degree-normalised Potts strength. Null: 3 on a hexagonal lattice, 2 otherwise (BayesSpace defaults). |
| `potts.k_max` | integer | 15 | min 2 | Largest K tried by ICL when n_domains is null. |
| `potts.mcmc_iterations` | integer | 1000 | min 1 | Gibbs sweeps for potts_gibbs; must exceed burn_in. |
| `potts.burn_in` | integer | 100 | min 0 | Gibbs sweeps discarded before summarising; below mcmc_iterations. |
| `spagcn` | object | — | — | Options for method spagcn. |
| `spagcn.image_key` | string/null | null | — | uns/spatial key of the H&E image; non-null adds the colour coordinate. Null: coordinates only. |
| `spagcn.histology_patch` | integer | 49 | min 1 | Patch size beta for averaging colour around each unit. |
| `spagcn.histology_scale` | number | 1.0 | > 0 | Scale alpha of the colour coordinate. |
| `spagcn.p` | number | 0.5 | > 0 | Target mean summed neighbour weight that calibrates the length scale. |
| `spagcn.lr` | number | 0.005 | > 0 | Learning rate of the training loop. |
| `spagcn.max_epochs` | integer | 2000 | min 1 | Maximum training epochs. |
| `spagcn.refine_labels` | boolean | false | — | Apply the SpaGCN refinement rule to the final labels. |
| `seed` | integer | 0 | min 0 | Random seed for initialisation, Gibbs sampling and spagcn training. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when the method has a CUDA path and memory allows. leiden_joint runs on CPU. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing labels. |
| `overwrite` | boolean | false | — | Replace existing members with the same output_key instead of failing. |
<!-- PARAMS:AUTO:END -->

Options of other methods are ignored and echoed as unused in `uns/<output_key>/params`. `n_domains` drives a resolution search for `leiden_joint` and `spagcn` (the achieved count is reported and can differ); for the Potts methods it fixes $K$, and when null ICL chooses $K$ from 2 to `potts.k_max`. A null `common.n_pcs` uses all columns of `obsm/X_pca` for `leiden_joint`, 50 for `spagcn` and 15 for the Potts methods; without `obsm/X_pca`, PCA uses `common.n_hvgs` genes and 50 components (a singlet choice). A null `potts.gamma` resolves to 3 on a hexagonal lattice and 2 otherwise. A non-null `spagcn.image_key` switches on the colour coordinate and requires an aligned image. `spagcn` uses `obsm/X_pca`, whereas the reference code recomputes PCA on its input.

## 7. MCP tool

Tool name `singlet_spatial_domains_single_slice_domains` (definition in `tasks/mcp/singlet_spatial_domains_single_slice_domains.json`). Example call, then a compact result (values illustrate the schema and are not measurements):

```json
{"dataset": "/data/section_01.singlet", "method": "potts_mean_field", "n_domains": 7, "seed": 0}
```

```json
{
  "dataset": "/data/section_01.singlet",
  "status": "completed",
  "wrote": ["obs/spatial_domain", "obsm/spatial_domain_prob", "obsp/spatial_domain_graph", "uns/spatial_domain/params"],
  "summary": {"method": "potts_mean_field", "n_domains": 7, "graph": {"n_nodes": 1000, "n_edges": 2950}, "mean_max_probability": 0.91},
  "provenance_id": "prov_0001", "job_id": null, "estimate": null
}
```

- **Long-running**: `potts_gibbs` and `spagcn` may return `queued` with a `job_id` above an implementation-set size.
- **Stochastic**: through `seed`; the same seed, inputs and parameters give the same labels on the same device class.
- **Dry run**: `estimate` gives `seconds`, `peak_memory_gb` and `device`, including graph size and sweep or epoch counts.

## 8. Benchmarks

**Shared protocol.** Each method is evaluated per section and scored on units that carry a reference label (unannotated units are dropped from prediction and reference). Scores are computed per section and averaged over sections without weighting; intervals are 95% percentile bootstrap intervals over sections (B1) or replicates (B2). Every configuration uses 10 seeds and the seed mean enters per section. Two arms are reported separately: *fixed-$K$* sets $K$ to the number of reference classes in the section (it uses label information) and *free-$K$* uses a label-free rule (default resolution, ICL, SpaGCN resolution 0.4). No hyperparameter is tuned on reference labels. Comparators use documented defaults at the commits of sections 4 and 12. ARI and NMI are defined in section 3, and acceptance margins are proposals unless attributed.

### B1. Human DLPFC Visium sections (published data, proposed scoring)

- **Goal**: test whether the singlet methods recover cortical layers and white matter of human dorsolateral prefrontal cortex as well as the comparators.
- **Ground truth**: expert labels. Each spot carries the manual layer or white-matter annotation of Maynard et al. [R1]; it labels the spot mixture, not one cell type, and boundary spots are ambiguous.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Human DLPFC Visium (Maynard et al. 2021) | [R1]; spatialLIBD project (research.libd.org/spatialLIBD) | Visium, human; 12 sections from 3 donors, including spatially adjacent replicate pairs; spots per section — | — | report per donor; adjacent replicates are not independent |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | section 3, predicted against annotated labels on annotated spots, per section | higher | primary | [R13] |
| NMI | arithmetic normalisation, same spots | higher | primary | — |
| Per-class F1 (white matter, smallest annotated class) | predicted domains matched one-to-one to annotation classes by Hungarian assignment on the rectangular contingency table, maximising matched spots; unmatched predicted domains count as errors, an unmatched class has F1 0 | higher | guardrail | — |

- **Comparators**: `leiden_joint`, `potts_mean_field`, `potts_gibbs`, `spagcn` (with and without histology as separate arms); callouts BayesSpace, BANKSY (README quick-start settings) and STAGATE.
- **Protocol**: the fixed-$K$ arm is primary; $K$ is the number of annotation classes present in each section. Donor means are reported with the section mean.
- **Acceptance criterion** (proposed): (a) in the fixed-$K$ arm the mean ARI of `potts_mean_field` is at least that of `leiden_joint` minus 0.02, with the paired bootstrap interval of the difference reported; superiority is claimed only if the lower bound exceeds 0. (b) The mean ARI between singlet `spagcn` and reference SpaGCN labels is at least the mean ARI between two reference-code seeds minus 0.05.
- **Known pitfalls**: ARI measures agreement with the annotator, and boundary spots drive differences; few donors turn section effects into donor effects.

### B2. Planted-domain simulation (proposed)

- **Goal**: test recovery, calibration, $K$ selection and sparse-panel robustness with exact truth.
- **Ground truth**: planted simulation. The label of unit $i$ is the region containing it, $z_i^\ast$, exact by construction and not normalised.
- **Generator recipe**:
  1. *Geometry*: $n$ units on a hexagonal lattice, or random centroids with a Delaunay graph.
  2. *Regions*: $K$ Voronoi cells of random seeds (blob), or depth-ordered bands from thresholds of a smooth Gaussian random field (layered).
  3. *Profiles*: base means $b_g>0$ for $G_{\rm full}\ge 1000$ genes; $\mu_{kg}=b_g\exp(\delta m_{kg})$ with a marker mask $m_{kg}\in\{0,1\}$ covering a fraction $\pi$ of genes per region.
  4. *Counts*: log-normal size factors $s_i$; $x_{ig}\sim\mathrm{NB}(s_i\mu_{z_ig},\phi_g)$ with per-gene dispersions.
  5. *Label noise*: a fraction $\varepsilon$ of units takes expression from a neighbouring region and keeps $z_i^\ast$.
  6. *Grid*: $\delta$ on a log grid with $\varepsilon$, $K$ and region size as axes; 10 seeds per cell.
  7. *Panel arm*: $g\in\{100,300,1000\}$ genes drawn from the full panel, $D=\min(n_{\rm pcs},g)$.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated sections, recipe 1-7 | generated, seeds recorded | simulated counts; $n$, $K$, $g$ by design | — | not a model of real tissue |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI, NMI | against $z^\ast$, as in B1 | higher | primary | [R13] |
| Expected calibration error (ECE) | 10 equal-width bins $B_m$ of $\hat p_i=\max_kq_{ik}$; $\sum_m\frac{\lvert B_m\rvert}{n}\lvert\mathrm{acc}(B_m)-\mathrm{conf}(B_m)\rvert$; acc: fraction labelled $z^\ast$ after rectangular Hungarian matching; conf: mean $\hat p_i$; fixed-$K$ arm, probability-writing methods | lower | primary | — |

- **Comparators**: the four singlet methods; callouts BayesSpace and BANKSY.
- **Acceptance criterion** (proposed): where `leiden_joint` reaches mean ARI $\ge 0.8$, `potts_mean_field` is within 0.02 ARI of it with ECE $\le 0.05$; its modal labels agree with `potts_gibbs` on $\ge 95\%$ of units; ICL recovers the planted $K$ in $\ge 80\%$ of free-$K$ replicates; its ARI at $g=100$ is within 0.05 of its full-panel ARI.
- **Known pitfalls**: simulations lacking negative-binomial noise, size-factor variation or layered domains flatter smoothers; segmentation errors are not simulated.

### P1. Performance and scaling

Wall time, peak memory and throughput (units per second) on CPU and CUDA for $n\in\{10^4,10^5,10^6\}$ units from the B2 generator (hexagonal variant), with $K$ and $D$ fixed (a first table at $D=15$, a second at each method's default). Comparators: Scanpy joint-graph Leiden (CPU), BayesSpace at fixed `nrep` (CPU), reference SpaGCN (dense; CPU and GPU where memory allows) and the singlet methods. Hold fixed: threads, hardware, seed, sweep and epoch counts; exclude warm-up and file input; report host-to-device transfer separately.

- **Acceptance criterion** (proposed): CPU peak memory per edge varies by less than a factor of 1.5 across scales; at $n=10^5$ the singlet CPU time is within a factor of 2 of the fastest comparator at the same $D$. A dense SpaGCN evaluation that exceeds device memory is reported as infeasible, which is a valid result.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
- **Feeds**:
  - `spatial-domains.domain_number_selection`: Number-of-domains and spatial parameter selection
  - `spatial-domains.label_free_domain_quality`: Label-free spatial domain quality assessment
  - `spatial-domains.multi_slice_domains`: Multi-slice joint domain identification
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
- **Reads**: `layers/counts`, `obsm/spatial`, `obsm/X_pca`, `obsp/spatial_connectivities`, `uns/spatial/<library>/images`, `obs/array_row`, `obs/array_col`
- **Writes**: `obs/<output_key>`, `obsm/<output_key>_prob`, `obsm/<output_key>_embedding`, `obsp/<output_key>_graph`, `uns/<output_key>/params`
<!-- CHAINING:AUTO:END -->

Single-section path: unit quality control, normalisation, gene selection and PCA come first; label-free quality scoring, domain-number selection and marker ranking follow. The histology option additionally needs image-to-coordinate registration.

## 10. Risks, pitfalls and open questions

- *Unvalidated defaults.* No label-free default for $\gamma$, $\lambda$, $r$, $p$ or $K$ is validated across datasets; the ICL rule and every acceptance margin are proposals. First experiment: build the B2 generator, check the Leiden reimplementation (connected communities, modularity against an independent computation), then test the Potts path against the B2 criteria before any B1 evaluation.
- *Evidence gaps.* A 2024 Nature Methods benchmark attributed to Yuan et al. could not be located in the sources available, so its datasets, methods and scores are not used. The benchmarks [R3][R4] and the DLPFC design [R1] are cited from abstract-level descriptions; the DLPFC accession, spot counts and data licence are unknown, so the data are not redistributed.
- *Methods not assessed.* stLearn, GraphST, SEDR and the Giotto HMRF are not listed because neither paper nor code was read. STAGATE and BANKSY were read from README and code only, and BayesSpace from code and bibliographic record only.
- *SpaGCN source.* The notebook, the ez-mode driver and the `train` defaults use different settings (section 4); the port follows the code, records the configuration, and its sparse kernel must match the dense reference within floating-point tolerance before use.
- *Licences and data.* BANKSY and leidenalg are copyleft and are not linked. The catalogue's author annotations are cell-type labels and are not domain truth, and whether the catalogue holds spatial sections is not established, so training a reusable encoder on it is deferred.
- *Unsettled literature.* The truth itself is contested (annotation against consensus [R2]); the benefit of histology is not isolated; the cell-resolution sparse-panel regime has only the synthetic panel arm of B2.

## 11. References

R1. Maynard KR, Collado-Torres L, et al. Transcriptome-scale spatial gene expression in the human dorsolateral prefrontal cortex. *Nature Neuroscience* 2021;24(3):425-436. doi:10.1038/s41593-020-00787-0 — partial (search)
R2. Sun J, Biharie K, Cai P, et al. Beyond benchmarking: an expert-guided consensus approach to spatially aware clustering. *Nature Methods* 2026. doi:10.1038/s41592-026-03194-8 — partial (search)
R3. Hu et al. Benchmarking clustering, alignment, and integration methods for spatial transcriptomics. *Genome Biology* 2024. — partial (search)
R4. Chen et al. A comprehensive benchmarking for spatially resolved transcriptomics clustering methods across variable technologies, organs, and replicates. *iMeta* 2025. — partial (search)
R5. Zhao E, Stone MR, Ren X, Guenthoer J, Smythe KS, Pulliam T, Williams SR, Uytingco CR, Taylor SEB, Nghiem P, Bielas JH, Gottardo R. Spatial transcriptomics at subspot resolution with BayesSpace. *Nature Biotechnology* 2021. — verified (corpus)
R6. Hu J, Li X, Coleman K, Schroeder A, Ma N, Irwin DJ, Lee EB, Shinohara RT, Li M. SpaGCN: integrating gene expression, spatial location and histology to identify spatial domains and spatially variable genes by graph convolutional network. *Nature Methods* 2021. doi:10.1038/s41592-021-01255-8 — verified (corpus)
R7. Dong K, Zhang S. Deciphering spatial domains from spatially resolved transcriptomics with an adaptive graph attention auto-encoder. *Nature Communications* 2022;13. — partial (repo)
R8. Singhal V, Chou N, Lee J, et al. BANKSY unifies cell typing and tissue domain segmentation for scalable spatial omics data analysis. *Nature Genetics* 2024;56:431-441. doi:10.1038/s41588-024-01664-3 — partial (repo)
R9. Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 2019. doi:10.1038/s41598-019-41695-z — verified (corpus)
R10. Blondel VD, Guillaume JL, Lambiotte R, Lefebvre E. Fast unfolding of communities in large networks. *Journal of Statistical Mechanics: Theory and Experiment* 2008. doi:10.1088/1742-5468/2008/10/p10008 — verified (corpus)
R11. Palla G, Spitzer H, Klein M, Fischer D, Schaar AC, Kuemmerle LB, Rybakov S, Ibarra IL, Holmberg O, Virshup I, Lotfollahi M, Richter S, Theis FJ. Squidpy: a scalable framework for spatial omics analysis. *Nature Methods* 2022. doi:10.1038/s41592-021-01358-2 — verified (corpus)
R12. Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. *Genome Biology* 2018. doi:10.1186/s13059-017-1382-0 — verified (corpus)
R13. Lawrence Hubert, Phipps Arabie. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/jianhuupenn/SpaGCN | Jian Hu (setup.py); README lists Jian Hu, Xiangjie Li, Kyle Coleman, Amelia Schroeder, Nan Ma, David J. Irwin, Edward B. Lee, Russell T. Shinohara, Mingyao Li | MIT (LICENSE, copyright 2020 JianHu) | reference implementation of the adjacency, length-scale search, refinement and clustering layer | port with attribution |
| https://github.com/edward130603/BayesSpace | Edward Zhao (aut), Senbai Kang (aut, cre), Matt Stone (aut), Xing Ren (ctb), Raphael Gottardo (ctb) (DESCRIPTION) | MIT + file LICENSE (copyright Fred Hutchinson Cancer Research Center) | conditional update, defaults and model of the Potts-$t$ design | port of the update and defaults; callout comparator |
| https://github.com/scverse/squidpy | maintainers Selman Ozleyen, Tim Treis; authors "scverse" (pyproject.toml) | BSD-3-Clause (pyproject.toml; LICENSE) | spatial neighbour graph conventions | port of the conventions |
| https://github.com/scverse/scanpy | maintainers Ilan Gold, Philipp Angerer, Severin Dicks; author list in pyproject.toml | BSD-3-Clause (pyproject.toml; LICENSE) | neighbour and Leiden defaults; Leiden comparator | port of the defaults; callout comparator |
| https://github.com/vtraag/leidenalg | V.A. Traag (pyproject.toml) | GPL-3.0-or-later (pyproject.toml; LICENSE is GNU GPL version 3) | Leiden optimiser used by Scanpy | reimplement Leiden from [R9]; callout comparator |
| https://github.com/theislab/single-cell-best-practices | theislab | Apache-2.0 (LICENSE, copyright 2021 Theislab) | joint-graph Leiden recipe and SpaGCN tutorial settings (`domains.ipynb`) | reimplement the recipe |
| https://github.com/prabhakarlab/Banksy_py | Nigel Chou, Yifei Yue, Vipul Singhal; maintainer Vipul Singhal (pyproject.toml) | GPL-3.0 (pyproject.toml; LICENSE.md) | comparator at commit 9278996 | callout |
| https://github.com/QIFEIDKN/STAGATE | Kangning Dong (setup.py) | MIT (LICENSE, copyright 2021 Kangning Dong) | comparator at commit 48ce7f8 (TensorFlow implementation) | callout |
