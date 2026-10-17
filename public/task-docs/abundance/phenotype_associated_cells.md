---
id: abundance.phenotype_associated_cells
title: Cell neighbourhoods whose abundance covaries with a sample-level phenotype
area: abundance
scope: extended
paradigm: model-based
literature_status: contested
priority: P2
depends_on: [neighbors.approximate_knn_search, dim-reduction.normalized_cell_embedding, integration.batch_corrected_embedding]
feeds: [statistics.pvalue_null_calibration, statistics.multiple_testing_control, markers-de.neighborhood_level_de]
reads: [obsp/<graph_key>, obsm/<use_rep>, obs/<sample_key>, obs/<phenotype_key>, obs/<covariate_keys>, obs/<strata_keys>]
writes: [uns/phenotype_assoc_global_p, obs/phenotype_assoc_coef, obs/phenotype_assoc_fdr, obs/phenotype_assoc_sig_05, obs/phenotype_assoc_sig_10, uns/phenotype_assoc_fdr_thresholds, obsm/phenotype_assoc_nam]
devices: [cpu, cuda]
mcp_tool: singlet_abundance_phenotype_associated_cells
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Cell neighbourhoods whose abundance covaries with a sample-level phenotype

> Tests, for each cell's graph neighbourhood, whether its abundance across samples covaries with a sample-level phenotype after covariate and strata adjustment, and returns a global p-value, per-cell statistics and FDR-controlled cell calls.

## 1. Question

Which cells have a neighbourhood abundance profile across samples that covaries with a sample-level phenotype (numeric, binary or ordered) after adjusting for covariates and batch or donor strata? Inputs are a kNN graph over cells, a cell-to-sample map, the phenotype and covariates. Outputs are a global association p-value, a per-cell statistic with its FDR, and FDR-controlled cell calls. A correct answer takes the sample, not the cell, as the unit of replication and recovers planted associations with known truth.

## 2. Why this task matters and where the field stands

Phenotypes such as disease state, age or dose are recorded per sample, but single-cell atlases are analysed per cell. Cluster-level tests split or blur shifts that cross cluster boundaries [R2]. Neighbourhood methods avoid fixed clusters by testing overlapping kNN neighbourhoods, which creates a multiplicity problem because the tests share cells [R2, R3].

Status: **contested**. Three problems remain open.

1. Overlapping neighbourhoods are dependent, so Benjamini-Hochberg over neighbourhoods over-counts. CNA replaces it with an empirical FDR calibrated by permutation [R1]. Milo uses a graph-weighted FDR adapted from cydar [R2, R3] to kNN neighbourhoods.
2. Several samples from one donor, and phenotypes aligned with batch, break the exchangeability that permutation nulls assume.
3. The curated corpus contains no benchmark comparing these methods on covariate-adjusted per-cell association, so the ranking is unresolved. Rare-subset detection from sample labels [R7] is a further option that is not compared here.

## 3. Theory and insight

Notation: $m$ retained samples, $N$ cells, $s(i)$ the sample of cell $i$, $A$ the sparse kNN connectivity matrix.

**Neighbourhood abundance matrix (CNA).** Diffusing the indicator $\mathbf s_k$ of sample $k$ over $A$ and dividing by the sample's cell count $C_k$ gives the NAM entry $N_{ki}$: the share of sample $k$'s cells in cell $i$'s diffused neighbourhood, relative to sample size. One step is
$$\mathbf s^{(t+1)}=(A+wI)\,D^{-1}\mathbf s^{(t)},\qquad D=\mathrm{diag}(A^{\top}\mathbf 1+w\mathbf 1).$$

**Residualisation and reduction.** With a standardised design $C$ of covariates and batch dummies, $M_C=I-C(C^{\top}C+\lambda\Lambda)^{-1}C^{\top}$, where $\Lambda$ selects the batch columns, so the ridge $\lambda$ applies to batch only ($\lambda=0$ without batches). Each neighbourhood column is centred, projected and scaled by the standard deviation $\sigma_i$ of the projected column:
$$\tilde N_{\cdot i}=\frac{M_C\,(N_{\cdot i}-\bar N_{\cdot i})}{\sigma_i},\qquad \tilde N=U\Sigma V^{\top}.$$

