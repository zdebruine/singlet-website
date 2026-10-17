---
id: communication.lr_resource_curation
title: Ligand-receptor resource curation and harmonisation
area: communication
scope: core
paradigm: heuristic
literature_status: contested
priority: P1
depends_on: [harmonization.gene_identifier_mapping, cross-species.ortholog_assignment]
feeds: [communication.lr_interaction_scoring, communication.interaction_significance_calibration, communication.spatial_lr_scoring, communication.consensus_interaction_ranking]
reads: [uns/lr_resource_sources, uns/orthology_map, var/feature_symbol]
writes: [uns/lr_resource, uns/lr_resource_meta]
devices: [cpu]
mcp_tool: singlet_communication_lr_resource_curation
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Ligand-receptor resource curation and harmonisation

> Builds one directed, complex-aware ligand-receptor table per species from pinned resource snapshots, with per-row resource counts and provenance, so that every later communication step tests the same explicit set of interactions.

## 1. Question

Which directed ligand-receptor interactions should define the candidate set for a species: heteromeric complexes with their subunits, orientation, non-protein ligands, and the number of resources supporting each pair? Inputs are curated interaction tables, identifier tables and orthology tables. The output is one harmonised table in which every row traces to named resources and carries an integer support count. A correct table has an explicit inclusion rule and no unexplained rows, because no gold-standard set exists to score it against.

## 2. Why this task matters and where the field stands

Every communication method starts from a ligand-receptor table, and the table changes what is predicted. Dimitrov et al. compare methods and resources for this inference [R1]. Curation is therefore a first-order decision, not a preprocessing detail.

The status is **contested**. No gold-standard set exists. Evaluations report limited agreement between methods and resources [R1, R2, R3], and frameworks that evaluate and integrate tools exist [R4]; a catalogue of tools and databases is also maintained [R5]. The Open Problems task README states that Dimitrov et al. [R1] built an inferred truth from spatial proximity of cell types and downstream cytokine activities, and that both are approximations with their own assumptions. LIANA+ builds its consensus from several of these resources [R6], so its output inherits what its constituents contain.

Open problems, each unresolved:

- **Truth.** Overlap between resources measures agreement, not correctness, and shared literature makes agreement look like evidence.
- **Complexes.** Resources define subunit lists and combine subunit levels differently (section 3).
- **Orientation and roles.** Curated consensus tables have held a flipped pair and a transcription factor allowed as receptor; LIANA's changelog records both corrections (section 12).
- **Non-protein ligands.** Metabolites and lipids are absent from protein tables. MetalinksDB [R8] estimates metabolite abundance from enzyme and transporter expression, and LIANA's estimator assumes a linear link and independent metabolites.
- **Species.** Mouse tables lose pairs under one-to-one orthology.

## 3. Theory and insight

A resource $r$ is a set of ordered keys $K_r$ after HGNC normalisation. Complex rows are tuples of subunit sets, split on the complex separator. Candidate interactions over ordered cell-type pairs are

$$\mathcal{P}=\{(s,t,L,R):\ s,t\in\mathcal{C},\ (L,R)\in\textstyle\bigcup_r K_r\},$$

where $(L,R)$ and $(R,L)$ are distinct objects. This is set construction with no statistics, valid in any regime.

**Estimands.** For each key $k$ the harmonised table reports $n_k=\sum_r\mathbb{1}[k\in K_r]$, with each resource counted once and orientation kept. The heuristic rule keeps $k$ when $n_k\ge m$. The default $m=1$ is the union with counts; larger $m$ is a stricter consensus with no fitted parameters. Overlap is measured exactly on ordered keys:

$$J(A,B)=\frac{|A\cap B|}{|A\cup B|},\qquad C_{A\subset B}=\frac{|A\cap B|}{|A|}.$$

Containment is asymmetric, and both values hold only for the normalised symbols used to build the keys.

**Complex value.** A complex's group expression is a function of its subunit group means $\bar E_k$. LIANA's default is the minimum,

