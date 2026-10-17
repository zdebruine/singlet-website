---
id: demux.sample_swap_detection
title: Sample identity verification and swap detection
area: demux
scope: extended
paradigm: model-based
literature_status: open
priority: P2
depends_on: [ingest-quant.read_to_gene_mapping, ingest-quant.umi_deduplication, cell-calling.cell_vs_empty_droplet_calling, cell-calling.nucleus_vs_empty_calling]
feeds: [qc.sample_level_qc, sample-level.patient_stratification]
reads: [layers/AD, layers/DP, obs/sample_id, uns/variant_index, uns/reference_genotypes, uns/claimed_map]
writes: [uns/sample_identity/score, uns/sample_identity/call, uns/sample_identity/swap_map, uns/sample_identity/contamination, obsm/donor_loglik]
devices: [cpu, cuda]
mcp_tool: singlet_demux_sample_swap_detection
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Sample identity verification and swap detection

> For each sample, test whether the genotypes in its cells match the individual it is claimed to come from, flag swaps and cross-sample contamination, and name the best-supported individual.

## 1. Question

For each sample, do the genotypes its cells carry match the individual the sample is claimed to come from? If not, which individual do they match, and does the sample also carry reads from other individuals? Input is per-cell allele counts at informative sites and an independent reference genotype for each claimed individual. Output is a match, swap or ambiguous call per sample, the best-supported individual and, optionally, a contamination fraction. A correct answer names the individual whose genotypes the sample's reads support.

## 2. Why this task matters and where the field stands

A sample swap or cross-sample contamination attaches one donor's data to another donor's label, which corrupts every sample-level comparison downstream. Status: **open**. Donor-level single-cell methods assign cells or clusters to individuals [R1][R2][R4][R5]; they do not test whether a whole sample matches its claimed individual. Bulk tools answer that question with genotype concordance or sketch comparison at high coverage per site [R6][R7]. Sparse single-cell counts give few reads per site, so bulk thresholds do not transfer. Ambient RNA from other samples can look like contamination or a mismatch [R9]. Ensemble demultiplexing combines several donor and doublet tools [R10]. The open problems are the absence of single-cell sample-level truth (section 8) and the confounding of swaps with ambient contamination.

## 3. Theory and insight

Sample $s$ has claimed individual $c_s$ and $N_s$ cells. Informative sites $v$ are biallelic sites where individuals differ in genotype. Individual $k$ has alternate-allele dosage $g\in\{0,1,2\}$ at $v$, with reference probabilities $\pi_{k,v,g}$.

**Per-cell likelihood (demuxlet).** The log-likelihood of cell $b$ under individual $k$ is
$$\ell_b(k)=\sum_v\log\sum_{g}P(R_{b,v}\mid g)\,\pi_{k,v,g},$$
where $R_{b,v}$ is the read evidence at site $v$ and $P(R\mid g)$ the normalised genotype likelihood. Sites are treated as independent, so linked sites overcount evidence.

**Genotype error.** With imputed references the per-site error is
$$\varepsilon_v=\varepsilon_0+(1-\varepsilon_0)\,c\,(1-R_v^2),$$
where $R_v^2$ is the imputation quality of site $v$ and $\varepsilon_0$, $c$ are the offset and slope in Section 4. The slope term vanishes when $c=0$, and $R_v^2$ is needed only when $c>0$.

**Contamination (proposed model).** For a sample with self dosage $g_v$, contamination fraction $\alpha$ and population alternate frequency $f_v$, the alternate-read count $a_v$ out of $d_v$ reads follows
$$a_v\mid d_v\sim\mathrm{Bin}\!\left(d_v,\;(1-\alpha)\tfrac{g_v}{2}+\alpha f_v\right),$$
and $\alpha$ is the maximum-likelihood fit over sites [R8]. The model ignores sequencing error. It is most informative at sites with $g_v=0$, where any alternate read indicates foreign reads.

