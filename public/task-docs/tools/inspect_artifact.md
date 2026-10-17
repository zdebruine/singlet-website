---
id: engine.inspect_artifact
title: Inspect a stored array
tool: singlet_inspect_artifact
task_id: harmonization.object_integrity_checks
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Inspect a stored array

> Debug view of any stored array: shape, dtype, finite fraction, quantiles, a small head, and for label arrays the group counts. Use it to check an intermediate result before the next step.

Tool name `singlet_inspect_artifact`. Implements the catalogue task [harmonization.object_integrity_checks](/tasks/harmonization/object_integrity_checks). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `key` | string | — | Array key (omit to list all arrays). |
| `head` | integer | 5 | Rows shown from the start. |

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
  "name": "singlet_inspect_artifact",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

inspect_artifact is a debugging view of anything stored in a dataset. With no key it lists every stored array with its shape, dtype and note, which workspace.py keeps in datasets.json. With a key it memory maps the array and reports the shape, the dtype, the first rows, and for floating point data the finite fraction, minimum, maximum and quantiles. Integer label arrays with at most 200 distinct values also get group counts. The statistics are computed from the first five million values only. The tool is defined in tools.py, reads through workspace.py, writes nothing, and is not logged as a step.

## When to use it

- Use it after any tool to check the shape and dtype of an intermediate array before the next step.
- Use it on a label array such as `clusters/louvain` to see the group sizes.
- Use it with no key to list the array names when a key lookup fails.

## Measured performance and accuracy

No timing or accuracy figure for this tool appears in results/engine_benchmarks.json, and tests/test_tools.py only asserts that a call on clusters/louvain returns status ok.

## Pitfalls

- Key syntax is literal, so `pca/scores[0]` is not a valid key and the call fails. Use `pca/scores` or `plot_histogram` with the column index.
- For arrays over five million values, the summary covers only the first values in row order, so quantiles describe the first cells.
- Group counts appear only for integer arrays, so label arrays stored as floats show none.

## What to do with the result

- If the shape is not what the next tool needs, rerun the tool that wrote the array, such as `pca` or `cluster`.
- Plot the array with `plot_histogram` or `plot_scatter` for a visual check.
