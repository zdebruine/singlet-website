---
id: cross-species.ortholog_assignment
title: Gene orthology assignment across species
area: cross-species
scope: extended
paradigm: hybrid
literature_status: routine
priority: P2
depends_on: [harmonization.annotation_release_reconciliation, harmonization.gene_identifier_mapping]
feeds: [cross-species.one_to_many_ortholog_harmonization, cross-species.cell_type_correspondence, cross-species.joint_embedding_integration, cross-species.expression_conservation]
reads: [uns/proteomes/<species>, uns/annotation/<species>, uns/orthology/precomputed]
writes: [uns/orthology/pairs, uns/orthology/orthogroups, varm/ortholog_<species>]
devices: [cpu, cuda]
mcp_tool: singlet_cross_species_ortholog_assignment
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Gene orthology assignment across species

> Assigns orthologous gene pairs between species and labels each as one-to-one, one-to-many or many-to-many, from a precomputed Compara table or from graph and tree inference, with a calibrated pair classifier as the proposed model-based scorer.

## 1. Question

Which gene in each species corresponds to which gene in another species, and is each relation one-to-one, one-to-many or many-to-many? Inputs are protein sequences with gene identifiers for two or more species, or an exported orthology table. Outputs are a pair table with relation type and support, and orthogroup membership. A correct answer matches the orthology relation of the true gene tree, which is the relation the reference benchmarks encode.

## 2. Why this task matters and where the field stands

Cross-species analyses (expression comparison, label transfer, joint embedding) take a gene correspondence as input, so every downstream score inherits its errors. For one-to-one pairs between well-annotated species the status is **routine**: precomputed resources and best-hit pairs are established practice. Three problems remain open.

- **Relation type.** Typed calls come from gene-tree reconciliation in Ensembl Compara [R2][R8] and from the tree stage of OrthoFinder [R3][R5]. Pair-level precision and recall do not score relation type [R1].
- **Rooting.** Duplication and speciation labels depend on where the gene tree is rooted, and species-tree rooting from duplication events is itself an inference [R7].
- **Truth.** The accepted benchmark rests on curated reference orthologs [R1]. Accuracy outside the curated clades is not measured by it.

A 2023 benchmark of cross-species integration strategies [R13] addresses integration, not ortholog calling.

## 3. Theory and insight

Orthology is defined on a gene tree $T$ relative to the species tree $S$. Leaves $x$ and $y$ are orthologous when their last common ancestor is a speciation node, and paralogous when it is a duplication [R10][R11]:

$$o(x,y)=1 \iff \mathrm{type}\big(\mathrm{lca}_T(x,y)\big)=\text{speciation}$$

A node is a duplication when its two child clades share a species, $S(c_1)\cap S(c_2)\neq\emptyset$, where $S(c)$ is the species set under child $c$ [R9]. This holds when $T$ is correctly rooted, $S$ is known and no horizontal transfer occurred.

Practical methods replace $T$ with a proxy built from pairwise similarity. The reciprocal best hit takes a bit score $s(i,j)$, optionally normalised by self-scores:

$$\mathrm{RBH}(i,j)=\mathbb 1\!\left[j=\arg\max_{j'}s(i,j')\right]\mathbb 1\!\left[i=\arg\max_{i'}s(i',j)\right]$$

This is a one-to-one signal only when no lineage-specific duplication occurred since the split, and it cannot represent one-to-many or many-to-many relations. Graph clustering applies Markov clustering [R12] to a column-stochastic similarity matrix $M$, alternating expansion and inflation:

$$M\leftarrow \mathrm{Infl}_r\!\left(M^{e}\right),\qquad \mathrm{Infl}_r(M)_{ij}=\frac{M_{ij}^{\,r}}{\sum_k M_{kj}^{\,r}}$$

Larger $r$ gives finer clusters, and the expansion step requires $M$ to stay column-stochastic.

Estimands, each with its normalisation:

- Pair truth $o(x,y)$ is a binary label per cross-species leaf pair, counted unweighted over the reference leaf set.
- Pairwise precision $P$, recall $R$ and $F_1=2PR/(P+R)$ compare the predicted pair set $\hat O$ with the reference set $O$, both restricted to shared proteins.
- The partner count $k$ is the number of partners a gene has in one target species. A pair is one-to-one when both genes have $k=1$, one-to-many when one has $k=1$ and the other $k>1$, and many-to-many when both exceed one.
- Orthogroup purity is the fraction of orthogroups that are monophyletic in the true tree. Discordance is the fraction of gene trees with a supported node that contradicts $S$.
- The classifier output is a calibrated probability per candidate pair.

