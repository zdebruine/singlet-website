---
id: disease-clinical.malignant_cell_identification
title: Malignant versus non-malignant cell identification in tumour scRNA-seq
area: disease-clinical
scope: extended
paradigm: hybrid
literature_status: contested
priority: P1
depends_on: [qc.low_quality_cell_detection, normalization.size_factor_estimation, annotation.cluster_label_assignment, neighbors.approximate_knn_search]
feeds: [genetics.clonal_substructure_inference, genetics.dna_clone_assignment, disease-clinical.drug_sensitivity_prediction]
reads: [layers/counts, var/chrom, var/start, var/end, uns/genome_build, obs/sample_id, obs/is_normal_reference, obs/cell_type, layers/allele_ref, layers/allele_alt]
writes: [obs/malignant_label, obs/malignant_prob, obs/malignant_method, obsm/cnv_profile, uns/malignant_params]
devices: [cpu, cuda]
mcp_tool: singlet_disease_clinical_malignant_cell_identification
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Malignant versus non-malignant cell identification in tumour scRNA-seq

> Labels each cell of a tumour sample as malignant or non-malignant, with a malignant probability where the method provides one, from copy-number evidence, tumour signatures or a trained expression classifier.

## 1. Question

Given a cell-by-gene UMI matrix from one tumour sample (or several samples with a sample label), which cells are malignant rather than normal epithelial, stromal or immune cells? Optional inputs are known non-malignant reference cells and allele counts at heterozygous SNPs. The output is a per-cell label and, where available, a malignant probability. A correct answer agrees with an orthogonal truth for the same cells, such as DNA-derived tumour status or expert labels, and every score is reported with the sample's malignant fraction. Subclone assignment and copy-number profile accuracy belong to the genetics area.

## 2. Why this task matters and where the field stands

Tumour scRNA-seq samples usually mix malignant cells with stromal and immune cells, and tumour-state, clonal and drug-response analyses assume the malignant subset is known. Early studies separated malignant from non-malignant cells with expression-derived copy-number-like profiles [R1, R2]. Two families of methods are in common use. Copy-number callers compare expression with a normal reference to infer aneuploidy or copy states: CopyKAT [R3], Numbat [R4] and SCEVAN [R5]. Signature classifiers score cells on tumour programmes and learn a discriminant: Ikarus [R6] and scMalignantFinder [R7]. The status of the task is **contested**.

Open problems:

- **No agreed ground truth.** DNA copy number and expert labels are both imperfect, and some author labels were derived from CNV calls. Two benchmark studies compare copy-number inference tools on single-cell data [R9, R10]; their datasets and truth definitions are discussed in section 10.
- **Normal-reference dependence.** When no normal cells are supplied, CopyKAT and SCEVAN estimate a diploid baseline from the sample itself (section 4), so a contaminated or mismatched reference shifts every call.
- **Calibration.** CopyKAT returns aneuploid or diploid labels, and Numbat's 0.5 cut is a decision rule on its posterior. Neither gives a calibrated malignant probability on a new sample.
- **Cohort shift.** A domain-generalising classifier targets annotation across cohorts and platforms [R8].
- **Diploid or low-CNV tumours** give expression-based callers no dosage signal to find.

## 3. Theory and insight

For cell $c$ in sample $s$, the target is $m_c\in\{0,1\}$, with $m_c=1$ for a malignant cell. Each output has a fixed estimand. The label estimates $m_c$. The probability estimates $\Pr(m_c=1\mid\text{data})$ on the probability scale, per cell. The CNV profile estimates the mean deviation of log expression from the reference in each window, per cell and on the log scale; it is not an integer copy number. The per-sample malignant fraction is $\pi_s=N_s^{-1}\sum_{c\in s}m_c$ over QC-passing cells, and every metric is reported with $\pi_s$.

Expression-dosage evidence rests on a first-order model. Writing $x_{gc}$ for the library-size-normalised count and $W_w$ for the genes in genomic window $w$ ordered by position, the family scores each cell as

$$r_{gc}=\log(x_{gc}+1)-\mu^{\mathrm{ref}}_{g},\qquad \bar r_{wc}=\frac{1}{|W_w|}\sum_{g\in W_w}r_{gc},\qquad A_c=\sum_{w}\bar r_{wc}^{\,2},$$

where $\mu^{\mathrm{ref}}_g$ is the mean over reference cells. This is a schematic of the family, not the statistic of any named tool, which smooth and segment differently. Its regime is first order in dosage, windows of many genes, and a truly diploid reference. CopyKAT smooths each cell along the genome with a dynamic linear model, segments copy states with MCMC change points and clusters the segmented profiles (section 4), so its output is cluster-based and binary.

