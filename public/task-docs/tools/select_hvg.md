---
id: engine.select_hvg
title: Highly variable genes
tool: singlet_select_hvg
task_id: feature-selection.highly_variable_gene_selection
status: prototype
runtime: local-cpu streaming kernels
reads: [stats/*]
writes: [genes/hvg_mask, genes/hvg_score]
---

# Highly variable genes

> Select highly variable genes by the Seurat dispersion method from the streaming gene moments (matches Scanpy's top-n selection). Stores a mask used by pca and nmf_programs.

Tool name `singlet_select_hvg`. Implements the catalogue task [feature-selection.highly_variable_gene_selection](/tasks/feature-selection/highly_variable_gene_selection). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `n_top` | integer | 2000 | Number of genes to keep. |
| `n_bins` | integer | 20 | Mean bins for the dispersion z-score. |

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
  "name": "singlet_select_hvg",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

This tool reads only the gene moments that qc_summary stored, namely the per-gene sums of the normalised values and of their squares. It passes them to the C++ function sp_hvg_seurat in src/stats.cpp, which works on gene vectors alone and never touches cells. For each gene the kernel computes the dispersion as variance over mean and takes its log. It excludes genes with zero mean or a non-finite dispersion, then places the rest in equal-width bins of log1p mean, by default twenty. Each dispersion is z-scored within its bin, and the top n_top scores are marked. The mask and the scores are stored as genes/hvg_mask and genes/hvg_score, and Python draws a mean against dispersion plot.

## When to use it

- Use it before pca or nmf_programs to set n_top yourself, since both otherwise run it with the default of 2000.
- Use standard_workflow instead when you want the whole default chain in one call.

## Measured performance and accuracy

results/engine_benchmarks.json compares the selection with Scanpy on a dataset the key names as 40k cells. The overlap is 498 of the top 500 genes and all 2000 of the top 2000 genes. The file gives no time for this step, does not say whether the data was simulated, and records 4 CPUs.

## Pitfalls

- The mean window of min_mean 0.0125 and max_mean 3.0 in core.py is never applied, because the tool always passes a fixed n_top.
- If fewer genes than n_top have finite scores, the mask holds fewer genes and no error is raised.
- A single-gene bin gets a z score of zero, a difference from Scanpy that the source code documents.
- If the QC moments are missing, this tool runs qc_summary with default settings, so run qc_summary first to set a custom mito prefix.

## What to do with the result

- Run pca next, as the hint says. It restricts to the masked genes by default.
- Run nmf_programs on the same mask for gene programs, which it also reads from genes/hvg_mask.
