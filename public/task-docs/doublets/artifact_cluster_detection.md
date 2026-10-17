---
id: doublets.artifact_cluster_detection
title: Doublet-driven artifact cluster detection
area: doublets
scope: extended
paradigm: hybrid
literature_status: open
priority: P2
depends_on: [doublets.expression_doublet_scoring, doublets.doublet_call_thresholding, clustering.cell_partitioning, dim-reduction.normalized_cell_embedding]
feeds: [annotation.cluster_label_assignment, markers-de.cluster_marker_ranking]
reads: [layers/counts, obsm/X_pca, obs/<cluster_key>, obs/<call_key>, obs/<hashing_key>]
writes: [obs/artifact_cluster_call, obs/unique_gene_rescue, uns/artifact_clusters, uns/artifact_markers, uns/artifact_params]
devices: [cpu, cuda]
mcp_tool: singlet_doublets_artifact_cluster_detection
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Doublet-driven artifact cluster detection

> For each cluster of a fixed partition, decides whether its cells are mostly multiplets or one biological state, and keeps real intermediate states that mix two neighbouring states' markers.

## 1. Question

Which clusters of a fixed partition are produced by doublets rather than biology, and how are these separated from a real intermediate state that co-expresses two neighbouring states' markers? Inputs are a clustered object, per-cell doublet calls, an embedding and optional sample-barcode labels. Outputs are a per-cluster call (real, artifact or unclear) with a probability and a suggested action. A correct artifact call means the cluster's cells are mostly multiplets.

## 2. Why this task matters and where the field stands

Status: **open**. Per-cell detectors score barcodes but do not say which clusters doublets form. Heterotypic doublets form their own clusters, which then enter marker lists, annotation and differential expression. Removing called barcodes often leaves those clusters behind: a 2025 multiplets study reports that hashing-based removal eliminated artifactual clusters that computational removal alone did not fully clear, and that multiplets inflate differential expression [R5]. The same study reports that computational detectors recover only a small share of hashing-labelled multiplets, even when tuned [R5].

Three problems are open. To our knowledge, no published benchmark uses real intermediate states as negatives. No standard cluster-level test exists, so cut-offs in practice are ad hoc. Homotypic doublets carry no mixed-marker signature and are invisible to expression-based callers [R11].

## 3. Theory and insight

Estimands. The cluster artifact indicator is $A_C=\mathbb{1}[f_C\ge\tau]$, where $f_C$ is the fraction of all cells in cluster $C$, singlets included, whose sample-barcode call is multi-sample. Cell hashing [R4] detects inter-sample multiplets only, so $f_C$ is a lower bound on the true multiplet fraction [R5]. The hashing channel's $\pi_C$ is the per-cell probability of a multi-sample call in $C$, and the expression channel's $\hat\pi_C$ estimates $P(A_C=1\mid\text{features})$ under the training labels. The multiplet fraction below is per occupied barcode, not per cell.

Under independent capture with mean $\lambda$ cells per barcode, the number of cells per barcode $K$ is Poisson:

$$P(K=k)=\frac{\lambda^{k}e^{-\lambda}}{k!}$$

so the fraction of occupied barcodes holding two or more cells is

$$P(K\ge 2\mid K\ge 1)=\frac{1-e^{-\lambda}(1+\lambda)}{1-e^{-\lambda}}\approx\frac{\lambda}{2}\qquad(\lambda\ll 1).$$

Loading overdispersion is ignored.

First-order additivity states $\mathbb{E}[x_g^{(a+b)}]\approx\mathbb{E}[x_g^{(a)}]+\mathbb{E}[x_g^{(b)}]$ for UMI counts of gene $g$. It holds for counts, not for log-normalised values, so geometry must use size-normalised counts, or an embedding only where mixing is locally linear. It ignores capture saturation, sub-linear UMI effects and ambient RNA, which all push doublets toward sub-additivity.

Mixed markers alone cannot decide. Four criteria add evidence, each with its regime:

- **Geometry.** If a cluster centroid $c$ lies between pure parent centroids $\mu_a$ and $\mu_b$, the segment distance $d_{seg}=\min_{t\in[0,1]}\lVert c-\mu_a-t(\mu_b-\mu_a)\rVert$ is small. Real intermediates lie on such segments too, so this is one input, not a test. Regime: near-additive mixing in size-normalised counts.
- **Depth.** Under additivity a doublet is deeper than either parent, up to saturation. A pure intermediate's depth typically lies between its neighbours' depths. Regime: correct parents and unsaturated libraries.
- **Exclusive markers.** Co-expressed lineage-exclusive genes signal a multiplet only when the pair is exclusive in that tissue. The repository's examples are CD3+CD19+ and CD4+CD8+ [R10]. CD4+CD8+ double-positive thymocytes are a genuine state, so pair lists are tissue-specific.
- **Unique genes.** A candidate cluster expressing genes absent from both parents has a state of its own. DoubletDecon keeps such a cluster when at least four unique genes are found [R1, R9].

A model-based formulation adds what rules lack: probabilities calibrated on planted and real examples, an uncertainty for each call, and a fitted model that can be reused. The rules remain as comparators.

Pitfalls: using the same clusters to define artifacts and references is circular; artifact clusters split or merge with clustering resolution; ambient RNA can add parent-like markers and mimic mixing.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| DoubletDecon rescue (cluster blacklist, unique-gene rescue) | heuristic | Blacklists correlated cluster medoid pairs, then rescues candidate doublet clusters that carry enough unique genes against both parents | [R1] |
| GMM-Demux phony-type test | model-based | Gaussian mixture on hashing counts; one-sided binomial tests label each cluster pure or phony | [R3] |
| DoubletFinder | heuristic | Per-cell fraction of artificial neighbours, thresholded at an expected count adjusted for homotypic doublets | [R2] |
| scDblFinder (cluster-aware mode) | hybrid | Per-cell scores from artificial doublets simulated within clusters | [R6] |

No published standard defines a cluster-level artifact call. The two published cluster-level criteria are DoubletDecon's medoid blacklist with unique-gene rescue [R1] and GMM-Demux's phony-type test [R3]. The first needs no hashing; the second needs sample barcodes. Per-cell detectors become cluster calls only through aggregation, which is the enrichment baseline in section 5.

Defaults used by implemented methods and comparators:

| Method | Parameter | Value | Source |
|---|---|---|---|
| DoubletDecon rescue | min_uniq | 4 | R/Main_Doublet_Decon.R:32 and R/Pseudo_Marker_Finder.R:14 @66c6f26 [R9] |
| DoubletDecon rescue | PMF (rescue step) | TRUE | R/Main_Doublet_Decon.R:32 @66c6f26 [R9] |
| DoubletDecon blacklist | rhop | 1 | R/Main_Doublet_Decon.R:32; cutoff at R/Blacklist_Groups.R:34 @66c6f26 [R9] |
| GMM-Demux | hashing confidence threshold | 0.8 | GMM_Demux/GMM_Demux.py:32 [R10] |
| GMM-Demux | alpha for pure and phony labels | 0.01 | GMM_Demux/GMM_Demux.py:260-263; phony label at 262-263 [R10] |
| GMM-Demux | phony rate | $1-\sum_s q_s^{2}$, cell_type_num = 2 | GMM_Demux/estimator.py:98-104 [R10] |
| GMM-Demux | phony test | one-sided binomial test of MSM/c against GEM/c at the phony rate | GMM_Demux/estimator.py:153-155 [R10] |
| GMM-Demux | ambient rate (-a) | 0.05 | README command-line options [R10] |
| DoubletFinder | pN | 0.25 | README.md:83 [R11] |
| scDblFinder | clusters | FALSE (random, default); TRUE (cluster-based) | README.md:64-68 [R12] |

## 5. Proposed singlet approach

Routes are listed in section 12. `doubletdecon_rescue` reimplements the blacklist and unique-gene rescue on the supplied partition, deterministically. `gmm_demux_phony` applies GMM-Demux's pure and phony tests to hashing counts and needs `hashing_key`. `composite`, the default, is singlet's proposal. For each cluster $C$:

- *Hashing channel* (when `hashing_key` is set). With $D_C$ multiplet cells among $n_C$ and $\pi_0$ the multiplet rate outside $C$, $p_C=P(\mathrm{Bin}(n_C,\pi_0)\ge D_C)$ tests $\pi_C\le\pi_0$. $C$ is an artifact when $p_C<\alpha$ and $f_C\ge\tau$. Overdispersion makes $p_C$ anti-conservative; a beta-binomial variant is the fallback.
- *Expression channel.* A logistic model gives an artifact probability $\hat\pi_C$ from segment distance to the best parent pair (scaled by parent spread), depth relative to the deeper parent, exclusive-pair co-expression, and unique genes against both parents. It is trained on B2 planted and real intermediate clusters and calibrated on held-out parent types. Cut-offs on $\hat\pi_C$ give real, artifact or unclear.
- *Falsification.* Geometry is dropped if it adds no held-out discrimination. `composite` is not the default if the B2 false-artifact rate misses its target.
- *Baseline.* The enrichment baseline is a one-sided binomial test of called-doublet counts against the global rate, applied to each per-cell detector. It has no published standard.
- *Stack and cost.* The logistic model is one linear layer in PyTorch. Per-cluster statistics get hard-coded CUDA kernels only after the CPU path is validated. Cost is linear in cells and quadratic in clusters, from parent-pair enumeration.
- *Defaults.* `composite`, alpha 0.01, empty `exclusive_pairs`, hashing off unless labels exist.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, for depth and unique-gene tests |
| read | obsm/X_pca | float32 | embedding for segment distance |
| read | obs/<cluster_key> | categorical | fixed cluster partition under evaluation |
| read | obs/<call_key> | categorical | per-cell doublet calls from doublets.doublet_call_thresholding |
| read | obs/<hashing_key> | categorical | optional sample-barcode calls |
| write | obs/artifact_cluster_call | categorical | cluster call copied to each cell: real, artifact or unclear |
| write | obs/unique_gene_rescue | bool | cluster passed the unique-gene rescue |
| write | uns/artifact_clusters | table | per-cluster cell count, doublet fraction, p-value, probability, suggested action |
| write | uns/artifact_markers | table | unique and exclusive genes per cluster, with statistics |
| write | uns/artifact_params | dict | parameters used, for reproducibility |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "composite" | `composite`, `doubletdecon_rescue`, `gmm_demux_phony` | composite is the proposed default; doubletdecon_rescue and gmm_demux_phony are published criteria. gmm_demux_phony needs hashing_key. |
| `cluster_key` | string | "cluster" | — | obs column holding the fixed cluster partition to evaluate. |
| `call_key` | string | "doublet_call_scrublet" | — | obs column of per-cell doublet calls from doublets.doublet_call_thresholding. |
| `hashing_key` | string/null | null | — | obs column of sample-barcode calls; enables the hashing channel and gmm_demux_phony. |
| `composite` | object | — | — | Options for the default composite method. |
| `composite.alpha` | number | 0.01 | min 0; max 1 | Significance level of the one-sided hashing binomial test; matches the GMM-Demux phony threshold. |
| `composite.tau_multiplet_fraction` | number/null | null | min 0; max 1 | Hashing-labelled multiplet fraction defining an artifact cluster; required when hashing_key is set. No literature default. |
| `composite.embedding_key` | string | "X_pca" | — | obsm key of the embedding used for segment distance to parent pairs. |
| `composite.exclusive_pairs` | array | [] | — | Pairs of mutually exclusive lineage genes; empty disables the exclusive-marker feature. |
| `doubletdecon` | object | — | — | Options for doubletdecon_rescue. |
| `doubletdecon.min_unique_genes` | integer | 4 | min 1 | Unique genes a candidate cluster needs, against both parents, to be rescued as real. |
| `doubletdecon.rhop` | number | 1 | min 0 | Multiplier of the SD in the medoid-correlation blacklist cutoff. |
| `gmm_demux` | object | — | — | Options for gmm_demux_phony. |
| `gmm_demux.phony_alpha` | number | 0.01 | min 0; max 1 | Significance level for the pure and phony labels, as in GMM-Demux. |
| `gmm_demux.confidence_threshold` | number | 0.8 | min 0; max 1 | Minimum posterior confidence for a hashing call, as in GMM-Demux. |
| `gmm_demux.ambiguous_rate` | number | 0.05 | min 0; max 1 | Chance that a phony droplet joins a pure cluster; the GMM-Demux command-line default. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