$$\bar E_C=\min_{k\in\mathcal S_C}\bar E_k,$$

and CellChat uses the geometric mean,

$$\bar E_C=\Big(\prod_{k\in\mathcal S_C}\bar E_k\Big)^{1/|\mathcal S_C|}.$$

Both vanish when a subunit is absent, and the minimum never exceeds the geometric mean, so the two rules rank complexes differently when subunit levels differ. The table stores subunits; the rule is chosen at scoring.

**Orthology.** LIANA marks a subunit missing when it has no ortholog or more than the one-to-many limit $m_1$, and drops the row. A complex therefore survives only when

$$\mathbb{1}\Big[\forall k\in\mathcal S_C:\ 1\le|\mathcal O(k)|\le m_1\Big]=1,$$

where $\mathcal O(k)$ is the set of orthologues of subunit $k$ that pass the evidence threshold.

**Benchmark truth.** For $s<t$ (lexicographic), the Open Problems recipe labels

$$y_{s,t,L,R}=\mathbb{1}[q^{\mathrm{LR}}_{L,R}\le 0.05]\cdot\mathbb{1}[q^{\mathrm{CT}}_{s,t}\le 0.05],$$

where each $q$ is the Benjamini–Hochberg adjusted value of a bivariate Moran permutation test, applied separately to the ligand-receptor and cell-type layers. The estimand is a binary co-localisation indicator, not communication. Because the code takes the cross join of the two significant sets, $y$ factorises: a positive needs neither that $L$ is expressed in $s$ nor that $R$ is expressed in $t$. BH controls the false discovery rate under independence or positive dependence within each layer, and the two layers carry no joint guarantee. The cell-type Moran test uses 1,000 permutations and the $(r+1)/(B+1)$ estimator, so the smallest permutation p-value is about $10^{-3}$ and the q-values cannot resolve smaller values.

**Latent-class consensus (proposed).** Let $z_k\in\{0,1\}$ be the presence of key $k$, and $v_{r,k}$ its membership in resource $r$, with sensitivity $\alpha_r$ and false-positive rate $\beta_r$:

$$P(z_k=1\mid v)=\frac{\pi\prod_r \alpha_r^{v_{r,k}}(1-\alpha_r)^{1-v_{r,k}}}{\pi\prod_r \alpha_r^{v_{r,k}}(1-\alpha_r)^{1-v_{r,k}}+(1-\pi)\prod_r \beta_r^{v_{r,k}}(1-\beta_r)^{1-v_{r,k}}}.$$

The parameters are fitted without labels by EM in the Dawid–Skene form [R9]. The posterior estimates presence under that model's assumptions only. The model assumes resources are conditionally independent given truth. Shared literature violates this, so the posterior is overconfident and $\alpha_r$ absorbs overlap; the output is a ranking to be checked for calibration, not a probability.

**Failure modes.** Shared literature inflates counts through double counting. Direction and role errors survive curation: LIANA's changelog records a flipped consensus row and a transcription factor allowed as receptor. Notation causes complex errors: 1,097 of 4,620 consensus rows (23.7%) use underscore notation, which naive string joins split. Reverse duplicates are 20 consensus pairs present in both orientations, so 4,620 ordered rows give 4,600 unordered pairs. Case mismatch and non-HGNC symbols drop rows silently; LIANA warns only when a translation removes everything.

