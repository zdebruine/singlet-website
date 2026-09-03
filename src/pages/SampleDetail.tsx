import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, ExternalLink, CheckCircle2, XCircle, AlertCircle, AlertTriangle, Copy, Check
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { DownloadPanel } from "@/components/DownloadPanel";
import { useSample, useCorpusStats } from "@/hooks/useDatabase";
import { apiClient } from "@/integrations/api/client";
import { isSuspectCellCount, FLAGGED_CELLS_LABEL, protocolLabel } from "@/lib/catalog-display";

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
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

/** Prominent status badge — sized for headers */
function StatusBadgeLarge({ status }: { status: string }) {
  if (status === "DONE") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-200">
        <CheckCircle2 size={14} /> Pass
      </span>
    );
  }
  if (status === "FAIL") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 bg-red-100 px-3 py-1 rounded-full border border-red-200">
        <XCircle size={14} /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 bg-amber-100 px-3 py-1 rounded-full border border-amber-200">
      <AlertCircle size={14} /> {status}
    </span>
  );
}

function StatusBadgeSmall({ status }: { status: string }) {
  if (status === "DONE") return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full"><CheckCircle2 size={11} /> Pass</span>;
  if (status === "FAIL") return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><XCircle size={11} /> Fail</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full"><AlertCircle size={11} /> {status}</span>;
}

function QualityTier({ sample }: { sample: { mapping_rate: number | null; median_genes: number | null; n_cells: number | null; status: string } }) {
  if (sample.status !== "DONE") return null;
  const mr = sample.mapping_rate ?? 0;
  const mg = sample.median_genes ?? 0;
  const cells = sample.n_cells ?? 0;

  const isGold = mr >= 0.7 && mg >= 500 && cells >= 500;
  const isSilver = mr >= 0.5 && mg >= 200 && cells >= 100;

  if (isGold) return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">Gold</span>;
  if (isSilver) return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">Silver</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">Bronze</span>;
}

