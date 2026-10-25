import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";
import { CAPABILITIES, GROUPS } from "@/lib/benchmark-capabilities";
import { loadDoc, loadIndex, NOTEBOOK_URL, reachMatrix, type BenchDoc, type BenchIndexEntry } from "@/lib/benchmarks";
import { StateBadge } from "@/components/benchmarks/BenchParts";
import { cn } from "@/lib/utils";

const MARK = { yes: "Yes", partial: "Partial", no: "No" } as const;

const Benchmarking = () => {
  usePageMeta({
    title: "Benchmarks",
    description: "How each Singlet pipeline capability compares with the tools it replaces.",
    path: "/benchmarking",
  });
  const { data: index } = useQuery({ queryKey: ["benchmark-index"], queryFn: ({ signal }) => loadIndex(signal), staleTime: 5 * 60_000 });
  const entry = (slug: string): BenchIndexEntry | undefined => index?.capabilities.find((c) => c.capability === slug);
  const published = CAPABILITIES.filter((c) => {
    const s = entry(c.slug)?.status;
    return s && s !== "missing" && s !== "invalid";
  });
  const docs = useQueries({
    queries: published.map((c) => ({ queryKey: ["benchmark", c.slug], queryFn: ({ signal }: { signal: AbortSignal }) => loadDoc(c.slug, signal), staleTime: 5 * 60_000 })),
  })
    .map((q) => q.data)
    .filter((d): d is BenchDoc => !!d);
  const reach = reachMatrix(docs);
  const passing = CAPABILITIES.filter((c) => entry(c.slug)?.status === "pass").length;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container-site py-12 md:py-16">
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">Benchmarks</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
          Every capability of the Singlet pipeline is compared with the tools people use today, on public GEO data.
          Singlet has to match or beat them before the full atlas is re-run. {passing} of {CAPABILITIES.length} pages pass.
        </p>
        <p className="mt-3 max-w-2xl text-[13.5px] text-muted-foreground">
          Faster tools often trade accuracy or reach for speed. Each page plots quality against runtime and lists which outputs each tool can produce at all, so Singlet is judged on the frontier, not on speed alone.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={NOTEBOOK_URL} download className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-[13px] font-medium text-foreground hover:border-primary">
            <Download className="h-4 w-4" aria-hidden="true" /> Download the notebook
          </a>
          <Link to="/roadmap" className="inline-flex items-center rounded border border-border px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground">
            Roadmap to Singlet 1.0.0
          </Link>
        </div>

        {GROUPS.map((g) => (
          <section key={g} className="mt-10" aria-labelledby={`g-${g}`}>
            <h2 id={`g-${g}`} className="mb-3 text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">{g}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.filter((c) => c.group === g).map((c) => {
                const e = entry(c.slug);
                return (
                  <li key={c.slug}>
                    <Link to={`/benchmarking/${c.slug}`} className="surface block h-full rounded-lg border border-border p-4 transition-colors hover:border-primary">
                      <h3 className="text-[15px] font-semibold text-foreground">{c.name}</h3>
                      <p className="mt-1 text-[12.5px] text-muted-foreground">vs {c.competitors.join(", ")}</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <StateBadge state={e?.status ?? "missing"} />
                        {e && e.n_metrics > 0 && <span className="tabular text-[12px] text-muted-foreground">{e.n_pass}/{e.n_metrics} metrics</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {reach.outputs.length > 0 && (
          <section className="mt-12" aria-labelledby="reach">
            <h2 id="reach" className="mb-1 text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">Reach</h2>
            <p className="mb-3 text-[13.5px] text-muted-foreground">Which outputs each tool can produce at all.</p>
            <div className="overflow-x-auto">
              <table className="text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted-foreground"><th className="py-1 pr-4 font-medium">Output</th>{reach.tools.map((t) => <th key={t} className="py-1 pr-4 font-medium">{t}</th>)}</tr>
                </thead>
                <tbody>
                  {reach.outputs.map((o) => (
                    <tr key={o.capability + o.output} className="border-t border-border/60">
                      <td className="py-1.5 pr-4 text-foreground">{o.output}</td>
                      {reach.tools.map((t) => {
                        const v = reach.cell(t, o.capability, o.output);
                        return <td key={t} className={cn("py-1.5 pr-4", v === "yes" ? "text-primary" : "text-muted-foreground")}>{v ? MARK[v] : "n/a"}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Benchmarking;
