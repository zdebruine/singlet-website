---
id: grn.differential_grn_rewiring
title: Differential GRN, regulon and co-expression rewiring between conditions or cell types
area: grn
scope: extended
paradigm: hybrid
literature_status: open
priority: P2
depends_on: [markers-de.replicate_aware_condition_de, grn.prior_network_curation, annotation.cluster_label_assignment]
feeds: [grn.upstream_regulator_inference, grn.causal_edges_from_perturbation]
reads: [layers/counts, layers/lognorm, obs/<sample_key>, obs/<condition_key>, obs/<celltype_key>, uns/regulon_<prior>]
writes: [uns/rewiring_<method>_edges, uns/rewiring_<method>_regulons, uns/rewiring_<method>_params]
devices: [cpu, cuda]
mcp_tool: singlet_grn_differential_grn_rewiring
evidence_basis: corpus+repo+memory
last_reviewed: 2026-10-17
---

# Differential GRN, regulon and co-expression rewiring between conditions or cell types

> Test which gene pairs, TF-target edges or regulon activities change their dependence between two conditions beyond their change in mean expression, using donors as the unit of replication.

## 1. Question

Given raw UMI counts with donor, condition and cell-type labels, which gene pairs, TF-target edges or regulons have a relationship that differs between two conditions more than their mean levels explain? The outputs are, for each tested pair or regulon, a signed difference (condition two minus condition one), a donor-permutation p-value and a Benjamini–Hochberg q-value. A correct answer keeps its false-positive rate near nominal when donor labels are shuffled within a condition [R1].

## 2. Why this task matters and where the field stands

Rewiring is a second-order question: genes whose targets move together in mean level change their pairwise correlations without any change in regulation, so a rewiring call must be separated from differential expression. Status: **open**. Four estimand families are in use: pair co-expression [R1], module preservation [R2][R3], regulon activity [R6][R8] and edge importance after separate network fits [R10][R11]. No accepted benchmark exists for the contrast. BEELINE benchmarks expression-based edge inference against simulated and curated truth [R5]. The open problems are donor-level calibration with few donors [R1], uncalibrated importances from independent fits, and regulon activity that tracks target expression rather than regulation [R6].

## 3. Theory and insight

Notation. Donor $d$ has cells $i$ and condition $c(d)\in\{1,2\}$. $x_{ij}$ is the UMI count of gene $j$ in cell $i$, with size factor $s_i$, which CS-CORE takes as total UMI per cell by default [R1]. A donor must belong to one condition: the code assigns it to group two if it has any group-two cell.