**Cluster matching (Vireo).** Inferred donor probabilities $X$ and reference probabilities $Z$ are compared by
$$C_{ij}=\frac{1}{V}\sum_{v=1}^{V}\bigl|X_{v,i}-Z_{v,j}\bigr|,\qquad \sigma^*=\arg\min_\sigma\sum_i C_{i,\sigma(i)},$$
with $\sigma^*$ found by the Hungarian algorithm. Because Vireo's donor-VCF mode uses the reference as a prior, $X$ is pulled toward the claimed reference. $C$ then understates mismatch and cannot serve as an identity check unless the prior is removed.

**Proposed sample test.** Sum cell log-likelihoods over the sample:
$$S_{s,k}=\sum_{b\in s}\ell_b(k),\qquad \text{swap if }\arg\max_k S_{s,k}\neq c_s\ \text{and}\ S_{s,\hat k}-S_{s,c_s}>\tau.$$
This is a design built from the per-cell likelihood, not a published test.

**Estimands.** Each output has one normalisation.
- The sample score $S_{s,k}$ is a total in nats; the per-cell mean $S_{s,k}/N_s$ is reported beside it.
- The raw swap test decides on the total margin in nats; Section 5 replaces it with a calibrated log-odds.
- Contamination $\alpha_s$ is the fraction of informative reads in sample $s$ (not of cells) that come from individuals other than $c_s$.
- The corrected mapping is $\hat k_s=\arg\max_k S_{s,k}$.
- B1 truth is one label per sample from planting; no per-cell label is scored.

**Regime.** The sum assumes every cell in $s$ comes from one individual. Doublets, ambient RNA and contamination violate this. Under independence across cells, the expected margin grows linearly in $N_s$ at first order, so a fixed $\tau$ does not transfer across cell counts. Section 5 fits a scale to correct this.

**Insight.** Identity is decided at sites where the claimed individual's genotype differs from the alternatives. Power is the number of such sites covered by reads, summed over cells, so aggregating weak per-cell evidence makes a sample-level test feasible on sparse data. Failure modes are few covered sites in 3-prime data, doublets raising mismatch, relatives and twins, sex-linked loci, RNA-DNA allelic imbalance and editing, and reference mismatch.

**Complexity** (from structure, not measured): scoring costs $O(\mathrm{nnz}\times K)$ with sparse counts, aggregation is one sparse-dense product, and Hungarian matching is $O(K^3)$.

## 4. Methods landscape

Because no single-cell sample-level swap test serves as a standard, the comparators are the per-cell donor scorers and the bulk concordance heuristic (section 8). Genotype-free methods cannot verify identity alone, so they serve only as comparators.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| demuxlet (popscle) | model-based | Discrete-genotype mixture likelihood per barcode over donors and donor pairs, with an alpha grid for doublets | [R1] |
| Vireo, donor-VCF mode | model-based | Variational Bayes over cell-donor assignment and genotypes with the donor VCF as prior; donors matched to VCF samples by Hungarian matching | [R2] |
| souporcell | model-based | Genotype-free clustering of barcodes by alternate and reference counts at de novo SNVs; naming clusters needs external genotypes | [R4] |
| scSplit | model-based | Genotype-free hidden-state demultiplexing over distinguishing variants | [R5] |
| BAMixChecker-style concordance | heuristic | Pairwise genotype concordance over a SNP set, reporting matched or mismatched status | [R7] |

The defaults below are those the MCP tool inherits where it exposes them.

| Method | Parameter | Value | Source (file:line @ revision) |
|---|---|---|---|
| demuxlet | `--geno-error-offset` | 0.10 | README options list; cmd_cram_demuxlet.cpp:52 @ da70fc78 |
| demuxlet | `--geno-error-coeff` | 0.00 | cmd_cram_demuxlet.cpp:53 @ da70fc78 |
| demuxlet | `--alpha` grid | 0.1, 0.2, 0.3, 0.4, 0.5 in README; 0 and 0.5 when empty in source | README options list; cmd_cram_demuxlet.cpp:62, 85-88 @ da70fc78 |
| demuxlet | `--doublet-prior` | 0.5 | cmd_cram_demuxlet.cpp:32, 63 @ da70fc78 |
| demuxlet | normalised-likelihood pseudo-count | 1e-6 | cmd_cram_demuxlet.cpp:485-501 (approximate) @ da70fc78 |
| Vireo | `--nInit` (-M) | 50 | vireoSNP/vireo.py:59 @ e3654633 |
| Vireo | `--genoTag` (-t) | PL | vireoSNP/vireo.py:53 @ e3654633 |
| Vireo | `--nDonor` (-N) | donor VCF sample count when a VCF is given | vireoSNP/vireo.py:40, 175-176 @ e3654633 |
| Vireo | `n_GT` (Vireo class) | 3 | vireoSNP/utils/vireo_model.py, `Vireo.__init__` @ e3654633 |
| souporcell | k-harmonic mode | recommended above 16 donors | README lines 74, 102 @ 97fbf4de |

