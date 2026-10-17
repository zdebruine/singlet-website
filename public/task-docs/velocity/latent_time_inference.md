---
id: velocity.latent_time_inference
title: Latent time and temporal ordering from splicing dynamics
area: velocity
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.spliced_unspliced_counting, velocity.velocity_gene_selection, velocity.gene_kinetics_velocity_estimation, trajectory.root_identification]
feeds: [trajectory.pseudotime_ordering, trajectory.pseudotime_de, trajectory.gene_switch_timing]
reads: [layers/spliced, layers/unspliced, obsp/connectivities, obs/root_flag, layers/fit_t]
writes: [obs/latent_time, obs/latent_time_<method>, obs/latent_time_confidence, layers/fit_t, uns/latent_time_params, models/latent_time_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_velocity_latent_time_inference
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Latent time and temporal ordering from splicing dynamics

> Assigns each cell a latent time on one shared clock from fitted splicing kinetics, and checks the cell ordering against planted or recorded time.

## 1. Question

Where does each cell lie along a differentiation or response process, as implied by the splicing kinetics of its genes? Inputs are raw spliced and unspliced counts, a kNN graph and one root cell that marks the start of the process. Outputs are a per-cell latent time on a shared scale and, for kinetic methods, gene-wise fitted times. A correct answer ranks cells as the true process does and places the start at the root. The absolute scale is a convention, so correctness is a claim about ranks.

## 2. Why this task matters and where the field stands

RNA velocity gives each cell a direction of change, not its position along the process. Latent time supplies that position, and the steps that follow (pseudotime ordering, pseudotime differential expression, gene switch timing) use it as their time axis. The task is **contested**. In scVelo, each gene's kinetics are fitted by likelihood, and the gene-wise times are then coupled into one clock by a post hoc heuristic [R1]. UniTVelo [R2] and VeloVAE [R3] learn a shared time with the kinetic model, while velovi [R4] reduces per-gene posterior times to a cell value. A 2026 benchmark of RNA velocity methods [R5] is the closest published comparison. General trajectory benchmarks score topology and position on a graph, not time from kinetics [R6]. Kinetic assumptions fail when rates change during a process, as in erythroid maturation [R7], and the assumptions behind popular velocity tools are examined in [R8]. The challenges are reviewed in [R9]. The open problems are root dependence, the scale convention, shared versus gene-specific clocks, and uncalibrated uncertainty (section 10).

## 3. Theory and insight

Notation: $u_{gc}$ and $s_{gc}$ are unspliced and spliced counts of gene $g$ in cell $c$; $\alpha_g$, $\beta_g$ and $\gamma_g$ are transcription, splicing and degradation rates; $t^\star_c$ is planted process time; $t_{gc}$ is the gene-wise fitted time; $\hat t_c$ is the latent time; $r$ is the root cell. Within one kinetic phase the mean dynamics are [R10]

$$\frac{du}{dt}=\alpha-\beta u,\qquad \frac{ds}{dt}=\beta u-\gamma s,$$

and, from a state $(u_0,s_0)$ at the switch point, $\tau$ time units later,

$$u(\tau)=u_0e^{-\beta\tau}+\frac{\alpha}{\beta}\left(1-e^{-\beta\tau}\right),\qquad s(\tau)=s_0e^{-\gamma\tau}+\frac{\alpha}{\gamma}\left(1-e^{-\gamma\tau}\right)+\frac{\alpha-\beta u_0}{\gamma-\beta}\left(e^{-\gamma\tau}-e^{-\beta\tau}\right).$$

These are exact for constant rates after the switch. They describe means, not counts, so they hold where bursting does not dominate the RNA lifetimes. The third term of $s(\tau)$ is singular at $\gamma=\beta$, and implementations use a guarded inverse there.

Gene-wise times are referenced to the root cell:

$$t^{\rm root}_{gc}=\begin{cases}t_{gc}-t_{gr}, & t_{gc}\ge t_{gr}\\ t_{gc}+M_g, & t_{gc}<t_{gr}\end{cases}\qquad M_g=\max_{c':\,t_{gc'}\ge t_{gr}}\left(t_{gc'}-t_{gr}\right).$$

The shared clock is then built from percentiles over genes:

$$\tilde t_c=\frac{\sum_{q\in\mathcal Q^\star}P_q(c)/\max_{c'}P_q(c')}{\max_{c}\sum_{q\in\mathcal Q^\star}P_q(c)/\max_{c'}P_q(c')},\qquad \mathcal Q^\star=\operatorname*{argmin}_{\mathcal Q\subset\{15,\dots,35\},\,|\mathcal Q|=2}\ \sum_{q\in\mathcal Q}\sum_{i=1}^{n}\left(x^{(q)}_{(i)}-\tfrac{i-1}{n-1}\right)^2,$$

where $P_q(c)$ is the $q$-th percentile over genes of $t^{\rm root}_{gc}$ in cell $c$, and $x^{(q)}_{(i)}$ are the sorted, max-normalised profiles. The two profiles kept are those closest to uniform, so the scheme assumes that cells should be spread evenly along time. It has no likelihood, and kNN smoothing and the replacement of low-confidence cells follow it.

Model-based formulations fit the clock together with the kinetics. VeloVAE maximises the evidence lower bound

$$\log p_\theta(x)\ \ge\ \mathbb E_{q_\phi(t,z\mid x)}\!\left[\log p_\theta(x\mid t,z)\right]-\mathrm{KL}\!\left(q_\phi(t,z\mid x)\,\|\,p(t,z)\right),$$

where $t$ is a per-cell time and the decoder solves splicing ODEs [R3]. The regime is large $n$. The amortisation gap and decoder misspecification are not controlled, and the bound does not make the posterior over $t$ calibrated. velovi places a posterior over per-gene switch times and states [R4]. Its cell time is a reduction over genes, so the clock is shared only after that reduction.

Estimands, one sentence each:

- Latent time $\hat t_c$ is the method's cell clock. singlet rescales every method to $[0,1]$ over finite cells, or to $[0,t_{\max}]$ when $t_{\max}$ is set, and only its rank is claimed.
- Planted time $t^\star_c$ is the simulator's process time in simulator units. Rank metrics use it directly, and error metrics use its min–max scaling over the simulated cells.
- Gene-wise time $t_{gc}$ is the fitted time of cell $c$ on gene $g$'s own clock, before root alignment.
- Spearman rho is the Pearson correlation of average ranks of $\hat t_c$ and $t^\star_c$ over cells with finite $\hat t_c$.
- Coverage is the fraction of all cells with finite $\hat t_c$.

Insight:

- Rank is the only quantity the two families share. Spearman rho is invariant to any monotone transform, so a high value cannot show that the kinetics or the scale are right.
- The root fixes direction and zero. A wrong root reverses or shifts the scVelo output, and it reverses model-based output under the orientation rule of section 6, while the ranks can still look ordered.
- The shared-clock heuristic encodes an even spread of cells in time, which can misfit processes with dense and sparse phases.
- A joint objective puts the time scale and gene-wise consistency into one fit. That is the case for velovae as the default, and it has not been tested on data (sections 8 and 10).

Assumptions: constant rates within a phase; one clock across genes; an identifiable earliest state; a process time comparable to RNA half-lives; enough unspliced counts per gene.

Failure modes: genes with several kinetic transitions, where one fitted time conflates phases; changing kinetics [R7]; a wrong root; gene-set dependence, since the minimum-likelihood filter changes the percentile step; bursting; disconnected graphs without a root; initialisation sensitivity of the deep models; and UniTVelo's inheritance of scVelo's initial times. Smoothing is an unnormalised sparse product of the graph with latent time, so values scale with node degree before the final rescaling.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| scVelo dynamical latent time | hybrid | Per-gene ODE likelihood fit by EM; root-aligned gene times combined into a shared clock by percentile profiles and kNN smoothing | [R1] |
| UniTVelo unified time | model-based | Gaussian base transcription per gene, with a time coordinate learned jointly across genes in unified mode | [R2] |
| VeloVAE | model-based | VAE whose decoder solves splicing ODEs, with a per-cell latent time and per-gene Dirichlet gene-mode priors | [R3] |
| velovi | model-based | VAE with a posterior over per-gene switch times and states; per-gene times are the expected (`mean`) or most-probable-state (`max`) time | [R4] |
| Velocity pseudotime | heuristic | Diffusion pseudotime on the velocity graph from a root cell; scVelo function | — |

scVelo's dynamical latent time is the heuristic comparator: UniTVelo starts from it, and the acceptance test in section 8 is set relative to it. Velocity pseudotime is a kinetics-aware baseline, which scVelo also blends into latent time when `weight_diffusion` is set. UniTVelo, VeloVAE and velovi are the model-based alternatives, and their advantages are unsettled (section 10). Diffusion pseudotime and Monocle 3, the kinetics-free comparators, are omitted (section 10).

Defaults of the methods that singlet ports, with source locations:

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| scVelo | recover_dynamics max_iter | 10 | scvelo/tools/_em_model_core.py:405 @ f63c0e7 |
| scVelo | recover_dynamics t_max | None | scvelo/tools/_em_model_core.py:407 @ f63c0e7 |
| scVelo | recover_dynamics fit_time, fit_scaling, fit_steady_states | True, True, True | scvelo/tools/_em_model_core.py:408–410 @ f63c0e7 |
| scVelo | latent_time min_likelihood | 0.1 | scvelo/tools/_em_model_core.py:782 @ f63c0e7 |
| scVelo | latent_time min_confidence | 0.75 | scvelo/tools/_em_model_core.py:783 @ f63c0e7 |
| scVelo | latent_time min_corr_diffusion, weight_diffusion, t_max | None, None, None | scvelo/tools/_em_model_core.py:784–788 @ f63c0e7 |
| scVelo | align_dynamics mode; t_max when None | align_total_time; 20 | scvelo/tools/_em_model_core.py:733 @ f63c0e7 |
| scVelo | shared-time percentile set | 15, 20, 25, 30, 35; two kept | scvelo/tools/_em_model_utils.py:82–101 @ f63c0e7 |
| scVelo | min–max scaling | [0, 1] | scvelo/tools/utils.py:82 @ f63c0e7 |
| scVelo | velocity_pseudotime n_dcs; use_velocity_graph | 10; True | scvelo/tools/velocity_pseudotime.py:147–148 @ f63c0e7 |
| UniTVelo | FIT_OPTION (unified time) | '1' | unitvelo/config.py:51 @ c7e9419 |
| UniTVelo | LEARNING_RATE | 1e-2 | unitvelo/config.py:42 @ c7e9419 |
| UniTVelo | MAX_ITER | 12000 | unitvelo/config.py:44 @ c7e9419 |
| UniTVelo | BASE_FUNCTION | 'Gaussian' | unitvelo/config.py:125 @ c7e9419 |
| UniTVelo | AGENES_THRES | 0.61 | unitvelo/config.py:87 @ c7e9419 |
| UniTVelo | REG_TIMES | 0.075 | unitvelo/config.py:30 @ c7e9419 |
| UniTVelo | RESCALE_TIME | False | unitvelo/config.py:67 @ c7e9419 |
| UniTVelo | latent-time initialisation | scv.tl.latent_time(adata, min_likelihood=None) | unitvelo/velocity.py:284 @ c7e9419 |
| VeloVAE | gene-mode Dirichlet std_prior | 0.1 | velovae/model/model_util.py:977, 991 @ 834f9f2 |
| VeloVAE | gene-mode prior means (neutral, induction, repression) | 0.5, 0.6, 0.4 | velovae/model/model_util.py:1011, 1017 @ 834f9f2 |
| velovi | get_latent_time time_statistic | 'mean' | src/scvi/external/velovi/_model.py:317 @ 5555ecc |
| velovi | get_latent_time n_samples | 1 | src/scvi/external/velovi/_model.py:318 @ 5555ecc |

## 5. Proposed singlet approach

All five methods are ported. Licences are in section 12, and the port route is the same for each because none is copyleft or unlicensed. UniTVelo is re-expressed from TensorFlow in PyTorch, and velocity pseudotime follows the scVelo code path.

The default is **velovae**. It is the model-based method whose objective already contains one per-cell time shared by all genes, which is the clock singlet proposes, and it is written in PyTorch, which singlet uses for models. Agents use the defaults in the tool definition and must supply a root. The default is replaced by scvelo_dynamical if, on B1 under the true root, the median rho of velovae on S1 is more than 0.05 below that of scvelo_dynamical.

The proposed model is a shared-clock variational model. Each cell has a time with a variational posterior, the closed-form kinetics of section 3 are evaluated at the decoded time, and the posterior standard deviation is written to `obs/latent_time_confidence`. A normal 90% interval derived from it is tested in B1. If its miscalibration exceeds 0.05 on S1, the interval is dropped and the output is reported without it.

The ML stack uses PyTorch for the variational model and its ELBO. Only three small, hot kernels are hard-coded in CUDA or cuSPARSE: the closed-form $u(\tau)$ and $s(\tau)$ over a grid of switch times, element-wise over genes and cells; kNN smoothing as a sparse matrix-vector product; and per-cell percentiles over genes as a segmented sort. The VAE is neither small nor hot enough to justify a hand-written kernel.

Devices are CPU for the scvelo and velocity-pseudotime paths and CUDA for velovae and velovi, with CPU fallback. Streaming is not claimed, because the shared step and smoothing need all cells. Defaults an agent should use without asking: method velovae, device auto, seed 0, scvelo options at their section 4 values, velovae `std_prior` 0.1 and `n_epochs` null.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/spliced | sparse int | raw spliced counts |
| read | layers/unspliced | sparse int | raw unspliced counts |
| read | obsp/connectivities | sparse float | kNN graph used by the shared-time smoothing |
| read | obs/root_flag | bool | single TRUE start cell (column named by `root`) |
| read | layers/fit_t | float32 | gene-wise times from an earlier kinetic fit, when present |
| write | obs/latent_time | float32 | latent time in [0, 1], or [0, t_max] when set; NaN where not estimated |
| write | obs/latent_time_<method> | float32 | the same quantity for each method, kept for comparison |
| write | obs/latent_time_confidence | float32 | scVelo tl_conf; posterior standard deviation for velovae and velovi; NaN otherwise |
| write | layers/fit_t | float32, cells × genes | gene-wise fitted times from scvelo_dynamical and velovi |
| write | uns/latent_time_params | dict | method, root, t_max, thresholds, retained gene count, seed, library versions |
| write | models/latent_time_<method> | model | trained weights for velovae and velovi only |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "velovae" | `velovae`, `scvelo_dynamical`, `unitvelo`, `velovi`, `velocity_pseudotime` | velovae is the model-based default; scvelo_dynamical is the published heuristic standard and the fallback. |
| `root` | string | required | — | obs column with one TRUE start cell, or a cell identifier. Required: the tool never infers a root. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for initialisation and minibatch order in the deep methods. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `scvelo` | object | — | — | Options for scvelo_dynamical; ignored by other methods. |
| `scvelo.min_likelihood` | number/null | 0.1 | min 0; max 1 | Minimum gene fit likelihood for genes entering the shared-time step; null keeps all fitted genes. |
| `scvelo.min_confidence` | number | 0.75 | min 0; max 1 | Cells with confidence below this are replaced by neighbour sums during smoothing. |
| `scvelo.t_max` | number/null | null | min 0 | Overall duration that multiplies the [0,1] latent time; null keeps the [0,1] scale. |
| `scvelo.weight_diffusion` | number/null | null | min 0; max 1 | Weight w blending latent time with velocity pseudotime: (1 - w) latent + w pseudotime. |
| `scvelo.min_corr_diffusion` | number/null | null | min -1; max 1 | Keep genes whose fitted time correlates with velocity pseudotime at or above this value. |
| `scvelo.recover_max_iter` | integer | 10 | min 1 | Maximum EM iterations in the dynamical-model fit. |
| `scvelo.fit_time` | boolean | true | — | Fit switch times in the dynamical model. |
| `scvelo.fit_scaling` | boolean | true | — | Fit unspliced and spliced scaling in the dynamical model. |
| `scvelo.fit_steady_states` | boolean | true | — | Fit steady-state parameters in the dynamical model. |
| `unitvelo` | object | — | — | Options for unitvelo; ignored by other methods. |
| `unitvelo.fit_option` | string | "1" | — | '1' selects unified-time mode; '2' selects independent mode. |
| `unitvelo.max_iter` | integer | 12000 | min 1 | Training iterations. |
| `unitvelo.learning_rate` | number | 0.01 | > 0 | Optimiser learning rate. |
| `unitvelo.base_function` | string | "Gaussian" | `Gaussian` | Base transcription function; Gaussian is the only form ported. |
| `velovae` | object | — | — | Options for velovae; ignored by other methods. |
| `velovae.std_prior` | number | 0.1 | min 0 | Standard deviation of the gene-mode Dirichlet prior. |
| `velovae.n_epochs` | integer/null | null | min 1 | Training epochs; null uses the implementation default. |
| `velovi` | object | — | — | Options for velovi; ignored by other methods. |
| `velovi.time_statistic` | string | "mean" | `mean`, `max` | mean: expected time over the state distribution; max: time of the most probable state. |
| `velovi.n_samples` | integer | 1 | min 1 | Posterior samples used for the latent-time summary. |
| `velocity_pseudotime` | object | — | — | Options for velocity_pseudotime; ignored by other methods. |
| `velocity_pseudotime.n_dcs` | integer | 10 | min 1 | Diffusion components used for the pseudotime. |
| `velocity_pseudotime.use_velocity_graph` | boolean | true | — | Diffuse on the velocity graph (true) or on a similarity kernel (false). |
<!-- PARAMS:AUTO:END -->

The root is required, and the tool never infers one. For model-based methods it also fixes orientation: after fitting, the time is reversed when the root cell has above-median time. `scvelo.min_likelihood` removes genes before the shared step, so the retained gene count is written to `uns/latent_time_params`. The latent_time docstring mentions a 20-hour prior, but latent_time applies `t_max` only when it is set; the 20 is set in align_dynamics (section 4). `velovi.n_samples` sets how many posterior draws enter the summary, and one draw gives a noisy estimate.

## 7. MCP tool

Tool `singlet_velocity_latent_time_inference` (definition in `tasks/mcp/singlet_velocity_latent_time_inference.json`). Example call and result:

```json
{"dataset": "data/sim_s1.singlet", "root": "root_flag"}
```

```json
{"dataset": "data/sim_s1.singlet", "status": "completed",
 "wrote": ["obs/latent_time", "obs/latent_time_velovae", "obs/latent_time_confidence", "models/latent_time_velovae"],
 "summary": {"method": "velovae", "root": "root_flag", "coverage": "<float>", "time_scale": "minmax", "n_genes_used": "<int>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: velovae and velovi train on CUDA when it is available and return `queued` with a `job_id` above a size threshold set in the configuration. Stochastic: `seed` fixes initialisation and minibatch order for the deep methods. Dry run: returns `seconds`, `peak_memory_gb` and `device`, and writes nothing.

## 8. Benchmarks

All methods receive the same counts, a kNN graph with k = 30 (proposed), the same root and the same 2,000 genes (proposed). Each method uses its section 4 defaults and the defaults of the tool definition. Latent time is taken after each method's own rescaling and then rescaled by singlet as in section 3. A failed fit scores rho = 0, sign agreement = 0 and coverage = 0 for that seed, so failures are not dropped. Every simulation uses seeds 0 to 19, and results are reported per scenario and root arm. Simulators such as dyngen [R11] are not used, because their true-time and splicing outputs are not documented here (section 10).

### B1. Planted-time kinetic simulation (proposed)

- **Goal**: test whether latent time ranks cells as planted time does, in four kinetic regimes, with true and wrong roots.
- **Ground truth**: planted simulation; the estimand is the rank of $t^\star_c$, known exactly. Recipe:
  1. Draw $t^\star_c\sim U(0,1)$ for 2,000 cells; in S3, time runs along a tree with one fork, scaled to $[0,1]$.
  2. Draw $\alpha_g,\beta_g,\gamma_g$ log-uniformly over configured ranges. S1 and S3 switch each gene on at $\tau_g$ (S3: one branch only); S2 adds a switch-off at $\tau'_g>\tau_g$.
  3. Set means by the section 3 solutions at $t^\star_c$; S4 uses a two-state telegraph process instead.
  4. Draw negative-binomial counts with configured size factors and dispersion.
  5. $r_{\rm true}$ is the cell with least $t^\star$; $r_{\rm wrong}$ is a random cell in its top quartile.
- **Datasets**

| Dataset | Source | Modality, size | License | Notes |
|---|---|---|---|---|
| S1 induction | Recipe 1–5; kinetics [R10] | simulated counts; 2,000 cells; seeds 0–19 | — | Circular for scvelo_dynamical and velovae |
| S2 multi-phase | Recipe 1–5 | as S1 | — | Breaks the single switch |
| S3 bifurcating | Recipe 1–5 | as S1 | — | One clock, two branches |
| S4 bursty | Recipe 1–5; bursts | as S1 | — | Breaks the mean-ODE approximation |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Spearman rho | Pearson correlation of average ranks over finite cells | maximise | primary | — |
| Sign agreement | Fraction of seeds with rho > 0 under $r_{\rm true}$ | maximise | guardrail | — |
| Kendall tau-b | Tie-corrected statistic on the same cells | maximise | guardrail | — |
| Coverage | Fraction of cells with finite $\hat t_c$ | maximise | guardrail | — |
| Interval miscalibration | $\lvert 0.9 - \text{coverage}\rvert$ of scaled $t^\star_c$ by 90% intervals; model-based only | minimise | guardrail | — |

- **Comparators**: the five methods at section 4 defaults, each with $r_{\rm true}$ and $r_{\rm wrong}$.
- **Protocol**: median and interquartile range of rho per scenario and root arm; no tuning on simulations.
- **Acceptance criterion**: proposed, not from the literature. On S1 with $r_{\rm true}$, velovae median rho ≥ 0.9 and at most 0.05 below scvelo_dynamical (section 5); sign agreement ≥ 0.95 on S1 and S3; interval miscalibration ≤ 0.05 on S1.
- **Known pitfalls**:
  - S1 favours ODE-based methods, so S2 to S4 carry the out-of-assumption evidence.
  - Spearman is unchanged by any monotone rescaling, so the scale convention and $t_{\max}$ are not tested.

### P1. Performance and scaling

Measure wall time, peak resident memory and throughput at 10k, 100k and 1M cells on CPU and CUDA, for each method against scvelo_dynamical, on the S1 generator with 2,000 genes. Expected cost from the code paths: the gene-wise fit is iterative per gene, the shared step costs $O(ng)$ for percentiles over genes, and smoothing costs $O(nk)$ per iteration. Hold fixed the gene count, the iteration caps at their section 4 defaults, the thread count, the hardware and the time limit in the configuration. Time the gene-wise fit and the shared step separately, exclude I/O, and record the GPU model. Proposed acceptance: the shared step is linear in cells, and velovae completes 1M cells on one CUDA device within the time limit.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.spliced_unspliced_counting`: Spliced, unspliced and ambiguous molecule counting
  - `velocity.velocity_gene_selection`: Velocity gene selection and steady-state assumption check
  - `velocity.gene_kinetics_velocity_estimation`: Per-gene kinetics and RNA velocity estimation from spliced and unspliced counts
  - `trajectory.root_identification`: Root or start-state identification
- **Feeds**:
  - `trajectory.pseudotime_ordering`: Pseudotime ordering along a lineage
  - `trajectory.pseudotime_de`: Pseudotime-associated and lineage-specific differential expression
  - `trajectory.gene_switch_timing`: Gene expression shape classes and switch timing along pseudotime
- **Reads**: `layers/spliced`, `layers/unspliced`, `obsp/connectivities`, `obs/root_flag`, `layers/fit_t`
- **Writes**: `obs/latent_time`, `obs/latent_time_<method>`, `obs/latent_time_confidence`, `layers/fit_t`, `uns/latent_time_params`, `models/latent_time_<method>`
<!-- CHAINING:AUTO:END -->

This task follows kinetic fitting, velocity gene selection and root identification, and supplies the time axis for the pseudotime analyses.

## 10. Risks, pitfalls and open questions

- **Source metadata.** VeloVAE's setup files disagree on version (0.1.3-beta in setup.cfg, 0.1.4 in setup.py). UniTVelo's Gaussian base function (mean `t`, `log_a`, `log_h`; `unitvelo/optimize_utils.py:63–67`) is defined only in code, so its closed form is derived from that code. VeloVAE's training defaults (epochs, learning rate, time prior) are not stated in the code paths used here, so the velovae block defaults are singlet proposals.
- **Benchmark data.** No dataset with spliced and unspliced layers and recorded time at three or more collection times is identified here, so rank concordance with recorded time is not a benchmark. The scVelo pancreas dataset (`endocrinogenesis_day15.h5ad`) is documented as embryonic day 15.5 in the study of Bastidas-Ponce et al. [R12] and holds one collection day. The benchmark repository [R14] lists 34 datasets (26 real, 8 simulated, per its README), but its latent-time evaluation code and per-dataset files are not described here. A 2026 bioRxiv preprint [R13] covers 29 algorithms on 114 simulated datasets with known ground-truth cell dynamics and 62 real datasets; its time truth is not described here.
- **Conflicting and unsettled claims.** The VeloVAE repository's evaluation modules reference DeepVelo, veloVI and cellDancer; the published comparison numbers are not reproduced here. The latent-time metric of the 2026 benchmark [R5] is not described in its repository README. SDEvelo, a multivariate stochastic model with cell-specific latent time, is left out of the comparator set.
- **Circularity and comparators.** Agreement with a heuristic pseudotime that shares the graph and root is not an accuracy measure, so no such benchmark is published. Diffusion pseudotime and Monocle 3, the kinetics-free comparators, are excluded from the enum and the comparator lists because no defaults are recorded here.
- **Uncertainty.** scVelo's tl_conf is computed but not stored upstream. Posterior spreads from velovae and velovi have not been checked for interval coverage, and the interval test in B1 is the first such check.
- **First experiment.** Simulate S1 and S4 at 2,000 cells with the B1 recipe, fit scvelo_dynamical and velovae at their defaults with the true root, and measure rho, sign agreement and interval miscalibration before any CUDA work.

## 11. References

R1. Bergen V, Lange M, Peidli S, Wolf FA, Theis FJ. Generalizing RNA velocity to transient cell states through dynamical modeling. *Nature Biotechnology* 2020. doi:10.1038/s41587-020-0591-3 — verified (corpus)
R2. Gao M, Qiao C, Huang Y. UniTVelo: temporally unified RNA velocity reinforces single-cell trajectory inference. *Nature Communications* 2022. doi:10.1038/s41467-022-34188-7 — partial (corpus)
R3. Gu Y, Blaauw D, Welch JD. Bayesian inference of RNA velocity from multi-lineage single-cell data. *bioRxiv* 2022. doi:10.1101/2022.07.08.499381 — verified (corpus)
R4. Gayoso A, Weiler P, Lotfollahi M, Klein D, Hong J, Streets AM, Theis FJ, Yosef N. Deep generative modeling of transcriptional dynamics for RNA velocity analysis in single cells. *Nature Methods* 2024. doi:10.1038/s41592-023-01994-w — verified (corpus)
R5. Wu Y, Kong C, Liao X, Lin Z, Sun X, Liu J. Comprehensive benchmarking of RNA velocity methods across single-cell datasets. *Genome Biology* 2026;27(1):242. — partial (repo)
R6. Saelens W, Cannoodt R, Todorov H, Saeys Y. A comparison of single-cell trajectory inference methods. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0071-9 — verified (corpus)
R7. Barile M, Imaz-Rosshandler I, Inzani I, Ghazanfar S, Nichols J, Marioni JC, Guibentif C, Göttgens B. Coordinated changes in gene expression kinetics underlie both mouse and human erythroid maturation. *Genome Biology* 2021. doi:10.1186/s13059-021-02414-y — verified (corpus)
R8. Gorin G, Fang M, Chari T, Pachter L. RNA velocity unraveled. *PLOS Computational Biology* 2022;18(9):e1010492. doi:10.1371/journal.pcbi.1010492 — verified (search)
R9. Bergen V, Soldatov RA, Kharchenko PV, Theis FJ. RNA velocity—current challenges and future perspectives. *Molecular Systems Biology* 2021. doi:10.15252/msb.202110282 — verified (corpus)
R10. La Manno G, Soldatov R, Zeisel A, Braun E, Hochgerner H, Petukhov V, et al. RNA velocity of single cells. *Nature* 2018. doi:10.1038/s41586-018-0414-6 — verified (corpus)
R11. Cannoodt R, et al. Spearheading future omics analyses using dyngen, a multi-modal simulator of single cells. *Nature Communications* 2021. doi:10.1038/s41467-021-24152-2 — partial (corpus)
R12. Bastidas-Ponce A, Tritschler S, Dony L, Scheibner K, Tarquis-Medina M, Salinno C, et al. Comprehensive single cell mRNA profiling reveals a detailed roadmap for pancreatic endocrinogenesis. *Development* 2019. doi:10.1242/dev.173849 — verified (corpus)
R13. Benchmarking algorithms for RNA velocity inference. *bioRxiv* 2026. doi:10.64898/2026.01.03.697314 — partial (search)
R14. Source code to reproduce the benchmark results of RNA velocity methods presented in the paper 'Comprehensive benchmarking of RNA velocity methods across single-cell datasets'. *GitHub repository* 2025. https://github.com/edawu11/Benchmark-RNA-Velocity — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/theislab/scvelo | Volker Bergen, Philipp Weiler (authors); Philipp Weiler (maintainer) | BSD-3-Clause (LICENSE file) | scVelo dynamical latent time; velocity pseudotime | port |
| https://github.com/StatBiomed/UniTVelo | Mingze Gao (setup.py author; CITATION.cff) | BSD-3-Clause (LICENSE file) | Unified-time model; initialisation from scVelo | port (TensorFlow to PyTorch) |
| https://github.com/welch-lab/VeloVAE | Yichen Gu (setup.py, setup.cfg) | BSD-3-Clause (LICENSE file; setup.cfg) | ODE-decoder VAE with latent time | port |
| https://github.com/scverse/scvi-tools (src/scvi/external/velovi) | scverse maintainers | BSD-3-Clause (LICENSE file) | VAE over switch times; posterior latent time | port |
| https://github.com/edawu11/Benchmark-RNA-Velocity | WU Yida (LICENSE copyright holder) | MIT (LICENSE file) | Benchmark datasets and evaluation code (section 10) | callout |
