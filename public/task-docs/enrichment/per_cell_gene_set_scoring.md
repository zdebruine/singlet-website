---
id: enrichment.per_cell_gene_set_scoring
title: Per-cell gene set activity scoring (covariate-robust, null-calibrated)
area: enrichment
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [normalization.size_factor_estimation, enrichment.pathway_resource_curation]
feeds: [enrichment.differential_pathway_activity, enrichment.pseudobulk_pathway_scoring, annotation.marker_based_cell_assignment]
reads: [layers/counts, layers/lognorm, uns/gene_sets]
writes: [obsm/gene_set_score, uns/gene_set_score_names, obs/<set>_active, obsm/gene_set_null_z, uns/gene_set_score_params]
devices: [cpu, cuda]
mcp_tool: singlet_enrichment_per_cell_gene_set_scoring
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Per-cell gene set activity scoring

> Scores every cell for a predefined, optionally signed, gene set, with a rank-based heuristic as the default and a proposed null-calibrated, covariate-aware model as the candidate improvement.

## 1. Question

For each cell $c$ and each gene set $G$ with up members $G^+$ and optional down members $G^-$, what is the activity $S_c(G)$ such that cells rank by their true activity and the score stays independent of set size, member detection rate, depth, cell cycle and QC covariates? The input is a cells-by-genes count or log-normalised matrix and a gene-set collection. The output is a cells-by-sets matrix, optional binary calls and optional matched-null z-scores. No accepted per-cell ground truth exists, so a correct answer is judged against planted activity, perturbation labels and held-out annotations (section 8).

## 2. Why this task matters and where the field stands

Per-cell gene-set scores turn a gene list into one number per cell, which is used to annotate cell states, read out pathway activity and interpret programs. The control-subtracted mean of Seurat and scanpy is the reference scheme [R1]. Rank-based and standardised alternatives [R3][R4][R5] produce values on different scales, so a score from one tool cannot be read against another's.

The task is **contested**. Holland et al. [R2] benchmarked bulk-derived TF and pathway tools against SCENIC/AUCell on simulated and CRISPR knock-out single-cell data and report performance comparable to the original bulk data. Zhang et al. [R6] benchmark pathway activity transformation methods on single-cell data. Gene-set overdispersion testing [R7] asks whether a set varies across cells more than a background, which is a test over sets rather than a score per cell. Open problems:

- No accepted per-cell ground truth exists; the closest published check uses perturbation status [R2].
- Independence from detection rate and depth is untested for most scorers.
- Set-size dependence, zero ties and the choice of control pool change scores, and no correction is settled.
- Signed sets have no shared convention among scorers.

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $N$ | number of cells |
| $n$ | members of a set present in the data |
| $x_{gc}$ | expression of gene $g$ in cell $c$ on the scoring scale |
| $r_{ic}$ | rank of member $i$ in cell $c$; 1 is highest, ties averaged |
| $z_c$, $\beta_{kc}$ | planted per-cell activity (simulation); per-cell activity of set $k$ (proposed model) |
| $s_c$, $b_g$ | size factor of cell $c$; baseline of gene $g$ (proposed model) |

**Control-subtracted mean** (AddModuleScore, score_genes):

$$S_c(G)=\frac{1}{n}\sum_{g\in G}x_{gc}-\frac{1}{|C_G|}\sum_{h\in C_G}x_{hc}$$

$C_G$ holds control genes drawn from the expression bin of each member. The score estimates the member mean minus the mean expected from genes at the same average level, on the input scale. Regime: first order, valid when controls match members in mean expression and expression is additive on that scale. When members and controls have different detection rates, dropout moves the two means differently, so the score tracks detection even when activity is constant.

**UCell** (Mann-Whitney statistic on ranks):

$$U_c=\sum_{i=1}^{n}r_{ic}-\frac{n(n+1)}{2},\qquad \mathrm{UCell}_c=1-\frac{U_c}{U_{\max}},\qquad U_{\max}=n\,\mathrm{maxRank}-\frac{n(n+1)}{2}$$

