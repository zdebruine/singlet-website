import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { apiClient } from "@/integrations/api/client";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fmtInt } from "@/lib/catalog-display";
import { cn } from "@/lib/utils";
import { PipelineMap, type Stop } from "@/components/landing/PipelineMap";
import { StackedBar } from "@/components/landing/charts";

// One job: show how a sample gets from GEO to your analysis, so you can trust it. Details open on demand.

const Mono = ({ children }: { children: ReactNode }) => <code className="code-inline">{children}</code>;

/** A section that stays closed until the reader opens it, or arrives with its #id in the URL. */
function Fold({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const { hash } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (decodeURIComponent(hash.slice(1)) === id) {
      setOpen(true);
      const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 40);
      return () => clearTimeout(t);
    }
  }, [hash, id]);
  return (
    <section id={id} className="border-b border-border scroll-mt-20">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center gap-2 py-4 text-left">
        <ChevronRight size={16} className={cn("text-primary transition-transform", open && "rotate-90")} aria-hidden="true" />
        <h2 className="text-[17px] font-semibold">{title}</h2>
      </button>
      {open && <div className="pb-6 pl-6 text-[14.5px] leading-relaxed space-y-3 max-w-[760px]">{children}</div>}
    </section>
  );
}

const REFERENCES = [
  ["Human", "GRCh38 (2024-A)", "GENCODE v44"],
  ["Mouse", "GRCm39 (2024-A)", "GENCODE vM33"],
  ["Rat", "mRatBN7.2", "Ensembl 110"],
  ["Rhesus macaque", "Mmul_10", "Ensembl"],
  ["Human + mouse", "GRCh38-GRCm39", "both"],
];

