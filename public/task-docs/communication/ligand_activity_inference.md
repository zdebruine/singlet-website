---
id: communication.ligand_activity_inference
title: Upstream ligand activity and target-gene prediction for a receiver response
area: communication
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [communication.lr_resource_curation, grn.prior_network_curation, markers-de.replicate_aware_condition_de]
feeds: [communication.consensus_interaction_ranking, communication.lr_interaction_scoring]
reads: [layers/counts, obs/<cell_type_key>, uns/receiver_de/<receiver>, uns/expressed_genes_receiver/<receiver>, uns/lr_network, uns/signaling_network, uns/gr_network, uns/source_weights, models/ligand_target_matrix]
writes: [uns/ligand_activities/<receiver>, uns/ligand_target_links/<receiver>, models/ligand_target_matrix]
devices: [cpu, cuda]
mcp_tool: singlet_communication_ligand_activity_inference
evidence_basis: corpus+repo
last_reviewed: 2026-10-17
---

# Upstream ligand activity and target-gene prediction for a receiver response

> Rank the sender ligands that best explain a receiver population's response genes by comparing each ligand's prior ligand-to-target potential with the response, and report the target genes behind each ranked ligand.

## 1. Question

Given the differential response genes of one receiver population, the genes expressed in that population as background, a prior ligand-to-target matrix and the candidate ligands expressed by sender populations, which ligands best explain the response, and which target genes does each one regulate? Outputs per receiver and candidate ligand are an activity score, a bootstrap p-value against random gene sets of equal size, and a ligand-to-target score matrix [R1][R2]. A correct answer ranks ligands whose known target programmes are enriched in the response above ligands whose programmes are absent. The only available check is agreement with ligand-treatment experiments in which the applied ligand is known.

## 2. Why this task matters and where the field stands

Most ligand-receptor tools score pairs by ligand expression in senders and receptor expression in receivers, and do not test whether the receiver responds [R3][R4]. Ligand activity inference reverses the direction: it starts from the response and asks which ligands could have produced it [R1][R2]. Status: **contested**. The published standard is heuristic. NicheNet builds a prior by diffusion over a signalling graph and a regulatory network, then ranks ligands by corrected AUPR against the response [R1][R2][R11]. The repository's data sources include OmniPath [R8][R11]. Open problems:

- **Prior dependence.** Scores are only as good as the graphs. The repository ships a popularity-bias diagnostic, which indicates that well-studied targets can inflate performance [R11].
- **Sender independence.** The default score ignores sender abundance and ligand expression, so an absent ligand can rank well. The protocol [R2] describes a 'sender-agnostic' approach (ligands from the entire microenvironment) and a 'sender-focused' approach (ligands from chosen populations).
- **Shared targets.** Correlated ligands with shared targets all score high, and the per-ligand score does not divide credit among them.
- **No calibrated uncertainty.** The ranking statistic is not a likelihood, and random gene sets ignore gene correlation.
- **Validation scope.** Validation uses 163 in vitro ligand-treatment settings, 52 of them CytoSig-derived [R5][R11]. Multi-ligand microenvironments in vivo are not represented.

Model-based alternatives exist: multi-ligand classifiers in nichenetr and linear-model estimators in decoupler [R7][R11]. Genetic perturbation designs such as Perturb-seq give an orthogonal ground truth [R10], but no perturbation benchmark is published here (section 10).

## 3. Theory and insight

Notation: $l$ candidate ligand, $v$ node of the signalling graph, $g$ gene, $\mathcal G^*$ receiver response gene set, $B$ background (genes expressed in the receiver), $d$ damping factor, $\pi_l$ personalised PageRank vector, $L$ truncated ligand-to-node matrix, $W$ weighted regulatory matrix, $S$ ligand-to-target matrix, $K$ number of random gene sets.

**Prior.** Ligand $l$ is the restart node of a random walk on the signalling graph, whose edges combine ligand-receptor and downstream signalling links (R/construct_ligand_to_target.R:45, :225). The stationary distribution is

$$\pi_l=d\,P^{\top}\pi_l+(1-d)\,e_l,$$

where $P$ is the row-normalised weighted adjacency matrix and $e_l$ is the indicator of the ligand node (R/supporting_functions.R:371-374). The restart is at the ligand itself; receptors are reached through ligand-receptor edges, not seeded. The solution is unique for $d<1$. The expected number of steps per restart cycle is $1/(1-d)$, which equals 2 at $d=0.5$, so the profile is local.

