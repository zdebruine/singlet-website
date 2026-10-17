---
id: engine.provenance
title: Run history of a dataset
tool: singlet_provenance
task_id: harmonization.object_integrity_checks
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Run history of a dataset

> Chronological list of the tools run on a dataset with parameters, key metrics and timings, for auditing and reproducing an analysis.

Tool name `singlet_provenance`. Implements the catalogue task [harmonization.object_integrity_checks](/tasks/harmonization/object_integrity_checks). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |

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
  "name": "singlet_provenance",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

provenance returns the run history of one dataset in the order the steps ran. Each entry holds the step number, tool name, parameters, summary, timings and warnings, read from the step log that workspace.py keeps in datasets.json. The result also gives a total of the numeric timings across all steps. The tool reads the dataset record only and writes nothing. Steps are appended by run_tool in tools.py, which logs only calls that finished with status ok and skips a fixed list of tools, including provenance and report themselves. The output supports auditing and reproducing an analysis.

## When to use it

- Use it before writing up an analysis, to list every parameter that was used.
- Use it when a result differs from an earlier run, to see which steps ran and with which settings.
- Use it to find which completed steps raised warnings.

## Measured performance and accuracy

No timing figure for this tool appears in results/engine_benchmarks.json, and tests/test_tools.py only checks that the end-to-end run leaves at least 8 steps in the log.

## Pitfalls

- The total adds every numeric timing, including rate fields such as `cells_per_s` and `mb_per_s`, so it is not wall time.
- Calls that failed are not logged, so an errored step leaves no trace here.
- Running a step again appends another entry, with no de-duplication.

## What to do with the result

- Run `report` to turn the same history into a document with tables and figures.
- To reproduce the analysis, replay the recorded calls in order from `import_matrix` or `simulate_dataset`.
