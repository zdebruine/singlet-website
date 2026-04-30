import { Link } from "react-router-dom";
import { BookOpen, Cpu, ExternalLink, Play, Dna, FileCode, BarChart3, Search, TestTube, FlaskConical } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

interface Notebook {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  tags: string[];
  githubUrl: string;
  colabUrl?: string;
  status?: "ready" | "blocked";
}

const BASE = "https://github.com/Singlet-Bio/singlet/blob/main/notebooks";

const NOTEBOOKS: Notebook[] = [
  // ── Ready (executed, committed) ──────────────────────────────────
  {
    id: "quickstart",
    title: "Atlas Quickstart",
    description:
      "Browse the 2,250-sample catalog, filter by species/status/quality, explore datasets and series — all with the singlet-bio Python package.",
    icon: <BookOpen size={20} />,
    tags: ["beginner", "python", "catalog"],
    githubUrl: `${BASE}/quickstart.ipynb`,
    status: "ready",
  },
  {
    id: "gene_counting",
    title: "Gene Counting vs STARsolo",
    description:
      "Formal equivalence: singlify gene counting achieves r=0.9995 correlation against STARsolo on human PBMC 10x v3. Panel A validation.",
    icon: <Dna size={20} />,
    tags: ["equivalence", "starsolo", "panel-a"],
    githubUrl: `${BASE}/gene_counting.ipynb`,
    status: "ready",
  },
  {
    id: "sex_calling",
    title: "Sex / Karyotype Calling",
    description:
      "Validate singlify's sex calling via XIST/SRY CPM markers. 100% agreement with reference across all tested samples. Panel F validation.",
    icon: <TestTube size={20} />,
    tags: ["sex-calling", "panel-f", "validation"],
    githubUrl: `${BASE}/sex_calling.ipynb`,
    status: "ready",
  },
  {
    id: "ambient_rna",
    title: "Ambient RNA Profiling",
    description:
      "Visualize ambient RNA contamination profiles from real pipeline output — 74K cells, top contaminating genes, MT gene dominance.",
    icon: <FlaskConical size={20} />,
    tags: ["ambient-rna", "panel-g", "qc"],
    githubUrl: `${BASE}/ambient_rna.ipynb`,
    status: "ready",
  },
  {
    id: "doublet_detection",
    title: "Doublet Detection",
    description:
      "Analyze singlify's UMI-based doublet detection: 74K cells, 13.8% doublet rate, clear score separation (singlet mean=1.0, doublet mean=25.6).",
    icon: <FlaskConical size={20} />,
    tags: ["doublets", "panel-h", "qc"],
    githubUrl: `${BASE}/doublet_detection.ipynb`,
    status: "ready",
  },
  {
    id: "corpus_analytics",
    title: "Corpus Analytics",
    description:
      "Atlas-wide quality distributions: mapping rates, cells/sample, genes/cell across 924 successful samples and 7 species.",
    icon: <BarChart3 size={20} />,
    tags: ["analytics", "dashboard", "corpus"],
    githubUrl: `${BASE}/corpus_analytics.ipynb`,
    status: "ready",
  },
  {
    id: "01_load_and_explore",
    title: "Load and Explore",
    description:
      "Load 75K cells from a singlify output directory with singlet.load_dir(), filter doublets, run full scanpy pipeline (PCA → UMAP → Leiden).",
    icon: <BookOpen size={20} />,
    tags: ["beginner", "scanpy", "clustering"],
    githubUrl: `${BASE}/01_load_and_explore.ipynb`,
    status: "ready",
  },
  {
    id: "cell_cycle",
    title: "Cell Cycle Scoring",
    description:
      "Visualize cell cycle phase assignments (G1/S/G2M) from singlify output. 75K cells: 93% G1, 5% G2M, 2.5% S. Score distributions + QC correlations.",
    icon: <TestTube size={20} />,
    tags: ["cell-cycle", "qc", "proliferation"],
    githubUrl: `${BASE}/cell_cycle.ipynb`,
    status: "ready",
  },
  // ── Coming Soon ──────────────────────────────────────────────────
  {
    id: "02_gpu_analysis",
    title: "GPU-Accelerated Analysis",
    description:
      "Run the complete scRNA-seq pipeline on GPU with 100-500× speedup. Normalize, HVG, PCA, kNN, Leiden, UMAP, and DE in under 1 second.",
    icon: <Cpu size={20} />,
    tags: ["gpu", "cuda", "performance"],
    githubUrl: `${BASE}/02_gpu_analysis.ipynb`,
    status: "blocked",
  },
  {
    id: "cell_calling",
    title: "Cell Calling (EmptyDrops)",
    description:
      "Compare singlify EmptyDrops cell calling vs STARsolo knee-point. Analyze overcalling behavior and threshold tuning.",
    icon: <FlaskConical size={20} />,
    tags: ["cell-calling", "emptydrops"],
    githubUrl: `${BASE}/cell_calling.ipynb`,
    status: "blocked",
  },
  {
    id: "1pz_format",
    title: ".1pz Format Deep Dive",
    description:
      "Explore the .1pz compressed sparse matrix format: 13× compression, 4 GB/s decode, embedded metadata.",
    icon: <FileCode size={20} />,
    tags: ["format", "compression", "1pz"],
    githubUrl: `${BASE}/1pz_format.ipynb`,
    status: "blocked",
  },
  {
    id: "protocol_detection",
    title: "Protocol Auto-Detection",
    description:
      "Corpus-wide analysis of singlify's protocol auto-detection across 29 protocols and 2,250 samples.",
    icon: <Search size={20} />,
    tags: ["protocol", "autodetect"],
    githubUrl: `${BASE}/protocol_detection.ipynb`,
    status: "blocked",
  },
];

