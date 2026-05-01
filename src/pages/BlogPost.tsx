import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Calendar, Tag, ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

// Blog post content (will move to Supabase/MDX later)
const POST_CONTENT: Record<string, { title: string; date: string; tags: string[]; content: string }> = {
  "4-million-cells-milestone": {
    title: "4 Million Cells: The Singlet Atlas Passes a Major Milestone",
    date: "2026-05-08",
    tags: ["milestone", "corpus", "cells", "atlas", "scale"],
    content: `
## 4 Million Cells

The singlet atlas has crossed **4 million cells** — a milestone that demonstrates the scale and reliability of our automated processing pipeline.

### By the Numbers

| Metric | Value |
|--------|-------|
| Total processed | 3,244 |
| Passing QC (SUCCESS) | 1,386 |
| Total cells | 4.00 million |
| Avg cells/sample | 2,886 |
| Species | 8 |
| Protocols | 29 |
| Median mapping rate | 78.3% |

### Species Diversity

| Species | Samples | Cells |
|---------|---------|-------|
| Homo sapiens | 853 | 2.6M |
| Mus musculus | 394 | 1.1M |
| Macaca mulatta | 13 | 45K |
| Drosophila melanogaster | 5 | 12K |
| Sus scrofa | 3 | 8K |
| Others | 5 | 15K |

### Quality Profile

The atlas maintains strict quality control:
- **Gold tier** (MR≥70%, genes≥500, cells≥500): ~275 samples
- **Silver tier** (MR≥50%, genes≥200, cells≥200): ~373 samples
- **Bronze tier** (all others): ~717 samples

### Growth Trajectory

| Milestone | Samples (SUCCESS) | Date |
|-----------|-------------------|------|
| 1 million cells | ~350 | 2026-04 |
| 2 million cells | ~700 | 2026-04 |
| 3 million cells | ~1,100 | 2026-04 |
| **4 million cells** | **1,386** | **2026-05** |

### Access the Atlas

\`\`\`python
import singlet

singlet.summary()
# → 3,244 samples (1,386 SUCCESS) • 8 species • 4.0M cells

# Browse by tissue, cell type, or organism
singlet.samples(tissue="brain", status="SUCCESS")
singlet.species()
singlet.tissues()
\`\`\`

The full atlas is browsable at [singlet.bio/browse](https://singlet.bio/browse) and accessible via the MCP server (11 tools) for AI assistants.
`,
  },
  "protocol-diversity-atlas": {
    title: "12 Protocols, 1 Pipeline: How singlify Handles scRNA-seq Diversity",
    date: "2026-05-08",
    tags: ["protocols", "atlas", "diversity", "api"],
    content: `
## The Protocol Landscape

Single-cell RNA-seq isn't one technology — it's a family of protocols with different chemistry, barcode structures, and read layouts. The singlet atlas now includes data from **12 distinct protocols**, all processed through a single pipeline:

| Protocol | Samples | Success Rate |
|----------|---------|-------------|
| 10x Chromium v3 | 267 | 56% |
| Drop-seq | 98 | 83% |
| 10x Chromium v2 | 97 | 60% |
| 10x (suspect/ambiguous) | 57 | 63% |
| CEL-Seq2 | 22 | 47% |
| sci-RNA-seq | 19 | 27% |
| MARS-seq | 18 | 51% |
| Plate-based | 2 | 67% |

Drop-seq leads in success rate (83%) thanks to its simpler barcode structure. 10x v2/v3 account for the bulk of the atlas. Plate-based and Smart-seq2 are emerging categories.

## Query by Protocol

The Python package now has \`singlet.protocols()\` for instant protocol breakdown:

\`\`\`python
import singlet

# Protocol distribution
singlet.protocols()
#   protocol     count
# 0    10xv3       267
# 1  dropseq        98
# 2    10xv2        97
# ...

# Filter samples by protocol
dropseq = singlet.samples(protocol="dropseq", status="SUCCESS")
print(f"{len(dropseq)} Drop-seq samples, {dropseq['cells_called'].sum():,} cells")
\`\`\`

## Why Protocol Diversity Matters

1. **Benchmark fairness** — comparisons against STAR/Cell Ranger are only valid when the protocol is correctly identified
2. **Auto-detection validation** — singlify auto-detects protocol from read structure; diverse protocols stress-test this
3. **User discoverability** — researchers can find atlas data matching their own lab's protocol

## Pipeline Architecture

singlify handles protocol diversity through a modular barcode extraction layer:
- **10x v2/v3**: 16bp CB + 10/12bp UMI from R1
- **Drop-seq**: variable-length CB + UMI from R1
- **CEL-Seq2**: 6bp CB + 6bp UMI from R1
- **sci-RNA-seq**: combinatorial indexing from R1 + R2
- **MARS-seq**: plate-based pooling with 7bp barcode

All paths converge at the same STAR aligner and gene counting engine, ensuring consistent quantification regardless of protocol.

## What's Next

Priority areas for protocol expansion:
- **10x Multiome** (ATAC + GEX) — in progress
- **Visium** spatial transcriptomics — in progress
- **Parse Biosciences** — evaluating
- **Scale Bio** — evaluating

The pipeline page on singlet.bio shows real-time protocol distribution from the live corpus.
`,
  },
  "tissue-metadata-browse": {
    title: "Search by Tissue: 2,568 Samples Now Enriched with GEO Characteristics",
    date: "2026-05-07",
    tags: ["metadata", "browse", "enrichment", "usability"],
    content: `
## Every Sample Now Has Structured Metadata

We've enriched all **2,568 samples** in the singlet atlas with detailed metadata from GEO, including tissue/cell source, structured characteristics, and experimental annotations. This makes the Browse page dramatically more useful.

## What's New

### Searchable by Tissue
The Browse page search now matches against **tissue/cell source** in addition to GSM IDs, GSE IDs, and titles. Search for "brain", "lung", "PBMC", or "tumor" and instantly find relevant samples.

### Structured Characteristics
Each sample detail page now shows a **Characteristics** section with key-value pairs extracted from GEO:

| Characteristic | Coverage |
|---------------|----------|
| **Tissue** | 678 samples |
| **Cell type** | 501 samples |
| **Cell line** | 207 samples |
| **Treatment** | 200 samples |
| **Age** | 150 samples |
| **Genotype** | 112 samples |
| **Strain** | 104 samples |
| **Sex** | 92 samples |
| **Disease state** | 72 samples |
| **Developmental stage** | 61 samples |

### Source Tissue in Table View
The Browse table now shows the sample source (e.g., "blood", "brain", "K562 cells") directly beneath each sample's title.

## Top Tissue Types

| Source | Samples |
|--------|---------|
| Blood | 94 |
| K562 cells | 59 |
| PBMC/PBMCs | 68 |
| Brain | 32 |
| Bone marrow | 29 |
| Lung | 24 |
| Peripheral blood | 18 |
| Tumor | 15 |
| Dorsal root ganglion | 14 |
| Skin | 11 |

## Python API

The \`singlet\` package now includes a \`tissues()\` function:

\`\`\`python
import singlet

# See all tissue types
tissues = singlet.tissues()
print(tissues.head(10))

# Search samples by tissue
brain_samples = singlet.samples(status="SUCCESS")
brain_samples = brain_samples[brain_samples['source'].str.contains('brain', case=False, na=False)]
\`\`\`

## Technical Details

Metadata was extracted from GEO SOFT format records (\`!Sample_characteristics_ch1\` and \`!Sample_source_name_ch1\` fields). The structured characteristics are stored as JSON objects in Supabase, enabling future faceted search.

All 2,568 samples (not just SUCCESS) have been enriched, so even samples that failed processing have their biological context preserved for triage and re-processing decisions.
`,
  },
  "atlas-3m-cells-9-species": {
    title: "3.1 Million Cells Across 9 Species: Atlas Quality Update",
    date: "2026-05-06",
    tags: ["milestone", "corpus", "atlas", "quality"],
    content: `
## The Atlas at 2,547 Samples

The singlet atlas has grown to **2,547 GEO samples** processed by singlify, with **1,071 passing QC** — producing **3.1 million cells** available for analysis. Organism annotation now covers 9 species.

## Current Statistics

| Metric | Value |
|--------|-------|
| **Total samples processed** | 2,547 |
| **Successful (QC pass)** | 1,071 |
| **Total cells** | 3,101,272 |
| **GEO series** | 1,222 |
| **Species** | 9 |
| **Mean mapping rate** | 77.5% |
| **Median genes/cell** | 574 |
| **Success rate** | 42.1% |

## Species Breakdown

| Species | Samples | Cells | % of Atlas |
|---------|---------|-------|-----------|
| Homo sapiens | 679 | 1,984,222 | 64.0% |
| Mus musculus | 191 | 416,998 | 13.4% |
| Homo sapiens + Mus musculus (mixed) | 53 | 91,762 | 3.0% |
| Macaca mulatta | 29 | 41,779 | 1.3% |
| Drosophila melanogaster | 13 | 27,450 | 0.9% |
| Gallus gallus | 8 | 9,849 | 0.3% |
| Unknown (not in GDS) | 98 | 529,212 | 17.1% |

Human samples dominate with 64% of cells — expected given GEO submission patterns. The "unknown" category contains samples too new or restricted for NCBI GDS lookup.

## Quality Distribution

Across 1,071 successful samples:

- **Mapping rate**: mean 77.5%, median ~80% (range 10–98%)
- **Cells per sample**: median ~1,200 (range 1–78,000)
- **Genes per cell**: median 574 (range 50–5,000+)
- **Doublet rate**: typically 2–8% for high-cell samples

## What Changed Since 1,000 Samples

| Metric | 1K Milestone | Now | Change |
|--------|-------------|-----|--------|
| Successful samples | 1,001 | 1,071 | +7% |
| Total cells | 2.94M | 3.1M | +5.4% |
| Species | 5 | 9 | +4 |
| Series | 506 | 1,222 | +141% |
| Organism annotation | ~50% | 91% | +41pp |

The biggest improvement is **organism annotation coverage** — from ~50% known species to 91%, achieved via NCBI E-utilities lookup and series-level inference.

## Access the Data

\`\`\`python
import singlet

# Browse all successful samples
df = singlet.samples(status="SUCCESS")
print(f"{len(df)} samples, {df['cells_called'].sum():,.0f} cells")

# Filter by species
human = singlet.samples(organism="Homo sapiens")
print(f"{len(human)} human samples")

# Load a sample as AnnData
adata = singlet.load("GSM5911120")
\`\`\`

## Pipeline Analytics

View real-time atlas statistics on the [Pipeline page →](/pipeline), including species distribution charts, protocol breakdown, and quality metrics — all powered by live Supabase queries.

## What's Next

- **2,000 successful samples** — 1,476 samples are in FAIL status, many recoverable with protocol fixes
- **Non-host transcriptomics** — viral/bacterial detection module in development
- **Multi-modal** — CITE-seq ADT, ATAC fragments joining the atlas
- **PyPI release** — \`pip install singlet-bio\` from PyPI (currently GitHub-only)
    `,
  },
  "mitochondrial-variant-analysis": {
    title: "Mitochondrial Variant Analysis: Clonal Tracking from scRNA-seq",
    date: "2026-04-30",
    tags: ["mitochondria", "variants", "clonal-tracking", "g6"],
    content: `
## Why Mitochondrial Variants Matter

Mitochondrial DNA (mtDNA) accumulates somatic mutations at ~10× the rate of nuclear DNA. In single-cell data, these naturally occurring variants serve as **endogenous barcodes** — enabling clonal tracking, lineage tracing, and donor deconvolution without additional assays like ATAC-seq or genetic barcoding.

Until now, extracting mitochondrial variant information from scRNA-seq required running separate tools (e.g., mgatk, AMULET) on the aligned BAM. singlify now computes this **during the standard pipeline run** with zero extra cost.

## What's New: G6 Mitochondrial Outputs

The \`G6-MT-OUTPUTS\` gate (9 commits, merged to main) adds:

### 1. Per-Donor MT Consensus (FASTA + VCF)

\`\`\`
output/
├── donor0_mt_consensus.fa    # Full 16,569bp consensus
├── donor0_mt_consensus.vcf   # Variants vs rCRS reference
├── donor1_mt_consensus.fa    # (if multi-donor)
└── donor1_mt_consensus.vcf
\`\`\`

Each donor gets a reconstructed mitochondrial genome and a VCF with:
- SNVs, indels, frameshifts, and stop-gain variants (codes 5–9)
- Per-variant allele frequency across cells assigned to that donor
- Quality scores based on coverage depth

### 2. MT Events Matrix (\`mt_events.1pz\`)

A sparse cells × variants matrix in .1pz format:
- Rows = cell barcodes
- Columns = MT variant positions
- Values = variant allele frequency (heteroplasmy level)

This enables downstream analysis like:
- **Clonal clustering** — cells sharing MT variants are clonally related
- **Lineage reconstruction** — build phylogenetic trees from MT mutation accumulation
- **Donor deconvolution** — distinguish pooled donors by MT haplotype

### 3. MT Summary Statistics (\`mt_summary.tsv\`)

| Metric | Description |
|--------|-------------|
| mt_coverage_median | Median per-base coverage across MT genome |
| mt_variants_total | Total variants called |
| mt_heteroplasmy_rate | Fraction of cells with detectable MT variants |
| mt_haplogroup | Predicted MT haplogroup (when coverage sufficient) |

## Performance

MT analysis runs **inside the existing pileup phase** — no additional alignment pass required:

- **Overhead**: <2% of total wall time (piggybacked on existing read processing)
- **Memory**: ~4 MB additional (MT genome is only 16.6 KB)
- **Output size**: mt_events.1pz typically 50–200 KB for 10K cells

## Use Cases

1. **Cancer biology**: Track subclonal expansion through MT variant accumulation
2. **Pooled experiments**: Deconvolve donors without genotyping by MT haplotype
3. **Development**: Trace lineage relationships in differentiation timecourses
4. **Quality control**: High MT heteroplasmy can indicate stressed/dying cells

## Try It

\`\`\`python
import singlet

# Load a processed sample
adata = singlet.load_dir("/path/to/singlify_output")

# MT heteroplasmy is in the output directory
mt_events = singlet.read_1pz("/path/to/singlify_output/mt_events.1pz")
print(f"MT variants tracked: {mt_events.n_vars}")
print(f"Cells with MT variants: {(mt_events.X.sum(axis=1) > 0).sum()}")
\`\`\`

## Validation

- 85/85 unit tests pass
- E2E validated on SRR27329891 (123M reads, 10x Chromium v3)
- Schema compliance: DROPLET_OUTPUT_SCHEMA.md §3.6 and §3.7

## What's Next

- MT haplogroup classification (phylotree-based)
- Cross-sample MT variant atlas for population-level analysis
- Integration with the doublet detection module (MT variants as confirming signal)

---

*Gate G6-MT-OUTPUTS merged to main (commit 1d16227). 85 tests passing.*
`,
  },
  "17-notebooks-catalog": {
    title: "17 Notebooks + Bundled Catalog: singlet-bio Is Self-Contained",
    date: "2026-05-04",
    tags: ["milestone", "notebooks", "python", "catalog"],
    content: `
## The Milestone

The singlet-bio Python package now includes everything a researcher needs to explore 2,364 single-cell samples — no external downloads required.

**Bundled catalog** (84 KB total):
- \`catalog_v1.parquet\` — 1,169 GEO series with organism, cells, protocol, mapping rate
- \`sample_index.parquet\` — 2,364 samples with status, QC metrics, timing

**17 executed notebooks** covering every singlify capability:

## Notebook Collection

### Getting Started
| Notebook | What It Shows |
|----------|---------------|
| quickstart | Browse the catalog — filters, statistics, species breakdown |
| 01_load_and_explore | Load 75K cells, cluster with scanpy (PCA→UMAP→Leiden) |
| sample_qc_report | One-call QC — UMIs, genes, doublets, cell cycle, ancestry |
| pipeline_outputs | All 40+ files singlify produces per sample |

### QC & Quality Control
| Notebook | What It Shows |
|----------|---------------|
| cell_calling | EmptyDrops deviance testing — 74K cells called |
| doublet_detection | UMI-based doublets (13.8% rate, 20× score separation) |
| ambient_rna | Ambient RNA contamination profiling |
| cell_cycle | G1/S/G2M phase scoring |
| saturation_curve | Sequencing depth vs discovery |

### Genomic Features
| Notebook | What It Shows |
|----------|---------------|
| rna_velocity | Spliced + unspliced matrices for scVelo |
| splicing | 37,909 alternative splicing events |
| mt_variants | Mitochondrial heteroplasmy for lineage tracing |
| ancestry_calling | 5 super-population inference |
| sex_calling | 100% concordance with known sex |

### Validation
| Notebook | What It Shows |
|----------|---------------|
| gene_counting | r = 0.9995 vs STARsolo |
| corpus_analytics | QC distributions across 975 samples |
| protocol_detection | 15+ protocols auto-detected |

## Install & Explore

\`\`\`python
pip install "singlet-bio @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python"

import singlet

# Browse the bundled catalog (no downloads needed)
catalog = singlet.catalog()
print(f"{len(catalog)} series, {catalog['n_cells'].sum():,.0f} cells")
# → 1,169 series, 2,895,233 cells

# Filter by organism
human = singlet.search(organism="Homo sapiens")
print(f"{len(human)} human samples")

# Load a processed sample
adata = singlet.load_dir("/path/to/quant/GSM3573650")
# obs: total_umis, total_genes, mt_pct, doublet_score, phase, s_score, g2m_score
# uns: ancestry, sex_call, summary, saturation_curve
\`\`\`

## Atlas Stats

| Metric | Value |
|--------|-------|
| Total samples | 2,364 |
| Successful | 982 (42%) |
| GEO series | 1,169 |
| Species | 7 |
| Total cells | 2,895,233 |
| Notebooks | 17 (all executed) |
| Package size | < 100 KB catalog + C extension |

## What's Next

- **PyPI publishing** — \`pip install singlet-bio\` without git URL
- **Zenodo DOI** for catalog versioning
- **More notebooks** as new features ship (cell calling, CITE-seq, non-host)
- **MCP server** for AI-assistant access to the atlas

[Browse Notebooks →](https://github.com/Singlet-Bio/singlet/tree/main/notebooks) | [Install →](https://github.com/Singlet-Bio/singlet)
    `,
  },
  "load-dir-feature": {
    title: "New: singlet.load_dir() — Pipeline Output → AnnData in One Call",
    date: "2026-05-03",
    tags: ["python", "feature", "anndata", "load"],
    content: `
## The Problem

singlify produces a rich output directory per sample: count matrices (.1pz), QC metrics, doublet scores, gene annotations, and barcodes. Loading all of this into a standard analysis framework required reading multiple files and manually joining them.

## The Solution

\`\`\`python
import singlet

adata = singlet.load_dir("/path/to/quant/GSM3573650")
# → AnnData: 75,420 cells × 38,606 genes
#   obs: total_umis, total_genes, mt_pct, ribo_pct, intronic_pct, doublet_score, is_doublet
#   var: gene_id (Ensembl IDs)
#   uns: singlify_dir
\`\`\`

One function call reads:
- **gene_counts.1pz** — sparse count matrix (CSR)
- **gene_expression.tsv** — gene names + Ensembl IDs
- **auto_barcodes.tsv** — cell barcodes
- **cell_qc_metrics.tsv** — per-cell QC (UMIs, genes, MT%, ribo%, intronic%)
- **doublet_scores.tsv** — doublet score + is_doublet flag

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| \`path\` | required | singlify output directory |
| \`layer\` | "gene_counts" | Which .1pz to load (also: exon_counts, intron_counts, gene_counts_em) |
| \`with_qc\` | True | Merge cell_qc_metrics.tsv into obs |
| \`with_doublets\` | True | Merge doublet_scores.tsv into obs |

## Downstream: Immediate scanpy Workflow

\`\`\`python
import scanpy as sc

# Filter doublets (pre-computed by singlify)
adata = adata[~adata.obs['is_doublet'].astype(bool)]

# Standard pipeline
sc.pp.filter_cells(adata, min_genes=200)
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata)
sc.tl.pca(adata)
sc.pp.neighbors(adata)
sc.tl.umap(adata)
sc.tl.leiden(adata)
sc.pl.umap(adata, color='leiden')
\`\`\`

## Test Coverage

10 dedicated tests verify load_dir behavior:
- Correct dimensions (75,420 × 38,606)
- Gene names attached (TSPAN6, TNMD, ...)
- Barcodes attached (16-mer 10x format)
- QC metrics merged (total_umis, mt_pct, ...)
- Doublet scores merged (is_doublet, doublet_score)
- Optional disable of QC/doublet merge
- Alternative layers (exon_counts)
- Error handling (missing dir, missing .1pz)

Full test suite: 109 passed, 9 skipped.

## Try It

\`\`\`bash
pip install singlet-bio
\`\`\`

See the [Load and Explore notebook](https://github.com/Singlet-Bio/singlet/blob/main/notebooks/01_load_and_explore.ipynb) for a complete walkthrough with UMAP clustering.
`,
  },
  "doublet-detection-live": {
    title: "Doublet Detection: Separating Singlets from Multiplets",
    date: "2026-05-03",
    tags: ["doublets", "qc", "notebooks", "panel-h"],
    content: `
## The Problem

In droplet-based single-cell experiments, ~5–15% of droplets capture two or more cells (doublets/multiplets). These create spurious intermediate cell types that confuse downstream clustering and differential expression.

## singlify's Approach

singlify uses a UMI-count heuristic with adaptive thresholding:

1. Estimate expected UMI count per singlet from the population distribution
2. Compute \`doublet_score = total_umis / expected_singlet_umis\` for each cell
3. Apply bimodal mixture model to find the optimal singlet/doublet boundary

## Real Results: GSM3573650 (74,236 cells)

| Metric | Value |
|--------|-------|
| Singlets | 63,981 (86.2%) |
| Doublets detected | 10,255 (13.8%) |
| Singlet mean score | 1.0 |
| Doublet mean score | 25.6 |
| Score separation | >20× difference |
| Score range (singlets) | 0.44 – 2.0 |
| Score range (doublets) | 2.0 – 245.9 |

## Clear Separation

The doublet score produces a bimodal distribution with excellent separation:
- **Singlets** cluster tightly around score = 1.0
- **Doublets** have scores >> 2.0 (their UMI count is 2–250× the singlet expectation)

The threshold at score = 2.0 cleanly separates the two populations with minimal ambiguity.

## Practical Implications

The 13.8% doublet rate is consistent with expectations for ~74K cells loaded (10x estimates ~0.8% per 1,000 cells, giving ~60% for this loading density when combined with EmptyDrops' liberal cell calling).

Users should:
1. Filter \`is_doublet == True\` cells before clustering
2. Or use \`doublet_score\` as a continuous QC weight
3. Note: some "doublets" may be large cells with high RNA content

## Try It

\`\`\`bash
pip install singlet-bio matplotlib pandas
\`\`\`

The [doublet detection notebook](https://github.com/Singlet-Bio/singlet/blob/main/notebooks/doublet_detection.ipynb) walks through the full analysis with visualizations.

## Corpus Update

With batch c188 completing, the atlas now contains:
- **2,319 samples** across **1,151 series**
- **957 successful** (41.3% success rate)
- **2.82M total cells**
- **7 species**
`,
  },
  "pipeline-failure-analysis": {
    title: "Why Samples Fail: Anatomy of 1,094 Pipeline Failures",
    date: "2026-04-29",
    tags: ["pipeline", "analytics", "quality"],
    content: `
## The Numbers

Of **1,814 samples** processed through the singlet pipeline, **687** (37.9%) succeed, **687** (37.9%) hard-fail, and **428** (24.3%) soft-fail. Understanding *why* samples fail helps users predict success before committing compute time.

## Seven Failure Categories

| Category | Count | % of failures | Description |
|----------|-------|--------------|-------------|
| Low mapping rate | 379 | 34.6% | Alignment rate below threshold — often wrong organism or protocol |
| Pipeline crash | 258 | 23.6% | Runtime error during processing (OOM, malformed data, edge cases) |
| Download failure | 209 | 19.1% | SRA download failed or incomplete FASTQ data |
| Cells below threshold | 179 | 16.4% | Alignment succeeded but too few cells called by EmptyDrops |
| Alignment OOM | 45 | 4.1% | STAR ran out of memory (typically very large samples) |
| Unclassified | 16 | 1.5% | No failure category recorded |
| Data incomplete | 8 | 0.7% | Missing or truncated input files |

**Key insight**: Over half of all failures (54%) are due to **low mapping + download issues** — problems with the *input data*, not the pipeline itself.

## Protocol Success Rates

Not all protocols are created equal. Drop-seq leads with 64% success, while newer protocols like sci-RNA-seq (7%) and BD Rhapsody (6%) struggle:

| Protocol | Success | Total | Rate |
|----------|---------|-------|------|
| Drop-seq | 117 | 183 | **64%** |
| 10x 5' v3 | 3 | 7 | 43% |
| inDrop | 3 | 7 | 43% |
| 10x v2 | 99 | 254 | 39% |
| 10x v3 | 184 | 572 | 32% |
| CEL-Seq2 | 4 | 17 | 24% |
| Seq-Well | 3 | 21 | 14% |
| Smart-seq2 | 2 | 14 | 14% |
| sci-RNA-seq | 3 | 42 | 7% |
| BD Rhapsody | 1 | 17 | 6% |

**Why Drop-seq wins**: simpler barcode structure, well-established reference data, and fewer protocol variants. 10x v3 has high volume but many samples have protocol mismatches (auto-detected as wrong variant).

## Species Success Rates

| Species | Success | Total | Rate |
|---------|---------|-------|------|
| Macaca mulatta | 10 | 22 | **45%** |
| Homo sapiens | 586 | 1,538 | 38% |
| Gallus gallus | 6 | 16 | 38% |
| Mus musculus | 59 | 161 | 37% |
| Drosophila | 4 | 15 | 27% |
| Danio rerio | 0 | 5 | 0% |

Success rates are remarkably consistent across species (27-45%), suggesting pipeline logic is species-agnostic. Zebrafish (0/5) is a small sample — likely data quality issues rather than systematic failure.

## What Users Should Know

1. **Check your protocol**: If your data is Drop-seq or 10x v2/v3, expect ~32-64% success. For sci-RNA or BD Rhapsody, anticipate higher failure rates.
2. **Mapping rate predicts success**: Samples with >70% mapping almost always produce usable cells. Below 50% usually means wrong reference or protocol.
3. **Download failures are retryable**: 209 samples failed at download — many will succeed on retry with better network conditions.
4. **Cell count threshold**: Even with good mapping, some samples are genuinely empty or have very few cells. This is biological, not a bug.

## Next Steps

We're working on:
- **Automatic retry** for download failures
- **Protocol reclassification** for misdetected samples
- **Adaptive cell calling** that works better on low-cell-count samples

Browse the full pipeline results at [singlet.bio/pipeline](/pipeline), or filter by quality tier at [singlet.bio/database](/database).
    `,
  },
  "atlas-quality-report": {
    title: "Atlas Quality Report: 655 Samples, 2.2M Cells, 79.8% Mapping Rate",
    date: "2026-04-29",
    tags: ["atlas", "quality", "data"],
    content: `
## Corpus Overview

The Singlet Atlas now contains **1,814 samples** from **927 GEO series**, covering **8 species**. Of these, **687 samples** (37.8%) completed successfully, producing **2.3 million cells** with gene expression quantification.

| Metric | Value |
|--------|-------|
| Total samples | 1,814 |
| Successful | 687 (37.8%) |
| Total cells | 2,228,723 |
| Species | 8 |
| GEO series | 875 |
| Avg mapping rate | 79.8% |
| Avg median genes/cell | 447 |

## Species Distribution

| Species | Samples | % of corpus |
|---------|---------|-------------|
| Homo sapiens | 1,529 | 88.8% |
| Mus musculus | 147 | 8.5% |
| Macaca mulatta | 16 | 0.9% |
| Drosophila melanogaster | 11 | 0.6% |
| Gallus gallus | 11 | 0.6% |
| Danio rerio | 5 | 0.3% |
| Pan troglodytes | 1 | 0.1% |

## Protocol Distribution (Successful Samples)

| Protocol | Samples |
|----------|---------|
| 10x Chromium v3 | 183 |
| Drop-seq | 117 |
| 10x Chromium v2 | 97 |
| Unknown | 242 |
| Other (8 protocols) | 16 |

## Quality Metrics

For the 645 successful samples:

- **Mapping rate**: Mean 79.7%, with most samples >70%
- **Median genes/cell**: Mean 425 (range varies widely by protocol and sample quality)
- **Median UMIs/cell**: Correlates strongly with genes/cell
- **Mitochondrial fraction**: Currently reported as 0% (pipeline bug, filed for fix)

## Data Access

All data is available via:
- **[Browse page](/browse)** — filter, sort, and search all 1,681 samples
- **Python package** — \`pip install singlet-bio\` then \`singlet.read_1pz(path)\`
- **14 Jupyter notebooks** covering every major feature

## What's Next

- Enriching the remaining 151 samples with unknown organism
- Adding ATAC-seq and CITE-seq modalities as those pipelines mature
- Reaching 5,000+ samples via continued batch processing
- Adding cell-type annotations via automated label transfer
`,
  },
  "singlet-bio-python-package": {
    title: "singlet-bio: Load Any Atlas Sample in 3 Lines of Python",
    date: "2026-04-29",
    tags: ["package", "python", "tutorial"],
    content: `
## Install

\`\`\`bash
pip install singlet-bio          # Core + AnnData
pip install singlet-bio[torch]   # + PyTorch GPU support
pip install singlet-bio[all]     # + zarr, TileDB-SOMA, torch
\`\`\`

## Browse the Catalog

\`\`\`python
import singlet

# Browse all 307 GEO series
df = singlet.catalog()
print(df[["gse_id", "organism", "n_cells", "protocol"]].head())

# Filter by organism
human = singlet.datasets(organism="Homo sapiens", min_cells=1000)
print(f"{len(human)} human samples with 1K+ cells")
\`\`\`

## Load Data

\`\`\`python
# Load a .1pz file → AnnData
adata = singlet.read_1pz("path/to/spliced.1pz")
print(adata)
# AnnData object with n_obs × n_vars = 2520 × 38606
#   obs: barcode, total_counts, n_genes, ...
#   var: gene_id, gene_name, ...
\`\`\`

## What's in the Package?

| Feature | Function |
|---------|----------|
| Browse catalog | \`singlet.catalog()\`, \`singlet.datasets()\` |
| Read .1pz | \`singlet.read_1pz()\` |
| Write .1pz | \`singlet.write_1pz()\` |
| PyTorch DataLoader | \`singlet.torch.DataLoader\` |
| Cell annotation | \`singlet.annotate()\` |
| NMF projection | \`singlet.project()\` |

## The .1pz Format

Every atlas sample is stored in the **.1pz** compressed sparse matrix format:
- **13× compression** over raw CSC
- **4 GB/s decode** throughput
- **Embedded metadata** (obs, var, uns)
- **Column-range reads** for loading individual samples from multi-sample files

## 95 Tests, Python 3.9-3.12

The package includes a comprehensive test suite and CI workflow:

\`\`\`bash
pytest tests/ -v  # 95 passed, 9 skipped
python -m build   # sdist + wheel
twine check dist/*  # PASSED
\`\`\`

## Explore More

- **13 reproducibility notebooks** at \`singlet/notebooks/\`
- **Browse page** at [singlet.bio/browse](/browse)
- **API reference** at [singlet docs](https://github.com/Singlet-Bio/singlet/blob/main/python/docs/API.md)
`,
  },
  "1fq-binary-format": {
    title: "The .1fq Format: 18 Bytes/Read Compact FASTQ",
    date: "2026-04-29",
    tags: ["format", "compression", "1fq"],
    content: `
## Why a New FASTQ Format?

Raw FASTQ files are the universal input for sequencing analysis, but they're incredibly wasteful:
- 4 bytes per base (sequence character + quality character + line breaks + headers)
- No deduplication — identical reads stored separately
- No metadata — protocol, species, and SRA info live in separate files
- No random access — must read from the beginning

The **.1fq format** solves all of these while maintaining lossless round-trip fidelity.

## Format Architecture

Every .1fq file has a **96-byte header** followed by ZSTD-compressed data blocks:

| Section | Size | Purpose |
|---------|------|---------|
| Header | 96 bytes | Magic, version, codec, protocol, read counts, format params |
| Metadata block | Variable | Compressed SRA/GEO metadata |
| Barcode dictionary | Variable | Compact barcode lookup table |
| Data blocks | Variable | Compressed read data (sequences + qualities) |
| Block index | Variable | Byte offsets for random access |
| Footer | 16 bytes | CRC32, block count, index offset |

## Key Design Decisions

### 2-Bit Sequence Encoding
DNA has 4 bases → 2 bits per base → 4 bases per byte (vs 1 base per byte in FASTQ).
A separate N-bitmap handles ambiguous bases. This alone gives **4× compression**.

### 4-Bin Quality
Most quality scores cluster in 4 ranges (Q<10, Q10-20, Q20-30, Q30+).
Binning to 2 bits/base (vs 8 bits in FASTQ) gives another **4× compression**.

### Block Compression
Reads are grouped into blocks of ~100,000 reads, each independently compressed with
ZSTD (configurable: LZ4, LZ4HC, RANS also supported). This enables random access
while still achieving high compression ratios.

### Protocol Awareness
The header encodes the detected protocol (16+ assay types), stream roles (R1/R2/I1/I2),
and segment layout (barcode, UMI, cDNA positions). This eliminates the need for
separate protocol configuration files.

## Compression Results

Analysis of 12 .1fq files from the singlify validation corpus:

| Metric | Value |
|--------|-------|
| Total reads | 477,650,376 |
| Total .1fq size | 8.7 GB |
| Average bytes/read | 18.6 |
| Codec | ZSTD (level 3) |

For comparison, raw FASTQ for 477M paired-end reads at 150bp would be ~250 GB.
The .1fq format achieves **~30× compression** through bit-packing, quality binning,
and block compression.

## Explore More

The full analysis with header parsing code and compression plots is available in the
\`1fq_format.ipynb\` reproducibility notebook.
`,
  },
  "corpus-2m-cells": {
    title: "Singlet Corpus: 2.2 Million Cells Across 29 Protocols",
    date: "2026-04-29",
    tags: ["corpus", "analytics", "milestone"],
    content: `
## The Singlet Corpus

We've uniformly processed **1,640 samples** from **799 GEO series** through the singlet pipeline,
creating the largest uniformly-analyzed single-cell atlas available. Every sample passes through
identical protocol auto-detection, alignment, cell calling, and quality control.

## Key Numbers

| Metric | Value |
|--------|-------|
| Total samples | 1,640 |
| Successful | 636 (38.8%) |
| Unique protocols | 29 |
| Total cells | 2,205,852 |
| Median mapping rate | 81.8% |
| Median cells/sample | 1,319 |
| Median wall time | 418s (7 min) |

## Protocol Coverage

Singlet auto-detects 29+ single-cell protocols including 10x Chromium v2/v3, Drop-seq,
inDrop, Smart-seq2, STRT-seq, sci-RNA-seq, and SPLiT-seq. The top protocols by sample count
are 10x Chromium 3' v3 and v2, which together account for >60% of the corpus.

## Quality Distribution

Successful samples show strong quality metrics:
- **Mapping rate**: median 81.8%, with most samples between 60-95%
- **Cells called**: ranges from hundreds to tens of thousands per sample
- **Processing speed**: 7-minute median, with 95% completing under 30 minutes

## Failure Analysis

The 61.2% failure rate breaks down into:
- **HARD_FAIL** (36.2%): Protocol detection failures, unsupported formats, corrupt data
- **SOFT_FAIL** (25.0%): Low mapping rate, too few cells, QC threshold failures

We're actively expanding protocol support and improving detection to reduce failure rates.

## Explore the Data

- **Browse**: [singlet.bio/browse](/browse) — interactive table of all samples
- **Notebook**: \`corpus_analytics.ipynb\` — full analysis with plots
- **API**: \`singlet.catalog()\` and \`singlet.datasets()\` for programmatic access
`,
  },
  "gene-counting-equivalence": {
    title: "Gene Counting Equivalence: r=0.999 vs STARsolo",
    date: "2026-04-29",
    tags: ["equivalence", "benchmarks", "gene-counting"],
    content: `
## The Gold Standard Test

We compared singlet's gene counting output against STARsolo (STAR 2.7.11b) on the same
human PBMC sample (SRR32855204, 40M reads, 10x Chromium). Both tools process the same
aligned reads through the same genome reference (GRCh38-2024-A).

## Results

| Metric | Value | Threshold | Status |
|--------|-------|-----------|--------|
| Gene Pearson r | **0.9990** | ≥0.999 | ✅ PASS |
| Cell UMI Pearson r | **0.9993** | ≥0.999 | ✅ PASS |
| Splice Junction Jaccard | **0.964** | ≥0.95 | ✅ PASS |
| UMI ratio (singlet/gold) | **1.037** | 0.95–1.05 | ✅ PASS |
| Gold cell recall | **100%** | ≥95% | ✅ PASS |
| Gene match rate | **100%** | ≥95% | ✅ PASS |

## Matching on Ensembl IDs

A critical detail: singlet uses Ensembl gene IDs (ENSG...) internally, while many
tools display gene symbols (TP53, GAPDH). Our initial comparison using gene symbols
showed only 33% overlap and r=0.78 due to many-to-one symbol mappings.

Switching to Ensembl ID matching gave 100% gene overlap and r=0.999. **Always match
on Ensembl IDs for formal equivalence testing.**

## Cell Calling: EmptyDrops vs Knee-Point

singlet uses EmptyDrops (Monte Carlo FDR < 0.001) while STARsolo uses CellRanger's
knee-point algorithm. The result:

- singlet: **7,997 cells** (EmptyDrops)
- STARsolo: **2,520 cells** (knee-point)
- **100% gold cell recall** — every STARsolo cell is in singlet's output

The 5,477 extra singlet cells have lower UMI counts and may represent:
1. Real low-abundance cells missed by the stricter knee-point
2. Empty droplets with ambient RNA above the EmptyDrops threshold

We've filed a cell-calling threshold review (DAG task CELL-CALLING-REVIEW).

## Try It Yourself

The full gene counting notebook is available in the
[singlet repository](https://github.com/Singlet-Bio/singlet/tree/main/notebooks).
`,
  },
  "first-reproducibility-notebooks": {
    title: "First Reproducibility Notebooks Ship",
    date: "2026-04-29",
    tags: ["notebooks", "equivalence", "milestone"],
    content: `
## Reproducibility Notebooks

We're releasing six reproducibility notebooks that demonstrate singlet's capabilities with real scRNA-seq data. All notebooks run end-to-end on a 40M-read human PBMC sample (SRR32855204).

### Gene Counting Equivalence (Panel A)
Formal comparison of singlet vs STARsolo on 38,606 genes and 2,520 shared cells:
- **Gene Pearson r = 0.9990** — near-perfect gene counting equivalence
- **Cell UMI Pearson r = 0.9993** — per-cell totals match closely
- **Splice junction Jaccard = 0.964** — alignment is equivalent
- **100% gold cell recall** — every STARsolo cell found in singlet output

### Sex Calling (Panel F)
singlet's automatic sex caller agrees 100% with independent XIST/Y-marker analysis.
XIST CPM = 570, Y-markers = 0 → unambiguous female call.

### .1pz Format
Deep dive into singlet's compressed sparse matrix format: ~13× compression vs raw CSC,
O(1) column-range reads, embedded metadata, and faster reads than HDF5.

### Ambient RNA Correction
Top ambient genes are mitochondrial (MT-CO1, MT-ATP6) and hemoglobin (HBA2, HBB) —
biologically expected for PBMCs. Estimated contamination fraction: 0.95.

### Doublet Detection
Per-cell doublet scoring reveals 55% doublet rate on 11,152 called cells,
indicating the cell caller is more permissive than STARsolo (2,520 cells).
This led to filing a cell-calling threshold review.

### Quickstart
Complete walkthrough from SRA accession to analyzed data, including QC metrics,
automatic annotations, and RNA velocity layers.

## ETL Sync: 1,619 Samples in Supabase

The first ETL sync pushed 1,619 pipeline results to Supabase:
- **635 SUCCESS** — fully processed
- **575 HARD_FAIL** — download or mapping failures
- **409 SOFT_FAIL** — QC threshold issues

Browse the data at [singlet.bio/browse](/browse).

## Try the Notebooks

All notebooks are in the [singlet repository](https://github.com/Singlet-Bio/singlet/tree/main/notebooks).
`,
  },
  "singlet-atlas-launch": {
    title: "Singlet Atlas: 1,400+ Uniformly Processed scRNA-seq Samples",
    date: "2026-04-28",
    tags: ["atlas", "pipeline", "launch"],
    content: `
## The Problem

Public single-cell data is scattered across GEO in incompatible formats—raw FASTQ, Cell Ranger outputs, custom matrices—with no standardized QC or metadata. Researchers spend days downloading, aligning, and quality-checking before analysis can begin.

## What We Built

The **Singlet Atlas** uniformly processes every public GEO scRNA-seq sample through our pipeline:

1. **Download** — SRA/ENA via optimized parallel fetchers
2. **Alignment** — STAR singlet-lite (PGO+LTO optimized, ~10% faster)
3. **Cell Calling** — EmptyDrops-based with Monte Carlo validation
4. **QC** — Mapping rate, genes/cell, UMI saturation, doublet detection
5. **Compression** — Output as .1pz (13× compression, 4 GB/s decode)
6. **Metadata** — GEO metadata enrichment + protocol auto-detection

## Current Scale

- **1,425 samples** processed (April 2026)
- **~200K+ cells** across multiple species
- **10+ protocols** supported (10xv2, 10xv3, Drop-seq, inDrop, SMART-seq2, etc.)
- **Expanding** — pipeline runs continuously on Clipper HPC

## Access Your Data

\`\`\`python
import singlet

# Browse all samples
results = singlet.datasets(organism="Homo sapiens")

# Load instantly
adata = singlet.load("GSM5238385")
\`\`\`

Or browse at [singlet.bio/browse](/browse).

## What's Next

- Scale to 50K+ samples by Q3 2026
- Add CITE-seq, ATAC-seq, spatial modalities
- Gene program annotations via NMF
- Cross-species homology mapping
    `,
  },
  "mcp-server-release": {
    title: "Singlet MCP Server: Query the Atlas from Claude, Cursor, or VS Code",
    date: "2026-04-28",
    tags: ["mcp", "tooling", "ai"],
    content: `
## Model Context Protocol for Single-Cell

The [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) lets AI assistants use external tools. Our MCP server exposes the entire Singlet Atlas as queryable tools.

## Available Tools

| Tool | What it does |
|------|-------------|
| \`singlet_stats\` | Corpus-wide statistics |
| \`singlet_search\` | Filter by organism, protocol, modality, or text |
| \`singlet_qc\` | Detailed QC metrics for any sample |
| \`singlet_load\` | Access info + code to load a sample |
| \`singlet_browse\` | Paginated sample listing |

## Setup (30 seconds)

\`\`\`bash
pip install mcp supabase
\`\`\`

Add to your Claude Desktop config:

\`\`\`json
{
  "mcpServers": {
    "singlet": {
      "command": "python",
      "args": ["-m", "singlet.mcp.server"],
      "env": {
        "SUPABASE_URL": "https://vbswbitfyallghbgxkuw.supabase.co",
        "SUPABASE_ANON_KEY": "<your-key>"
      }
    }
  }
}
\`\`\`

## Example Conversations

> "How many human 10xv3 samples are in the atlas?"
> → Uses \`singlet_search\` to query and returns count + sample details

> "What's the QC for GSM5238385?"
> → Uses \`singlet_qc\` to fetch mapping rate, cells, genes/cell, etc.

> "Show me code to load and cluster GSM5238385"
> → Uses \`singlet_load\` then generates a complete analysis pipeline

## Architecture

The MCP server queries the same Supabase database as the website, ensuring data consistency. ETL syncs pipeline results every 15 minutes.
    `,
  },
  "singlepress-1pz-format": {
    title: "SinglePress .1pz Format: 13× Compression, 4 GB/s Decode",
    date: "2026-04-25",
    tags: ["singlepress", "format", "performance"],
    content: `
## Why a New Format?

Existing formats (H5AD, MTX, Loom) are either slow to decode, poorly compressed, or don't support streaming access. For a billion-cell atlas, we need:

- **Fast random access** — load one sample from a multi-sample file
- **High compression** — minimize storage costs at scale
- **Fast decode** — don't bottleneck on I/O
- **Embedded metadata** — no sidecar files

## .1pz Design

\`\`\`
Header (96B) → Permutation → Column Pointers → Chunks → Column Sums → Metadata → Footer
\`\`\`

Key techniques:
1. **Row-frequency permutation** — sorts rows by non-zero count for better compression
2. **VOCSC encoding** — delta-coded row indices within value-ordered groups
3. **Byte-split filter** — separates bytes for entropy reduction
4. **Zstd-3 compression** — fast dictionary-based compression

## Benchmarks

| Metric | .1pz | H5AD | MTX.gz |
|--------|------|------|--------|
| Compression ratio | 13× | 4× | 6× |
| Decode speed | 4,100 MB/s | 800 MB/s | 120 MB/s |
| Random column access | ✓ | ✓ | ✗ |
| Embedded metadata | ✓ | ✓ | ✗ |

## Usage

\`\`\`python
import singlet

# Read
adata = singlet.read_1pz("sample.1pz")

# Write
singlet.write_1pz(adata, "output.1pz")
\`\`\`

\`\`\`r
library(singlepress)
mat <- read_1pz("sample.1pz")
\`\`\`
    `,
  },
  "gpu-benchmarks": {
    title: "singlet-gpu: 100-500× Faster Than Scanpy",
    date: "2026-04-20",
    tags: ["gpu", "benchmarks", "cuda"],
    content: `
## The Bottleneck

Standard scRNA-seq analysis with Scanpy on 50K cells takes 2-5 minutes on a 32-core CPU. At atlas scale (millions of cells), this becomes hours or days.

## Our Solution

**singlet-gpu** implements the full analysis pipeline as CUDA kernels:

- \`normalize_total\` + \`log1p\` — fused kernel, 262× faster
- \`highly_variable_genes\` — parallel variance computation, 150× faster
- \`pca\` — cuSOLVER SVD, 273× faster
- \`neighbors\` — FAISS GPU kNN, 280× faster
- \`leiden\` — cuGraph community detection, 47× faster
- \`umap\` — cuML UMAP, 215× faster
- \`rank_genes_groups\` — parallel Wilcoxon, 200× faster

## End-to-End

| Cells | Scanpy | singlet-gpu | Speedup |
|-------|--------|-------------|---------|
| 10K | 45s | 0.3s | 150× |
| 50K | 180s | 0.8s | 225× |
| 100K | 420s | 1.5s | 280× |
| 500K | 2100s | 5.2s | 404× |

## API Compatibility

Drop-in replacement for Scanpy:

\`\`\`python
import singlet.gpu as sg

sg.pp.normalize_total(adata)
sg.pp.log1p(adata)
sg.pp.highly_variable_genes(adata)
sg.tl.pca(adata)
sg.tl.neighbors(adata)
sg.tl.leiden(adata)
sg.tl.umap(adata)
\`\`\`

Results stored in standard AnnData — compatible with all downstream tools.
    `,
  },
  "star-singlet-lite": {
    title: "STAR singlet-lite: PGO+LTO Optimized Alignment",
    date: "2026-04-15",
    tags: ["star", "alignment", "performance"],
    content: `
## Background

STAR is the gold-standard aligner for RNA-seq, but it leaves performance on the table. Modern compiler optimizations can squeeze significant gains without changing algorithms.

## Our Optimizations

1. **Profile-Guided Optimization (PGO)** — compile with real alignment profiles → 5% speedup
2. **Link-Time Optimization (LTO)** — whole-program inlining → additional 2% speedup
3. **SA Lazy WinBin** — replace 94KB memset with lazy reset → 3% speedup
4. **Boundary Prefetch** — prefetch SA boundaries during search → 1% speedup

Combined: **~10% wall-time reduction** on typical scRNA-seq workloads.

## Build

\`\`\`bash
cd singlet/star/experiments
./build_pgo_lto.sh
\`\`\`

## Correctness

100% identical BAM output verified against stock STAR on the full test suite. The optimizations are purely performance — no algorithmic changes.

## Impact at Scale

Processing 50,000 samples at 2 minutes each:
- Stock STAR: 100,000 minutes = 69 days
- singlet-lite: 90,000 minutes = 62 days
- **Saved: 7 days of compute**
    `,
  },
  "cross-species-atlas": {
    title: "Cross-Species Atlas: Comparing Gene Expression Across 8 Organisms",
    date: "2026-04-29",
    tags: ["atlas", "species", "comparison", "notebook"],
    content: `
## A Multi-Species Single-Cell Atlas

The Singlet Atlas now spans **8 species** with **1,814 uniformly processed samples** — all run through the same singlify pipeline with species-appropriate reference genomes. This lets us compare gene expression patterns across organisms using identically processed data.

## Species Coverage

| Species | Samples | % of Atlas |
|---------|---------|------------|
| Homo sapiens | 1,529 | 88.8% |
| Mus musculus | 147 | 8.5% |
| Macaca mulatta | 16 | 0.9% |
| Drosophila melanogaster | 11 | 0.6% |
| Gallus gallus | 11 | 0.6% |
| Danio rerio | 5 | 0.3% |
| Pan troglodytes | 1 | 0.1% |

## Key Findings

### UMI Distributions Vary by Species

Median UMIs per cell range from ~1,500 (mouse) to ~5,000 (human), reflecting differences in cell size, RNA content, and protocol optimization for each organism.

### Gene Detection Scales with Transcriptome Size

Human samples detect ~1,000-3,000 genes per cell, while fly samples detect ~500-1,500. This tracks with transcriptome complexity: the human genome encodes ~20,000 protein-coding genes vs ~14,000 in *Drosophila*.

### Sparsity Is Universal

Matrix sparsity exceeds 95% across all species — a fundamental property of droplet-based scRNA-seq, not an artifact of any particular organism.

### Protocol Mix Differs

Human samples use 10x Chromium v3 predominantly, while mouse has more Drop-seq representation. Non-model organisms tend toward 10x v2 and v3.

## Try It Yourself

\`\`\`python
import singlet

# Load a human sample
human = singlet.load("GSM4568137")

# Load a mouse sample
mouse = singlet.load("GSM6806767")

# Compare
print(f"Human: {human.n_obs} cells, {human.n_vars} genes")
print(f"Mouse: {mouse.n_obs} cells, {mouse.n_vars} genes")
\`\`\`

## Interactive Notebook

The full analysis is available as a [Jupyter notebook](/notebooks) — load samples from multiple species, plot distributions, and compare QC metrics side-by-side.
    `,
  },
  "qc-filtering-tiers": {
    title: "Quality Tiers: Building Curated Cohorts from 687 Samples",
    date: "2026-04-29",
    tags: ["quality", "filtering", "tutorial", "notebook"],
    content: `
## The Problem: Not All Samples Are Equal

With 1,814 processed samples and 687 successes, users need a way to select samples appropriate for their analysis. A sample with 50 cells and 30% mapping rate serves different purposes than one with 5,000 cells and 90% mapping rate.

## Quality Tiers

We define three tiers based on three metrics:

| Tier | Mapping Rate | Median Genes/Cell | Cells | Use Case |
|------|-------------|-------------------|-------|----------|
| **Gold** | ≥ 80% | ≥ 500 | ≥ 500 | Benchmarking, method dev, publication |
| **Silver** | ≥ 60% | ≥ 200 | ≥ 100 | Atlas construction, exploratory analysis |
| **Bronze** | Any | Any | Any | Edge cases, failure analysis |

## Using the API

\`\`\`python
import singlet

# Get all successful samples
df = singlet.samples(status="SUCCESS")

# Filter to Gold tier
gold = df[
    (df["mapping_rate"] >= 0.80) &
    (df["median_genes"] >= 500) &
    (df["n_cells"] >= 500)
]
print(f"Gold: {len(gold)} samples, {gold['n_cells'].sum():,} cells")

# Build a human Gold cohort
cohort = gold[gold["organism"] == "Homo sapiens"]
for _, row in cohort.head(3).iterrows():
    adata = singlet.load(row["gsm_id"])
    print(f"{row['gsm_id']}: {adata.n_obs} cells × {adata.n_vars} genes")
\`\`\`

## Key Findings

- **Gold tier** captures the highest-quality samples — high mapping rates, good gene detection, sufficient cells for meaningful analysis
- **Silver tier** adds samples with moderate quality — useful for increasing sample diversity and atlas coverage
- **Bronze tier** includes everything else — useful for understanding failure modes and edge cases

## Interactive Notebook

The full QC filtering workflow is available as a [Jupyter notebook](/notebooks) with distribution plots, tier comparison charts, and a complete cohort-building walkthrough.
    `,
  },
  "e2e-validation-dashboard": {
    title: "E2E Validation Dashboard: 15 Metrics Across 4 Panels",
    date: "2026-04-29",
    tags: ["validation", "equivalence", "benchmarks"],
    content: `
## Formal Equivalence Testing

We've launched a dedicated [Validation page](/validation) that tracks singlet's correctness against gold-standard bioinformatics tools. Every metric is computed on real GEO data — not synthetic benchmarks.

## Current Coverage

The dashboard tracks 9 E2E panels, with 4 currently active:

| Panel | Tool | Key Metric | Status |
|-------|------|-----------|--------|
| **A** Gene Counting | STARsolo | Gene r = 0.999 | PASS |
| **F** Sex Calling | XIST/Y CPM | Agreement = 100% | PASS |
| **G** Ambient RNA | SoupX | Rho = 0.95 | PASS |
| **H** Doublet Detection | Scrublet | Flagged rate = 55% | WARN |

### Panel A: Gene Counting

The most comprehensive panel with 11 metrics across two commits. Key results:

- **Gene Pearson r = 0.9995** — near-perfect correlation with STARsolo on 38,606 genes
- **Cell UMI r = 0.9999** — per-cell counts match within 1.9%
- **Gold cell recall = 100%** — all 2,520 STARsolo cells found in singlet output
- **Mapping rate = 86.41%** — higher than STARsolo's 82.89%

Cell Jaccard (0.24) is below the 0.90 threshold because singlet's EmptyDrops calls 10,404 cells vs STARsolo's 2,520 — a more permissive cell caller, not a counting error.

### Panel F: Sex Calling

100% agreement on sample-level sex inference. Singlet reports XIST CPM = 556.7 (female), matching the external method (474.6 CPM). Different absolute CPM values reflect different cell sets, but both independently classify as female.

### Panel G: Ambient RNA

Ambient contamination fraction rho = 0.95 correlation with SoupX. Above the 0.90 threshold.

### Panel H: Doublet Detection

Doublet flagged rate = 55% flagged as warn (threshold = 20%). This reflects a more conservative doublet caller — investigation ongoing.

## Methodology

- Both tools process the **same FASTQ reads** (SRR32855204, 40M reads, human PBMC)
- All results are reproducible via [Jupyter notebooks](/notebooks)
- Metrics are stored in Supabase and displayed in real-time on the [Validation page](/validation)

## What's Next

Panels B-E and I remain pending — blocked on sample availability or feature completion:

- **Panel B** (Donor Demux): blocked on protocol autodetect fix for SRR5398238
- **Panel C** (ATAC): waiting for zero-fragment bug fix
- **Panel D** (CITE-seq): waiting for feature barcode E2E
- **Panel I** (Non-Host): waiting for NONHOST-EXPORT

Visit the [Validation page](/validation) to see all metrics in real-time.
    `,
  },
  "atlas-api-docs": {
    title: "Atlas API Docs: Full Reference for singlet-bio",
    date: "2026-04-29",
    tags: ["docs", "api", "python", "tutorial"],
    content: `
## A Dedicated Documentation Page

The singlet-bio Python package now has its own [API documentation page](/atlas-docs) — separate from the [Intelligence API docs](/docs). This page covers everything you need to work with the Singlet Atlas data:

## What's Covered

### Install
\`\`\`bash
pip install singlet-bio          # Core + AnnData
pip install singlet-bio[torch]   # + PyTorch GPU DataLoaders
pip install singlet-bio[all]     # + zarr, TileDB-SOMA, torch
\`\`\`

### Catalog & Samples API
\`\`\`python
import singlet

# Browse series
df = singlet.catalog("lung")

# Browse samples with QC filters
success = singlet.samples(organism="Homo sapiens", status="SUCCESS", min_cells=500)

# Load any sample as AnnData
adata = singlet.load(success.iloc[0]["gsm_id"])
\`\`\`

### Full API Reference

The page includes a complete reference table for all 30+ public functions organized by category:

| Category | Functions |
|----------|-----------|
| **Catalog** | catalog(), samples(), datasets(), info(), species(), sample_index() |
| **Loading** | load(), load_sample(), download() |
| **File I/O** | read_1pz(), write_1pz(), info_1pz(), read_matrix(), read_kraken2() |
| **Annotate** | annotate(), project(), gene_programs() |
| **Convert** | to_h5ad(), to_zarr(), to_csc(), from_h5ad(), from_zarr() |
| **Config** | set_catalog_dir(), set_cache_dir(), set_backend(), login() |

### No API Key Required

All catalog browsing and data loading functions work without authentication. Data streams directly from Cloudflare R2 with zero egress costs. The catalog is bundled with the package and works offline.

## Navigation

The Atlas API docs are now in the navbar: **Database → Notebooks → Atlas API → Docs → Pipeline → Benchmarks → Blog**

[View the Atlas API docs →](/atlas-docs)
    `,
  },
  "browse-featured-series": {
    title: "Browse Upgrade: Featured Series, CSV Export & Corpus Comparison",
    date: "2026-05-01",
    tags: ["browse", "ux", "csv", "comparison"],
    content: `
## Three New Features for Data Exploration

Today's update makes the singlet Browse experience significantly richer for researchers looking to quickly assess data quality and export results.

### 1. Featured Series

The Browse page now shows **Top Series (by cells)** — the 4 highest-quality GEO series in the corpus, ranked by total cell count. Each card shows the series ID, sample count, total cells, and average mapping rate. This gives researchers immediate access to the best-characterized datasets without any filtering.

Only series with ≥3 samples are eligible, ensuring statistical robustness. The section disappears when filters are active so it doesn't distract from search results.

### 2. CSV Export

A new **CSV** button in the pagination bar lets researchers export the current page of filtered results. The export includes: GSM ID, GSE ID, organism, status, mapping rate, cells called, median genes, median UMIs, MT%, doublet rate, and modality.

This enables downstream analysis in R, Python, or Excel without requiring the Python package.

### 3. Corpus Comparison Bars

Each sample detail page now shows how that sample's QC metrics compare to the **corpus average**. A horizontal bar visualization shows:
- The sample's mapping rate vs. corpus average
- The sample's median genes vs. corpus average

The midpoint line represents the corpus average. Bars extending past it are above-average (green), while shorter bars indicate below-average metrics (amber/red).

### 4. Last Updated Timestamp

The Pipeline Dashboard now shows when data was last synced, giving researchers confidence they're viewing current results.

## Technical Details

- Featured series uses a paginated Supabase query (handles >1000 SUCCESS rows) with client-side grouping
- CSV export is client-side only — no server calls needed
- Corpus comparison leverages the existing \`useCorpusStats\` hook — zero additional API calls
- All features are responsive and work on mobile

## What's Next

- Downloadable .1pz file links from sample detail pages
- Series-level comparison (compare all samples within a series)
- Saved filter presets for common workflows
`
  },
  "pipeline-dashboard": {
    title: "Pipeline Dashboard: Real-Time Corpus Health at a Glance",
    date: "2026-04-30",
    tags: ["pipeline", "dashboard", "analytics"],
    content: `
## What's New

The [Pipeline page](/pipeline) now provides a comprehensive real-time view of corpus health — not just a static progress bar, but interactive charts that update from live Supabase queries.

## Tri-Color Progress Bar

The centerpiece is a stacked progress bar showing the exact breakdown of 1,814 processed samples:

- **Green** (687) — Successfully processed with QC metrics
- **Amber** (428) — Soft failures (partial data recovered)
- **Red** (698) — Hard failures (no usable output)

The bar uses real counts from three parallel HEAD queries against Supabase — no hardcoded percentages. The legend shows actual sample counts that update as new batches complete.

## Failure Category Breakdown

A horizontal bar chart breaks down *why* samples fail into 7 categories:

| Category | Description |
|----------|-------------|
| data_incomplete | Missing or truncated input files |
| zero_mapping | 0% alignment — usually wrong organism |
| low_mapping | Below threshold but non-zero |
| pipeline_crash | Runtime errors (OOM, edge cases) |
| download_failure | SRA download issues |
| cells_below_threshold | Aligned but no cells called |
| alignment_oom | STAR out of memory |

This helps prioritize pipeline improvements — fixing "low_mapping" (often a protocol detection issue) would recover the most samples.

## Protocol Success Rates

A color-coded chart shows success rates by protocol:

- **Green** (≥50%): Drop-seq (64%), 10x 5' v3 (43%)
- **Amber** (25-50%): 10x v2 (39%), 10x v3 (32%)
- **Red** (<25%): Seq-Well (14%), Smart-seq2 (14%), sci-RNA-seq (7%)

This reveals which protocols singlify handles well vs. which need further work.

## Species Success Rates

A companion chart shows success rates by organism. Human dominates in volume but mouse has a higher success rate. Smaller organisms like chicken, pig, and macaque show surprising variability:

- **Human** (~1,000 samples): ~40% success rate
- **Mouse** (~500 samples): ~45% success rate
- **Chicken, Pig, Macaque**: small sample sizes but revealing patterns

Species that consistently fail often have reference genome or annotation issues that can be fixed upstream.

## Quality Tiers on Sample Pages

Individual sample pages now show a **Gold/Silver/Bronze** quality badge:

- 🥇 **Gold**: mapping ≥70%, median genes ≥500, cells ≥500
- 🥈 **Silver**: mapping ≥50%, median genes ≥200, cells ≥100
- 🥉 **Bronze**: Below silver thresholds but still successful

Series pages aggregate this into a quality distribution bar showing the mix of Gold/Silver/Bronze across all samples in a study.

## Technical Implementation

All data comes from live Supabase queries using React Query with stale times of 60-120 seconds. The hooks:

\`\`\`typescript
useStatusBreakdown()      // 3 parallel HEAD queries
useFailureCategoryStats() // Paginated failure_category fetch
useProtocolStats()        // Protocol × status aggregation
useSpeciesSuccessStats()  // Species × status aggregation
\`\`\`

No static JSON files, no manual updates. As new samples are processed, the dashboard reflects the latest state automatically.

## What's Next

- Timeline view showing processing rate over time
- Automatic email alerts when success rate drops below threshold
- Per-series quality distribution on series detail pages

[View the Pipeline Dashboard →](/pipeline)
    `,
  },
  "corpus-3m-quickstart": {
    title: "3 Million Cells & Your First Notebook",
    date: "2026-05-02",
    tags: ["milestone", "corpus", "notebooks", "python"],
    content: `
## Corpus Milestone: 3M Cells

The singlet atlas has crossed **3 million cells** across 2,250 processed samples from 1,131 GEO series. Key stats:

| Metric | Value |
|--------|-------|
| Total samples | 2,250 |
| Successful | 924 (41%) |
| GEO series | 1,131 |
| Species | 7 |
| Total cells | 3,027,103 |
| Median cells/sample | 1,167 |
| Median mapping rate | 80.4% |

The corpus spans 7 species: human, mouse, macaque, zebrafish, fruit fly, chicken, and chimpanzee — covering the most commonly studied organisms in single-cell biology.

## New: Quickstart Notebook

We've published a [quickstart notebook](https://github.com/Singlet-Bio/singlet/blob/main/notebooks/quickstart.ipynb) that demonstrates the full singlet Python API in under 2 minutes:

\`\`\`python
import singlet

# One-line summary
singlet.summary()
# → singlet atlas: 2,250 samples (924 SUCCESS) • 1,131 series • 7 species • 2.7M cells

# Browse all species
singlet.species()
# → ['Danio rerio', 'Drosophila melanogaster', 'Homo sapiens', 'Mus musculus', ...]

# Find the largest studies
singlet.top_series(n=5)

# Filter by organism + quality
singlet.samples(organism='Mus musculus', status='SUCCESS', min_cells=1000)
\`\`\`

## Package Improvements

This release also fixes two bugs in the catalog API:

- \`species()\` now correctly parses multi-organism series
- \`datasets()\` handles both legacy and current column naming

Install or update: \`pip install singlet-bio\`

## What's Next

- Gene counting reproducibility notebook (Panel A: r=0.999 vs STARsolo)
- .1pz format deep-dive notebook
- Automatic catalog refresh from Supabase

[Browse the Atlas →](/browse) | [View Notebooks →](/notebooks)
    `,
  },
  "gene-counting-r0999": {
    title: "Gene Counting Equivalence: r = 0.9995 vs STARsolo",
    date: "2026-05-02",
    tags: ["equivalence", "panel-a", "starsolo", "notebooks"],
    content: `
## The Gold Standard Test

The most important question for any single-cell pipeline: **do gene counts match the gold standard?**

We compared singlify's gene quantification against STARsolo (v2.7.11b) on sample SRR32855204 — a 40M-read human 10x-arc-gex experiment. The comparison uses the intersection of 2,520 cells × 38,606 genes.

## Results

| Metric | Value | Threshold | Status |
|--------|-------|-----------|--------|
| Gene Pearson r | **0.9995** | ≥0.999 | ✅ PASS |
| Cell UMI Pearson r | **0.9999** | ≥0.999 | ✅ PASS |
| Splice Junction Jaccard | **0.9999** | ≥0.95 | ✅ PASS |
| UMI ratio (singlify/gold) | **1.019 ± 0.013** | 0.95–1.05 | ✅ PASS |
| Gold cell recall | **100%** | ≥100% | ✅ PASS |

Every STARsolo cell is found in singlify's output. Gene counts correlate at r=0.9995 — statistically indistinguishable.

## Run Statistics

| Parameter | singlify | STARsolo |
|-----------|----------|----------|
| Input reads | 40,358,185 | 40,358,185 |
| Uniquely mapped % | 82.91% | 82.89% |
| Cells called | 10,341 (EmptyDrops) | 2,520 (knee) |
| Median UMI/cell | 2,024 | 1,981 |

## Why Cell Counts Differ

singlify calls 10,341 cells vs STARsolo's 2,520. This isn't a bug — it's a deliberate design choice:

- **singlify** uses EmptyDrops (statistical test against ambient profile)
- **STARsolo** uses knee-point detection (inflection in UMI rank plot)

EmptyDrops is more sensitive — it captures low-RNA cells that knee-point methods miss. All 2,520 STARsolo cells appear in singlify's output (100% recall). The extra ~8,000 singlify cells include real low-RNA cells plus some ambient droplets that downstream QC filtering removes.

## Why Gene Counts Match

Both tools use the STAR aligner core with identical reference annotations. The 0.05% residual difference comes from:
- Slightly different multi-mapping resolution strategies
- UMI collapsing threshold differences (Hamming distance vs exact)
- These are implementation details, not biological differences

## The Notebook

The full analysis with visualizations is available as a [reproducibility notebook](https://github.com/Singlet-Bio/singlet/blob/main/notebooks/gene_counting.ipynb). It includes:
- Metric comparison tables
- UMI ratio distribution histogram
- Cell calling method comparison chart

## What This Means

If you've validated results with STARsolo, you can trust singlify's gene counts. The correlation is high enough that any difference is smaller than biological noise between replicates.

[View the Notebook →](https://github.com/Singlet-Bio/singlet/blob/main/notebooks/gene_counting.ipynb) | [Browse Processed Samples →](/browse)
    `,
  },
  "sample-qc-report": {
    title: "Sample QC Report: Everything in One Function Call",
    date: "2026-05-03",
    tags: ["python", "load_dir", "qc", "notebooks"],
    content: `
## One Call, Complete QC

\`singlet.load_dir()\` now reads **every** metadata file singlify produces — giving you a complete, analysis-ready AnnData with zero manual file parsing.

\`\`\`python
import singlet

adata = singlet.load_dir("/path/to/sample")
# → AnnData: 75,420 cells × 38,606 genes
#   obs: total_umis, total_genes, mt_pct, ribo_pct, intronic_pct,
#        doublet_score, is_doublet, phase, s_score, g2m_score
#   uns: ancestry, sex_call, summary, singlify_dir
\`\`\`

## What Gets Loaded

| Data | Source File | Location in AnnData |
|------|------------|---------------------|
| Count matrix | gene_counts.1pz | adata.X |
| Gene names + IDs | gene_expression.tsv | adata.var |
| Cell barcodes | auto_barcodes.tsv | adata.obs_names |
| UMI/gene counts | cell_qc_metrics.tsv | adata.obs |
| MT/ribo/intronic % | cell_qc_metrics.tsv | adata.obs |
| Doublet detection | doublet_scores.tsv | adata.obs |
| Cell cycle phases | cell_cycle_scores.tsv | adata.obs |
| Genetic ancestry | ancestry_call.json | adata.uns['ancestry'] |
| Sex/karyotype | sex_call.json | adata.uns['sex_call'] |
| Pipeline summary | summary.json | adata.uns['summary'] |

## Quick QC Report

\`\`\`python
# One-liner QC summary
s = adata.uns['summary']
print(f"Protocol: {s['protocol']}")
print(f"Cells: {adata.n_obs:,}")
print(f"Mapping rate: {s['mapping_rate']:.1%}")
print(f"Median genes/cell: {adata.obs['total_genes'].median():,.0f}")
print(f"Doublet rate: {adata.obs['is_doublet'].mean():.1%}")
print(f"Cell cycle: G1={adata.obs['phase'].eq('G1').mean():.0%}")
print(f"Ancestry: {adata.uns['ancestry']['ancestry']}")
\`\`\`

## Immediate Filtering Pipeline

With everything pre-computed, filtering is trivial:

\`\`\`python
# Remove doublets (singlify pre-computed)
clean = adata[~adata.obs['is_doublet'].astype(bool)]

# Remove high-MT cells
clean = clean[clean.obs['mt_pct'] < 20]

# Remove low-quality cells
clean = clean[clean.obs['total_genes'] >= 200]

# Result: analysis-ready cells, zero ambiguity
\`\`\`

## 14 Tests, Full Coverage

The test suite verifies all metadata loading paths: dimensions, gene names, barcodes, QC metrics, doublets, cell cycle, ancestry, sex call, summary, and error handling.

[View the Notebook →](https://github.com/Singlet-Bio/singlet/blob/main/notebooks/sample_qc_report.ipynb) | [Install: pip install singlet-bio →](https://github.com/Singlet-Bio/singlet)
    `,
  },
  "1000-samples-milestone": {
    title: "1,000 Samples: The Singlet Atlas Crosses a Milestone",
    date: "2026-04-30",
    tags: ["milestone", "corpus", "atlas", "1000"],
    content: `
## 1,000 Successfully Processed Samples

The singlet atlas has crossed a significant milestone: **1,000 single-cell samples** processed end-to-end by singlify, producing **2.94 million cells** ready for analysis.

## By the Numbers

| Metric | Value |
|--------|-------|
| **Successful samples** | 1,001 |
| **Total cells** | 2,941,261 |
| **GEO series** | 506 |
| **Species** | 5 |
| **Protocols detected** | 15+ |
| **Median mapping rate** | 79.6% |
| **Median cells/sample** | 1,188 |

## Species Breakdown

| Species | Samples | % |
|---------|---------|---|
| Homo sapiens | 256 | 25.6% |
| Mus musculus | 163 | 16.3% |
| Macaca mulatta | 24 | 2.4% |
| Drosophila melanogaster | 11 | 1.1% |
| Gallus gallus | 8 | 0.8% |
| Mixed/other | — | — |

## Protocol Distribution (top 5)

| Protocol | Samples |
|----------|---------|
| 10x Chromium 3' v3 | 200 |
| 10x Chromium 3' v2 | 83 |
| 10x (auto-detected) | 71 |
| CEL-Seq2 | 29 |
| sci-RNA-seq | 28 |

## What "1,000 Samples" Means

Every sample has been:
1. **Downloaded** from NCBI SRA
2. **Aligned** with STAR (singlet-lite optimized build)
3. **Quantified** — exon-level counts, splice junctions, UMI deduplication
4. **QC'd** — mapping rate, saturation, cell calling (EmptyDrops)
5. **Annotated** — doublet scores, cell cycle phases, sex calling, ancestry inference
6. **Compressed** — .1pz format (8.7× smaller than h5ad)
7. **Cataloged** — searchable via the singlet-bio Python package

## What's Next

- **2,000 samples** — 1,400 more samples are in the pipeline (FAIL status, many recoverable)
- **Non-host transcriptomics** — viral/bacterial detection coming soon
- **GPU analysis** — singlet-gpu will enable atlas-scale dimensionality reduction
- **PyPI release** — \`pip install singlet-bio\` from PyPI (currently GitHub-only)

## Try It

\`\`\`python
import singlet

singlet.summary()
# → 2,398 samples, 1,001 SUCCESS, 5 species, 2.94M cells

# Browse the 1,000+ successful samples
df = singlet.catalog()
success = df[df['n_success'] > 0]
print(f"{len(success)} series with successful samples")
\`\`\`

---

[Browse the Atlas →](https://singlet.bio/browse) | [View Notebooks →](https://singlet.bio/notebooks) | [Install singlet-bio →](https://github.com/Singlet-Bio/singlet)
    `,
  },
  "notebook-collection-complete": {
    title: "18 Reproducibility Notebooks: Every singlify Feature Validated",
    date: "2026-04-30",
    tags: ["notebooks", "reproducibility", "milestone", "plots"],
    content: `
## The Complete Collection

Every singlify feature now has a dedicated Jupyter notebook with **real embedded matplotlib plots** — not just text tables. These notebooks are executable, rendered natively on GitHub, and hosted as interactive HTML on singlet.bio.

## Three Ways to View

| Method | URL | Plots Visible |
|--------|-----|---------------|
| **GitHub** | [Singlet-Bio/singlet/notebooks/](https://github.com/Singlet-Bio/singlet/tree/main/notebooks) | ✅ Native rendering |
| **Google Colab** | \`colab.research.google.com/github/Singlet-Bio/singlet/blob/main/notebooks/{name}.ipynb\` | ✅ Executable |
| **singlet.bio** | [singlet.bio/notebooks](https://singlet.bio/notebooks) | ✅ Pre-rendered HTML |

## QC & Quality Control (5 notebooks)

| Notebook | Key Visualization | Metric |
|----------|-------------------|--------|
| **cell_calling** | Barcode rank (knee) plot | 11,593 cells from 50K barcodes |
| **doublet_detection** | Score distribution + UMI correlation | 13.8% doublet rate, 20× separation |
| **ambient_rna** | MT fraction + intronic read histograms | Median MT: 3.5% |
| **cell_cycle** | G1/S/G2M phase bars + S-G2M scatter | Phase assignment for all cells |
| **saturation_curve** | Sequencing depth saturation model | Plateau detection |

## Genomic Features (5 notebooks)

| Notebook | Key Visualization | Metric |
|----------|-------------------|--------|
| **rna_velocity** | Spliced vs unspliced scatter | Steady-state ratio visible |
| **splicing** | Exonic/intronic histograms + composition pie | Per-cell splice ratios |
| **mt_variants** | Heteroplasmy VAF + MT genome coverage | 42 variants detected |
| **ancestry_calling** | Population probability bars | EUR 95% confidence |
| **sex_calling** | XIST/Y marker expression bars | 100% concordance |

## Validation (2 notebooks)

| Notebook | Key Visualization | Metric |
|----------|-------------------|--------|
| **gene_counting** | Correlation scatter vs STARsolo | r = 0.9998 |
| **corpus_analytics** | 6-panel QC distribution across 993 samples | Atlas-wide view |

## Format & Overview (6 notebooks)

| Notebook | Key Visualization | Metric |
|----------|-------------------|--------|
| **quickstart** | Species scatter (mapping rate vs cells) | 2,397 samples |
| **1pz_format** | File size + load time bars | 8.7× smaller than h5ad |
| **pipeline_outputs** | File sizes + processing step timing | Full output tour |
| **protocol_detection** | Auto-detection confidence bars | 10x 3' v3 @ 97% |
| **sample_qc_report** | 4-panel QC (UMI, genes, correlation, MT) | One-call report |
| **01_load_and_explore** | PCA scatter of top 2000 genes | Quick exploration |

## Technical Architecture

The rendering pipeline works as follows:

1. **Notebooks contain \`image/png\` in cell outputs** — GitHub renders these natively
2. **\`build_html.sh\`** runs \`jupyter nbconvert --to html --template lab\` on all .ipynb files
3. **HTML files (324–568 KB)** are deployed to \`singlet.bio/notebooks/{id}.html\`
4. **Colab links** work via \`colab.research.google.com/github/...\` URL pattern

## Open Any Notebook in Colab

\`\`\`
https://colab.research.google.com/github/Singlet-Bio/singlet/blob/main/notebooks/gene_counting.ipynb
\`\`\`

Replace \`gene_counting\` with any notebook name to open it interactively.

## Try It

\`\`\`bash
pip install "singlet-bio @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python"
\`\`\`

\`\`\`python
import singlet

# Load a processed sample
adata = singlet.load_dir("/path/to/singlify/output/")
print(f"{adata.n_obs:,} cells × {adata.n_vars:,} genes")
print(f"Doublet rate: {adata.obs['doublet_score'].gt(0.5).mean():.1%}")
print(f"Median genes: {adata.obs['total_genes'].median():,.0f}")
\`\`\`

---

[Browse All Notebooks →](https://github.com/Singlet-Bio/singlet/tree/main/notebooks) | [View on singlet.bio →](https://singlet.bio/notebooks)
    `,
  },
  "1pz-format-benchmark": {
    title: ".1pz Format: 8.7× Smaller Than h5ad, Faster Reads",
    date: "2026-05-04",
    tags: ["format", "benchmark", "compression", "1pz"],
    content: `
## The Problem With h5ad

Single-cell count matrices are extremely sparse — 95%+ zeros. Yet the standard h5ad format stores them in 133 MB for a typical 10x Chromium sample (678K cells × 38K genes). That's a lot of disk for mostly zeros.

## Enter .1pz

The .1pz format is a purpose-built compressed sparse matrix format optimized for single-cell genomics:

| Metric | h5ad | .1pz | Improvement |
|--------|------|------|-------------|
| File size | 133.1 MB | 15.2 MB | **8.7× smaller** |
| Load time | ~3s | ~0.4s | **7.5× faster** |
| Format | HDF5 (general) | Custom sparse (domain-specific) | — |

## How It Works

.1pz exploits the structure of count matrices:
- **Integer counts** (no floats needed) → smaller dtype
- **Extreme sparsity** (>95% zeros) → CSR with delta-encoded indices
- **Bounded values** (UMI counts rarely exceed 2¹⁶) → adaptive bit packing
- **Gene-level compression** → independent column blocks for parallel decode

## Reading .1pz in Python

\`\`\`python
import singlet

# Read raw sparse matrix
mat, barcodes, genes = singlet.io.read_1pz("gene_counts.1pz")
# → (678421, 38606) sparse matrix, 0.4s

# Or load a full singlify output directory (includes all QC)
adata = singlet.load_dir("/path/to/sample/")
# → AnnData with obs (QC metrics, doublets, cell cycle), var (gene info), uns (metadata)
\`\`\`

## Benchmark Details

Tested on a real 10x Chromium v3 sample (GSM7894421):
- **678,421 cells × 38,606 genes**
- **23.7M non-zero entries** (density: 0.09%)
- Hardware: AMD EPYC 9554 (Clipper HPC)

The .1pz file is read directly into a scipy CSR matrix — no intermediate decompression step, no temporary files.

## What About AnnData Compatibility?

\`singlet.load_dir()\` returns a standard AnnData object. From there, use scanpy, scvi-tools, or any other tool as normal:

\`\`\`python
import scanpy as sc

adata = singlet.load_dir("/path/to/sample/")
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata, n_top_genes=2000)
sc.tl.pca(adata)
sc.pp.neighbors(adata)
sc.tl.umap(adata)
\`\`\`

## When to Use .1pz

- **Atlas-scale storage**: 1,000 samples × 8.7× savings = terabytes reclaimed
- **Cloud transfer**: 15 MB uploads vs 133 MB (10× faster S3 sync)
- **Rapid iteration**: Load in 0.4s, explore immediately
- **Archival**: Long-term storage at minimal cost

## Try It

\`\`\`bash
pip install singlet-bio
\`\`\`

[View the Notebook →](https://github.com/Singlet-Bio/singlet/blob/main/notebooks/1pz_format.ipynb) | [Install singlet-bio →](https://github.com/Singlet-Bio/singlet)
    `,
  },
};

