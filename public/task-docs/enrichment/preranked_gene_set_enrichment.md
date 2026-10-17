---
id: enrichment.preranked_gene_set_enrichment
title: Preranked gene set enrichment on gene-level statistics
area: enrichment
scope: core
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [markers-de.replicate_aware_condition_de, enrichment.pathway_resource_curation]
feeds: [statistics.multiple_testing_control, statistics.pvalue_null_calibration]
reads: [varm/<de_name>, var/<symbol_key>, uns/<collection>, uns/<de_name>_meta]
writes: [uns/gsea/<de_name>/<contrast>, uns/gsea/<de_name>/<contrast>/params]
devices: [cpu, cuda]
mcp_tool: singlet_enrichment_preranked_gene_set_enrichment
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Preranked gene set enrichment on gene-level statistics

> Tests whether the members of a gene set sit at the extremes of a genome-wide ranking of one signed gene-level statistic, returning a running-sum score, a sign-matched normalised score, a permutation p-value and a set-level FDR for each cell type and contrast.

## 1. Question

Is a gene set concentrated at the top or bottom of a genome-wide ranking of one signed statistic, such as the donor-level pseudobulk t-statistic for one cell type and one contrast? The input is one value per gene and a gene-set collection with size limits. The output per set is an enrichment score (ES), a normalised enrichment score (NES), a sign-matched p-value, a Benjamini-Hochberg q-value and leading-edge genes. A correct answer uses the estimands of section 3, gives p-values calibrated under a donor-level null, and recovers planted shifts (B3).

## 2. Why this task matters and where the field stands

Status: **contested**. Ranking every gene and asking whether a set is extreme is a routine second step after differential expression, and it avoids an arbitrary cut-off on the gene list [R1, R2, R7]. The running-sum score and its permutation null are standard, and the ranking step itself is not in dispute. What is disputed is significance. The membership-permutation null treats genes as exchangeable, independent draws, but co-regulated members are correlated. Permutation-based gene set tests are sensitive to correlation between genes, and a competitive test that estimates inter-gene correlation controls the type I error under it [R4]; the competitive-versus-self-contained distinction [R5] determines which units the null treats as independent. A gold-standard study on bulk disease data [R6] reports that methods differ in the fraction of sets called significant under different null hypotheses. For single-cell input, the ranking is meaningful only when it is built from donor-level pseudobulk rather than from cells [R3].

Three open problems remain for pseudobulk rankings: calibrated set-level p-values when members are correlated; the gene-level statistic that ranks best when donors are few; and redundancy among overlapping collections such as MSigDB [R9] and Gene Ontology, which changes which sets lead. Pathway-activity frameworks such as decoupleR [R8] include a GSEA method built on the same ranking step, so the choices made here carry over to them. No single-cell preranked benchmark has been identified.

## 3. Theory and insight

Sort the genes by the statistic in decreasing order, $r_1\ge\dots\ge r_N$. For a set $S$ with $k$ members in the ranking, the running-sum step and the running sum are

$$
\delta_S(i)=\begin{cases}\dfrac{|r_i|}{\sum_{j\in S}|r_j|} & i\in S\\[4pt]-\dfrac{1}{N-k} & i\notin S\end{cases}
\qquad
L_S(i)=\sum_{j\le i}\delta_S(j).
$$

The enrichment score is the signed extreme of the running sum, $\mathrm{ES}(S)=L_S(j^\*)$ with $j^\*=\arg\max_i|L_S(i)|$. Member weights sum to one and non-member steps sum to minus one, so $L_S(N)=0$ and $\mathrm{ES}\in[-1,1]$. The regime is a fixed ranking without ties, because the implementations in section 4 leave the order of tied genes undefined. The leading edge is the set of members at or above $j^\*$ when $\mathrm{ES}\ge0$, and at or below $j^\*$ when $\mathrm{ES}<0$.

Significance uses membership permutation. $\mathrm{ES}^{(b)}$, $b=1,\dots,P$, is computed with the same $k$, but with the members placed at a uniformly random set of $k$ positions of the fixed ranking. Let $n_\pm$ be the number of draws with the sign of $\mathrm{ES}$, and $\bar e_\pm$ their mean. Then

