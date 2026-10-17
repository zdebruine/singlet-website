---
id: cell-state.developmental_potency_scoring
title: Developmental potency and stemness scoring
area: cell-state
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [harmonization.gene_identifier_mapping, normalization.size_factor_estimation, qc.low_quality_cell_detection]
feeds: [trajectory.root_identification, trajectory.pseudotime_ordering]
reads: [layers/counts, layers/lognorm, uns/ppi_adjacency]
writes: [obs/potency_score, obs/potency_pseudotime, obs/potency_raw, var/potency_gene_corr, var/potency_correlates, uns/potency_params]
devices: [cpu, cuda]
mcp_tool: singlet_cell_state_developmental_potency_scoring
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Developmental potency and stemness scoring

> Scores each cell's developmental potency from one transcriptome with a published proxy, scaled within the dataset so that higher means more primitive; it does not assign fates or root cells.

## 1. Question

How developmentally potent, meaning close to the root of its differentiation hierarchy, is each cell, estimated from one count matrix? Inputs are raw counts, a normalised layer for network methods and a symmetric gene-by-gene PPI adjacency for those methods. Outputs are a score in [0,1], its pseudotime complement and the raw statistic. A correct answer orders cells by potency as measured by ground truth that shares no features with the score.

## 2. Why this task matters and where the field stands

Potency is a position in a hierarchy, and a single snapshot has no time axis, so methods rely on molecular proxies. The main proxy is transcriptional diversity: the number of expressed genes falls as cells commit [R1]. A second family uses network entropy, which assumes that potent cells spread expression over many interaction-network nodes [R2][R6]. Transcriptome entropy over gene shares is a cluster-based alternative [R3]. A learned successor, CytoTRACE 2, is reported by its authors to outperform earlier methods [R4], and a stemness index trained on bulk pluripotent profiles has been proposed [R5].

The task is **contested**. Diversity measures rise with library size, so depth confounding is the central open problem. Network scores depend on gene identifiers and PPI coverage. Whether potency and trajectory pseudotime agree is unresolved. Evidence gaps are listed in section 10.

## 3. Theory and insight

### 3.1 Estimands

Each method maps the counts $x_{gc}$ of cell $c$ to a raw statistic. For every method the score is that statistic min-max scaled within the dataset.

- **CytoTRACE.** $n_c=\sum_g\mathbf 1[x_{gc}>0]$, and $r_g$ is the Pearson correlation of $x_{gc}$ with $n_c$ across cells. The raw statistic is the unnormalised mean of the 200 most positively correlated genes; pseudotime is one minus the score.
- **SCENT SR.** The signalling entropy rate of an expression-weighted walk on the PPI, divided by $\log\lambda_{\max}(A)$, the log of the leading eigenvalue of the unweighted adjacency. It lies in $[0,1]$ because the entropy rate of any stationary chain on the graph is at most $\log\lambda_{\max}(A)$.
- **CCAT.** The Pearson correlation over shared genes between $\log_2(x_{gc}+c)$ and PPI degree $k_g$, in $[-1,1]$.
- **StemID2 entropy.** The Shannon entropy of gene shares $p_{gc}=x_{gc}/\sum_{g'}x_{g'c}$, divided by $\log G$, in $[0,1]$.

For SCENT, with symmetric adjacency $A$ and per-gene expression $e_j>0$ on the log scale:

$$P_{ij}=\frac{A_{ij}e_j}{s_i},\quad s_i=\sum_j A_{ij}e_j,\quad \pi_i=\frac{e_is_i}{\sum_k e_ks_k},\quad S_i=\log s_i-\frac{1}{s_i}\sum_j A_{ij}e_j\log(A_{ij}e_j),\quad \mathrm{SR}=\frac{\sum_i\pi_iS_i}{\log\lambda_{\max}(A)}$$

Symmetry of $A$ gives $\sum_i\pi_iP_{ij}=\pi_j$, so $\pi$ is the stationary law. The regime is a connected symmetric network on the used genes, with $e_j>0$ and $s_i>0$.

### 3.2 Depth dependence

