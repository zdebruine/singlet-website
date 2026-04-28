import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Calendar, Tag, ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

// Blog post content (will move to Supabase/MDX later)
const POST_CONTENT: Record<string, { title: string; date: string; tags: string[]; content: string }> = {
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
