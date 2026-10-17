---
id: ambient.profile_estimation
title: Ambient profile estimation
area: ambient
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.umi_deduplication, cell-calling.cell_vs_empty_droplet_calling]
feeds: [ambient.count_removal]
reads: [raw/counts, obs/is_cell, obs/<sample_key>, obs/<cluster_key>]
writes: [varm/ambient_profile_<sample>, uns/ambient_profile_meta/<sample>, obs/ambient_p_nonempty, models/ambient_profile_<method>]
devices: [cpu, cuda]
mcp_tool: singlet_ambient_profile_estimation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Ambient profile estimation

> Estimate, for each channel, the gene composition of the cell-free RNA that its droplets capture, with channel-level uncertainty where the method provides it.

## 1. Question

Given the raw droplet-by-gene UMI matrix of one channel, empty droplets included, and optionally cell calls and cluster labels, what probability vector over genes describes the cell-free RNA captured in that channel? A correct answer is the composition of ambient molecules at the observed capture scale, normalised over the analysed genes. Per-barcode ambient fractions and count removal are separate tasks (`ambient.contamination_fraction`, `ambient.count_removal`).

## 2. Why this task matters and where the field stands

Droplets capture RNA released by lysed cells in the suspension, together with each cell's own transcripts. The shared background makes unexpressed genes look expressed and pulls cells toward the wrong clusters. Which genes are contaminated depends on the composition of the background, not only on its total. The SoupX README states that the contamination profile is experiment specific and produces a batch effect (`constantAmateur/SoupX`, README), which is why most methods estimate one profile per channel.

The task is **contested**. Methods differ in which droplets or features they assume contain no cell signal (a low-UMI window, droplets labelled cell-free by a multinomial test, or other clusters), and in whether the profile is fitted alone or jointly with the cell model. Janssen et al. pooled two mouse subspecies so that cross-genotype reads act as a background truth, and reported that CellBender gave the most precise background estimates among CellBender, DecontX and SoupX [R6]. Cargnelli et al. compared seven tools on simulated, species-mixing and genotype-mixing data and found no single best method, with CellBender, DecontX and SoupX generally performing well [R7].

Open problems:

- **Truth is scarce and mixed.** Genotype and species mixing count ambient RNA together with barcode swapping and doublets [R6][R7], so no design isolates the profile alone.
- **Pool purity.** A profile is identifiable only through droplets or features assumed free of cell signal. Partly captured or damaged cells in that pool inflate their own genes [R1][R3].
- **Model choice.** Pooling and cluster-based profiles are fast but fix their assumptions in the estimator. Joint models fit the profile together with the cell model and return it as a point estimate [R2].

## 3. Theory and insight

Each droplet $i$ holds $N_i$ UMIs drawn from a mixture of the channel's ambient composition and the droplet's native composition:

$$\mathbb{E}[x_{gi}] = N_i\left[\rho_i\,\pi_g + (1-\rho_i)\,\theta_{gi}\right],\qquad \sum_g \pi_g=\sum_g\theta_{gi}=1.$$

Here $x_{gi}$ is the UMI count of gene $g$ in droplet $i$, $\rho_i$ the ambient share of the droplet (equal to 1 for an empty droplet), $\pi$ the channel profile to be estimated, and $\theta_{\cdot i}$ the native composition, that is the cell's own profile. The form holds to first order, in the multinomial or Poisson regime with large $N_i$. It assumes that ambient and native molecules are captured with the same gene-specific efficiency, and it does not model gene-specific capture differences between them.

**Estimands.** Each output and truth is normalised as follows.

- The profile $\hat\pi$ estimates the probability that a cell-free molecule in the channel is gene $g$, normalised over the analysed genes; every profile is renormalised over the same gene set before any comparison.
- The CellBender ambient vector is the same quantity, fitted as a simplex-constrained parameter over the analysed genes.
- The per-droplet output $\hat p_i$ of joint methods is the model probability that droplet $i$ holds a cell; it lies in $[0,1]$ and is not an ambient fraction.
- The B1 truth $\pi^{\star}$ is the composition of foreign-subspecies UMIs over informative genes, normalised over those genes (section 8).
- The B2 truth $\pi^{\star}$ is the expected composition of ambient UMIs at the observed capture scale, normalised over all genes (section 8).

**Estimators.** Each family states its identifying assumption in a different place.

