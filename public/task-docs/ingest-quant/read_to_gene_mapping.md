---
id: ingest-quant.read_to_gene_mapping
title: Read-to-gene mapping engine: genome alignment versus pseudoalignment
area: ingest-quant
scope: core
paradigm: hybrid
literature_status: contested
priority: P0
depends_on: [ingest-quant.barcode_umi_extraction, ingest-quant.barcode_whitelist_correction, ingest-quant.reference_annotation_build]
feeds: [ingest-quant.umi_deduplication, ingest-quant.multi_gene_read_assignment, ingest-quant.spliced_unspliced_counting, cell-calling.cell_vs_empty_droplet_calling]
reads: [uns/ingest_geometry]
writes: [layers/counts, obs/mapped_fraction, obs/multigene_umi_fraction, obs/frac_intronic_reads, uns/mapping_run, uns/ec_incidence, models/mapping_em]
devices: [cpu, cuda]
mcp_tool: singlet_ingest_quant_read_to_gene_mapping
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Read-to-gene mapping engine: genome alignment versus pseudoalignment

> Assign the cDNA reads of one single-cell or single-nucleus library to genes with a chosen engine, resolve reads and UMIs that fit more than one gene, and report the barcode-by-gene UMI matrix together with the time and memory the engine used.

## 1. Question

Given the parsed cDNA reads of a droplet or nucleus library with corrected cell barcodes, and a reference (genome with annotation, spliced transcriptome, or exon-plus-intron "splici" sequence), which engine places each read on its gene of origin most accurately, and at what time and memory? Barcode parsing, whitelist correction and the UMI-collapse rule are held fixed, so the comparison isolates the engine and its treatment of multi-gene evidence. The output is a barcode-by-gene UMI matrix (integer or expected counts) under a recorded multi-gene policy, with diagnostics and a run record. A simulator supplies the true gene of every read; on real data the evidence is cross-engine concordance and gene plausibility (section 8).

## 2. Why this task matters and where the field stands

Every droplet 3' and single-nucleus workflow contains this step: it turns sequence-level decisions into gene-level counts that feed cell calling, normalisation and clustering. Whole-workflow benchmarks find that the choice of preprocessing tool typically matters less for downstream analyses such as clustering than other steps [R1], and that normalisation and library preparation have the largest impact [R2]; they confound the engine with other choices.

Genome alignment places reads by alignment score: STAR [R3], STARsolo with barcode matching, UMI collapsing and multi-gene recovery [R4], and the STAR-based Cell Ranger [R5]. Pseudoalignment returns the compatible targets without alignment: kallisto [R7], bustools [R8] and kb-python [R9]. Selective alignment scores candidate transcript mappings without computing the alignment backtrace: Salmon [R10], alevin [R11] and alevin-fry [R12]. The question is contested on four points.

1. **Intronic reads.** A large share of reads in nuclei, and in whole cells, is intronic; a spliced-only reference cannot assign them and an intron-inclusive one changes the matrix. 10x Genomics describes how to interpret them [R14], Pool et al. argue for including them [R15], pre-mRNA length biases unspliced counts [R16], and such choices change RNA velocity results [R23].
2. **Multi-gene evidence.** Paralogous and overlapping genes yield reads and UMIs compatible with several genes. Alevin resolves them with a parsimony graph and EM [R11]; STARsolo and alevin-fry offer further rules (section 3.2). No policy is agreed, and its effect interacts with intron augmentation.
3. **Spurious mapping.** Lightweight mapping to a spliced transcriptome can raise expression of genes implausible for the tissue, and STARsolo is much faster and lighter than Cell Ranger with almost identical results [R6].
4. **Evaluation.** kallisto/bustools was reported faster and lighter than alevin-fry [R17]; a reply argued that the configurations differed greatly and overlooked alevin-fry's fast, low-memory settings [R18].

## 3. Theory and insight

All three families reduce each read or UMI to a compatibility set; the count then depends on how that set is resolved.

**3.1 Compatibility sets.** Pseudoalignment assigns a read $r$ the intersection of the target sets $T(\kappa_j)$ of its $m$ sampled k-mers $\kappa_j$:

$$S(r)=\bigcap_{j=1}^{m}T(\kappa_j) \tag{1}$$

The rule is exact when the sampled k-mers match the reference: read length much greater than $k$ and error rate low relative to $k$. Paralogs of identical sequence give identical $S(r)$. kb-python exposes hidden options that change the rule: `union` replaces the intersection by the union and `no_jump` disables k-mer skipping (defaults table). STAR instead seeds maximal mappable prefixes on a suffix array, stitches seeds across junctions and places the read by alignment score; the score is not a probability of the gene of origin, so a score threshold gives no calibrated error rate. Selective alignment scores candidate transcript mappings and passes them to an EM [R10, R13].

**3.2 Resolution as a categorical mixture.** In one cell, UMIs are collapsed into equivalence classes $e$ (distinct gene sets $G_e$) with $n_e$ distinct UMIs each. The gene of origin of a UMI in class $e$ is latent in $G_e$, with gene molecule fraction $\theta_g$ ($\sum_g\theta_g=1$). Summing it out gives the objective of equivalence-class EM:

$$\ell(\theta)=\sum_{e} n_e\log\sum_{g\in G_e}\theta_g,\qquad \theta_g\ge 0 \tag{2}$$