**Proposed model.** A logistic pair classifier $p_\theta(o_{ij}=1\mid\phi_{ij})=\sigma(\theta^\top\phi_{ij})$ scores candidate pairs from features $\phi_{ij}$: bit-score ratio, reciprocal coverage and tree consistency. It is trained on simulated labels and recalibrated with Platt or isotonic regression, and its calibration holds only within the clades in training. No published learned pairwise ortholog model is cited here, so the classifier is a proposal.

**Failure modes by family.** Graph methods are fast for one-to-one pairs. Lineage-specific duplications create one-to-many relations that they miss or collapse, and fusions, fissions and incomplete gene models inflate many-to-many calls. Tree methods resolve types, but long-branch attraction and mis-rooting invert speciation and duplication calls [R7]. Precomputed resources share sources, so their agreement overstates accuracy.

**Insight.** Graph methods suffice for one-to-one pairs, typing needs trees, and consensus among resources is not truth. Only planted simulation or curated reference sets separate method error from resource circularity, and accuracy depends on the clade and the benchmark.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Ensembl Compara gene trees (precomputed) | hybrid | Sequence clustering and gene trees, reconciled with the species tree to label one-to-one, one-to-many and many-to-many pairs | [R2][R8] |
| OrthoFinder | hybrid | Similarity graph clustered into orthogroups, per-orthogroup gene trees, species-tree rooting and duplication-aware calls; an assign-only mode adds genes to existing orthogroups | [R3][R4][R6] |
| OMAmer | heuristic | Alignment-free mapping of query proteins to ancestral OMA subfamilies with evolution-informed k-mers | — |
| eggNOG-mapper | heuristic | Transfers annotation from fine-grained eggNOG orthologs, avoiding close paralogs | — |
| HCOP consensus | heuristic | Keeps a human-to-target pair when at least `min_evidence` predictors agree | — |

The published standards are the Ensembl Compara and OrthoFinder calls. OMAmer, eggNOG-mapper and HCOP consensus are heuristic baselines. Reciprocal best hits are defined in section 3 and have no row, since no implementation is cited. OMA and InParanoid have no row because their primary sources are not in this document (section 10).

Defaults for the methods singlet implements:

| Method | Parameter | Value | Source |
|---|---|---|---|
| OrthoFinder | MCL inflation (`mclInflation`) | 1.2 | `src/orthofinder/__init__.py:15` @ c85f003 |
| OrthoFinder | FastME flags | `-N -w O`; adds `-s` when n < 1000 | `src/orthofinder/tools/dendroblast.py:191` @ c85f003 |
| HCOP consensus (liana-py) | `translate_column` one_to_many | 1 | `src/liana/resource/_orthology.py` (`translate_column` signature), commit — |
| HCOP consensus (liana-py) | HCOP download base | `https://storage.googleapis.com/public-download-files/hcop` | `src/liana/resource/_orthology.py` (`_HCOP_BASE`), commit — |

## 5. Proposed singlet approach

**Routes.** `compara_precomputed` is a callout: singlet reads an exported Compara table from `uns/orthology/precomputed` and does not port the Compara API. `orthofinder` (orthogroup and gene-tree steps, with the FastME flags of section 4), `omamer` and `hcop_consensus` are reimplemented from documented behaviour and, for OrthoFinder, its papers, with no code copied. `eggNOG-mapper` is a callout comparator outside the enum.

**Model.** The classifier of section 3 replaces the heuristic pair score and feeds the typing rule unchanged. It is trained on B2 training replicates and evaluated on B1 with clades held out. It is rejected if the B1 or B2 acceptance criterion fails, or if expected calibration error on held-out clades exceeds 0.05 (a proposed threshold). Until then the default stays the published standard.

**Stack.** PyTorch trains the logistic or small MLP classifier with cross-entropy and fits the recalibration. Hard-coded CUDA with cuSPARSE covers only the MCL expansion and inflation over sparse matrices, and batched pair-feature scoring. The all-versus-all search stays on CPU or an external engine in the first version. No speed-up is claimed.

**Memory.** MCL needs the whole similarity graph in memory. Pair scoring can stream over species pairs.

