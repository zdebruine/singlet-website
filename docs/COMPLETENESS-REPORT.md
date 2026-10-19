# Completeness and trust review, 2026-10-19

Why many studies on singlet.bio look incompletely processed, what is recoverable, and what the pipeline and site should change.
Sources: production D1 (`gsm`, `gse`, `gse_meta`, `sample_qc`, `bundle_manifest`), the HPC failure registry and dashboard, GEO series records, ENA `filereport`, and read-level checks of FASTQ heads over HTTP range requests. Studies viewed on the live site: GSE138867, GSE114725, GSE206741, GSE152607.

## 1. Where every GEO sample ends up

| Stage | Samples | Note |
|---|---|---|
| GEO samples in catalogued studies (`gse.n_gsm_total`) | 209,938 | 11,153 studies |
| Have a `gsm` row (ever queued) | 98,672 | 107,608 samples in 3,016 studies and 3,658 in 146 studies have no row |
| Pipeline `DONE` | 85,934 | 9,960 studies |
| `DONE` and in a published file (`sample_qc`) | 70,212 | |
| `DONE` but in no file | 15,722 | the publish gap |
| Passed QC (tier 0) | 53,438 on `DOWNLOADABLE_SQL` | what the headline counts |

Three separate losses stack: never queued, failed, and done-but-unpublished. The site shows only the last two, and only partly.

## 2. Publish gap (largest recoverable loss, no reprocessing needed)

Per study, comparing `DONE` samples with `bundle_manifest.n_gsms_in_bundle`:

| Study state | Studies | DONE samples | In bundle |
|---|---|---|---|
| bundle complete | 6,977 | 60,926 | 60,926 |
| **no bundle at all** | **1,934** | **11,665** | 0 |
| **bundle behind D1** | **764** | 11,901 | 7,104 (gap 4,797) |
| bundle ahead of D1 rows | 268 | 1,442 | 2,156 |

- 1,928 of the 1,934 no-bundle studies last ran 2026-06-17. They were processed and never assembled.
- GSE206741 (96 sci-Plex samples, 59% mapped, 68K cells): the page shows 96 processed samples and "File not built yet". A visitor sees a finished study they cannot load.
- GSE114725 (inDrop): the bundle was built 2026-06-30 with 21 of 56 DONE samples. The 21 in the file map at 13% on average, 12 of them are unusable, and the 35 left out map at 53% with about 1,150 cells each. The study card therefore reads as mostly failed when the data is good.
- "Bundle ahead" means `gsm` is missing rows the bundle has (GSE297097: 1 `gsm` row, 19 in the bundle, 429 or 186 depending on the table).

Fix: a rebuild queue keyed on `DONE count > n_gsms_in_bundle`, run by the cluster, and an alarm when the gap exceeds a week.

## 3. Failure buckets (FAIL / HARD_FAIL rows in D1)

| Category | Samples | Studies | Reading |
|---|---|---|---|
| barcode_stripped (+ gse_skip variant) | 4,700 + 1,527 | 678 + 51 | see section 4 |
| runtime_fail | 1,725 | 314 | infrastructure, retry |
| simpleaf_permit | 1,047 | 126 | infrastructure, retry |
| download / download_fail | 792 + 243 + 88 | 264 + 86 + 6 | transient or removed from SRA; ENA mirror recovers some |
| protocol_detect | 671 | 302 | classifier gap, fixable by a better detector or manual protocol |
| qc_other / qc_low_genes | 330 / 276 | 27 / 21 | real low quality |
| no_r2 | 162 | 56 | single-read deposits, not processable as droplet data |
| FAIL with no category | 511 | 146 | uncategorised, needs a log pass |
| skip_plate_based | 21 | 9 | deliberate |

## 4. The "barcode stripped" bucket is four different things

I checked 70 samples against ENA and 12 GEO series records, then looked at read structure in FASTQ heads.

1. **Not single-cell at all.** Bulk RNA-seq and multi-omic series (several are SuperSeries with ATAC or ChIP arms) entered the catalog because the title or text mentioned single cells. A missing cell barcode is the correct result for them. They should leave the catalog, not wait in a failure bucket.
2. **Genuine single-cell with the barcode read really absent.** Examples GSE336563 and GSE275249 deposit two 150 bp reads. Read 1 has 11 to 14% distinct 16-mers, which is a cDNA read, not a barcode. Not recoverable from SRA; the authors would need to supply the barcodes.
3. **BAM deposits.** 5 of 70 sampled are submitted as BAM with barcodes in `CB`/`UB` tags. ENA lists these under `submitted_ftp`. They are recoverable by streaming the BAM, which the pipeline does not do for this bucket.
4. **False positives.** GSE319373 has a 28 bp read 1 and 90 bp read 2 (a 10x v3 layout). Read 2 has 0.99 repeated 16-mers, but read 1 is short because the dump already holds barcode+UMI. The whitelist test fails on both orientations, so a normal 10x run is rejected. This needs a check of read-1 structure before declaring "stripped".

Sizing: the 70-sample sample suggests the bulk of the bucket is (1), with (2) a minority and (3) and (4) small but cheap to recover. Counts over the full 6,227 should be produced by the classifier below, not extrapolated.

## 5. What a visitor can already see that undermines trust