With gene shares $p_g$ and library size $d_c$, Poisson sampling gives $\mathbb E[n_c]=\sum_g(1-e^{-p_g d_c})$. This rises with $d_c$ and saturates at high depth; the rise is first order where most $p_g d_c\ll 1$. CytoTRACE ranks genes through $n_c$, and StemID2 entropy is computed on sparse shares, so both inherit depth. Detected-gene counts are invariant to per-cell rescaling, but they still rise with sequencing depth.

### 3.3 Insight and what a model adds

The SCENT authors report that the network entropy measure is more accurate and robust than other entropy measures [R2]. Diversity and entropy proxies both correlate with potency in the benchmarks their authors report, and both are depth sensitive. A heuristic returns a number. A fitted ordinal model returns category probabilities with a predictive distribution, can learn depth invariance from augmentation rather than assume it, and can be reused across studies.

### 3.4 Assumptions and failure modes

Diversity scores assume a monotone relation between gene detection and diversity over the sampled range. Network scores assume that potent cells over-express network hubs and that the signal depends on the scale-free structure of the network [R7]; they need at least 5000 shared genes. Transcriptome entropy assumes that gene-share entropy tracks potency rather than sampling. Learned models assume transfer across platforms and studies, and their labels must not share features with the score.

### 3.5 Estimands of ground truth

- **Ordinal potency**: index 1 differentiated, 2 unipotent, 3 oligopotent, 4 multipotent, 5 pluripotent, 6 totipotent, one per cell, unnormalised; tied labels average their ranks.
- **Embryonic day**: sampling day per cell, unnormalised; a correlate of potency, not potency itself.
- **Planted level**: $L_c=D-d_c$, with $d_c$ the number of branch points from the root to the cell's node, so the root has $L_c=D$.
- **Library size**: total simulated counts per cell after thinning.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CytoTRACE | heuristic | Mean of the most detection-correlated genes | [R1], [R8] |
| CytoTRACE 2 | model-based | Ensemble of binary gene-set networks trained on potency categories, then diffusion and kNN smoothing | [R4] |
| SCENT signalling entropy rate | heuristic | Entropy rate of an expression-weighted random walk on a PPI | [R2], [R6] |
| CCAT | heuristic | Expression-degree correlation over shared genes, a fast proxy of SR | [R2] |
| StemID2 entropy | heuristic | Normalised Shannon entropy of per-cell gene shares | [R3] |

The published standards are CytoTRACE for diversity and SCENT for network entropy, with CCAT as the fast proxy of SCENT. CytoTRACE 2 is the learned reference, and StemID2 contributes its per-cell entropy only.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| CytoTRACE | detected-gene count | non-zero entries of the count matrix | `src/cellrank/kernels/_cytotrace_kernel.py:183` (CellRank, sha —) |
| CytoTRACE | gene correlation | Pearson with detected-gene count | `_cytotrace_kernel.py:186`; helper `src/cellrank/_utils/_utils.py:493` (sha —) |
| CytoTRACE | averaging layer | imputed (CellRank default) | `_cytotrace_kernel.py:113`; docstring `:73-75` |
| CytoTRACE | aggregation | mean | `_cytotrace_kernel.py:114` |
| CytoTRACE | top genes | 200 | `_cytotrace_kernel.py:116` |
| CytoTRACE | score | min-max; pseudotime = 1 − score | `_cytotrace_kernel.py:199-203` |
| SCENT | log trigger | if max > 100, log2(x + 1.1) | `R/DoIntegPPI.R:87-88` @ 02b4bc6 |
| SCENT | minimum shared genes | 5000 (stop below) | `R/DoIntegPPI.R:95-96` @ 02b4bc6 |
| SCENT | network | largest connected component | `R/DoIntegPPI.R:105-107` @ 02b4bc6 |
| SCENT | normalisation | divide by log λmax (ARPACK, nev 1, LM) | `R/CompSRana.R:117-126` @ 02b4bc6 |
| CCAT | log trigger | if max > 100, log2(x + 1) | `R/CompCCAT.R:53-54` @ 02b4bc6 |
| CCAT | minimum shared genes | 5000 (stop below) | `R/CompCCAT.R:63-64` @ 02b4bc6 |
| CCAT | statistic | Pearson: dense `cor` at :71, sparse `corSparse` at :74 | `R/CompCCAT.R:71,74` @ 02b4bc6 |
| StemID2 | entropy pseudocount | 1e-10 inside the log, normalised by log G | `R/StemID.R:100-102` @ 403c1f2 |
| CytoTRACE 2 (comparator) | species | mouse | `cytotrace2_r/R/cytotrace2.R:78` @ 33b9c6b |
| CytoTRACE 2 (comparator) | batch size | 10000 (R); 20000 (Python) | `cytotrace2.R:81`; `cytotrace2_python/cytotrace2_py/cytotrace2_py.py:83` |