`composite` reads `alpha` and `tau_multiplet_fraction` only for the hashing channel, and `tau_multiplet_fraction` must be set when `hashing_key` is set. `doubletdecon` options apply only to `doubletdecon_rescue`; `gmm_demux` options apply only to `gmm_demux_phony`, which requires `hashing_key`. An empty `exclusive_pairs` uses the three-feature model trained without that feature. The partition is an input; the tool never chooses clustering resolution.

## 7. MCP tool

Tool name `singlet_doublets_artifact_cluster_detection` (definition in `tasks/mcp/singlet_doublets_artifact_cluster_detection.json`). Example call and result; null values are placeholders.

```json
{"dataset": "pbmc.singlet", "cluster_key": "leiden", "call_key": "doublet_call_scrublet"}
{"dataset": "pbmc.singlet", "status": "completed", "wrote": ["obs/artifact_cluster_call", "obs/unique_gene_rescue", "uns/artifact_clusters", "uns/artifact_markers", "uns/artifact_params"], "summary": {"method_used": "composite", "n_clusters": null, "n_artifact": null, "n_unclear": null, "n_rescued": null}, "provenance_id": "prov_placeholder", "job_id": null}
```

Long-running: no; cost is linear in cells and quadratic in clusters. Stochastic: no; output is deterministic given inputs. Dry run returns the estimate for the given cell and cluster counts and writes nothing.

## 8. Benchmarks

Shared protocol. Every method receives the same counts, partition, embedding and per-cell calls. Hashing labels enter only the truth; no comparator receives them. Clustering resolution, number of PCs and parent identities are fixed before any method is applied. Parent cells used to build references are held out from evaluation. Precision and recall are reported at the pre-set $\tau$ and as a sweep over a fixed grid. A metric with a zero denominator is NA.

### B1. Hashing-defined artifact clusters

- **Goal**: match calls to clusters dominated by inter-sample multiplets from sample barcodes.
- **Ground truth**: orthogonal measurement (sample barcoding). A cell is a multiplet when its barcode call is multi-sample. The estimand is $f_C$, the multiplet fraction over all cells in $C$ with singlets included, and the cluster label is $A_C=\mathbb{1}[f_C\ge\tau]$. Same-sample multiplets are unlabelled, so $f_C$ is a lower bound.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Xin et al. 2020 PBMC dataset with sample barcodes | [R3] | scRNA-seq; PBMC; species and size — | — | Accession — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| artifact_cluster_precision | called artifact clusters with $f_C\ge\tau$, over all called clusters; NA if none is called | maximize | primary | — |
| artifact_cluster_recall | clusters with $f_C\ge\tau$ that are called, over those clusters; NA if none exists | maximize | primary | — |
| cell_level_multiplet_auroc | rank AUROC of the per-cell artifact score against the multi-sample label | maximize | guardrail | — |

- **Comparators**: `composite` (expression channel only); `doubletdecon_rescue` with and without rescue; the enrichment baseline on DoubletFinder and scDblFinder calls; a no-call baseline.
- **Protocol**: $\tau$ is fixed before any method is applied; the precision-recall curve over a fixed grid is reported.
- **Acceptance criterion**: proposed, not from the literature. Recall at least 0.70 and precision at least 0.80 at the pre-set $\tau$; `composite` precision above the baseline at equal recall.
- **Known pitfalls**: hashing leaking into clustering or features inflates precision. Split artifact clusters lower recall for every method.