Numbat models expression and alleles jointly over genomic bins with a hidden Markov model [R4]:

$$Y_{ci}\mid z_i,\ell_c\sim\mathrm{PLN}\big(\mu=\mu_{z_i}+\log(\ell_c\,\lambda^{*}_i),\ \sigma\big),\qquad a_{cj}\mid d_{cj},z\sim\mathrm{BetaBin}\big(d_{cj},\,p_j(z),\,\theta\big),$$

where $\mathrm{PLN}$ is the Poisson-lognormal, $Y_{ci}$ the expression count of bin $i$ in cell $c$, $\ell_c$ a cell library factor, $\lambda^{*}_i$ the reference expression rate of bin $i$, $z_i$ the copy state of bin $i$, $\mu_z$ the log-mean offset of state $z$, $\sigma$ the lognormal scale, $a_{cj}$ the alternate-allele count at SNP $j$ out of depth $d_{cj}$, $p_j(z)$ the state-dependent allele probability and $\theta$ an allele overdispersion. The expression term is the `dpoilog` likelihood (hmm.R:93), and the Poisson-lognormal and beta-binomial likelihoods are imported from hahmmr (main.R:18). The tumour posterior sums over tumour clones, and the call thresholds it:

$$\Pr(m_c=1\mid Y_c)=\sum_{k\in\mathcal T}\Pr(k_c=k\mid Y_c),\qquad \hat m_c=\mathbf 1\{\Pr(m_c=1\mid Y_c)>0.5\},$$

with $k_c$ the clone of cell $c$ and $\mathcal T$ the set of tumour clones. The allele term needs heterozygous SNPs with phase information; the expression term alone is an open case (section 10). The threshold is a decision rule, and the posterior is only as good as the clone model and the normal set.

SCEVAN fits a mixture of truncated Gaussians to segment means [R5]:

$$p(x_u)=\sum_j\pi_j\,\frac{\sigma_j^{-1}\varphi\!\big(\tfrac{x_u-\mu_j}{\sigma_j}\big)}{\Phi\!\big(\tfrac{b_j-\mu_j}{\sigma_j}\big)-\Phi\!\big(\tfrac{a_j-\mu_j}{\sigma_j}\big)}\,\mathbf 1\{a_j\le x_u\le b_j\},$$

where $x_u$ is the mean log-ratio of segment $u$, $\varphi$ and $\Phi$ the standard normal density and distribution, and $\pi_j,\mu_j,\sigma_j,[a_j,b_j]$ the weight, mean, standard deviation and truncation bounds of copy state $j$, fitted by EM. It applies after segmentation and assumes approximately Gaussian noise within each state.

The signature family fits a penalised logistic model on features $f_c$ (signature scores for Ikarus, expression features for scMalignantFinder) [R6, R7]:

$$P(m_c=1\mid f_c)=\sigma(\beta^{\top}f_c+\beta_0),\qquad \hat\beta=\arg\min_{\beta}\Big\{-\sum_c\log P(m_c\mid f_c)+\tfrac{1}{2C}\lVert\beta\rVert_2^2\Big\}.$$

Its regime is approximate linear separability in feature space, and a shift between cohorts moves the decision boundary. Ikarus seeds label propagation with a certainty schedule:

$$D_c=\max_k s_{ck}-\min_k s_{ck},\qquad q_i=q_0\,e^{-\kappa i},\qquad c\text{ is a seed at iteration } i\iff D_c>Q_{q_i}(D),$$

where $s_{ck}$ is the AUCell score of cell $c$ for signature $k$, $Q_q$ the empirical $q$-quantile over cells, $q_0$ the initial percentile and $\kappa$ a decay constant (section 4). Each iteration sets the rows of non-seed cells in the label matrix $P$ to $10^{-6}$, replaces $P$ by the row-normalised $WP$, with $W$ the kNN connectivities, and stops after `n_iter` iterations or when fewer than 0.1% of argmax labels change (classifier.py:108-125). The schedule assumes that the kNN graph is homophilous with respect to malignancy.

Benchmark metrics are computed per sample, with malignant as the positive class:

$$\mathrm{TPR}=\frac{TP}{TP+FN},\quad \mathrm{TNR}=\frac{TN}{TN+FP},\quad \mathrm{BA}=\tfrac12(\mathrm{TPR}+\mathrm{TNR}),\quad F_1=\frac{2\,TP}{2\,TP+FP+FN}.$$

