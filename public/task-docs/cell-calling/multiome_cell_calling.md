---
id: cell-calling.multiome_cell_calling
title: Joint RNA and chromatin cell/nucleus calling in single-nucleus multiome data
area: cell-calling
scope: extended
paradigm: model-based
literature_status: contested
priority: P2
depends_on: [ingest-quant.intron_inclusive_gene_counting, ingest-quant.barcode_whitelist_correction]
feeds: [cell-calling.residual_empty_droplet_removal, qc.single_nucleus_quality_filtering, multimodal.paired_joint_embedding, grn.multiome_egrn_inference]
reads: [layers/counts, layers/atac_peaks]
writes: [obs/nucleus_call_multiome, obs/nucleus_fdr_multiome, obs/nucleus_fdr_rna, obs/nucleus_fdr_atac, uns/nucleus_ambient_profile_rna, uns/nucleus_ambient_profile_atac, uns/nucleus_call_params_multiome]
devices: [cpu, cuda]
mcp_tool: singlet_cell_calling_multiome_cell_calling
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Joint RNA and chromatin cell/nucleus calling in single-nucleus multiome data

> For each barcode of a single-nucleus RNA plus ATAC multiome run, decide whether it holds a nucleus or only the ambient RNA and chromatin background shared across the run.

## 1. Question

In a single-nucleus multiome library, which barcodes contain a nucleus rather than only the shared RNA and ATAC background, and where do joint calls differ from RNA-only calls? The inputs are the raw barcode-by-gene UMI matrix and the barcode-by-peak ATAC count matrix for the same barcodes; the output is one call per barcode with a joint FDR and per-modality FDRs. A correct answer keeps barcodes whose RNA and chromatin profiles depart from the ambient profiles at the stated error rate.

## 2. Why this task matters and where the field stands

Every droplet carries ambient material, so cell calling is the first decision in a multiome analysis, and errors propagate into clustering and annotation. Droplet-based profiling of this kind is described in [R3]. The status is **contested**. EmptyDropsMultiome [R1] extends the RNA-only EmptyDrops test [R2] to a second modality, with separate ambient profiles for RNA and ATAC, and its planted-nucleus simulations are reported to show higher power than Cell Ranger ARC and than RNA-only calling [R1]. Open problems: (1) the joint FDR combines two modalities, and its calibration under dependence is not characterised; (2) RNA and ATAC backgrounds may not be independent given the library; (3) nuclei with low RNA and few fragments sit at the soup boundary, where calls are least certain; (4) the published comparators are heuristic rules, so model-based calls can be compared with them but not validated against them.

## 3. Theory and insight

Barcode $j$ carries an RNA count vector $\mathbf{y}^R_j$ over genes with total $n_j=\sum_g y_{gj}$, and an ATAC count vector $\mathbf{a}_j$ over peaks. Each modality has one ambient profile ($\boldsymbol\pi^R$ or $\boldsymbol\pi^A$, non-negative and summing to one) shared by all droplets of the library. The RNA ambient-only null is a Dirichlet-multinomial with scale $\alpha$, whose multinomial limit is $\alpha\to\infty$:

$$P(\mathbf{y}_j \mid n_j,\alpha,\boldsymbol\pi) = \frac{n_j!\,\Gamma(\alpha)}{\Gamma(n_j+\alpha)}\prod_g \frac{\Gamma(y_{gj}+\alpha\pi_g)}{y_{gj}!\,\Gamma(\alpha\pi_g)}$$

A finite $\alpha$ absorbs overdispersion from PCR duplicates and aggregates; the multinomial is adequate only when molecules are not clustered. Evaluation needs nonzero entries only, because $\Gamma(\alpha\pi_g)/\Gamma(\alpha\pi_g)=1$ for zeros:

$$\log P=\log n_j!+\log\Gamma(\alpha)-\log\Gamma(n_j+\alpha)+\sum_{g:\,y_{gj}>0}\big[\log\Gamma(y_{gj}+\alpha\pi_g)-\log\Gamma(\alpha\pi_g)-\log y_{gj}!\big]$$

Each barcode receives a Monte Carlo p-value from $R$ null draws $\mathbf y^{(r)}$ with the same $n_j$:

$$p_j=\frac{1+\sum_{r=1}^{R}\mathbf 1\big[P(\mathbf y^{(r)}\mid n_j)\le P(\mathbf y_j\mid n_j)\big]}{R+1}$$

Its resolution is $1/(R+1)$, so a threshold of 0.001 needs $R$ of order $10^4$. Barcodes at or above the knee are set to $p_j=0$ (RNA only), and the rest are adjusted by Benjamini–Hochberg over $m$ barcodes, $\mathrm{FDR}_{(k)}=\min_{l\ge k}m\,p_{(l)}/l$. This adjustment is valid under independence or positive regression dependence, and neither is established for joint RNA and ATAC p-values.

A latent-indicator formulation, singlet's proposal rather than the published rule, is $P(z_j=1\mid\mathbf y^R_j,\mathbf a_j)=\pi_1L_1/(\pi_0L_0+\pi_1L_1)$ with $L_0=P(\mathbf y^R_j\mid\boldsymbol\pi^R)\,P(\mathbf a_j\mid\boldsymbol\pi^A)$. $L_1$ needs a cell-profile model, and $L_0$ factorises only if the modalities are conditionally independent given $z_j$, which is untested.

Estimands, one sentence each:
- $p_j$ and $\mathrm{FDR}_j$ (joint, RNA, ATAC): the per-barcode p-value and its BH adjustment on the probability scale; the set $\{j:\mathrm{FDR}_j\le q\}$ targets an expected ambient-only fraction of at most $q$, under the conditions above.
- $\boldsymbol\pi$: the pooled share of counts over barcodes at or below the lower total, normalised to sum to one per modality.
- Planted recall $R_k(q)$: called barcodes of identity $k$ divided by all barcodes of identity $k$.
- Observed FDR: called barcodes of identity 0 divided by all called barcodes, NA excluded.
- Retention $|S\cap S_{\mathrm{ref}}|/|S_{\mathrm{ref}}|$ and per-type retrieval $r_k=|S\cap C_k|/|C_k|$, the latter reported as its minimum over types.
- Null call fraction: all-ambient barcodes called divided by all barcodes.

Threshold rules work when library size separates nuclei from background and fail where it does not. The model adds a null with a stated error rate, a per-barcode probability, and a fitted component that can be reused, and it can be checked on the null (B3) and on planted nuclei (B1). Failure modes: contamination of the assumed-empty set with low-depth nuclei inflates the soup with cell-type genes, so low-RNA nuclei look ambient; composition shift between low-total and cell-containing droplets biases the FDR; a nucleus whose profile matches the soup is not identifiable from counts.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| EmptyDropsMultiome | model-based | Per-modality EmptyDrops-type tests with separate RNA and ATAC ambient profiles, reported as joint and per-modality FDRs | [R1] |
| EmptyDrops (RNA only) | model-based | Dirichlet-multinomial test of RNA totals against an ambient profile, Monte Carlo p-values, BH | [R2] |
| emptyDropsCellRanger | heuristic | UMI-rank filter that emulates Cell Ranger 3 cell calling | [R2] |

The published standard for multiome calling is EmptyDropsMultiome [R1], and EmptyDrops on RNA alone [R2] is the model it extends and the standard for single-modality libraries. The vendor pipeline's cell-calling step and ATAC library-size thresholds are heuristic comparators. Singlet implements the first two methods and keeps emptyDropsCellRanger as a callout.

