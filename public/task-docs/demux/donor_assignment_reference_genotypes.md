---
id: demux.donor_assignment_reference_genotypes
title: Reference-based genotype donor assignment with doublet calling and cluster-to-individual mapping
area: demux
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [ingest-quant.read_to_gene_mapping, ingest-quant.umi_deduplication, cell-calling.cell_vs_empty_droplet_calling, cell-calling.nucleus_vs_empty_calling]
feeds: [doublets.ensemble_doublet_calling, markers-de.replicate_aware_condition_de, demux.sample_swap_detection]
reads: [layers/alt_counts, layers/total_counts, varm/donor_genotype_probs, uns/donor_reference, obs/n_informative_snps]
writes: [obs/donor_id, obs/donor_status, obs/donor_prob_max, obs/donor_doublet_prob, obsm/donor_posterior, uns/donor_mapping, uns/demux_params, models/vireo_gt]
devices: [cpu, cuda]
mcp_tool: singlet_demux_donor_assignment_reference_genotypes
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Reference-based genotype donor assignment with doublet calling and cluster-to-individual mapping

> Given allele counts at informative SNPs and a reference genotype VCF for a pool, assigns each droplet to a donor, labels doublets and ambiguous droplets, and maps anonymous clusters to reference individuals.

## 1. Question

Given allele counts at informative SNPs for each droplet and a reference genotype VCF that covers the pool, which donor produced each droplet's RNA, which droplets carry RNA from two pool donors or cannot be assigned, and which reference individual does each anonymous cluster correspond to? A correct answer makes singlet calls that match the donor that produced the droplet, flags cross-donor doublets, and reports donors absent from the reference as unmatched. The literature scores this against planted or orthogonally labelled truth (section 8).

## 2. Why this task matters and where the field stands

Pooling donors in one library lowers the cost per donor. Every droplet then needs a donor label, and droplets that carry RNA from two donors must be found and removed. Genotype-based demultiplexing labels droplets from each donor's SNP profile and needs no hashing reagent [R1][R2]. The reference-based tools take different routes. demuxlet evaluates read-level likelihoods over donors and donor pairs [R1]. Vireo's genotype-prior mode is a variational Bayes model that uses reference genotypes as priors (vireoSNP code at e365463; [R2] covers the model family). souporcell clusters loci and can start its cluster centres at reference genotypes (code at 97fbf4d; [R3] covers the clustering).

Status: **contested**. Benchmarks disagree on ranking and on what drives accuracy. Kang et al. report that, in simulated pools of up to 64 donors with about 50 SNPs per cell, 97% of singlets are assigned and 92% of doublets are identified [R1]. Fu et al. report accuracy of roughly 80-85% for the three tools other than scSplit (Vireo highest) on simulated 2-, 4- and 6-donor snRNA-seq pools at 0 to 30% doublets, and report that the variant caller affects the tools differently [R6]. The Demuxafy study integrates several tools because their calls disagree, and proposes a consensus [R4].

Open problems: (1) the decision margins are fixed rather than calibrated, with a 2-nat margin in demuxlet and a 0.9 posterior cutoff in Vireo [R1][R2]; (2) demuxlet always names a reference donor, so donors absent from the reference are only partly flagged, and no cited benchmark scores this; (3) donors with identical genotypes and same-donor multiplets cannot be separated from genotype alone, and the DoubletFinder README reports that it identifies demuxlet false-negative calls caused by doublets formed from cells with identical SNP profiles (section 12); (4) ambient RNA carrying other donors' alleles inflates alternate counts, and only Vireo models it [R2].

## 3. Theory and insight

Droplet $d$ contributes reads $r$ at biallelic SNPs $s$. Each read shows the reference or the alternate base, and other bases are excluded. Donor $i$ has alternate-allele copy number $g_{is}\in\{0,1,2\}$, supplied by the reference as probabilities $P^{\mathrm{GT}}_{is}(g)$. Let $p$ be the alternate fraction of the droplet's RNA and $\epsilon_r$ the base-call error of read $r$, taken from its base quality.

**Read emission.** For reads showing the reference or the alternate base,
$$\Pr(a_r=\mathrm{ref}\mid p)=(1-\epsilon_r)(1-p)+\tfrac{\epsilon_r}{3}\,p,\qquad \Pr(a_r=\mathrm{alt}\mid p)=\tfrac{\epsilon_r}{3}(1-p)+(1-\epsilon_r)\,p.$$
These are the terms popscle evaluates (cmd_cram_demuxlet.cpp:666-667, 673). Together they sum to $1-\tfrac{2}{3}\epsilon_r$ for every $p$, so the factor is the same under every hypothesis and cancels in all log-likelihood differences. The form assumes reads are independent given $p$ and ignores UMI collapse, allele-specific expression and ambient RNA.