The score is one minus the normalised count of non-members that outrank members, with ranks capped at maxRank, so 1 means all members occupy the top ranks. It is exact for the capped statistic and depends only on the order of genes within a cell, so any monotone transform of the matrix leaves it unchanged. Zeros are tied, so detection still enters.

**AUCell recovery area** (decoupler): with $q_{(1)}<\dots<q_{(m_c)}$ the ordinal ranks of the $m_c$ members inside the top $n_{\mathrm{up}}$,

$$\mathrm{AUC}_c=\frac{\sum_{k=1}^{m_c}k\,\bigl(q_{(k+1)}-q_{(k)}\bigr)}{A_{\max}},\qquad q_{(m_c+1)}=n_{\mathrm{up}}$$

where $A_{\max}$ is the same sum for members at ranks $1,\dots,\min(n,n_{\mathrm{up}}-1)$. The score is normalised by the maximum area, so 1 means members occupy the top ranks. Ordinal ranks break ties by gene index, so among sparse cells the order is arbitrary.

**Standardised mean** (decoupler zscore, default RoKAI flavour):

$$\mathrm{ES}_c=\frac{(\mu_{s,c}-\mu_{p,c})\sqrt{n}}{\sigma_c}$$

$\mu_{s,c}$ is the member mean, $\mu_{p,c}$ the mean over all features and $\sigma_c$ their standard deviation; the equation follows the code for the default flavour, and section 10 notes a docstring mismatch. Regime: first order and approximately normal features. The $\sqrt{n}$ factor makes raw values grow with set size, so they are not comparable across sets of different size without a size-dependent null.

**Proposed count model** (a singlet design, not a published method for this task):

$$x_{gc}\sim\mathrm{NB}(\mu_{gc},\phi_g),\qquad \log\mu_{gc}=\log s_c+b_g+\sum_k A_{gk}\beta_{kc}+\gamma^\top z_c$$

Here $A_{gk}=+1/|G_k^+|$ for up members, $-1/|G_k^-|$ for down members and 0 otherwise, and the covariates $z_c$ hold library size, detected-gene count and cell-cycle score. Regime: large $N$ and moderate counts. The ridge or Laplace posterior for $\beta_{kc}$ is approximately Gaussian when a set has many expressed members, and only then are its intervals valid. Covariate effects enter the fit directly rather than through residuals.

Estimands and normalisation, one sentence each:

- $\beta_{kc}$ is the per-cell shift of member log-mean along column $k$ of $A$, relative to $b_g$, with its level fixed by centring over the reference catalogue; identifiability requires that the columns of $A$ are not collinear.
- Each heuristic output estimates the quantity in its equation, and these quantities are not interchangeable across methods.
- Planted $z_c$ is standard normal across cells and drawn before library scale and dropout are applied.
- The Holland perturbation label is binary and fixed per simulated cell at generation.
- Author labels are categorical per cell and are scored as membership of one type within its study.
- A null z-score is $(S_{ck}-\mu_c)/\sigma_c$, where $\mu_c$ and $\sigma_c$ are the mean and standard deviation of matched random sets of the same size and detection profile.

Assumptions and failure modes by family:

- *Control-subtracted*: members and controls share average expression. The bin count and the control pool change the result, and scanpy's `ctrl_as_ref` preset changes it as well.
- *Rank*: members concentrate near the top of each cell's ranking within a fixed gene universe. Scores are relative to that universe and are invalid across universes, and zero ties are a failure point.
- *Standardised*: feature values are approximately normal and the set is small against the universe.
- *All*: depth and detection confounding; small sets have high variance and large sets dilute the signal; circularity when a set is derived from the differential expression that evaluates it; cell-cycle genes in a non-cycle set leak proliferation.

Heuristics are cheap, reproducible and interpretable, and they remain the comparators. Their weakness is the absence of a noise model, so none yields a calibrated probability per cell. A count model fitted with covariates models depth and detection effects directly, gives a posterior width per cell and, with an empirical null, gives z-scores comparable across set sizes. B2 tests these gains.

