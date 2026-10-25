import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";
import { CAPABILITIES, GROUPS } from "@/lib/benchmark-capabilities";
import { capabilityState, loadResult, metricState, NOTEBOOK_URL } from "@/lib/benchmarks";
import { CapabilityState_ } from "@/components/benchmarks/BenchParts";

const Benchmarking = () => {
  usePageMeta({
    title: "Benchmarks",
    description: "How each Singlet pipeline capability compares with the tools it replaces.",
    path: "/benchmarking",
  });
  const queries = useQueries({
    queries: CAPABILITIES.map((c) => ({
      queryKey: ["benchmark", c.slug],
      queryFn: ({ signal }: { signal: AbortSignal }) => loadResult(c.slug, signal),
      staleTime: 5 * 60_000,
    })),
  });
  const results = Object.fromEntries(CAPABILITIES.map((c, i) => [c.slug, queries[i].data ?? null]));
  const passing = CAPABILITIES.filter((c) => capabilityState(results[c.slug]) === "passing").length;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container-site py-12 md:py-16">
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">Benchmarks</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
          Every capability of the Singlet pipeline is compared with the tools people use today, on public GEO data.
          Singlet has to match or beat them before the full atlas is re-run. {passing} of {CAPABILITIES.length} pages pass.
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
                const r = results[c.slug];
                const done = r?.metrics.filter((m) => metricState(m) === "pass").length ?? 0;
                return (
                  <li key={c.slug}>
                    <Link to={`/benchmarking/${c.slug}`} className="surface block h-full rounded-lg border border-border p-4 transition-colors hover:border-primary">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[15px] font-semibold text-foreground">{c.name}</h3>
                      </div>
                      <p className="mt-1 text-[12.5px] text-muted-foreground">vs {c.competitors.join(", ")}</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <CapabilityState_ result={r} />
                        {r && <span className="tabular text-[12px] text-muted-foreground">{done}/{r.metrics.length} metrics</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
      <Footer />
    </div>
  );
};

export default Benchmarking;