### B2. Planted doublets against real intermediate states (proposed)

- **Goal**: test whether a method separates doublet clusters from real intermediate states, which no published benchmark uses as negatives.
- **Ground truth**: exact labels for planted clusters; real trajectory cells, with no planted barcodes, as negatives. Per-cluster estimand: planted barcode fraction $f^{pl}_C$, with artifact meaning $f^{pl}_C\ge\tau$. Retention is per cell.
- **Generator**: (1) pick annotated parent pairs across centroid distances; (2) sum two parent cells' UMI vectors at a fixed mixing ratio; (3) set planted fractions near $\lambda/2$ over a loading-rate grid; (4) add negatives from a fixed position between annotated trajectory states; (5) hold out reference parents.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Singlet catalogue annotated subset | internal catalogue | scRNA-seq; size — | — | Parent pools, steps 1–3 |
| dynbenchmark trajectory datasets | [R8] | scRNA-seq trajectories; size — | — | Negatives for step 4 |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| planted_artifact_recall | planted clusters called artifact, over planted clusters; NA if none | maximize | primary | — |
| intermediate_false_artifact_rate | intermediate-state clusters called artifact, over those clusters; NA if none | minimize | primary | — |
| transitional_retention | intermediate-state cells kept after removal | maximize | guardrail | — |

- **Comparators**: `doubletdecon_rescue` (rescue on and off); enrichment baseline on DoubletFinder and scDblFinder calls; `composite`; `composite` without geometry.
- **Protocol**: planted rates and parent distances vary; the headline is the lowest planted rate yielding at least ten planted clusters.
- **Acceptance criterion**: proposed. False-artifact rate at most 0.10 and planted recall at least 0.80 at that rate.
- **Known pitfalls**: parents shared with references leak information. Homotypic planted doublets cap recall by design; trajectory labels are model-derived.

### P1. Performance and scaling

Wall time, peak resident memory and cells per second at $10^4$, $10^5$ and $10^6$ cells, on CPU for all methods and on CUDA for the per-cluster statistics of `composite`. Comparators are DoubletDecon rescue [R9], DoubletFinder [R11], scDblFinder with clusters on and off [R12] and the enrichment baseline. Hold fixed: cluster count, number of PCs, thread count and hardware. DoubletDecon's rescue uses automatic core detection by default [R9]. Report measured values only.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `doublets.expression_doublet_scoring`: Expression-based per-cell doublet scoring
  - `doublets.doublet_call_thresholding`: Doublet score-to-call thresholding
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
  - `dim-reduction.normalized_cell_embedding`: Cell embedding from normalized expression (PCA and alternatives)
- **Feeds**:
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
- **Reads**: `layers/counts`, `obsm/X_pca`, `obs/<cluster_key>`, `obs/<call_key>`, `obs/<hashing_key>`
- **Writes**: `obs/artifact_cluster_call`, `obs/unique_gene_rescue`, `uns/artifact_clusters`, `uns/artifact_markers`, `uns/artifact_params`
<!-- CHAINING:AUTO:END -->

Part of the doublet-removal workflow: applied after per-cell calling and clustering, and before annotation and marker ranking.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The 2025 multiplets study [R5] rests on its record rather than its full text, and its author list, datasets and numbers are not given here. The Xin 2020 accession and data terms are not given. GMM-Demux line numbers refer to an unpinned copy. The DoubletDecon validation claims (synthetic, mixed-species, genetic and hashing doublets) and the downstream differential-expression criterion of Xi and Li [R7] have not been read in full. The marker co-expression warning attributed to DoubletFinder is absent from its README and is not used.
- **Unsettled literature.** No published benchmark uses real intermediate states as negatives, so the geometry criterion is untested at cluster level. Homotypic doublets stay invisible to expression criteria, and hashing counts are a lower bound, so the true artifact rate and the calibration of any hashing-anchored score are unknown. A consistency check of differential expression against hashing-clean singlets (top-N overlap) is folded here: its test and N must be fixed in advance.
- **Technical and data risks.** Segment distance is valid only where mixing is near-additive, so it must be measured on size-normalised counts. The GMM-Demux phony test divides counts by the capture rate before a binomial test, so its scaling needs re-derivation before any port. Whether the catalogue carries hashing or genotype labels is unknown, which decides whether B1 can be built in house. Exclusive pairs are tissue-specific, ambient RNA can mimic mixing, and clustering resolution changes the answer.
- **First experiment.** Apply B1 to the Xin 2020 hashed PBMC data with hashing withheld from every method, and compare `composite` (expression channel) with the enrichment baseline at one pre-set $\tau$. This tests the central claim before the planted generator is built.

