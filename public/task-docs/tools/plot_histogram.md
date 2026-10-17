---
id: engine.plot_histogram
title: Histogram of a stored array
tool: singlet_plot_histogram
task_id: qc.low_quality_cell_detection
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Histogram of a stored array

> Histogram of a stored array or column with quantiles and optional vertical threshold lines.

Tool name `singlet_plot_histogram`. Implements the catalogue task [qc.low_quality_cell_detection](/tasks/qc/low_quality_cell_detection). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `key` | string | "qc/total" | Array key, optionally with a column index. |
| `bins` | integer | 40 | Bins. |
| `log_y` | boolean | false | Log counts axis. |
| `thresholds` | array | — | Vertical lines at these x values. |

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
  "name": "singlet_plot_histogram",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

plot_histogram draws a histogram of one stored array, or of one column of a two-dimensional array, with optional dashed lines at given threshold values. The tool in tools.py reads the key from the named dataset, flattens the values and passes them to hist in viz.py. Non-finite values are excluded and counted in the statistics. The statistics also give the mean, median, extremes, selected quantiles from the 1st to the 99th percentile, the most populated bin, and how many values fall at or below each threshold. The SVG is saved in the workspace figures folder, and the call is logged as a step. The tool writes no arrays.

## When to use it

- Use it to choose a QC cutoff on `qc/total` or `qc/ngenes`, passing candidate values as thresholds.
- Use it on one component, such as `pca/scores[0]`, to see the spread of a score.
- Use `plot_scatter` instead when two arrays need comparing.

## Measured performance and accuracy

No timing or accuracy figure for this tool appears in results/engine_benchmarks.json, and tests/test_tools.py only asserts that a call on qc/total with a threshold returns status ok.

## Pitfalls

- A two-dimensional array with no column index is flattened, so all components or genes are pooled into one histogram.
- A threshold that is not finite is dropped without a message.
- Bad input, such as an array with no finite values, returns a placeholder SVG with status ok.
- Thresholds only draw lines. No cells are removed or flagged.

## What to do with the result

- A cutoff chosen here is not applied by any tool, so run `qc_summary` to compare it with the engine's MAD-based pass flags.
- Run `report` to keep the histogram and its threshold counts in the dataset's report.
- If the values look wrong, run `inspect_artifact` on the same key first.
