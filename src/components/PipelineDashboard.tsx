import React, { useEffect, useState } from "react";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    Cell,
} from "recharts";
import { Database, Cpu, Activity, Server, Clock } from "lucide-react";

/* ── Types ── */
interface SpeciesData {
    samples: number;
    cells: number;
}

interface HistoryEntry {
    timestamp: string;
    samples_quantified: number;
    total_cells: number;
    running_tasks: number;
}

interface JobArray {
    name: string;
    running: number;
    pending: number;
}

interface PipelineMetrics {
    last_updated: string;
    corpus: {
        total_series: number;
        total_samples: number;
        samples_quantified: number;
        samples_with_metadata: number;
        total_cells: number;
        samples_with_cells: number;
        avg_cells_per_sample: number;
        species: Record<string, SpeciesData>;
        qc_pass_rate: number;
        pipeline_version: string;
    };
    compute: {
        active_jobs: number;
        running_tasks: number;
        pending_tasks: number;
        nodes_active: number;
        nodes_list: string[];
        job_arrays: JobArray[];
    };
    history: HistoryEntry[];
}

/* ── Helpers ── */
function formatNumber(n: number): string {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
}

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function topSpecies(species: Record<string, SpeciesData>, limit = 6): { name: string; samples: number; cells: number }[] {
    return Object.entries(species)
        .map(([name, data]) => ({ name, samples: data.samples, cells: data.cells }))
        .sort((a, b) => b.cells - a.cells || b.samples - a.samples)
        .slice(0, limit);
}

const SPECIES_COLORS = [
    "hsl(174, 84%, 32%)", // primary teal
    "hsl(200, 70%, 55%)", // blue
    "hsl(152, 60%, 45%)", // green
    "hsl(38, 80%, 55%)",  // amber
    "hsl(265, 50%, 55%)", // purple
    "hsl(0, 0%, 55%)",    // gray
];

/* ── usePipelineMetrics hook ── */
export function usePipelineMetrics() {
    const [data, setData] = useState<PipelineMetrics | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch("/data/pipeline-metrics.json")
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then(setData)
            .catch((e) => setError(e.message));
    }, []);

    return { data, error };
}

/* ── Stat card ── */
const Stat = ({ value, label, sub, mono = true }: { value: string; label: string; sub?: string; mono?: boolean }) => (
    <div className="rounded-lg border border-border bg-card p-4">
        <div className={`text-xl font-bold text-foreground mb-1 ${mono ? "font-mono" : "font-display"}`}>{value}</div>
        <p className="text-xs text-foreground font-medium leading-snug mb-0.5">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
);

