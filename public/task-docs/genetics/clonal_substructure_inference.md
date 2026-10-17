---
id: genetics.clonal_substructure_inference
title: Clonal and subclonal grouping from genotype-derived cell features
area: genetics
scope: extended
paradigm: hybrid
literature_status: contested
priority: P2
depends_on: [genetics.expression_cnv_inference, genetics.snv_genotyping_from_scrna, genetics.mito_variant_calling]
feeds: [lineage-tracing.clone_state_fate_bias_scoring, lineage-tracing.clone_informed_fate_probability]
reads: [layers/counts, obs/<reference_obs_key>, obsm/cnv_state, uns/genome_build, layers/alt_counts, layers/ref_counts, layers/mito_AD, layers/mito_DP]
writes: [obs/clone_label, obsm/clone_posterior, uns/clone_tree, models/clone_model]
devices: [cpu, cuda]
mcp_tool: singlet_genetics_clonal_substructure_inference
evidence_basis: corpus+repo+search+memory
last_reviewed: 2026-10-17
---

# Clonal and subclonal grouping from genotype-derived cell features

> Groups tumour cells into clones, and arranges the clones into a tree where the method provides one, from copy-number states inferred from expression, phased allele counts or heteroplasmic mtDNA variants.

## 1. Question

Given per-cell copy-number states, allele counts or mtDNA alternate and total counts from upstream variant tasks, which cells share a clone, and how are the clones nested? The output is a clone label and posterior per cell, plus a rooted clone tree where the method gives one. A correct answer groups tumour cells into the clones an independent DNA or lineage-barcode assay identifies, with each descendant carrying its ancestor's copy-number events.

## 2. Why this task matters and where the field stands

Clone labels tie cell state to clonal history, but most tumour scRNA-seq data carry no DNA measurement of the same cells. CopyKAT builds a clone signal from expression: it smooths expression along the genome against a diploid reference and clusters the resulting copy-number profiles [R1]. Haplotype-aware models such as Numbat add allelic evidence [R2], because copy-neutral changes are invisible to expression totals. Heteroplasmic mtDNA variants give a DNA-free route, since they segregate with lineage [R3]. The task is **contested**. Expression-based profiles are confounded by cell programmes that mimic dosage, such as immune or stromal states, and by the choice of normal reference. No public benchmark with cell-level clone truth from paired DNA and RNA is documented, so relative accuracy is open. Expression gives no direct evidence on the order of events, so the hierarchy is the weakest output. No joint copy-number and mtDNA clone model is documented.

## 3. Theory and insight

Each tumour cell $i$ has a latent clone $z_i \in \{1,\dots,K\}$. Clone $k$ has a copy-number state $c_k(g)$ for each segment $g$, and clones are nested: a descendant carries all events of its ancestor plus its own. To first order, expected expression is linear in dosage:

$$\mu_{gi} = s_i\, b_g\, \frac{c_{g,z_i}}{2},$$

with size factor $s_i$, baseline $b_g$ and total copy number $c_{g,z_i}$ of the segment containing gene $g$. This holds without dosage compensation, with many expressed genes per segment and a diploid reference. Numbat models segment states with an overdispersed count emission, $x_{gi}\sim\mathrm{NB}(\mu=p_m p_{n,gi},\,\phi)$ for state $m$, and an allelic emission at phased heterozygous SNPs whose overdispersion is $\gamma$; the beta-binomial form is inferred from that emission's signature (section 10). MQuad fits, per variant $v$, a mixture over cells [R4]:

$$P(\mathrm{AD}_{iv}\mid\mathrm{DP}_{iv})=\sum_{k=1}^{K}w_k\,\mathrm{Bin}(\mathrm{AD}_{iv};\,\mathrm{DP}_{iv},\,p_{kv}),$$

