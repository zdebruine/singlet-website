---
id: demux.donor_deconvolution_reference_free
title: Reference-free donor deconvolution
area: demux
scope: core
paradigm: model-based
literature_status: contested
priority: P1
depends_on: [ingest-quant.umi_deduplication, cell-calling.cell_vs_empty_droplet_calling, cell-calling.nucleus_vs_empty_calling]
feeds: [demux.sample_swap_detection, demux.sex_inference, ambient.contamination_fraction]
reads: [layers/alt, layers/total, varm/variant_sites, obs/barcode, uns/alignment_path]
writes: [obs/donor_cluster, obs/donor_prob_max, obs/cross_donor_doublet_prob, obsm/donor_posterior, uns/donor_count, uns/ambient_fraction, models/donor_fit]
devices: [cpu, cuda]
mcp_tool: singlet_demux_donor_deconvolution_reference_free
evidence_basis: corpus+repo+search
last_reviewed: 2026-10-17
---

# Reference-free donor deconvolution

> Assigns each droplet of a pooled sample to an anonymous donor, estimates how many donors are present and flags cross-donor doublets, using allele counts at informative variants and no donor genotypes.

## 1. Question

Given alt and total read counts at informative variants for every droplet of a pool, which droplets come from the same donor, how many donors are in the pool, and which droplets hold two donors, when no donor genotypes are available? The inputs are per-droplet count matrices, or alignments for freemuxlet. The outputs are an anonymous donor partition, the donor count, per-droplet donor posteriors and a cross-donor doublet probability. A correct answer recovers the partition up to relabelling, with the true donor count. Linking clusters to people is the reference-based task, demux.donor_assignment_reference_genotypes.

## 2. Why this task matters and where the field stands

Pooling donors before droplet capture cuts reagent cost, spreads batch effects across donors and lets one lane mix sexes or conditions. The pool then has to be demultiplexed. Without hashtags or reference genotypes, the donor partition must come from the reads alone: a droplet from one donor carries that donor's allele pattern at informative variants, and a cross-donor doublet carries a mixture of two patterns. Label-free pooling that uses genetic variability has also been reported [R8].

The status is **contested**.

1. **Comparative performance is tested here, not taken from the literature.** [R6] benchmarks computational demultiplexing methods on single-nucleus RNA-seq data. Its results are not reproduced in this document (section 10), so every method is tested on each benchmark below.
2. **High donor counts.** The souporcell repository recommends its high-donor mode, souporcell3, above 16 donors ([R2]; section 12).
3. **Unresolvable donors.** Identical or closely related donors cannot be separated without reference genotypes. Homotypic doublets, where both cells come from one donor, look like singlets.
4. **Ambient RNA.** [R7] studies the impact of ambient contamination on demultiplexing methods in single-nucleus multiome data.
5. **Donor count.** Each of the three methods in the enum takes the donor count as input. scSplit, a comparator, autodetects a count up to a cap (section 4).

## 3. Theory and insight

| Symbol | Meaning |
|---|---|
| $n$, $v$, $d$ | droplet, informative variant, donor label $d=1,\dots,K$ |
| $A_{nv}$, $D_{nv}$ | alt and total reads of droplet $n$ at variant $v$ |
| $g_{vd}\in\{0,1,2\}$ | donor alt-allele dosage at $v$, unknown |
| $\theta_{vd}$ | donor alt-allele fraction; $\mu$ and $\kappa$ are the beta-binomial mean and concentration |
| $\alpha_n$, $\varphi_v$ | ambient fraction of droplet $n$; ambient alt fraction at variant $v$ |

**Binomial count model.** For a fixed alt fraction $\theta$, $P(A_{nv}\mid D_{nv},\theta)=\binom{D_{nv}}{A_{nv}}\theta^{A_{nv}}(1-\theta)^{D_{nv}-A_{nv}}$. It assumes reads are conditionally independent given donor and locus, and it understates variance when UMIs are overdispersed. That motivates the beta-binomial below.

**Cluster-centre mixture (souporcell, scSplit).** $P(\mathbf{A}_n\mid\mathbf{D}_n)=\sum_{k=1}^{K}\pi_k\prod_v\binom{D_{nv}}{A_{nv}}c_{vk}^{A_{nv}}(1-c_{vk})^{D_{nv}-A_{nv}}$, with free centres $c_{vk}$. Identifiability needs variants on which donors differ. The model is accurate when each droplet covers many informative loci.

**Overdispersed genotype-state model (Vireo).** Each donor-variant has a genotype state $g$ with mean $\mu_g$, and $\theta\sim\mathrm{Beta}(a,b)$ with $a=\mu_g\kappa$ and $b=(1-\mu_g)\kappa$. The marginal is $P(A\mid D,a,b)=\binom{D}{A}B(A+a,\,D-A+b)/B(a,b)$. Small $\kappa$ means strong overdispersion. Vireo fixes the concentration prior at 50 and spaces the state means from 0.01 to 0.99 (section 4).

