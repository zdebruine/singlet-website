---
id: grn.prior_network_curation
title: Curated TF-target prior network (regulon resource) construction
area: grn
scope: core
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [harmonization.gene_identifier_mapping, cross-species.ortholog_assignment]
feeds: [grn.tf_activity_scoring, grn.differential_grn_rewiring, grn.upstream_regulator_inference]
reads: []
writes: [uns/regulon_<method>_<species>]
devices: [cpu]
mcp_tool: singlet_grn_prior_network_curation
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Curated TF-target prior network (regulon resource) construction

> Build a signed, confidence-annotated table of transcription factor (TF) to target-gene edges from curated sources, so that TF activity scoring and regulator analysis share one reproducible prior.

## 1. Question

Which TF-to-target edges, with what sign and what confidence, belong in a reusable regulon resource for a given species? The input is curated interaction tables; the output is one edge table with a sign (+1 or -1), a tier or raw evidence count, and the source list. A correct resource ranks perturbed TFs first when its edges drive TF activity estimates in perturbation experiments [R1][R3].

## 2. Why this task matters and where the field stands

TF activity is estimated from target-gene expression because TF transcript levels are a weak proxy for protein activity, and every estimate depends on its prior network [R7]. The task is **contested**. The single-cell best-practices chapter recommends estimating TF activities from a prior-knowledge network such as CollecTRI over inferring networks from expression alone, and reports that CollecTRI covers 1,186 TFs [R7]. Holland et al. found that bulk-derived tools using curated footprint gene sets can be applied to scRNA-seq, and that performance depends more on the gene sets than on the statistic [R3]. Open problems:

- **No accepted ground truth for context.** The reliability of an edge in a given tissue or cell type has no accepted label; the benchmarks measure TF ranking, not edge correctness [R1][R3].
- **Indirect targets.** Perturbation responses mix direct and secondary effects, so a benchmark gain may reflect downstream genes rather than curated edges [R3].
- **Shared evidence.** Curated sources draw on overlapping papers and databases, so agreement between them is not independent evidence [R2][R5].

## 3. Theory and insight

A regulon resource is a signed, directed bipartite graph from TFs $t$ to target genes $g$. Curation decides three things per edge: whether it exists, its sign $m_{tg}\in\{-1,+1\}$ (activation or repression), and its confidence, either a tier $\ell_{tg}$ or a count of supporting sources. Scoring uses the signed weight matrix $w_{tg}$, which is zero for non-targets.

DoRothEA weights are a deterministic transform of the curated labels:

$$w_{tg}=\frac{m_{tg}}{c(\ell_{tg})},\qquad c(A)=1,\; c(B)=2,\; c(C)=3,\; c(D)=4.$$

The wrapper keeps the most confident level of each TF-target pair, and an edge with neither a stimulation nor an inhibition flag takes $m_{tg}=+1$ [R1][R4]. That last rule is an assumption about the source, not curated evidence. CollecTRI has no tier: its weight is the supplied signed mode of regulation, and its evidence is the list of supporting resources and PMIDs [R2][R4].

Activity uses the univariate linear model (ULM) of decoupler. It regresses one cell's expression $y_{c,g}$ on the regulon weights across genes and takes the t-value of the slope:

$$y_{c,g}=a_c+b_c\,w_{tg}+\varepsilon_{c,g},\qquad \hat s_{t,c}=\frac{\hat b_c}{\mathrm{SE}(\hat b_c)}.$$

Regime: first order and linear, one cell at a time. The t-value assumes independent genes, which co-expression violates [R4]. The estimand of $\hat s_{t,c}$ is a dimensionless association between the listed targets of TF $t$ and the expression profile of cell $c$.

Estimands. The weight $w_{tg}$ is a signed prior weight scaled by tier, not a probability; the tier is ordinal and carries no precision. The CollecTRI "confidence" is the raw number of supporting resources. The proposed calibrated output below is $\Pr(e_{tg}=1\mid x_{tg})$, the probability that $t$ directly regulates $g$ given evidence $x_{tg}$.

The perturbation AUROC of B1 is a pooled Mann-Whitney probability:

$$\mathrm{AUROC}=\frac{1}{|P|\,|N|}\sum_{p\in P}\sum_{n\in N}\Big(\mathbf 1[\hat s_p>\hat s_n]+\tfrac12\mathbf 1[\hat s_p=\hat s_n]\Big),\qquad \hat s_{e,t}=s_e\,\Delta_{e,t},$$

where $P$ holds the (experiment, perturbed TF) pairs, $N$ the other pairs, $s_e\in\{-1,+1\}$ the expected sign ($-1$ for knockdown or knockout, $+1$ for overexpression), and $\Delta_{e,t}$ the perturbed-minus-control change of TF $t$'s activity in experiment $e$. Pooling compares changes across experiments, so the statistic is valid only when $\Delta$ has comparable scale in every experiment; the benchmark code does not check this.

Proposed model. A calibrated logit over evidence features,

$$\Pr(e_{tg}=1\mid x_{tg})=\sigma\!\big(\beta_0+\boldsymbol\beta^{\top}x_{tg}\big),$$

with $x_{tg}$ the number of curated sources, ChIP-seq support, motif support, literature count and perturbation agreement, is calibrated only if the features are conditionally independent given the edge. Shared papers violate this and inflate the probability. The fit therefore uses perturbation labels that are not among the features' sources.

Assumptions and failure modes. Edges are assumed context-free, signs context-independent, and targets monotone in TF activity. Failure modes are literature bias toward well-studied TFs, circular benchmarks in which a curated source and its benchmark share papers or ChIP-seq, sign loss, indirect targets recorded as direct edges, complexes counted as several TFs, and orthology translation that drops or duplicates edges [R2][R5].

Insight. Heuristic curation is strong because each sign and target set traces to explicit experiments, and it is the standard a model must beat. What it lacks is calibration: tiers cannot be read as precision. A fitted model adds per-edge probabilities, a context covariate and reuse across resources, at the cost of training labels that are themselves perturbation-derived.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| DoRothEA tiers | heuristic | Curated signed TF-target sets graded A to D, weighted by mode of regulation divided by tier | [R1][R4] |
| CollecTRI | heuristic | Signed TF-target sets expanded from DoRothEA, with supporting resources and PMIDs per edge | [R2][R7] |
| OmniPath TF-target | heuristic | Access layer serving signed TF-target datasets with per-edge sources, filterable by resource | [R5] |

The DoRothEA and CollecTRI line is the published standard for TF activity priors [R1][R2], and the best-practices chapter names CollecTRI as the default [R7]. Only these three sources are listed, because their primary papers or code were read. The defaults below come from that code at the commits shown.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| DoRothEA | levels | A, B, C | src/decoupler/op/_dorothea.py:55 @ 3132edc |
| DoRothEA | weights per level | A 1, B 2, C 3, D 4 | src/decoupler/op/_dorothea.py:66 @ 3132edc |
| DoRothEA | data access class | academic | src/decoupler/op/_dorothea.py:15 @ 3132edc |
| DoRothEA | sign with neither stimulation nor inhibition flag | +1 | src/decoupler/op/_dorothea.py:105-106 @ 3132edc |
| DoRothEA (OmniPathR client) | levels | A, B | R/interactions.R:411 @ 3e11391 |
| CollecTRI | organism | human | src/decoupler/op/_collectri.py:11 @ 3132edc |
| CollecTRI | remove_complexes | False | src/decoupler/op/_collectri.py:12 @ 3132edc |
| CollecTRI | data access class (not sent in the download request) | academic | src/decoupler/op/_collectri.py:13 @ 3132edc |
| CollecTRI | download | Zenodo record 8192729 | src/decoupler/op/_collectri.py:46 @ 3132edc |
| CollecTRI | complex sources removed when remove_complexes is set | AP1, NFKB | src/decoupler/op/_collectri.py:60 @ 3132edc |
| OmniPath | GRN datasets | dorothea, tf_target, collectri | R/interactions.R:26 @ 3e11391 |
| ULM | activity statistic | t-value of slope | src/decoupler/mt/_ulm.py:103 @ 3132edc |
| decoupler | data access classes | academic, commercial, nonprofit | src/decoupler/_docs.py:137-141 @ 3132edc |

