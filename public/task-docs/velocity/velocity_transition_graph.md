---
id: velocity.velocity_transition_graph
title: Velocity-based cell-to-cell transition graph and embedding projection
area: velocity
scope: core
paradigm: heuristic
literature_status: contested
priority: P1
depends_on: [velocity.gene_kinetics_velocity_estimation, neighbors.approximate_knn_search, dim-reduction.normalized_cell_embedding]
feeds: [trajectory.fate_probability, trajectory.terminal_state_identification]
reads: [layers/Ms, layers/velocity, obsp/connectivities, obsm/X_pca, obsm/X_umap, var/velocity_genes]
writes: [obsp/velocity_graph, obsp/transition_matrix, obsm/velocity_umap, uns/velocity_graph_params]
devices: [cpu, cuda]
mcp_tool: singlet_velocity_velocity_transition_graph
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Velocity-based cell-to-cell transition graph and embedding projection

> Converts per-cell RNA velocity and a neighbour graph into a row-stochastic matrix of likely next cells and into projected 2D arrows, keeping published kernels as comparators.

## 1. Question

Given each cell's velocity vector and its candidate neighbours, which neighbours does the cell move toward and with what probability, and does the resulting directed graph point from earlier to later states? Inputs are the velocity matrix, the expression representation, a kNN graph and an optional 2D embedding; outputs are a row-stochastic transition matrix and arrows projected onto the embedding. A correct answer ranks the neighbours a cell moves toward above those it moves away from, and its direction agrees with external time or lineage where such information exists.

## 2. Why this task matters and where the field stands

Transition graphs turn velocity from one vector per cell into the cell-to-cell structure that downstream steps use: fate probabilities, terminal states and the arrows drawn on embeddings [R5][R6][R7]. The task is **contested**. The kernels in use are fixed-temperature or heuristically scaled functions of cosine or correlation similarity, and the tools differ in their defaults for negative similarities, transforms and neighbour counts [R5][R7]. Published comparisons show these choices change results, and one 2022 analysis reports many user-set hyperparameters [R3][R4]. Projected arrows depend on the number of genes and on plotting choices, and they weaken at the embedding boundary [R14]. The velocity model is valid only when the splicing time scale is comparable with the process time scale and each gene follows one kinetic regime [R14]; the dynamical model was introduced to handle transient states [R2]. Whether a velocity-derived graph encodes time order in transient or multi-lineage data is unresolved [R3][R14]. The kernels have no fitted objective, so their probabilities are not calibrated against held-out direction labels, and uncertainty in velocity direction is not standard in them. A 2022 paper on reliable cell-state velocities addresses this gap [R11], and a learned velocity posterior with directional uncertainty exists [R8]. A 2026 benchmark of 19 RNA velocity tools on 34 datasets (26 real, 8 simulated) is evaluated with the VeloEV package, which implements the directional and coherence metrics used in section 8 [R13]. The open problems are that no accepted ground truth exists for edge direction, and that the available metrics share their neighbour graph and annotation with the transitions they score.

## 3. Theory and insight

### Kinetic input

Each gene is a two-pool linear system. Unspliced RNA $u$ is produced at rate $\alpha$, converted to spliced RNA $s$ at rate $\beta$, and spliced RNA degrades at rate $\gamma$:

$$\frac{du}{dt}=\alpha(t)-\beta u,\qquad \frac{ds}{dt}=\beta u-\gamma s.$$

Velocity is the rate of change of spliced abundance, $v=\beta u-\gamma s$, in counts per unit model time. The regime is first-order linear kinetics for mean counts with one kinetic regime per gene; the approximation holds for genes whose phase portrait is almond-shaped [R14]. Steady-state estimators avoid the dynamical fit and use $v_i=u_i-\gamma s_i$ with the unspliced counts scaled so that $\beta=1$ [R1]. This is valid only on the steady-state line $u=(\gamma/\beta)s$ with constant $\alpha$, and it is biased during induction or repression.

### Kernels and the first-order step

A kernel scores each candidate neighbour $j$ of cell $i$ by how well the observed displacement $x_j-x_i$ agrees with $v_i$. The justification is the first-order step $x(t+\Delta t)\approx x(t)+v(x(t))\,\Delta t$, which reads neighbours as samples of the flow at small step size. It holds only when $\Delta t$ is small relative to process time [R14].

The cosine similarity that scVelo stores before exponentiation is

$$\pi_{ij}=\frac{(x_j-x_i)^{\top}v_i}{\lVert x_j-x_i\rVert\,\lVert v_i\rVert}\in[-1,1].$$

scVelo then applies an exponential with scale $\lambda=10$ to stored entries and row-normalises:

$$T_{ij}=\frac{e^{\lambda\pi_{ij}}-1}{\sum_{k}\left(e^{\lambda\pi_{ik}}-1\right)}.$$

The offset of $-1$ is applied to stored entries only, so the code and the docstring form differ slightly.

velocyto uses a correlation $\rho_{ij}$ on square-root transformed values, with weights $P_{ij}\propto\exp(\rho_{ij}/\sigma_c)A_{ij}$ over an embedding neighbour indicator $A$ and $\sigma_c=0.05$, which is an inverse temperature of 20 on correlations.

CellRank's deterministic kernel uses a Pearson correlation $\rho_{ij}$ between $v_i$ and the centred displacement on the velocity genes, with $P_{ij}\propto\exp(s\rho_{ij})$ over the neighbours of $i$ and $s=1/\operatorname{median}|\rho|$ estimated from the data. dynamo uses a Pearson similarity over a two-hop neighbourhood with a square-root transform, and corrects density in its projection.

The projection of the matrix onto the embedding is

$$\hat\Delta x_i=\sum_j P_{ij}\,(x_j-x_i).$$

Its regime is first order. It loses accuracy at the embedding boundary and depends on gene count and plotting parameters [R14].

### Estimands and normalisation

- Velocity $v_i$ is a per-cell vector in gene space (counts per unit model time) or in an embedding, with no normalisation applied before the kernel.
- $\pi_{ij}$ is a cosine in $[-1,1]$; the default scVelo graph keeps positive values only.
- $P_{ij}$ is a probability over the candidate neighbours of $i$, and each non-empty row sums to one. A zero-velocity cell has no defined row; singlet reports it as missing, whereas CellRank returns a uniform row.
- $\hat\Delta x_i$ is the expected displacement in embedding units before any global arrow rescaling, which affects display only.
- CBDir is the mean over annotated pairs $(u,v)$ present in the data of the score of each pair, with the score defined as

$$\mathrm{CBDir}(u\!\to\!v)=\frac{1}{|U_{uv}|}\sum_{i\in U_{uv}}\frac{1}{|N_v(i)|}\sum_{j\in N_v(i)}\cos(x_j-x_i,\hat v_i),$$

where $U_{uv}$ is the set of cells in $u$ with a neighbour in $v$, $N_v(i)$ are those neighbours, and $\hat v_i$ is velocity in the same space. The estimand is a cosine average in $[-1,1]$, and VeloEV skips pairs with no source cells and averages the rest [R13].

- ICVCoh is the unweighted mean over clusters $c$ of $\frac{1}{|c|}\sum_{i\in c}\frac{1}{|N_c(i)|}\sum_{j\in N_c(i)}\cos(\hat v_i,\hat v_j)$, where $N_c(i)$ are same-cluster neighbours. It lies in $[-1,1]$, and VeloEV sets NaN velocities to zero before scoring [R13].

### Regimes of validity

Cosine is invariant to positive rescaling of either vector, so global velocity magnitude does not change neighbour ranking within a cell. Pearson centres both vectors, so uniform expression shifts do not change it. The sharpness is set by the temperature: scVelo's $\lambda=10$ on cosines, velocyto's inverse temperature of 20 on correlations, and CellRank's data-estimated $s$ give different sharpness for similar similarities, so kernels are not comparable without matched temperatures. Large $\lambda$ approaches the arg-max neighbour, and small $\lambda$ approaches the uniform distribution over stored neighbours. ICVCoh measures local smoothness only, and CBDir is interpretable as direction only if the annotated pairs are true directed transitions.

### Assumptions and failure modes

Heuristic kernels assume that the velocity direction is locally correct, that sampling is dense enough for $x_j-x_i$ to be a plausible step, and that velocity genes follow the model. Their failures are steady-state violation and multiple kinetic regimes [R14], neighbour graphs built in a batch-driven space, density bias in projections (corrected in dynamo), and cell-cycle or proliferation effects that look directional without a lineage change. Zero-velocity cells must be masked, not treated as neutral. Model-based posteriors assume a generative ODE and give per-cell uncertainty [R8], but they still need a kernel before they yield a graph.

### Why a model-based formulation adds value

A kernel produces a score, not a calibrated probability: its temperature is fixed or estimated heuristically and is never fitted to held-out direction labels. A learned conditional categorical over neighbours can be fitted by maximum likelihood, its probabilities can be checked with reliability curves, velocity uncertainty can be propagated by posterior sampling, and one trained scorer can be reused across studies with covariates. Its validity depends on direction labels that are independent of both the kNN graph and the annotation used to score it [R12][R13].

### Pitfalls shown by benchmark studies