with a beta-binomial variant for overdispersion. It keeps a variant when two components beat one by BIC, $\Delta\mathrm{BIC}_v=\mathrm{BIC}_1-\mathrm{BIC}_2$ with $\mathrm{BIC}=k\ln n-2\ln\hat L$. SCEVAN fits a Gaussian mixture of truncated normals to segment expression by EM [R5].

CopyKAT pools signal across genes within a segment and groups profiles hierarchically; its cut parameters change the number of groups, and no likelihood chooses between settings. A model-based formulation gives per-cell posteriors, a likelihood for the number of clones and the tree, and a place for a learned normal baseline, at the cost of identifiability and runtime. Failure modes by family: heuristic clustering moves its subclone count with the cut; expression models carry normal-cell misclassification and programme effects into copy-number states; allele models need phasing; mtDNA models are biased toward zero heteroplasmy at low depth, and NUMTs, germline variants or a shared maternal haplogroup create clonal-looking structure.

Estimands, one sentence each:

- Clone posterior $\hat\pi_{ik}$: the probability that cell $i$ belongs to clone $k$ given its features, with $\sum_k \hat\pi_{ik}=1$ over clones and unassigned cells outside the sum.
- Clone fraction: tumour cells in clone $k$ divided by all tumour cells, a cell fraction and not a cancer cell fraction.
- Segment state: total copy number of a segment relative to a diploid baseline of 2, per segment and not per cell.
- Heteroplasmy $h_{iv}=\mathrm{AD}_{iv}/\mathrm{DP}_{iv}$: the fraction of reads at variant $v$ in cell $i$ carrying the alternate allele, a read-level quantity biased toward zero at low depth.
- False-clone rate: the fraction of normal cells assigned to any tumour clone.
- ARI: chance-adjusted pair agreement between two partitions of the same cells, with $n_{ij}$ the contingency table, $a_i$ and $b_j$ its marginals and $n$ the number of cells [R6]: $\mathrm{ARI}=\dfrac{\sum_{ij}\binom{n_{ij}}{2}-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}}{\frac{1}{2}\left[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}\right]-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}}$.
- Ancestor-descendant pair: an ordered pair of clones $(a,b)$ is positive when $a$ is an ancestor of $b$ in the tree.
- Robinson-Foulds distance: splits present in one tree and absent from the other, over common leaves [R8].

Regime of validity: the dosage model is first order and requires expression linear in copy number. The negative-binomial, binomial and BIC forms are asymptotic in counts and cells, and an mtDNA cell-variant enters the mixture only at the default minimum depth of 10 (section 4). Clone trees are identifiable only when clones contain enough cells, so tree metrics are stratified by clone size.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| CopyKAT | hybrid | Smooths expression along genome order against a diploid reference, segments copy number by MCMC, then clusters segment profiles with Ward.D2 | [R1] |
| Numbat | model-based | Haplotype-aware HMM per cell over segments, combining negative-binomial expression and allelic emissions; clone profiles are clustered and a tree is built by UPGMA or NJ | [R2], [R7] |
| SCEVAN | model-based | Classifies malignant cells, then segments expression with a Gaussian-mixture EM of truncated normals and a variational subclone step | [R5] |
| MQuad | model-based | Per-variant binomial and beta-binomial mixtures on cell alternate and total mtDNA counts, keeping variants by Delta-BIC | [R4] |

CopyKAT is the heuristic reference for expression-only clone calls and remains a comparator in B1 and P1. Numbat is the haplotype-aware model where phased alleles exist, SCEVAN the expression-only model, and MQuad the mtDNA model. Vireo, which fits donor mixtures from nuclear SNPs, is not used for clone calling here.

Defaults for the methods singlet will implement or call, with the source line at the stated commit:

