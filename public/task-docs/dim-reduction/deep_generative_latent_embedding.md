---
id: dim-reduction.deep_generative_latent_embedding
title: Deep generative latent embedding of cells from counts
area: dim-reduction
scope: extended
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [qc.low_quality_cell_detection, feature-selection.highly_variable_gene_selection]
feeds: [clustering.cell_partitioning, neighbors.approximate_knn_search, integration.integration_quality_scoring, embedding-viz.local_neighborhood_preservation]
reads: [layers/counts, var/highly_variable, obs/<batch_key>, obs/<labels_key>]
writes: [obsm/X_deep_latent, obsm/X_deep_latent_var, models/deep_generative_latent, uns/deep_generative_latent]
devices: [cpu, cuda]
mcp_tool: singlet_dim_reduction_deep_generative_latent_embedding
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Deep generative latent embedding of cells from counts

> Learn a $d$-dimensional cell embedding from raw UMI counts with an amortised count model (a scVI-type VAE, a linear-decoder, label-aware or count-autoencoder variant) and test it against PCA at matched dimension.

## 1. Question

Does a nonlinear count model (a variational autoencoder with a negative-binomial or zero-inflated decoder, or a deep count autoencoder) fitted to raw UMI counts give a $d$-dimensional cell embedding that preserves cell identity better than PCA on log-normalised highly variable genes, at matched $d$ and matched preprocessing? The input is a raw count matrix with library sizes and optional batch or label covariates. The output is an $n\times d$ latent matrix and, for variational models, posterior variances. A correct answer is a matched-dimension benchmark result, not a claim from default settings.

## 2. Why this task matters and where the field stands

Cell embedding is routine. PCA on log-normalised highly variable genes is the published standard. Raimundo et al. report that default settings are a good choice on most datasets [R9]. The status is **contested**, because count models offer what PCA on transformed counts cannot: a likelihood matched to UMI noise, covariates inside the generative model, and a posterior uncertainty for each cell [R1, R5]. Whether these give better cell identity is unresolved. Raimundo et al. report that DCA and scVI gain most from parameter tuning and can outperform the other methods once tuned, while Seurat and scran gain little from tuning [R9]. In the scIB integration benchmark, as summarised in the best-practices integration chapter, scANVI (with labels), scVI and scGen (with labels) are among the best performers, particularly on complex tasks [R8]. That evidence concerns integration rather than identity within one dataset.

Open problems:

- No accepted default. The advantage over PCA depends on tuning, on labels or on multi-batch structure [R8, R9].
- Droplet data are sparse, and whether many zeros are dropouts or biological zeros is disputed, so the negative-binomial and zero-inflated decoders lack consensus [R11].
- No validated, label-free rule exists for choosing the latent dimension of a count model.
- Posterior uncertainty of amortised encoders has not been benchmarked against planted truth for cell embeddings.

## 3. Theory and insight

Cell $n$ has latent state $z_n\in\mathbb R^d$ and covariates $s_n$ (study or batch). The library size $\ell_n=\sum_g x_{ng}$ enters as an offset. Counts $x_{ng}$ are conditionally independent across genes given $(z_n,s_n)$.

| Symbol | Meaning |
|---|---|
| $x_{ng}$ | raw UMI count of gene $g$ in cell $n$ |
| $\ell_n$ | library size, the row sum over all genes |
| $z_n$ | latent cell state, $d$ dimensions |
| $\rho_{ng}$ | decoder rate, with $\sum_g\rho_{ng}=1$ |
| $\theta_g$, $\pi_{ng}$ | gene inverse dispersion; zero-inflation probability (ZINB only) |
| $q_\phi(z\mid x,s)$ | amortised Gaussian encoder with mean $\mu_\phi$ and diagonal variance |

The evidence lower bound for one cell, with an amortised encoder and a standard normal prior, is

$$\log p_\theta(x_n\mid s_n)\ \ge\ \mathbb E_{q_\phi(z_n\mid x_n,s_n)}\big[\log p_\theta(x_n\mid z_n,s_n)\big]-\mathrm{KL}\big(q_\phi(z_n\mid x_n,s_n)\,\|\,\mathcal N(0,I_d)\big).$$