**Truncation and aggregation.** Each row is truncated at the $\tau$ quantile over graph nodes, $L_{l,v}=\pi_{l,v}\mathbf 1[\pi_{l,v}>q_\tau(\pi_l)]$, with $\tau$ the ltf_cutoff (R/supporting_functions.R:364-366). The ligand-to-target matrix is $S_1=LW$, with $W$ the weighted regulatory matrix (R/construct_ligand_to_target.R:296, :436). If second-order targets are requested, $S=\big(S_1^{-1}+S_2^{-1}\big)^{-1}$, where $S_2$ is the same product with $L$ replaced by a truncated copy of $S_1$ (R/construct_ligand_to_target.R:439-458). The estimand of $S_{g,l}$ is the sum over regulatory nodes of truncated PageRank mass times regulatory weight: non-negative and unnormalised, comparable within one prior and not across priors. For a group of ligands the PageRank vector is the mean of the members' truncated vectors, although the adjacent comment says maximum (R/supporting_functions.R:368-369). Hub correction (apply_hub_corrections, R/construct_ligand_to_target.R:121) has no default. Topology correction subtracts global PageRank target scores (correct_topology_ppr, R/construct_ligand_to_target.R:494); it is recommended for matrices built without a cutoff and is not on the default path.

**Ranking statistics.** For each ligand the response is a binary label on genes in $B$ and the score is $S_{\cdot,l}$. The AUROC is the Mann-Whitney probability

$$\mathrm{AUROC}_l=\Pr\big(S_{g^{+},l}>S_{g^{-},l}\big)+\tfrac12\Pr\big(S_{g^{+},l}=S_{g^{-},l}\big),\qquad g^{+}\in\mathcal G^*,\; g^{-}\in B\setminus\mathcal G^*,$$

integrated by the trapezoid rule over the ROC curve (R/supporting_functions.R:457-465). The AUPR is integrated over the precision-recall curve and corrected by the prevalence $\pi_0=\lvert\mathcal G^*\rvert/\lvert B\rvert$:

$$\mathrm{AUPR}^{c}_l=\int_0^1\mathrm{Prec}_l(r)\,dr-\pi_0 .$$

(R/supporting_functions.R:522-525, :585). Regime: $\pi_0$ is the expected average precision of a random ranking to first order. $\mathrm{AUPR}^c$ lies in $[-\pi_0,\,1-\pi_0]$, is not normalised to one, and its variance grows when $\lvert\mathcal G^*\rvert$ is small. The activity ranking is $\hat l=\arg\max_{l\in\mathcal L}\mathrm{AUPR}^c_l$ over the candidate set $\mathcal L$. It is an ordering, not a likelihood, and carries no posterior uncertainty.

**Bootstrap p-value.** The null draws $K$ random gene sets of size $\lvert\mathcal G^*\rvert$ from the receiver's expressed genes (R/application_prediction.R:492) and recomputes the metric. The code returns