**Mixture.** A droplet with donor $i$ at weight $1-\alpha$ and donor $j$ at weight $\alpha$ has
$$p=(1-\alpha)\tfrac{g_i}{2}+\alpha\tfrac{g_j}{2},$$
so $\alpha=0$ is a singlet. Here $\alpha$ is the fraction of the droplet's RNA from donor $j$, not the fraction of cells, and it is defined per droplet.

**demuxlet decision.** For a hypothesis $h$ (one donor, or a pair with a grid value of $\alpha$), the droplet log-likelihood is $\ell_d(h)=\sum_s\sum_{r\in s}\log\Pr(a_r\mid p_s(h))$. The droplet is DBL if the best pair beats the best singleton by more than 2 nats, SNG if the best singleton beats the second-best singleton by more than 2 nats, and AMB otherwise (cmd_cram_demuxlet.cpp:926, 948, 969). The doublet prior does not enter this rule. It enters only the posterior BEST.POSTERIOR, through a prior weight of $\pi/(N(N-1)(|A|-1))$ that is doubled at $\alpha=0.5$ (lines 793-795). The 2-nat margin is hard-coded and is not calibrated to any error rate.

**Variational Vireo.** Vireo carries donor assignments $\pi_{ik}$, donor genotype posteriors $Q_{vkg}$ over genotype $g$ at variant $v$, and Beta parameters $s^1_{vg}, s^2_{vg}$ for each genotype-state allele fraction. With $AD_{iv}$ the alternate count, $BD_{iv}=DP_{iv}-AD_{iv}$ the reference count and $\psi$ the digamma function, the coordinate updates are
$$\log\tilde L_{ik}=\sum_{v,g}Q_{vkg}\bigl[AD_{iv}\psi(s^1_{vg})+BD_{iv}\psi(s^2_{vg})-DP_{iv}\psi(s^1_{vg}+s^2_{vg})\bigr],\qquad \pi_{ik}\propto\pi^{\mathrm{ID}}_k\tilde L_{ik},$$
$$s^1_{vg}=s^{1,\mathrm{prior}}_{vg}+\sum_{i,k}AD_{iv}\,\pi_{ik}Q_{vkg},\qquad \log Q_{vkg}=\log P^{\mathrm{GT}}_{vkg}+\sum_i\pi_{ik}\,B_{ivg}\ \ (\text{normalised over } g),$$
where $s^2$ is updated the same way with $BD$, and $B_{ivg}$ is the bracket of the first equation (vireo_model.py:165-219). The regime is a mean-field approximation with local optima, so restarts matter. The prior concentration of 50 (vireo_model.py:117-118) sets how far allele fractions shrink toward their priors.

**Hungarian mapping.** Anonymous donors are matched to reference individuals by $\hat\sigma=\arg\min_\sigma\sum_k C_{k\sigma(k)}$, solved with the Hungarian algorithm (vireo_base.py:187-202). For the genotype-mode call at vireo.py:221, $C_{kj}$ is the mean absolute difference between inferred and reference genotype probabilities over variants and the three genotype states. Rectangular costs leave surplus donors unmatched, and a donor is identifiable only if its genotypes differ from every other donor's.

**Estimands.** Each output is defined as follows.
- Singlet accuracy: correct singlet calls divided by all droplets whose RNA came from one donor. Unassigned, ambiguous and doublet calls count as errors, and coverage is reported separately.
- Doublet recall: droplets with status doublet divided by true cross-donor doublets. Same-donor doublets are excluded, and the pair need not be identified.
- Cluster mapping accuracy: clusters whose matched donor equals the true donor, divided by the number of clusters. A cluster whose true donor is absent from the reference counts only when it is flagged unmatched.
- donor_prob_max: the largest reference-donor posterior, normalised over reference donors and excluding doublet mass.

**Regime of validity.** The likelihood statements hold when reads are independent given the genotype mixture and the reference matches the donors at the expressed SNPs. UMI duplicates and allele-specific expression break independence. The margins and posteriors are then overconfident, and no cited benchmark measures by how much.

**Insight.** Accuracy depends on the informative SNPs per droplet and on how distinct the pooled genotypes are. Kang et al. report simulated accuracy at about 50 SNPs per cell [R1]. Vireo marks droplets with fewer than 10 informative variants as unassigned whatever their posterior (io_utils.py:108), so the ambiguous rate tracks panel size. A calibrated model therefore needs a coverage-accuracy curve for each panel, not a single number.

**Complexity (from code structure, not benchmarked).** demuxlet scores each droplet over donor pairs times the alpha grid, so cost grows with the square of the donor count (cmd_cram_demuxlet.cpp:655-772). Each Vireo iteration is a set of sparse-dense products over cells, variants and donors (vireo_model.py:165-219).

