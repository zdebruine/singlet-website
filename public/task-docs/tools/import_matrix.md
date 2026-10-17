---
id: engine.import_matrix
title: Import a count matrix
tool: singlet_import_matrix
task_id: harmonization.object_integrity_checks
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Import a count matrix

> Convert a Matrix Market (.mtx/.mtx.gz), SciPy sparse (.npz) or an existing block file into the workspace. Counts must be non-negative integers below 65536.

Tool name `singlet_import_matrix`. Implements the catalogue task [harmonization.object_integrity_checks](/tasks/harmonization/object_integrity_checks). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` (required) | string | — | Dataset name. |
| `path` (required) | string | — | Path to the matrix file. |
| `format` | string | "auto" | File format. One of: auto, mtx, npz, sblk. |
| `orientation` | string | "cells_by_genes" | Axis order in the file. One of: cells_by_genes, genes_by_cells. |
| `genes_path` | string | — | Optional text file with one gene name per line. |
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
  "name": "singlet_import_matrix",
  "arguments": {
    "name": "demo",
    "path": "..."
  }
}
```

## How it works

This tool runs in Python and calls no C++ kernel. For a .sblk file it reads only the 40-byte header through `core.header` and registers the path, without copying the data. Matrix Market and .npz inputs are loaded whole with SciPy and transposed if the orientation is genes by cells. They are then written by `core.write_sblk` in python/singlet_engine/core.py, which splits the cells into blocks of block_cells rows and stores the row pointers, gene indices and counts of each block. The writer checks that counts are integers below 65536 and that there are at most 65535 genes. The source matrix is not streamed, so the whole matrix must fit in memory during the import.

## When to use it

- Use it for real counts in Matrix Market, SciPy npz or existing sblk form, and keep simulate_dataset for tests.
- Use describe_dataset and qc_summary afterwards, since both need the dataset in the workspace.

## Measured performance and accuracy

No results file times an import. The log in pilot/results/gen2m.log times a generator run on simulated data, not a read of a matrix. A useful measurement would be import seconds and peak memory against file size for each of the three input formats.

## Pitfalls

- A .sblk file is registered by path, so moving or deleting the source file breaks the dataset.
- The sblk branch checks neither the magic bytes nor the counts, so a wrong file is read as garbage until a later step fails.
- The gene name file is checked after the dataset is registered, so a mismatch raises an error and leaves the dataset registered without gene names.
- With format auto, any suffix other than .sblk or .npz is read as Matrix Market.

## What to do with the result

- Run describe_dataset to confirm the size and density, then qc_summary, as the next hints suggest.
- If genes are named G0 onward because no gene file was given, the mitochondrial flag in qc_summary cannot match, so pass genes_path first.
