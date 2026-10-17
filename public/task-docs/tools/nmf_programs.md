---
id: engine.nmf_programs
title: Gene programs by NMF
tool: singlet_nmf_programs
task_id: programs.denovo_program_decomposition
status: prototype
runtime: local-cpu streaming kernels
reads: [counts, genes/hvg_mask]
writes: [nmf/H, nmf/usage]
---

# Gene programs by NMF

> Streaming alternating-least-squares NMF of log1p(CP10k): one pass per iteration, state independent of the number of cells. Returns the top genes of each program and the loss curve.

Tool name `singlet_nmf_programs`. Implements the catalogue task [programs.denovo_program_decomposition](/tasks/programs/denovo_program_decomposition). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `k` | integer | 12 | Number of programs (max 64). |
| `max_iter` | integer | 15 | Maximum iterations. |
| `tol` | number | 0.001 | Stop when the relative loss change is below this. |
| `use_hvg` | boolean | true | Restrict to highly variable genes. |
| `l1` | number | 0.0 | L1 penalty on the cell factor. |
| `compute_usage` | boolean | true | Also write per-cell program usage. |
| `seed` | integer | 0 | Random seed. |
| `top_genes` | integer | 10 | Genes listed per program. |

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
  "name": "singlet_nmf_programs",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

nmf_programs factorises log1p of counts scaled to 10,000 per cell into non-negative gene programs with streaming alternating least squares. By default it uses the genes chosen by select_hvg. Each iteration streams every block once. For each cell it solves the program weights given the current gene loadings, then adds the k by k Gram matrix and the gene by program product to running sums. Gene loadings are solved from those sums and their columns are scaled to unit norm, and the loss comes from the same sums without another read. Cell weights are not stored during the fit, and a final pass writes them only when compute_usage is set. Each cell solve is a Cholesky warm start refined by coordinate descent in src/nmf.cpp, and the tile products are in src/kernels.hpp. The state kept is genes by k.

## When to use it

- Use it for additive, non-negative gene programs that you can name, rather than the orthogonal axes that pca returns.
- Use it on the default highly variable gene panel, since the gene-side state grows with the number of genes.
- Use gsea_prerank on a program to name it, and use pca when the goal is an embedding for neighbours.

## Measured performance and accuracy

The engine benchmark file results/engine_benchmarks.json reports 30 programs for 5 iterations on a machine with 4 CPUs. The sparse kernel took 1.03 s and the dense kernel 1.209 s, with a relative reconstruction error of 0.4465. The file does not record the number of cells or genes, so these timings cannot be scaled or compared with the PCA rows. No NMF measurement exists in the pilot results.

## Pitfalls

- k must be at most 64, because the kernel rejects larger values with code 3 and the per-cell solver uses fixed 64-entry arrays.
- Gram factors and dense accumulators are float32, and tiny Cholesky pivots are clamped rather than reported, so a near-singular Gram gives no warning.
- Loading columns have unit norm, so top weights compare across programs but not in absolute level, since the scale sits in cell usage.

## What to do with the result

- Pass a program to gsea_prerank with from_program set to the dataset name and the program index.
- When compute_usage was set, read the per-cell usage under nmf/usage with inspect_artifact, or plot one column with plot_histogram.