**Vireo donor score.** Coordinate-ascent variational updates give

$$\ell_{nd}=\sum_v\sum_g q_{vdg}\Big[A_{nv}\psi(a_{vg})+(D_{nv}-A_{nv})\psi(b_{vg})-D_{nv}\psi(a_{vg}+b_{vg})\Big],\qquad p(d\mid n)\propto\pi_d\,e^{\ell_{nd}},$$

where $q_{vdg}$ is the posterior weight of state $g$ for donor $d$ at $v$, $a_{vg}$ and $b_{vg}$ are the Beta parameters and $\psi$ is the digamma function. The fixed point is accurate when the posterior over $\theta$ concentrates, which requires many reads per locus.

**Doublet pairs.** A cross-donor pair $(i,j)$ gets $\mu_{ij}=\tfrac12(\mu_i+\mu_j)$ and $\kappa_{ij}=\sqrt{\kappa_i\kappa_j}$. This is the mixed fraction of a doublet with read fraction $w$, $\theta_{vij}=w\,\theta_{vi}+(1-w)\,\theta_{vj}$, evaluated at $w=\tfrac12$. It is exact only at equal read contribution and is biased under ambient-driven or coverage-driven imbalance.

**Centre update (souporcell).** The M-step is $c_{kv}=\dfrac{1+\sum_n w_{nk}A_{nv}}{2+\sum_n w_{nk}D_{nv}}$, clamped to $[0.01,0.99]$, with responsibilities $w_{nk}$. Without the clamp it is the posterior mean under a uniform Beta(1,1) prior, so the pseudocounts pull low-coverage centres toward 0.5. The clamp is an added heuristic.

**Sample-level model (scSplit).** $\log P(c\mid s)=\sum_v\big[A_{nv}\log p_{vs}+(D_{nv}-A_{nv})\log(1-p_{vs})\big]$ and $P(s\mid c)=\pi_sP(c\mid s)\big/\sum_{s'}\pi_{s'}P(c\mid s')$. The sample probabilities $p_{vs}$ come from EM with random starts, so local optima are possible.

**Latent genotype hypotheses (freemuxlet).** The singlet and doublet priors are $\log\pi_{\rm single}=\log\frac{1-p_d}{K}$ and $\log\pi_{\rm double}=\log\frac{2p_d}{K(K-1)}$, with $p_d=0.5$ by default. A droplet is called a doublet when its best doublet log-likelihood exceeds its best singlet by 2 units. That margin is fixed in the code, so it is not a posterior threshold.

**Ambient term (proposed).** $A_{nv}\sim\mathrm{Binomial}\big(D_{nv},\,(1-\alpha_n)\,\theta_{v,d_n}+\alpha_n\varphi_v\big)$ places the ambient fraction in the same likelihood as the donor. souporcell's consensus step estimates a pool-level version of $\alpha$ (p_soup) with a Beta(2,8) prior, and Vireo's optional ambient EM works per droplet.

**Adjusted Rand index.** $\mathrm{ARI}=\dfrac{\sum_{ij}\binom{n_{ij}}{2}-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}}{\tfrac12\big[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}\big]-\frac{\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}}{\binom{n}{2}}}$, with contingency counts $n_{ij}$ and marginals $a_i$, $b_j$ [R9]. It is invariant to relabelling and has expectation zero under random labels. It compares partitions of the same droplets, so unassigned droplets are excluded.

**Estimands.** Each output and truth quantity is defined once here.

- Donor label $\hat d_n$: an anonymous index, scored only up to relabelling.
- donor_prob_max: $\max_d p(d\mid n)$ for droplets called singlet. It is a model posterior, calibrated only where the model holds.
- cross_donor_doublet_prob: $P(\text{two distinct donors}\mid\text{counts})$. Homotypic pairs are not represented.
- ambient_fraction: the pool-level share of informative-locus reads from the ambient profile, as souporcell estimates it. Vireo writes none.
- Truth: the planted donor set of each droplet. The doublet flag is 1 when the set holds two distinct donors. Planted $\alpha$ is the share of informative-locus reads drawn from ambient, averaged over droplets for the pool value.

**Identifiability and regime.** Labels are identifiable only up to permutation, and only where donors differ at the panel. The binomial, digamma and pair-approximation claims hold at large coverage per locus and per droplet. When droplets cover few informative loci, posteriors flatten and many droplets fall to unassigned.

**What the model-based form adds.** An explicit likelihood gives posteriors that can be scored (donor_prob_max, cross_donor_doublet_prob), an ELBO per fit that can rank values of K under one model (a proposed rule, section 5), and a place for ambient inside the likelihood. Heuristics such as pseudocount shrinkage, temperature annealing and fixed thresholds work in practice but supply no calibration target. Planted benchmarks favour detectors whose assumptions the simulator shares (section 8).

**Complexity.** Derived from loop structure, not measured: souporcell EM costs $O(NVK)$ per iteration, multiplied by the restart count and the temperature steps (section 4). Vireo VB costs $O(NVKG)$ per iteration with $G=3$ states. Sparse storage replaces $NV$ with the number of non-zero entries.

