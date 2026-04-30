import { CheckCircle2, XCircle, AlertTriangle, FlaskConical, GitBranch, Dna, Activity } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useE2EResults } from "@/hooks/useDatabase";

const PANELS = [
  { id: "A", name: "Gene Counting", tool: "STARsolo", desc: "Spliced exon UMI counts vs STARsolo" },
  { id: "B", name: "Donor Demux", tool: "cellsnp-lite + vireo", desc: "Genetic demultiplexing accuracy" },
  { id: "C", name: "ATAC Fragments", tool: "cellranger-atac", desc: "Fragment file concordance" },
  { id: "D", name: "CITE-seq ADT", tool: "CITE-seq-Count", desc: "Antibody tag quantification" },
  { id: "E", name: "alevin-fry Equiv", tool: "salmon + alevin-fry", desc: "Alternative mapper equivalence" },
  { id: "F", name: "Sex Calling", tool: "XIST/Y CPM", desc: "XIST/Y-linked gene sex inference" },
  { id: "G", name: "Ambient RNA", tool: "SoupX", desc: "Ambient contamination correction" },
  { id: "H", name: "Doublet Detection", tool: "Scrublet", desc: "Doublet scoring concordance" },
  { id: "I", name: "Non-Host", tool: "Kraken2", desc: "Viral/microbial detection" },
];

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PASS":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600">
          <CheckCircle2 size={12} /> PASS
        </span>
      );
    case "WARN":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600">
          <AlertTriangle size={12} /> WARN
        </span>
      );
    case "FAIL":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-600">
          <XCircle size={12} /> FAIL
        </span>
      );
    default:
      return <span className="text-xs text-muted-foreground">{status}</span>;
  }
}

