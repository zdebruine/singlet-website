# New GEO studies for Anvil reprocessing

Prepared 2026-10-20. Nothing was submitted; no Anvil job, D1 write or R2 write was made. Candidate list:
`scripts/anvil/new_studies.tsv` (2,338 studies). Helper scripts: `scripts/anvil/find_new_geo_studies.py`,
`scripts/anvil/resolve_runs_ena.py`.

## 1. How the catalog tracks studies

- The website does not discover studies. `refresh-next` / `index-next` only fill derived tables (`gsm.organism_primary`,
  `sample_qc.usable`, `bundle_manifest`, `bundle_index`, `gse_meta`) for files already in R2. Discovery happens on the
  cluster side: `scgeo.catalog.discovery` (NCBI esearch on `gds`, `DEFAULT_SINGLE_CELL_QUERY`) feeds the processing
  catalog, then `targets_v2.tsv`.
- `gse` has `r2_bundle_key` (empty = no published file), `n_gsm_total/done/failed`, `submitted_date`. `gsm.status` holds only
  `DONE`, `DONE_QC_WARN`, `FAIL`, `HARD_FAIL` (no pending rows: a GSM exists in D1 only after an attempt).
- Production D1 on 2026-10-20: 11,153 GSEs, 8,202 with a file, 2,951 without. Newest GSE 345981 (released 2026/09/03).
  GSMs: 85,897 DONE, 37 DONE_QC_WARN, about 12,700 FAIL/HARD_FAIL (barcode_stripped 4,700 + gse_skip 1,615, runtime_fail 1,725,
  simpleaf_permit 1,047, download 1,060 ...). Those failures are excluded below.

## 2. Candidates

Only human (GRCh38-2024-A) and mouse (GRCm39-2024-A) references exist on Anvil, so mixed or other-species studies are left out.

| Tier | What | Studies | GEO samples | SU at 1.2/sample |
|---|---|---|---|---|
| A | New on GEO since 2026-09-01, not in `gse`, matches the droplet/combinatorial-indexing query used by the catalog | 381 (130 human, 251 mouse) | 6,072 | 7.3 k |
| B | Same dates, not in `gse`, broad "single cell / scRNA / snRNA" query only; includes bulk and plate data, needs a protocol pre-screen | 383 (173 human, 210 mouse) | 9,283 | 11.1 k (ceiling) |
| C | In `gse`, no file, at least one DONE GSM, no failed-only status (older pipeline, never bundled) | 1,552 (470 human, 1,082 mouse) | 9,100 DONE GSMs | 10.9 k |
| Total | | 2,316 | 24,455 | 29.4 k ceiling |

Notes:
- Another 22 tier A/B studies are mixed-species, and catalog studies in other species (zebrafish, macaque, rat, ...) have no Anvil reference; all are left out.
- GEO sample counts include non-RNA samples. For tier A, ENA lists RNA-Seq runs for 236 of 381 studies so far (1,661 GSMs); the other 145
  have no runs mirrored yet and must be re-resolved before launch.
- Reads: 97% of the 518 samples with an ENA read count have 30 M or more (median 321 M). With `--max-reads 30000000` the work is
  at most 30 M reads per sample: about 182 G reads for 6,072 tier A samples, 734 G for all 24,455. Download volume is larger.
- Tier C already has pre-existing results from older runs; reprocessing is for the extra layers and one consistent version.
- Studies that already have a file built by the older pipeline (no donor/SNP/mt layers in the 4,112 human bundles) are a separate,
  larger reprocessing question and are not in this list.

## 3. SU estimate

Measured, not assumed. Campaign v2 (human + mouse, `sacct` since 2026-09-17): 860 completed `v2p_` batch jobs used 3,531 core-hours,
plus 580 (OOM), 1,261 (timeout) and 6,930 in the 128G/70-core escalation tier, about 12.3 k SU for 11,865 targeted samples: **about 1.0
SU per targeted sample all-in**. A 30-sample batch on 30 cores / 54 G takes 60-75 min (30-37 SU), so 1.2 SU/sample holds.

**The 4 cores / 7 G shared profile cannot run the aligner.** The STAR index is 22.9 GB (human) and the job loads it
with `--genome-shared off`; the v2 smoke tests peaked at 32 to 45 GB RSS. Anvil bills `shared` by max(cores, memory / 1.9 GB), so 54 G on 30
cores is 30 SU/h either way. 4 cores / 7 G is fine for the download stage only (section 5).

