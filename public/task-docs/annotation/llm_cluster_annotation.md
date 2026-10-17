---
id: annotation.llm_cluster_annotation
title: LLM-based cluster annotation from marker gene lists
area: annotation
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [markers-de.cluster_marker_ranking, clustering.cell_partitioning]
feeds: [annotation.cell_ontology_mapping, annotation.annotation_confidence_calibration, annotation.consensus_annotation]
reads: [uns/<marker_table>, obs/<cluster_key>]
writes: [obs/llm_cluster_label, obs/llm_cluster_cp, obs/llm_cluster_entropy, uns/llm_cluster_run]
devices: [cpu, cuda]
mcp_tool: singlet_annotation_llm_cluster_annotation
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# LLM-based cluster annotation from marker gene lists

> Names each cluster from its ranked positive marker genes and an explicit tissue and species context by asking one or more pinned large language models, then reports vote agreement as a confidence signal.

## 1. Question

Given the top-ranked positive marker genes of each cluster and an explicit tissue and species context, does a pinned large language model return a cell type name that matches the expert label of that cluster, and how stable and well signalled is the answer? Inputs are a score-sorted marker table, a cluster partition and the context. Outputs are one name per cluster, the vote proportion and entropy when several models answer, and a provenance record. A correct answer names the expert type of the cluster's majority cells, or an ontology relative of that type.

## 2. Why this task matters and where the field stands

Every cell inherits the name of its cluster, so a cluster-level error reaches all of the cluster's cells. Manual naming from marker dot plots is the reference practice, but the choice of markers is subjective. Automated labellers replace that choice with marker databases, reference profiles or classifiers [R1, R2]. Large language models trained on published text can map a short marker list to a name without a reference atlas, which makes them a fast first pass [R3, R4].

The status is **contested**. Benchmarks of LLM labellers vary with the model and the scoring rule [R4, R5]. The open problems are these.

- **Scoring.** No accepted rule fixes the level at which a name is scored. The three-tier Cell Ontology rule of the mLLMCelltype manuscript gives partial credit under three clauses [R8].
- **Uncertainty.** Agreement across models is not a calibrated probability, as the mLLMCelltype authors state [R8].
- **Contamination.** A pretrained model may recall labels of the datasets it is tested on. The mLLMCelltype manuscript excludes such models, including CellTypist, which it reports as trained on Tabula Sapiens [R8].
- **Generic answers.** Under degraded marker input, models converge on broad categories, which produces spuriously high agreement [R8].
- **Zero-shot limits.** Zero-shot evaluations of single-cell foundation models have reported limitations [R6, R7], which argues for checking LLM labels against marker expression and reference annotations.

## 3. Theory and insight

An LLM annotator is zero-shot conditional generation. Let cluster $k$ have $n_k$ cells and top-ranked positive markers $G_k^{(K)}$, let $s$ be the species, $t$ the tissue string and $\pi$ the prompt template. For a frozen model snapshot $\theta$,

$$\hat y_k=\arg\max_{y\in\mathcal V}\,p_\theta\bigl(y\mid G_k^{(K)},s,t,\pi\bigr),$$

where $\mathcal V$ is the open set of strings the model can emit. Greedy decoding gives the mode and a positive temperature gives a sample. No parameter is fitted to this task, and $p_\theta$ is not a posterior over cell types. The statement holds only for the given snapshot, template and decoding setting, because an alias that moves to a new snapshot changes the function.

Scoring compares $\hat y_k$ with the expert label $y^\star_k$ after normalisation (lowercasing, punctuation, plural and synonym rules) and Cell Ontology (CL) mapping:

$$a(\hat y_k,y^\star_k)=\begin{cases}1&\text{same normalised name or same CL term}\\\tfrac12&\text{one CL term is a strict ancestor or descendant of the other}\\0&\text{otherwise.}\end{cases}$$

The mLLMCelltype manuscript also gives partial credit for shared specific ancestors and for "established biological relationships" [R8]. Singlet drops both, because neither is a fixed relation.

**Estimands.** For dataset $d$, the cell-weighted accuracy $\mathrm{Acc}^{\text{cell}}_d=\sum_k n_k a_k/\sum_k n_k$ is the expected score of a random cell under its cluster's label. The cluster-weighted accuracy $\mathrm{Acc}^{\text{cl}}_d=C^{-1}\sum_k a_k$ gives each cluster equal weight. The two differ when cluster sizes are uneven, so both are reported. The manuscript reports 77.2% cell-weighted over 49 datasets and 0.748 cluster-weighted over 1,224 cluster annotations [R8]. Dataset summaries average over datasets with equal weight. The expert truth of cluster $k$ is the majority expert label of its cells, and its purity is that majority's share.

