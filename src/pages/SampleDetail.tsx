import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Download, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useSample } from "@/hooks/useDatabase";

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

const SampleDetail = () => {
  const { gsmId } = useParams<{ gsmId: string }>();
  const { data: sample, isLoading, error } = useSample(gsmId ?? "");

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
                <a
                  href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${sample.gse_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted"
                >
                  {sample.gse_id} <ExternalLink size={12} />
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
                  <dd className="font-mono text-foreground">{sample.gse_id}</dd>
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

          {/* Code example */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="font-display text-sm font-bold text-foreground mb-4 uppercase tracking-wider">Load This Sample</h3>
            <div className="rounded-lg bg-background border border-border p-4">
              <pre className="font-mono text-xs text-muted-foreground leading-6 overflow-x-auto">{`import singlet

# Load directly from the Singlet Atlas
adata = singlet.load("${sample.gsm_id}")
print(adata)  # ${formatNumber(sample.cells_called)} cells × ${formatNumber(sample.median_genes)} genes`}</pre>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default SampleDetail;
