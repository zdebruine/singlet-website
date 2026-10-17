---
id: engine.qc_summary
title: Per-cell QC and gene statistics
tool: singlet_qc_summary
task_id: qc.low_quality_cell_detection
status: prototype
runtime: local-cpu streaming kernels
reads: [counts]
writes: [qc/total, qc/ngenes, qc/pct_mito, qc/pass, stats/*]
---

# Per-cell QC and gene statistics

> One streaming pass: total counts, detected genes and percent counts in flagged (mitochondrial) genes per cell, plus per-gene moments. Reports quantiles, MAD-based outlier counts and histograms; stores per-cell arrays.

Tool name `singlet_qc_summary`. Implements the catalogue task [qc.low_quality_cell_detection](/tasks/qc/low_quality_cell_detection). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `mito_prefix` | string | "MT-" | Gene-name prefix that marks mitochondrial genes (case-insensitive). |
| `mad_k` | number | 5.0 | Outlier threshold in MADs. |

## Returns

Every tool returns the same envelope.

| Field | Meaning |
|---|---|
| `status` | `ok` or `error`. Errors carry a `hint`. |
| `summary` | One or two plain sentences with the result and the numbers that matter. |
| `metrics` | Structured results: counts, quantiles, tables, timings of passes, convergence information. |
| `figures` | SVG files in the workspace, each with a text `description` and summary statistics. |
| `artifacts` | Arrays written to the workspace by key (shape, dtype, file); later tools refer to them by key. |
| `warnings` | Conditions that may invalidate the result, such as non-convergence or low recall. |
| `next` | Suggested follow-up tools. |
| `timings` | Seconds per stage and throughput. |

## Example

```json
{
  "name": "singlet_qc_summary",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

This tool makes one streaming pass over the sblk blocks through the C++ function sp_qc_stats in src/stats.cpp. The reader in src/sblk.hpp reads the next block in a background thread while the current block is processed. For each cell the kernel sums the counts, counts the detected genes and sums the counts in flagged genes, which are the genes whose names start with the mitochondrial prefix. For each gene it accumulates count sums and moments of the normalised values and of their log1p. OpenMP threads keep private gene vectors that are merged at the end. Python then flags cells whose totals are too low or too high, whose gene count is too low, or whose mitochondrial share is too high, using median and MAD thresholds.

## When to use it

- Use it before select_hvg, since the gene moments it stores are what that step reads.
- Use plot_histogram on qc/total or qc/pct_mito with thresholds to inspect the cut-offs, because the flags follow one MAD rule.

## Measured performance and accuracy

results/engine_benchmarks.json records qc_stats_pass_s as 0.131 seconds for one pass of the kernel that qc_summary calls, on a 4 CPU machine running Python 3.13.16. The file does not give the dataset size for this figure, and it has no timing for the Python MAD and histogram steps.

## Pitfalls

- When most cells share one value, the MAD is near zero, so cells on either side of that value can be flagged.
- qc/pass is written, but no tool in the registry reads it, so select_hvg, pca and nmf_programs still use every cell.
- Without a gene name file, genes are named G0 onward, so no gene is flagged as mitochondrial and the percentage is skipped with a warning.

## What to do with the result

- Run select_hvg next, as the hint says. It runs qc_summary itself only when the gene moments are missing.
- Inspect qc/total and qc/pct_mito with plot_histogram and thresholds before deciding whether the flags suit the data.
