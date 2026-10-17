---
id: demux.species_of_origin_assignment
title: Species-of-origin assignment of cells and reads in mixed-species and xenograft samples
area: demux
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [ingest-quant.reference_annotation_build, ingest-quant.read_to_gene_mapping, cell-calling.cell_vs_empty_droplet_calling]
feeds: [doublets.cross_species_multiplet_detection, ambient.contamination_fraction, cross-species.joint_embedding_integration]
reads: [layers/counts, var/genome, obs]
writes: [obs/species_call, obs/species_fraction_A, obsm/species_umi, uns/species_assign, models/species_mixture]
devices: [cpu, cuda]
mcp_tool: singlet_demux_species_of_origin_assignment
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Species-of-origin assignment of cells and reads in mixed-species and xenograft samples

> Assigns each barcode of a two-species library to species A, species B, mixed or ambiguous from genome-specific UMI counts, and each read pair to a species, using the genome-A share of UMIs as evidence.

## 1. Question

Given genome-specific UMI counts for each barcode of a library holding cells from two species (for example human tumour cells and mouse graft cells), which species does each barcode come from, which barcodes hold cells of both species or are ambiguous, and which species does each read pair come from? Inputs are the per-genome counts of a combined reference. Outputs are a barcode class with species-UMI shares and a read-pair class. A correct answer assigns single-species barcodes to their genome and labels heterotypic multiplets and biological mixtures as mixed.

## 2. Why this task matters and where the field stands

Xenograft and barnyard libraries place two genomes in one count matrix. Host and graft expression cannot be compared until each barcode has an origin, and XenoCell is built around classifying barcodes of xenograft samples [R2]. Heterotypic multiplets also appear as mixed barcodes, so species labels double as a multiplet signal.

Status: **contested**. Barcode-level rules threshold a species share: Cell Ranger uses the genome-A UMI share, and XenoCell uses a host-read fraction [R2]. Read-level rules compare alignment evidence [R3] or k-mer hits [R1]. Ambient-RNA models [R4][R5] and hashtag demultiplexing methods [R6][R7] exist, but none targets species. The open problems are:

1. Cross-species ambient reads raise the minor-species share of low-UMI barcodes and create false mixed calls [R4][R5].
2. Homologous sequence gives reads equal evidence for both genomes, so the read-level tools label them ambiguous at a rate set by sequence conservation [R1][R3].
3. Heterotypic doublets and biological mixing, such as mouse stroma in a human tumour, give the same mixed signal, and none of the tools reviewed separates them [R1][R2][R3].

## 3. Theory and insight

Notation.

| Symbol | Meaning |
|---|---|
| $x^A_b$, $x^B_b$, $N_b = x^A_b + x^B_b$ | genome-A and genome-B UMIs of barcode $b$ that map uniquely, and their sum |
| $\mu$ | fraction of GEMs holding two or more cells |
| $\epsilon_b$ | share of $N_b$ from the other species' ambient pool |
| $z_b \in \{A, B, M\}$ | single cell of A, single cell of B, or heterotypic multiplet or biological mixture |

Estimands. The genome-A share $f_b = x^A_b / N_b$ is UMI-weighted and normalised by genome-specific UMIs; it is undefined when $N_b = 0$. The class $z_b$ is per barcode (one GEM). $\mu$ is a fraction of GEMs including unobserved multiplets, and $\epsilon_b$ is a share of $N_b$.

Barcode estimator. Under independent loading a random pair of cells is heterotypic with probability $2 f_A f_B$, so Cell Ranger infers total multiplets from the observed heterotypic calls [multigenome.py:113–135]:
$$\hat N_{\mathrm{mult}} = \frac{n_{\mathrm{obs}}}{2\,\hat f_A \hat f_B}, \qquad \hat f_A = \frac{n_A}{n_A + n_B},$$
capped at $n_{\mathrm{obs}} + n_A + n_B$. Regime: independent loading, GEMs with more than two cells ignored, $n_A, n_B > 0$.

Percentile rule. A GEM is a multiplet when both genome counts reach the 10th percentile of the minor-genome count among GEMs dominated by the other genome:
$$\tau_A = Q_{0.10}\!\left(x^A_b \mid x^A_b > x^B_b\right),\quad \tau_B = Q_{0.10}\!\left(x^B_b \mid x^B_b > x^A_b\right),\quad \text{multiplet}_b \iff x^A_b \ge \tau_A \wedge x^B_b \ge \tau_B.$$
Missing classes fall back to thresholds of 10, and a threshold below 50 with fold change above 25 collapses both to the pooled percentile [multigenome.py:148–165].

