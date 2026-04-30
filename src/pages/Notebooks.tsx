import { Link } from "react-router-dom";
import { BookOpen, Cpu, Layers, GitMerge, ExternalLink, Play, Dna, FileCode, BarChart3, Search, TestTube, FlaskConical, Package, Filter } from "lucide-react";
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
  {
    id: "getting_started",
    title: "Getting Started with singlet-bio",
    description:
      "Browse the catalog, load .1pz files as AnnData, compare samples, and explore gene expression — all with the singlet-bio Python package.",
    icon: <Package size={20} />,
    tags: ["beginner", "python", "tutorial"],
    githubUrl: `${BASE}/getting_started.ipynb`,
  },
  {
    id: "quickstart",
    title: "Pipeline Quickstart",
    description:
      "Tour a fully processed singlify output directory — gene counts, cell calling, donor demux, sex calling, and QC summary.",
    icon: <BookOpen size={20} />,
    tags: ["beginner", "pipeline", "qc"],
    githubUrl: `${BASE}/quickstart.ipynb`,
  },
  {
    id: "01_load_and_explore",
    title: "Load and Explore",
    description:
      "Load a pre-processed sample from the Singlet Atlas, examine QC metrics, and run basic clustering.",
    icon: <BookOpen size={20} />,
    tags: ["beginner", "scanpy", "qc"],
    githubUrl: `${BASE}/01_load_and_explore.ipynb`,
    colabUrl: "https://colab.research.google.com/github/Singlet-Bio/singlet/blob/main/notebooks/01_load_and_explore.ipynb",
  },
  {
    id: "02_gpu_analysis",
    title: "GPU-Accelerated Analysis",
    description:
      "Run the complete scRNA-seq pipeline on GPU with 100-500× speedup. Normalize, HVG, PCA, kNN, Leiden, UMAP, and DE in under 1 second.",
    icon: <Cpu size={20} />,
    tags: ["gpu", "cuda", "performance"],
    githubUrl: `${BASE}/02_gpu_analysis.ipynb`,
    colabUrl: "https://colab.research.google.com/github/Singlet-Bio/singlet/blob/main/notebooks/02_gpu_analysis.ipynb",
  },
  {
    id: "gene_counting",
    title: "Gene Counting vs STARsolo",
    description:
      "Formal equivalence test: singlify gene counting (r=0.999) against STARsolo on human PBMC 10x v3. Panel A validation.",
    icon: <Dna size={20} />,
    tags: ["equivalence", "starsolo", "panel-a"],
    githubUrl: `${BASE}/gene_counting.ipynb`,
  },
  {
    id: "sex_calling",
    title: "Sex / Karyotype Calling",
    description:
      "Validate singlify's sex calling via XIST/SRY CPM markers. 100% agreement with reference. Panel F validation.",
    icon: <TestTube size={20} />,
    tags: ["sex-calling", "panel-f", "validation"],
    githubUrl: `${BASE}/sex_calling.ipynb`,
  },
  {
    id: "cell_calling",
    title: "Cell Calling (EmptyDrops)",
    description:
      "Compare singlify EmptyDrops cell calling vs STARsolo knee-point. Analyze overcalling behavior and threshold tuning.",
    icon: <FlaskConical size={20} />,
    tags: ["cell-calling", "emptydrops"],
    githubUrl: `${BASE}/cell_calling.ipynb`,
  },
  {
    id: "ambient_correction",
    title: "Ambient RNA Correction",
    description:
      "Visualize ambient RNA contamination profiles and singlify's correction approach. MT genes dominate ambient signal.",
    icon: <FlaskConical size={20} />,
    tags: ["ambient-rna", "soupx", "panel-g"],
    githubUrl: `${BASE}/ambient_correction.ipynb`,
  },
  {
    id: "doublet_detection",
    title: "Doublet Detection",
    description:
      "Analyze singlify's doublet detection: simulation-based scoring, adaptive thresholds, and rate calibration.",
    icon: <FlaskConical size={20} />,
    tags: ["doublets", "scrublet", "panel-h"],
    githubUrl: `${BASE}/doublet_detection.ipynb`,
  },
  {
    id: "1pz_format",
    title: ".1pz Format Deep Dive",
    description:
      "Explore the .1pz compressed sparse matrix format: 13× compression, 4 GB/s decode, embedded metadata.",
    icon: <FileCode size={20} />,
    tags: ["format", "compression", "1pz"],
    githubUrl: `${BASE}/1pz_format.ipynb`,
  },
  {
    id: "1fq_format",
    title: ".1fq Binary Format",
    description:
      "Parse and analyze the .1fq binary FASTQ format: 2-bit packed sequences, 4-bin quality, ZSTD compression, 18.6 bytes/read.",
    icon: <FileCode size={20} />,
    tags: ["format", "fastq", "1fq"],
    githubUrl: `${BASE}/1fq_format.ipynb`,
  },
  {
    id: "protocol_detection",
    title: "Protocol Auto-Detection",
    description:
      "Corpus-wide analysis of singlify's protocol auto-detection across 29 protocols and 2,250 samples.",
    icon: <Search size={20} />,
    tags: ["protocol", "autodetect"],
    githubUrl: `${BASE}/protocol_detection.ipynb`,
  },
  {
    id: "species_detection",
    title: "Species Auto-Detection",
    description:
      "Multi-species analysis with Bloom filter k-mer detection across 8 species in the atlas.",
    icon: <Search size={20} />,
    tags: ["species", "bloom-filter"],
    githubUrl: `${BASE}/species_detection.ipynb`,
  },
  {
    id: "corpus_analytics",
    title: "Corpus Analytics Dashboard",
    description:
      "Full pipeline corpus analysis: 2,250 samples, 924 successes, 3M cells, protocol/species/quality distributions.",
    icon: <BarChart3 size={20} />,
    tags: ["analytics", "dashboard", "corpus"],
    githubUrl: `${BASE}/corpus_analytics.ipynb`,
  },
  {
    id: "failure_analysis",
    title: "Pipeline Failure Analysis",
    description:
      "Understand why samples fail: failure categories, protocol-specific success rates, mapping rate distributions, and actionable improvements.",
    icon: <BarChart3 size={20} />,
    tags: ["analytics", "failures", "pipeline"],
    githubUrl: `${BASE}/failure_analysis.ipynb`,
  },
  {
    id: "cross_species",
    title: "Cross-Species Atlas Comparison",
    description:
      "Compare gene expression across species: load human, mouse, and macaque samples, compare UMI/gene distributions, sparsity, and protocol usage.",
    icon: <Dna size={20} />,
    tags: ["species", "comparison", "atlas"],
    githubUrl: `${BASE}/cross_species.ipynb`,
  },
  {
    id: "qc_filtering",
    title: "QC Filtering & Cohort Building",
    description:
      "Use catalog QC metrics to filter samples into quality tiers (Gold/Silver/Bronze), build curated cohorts, and visualize quality distributions.",
    icon: <Filter size={20} />,
    tags: ["quality", "filtering", "cohort"],
    githubUrl: `${BASE}/qc_filtering.ipynb`,
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
            17 interactive Jupyter notebooks covering data loading, formal equivalence benchmarks against STARsolo, format deep-dives, cross-species comparisons, QC filtering, and corpus analytics — all executed end-to-end.
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

# Browse available samples
df = singlet.samples(organism="Homo sapiens", status="SUCCESS")
print(f"{len(df)} successful human samples")

# Load any sample as AnnData
adata = singlet.load(df.iloc[0]["gsm_id"])
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
