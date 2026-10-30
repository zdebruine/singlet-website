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
import { FORMAT_NOTE, FormatSizeChart, H5AD_PAIRED, HBars } from "@/components/landing/charts";
import { QcFunnel, sampleFunnel } from "@/components/landing/QcFunnel";
import { QueryParse } from "@/components/landing/QueryParse";
import { MODALITIES } from "@/components/landing/Modalities";
import { EXAMPLE_GSE, GITHUB_ISSUES } from "@/lib/install-snippets";

const CHANGELOG_URL = "https://github.com/zdebruine/singlet-website/blob/main/CHANGELOG.md";

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
            <p className="mt-4 text-[14px] text-muted-foreground">singlet.bio is developed at Grand Valley State University.</p>
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
              detail={<p>10x 3′ and 5′, Multiome and CITE-seq (RNA library), Drop-seq, inDrop, Seq-Well, BD Rhapsody, CEL-seq2, MARS-seq2, SPLiT-seq, DNBelab C4 and more. Plate-based Smart-seq is not processed in Alpha.</p>}
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
                    Human GRCh38 (GENCODE v44), mouse GRCm39 (vM33), rat mRatBN7.2, macaque Mmul_10, zebrafish GRCz11, and a combined
                    human-mouse reference for mixed-species studies. The build is in every study manifest and on every cell you load.
                  </p>
                  <p>In Alpha some molecules are counted twice, so the spliced and unspliced layers are not yet suited to RNA velocity.</p>
                </>
              }
              link={{ to: "/docs#provenance", label: "References and versions" }}
            />

            <Station
              id="layers"
              n={4}
              title="More than gene expression"
              claim="Splicing layers, immune receptor genes, and a cell type, sex and ancestry label for each cell where the data allow."
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
              detail={
                <>
                  <p>Alpha is transcriptomics only. No genotypes, mtDNA alleles, ambient-RNA or doublet calls.</p>
                  <p>Genotypes and mitochondrial variants are never released.</p>
                </>
              }
              link={{ to: "/docs#modalities", label: "Layers in the docs" }}
            />

            <Station
              id="qc"
              n={5}
              title="Quality control on every sample"
              claim="Every sample is measured. Samples below the cut-off are flagged and left out of counts and search by default; they stay in the study file."
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
              title="One small file per sample"
              claim={<>Each sample is one <Mono>.s1</Mono> object of raw counts, {H5AD_PAIRED} smaller than H5AD. A study's manifest lists its samples. Free, no account.</>}
              visual={<><Caption>Size of a count matrix (uncompressed = 100%)</Caption><FormatSizeChart /><p className="mt-3 text-[12px] text-muted-foreground">{FORMAT_NOTE}</p></>}
              detail={
<p>Per sample: exon and intron counts, cell calls, QC and provenance, nothing normalised or batch-corrected. One sample, or a few of its cells, can be read on its own over HTTP range requests.</p>
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
<p>A fixed vocabulary reads the question first, at no cost; only words it cannot place go to a language model. Species comes only from words like "mouse"; a disease never implies a tissue.</p>
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
              link={{ to: "/#get-started", label: "Get started" }}
            />
          </Railway>

          <div className="mt-10 pl-14 md:pl-24">
            <section id="governance" aria-labelledby="governance-title" className="border-t border-border py-6 scroll-mt-20 max-w-[760px]">
              <h2 id="governance-title" className="text-[17px] font-semibold">Governance</h2>
              <ul className="mt-3 list-disc pl-5 space-y-1.5 text-[14.5px] leading-relaxed">
                <li>Grand Valley State University (GVSU) holds custody of singlet.bio and its data.</li>
                <li>
                  Data <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">CC0</a>,
                  code MIT (<Link to="/data-license" className="text-primary underline underline-offset-2">license details</Link>).
                </li>
                <li>
                  Takedowns and corrections: send feedback from any page or open a{" "}
                  <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">GitHub Issue</a>; we act
                  within 30 days.
                </li>
                <li>
                  Every change to what the site publishes is in the public{" "}
                  <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">changelog</a>; open
                  problems are on <Link to="/known-issues" className="text-primary underline underline-offset-2">Known issues</Link>.
                </li>
                <li>An advisory board with external members is being formed to guide the release policy.</li>
                <li>Genotypes and mitochondrial variants are never released.</li>
              </ul>
            </section>
            <Fold id="cite" title="License and citation">
              <p>
                Data <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">CC0</a>, code MIT.{" "}
                <Link to="/data-license">License details</Link>. Cite the original study and the release you used:
              </p>
              <CodeBlock
                label="text"
                code={`<Original authors>. <Title>. GEO accession ${EXAMPLE_GSE} (<year>).
Singlet Research Alpha (October 2026). https://singlet.bio (accessed ${new Date().getFullYear()}).`}
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
