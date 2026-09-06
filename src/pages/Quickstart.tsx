import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PY_INSTALL, R_INSTALL_STANDALONE, GITHUB_ISSUES } from "@/lib/install-snippets";
import { claudeDesktopConfig, cursorConfig, claudeCodeConfig } from "@/lib/mcp-snippets";

const KEY_PLACEHOLDER = "sk_live_…";

const Quickstart = () => {
  usePageMeta({
    title: "Quickstart",
    description: "Get started with singlet in five minutes: install the Python or R package, find a study, and load it as AnnData or SingleCellExperiment.",
    path: "/quickstart",
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-10 md:py-14">
        <article className="prose-doc max-w-[760px]">
          <header className="mb-10">
            <Logo variant="mark" height={28} link={false} className="docs-brand-mark mb-4" />
              <h1 className="text-[36px] md:text-[42px] mb-3">Getting started — for labs</h1>
            <p className="text-[17px] text-muted-foreground">
              Install once, find a study in plain English, and load it in one line. No account needed to browse or download.
            </p>
          </header>

          {/* ── Step 1: Install ── */}
          <section className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <div className="flex items-baseline gap-3 mb-4">
              <span className="flex items-center justify-center w-8 h-8 rounded bg-primary text-white text-sm font-semibold">1</span>
              <h2 className="m-0">Install</h2>
            </div>
            <p>Python 3.9 or newer.</p>
            <CodeBlock label="bash" code={PY_INSTALL} />
            <p className="mt-4">R 4.2 or newer.</p>
            <CodeBlock label="r" code={R_INSTALL_STANDALONE} />
          </section>

          {/* ── Step 2: Find ── */}
          <section className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <div className="flex items-baseline gap-3 mb-4">
              <span className="flex items-center justify-center w-8 h-8 rounded bg-primary text-white text-sm font-semibold">2</span>
              <h2 className="m-0">Find</h2>
            </div>
            <p>
              Describe what you need — a tissue, disease, cell type, organism, or a GEO accession. The same query works in
              the site search bar and in the packages.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <CodeBlock
                label="python"
                code={`import singlet

accs = singlet.find("microglia in the aging mouse brain")
print(accs)   # ['GSE...', ...]`}
              />
              <CodeBlock
                label="r"
                code={`library(singlet)

accs <- find("microglia in the aging mouse brain")
print(accs)   # c("GSE...", ...)`}
              />
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              <code className="code-inline">find</code> returns GSE accessions. Use{" "}
              <code className="code-inline">find_load(...)</code> to load the matched studies in one call.
            </p>
          </section>

          {/* ── Step 3: Load ── */}
          <section className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <div className="flex items-baseline gap-3 mb-4">
              <span className="flex items-center justify-center w-8 h-8 rounded bg-primary text-white text-sm font-semibold">3</span>
              <h2 className="m-0">Load</h2>
            </div>
            <p>Pass a GEO series accession. You get one object for the whole study.</p>
            <div className="grid md:grid-cols-2 gap-3">
              <CodeBlock
                label="python"
                code={`adata = singlet.load("GSE178957")   # AnnData
adata.obs[["gsm_id", "organism", "protocol"]].head()`}
              />
              <CodeBlock
                label="r"
                code={`sce <- load("GSE178957")   # SingleCellExperiment
# or: seu <- load("GSE178957", as = "seurat")
head(colData(sce)$gsm_id)`}
              />
            </div>

            <h3 className="mt-8">What you get</h3>
            <ul>
              <li>
                <code className="code-inline">X</code> — gene counts (exon + intron), cells × genes, sparse CSR.
              </li>
              <li>
                Layers <code className="code-inline">spliced</code> and <code className="code-inline">unspliced</code> for RNA velocity.
              </li>
              <li>
                <code className="code-inline">obs</code> / <code className="code-inline">colData</code> with sample id, organism, protocol, tissue, disease, and QC columns.
              </li>
              <li>
                <code className="code-inline">var</code> / <code className="code-inline">rowData</code> with gene ids from the reference build: human{" "}
                <code className="code-inline">GRCh38-2024-A</code> or mouse <code className="code-inline">GRCm39-2024-A</code>.
              </li>
            </ul>
          </section>

          {/* ── Use it from an AI assistant ── */}
          <section className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2 className="mb-4">Use it from an AI assistant</h2>
            <p>
              Paste the config below into Claude Desktop, Cursor or Claude Code and ask away — no account needed to
              start. Signing in and adding a key raises the daily search allowance from 10 to 200. Full guide:{" "}
              <Link to="/docs/mcp" className="text-primary hover:underline">Use singlet from Claude, Cursor or ChatGPT</Link>.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <CodeBlock
                label="claude desktop (claude_desktop_config.json)"
                code={claudeDesktopConfig(KEY_PLACEHOLDER)}
              />
              <CodeBlock
                label="cursor (.cursor/mcp.json)"
                code={cursorConfig(KEY_PLACEHOLDER)}
              />
            </div>
            <CodeBlock
              className="mt-3"
              label="claude code"
              code={claudeCodeConfig(KEY_PLACEHOLDER)}
            />
          </section>

          {/* ── Good to know ── */}
          <section className="pb-12 mb-12 border-b border-border scroll-mt-20">
            <h2 className="mb-4">Good to know</h2>
            <ul>
              <li>One <code className="code-inline">.singlet</code> file per study. Filter on <code className="code-inline">gsm_id</code> after loading to work with individual samples.</li>
              <li>Files are cached locally after the first load. Set <code className="code-inline">SINGLET_CACHE_DIR</code> to choose where.</li>
              <li>Study files are large — hundreds of MB to a few GB.</li>
              <li>Anonymous AI search is limited to 10 questions per day. Keyword search and downloads are unlimited and need no account.</li>
              <li>All data is CC0; code is MIT.</li>
            </ul>
          </section>

          {/* ── Found a problem? ── */}
          <section className="scroll-mt-20">
            <h2 className="mb-4">Found a problem?</h2>
            <p>
              Open an issue on{" "}
              <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                GitHub Issues
              </a>
              {" "}— bug reports, missing studies, and pipeline questions are welcome.
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
};

export default Quickstart;
