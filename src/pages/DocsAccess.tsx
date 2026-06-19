/**
 * /docs/access — Programmatic Access quickstart
 *
 * Inline Python + R tabs (install, singlet.load by GSE, catalog filter)
 * + MCP note.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, ArrowRight, Terminal, Code2, Server } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted transition-colors"
    >
      {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
    </button>
  );
}

function CodeBlock({ code, lang = "python" }: { code: string; lang?: string }) {
  return (
    <div className="relative rounded-lg bg-background border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <span className="text-xs text-muted-foreground font-mono">{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-4 font-mono text-xs text-foreground leading-6 overflow-x-auto whitespace-pre">
        {code.split("\n").map((line, i) => {
          if (line.trimStart().startsWith("#")) {
            return <div key={i} className="text-muted-foreground">{line}</div>;
          }
          // Highlight strings
          return <div key={i} dangerouslySetInnerHTML={{ __html: line.replace(/("[^"]*"|'[^']*')/g, '<span class="text-primary">$1</span>') }} />;
        })}
      </pre>
    </div>
  );
}

const PYTHON_INSTALL = `pip install singlet`;

const PYTHON_LOAD_GSE = `import singlet

# List all samples in a GEO series
df = singlet.samples(gse_id="GSE200218")
print(df[["gsm_id", "organism", "status", "n_cells"]])

# Load the first successful sample into AnnData
gsm_id = df.loc[df["status"] == "SUCCESS", "gsm_id"].iloc[0]
adata = singlet.load(gsm_id)
print(adata)  # AnnData: 18432 cells × 28476 genes`;

const PYTHON_CATALOG_FILTER = `import singlet

# Browse the catalog with filters
df = singlet.catalog(
    organism="Homo sapiens",
    tissue="blood",
    status="SUCCESS",
    min_cells=10000,
)
print(f"{len(df)} samples matched")

# Load any sample directly
adata = singlet.load("GSM6010234")
adata.obs.head()`;

const PYTHON_PYTORCH = `import singlet, torch

# Stream directly into a PyTorch DataLoader
loader = singlet.dataloader(
    organism="Homo sapiens",
    tissue="lung",
    batch_size=512,
    device="cuda",
)

for cells, meta in loader:        # cells on GPU
    logits = model(cells)
    loss = criterion(logits, meta["cell_type"])
    loss.backward()`;

const R_INSTALL = `install.packages("singlet")  # CRAN
# or from GitHub:
# remotes::install_github("Singlet-Bio/singlet/r")`;

const R_LOAD_GSE = `library(singlet)

# List samples in a series
df <- singlet_samples(gse_id = "GSE200218")
head(df[, c("gsm_id", "organism", "status", "n_cells")])

# Load a sample as SingleCellExperiment
gsm_id <- df$gsm_id[df$status == "SUCCESS"][1]
sce <- singlet_load(gsm_id)
sce`;

const R_CATALOG_FILTER = `library(singlet)

# Filter the catalog
df <- singlet_catalog(
  organism = "Homo sapiens",
  tissue   = "liver",
  status   = "SUCCESS",
  min_cells = 10000
)
cat(nrow(df), "samples matched\\n")

# Convert to Seurat
library(Seurat)
seu <- singlet_load("GSM5220101", format = "seurat")
seu`;

const CURL_EXAMPLE = `# Download a .singlet bundle directly
curl -L "https://data.singlet.bio/bundles/GSE200218.singlet" \\
     -o "GSE200218.singlet"

# Inspect size first
curl -sI "https://data.singlet.bio/bundles/GSE200218.singlet" \\
  | grep content-length`;

const DocsAccess = () => {
  const [pyTab, setPyTab] = useState<"load" | "filter" | "pytorch">("load");
  const [rTab, setRTab] = useState<"load" | "filter">("load");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-8">
            <Link to="/docs" className="hover:text-foreground">Docs</Link>
            <span>/</span>
            <span className="text-foreground">Programmatic Access</span>
          </div>

          {/* Header */}
          <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-4">
            Programmatic Access
          </h1>
          <p className="text-muted-foreground text-base mb-10 max-w-2xl">
            Load any sample or series directly from the Singlet Atlas — no account, no API key.
            Data streams from Cloudflare R2 with <span className="font-medium text-foreground">$0 egress</span> and <span className="font-medium text-foreground">CC0 license</span>.
          </p>

          {/* Install */}
          <div className="mb-10">
            <h2 className="font-display text-lg font-bold text-foreground mb-3 flex items-center gap-2">
              <Terminal size={16} className="text-primary" /> Install
            </h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">Python</p>
                <CodeBlock code={PYTHON_INSTALL} lang="bash" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">R</p>
                <CodeBlock code={R_INSTALL} lang="r" />
              </div>
            </div>
          </div>

          <div className="glow-line mb-10" />

          {/* Python section */}
          <div className="mb-10">
            <h2 className="font-display text-lg font-bold text-foreground mb-4 flex items-center gap-2">
              <Code2 size={16} className="text-primary" /> Python
            </h2>

            <div className="rounded-xl border border-border overflow-hidden">
              {/* Tab bar */}
              <div className="flex border-b border-border bg-muted/20">
                {([
                  ["load", "Load by GSE/GSM"],
                  ["filter", "Catalog filter"],
                  ["pytorch", "PyTorch DataLoader"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setPyTab(key)}
                    className={`px-4 py-2.5 text-xs font-medium transition-colors ${pyTab === key ? "text-primary border-b-2 border-primary bg-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="p-4">
                {pyTab === "load" && <CodeBlock code={PYTHON_LOAD_GSE} />}
                {pyTab === "filter" && <CodeBlock code={PYTHON_CATALOG_FILTER} />}
                {pyTab === "pytorch" && <CodeBlock code={PYTHON_PYTORCH} />}
              </div>
            </div>
          </div>

          <div className="glow-line mb-10" />

          {/* R section */}
          <div className="mb-10">
            <h2 className="font-display text-lg font-bold text-foreground mb-4 flex items-center gap-2">
              <Code2 size={16} className="text-primary" /> R
            </h2>
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex border-b border-border bg-muted/20">
                {([
                  ["load", "Load by GSE/GSM"],
                  ["filter", "Catalog filter + Seurat"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setRTab(key)}
                    className={`px-4 py-2.5 text-xs font-medium transition-colors ${rTab === key ? "text-primary border-b-2 border-primary bg-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="p-4">
                {rTab === "load" && <CodeBlock code={R_LOAD_GSE} lang="r" />}
                {rTab === "filter" && <CodeBlock code={R_CATALOG_FILTER} lang="r" />}
              </div>
            </div>
          </div>

          <div className="glow-line mb-10" />

          {/* curl section */}
          <div className="mb-10">
            <h2 className="font-display text-lg font-bold text-foreground mb-3 flex items-center gap-2">
              <Terminal size={16} className="text-primary" /> Direct download (curl)
            </h2>
            <p className="text-sm text-muted-foreground mb-3">
              Each series and sample has a <span className="font-mono text-foreground">.singlet</span> bundle on Cloudflare R2.
              Download it directly — no auth required.
            </p>
            <CodeBlock code={CURL_EXAMPLE} lang="bash" />
          </div>

          <div className="glow-line mb-10" />

          {/* MCP section */}
          <div className="mb-10 rounded-xl border border-primary/30 bg-primary/[0.03] p-6">
            <div className="flex items-start gap-3">
              <Server size={18} className="text-primary mt-0.5 flex-shrink-0" />
              <div>
                <h2 className="font-display text-base font-bold text-foreground mb-2">MCP Server</h2>
                <p className="text-sm text-muted-foreground mb-3">
                  Singlet ships a built-in <span className="font-mono text-foreground">Model Context Protocol</span> server so AI coding assistants (Claude, Copilot, Cursor) can query the catalog and load samples on your behalf.
                </p>
                <CodeBlock
                  code={`# In your MCP config (mcp.json / cline_mcp_settings.json)
{
  "mcpServers": {
    "singlet": {
      "command": "python",
      "args": ["-m", "singlet.mcp"]
    }
  }
}`}
                  lang="json"
                />
                <p className="text-xs text-muted-foreground mt-3">
                  Once running, ask your assistant: <em>"Load the top lung cancer samples from singlet and show cell type composition."</em>
                </p>
              </div>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap gap-3">
            <Link
              to="/browse"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Browse Atlas <ArrowRight size={14} />
            </Link>
            <Link
              to="/docs"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Full documentation
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default DocsAccess;
