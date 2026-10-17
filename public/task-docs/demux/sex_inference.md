---
id: demux.sex_inference
title: Sex inference per sample, donor cluster or cell
area: demux
scope: core
paradigm: hybrid
literature_status: routine
priority: P2
depends_on: [harmonization.gene_identifier_mapping, qc.low_quality_cell_detection]
feeds: [demux.donor_assignment_reference_genotypes, demux.donor_deconvolution_reference_free, demux.sample_swap_detection]
reads: [layers/counts, var/gene_symbol, obs/donor_id]
writes: [obs/sex_call, obs/sex_score, uns/sex_inference]
devices: [cpu, cuda]
mcp_tool: singlet_demux_sex_inference
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Sex inference per sample, donor cluster or cell

> Calls each cell, and each donor or cluster, as female, male or ambiguous from XIST and chrY-linked expression, with a continuous score, and checks those calls against donor sex from genotypes.

## 1. Question

For each cell, and for each donor or cluster when a donor key is given, is the sample female, male or ambiguous, judged from XIST and chrY-linked expression? The input is raw UMI counts with gene symbols; the output is a sex call and a continuous score per cell, plus optional donor-level calls. A correct answer agrees with the donor's sex from genotypes, the orthogonal truth used in section 8.

## 2. Why this task matters and where the field stands

Sex labels check sample identity, expose swapped or mixed-sex samples, and supply the chromosome ploidy that genotype-based demultiplexing takes as an input (demuxlet, [R2]). In a pooled library, a cell that looks like the wrong sex points to ambient RNA or a cross-sex doublet, so the call doubles as a quality signal. The task is **routine**: a released rule exists and is the default in pegasus. Its accuracy is less settled. Benchmarks of pooled demultiplexing have used sex-linked genes as a validation reference rather than as a scored task [R1], and ambient RNA can place transcripts from one sample into cells of another [R4]. No cited source scores per-cell or per-donor sex calls against genotype-derived sex, so the accuracy of the default rule against an orthogonal label is not measured yet.

## 3. Theory and insight

Expression and genotype data measure sex through different signals. Female donors carry two X chromosomes, one largely silenced, and express XIST from the inactive copy. Male donors carry one X and a Y chromosome whose genes, among them RPS4Y1, DDX3Y and UTY, are expressed. A per-cell rule therefore asks whether XIST or Y-linked transcripts are detected, and detection depends on depth and dropout. Genotypes give allele-level evidence of copy state instead.

For a biallelic informative site with minor-allele frequency $q$, Hardy–Weinberg equilibrium gives
$$P(\text{het}\mid\text{diploid}) = 2q(1-q), \qquad P(\text{het}\mid\text{hemizygous}) \approx \varepsilon,$$
so heterozygous calls on non-pseudoautosomal chrX occur in female donors and, at error rate $\varepsilon$, in males. The regime is first order, unrelated donors and small $\varepsilon$. Over $S$ such sites, with $H_{\text{obs}}$ the observed heterozygous fraction and $H_{\text{exp}}=\frac{1}{S}\sum_{s}2q_s(1-q_s)$ its expectation,
$$F_X = 1-\frac{H_{\text{obs}}}{H_{\text{exp}}},$$
which is near 0 for females and near 1 for males. A statistic of this form is the chrX heterozygosity check in PLINK [R5]; here it serves only as the truth source (section 8), and it needs large $S$.

The expression score is the pegasus residual. Each gene $g$ in cell $i$ is standardised against the background of its expression bin $\beta(g)$:
$$z_{gi}=\frac{x_{gi}-\mu_g-\bar b_{i,\beta(g)}}{\sigma_{i,\beta(g)}}, \qquad s_i=\frac{1}{|G_M|}\sum_{g\in G_M}z_{gi}-\frac{1}{|G_F|}\sum_{g\in G_F}z_{gi},$$
with $G_M$ and $G_F$ the male and female panels. The regime is many cells, with background bins standing in for expression-matched controls. A one-dimensional k-means with $k=3$ on $s_i$ gives female, ambiguous and male clusters; its middle cluster is a data-driven bin with no noise model.