*Pooled soup (SoupX).* Pool the raw counts of droplets with totals in an open window and normalise: $\hat\pi_g=\sum_{i\in W}x_{gi}/\sum_{i\in W}N_i$, with $W=\{i:0<N_i<100\}$. This is the multinomial maximum-likelihood profile when every droplet in $W$ is pure ambient. If a fraction $\kappa$ of the pooled UMIs come from cells with composition $\theta_W$, the expected pooled composition is $(1-\kappa)\pi+\kappa\theta_W$. The bias is therefore first order in the cell share of the pool, a consequence of the model above that holds in the same regime. SoupX's global fraction model (`R/calculateContaminationFraction.R:40-64` @ 8d89492) fits an intercept-only Poisson glm with offset $\log(N_i\pi_S)$ to the counts of gene sets $S$ in the cells where each set is assumed silent, giving $\hat\rho=\sum_i c_{S,i}/\sum_i N_i\pi_S$, where $c_{S,i}$ is the UMI count of set $S$ in cell $i$ and $\pi_S=\sum_{g\in S}\pi_g$. The fraction therefore depends on the profile through $\pi_S$, so the two estimates are coupled.

*Cell-free test (scAR).* A droplet is labelled cell-free when its multinomial log-probability under the current profile reaches $G\log p_0$, where $G$ is the number of features and $p_0$ the threshold (default 0.995). The profile is re-estimated from the labelled droplets for a fixed number of rounds. The threshold is a coded rule, not a calibrated test; it is inspired by the multinomial sampling assumption of EmptyDrops [R5] and documented in the scvi-tools guide [R9]. In the scAR variational model the profile is a fixed input (`amb_prob`): the expected ambient count of gene $g$ in droplet $n$ is $N_n r_n \pi_g$, where $N_n$ is the droplet total and $r_n$ a per-droplet noise ratio from the decoder (`scar/main/_vae.py:138-144` @ df7adef).

*Joint model (CellBender).* Empty droplets follow $\lambda_{gn}=\epsilon_n d^{\rm empty}_n\chi^{\rm amb}_g$, where $\epsilon_n$ is a per-droplet scale, and cell droplets add their own signal. $\chi^{\rm amb}$ is one global vector, fitted jointly with the cell model and initialised from the normalised counts of surely empty droplets. Its estimate carries no reported posterior, so its uncertainty is not represented.

*Cluster-pooled profile (DecontX).* Each droplet's counts are a two-component mixture of its cluster's native profile and a contamination profile. For cluster $k$ the contamination profile is the pooled profile of the other clusters, $\eta_{\cdot k}\propto\sum_{k'\neq k}\phi_{\cdot k'}$, and EM alternates droplet assignments with the profiles. The profile is valid only when the clusters separate cell types and at least two clusters differ in composition.

*Weighted EM (proposed).* Let $w_n$ be the posterior probability that droplet $n$ is background only, from the background multinomial against a cell-model likelihood. Then $\hat\pi_g=\sum_n w_nx_{gn}/\sum_n w_nN_n$ is the weighted multinomial maximum-likelihood update, and $\pi\mid x\approx\mathrm{Dir}(\alpha+\sum_n w_nx_{\cdot n})$ gives an approximate posterior. The Dirichlet step treats $w_n$ as known, so its intervals are too narrow when the cell model is uncertain. Its regime is large droplet counts and a cell-model likelihood supplied by cell calling or by a fixed threshold.

**Insight.** Pooling needs no training and states its assumption in the choice of pool. Model-based forms state it as a likelihood, return posteriors, and can share a profile across channels through a prior. In the first-order model above, the pool sets the bias, so benchmarks must vary the pool and its purity. The profile and the cell fraction trade off through the totals, so their benchmarks must be separate and must hold the other quantity fixed.

**Pitfalls.** Scoring a profile against the same model's own outputs is circular. Cell calls or clusters that encode ambient-driven markers bias cluster-based profiles. Section 8 is built to avoid both.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| SoupX soup profile (`estimateSoup`) | heuristic | Pools raw counts of droplets with total UMI in an open window into one normalised profile; the multinomial maximum-likelihood estimate when the window holds only ambient droplets | [R1] |
| CellBender `remove-background` profile | model-based | Learns one global ambient vector as a simplex-constrained parameter of a deep generative model, initialised from surely empty droplets | [R2] |
| scAR `get_ambient_profile` | hybrid | Labels droplets cell-free with a multinomial rule and re-estimates the profile from them; the profile is then a fixed input to a variational model | [R3] |
| DecontX contamination profile | model-based | Uses the pooled profile of the other clusters as each cluster's contamination distribution in an EM mixture | [R4] |