| Method | Parameters | Values | Source |
|---|---|---|---|
| CopyKAT | ngene.chr, win.size, KS.cut | 5, 25, 0.1 | R/copykat.R:31 @ 01924c0 |
| CopyKAT | LOW.DR, UP.DR, min.gene.per.cell, genome | 0.05, 0.1, 200, hg20 | R/copykat.R:31 @ 01924c0 |
| Numbat | t, gamma, min_LLR, max_iter | 1e-5, 20, 5, 2 | R/main.R:70 @ b444f3c |
| Numbat | min_genes | 10 | R/main.R:74 @ b444f3c |
| SCEVAN | beta_vega, ngenes_chr, perc_genes | 0.5, 5, 10 | R/pipelineCNA.R:37 @ 5a49b88 |
| SCEVAN | SUBCLONES, FIXED_NORMAL_CELLS | TRUE, FALSE | R/pipelineCNA.R:37 @ 5a49b88 |
| MQuad | minDP, minAD, min_cells | 10, 1, 2 | mquad/mquad.py:164, 220 @ c2d750c; mquad/mquad_CLI.py:46, 48 |
| MQuad | max_iters, binomial / beta-binomial | 500 / 3000 | mquad/mquad.py:97-98 / 70-71 @ c2d750c |

## 5. Proposed singlet approach

Routes: **port** Numbat and MQuad, both permissively licensed; **reimplement** SCEVAN from its published method; **callout** CopyKAT as the benchmark comparator only (section 12). The default method is `scevan`, because it needs only counts and classifies normal cells itself.

The model-based formulation singlet proposes is a clone posterior over the features of section 3, with a tree prior that encodes nesting. The expression baseline $b_g$ and normal state come from a learned reference: a variational negative-binomial model in PyTorch, trained on non-malignant catalogue cells selected by author annotation, in place of a hand-picked diploid set. It is falsified, with thresholds fixed before evaluation, if it misses the B1 acceptance criterion or if its false-clone rate on catalogue normal tissue is not below the CopyKAT comparator's at matched settings.

PyTorch carries the variational reference model and any encoder. Hard-coded CUDA carries the per-cell HMM forward-backward and the mixture EM over cell-by-variant matrices, which are dense and have few states. Tree construction on clone-level matrices stays on CPU. Streaming is not claimed. Agents should use `method` scevan without an allele table, numbat when `numbat.allele_table` is set, and mquad for mtDNA layers, with `seed` 0 and `device` auto.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/counts | sparse int | UMI counts for the expression emission |
| read | uns/genome_build | string | gene coordinate build; must match the caller's reference |
| read | obs/<reference_obs_key> | bool | normal reference cells, required for numbat |
| read | obsm/cnv_state | int, cell by segment | copy-number states from the expression CNV task, if supplied |
| read | layers/alt_counts, layers/ref_counts | sparse int | germline allele counts, phased for numbat |
| read | layers/mito_AD, layers/mito_DP | sparse int | mtDNA alternate and total reads per cell and variant |
| write | obs/clone_label | categorical | clone per cell; null for unassigned cells |
| write | obsm/clone_posterior | float32, cell by clone | posterior over clones, where the method gives one |
| write | uns/clone_tree | object | Newick string and clone-level profiles, where a tree is built |
| write | models/clone_model | serialised | learned variants only |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI, or a workspace handle, holding counts or mtDNA layers. |
| `method` | string | "scevan" | `scevan`, `numbat`, `mquad` | scevan for expression-only data; numbat with an allele table; mquad for mtDNA layers. |
| `reference_obs_key` | string/null | null | — | obs column marking normal reference cells; required for numbat, null lets scevan classify normal cells. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; cuda applies only to the planned HMM and mixture kernels. |
| `seed` | integer | 0 | min 0 | Seed for mixture initialisation; identical inputs and seed reproduce the labels. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without computing clones. |
| `overwrite` | boolean | false | — | Replace existing clone members instead of failing. |
| `numbat` | object | — | — | Options for method numbat. |
| `numbat.allele_table` | string | — | — | Dataset table with phased alt and ref allele counts; required for numbat. |
| `numbat.gamma` | number | 20 | > 0 | Overdispersion of the allelic emission. |
| `numbat.min_llr` | number | 5 | min 0 | Minimum log-likelihood ratio for calling a copy-number segment. |
| `scevan` | object | — | — | Options for method scevan. |
| `scevan.beta_vega` | number | 0.5 | > 0 | Segmentation beta; higher values give coarser segments. |
| `mquad` | object | — | — | Options for method mquad. |
| `mquad.min_dp` | integer | 10 | min 1 | Minimum depth for a cell-variant to enter variant selection. |
| `mquad.min_ad` | integer | 1 | min 0 | Minimum alternate reads for a cell-variant to count as alternate. |
| `mquad.min_cells` | integer | 2 | min 1 | Minimum cells carrying the minor component for a variant to be kept. |
<!-- PARAMS:AUTO:END -->