Estimands, one sentence each:
- $s_i$ is the per-cell difference of mean standardised residuals, in units of background standard deviation, and is not a probability.
- The cell truth is the sex of the cell's origin donor, and cell accuracy is the fraction of non-doublet cells with a definite call that match it.
- Balanced accuracy is the mean over the female and male classes of the fraction of each class called correctly, with ambiguous calls excluded and reported as abstention.
- The donor truth is female when $F_X<0.5$ and male otherwise, and donor accuracy is the fraction of donors called correctly.
- Cross-sex doublet recall is the fraction of doublets whose two donors differ in sex and whose cell calls are ambiguous.

Expression rules assume XIST or the Y panel is detected in most cells of the right sex. Low depth, dropout, loss of Y, ambient RNA from other donors and cross-mapping of X–Y paralogs (RPS4X sits in the female panel, RPS4Y1 in the male panel) each break that assumption. Karyotypes with both X and Y signal (XXY) or neither (X0) should be flagged rather than called. Genotype rules assume informative biallelic sites, Hardy–Weinberg equilibrium and correct PAR bounds. The pegasus "gender" score is a sex signal under its original name; reported sex, genetic sex and gender identity are separate labels and are kept apart. Pooled-demultiplexing benchmarks that validate sex with sex-linked genes are circular when sex also enters the demultiplexer [R1]. A heuristic gives one score and a split with no probability; a fitted likelihood gives a per-cell posterior, an explicit ambiguous band and a way to combine cells of one donor, which the rule cannot do (section 5).

## 4. Methods landscape

The released pegasus heuristic is the standard here and the comparator for every benchmark. Threshold rules on XIST and Y-gene counts are common, but no source with thresholds is cited, so none is listed or benchmarked as a named method; the detection baseline in section 8 stands in. The statistic $F_X$ in section 3 serves only as truth.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Pegasus gender score with three-way split | heuristic | Male minus female mean standardised residual per cell, split by k-means with k = 3 | [R3], for expression-binned control genes |

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| Pegasus gender score | female genes | XIST, DONSON, RPS4X | pegasus/data_files/gender_human.gmt, README line 7 @ 484617d |
| Pegasus gender score | male genes | RPS4Y1, EIF1AY, DDX3Y, USP9Y, UTY, LINC00278, TTTY14, KDM5D, NLGN4Y | pegasus/data_files/gender_human.gmt, README line 7 @ 484617d |
| Pegasus gender score | n_bins | 50 | pegasus/tools/signature_score.py:112-116 @ 484617d |
| Pegasus gender score | standardize | True | pegasus/tools/signature_score.py:115 @ 484617d |
| Pegasus gender score | score | male mean minus female mean | pegasus/tools/signature_score.py:227-228 @ 484617d |
| Pegasus gender score | k-means clusters | 3; centres sorted to female, ambiguous, male | pegasus/tools/signature_score.py:227-237 @ 484617d |
| Pegasus gender score | random_state | — | pegasus/tools/signature_score.py:233 @ 484617d |

## 5. Proposed singlet approach

**Port.** The pegasus score is ported: its panel, bins and split are reproduced with attribution under a permissive licence (section 12). The popscle sex map is a **callout** only: here sex is an input to donor assignment, not an output.

**Default.** `method = pegasus_score` with the section 4 values. Every proposal is measured against it.

**Proposed model.** Two classes $c\in\{F,M\}$ score each cell's panel counts with a zero-inflated negative binomial,
$$p(\mathbf{x}_i\mid c)=\prod_{g}\Big[\pi_{gc}\,\mathbb{1}[x_{gi}=0]+(1-\pi_{gc})\,\mathrm{NB}(x_{gi}\mid \ell_i\mu_{gc},\phi_g)\Big],$$
and the cell posterior $P(M\mid\mathbf{x}_i)$ follows from the class priors. Donor log-odds sum cell likelihood ratios, shrunk by $\rho\le 1$ fitted on held-out donors:
$$\operatorname{logit}P(M\mid d)=\operatorname{logit}\pi_M+\rho\sum_{i\in d}\log\frac{p(\mathbf{x}_i\mid M)}{p(\mathbf{x}_i\mid F)}.$$
Ambient RNA breaks gene independence, so the fit adds an ambient term. The proposal is rejected if its B2 per-cell AUROC does not exceed pegasus_score, or if its held-out donor probabilities are less well calibrated than the default's. It enters the MCP enum only once implemented and benchmarked.