**Insight.** Without a gold standard the threshold cannot be chosen by accuracy alone; it must be set against held-out evidence. For the four default resources, 5,378 ordered keys have at least one supporter, 2,329 at least two, 728 at least three and 358 all four, so the choice of $m$ decides most of the table. The LIANA consensus is also not a plain union of its five constituents (cellchatdb, cellphonedb, celltalkdb, connectomedb2020, icellnet) in this snapshot: 240 of its ordered symbol keys lie outside that union, and 1,078 keys of the union are absent from it. Harmonisation must therefore write its own counts and provenance rather than inherit a published consensus. All set statistics are exact for the snapshot named in the metadata; the probabilistic and BH statements hold only under the dependence conditions stated above.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| OmniPath intercellular layer | heuristic | Curated protein roles and curated ligand-receptor subsets, filtered by the number of supporting resources | [R10] |
| CellChatDB | heuristic | Manually curated ligand-receptor list with heteromeric complexes | [R11], [R12] |
| CellPhoneDB database | heuristic | Curated receptor-ligand list with explicit subunit architecture (legacy repository, superseded by v3) | [R13] |
| CellTalkDB | heuristic | Manually curated human and mouse ligand-receptor pairs | [R14] |
| connectomeDB2020 | heuristic | Manually curated list distributed with a cell-to-cell network method | [R15] |
| Ramilowski et al. 2015 network | heuristic | Draft human ligand-receptor network of multicellular signalling | [R16] |
| LIANA+ consensus | heuristic | Aggregate of constituent resources, with complex reassembly and ortholog mapping | [R6] |

The published standards are the LIANA+ consensus and the OmniPath curated subsets, with CellChatDB and CellPhoneDB as reference resources for complexes. Only resources whose repository or snapshot records were examined are listed. No model-based resource weighting appears in the examined sources.

SHAs: OmniPathR 3e11391, CellChat 75253cd, LIANA 08590db (the saezlab/liana-py clone; scverse/liana HEAD is the same commit).

| Method | Parameter | Value | Source |
|---|---|---|---|
| OmniPath intercellular layer | `min_resources` | 1 | R/intercell.R:932 @ 3e11391 |
| OmniPath intercellular layer | curated resource set | Guide2Pharma, HPMR, ICELLNET, Kirouac2010, CellTalkDB, CellChatDB, connectomeDB2020; cellphonedb, cellinker, talklr, signalink TRUE | R/intercell_curated.R:113-121 @ 3e11391 |
| OmniPath intercellular layer | consensus percentile | 50 | R/intercell.R:935 @ 3e11391 (`filter_intercell_network`) |
| CellChatDB | complex expression rule | geometric mean over subunits | R/modeling.R:525-537 @ 75253cd |
| LIANA+ consensus | `resource_name` | consensus | src/liana/_core/_constants.py:23 @ 08590db |
| LIANA+ consensus | `complex_policy` | min | src/liana/resource/_reassemble_complexes.py:17 @ 08590db |
| LIANA+ consensus | `complex_sep` | "_" | src/liana/_core/_constants.py:38 @ 08590db |
| LIANA+ consensus | expression proportion (scoring) | 0.05 | src/liana/_core/_constants.py:18 @ 08590db |
| LIANA+ consensus | permutations | 1000 | src/liana/_core/_constants.py:20 @ 08590db |
| LIANA+ consensus | seed | 1337 | src/liana/_core/_constants.py:21 @ 08590db |
| LIANA+ ortholog mapping | `min_evidence` (HCOP sources) | 3 | src/liana/resource/_orthology.py:235 @ 08590db |
| LIANA+ ortholog mapping | `one_to_many` | 1 | src/liana/resource/_orthology.py:87, 178 @ 08590db |

## 5. Proposed singlet approach

Routes. **Port** (permissive code): the OmniPath count and curated-subset filter, implemented without calling the OmniPath web service; LIANA's consensus, complex reassembly and ortholog mapping. **Reimplement** (copyleft code): the CellChat complex rule and table schema, with CellChatDB rows entering through the snapshot. **Callout** only: the CellPhoneDB repository, and the Open Problems truth recipe, which the B1 generator reimplements. The CellPhoneDB, CellTalkDB, connectomeDB2020 and Ramilowski rows enter as snapshot data.

Default workflow: (1) pin the snapshot and record its hash; (2) normalise symbols to HGNC, split complexes on the separator, and deduplicate within each resource; (3) take the default resources at `min_resources` 1, keeping orientation and counts, and report ordered and unordered totals; (4) for mouse, map subunits through orthology with the LIANA limits, dropping rows that fail and recording how many; (5) write `uns/lr_resource` and its metadata.