- CBDir is circular when the same kNN graph and annotation define both the transitions and the metric [R13].
- ICVCoh rewards over-smoothing, so a smooth field with the wrong direction can score well.
- The scVelo defaults for negative cosines differ between the transition matrix and the projection, so the same velocities can give different arrows.

The graph is a local alignment score between observed neighbour displacements and predicted velocity. Its direction is only as good as the velocity model, and neighbourhood coherence alone cannot separate a correct field from a smoothed wrong one.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scVelo cosine graph and embedding | heuristic | Cosine between displacement and velocity, exponentiated with a fixed scale on stored positive entries and row-normalised | [R2] |
| velocyto correlation kernel | heuristic | Correlation on square-root values, exponentiated with a fixed temperature over an embedding neighbour indicator | [R1] |
| CellRank VelocityKernel (deterministic) | heuristic | Pearson similarity with a row softmax whose scale is estimated from the data | [R5][R6] |
| dynamo Pearson kernel | heuristic | Pearson similarity over a two-hop neighbourhood, with a density-corrected projection | [R7] |
| VeloVI velocities | model-based | Deep generative ODE model with posterior velocity samples and directional uncertainty; the code examined produces no transition graph | [R8] |
| UniTVelo velocities | hybrid | Unified latent time with per-gene kinetics; the graph is then built by scVelo's cosine kernel | [R9] |
| VeloVAE cross-boundary code | model-based | Variational ODE mixtures; reference implementation of a CBDir variant with k-hop neighbours | [R10] |

The scVelo cosine graph is the standard comparator for the kernels here, because its defaults are documented in code and the 2026 benchmark evaluates scVelo as one of its methods [R13]. CellRank and dynamo are the other kernels with documented defaults. The velocyto kernel is kept for reproduction only, because its repository is no longer maintained (section 12). VeloVI and UniTVelo supply velocities rather than a kernel and enter as comparators.

Defaults of the published implementations that singlet mirrors or compares against:

| Method | Parameter | Value | Source (file:line) |
|---|---|---|---|
| scVelo `velocity_graph` | `n_neighbors` | `None`: the existing graph is used when it has enough neighbours | `scvelo/tools/velocity_graph.py:271`, `:120` |
| scVelo `velocity_graph` | `sqrt_transform` | `None`, resolved through `variance_stabilization` (`None`), so effectively `False`; docstring default `False` | `velocity_graph.py:274-275`, `:317`, `:348-349` |
| scVelo `transition_matrix` | `scale` | `10`; applied as `np.expm1(graph * scale)` | `transition_matrix.py:20`, `:108` |
| scVelo `transition_matrix` | `self_transitions` | `True`; diagonal set to the 98th percentile of row maxima minus each row maximum, clipped to $[0,1]$ | `transition_matrix.py:19`, `:102-106` |
| scVelo `transition_matrix` | `use_negative_cosines` | `False` | `transition_matrix.py:23` |
| scVelo `velocity_embedding` | `use_negative_cosines` | `True` | `velocity_embedding.py:40` |
| scVelo `velocity_embedding` | `autoscale` | `True`; arrows divided by three times the quiver scale | `velocity_embedding.py:43`, `:186-187` |
| velocyto `estimate_transition_prob` | `transform`, `embed` | `sqrt`, `ts` | `analysis.py:1452` |
| velocyto `estimate_transition_prob` | `n_neighbors` when unset | `int(n_cells / 5)` | `analysis.py:1511-1512` |
| velocyto `estimate_transition_prob` | diagonal and NaN | diagonal set to 0; NaN set to 1 | `analysis.py:1604-1606` |
| velocyto `calculate_embedding_shift` | `sigma_corr` | `0.05`; weights `exp(corr / sigma_corr)`, row-normalised | `analysis.py:1670`, `:1697-1698` |
| CellRank `compute_transition_matrix` | `model`, `similarity` | `deterministic`, `correlation` | `_velocity_kernel.py:116`, `:118-119` |
| CellRank `compute_transition_matrix` | `backward`, `backward_mode` | `False`, `transpose` | `_velocity_kernel.py:59`, `:117` |
| CellRank `compute_transition_matrix` | `softmax_scale` | `None`, estimated as `1 / median(abs(logits))` | `_velocity_kernel.py:120`, `:260-268` |
| CellRank `VelocityKernel` | `xkey`, `vkey` | `Ms`, `velocity` | `_velocity_kernel.py:61-62` |
| CellRank `VelocityKernel` | velocity genes | `var['velocity_genes']` when present | `_velocity_kernel.py:85-86` |
| CellRank deterministic model | zero velocity | uniform row over neighbours | `_velocity_model.py:173-174` |
| dynamo `cell_velocities` | `method`, `n_neighbors` | `pearson`, `30` | `cell_velocities.py:69`, `:68` |
| dynamo `cell_velocities` | Pearson kernel arguments | `n_recurse_neighbors=2`, `max_neighs=None`, `transform='sqrt'`, `use_neg_vals=True` | `cell_velocities.py:434-437` |
| dynamo projection | `correct_density`, `norm_dist` | `True`, `True` | `dynamo/tools/utils.py:3371` |
| UniTVelo | graph call | `scv.tl.velocity_graph(adata, sqrt_transform=True)` | `unitvelo/velocity.py:282` |
| VeloVAE `cross_boundary_correctness` | `x_emb` | `'X_umap'` | `velovae/analysis/evaluation_util.py:1154` |
| VeloVAE `gen_cross_boundary_correctness` | `k_hop` | `5` | `evaluation_util.py:1260` |