The gap to the marginal likelihood is the KL divergence between the amortised and the exact posterior, so the bound is tight only for flexible encoders. The KL term is usually weighted by a factor that starts near zero and rises to one (warm-up). This delays posterior collapse, in which the latent carries no information. The bound is the objective of the variational autoencoder [R12], and gradients through the sampled latent use the reparameterisation trick [R13].

The count head is a negative binomial with a library-size offset:

$$x_{ng}\sim\mathrm{NB}(\mu_{ng},\theta_g),\qquad \mu_{ng}=\ell_n\,\rho_{ng}(z_n,s_n),\qquad \mathrm{Var}(x_{ng})=\mu_{ng}+\mu_{ng}^2/\theta_g,$$

where $\rho_n$ is a softmax over genes. The zero-inflated head adds a point mass, $p(x_{ng})=\pi_{ng}\,\delta_0(x_{ng})+(1-\pi_{ng})\,\mathrm{NB}(x_{ng}\mid\mu_{ng},\theta_g)$. For low-expressed genes $\pi$ and $\theta$ trade off, so ZINB is weakly identified there. A linear decoder, $\log\rho_{ng}=W_{g\cdot}^\top z_n+b_g$ up to normalisation, with a linear encoder gives a count-likelihood factor model.

PCA solves $\min_{Z,W:\,W^\top W=I}\|X-ZW^\top\|_F^2$, with $W$ the top-$k$ right singular vectors of the centred matrix and embedding $Z=XW$. The solution is exact for this squared loss. Read as a likelihood, it assumes equal Gaussian noise on every entry. That is a fair approximation for log-normalised values with large means ($\mu\gg1$, to first order) and a poor one for sparse counts with small means.

DCA minimises $\mathcal L_{\mathrm{DCA}}=-\sum_{n,g}\log p(x_{ng}\mid\hat\mu_{ng},\hat\theta_g,\hat\pi_{ng})$, with the bottleneck as the embedding. It is a maximum-likelihood autoencoder with no posterior and no KL term, so it yields no posterior variance.

Estimands, one sentence each:

- Embedding: $\hat z_n=\mathbb E_{q_\phi}[z_n\mid x_n,s_n]$, the posterior mean in prior-scaled units, not standardised.
- Uncertainty: $\mathrm{Var}_{q_\phi}[z_{nk}]$ per dimension in the same units, calibrated only if the model is correctly specified.
- Denoised expression: $\hat\mu_{ng}=\ell_n\hat\rho_{ng}$, the expected count, summing to $\ell_n$ over genes; it is a decoder mean, not a posterior predictive draw.
- PCA embedding: $Z=XW$ in the units of the centred input.
- Planted truth in B2: the latent $z_n$ and group $g_n$ fixed by the generator; subspace comparisons use centred $z_n$.
- ARI and NMI: chance-corrected pair agreement and normalised mutual information between a cluster partition and the labels, both invariant to label permutation.

Regimes of validity. The ELBO bounds the marginal likelihood for any encoder. The Gaussian reading of PCA needs large means. The NB mean-variance relation is assumed gene by gene with a cell-independent $\theta_g$. Posterior calibration needs a well-specified decoder.

Why the heuristic works, and what the model adds. PCA on log-normalised highly variable genes captures the dominant covariance, is fast, and has no likelihood to misspecify. Its failure modes are depth-dependent variance and zero inflation, which it does not model. A model-based formulation adds an explicit count likelihood, covariates inside the generative model (batch is modelled rather than regressed out afterwards), posterior variances, a held-out likelihood for choosing the decoder, and reuse of the trained encoder on new cells. Each addition is falsifiable on B1 and B2 (section 8). The first encoder layer costs $O(\mathrm{nnz}\cdot h)$ per epoch with sparse input and width $h$; no timings are claimed.

Failure modes by family:

- Variational models: posterior collapse; an overdispersed NB under-fits high-expression markers; ZINB can remove real biological zeros.
- DCA: no uncertainty, and the output is a decoder mean that can blur cluster boundaries.
- Any covariate model: a batch term that absorbs biology reduces bio-conservation.

Pitfalls shown by benchmarks: the ranking of deep and PCA pipelines depends on tuning [R9]. Independent seeds rotate the latent axes, so embeddings are compared through subspace or rank metrics rather than coordinate by coordinate.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| PCA on log-normalised HVGs | heuristic | Truncated SVD of the centred matrix; the baseline here | [R9] |
| scVI | model-based | Conditional VAE with a per-gene NB or ZINB decoder, library size and covariates, and a Gaussian latent | [R1, R2] |
| LinearSCVI (LDVAE) | model-based | scVI with a linear decoder, so gene loadings are explicit | [R5, R2] |
| scANVI | model-based | scVI plus a classifier, so partial labels shape the latent | [R3, R2] |
| DCA | model-based | Autoencoder with an NB or ZINB head; the decoder mean is the denoised output and the bottleneck is the embedding | [R4] |
| scVAE | model-based | Count-data VAE with dense hidden layers, distributed as a command-line tool; comparator only | [R6] |
| scGen | model-based | VAE with cell-type and condition labels; latent arithmetic predicts perturbation responses; label-aware comparator only | [R7] |

PCA on log-normalised highly variable genes is the published standard. Its defaults and implementation are in `dim-reduction.normalized_cell_embedding`, and it is the baseline in every comparison here. The count models are candidates for the proposed approach; scGen and scVAE are comparators only. Defaults differ across implementations, so the exact values are recorded in the table below.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| scVI | `n_hidden`; `n_latent`; `n_layers` | 128; 10; 1 | `src/scvi/model/_scvi.py:118-120` @ 5555ecc |
| scVI | `dropout_rate`; `dispersion`; `gene_likelihood` | 0.1; `gene`; `zinb` | `_scvi.py:121-123` @ 5555ecc |
| scVI | `latent_distribution` | `normal` | `_scvi.py:125` @ 5555ecc |
| scVI, OpenProblems batch-integration config | `n_hvg`; `n_latent`; `n_hidden`; `n_layers` | 2000; 30; 128; 2 | `src/methods/scvi/config.vsh.yaml:20,24,28,32` @ b3da9d6 |
| scANVI | `n_hidden`; `n_latent`; `n_layers`; `dropout_rate` | 128; 10; 1; 0.1 | `src/scvi/model/_scanvi.py:119-122` @ 5555ecc |
| scANVI | `gene_likelihood` | `zinb` | `_scanvi.py:124` @ 5555ecc |
| LinearSCVI | `n_hidden`; `n_latent` | 128; 10 | `src/scvi/model/_linear_scvi.py:95-96` @ 5555ecc |
| LinearSCVI | `gene_likelihood` | `nb` | `_linear_scvi.py:100` @ 5555ecc |
| DCA | `ae_type`; `hidden_size` | `nb-conddisp`; (64, 32, 64) | `dca/api.py:21,25` @ 6abd124 |
| DCA | `epochs`; `early_stop`; `reduce_lr`; `batch_size` | 300; 15; 10; 32 | `dca/api.py:31-34` @ 6abd124 |
| DCA | `learning_rate` | `None` (optimiser default) | `dca/api.py:36` @ 6abd124 |
| DCA | `normalize_per_cell`; `scale`; `log1p` | True; True; True | `dca/api.py:22-24` @ 6abd124 |
| scVAE | `latent_size`; `hidden_sizes` | 2; [100] | `scvae/defaults.json:26,27` @ 8bf1738 |
| scVAE | `minibatch_size`; `learning_rate`; `number_of_epochs` | 100; 1e-4; 200 | `scvae/defaults.json:51,52,50` @ 8bf1738 |
| scGen | `n_latent` (model); `n_latent` (inner VAE class) | 100; 10 | `scgen/_scgen.py:53`; `scgen/_scgenvae.py:40` @ d79e1f0 |

## 5. Proposed singlet approach

