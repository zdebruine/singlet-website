import { useEffect, useState } from "react";
import {
  Activity, Cpu, HardDrive, Server, AlertTriangle, CheckCircle2,
  Clock, TrendingDown, Zap, RefreshCw, Database
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, ScatterChart, Scatter, CartesianGrid, Legend
} from "recharts";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

interface Snapshot {
  schema_version: number;
  generated_at: string;
  kpi: {
    samples_total: number;
    samples_success: number;
    samples_failed_terminal: number;
    samples_in_flight: number;
    samples_pending: number;
    samples_claimed?: number;
    samples_with_summary: number;
    samples_done_queue?: number;
    samples_failed_queue?: number;
    samples_deny_list?: number;
    success_rate_pct: number;
    cells_total: number;
    reads_total: number;
    umis_total: number;
    nodes_in_use: number;
    cpus_in_use: number;
  };
  queue_state?: {
    pending: number; claimed: number; done: number; failed: number;
  };
  status_distribution: Record<string, number>;
  partitions: Array<{
    name: string; idle_cpus: number; alloc_cpus: number; total_cpus: number;
    idle_nodes: number; mixed_nodes: number; alloc_nodes: number; down_nodes: number;
    mem_per_node_mb: number; cpu_util_pct: number;
  }>;
  tiers: Array<{
    name: string; partition: string;
    n_total: number; n_complete: number; n_success: number; n_failed: number;
    success_rate_pct: number | null;
    mem_gb_req: number; mem_gb_p50: number; mem_gb_p95: number; mem_eff_pct: number;
    time_req_s: number; time_s_p50: number; time_s_p95: number; time_eff_pct: number;
    cpus_req: number; downsize_candidate: boolean;
  }>;
  failure_modes: Array<{ kind: string; count: number }>;
  recent_failures: Array<{
    jobid: string; gsm: string | null; state: string; tier: string | null;
    elapsed_s: number; maxrss_gb: number; timelimit_s: number; end: string; retries: number;
  }>;
  running_jobs: Array<{
    jobid: string; partition: string; node: string; cpus: number;
    mem: string; time_limit: string; tier: string | null;
  }>;
  efficiency: {
    mem_p50_pct: number; mem_p95_pct: number;
    time_p50_pct: number; time_p95_pct: number; n_samples: number;
  };
  downsize_proposals: Array<{
    tier: string; current_mem_gb: number; proposed_mem_gb: number;
    current_time_s: number; proposed_time_s: number; n_samples: number;
  }>;
  policy_snapshot: {
    max_nodes_per_partition: number;
    target_concurrency_jobs: number;
    apply_actions: boolean;
    downsize_enabled: boolean;
    dashboard_cadence_minutes: number;
  };
}

const COLORS = {
  success: "#10b981", warning: "#f59e0b", danger: "#ef4444",
  info: "#3b82f6", muted: "#6b7280", purple: "#8b5cf6",
};

const STATE_COLOR: Record<string, string> = {
  // legacy SLURM-derived states
  OUT_OF_MEMORY: COLORS.danger,
  TIMEOUT: COLORS.warning,
  NODE_FAIL: COLORS.purple,
  FAILED: COLORS.danger,
  CANCELLED: COLORS.muted,
  // biology-derived status
  align_low_map: COLORS.warning,
  align_low_cells: COLORS.warning,
  align_low_genes: COLORS.warning,
  align_zero_cells: COLORS.danger,
  data_incomplete: COLORS.info,
  success: COLORS.success,
  qc_warn: COLORS.warning,
  // pipeline-derived failure reasons
  no_srr: COLORS.muted,
  "precheck.no_srr": COLORS.muted,
  no_sra_in_geo: COLORS.muted,
  s3: COLORS.danger,
  encode: COLORS.warning,
  encode_empty: COLORS.warning,
  protocol_undetected: COLORS.purple,
  protocol_mismatch: COLORS.purple,
  pipeline: COLORS.danger,
  pipeline_timeout: COLORS.warning,
  permanent_failure: COLORS.danger,
};

function fmtNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function fmtDuration(s: number): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function KpiCard({ icon: Icon, label, value, sub, color = COLORS.info }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="font-display text-2xl font-bold text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ClusterTabs({ cluster, onChange }: { cluster: ClusterKey; onChange: (k: ClusterKey) => void }) {
  return (
    <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
      {(Object.keys(CLUSTERS) as ClusterKey[]).map(key => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            cluster === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {CLUSTERS[key].label}
        </button>
      ))}
    </div>
  );
}

type ClusterKey = "clipper" | "anvil";