Pair estimand. CS-CORE models $x_{ij}\mid z_{ij}\sim\mathrm{Poisson}(s_i z_{ij})$ with latent $\mathbf z_i$ of mean $\boldsymbol\mu$ and covariance $\Sigma$ [R1]. The target in condition $g$ is the latent correlation $\rho^{(g)}_{jj'}=\Sigma^{(g)}_{jj'}/(\sigma^{(g)}_j\sigma^{(g)}_{j'})$, estimated by moment regression and clipped to $[-1,1]$. The rewiring estimand is $\Delta_{jj'}=\rho^{(2)}_{jj'}-\rho^{(1)}_{jj'}$, a correlation of depth-corrected latent expression, not of observed counts. The per-pair Wald statistic is an asymptotic approximation and is not the decision rule.

Decision. The decision is the donor-permutation p-value

$$p_{jj'}=2\min\Big\{\tfrac1B\textstyle\sum_{b}\mathbf 1[\Delta^{(b)}_{jj'}>\Delta_{jj'}],\ \tfrac1B\textstyle\sum_{b}\mathbf 1[\Delta^{(b)}_{jj'}<\Delta_{jj'}]\Big\},$$

where $\Delta^{(b)}$ is recomputed with donor labels permuted and the $B$ partitions are drawn without replacement from the $\binom{N}{n_2}$ donor partitions [R1]. It is valid when donors are exchangeable under the null. Its resolution is $2/B$, and $p=0$ occurs when no permutation is more extreme, since no +1 correction is applied. Rows carry est_group1, est_group2, obs_diff, p_value and q_value (BH over tested pairs).

Regulon estimand. The ULM activity of regulon $t$ in sample $c$ is the slope t-statistic in $y_{gc}=\beta_{0,c}+\beta_{1,c}w_{tg}+\varepsilon_{gc}$, with $w_{tg}$ the signed prior weight of target $g$ [R6]. It measures activity, which target means drive, so rewiring needs a control for target differential expression. Its p-values assume independent targets.

Module estimand. $Z_k=(\mathrm{obs}_k-\mu^{\mathrm{perm}}_k)/\sigma^{\mathrm{perm}}_k$ for each preservation statistic $k$, summarised by the median over $k$ [R2]. The hdWGCNA article reads $Z>10$ as high and $2<Z<10$ as moderate preservation [R3].

Edge estimand. $\Delta I_{tj}=I^{(2)}_{tj}-I^{(1)}_{tj}$ for importances from separate fits [R10][R11]. These importances are not on a calibrated scale, so the difference needs a resampling null.

Insight. Power follows donors. Full enumeration gives a smallest reachable p of $2/\binom{N}{n_2}$: two versus two gives $2/6$, and four versus four gives $2/70\approx0.03$. The CS-CORE vignette's CD14 monocyte object has seven COVID-19 and six healthy donors [R1], so $\binom{13}{7}=1716$ partitions exist, but a within-healthy split of six donors gives $\binom{6}{3}=20$, fewer than the default 100 draws. Pseudoreplication, mean–variance coupling and composition shifts can each change correlations without any rewiring.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CS-CORE diff_CSCORE | model-based | Poisson-latent co-expression per condition with a donor-permutation difference test | [R1] |
| decoupleR ULM with a donor-level linear model | hybrid | signed-regulon t-statistic per sample, then a condition test across donors | [R6][R7] |
| WGCNA and hdWGCNA module preservation | hybrid | module Z-summaries of density and connectivity against gene permutations | [R2][R3][R4] |
| arboreto GRNBoost2 and GENIE3 | model-based | per-target regression on candidate regulators, giving importances | [R10] |
| AUCell regulon scoring (SCENIC) | heuristic | per-cell gene-set activity score for each regulon | [R11] |
| NEBULA co-expression | model-based | negative binomial mixed model with a subject random effect | [R13] |
| SCENIC+ eRegulons | hybrid | regulons linking TFs, enhancers and targets from paired or separate scRNA and scATAC data | [R12] |

CS-CORE is the published standard for pair-level differential co-expression and the only method read here with a donor-level permutation null [R1]. Regulon and module methods serve as comparators. Defaults adopted by singlet:

| Method | Parameter | Value | Source |
|---|---|---|---|
| cscore | n_permu | 100 | R/diff_CSCORE.R:52 @10087164 |
| cscore | seed, n_cores | NULL, 1 | R/diff_CSCORE.R:52, :53 @10087164 |
| cscore | IRLS n_iter, eps | 10, 0.05 | R/CSCORE.R:51 @10087164 |
| cscore | IRLS convergence rule | max without covariates; q95 with covariates | R/CSCORE.R:71, :85 @10087164 |
| cscore | size factor | total UMI per cell | R/CSCORE.R:57-61 @10087164 |
| cscore | gene subset | top 1000 by mean relative abundance | vignettes/differential_coexpression.Rmd:44-46 @10087164 |
| regulon_limma | tmin | 5 | src/decoupler/_Method.py:73 |
| module_preservation | nPermutations, randomSeed, maxModuleSize | 100, 12345, 1000 | cran_WGCNA R/modulePreservation.R:124, :128, :129 @61a2a7d |
| module_preservation (hdWGCNA) | n_permutations, seed | 500, 12345 | R/ModulePreservation.R:31, :33 @e3344d1 |
| module_preservation (hdWGCNA NetRep) | n_permutations | 10000 | R/ModulePreservation.R:148 @e3344d1 |

## 5. Proposed singlet approach

Routes. CS-CORE's estimator and permutation loop are **ported**, and the decoupleR ULM is **ported**. The module Z-statistic is **reimplemented** from its definition. arboreto, AUCell, NEBULA and SCENIC+ are **callouts**, used only as comparators (licences in section 12).

Default. cscore follows CS-CORE with two changes. When $\binom{N}{n_2}\le$ `n_permu`, all partitions are enumerated. A group with fewer than four donors is refused, since four versus four gives 70 partitions (section 3).

Variant (singlet's proposal). Per-donor cross-products of latent-scale moments are computed once and reused across permutations, replacing the $2+2B$ fits [R1]. The IRLS weights make the estimator non-linear in these products, so the variant is an approximation. It is rejected if its p-values disagree with cscore on B1 (rank correlation of $-\log_{10}p$ below 0.9) or if B2 leaves its rejection band. A hierarchical model with donor random effects is proposed only if the variant fails.

Regulon routing. regulon_limma fits ULM activities per donor and cell type, then a donor-level linear model for condition. A regulon is reported as rewired only when its change remains significant after adjusting for the mean change of its targets (proposal).

Stack. PyTorch is reserved for the optional hierarchical model. Hard-coded CUDA covers batched cross-products (cuBLAS), permutation reductions and sparse counts (cuSPARSE). Null quantiles, not a $p\times p\times B$ array, are stored; streaming is not claimed. Agent defaults: cscore, `n_permu` 100, seed 12345, the top 1000 genes, and `celltype_key` set.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, required by cscore |
| read | layers/lognorm | sparse float | log-normalised values for the regulon and module methods |
| read | obs/`sample_key` | categorical | donor or sample id, the unit of permutation |
| read | obs/`condition_key` | categorical | exactly two levels |
| read | obs/`celltype_key` | categorical | estimation runs separately per level |
| read | uns/regulon_`<prior>` | table | signed TF-target weights |
| write | uns/rewiring_`<method>`_edges | table | pair, TF-target or module rows with the method's score, p_value and q_value |
| write | uns/rewiring_`<method>`_regulons | table | regulon rows: activity difference, t, p, q |
| write | uns/rewiring_`<method>`_params | dict | method, B, seed, donor counts per group |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "cscore" | `cscore`, `regulon_limma`, `module_preservation`, `edge_diff` | Rewiring estimator; cscore is the default and calibrates pair differences by donor permutation. |
| `sample_key` | string | required | — | obs column with the donor or biological sample id; the unit of permutation and replication. |
| `condition_key` | string | required | — | obs column with exactly two levels; the difference is level two minus level one. |
| `celltype_key` | string/null | null | — | obs column; estimation runs separately within each level. Required for cscore. |
| `genes` | array/null | null | — | Gene subset for pair methods; null takes the top 1000 genes by mean relative abundance per cell. |
| `cscore` | object | — | — | Options for cscore; ignored by the other methods. |
| `cscore.n_permu` | integer | 100 | min 1 | Donor-label permutations; capped at the number of distinct donor partitions. |
| `cscore.n_cores` | integer | 1 | min 1 | Parallel workers over permutations. |
| `cscore.irls_n_iter` | integer | 10 | min 1 | Maximum IRLS iterations in the moment regression. |
| `cscore.irls_eps` | number | 0.05 | > 0 | IRLS convergence threshold on abs(log(theta / theta_prev)). |
| `cscore.covariates` | array | [] | — | Cell-level metadata columns adjusted in the moment regression. |
| `regulon_limma` | object | — | — | Options for regulon_limma; ignored by the other methods. |
| `regulon_limma.prior_network` | string | "collectri_human" | `collectri_human`, `dorothea_human` | Signed prior used to build regulons; should differ from the evaluation prior. |
| `regulon_limma.min_targets` | integer | 5 | min 1 | Minimum regulon targets present in the layer for a regulon to be scored. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 12345 | min 0 | Seed for donor-label permutations and for stochastic GRN fits. |
| `dry_run` | boolean | false | — | Return estimated time, memory, number of model fits and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

The `cscore` options and `celltype_key` apply to the pair estimator; `regulon_limma` options apply only to regulon scoring. The tool refuses a condition without exactly two levels or a group with fewer than four donors. module_preservation fixes B at 100, the WGCNA default. Covariates are adjusted only in CS-CORE's C++ IRLS path [R1].

## 7. MCP tool

Tool name `singlet_grn_differential_grn_rewiring` (definition in `tasks/mcp/singlet_grn_differential_grn_rewiring.json`). Example call and compact result:

```json
{"dataset": "study.singlet", "method": "cscore", "sample_key": "donor", "condition_key": "status", "celltype_key": "cell_type", "cscore": {"n_permu": 100}, "seed": 12345}
```

```json
{"dataset": "study.singlet", "status": "completed", "wrote": ["uns/rewiring_cscore_edges", "uns/rewiring_cscore_params"], "summary": {"method": "cscore", "n_donors_per_group": ["<int>", "<int>"], "n_tested": "<int>", "n_q_le_0_05": "<int>"}, "provenance_id": "<id>"}
```

Long-running: yes, since cscore fits CS-CORE $2+2B$ times on cell subsets. Stochastic: yes, seeded by `seed`. Dry run: returns the number of model fits, peak memory and device.

## 8. Benchmarks

Shared protocol. Units are donors; pairs are called at BH q at most 0.05; seeds are 12345 plus replicate offsets; B = 100. Accuracy benchmarks use generator G, built with SERGIO [R14]:

1. Draw a directed GRN on 200 genes with 10 regulators.
2. Condition 1 uses G. Condition 2 re-weights 20 edges by a factor in [0.25, 0.5] or [2, 4]; B2 skips this step.
3. Adjust each gene's basal rate in condition 2 until its mean is within 5% of condition 1.
4. Per donor, multiply basal rates by lognormal effects (sigma 0.3) and draw a library-size factor.
5. Simulate 200 cells per donor and keep UMI counts.
6. Truth: a pair is positive when $|\rho^{(2)}-\rho^{(1)}|\ge0.2$, with $\rho$ the correlation of expected expression across cells, estimated from $10^5$ cells per condition. Re-weighted TF-target edges are positive.

### B1. Planted rewiring with matched means

- **Goal**: recover planted pairs whose correlation changes while marginal means are matched.
- **Ground truth**: planted simulation (step 6); estimand: difference of expected-expression correlations, on the simulator's mean scale.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Generator G, 6 versus 6 donors | SERGIO [R14] | simulated UMI counts, 200 genes, 200 cells per donor | — | 20 seeds |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC | BEELINE AUPRC over the tested universe (directed for edges, unordered for pairs), absolute score as confidence | higher | primary | [R5] |
| AUPRC ratio | AUPRC divided by positive prevalence | higher | primary | — |
| EPR | BEELINE early precision divided by prevalence, tie-aware, k equal to the number of positives | higher | guardrail | [R5] |

- **Comparators**: cscore; NEBULA co-expression [R13]; arboreto edge differencing [R10]; a DE-only baseline (both genes differential in replicate-aware DE).
- **Protocol**: 20 seeds at the step-6 threshold; report separately planted pairs not both of whose genes are differential (per-gene DE q above 0.05).
- **Acceptance criterion**: proposal. On the discriminating subset, AUPRC ratio at least 2 and EPR at least twice the DE-only baseline, averaged over seeds.
- **Known pitfalls**: a simulator's network and an inference prior can coincide, which is circular. Matching means does not match variances, so a variance change can look like a correlation change.

### B2. Null calibration without rewiring

- **Goal**: test that cscore keeps its false-positive rate when no pair is rewired.
- **Ground truth**: null by construction (steps 1 and 3 to 5, with condition 2 identical to condition 1). The true difference is zero for every pair.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Generator G, 10 versus 10 donors | SERGIO [R14] | simulated UMI counts, 200 genes, 100 replicates | — | C(20,10) = 184,756 partitions |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Rejection rate | mean over replicates of the fraction of pairs with q at most 0.05 | lower | primary | — |
| Replicates with a call | share of replicates with at least one pair at q at most 0.05 | lower | guardrail | — |

- **Comparators**: cscore; a cell-level control that permutes condition labels over cells; arboreto edge differencing [R10].
- **Protocol**: 100 replicates with B = 100. The cell-level control uses the same pair statistic.
- **Acceptance criterion**: proposal. cscore rejection rate between 0.02 and 0.08, and the cell-level control above 0.2, showing the check has power.
- **Known pitfalls**: at B = 100 the p-value resolution is 0.02, so tests are coarse. Simulated donors are exchangeable by construction, which real donors may not be.

### B3. Held-out prior edges in CD14 monocytes

- **Goal**: test whether high-scoring TF–target pairs are enriched for edges in a prior network not used to build regulons.
- **Ground truth**: held-out membership in BEELINE human ChIP-seq networks [R5], a weak signal rather than a causal truth; universe: TF→target pairs within the scored genes (BEELINE's TF-edge mode).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| CD14 monocytes, SARS-CoV-2 immune atlas | CS-CORE vignette object (section 12) | human scRNA-seq, 8285 COVID-19 and 2054 healthy cells from 7 and 6 donors | — | top 1000 genes |
| BEELINE human ChIP-seq network | [R5] | human TF→target edges | — | evaluation prior only |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC | ROC of pair score against prior membership, for TFs detected in at least 10% of cells per condition (proposed) | higher | primary | — |
| Enrichment | one-sided hypergeometric test of prior edges among the top k pairs; odds ratio and BH q | higher | guardrail | — |

- **Comparators**: cscore on TF-target pairs; regulon_limma with CollecTRI [R8] and DoRothEA [R9] regulons; arboreto edge differencing [R10]; expression-matched random TF-target pairs.
- **Protocol**: CD14 monocytes only; B = 100; seed 12345.
- **Acceptance criterion**: proposal. AUROC at least 0.55 and enrichment q below 0.05; beats the random baseline.
- **Known pitfalls**: prior coverage favours well-studied TFs and highly expressed targets. ChIP-seq edges are not condition-specific.

### P1. Performance and scaling

Scales: $10^4$, $10^5$ and $10^6$ cells; 6, 20 and 100 donors; 500, 2,000 and 5,000 genes (1.25×$10^5$, 2×$10^6$ and 1.25×$10^7$ pairs); B = 100 and 500. Comparators: diff_CSCORE with one and eight cores [R1]; WGCNA modulePreservation with 100 permutations [R4]; hdWGCNA ModulePreservation with 500 [R3]; a decoupleR ULM with a donor-level test; arboreto GRNBoost2 per condition [R10]. Hold fixed: raw counts, gene set, donor-to-group assignment and seed 12345, on CPU and CUDA. Record wall-clock seconds, peak RSS, CS-CORE fits ($2+2B$) and null-array bytes $p^2B\cdot8$: 0.8 GB at $p=1000$, $B=100$, and 20 GB at $p=5000$, $B=100$. Streaming is not claimed.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
  - `grn.prior_network_curation`: Curated TF-target prior network (regulon resource) construction
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
- **Feeds**:
  - `grn.upstream_regulator_inference`: Upstream TF (master regulator) inference from a differential signature
  - `grn.causal_edges_from_perturbation`: Causal gene-to-gene edges from interventional single-cell data
- **Reads**: `layers/counts`, `layers/lognorm`, `obs/<sample_key>`, `obs/<condition_key>`, `obs/<celltype_key>`, `uns/regulon_<prior>`
- **Writes**: `uns/rewiring_<method>_edges`, `uns/rewiring_<method>_regulons`, `uns/rewiring_<method>_params`
<!-- CHAINING:AUTO:END -->

Used after replicate-aware condition DE, so that mean-level change is separated from second-order change.

## 10. Risks, pitfalls and open questions

- Not read or not stated: the CS-CORE paper (README, vignettes and code were used); DiffCoEx, with no repository in the local corpus, so excluded from section 4; the SCENIC+ differential step; NEBULA's co-expression code; GRNBoost2's own paper and the GENIE3 DOI, neither in the repository; and dataset and simulator terms.
- Unsettled: no accepted benchmark for differential rewiring exists. Calibrating edge differences between independent fits is unsolved, and separating rewiring from mean and variance change in latent-count models is assumed rather than shown.
- Risks: six healthy donors in the CD14 design give 20 partitions, so real-data calibration falls back to simulation (B2). The cross-product variant is untested, and several repositories cannot be ported (section 12).
- First experiment: B2 at B = 100 on simulated donors for cscore and the cell-level control, before any real-donor call.

## 11. References

R1. Su C, et al. Cell-type-specific co-expression inference from single cell RNA-sequencing data. *Nature Communications* 14:4846, 2023. doi:10.1038/s41467-023-40503-7 — verified (corpus)
R2. Langfelder P, et al. Is my network module preserved and reproducible? *PLoS Computational Biology* 2011. doi:10.1371/journal.pcbi.1001057 — partial (repo)
R3. Morabito S, et al. hdWGCNA identifies co-expression networks in high-dimensional transcriptomics data. *Cell Reports Methods* 2023. https://www.cell.com/cell-reports-methods/fulltext/S2667-2375(23)00127-3 — partial (repo)
R4. Langfelder P, Horvath S. WGCNA: an R package for weighted correlation network analysis. *BMC Bioinformatics* 2008. doi:10.1186/1471-2105-9-559 — partial (repo)
R5. Pratapa A, et al. Benchmarking algorithms for gene regulatory network inference from single-cell transcriptomic data. *Nature Methods* 2020. doi:10.1038/s41592-019-0690-6 — verified (corpus)
R6. Badia-i-Mompel P, et al. decoupleR: ensemble of computational methods to infer biological activities from omics data. *Bioinformatics Advances* 2022. doi:10.1093/bioadv/vbac016 — verified (corpus)
R7. Ritchie ME, et al. limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 2015. doi:10.1093/nar/gkv007 — verified (corpus)
R8. Muller-Dott S, et al. Expanding the coverage of regulons from high-confidence prior knowledge for accurate estimation of transcription factor activities. *Nucleic Acids Research* 2023. doi:10.1093/nar/gkad841 — verified (corpus)
R9. Garcia-Alonso L, et al. Benchmark and integration of resources for the estimation of human transcription factor activities. *Genome Research* 2019. doi:10.1101/gr.240663.118 — verified (corpus)
R10. Huynh-Thu VA, et al. Inferring regulatory networks from expression data using tree-based methods. *PLoS ONE* 2010. — partial (repo)
R11. Aibar S, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — verified (corpus)
R12. Bravo Gonzalez-Blas C, et al. SCENIC+: single-cell multiomic inference of enhancers and gene regulatory networks. *Nature Methods* 2023. doi:10.1038/s41592-023-01938-4 — verified (corpus)
R13. He L, et al. NEBULA is a fast negative binomial mixed model for differential or co-expression analysis of large-scale multi-subject single-cell data. *Communications Biology* 2021. doi:10.1038/s42003-021-02146-6 — verified (corpus)
R14. Dibaeinia P, et al. SERGIO: a single-cell expression simulator guided by gene regulatory networks. *Cell Systems* 2020. doi:10.1016/j.cels.2020.08.003 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/ChangSuBiostats/CS-CORE | Chang Su, Zichun Xu, Xinning Shan (DESCRIPTION) | MIT (LICENSE: MIT License; DESCRIPTION: MIT + file LICENSE) | diff_CSCORE and CSCORE estimator | port |
| https://github.com/scverse/decoupler | Pau Badia i Mompel (pyproject.toml) | BSD-3-Clause (LICENSE; copyright scverse) | ULM activity scoring | port |
| https://github.com/smorabit/hdWGCNA | Sam Morabito, Zechuan Shi, Swarup Lab (DESCRIPTION) | GPL-3 (DESCRIPTION); the LICENSE file is a stub that names no licence | module preservation wrapper | reimplement |
| WGCNA, CRAN package (no repository URL in DESCRIPTION) | Peter Langfelder, Steve Horvath and others (DESCRIPTION) | GPL (>= 2) | modulePreservation reference | reimplement |
| https://github.com/tmoerman/arboreto | Thomas Moerman (LICENSE, setup.py) | BSD-3-Clause | GRNBoost2 and GENIE3 comparator | callout |
| http://scenic.aertslab.org (AUCell, Bioconductor R package) | Sara Aibar, Stein Aerts (DESCRIPTION) | GPL-3 | AUCell comparator | callout |
| https://github.com/lhe17/nebula | Liang He (aut, cre), Raghav Sharma (ctb) (DESCRIPTION) | MIT + file LICENSE | co-expression comparator | callout |
| https://github.com/aertslab/scenicplus | Seppe De Winter, Carmen Bravo (pyproject.toml) | Academic Non-commercial Software License Agreement (LICENCE.txt) | eRegulon comparator, multiome only | callout |
| https://github.com/Murali-group/Beeline | — | GPL-3.0 (LICENSE) | BEELINE metric definitions and reference networks | callout |
