import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { apiClient } from "@/integrations/api/client";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fmtCompact, fmtInt } from "@/lib/catalog-display";
import { cn } from "@/lib/utils";
import { Railway, Station } from "@/components/about/Railway";
import { FormatSizeChart, H5AD_RATIO, HBars, StackedBar } from "@/components/landing/charts";
import { EXAMPLE_GSE } from "@/lib/install-snippets";

// About singlet: the journey of a sample, one station per claim, each with a visual, a "read more" and a docs link.

const Mono = ({ children }: { children: ReactNode }) => <code className="code-inline">{children}</code>;

function Caption({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-[12.5px] font-medium text-muted-foreground uppercase tracking-wider">{children}</p>;
}

function Loading() {
  return <div className="h-40 rounded bg-secondary animate-pulse" aria-hidden="true" />;
}

const REFERENCES = [
  ["Human", "GRCh38 (2024-A)", "GENCODE v44"],
  ["Mouse", "GRCm39 (2024-A)", "GENCODE vM33"],
  ["Rat", "mRatBN7.2", "Ensembl 110"],
  ["Rhesus macaque", "Mmul_10", "Ensembl"],
  ["Human + mouse", "GRCh38-GRCm39", "both"],
];

/** A real reading of a real query by /api/nl-search (vocabulary only, no model needed). */
const NL_EXAMPLE = {
  q: "microglia in the aging mouse brain",
  parts: [
    { word: "microglia", field: "cell type", value: "microglia" },
    { word: "aging", field: "keyword", value: "aging" },
    { word: "mouse", field: "organism", value: "Mus musculus" },
    { word: "brain", field: "tissue", value: "Brain / CNS" },
  ],
};

function SearchDiagram() {
  return (
    <div>
      <Caption>How a question becomes filters</Caption>
      <div className="rounded-full border border-border bg-background px-4 py-2.5 text-[14px]">
        {NL_EXAMPLE.q.split(" ").map((w, i) => {
          const hit = NL_EXAMPLE.parts.find((p) => p.word === w);
          return (
            <span key={i} className={cn(hit && "font-semibold text-primary")}>
              {w}{" "}
            </span>
          );
        })}
      </div>
      <div className="my-3 flex justify-center text-muted-foreground" aria-hidden="true">
        ↓
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {NL_EXAMPLE.parts.map((p) => (
          <li key={p.field} className="rounded border border-border px-3 py-2">
            <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">{p.field}</span>
            <span className="text-[14px] font-medium">{p.value}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="rounded bg-[var(--teal-50)] px-2 py-1 text-foreground">vocabulary</span>
        <ArrowRight size={13} aria-hidden="true" />
        <span className="rounded border border-dashed border-border px-2 py-1">model, only for words it cannot place</span>
      </div>
    </div>
  );
}

function ToolsVisual() {
  return (
    <div className="space-y-2">
      <Caption>Same study, three ways</Caption>
      <CodeBlock label="python" code={`adata = singlet.load("${EXAMPLE_GSE}")`} compact />
      <CodeBlock label="r" code={`sce <- singlet::load("${EXAMPLE_GSE}")`} compact />
      <CodeBlock label="claude" code={`"Load ${EXAMPLE_GSE} and plot cells per sample."`} compact wrap />
    </div>
  );
}

function Fold({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const { hash } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (decodeURIComponent(hash.slice(1)) === id) setOpen(true);
  }, [hash, id]);
  return (
    <section id={id} className="border-t border-border scroll-mt-20">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center gap-2 py-4 text-left">
        <ChevronRight size={16} className={cn("text-primary transition-transform", open && "rotate-90")} aria-hidden="true" />
        <h2 className="text-[17px] font-semibold">{title}</h2>
      </button>
      {open && <div className="pb-6 pl-6 text-[14.5px] leading-relaxed space-y-3 max-w-[760px]">{children}</div>}
    </section>
  );
}

const About = () => {
  usePageMeta({
    title: "About singlet",
    description: "Every study on singlet.bio is reprocessed from raw reads. Follow a sample from GEO to your notebook: protocol detection, alignment, extra layers, QC, one file per study and plain-English search.",
    path: "/about",
  });
  const { hash } = useLocation();
  const anchor = decodeURIComponent(hash.slice(1));

  // Old anchors land on the station that now holds them, with its details open.
  useEffect(() => {
    const target = { status: "sources", references: "processing" }[anchor] ?? anchor;
    if (!target) return;
    const t = setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: "center" }), 120);
    return () => clearTimeout(t);
  }, [anchor]);

  const { data: stats } = useQuery({ queryKey: ["corpus-stats"], queryFn: () => apiClient.stats(), staleTime: 120_000 });
  const { data: facets } = useQuery({ queryKey: ["facets", "landing"], queryFn: () => apiClient.facets({ level: "gse" }), staleTime: 300_000 });
  const { data: layers } = useQuery({ queryKey: ["stats-layers"], queryFn: () => apiClient.layers(), staleTime: 3_600_000 });

  const acc = stats?.accounting ?? {};
  const rm = stats?.qc.rules.removed;
  const low = stats?.qc.rules.low_qc;
  const layerOf = (key: string) => layers?.layers.find((l) => l.key === key);
  const share = (key: string) => {
    const l = layerOf(key);
    return l && l.of ? Math.round((l.studies / l.of) * 100) : null;
  };

  const funnel = stats
    ? [
        { label: "Samples listed on GEO", value: acc.samples_advertised ?? 0 },
        { label: "Queued for processing", value: (acc.samples_advertised ?? 0) - (acc.samples_not_ingested ?? 0) },
        { label: "Processed", value: acc.samples_done ?? 0 },
        { label: "Passed QC, downloadable", value: acc.in_files_usable_downloadable ?? 0, highlight: true },
      ].map((d) => ({ ...d, display: fmtCompact(d.value) }))
    : [];

  const allBuckets = stats
    ? [
        { label: "passed QC", value: acc.in_files_usable_downloadable ?? 0, className: "bg-primary" },
        { label: "low QC", value: acc.in_files_low_qc ?? 0, className: "bg-[var(--chart-warning)]" },
        { label: "removed", value: acc.in_files_removed ?? 0, className: "bg-[var(--chart-danger)]" },
        { label: "no count data", value: acc.in_files_unusable ?? 0, className: "bg-[var(--chart-muted)]" },
        { label: "withheld", value: acc.in_files_usable_withheld ?? 0, className: "bg-[var(--cell)]" },
        { label: "processed, file pending", value: acc.done_not_in_files ?? 0, className: "bg-[var(--teal-200)]" },
        { label: "failed processing", value: acc.samples_failed ?? 0, className: "bg-[var(--red-soft)]" },
        { label: "not queued yet", value: acc.samples_not_ingested ?? 0, className: "bg-secondary" },
      ].filter((p) => p.value > 0)
    : [];

  const qcParts = allBuckets.slice(0, 5);

  const assays = (facets?.assay_family ?? []).filter((o) => o.count > 0).slice(0, 7).map((o) => ({ label: o.value, value: o.count }));
  const refs = (facets?.reference_build ?? []).filter((o) => o.count > 0).slice(0, 6).map((o) => ({ label: o.value, value: o.count }));
  const layerBars = (layers?.layers ?? [])
    .filter((l) => l.key !== "gene_counts")
    .map((l) => ({ label: l.label, value: l.of ? Math.round((l.studies / l.of) * 100) : 0, display: `${l.of ? Math.round((l.studies / l.of) * 100) : 0}%`, highlight: true }));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1">
        <header className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_70%_at_20%_0%,rgba(46,191,174,0.14),transparent_70%)]" />
          <div className="container-site relative pt-14 md:pt-20 pb-6">
            <p className="type-mono text-primary">About singlet</p>
            <h1 className="mt-3 max-w-[860px] text-[36px] md:text-[52px] leading-[1.06] font-semibold tracking-tight">
              Every study we serve was reprocessed from raw reads.
            </h1>
            <p className="mt-5 max-w-[620px] text-[18px] text-muted-foreground">Follow one sample from GEO to your notebook. Hover a stop to jump to it.</p>
          </div>
        </header>

        <div className="container-site pb-10">
          <Railway>
            <Station
              id="sources"
              n={1}
              title="From GEO to raw reads"
              claim="We start from GEO's own records and each sample's raw reads, never the authors' processed matrix."
              visual={stats ? (<><Caption>Every GEO sample, step by step</Caption><HBars data={funnel} labelWidth="w-[150px] sm:w-[190px]" /></>) : <Loading />}
              defaultOpen={anchor === "status"}
              more={
                <>
                  <p>
                    We track {fmtInt(acc.studies_tracked ?? 0)} GEO series. For every sample we fetch the FASTQ files from SRA, up to 30 million
                    reads. Samples whose runs are missing or withdrawn are recorded with the reason, not dropped.
                  </p>
                  {stats && (
                    <>
                      <p>Where every one of the {fmtInt(acc.samples_advertised ?? 0)} samples GEO lists stands today:</p>
                      <StackedBar parts={allBuckets} />
                    </>
                  )}
                </>
              }
              link={{ to: "/docs#provenance", label: "Provenance in the docs" }}
            />

            <Station
              id="protocol"
              n={2}
              title="Protocol detected from the reads"
              claim="The barcode and UMI layout is read from the reads themselves, so each library is counted the way it was built."
              visual={facets ? (<><Caption>Studies by assay</Caption><HBars data={assays} labelWidth="w-[150px] sm:w-[190px]" /></>) : <Loading />}
              more={
                <>
                  <p>10x 3′ (v2, v3, v4), 10x 5′, Multiome, Drop-seq, inDrop, CITE-seq, BD Rhapsody, Smart-seq and more.</p>
                  <p>
                    When a 10x chemistry version comes only from GEO text, not from the reads, the study is labelled{" "}
                    <em>10x (version unconfirmed)</em>.
                  </p>
                </>
              }
              link={{ to: "/browse", label: "Filter by assay in Browse" }}
            />

            <Station
              id="processing"
              n={3}
              title="Aligned and counted, splicing included"
              claim="One reference per species. Exonic and intronic reads are counted separately for every cell, with splice junctions."
              visual={facets ? (<><Caption>Studies by reference genome</Caption><HBars data={refs} labelWidth="w-[150px] sm:w-[190px]" /></>) : <Loading />}
              defaultOpen={anchor === "references"}
              more={
                <>
                  <table className="text-[14px]">
                    <tbody>
                      {REFERENCES.map(([org, build, ann]) => (
                        <tr key={org} className="border-b border-border">
                          <td className="py-1.5 pr-5">{org}</td>
                          <td className="py-1.5 pr-5 font-mono text-[13px]">{build}</td>
                          <td className="py-1.5 text-muted-foreground">{ann}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>
                    Spliced and unspliced counts make RNA velocity possible without going back to the reads. The build is recorded on every cell
                    (<Mono>obs["reference_build"]</Mono>). Studies of other species aligned to one of these are flagged and left out of default
                    searches.
                  </p>
                </>
              }
              link={{ to: "/docs#provenance", label: "References and versions" }}
            />

            <Station
              id="layers"
              n={4}
              title="More than gene expression"
              claim={
                <>
                  Every file also holds mitochondrial DNA variants and immune receptor genes; {share("snps") ?? "about half"}% add SNP genotypes,
                  donors and genetic sex.
                </>
              }
              visual={layers ? (<><Caption>Share of downloadable studies with each layer</Caption><HBars data={layerBars} max={100} labelWidth="w-[150px] sm:w-[210px]" /></>) : <Loading />}
              more={
                <>
                  <p>
                    mtDNA heteroplasmy supports lineage tracing; SNPs and donor demultiplexing separate pooled donors; genetic sex and, for{" "}
                    {fmtInt(layerOf("ancestry")?.studies ?? 0)} human studies, continental ancestry are called from the reads.
                  </p>
                  <p>Newer files add per-cell doublet scores, cell cycle and ambient RNA estimates. Older files have fewer layers; check before you rely on one.</p>
                </>
              }
              link={{ to: "/docs#modalities", label: "Read every layer" }}
            />

            <Station
              id="qc"
              n={5}
              title="Every sample checked"
              claim="Failed runs are removed. Samples with an issue are flagged low QC and left out by default, one click away."
              visual={stats ? (<><Caption>Every processed sample in a published file</Caption><StackedBar parts={qcParts} /></>) : <Loading />}
              defaultOpen={anchor === "qc"}
              more={
                <>
                  <p>
                    <strong>Removed:</strong> under {Math.round((rm?.max_mapping_rate ?? 0.05) * 100)}% of reads mapped <em>and</em> under{" "}
                    {rm?.max_median_genes ?? 10} genes per cell.
                  </p>
                  <p>
                    <strong>Low QC:</strong> under {low?.min_median_genes ?? 30} genes per cell <em>or</em> under{" "}
                    {Math.round((low?.min_mapping_rate ?? 0.2) * 100)}% of reads mapped. Turn on <em>Include low-QC samples</em> in Browse or pass{" "}
                    <Mono>include_low_qc=1</Mono>.
                  </p>
                  <p className="text-muted-foreground">
                    The cut points are conservative: working samples have several hundred genes per cell and about 80% of reads mapped.
                  </p>
                </>
              }
              link={{ to: `/study/${EXAMPLE_GSE}`, label: "See QC on a study page" }}
            />

            <Station
              id="file"
              n={6}
              title="One small file per study"
              claim={<>All samples of a study in one <Mono>.singlet</Mono> file: raw counts, {H5AD_RATIO.toFixed(1)}× smaller than H5AD. Free, no account.</>}
              visual={<><Caption>Size of the same count matrix (uncompressed = 100%)</Caption><FormatSizeChart /></>}
              more={
                <>
                  <p>
                    A zip64 archive with one folder per sample (<Mono>exon_counts.1pz</Mono>, <Mono>intron_counts.1pz</Mono>,{" "}
                    <Mono>cell_calls.tsv</Mono>, QC and provenance JSON) and a <Mono>manifest.json</Mono> with checksums and the pipeline version.
                  </p>
                  <p>Nothing is normalised or batch-corrected. One sample can be read on its own over HTTP range requests.</p>
                  <p className="text-muted-foreground">Sizes are medians from the .1pz format benchmark (3,198 datasets for .1pz, 89 for H5AD).</p>
                </>
              }
              link={{ to: "/docs#singlet-file", label: "What's in a .singlet file" }}
            />

            <Station
              id="search"
              n={7}
              title="Search in plain English"
              claim="Type a question the way you would ask a colleague. It becomes exact filters you can see and change."
              visual={<SearchDiagram />}
              more={
                <>
                  <p>
                    A fixed vocabulary reads the question first: species, tissue, disease, assay, cell type, cell counts and years. It is free and
                    instant. Only words it cannot place go to a language model, once per question; the answer is cached and checked against the
                    same vocabulary.
                  </p>
                  <p>
                    Species is a hard filter and comes only from words like "mouse" or "patients", never from an abstract. A disease never implies
                    a tissue: "melanoma" is cancer, not skin. Every filter shows as a chip you can remove.
                  </p>
                </>
              }
              link={{ to: "/docs#search", label: "Search in the docs" }}
            />

            <Station
              id="use"
              n={8}
              title="Into your tool"
              claim="One line in Python or R, or ask Claude to find, check and load it for you."
              visual={<ToolsVisual />}
              more={<p>Python returns AnnData, R a SingleCellExperiment or Seurat object, with sample metadata attached. Claude uses the singlet.bio MCP server with a free API key.</p>}
              link={{ to: "/quickstart", label: "Get started" }}
            />
          </Railway>

          <div className="mt-10 pl-14 md:pl-24">
            <Fold id="cite" title="License and citation">
              <p>
                Data <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">CC0</a>, code MIT.{" "}
                <Link to="/data-license">License details</Link>. Cite the original study and the release you used:
              </p>
              <CodeBlock
                label="text"
                code={`<Original authors>. <Title>. GEO accession ${EXAMPLE_GSE} (<year>).
Singlet Bio. singlet atlas, release <singlet_version>. https://singlet.bio (accessed ${new Date().getFullYear()}).`}
              />
            </Fold>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default About;