## 5. Proposed singlet approach

**Routes.** demuxlet is ported, and its per-barcode likelihood kernel feeds the sample scorer. Vireo, cellSNP-lite, souporcell and scSplit are callouts, serving as comparators or as the input format. The concordance heuristic is reimplemented (section 12).

**Proposed model.** The default `sample_aggregate` places a posterior over individuals on each sample:
$$P(k\mid s)\propto w_k\exp(\gamma\,S_{s,k}),$$
with a uniform or pedigree prior $w_k$. The scale $\gamma$ is fitted by maximum likelihood on the B1 calibration half. A value below one corrects the overconfidence of summing cells that share donor-level signal. A swap is called when the log-odds of the best alternative over $c_s$ exceed `swap_margin_tau`.

**Falsification.** Rejected if the fitted $\gamma$ drifts with $N_s$ or informative-site count on held-out strata, or if held-out swap_FPR exceeds 0.02 at contamination up to 0.05. The fallback is a per-site normalised margin.

**ML stack.** No learned component is needed. Per dosage state, the hot path is two sparse-dense products of the AD and DP matrices with log-genotype matrices, then a log-sum-exp over the three states and a per-sample segmented sum. This is hard-coded in CUDA with cuSPARSE, with the same reduction on CPU. PyTorch enters only if a learned calibrator is added; $\gamma$ is fitted in NumPy. Barcodes stream in blocks, because every per-sample quantity is a sum over cells.

**Defaults an agent should use without asking.** `method` sample_aggregate; `min_informative_sites` 50; `min_reads_per_site` 1; `swap_margin_tau` null, so only scores and match or ambiguous calls are written until B1 fits a value; `contamination.estimate` false until B2 passes; `device` auto.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/AD | sparse int, cells x sites | alternate-allele count per cell and site, cellSNP-style [R3] |
| read | layers/DP | sparse int, cells x sites | total informative count per cell and site |
| read | obs/sample_id | string | claimed sample for each barcode |
| read | uns/variant_index | table | chromosome, position, reference and alternate allele per site |
| read | uns/reference_genotypes | float, individuals x sites | dosage or genotype probabilities from an independent source |
| read | uns/claimed_map | dict | sample to claimed individual |
| write | uns/sample_identity/score | float64, samples x individuals | total log-likelihood in nats |
| write | uns/sample_identity/call | string per sample | match, swap or ambiguous |
| write | uns/sample_identity/swap_map | string per sample | best-supported individual |
| write | uns/sample_identity/contamination | float32 per sample | alpha with interval, when estimated |
| write | obsm/donor_loglik | float32, cells x individuals | optional per-cell log-likelihood |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "sample_aggregate" | `sample_aggregate`, `demuxlet`, `vireo_match` | sample_aggregate sums per-cell likelihoods per sample; demuxlet scores per barcode; vireo_match maps Vireo donors to references. |
| `min_informative_sites` | integer | 50 | min 1 | Samples with fewer informative sites covered by reads are ambiguous and never called swaps. |
| `min_reads_per_site` | integer | 1 | min 1 | Minimum reads at a site in a cell for that site to count. |
| `swap_margin_tau` | number/null | null | min 0 | Calibrated log-odds of the best alternative over the claimed individual needed for a swap call; null gives scores only. |
| `contamination` | object | {"estimate": false, "max_alpha": 0.2} | — | Contamination estimation settings. |
| `contamination.estimate` | boolean | false | — | Fit a per-sample contamination fraction by maximum likelihood. |
| `contamination.max_alpha` | number | 0.2 | min 0; max 0.5 | Upper bound of the contamination search. |
| `demuxlet` | object | — | — | Settings used only when method is demuxlet. |
| `demuxlet.geno_error_offset` | number | 0.1 | — | Offset of the genotype error rate. |
| `demuxlet.geno_error_coeff` | number | 0 | — | Slope of the genotype error rate against imputation R squared. |
| `demuxlet.alpha_grid` | array | [0.1, 0.2, 0.3, 0.4, 0.5] | — | Doublet mixture fractions searched; used only with method demuxlet. |
| `demuxlet.doublet_prior` | number | 0.5 | min 0; max 1 | Prior probability of a doublet. |
| `vireo` | object | — | — | Settings used only when method is vireo_match. |
| `vireo.n_init` | integer | 50 | min 1 | Random restarts of the variational fit. |
| `vireo.genotype_tag` | string | "PL" | — | FORMAT field read from the donor VCF. |
| `seed` | integer | 0 | — | Random seed for vireo_match restarts; other methods are deterministic. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`min_informative_sites` and `min_reads_per_site` apply to every method. `demuxlet` settings apply only to `method: demuxlet`. `vireo` settings and `seed` apply only to `vireo_match`, whose restarts are random. `swap_margin_tau` has no effect without a fitted value, and `contamination.max_alpha` bounds the search only when `estimate` is true.