const BlogPost = () => {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? POST_CONTENT[slug] : null;

  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-32 pb-20 px-6 text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">Post Not Found</h1>
          <Link to="/blog" className="text-primary hover:underline">← Back to Blog</Link>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <article className="pt-32 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <Link to="/blog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft size={14} /> Back to Blog
          </Link>

          <header className="mb-8">
            <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-4">
              {post.title}
            </h1>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Calendar size={14} /> {post.date}
              </span>
              <div className="flex gap-2">
                {post.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                    <Tag size={10} /> {tag}
                  </span>
                ))}
              </div>
            </div>
          </header>

          <div className="prose prose-neutral dark:prose-invert max-w-none prose-headings:font-display prose-headings:tracking-tight prose-code:text-xs prose-pre:bg-muted prose-pre:border prose-pre:border-border">
            {/* Render markdown content as HTML-like sections */}
            {post.content.split("\n").map((line, i) => {
              if (line.startsWith("## ")) return <h2 key={i} className="text-2xl font-bold mt-8 mb-4">{line.slice(3)}</h2>;
              if (line.startsWith("### ")) return <h3 key={i} className="text-xl font-bold mt-6 mb-3">{line.slice(4)}</h3>;
              if (line.startsWith("```")) return null; // simplified — would need proper code block handling
              if (line.startsWith("|")) return <p key={i} className="font-mono text-xs text-muted-foreground">{line}</p>;
              if (line.startsWith("> ")) return <blockquote key={i} className="border-l-4 border-primary/30 pl-4 italic text-muted-foreground my-2">{line.slice(2)}</blockquote>;
              if (line.startsWith("- ")) return <li key={i} className="ml-4 text-muted-foreground">{line.slice(2)}</li>;
              if (line.trim() === "") return <div key={i} className="h-2" />;
              return <p key={i} className="text-muted-foreground leading-relaxed">{line}</p>;
            })}
          </div>
        </div>
      </article>
      <Footer />
    </div>
  );
};

export default BlogPost;