## 4. Methods landscape

| Method | Paradigm | Core idea | Reference |
|---|---|---|---|
| Vireo (genotype-free mode) | model-based | Variational Bayes over a beta-binomial donor mixture with three genotype states per donor-variant, a cross-donor pair component and optional per-droplet ambient detection. | [R3] |
| souporcell | hybrid | Binomial mixture of cluster allele-fraction profiles fitted by EM or k-harmonic means, with many restarts and temperature steps. Troublet calls cross-cluster doublets, and a consensus step estimates genotypes and ambient fraction. | [R1], [R2] |
| scSplit | model-based | EM over sample-level alt probabilities at SNVs from a mixed-sample VCF, with Bayes-rule cell assignment and autodetection up to a cap. | [R4] |
| freemuxlet (popscle) | model-based | Latent genotype-free singlet and doublet hypotheses per droplet, over dsc-pileup allele counts, with a doublet prior and a fixed decision margin. | section 12 |

[R1], [R3], [R4] and [R5] define the methods. [R5] is the reference-genotype method demuxlet; freemuxlet is the genotype-free tool in the same package (popscle README, section 12). Four methods are listed, each with its code at the commits in section 12. scSplit is a comparator, not a default, because its count step needs a mixed-sample VCF and more than 30 GB RAM at 60,000 SNVs and 10,000 cells (P1). The defaults below are taken from that code.

| Method | Parameter | Value | Source (file:line @ commit) |
|---|---|---|---|
| Vireo | `--nInit` (genotype learning) | 50 | `vireoSNP/vireo.py:59` @e365463 |
| Vireo | `vireo_wrap` n_init, max_iter_init, delay_fit_theta | 20, 20, 3 | `vireoSNP/utils/vireo_wrap.py:22-23` @e365463 |
| Vireo | extra donors in initial search | round(sqrt(K)) | `vireoSNP/vireo.py:199-200` @e365463 |
| Vireo | doublet model; `--noDoublet` disables | on | `vireoSNP/vireo.py:57-58` @e365463 |
| Vireo | ambient detection; ASE mode | off; off | `vireoSNP/vireo.py:79`; `vireoSNP/vireo.py:71` @e365463 |
| Vireo | genotype states; beta-sum initial value and prior | 3; 50 | `vireoSNP/utils/vireo_model.py:27`, `:93`, `:118` @e365463 |
| Vireo | prior on beta mean | linspace(0.01, 0.99, G) | `vireoSNP/utils/vireo_model.py:116` @e365463 |
| Vireo | VB fit: max_iter, min_iter, epsilon_conv | 200, 5, 1e-2 | `vireoSNP/utils/vireo_model.py:278` @e365463 |
| Vireo | doublet rate prior when not given | min(0.5, droplets / 1e5) | `vireoSNP/utils/vireo_doublet.py:44-45` @e365463 |
| Vireo | unassigned below prob_max; doublet at or above; unassigned below 10 variants | 0.9; 0.9; 10 | `vireoSNP/utils/io_utils.py:106-108` @e365463 |
| souporcell | ploidy; clustering method; souporcell3 flag | 2; em; false | `souporcell_pipeline.py:13-15`; `souporcell/src/main.rs:818` @97fbf4d |
| souporcell | min_alt, min_ref, max_loci | 10, 10, 2048 | `souporcell_pipeline.py:17-19` @97fbf4d |
| souporcell | restarts | 100 | `souporcell_pipeline.py:20`; `souporcell/src/main.rs:768` @97fbf4d |
| souporcell | EM temperature steps | 9 | `souporcell/src/main.rs:215` @97fbf4d |
| souporcell | EM centre pseudocounts (sums, denoms) | 1, 2 | `souporcell/src/main.rs:197-198` @97fbf4d |
| souporcell | centre clamp | [0.01, 0.99] | `souporcell/src/main.rs:392-393` @97fbf4d |
| souporcell | troublet prior; doublet threshold; singlet threshold | 0.5; 0.9; 0.9 | `troublet/src/main.rs:490-491`, `:501-504` @97fbf4d |
| scSplit | max subpopulations; EM repeats; doublet proportion | 10; 30; unset | `scSplit:521-523` @5e4045c |
| scSplit | alt-probability initialisation pseudocounts | 0.01, 0.02 | `scSplit:128` @5e4045c |
| scSplit | EM iteration cap | 300 | `scSplit:156` @5e4045c |
| scSplit | cell assignment threshold in code; in docstring | 0.99; 0.9 | `scSplit:207`; `scSplit:203` @5e4045c |
| scSplit | genotype-step threshold; genotype error rate | 0.9; 0.01 | `scSplit:632`, `:635` @5e4045c |
| freemuxlet | doublet prior | 0.5 | `cmd_cram_freemuxlet.cpp:19`, `:47` @da70fc7 |
| freemuxlet | nsample | required | `cmd_cram_freemuxlet.cpp:42`, `:70` @da70fc7 |
| freemuxlet | doublet decision margin | 2 log-likelihood units | `cmd_cram_freemuxlet.cpp:585`, `:592`, `:610` @da70fc7 |
| freemuxlet | singlet and doublet log priors | log((1-p)/K); log(2p/(K(K-1))) | `cmd_cram_freemuxlet.cpp:462-463` @da70fc7 |
| freemuxlet | alpha grid | commented out in code; README default 0.5 | `cmd_cram_freemuxlet.cpp:41`; `README.md:44` @da70fc7 |
| freemuxlet | minimum base quality; minimum mapping quality (pileup) | 13; 20 | `README.md:120-121` @da70fc7 |