## 7. MCP tool

Tool `singlet_demux_sample_swap_detection` (definition in `tasks/mcp/singlet_demux_sample_swap_detection.json`). Illustrative call and result:

```json
{"dataset": "/data/pool_study.singlet", "method": "sample_aggregate", "contamination": {"estimate": true}}
{"dataset": "/data/pool_study.singlet", "status": "completed",
 "wrote": ["uns/sample_identity/score", "uns/sample_identity/call", "uns/sample_identity/swap_map", "uns/sample_identity/contamination"],
 "summary": {"n_samples": 12, "n_match": 11, "n_swap": 0, "n_ambiguous": 1, "n_insufficient": 0, "tau_used": null},
 "provenance_id": "prov_example"}
```

Long-running: no default; a queued job returns `status: queued` with a `job_id`. Stochastic: only `vireo_match`, whose restarts use `seed`; the other methods are deterministic. Dry run: returns seconds, peak memory and device from cell, site and sample counts without writing.

## 8. Benchmarks

Ground truth is planted by construction. Each setting uses at least 20 plantings with fixed seeds. Plantings split into a calibration half, which fits $\gamma$ and the threshold, and a held-out half, which gives every reported number. Every method reads the same AD and DP matrices, site set and reference genotypes. Intervals are 95% bootstrap intervals over samples. Samples below the site minimum are ambiguous: they count as misses for swap_TPR and are not swaps for swap_FPR.

### B1. Planted swaps and identity recovery

- **Goal**: Test whether per-sample calls recover planted swaps and the planted mapping.
- **Ground truth**: Planted simulation, one label per sample; no per-cell label.
- **Recipe (proposed)**: Pool individual BAMs with the Vireo synthetic-pool generator; assign barcodes to samples by source; permute claimed IDs for a subset to plant swaps.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Individual 10x-style BAMs with reference genotypes | Section 10 | scRNA-seq; — | — | Per-individual genotype record |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| swap_TPR | Planted swaps called swap with the planted individual, over planted swaps; ambiguous is a miss | maximise | primary | — |
| swap_FPR | Unswapped samples called swap, over unswapped samples | minimise | guardrail | — |
| identity_recovery_accuracy | Samples with the planted mapping, over all; ties are errors | maximise | primary | — |
| ambiguous_rate | Ambiguous samples over all, per stratum | minimise | guardrail | — |

