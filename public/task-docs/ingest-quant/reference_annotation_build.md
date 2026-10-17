---
id: ingest-quant.reference_annotation_build
title: Reference genome and annotation preparation for single-cell counting (including custom host-plus-pathogen and transgene references)
area: ingest-quant
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [ingest-quant.barcode_umi_extraction]
feeds: [ingest-quant.read_to_gene_mapping, ingest-quant.spliced_unspliced_counting, ingest-quant.intron_inclusive_gene_counting, harmonization.annotation_release_reconciliation]
reads: [uns/ingest_geometry]
writes: [uns/ref_build, var/gene_id, var/gene_name, var/gene_biotype, uns/t2g, uns/gene_set, uns/index_paths, uns/decoy_names]
devices: [cpu]
mcp_tool: singlet_ingest_quant_reference_annotation_build
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Reference genome and annotation preparation for single-cell counting

> Build, from one genome FASTA and one annotation release, the gene set, transcript-to-gene map and mapper index on which every count depends, with an explicit feature space, biotype filter and optional decoy and extra sequences.

## 1. Question

Which feature space (spliced exons; spliced exons plus an intronic flank; spliced exons plus whole gene bodies; or genome plus decoys), annotation release, biotype filter and junction flank give a single-cell reference that contains exactly the intended genes and lets reads from each origin land where the design intends? Inputs are a genome FASTA, an annotation file with a release identifier, optional decoy, spike-in, transgene or pathogen FASTA, and a read length. Outputs are the gene set, a transcript-to-gene map and one mapper index.

## 2. Why this task matters and where the field stands

**Status: contested.** The reference fixes which sequences can absorb reads, so it decides which reads can be counted and which genes they can reach before any counting policy applies. Spliced-only references used with lightweight mapping lose intronic reads and can create spurious mappings from short shared sequence; the single-cell best-practices chapter cites the STARsolo, Bruning and He studies for these failures [R14, R5, R7, R2]. The open problems are:

- **Intronic signal.** The best-practices chapter cites a preprint on recovering reads for missing expression [R6] and a 10x technical note on intronic and antisense reads [R9] in support of counting such reads; preprocessing choices also change RNA velocity results [R8].
- **Mapper and sample type.** The best design depends on whether the sample is nuclei or whole cells and on the mapper. Genome-based spliced alignment gives intronic reads a home without a special index, while lightweight mapping needs augmented sequence to behave the same way (section 5).
- **Decoys.** Alignment and mapping methodology influence transcript abundance estimates [R1]. Salmon's EM quantification [R10] can absorb reads from unannotated genome into decoy targets when the index is decoy-aware (section 6).

## 3. Theory and insight

The build is a deterministic transformation, not an estimate. Given a genome $G$, an annotation $A$, optional decoy sequences $D$, extra sequences $X$ and a read length $r$, it outputs a feature space, a transcript-to-gene map and an index. The feature-space choices are spliced exons $S$; spliced exons with an intronic flank $f$; spliced exons with whole gene bodies; and the genome with decoys and extra contigs. Estimation happens downstream: Salmon's EM and the alevin-fry USA partition consume these references.

| Symbol | Meaning |
|---|---|
| $r$ | read length of the library |
| $f$ | flank: bases of intron or genome sequence added on each side of an exon-intron junction |
| $T$, $D$ | transcript targets and decoy targets |
| $N$, $r_i$ | number of reads, and read $i$ |
| $\theta_t$ | abundance of target $t$ as a fraction of all reads |
| $s_g$, $u_g$, $a_g$ | spliced, unspliced and ambiguous molecules of gene $g$ |

The flank rule is a geometric bound:

$$f \ge r-1$$

A read of length $r$ that crosses a junction has at most $r-1$ bases on the intronic side, so this flank places every such read wholly inside the augmented sequence. The bound is exact for a fixed read length and says nothing about accuracy beyond representation (section 10).

With decoy targets, the quantifier fits abundances by EM:

$$\theta_t^{(n+1)} = \frac{1}{N}\sum_{i=1}^{N}\frac{\theta_t^{(n)}\,P(r_i\mid t)}{\sum_{s\in T\cup D}\theta_s^{(n)}\,P(r_i\mid s)},\quad t\in T\cup D$$

This is the standard mixture EM with per-read alignment likelihoods $P(r_i\mid t)$ from the mapping stage. Its regime is large $N$ with fixed likelihoods. The sketch omits Salmon's fragment-length and bias terms (section 10). Decoy targets are not reported, so transcript fractions summed over transcripts alone fall short of one by the decoy mass (section 4).

In alevin-fry USA mode the total $x_g$ of a gene is partitioned exactly:

$$x_g = s_g + u_g + a_g$$

This is bookkeeping for molecules assigned in USA mode. The partition is only as informative as the augmented reference that produced it.

Each output and ground-truth quantity has one estimand:

- **Gene set:** the ordered gene IDs present in the built reference, unnormalised.
- **Transcript-to-gene map:** one row per transcript record, with exactly one gene ID per row.
- **Gene-set retention:** the fraction of intended gene IDs present in the built set, where the intended set is the release restricted to the stated biotype allowlist.
- **Read-origin accuracy:** among simulated reads of one origin class, the fraction whose assigned feature is the true feature; a multi-gene assignment is correct when it contains the true gene.
- **Decoy absorption:** among reads of unannotated origin, the fraction assigned to a decoy or left unassigned.
- **Planted UMI recovery:** the fraction of planted contig UMIs counted to that contig after UMI deduplication, pooled over cells.
- **Host leakage:** for host gene $g$, $|U_g^{+}-U_g^{-}|/U_g^{-}$ with and without the appended contigs, summarised by its 99th percentile over genes with $U_g^{-}>0$.
- **Biotype retention:** UMIs kept for a biotype after filtering, divided by that biotype's UMIs in the unfiltered build.

Each design family has a characteristic failure. Selective alignment without decoys forces reads from unannotated genome onto the most similar transcript [R1]. A flank below $r-1$ loses junction-spanning reads, while a much longer flank inflates the index and adds gene ambiguity. A biotype filter that keeps only protein-coding genes removes lncRNA, pseudogene and antisense signal. A release mismatch between the reference and downstream gene tables causes silent dropouts. A transcript on several chromosomes is truncated to one chromosome by Cell Ranger (section 4).

Heuristics work here because the rules encode the flank geometry and the gene filter exactly, which makes builds auditable and reproducible. They cannot state how many reads fall in unannotated sequence or how confident a proposed locus is. A probabilistic layer fit to catalogue counts could supply both with uncertainty, and the rule-based builds remain the comparators in every benchmark.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Cell Ranger mkref and mkgtf | heuristic | filters a GTF by user key:value attributes, then builds a STAR genome index | [R13] |
| STAR genomeGenerate with GTF, and STARsolo GeneFull | heuristic | suffix-array genome index with GTF junctions inserted; GeneFull counts whole gene bodies | [R4], [R5] |
| kb ref: cDNA, lamanno, nac | heuristic | cDNA only; intron plus cDNA; nascent sequence; kallisto index with k = 31 | [R3], [R11] |
| simpleaf index splici and spliceu | heuristic | spliced plus intron or gene-body FASTA with flanks, indexed for alevin-fry | [R12], [R2] |
| Salmon decoy-aware gentrome | hybrid | transcripts followed by decoy genome sequence, into which EM can absorb reads | [R10], [R1] |

Cell Ranger mkref is the vendor reference workflow for 10x libraries and serves as a comparator. The STAR genome index and the lightweight kb-python, simpleaf and Salmon designs are the alternatives singlet builds on. Each method is taken from the source or documentation at the revision listed in section 12; the Salmon entries refer to the Rust checkout only, and [R10] describes the 2017 C++ release.

Exact defaults of the methods above:

| Method | Parameter | Value | Source |
|---|---|---|---|
| Cell Ranger mkgtf | attribute filter | none unless key:value is given; the source has no default biotype allowlist | bin/rna/mkgtf_lib.py:22-24, 58-66 @669395e |
| Cell Ranger GtfBuilder | removal rule | a record is removed only when its filter key is present and the value is not allowed; key-less records are kept | lib/python/cellranger/reference.py:440-466 @669395e |
| Cell Ranger mkref | STAR memory guard | minimum memory = genome size + suffix-array size + 3 GB | lib/python/cellranger/reference_builder.py:165-173, 399-402 @669395e |
| Cell Ranger mkref | transcript on several chromosomes | first chromosome kept, warning emitted | reference_builder.py write_genome_gtf:300-346 @669395e |
| STAR | genomeSAindexNbases | 14; the manual lowers it for small genomes toward min(14, log2(GenomeLength)/2 - 1) | source/parametersDefault:71 @b1edc12 |
| STAR | sjdbOverhang | 100; the manual recommends ReadLength - 1 | source/parametersDefault:131 @b1edc12; extras/doc-latex/STARmanual.tex:128 |
| STAR | GTF exon feature, transcript tag, biotype tag | exon; transcript_id; gene_type gene_biotype | source/parametersDefault:116, 119, 128 @b1edc12 |
| STARsolo | GeneFull | all reads overlapping gene loci, exonic and intronic | docs/STARsolo.md:220-222 @b1edc12 |
| kb-python | k | 31 | pachterlab_kb_python/kb_python/ref.py:685, 689, 825 @188d9c7 |
| kb-python | flank for nac and lamanno | k - 1 when not given (30 when k is also unset); singlet passes r - 1 explicitly | ref.py:983, 1229 @188d9c7 |
| kb-python | GTF include and exclude filters | empty lists keep all records, so there is no biotype filter by default | ref.py:615-621, 906-912, 1181-1187 @188d9c7; main.py:240-251 |
| kb-python | --flank | hidden from help but accepted | kb_python/main.py:1174 @188d9c7 |
| simpleaf | rlen | 91; the help text says it sets the flank added to intronic sequences | src/simpleaf_commands.rs:716-726 @6abee7e |
| simpleaf | flank_trim_length | 5, not settable from the command line | src/simpleaf_commands/indexing.rs:388-389 @6abee7e |
| simpleaf | augmentation | splici maps to intronic; spliceu maps to gene body | indexing.rs:360-375 @6abee7e |
| Salmon | decoy input | file given with -d/--decoys; decoy records must be last in the FASTA | README.md:80-87 @ed926b8 |
| Salmon | sub-k decoys | dropped at build with a message | crates/salmon-index/src/lib.rs:607-608 @ed926b8 |
| Salmon | decoy targets at quantification | not quantified; decoy block skipped | crates/salmon-core/src/lib.rs:67-68 @ed926b8 |
| Salmon | index format | version 2; version 1 indices must be rebuilt | crates/salmon-index/src/lib.rs:90 @ed926b8 |

## 5. Proposed singlet approach

Each code's route is set in section 12. **Port** means reimplementing an algorithm in singlet's C++ core from a permissively licensed source. **Reimplement** means writing the algorithm from its description without copying code; the splici and spliceu augmentation is reimplemented this way and checked against simpleaf's splici output on a shared genome before use. **Callout** means invoking the program externally or using it only as a comparator; the STAR genome index and the salmon index binary are called as subprocesses, and Cell Ranger mkref is a comparator only.

The default design is splici. It gives intronic reads a place in a lightweight-mapping reference, approximates the behaviour that STAR GeneFull gives genome-aligned data, and is the augmented design that the simpleaf and alevin-fry route supports without decoys. Whether it should replace cdna for whole-cell libraries is open (section 10).

