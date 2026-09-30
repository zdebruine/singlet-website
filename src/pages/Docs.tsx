import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { Link, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cn } from "@/lib/utils";
import { BUILD_DEPS, EXAMPLE_GSE, GITHUB_ISSUES, GITHUB_REPO, PY_INSTALL, R_INSTALL_STANDALONE, pyInstallExtra } from "@/lib/install-snippets";

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
  { id: "private-projects", label: "Private projects & cohorts" },
  { id: "pipeline", label: "Run the pipeline (advanced)" },
] as const;

const MCP_URL = "https://singlet.bio/mcp";
const KEY_PLACEHOLDER = "sk_live_…";
/** Flagship example (8/8 usable samples, ~193 MB) and its first sample. */
const GSE = EXAMPLE_GSE;
const GSM = "GSM4120733";
/** Second study for the multi-study example (3 samples, ~51 MB). */
const GSE_2 = "GSE146974";
/** A bundle with donor/, mt/ and nonhost/ outputs, for the modality examples. */
const MODALITY_GSE = "GSE128639";
const MODALITY_GSM = "GSM3681519";

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
    description: "Install singlet, load a study as AnnData or SingleCellExperiment in one line, search the atlas, read every modality in a .singlet file, and download just part of a study.",
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
              <Logo variant="mark" height={28} link={false} className="docs-brand-mark mb-4" />
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
              <p>
                Both packages install from GitHub and compile a small C++17 extension against libzstd, so you need a C++
                compiler and the zstd headers first. (The name <Mono>singlet</Mono> on PyPI belongs to an unrelated
                package; install from GitHub as shown.)
              </p>
              <p>Python 3.9 or newer:</p>
              <CodeBlock label="bash" code={`${BUILD_DEPS}\n${PY_INSTALL}`} />
              <p className="mt-4">R 4.2 or newer (the Bioconductor packages are needed for the default return type):</p>
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
                    <td>PyTorch dataset / dataloader helpers. They load the whole study into memory first (no streaming).</td>
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

adata = singlet.load("${GSE}")   # AnnData
adata.obs[["gsm_id", "organism", "protocol"]].head()`}
                />
                <CodeBlock
                  label="r"
                  code={`library(singlet)

