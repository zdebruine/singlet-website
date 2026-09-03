import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Copy, Check,
  Download, Terminal, Package, Github,
  Cpu, Database, BookOpen, Search,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

/* ── Scrollspy ── */
function useScrollspy(ids: string[], offset = 120) {
  const [activeId, setActiveId] = useState(ids[0]);
  useEffect(() => {
    const onScroll = () => {
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= offset) current = id;
      }
      setActiveId(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [ids, offset]);
  return activeId;
}

/* ── Code Block ── */
const CodeBlock = ({
  code,
  title,
  comment,
}: {
  code: string;
  title?: string;
  comment?: string;
}) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden my-4">
      {title && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{title}</span>
          </div>
          <button onClick={copy} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      )}
      <div className="relative">
        {!title && (
          <button onClick={copy} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors p-1 z-10">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
        <pre className="p-4 overflow-x-auto">
          <code className="font-mono text-xs leading-6 text-foreground">{code}</code>
        </pre>
      </div>
      {comment && (
        <div className="px-4 py-2 border-t border-border/50 bg-muted/20">
          <p className="text-[11px] text-muted-foreground italic">{comment}</p>
        </div>
      )}
    </div>
  );
};

/* ── Section anchors ── */
const SECTIONS = [
  { id: "quickstart", label: "Quick Start" },
  { id: "search", label: "Natural-language search" },
  { id: "download", label: "Download data" },
  { id: "pipeline", label: "Run the pipeline" },
  { id: "pytorch", label: "PyTorch loaders" },
  { id: "mcp", label: "MCP tool" },
  { id: "formats", label: "Data objects & formats" },
  { id: "citation", label: "Citation" },
] as const;