**Stack.** Sparse EM runs in NumPy or SciPy for small inputs and in batched PyTorch at catalogue scale. The per-cell score is the hot path: a hard-coded CUDA/cuSPARSE sparse row-sum, $O(\mathrm{nnz})$, with a CPU reference.

**Streaming.** Scores stream in chunks; the split needs the full score vector, about 1.4 GB in float32 at 3.54e8 cells.

**Output rules.** A cell is ambiguous with fewer than `min_sex_umi` panel UMIs (default 3, proposed) or in the middle cluster. Donor calls need `pseudobulk_min_cells` cells (default 10, proposed). No mixed class is emitted; cross-sex doublets appear as ambiguous. Agent defaults: pegasus_score, the section 4 panel and `seed` 0.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, normalised internally to log1p counts per 10,000 |
| read | var/gene_symbol | string | symbols of the sex panel; Y-linked symbols must match the reference version |
| read | obs/donor_id | categorical | optional donor or sample grouping |
| write | obs/sex_call | categorical | female, male or ambiguous, per cell |
| write | obs/sex_score | float32 | pegasus gender score, per cell |
| write | uns/sex_inference | dict | method, panel, parameters, donor-level table, package version |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "counts" | — | Raw UMI count layer; normalised internally to log1p counts per 10,000. |
| `method` | string | "pegasus_score" | `pegasus_score` | Scoring rule; pegasus_score is the published default. |
| `donor_key` | string/null | null | — | obs column giving donor or sample; enables donor-level calls. Null gives per-cell calls only. |
| `truth_key` | string/null | null | — | obs column with genotype-derived sex for evaluation only; adds accuracy metrics to the summary. |
| `min_sex_umi` | integer | 3 | min 0 | Cells with fewer sex-panel UMIs are called ambiguous. |
| `pseudobulk_min_cells` | integer | 10 | min 1 | Minimum cells for a donor or cluster to receive a donor-level call. |
| `pegasus_score` | object | — | — | Options for the pegasus_score method only. |
| `pegasus_score.female_genes` | array | ["XIST", "DONSON", "RPS4X"] | — | Female-associated gene symbols; XIST carries most of the signal. |
| `pegasus_score.male_genes` | array | ["RPS4Y1", "EIF1AY", "DDX3Y", "USP9Y", "UTY", "LINC00278", "TTTY14", "KDM5D", "NLGN4Y"] | — | Y-linked gene symbols from the pegasus male set. |
| `pegasus_score.n_bins` | integer | 50 | min 1 | Expression bins for background genes in signature scoring. |
| `pegasus_score.standardize` | boolean | true | — | Standardise panel expression against the expression-bin background. |
| `pegasus_score.k_clusters` | integer | 3 | `3` | One-dimensional k-means clusters; 3 gives female, ambiguous and male. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for the one-dimensional k-means split. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`method` selects the rule; options under `pegasus_score` apply only to that method. `donor_key` and `truth_key` are optional obs columns. `truth_key` only adds accuracy metrics and is never used for calling. Without `donor_key`, only per-cell calls are returned. Symbols must match the annotation used to build the counts (see harmonization.gene_identifier_mapping).

## 7. MCP tool

Tool name `singlet_demux_sex_inference` (definition in `tasks/mcp/singlet_demux_sex_inference.json`). Example call and compact result; angle-bracketed values are placeholders.

```json
{"dataset": "pool01.singlet", "donor_key": "donor_id", "method": "pegasus_score", "pegasus_score": {"k_clusters": 3}, "seed": 0}
```

