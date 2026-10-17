# Data audit

`scripts/data-audit/` looks for oddities in the production catalog without anyone writing a rule for each one.
It runs 52 read-only SQL checks (`checks.mjs`) and three statistical checks over every usable sample
(`stats.mjs`: duplicated metric fingerprints, samples far below their study's peers, implausible reads per cell).

```bash
node scripts/data-audit/audit.mjs            # needs a wrangler login with D1 access; about 4 minutes
```

It writes `scripts/data-audit/out/audit.md` (ranked table, then examples per check) and `audit.json`.
Rank is severity x log10(hits in downloadable data). Severity 5 means the values cannot be true, 1 means
worth a look. Add a check by appending to `CHECKS`; a check that errors is reported, not skipped.

First run: 2026-10-17, 55 checks, 39 with hits. Numbers below are from that run.

## Clean, which is itself a result

No sample has more genes than UMIs, a fraction outside 0..1, uniquely-mapped above total mapping, or exonic
plus intronic above 1. No study has a file without a key, a year out of range or a missing title. The 29
studies with a reference build of the wrong species are all already withheld from downloads
(`reference_mismatch`), so that guard works.

## Prioritised findings

Ordered by how suspicious the data is, then by reach. "Downloadable" means a visitor can get the sample.

### 1. Junk samples counted as usable (needs a decision)

| Check | Samples | Downloadable | Studies |
|---|---|---|---|
| median under 30 genes per cell (100+ cells) | 4,122 | 3,552 | 738 |
| under 20% of reads map | 5,635 | 4,883 | |
| 3 or fewer cells called | 2,066 | 1,955 | |
| far below their own study's peers (robust z < -4) | 1,261 | 1,261 | |

`usable` only needs a matrix over 400 bytes and one called cell, so a sample with a median of 1 gene and 0.2%
mapping (GSE108313, GSM2895283) is "usable" and counts toward the 59,628 headline. One-cell samples carry
10-17 MB matrices (all barcodes, no cell calling). Options: raise the bar (for example 50 cells and a median
of 30 genes), or keep the count and show a QC warning. Either changes the headline numbers.

### 2. Quality flags that contradict the metrics (fixed in the API; data decision pending)

All 22,782 non-null `gsm.qc_flag` values use the retired `gold/silver/bronze` vocabulary, every one from
pipeline v0.9.0. Migration `003_qc_flags.sql` was meant to replace them and has not run in production. The code
and types accept only `HEALTHY / WARN / LOW_QUALITY`. 445 samples (350 downloadable) are flagged
`gold` with a median under 30 genes per cell or under 20% mapping (GSE136035, GSE143417).
Fix shipped: the API now returns `qc_flag` only for the closed vocabulary. Proposed data change in
`schema/021_data_audit_fixes.sql` (not applied): set the legacy values to NULL rather than mapping gold to
HEALTHY, since the evidence says the old verdicts are not reliable.

### 3. Chemistry disagrees between catalog and file

22,150 samples (17,855 downloadable) name different chemistries after folding aliases, mostly catalog `10xv3`
against file `10xv2` (6,826) and catalog `10xv3_5prime` against file `10xv2` (5,304). Another 5,304 samples
have a catalog guess (`10x_suspect`, assay "10x (version unconfirmed)") that the file resolves to a specific
version. Which side is right is a pipeline question; the site shows the catalog value.

### 4. Empty droplets called as cells

21 samples report 1.73 million cells with a median of 1-2 UMIs (15 studies); GSE225158 / GSM7040229 alone has
989,610 cells. 33 samples have under 50 input reads per called cell. These inflate "cells in files" (266.8
million usable cells overall, so about 0.7%).

### 5. Modality labels (fixed at display)

4,720 samples are labelled `plate_scrna` although the assay is droplet 10x, Drop-seq, Rhapsody or CITE-seq; the
label came from the unconfirmed `10x_suspect` protocol. Modality is also stored with mixed case
(`scrna` 21,033, `scRNA` 12,157). The API now returns one spelling and never a plate label on a droplet assay.

### 6. Dead QC columns

`sequencing_saturation` and `median_mito_fraction` are 0 in all 70,986 `sample_qc` rows, so the fields are
not being filled. `gsm.mt_pct` exists separately. The file's own QC reports should be the source.

### 7. Duplicated data across studies

388 groups (785 samples) share identical cells, genes, UMIs, mapping rate and input reads across different
GSMs, usually different GSEs: the same raw data deposited more than once, for example GSM6031815, GSM6160664
and GSM8447648. About 1.39 million cells are counted more than once.

### 8. Catalog and file disagree on size

1,212 studies (1,109 downloadable) have a different number of processed samples in the catalog than in the file
(GSE100384: 6 vs 4; GSE106121: 14 vs 5), so those files are older than the catalog. 1,011 samples and 299
studies differ by more than 5x in cells because the catalog count is stale (catalog 1, file 1,627 for
GSM4502451). 389 studies have different byte sizes in `gse` and `bundle_manifest`. 701 samples are marked
failed in the catalog yet have called cells in the file.

### 9. Organism names (root cause fixed; data decision pending)

14 studies have organism `Mus` and 2 have `Homo`, 3 are "Homo sapiens/Mus musculus xenograft" and 4 are influenza
strains. Cause: the normaliser took only the first `;` part of the field, so "Homo; Homo sapiens" became "Homo",
and a bare genus stayed a genus. Fixed in `normOrganism`; existing rows are corrected by `schema/021`.
Also 23 studies whose samples disagree on organism (for example GSE103574: mouse and human).

### 10. Lower priority

49 `sample_qc` rows have no sample; 11,530 samples are DONE with 0 catalog cells (6,987 have no QC row);
440 downloadable studies have no abstract; 606 downloadable studies have tissue group "Other" only; 880 samples have assay
"Unknown" despite a recorded protocol; 297 abstracts are shared by more than one study; 3 studies have a
different sample total in `gse` and `gse_meta`.

## What changed in code

- `normOrganism` (`catalog-refresh.ts`) and genus-only aliases (`vocab.ts`), with tests.
- `functions/_shared/data-quality.ts`: `sanitizeQcFlag` and `normalizeModality`, used by the study, sample and
  sample-list endpoints.
- The cohort name is asked in a dialog instead of a browser prompt.