## 5. Proposed singlet approach

**Routes.** The scVelo, CellRank, dynamo and velocyto kernels are ported, because each is a short sparse row operation and their licences are permissive (section 12). The CBDir and ICVCoh code is ported from the benchmark's evaluation package. VeloVI, UniTVelo and VeloVAE are callouts: they supply velocities or comparator outputs and are not reimplemented.

**Default and enum.** The enum holds only the four kernels whose code was examined. The proposed default is `scvelo_cosine` with the generated defaults in section 6, because its settings are documented and it is the benchmark comparator. Two departures from the published defaults make outputs reproducible. The square-root transform is an explicit switch rather than an inherited metadata flag, and `use_negative_cosines` is one setting for both the transition matrix and the projection, which removes the inconsistency in section 4. Zero-velocity cells have empty rows and are reported in the summary, never filled uniformly.

**Computation.** Each row depends only on one cell and its candidates, so rows are independent. CPU work is partitioned over cells. CUDA computes the similarity on the kNN sparsity pattern, applies the exponential or softmax and normalises rows, with hard-coded kernels because these operations are small and hot. Cells are processed in blocks, and the output stores $k$ entries per row, so the graph itself is $O(nk)$ in memory.

**Model-based candidate (not in the enum).** A learned scorer $P_{ij}=\mathrm{softmax}_j(\theta^{\top}\phi_{ij})$ uses features $\phi_{ij}$ built from the cosine, the correlation, the neighbour distance and a batch-match indicator. It is fitted by maximum likelihood on annotated transitions and lineage-barcode edges, with whole studies held out. Velocity uncertainty enters by sampling posterior velocities and reporting the spread of $P_{ij}$. PyTorch fits the scorer, and its inference is hard-coded on CUDA. The formulation is falsified if its held-out log-loss on annotated edges is not lower than that of the fixed-scale scVelo kernel, or if its paired CBDir difference fails the B1 criterion. It enters the enum only once implemented and benchmarked.