**Failure modes by family.** Model-based callers share these failure modes: ambiguous calls under low coverage; donors with identical genotypes; a pool donor missing from the reference or a reference donor missing from the pool, where demuxlet always reports its best reference donor and out-of-reference cells surface only as AMB; unbalanced doublets missed by the default alpha grid; same-donor multiplets, which are invisible to any genotype method; and ambient RNA carrying other donors' alleles.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| demuxlet (popscle) | model-based | Read-level mixture likelihood over donors and donor pairs with an alpha grid; SNG, DBL or AMB with a fixed 2-nat margin | [R1] |
| Vireo, genotype mode | model-based | Variational Bayes over cell-donor assignment and donor genotypes with reference priors; learns genotype-specific allele fractions; scores donor pairs | [R2]; code at e365463 |
| souporcell, known-genotype mode | model-based | Mixture clustering over loci with cluster centres initialised from reference genotypes; the cluster index maps to a reference sample | [R3]; known-genotype path at 97fbf4d |
| Hungarian mapping (Vireo optimal_match) | heuristic | One-to-one matching of anonymous donors to reference individuals by mean absolute genotype difference, solved with the Hungarian algorithm | code at e365463 |
| Demuxafy consensus | heuristic | Per-droplet rules over calls from several demultiplexing and doublet tools (MajoritySinglet, AtLeastHalfSinglet, AnySinglet, AnyDoublet) | [R4]; rules at 7369a42, scripts/Combine_Results.R |
| scSplit (genotype-free comparator) | model-based | Hidden-state model that splits pooled cells into genetically distinct groups without a reference | [R5] |

Model-based likelihood methods are the published standard for genotype-based demultiplexing. demuxlet and Vireo's genotype mode are the primary comparators, and souporcell's known-genotype mode is a second model-based comparator. The Demuxafy consensus is the heuristic standard and is kept as a comparator in B2. scSplit is used only as a genotype-free comparator in B3.

Defaults below are read from source at the stated commits.

| Method | Parameter | Value | Source |
|---|---|---|---|
| demuxlet | FORMAT field | GP | cmd_cram_demuxlet.cpp:9 @ da70fc7 |
| demuxlet | geno-error-offset | 0.10 | cmd_cram_demuxlet.cpp:10 @ da70fc7 |
| demuxlet | geno-error-coeff | 0.00 | cmd_cram_demuxlet.cpp:11 @ da70fc7 |
| demuxlet | exclude_flag | 0x0f04 | cmd_cram_demuxlet.cpp:20 @ da70fc7 |
| demuxlet | min-MQ | 20 | cmd_cram_demuxlet.cpp:21 @ da70fc7 |
| demuxlet | min-mac | 1 | cmd_cram_demuxlet.cpp:27 @ da70fc7 |
| demuxlet | min-callrate | 0.5 | cmd_cram_demuxlet.cpp:28 @ da70fc7 |
| demuxlet | max alleles | 2 | cmd_cram_demuxlet.cpp:29 @ da70fc7 |
| demuxlet | doublet-prior (BEST.POSTERIOR only) | 0.5 | cmd_cram_demuxlet.cpp:32, 793-795 @ da70fc7 |
| demuxlet | min-total | 0 | cmd_cram_demuxlet.cpp:34 @ da70fc7 |
| demuxlet | alpha grid | {0, 0.5} when not given; help text lists 0.1-0.5 | cmd_cram_demuxlet.cpp:85-88 @ da70fc7 (help at :62) |
| demuxlet | DBL and SNG margin | 2 nats, hard-coded | cmd_cram_demuxlet.cpp:926, 948 @ da70fc7 |
| Vireo | genoTag | PL | vireoSNP/vireo.py:53-54 @ e365463 |
| Vireo | noDoublet | off, so check_doublet is true | vireoSNP/vireo.py:57, 207 @ e365463 |
| Vireo | nInit (CLI) | 50; 1 when genotypes are not learned | vireoSNP/vireo.py:59, 205 @ e365463 |
| Vireo | n_init (vireo_wrap) | 20 | vireoSNP/utils/vireo_wrap.py:22 @ e365463 |
| Vireo | extraDonor | 0; sqrt(n_donor) when None | vireoSNP/vireo.py:62, 197-202 @ e365463 |
| Vireo | forceLearnGT | off | vireoSNP/vireo.py:69, 193 @ e365463 |
| Vireo | unassigned if max posterior below | 0.9 | vireoSNP/utils/io_utils.py:106 @ e365463 |
| Vireo | doublet if probability at least | 0.9 | vireoSNP/utils/io_utils.py:107 @ e365463 |
| Vireo | unassigned if informative variants below | 10 | vireoSNP/utils/io_utils.py:108 @ e365463 |
| Vireo | beta_sum prior | 50.0 | vireoSNP/utils/vireo_model.py:117-118 @ e365463 |
| Vireo | fit max_iter | 200 | vireoSNP/utils/vireo_model.py:278 @ e365463 |
| Vireo | match uniq_ref_only | True | vireoSNP/utils/vireo_base.py:130 @ e365463 |
| souporcell | max_loci | 2048 | souporcell.py:14 @ 97fbf4d |
| souporcell | min_alt and min_ref (Python) | 10 and 10 | souporcell.py:15-16 @ 97fbf4d |
| souporcell | min_alt and min_ref (Rust) | 4 and 4 | souporcell/src/main.rs:764, 766 @ 97fbf4d |
| souporcell | restarts (Python) | 15; forced to 1 with known genotypes | souporcell.py:19, 140-143 @ 97fbf4d |
| souporcell | restarts (Rust) | 100 | souporcell/src/main.rs:768 @ 97fbf4d |
| souporcell | known_genotypes | None; uncompressed VCF only | souporcell.py:20; README.md:88 @ 97fbf4d |

