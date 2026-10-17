---
id: engine.describe_dataset
title: Describe a dataset
tool: singlet_describe_dataset
task_id: harmonization.object_integrity_checks
status: prototype
runtime: local-cpu streaming kernels
reads: [counts]
writes: []
---

# Describe a dataset

> Cheap structural summary: size, block layout, density, estimated memory and time for the common steps, and the arrays already computed.

Tool name `singlet_describe_dataset`. Implements the catalogue task [harmonization.object_integrity_checks](/tasks/harmonization/object_integrity_checks). Status: prototype, CPU only.

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
  "name": "singlet_describe_dataset",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

This tool reads only the 40-byte header of the sblk file through `core.header` in python/singlet_engine/core.py. It calls no C++ kernel and reads no count data. From the file size it estimates the number of stored non-zeros, since each takes four bytes for a 16-bit gene index and a 16-bit count, after subtracting the header, the block directory and one index pointer per cell. It reports the shape, the block count, the density, the file size in gigabytes and the gigabytes that one PCA pass reads. It also lists the arrays and step names already recorded for the dataset.

## When to use it

- Use it right after loading to check size and density before starting a long pass, since it costs one small read.
- Use qc_summary when you need per-cell numbers, because this tool reports only file-level figures.

## Measured performance and accuracy

No results file times this tool, and it reads only a header, so there is no measured figure. A useful check would compare its non-zero estimate with the sum of genes detected per cell from qc_summary on a test dataset.

## Pitfalls

- The non-zero estimate subtracts one index pointer per cell but not one per block, so it reads slightly high by about one count per block.
- The tool description promises estimated memory and time, but the code reports only gigabytes read per PCA pass.
- `core.header` does not check the magic bytes, so a file that is not sblk gives wrong sizes without an error.

## What to do with the result

- Run qc_summary next, as the next hint says.
- Use inspect_artifact on any listed array before relying on it, since this tool shows only names and steps.
