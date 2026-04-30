import { useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, Tag, ArrowRight, Rss } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

interface BlogPost {
  slug: string;
  title: string;
  date: string;
  summary: string;
  tags: string[];
  author: string;
}

// Static blog posts until Supabase blog_posts table is live
const POSTS: BlogPost[] = [
  {
    slug: "mitochondrial-variant-analysis",
    title: "Mitochondrial Variant Analysis: Clonal Tracking from scRNA-seq",
    date: "2026-04-30",
    summary:
      "singlify now outputs per-donor mitochondrial consensus sequences (FASTA + VCF), mt_events.1pz sparse matrices, and mt_summary.tsv — enabling clonal tracking, lineage tracing, and donor deconvolution from standard scRNA-seq data without additional assays.",
    tags: ["mitochondria", "variants", "clonal-tracking", "g6"],
    author: "singlet-product",
  },
  {
    slug: "1000-samples-milestone",
    title: "1,000 Samples: The Singlet Atlas Crosses a Milestone",
    date: "2026-04-30",
    summary:
      "The singlet atlas has crossed 1,000 successfully processed samples — 2.94M cells, 506 GEO series, 5 species, 15+ protocols. All uniformly processed with singlify.",
    tags: ["milestone", "corpus", "atlas", "1000"],
    author: "singlet-product",
  },
  {
    slug: "notebook-collection-complete",
    title: "18 Reproducibility Notebooks: Every singlify Feature Validated",
    date: "2026-04-30",
    summary:
      "The complete notebook collection is live — 18 executed Jupyter notebooks with embedded matplotlib plots covering gene counting, QC, splicing, velocity, ancestry, and more. View on GitHub, Colab, or singlet.bio.",
    tags: ["notebooks", "reproducibility", "milestone", "plots"],
    author: "singlet-product",
  },
  {
    slug: "1pz-format-benchmark",
    title: ".1pz Format: 8.7× Smaller Than h5ad, Faster Reads",
    date: "2026-05-04",
    summary:
      "The .1pz compressed sparse matrix format stores 678K cells × 38K genes in 15 MB (vs 133 MB h5ad). Benchmarks show faster reads and near-perfect lossless compression for single-cell count data.",
    tags: ["format", "benchmark", "compression", "1pz"],
    author: "singlet-product",
  },
  {
    slug: "17-notebooks-catalog",
    title: "17 Notebooks + Bundled Catalog: singlet-bio Is Self-Contained",
    date: "2026-05-04",
    summary:
      "The singlet-bio package now ships with a 2,364-sample catalog (parquet) and 17 executed notebooks covering QC, genomic features, and validation.",
    tags: ["milestone", "notebooks", "python", "catalog"],
    author: "singlet-product",
  },
  {
    slug: "sample-qc-report",
    title: "Sample QC Report: Everything in One Function Call",
    date: "2026-05-03",
    summary:
      "load_dir() now reads cell cycle phases, ancestry, sex call, and pipeline summary — giving you complete sample metadata without parsing a single file.",
    tags: ["python", "load_dir", "qc", "notebooks"],
    author: "singlet-product",
  },
  {
    slug: "load-dir-feature",
    title: "New: singlet.load_dir() — Pipeline Output → AnnData in One Call",
    date: "2026-05-03",
    summary:
      "Load a full singlify output directory into AnnData with gene names, barcodes, QC metrics, and doublet scores in a single function call.",
    tags: ["python", "feature", "anndata", "load"],
    author: "singlet-product",
  },
  {
    slug: "doublet-detection-live",
    title: "Doublet Detection: Separating Singlets from Multiplets",
    date: "2026-05-03",
    summary:
      "singlify's UMI-based doublet detection achieves 20× score separation between singlets and doublets. 74K cells analyzed, 13.8% doublet rate, clean bimodal threshold.",
    tags: ["doublets", "qc", "notebooks", "panel-h"],
    author: "singlet-product",
  },
  {
    slug: "gene-counting-r0999",
    title: "Gene Counting Equivalence: r = 0.9995 vs STARsolo",
    date: "2026-05-02",
    summary:
      "Panel A validation proves singlify gene counts correlate at r=0.9995 with STARsolo across 38,606 genes × 2,520 cells. 100% gold cell recall.",
    tags: ["equivalence", "panel-a", "starsolo", "notebooks"],
    author: "singlet-product",
  },
  {
    slug: "corpus-3m-quickstart",
    title: "3 Million Cells & Your First Notebook",
    date: "2026-05-02",
    summary:
      "The singlet atlas crosses 3M cells across 2,368 samples and 1,171 GEO series. Plus: a new quickstart notebook demonstrating the full Python API.",
    tags: ["milestone", "corpus", "notebooks", "python"],
    author: "singlet-product",
  },
  {
    slug: "browse-featured-series",
    title: "Browse Upgrade: Featured Series, CSV Export & Corpus Comparison",
    date: "2026-05-01",
    summary:
      "The Browse page now highlights top series by cell count, lets researchers export filtered results to CSV, and sample detail pages show QC metrics relative to corpus averages.",
    tags: ["browse", "ux", "csv", "comparison"],
    author: "singlet-product",
  },
  {
    slug: "pipeline-dashboard",
    title: "Pipeline Dashboard: Real-Time Corpus Health at a Glance",
    date: "2026-04-30",
    summary:
      "Live charts showing sample status breakdown, failure categories, protocol success rates, and quality tiers — all powered by real-time Supabase queries.",
    tags: ["pipeline", "dashboard", "analytics"],
    author: "singlet-product",
  },
  {
    slug: "pipeline-failure-analysis",
    title: "Why Samples Fail: Anatomy of 1,094 Pipeline Failures",
    date: "2026-04-29",
    summary:
      "Across 1,814 samples, 62% fail at some stage. We break down the seven failure categories, identify protocol-specific patterns, and show how users can predict success before running the pipeline.",
    tags: ["pipeline", "analytics", "quality"],
    author: "singlet-product",
  },
  {
    slug: "atlas-quality-report",
    title: "Atlas Quality Report: 687 Samples, 2.4M Cells, 79.7% Mapping Rate",
    date: "2026-04-29",
    summary:
      "A detailed look at the quality metrics across the Singlet Atlas corpus — mapping rates, gene detection, protocol distribution, and species coverage across 894 GEO series.",
    tags: ["atlas", "quality", "data"],
    author: "singlet-product",
  },
  {
    slug: "singlet-bio-python-package",
    title: "singlet-bio: Load Any Atlas Sample in 3 Lines of Python",
    date: "2026-04-29",
    summary:
      "The singlet-bio Python package provides instant access to 687 uniformly processed scRNA-seq samples across 894 GEO series. Browse the catalog, load AnnData objects from .1pz compressed files, and use PyTorch DataLoaders — all with a single pip install.",
    tags: ["package", "python", "tutorial"],
    author: "singlet-product",
  },
  {
    slug: "1fq-binary-format",
    title: "The .1fq Format: 18 Bytes/Read Compact FASTQ",
    date: "2026-04-29",
    summary:
      "Deep dive into singlify's binary .1fq format: 96-byte header, 2-bit sequence encoding, 4-bin quality, ZSTD block compression, and embedded SRA metadata. Analysis of 12 .1fq files totaling 477M reads at 18.6 bytes/read average.",
    tags: ["format", "compression", "1fq"],
    author: "singlet-product",
  },
  {
    slug: "corpus-2m-cells",
    title: "Singlet Corpus: 2.2 Million Cells Across 29 Protocols",
    date: "2026-04-29",
    summary:
      "The singlet corpus now spans 1,640 samples, 799 GEO series, and 29 auto-detected protocols. 636 successful samples yield 2.2M cells with 81.8% median mapping rate and 7-minute median processing time. Full analytics available in the new corpus_analytics notebook.",
    tags: ["corpus", "analytics", "milestone"],
    author: "singlet-product",
  },
  {
    slug: "gene-counting-equivalence",
    title: "Gene Counting Equivalence: r=0.999 vs STARsolo",
    date: "2026-04-29",
    summary:
      "Formal comparison of singlet vs STARsolo gene counting on 38,606 genes and 2,520 shared cells. Gene Pearson r=0.9990, Cell UMI r=0.9993, splice junction Jaccard=0.964. 100% gold cell recall. Plus: cell calling comparison shows EmptyDrops calls 3.2× more cells.",
    tags: ["equivalence", "benchmarks", "gene-counting"],
    author: "singlet-product",
  },
  {
    slug: "first-reproducibility-notebooks",
    title: "First Reproducibility Notebooks Ship",
    date: "2026-04-29",
    summary:
      "Four reproducibility notebooks demonstrating singlet's gene counting (r=0.999), sex calling (100% agreement), ambient RNA estimation, and .1pz format. All executed end-to-end on real data. Plus: 1,619 pipeline results synced to Supabase.",
    tags: ["notebooks", "equivalence", "milestone"],
    author: "singlet-product",
  },
  {
    slug: "singlet-atlas-launch",
    title: "Singlet Atlas: 1,400+ Uniformly Processed scRNA-seq Samples",
    date: "2026-04-28",
    summary:
      "We've processed over 1,400 public GEO single-cell samples through the singlet pipeline, creating a uniformly analyzed atlas with standardized QC metrics, cell calling, and .1pz compressed outputs. Every sample is browsable at singlet.bio/browse.",
    tags: ["atlas", "pipeline", "launch"],
    author: "Singlet Team",
  },
  {
    slug: "mcp-server-release",
    title: "Singlet MCP Server: Query the Atlas from Claude, Cursor, or VS Code",
    date: "2026-04-28",
    summary:
      "The singlet MCP server exposes 5 tools (stats, search, QC, load, browse) via the Model Context Protocol. Any AI assistant can now search and analyze single-cell data directly. Install with `pip install mcp supabase` and configure in seconds.",
    tags: ["mcp", "tooling", "ai"],
    author: "Singlet Team",
  },
  {
    slug: "singlepress-1pz-format",
    title: "SinglePress .1pz Format: 13× Compression, 4 GB/s Decode",
    date: "2026-04-25",
    summary:
      "The .1pz format uses VOCSC encoding with byte-split filters and zstd compression to achieve 13× compression over raw CSC while maintaining >4 GB/s decode throughput. Every atlas sample is stored in this format for instant access.",
    tags: ["singlepress", "format", "performance"],
    author: "Singlet Team",
  },
  {
    slug: "gpu-benchmarks",
    title: "singlet-gpu: 100-500× Faster Than Scanpy",
    date: "2026-04-20",
    summary:
      "Our CUDA kernels for lognorm, HVG, PCA, kNN, Leiden, UMAP, and differential expression achieve 100-500× speedups over Scanpy on A100 GPUs. Full pipeline on 50K cells completes in under 1 second.",
    tags: ["gpu", "benchmarks", "cuda"],
    author: "Singlet Team",
  },
  {
    slug: "star-singlet-lite",
    title: "STAR singlet-lite: PGO+LTO Optimized Alignment",
    date: "2026-04-15",
    summary:
      "Our STAR fork with Profile-Guided Optimization, Link-Time Optimization, and suffix array performance patches achieves ~10% wall-time reduction for scRNA-seq alignment without any accuracy loss.",
    tags: ["star", "alignment", "performance"],
    author: "Singlet Team",
  },
  {
    slug: "cross-species-atlas",
    title: "Cross-Species Atlas: Comparing Gene Expression Across 8 Organisms",
    date: "2026-04-29",
    summary:
      "Our atlas now spans 8 species from human to zebrafish. We compare UMI distributions, gene detection, and sparsity across species — all from uniformly processed data.",
    tags: ["atlas", "species", "comparison", "notebook"],
    author: "Singlet Team",
  },
  {
    slug: "qc-filtering-tiers",
    title: "Quality Tiers: Building Curated Cohorts from 687 Samples",
    date: "2026-04-29",
    summary:
      "We introduce Gold, Silver, and Bronze quality tiers based on mapping rate, gene detection, and cell count. Filter 687 successful samples into publication-ready cohorts with a single API call.",
    tags: ["quality", "filtering", "tutorial", "notebook"],
    author: "Singlet Team",
  },
  {
    slug: "e2e-validation-dashboard",
    title: "E2E Validation Dashboard: 15 Metrics Across 4 Panels",
    date: "2026-04-29",
    summary:
      "The new Validation page tracks formal equivalence across 9 E2E panels. Currently: gene counting r=0.999 (PASS), sex calling 100% (PASS), ambient rho=0.95 (PASS), plus doublet and mapping metrics. All verified on real GEO data.",
    tags: ["validation", "equivalence", "benchmarks"],
    author: "singlet-product",
  },
  {
    slug: "atlas-api-docs",
    title: "Atlas API Docs: Full Reference for singlet-bio",
    date: "2026-04-29",
    summary:
      "The new /atlas-docs page provides a complete API reference for the singlet-bio Python package — from pip install to loading samples as AnnData. Catalog browsing, data loading, file I/O, annotation, and format conversion all in one place.",
    tags: ["docs", "api", "python", "tutorial"],
    author: "singlet-product",
  },
];