Control subtraction removes the expression baseline but is linear in dropout-affected values. Rank methods trade linearity for robustness to outliers and depth, but undetected genes tie at zero and cannot separate a cell's members from its background. Gene-set curation (enrichment.pathway_resource_curation, a dependency here) is part of this task's quality.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| AddModuleScore (Seurat) | heuristic | member mean minus expression-binned control genes | [R1] |
| score_genes (scanpy) | heuristic | the same control-gene scheme, sparse-aware | [R1] |
| UCell | heuristic | Mann-Whitney statistic on capped within-cell ranks, scaled to [0,1] | [R3] |
| AUCell (decoupler implementation) | heuristic | area under the recovery curve in the top-ranked fraction of genes | [R4] |
| zscore (decoupler) | heuristic | member mean standardised by the all-feature mean and SD, times $\sqrt{n}$ | [R5] |

The control-subtracted mean is the reference scheme of the Seurat and scanpy ecosystems [R1], and UCell is the rank-based scheme with a published formula [R3]. decoupler cites [R4] for AUCell and [R5] for zscore. Other methods are listed in section 10.

| Method | Parameter | Value | Source |
|---|---|---|---|
| AddModuleScore | nbin | 24 | R/utilities.R:314 @5f67c70 |
| AddModuleScore | ctrl | 100 | R/utilities.R:315 @5f67c70 |
| AddModuleScore | seed | 1 | R/utilities.R:318 @5f67c70 |
| score_genes | ctrl_size | 50 | src/scanpy/tools/_score_genes.py:102 @8ed52d9 |
| score_genes | n_bins | 25 | src/scanpy/tools/_score_genes.py:104 @8ed52d9 |
| score_genes | ctrl_as_ref | True (ScanpyV1, the default preset at src/scanpy/_settings/__init__.py:64); False (ScanpyV2Preview) | src/scanpy/_settings/presets.py:266-267 @8ed52d9 |
| UCell | maxRank | 1500 | R/ScoreSignatures_UCell.R:70 @f778e09 |
| UCell | assay | counts | R/ScoreSignatures_UCell.R:71 @f778e09 |
| UCell | chunk.size | 100 | R/ScoreSignatures_UCell.R:71 @f778e09 |
| UCell | ties.method | average | R/ScoreSignatures_UCell.R:74 @f778e09 |
| AUCell (decoupler) | n_up | ceil(0.05 × N_genes), clipped to [2, N_genes] | src/decoupler/mt/_aucell.py:47-49 @3132edc |
| AUCell (decoupler) | rank method | ordinal | src/decoupler/mt/_aucell.py:110 @3132edc |
| zscore (decoupler) | flavor | RoKAI | src/decoupler/mt/_zscore.py:13 @3132edc |

## 5. Proposed singlet approach

**Routes.** Port the control binning and score of AddModuleScore and score_genes, and the decoupler AUCell and zscore. Reimplement UCell from its published statistic rather than copying code. The aertslab AUCell, the Holland simulation code and Splatter are callouts, used as comparators or generators and never linked (licences in section 12).

**Default.** `ucell` on `layers/counts`: bounded in $[0,1]$, needs no control pool or per-gene centring, and its statistic is exact. Averaged ties are tested for detection dependence in B2, which decides whether it stays the default.

**Signed sets.** Each method scores the `up` and `down` lists with its own statistic and combines them as $S=S_{\mathrm{up}}-S_{\mathrm{down}}$, a singlet convention with no benchmark yet (section 10).

**Model-based formulation.** Step one is an empirical null: a small map learned on catalogue random sets gives per-cell $\mu_c$ and $\sigma_c$ from set size and member detection, and the z-score is reported (`null_n_sets`). Step two is the count model of section 3, with library size, detected-gene count and cell-cycle score as covariates. Neither enters the method enum until its code exists and is benchmarked. The count model is adopted only if B2 shows leakage of at most 0.10 and planted recovery within 0.05 of the best heuristic at effect 0.5. It is falsified if null rejection exceeds 0.08 at the nominal 0.05, and the heuristic then remains the default.