## 11. References

R1. DePasquale EAK, Schnell DJ, Van Camp PJ, et al. DoubletDecon: Deconvoluting Doublets from Single-Cell RNA-Sequencing Data. *Cell Reports* 2019;29:1718-1727.e8. doi:10.1016/j.celrep.2019.09.082 — verified (corpus)
R2. McGinnis CS, Murrow LM, Gartner ZJ. DoubletFinder: Doublet Detection in Single-Cell RNA Sequencing Data Using Artificial Nearest Neighbors. *Cell Systems* 2019. doi:10.1016/j.cels.2019.03.003 — verified (corpus)
R3. Xin H, et al. GMM-Demux: sample demultiplexing, multiplet detection, experiment planning, and novel cell-type verification in single cell sequencing. *Genome Biology* 2020;21:188. doi:10.1186/s13059-020-02084-2 — verified (corpus)
R4. Stoeckius M, Zheng S, Houck-Loomis B, et al. Cell hashing with barcoded antibodies enables multiplexing and doublet detection for single cell genomics. *Genome Biology* 2018;19:224. — partial (corpus)
R5. Multiplets in scRNA-seq data: extent of the problem and efficacy of methods for removal. *PLOS ONE* 2025. doi:10.1371/journal.pone.0333687 — partial (search)
R6. Germain PL, Lun A, Garcia Meixide C, Macnair W, Robinson MD. Doublet identification in single-cell sequencing data using scDblFinder. *F1000Research* 2022. doi:10.12688/f1000research.73600.2 — verified (corpus)
R7. Xi NM, Li JJ. Benchmarking Computational Doublet-Detection Methods for Single-Cell RNA Sequencing Data. *Cell Systems* 2021. doi:10.1016/j.cels.2020.11.008 — verified (corpus)
R8. Saelens W, Cannoodt R, Todorov H, Saeys Y. A comparison of single-cell trajectory inference methods. *Nature Biotechnology* 2019. doi:10.1038/s41587-019-0071-9 — verified (corpus)
R9. EDePasquale/DoubletDecon, R package version 1.1.6 at commit 66c6f26 (DESCRIPTION, R sources and README release notes). — partial (repo)
R10. CHPGenetics/GMM-demux, Python package (README, LICENSE and GMM_Demux source; repository copy, not pinned to a commit). — partial (repo)
R11. chris-mcginnis-ucsf/DoubletFinder, R package version 2.0.6 (README and DESCRIPTION). — partial (repo)
R12. plger/scDblFinder, R package version 1.27.12 (README, DESCRIPTION and R sources). — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/EDePasquale/DoubletDecon | Erica A. K. DePasquale (maintainer per DESCRIPTION) | MIT (DESCRIPTION; no LICENSE file at repository root) | rescue step and cluster blacklist | reimplement (licence from metadata only) |
| https://github.com/CHPGenetics/GMM-demux | Hongyi Xin | MIT (LICENSE file, copyright 2019 Hongyi Xin) | phony-type test on hashing counts | port |
| https://github.com/chris-mcginnis-ucsf/DoubletFinder | Chris McGinnis (maintainer per DESCRIPTION) | CC0 (DESCRIPTION; no LICENSE file) | comparator; homotypic adjustment formula | callout |
| https://github.com/plger/scDblFinder | Pierre-Luc Germain and co-authors (Authors@R in DESCRIPTION) | GPL-3 (LICENSE file) | comparator; cluster-aware mode | callout |