function MetricBar({ value, threshold, status }: { value: number; threshold: number; status: string }) {
  const pct = Math.min((value / Math.max(threshold * 1.2, 0.01)) * 100, 100);
  const color = status === "PASS" ? "#10b981" : status === "WARN" ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function formatMetric(v: number): string {
  if (v >= 10) return v.toFixed(v % 1 === 0 ? 0 : 2);
  if (v >= 1) return v.toFixed(v % 1 === 0 ? 0 : 4);
  return v.toFixed(4);
}

function formatThreshold(t: number): string {
  if (t >= 10) return `≥${t.toFixed(t % 1 === 0 ? 0 : 1)}`;
  if (t >= 1) return `≥${t.toFixed(t % 1 === 0 ? 0 : 2)}`;
  return `≥${t.toFixed(t >= 0.1 ? 2 : 3)}`;
}

const Validation = () => {
  // Always fetch ALL results so panel overview cards are accurate
  const { data: results, isLoading } = useE2EResults();

  // Group by panel
  const byPanel: Record<string, NonNullable<typeof results>> = {};
  for (const r of results ?? []) {
    (byPanel[r.panel] ??= []).push(r);
  }

  // Summary counts
  const total = results?.length ?? 0;
  const pass = results?.filter((r) => r.status === "PASS").length ?? 0;
  const warn = results?.filter((r) => r.status === "WARN").length ?? 0;
  const fail = results?.filter((r) => r.status === "FAIL").length ?? 0;
  const panelsCovered = Object.keys(byPanel).length;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest">
                E2E Validation
              </h1>
              <FlaskConical className="text-emerald-500" size={24} />
            </div>
            <p className="text-muted-foreground">
              Formal equivalence testing of singlet against gold-standard tools. Every metric is
              computed on real GEO data — not synthetic benchmarks.{" "}
              <Link to="/notebooks" className="text-emerald-500 hover:underline">
                Reproducibility notebooks →
              </Link>
            </p>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-2xl font-bold text-foreground">{isLoading ? "—" : total}</div>
              <div className="text-xs text-muted-foreground">Total metrics</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-2xl font-bold text-emerald-600">{isLoading ? "—" : pass}</div>
              <div className="text-xs text-muted-foreground">Passing</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-2xl font-bold text-amber-600">{isLoading ? "—" : warn}</div>
              <div className="text-xs text-muted-foreground">Warning</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-2xl font-bold text-red-600">{isLoading ? "—" : fail}</div>
              <div className="text-xs text-muted-foreground">Failing</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-2xl font-bold text-foreground">{isLoading ? "—" : `${panelsCovered}/${PANELS.length}`}</div>
              <div className="text-xs text-muted-foreground">Panels covered</div>
            </div>
          </div>

          {/* Panel overview grid */}
          <div className="grid md:grid-cols-3 gap-4 mb-10">
            {PANELS.map((panel) => {
              const panelResults = byPanel[panel.id];
              const count = panelResults?.length ?? 0;
              const hasPass = panelResults?.some((r) => r.status === "PASS");
              const hasWarn = panelResults?.some((r) => r.status === "WARN");
              const hasFail = panelResults?.some((r) => r.status === "FAIL");
              return (
                <div
                  key={panel.id}
                  className={`rounded-xl border p-4 ${
                    count === 0
                      ? "border-border/50 bg-card/50 opacity-60"
                      : hasFail
                      ? "border-red-500/20 bg-red-500/5"
                      : hasWarn
                      ? "border-amber-500/20 bg-amber-500/5"
                      : "border-emerald-500/20 bg-emerald-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-muted-foreground">Panel {panel.id}</span>
                    {count > 0 ? (
                      <span className="text-xs font-medium">
                        {panelResults?.filter((r) => r.status === "PASS").length}/{count} pass
                      </span>
                    ) : (
                      <Activity size={14} className="text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="font-display font-bold text-foreground">{panel.name}</div>
                  <div className="text-xs text-muted-foreground mb-2">{panel.desc}</div>
                  <div className="text-xs text-muted-foreground">vs. {panel.tool}</div>
                </div>
              );
            })}
          </div>

          {/* Detailed results per panel */}
          {Object.entries(byPanel)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([panel, panelResults]) => {
              const info = PANELS.find((p) => p.id === panel);
              return (
                <div key={panel} className="mb-8">
                  <h2 className="font-display text-xl font-bold text-foreground mb-1 flex items-center gap-2">
                    <Dna size={18} className="text-emerald-500" />
                    Panel {panel}: {info?.name ?? panel}
                  </h2>
                  <p className="text-sm text-muted-foreground mb-3">
                    {info?.desc} &middot; vs. {info?.tool}
                  </p>
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Metric</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">Value</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">Threshold</th>
                          <th className="px-4 py-3 font-medium text-muted-foreground w-36" />
                          <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                            <GitBranch size={12} className="inline" /> Commit
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Sample</th>
                        </tr>
                      </thead>
                      <tbody>
                        {panelResults
                          .sort((a, b) => a.metric_name.localeCompare(b.metric_name))
                          .map((r) => (
                            <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="px-4 py-2.5 font-medium text-foreground">
                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{r.metric_name}</code>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs font-bold">
                                {formatMetric(r.metric_value)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                                {formatThreshold(r.threshold)}
                              </td>
                              <td className="px-4 py-2.5">
                                <MetricBar value={r.metric_value} threshold={r.threshold} status={r.status} />
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <StatusBadge status={r.status} />
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                                {r.singlet_commit.slice(0, 7)}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                                {r.sample_srr}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

          {/* Empty state */}
          {!isLoading && total === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              No validation results yet. Check back soon.
            </div>
          )}

          {/* Methodology note */}
          <div className="mt-12 rounded-xl border border-border bg-muted/30 p-6">
            <h3 className="font-display font-bold text-foreground mb-2">Methodology</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>&bull; Each metric is computed on real GEO samples, not synthetic data</li>
              <li>&bull; Both singlet and the reference tool process the same FASTQ reads</li>
              <li>&bull; PASS: meets or exceeds threshold. WARN: within 5%. FAIL: below threshold</li>
              <li>&bull; All validation runs are reproducible via our{" "}
                <Link to="/notebooks" className="text-emerald-500 hover:underline">Jupyter notebooks</Link>
              </li>
              <li>&bull; Cell Jaccard failures are expected when singlet calls more cells (EmptyDrops vs knee-point)</li>
            </ul>
          </div>

          {/* Cross links */}
          <div className="mt-6 flex flex-wrap gap-4 text-sm">
            <Link to="/benchmarks" className="text-emerald-500 hover:underline">GPU Benchmarks →</Link>
            <Link to="/pipeline" className="text-emerald-500 hover:underline">Pipeline Dashboard →</Link>
            <Link to="/atlas-docs" className="text-emerald-500 hover:underline">Atlas API docs →</Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Validation;
