---
id: engine.embed_umap
title: 2-D embedding (UMAP-class)
tool: singlet_embed_umap
task_id: embedding-viz.large_scale_embedding
status: prototype
runtime: local-cpu streaming kernels
reads: [knn/idx, knn/dist, pca/scores]
writes: [embedding/umap]
---

# 2-D embedding (UMAP-class)

> Fuzzy-graph layout optimised by multithreaded SGD, initialised from scaled PCA scores. Reports how well 2-D neighbours match the high-dimensional graph.

Tool name `singlet_embed_umap`. Implements the catalogue task [embedding-viz.large_scale_embedding](/tasks/embedding-viz/large_scale_embedding). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `epochs` | integer | — | Optimisation epochs; default 200 below 100k cells and 100 above. |
| `min_dist` | number | 0.1 | Minimum distance in the embedding. |
| `neg_rate` | integer | 5 | Negative samples per edge. |
| `seed` | integer | 0 | Random seed. |
| `color_by` | string | "clusters/louvain" | Array key used to colour the plot. |

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
  "name": "singlet_embed_umap",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

embed_umap builds a fuzzy neighbour graph from the stored knn/idx and knn/dist, using the code in src/layout.cpp. For each cell it searches a bandwidth so the membership strengths sum to log2 of k, then merges the two edge directions with a fuzzy union. The start is the first two stored PCA scores, standardised and multiplied by 3, or random positions in plus or minus 10 when no scores exist. Hogwild SGD then runs over the edges for the epoch count, with negative sampling, gradients clipped at plus or minus 4, and a learning rate that falls linearly. The curve constants a and b come from python/singlet_engine/core.py. The result is stored as embedding/umap.

## When to use it

- Use it after knn_graph for a 2-D picture of the same graph that cluster reads.
- Skip it when only labels are needed, since clustering does not use the embedding.
- Use plot_scatter to draw other stored pairs, and report to write a summary with the figures.

## Measured performance and accuracy

From results/engine_benchmarks.json, on a 4 CPU machine with 100000 cells and 100 epochs, the layout took 3.6 s. No results file records neighbour preservation or any other accuracy figure for the layout. The tool prints a preservation figure on each run, so recording it on a 100000 cell benchmark would supply the missing accuracy number.

## Pitfalls

- Epochs default to 200 below 100000 cells and 100 above, so the largest runs get the fewest passes.
- Hogwild updates race and each thread seeds its own random stream from its id, so the output can change with the thread count.
- core.umap_ab fixes the spread at 1.0, so min_dist is the only control over the kernel curve.
- Without pca/scores the start is random, not PCA based.

## What to do with the result

- Plot it with plot_scatter using embedding/umap[0] and embedding/umap[1], coloured by the cluster key.
- If the figure looks empty, check the shape and finite fraction with inspect_artifact on embedding/umap.
- Run report to assemble the embedding with the other steps into one document.
