---
id: spatial-domains.multi_slice_domains
title: Multi-slice joint domain identification
area: spatial-domains
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [spatial-preproc.spatial_unit_qc_filtering, feature-selection.batch_aware_selection_for_integration, dim-reduction.normalized_cell_embedding, dim-reduction.pc_number_selection]
feeds: [markers-de.cluster_marker_ranking, markers-de.replicate_aware_condition_de, spatial-domains.label_free_domain_quality]
reads: [layers/counts, obsm/spatial, obs/sample_id, obsm/X_pca]
writes: [obs/domain_joint, obsm/domain_joint_prob, obsm/joint_embedding, uns/domain_joint/params, models/multi_slice_domains]
devices: [cpu, cuda]
mcp_tool: singlet_spatial_domains_multi_slice_domains
evidence_basis: corpus+repo+memory
last_reviewed: 2026-10-17
---

# Multi-slice joint domain identification

> Assigns one domain label per unit in a label space shared by all slices of a study, after batch correction; the default is a joint Bayesian model (BASS), with pooled neighbourhood mixtures and batch-corrected neighbourhood clustering as comparators.

## 1. Question

Given $S$ slices, each with $n_s$ units (spots, cells or nuclei), expression $Y_s$ or its principal components, within-slice coordinates $X_s\in\mathbb{R}^{n_s\times 2}$ and a slice identifier, assign every unit a label $z_i\in\{1,\dots,K\}$ drawn from one label set shared by all slices, so that a label denotes the same tissue region wherever it occurs, after batch effects between slices are accounted for. The outputs are one categorical label per unit, optional posterior probabilities and an optional corrected embedding. A correct answer agrees with a reference of tissue regions in every slice, measured without relabelling any slice.

## 2. Why this task matters and where the field stands

Serial sections, technical replicates and donors are the usual units of a spatial study. A region label that means one thing in one slice and another in the next makes cross-slice comparisons (marker genes, region abundance, neighbourhood enrichment) invalid. Single-section labelling does not solve this, because its labels are arbitrary up to a permutation in each slice.

The status is **contested**. Multi-sample methods come in three families: a joint Bayesian model with batch-specific offsets (BASS [R1]), pooled neighbourhood features with a Gaussian mixture and stability-based K (CellCharter [R2]), and neighbourhood features with batch correction followed by one clustering (BANKSY with Harmony [R3][R4]). Batch-corrected graphs such as BBKNN [R5] and anchor-based learned embeddings such as STAligner [R7] are further alternatives. Open problems:

- *Label identity.* Per-slice agreement cannot detect whether labels mean the same region across slices; a pooled metric is needed (section 3).
- *Batch versus biology.* Correction can remove donor-level biology. The DLPFC design (three donors, four sections each) is too small to test this directly.
- *Shared K.* Slices of one donor can contain different numbers of domains, and one K for all slices is an assumption.
- *Coordinates.* Staggering or aligning coordinates changes neighbourhoods, and the choice interacts with the alignment problem [R8].
- *Uncertainty.* Only the joint Bayesian model returns posterior probabilities; whether they track boundary errors is not established.

The main limitation is the reference. Manual layer annotation of the DLPFC sections [R6] is the usual standard, but it is one subjective partition per section and says nothing about cross-slice identity beyond the layer name.

## 3. Theory and insight

All slices share one label set $z_i\in\{1,\dots,K\}$. Let $s(i)$ be the slice of unit $i$, $\mathcal N(i)$ its neighbours within $s(i)$, and $E$ the union of within-slice neighbour pairs; cross-slice edges appear only if added deliberately.

**Estimands.** Every output is defined per unit. The label $\hat z_i$ is the argmax of the posterior marginal $\hat q_{ik}$, or the cluster assignment for heuristic methods. $\hat q_{ik}$ is the model probability that unit $i$ has label $k$; it is non-negative and sums to one over $k$. The corrected embedding is a real matrix with no normalisation. Each reference label $z^\ast_i$ is one class per unit, and scores use only units that carry one.

**Joint model class.** The model-based formulation of section 5 is
$$y_i=\mu_{z_i}+b_{s(i)}+\varepsilon_i,\qquad \varepsilon_i\sim\mathcal N(0,\Sigma),\qquad b_s\sim\mathcal N(0,\tau^2 I_D),$$
$$P(\mathbf z\mid\beta)\;\propto\;\exp\Big(\beta\sum_{(i,j)\in E}\mathbf 1[z_i=z_j]\Big).$$
*Regime.* The Gaussian emission is a fair description of log-normalised principal components of moderate depth. $\mu_k$, $\Sigma$ and the prior are shared across slices, so one label set holds by construction. The centred prior on $b_s$ fixes the shift between $\mu_k$ and $b_s$. The model assumes every slice contains all $K$ domains; a slice that lacks one has its composition effect absorbed into $b_s$. The Potts normaliser is intractable, so mean field or MCMC gives approximate marginals.