The proposed default is the count union of the four default resources at $m=1$. The threshold is chosen jointly from B1 and B2, not by eye.

Model-based option: the latent-class posterior of section 3, fitted without labels. It is not in the tool enum because its primary paper has not been read. It is rejected if B1 PR-AUC does not exceed the count union at the same $m$, if its B1 Brier score is worse than the count rule's, or if the sensitivities $\alpha_r$ change ranking across leave-one-resource-out fits (B2).

ML stack: CPU-only NumPy and SciPy for the EM, at about $10^4$ keys by at most six resources. PyTorch and a CUDA kernel are not justified at this size, and the set operations are hash joins in the C++ core. Streaming is unnecessary because the full table fits in memory.

Defaults an agent should use without asking: species `homo_sapiens`; the default resource list; `min_resources` 1; LIANA orthology defaults; `restrict_to_features` false; and an explicit snapshot pin.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/lr_resource_sources | table | Optional cached resource tables with resource, ligand, receptor and subunit columns |
| read | uns/orthology_map | table | Optional HCOP-style table with source and target symbols and evidence counts |
| read | var/feature_symbol | string | HGNC symbols, read only when `restrict_to_features` is true |
| write | uns/lr_resource | table | Directed keys with complex subunits, species, `n_resources`, `resources`, `evidence_tier` |
| write | uns/lr_resource_meta | dict | Snapshot identifier, table hash, parameters, row counts per resource |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Handle of the .singlet dataset that receives uns/lr_resource. Expression is not read. |
| `species` | string | "homo_sapiens" | `homo_sapiens`, `mus_musculus` | Organism of the output table; mus_musculus maps human rows through orthology. |
| `resources` | array | ["cellchatdb", "cellphonedb", "celltalkdb", "connectomedb2020"] | — | Resources to combine. consensus must be used alone, since it already contains its constituents. |
| `min_resources` | integer | 1 | min 1 | Keep pairs supported by at least this many resources; 1 keeps the full union with counts. |
| `snapshot` | string | — | — | Pinned snapshot identifier, commit or file hash, recorded in metadata. Always set it for comparable outputs. |
| `restrict_to_features` | boolean | false | — | Keep only pairs whose subunits appear in var/feature_symbol of the dataset. |
| `orthology` | object | — | — | Used only when species is mus_musculus. |
| `orthology.min_evidence` | integer | 3 | min 1 | Minimum number of HCOP sources supporting an orthologue. |
| `orthology.one_to_many` | integer | 1 | min 1 | Maximum orthologues per subunit; subunits with more are treated as missing. |
| `device` | string | "cpu" | `cpu` | Always cpu; table operations have no GPU path. |
| `dry_run` | boolean | false | — | Return the estimate and row counts without writing. |
| `overwrite` | boolean | false | — | Replace existing uns/lr_resource and metadata instead of failing. |
<!-- PARAMS:AUTO:END -->

`orthology` applies only when `species` is `mus_musculus`. `restrict_to_features` needs `var/feature_symbol` in the dataset. `min_resources` may not exceed the number of selected resources. `consensus` cannot be combined with its constituents, which it already contains. Evidence tiers are set in each resource's metadata entry and never inferred from row counts. Set `snapshot` on every call: the metadata records the hash, so unpinned outputs cannot be compared across releases.

## 7. MCP tool

Tool name `singlet_communication_lr_resource_curation` (definition in `tasks/mcp/singlet_communication_lr_resource_curation.json`). Example call, using the default resources, and a compact result:

```json
{"dataset": "data/pbmc.singlet", "min_resources": 2, "snapshot": "scverse/liana@08590db"}
```

