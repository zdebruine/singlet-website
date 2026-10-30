# Anvil campaign v3: new GEO studies, self-orchestrating

Everything here runs on Anvil. After `launch_campaign_v3.sh` nothing depends on the laptop or its internet.
Plan and candidate list: `docs/ANVIL-NEW-STUDIES.md`.

## Pieces

| File | Role |
|---|---|
| `build_v3.sbatch` | Builds Singlet-Bio/singlet main into `bin_v3_<sha>/` (never touches `bin/`). Seeds the vendored htslib headers that the repo's `.gitignore` leaves out. |
| `anvil_env_v3.sh` | Environment; the binary comes from `$R/BIN_V3_CURRENT`. Results tree `$SCRATCH/results_v3`. |
| `cf_pack_v3_prepare.sh` | Packer reconciliation: `singlet.bundle` at the binary's commit, verbatim except `_singlet_version()`. Replaces the `cf_pack.py` fork. |
| `make_targets_v3.py`, `prep_targets_v3.sbatch` | Targets (`gsm srr tag species gse pdat n_runs all_srrs`) from GEO SOFT + ENA. Samples with no ENA runs yet go to `tier<T>_pending.tsv`. |
| `download_v3.sbatch` | Download on compute (2 cores, 4 GB, 6 samples per task, 30 M read cap). |
| `process_v3.sbatch` | Align + full pipeline (26 cores, 48 GB, 8 samples per task; the controller overrides the sizes per submission). OOM: marker, one retry with 1.5x memory. |
| `build_catalog_v3.py` | Catalog slice from GEO SOFT: series title/summary/design, per-sample source, characteristics (text kept intact), protocols, library, SRA relation, PubMed ids, dates; status from the results dir. |
| `cf_bundle_v3.py`, `verify_bundle_v3.py` | Pack a study; check each layer and the metadata. |
| `publish_study_v3.py`, `publish_v3.sbatch` | Per study: pack, R2 upload, D1 upsert (the existing `cf_publish_anvil_v2.py`, unchanged, pointed at per-study paths), verify, register, delete scratch. |
| `controller_v3.py`, `controller_v3.sbatch` | The controller. |
| `launch_campaign_v3.sh` | One-time launch. |
| `check_creds_v3.sbatch` | Read-only check of `~/.singlet/cloudflare.env` (D1 select, R2 head) from a compute node. |
| `smoke_one.sbatch` | End-to-end smoke test of one sample; no upload. |

## Sizing (measured on the v3 binary, 30 M read cap, 16 threads)

| Stage | Measured | Requested |
|---|---|---|
| Download | 140-210 s per sample (SRA VDB read, 2 cores enough) | 2 cores, 4 GB, 40 min, 6 samples per job |
| Align + pipeline | human 300 s, mouse 166 s per sample; peak RSS human 32.8 GB, mouse 41.6 GB | 48 GB, 26 cores, 8 samples per job, `--time` 65 min (measured wall x1.5 + 5) |
| Pack | seconds | with the publish job (4 cores, 7 GB) |

Slurm bills max(cores, memory / 1.896 GB) and caps memory per core at 1,896 MB, so memory sets the bill: 48 GB is about 25 SU/hour
whatever the core count, and 54 GB (the v2 profile) would be 28. Mean cost is about 1.6 SU per sample for align (the genome loads for each
sample) plus 0.15 for download; the controller budgets 1.8 SU per sample. `wholenode`, `standard` and `wide` are never used, no `--exclusive`.
Process jobs are short and each fits one mixed node, so they backfill. Quick checks go to `-p debug` (2 jobs, 30 min).

## Controller

`v3_controller` is a 1-core job that resubmits itself with `--begin=now+30minutes`. Each run:

1. Stops if `state_v3/{STOP,ABORT,DONE}` exists. Writes `ABORT` and stops if `mybalance` is below 94,100 SU (spend cap of 20,000 SU from 114,109.8) or the date is past 2026-11-05.
2. Counts samples per study from the results dir (`out/pileup_stats.json` = done, `.rejected` = failed).
3. Retries each failed sample once (`download_fail`, `runtime_fail`, `process_no_output`; marker `state_v3/sample/<GSM>.retried`). OOM samples get one attempt with 1.5x memory (`.oom_retried`); other reasons are terminal. A sample whose last submission has no live job left (job hit its time limit, node failure) is requeued up to 3 times (`.requeue`), then rejected `stuck_requeue`.
4. Submits `publish_v3.sbatch` for every study whose samples are all terminal and has at least one done sample (6 studies per job). A publish job that ends without a `.published` marker is retried once, then `.publish_failed`. Studies with no done sample get `.empty`.
5. Submits the next wave only when the shared partition can take it: it reads `sinfo -p shared -o %C`, computes slots = idle cores / 26 (at most 24), and sizes the wave to one pass of those slots (slots x 8 samples, whole studies). It holds when two waves are live, when any of its process jobs is still pending (no pile-up in the queue), when fewer idle cores than one job needs, or when the budget would fall below 94,100 SU (spend cap of 20,000 SU from 114,109.8). A wave is a download array, then process arrays per species with `--dependency=afterany:<download array>`. The `WAVE` log line carries the SU estimate, balance, idle cores and the sizes requested.
6. Tier A first. Tier C opens only when every tier A study is published or empty and none failed to publish; the controller then submits `prep_targets_v3.sbatch C` and carries on. `touch state_v3/NO_TIER_C` ends the campaign after tier A.
7. Writes `DONE` and stops when every opened study is terminal.

Log: `logs/v3/controller.log`. Controls: `touch state_v3/PAUSE` (no new waves), `touch state_v3/STOP` (no resubmission).
Finished work is never redone: markers in `state_v3/study/` and `state_v3/sample/`, per-sample files in the results dir.
Tunables are environment variables of `controller_v3.py` (`PROC_MEM_G`, `PROC_PER_JOB`, `SLOT_CAP`, `MAX_LIVE_WAVES`, `MIN_BALANCE`, `CUTOFF`, ...).

## Publish stage

Per study, after the packer: `sync-catalog --all` (D1 gse/gsm upsert by HTTP API) and `upload-bundles --missing`
(R2 `data/<GSE>/<GSE>.singlet`), then verification: R2 HEAD size equals the local file, `/api/gse/<GSE>` returns the same
`bundle_key` and `bundle_bytes`. Only then are scratch sample directories and the local bundle deleted.
`refresh-next`/`index-next` run from the cluster only if `~/.singlet/ingest.env` defines `INGEST_TOKEN`; without it the
3-hourly `catalog-crank.yml` registers new files.

## Not covered

- Samples without ENA runs at launch (`tier*_pending.tsv`, reason `no_runs_in_ena` or `ena_error`) are not picked up later; rerun `prep_targets_v3.sbatch` and launch again for them. ENA answers HTTP 500 under load; `ena_error` rows are the ones to retry first.
- `provenance.json` carries `singlet_git_sha: unknown` (the engine takes it from a CMake define the repo does not set); the commit is in `summary.json` (`git_sha`) and in `bin_v3_<sha>/GIT_SHA`.
- `out_reap_v2` is not involved (it reaps `results_v2` only) and stays held.
- Viral/microbial screens, `--te-classify` and `--cascade` stay off.