- **Comparators**: sample_aggregate (proposed); demuxlet with `--sm` restricted to claimed IDs; Vireo donor-VCF mode; BAMixChecker-style concordance (reimplemented).
- **Protocol**: Strata: below 50, 50 to 500, above 500 informative sites.
- **Acceptance criterion**: Proposed: swap_TPR ≥ 0.95 and swap_FPR ≤ 0.02 at contamination ≤ 0.05 with ≥ 50 informative sites; identity accuracy 1.0 at zero contamination.
- **Known pitfalls**: Scoring the genotypes that generated the reads inflates accuracy; omitting cross-sample ambient RNA hides the dominant failure.

### B2. Contamination calibration on planted mixtures

- **Goal**: Measure bias and error of the per-sample contamination estimate.
- **Ground truth**: Planted simulation. $\alpha$ is the fraction of informative reads in a sample drawn from the contaminant individual, normalised by all informative reads of that sample, not by cells.

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted mixtures from the B1 recipe | B1 | simulated scRNA-seq; planted levels 0, 0.01, 0.02, 0.05, 0.10 | — | 20 plantings per level (proposed) |

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| contamination_MAE | Mean of \|$\hat\alpha-\alpha$\| over samples and plantings | minimise | primary | — |
| contamination_bias | Mean of $\hat\alpha-\alpha$, reported as an absolute value | minimise | guardrail | — |
| false_contamination_rate | Fraction of samples with $\alpha=0$ and $\hat\alpha>0.01$ | minimise | guardrail | — |

- **Comparators**: The proposed read-level estimator (section 5). No published estimator is listed as a comparator (section 10).
- **Protocol**: Same reads and seeds as B1, at levels 0, 0.01, 0.02, 0.05 and 0.10; results stratified by informative-site count and read depth.
- **Acceptance criterion**: Proposed: contamination_MAE at most 0.01 for $\alpha\le0.05$; false_contamination_rate at most 0.05 at $\alpha=0$.
- **Known pitfalls**: Droplet contamination occurs at cell level as well as ambient level, and a read-level plant covers only the first. Low depth shrinks $\hat\alpha$ toward zero, which looks like accuracy unless results are stratified by depth.

### P1. Performance and scaling

Wall time, peak memory and throughput in seconds per million nonzero counts, for per-sample scoring at 1e3, 1e4 and 1e5 cells; 8, 32 and 96 samples; and 1e3, 1e4 and 1e5 informative sites (proposed). Comparators: demuxlet per-barcode scoring restricted with `--sm`; Vireo donor-VCF mode at its default `n_init` of 50 and at a reduced value; cellSNP-lite pileup timed separately as the shared upstream step. Hold fixed: identical AD and DP files, site set, seed and machine; 1 and 8 CPU threads; CUDA reported separately. The sparse-dense product is the candidate cuSPARSE kernel.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `cell-calling.nucleus_vs_empty_calling`: Nucleus versus empty-droplet calling in single-nucleus RNA-seq
- **Feeds**:
  - `qc.sample_level_qc`: Sample- and library-level QC pass/fail
  - `sample-level.patient_stratification`: Unsupervised patient stratification from single-cell profiles
- **Reads**: `layers/AD`, `layers/DP`, `obs/sample_id`, `uns/variant_index`, `uns/reference_genotypes`, `uns/claimed_map`
- **Writes**: `uns/sample_identity/score`, `uns/sample_identity/call`, `uns/sample_identity/swap_map`, `uns/sample_identity/contamination`, `obsm/donor_loglik`
<!-- CHAINING:AUTO:END -->

Belongs to the sample-integrity step of a reference-based pooled-donor workflow, after cell calling and read quantification, before sample-level analysis. Per-cell donor labels from demux.donor_assignment_reference_genotypes are a related but separate output.

## 10. Risks, pitfalls and open questions