Accuracy is not used, because when $\pi_s$ is far from 0.5 it mostly reflects the majority class.

Assumptions and failure modes. Dosage methods assume that tumour cells carry detectable dosage change, that expression is approximately linear in dosage after normalisation, that reference cells are diploid and uncontaminated, and that windows contain enough genes. Signature methods assume that malignancy programmes generalise and that the training cohort matches the target lineage. Both families assume conditional independence of cells given state, which neighbourhood effects and clonal structure violate. Common failures are normal-reference contamination, low tumour fraction (little dosage signal when $\pi_s$ is small), diploid tumours, low depth, and cell-state programmes absent from the reference, which can be read as dosage change.

Insight. Copy-number dosage is physically grounded and largely separate from transcriptional programmes, so the two families are complementary. They are not independent, however: the CNV profile and the signature scores come from the same counts, and multiplying their posteriors overcounts evidence. A stacked combiner fitted on held-out studies, or a joint model with one latent malignancy state, avoids this. Calibration on held-out samples is needed before scores are combined or methods compared.

Pitfalls. Author labels derived from CNV calls score CNV callers optimistically. Metrics move with $\pi_s$, so a comparison at one tumour fraction does not generalise. Agreement between tools is not accuracy.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CopyKAT | hybrid | Smooths each cell along the genome, segments copy states by MCMC and clusters the profiles into aneuploid and diploid calls. | [R3] |
| Numbat | model-based | Haplotype-aware HMM over bins with Poisson-lognormal expression and beta-binomial allele emissions, and a per-cell tumour posterior. | [R4] |
| SCEVAN | hybrid | Removes a synthetic baseline by Ward clustering, segments with VegaMC when confident normal cells are available, fits copy states by truncated-Gaussian EM, and labels the cluster rich in confident normal cells as non-malignant. | [R5] |
| Ikarus | model-based | Scores cells on tumour and normal signatures, classifies them with logistic regression and propagates confident labels over a kNN graph. | [R6] |
| scMalignantFinder (callout) | model-based | Logistic regression on a stored list of tumour up- and down-regulated genes, trained on normal versus malignant or tumour cells; RandomForest and XGBoost are also offered. | [R7] |

CopyKAT, SCEVAN and Numbat are the copy-number callers, and Ikarus and scMalignantFinder the signature classifiers, whose source code defines the defaults below. Numbat is the only one that uses allele counts. These five form the standard set against which singlet is compared. The choice follows the evidence each method uses rather than a benchmark ranking, since the published comparison studies are discussed in section 10. inferCNV, CaSpER and Cancer-Finder are excluded for the reasons given there.

| Method | Parameter | Value | Source (file:line, version) |
|---|---|---|---|
| CopyKAT | ngene.chr; min.gene.per.cell | 5; 200 | copykat.R:31 (1.2.5) |
| CopyKAT | LOW.DR; UP.DR | 0.05; 0.1 | copykat.R:31 |
| CopyKAT | win.size; KS.cut | 25; 0.1 | copykat.R:31 |
| CopyKAT | distance; n.cores; cell.line | euclidean; 1; no | copykat.R:31 |
| CopyKAT | genome | hg20 (literal string) | copykat.R:31 |
| CopyKAT | random seed; synthetic-baseline seed | 1234; 123 | copykat.R:34; baseline.synthetic.R:38 |
| CopyKAT | smoothing model | dynamic linear model, order 1, dV 0.16, dW 0.001 | copykat.R:117 |
| CopyKAT | baseline | synthetic if no normal cells; median of supplied normal cells otherwise | copykat.R:127-145 |
| Numbat | max_iter; max_nni | 2; 100 | main.R:70 (1.5.2) |
| Numbat | t; gamma; min_LLR | 1e-5; 20; 5 | main.R:70 |
| Numbat | alpha; eps | 1e-4; 1e-5 | main.R:71 |
| Numbat | max_entropy; init_k; min_cells | 0.5; 3; 50 | main.R:71 |
| Numbat | tau; nu | 0.3; 1 | main.R:71 |
| Numbat | ncores | 1 | main.R:73 |
| Numbat | multi_allelic; skip_nj | TRUE; FALSE | main.R:75 |
| Numbat | tumour call | p_cnv > 0.5 | main.R:1105 |
| SCEVAN | par_cores; SMOOTH; SEGMENTATION_CLASS | 20; TRUE; TRUE | classifyTumor.R:170 (1.0.3) |
| SCEVAN | beta_vega; FIXED_NORMAL_CELLS; distance | 0.5; FALSE; euclidean | classifyTumor.R:170 |
| SCEVAN | baseline clustering | Ward ward.D2; k by Calinski-Harabasz, gMax 10 | classifyTumor.R:15-16 |
| SCEVAN | cluster label | cluster with the largest fraction of confident normal cells is non-malignant | classifyTumor.R:135-143 |
| Ikarus | scorer; core_model | AUCell; LogisticRegression | classifier.py:226-227 (0.0.3) |
| Ikarus | n_neighbors; n_iter | 100; 50 | classifier.py:228, 231 |
| Ikarus | use_highly_variable; adapt_signatures | False; False | classifier.py:229-230 |
| Ikarus | certainty_threshold; decay kappa | 0.9; 0.3 | classifier.py:232; 109 |
| Ikarus | DE lfc; DE p-value; DE test | 1; 0.1; t-test_overestim_var | gene_list.py:13-15 |
| Ikarus | rank n_genes; top_x | 15000; 300 | gene_list.py:49, 115 |
| scMalignantFinder | model_method | LogisticRegression | classifier.py:85 (1.2.0) |
| scMalignantFinder | C | not set in code (scikit-learn default) | classifier.py:21 |
| scMalignantFinder | label map | Normal 0; Malignant or Tumor 1 | classifier.py:227 |
| scMalignantFinder | outputs | scMalignantFinder_prediction; malignancy_probability | classifier.py:251-254 |