**Consensus.** With $R$ answers normalised to labels and $c_j$ votes for label $j$,

$$\mathrm{CP}=\frac{\max_j c_j}{R},\qquad H=-\sum_j\frac{c_j}{R}\log_2\frac{c_j}{R}.$$

A cluster is reached when a unique majority meets $\mathrm{CP}\ge\tau_{\mathrm{CP}}$ and $H\le\tau_H$. CP estimates the share of the model ensemble that agrees with the modal name. It is a statistic of votes, not a posterior over types.

**Quantisation.** CP takes only the values $1/R,\dots,1$, and a majority reaches $\tau_{\mathrm{CP}}=0.7$ only with $\lceil 0.7R\rceil$ votes: 3 of 4, 4 of 5, 5 of 6 or 5 of 7. For $R\le6$ a passing majority leaves at most one dissenting vote, so the largest entropy among passing configurations is 0.811 bits (3 to 1 with $R=4$), and the entropy test never binds at $\tau_H=1.0$. At $R=7$ two distinct dissenting votes give $H\approx1.15$, and the entropy test starts to bind. For $R=4$, a 3 to 1 split meets the threshold and a 2 to 2 split does not. Each value is a direct count over the vote configurations.

**Checker path.** If the deterministic test fails, the reference code asks an LLM to report CP and H. It sets `reached` only when the model claims consensus, its own CP and H meet both thresholds and are attainable from the number of votes within 0.02, and the majority name is valid (R/R/check_consensus.R lines 577 to 628). Acceptance can therefore rest on self-reported numbers. Singlet does not use this path.

**Assumptions.** (a) The top markers summarise identity and are sorted by score. The reference GPTCelltype takes the first $K$ rows of its input without sorting (R/gptcelltype.R lines 43 to 44). (b) Votes are conditionally independent given the true type. Shared pretraining violates this, so agreement can reflect a shared error [R8]. (c) Expert labels do not come from the same markers. Many atlas labels come from marker logic, so agreement is partly circular. (d) The tissue string carries the species, because the reference prompt has no separate species argument (R/R/prompt_templates.R line 299).

**Failure modes.** Rare types decline most under marker noise [R8]. Degraded markers produce generic answers [R8]. Published labels can be recalled rather than inferred [R8]. Synonyms outside the reference normaliser's rules count as mismatches (R/R/check_consensus.R lines 6 to 26). GPTCelltype re-queries until the reply has one line per cluster in the batch, with no cap (R/gptcelltype.R lines 64 to 72). The consensus function sets no sampling temperature, while the manuscript states 0.7 throughout [R8].

**Model-based addition.** Votes from $R$ annotators can be combined as a latent-class posterior, with class prior $\pi_c$ and per-annotator confusion matrices $\Pi^{(r)}$ [R15]:

$$P(y_k=c\mid v_{k,1:R})\propto\pi_c\prod_{r=1}^{R}\Pi^{(r)}_{c,\,v_{k,r}}.$$

Its parameters are fitted by EM on clusters with known labels, and it returns a posterior that supports an abstention rule. Regime: votes conditionally independent given the class, which shared pretraining violates, and a labelled calibration set with study-level holdout. Calibration is measured by $\mathrm{ECE}=\sum_b (n_b/C)\,|\mathrm{acc}_b-\mathrm{conf}_b|$ [R16], where $\mathrm{conf}_b$ is mean CP and $\mathrm{acc}_b$ the mean graded accuracy in bin $b$. With few distinct CP values, the bins are the values themselves. Stability between repeats is measured by Cohen's $\kappa=(p_o-p_e)/(1-p_e)$ [R17], which measures consistency rather than accuracy. The benchmark repository's plurality agreement and Gini coefficient are consistency measures and must not be reported as accuracy; its per-cell agreement with the manual label is exact string match without ontology credit [R11].

**Insight.** LLM labels are a fast lookup over marker-to-name associations learned from text. They are strongest for major types with canonical markers and weakest for rare types and noisy markers [R8]. Consensus removes idiosyncratic errors but shares the models' biases, so agreement can overstate accuracy.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| GPTCelltype | model-based | One chat model names each cluster from its top ten positive markers, in batches of up to 30 clusters per request. | [R9] |
| mLLMCelltype | hybrid | Several LLMs name each cluster independently; normalised votes give CP and H; clusters below threshold go to discussion rounds and a consensus check. | [R8] |
| AnnDictionary LLM annotation | model-based | `ai_annotate_cell_type()` asks an LLM to name each `groupby` cluster of one AnnData from its top differential genes; the AnnData-dictionary wrapper is `ai_annotate_cell_type_adata_dict()`. | [R10] |
| scType | heuristic | On a scaled matrix, weights each marker by specificity (1 for a gene in one gene set, 0 for one in all), sums positive minus negative markers per cell and then per cluster; clusters below a quarter of their cell count are Unknown. | [R12] |
| CellMeSH | model-based | Probabilistic cell-type identification from marker genes using indexed literature. | [R13] |

