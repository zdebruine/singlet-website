import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useE2EResults } from "@/hooks/useDatabase";

const PANELS = [
  { id: "A", name: "Gene Counting", tool: "STARsolo", desc: "Spliced/unspliced UMI counts vs STARsolo" },
  { id: "B", name: "Donor Demux", tool: "cellsnp-lite + vireo", desc: "Genetic demultiplexing accuracy" },
  { id: "C", name: "ATAC Fragments", tool: "sinto", desc: "Fragment file concordance" },
  { id: "D", name: "CITE-seq ADT", tool: "CITE-seq-Count", desc: "Antibody tag quantification" },
  { id: "E", name: "alevin-fry", tool: "salmon + alevin-fry", desc: "Alternative mapper/model equivalence" },
  { id: "F", name: "Sex Calling", tool: "STARsolo counts", desc: "XIST/Y-linked gene sex inference" },
  { id: "G", name: "Ambient RNA", tool: "SoupX", desc: "Ambient correction correlation" },
  { id: "H", name: "Doublet Detection", tool: "Scrublet", desc: "Doublet call concordance" },
  { id: "I", name: "Non-Host", tool: "Sylph + minimap2", desc: "Viral/microbial detection" },
];

function StatusIcon({ status }: { status: string }) {
  if (status === "PASS") return <CheckCircle2 size={16} className="text-emerald-500" />;
  if (status === "FAIL") return <XCircle size={16} className="text-red-500" />;
  return <AlertTriangle size={16} className="text-amber-500" />;
}

const Validation = () => {
  const [selectedPanel, setSelectedPanel] = useState<string | undefined>();
  const { data: results, isLoading } = useE2EResults(selectedPanel);

  // Aggregate panel status
  const panelStatus = PANELS.map((p) => {
    const panelResults = results?.filter((r) => r.panel === p.id) ?? [];
    const latest = panelResults[0];
    return { ...p, latest, count: panelResults.length };
  });

  // Chart data: metric values over time for selected panel
  const chartData = selectedPanel
    ? (results ?? [])
        .filter((r) => r.panel === selectedPanel)
        .slice(0, 20)
        .reverse()
        .map((r) => ({
          date: new Date(r.run_date).toLocaleDateString(),
          value: r.metric_value,
          threshold: r.threshold,
          status: r.status,
        }))
    : [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest mb-2">
              E2E Validation
            </h1>
            <p className="text-muted-foreground">
              Continuous correctness validation against external reference pipelines.
              Every panel runs singlify outputs against SOTA tools with hard thresholds.
            </p>
          </div>

          {/* Panel grid */}
          <div className="grid md:grid-cols-3 gap-4 mb-8">
            {panelStatus.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPanel(selectedPanel === p.id ? undefined : p.id)}
                className={`rounded-xl border p-4 text-left transition-all hover:shadow-sm ${
                  selectedPanel === p.id ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display font-bold text-foreground">Panel {p.id}</span>
                  {p.latest ? <StatusIcon status={p.latest.status} /> : <Activity size={16} className="text-muted-foreground/40" />}
                </div>
                <div className="text-sm font-medium text-foreground mb-1">{p.name}</div>
                <div className="text-xs text-muted-foreground mb-2">{p.desc}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{p.tool}</span> · {p.count} runs
                </div>
              </button>
            ))}
          </div>

          {/* Detail view */}
          {selectedPanel && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="font-display text-lg font-bold text-foreground mb-4">
                Panel {selectedPanel} — History
              </h2>

              {chartData.length > 0 && (
                <div className="h-48 mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {chartData.map((entry, i) => (
                          <Cell key={i} fill={entry.status === "PASS" ? "#10b981" : entry.status === "WARN" ? "#f59e0b" : "#ef4444"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Results table */}
              {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Metric</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Value</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Threshold</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tool</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(results ?? []).slice(0, 30).map((r) => (
                        <tr key={r.id} className="border-b border-border/50">
                          <td className="px-3 py-2 text-xs">{new Date(r.run_date).toLocaleDateString()}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.metric_name}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs font-bold">{r.metric_value.toFixed(4)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{r.threshold.toFixed(3)}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{r.external_tool}</td>
                          <td className="px-3 py-2 text-center"><StatusIcon status={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Validation;