Proposed barcode model. The class prior follows occupancy and absorbs homotypic multiplets into the singleton classes:
$$\Pr(z_b{=}M) = 2\mu\hat f_A\hat f_B,\quad \Pr(z_b{=}A) = (1-\mu)\hat f_A + \mu\hat f_A^{2},\quad \Pr(z_b{=}B) = (1-\mu)\hat f_B + \mu\hat f_B^{2},$$
$$x^B_b \mid z_b{=}A \sim \mathrm{Bin}(N_b, \epsilon_b),\quad x^A_b \mid z_b{=}B \sim \mathrm{Bin}(N_b, \epsilon_b),\quad x^A_b \mid z_b{=}M \sim \mathrm{BetaBin}(N_b, \kappa_1, \kappa_2).$$
The prior sums to one when $\hat f_A + \hat f_B = 1$. The beta-binomial spread stands in for the unknown RNA-content ratio of the two cells. Regime: large $N_b$, one ambient profile per library, independent loading. EM fits $\mu$, $\kappa$, $\hat f$, and an ambient prior for $\epsilon_b$ from barcodes below `min_umis_per_barcode`. The posterior $\Pr(z_b \mid x_b)$ is the calibrated uncertainty that B2 tests.

Read-level rule. For a pair aligned to both genomes, the TopHat-style rule compares $S_X(p) = \sum_{m \in p}(\mathrm{XO}_m + \mathrm{NM}_m + \mathrm{NH}_m)$, assigns the lower sum, and labels equal sums ambiguous [disambiguate.py:13–15, 55–81]. BWA and STAR output is compared lexicographically: AS (higher is better), then NM (lower is better) [disambiguate.py:85–86, 128–132].

Insight. Thresholds on a species share suffice when species are well separated and barcodes carry many UMIs. Failure concentrates in the low-UMI tail, where ambient cross-species counts dominate the minor share, and read-level tools treat homology as ties. A model adds a mixed-class posterior, an explicit ambient term and a multiplet rate tied to occupancy. None of the reviewed tools returns a calibrated probability.

Failure modes. Barcode level: cross-species ambient creates false mixed calls; extreme ratios trigger the pure-sample guard; unsorted barcode indices give random labels silently [cell_calling.py:289–294]. Read level: homology produces ties; STAR output should carry NM tags, which the C++ version requires, and the C++ version needs name-sorted input that the Python version sorts itself [README.md:8–14]. Both: a reference-build mismatch changes homology, and biological mixing gives mixed calls that are not doublets. The Cell Ranger estimator is biased when the observed heterotypic count is small.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Cell Ranger multi-genome GEM classification | heuristic | Percentile thresholds on the minor-genome count of dominant-genome GEMs; total multiplets from observed heterotypic calls | code, section 12 |
| XenoCell with its Xenome read classes | heuristic | Xenome labels reads host, graft, both, neither or ambiguous; barcodes are kept when their host fraction lies in a user-set window | [R2], [R1] |
| disambiguate | heuristic | Name-sorted read pairs go to the species with the lower summed evidence (TopHat tags) or the better AS then NM (BWA, STAR); ties are ambiguous | [R3] |

The three tools above are the published methods for this task. None returns a probability, so their defaults below serve as comparators. The mixture model in section 5 is singlet's own proposal.

| Method | Parameter | Value | Source |
|---|---|---|---|
| Cell Ranger | DEFAULT_MULTIPLET_THRESHOLD | 10 | constants.py:48 @ 669395e |
| Cell Ranger | MULTIPLET_PROB_THRESHOLD | 0.10 (percentile) | constants.py:49 |
| Cell Ranger | bootstrap samples | 1000 | multigenome.py:28 |
| Cell Ranger | bootstrap seed | 0 | multigenome.py:235 |
| Cell Ranger | pure-sample guard | threshold below 50 and fold change above 25 | multigenome.py:161–165 |
| Cell Ranger | multiplet cap | $n_{\mathrm{obs}} + n_A + n_B$ | multigenome.py:135 |
| XenoCell | host-fraction bounds | none; required (help-text examples 0.0 and 0.1) | xenocell.py:261–272 |
| XenoCell | barcode filter | perc ≥ lower and perc ≤ upper | extract_cellular_barcodes.py:58 |
| XenoCell | host fraction | host ÷ total, total summed over the merged host and graft table | classify_reads.py:237–247 |
| Xenome | index k-mer length | 25 for human and mouse | xenome-1.0.1-r/README.txt, REQUIREMENTS (XenoCell @ 02dc1e1) |
| Xenome | memory | 2 GB free RAM minimum; 16 GB recommended at k=25 | xenome-1.0.1-r/README.txt, REQUIREMENTS |
| disambiguate | tie rule | equal summed XO+NM+NH is ambiguous | disambiguate.py:13–15 @ 221e091 |
| disambiguate | BWA and STAR tags | AS (higher better), then NM (lower better) | disambiguate.py:85–86, 128–132 |

