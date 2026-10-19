# Sample quality control

Every sample in a published `.singlet` file gets a QC tier from two measurements the pipeline made: the **median genes
detected per cell** (`sample_qc.median_genes`) and the **fraction of reads that map** (`sample_qc.mapping_rate`, 0 to 1).
The thresholds live in one place, `functions/_shared/qc-rules.ts`.

| Tier | Meaning | Rule | On the site |
|---|---|---|---|
| 0 | Passed | everything else | counted, searchable, downloadable |
| 1 | Low QC | median genes < 30 **or** mapping < 20% | flagged with the reason; left out of searches, counts and bulk downloads unless the user opts in |
| 2 | Removed | mapping < 5% **and** median genes < 10 | not listed, not counted, anywhere |

A sample with no measurements is never judged (tier 0). Low QC is the message "singlet's QC algorithms detected an issue with
this sample. It is recommended to proceed with caution." The site never calls these samples junk.

## Why these cut points

First audit run, 2026-10-17, 60,642 usable samples (`docs/DATA-AUDIT.md`):

- Median genes per cell has a spike at 1 gene or fewer (2,505 samples) and a thin tail to 30, apart from the working distribution
  (median 725 genes). Mapping rate is bimodal the same way: 3,650 samples under 5%, working samples near 82%.
- 72% of samples with few genes also map poorly, and 84% of poorly mapped samples have few genes: one failure, two symptoms.
- Median UMIs per cell: 4 in the failing group, 1,381 in the rest. Median input reads are the same (30 million), so it is not
  shallow sequencing, and 88% of failing samples have a working sibling in the same study.
- A third rule, fewer than 10 cells, was tested and dropped: those samples have healthy genes (median 756) and mapping (73%), and are
  small plate-based samples, not failures.
- The low-QC cut at 30 genes is far below the common 200-gene cell filter, which would flag more than twice as many samples.

## Where it is applied

- `sample_qc.qc_tier` (0, 1, 2), written by `applyUsable` in `catalog-refresh.ts` whenever a study's samples are (re)assessed.
- `gse_meta.n_usable_samples` and `n_usable_cells` count **tier 0 only**; `n_lowqc_samples` and `n_lowqc_cells` count tier 1.
  Everything keyed on `DOWNLOADABLE_SQL` (the headline, `/api/stats`, default searches, manifests, related studies) therefore leaves
  low-QC samples out without further code. A study with no passing sample is not downloadable by default.
- `include_low_qc=1` (`SearchFilters.include_low_qc`, the Browse toggle, the MCP `include_low_qc` argument) swaps in
  `downloadableSql(true)` and adds the tier-1 counts back. Tier 2 never counts. At sample level (`level=gsm`) tier-1 samples are listed
  only with the flag and tier-2 samples never.
- Study pages mark each tier-1 sample (`low_qc`, `qc_message`, `qc_reasons`) and hide tier-2 samples (`removed_samples` says how many).
- `/api/stats` returns `qc` (removed, low QC, studies affected, the rules) and the accounting has `in_files_removed` and `in_files_low_qc`.
- `get_sample_qc` returns `qc_status` (`ok`, `low_qc`, `removed`) and `qc_reasons` for every sample.

Samples stay in each study's `.singlet` file (one file per study); QC changes what the catalog counts and lists, not the file.

## Changing a threshold

1. Edit `qc-rules.ts` and bump `QC_RULES_VERSION`.
2. Update the numbers in `schema/022_low_qc.sql` (they are the same rule in SQL; `src/test/low-qc.test.ts` checks the two agree).
3. Re-run its step-3 statements against production, then check `/api/stats`.

`node scripts/data-audit/audit.mjs` re-measures the catalog.