**Neighbourhood features.** BANKSY concatenates own and neighbourhood expression,
$$\tilde x_i=\big[\sqrt{1-\lambda}\,x_i\;\big\|\;\sqrt{\lambda}\,\bar x_i\big],\qquad \bar x_i=\sum_{j\in\mathcal N(i)}w_{ij}\,x_j,$$
and clusters the principal components. *Regime.* $\lambda\in[0,1]$ trades own expression against the neighbourhood average. This is a feature construction with no likelihood, so its labels carry no probability. CellCharter stacks layer means and fits a mixture,
$$x_i=\big[a^{(1)}_i\,\|\cdots\|\,a^{(L)}_i\big],\qquad p(x_i)=\sum_{k=1}^{K}\pi_k\,\mathcal N(x_i\mid\mu_k,\Sigma_k),$$
where $a^{(l)}_i$ is the mean of the features over the layer-$l$ neighbourhood of $i$ within its slice. *Regime.* The components are Gaussian in stacked means, and $K$ is chosen by seed stability rather than by likelihood.

**Batch-corrected graphs and anchors.** Harmony clusters cells in principal-component space with a diversity penalty and then applies a per-cluster ridge correction. BBKNN takes the union of per-batch neighbourhoods, $\mathcal N(i)=\bigcup_b \mathrm{kNN}_b(i,k_b)$, and uses no coordinates. STAligner trains on triplets $(a,p,n)$ whose anchor $a$ and positive $p$ are mutual nearest neighbours across slices,
$$\mathcal L_{\rm tri}=\sum_{(a,p,n)}\max\big(0,\;d(z_a,z_p)-d(z_a,z_n)+m\big).$$
*Regime.* Anchor errors enter the loss directly.

**Why per-slice agreement cannot see label identity.** For one slice and any permutation $\pi$ of label names, $\mathrm{ARI}(z^\ast_s,\pi\circ z_s)=\mathrm{ARI}(z^\ast_s,z_s)$. Per-slice ARI therefore gives the same value whether the labels are shared or permuted differently in each slice. Pooled ARI, computed over all units with labels as given, is invariant to one global permutation but generally not to permutations $\pi_s$ that differ between slices, so it detects inconsistency. A single objective (one model, one clustering of pooled features, or one aligned embedding) gives shared labels. Independent fits followed by matching give them only when the matching is right, and matching is ill-posed when slices differ in domain composition.

**Measures.** ARI is the chance-corrected pair-counting agreement of two partitions [R12]; it is symmetric, invariant to label names, and has expectation zero for independent partitions with fixed margins. The section-mixing score is
$$M=\sum_d\frac{n_d}{N}\,\min\!\Big(1,\frac{H(p_d)}{H(q)}\Big),\qquad H(p)=-\sum_s p_s\log p_s,$$
where $n_d$ counts labelled units with domain $d$, $N=\sum_d n_d$, $p_{ds}=n_{ds}/n_d$ is the share of domain $d$ in slice $s$, and $q_s=n_s/N$ is the share of slice $s$. $M=1$ when every domain is spread in proportion to slice size. It falls as domains concentrate in single slices, which is batch leakage. It is a guardrail, not a consistency measure, and it plays the batch-removal role that scIB scores apart from biological conservation [R11]. It needs $H(q)>0$, that is, at least two slices of non-trivial size.

**Calibration.** Posterior probabilities are calibrated only if the model holds: Gaussian emissions, shared $K$ and the chosen coupling. CellCharter's mixture treats each unit's stacked feature vector as an independent draw, although neighbouring units share neighbours, so its posteriors are not calibrated at boundaries.

**Pitfalls shown by benchmark studies.** Spatial smoothing (neighbourhood size, $\lambda$, the Potts coupling, the number of layers) can raise ARI by blurring thin layers. Setting $K$ or resolution from manual class counts inflates scores. Batch correction can remove donor biology. Anchor errors propagate into learned embeddings, and staggered coordinates create false edges across slice boundaries unless edges are restricted to one slice.

## 4. Methods landscape

