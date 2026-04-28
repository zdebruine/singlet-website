import { Link } from "react-router-dom";
import { BookOpen, Cpu, Layers, GitMerge, ExternalLink, Play } from "lucide-react";
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
}

const NOTEBOOKS: Notebook[] = [
  {
    id: "01_load_and_explore",
    title: "Load and Explore",
    description:
      "Load a pre-processed sample from the Singlet Atlas, examine QC metrics, and run basic clustering. Perfect starting point for new users.",
    icon: <BookOpen size={20} />,
    tags: ["beginner", "scanpy", "qc"],
    githubUrl: "https://github.com/Singlet-Bio/singlet/blob/main/notebooks/01_load_and_explore.ipynb",
    colabUrl: "https://colab.research.google.com/github/Singlet-Bio/singlet/blob/main/notebooks/01_load_and_explore.ipynb",
  },
  {
    id: "02_gpu_analysis",
    title: "GPU-Accelerated Analysis",
    description:
      "Run the complete scRNA-seq pipeline on GPU with 100-500× speedup. Normalize, HVG, PCA, kNN, Leiden, UMAP, and DE in under 1 second.",
    icon: <Cpu size={20} />,
    tags: ["gpu", "cuda", "performance"],
    githubUrl: "https://github.com/Singlet-Bio/singlet/blob/main/notebooks/02_gpu_analysis.ipynb",
    colabUrl: "https://colab.research.google.com/github/Singlet-Bio/singlet/blob/main/notebooks/02_gpu_analysis.ipynb",
  },
  {
    id: "03_multimodal",
    title: "Multi-Modal Analysis",
    description:
      "Work with CITE-seq (RNA + protein), ATAC-seq (chromatin accessibility), and spatial transcriptomics data in the Singlet Atlas.",
    icon: <Layers size={20} />,
    tags: ["cite-seq", "atac", "spatial"],
    githubUrl: "https://github.com/Singlet-Bio/singlet/blob/main/notebooks/03_multimodal.ipynb",
  },
  {
    id: "04_batch_integration",
    title: "Batch Integration",
    description:
      "Integrate multiple studies with Harmony and BBKNN. Load samples from different labs and protocols, remove batch effects, and discover shared cell states.",
    icon: <GitMerge size={20} />,
    tags: ["harmony", "integration", "multi-study"],
    githubUrl: "https://github.com/Singlet-Bio/singlet/blob/main/notebooks/04_batch_integration.ipynb",
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
            Interactive Jupyter notebooks demonstrating singlet workflows — from basic data loading to GPU-accelerated multi-modal analysis.
          </p>
        </div>

        {/* Quick start */}
        <div className="rounded-xl border border-primary/20 bg-primary/[0.02] p-6 mb-10">
          <h2 className="text-lg font-bold text-foreground mb-2">Quick Start</h2>
          <pre className="font-mono text-xs text-foreground bg-muted/50 rounded-lg p-4 overflow-x-auto">
            <code>{`pip install singlet scanpy matplotlib

import singlet
adata = singlet.load("GSM5238385")  # Load any GEO sample instantly
print(f"{adata.n_obs} cells × {adata.n_vars} genes")`}</code>
          </pre>
        </div>

        {/* Notebook Cards */}
        <div className="grid md:grid-cols-2 gap-6">
          {NOTEBOOKS.map((nb) => (
            <div
              key={nb.id}
              className="group rounded-xl border border-border bg-card p-6 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">{nb.icon}</div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">
                    {nb.title}
                  </h3>
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