## 5. Proposed singlet approach

Routes follow section 12, where licence terms are stated. **Ikarus** is ported: AUCell scoring, the seed schedule and label propagation are rebuilt on singlet's neighbour graph, and the logistic head is retrained on catalogue labels rather than shipped. **Numbat** is ported, with the HMM and its emissions rebuilt; an expression-only path is added only after it is validated. **CopyKAT** and **SCEVAN** are reimplemented from the published methods and the defaults in section 4, not by translating source; the CopyKAT terms in section 12 must be cleared first. **scMalignantFinder** is a callout: the user runs it as a comparator, and neither its code nor its model is redistributed.

The proposed default is `classifier`, singlet's own model: a logistic head (or a small multilayer perceptron) over pseudobulk-normalised features, trained on catalogue cells with author malignant and normal labels, split by study and patient. Its probabilities are calibrated by temperature scaling on held-out studies. It is falsified if it fails the B2 acceptance criterion, or if temperature scaling does not reduce per-study calibration error on held-out studies.

Optional CNV evidence comes from an expression-only HMM over genomic bins, with negative-binomial emissions, run per sample. It is combined with the classifier by a stacked logistic combiner fitted on held-out samples, not by multiplying posteriors (section 3). The combination is falsified if its B1 sensitivity at low tumour fraction is no better than the classifier alone. Normal cells come from `obs/is_normal_reference` when present, then from immune or stromal labels in `obs/cell_type`, and otherwise from the copykat or scevan baseline.