- **Routes.** Port scVI, scANVI and LinearSCVI from scvi-tools, and DCA from its upstream repository, adapting the reference loss, likelihood heads and warm-up to singlet's interfaces. scGen and scVAE are callouts: benchmark comparators with no MCP option. Licences and authors are in section 12.
- **Default.** `method = scvi`, `n_latent = 30`, `n_hidden = 128`, `n_layers = 2`, `dropout_rate = 0.1`, `gene_likelihood = nb`, `use_hvg = true`, `max_epochs = null`, `seed = 0`. Thirty dimensions match the OpenProblems configuration and the planted dimensions in B2. `nb` replaces the library default `zinb` as the proposed choice; ZINB is enabled only where F3 holds.
- **Model.** A Gaussian encoder $q_\phi(z\mid x,s)$ and an NB head with rate $\ell_n\rho_{ng}$, one-hot batch covariates entering encoder and decoder, a latent of fixed dimension $d$, and the ELBO with a KL weight warmed up over the early epochs. Outputs are the posterior mean and variance. Falsifiers: **F1** (B2, nonlinear arm): the best deep model must beat the best linear baseline by the B2 margin, or the nonlinear route is dropped for identity. **F2** (B1): a deep latent is not adopted if it fails the B1 criterion. **F3** (B2, dropout arm): ZINB replaces NB only if it improves held-out count log-likelihood at the same $d$ on the dropout arm and does not lose on the no-dropout arm.
- **ML stack.** PyTorch for the encoder, decoder and training loop, since these networks need autodiff. Hard-coded CUDA and cuSPARSE only for the LinearSCVI forward and backward pass (a sparse product of counts with loadings) and the NB log-likelihood kernel, each gradient-checked against autograd.
- **Kernels and devices.** Counts are stored in CSR. Minibatches are densified over the HVG columns only, so the full matrix is never densified. The CPU path is the reference, and CUDA matches it within float32 tolerance. Seeds fix initialisation, minibatch order and the KL schedule.
- **Scale.** Version 1 holds the HVG sparse matrix in memory and draws minibatches from it; out-of-core streaming is not claimed. Catalogue-scale pretraining is unsupervised with study covariates. scANVI uses the labelled subset, and held-out evaluation splits whole studies.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | `layers/counts` | sparse int | raw UMI counts, non-negative integers; library size is the row sum over all genes |
| read | `var/highly_variable` | bool mask | genes fitted when `use_hvg` is true |
| read | `obs/<batch_key>` | categorical | study or batch covariate; optional |
| read | `obs/<labels_key>` | categorical | partial labels with a reserved unlabelled value; `scanvi` only |
| write | `obsm/X_deep_latent` | float32, $n\times d$ | posterior mean (variational methods) or bottleneck activation (`dca`) |
| write | `obsm/X_deep_latent_var` | float32, $n\times d$ | posterior variance; variational methods only |
| write | `models/deep_generative_latent` | model registry | weights, registry and gene list for reuse on new cells |
| write | `uns/deep_generative_latent` | dict | method, likelihood, seed, epochs, final training loss, device |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "scvi" | `scvi`, `linear_scvi`, `scanvi`, `dca` | Model: scvi (default), linear_scvi (linear decoder), scanvi (needs labels_key), or dca (count autoencoder). |
| `n_latent` | integer | 30 | min 2 | Latent dimension d, the bottleneck width for dca. Use the same d for every method compared. |
| `batch_key` | string/null | null | — | obs column of study or batch covariates for scvi, linear_scvi and scanvi; null for none. |
| `labels_key` | string/null | null | — | obs column of partial labels with a reserved unlabelled value; required for scanvi, null otherwise. |
| `use_hvg` | boolean | true | — | Fit only var/highly_variable genes; false fits all genes and is slower. |
| `scvi` | object | — | — | Options for scvi, linear_scvi and scanvi; rejected when method is dca. |
| `scvi.n_hidden` | integer | 128 | min 1 | Hidden width of encoder and decoder networks. |
| `scvi.n_layers` | integer | 2 | min 1 | Hidden layers in encoder and decoder; 2 matches the OpenProblems configuration. |
| `scvi.dropout_rate` | number | 0.1 | min 0; max 1 | Dropout inside encoder and decoder networks. |
| `scvi.gene_likelihood` | string | "nb" | `nb`, `zinb` | Count likelihood: nb, or zinb to add a per cell-gene dropout probability. |
| `scvi.max_epochs` | integer/null | null | min 1 | Training epochs; null uses the library epoch rule, which shortens as cell count grows. |
| `dca` | object | — | — | Options for dca; rejected when method is not dca. |
| `dca.ae_type` | string | "nb-conddisp" | `nb-conddisp`, `nb`, `zinb`, `zinb-conddisp` | Output likelihood head of the count autoencoder. |
| `dca.hidden_size` | array | [64] | — | Encoder and decoder widths around the bottleneck of width n_latent. The upstream default (64, 32, 64) corresponds to [64] here, with its 32-unit bottleneck replaced by n_latent. |
| `dca.epochs` | integer | 300 | min 1 | Maximum training epochs. |
| `dca.batch_size` | integer | 32 | min 1 | Minibatch size. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for initialisation, minibatch order and the KL schedule. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Covariates enter only where a method accepts them: `batch_key` applies to `scvi`, `linear_scvi` and `scanvi`, and `dca` is fitted without covariates in this version. `labels_key` is required for `scanvi` and must be null for the other methods. For `dca`, `n_latent` is the bottleneck width, so every method in a comparison uses the same $d$. A nested option object that does not match `method` is rejected. Genes are restricted to `var/highly_variable` before fitting, but library sizes are computed beforehand from all genes.