$$w_{e,g}^{(t)}=\frac{n_e\,\theta_g^{(t)}}{\sum_{h\in G_e}\theta_h^{(t)}}\ (g\in G_e),\qquad \theta_g^{(t+1)}=\frac{\sum_e w_{e,g}^{(t)}}{\sum_{g'}\sum_e w_{e,g'}^{(t)}} \tag{3, 4}$$

Here $w_{e,g}$ is the expected number of UMIs of class $e$ assigned to gene $g$. The Jensen argument holds for any positive joint weight with this marginal, so each iteration does not decrease $\ell$. Because $\ell$ is concave in $\theta$ (a sum of logarithms of linear functions), EM has no spurious local maxima; the maximiser set can still be a face of the simplex. Three limits follow. *Pseudo-likelihood*: the class terms do not sum to one across classes when genes share classes, so $\ell$ is not a calibrated probability. *Identifiability*: if genes $h$ and $g$ lie in exactly the same classes, $\ell$ depends only on $\theta_h+\theta_g$ and the split is set by the starting values; only a prior or a sequence-level feature separates paralogs. *Boundary*: the maximiser often has $\theta_g=0$ for many genes, so expected counts of weakly supported genes are unstable and fractional.

The heuristic rules are fixed-$\theta$ special cases of the E-step. With $u_g$ the UMIs of the single-gene class $\{g\}$ and $G$ the gene set of a multi-gene UMI, the count $c_g$ of gene $g$ grows by

$$\frac{1}{|G|}\ \text{(Uniform)},\qquad \frac{u_g}{\sum_{h\in G}u_h}\ \text{(PropUnique; uniform if the denominator is 0)} \tag{5}$$

Uniform is equation (3) at $\theta_h=1$ on $G$; PropUnique is equation (3) at $\theta\propto u$, with no M-step and no iteration. STARsolo `Rescue` distributes proportionally to unique plus uniformly allocated multi-gene UMIs, the first EM step; `Unique` discards every multi-gene UMI. alevin-fry `cr-like` assigns a multi-gene UMI to the gene with the highest read count and discards ties; `cr-like-em` resolves ties by EM. None of these rules gives a likelihood or an uncertainty for $c_g$, and none maximises (2) in general.

**3.3 UMI collapsing.** Reads sharing cell, class and UMI are one molecule. The directional rule of UMI-tools [R19] links UMI $u$ to $v$ when $d_H(u,v)\le 1$ and $c_u\ge 2c_v-1$, with $c$ the read count of a UMI. It is a count-ratio criterion, not a likelihood; it assumes substitution errors only and counts large enough for $c_u$ to estimate the parent abundance. The collapse rule is held fixed here and belongs to ingest-quant.umi_deduplication.

**3.4 What a model adds.** Fixed rules are fast, deterministic and auditable and agree when multi-gene evidence is rare, but diverge on paralog families and when multi-gene UMIs are common, because discarding or winner-take-all biases whole families. The explicit model adds a likelihood, a fitted $\theta$ that other tasks can reuse (`models/mapping_em`), and uncertainty: the alevin-fry bootstrap resamples the equivalence-class counts and repeats the EM, which measures sampling variability conditional on the model. It does not correct misspecification such as the missing effective-length and sequence-bias terms that make Salmon bias-aware [R10]. The EM costs $O(T\,\mathrm{nnz}(M))$ per cell for $T$ iterations and class-by-gene incidence $M$ ($M_{eg}=1$ if $g\in G_e$).

**3.5 Estimands.** $c_g$ is the number of UMIs of gene $g$ in a barcode after the recorded policy and UMI collapse, integer for whole-UMI policies and an expected count for fractional ones, not depth-normalised. `mapped_fraction` is the reads of a barcode (parse status ok) mapped to any reference feature divided by those reads. `multigene_umi_fraction` is the UMIs of a barcode whose class has more than one gene divided by all its UMIs. `frac_intronic_reads` is the UMIs of a barcode assigned to unspliced features divided by all its UMIs in a spliced/unspliced/ambiguous quantification.

**3.6 Failure modes and pitfalls.**

- Spliced-only references: intronic reads whose k-mers occur in exons go to the mature gene, the others stay unassigned, and lightweight mapping can add spurious expression [R6]. Intron-inclusive references leave divergent UMI collisions among introns unresolved [R16].
- STAR counts intronic reads only with an intron-inclusive feature (`GeneFull`), a counting choice and not a property of the aligner.
- Equations (2) to (4) are first order: UMIs are distinct molecules after collapsing, genes are independent across UMIs and cells, and there are no length or bias terms.
- Incomplete UTR annotation misplaces reads; the alevin-fry documentation describes the `parsimony-gene` variants as more robust to it.
- Speed and memory comparisons are invalid unless configurations are matched [R17, R18]; engine versions change counts; cell-calling differences confound per-cell gene content [R6].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| STAR | heuristic | Seeds maximal mappable prefixes on a genome suffix array, stitches seeds across junctions and places the read by alignment score | [R3] |
| STARsolo | hybrid | STAR plus barcode matching, UMI collapsing (`1MM_All`, `1MM_CR`, directional variants) and multi-gene recovery (`Uniform`, `PropUnique`, `Rescue`, `EM`) | [R4] |
| Cell Ranger | heuristic | Commercial STAR-based pipeline with 10x whitelist correction, UMI collapsing and gene counting; source published for information only | [R5] |
| kallisto, bustools, kb-python | hybrid | k-mer pseudoalignment writes a BUS file; `bustools count` collapses UMIs per class and drops UMIs whose class spans several genes unless `--multimapping`; hidden `--em` estimates abundances by EM | [R7, R8, R20, R9] |
| alevin-fry (Salmon mapping) | hybrid | Salmon selective alignment or sketch mode on a splici reference writes RAD files, collated by barcode; resolution by `cr-like`, `cr-like-em`, `trivial` or parsimony-graph variants with EM for ties | [R10, R11, R12] |
| zUMIs | heuristic | STAR-based pipeline (user-provided STAR index) with UMI and barcode handling for flexible read layouts | [R21] |