$$p_l=\frac{\#\{k:\ \mathrm{AUPR}^{c,(k)}_l>\mathrm{AUPR}^{c}_l\}}{K}$$

(R/application_prediction.R:573-582), with default $K=10$ (R/application_prediction.R:508). The attainable values are $0,1/K,\dots,1$, so $p=0$ occurs and the smallest non-zero value is 0.1. The singlet implementation uses $(1+\#)/(K+1)$, which never returns zero. Regime: the null is valid when random gene sets are exchangeable with $\mathcal G^*$, which fails when $\mathcal G^*$ is enriched for high-degree prior nodes.

**Evaluation estimands.** For target-level evaluation, the label of gene $g$ in setting $s$ is 1 when $g$ is differentially expressed in $s$ and 0 otherwise, over genes present in the prior, and the statistic is the AUROC or AUPR$^c$ of $S_{g,l^{+}}$ for the applied ligand $l^{+}$ against that label (R/evaluate_model_target_prediction.R:128). For ligand-level evaluation, the label of ligand $l$ in setting $s$ is 1 when $l$ is applied in $s$, the statistic is the AUROC of an importance measure over pooled ligand-setting pairs with normalisation set to no (R/evaluate_model_ligand_prediction.R:284), and positives are identified by is_ligand_active (R/supporting_functions.R:966-972). The workbook writes multi-ligand treatments with "+", whereas the code joins and splits ligand sets with "-" (R/supporting_functions.R:912, :966-972), so labels must be normalised before scoring.

**Model-based view.** Let $y_g$ be a signed response statistic per gene and $P$ the prior with one column per ligand. The heuristic scores each column separately, so a ligand that shares targets with a stronger ligand also scores well. A linear model $y=P\beta+\varepsilon$ with a sparse prior on $\beta$ allocates shared signal among ligands, gives posterior intervals, and admits covariates such as sender expression. Its regime is additivity of ligand contributions and linearity of the prior; synergy and non-additive signalling violate it. The decoupler ULM and MLM estimators are linear models of this form, fitted per ligand or jointly [R7][R13].

**Assumptions and failure modes.** The prior is an unbiased measure of regulatory potential; the response set reflects ligand-induced transcription; the background is the receiver's expressed genes; activity is independent of sender abundance; random gene sets are exchangeable with the response. High-degree targets (broad immediate-early or interferon genes) inflate AUPR. Non-ligand programmes such as cell cycle, stress, batch or dissociation produce false activity. Broadly acting ligands rank high across settings: TNF and IFNG are the sole ligand in 10 and 8 validation settings (16 and 9 counting multi-ligand labels). Sparse priors give unstable profiles, the first-order prevalence correction is not comparable across set sizes, and ties after the cutoff make AUROC and AUPR depend on the tie convention.

**Insight.** The score is a retrieval statistic over a fixed prior. Its information content is the prior's quality and the match between ligand-specific diffusion profiles and observed responses. The repository evaluates six importance measures (AUROC, AUPR$^c$, two correlations, mean-rank enrichment and AUC-iRegulon) [R11], but the score has no fitted likelihood, no sender term and no uncertainty beyond empirical random-set nulls. Benchmarks should therefore report popularity and set size alongside accuracy, because a prior-dependent score can track gene popularity.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| NicheNet ligand activity (nichenetr) | heuristic | Personalised PageRank profile per ligand, truncated and multiplied by the regulatory network, ranked by corrected AUPR against the response with a random-set bootstrap | [R1][R2][R11] |
| MultiNicheNet ligand-activity step | heuristic | Selects response genes by logFC and p-value thresholds per receiver, then calls the nichenetr scoring inside a multi-sample framework | [R6][R12] |
| nichenetr multi-ligand classifier | model-based | Caret classifier over ligand-target feature vectors predicting response membership (`get_multi_ligand_importances`) | [R11] |
| decoupler ULM | model-based | One univariate linear model per ligand over its weighted targets; the t-value is the activity | [R7][R13] |
| decoupler MLM | model-based | All ligands fitted jointly in one multivariate linear model over the response | [R7][R13] |

The NicheNet AUPR$^c$ ranking is the published standard and the default here. The MultiNicheNet step reuses its response-gene thresholds. The nichenetr classifier is a benchmark callout only. ULM and MLM are implemented in singlet. Other tools that pair ligand-receptor and transcription-factor activities, such as CellCall [R9], are not compared because their scoring was not reviewed. The defaults below are taken from source.

| Method | Parameter | Value | Source (file:line @ sha) |
|---|---|---|---|
| construct_ligand_target_matrix | ltf_cutoff | 0.99 | `R/construct_ligand_to_target.R:375` @ 66f90d5 |
| construct_ligand_target_matrix | algorithm | PPR | `R/construct_ligand_to_target.R:375` @ 66f90d5 |
| construct_ligand_target_matrix | damping_factor | 0.5 | `R/construct_ligand_to_target.R:375` @ 66f90d5 |
| construct_ligand_target_matrix | secondary_targets | FALSE | `R/construct_ligand_to_target.R:375` @ 66f90d5 |
| PPR restart vector | seed | one-hot on the ligand node | `R/supporting_functions.R:373` @ 66f90d5 |
| PPR truncation | scope | quantile over all graph nodes; values at or below it set to zero | `R/supporting_functions.R:364-366` @ 66f90d5 |
| predict_ligand_activities | single | TRUE | `R/application_prediction.R:85` @ 66f90d5 |
| bootstrap_ligand_activity_analysis | n_iter | 10 | `R/application_prediction.R:508` @ 66f90d5 |
| calculate_p_value_bootstrap | metric | aupr_corrected | `R/application_prediction.R:573` @ 66f90d5 |
| calculate_p_value_bootstrap | p-value | count above observed divided by n_iter | `R/application_prediction.R:573-582` @ 66f90d5 |
| get_multi_ligand_importances | cv, cv_number, cv_repeats | TRUE, 4, 2 | `R/evaluate_model_ligand_prediction.R:146` @ 66f90d5 |
| get_multi_ligand_importances | continuous, known, filter_genes | TRUE, TRUE, FALSE | `R/evaluate_model_ligand_prediction.R:146` @ 66f90d5 |
| get_ligand_activities_targets_DEgenes | logFC_threshold, p_val_threshold | 0.50, 0.05 | `R/ligand_activities.R:49` @ f1db92c |
| get_ligand_activities_targets_DEgenes | p_val_adj, top_n_target | FALSE, 250 | `R/ligand_activities.R:49` @ f1db92c |
| vignette ligand selection | top_n | 30 | `vignettes/ligand_activity_geneset.Rmd:177` @ 66f90d5 |
| decoupler run wrapper | tmin | 5 | `src/decoupler/mt/_run.py:48` @ 3132edc |

## 5. Proposed singlet approach

**Routes.** `nichenet_aupr` is reimplemented from the equations of section 3 and the defaults above, not copied (section 12). ULM and MLM are ported from decoupler (section 12). The nichenetr classifier and the MultiNicheNet pipeline are benchmark callouts only and are not exposed as methods.

**Default.** `method = nichenet_aupr` with the prior at ltf_cutoff 0.99 and damping 0.5, response genes selected from the receiver DE table with the MultiNicheNet thresholds, background equal to the receiver's expressed genes, and the bootstrap p-value $(1+\#)/(K+1)$. The production value of $K$ is 1000 instead of nichenetr's 10, because with $K=10$ the p-value resolution is too coarse for ranking ties. This choice is a proposal.

**Model-based route (proposed, not default).** Fit $y=P\beta+\varepsilon$ with $y$ the signed DE statistic per gene, $P$ the prior restricted to genes in $B$, and a spike-and-slab or horseshoe prior on $\beta$, using variational inference or a Laplace approximation to give per-ligand inclusion probabilities and intervals. The route becomes the default only if it meets the B1 and B2 criteria in section 8 without trailing `nichenet_aupr` by more than 0.02 AUROC. On the B3 null its interval coverage must be within 0.03 of nominal (proposed). Otherwise the heuristic stays the default and the model is dropped. The 163 workbook settings are held out for evaluation, so training needs catalogue responses with matched stimulation labels (section 10).

**Stack and kernels.** The heuristic path needs no neural network. It is implemented in C++ on CPU, with CUDA kernels for the hot steps: sparse matrix-vector products for PPR power iteration (cuSPARSE), per-row quantile truncation (segmented selection), batched AUPR and AUROC by segmented sort and cumulative sums, and random gene-set sampling with a counter-based generator. PyTorch is used only for the optional model-based route, at build time. Streaming is not needed, because the prior is a ligand-by-node matrix and the DE table is already aggregated.

**Defaults without asking.** `method=nichenet_aupr`, the prior options of section 4, the `de` thresholds of section 4, `bootstrap.n_iter=1000`, `bootstrap.metric=aupr_corrected`, `candidates.top_n_ligands=30` and `seed=0`. Ask for `receiver`, and for `candidates.senders` when the candidate set should be restricted. Use `dry_run` before building a prior.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse non-negative integer | raw counts, used only for candidate-ligand expression in senders |
| read | obs/<cell_type_key> | categorical | sender and receiver labels |
| read | uns/receiver_de/<receiver> | table | per-gene `gene`, `log_fc`, `pvalue`, `padj` for the receiver response |
| read | uns/expressed_genes_receiver/<receiver> | string vector | background B, genes expressed in the receiver |
| read | uns/lr_network, uns/signaling_network, uns/gr_network | tables | weighted ligand-receptor, signalling and regulatory edges with source |
| read | uns/source_weights | table | per-source weights used in network integration |
| read | models/ligand_target_matrix | sparse float, genes by ligands | prior; built from the networks when absent |
| write | uns/ligand_activities/<receiver> | table | `test_ligand`, `auroc`, `aupr_corrected`, `p_value_bootstrap`, `rank` |
| write | uns/ligand_target_links/<receiver> | table | `ligand`, `target`, `score` for the top candidate ligands |
| write | models/ligand_target_matrix | sparse float | the prior, with its parameter record, when built here |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `receiver` | string | required | — | Receiver cell-type label whose DE table defines the response gene set. |
| `method` | string | "nichenet_aupr" | `nichenet_aupr`, `ulm`, `mlm` | nichenet_aupr is the published default; ulm and mlm are linear-model comparators. |
| `de` | object | — | — | Thresholds that select response genes from the receiver DE table. |
| `de.logfc_threshold` | number | 0.5 | min 0 | Minimum absolute log fold change for a response gene. |
| `de.pvalue_threshold` | number | 0.05 | min 0; max 1 | P-value threshold for a response gene. |
| `de.use_adjusted_pvalue` | boolean | false | — | Apply the p-value threshold to adjusted p-values. |
| `de.top_n_targets` | integer | 250 | min 1 | Number of top response genes kept for ligand-target links. |
| `prior` | object | — | — | Prior construction options; used only when the prior is built here. |
| `prior.ltf_cutoff` | number | 0.99 | min 0; max 1 | Quantile below which ligand-to-node PageRank scores are set to zero. |
| `prior.damping_factor` | number | 0.5 | min 0; < 1 | Probability that the random walker continues; restart probability is one minus this. |
| `prior.secondary_targets` | boolean | false | — | Include second-order targets in the ligand-target matrix. |
| `bootstrap` | object | — | — | Random gene-set null used for nichenet_aupr p-values. |
| `bootstrap.n_iter` | integer | 1000 | min 10 | Number of random gene sets of equal size drawn from receiver expressed genes. |
| `bootstrap.metric` | string | "aupr_corrected" | `aupr_corrected`, `auroc` | Ligand activity metric compared against the null. |
| `candidates` | object | — | — | Candidate ligand set and the number of ligands reported. |
| `candidates.senders` | array | — | — | Sender cell-type labels whose expressed ligands are candidates; if omitted, all ligands in the prior are candidates. |
| `candidates.top_n_ligands` | integer | 30 | min 1 | Number of top-ranked ligands reported with their target links. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for the bootstrap null gene sets. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

The receiver DE table is precomputed and aggregated, so the score does not read cells. Prior options apply only when the prior is built here; a stored prior keeps its own record. Bootstrap options apply to `nichenet_aupr`; `ulm` and `mlm` return model t-values without a bootstrap. The `candidates.senders` option changes the candidate set and therefore the chance level of every metric.

## 7. MCP tool

Tool name `singlet_communication_ligand_activity_inference` (definition in `tasks/mcp/singlet_communication_ligand_activity_inference.json`).

```json
{"dataset": "./example_pbmc.singlet", "receiver": "CD14 monocytes", "method": "nichenet_aupr",
 "candidates": {"senders": ["T cells"], "top_n_ligands": 30}, "seed": 0}
```

```json
{"dataset": "./example_pbmc.singlet", "status": "completed",
 "wrote": ["uns/ligand_activities/CD14 monocytes", "uns/ligand_target_links/CD14 monocytes"],
 "summary": {"method": "nichenet_aupr", "receiver": "CD14 monocytes", "n_candidate_ligands": "<int>",
  "n_response_genes": "<int>", "n_background_genes": "<int>",
  "top_ligands": [{"ligand": "<name>", "aupr_corrected": "<float>", "p_value_bootstrap": "<float>"}],
  "warnings": []}, "provenance_id": "<id>", "job_id": null}
```

Long-running: prior construction for a full graph is queued with a `job_id`; activity on a stored prior runs inline. Stochastic: the bootstrap null depends on `seed`. Dry run: returns estimated seconds, peak memory in gigabytes and the device chosen.

## 8. Benchmarks

**Shared protocol.** Every benchmark uses the section 4 defaults unless stated, the same DE and expression thresholds for every method, and seed 0 for bootstrap nulls with $K=1000$. The prior is the ligand-target matrix that the repository vignette links on Zenodo, DOI 10.5281/zenodo.7074290 [R11], unless stated. Confidence intervals are bootstrap intervals over settings, with 2000 resamples (proposed). Chance levels are AUROC 0.5, AUPR$^c$ 0 and correlation 0. Comparators are `nichenet_aupr` (the singlet reimplementation and the nichenetr function on identical inputs), `ulm` and `mlm` on the same prior. The settings come from the repository workbook `vignettes/evaluation_datasets.xlsx`, which lists 163 ligand-treatment settings, 111 NicheNet-collected and 52 CytoSig-derived [R11].

### B1. Target-gene prediction across ligand-treatment settings (published)

- **Goal**: test whether the ligand-to-target scores rank the differentially expressed genes of each treatment above the others.
- **Ground truth**: orthogonal measurement. The label of gene $g$ in setting $s$ is 1 when $g$ is differentially expressed in the setting's table as converted by the repository (R/evaluate_model_target_prediction.R:76), and 0 otherwise, over genes present in the prior. The estimand is one AUROC and one AUPR$^c$ per setting, for the applied ligand's scores $S_{g,l^{+}}$; ties receive trapezoid midranks.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| NicheNet-collected ligand-treatment settings | `vignettes/evaluation_datasets.xlsx` and data object `expression_settings_validation` (R/data.R:31) [R11] | Cultured cells, ligand versus control; 111 settings | — | 103 of 163 setting identifiers contain a GSE accession |
| CytoSig-derived settings | workbook `source = CytoSig` [R11]; compendium [R5] | Cytokine responses; 52 settings | — | Reported separately from the NicheNet-collected subset |
| Ligand-target matrix and networks | Zenodo 7074290 (matrix) and 7074291 (networks) [R11] | Prior matrix and network records, not data | — | Prior matrix is the default; Zenodo 3260758 holds example expression data |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC per setting | AUROC of $S_{g,l^{+}}$ for the DE label | maximise; chance 0.5 | primary | [R11] |
| AUPR$^c$ per setting | $\int\mathrm{Prec}\,dr-\pi_0$ for the same label, $\pi_0$ the DE fraction | maximise; chance 0 | primary | [R11] |
| Pearson and Spearman | correlation of $S_{g,l^{+}}$ with the 0/1 label | maximise; chance 0 | guardrail | [R11] |
| Popularity slope | slope of AUPR$^c$ on quantile bins of log citation count per target gene (R/calculate_popularity_bias.R:160) | minimise absolute slope | guardrail | [R11] |

- **Comparators**: other prior matrices (version labels not confirmed in the repository); `ulm` and `mlm` on the same prior.
- **Protocol**: convert each setting, restrict to genes in the matrix, label DE genes, evaluate with `evaluate_target_prediction` (R/evaluate_model_target_prediction.R:128), summarise over the 163 settings and compare matrices with paired tests across settings. Report the CytoSig and NicheNet-collected subsets side by side.
- **Acceptance criterion** (proposed): for the default prior, AUROC above 0.5 and AUPR$^c$ above 0 in at least 75 percent of settings, with a bootstrap 95 percent interval of the median excluding chance. A new matrix is accepted only if its median AUPR$^c$ is not lower than the reference by more than 0.02.
- **Known pitfalls**: popularity bias, measured by the slope metric above; prior leakage from the same experiments (section 10).

### B2. Active-ligand recovery across the same settings (published protocol)

- **Goal**: test whether an importance measure ranks the applied ligand above the other candidates in the same setting.
- **Ground truth**: orthogonal measurement. The label of ligand $l$ in setting $s$ is 1 when $l$ is applied in $s$ (workbook ligand column, with multi-ligand labels joined as in section 3) and 0 otherwise. The estimand is the AUROC of the importance measure over pooled ligand-setting pairs, on its raw scale because normalisation is set to no.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Ligand-treatment settings | workbook sheet "Ligand Treatment Datasets" [R11] | As B1; 163 settings | — | Ten rows carry multi-ligand labels joined with "+" |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC of the importance measure | pooled ligand-setting pairs; positive when applied | maximise; chance 0.5 | primary | [R11] |
| AUPR$^c$, same pairs | $\int\mathrm{Prec}\,dr-\pi_0$ with $\pi_0$ the applied fraction | maximise; chance 0 | primary | [R11] |
| Top-30 recovery | fraction of settings where the applied ligand is in the top 30 by AUPR$^c$ | maximise | guardrail | [R11] |

- **Comparators**: `nichenet_aupr` (singlet and nichenetr), `ulm`, `mlm`, and the nichenetr measures Pearson, Spearman, mean-rank enrichment and AUC-iRegulon.
- **Protocol**: build each setting's candidate set, compute per-setting importances with `get_single_ligand_importances` (R/evaluate_model_ligand_prediction.R:94), pool, and evaluate with `evaluate_single_importances_ligand_prediction` (R/evaluate_model_ligand_prediction.R:284) with normalisation set to no. Report the candidate count per setting.
- **Acceptance criterion** (proposed): AUROC above 0.5 with a bootstrap interval over settings excluding 0.5, and the applied ligand in the top 30 in at least 50 percent of settings. The 30 follows the repository vignette (vignettes/ligand_activity_geneset.Rmd:177); the 50 percent threshold is proposed.
- **Known pitfalls**: broadly active ligands inflate pooled performance, so TNF (10 settings with TNF as the sole ligand, 16 with it in a multi-ligand label) and IFNG (8; 9) should be reported separately. The candidate count changes the chance level. Multi-ligand settings need the joined label and the group rule of section 3.

### B3. Planted-ligand recovery in simulation (proposed)

- **Goal**: measure recovery and false positives when the planted ligand and its target set are known by construction.
- **Ground truth**: planted simulation from a generator built independently of the scoring prior. The positive is the planted ligand among the candidates; the estimand is its AUPR$^c$ over candidates and its bootstrap p-value.
- **Generator recipe**: (1) build a generator prior from the integrated network with one data source removed, the source being fixed before scoring; (2) for each planted ligand, take the 100 highest-scoring targets $T_\ell$ of its generator column; (3) in one real receiver background from B1, add $\lambda\cdot\delta$ to the signed statistic of $T_\ell$, for $\lambda\in\{0,0.5,1,2\}$ and a fixed effect $\delta$, plus Gaussian noise with the standard deviation of the B1 statistics (proposed); (4) score with the full prior and 100 candidate ligands per run, including the planted one; (5) repeat over 50 seeds per $\lambda$.

- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated receivers | generator above; background from one B1 setting [R11] | Simulated; 100 candidates per run; 50 seeds per effect size | — | No accession; generator fixed in the protocol |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| AUPR$^c$ for the planted ligand | $\int\mathrm{Prec}\,dr-\pi_0$ with $\pi_0=1/100$ | maximise; chance 0 | primary | [R11] |
| Top-10 recovery | fraction of runs with the planted ligand in the top 10 | maximise | guardrail | — |
| False-positive rate at $\lambda=0$ | fraction of runs with bootstrap p at most 0.05 | at most 0.07 | primary | — |

- **Comparators**: `nichenet_aupr`, `ulm`, `mlm`, on identical DE tables.
- **Protocol**: as the recipe; hold fixed the prior, ltf_cutoff 0.99, damping 0.5, background, $K=1000$ and seeds 0 to 49.
- **Acceptance criterion** (proposed): AUPR$^c$ above 0 at every $\lambda$; top-10 recovery at least 0.8 at $\lambda=2$; false-positive rate at $\lambda=0$ at most 0.07.
- **Known pitfalls**: the generator shares literature with the scoring prior, which reduces circularity without removing it. Targets are prior-shaped by construction, so B3 tests robustness to a removed source rather than biology; B2 remains the primary evidence.

### P1. Performance and scaling

Measure wall time and peak memory on CPU and CUDA for prior construction and for activity, sweeping the number of candidate ligands up to the full prior, the background size, the response-set size, and $K$ at 10, 100 and 1000. Report the stages separately. Comparators on identical inputs are nichenetr `predict_ligand_activities`, the MultiNicheNet ligand-activity step on identical DE tables, and decoupler ULM and MLM on the same prior. Hold fixed the prior, ltf_cutoff 0.99, damping 0.5, background and seed. Correctness: per-ligand AUPR$^c$ agrees with nichenetr on identical inputs at Pearson correlation of at least 0.999 (proposed tolerance). Derived cost: the activity stage sorts $\lvert B\rvert$ scores per ligand, so one gene-set evaluation costs $O(\lvert\mathcal L\rvert\,\lvert B\rvert\log\lvert B\rvert)$, and cell count does not enter.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `communication.lr_resource_curation`: Ligand-receptor resource curation and harmonisation
  - `grn.prior_network_curation`: Curated TF-target prior network (regulon resource) construction
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
- **Feeds**:
  - `communication.consensus_interaction_ranking`: Consensus ranking of interactions across communication methods
  - `communication.lr_interaction_scoring`: Sender-receiver ligand-receptor interaction scoring
- **Reads**: `layers/counts`, `obs/<cell_type_key>`, `uns/receiver_de/<receiver>`, `uns/expressed_genes_receiver/<receiver>`, `uns/lr_network`, `uns/signaling_network`, `uns/gr_network`, `uns/source_weights`, `models/ligand_target_matrix`
- **Writes**: `uns/ligand_activities/<receiver>`, `uns/ligand_target_links/<receiver>`, `models/ligand_target_matrix`
<!-- CHAINING:AUTO:END -->

Belongs to the cell-cell communication workflow: receiver DE, then ligand activity, then ligand-receptor and consensus ranking.

## 10. Risks, pitfalls and open questions

- **Sources not fully read.** The CytoSig regression form is not established from its paper text, so CytoSig appears only as the origin of 52 settings. Domino, scMLnet and CellCall scoring is not reviewed. The MultiNicheNet entry rests on its 2023 preprint with an incomplete author list. The DOI of [R5] is not confirmed and is omitted; the year and author list of [R2] are not confirmed locally. Counts of settings and of TNF and IFNG labels were recounted from `vignettes/evaluation_datasets.xlsx` at nichenetr 66f90d5; the workbook's provenance is not documented locally.
- **Licence and data terms.** The licence question for nichenetr is set out in section 12. The terms of Zenodo records 3260758, 7074290 and 7074291 are unchecked, so redistribution of the validation data is undecided.
- **Prior leakage.** The literature behind the prior may include the ligand-treatment experiments used in B1 and B2. The overlap is not measured, so every validation number carries this caveat.
- **Catalogue and dataset gaps.** Whether the singlet catalogue carries matched ligand or cytokine stimulation labels is unverified, which leaves the model-based route without a training source. The Dixit et al. 2016 dataset identity (cell line and accession) is not established, so no perturbation benchmark is published.
- **Unsettled science and first experiment.** The score ignores sender expression, and the protocol's sender-agnostic and sender-focused modes [R2] are not reproduced here. First, reimplement `nichenet_aupr` and check per-ligand AUPR$^c$ agreement with nichenetr on identical inputs (Pearson at least 0.999). Then run B2 on the 163 settings with the $(1+\#)/(K+1)$ p-value, before any model-based work.

## 11. References

R1. Browaeys R, Saelens W, Saeys Y. NicheNet: modeling intercellular communication by linking ligands to target genes. *Nature Methods* 2020;17:159-162. doi:10.1038/s41592-019-0667-5 — partial (corpus)

R2. Sang-aram C, Browaeys R, Seurinck R, Saeys Y (authors not confirmed locally). Unraveling cell-cell communication with NicheNet by inferring active ligands from transcriptomics data. *Nature Protocols*, year not confirmed. doi:10.1038/s41596-024-01121-9 (link in the nichenetr README) — partial (repo)

R3. Armingol E, Officer A, Harismendy O, Lewis NE. Deciphering cell-cell interactions and communication from gene expression. *Nature Reviews Genetics* 2021;22:71-88. doi:10.1038/s41576-020-00292-x — partial (corpus)

R4. Wang S, Zheng H, Choi JS, Lee JK, Li X, Hu H. A systematic evaluation of the computational tools for ligand-receptor-based cell-cell interaction inference. *Briefings in Functional Genomics* 2022. doi:10.1093/bfgp/elac019 — partial (corpus)

R5. Jiang P, Zhang Y, Ru B, Yang Y, Vu T, Paul R, et al. Systematic investigation of cytokine signaling activity at the tissue and single-cell levels. *Nature Methods* 18:1181-1191 (2021). DOI not confirmed and omitted — partial (corpus)

R6. Browaeys R, et al. MultiNicheNet: a flexible framework for differential cell-cell communication analysis from multi-sample multi-condition single-cell transcriptomics data. bioRxiv preprint 2023. doi:10.1101/2023.06.13.544751 — partial (corpus)

R7. Badia-i-Mompel P, Velez Santiago J, Braunger J, Geiss C, Dimitrov D, Muller-Dott S, et al. decoupleR: ensemble of computational methods to infer biological activities from omics data. *Bioinformatics Advances* 2022. doi:10.1093/bioadv/vbac016 — partial (corpus)

R8. Türei D, Valdeolivas A, Gul L, Palacio-Escat N, Klein M, Ivanova O, et al. Integrated intra- and intercellular signaling knowledge for multicellular omics analysis. *Molecular Systems Biology* 2021. doi:10.15252/msb.20209923 — partial (corpus)

R9. Zhang Y, Liu T, Hu X, Wang M, Wang J, Zou B, et al. CellCall: integrating paired ligand-receptor and transcription factor activities for cell-cell communication. *Nucleic Acids Research* 2021. doi:10.1093/nar/gkab638 — partial (corpus)

R10. Dixit A, Parnas O, Li B, Chen J, Fulco CP, Jerby-Arnon L, et al. Perturb-Seq: dissecting molecular circuits with scalable single-cell RNA profiling of pooled genetic screens. *Cell* 2016. doi:10.1016/j.cell.2016.11.038 — partial (corpus)

R11. Browaeys R, Sang-aram C. nichenetr: modeling intercellular communication by linking ligands to target genes with NicheNet. R package version 2.2.1.1, repository saeyslab/nichenetr at commit 66f90d5. https://github.com/saeyslab/nichenetr — partial (repo)

R12. Browaeys R. multinichenetr: MultiNicheNet R package, version 2.1.0. Repository saeyslab/multinichenetr at commit f1db92c. https://github.com/saeyslab/multinichenetr — partial (repo)

R13. Badia-i-Mompel P, the Saez lab and scverse contributors. decoupler: ensemble of methods to infer enrichment scores, version 2.2.1. Repository scverse/decoupler at commit 3132edc. https://github.com/scverse/decoupler — partial (repo)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/saeyslab/nichenetr @ 66f90d5 | Robin Browaeys (aut); Chananchida Sang-aram (aut, cre), per DESCRIPTION | GPL-3 per DESCRIPTION; no LICENSE file at the repository root, so the declaration is unbacked | reference prior and AUPR$^c$ score; benchmark source | reimplement |
| https://github.com/saeyslab/multinichenetr @ f1db92c | Robin Browaeys (author and maintainer), per DESCRIPTION | GPL-3 (LICENSE file present; DESCRIPTION says GPL-3 + file LICENSE) | response-gene thresholds; pipeline comparator | callout |
| https://github.com/scverse/decoupler @ 3132edc | Pau Badia i Mompel and the Saez lab; scverse contributors (LICENSE copyright lines) | BSD-3-Clause (LICENSE) | ULM and MLM activity estimators | port |