The published standard is the SoupX soup estimate [R1]. It needs neither clusters nor a GPU, and it is also the pooled low-UMI floor used in the benchmarks, which is the same estimator at its default window. The model-based and hybrid alternatives are CellBender [R2], scAR [R3] and DecontX [R4]. FastCAR is omitted from the tables and the enum because no primary source for it is cited (section 10).

Values at the pinned commits. The scAR lines are from Novartis/scAR at df7adef; the author's repository at 401da53 differs from that file in one line (`scar/main/_setup.py:145`, dense conversion of a batch).

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| SoupX `estimateSoup` | `soupRange` | c(0, 100), both ends excluded | `R/estimateSoup.R:22,26` @ 8d89492 |
| SoupX `estimateSoup` | profile | pooled counts divided by pooled totals over the window | `R/estimateSoup.R:26-29` @ 8d89492 |
| CellBender | `--epochs` | 150 | `cellbender/remove_background/argparser.py:138` @ f36ae29 |
| CellBender | `LOW_UMI_CUTOFF` | 5 | `cellbender/remove_background/consts.py:27` @ f36ae29 |
| CellBender | `TOTAL_DROPLET_DEFAULT` | 25000 | `consts.py:30` @ f36ae29 |
| CellBender | `AMBIENT_COUNTS_IN_CELLS_LOW_LIMIT` | 0.1, applied with max(expected_cells, 5000) | `consts.py:14`; `cellbender/remove_background/data/dataset.py:296-301` @ f36ae29 |
| CellBender | `DEFAULT_BATCH_SIZE` | 128 | `consts.py:36` @ f36ae29 |
| CellBender | initial `chi_ambient` | normalised counts of droplets with totals between `LOW_UMI_CUTOFF` and the surely-empty count, plus a small constant | `cellbender/remove_background/data/dataset.py:414-419` @ f36ae29 |
| scAR `get_ambient_profile` | `prob` | 0.995 | `scar/main/_setup.py:17` @ df7adef |
| scAR `get_ambient_profile` | `min_raw_counts` | 2 | `scar/main/_setup.py:18` @ df7adef |
| scAR `get_ambient_profile` | `iterations` | 3 | `scar/main/_setup.py:19` @ df7adef |
| scAR `get_ambient_profile` | cell-free rule | log probability at least log(prob) times the number of features | `scar/main/_setup.py:164` @ df7adef |
| scAR `get_ambient_profile` | minimum cell-free droplets | 50, otherwise an exception | `scar/main/_setup.py:169-170` @ df7adef |
| scAR `get_ambient_profile` | storage in the upstream code | `adata.uns["ambient_profile_all"]` | `scar/main/_setup.py:181-196` @ df7adef |
| DecontX | `maxIter`, `convergence` | 500, 0.001 | `R/decon.R:128,131` @ fdb2651 |
| DecontX | `delta`, `estimateDelta` | c(10, 10), TRUE | `R/decon.R:129-130` @ fdb2651 |
| DecontX | `varGenes`, `seed` | 5000, 12345 | `R/decon.R:133,135` @ fdb2651 |
| DecontX | contamination profile | pooled profile of the other clusters, normalised | `src/DecontX.cpp:101-110` @ fdb2651 |

## 5. Proposed singlet approach

**Routes.** SoupX's pool is reimplemented rather than ported, since the profile is one weighted sum (licences in section 12). CellBender, scAR and DecontX are ported with their defaults. The CellBender model is ported to PyTorch with the same likelihood and priors, and the upstream release is kept as the parity comparator in P1.

**Default and enum.** The default is `soupx` with the called-cell mask. It is deterministic, needs neither a GPU nor clusters, and is the published standard. The enum holds only methods with a primary source cited in section 11. The weighted EM of section 3 is not in the enum yet. It joins the enum, and becomes the default, only if it meets the conditions below.

**Proposed estimator.** The weighted EM with the Dirichlet step, with $w_n$ from the cell-calling likelihood or a fixed threshold. It is rejected if it fails the B1 criterion, if on B2 it does not reduce total variation below `soupx` at the default pool purity, or if its 90% intervals cover the planted composition at a rate more than 5 points below nominal.