The published standard is the single-model prompt of GPTCelltype [R9], whose scoring the manuscript reuses [R8]. mLLMCelltype is the multi-model consensus [R8]. AnnDictionary [R10] and its benchmark pipeline [R11] supply Tabula Sapiens cell_ontology_class labels as a manual reference and an exact-match agreement code. scType and CellMeSH are the non-LLM comparators. Expert annotation is the truth, not a method.

| Method | Parameter | Value | Source (file:line @ sha, or paper section) |
|---|---|---|---|
| GPTCelltype | model | `'gpt-4'` | R/gptcelltype.R:31 @ 3d2785a |
| GPTCelltype | top genes per cluster | 10 | R/gptcelltype.R:31 @ 3d2785a |
| GPTCelltype | positive-marker filter | `avg_log2FC > 0`, input order kept | R/gptcelltype.R:43-44 @ 3d2785a |
| GPTCelltype | clusters per request | `ceiling(C / 30)` batches | R/gptcelltype.R:54 @ 3d2785a |
| GPTCelltype | line-count retry | repeat until reply lines equal clusters; no cap | R/gptcelltype.R:64-72 @ 3d2785a |
| mLLMCelltype | models | claude-opus-4-7, gpt-5.5, gemini-3.1-pro-preview, deepseek-v4-flash, grok-4.3; at least two | R/R/consensus_annotation.R:846-850, :864 @ 26bda56 |
| mLLMCelltype | top genes | 10 | R/R/consensus_annotation.R:852 @ 26bda56 |
| mLLMCelltype | tau_CP, tau_H | 0.7, 1.0 | R/R/consensus_annotation.R:853-854 @ 26bda56 |
| mLLMCelltype | max discussion rounds | 3 | R/R/consensus_annotation.R:855 @ 26bda56 |
| mLLMCelltype | checker default tau_CP | 2/3, used only when no threshold is passed | R/R/check_consensus.R:495 @ 26bda56 |
| mLLMCelltype | plausibility tolerance | 0.02 | R/R/check_consensus.R:117 @ 26bda56 |
| mLLMCelltype | CP and H | CP = max count / R; H in bits | R/R/check_consensus.R:94, :98 @ 26bda56 |
| mLLMCelltype | sampling temperature | not set in the consensus function; 0.7 in the manuscript; provider processors 0.7 or 0.6 | paper Statistics section; R/R/deepseek_processor.R:36; R/R/kimi_processor.R:48 |
| mLLMCelltype | marker selection | Wilcoxon (Scanpy), BH-adjusted p below 0.05, logFC at least 0.25 | paper Statistics section |
| mLLMCelltype | prompt | exactly N non-empty lines, one name each | R/R/prompt_templates.R:268-290 @ 26bda56 |

## 5. Proposed singlet approach

**Routes.** Routes are in section 12. The GPTCelltype and mLLMCelltype prompts, normaliser and vote arithmetic are ported, and the legacy OpenAI call is replaced by a provider backend. scType is reimplemented as a comparator, CellMeSH is a callout comparator, and AnnDictionary is cited for its labels and not executed.

**Default pipeline.** (1) Markers are re-sorted by score within each cluster, filtered to positive markers with adjusted p below 0.05 and logFC of at least 0.25, and truncated to $K$; input order is never trusted. (2) The prompt comes from the ported template, and the tissue string is composed from the context fields. (3) Each model is called once per cluster at temperature 0 with a pinned snapshot; answers are normalised before voting and stored raw. (4) A cluster is reached when a unique majority meets $\tau_{\mathrm{CP}}=0.7$ and $H\le1.0$. Unreached clusters keep the majority name and CP, so thresholds can change downstream; `Unknown` is reserved for unparseable answers. (5) Discussion rounds are off in singlet's default, unlike the reference default of three (section 4), because they make answers depend on each other and break the independence that vote statistics assume; three rounds form a B4 arm. The checker path of section 3 is dropped.

**Model-based candidate.** The Dawid–Skene posterior of section 3 may replace CP. It is fitted by EM on catalogue clusters with author annotations, with study-level holdout, and enters the MCP enum only if B4 is met at matched coverage. A distilled marker-to-CL classifier in PyTorch gives an offline reference that calls no API. The proposal is falsified if its held-out ECE exceeds 0.10, or if its coverage at 0.90 accuracy is not higher than the CP rule's.

