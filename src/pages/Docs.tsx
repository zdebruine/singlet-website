import { createContext, useContext, useEffect } from "react";
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
  { id: "singlet-file", label: "Modalities and files" },
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
type SectionId = (typeof SECTIONS)[number]["id"];

/** Anchors inside a section, mapped to the section that holds them. */
const SUB_ANCHORS: Record<string, SectionId> = { modalities: "singlet-file", croissant: "bulk-manifests" };

/**
 * One section at a time: the URL hash picks it (default: Install). A hash that names an anchor inside a
 * section opens that section and scrolls to the anchor.
 */
function useSelectedSection(): SectionId {
  const { hash } = useLocation();
  const raw = decodeURIComponent(hash.slice(1));
  const ids = SECTIONS.map((x) => x.id) as readonly string[];
  const sel = (ids.includes(raw) ? raw : SUB_ANCHORS[raw] ?? "install") as SectionId;
  useEffect(() => {
    const t = setTimeout(() => {
      const target = raw && raw !== sel ? document.getElementById(raw) : null;
      if (target) target.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: 0 });
    }, 40);
    return () => clearTimeout(t);
  }, [raw, sel]);
  return sel;
}

const SelectedSection = createContext<SectionId>("install");

/**
 * What Research Alpha serves for each sample, with the name the loaders read it by. Only these: the private layers (genotype,
 * mtDNA alleles) and the unreliable ones (ambient RNA, doublets, per-cell non-host calls, the legacy 0/1 PSI) are not written to the
 * .s1 objects. The labels' accuracy is Singlet-Bio/singlet docs/cell_annotation.md.
 */
const MODALITIES: [string, string, string][] = [
  ["Gene counts: spliced + unspliced, and each as a layer", "counts, spliced, unspliced", "Default of load()"],
  ["Splice junctions", "splice_junctions", "Reads per junction and cell"],
  ["Exon inclusion (percent spliced in)", "psi", "Computed from the junctions when read"],
  ["Cell calls and per-cell QC", "cells table", "Called (knee filter), UMIs and genes, exon and intron"],
  ["Per-sample QC and provenance", "manifest", "Reads used and available, strand fraction, library type, release policy"],
  ["Cell type (Cell Ontology, with every level of the call)", "label sidecar, cell index", "Per-study accuracy by depth: compartment 0.84, lineage 0.75, cell type 0.43, subtype 0.32. The last two are previews"],
  ["Chromosomal sex (human, mouse)", "label sidecar, cell index", "XIST against chrY: 98.1% of samples agree with GEO (153 of 156 called)"],
  ["Genetic ancestry (human donors with enough covered sites)", "label sidecar, cell index", "Continental group (HANCESTRO) at q ≥ 0.8, else admixed. Validated on 1000 Genomes simulations and 22 self-reported donors (no call contradicted the report)"],
];

const Mono = ({ children }: { children: React.ReactNode }) => <code className="code-inline">{children}</code>;

