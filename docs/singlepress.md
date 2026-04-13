# SinglePress (.1pz)

## Overview

SinglePress (.1pz) is a purpose-built sparse matrix file format for single-cell genomics. It achieves a 9.5× median compression ratio at 868 MB/s decode throughput, making it 2–4× smaller than H5AD while remaining fast enough for real-time streaming. SinglePress ships with native Python, R, and PyTorch integration so that .1pz files drop into existing Scanpy, Seurat, and GPU training workflows without conversion.

## Installation

### Python

```bash
pip install singlepress
```

### R

```r
devtools::install_github("Singlet-Bio/singlepress", subdir = "R")
```

### From source

```bash
git clone https://github.com/Singlet-Bio/singlepress.git
cd singlepress
pip install -e .
```

## Quick Start (Python)

```python
import singlepress

# Write a scipy sparse matrix as .1pz
singlepress.write_1pz("counts.1pz", sparse_matrix)

# Read back
mat = singlepress.read_1pz("counts.1pz")

# AnnData interop
from singlepress.interop import to_anndata
adata = to_anndata("counts.1pz")
```

## Quick Start (R)

```r
library(singlepress)

# Read a .1pz file
opz <- read_1pz("counts.1pz")

# Convert to dgCMatrix for Seurat
mat <- as(opz, "dgCMatrix")
```

## CLI Reference

```bash
# File info
singlepress info counts.1pz

# Convert formats
singlepress convert input.h5ad output.1pz

# Validate file integrity
singlepress validate counts.1pz
```

## Python API Reference

| Function | Description |
|----------|-------------|
| `write_1pz(path, matrix)` | Write scipy sparse matrix as .1pz |
| `read_1pz(path)` | Read .1pz to scipy CSC matrix |
| `read_1pz_torch(path)` | Read .1pz as PyTorch sparse tensor |
| `info_1pz(path)` | Return file metadata dict |
| `validate_1pz(path)` | Verify file integrity |
| `cbind_1pz(paths, output)` | Column-bind multiple .1pz files |
| `rbind_1pz(paths, output)` | Row-bind multiple .1pz files |
| `subset_1pz(path, cols)` | Extract column subset |
| `sample_1pz(path, n)` | Random sample of columns |
| `open_1pz(path)` | Open for lazy column-range access |
| `colsums_1pz(path)` | Column sums without full decompression |

## Benchmark Summary

| Format | Compression ratio | Decode (MB/s) | File size (1M cells) |
|--------|------------------|---------------|---------------------|
| **SinglePress (.1pz)** | **9.5×** | **868** | **~80 MB** |
| BPCells | 3.8× | ~400 | ~200 MB |
| H5AD (gzip) | 2.8× | ~200 | ~280 MB |
| scipy npz | 2.1× | ~370 | ~360 MB |
| 10x HDF5 | 3.8× | ~400 | ~200 MB |

## FAQ

**How does SinglePress compare to BPCells?**
SinglePress achieves 2.5× better compression with comparable decode speed. BPCells offers disk-backed lazy operations in R; SinglePress offers native PyTorch dataloaders for GPU training.

**Can I use .1pz files with Seurat/Scanpy?**
Yes. In Python: `singlepress.interop.to_anndata(path)` returns an AnnData object. In R: `as(read_1pz(path), "dgCMatrix")` returns a Seurat-compatible sparse matrix.

**What are the system requirements?**
Python ≥3.8 with a C compiler (for the compiled extension). No GPU required. R package requires Rcpp.

**Is the format stable?**
Yes. The .1pz v4 format is frozen. All future versions will read v4 files.

## Citation

```
DeBruine, Z. (2026). SinglePress: A Purpose-Built File Format for Single-Cell Omics
Matrices. bioRxiv. DOI: [pending]
```
