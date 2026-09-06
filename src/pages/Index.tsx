import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { SearchBox } from "@/components/SearchBox";
import { CodeBlock } from "@/components/CodeBlock";
import { apiClient } from "@/integrations/api/client";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fmtCompact, fmtInt } from "@/lib/catalog-display";
import { EXAMPLE_QUERIES, searchDestination } from "@/lib/search-routing";
import { pySnippet, rSnippet } from "@/lib/install-snippets";
import { QuickStartHubs } from "@/components/QuickStartHubs";

// Install + load, from the single source of truth in lib/install-snippets.
const PY_SNIPPET = pySnippet("GSE178957");
const R_SNIPPET = rSnippet("GSE178957");

function StatSkeleton() {
  return <span className="inline-block h-8 w-20 rounded bg-secondary animate-pulse align-middle" aria-hidden="true" />;
}

const Index = () => {
  usePageMeta({ path: "/" });

  const { data: stats } = useQuery({
    queryKey: ["corpus-stats"],
    queryFn: () => apiClient.stats(),
    staleTime: 120_000,
  });
  const statItems = [
    { value: stats ? fmtInt(stats.studies_with_files) : null, label: "studies with files" },
    { value: stats ? fmtInt(stats.samples_in_files) : null, label: "samples in files" },
    { value: stats ? fmtCompact(stats.cells_in_files) : null, label: "cells called in files" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="container-site pt-16 md:pt-20 pb-10 text-center">
          <h1 className="type-display text-foreground mx-auto max-w-[760px]">
            Find single-cell data.
            <br />
            Load it in one line.
          </h1>
          <p className="mt-5 text-[17px] md:text-[19px] leading-relaxed text-muted-foreground mx-auto max-w-[720px]">
            Every public scRNA-seq study on GEO, reprocessed the same way, one file per study — Free, CC0.
          </p>

          <div className="mt-9 mx-auto max-w-[820px]">
            <SearchBox variant="hero" />
            <p className="mt-2.5 text-[13px] text-muted-foreground">
              Plain English works. So do GEO accessions (GSE…, GSM…) and keywords.
            </p>
            <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Example searches">
              {EXAMPLE_QUERIES.map((q) => (
                <li key={q}>
                  <Link to={searchDestination(q)!} className="chip">
                    {q}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px]">
              <Link to="/quickstart" className="text-primary hover:underline">New here? 5-minute quickstart →</Link>
            </p>
          </div>
        </section>

        {/* ── Live stats ── */}
        <section className="container-site pb-14" aria-label="Atlas size">
          <dl className="mx-auto max-w-[900px] grid sm:grid-cols-3 border-y border-border text-center">
            {statItems.map((s) => (
              <div key={s.label} className="py-6 sm:border-r sm:last:border-r-0 border-border">
                <dd className="font-mono font-medium text-[30px] leading-none text-foreground tabular">
                  {s.value ?? <StatSkeleton />}
                </dd>
                <dt className="mt-2 text-[13px] text-muted-foreground lowercase">{s.label}</dt>
              </div>
            ))}
          </dl>
        </section>

        {/* ── Start from ── */}
        <section className="container-site pb-16">
          <QuickStartHubs title="Or start from" />
        </section>

        <section className="container-site pb-16" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="type-h2 mb-6">How it works</h2>
          <ol className="grid md:grid-cols-3 border-y border-border">
            {[
              ["01", "Find a study", "Search by tissue, disease, cell type, organism, assay, or GEO accession."],
              ["02", "Check the file", "Review sample-level QC, reference build, provenance, and exact file contents."],
              ["03", "Load it", "pip install singlet · singlet.load(\"GSE178957\")"],
            ].map(([n, title, copy]) => (
              <li key={n} className="py-6 md:px-6 md:first:pl-0 md:border-r md:last:border-r-0 border-border">
                <span className="type-mono text-primary">{n}</span>
                <h3 className="type-h3 mt-2">{title}</h3>
                <p className={n === "03" ? "type-mono mt-2 text-muted-foreground" : "type-small mt-2 text-muted-foreground"}>{copy}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Install / load ── */}
        <section className="container-site pb-20">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="surface p-4">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-[17px] font-display">Python</h2>
                <Link to="/docs#python" className="text-[13px] text-primary hover:underline">Python API →</Link>
              </div>
              <CodeBlock code={PY_SNIPPET} label="python" />
            </div>
            <div className="surface p-4">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-[17px] font-display">R</h2>
                <Link to="/docs#r" className="text-[13px] text-primary hover:underline">R package →</Link>
              </div>
              <CodeBlock code={R_SNIPPET} label="r" />
            </div>
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground">
            One <code className="code-inline">.singlet</code> file per study, free to download, no account. Data is CC0; code is MIT.{" "}
            <Link to="/about" className="text-primary hover:underline">How the data is processed →</Link>
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Index;