## 5. Proposed singlet approach

Cell Ranger's estimator and percentile rule are **reimplemented** from section 3; licence terms are in section 12. XenoCell and disambiguate are **callouts**, used only as comparators. Xenome is neither ported nor shipped.

The model-based route is the barcode mixture of section 3, fitted per library by EM in the dependency-free C++ core, giving $\Pr(z_b \mid x_b)$ per barcode. Labels: mixed when $\Pr(M) \ge 0.9$; species A or B when the largest singleton posterior is at least 0.9; ambiguous otherwise or when $N_b$ is below `min_umis_per_barcode`; empty when $N_b = 0$ (0.9 proposed).

Rejection criteria on the benchmarks: calibration error of $\Pr(M)$ above 0.05 on B2 for GEMs of at least 1000 UMIs (proposed); heterotypic recall at 1:1 without ambient below the reimplemented Cell Ranger rule; or singlet agreement on B1 at 500 UMIs or more below the Cell Ranger comparator.

Three classes and two sparse count columns suit hand-written C++ with an optional CUDA kernel, using cuSPARSE for per-barcode reductions. The M-step needs only global sums, so EM streams over barcode chunks with the same result. PyTorch is reserved for an amortised read-level classifier, if one is justified later.

Defaults: `method` = `mixture`, `min_umis_per_barcode` = 10, `seed` = 0, `device` = `auto`. The bootstrap count of 1000 applies only to the `cellranger_style` comparator.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | UMIs per feature from the combined reference |
| read | var/genome | categorical | genome of origin per feature, from contig or gene-ID prefix |
| read | obs | table | upstream cell calls that restrict the barcodes |
| write | obs/species_call | categorical | A, B, mixed, ambiguous or empty |
| write | obs/species_fraction_A | float32 | genome-A share of genome-specific UMIs, as defined in section 3 |
| write | obsm/species_umi | int32, n_cells × 2 | genome-specific UMI counts per barcode |
| write | uns/species_assign | dict | parameters, class counts and convergence |
| write | models/species_mixture | dict | fitted mixture weights, $\mu$ and the ambient prior |

Species-separated count matrices (AnnData views) and the read-level class table (an external file) are outputs but not members.

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle with per-genome layers/counts and var/genome: a .singlet path or URI, or a workspace handle. |
| `genome_a_label` | string | required | — | Value of var/genome for the first genome, for example human. The other genome is species B. |
| `method` | string | "mixture" | `mixture`, `cellranger_style`, `xenocell`, `disambiguate` | Barcode mixture model (default) or a comparator rule; xenocell and disambiguate are read-level. |
| `min_umis_per_barcode` | integer | 10 | min 1 | Barcodes with fewer genome-specific UMIs are reported as ambiguous. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for EM initialisation (mixture) and bootstraps (cellranger_style). |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing members. |
| `overwrite` | boolean | false | — | Replace existing species members instead of failing. |
| `mixture` | object | — | — | Options for the barcode mixture model. |
| `mixture.max_iterations` | integer | 200 | min 1 | Upper bound on EM iterations (proposed). |
| `mixture.tolerance` | number | 1e-06 | > 0 | Stop when the log-likelihood change falls below this value. |
| `cellranger_style` | object | — | — | Options for the Cell Ranger comparator; guard values fixed as in its source. |
| `cellranger_style.multiplet_percentile` | number | 0.1 | min 0; max 1 | Percentile for per-genome multiplet thresholds. |
| `cellranger_style.n_bootstrap` | integer | 1000 | min 1 | Bootstrap samples for the multiplet estimator. |
| `xenocell` | object | — | — | Options for the XenoCell comparator; needs read-level input. |
| `xenocell.fastq_in` | string | — | — | Paired FASTQ input to Xenome classification (path or URI). |
| `xenocell.xenome_index` | string | — | — | Xenome index prefix built for both genomes. |
| `xenocell.xenome_k` | integer | 25 | — | k-mer length of the Xenome index. |
| `xenocell.host_fraction_lower` | number | — | min 0; max 1 | Inclusive lower bound of the host-fraction window. |
| `xenocell.host_fraction_upper` | number | — | min 0; max 1 | Inclusive upper bound of the host-fraction window. |
| `disambiguate` | object | — | — | Options for the disambiguate comparator; needs read-level input. |
| `disambiguate.bam_genome_a` | string | — | — | Name-sorted BAM aligned to genome A. |
| `disambiguate.bam_genome_b` | string | — | — | Name-sorted BAM aligned to genome B. |
| `disambiguate.tag_order` | string | "AS_NM" | `AS_NM`, `XO_NM_NH` | AS_NM for BWA and STAR alignments; XO_NM_NH for TopHat-style tags. |
<!-- PARAMS:AUTO:END -->