```json
{"dataset": "data/pbmc.singlet", "status": "completed", "wrote": ["uns/lr_resource", "uns/lr_resource_meta"],
 "summary": {"n_pairs_ordered": 2329, "n_pairs_unordered": 2311, "n_complex_rows": 255,
             "n_resources_histogram": {"2": 1601, "3": 370, "4": 358}, "dropped_below_min_resources": 3049},
 "provenance_id": "prov-0001", "job_id": null, "estimate": null}
```

Long-running: no, expected for table operations (P1 measures it). Stochastic: no, so identical pins give identical tables. Dry run returns the estimate and writes nothing.

## 8. Benchmarks

Shared protocol. Comparators use the LIANA snapshot at 08590db unless a benchmark says otherwise. Keys are ordered (ligand, receptor) symbol pairs after HGNC normalisation; complexes are split on the separator and compared as subunit sets. Ties are handled as stated per metric. Curation is deterministic. Where permutations occur, the permutation count and seed are those in section 4. Timing uses one CPU thread and reports wall time and peak resident memory. Results are reported per dataset, never pooled across datasets.

### B1. Spatial co-localisation truth (Open Problems sc-CCC subtask)

- **Goal**: rank directed candidate interactions so that jointly co-localised pairs occupy the top of the ranking. The subtask follows the Open Problems sc-CCC design [R7].
- **Ground truth**: orthogonal measurement proxy, inferred from spatial co-localisation rather than communication. Per candidate $(s,t,L,R)$ with $s<t$, the label is the cross join of two BH-significant tests (section 3). The estimand is a binary co-localisation indicator; the score is a per-pair ranking with no abundance normalisation.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlecell_broadinstitute_scp2167_human_brain | Open Problems task repository, accession SCP2167 (section 12) | spatial transcriptomics, human brain, — | — | normalised layer required; truth LR layer built from consensus |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| PR-AUC | Average precision of the candidate score over the $s<t$ domain; ties by step-wise average precision | maximise | primary | — |
| Odds ratio at truth-size top-k | $k$ equals the number of positives; candidates tied at the $k$-th score all enter; $\mathrm{OR}=TP\,TN/(FP\,FN)$ with 0.5 added to each cell if any is zero | maximise | guardrail | — |
| Brier score | Mean squared difference between a posterior and the label (posterior models only) | minimise | calibration guardrail | — |
| Wall time, peak memory | Per dataset, single thread | minimise | guardrail | — |

- **Comparators**: membership in consensus, CellChatDB, CellPhoneDB or CellTalkDB (binary scores); the count union at $m=1$ and $m=2$ on the default resources; a score-permutation random baseline; the latent-class posterior (proposed).
- **Protocol**: (1) build the domain as every ordered key of the comparator resources times every $s<t$ cell-type pair; (2) score each candidate; (3) compute metrics; (4) for each evaluated resource, regenerate the truth LR layer from the consensus input with that resource's exclusive rows removed, so no resource is scored against its own rows; (5) repeat over three permutation seeds.
- **Acceptance criterion** (proposed, not from the literature): PR-AUC at least twice the prevalence of positives, and the 95% interval from 1,000 bootstrap resamples over ligand-receptor pairs excludes the prevalence.
- **Known pitfalls**: (1) the truth uses consensus, which is also a candidate, so consensus is favoured unless step 4 is applied; (2) the score depends only on the ligand-receptor pair, so the cell-type factor only sets prevalence and PR-AUC reduces to a ligand-receptor ranking.

### B2. Coverage cost of evidence thresholds

- **Goal**: measure how much coverage each evidence threshold $m$ removes, relative to each constituent resource taken as held out.
- **Ground truth**: held-out resource membership (consistency; no truth labels). For resource $r$ with ordered keys $K_r$ and $T_{-r}(m)$ the keys supported by at least $m$ of the other four constituents, recall is $\rho_r(m)=|K_r\cap T_{-r}(m)|/|K_r|$. The estimand is the fraction of one resource's keys that survive a threshold built from the others; it measures overlap, not correctness.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| LIANA snapshot, five constituent tables (cellchatdb, cellphonedb, celltalkdb, connectomedb2020, icellnet) | scverse/liana file omni_resource.csv (section 12) | ligand-receptor tables, human, 738 to 3,392 ordered rows each | section 12 | consensus excluded, since it contains its constituents |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recall $\rho_r(m)$ | Fraction of $K_r$ kept, per $r$ and $m\in\{1,\dots,4\}$ | report curve | primary | — |
| Minimum recall | Worst case over $r$ at each $m$ | report only | guardrail | — |