## 5. Proposed singlet approach

**Methods and roles.** The enum holds `vireo` (default), `souporcell` and `freemuxlet`. Each is ported from its source, with the route and licence in section 12. scSplit is kept as a comparator only, because its count step needs a mixed-sample VCF that singlet count matrices do not provide.

**Default: `vireo`.** It has a variational objective (the ELBO) whose value can be compared across fits, posterior outputs for donors and doublets, and a direct path to an ambient term. The port reproduces the update equations of section 3 and the defaults in section 6.

**Proposed extension.** Add the ambient term to the Vireo likelihood, estimate $\alpha_n$ jointly with the donor posterior, and select K from fitted ELBOs over $K-2$ to $K+2$. The extension joins the method enum only after B2 accepts it. It is falsified if, on B2, its accuracy drop from $\alpha=0$ to $\alpha=0.20$ exceeds Vireo's by more than 0.02, or if, on B1, its accuracy falls more than 0.01 below Vireo's on either stratum. The K rule is tested separately (section 10).

**Port checks.** The Vireo port must reproduce vireoSNP's donor posteriors on the B1 pools at seed 0 to within $10^{-6}$. The souporcell port must reproduce the centre update and troublet thresholds of section 4.

**ML stack and kernels.** The core is hard-coded CUDA with cuSPARSE. Each VB iteration reduces to sparse-by-dense products between the alt and total matrices and the per-genotype-state posterior matrices, three products per state in the model code of vireoSNP. souporcell's EM needs the same products. PyTorch is not needed for the core. It would enter only for learned priors or an amortised donor encoder, which this version does not include.

**Devices and streaming.** Storage is sparse CSR and cost scales with non-zero entries; CPU and CUDA share one kernel set. Streaming across droplets is not possible within one pool, because each VB step sums over all droplets to update the genotype states. Only the upstream counting step streams.

**Defaults an agent uses without asking.** `method` as `vireo`, `device` as `auto`, `seed` as 0, and the other defaults in section 6. The agent must supply `k`. If `k` is unknown, it asks the user or applies the ELBO rule once that rule is validated. It does not guess.

## 6. Inputs, outputs and parameters

| Direction | `.singlet` member | Type | Description |
|---|---|---|---|
| read | layers/alt | sparse integer, droplets × variants | Alt-allele UMI counts per droplet and variant, from cellSNP [R10], vartrix or BCFtools counting. |
| read | layers/total | sparse integer, droplets × variants | Reference-plus-alt counts at the same positions. |
| read | varm/variant_sites | table | Chromosome, position, reference and alternative allele per variant. |
| read | obs/barcode | string | Droplet barcodes matching the count matrix rows. |
| read | uns/alignment_path | string | Barcode-tagged alignment file; read only by freemuxlet, which builds dsc-pileup output first. |
| write | obs/donor_cluster | categorical | Anonymous donor label, or `unassigned` or `doublet`. |
| write | obs/donor_prob_max | float32 | Posterior of the assigned donor for singlets (section 3). |
| write | obs/cross_donor_doublet_prob | float32 | Posterior of a cross-donor pair, where the method provides it. |
| write | obsm/donor_posterior | float32, droplets × K | Donor posterior per droplet. |
| write | uns/donor_count | integer and criterion | The supplied K and the criterion recorded with it. |
| write | uns/ambient_fraction | float | Pool-level ambient fraction; written by souporcell only. |
| write | models/donor_fit | object | Fitted state and VB parameters, or EM centres, kept for reuse. |