**Defaults an agent uses.** `compara_precomputed`, `one_to_many_max` at the liana value of section 4, `device` auto, and the OrthoFinder defaults of section 4 when `orthofinder` is chosen.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/proteomes/<species> | table | Protein sequences per species, with release identifier |
| read | uns/annotation/<species> | table | Gene identifiers and symbols per species, with release |
| read | uns/orthology/precomputed | table | Optional exported Compara or HCOP table |
| write | uns/orthology/pairs | table | Columns species_a, gene_a, species_b, gene_b, type, score, method |
| write | uns/orthology/orthogroups | table | Columns gene, species, orthogroup_id |
| write | varm/ortholog_<species> | int32 array | Partner indices in one target species, width `one_to_many_max`, −1 where absent |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle with uns/proteomes per species, or a .singlet path or URI. |
| `species` | array | — | — | Species keys in uns/proteomes to include; omit to use every species in the dataset. |
| `method` | string | "compara_precomputed" | `compara_precomputed`, `orthofinder`, `omamer`, `hcop_consensus` | Orthology route; compara_precomputed is the default and the published standard. |
| `one_to_many_max` | integer | 1 | min 1 | Maximum partners per gene kept in the varm index; the pair table keeps every partner. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA only for MCL and batched pair scoring. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `orthofinder` | object | — | — | Options used when method is orthofinder. |
| `orthofinder.mcl_inflation` | number | 1.2 | > 1 | MCL inflation for graph clustering; higher values give finer orthogroups. |
| `orthofinder.assign_only` | boolean | false | — | Add genes to existing orthogroups by the SHOOT-based assign mode, without a full all-versus-all search. |
| `omamer` | object | — | — | Options used when method is omamer. |
| `omamer.database` | string | — | — | OMAmer reference database handle; required when method is omamer. |
| `hcop_consensus` | object | — | — | Options used when method is hcop_consensus. |
| `hcop_consensus.min_evidence` | integer | — | min 1 | Number of predictors that must agree to keep a pair; required for this method. |
| `compara_precomputed` | object | — | — | Options used when method is compara_precomputed. |
| `compara_precomputed.ensembl_release` | integer | — | min 1 | Ensembl release of the exported table; must match the proteome release. |
<!-- PARAMS:AUTO:END -->

Parameters apply by method. `mcl_inflation` and `assign_only` apply to `orthofinder` only, `database` is required for `omamer`, and `min_evidence` for `hcop_consensus`. `ensembl_release` must match the proteome release, because a mismatch drops genes silently. `one_to_many_max` caps only the varm index; the pair table keeps every partner.

## 7. MCP tool

Tool name `singlet_cross_species_ortholog_assignment` (definition in `tasks/mcp/singlet_cross_species_ortholog_assignment.json`). Example call and compact results, with placeholders instead of measured values:

```json
{"dataset": "human_mouse.singlet", "species": ["human", "mouse"], "method": "orthofinder", "orthofinder": {"assign_only": false}, "dry_run": true}
```

```json
{"dataset": "human_mouse.singlet", "status": "dry_run", "wrote": [], "estimate": {"seconds": "<float>", "peak_memory_gb": "<float>", "device": "cpu"}}
```

```json
{"dataset": "human_mouse.singlet", "status": "completed", "wrote": ["uns/orthology/pairs", "uns/orthology/orthogroups", "varm/ortholog_mouse"], "summary": {"pairs": "<int>", "types": {"one_to_one": "<int>", "one_to_many": "<int>", "many_to_many": "<int>"}, "orthogroups": "<int>", "unmatched_genes": "<int>", "method": "orthofinder"}, "provenance_id": "<id>", "job_id": null}
```

Long-running: `orthofinder` may return `queued` with a `job_id`; lookup methods complete inline. Stochastic: no. Dry run: returns estimated seconds, peak memory and device only.

## 8. Benchmarks

Shared protocol: pairs are sets of cross-species gene pairs restricted to genes present in both proteome sets. Each method's pairs are scored as delivered, with no added threshold, and a repeated pair counts once. Methods share proteomes, release identifiers and hardware, and paired comparisons are made per replicate with fixed seeds. Type accuracy compares partner counts per gene with the truth. Comparator versions are the commits in section 12.

### B1. QfO reference benchmark (published)

- **Goal**: Compare precision and recall of pairwise ortholog calls against curated reference orthology.
- **Ground truth**: Expert labels from the curated reference sets of the QfO benchmark service [R1]. A pair is labelled 1 when it is in the reference set and 0 otherwise, over pairs whose genes both occur in the reference proteomes; counts are unweighted.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| QfO reference proteomes and orthology sets | [R1]; QfO benchmark service | Protein sequences; 20 benchmarks reported in [R1] | — | Identifiers as given by the service |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pairwise precision | $\lvert\hat O\cap O\rvert/\lvert\hat O\rvert$ | maximize | primary | [R1] |
| Pairwise recall | $\lvert\hat O\cap O\rvert/\lvert O\rvert$ | maximize | primary | [R1] |
| Pairwise F1 | $2PR/(P+R)$ | maximize | guardrail | [R1] |