**Sign-reversal check.** For CBDir built from cosines, $\mathrm{CBDir}(-v)=-\mathrm{CBDir}(v)$ exactly, so the residual must stay below $10^{-6}$; a larger residual indicates a plumbing error. The scVelo graph clips negative cosines and is exempt.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/Ms | float32, sparse or dense | Expression for displacements; falls back to `layers/spliced` when absent, as scVelo does |
| read | layers/velocity | float32, cells by genes | Per-cell velocity from the kinetics step |
| read | obsp/connectivities | sparse float | Candidate neighbours when `n_neighbors` fits within the stored graph |
| read | var/velocity_genes | bool | Genes used in the similarity; all genes when absent |
| read | obsm/X_pca | float32, cells by components | Neighbour and displacement space when `basis` is `pca` |
| read | obsm/X_umap | float32, cells by 2 | Displacement space when `basis` is `umap`; target of the projection |
| write | obsp/velocity_graph | sparse float32 | Similarity on stored neighbours; positive part only by default |
| write | obsp/transition_matrix | sparse float32 | Row-stochastic probabilities, each non-empty row summing to one; zero-velocity rows empty |
| write | obsm/velocity_umap | float32, cells by 2 | Expected displacement, unscaled apart from display autoscaling; written when `obsm/X_umap` exists |
| write | uns/velocity_graph_params | dict | Method, basis, `n_neighbors`, options and similarity gene count |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `vkey` | string | "velocity" | — | Layer with per-cell velocity in gene space, or obsm key holding a velocity embedding. |
| `basis` | string | "gene_space" | `gene_space`, `pca`, `umap` | Space in which neighbours and displacements are measured; pca or umap restricts both to that embedding. |
| `method` | string | "scvelo_cosine" | `scvelo_cosine`, `velocyto_correlation`, `cellrank_deterministic`, `dynamo_pearson` | Similarity kernel. The default is the published comparator; the others reproduce their own tools. |
| `n_neighbors` | integer | 30 | min 5; max 200 | Candidate neighbours per cell from obsp/connectivities; the graph is rebuilt when it has fewer. |
| `scvelo` | object | — | — | Options for scvelo_cosine, applied to both the transition matrix and the projection. |
| `scvelo.lambda_scale` | number | 10 | > 0 | Inverse temperature applied to cosine similarities before row normalisation. |
| `scvelo.sqrt_transform` | boolean | false | — | Square-root transform of expression before similarity; fixed here rather than inherited from metadata. |
| `scvelo.use_negative_cosines` | boolean | false | — | Keep negative similarities as repulsive transitions; false clips them to zero. |
| `scvelo.autoscale` | boolean | true | — | Rescale projected arrows by one global factor for display; probabilities are unchanged. |
| `velocyto` | object | — | — | Options for velocyto_correlation. |
| `velocyto.sigma_corr` | number | 0.05 | > 0 | Correlation temperature: transitions are proportional to exp(correlation / sigma_corr). |
| `cellrank` | object | — | — | Options for cellrank_deterministic. |
| `cellrank.similarity` | string | "correlation" | `correlation`, `cosine` | Similarity between each velocity vector and neighbour displacement. |
| `cellrank.softmax_scale` | number/null | null | > 0 | Softmax scale; null estimates the inverse median absolute logit from the data. |
| `dynamo` | object | — | — | Options for dynamo_pearson. |
| `dynamo.correct_density` | boolean | true | — | Correct the projection for neighbourhood density, as dynamo does by default. |
<!-- PARAMS:AUTO:END -->

Each nested object applies only to its named method and is ignored otherwise; the `scvelo` options apply to both the transition matrix and the projection. `basis` set to `pca` or `umap` requires the matching obsm key, and `umap` is also the projection target. `n_neighbors` sets the candidate count for every method; when `obsp/connectivities` holds fewer neighbours, the kNN graph is rebuilt on the chosen basis with the settings of the approximate kNN task. Validation rejects a missing velocity layer and an embedding with fewer than two dimensions. Parameters do not transfer between methods: a `sigma_corr` value does not set a CellRank softmax scale.

## 7. MCP tool

Tool name `singlet_velocity_velocity_transition_graph` (definition in `tasks/mcp/singlet_velocity_velocity_transition_graph.json`). Example call:

```json
{"dataset": "/data/example.singlet", "vkey": "velocity", "basis": "umap", "method": "scvelo_cosine", "n_neighbors": 30}
```

Compact result:

```json
{
  "dataset": "/data/example.singlet",
  "status": "completed",
  "wrote": ["obsp/velocity_graph", "obsp/transition_matrix", "obsm/velocity_umap", "uns/velocity_graph_params"],
  "summary": {"n_cells": "<int>", "n_zero_velocity_cells": "<int>", "mean_stored_neighbours": "<float>", "median_top1_probability": "<float>", "kernel": "scvelo_cosine", "n_similarity_genes": "<int>"},
  "provenance_id": "<id>",
  "job_id": null,
  "estimate": null
}
```

Long-running: no for typical sizes; larger inputs return `queued` with a `job_id`. Stochastic: no; the same velocity matrix and kNN graph always give the same output. The `dry_run` estimate returns seconds, peak memory and device from cell, neighbour and gene counts, and writes nothing.

## 8. Benchmarks

**Shared protocol.** Each benchmark fixes the cells, the velocity matrix and the kNN graph (k = 30, built once on the representation each kernel uses and once on the UMAP) before any kernel is applied, so comparisons are paired by cell. Comparators use the defaults in section 4 and fixed seeds where applicable. A single metric implementation, ported from the benchmark's evaluation package [R13], scores every method. Results are reported per dataset as paired mean differences with 95% bootstrap intervals over cells. Thresholds are design choices stated in each benchmark.

### B1. Annotated-transition direction and coherence