## 5. Proposed singlet approach

Routes. DoRothEA and CollecTRI are ported: the weight rule, the level filter and the table parsing are reproduced in singlet, and the wrappers' download endpoints are kept (section 12). The OmniPath TF-target dataset is ported as a query definition. The FootprintMethods benchmark code is reimplemented from its protocol, not copied. BEELINE networks are used as data only.

Defaults an agent should use without asking: method `collectri`, species `human`, context `null`, min_targets 5, DoRothEA levels A to C, CollecTRI remove_complexes false. The min_targets value matches the minimum target count of the activity-scoring task (grn.tf_activity_scoring); it is a design default, not a source default.

Each edge row holds tf, target, sign, weight, tier, n_sources, sources, pmids, species and context. The CollecTRI wrapper keeps the weight it reads unchanged, so the tier is blank for that method. Non-human species are translated after the human table is built, and the summary reports the edge count before and after translation.

Model-based proposal. Fit the calibrated logit of section 3 on perturbation labels, in both directions: fit on the B1 experiments and score on B2, then the reverse, so that no label source both trains and scores the model. The mapping from experiment to edge label is fixed before fitting. The claim is falsified if held-out B1 AUROC falls more than 0.02 below the best heuristic comparator, or if reliability on the ChIP-seq labels of B3 deviates from the diagonal by more than 0.05 in any decile. These thresholds are proposed. The model enters the enum only after it is specified and benchmarked; until then collectri is the default.

ML stack. A dependency-free C++ core builds the table and fits the logit, which has few features, by Newton iterations on CPU. PyTorch is not justified for a per-edge model with a handful of features. CUDA or cuSPARSE applies only to sparse TF-by-target products in benchmark scoring, not to curation. Streaming is not needed: the edge table fits in memory, and its size is measured in P1.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | — | — | No `.singlet` members; source tables are downloaded from OmniPath and Zenodo |
| write | uns/regulon_<method>_<species> | table | One row per TF-target edge: tf, target, sign (+1 or -1), weight, tier (A to D, or blank), n_sources, sources, pmids, species, context |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI, or a workspace handle, whose uns receives the regulon table. |
| `method` | string | "collectri" | `collectri`, `dorothea`, `omnipath_tf_target` | Curated source. collectri is the default; dorothea adds confidence tiers; omnipath_tf_target keeps per-edge evidence. |
| `species` | string | "human" | — | Species of the output table; non-human species are translated from human by orthology. |
| `context` | string/null | null | — | Optional label recorded on the table; it does not filter edges. |
| `min_targets` | integer | 5 | min 1 | Minimum targets per TF; TFs with fewer targets are dropped from the table. |
| `dorothea` | object | — | — | Options for method dorothea; ignored by the other methods. |
| `dorothea.levels` | array | ["A", "B", "C"] | — | Confidence levels kept for method dorothea; D is excluded by default. |
| `dorothea.license_class` | string | "academic" | `academic`, `commercial`, `nonprofit` | Access class requested from OmniPath for the DoRothEA download. |
| `collectri` | object | — | — | Options for method collectri; ignored by the other methods. |
| `collectri.remove_complexes` | boolean | false | — | Drop the AP1 and NFKB complex sources from the CollecTRI table. |
| `device` | string | "auto" | `auto`, `cpu` | Execution device; only cpu is implemented, so auto resolves to cpu. |
| `dry_run` | boolean | false | — | Return the source names, levels and device without downloading or writing. |
| `overwrite` | boolean | false | — | Replace an existing uns member of the same name instead of failing. |
<!-- PARAMS:AUTO:END -->

Rules across parameters. The method selects one source; `dorothea.*` applies only to method dorothea and `collectri.*` only to method collectri. min_targets is applied after species translation. context is stored as a label and never filters edges. overwrite replaces only the uns member with the same name.

## 7. MCP tool

Tool name `singlet_grn_prior_network_curation` (definition in `tasks/mcp/singlet_grn_prior_network_curation.json`). Example call and compact result:

```json
{"dataset": "/data/atlas.singlet", "method": "dorothea", "dorothea": {"levels": ["A", "B"]}, "context": "lung"}
```

```json
{
  "dataset": "/data/atlas.singlet",
  "status": "completed",
  "wrote": ["uns/regulon_dorothea_human"],
  "summary": {"n_edges": "<int>", "n_tfs": "<int>", "n_targets": "<int>",
              "tier_counts": {"A": "<int>", "B": "<int>"}, "n_dropped_min_targets": "<int>",
              "species_translated": false, "n_edges_before_translation": null},
  "provenance_id": "<id>",
  "job_id": null,
  "estimate": null
}
```

Long-running: no; one download per source and one table build. Stochastic: no; the same source version gives the same table. Dry run: returns the source names, levels and device without downloading or writing.

## 8. Benchmarks

Shared protocol. Each benchmark scores every resource with the same activity statistic (the ULM t-value of section 3) and the same expression normalisation, so only the prior changes. An experiment is kept only if its perturbed TF is present in every compared resource, and a TF that any resource cannot score is removed from all of them, because a filter on one resource changes the class balance. $\Delta_{e,t}$ is the limma log fold change of TF activity, perturbed minus control [R3]. Accuracy is the pooled AUROC of section 3, with paired bootstrap intervals over experiments. Comparator versions are pinned in each benchmark.

### B1. Simulated perturbation recovery

