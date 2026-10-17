---
id: engine.engine_status
title: Engine status
tool: singlet_engine_status
task_id: harmonization.object_integrity_checks
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Engine status

> Report the engine build, CPU features, thread count, workspace location and the datasets it holds. Call this first to check the environment.

Tool name `singlet_engine_status`. Implements the catalogue task [harmonization.object_integrity_checks](/tasks/harmonization/object_integrity_checks). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| none | | | |

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
  "name": "singlet_engine_status",
  "arguments": {}
}
```

## How it works

This tool calls `core.lib` in python/singlet_engine/core.py, which loads the shared library built from the C++ files in src/ and binds its entry points. It then reads the CPU flags from /proc/cpuinfo and checks five instruction-set names. The report carries the CPU count, the OpenMP thread count taken from the OMP_NUM_THREADS variable, the Python version, the workspace path and the dataset names. Nothing is streamed, no array is read, and no kernel runs. The only C++ contact is the library load, which fails with a build hint if the shared object is missing.

## When to use it

- Call it first in a new session to confirm that the library loads and to see which datasets already exist.
- Call selftest instead when you need correctness checks on a new build, because this tool only confirms that the library loads.

## Measured performance and accuracy

No results file times this tool, so there is no measured figure. A useful measurement would be the time of the first library load on a fresh node.

## Pitfalls

- The thread count is read from OMP_NUM_THREADS or the host CPU count, not queried from OpenMP, so it can exceed the cores a container allows.
- The default build uses -march=native, but this tool lists only the current host flags, not the flags the library was built with.
- CPU features come from /proc/cpuinfo, so where that file is missing the list reads unknown.

## What to do with the result

- If no datasets are listed, create one with simulate_dataset for testing, or with import_matrix for real counts.
- After building on a new machine, run selftest before trusting any large run.
