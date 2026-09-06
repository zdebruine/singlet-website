import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cn } from "@/lib/utils";
import { GITHUB_ISSUES, GITHUB_REPO, PY_INSTALL, R_INSTALL_STANDALONE, pyInstallExtra } from "@/lib/install-snippets";

const SECTIONS = [
  { id: "install", label: "Install" },
  { id: "load", label: "Load a study" },
  { id: "search", label: "Search" },
  { id: "singlet-file", label: "What's in a .singlet file" },
  { id: "partial-download", label: "Download just part of a study" },
  { id: "bulk-manifests", label: "Bulk downloads and manifests" },
  { id: "provenance", label: "Provenance and versioning" },
  { id: "comparison", label: "How singlet compares" },
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
              <CodeBlock label="bash" code={pyInstallExtra("torch")} />
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

            {/* ── Download just part of a study ── */}
            <Section id="partial-download" title="Download just part of a study">
              <p>
                A <Mono>.singlet</Mono> file is a ZIP64 archive, so you don't have to fetch the whole thing to see
                what's inside or to pull out one sample. <Mono>GET /api/bundle/:gse/index</Mono> lists every member —
                per-sample files, compressed and uncompressed size — without downloading anything:
              </p>
              <CodeBlock
                label="bash"
                code={`curl "https://singlet.bio/api/bundle/GSE178957/index"`}
              />
              <p>
                Per-sample QC (mapping rate, cells called, median genes/UMIs, mitochondrial fraction) computed straight
                from the file is at <Mono>GET /api/bundle/:gse/samples</Mono>:
              </p>
              <CodeBlock
                label="bash"
                code={`curl "https://singlet.bio/api/bundle/GSE178957/samples"`}
              />
              <p>
                <Mono>GET /api/bundle/:gse/entry?path=…</Mono> returns one member. Small entries come back inflated
                directly. Large entries (most count matrices) come back as a small JSON recipe — a byte range on{" "}
                <Mono>data.singlet.bio</Mono> plus how to inflate it — instead of the file itself, so you only ever
                transfer the bytes you asked for:
              </p>
              <CodeBlock
                label="json"
                code={`{
  "gse_id": "GSE178957",
  "path": "samples/GSM5426415/exon_counts.1pz",
  "url": "https://data.singlet.bio/data/GSE178957/GSE178957.singlet",
  "range": "bytes=10485760-20971519",
  "method": "deflate-raw",
  "how": "curl -r 10485760-20971519 \"https://data.singlet.bio/data/GSE178957/GSE178957.singlet\" | python -c \"import sys,zlib; sys.stdout.buffer.write(zlib.decompress(sys.stdin.buffer.read(), -15))\" > exon_counts.1pz"
}`}
              />
              <p>The <Mono>how</Mono> field is a ready-to-run command; the same pattern in one line:</p>
              <CodeBlock
                label="bash"
                code={`curl -r 10485760-20971519 "https://data.singlet.bio/data/GSE178957/GSE178957.singlet" \
  | python -c "import sys,zlib; sys.stdout.buffer.write(zlib.decompress(sys.stdin.buffer.read(), -15))" \
  > exon_counts.1pz`}
              />
              <p className="text-sm text-muted-foreground">
                Entries stored without compression report <Mono>"method": "stored"</Mono>; in that case the ranged{" "}
                <Mono>curl</Mono> line is already the finished file, no inflate step needed. This is the same mechanism{" "}
                <Mono>singlet.load(gse, samples=[...])</Mono> will use under the hood; the HTTP endpoints above are the
                same thing exposed directly, for use from any language.
              </p>
            </Section>

            {/* ── Bulk downloads and manifests ── */}
            <Section id="bulk-manifests" title="Bulk downloads and manifests">
              <p>
                <Mono>GET /api/manifest</Mono> takes the same filters as <Mono>/api/search</Mono> (organism,
                tissue_group, disease_group, assay_family, cell_type, q, min_cells, year_min/max, has_bundle) and
                returns every matching study — up to 2,000 — as a manifest or a ready-to-run download script, chosen
                with <Mono>format=</Mono>:
              </p>
              <table>
                <thead>
                  <tr>
                    <th>format</th>
                    <th>What you get</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Mono>tsv</Mono> (default)</td>
                    <td>One row per study: accession, title, organism, tissue/disease/assay groups, cell and sample counts, reference build, size, download URL.</td>
                  </tr>
                  <tr>
                    <td><Mono>json</Mono></td>
                    <td>The same rows as structured JSON, plus the total match count and the filters that were applied.</td>
                  </tr>
                  <tr>
                    <td><Mono>curl</Mono> / <Mono>wget</Mono></td>
                    <td>A shell script / URL list that downloads every matching <Mono>.singlet</Mono> file.</td>
                  </tr>
                  <tr>
                    <td><Mono>python</Mono> / <Mono>r</Mono></td>
                    <td>A script that loads every matching study with <Mono>singlet.load()</Mono> / <Mono>load()</Mono>.</td>
                  </tr>
                </tbody>
              </table>
              <div className="grid md:grid-cols-2 gap-3">
                <CodeBlock
                  label="bash — download everything matching a search"
                  code={`curl -L "https://singlet.bio/api/manifest?organism=Homo+sapiens&tissue_group=Brain+%2F+CNS&format=curl" \
  -o get-studies.sh
bash get-studies.sh`}
                />
                <CodeBlock
                  label="python — load everything matching a search"
                  code={`curl -L "https://singlet.bio/api/manifest?disease_group=COVID-19&format=python" -o load_studies.py
python load_studies.py`}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Manifests are capped at 2,000 studies per request; the JSON response's <Mono>total</Mono> field tells
                you if a search matched more than that, so you can narrow the filters. All rows are CC0.
              </p>
            </Section>

            {/* ── Provenance and versioning ── */}
            <Section id="provenance" title="Provenance and versioning">
              <p>
                Every study records which reference it was mapped to and which pipeline release produced it, so a
                number from the atlas is always traceable back to how it was made:
              </p>
              <ul>
                <li><Mono>reference_build</Mono> — the genome build and annotation the sample was mapped to (see <Link to="/about#references">About the data</Link> for the exact builds per organism). Recorded per cell in <Mono>obs["reference_build"]</Mono> and in <Mono>feature_vocab.json</Mono> inside the bundle.</li>
                <li><Mono>singlet_version</Mono> — the pipeline release that produced the bundle, in the file's <Mono>manifest.json</Mono>, the study page and <Mono>/api/gse/:id</Mono>.</li>
                <li><Mono>packed_at</Mono> — when the <Mono>.singlet</Mono> file was published, also in the manifest and on the study page.</li>
              </ul>
              <p>
                "Uniform reprocessing" means every sample of an organism — regardless of which lab produced it or which
                GEO series it came from — goes through the same reference, the same pipeline version and the same QC
                thresholds (see <Link to="/about#processing">What a study goes through</Link>). That is what makes a
                gene count from one study comparable to a gene count from another. The atlas data is <Mono>CC0</Mono>{" "}
                (public domain, no attribution required); the pipeline and packages are <Mono>MIT</Mono> licensed.
                Details on the <Link to="/data-license">license page</Link>.
              </p>
            </Section>

            {/* ── How singlet compares ── */}
            <Section id="comparison" title="How singlet compares">
              <p>
                An honest comparison against the two other ways to get this data. Only claims we can support are
                listed; "depends" means it genuinely varies by study or by your setup.
              </p>
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>singlet atlas</th>
                    <th>Download raw GEO/SRA yourself</th>
                    <th>Re-run a pipeline yourself</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Format</td>
                    <td>One <Mono>.singlet</Mono> file per study; loads as AnnData or SingleCellExperiment in one line</td>
                    <td>Raw FASTQ/SRA plus whatever matrix the authors uploaded, if any — format varies per study</td>
                    <td>Whatever your pipeline emits</td>
                  </tr>
                  <tr>
                    <td>Uniformity across studies</td>
                    <td>Same reference build and pipeline version for every sample of an organism</td>
                    <td>None — each lab used its own protocol, reference and pipeline version</td>
                    <td>Uniform across studies you process yourself, with the version you chose</td>
                  </tr>
                  <tr>
                    <td>Time to first matrix</td>
                    <td>Seconds to minutes — download or stream the published file</td>
                    <td>Minutes to hours to fetch raw reads, then you still need to align and count them</td>
                    <td>Hours to days per study (alignment + counting), plus pipeline setup</td>
                  </tr>
                  <tr>
                    <td>Compute needed</td>
                    <td>None — the counting already happened</td>
                    <td>None to download; substantial to process afterwards</td>
                    <td>A read aligner, a reference index and enough CPU/RAM per sample</td>
                  </tr>
                  <tr>
                    <td>Cost</td>
                    <td>Free, no account</td>
                    <td>Free (GEO/SRA are public); your own bandwidth and storage</td>
                    <td>Free software; your own compute cost</td>
                  </tr>
                  <tr>
                    <td>Control over parameters</td>
                    <td>None — fixed pipeline, documented in <Link to="/about">About the data</Link></td>
                    <td>Full — you choose everything downstream</td>
                    <td>Full — your reference, your parameters, your pipeline version</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-sm text-muted-foreground">
                Reprocessing from raw reads is the only way to get output identical to the atlas's; a matrix a study's
                original authors uploaded to GEO may already exist and load faster, but it was very likely produced
                with different parameters or a different reference, so it isn't directly comparable to another study's.
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
              <p className="text-sm text-muted-foreground">
                <code className="code-inline">find()</code> works without a key at the 10/day anonymous client limit; a key raises the limit to your account allowance (200/day).
              </p>
              <div className="grid md:grid-cols-2 gap-3 mt-3">
                <CodeBlock
                  label="python"
                  code={`import singlet
singlet.set_api_key("${KEY_PLACEHOLDER}")
# or: export SINGLET_API_KEY=${KEY_PLACEHOLDER}

accs = singlet.find("microglia in the aging mouse brain")`}
                />
                <CodeBlock
                  label="r"
                  code={`set_api_key("${KEY_PLACEHOLDER}")
# or: Sys.setenv(SINGLET_API_KEY = "${KEY_PLACEHOLDER}")

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
                The package also ships a local stdio server (<Mono>{pyInstallExtra("mcp")}</Mono>, then{" "}
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
singlet-process --reads reads_1.fastq.gz reads_2.fastq.gz --output-dir ./out --organism mouse`}
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