const CLUSTERS: Record<ClusterKey, { label: string; sub: string; url: string }> = {
  clipper: {
    label: "GVSU Clipper",
    sub: "Human scRNA-seq reprocessing",
    url: "/data/hpc/latest.json",
  },
  anvil: {
    label: "Purdue ANVIL",
    sub: "Mouse 10x scRNA-seq (NSF ACCESS)",
    url: "/data/hpc/anvil/latest.json",
  },
};

const HpcDashboard = () => {
  const [cluster, setCluster] = useState<ClusterKey>("clipper");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const load = (key: ClusterKey = cluster) => {
    setLoading(true);
    setSnap(null);
    setErr(null);
    fetch(`${CLUSTERS[key].url}?t=${Date.now()}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: Snapshot) => { setSnap(d); setErr(null); setLastFetched(new Date()); })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = setInterval(() => load(), 60_000);
    return () => clearInterval(id);
  }, [cluster]);

  if (loading && !snap) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-32 px-6 max-w-5xl mx-auto">
          <ClusterTabs cluster={cluster} onChange={k => { setCluster(k); }} />
          <div className="text-muted-foreground mt-8">Loading HPC dashboard…</div>
        </div>
        <Footer />
      </div>
    );
  }

  if (err && !snap) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-32 px-6 max-w-5xl mx-auto">
          <ClusterTabs cluster={cluster} onChange={k => { setCluster(k); }} />
          <div className="bg-card border border-border rounded-lg p-6 mt-6">
            <h2 className="font-display text-xl font-bold mb-2">Dashboard data not yet available</h2>
            <p className="text-sm text-muted-foreground mb-2">
              The job-orchestrator publishes snapshots hourly. If you just
              spun up the campaign, give it ~15 min for the first snapshot.
            </p>
            <p className="text-xs text-muted-foreground font-mono">{err}</p>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const k = snap!.kpi;
  const tiers = snap!.tiers;
  const partitions = snap!.partitions;

  // Pie data for status distribution
  const statusPie = Object.entries(snap!.status_distribution).map(([name, value]) => ({
    name, value, color: STATE_COLOR[name] ?? COLORS.muted,
  }));

  // Failure modes
  const fmData = snap!.failure_modes.map(f => ({
    name: f.kind, count: f.count, fill: STATE_COLOR[f.kind] ?? COLORS.danger,
  }));

  // Efficiency scatter (per-tier mem vs time efficiency)
  const effData = tiers
    .filter(t => t.n_complete > 0)
    .map(t => ({ name: t.name, mem: t.mem_eff_pct, time: t.time_eff_pct, n: t.n_complete }));

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">

          {/* Cluster tab selector */}
          <ClusterTabs cluster={cluster} onChange={k => setCluster(k)} />

          {/* Header */}
          <div className="flex items-end justify-between mt-6 mb-8 flex-wrap gap-4">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground tracking-tightest mb-1">
                HPC Dashboard — {CLUSTERS[cluster].label}
              </h1>
              <p className="text-sm text-muted-foreground">
                {CLUSTERS[cluster].sub} ·
                Snapshot: <span className="font-mono">{snap!.generated_at}</span> ·
                Cadence: {snap!.policy_snapshot.dashboard_cadence_minutes} min
              </p>
            </div>
            <button onClick={() => load()} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-secondary text-secondary-foreground text-xs font-medium hover:bg-muted">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh {lastFetched && `· ${lastFetched.toLocaleTimeString()}`}
            </button>
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
            <KpiCard icon={CheckCircle2} label="Success rate" value={`${k.success_rate_pct}%`}
                     sub={`${k.samples_success}/${k.samples_with_summary} on disk`}
                     color={k.success_rate_pct >= 85 ? COLORS.success : COLORS.warning} />
            <KpiCard icon={Activity} label="In flight" value={k.samples_in_flight}
                     sub={`${k.samples_pending} pending · ${k.samples_claimed ?? 0} claimed`} color={COLORS.info} />
            <KpiCard icon={Server} label="Nodes" value={k.nodes_in_use}
                     sub={`${k.cpus_in_use} CPUs`} color={COLORS.purple} />
            <KpiCard icon={Database} label="Cells" value={fmtNum(k.cells_total)}
                     sub={`${fmtNum(k.umis_total)} UMIs`} color={COLORS.success} />
            <KpiCard icon={Zap} label="Reads" value={fmtNum(k.reads_total)}
                     sub={`${k.samples_with_summary} samples on disk`} color={COLORS.info} />
            <KpiCard icon={AlertTriangle} label="Failed terminal" value={k.samples_failed_terminal}
                     sub={`${k.samples_deny_list ?? 0} on deny list`} color={COLORS.danger} />
          </div>

          {/* Partition utilization */}
          <div className="bg-card border border-border rounded-lg p-5 mb-6">
            <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2">
              <Cpu size={18} /> Partition utilization
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="text-left py-2 pr-4">Partition</th>
                    <th className="text-right pr-4">CPUs alloc/total</th>
                    <th className="text-right pr-4">Nodes idle / mix / alloc</th>
                    <th className="text-left pr-4 w-1/3">CPU utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {partitions.map(p => (
                    <tr key={p.name} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-mono font-medium">{p.name}</td>
                      <td className="text-right pr-4 font-mono">{p.alloc_cpus} / {p.total_cpus}</td>
                      <td className="text-right pr-4 font-mono text-muted-foreground">
                        {p.idle_nodes} / {p.mixed_nodes} / {p.alloc_nodes}
                      </td>
                      <td className="pr-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{
                              width: `${p.cpu_util_pct}%`,
                              backgroundColor: p.cpu_util_pct >= 80 ? COLORS.danger : p.cpu_util_pct >= 50 ? COLORS.warning : COLORS.success,
                            }} />
                          </div>
                          <span className="font-mono text-xs min-w-[42px] text-right">{p.cpu_util_pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tier rollups */}
          <div className="bg-card border border-border rounded-lg p-5 mb-6">
            <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2">
              <HardDrive size={18} /> Per-tier performance
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="text-left py-2 pr-3">Tier</th>
                    <th className="text-right pr-3">Partition</th>
                    <th className="text-right pr-3">N done / total</th>
                    <th className="text-right pr-3">Success</th>
                    <th className="text-right pr-3">Mem req → p95 used</th>
                    <th className="text-right pr-3">Time req → p95</th>
                    <th className="text-right pr-3">Mem eff%</th>
                    <th className="text-right pr-3">Time eff%</th>
                    <th className="text-left pr-3">Hint</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map(t => (
                    <tr key={t.name} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-mono font-medium">{t.name}</td>
                      <td className="text-right pr-3 font-mono text-xs text-muted-foreground">{t.partition}</td>
                      <td className="text-right pr-3 font-mono">{t.n_complete} / {t.n_total}</td>
                      <td className="text-right pr-3 font-mono"
                          style={{ color: t.success_rate_pct === null ? COLORS.muted : t.success_rate_pct >= 85 ? COLORS.success : COLORS.warning }}>
                        {t.success_rate_pct === null ? "—" : `${t.success_rate_pct}%`}
                      </td>
                      <td className="text-right pr-3 font-mono text-xs">
                        {t.mem_gb_req}G → <span className="text-foreground font-bold">{t.mem_gb_p95}G</span>
                      </td>
                      <td className="text-right pr-3 font-mono text-xs">
                        {fmtDuration(t.time_req_s)} → <span className="text-foreground font-bold">{fmtDuration(t.time_s_p95)}</span>
                      </td>
                      <td className="text-right pr-3 font-mono"
                          style={{ color: t.mem_eff_pct >= 50 ? COLORS.success : t.mem_eff_pct >= 25 ? COLORS.warning : COLORS.danger }}>
                        {t.mem_eff_pct.toFixed(0)}%
                      </td>
                      <td className="text-right pr-3 font-mono"
                          style={{ color: t.time_eff_pct >= 50 ? COLORS.success : t.time_eff_pct >= 25 ? COLORS.warning : COLORS.danger }}>
                        {t.time_eff_pct.toFixed(0)}%
                      </td>
                      <td className="text-left pr-3 text-xs">
                        {t.downsize_candidate
                          ? <span className="inline-flex items-center gap-1 text-warning" style={{ color: COLORS.warning }}>
                              <TrendingDown size={12} /> downsize
                            </span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

            {/* Failure modes */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="font-display text-base font-bold mb-3">Failure modes (7d)</h3>
              {fmData.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">No failures recorded</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={fmData} layout="vertical" margin={{ top: 5, right: 20, left: 60, bottom: 5 }}>
                    <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
                    <XAxis type="number" stroke="#9ca3af" fontSize={11} />
                    <YAxis dataKey="name" type="category" stroke="#9ca3af" fontSize={11} width={120} />
                    <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151" }} />
                    <Bar dataKey="count">
                      {fmData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Status distribution */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="font-display text-base font-bold mb-3">Status distribution</h3>
              {statusPie.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">No completed samples yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => `${e.name}: ${e.value}`}>
                      {statusPie.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151" }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Efficiency scatter */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="font-display text-base font-bold mb-3">Mem vs time efficiency (per tier)</h3>
              {effData.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">Not enough data</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
                    <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="mem" name="Mem eff" unit="%" stroke="#9ca3af" fontSize={11} label={{ value: "Mem efficiency %", position: "insideBottom", offset: -5, fill: "#9ca3af", fontSize: 11 }} domain={[0, 100]} />
                    <YAxis type="number" dataKey="time" name="Time eff" unit="%" stroke="#9ca3af" fontSize={11} label={{ value: "Time eff %", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151" }} cursor={{ strokeDasharray: "3 3" }} />
                    <Scatter data={effData} fill={COLORS.info}>
                      {effData.map((d, i) => <Cell key={i} fill={d.mem >= 50 && d.time >= 50 ? COLORS.success : d.mem < 25 || d.time < 25 ? COLORS.warning : COLORS.info} />)}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Recent failures */}
          {snap!.recent_failures.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-5 mb-6">
              <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2">
                <AlertTriangle size={18} /> Recent failures (last 50)
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="text-left py-2 pr-3">When</th>
                      <th className="text-left pr-3">GSM</th>
                      <th className="text-left pr-3">Tier</th>
                      <th className="text-left pr-3">State</th>
                      <th className="text-right pr-3">Elapsed</th>
                      <th className="text-right pr-3">MaxRSS</th>
                      <th className="text-right pr-3">Retries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap!.recent_failures.slice().reverse().map(f => (
                      <tr key={f.jobid} className="border-b border-border/50">
                        <td className="py-1.5 pr-3 font-mono text-muted-foreground">{f.end?.replace("T", " ").slice(0, 16)}</td>
                        <td className="pr-3 font-mono">{f.gsm ?? "—"}</td>
                        <td className="pr-3 font-mono text-muted-foreground">{f.tier ?? "—"}</td>
                        <td className="pr-3 font-mono" style={{ color: STATE_COLOR[f.state] ?? COLORS.danger }}>{f.state}</td>
                        <td className="text-right pr-3 font-mono">{fmtDuration(f.elapsed_s)}</td>
                        <td className="text-right pr-3 font-mono">{f.maxrss_gb}G</td>
                        <td className="text-right pr-3 font-mono">{f.retries}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Running jobs */}
          {snap!.running_jobs.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-5 mb-6">
              <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2">
                <Activity size={18} /> Running jobs ({snap!.running_jobs.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="text-left py-2 pr-3">Job</th>
                      <th className="text-left pr-3">Tier</th>
                      <th className="text-left pr-3">Partition</th>
                      <th className="text-left pr-3">Node</th>
                      <th className="text-right pr-3">CPUs</th>
                      <th className="text-right pr-3">Mem</th>
                      <th className="text-right pr-3">Time limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap!.running_jobs.slice(0, 100).map(j => (
                      <tr key={j.jobid} className="border-b border-border/50">
                        <td className="py-1.5 pr-3 font-mono">{j.jobid}</td>
                        <td className="pr-3 font-mono text-muted-foreground">{j.tier ?? "—"}</td>
                        <td className="pr-3 font-mono">{j.partition}</td>
                        <td className="pr-3 font-mono">{j.node}</td>
                        <td className="text-right pr-3 font-mono">{j.cpus}</td>
                        <td className="text-right pr-3 font-mono">{j.mem}</td>
                        <td className="text-right pr-3 font-mono">{j.time_limit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Policy footer */}
          <div className="bg-card border border-border rounded-lg p-5 text-xs text-muted-foreground">
            <div className="font-display text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <Clock size={14} /> Orchestrator policy
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div><span className="text-foreground font-mono">{snap!.policy_snapshot.max_nodes_per_partition}</span> max nodes/partition</div>
              <div><span className="text-foreground font-mono">{snap!.policy_snapshot.target_concurrency_jobs}</span> target concurrency</div>
              <div>downsize <span className="text-foreground font-mono">{snap!.policy_snapshot.downsize_enabled ? "on" : "off"}</span></div>
              <div>apply <span className="text-foreground font-mono">{snap!.policy_snapshot.apply_actions ? "on" : "DRY"}</span></div>
              <div>cadence <span className="text-foreground font-mono">{snap!.policy_snapshot.dashboard_cadence_minutes}m</span></div>
            </div>
            {snap!.downsize_proposals.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <div className="text-foreground font-bold mb-1">Downsize proposals ({snap!.downsize_proposals.length})</div>
                {snap!.downsize_proposals.map(d => (
                  <div key={d.tier} className="font-mono">
                    {d.tier}: mem {d.current_mem_gb}G → {d.proposed_mem_gb}G,
                    time {fmtDuration(d.current_time_s)} → {fmtDuration(d.proposed_time_s)}
                    ({d.n_samples} samples)
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </section>
      <Footer />
    </div>
  );
};

export default HpcDashboard;
