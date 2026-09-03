import { Link } from "react-router-dom";
import { BookOpen, Cpu, ExternalLink, Play, Dna, FileCode, BarChart3, Search, TestTube, FlaskConical, Layers } from "lucide-react";
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
const COLAB = "https://colab.research.google.com/github/Singlet-Bio/singlet/blob/main/notebooks";

const NOTEBOOKS: Notebook[] = [
  // ── Ready (executed, committed) ──────────────────────────────────
  {
    id: "quickstart",
    title: "Atlas Quickstart",
    description:
      "Browse the 4,600+ sample catalog, filter by species/tissue/cell type/protocol/quality tier, explore datasets and series — all with the singlet-bio Python package.",
    icon: <BookOpen size={20} />,
    tags: ["beginner", "python", "catalog"],
    githubUrl: `${BASE}/quickstart.ipynb`,
    colabUrl: `${COLAB}/quickstart.ipynb`,
    status: "ready",
  },
  {
    id: "gene_counting",
    title: "Gene Counting vs STARsolo",
    description:
      "Formal equivalence: singlet gene counting achieves r=0.9995 correlation against STARsolo on human PBMC 10x v3. Panel A validation.",
    icon: <Dna size={20} />,
    tags: ["equivalence", "starsolo", "panel-a"],
    githubUrl: `${BASE}/gene_counting.ipynb`,
    colabUrl: `${COLAB}/gene_counting.ipynb`,
    status: "ready",
  },
  {
    id: "sex_calling",
    title: "Sex / Karyotype Calling",
    description:
      "Validate singlet's sex calling via XIST/SRY CPM markers. 100% agreement with reference across all tested samples. Panel F validation.",
    icon: <TestTube size={20} />,
    tags: ["sex-calling", "panel-f", "validation"],
    githubUrl: `${BASE}/sex_calling.ipynb`,
    colabUrl: `${COLAB}/sex_calling.ipynb`,
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
    colabUrl: `${COLAB}/ambient_rna.ipynb`,
    status: "ready",
  },
  {
    id: "doublet_detection",
    title: "Doublet Detection",
    description:
      "Analyze singlet's UMI-based doublet detection: 74K cells, 13.8% doublet rate, clear score separation (singlet mean=1.0, doublet mean=25.6).",
    icon: <FlaskConical size={20} />,
    tags: ["doublets", "panel-h", "qc"],
    githubUrl: `${BASE}/doublet_detection.ipynb`,
    colabUrl: `${COLAB}/doublet_detection.ipynb`,
    status: "ready",
  },
  {
    id: "corpus_analytics",
    title: "Corpus Analytics",
    description:
      "Atlas-wide quality distributions: mapping rates, cells/sample, genes/cell across 2,072 successful samples and 8 species.",
    icon: <BarChart3 size={20} />,
    tags: ["analytics", "dashboard", "corpus"],
    githubUrl: `${BASE}/corpus_analytics.ipynb`,
    colabUrl: `${COLAB}/corpus_analytics.ipynb`,
    status: "ready",
  },
  {
    id: "01_load_and_explore",
    title: "Load and Explore",
    description:
      "Load 75K cells from a singlet output directory with singlet.load_dir(), filter doublets, run full scanpy pipeline (PCA → UMAP → Leiden).",
    icon: <BookOpen size={20} />,
    tags: ["beginner", "scanpy", "clustering"],
    githubUrl: `${BASE}/01_load_and_explore.ipynb`,
    colabUrl: `${COLAB}/01_load_and_explore.ipynb`,
    status: "ready",
  },
  {
    id: "pytorch_dataloader",
    title: "PyTorch DataLoader",
    description:
      "Stream real atlas .singlet data into a PyTorch DataLoader — sparse-friendly, GPU-ready float32 batches (n_cells × n_genes) for model training.",
    icon: <Layers size={20} />,
    tags: ["pytorch", "training", "dataloader"],
    githubUrl: `${BASE}/pytorch_dataloader.ipynb`,
    colabUrl: `${COLAB}/pytorch_dataloader.ipynb`,
    status: "ready",
  },
  {
    id: "cell_cycle",
    title: "Cell Cycle Scoring",
    description:
      "Visualize cell cycle phase assignments (G1/S/G2M) from singlet output. 75K cells: 93% G1, 5% G2M, 2.5% S. Score distributions + QC correlations.",
    icon: <TestTube size={20} />,
    tags: ["cell-cycle", "qc", "proliferation"],
    githubUrl: `${BASE}/cell_cycle.ipynb`,
    colabUrl: `${COLAB}/cell_cycle.ipynb`,
    status: "ready",
  },
  {
    id: "sample_qc_report",
    title: "Sample QC Report",
    description:
      "One-call QC: load_dir() returns 75K cells with UMIs, genes, MT%, doublets, cell cycle, and ancestry — complete report from a single function.",
    icon: <BarChart3 size={20} />,
    tags: ["qc", "load_dir", "tutorial"],
    githubUrl: `${BASE}/sample_qc_report.ipynb`,
    colabUrl: `${COLAB}/sample_qc_report.ipynb`,
    status: "ready",
  },
  {
    id: "saturation_curve",
    title: "Sequencing Saturation",
    description:
      "Visualize saturation curves to determine if samples are under/over-sequenced. UMI and gene discovery vs depth across multiple samples.",
    icon: <BarChart3 size={20} />,
    tags: ["saturation", "qc", "sequencing"],
    githubUrl: `${BASE}/saturation_curve.ipynb`,
    colabUrl: `${COLAB}/saturation_curve.ipynb`,
    status: "ready",
  },
  {
    id: "ancestry_calling",
    title: "Genetic Ancestry Inference",
    description:
      "Corpus-wide ancestry analysis: 605 samples profiled, 5 super-populations (EUR/EAS/AFR/AMR/SAS). Confidence distributions and population bias assessment.",
    icon: <Dna size={20} />,
    tags: ["ancestry", "snp", "corpus"],
    githubUrl: `${BASE}/ancestry_calling.ipynb`,
    colabUrl: `${COLAB}/ancestry_calling.ipynb`,
    status: "ready",
  },
  {
    id: "mt_variants",
    title: "Mitochondrial Variants",
    description:
      "MT heteroplasmy calling from scRNA-seq: 3,717 variants, mutation spectrum, clonal lineage markers. Unique singlet capability for lineage tracing.",
    icon: <Dna size={20} />,
    tags: ["mitochondrial", "variants", "lineage"],
    githubUrl: `${BASE}/mt_variants.ipynb`,
    colabUrl: `${COLAB}/mt_variants.ipynb`,
    status: "ready",
  },
  {
    id: "splicing",
    title: "Alternative Splicing",
    description:
      "37,909 splicing events detected per sample: alt donor/acceptor sites, junction counts, per-cell PSI matrices for isoform analysis.",
    icon: <Dna size={20} />,
    tags: ["splicing", "isoforms", "rna"],
    githubUrl: `${BASE}/splicing.ipynb`,
    colabUrl: `${COLAB}/splicing.ipynb`,
    status: "ready",
  },
  {
    id: "rna_velocity",
    title: "RNA Velocity Matrices",
    description:
      "Spliced + unspliced count matrices ready for scVelo. Per-cell intronic fraction analysis and velocity readiness assessment.",
    icon: <Play size={20} />,
    tags: ["velocity", "scvelo", "spliced"],
    githubUrl: `${BASE}/rna_velocity.ipynb`,
    colabUrl: `${COLAB}/rna_velocity.ipynb`,
    status: "ready",
  },
  {
    id: "pipeline_outputs",
    title: "Pipeline Outputs Reference",
    description:
      "Complete catalog of all 40+ files singlet produces per sample: count matrices, velocity, splicing, variants, QC, metadata. Loading guide included.",
    icon: <FileCode size={20} />,
    tags: ["reference", "outputs", "guide"],
    githubUrl: `${BASE}/pipeline_outputs.ipynb`,
    colabUrl: `${COLAB}/pipeline_outputs.ipynb`,
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
      "Deviance-based cell calling: 74K cells identified via statistical testing against ambient. Barcode rank plots, low-UMI rescue analysis.",
    icon: <FlaskConical size={20} />,
    tags: ["cell-calling", "emptydrops"],
    githubUrl: `${BASE}/cell_calling.ipynb`,
    colabUrl: `${COLAB}/cell_calling.ipynb`,
    status: "ready",
  },
  {
    id: "1pz_format",
    title: ".singlet Format: 8.7× Smaller Than h5ad",
    description:
      "The compact, self-contained .singlet bundle: 678K cells × 38K genes in 15 MB (vs 133 MB h5ad). Benchmarks, format comparison, load_dir() with full metadata.",
    icon: <FileCode size={20} />,
    tags: ["format", "compression", "singlet", "benchmark"],
    githubUrl: `${BASE}/1pz_format.ipynb`,
    colabUrl: `${COLAB}/1pz_format.ipynb`,
    status: "ready",
  },
  {
    id: "protocol_detection",
    title: "Protocol Auto-Detection",
    description:
      "Corpus-wide protocol detection: 29 protocols across 2,072+ samples. QC metrics by protocol, mapping rates, cell recovery. Fully automated.",
    icon: <Search size={20} />,
    tags: ["protocol", "autodetect"],
    githubUrl: `${BASE}/protocol_detection.ipynb`,
    colabUrl: `${COLAB}/protocol_detection.ipynb`,
    status: "ready",
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
            19 executed Jupyter notebooks covering data loading, PyTorch training batches, catalog exploration, formal equivalence, QC profiling, doublet detection, cell cycle scoring, the .singlet format, and corpus analytics.
          </p>
        </div>

        {/* Quick start */}
        <div className="rounded-xl border border-primary/20 bg-primary/[0.02] p-6 mb-10">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-foreground">Quick Start</h2>
            <a href="/atlas-docs" className="text-xs text-primary hover:underline">Full API docs →</a>
          </div>
          <pre className="font-mono text-xs text-foreground bg-muted/50 rounded-lg p-4 overflow-x-auto">
            <code>{`pip install "singlet-bio @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python" scanpy matplotlib

import singlet

# Browse the atlas
singlet.summary()
df = singlet.samples(organism="Homo sapiens", status="DONE")
print(f"{len(df)} processed human samples")

# Load a singlet output directory as AnnData
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
                  {nb.status !== "blocked" && (
                    <a
                      href={`/notebooks/${nb.id}.html`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <Play size={10} /> View
                    </a>
                  )}
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
            Use the Singlet MCP server to search and browse the atlas catalog directly from Claude, Cursor, or VS Code Copilot —
            then fetch a sample's data to your machine. Ask things like "find all human lung 10xv3 samples" or
            "download GSM5238385 as h5ad".
          </p>
          <pre className="font-mono text-xs text-foreground bg-muted/50 rounded-lg p-4 overflow-x-auto">
            <code>{`# Install the MCP extra and launch the server
pip install "singlet-bio[mcp] @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python"
python -m singlet.mcp

# Then ask your AI assistant:
# "Find T cells from pediatric AML"   (singlet_nl_search)
# "Search the catalog for human lung 10xv3 samples"
# "Fetch GSM5238385 locally as a .singlet bundle"
# "Load GSM5238385 as an AnnData (h5ad) on my machine"`}</code>
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