**Global test.** The residualised phenotype $\tilde y=M_C y$ is standardised. For component counts $k$ in a grid $\mathcal K$, $U_kU_k^{\top}\tilde y$ gives an F-test with $k$ and $m-1-r-k$ degrees of freedom ($r$ the columns of $C$). The statistic $p_{\min}=\min_{k\in\mathcal K}p_k$ receives a permutation p-value from $B$ conditional permutations $y^{(b)}$, within batch, or across batches when donor labels are given:
$$p_{\rm global}=\frac{1+\#\{b:\ p^{(b)}_{\min}\le p_{\min}\}}{B+1}.$$

**Per-cell statistic and FDR.** The statistic uses the residualised phenotype, not its fitted projection:
$$c_i=\frac1m\sum_{k}\tilde y_k\tilde N_{ki}=\frac{m-1}{m}\,\mathrm{corr}_k(\tilde y,\tilde N_{\cdot i}),\qquad \widehat{\mathrm{FDR}}(t)=\frac1B\sum_{b}\frac{\#\{i:\lvert c^{(b)}_i\rvert\ge t\}}{\#\{i:\lvert c_i\rvert\ge t\}}.$$
Thresholds are $t=\max\lvert c\rvert\,(\tfrac14+j/400)$ for $j\ge0$ with $t<\max\lvert c\rvert$. A cell's FDR is the smallest $\widehat{\mathrm{FDR}}(t)$ with $t\le\lvert c_i\rvert$, or 1 if there is none.

**Milo.** $C_{vs}\sim\mathrm{NB}(\mu_{vs},\phi_v)$ with $\log\mu_{vs}=\log L_s+\mathbf x_s^{\top}\boldsymbol\beta_v$, where $L_s$ is the TMM-normalised library size over tested neighbourhoods [R5]. The contrast $\beta_v$ is the change in log expected count per unit normalised library, reported by edgeR as a log2 fold change, and is tested with edgeR's quasi-likelihood F-test [R6]. The graph-spatial FDR uses $w_v=1/d_k(v)$, the inverse distance to the $k$-th neighbour of the index cell, and $W=\sum_v w_v$:
$$\tilde q_{(j)}=\min\Bigl\{1,\ \min_{l\ge j}\frac{W\,p_{(l)}}{\sum_{r\le l}w_{(r)}}\Bigr\}.$$
Its validity for kNN neighbourhoods extends [R3] and is tested in B3.

**MELD.** Sample indicators are column-normalised, filtered by $F=\exp(-\beta\lambda/\lambda_{\max})$ on the graph Laplacian spectrum, and normalised across samples within each cell [R4]:
$$d_k=F\,\tilde s_k,\qquad \ell_k(i)=\frac{d_k(i)}{\sum_j d_j(i)}.$$
Only an ordered phenotype is meaningful here, and larger $\beta$ smooths more strongly.

**Estimands.** CNA $c_i$ is a correlation across samples between residualised, unit-variance profiles, bounded by $(m-1)/m$. CNA $p_{\rm global}$ is the share of relabelled statistics at least as extreme as the observed minimum. Milo $\beta_v$ is the change in log expected count per unit phenotype per unit normalised library. MELD $\ell_k(i)$ is the share of cell $i$'s filtered density from sample $k$, summing to one over samples, with $1/m$ meaning no enrichment. The B1 label is $y_i=\mathbf 1[i\in P]$.

**Failure modes.** Samples are independent given covariates and strata, and cells are not replicates. A graph built on an integrated embedding can shrink the signal, and a phenotype aligned with a covariate is partly absorbed by residualisation. A large expansion of one population shifts all apparent abundances. CNA needs at least 10 samples and cannot report p-values below $1/(B+1)\approx10^{-3}$.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Covarying neighbourhood analysis (CNA) | model-based | Diffused sample composition per cell, residualised and reduced by SVD, tested by conditional permutation with an empirical FDR | [R1] |
| Milo | model-based | Counts per sample in sampled kNN neighbourhoods, tested with a negative-binomial quasi-likelihood model and a graph-weighted FDR | [R2], [R3] |
| MELD | hybrid | Heat-kernel smoothing of sample indicators, giving a per-cell likelihood over samples for ordered series | [R4] |

CNA and Milo are the published model-based standards. CNA gives a permutation-calibrated global test and per-cell statistics without fixed clusters; Milo gives interpretable neighbourhood tests. The heuristic standard kept as comparator is cluster-level abundance testing (abundance.celltype_proportion_test). MELD is kept only for ordered series. CellCnn is not tabulated, for the reason in section 10.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| CNA | permutations (Nnull) | 1000 | _association.py:10 @ 5d4bbe98 |
| CNA | smallest global p | $1/(B+1)$, with a warning | _association.py:92-95 @ 5d4bbe98 |
| CNA | diffusion self-weight | 1 | _nam.py:21 @ 5d4bbe98 |
| CNA | diffusion steps | adaptive; cap 15; from step 3 on, stop when median kurtosis falls by less than 3 | _nam.py:44, :64-66 @ 5d4bbe98 |
| CNA | batch ridge | candidates from 1e5 down to 0; first with median batch kurtosis at most 6 | _nam.py:142, :155 @ 5d4bbe98 |
| CNA | neighbourhood QC | with several batches, drop cells with batch kurtosis at least max(6, 2 × median) | _nam.py:85-101 @ 5d4bbe98 |
| CNA | stored singular values | truncation only, to 10, $\lfloor0.15m\rfloor$ or the largest tested $k$; the test does not read them | _association.py:28, :204, :217 @ 5d4bbe98 |
| CNA | tested component counts | multiples of $\iota=\max(\lfloor0.02m\rfloor,1)$ up to $\max(\min(4\iota,\lfloor m/5\rfloor),1)$ | _association.py:32-35 @ 5d4bbe98 |
| CNA | FDR threshold grid | from max c/4 with spacing max c/400 | _association.py:109 @ 5d4bbe98 |
| CNA | FDR levels reported | 0.05 and 0.10 | _association.py:118-125 @ 5d4bbe98 |
| CNA | minimum samples | 10 unless allow_low_sample_size | _association.py:171, :204 @ 5d4bbe98 |
| CNA | donor permutation | donor labels permuted without batch strata | _association.py:87-88 @ 5d4bbe98 |
| Milo | index-cell fraction (prop) | 0.1 | R/makeNhoods.R:56 @ 4ecad892 |
| Milo | neighbours per neighbourhood (k) | 21 | R/makeNhoods.R:56 @ 4ecad892 |
| Milo | embedding dimensions (d) | 30 | R/makeNhoods.R:56 @ 4ecad892 |
| Milo | refined index placement | TRUE | R/makeNhoods.R:56, :110 @ 4ecad892 |
| Milo | library-size normalisation | TMM | R/testNhoods.R:169, :436 @ 4ecad892 |
| Milo | quasi-likelihood fit | robust TRUE, legacy TRUE | R/testNhoods.R:168, :602 @ 4ecad892 |
| Milo | spatial FDR weighting | k-distance | R/testNhoods.R:167; R/graphSpatialFDR.R:159 @ 4ecad892 |
| MELD | heat bandwidth (beta) | 60 | meld/meld.py:96 @ 1a8701d7 |
| MELD | offset and order | 0 and 1 | meld/meld.py:97-98 @ 1a8701d7 |
| MELD | filter | heat | meld/meld.py:99; meld/filter.py:50 @ 1a8701d7 |
| MELD | filter solver | Chebyshev, order 50 | meld/meld.py:100-101 @ 1a8701d7 |
| MELD | Laplacian | combinatorial | meld/meld.py:102 @ 1a8701d7 |
| MELD | sample normalisation | TRUE | meld/meld.py:103, :229 @ 1a8701d7 |

## 5. Proposed singlet approach

**Routes.** All three methods are reimplemented, since the LICENSE file of each reference repository is GPL-3 family; MELD is also offered under a commercial licence (section 12). The default is cna. Three behaviours change from the reference:
1. Donor-level permutations are stratified within batch, where the reference permutes donors across batches (section 4).
2. Milo's cell output maps each cell to the mean $\beta_v$ over its neighbourhoods and to the minimum graph-spatial FDR over them.
3. MELD writes a per-cell slope of $\ell_k(i)$ against the ordered phenotype and no FDR, since it has no null.

**Proposed model (not in the enum).** Per neighbourhood $v$ and donor $d$, $Y_{vsd}\sim\mathrm{NB}(\mu_{vs},\phi_v)$ with $\log\mu_{vs}=\log L_s+\beta_{0v}+\beta_{1v}y_s+\mathbf x_s^{\top}\boldsymbol\gamma_v+u_{d(s)}$, and a graph-Laplacian prior on $\beta_1$ across overlapping neighbourhoods. It is falsified if false calls on B3 exceed nominal, or if recall on B1 at equal observed FDR does not beat cna. It joins the enum only after both pass.

**Stack and kernels.** PyTorch fits the proposed variational model. Hard-coded CUDA and cuSPARSE cover diffusion (repeated sparse matrix-vector products), batched permutation regressions on a fixed design that reuses its QR factorisation, and the MELD Chebyshev filter. The dense NAM is $m\times N$; at 500 samples and $10^7$ cells that is $5\times10^9$ entries, so it is stored sparse and computed in blocks of cells.

**Defaults for agents.** Method cna, 1000 permutations, self-weight 1, adaptive diffusion, FDR levels 0.05 and 0.10, seed 0, and graph and embedding keys that match the graph in use.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | obsp/<graph_key> | sparse float | kNN connectivities; default key connectivities |
| read | obsm/<use_rep> | float n × d | embedding the graph was built on; default X_pca |
| read | obs/<sample_key> | categorical | sample identifier per cell |
| read | obs/<phenotype_key> | numeric or categorical | sample-level phenotype, constant within donor |
| read | obs/<covariate_keys> | numeric or categorical | sample-level covariates |
| read | obs/<strata_keys> | categorical | batch and donor columns |
| write | uns/phenotype_assoc_global_p | float | global p-value (cna) |
| write | obs/phenotype_assoc_coef | float32 | per-cell statistic: $c_i$ (cna), mapped $\beta$ (milo), slope (meld) |
| write | obs/phenotype_assoc_fdr | float32 | per-cell empirical FDR (cna, milo) |
| write | obs/phenotype_assoc_sig_05 | bool | FDR at most 0.05 |
| write | obs/phenotype_assoc_sig_10 | bool | FDR at most 0.10 |
| write | uns/phenotype_assoc_fdr_thresholds | table | cna threshold grid and FDR curve |
| write | obsm/phenotype_assoc_nam | sparse float, cells by samples | cna normalised abundance matrix |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `sample_key` | string | required | — | obs column giving the sample identifier of each cell. |
| `phenotype_key` | string | required | — | Sample-level phenotype column, numeric, binary or ordered; constant within donor when strata_keys[1] is set. |
| `covariate_keys` | array | [] | — | Sample-level covariates adjusted for by cna and milo; ignored by meld. |
| `strata_keys` | array | [] | — | Up to two columns, batch then donor. Batch enters residualisation and permutation; donor is the permutation unit. |
| `method` | string | "cna" | `cna`, `milo`, `meld` | cna is the default; milo for count-based neighbourhood tests; meld only for ordered phenotypes. |
| `fdr_levels` | array | [0.05, 0.1] | — | Nominal FDR levels at which cells are called. |
| `options` | object | — | — | Shared and method-specific settings; each block applies only to its named method, graph applies to all. |
| `options.graph` | object | — | — | Embedding and graph keys shared by all methods. |
| `options.graph.use_rep` | string | "X_pca" | — | obsm embedding the kNN graph was built on; milo uses it for neighbourhood refinement. |
| `options.graph.graph_key` | string | "connectivities" | — | obsp key of the kNN connectivities matrix. |
| `options.cna` | object | — | — | Options for the covarying neighbourhood analysis. |
| `options.cna.n_permutations` | integer | 1000 | min 1 | Conditional permutations for the global p-value and the FDR null. |
| `options.cna.n_steps` | integer/null | null | min 1; max 15 | Diffusion steps; null stops adaptively by median kurtosis, capped at 15. |
| `options.cna.self_weight` | number | 1 | min 0 | Self-weight w in the diffusion update. |
| `options.cna.ridge` | number/null | null | min 0 | Batch ridge penalty; null selects it from the default list by batch kurtosis. |
| `options.cna.allow_low_sample_size` | boolean | false | — | Permit fewer than 10 samples; power and permutation resolution are then poor. |
| `options.milo` | object | — | — | Options for neighbourhood negative-binomial testing. |
| `options.milo.prop` | number | 0.1 | max 1; > 0 | Fraction of cells sampled as neighbourhood index cells. |
| `options.milo.k_nhood` | integer | 21 | min 1 | Graph neighbours per neighbourhood. |
| `options.milo.d_pcs` | integer | 30 | min 1 | Embedding dimensions used for refined index-cell placement. |
| `options.milo.refined` | boolean | true | — | Use refined index-cell placement as miloR does. |
| `options.milo.norm_method` | string | "TMM" | `TMM`, `RLE`, `logMS` | Library-size normalisation for the negative-binomial model. |
| `options.milo.fdr_weighting` | string | "k-distance" | `k-distance`, `graph-overlap` | Weights for the graph-spatial FDR; k-distance uses the k-th neighbour distance. |
| `options.meld` | object | — | — | Options for the MELD heat-kernel likelihood. |
| `options.meld.beta` | number | 60 | > 0 | Heat-kernel bandwidth of the graph filter. |
| `options.meld.filter_type` | string | "heat" | `heat`, `laplacian` | Graph filter; heat is the reference default. |
| `options.meld.sample_normalize` | boolean | true | — | Column-normalise sample indicators to sum to one before filtering. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for conditional permutations and their FDR null. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing phenotype_assoc_* members instead of failing. |
<!-- PARAMS:AUTO:END -->

Method options sit under options.cna, options.milo and options.meld and are ignored by other methods. cna uses covariate_keys and both strata keys. milo uses covariate_keys as design terms and ignores strata_keys. meld uses neither and requires an ordered phenotype, rejecting unordered labels. A donor key requires phenotype values constant within donor. Fewer than 10 samples raises an error for cna unless allow_low_sample_size is set.

## 7. MCP tool

Tool name `singlet_abundance_phenotype_associated_cells` (definition in `tasks/mcp/singlet_abundance_phenotype_associated_cells.json`). Example call and result, with placeholders in angle brackets:

```json
{"dataset": "/data/atlas.singlet", "sample_key": "sample_id", "phenotype_key": "disease_state", "covariate_keys": ["sex"], "strata_keys": ["batch", "donor_id"], "method": "cna", "seed": 0}
```

```json
{"dataset": "/data/atlas.singlet", "status": "completed", "wrote": ["uns/phenotype_assoc_global_p", "obs/phenotype_assoc_coef", "obs/phenotype_assoc_fdr", "obs/phenotype_assoc_sig_05", "obs/phenotype_assoc_sig_10", "uns/phenotype_assoc_fdr_thresholds", "obsm/phenotype_assoc_nam"], "summary": {"method": "cna", "n_samples": "<int>", "global_p": "<p-value>", "n_called_05": "<int>", "n_called_10": "<int>", "selected_components": "<int>"}, "provenance_id": "<id>"}
```

Long-running: at the largest scales the call returns status queued with a job_id. Stochastic: only cna depends on the seed, through its permutations. Dry run: returns seconds, peak memory and device from cell and sample counts, without writing members.

## 8. Benchmarks

**Shared protocol.** Every method receives identical inputs: one kNN graph (k = 15 on 30 principal components of one representation), the same sample, phenotype, covariate and strata columns, and the defaults of section 4 unless a benchmark says otherwise. No per-replicate tuning is allowed. Permutation methods use B = 1000 in accuracy benchmarks, with one seed per replicate. Calls are reported at q = 0.05 and 0.10. Fractions are taken over replicates or cells as each metric defines.

### B1. Planted causal-population recovery (proposed)

- **Goal**: Recover planted cells and control global type I error and cell-level FDR under a known sample-level signal.
- **Ground truth**: Planted simulation. The per-cell label $y_i=\mathbf 1[i\in P]$ is exact by construction; the per-sample planted fraction is $\lvert P\cap s\rvert/\lvert s\rvert$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Donor-labelled backbone, one sample per donor | singlet catalogue (internal) | scRNA-seq; at least 40 donors after QC | internal | Criteria fixed in advance |

- **Generator recipe**
  1. Define $P$ on an independent embedding of half the genes, as the union of $k=15$ seed neighbourhoods reaching a fraction $f_P\in\{1\%,5\%\}$ of cells (proposed values).
  2. Build the test graph on the full 30-component representation, so $P$ is not defined on the testing graph.
  3. Per sample, draw a fixed cell count, weighting planted cells by $\exp(\gamma y_s)$. $y_s$ is binary or standard normal, and $\gamma$ spans an effect grid chosen so that CNA power reaches 0.8.
  4. Assign sex at random and batch in balance. Null replicates set $\gamma=0$. Use $n_s\in\{10,20,40,80\}$ and 200 replicates per grid cell.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Global type I error | Share of null replicates with $p_{\rm global}\le\alpha$, $\alpha\in\{0.05,0.01\}$ | close to $\alpha$ | guardrail | — |
| Cell-level observed FDR | Non-planted calls divided by the larger of 1 and all calls, at $q\in\{0.05,0.10\}$ | at most $q$ | guardrail | — |
| Recall at $q=0.10$ | Planted calls divided by $\lvert P\rvert$ | maximise | primary | — |
| Cell AUPRC | Average precision of $\lvert c_i\rvert$ (or $\lvert\mathrm{coef}\rvert$) against $y_i$, ties averaged | maximise | primary | — |
| Power | Share of replicates with $p_{\rm global}\le0.05$ under $\gamma\ne0$, by $n_s$ | maximise | primary | — |

- **Comparators**: CNA; Milo with calls mapped to cells (section 5); MELD in the ordered variant only; cluster-level abundance testing (abundance.celltype_proportion_test) as heuristic standard.
- **Protocol**: Binary and continuous phenotypes; sex and batch as covariates.
- **Acceptance criterion** (proposed): type I error within [0.03, 0.07] at $\alpha=0.05$ over at least 200 null replicates; observed cell FDR at most $q$ for methods claiming FDR control; recall at least 0.5 at $n_s=40$ for calibrated methods, at the effect where CNA power reaches 0.8.
- **Known pitfalls**: Defining $P$ on the testing graph inflates recall; an exact shift is idealised, so add label noise.

### B2. Rare spike-in subset with a sample-level label (proposed)

- **Goal**: Flag a planted rare subset enriched in case samples, with few false calls in control samples.
- **Ground truth**: Spike-in. Spiked cells carry label 1 exactly; $f$ is the spiked share of cells in case samples.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B1 backbone plus a spike-in population from donors absent from the backbone | singlet catalogue (internal) | scRNA-seq | internal | Tissue and batch matched |

- **Generator recipe**
  1. Take the B1 backbone.
  2. Draw the spike-in population from excluded donors, matched on tissue and batch, and report its separability with an embedding fitted on backbone cells only.
  3. Per replicate, choose 20 case and 20 control samples; replace a share $f\in\{0.1\%,0.5\%,1\%\}$ of case-sample cells with spiked cells.
  4. Repeat 100 times.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-cell AUROC | AUROC of $\lvert c_i\rvert$ (or $\lvert\mathrm{coef}\rvert$) against spike labels over all replicate cells | maximise | primary | — |
| Detection rate | Share of replicates with a spiked cell called at $q\le0.05$ and Jaccard index at least 0.5 between called and spiked sets | maximise | primary | — |
| Control false-call rate | Cells called at $q\le0.05$ in control-only replicates, per $10^5$ cells | minimise | guardrail | — |

- **Comparators**: CNA; Milo with calls mapped to cells; MELD in the ordered variant only.
- **Protocol**: Identical data for all methods; batch as covariate.
- **Acceptance criterion** (proposed): at $f=0.5\%$ and 20 case samples, detection rate at least 0.9 for one method within 10 control false calls per $10^5$ cells; higher rates are reported as miscalibrated.
- **Known pitfalls**: Spike-ins from other donors can be unnaturally separable. A score can separate cases from controls through batch or quality rather than through the spike.

### B3. Null calibration on donor-labelled real data (proposed)

- **Goal**: Check that global p-values and cell-level FDR are calibrated when no association exists.
- **Ground truth**: Consistency (null by construction). The phenotype is a random donor-level label, drawn independently of biology and stratified within batch. The estimand is the distribution of $p_{\rm global}$ over such draws.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| At least 20 donor-labelled catalogue datasets, each with at least 20 donors and a batch column | singlet catalogue (internal) | scRNA-seq | internal | Selection fixed in advance |

- **Generator recipe**
  1. Select the datasets.
  2. Per dataset, draw a donor-level binary label stratified within batch.
  3. Apply each method with $B=1000$ permutations; repeat the draw 200 times per dataset.
  4. In a variant, compare the donor path with within-batch permutation on identical labels.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Global p-value uniformity | Kolmogorov-Smirnov test of the 200 $p_{\rm global}$ per dataset against Uniform(0,1), summarised across datasets (cna only) | maximise KS p-value | guardrail | — |
| Cell-level false-call fraction | Cells called at $\widehat{\mathrm{FDR}}\le0.05$ divided by cells tested | minimise | guardrail | — |
| Neighbourhood calls per draw | Calls at $q\le0.10$ per draw, summarised across datasets | minimise | primary | — |

- **Comparators**: CNA; Milo.
- **Protocol**: Report per dataset, then summarise; never pool cells across datasets.
- **Acceptance criterion** (proposed): KS p-value above 0.01 for at least 90% of datasets; median cell-level false-call fraction at most 0.01.
- **Known pitfalls**: Permuting cells instead of donors gives anti-conservative nulls for repeated samples. Donor structure outside the strata, such as a site effect, can leave non-null structure under permutation.

### P1. Performance and scaling

Wall time, peak memory and empirical scaling exponent (log-log slope) for singlet's CPU and CUDA implementations and for the CPU reference implementations of cna, milo and meld, at $10^5$, $10^6$ and $10^7$ cells with 20, 100 and 500 samples. Hold fixed: the k = 15 graph on 30 components; CNA diffusion at 15 steps (not adaptive); B = 1000; 4 CPU threads; three repeats per scale. Record the dominant stage and whether the NAM is stored dense. Methods that exceed memory are recorded as out of memory. Scales are proposals.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
  - `integration.batch_corrected_embedding`: Batch-corrected joint embedding
- **Feeds**:
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
  - `markers-de.neighborhood_level_de`: Cluster-free neighbourhood-level differential expression between conditions
- **Reads**: `obsp/<graph_key>`, `obsm/<use_rep>`, `obs/<sample_key>`, `obs/<phenotype_key>`, `obs/<covariate_keys>`, `obs/<strata_keys>`
- **Writes**: `uns/phenotype_assoc_global_p`, `obs/phenotype_assoc_coef`, `obs/phenotype_assoc_fdr`, `obs/phenotype_assoc_sig_05`, `obs/phenotype_assoc_sig_10`, `uns/phenotype_assoc_fdr_thresholds`, `obsm/phenotype_assoc_nam`
<!-- CHAINING:AUTO:END -->

The task sits between the cell embedding and calibration steps. The cell-level and neighbourhood abundance tasks answer adjacent questions.

## 10. Risks, pitfalls and open questions

- **Sources read in part.** The CNA association code was read for the statistic, residualisation, permutations and FDR; the CNA paper's simulations and results were not read, so B1 is a proposal. Milo's quasi-likelihood shrinkage was read only at its edgeR calls, and the edgeR quasi-likelihood paper is not in the local index. The Milo2.0 preprint [R9] was not read, and its authors are not recorded.
- **Licence and provenance.** The CNA licence statements disagree (section 12), and the copy read is a clone at the same commit as the upstream repository. The original CellCnn implementation was not located. The corpus copy is the PriCell variant [R8] under a non-commercial agreement, so it is not a port source.
- **Unsettled comparison and folded benchmark.** No benchmark in the curated corpus compares these methods on covariate-adjusted per-cell association, so the ranking is open. An orthogonal-annotation and cross-cohort benchmark is omitted because its two cohorts are not identified, and author annotations may have used the phenotype. CellCnn is excluded from the method tables because its primary paper was not read.
- **Technical risks and first experiment.** The global p-value cannot fall below $1/(B+1)\approx10^{-3}$, and the dense NAM scales with samples times cells. The CNA donor path permutes across batches. First experiment: B3 with CNA and Milo on at least 20 donor-labelled datasets, comparing the donor path with within-batch permutation, before any timing measurement in P1.

## 11. References

R1. Reshef YA, Rumker L, Kang JB, et al. Co-varying neighborhood analysis identifies cell populations associated with phenotypes of interest from single-cell transcriptomics. *Nature Biotechnology* 2022;40:355-363. doi:10.1038/s41587-021-01066-4 — verified (corpus)

R2. Dann E, Henderson NC, Teichmann SA, Morgan MD, Marioni JC. Differential abundance testing on single-cell data using k-nearest neighbor graphs. *Nature Biotechnology* 2022 (online 2021). doi:10.1038/s41587-021-01033-z — verified (corpus)

R3. Lun ATL, Richard AC, Marioni JC. Testing for differential abundance in mass cytometry data. *Nature Methods* 2017. doi:10.1038/nmeth.4295 — verified (corpus)

R4. Burkhardt DB, Stanley JS, Tong A, et al. Quantifying the effect of experimental perturbations at single-cell resolution. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00803-5 — verified (corpus)

R5. Robinson MD, Oshlack A. A scaling normalization method for differential expression analysis of RNA-seq data. *Genome Biology* 2010. doi:10.1186/gb-2010-11-3-r25 — verified (corpus)

R6. Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. *Bioinformatics* 2010. doi:10.1093/bioinformatics/btp616 — verified (corpus)

R7. Arvaniti E, Claassen M. Sensitive detection of rare disease-associated cell subsets via representation learning. *Nature Communications* 2017;8:14825. doi:10.1038/ncomms14825 — partial (search)

R8. Sav S, Bossuat JP, Troncoso-Pastoriza JR, Claassen M, Hubaux JP. Privacy-preserving federated neural network learning for disease-associated cell classification. *Patterns* 2022;3(5). doi:10.1016/j.patter.2022.100487 — partial (repo)

R9. Milo2.0 unlocks population genetic analyses of cell state abundance using a count-based mixed model. Preprint, 2023. doi:10.1101/2023.11.08.566176 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/immunogenomics/cna | Yakir Reshef, Laurie Rumker (setup.cfg author field) | GPL-3.0 (LICENSE file); setup.cfg classifier lists MIT | CNA reference implementation | reimplement |
| https://github.com/MarioniLab/miloR | Mike Morgan, Emma Dann (DESCRIPTION Authors@R) | GPL-3 (DESCRIPTION and LICENSE file) | Milo reference implementation | reimplement |
| https://github.com/KrishnaswamyLab/MELD | Daniel Burkhardt, Krishnaswamy Lab, Yale University (setup.py author field) | Dual: commercial or GPL-3.0 open source (LICENSE file) | MELD reference implementation | reimplement |