Rules spanning parameters: numbat options apply only when `method` is numbat and need `allele_table`; mquad options apply only to mquad and its fixed mtDNA members; scevan options apply only to scevan. `reference_obs_key` is ignored by mquad. `overwrite` replaces only the members listed above.

## 7. MCP tool

Tool name `singlet_genetics_clonal_substructure_inference` (definition in `tasks/mcp/singlet_genetics_clonal_substructure_inference.json`). Example call:

```json
{"dataset": "/data/tumour.singlet", "method": "numbat", "reference_obs_key": "cell_type", "numbat": {"allele_table": "phased_alleles"}}
```

Example result:

```json
{
  "dataset": "/data/tumour.singlet",
  "status": "completed",
  "wrote": ["obs/clone_label", "obsm/clone_posterior", "uns/clone_tree"],
  "summary": {"method": "numbat", "n_clones": "<int>", "unassigned_fraction": "<float>", "tree_method": "NJ or UPGMA"},
  "provenance_id": "<id>",
  "job_id": null,
  "estimate": null
}
```

Long-running: large inputs may return `queued` with a `job_id`. Stochastic: the seed fixes mixture initialisation, so identical inputs and seed reproduce the labels. Dry run: returns estimated seconds, peak memory and device without writing members.

## 8. Benchmarks

**Shared protocol.** Every tool is applied at default settings, with no parameter tuned on evaluation samples. Tumour cells are selected by a malignancy call fixed before clone calling and independent of it. Each evaluation reports ARI with the true clone count fixed and free, and the fraction of cells left unassigned, which counts as one class in ARI. Simulations are repeated over the seeds stated per benchmark, and mean and spread are reported.

### B1. Planted clone and tree recovery (proposed)

- **Goal**: recover planted clone labels and ancestor-descendant pairs from simulated tumour cells with known copy-number events.
- **Ground truth**: planted simulation. A simulated cell's label is the clone it was drawn from, and an ordered clone pair is positive when one clone is an ancestor of the other; both are exact by construction.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted copy-number simulation | generated; baseline from catalogue non-malignant cells | scRNA-seq, allele and mtDNA counts; human; per scenario | — | Recipe below |

- **Recipe (proposed)**: (1) sample a rooted tree over $K\in\{2,3,5\}$ clones with Dirichlet fractions; (2) place events from a few megabases to a whole arm, each child inheriting its parent's events; (3) draw $x_{gi}\sim\mathrm{NB}(\mu_{gi},\phi)$ from section 3 with $b_g$ from baseline cells; (4) draw germline SNP alternate counts with B-allele fraction set by genotype and state; (5) add clone-specific mtDNA heteroplasmy, ambient RNA and dropout. Scenarios vary event size, clone fraction from 5 to 50 percent and UMI depth, with at least 10 seeds.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | Against planted labels, with the true clone count fixed and free | maximise | primary | [R6] |
| Ancestor-descendant precision and recall | Over ordered planted clone pairs | maximise | primary | — |
| Robinson-Foulds distance | Split symmetric difference on common leaves, unresolved nodes collapsed | minimise | guardrail | [R8] |