const About = () => {
  usePageMeta({
    title: "How the data is made",
    description: "Every study on singlet.bio is reprocessed from raw reads: download, protocol detection, alignment, counting, extra layers, QC, one file per study.",
    path: "/about",
  });

  const { data: stats } = useQuery({ queryKey: ["corpus-stats"], queryFn: () => apiClient.stats(), staleTime: 120_000 });
  const { data: layers } = useQuery({ queryKey: ["stats-layers"], queryFn: () => apiClient.layers(), staleTime: 3_600_000 });
  const layer = (key: string) => layers?.layers.find((l) => l.key === key);
  const share = (key: string) => {
    const l = layer(key);
    return l && l.of ? `${Math.round((l.studies / l.of) * 100)}%` : "…";
  };
  const acc = stats?.accounting ?? {};
  const rm = stats?.qc.rules.removed;
  const low = stats?.qc.rules.low_qc;

  const stops: Stop[] = [
    {
      key: "geo",
      label: "GEO",
      fact: stats ? `${fmtInt(acc.studies_tracked ?? stats.series_count)} studies tracked` : "…",
      detail: "Every study starts as a GEO series: its samples, their characteristics and the paper. We keep the GEO text word for word.",
    },
    {
      key: "reads",
      label: "Raw reads",
      fact: "FASTQ from SRA",
      detail: "We download each sample's raw reads, never the authors' processed matrix. Up to 30 million reads per sample.",
    },
    {
      key: "protocol",
      label: "Protocol",
      fact: "read from the reads",
      detail: "The barcode and UMI layout is detected from the reads: 10x 3′ and 5′, Drop-seq, CITE-seq, BD Rhapsody, Smart-seq and more.",
    },
    {
      key: "align",
      label: "Align",
      fact: "one reference per species",
      detail: (
        <>
          Human <Mono>GRCh38</Mono>, mouse <Mono>GRCm39</Mono>, rat <Mono>mRatBN7.2</Mono>, macaque <Mono>Mmul_10</Mono>. The build is
          recorded on every cell.
        </>
      ),
    },
    {
      key: "count",
      label: "Count",
      fact: `${share("splicing")} splicing-resolved`,
      detail: "Exonic and intronic reads are counted separately for every cell, with splice junctions and PSI. Ready for RNA velocity.",
    },
    {
      key: "layers",
      label: "Beyond expression",
      fact: `mtDNA ${share("mtdna")} · SNPs ${share("snps")}`,
      detail: (
        <>
          Mitochondrial DNA variants, immune receptor (V(D)J) gene usage, SNP genotypes, donor demultiplexing, genetic sex
          {layer("ancestry") ? <>, and ancestry for {fmtInt(layer("ancestry")!.studies)} human studies</> : null}.
        </>
      ),
    },
    {
      key: "qc",
      label: "QC",
      fact: stats ? `${fmtInt(stats.qc.removed_samples)} removed · ${fmtInt(stats.qc.low_qc_samples)} flagged` : "…",
      detail: (
        <>
          Every sample is measured. Failed runs are removed; samples with an issue are flagged low QC and left out by default.{" "}
          <a href="#qc">The rules</a>
        </>
      ),
    },
    {
      key: "file",
      label: "One file",
      fact: "3.5× smaller than H5AD",
      detail: (
        <>
          All samples of a study in one <Mono>.singlet</Mono> file: raw counts, not normalized or batch-corrected. Free to download,
          no account.
        </>
      ),
    },
    {
      key: "use",
      label: "Your tool",
      fact: "Python · R · Claude",
      detail: (
        <>
          <Mono>singlet.load("GSE138867")</Mono> in Python or R, or ask Claude. <Link to="/quickstart">Get started →</Link>
        </>
      ),
    },
  ];

  const parts = stats
    ? [
        { label: "passed QC", value: acc.in_files_usable_downloadable ?? 0, className: "bg-primary" },
        { label: "low QC", value: acc.in_files_low_qc ?? 0, className: "bg-[var(--chart-warning)]" },
        { label: "removed", value: acc.in_files_removed ?? 0, className: "bg-[var(--chart-danger)]" },
        { label: "no count data", value: acc.in_files_unusable ?? 0, className: "bg-[var(--chart-muted)]" },
        { label: "withheld", value: acc.in_files_usable_withheld ?? 0, className: "bg-[var(--cell)]" },
        { label: "processed, file pending", value: acc.done_not_in_files ?? 0, className: "bg-[var(--teal-200)]" },
        { label: "failed processing", value: acc.samples_failed ?? 0, className: "bg-[var(--red-soft)]" },
        { label: "not ingested yet", value: acc.samples_not_ingested ?? 0, className: "bg-secondary border-l border-border" },
      ].filter((p) => p.value > 0)
    : [];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-12 md:py-16">
        <header className="max-w-[760px]">
          <p className="type-mono text-primary">How the data is made</p>
          <h1 className="mt-2 text-[34px] md:text-[44px] leading-[1.1] font-semibold tracking-tight">We reprocessed every study we serve, from raw reads.</h1>
          <p className="mt-4 text-[17px] text-muted-foreground">Nine stops from GEO to your notebook. Click one.</p>
        </header>

        <div className="mt-12" id="processing">
          <PipelineMap stops={stops} />
        </div>

        <div className="mt-14 border-t border-border">
          <Fold id="qc" title="Quality control rules">
            <p>
              <strong>Removed:</strong> under {Math.round((rm?.max_mapping_rate ?? 0.05) * 100)}% of reads mapped <em>and</em> under{" "}
              {rm?.max_median_genes ?? 10} genes per cell. Failed runs; not listed, not counted.
            </p>
            <p>
              <strong>Low QC:</strong> under {low?.min_median_genes ?? 30} genes per cell <em>or</em> under{" "}
              {Math.round((low?.min_mapping_rate ?? 0.2) * 100)}% of reads mapped. Left out by default; switch on <em>Include low-QC samples</em>{" "}
              in Browse or pass <Mono>include_low_qc=1</Mono>.
            </p>
            <p className="text-muted-foreground">Flagged samples stay in the study file and are marked on the study page.</p>
          </Fold>

          <Fold id="status" title="Where every GEO sample stands">
            {stats ? (
              <>
                <p>
                  {fmtInt(acc.samples_advertised ?? 0)} samples listed on GEO across {fmtInt(acc.studies_tracked ?? 0)} studies, each in one
                  bucket:
                </p>
                <StackedBar parts={parts} />
              </>
            ) : (
              <p className="text-muted-foreground">Loading…</p>
            )}
          </Fold>

          <Fold id="references" title="Reference genomes">
            <table className="text-[14px]">
              <tbody>
                {REFERENCES.map(([org, build, ann]) => (
                  <tr key={org} className="border-b border-border">
                    <td className="py-1.5 pr-6">{org}</td>
                    <td className="py-1.5 pr-6 font-mono text-[13px]">{build}</td>
                    <td className="py-1.5 text-muted-foreground">{ann}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground">
              Studies of other species aligned to one of these are flagged on their page and left out of default searches. Files record their
              pipeline version in <Mono>manifest.json</Mono>; check it before merging studies.
            </p>
          </Fold>

          <Fold id="cite" title="License and citation">
            <p>
              Data <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">CC0</a>, code MIT.{" "}
              <Link to="/data-license">License details</Link>. Cite the original study and the release you used:
            </p>
            <CodeBlock
              label="text"
              code={`<Original authors>. <Title>. GEO accession GSE138867 (<year>).
Singlet Bio. singlet atlas, release <singlet_version>. https://singlet.bio (accessed ${new Date().getFullYear()}).`}
            />
          </Fold>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default About;