const Blog = () => {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const allTags = [...new Set(POSTS.flatMap((p) => p.tags))].sort();
  const filtered = selectedTag
    ? POSTS.filter((p) => p.tags.includes(selectedTag))
    : POSTS;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest mb-2">
                Blog
              </h1>
              <p className="text-muted-foreground">
                Updates on new features, benchmarks, and releases.
              </p>
            </div>
            <a
              href="/blog/rss.xml"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Rss size={14} /> RSS
            </a>
          </div>

          {/* Tags */}
          <div className="flex gap-2 flex-wrap mb-8">
            <button
              onClick={() => setSelectedTag(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                !selectedTag
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedTag === tag
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Featured latest post */}
          {!selectedTag && filtered.length > 0 && (
            <Link
              to={`/blog/${filtered[0].slug}`}
              className="block mb-8 rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-8 hover:border-primary/40 transition-colors"
            >
              <span className="text-[10px] font-mono uppercase tracking-widest text-primary mb-2 block">Latest</span>
              <h2 className="font-display text-2xl font-bold text-foreground mb-2">{filtered[0].title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">{filtered[0].summary}</p>
              <span className="text-xs text-primary font-medium">Read more →</span>
            </Link>
          )}

          {/* Posts */}
          <div className="space-y-6">
            {(selectedTag ? filtered : filtered.slice(1)).map((post) => (
              <article
                key={post.slug}
                className="group rounded-xl border border-border bg-card p-6 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar size={12} /> {post.date}
                  </span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{post.author}</span>
                </div>
                <Link to={`/blog/${post.slug}`}>
                  <h2 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors mb-2">
                    {post.title}
                  </h2>
                </Link>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {post.summary}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground"
                      >
                        <Tag size={10} /> {tag}
                      </span>
                    ))}
                  </div>
                  <Link
                    to={`/blog/${post.slug}`}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Read more <ArrowRight size={12} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Blog;