**ML stack.** PyTorch trains only the null map, a small MLP fitted offline. Hard-coded CUDA and cuSPARSE cover the per-cell kernels: the sparse product of counts with set indicators, segmented ranking for UCell and AUCell, and per-cell ridge solves for the count model. Heuristics need no training.

**Kernels, devices and streaming.** Segmented top-k ranking with the maxRank cap, CSR products, bin-matched control sampling with a seeded generator and per-set standardisation. Cells are processed in blocks, so memory scales with block size times set count. CPU and CUDA must agree to a relative 1e-5 (proposed).

**Agent defaults.** Method `ucell`, layer `counts`, set size 10 to 500 (design limits), no threshold, `null_n_sets` 0, seed 0, device `auto`.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts for ucell and aucell |
| read | layers/lognorm | sparse float | log-normalised expression for module-style methods |
| read | uns/gene_sets | dict | set name to `{"up": [...], "down": [...]}`; GMT files accepted, for example the Hallmark collection [R9] |
| write | obsm/gene_set_score | float32, cells × sets | per-cell score for each retained set |
| write | uns/gene_set_score_names | list of str | retained set names in column order |
| write | obs/<set>_active | bool | written only when `threshold` is set |
| write | obsm/gene_set_null_z | float32, cells × sets | written only when `null_n_sets` is above 0 |
| write | uns/gene_set_score_params | dict | method, version, parameters, input layer |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `layer` | string | "counts" | — | Input layer: counts for ucell and aucell; lognorm for module_score, score_genes and zscore. |
| `gene_sets` | string | "uns/gene_sets" | — | uns key of the gene-set collection, or a GMT file path; each set has up and down member lists. |
| `method` | string | "ucell" | `ucell`, `module_score`, `score_genes`, `aucell`, `zscore` | Scoring method. ucell is the default; the others exist for comparison and transfer checks. |
| `set_size` | object | {"min": 10, "max": 500} | — | Set size limits, counted on members present in the data. |
| `set_size.min` | integer | 10 | min 2 | Drop sets with fewer present members than this. |
| `set_size.max` | integer | 500 | min 2 | Drop sets with more present members than this. |
| `threshold` | number/null | null | — | Write obs/<set>_active where a score exceeds this value; null writes no calls. |
| `null_n_sets` | integer | 0 | min 0; max 1000 | Matched random sets for an empirical null z-score (proposed); 0 disables it. |
| `ucell` | object | {"max_rank": 1500, "ties": "average"} | — | Options for method ucell. |
| `ucell.max_rank` | integer | 1500 | min 10 | Rank cap for the Mann-Whitney statistic; members ranked beyond it count as maxRank. |
| `ucell.ties` | string | "average" | `average`, `min`, `ordinal` | Tie handling when ranking genes within each cell. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Seed for null-set sampling and module-style control sampling. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Members absent from `var_names` are dropped and counted, so symbols must be matched to the resource first. Sets outside `set_size` are dropped and listed in the summary. Options in a nested object apply only to their method. Scores are relative to the gene universe and are comparable only within one dataset. Module-style methods expect `lognorm`, and ucell and aucell expect `counts`; a mismatch fails with an error rather than rescaling. `threshold` has no literature default and is chosen per benchmark.

## 7. MCP tool

Tool name `singlet_enrichment_per_cell_gene_set_scoring` (definition in `tasks/mcp/singlet_enrichment_per_cell_gene_set_scoring.json`).

```json
{"dataset": "/data/atlas.singlet", "gene_sets": "uns/gene_sets", "method": "ucell", "set_size": {"min": 10, "max": 500}}
```

```json
{"dataset": "/data/atlas.singlet", "status": "completed",
 "wrote": ["obsm/gene_set_score", "uns/gene_set_score_names", "uns/gene_set_score_params"],
 "summary": {"method": "ucell", "sets_scored": "<int>", "sets_dropped": "<int>",
   "dropped_sets": ["<name>"], "null_calibrated": false},
 "provenance_id": "<string>"}
```

Long-running: calls above 1e6 cells queue as a job. Stochastic: only through `seed`, which governs null sets and module-style controls; `ucell` is deterministic. Dry run: estimated seconds, peak memory and device for the chosen method.

