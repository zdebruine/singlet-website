---
id: enrichment.pathway_resource_curation
title: Curated pathway gene-set and signed footprint resource construction
area: enrichment
scope: core
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [harmonization.gene_identifier_mapping, normalization.variance_stabilizing_transform]
feeds: [enrichment.pathway_footprint_activity, enrichment.over_representation_analysis, enrichment.preranked_gene_set_enrichment]
reads: [layers/lognorm, obs/<context_label>, obs/<source_key>, obs/<study_key>, uns/pathway_sources/<source>]
writes: [uns/pathway_resource/<name>/table, uns/pathway_resource/<name>/set_stats, uns/pathway_resource/<name>/recovery, uns/pathway_resource/<name>/provenance]
devices: [cpu, cuda]
mcp_tool: singlet_enrichment_pathway_resource_curation
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Curated pathway gene-set and signed footprint resource construction

> Builds one harmonised table of pathway members, signs and weights from curated and perturbation-derived sources, prunes redundant sets, and ranks the resulting collections by how well they recover held-out pathway perturbations.

## 1. Question

Which genes, signs and weights belong in a reusable pathway resource, and which collection, after size and overlap pruning, gives activity estimates that best recover known pathway perturbations? Inputs are curated or perturbation-derived sources, a gene universe and a perturbation compendium with study labels. Outputs are a resource table and a recovery score per resource. A correct answer ranks collections on held-out perturbations and states the pruning and sign convention behind each rank.

## 2. Why this task matters and where the field stands

Pathway activity inferred from transcripts depends on which genes are assigned to each pathway, with what sign and weight. PROGENy derives signed footprint weights for 14 signalling pathways from perturbation-response experiments [R1]. Curated collections differ in kind: Hallmark sets are refined and non-redundant but unsigned [R4, R5]. Pathway database choice gives inconsistent enrichment for pathways that should match across databases [R6]. On single-cell data, bulk footprint tools perform comparably to bulk but not identically, and performance depends more on the gene sets than on the scoring statistic [R2].

Status: **contested**. Open problems:

- **Set choice versus statistic**: the gene-set choice appears to matter more than the statistic [R2].
- **Redundancy**: overlapping sets turn one signal into several significant results and change ranks [R6].
- **Context**: a footprint is silent in lineages where its pathway is inactive, and weights fitted on one compendium may not transfer to another cell type.
- **Ground truth**: perturbation labels are often pathway-level hypotheses and are incomplete. Data-driven signatures from single-cell perturbation screens may supersede curated sets [R9].

## 3. Theory and insight

Let $X\in\mathbb{R}^{C\times G}$ hold normalised expression for $C$ samples or cells over $G$ genes, and $W\in\mathbb{R}^{G\times P}$ hold weights for $P$ sets, zero for non-members. Unsigned sets have $w_{gp}=1$ for members and carry sign 0.

Estimands. A resource weight $w_{gp}$ is in its source's units and is comparable only within that source; its sign is $\operatorname{sign}(w_{gp})$. ULM activity $t_{cp}$ is a dimensionless t-statistic relative to residual spread across the set's genes. Recovery AUROC is unitless in $[0,1]$ over binary labels $\ell_{cp}$, equal to 1 when cell $c$ comes from an experiment that perturbed pathway $p$; labels need no normalisation. Overlap measures are unitless in $[0,1]$.

ULM regresses each sample's expression on one set's weights:

$$y_{cg}=\beta_{0c}+\beta_{1c}\,w_{gp}+\varepsilon_{cg},\qquad t_{cp}=\frac{\hat\beta_{1c}}{\mathrm{SE}(\hat\beta_{1c})},\qquad \mathrm{SE}^2=\frac{\hat\sigma^2}{\sum_{g\in G_p}(w_{gp}-\bar w_p)^2}$$

with $\hat\sigma^2=\mathrm{RSS}/(|G_p|-2)$. It is exact under ordinary least squares, approximately valid for Gaussian residuals across targets, and assumes independent targets. Co-expressed targets make $t_{cp}$ over-confident.

Over-representation of $n$ listed genes in a set with $K$ members, inside a universe of $N$ genes, has the one-sided hypergeometric tail

$$P(X\ge k)=\sum_{i=k}^{\min(K,n)}\frac{\binom{K}{i}\binom{N-K}{n-i}}{\binom{N}{n}}$$

valid only when the list is chosen without reference to the set. Lists selected from the same data violate this.

