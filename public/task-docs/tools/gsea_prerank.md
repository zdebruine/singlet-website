---
id: engine.gsea_prerank
title: Preranked gene-set enrichment
tool: singlet_gsea_prerank
task_id: enrichment.preranked_gene_set_enrichment
status: prototype
runtime: local-cpu streaming kernels
reads: []
writes: []
---

# Preranked gene-set enrichment

> Weighted-KS enrichment score for each gene set on a ranked gene list, with a size-matched permutation null (exact scores, Benjamini-Hochberg FDR). Provide the ranking inline or point at an NMF program.

Tool name `singlet_gsea_prerank`. Implements the catalogue task [enrichment.preranked_gene_set_enrichment](/tasks/enrichment/preranked_gene_set_enrichment). Status: prototype, CPU only.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `ranked` | array | — | List of [gene, score] pairs (higher = more positive). |
| `from_program` | object | — | Alternative to ranked: {name, program} takes the loadings of an NMF program of a dataset. |
| `gene_sets` | object | — | Mapping set name -> list of genes. |
| `gmt_path` | string | — | Alternative: path to a GMT file. |
| `n_perm` | integer | 1000 | Permutations per distinct set size. |
| `weight` | number | 1.0 | Weight exponent of the score. |
| `min_size` | integer | 5 | Smallest set size kept. |
| `max_size` | integer | 500 | Largest set size kept. |
| `seed` | integer | 1 | Random seed. |
| `top` | integer | 20 | Rows returned. |
| `dataset` | string | — | Dataset for figure files (optional). |

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
  "name": "singlet_gsea_prerank",
  "arguments": {}
}
```

## How it works

gsea_prerank takes a ranked gene list, given inline or as the loadings of one NMF program, and scores each gene set with a weighted Kolmogorov-Smirnov running sum. Each hit is weighted by the absolute score raised to the weight exponent, and the sign only orders the list. The enrichment score is exact, computed from hit positions in the sorted ranking. For each distinct set size the kernel draws random gene positions a fixed number of times to build a null, and NES divides each score by the mean absolute null score of the same sign. P-values are one-sided by sign, and Benjamini-Hochberg gives FDR. The kernel sp_gsea_prerank is in src/gsea.cpp, the wrapper is in python/singlet_engine/core.py, and the FDR step is in python/singlet_engine/tools.py. The state is the ranking and the set positions, not the cells.

## When to use it

- Use it to name an NMF program, with gene sets from a GMT file or given inline.
- Use it on any signed gene statistic that you rank yourself, such as a differential expression score.
- Do not use it on an unranked gene list, because over-representation tests are not part of this engine.

## Measured performance and accuracy

The pilot result pilot/results/gsea.json covers 15,000 genes and 400 gene sets of 15 to 400 genes, with 1,000 permutations, on the pilot prototype rather than this build. Enrichment scores matched the gseapy reference to a maximum absolute difference of 8.3e-16. The run took 0.577 s against 15.09 s for gseapy, and 1.40 s for 5,000 sets. On random sets, 5.3 percent had p below 0.05. The engine results folder has no GSEA file of its own.

## Pitfalls

- A gene listed twice in ranked keeps only its later position for set matching, but both rows still count toward the length.
- Matching is exact text, so case must agree, and size is the overlap with the ranking, not the full set size.
- The smallest p is 1 over the same-sign null count plus one, about 0.001 at 1,000 permutations, so FDR is coarse for many sets.
- Results stay out of the dataset run history, since run_tool reads only a top-level name and this tool takes dataset, so report omits them.

## What to do with the result

- Read NES and FDR in the table, and use the n_fdr_005 metric for the count of sets below 0.05.
- Pass dataset to save the bar figure, since the figure is written only when a dataset is given.
- If no set is significant for an NMF program, rerun nmf_programs with a different k and compare.