- **Comparators**: count thresholds $m=1$ to $4$ built from the other four resources.
- **Protocol**: five leave-one-out builds; deterministic; no seeds.
- **Acceptance criterion**: none set. The recall curve for each resource is reported before any threshold is chosen, and the threshold is chosen jointly with B1.
- **Known pitfalls**: (1) shared literature makes recall an overlap statistic, so high recall does not show accuracy; (2) symbol drift lowers recall silently, so matching must use subunit sets rather than concatenated strings.

### B3. Resource-swap stability of top interactions

- **Goal**: measure how much the top inferred interactions change when only the resource changes, with dataset and scorer fixed.
- **Ground truth**: consistency; no truth labels. Each interaction $(s,t,L,R)$ scored under resource $r$ is an instance, and agreement is compared across resources.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Kang 2018 interferon-β PBMC case study | [R17], as described in the Single-Cell Best Practices chapter | single-cell RNA-seq, human PBMC, about 25,000 cells from 8 donors, before and after stimulation | — | chapter description only |
| singlecell_broadinstitute_scp2167_human_brain | as in B1 | spatial transcriptomics, human brain, — | — | non-immune tissue check |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Top-$k$ Jaccard against consensus | Jaccard of the top $k$ interactions ranked by magnitude, $k=100$ and $500$ | maximise | primary | — |
| Spearman correlation of shared-pair scores | Over pairs present in both resources | maximise | guardrail | — |
| Unique top-100 fraction | Fraction of top-100 interactions found under exactly one resource | minimise | guardrail | — |

- **Comparators**: consensus as reference, and the five constituents of B2; the scorer is LIANA rank aggregation as the chapter uses it.
- **Protocol**: fix the grouping to cell type, expression proportion 0.05 and 1,000 permutations (section 4); repeat over three seeds to separate permutation noise from the resource effect; report the full Jaccard matrix.
- **Acceptance criterion** (proposed): report the full matrix, and flag any resource whose top-100 Jaccard against consensus is below 0.2.
- **Known pitfalls**: (1) coverage differences, not curation quality, drive instability; (2) high agreement can reflect shared bias, and no truth separates the two.

### P1. Performance and scaling

Curation is a one-off table operation on CPU. The snapshot holds 35,356 ordered rows across 17 resource names. Measure wall time, peak memory and output identity at $10^4$, $10^5$ and $10^6$ rows, built by replicating snapshot rows with distinct synthetic symbols, against a manual merge script and LIANA's `select_resource` and `translate_resource` functions. Hold fixed the snapshot hash, the HCOP table version and the identifier table version. Acceptance criterion (proposed): two runs with the same pins produce byte-identical tables. Downstream scoring dominates compute; no timing is claimed here.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `harmonization.gene_identifier_mapping`: Gene identifier and symbol mapping
  - `cross-species.ortholog_assignment`: Gene orthology assignment across species
- **Feeds**:
  - `communication.lr_interaction_scoring`: Sender-receiver ligand-receptor interaction scoring
  - `communication.interaction_significance_calibration`: Calibration of interaction significance against a no-communication null
  - `communication.spatial_lr_scoring`: Spatially constrained ligand-receptor communication scoring
  - `communication.consensus_interaction_ranking`: Consensus ranking of interactions across communication methods
- **Reads**: `uns/lr_resource_sources`, `uns/orthology_map`, `var/feature_symbol`
- **Writes**: `uns/lr_resource`, `uns/lr_resource_meta`
<!-- CHAINING:AUTO:END -->