## 8. Benchmarks

**Shared protocol.** All scorers receive the same matrix and the same set collection after `set_size` filtering, over one gene universe (genes detected in at least 1% of cells, design). Each method runs at the section 4 defaults unless a benchmark says otherwise. Set-level metrics average over sets and seeds 0 to 4 (design). Per-cell agreement is Spearman correlation over all cells of the stated stratum. Thresholds marked proposed are singlet design targets, not literature values.

### B1. Per-cell perturbation recovery in Holland simulations (proposed)

- **Goal**: whether per-cell scores of a perturbed signature separate simulated perturbed cells from controls, and whether that holds across set sizes.
- **Ground truth**: planted simulation; the binary status of each cell is fixed at generation (estimand in section 3).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Holland in silico single cells from bulk TF and pathway perturbation experiments | Zenodo 10.5281/zenodo.3564179 [R2] | simulated scRNA-seq-like counts; —; — | — | the README says only a small fraction of simulated cells is deposited |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-signature AUROC | AUROC of $S_c$ for perturbed against control cells, midranks for ties, averaged over perturbed signatures | higher | primary | proposed |
| Size slope | least-squares slope of per-signature AUROC on $\log_{10}$ member count | closer to 0 | guardrail | proposed |

- **Comparators**: `ucell`, `module_score`, `score_genes`, `aucell` and `zscore`, on one shared collection.
- **Protocol**: signatures that overlap the simulated perturbation are removed from the scored collection to avoid circularity. Size strata are 10 to 25, 26 to 100 and 101 to 500 members. Counts feed `ucell` and `aucell`; `lognorm` feeds the other three.
- **Acceptance criterion**: proposed. The selected default reaches per-signature AUROC of at least 0.7 at the simulated effect sizes, and the size-slope interval includes 0.
- **Known pitfalls**: the simulator's effect sizes set the ceiling on AUROC, so methods should be compared rather than absolute values quoted; the perturbation is defined by the simulator, not measured.

### B2. Planted per-cell activity under covariate sweeps (proposed)

- **Goal**: whether per-cell scores recover a planted activity $z_c$ while staying independent of set size, detection, depth and cell cycle.
- **Ground truth**: planted simulation; agreement is the Spearman correlation with $z_c$ (estimand in section 3).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Splatter-generated counts (recipe below) | Splatter [R8], used as a generator | simulated scRNA-seq counts; —; 10,000 cells, 5,000 genes (design) | see section 12 | regenerated per seed |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Planted recovery | Spearman $\rho(S_c,z_c)$ over cells, averaged over planted sets, effect sizes and seeds | higher | primary | proposed |
| Covariate leakage | median over null sets of the larger of $\lvert\rho\rvert$ with $\log L_c$ and with member detection rate, within cell type | lower | guardrail | proposed |
| Size independence | slope of mean null score on $\log_{10}$ set size | closer to 0 | guardrail | proposed |
| Null rejection | fraction of null sets with $\lvert z\rvert>1.96$, where $z$ is the leave-one-out z of the set mean among null sets of its size | 0.05 nominal | guardrail | proposed |

- **Generator recipe**:
  1. Simulate 5 cell types of 2,000 cells and 5,000 genes with Splatter.
  2. Draw $z_c\sim\mathcal N(0,1)$ per cell, independently of everything else.
  3. Draw library scale $L_c$ independently of $z_c$; sweep the median to 1,000, 3,000 and 10,000 UMIs, and dropout from none to strong.
  4. Plant 20 sets (five each of 10, 25, 100 and 300 members) from genes detected in at least 5% of cells, blind to effect.
  5. For set $k$ at effect $e\in\{0.25,0.5,1\}$, multiply member expected counts by $\exp(e\,z_c)$ and redraw from the same dispersion.
  6. Add a cell-cycle covariate: 100 genes scaled by $\exp(0.5\,c_c)$, with $c_c\sim\mathcal N(0,1)$ independent of $z_c$.
  7. Draw 200 null sets per size, matched on mean expression and detection in 20 bins, with no activity.
  8. Store all latent variables and repeat for seeds 0 to 4.
