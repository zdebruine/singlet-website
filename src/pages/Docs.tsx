import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cn } from "@/lib/utils";
import { GITHUB_ISSUES, GITHUB_REPO, PY_INSTALL, R_INSTALL, R_INSTALL_STANDALONE } from "@/lib/install-snippets";

const SECTIONS = [
  { id: "install", label: "Install" },
  { id: "load", label: "Load a study" },
  { id: "search", label: "Search" },
  { id: "singlet-file", label: "What's in a .singlet file" },
  { id: "r", label: "R" },
  { id: "python", label: "Python API" },
  { id: "api-keys", label: "API keys & MCP" },
  { id: "pipeline", label: "Bring your own data" },
] as const;

const MCP_URL = "https://singlet.bio/mcp";
const KEY_PLACEHOLDER = "sk_live_…";

type SectionId = (typeof SECTIONS)[number]["id"];

function useScrollSpy(ids: readonly string[]) {
  const [active, setActive] = useState<string>(ids[0]);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -65% 0px", threshold: [0, 1] },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [ids]);
  return active;
}

function useHashScroll() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    }, 40);
    return () => clearTimeout(t);
  }, [hash]);
}

const Mono = ({ children }: { children: React.ReactNode }) => <code className="code-inline">{children}</code>;

const Docs = () => {
  usePageMeta({
    title: "Docs",
    description: "Install singlet, load any GEO study as AnnData or SingleCellExperiment in one line, search the atlas, and run the pipeline on your own data.",
    path: "/docs",
  });
  const ids = SECTIONS.map((s) => s.id);
  const active = useScrollSpy(ids);
  useHashScroll();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-10 md:py-14">
        <div className="grid lg:grid-cols-[220px_minmax(0,1fr)] gap-10 xl:gap-16">
          {/* Sidebar */}
          <aside className="hidden lg:block">
            <nav aria-label="Docs sections" className="sticky top-20">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Docs</p>
              <ul className="space-y-0.5 border-l border-border">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={cn(
                        "block -ml-px pl-3 py-1 text-[13px] border-l transition-colors",
                        active === s.id
                          ? "border-primary text-foreground font-medium"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Content */}
          <article className="prose-doc max-w-[760px]">
            <header className="mb-10">
              <h1 className="text-[36px] md:text-[42px] mb-3">Docs</h1>
              <p className="text-[17px] text-muted-foreground">
                Everything on this page is the same for every study in the atlas: install once, load by GEO accession, and the
                object that comes back is a standard AnnData or SingleCellExperiment.
              </p>
              {/* Mobile TOC */}
              <ul className="lg:hidden mt-5 flex flex-wrap gap-2">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="chip">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </header>

            {/* ── Install ── */}
            <Section id="install" title="Install">
              <p>Python 3.9 or newer.</p>
              <CodeBlock label="bash" code={PY_INSTALL} />
              <p className="mt-4">R 4.2 or newer.</p>
              <CodeBlock label="r" code={R_INSTALL_STANDALONE} />
              <p className="mt-4">
                No account, API key or configuration is needed to load data. Files are fetched from{" "}
                <a href="https://data.singlet.bio" rel="noopener noreferrer">data.singlet.bio</a> on first use and cached
                locally.
              </p>
              <h3>Optional extras (Python)</h3>
              <p>Extras add optional dependencies on top of the base install:</p>
              <CodeBlock label="bash" code={`${PY_INSTALL}#egg=singlet[torch]`} />
              <table>
                <thead>
                  <tr>
                    <th>Extra</th>
                    <th>Adds</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Mono>[torch]</Mono></td>
                    <td>PyTorch dataset / dataloader helpers for training on atlas data.</td>
                  </tr>
                  <tr>
                    <td><Mono>[gpu]</Mono></td>
                    <td>CuPy (CUDA 12) for GPU-accelerated analysis.</td>
                  </tr>
                  <tr>
                    <td><Mono>[mcp]</Mono></td>
                    <td>A local MCP server (the hosted one at <Mono>singlet.bio/mcp</Mono> needs no install; see <a href="#api-keys">API keys &amp; MCP</a>).</td>
                  </tr>
                  <tr>
                    <td><Mono>[all]</Mono></td>
                    <td>Every optional dependency.</td>
                  </tr>
                </tbody>
              </table>
            </Section>

            {/* ── Load a study ── */}
            <Section id="load" title="Load a study">
              <p>
                Pass a GEO series accession. You get one object for the whole study: cells from every processed sample,
                with the sample id (<Mono>gsm_id</Mono>), organism, protocol and the sample's GEO characteristics in{" "}
                <Mono>obs</Mono> / <Mono>colData</Mono>. Cell names are <Mono>&lt;GSM&gt;_&lt;barcode&gt;</Mono>.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <CodeBlock
                  label="python"
                  code={`import singlet

adata = singlet.load("GSE178957")   # AnnData
adata.obs[["gsm_id", "organism", "protocol"]].head()`}
                />
                <CodeBlock
                  label="r"
                  code={`library(singlet)

sce <- load("GSE178957")   # SingleCellExperiment
head(colData(sce)$gsm_id)`}
                />
              </div>
              <h3>Several studies at once</h3>
              <p>
                Pass a vector of accessions and the studies are concatenated on the shared gene space. Use{" "}
                <Mono>obs["gsm_id"]</Mono> (and the study metadata in <Mono>uns["study_meta"]</Mono>) to tell them apart.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <CodeBlock label="python" code={`adata = singlet.load(["GSE178957", "GSE184652"])`} />
                <CodeBlock label="r" code={`sce <- load(c("GSE178957", "GSE184652"))`} />
              </div>
              <h3>Files on disk</h3>
              <p>
                Every study is a single <Mono>.singlet</Mono> file at{" "}
                <Mono>https://data.singlet.bio/data/&lt;GSE&gt;/&lt;GSE&gt;.singlet</Mono>. You can download it with
                curl and load the local path the same way. There are no per-sample files; filter on{" "}
                <Mono>obs["gsm_id"]</Mono> after loading.
              </p>
              <CodeBlock
                label="bash"
                code={`curl -LO https://data.singlet.bio/data/GSE178957/GSE178957.singlet
python -c 'import singlet; print(singlet.load("GSE178957.singlet"))'`}
              />
            </Section>

            {/* ── Search ── */}
            <Section id="search" title="Search">
              <p>
                The same search that powers <Link to="/browse">Browse</Link> is available in both packages. Plain English
                is interpreted into catalog filters (organism, tissue, cell type, disease, protocol); accessions and
                keywords are matched directly. <Mono>find</Mono> returns accessions, <Mono>find_load</Mono> loads them.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <CodeBlock
                  label="python"
                  code={`accs = singlet.find("microglia in the aging mouse brain")
adata = singlet.find_load("human PBMC, COVID-19, 10x 5'")

# The full catalog as a DataFrame — filter it yourself
cat = singlet.catalog()
cat[(cat.organism == "Mus musculus") & (cat.tissue == "brain")]`}
                />
                <CodeBlock
                  label="r"
                  code={`accs <- find("microglia in the aging mouse brain")
sce  <- find_load("human PBMC, COVID-19, 10x 5'")`}
                />
              </div>
              <p>
                Search on this website, in the packages and in the MCP server all call the same public endpoint,{" "}
                <Mono>GET https://singlet.bio/api/nl-search?q=…</Mono>, which returns the matched accessions and the
                filters it interpreted. Results are catalog metadata. Interpretations are cached for an hour per
                question text and are not tied to you; the only thing kept per visitor is a daily count of AI requests.
              </p>
              <p>
                Interpreting plain English costs a model call, so it is rate-limited: <strong>10 AI searches a day</strong>{" "}
                without an account (per network address) and <strong>200 a day</strong> signed in (free — Google, GitHub or
                an email link). Repeated questions come from cache and don't count. When the budget is spent the endpoint
                still answers with a plain keyword search and sets <Mono>quota_exceeded: true</Mono>; accessions, filters
                in the rail and the catalog itself are never limited. Signed-in users can also ask for a one-sentence,
                metadata-grounded explanation of why each study matched (100 a day). From a script or an assistant, use
                an <a href="#api-keys">API key</a> to search under your own allowance.
              </p>
            </Section>

            {/* ── .singlet file ── */}
            <Section id="singlet-file" title="What's in a .singlet file">
              <p>
                A <Mono>.singlet</Mono> file is a ZIP64 archive. Inside are sparse count matrices stored as{" "}
                <Mono>.1pz</Mono> blocks (zstd-compressed, readable without unpacking the whole archive) and a few JSON
                metadata files. The loaders read only the members they need.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>What it is</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Mono>exon_counts.1pz</Mono></td>
                    <td>Cells × genes, reads assigned to exons. This is <Mono>adata.X</Mono> / <Mono>counts(sce)</Mono>.</td>
                  </tr>
                  <tr>
                    <td><Mono>intron_counts.1pz</Mono></td>
                    <td>Cells × genes, intronic reads (for RNA velocity or nuclear fraction).</td>
                  </tr>
                  <tr>
                    <td><Mono>sj_counts.1pz</Mono></td>
                    <td>Cells × splice junctions.</td>
                  </tr>
                  <tr>
                    <td><Mono>splice_psi.1pz</Mono></td>
                    <td>Per-junction percent-spliced-in, where computable.</td>
                  </tr>
                  <tr>
                    <td><Mono>mt_heteroplasmy.1pz</Mono></td>
                    <td>Mitochondrial variant allele fractions per cell.</td>
                  </tr>
                  <tr>
                    <td><Mono>vdj_gene_usage.1pz</Mono></td>
                    <td>V(D)J gene usage per cell (when the library supports it).</td>
                  </tr>
                  <tr>
                    <td><Mono>study_meta.json</Mono></td>
                    <td>GEO series metadata and per-sample characteristics.</td>
                  </tr>
                  <tr>
                    <td><Mono>feature_vocab.json</Mono></td>
                    <td>Gene ids and symbols for the reference the study was mapped to.</td>
                  </tr>
                  <tr>
                    <td><Mono>manifest.json</Mono></td>
                    <td>Member list, sizes, checksums, pipeline version.</td>
                  </tr>
                </tbody>
              </table>
              <p>
                Optional matrices are present only when the protocol produces them. <Mono>load()</Mono> returns the exon
                count matrix; the other members can be read with the lower-level bundle API (
                <Mono>singlet.bundle.SingletBundle</Mono> in Python, <Mono>read_1pz()</Mono> in R) without unpacking the
                archive.
              </p>
            </Section>

            {/* ── R ── */}
            <Section id="r" title="R">
              <p>
                <Mono>load()</Mono> returns a <Mono>SingleCellExperiment</Mono> by default. Pass{" "}
                <Mono>as = "seurat"</Mono> for a Seurat object.
              </p>
              <CodeBlock
                label="r"
                code={`library(singlet)

sce <- load("GSE178957")                 # SingleCellExperiment
seu <- load("GSE178957", as = "seurat")  # Seurat

accs <- find("tumor-infiltrating T cells in melanoma")
sce  <- find_load("zebrafish development")`}
              />
              <h3>Required and optional packages</h3>
              <ul>
                <li>
                  <Mono>SingleCellExperiment</Mono>, <Mono>SummarizedExperiment</Mono> and <Mono>S4Vectors</Mono> are
                  needed for the default return type. Install them from Bioconductor:
                </li>
              </ul>
              <CodeBlock
                label="r"
                code={`if (!requireNamespace("BiocManager", quietly = TRUE)) install.packages("BiocManager")
BiocManager::install(c("SingleCellExperiment", "SummarizedExperiment", "S4Vectors"))`}
              />
              <ul className="mt-4">
                <li>
                  <Mono>Seurat</Mono> is only needed when you call <Mono>load(…, as = "seurat")</Mono>.
                </li>
                <li>
                  The base package itself depends only on <Mono>Rcpp</Mono>, <Mono>Matrix</Mono> and <Mono>jsonlite</Mono>;
                  the lower-level readers (<Mono>read_1pz()</Mono>, <Mono>read_singlet()</Mono>) work with sparse{" "}
                  <Mono>Matrix</Mono> objects.
                </li>
              </ul>
            </Section>

            {/* ── Python API ── */}
            <Section id="python" title="Python API">
              <table>
                <thead>
                  <tr>
                    <th>Function</th>
                    <th>Returns</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Mono>singlet.load(acc_or_path, ...)</Mono></td>
                    <td>
                      <Mono>AnnData</Mono>. Accepts a GSE accession, a local <Mono>.singlet</Mono> path, or a list of
                      either (concatenated).
                    </td>
                  </tr>
                  <tr>
                    <td><Mono>singlet.find(query)</Mono></td>
                    <td>List of GSE accessions matching a plain-English or keyword query.</td>
                  </tr>
                  <tr>
                    <td><Mono>singlet.find_load(query)</Mono></td>
                    <td><Mono>find</Mono> followed by <Mono>load</Mono>, as one <Mono>AnnData</Mono>.</td>
                  </tr>
                  <tr>
                    <td><Mono>singlet.catalog()</Mono></td>
                    <td>The full sample catalog as a pandas <Mono>DataFrame</Mono> (one row per GSM).</td>
                  </tr>
                  <tr>
                    <td><Mono>singlet.load_dir(path)</Mono></td>
                    <td>Load a directory of pipeline output (your own data) as <Mono>AnnData</Mono>.</td>
                  </tr>
                  <tr>
                    <td><Mono>singlet.summary()</Mono></td>
                    <td>Atlas overview: counts of studies, samples and cells by organism and protocol.</td>
                  </tr>
                </tbody>
              </table>
              <h3>What you get back</h3>
              <ul>
                <li><Mono>adata.X</Mono> — raw exon UMI counts, cells × genes, sparse CSR.</li>
                <li><Mono>adata.obs</Mono> — <Mono>gsm_id</Mono>, <Mono>organism</Mono>, <Mono>protocol</Mono>, <Mono>protocol_name</Mono>, <Mono>sample_source</Mono>, <Mono>sample_characteristics</Mono> (the GEO characteristics string), <Mono>reference_build</Mono>, <Mono>n_cells_sample</Mono>.</li>
                <li><Mono>adata.var</Mono> — indexed by <Mono>gene_id</Mono>, with <Mono>gene_name</Mono> from the reference annotation.</li>
                <li><Mono>adata.uns["study_meta"]</Mono> and <Mono>adata.uns["manifest"]</Mono> — the study's GEO metadata and the bundle manifest (pipeline version, checksums).</li>
              </ul>
              <CodeBlock
                label="python"
                code={`import singlet, scanpy as sc

adata = singlet.load("GSE178957")
sc.pp.filter_cells(adata, min_genes=200)
sc.pp.normalize_total(adata); sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata, batch_key="gsm_id")`}
              />
              <h3>PyTorch</h3>
              <p>
                The <Mono>[torch]</Mono> extra adds dataset helpers that stream cells from <Mono>.singlet</Mono> files
                as sparse tensors, so a training loop never has to densify a whole study. See the package README for the
                current API.
              </p>
            </Section>

            {/* ── API keys & MCP ── */}
            <Section id="api-keys" title="API keys & MCP">
              <p>
                Loading and downloading data never needs a key. A key is for two things: running natural-language searches
                from code under your own daily allowance (200 a day, shared with the website), and connecting an assistant
                to the atlas through the MCP server.
              </p>
              <h3>Create a key</h3>
              <ol>
                <li>
                  <Link to="/account">Sign in</Link> (free — Google, GitHub or an email link) and open{" "}
                  <Link to="/account#api-keys">Account → API keys</Link>.
                </li>
                <li>Give the key a name (and an expiry if you like) and click <strong>Create key</strong>.</li>
                <li>
                  Copy it right away. The full key is shown once; afterwards only its first characters are visible. Revoke
                  it from the same page at any time.
                </li>
              </ol>
              <p>
                Send the key as <Mono>Authorization: Bearer {KEY_PLACEHOLDER}</Mono> or as an <Mono>X-API-Key</Mono> header.
                It is accepted by <Mono>/api/nl-search</Mono>, <Mono>/api/search</Mono>, <Mono>/api/facets</Mono> and{" "}
                <Mono>/api/gse/:id</Mono>; searches count against the owner's allowance and an invalid, expired or revoked
                key is answered with <Mono>401</Mono>.
              </p>
              <CodeBlock
                label="bash"
                code={`curl -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  "https://singlet.bio/api/nl-search?q=microglia+in+the+aging+mouse+brain"`}
              />
              <h3>In the packages</h3>
              <div className="grid md:grid-cols-2 gap-3">
                <CodeBlock
                  label="python"
                  code={`import singlet
singlet.set_api_key("${KEY_PLACEHOLDER}")
# or: export SINGLET_API_KEY=${KEY_PLACEHOLDER}

accs = singlet.find("microglia in the aging mouse brain")`}
                />
                <CodeBlock
                  label="r"
                  code={`Sys.setenv(SINGLET_API_KEY = "${KEY_PLACEHOLDER}")

library(singlet)
accs <- find("microglia in the aging mouse brain")`}
                />
              </div>

              <h3>MCP server</h3>
              <p>
                <Mono>{MCP_URL}</Mono> is a hosted Model Context Protocol server (Streamable HTTP, stateless) that lets an
                assistant — Claude Desktop, Claude Code, Cursor, VS Code — search the atlas, read a study's metadata and
                hand back a download URL or a loader snippet. Listing the tools works without a key; calling one requires
                your API key in the <Mono>Authorization</Mono> header.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <CodeBlock
                  label="claude desktop (claude_desktop_config.json)"
                  code={`{
  "mcpServers": {
    "singlet": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${MCP_URL}",
        "--header", "Authorization: Bearer ${KEY_PLACEHOLDER}"
      ]
    }
  }
}`}
                />
                <CodeBlock
                  label="cursor (.cursor/mcp.json)"
                  code={`{
  "mcpServers": {
    "singlet": {
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer ${KEY_PLACEHOLDER}" }
    }
  }
}`}
                />
              </div>
              <CodeBlock
                className="mt-3"
                label="claude code"
                code={`claude mcp add --transport http singlet ${MCP_URL} \\
  --header "Authorization: Bearer ${KEY_PLACEHOLDER}"`}
              />
              <table>
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Does</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Mono>search_datasets</Mono></td>
                    <td>
                      Plain English, keywords or an accession → matching studies (or samples) with the interpreted filters, a
                      one-line reason per study and its download URL. Optional extra filters: organism, tissue, disease,
                      assay, min_cells.
                    </td>
                  </tr>
                  <tr>
                    <td><Mono>get_study</Mono></td>
                    <td>Everything the study page shows for one GSE: title, abstract, organisms, tissues, design, samples, QC.</td>
                  </tr>
                  <tr>
                    <td><Mono>get_download_url</Mono></td>
                    <td>The <Mono>.singlet</Mono> URL for a GSE plus the Python and R one-liners to load it.</td>
                  </tr>
                  <tr>
                    <td><Mono>get_atlas_stats</Mono></td>
                    <td>Live corpus numbers: studies, samples processed, cells, species.</td>
                  </tr>
                </tbody>
              </table>
              <p>
                Try it from a terminal (no key needed for this call):
              </p>
              <CodeBlock
                label="bash"
                code={`curl -X POST ${MCP_URL} -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
              />
              <p className="text-xs text-muted-foreground">
                The package also ships a local stdio server (<Mono>{PY_INSTALL}#egg=singlet[mcp]</Mono>, then{" "}
                <Mono>python -m singlet.mcp</Mono>) that loads data on your machine. Questions or problems →{" "}
                <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">GitHub Issues</a>.
              </p>
            </Section>

            {/* ── BYOD / pipeline ── */}
            <Section id="pipeline" title="Bring your own data (pipeline)">
              <p>
                The atlas is produced by the same open-source pipeline that ships in the package. Running it on your own
                SRA run or FASTQ files gives you output in the same layout, mapped to the same references, so your data
                can be loaded and compared alongside any public study.
              </p>
              <CodeBlock
                label="bash"
                code={`${PY_INSTALL}

# From an SRA run accession
singlet-process SRR11537951 --output-dir ./out --organism human --threads 8

# From local FASTQ files
singlet-process --reads R1.fastq.gz R2.fastq.gz --output-dir ./out --organism mouse`}
              />
              <CodeBlock
                className="mt-3"
                label="python"
                code={`from singlet.pipeline import run

result = run("SRR11537951", "./out", organism="human", threads=8)
adata = singlet.load_dir(result.output_dir)`}
              />
              <ul className="mt-4">
                <li>Supported organisms today: human (GRCh38) and mouse (GRCm39). See <Link to="/about#references">About the data</Link> for the exact builds.</li>
                <li>Protocol (10x chemistry, Drop-seq, …) is detected from the reads and the run metadata.</li>
                <li>The output directory contains the same matrices listed under <a href="#singlet-file">What's in a .singlet file</a>, plus the run log and per-cell QC table.</li>
                <li>Source and the full CLI reference are on <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer">GitHub</a>; questions and bugs go to <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">GitHub Issues</a>.</li>
              </ul>
            </Section>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
};

function Section({ id, title, children }: { id: SectionId; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="pb-12 mb-12 border-b border-border last:border-b-0 last:mb-0 last:pb-0 scroll-mt-20">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default Docs;