The multi-sample methods are the references for this task. BASS [R1], CellCharter [R2] and the multi-sample BANKSY workflows [R3] fit all slices with one label space. The baseline they are judged against is independent single-section labelling followed by matching. Harmony [R4], BBKNN [R5] and STAligner [R7] correct batch effects before clustering or anchor slices, and PASTE [R8] computes a spot-to-spot transport plan between slices. Rows marked callout are benchmark comparators only. The BayesSpace and SpaGCN comparators use the commits recorded in `spatial-domains/single_slice_domains.md` (BayesSpace at ba8b422, SpaGCN at dc7a1c2).

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| BASS | model-based | hierarchical Bayesian model over all sections; cell-type labels clustered jointly; domains from a Potts-type smoothed label field; MCMC | [R1] |
| CellCharter | hybrid | mean-aggregated multi-layer neighbourhood features pooled over samples; Gaussian mixture; K chosen by seed stability | [R2] |
| BANKSY, sections concatenated (banksy_concat) | heuristic | neighbourhood-augmented features computed per section and concatenated; PCA and Leiden | [R3] |
| BANKSY with Harmony (banksy_harmony) | heuristic | BANKSY features; Harmony over the sample key on PCs; Leiden | [R3][R4] |
| Harmony | hybrid | iterative soft clustering in PCA space with a diversity penalty, then per-cluster ridge correction | [R4] |
| BBKNN (callout) | heuristic | union of per-batch kNN graphs; no coordinates | [R5] |
| STAligner (callout) | model-based | graph attention autoencoder (GATConv) on the concatenated slices; mutual-nearest-neighbour triplets across slices; ICP on landmark domains | [R7] |
| PASTE (callout) | model-based | fused Gromov-Wasserstein optimal transport between slices; yields a spot-to-spot transport plan | [R8] |
| BayesSpace (callout) | model-based | single-section Student-t emission with a Potts-type prior, sampled by MCMC | [R9] |
| SpaGCN (callout) | hybrid | graph convolution with a soft-assignment clustering layer; single-section comparator | [R10] |

The defaults below are those used by the reference code at the recorded commits. Options that singlet exposes are set to these values unless the tool table says otherwise.

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| BASS createBASSObject | C; R | required; no default | `R/BASS.R:169` @ 5c2690f |
| BASS createBASSObject | init_method; k | `kmeans`; 4 | `R/BASS.R:169-185` @ 5c2690f |
| BASS createBASSObject | burnin; nsample | 2000; 5000 | `R/BASS.R:169-185` @ 5c2690f |
| BASS createBASSObject | potts_burnin; potts_nsample | 10; 10 | `R/BASS.R:169-185` @ 5c2690f |
| BASS createBASSObject | beta_method; beta; step_size; tol | `SW`; 1; 0.1; 1e-3 | `R/BASS.R:169-185` @ 5c2690f |
| BASS createBASSObject | psi0; n0; alpha0 | 1; 1; 1 | `R/BASS.R:169-185` @ 5c2690f |
| BASS BASS.preprocess | nHVG; nSE; nPC | 2000; 3000; 20 | `R/BASS.R:350-360` @ 5c2690f |
| BASS BASS.preprocess | geneSelect; doBatchCorrect | `sparkx`; TRUE | `R/BASS.R:350-360` @ 5c2690f |
| CellCharter aggregate_neighbors | n_layers; aggregations | required; `mean` | `src/cellcharter/gr/_aggr.py:105-108` @ d6dd529 |
| CellCharter aggregate_neighbors | sample_key | None, then the sample key in obs | `src/cellcharter/gr/_aggr.py:111, 145` @ d6dd529 |
| CellCharter GaussianMixture | n_clusters; random_state | 1 (constructor); 0 | `src/cellcharter/tl/_gmm.py:78, 87` @ d6dd529 |
| Harmony | theta | documented 2; signature NULL, resolved internally | `R/ui.R:17, 95` @ 7e21bd6 |
| Harmony | sigma | 0.1 | `R/ui.R:96` @ 7e21bd6 |
| Harmony | lambda | documented 1; signature NULL (automatic estimation) | `R/ui.R:25, 97, 223` @ 7e21bd6 |
| BANKSY Harmony script | k_geom; lambda; pca_dims; resolution | 18; 0.2; 20; 0.40 | `DLPFC_harmony_multisample.py:247, 253-255` @ 9278996 |
| BANKSY Harmony script | batch_key; azimuthal order m | `sample`; 1 (comment only) | `DLPFC_harmony_multisample.py:318; 230` @ 9278996 |
| BANKSY concatenation script | k_geom; lambda; pca_dims; resolution | 6; 0.2; 20; 0.60 (code at line 213) | `DLPFC_concatenate_multisample.py:207-215` @ 9278996 |
| STAligner train_STAligner | hidden_dims; n_epochs; lr | [512, 30]; 1000; 0.001 | `STAligner/train_STAligner.py:105-108` @ 85ca4ce |
| STAligner train_STAligner | margin; knn_neigh; random_seed | 1.0; 100; 666 | `STAligner/train_STAligner.py:105-108` @ 85ca4ce |
| STAligner create_dictionary_mnn | k | 50 | `STAligner/mnn_utils.py:11` @ 85ca4ce |
| PASTE pairwise_align | alpha; dissimilarity; norm; numItermax | 0.1; `kl`; False; 200 | `src/paste/PASTE.py:8-24` @ 5f0d58c |
| BBKNN bbknn | neighbors_within_batch; n_pcs; use_rep | 3; 50; `X_pca` | `bbknn/__init__.py:31, 38, 16` @ 95ce34b |