PyTorch trains the classifier and the combiner, which are small. Hard-coded CUDA or cuSPARSE covers the hot small kernels: logistic scoring on signature scores (a dense matrix-vector product), label propagation over the kNN graph (a sparse matrix-vector product), and the bin-level HMM forward-backward, where cells are independent and the state space is small. The CPU path stays dependency-free C++. The classifier path streams blocks of cells; CNV callers run per sample in memory, with blocks split at sample boundaries. An agent should use the defaults in the MCP definition without asking: classifier, auto normal reference, seed 1234 and auto device. Use `numbat` only when allele inputs exist and copy-number evidence is needed. Do not run any method on samples without tumour cells.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | raw UMI counts, cells by genes |
| read | var/chrom, var/start, var/end | categorical, int | gene coordinates for window scores |
| read | uns/genome_build | string | genome build selecting the annotation table |
| read | obs/sample_id | categorical | sample label for per-sample references and metrics |
| read | obs/is_normal_reference | bool, optional | known non-malignant cells used as the reference |
| read | obs/cell_type | categorical, optional | labels used to pick normal cells when none is marked |
| read | layers/allele_ref, layers/allele_alt | sparse int, optional | reference and alternate counts at heterozygous SNPs |
| write | obs/malignant_label | categorical | malignant, non-malignant or unassigned |
| write | obs/malignant_prob | float32 | malignant probability in [0, 1]; NaN for methods without one |
| write | obs/malignant_method | categorical | method that produced the call |
| write | obsm/cnv_profile | float32, cells by windows, optional | mean log-expression deviation per window, not integer copy number |
| write | uns/malignant_params | dict | method, thresholds, normal reference source, software version |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "classifier" | `classifier`, `copykat`, `scevan`, `numbat`, `ikarus` | Malignant caller. classifier is the default; numbat requires allele inputs. |
| `normal_reference` | string | "auto" | — | auto uses obs/is_normal_reference when set, then immune or stromal labels in obs/cell_type; otherwise copykat and scevan build a synthetic diploid baseline. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 1234 | — | Random seed for stochastic steps, such as copykat MCMC segmentation. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `copykat` | object | — | — | Options for method copykat; ignored by other methods. |
| `copykat.min_genes_per_cell` | integer | 200 | — | Cells with fewer detected genes are dropped before CNV scoring. |
| `copykat.ngene_chr` | integer | 5 | — | Minimum genes per chromosome for a cell to pass filtering. |
| `copykat.win_size` | integer | 25 | — | Minimum window size for segmentation (CopyKAT win.size). |
| `copykat.ks_cut` | number | 0.1 | — | Segmentation sensitivity (CopyKAT KS.cut); larger values give looser criteria. |
| `copykat.low_dr` | number | 0.05 | — | Lower gene-filter threshold (CopyKAT LOW.DR). |
| `copykat.up_dr` | number | 0.1 | — | Upper gene-filter threshold (CopyKAT UP.DR). |
| `scevan` | object | — | — | Options for method scevan; ignored by other methods. |
| `scevan.beta_vega` | number | 0.5 | — | VegaMC segmentation parameter; higher values give coarser segments. |
| `scevan.par_cores` | integer | 20 | — | Number of cores used by SCEVAN. |
| `scevan.fixed_normal_cells` | boolean | false | — | Keep the supplied normal cells as a fixed reference; intended for clonal-structure analyses. |
| `numbat` | object | — | — | Options for method numbat; ignored by other methods. |
| `numbat.t` | number | 1e-05 | — | HMM switch probability between copy states. |
| `numbat.gamma` | number | 20 | — | Numbat gamma parameter from the source defaults. |
| `numbat.min_llr` | number | 5 | — | Minimum log-likelihood ratio used in Numbat segment calls. |
| `numbat.max_iter` | integer | 2 | — | Maximum iterations of Numbat's inference loop. |
| `numbat.tumour_posterior_threshold` | number | 0.5 | — | A cell whose tumour posterior exceeds this value is called malignant. |
| `numbat.ncores` | integer | 1 | — | Number of cores used by Numbat. |
| `ikarus` | object | — | — | Options for method ikarus; ignored by other methods. |
| `ikarus.n_neighbors` | integer | 100 | — | Neighbours in the kNN graph used for label propagation. |
| `ikarus.n_iter` | integer | 50 | — | Number of label-propagation iterations. |
| `ikarus.certainty_threshold` | number | 0.9 | — | Initial certainty percentile for seed cells. |
| `classifier` | object | — | — | Options for method classifier; ignored by CNV methods. |
| `classifier.decision_threshold` | number | 0.5 | — | A cell with malignant probability at or above this value is called malignant. |
| `classifier.C` | number | 1.0 | — | Inverse L2 regularisation strength of the logistic head. |
<!-- PARAMS:AUTO:END -->

Method options apply only to their method: `copykat`, `scevan`, `numbat` and `ikarus` options are ignored by other methods, and `classifier` options are ignored by the CNV methods. The `numbat` method refuses to run without allele inputs. The normal reference is taken from `obs/is_normal_reference`, then from immune and stromal labels in `obs/cell_type`, then, for copykat and scevan only, from a synthetic diploid baseline. The decision threshold applies to probabilities only, so hard-label methods are not thresholded. Counts must be raw integers; library-size normalisation is applied internally.

## 7. MCP tool

Tool `singlet_disease_clinical_malignant_cell_identification` (definition in `tasks/mcp/singlet_disease_clinical_malignant_cell_identification.json`). Example call and result:

```json
{"dataset": "/data/tumour_sample.singlet", "method": "copykat", "copykat": {"min_genes_per_cell": 200}, "seed": 1234}
```

```json
{"dataset": "/data/tumour_sample.singlet", "status": "completed",
 "wrote": ["obs/malignant_label", "obs/malignant_method", "obsm/cnv_profile", "uns/malignant_params"],
 "summary": {"method": "copykat", "n_cells": "<int>", "n_malignant": "<int>", "malignant_fraction": "<float>", "normal_reference_source": "synthetic"},
 "provenance_id": "<id>", "job_id": null, "estimate": null}
```