## 5. Proposed singlet approach

The default is the CytoTRACE estimator computed on counts for detection, correlation and averaging, not on CellRank's imputed layer, so the depth guardrail sees the same input as the score. An imputed layer can be passed through `layer` and is recorded in `uns/potency_params`. SCENT SR and CCAT are sparse products over the PPI, $s=Ae$, with stationary weights and node entropies as row reductions over non-zero entries and the eigenvalue computed once per network. StemID2 contributes its per-cell entropy only. Routes are in section 12.

The model-based candidate is an ordinal cumulative-logit model, $P(Y_c\le k)=\sigma(\theta_k-\mathbf w^\top\mathbf x_c)$, on log-normalised expression, scored by $\mathbb E[Y_c]$ rescaled within the dataset. It is trained in PyTorch on catalogue studies with random binomial thinning, so library size is an augmented nuisance. Labels come from a lineage-to-potency mapping, checked for correlation with detected-gene count before training, and evaluation is leave-one-study-out. Inference is one sparse product and a sigmoid, small enough for hard-coded CUDA. The candidate is falsified if it fails the acceptance criteria of B1 or B3, and it enters the method enum only if it passes both.

Defaults for an agent: `method` cytotrace, `layer` counts, `device` auto and `log_transform` false. CytoTRACE is the default because it needs no network; the network methods are opt-in.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw counts; used by cytotrace and stemid_entropy |
| read | layers/lognorm | sparse float | size-normalised values for scent_sr and ccat |
| read | uns/ppi_adjacency | sparse, symmetric | gene-by-gene PPI adjacency; identifiers matched to var_names |
| write | obs/potency_score | float32 | min-max score in [0,1] within the dataset; higher is more potent |
| write | obs/potency_pseudotime | float32 | one minus potency_score |
| write | obs/potency_raw | float32 | unnormalised statistic of the chosen method |
| write | var/potency_gene_corr | float32 | cytotrace gene correlations with detected-gene count |
| write | var/potency_correlates | bool | cytotrace genes averaged into the score |
| write | uns/potency_params | dict | method, layer, parameters, PPI identifier and version |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "cytotrace" | `cytotrace`, `scent_sr`, `ccat`, `stemid_entropy` | Scoring rule. cytotrace is the default; scent_sr and ccat need ppi_network and a normalised layer; stemid_entropy is per-cell entropy only. |
| `layer` | string | "counts" | — | Expression layer read. Keep counts for cytotrace and stemid_entropy; scent_sr and ccat need a normalised layer such as lognorm. |
| `log_transform` | boolean | false | — | Apply log2(x + pseudocount) before scent_sr or ccat; set true only when the layer holds size-normalised counts. |
| `ppi_network` | string | — | — | Symmetric gene-by-gene PPI adjacency as a uns key or file path; required for scent_sr and ccat; largest component used. |
| `cytotrace` | object | — | — | CytoTRACE options: number of top-correlated genes averaged and the aggregation rule. |
| `cytotrace.n_genes` | integer | 200 | min 1 | Number of top positively correlated genes averaged into the score. |
| `cytotrace.aggregation` | string | "mean" | `mean`, `median`, `hmean`, `gmean` | Aggregation of the selected genes' expression per cell. |
| `scent` | object | — | — | SCENT options: minimum overlap with the PPI and the log pseudocount used when log_transform is true. |
| `scent.min_overlap_genes` | integer | 5000 | min 1 | Stop if fewer genes are shared with the PPI than this. |
| `scent.log_pseudocount` | number | 1.1 | > 0 | Pseudocount c in log2(x + c) for scent_sr. |
| `ccat` | object | — | — | CCAT options: minimum overlap with the PPI and the log pseudocount. |
| `ccat.min_overlap_genes` | integer | 5000 | min 1 | Stop if fewer genes are shared with the PPI than this. |
| `ccat.log_pseudocount` | number | 1.0 | > 0 | Pseudocount c in log2(x + c) for ccat. |
| `stemid_entropy` | object | — | — | StemID2 per-cell entropy option. |
| `stemid_entropy.pseudocount` | number | 1e-10 | > 0 | Pseudocount added inside the logarithm of the gene-share entropy. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Parameters are scoped by method. `layer` applies to all methods; `cytotrace` to cytotrace; `stemid_entropy` to stemid_entropy; `ppi_network` and `log_transform` to scent_sr and ccat; `scent` to scent_sr; `ccat` to ccat. A parameter given for another method is an error. Every method writes its score with higher meaning more potent.