- **Goal**: Rank the perturbed TF highest among all TFs in pseudo-single cells simulated from bulk TF perturbation profiles [R3].
- **Ground truth**: Planted labels from experiment metadata; the response is 1 for the (experiment, TF) pair whose TF is the perturbed one. Cells are sampled with replacement from bulk TPM, with library sizes drawn from a normal distribution whose mean is the grid value and whose standard deviation is half the mean; cells under 100 counts are dropped [R3]. The change $\Delta_{e,t}$ is normalised per experiment.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Single-TF RNA-seq perturbation experiments from ChEA3 metadata (RNASEQ entries) | [R3] analysis code; GEO series in the entry IDs; expression in Zenodo 10.5281/zenodo.3564179 | bulk RNA-seq, human; experiments — | — | Knockdown aliases SIRNA, KO, SHRNA, KD; overexpression ACTIVATION, OE, HYPERACTIVE |
| Pseudo-single cells | [R3] simulation code | simulated; mean library sizes 1,000 to 20,000; 1 to 100 cells per bulk sample; 30 repetitions | — | Only part of the simulated cells is deposited (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pooled AUROC over (experiment, TF) pairs | As in section 3; positives are the perturbed TFs; ties count one half; pooled within each setting, averaged over the five library-size strata | maximize | primary | [R3] |
| Sign concordance | Fraction of experiments with $s_e\Delta_{e,p_e}>0$ | maximize | guardrail | [R3] |

- **Comparators**: collectri at 3132edc (default levels); dorothea at levels A, A-B, A-C and A-D (the range the decoupler wrapper accepts); omnipath_tf_target at 3e11391.
- **Protocol**: Within each library size, AUROC is computed for each (cell count, repetition) setting and averaged over the six cell counts and 30 repetitions. Only the shared filter applies on top of this.
- **Acceptance criterion**: Proposed, not from the literature: a candidate loses no more than 0.02 AUROC to the best comparator in at most one of the five library-size strata, and its paired 95% bootstrap interval over experiments excludes a loss above 0.02.
- **Known pitfalls**: The benchmark code keeps only experiments whose perturbed TF is in the DoRothEA table, which favours DoRothEA-based priors; the shared filter replaces it. Pooling compares changes across experiments whose scales need not match.

### B2. Real CRISPR perturbation recovery

- **Goal**: Test whether the perturbed TF shows the most extreme signed change, in the expected direction, in real single-cell CRISPR data [R3].
- **Ground truth**: Orthogonal measurement. Each cell carries one guide; the (experiment, TF) label is 1 when the guide targets that TF. Controls are intergenic guides (Perturb-seq series) or scrambled guides (CRISPRi series) [R3]. $\Delta_{e,t}$ is computed per guide series and day, normalised as in B1.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Perturb-seq day 7 and day 13 series; CRISPRi series | [R3] in-vitro analysis code; Zenodo 10.5281/zenodo.3564179 | scRNA-seq with CRISPR guides; species —; size — | — | Accessions are not in the code read (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pooled AUROC | As in B1, with per-series change; positives are guide targets that are TFs | maximize | primary | [R3] |
| Sign concordance | Fraction of perturbations with $s_e\Delta_{e,p_e}>0$ | maximize | guardrail | [R3] |

- **Comparators**: collectri at 3132edc (default); dorothea at levels A to C; omnipath_tf_target at 3e11391.
- **Protocol**: One change per guide series and day. TFs without a perturbed case are removed, as in the code read, and the shared filter applies.
- **Acceptance criterion**: Proposed: sign concordance of at least 0.7 for the candidate, and an AUROC loss of at most 0.05 against the best comparator.
- **Known pitfalls**: Weak knockdown or knockout gives small changes and noisy ranks. Co-regulated TFs with shared targets obtain the same sign and rank, so a high AUROC can reflect a neighbouring TF.

### B3. ChIP-seq edge recovery

- **Goal**: Measure how well a resource's TF-target edges agree with ChIP-seq binding in a human reference, with a functional network as negative control [R6].
- **Ground truth**: Orthogonal measurement (ChIP-seq binding). The label of an ordered TF-target pair is 1 when the edge is in the reference. Binding is not regulation and carries no sign, so the score is $|w_{tg}|$ or the tier score. The universe is every ordered pair with the TF in the BEELINE human TF list and the target in both gene sets, excluding self-pairs; pairs absent from a resource score zero.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| hESC ChIP-seq reference network with the human TF list | [R6] BEELINE documentation (Networks/human; human-tfs.csv); murali-group/Beeline | human, hESC; edges — | — | Positive labels |
| Human STRING-derived network | [R6] same directory | human; functional associations | — | Negative control for specificity |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUPRC over the universe | Positives are ChIP-seq edges; score $\lvert w_{tg}\rvert$ or tier score; ties averaged; baseline is prevalence | maximize | primary | [R6] |
| AUROC over the universe | Same labels and score | maximize | guardrail | [R6] |

- **Comparators**: collectri at 3132edc (default); dorothea at levels A and A-C; STRING-derived network as negative control.
- **Protocol**: Fixed universe, no splits and no seeds. Report prevalence next to AUPRC.
- **Acceptance criterion**: Proposed: a resource counts as regulatory evidence only if its AUPRC exceeds the STRING-derived network by at least 0.05.
- **Known pitfalls**: A resource that uses ChIP-seq evidence agrees with this reference by construction; the per-edge sources in the output show which edges carry that evidence. The hESC network fixes one cell type, so agreement says little about other contexts.

### P1. Performance and scaling

Wall time and peak memory to build each resource from cached downloads, and to load and query it, measured separately. Comparators: the decoupler wrapper downloads at 3132edc, the OmniPathR download at 3e11391, and an in-memory table built from local files in singlet. Scale is the edge and TF count of each resource, measured after the build, with CollecTRI's 1,186 TFs as the reported reference [R7]. Cell count does not enter the build; the 10k, 100k and 1M cell sweep belongs to the scoring task. Hold fixed: human, levels A to C, cache state and the source set. Report only measured numbers.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `cross-species.ortholog_assignment`: Gene orthology assignment across species
- **Feeds**:
  - `grn.tf_activity_scoring`: Per-cell or per-sample TF activity scoring from a prior regulon network
  - `grn.differential_grn_rewiring`: Differential GRN, regulon and co-expression rewiring between conditions or cell types
  - `grn.upstream_regulator_inference`: Upstream TF (master regulator) inference from a differential signature
- **Reads**: none
- **Writes**: `uns/regulon_<method>_<species>`
<!-- CHAINING:AUTO:END -->

Recipe: TF activity from a curated prior. The table is the prior for activity scoring, differential regulon analysis and upstream regulator inference.

## 10. Risks, pitfalls and open questions

- **Unread sources.** Garcia-Alonso et al. [R1] and Müller-Dott et al. [R2] are cited for their titles and for the code that uses them. Their benchmark sets, negative controls and reported rankings were not read, so no numbers from them appear here.
- **Holland et al. data.** The README states that only part of the simulated single-cell data is deposited. The accessions of the Perturb-seq and CRISPRi series are not in the code read. The DoRothEA rule that assigns levels A to D was not read; only the meaning of the levels was.
- **Licences and access terms.** The redistribution terms of the OmniPath data, the Zenodo CollecTRI file and the BEELINE network files were not read. The CollecTRI wrapper accepts an access-class argument that is not sent with its download (section 4), so no parameter controls that data's terms.
- **Omitted sources.** The SCENIC cisTarget resource, the TRRUST database and SCENIC+ are absent from the tables. Their primary papers and code were not read, and the SCENIC+ repository was not examined.
- **Source differences.** The R client's DoRothEA default (A, B) differs from the Python wrapper (A to C). The benchmark code evaluates level E, which the Python wrapper rejects. Edges with no sign flag take +1 (section 4). Every report must state the level set and the sign rule.
- **First experiment.** Reproduce B1 for collectri, dorothea and omnipath_tf_target on the deposited bulk experiments under the shared filter, and count edges with no sign flag, before any calibrated model is fitted.

## 11. References

R1. García-Alonso L, Holland CH, Ibrahim MM, Turei D, Saez-Rodriguez J. Benchmark and integration of resources for the estimation of human transcription factor activities. *Genome Research* 2019;29(8):1363-1375. doi:10.1101/gr.240663.118 — verified (corpus)
R2. Müller-Dott S, Tsirvouli E, Vazquez M, Ramirez Flores RO, Badia-i-Mompel P, Fallegger R, Turei D, Laegreid A, Saez-Rodriguez J. Expanding the coverage of regulons from high-confidence prior knowledge for accurate estimation of transcription factor activities. *Nucleic Acids Research* 2023. doi:10.1093/nar/gkad841 — verified (corpus)
R3. Holland CH, Tanevski J, Perales-Patón J, et al. Robustness and applicability of transcription factor and pathway analysis tools on single-cell RNA-seq data. *Genome Biology* 2020. doi:10.1186/s13059-020-1949-z — verified (corpus)
R4. Badia-i-Mompel P, Vélez Santiago J, Braunger J, et al. decoupleR: ensemble of computational methods to infer biological activities from omics data. *Bioinformatics Advances* 2022. doi:10.1093/bioadv/vbac016 — verified (corpus)
R5. Türei D, Valdeolivas A, Gul L, et al. Integrated intra- and intercellular signaling knowledge for multicellular omics analysis. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209923 — verified (corpus)
R6. Pratapa A, Jalihal AP, Law JN, Bharadwaj A, Murali TM. Benchmarking algorithms for gene regulatory network inference from single-cell transcriptomic data. *Nature Methods* 2020. doi:10.1038/s41592-019-0690-6 — verified (corpus)
R7. Heumos L, Schaar AC, Lance C, et al. Best practices for single-cell analysis across modalities. *Nature Reviews Genetics* 2023. doi:10.1038/s41576-023-00586-w — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/saezlab/decoupler-py | scverse; Pau Badia i Mompel; Saez lab (LICENSE copyright lines) | BSD-3-Clause (LICENSE) | DoRothEA and CollecTRI wrappers; ULM statistic | port |
| https://github.com/saezlab/OmniPathR | Saez Lab (copyright holder in LICENSE) | MIT + file LICENSE (DESCRIPTION) | OmniPath TF-target datasets | port |
| https://github.com/saezlab/FootprintMethods_on_scRNAseq | Holland CH et al. (paper authors listed in README) | GPL-3.0 (LICENSE) | Benchmark protocol for B1 and B2 | reimplement |
| https://github.com/murali-group/Beeline | Murali group (repository owner); Pratapa A et al. (paper) | GPL-3.0 (LICENSE) | Reference network files for B3 | callout (data only) |