$$
\mathrm{NES}=\frac{\mathrm{ES}}{|\bar e_{\pm}|},\qquad
\hat p=\frac{\#\{b:\ \mathrm{ES}^{(b)}\ge \mathrm{ES}\}}{n_{+}}\quad(\mathrm{ES}\ge0),
$$

with the mirror image for $\mathrm{ES}<0$. The p-value is one-sided within the sign of ES, not two-sided, because ES already selects the larger excursion. It has no +1 correction, so $\hat p$ can be exactly zero. Its smallest non-zero value is $1/n_{+}$, which is about $2/P$ under a symmetric null.

Estimands, one sentence each. ES is a descriptive functional of the fixed ranking, bounded in $[-1,1]$, with no normalisation beyond the member weights. NES is ES divided by the magnitude of its sign-matched null mean, so 1 means the observed score equals the null mean at its sign; it is unbounded. $\hat p$ is the probability, under membership permutation conditional on the sign of ES, of a score at least as extreme, with resolution about $2/P$. The q-value is the Benjamini-Hochberg adjustment of $\hat p$ across sets within each cell type and contrast.

Model-based term. For $m$ unit-variance statistics with mean pairwise correlation $\bar\rho_S$, the variance of their mean is $\{1+(m-1)\bar\rho_S\}/m$, because $\mathrm{Var}(\sum_i z_i)=m+m(m-1)\bar\rho_S$. The adjusted set statistic

$$
T_S=\frac{\sqrt{m}\,\bar z_S}{\sqrt{\mathrm{VIF}(S)}},\qquad \mathrm{VIF}(S)=1+(m-1)\bar\rho_S,
$$

is approximately standard normal under the null, to first order in $\bar\rho_S$ and for approximately Gaussian $z$. Its estimand is the mean standardised effect of the members in standard-error units. It needs an estimate of $\bar\rho_S$ from data outside the test, and it degrades for small $m$.

Ground-truth quantities, one sentence each. The relevance score (B1) is the negative position of a set in a precompiled relevance ranking, so a higher score means more relevant. The type-I error (B2) is the fraction of (set, donor-label draw) pairs with $\hat p\le\alpha$, whose target is $\alpha$; $z_S=\Phi^{-1}(1-\hat p_S/2)$ is used for every method, so that $z_S^2\sim\chi^2_1$ under a uniform $\hat p$. The genomic inflation $\lambda$ (B2) is the median of $z_S^2$ divided by 0.4549, the median of a $\chi^2_1$ variable, and its target is 1. The planted indicator (B3) is 1 when a set's members received the spiked shift, so power is the fraction of planted sets with $q\le0.05$ and FDR is the fraction of non-planted sets with $q\le0.05$.

Assumptions and failure modes. Membership-permutation tests assume that the statistic is comparable across genes, that the set was chosen independently of the statistic, and that members behave as exchangeable draws. Correlated members make the null too narrow, so set-level significance inflates [R4, R5]. Raw log fold change does not account for precision, so noisy low-count genes reach the extremes, whereas a moderated or mixed-model t does not. Cells used as replicates make the input statistic itself anti-conservative [R3]. Self-contained rotation tests need donors as the independent units.

Why heuristics work, and what the model-based term adds. The running sum is a sensitive scan that weights members by their statistic, and permutation supplies a reference without a distributional assumption; that is why it is the published standard. The variance-inflated statistic adds an explicit correction for correlation that is estimated rather than assumed, with a calibration target that can be checked. The membership null cannot express correlation at all.

Pitfalls shown by benchmark studies. Method rankings change with the null hypothesis [R6], and cells used as replicates inflate false discoveries [R3].

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| GSEA running sum with membership permutation (decoupler `mt.gsea`) | heuristic | Weighted running sum over the ranked list; sign-matched NES and p-value from membership permutations | [R1] |
| fgsea | heuristic | Same running-sum statistic; adaptive multilevel estimator reaches small p-values without large permutation counts | [R2] |
| GSEApy prerank | heuristic | Same statistic; permutation p-values by default, or an fgsea-type multilevel estimator | [R7] |
| clusterProfiler gseGO | heuristic | GO-focused GSEA wrapper with a multilevel default; the engine is delegated to a separate package | §12 |
| Camera-type test on linear mixed models (dreamlet `zenith_gsa`) | model-based | Competitive test on model t-statistics; inter-gene correlation is estimated from the data only when `inter.gene.cor` is NA, and the method signature defaults to 0.01 | [R4] |
| rapids_singlecell GSEA | heuristic | CUDA implementation of the decoupler GSEA algorithm with batched permutations | §12 |

The membership-permutation running sum is the published standard for preranked sets and the comparator for every benchmark here. fgsea is the default engine because its multilevel estimator resolves small p-values without large permutation counts [R2]. The fixed-permutation engines implement the estimand of section 3 exactly and serve as references. The camera-type test is the model-based standard for correlated members, but it consumes a fitted linear model rather than a ranked vector, so it remains a comparator. Other gene-set tests are outside this table; see section 10.

Defaults of the methods above, as set in the source at the stated revision:

| Method | Parameter | Value | Source (file:line @ revision) |
|---|---|---|---|
| decoupler `mt.gsea` | permutations `times` | 1000 | src/decoupler/mt/_gsea.py:157 @3132edc |
| decoupler `mt.gsea` | seed | 42 | src/decoupler/mt/_gsea.py:158 @3132edc |
| decoupler `mt.gsea` | minimum members `tmin` | 5 | src/decoupler/_Method.py:73 @3132edc |
| decoupler `mt.gsea` | weight exponent on $\|r_i\|$ | 1, fixed | src/decoupler/mt/_gsea.py:59 @3132edc |
| decoupler `mt.gsea` | returned value when `times` > 1 | NES | src/decoupler/mt/_gsea.py:265-266 @3132edc |
| fgsea | `minSize` | 1 | R/fgsea.R:21 @570f590 |
| fgsea | `maxSize` | length(stats) − 1 | R/fgsea.R:21 @570f590 |
| fgsea | `gseaParam` | 1 | R/fgsea.R:21 @570f590 |
| fgsea multilevel | `eps` | 1e-50 | R/fgseaMultilevel.R:49 @570f590 |
| fgsea multilevel | `scoreType` | std | R/fgseaMultilevel.R:50 @570f590 |
| fgsea multilevel | `sampleSize` | 101 | R/fgseaMultilevel.R:46 @570f590 |
| fgsea multilevel | `nPermSimple` | 1000 | R/fgseaMultilevel.R:54 @570f590 |
| rapids_singlecell GSEA | `times` | 1000 | src/rapids_singlecell/decoupler_gpu/_method_gsea.py:99 @e110792 |
| rapids_singlecell GSEA | `seed` | 42 | src/rapids_singlecell/decoupler_gpu/_method_gsea.py:100 @e110792 |
| GSEApy prerank | `min_size` | 15 | gseapy/gsea.py:433 @6e6f0e2 |
| GSEApy prerank | `max_size` | 500 | gseapy/gsea.py:434 @6e6f0e2 |
| GSEApy prerank | `permutation_num` | 1000 | gseapy/gsea.py:435 @6e6f0e2 |
| GSEApy prerank | `method` | permutation | gseapy/gsea.py:445 @6e6f0e2 |
| GSEApy prerank | `seed` | 123 | gseapy/gsea.py:443 @6e6f0e2 |
| GSEApy prerank | `eps` | 1e-50 | gseapy/gsea.py:447 @6e6f0e2 |
| clusterProfiler gseGO | `minGSSize` | 10 | R/gseAnalyzer.R:37 @c7404be |
| clusterProfiler gseGO | `maxGSSize` | 500 | R/gseAnalyzer.R:38 @c7404be |
| clusterProfiler gseGO | `eps` | 1e-10 | R/gseAnalyzer.R:39 @c7404be |
| clusterProfiler gseGO | `method` | multilevel | R/gseAnalyzer.R:44 @c7404be |
| clusterProfiler gseGO | `seed` | FALSE, a new random seed per run | R/gseAnalyzer.R:49 @c7404be |
| dreamlet `zenith_gsa` | `use.ranks` | FALSE, parametric | R/zenith_gsa.R:75 @6ddcb83 |
| dreamlet `zenith_gsa` | `inter.gene.cor` | 0.01 (signature default); NA estimates the correlation from data | R/zenith_gsa.R:75 and :142 @6ddcb83 |

## 5. Proposed singlet approach

Routes. `fgsea` is ported. `gsea_permutation` ports the decoupler algorithm to C++ on the CPU, with CUDA kernels that follow the rapids_singlecell design. GSEApy and clusterProfiler are callouts used only as comparators. The camera-type test is reimplemented for ranked vectors only if the gate below is passed. Licences and repositories are given in section 12.

Default. The default is `method` = `fgsea` applied to the moderated or mixed-model t (`ranking.statistic` = `t`), with sets of 15 to 500 members in the ranked universe and Benjamini-Hochberg q-values within each cell type and contrast. This is the published standard engine with the lowest reachable p-values. Its membership-null p-values are not yet calibrated for correlated pseudobulk genes, so the default is a working choice that the gate below can replace.

Model-based formulation. Replace the independence null with $T_S$ from section 3, with $\bar\rho_S$ estimated per cell type from residual gene-gene correlations in the catalogue. Expose it as a third `method` value only after it passes the gates. It is falsified if the B2 type-I error at $\alpha=0.05$ falls outside [0.04, 0.06] for sets of 15 to 500 members, or if B3 power at the largest effect falls more than 0.05 below the best comparator. A learned null is an optional second route: a small GLM predicts null quantiles of NES from set size, $\bar\rho_S$ and ranking autocorrelation, fitted to sample-label permutations from the catalogue. It is accepted only if its held-out coverage lies inside the B2 band.

ML stack. The running sums over sets and draws are the hot path and go to hand-written CUDA: segmented scans over sorted ranks, with permutations batched across sets, plus a CPU fallback. A GLM null, if adopted, is evaluated in the same kernels. PyTorch is needed only if a non-linear null is trained offline, and it is then exported as weights.

CPU, CUDA and streaming. Memory per ranking is linear in $N$, plus the membership index. The input is one vector per gene, so streaming over cells does not apply. Several rankings (cell types times contrasts) are batched on one device.

Parameters an agent uses without asking: `method` = `fgsea`, `ranking.statistic` = `t`, `gene_sets.min_size` = 15, `gene_sets.max_size` = 500, `fgsea.eps` = 1e-50, `fgsea.score_type` = `std`, `gsea_permutation.n_perm` = 1000, and `seed` = 42.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | varm/<de_name> | float32, genes × contrasts | Signed gene-level statistic from donor-level DE, one column per contrast |
| read | var/<symbol_key> | string | Gene symbols matched to set members |
| read | uns/<collection> | mapping | Gene sets as name to member list |
| read | uns/<de_name>_meta | mapping | Cell type, contrast, donor and cell counts from the upstream DE, for reporting |
| write | uns/gsea/<de_name>/<contrast> | table | Columns: gene_set, n_genes, ES, NES, pval, fdr_bh, leading_edge |
| write | uns/gsea/<de_name>/<contrast>/params | mapping | Statistic, size limits, method, n_perm, seed, score_type, eps, tie count and library versions |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `ranking` | object | required | — | The gene-level statistic that genes are ranked by. |
| `ranking.de_name` | string | — | — | varm member holding the genes-by-contrasts statistic matrix from pseudobulk DE. |
| `ranking.contrast` | string | — | — | Column of the statistic matrix to rank genes by. |
| `ranking.statistic` | string | "t" | `t`, `logfc`, `signed_neglog10p` | Moderated or mixed-model t is preferred; logfc is for comparison only. |
| `gene_sets` | object | required | — | Gene-set collection and size limits, applied within the ranked universe. |
| `gene_sets.collection` | string | — | — | uns member holding gene sets as a name-to-members mapping. |
| `gene_sets.min_size` | integer | 15 | min 1 | Minimum set members present in the ranked universe. |
| `gene_sets.max_size` | integer | 500 | min 2 | Maximum set members present in the ranked universe. |
| `gene_sets.symbol_key` | string | "var_names" | — | var column matching set members; var_names uses the index. |
| `method` | string | "fgsea" | `fgsea`, `gsea_permutation` | fgsea: adaptive multilevel p-values (default). gsea_permutation: fixed-permutation reference. |
| `fgsea` | object | — | — | Options read only when method is fgsea. |
| `fgsea.eps` | number | 1e-50 | min 0 | Lower bound on reported p-values in the multilevel estimator. |
| `fgsea.score_type` | string | "std" | `std`, `pos`, `neg` | std is two-sided; pos or neg only for a directional hypothesis. |
| `fgsea.sample_size` | integer | 101 | min 2 | Sample size of the multilevel estimator (fgsea sampleSize). |
| `fgsea.n_perm_simple` | integer | 1000 | min 1 | Simple permutations that seed the multilevel estimator. |
| `gsea_permutation` | object | — | — | Options read only when method is gsea_permutation. |
| `gsea_permutation.n_perm` | integer | 1000 | min 1 | Membership permutations per set; p-values cannot resolve below about 2/n_perm. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | fgsea runs on CPU; gsea_permutation uses CUDA when cuda is requested or auto finds enough memory. |
| `seed` | integer | 42 | — | Random seed for membership permutations and multilevel sampling. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
<!-- PARAMS:AUTO:END -->

Size limits apply after each set is intersected with the ranked universe, and the universe is the same for all sets within one ranking. Rankings that contain tied statistics are rejected, because tie order is undefined in the implementations in section 4. `ranking.statistic` = `logfc` is accepted for comparison only, since it does not account for precision. The `fgsea` options are read only when `method` is `fgsea`, and `score_type` = `pos` or `neg` is for a directional hypothesis only. The `gsea_permutation` options are read only when `method` is `gsea_permutation`. The exponent on $|r_i|$ is fixed at 1 and is not exposed, so that the engines stay comparable.

## 7. MCP tool

Tool name `singlet_enrichment_preranked_gene_set_enrichment` (definition in `tasks/mcp/singlet_enrichment_preranked_gene_set_enrichment.json`). Example call and compact result:

```json
{"dataset": "study.singlet", "ranking": {"de_name": "pb_de", "contrast": "stim_vs_ctrl"},
 "gene_sets": {"collection": "pathways"}, "method": "fgsea", "seed": 42}
```

```json
{"dataset": "study.singlet", "status": "completed",
 "wrote": ["uns/gsea/pb_de/stim_vs_ctrl", "uns/gsea/pb_de/stim_vs_ctrl/params"],
 "summary": {"n_gene_sets_tested": "<int>", "n_fdr_below_0_05": "<int>", "method": "fgsea"},
 "provenance_id": "<id>"}
```

Long-running: no; a single ranking completes inline. Stochastic: yes, through `seed`, which governs membership permutations and multilevel sampling. Dry run: returns estimated seconds, peak memory and device from the cost model fixed by the P1 measurements.

## 8. Benchmarks

Shared protocol. Every benchmark starts from a signed gene-level statistic per cell type and contrast, computed on donor-level pseudobulk by the upstream DE task. All methods use the same gene-set collection, the same universe, the same size limits (15 to 500 members in the ranked universe) and seed 42, and Benjamini-Hochberg q-values within each cell type and contrast. Hardware, thread count, package versions and commit revisions are recorded with each result. Estimands are defined in section 3 and are not repeated below.

### B1. Relevance recovery on bulk disease data (published gold standard)

- **Goal**: test whether set scores place a priori disease-relevant gene sets above the rest, on bulk disease data.
- **Ground truth**: expert labels. Each dataset has a precompiled, disease-specific relevance ranking of GO and KEGG gene sets, fixed before testing [R6]. The relevance score is as defined in section 3.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| GSEABenchmarkeR compendium of human disease datasets | [R6]; Bioconductor package http://bioconductor.org/packages/GSEABenchmarkeR | Human, bulk microarray and RNA-seq; 75 datasets covering 42 diseases [R6] | Not confirmed (section 10) | Bulk reference only |
| Precompiled relevance rankings, one per dataset | [R6] | — | See §12 | Fixed before testing |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Relevance concordance | Spearman correlation between the set score, sign(ES) × −log10 p̂, and the relevance score, over sets with a relevance position; median across datasets | higher is better | primary | defined here |
| Wall time | Median wall-clock seconds per dataset and method | lower is better | guardrail | — |

- **Comparators**: decoupler `gsea_permutation` and fgsea, applied to the same rankings.
- **Protocol**: apply each method to each dataset's gene-level statistic over the shared universe, compute the concordance, and report its median across datasets.
- **Acceptance criterion**: proposed, not from the source. The singlet default's median concordance is no lower than fgsea's by more than 0.02 in absolute terms.
- **Known pitfalls**: the data are bulk, so transfer to pseudobulk rankings is untested. Circularity arises if the relevance rankings derive from the same database that is tested.

### B2. Sample-label null calibration (proposed)

- **Goal**: check that set-level p-values are uniform under donor-label permutations, so that the default is not anti-conservative for correlated members.
- **Ground truth**: consistency under a null that is true by construction. For each cell type and contrast, donor condition labels are permuted within design strata and the gene-level statistic is recomputed, giving $K$ null draws. The estimands are those of section 3, applied to the permuted statistics.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Donor-level pseudobulk, author-annotated cell types | singlet catalogue (internal) | scRNA-seq and snRNA-seq; donors per cell type — | — | Donor counts are measured before use (section 10) |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Type-I error | Fraction of (set, draw) pairs with $\hat p\le\alpha$, at $\alpha\in\{0.01,0.05\}$ | closer to $\alpha$ | primary | defined here |
| Genomic inflation $\lambda$ | Median of $z_S^2$ over sets, divided by 0.4549 | closer to 1 | primary | defined here |
| FDR under null | Share of null sets with BH $q\le0.05$ | lower | guardrail | defined here |

- **Comparators**: decoupler `gsea_permutation`, fgsea, GSEApy prerank, and dreamlet `zenith_gsa` on the same design, plus the variance-inflated score once it exists.
- **Protocol**: fix $K$ (proposed $K=200$) and the strata in advance. Pool set-level results across cell types and draws, and report each method's null type (membership or sample-label) with its numbers.
- **Acceptance criterion**: proposed. Type-I error at 0.05 lies within [0.04, 0.06] and $\lambda$ within [0.95, 1.05] for sets of 15 to 500 members. Methods outside the band are flagged as anti-conservative or conservative and are not promoted.
- **Known pitfalls**: with few donors there are few distinct labelings, so p-values are discrete and the band is limited by the number of labelings (section 10). Cells used as units give anti-conservative nulls [R3].

### B3. Planted gene-set recovery (proposed)

- **Goal**: measure power at controlled FDR when one known set carries a donor-level shift.
- **Ground truth**: planted simulation. Within a chosen subset of spike-in donors, the members of selected sets receive a fixed additive log2 fold change $\delta$ on the counts-per-million scale, and the pseudobulk DE model is then refitted. The planted indicator is therefore known by construction. The estimands are as in section 3.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Catalogue pseudobulk with spiked shifts | singlet catalogue (internal) | As in B2; donors — | — | Planted sets come from curated collections and co-expression modules |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Power | Fraction of planted sets with BH $q\le0.05$, for each $\delta$ | higher is better | primary | defined here |
| AUROC | Area under the ROC curve of the set score, sign(ES) × −log10 p̂, separating planted from non-planted sets | higher is better | primary | defined here |
| FDR among non-planted | Fraction of non-planted sets with $q\le0.05$ | lower is better | guardrail | defined here |

- **Comparators**: as in B2.
- **Protocol**: effect grid $\delta\in\{0,0.25,0.5,1\}$ (proposed). Donor count and set sizes are fixed across methods. Planted sets are removed from the collection tested in the same replicate.
- **Acceptance criterion**: proposed. A method is promoted only if its FDR among non-planted sets is at most 0.10 and its power is within 0.05 of the best comparator at the largest $\delta$.
- **Known pitfalls**: planted sets drawn from the tested collection overlap with other sets, so the tests are not independent. Log fold-change effects do not map onto the t scale, so $\delta$ is reported on both scales.

### B4. Cross-implementation concordance (consistency, proposed)

- **Goal**: check that GSEA-type implementations agree on identical ranked vectors once settings are matched.
- **Ground truth**: consistency across implementations, with no external truth. Agreement is the target.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| One ranking per cell type and contrast | singlet catalogue (internal) | As in B2 | — | The same input vector goes to every implementation |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| NES concordance | Spearman correlation of NES across sets scored by both implementations, restricted to sets with $\hat p<0.05$ in either | higher is better | primary | defined here |
| Leading-edge Jaccard | Jaccard overlap of leading-edge genes for the top 20 sets by $\lvert$NES$\rvert$ in each implementation | higher is better | guardrail | defined here |

- **Comparators**: decoupler `gsea_permutation`, fgsea, GSEApy prerank (permutation), and clusterProfiler gseGO.
- **Protocol**: match minimum and maximum set sizes, permutation count, seed and sign convention. Fix the seed wherever a tool defaults to a random one. Compare NES and $\hat p$, and report tail differences separately, because count-based and multilevel p-values differ in the tail.
- **Acceptance criterion**: proposed. NES Spearman correlation of at least 0.95 between decoupler and fgsea after size matching. Otherwise, the cause of the deviation is documented.
- **Known pitfalls**: default minimum set sizes differ across tools (section 4). The multilevel p-value floor is not comparable with count-based values in the tail.

### P1. Performance and scaling

Cell count does not enter this task, so the 10k, 100k and 1M cell scales do not apply. The scaling variables are the number of sets $G$, ranked genes $N$, permutations $P$ and rankings $S$ (cell types times contrasts). Measure wall time and peak memory for decoupler `gsea_permutation` (CPU, numba), fgsea (CPU), GSEApy prerank (CPU) and the CUDA kernel, reporting CPU threads and GPU separately. Hold $N$ and the size limits fixed, and keep $P$ at its default for the first measurements. Then vary one of $G$, $P$ or $S$ at a time over a proposed grid, $P\in\{1000,10000\}$ and $S\in\{1,100\}$. No runtime figures are stated here, and the dry-run estimate is calibrated from these measurements.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `markers-de.replicate_aware_condition_de`: Replicate-aware condition DE within a cell type
  - `enrichment.pathway_resource_curation`: Curated pathway gene-set and signed footprint resource construction
- **Feeds**:
  - `statistics.multiple_testing_control`: Multiple-testing (FDR) control across genes, clusters, cell types and contrasts
  - `statistics.pvalue_null_calibration`: Type I error and p-value calibration of single-cell tests under replicate-respecting nulls
- **Reads**: `varm/<de_name>`, `var/<symbol_key>`, `uns/<collection>`, `uns/<de_name>_meta`
- **Writes**: `uns/gsea/<de_name>/<contrast>`, `uns/gsea/<de_name>/<contrast>/params`
<!-- CHAINING:AUTO:END -->

Sits in the condition-association chain after donor-aware gene-level DE and before null calibration and multiplicity control.

## 10. Risks, pitfalls and open questions

- **Sources not analysed in full**: the full texts of [R4], [R5] and [R6] were not read; statements about [R4] and [R6] rest on search-result abstracts and bibliographic records, and statements about [R5] rest on the corpus record alone. The dataset count and comparison scope of the gold-standard study come from its abstract. The terms of use of the B1 data must be read before that benchmark is applied. The original GSEA null type is not analysed. The zenith package behind `zenith_gsa` and the enrichit engine behind gseGO are not analysed. ROAST and the mean-rank tests are omitted from the tables for the same reason.
- **Unsettled literature**: whether membership-permutation or competitive nulls are calibrated for correlated pseudobulk genes; which gene-level statistic ranks best with few donors; how FDR should be scoped across cell types and contrasts; and how overlapping collections change the leading sets.
- **Technical risks**: count-based p-values can be exactly zero, and their non-zero values are at least $1/n_{+}$. With few donors, the number of distinct donor-label permutations bounds p-value resolution. Tie order is undefined in the implementations in section 4, so tied rankings are rejected. The `zenith_gsa` methods take a dreamlet fit object (R/zenith_gsa.R:74 and :141 @6ddcb83), not a ranked vector.
- **Benchmark gaps**: no independent curated marker source has been identified, so a marker-recovery benchmark is not specified. Donor counts per cell type in the catalogue are unmeasured, which limits B2 and B3. The transfer of B1 from bulk to pseudobulk rankings is untested.
- **Licence routing**: section 12 sets each route. Reimplemented code follows the published definitions, not the source text.
- **First experiment**: apply B2 with decoupler `gsea_permutation` and fgsea on the catalogue cell types with the most donors, at $K=200$, and read the type-I error and $\lambda$ before any default changes.

## 11. References

R1. Subramanian A, Tamayo P, Mootha VK, et al. Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. *Proc Natl Acad Sci USA* 2005. doi:10.1073/pnas.0506580102 — verified (corpus)

R2. Korotkevich G, Sukhov V, Budin N, Shpak B, Artyomov MN, Sergushichev A. Fast gene set enrichment analysis. *bioRxiv* 2021. doi:10.1101/060012 — verified (repo)

R3. Squair JW, Gautier M, Kathe C, et al. Confronting false discoveries in single-cell differential expression. *Nature Communications* 2021. doi:10.1038/s41467-021-25960-2 — verified (corpus)

R4. Wu D, Smyth GK. Camera: a competitive gene set test accounting for inter-gene correlation. *Nucleic Acids Research* 2012;40(17):e133. doi:10.1093/nar/gks461 — verified (search)

R5. Goeman JJ, Bühlmann P. Analyzing gene expression data in terms of gene sets: methodological issues. *Bioinformatics* 2007. — verified (corpus)

R6. Geistlinger L, Csaba G, Santarelli M, et al. Toward a gold standard for benchmarking gene set enrichment analysis. *Briefings in Bioinformatics* 2021;22(1):545–556. doi:10.1093/bib/bbz158 — verified (search)

R7. Fang Z, Liu X, Peltz G. GSEApy: a comprehensive package for performing gene set enrichment analysis in Python. *Bioinformatics* 2022. doi:10.1093/bioinformatics/btac757 — verified (corpus)

R8. Badia-i-Mompel P, Vélez Santiago J, Braunger J, et al. decoupleR: ensemble of computational methods to infer biological activities from omics data. *Bioinformatics Advances* 2022. doi:10.1093/bioadv/vbac016 — verified (corpus)

R9. Liberzon A, Subramanian A, Pinchback R, et al. Molecular signatures database (MSigDB) 3.0. *Bioinformatics* 2011. — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/scverse/decoupler | Pau Badia i Mompel (authors and maintainers, pyproject.toml) | BSD-3-Clause (LICENSE) | GSEA running sum with membership permutation; CPU reference for `gsea_permutation` | port |
| https://github.com/ctlab/fgsea | Gennady Korotkevich, Vladimir Sukhov, Nikita Golikov, Alexey Sergushichev (authors; Sergushichev also maintainer) | MIT + file LICENCE (DESCRIPTION; LICENCE copyright Alexey Sergushichev) | Multilevel engine for `fgsea` | port |
| https://github.com/scverse/rapids_singlecell | Severin Dicks (author, pyproject.toml) | MIT (LICENSE; copyright Severin Dicks) | CUDA kernel design for `gsea_permutation` | port |
| https://github.com/zqfang/GSEApy | Zhuoqing Fang (author, pyproject.toml); paper authors Zhuoqing Fang, Xinyuan Liu, Gary Peltz | BSD-3-Clause (LICENSE, pyproject.toml) | Comparator in B2, B4 and P1 | callout |
| https://github.com/YuLab-SMU/clusterProfiler | Guangchuang Yu (maintainer) | Artistic-2.0 (DESCRIPTION; no LICENSE file at the root) | Comparator (gseGO) in B4 | callout |
| https://github.com/DiseaseNeurogenomics/dreamlet | Gabriel Hoffman (author and maintainer, DESCRIPTION) | Artistic-2.0 (DESCRIPTION; no LICENSE file at the root) | Camera-type comparator (`zenith_gsa`) in B2 | callout; any reimplementation follows [R4] |
| https://github.com/DiseaseNeurogenomics/dreamlet | Gabriel Hoffman (author and maintainer) | Artistic-2.0 (DESCRIPTION; no LICENSE file at the root) | Camera-type test on model fits (`zenith_gsa`); comparator and reimplementation target | reimplement |
| http://bioconductor.org/packages/GSEABenchmarkeR | — | — | Gold-standard datasets for B1 | callout |