## 7. MCP tool

Tool name `singlet_dim_reduction_deep_generative_latent_embedding` (definition in `tasks/mcp/singlet_dim_reduction_deep_generative_latent_embedding.json`). Example call and compact result (format only; values are placeholders):

```json
{"dataset": "/data/example.singlet", "method": "scvi", "n_latent": 30, "batch_key": "study", "scvi": {"gene_likelihood": "nb"}, "seed": 0}
```

```json
{
  "dataset": "/data/example.singlet", "status": "completed",
  "wrote": ["obsm/X_deep_latent", "obsm/X_deep_latent_var", "models/deep_generative_latent", "uns/deep_generative_latent"],
  "summary": {"method": "scvi", "embedding_key": "obsm/X_deep_latent", "n_latent": 30, "gene_likelihood": "nb", "epochs_trained": 120, "final_train_loss": 1234.5, "device_used": "cuda"},
  "provenance_id": "prov_0001"
}
```

Long-running: the call returns `queued` with a `job_id` when the dry-run estimate exceeds the inline limit. Stochastic: `seed` fixes initialisation, minibatch order and the KL schedule; GPU kernels can differ from CPU within float32 tolerance. Dry run: estimated seconds, peak memory and device, from the cell count, HVG count, $d$, network widths and epoch budget.

## 8. Benchmarks

**Shared protocol.** Inputs are raw counts restricted to the HVG mask unless a benchmark says otherwise. The PCA baseline uses the same genes on log-normalised values, as in `dim-reduction.normalized_cell_embedding`. Every method is compared at $d\in\{10,30\}$, reported separately. Stochastic methods use seeds 1 to 5 and are reported as mean and standard deviation. Each method uses its library default training rule unless stated; tuned settings are reported beside defaults with the same number of configurations per method. Clustering metrics use Leiden clusters on the embedding at the resolution that maximises the score, as in scIB. Thresholds marked proposed are singlet design choices.

### B1. scIB batch integration (published)