## 7. MCP tool

Tool name `singlet_cell_state_developmental_potency_scoring` (definition in `tasks/mcp/singlet_cell_state_developmental_potency_scoring.json`). Example call and result:

```json
{"dataset": "pancreas.singlet", "method": "cytotrace"}
```

```json
{
  "dataset": "pancreas.singlet",
  "status": "completed",
  "wrote": ["obs/potency_score", "obs/potency_pseudotime", "obs/potency_raw", "var/potency_gene_corr", "var/potency_correlates", "uns/potency_params"],
  "summary": {"method": "cytotrace", "n_cells": 2850, "n_top_genes": 200, "score_min": 0.0, "score_max": 1.0},
  "provenance_id": "example"
}
```

Long-running: network scoring at atlas scale can be queued. Stochastic: no. Dry run returns time and memory estimates from non-zero entries and PPI edges, without writing.

## 8. Benchmarks

All methods read the same raw counts, or the processed matrix a benchmark names, with the same gene filter; network methods use the same PPI restricted to shared genes. No method or parameter is tuned on an evaluated dataset. Results are reported per dataset, then as mean and minimum across datasets. Tied labels take average ranks, and a metric undefined for a dataset is reported as missing, not zero. CytoTRACE 2 is a reference comparator only, with the settings in section 4.

### B1. Ordinal agreement with expert potency categories

- **Goal**: whether the score orders cells by the potency category of their phenotype within a dataset.
- **Ground truth**: expert labels. The file's phenotype annotation is mapped by the CytoTRACE 2 README to a category index: multipotent progenitors 4; endocrine progenitors, precursors and immature endocrine cells 2; alpha, beta, delta and epsilon cells 1. Estimand: the unnormalised index per cell.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pancreas_10x_downsampled | CytoTRACE 2 README [R4] (README.md:148); study [R9] | 10x Chromium, mouse pancreas, 2850 cells, four embryonic stages | — | Only dataset for this benchmark |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Spearman | score against category index; tied labels average ranks | maximise | primary | — |
| Concordance | label-discordant pairs ordered correctly by score; ties count 0.5 | maximise | primary | — |
| Within-phenotype depth | absolute Spearman of score with log detected-gene count, within phenotypes of at least 50 cells; median | minimise | guardrail | — |

- **Comparators**: CytoTRACE (singlet implementation), SCENT SR, CCAT, StemID2 entropy, log detected-gene count, CytoTRACE 2 (reference).
- **Protocol**: the depth guardrail is within phenotype, because the category is constant within one and a label-conditioned partial correlation is undefined.
- **Acceptance criterion**: proposed. The section 5 candidate is within 0.02 of the best comparator on every dataset in the table, with the guardrail at most 0.2 on each.
- **Known pitfalls**: most cells share a phenotype, so ties dominate concordance.

### B2. Within-lineage ordering against embryonic day

- **Goal**: whether the score falls with developmental time within each lineage, using a label independent of the score.
- **Ground truth**: orthogonal measurement. The label is the unnormalised sampling embryonic day; time correlates with potency and is not potency itself.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| GSE75748 vignette matrix | GEO GSE75748 as cited by the SCENT vignette (SCENT.Rmd:59; processed matrix :155) | scRNA-seq, species —, 447 cells, seven time points | — | Normalised, log-transformed, genes mapped to 16,119 human homologs |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Within-lineage Spearman | score against negative day, per lineage with at least 20 cells per time point; median over lineages | maximise | primary | — |
| Across-lineage association | absolute Spearman of lineage mean score against lineage mean day; no threshold | minimise | guardrail | — |

