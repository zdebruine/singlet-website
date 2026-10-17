---
id: engine.report
title: Assemble an analysis report
tool: singlet_report
task_id: evaluation.cluster_validity_indices
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Assemble an analysis report

> Build a single HTML or Markdown report from the recorded steps of a dataset: every summary, metric table and figure, in order. Returns the file path.

Tool name `singlet_report`. Implements the catalogue task [evaluation.cluster_validity_indices](/tasks/evaluation/cluster_validity_indices). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `format` | string | "html" | Output format. One of: html, md. |
| `path` | string | — | Output path (default inside the workspace). |

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
  "name": "singlet_report",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

report builds one HTML or Markdown file from the logged steps of a dataset. It writes a heading and a line with the cell and gene counts, then for each step a heading with the tool name, the summary, a table of metrics and the SVG figures that still exist on disk. The Report class in report.py does the rendering. The file goes to the workspace root unless a path is given, and the tool returns that path. It reads the step log and the saved figures, and writes only the report file, which is not added to the log.

## When to use it

- Use it at the end of an analysis to hand over one file with every summary and figure.
- Use the md format when the text will be edited in a document.
- Use it again after more steps run, since it reads the log at the time of the call.

## Measured performance and accuracy

No timing figure for this tool appears in the benchmark results, and tests/test_tools.py only checks that the end-to-end run writes the report file.

## Pitfalls

- Each step shows at most 25 metric rows, and skips any list or dictionary whose JSON text is 160 characters or longer.
- Metrics whose JSON is over 20,000 characters are not logged at all, so that step appears with its summary only.
- A figure whose SVG file was deleted or moved is skipped without a message.
- A second run with the same output path overwrites the earlier file.

## What to do with the result

- If a figure is missing from the file, rerun `plot_scatter` or `plot_histogram` to write it again, then run `report`.
- Run `provenance` to check the step list before the report is shared.