The published standard for droplet data is genome alignment, through Cell Ranger and STARsolo, whose documentation states that it follows Cell Ranger logic, gives nearly identical gene counts and is about ten times faster. Lightweight mapping is the faster alternative whose claims section 8 tests under matched configuration. The fixed rules above are the comparators for the model-based resolution of section 5.

Exact defaults used by singlet's adapters and counting rules:

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| STARsolo | `soloType` | `None` | source/parametersDefault:771 @ b1edc12 |
| STARsolo | `soloUMIlen` | 10 (10x v3 needs 12) | parametersDefault:796 @ b1edc12; docs/STARsolo.md:73 |
| STARsolo | `soloCBmatchWLtype` | `1MM_multi` | parametersDefault:831 @ b1edc12 |
| STARsolo | `soloStrand` | `Forward` | parametersDefault:851 @ b1edc12 |
| STARsolo | `soloFeatures` | `Gene`; `GeneFull` counts exons and introns | parametersDefault:857-863 @ b1edc12 |
| STARsolo | `soloMultiMappers` | `Unique`; `Uniform`, `Rescue`, `PropUnique`, `EM` | parametersDefault:869-875; docs/STARsolo.md:246-266 @ b1edc12 |
| STARsolo | `soloUMIdedup` | `1MM_All`; also `1MM_Directional_UMItools`, `1MM_Directional`, `Exact`, `NoDedup`, `1MM_CR` | parametersDefault:877-884 @ b1edc12 |
| STARsolo | `soloUMIfiltering` | `-` (remove UMIs with N and homopolymers) | parametersDefault:886-888 @ b1edc12 |
| STARsolo | `soloCellFilter` | `CellRanger2.2 3000 0.99 10`; `None` writes no filtered cells | parametersDefault:898-900 @ b1edc12 |
| STARsolo | `outFilterMultimapNmax`, `winAnchorMultimapNmax` | 10, 50 | parametersDefault:463, 663 @ b1edc12 |
| STARsolo | `--genomeSAsparseD 3` | fits 16 GB RAM at 30 to 50 percent lower speed | docs/STARsolo.md:119 @ b1edc12 |
| alevin-fry | `--resolution` | required, no default | src/main.rs:312-315 @ ad05742 |
| alevin-fry | `--umi-edit-dist` | 0 for `cr-like`, `cr-like-em`, `trivial`; 1 for parsimony variants | src/main.rs:321-332 @ ad05742 |
| alevin-fry | `--large-graph-thresh` | 1000 for parsimony variants, 0 otherwise | src/main.rs:333-342 @ ad05742 |
| alevin-fry | `--small-thresh` | 100 (0 resolves every cell with the requested strategy) | src/main.rs:343-345 @ ad05742 |
| alevin-fry | `--num-bootstraps` | 0; meaningful for EM resolutions | src/main.rs:306; docs/source/quant.rst:32 @ ad05742 |
| kb-python | `strand`, `threads` | `None`, 8 | kb_python/count.py:118, 112 @ 188d9c7 |
| kb-python | `union`, `no_jump` | `False`, `False` (CLI flags hidden) | count.py:128-129; main.py:1562-1565 @ 188d9c7 |
| kb-python | `mm`, `em` of `bustools count` | `False`, `False` (`--em` hidden) | count.py:476, 479; main.py:1355 @ 188d9c7 |
| bustools | multi-gene classes | filtered unless `--multimapping` | src/bustools_count.cpp:202-204 @ d4d7a28 |
| UMI-tools | directional rule | edge if $d_H\le 1$ and $c_u \ge 2c_v-1$ | umi_tools/network.py:194-209 @ 79d8b81 |

## 5. Proposed singlet approach