**Implementation.** The E-step needs per-droplet log-likelihoods $x_n^\top\log\pi$, a sparse matrix-vector product, and the M-step is a sparse transpose product weighted by $w_n$. Both run as cuSPARSE SpMV or SpMM on CUDA and as the same CSR loops in the dependency-free CPU path. Each iteration is a sum over droplets, so it streams in chunks with $O(G)$ state. PyTorch is needed only for the CellBender and scAR comparators, and for a catalogue-trained prior if one is later justified (section 10).

**Defaults an agent should use without asking.** `method=soupx`, `sample_key=sample`, `seed=12345`, `device=auto`. Use `cellbender` only after a dry run and with `cellbender.expected_cells` set. Use `decontx` only when cluster labels separate cell types.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | raw/counts | sparse int | droplet-by-gene UMIs including empty droplets; required by every method |
| read | obs/is_cell | bool | cell calls; called droplets are left out of the `soupx` pool when present |
| read | obs/<sample_key> | string | channel identifier; one profile is written per distinct value |
| read | obs/<cluster_key> | string or int | cluster labels for `decontx`; clustered internally when absent |
| write | varm/ambient_profile_<sample> | float64, genes by k | composition per channel; k is 1, except for `decontx`, which writes one column per cluster; each column sums to one over analysed genes and is zero elsewhere |
| write | uns/ambient_profile_meta/<sample> | dict | method, parameters, droplets used, UMI window or rounds, excluded genes, convergence record |
| write | obs/ambient_p_nonempty | float32 in [0,1] | `cellbender` only: the model's per-droplet cell probability |
| write | models/ambient_profile_<method> | model artefact | `cellbender` only: trained weights, needed to reproduce the profile |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: .singlet path or URI (s3://, r2://, https://) or workspace handle. Needs raw/counts. |
| `method` | string | "soupx" | `soupx`, `cellbender`, `scar`, `decontx` | soupx (default: pooled low-UMI droplets, CPU, no clusters); cellbender (learned profile, GPU advised); scar (iterative cell-free estimate); decontx (profiles pooled from other clusters). |
| `sample_key` | string | "sample" | — | obs column that defines channels; one profile is written per distinct value. |
| `seed` | integer | 12345 | min 0 | Random seed for cellbender and decontx; ignored by soupx and scar. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto uses CUDA for cellbender when enough memory is free, otherwise CPU. soupx is CPU only. |
| `dry_run` | boolean | false | — | Return estimated seconds, peak memory and device without running or writing. |
| `overwrite` | boolean | false | — | Replace existing ambient profile members for this method instead of failing. |
| `soupx` | object | — | — | Options used only when method is soupx. |
| `soupx.umi_low` | integer | 0 | min 0 | Lower exclusive bound of total UMIs for pooled droplets (SoupX soupRange). |
| `soupx.umi_high` | integer | 100 | min 1 | Upper exclusive bound of total UMIs for pooled droplets (SoupX soupRange). |
| `soupx.cell_mask_key` | string | "is_cell" | — | obs column of cell calls; called droplets are left out of the pool when present. |
| `scar` | object | — | — | Options used only when method is scar. |
| `scar.prob` | number | 0.995 | max 1; > 0 | Cell-free threshold probability for the multinomial rule; higher values give fewer cell-free droplets. |
| `scar.iterations` | integer | 3 | min 1 | Rounds of re-estimating the profile from cell-free droplets. |
| `scar.min_raw_counts` | integer | 2 | min 0 | Droplets with fewer total UMIs are dropped before the cell-free test. |
| `cellbender` | object | — | — | Options used only when method is cellbender. |
| `cellbender.epochs` | integer | 150 | min 1 | Training epochs for the variational model; upstream default is 150. |
| `cellbender.low_umi_cutoff` | integer | 5 | min 0 | Droplets with total UMIs at or below this are excluded from the analysis. |
| `cellbender.total_droplets` | integer | 25000 | min 1 | Droplets analysed by the model; upstream default is 25000. |
| `cellbender.expected_cells` | integer/null | null | min 1 | Expected cell count; null uses the model default. Sets the ambient filter via max(expected_cells, 5000). |
| `cellbender.min_ambient_counts_in_cells` | number | 0.1 | min 0 | Genes whose projected ambient counts in cells are at or below this are returned unchanged. |
| `decontx` | object | — | — | Options used only when method is decontx. |
| `decontx.cluster_key` | string/null | null | — | obs column of cluster labels; when null, clusters are found internally as in DecontX. |
| `decontx.delta` | array | [10, 10] | — | Initial Beta concentrations for the native share; refitted each iteration by default. |
| `decontx.max_iter` | integer | 500 | min 1 | Maximum EM iterations. |
| `decontx.convergence` | number | 0.001 | > 0 | EM convergence threshold. |
| `decontx.var_genes` | integer | 5000 | min 1 | Variable genes for internal clustering when cluster_key is null. |
<!-- PARAMS:AUTO:END -->

`method` selects one parameter object and the others are ignored. `soupx` reads `obs/is_cell` and ignores cluster labels, because its pool-based estimate has none. `cellbender` and `scar` read the full droplet matrix and do not read cell calls, since their own models decide which droplets carry cells. `decontx` takes cluster labels, or clusters the droplets internally when none are given. Genes outside the analysed set are written as zero and listed in the metadata. The minimum of 50 cell-free droplets for scAR is fixed upstream and is not exposed.

## 7. MCP tool

Tool name `singlet_ambient_profile_estimation` (definition in `tasks/mcp/singlet_ambient_profile_estimation.json`). Example call and compact result; angle brackets mark values the tool computes.

```json
{"dataset": "/data/channel1.singlet", "method": "soupx", "soupx": {"umi_high": 100}}
```

```json
{"dataset": "/data/channel1.singlet", "status": "completed", "wrote": ["varm/ambient_profile_channel1", "uns/ambient_profile_meta/channel1"],
 "summary": {"method": "soupx", "samples": {"channel1": {"droplets_used": "<int>", "umi_window": [0, 100]}}, "genes_excluded": "<int>"},
 "provenance_id": "<string>", "job_id": null, "estimate": null}
```

Long-running: `cellbender` may return `status: queued` with a `job_id`. Stochastic: `cellbender` and `decontx` depend on `seed`; `soupx` is deterministic for fixed inputs. Dry run: `dry_run: true` returns time, peak memory and device in `estimate` and writes nothing.

## 8. Benchmarks

All methods run at the defaults of section 4 on the same raw matrix and cell calls, with fixed seeds (12345). Every profile is renormalised over the common gene set before scoring, and that set is stated per benchmark. Spearman uses average ranks for ties. Benchmarks with allele-attributed truth split the cells of each channel in halves, build the truth on one half and score on the other, then swap and average. Versions are the commits in section 12. Results are reported per channel and summarised by the median over channels or replicates.

### B1. Cross-genotype background profile (extended from Janssen et al.)

- **Goal**: score each profile against background molecules of known genotype origin, without giving genotype to any method.
- **Ground truth**: orthogonal measurement from allele-attributed UMIs. A UMI is foreign when its allele at an informative site belongs to the other subspecies; informative genes have at least 10 foreign UMIs (proposed). $\pi^{\star}_g$ is the share of foreign UMIs at gene $g$ over informative genes, pooled over both subspecies' cells and normalised over those genes. It equals the cell-free composition when the subspecies contribute equal cell-free RNA.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Mouse kidney, two subspecies pooled per experiment | Janssen et al. [R6]; accession — | three scRNA-seq and two snRNA-seq replicates; mouse; cells — | — | alleles used for truth and scores only |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Spearman | $\hat\pi$ against $\pi^{\star}$ over informative genes, renormalised; average ranks | higher | primary | proposed |
| Poisson deviance | $D=2\sum_{i,g}[b_{gi}\log(b_{gi}/\mu_{gi})-(b_{gi}-\mu_{gi})]$, $\mu_{gi}=F_i\hat\pi_g$, $F_i=\sum_g b_{gi}$, per scoring cell | lower | primary | standard form; [R8] uses a related Poisson loss |
| Total variation | $\tfrac12\sum_g\lvert\hat\pi_g-\pi^{\star}_g\rvert$ over informative genes | lower | guardrail | standard definition |
| Top-50 overlap | Jaccard of the 50 largest genes; ties by gene index | higher | guardrail | proposed |

- **Comparators**: `soupx` at its default window (also the pooled floor), CellBender, scAR, DecontX as the cell-weighted mean of its cluster profiles.
- **Protocol**: split each replicate's cells in halves; truth from one half, scores on the other, then swap and average. Profiles use the raw matrix only. Report per replicate and the median over five replicates.
- **Acceptance criterion** (proposed, not from the literature): Spearman at least 0.90, and deviance at least 5% below the floor in at least four of five replicates.
- **Known pitfalls**: allele-specific expression (deleted or strongly expressed alleles) makes foreign counts look ambient, so such genes are excluded; barcode swapping and cross-subspecies doublets also yield foreign UMIs, which the truth includes.

### B2. Planted composition simulation (proposed)

- **Goal**: test recovery of a known composition with a generator outside the multinomial count family.
- **Ground truth**: planted simulation; $\pi^{\star}_g\propto c_g\pi_g$ is the expected ambient composition at the observed capture scale, normalised over all genes.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated channels from the recipe | generator recipe (singlet) | synthetic scRNA-seq; sizes in protocol | — | real profiles are inputs |

- **Recipe**: (1) $\pi_g\propto\sum_{i\in E}x_{gi}$ over empty droplets $E$ of one real channel. (2) Capture factors $c_g$ log-normal, standard deviation 0.5 (proposed). (3) $\theta_k$ is the normalised pseudo-bulk of annotated cells of type $k$. (4) Totals $N_i$ come from the channel's empirical totals; some droplets are empty ($\rho_i=1$); others take a type $k(i)$ by frequency and an ambient share with mean in $\{0.05, 0.10, 0.20, 0.40\}$ (proposed). (5) $p_{gi}\propto c_g[\rho_i\pi_g+(1-\rho_i)\theta_{k(i)g}]$; counts negative binomial with mean $N_ip_{gi}$ and dispersion $\phi=0.1$ (proposed). (6) Impure-pool variant: a fraction $\kappa\in\{0,0.1,0.3\}$ (proposed) of droplets below 100 UMIs receive a cell-type composition.

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Total variation | $\tfrac12\sum_g\lvert\hat\pi_g-\pi^{\star}_g\rvert$ over all genes | lower | primary | proposed |
| Spearman | Over genes with $\pi^{\star}_g>0$; average ranks | higher | primary | proposed |
| 90% interval coverage | Share of genes whose 90% interval contains $\pi^{\star}_g$; only methods with intervals | nominal 0.90 | guardrail | proposed |

- **Comparators**: `soupx` (floor), CellBender, scAR, DecontX with planted types as clusters, the proposal.
- **Protocol**: all mixture levels and $\kappa$ values, at least five seeds (proposed); report medians and the worst setting. The multinomial generator is a sanity check only; it matches the class of `soupx`, DecontX and the proposal.
- **Acceptance criterion** (proposed, not from the literature): total variation at most 0.05 at $\kappa=0.1$ (default pool purity), with coverage within 5 points of nominal.
- **Known pitfalls**: the negative binomial family is close to CellBender's count family, so its score partly reflects family match; one planted composition describes one real channel.

### P1. Performance and scaling

Wall time and peak memory of the profile step alone, against raw droplet count at $10^4$, $10^5$ and $10^6$ droplets. These are benchmark sizes, not dataset claims, generated by the B2 recipe at a fixed gene count. Comparators are `soupx`, CellBender (GPU and CPU), scAR, DecontX (with cluster labels and with internal clustering) and the proposal, on CPU and CUDA where each is supported. Hold fixed the gene count, thread count, device and the default convergence settings of section 4. Record CellBender's analysed droplet count and scAR's batch count. Acceptance (proposed, not from the literature): the proposal finishes within twice the `soupx` wall time at $10^5$ droplets.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
- **Feeds**:
  - `ambient.count_removal`: Ambient count removal
- **Reads**: `raw/counts`, `obs/is_cell`, `obs/<sample_key>`, `obs/<cluster_key>`
- **Writes**: `varm/ambient_profile_<sample>`, `uns/ambient_profile_meta/<sample>`, `obs/ambient_p_nonempty`, `models/ambient_profile_<method>`
<!-- CHAINING:AUTO:END -->

This task belongs to the per-channel ambient correction chain, which runs from cell calling to count removal.

## 10. Risks, pitfalls and open questions

- **Unconfirmed sources.** For Janssen et al. only search snippets of the published article were read, so the dataset accession, cell counts, dataset licence and full author list are not confirmed, and the CellBender marker-detection gain is not used here. For Cargnelli et al. only search snippets were read, so their profile metrics, per-tool rankings and datasets are not used; the preprint abstract names only CellBender and DecontX as generally strong, while the published article also names SoupX. FastCAR has no primary source cited here, so it is omitted.
- **Unsettled literature.** No benchmark checked here isolates whether one profile per channel is adequate, although the SoupX README calls the profile experiment specific. The cross-genotype truth assumes both subspecies contribute cell-free RNA in equal proportion, and this document does not characterise the profile shape of the snRNA-seq replicates in Janssen et al.
- **Data risks.** The weighted EM and any catalogue-trained prior need raw unfiltered droplet matrices, and whether the 354M-cell catalogue keeps them is not confirmed. A species-mixing benchmark with known ratios would give a truth independent of subspecies, but no such dataset has been identified, so it is held back.
- **Key mismatch.** The scAR code stores its profile in `uns` and the scvi-tools guide says `varm`. Singlet writes `varm`, but `ambient.count_removal` reads `uns/ambient_profile` by default, so the two tasks must agree on one key before either is implemented.
- **Calibration.** CellBender returns a point estimate, and the Dirichlet step of the proposal treats the weights as known, so its intervals understate uncertainty when the cell model is uncertain. Calibration is measured by B2 before the estimator can become a default.
- **First experiment.** Every numeric threshold and design value marked proposed is a singlet choice without a literature value; the Dirichlet concentration (1.0 by default) is one of them. The first experiment is B1 on the five replicates, comparing the soup floor, `soupx`, CellBender and the proposal, to measure the gap to the truth and whether the proposal closes it.

## 11. References

R1. Young MD, Behjati S. SoupX removes ambient RNA contamination from droplet-based single-cell RNA sequencing data. *GigaScience* 2020. doi:10.1093/gigascience/giaa151 — verified (corpus)
R2. Fleming SJ, Chaffin MD, Arduini A, et al. Unsupervised removal of systematic background noise from droplet-based single-cell experiments using CellBender. *Nature Methods* 2023. doi:10.1038/s41592-023-01943-7 — partial (corpus)
R3. Sheng C, Lopes R, Li G, et al. Probabilistic machine learning ensures accurate ambient denoising in droplet-based single-cell omics. *bioRxiv* 2022. doi:10.1101/2022.01.14.476312 — verified (corpus)
R4. Yang S, Corbett SE, Koga Y, et al. Decontamination of ambient RNA in single-cell RNA-seq with DecontX. *Genome Biology* 2020. doi:10.1186/s13059-020-1950-6 — verified (corpus)
R5. Lun ATL, Riesenfeld S, Andrews T, Dao TP, Gomes T, Marioni JC. EmptyDrops: distinguishing cells from empty droplets in droplet-based single-cell RNA sequencing data. *Genome Biology* 2019. doi:10.1186/s13059-019-1662-y — verified (corpus)
R6. Janssen P, et al. The effect of background noise and its removal on the analysis of single-cell expression data. *Genome Biology* 2023;24:140. doi:10.1186/s13059-023-02978-x — partial (search)
R7. Cargnelli CB, Nielsen JV, Madsen JGS. Benchmarking computational decontamination of ambient RNA. *Frontiers in Bioinformatics* 2026. doi:10.3389/fbinf.2026.1844838; bioRxiv doi:10.64898/2026.01.13.699237 — partial (search)
R8. OpenProblems bio contributors. Denoising task metric configurations (mse and poisson). GitHub repository openproblems-bio/task_denoising, `src/metrics/poisson/config.vsh.yaml` @ 6233222. — verified (repo)
R9. scvi-tools contributors. scAR user guide, `get_ambient_profile`. scvi-tools documentation, docs/user_guide/models/scar.md at 5555ecc. — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/constantAmateur/SoupX | Matthew Daniel Young | GPL-2 (DESCRIPTION; no LICENSE file at the root) | `estimateSoup` profile, default method; version 1.6.2 at 8d89492 | reimplement |
| https://github.com/broadinstitute/CellBender | Stephen Fleming, Mehrtash Babadi | BSD 3-Clause (pyproject.toml; LICENSE file) | learned ambient vector; parity comparator; f36ae29 | port |
| https://github.com/Novartis/scAR | Caibin Sheng | MIT (docs/License.rst; pyproject.toml; no LICENSE file at the root) | `get_ambient_profile` pre-step; df7adef | port |
| https://github.com/campbio/decontX | Yuan Yin, Masanao Yajima, Joshua Campbell | MIT + file LICENSE (DESCRIPTION; LICENSE file) | cluster-pooled contamination profile; version 1.10.0 at fdb2651 | port |