- **Comparators**: CytoTRACE, SCENT SR, CCAT, log detected-gene count.
- **Protocol**: all methods read the vignette matrix, with CytoTRACE using it in place of counts (a stated deviation); lineages failing the 20-cell rule are omitted and counted.
- **Acceptance criterion**: proposed. Primary metric at least 0.5 and not below the best comparator minus 0.05.
- **Known pitfalls**: late time points hold lineage-restricted cells with low potency, so a positive correlation shows ordering, not potency; the 20-cell rule removes many lineages.

### B3. Planted-depth simulation with library-size decoupling

- **Goal**: whether the score recovers a planted potency level on a lineage tree and is invariant to library size.
- **Ground truth**: planted simulation. Level $L_c=D-d_c$ (section 3.5); library size is the realised total count per cell; both unnormalised.
- **Generator** (proposed settings): rooted binary trees of depth $D\in\{2,\dots,6\}$, balanced (A) or randomly split (B); node means over $G=2000$ genes are a background plus a 50-gene block per branch; A removes background genes per level, B keeps the expressed count fixed; 5000 cells per dataset are uniform over nodes; size factors are log-uniform over 10-fold; binomial thinning $t_c\in[0.1,1]$ is independent of depth; five seeds.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated lineage counts, designs A and B | generator above | simulated, 2000 genes, 5000 cells per dataset | — | Five seeds per design and depth |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Spearman with planted level | score against $L_c$ per dataset; median and IQR over seeds | maximise | primary | — |
| Library-size association | absolute Spearman with library size; median over seeds | minimise | guardrail | — |

- **Comparators**: CytoTRACE, CCAT, SCENT SR, StemID2 entropy, log detected-gene count.
- **Protocol**: identical counts for all methods. Network methods use a seeded scale-free PPI on the same genes, with planted blocks unaligned to its hubs (a negative control).
- **Acceptance criterion**: proposed. Primary metric at least 0.8 on design B; guardrail at most 0.1 on both designs.
- **Known pitfalls**: design A builds in the diversity hypothesis and favours diversity scores; design B discriminates.

### P1. Performance and scaling

Wall time, peak memory and time per million cells at 10^4, 10^5 and 10^6 cells, with 10^7 as a stress test for CPU implementations. Comparators: CytoTRACE (CellRank, CPU), CCAT and SCENT SR (SCENT package), CytoTRACE 2 (R and Python, CPU, parallelisation settings fixed), and StemID2 at small scales only, where cluster projection dominates. Hold fixed the PPI restriction, count input, thread count, hardware and CytoTRACE 2 batch size. Report the empirical exponent of time against cells as a log-log slope. Proposed acceptance: singlet CPU CytoTRACE and CCAT exponents between 0.9 and 1.1, and at least twice as fast as the comparators at 10^6 cells. GPU SR is reported separately.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
- **Feeds**:
  - `trajectory.root_identification`: Root or start-state identification
  - `trajectory.pseudotime_ordering`: Pseudotime ordering along a lineage
- **Reads**: `layers/counts`, `layers/lognorm`, `uns/ppi_adjacency`
- **Writes**: `obs/potency_score`, `obs/potency_pseudotime`, `obs/potency_raw`, `var/potency_gene_corr`, `var/potency_correlates`, `uns/potency_params`
<!-- CHAINING:AUTO:END -->

