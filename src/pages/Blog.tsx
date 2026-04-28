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

          {/* Posts */}
          <div className="space-y-6">
            {filtered.map((post) => (
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