**Stack.** PyTorch for the distilled classifier. EM is computed on CPU in C++, since the confusion matrices are small; CUDA is added only if P1 shows batched EM to be the bottleneck. The LLM path has no CUDA kernel; its cost is provider latency.

**Agent defaults.** `method` mllmcelltype; `models` from the user as pinned snapshot IDs, asked once and never replaced by package defaults; temperature 0; zero discussion rounds; tau_CP 0.7; tau_H 1.0; `top_k_markers` 10; `context` from the user, never guessed.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | uns/<marker_table> | table | ranked markers with cluster, gene, score, logfc and pval_adj, sorted by score within cluster |
| read | obs/<cluster_key> | category | the cluster partition |
| write | obs/llm_cluster_label | category | normalised name per cluster, broadcast to cells; Unknown when no answer is parseable |
| write | obs/llm_cluster_cp | float32 | consensus proportion, broadcast to cells; null for single-model calls |
| write | obs/llm_cluster_entropy | float32 | vote entropy in bits, broadcast to cells; null for single-model calls |
| write | uns/llm_cluster_run | dict | snapshot IDs, prompt hash, temperature, top-K, raw answers per cluster and call counts |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `cluster_key` | string | "leiden" | — | obs column holding the cluster partition; one label is returned per distinct cluster. |
| `marker_table` | string | "rank_genes_groups" | — | uns key of a marker table with cluster, gene, score, logfc and pval_adj columns. |
| `top_k_markers` | integer | 10 | min 1; max 50 | Number of top-scoring positive markers per cluster sent to each model. |
| `context` | object | required | — | Tissue and species written into the prompt; supplied explicitly and never inferred from the data. |
| `context.tissue` | string | — | — | Tissue name, for example lung or human PBMC. |
| `context.species` | string | — | `human`, `mouse` | Species of the markers. |
| `method` | string | "mllmcelltype" | `mllmcelltype`, `gptcelltype` | mllmcelltype: multi-model vote with consensus. gptcelltype: one model names each cluster. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Device for local open-weight backends; hosted model APIs ignore it. |
| `seed` | integer | 0 | — | Seed sent to providers that accept one; hosted outputs can still vary between calls. |
| `dry_run` | boolean | false | — | Return the planned API call count, approximate prompt tokens and device without calling any model. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `gptcelltype` | object | — | — | Options for method gptcelltype. |
| `gptcelltype.model` | string | — | — | Pinned model snapshot ID; required, because aliases move. |
| `gptcelltype.temperature` | number | 0 | min 0; max 2 | Sampling temperature for each request. |
| `gptcelltype.clusters_per_request` | integer | 30 | min 1; max 30 | Clusters per request; the reference implementation batches 30. |
| `gptcelltype.max_retries` | integer | 3 | min 0; max 10 | Re-queries when the reply line count differs from the cluster count. |
| `mllmcelltype` | object | — | — | Options for method mllmcelltype. |
| `mllmcelltype.models` | array | — | — | At least two pinned model snapshot IDs; required, with no package default. |
| `mllmcelltype.temperature` | number | 0 | min 0; max 2 | Sampling temperature for every model; the manuscript used 0.7. |
| `mllmcelltype.max_discussion_rounds` | integer | 0 | min 0; max 3 | Discussion rounds for clusters below threshold; the reference default is 3. |
| `mllmcelltype.controversy_threshold` | number | 0.7 | min 0; max 1 | Minimum consensus proportion to accept a label (tau_CP). |
| `mllmcelltype.entropy_threshold` | number | 1.0 | min 0; max 4 | Maximum vote entropy in bits to accept a label (tau_H). |
| `mllmcelltype.max_retries` | integer | 3 | min 0; max 10 | Re-queries when a model's reply line count differs from the cluster count. |
<!-- PARAMS:AUTO:END -->

Parameters under `gptcelltype` apply only to that method, and those under `mllmcelltype` only to that method. `models` and `gptcelltype.model` are required and are recorded with every call in `uns/llm_cluster_run`. `context.tissue` and `context.species` are required and never inferred. Markers are re-sorted and filtered before truncation; a cluster with fewer positive markers than `top_k_markers` is sent with the markers it has and flagged. Raw answers are stored, so the normaliser and thresholds can change and be replayed without new calls. Changing a model, prompt, temperature or threshold changes the labels, so existing members are replaced only with `overwrite`.

## 7. MCP tool