The one model-based addition is proposed and untested. A hierarchical negative-binomial model over genomic bins, fit to catalogue libraries mapped with exon-only and intron-inclusive features, returns a posterior expected UMI count per unannotated bin. It proposes extra loci for augmented or decoy sequence and estimates which flank and biotype classes add reads per study. It is rejected if its proposed loci do not clear the B1 acceptance rule against the best rule-based comparator. PyTorch fits the model, which is small and CPU-adequate. No CUDA path is offered here, because index construction is CPU and I/O bound (section 6).

The build is a single scan of the FASTA and the GTF with an interval index for gene bodies and introns; flank extraction is a windowed copy and duplicate removal hashes each sequence. Its memory is bounded by that index plus the external indexer (section 4). No cell data are read, so streaming is not needed.

Build checks are tests, not benchmarks. The build fails on duplicated gene IDs and on a filtered gene set that differs from the allowlist-defined set. Records lacking the biotype key are excluded and counted when an allowlist is set. Transcripts on several chromosomes are kept and listed in `uns/ref_build`, not truncated. Each extra contig needs an annotation record; singlet adds one gene per contig when the GTF has none.

Without further input an agent should use method `splici`, the read length from the library geometry, decoys off, CPU only, and an explicit biotype allowlist.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/ingest_geometry | dict | cDNA span, used for the read length when `read_length` is omitted |
| write | uns/ref_build | dict | assembly, release, method, filters applied, tool versions, input checksums, multi-chromosome transcripts |
| write | var/gene_id | string | intended gene IDs |
| write | var/gene_name | string | gene symbol for each gene ID |
| write | var/gene_biotype | string | biotype for each gene ID |
| write | uns/t2g | table | transcript, gene and gene name for each transcript record |
| write | uns/gene_set | list of string | ordered gene IDs in the reference index |
| write | uns/index_paths | dict | paths of the external index directories, by mapper |
| write | uns/decoy_names | list of string | decoy record names in index order; empty without decoys |

The genome FASTA, annotation and extra FASTA files are tool arguments, not members.

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `device` | string | "cpu" | `cpu` | Index construction is CPU and I/O bound; only cpu is accepted. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without writing. |
| `overwrite` | boolean | false | — | Replace existing reference members and index paths instead of failing. |
| `method` | string | "splici" | `cdna`, `splici`, `spliceu`, `lamanno`, `nac`, `star_genome`, `star_genefull`, `gentrome` | Reference design. Default splici adds intronic flank; cdna is spliced only; lamanno and nac are kb intron modes; star_genefull counts gene bodies. |
| `genome_fasta` | string | required | — | Path to the genome FASTA of the assembly to index. |
| `annotation` | object | required | — | Annotation release and gene filter. |
| `annotation.gtf` | string | — | — | Path to the GTF or GFF3 annotation file. |
| `annotation.release` | string | — | — | Release identifier recorded in uns/ref_build, for example GENCODE v32. |
| `annotation.biotype_key` | string | "gene_biotype" | — | Attribute holding the biotype; gene_type is tried when it is missing. |
| `annotation.biotype_allowlist` | array | [] | — | Biotypes to keep; an empty list keeps all records and is recorded. |
| `read_length` | integer | — | min 1 | Read length r; flank is r minus 1. Omit to use the cDNA span length in uns/ingest_geometry. Needed by every method except cdna and gentrome. |
| `extra_contigs` | array | [] | — | FASTA paths of transgene, pathogen or spike-in sequences appended to the genome. |
| `decoys` | boolean | false | — | Append genome decoy sequences; valid only with method gentrome. |
| `kb` | object | — | — | kb-python options for cdna, lamanno and nac. |
| `kb.k` | integer | 31 | min 1 | k-mer size of the kallisto index. |
| `star` | object | — | — | STAR options for star_genome and star_genefull. |
| `star.sa_index_nbases` | integer | — | min 1 | Suffix pre-index length; omit to use the genome-size rule. |
<!-- PARAMS:AUTO:END -->