## 5. Proposed singlet approach

Routes. demuxlet, Vireo's genotype mode, the Hungarian step and souporcell's known-genotype mode are ported, as section 12 records. Demuxafy and scSplit are benchmark callouts only.

Proposed model. The section 3 read emission and mixture remain the single likelihood. Four changes are proposed, each falsified on section 8.
1. Calibrated posteriors replace the 2-nat margin and the 0.9 cutoffs. The prior over singlet, doublet and open-set states is fitted on simulated pools with known donors. The change is kept only if B1 singlet accuracy at matched coverage does not fall and the held-out reliability curve improves on the fixed rules.
2. An open-set state for donors absent from the reference, with genotypes marginalised over reference allele frequencies. A droplet is unmatched when this state wins. The change is kept only if B4 unmatched-flag precision and recall both exceed the best comparator.
3. An ambient term, in which a fraction of each droplet's alternate reads comes from the pool's donor-frequency mixture. Kept only if B3 accuracy at 0% doublets does not fall.
4. A continuous doublet fraction, with a prior on a fine alpha grid in place of {0, 0.5}. Kept only if B1 doublet recall does not fall.

ML stack. The core is a fixed set of sparse-dense products and per-droplet pair enumerations, so it is hard-coded: C++ on CPU, and CUDA with cuSPARSE for products with the donor-genotype tensor, plus batched donor-pair kernels. PyTorch fits the calibration or error model only if that model is nonlinear, since a fixed-size linear or GLM computation does not need it.

Streaming. Cells are processed in blocks. The per-cell donor update needs only genotype posteriors and allele-fraction parameters, and the other updates are sums over cells, so block accumulation is exact within an iteration.