- **Goal**: Does a kernel send cells of an annotated source type toward neighbours of the annotated target type, and is velocity locally coherent within types?
- **Ground truth**: Expert labels. The expected edges are annotated cluster pairs $(u,v)$ from each dataset's transition list, which is an input (section 10). The per-cell label is the cluster in `obs`. The estimand is CBDir as defined in section 3, a mean over annotated pairs present in the data of per-cell cosine means in $[-1,1]$, and ICVCoh is the mean over clusters of same-cluster cosine means.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Bone marrow (Data 1) | [R13]; `scvelo.datasets.bonemarrow()` | — | — | Loaded through the scVelo loader |
| Dentate gyrus (Data 2) | [R13]; `scvelo.datasets.dentategyrus()` | — | — | Loaded through the scVelo loader |
| Gastrulation (Data 3) | [R13]; `scvelo.datasets.gastrulation_erythroid()` | — | — | Loaded through the scVelo loader |
| Pancreas (Data 4) | [R13]; `scvelo.datasets.pancreas()` | — | — | Loaded through the scVelo loader |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| CBDir | Section 3 definition; pairs without source cells skipped; UMAP space primary, gene space secondary | higher | primary | [R13] |
| ICVCoh | Section 3 definition over same-cluster neighbours; NaN velocities set to zero | higher | guardrail | [R13] |

- **Comparators**: scVelo, velocyto, CellRank and dynamo kernels at their section 4 defaults; UniTVelo and VeloVI velocities through the scVelo kernel at its defaults [R8][R9][R13].
- **Protocol**: Data 1 to 4 under the shared protocol. Report edge counts per method, because edges without a neighbour pair are dropped and counts can differ between methods.
- **Acceptance criterion** (proposed): Method A improves direction over comparator B on a dataset when the paired 95% bootstrap interval over cells of the mean CBDir difference excludes zero; A must win on at least two of the four datasets. A rise in ICVCoh together with a fall in CBDir relative to the scVelo kernel flags smoothness without direction.
- **Known pitfalls**: The same kNN graph and annotation define the transitions and the metric, so the scores are circular with the graph [R13]. Projected UMAP-space scores inherit embedding distortion [R14].

### B2. Planted directed tree (proposed)

- **Goal**: Does a kernel recover a planted directed lineage with known parent-to-child edges?
- **Ground truth**: Planted simulation. For each parent-group cell, the label is the set of planted child groups. The estimand is the fraction of parent-group cells with at least one child-group neighbour whose highest-probability out-neighbour lies in a child group, normalised over parent-group cells that have such a neighbour.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated tree | Generator recipe below | Simulated spliced and unspliced counts; 2,000 and 10,000 cells (proposed) | — | Three seeds per size |

Generator recipe (proposed):

1. Draw a rooted tree of five groups: a root, two children and two grandchildren. The planted edges are the parent-to-child pairs.
2. For each gene, draw baseline $\alpha_g$, $\beta_g$ and $\gamma_g$ from fixed log-uniform ranges, and draw a group-specific multiplier on $\alpha$.
3. Integrate the splicing ODE along each root-to-leaf segment, starting each child from its parent's end state.
4. Draw cell times uniformly along each segment and record the true velocity $\beta u-\gamma s$.
5. Draw library sizes from a log-normal distribution; draw unspliced and spliced counts as Poisson with means equal to library size times $u$ and times $s$.
6. Compute 50 principal components, a kNN graph with $k=30$ and a 2D UMAP, all with fixed seeds.
7. Store group labels, planted pairs and true velocity. Comparators receive only the counts, the kNN graph and the UMAP.

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Top-1 edge precision | Estimand in the ground-truth bullet, aggregated over simulations | higher | primary | proposed |
| CBDir on planted pairs | Section 3 definition with planted groups as clusters | higher | guardrail | [R13] |

- **Comparators**: scVelo, CellRank and dynamo kernels at their section 4 defaults.
- **Protocol**: Three seeds at each of two sizes; both metrics for every method and simulation.
- **Acceptance criterion** (proposed): A method is direction-correct on a simulation when top-1 edge precision is at least 0.8.
- **Known pitfalls**: Data simulated from the same first-order model favour scVelo-type kernels, so a second generator with a different kinetic model is required (section 10). Equal-time sampling is easier than real snapshots.

### B3. Kernel and embedding sensitivity (proposed)

- **Goal**: How stable are transition matrices and their top edges across defensible single-factor choices?
- **Ground truth**: Consistency under perturbation, with no truth. The estimand is the median over cells of the Jaccard overlap between default and variant top-10 out-neighbour sets; the sign-flip fraction is the share of cells whose projected arrow has a negative cosine with the default arrow.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Bone marrow, dentate gyrus, gastrulation, pancreas (Data 1 to 4) | [R13]; scVelo loaders as in B1 | — | — | Same datasets as B1 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Top-10 out-neighbour Jaccard | Per-cell Jaccard of top-10 sets, median over cells | higher | primary | proposed |
| Arrow sign-flip fraction | Share of cells with negative cosine between default and variant arrows | lower | guardrail | proposed |

