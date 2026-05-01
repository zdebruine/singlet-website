import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Copy, Check, Database, Download, Search, FileCode, Settings,
  Github, Package, ArrowRight, BookOpen,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useCorpusStats } from "@/hooks/useDatabase";

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
const CodeBlock = ({ code, title }: { code: string; title?: string }) => {
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
          <span className="text-xs font-mono text-muted-foreground">{title}</span>
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
    </div>
  );
};

/* ── Section anchors ── */
const SECTIONS = [
  { id: "install", label: "Install" },
  { id: "quickstart", label: "Quick Start" },
  { id: "catalog", label: "Catalog" },
  { id: "loading", label: "Loading Data" },
  { id: "io", label: "File I/O" },
  { id: "annotate", label: "Annotate" },
  { id: "convert", label: "Convert" },
  { id: "config", label: "Configuration" },
  { id: "reference", label: "API Reference" },
] as const;

/* ── API Reference Group ── */
const RefGroup = ({
  icon,
  label,
  fns,
}: {
  icon: React.ReactNode;
  label: string;
  fns: { fn: string; desc: string }[];
}) => (
  <>
    <h3 className="font-display text-base font-semibold text-foreground mb-4 flex items-center gap-2">
      {icon} {label}
    </h3>
    <div className="rounded-lg border border-border divide-y divide-border mb-8 overflow-hidden">
      {fns.map((item) => (
        <div key={item.fn} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-4 py-3">
          <code className="font-mono text-xs text-foreground break-all sm:whitespace-nowrap flex-shrink-0 mt-0.5">{item.fn}</code>
          <span className="text-xs text-muted-foreground flex-1">{item.desc}</span>
        </div>
      ))}
    </div>
  </>
);