No named recipe includes this task yet. It follows normalisation and QC and precedes root selection in trajectory analyses.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The diversity paper's validation design has no local source, so no benchmark is taken from it, and no cross-method comparison against depth-independent truth is available. CytoTRACE 2's benchmark protocol and training overlap are known only from its README, and its advantage only from a summary. The sorted-progenitor validation has no dataset and is not benchmarked. GSE75748 is stated only as human homologs. The bulk stemness index has no single-cell application, code or licence in the sources. The 2013 and 2015 SCENT-family papers have no DOI in the sources.
- **Unsettled literature.** No published depth-invariance control is in the sources. Network scores depend on gene identifiers, PPI version and the 5000-gene rule, with no sensitivity study known. Whether potency and pseudotime agree is open, since CytoTRACE defines pseudotime as one minus its score. Potency ground truth is annotation-based, so a non-circular source, such as lineage tracing or sorted populations, is still needed.
- **Technical and licence risks.** Licences of comparators and reference code are in section 12 and set the routes. CellRank's detection counts and gene correlations read `X` rather than the chosen layer, while its averages read the layer. SCENT and CCAT switch log transforms on a maximum-value rule that misfires on normalised data, so `log_transform` is explicit here. CytoTRACE 2 batch defaults differ between R and Python.
- **First experiment.** Score B3 design B and the B1 dataset with CytoTRACE, SCENT SR and CCAT on counts at 10^4 cells, recording each guardrail before any learned model is trained. Check the phenotype-to-potency mapping for correlation with detected-gene count before use.

## 11. References

R1. Gulati GS, et al. Single-cell transcriptional diversity is a hallmark of developmental potential. *Science* 2020;367(6476):405-411. doi:10.1126/science.aax0249 — verified (corpus)
R2. Teschendorff AE, Enver T. Single-cell entropy for accurate estimation of differentiation potency from a cell's transcriptome. *Nature Communications* 2017;8:15599. doi:10.1038/ncomms15599 — verified (corpus)
R3. Grün D, et al. De novo prediction of stem cell identity using single-cell transcriptome data. *Cell Stem Cell* 2016. doi:10.1016/j.stem.2016.05.010 — verified (corpus)
R4. Kang M, et al. Improved reconstruction of single-cell developmental potential with CytoTRACE 2. *Nature Methods* 2025. doi:10.1038/s41592-025-02857-2 — verified (corpus)
R5. Malta TM, Sokolov A, et al. Machine learning identifies stemness features associated with oncogenic dedifferentiation. *Cell* 2018. doi:10.1016/j.cell.2018.03.034 — partial (search)
R6. Banerji CRS, Miranda-Saavedra D, Severini S, Widschwendter M, Enver T, Zhou JX, Teschendorff AE. Cellular network entropy as the energy potential in Waddington's differentiation landscape. *Scientific Reports* 2013;3:3039. — partial (repo)
R7. Teschendorff AE, Banerji CRS, Severini S, Kuehn R, Sollich P. Increased signaling entropy in cancer requires the scale-free property of protein interaction networks. *Scientific Reports* 2015;5:8646. — partial (repo)
R8. Weiler P, Lange M, Klein M, Pe'er D, Theis F. CellRank 2: unified fate mapping in multiview single-cell data. *Nature Methods* 2024. doi:10.1038/s41592-024-02303-9 — verified (corpus)
R9. Bastidas-Ponce A, et al. Massive single-cell mRNA profiling reveals a detailed roadmap for pancreatic endocrinogenesis. *Development* 2019. doi:10.1242/dev.173849 — verified (corpus)

## 12. Code and software cited

Routes: **port** copies code under a permissive licence with its notice; **reimplement** writes the method from the equations in section 3 without copying code; **callout** uses the tool only as a comparator.

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/cellrank | Theis Lab (copyright line); CellRank 2 authors [R8] | BSD-3-Clause (LICENSE; pyproject.toml) | CytoTRACE re-implementation | port |
| https://github.com/aet21/SCENT | Andrew E Teschendorff (DESCRIPTION author and maintainer) | GPL-3 (DESCRIPTION; no LICENSE file at root) | SCENT and CCAT; GSE75748 vignette | reimplement |
| https://github.com/dgrun/RaceID3_StemID2_package | Dominic Grün (aut, cre) | GPL-3 (DESCRIPTION; no LICENSE file at root) | StemID2 per-cell entropy | reimplement |
| https://github.com/digitalcytometry/cytotrace2 | Kang M, et al.; developed in the Newman Lab, Stanford (README) | Stanford Non-Commercial Software License Agreement (LICENSE) | CytoTRACE 2 reference comparator and settings | callout |