- **Missing evidence**: No single-cell sample-swap benchmark with known truth, and no cohort with independent per-individual genotypes, was identified. B1 and B2 therefore depend on planted data and on a set of individual BAMs that still has to be assembled. IDCheck, HYSYS and NGSTroubleFinder were not located and are not described.
- **Source details**: The BAMixChecker paper's title, authors, accuracy claim and 853-SNP default come from bibliographic records and a repository listing, not the full paper; the title used in R7 is the repository README's. Somalier has no repository in any source, so section 12 has no entry for it. The VerifyBamID entry is from memory and has no DOI. souporcell3 appears only in the souporcell README without a corpus record, so it is omitted. The Kang et al. year is 2018 in the best-practices bibliography and 2017 in the scRNA-tools record. The demuxlet alpha default differs between README and source; the MCP tool uses the README grid. Revision identifiers are repository heads at check time, not the corpus snapshot, so line numbers may differ.
- **Unsettled literature**: No threshold for relatives or twins was located. Whether ensemble tools improve sample-level calls is unknown.
- **Risks and first experiment**: The Vireo prior biases identity cost toward a match, so a Vireo-based check needs the prior removed. Ambient RNA from pooled samples is the largest unmodelled risk. First experiment: plant swaps into the synthetic pool at two ambient levels, fit $\gamma$ and the threshold on the calibration half, and report swap_TPR and swap_FPR on the held-out half.

## 11. References

R1. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018. doi:10.1038/nbt.4042 — verified (corpus)
R2. Huang Y, McCarthy DJ, Stegle O. Vireo: Bayesian demultiplexing of pooled single-cell RNA-seq data without genotype reference. *Genome Biology* 2019;20:273. doi:10.1186/s13059-019-1865-2 — verified (corpus)
R3. Huang X, Huang Y. Cellsnp-lite: an efficient tool for genotyping single cells. *Bioinformatics* 2021. doi:10.1093/bioinformatics/btab358 — verified (corpus)
R4. Heaton H, et al. Souporcell: robust clustering of single-cell RNA-seq data by genotype without reference genotypes. *Nature Methods* 2020. doi:10.1038/s41592-020-0820-1 — verified (corpus)
R5. Xu J, Falconer C, Nguyen Q, et al. Genotype-free demultiplexing of pooled single-cell RNA-seq. *Genome Biology* 2019;20:290. doi:10.1186/s13059-019-1852-7 — verified (corpus)
R6. Pedersen BS, et al. Somalier: rapid relatedness estimation for cancer and germline studies using efficient genome sketches. *Genome Medicine* 2020;12:62. doi:10.1186/s13073-020-00761-2 — partial (search)
R7. Chun H, Kim S. An automated tool for sample matching checkup in NGS cohorts. *Bioinformatics* 2019. doi:10.1093/bioinformatics/btz479 — partial (search)
R8. Jun G, Flickinger M, Hetrick KN, Romm JM, Doheny KF, Abecasis GR, Boehnke M, Kang HM. Detecting and estimating contamination of human DNA samples in sequencing and array-based genotype data. *American Journal of Human Genetics* 2012. — unverified (memory)
R9. Young MD, Behjati S. SoupX removes ambient RNA contamination from droplet-based single-cell RNA sequencing data. *GigaScience* 2020. doi:10.1093/gigascience/giaa151 — verified (corpus)
R10. Demuxafy: improvement in droplet assignment by integrating multiple single-cell demultiplexing and doublet detection methods. *Genome Biology* 2024. doi:10.1186/s13059-024-03224-8 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/statgen/popscle (HEAD da70fc78) | — | Apache-2.0 (LICENSE file) | demuxlet per-barcode likelihood; source of the sample scorer kernel | port |
| https://github.com/single-cell-genetics/vireo (HEAD e3654633) | Yuanhua Huang (setup.py and GTbarcode.py headers) | Apache-2.0 (LICENSE file) | donor-VCF comparator; Hungarian matching; synthetic-pool generator for B1 | callout |
| https://github.com/single-cell-genetics/cellsnp-lite (HEAD 8e8ba00c) | — | Apache-2.0 (LICENSE file) | allele-count pileup producing the AD and DP layers | callout |
| https://github.com/wheaton5/souporcell (HEAD 97fbf4de) | Haynes Heaton (LICENSE copyright line) | MIT (LICENSE file) | genotype-free comparator | callout |
| https://github.com/jon-xu/sc_split (HEAD 5e4045cb) | jon-xu (LICENSE copyright line) | MIT (LICENSE file) | genotype-free comparator | callout |
| https://github.com/heinc1010/BAMixChecker (HEAD bd7815e5) | — | No LICENSE file at the repository root | pairwise concordance comparator | reimplement |