- **Comparators**: Enum methods the service accepts, with Ensembl Compara and OrthoFinder as published standards.
- **Protocol**: Apply each method to the reference proteomes, export pairs per [R1], and score against the same reference set without a tuned threshold.
- **Acceptance criterion** (proposed, not from the literature): singlet F1 is at most 0.01 below the best comparator's, and singlet precision at most 0.02 below that comparator's.
- **Known pitfalls**: Pair scores ignore relation type unless types are scored separately (section 3). A reference set derived from a compared resource inflates its score.

### B2. Planted gene trees with known orthology (proposed)

- **Goal**: Measure pair-level and type-level accuracy when orthology is known by construction.
- **Ground truth**: Planted simulation: $o(x,y)$ from the full gene tree by the speciation rule (section 3), before losses; pairs with a lost leaf are removed.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated species and gene trees with sequences | Recipe below | Simulated proteins; 50 or more replicates per setting | — | Split before fitting |

Recipe: (1) sample a species tree; (2) simulate gene trees under a birth-death duplication and loss process; (3) label $o(x,y)$ on each full tree; (4) delete lost leaves and evolve sequences with a fixed substitution model; (5) split replicates into training and held-out sets with fixed seeds.

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Pairwise F1 against planted orthology | F1 of section 3 over leaf pairs | maximize | primary | — |
| Orthology-type accuracy | Fraction of genes with the correct type per target species; confusion matrix | maximize | primary | — |
| Orthogroup purity | Fraction of orthogroups monophyletic in the true tree | maximize | guardrail | — |

- **Comparators**: OrthoFinder; OMAmer assignment reduced to pairs; reciprocal best hits (section 3) as a control.
- **Protocol**: Same sequences for all methods; paired per-replicate F1 differences on held-out replicates.
- **Acceptance criterion** (proposed): singlet F1 is at least OrthoFinder's (one-sided sign test across replicates, $p<0.05$); type accuracy reported per setting.
- **Known pitfalls**: Duplication and sequence models set the difficulty. The planted truth ignores gene-tree estimation error.

### P1. Performance and scaling

Scale is the number of proteomes of one clade (2, 10 and 50), with protein counts from the release, not cells. Measured: wall-clock time, peak memory and disk use, with the all-versus-all search and clustering stages reported apart from the tree stage. Held fixed: thread count, search engine and sensitivity, hardware, proteome set and release identifiers. Comparators: OrthoFinder full analysis and its assign-only mode [R3][R6], OMAmer assignment, eggNOG-mapper, and the Compara lookup at query time only. Acceptance criterion (proposed): singlet wall-clock is at most 1.5 times OrthoFinder's at 10 proteomes on identical hardware. These are design points, not literature values.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.annotation_release_reconciliation`: Reference annotation and assembly release reconciliation
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
- **Feeds**:
  - `cross-species.one_to_many_ortholog_harmonization`: Expression harmonization for one-to-many orthologs
  - `cross-species.cell_type_correspondence`: Cross-species cell-type correspondence and homology scoring
  - `cross-species.joint_embedding_integration`: Cross-species integration into a shared embedding
  - `cross-species.expression_conservation`: Conserved versus divergent expression of orthologs within matched cell types
- **Reads**: `uns/proteomes/<species>`, `uns/annotation/<species>`, `uns/orthology/precomputed`
- **Writes**: `uns/orthology/pairs`, `uns/orthology/orthogroups`, `varm/ortholog_<species>`
<!-- CHAINING:AUTO:END -->

This task is the entry step of cross-species workflows: its pair table feeds cell-type correspondence, joint embedding and expression conservation.

## 10. Risks, pitfalls and open questions

- **Unresolved sources.** The Herrero et al. DOI is 10.1093/database/baw053 in the PMC and publisher records, while other records give 10.1093/database/bav096, and the author list is unverified beyond the title. The eggNOG database paper (DOI 10.1093/nar/gkaf1249, from the eggNOG-mapper README) has unknown title and authors, and the Compara type field names are from memory. The primary papers of OMAmer, HCOP and reciprocal best hits are absent, so OMAmer and HCOP appear without a reference. OMA, InParanoid and biomaRt are omitted. Memory-only references R8 to R12 have no DOI.
- **Licences and identity.** The OrthoFinder and eggNOG-mapper licence statements conflict, and the liana-py licence and author list are unknown. Section 12 gives each source's statements, and the routes follow from them.
- **Unsettled literature.** No accepted convention reports one-to-many and many-to-many relations, and no published learned pairwise ortholog model is cited, so the classifier is untested. Compara, OMA, eggNOG and HCOP draw on overlapping predictors, so their agreement overstates accuracy. Two benchmarks are left out: a species-tree consistency score needs a fixed clade and support threshold, and a human-mouse consensus needs a third resource independent of HCOP and a stated HCOP release. QfO dataset identifiers, sizes, licences and tie handling are defined by the service documentation and are not restated here.
- **Technical risks and first experiment.** Gene-model release drift changes identifiers and calls, so every table records its release. The `min_evidence` default is unknown and is set per table. The simulator and sequence-evolution model are chosen before any fitting, since they set how hard the search is. First experiment: evaluate the four enum methods on the QfO reference proteomes of one clade, then fit the pair classifier on B2 training replicates and test its calibration on held-out QfO clades.