| Scope | Samples | SU (1.2) | Balance after (114,119) |
|---|---|---|---|
| A only | 6,072 | 7.3 k | 106.8 k |
| A + C | 15,172 | 18.2 k | 95.9 k |
| A + B + C ceiling | 24,455 | 29.4 k | 84.7 k |

Add about 0.15 SU/sample if downloads move to compute (section 5). The daemon's `SU_RESERVE` guard pauses at 20,000 SU.
Biggest waste last time: 15 timed-out 128G/70-core jobs burned 6,304 SU (51% of the spend). Cap that tier.

## 4. Pipeline version and layers

Deployed on Anvil: `singlet_campaign/bin/singlet.bin`, built 2026-07-07 from singlet-bio 37e7cbd (2026-06-19). Latest singlet-bio main is
b1335a8 (2026-10-16, version 1.0.0). Only 5 commits touched `src/` or `include/` since: protocol detection from post-UMI polyT for
over-sequenced barcode reads (7951807, aimed at the `barcode_stripped` failures), bamsort RAM tiers (a73445d), header fixes, the version reset.
The packer (`python/singlet/bundle.py`) changed more: hollow-sample guards, `excluded_samples` in the manifest, modality reading, one bad sample no
longer fails a study (9e7c38e). Anvil packs with its own `pylib/cf_pack.py`, a fork.

Plan: build b1335a8 with `build_anvil.sbatch` (one job), install beside the old binary, point `SINGLET_BIN` and `SINGLET_GIT_SHA` at it, and diff
`cf_pack.py` against `bundle.py` before reusing it. Smoke test 2 samples (human `GSM4259048`, mouse `GSM6552489`) before anything else.

Flags (same as `run_process_v2.sbatch`): `<SRR>.1fq --ref-base ... --genome-dir ... --exons genes.gtf --snps <species>.vcf.gz --pipeline
--output-format 1pz --genome-shared off --no-viral-screen --no-microbial-screen`. From the source:

| Layer | Output | Produced by |
|---|---|---|
| Counts (spliced / unspliced / junctions) | `exon_counts.1pz`, `intron_counts.1pz`, `sj_counts.1pz` | default (`--no-introns`, `--no-sj` off) |
| Splicing PSI | `splice_psi.1pz`, `splice_events.tsv` | default when junctions are counted; confirm in smoke test |
| SNP genotypes / donor demux | `donor/snp_ad.1pz`, `donor/snp_dp.1pz`, `donor/donor_assignments.tsv` | `--snps` + `--pipeline` |
| mt variants | `mt_variants.tsv`, `mt.1pz` | `--pipeline` |
| Ancestry | `ancestry_call.json` | always (embedded AIM panel); needs SNP pileup |
| Sex | `sex_call.json` | always |
| Doublets | `doublet_scores.tsv` | always (skipped for 0-cell samples) |
| V(D)J | `vdj_gene_usage.1pz` | default (`count_vdj`), from the GTF; empty for non-immune samples |
| Provenance | `provenance.json`, `summary.json` | always; the publisher gate needs `pipeline=true` and `snp_vcf` set |

Not enabled, by earlier decision: viral and microbial screens (`nonhost`), `--te-classify`, `--cascade`. Say so if "all layers" should include them (SU cost
is higher).

GEO metadata in the study file: `study_meta.json` / `series_meta.json` come from `pack_gse` and the processing catalog. v2 enriches with esummary (title, summary,
pdat, n_gsm, organism) in `cf_resolve_gse_v2.py`. Anvil has no `metadata_enriched.parquet` or `publications_enriched.parquet`, so per-GSM characteristics, source
name, protocols and PubMed links must be built into `catalog/processing_catalog_v3.parquet` first (`scgeo.catalog.soft` / `metadata`), and
`POST /api/ingest/geo_enrich` (pdat, pubmed_ids, n_samples_geo, gdstype) sent after upload. Keep `characteristics` text intact: the structured `gsm` columns are empty.

## 5. Submission plan (for approval; nothing run)

Layout: `$PROJECT/singlet_campaign` (existing tooling), a fresh `targets_v3.tsv` and results tree `$SCRATCH/results_v3` (as v2 did with `results_v2`), so inventories do not mix. Rows keep the
v2 format: `gsm primary_srr protocol_tag species gse gse_pdat n_runs all_srrs`. SRRs for tier A from `resolve_runs_ena.py`, for tier C from `gsm.srr_ids` in D1.

