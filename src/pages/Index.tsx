import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Search } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { SearchBox } from "@/components/SearchBox";
import { apiClient } from "@/integrations/api/client";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fmtCompact, fmtInt } from "@/lib/catalog-display";
import { EXAMPLE_QUERIES, searchDestination } from "@/lib/search-routing";
import { Reveal } from "@/components/landing/Reveal";
import { StudyAnatomy } from "@/components/landing/StudyAnatomy";
import { WaysIn } from "@/components/landing/WaysIn";
import { Columns, FormatSizeChart, H5AD_RATIO, HBars, StackedBar } from "@/components/landing/charts";

// Page plan and the visitor profile behind it: docs/LANDING.md. Few words; the charts carry the message.

function StatSkeleton({ w = "w-16" }: { w?: string }) {
  return <span className={`inline-block h-7 ${w} rounded bg-secondary animate-pulse align-middle`} aria-hidden="true" />;
}

function SectionHead({ id, kicker, title }: { id: string; kicker: string; title: string }) {
  return (
    <div className="max-w-[720px]">
      <p className="type-mono text-primary">{kicker}</p>
      <h2 id={id} className="mt-2 text-[26px] md:text-[32px] leading-tight font-semibold tracking-tight">
        {title}
      </h2>
    </div>
  );
}

/** A big number with a short label, for the line above a chart. */
function Fact({ value, label }: { value: string | null; label: string }) {
  return (
    <div>
      <div className="font-mono font-medium text-[30px] md:text-[36px] leading-none tabular text-foreground">{value ?? <StatSkeleton w="w-20" />}</div>
      <div className="mt-1.5 text-[13px] text-muted-foreground">{label}</div>
    </div>
  );
}

const OPEN = ["CC0 data", "MIT code", "No account to download", "Python · R · Claude"];

const focusSearch = () => {
  const el = document.getElementById("hero-search") as HTMLInputElement | null;
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.focus({ preventScroll: true });
};

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