<!-- PARAMS:AUTO:BEGIN -->
| Parameter | Type | Default | Range or values | Description |
|---|---|---|---|---|
| `dataset` | string | required | — | Dataset handle: a .singlet path or URI, or a workspace handle. |
| `method` | string | "vireo" | `vireo`, `souporcell`, `freemuxlet` | Donor deconvolution method. vireo is the default; the others are alternatives. |
| `k` | integer | required | min 1 | Number of donors in the pool. Required: all three methods take it as input. |
| `device` | string | "auto" | `auto`, `cpu`, `cuda` | Execution device; auto picks CUDA when a device with enough memory is available. |
| `seed` | integer | 0 | — | Random seed for restarts and initialisations; reproduces labels on one device. |
| `dry_run` | boolean | false | — | Return estimated time, memory and device without running. |
| `overwrite` | boolean | false | — | Replace existing output members instead of failing. |
| `vireo` | object | — | — | Options used only when method is vireo. |
| `vireo.n_init` | integer | 50 | min 1 | Random initialisations when learning donor genotype states. |
| `vireo.n_extra_donor` | integer/null | null | min 1 | Extra donors in the initial search; null uses round(sqrt(k)). |
| `vireo.check_doublet` | boolean | true | — | Score cross-donor doublets with the pair model. |
| `vireo.check_ambient` | boolean | false | — | Detect ambient RNA per droplet with the ambient-profile EM. |
| `vireo.doublet_rate_prior` | number/null | null | > 0; < 1 | Prior doublet rate; null uses min(0.5, droplets / 100000). |
| `vireo.doublet_threshold` | number | 0.9 | min 0; max 1 | Posterior at or above which a droplet is called doublet. |
| `vireo.unassigned_threshold` | number | 0.9 | min 0; max 1 | Droplets whose maximum donor posterior is below this are unassigned. |
| `vireo.min_variants` | integer | 10 | min 0 | Droplets covering fewer informative variants are unassigned. |
| `souporcell` | object | — | — | Options used only when method is souporcell. |
| `souporcell.restarts` | integer | 100 | min 1 | Random restarts of clustering; the repository advises more above 12 clusters. |
| `souporcell.clustering_method` | string | "em" | `em`, `khm` | EM or k-harmonic means clustering. |
| `souporcell.souporcell3` | boolean | false | — | High-donor iterated mode; the repository advises it above 16 donors. |
| `souporcell.ploidy` | integer | 2 | `1`, `2` | Donor ploidy, 1 or 2. |
| `souporcell.min_alt` | integer | 10 | min 1 | Minimum alt UMIs at a locus for it to be used. |
| `souporcell.min_ref` | integer | 10 | min 1 | Minimum reference UMIs at a locus for it to be used. |
| `souporcell.max_loci` | integer | 2048 | min 1 | Maximum informative loci per droplet; larger values cost more time. |
| `souporcell.doublet_threshold` | number | 0.9 | min 0; max 1 | Troublet posterior at or above which a cross-cluster doublet is called. |
| `freemuxlet` | object | — | — | Options used only when method is freemuxlet. |
| `freemuxlet.doublet_prior` | number | 0.5 | > 0; < 1 | Prior doublet fraction in the singlet and doublet hypotheses. |
| `freemuxlet.min_base_quality` | integer | 13 | min 0 | Minimum base quality in the pileup step (dsc-pileup). |
| `freemuxlet.min_mapping_quality` | integer | 20 | min 0 | Minimum mapping quality in the pileup step (dsc-pileup). |
<!-- PARAMS:AUTO:END -->

Method blocks apply only to their method. A block set for another method is reported as ignored, not as an error. `k` is required for all three methods: it is the donor count for Vireo (`--nDonor`), `-k` for souporcell and `nsample` for freemuxlet. Doublet thresholds apply to the posteriors written to `obs/`, so changing a threshold changes the calls and not the stored probabilities. `seed` controls restarts and initialisations, so the same seed on one device reproduces the labels. With `overwrite` false, an existing output member is an error.

## 7. MCP tool

Tool name `singlet_demux_donor_deconvolution_reference_free` (definition in `tasks/mcp/singlet_demux_donor_deconvolution_reference_free.json`). Example call:

```json
{"dataset": "data/pool1.singlet", "method": "vireo", "k": 4, "seed": 0,
 "vireo": {"n_init": 50}}
```

Example result:

```json
{"dataset": "data/pool1.singlet", "status": "completed",
 "wrote": ["obs/donor_cluster", "obs/donor_prob_max", "obs/cross_donor_doublet_prob",
           "obsm/donor_posterior", "uns/donor_count", "models/donor_fit"],
 "summary": {"method": "vireo", "k": 4, "singlet_fraction": "<f>", "unassigned_fraction": "<f>",
             "doublet_fraction": "<f>", "elbo": "<value>"},
 "provenance_id": "<provenance id>", "job_id": null}
```

Long-running: large pools return `queued` with a `job_id`. Stochastic: yes, through `seed`. Dry run: returns `seconds`, `peak_memory_gb` and `device`, estimated from non-zero entries and K, and calibrated on P1.

## 8. Benchmarks

**Shared protocol.** Every method receives identical count matrices and variant panel, the true K, and its section 4 defaults at seed 0. Tuned settings are reported separately. Clusters are matched to donors by one-to-one Hungarian matching on the singlet confusion matrix. Results are reported per variant caller and never pooled across callers. Accuracy uses all true singlets, so unassigned singlets count as errors. Per-donor recall and precision are macro-averaged over donors, with unassigned singlets as false negatives. ARI uses singlets with a donor label. Doublet metrics use cross-donor pairs only, and a method's own doublet call is scored when it provides one. Otherwise a probability of 0.9 or more is the call.