- **Comparators**: the five methods of B1.
- **Protocol**: 3 depths × 3 dropout levels × 3 effect sizes × 5 seeds, giving 135 datasets (design), on CPU.
- **Acceptance criterion**: proposed. For the selected default, recovery is at least 0.5 at effect 0.5, leakage is at most 0.10, the size-slope interval includes 0, and null rejection is within 0.03 of 0.05.
- **Known pitfalls**: a simulator sharing the mean-variance and dropout model of the scorer is circular, so a second simulator is planned (section 10). The planted activity must be independent of depth.

### B3. Held-out marker recovery on author-annotated cells (proposed)

- **Goal**: whether marker-set scores built from one study separate annotated cell types in other studies.
- **Ground truth**: expert labels, treated as weak labels (estimand in section 3).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| singlet catalogue, annotated cells | singlet catalogue; no accession | scRNA-seq and related; —; about 40% of 354M cells carry author annotations | — | studies are the strata |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Per-type AUROC | per study and type with at least 200 annotated cells, AUROC of the set score for annotated against other cells of that study; reported as the median over types of per-type medians over studies | higher | primary | proposed |
| Study spread | interquartile range over studies of the per-study AUROC, median over types | lower | guardrail | proposed |

- **Comparators**: the five methods of section 4, with identical marker sets.
- **Protocol**: marker sets are the top 25 genes by log fold change in a held-out study that did not annotate the test study. No test-study cell enters marker derivation.
- **Acceptance criterion**: proposed. Median AUROC of at least 0.8 for the top markers.
- **Known pitfalls**: markers derived from the same annotations make the test circular. Author labels differ between studies, so high spread may reflect labelling rather than scoring.

### P1. Performance and scaling

Wall time and peak memory per $10^6$ cell-set pairs, and throughput, at $10^4$, $10^5$ and $10^6$ cells. Singlet's CPU and CUDA paths are reported separately and comparators on CPU. Held fixed: 20,000 features, one sparsity level (5% nonzero, design), 50-member sets, 100 and 1,000 sets, a fixed thread count, seed 0 and UCell chunk size 100. Comparators: AddModuleScore (R), score_genes (scanpy), UCell (R), AUCell (R) and decoupler `aucell`, and decoupler `zscore`. Acceptance criterion (proposed): singlet `ucell` on CPU is at least 3 times faster than R UCell at $10^5$ cells, with Spearman correlation of at least 0.999 against R UCell on the same input.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `enrichment.pathway_resource_curation`: Curated pathway gene-set and signed footprint resource construction
- **Feeds**:
  - `enrichment.differential_pathway_activity`: Replicate-aware differential activity of pathways, regulons and programs between conditions
  - `enrichment.pseudobulk_pathway_scoring`: Sample-level and pseudobulk pathway activity scoring
  - `annotation.marker_based_cell_assignment`: Marker-based cell-level type assignment
- **Reads**: `layers/counts`, `layers/lognorm`, `uns/gene_sets`
- **Writes**: `obsm/gene_set_score`, `uns/gene_set_score_names`, `obs/<set>_active`, `obsm/gene_set_null_z`, `uns/gene_set_score_params`
<!-- CHAINING:AUTO:END -->

Tier P1: an extension of the standard workflow after normalisation; no named recipe yet.

## 10. Risks, pitfalls and open questions

- **Holland et al. [R2] and Zhang et al. [R6] are known from their abstracts, repository README and bibliographic records only.** Their metric definitions, datasets, simulation parameters and thresholds are not stated there, so B1 uses singlet's own metrics and no benchmark relies on their numbers.
- **Excluded methods.** ssGSEA, singscore, VISION and GSVA are absent from the tables and the enum. Overdispersion testing [R7] is cited for its problem statement only; its model is not used.
- **decoupler zscore flavours.** The `_zscore.py` docstring assigns the global-mean subtraction to KSEA and omits it for RoKAI, but the code subtracts the all-feature mean for RoKAI and not for KSEA (`_zscore.py:75-78`). The equation in section 3 follows the code.
- **Second simulator.** The planned second simulator for B2 is SymSim (preprint doi:10.1101/378646); the corpus record lists no authors or year, so it is not cited.
- **Design gaps and first experiment.** The signed-set rule $S_{\mathrm{up}}-S_{\mathrm{down}}$ and the binarisation threshold have no benchmark or literature default, and the count model and empirical null are unbuilt. The first experiment scores the Holland deposit with the five heuristics and checks B2's leakage metric on a single simulated arm before any model code is written.

