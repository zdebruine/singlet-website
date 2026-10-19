import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, FlaskConical, Laptop, Search } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { SearchBox } from "@/components/SearchBox";
import { apiClient } from "@/integrations/api/client";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fmtCompact, fmtInt } from "@/lib/catalog-display";
import { EXAMPLE_QUERIES, searchDestination } from "@/lib/search-routing";
import { QuickStartHubs } from "@/components/QuickStartHubs";
import { Reveal } from "@/components/landing/Reveal";
import { StudyAnatomy } from "@/components/landing/StudyAnatomy";
import { WaysIn } from "@/components/landing/WaysIn";

// Page plan and the visitor profile behind it: docs/LANDING.md.

function StatSkeleton({ w = "w-16" }: { w?: string }) {
  return <span className={`inline-block h-7 ${w} rounded bg-secondary animate-pulse align-middle`} aria-hidden="true" />;
}

function SectionHead({ id, kicker, title, sub }: { id: string; kicker: string; title: string; sub?: string }) {
  return (
    <div className="max-w-[680px]">
      <p className="type-mono text-primary">{kicker}</p>
      <h2 id={id} className="mt-2 text-[26px] md:text-[30px] leading-tight font-semibold tracking-tight">
        {title}
      </h2>
      {sub && <p className="mt-3 text-[15.5px] leading-relaxed text-muted-foreground">{sub}</p>}
    </div>
  );
}

const AUDIENCES = [
  {
    icon: FlaskConical,
    title: "For bench scientists",
    points: [
      "Ask in plain English: tissue, disease, cell type, treatment",
      "See every sample's conditions and quality before you download",
      "Hand your bioinformatician one line, or let Claude do it",
    ],
    link: { to: "/quickstart", label: "5-minute quickstart" },
  },
  {
    icon: Laptop,
    title: "For computational biologists",
    points: [
      "Realigned from raw reads with one pipeline and pinned references",
      "Exon and intron counts, cell calls and per-sample QC in each file",
      "AnnData or SingleCellExperiment in one line; an API and an MCP server",
    ],
    link: { to: "/about", label: "How the data is processed" },
  },
];

const OPEN = [
  { title: "CC0 data", body: "Use it for anything, no permission needed." },
  { title: "MIT code", body: "The pipeline and packages are open source." },
  { title: "No account to download", body: "Files are public links. Sign in only for AI search limits, API keys and libraries." },
  { title: "Citable", body: "Every study page gives the GEO record, its paper and how to cite singlet." },
];

const focusSearch = () => {
  const el = document.getElementById("hero-search") as HTMLInputElement | null;
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.focus({ preventScroll: true });
};

