import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { apiClient } from "@/integrations/api/client";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fmtCompact, fmtInt } from "@/lib/catalog-display";
import { cn } from "@/lib/utils";
import { Railway, Station } from "@/components/about/Railway";
import { FormatSizeChart, H5AD_RATIO, HBars } from "@/components/landing/charts";
import { QcFunnel, sampleFunnel } from "@/components/landing/QcFunnel";
import { QueryParse } from "@/components/landing/QueryParse";
import { MODALITIES } from "@/components/landing/Modalities";
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
  ["Zebrafish", "GRCz11", "Ensembl"],
  ["Human + mouse", "GRCh38-GRCm39", "both"],
];

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

  const acc = stats?.accounting ?? {};
  const low = stats?.qc.rules.low_qc;
  const assays = (facets?.assay_family ?? []).filter((o) => o.count > 0).slice(0, 7).map((o) => ({ label: o.value, value: o.count }));
  const refs = (facets?.reference_build ?? []).filter((o) => o.count > 0).slice(0, 6).map((o) => ({ label: o.value, value: o.count }));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1">
        <header className="relative flex items-center min-h-[min(calc(100svh-3.5rem),880px)] py-16 border-b border-border">
          <div className="container-site text-center">
            <p className="type-mono text-primary">About singlet</p>
            <h1 className="mt-4 mx-auto max-w-[900px] text-[38px] md:text-[60px] leading-[1.04] font-semibold tracking-tight">
              Every study, reprocessed from raw reads.
            </h1>
            <p className="mt-6 mx-auto max-w-[620px] text-[18px] md:text-[20px] text-muted-foreground">
              Eight steps take a GEO sample to an AI-ready file you can load in one line.
            </p>
            <a href="#sources" className="mt-10 inline-flex flex-col items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
              Follow a sample
              <ChevronDown size={20} className="motion-safe:animate-bounce" aria-hidden="true" />
            </a>
          </div>
        </header>

        <div className="container-site pb-10">
          <Railway>
            <Station
              id="sources"
              n={1}
              title="From GEO to raw reads"
              claim="We start from GEO's own records and each sample's raw reads, never the authors' processed matrix."
              visual={
                stats ? (
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <p className="font-mono text-[34px] leading-none font-medium tabular">{fmtInt(acc.studies_tracked ?? 0)}</p>
                      <p className="mt-2 text-[13px] text-muted-foreground">GEO series tracked</p>
                    </div>
                    <div>
                      <p className="font-mono text-[34px] leading-none font-medium tabular">{fmtCompact(acc.samples_advertised ?? 0)}</p>
                      <p className="mt-2 text-[13px] text-muted-foreground">samples listed</p>
                    </div>
                    <p className="col-span-2 rounded bg-[var(--teal-50)] px-3 py-2 font-mono text-[12.5px]">GEO record → SRA run → FASTQ</p>
                  </div>
                ) : (
                  <Loading />
                )
              }
              detail={<p>Up to 30 million reads per sample. Sample characteristics from GEO are kept word for word.</p>}
              link={{ to: "/docs#provenance", label: "Provenance in the docs" }}
            />

            <Station
              id="protocol"
              n={2}
              title="Protocol detected from the reads"
              claim="The barcode and UMI layout is read from the reads themselves, so each library is counted the way it was built."
              visual={facets ? (<><Caption>Studies by assay</Caption><HBars data={assays} labelWidth="w-[150px] sm:w-[190px]" /></>) : <Loading />}
              detail={<p>10x 3′ and 5′, Multiome, Drop-seq, inDrop, CITE-seq, BD Rhapsody, Smart-seq and more.</p>}
              link={{ to: "/browse", label: "Filter by assay in Browse" }}
            />

            <Station
              id="processing"
              n={3}
              title="Aligned and counted, splicing included"
              claim="One reference per species. Exonic and intronic reads are counted separately for every cell, with splice junctions."
              visual={facets ? (<><Caption>Studies by reference genome</Caption><HBars data={refs} labelWidth="w-[150px] sm:w-[190px]" /></>) : <Loading />}
              detail={
                <>
                  <p>
                    Human GRCh38 (GENCODE v44), mouse GRCm39 (vM33), rat mRatBN7.2, macaque Mmul_10, zebrafish GRCz11. The build is recorded on
                    every cell.
                  </p>
                  <p>Spliced and unspliced counts are ready for RNA velocity.</p>
                </>
              }
              link={{ to: "/docs#provenance", label: "References and versions" }}
            />

            <Station
              id="layers"
              n={4}
              title="More than gene expression"
              claim="Each file stores four modalities, not just a count matrix."
              visual={
                <ul className="space-y-4">
                  {MODALITIES.map((m) => (
                    <li key={m.name} className="flex gap-3">
                      <span className="shrink-0 grid place-items-center h-10 w-10 rounded-lg bg-[var(--teal-50)] text-primary">{m.icon}</span>
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-semibold leading-snug">{m.name}</p>
                        <p className="text-[13px] leading-snug text-muted-foreground">{m.what}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              }
              detail={<p>We also compute doublet scores, cell-cycle phase, ambient RNA and sample-level calls from the transcriptome. All of it is free.</p>}
              link={{ to: "/docs#modalities", label: "Every modality in the docs" }}
            />

            <Station
              id="qc"
              n={5}
              title="Rigorous quality control"
              claim="Every sample is measured. Only high-quality samples are included."
              visual={stats ? (<><Caption>From GEO to approved samples</Caption><QcFunnel steps={sampleFunnel(acc)} /></>) : <Loading />}
              detail={
                <p>
                  The quality cut-off: at least {Math.round((low?.min_mapping_rate ?? 0.2) * 100)}% of reads map and the median cell has{" "}
                  {low?.min_median_genes ?? 30} or more genes.
                </p>
              }
              link={{ to: `/study/${EXAMPLE_GSE}`, label: "See QC on a study page" }}
            />

            <Station
              id="file"
              n={6}
              title="One small file per study"
              claim={<>All samples of a study in one <Mono>.singlet</Mono> file: raw counts, {H5AD_RATIO.toFixed(1)}× smaller than H5AD. Free, no account.</>}
              visual={<><Caption>Size of the same count matrix (uncompressed = 100%)</Caption><FormatSizeChart /></>}
              detail={
                <>
                  <p>Per sample: exon and intron counts, cell calls, QC and provenance. Nothing is normalised or batch-corrected.</p>
                  <p>One sample can be read on its own over HTTP range requests.</p>
                </>
              }
              link={{ to: "/docs#singlet-file", label: "Modalities and files" }}
            />

            <Station
              id="search"
              n={7}
              title="Search in plain English"
              claim="Type a question the way you would ask a colleague. It becomes exact filters you can see and change."
              visual={<QueryParse />}
              detail={
                <>
                  <p>A fixed vocabulary reads the question first, free and instant. Only words it cannot place go to a language model, once; the answer is cached and checked against the vocabulary.</p>
                  <p>Species comes only from words like "mouse" or "patients". A disease never implies a tissue: "melanoma" is cancer, not skin.</p>
                </>
              }
              link={{ to: "/ai-search", label: "What AI Search adds" }}
            />

            <Station
              id="use"
              n={8}
              title="Into your tool"
              claim="One line in Python or R, or ask Claude to find, check and load it for you."
              visual={<ToolsVisual />}
              detail={<p>AnnData in Python; SingleCellExperiment or Seurat in R; sample metadata attached.</p>}
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