Belongs to the cell-cell communication workflow: resource curation precedes scoring, calibration and ranking.

## 10. Risks, pitfalls and open questions

- **Sources examined only in part.** The CellTalkDB paper was not read; its DOI comes from a web search record, and the repository ZJUFanLab/CellTalkDB (GPL-3.0 LICENSE file, HEAD 7276cd4) was located but not examined. The MetalinksDB paper and code were not examined, so its linear and independence assumptions come from LIANA's reference note. The resource-effect findings of Dimitrov et al. 2022 were not checked against the full text. The NicheNet ligand-receptor layer is not inspected and is omitted. The CellPhoneDB v3 repository (ventolab/CellphoneDB) was located but its contents were not examined.
- **Benchmark inputs absent from the clones.** The SCP2167 test files, their licence and their size are not in the Open Problems clone, and its metric configurations are absent, so the PR-AUC and odds-ratio definitions in B1 are this document's own. The normalisation and permutation scheme of LIANA's bivariate Moran's R were not inspected. The Kang 2018 accession was not located, and the HCOP table URL and version were not recorded.
- **Unsettled practice.** The Single-Cell Best Practices chapter states a 10% expression threshold for CellPhoneDB and LIANA; the LIANA code default in section 4 differs, and which one applies downstream is unclear. The minimum and geometric-mean complex rules have no shared standard. No resource encodes tissue, so presence is context-free. The Dawid–Skene paper was located by search but not read, and its conditional-independence assumption fails for shared literature.
- **Licence questions.** Licence status is open for the CellChatDB data, OmniPath-derived tables and the SCP2167 dataset; section 12 gives the repository licences. Resolve these before redistributing any table.
- **Snapshot and symbol risks.** The snapshot changes across releases, so every output needs a pinned hash. Symbol drift and case mismatch drop rows silently. The LIANA consensus is not a plain union of its five named constituents (section 3), and resources outside the tool enum, ICELLNET among them, are excluded until their primary papers are read.
- **First experiment.** Apply B1 on SCP2167 with leave-resource-out truth, comparing the four default resources at $m=1$ and $m=2$ with consensus membership and each single resource. This sets the threshold and tests whether the count rule beats consensus membership before any latent-class model is built.

## 11. References