/* ── CorpusSection ── */
export const CorpusSection = ({ data }: { data: PipelineMetrics }) => {
    const { corpus } = data;
    const species = topSpecies(corpus.species);
    const totalSpecies = Object.keys(corpus.species).length;

    return (
        <>
            <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Data Corpus</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-3">
                The atlas — live numbers.
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-2">
                Every dataset in NCBI GEO with single-cell RNA-seq data, reprocessed from raw FASTQ through one standardized pipeline.
                These numbers update automatically as processing continues.
            </p>
            <p className="text-[10px] text-muted-foreground/60 font-mono mb-8">
                Last updated {timeAgo(data.last_updated)} · {new Date(data.last_updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>

            {/* Primary metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <Stat value={formatNumber(corpus.total_cells)} label="Total cells" sub="Exact count from manifests" />
                <Stat value={corpus.total_samples.toLocaleString()} label="GEO samples" sub="GSM accessions cataloged" />
                <Stat value={corpus.samples_quantified.toLocaleString()} label="Samples quantified" sub="FASTQ → counts.spz" />
                <Stat value={corpus.total_series.toLocaleString()} label="GEO series" sub="GSE accessions" />
            </div>

            {/* Secondary metrics */}
            <div className="grid grid-cols-3 gap-3 mb-8">
                <Stat value={corpus.avg_cells_per_sample.toLocaleString()} label="Avg cells/sample" />
                <Stat value={`${(corpus.qc_pass_rate * 100).toFixed(0)}%`} label="QC pass rate" />
                <Stat value={`${totalSpecies}`} label="Species" sub="In current corpus" />
            </div>

            {/* Species breakdown */}
            <div className="rounded-lg border border-border bg-card p-5 mb-8">
                <h3 className="font-display text-sm font-semibold text-foreground mb-4">Species breakdown</h3>
                <div className="grid md:grid-cols-2 gap-6">
                    <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={species} layout="vertical" margin={{ left: 80, right: 10, top: 0, bottom: 0 }}>
                                <XAxis type="number" hide />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                                    tickFormatter={(v: string) => v.length > 15 ? v.slice(0, 13) + "…" : v}
                                    width={80}
                                />
                                <Tooltip
                                    content={({ active, payload }) =>
                                        active && payload?.[0] ? (
                                            <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                                                <p className="text-xs text-foreground font-semibold italic">{payload[0].payload.name}</p>
                                                <p className="text-xs text-muted-foreground font-mono">{formatNumber(payload[0].payload.cells)} cells</p>
                                                <p className="text-xs text-muted-foreground font-mono">{formatNumber(payload[0].payload.samples)} samples</p>
                                            </div>
                                        ) : null
                                    }
                                />
                                <Bar dataKey="cells" radius={[0, 4, 4, 0]}>
                                    {species.map((_, i) => (
                                        <Cell key={i} fill={SPECIES_COLORS[i % SPECIES_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col justify-center space-y-2">
                        {species.map((s, i) => (
                            <div key={s.name} className="flex items-center gap-3">
                                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: SPECIES_COLORS[i % SPECIES_COLORS.length] }} />
                                <span className="text-xs text-foreground italic flex-1 truncate">{s.name}</span>
                                <span className="font-mono text-xs text-muted-foreground">{formatNumber(s.cells)}</span>
                            </div>
                        ))}
                        {totalSpecies > 6 && (
                            <p className="text-[10px] text-muted-foreground/60">+ {totalSpecies - 6} more species</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Pipeline info */}
            <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-start gap-3">
                    <Database size={16} className="text-primary mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="text-xs font-semibold text-foreground mb-1">Why uniform reprocessing matters</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            CZI CELLxGENE Census takes author-processed data — different pipelines, different parameters, different quality.
                            Our atlas reprocesses every sample from raw FASTQ through{" "}
                            <span className="font-mono text-foreground">{corpus.pipeline_version}</span> with{" "}
                            spliced/unspliced/ambiguous quantification. Every cell is directly comparable. This is what makes
                            atlas-scale NMF training possible.
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
};

/* ── ComputeSection ── */
export const ComputeSection = ({ data }: { data: PipelineMetrics }) => {
    const { compute, history, corpus } = data;

    // Compute processing rate from history
    const processingRate = (() => {
        if (history.length < 2) return null;
        const latest = history[history.length - 1];
        const earliest = history[0];
        const timeDiffHrs = (new Date(latest.timestamp).getTime() - new Date(earliest.timestamp).getTime()) / 3_600_000;
        if (timeDiffHrs <= 0) return null;
        const samplesDiff = latest.samples_quantified - earliest.samples_quantified;
        const cellsDiff = latest.total_cells - earliest.total_cells;
        return {
            samplesPerHour: Math.round(samplesDiff / timeDiffHrs),
            cellsPerHour: Math.round(cellsDiff / timeDiffHrs),
            hoursTracked: Math.round(timeDiffHrs),
        };
    })();

    // Format history for chart
    const chartData = history.map((h) => ({
        time: new Date(h.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        samples: h.samples_quantified,
        cells: h.total_cells,
        tasks: h.running_tasks,
    }));

    const completionPct = corpus.total_samples > 0
        ? ((corpus.samples_quantified / corpus.total_samples) * 100).toFixed(1)
        : "0";

    return (
        <>
            <p className="font-mono text-xs text-primary uppercase tracking-widest mb-4">Live Compute</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-3">
                Processing at scale — right now.
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-8">
                Our HPC cluster is continuously processing raw FASTQ data through the quantification pipeline.
                These are live numbers from our compute infrastructure.
            </p>

            {/* Live status indicator */}
            <div className="flex items-center gap-2 mb-6">
                <span className="relative flex h-2.5 w-2.5">
                    {compute.running_tasks > 0 && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${compute.running_tasks > 0 ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                    {compute.running_tasks > 0 ? "Pipeline active" : "Pipeline idle"} · Updated {timeAgo(data.last_updated)}
                </span>
            </div>

            {/* Compute stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Activity size={14} className="text-emerald-600" />
                        <span className="text-[10px] font-mono text-emerald-600 uppercase tracking-wider">Running</span>
                    </div>
                    <div className="font-mono text-2xl font-bold text-foreground">{compute.running_tasks}</div>
                    <p className="text-[10px] text-muted-foreground">Concurrent tasks</p>
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock size={14} className="text-muted-foreground" />
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Queued</span>
                    </div>
                    <div className="font-mono text-2xl font-bold text-foreground">{compute.pending_tasks}</div>
                    <p className="text-[10px] text-muted-foreground">Pending tasks</p>
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Server size={14} className="text-muted-foreground" />
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Nodes</span>
                    </div>
                    <div className="font-mono text-2xl font-bold text-foreground">{compute.nodes_active}</div>
                    <p className="text-[10px] text-muted-foreground">Active compute nodes</p>
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Cpu size={14} className="text-muted-foreground" />
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Progress</span>
                    </div>
                    <div className="font-mono text-2xl font-bold text-foreground">{completionPct}%</div>
                    <p className="text-[10px] text-muted-foreground">Samples quantified</p>
                </div>
            </div>

            {/* Progress bar */}
            <div className="rounded-lg border border-border bg-card p-5 mb-6">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-foreground">Overall pipeline progress</p>
                    <p className="font-mono text-xs text-muted-foreground">
                        {corpus.samples_quantified.toLocaleString()} / {corpus.total_samples.toLocaleString()} samples
                    </p>
                </div>
                <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min(parseFloat(completionPct), 100)}%` }}
                    />
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                    {(corpus.total_samples - corpus.samples_quantified).toLocaleString()} samples remaining
                </p>
            </div>

            {/* Job arrays */}
            {compute.job_arrays.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-5 mb-6">
                    <h3 className="font-display text-sm font-semibold text-foreground mb-3">Active job arrays</h3>
                    <div className="space-y-2">
                        {compute.job_arrays.map((job) => (
                            <div key={job.name} className="flex items-center gap-3 px-3 py-2 rounded bg-muted/30">
                                <span className="font-mono text-xs text-foreground font-semibold flex-1">{job.name}</span>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-600">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    {job.running} running
                                </span>
                                {job.pending > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground">
                                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                                        {job.pending} queued
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                    {compute.nodes_list.length > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-3 font-mono">
                            Nodes: {compute.nodes_list.join(", ")}
                        </p>
                    )}
                </div>
            )}

            {/* Processing rate */}
            {processingRate && processingRate.samplesPerHour > 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-5 mb-6">
                    <h3 className="font-display text-sm font-semibold text-foreground mb-3">Processing rate</h3>
                    <div className="grid grid-cols-2 gap-4 text-center">
                        <div>
                            <div className="font-mono text-lg font-bold text-primary">{formatNumber(processingRate.samplesPerHour)}</div>
                            <p className="text-[10px] text-muted-foreground">Samples / hour</p>
                        </div>
                        <div>
                            <div className="font-mono text-lg font-bold text-primary">{formatNumber(processingRate.cellsPerHour)}</div>
                            <p className="text-[10px] text-muted-foreground">Cells / hour</p>
                        </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center mt-2">
                        Averaged over {processingRate.hoursTracked} hours of tracking
                    </p>
                </div>
            )}

            {/* History chart */}
            {chartData.length > 1 && (
                <div className="rounded-lg border border-border bg-card p-5 mb-8">
                    <h3 className="font-display text-sm font-semibold text-foreground mb-4">Quantification progress over time</h3>
                    <div className="h-40">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="samplesGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="hsl(174, 84%, 32%)" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="hsl(174, 84%, 32%)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => formatNumber(v)} />
                                <Tooltip
                                    content={({ active, payload }) =>
                                        active && payload?.[0] ? (
                                            <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                                                <p className="text-xs text-foreground font-mono">{payload[0].payload.samples.toLocaleString()} samples</p>
                                            </div>
                                        ) : null
                                    }
                                />
                                <Area type="monotone" dataKey="samples" stroke="hsl(174, 84%, 32%)" strokeWidth={2} fill="url(#samplesGrad)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Infrastructure note */}
            <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-start gap-3">
                    <Server size={16} className="text-primary mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="text-xs font-semibold text-foreground mb-1">Built on university compute</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            Processing runs on the GVSU HPC cluster and NSF ACCESS allocations — no cloud compute bill.
                            The pipeline is fully automated: FASTQ download, reference indexing, salmon/alevin quantification,
                            quality control, and compression to our{" "}
                            <span className="font-mono text-foreground">.spz</span> format.
                            Metrics on this page update hourly.
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
};