const Index = () => {
  usePageMeta({ path: "/" });

  const { data: stats } = useQuery({ queryKey: ["corpus-stats"], queryFn: () => apiClient.stats(), staleTime: 120_000 });
  const { data: facets } = useQuery({ queryKey: ["facets", "landing"], queryFn: () => apiClient.facets({ level: "gse" }), staleTime: 300_000 });
  const { data: layers } = useQuery({ queryKey: ["stats-layers"], queryFn: () => apiClient.layers(), staleTime: 3_600_000 });

  // Tissues with a downloadable study (the default facet basis); "Other" and mixed groups are not tissues.
  const tissueOptions = (facets?.tissue_group ?? []).filter((o) => o.count > 0 && !/^(Other|Multiple)/.test(o.value));
  const thisYear = new Date().getFullYear();
  const years = (facets?.year ?? [])
    .map((y) => ({ label: y.value, value: y.count }))
    .filter((y) => Number(y.label) >= 2015 && Number(y.label) <= thisYear)
    .sort((a, b) => Number(a.label) - Number(b.label));

  // Headline numbers count what a visitor can download (CLAUDE.md, "Data model and invariants").
  const statItems = [
    { value: stats ? fmtInt(stats.studies_with_files) : null, label: "studies" },
    { value: stats ? fmtInt(stats.samples_in_files) : null, label: "samples passed QC" },
    { value: stats ? fmtCompact(stats.cells_in_files) : null, label: "cells" },
    { value: facets ? fmtInt(tissueOptions.length) : null, label: "tissue groups" },
  ];

  const layerBy = Object.fromEntries((layers?.layers ?? []).map((l) => [l.key, l]));
  const share = (key: string) => (layerBy[key] ? `${pct(layerBy[key].studies, layerBy[key].of)}%` : null);
  const layerBars = (layers?.layers ?? []).map((l) => ({
    label: l.label,
    value: pct(l.studies, l.of),
    display: `${pct(l.studies, l.of)}%`,
    highlight: l.key !== "gene_counts",
  }));

  const qcParts = stats
    ? [
        { label: "passed QC", value: stats.samples_in_files, className: "bg-primary" },
        { label: "low QC, kept apart", value: stats.qc.low_qc_samples, className: "bg-[var(--chart-warning)]" },
        { label: "failed, removed", value: stats.qc.removed_samples, className: "bg-[var(--chart-danger)]" },
      ]
    : [];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(46,191,174,0.12),transparent_70%)]"
          />
          <div className="container-site relative pt-12 md:pt-16 pb-14 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-10 lg:gap-12 items-center">
            <div className="text-center lg:text-left min-w-0">
              <h1 className="type-display text-foreground !text-[36px] !leading-[1.1] md:!text-[46px] md:!leading-[1.08]">
                AI-ready single-cell data, at your fingertips.
              </h1>
              <p className="mt-5 text-[17px] md:text-[18px] leading-relaxed text-muted-foreground max-w-[540px] mx-auto lg:mx-0">
                Public scRNA-seq from GEO, realigned from raw reads and quality-checked. Ready to load in one line.
              </p>

              <div className="mt-7 max-w-[620px] mx-auto lg:mx-0">
                <SearchBox variant="hero" placeholder={`Try "${EXAMPLE_QUERIES[0]}"`} />
                <ul className="mt-3 flex flex-wrap justify-center lg:justify-start gap-2" aria-label="Example searches">
                  {EXAMPLE_QUERIES.slice(1).map((q) => (
                    <li key={q}>
                      <Link to={searchDestination(q)!} className="chip">
                        {q}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <dl className="mt-8 grid grid-cols-4 gap-2 max-w-[560px] mx-auto lg:mx-0">
                {statItems.map((s) => (
                  <div key={s.label} className="min-w-0">
                    <dd className="font-mono font-medium text-[20px] sm:text-[26px] leading-none tabular text-foreground">{s.value ?? <StatSkeleton />}</dd>
                    <dt className="mt-1.5 text-[12px] text-muted-foreground leading-tight">{s.label}</dt>
                  </div>
                ))}
              </dl>
            </div>

            <figure className="min-w-0">
              <div className="surface overflow-hidden p-0 shadow-[0_12px_40px_-12px_rgba(15,31,29,0.25)]">
                <picture>
                  <source media="(prefers-reduced-motion: reduce)" srcSet="/demo/singlet-demo-poster.png" />
                  <img
                    src="/demo/singlet-demo.gif"
                    width={960}
                    height={540}
                    alt="Python loads study GSE138867 and plots cells per sample; R lists the layers in its file and loads it; Claude searches singlet.bio for microglia in the aging mouse brain and loads the largest study."
                    className="block w-full h-auto"
                  />
                </picture>
              </div>
              <figcaption className="mt-2.5 text-[12.5px] text-muted-foreground text-center lg:text-left">Python, R or Claude: the same data, one line.</figcaption>
            </figure>
          </div>
        </section>

        {/* ── Coverage ── */}
        <section className="container-site py-16 border-t border-border" aria-labelledby="coverage-h">
          <Reveal>
            <SectionHead id="coverage-h" kicker="Coverage" title="Your tissue is probably here" />
            <div className="mt-10 grid lg:grid-cols-2 gap-10 lg:gap-14">
              <div>
                <p className="text-[13px] font-medium mb-3">Studies by tissue</p>
                <HBars
                  data={tissueOptions.slice(0, 10).map((o) => ({ label: o.value, value: o.count, href: `/browse?tissue_group=${encodeURIComponent(o.value)}` }))}
                  labelWidth="w-[130px] sm:w-[170px]"
                />
              </div>
              <div>
                <p className="text-[13px] font-medium mb-3">Studies by year of GEO release</p>
                <Columns data={years} partialLast={years.at(-1)?.label === String(thisYear)} />
                {years.at(-1)?.label === String(thisYear) && <p className="mt-2 text-[11.5px] text-muted-foreground">* {thisYear} so far</p>}
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── Layers ── */}
        <section className="py-16 bg-secondary/40 border-y border-border" aria-labelledby="layers-h">
          <div className="container-site">
            <Reveal>
              <SectionHead id="layers-h" kicker="Inside every file" title="More than a count matrix" />
              <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-6">
                <Fact value={share("splicing")} label="of studies splicing-resolved" />
                <Fact value={share("mtdna")} label="with mitochondrial DNA variants" />
                <Fact value={share("snps")} label="with SNP genotypes" />
                <Fact value={layerBy.ancestry ? fmtInt(layerBy.ancestry.studies) : null} label="human studies with genetic ancestry" />
              </div>
              <div className="mt-10 grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-10 items-start">
                <div>
                  <p className="text-[13px] font-medium mb-3">Share of downloadable studies with each layer (ancestry: of human studies)</p>
                  <HBars data={layerBars} max={100} labelWidth="w-[150px] sm:w-[210px]" />
                </div>
                <StudyAnatomy />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── QC ── */}
        <section className="container-site py-16" aria-labelledby="qc-h">
          <Reveal>
            <SectionHead id="qc-h" kicker="Quality control" title="Every sample checked" />
            <p className="mt-3 text-[15px] text-muted-foreground">
              Samples in published files.{" "}
              <Link to="/about#qc" className="text-primary hover:underline">
                How QC works →
              </Link>
            </p>
            <div className="mt-8 max-w-[900px]">{stats ? <StackedBar parts={qcParts} /> : <StatSkeleton w="w-full" />}</div>
          </Reveal>
        </section>

        {/* ── File size ── */}
        <section className="container-site py-16 border-t border-border" aria-labelledby="size-h">
          <Reveal>
            <div className="grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-10 items-center">
              <div>
                <SectionHead id="size-h" kicker="Format" title="Small files, fast loads" />
                <div className="mt-6 flex gap-8">
                  <Fact value={`${H5AD_RATIO.toFixed(1)}×`} label="smaller than AnnData (H5AD)" />
                  <Fact value="3×" label="faster to read" />
                </div>
              </div>
              <div>
                <p className="text-[13px] font-medium mb-3">Size of the same count matrix (uncompressed = 100%)</p>
                <FormatSizeChart />
                <p className="mt-3 text-[11.5px] text-muted-foreground">
                  Medians from the .1pz format benchmark: 3,198 datasets for .1pz, 89 for H5AD, 10x HDF5 and npz, 20 for RDS and BPCells.
                  Read speed: median 3.1× faster decode than H5AD.
                </p>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── Three ways in ── */}
        <section className="container-site py-16 border-t border-border" aria-labelledby="ways-h">
          <Reveal>
            <SectionHead id="ways-h" kicker="Use it your way" title="Three ways in" />
            <div className="mt-8">
              <WaysIn />
            </div>
          </Reveal>
        </section>

        {/* ── Close ── */}
        <section className="surface-dark">
          <div className="container-site py-14 text-center">
            <h2 className="text-[26px] md:text-[30px] font-semibold tracking-tight text-dark-foreground">Find your next dataset.</h2>
            <ul className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[13.5px] text-dark-muted">
              {OPEN.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button type="button" onClick={focusSearch} className="btn-primary">
                <Search size={16} /> Search the atlas
              </button>
              <Link to="/quickstart" className="btn-secondary">
                <BookOpen size={16} /> Quickstart
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Index;