- **Wrap the engines.** The first release wraps the installed engines (STARsolo, kb-python with bustools, alevin-fry with Salmon) and records engine version and index hash. Routes per engine are in section 12. Cell Ranger enters only as a matrix imported from the user's own licensed installation.
- **Model-based resolution.** singlet reimplements what follows the engine: the fixed rules of equation (5) and a class-level EM, equations (2) to (4). For `alevin_fry` the engine writes its equivalence classes (`--dump-eqclasses`), singlet's EM (`singlet_em`) resolves them, and an optional bootstrap of the class counts gives per-gene intervals. The proposal is falsified if (a) `singlet_em` does not exceed the best fixed rule on B1 `umi_spearman` over genes in multi-gene classes by 0.01 (margin proposed); (b) pooled 95 percent bootstrap intervals cover the planted count for fewer than 90 percent of genes with at least 10 true UMIs (floor proposed); or (c) the GPU EM differs from the CPU EM by more than $10^{-3}$ UMIs per gene and cell (tolerance proposed), an engineering failure that blocks accuracy claims.
- **ML stack.** No neural network. The EM is small, sparse and fixed in form, so it is hard-coded in CUDA with cuSPARSE sparse matrix-vector products for the E and M steps, batched by cell, with convergence on the relative change of $\ell$; PyTorch is not used. There are no trained parameters. The catalogue of 354 million cells (about 40 percent with author annotations) supplies per-gene count structure for B1 only.
- **Devices and scale.** Engine stages run on the CPU for every mapper; `device` applies to `singlet_em` and the bootstrap. Engines read FASTQ as a stream and the EM is per cell, so batches of cells bound memory; the incidence is stored in `uns/ec_incidence` for ingest-quant.multi_gene_read_assignment.
- **Defaults without asking.** `mapper` `alevin_fry` (to be confirmed by B2 and P1); `reference_type` `spliced_transcriptome` for cells and `splici_intronic` for nuclei, set explicitly; `multi_gene_policy` `cr_like_em`, with `singlet_em` promoted once B1 acceptance is met; `small_thresh` 0; `cell_filter` `None`; `threads` 8; `device` `auto`. Expose `mapper`, `reference_type`, `multi_gene_policy`, `strandedness` and `threads` to users.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/ingest_geometry | dict | Resolved spans and UMI length from ingest-quant.barcode_umi_extraction. |
| read (`inputs`) | none (files) | parse stream, FASTQ, index | Parse stream after whitelist correction; R1 (barcode, UMI) and R2 (cDNA); genome directory, kallisto or Salmon index, or splici FASTA. Not members. |
| write | layers/counts | non-negative numeric | Unfiltered barcode-by-gene UMI matrix for every barcode with at least one UMI; integer for whole-UMI policies, float32 expected counts otherwise (type recorded in `uns/mapping_run`). |
| write | obs/mapped_fraction | float32 | Share of the barcode's reads mapped to any feature. |
| write | obs/multigene_umi_fraction | float32 | Share of the barcode's UMIs whose class has more than one gene. |
| write | obs/frac_intronic_reads | float32 | Share of UMIs on unspliced features; only for `alevin_fry` with `splici_intronic`, from a second quantification in spliced/unspliced/ambiguous mode, which alevin-fry supports for `cr-like` and `cr-like-em` only (quant.rst). |
| write | uns/mapping_run | dict | Engine, version, reference hash, full parameter set including values sent explicitly, applied policy, wall time, peak memory. |
| write | uns/ec_incidence | sparse bool | Class-by-gene incidence and class counts $n_e$ per cell; always written for `alevin_fry`, absent for imports. |
| write | models/mapping_em | sparse float32 | Per-cell $\theta$ and, when bootstraps are requested, the bootstrap mean and variance; only for EM policies. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `inputs` | object | — | — | Files and library properties the engine reads. Not .singlet members. |
| `inputs.parse_stream` | string | — | — | Parse stream after whitelist correction: read_id, corrected barcode, UMI, cdna_read_id, parse status. Path or URI. |
| `inputs.fastq_r1` | string | — | — | R1 FASTQ holding the cell barcode and UMI. Path or URI. |
| `inputs.fastq_r2` | string | — | — | R2 FASTQ holding the cDNA. Path or URI. |
| `inputs.reference_index` | string | — | — | Genome directory, kallisto index, Salmon index or splici FASTA from reference_annotation_build; must match reference_type and mapper. |
| `inputs.reference_type` | string | "spliced_transcriptome" | `genome_gtf`, `spliced_transcriptome`, `splici_intronic` | Sequence set the reads are mapped against. Use splici_intronic for nuclei; starsolo uses genome_gtf. |
| `inputs.strandedness` | string | "forward" | `unstranded`, `forward`, `reverse` | Read orientation relative to transcripts. Sent explicitly to every engine and recorded. |
| `inputs.imported_matrix` | string | — | — | Only for cellranger_import: path to a Cell Ranger raw_feature_bc_matrix directory, used instead of the FASTQ files. |
| `mapper` | string | "alevin_fry" | `alevin_fry`, `starsolo`, `kb_kallisto_bustools`, `cellranger_import` | Engine. cellranger_import maps nothing: it reads a matrix produced by the user's own licensed Cell Ranger installation. |
| `multi_gene_policy` | string | "cr_like_em" | `discard`, `uniform`, `prop_unique`, `rescue`, `em`, `cr_like`, `cr_like_em`, `trivial`, `parsimony`, `parsimony_em`, `parsimony_gene`, `parsimony_gene_em`, `singlet_em` | Multi-gene resolution. starsolo: discard, uniform, prop_unique, rescue, em. kb: discard, em. alevin_fry: cr_like*, trivial, parsimony*, singlet_em. Invalid pairs are rejected. |
| `threads` | integer | 8 | min 1; max 256 | Worker threads for the engine stages. |
| `alevin_fry` | object | — | — | Options used only when mapper is alevin_fry. |
| `alevin_fry.mapping_mode` | string | "selective_alignment" | `selective_alignment`, `sketch` | Salmon mapping stage: selective alignment, or sketch (pseudoalignment without per-placement scores). |
| `alevin_fry.small_thresh` | integer | 0 | min 0 | Cells with fewer reads use cr-like semantics whatever the policy; 0 resolves every cell with the requested policy. Engine default 100. |
| `alevin_fry.umi_edit_distance` | integer/null | null | min 0; max 1 | Hamming radius for merging UMIs; null uses the engine default (0 for cr_like*, trivial; 1 for parsimony*). |
| `alevin_fry.large_graph_thresh` | integer | 1000 | min 1 | Parsimony graph order above which a faster strategy applies; parsimony policies only. |
| `starsolo` | object | — | — | Options used only when mapper is starsolo. |
| `starsolo.features` | string | "Gene" | `Gene`, `GeneFull`, `GeneFull_ExonOverIntron`, `GeneFull_Ex50pAS` | soloFeatures: Gene counts reads matching transcripts; GeneFull variants also count intronic reads (pre-mRNA). |
| `starsolo.umi_dedup` | string | "1MM_All" | `1MM_All`, `1MM_Directional_UMItools`, `1MM_Directional`, `1MM_CR`, `Exact`, `NoDedup` | soloUMIdedup: UMI collapsing rule. |
| `starsolo.cell_filter` | string | "None" | — | soloCellFilter string. None writes the matrix without engine cell filtering; engine default is CellRanger2.2 3000 0.99 10. |
| `starsolo.max_multimap` | integer | 10 | min 1 | outFilterMultimapNmax: maximum loci a read may map to before it is treated as unmapped. |
| `kb_kallisto_bustools` | object | — | — | Options used only when mapper is kb_kallisto_bustools. |
| `kb_kallisto_bustools.union` | boolean | false | — | Use the union instead of the intersection of k-mer target sets in pseudoalignment. |
| `kb_kallisto_bustools.no_jump` | boolean | false | — | Disable k-mer jumping in pseudoalignment. |
| `em` | object | — | — | Options for EM policies (em, cr_like_em, parsimony_em, singlet_em). |
| `em.bootstraps` | integer | 0 | min 0 | Bootstrap replicates of the class counts for per-gene uncertainty; 0 disables. Not valid for starsolo or kb. |
| `em.seed` | integer | 0 | — | Random seed for bootstrap resampling in singlet_em. |
| `em.max_iterations` | integer | 1000 | min 1 | Maximum EM iterations for singlet_em (proposed default). |
| `em.tolerance` | number | 1e-06 | > 0 | Relative change of the log-likelihood below which singlet_em stops (proposed default). |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device for singlet_em and bootstrap; engine stages run on the CPU. auto picks CUDA when a device with enough memory exists. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters: `inputs.reference_type` `genome_gtf` goes with `starsolo`, the other two with `alevin_fry` and `kb_kallisto_bustools`; `cellranger_import` uses `inputs.imported_matrix` and ignores the policy. `starsolo.features` `GeneFull*` is the intron-inclusive path for STARsolo. `alevin_fry.umi_edit_distance` 1 is valid only for parsimony policies. `em.bootstraps` above 0 is valid for `cr_like_em`, `parsimony_em` and `singlet_em`; `max_iterations` and `tolerance` apply to `singlet_em`. The adapter always sends strandedness explicitly. Invalid combinations are rejected, never replaced.