## 11. References

R1. Tirosh I, Izar B, Prakadan SM, et al. Dissecting the multicellular ecosystem of metastatic melanoma by single-cell RNA-seq. *Science* 2016. doi:10.1126/science.aad0501 — verified (corpus)
R2. Holland CH, Tanevski J, Perales-Patón J, et al. Robustness and applicability of transcription factor and pathway analysis tools on single-cell RNA-seq data. *Genome Biology* 2020. doi:10.1186/s13059-020-1949-z — verified (repo)
R3. Andreatta M, Carmona SJ. UCell: Robust and scalable single-cell gene signature scoring. *Computational and Structural Biotechnology Journal* 2021. doi:10.1016/j.csbj.2021.06.043 — verified (corpus)
R4. Aibar S, González-Blas CB, Moerman T, et al. SCENIC: single-cell regulatory network inference and clustering. *Nature Methods* 2017. doi:10.1038/nmeth.4463 — verified (corpus)
R5. Yılmaz S, Ayati M, Schlatzer D, et al. Robust inference of kinase activity using functional networks. *Nature Communications* 2021. doi:10.1038/s41467-021-21211-6 — verified (corpus)
R6. Zhang Y, Ma Y, Huang Y, et al. Benchmarking algorithms for pathway activity transformation of single-cell RNA-seq data. *Computational and Structural Biotechnology Journal* 2020. — verified (corpus)
R7. Fan J, Salathia N, Liu R, et al. Characterizing transcriptional heterogeneity through pathway and gene set overdispersion analysis. *Nature Methods* 2016. doi:10.1038/nmeth.3734 — verified (corpus)
R8. Zappia L, Phipson B, Oshlack A. Splatter: simulation of single-cell RNA sequencing data. *Genome Biology* 2017. doi:10.1186/s13059-017-1305-0 — verified (corpus)
R9. Liberzon A, Birger C, Thorvaldsdóttir H, et al. The Molecular Signatures Database (MSigDB) hallmark gene set collection. *Cell Systems* 2015. doi:10.1016/j.cels.2015.12.004 — verified (search)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/satijalab/seurat | Satija lab per README; LICENSE copyright "Seurat authors" | MIT | AddModuleScore control binning and score | port |
| https://github.com/scverse/scanpy | scverse; LICENSE copyright F. Alexander Wolf, P. Angerer, Theis Lab and scverse | BSD-3-Clause | score_genes scheme and presets | port |
| https://github.com/carmonalab/UCell | Massimo Andreatta and Santiago J Carmona | GPL-3 (LICENSE file and DESCRIPTION) | UCell statistic and defaults | reimplement from the published formula |
| https://github.com/scverse/decoupler | scverse; LICENSE copyright 2025 scverse and Pau Badia i Mompel, Saez lab | BSD-3-Clause | AUCell and zscore implementations; benchmark module | port |
| https://github.com/aertslab/AUCell | Sara Aibar and Stein Aerts (author); Gert Hulselmans (maintainer) | GPL-3 in DESCRIPTION; no LICENSE file at root; scRNA-tools lists "Custom" | P1 comparator | callout |
| https://github.com/saezlab/FootprintMethods_on_scRNAseq | Holland et al. (paper cited in README) | GPL-3 (LICENSE file) | simulation source for B1 | callout |
| https://github.com/Oshlack/splatter | Luke Zappia, Belinda Phipson, Alicia Oshlack | GPL-3 (LICENSE file and DESCRIPTION) | count generator for B2 | callout (generator, not linked) |
