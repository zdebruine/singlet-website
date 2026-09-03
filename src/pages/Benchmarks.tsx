import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Link } from "react-router-dom";
import { Zap, Cpu, CheckCircle2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useGPUFrontier } from "@/hooks/useDatabase";

const FEATURES = [
  { id: "pz_device_loader", name: ".1pz → GPU CSC", desc: "Zero-copy device loading" },
  { id: "lognorm", name: "Log-Normalization", desc: "Total-count + log1p" },
  { id: "hvg", name: "HVG Selection", desc: "Seurat v3 VST + Pearson residuals" },
  { id: "pca", name: "PCA / SVD", desc: "Randomized SVD via factornet" },
  { id: "nmf", name: "NMF", desc: "Non-negative matrix factorization" },
  { id: "qc", name: "QC Metrics", desc: "Genes, UMIs, MT%, doublets" },
  { id: "scale", name: "Scaling", desc: "Zero-mean unit-variance + regress_out" },
  { id: "knn", name: "kNN Graph", desc: "CAGRA/brute-force nearest neighbors" },
  { id: "leiden", name: "Leiden Clustering", desc: "Community detection on SNN graph" },
  { id: "umap", name: "UMAP", desc: "Uniform manifold approximation" },
  { id: "de", name: "DE Analysis", desc: "Wilcoxon, t-test, pseudobulk GLM" },
  { id: "integration", name: "Batch Integration", desc: "Harmony, BBKNN" },
];

function SpeedupBar({ speedup }: { speedup: number | null }) {
  if (!speedup) return <span className="text-muted-foreground/40">—</span>;
  const width = Math.min((Math.log2(speedup) / Math.log2(512)) * 100, 100);
  const color = speedup >= 100 ? "#10b981" : speedup >= 10 ? "#3b82f6" : speedup >= 2 ? "#8b5cf6" : "#6b7280";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-xs font-bold min-w-[48px] text-right" style={{ color }}>{speedup.toFixed(1)}×</span>
    </div>
  );
}

const Benchmarks = () => {
  interface FrontierEntry {
    feature: string;
    speedup?: number | null;
    wall_ms?: number | null;
    sota_wall_ms?: number | null;
    correctness_r?: number | null;
    sota_tool?: string | null;
  }
  const { data: frontierRaw, isLoading } = useGPUFrontier();
  const frontier = (frontierRaw ?? []) as FrontierEntry[];

  // Group by feature, take latest entry per feature
  const featureData = FEATURES.map((f) => {
    const entries = frontier.filter((e) => e.feature === f.id);
    const latest = entries[0]; // already sorted by measured_date DESC
    return { ...f, latest, entries };
  });

  // Chart data for the overview
  const chartData = featureData
    .filter((f) => f.latest?.speedup)
    .map((f) => ({
      name: f.name,
      speedup: f.latest!.speedup!,
      feature: f.id,
    }))
    .sort((a, b) => b.speedup - a.speedup);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest mb-2">
              GPU Benchmarks
            </h1>
            <p className="text-muted-foreground">
              singlet-gpu Pareto frontier — every kernel benchmarked against Scanpy, rapids-singlecell, cuml, and other SOTA.
              Correctness-verified on real GEO data before frontier promotion.
            </p>
          </div>

          {/* Overview chart */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6 mb-8">
              <h2 className="font-display text-lg font-bold text-foreground mb-4">Speedup vs SOTA</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 120 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(1)}×`, "Speedup"]} />
                    <Bar dataKey="speedup" radius={[0, 4, 4, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.speedup >= 100 ? "#10b981" : entry.speedup >= 10 ? "#3b82f6" : "#8b5cf6"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Feature table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Feature</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground w-48">Speedup</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Wall (ms)</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">SOTA (ms)</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Correctness</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">vs.</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {featureData.map((f) => (
                    <tr key={f.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{f.name}</div>
                        <div className="text-xs text-muted-foreground">{f.desc}</div>
                      </td>
                      <td className="px-4 py-3">
                        <SpeedupBar speedup={f.latest?.speedup ?? null} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {f.latest?.wall_ms?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {f.latest?.sota_wall_ms?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {f.latest?.correctness_r != null ? (
                          <span className={f.latest.correctness_r >= 0.999 ? "text-emerald-600" : "text-amber-600"}>
                            r={f.latest.correctness_r.toFixed(4)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {f.latest?.sota_tool ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {f.latest ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                            <CheckCircle2 size={12} /> Frontier
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-6 flex items-center gap-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-500" /> ≥100× SOTA</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500" /> 10–100× SOTA</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-violet-500" /> 2–10× SOTA</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-400" /> &lt;2× SOTA</span>
          </div>

          {/* Cross links */}
          <div className="mt-6 flex flex-wrap gap-4 text-sm">
            <Link to="/validation" className="text-emerald-500 hover:underline">E2E Validation →</Link>
            <Link to="/pipeline" className="text-emerald-500 hover:underline">Pipeline Dashboard →</Link>
            <Link to="/notebooks" className="text-emerald-500 hover:underline">Notebooks →</Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Benchmarks;