## 7. MCP tool

Tool name `singlet_ingest_quant_read_to_gene_mapping` (definition in `tasks/mcp/singlet_ingest_quant_read_to_gene_mapping.json`). Example call and a schematic result (placeholders in angle brackets):

```json
{"dataset": "lib1.singlet",
 "inputs": {"parse_stream": "lib1/parse.tsv.gz", "fastq_r1": "lib1/R1.fastq.gz", "fastq_r2": "lib1/R2.fastq.gz",
            "reference_index": "refs/splici_index", "reference_type": "splici_intronic"},
 "mapper": "alevin_fry", "multi_gene_policy": "cr_like_em", "threads": 10}
{"dataset": "lib1.singlet", "status": "completed",
 "wrote": ["layers/counts", "obs/mapped_fraction", "obs/multigene_umi_fraction", "obs/frac_intronic_reads",
           "uns/mapping_run", "uns/ec_incidence", "models/mapping_em"],
 "summary": {"mapper": "alevin_fry", "multi_gene_policy": "cr_like_em", "barcodes_with_umi": "<int>",
             "genes_detected": "<int>", "median_mapped_fraction": "<float>", "em_converged": "<bool>",
             "wall_clock_s": "<float>"},
 "provenance_id": "<id>"}
```

Long-running: yes, queued above a server-set input size. Stochastic: only when `em.bootstraps` is above 0, seeded by `em.seed`. Dry run: `seconds`, `peak_memory_gb` and `device` from read count, index size, `threads` and policy, calibrated on P1.

## 8. Benchmarks

Shared protocol. One human reference (GRCh38 with a single fixed GENCODE annotation and its splici derivative) and one parse stream and whitelist per library are given to every engine. Engine and tool versions are pinned and recorded, `alevin_fry.small_thresh` is 0, and `threads` is 10. Engines are applied to identical reads. Barcode sets, where needed, are the barcodes with at least 1,000 UMIs in the engine's own matrix (threshold proposed), so that cell calling does not enter. CPU and GPU timings are never compared without normalising for hardware. B1 is constructed by singlet and proposed; B2 follows published designs [R6, R17, R18] on a library re-measured; P1 is proposed.

### B1. Planted read-origin simulation (proposed)