- **Comparators**: Variants of the scVelo kernel: Pearson in place of cosine; square-root transform on and off; `n_neighbors` of 15, 30 and 50; gene space versus UMAP basis; top velocity genes versus all velocity genes. The variant list is fixed in advance.
- **Protocol**: One factor changes at a time, with velocities held fixed; one table per dataset.
- **Acceptance criterion** (proposed): The median top-10 Jaccard is at least 0.5 for every single-factor variant. Datasets below the threshold are reported, not dropped.
- **Known pitfalls**: Gene subsets chosen with the velocity itself make the variants non-independent. The 0.5 cut-off is a design value.

### P1. Performance and scaling

Wall time and peak memory for building the transition matrix and the projection at 10,000, 100,000 and 1,000,000 cells, on CPU and CUDA, against the scVelo, CellRank, dynamo and velocyto kernels on CPU. Inputs come from the B2 recipe at each size. Hold fixed: $k=30$, a fixed number of velocity genes, float64 for comparators, and the hardware and thread counts, which are reported. kNN construction is timed separately. Acceptance (proposed): row-wise Spearman correlation with the scVelo transition matrix of at least 0.999, and at least a five-fold speed-up over scVelo at 100,000 cells.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `velocity.gene_kinetics_velocity_estimation`: Per-gene kinetics and RNA velocity estimation from spliced and unspliced counts
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
- **Feeds**:
  - `trajectory.fate_probability`: Cell-fate probability estimation
  - `trajectory.terminal_state_identification`: Initial and terminal state (macrostate) identification
- **Reads**: `layers/Ms`, `layers/velocity`, `obsp/connectivities`, `obsm/X_pca`, `obsm/X_umap`, `var/velocity_genes`
- **Writes**: `obsp/velocity_graph`, `obsp/transition_matrix`, `obsm/velocity_umap`, `uns/velocity_graph_params`
<!-- CHAINING:AUTO:END -->

Belongs to the RNA velocity workflow after kinetics and neighbour construction, and feeds the fate and terminal-state recipes of trajectory analysis.

## 10. Risks, pitfalls and open questions

- Gorin 2022 [R4] and the 2026 benchmark [R13] are cited from publisher record pages and the benchmark README, not from their full texts; no number in this document depends on those texts, and the benchmark's per-task rankings are excluded. Marot-Lassauzaie 2022 [R11] is cited from its title and bibliographic record.
- The per-dataset cluster-transition lists that define the CBDir edges are not stated in the benchmark repository; the VeloEV tutorial shows one example list. B1 is blocked until each list is fixed from the dataset annotation.
- Licences and sizes of Data 1 to 4 are absent from the benchmark README, which lists a Zenodo bundle (doi:10.5281/zenodo.18051944) whose contents are not stated here. The eight simulated scenarios are excluded because their generator and planted edges are not stated. The lineage-barcode check is deferred, because the Weinreb 2020 accession and barcode table location [R12], and barcode availability in the LUAD lineage data (Data 12), are not stated.
- Unsettled: whether direction in a velocity-derived graph encodes time for transient or multi-lineage data [R2][R3][R14]; the sensitivity to kernel and embedding choices has no accepted threshold [R4]; scVelo's defaults for negative cosines differ between its transition matrix and projection, and singlet's single setting is a design choice.
- Code: the velocyto.py README states that the repository is no longer maintained, so its kernel is ported for reproduction only. Line numbers come from corpus copies without commit metadata for scVelo, CellRank, velocyto, VeloVAE, UniTVelo and scvi-tools, so they are not tied to the commit identifiers in section 12. VeloEV's licence file carries a copyright line that does not match its authors; the MIT licence is the one both files state.
- First experiment: compute B1 and B3 on Data 1 with the four ported kernels at the generated defaults, together with the sign-reversal check, before any model-based scorer is designed. This sets the reference values that the scorer must beat.

## 11. References