const Notebooks = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="pt-32 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest mb-2">
            Notebooks & Tutorials
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            8 executed Jupyter notebooks covering data loading, catalog exploration, formal equivalence, QC profiling, doublet detection, cell cycle scoring, and corpus analytics — plus 4 more coming soon.
          </p>
        </div>

        {/* Quick start */}
        <div className="rounded-xl border border-primary/20 bg-primary/[0.02] p-6 mb-10">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-foreground">Quick Start</h2>
            <a href="/atlas-docs" className="text-xs text-primary hover:underline">Full API docs →</a>
          </div>
          <pre className="font-mono text-xs text-foreground bg-muted/50 rounded-lg p-4 overflow-x-auto">
            <code>{`pip install singlet-bio scanpy matplotlib

import singlet

# Browse the 2,319-sample atlas
singlet.summary()
df = singlet.samples(organism="Homo sapiens", status="SUCCESS")
print(f"{len(df)} successful human samples")

# Load a singlify output directory as AnnData
adata = singlet.load_dir("/path/to/quant/GSM3573650")
print(f"{adata.n_obs} cells × {adata.n_vars} genes")
# → 75,420 cells × 38,606 genes with QC + doublet scores`}</code>
          </pre>
        </div>

        {/* Notebook Cards */}
        <div className="grid md:grid-cols-2 gap-6">
          {NOTEBOOKS.map((nb) => (
            <div
              key={nb.id}
              className={`group rounded-xl border bg-card p-6 transition-colors ${nb.status === "blocked" ? "border-border/50 opacity-60" : "border-border hover:border-primary/30"}`}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">{nb.icon}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">
                      {nb.title}
                    </h3>
                    {nb.status === "blocked" && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600">Coming Soon</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    {nb.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4">
                <div className="flex gap-2">
                  {nb.tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="flex gap-3">
                  <a
                    href={nb.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    GitHub <ExternalLink size={10} />
                  </a>
                  {nb.colabUrl && (
                    <a
                      href={nb.colabUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <Play size={10} /> Open in Colab
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* MCP Section */}
        <div className="mt-12 rounded-xl border border-border bg-card p-6">
          <h2 className="text-xl font-bold text-foreground mb-3">AI-Assisted Analysis</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Use the Singlet MCP server to query the atlas directly from Claude, Cursor, or VS Code Copilot.
            Ask questions like "find all human lung 10xv3 samples" or "what's the QC for GSM5238385".
          </p>
          <pre className="font-mono text-xs text-foreground bg-muted/50 rounded-lg p-4 overflow-x-auto">
            <code>{`# Install and start the MCP server
pip install mcp supabase
python -m singlet.mcp.server

# Then ask your AI assistant:
# "How many mouse samples are in the Singlet Atlas?"
# "Show me code to load and cluster GSM5238385"`}</code>
          </pre>
          <a
            href="https://github.com/Singlet-Bio/singlet/tree/main/python/singlet/mcp"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-4 text-sm text-primary hover:underline"
          >
            MCP Server Documentation <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </section>
    <Footer />
  </div>
);

export default Notebooks;
