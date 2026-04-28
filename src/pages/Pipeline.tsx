import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Database, Activity, Server, Clock } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useCorpusStats, useSpeciesStats } from "@/hooks/useDatabase";

const SPECIES_COLORS = [
  "hsl(174, 84%, 32%)", "hsl(200, 70%, 55%)", "hsl(152, 60%, 45%)",
  "hsl(38, 80%, 55%)", "hsl(265, 50%, 55%)", "hsl(0, 0%, 55%)",
  "hsl(320, 60%, 50%)", "hsl(45, 80%, 50%)",
];

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

const Pipeline = () => {
  const { data: stats, isLoading: statsLoading } = useCorpusStats();
  const { data: speciesData, isLoading: speciesLoading } = useSpeciesStats();

  const chartData = (speciesData ?? []).slice(0, 8).map((s) => ({
    name: s.organism?.replace(/^(\w)\w+\s/, "$1. ") ?? "Unknown",
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
                    <Bar dataKey="cells" radius={[0, 4, 4, 0]}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={SPECIES_COLORS[i % SPECIES_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Progress bar */}
          {stats && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="font-display text-lg font-bold text-foreground mb-4">Processing Progress</h2>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  {formatNumber(stats.success_samples)} of {formatNumber(stats.total_samples)} samples
                </span>
                <span className="text-sm font-mono text-foreground">
                  {stats.total_samples ? ((Number(stats.success_samples) / Number(stats.total_samples)) * 100).toFixed(1) : 0}%
                </span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${stats.total_samples ? (Number(stats.success_samples) / Number(stats.total_samples)) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                Uniformly reprocessing every human droplet-based and spatially-resolved single-cell sequencing dataset on GEO
                using the singlet pipeline. Data auto-syncs every 15 minutes.
              </p>
            </div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Pipeline;