### B1. Planted donor pools

- **Goal**: Measure donor recovery and doublet detection as donor count, doublet fraction, doublet read balance and variant caller vary.
- **Ground truth**: Planted simulation. The generator fixes every droplet's donor set, so labels are exact. Accuracy and recall are fractions of true singlets; doublet recall is a fraction of true cross-donor pairs.
- **Generator** (proposed):
  1. Draw $K\in\{2,4,6\}$ donors from one array-genotyped cohort, keeping SNPs with population allele frequency at least 2%, as the souporcell README does.
  2. Draw droplet backgrounds from one snRNA-seq count matrix fixed before the benchmark, and assign each droplet one donor.
  3. Make a fraction $f\in\{0,0.10,0.20,0.30\}$ of droplets cross-donor pairs of distinct donors, with read split $1{:}1$ (stratum E) or $3{:}7$ (stratum U). Homotypic pairs are not generated.
  4. Simulate reads at each informative variant from a genotype-dependent alt fraction, with beta-binomial overdispersion whose concentration is drawn uniformly from 20 to 100 per donor-variant, and a sequencing error rate of 0.01.
  5. Call variants with BCFtools, cellSNP and FreeBayes on the same alignments, giving one alt and total matrix per caller.
  6. Make five pools per cell, with seeds 0 to 4.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated pools, $K\in\{2,4,6\}$, $f\in\{0,0.10,0.20,0.30\}$, strata E and U, three callers, five seeds | Generator above | single-nucleus RNA-seq; human; 2 to 6 donors per pool | — | No ambient contamination (see B2). Donor and background sources are fixed before the benchmark (section 10). |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Accuracy (singlets) | Fraction of true singlets whose matched label equals their donor; unassigned counts as wrong | maximise | primary | — |
| Macro recall and precision | Per-donor recall and precision over true singlets, macro-averaged; unassigned singlets are false negatives | maximise | guardrail | — |
| Adjusted Rand index | Section 3 equation over singlets with a donor label | maximise | guardrail | [R9] |
| Doublet recall and precision | Cross-donor pairs; the method's own call, or `cross_donor_doublet_prob` of 0.9 or more | maximise | guardrail | — |

- **Comparators**: Vireo (`vireo`, default), souporcell (default), freemuxlet with K, and scSplit at its section 4 defaults.
- **Protocol**: K given; five seeds; results per caller and per stratum; threads and hardware as in P1.
- **Acceptance criterion** (proposed): accuracy at least 0.80 at every K in {2, 4, 6} with f up to 0.10, for every caller, and within 0.02 of the best comparator on the same caller output.
- **Known pitfalls**: Real pools contain homotypic doublets that this generator omits, so accuracy here is an upper bound. Stratum E uses equal reads, which matches the pair approximation of section 3; stratum U is the test of that approximation.

### B2. Ambient contamination stress test (proposed)

- **Goal**: Measure how accuracy and the pool ambient estimate respond to planted ambient RNA, the topic of [R7].
- **Ground truth**: Planted simulation. The planted $\alpha$ of a droplet is the share of its informative-locus reads drawn from the ambient profile, and the pool value is the mean over droplets. The ambient profile $\varphi_v$ is the mean donor alt fraction at each variant.
- **Generator** (proposed): Apply the B1 generator with $K=4$, $f=0.10$ and strata E and U. For each droplet, draw $\alpha_n$ from the levels $\{0, 0.05, 0.10, 0.20\}$, and replace each informative read with an ambient read with probability $\alpha_n$. Use five seeds per level.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated pools as B1 with $K=4$, $f=0.10$, ambient levels 0, 0.05, 0.10 and 0.20, strata E and U, five seeds | Generator above | single-nucleus RNA-seq; human; 4 donors per pool | — | Ambient profile built from the same donors (see pitfalls). |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Accuracy drop | Accuracy at $\alpha=0$ minus accuracy at $\alpha=0.20$, per caller and stratum | minimise | primary | — |
| Pool ambient error | Absolute error $\lvert\hat\alpha-\alpha\rvert$, where the method writes `uns/ambient_fraction` | minimise | guardrail | — |

- **Comparators**: Vireo (default), Vireo with `check_ambient` on (accuracy only), and souporcell (default).
- **Protocol**: As B1, with the ambient levels above and no other change.
- **Acceptance criterion** (proposed): A method is accepted as default only if its accuracy drop is no more than 0.02 larger than the best comparator's drop on the same caller.
- **Known pitfalls**: The ambient profile is built from the same donors, which favours methods that model ambient as an average profile; a profile from another cohort reduces this. [R7] concerns multiome data, and the RNA-only setting here inherits no ranking from it.

### B3. Real pools with pooling-design labels