GSEA uses the running-sum score $\mathrm{ES}=\max_i\lvert P_{\mathrm{hit}}(i)-P_{\mathrm{miss}}(i)\rvert$ over a ranked list. It is a competitive test; with $T$ permutations the smallest attainable p-value is $1/(T+1)$.

Set overlap uses $J=\lvert A\cap B\rvert/\lvert A\cup B\rvert$ and $\mathrm{OC}=\lvert A\cap B\rvert/\min(\lvert A\rvert,\lvert B\rvert)$. OC flags a small set nested in a large one; J does not. AUROC, $P(s_+>s_-)+\tfrac12P(s_+=s_-)$, is threshold-free and insensitive to prevalence, so AUPRC is reported with it.

Proposed model-based formulation. Each context's weight vector is a draw from a shared prior, $w^{(k)}_{\cdot p}\sim\mathcal N(\mu_{\cdot p},\tau_p^2 I)$, so sparse contexts borrow strength from pooled sources. ULM then uses posterior-mean weights and reports their posterior variance. The regime is Gaussian weights with independent targets, and section 8 tests it.

Assumptions and failure modes. Weighted methods assume weights transfer across context, species and identifier mapping; mismatched symbols drop out silently. Unsigned sets scored with signed methods carry weight 1, and weighted nets scored with set methods lose their sign. Very small sets give unstable t-values and ORA artefacts; very large generic sets dominate. Two implementations can share a name and differ in net (section 4). Pruning changes ranks, and dropout attenuates scores in sparse data.

Insight. Weight-aware scoring is linear and cheap, so membership, sign, size filters and the context of the weights decide results. Agreement between resources is not accuracy, so held-out recovery is the only accuracy anchor (section 8).

## 4. Methods landscape

PROGENy scored with ULM is the weighted route with a single-cell benchmark [R2]. decoupleR pairs ULM with weighted nets and ORA or GSEA with unweighted sets [R3]. Hallmark is the curated unweighted collection [R4, R5], and OmniPath gives literature-curated signed sets [R7]. Hallmark, ORA and GSEA serve as comparators that separate membership from statistic.

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| PROGENy footprint weights | hybrid | Signed weights for 14 pathways from perturbation-response experiments, trimmed to top genes | [R1] |
| Hallmark collection | heuristic | 50 refined, non-redundant gene sets for well-defined states; unsigned | [R4, R5] |
| OmniPath signalling sets | heuristic | Literature-curated directed, signed interactions aggregated into sets | [R7] |
| ULM | model-based | t-statistic of the per-sample regression slope on signed weights | [R3] |
| ORA (hypergeometric) | heuristic | Overlap of a thresholded gene list with each set against a background | [R3] |
| GSEA running sum | heuristic | Running-sum enrichment on a ranked list with permutation p-values | [R8], [R3] |

Defaults used by the implementations, with exact locations.

| Method | Parameter | Value | Source |
|---|---|---|---|
| PROGENy (R) | genes per pathway (`top`) | 100 | progeny `R/progeny.r:79`, `R/progenySuppFunc.r:188` @ cad6be0 |
| PROGENy (R) | permutations (`perm`) | 1 (none) | progeny `R/progeny.r:79` @ cad6be0 |
| PROGENy (R) | scaling (`scale`) | TRUE; FALSE for SingleCellExperiment | progeny `R/progeny.r:79`, `:129` @ cad6be0 |
| PROGENy (decoupler-py) | `top`; `thr_padj` | inf; 0.05 | decoupler `src/decoupler/op/_progeny.py:12`–`13` @ 3132edc |
| ULM | `tval` | True | decoupler `src/decoupler/_skills/data/references/methods.md`, ulm kwargs @ 3132edc |
| ORA | `n_bg`; `ha_corr` | 20000; 0.5 | decoupler `methods.md`, ora kwargs @ 3132edc |
| GSEA | `times`; `seed` | 1000; 42 | decoupler `methods.md`, gsea kwargs @ 3132edc |
| Hallmark wrapper | `license` | academic | decoupler `src/decoupler/op/_hallmark.py:12` @ 3132edc |
| OmniPath wrapper | `license` | academic (retrieves all interactions) | decoupler `src/decoupler/op/_resource.py:44`, `:82`–`83` @ 3132edc |
| Set-size floor | minimum members | 10 (range 10 to 15) | single-cell best-practices repository, `jupyter-book/conditions/gsea_pathway_keytakeaways.txt`, takeaway 3 |
| Set-size ceiling | maximum members | 500 | singlet proposal, tested in B2 |
| Overlap pruning | Jaccard threshold | 0.5 | singlet proposal, tested in B2 |

