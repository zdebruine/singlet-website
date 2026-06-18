import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Database, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { apiClient } from "@/integrations/api/client";

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  if (status === "SUCCESS") return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full"><CheckCircle2 size={12} /> Success</span>;
  if (status === "HARD_FAIL") return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><XCircle size={12} /> Failed</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full"><AlertCircle size={12} /> {status}</span>;
}

function QCSummaryBar({ samples }: { samples: { mapping_rate: number | null; median_genes: number | null; cells_called: number | null; status: string }[] }) {
  const success = samples.filter(s => s.status === "SUCCESS");
  if (success.length === 0) return null;

  const gold = success.filter(s => (s.mapping_rate ?? 0) >= 0.7 && (s.median_genes ?? 0) >= 500 && (s.cells_called ?? 0) >= 500).length;
  const silver = success.filter(s => {
    const mr = s.mapping_rate ?? 0; const mg = s.median_genes ?? 0; const cells = s.cells_called ?? 0;
    return !(mr >= 0.7 && mg >= 500 && cells >= 500) && (mr >= 0.5 && mg >= 200 && cells >= 100);
  }).length;
  const bronze = success.length - gold - silver;

  return (
    <div className="mb-8">
      <h2 className="font-display text-sm font-bold text-foreground mb-3 uppercase tracking-wider">Quality Distribution</h2>
      <div className="flex h-4 rounded-full overflow-hidden border border-border">
        {gold > 0 && <div className="bg-yellow-400" style={{ width: `${(gold / success.length) * 100}%` }} title={`Gold: ${gold}`} />}
        {silver > 0 && <div className="bg-slate-300" style={{ width: `${(silver / success.length) * 100}%` }} title={`Silver: ${silver}`} />}
        {bronze > 0 && <div className="bg-orange-300" style={{ width: `${(bronze / success.length) * 100}%` }} title={`Bronze: ${bronze}`} />}
      </div>
      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
        {gold > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> Gold: {gold}</span>}
        {silver > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block" /> Silver: {silver}</span>}
        {bronze > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-300 inline-block" /> Bronze: {bronze}</span>}
      </div>
    </div>
  );
}

function useSeriesSamples(gseId: string) {
  return useQuery({
    queryKey: ["series", gseId],
    queryFn: async () => {
      const res = await apiClient.gse(gseId);
      // Map GsmRow to the shape SeriesDetail.tsx expects (cells_called alias)
      return res.samples.map(s => ({
        ...s,
        cells_called: s.n_cells,
        updated_at: s.last_updated,
      }));
    },
    enabled: !!gseId,
  });
}

const SeriesDetail = () => {
  const { gseId } = useParams<{ gseId: string }>();
  const { data: samples, isLoading, error } = useSeriesSamples(gseId ?? "");

  if (isLoading) return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-32 pb-20 px-6 text-center text-muted-foreground">Loading series...</div>
      <Footer />
    </div>
  );

  if (error || !samples || samples.length === 0) return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-32 pb-20 px-6 text-center">
        <h1 className="text-2xl font-bold text-foreground mb-2">Series Not Found</h1>
        <p className="text-muted-foreground mb-4">{gseId} has no processed samples yet.</p>
        <Link to="/browse" className="text-primary hover:underline">← Browse all samples</Link>
      </div>
      <Footer />
    </div>
  );

  const successSamples = samples.filter((s) => s.status === "SUCCESS");
  const totalCells = successSamples.reduce((a, s) => a + (s.cells_called ?? 0), 0);
  const avgMR = successSamples.length
    ? successSamples.reduce((a, s) => a + (s.mapping_rate ?? 0), 0) / successSamples.length
    : null;
  const organisms = [...new Set(samples.map((s) => s.organism))];
  const protocols = [...new Set(samples.map((s) => s.protocol).filter(Boolean))];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          <Link to="/browse" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft size={14} /> Back to Browse
          </Link>

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest">{gseId}</h1>
              <a
                href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${gseId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                GEO <ExternalLink size={10} />
              </a>
            </div>
            <p className="text-muted-foreground">
              {samples.length} sample{samples.length !== 1 ? "s" : ""} in this series
            </p>
          </div>

          {/* Series Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <div className="text-2xl font-bold text-foreground font-display">{samples.length}</div>
              <div className="text-xs text-muted-foreground mt-1">Samples</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <div className="text-2xl font-bold text-foreground font-display">{formatNumber(totalCells)}</div>
              <div className="text-xs text-muted-foreground mt-1">Total Cells</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <div className="text-2xl font-bold text-foreground font-display">
                {successSamples.length}/{samples.length}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Success</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <div className="text-2xl font-bold text-foreground font-display">
                {avgMR ? `${(avgMR * 100).toFixed(1)}%` : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Avg Mapping Rate</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <div className="text-2xl font-bold text-foreground font-display">{organisms.join(", ") || "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">Organism</div>
            </div>
          </div>

          {/* Metadata */}
          {(protocols.length > 0) && (
            <div className="mb-6 flex gap-2 flex-wrap">
              {protocols.map((p) => (
                <span key={p} className="px-3 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                  {p}
                </span>
              ))}
            </div>
          )}

          {/* Tissue/Source Tags */}
          {(() => {
            const tissues = [...new Set(samples.map((s) => {
              const chars = (s as Record<string, unknown>).characteristics as Record<string, string> | null;
              return chars?.tissue;
            }).filter(Boolean))] as string[];
            const cellTypes = [...new Set(samples.map((s) => {
              const chars = (s as Record<string, unknown>).characteristics as Record<string, string> | null;
              return chars?.["cell type"];
            }).filter(Boolean))] as string[];
            const sources = [...new Set(samples.map((s) => s.source).filter(Boolean))];
            if (tissues.length === 0 && cellTypes.length === 0 && sources.length === 0) return null;
            return (
              <div className="mb-6">
                {tissues.length > 0 && (
                  <>
                    <h2 className="font-display text-sm font-bold text-foreground mb-2 uppercase tracking-wider">Tissues</h2>
                    <div className="flex gap-2 flex-wrap mb-3">
                      {tissues.slice(0, 15).map((t) => (
                        <span key={t} className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{t}</span>
                      ))}
                    </div>
                  </>
                )}
                {cellTypes.length > 0 && (
                  <>
                    <h2 className="font-display text-sm font-bold text-foreground mb-2 uppercase tracking-wider">Cell Types</h2>
                    <div className="flex gap-2 flex-wrap mb-3">
                      {cellTypes.slice(0, 15).map((ct) => (
                        <span key={ct} className="px-3 py-1 rounded-full text-xs font-medium bg-violet-500/10 text-violet-600">{ct}</span>
                      ))}
                    </div>
                  </>
                )}
                {sources.length > 0 && tissues.length === 0 && (
                  <>
                    <h2 className="font-display text-sm font-bold text-foreground mb-2 uppercase tracking-wider">Sources</h2>
                    <div className="flex gap-2 flex-wrap">
                      {sources.slice(0, 15).map((src) => (
                        <span key={src} className="px-3 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">{src}</span>
                      ))}
                      {sources.length > 15 && <span className="px-3 py-1 text-xs text-muted-foreground">+{sources.length - 15} more</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Quality Distribution */}
          <QCSummaryBar samples={samples} />

          {/* Load code */}
          <div className="rounded-lg border border-border bg-muted/30 p-4 mb-8">
            <div className="text-xs font-medium text-muted-foreground mb-2">Load this series in Python</div>
            <pre className="font-mono text-xs text-foreground overflow-x-auto">
              <code>{`import singlet\n\n# List all samples in ${gseId}\ndf = singlet.samples(gse_id="${gseId}")\nprint(df[["gsm_id", "organism", "status", "n_cells"]])\n\n# Load a successful sample\nadata = singlet.load(df.loc[0, "gsm_id"])\nprint(f"{adata.n_obs} cells × {adata.n_vars} genes")`}</code>
            </pre>
          </div>

          {/* Samples Table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-3 text-left font-semibold text-foreground">Sample</th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-semibold text-foreground">Cells</th>
                    <th className="px-4 py-3 text-right font-semibold text-foreground">Mapping</th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground">Protocol</th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s) => (
                    <tr key={s.gsm_id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/sample/${s.gsm_id}`} className="font-mono text-xs text-primary hover:underline">
                          {s.gsm_id}
                        </Link>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{formatNumber(s.cells_called)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {s.mapping_rate ? `${(s.mapping_rate * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{s.protocol ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">{s.source ?? s.title ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default SeriesDetail;
