---
id: engine.scan_resolution
title: Scan clustering resolutions
tool: singlet_scan_resolution
task_id: clustering.resolution_selection
status: prototype
runtime: local-cpu streaming kernels
reads: [knn/idx]
writes: []
---

# Scan clustering resolutions

> Run Louvain over a list of resolutions with two seeds each and report the number of clusters, modularity and seed-to-seed stability (ARI), so the resolution can be chosen from evidence rather than by default.

Tool name `singlet_scan_resolution`. Implements the catalogue task [clustering.resolution_selection](/tasks/clustering/resolution_selection). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `resolutions` | array | — | Resolutions to try. |
| `mode` | string | "snn" | Edge weights. One of: snn, knn. |

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
  "name": "singlet_scan_resolution",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

scan_resolution runs core.louvain on the stored knn/idx for each value in the resolutions list, which defaults to 0.05, 0.1, 0.2, 0.5, 1.0 and 2.0. Each value is run twice, with seeds 0 and 1, using the C++ code in src/graph.cpp. For each value it records the cluster count, the modularity and the ARI between the two seed runs, plus the ARI against truth/labels when that array exists. The ARI function is in python/singlet_engine/core.py. The reported best row is the one with the highest seed ARI, and a single-cluster row never counts. Nothing is written to the workspace, and the result includes a plot of seed ARI and modularity against resolution.

## When to use it

- Use it when no resolution is known, and read its table before running cluster.
- Skip it when a resolution is already chosen, because the default scan runs twelve Louvain passes, six values with two seeds each.
- Use compare_labelings to compare two stored labelings, since this tool compares seeds and not labelings.

## Measured performance and accuracy

No results file measures scan_resolution. The benchmark file results/engine_benchmarks.json has no entry for it, and no file records seed stability on any dataset. Timing it on a 300000 cell graph, like the one behind the Louvain entry in that file, over the six default resolutions would measure the cost of its twelve Louvain runs.

## Pitfalls

- The tool's summary notes that stability alone favours coarse partitions, so read the top row with modularity and the expected cluster count.
- Only two seeds are compared, so a resolution can look stable and still be the wrong scale.
- Nothing is stored, so the chosen resolution has to be passed to cluster explicitly.
- The default grid stops at 2.0, so finer partitions need an explicit resolutions list.

## What to do with the result

- Run cluster with the chosen resolution and the same mode.
- If the best row has very few clusters, rerun with a finer list near the cluster count you expect, then check the cluster sizes.