## 5. Proposed singlet approach

Each call builds one resource from the selected sources. Members and signs come from the packaged PROGENy model or from Hallmark and OmniPath snapshots; identifiers must match the data's symbols; sets are filtered by size and pruned by overlap; and the table keeps source, sign, weight and context. When recovery is requested, one statistic scores every resource on the same expression matrix, so only the resource varies. Each source's route is given in section 12.

Default for an agent: `sources` set to progeny, `organism` human, `progeny.top_per_pathway` 100, default curation, and no `recovery` block. Add `recovery` only when a perturbation compendium with study labels is supplied.

Model-based candidate: the shrinkage prior of section 3, initialised from the PROGENy footprint and fitted on training studies only. It is kept only if it meets the B1 criterion (section 8).

Stack: PyTorch fits the prior and any penalised regression on the weights, with the closed-form posterior as the correctness reference. The hot steps are hard-coded in CUDA with cuSPARSE: batched ULM t-values from sparse-dense products over precomputed column moments, and set-overlap counts from a sparse incidence matrix. The CPU path uses float64 for agreement with the reference, and CUDA uses float32.

Streaming: ULM and ORA are per sample and stream over blocks of cells. Resource construction is a one-off on the incidence matrix. GSEA permutations multiply cost by the permutation count.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/lognorm | float32 sparse | normalised expression; recovery only |
| read | var names | string | gene symbols matching the chosen sources |
| read | obs/<source_key> | string | perturbed source per sample or cell; recovery only |
| read | obs/<study_key> | string | study label for leave-study-out splits; recovery only |
| read | obs/<context_label> | string | optional cell-type or tissue context |
| read | uns/pathway_sources/<source> | long table | snapshot of a hallmark or omnipath source |
| write | uns/pathway_resource/<name>/table | long table | pathway, gene, sign, weight, source, context |
| write | uns/pathway_resource/<name>/set_stats | table | set size, retained flag, mean pairwise Jaccard |
| write | uns/pathway_resource/<name>/recovery | table | per-pathway AUROC, AUPRC and qrank; recovery only |
| write | uns/pathway_resource/<name>/provenance | dictionary | source versions, snapshot checksums, parameters |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `name` | string | — | — | Resource name under uns/pathway_resource; defaults to the source names joined by plus signs. |
| `organism` | string | "human" | `human`, `mouse` | Organism of the resource and data; mouse maps by orthology. |
| `sources` | array | ["progeny"] | — | Resources to combine; hallmark and omnipath read snapshots from uns/pathway_sources. |
| `context_label` | string | — | — | Optional obs column naming the cell-type or tissue context; recorded per row and used to stratify recovery. |
| `curation` | object | — | — | Size and overlap filters applied before the table is written. |
| `curation.min_set_size` | integer | 10 | min 1 | Smallest allowed set; 10 is the lower bound of the usual 10 to 15 range. |
| `curation.max_set_size` | integer | 500 | min 2 | Largest allowed set, so that broad generic sets cannot dominate. |
| `curation.overlap_measure` | string | "jaccard" | `jaccard`, `overlap_coefficient` | Overlap measure for pruning; overlap_coefficient also flags small sets nested in large ones. |
| `curation.overlap_threshold` | number/null | 0.5 | min 0; max 1 | Prune the smaller of two sets above this overlap; null disables pruning. |
| `progeny` | object | — | — | PROGENy footprint options; defaults reproduce the R net. |
| `progeny.top_per_pathway` | integer/null | 100 | min 1 | Genes kept per pathway by model p-value; null keeps all genes when padj_threshold is also null. |
| `progeny.padj_threshold` | number/null | null | max 1; > 0 | Adjusted p-value cut applied before the top-N step; null disables it. |
| `omnipath` | object | — | — | OmniPath subset options. |
| `omnipath.license` | string | "academic" | `academic`, `commercial`, `nonprofit` | Subset class; the default retrieves all interactions, so set commercial or nonprofit for restricted use. |
| `recovery` | object | — | — | Optional recovery scoring of each resource on a perturbation compendium; omit to skip. |
| `recovery.source_key` | string | — | — | obs column giving the perturbed source of each sample or cell; required when recovery is requested. |
| `recovery.study_key` | string | "study" | — | obs column giving the study label used for leave-study-out splits. |
| `recovery.statistic` | string | "ulm" | `ulm`, `ora`, `gsea` | Statistic applied to every resource in the call; ulm is the default. |
| `recovery.layer` | string | "lognorm" | — | Normalised expression layer; raw counts are rejected. |
| `recovery.seed` | integer | 42 | — | Permutation seed, used only by the gsea statistic. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing. |
| `overwrite` | boolean | false | — | Replace existing resource members of the same name instead of failing. |
<!-- PARAMS:AUTO:END -->