const Docs = () => {
  usePageMeta({
    title: "Docs",
    description: "Install singlet, load a study as AnnData or SingleCellExperiment in one line, search the atlas and its cell labels, read the per-sample .s1 objects, and download just part of a study.",
    path: "/docs",
  });
  const active = useSelectedSection();
  const idx = SECTIONS.findIndex((x) => x.id === active);
  const prev = SECTIONS[idx - 1];
  const next = SECTIONS[idx + 1];

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
              <p className="text-[17px] text-muted-foreground">Reference for the packages, the file and the API. One topic at a time.</p>
              {/* Mobile TOC */}
              <ul className="lg:hidden mt-5 flex flex-wrap gap-2">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className={cn("chip", active === s.id && "chip-active")}>
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </header>
            <SelectedSection.Provider value={active}>

            {/* ── Install ── */}
            <Section id="install" title="Install">
              <p>
                Python 3.9 or newer, from PyPI. The wheels for Linux, macOS and Windows include the compiled codec, so no
                compiler is needed:
              </p>
              <CodeBlock label="bash" code={PY_INSTALL} />
              <p className="mt-4">
                R 4.2 or newer, from GitHub (the Bioconductor packages are needed for the default return type). It compiles
                a small C++17 extension against libzstd, so you need a C++ compiler and the zstd headers first:
              </p>
              <CodeBlock label="bash" code={BUILD_DEPS} />
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
                A sample accession works too: <Mono>singlet.load("{GSM}")</Mono> fetches only that sample's object.
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
                Every study is a set of immutable per-sample objects in the <Mono>.s1</Mono> format, one per sample at{" "}
                <Mono>https://data.singlet.bio/s1/s/&lt;GSM&gt;/&lt;digest&gt;.s1</Mono>, and a study manifest at{" "}
                <Mono>https://data.singlet.bio/s1/m/&lt;GSE&gt;.json</Mono> that lists every sample, member and byte range. The
                matrices inside use the pz2 codec (rANS-coded sparse chunks of cells, decodable one chunk at a time). An object never
                changes: its name carries its digest, so a byte range you read once stays valid. <Mono>GET /api/gse/:id</Mono> returns
                the manifest URL as <Mono>series.s1.manifest_url</Mono>.
              </p>
              <CodeBlock
                label="bash"
                code={`curl -s https://data.singlet.bio/s1/m/${GSE}.json | head -c 600   # the manifest: samples, keys, sizes, members`}
              />
              <div className="grid md:grid-cols-2 gap-3 mt-3">
                <CodeBlock
                  label="python"
                  code={`import singlet

study = singlet.open_study("${GSE}")       # reads only the manifest
adata = singlet.load("${GSM}")              # one sample: fetches only that object's members
sub   = singlet.cells("${GSE}", where="n_umi_exon > 5000")   # only those cells' chunks
adata = singlet.load("/data/${GSM}.s1")     # a downloaded object, read from disk`}
                />
                <CodeBlock
                  label="r"
                  code={`library(singlet)

st  <- singlet_study("${GSE}")              # the manifest
sce <- singlet::load("${GSM}")              # one sample
sub <- singlet_cells("${GSE}", where = "n_umi_exon > 5000")`}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Downloads need no account. To mirror a study, fetch the manifest and then each <Mono>key</Mono> it lists; the
                loaders read a local directory with the same layout (<Mono>SINGLET_DATA_BASE</Mono>).
              </p>
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
                filters it interpreted. Results are catalog metadata. Most questions are read by the built-in vocabulary
                (organisms, tissues, diseases, assays, cell types, cell counts, years) at no cost. Model readings are cached
                per question text and are not tied to you; the only thing kept per visitor is a daily count of AI requests.
              </p>
              <p>
                A question the vocabulary can't place costs a model call, so those are rate-limited:{" "}
                <strong>10 AI searches a day</strong> without an account (per network address) and{" "}
                <strong>200 a day</strong> signed in (free — Google or GitHub). Repeated questions come from cache and don't
                count. When the budget is spent the endpoint still answers, reading the question with the built-in vocabulary
                only, and sets <Mono>quota_exceeded: true</Mono>; accessions, filters
                in the rail and the catalog itself are never limited. Signed-in users can also ask for a one-sentence,
                metadata-grounded explanation of why each study matched (100 a day). From a script or an assistant, use
                an <a href="#api-keys">API key</a> to search under your own allowance.
              </p>
            </Section>

            {/* ── .s1 sample objects ── */}
            <Section id="singlet-file" title="What's in a .s1 sample">
              <p>
                A <Mono>.s1</Mono> object holds one sample's members end to end; the manifest gives each member's offset and length,
                so a loader reads only the members it needs with HTTP range requests. Count matrices are features × cells pz2 members
                that share side-information packs (gene names, barcode whitelists) published once at{" "}
                <Mono>s1/ref/&lt;id&gt;.pack</Mono> and listed in <Mono>s1/ref/index.json</Mono>. A member is stored, or rebuilt on read
                from a recipe over other members (a TSV from its table, PSI from the junctions).
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
                    <td><Mono>exon_counts.1pz</Mono>, <Mono>intron_counts.1pz</Mono></td>
                    <td>Features × cells, exonic and intronic UMIs. Summed per gene these are <Mono>layers["spliced"]</Mono> and <Mono>layers["unspliced"]</Mono>; <Mono>X</Mono> is their sum.</td>
                  </tr>
                  <tr>
                    <td><Mono>sj_counts.1pz</Mono></td>
                    <td>Splice junctions × cells, with a junction support flag.</td>
                  </tr>
                  <tr>
                    <td><Mono>cells</Mono></td>
                    <td>The per-cell table: barcode, whether it was called (the knee filter), UMIs and genes detected, exon and intron.</td>
                  </tr>
                  <tr>
                    <td><Mono>summary.json</Mono>, <Mono>pileup_stats.json</Mono>, <Mono>provenance.json</Mono></td>
                    <td>Per-sample QC and how the sample was made.</td>
                  </tr>
                </tbody>
              </table>
              <p>
                The study manifest also records per sample: reads used and available, strand fraction and library-type verdict, the
                release policy version, and the label sidecar. The labels are a separate public file per sample,{" "}
                <Mono>s1/a/&lt;GSM&gt;/&lt;digest&gt;.parquet</Mono> (named in <Mono>samples[i].annotations</Mono>), one row per called
                cell: <Mono>cell_type_cl</Mono>, <Mono>cell_type_label</Mono>, <Mono>cell_type_path</Mono> with a confidence per level,{" "}
                <Mono>sex_chrom</Mono> / <Mono>sex_score</Mono>, <Mono>ancestry_hancestro</Mono> / <Mono>ancestry_prob</Mono>, joined to
                the matrix by <Mono>col</Mono>. Raw genotype inputs are never written to a public file.
              </p>
              <h3 id="modalities" className="scroll-mt-24">What Alpha serves</h3>
              <p>
                <Mono>load()</Mono> returns the gene-level counts. Ask for other members by name with <Mono>modalities=</Mono>; the
                labels are read from the sidecar or across studies from the atlas cell index.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <CodeBlock
                  label="python"
                  code={`adata = singlet.load("${GSM}", modalities=["counts", "splice_junctions", "psi"])

import pandas as pd
study = singlet.open_study("${GSE}")
url = "https://data.singlet.bio/" + study.doc["samples"][0]["annotations"]["a2026-10"]["key"]
labels = pd.read_parquet(url)        # one row per called cell, joined on col`}
                />
                <CodeBlock
                  label="python — the atlas cell index"
                  code={`from singlet.s1 import atlas

n = atlas.count_cells(organism="Homo sapiens", cell_type="T cell", by=["sex"])
cells = atlas.find_cells(cell_type="CL:0000084", ancestry="European")`}
                />
              </div>
              <table>
                <thead>
                  <tr>
                    <th>What</th>
                    <th>Name</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {MODALITIES.map(([what, name, note]) => (
                    <tr key={what}>
                      <td>{what}</td>
                      <td><Mono>{name}</Mono></td>
                      <td>{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-sm text-muted-foreground">
                Cell type, sex and ancestry are searchable: <Mono>cell_type_label</Mono>, <Mono>sex_genetic</Mono> and{" "}
                <Mono>ancestry_genetic</Mono> filter <Mono>/api/search</Mono> and the MCP tools, and <Mono>find_cells</Mono> filters
                single cells by them. From an assistant, <Mono>get_modalities</Mono> lists what each sample holds.
              </p>
            </Section>

            {/* ── Download just part of a study ── */}
            <Section id="partial-download" title="Download just part of a study">
              <p>
                Every sample is its own object, so one sample is one download, and one member of it is one HTTP range. The Python and R
                loaders do this for you (<Mono>singlet.load("GSM…")</Mono>, <Mono>singlet.cells(…)</Mono>); the catalog endpoints below
                give the same ranges to any client.
              </p>
              <p>
                <Mono>GET /api/bundle/:gse/index</Mono> lists every sample object and its members (<Mono>format: "singlet-s1"</Mono>),
                and <Mono>GET /api/bundle/:gse/samples</Mono> the per-sample QC, without downloading anything:
              </p>
              <CodeBlock label="bash" code={`curl "https://singlet.bio/api/bundle/${GSE}/index"`} />
              <p>
                <Mono>GET /api/bundle/:gse/entry?path=samples/&lt;GSM&gt;/&lt;member&gt;</Mono> says where a member's bytes are inside its
                sample object: a URL, a byte range and the command to fetch it.
              </p>
              <CodeBlock label="bash" code={`curl "https://singlet.bio/api/bundle/${GSE}/entry?path=samples/${GSM}/exon_counts.1pz"`} />
              <p className="text-sm text-muted-foreground">
                From an assistant, <Mono>list_bundle_files</Mono> and <Mono>get_partial_download</Mono> return the same ranges;{" "}
                <Mono>find_cells</Mono> picks cells by their statistics or labels and <Mono>slice_cells</Mono> gives the ranges of just
                those cells' matrix chunks. Read a fetched member with <Mono>singlet.read_1pz()</Mono> in Python or{" "}
                <Mono>read_1pz()</Mono> in R.
              </p>
            </Section>

            {/* ── Bulk downloads and manifests ── */}
            <Section id="bulk-manifests" title="Bulk downloads and manifests">
              <p>
                <Mono>GET /api/manifest</Mono> takes the same filters as <Mono>/api/search</Mono> (organism,
                tissue_group, disease_group, assay_family, cell_type, q, min_cells, year_min/max, has_bundle) and
                returns every matching study — up to 2,000 — as a manifest or a ready-to-run download script, chosen
                with <Mono>format=</Mono>. Each row reports <Mono>n_samples_passing_qc</Mono> (<Link to="/about#qc">how QC works</Link>):
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
                    <td>A shell script / URL list that downloads every matching study (its manifest and sample objects).</td>
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
              <h3 id="croissant" className="scroll-mt-24">Croissant metadata</h3>
              <p>
                The atlas, every study and every sample are described in{" "}
                <a href="https://docs.mlcommons.org/croissant/" className="text-primary underline underline-offset-2">MLCommons Croissant 1.1</a>{" "}
                JSON-LD, with the Responsible AI fields (collection, preprocessing, annotation, biases, limitations, sensitive
                information, maintenance). The document's <Mono>version</Mono> is the Research Alpha release policy in force.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>What it describes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Mono>/croissant.json</Mono></td>
                    <td>The atlas: counts, release policy, and a <Mono>studies</Mono> record set (<Mono>/api/croissant/studies.csv</Mono>).</td>
                  </tr>
                  <tr>
                    <td><Mono>/api/croissant/&lt;GSE&gt;</Mono></td>
                    <td>One study: its sample objects and label sidecars, and the record sets <Mono>samples</Mono>, <Mono>cells</Mono>, <Mono>cell_qc</Mono>, <Mono>spliced_counts</Mono>, <Mono>unspliced_counts</Mono>, <Mono>features</Mono>.</td>
                  </tr>
                  <tr>
                    <td><Mono>/api/croissant/&lt;GSE&gt;/&lt;GSM&gt;</Mono></td>
                    <td>One sample, so the <Mono>cells</Mono> record set reads that sample's label sidecar alone.</td>
                  </tr>
                </tbody>
              </table>
              <CodeBlock
                label="python — read a study's samples and one sample's cells with mlcroissant"
                code={`# pip install "mlcroissant[parquet]"
import mlcroissant as mlc
samples = mlc.Dataset("https://singlet.bio/api/croissant/${GSE}").records("samples")
cells = mlc.Dataset("https://singlet.bio/api/croissant/${GSE}/${GSM}").records("cells")`}
              />
              <p className="text-sm text-muted-foreground">
                mlcroissant reads <Mono>samples</Mono>, <Mono>features</Mono> and a sample's <Mono>cells</Mono>; the count matrices and{" "}
                <Mono>cell_qc</Mono> are inside the <Mono>.s1</Mono> objects, so read those with <Mono>singlet.load()</Mono>.
              </p>
            </Section>

            {/* ── Provenance and versioning ── */}
            <Section id="provenance" title="Provenance and versioning">
              <p>
                Every study records which reference it was mapped to and which pipeline release produced it, so a
                number from the atlas is always traceable back to how it was made:
              </p>
              <ul>
                <li><Mono>reference_build</Mono> — the genome build and annotation the sample was mapped to (see <Link to="/about#references">About singlet</Link> for the exact builds per organism). Recorded per cell in <Mono>obs["reference_build"]</Mono> and in the study manifest.</li>
                <li><Mono>singlet_version</Mono> — the pipeline release that produced the counts, in the study manifest (<Mono>pipeline</Mono>), the study page and <Mono>/api/gse/:id</Mono>.</li>
                <li><Mono>created_at</Mono> — when the study's objects were written, in its manifest (returned as <Mono>created_at</Mono> by <Mono>/api/bundle/:gse/index</Mono> and as <Mono>packed_at</Mono> by <Mono>/api/gse/:id</Mono>), and shown as "Packed" on the study page. The manifest's <Mono>rev</Mono> changes whenever any sample object or study file does.</li>
              </ul>
              <p>
                The pipeline version is not the same for every file. Published files record <Mono>2.0.0</Mono> (about
                half), <Mono>1.0.0</Mono>, or no version at all (mostly mouse files, packed by a build that did not record it),
                and input was capped at 30,000,000 reads per sample (see{" "}
                <Link to="/about#processing">What a study goes through</Link>). Before merging studies, check that they
                share a reference build and pipeline version. The atlas data is <Mono>CC0</Mono>{" "}
                (public domain, no attribution required); the pipeline, packages and site code are <Mono>MIT</Mono> licensed.
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
                    <td>One <Mono>.s1</Mono> object per sample plus a study manifest; loads as AnnData or SingleCellExperiment in one line</td>
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
                    <td>None — fixed pipeline, documented in <Link to="/about">About singlet</Link></td>
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
                <Mono>singlet_study()</Mono> reads a study's manifest, <Mono>singlet_study_modalities()</Mono> says what each sample
                holds, and <Mono>singlet_cells()</Mono> fetches only the chunks of the cells you ask for. Matrices come back
                features × cells, the Bioconductor orientation. See <a href="#modalities" className="text-primary hover:underline">What Alpha serves</a>{" "}
                for the full list.
              </p>
              <CodeBlock
                label="r"
                code={`st <- singlet_study("${GSE}")
singlet_study_modalities(st)                  # what each sample has

sce <- singlet::load("${GSM}")                 # counts, spliced, unspliced
sub <- singlet_cells(st, where = "n_umi_exon > 5000", samples = "${GSM}")`}
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
                      <Mono>AnnData</Mono>. Accepts a GSE or GSM accession, a local <Mono>.s1</Mono> path, or a list
                      of these (concatenated with an outer join on genes). A GSM fetches only that sample's object;{" "}
                      <Mono>modalities=</Mono> picks members beyond the gene counts.
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
                    <td><Mono>singlet.open_study(gse)</Mono>, <Mono>singlet.cells(gse, where=…)</Mono></td>
                    <td>The study's manifest (nothing else is fetched); a cell-level slice that reads only the matrix chunks of the matching cells.</td>
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
                Loading and downloading data never needs a key. A key is for running natural-language searches from code
                under your own allowance (shared with the website), and for MCP clients that only take a header. Claude
                connects without one: add the MCP server as a connector and sign in.
              </p>
              <h3>Create a key</h3>
              <ol>
                <li>
                  <Link to="/account">Sign in</Link> (free — Google or GitHub) and open{" "}
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
                <code className="code-inline">find()</code> works without a key, but then reads every question with the built-in vocabulary only. With a key, a question that needs an AI reading uses your account's limits: 200 AI readings a day (reset at 00:00 UTC) and a monthly AI token allowance.
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
                hand back a download URL or a loader snippet. Tools need a free account. In Claude (web, Desktop, mobile):
                Settings → Connectors → Add custom connector → <Mono>{MCP_URL}</Mono>, then sign in with GitHub or
                Google; no key to copy. Other clients can send an API key in a header, as below. Only{" "}
                <Mono>search_datasets</Mono> calls a language model (to turn a plain-English question into filters the
                built-in vocabulary cannot read), so only those fresh AI readings use your AI allowance.
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
                The server has 17 tools: <Mono>search_datasets</Mono>, <Mono>get_study</Mono>,{" "}
                <Mono>get_download_url</Mono>, <Mono>get_atlas_stats</Mono>, <Mono>get_sample_qc</Mono>,{" "}
                <Mono>list_bundle_files</Mono>, <Mono>get_modalities</Mono>, <Mono>get_partial_download</Mono>,{" "}
                <Mono>export_manifest</Mono>, <Mono>find_matched_controls</Mono>, <Mono>compare_studies</Mono>,{" "}
                <Mono>assess_study</Mono>, <Mono>get_cohort</Mono>, <Mono>save_cohort</Mono>, and for studies stored
                per sample <Mono>find_cells</Mono>, <Mono>slice_cells</Mono> and <Mono>resolve_features</Mono>. Inputs, outputs and
                notes for each are in the <Link to="/docs/mcp#tools">tool reference</Link>. Every tool call needs sign-in or a key.
              </p>
              <p>
                Try it from a terminal (listing the tools needs no key; calling one does):
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
                <li>Build the C++ pipeline with CMake from the repository, following its README. You need a C++17 toolchain, zstd, STAR, and a STAR index for the reference you map to (see <Link to="/about#references">About singlet</Link> for the builds the atlas uses).</li>
                <li>Plan for alignment-scale compute: tens of GB of RAM for a human or mouse STAR index, and hours per sample on a workstation.</li>
                <li>The output directory holds the per-sample matrices listed under <a href="#singlet-file">What's in a .s1 sample</a>; <Mono>singlet.load_dir()</Mono> reads it as <Mono>AnnData</Mono>.</li>
                <li>To keep private results next to the public catalogue, pack them into a <Mono>.singlet</Mono> file and add it under <a href="#private-projects">Private projects</a>.</li>
                <li>Build steps, the CLI reference and known issues are on <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer">GitHub</a>; questions and bugs go to <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">GitHub Issues</a>.</li>
              </ul>
            </Section>
            </SelectedSection.Provider>
            <nav className="mt-12 pt-6 border-t border-border flex justify-between gap-4 text-[14px]" aria-label="Previous and next topic">
              {prev ? <a href={`#${prev.id}`} className="text-primary hover:underline">← {prev.label}</a> : <span />}
              {next ? <a href={`#${next.id}`} className="text-primary hover:underline">{next.label} →</a> : <span />}
            </nav>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
};

function Section({ id, title, children }: { id: SectionId; title: string; children: React.ReactNode }) {
  if (useContext(SelectedSection) !== id) return null;
  return (
    <section id={id} className="scroll-mt-20">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default Docs;