0. One-time: stop nothing (the v2 daemons have been idle since 2026-09-19; no crontab). Two self-resubmitting jobs, `out_reap_v2` and `esc_oom_v2`, are in the queue; hold `out_reap_v2` (it deletes `out/`) until upload is verified.
1. Build and smoke test (above), 2 samples, about 5 SU. Check every file in the layer table is in `out/`, and that `~/.singlet/cloudflare.env` (dated 2026-06-19) still authenticates to D1 and R2 with a read.
2. Download stage on compute, not the login node: `shared`, `-c 4 --mem=7G -t 00:45:00`, 6 samples per task (`singlet download <SRR> -o <GSM>/<SRR>.1fq --max-reads 30000000`, whole-task time cap). Arrays of at most 500 tasks, `%25`. About 0.15 SU/sample. Confirm outbound access from compute in the smoke test; if blocked, fall back to the v2 login-node daemon with `MAXDL<=4`, as before.
3. Process stage: `run_process_v2.sbatch` unchanged semantics (`shared`, `-c 30 --mem=54G -t 06:00:00`), 30 samples per job, species-homogeneous batches. Tier A: 6,072 samples is about 205 jobs; A + C about 510 jobs. Submit as one array per tier with `--array=0-N%10` (10 concurrent, 300 cores). Throttle downloads to stay at most 300 staged `.1fq` files ahead of processing.
4. OOM: no automatic 128G / 70-core tier. A 64G retry (`--mem=72G -c 30`, `-t 02:00:00`, batch of 4) once; then reject as `oom_fail`.
5. Scratch hygiene: the pipeline deletes the `.1fq` and star unmapped files on success; failed samples write `.rejected`. `$SCRATCH` is purged after 30 days (the env file says 90; the HPC skill says 30), so bundle and upload within about 2 weeks. 4.5 TB of stale SRA caches sit in `$SCRATCH/ncbi_cache/sra`: ask before deleting.
6. Bundle and publish (existing `cf_publish_cycle_v2.sh` stages, on one login node with `PUBLISH_STOP` available): resolve GSE metadata, completeness gate, `cf_bundle_v2.py` (heavy: run as a Slurm job, not on login06 where it stalled and hit load 144), `cf_publish_anvil_v2.py sync-catalog` (gse/gsm upsert through the D1 HTTP API, COALESCE and monotonic guards), `upload-bundles` (R2 `singlet-data`, key `data/<GSE>/<GSE>.singlet`, sets `r2_bundle_key`, `r2_bundle_bytes`, `r2_bundle_n_gsms`).
7. Registration: `GET /api/ingest/refresh-next?n=50` until `remaining_total` is 0, `index-next?n=25` until `remaining` is 0, then `refresh-next` once more, all with `X-Ingest-Token` (`catalog-crank.yml` does this every 3 h anyway). Then `scripts/smoke.sh https://singlet.bio` and spot-check three new studies on `/api/gse/<id>`.
8. Reap: only after step 7 shows `bundle_manifest` rows for a GSE, run the reaper for that GSE's `out/`.

Order: smoke, tier A (about 2 days), tier C, then tier B after a pre-screen (ENA `library_strategy`/`library_source` plus the pipeline's protocol gate; rejects cost no align time). Finish and upload before the maintenance window, 2026-11-07 00:00 to 11-08 18:00 EST.

## 6. Risks

- Memory: 4c/7G is not viable; 54G fits both species (peak 14 GB reported, 32-45 GB RSS). Large samples OOM about 6% of batches.
- 30 M read cap with `primary_srr` only: 42% of the tier A GSMs seen have more than one run. Deep samples are truncated and short first runs lose lanes (inherited v2 behaviour; `state/multi_run_gsms.txt` lists them).
- `barcode_stripped` and `download_fail` were the top failure reasons (6.2 k and 1.1 k of 12.7 k); expect similar loss on tier B. The `gse_skip` rule stops a bad study after 5 terminal samples.
- Publisher history: a bundle stage on login06 drove load to 144 and was aborted on 2026-09-17; the 2026-09-18 dashboard script never pushed (git diff ignores untracked files); pure-v1 and Clipper-owned GSEs are skipped by design, so some tier C GSEs may be skipped, not published, and need a decision.
- Version mix: new bundles record a new `singlet_version` next to 0.3.0/2.0.0 bundles; readers ignore the field.
- Catalog hygiene: D1 is shared with previews; `sync-catalog` upserts are idempotent, but run the first publish on 3 studies and compare `gse` rows before the full cycle. D1 reads used for this report: about 0.6 M rows.
- Embargo or just-released studies (tier A, 145 without runs in ENA yet) can lag SRA by days.
- SRA/ENA throughput and login-node rules: no `find`/`du` on Anvil login nodes; the v2 daemon's `find` scans over `results_v2` should be replaced by a job or `squeue`/state files.
