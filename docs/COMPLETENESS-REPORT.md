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

## 7. Open items

- Run the classifier over the full 6,227 barcode-stripped samples to size each of the four causes.
- Read per-sample `provenance.json` for a sample of runtime_fail and uncategorised FAIL rows; the registry names the categories but not the root causes.
- Decide how to count per-cell-GSM studies (GSE152607 class) in `n_gsm_total`.
