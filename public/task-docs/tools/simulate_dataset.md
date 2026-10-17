---
id: engine.simulate_dataset
title: Simulate a planted-structure dataset
tool: singlet_simulate_dataset
task_id: simulation.reference_matched_counts
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: [truth/labels]
---

# Simulate a planted-structure dataset

> Create a synthetic count matrix with known cell types and a low-rank continuum, written to the block format. Use it to test workflows and to benchmark: the true labels are stored as 'truth/labels'.

Tool name `singlet_simulate_dataset`. Implements the catalogue task [simulation.reference_matched_counts](/tasks/simulation/reference_matched_counts). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `n_cells` | integer | 20000 | Number of cells. |
| `n_genes` | integer | 2000 | Number of genes (max 65535). |
| `n_types` | integer | 8 | Number of planted cell types. |
| `rank` | integer | 6 | Rank of the within-type continuum. |
| `mean_umi` | number | 5000 | Mean UMIs per cell. |
| `cell_noise` | number | 0.5 | Within-type latent noise. |
| `seed` | integer | 1 | Random seed. |
| `block_cells` | integer | 16384 | Cells per stored block. |

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
  "name": "singlet_simulate_dataset",
  "arguments": {
    "name": "demo"
  }
}
```

## How it works

This tool calls `core.generate` in python/singlet_engine/core.py, which runs the C++ function sp_generate in src/gen.cpp. Each cell gets a planted type and a latent vector near that type's center. Expression over all genes is a softmax of a gene offset plus loadings times the latent vector. A depth is drawn around mean_umi, and that many UMIs are placed by inverse-CDF sampling. OpenMP processes the cells of each block in parallel, and each finished block is written as a CSR slice in the sblk format. Only the gene parameters and one block of cells are held in memory. The Python layer stores the true types as truth/labels and writes genes.txt, naming the first one percent of genes, and at least one, with an MT- prefix.

## When to use it

- Use it to test a workflow or to benchmark, since truth/labels lets cluster and compare_labelings report agreement with the known types.
- Use import_matrix for real counts, because the planted structure shows that the engine works, not how a real study behaves.

## Measured performance and accuracy

pilot/results/gen2m.log records "gen 2M 315s 5.25GB", so the pilot generator wrote 2 million cells in 315 seconds to 5.25 GB on disk. The log does not record the gene count. The machine is the 4 vCPU VM described in pilot/results/fingerprint_local.json. The engine build of this generator is not timed in the results.

## Pitfalls

- Reusing a dataset name rewrites the file but resets the record, so earlier arrays and the step log are dropped.
- Counts are stored as 16-bit integers and mean_umi has no maximum in the schema, so very large depths can overflow a gene count.
- Cost grows with cells times genes times rank, because every cell recomputes its full expression vector.
- Types are stored as one byte, so n_types is capped at 255.

## What to do with the result

- Run describe_dataset and then qc_summary, as the next hints suggest.
- After cluster, run compare_labelings on clusters/louvain and truth/labels to see how clusters fall across the planted types.