R1. La Manno G, Soldatov R, Zeisel A, et al. RNA velocity of single cells. *Nature* 2018. doi:10.1038/s41586-018-0414-6 — partial (corpus)
R2. Bergen V, Lange M, Peidli S, Wolf FA, Theis FJ. Generalizing RNA velocity to transient cell states through dynamical modeling. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0591-3 — partial (corpus)
R3. Bergen V, Soldatov RA, Kharchenko PV, Theis FJ. RNA velocity—current challenges and future perspectives. *Molecular Systems Biology* 2021. doi:10.15252/msb.202110282 — partial (corpus)
R4. Gorin G, Fang M, Chari T, Pachter L. RNA velocity unraveled. *PLoS Computational Biology* 2022;18(9):e1010492. doi:10.1371/journal.pcbi.1010492 — partial (search)
R5. Lange M, Bergen V, Klein M, et al. CellRank for directed single-cell fate mapping. *Nature Methods* 2022. doi:10.1038/s41592-021-01346-6 — partial (corpus)
R6. Weiler P, Lange M, Klein M, Pe'er D, Theis F. CellRank 2: unified fate mapping in multiview single-cell data. *Nature Methods* 2024. doi:10.1038/s41592-024-02303-9 — partial (corpus)
R7. Qiu X, Zhang Y, Martin-Rufino JD, et al. Mapping transcriptomic vector fields of single cells. *Cell* 2022. doi:10.1016/j.cell.2021.12.045 — partial (corpus)
R8. Gayoso A, Weiler P, Lotfollahi M, et al. Deep generative modeling of transcriptional dynamics for RNA velocity analysis in single cells. *Nature Methods* 2024. doi:10.1038/s41592-023-01994-w — partial (corpus)
R9. Gao M, Qiao C, Huang Y. UniTVelo: temporally unified RNA velocity reinforces single-cell trajectory inference. *Nature Communications* 2022. doi:10.1038/s41467-022-34188-7 — partial (repo)
R10. Gu Y, Blaauw D, Welch J. Variational mixtures of ODEs for inferring cellular gene expression dynamics. arXiv 2022. doi:10.48550/arXiv.2207.04166 — partial (corpus)
R11. Marot-Lassauzaie V, Bouman BJ, Donaghy FD, et al. Towards reliable quantification of cell state velocities. *PLoS Computational Biology* 2022. doi:10.1371/journal.pcbi.1010031 — partial (corpus)
R12. Weinreb C, Rodriguez-Fraticelli A, Camargo FD, Klein AM. Lineage tracing on transcriptional landscapes links state to fate during differentiation. *Science* 2020. doi:10.1126/science.aaw3381 — partial (corpus)
R13. Wu Y, Kong C, Liao X, Lin Z, Sun X, Liu J. Comprehensive benchmarking of RNA velocity methods across single-cell datasets. *Genome Biology* 2026;27(1):242. doi:10.1186/s13059-026-04182-z — partial (repo)
R14. Single-cell best practices, RNA velocity chapter (keytakeaways). Single-cell best practices book, version 0.2.0; 2026. — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/scvelo (HEAD f63c0e7) | Volker Bergen, Philipp Weiler (authors); Philipp Weiler (maintainer) | BSD 3-Clause (LICENSE) | Cosine graph, transition matrix and embedding | port |
| https://github.com/theislab/cellrank (HEAD d7821af) | Marius Lange, Michal Klein, Philipp Weiler (authors); Marius Lange, Philipp Weiler (maintainers) | BSD 3-Clause (LICENSE) | VelocityKernel deterministic model | port |
| https://github.com/velocyto-team/velocyto.py (HEAD 56efe89) | Linnarsson Lab (setup.py author); Peter Kharchenko, Sten Linnarsson, Gioele La Manno (LICENSE copyright) | BSD 2-Clause (LICENSE) | Correlation kernel and embedding shift | port, for reproduction only (unmaintained) |
| https://github.com/aristoteleo/dynamo-release (HEAD 08904e1) | Xiaojie Qiu, Yan Zhang, Ke Ni (setup.py authors); dynamo team | BSD 3-Clause (LICENSE) | Pearson kernel and density-corrected projection | port |
| https://github.com/welch-lab/VeloVAE (HEAD 834f9f2) | Yichen Gu (setup.cfg author) | BSD 3-Clause (LICENSE) | Cross-boundary reference code | callout |
| https://github.com/StatBiomed/UniTVelo (HEAD c7e9419) | Mingze Gao (setup.py author) | BSD 3-Clause (LICENSE) | Velocity source and comparator | callout |
| https://github.com/scverse/scvi-tools (HEAD 5555ecc) | scvi-tools development team (pyproject) | BSD 3-Clause (LICENSE) | VeloVI comparator | callout |
| https://github.com/edawu11/VeloEV (HEAD 719aafa) | Yida Wu (setup.py author) | MIT (LICENCE; setup.py) | CBDir and ICVCoh definitions | port (metric code) |
| https://github.com/edawu11/Benchmark-RNA-Velocity (HEAD b8bc131) | Yida Wu, Chuihan Kong, Xu Liao, Zhixiang Lin, Xiaobo Sun, Jin Liu (article authors, README) | MIT (LICENSE) | Dataset identifiers and benchmark design | callout |
| https://github.com/theislab/single-cell-best-practices (HEAD d581689) | Chapter authors as listed in the repository | Apache License 2.0 (LICENSE) | Keytakeaways text | callout (citation) |