## 5. Proposed singlet approach

**Routes** (licences and authors in section 12). BASS, BANKSY and Harmony are reimplemented; the BASS likelihood is read from the reference code before implementation. CellCharter is ported for its neighbourhood aggregation and mixture interface, with the mixture EM written as a CUDA kernel instead of the torchgmm dependency. BBKNN, STAligner, PASTE, BayesSpace and SpaGCN are callouts for benchmarking only.

**Model-based proposal.** The joint model of section 3, with the Potts prior on within-slice edges and mean-field variational EM over all slices at once, is planned as `potts_joint`. It is not in the tool enum until the criteria below are met. It would write the same members as `bass`. It is falsified if, on B1 at fixed $K$, its pooled ARI is below both `bass` and `banksy_concat`, or if, on B2, its probabilities have ECE above 0.05 or its pooled ARI at the matched batch shift is more than 0.05 below the no-shift case. As for the other methods, $K$ is supplied by the caller; choosing it is the domain-number task.

**Defaults an agent uses without asking.** `method` = `bass`, `batch_key` = `sample_id`, `n_pcs` = 20, `seed` = 0, and the BASS MCMC settings at their defaults. The agent must ask for `n_domains`, for `bass.n_cell_types` when `bass` is chosen, and for `cellcharter.n_layers` when CellCharter is chosen.

**Coordinates and neighbourhoods.** Neighbour graphs are built per slice. The concatenated BANKSY variant offsets x-coordinates by slice for the neighbour search only, and every edge is restricted to one slice, so staggering cannot create cross-slice neighbours. The reference Harmony script staggers coordinates by sample index (`DLPFC_harmony_multisample.py:152-195`); the reference concatenation script does not.

**Choosing the spatial scale.** For the BANKSY variants, the Leiden resolution is calibrated by bisection so that the clustering yields `n_domains` clusters, and the achieved count is reported. For CellCharter, `n_domains` is the mixture size, and K selection by stability is the job of the domain-number task.

**ML stack and kernels.** The enum contains no deep network, so PyTorch is not a dependency. Hard-coded kernels cover the small hot operations: sparse neighbour aggregation (cuSPARSE, with a CPU sparse path), mixture EM and Harmony's cluster and correction steps (cuBLAS), and the Potts sweeps of `bass` (CUDA). Leiden executes on CPU. Each slice is held in memory, and streaming across slices is not claimed. All seeds and the achieved resolution are recorded in `uns/domain_joint/params`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse int | raw counts; input to BASS preprocessing, and PCA is computed from it when `obsm/X_pca` is absent |
| read | `obsm/spatial` | float, $n\times 2$ | within-slice coordinates; never compared across slices |
| read | `obs/sample_id` | categorical | slice identifier, the batch key by default |
| read | `obsm/X_pca` | float, $n\times D$ | principal components, used when present |
| write | `obs/domain_joint` | categorical int | shared domain label |
| write | `obsm/domain_joint_prob` | float, $n\times K$ | posterior probabilities; `bass` and `cellcharter` only |
| write | `obsm/joint_embedding` | float, $n\times D$ | batch-corrected principal components; BANKSY methods only |
| write | `uns/domain_joint/params` | object | effective parameters, seed, achieved resolution, versions and the section-mixing score |
| write | `models/multi_slice_domains` | object | fitted model state; `bass` only |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle holding all slices. |
| `method` | string | "bass" | `bass`, `cellcharter`, `banksy_concat`, `banksy_harmony` | bass: joint Bayesian model (default). cellcharter: pooled Gaussian mixture. banksy_concat: neighbourhood features computed per section, then concatenated. banksy_harmony: Harmony over slices. |
| `n_domains` | integer/null | required | min 2 | Shared number of domains K across all slices. Required. Choose it with the domain-number task, not from annotation. |
| `batch_key` | string | "sample_id" | — | obs column identifying the slice; set the donor column as well when donors differ. |
| `n_pcs` | integer | 20 | min 1; max 200 | Principal components used by all methods; capped by the components available in obsm/X_pca. |
| `bass` | object | {} | — | Options for method bass. |
| `bass.n_cell_types` | integer/null | null | min 1 | Number of jointly clustered cell-type groups C. Required when method is bass. |
| `bass.burnin` | integer | 2000 | min 0 | MCMC burn-in iterations discarded before summarising. |
| `bass.nsample` | integer | 5000 | min 1 | Posterior samples retained after burn-in. |
| `cellcharter` | object | {} | — | Options for method cellcharter. |
| `cellcharter.n_layers` | integer/null | null | min 1 | Number of neighbourhood layers aggregated. Required when method is cellcharter. |
| `cellcharter.aggregations` | string/array | "mean" | — | Aggregation applied to each neighbourhood layer. |
| `banksy` | object | {} | — | Options for methods banksy_concat and banksy_harmony. |
| `banksy.lambda_spatial` | number | 0.2 | min 0; max 1 | Weight of the spatial neighbour average against own expression. |
| `banksy.k_geom` | integer | 18 | min 1 | Spatial neighbours per unit, within its slice. The reference Harmony script uses 18 and the reference concatenation script uses 6. |
| `banksy.harmony_theta` | number | 2 | min 0 | Diversity penalty for slice mixing in Harmony; used by banksy_harmony only. |
| `banksy.harmony_sigma` | number | 0.1 | > 0 | Cluster width in Harmony; used by banksy_harmony only. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when the method has a CUDA path and enough memory is free. |
| `seed` | integer | 0 | min 0 | Seed for initialisation, MCMC, mixture fitting and Harmony clustering. Record it. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing labels. |
| `overwrite` | boolean | false | — | Replace existing domain_joint members instead of failing. |
<!-- PARAMS:AUTO:END -->