Tool name `singlet_annotation_llm_cluster_annotation` (definition in `tasks/mcp/singlet_annotation_llm_cluster_annotation.json`). Example call and compact result; angle brackets are placeholders.

```json
{"dataset": "/data/atlas.singlet", "cluster_key": "leiden", "context": {"tissue": "lung", "species": "human"}, "method": "mllmcelltype", "mllmcelltype": {"models": ["<snapshot-a>", "<snapshot-b>", "<snapshot-c>"]}}
```

```json
{"dataset": "/data/atlas.singlet", "status": "completed",
 "wrote": ["obs/llm_cluster_label", "obs/llm_cluster_cp", "obs/llm_cluster_entropy", "uns/llm_cluster_run"],
 "summary": {"method": "mllmcelltype", "n_clusters": "<n>", "n_reached": "<n>", "mean_cp": "<float>", "n_unknown": "<n>", "n_api_calls": "<n>"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: large cluster counts or many models return `queued` with a `job_id`, because provider latency dominates. Stochastic: yes; identical inputs and snapshots can give different labels (B2). Dry run: returns `dry_run` with the planned API call count, approximate prompt tokens and device, and calls no model.

## 8. Benchmarks

**Shared protocol.** Markers come from Scanpy Wilcoxon ranking, Benjamini–Hochberg adjusted p below 0.05 and logFC of at least 0.25, the ten highest by score, computed once per dataset and frozen [R8]. The tissue string is built from the atlas organ and species. Expert labels and other clusters' answers are withheld from the prompt. Every method returns one name per cluster; names are normalised and mapped to CL terms with one pinned CL release, and Unknown or unmapped names count as mismatches. The scorer is blind to method identity. Summaries are means over datasets with 95% dataset-level bootstrap intervals from 2,000 resamples. Snapshot IDs, prompt hashes and temperatures are recorded.

### B1. Graded agreement with expert labels on expert-annotated atlases (proposed protocol)

- **Goal**: graded agreement of cluster names with expert types, against heuristic and single-model comparators.
- **Ground truth**: expert cell labels; the cluster truth is the majority label of its cells. Clusters with purity below 0.8 are mixed (threshold proposed) and reported as a share.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Tabula Sapiens | [R14]; https://cells.ucsc.edu/?ds=tabula-sapiens | human; — | — | cell_ontology_class as in [R11] |
| Human Lung Cell Atlas | [R8]; CELLxGENE 9f222629-9e39-47d0-b83f-e08d610c7479 | human lung; — | — | — |
| Lung Cell Atlas | [R8]; CELLxGENE 5d445965-6f1a-4b68-ba3a-b8f765155d3a | human lung; — | — | 58 fine types at level 4 [R8] |
| Developmental thymus | [R8]; CELLxGENE de13e3e2-23b6-40ed-a413-e9e12d7d3910 | human; over 250,000 cells | — | — |
| HNOCA | [R8]; CELLxGENE de379e5f-52d0-498c-9801-0f850823c847 | human organoid; — | — | also B3 |
| Lifespan immune atlas | [R8]; Synapse syn61609846 | human; — | — | — |
| Human Cell Landscape | [R8]; figshare 7235471 | human; — | — | — |
| Mouse Cell Atlas | [R8]; figshare 865e694ad06d5857db4b | mouse; — | — | — |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| graded_accuracy_cell | $\mathrm{Acc}^{\text{cell}}_d$; mean over datasets | maximise | primary | [R8] |
| graded_accuracy_cluster | $\mathrm{Acc}^{\text{cl}}_d$; mean over datasets | maximise | primary | [R8] |
| exact_match_rate | share of clusters with $a_k=1$ | maximise | guardrail | [R3] |
| mismatch_rate | share with $a_k=0$, by truth CL depth | minimise | guardrail | [R8] |

- **Comparators**: scType [R12], CellMeSH [R13], GPTCelltype [R9], mLLMCelltype with its two-model minimum and with the five-model default [R8].
- **Protocol**: at least ten datasets, three tissues, immune and non-immune types; temperature 0; one call per cluster per model.
- **Acceptance criterion** (proposed; the manuscript reports 77.2% [R8]): mean graded_accuracy_cell at least 0.77; dataset-bootstrap 95% lower bound not below the best heuristic comparator's mean; datasets with mismatch rate above 0.5 reported individually.
- **Known pitfalls**: (1) expert labels built from similar marker logic inflate agreement. (2) Published labels may be recalled; models trained on these atlases are excluded [R8].

### B2. Repeat and snapshot stability (proposed protocol, design from [R8])

- **Goal**: measure whether identical inputs give identical labels across repeated calls and across pinned snapshots.
- **Ground truth**: consistency only; no expert label is used. The estimand is the share of clusters whose normalised name is identical in all $R=5$ repeats, with a cell-weighted share reported beside it, and Cohen's $\kappa$ over cluster labels for each pair of repeats or snapshots, with categories the union of names.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Tabula Sapiens, HLCA, HNOCA, developmental thymus, LCA, GTEx, HuBMAP, lifespan immune atlas | [R8]; URLs as in B1 where listed | mixed human tissues; — | — | the eight datasets of the manuscript's reproducibility analysis |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| identical_label_fraction | share of clusters identical across all repeats; cell-weighted share reported too | maximise | primary | [R8] |
| pairwise_kappa | Cohen's $\kappa$ for each pair of repeats or snapshots | maximise | primary | [R17] |
| accuracy_sd | standard deviation of graded_accuracy_cell across repeats | minimise | guardrail | [R8] |

- **Comparators**: GPTCelltype with one model; temperature 0 against 0.7; batches of 30 against one cluster per request; consensus against a single model; a new against an earlier snapshot of the same model family.
- **Protocol**: five repeats per dataset, with seeds passed where a provider accepts them. Prompt hash, snapshot IDs, seeds and batch composition are recorded; markers are frozen.
- **Acceptance criterion** (proposed; the anchors are listed in section 10): identical_label_fraction at least 0.85 at temperature 0 with a pinned snapshot; kappa at least 0.65 between snapshots. A dataset whose identical fraction falls below 0.80 is flagged.
- **Known pitfalls**: (1) temperature 0 is not deterministic on some hosted APIs. (2) Aliases move to new snapshots without notice. A stable label can still be wrong, so stability is reported beside B1.

### B3. Marker-input robustness (proposed protocol, perturbation types from [R8])

- **Goal**: measure how graded accuracy and generic naming change as the marker input is corrupted in the four ways of the manuscript.
- **Ground truth**: expert labels of the HNOCA atlas, unchanged by perturbation. The estimand is the mean graded_accuracy_cell at perturbation level $s$, summarised as $\mathrm{AUDC}=\int_0^{0.5}\overline{\mathrm{Acc}}(s)\,ds\,/\,0.5$ by the trapezoid rule over the grid, so it lies in $[0,1]$.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Human neural organoid atlas (HNOCA) | [R8]; CELLxGENE collection de379e5f-52d0-498c-9801-0f850823c847 | scRNA-seq, human organoid; — | — | the manuscript's robustness dataset |

- **Perturbations**: at fraction $s\in\{0,0.1,\dots,0.5\}$ of the top ten markers of each cluster, (i) replace with housekeeping genes, (ii) replace with positive markers of another atlas type, (iii) replace with genes drawn uniformly from the transcriptome outside the cluster's top 50, or (iv) delete. Fifty independent draws per level and per perturbation [R8].
- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| audc | $\mathrm{AUDC}$ per perturbation type | maximise | primary | [R8] |
| generic_label_rate | share of clusters whose predicted CL term is a strict ancestor of the truth term, per level | minimise | guardrail | [R8] |

- **Comparators**: the same method on clean input; GPTCelltype with one model under the same perturbations.
- **Protocol**: medians and 95% percentile intervals over the 50 draws; predictions that do not map to CL are counted separately.
- **Acceptance criterion** (proposed): at $s=0.3$ under random injection, graded_accuracy_cell falls by at most 0.10 from clean input; generic_label_rate is at most 0.10 at $s=0.1$.
- **Known pitfalls**: (1) under heavy corruption, broad names raise agreement, so generic_label_rate is read beside accuracy [R8]. (2) Random genes are sometimes real markers of other types; the share of injected genes that are markers of an atlas type is reported, using the atlas's own cluster markers.

### B4. Calibration and abstention of consensus confidence (proposed)

- **Goal**: test whether CP and H predict graded correctness, and find the coverage at which low-agreement clusters can be withheld.
- **Ground truth**: expert cluster labels from B1; a cluster is correct when $a_k=1$. The estimands are the expected calibration error with bins at the distinct CP values, the area under the ROC curve of CP for correctness (midranks for ties), and the coverage at accuracy 0.90, which is the largest share of clusters, taken in descending CP order, whose mean $a_k$ is at least 0.90.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| B1 datasets | B1 | as in B1 | as in B1 | study-level holdout for the Dawid–Skene fit |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| ece_cp | expected calibration error, bins at distinct CP values | minimise | primary | [R16] |
| auroc_cp | area under the ROC curve of CP for correctness | maximise | primary | — |
| coverage_at_0.90 | largest retained share with mean $a_k\ge0.90$ | maximise | guardrail | — |

- **Comparators**: a single-model label with no vote information; the Dawid–Skene posterior from the same votes (section 5); the reference-based classifier confidence of annotation.annotation_confidence_calibration.
- **Protocol**: consensus with discussion off and with three rounds as separate arms; Dawid–Skene fitted with leave-one-study-out; dataset-level bootstrap intervals.
- **Acceptance criterion** (proposed): ECE at most 0.10 on held-out datasets; AUROC at least 0.75; clusters with CP at least 0.7 have a mean graded accuracy at least the overall mean.
- **Known pitfalls**: (1) CP is quantised; section 3 gives the attainable values. (2) The checker path can set `reached` from self-reported numbers (section 3), so the deterministic rule is evaluated alone.

### P1. Performance and scaling

Wall time, API calls, input and output tokens and retries per cluster, for C = 10, 50 and 200 clusters (proposed grid), M = 1, 3 and 5 models and R = 0 and 3 discussion rounds. Hold fixed K = 10, the prompt, temperature 0 and the snapshots; report medians and interquartile ranges over three repeats. Cell count enters only through marker computation, which is timed separately at $10^4$, $10^5$ and $10^6$ cells. Comparators are scType and CellMeSH on CPU. Monetary cost is not stated here and must be taken from current provider pricing at the time of use.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `markers-de.cluster_marker_ranking`: Cluster marker gene ranking
  - `clustering.cell_partitioning`: Partitioning cells into clusters at a fixed granularity
- **Feeds**:
  - `annotation.cell_ontology_mapping`: Cell type name harmonization to Cell Ontology terms
  - `annotation.annotation_confidence_calibration`: Annotation and label-transfer confidence calibration and abstention
  - `annotation.consensus_annotation`: Consensus annotation across methods or annotators
- **Reads**: `uns/<marker_table>`, `obs/<cluster_key>`
- **Writes**: `obs/llm_cluster_label`, `obs/llm_cluster_cp`, `obs/llm_cluster_entropy`, `uns/llm_cluster_run`
<!-- CHAINING:AUTO:END -->

No named workflow is assigned in the catalogue; the task sits between marker ranking and ontology mapping.

## 10. Risks, pitfalls and open questions

- **Secondary sources for Hou and Ji 2024.** The design details and figures used as anchors (ten datasets, five species, 85% identical repeats, kappa 0.65, the 1/0.5/0 rule) come from a summary of the article, not its full text. B2 acceptance and the B1 scoring rule must be checked against the article before use.
- **Evaluator provenance.** The mLLMCelltype repository holds a rule-based matcher that queries the EBI OLS API live and includes a B-cell numbering rule, and evaluation scripts that call Claude models, with claude-3-5-sonnet-20241022 among the reproducibility runners [R8]. The manuscript's matching procedure also queries that OLS API, so scores depend on the live service. Judge and annotators share a model family, so self-preference is possible. Singlet must name one evaluator and pin the CL release.
- **Version and scope gaps.** The preferred citation is dated 2026-06-08, while the repository's CITATION.cff gives version 2.0.8 dated 2026-08-17; the section 4 defaults come from the code at 26bda56, not from the manuscript. The manuscript states GPTCelltype v1.1.1, but the repository at 3d2785a is version 1.0.1, and the 1.1.1 code was not read. CellTypeAgent was omitted because neither its code nor its full text was read. Guo et al. (2017), Cohen (1960) and Dawid and Skene (1979) are cited from memory; their formulas are standard, but the sources were not read.
- **Data.** Licences for the atlases were not read. Sizes appear only where the manuscript states them. The ten Hou and Ji datasets are not enumerated and are not used. The benchmark_llms Zenodo record is not used, because its DOI is not in a repository file.
- **Benchmarks not yet defined.** A memorisation control comparing pre- and post-cutoff studies needs a dated study list, and a marker-claim audit needs thresholds fixed before scoring. Neither is in section 8. The singlet catalogue's author labels may appear in pretraining corpora, so they are a clean control only with a dated split.
- **First experiment.** Apply the GPTCelltype and mLLMCelltype prompts with pinned snapshots on HLCA and one B3 perturbation level, and confirm that the ported normaliser, CP and H reproduce the reference code on identical stored answers before any new aggregator is built.

## 11. References

R1. Pasquini G, Rojo Arias JE, Schäfer P, Busskamp V. Automated methods for cell type annotation on scRNA-seq data. *Computational and Structural Biotechnology Journal* 2021. doi:10.1016/j.csbj.2021.01.015 — verified (corpus)

R2. Abdelaal T, Michielsen L, Cats D, et al. A comparison of automatic cell identification methods for single-cell RNA sequencing data. *Genome Biology* 2019. doi:10.1186/s13059-019-1795-z — verified (corpus)

R3. Hou W, Ji Z. Assessing GPT-4 for cell type annotation in single-cell RNA-seq analysis. *Nature Methods* 2024. doi:10.1038/s41592-024-02235-4 — verified (corpus)

R4. Crowley G, Tabula Sapiens Consortium, Quake SR, et al. Benchmarking cell type and gene set annotation by large language models with AnnDictionary. *Nature Communications* 2025. doi:10.1038/s41467-025-64511-x — verified (corpus)

R5. Xiao T, Hua D, Wang Y, Lu X, Zhang C. Benchmarking large language models for cell typing in single-cell RNA-Seq. *Briefings in Bioinformatics* 2025. doi:10.1093/bib/bbaf677 — verified (corpus)

R6. Kedzierska KZ, Crawford L, Amini AP, Lu AX. Zero-shot evaluation reveals limitations of single-cell foundation models. *Genome Biology* 2025. doi:10.1186/s13059-025-03574-x — verified (corpus)

R7. Boiarsky R, Singh NM, Buendia A, Amini AP, Getz G, Sontag D. Deeper evaluation of a single-cell foundation model. *Nature Machine Intelligence* 2024. doi:10.1038/s42256-024-00949-w — verified (corpus)

R8. Yang C, Zhang X, Chen J. Large language model consensus substantially improves the cell type annotation accuracy for scRNA-seq data. *Communications Biology* 2026. doi:10.1038/s42003-026-10420-8 — partial (repo)

R9. Hou W, Ji Z. GPTCelltype: Reference-free and cost-effective automated cell type annotation. R package 1.0.1. GitHub, Winnie09/GPTCelltype, commit 3d2785a. — partial (repo)

R10. ggit12. AnnDictionary: a package for processing AnnData objects in parallel with LLMs. Version 0.5.0. GitHub, ggit12/anndictionary, commit 0b5b8dd. — partial (repo)

R11. ggit12. Benchmarking LLMs pipeline (benchmark_llms). GitHub, ggit12/benchmark_llms, commit c7be408. — partial (repo)

R12. Ianevski A, et al. Fully-automated and ultra-fast cell-type identification using specific marker combinations from single-cell transcriptomic data. *Nature Communications* 2022. doi:10.1038/s41467-022-28803-w — verified (corpus)

R13. Mao S, Zhang Y, et al. CellMeSH: probabilistic cell-type identification using indexed literature. *Bioinformatics* 2021. doi:10.1093/bioinformatics/btab834 — verified (corpus)

R14. Jones RC, Karkanias J, Krasnow MA, et al. The Tabula Sapiens: a multiple-organ, single-cell transcriptomic atlas of humans. *Science* 2022. doi:10.1126/science.abl4896 — verified (corpus)

R15. Dawid AP, Skene AM. Maximum likelihood estimation of observer error-rates using the EM algorithm. *Applied Statistics* 1979;28(1):20–28. doi:10.2307/2346806 — partial (search)

R16. Guo C, Pleiss G, Sun Y, Weinberger KQ. On calibration of modern neural networks. *Proceedings of the 34th International Conference on Machine Learning* (PMLR 70) 2017. — unverified (memory)

R17. Cohen J. A coefficient of agreement for nominal scales. *Educational and Psychological Measurement* 1960. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/Winnie09/GPTCelltype | Wenpin Hou, Zhicheng Ji (DESCRIPTION Author); maintainer Wenpin Hou | MIT (LICENSE; DESCRIPTION) | single-model reference | port prompt, normaliser and parsing; replace legacy OpenAI call |
| https://github.com/cafferychen777/mLLMCelltype | Chen Yang, Xianyang Zhang, Jun Chen (CITATION.cff authors) | MIT (LICENSE; CITATION.cff) | consensus reference | port normaliser, vote arithmetic and prompt; drop checker path |
| https://github.com/ggit12/anndictionary | ggit12 (only author in pyproject.toml) | BSD-3-Clause (LICENSE; pyproject.toml) | LLM annotation package | callout (label source; not executed) |
| https://github.com/ggit12/benchmark_llms | ggit12 | BSD-3-Clause (LICENSE) | benchmark pipeline and agreement code | callout (definitions only) |
| https://github.com/IanevskiAleksandr/sc-type | Aleksandr Ianevski (repository author) | GPL-3.0 (LICENSE) | scType comparator | reimplement; comparator calls only |
| https://github.com/shunfumao/cellmesh | Shunfu Mao, Yue Zhang (setup.py) | MIT (LICENSE; setup.py) | CellMeSH comparator | callout |