Defaults an agent should use without asking: method vireo_gt; genotype_tag PL; n_init 20; check_doublet on; prob_max_unassigned 0.9; doublet_prob_threshold 0.9; min_informative_variants 10. These match the published code so that comparators stay reproducible. The calibrated replacements stay off until B1 passes, and the demuxlet grid stays {0, 0.5} for the comparator.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/alt_counts | sparse int32, cells x SNPs | alternate-allele read counts per droplet and informative SNP |
| read | layers/total_counts | sparse int32, cells x SNPs | total informative reads per droplet and SNP |
| read | varm/donor_genotype_probs | float32, SNPs x donors x 3 | reference genotype probabilities from the donor VCF |
| read | uns/donor_reference | dict | reference sample IDs, genome build and VCF checksum |
| read | obs/n_informative_snps | int32, optional | informative SNPs per droplet, for the minimum-variant rule |
| write | obs/donor_id | string | donor label, or unassigned |
| write | obs/donor_status | categorical | singlet, doublet, ambiguous or unassigned |
| write | obs/donor_prob_max | float32 | largest donor posterior, normalised over donors |
| write | obs/donor_doublet_prob | float32 | Vireo: doublet probability; demuxlet: summed pair posterior |
| write | obsm/donor_posterior | float32, cells x donors | normalised posterior over reference donors |
| write | uns/donor_mapping | dict | anonymous donor to reference donor, match cost, unmatched flag |
| write | uns/demux_params | dict | method, parameters and code version |
| write | models/vireo_gt | model state | fitted allele-fraction parameters and genotype posteriors |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `donor_vcf` | string | — | — | Reference genotype VCF covering every pool donor; required by demuxlet and souporcell_known. |
| `method` | string | "vireo_gt" | `vireo_gt`, `demuxlet`, `souporcell_known` | Algorithm: vireo_gt (default, model-based), demuxlet, or souporcell_known (known-genotype clustering). |
| `vireo_gt` | object | — | — | Options for method vireo_gt. |
| `vireo_gt.genotype_tag` | string | "PL" | `PL`, `GP`, `GT` | VCF FORMAT tag used for donor genotype probabilities. |
| `vireo_gt.n_donor` | integer | — | min 1 | Pool donor count; above the VCF sample count, genotypes are learned for the extra donors. |
| `vireo_gt.n_init` | integer | 20 | min 1 | Random restarts used when genotypes are learned (the CLI default is 50). |
| `vireo_gt.check_doublet` | boolean | true | — | Score donor pairs as doublets. |
| `vireo_gt.prob_max_unassigned` | number | 0.9 | min 0; max 1 | Droplets whose largest donor posterior is below this value are unassigned. |
| `vireo_gt.doublet_prob_threshold` | number | 0.9 | min 0; max 1 | Droplets with doublet probability at or above this value are doublets. |
| `vireo_gt.min_informative_variants` | integer | 10 | min 0 | Droplets covering fewer informative variants are unassigned. |
| `vireo_gt.beta_sum_prior` | number | 50.0 | > 0 | Concentration prior on genotype-specific allele fractions. |
| `demuxlet` | object | — | — | Options for method demuxlet (read-level likelihood over an alpha grid). |
| `demuxlet.field` | string | "GP" | `GP`, `GT`, `PL` | VCF FORMAT field read for genotype probabilities; GP is the popscle default. |
| `demuxlet.alpha_grid` | array | [0, 0.5] | — | Second-donor RNA fractions searched for doublets; include 0 for singlets. |
| `demuxlet.doublet_prior` | number | 0.5 | min 0; max 1 | Prior doublet rate; changes BEST.POSTERIOR only, not the droplet type. |
| `demuxlet.margin_nats` | number | 2.0 | min 0 | Log-likelihood margin for singlet, doublet and ambiguous calls; demuxlet uses 2. |
| `demuxlet.min_mapq` | integer | 20 | min 0 | Minimum mapping quality of reads used. |
| `demuxlet.geno_error_offset` | number | 0.1 | min 0 | Genotype error offset applied when loading reference genotypes; 0.10 is the popscle default. |
| `souporcell_known` | object | — | — | Options for souporcell_known; the input VCF must be uncompressed. |
| `souporcell_known.max_loci` | integer | 2048 | min 1 | Maximum loci per cell used for clustering. |
| `souporcell_known.min_alt` | integer | 10 | min 1 | Minimum cells expressing the alternate allele for a locus to be used. |
| `souporcell_known.min_ref` | integer | 10 | min 1 | Minimum cells expressing the reference allele for a locus to be used. |
| `seed` | integer | 0 | — | Random seed for restarts and random initialisation. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules that span parameters. The method argument selects the algorithm, and only its nested object is read. donor_vcf must cover every pool donor. When vireo_gt.n_donor exceeds the number of VCF samples, genotypes are learned for the extra donors (vireo.py:178-187), and Vireo exits when fewer than 10% of VCF records carry the genotype tag (vireo.py:160-165). demuxlet.alpha_grid must include 0 for singlets. souporcell_known needs an uncompressed VCF. The tag or field must match the VCF.

## 7. MCP tool

Tool name `singlet_demux_donor_assignment_reference_genotypes` (definition in `tasks/mcp/singlet_demux_donor_assignment_reference_genotypes.json`).

Example call:

```json
{"dataset": "pool01.singlet", "donor_vcf": "donors.gt.vcf", "method": "vireo_gt", "vireo_gt": {"genotype_tag": "PL", "n_init": 20}, "seed": 0}
```

Example compact result:

```json
{"dataset": "pool01.singlet", "status": "completed", "wrote": ["obs/donor_id", "obs/donor_status", "obs/donor_prob_max", "obs/donor_doublet_prob", "obsm/donor_posterior", "uns/donor_mapping", "uns/demux_params", "models/vireo_gt"], "summary": {"status_counts": {"singlet": "<n>", "doublet": "<n>", "ambiguous": "<n>", "unassigned": "<n>"}, "n_donors": "<k>", "unmatched_clusters": "<n>", "method_version": "<version>"}, "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: pools above the inline limit return queued with a job_id, and run time grows with n_init. Stochastic: restarts and initialisation depend on seed, so a fixed seed reproduces a result on the same build. Dry run: returns seconds, peak memory and device estimated from droplet, SNP and donor counts; no timing is claimed in this document.

## 8. Benchmarks

Shared protocol. Every benchmark scores donor calls against a per-droplet truth label, using the estimands in section 3. Singlet accuracy and doublet recall keep their definitions in every benchmark. Methods run with the section 4 defaults unless a benchmark says otherwise. Stochastic methods run with a fixed set of at least five seeds, and the spread is reported. Results are stratified by doublet rate and by informative SNPs per droplet wherever the design varies them. Comparators are the published tools at the commits in section 12.

### B1. Simulated and real-pool singlet and doublet calling (Kang et al. 2018)

- **Goal**: Measure singlet accuracy and doublet recall of demuxlet on simulated pools, and singlet correctness on an eight-donor real pool.
- **Ground truth**: Planted simulation, so each simulated droplet's donors are exact. Real pool: donor labels from the study design (section 10). Singlet accuracy is normalised per true singlet droplet; doublet recall per true cross-donor doublet.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated pools, up to 64 donors, about 50 SNPs per cell | [R1] | human scRNA-seq, simulated | — | donor count 2 to 64 |
| Eight-donor PBMC pool from the demuxlet paper data (popscle README, line 46) | [R1] | human PBMC droplets, eight donors | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| singlet_accuracy | Correct singlet calls divided by true single-donor droplets; coverage reported separately | maximize | primary | [R1] |
| doublet_recall | Doublet calls divided by true cross-donor doublets; same-donor doublets excluded | maximize | primary | [R1] |
| singlet_correct_rate_real | Called singlets whose donor equals the pool label | maximize | guardrail | [R1] |

- **Comparators**: demuxlet (da70fc7), Vireo genotype mode (e365463) and souporcell known-genotype mode (97fbf4d), under the same protocol.
- **Protocol**: Build simulated pools from reference genotypes at about 50 informative SNPs per cell, sweeping donor count to 64. Create pileups with popscle dsc-pileup and set the field to GT (the code default is GP, cmd_cram_demuxlet.cpp:9). The real pool uses its eight donors and the same settings.
- **Acceptance criterion**: Literature-derived. Simulation: singlet accuracy at least 0.97 and doublet recall at least 0.92. Real pool: singlet correctness at least 0.99. These are the [R1] abstract figures.
- **Known pitfalls**: Compare figures only under one estimand, because the [R1] abstract figures may count assignment rather than correct assignment. Simulated doublets lack doublet-specific transcription, so their recall is an upper bound for real doublets.

### B2. Demuxafy pools and synthetic pools (Neavin et al. 2024)

- **Goal**: Compare donor assignment of the reference-based tools and the Demuxafy consensus on real and synthetic pools.
- **Ground truth**: Synthetic pools only. Droplets that every tool called singlet are relabelled with their source donor and mixed in silico, so truth is exact but circular for agreement. Real pools have no independent per-droplet truth. Accuracy is normalised per droplet; donors not identified per pool.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| PBMC pools | [R4] | human PBMC droplets | — | real pools |
| Fibroblast pools | [R4] | human fibroblast droplets | — | real pools |
| Synthetic pools | [R4], built from the real pools | human PBMC droplets | — | source donor is the truth |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| singlet_donor_accuracy | Droplets called singlet with the source donor divided by all droplets; unassigned, ambiguous and doublet calls are errors | maximize | primary | [R4] |
| donors_not_identified | Pool donors with no droplet called to them; the published captions use their own definition | minimize | primary | [R4] |
| consensus_gain | Consensus accuracy minus the best single tool on the same pool | maximize | guardrail | [R4] |

- **Comparators**: demuxlet, Vireo genotype mode and souporcell known-genotype mode; the Demuxafy consensus (heuristic) is the standard.
- **Protocol**: Run every tool with its section 4 defaults on each real pool. Build synthetic pools from droplets that all tools called singlet, and score all comparators identically within each pool-size stratum.
- **Acceptance criterion**: Proposed, not from the literature. Singlet donor accuracy at least 0.95 on the eight-donor synthetic pools, excluding droplets the consensus flags as doublets.
- **Known pitfalls**: Circular truth inflates agreement for the droplets that every tool called singlet. A consensus can match the best tool only on this truth, so beating it needs the independent truth of B3 or B4.

### B3. Simulated snRNA-seq pools with transcriptome-derived variants (Fu et al. 2025)

- **Goal**: Measure how the accuracy of reference-based and genotype-free tools depends on pool size, doublet rate and variant caller on single-nucleus data.
- **Ground truth**: Planted simulation, in which each simulated droplet carries known donor labels. Sex-linked genes are a secondary check. Accuracy is normalised per droplet, and recall and precision per donor.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated pools of 2, 4 and 6 donors at 0 to 30% doublets | [R6] | human snRNA-seq | — | donor genotypes from SNP arrays of donor DNA |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| assignment_accuracy | Correct droplet calls divided by droplets, stratified by doublet rate | maximize | primary | [R6] |
| donor_recall_precision | Per-donor recall and precision of assignments | maximize | guardrail | [R6] |

- **Comparators**: Vireo, souporcell, freemuxlet (popscle, section 12) and scSplit [R5], each in the mode its authors used for this benchmark (section 10).
- **Protocol**: Simulate pools at doublet rates from 0 to 30%. Call variants from the transcriptome with BCFtools, FreeBayes or cellSNP, and run each tool with each caller. Report every tool-caller combination.
- **Acceptance criterion**: Literature-derived. Vireo accuracy at least 0.80, the lower end of the 80-85% range reported for the tools other than scSplit [R6]. scSplit is excluded from acceptance because it is the outlier in the reported comparison.
- **Known pitfalls**: The variant caller changes results, so tool and caller effects are confounded unless each combination is shown. Stratify accuracy by doublet rate, because a pooled figure can hide any doublet-rate dependence.

### B4. Cluster-to-individual mapping with a withheld donor (proposed)

- **Goal**: Test whether anonymous clusters map to the correct reference individual, and whether a donor absent from the reference is flagged unmatched.
- **Ground truth**: Planted simulation from the generator below. A droplet's truth is its simulated donor; a cluster's truth is the donor contributing most of its droplets. Accuracy is normalised per cluster.
- **Generator recipe**
  1. Draw 20 sets of eight donors from the donor VCF of [R1] (the demuxlet paper data), keeping sets whose pairwise discordance at informative sites is at least 0.1.
  2. Keep biallelic SNPs genotyped for every donor in the set.
  3. Simulate singlet droplets, each with one donor and n informative SNPs, n in {10, 25, 50}, bracketing the Vireo minimum of 10 and the 50 SNPs of [R1].
  4. At each SNP, sample a read from the section 3 emission with p = g/2 and base-call error 0.01.
  5. Withhold one donor from the reference in half of the sets.
  6. Cluster without reference genotypes with K equal to the pool donor count, then match with the Hungarian step.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated singlet pools from eight-donor sets | [R1] VCF; generator above | simulated human droplets | — | reads simulated from the section 3 model |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| cluster_mapping_accuracy | Clusters whose matched donor equals the true donor, divided by clusters; a cluster whose donor is absent counts only if unmatched | maximize | primary | [R2] |
| unmatched_flag_precision_recall | Precision and recall of the unmatched flag for withheld donors | maximize | guardrail | [R2] |

- **Comparators**: Hungarian matching (Vireo optimal_match, [R2]) and souporcell known-genotype mode, which maps clusters implicitly.
- **Protocol**: Fix the matching cost to the section 3 definition and reuse the same seeds across methods.
- **Acceptance criterion**: Proposed, not from the literature. Correct cluster mapping at least 0.95 in eight-donor pools with pairwise discordance at least 0.1 and at least 25 informative SNPs per droplet.
- **Known pitfalls**: Reads come from the section 3 model, so this tests matching and flagging under that model, not robustness (B2 and B3 do). Sex-linked genes split donors only into sex classes and cannot identify donors alone.

### P1. Performance and scaling

Wall time, peak memory and throughput from the count layers to donor assignment, on CPU and CUDA, at 10k, 100k, 1M and 10M droplets (10M because streaming is claimed), with 8, 32, 64 and 128 donors. Comparators are demuxlet, Vireo genotype mode and souporcell known-genotype mode. Hold fixed the SNP panel, the VCF, the seed, n_init at 20 and the thread count. The demuxlet donor-pair loop is expected to dominate at large donor counts (section 3). No timings are claimed here.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.read_to_gene_mapping`: Read-to-gene mapping engine: genome alignment versus pseudoalignment
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `cell-calling.nucleus_vs_empty_calling`: Nucleus versus empty-droplet calling in single-nucleus RNA-seq
- **Feeds**:
  - `doublets.ensemble_doublet_calling`: Ensemble and consensus doublet calling
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
  - `demux.sample_swap_detection`: Sample identity verification and swap detection