`method` selects one estimator; option objects apply only to their method. `xenocell` needs both bounds, and `disambiguate` needs name-sorted BAM pairs. `min_umis_per_barcode` applies to `cellranger_style` and `mixture`. `genome_a_label` must match a `var/genome` value; the other genome is species B.

## 7. MCP tool

Tool name `singlet_demux_species_of_origin_assignment` (definition in `tasks/mcp/singlet_demux_species_of_origin_assignment.json`). Example call and result:

```json
{"dataset": "example_xenograft.singlet", "genome_a_label": "human", "method": "mixture"}
```

```json
{
  "dataset": "example_xenograft.singlet",
  "status": "completed",
  "wrote": ["obs/species_call", "obs/species_fraction_A", "obsm/species_umi", "uns/species_assign", "models/species_mixture"],
  "summary": {"method": "mixture", "class_counts": {"A": "<int>", "B": "<int>", "mixed": "<int>", "ambiguous": "<int>", "empty": "<int>"}, "mu": "<float>", "converged": "<bool>"},
  "provenance_id": "<id>"
}
```

Long-running: the barcode methods complete inline, while `disambiguate` and `xenocell` return `queued` with a `job_id`. Stochastic: `seed` fixes EM initialisation and the Cell Ranger bootstraps. The `dry_run` option returns estimated seconds, peak memory and device for the chosen method and writes no members.

## 8. Benchmarks

Shared protocol. Barcodes with fewer than `min_umis_per_barcode` genome-specific UMIs are excluded from every metric unless stated. The 100-UMI and 500-UMI strata are reported separately (proposed). Methods use the defaults in sections 4 and 5, and no parameter is tuned on evaluation data. Every grid is reported in full. Intervals are 95% bootstrap intervals over barcodes. For macro-averages and kappa, ambiguous calls map to mixed.

### B1. Cross-method consistency on the XenoCell example library

- **Goal**: agreement of barcode labels among Cell Ranger, XenoCell and the mixture on one human-mouse library.
- **Ground truth**: consistency, not truth. The reference label is A when $f_b \ge 0.9$, B when $f_b \le 0.1$, mixed otherwise (proposed cut-offs). It reuses the thresholded counts, so agreement is circular.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| XenoCell example hgmm_5k_v3 | XenoCell example directory (section 12) | 10x single-cell RNA-seq; human (hg19), mouse (mm10); size — | — | Per-genome matrices and `gem_classification.csv` |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Singlet agreement | A or B calls equal to the reference label, at 100 and 500 UMIs | maximise | primary | — |
| Mixed call rate | mixed or ambiguous calls, with 95% bootstrap interval | report | guardrail | — |
| Pairwise Cohen's kappa | three-class agreement per method pair | maximise | primary | — |

- **Comparators**: Cell Ranger labels from the shipped `gem_classification.csv`; XenoCell windows [0.0, 0.1] (B) and [0.9, 1.0] (A) on UMI counts, which changes the read-count estimand; the mixture.
- **Acceptance criterion**: proposed. Singlet agreement of at least 0.95 for the mixture at 500 UMIs or more, with the mixed call rate and its interval reported.
- **Known pitfalls**: circularity; biological or ambient mixing counted as mixed without a multiplet.

### B2. Pseudo-mixtures with planted classes