R1. Dimitrov D, Türei D, Garrido-Rodriguez M, et al. Comparison of methods and resources for cell-cell communication inference from single-cell RNA-Seq data. *Nature Communications* 2022. doi:10.1038/s41467-022-30755-0 — verified (corpus)
R2. Wang S, Zheng H, Choi JS, Lee JK, Li X, Hu H. A systematic evaluation of the computational tools for ligand-receptor-based cell-cell interaction inference. *Briefings in Functional Genomics* 2022. doi:10.1093/bfgp/elac019 — verified (corpus)
R3. Liu Z, Sun D, Wang C. Evaluation of cell-cell interaction methods by integrating single-cell RNA sequencing data with spatial information. *Genome Biology* 2022. doi:10.1186/s13059-022-02783-y — verified (corpus)
R4. Luo J, Deng M, Zhang X, Sun X. ESICCC as a systematic computational framework for evaluation, selection, and integration of cell-cell communication inference methods. *Genome Research* 2023. — verified (corpus)
R5. Cesaro G, Nagai JS, Gnoato N, et al. Advances and challenges in cell-cell communication inference: a comprehensive review of tools, resources, and future directions. *Briefings in Bioinformatics* 2025. — verified (corpus)
R6. Dimitrov D, Schäfer PSL, Farr E, et al. LIANA+ provides an all-in-one framework for cell–cell communication inference. *Nature Cell Biology* 2024. doi:10.1038/s41556-024-01469-w — verified (corpus)
R7. Luecken MD, Gigante S, Burkhardt DB, et al. Defining and benchmarking open problems in single-cell analysis. *Nature Biotechnology* 2025. doi:10.1038/s41587-025-02694-w — verified (corpus)
R8. Farr E, et al. MetalinksDB. *Briefings in Bioinformatics* 2024. doi:10.1093/bib/bbae347 — verified (repo)
R9. Dawid AP, Skene AM. Maximum likelihood estimation of observer error-rates using the EM algorithm. *Applied Statistics* 1979. doi:10.2307/2346806 — verified (search)
R10. Türei D, Valdeolivas A, Gul L, et al. Integrated intra- and intercellular signaling knowledge for multicellular omics analysis. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209923 — verified (corpus)
R11. Jin S, Guerrero-Juarez CF, Zhang L, et al. Inference and analysis of cell-cell communication using CellChat. *Nature Communications* 2021. doi:10.1038/s41467-021-21246-9 — verified (corpus)
R12. Jin S, Plikus MV, Nie Q. CellChat for systematic analysis of cell–cell communication from single-cell transcriptomics. *Nature Protocols* 2025. doi:10.1038/s41596-024-01045-4 — verified (corpus)
R13. Efremova M, Vento-Tormo M, Teichmann SA, Vento-Tormo R. CellPhoneDB: inferring cell-cell communication from combined expression of multi-subunit ligand-receptor complexes. *Nature Protocols* 2020. doi:10.1038/s41596-020-0292-x — verified (corpus)
R14. Shao X, Liao J, Li C, Lu X, Cheng J, Fan X. CellTalkDB: a manually curated database of ligand-receptor interactions in humans and mice. *Briefings in Bioinformatics* 2020. doi:10.1093/bib/bbaa269 — verified (search)
R15. Hou R, Denisenko E, Ong HT, Ramilowski JA, Forrest ARR. Predicting cell-to-cell communication networks using NATMI. *Nature Communications* 2020. doi:10.1038/s41467-020-18873-z — verified (corpus)
R16. Ramilowski JA, Goldberg T, Harshbarger J, et al. A draft network of ligand-receptor-mediated multicellular signalling in human. *Nature Communications* 2015. doi:10.1038/ncomms8866 — verified (repo)
R17. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2018. — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/saezlab/OmniPathR (3e11391) | Denes Turei and Alberto Valdeolivas, among others (Authors@R) | MIT + file LICENSE (DESCRIPTION); LICENSE copyright 2018-2024 Saez Lab | intercellular filter and curated-subset logic | port |
| https://github.com/jinworks/CellChat (75253cd) | Suoqin Jin (author and maintainer) | GPL-3 (DESCRIPTION; LICENSE is the GPL-3 text) | complex rule and CellChatDB schema | reimplement |
| https://github.com/Teichlab/cellphonedb (dca1c26) | TeichLab (setup.py author); Teichmann Group copyright | MIT (LICENSE, Copyright 2018 Teichmann Group) | legacy repository; superseded by the v3 repository (ventolab/CellphoneDB, MIT, Copyright 2023 Wellcome Sanger Institute) | callout |
| https://github.com/scverse/liana (08590db; clone origin saezlab/liana-py) | Daniel Dimitrov (maintainer; LICENSE copyright 2025); further authors in pyproject.toml | BSD 3-Clause (LICENSE; pyproject license file) | consensus snapshot, complex reassembly, HCOP ortholog mapping | port |
| https://github.com/forrest-lab/NATMI (c7ad5a9) | Rui Hou (copyright holder); paper authors Hou R, Denisenko E, Ong HT, Ramilowski JA, Forrest ARR | MIT (LICENSE, Copyright 2019 Rui Hou) | connectomeDB2020 as distributed with the method | callout |
| https://github.com/openproblems-bio/task_cell_cell_communication (b800f11) | Open Problems in Single-Cell Analysis (LICENSE copyright 2024) | MIT (LICENSE) | B1 truth recipe (src/data_processors/infer_truth) | callout |

Licence conflict: scRNA-tools lists the saezlab/liana R package as GPL-3.0, and its LICENSE file and DESCRIPTION agree; the Python repository above is BSD-3.