- **Reads**: `layers/alt_counts`, `layers/total_counts`, `varm/donor_genotype_probs`, `uns/donor_reference`, `obs/n_informative_snps`
- **Writes**: `obs/donor_id`, `obs/donor_status`, `obs/donor_prob_max`, `obs/donor_doublet_prob`, `obsm/donor_posterior`, `uns/donor_mapping`, `uns/demux_params`, `models/vireo_gt`
<!-- CHAINING:AUTO:END -->

Used in the genotype-based donor demultiplexing recipe, after cell calling and pileup, and before doublet and sample-identity checks.

## 10. Risks, pitfalls and open questions

- **Evidence limits.** The full texts of [R1] to [R4] and [R6] were not read. The [R6] abstract was retrieved; it gives the 80-85% range for the tools other than scSplit, Vireo as the most accurate tool, and the variant-caller dependence, but not its doublet-rate or per-caller figures. The Kang abstract figures in B1, the Kang pool accession, the donor VCF size and the sizes of the [R4] pools are not confirmed in the sources used. Only the first author of [R6] (Yile Fu) is confirmed; the title and DOI of [R9] come from the souporcell README alone. The truth provenance of the Kang real pool (how donor labels were set) and the Kang generator recipe are not stated in the sources used. The Demuxafy combination rules are the named methods in scripts/Combine_Results.R at 7369a42, and the per-tool metrics of [R4] are unknown. The popscle repository lists no author or maintainer and no version tag.
- **Folded out of the benchmark set.** The Vireo 2019 synthetic mixtures [R2], the souporcell 2020 HipSci mixtures [R3] and the souporcell3 high-donor study [R9] lack dataset sizes, truth definitions or thresholds in the sources used, so their results are not reproduced. The cell-hashing data GSE108313 [R8] would give cross-donor doublet truth, but genotype overlap of its cells is unverified, so verifying it is the first step.
- **Conflicting sources.** demuxlet's alpha default is {0, 0.5} in code (cmd_cram_demuxlet.cpp:85-88) but 0.1-0.5 in its help text (line 62) and README. Vireo's n_init is 50 in the CLI and 20 in vireo_wrap. The souporcell README marks sample-name selection as NOT YET IMPLEMENTED (README.md:280), yet the Python wrapper defaults to all VCF samples (souporcell.py:82-83) and the Rust binary requires names (souporcell/src/main.rs:527-537).
- **Unsettled science.** No cited benchmark reports calibration of the 2-nat margin or the 0.9 cutoffs. Open-set donors, genotype-identical donors, same-donor multiplets and ambient RNA carrying foreign alleles are not measured. Fu et al. report caller dependence [R6] without a per-caller effect size, and the mode (reference-based or genotype-free) in which each tool was run is not stated in the sources used.
- **Technical and data risks.** souporcell's known-genotype path fills only loci present in the VCF with reference genotypes, and other loci keep random starting values (souporcell.py:86-108). Its Python wrapper uses TensorFlow 1-style placeholders (souporcell.py:146-148). The demuxlet 2-nat margin is hard-coded and is not a command-line option. Licence and terms are unstated for the Kang pool data, GSE108313 and the pool data of [R4] and [R6].
- **First experiment and boundaries.** Reproduce the eight-donor pool of B1 with popscle at da70fc7, field GT and the same VCF, and compare singlet correctness with the abstract value. Then withhold one donor and measure the AMB fraction, as in B4. Genotype-free modes belong to demux.donor_deconvolution_reference_free, hashing truth to demux.hashtag_sample_assignment, and identity checks to demux.sample_swap_detection.