- **Goal**: rank deep latent models against linear and graph-based integration (batch removal, bio conservation).
- **Ground truth**: expert cell-type labels (bio) and study labels (batch).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| RNA integration tasks of the scIB repository | [R8]; https://github.com/theislab/scib | scRNA-seq; tasks in section 10 | — | RNA only |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| kBET acceptance | Mean over tested subsets of one minus the kBET rejection rate | higher | primary | [R8] |
| Graph connectivity | Per label, share of cells in the largest kNN-subgraph component, averaged | higher | primary | [R8] |
| Batch ASW (scaled) | Mean over cell types of $1-\lvert s_i\rvert$, $s_i$ the within-type batch silhouette | higher | primary | [R8] |
| iLISI | Median batch LISI, scaled to $(\mathrm{iLISI}-1)/(B-1)$ | higher | primary | [R8] |
| PCR batch | $\max\{0,(\mathrm{PCR}_{\rm before}-\mathrm{PCR}_{\rm after})/\mathrm{PCR}_{\rm before}\}$ | higher | primary | [R8] |
| ARI and NMI | Leiden clusters against cell types, resolution maximising the score | higher | primary | [R8] |
| Cell-type ASW | Silhouette of cell-type labels, scaled to $[0,1]$ | higher | primary | [R8] |
| cLISI | Median cell-type LISI, scaled to $(N_{\rm lab}-\mathrm{cLISI})/(N_{\rm lab}-1)$ | higher | primary | [R8] |
| Isolated labels | F1 and ASW for labels in few batches | higher | primary | [R8] |
| HVG overlap; cell cycle | Overlap before and after integration; cell-cycle variance | higher | guardrail | [R8] |

- **Comparators**: unintegrated PCA; `linear_scvi`, `scvi`, `scanvi` (labels); scGen (callout); other `scib/integration.py` wrappers.
- **Protocol**: as shared; aggregate as section 10 defines.
- **Acceptance criterion** (proposed): on complex multi-study tasks, beat the unintegrated aggregate by 0.10 and lie within 0.02 of the best non-deep method on batch removal; on simple single-batch tasks, at most 0.02 below Harmony.
- **Known pitfalls**: label-aware rows score their training labels, so report them apart; show bio conservation beside batch metrics.

### B2. Planted nonlinear latent simulation (proposed)

- **Goal**: test whether a nonlinear count latent recovers planted groups and subspace better than linear baselines, and does not fall behind them on linear structure.
- **Ground truth**: planted by construction; $g_n$ and $z_n$ are generator outputs, never recomputed from an embedding.
- **Generator G1** (all constants proposed):
  1. Set $d\in\{10,30\}$, $K=10$, $p=2000$, $N=10^4$.
  2. Draw $m_k\sim\mathcal N(0,4I_d)$, $g_n\sim\mathrm{Uniform}\{1,\dots,K\}$, $z_n=m_{g_n}+\epsilon_n$, $\epsilon_n\sim\mathcal N(0,I_d)$.
  3. Linear arm: $\eta_n=Wz_n$ with $W_{gj}\sim\mathcal N(0,1/d)$. Nonlinear arm: $\eta_n=W_2\tanh(W_1z_n)$, 128 hidden units, weight variance $1/\text{fan-in}$.
  4. $\rho_n=\mathrm{softmax}(\eta_n)$; $\ell_n\sim\mathrm{LogNormal}(\log 3000,\,0.3^2)$.
  5. $\theta_g\sim\mathrm{LogUniform}(0.5,20)$; $x_{ng}\sim\mathrm{NB}(\ell_n\rho_{ng},\theta_g)$.
  6. Dropout arm: zero each entry with probability $\pi_0\in\{0,0.3\}$.
  7. Hold out 10% of cells per seed; seeds 1 to 5.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| G1 simulation: both arms, $d\in\{10,30\}$, $\pi_0\in\{0,0.3\}$ | Recipe G1 | simulated expression; $N=10^4$, $p=2000$ | — | Generated |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI of $K$-means | ARI of $K$-means labels on the embedding against $g_n$ | higher | primary | — |
| Subspace angle | Mean of the $d$ principal angles (degrees) between centred $Z$ and $\hat Z$; linear measure | lower | primary | — |
| Held-out log-likelihood | Per-cell count log-likelihood on held-out cells under the model's own head | higher | guardrail | — |

