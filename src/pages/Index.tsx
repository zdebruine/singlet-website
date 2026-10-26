import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { SearchBox } from "@/components/SearchBox";
import { AlphaTag } from "@/components/AlphaBanner";
import { apiClient } from "@/integrations/api/client";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fmtCompact, fmtInt } from "@/lib/catalog-display";
import { EXAMPLE_QUERIES } from "@/lib/search-routing";
import { cn } from "@/lib/utils";
import { FormatSizeChart, H5AD_RATIO, HBars } from "@/components/landing/charts";
import { QcFunnel, sampleFunnel } from "@/components/landing/QcFunnel";
import { GetStarted } from "@/components/landing/GetStarted";
import { ModalityGrid } from "@/components/landing/Modalities";

// One message per browser view. Each screen fills the visible window (below the header) up to a cap, so a large
// monitor does not stretch it, and stacks naturally on a phone. Plan: docs/LANDING.md.

/** One browser view: at least the window height under the header, at most 960px, content centred. */
function Screen({ id, children, className, label }: { id: string; children: ReactNode; className?: string; label: string }) {
  return (
    <section
      id={id}
      aria-label={label}
      className={cn("scroll-mt-14 flex items-center py-16 md:py-20 min-h-[min(calc(100svh-3.5rem),960px)] border-b border-border last:border-b-0", className)}
    >
      <div className="container-site w-full">{children}</div>
    </section>
  );
}

function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="text-center max-w-[760px] mx-auto">
      <h2 className="text-[32px] md:text-[44px] leading-[1.08] font-semibold tracking-tight">{children}</h2>
      {sub && <p className="mt-4 text-[17px] md:text-[19px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Skeleton({ h = "h-48" }: { h?: string }) {
  return <div className={cn("rounded bg-secondary animate-pulse", h)} aria-hidden="true" />;
}

/** Links to every screen, under the hero search, so a visitor sees what is here. */
const JUMPS = [
  { href: "#demo", label: "See it work" },
  { href: "#coverage", label: "Coverage" },
  { href: "#layers", label: "Layers" },
  { href: "#qc", label: "Quality control" },
];

/** Hero buttons that open the matching tab of the Get started screen. */
const TOOL_LINKS = [
  { id: "python", label: "Python", logo: "/logos/python.png" },
  { id: "r", label: "R", logo: "/logos/r.png" },
  { id: "claude", label: "Claude", logo: "/logos/claude.png" },
] as const;

const Index = () => {
  usePageMeta({ path: "/" });
  const { hash } = useLocation();

  const { data: stats } = useQuery({ queryKey: ["corpus-stats"], queryFn: () => apiClient.stats(), staleTime: 120_000 });
  const { data: facets } = useQuery({ queryKey: ["facets", "landing"], queryFn: () => apiClient.facets({ level: "gse" }), staleTime: 300_000 });

  // /#get-started (and the old /quickstart, which redirects here) lands on its screen.
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1)).split("/")[0];
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 60);
    return () => clearTimeout(t);
  }, [hash]);

  const tissues = (facets?.tissue_group ?? []).filter((o) => o.count > 0 && !/^(Other|Multiple)/.test(o.value));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-1">
        {/* 1 · Search: the whole atlas behind one box */}
        <section aria-label="Search" className="relative flex flex-col items-center justify-center min-h-[min(calc(100svh-3.5rem),960px)] py-16 border-b border-border">
          <div className="container-site w-full flex flex-col items-center text-center">
            <h1 className="sr-only">singlet.bio: AI-ready single-cell data</h1>
            <span className="inline-flex items-start gap-2">
              <Logo variant="lockup" theme="auto" height={52} link={false} />
              <AlphaTag className="mt-0.5" />
            </span>
            <div className="mt-10 w-full max-w-[680px]">
              <SearchBox variant="hero" placeholder={`Try "${EXAMPLE_QUERIES[0]}"`} />
              <p className="mt-3 text-[13px] text-muted-foreground tabular">
                {stats ? `${fmtCompact(stats.cells_in_files)} single-cell transcriptomes` : "\u00a0"}
              </p>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link to="/browse" className="btn-secondary">
                Browse {stats ? fmtInt(stats.studies_with_files) : ""} studies
              </Link>
              <span className="mx-1 hidden sm:block h-6 w-px bg-border" aria-hidden="true" />
              {TOOL_LINKS.map((t) => (
                <a key={t.id} href={`#get-started/${t.id}`} aria-label={`Get started with ${t.label}`} title={t.label} className="btn-secondary !px-3 gap-2">
                  <img src={t.logo} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
                  <span>{t.label}</span>
                </a>
              ))}
            </div>
            <nav aria-label="On this page" className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13.5px] text-muted-foreground">
              {JUMPS.map((j) => (
                <a key={j.href} href={j.href} className="hover:text-foreground">
                  {j.label}
                </a>
              ))}
            </nav>
          </div>
          <a href="#demo" aria-label="Scroll to the demo" className="absolute bottom-6 text-muted-foreground hover:text-foreground motion-safe:animate-bounce">
            <ChevronDown size={24} />
          </a>
        </section>

        {/* 2 · It is easy */}
        <Screen id="demo" label="Demo">
          <Title sub="Python, R or Claude. The same study, one line.">Load any study in one line.</Title>
          <figure className="mt-10 mx-auto max-w-[960px]">
            <div className="overflow-hidden rounded-lg border border-border shadow-[0_24px_60px_-28px_rgba(15,31,29,0.35)]">
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
          </figure>
        </Screen>

        {/* 3 · It covers your biology */}
        <Screen id="coverage" label="Coverage">
          <Title sub={stats ? `${fmtInt(stats.studies_with_files)} studies, ${fmtInt(stats.samples_in_files)} samples.` : undefined}>
            Search {facets ? fmtInt(tissues.length) : ""} tissues.
          </Title>
          <div className="mt-12 max-w-[760px] mx-auto">
            {facets ? (
              <HBars
                data={tissues.slice(0, 10).map((o) => ({ label: o.value, value: o.count, href: `/browse?tissue_group=${encodeURIComponent(o.value)}` }))}
                labelWidth="w-[130px] sm:w-[170px]"
              />
            ) : (
              <Skeleton />
            )}
          </div>
        </Screen>

        {/* 4 · It holds more than counts */}
        <Screen id="layers" label="Layers">
          <Title sub="Spliced and unspliced counts and splice junctions; other layers where the data allow.">Gene expression, plus splicing.</Title>
          <div className="mt-12">
            <ModalityGrid />
          </div>
        </Screen>

        {/* 5 · It is clean */}
        <Screen id="qc" label="Quality control">
          <Title sub="Every sample is measured. Samples below the QC cut-off are flagged and left out of counts and search by default.">Quality control on every sample.</Title>
          <div className="mt-12 max-w-[760px] mx-auto">{stats ? <QcFunnel steps={sampleFunnel(stats.accounting)} /> : <Skeleton />}</div>
        </Screen>

        {/* 6 · It is small */}
        <Screen id="format" label="File size">
          <Title sub="The same count matrix, compared with common formats.">{H5AD_RATIO.toFixed(1)}× smaller than AnnData.</Title>
          <div className="mt-12 max-w-[760px] mx-auto">
            <FormatSizeChart />
          </div>
        </Screen>

        {/* 7 · Start */}
        <Screen id="get-started" label="Get started">
          <Title sub="Pick your tool.">Load singlet into your workspace.</Title>
          <div className="mt-12">
            <GetStarted />
          </div>
        </Screen>
      </main>

      <Footer />
    </div>
  );
};

export default Index;