Long-running: copykat and scevan on large samples can return `queued` with a `job_id`; the classifier path runs inline. Stochastic: copykat's segmentation uses `seed`, and the classifier is deterministic given its weights. Dry run: returns estimated seconds, peak memory and device for the chosen method without writing members.

## 8. Benchmarks

Each benchmark runs one sample at a time unless stated. Comparators run at the defaults in section 4 on identical gene sets and count matrices, with normal-reference handling held identical where the tool allows. Metrics are computed per sample against that sample's truth labels and reported beside $\pi_s$; the summary is the median across samples and across tumour-fraction strata. Replicates use seeds 0 to 9, and single runs of stochastic comparators use seed 1234. No threshold is tuned on evaluation samples. Hard-label callers contribute one operating point, not a score-based curve.

### B1. Planted copy-number recovery in simulated tumour samples (proposed)

- **Goal**: measure how well each caller recovers planted arm-level copy-number events, and how that depends on tumour fraction and depth, when the truth is exact.
- **Ground truth**: planted simulation. Each simulated cell has $m_c=1$ if the malignant generator produced it, by construction. Metrics are normalised within each simulated sample.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Reference pool | singlet catalogue, cells annotated as immune or stromal types from studies with no tumour | scRNA-seq, human; sized per replicate in the recipe | — | Study identifiers kept; malignant parameters come from disjoint studies |

- **Generator recipe**
  1. Draw normal cells from the reference pool, and take the malignant pool means and dispersions from a second set of studies disjoint from the first.
  2. Choose K = 5 arm-level events per replicate (proposed) and assign each a copy ratio $r\in\{0.5,1.5,2.0\}$.
  3. Draw a buffering factor $b_g\sim\mathrm{Uniform}(0.5,1)$ per gene and use the effective ratio $\rho_{gc}=1+b_g(r-1)$, so dosage is not exactly linear.
  4. Draw malignant counts $X_{gc}\sim\mathrm{NB}(\ell_c\,m_g\,\rho_{gc},\,\phi_g)$, with $\ell_c$ a library size from the pool, $m_g$ the pool mean and $\phi_g$ the pool dispersion.
  5. Mix malignant and normal cells to $\pi\in\{0.1,0.2,0.4,0.6,0.8\}$ over N = 5,000 cells (proposed).
  6. Thin UMIs binomially to per-cell targets of 1,000, 2,000 and 5,000 (proposed).
  7. Run 10 replicates (proposed).
- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| AUROC | Mann-Whitney AUROC of the score for $m_c$ within each simulated sample, ties averaged; score-output methods only | maximize | primary | — |
| Sensitivity at 95% specificity | TPR at the threshold where the FPR on normal cells is 0.05 | maximize | primary | — |
| Expected calibration error | 10 equal-width bins of predicted probability, $\sum_b (n_b/N)\lvert\bar y_b-\bar p_b\rvert$ | minimize | guardrail | — |

- **Comparators**: CopyKAT, SCEVAN, Ikarus, scMalignantFinder (callout) and the singlet classifier, at the versions in section 4.
- **Protocol**: as in the shared protocol. Hard-label callers give a single operating point and no AUROC.
- **Acceptance**: AUROC at least 0.95 for events with $r=0.5$ or $1.5$ at $\pi\ge0.2$ and at least 2,000 UMI per cell. Proposed threshold.
- **Known pitfalls**: planted malignant cells keep normal cell identity, so signature methods are expected to fail by construction and are reported separately. Thresholds must not be tuned on simulation alone.

### B2. Held-out-study expert-label benchmark on the catalogue (proposed)

- **Goal**: measure generalisation of malignant classifiers to unseen studies and patients, using author annotations as expert labels.
- **Ground truth**: expert labels. Each cell's $m_c$ comes from the author annotation column, mapped to malignant (malignant, tumour, cancer cell) or non-malignant (normal epithelial, stromal, immune, endothelial). Ambiguous labels are dropped. Normalisation is per study.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Annotated catalogue cells from studies with tumour present | singlet catalogue, author annotation column | scRNA-seq, human; size fixed at generation | — | Grouped by study and patient ID |

- **Metrics**