- **Comparators**: randomised PCA on log1p CP10k; `linear_scvi`; `scvi` (NB and ZINB heads); `dca`; all at $n_{\rm latent}=d$.
- **Protocol**: fit on 90% of cells and embed all; ARI and angle use all cells; likelihood uses the 10%. Mean and standard deviation over seeds 1 to 5, per $d$, arm and dropout level.
- **Acceptance criterion** (proposed): in the nonlinear arm, the best deep ARI exceeds the best linear baseline by 0.05 at both $d$; in the linear arm it lies within 0.01 of that baseline.
- **Known pitfalls**: the generator decides the answer, so the linear arm is a required control. Check that planted groups are separable in $z$ before scoring (proposed: positive mean silhouette).

### P1. Performance and scaling

Wall-clock time to convergence, throughput in cells per second, peak GPU and CPU memory, and time to a final embedding, at $10^4$, $10^5$ and $10^6$ cells, on CPU and CUDA, for `scvi`, `linear_scvi`, `scanvi`, `dca`, the scVAE callout and randomised PCA. Hold fixed: 2000 HVGs, $d$ (reported separately), batch size, epoch budget and early-stopping rule, precision, seed and hardware. Time to convergence is reported with the final held-out likelihood, so speed is not separated from quality. No 10-million-cell case is claimed, since version 1 is in memory.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `feature-selection.highly_variable_gene_selection`: Unsupervised highly variable gene selection for clustering and embedding
- **Feeds**:
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `integration.integration_quality_scoring`: Integration quality scoring
  - `embedding-viz.local_neighborhood_preservation`: Local neighbourhood preservation of an embedding or reduced representation
- **Reads**: `layers/counts`, `var/highly_variable`, `obs/<batch_key>`, `obs/<labels_key>`
- **Writes**: `obsm/X_deep_latent`, `obsm/X_deep_latent_var`, `models/deep_generative_latent`, `uns/deep_generative_latent`
<!-- CHAINING:AUTO:END -->

Named workflow: the single-dataset clustering recipe, with this model as an alternative to the PCA step. Catalogue-scale pretraining uses the same model with study covariates.

## 10. Risks, pitfalls and open questions

- **Evidence not transcribed.** The number of scIB integration tasks, per-task accessions and sizes are not recorded here, so no count is quoted. The scIB ranking in section 2 comes from the best-practices integration chapter and was not checked against the scIB tables. The aggregate in B1 uses 0.4 for batch removal and 0.6 for bio conservation; this weighting is from memory, since neither the chapter nor the scIB code at commit cd67913 states it in the copies checked, so all sub-scores are reported beside the aggregate.
- **Published benchmarks held as context.** Raimundo et al. [R9] (default versus tuned settings; dataset list not recorded here) and the OpenProblems dimensionality-reduction and denoising tasks have no dataset list recorded here, so none is a numbered benchmark. The denoising task scores held-out counts from molecular cross-validation [R10]. The OpenProblems dimensionality-reduction task requires log-10k input; its README notes that methods using the metric's normalisation score higher, so count models are at a disadvantage there. Its metrics are not used as a pass or fail for latent identity. Their dataset lists belong in the first comparison.
- **Unsettled biology and the dropout arm.** Whether droplet zeros are dropouts is disputed; the 2020 Correspondence [R11] is challenged by a 2021 Matters Arising (Cao et al.). The negative-binomial versus ZINB choice therefore rests on F3 of B2, not on that citation.
- **Methods omitted or conflicted.** scvis and VASC are omitted from the tables because no primary code was checked for them. The scGen licence conflict in section 12 must be resolved before any reuse. GLM-PCA, the linear count comparator, belongs to `dim-reduction.count_model_latent_factors`.
- **Catalogue and scale.** The catalogue figures (354 million cells, about 40 percent author-annotated) come from the project specification and were not checked against a catalogue file. Out-of-core training, embedding drift as studies are added, and the calibration of posterior variances are open.
- **First experiment.** B2 comes first, since it needs no external data and tests F1 and F3. Then B1 on study-split catalogue tasks at $10^5$ cells, comparing `scvi`, `linear_scvi` and PCA at matched $d$, before any claim about identity.