- **Goal**: accuracy, heterotypic recall and calibration of $\Pr(M)$ over planted grids.
- **Ground truth**: planted; each GEM carries its construction class (A, B or A+B).
- **Generator recipe**:
  1. Draw species-pure human and mouse cells from the singlet catalogue.
  2. Combine A:B ratios {1:1, 1:4, 1:9} with multiplet rates {0.02, 0.05, 0.10}, forming singlets and multiplets (proposed grids).
  3. Add ambient counts $\epsilon N_b$, $\epsilon \in \{0, 0.02, 0.05, 0.10\}$, from a profile on separate barcodes (proposed).
  4. Down-sample to 500, 1000 and 5000 UMIs (proposed); fit on seed 1, evaluate on seed 2.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Species-pure cells | singlet catalogue | scRNA-seq counts; human and mouse; size — | — | Composition check is open (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Macro F1 | over A, B and mixed | maximise | primary | — |
| Heterotypic recall | simulated A+B GEMs called mixed | maximise | primary | — |
| Adjusted Rand index | against planted classes | maximise | primary | — |
| Calibration error of $\Pr(M)$ | expected calibration error, ten bins | minimise | guardrail | — |

- **Comparators**: reimplemented Cell Ranger rule with its pure-sample guard; XenoCell window; mixture.
- **Acceptance criterion**: proposed. Macro F1 of at least 0.98 at ratio 1:1 with $\epsilon = 0$; heterotypic recall of at least 0.8 for GEMs of at least 1000 UMIs.
- **Known pitfalls**: simulated doublets lack real overdispersion; ambient from the singlets' own barcodes is circular.

### B3. Read-level classification on simulated read pairs

- **Goal**: per-read sensitivity and specificity, with ambiguous rates, stratified by ortholog identity.
- **Ground truth**: planted; the simulator records each pair's species and transcript.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Human and mouse transcripts, one annotation release | release matching the combined reference | simulated paired-end reads; human and mouse; size — | — | Stratified by identity band |

- **Generator recipe**: for each ortholog identity band (proposed: at least 95%, 85–95%, below 85%, from pairwise alignment), draw transcripts from both species and simulate paired reads with sequencing errors and SNPs.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Sensitivity per species | correct pairs ÷ all pairs of that species | maximise | primary | — |
| Specificity per species | 1 − (other-species pairs called this species) ÷ all other-species pairs | maximise | primary | — |
| Ambiguous rate by band | pairs called ambiguous (Xenome: both or neither) | report | guardrail | — |

- **Comparators**: Xenome (k=25) through XenoCell, with both and neither kept separate; disambiguate on BWA and STAR alignments with NM tags.
- **Acceptance criterion**: proposed. Specificity of at least 0.99 for both species on non-conserved reads; the conserved-read ambiguous rate is reported without a threshold.
- **Known pitfalls**: reads simulated straight from the reference favour the aligner; name-based grouping needs intact mates.

### P1. Performance and scaling

Wall time, peak memory and CPU-seconds per million read pairs for disambiguate (BWA and STAR BAMs), Xenome index build and classification through the XenoCell wrapper, and the Cell Ranger classification step; mixture wall time on CPU and CUDA. Scales: $10^3$ to $10^6$ barcodes and $10^7$ or more read pairs (proposed). Hold fixed the reference build, read count, threads, aligner version and storage. Acceptance criterion (proposed): mixture wall time at $10^6$ barcodes no greater than the Cell Ranger step on the same input. Memory figures: section 4.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.reference_annotation_build`: Reference genome and annotation preparation for single-cell counting (including custom host-plus-pathogen and transgene references)
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
- **Feeds**:
  - `doublets.cross_species_multiplet_detection`: Cross-species multiplet detection
  - `ambient.contamination_fraction`: Contamination fraction estimation
  - `cross-species.joint_embedding_integration`: Cross-species integration into a shared embedding
- **Reads**: `layers/counts`, `var/genome`, `obs`
- **Writes**: `obs/species_call`, `obs/species_fraction_A`, `obsm/species_umi`, `uns/species_assign`, `models/species_mixture`
<!-- CHAINING:AUTO:END -->

Recipe: none assigned yet. The task sits between cell calling and per-species analysis in xenograft and barnyard preprocessing.

## 10. Risks, pitfalls and open questions

- **Unverified evidence**: the full texts of Conway et al. [R1] and Ahdesmaki et al. [R3] are unverified, so their sensitivity and specificity statements are not used as numbers. The XenoCell paper's benchmark results [R2] are unverified. No public Xenome source repository was located, and only its non-commercial binary ships inside XenoCell. A cell-line barnyard experiment from the literature is not located, so B1 uses the XenoCell example, whose read provenance, accession and dataset licence are unverified; the read-level comparator cannot be applied to its reads. A sorted human and mouse population benchmark has no dataset yet, so it is not specified.
- **Provenance and authorship**: DecontX, GMM-Demux and demuxmix are cited for their titles only, so none is used as a model template. Author lists beyond the first are unverified for CellBender [R5], GMM-Demux [R6] and demuxmix [R7]. Whether the XenoCell total column (classify_reads.py:237–247) excludes the barcode key is unverified. Commit 669395e may not match the Cell Ranger file versions cited, because the local clone has no git metadata.
- **Unsettled science**: the local index holds no head-to-head comparison of Cell Ranger, XenoCell, Xenome and disambiguate [R1][R2][R3], and no species-specific ambient model. No reviewed rule separates heterotypic doublets from biological mixing. XenoCell's project notes list automatic threshold selection as not implemented, so its window is set by hand [R2]. The mixture has no published primary source, so its enum entry, which is the proposed default, rests on this design alone.
- **Licence and first experiment**: licence terms in section 12 rule out porting code from either tool, so comparators use outputs or reimplemented descriptions. The catalogue's species composition is unverified, so B2 waits for a checked pure-species set. First experiment: the mixture against the reimplemented Cell Ranger rule on the XenoCell example (B1), with the UMI-based XenoCell window as an explicit proxy.

## 11. References

R1. Conway T, Wazny J, Bromage A, Tymms M, Sooraj D, Williams ED, Beresford-Smith B. Xenome—a tool for classifying reads from xenograft samples. *Bioinformatics* 2012;28(12):i172–i178. doi:10.1093/bioinformatics/bts236 — partial (search)
R2. Cheloni S, Hillje R, Luzi L, et al. XenoCell: classification of cellular barcodes in single cell experiments from xenograft samples. *BMC Medical Genomics* 2021;14:34. doi:10.1186/s12920-021-00872-8 — verified (corpus)
R3. Ahdesmaki MJ, Gray SR, Johnson JH, Lai Z. Disambiguate: an open-source application for disambiguating two species in next generation sequencing data from grafted samples. *F1000Research* 2016;5:2741. doi:10.12688/f1000research.10082.1 — partial (search)
R4. Yang S, Corbett SE, Koga Y, Wang Z, Johnson WE, Yajima M, Campbell JD. Decontamination of ambient RNA in single-cell RNA-seq with DecontX. *Genome Biology* 2020. doi:10.1186/s13059-020-1950-6 — verified (corpus)
R5. Fleming S, Babadi M, et al. Unsupervised removal of systematic background noise from droplet-based single-cell experiments using CellBender. *Nature Methods* 2023. doi:10.1038/s41592-023-01943-7 — verified (corpus)
R6. Xin H, et al. GMM-Demux: sample demultiplexing, multiplet detection, experiment planning, and novel cell-type verification in single cell sequencing. *Genome Biology* 2020. doi:10.1186/s13059-020-02084-2 — verified (corpus)
R7. Klein HU, et al. demuxmix: demultiplexing oligonucleotide-barcoded single-cell RNA sequencing data with regression mixture models. *Bioinformatics* 2023. doi:10.1093/bioinformatics/btad481 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/10XGenomics/cellranger | 10x Genomics | 10x Genomics custom licence (LICENSE): internal use only, exercisable with 10x products; source provided for information | barnyard GEM classification; source of the estimator and percentile rule | reimplement from description |
| https://gitlab.com/XenoCell/XenoCell | Elena Gatti (copyright holder, LICENSE.md); paper authors in R2 | MIT for XenoCell code (LICENSE.md); bundled Xenome 1.0.1-r binary under a NICTA non-commercial licence (xenome-1.0.1-r/license.txt) | barcode host-fraction window; Xenome read classes | callout (comparator); Xenome not ported or shipped |
| https://github.com/AstraZeneca-NGS/disambiguate | Miika Ahdesmaki; Zhongwu Lai (copyright holders) | MIT (LICENSE.txt; setup.py) | read-level tie rule and BWA/STAR tag order | callout (comparator) |