| Metric | Definition (ties, thresholds, aggregation) | Direction | Role | Reference |
|---|---|---|---|---|
| Per-study AUROC | AUROC within each held-out study; median across studies | maximize | primary | — |
| Macro-F1 | mean over studies of malignant-class F1, using each method's own decision rule | maximize | primary | — |
| Per-study ECE | expected calibration error within each held-out study | minimize | guardrail | — |

- **Comparators**: Ikarus, CopyKAT, SCEVAN, scMalignantFinder (callout) and the singlet classifier.
- **Protocol**: group k-fold by study and by patient ID. Model-based methods are refitted on training studies only. CNV callers run per sample at defaults on a 10,000-cell subsample. Studies whose annotation provenance records CNV use are flagged and reported separately.
- **Acceptance**: median per-study AUROC at least 0.90 for the singlet classifier, and within 0.02 of the best comparator. Proposed threshold.
- **Known pitfalls**: CNV-derived author labels favour CNV callers, which is why flagged studies are reported separately. Patient-level leakage across studies is avoided only when grouping uses patient ID.

### P1. Performance and scaling

Wall time and peak memory per sample at 10k, 100k and 1M cells, on CPU and CUDA; 10M cells only for the streaming classifier path. Comparators: CopyKAT (default one core, and matched cores), SCEVAN (default 20 cores), Numbat (one core, with allele inputs), Ikarus and the singlet classifier. Hold fixed: gene set, count matrix, core count, seed and normal-reference handling. Ward clustering in CopyKAT and SCEVAN builds a distance matrix over all cells, so its memory grows with the square of cell number. Proposed acceptance: the classifier path finishes in under one minute for 100k cells on 8 CPU cores, to be checked on target hardware.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `qc.low_quality_cell_detection`: Low-quality and damaged cell detection from per-cell QC metrics
  - `normalization.size_factor_estimation`: Per-cell size factor estimation
  - `annotation.cluster_label_assignment`: Cluster-level cell type label assignment
  - `neighbors.approximate_knn_search`: Approximate versus exact k-nearest-neighbour graph construction at scale
- **Feeds**:
  - `genetics.clonal_substructure_inference`: Clonal and subclonal grouping from genotype-derived cell features
  - `genetics.dna_clone_assignment`: Assignment of scRNA-seq cells to DNA-defined tumour clones
  - `disease-clinical.drug_sensitivity_prediction`: Cell-level drug sensitivity prediction from scRNA-seq
- **Reads**: `layers/counts`, `var/chrom`, `var/start`, `var/end`, `uns/genome_build`, `obs/sample_id`, `obs/is_normal_reference`, `obs/cell_type`, `layers/allele_ref`, `layers/allele_alt`
- **Writes**: `obs/malignant_label`, `obs/malignant_prob`, `obs/malignant_method`, `obsm/cnv_profile`, `uns/malignant_params`
<!-- CHAINING:AUTO:END -->

Used between normal-cell annotation and the tumour-only analyses that consume its malignant subset.

## 10. Risks, pitfalls and open questions

- **Published comparison studies.** R9 takes CNA calls from scDNA-seq of the same cells as truth and compares inferCNV, CopyKAT, SCEVAN, Numbat and CaSpER. R10 compares HoneyBADGER, CopyKAT, CaSpER, inferCNV and sciCNV on several scRNA-seq platforms. Neither study's figures or thresholds are reproduced here, so no published benchmark appears in section 8.
- **Excluded methods.** inferCNV, CaSpER [R11] and Cancer-Finder [R8] are excluded from the tables and the MCP enum. The inferCNV README states that the tool is no longer supported and names InferCNA, CopyKAT and Numbat as alternatives. Cancer-Finder's repository is listed in section 12.
- **Source gaps.** The Numbat transition matrix and clone model are only partly specified in its released code, and its expression-only mode is unverified. CopyKAT's default genome string, hg20, is not a standard build label; it selects annotateGenes.hg20 (copykat.R:64-75, 242; annotateGenes.hg20.R:12), and the gene table behind that function is not described here.
- **Citations.** The Ikarus paper's author list is absent from the local bibliography, so R6 has no author names. Author names are dashed for R6, R7, R8, R10 and R11 because no record confirmed them. Repositories are pinned by version, not by commit.
- **Licences.** Routes and terms are in section 12. The CopyKAT and SCEVAN routes must be cleared before any reimplementation or benchmark run. The catalogue's own data-use terms are not stated in this document, so B1 and B2 need a data-use check before any evaluation.
- **First experiment.** Evaluate B1 with the default settings of CopyKAT, SCEVAN, Ikarus and the singlet classifier over 10 replicates, and test whether the classifier meets the proposed AUROC threshold. Then evaluate B2 with and without temperature scaling, and test whether the CNV head improves sensitivity at low tumour fraction on B1.

