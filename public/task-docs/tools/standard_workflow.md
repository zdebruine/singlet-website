---
id: engine.standard_workflow
title: Standard workflow in one call
tool: singlet_standard_workflow
task_id: clustering.cell_partitioning
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Standard workflow in one call

> QC, HVG, PCA, neighbour graph, clustering and 2-D embedding in a single call (each step is one compiled streaming pass or kernel), then a report. Use it for a first look; use the individual tools to tune.

Tool name `singlet_standard_workflow`. Implements the catalogue task [clustering.cell_partitioning](/tasks/clustering/cell_partitioning). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `n_hvg` | integer | 2000 | Highly variable genes. |
| `n_pcs` | integer | 30 | Principal components. |
| `k` | integer | 15 | Neighbours. |
| `resolution` | number | 1.0 | Cluster resolution. |
| `umap` | boolean | true | Compute the 2-D embedding. |
| `make_report` | boolean | true | Write an HTML report. |

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
  "name": "singlet_standard_workflow",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

standard_workflow runs the first-look pipeline in one call. In tools.py it calls run_tool for qc_summary, select_hvg, pca, knn_graph and cluster in that order, and for embed_umap unless umap is false. Each step is logged under the dataset like any other call. It stops at the first step that does not return status ok and reports which step failed. Otherwise it writes the HTML report from report.py when make_report is true, and returns the step summaries, the warnings and the report path. It writes no arrays of its own.

## When to use it

- Use it for a first look at a new dataset, after `import_matrix` or `simulate_dataset`.
- Use the individual tools when a step needs more control than the parameters here give, such as the kNN method or the UMAP epochs.

## Measured performance and accuracy

No results file or test covers this wrapper, and the test suite runs its component tools one at a time instead.

## Pitfalls

- The kNN method is auto, so above 150,000 cells the graph is approximate, and only a recall warning flags a weak graph.
- Parameters outside its schema, such as the UMAP epochs or the cluster seed, take the defaults of the individual tools.
- A failed step returns status error, with the earlier steps still logged and no report written.
- A second run adds another set of entries to the log, so the report repeats every step.

## What to do with the result

- Run `plot_scatter` with its default keys to check the UMAP layout coloured by the Louvain clusters.
- Run `scan_resolution` if the cluster count looks wrong, then `cluster` again with the chosen resolution.
- Run `nmf_programs` to look for gene programs in the highly variable genes.
