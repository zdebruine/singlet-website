---
id: engine.pca
title: Streaming PCA
tool: singlet_pca
task_id: dim-reduction.scalable_truncated_svd
status: prototype
runtime: local-cpu streaming kernels
reads: [counts, genes/hvg_mask]
writes: [pca/scores, pca/loadings, pca/sv, pca/mean]
---

# Streaming PCA

> Block-Krylov PCA of log1p(CP10k) values streamed from disk, with Rayleigh-Ritz extraction after every pass and Ritz-residual stopping. Memory does not grow with cells. Stores scores, loadings and singular values.

Tool name `singlet_pca`. Implements the catalogue task [dim-reduction.scalable_truncated_svd](/tasks/dim-reduction/scalable_truncated_svd). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `n_components` | integer | 30 | Components to return. |
| `max_passes` | integer | 6 | Maximum passes over the data. |
| `tol` | number | 0.001 | Stop when the largest relative Ritz residual of the leading components is below this. |
| `use_hvg` | boolean | true | Restrict to the genes chosen by select_hvg (runs it if needed). |
| `block` | integer | — | Krylov block width; default n_components+10. |
| `compute_scores` | boolean | true | Also write cell scores (one extra pass). |
| `precision` | string | "float32" | Accumulator precision. One of: float32, float64. |
| `seed` | integer | 0 | Random seed. |

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
  "name": "singlet_pca",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

pca reads the cells from disk in blocks and runs block-Krylov PCA on log1p of counts scaled to 10,000 per cell. By default it uses only the genes chosen by select_hvg. Each pass multiplies the centred gene covariance by a block of basis vectors, and the block width is the number of components plus 10, rounded up to a multiple of 16. The state kept is the Krylov basis, genes by block by passes, so memory does not grow with the number of cells. After each pass the basis grows, and Rayleigh-Ritz extraction gives singular values and residuals without extra reads. The loop stops when the largest relative residual of the leading components falls below tol. The block products are in src/pca.cpp, and the log1p and tile kernels are in src/kernels.hpp.

## When to use it

- Use pca for the first reduction of a dataset, since its memory stays flat as the cell count grows.
- Use nmf_programs instead when you want additive, non-negative gene programs rather than orthogonal axes.
- Use standard_workflow for a first look, and call pca directly when you need to tune its settings.

## Measured performance and accuracy

The engine benchmark file results/engine_benchmarks.json has three PCA rows for 40,000 cells by 2,000 genes on a machine with 4 CPUs. All three use block width 40, which is this tool's default for 30 components. The dense tile path took 0.548 s for 4 passes, with sv_rel_err 0.000437 and sin_theta_top10 9.1e-05. The run with residual tolerance 1e-2 took 0.683 s for 5 passes, with sv_rel_err 1e-06. That file does not name the reference for these errors.

The prototype result pilot/results/pca_2m.json is a run on 2 million cells, which pilot/AUDIT_HANDOFF.md section 2.1 describes as synthetic data with 2,000 genes, on 4 threads with a cold cache. It took 74.9 s for 7 passes, read 36.8 GB, peaked at 546 MB and ran at 0.49 GB/s. Against a q=8 run the top-10 subspace differed by sin_theta 1.2e-4. The prototype has its own kernel and parameters, so these are not measurements of this build. The tail finding in the pitfalls comes from pilot/AUDIT_HANDOFF.md section 7.

## Pitfalls

- Within each block the per-thread accumulators are float32 and are flushed to double afterwards, so set precision to float64 when the sums look noisy.
- A Krylov block that collapses is reported as converged, so read the converged flag and max_rel_residual in the metrics, not only the warnings.
- The pilot found the top 10 components accurate at two power iterations and the 30th not, so do not gate on the tail.
- The kept Krylov basis grows with every pass, so raising max_passes or n_components adds gene-side memory.

## What to do with the result

- Run choose_n_pcs on the stored singular values to decide how many components to keep.
- Pass the chosen count to knn_graph as n_pcs, which reads the stored pca/scores.
- If a convergence warning appeared, rerun pca with more passes before trusting the trailing components.