Rules that span parameters. Read length is required for every method except `cdna` and `gentrome`, and the flank is always r minus 1; kb's own flank default of k minus 1 is overridden by passing the value explicitly. kb options apply to `cdna`, `lamanno` and `nac`, STAR options to both STAR methods, and `decoys` only to `gentrome`. A `gentrome` index cannot feed the alevin-fry RAD path. A duplicated gene ID after filtering is a hard error, as is an allowlist that leaves no records.

## 7. MCP tool

Tool name `singlet_ingest_quant_reference_annotation_build` (definition in `tasks/mcp/singlet_ingest_quant_reference_annotation_build.json`). Example call and result:

```json
{"dataset": "lib1.singlet", "method": "splici", "genome_fasta": "refs/genome.fa",
 "annotation": {"gtf": "refs/annotation.gtf.gz", "release": "GENCODE v32",
   "biotype_allowlist": ["protein_coding", "lncRNA"]}}
```

```json
{"dataset": "lib1.singlet", "status": "completed",
 "wrote": ["uns/ref_build", "var/gene_id", "var/gene_name", "var/gene_biotype", "uns/t2g", "uns/gene_set", "uns/index_paths", "uns/decoy_names"],
 "summary": {"method": "splici", "release": "GENCODE v32", "gene_count": "<int>", "excluded_no_biotype_key": "<int>", "multi_chromosome_transcripts": "<int>"},
 "provenance_id": "<id>"}
```

- **Long-running:** a STAR genome index for a human genome takes hours; Cell Ranger's builder prints that the STAR step "may take over 8 core hours for a 3Gb genome" (reference_builder.py:167).
- **Stochastic:** no; the build is deterministic and takes no seed.
- **Dry run:** returns seconds, peak memory in GB and device from genome size and the memory guard in section 4, without writing.

## 8. Benchmarks

Shared protocol. Each design is built with the defaults in section 4 unless a benchmark states a change, and is mapped and quantified by its named tool. Generators take one genome FASTA and one annotation release, and write every read's origin label to disk, so truth never comes from a mapper. Each evaluation uses one thread count, one memory cap and a cold cache. Each design is evaluated with three seeds, and results are reported as the mean and the range over seeds. Thresholds marked proposed are design choices of this document, not literature values.

### B1. Simulated-origin recovery across reference designs (proposed)

- **Goal:** measure how often reads are assigned to their true origin under five designs. No published benchmark with this design is cited here.
- **Ground truth:** planted simulation. The generator labels each read as transcript, intronic or intergenic origin. The estimand is the origin label per read, and every metric pools reads within an origin class.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated reads from a transcript-plus-intron model over one genome and annotation release | generator recipe below | single-cell and single-nucleus; species and release set per evaluation; size not fixed here | — | intronic and intergenic fractions varied on a grid |

Generator recipe:
1. Take one genome FASTA and one annotation release, and define transcripts, introns and gene bodies by the rules of section 5, not from any built index.
2. For each cell, draw molecule counts per transcript from a fixed profile supplied with the evaluation.
3. Convert each molecule to reads of length $r \in \{91, 100\}$ sampled from its sequence. A fraction $f_I$ of reads comes from introns and a fraction $f_U$ from intergenic intervals outside every gene body, chosen by one rule fixed in the evaluation.
4. Apply one substitution error model to all designs.
5. Fix total depth, vary $f_I$ and $f_U$ on a grid, and repeat for seeds 1 to 3.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| read_origin_accuracy | fraction of reads of each origin class assigned to the true feature; a multi-gene assignment is correct if it contains the true gene; multi-gene share reported separately | max | primary | — |
| intronic_recovery | fraction of intronic-origin reads counted to their gene | max | primary | — |
| decoy_absorption_rate | fraction of intergenic-origin reads assigned to a decoy or left unassigned | max | primary | — |
| false_gene_assignment | fraction of intergenic-origin reads counted to any annotated gene | min | guardrail | — |