/* ══════════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════════ */
const Docs = () => {
  const sectionIds = SECTIONS.map((s) => s.id);
  const activeId = useScrollspy(sectionIds);
  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* ═══ HERO ═══ */}
      <section className="pt-28 pb-14 md:pt-32 md:pb-16 px-6 border-b border-border relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] rounded-full bg-primary/[0.05] blur-[100px]" />
        </div>
        <div className="max-w-4xl mx-auto relative">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/[0.08] text-xs font-mono text-primary mb-4">
            Open dataset · CC0 data · MIT code
          </span>
          <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
            <span className="font-mono">singlet</span>
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-2xl leading-relaxed mb-6">
            An open single-cell RNA-seq dataset and the open-source{" "}
            <span className="font-mono text-foreground">singlet</span> package to fetch and process it.{" "}
            <span className="gradient-text font-semibold">Free and public — no accounts, no API keys, no sign-in.</span>
          </p>
          <div className="flex flex-wrap gap-3 mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-muted border border-border font-mono text-sm text-foreground">
              pip install "singlet-bio @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python"
            </div>
            <a href="https://github.com/Singlet-Bio/singlet" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Github size={16} /> GitHub
            </a>
            <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-sm text-muted-foreground">
              <Package size={16} /> PyPI release coming soon
            </span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span><span className="text-foreground font-semibold">73,749</span> samples</span>
            <span><span className="text-foreground font-semibold">430.7M</span> cells</span>
            <span><span className="text-foreground font-semibold">146</span> species</span>
            <span><span className="text-foreground font-semibold">8,271</span> series</span>
          </div>
        </div>
      </section>

      {/* ═══ SIDEBAR + CONTENT ═══ */}
      <div className="max-w-7xl mx-auto flex">
        <nav className="hidden lg:flex fixed left-0 top-16 bottom-0 w-56 flex-col justify-center pl-8 pr-4 z-30">
          <ul className="space-y-3">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => scrollTo(s.id)}
                  className={`text-left text-[13px] leading-tight transition-all duration-200 ${activeId === s.id
                      ? "text-primary font-semibold translate-x-1"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="lg:ml-56 flex-1 max-w-3xl mx-auto px-6 lg:px-10 pb-24">

          {/* ────────────────────────── QUICK START ────────────────────────── */}
          <section id="quickstart" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Quick Start</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Singlet is an open scRNA-seq dataset (data <span className="text-foreground font-semibold">CC0</span>,
              code <span className="text-foreground font-semibold">MIT</span>) plus the open-source{" "}
              <span className="font-mono text-foreground">singlet</span> package to fetch and process it. Downloads come
              from Cloudflare R2 with <span className="text-foreground font-semibold">$0 egress</span> — no accounts, no
              API keys, no sign-in.
            </p>

            <CodeBlock
              code={`# Install from source (import name stays "singlet") — PyPI release coming soon
pip install "singlet-bio @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python"

# Optional extras
pip install "singlet-bio[torch] @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python"   # PyTorch loaders
pip install "singlet-bio[mcp] @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python"     # MCP search & fetch tool
pip install "singlet-bio[gpu] @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python"     # GPU acceleration`}
              title="Terminal"
            />

            <CodeBlock
              code={`import singlet

# One accession, one .singlet file, or a list/array mixing them → one AnnData
adata = singlet.load("GSE149298")
adata = singlet.load("GSE149298.singlet")
adata = singlet.load(["GSE149298", "GSE184652"])     # concatenated

adata          # AnnData — cells × genes
adata.X        # sparse count matrix
adata.obs      # per-cell metadata
adata.var      # gene annotations`}
              title="quick_start.py"
              comment="No key, no login — singlet.load() resolves the public .singlet bundle(s) and returns one AnnData."
            />

            <div className="rounded-lg border border-border bg-card p-5 mt-4">
              <h4 className="font-display text-sm font-semibold text-foreground mb-2">Requirements</h4>
              <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div><span className="text-foreground font-medium">Python</span> ≥ 3.9</div>
                <div><span className="text-foreground font-medium">AnnData / scanpy</span> compatible</div>
                <div><span className="text-foreground font-medium">PyTorch</span> ≥ 2.0 (for <span className="font-mono">[torch]</span>)</div>
                <div><span className="text-foreground font-medium">CUDA</span> ≥ 11.8 (for <span className="font-mono">[gpu]</span>)</div>
              </div>
            </div>
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── NATURAL-LANGUAGE SEARCH ────────────────────────── */}
          <section id="search" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6 flex items-center gap-2">
              <Search size={20} className="text-primary" /> Natural-language search
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Describe what you want in plain English and Singlet uses{" "}
              <span className="text-foreground font-semibold">Claude</span> to translate it into metadata filters over
              the atlas — tissue, cell type, disease, organism, and protocol — then returns the matching accessions.
            </p>

            <CodeBlock
              code={`import singlet

# Plain English → list of matching accessions
accs = singlet.find("T cells from pediatric AML")

# find + load in one call → AnnData
adata = singlet.find_load("microglia in Alzheimer's disease")`}
              title="search.py"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">R</h3>
            <CodeBlock
              code={`library(singlet)

accs <- find("T cells from pediatric AML")`}
              title="search.R"
            />

            <div className="rounded-lg border border-border/60 bg-muted/20 px-5 py-3 mt-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-foreground font-semibold">Available three ways:</span> on the website (the AI
                search box on <Link to="/browse" className="text-primary hover:underline">Browse</Link>), in the
                Python/R packages via <span className="font-mono">find()</span>, and via the MCP tool{" "}
                <span className="font-mono">singlet_nl_search</span>.
              </p>
            </div>
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── DOWNLOAD DATA ────────────────────────── */}
          <section id="download" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6 flex items-center gap-2">
              <Download size={20} className="text-primary" /> Download data
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Every dataset is published as a per-GSE <span className="font-mono text-foreground">.singlet</span> bundle on
              Cloudflare R2. There are no accounts and no egress fees. The explicit download below is fully reproducible —
              the file you fetch is the file everyone else fetches.
            </p>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">Explicit download (reproducible)</h3>
            <CodeBlock
              code={`# Download the bundle directly — public URL, $0 egress
curl -O https://data.singlet.bio/data/GSE149298/GSE149298.singlet`}
              title="Terminal"
            />
            <CodeBlock
              code={`import singlet

# Load one or many .singlet files / accessions → one AnnData
adata = singlet.load("GSE149298.singlet")
adata = singlet.load(["GSE149298.singlet", "GSE184652.singlet"])  # concatenated`}
              title="open_bundle.py"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Convenience one-liner</h3>
            <CodeBlock
              code={`import singlet

# Resolves the public per-GSE bundle and returns AnnData
adata = singlet.load("GSE149298")`}
              title="load.py"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Load a local pipeline output directory</h3>
            <CodeBlock
              code={`import singlet

# Load an "out/" directory produced by the pipeline
adata = singlet.load_dir("out/", layer="gene_counts")`}
              title="load_dir.py"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Browse the atlas offline</h3>
            <CodeBlock
              code={`import singlet

singlet.catalog()                      # the full catalog
singlet.datasets(organism="human")     # filter datasets by organism
singlet.summary()                      # high-level atlas summary`}
              title="browse.py"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">R (load & analyze only)</h3>
            <CodeBlock
              code={`library(singlet)              # install.packages("singlet")  (CRAN, coming soon)

sce <- load("GSE149298")                    # SingleCellExperiment
sce <- load(c("GSE149298", "GSE184652"))    # combined
seu <- load("GSE149298", as = "seurat")     # Seurat object`}
              title="load.R"
              comment="R loads and analyzes outputs only — there is no raw-reads pipeline in R."
            />
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── RUN THE PIPELINE ────────────────────────── */}
          <section id="pipeline" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6 flex items-center gap-2">
              <Terminal size={20} className="text-primary" /> Run the pipeline
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Process your own reads into the same harmonized{" "}
              <span className="font-mono text-foreground">.singlet</span> format. Point the pipeline at an SRA accession
              (or your own FASTQ) and it produces an output directory you can load with{" "}
              <span className="font-mono text-foreground">singlet.load_dir()</span>.
            </p>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">Command line</h3>
            <CodeBlock
              code={`singlet-process SRR11537951 -o ./out --organism human`}
              title="Terminal"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Python</h3>
            <CodeBlock
              code={`from singlet import run_pipeline

run_pipeline("SRR11537951", "./out", organism="human")`}
              title="run_pipeline.py"
            />

            <div className="rounded-lg border border-border/60 bg-muted/20 px-5 py-3 mt-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-foreground font-semibold">R note:</span> there is no raw-reads pipeline in R. The R
                package only loads and analyzes pipeline outputs — run the pipeline from the CLI or Python, then read the
                results in R with <span className="font-mono">load()</span>,{" "}
                <span className="font-mono">load(..., as = "seurat")</span>, or the local output directory.
              </p>
            </div>
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── PYTORCH LOADERS ────────────────────────── */}
          <section id="pytorch" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6 flex items-center gap-2">
              <Cpu size={20} className="text-primary" /> PyTorch loaders
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              The <span className="font-mono text-foreground">singlet-bio[torch]</span> extra streams datasets straight
              into PyTorch. <span className="font-mono text-foreground">singlet.torch.DataLoader</span> yields dense
              <span className="font-mono text-foreground"> float32</span> tensors of shape
              <span className="font-mono text-foreground"> (n_cells × n_genes)</span>. An array of{" "}
              <span className="font-mono text-foreground">.singlet</span> files is the preferred form (accessions also
              work).
            </p>

            <CodeBlock
              code={`pip install "singlet-bio[torch] @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python"`}
              title="Terminal"
            />

            <CodeBlock
              code={`from singlet.torch import DataLoader

# An array of .singlet files is the preferred form (accessions also work)
loader = DataLoader(["GSE149298.singlet", "GSE184652.singlet"], batch_size=256, normalize=True)

for batch in loader:
    ...   # float32 tensors, shape (n_cells × n_genes)`}
              title="pytorch_loader.py"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Lower-level dataset</h3>
            <CodeBlock
              code={`from singlet.torch import SingletDataset

# Wrap .singlet files or public accessions as a torch Dataset
dataset = SingletDataset(["GSE149298.singlet", "GSE184652.singlet"])`}
              title="dataset.py"
              comment="The class is singlet.torch.DataLoader / SingletDataset — never singlet.dataloader()."
            />
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── MCP TOOL ────────────────────────── */}
          <section id="mcp" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6 flex items-center gap-2">
              <Database size={20} className="text-primary" /> MCP tool
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              The <span className="font-mono text-foreground">singlet-bio[mcp]</span> extra ships a{" "}
              <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Model Context Protocol
              </a>{" "}
              server that lets an AI assistant search the catalog (including natural-language search), inspect QC, and
              fetch data. No accounts, no Supabase.
            </p>

            <CodeBlock
              code={`pip install "singlet-bio[mcp] @ git+https://github.com/Singlet-Bio/singlet#subdirectory=python"

# Launch the server over stdio
python -m singlet.mcp`}
              title="Terminal"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">What the tools do</h3>
            <div className="rounded-lg border border-border divide-y divide-border mb-6 overflow-hidden">
              {[
                ["singlet_nl_search", "Natural-language dataset search: plain English → matching accessions plus the interpreted filters (tissue, cell type, disease, organism, protocol)."],
                ["Search & browse", "Query the catalog of series and samples by organism, tissue, and other metadata."],
                ["Per-sample QC", "Inspect quality-control metrics for an individual sample (GSM)."],
                ["Sample access & fetch", "Pick a GSE/GSM and fetch its .singlet / h5ad bundle to local disk."],
              ].map((row) => (
                <div key={row[0]} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-4 py-3">
                  <span className="font-semibold text-xs text-foreground sm:whitespace-nowrap flex-shrink-0">{row[0]}</span>
                  <span className="text-xs text-muted-foreground flex-1">{row[1]}</span>
                </div>
              ))}
            </div>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">Connect a client</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <CodeBlock
                code={`// .vscode/mcp.json
{
  "servers": {
    "singlet": {
      "type": "stdio",
      "command": "python",
      "args": ["-m", "singlet.mcp"]
    }
  }
}`}
                title="VS Code / Cursor"
              />
              <CodeBlock
                code={`# Claude Code (stdio)
$ claude mcp add singlet \\
    -- python -m singlet.mcp`}
                title="Claude Code"
              />
            </div>

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-4">Example prompts</h3>
            <div className="rounded-lg border border-border divide-y divide-border mb-2 overflow-hidden">
              {[
                "Find T cells from pediatric AML",
                "Search the catalog for human liver datasets",
                "Show the QC metrics for sample GSM4502482",
                "Fetch the .singlet bundle for GSE149298 to ./data",
              ].map((prompt) => (
                <div key={prompt} className="px-4 py-2.5">
                  <span className="text-xs text-foreground italic">"{prompt}"</span>
                </div>
              ))}
            </div>
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── DATA OBJECTS & FORMATS ────────────────────────── */}
          <section id="formats" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Data objects &amp; formats</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Singlet datasets are published as <span className="font-mono text-foreground">.singlet</span> bundles —
              self-contained and compressed — and convert losslessly to standard{" "}
              <span className="font-mono text-foreground">.h5ad</span> / AnnData.
            </p>

            <div className="rounded-lg border border-border divide-y divide-border mb-6 overflow-hidden">
              {[
                {
                  fmt: ".singlet",
                  desc: "A self-contained, compressed bundle holding the count matrices plus metadata for a dataset (compressed internally). h5ad-compatible. Open with singlet.load().",
                },
                {
                  fmt: ".h5ad",
                  desc: "Standard AnnData on disk. Interoperable with scanpy and any AnnData-based workflow; load a .singlet and write .h5ad with AnnData's own writer.",
                },
              ].map((item) => (
                <div key={item.fmt} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-4 py-3">
                  <code className="font-mono text-xs text-foreground sm:whitespace-nowrap flex-shrink-0 mt-0.5">{item.fmt}</code>
                  <span className="text-xs text-muted-foreground flex-1">{item.desc}</span>
                </div>
              ))}
            </div>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">AnnData layers</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              When a bundle is converted to AnnData, the primary count matrix is{" "}
              <span className="font-mono text-foreground">gene_counts</span> (exon + intron). Select a layer explicitly
              when loading a local pipeline output directory:
            </p>
            <CodeBlock
              code={`import singlet

# gene_counts = exon + intron
adata = singlet.load_dir("out/", layer="gene_counts")`}
              title="layers.py"
            />

            <div className="rounded-lg border border-border bg-card p-5 mt-4">
              <Link to="/specs/splice-patterns" className="block group">
                <h3 className="font-display text-base font-semibold text-foreground mb-1 group-hover:text-primary transition-colors flex items-center gap-2">
                  <BookOpen size={15} /> Splice Pattern Format <span className="text-xs font-mono text-muted-foreground">v0.1 draft</span>
                </h3>
                <p className="text-sm text-muted-foreground">
                  Atomic representation of mapped RNA-seq UMIs: per-gene structural paths encoded as token sequences,
                  with a single dedup pass and no double-counting.
                </p>
              </Link>
            </div>
          </section>

          <div className="glow-line mx-auto" />

          {/* ────────────────────────── CITATION ────────────────────────── */}
          <section id="citation" className="pt-20">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Citation</h2>

            <div className="rounded-lg border border-border bg-card p-5 mb-6">
              <h3 className="font-display text-sm font-semibold text-foreground mb-3">Cite Singlet</h3>
              <p className="text-sm text-muted-foreground">
                If you use the Singlet dataset or the <span className="font-mono text-foreground">singlet</span> package in
                a publication, please cite Singlet and include the dataset release version you downloaded.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-display text-sm font-semibold text-foreground mb-3">Licensing</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold mt-0.5">•</span>
                  <span><strong>Dataset</strong> — CC0 (public domain). Free for any use, no attribution required.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold mt-0.5">•</span>
                  <span><strong>singlet package</strong> — MIT license (open source).</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold mt-0.5">•</span>
                  <span><strong>Downloads</strong> — public Cloudflare R2, $0 egress. No accounts, no API keys, no sign-in.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* ────────────────────────── FINAL CTA ────────────────────────── */}
          <section className="pt-20 pb-8">
            <div className="border-t border-border pt-14 text-center">
              <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-2">
                <span className="font-mono">pip install from GitHub</span> <span className="gradient-text">and go.</span>
              </h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-lg mx-auto">
                Open data, open code. Download, process, and analyze — free and public.
              </p>
              <div className="flex flex-wrap gap-3 justify-center">
                <a
                  href="https://github.com/Singlet-Bio/singlet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  <Github size={14} /> View on GitHub <ArrowRight size={14} />
                </a>
                <a
                  href="https://pypi.org/project/singlet/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md border border-border bg-secondary text-secondary-foreground text-sm font-medium hover:bg-muted transition-colors"
                >
                  <Package size={14} /> PyPI
                </a>
              </div>
            </div>
          </section>

        </div>
      </div>

      <Footer />
    </div>
  );
};

export default Docs;