function QCGauge({
  label, value, unit, good, warn, higherIsBetter = true
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
  good: number;
  warn: number;
  higherIsBetter?: boolean;
}) {
  if (value == null) return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold text-muted-foreground/40 font-display">—</div>
    </div>
  );
  const isGood = higherIsBetter ? value >= good : value <= good;
  const isWarn = !isGood && (higherIsBetter ? value >= warn : value <= warn);
  const color = isGood ? "text-emerald-600" : isWarn ? "text-amber-600" : "text-red-600";
  const display = typeof value === "number" && unit === "%" && value <= 1 ? (value * 100).toFixed(1) : value.toLocaleString();

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold font-display ${color}`}>
        {display}
        {unit && <span className="text-sm font-normal ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

const SampleDetail = () => {
  const { gsmId } = useParams<{ gsmId: string }>();
  const { data: sample, isLoading, error } = useSample(gsmId ?? "");
  const { data: corpusStats } = useCorpusStats();
  const [copied, setCopied] = useState(false);

  const { data: siblings } = useQuery({
    queryKey: ["siblings", gsmId],
    queryFn: async () => {
      if (!gsmId) return [];
      const res = await apiClient.gsm(gsmId);
      return res.siblings;
    },
    enabled: !!gsmId,
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

  const isFailed = sample.status === "FAIL";
  const pythonSnippet = `import singlet\nadata = singlet.load("${sample.gsm_id}")\nprint(adata)`;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-5xl mx-auto">

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
            <Link to="/browse" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft size={12} /> Browse
            </Link>
            {sample.gse_id && (
              <>
                <span>/</span>
                <Link to={`/series/${sample.gse_id}`} className="hover:text-foreground font-mono">{sample.gse_id}</Link>
              </>
            )}
            <span>/</span>
            <span className="text-foreground font-mono">{sample.gsm_id}</span>
          </div>

          {/* ── HEADER ── */}
          <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest mb-1">
                {sample.gsm_id}
              </h1>
              {sample.title && <p className="text-muted-foreground max-w-2xl mb-2">{sample.title}</p>}
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadgeLarge status={sample.status} />
                <QualityTier sample={sample} />
                <span className="text-xs font-mono bg-muted px-2 py-1 rounded">{protocolLabel(sample.protocol)}</span>
                <span className="text-xs italic text-muted-foreground">{sample.organism}</span>
                {sample.modality && <span className="text-xs text-muted-foreground">{sample.modality}</span>}
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
            </div>
          </div>

          {/* ── FAILURE PANEL — full-width amber for failed samples ── */}
          {isFailed && (
            <div className="mb-8 rounded-xl border-2 border-amber-300 bg-amber-50 p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h2 className="text-base font-bold text-amber-900 mb-2">
                    Processing Failed
                  </h2>
                  {sample.failure_category && (
                    <div className="mb-2">
                      <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Failure category: </span>
                      <span className="text-sm text-amber-900 font-medium">{sample.failure_category.replace(/_/g, " ")}</span>
                    </div>
                  )}
                  {sample.failure_detail && (
                    <div className="mb-2">
                      <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Detail: </span>
                      <span className="text-sm text-amber-800">{sample.failure_detail}</span>
                    </div>
                  )}
                  {sample.qc_flag && (
                    <div>
                      <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">QC flag: </span>
                      <span className="text-sm text-amber-800">{sample.qc_flag}</span>
                    </div>
                  )}
                  <p className="text-xs text-amber-700 mt-3 border-t border-amber-200 pt-3">
                    This sample is included in the catalog for transparency. Metadata is preserved; no .singlet output was generated.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── QC METRICS (success samples only) ── */}
          {sample.status === "DONE" && (
            <div className="mb-8">
              <h2 className="font-display text-base font-bold text-foreground mb-3 uppercase tracking-wider">QC Metrics</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {isSuspectCellCount(sample.protocol, sample.cells_called ?? sample.n_cells) ? (
                  <div className="rounded-lg border border-border bg-card p-3">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Cells</div>
                    <div className="text-xs italic text-amber-600" title="Known plate-protocol cell-count bug — value withheld pending pipeline fix">{FLAGGED_CELLS_LABEL}</div>
                  </div>
                ) : (
                  <QCGauge label="Cells" value={sample.cells_called ?? sample.n_cells} good={500} warn={100} />
                )}
                <QCGauge label="Mapping Rate" value={sample.mapping_rate} unit="%" good={0.7} warn={0.5} />
                <QCGauge label="Median Genes/Cell" value={sample.median_genes} good={500} warn={200} />
                <QCGauge label="Median UMIs/Cell" value={sample.median_umis} good={1000} warn={500} />
                <QCGauge label="MT %" value={sample.mt_pct} unit="%" good={5} warn={15} higherIsBetter={false} />
              </div>

              {/* Corpus comparison */}
              {corpusStats && (
                <div className="mt-4 rounded-lg border border-border bg-card p-4">
                  <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">vs. Corpus Average</h3>
                  <div className="space-y-2">
                    {[
                      { label: "Mapping Rate", value: sample.mapping_rate, avg: corpusStats.avg_mapping_rate, fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
                      { label: "Median Genes", value: sample.median_genes, avg: corpusStats.avg_median_genes, fmt: (v: number) => v.toLocaleString() },
                    ].map(({ label, value, avg, fmt }) => {
                      if (value == null || !avg) return null;
                      const ratio = value / avg;
                      const pct = Math.min(ratio * 50, 100);
                      const color = ratio >= 1 ? "bg-emerald-500" : ratio >= 0.7 ? "bg-amber-500" : "bg-red-500";
                      return (
                        <div key={label} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
                          <div className="flex-1 h-2 rounded-full bg-muted relative overflow-hidden">
                            <div className={`absolute left-0 top-0 h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                            <div className="absolute top-0 h-full w-px bg-muted-foreground/40" style={{ left: "50%" }} />
                          </div>
                          <span className="text-xs font-mono w-16 text-right text-foreground">{fmt(value)}</span>
                          <span className="text-[10px] text-muted-foreground w-16 text-right">avg {fmt(avg)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── METADATA TABLE ── */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Biology */}
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-display text-sm font-bold text-foreground mb-4 uppercase tracking-wider">Biology</h3>
              <dl className="space-y-2.5 text-sm">
                {[
                  ["Organism", sample.organism],
                  ["Tissue", sample.tissue],
                  ["Cell Type", sample.cell_type],
                  ["Disease", sample.disease],
                  ["Donor ID", sample.donor_id],
                  ["Sex", sample.sex],
                  ["Protocol", protocolLabel(sample.protocol)],
                  ["Modality", sample.modality],
                ].map(([key, val]) => val ? (
                  <div key={String(key)} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="text-foreground text-right max-w-[200px] truncate">{String(val)}</dd>
                  </div>
                ) : null)}
              </dl>
            </div>

            {/* Processing */}
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-display text-sm font-bold text-foreground mb-4 uppercase tracking-wider">Processing</h3>
              <dl className="space-y-2.5 text-sm">
                {[
                  ["GEO Series", null, sample.gse_id ? (
                    <Link to={`/series/${sample.gse_id}`} className="text-primary hover:underline font-mono">{sample.gse_id}</Link>
                  ) : null],
                  ["SRR Accessions", sample.srr_ids?.join(", ") ?? null],
                  ["Pipeline Version", sample.singlet_version ?? null],
                  ["Processed", sample.pipeline_date ? new Date(sample.pipeline_date).toLocaleDateString() : null],
                  [".1pz Size", sample.pz_size_bytes ? formatBytes(sample.pz_size_bytes) : null],
                  ["Source", sample.source ?? null],
                  ["Status", null, <StatusBadgeSmall key="status" status={sample.status} />],
                ].map(([key, val, node]) => {
                  const display = node ?? (val ? <span className="text-foreground text-right max-w-[220px] truncate font-mono text-xs">{String(val)}</span> : null);
                  if (!display) return null;
                  return (
                    <div key={String(key)} className="flex justify-between items-center gap-2">
                      <dt className="text-muted-foreground shrink-0">{key}</dt>
                      <dd className="text-right">{display}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </div>

          {/* ── GEO CHARACTERISTICS ── */}
          {sample.characteristics && typeof sample.characteristics === "object" && Object.keys(sample.characteristics).length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6 mb-8">
              <h3 className="font-display text-sm font-bold text-foreground uppercase tracking-wider mb-4">Sample Characteristics (GEO)</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                {Object.entries(sample.characteristics as Record<string, string>).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground capitalize">{k}</dt>
                    <dd className="text-foreground text-right max-w-[200px] truncate">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* ── LOAD CODE ── */}
          {sample.status === "DONE" && (
            <div className="rounded-xl border border-border bg-card p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-sm font-bold text-foreground uppercase tracking-wider">Load This Sample</h3>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(pythonSnippet);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted"
                >
                  {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
              </div>
              <div className="rounded-lg bg-background border border-border p-4">
                <pre className="font-mono text-xs text-muted-foreground leading-6 overflow-x-auto whitespace-pre">{`import singlet

adata = singlet.load("${sample.gsm_id}")
print(adata)  # ${isSuspectCellCount(sample.protocol, sample.cells_called ?? sample.n_cells) ? "cell count under review" : formatNumber(sample.cells_called ?? sample.n_cells) + " cells"}`}</pre>
              </div>
            </div>
          )}

          {/* ── DOWNLOAD (success only) ── */}
          {sample.status === "DONE" && (
            <div className="mb-8">
              <h2 className="font-display text-base font-bold text-foreground mb-3 uppercase tracking-wider">Download</h2>
              <DownloadPanel
                accession={sample.gsm_id}
                r2BundleKey={(sample as Record<string, unknown>).r2_bundle_key as string | null ?? null}
                r2BundleBytes={sample.pz_size_bytes}
              />
            </div>
          )}

          {/* ── SIBLINGS ── */}
          {siblings && siblings.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-sm font-bold text-foreground uppercase tracking-wider">
                  Other samples in {sample.gse_id}
                </h3>
                {sample.gse_id && (
                  <Link to={`/series/${sample.gse_id}`} className="text-xs text-primary hover:underline">
                    View series →
                  </Link>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {siblings.slice(0, 8).map((s) => (
                  <Link
                    key={s.gsm_id}
                    to={`/sample/${s.gsm_id}`}
                    className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-primary">{s.gsm_id}</span>
                      <StatusBadgeSmall status={s.status} />
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{s.title ?? ""}</span>
                  </Link>
                ))}
                {siblings.length > 8 && (
                  <p className="text-xs text-muted-foreground col-span-2 text-center py-1">
                    +{siblings.length - 8} more —{" "}
                    <Link to={`/series/${sample.gse_id}`} className="text-primary hover:underline">view all</Link>
                  </p>
                )}
              </div>
            </div>
          )}

        </div>
      </section>
      <Footer />
    </div>
  );
};

export default SampleDetail;
