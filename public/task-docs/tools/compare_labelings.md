---
id: engine.compare_labelings
title: Compare two labelings
tool: singlet_compare_labelings
task_id: evaluation.cluster_validity_indices
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Compare two labelings

> Agreement between two stored label arrays: ARI, the contingency of the largest groups and per-cluster purity. Use it to compare clusterings, or a clustering with planted truth.

Tool name `singlet_compare_labelings`. Implements the catalogue task [evaluation.cluster_validity_indices](/tasks/evaluation/cluster_validity_indices). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `key_a` | string | "clusters/louvain" | First label array key. |
| `key_b` | string | "truth/labels" | Second label array key. |

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
  "name": "singlet_compare_labelings",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

compare_labelings loads two stored label arrays for the same cells and builds a contingency table of group counts with NumPy. It reports the adjusted Rand index from pair counts, the cell-weighted purity of the first labelling against the second, and the purity of each of the twelve largest groups. The heatmap shows row-normalised overlaps for those twelve groups. No C++ kernel is involved. The ARI function is in python/singlet_engine/core.py, and the table, purity and heatmap are in python/singlet_engine/tools.py. The output is a figure and a metrics table.

## When to use it

- Use it to compare a clustering with planted truth from simulate_dataset, or two stored clusterings with each other.
- Use the per-group purity values to see which clusters mix groups of the other labelling.
- Use scan_resolution instead when the question is which resolution to choose rather than how two labellings agree.

## Measured performance and accuracy

No measurement of compare_labelings is in results/engine_benchmarks.json or pilot/results, so its agreement values have not been checked on a labelling with a known answer, and a simulate_dataset run that compares cluster output with truth/labels would measure that.

## Pitfalls

- Purity is asymmetric, since each group of the first labelling is scored by its largest overlap, so swapping keys changes it.
- The contingency table is dense with one cell per pair of groups, so labellings with thousands of groups allocate large arrays.
- The two arrays are not checked for equal length, so the cells must be stored in the same order and number.
- ARI is set to 1.0 when its denominator is zero, which happens for trivial labellings such as two single-group labellings.

## What to do with the result

- Use plot_scatter with color_by set to one labelling to see mixed groups in the embedding.
- If the agreement is low, rerun cluster at another resolution, or use scan_resolution to compare resolutions.
- Use report to add the comparison to the dataset report, since this step is recorded in the run history.