## 11. References

R1. Lopez R, Regier J, Cole MB, Jordan MI, Yosef N. Deep generative modeling for single-cell transcriptomics. *Nature Methods* 2018. doi:10.1038/s41592-018-0229-2 — verified (corpus)
R2. Gayoso A, Lopez R, Xing G, et al. A Python library for probabilistic analysis of single-cell omics data. *Nature Biotechnology* 2022. doi:10.1038/s41587-021-01206-w — verified (corpus)
R3. Xu C, Lopez R, Mehlman E, Regier J, Jordan MI, Yosef N. Probabilistic harmonization and annotation of single-cell transcriptomics data with deep generative models. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209620 — verified (corpus)
R4. Eraslan G, Simon LM, Mircea M, Mueller NS, Theis FJ. Single-cell RNA-seq denoising using a deep count autoencoder. *Nature Communications* 2019. doi:10.1038/s41467-018-07931-2 — verified (corpus)
R5. Svensson V, Gayoso A, Yosef N, Pachter L. Interpretable factor models of single-cell RNA-seq via variational autoencoders. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa169 — verified (corpus)
R6. Grønbech CH, et al. scVAE: variational auto-encoders for single-cell gene expression data. *Bioinformatics* 2020. doi:10.1093/bioinformatics/btaa293 — verified (corpus)
R7. Lotfollahi M, Wolf FA, Theis FJ. scGen predicts single-cell perturbation responses. *Nature Methods* 2019. doi:10.1038/s41592-019-0494-8 — verified (corpus)
R8. Luecken MD, Büttner M, Chaichoompu K, et al. Benchmarking atlas-level data integration in single-cell genomics. *Nature Methods* 2022. doi:10.1038/s41592-021-01336-8 — verified (corpus)
R9. Raimundo F, et al. Tuning parameters of dimensionality reduction methods for single-cell RNA-seq analysis. *Genome Biology* 2020;21:212. doi:10.1186/s13059-020-02128-7 — verified (search)
R10. Batson J, Royer L, Webber J. Molecular cross-validation for single-cell RNA-seq. *bioRxiv* 2019. doi:10.1101/786269 — verified (corpus)
R11. Svensson V. Droplet scRNA-seq is not zero-inflated. *Nature Biotechnology* 2020;38:147–150 (Correspondence). doi:10.1038/s41587-019-0379-5 — verified (search)
R12. Kingma DP, Welling M. Auto-encoding variational Bayes. *International Conference on Learning Representations* 2014. — unverified (memory)
R13. Rezende DJ, Mohamed S, Wierstra D. Stochastic backpropagation and approximate inference in deep generative models. *International Conference on Machine Learning* 2014. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/scvi-tools | The scvi-tools development team (pyproject.toml) | BSD-3-Clause (LICENSE) | scVI, scANVI and LinearSCVI defaults and loss | port |
| https://github.com/theislab/dca | Gokcen Eraslan (setup.py) | Apache-2.0 (LICENSE.txt) | DCA defaults and objective; the OpenProblems denoising task installs a fork (scottgigante-immunai/dca, patch-1), not this repository | port |
| https://github.com/chgroenbech/scVAE | Christopher Heje Grønbech, Maximillian Fornitz Vording (scvae/__init__.py) | Apache-2.0 (LICENSE.txt) | scVAE defaults; comparator | callout |
| https://github.com/theislab/scgen | Mohammad Lotfollahi (pyproject.toml) | GPL-3.0 (LICENSE); pyproject.toml declares MIT, a conflict | label-aware comparator | callout |
| https://github.com/theislab/scib (commit cd67913) | Malte D. Luecken, Maren Buettner, Daniel C. Strobl, Michaela F. Mueller (pyproject.toml) | MIT (LICENSE.txt) | benchmark definitions and metric code (`scib/metrics`, `scib/integration.py`) | callout |
| https://github.com/openproblems-bio/task_batch_integration | — | MIT (LICENSE) | OpenProblems scVI configuration (defaults) | callout |
