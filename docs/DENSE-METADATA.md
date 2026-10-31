# Dense per-donor metadata: what we have, what is missing, what it costs

State on 2026-10-20. Companion to `docs/SEARCH-ROADMAP.md` (the search plan written in the "Singlet Bio search
capability" session); this note covers the pipeline-computed facts that plan's task T6 would index: SNP
genotypes, genetic ancestry, genetic sex, mitochondrial variants, doublets and cell cycle.

Per-donor genotype layers (SNP read depth, genotype calls, allele-specific counts, donor mitochondrial sequence) are computed by
the pipeline but are not public: the site, the API and the MCP server neither list, serve nor count them
(`functions/_shared/restricted.ts`, CHANGELOG 2026-10-20). Wherever this note says "SNP genotypes", it describes the pipeline's
output, not what a visitor can download.

## 1. What the published files hold today

Layers depend on the pipeline version that built the file, not on species or biology. Downloadable human and
mouse studies, by version (from the file indexes in D1):

| Pipeline version | Studies | Approved samples | Reads | SNP genotypes | Ancestry call | Doublet scores | Non-empty mt variant matrix |
|---|---|---|---|---|---|---|---|
| 2.0.0 | 3,313 (3,225 human, 88 mouse) | 32,879 | 917 G | none | none | none | none |
| 1.0.0 | 257 | 2,341 | 58 G | 158 studies | 160 | 160 | 217 |
| not recorded | 3,457 (3,374 mouse, 83 human) | 18,979 | 542 G | all | all | all | 3,245 |

So 90% of human studies (pipeline 2.0.0) have counts, splicing and V(D)J segment counts but none of the
read-based donor layers. That is why ancestry exists for only 242 human studies.

## 2. How each fact is computed now, and what is wrong with it

**Ancestry** (`singlet-bio/include/singlet/pileup/ancestry.h`). A classifier, not reported ancestry: maximum
likelihood over five continental populations (AFR, EUR, EAS, SAS, AMR) using 50 ancestry-informative SNPs with
1000 Genomes frequencies. It pools reads from *all cells in one GSM*. It is not donor-based:
- a GSM that pools several donors (multiplexed runs) gets one blended call;
- a donor split over several GSMs (time points, tissues, replicates) is called separately each time;
- 50 markers chosen for genotyping arrays mostly fall where 3′ scRNA-seq has no reads, so most samples return
  `low_data` (fewer than 5 informative markers).

**Genetic sex** (`sex_calling.h`). Called from expression: XIST versus chrY genes (UTY, DDX3Y, KDM5D, EIF1AY,
ZFY, RPS4Y1, USP9Y), summed over all cells in the GSM. Same pooling issue as ancestry. The gene names are matched
exactly in upper case, so mouse genes (Xist, Uty, Ddx3y, ...) never match and mouse calls are most likely all
"unknown" (confirmed: every mouse `sex_call.json` reads "unknown"). Pipeline fix needed in Singlet-Bio/singlet: match gene
names case-insensitively, or map mouse symbols to the human ones. Until then the website counts the sex layer over human
studies only (`functions/_shared/layers-core.ts`, `study-card.ts`) and the docs say so.

**SNP genotypes and donors** (`donor_demux.h`). A vireo-style Beta-Binomial mixture separates donors *within* a
GSM from per-cell allele counts on a SNP panel. Donors are not matched *across* GSMs of a study.

**Mitochondrial variants** (`mt_heteroplasmy.h`, `mt_event_caller.h`). Per cell, the variant allele fraction at
each chrM position is a heteroplasmy estimate, i.e. the share of mtDNA molecules carrying the allele; the model
does not assume one genome per cell. The matrix is empty in most samples because a position must have at least
10 reads in a cell, which 3′ droplet data rarely reaches outside a few transcript ends. `mt_events.1pz` (in the
older files) binarises at 3 reads and 2% allele fraction against the donor consensus.

**Clonality** (`singlet-bio/include/singlet/gpu/anno/mt_lineage.h`, `python/singlet/gpu/lineage/mt.py`). Not in
the published files; it is an analysis function. MQuad-style binomial mixture per site to pick informative sites,
then a Gaussian mixture over cells' allele-fraction profiles with BIC to choose 2 to 10 clones. It assumes cells
fall into discrete clones defined by shared heteroplasmic variants, and with 3′ coverage the informative sites
are few and noisy (sequencing error, RNA editing, nuclear mitochondrial copies, strand artefacts). It should not
be exposed publicly yet.

**Doublets and cell cycle**. Scrublet-style simulation plus kNN with a mixture threshold; cell cycle from S and
G2/M gene scores. Both need only the count matrix.

## 3. What "dense and high quality" needs

1. **Donor identity first.** Within each GSM, demultiplex donors (existing code). Across GSMs of a study, match
   donors by genotype concordance of their pooled allele counts, giving a study-level donor id. Every per-donor
   fact below is computed on that pooled donor. This is the step that turns sample calls into donor calls.
2. **Ancestry per donor.** Replace the 50-marker panel with common SNPs in expressed exons and 3′ UTRs
   (1000 Genomes / gnomAD, minor allele frequency ≥ 5%, on the order of 10⁵ positions). Pool reads per donor,
   then place the donor on a 1000 Genomes reference (projection onto reference principal components, or a
   supervised admixture fit) and report continental proportions with the number of informative sites. Call
   only when coverage passes a stated floor; otherwise "insufficient data".
3. **Genetic sex per donor.** Same model on the donor's pooled expression; match gene names case-insensitively
   so mouse works; report XIST and chrY evidence with the call. Compare with GEO-declared sex and list
   disagreements (they are findings).
4. **Mitochondria per donor, clonality later.** Pool the donor's chrM reads into a consensus genome and call its
   haplogroup: robust, useful for donor matching and a second ancestry signal. Keep per-cell heteroplasmy only
   where coverage supports it (full-length protocols such as Smart-seq, or mitochondrial-enriched libraries).
   Short reads cannot be phased into individual mitochondrial genomes beyond one read's span, so a per-cell
   assembly of several mitochondrial genotypes is not recoverable from these data; what is measurable is the
   allele fraction per site and co-occurrence within a read. Tracking heteroplasmy drift along a developmental
   trajectory is a research question for the studies with deep chrM coverage, not a catalog layer.
5. **Doublets and cell cycle everywhere.** Computed from the count matrices already published.

## 4. Compute

| Work | Needs | Scope | Estimate |
|---|---|---|---|
| Doublets, cell cycle, sex (fixed), per sample | the published files only (3.5 TB) | 54,199 approved samples | a few hundred core-hours; about a day on Clipper |
| Sex and expression facts per donor | the above plus donor ids | studies with donor ids | negligible once donors exist |
| SNP pileup at ~10⁵ exonic SNPs, donor demultiplexing, chrM pileup | reads | the 32,879 samples in 2.0.0 files (917 G reads) | no kept BAMs on Anvil (see below), so download and realign again. The Anvil mouse campaign measured about 1 SU per sample (4 cores x 15 min); with retries about 40 k SU. The end-to-end runs suggest up to 2 to 4 core-hours per sample, 65 to 130 k SU. Plus about 30 to 60 TB of SRA downloads (Anvil scratch is 100 TB) |
| Same pileup with the larger SNP panel on the older files | reads, unless their BAMs exist | 21,320 samples | same per-sample costs |
| Cross-GSM donor matching, ancestry projection, haplogroups | the pileup outputs | all donors | small: minutes per study |

The per-sample figures come from the end-to-end runs recorded in `singlet-agents/state/e2e_results.md` (5 to 12
minutes wall on 16 to 24 threads at the 30 M read cap) and the Anvil mouse campaign; they are estimates, not
measurements of this job.

**Kept reads (checked 2026-10-20).** On Anvil, the campaign's per-sample result folders were emptied by the 30-day
scratch purge; what remains is 3,333 partial SRA download caches (4.5 TB), 223 encoded-read (`.1fq`) files and 62
BAMs, not enough to skip realignment. On Clipper, where the 2.0.0 human campaign ran, the lab project space holds
535 BAMs (1.5 TB, 78 of them in the campaign's recovery scratch), 306 encoded-read files (372 GB), 161 SRA files and
185 FASTQ files: a few hundred samples, not the 32,879. The 4,762 `.singlet` files (1.4 TB) are the published
outputs. (Search depth 6 below `/mnt/projects/debruinz_project`.)

**Where it runs.** Clipper is free and is used first: the count-only layers, the larger SNP panel and the pileup
code are developed and benchmarked there on a few hundred samples. Anvil (NSF ACCESS allocation, billed in service
units: 1 SU = 1 core-hour at up to ~1.9 GB per core on the shared partition) takes the catalog-wide pass once the
per-sample cost is measured. Its balance on 2026-10-20 is 114 k SU, enough for the 2.0.0 pass at the measured rate,
not at the upper estimate.

## 5. Recommendations

1. Run the count-only layers (doublets, cell cycle, corrected sex) on every published file now.
2. Decide where the realignment's BAMs or encoded reads are kept (Anvil scratch purges after 30 days), then run one combined pass (expanded SNP panel, donor demultiplexing, chrM pileup)
   over the 2.0.0 samples, followed by the older ones.
3. Add cross-GSM donor matching, then per-donor ancestry, sex and haplogroup, written as `pipeline` facts into the
   `sample_attr` table planned in `SEARCH-ROADMAP.md`.
4. Do not publish mitochondrial clonality. Present mitochondrial variants as a modality only where coverage
   supports it; on the home page, list the donor-level layers once they exist for most studies.