- **Goal**: Measure donor-of-origin recovery on real pools, where labels come from the pooling design rather than from a simulator.
- **Ground truth**: Orthogonal measurement. Each patient's cells were prepared separately before pooling, so the patient of origin is known from the design. Normalisation: recall and precision per patient over all droplets, with unassigned droplets counted as misses.
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Real pools with donor labels fixed by the pooling design | — | human, single-cell RNA-seq; donors —, droplets — | — | Pool composition is fixed by the design. |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Recall and precision | Per patient over all droplets, as defined above | maximise | primary | — |
| Robustness to panel size | Change in recall and precision when the bulk-derived SNP panel is reduced to 50% and 25% of its size | minimise degradation | guardrail | — |

- **Comparators**: souporcell (default), Vireo with cellSNP counts [R10], and Vireo with vartrix counts.
- **Protocol**: Choose the variant panel without the bulk genotypes used to select patients. Panel levels are 100%, 50% and 25%.
- **Acceptance criterion** (proposed): No tool becomes default unless it matches or beats the others on both metrics at every panel level.
- **Known pitfalls**: Using bulk-derived SNPs both to choose patients and to demultiplex favours tools whose panel matches the bulk data. Patients differ in cell-type composition, so donor clusters can track cell type; check cluster composition against markers.

### B4. High-donor pools (proposed)

- **Goal**: Measure cluster merging and duplicate clusters when a pool holds more donors than the 16-donor regime of the standard mode.
- **Ground truth**: Planted simulation, with labels as in B1. Normalisation: singlets only. A donor is split when at least 10% of its singlets carry a second cluster label.
- **Generator** (proposed): Draw $K\in\{16,32,64\}$ donors from one cohort of at least 64 individuals, fixed before the benchmark. Make $f=0.10$ cross-donor pairs with strata E and U. Call variants with BCFtools only, to bound cost. Use three seeds, and fix droplets per donor across K (see pitfalls).
- **Datasets**

| Dataset | Source | Modality, species, size | License | Notes |
|---|---|---|---|---|
| Simulated pools, $K\in\{16,32,64\}$, $f=0.10$, strata E and U, BCFtools calls, three seeds | Generator above | single-nucleus RNA-seq; human; 16 to 64 donors per pool | — | Cohort size is a constraint (section 10). |

- **Metrics**

| Metric | Definition | Direction | Role | Reference |
|---|---|---|---|---|
| Adjusted Rand index | Section 3 equation over singlets with a donor label | maximise | primary | [R9] |
| Duplicate-cluster rate | Fraction of donors split across two or more clusters, by the 10% rule | minimise | guardrail | — |
| Accuracy | As B1, with Hungarian matching at each K | maximise | guardrail | — |

- **Comparators**: souporcell default (EM, restarts 100), souporcell in high-donor mode (`souporcell3` with khm clustering), and Vireo with `n_init` 50. All receive the true K.
- **Protocol**: K given as the true value; results reported per K.
- **Acceptance criterion** (proposed): An ARI at least 0.02 below the best comparator is a failure. Duplicate-cluster rate and accuracy are reported at each K.
- **Known pitfalls**: Droplets per donor fall as K grows at fixed pool size, which lowers ARI by itself, so droplets per donor must be fixed across K.

### P1. Performance and scaling