The table is generated from the MCP definition. Options apply only when their method is selected: `bass.*` to `bass`, `cellcharter.*` to `cellcharter`, `banksy.*` to both BANKSY methods, and `banksy.harmony_*` only to `banksy_harmony`. `bass.n_cell_types` and `cellcharter.n_layers` must be set for their methods. Options of unselected methods are ignored and echoed in `uns/domain_joint/params`. Labels from calls with different `n_domains` or `batch_key` are different label spaces and are not comparable.

## 7. MCP tool

Tool name `singlet_spatial_domains_multi_slice_domains` (definition in `tasks/mcp/singlet_spatial_domains_multi_slice_domains.json`). Example call, then a compact result (values are illustrative and are not measurements):

```json
{"dataset": "/data/dlpfc_12.singlet", "method": "banksy_harmony", "n_domains": 8, "seed": 0}
```

```json
{
  "dataset": "/data/dlpfc_12.singlet",
  "status": "completed",
  "wrote": ["obs/domain_joint", "obsm/joint_embedding", "uns/domain_joint/params"],
  "summary": {"method": "banksy_harmony", "n_domains": 8, "n_sections": 12, "section_mixing": 0.7},
  "provenance_id": "prov_0002", "job_id": null, "estimate": null
}
```

- **Long-running**: `bass` with the default MCMC settings, and any call above an implementation-set size, may return `queued` with a `job_id`.
- **Stochastic**: `seed` fixes initialisation, MCMC, mixture fitting and Harmony clustering; the same seed, inputs and device class give the same labels.
- **Dry run**: `estimate` gives `seconds`, `peak_memory_gb` and `device`, and for `bass` the MCMC iteration count.

## 8. Benchmarks

**Shared protocol.** Every method receives the same units, the same 2000 highly variable genes chosen without labels on all slices jointly, the same principal components, batch key and seeds 0 to 4. Per-section scores are averaged over seeds before comparison. The primary arm fixes $K=8$ for every method and slice; the value is set before any fit and is not taken from annotation, and $K=4$ and $K=12$ are sensitivity arms. Units without a reference label are dropped before scoring, and their counts are reported per slice. No hyperparameter is tuned on reference labels. Intervals are 95% percentile bootstrap intervals over sections (B1) or over replicates (B2). Comparators use the defaults of section 4.

### B1. DLPFC Visium, 12 sections, one shared label space