## 11. References

R1. Patel AP, Tirosh I, Trombetta JJ, et al. Single-cell RNA-seq highlights intratumoral heterogeneity in primary glioblastoma. *Science* 2014. doi:10.1126/science.1254257 — verified (corpus)
R2. Tirosh I, Izar B, Prakadan SM, et al. Dissecting the multicellular ecosystem of metastatic melanoma by single-cell RNA-seq. *Science* 2016. doi:10.1126/science.aad0501 — verified (corpus)
R3. Gao R, Bai S, Henderson YC, et al. Delineating copy number and clonal substructure in human tumors from single-cell transcriptomes. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00795-2 — verified (corpus)
R4. Gao T, Soldatov R, Sarkar H, et al. Haplotype-aware analysis of somatic copy number variations from single-cell transcriptomes. *Nature Biotechnology* 2022. doi:10.1038/s41587-022-01468-y — verified (repo)
R5. De Falco A, Caruso F, Su XD, Varone A, Ceccarelli M. A variational algorithm to detect the clonal copy number substructure of tumors from scRNA-seq data. *Nature Communications* 2023. doi:10.1038/s41467-023-36790-9 — verified (corpus)
R6. —. Identifying tumor cells at the single-cell level using machine learning. *Genome Biology* 2022. doi:10.1186/s13059-022-02683-1 — verified (corpus)
R7. —. scMalignantFinder distinguishes malignant cells in single-cell and spatial transcriptomics by leveraging cancer signatures. *Communications Biology* 2025. doi:10.1038/s42003-025-07942-y — verified (corpus)
R8. —. Domain generalization enables general cancer cell annotation in single-cell and spatial transcriptomics. *Nature Communications* 2024. doi:10.1038/s41467-024-46413-6 — verified (corpus)
R9. Song et al. Benchmarking copy number aberrations inference tools using single-cell multi-omics datasets. *Briefings in Bioinformatics* 2025;26(2):bbaf076. doi:10.1093/bib/bbaf076. Preprint doi:10.1101/2024.09.26.615284 — verified (search)
R10. —. A benchmarking study of copy number variation inference methods using single-cell RNA-sequencing data. *Precision Clinical Medicine* 2025;8(2):pbaf011. doi:10.1093/pcmedi/pbaf011. Preprint doi:10.1101/2024.09.09.612120 — verified (search)
R11. —. CaSpER identifies and visualizes CNV events by integrative analysis of single-cell or bulk RNA-sequencing data. *Nature Communications* 2020. doi:10.1038/s41467-019-13779-x — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/navinlabcode/copykat | Ruli Gao (author and maintainer) | Conflict: DESCRIPTION states GPL-2; the Copyright file allows academic and non-profit research use, limits other organisations to evaluation, and forbids sale or redistribution without written approval; no LICENSE file | CopyKAT reference implementation; defaults in section 4 | reimplement |
| https://github.com/kharchenkolab/numbat | Teng Gao (maintainer), Ruslan Soldatov, Hirak Sarkar, Evan Biederstedt, Peter Kharchenko (DESCRIPTION) | MIT with LICENSE file (copyright 2022, Teng Gao) | Numbat reference implementation | port |
| https://github.com/AntonioDeFalco/SCEVAN | A. De Falco, M. Ceccarelli | Conflict: DESCRIPTION states GPL-2; COPYING is the GPL-3 text | SCEVAN reference implementation | reimplement |
| https://github.com/BIMSBbioinfo/ikarus | BIMSB bioinformatics platform (LICENSE copyright line); no author field in setup.py | MIT (LICENSE and setup.py) | Ikarus reference implementation | port |
| https://github.com/Jonyyqn/scMalignantFinder | Journey Yu (setup.py) | CC-BY-NC-ND-4.0 (LICENSE) | comparator | callout |
| https://github.com/broadinstitute/inferCNV | Timothy Tickle, Itay Tirosh, Christophe Georgescu, Maxwell Brown, Brian Haas | BSD-3-Clause with LICENSE file | excluded: no longer supported | excluded |
| https://github.com/akdess/CaSpER | Akdes Serin Harmanci, Arif O. Harmanci | none stated (no LICENSE file; no License field) | excluded | excluded |
| https://github.com/Patchouli-M/SequencingCancerFinder | Patchouli (repository owner) | MIT (LICENSE) | Cancer-Finder code [R8] | excluded |