- **Comparators**: CopyKAT, Numbat, SCEVAN, and smoothed-expression clustering with no copy-number model.
- **Protocol**: 10,000 cells per scenario (proposed); tree metrics stratified by clone size.
- **Acceptance criterion**: proposed, not from the literature. ARI at least 0.8 for clones of at least 10 percent of cells with events of at least 20 Mb, and ancestor-descendant precision at least 0.8 under the same conditions.
- **Known pitfalls**: negative-binomial draws favour NB-based callers, so a second, differently specified simulator is needed; trees are weakly identifiable with few cells per clone.

### B2. Planted mtDNA clone recovery (proposed)

- **Goal**: recover planted clone labels from mtDNA alternate and total counts, including variant selection.
- **Ground truth**: planted simulation. A cell's label is the clone it was drawn from, and each clone's heteroplasmy is exact by construction.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Planted mtDNA simulation | generated | mtDNA counts per cell and variant; human; per scenario | — | No expression |

- **Recipe (proposed)**: (1) sample $K\in\{2,3\}$ clones with Dirichlet fractions; (2) set planted heteroplasmy $h_{kv}$ on a clonal subset of $V$ variants and zero elsewhere; (3) draw depth $\mathrm{DP}_{iv}$ from a negative binomial set by the UMI-depth scenario; (4) draw $\mathrm{AD}_{iv}\sim\mathrm{Bin}\big(\mathrm{DP}_{iv},\,(1-e)h_{kv}+e(1-h_{kv})\big)$ with background error $e\in\{0.001,0.01\}$. At least 10 seeds.
- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| ARI | Against planted labels, over cells with a variant at DP of at least 10 | maximise | primary | [R6] |
| Cell retention | Fraction of planted cells with such a variant | report | guardrail | — |

- **Comparators**: MQuad variant selection then Ward.D2 clustering; a naive heteroplasmy matrix over all variants at DP of at least 10, with the same clustering.
- **Protocol**: UMI-depth scenarios; clone count fixed and free.
- **Acceptance criterion**: proposed, not from the literature. ARI at least 0.6 on retained cells for clones of at least 10 percent of cells, and above the naive comparator.
- **Known pitfalls**: at low depth most cells carry no informative call, so retention is reported beside ARI; background error decides whether naive thresholds fail, so it is varied.

### P1. Performance and scaling

Wall time, peak memory and throughput at 10k, 100k and 1M cells, on CPU and on CUDA where the HMM or mixture kernels apply, for scevan, numbat, mquad and the CopyKAT comparator. Hold fixed: gene count, genome build, seed, clone count and cores, and report hardware. Dense cell-by-segment and cell-by-variant matrices are the likely memory limit for numbat and mquad and are reported separately. No runtime is claimed before measurement.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `genetics.expression_cnv_inference`: Copy-number inference from scRNA-seq expression
  - `genetics.snv_genotyping_from_scrna`: Germline SNV discovery and genotype calling from scRNA-seq reads
  - `genetics.mito_variant_calling`: Mitochondrial variant calling and heteroplasmy estimation from scRNA-seq
- **Feeds**:
  - `lineage-tracing.clone_state_fate_bias_scoring`: Clone-state coupling and clonal fate-bias scoring
  - `lineage-tracing.clone_informed_fate_probability`: Clone-informed state-to-fate probability and transition-map inference
- **Reads**: `layers/counts`, `obs/<reference_obs_key>`, `obsm/cnv_state`, `uns/genome_build`, `layers/alt_counts`, `layers/ref_counts`, `layers/mito_AD`, `layers/mito_DP`
- **Writes**: `obs/clone_label`, `obsm/clone_posterior`, `uns/clone_tree`, `models/clone_model`
<!-- CHAINING:AUTO:END -->