const Index = () => {
  usePageMeta({ path: "/" });

  const { data: stats } = useQuery({
    queryKey: ["corpus-stats"],
    queryFn: () => apiClient.stats(),
    staleTime: 120_000,
  });
  // Tissues with a downloadable study (the default facet basis); "Other" and mixed groups are not tissues.
  const { data: facets } = useQuery({ queryKey: ["facets", "landing"], queryFn: () => apiClient.facets({ level: "gse" }), staleTime: 300_000 });
  const tissues = facets ? facets.tissue_group.filter((o) => o.count > 0 && !/^(Other|Multiple)/.test(o.value)).length : null;
  // Headline numbers count what a visitor can download (CLAUDE.md, "Data model and invariants").
  const statItems = [
    { value: stats ? fmtInt(stats.studies_with_files) : null, label: "studies" },
    { value: stats ? fmtInt(stats.samples_in_files) : null, label: "samples passed QC" },
    { value: stats ? fmtCompact(stats.cells_in_files) : null, label: "cells" },
    { value: tissues != null ? fmtInt(tissues) : null, label: "tissue groups" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-1">
        {/* ── Hero: what it is, that it is real, that it is easy ── */}
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
              <p className="mt-5 text-[17px] md:text-[18px] leading-relaxed text-muted-foreground max-w-[560px] mx-auto lg:mx-0">
                {stats ? fmtInt(stats.studies_with_files) : "Thousands of"} public scRNA-seq studies from GEO, realigned from raw reads
                with one pipeline and quality-checked. Search in plain English, load in one line, or ask Claude.
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
              <p className="mt-4 text-[13px] text-muted-foreground">Free · CC0 · No account to download · Python, R and Claude</p>
            </div>

            <figure className="min-w-0">
              <div className="surface overflow-hidden p-0 shadow-[0_12px_40px_-12px_rgba(15,31,29,0.25)]">
                <picture>
                  <source media="(prefers-reduced-motion: reduce)" srcSet="/demo/singlet-demo-poster.png" />
                  <img
                    src="/demo/singlet-demo.gif"
                    width={960}
                    height={540}
                    alt="A Python notebook loads study GSE138867 and plots cells per sample; then Claude searches singlet.bio for microglia in the aging mouse brain and finds the largest study."
                    className="block w-full h-auto"
                  />
                </picture>
              </div>
              <figcaption className="mt-2.5 text-[12.5px] text-muted-foreground text-center lg:text-left">
                Load a study in a notebook, or ask Claude to find and load it.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ── Who it is for ── */}
        <section className="container-site py-14 border-t border-border" aria-label="Who it is for">
          <Reveal>
            <div className="grid md:grid-cols-2 gap-4">
              {AUDIENCES.map(({ icon: Icon, title, points, link }) => (
                <div key={title} className="surface p-6">
                  <Icon size={20} className="text-primary" aria-hidden="true" />
                  <h2 className="mt-3 text-[19px] font-semibold">{title}</h2>
                  <ul className="mt-3 space-y-2">
                    {points.map((p) => (
                      <li key={p} className="flex gap-2.5 text-[14.5px] leading-snug">
                        <Check size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to={link.to} className="mt-4 inline-block text-[13.5px] text-primary hover:underline">
                    {link.label} →
                  </Link>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ── Anatomy of a study ── */}
        <section className="container-site py-14" aria-labelledby="study-h">
          <Reveal>
            <SectionHead
              id="study-h"
              kicker="Inside a study"
              title="Everything about a study, one click away"
              sub="A summary first, the details when you want them. This is a real study, read live from the catalog."
            />
            <div className="mt-8">
              <StudyAnatomy />
            </div>
          </Reveal>
        </section>

        {/* ── Quality control ── */}
        <section className="py-14 bg-secondary/40 border-y border-border" aria-labelledby="qc-h">
          <div className="container-site">
            <Reveal>
              <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-8 items-end">
                <div>
                  <SectionHead
                    id="qc-h"
                    kicker="Quality control"
                    title="Rigorous quality control"
                    sub="Public data is uneven. singlet measures every sample: failed runs are removed, and samples with an issue are flagged low QC and left out by default, one click away if you want them."
                  />
                  <Link to="/about#qc" className="mt-4 inline-block text-[13.5px] text-primary hover:underline">
                    How QC works →
                  </Link>
                </div>
                <dl className="grid grid-cols-3 gap-3">
                  {[
                    { value: stats ? fmtInt(stats.qc.removed_samples) : null, label: "failed samples removed" },
                    { value: stats ? fmtInt(stats.qc.low_qc_samples) : null, label: "samples flagged low QC" },
                    { value: stats ? fmtInt(stats.qc.studies_affected) : null, label: "studies cleaned" },
                  ].map((s) => (
                    <div key={s.label} className="surface p-4 min-w-0">
                      <dd className="font-mono font-medium text-[20px] sm:text-[24px] leading-none tabular">{s.value ?? <StatSkeleton />}</dd>
                      <dt className="mt-2 text-[12.5px] text-muted-foreground">{s.label}</dt>
                    </div>
                  ))}
                </dl>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Three ways in ── */}
        <section className="container-site py-14" aria-labelledby="ways-h">
          <Reveal>
            <SectionHead id="ways-h" kicker="Use it your way" title="Three ways in, same data" />
            <div className="mt-8">
              <WaysIn />
            </div>
          </Reveal>
        </section>

        {/* ── Topics ── */}
        <section className="container-site pb-14">
          <Reveal>
            <QuickStartHubs title="Or start from a topic" />
          </Reveal>
        </section>

        {/* ── Open ── */}
        <section className="container-site py-14 border-t border-border" aria-labelledby="open-h">
          <Reveal>
            <SectionHead id="open-h" kicker="Open by default" title="Built for public science" />
            <ul className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {OPEN.map((o) => (
                <li key={o.title}>
                  <h3 className="text-[15px] font-semibold">{o.title}</h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{o.body}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* ── Close: back to the one search box ── */}
        <section className="surface-dark">
          <div className="container-site py-14 text-center">
            <h2 className="text-[26px] md:text-[30px] font-semibold tracking-tight text-dark-foreground">Find your next dataset.</h2>
            <p className="mt-2 text-[15px] text-dark-muted">Start with a question. It takes a few seconds.</p>
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