- **Comparators:** cdna with selective alignment; splici with read length r set explicitly (simpleaf, and kb nac or lamanno); gentrome (Salmon 2.0); STAR GeneFull with unique gene counts; kb standard.
- **Protocol:** read lengths 91 and 100 at fixed depth; $f_I$ and $f_U$ on the grid; metrics pooled over reads, and cell-level summaries of UMIs from UMI-deduplicated counts.
- **Acceptance criterion (proposed, not from the literature):** a design is preferred for a data type only if its primary metric exceeds the best comparator by at least 1 percentage point in all 3 seeds and its guardrail does not exceed the best comparator by more than 0.5 percentage points.
- **Known pitfalls:** a simulator and mapper that share an error model make accuracy optimistic; scoring ambiguous reads against any compatible gene inflates accuracy.

### B2. Planted contigs and host leakage (proposed)

- **Goal:** check that appended contigs are counted at their planted abundance without taking reads from host genes, including contigs homologous to host sequence.
- **Ground truth:** planted simulation. The planted UMI count per contig per cell is fixed for the evaluation and recorded. The estimands are planted UMIs per contig and host UMIs with and without the contigs.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Host reads from the B1 generator plus synthetic contigs at three homology levels | generator recipe below | single-cell; one host genome; size not fixed here | — | host sequence taken from the genome FASTA |

Generator recipe:
1. Create three contig classes: random sequence with no host homology; copies of host gene segments mutated to about 80 percent identity; and copies mutated to about 95 percent identity.
2. Plant a fixed number of UMIs per contig per cell, recorded in the evaluation.
3. Generate host reads by the B1 recipe at one setting of $f_I$.
4. Build the host-only reference and each appended design, and quantify each.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| planted_umi_recovery | fraction of planted contig UMIs counted to the contig after UMI deduplication, pooled over cells | max | primary | — |
| homology_cross_assignment | fraction of host reads assigned to an appended contig because of shared k-mers | min | guardrail | — |
| host_leakage | 99th percentile over host genes of the relative change defined in section 3 | min | guardrail | — |

- **Comparators:** host-only reference (baseline for leakage); host plus contigs in the genome FASTA; host plus contigs in a Salmon decoy-aware index; kb ref with the extra FASTA.
- **Protocol:** the same reads for every design, three seeds, each design mapped by its own tool.
- **Acceptance criterion (proposed, not from the literature):** planted UMI recovery of at least 95 percent for contigs with no host homology, and a host-leakage 99th percentile below 0.5 percent of host gene UMIs.
- **Known pitfalls:** transgenes built from host promoters or UTRs multi-map by construction; a design that appends contigs without an annotation record counts their reads under no gene (section 5 adds one per contig).

### P1. Performance and scaling (proposed)

Measure wall time, peak resident memory and on-disk index size for each build path, on a genome of about 3 Gb (human scale), at read lengths 91 and 100, with 1, 8 and 16 threads (proposed). Comparators are Cell Ranger mkref; the STAR genome index with sjdbOverhang r-1; kb ref cDNA, lamanno and nac; simpleaf index splici; and Salmon 2.0 with decoys. simpleaf fixes its index build memory default at 8 GiB, because the default of the underlying builder scales with RAM; it reports that one human splici index used 22 GB on one machine and 42 GB on a larger one (docs-site/src/content/docs/index-command.md @6abee7e).

