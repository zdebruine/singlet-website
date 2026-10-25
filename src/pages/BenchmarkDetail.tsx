import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import NotFound from "./NotFound";
import { usePageMeta } from "@/hooks/usePageMeta";
import { findCapability } from "@/lib/benchmark-capabilities";
import { commitUrl, datasetLinks, docStatus, loadDoc, paretoOf } from "@/lib/benchmarks";
import {
  BackLink, figureSupported, FigureChart, InProgress, MetricTable, ParetoChart, ReachPanel, ResourcesTable, StateBadge,
} from "@/components/benchmarks/BenchParts";

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">{children}</h2>
);

const BenchmarkDetail = () => {
  const { capability } = useParams<{ capability: string }>();
  const cap = findCapability(capability);
  const { data: doc, isLoading } = useQuery({
    queryKey: ["benchmark", cap?.slug],
    queryFn: ({ signal }) => loadDoc(cap!.slug, signal),
    enabled: !!cap,
    staleTime: 5 * 60_000,
  });
  usePageMeta({
    title: cap ? `${cap.name} benchmark` : "Benchmark",
    description: cap?.hero ?? "",
    path: `/benchmarking/${capability ?? ""}`,
  });
  if (!cap) return <NotFound />;

  const pareto = doc ? paretoOf(doc) : null;
  const figures = (doc?.figures ?? []).filter(figureSupported).slice(0, 3);
  const panelCount = figures.length + (pareto ? 1 : 0) + (doc?.reach?.length ? 1 : 0);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container-site py-12 md:py-16">
        <BackLink />
        <header className="mt-4 max-w-3xl">
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">{cap.name}</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">{cap.hero}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!isLoading && <StateBadge state={docStatus(doc ?? null)} />}
            {doc?.status === "draft" && <span className="text-[12.5px] text-muted-foreground">Draft results</span>}
            <span className="text-[12.5px] text-muted-foreground">Compared with {cap.competitors.join(", ")}</span>
          </div>
        </header>

        {isLoading ? (
          <div className="mt-10 h-64 rounded bg-secondary animate-pulse" aria-hidden="true" />
        ) : !doc ? (
          <div className="mt-10"><InProgress name={cap.name} /></div>
        ) : (
          <>
            {panelCount > 0 && (
              <section className="mt-10 grid gap-4 lg:grid-cols-2 xl:grid-cols-3" aria-label="Comparison panels">
                {figures.map((f) => <FigureChart key={f.id} figure={f} />)}
                {pareto && <ParetoChart pareto={pareto} />}
                {doc.reach?.length ? <ReachPanel reach={doc.reach} /> : null}
              </section>
            )}

            <section className="mt-10 max-w-3xl">
              <H2>Conclusion</H2>
              <p className="text-[15px] text-foreground">{doc.conclusion}</p>
            </section>

            <section className="mt-10">
              <H2>Pass / fail</H2>
              <MetricTable metrics={doc.metrics} />
            </section>

            {doc.resources.length > 0 && (
              <section className="mt-10">
                <H2>Runtime and memory</H2>
                <p className="mb-3 max-w-2xl text-[13px] text-muted-foreground">
                  Shown for context. Runtime only counts toward pass or fail where a metric above says so.
                </p>
                <ResourcesTable resources={doc.resources} />
              </section>
            )}

            <section className="mt-10 grid gap-8 md:grid-cols-2">
              <div>
                <H2>Datasets</H2>
                <ul className="space-y-2 text-[13.5px]">
                  {doc.datasets.map((d) => (
                    <li key={d.id}>
                      <span className="text-foreground">{d.title ?? d.id}</span>
                      <span className="block text-[12.5px] text-muted-foreground">Truth: {d.truth}</span>
                      <span className="flex flex-wrap gap-x-3">
                        {datasetLinks(d).map((l) =>
                          l.internal ? (
                            <Link key={l.href} to={l.href} className="font-mono text-primary underline underline-offset-2">{l.label}</Link>
                          ) : (
                            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{l.label}</a>
                          ),
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <H2>Tools and versions</H2>
                <ul className="space-y-1 text-[13.5px]">
                  {doc.tools.map((t) => (
                    <li key={t.name}>
                      <span className="text-foreground">{t.name}</span> <span className="font-mono text-muted-foreground">{t.version}</span>
                      <span className="text-[12px] text-muted-foreground"> · {t.role}</span>
                    </li>
                  ))}
                  <li>
                    <span className="text-foreground">Singlet commit</span>{" "}
                    <a href={commitUrl(doc.singlet.commit)} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline underline-offset-2">
                      {doc.singlet.commit.slice(0, 9)}
                    </a>
                  </li>
                </ul>
              </div>
            </section>

            <section className="mt-10 max-w-3xl">
              <H2>Methods</H2>
              <p className="whitespace-pre-line text-[14px] text-muted-foreground">{doc.methods}</p>
              {doc.caveats && doc.caveats.length > 0 && (
                <ul className="mt-3 list-disc pl-5 text-[13.5px] text-muted-foreground">
                  {doc.caveats.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
            </section>

            <section className="mt-10">
              <H2>Code</H2>
              <ul className="space-y-1 text-[13.5px]">
                {doc.code.map((c) => (
                  <li key={c.url}>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
                      <span className="font-mono">{c.path}</span> <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                    {c.role && <span className="text-[12px] text-muted-foreground"> · {c.role}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[12px] text-muted-foreground">Generated {doc.generated_at.slice(0, 10)}.</p>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default BenchmarkDetail;