/* ══════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════ */
const AtlasDocs = () => {
  const sectionIds = SECTIONS.map((s) => s.id);
  const activeId = useScrollspy(sectionIds);
  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, []);
  const { data: stats } = useCorpusStats();
  const totalSamples = stats?.total_samples?.toLocaleString() ?? "2,712+";
  const successSamples = stats?.success_samples?.toLocaleString() ?? "1,139+";
  const totalCells = stats?.total_cells ? (stats.total_cells / 1e6).toFixed(1) + "M" : "3.3M";
  const seriesCount = stats?.series_count?.toLocaleString() ?? "1,300+";

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
            Atlas Data API
          </span>
          <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground tracking-tightest mb-4">
            <span className="font-mono">singlet-bio</span>
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-2xl leading-relaxed mb-6">
            Browse {totalSamples} uniformly processed single-cell samples across {seriesCount} GEO series.
            Load any sample as AnnData in one line. {successSamples} samples with {totalCells} cells ready to analyze.
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-muted border border-border font-mono text-sm text-foreground">
              pip install singlet-bio
            </div>
            <a href="https://github.com/Singlet-Bio/singlet" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Github size={16} /> GitHub
            </a>
            <a href="https://pypi.org/project/singlet-bio/" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Package size={16} /> PyPI
            </a>
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

          {/* ────────── INSTALL ────────── */}
          <section id="install" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Install</h2>

            <CodeBlock
              code={`pip install singlet-bio          # Core + AnnData
pip install singlet-bio[torch]   # + PyTorch GPU DataLoaders
pip install singlet-bio[all]     # + zarr, TileDB-SOMA, torch`}
              title="Terminal"
            />

            <div className="rounded-lg border border-border bg-card p-5 mt-4">
              <h4 className="font-display text-sm font-semibold text-foreground mb-2">Requirements</h4>
              <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div><span className="text-foreground font-medium">Python</span> ≥ 3.9</div>
                <div><span className="text-foreground font-medium">anndata</span> ≥ 0.8</div>
                <div><span className="text-foreground font-medium">pandas</span> ≥ 1.4</div>
                <div><span className="text-foreground font-medium">scipy</span> ≥ 1.7</div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              No API key required for catalog browsing or data loading. All data is served free from Cloudflare R2.
            </p>
          </section>

          <div className="h-px bg-border/50 mx-auto my-6" />

          {/* ────────── QUICK START ────────── */}
          <section id="quickstart" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Quick Start</h2>

            <CodeBlock
              code={`import singlet

# Browse the catalog
df = singlet.catalog()
print(f"{len(df)} series across {df['organism'].nunique()} species")

# Find human scRNA-seq samples
human = singlet.samples(organism="Homo sapiens", status="SUCCESS")
print(f"{len(human)} successful human samples")

# Load a sample as AnnData
adata = singlet.load(human.iloc[0]["gsm_id"])
print(adata)
# AnnData object with n_obs × n_vars = 2520 × 38606`}
              title="quick_start.py"
            />

            <div className="rounded-lg border border-border/60 bg-muted/20 px-5 py-3 mt-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-foreground font-semibold">No authentication needed.</span>{" "}
                The catalog is bundled with the package. Data loads stream directly from Cloudflare R2.
              </p>
            </div>
          </section>

          <div className="h-px bg-border/50 mx-auto my-6" />

          {/* ────────── CATALOG ────────── */}
          <section id="catalog" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Catalog</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              The catalog contains metadata for every processed GEO series and sample.
              It's bundled with the package and works offline.
            </p>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">Browse series</h3>
            <CodeBlock
              code={`# All series
df = singlet.catalog()

# Search by keyword (searches title, organism, protocol)
lung = singlet.catalog("lung")

# Filter by organism and minimum cell count
human = singlet.catalog(organism="Homo sapiens", min_cells=10000)

# Get info for a specific series
singlet.info("GSE136831")`}
              title="singlet.catalog()"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Browse samples</h3>
            <CodeBlock
              code={`# All samples
df = singlet.samples()

# Filter by organism, status, minimum cells
success = singlet.samples(organism="Homo sapiens", status="SUCCESS", min_cells=500)

# Filter by tissue/source directly
brain = singlet.samples(tissue="brain", status="SUCCESS")
lung = singlet.samples(tissue="lung", organism="Homo sapiens")

# Text search across titles, organisms, protocols, sources
cardiac = singlet.samples(search="cardiac", min_cells=1000)

# Get samples from a specific series
series_samples = singlet.samples(gse_id="GSE174399")

# Filter by quality tier: gold, silver, or bronze
gold = singlet.samples(quality_tier="gold")   # MR≥70%, cells≥500
silver = singlet.samples(quality_tier="silver") # MR≥50%, cells≥100

# Columns: gsm_id, gse_id, organism, protocol, status, mapping_rate,
# cells_called, median_genes, median_umis, mt_pct, doublet_rate, title, source`}
              title="singlet.samples()"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Top series</h3>
            <CodeBlock
              code={`# Discover the best datasets by cell count
top = singlet.top_series(n=10)
print(top[["gse_id", "n_samples", "total_cells", "avg_mapping_rate"]])

# Filter by organism
human_top = singlet.top_series(organism="Homo sapiens", min_samples=5)`}
              title="singlet.top_series()"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Species coverage</h3>
            <CodeBlock
              code={`# List all species in the atlas
singlet.species()
# ['Homo sapiens', 'Mus musculus', 'Macaca mulatta',
#  'Drosophila melanogaster', 'Gallus gallus', ...]`}
              title="singlet.species()"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Tissue breakdown</h3>
            <CodeBlock
              code={`# See normalized tissue distribution across SUCCESS samples
tissues = singlet.tissues()
print(tissues.head(10))
#          tissue  count
# 0         blood     54
# 1         brain     41
# 2   bone marrow     21
# 3          lung     17
# 4         tumor     16
# 5          pbmc     13

# Filter samples by tissue directly
brain = singlet.samples(tissue="brain", status="SUCCESS")
print(f"{len(brain)} brain samples, {brain['cells_called'].sum():,.0f} cells")`}
              title="singlet.tissues()"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Protocol breakdown</h3>
            <CodeBlock
              code={`# See protocol distribution across SUCCESS samples
protocols = singlet.protocols()
print(protocols)
#       protocol  count
# 0        10xv3    268
# 1      dropseq     98
# 2        10xv2     97
# 3  10x_suspect     57
# 4      celseq2     22
# 5       scirna     19

# Filter samples by protocol
dropseq = singlet.samples(protocol="dropseq", status="SUCCESS")
print(f"{len(dropseq)} Drop-seq samples, {dropseq['cells_called'].sum():,.0f} cells")`}
              title="singlet.protocols()"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Quality tiers</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Classify SUCCESS samples into gold/silver/bronze tiers based on mapping rate, gene detection, and cell count.
            </p>
            <CodeBlock
              code={`# Quality tier breakdown
tiers = singlet.quality_tiers()
print(tiers.to_string(index=False))
#   tier  count   pct  avg_mapping_rate  avg_median_genes  avg_cells
#   gold    205  18.0            0.8621            1495.0     3110.0
# silver    301  26.4            0.7434             610.3     2515.0
# bronze    633  55.6            0.7574             284.4     3165.0

# Filter to gold-tier samples only
gold = singlet.samples(status="SUCCESS")
gold = gold[(gold['mapping_rate'] >= 0.7) & (gold['median_genes'] >= 500) & (gold['cells_called'] >= 500)]
print(f"{len(gold)} gold-tier samples")`}
              title="singlet.quality_tiers()"
            />
          </section>

          <div className="h-px bg-border/50 mx-auto my-6" />

          {/* ────────── LOADING DATA ────────── */}
          <section id="loading" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Loading Data</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Load any atlas sample as an AnnData object. Data streams from Cloudflare R2
              (or reads from local .1pz files).
            </p>

            <h3 className="font-display text-base font-semibold text-foreground mb-3">Load a sample</h3>
            <CodeBlock
              code={`# Load by GSM accession — streams from R2
adata = singlet.load("GSM4037316")

# Load a local .1pz file
adata = singlet.load("/path/to/spliced.1pz")

# Load with spliced/unspliced/ambiguous layers
adata = singlet.load("GSE136831", layers="sua")

# Include microbiome taxonomic data (if available)
adata = singlet.load("GSE136831", include_kraken2=True)

# Load a single sample from a multi-sample .1pz
adata = singlet.load_sample("GSM3308814")`}
              title="singlet.load()"
            />

            <div className="rounded-lg border border-border bg-card p-5 mt-4 mb-6">
              <h4 className="font-display text-sm font-semibold text-foreground mb-2">Resolution order</h4>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>If the argument is a file path, read it directly</li>
                <li>Look up pz_path in the sample index (bundled catalog)</li>
                <li>Look up GSE series in the catalog (multi-sample .1pz)</li>
                <li>Stream from Cloudflare R2 as a last resort</li>
              </ol>
            </div>

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">Load a singlify output directory</h3>
            <CodeBlock
              code={`# Load a full singlify pipeline output directory
adata = singlet.load_dir("/path/to/quant/GSM3573650")
# → 75,420 cells × 38,606 genes
# obs: total_umis, total_genes, mt_pct, ribo_pct, intronic_pct,
#      doublet_score, is_doublet, phase, s_score, g2m_score
# uns: ancestry, sex_call, summary, saturation_curve, singlify_dir

# Access sample-level metadata
print(adata.uns['summary']['protocol'])   # → "10x-3p-v2"
print(adata.uns['ancestry']['ancestry'])  # → "EUR"
print(adata.uns['sex_call']['sex'])       # → "male"

# Load only the count matrix (skip QC/doublets)
adata = singlet.load_dir(path, with_qc=False, with_doublets=False)

# Load exon-only or velocity matrices
adata = singlet.load_dir(path, layer="exon_counts")
spliced = singlet.read_1pz(path + "/spliced.1pz")
unspliced = singlet.read_1pz(path + "/unspliced.1pz")`}
              title="singlet.load_dir()"
            />

            <h3 className="font-display text-base font-semibold text-foreground mb-3 mt-8">AnnData structure</h3>
            <CodeBlock
              code={`adata = singlet.load("GSM4037316")

adata.X           # Sparse count matrix (cells × genes)
adata.obs         # Cell metadata (barcodes)
adata.var         # Gene metadata (gene_id, gene_name)
adata.uns         # Unstructured metadata (organism, protocol, etc.)

# Downstream analysis with scanpy
import scanpy as sc
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata)
sc.tl.pca(adata)
sc.pp.neighbors(adata)
sc.tl.umap(adata)
sc.pl.umap(adata, color="gene_name")`}
              title="AnnData output"
            />
          </section>

          <div className="h-px bg-border/50 mx-auto my-6" />

          {/* ────────── FILE I/O ────────── */}
          <section id="io" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">File I/O</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              The .1pz format stores sparse count matrices at ~13× compression over H5AD,
              with column-range reading for fast single-sample access within multi-sample files.
            </p>

            <CodeBlock
              code={`# Read .1pz files
adata = singlet.read_1pz("spliced.1pz")
meta = singlet.info_1pz("spliced.1pz")  # Metadata without loading the matrix

# Write .1pz files
singlet.write_1pz(adata, "output.1pz")

# Auto-detect format (.1pz or .spz)
adata = singlet.read_matrix("counts.1pz")

# Read Kraken2 microbiome data
micro = singlet.read_kraken2("gse_dir/")

# Legacy .spz format
adata = singlet.read_spz("legacy.spz")
singlet.write_spz(adata, "legacy.spz")`}
              title="File I/O"
            />
          </section>

          <div className="h-px bg-border/50 mx-auto my-6" />

          {/* ────────── ANNOTATE ────────── */}
          <section id="annotate" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Annotate</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Project cells onto biological programs and annotate cell types using
              the NMF gene program dictionary. Runs locally — no API key needed.
            </p>

            <CodeBlock
              code={`# Cell type annotation
annotations = singlet.annotate(adata)
# Returns DataFrame: cell_type, confidence, programs

# Project onto gene programs (NMF)
H = singlet.project(adata)
# Returns ndarray: cells × programs (activity matrix)

# Download the gene program dictionary
W = singlet.gene_programs("Homo sapiens")
# Returns DataFrame: genes × programs (weight matrix)`}
              title="Annotation"
            />
          </section>

          <div className="h-px bg-border/50 mx-auto my-6" />

          {/* ────────── CONVERT ────────── */}
          <section id="convert" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Convert</h2>

            <CodeBlock
              code={`# Convert .1pz to other formats
singlet.to_h5ad(adata, "output.h5ad")
singlet.to_zarr(adata, "output.zarr")

# Convert from other formats to AnnData
adata = singlet.from_h5ad("input.h5ad")
adata = singlet.from_zarr("input.zarr")

# Convert sparse matrix format
csc = singlet.to_csc(adata.X)  # CSR → CSC`}
              title="Format conversion"
            />
          </section>

          <div className="h-px bg-border/50 mx-auto my-6" />

          {/* ────────── CONFIGURATION ────────── */}
          <section id="config" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-6">Configuration</h2>

            <CodeBlock
              code={`# Use a local catalog directory (offline mode)
singlet.set_catalog_dir("/path/to/catalog")

# Change the download cache directory
singlet.set_cache_dir("/path/to/cache")

# Switch data backend
singlet.set_backend("r2")     # Cloudflare R2 (default)
singlet.set_backend("local")  # Local files only`}
              title="Configuration"
            />
          </section>

          <div className="h-px bg-border/50 mx-auto my-6" />

          {/* ────────── API REFERENCE ────────── */}
          <section id="reference" className="pt-16">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tightest mb-8">API Reference</h2>

            <RefGroup
              icon={<Database size={16} className="text-primary" />}
              label="Catalog & Browse"
              fns={[
                { fn: "singlet.catalog(query?, organism?, min_cells?)", desc: "Browse GEO series in the atlas. Returns DataFrame." },
                { fn: "singlet.samples(gse_id?, organism?, status?, min_cells?, quality_tier?)", desc: "Browse individual samples with QC metrics. Filter by quality tier (gold/silver/bronze)." },
                { fn: "singlet.top_series(n?, min_samples?, organism?)", desc: "Discover top GEO series ranked by total cell count. Returns n_samples, total_cells, avg_mapping_rate." },
                { fn: "singlet.datasets(gse_id?)", desc: "List datasets (alias for filtered catalog). Returns DataFrame." },
                { fn: "singlet.info(gse_id)", desc: "Metadata for a specific GEO series. Returns dict." },
                { fn: "singlet.species()", desc: "List all species in the atlas. Returns list of strings." },
                { fn: "singlet.tissues()", desc: "Normalized tissue distribution across SUCCESS samples (80 categories)." },
                { fn: "singlet.protocols()", desc: "Protocol distribution across SUCCESS samples." },
                { fn: "singlet.quality_tiers()", desc: "Quality tier breakdown (gold/silver/bronze) with metrics." },
                { fn: "singlet.sample_index(gse_id?)", desc: "Per-sample column offsets within .1pz files. Returns DataFrame." },
              ]}
            />

            <RefGroup
              icon={<Download size={16} className="text-primary" />}
              label="Load & Download"
              fns={[
                { fn: "singlet.load(path_or_id, layers?, include_kraken2?)", desc: "Load a sample or .1pz file as AnnData. Resolves GSM IDs, GSE IDs, or file paths." },
                { fn: "singlet.load_sample(gsm_id)", desc: "Load a single sample from a multi-sample .1pz using column-range reading." },
                { fn: "singlet.download(gse_id)", desc: "Download .1pz file(s) for a GEO series to cache." },
              ]}
            />

            <RefGroup
              icon={<FileCode size={16} className="text-primary" />}
              label="File I/O"
              fns={[
                { fn: "singlet.read_1pz(path)", desc: "Read .1pz file → AnnData." },
                { fn: "singlet.write_1pz(adata, path)", desc: "Write AnnData → .1pz file." },
                { fn: "singlet.info_1pz(path)", desc: "Read .1pz metadata without loading the count matrix." },
                { fn: "singlet.read_matrix(path)", desc: "Auto-detect and read .1pz or .spz file." },
                { fn: "singlet.read_kraken2(directory)", desc: "Read Kraken2 microbiome taxonomic matrix." },
                { fn: "singlet.read_spz(path)", desc: "Read legacy .spz file → AnnData." },
                { fn: "singlet.write_spz(adata, path)", desc: "Write AnnData → legacy .spz file." },
                { fn: "singlet.spz_info(path)", desc: "Read legacy .spz metadata." },
              ]}
            />

            <RefGroup
              icon={<Search size={16} className="text-primary" />}
              label="Annotate & Project"
              fns={[
                { fn: "singlet.annotate(adata)", desc: "Cell type annotation using NMF programs. Returns DataFrame." },
                { fn: "singlet.project(adata)", desc: "Project cells onto gene programs. Returns ndarray (cells × programs)." },
                { fn: "singlet.gene_programs(species)", desc: "Download the NMF gene program dictionary (W matrix). Returns DataFrame." },
              ]}
            />

            <RefGroup
              icon={<Settings size={16} className="text-primary" />}
              label="Configuration"
              fns={[
                { fn: "singlet.set_catalog_dir(path)", desc: "Set local catalog directory for offline browsing." },
                { fn: "singlet.set_cache_dir(path)", desc: "Set download cache directory." },
                { fn: "singlet.set_backend(name)", desc: "Switch data backend ('r2' or 'local')." },
                { fn: "singlet.login(key)", desc: "Authenticate with API key for token-priced functions." },
              ]}
            />

            <RefGroup
              icon={<Search size={16} className="text-primary" />}
              label="Query (requires API key)"
              fns={[
                { fn: "singlet.query(...)", desc: "Cross-atlas query → AnnData. Token-priced." },
                { fn: "singlet.search(text)", desc: "Natural-language search across the atlas. Token-priced." },
              ]}
            />

            <RefGroup
              icon={<FileCode size={16} className="text-primary" />}
              label="Convert"
              fns={[
                { fn: "singlet.to_h5ad(adata, path)", desc: "Write AnnData → H5AD." },
                { fn: "singlet.to_zarr(adata, path)", desc: "Write AnnData → Zarr store." },
                { fn: "singlet.to_csc(matrix)", desc: "Convert sparse matrix to CSC format." },
                { fn: "singlet.from_h5ad(path)", desc: "Read H5AD → AnnData." },
                { fn: "singlet.from_zarr(path)", desc: "Read Zarr → AnnData." },
              ]}
            />
          </section>

          {/* ────────── LINKS ────────── */}
          <section className="pt-16 pb-8">
            <div className="grid sm:grid-cols-3 gap-4">
              <Link to="/browse" className="rounded-lg border border-border bg-card p-5 hover:border-primary/40 transition-colors group">
                <Database size={18} className="text-primary mb-2" />
                <h4 className="font-display text-sm font-semibold text-foreground mb-1">Browse Database</h4>
                <p className="text-xs text-muted-foreground">Explore all {totalSamples} samples in the atlas.</p>
                <span className="inline-flex items-center gap-1 text-xs text-primary mt-2 group-hover:gap-2 transition-all">
                  Browse <ArrowRight size={12} />
                </span>
              </Link>
              <Link to="/notebooks" className="rounded-lg border border-border bg-card p-5 hover:border-primary/40 transition-colors group">
                <BookOpen size={18} className="text-primary mb-2" />
                <h4 className="font-display text-sm font-semibold text-foreground mb-1">Notebooks</h4>
                <p className="text-xs text-muted-foreground">17 interactive Jupyter notebooks with examples.</p>
                <span className="inline-flex items-center gap-1 text-xs text-primary mt-2 group-hover:gap-2 transition-all">
                  View <ArrowRight size={12} />
                </span>
              </Link>
              <Link to="/docs" className="rounded-lg border border-border bg-card p-5 hover:border-primary/40 transition-colors group">
                <FileCode size={18} className="text-primary mb-2" />
                <h4 className="font-display text-sm font-semibold text-foreground mb-1">Intelligence API</h4>
                <p className="text-xs text-muted-foreground">Predict, generate, and analyze with NMF programs.</p>
                <span className="inline-flex items-center gap-1 text-xs text-primary mt-2 group-hover:gap-2 transition-all">
                  Docs <ArrowRight size={12} />
                </span>
              </Link>
            </div>
          </section>

        </div>
      </div>

      <Footer />
    </div>
  );
};

export default AtlasDocs;