Hold fixed the GTF release, thread count, memory cap, read length, storage type and cache state. Cell count is not a scale axis: build cost does not depend on the number of cells, and the 10k, 100k and 1M cell scales belong to the read-mapping task. Acceptance (proposed): each path completes within 1.5 times the fastest path on the same hardware, or the gap is documented. No literature threshold exists.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.barcode_umi_extraction`: Cell barcode and UMI extraction from raw reads
- **Feeds**:
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
  - `ingest-quant.spliced_unspliced_counting`: Spliced, unspliced and ambiguous molecule counting
  - `ingest-quant.intron_inclusive_gene_counting`: Intron-inclusive (gene versus gene-full) counting and pre-mRNA references for nuclei
  - `harmonization.annotation_release_reconciliation`: Reference annotation and assembly release reconciliation
- **Reads**: `uns/ingest_geometry`
- **Writes**: `uns/ref_build`, `var/gene_id`, `var/gene_name`, `var/gene_biotype`, `uns/t2g`, `uns/gene_set`, `uns/index_paths`, `uns/decoy_names`
<!-- CHAINING:AUTO:END -->

This task sits between barcode extraction and read mapping in the FASTQ-to-matrix workflow, and its gene set is the feature space that the counting tasks inherit.

## 10. Risks, pitfalls and open questions

- **Evidence gaps for cited sources.** The spliced-only failures in section 2 are taken from the best-practices chapter; the results of Kaminow et al. [R5], Bruning et al. [R7] and He et al. [R2] are not stated here beyond that chapter. The decoy claim for Srivastava et al. [R1] rests on its title and on the Salmon README. The results of the preprint Pool et al. [R6] and Salmon's fragment-length and bias terms are not stated here.
- **Build behaviour gaps.** Overlapping-gene handling at build time is unknown for Cell Ranger and kb-python. The splici definition of pyroe make-splici, which the best-practices example runs at read length 90, is not stated here. The r-1 splici flank rests on simpleaf's call into roers, whose source is not stated here, so that flank construction has no independent source. The Salmon 1.x decoy script is absent from the checkout.
- **Technical constraints.** Tool-specific constraints are stated once in sections 4 and 6, including kb's flank default, Salmon's index format and the decoy-free RAD path. STAR memory grows with genome size (section 4). Spike-in and transgene reference handling has no source in the cited literature.
- **Unsettled literature.** The best design depends on sample type and mapper, and the optimal flank beyond r-1 is not established. No published benchmark isolates annotation release, biotype filter, flank length or decoy presence on single-cell counts. Whether intronic reads belong in whole-cell counts is contested [R8, R9].
- **Licence and data risks.** Review the section 12 terms before any Cell Ranger output appears in a published benchmark. The terms of real libraries used in the folded benchmarks are not stated here.
- **First experiment and folded benchmarks.** The first experiment is B1 on splici and cdna at read lengths 91 and 100 for one $f_I$ setting, to test the 1-point acceptance rule before the locus model is trained. Two benchmarks are folded here because their inputs are not chosen. The nucleus-versus-whole-cell benchmark needs matched labelled libraries, and catalogue labels may inherit the reference choice of their annotating study; its proposed rule recommends intron-inclusive features for nuclei if median UMI recovery rises and ARI is not lower by more than 0.01, and for whole cells if ARI rises by at least 0.01. Neither median UMI recovery nor ARI is defined in this document. The annotation-release benchmark needs two GENCODE releases and a read set; its build checks are in section 5.

## 11. References

R1. Srivastava A, Malik L, Sarkar H, Zakeri M, Almodaresi F, Soneson C, Love MI, Kingsford C, Patro R. Alignment and mapping methodology influence transcript abundance estimation. *Genome Biology* 2020;21(1). doi:10.1186/s13059-020-02151-8 — verified (corpus)
R2. He D, Zakeri M, Sarkar H, Soneson C, Srivastava A, Patro R. Alevin-fry unlocks rapid, accurate and memory-frugal quantification of single-cell RNA-seq data. *Nature Methods* 2022;19(3):316-322. doi:10.1038/s41592-022-01408-3 — verified (corpus)
R3. Melsted P, Booeshaghi AS, Liu L, Gao F, Lu L, Min KH, da Veiga Beltrame E, Hjorleifsson KE, Gehring J, Pachter L. Modular, efficient and constant-memory single-cell RNA-seq preprocessing. *Nature Biotechnology* 2021;39:813-818. doi:10.1038/s41587-021-00870-2 — verified (corpus)
R4. Dobin A, Davis CA, Schlesinger F, Drenkow J, Zaleski C, Jha S, Batut P, Chaisson M, Gingeras TR. STAR: ultrafast universal RNA-seq aligner. *Bioinformatics* 2013;29(1):15-21. doi:10.1093/bioinformatics/bts635 — verified (corpus)
R5. Kaminow B, Yunusov D, Dobin A. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021 (preprint). doi:10.1101/2021.05.05.442755 — verified (corpus)
R6. Pool AH, Poldsam H, Chen S, Thomson M, Oka Y. Enhanced recovery of single-cell RNA-sequencing reads for missing gene expression data. *bioRxiv* 2022 (preprint). doi:10.1101/2022.04.26.489449 — verified (corpus)
R7. Bruning RS, Tombor L, Schulz MH, Dimmeler S, John D. Comparative analysis of common alignment tools for single-cell RNA sequencing. *GigaScience* 2022;11. doi:10.1093/gigascience/giac001 — verified (corpus)
R8. Soneson C, Srivastava A, Patro R, Stadler MB. Preprocessing choices affect RNA velocity results for droplet scRNA-seq data. *PLoS Computational Biology* 2021;17(1):e1008585. — verified (corpus)
R9. 10x Genomics. Technical Note: Interpreting intronic and antisense reads in 10x Genomics Single Cell Gene Expression data. 2021. https://www.10xgenomics.com/support/single-cell-gene-expression/documentation/steps/sequencing/interpreting-intronic-and-antisense-reads-in-10-x-genomics-single-cell-gene-expression-data — verified (corpus)
R10. Patro R, Duggal G, Love MI, Irizarry RA, Kingsford C. Salmon provides fast and bias-aware quantification of transcript expression. *Nature Methods* 2017;14(4):417-419. doi:10.1038/nmeth.4197 — verified (corpus)
R11. kallisto, bustools and kb-python for quantifying bulk, single-cell and single-nucleus RNA-seq. *Nature Protocols* 2024. doi:10.1038/s41596-024-01057-0 — verified (corpus)
R12. simpleaf: a simple, flexible, and scalable framework for single-cell data processing using alevin-fry. *Bioinformatics* 2023. doi:10.1093/bioinformatics/btad614 — verified (corpus)
R13. Zheng GXY et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017;8:14049. doi:10.1038/ncomms14049 — verified (corpus)
R14. Single-cell best-practices book, raw data processing chapter (jupyter-book/introduction/raw_data_processing.md in the theislab/single-cell-best-practices repository). — verified (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/10XGenomics/cellranger | 10x Genomics (copyright holder in LICENSE) | Custom 10x Genomics licence (copyright 2026): internal use in connection with 10x products; not an OSI licence | mkref, mkgtf and reference builder; comparator (revision 669395e) | callout |
| https://github.com/alexdobin/STAR | Alexander Dobin | MIT (copyright 2019 Alexander Dobin) | genome index, sjdb insertion and GeneFull; 2.7.11b per README (revision b1edc12) | callout |
| https://github.com/pachterlab/kb_python | Kyung Hoi (Joseph) Min (setup.py author); A. Sina Booeshaghi credited in README | BSD-2-Clause (copyright 2019 Pachter Lab) | cDNA, lamanno and nac extraction; kallisto index; 0.30.2 per README (revision 188d9c7) | port |
| https://github.com/COMBINE-lab/simpleaf | COMBINE lab | BSD-3-Clause (copyright 2022 COMBINE lab) | splici and spliceu wrapper and defaults (revision 6abee7e) | port (wrapper); reimplement (augmentation) |
| https://github.com/COMBINE-lab/alevin-fry | COMBINE lab, University of Maryland | BSD-3-Clause (copyright 2020- University of Maryland) | RAD path and its decoy-aware index restriction (revision ad05742) | callout |
| https://github.com/COMBINE-lab/salmon | COMBINE lab | BSD-3-Clause (copyright 2026 COMBINE lab) | gentrome construction and index format; Rust rewrite (README: 2.0; Cargo workspace 2.8.0) (revision ed926b8) | port |
