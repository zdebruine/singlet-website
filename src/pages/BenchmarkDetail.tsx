import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import NotFound from "./NotFound";
import { usePageMeta } from "@/hooks/usePageMeta";
import { findCapability } from "@/lib/benchmark-capabilities";
import { commitUrl, datasetUrl, loadResult, REPO_URL } from "@/lib/benchmarks";
import { BackLink, CapabilityState_, InProgress, MetricTable, PanelChart } from "@/components/benchmarks/BenchParts";

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">{children}</h2>
);

const BenchmarkDetail = () => {
  const { capability } = useParams<{ capability: string }>();
  const cap = findCapability(capability);
  const { data: result, isLoading } = useQuery({
    queryKey: ["benchmark", cap?.slug],
    queryFn: ({ signal }) => loadResult(cap!.slug, signal),
    enabled: !!cap,
    staleTime: 5 * 60_000,
  });
  usePageMeta({
    title: cap ? `${cap.name} benchmark` : "Benchmark",
    description: cap?.hero ?? "",
    path: `/benchmarking/${capability ?? ""}`,
  });
  if (!cap) return <NotFound />;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container-site py-12 md:py-16">
        <BackLink />
        <header className="mt-4 max-w-3xl">
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">{cap.name}</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">{cap.hero}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!isLoading && <CapabilityState_ result={result ?? null} />}
            <span className="text-[12.5px] text-muted-foreground">Compared with {cap.competitors.join(", ")}</span>
          </div>
        </header>

        {isLoading ? (
          <div className="mt-10 h-64 rounded bg-secondary animate-pulse" aria-hidden="true" />
        ) : !result ? (
          <div className="mt-10"><InProgress name={cap.name} /></div>
        ) : (
          <>
            <section className="mt-10 grid gap-4 lg:grid-cols-2 xl:grid-cols-3" aria-label="Comparison panels">
              {result.panels.slice(0, 3).map((p) => <PanelChart key={p.id} panel={p} />)}
            </section>

            <section className="mt-10 max-w-3xl">
              <H2>Conclusion</H2>
              <p className="text-[15px] text-foreground">{result.conclusion}</p>
            </section>

            <section className="mt-10">
              <H2>Pass / fail</H2>
              <MetricTable metrics={result.metrics} />
            </section>

            <section className="mt-10 grid gap-8 md:grid-cols-2">
              <div>
                <H2>Datasets</H2>
                <ul className="space-y-1 text-[13.5px]">
                  {result.datasets.map((d) => (
                    <li key={d.accession}>
                      <Link to={datasetUrl(d.accession)} className="font-mono text-primary underline underline-offset-2">{d.accession}</Link>
                      {d.label && <span className="text-muted-foreground"> · {d.label}</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <H2>Tools and version</H2>
                <ul className="space-y-1 text-[13.5px]">
                  {result.tools.map((t) => (
                    <li key={t.name}><span className="text-foreground">{t.name}</span> <span className="font-mono text-muted-foreground">{t.version}</span></li>
                  ))}
                  <li>
                    <span className="text-foreground">Singlet</span>{" "}
                    <a href={commitUrl(result.singlet_commit)} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline underline-offset-2">
                      {result.singlet_commit.slice(0, 9)}
                    </a>
                  </li>
                </ul>
              </div>
            </section>

            <section className="mt-10 max-w-3xl">
              <H2>Methods</H2>
              <p className="whitespace-pre-line text-[14px] text-muted-foreground">{result.methods}</p>
            </section>

            <section className="mt-10">
              <H2>Code</H2>
              <ul className="space-y-1 text-[13.5px]">
                {(result.code?.length ? result.code : [{ label: "Singlet repository", path: "" }]).map((c) => (
                  <li key={c.path + c.label}>
                    <a href={c.path ? `${REPO_URL}/blob/${result.singlet_commit}/${c.path}` : REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
                      {c.label} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[12px] text-muted-foreground">Generated {result.generated_at.slice(0, 10)}.</p>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default BenchmarkDetail;
