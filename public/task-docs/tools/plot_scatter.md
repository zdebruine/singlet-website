---
id: engine.plot_scatter
title: Scatter plot of two stored arrays
tool: singlet_plot_scatter
task_id: embedding-viz.global_structure_preservation
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Scatter plot of two stored arrays

> Scatter of two stored arrays or columns (for example 'embedding/umap[0]' vs 'embedding/umap[1]') coloured by a stored label array. Returns the SVG path and a text description with cluster centroids.

Tool name `singlet_plot_scatter`. Implements the catalogue task [embedding-viz.global_structure_preservation](/tasks/embedding-viz/global_structure_preservation). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `x` | string | "embedding/umap[0]" | Array key, optionally with a column index, e.g. pca/scores[0]. |
| `y` | string | "embedding/umap[1]" | Array key and column. |
| `color_by` | string | "clusters/louvain" | Label array key (optional). |
| `title` | string | — | Plot title. |
| `max_points` | integer | 20000 | Maximum points drawn (deterministic subsample). |
| `include_svg` | boolean | false | Also return the SVG text inline. |

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
  "name": "singlet_plot_scatter",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

plot_scatter draws one stored array against another as an SVG scatter plot, coloured by a stored label array. The x and y arguments are array keys with an optional column index, such as embedding/umap[0]. The tool in tools.py loads the arrays from the named dataset and passes them to scatter in viz.py. Counts and centroids use every finite point, while the drawing shows a seeded random subsample of at most max_points points. The figure is saved in the workspace figures folder, and the result returns its path, a text description and the statistics. The tool writes no arrays, and the call is logged as a step of the dataset.

## When to use it

- Use it to inspect an embedding after `embed_umap`, or a pair of principal components after `pca`.
- Use it to check whether the clusters from `cluster` separate visually.
- Use `plot_histogram` instead for a single one-dimensional array.

## Measured performance and accuracy

No timing or accuracy figure for this tool appears in results/engine_benchmarks.json, and tests/test_tools.py only asserts that a call on two PCA columns returns status ok.

## Pitfalls

- A column index on a one-dimensional array is ignored, so `clusters/louvain[1]` silently plots the whole array.
- A `color_by` key that is not stored is skipped without an error, and the plot is drawn in one colour.
- Bad input such as mismatched lengths returns a placeholder SVG with status ok, so read the description.
- Small groups can lose most of their points in the drawing, although their counts and centroids use all cells.

## What to do with the result

- If the figure is a placeholder, run `inspect_artifact` on both keys to check their lengths and shapes.
- Run `compare_labelings` to measure agreement between the colouring and a second labelling.
- Run `report` to add the figure to the dataset's report.