- **Goal**: test whether one label space across 12 sections recovers the annotated cortical layers and white matter better than independent single-section labels matched afterwards.
- **Ground truth**: expert labels. Each barcode carries the layer or white-matter annotation of the Maynard et al. layer map [R6], matched to `obs` by barcode. The labels are categorical and are not normalised, since ARI is invariant to their names. Barcodes without an entry, or labelled as other, are dropped.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| DLPFC Visium, 12 sections, 3 donors | [R6]; sample IDs 151507-151510, 151669-151672 and 151673-151676 (paste_reproducibility DLPFC README); preprocessed datasets of the PASTE paper on Zenodo, 10.5281/zenodo.6334774 (PASTE README) | Visium, human prefrontal cortex; four sections per donor | — | report donors separately; per-section spot counts in section 10 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-section ARI | ARI of shared labels against the layer labels on annotated units of each section, averaged over the 12 sections | higher | primary | [R12] |
| Pooled ARI | ARI over annotated units of all sections with shared labels; detects section-specific relabelling (section 3) | higher | primary | [R12] |
| Section mixing M | section 3 definition over all labelled units | higher | guardrail | — |

- **Comparators**: joint methods `bass`, `cellcharter`, `banksy_concat`, `banksy_harmony` and the callout STAligner; independent single-section BANKSY, BayesSpace and SpaGCN, with labels matched across sections by Hungarian assignment of cluster-mean principal components to section 1; the non-spatial callout BBKNN with Leiden.
- **Protocol**: primary arm $K=8$, sensitivity arms $K=4$ and $K=12$ (shared protocol). Donor means are reported with the section means.
- **Acceptance criterion** (proposed): each joint method's mean per-section ARI exceeds that of the matched independent BANKSY labels by at least 0.02, with a paired Wilcoxon test over the 12 sections at $p<0.05$, and its $M$ is at least 0.5.
- **Known pitfalls**: the reference Harmony script sets target cluster counts from the annotation (7, 5 and 7 classes on three sections, `DLPFC_harmony_multisample.py:70`) and the concatenation script sets 7 for each of four sections (`DLPFC_concatenate_multisample.py:62`); both choose the Leiden resolution against those targets, which inflates ARI. The repository gene list is a union of four sections per donor, which this protocol replaces with a joint label-free selection.

### B2. Planted-domain simulation with batch shifts (proposed)

- **Goal**: test recovery of shared domains when slices differ by gene-wise batch factors, dropout and rigid geometric shifts, with exact truth.
- **Ground truth**: planted simulation. The label $z^\ast_i$ is the region of unit $i$ before steps 4 to 6; it is exact by construction and is not normalised.
- **Generator recipe**:
  1. *Geometry*: $S=4$ slices of $L\times L$ units on a hexagonal lattice, $L=60$. Each slice receives a rigid rotation within $\pm5^\circ$ and a shift within $\pm2$ lattice spacings, drawn uniformly.
  2. *Regions*: a smooth Gaussian random field on a shared tissue frame is cut into $K=6$ depth-ordered bands by fixed thresholds. Each slice evaluates the field at its transformed coordinates, so one tissue region appears in every slice under one label.
  3. *Profiles*: $G=1000$ genes; base means $b_g$ are the per-gene means of the DLPFC counts; region $k$ has a marker mask $m_{kg}\in\{0,1\}$ with $\Pr(m_{kg}=1)=0.05$; $\mu_{kg}=b_g e^{\delta m_{kg}}$ with $\delta\in\{0.5,1.0\}$.
  4. *Batch*: size factors $s_i\sim\mathrm{LogNormal}(0,0.3^2)$ and slice-by-gene factors $f_{sg}\sim\mathrm{LogNormal}(0,\sigma_b^2)$ with $\sigma_b\in\{0,0.25,0.5\}$.
  5. *Counts*: $x_{ig}\sim\mathrm{NB}(s_i f_{s(i)g}\mu_{z_ig},\phi)$ with $\phi=0.1$ in mean-dispersion form.
  6. *Dropout*: each count is set to zero with probability $p_d\in\{0,0.2\}$, drawn per slice.
  7. *Grid*: $3\times2\times2=12$ cells with 5 seeds each, 60 datasets.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated four-slice data, recipe steps 1 to 7 | generated; seeds recorded | simulated counts; 3,600 units per slice; 1000 genes | — | not a model of real tissue |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pooled ARI | ARI of all units against $z^\ast$ with shared labels, $K=6$ | higher | primary | [R12] |
| ECE | ten equal-width bins of $\hat p_i=\max_k\hat q_{ik}$; $\sum_m (\lvert B_m\rvert/n)\,\lvert\mathrm{acc}(B_m)-\mathrm{conf}(B_m)\rvert$; accuracy after Hungarian matching of labels to planted classes | lower | primary, probability methods | — |
| Section mixing M | section 3 definition on planted slices | higher | guardrail | — |

