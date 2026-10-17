---
id: engine.choose_n_pcs
title: Choose the number of PCs
tool: singlet_choose_n_pcs
task_id: dim-reduction.pc_number_selection
status: prototype
runtime: local-cpu streaming kernels
reads: [pca/sv]
writes: []
---

# Choose the number of PCs

> Recommend how many principal components to keep from the spectrum: elbow, cumulative variance and a random-matrix noise edge, with the evidence for each.

Tool name `singlet_choose_n_pcs`. Implements the catalogue task [dim-reduction.pc_number_selection](/tasks/dim-reduction/pc_number_selection). Status: prototype, CPU only.

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
  "name": "singlet_choose_n_pcs",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

choose_n_pcs squares the singular values stored by pca into eigenvalues and reports three candidate counts. The elbow is the position of the largest second difference, the gap is the position of the largest ratio between neighbouring eigenvalues, and the noise count is the number of eigenvalues above a random-matrix noise edge. The noise level is the median of the trailing half of the computed eigenvalues, and the edge is that level times the square of one plus the square root of the gene count over the cell count. The recommendation is the noise count, floored at 2 and capped at the number of computed components. The arithmetic is NumPy in the tool function in python/singlet_engine/tools.py, with no C++ kernel. Only the stored spectrum and array shapes are read, not the cell data.

## When to use it

- Use it after pca and before knn_graph when the number of components is not set by the study design.
- Read the elbow and gap values beside the recommendation, since the recommendation rests on one rule.
- Use scan_resolution to choose a clustering resolution, because this tool does not address that question.

## Measured performance and accuracy

No measurement of choose_n_pcs is in results/engine_benchmarks.json or pilot/results, so its count has not been checked against a known rank, and a simulate_dataset run with a known rank, compared with the recommended count, would measure it.

## Pitfalls

- The noise level uses only the computed eigenvalues, so with few computed components the median can fall inside the signal.
- The warning appears only when every computed component passes the noise edge, and the count never exceeds the number computed.
- If no eigenvalue passes the edge the result is 2, so a flat spectrum reads as a two-component dataset.

## What to do with the result

- Pass the recommended count to knn_graph as n_pcs, which reads the stored pca/scores.
- If the recommendation equals the number of computed components, rerun pca with more components first.
