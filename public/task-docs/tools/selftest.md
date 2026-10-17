---
id: engine.selftest
title: Engine self-test and timing
tool: singlet_selftest
task_id: harmonization.object_integrity_checks
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Engine self-test and timing

> Run correctness checks against NumPy references and short timings on a small simulated dataset (a few seconds). Run it after building on a new machine or cluster node, before trusting large runs.

Tool name `singlet_selftest`. Implements the catalogue task [harmonization.object_integrity_checks](/tasks/harmonization/object_integrity_checks). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `n_cells` | integer | 6000 | Cells in the test dataset. |

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
  "name": "singlet_selftest",
  "arguments": {}
}
```

## How it works

selftest checks the compiled kernels against NumPy on a small simulated matrix, and reports the time of each check. It does not use the workspace and never logs a step. The tool in tools.py generates 400 genes with core.generate and tests five things: PCA singular values against an exact eigendecomposition, per-cell totals from qc_stats against raw sums, exact kNN recall on sampled queries, NMF loss that does not rise between iterations, and GSEA finding a planted top-ranked set. The kernels are reached through core.py, which wraps the C++ files in src/: gen.cpp, pca.cpp, stats.cpp, knn.cpp, nmf.cpp and gsea.cpp. The result is ok only when every check passes.

## When to use it

- Run it once after building on a new machine or cluster node, as the tool description advises.
- Run it after changing the build flags, such as ARCH in the Makefile, before trusting a large run.

## Measured performance and accuracy

No number for this tool appears in results/engine_benchmarks.json, and tests/test_tools.py only asserts that the self-test returns status ok.

## Pitfalls

- Only n_cells can be changed. The 400 genes, six types and 2,048 cells per block are fixed, so a pass says little about larger gene panels.
- The test matrix is written to a new temporary directory that the tool never removes, so every run leaves files behind.
- A failed run returns status error, and the summary does not name the failing check, so read metrics.checks.

## What to do with the result

- If all checks pass, start with `import_matrix` on the real data.
- If a check fails, run `engine_status` to confirm the library build, CPU features and workspace.