This task sits in the tumour clonal-structure step, after variant calling and before clone-based lineage analysis.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** No dataset with DNA-derived clone labels on the same cells, no multi-donor mtDNA dataset and no lineage-barcode dataset is identified, so the DNA-paired, donor and barcode benchmarks are not specified here. Published accuracy results for these callers are not summarised. Chloris, CONGAS and XClone are documented only by package metadata and are left out. The catalogue dates Numbat to 2023 where its README gives 2022; this document uses 2022. The beta-binomial form of Numbat's allelic emission is inferred from its signature. MQuad and SCEVAN venues are inferred from DOI prefixes, and several author lists are abbreviated. Line references are to each repository's default-branch HEAD; four local copies carry no commit metadata.
- **Unsettled literature.** Hierarchy needs DNA or barcode truth to evaluate. No joint copy-number and mtDNA model is documented, so B2 tests the mtDNA branch alone, and the boundary with lineage-tracing.mtdna_clone_inference, which also infers clones from mtDNA variants, is not settled here.
- **Technical and licence risks.** The licence status of the default route is unresolved (section 12), so shipping `scevan` needs a decision first. CopyKAT's hg20 default must match the ingested build (section 4), or segments shift silently. Numbat needs phased alleles; mquad needs cellSNP or cellsnp-lite pileups.
- **First experiment.** Apply B1 and B2 at 10,000 cells with the comparators at default settings, before any real-data claim, to test whether the section 8 criteria are reachable.

## 11. References

R1. Gao R, Bai S, Henderson YC, et al. Delineating copy number and clonal substructure in human tumors from single-cell transcriptomes. *Nature Biotechnology* 2021. doi:10.1038/s41587-020-00795-2 — verified (corpus)
R2. Gao T, Soldatov R, Sarkar H, Kurkiewicz A, Biederstedt E, Loh P-R, Kharchenko P. Haplotype-aware analysis of somatic copy number variations from single-cell transcriptomes. *Nature Biotechnology* 2022. doi:10.1038/s41587-022-01468-y — partial (repo)
R3. Ludwig LS, Lareau CA, Ulirsch JC, et al. Lineage tracing in humans enabled by mitochondrial mutations and single-cell genomics. *Cell* 2019. doi:10.1016/j.cell.2019.01.022 — partial (search)
R4. Kwok A, et al. MQuad enables clonal substructure discovery using single cell mitochondrial variants. *Nature Communications* 2022. doi:10.1038/s41467-022-28845-0 — verified (corpus)
R5. De Falco A, Ceccarelli M. A variational algorithm to detect the clonal copy number substructure of tumors from scRNA-seq data. *Nature Communications* 2023. doi:10.1038/s41467-023-36790-9 — verified (corpus)
R6. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)
R7. Saitou N, Nei M. The neighbor-joining method: a new method for reconstructing phylogenetic trees. *Molecular Biology and Evolution* 1987. — verified (corpus)
R8. Robinson DF, Foulds LR. Comparison of phylogenetic trees. *Mathematical Biosciences* 1981. — unverified (memory)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/navinlabcode/copykat | Ruli Gao (author and maintainer) | GPL-2 (DESCRIPTION; no LICENSE file at the root) | heuristic comparator | callout |
| https://github.com/kharchenkolab/numbat | Teng Gao (maintainer); Ruslan Soldatov, Hirak Sarkar, Evan Biederstedt, Peter Kharchenko (authors) | MIT + file LICENSE (DESCRIPTION; LICENSE file) | haplotype-aware clone model | port |
| https://github.com/AntonioDeFalco/SCEVAN | A. De Falco (maintainer); M. Ceccarelli (author) | GPL-2 (DESCRIPTION); COPYING file holds the GPL-3 text | expression clone model, default | reimplement |
| https://github.com/single-cell-genetics/MQuad | Aaron Kwok (author) | Apache-2.0 (LICENSE file) | mtDNA variant selection | port |