- **Goal**: measure how often each engine places a read on its true gene, including intronic and paralog reads, and how closely UMI counts follow planted counts.
- **Ground truth**: planted simulation. Read names carry the true barcode, UMI, gene $g^*(r)$ and feature (exon or intron). $T(r)$ is the set of genes whose annotated sequence contains the error-free read exactly (exact k-mer search before mapping). UMI truth is the planted molecule count per gene and cell, raw and not depth-normalised, with intron-origin molecules counted to their gene.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B1-sim, spliced-only and intron-inclusive variants | Recipe below; no accession | Simulated 10x 3' reads, human; 5,000 cells, 20,000 reads per cell (proposed); counts fitted to human 10x 3' catalogue libraries | — | Intronic fraction from real data |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| read_origin_recall | Fraction of reads whose reported gene set $A(r)$ contains $g^*(r)$; empty is a miss. Split by $\lvert T(r)\rvert=1$ and $>1$. | higher | primary | proposed |
| umi_spearman | Spearman correlation (average ranks) of planted and engine pooled UMI totals over genes with at least 10 planted UMIs (10 proposed). | higher | primary | proposed |
| intron_recovery | Among intron-origin molecules, fraction counted to their true gene; intron-inclusive configurations only. | higher | primary | proposed |
| interval_coverage | Fraction of those genes whose planted pooled count lies within bootstrap mean $\pm1.96\sqrt{\sum_{\text{cells}}\mathrm{var}}$ (cells independent). | near 0.95 | guardrail | proposed |

- **Comparators**: STARsolo (`discard`, `em`; `Gene`, `GeneFull`), kb-python (`discard`, `em`, `union`), alevin-fry (`cr_like`, `cr_like_em`, `parsimony_em`, `singlet_em`). Cell Ranger is excluded (section 10).
- **Protocol**: (1) fit a per-gene count model to the source libraries, family fixed beforehand; (2) draw molecule counts per gene and cell; (3) write spliced reads and intronic reads at the real-data fraction, adding paralog and overlapping-gene reads and a fixed substitution error model; (4) score each engine on a held-out seed and repeat on a second seed.
- **Acceptance criterion** (proposed): on the spliced-only variant the best engine reaches `umi_spearman` at least 0.95 and `read_origin_recall` at least 0.90; on the intron-inclusive variant `intron_recovery` is at least 0.90; `interval_coverage` is at least 0.90.
- **Known pitfalls**: circularity when simulator and engine share annotation or error model inflates accuracy; paralog truth is ambiguous, so the exact-match rule for $T(r)$ is fixed in advance.

### B2. Cross-engine concordance and plausibility on a real library (published designs, re-measured)

- **Goal**: test whether engines agree on barcodes and gene counts on real data and whether any adds expression that is implausible for the tissue [R6, R17, R18].
- **Ground truth**: consistency, no planted truth. Each engine is compared with the STARsolo matrix, the open counterpart of Cell Ranger [R4]; agreement is not accuracy.
- **Datasets**

| Dataset | Source (reference, accession or URL) | Modality, species, size | License | Notes |
|---|---|---|---|---|
| pbmc10k_v3 | Name as used in [R17]; accession and URL — | 10x 3' PBMC, human, about 10,000 cells by name | — | Same library as the 10k point of P1 |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| barcode_jaccard | $\lvert A\cap B\rvert/\lvert A\cup B\rvert$ of the barcode sets of two engines. | higher | primary | [R17] |
| gene_count_correlation | Pearson correlation of log1p UMI counts over all (cell, gene) pairs, zeros included, for barcodes in both sets and the union of genes. | higher | primary | [R17] |
| implausible_family_share | UMIs on olfactory receptor genes (symbols matching `OR[0-9]`) divided by all UMIs of the barcode set; the proxy follows the Vmn and Olfr finding of [R6]. | lower | guardrail | proposed |

- **Comparators**: STARsolo (reference), kb-python (intersection and `union`), alevin-fry (`cr_like_em`, `parsimony_em`, `singlet_em`), and a Cell Ranger matrix imported from the user's own installation when the licence permits publishing results.
- **Protocol**: same FASTQ, parse stream, whitelist and annotation for all engines; each engine is applied once, as the engines are deterministic.
- **Acceptance criterion** (proposed; the sources give no thresholds): every non-reference engine reaches `gene_count_correlation` at least 0.95 and `barcode_jaccard` at least 0.90 against STARsolo, and `implausible_family_share` at most twice that of STARsolo.
- **Known pitfalls**: two engines can share a bias, so concordance does not establish correctness (B1 does); olfactory receptor expression is an indirect proxy and a small true signal is possible.

### P1. Performance and scaling (proposed)