sce <- singlet::load("${GSE}")   # SingleCellExperiment
head(colData(sce)$gsm_id)`}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                In R, call <Mono>singlet::load()</Mono> and <Mono>singlet::find()</Mono> with the prefix: the package's{" "}
                <Mono>load()</Mono> and <Mono>find()</Mono> mask <Mono>base::load</Mono> and <Mono>utils::find</Mono>.
                In Python a sample accession works too: <Mono>singlet.load("{GSM}")</Mono> downloads the whole parent
                study, then keeps that sample's cells.
              </p>
              <h3>Several studies at once</h3>
              <p>
                Pass a list of accessions to get one combined object. The two packages combine differently: Python
                concatenates with an <strong>outer join</strong> (the union of genes; a gene missing from one study is
                zero there, and <Mono>obs["source"]</Mono> records which accession each cell came from), while R keeps
                only the <strong>genes shared</strong> by every study. Either way, <Mono>gsm_id</Mono> tells the samples
                apart. Check that the studies share a reference build and pipeline version before merging them.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <CodeBlock label="python" code={`adata = singlet.load(["${GSE}", "${GSE_2}"])`} />
                <CodeBlock label="r" code={`sce <- singlet::load(c("${GSE}", "${GSE_2}"))`} />
              </div>
              <h3>Files on disk</h3>
              <p>
                Every study is a single <Mono>.singlet</Mono> file at{" "}
                <Mono>https://data.singlet.bio/data/&lt;GSE&gt;/&lt;GSE&gt;.singlet</Mono>, from about 300 KB to over 20 GB
                (about 9 in 10 are under 1 GB). You can download it with curl and load the local path the same way. There are no per-sample
                files; filter on <Mono>obs["gsm_id"]</Mono> after loading, or see{" "}
                <a href="#partial-download">Download just part of a study</a>.
              </p>
              <CodeBlock
                label="bash"
                code={`curl -LO https://data.singlet.bio/data/${GSE}/${GSE}.singlet`}
              />
              <CodeBlock
                className="mt-3"
                label="python"
                code={`import singlet
adata = singlet.load("${GSE}.singlet")   # a local path loads the same way`}
              />
            </Section>

            {/* ── Search ── */}
            <Section id="search" title="Search">
              <p>
                The same search that powers <Link to="/browse">Browse</Link> is available in both packages. Plain English
                is interpreted into catalog filters (organism, tissue, cell type, disease, protocol); accessions and
                keywords are matched directly. <Mono>find</Mono> returns accessions, <Mono>find_load</Mono> loads them.
                Pass <Mono>level="gse"</Mono> in Python to get study accessions (its default is samples); R returns
                studies by default. Keep <Mono>limit</Mono> small with <Mono>find_load</Mono>: every match is a full
                study download.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <CodeBlock
                  label="python"
                  code={`accs = singlet.find("microglia in the aging mouse brain", level="gse")
adata = singlet.find_load("human PBMC, COVID-19, 10x 5'", level="gse", limit=2)`}
                />
                <CodeBlock
                  label="r"
                  code={`accs <- singlet::find("microglia in the aging mouse brain")
sce  <- singlet::find_load("human PBMC, COVID-19, 10x 5'", limit = 2)`}
                />
              </div>
              <p>
                To filter the live catalog yourself, read a manifest (see{" "}
                <a href="#bulk-manifests">Bulk downloads and manifests</a>) into a data frame:
              </p>
              <CodeBlock
                label="python"
                code={`import pandas as pd

url = "https://singlet.bio/api/manifest?organism=Mus+musculus&tissue_group=Brain+%2F+CNS&format=tsv"
studies = pd.read_csv(url, sep="\\t")`}
              />
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
                metadata files. The loaders read only the members they need. Per-sample members live under{" "}
                <Mono>samples/&lt;GSM&gt;/</Mono>; every <Mono>.1pz</Mono> matrix is stored features × cells.
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
                    <td>Features × cells, reads assigned to exons (per exon feature). Summed per gene this is <Mono>adata.layers["spliced"]</Mono>.</td>
                  </tr>
                  <tr>
                    <td><Mono>intron_counts.1pz</Mono></td>
                    <td>Features × cells, intronic reads (for RNA velocity or nuclear fraction). Summed per gene this is <Mono>adata.layers["unspliced"]</Mono>.</td>
                  </tr>
                  <tr>
                    <td><Mono>cell_calls.tsv</Mono></td>
                    <td>Which barcodes the pipeline called as cells, with their scores.</td>
                  </tr>
                  <tr>
                    <td><Mono>sj_counts.1pz</Mono></td>
                    <td>Splice junctions × cells.</td>
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
                    <td><Mono>mt_variants.tsv</Mono></td>
                    <td>Called chrM variants: depth, allele counts, annotation.</td>
                  </tr>
                  <tr>
                    <td><Mono>donor/donor_assignments.tsv</Mono></td>
                    <td>Genotype-free donor demultiplexing: barcode → donor, with doublet calls. Some bundles only.</td>
                  </tr>
                  <tr>
                    <td><Mono>nonhost/nonhost_em_abundance.tsv</Mono></td>
                    <td>Microbial and viral abundance per taxon. Some bundles only.</td>
                  </tr>
                  <tr>
                    <td><Mono>vdj_gene_usage.1pz</Mono></td>
                    <td>V(D)J gene usage per cell (when the library supports it).</td>
                  </tr>
                  <tr>
                    <td><Mono>summary.json</Mono>, <Mono>pileup_stats.json</Mono></td>
                    <td>Per-sample QC: cells called, mapping rate, median genes and UMIs.</td>
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
                    <td>Member list, sizes, checksums, pipeline version (<Mono>singlet_version</Mono>) and packing time (<Mono>created_at</Mono>).</td>
                  </tr>
                </tbody>
              </table>
              <h3 id="modalities" className="scroll-mt-24">Reading anything other than gene counts</h3>
              <p>
                <Mono>load()</Mono> returns the gene-level matrix. Everything else is addressable by name through the
                bundle API, which reads one member at a time from the downloaded file. The splicing, heteroplasmy and
                V(D)J matrices are in bundles from every pipeline version; the donor, non-host, allele-specific and
                per-cell annotation outputs are only in some bundles, so check rather than assume. The example below uses{" "}
                <Link to={`/study/${MODALITY_GSE}`}>{MODALITY_GSE}</Link>, which has them.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <CodeBlock
                  label="python"
                  code={`b = singlet.open_bundle("${MODALITY_GSE}")
gsm = "${MODALITY_GSM}"
b.modalities(gsm)                    # what this sample has

b.raw_counts(gsm)                    # exon + intron, spliced/unspliced layers
b.raw_counts(gsm, gene_level=False)  # native exon/intron feature axis
b.mt_variants(gsm)                   # heteroplasmy, cells x chrM sites
if b.has("donor_assignments", gsm):
    donors = b.donors(gsm)
if b.has("nonhost_species", gsm):
    taxa = b.nonhost(gsm)`}
                />
                <CodeBlock
                  label="r"
                  code={`path <- download("${MODALITY_GSE}")
gsm  <- "${MODALITY_GSM}"
singlet_modalities(path, gsm)

singlet_raw_counts(path, gsm)
singlet_raw_counts(path, gsm, gene_level = FALSE)
singlet_read(path, gsm, "mt_variants")
if (singlet_has(path, "donor_assignments", gsm))
  donors <- singlet_read(path, gsm, "donor_assignments")`}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                The full per-modality table, and how exon and intron features are merged onto genes, is on{" "}
                <Link to="/quickstart#modalities">Getting started</Link>. From an assistant, the{" "}
                <Mono>get_modalities</Mono> MCP tool answers the same question and returns the Python and R line for
                each one.
              </p>
            </Section>

            {/* ── Download just part of a study ── */}
            <Section id="partial-download" title="Download just part of a study">
              <p>
                A <Mono>.singlet</Mono> file is a ZIP64 archive, so you don't have to fetch the whole thing to see
                what's inside or to pull out one sample. This is an HTTP API (and MCP) feature: the Python and R packages
                always download the whole study file, including for <Mono>singlet.load("GSM…")</Mono>.
              </p>
              <p>
                <Mono>GET /api/bundle/:gse/index</Mono> lists every member — per-sample files, compressed and
                uncompressed size — without downloading anything:
              </p>
              <CodeBlock
                label="bash"
                code={`curl "https://singlet.bio/api/bundle/${GSE}/index"`}
              />
              <p>
                Per-sample QC (mapping rate, cells called, median genes and UMIs, input reads) read straight from the file
                is at <Mono>GET /api/bundle/:gse/samples</Mono>:
              </p>
              <CodeBlock
                label="bash"
                code={`curl "https://singlet.bio/api/bundle/${GSE}/samples"`}
              />
              <p>
                <Mono>GET /api/bundle/:gse/entry?path=…</Mono> returns one member. Entries up to 4 MB come back
                directly. Larger ones (most count matrices) come back as a small JSON recipe — a byte range on{" "}
                <Mono>data.singlet.bio</Mono> plus a ready-to-run command — instead of the file itself, so you only ever
                transfer the bytes you asked for:
              </p>
              <CodeBlock
                label="bash"
                code={`curl "https://singlet.bio/api/bundle/${GSE}/entry?path=samples/${GSM}/exon_counts.1pz"`}
              />
              <CodeBlock
                className="mt-3"
                label="json"
                code={`{
  "gse_id": "${GSE}",
  "path": "samples/${GSM}/exon_counts.1pz",
  "url": "https://data.singlet.bio/data/${GSE}/${GSE}.singlet",
  "range": "bytes=293772-10257905",
  "method": "stored",
  "bytes_compressed": 9964134,
  "bytes_uncompressed": 9964134,
  "how": "curl -r 293772-10257905 \\"https://data.singlet.bio/data/${GSE}/${GSE}.singlet\\" -o exon_counts.1pz"
}`}
              />
              <p>The <Mono>how</Mono> field is the command to run — about 10 MB instead of the 193 MB study:</p>
              <CodeBlock
                label="bash"
                code={`curl -r 293772-10257905 "https://data.singlet.bio/data/${GSE}/${GSE}.singlet" -o exon_counts.1pz`}
              />
              <p className="text-sm text-muted-foreground">
                <Mono>.1pz</Mono> matrices are added to the archive without ZIP compression (they are already
                zstd-compressed), so they report <Mono>"method": "stored"</Mono> and the ranged download is the finished
                file, features × cells. Read it with <Mono>singlet.read_1pz()</Mono> in Python or <Mono>read_1pz()</Mono>{" "}
                in R. Only large JSON or TSV members can report <Mono>"method": "deflate-raw"</Mono>; for those the{" "}
                <Mono>how</Mono> command pipes the range through a raw-inflate step. From an assistant,{" "}
                <Mono>get_partial_download</Mono> returns the same recipe.
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
                    <td>A script that loads every matching study with <Mono>singlet.load()</Mono> / <Mono>singlet::load()</Mono>.</td>
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
                <li><Mono>created_at</Mono> — when the <Mono>.singlet</Mono> file was packed, in the file's <Mono>manifest.json</Mono> (returned as <Mono>created_at</Mono> by <Mono>/api/bundle/:gse/index</Mono> and as <Mono>packed_at</Mono> by <Mono>/api/gse/:id</Mono>), and shown as "Packed" on the study page.</li>
              </ul>
              <p>
                The pipeline version is not the same for every file. Published files record <Mono>2.0.0</Mono> (most),{" "}
                <Mono>1.0.0</Mono>, or no version at all (a group of mouse files packed before the version was recorded),
                and input was capped at 30,000,000 reads per sample (see{" "}
                <Link to="/about#processing">What a study goes through</Link>). Before merging studies, check that they
                share a reference build and pipeline version. The atlas data is <Mono>CC0</Mono>{" "}
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
                    <td>One reference build per organism; most files from pipeline 2.0.0, the rest from 1.0.0 or unrecorded — each file records which</td>
                    <td>None — each lab used its own protocol, reference and pipeline version</td>
                    <td>Uniform across studies you process yourself, with the version you chose</td>
                  </tr>
                  <tr>
                    <td>Time to first matrix</td>
                    <td>Seconds to minutes — download the published file</td>
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
                <Mono>singlet::load()</Mono> returns a <Mono>SingleCellExperiment</Mono> by default. Pass{" "}
                <Mono>as = "seurat"</Mono> for a Seurat object. Use the <Mono>singlet::</Mono> prefix for{" "}
                <Mono>load()</Mono> and <Mono>find()</Mono>: attaching the package masks <Mono>base::load</Mono> and{" "}
                <Mono>utils::find</Mono>.
              </p>
              <CodeBlock
                label="r"
                code={`library(singlet)

sce <- singlet::load("${GSE}")                 # SingleCellExperiment
seu <- singlet::load("${GSE}", as = "seurat")  # Seurat

accs <- singlet::find("tumor-infiltrating T cells in melanoma")
sce  <- singlet::find_load("mouse embryo development", limit = 2)`}
              />
              <h3>Required and optional packages</h3>
              <ul>
                <li>
                  <Mono>SingleCellExperiment</Mono>, <Mono>SummarizedExperiment</Mono> and <Mono>S4Vectors</Mono> are
                  needed for the default return type. The install snippet under <a href="#install">Install</a> adds them
                  from Bioconductor; on their own:
                </li>
              </ul>
              <CodeBlock
                label="r"
                code={`if (!requireNamespace("BiocManager", quietly = TRUE)) install.packages("BiocManager")
BiocManager::install(c("SingleCellExperiment", "SummarizedExperiment", "S4Vectors"))`}
              />
              <ul className="mt-4">
                <li>
                  <Mono>Seurat</Mono> is only needed when you call <Mono>singlet::load(…, as = "seurat")</Mono>.
                </li>
                <li>
                  The base package itself depends only on <Mono>Rcpp</Mono>, <Mono>Matrix</Mono> and <Mono>jsonlite</Mono>
                  (plus a C++17 compiler and libzstd to build); the lower-level readers (<Mono>read_1pz()</Mono>,{" "}
                  <Mono>read_singlet()</Mono>) work with sparse <Mono>Matrix</Mono> objects.
                </li>
              </ul>
              <h3>Beyond gene counts</h3>
              <p>
                <Mono>download()</Mono> fetches a study's bundle without reading it (pass a GSE accession), and the{" "}
                <Mono>singlet_*</Mono> readers reach every other per-sample output. Matrices come back features × cells,
                the Bioconductor orientation. See <a href="#modalities" className="text-primary hover:underline">Modalities</a>{" "}
                for the full list.
              </p>
              <CodeBlock
                label="r"
                code={`path <- download("${MODALITY_GSE}")
gsm  <- "${MODALITY_GSM}"
singlet_modalities(path, gsm)                 # what this sample has

sce <- singlet_raw_counts(path, gsm)          # counts, spliced, unspliced
singlet_read(path, gsm, "mt_heteroplasmy")
if (singlet_has(path, "nonhost_species", gsm))
  taxa <- singlet_read(path, gsm, "nonhost_species")`}
              />
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
                      <Mono>AnnData</Mono>. Accepts a GSE or GSM accession, a local <Mono>.singlet</Mono> path, or a list
                      of these (concatenated with an outer join on genes). A GSM downloads the whole parent study, then
                      keeps that sample's cells.
                    </td>
                  </tr>
                  <tr>
                    <td><Mono>singlet.find(query, level="gse")</Mono></td>
                    <td>List of accessions matching a plain-English or keyword query. The default level is samples (GSM); pass <Mono>level="gse"</Mono> for studies.</td>
                  </tr>
                  <tr>
                    <td><Mono>singlet.find_load(query, level="gse", limit=…)</Mono></td>
                    <td><Mono>find</Mono> followed by <Mono>load</Mono>, as one <Mono>AnnData</Mono>. Each match is a full study download.</td>
                  </tr>
                  <tr>
                    <td><Mono>singlet.download(acc)</Mono></td>
                    <td>Downloads a study's <Mono>.singlet</Mono> file to the cache and returns its path, without reading it.</td>
                  </tr>
                  <tr>
                    <td><Mono>singlet.open_bundle(acc_or_path)</Mono></td>
                    <td>
                      A <Mono>SingletBundle</Mono> — the handle for everything that isn't gene counts. See{" "}
                      <a href="#modalities" className="text-primary hover:underline">Modalities</a>.
                    </td>
                  </tr>
                  <tr>
                    <td><Mono>singlet.read_1pz(path)</Mono></td>
                    <td>One <Mono>.1pz</Mono> matrix (for example from a <a href="#partial-download">partial download</a>) as <Mono>AnnData</Mono>, cells × features.</td>
                  </tr>
                </tbody>
              </table>
              <h3>What you get back</h3>
              <ul>
                <li><Mono>adata.X</Mono> — raw UMI counts, cells × genes, sparse CSR. Exonic + intronic, with the two halves kept in <Mono>adata.layers["spliced"]</Mono> and <Mono>adata.layers["unspliced"]</Mono>.</li>
                <li><Mono>adata.obs</Mono> — <Mono>gsm_id</Mono>, <Mono>organism</Mono>, <Mono>protocol</Mono>, <Mono>protocol_name</Mono>, <Mono>sample_source</Mono>, <Mono>sample_characteristics</Mono> (the GEO characteristics string), <Mono>reference_build</Mono>, <Mono>n_cells_sample</Mono>.</li>
                <li><Mono>adata.var</Mono> — indexed by <Mono>gene_id</Mono>, with <Mono>gene_name</Mono> from the reference annotation.</li>
                <li><Mono>adata.uns["study_meta"]</Mono> and <Mono>adata.uns["manifest"]</Mono> — the study's GEO metadata and the bundle manifest (pipeline version, checksums).</li>
              </ul>
              <CodeBlock
                label="python"
                code={`import singlet, scanpy as sc

adata = singlet.load("${GSE}")
sc.pp.filter_cells(adata, min_genes=200)
sc.pp.normalize_total(adata); sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata, batch_key="gsm_id")`}
              />
              <h3>PyTorch</h3>
              <p>
                The <Mono>[torch]</Mono> extra adds <Mono>singlet.torch.SingletDataset</Mono> and a{" "}
                <Mono>DataLoader</Mono> wrapper that yield sparse tensors. They load each whole study into memory first;
                there is no streaming from disk, so size your machine for the studies you train on. See the package
                README for the current API.
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
                It is accepted by <Mono>/api/nl-search</Mono>, <Mono>/api/search</Mono>, <Mono>/api/facets</Mono>,{" "}
                <Mono>/api/manifest</Mono>, <Mono>/api/stats</Mono> and <Mono>/api/gse/:id</Mono>; AI-interpreted searches
                count against the owner's allowance and an invalid, expired or revoked key is answered with{" "}
                <Mono>401</Mono>.
              </p>
              <CodeBlock
                label="bash"
                code={`curl -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  "https://singlet.bio/api/nl-search?q=microglia+in+the+aging+mouse+brain"`}
              />
              <h3>In the packages</h3>
              <p className="text-sm text-muted-foreground">
                <code className="code-inline">find()</code> works without a key at the 10/day anonymous client limit; a key raises the limit to your account allowance (200/day).
                The key is only sent with searches; loading and downloading never use it.
              </p>
              <div className="grid md:grid-cols-2 gap-3 mt-3">
                <CodeBlock
                  label="python"
                  code={`import singlet
singlet.set_api_key("${KEY_PLACEHOLDER}")
# or set the SINGLET_API_KEY environment variable

accs = singlet.find("microglia in the aging mouse brain", level="gse")`}
                />
                <CodeBlock
                  label="r"
                  code={`library(singlet)
singlet::set_api_key("${KEY_PLACEHOLDER}")
# or: Sys.setenv(SINGLET_API_KEY = "${KEY_PLACEHOLDER}")

accs <- singlet::find("microglia in the aging mouse brain")`}
                />
              </div>

              <h3>MCP server</h3>
              <p>
                Full guide with example prompts, per-editor setup and the tool reference:{" "}
                <Link to="/docs/mcp">Use singlet from Claude, Cursor or ChatGPT</Link>.
              </p>
              <p>
                <Mono>{MCP_URL}</Mono> is a hosted Model Context Protocol server (Streamable HTTP, stateless) that lets an
                assistant — Claude Desktop, Claude Code, Cursor, VS Code — search the atlas, read a study's metadata and
                hand back a download URL or a loader snippet. It works without a key. Only <Mono>search_datasets</Mono>{" "}
                calls a language model (to turn a plain-English question into filters), so only it is metered: 10 a day
                anonymously, 200 with a key. <Mono>save_cohort</Mono> needs a key, and so does <Mono>get_cohort</Mono>{" "}
                for a private cohort (a share-link token opens a link-shared one).
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
              <p>
                The server has 14 tools: <Mono>search_datasets</Mono>, <Mono>get_study</Mono>,{" "}
                <Mono>get_download_url</Mono>, <Mono>get_atlas_stats</Mono>, <Mono>get_sample_qc</Mono>,{" "}
                <Mono>list_bundle_files</Mono>, <Mono>get_modalities</Mono>, <Mono>get_partial_download</Mono>,{" "}
                <Mono>export_manifest</Mono>, <Mono>find_matched_controls</Mono>, <Mono>compare_studies</Mono>,{" "}
                <Mono>assess_study</Mono>, <Mono>get_cohort</Mono> and <Mono>save_cohort</Mono>. Inputs, outputs and
                key requirements for each are in the <Link to="/docs/mcp#tools">tool reference</Link>.
              </p>
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

            <Section id="private-projects" title="Private projects, cohorts and workspaces">
              <p>
                Signed-in researchers can put their own <Mono>.singlet</Mono> files beside the public catalogue without
                publishing them. Open <Link to="/my-data">Your data</Link>, create a project, then upload a file or register
                a public HTTPS URL. singlet validates the bundle and indexes its study metadata and per-sample QC.
              </p>
              <ul>
                <li>Preview limits are enforced in code: 5 projects per account, 20 files per project, 2 GB per file, and 10 GB stored per account.</li>
                <li>Uploaded files use resumable 50 MB parts. Registered URLs are read with HTTP ranges and do not use your storage allowance.</li>
                <li>Private studies appear under <strong>Mine</strong> in Browse. A project read token lets a script download a private file without your account session. The Python and R packages cannot open a private file by token directly: download it with the token first, then load the local path.</li>
                <li>Select public studies in Browse and choose <strong>Save cohort</strong> to pin the selection to catalogue version <Mono>2026.09</Mono>. Cohorts can be private, shared by link, or attached to a workspace (up to 50 cohorts per account).</li>
                <li>Workspaces support owner/member collaboration, invite links, comments and activity, up to 10 members per workspace and 3 workspaces per user.</li>
              </ul>
              <p className="text-sm text-muted-foreground">These features are included with a free account.</p>
            </Section>

            {/* ── BYOD / pipeline ── */}
            <Section id="pipeline" title="Run the pipeline yourself (advanced)">
              <p>
                <strong>Advanced.</strong> The atlas was produced with the open-source C++ pipeline in the{" "}
                <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer">singlet repository</a> (STAR alignment,
                then per-cell exon/intron pileup written as <Mono>.1pz</Mono> matrices). Running it on your own reads is
                possible, but it is not part of the Python or R install: you build the pipeline from source and supply
                the reference indexes yourself.
              </p>
              <ul>
                <li>Build the C++ pipeline with CMake from the repository, following its README. You need a C++17 toolchain, zstd, STAR, and a STAR index for the reference you map to (see <Link to="/about#references">About the data</Link> for the builds the atlas uses).</li>
                <li>Plan for alignment-scale compute: tens of GB of RAM for a human or mouse STAR index, and hours per sample on a workstation.</li>
                <li>The output directory holds the same per-sample matrices listed under <a href="#singlet-file">What's in a .singlet file</a>; <Mono>singlet.load_dir()</Mono> reads it as <Mono>AnnData</Mono>.</li>
                <li>To keep private results next to the public catalogue, pack them into a <Mono>.singlet</Mono> file and add it under <a href="#private-projects">Private projects</a>.</li>
                <li>Build steps, the CLI reference and known issues are on <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer">GitHub</a>; questions and bugs go to <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">GitHub Issues</a>.</li>
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
