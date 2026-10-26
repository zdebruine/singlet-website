import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { CAPABILITIES, GROUPS } from "@/lib/benchmark-capabilities";
import { docCounts, docStatus, loadDoc, NOTEBOOK_URL, reachMatrix, type BenchDoc } from "@/lib/benchmarks";
import { ALPHA_PENDING } from "@/lib/alpha-benchmarks";
import { BetaBanner, StateBadge } from "@/components/benchmarks/BenchParts";
import { AlphaPendingPanel, ScbcSection } from "@/components/benchmarks/AlphaParts";
import { cn } from "@/lib/utils";

const MARK = { yes: "Yes", partial: "Partial", no: "No" } as const;

/** Two separate sections: what the Alpha files measure today, and the Beta engine that will re-run them. */
const Benchmarking = () => {
  usePageMeta({
    title: "Benchmarking",
    description: "Benchmarks of singlet.bio: what the Research Alpha files measure today, and a preview of Singlet 1.0.0, the engine for the Beta re-run.",
    path: "/benchmarking",
  });
  const results = useQueries({
    queries: CAPABILITIES.map((c) => ({ queryKey: ["benchmark", c.slug], queryFn: ({ signal }: { signal: AbortSignal }) => loadDoc(c.slug, signal), staleTime: 5 * 60_000 })),
  });
  const docOf = (slug: string): BenchDoc | null => results[CAPABILITIES.findIndex((c) => c.slug === slug)]?.data ?? null;
  const entry = (slug: string) => {
    const d = docOf(slug);
    return { status: docStatus(d), ...(d ? docCounts(d) : { n_metrics: 0, n_pass: 0, n_fail: 0 }) };
  };
  const docs = results.map((q) => q.data).filter((d): d is BenchDoc => !!d);
  const reach = reachMatrix(docs);
  const passing = CAPABILITIES.filter((c) => entry(c.slug).status === "pass").length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container-site py-12 md:py-16">
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tightest text-foreground">Benchmarking</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
          Two kinds of result, kept apart. Alpha results measure the files you can download today. Beta results measure the new
          engine that will re-run the atlas. Every number is measured on real public data and shown as measured.
        </p>
        <nav aria-label="On this page" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px]">
          <a href="#alpha" className="text-primary underline underline-offset-2">Alpha: measured today</a>
          <a href="#beta" className="text-primary underline underline-offset-2">Beta preview</a>
          <Link to="/known-issues" className="text-primary underline underline-offset-2">Known issues</Link>
        </nav>

        {/* ------------------------------------------------------------- Alpha */}
        <section id="alpha" className="mt-12 scroll-mt-20" aria-labelledby="alpha-h">
          <p className="text-[12.5px] font-medium uppercase tracking-wider text-primary">Research Alpha</p>
          <h2 id="alpha-h" className="mt-1 text-[24px] md:text-[28px] font-semibold text-foreground">Alpha: measured on the data you can download today</h2>
          <p className="mt-3 max-w-3xl text-[14.5px] text-muted-foreground">
            Alpha was processed with at most 30M reads from the first run of each sample. That shows in cells and UMIs per cell.
            At equal depth, gene profiles agree with an independent pipeline. The causes and fixes are on{" "}
            <Link to="/known-issues" className="text-primary underline underline-offset-2">Known issues</Link>.
          </p>

          <ScbcSection />

          <h3 className="mt-10 text-[17px] font-semibold text-foreground">More Alpha measurements</h3>
          <p className="mt-1 max-w-3xl text-[13.5px] text-muted-foreground">Results appear here as each run finishes.</p>
          <div className="mt-4 space-y-4">
            {ALPHA_PENDING.map((p) => <AlphaPendingPanel key={p.id} id={p.id} name={p.name} what={p.what} />)}
          </div>
        </section>

        {/* ------------------------------------------------------------- Beta */}
        <section id="beta" className="mt-16 pt-10 border-t border-border scroll-mt-20" aria-labelledby="beta-h">
          <p className="text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">Beta preview</p>
          <h2 id="beta-h" className="mt-1 mb-4 text-[24px] md:text-[28px] font-semibold text-foreground">Singlet 1.0.0, the engine for the re-run</h2>
          <BetaBanner />
          <p className="max-w-2xl text-[14.5px] text-muted-foreground">
            Each capability of the Beta engine is compared with the tools people use today, on public GEO data. It has to match or
            beat them before the atlas is re-run. {passing} of {CAPABILITIES.length} pages pass so far.
          </p>
          <p className="mt-3 max-w-2xl text-[13.5px] text-muted-foreground">
            Faster tools often trade accuracy or reach for speed. Each page plots quality against runtime and lists which outputs
            each tool can produce at all.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href={NOTEBOOK_URL} download className="btn-secondary btn-sm">
              <Download className="h-4 w-4" aria-hidden="true" /> Download the notebook
            </a>
            <Link to="/beta" className="btn-secondary btn-sm">What's coming in Beta</Link>
          </div>

          {GROUPS.map((g) => (
            <section key={g} className="mt-10" aria-labelledby={`g-${g}`}>
              <h3 id={`g-${g}`} className="mb-3 text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">{g}</h3>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {CAPABILITIES.filter((c) => c.group === g).map((c) => {
                  const e = entry(c.slug);
                  return (
                    <li key={c.slug}>
                      <Link to={`/benchmarking/${c.slug}`} className="surface block h-full rounded-lg border border-border p-4 transition-colors hover:border-primary">
                        <span className="block text-[15px] font-semibold text-foreground">{c.name}</span>
                        <span className="mt-1 block text-[12.5px] text-muted-foreground">vs {c.competitors.join(", ")}</span>
                        <span className="mt-3 flex items-center justify-between gap-2">
                          {e.status === "incomplete" && e.n_metrics > 0 ? <span className="text-[12px] font-medium text-muted-foreground">Draft results</span> : <StateBadge state={e.status} />}
                          {e.n_metrics > 0 && <span className="tabular text-[12px] text-muted-foreground">{e.n_pass}/{e.n_metrics} metrics</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {reach.outputs.length > 0 && (
            <section className="mt-12" aria-labelledby="reach">
              <h3 id="reach" className="mb-1 text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">Reach</h3>
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
        </section>

        <p className="mt-14 text-[13.5px] text-muted-foreground">
          Something here looks wrong, or you want a benchmark we do not run?{" "}
          <FeedbackButton category="idea" className="text-primary underline underline-offset-2">Send feedback</FeedbackButton>
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default Benchmarking;