## 11. References

R1. Altenhoff AM, et al. Standardized benchmarking in the quest for orthologs. *Nature Methods* 2016;13(5):425-430. doi:10.1038/nmeth.3830 — partial (search)
R2. Herrero J, Muffato M, Beal K, et al. Ensembl comparative genomics resources. *Database* 2016:baw053. doi:10.1093/database/baw053 — partial (search)
R3. Emms DM, Kelly S. OrthoFinder: phylogenetic orthology inference for comparative genomics. *Genome Biology* 2019;20:238. doi:10.1186/s13059-019-1832-y — partial (repo)
R4. Emms DM, Kelly S. OrthoFinder: solving fundamental biases in whole genome comparisons dramatically improves orthogroup inference accuracy. *Genome Biology* 2015;16:157. doi:10.1186/s13059-015-0721-2 — partial (repo)
R5. Emms DM, Liu Y, Belcher L, Holmes J, Kelly S. OrthoFinder: scalable phylogenetic orthology inference for comparative genomics. *bioRxiv* 2025 (preprint). doi:10.1101/2025.07.15.664860 — partial (repo)
R6. Emms DM, Kelly S. SHOOT: phylogenetic gene search and ortholog inference. *Genome Biology* 2022;23:85. doi:10.1186/s13059-022-02652-8 — partial (repo)
R7. Emms DM, Kelly S. STRIDE: species tree root inference from gene duplication events. *Molecular Biology and Evolution* 2017;34(12):3267-3278. doi:10.1093/molbev/msx259 — partial (repo)
R8. Vilella AJ, Severin J, Ureta-Vidal A, Heng L, Durbin R, Birney E. EnsemblCompara GeneTrees: complete, duplication-aware phylogenetic trees in vertebrates. *Genome Research* 2009;19(2):327-335. — unverified (memory)
R9. Zmasek CM, Eddy SR. A simple algorithm to infer gene duplication and speciation events on a gene tree. *Bioinformatics* 2001;17(9):821-828. — unverified (memory)
R10. Fitch WM. Distinguishing homologous from analogous proteins. *Systematic Zoology* 1970;19:99-113. — unverified (memory)
R11. Koonin EV. Orthologs, paralogs, and evolutionary genomics. *Annual Review of Genetics* 2005;39:309-338. — unverified (memory)
R12. Van Dongen S. Graph clustering by flow simulation. PhD thesis, Utrecht University, 2000. — unverified (memory)
R13. —. Benchmarking strategies for cross-species integration of single-cell RNA sequencing data. *Nature Communications* 2023. doi:10.1038/s41467-023-41855-w — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/Ensembl/ensembl-compara | Ensembl team | Apache-2.0 (LICENSE file; pyproject states Apache License 2.0) | Compara API and SQL schema, release/116 at 4038708 | callout |
| https://github.com/OrthoFinder/OrthoFinder | David Emms, Jonathan Holmes, Laurence Belcher, Yi Liu (pyproject.toml); Steve Kelly (PI, README) | Conflict: LICENSE file GPL-3.0; pyproject.toml LGPL-3.0-only | Orthogroups, gene trees, rooting and assign-only mode, at c85f003 | reimplement |
| https://github.com/DessimozLab/omamer | Victor Rossier, Alex Warwick Vesztrocy (setup.py) | LGPL-3.0 (LICENSE file; setup.py LGPLv3) | Subfamily assignment, at b744683 | reimplement |
| https://github.com/eggnogdb/eggnog-mapper | Jaime Huerta-Cepas (setup.cfg) | Conflict: LICENSE.txt AGPL-3.0; setup.cfg GPLv3 | Fine-grained ortholog transfer, at b3757a6 | callout |
| https://github.com/saezlab/liana-py | — | BSD (LICENSE) | HCOP download base, predictor filter and translate defaults | reimplement |
