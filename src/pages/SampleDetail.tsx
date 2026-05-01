import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Download, CheckCircle2, XCircle, AlertCircle, Copy, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useSample, useCorpusStats } from "@/hooks/useDatabase";
import { supabase } from "@/integrations/supabase/client";

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}

function QCGauge({ label, value, unit, good, warn }: { label: string; value: number | null | undefined; unit?: string; good: number; warn: number }) {
  if (value == null) return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold text-muted-foreground/40">—</div>
    </div>
  );

  const isGood = value >= good;
  const isWarn = !isGood && value >= warn;
  const color = isGood ? "text-emerald-600" : isWarn ? "text-amber-600" : "text-red-600";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold font-display ${color}`}>
        {typeof value === "number" && value < 1 && unit === "%" ? (value * 100).toFixed(1) : value.toLocaleString()}
        {unit && <span className="text-sm font-normal ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

function QualityTier({ sample }: { sample: { mapping_rate: number | null; median_genes: number | null; cells_called: number | null; status: string } }) {
  if (sample.status !== "SUCCESS") return null;
  const mr = sample.mapping_rate ?? 0;
  const mg = sample.median_genes ?? 0;
  const cells = sample.cells_called ?? 0;

  const isGold = mr >= 0.7 && mg >= 500 && cells >= 500;
  const isSilver = mr >= 0.5 && mg >= 200 && cells >= 100;

  if (isGold) return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">🥇 Gold</span>;
  if (isSilver) return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">🥈 Silver</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">🥉 Bronze</span>;
}

const SampleDetail = () => {
  const { gsmId } = useParams<{ gsmId: string }>();
  const { data: sample, isLoading, error } = useSample(gsmId ?? "");
  const { data: corpusStats } = useCorpusStats();
  const [copied, setCopied] = useState(false);

  const { data: relatedSamples } = useQuery({
    queryKey: ["related-samples", sample?.gse_id],
    queryFn: async () => {
      if (!sample?.gse_id) return [];
      const { data } = await supabase
        .from("samples")
        .select("gsm_id, status, cells_called, title")
        .eq("gse_id", sample.gse_id)
        .neq("gsm_id", sample.gsm_id)
        .order("gsm_id")
        .limit(10);
      return data ?? [];
    },
    enabled: !!sample?.gse_id,
    staleTime: 60_000,
  });

  if (isLoading) return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-32 pb-20 px-6 text-center text-muted-foreground">Loading sample...</div>
      <Footer />
    </div>
  );

  if (error || !sample) return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-32 pb-20 px-6 text-center">
        <h1 className="text-2xl font-bold text-foreground mb-2">Sample Not Found</h1>
        <p className="text-muted-foreground">Could not find sample {gsmId}</p>
        <Link to="/browse" className="text-primary hover:underline mt-4 inline-block">← Back to Browse</Link>
      </div>
      <Footer />
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Breadcrumb */}
          <Link to="/browse" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft size={14} /> Back to Browse
          </Link>

          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest mb-1">
                {sample.gsm_id}
              </h1>
              {sample.title && <p className="text-muted-foreground max-w-2xl">{sample.title}</p>}
              <div className="flex items-center gap-3 mt-3">
                <span className="text-xs font-mono bg-muted px-2 py-1 rounded">{sample.protocol ?? "unknown"}</span>
                <span className="text-xs italic text-muted-foreground">{sample.organism}</span>
                <span className="text-xs text-muted-foreground">{sample.modality ?? "scrna"}</span>
                {sample.status === "SUCCESS" && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={12} /> Success</span>}
                {sample.status === "HARD_FAIL" && <span className="inline-flex items-center gap-1 text-xs text-red-600"><XCircle size={12} /> Failed</span>}
                {sample.status !== "SUCCESS" && sample.status !== "HARD_FAIL" && <span className="inline-flex items-center gap-1 text-xs text-amber-600"><AlertCircle size={12} /> {sample.status}</span>}
                <QualityTier sample={sample} />
              </div>
            </div>
            <div className="flex gap-2">
              <a
                href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${sample.gsm_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted"
              >
                GEO <ExternalLink size={12} />
              </a>
              {sample.gse_id && (
                <Link
                  to={`/series/${sample.gse_id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted"
                >
                  {sample.gse_id} →
                </Link>
              )}
              {sample.gse_id && (
                <a
                  href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${sample.gse_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted"
                >
                  GEO <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>

          {/* QC Metrics */}
          <div className="mb-8">
            <h2 className="font-display text-lg font-bold text-foreground mb-4">QC Metrics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <QCGauge label="Cells Called" value={sample.cells_called} good={100} warn={10} />
              <QCGauge label="Mapping Rate" value={sample.mapping_rate} unit="%" good={0.5} warn={0.3} />
              <QCGauge label="Median Genes/Cell" value={sample.median_genes} good={500} warn={200} />
              <QCGauge label="Median UMIs/Cell" value={sample.median_umis} good={1000} warn={500} />
              <QCGauge label="MT %" value={sample.mt_pct} unit="%" good={0} warn={10} />
              <QCGauge label="Doublet Rate" value={sample.doublet_rate} unit="%" good={0} warn={0.1} />
              <QCGauge label="Ambient %" value={sample.ambient_pct} unit="%" good={0} warn={0.15} />
              <QCGauge label="Saturation" value={sample.saturation} unit="%" good={0.5} warn={0.3} />
            </div>

            {/* Corpus comparison */}
            {sample.status === "SUCCESS" && corpusStats && (
              <div className="mt-4 rounded-lg border border-border bg-card p-4">
                <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">vs. Corpus Average</h3>
                <div className="space-y-2">
                  {[
                    { label: "Mapping Rate", value: sample.mapping_rate, avg: Number(corpusStats.avg_mapping_rate), format: (v: number) => `${(v * 100).toFixed(1)}%` },
                    { label: "Median Genes", value: sample.median_genes, avg: Number(corpusStats.avg_median_genes), format: (v: number) => v.toLocaleString() },
                  ].map(({ label, value, avg, format }) => {
                    if (value == null || !avg) return null;
                    const ratio = value / avg;
                    const pct = Math.min(ratio * 50, 100); // 50% mark = average
                    const color = ratio >= 1 ? "bg-emerald-500" : ratio >= 0.7 ? "bg-amber-500" : "bg-red-500";
                    return (
                      <div key={label} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted relative overflow-hidden">
                          <div className={`absolute left-0 top-0 h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                          <div className="absolute top-0 h-full w-px bg-muted-foreground/40" style={{ left: "50%" }} />
                        </div>
                        <span className="text-xs font-mono w-16 text-right text-foreground">{format(value)}</span>
                        <span className="text-[10px] text-muted-foreground w-14 text-right">avg {format(avg)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Processing Info */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-display text-sm font-bold text-foreground mb-4 uppercase tracking-wider">Processing</h3>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Pipeline Version</dt>
                  <dd className="font-mono text-foreground">{sample.singlet_version ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Commit</dt>
                  <dd className="font-mono text-foreground text-xs">{sample.singlet_commit?.slice(0, 8) ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Wall Time</dt>
                  <dd className="font-mono text-foreground">{sample.wall_time_s ? `${sample.wall_time_s}s` : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Download Path</dt>
                  <dd className="font-mono text-foreground">{sample.download_path ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Processed</dt>
                  <dd className="text-foreground">{sample.pipeline_date ? new Date(sample.pipeline_date).toLocaleDateString() : "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-display text-sm font-bold text-foreground mb-4 uppercase tracking-wider">Data</h3>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">GEO Series</dt>
                  <dd className="font-mono text-foreground">
                    <Link to={`/series/${sample.gse_id}`} className="text-primary hover:underline">{sample.gse_id}</Link>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">SRR Accessions</dt>
                  <dd className="font-mono text-foreground text-xs">{sample.srr_ids?.join(", ") ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">.1pz Size</dt>
                  <dd className="font-mono text-foreground">{formatBytes(sample.pz_size_bytes)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Source</dt>
                  <dd className="text-foreground">{sample.source ?? "—"}</dd>
                </div>
                {sample.failure_category && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Failure</dt>
                    <dd className="font-mono text-red-600 text-xs">{sample.failure_category}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          {/* GEO Characteristics */}
          {sample.characteristics && typeof sample.characteristics === "object" && Object.keys(sample.characteristics).length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-display text-sm font-bold text-foreground uppercase tracking-wider mb-4">Sample Characteristics</h3>
              <dl className="space-y-2 text-sm">
                {Object.entries(sample.characteristics as Record<string, string>).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <dt className="text-muted-foreground capitalize">{key}</dt>
                    <dd className="text-foreground text-right max-w-[200px] truncate">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Code example */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-sm font-bold text-foreground uppercase tracking-wider">Load This Sample</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`import singlet\nadata = singlet.load("${sample.gsm_id}")\nprint(adata)`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted"
              >
                {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>
            <div className="rounded-lg bg-background border border-border p-4">
              <pre className="font-mono text-xs text-muted-foreground leading-6 overflow-x-auto">{`import singlet

# Load directly from the Singlet Atlas
adata = singlet.load("${sample.gsm_id}")
print(adata)  # ${formatNumber(sample.cells_called)} cells × ${formatNumber(sample.median_genes)} genes`}</pre>
            </div>
          </div>

          {/* Related samples from same series */}
          {relatedSamples && relatedSamples.length > 0 && (
            <div className="mt-8 rounded-xl border border-border bg-card p-6">
              <h3 className="font-display text-sm font-bold text-foreground mb-3 uppercase tracking-wider">
                Other samples in {sample.gse_id}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {relatedSamples.map((r) => (
                  <Link
                    key={r.gsm_id}
                    to={`/sample/${r.gsm_id}`}
                    className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-primary">{r.gsm_id}</span>
                      {r.status === "SUCCESS" && <CheckCircle2 size={10} className="text-emerald-500" />}
                      {r.status === "HARD_FAIL" && <XCircle size={10} className="text-red-500" />}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{r.title ?? ""}</span>
                  </Link>
                ))}
              </div>
              {sample.gse_id && (
                <Link to={`/series/${sample.gse_id}`} className="inline-block mt-3 text-xs text-primary hover:underline">
                  View all samples in this series →
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default SampleDetail;
