import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Link, useNavigate } from "react-router-dom";
import { Database, Activity, Server, Clock } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useCorpusStats, useSpeciesStats, useStatusBreakdown, useFailureCategoryStats, useProtocolStats, useSpeciesSuccessStats, useLastUpdated } from "@/hooks/useDatabase";

const SPECIES_COLORS = [
  "hsl(174, 84%, 32%)", "hsl(200, 70%, 55%)", "hsl(152, 60%, 45%)",
  "hsl(38, 80%, 55%)", "hsl(265, 50%, 55%)", "hsl(0, 0%, 55%)",
  "hsl(320, 60%, 50%)", "hsl(45, 80%, 50%)",
];

const FAILURE_COLORS = [
  "hsl(0, 65%, 50%)", "hsl(25, 80%, 50%)", "hsl(45, 80%, 50%)",
  "hsl(200, 60%, 50%)", "hsl(280, 50%, 55%)", "hsl(160, 50%, 45%)",
  "hsl(340, 60%, 50%)", "hsl(0, 0%, 55%)",
];

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

const Pipeline = () => {
  const navigate = useNavigate();
  const { data: stats, isLoading: statsLoading } = useCorpusStats();
  const { data: speciesData, isLoading: speciesLoading } = useSpeciesStats();
  const { data: breakdown } = useStatusBreakdown();
  const { data: failureCategories } = useFailureCategoryStats();
  const { data: protocolData } = useProtocolStats();
  const { data: speciesSuccessData } = useSpeciesSuccessStats();
  const { data: lastUpdated } = useLastUpdated();

  const chartData = (speciesData ?? []).slice(0, 8).map((s) => ({
    name: s.organism?.replace(/^(\w)\w+\s/, "$1. ") ?? "Unknown",
    fullOrganism: s.organism ?? "",
    cells: s.total_cells ?? 0,
    samples: s.sample_count ?? 0,
  }));

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest">
                Pipeline Dashboard
              </h1>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </span>
            </div>
            <p className="text-muted-foreground">
              Live status of the singlet mass-reprocessing pipeline. Every GEO single-cell sample uniformly processed with singlet.
            </p>
            {lastUpdated && (
              <p className="text-xs text-muted-foreground/60 mt-1">
                Last synced: {new Date(lastUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            )}
          </div>

          {/* Run-it-yourself quickstart */}
          <div className="mb-8 rounded-xl border border-border bg-card p-6">
            <h2 className="font-display text-xl font-semibold text-foreground mb-2">
              Run the pipeline yourself
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              One call, from any SRA accession or URL to the canonical output layout.
              Same entry point from the CLI and Python.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">CLI</div>
                <pre className="text-xs rounded-md bg-muted/40 p-3 overflow-x-auto"><code>{`pip install singlet

singlet-process SRR11537951 \\
    --output-dir ./out \\
    --organism human \\
    --threads 8 --nonhost`}</code></pre>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Python</div>
                <pre className="text-xs rounded-md bg-muted/40 p-3 overflow-x-auto"><code>{`from singlet.pipeline import run
from singlet.io import SingletSample
from singlet.views import gene_counts, usa

result = run("SRR11537951", "./out",
             organism="human", threads=8)

sample = SingletSample(result.output_dir)
X = gene_counts(sample)         # genes × cells
trio = usa(sample)              # spliced / unspliced / ambiguous`}</code></pre>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Full reference:{" "}
              <a href="https://singlet.bio/docs/pipeline.html" className="underline hover:text-foreground">
                Running the pipeline
              </a>{" "}
              ·{" "}
              <a href="https://singlet.bio/docs/CANONICAL_OUTPUT_FORMAT.html" className="underline hover:text-foreground">
                Canonical output format
              </a>{" "}
              ·{" "}
              <a href="https://github.com/Singlet-Bio/singlet/blob/main/notebooks/pipeline_quickstart.ipynb" className="underline hover:text-foreground">
                Quickstart notebook
              </a>
            </p>
          </div>

          {/* Primary stats */}
          {statsLoading ? (
            <div className="text-center text-muted-foreground py-12">Loading corpus stats...</div>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <Database size={20} className="mx-auto text-primary mb-2" />
                  <div className="text-3xl font-bold text-foreground font-display">{formatNumber(stats.total_cells)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Total Cells</div>
                </div>
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <Activity size={20} className="mx-auto text-primary mb-2" />
                  <div className="text-3xl font-bold text-foreground font-display">{formatNumber(stats.success_samples)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Samples Processed</div>
                </div>
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <Server size={20} className="mx-auto text-primary mb-2" />
                  <div className="text-3xl font-bold text-foreground font-display">{formatNumber(stats.species_count)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Species</div>
                </div>
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <Clock size={20} className="mx-auto text-primary mb-2" />
                  <div className="text-3xl font-bold text-foreground font-display">
                    {stats.success_rate ? `${(stats.success_rate * 100).toFixed(1)}%` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Success Rate</div>
                </div>
              </div>

              {/* Secondary stats */}
              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <div className="text-lg font-bold text-foreground">{formatNumber(stats.series_count)}</div>
                  <div className="text-xs text-muted-foreground">GEO Series</div>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <div className="text-lg font-bold text-foreground">
                    {stats.avg_mapping_rate ? `${(Number(stats.avg_mapping_rate) * 100).toFixed(1)}%` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">Avg Mapping Rate</div>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <div className="text-lg font-bold text-foreground">{formatNumber(Number(stats.avg_median_genes))}</div>
                  <div className="text-xs text-muted-foreground">Avg Median Genes/Cell</div>
                </div>
              </div>
            </>
          ) : null}

          {/* Species breakdown chart */}
          {!speciesLoading && chartData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6 mb-8">
              <h2 className="font-display text-lg font-bold text-foreground mb-4">Species Breakdown</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(v)} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={75} />
                    <Tooltip formatter={(v: number) => [formatNumber(v), "Cells"]} />
                    <Bar dataKey="cells" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(data) => {
                      if (data?.fullOrganism) navigate(`/browse?organism=${encodeURIComponent(data.fullOrganism)}`);
                    }}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={SPECIES_COLORS[i % SPECIES_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Failure categories chart */}
          {failureCategories && failureCategories.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6 mb-8">
              <h2 className="font-display text-lg font-bold text-foreground mb-4">Failure Categories</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={failureCategories.slice(0, 8).map((f) => ({
                      name: f.category.replace(/_/g, " "),
                      count: f.count,
                    }))}
                    layout="vertical"
                    margin={{ left: 120 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={115} />
                    <Tooltip formatter={(v: number) => [v.toLocaleString(), "Samples"]} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {failureCategories.slice(0, 8).map((_, i) => (
                        <Cell key={i} fill={FAILURE_COLORS[i % FAILURE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Protocol success rates */}
          {protocolData && protocolData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6 mb-8">
              <h2 className="font-display text-lg font-bold text-foreground mb-4">Protocol Success Rates</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={protocolData.slice(0, 12).map((p) => ({
                      name: p.protocol,
                      rate: Math.round(p.rate * 100),
                      total: p.total,
                    }))}
                    layout="vertical"
                    margin={{ left: 100 }}
                  >
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={95} />
                    <Tooltip formatter={(v: number, _name: string, entry: { payload: { total: number } }) => [`${v}% (${entry.payload.total} samples)`, "Success"]} />
                    <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                      {protocolData.slice(0, 12).map((p, i) => (
                        <Cell key={i} fill={p.rate >= 0.5 ? "hsl(152, 60%, 45%)" : p.rate >= 0.25 ? "hsl(38, 80%, 55%)" : "hsl(0, 60%, 55%)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Only protocols with ≥5 samples shown. Color: green ≥50%, amber ≥25%, red &lt;25%.</p>
            </div>
          )}

          {/* Species success rates */}
          {speciesSuccessData && speciesSuccessData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6 mb-8">
              <h2 className="font-display text-lg font-bold text-foreground mb-4">Species Success Rates</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={speciesSuccessData.map((s) => ({
                      name: s.organism.replace(/^(\w)\w+\s/, "$1. "),
                      rate: Math.round(s.rate * 100),
                      total: s.total,
                      success: s.success,
                    }))}
                    layout="vertical"
                    margin={{ left: 100 }}
                  >
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={95} />
                    <Tooltip formatter={(v: number, _name: string, entry: { payload: { total: number; success: number } }) => [`${v}% (${entry.payload.success}/${entry.payload.total})`, "Success"]} />
                    <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                      {speciesSuccessData.map((s, i) => (
                        <Cell key={i} fill={s.rate >= 0.5 ? "hsl(152, 60%, 45%)" : s.rate >= 0.25 ? "hsl(38, 80%, 55%)" : "hsl(0, 60%, 55%)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Color: green ≥50%, amber ≥25%, red &lt;25%.</p>
            </div>
          )}

          {/* Progress bar */}
          {stats && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="font-display text-lg font-bold text-foreground mb-4">Processing Progress</h2>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  {formatNumber(stats.total_samples)} samples across {formatNumber(stats.series_count)} series
                </span>
                <span className="text-sm font-mono text-foreground">
                  {stats.success_rate ? `${(Number(stats.success_rate) * 100).toFixed(1)}%` : "0%"} success
                </span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden flex">
                {breakdown && stats?.total_samples ? (
                  <>
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${(breakdown.done / Number(stats.total_samples)) * 100}%` }}
                      title={`DONE: ${breakdown.done}`}
                    />
                    <div
                      className="h-full bg-red-500/70 transition-all"
                      style={{ width: `${(breakdown.failed / Number(stats.total_samples)) * 100}%` }}
                      title={`FAIL: ${breakdown.failed}`}
                    />
                  </>
                ) : (
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${stats?.total_samples ? (Number(stats.success_samples) / Number(stats.total_samples)) * 100 : 0}%` }}
                  />
                )}
              </div>
              <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> DONE{breakdown ? ` (${breakdown.done})` : ""}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/70" /> FAIL{breakdown ? ` (${breakdown.failed})` : ""}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                Uniformly reprocessing every human droplet-based and spatially-resolved single-cell sequencing dataset on GEO
                using the singlet pipeline. Data auto-syncs every 15 minutes.
              </p>
              <div className="flex gap-4 mt-4">
                <Link to="/browse" className="text-xs text-primary hover:underline">Browse all samples →</Link>
                <Link to="/atlas-docs" className="text-xs text-primary hover:underline">Atlas API docs →</Link>
                <Link to="/validation" className="text-xs text-primary hover:underline">Validation results →</Link>
                <Link to="/notebooks" className="text-xs text-primary hover:underline">Reproducibility notebooks →</Link>
              </div>
            </div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Pipeline;
