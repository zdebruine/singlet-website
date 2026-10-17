---
id: engine.cluster
title: Cluster cells (Louvain)
tool: singlet_cluster
task_id: clustering.cell_partitioning
status: prototype
runtime: local-cpu streaming kernels
reads: [knn/idx]
writes: [clusters/louvain]
---

# Cluster cells (Louvain)

> Louvain modularity clustering on the kNN graph (shared-nearest-neighbour or plain connectivity weights). Stores labels; reports sizes, modularity and agreement with truth labels if the dataset has them.

Tool name `singlet_cluster`. Implements the catalogue task [clustering.cell_partitioning](/tasks/clustering/cell_partitioning). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `resolution` | number | 1.0 | Resolution; higher gives more clusters. |
| `mode` | string | "snn" | Edge weights. One of: snn, knn. |
| `seed` | integer | 0 | Random seed. |
| `key` | string | "clusters/louvain" | Label array key to write. |

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
  "name": "singlet_cluster",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

cluster passes the stored knn/idx to core.louvain, which calls the C++ code in src/graph.cpp. Edge weights are either shared-nearest-neighbour overlap, a Jaccard score with edges under 1/15 dropped, or plain symmetrised connectivity in which mutual neighbours weigh 2. Louvain then runs local moving sweeps in a seeded random node order, at most 30 per level, and aggregates communities for at most 10 levels. The resolution is the modularity gamma. The C++ Louvain is single-threaded. Labels go to clusters/louvain unless another key is given, and ARI against truth/labels is reported when that array exists.

## When to use it

- Use it once the graph exists and the resolution is known, and run scan_resolution first when it is not.
- Keep snn for the first partition, and try knn only to check that the result does not depend on the Jaccard weights.
- Use compare_labelings to set this partition against truth or another key, and embed_umap to see it in 2-D.

## Measured performance and accuracy

From results/engine_benchmarks.json, on a 4 CPU machine with 300000 cells, Louvain returned 20 clusters at modularity 0.9705 in 7.33 s. The file does not record the graph source, the edge mode or the resolution, so the figure cannot be tied to a named dataset.

## Pitfalls

- The C++ Louvain in src/graph.cpp runs on one thread, so adding cores does not shorten this step.
- In snn mode, cells left with no edge after the 1/15 Jaccard cut stay as singleton clusters and fall under the tiny-cluster warning.
- Writing to another key leaves embed_umap's default color_by at clusters/louvain, so its plot is uncoloured unless color_by is passed.
- The seed changes the partition, so compare two seeds before trusting a result, as scan_resolution does.

## What to do with the result

- Check the tiny-cluster warning with inspect_artifact on the label array, and lower the resolution if many clusters are tiny.
- Run compare_labelings against planted truth or another key, one of the two next steps the tool lists.
- Run embed_umap with color_by set to this key to see the partition in 2-D.