| Method | Parameter | Value | Source |
|---|---|---|---|
| EmptyDropsMultiome | lower_rna, lower_atac | NULL (automatic) in the tutorial; 100 or 150 (RNA), 60, 90 or 110 (ATAC) in simulation drivers | real/tutorial_w_mixture_fit_and_umap_qc.R:70; simulations/simrun_multiomics.R:107-125 @558a478 |
| EmptyDropsMultiome | niter_rna, niter_atac | 30000 each | simulations/simrun_multiomics.R:191 @558a478 |
| EmptyDropsMultiome | barhop_rna, barhop_atac (not exposed) | NULL in tutorial; 10 (RNA), 3 to 20 (ATAC) in simulation drivers | simulations/simrun_multiomics.R:107-125 @558a478 |
| EmptyDropsMultiome | call threshold | FDR ≤ 0.001, NA excluded | simulations/simrun_multiomics.R:233 @558a478 |
| EmptyDropsMultiome | seed | set.seed(0) | real/tutorial_w_mixture_fit_and_umap_qc.R @558a478 |
| EmptyDrops (RNA only) | lower | 100 | R/emptyDrops.R:188 (DropletUtils source) |
| EmptyDrops (RNA only) | niters | 10000 | R/emptyDrops.R:188 (DropletUtils source) |
| EmptyDrops (RNA only) | alpha | Inf; NULL estimates alpha by maximum likelihood | R/emptyDrops.R:188 (DropletUtils source) |
| EmptyDrops (RNA only) | retain | knee from barcodeRanks; Total ≥ retain gets p = 0 | R/emptyDrops.R:381-412 (DropletUtils source) |
| EmptyDrops (RNA only) | multiple testing | BH | R/emptyDrops.R:412 (DropletUtils source) |
| emptyDropsCellRanger | n.expected.cells, max.percentile, max.min.ratio | 3000, 0.99, 10 | R/emptyDropsCellRanger.R:100-104 (DropletUtils source) |

## 5. Proposed singlet approach

Routes: EmptyDropsMultiome is reimplemented from the equations above, because its repository has no licence file; the emptydrops_rna path reimplements the DropletUtils equations; emptyDropsCellRanger and the vendor pipeline are callouts. No code is copied from any repository.

The default is `emptydrops_multiome` with `fdr_threshold` 0.001, automatic lower values, 30000 Monte Carlo draws per modality, seed 0 and device auto. This is the published joint test. Until its combination rule is matched (section 10), singlet's output is labelled a reimplementation, not a new method.

The latent-indicator model (section 3) replaces the joint rule with a posterior $P(z_j=1)$ built on separate ambient components and the nonzero-only likelihood. It enters the enum only after B1 and B3 pass their acceptance criteria. MultiVI [R4] is the published reference for a learned RNA and ATAC likelihood; it is not a cell caller and is outside the default path.