- **Comparators**: the four tool methods; BBKNN with Leiden; concatenated principal components with Leiden and no batch term.
- **Protocol**: $K=6$ (the planted count) replaces the shared $K=8$ arm, since truth is known. The full grid of recipe step 7 is fitted with 5 seeds.
- **Acceptance criterion** (proposed): at the grid value of $\sigma_b$ nearest to the DLPFC batch estimate (the median over genes of the standard deviation of log section means across the 12 sections), each joint method's pooled ARI stays within 0.05 of its value at $\sigma_b=0$ and $p_d=0$, and `bass` keeps ECE at or below 0.05.
- **Known pitfalls**: at $\delta=1.0$ the domains separate widely and most methods succeed, so $\delta=0.5$ is the discriminating setting; simulated boundaries are not tissue boundaries, so B2 supports calibration and robustness claims only.

### P1. Performance and scaling

Wall time, peak CPU memory and peak GPU memory for the four tool methods at total spot counts $10^4$, $10^5$ and $10^6$ split over four slices, from the B2 generator with a hexagonal layout. Hold 2000 genes, 20 principal components and the slice count fixed. Report CPU and CUDA separately, exclude warm-up and file input, and report host-to-device transfer separately. `bass` is reported at its default MCMC settings and at a reduced setting stated in the table. BBKNN with Leiden on CPU is the reference. Acceptance (proposed): the fitted log-log slope of wall time against total spots is at most 1.3 for `banksy_concat` and `banksy_harmony`; `bass` and `cellcharter` are reported without a threshold.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `spatial-preproc.spatial_unit_qc_filtering`: Quality filtering of spatial units (spots, bins, cells)
  - `feature-selection.batch_aware_selection_for_integration`: Batch-aware and lineage-aware feature selection for integration
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `dim-reduction.pc_number_selection`: Number of principal components to retain
- **Feeds**:
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
  - `spatial-domains.label_free_domain_quality`: Label-free spatial domain quality assessment
- **Reads**: `layers/counts`, `obsm/spatial`, `obs/sample_id`, `obsm/X_pca`
- **Writes**: `obs/domain_joint`, `obsm/domain_joint_prob`, `obsm/joint_embedding`, `uns/domain_joint/params`, `models/multi_slice_domains`
<!-- CHAINING:AUTO:END -->

This task is the multi-section branch of the spatial domain workflow. A study with one section uses the single-section branch, `spatial-domains.single_slice_domains`, instead.

## 10. Risks, pitfalls and open questions

- *Evidence not independently confirmed.* The DLPFC layer map, per-section spot counts and the contents of the Zenodo record are unread; the Zenodo DOI is cited from the PASTE README. The BASS likelihood and the meaning of its parameter k are unread, so BASS is described at the level of its model structure.
- *Citation details.* BASS, BANKSY, Maynard et al., STAligner and PASTE are cited from repository files, not from journal pages; Maynard et al. has no DOI in its source. GraphST is omitted because no code repository was read. Two 2024 to 2025 benchmark studies of spatial clustering are known from titles and summaries only, and no figures from them are used.
- *Configuration conflicts.* Harmony's documented lambda (1) conflicts with its NULL signature default, which means automatic estimation. The concatenation script's comment gives resolution 1.0 while its code uses 0.60. The BANKSY version is 1.3.5 in `pyproject.toml` and v1.3.4 in the README. The Harmony script runs three sections and the concatenation script runs one donor's four sections, and k_geom is 18 in the first and 6 in the second. Singlet records the values it uses in `uns/domain_joint/params`.
- *Unsettled literature.* Whether batch correction removes donor biology; shared versus per-slice $K$; coordinate frames, since staggering and alignment both change neighbourhoods; whether BASS posterior uncertainty tracks boundary errors; and the growth of joint MCMC cost with the number of slices.
- *Data risk.* The DLPFC counts are not redistributed; the B2 generator keeps only their per-gene means.
- *Thresholds and first experiment.* The 0.02 ARI margin, the 0.5 mixing threshold, the 0.05 batch margin, the 1.3 slope and the 0.05 ECE limit are proposals. First experiment: build the B2 generator and check that pooled ARI separates consistent from section-permuted labels at $\sigma_b=0$, before any B1 scoring.

## 11. References