## 11. References

R1. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018;36(1):89-94. doi:10.1038/nbt.4042 — verified (corpus)
R2. Huang Y, McCarthy DJ, Stegle O. Vireo: Bayesian demultiplexing of pooled single-cell RNA-seq data without genotype reference. *Genome Biology* 2019;20:273. doi:10.1186/s13059-019-1865-2 — verified (corpus)
R3. Heaton H, et al. Souporcell: robust clustering of single-cell RNA-seq data by genotype without reference genotypes. *Nature Methods* 2020. doi:10.1038/s41592-020-0820-1 — partial (corpus)
R4. Neavin D, et al. Demuxafy: improvement in droplet assignment by integrating multiple single-cell demultiplexing and doublet detection methods. *Genome Biology* 2024. doi:10.1186/s13059-024-03224-8 — partial (corpus)
R5. Xu J, et al. Genotype-free demultiplexing of pooled single-cell RNA-seq. *Genome Biology* 2019. doi:10.1186/s13059-019-1852-7 — partial (corpus)
R6. Fu Y, et al. Benchmarking of computational demultiplexing methods for single-nucleus RNA sequencing data. *Briefings in Bioinformatics* 2025. doi:10.1093/bib/bbaf371 — partial (search)
R7. McGinnis CS, Murrow LM, Gartner ZJ. DoubletFinder: doublet detection in single-cell RNA sequencing data using artificial nearest neighbors. *Cell Systems* 2019. doi:10.1016/j.cels.2019.03.003 — verified (corpus)
R8. Stoeckius M, et al. Cell Hashing with barcoded antibodies enables multiplexing and doublet detection for single cell genomics. *Genome Biology* 2018. doi:10.1186/s13059-018-1603-1 — partial (corpus)
R9. Souporcell3: Robust Demultiplexing for High-Donor Single-Cell RNA-seq Datasets. *Bioinformatics*. doi:10.1093/bioinformatics/btag117 — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/statgen/popscle (da70fc7) | — (no author list in the README) | Apache-2.0 (LICENSE) | demuxlet likelihood and dsc-pileup input; freemuxlet comparator | port |
| https://github.com/single-cell-genetics/vireo (e365463) | Yuanhua Huang (setup.py author) | Apache-2.0 (LICENSE and setup.py) | Vireo genotype mode and optimal_match | port |
| https://github.com/wheaton5/souporcell (97fbf4d) | Haynes Heaton (LICENSE copyright line) | MIT (LICENSE) | known-genotype initialisation and clustering | port |
| https://github.com/drneavin/Demultiplexing_Doublet_Detecting_Docs (7369a42) | drneavin (LICENSE copyright line); Neavin D et al. [R4] | MIT (LICENSE) | Demuxafy consensus comparator | callout |
| https://github.com/jon-xu/sc_split (5e4045c) | jon-xu (LICENSE copyright line); Xu J et al. [R5] | MIT (LICENSE) | genotype-free comparator | callout |
| https://github.com/chris-mcginnis-ucsf/DoubletFinder (1b244d8) | Chris McGinnis (DESCRIPTION) | CC0 (DESCRIPTION; no LICENSE file at the root) | README section 'Application to Cell Hashing and Demuxlet data' (paper: [R7]) | callout |