Hardware: the per-barcode likelihood and Monte Carlo null draws are small, hot, sparse loops, so they are hard-coded as CUDA and cuSPARSE kernels with a CPU reference. PyTorch is reserved for a learned component, which is not in the default path. p-values are independent given the ambient profiles and can be computed in chunks; BH needs all p-values and runs as a final pass. Streaming is not claimed; the first version holds the matrix in CSC form in memory.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | Raw barcode-by-gene UMI counts, all barcodes unfiltered |
| read | layers/atac_peaks | sparse int | Barcode-by-peak fragment counts for the same barcodes |
| write | obs/nucleus_call_multiome | bool | Call at `fdr_threshold` under the selected method |
| write | obs/nucleus_fdr_multiome | float32 | Joint BH-adjusted FDR; set only by emptydrops_multiome |
| write | obs/nucleus_fdr_rna | float32 | RNA-only BH-adjusted FDR |
| write | obs/nucleus_fdr_atac | float32 | ATAC-only BH-adjusted FDR; set only by emptydrops_multiome |
| write | uns/nucleus_ambient_profile_rna | float64 | Pooled RNA ambient profile over genes, sums to 1 |
| write | uns/nucleus_ambient_profile_atac | float64 | Pooled ATAC ambient profile over peaks, sums to 1 |
| write | uns/nucleus_call_params_multiome | dict | Parameters, lower values chosen, seed, threshold, input hashes |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI (local path, s3://, r2://, https://) or a workspace handle. |
| `method` | string | "emptydrops_multiome" | `emptydrops_multiome`, `emptydrops_rna` | emptydrops_multiome: joint RNA and ATAC test; emptydrops_rna: RNA-only test, ATAC not read. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `fdr_threshold` | number | 0.001 | min 0; max 1 | Barcodes with FDR at or below this value are called nuclei. |
| `rna_layer` | string | "counts" | — | RNA UMI layer to read; all barcodes, unfiltered, must be present. |
| `atac_layer` | string | "atac_peaks" | — | ATAC barcode-by-peak count layer; required only by emptydrops_multiome. |
| `seed` | integer | 0 | — | Random seed for Monte Carlo null draws. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `emptydrops_multiome` | object | — | — | Options for emptydrops_multiome. |
| `emptydrops_multiome.lower_rna` | integer/null | null | min 0 | RNA total at or below which barcodes define the RNA ambient profile; null selects automatically. |
| `emptydrops_multiome.lower_atac` | integer/null | null | min 0 | ATAC total at or below which barcodes define the ATAC ambient profile; null selects automatically. |
| `emptydrops_multiome.niter_rna` | integer | 30000 | min 1 | Monte Carlo draws for RNA p-values; p resolution is 1/(niter+1). |
| `emptydrops_multiome.niter_atac` | integer | 30000 | min 1 | Monte Carlo draws for ATAC p-values; p resolution is 1/(niter+1). |
| `emptydrops_rna` | object | — | — | Options for emptydrops_rna. |
| `emptydrops_rna.lower` | integer | 100 | min 0 | RNA total at or below which barcodes define the ambient profile. |
| `emptydrops_rna.niters` | integer | 10000 | min 1 | Monte Carlo draws for p-values. |
| `emptydrops_rna.alpha` | string | "inf" | `inf`, `estimate` | inf: multinomial null; estimate: Dirichlet-multinomial scale fitted by maximum likelihood. |
<!-- PARAMS:AUTO:END -->

`method` decides which outputs are filled: `emptydrops_multiome` writes all three FDR members, and `emptydrops_rna` writes `obs/nucleus_fdr_rna` and sets the call from it. `emptydrops_multiome` needs `atac_layer` over the same barcodes as `rna_layer`. Automatic lower values follow an open rule (section 10). A threshold of 0.001 needs at least 1000 draws per modality; 30000 is the source repository's value.

## 7. MCP tool

Tool name `singlet_cell_calling_multiome_cell_calling` (definition in `tasks/mcp/singlet_cell_calling_multiome_cell_calling.json`). Example call:

```json
{"dataset": "data/pbmc10k_multiome.singlet", "method": "emptydrops_multiome", "fdr_threshold": 0.001, "seed": 0}
```

Example result:

```json
{"dataset": "data/pbmc10k_multiome.singlet", "status": "completed",
 "wrote": ["obs/nucleus_call_multiome", "obs/nucleus_fdr_multiome", "obs/nucleus_fdr_rna", "obs/nucleus_fdr_atac", "uns/nucleus_ambient_profile_rna", "uns/nucleus_ambient_profile_atac", "uns/nucleus_call_params_multiome"],
 "summary": {"method": "emptydrops_multiome", "fdr_threshold": 0.001, "n_barcodes": "<int>", "n_called": "<int>", "niter_rna": 30000, "niter_atac": 30000, "seed": 0},
 "provenance_id": "<id>", "job_id": null}
```

Long-running: runs above the inline limit return `status` queued with a `job_id`. Stochastic: a fixed seed gives repeatable Monte Carlo draws. Dry run: returns estimated seconds, peak memory and device without writing.

## 8. Benchmarks

Shared protocol: every method runs on the same raw, unfiltered barcode matrices with the same barcode set and seeds. Calls are made at FDR ≤ 0.001 unless a threshold sweep is stated, and Monte Carlo draws are 30000 per modality unless stated. Comparator versions are recorded with each result. Metrics use called barcodes only, and NA barcodes are excluded from every denominator. Summaries are reported per sample.

### B1. Planted-nucleus recovery (published design)

- **Goal**: recall of planted nuclei at controlled observed FDR.
- **Ground truth**: planted simulation; identities 1 and 2 are resampled above a k-means split of totals; identity 0 lies below it.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 10x 10k PBMC multiome, granulocytes removed | https://www.10xgenomics.com/datasets/pbmc-from-a-healthy-donor-granulocytes-removed-through-cell-sorting-10-k-1-standard-2-0-0 | Multiome, human; — | — | Simulation input |
| Fetal gonad multiome, three samples | https://www.nature.com/articles/s41586-022-04918-4 | Multiome, human; — | — | Simulation and real input |

- **Generator recipe**: (1) k-means split of totals; (2) resample 500 and 500 above the split; (3) downsample RNA at 0.04 and ATAC at 0.02; (4) shuffle 10 percent of RNA gene rows.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Planted recall $R_k(q)$, k = 1, 2 | Called identity-$k$ over identity-$k$, at the $q$ where observed FDR equals target | maximise | primary | [R1] |
| Observed FDR | Called identity-0 over called, NA excluded | minimise | guardrail | [R1] |

- **Comparators**: EmptyDropsMultiome; EmptyDrops on RNA alone; ATAC library-size threshold; Cell Ranger ARC where outputs exist.
- **Protocol**: five seeds; planted sets shared by all methods.
- **Acceptance criterion** (singlet proposal): at $q=0.001$ observed FDR ≤ 0.005; at observed FDR 0.05, planted recall for both groups ≥ the best single-modality comparator; seed spread ≤ 0.02.
- **Known pitfalls**: the k-means split defines both the empties and the ambient profile.

### B2. Retention and per-type retrieval on real libraries (consistency)

- **Goal**: compare retained nuclei and per-type retention on real libraries.
- **Ground truth**: consistency proxy with no per-barcode truth. The reference set $S_{\mathrm{ref}}$ is the EmptyDropsMultiome call set at FDR ≤ 0.001; cell types $C_k$ come from RNA annotation of the union of calls. Normalisations are as in section 3.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| 10x 10k PBMC multiome | repo README | Multiome, human; — | — | Raw matrix, unfiltered |
| Fetal gonad multiome, three samples | https://www.nature.com/articles/s41586-022-04918-4 | Multiome, human; — | — | Per-sample settings differ |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Retention | $\lvert S\cap S_{\mathrm{ref}}\rvert/\lvert S_{\mathrm{ref}}\rvert$ | maximise | primary | [R1] |
| Minimum per-type retrieval | $\min_k r_k$ over annotated types | maximise | primary | [R1] |

- **Comparators**: EmptyDrops on RNA alone; emptyDropsCellRanger; Cell Ranger ARC where its outputs are supplied.
- **Protocol**: identical raw matrix for all methods; reported per sample.
- **Acceptance criterion** (singlet proposal): the reimplementation retains at least 0.95 of the published tool's calls on the PBMC input at FDR ≤ 0.001, and its per-type retrieval is at least 0.80 of the published tool's for every annotated type.
- **Known pitfalls**: labels come from clustering the barcodes being called, which is circular; retention is not precision, since retained barcodes may be ambient-dominated.

### B3. Null calibration on all-ambient barcodes (proposed)

- **Goal**: check that the call rate is controlled when every barcode is ambient only.
- **Ground truth**: planted simulation; every synthetic barcode is identity 0. Normalised quantities: fraction of all barcodes called, and p-value uniformity.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| All-ambient synthetic barcodes, one set per real input | recipe below | RNA and ATAC; barcodes at or below the lower total | — | Tests the null only |

- **Generator recipe**: (1) estimate $\boldsymbol\pi^R$ and $\boldsymbol\pi^A$ from barcodes at or below the lower total; (2) draw totals from their empirical distribution; (3) draw counts from the multinomial and from a finite-$\alpha$ Dirichlet-multinomial, independently per modality.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Called fraction at $q$ = 0.001 and 0.01 | Barcodes with FDR ≤ $q$ over all barcodes | minimise | primary | [R2] |
| P-value uniformity | Kolmogorov–Smirnov distance to Uniform(0,1) | minimise | guardrail | [R2] |

- **Comparators**: EmptyDrops on RNA with α = ∞ and with α estimated; emptydrops_multiome.
- **Protocol**: repeat across inputs and seeds.
- **Acceptance criterion** (singlet proposal): called fraction ≤ 0.002 at $q$ = 0.001 and ≤ 0.02 at $q$ = 0.01; KS distance ≤ 0.05.
- **Known pitfalls**: simulation from the pooled profile tests only the null; independent modality draws cannot detect RNA–ATAC dependence.

### P1. Performance and scaling

Wall time and peak memory for joint calling on barcode grids of 1e4, 1e5 and 1e6 barcodes (a benchmark grid, not dataset sizes), with one thread and maximum threads, on CPU and CUDA. Comparators: the published R implementation if it can be run, DropletUtils emptyDrops on RNA alone, and singlet CPU and CUDA. Hold fixed: 30000 draws (10000 reported separately), lower values, seed, sparse CSC format and hardware; repeat three times and report the median. Cell Ranger ARC is excluded because it is a pipeline. Expectation, to test: Monte Carlo sampling dominates cost, which is why the nonzero-only likelihood matters.

## 9. Chaining

Multiome preprocessing: intron-inclusive counts and barcode correction come first; called nuclei feed nucleus QC, joint embedding and eGRN inference.

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.intron_inclusive_gene_counting`: Intron-inclusive (gene versus gene-full) counting and pre-mRNA references for nuclei
  - `ingest-quant.barcode_whitelist_correction`: Cell barcode correction (whitelist-based or inferred barcode set)
- **Feeds**:
  - `cell-calling.residual_empty_droplet_removal`: Residual empty-droplet detection among called cells
  - `qc.single_nucleus_quality_filtering`: Nucleus-aware quality filtering for single-nucleus RNA-seq
  - `multimodal.paired_joint_embedding`: Paired joint embedding of RNA with a second or third modality
  - `grn.multiome_egrn_inference`: Enhancer-driven eGRN inference from paired scRNA and scATAC (multiome)
- **Reads**: `layers/counts`, `layers/atac_peaks`
- **Writes**: `obs/nucleus_call_multiome`, `obs/nucleus_fdr_multiome`, `obs/nucleus_fdr_rna`, `obs/nucleus_fdr_atac`, `uns/nucleus_ambient_profile_rna`, `uns/nucleus_ambient_profile_atac`, `uns/nucleus_call_params_multiome`
<!-- CHAINING:AUTO:END -->

## 10. Risks, pitfalls and open questions

- Sources not read: the R package source is absent from the repository, so its joint FDR rule, its ATAC null and the meaning of barhop_rna and barhop_atac were not read. The vendor pipeline's algorithm is not in the sources read either. Its retention figures (missing more than half of the nuclei; some types below 20 percent) come from summaries of [R1], and no target is set from them.
- Data and provenance: the rule behind automatic lower values is open; planted-set construction differs between the simulation scripts; barcode counts, cell counts and licences for the PBMC and gonad inputs are absent from the sources. The Megas et al. DOI comes from the publisher page and is absent from the local bibliography. DropletUtils line numbers come from a copy whose commit was not matched to upstream.
- Modelling and QC gaps: calibration of the joint FDR under RNA and ATAC dependence is untested; the ATAC null uses peaks, so fragment information outside peaks is unused; no quality cut is fixed for mitochondrial or ambient-dominated calls; residual empties are left to the residual-removal task; the hashing-labelled benchmark has no identified dataset and is not published here.
- First experiment: run B3 on the null, then B2 parity against the published tool on the PBMC input. No parity claim is made until both pass.

## 11. References

R1. Megas S, Lorenzi V, Marioni JC. EmptyDropsMultiome discriminates real cells from background in single-cell multiomics assays. *Genome Biology* 2024. doi:10.1186/s13059-024-03259-x — partial (search)
R2. Lun ATL, Riesenfeld S, Andrews T, Dao TP, Gomes T, Marioni JC. EmptyDrops: distinguishing cells from empty droplets in droplet-based single-cell RNA sequencing data. *Genome Biology* 2019. doi:10.1186/s13059-019-1662-y — verified (corpus)
R3. Zheng GXY, Terry JM, Belgrader P, et al. Massively parallel digital transcriptional profiling of single cells. *Nature Communications* 2017. doi:10.1038/ncomms14049 — verified (corpus)
R4. Ashuach T, Gabitto MI, Koodli RV, Saldi GA, Jordan MI, Yosef N. MultiVI: deep generative model for the integration of multimodal data. *Nature Methods* 2023. doi:10.1038/s41592-023-01909-9 — verified (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/MarioniLab/EmptyDropsMultiome2023_final | Manuscript authors as in [R1]; no package author metadata in the repository | No licence file in the repository | Analysis and simulation scripts for the published method; package source not included | reimplement |
| https://github.com/MarioniLab/DropletUtils | Aaron Lun (aut); Jonathan Griffiths (ctb, cre); Davis McCarthy (ctb); Dongze He (ctb); Rob Patro (ctb) | GPL-3 (DESCRIPTION); no LICENSE file | Equations for emptydrops_rna; emptyDropsCellRanger comparator | reimplement (equations only); callout for emptyDropsCellRanger |
| https://github.com/10XGenomics/cellranger | 10x Genomics | 10x Genomics licence: use only with 10x products or data generated with them | Vendor cell-calling comparator, outputs only | callout |