R1. Li Z, Zhou X. BASS: multi-scale and multi-sample analysis enables accurate cell type clustering and spatial domain detection in spatial transcriptomic studies. *Genome Biology* 2022;23:168. doi:10.1186/s13059-022-02734-7 — verified (repo)
R2. Varrone M, Tavernari D, Santamaría-Martínez A, Walsh LA, Ciriello G. CellCharter reveals spatial cell niches associated with tissue remodeling and cell plasticity. *Nature Genetics* 2024. doi:10.1038/s41588-023-01588-4 — verified (corpus)
R3. Singhal V, Chou N, Lee J, Yue Y, Liu J, Chock WK, Lin L, Chang YC, Teo E, Lee HK, Chen KH, Prabhakar S. BANKSY unifies cell typing and tissue domain segmentation for scalable spatial omics data analysis. *Nature Genetics* 2024;56:431–441. doi:10.1038/s41588-024-01664-3 — verified (repo)
R4. Korsunsky I, Millard N, Fan J, Slowikowski K, Zhang F, Wei K, Baglaenko Y, Brenner M, Loh PR, Raychaudhuri S. Fast, sensitive and accurate integration of single-cell data with Harmony. *Nature Methods* 2019. doi:10.1038/s41592-019-0619-0 — verified (corpus)
R5. Polański K, Young MD, Miao Z, Meyer KB, Teichmann SA, Park JE. BBKNN: fast batch alignment of single cell transcriptomes. *Bioinformatics* 2019. doi:10.1093/bioinformatics/btz625 — verified (corpus)
R6. Maynard KR, et al. Transcriptome-scale spatial gene expression in the human dorsolateral prefrontal cortex. *Nature Neuroscience* 2021;24(3):425–436. — verified (repo)
R7. Zhou X, Dong K, Zhang S. Integrating spatial transcriptomics data across different conditions, technologies and developmental stages. *Nature Computational Science* 2023;3:894–906. doi:10.1038/s43588-023-00528-w — verified (repo)
R8. Zeira R, Land M, Strzalkowski A, Raphael BJ. Alignment and integration of spatial transcriptomics data. *Nature Methods* 2022. doi:10.1038/s41592-022-01459-6 — verified (repo)
R9. Zhao E, Stone MR, Ren X, et al. Spatial transcriptomics at subspot resolution with BayesSpace. *Nature Biotechnology* 2021. — verified (corpus)
R10. Hu J, Li X, Coleman K, Schroeder A, Ma N, Irwin DJ, Lee EB, Shinohara RT, Li M. SpaGCN: integrating gene expression, spatial location and histology to identify spatial domains and spatially variable genes by graph convolutional network. *Nature Methods* 2021. doi:10.1038/s41592-021-01255-8 — verified (corpus)
R11. Luecken MD, Büttner M, Chaichoompu K, Danese A, Interlandi M, Mueller MF, Strobl DC, Zappia L, Dugas M, Colomé-Tatché M, Theis FJ. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2021. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R12. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/zhengli09/BASS | Zheng Li (aut, cre) and Xiang Zhou (aut), per DESCRIPTION | GPL (>= 3) (DESCRIPTION); LICENSE.md is the GPL-3.0 text | reference model for `bass`; defaults in section 4 | reimplement |
| https://github.com/CSOgroup/cellcharter | CSO group; Marco Varrone (pyproject.toml) | BSD-3-Clause (LICENSE, copyright 2022 Marco Varrone) | neighbourhood aggregation, mixture interface and stability-based K | port |
| https://github.com/prabhakarlab/Banksy_py | Nigel Chou, Yifei Yue, Vipul Singhal (pyproject.toml; maintainer Vipul Singhal) | GPL-3.0 (LICENSE.md and pyproject.toml) | BANKSY features and multi-sample scripts | reimplement |
| https://github.com/immunogenomics/harmony | Nikolaos Patikas, Hongcheng Yao, Ilya Korsunsky et al. (DESCRIPTION, version 2.1.0) | GPL-3 (DESCRIPTION); no LICENSE file at the repository root | clustering and correction inside `banksy_harmony` | reimplement |
| https://github.com/Teichlab/bbknn | Krzysztof Polanski, Jongeun Park (pyproject.toml) | MIT (LICENSE; copyright line reads "The Python Packaging Authority") | non-spatial baseline | callout |
| https://github.com/zhoux85/STAligner | Xiang Zhou (copyright holder in LICENSE) | MIT (LICENSE, copyright 2022 Xiang Zhou) | comparator; defaults in section 4 | callout |
| https://github.com/raphael-group/paste | Max Land (setup.cfg); Princeton University (copyright) | BSD-3-Clause (LICENSE, copyright 2020 Princeton University) | alignment comparator; defaults in section 4 | callout |
| https://github.com/edward130603/BayesSpace | Edward Zhao (aut), Senbai Kang (aut, cre) (DESCRIPTION) | MIT + file LICENSE (DESCRIPTION); LICENSE copyright Fred Hutchinson Cancer Research Center, 2020 | single-section comparator; commit in `spatial-domains/single_slice_domains.md` | callout |
| https://github.com/jianhuupenn/SpaGCN | JianHu (LICENSE copyright line) | MIT (LICENSE, copyright 2020 JianHu) | single-section comparator; commit in `spatial-domains/single_slice_domains.md` | callout |
