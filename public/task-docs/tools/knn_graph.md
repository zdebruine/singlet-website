---
id: engine.knn_graph
title: k-nearest-neighbour graph
tool: singlet_knn_graph
task_id: neighbors.approximate_knn_search
status: prototype
runtime: local-cpu streaming kernels
reads: [pca/scores]
writes: [knn/idx, knn/dist]
---

# k-nearest-neighbour graph

> Neighbour graph on PCA scores. Exact blocked search up to a size limit, grouped IVF above it, always with a recall check against exact search on a random sample of cells.

Tool name `singlet_knn_graph`. Implements the catalogue task [neighbors.approximate_knn_search](/tasks/neighbors/approximate_knn_search). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `k` | integer | 15 | Neighbours per cell. |
| `n_pcs` | integer | — | Leading components to use; default all computed. |
| `method` | string | "auto" | Search method. One of: auto, exact, ivf. |
| `nprobe` | integer | 4 | IVF lists per query group (recall knob). |
| `recall_sample` | integer | 500 | Cells used for the exact recall check. |
| `exact_limit` | integer | 150000 | Largest n for which auto picks exact search. |
| `cosine` | boolean | false | Use cosine distance (normalise rows). |

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
  "name": "singlet_knn_graph",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

knn_graph reads the stored PCA scores, keeps the first n_pcs columns and casts them to float32. With cosine set, each row is normalised first. Below exact_limit cells, which defaults to 150000, or when method is exact, the blocked kernel in src/knn.cpp scores every query against every cell and keeps the top k per query by squared Euclidean distance. Above the limit it builds an IVF-flat index with about two times the square root of n k-means lists, as set in python/singlet_engine/core.py. Queries are grouped by nearest list, and each group scans the union of its lists with the same kernel. A fixed sample of 500 cells is then checked against exact search. The stored state is knn/idx and knn/dist.

## When to use it

- Run it after pca, since it reads pca/scores, and before cluster, scan_resolution or embed_umap, which read the graph it stores.
- Leave method on auto unless exact recall is required, because exact search cost grows with the square of the cell count.
- Use standard_workflow for a first pass on a new dataset, and this tool when k, n_pcs or nprobe need tuning.

## Measured performance and accuracy

From results/engine_benchmarks.json, on a 4 CPU machine with 300000 cells and 50 dimensions, exact search of 2000 queries took 0.266 s, and the file estimates 39.9 s for all cells. Grouped IVF at nprobe 4, the tool default, searched all cells in 3.42 s with recall 0.9873. At nprobe 6 it reached recall 0.9936 in 3.83 s.

From pilot/results/knn_2m.json, on 2000000 cells and 50 dimensions with k 15, exact search ran at 211 GFLOP/s, took 4.73 s for 5000 queries, and is estimated at 1893 s for all cells. The machine was the 4 CPU pilot described in pilot/AUDIT_HANDOFF.md section 2.2, where the IVF index had 2828 lists. Recall against exact search was 0.771, 0.912, 0.984 and 0.999 at 5, 10, 20 and 40 probes. A full 20-probe IVF run took 193.3 s and 1369 MB resident memory.

From pilot/results/knn.jsonl, on 200000 cells and 20000 queries, exact search took 3.06 s at recall 0.99999 with the first kernel, which pilot/AUDIT_HANDOFF.md section 2.2 reports at 131 GFLOP/s. IVF over 894 lists took 0.356 s at recall 0.9946 with 20 probes. pynndescent took 19.5 s to build and reached recall 0.935.

## Pitfalls

- Default nprobe 4 is below the 5-probe point at 2M cells, recall 0.771, so expect a recall warning and raise nprobe.
- knn/dist holds squared distances, not distances, and the layout code takes the square root itself.
- An n_pcs above the number of stored components silently uses all of them, because the slice does not raise an error.
- Exact search grows with cells squared: the file estimates 1893 s at 2M cells, against 193.3 s for the measured IVF run.

## What to do with the result

- Read the recall warning first, and if it fires, rerun with a higher nprobe, which overwrites knn/idx.
- After any change to the graph, rerun cluster and embed_umap, since earlier labels and embeddings are not recomputed.
- Continue with cluster, or scan_resolution when the resolution is unknown, and embed_umap for a 2-D view.