```json
{"dataset": "pool01.singlet", "status": "completed", "wrote": ["obs/sex_call", "obs/sex_score", "uns/sex_inference"], "summary": {"calls": {"female": "<n>", "male": "<n>", "ambiguous": "<n>"}, "n_donor_calls": "<k>"}, "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: a catalogue-scale input may return `queued` with a `job_id`. Stochastic: the one-dimensional split depends on `seed`, so a fixed seed reproduces the calls on the same build. Dry run: returns estimated seconds, peak memory and device from cell and panel counts.

## 8. Benchmarks

Shared protocol. Each rule is applied with its default panel and no sex label as input, on cells that pass QC (qc.low_quality_cell_detection). Donor truth is genotype-derived: $F_X$ from section 3 over informative non-PAR chrX sites, female when $F_X<0.5$ and male otherwise. The 0.5 cut is a proposal at the midpoint of the two expectations, and donors without informative sites are excluded. Reported sex is never truth. The only seeded step is the split, repeated with seeds 0 to 4, reported as median and range. Nothing is tuned on evaluation donors.

### B1. Pools of known donors with planted clusters

- **Goal**: Measure cluster-level sex calls and cross-sex doublet flagging in pools of donors with known sex.
- **Ground truth**: Planted simulation: each droplet carries its origin donor, so clusters and cross-sex doublets are known. Cluster accuracy is a fraction of clusters; cell accuracy is a fraction of non-doublet cells.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Pools of 2, 4 and 6 donors, doublet rates 0 to 30% | Pool design of [R1] | 10x RNA-seq, human heart per [R1]; donor genotypes | — | Clusters planted; deconvolution not scored |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| cluster_sex_accuracy | Fraction of clusters of at least 50 cells whose pseudobulk call matches donor sex; ambiguous counts as wrong | maximize | primary | — |
| cross_sex_doublet_recall | Fraction of cross-sex doublets whose cell calls are ambiguous | maximize | primary | — |
| cell_sex_accuracy | Fraction of non-doublet cells with a definite call matching origin-donor sex; abstention reported beside it | maximize | guardrail | — |

- **Comparators**: pegasus_score on pseudobulk and per-cell calls with cluster majority vote; detection baseline (female if XIST UMIs exceed zero and panel Y UMIs are zero, male in the reverse case, otherwise ambiguous).
- **Protocol**: Pool sizes 2, 4 and 6 across doublet rates from 0 to 30%; report each stratum with counts.
- **Acceptance criterion**: Proposed, not from the literature. cluster_sex_accuracy at least 0.98; cross_sex_doublet_recall at least 0.90 at doublet rates up to 10%.
- **Known pitfalls**: Planted clusters omit deconvolution error, so only the sex rules are measured. Sex used as a ploidy input to the deconvolution that forms the clusters makes the benchmark circular.

### B2. Individual donor samples, per-cell calls

- **Goal**: Measure per-cell sex-call accuracy and abstention in unpooled samples, stratified by depth.
- **Ground truth**: Consistency. Each cell inherits its sample donor's genotype-derived sex; without pooling, expression cannot define the label.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Individual samples from which the B1 pools are built | [R1] | 10x RNA-seq, human; one donor per sample | — | Same donors as B1, unpooled |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| per_cell_balanced_accuracy | Mean of female and male recall over informative cells (at least `min_sex_umi` panel UMIs); ambiguous cells excluded | maximize | primary | — |
| auroc_sex_score | Area under the ROC curve of sex_score against donor sex over informative cells; rank-based ties | maximize | primary | — |
| uninformative_fraction | Fraction of cells below `min_sex_umi`; never counted as correct | report | guardrail | — |
| decile_min_accuracy | Minimum balanced accuracy across total-UMI deciles of informative cells | maximize | guardrail | — |

- **Comparators**: pegasus_score; the detection baseline of B1.
- **Protocol**: Score every cell, compute metrics per total-UMI decile, and stratify by cell type where labels exist.
- **Acceptance criterion**: Proposed, not from the literature. auroc_sex_score at least 0.99; decile_min_accuracy at least 0.90.
- **Known pitfalls**: Cell-type composition shifts XIST and Y rates, so decile results can reflect composition. With few donors, intervals are wide, so counts accompany each rate.

### P1. Performance and scaling

Measure wall time, cells per second and peak resident memory for scoring at 1e4, 1e5, 1e6 and 1e7 cells, and at the singlet catalogue size of 3.54e8 cells. Comparators are the pegasus calc_signature_score on CPU, a naive SciPy CSR row-sum of the same score on CPU, and the proposed CUDA/cuSPARSE kernel. Hold fixed: the section 4 panel, the normalisation of section 6, `n_bins` 50, k = 3, CSR input with I/O excluded, and the thread count, which is reported. Each timing is repeated five times and the median reported. Proposed acceptance: labels identical to the reference except cells within floating-point tolerance of a split boundary; the GPU kernel at least 5 times faster than the Python CPU reference at 1e6 cells; memory linear in panel nonzeros.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
- **Feeds**:
  - `demux.donor_assignment_reference_genotypes`: Reference-based genotype donor assignment with doublet calling and cluster-to-individual mapping
  - `demux.donor_deconvolution_reference_free`: Reference-free donor deconvolution
  - `demux.sample_swap_detection`: Sample identity verification and swap detection
- **Reads**: `layers/counts`, `var/gene_symbol`, `obs/donor_id`
- **Writes**: `obs/sex_call`, `obs/sex_score`, `uns/sex_inference`
<!-- CHAINING:AUTO:END -->

Belongs to the identity-check and sample-QC steps that precede donor-level analysis.

## 10. Risks, pitfalls and open questions

- **First experiment and validation gap**: no cited source scores the pegasus score or the XIST and Y-gene rules against genotype-derived sex. The first experiment runs pegasus_score on the B1 pools and B2 samples before any model is built. The accessions and licence of those samples are not yet identified, so no data may be redistributed.
- **Unsourced biology**: XIST escape, loss-of-Y frequency and the XXY and X0 expression patterns are stated from general knowledge and cited nowhere here, so karyotype classes are flagged rather than benchmarked.
- **Unsettled design**: a mixed-sex class is needed for cross-sex doublets but this version emits none; the three-way split always makes a middle bin with no noise model; scoring after ambient correction is untested; the model in section 5 has no published implementation.
- **Inputs to pin**: the pegasus default for `random_state` is not stated here; line numbers refer to GitHub HEAD at check time (484617d), and the local copy has no commit metadata; whether the singlet catalogue carries donor-sex fields is unknown, which decides whether training labels come from catalogue metadata or from genotype-derived sex on sourced subsets.

## 11. References

R1. Fu Y, et al. Benchmarking of computational demultiplexing methods for single-nucleus RNA sequencing data. *Briefings in Bioinformatics* 2025;26(4):bbaf371. doi:10.1093/bib/bbaf371 — partial (search)
R2. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018;36(1):89-94. doi:10.1038/nbt.4042 — verified (corpus)
R3. Tirosh I, Izar B, Prakadan SM, et al. Dissecting the multicellular ecosystem of metastatic melanoma by single-cell RNA-seq. *Science* 2016. doi:10.1126/science.aad0501 — verified (corpus)
R4. Young MD, Behjati S. SoupX removes ambient RNA contamination from droplet-based single-cell RNA sequencing data. *GigaScience* 2020. doi:10.1093/gigascience/giaa151 — verified (corpus)
R5. Purcell S, Neale B, et al. PLINK: a tool set for whole-genome association and population-based linkage analyses. *American Journal of Human Genetics* 2007;81:559-575. doi:10.1086/519795 — partial (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/lilab-bcb/pegasus | Yiming Yang, Joshua Gould and Bo Li (setup.py) | BSD-3-Clause (LICENSE file) | Source of the default gene panel, bins and split | port |
| https://github.com/statgen/popscle | — | Apache-2.0 (LICENSE file) | Convention for sex as a ploidy input to genotype demultiplexing | callout |