Wall time, peak memory and droplets per second for pools of $10^4$, $10^5$ and $10^6$ droplets, at $K=4$ and $K=16$ with 60,000 variants (the scale of the scSplit README's count-step memory note). Timed on CPU with 8 threads and on one CUDA device, for `vireo`, `souporcell` at its default restarts and `freemuxlet`. Hold fixed: the variant panel, count matrices, thread count, seed and restarts. Proposed acceptance: peak memory no larger than the comparators' at each scale, and CUDA at least twice as fast as CPU at $10^5$ droplets.

## 9. Chaining

<!-- CHAINING:AUTO:BEGIN -->
- **Needs first**:
  - `ingest-quant.umi_deduplication`: UMI deduplication and molecule collapsing
  - `cell-calling.cell_vs_empty_droplet_calling`: Cell versus empty-droplet calling (barcode level)
  - `cell-calling.nucleus_vs_empty_calling`: Nucleus versus empty-droplet calling in single-nucleus RNA-seq
- **Feeds**:
  - `demux.sample_swap_detection`: Sample identity verification and swap detection
  - `demux.sex_inference`: Sex inference per sample, donor cluster or cell
  - `ambient.contamination_fraction`: Contamination fraction estimation
- **Reads**: `layers/alt`, `layers/total`, `varm/variant_sites`, `obs/barcode`, `uns/alignment_path`
- **Writes**: `obs/donor_cluster`, `obs/donor_prob_max`, `obs/cross_donor_doublet_prob`, `obsm/donor_posterior`, `uns/donor_count`, `uns/ambient_fraction`, `models/donor_fit`
<!-- CHAINING:AUTO:END -->

Belongs to the pooled-sample workflow after cell calling. Genotype-based assignment replaces it where donor references exist.

## 10. Risks, pitfalls and open questions

- **Evidence gaps.** The full texts of [R6] and [R7] are not reproduced here, so their results are not used and the metric definitions are this document's own. [R8] is cited only for label-free pooling. Author lists are given only as far as their records show. The benchmark results of [R1], [R3] and [R4] are not used; only their method definitions are. The issue year and page range of [R5] are not reproduced here; the corpus record gives 2017.
- **Unsettled questions.** The best genotype-free tool is not identified by the sources cited here. No source cited establishes donor-count selection for these methods, and ambient modelling for snRNA alone is unresolved. The ambient term and the K rule of section 5 are untested.
- **Inputs not yet fixed.** The donor genotype cohort (at least 64 individuals for B4) and the snRNA background for B1 to B4 are yet to be chosen. The B3 dataset fields (source, donors, droplets) are blank because no real pool with design-fixed labels is named here. Whether the singlet catalogue carries donor labels is unknown; if it does, it could replace the simulated background.
- **Technical risks.** Homotypic doublets are invisible to every method here. The 1:1 pair approximation of section 3 is biased under unequal reads, which B1 stratum U tests. The complexity figures in section 3 are derived, not measured. freemuxlet needs alignments and dsc-pileup output, which count matrices alone do not provide.
- **Code-level points.** scSplit's docstring gives a cell-assignment threshold of 0.9 while its code uses 0.99. freemuxlet's alpha grid is commented out while its README states a default of 0.5. The dsc-pileup quality defaults come from the README option block and are not checked per tool. No ambient term appears in the scSplit code at 5e4045c.
- **First experiment.** Carry out B1 stratum U at K = 4 on BCFtools calls, comparing Vireo with souporcell. If Vireo trails souporcell by more than 0.02 accuracy on stratum U but not on stratum E, the equal-read pair approximation is the cause. The ambient-extended model of section 5 must then include unequal read contributions before B2 is carried out.

## 11. References

R1. Heaton H, et al. Souporcell: robust clustering of single-cell RNA-seq data by genotype without reference genotypes. *Nature Methods* 2020. doi:10.1038/s41592-020-0820-1 — partial (corpus)

R2. Souporcell3: robust demultiplexing for high-donor single-cell RNA-seq datasets. *Bioinformatics*. doi:10.1093/bioinformatics/btag117 — partial (repo)

R3. Huang Y, et al. Vireo: Bayesian demultiplexing of pooled single-cell RNA-seq data without genotype reference. *Genome Biology* 2019. doi:10.1186/s13059-019-1865-2 — partial (corpus)

R4. Xu J, Falconer C, Nguyen Q, et al. Genotype-free demultiplexing of pooled single-cell RNA-seq. *Genome Biology* 2019. doi:10.1186/s13059-019-1852-7 — verified (corpus)

R5. Kang HM, Subramaniam M, Targ S, et al. Multiplexed droplet single-cell RNA-sequencing using natural genetic variation. *Nature Biotechnology* 2017. doi:10.1038/nbt.4042 — partial (corpus)

R6. Fu Y, Youness M, Virzì A, Song X, et al. Benchmarking of computational demultiplexing methods for single-nucleus RNA sequencing data. *Briefings in Bioinformatics* 2025;26. doi:10.1093/bib/bbaf371 — partial (search)

R7. The impact of ambient contamination on demultiplexing methods for single-nucleus multiome experiments. *eLife* reviewed preprint 106769, https://elifesciences.org/reviewed-preprints/106769 — partial (search)

R8. Hoeft K, Bleckwehl T, Schumacher D, Kramann R, et al. Label-free single-cell RNA multiplexing leveraging genetic variability. *Nature Communications* 2024;15:10612. doi:10.1038/s41467-024-54270-6 — partial (search)

R9. Hubert L, Arabie P. Comparing partitions. *Journal of Classification* 1985. doi:10.1007/bf01908075 — verified (corpus)

R10. Cellsnp-lite: an efficient tool for genotyping single cells. *Bioinformatics* 2021. doi:10.1093/bioinformatics/btab358 — partial (corpus)

## 12. Code and software cited

| Repository | Authors / maintainers | License (as stated in the repository) | Role in this task | singlet route |
|---|---|---|---|---|
| https://github.com/wheaton5/souporcell | Haynes Heaton (copyright holder in LICENSE); troublet ships in the same repository | MIT (LICENSE: Copyright (c) 2019 Haynes Heaton) | souporcell, troublet and consensus; defaults at 97fbf4d | port |
| https://github.com/single-cell-genetics/vireo | Yuanhua Huang (setup.py author); paper authors in [R3] | Apache-2.0 (LICENSE; setup.py `license='Apache-2.0'`) | default method; defaults at e365463 | port |
| https://github.com/statgen/popscle | Hyun Min Kang and Fan Zhang (copyright 2009–2019 in cramore.cpp) | Apache-2.0 (LICENSE) | freemuxlet and dsc-pileup; defaults at da70fc7 | port |
| https://github.com/jon-xu/sc_split | jon-xu (copyright holder in LICENSE) | MIT (LICENSE: Copyright (c) 2019 jon-xu) | scSplit comparator; defaults at 5e4045c | callout |