The `progeny`, `omnipath` and `recovery` objects apply only to the sources or steps they name. The two PROGENy nets in section 4 share a name but differ, so set `top_per_pathway` and `padj_threshold` deliberately and keep the choice in provenance. `recovery.statistic` applies to every resource in the call, and `recovery.source_key` is required whenever recovery is requested.

## 7. MCP tool

Tool `singlet_enrichment_pathway_resource_curation` (definition in `tasks/mcp/singlet_enrichment_pathway_resource_curation.json`). Example call and compact result:

```json
{"dataset": "/data/pbmc.singlet", "name": "footprint_v1", "sources": ["progeny"], "curation": {"overlap_threshold": 0.5}}
```

```json
{"dataset": "/data/pbmc.singlet", "status": "completed",
 "wrote": ["uns/pathway_resource/footprint_v1/table", "uns/pathway_resource/footprint_v1/set_stats", "uns/pathway_resource/footprint_v1/provenance"],
 "summary": {"sources": ["progeny"], "sets_total": 14, "sets_retained": "<int>", "mean_pairwise_jaccard": "<float>"},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: resource construction returns inline; recovery is queued when its dry-run estimate exceeds the inline limit. Stochastic: only the `gsea` statistic draws permutations, seeded by `recovery.seed`. Dry run: returns estimated seconds, peak memory and device from set count, gene universe and cell count.

## 8. Benchmarks

Shared protocol. Accuracy benchmarks score each resource on the same expression matrix, with the same statistic (ULM with t-values unless stated) and float64 on CPU. Ground truth is binary per instance, so AUROC and AUPRC are computed per pathway and averaged over pathways with at least three positive instances (proposed). Confidence intervals are bootstrap resamples over perturbation groups (source experiments or studies) with seed 42. Metric definitions follow decoupleR [R3] and the tie convention of section 3. The resource-versus-resource design follows an analogous comparison of communication resources [R10]. Resources are ranked by mean AUROC over pathways.

### B1. Holland 2020 simulated footprint benchmark

- **Goal**: Test whether signed resources recover the perturbed pathway in simulated cells, and how much the resource choice matters beyond the statistic.
- **Ground truth**: planted simulation. Each simulated cell inherits the perturbed pathway of its bulk source experiment, giving a binary label $\ell_{cp}$ that needs no normalisation; the metric is the AUROC of the per-cell score against it.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated scRNA-seq from pathway perturbation bulk experiments | [R2]; archive DOI 10.5281/zenodo.3564179 (repository README) | scRNA-seq, simulated, human; — | — | Partial archive (section 10) |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC per pathway | $P(s_+>s_-)+\tfrac12P(s_+=s_-)$ over cells | max | primary | [R3] |
| AUPRC per pathway | area under precision-recall, with prevalence baseline | max | primary | [R3] |
| Sign concordance | fraction of labelled cells with the expected score sign | max | guardrail | — |
| qrank | one minus normalised mean rank of labelled cells; one-sided rank-sum p | max | guardrail | [R3] |

- **Comparators**: PROGENy top 100 per pathway (R default); PROGENy with all genes at padj below 0.05 (decoupler-py default); Hallmark with ORA or GSEA; OmniPath-derived sets.
- **Protocol**: ULM on the same cells, stratified by simulated cell type; then ORA and GSEA to isolate the statistic.
- **Acceptance criterion**: Proposed: mean AUROC exceeds the PROGENy top-100 baseline by at least 0.02, with a bootstrap 95% interval over source experiments excluding zero.
- **Known pitfalls**: Circularity: weights fitted on the simulation's own bulk experiments give optimistic AUROC. Simulated dropout may not match real data.

### B2. Resource consistency and pruning stability (proposed, consistency rather than accuracy)

- **Goal**: Quantify how collection choice and pruning change scores on the same input, and choose the pruning threshold that keeps stable, non-redundant sets.
- **Ground truth**: none; no labels are used, so no normalisation applies.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated cells from B1 | [R2]; same archive as B1 | scRNA-seq, simulated, human; — | — | Labels unused |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pairwise top-k Jaccard | mean over resource pairs of Jaccard between top-$k$ pathway sets $T_k$ per cell, averaged over cells | max | primary | — |
| Cross-resource rank correlation | Spearman correlation of scores for shared pathways, averaged over cells | max | primary | — |
| Retained fraction | sets kept after size filter and pruning at $t$ | max | guardrail | — |
| Mean pairwise Jaccard | mean Jaccard among kept sets at $t$ | min | guardrail | — |

- **Comparators**: Hallmark, OmniPath-derived and PROGENy collections; $t\in\{0.3,0.5,0.7\}$ (proposed grid).
- **Protocol**: Score each collection on the same matrix, sweep $t$, and bootstrap cell subsamples.
- **Acceptance criterion**: Proposed: pruning at Jaccard 0.5 keeps at least 80% of sets, lowers mean kept-set Jaccard below 0.3, and gives bootstrap top-k Jaccard of at least 0.6.
- **Known pitfalls**: Consistency rewards redundancy, so agreement between near-duplicate sets is not accuracy. Pruning before or after multiple testing changes reported counts.

### P1. Performance and scaling

Wall time, peak memory and throughput for (a) resource construction from the sources and (b) ULM scoring of cells in blocks, at 10k, 100k and 1M cells (10M is not claimed). Set counts are 14 (PROGENy) and 50 (Hallmark), plus a proposed generator of 1,000 and 10,000 random sets, with members drawn uniformly from the measured gene universe, sizes uniform from 10 to 500, and signs drawn at random. Comparators are decoupler-py `dc.mt.ulm` (CPU), PROGENy R `progeny()` (CPU), decoupler-py ORA and GSEA (reference only), and the singlet CPU and CUDA backends. Hold fixed the gene universe, net, top-k, float64 for CPU agreement, seed 42, 1000 GSEA permutations and the thread count. Proposed acceptance: maximum absolute ULM t-value difference from decoupler-py at most $10^{-6}$ on CPU and $10^{-4}$ for float32 CUDA, and throughput at least five times decoupler-py ULM at 100k cells and 14 sets (a target, not a measured value).

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `normalization.variance_stabilizing_transform`: Variance-stabilizing transform of depth-normalized counts
- **Feeds**:
  - `enrichment.pathway_footprint_activity`: Pathway activity inference from signaling footprints
  - `enrichment.over_representation_analysis`: Over-representation analysis of marker or DE gene lists
  - `enrichment.preranked_gene_set_enrichment`: Preranked gene set enrichment on gene-level statistics
- **Reads**: `layers/lognorm`, `obs/<context_label>`, `obs/<source_key>`, `obs/<study_key>`, `uns/pathway_sources/<source>`
- **Writes**: `uns/pathway_resource/<name>/table`, `uns/pathway_resource/<name>/set_stats`, `uns/pathway_resource/<name>/recovery`, `uns/pathway_resource/<name>/provenance`
<!-- CHAINING:AUTO:END -->

Recipes: pathway footprint scoring and over-representation or preranked enrichment consume the resource table.

## 10. Risks, pitfalls and open questions

- **Evidence gaps**: no accession was located for the Holland 2020 CRISPR knock-out data, so B1 is simulation-only. The simulation archive holds only part of the simulated data, and its data licence, the simulated bulk sources and the total archive size are not stated. PROGENy's derivation statistics and the Holland 2020 metric definitions are not stated here. The Broad GSEA software is not covered, and decoupler's implementation is the reference. Local clone shas were not recorded, so the shas given are remote heads.
- **Held-out recovery**: no perturbation compendium with accessions and study labels has been chosen, so the decisive test of section 1 has no benchmark. The first experiment fits weights on training studies, scores held-out experiments with ULM, and reports held-out AUROC, the median rank of the perturbed pathway and the in-study minus leave-study-out gap. Proposed acceptance: mean AUROC of at least 0.70 for pathways with at least three held-out experiments, and a gap of at most 0.05.
- **Unsettled choices and licences**: whether ULM outperforms GSEA on sparse data, whether the set-size floor should be 10 or 15, and whether pruning should precede testing are all open. The terms for the Hallmark and OmniPath-derived subsets need a verified summary before commercial use (section 12).
- **Citation risk**: the catalogue's Mubeen 2019 DOI is unsupported; the DOI in section 11 has only a partial match (search).

## 11. References

R1. Schubert M, Klinger B, Klunemann M, Sieber A, Uhlitz F, Sauer S, et al. Perturbation-response genes reveal signaling footprints in cancer gene expression. *Nature Communications* 2018. doi:10.1038/s41467-017-02391-6 — verified (corpus)

R2. Holland CH, Tanevski J, Perales-Paton J, Gleixner J, Kumar MP, Mereu E, et al. Robustness and applicability of transcription factor and pathway analysis tools on single-cell RNA-seq data. *Genome Biology* 2020. doi:10.1186/s13059-020-1949-z — verified (corpus)

R3. Badia-i-Mompel P, Velez Santiago J, Braunger J, Geiss C, Dimitrov D, Muller-Dott S, et al. decoupleR: ensemble of computational methods to infer biological activities from omics data. *Bioinformatics Advances* 2022. doi:10.1093/bioadv/vbac016 — verified (corpus)

R4. Liberzon A, Birger C, Thorvaldsdottir H, Ghandi M, Mesirov JP, Tamayo P. The Molecular Signatures Database Hallmark gene set collection. *Cell Systems* 2015. doi:10.1016/j.cels.2015.12.004 — partial (search)

R5. Liberzon A, Subramanian A, Pinchback R, Thorvaldsdottir H, Tamayo P, Mesirov JP. Molecular signatures database (MSigDB) 3.0. *Bioinformatics* 2011. — verified (corpus)

R6. Mubeen S, Hoyt CT, Gemund A, Hofmann-Apitius M, Frohlich H, Domingo-Fernandez D. The impact of pathway database choice on statistical enrichment analysis and predictive modeling. *Frontiers in Genetics* 2019. doi:10.3389/fgene.2019.01203 — partial (search)

R7. Turei D, Korcsmaros T, Saez-Rodriguez J. OmniPath: guidelines and gateway for literature-curated signaling pathway resources. *Nature Methods* 2016. doi:10.1038/nmeth.4077 — verified (corpus)

R8. Subramanian A, Tamayo P, Mootha VK, Mukherjee S, Ebert BL, Gillette MA, et al. Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. *Proceedings of the National Academy of Sciences* 2005. doi:10.1073/pnas.0506580102 — verified (corpus)

R9. Jiang L, Dalgarno C, Papalexi E, Mascio I, Wessels HH, Yun H, et al. Systematic reconstruction of molecular pathway signatures using scalable single-cell perturbation screens. *Nature Cell Biology* 2025. doi:10.1038/s41556-025-01622-z — verified (corpus)

R10. Dimitrov D, Turei D, Garrido-Rodriguez M, Burmedi PL, Nagai JS, Boys C, et al. Comparison of methods and resources for cell-cell communication inference from single-cell RNA-Seq data. *Nature Communications* 2022. doi:10.1038/s41467-022-30755-0 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/saezlab/progeny | Michael Schubert, Alberto Valdeolivas, Christian H. Holland and others (DESCRIPTION) | Apache License 2.0 (LICENSE; DESCRIPTION agrees) | packaged PROGENy weights and scoring reference | port |
| https://github.com/saezlab/decoupler-py | Pau Badia i Mompel, Saez lab and scverse (LICENSE copyright holders) | BSD 3-Clause (LICENSE) | ULM, ORA, GSEA, OmniPath and Hallmark wrappers; recovery metrics | port |
| https://github.com/saezlab/OmniPathR | Saez Lab (LICENSE copyright 2018–2024) | MIT with LICENSE file | OmniPath client; snapshot format reference | port (snapshot reader only) |
| https://github.com/saezlab/FootprintMethods_on_scRNAseq | Saez lab (repository owner) | GPL-3.0 (LICENSE) | Holland 2020 benchmark protocol and simulation archive | reimplement (protocol only) |
| https://github.com/theislab/single-cell-best-practices | — | — | set-size floor in the GSEA chapter | callout (text reference only) |
| MSigDB Hallmark collection (no repository; read through the decoupler wrapper) | Liberzon A et al. (R4, R5) | — | unweighted curated sets | reimplement (user-supplied snapshot) |