- OG image and tagline: "Every public scRNA-seq study on GEO, reprocessed the same way". 107k samples were never queued, 6k are barcode-stripped, and bundles come from more than one release.
- Counts that disagree between tables: GSE297097 has `n_total` 429 in `gse` and 186 in `gse_meta`; GSE114725 `n_cells` 2,333 vs 1,503; GSE245517 `n_cells` 0, 8 and 4,537 in three places.
- "Processed 2026-06-17" is a bulk import date for nearly every sample, so it does not tell a visitor when anything was run.
- "Smart-seq / plate-based" on GSE206741, which is sci-Plex (combinatorial indexing), and "GENES / CELL —" blank for the whole study.
- "(catalog)" cell counts sit next to file counts without saying which is which.
- Study pages say "96 processed" while the file does not exist.
- Studies of single-cell-per-GSM deposits (GSE152607: 4 of 7,452 queued) show tiny sample counts that look like truncation.

## 6. Recommendations

Pipeline
1. **GEO scope classifier** before queueing: use series type, library strategy, platform and sample text to separate scRNA, bulk, multi-omic and per-cell-GSM deposits, and write `scope` to D1. Removes bucket 4.1 and the 107k "missing" ambiguity.
2. **Barcode test v2**: look at read-1 length and repeated-16-mer rate before the whitelist match; accept 28 bp + 90 bp layouts (4.4).
3. **BAM streaming** from ENA `submitted_ftp` for 4.3.
4. **Retry queue** for runtime_fail, simpleaf_permit, download* and protocol_detect with the category and last attempt time in D1; treat the 511 uncategorised FAILs as a defect.
5. **Rebuild queue** for the publish gap (section 2) and a nightly reconcile of `gse`, `gse_meta`, `bundle_manifest`.
6. Record the real run date and release per sample instead of the import date.

Site
1. Per-study completeness line: `queued / GEO total`, `done`, `in file`, `passed QC`, with the reason for each missing slice (not processable, failed, pending, removed for QC).
2. Hide "File not built yet" studies from default searches or label them "processed, file pending".
3. One source for sample and cell counts; mark catalog numbers as catalog.
4. Soften the OG image and tagline to what the headline numbers can support.
5. Add `scope` and `exclusion_reason` to the API and MCP so agents can tell "excluded on purpose" from "not done yet".

## 7. Follow-up findings

**Scope triage of the barcode-stripped studies.** `scripts/data-audit/scope.mjs` reads each series title and abstract. Over the 678 studies with a barcode-stripped sample (536 have no processed sample at all):

| Text verdict | Studies |
|---|---|
| single-cell wording, no other assay | 462 |
| single-cell wording plus bulk/ATAC/ChIP wording | 57 |
| no single-cell wording | 139 |
| SuperSeries with no single-cell wording | 20 |

216 studies (32%) need a scope review before any more compute is spent on them. This is a text heuristic: some of the 139 are single-cell studies with uninformative abstracts, so the verdict means "review", not "remove". The protocol and assay labels already in D1 cannot settle it (525 studies are "Unknown", and the 10x labels are a cataloguer's guess, not evidence).

**runtime_fail is mostly an incident, not a data problem.** 1,427 of the 1,725 rows were last attempted on 2026-06-09 to 2026-06-11 (868 of them on 06-10), and 719 carry `attempts=4`. The stored detail is only the attempt count and a timestamp. These are retry candidates, and the missing root cause is itself a defect.

**simpleaf_permit** is not a whitelist mismatch in the logs: 1,044 of 1,047 are `alevin-fry generate-permit-list` exiting non-zero. The site words it as "barcode whitelist mismatch". Until a log pass confirms the cause, the wording should say "barcode filtering step failed".

**Uncategorised failures.** 548 FAIL/HARD_FAIL rows (511 + 37) have no category and no detail at all.

## 8. Status

Done in [singlet-website PR 28](https://github.com/zdebruine/singlet-website/pull/28) (site-side, no cluster needed):
- per-study completeness on `/api/gse/:id`, MCP `get_study` and the study page, with a per-sample exclusion reason
- study counts taken from the sample rows instead of the stored counters
- "File pending" wording, and README and MCP coverage copy that no longer claims every study
- the scope triage script above, and a smoke check for the completeness field

Not done, with the reason:
- OG image tagline: re-rendering needs IBM Plex, and the browser pane could not reach a local render page.
- Barcode test v2, BAM streaming, retry queue, rebuild queue, real run dates: these run on the cluster (pipeline repo).
- Scope classifier on the GEO series record (series type, library strategy): needs GEO fetches at scale; the text triage above is the stand-in.
- Reconciling the stored `gse`, `gse_meta` and `bundle_manifest` counters in D1: the API now derives its numbers from sample rows, but the stored columns still drift.
- Changing the "barcode whitelist mismatch" wording in `FAILURE_WORDS` (simpleaf_permit) pending a log pass.

## 9. Open items

- Run the series-record classifier over the 216 flagged studies and over the 6,227 barcode-stripped samples to size each of the four causes in section 4.
- Pull the real error for runtime_fail and the 548 uncategorised rows from the cluster logs.
- Decide how to count per-cell-GSM studies (GSE152607 class) in `n_gsm_total`.