- **Scales**: 10k cells on pbmc10k_v3; 100k and 1M cells simulated with the B1 recipe at the reads per cell of pbmc10k_v3; 10M cells for the resolution stage alone, from exported classes, to test the streaming claim. CPU and CUDA for `singlet_em`; engine stages on CPU.
- **Metrics**: wall clock, CPU time and peak resident memory of mapping and of resolution separately; throughput in reads per second; index build time and size; slope of $\log$ wall time on $\log$ cells with its confidence interval. All lower is better except throughput.
- **Comparators and protocol**: as B1 plus Cell Ranger where publishable; configurations matched as in [R18]; cold and warm page cache reported separately; storage, read length and chemistry held fixed.
- **Acceptance criterion** (proposed): at 1M cells the GPU EM stage takes at most 25 percent of the mapping wall time of the same library and its peak memory stays below the engine's; the GPU and CPU EM agree within the B1 tolerance.
- **Known pitfalls**: page-cache state changes disk-bound timings; engine versions change both counts and timings.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.barcode_umi_extraction`: Cell barcode and UMI extraction from raw reads
  - `ingest-quant.barcode_whitelist_correction`: Cell barcode correction (whitelist-based or inferred barcode set)
  - `ingest-quant.reference_annotation_build`: Reference genome and annotation preparation for single-cell counting (including custom host-plus-pathogen and transgene references)
- **Feeds**:
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `ingest-quant.multi_gene_read_assignment`: Gene-ambiguous (multi-gene) read and UMI assignment
  - `ingest-quant.spliced_unspliced_counting`: Spliced, unspliced and ambiguous molecule counting
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
- **Reads**: `uns/ingest_geometry`
- **Writes**: `layers/counts`, `obs/mapped_fraction`, `obs/multigene_umi_fraction`, `obs/frac_intronic_reads`, `uns/mapping_run`, `uns/ec_incidence`, `models/mapping_em`
<!-- CHAINING:AUTO:END -->

This task is the mapping step of the FASTQ-to-counts recipe. ingest-quant.multi_gene_read_assignment re-resolves from `uns/ec_incidence` with the same policy definitions.

## 10. Risks, pitfalls and open questions

- **Evidence read only through secondary sources.** The conclusions of You et al. [R1] and Brüning et al. [R6] were read through the single-cell best-practices chapter, not the papers. The speed, memory and dataset details of Booeshaghi and Pachter [R17] and Zakeri et al. [R18], and the simulation claims of the STARsolo and alevin-fry papers [R4, R12], were not read.
- **Benchmarks not specified for lack of a named dataset.** A human and mouse mixture scoring the cross-species UMI fraction after doublet removal, in the style of the mixture controls of Tian et al. [R22]; the three-dataset Vmn and Olfr comparison of Brüning et al. [R6]; and workflow-level cell-type label agreement [R1]. Absolute index sizes of human references for STAR, kallisto and alevin-fry are not stated.
- **Open technical points.** The format of the `--dump-eqclasses` output and the mapping of policy names to `--resolution` strings need checking against the pinned alevin-fry release. The EM has no effective-length or sequence-bias term, its effect on gene-level accuracy is unmeasured, and alevin-fry bootstrap intervals have no published coverage evaluation.
- **Literature unsettled.** Intronic reads in whole-cell counts, the best multi-gene policy and its interaction with intron augmentation, divergent UMI collisions in introns, and pre-mRNA length bias [R14, R15, R16].
- **Licence risks.** The Cell Ranger licence restricts use to internal use with 10x products and forbids redistribution, so including its results in published benchmarks needs a legal check; kallisto has no LICENSE file at its repository root; the 10x public datasets and simulations derived from them carry terms to be checked before release.
- **First experiment.** B1 on the spliced-only variant for alevin-fry `cr_like` and `cr_like_em`, kb-python with intersection, and STARsolo `discard` and `em`; confirm that the GPU EM reproduces the CPU EM, then test whether the EM beats fixed rules on paralog reads, which the identifiability argument of section 3.2 predicts.

## 11. References

R1. You Y, Tian L, Su S, Dong X, Jabbari JS, Hickey PF, Ritchie ME. Benchmarking UMI-based single-cell RNA-seq preprocessing workflows. *Genome Biology* 2021;22. doi:10.1186/s13059-021-02552-3 — verified (corpus)
R2. Vieth B, Parekh S, Ziegenhain C, Enard W, Hellmann I. A systematic evaluation of single cell RNA-seq analysis pipelines. *Nature Communications* 2019;10:4667. doi:10.1038/s41467-019-12266-7 — verified (search)
R3. Dobin A, Davis CA, Schlesinger F, Drenkow J, Zaleski C, Jha S, Batut P, Chaisson M, Gingeras TR. STAR: ultrafast universal RNA-seq aligner. *Bioinformatics* 2013;29(1):15-21. doi:10.1093/bioinformatics/bts635 — verified (corpus)
R4. Kaminow B, Yunusov D, Dobin A. STARsolo: accurate, fast and versatile mapping/quantification of single-cell and single-nucleus RNA-seq data. *bioRxiv* 2021. (preprint) doi:10.1101/2021.05.05.442755 — verified (corpus)
R5. Zheng GXY, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017;8:14049. doi:10.1038/ncomms14049 — verified (corpus)
R6. Schulze Brüning R, Tombor L, Schulz MH, Dimmeler S, John D. Comparative analysis of common alignment tools for single-cell RNA sequencing. *GigaScience* 2022;11. doi:10.1093/gigascience/giac001 — verified (corpus)
R7. Bray NL, Pimentel H, Melsted P, Pachter L. Near-optimal probabilistic RNA-seq quantification. *Nature Biotechnology* 2016. doi:10.1038/nbt.3519 — partial (corpus)
R8. Melsted P, Booeshaghi AS, Liu L, Gao F, Lu L, Min KH, da Veiga Beltrame E, Hjörleifsson KE, Gehring J, Pachter L. Modular, efficient and constant-memory single-cell RNA-seq preprocessing. *Nature Biotechnology* 2021;39(7):813-818. doi:10.1038/s41587-021-00870-2 — verified (corpus)
R9. Sullivan DK, et al. kallisto, bustools and kb-python for quantifying bulk, single-cell and single-nucleus RNA-seq. *Nature Protocols* 2024. doi:10.1038/s41596-024-01057-0 — partial (corpus)
R10. Patro R, Duggal G, Love MI, Irizarry RA, Kingsford C. Salmon provides fast and bias-aware quantification of transcript expression. *Nature Methods* 2017. doi:10.1038/nmeth.4197 — partial (corpus)
R11. Srivastava A, Malik L, Smith T, Sudbery I, Patro R. Alevin efficiently estimates accurate gene abundances from dscRNA-seq data. *Genome Biology* 2019;20. doi:10.1186/s13059-019-1670-y — verified (corpus)
R12. He D, Zakeri M, Sarkar H, Soneson C, Srivastava A, Patro R. Alevin-fry unlocks rapid, accurate and memory-frugal quantification of single-cell RNA-seq data. *Nature Methods* 2022;19(3):316-322. doi:10.1038/s41592-022-01408-3 — verified (corpus)
R13. Srivastava A, Malik L, Sarkar H, Zakeri M, Almodaresi F, Soneson C, Love MI, Kingsford C, Patro R. Alignment and mapping methodology influence transcript abundance estimation. *Genome Biology* 2020;21. — verified (corpus)
R14. 10x Genomics. Technical Note - Interpreting Intronic and Antisense Reads in 10x Genomics Single Cell Gene Expression Data. 2021. https://www.10xgenomics.com/support/single-cell-gene-expression/documentation/steps/sequencing/interpreting-intronic-and-antisense-reads-in-10-x-genomics-single-cell-gene-expression-data — verified (corpus)
R15. Pool AH, Poldsam H, Chen S, Thomson M, Oka Y. Enhanced recovery of single-cell RNA-sequencing reads for missing gene expression data. *bioRxiv* 2022. (preprint) doi:10.1101/2022.04.26.489449 — verified (corpus)
R16. Gorin G, Pachter L. Length biases in single-cell RNA sequencing of pre-mRNA. *bioRxiv* 2021. (preprint) doi:10.1101/2021.07.30.454514 — verified (corpus)
R17. Booeshaghi AS, Pachter L. Benchmarking of lightweight-mapping based single-cell RNA-seq pre-processing. *bioRxiv* 2021. (preprint) doi:10.1101/2021.01.25.428188 — verified (search)
R18. Zakeri M, Srivastava A, Sarkar H, Patro R. A like-for-like comparison of lightweight-mapping pipelines for single-cell RNA-seq data pre-processing. *bioRxiv* 2021. (preprint) doi:10.1101/2021.02.10.430656 — verified (search)
R19. Smith T, Heger A, Sudbery I. UMI-tools: modeling sequencing errors in Unique Molecular Identifiers to improve quantification accuracy. *Genome Research* 2017;27(3):491-499. doi:10.1101/gr.209601.116 — verified (corpus)
R20. Ntranos V, Kamath GM, Zhang JM, Pachter L, Tse DN. Fast and accurate single-cell RNA-seq analysis by clustering of transcript-compatibility counts. *Genome Biology* 2016;17. — verified (corpus)
R21. Parekh S, Ziegenhain C, Vieth B, Enard W, Hellmann I. zUMIs - A fast and flexible pipeline to process RNA sequencing data with UMIs. *GigaScience* 2018;7(6). doi:10.1093/gigascience/giy059 — verified (corpus)
R22. Tian L, Dong X, Freytag S, Lê Cao KA, Su S, JalalAbadi A, Amann-Zalcenstein D, Weber TS, Seidi A, Jabbari JS, Naik SH, Ritchie ME. Benchmarking single cell RNA-sequencing analysis pipelines using mixture control experiments. *Nature Methods* 2019. doi:10.1038/s41592-019-0425-8 — verified (corpus)
R23. Soneson C, Srivastava A, Patro R, Stadler MB. Preprocessing choices affect RNA velocity results for droplet scRNA-seq data. *PLoS Computational Biology* 2021;17(1):e1008585. — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/alexdobin/STAR | Alex Dobin (README author/support contact) | MIT License, Copyright (c) 2019 Alexander Dobin | Genome aligner under STARsolo; defaults in parametersDefault and docs/STARsolo.md | port (wrapped in the first release) |
| https://github.com/10XGenomics/cellranger | 10x Genomics | Custom 10x Genomics licence: internal use only, in connection with a 10x Genomics Product, no redistribution or sublicensing | Commercial comparator; source of imported matrices | callout |
| https://github.com/pachterlab/kb_python | Kyung Hoi (Joseph) Min (setup.py author) | BSD 2-Clause, Copyright (c) 2019 Pachter Lab | Workflow wrapper for kallisto and bustools; defaults in kb_python/count.py | port (wrapped in the first release) |
| https://github.com/BUStools/bustools | BUStools (copyright holder) | BSD 2-Clause, Copyright (c) 2018 BUStools | Barcode correction, UMI collapsing and matrix output after pseudoalignment | port (wrapped in the first release) |
| https://github.com/pachterlab/kallisto | Pachter Lab (repository owner) | No LICENSE file at the repository root; the scRNA-tools database lists BSD-2-Clause | Pseudoalignment (equation 1) | reimplement the intersection rule from the paper if needed |
| https://github.com/COMBINE-lab/salmon | COMBINE lab (copyright holder) | BSD 3-Clause, Copyright (c) 2026 COMBINE lab | Selective alignment and sketch mapping stage for alevin-fry | port (reached through alevin-fry) |
| https://github.com/COMBINE-lab/alevin-fry | Avi Srivastava, Hirak Sarkar, Dongze He, Noor Pratap Singh, Rob Patro (Cargo.toml) | BSD 3-Clause, Copyright (c) 2020- University of Maryland | RAD collation and resolution strategies; defaults in src/main.rs | port (wrapped in the first release); `singlet_em` is a new design |
| https://github.com/sdparekh/zUMIs | sdparekh (repository owner) | GNU GPL v3 | STAR-based pipeline from the literature | reimplement (none planned) |
| https://github.com/CGATOxford/UMI-tools | CGAT (copyright holder) | MIT License, Copyright (c) 2015 CGAT | Directional UMI rule (section 3.3) | port (owned by ingest-quant.umi_deduplication) |
